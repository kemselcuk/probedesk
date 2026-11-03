import type { Logger } from '@nestjs/common';
import type { Request, Response } from 'express';
import type { AuthContext } from '../auth/auth.types.js';
import type { AuthService } from '../auth/auth.service.js';
import type { PrismaService } from '../prisma/prisma.service.js';
import {
  formatRunEventFrame,
  HEARTBEAT_FRAME,
  isTerminalRunEventType,
  type PreparedRunEventStream,
  type StoredRunEvent,
} from './run-event-stream.js';
import type { RunEventStreamOptions } from './run-events.options.js';

export interface RunEventConnectionInput {
  readonly prepared: PreparedRunEventStream;
  readonly sessionToken: string;
  readonly sessionExpiresAt: Date;
  readonly request: Request;
  readonly response: Response;
  readonly requestId: string;
}

export interface RunEventConnectionDependencies {
  readonly prisma: PrismaService;
  readonly authService: AuthService;
  readonly options: RunEventStreamOptions;
  readonly logger: Logger;
  readonly onClosed: (connection: RunEventConnection) => void;
}

/**
 * One SSE connection.
 *
 * Exactly one event query may be in flight per connection. Heartbeat session
 * checks share the same promise queue so a connection never opens overlapping
 * queries. Polling uses a re-armed timer rather than an interval, which keeps
 * the "no parallel follow-up query" invariant local and obvious.
 */
export class RunEventConnection {
  private readonly prepared: PreparedRunEventStream;
  private readonly sessionToken: string;
  private readonly sessionExpiresAt: Date;
  private readonly request: Request;
  private readonly response: Response;
  private readonly requestId: string;
  private readonly dependencies: RunEventConnectionDependencies;

  private lastSequence: number;
  private pollTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private queryQueue: Promise<void> = Promise.resolve();
  private stopped = false;
  private heartbeatInFlight = false;
  private closeNotified = false;

  private readonly handleResponseClose = (): void => {
    this.stop();
  };

  private readonly handleRequestAborted = (): void => {
    this.stop();
  };

  constructor(
    input: RunEventConnectionInput,
    dependencies: RunEventConnectionDependencies,
  ) {
    this.prepared = input.prepared;
    this.sessionToken = input.sessionToken;
    this.sessionExpiresAt = input.sessionExpiresAt;
    this.request = input.request;
    this.response = input.response;
    this.requestId = input.requestId;
    this.dependencies = dependencies;
    this.lastSequence = input.prepared.cursor;
  }

  start(): void {
    if (this.stopped) {
      return;
    }

    const { request, response } = this;

    // An SSE connection is intentionally long-lived: no socket timeout, and
    // every frame is flushed without waiting for Nagle batching.
    request.socket?.setTimeout(0);
    request.socket?.setNoDelay(true);

    response.status(200);
    response.setHeader('Content-Type', 'text/event-stream');
    response.setHeader('Cache-Control', 'no-cache');
    response.setHeader('Connection', 'keep-alive');
    response.setHeader('X-Accel-Buffering', 'no');

    response.on('close', this.handleResponseClose);
    request.on('aborted', this.handleRequestAborted);

    try {
      response.flushHeaders();
    } catch {
      this.stop();
      return;
    }

    if (response.destroyed || response.writableEnded) {
      this.stop();
      return;
    }

    this.heartbeatTimer = setInterval(() => {
      this.beginHeartbeat();
    }, this.dependencies.options.heartbeatIntervalMs);

    // Replay/follow begins immediately so an already-committed backlog flushes
    // without waiting for the first poll interval.
    this.beginPoll();
  }

  /** Controlled application shutdown: stop timers and close the HTTP stream. */
  dispose(): void {
    this.finish();
  }

  private beginPoll(): void {
    void this.poll().catch(() => {
      // Serialisation or an unexpected programming error must not become an
      // unhandled rejection after the response headers were sent.
      this.dependencies.logger.error(
        `Run event stream failed runId=${this.prepared.runId} requestId=${this.requestId}`,
      );
      this.finish();
    });
  }

  private beginHeartbeat(): void {
    void this.heartbeat().catch(() => {
      this.dependencies.logger.error(
        `Run event stream heartbeat failed requestId=${this.requestId}`,
      );
      this.finish();
    });
  }

