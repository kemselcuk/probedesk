import {
  HttpStatus,
  Inject,
  Injectable,
  Logger,
  type OnModuleDestroy,
} from '@nestjs/common';
import type { Request, Response } from 'express';
import { AuthService } from '../auth/auth.service.js';
import { ApiException } from '../common/errors/api.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { isTerminalRunStatus } from '../runs/run-domain.js';
import {
  assertRunEventCursorWithinRun,
  parseRunEventCursor,
  type RunEventCursorInput,
} from './run-event-cursor.js';
import { RunEventConnection } from './run-event-connection.js';
import type { PreparedRunEventStream } from './run-event-stream.js';
import {
  RUN_EVENT_STREAM_OPTIONS,
  type RunEventStreamOptions,
} from './run-events.options.js';

export interface StartRunEventStreamInput {
  readonly sessionToken: string;
  readonly sessionExpiresAt: Date;
  readonly request: Request;
  readonly response: Response;
  readonly requestId: string;
}

/**
 * Durable SSE delivery over the committed RunEvent table.
 *
 * Validation (run existence, cursor shape/range) finishes before the controller
 * writes a single response header, so 400/404 responses use the shared JSON
 * error contract. A terminal run with no missing events returns null, which the
 * controller maps to 204 without opening a stream.
 */
@Injectable()
export class RunEventsService implements OnModuleDestroy {
  private readonly logger = new Logger(RunEventsService.name);
  private readonly connections = new Set<RunEventConnection>();

  constructor(
    @Inject(PrismaService) private readonly prisma: PrismaService,
    @Inject(AuthService) private readonly authService: AuthService,
    @Inject(RUN_EVENT_STREAM_OPTIONS)
    private readonly options: RunEventStreamOptions,
  ) {}

  /** Number of open SSE responses; used by teardown integration tests. */
  get activeStreamCount(): number {
    return this.connections.size;
  }

  /**
   * Reads the run cursor baseline and validates the requested cursor. The run
   * row read is one statement, and the snapshot sequence is the same value the
   * snapshot endpoint reports as `lastEventSequence`.
   */
  async prepare(
    runId: string,
    cursorInput: RunEventCursorInput,
  ): Promise<PreparedRunEventStream | null> {
    const run = await this.prisma.testRun.findUnique({
      where: { id: runId },
      select: { id: true, status: true, eventSequence: true },
    });

    if (!run) {
      throw new ApiException(
        HttpStatus.NOT_FOUND,
        'NOT_FOUND',
        'The requested resource was not found.',
      );
    }

    const cursor = parseRunEventCursor(cursorInput);
    assertRunEventCursorWithinRun(cursor, run.eventSequence);

    const terminal = isTerminalRunStatus(run.status);

    // Browser EventSource stops reconnecting on 204. A terminal snapshot with
    // a complete cursor has nothing to replay and must not open a new stream.
    if (terminal && cursor.value === run.eventSequence) {
      return null;
    }

    return {
      runId: run.id,
      cursor: cursor.value,
      closeAfterCatchUp: terminal,
    };
  }

  start(
    prepared: PreparedRunEventStream,
    input: StartRunEventStreamInput,
  ): void {
    const connection = new RunEventConnection(
      {
        prepared,
        sessionToken: input.sessionToken,
        sessionExpiresAt: input.sessionExpiresAt,
        request: input.request,
        response: input.response,
        requestId: input.requestId,
      },
      {
        prisma: this.prisma,
        authService: this.authService,
        options: this.options,
        logger: this.logger,
        onClosed: (closed) => {
          this.connections.delete(closed);
        },
      },
    );

    this.connections.add(connection);
    connection.start();
  }

  /**
   * Controlled process shutdown closes every open stream. Normal client
   * disconnects remove their own connection without touching the run executor.
   */
  onModuleDestroy(): void {
    for (const connection of this.connections) {
      connection.dispose();
    }
    this.connections.clear();
  }
}