  private async poll(): Promise<void> {
    if (this.stopped) {
      return;
    }

    this.pollTimer = null;

    let events: StoredRunEvent[];
    try {
      events = await this.enqueue(() =>
        this.dependencies.prisma.runEvent.findMany({
          where: {
            runId: this.prepared.runId,
            sequence: { gt: this.lastSequence },
          },
          orderBy: { sequence: 'asc' },
          take: this.dependencies.options.batchSize,
          select: {
            runId: true,
            sequence: true,
            type: true,
            schemaVersion: true,
            occurredAt: true,
            payload: true,
          },
        }),
      );
    } catch {
      // Headers are already sent; the only safe reaction is a clean close. Do
      // not log driver messages, which may contain SQL or connection details.
      this.dependencies.logger.error(
        `Run event stream query failed runId=${this.prepared.runId} requestId=${this.requestId}`,
      );
      this.finish();
      return;
    }

    if (this.stopped) {
      return;
    }

    for (const event of events) {
      if (this.stopped) {
        return;
      }

      if (!this.writeFrame(formatRunEventFrame(event))) {
        return;
      }
      this.lastSequence = event.sequence;

      if (isTerminalRunEventType(event.type)) {
        this.finish();
        return;
      }
    }

    // A terminal snapshot is immutable, so a drained replay has nothing left
    // to follow. Closing on drain also avoids hanging on a history that is
    // missing its terminal event; a healthy history closes at that event above.
    const drained = events.length < this.dependencies.options.batchSize;
    if (this.prepared.closeAfterCatchUp && drained) {
      this.finish();
      return;
    }

    this.schedulePoll(
      drained ? this.dependencies.options.pollIntervalMs : 0,
    );
  }

  /**
   * A heartbeat is also the session revalidation point. Expired or revoked
   * sessions end at the latest heartbeat, exactly as api.md defines.
   */
  private async heartbeat(): Promise<void> {
    if (this.stopped || this.heartbeatInFlight) {
      return;
    }

    this.heartbeatInFlight = true;

    try {
      if (this.sessionExpiresAt.getTime() <= Date.now()) {
        this.finish();
        return;
      }

      let session: AuthContext | null;
      try {
        session = await this.enqueue(() =>
          this.dependencies.authService.findSession(this.sessionToken),
        );
      } catch {
        this.dependencies.logger.error(
          `Run event stream session check failed requestId=${this.requestId}`,
        );
        this.finish();
        return;
      }

      if (this.stopped) {
        return;
      }

      if (!session) {
        this.finish();
        return;
      }

      this.writeFrame(HEARTBEAT_FRAME);
    } finally {
      this.heartbeatInFlight = false;
    }
  }

  private schedulePoll(delayMs: number): void {
    if (this.stopped) {
      return;
    }

    this.pollTimer = setTimeout(() => {
      this.pollTimer = null;
      this.beginPoll();
    }, delayMs);
  }

  /**
   * Serialises every database access for this connection. The event pump never
   * overlaps its own follow-up query, and heartbeat session reads queue behind
   * an in-flight event read instead of opening a second parallel query.
   */
  private enqueue<T>(operation: () => Promise<T>): Promise<T> {
    const next = this.queryQueue.then(operation, operation);
    this.queryQueue = next.then(
      () => undefined,
      () => undefined,
    );
    return next;
  }

  private writeFrame(frame: string): boolean {
    if (
      this.stopped ||
      this.response.destroyed ||
      this.response.writableEnded
    ) {
      return false;
    }

    try {
      this.response.write(frame);
      return true;
    } catch {
      this.stop();
      return false;
    }
  }

  /** Cleans local resources and removes the connection from the registry. */
  private stop(): void {
    if (this.stopped) {
      return;
    }

    this.stopped = true;

    if (this.pollTimer !== null) {
      clearTimeout(this.pollTimer);
      this.pollTimer = null;
    }
    if (this.heartbeatTimer !== null) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }

    this.response.off('close', this.handleResponseClose);
    this.request.off('aborted', this.handleRequestAborted);

    if (!this.closeNotified) {
      this.closeNotified = true;
      this.dependencies.onClosed(this);
    }
  }

  /** Ends the response once, then cleans up. */
  private finish(): void {
    if (this.stopped) {
      return;
    }

    this.stop();

    if (!this.response.destroyed && !this.response.writableEnded) {
      try {
        this.response.end();
      } catch {
        // The peer may already be gone; cleanup above is the important part.
      }
    }
  }
}
