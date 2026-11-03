import { HttpErrorResponse } from '@angular/common/http';
import { Injectable, InjectionToken, inject } from '@angular/core';
import { Router } from '@angular/router';
import {
  Observable,
  Subject,
  catchError,
  map,
  of,
  throwError,
} from 'rxjs';
import { AuthApi } from '../auth/auth-api';
import { AuthSessionStore } from '../auth/auth-session.store';
import type { RunEventEnvelope, RunEventType } from './run-event.types';
import {
  MalformedRunEventError,
  RUN_EVENT_TYPES,
  isTerminalRunEventType,
  parseRunEventEnvelope,
} from './run-event.types';

/**
 * Connection lifecycle exposed separately from the run status.
 *
 * `reconnecting` is a transient network condition, `unauthenticated` is a
 * confirmed session loss. The screen must not present them as the same state.
 */
export type RunConnectionState =
  | 'connecting'
  | 'connected'
  | 'reconnecting'
  | 'disconnected'
  | 'unauthenticated';

export type RunStreamUpdate =
  | {
      readonly type: 'connection';
      readonly state: RunConnectionState;
    }
  | {
      readonly type: 'event';
      readonly event: RunEventEnvelope;
    }
  | {
      readonly type: 'error';
      readonly code: 'protocol' | 'unavailable';
      readonly message: string;
    };

/** Creates the native EventSource. Overridden by tests with a deterministic fake. */
export type RunEventSourceFactory = (url: string) => EventSource;

export const RUN_EVENT_SOURCE_FACTORY = new InjectionToken<RunEventSourceFactory>(
  'RUN_EVENT_SOURCE_FACTORY',
  {
    providedIn: 'root',
    factory: () => (url: string) => new EventSource(url),
  },
);

/**
 * Bounded reconnect delays in milliseconds. The default backs off from half a
 * second to four seconds and then gives up instead of retrying forever.
 */
export const RUN_EVENT_RECONNECT_DELAYS = new InjectionToken<readonly number[]>(
  'RUN_EVENT_RECONNECT_DELAYS',
  {
    providedIn: 'root',
    factory: () => [500, 1_000, 2_000, 4_000],
  },
);

const EVENT_SOURCE_CLOSED = 2;

/**
 * Typed transport for `GET /api/runs/:id/events`.
 *
 * One session exists per run. Every caller subscribing to the same run shares
 * that session's single EventSource; the source closes when the last consumer
 * unsubscribes. The service parses the documented envelope before emitting it,
 * so a malformed or unknown payload becomes a controlled `error` update rather
 * than an exception inside a DOM event handler.
 *
 * The requested cursor is authoritative. The session advances when it delivers
 * an event, but a consumer may reject that event (for example the facade
 * detects a gap and reconciles with a fresh snapshot). If a later `connect`
 * asks for a different cursor, the session is restarted at that exact cursor
 * instead of reusing a transport cursor that is ahead of what the consumer
 * applied. A restart closes the previous EventSource first, so no two sources
 * remain open for the same run.
 *
 * Transport never computes a verdict, tolerance flag, or statistic. It only
 * carries the backend fields to the reducer.
 */
@Injectable({ providedIn: 'root' })
export class RunEventsService {
  private readonly factory = inject(RUN_EVENT_SOURCE_FACTORY);
  private readonly reconnectDelays = inject(RUN_EVENT_RECONNECT_DELAYS);
  private readonly sessionProbe = inject(RunSessionProbe);
  private readonly sessions = new Map<string, RunEventSession>();

  /**
   * Opens the live event stream for one run at exactly `afterSequence`.
   *
   * A matching open session is shared. When the cursor differs (the facade
   * reconciled a gap, reconnected, or a different consumer loads a snapshot)
   * the session restarts at the requested cursor. This guarantees replay
   * starts after the last sequence the consumer actually applied.
   */
  connect(runId: string, afterSequence: number): Observable<RunStreamUpdate> {
    let session = this.sessions.get(runId);

    if (session !== undefined && session.isClosed) {
      if (this.sessions.get(runId) === session) {
        this.sessions.delete(runId);
      }
      session = undefined;
    }

    if (session === undefined) {
      const created = new RunEventSession(runId, afterSequence, {
        factory: this.factory,
        reconnectDelays: this.reconnectDelays,
        probeSession: () => this.sessionProbe.probe(),
        onIdle: () => {
          if (this.sessions.get(runId) === created) {
            this.sessions.delete(runId);
          }
        },
      });
      this.sessions.set(runId, created);
      return created.updates;
    }

    if (session.cursor !== afterSequence) {
      session.restartAt(afterSequence);
    }

    return session.updates;
  }
}

interface RunEventSessionDependencies {
  readonly factory: RunEventSourceFactory;
  readonly reconnectDelays: readonly number[];
  /** Resolves to true when the session is still valid, false on a 401. */
  readonly probeSession: () => Observable<boolean>;
  readonly onIdle: () => void;
}

class RunEventSession {
  private readonly updatesSubject = new Subject<RunStreamUpdate>();
  private readonly listeners: Array<{
    readonly source: EventSource;
    readonly type: string;
    readonly listener: EventListener;
  }> = [];
  private source: EventSource | null = null;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private consumers = 0;
  private attempt = 0;
  private lastSequence: number;
  private state: RunConnectionState = 'connecting';
  private closed = false;
  private idleReported = false;

  readonly updates: Observable<RunStreamUpdate>;

  constructor(
    private readonly runId: string,
    afterSequence: number,
    private readonly dependencies: RunEventSessionDependencies,
  ) {
    this.lastSequence = afterSequence;
    this.updates = new Observable<RunStreamUpdate>((subscriber) => {
      const subscription = this.updatesSubject.subscribe(subscriber);
      subscriber.next({ type: 'connection', state: this.state });
      this.acquire();

      return () => {
        subscription.unsubscribe();
        this.release();
      };
    });
  }

  /** Last sequence this session delivered to its consumers. */
  get cursor(): number {
    return this.lastSequence;
  }

  get isClosed(): boolean {
    return this.closed;
  }

  /**
   * Replaces the open source with one that resumes at exactly `afterSequence`.
   *
   * The old source is closed and its listeners removed before the replacement
   * opens. Existing subscribers stay attached and may see already applied
   * sequences again; the reducer ignores those duplicates. This is the
   * supported recovery path when the consumer's applied cursor is behind the
   * session's delivered cursor.
   */
  restartAt(afterSequence: number): void {
    if (this.closed || this.lastSequence === afterSequence) {
      return;
    }

    this.clearTimer();
    this.closeSource();
    this.lastSequence = afterSequence;
    this.attempt = 0;
    this.setState('connecting');

    if (this.consumers > 0) {
      this.open();
    }
  }

  private acquire(): void {
    this.consumers += 1;
    if (
      this.consumers === 1 &&
      !this.closed &&
      this.source === null &&
      this.reconnectTimer === null
    ) {
      this.open();
    }
  }

  private release(): void {
    this.consumers = Math.max(0, this.consumers - 1);
    if (this.consumers > 0) {
      return;
    }

    this.closed = true;
    this.clearTimer();
    this.closeSource();
    this.updatesSubject.complete();
    this.reportIdle();
  }

  private open(): void {
    if (this.closed) {
      return;
    }

    this.setState(this.attempt === 0 ? 'connecting' : 'reconnecting');

    let source: EventSource;
    try {
      source = this.dependencies.factory(this.eventsUrl());
    } catch {
      this.scheduleReconnect();
      return;
    }

    this.source = source;
    for (const type of RUN_EVENT_TYPES) {
      this.addListener(source, type);
    }

    source.onopen = () => this.handleOpen(source);
    source.onerror = () => this.handleError(source);
  }

  private addListener(source: EventSource, type: RunEventType): void {
    const listener: EventListener = (event) =>
      this.handleMessage(source, type, event);
    this.listeners.push({ source, type, listener });
    source.addEventListener(type, listener);
  }

  private handleOpen(source: EventSource): void {
    if (this.closed || source !== this.source) {
      return;
    }

    this.attempt = 0;
    this.setState('connected');
  }

  private handleMessage(
    source: EventSource,
    type: RunEventType,
    event: Event,
  ): void {
    if (this.closed || source !== this.source) {
      return;
    }

    const message = event as MessageEvent<string>;
    const data = typeof message.data === 'string' ? message.data : '';

    let parsed: RunEventEnvelope;
    try {
      parsed = parseRunEventEnvelope(type, data, message.lastEventId ?? '');
    } catch (error: unknown) {
      const reason =
        error instanceof MalformedRunEventError
          ? error.message
          : 'The run event could not be read.';
      this.failProtocol(reason);
      return;
    }

    // A committed event for another run is ignored. It must never move this
    // run's cursor or counters.
    if (parsed.runId !== this.runId) {
      return;
    }

    this.lastSequence = Math.max(this.lastSequence, parsed.sequence);
    this.updatesSubject.next({ type: 'event', event: parsed });

    if (isTerminalRunEventType(parsed.type)) {
      // The server closes the stream after the terminal event. Closing here
      // first also stops EventSource's own reconnect attempt.
      this.finish('disconnected');
    }
  }

  private handleError(source: EventSource): void {
    if (this.closed || source !== this.source) {
      return;
    }

    const readyState = source.readyState;
    this.closeSource();
    this.setState('reconnecting');

    if (readyState === EVENT_SOURCE_CLOSED) {
      // EventSource does not expose the HTTP status. A fatal close is either a
      // transient server problem or an expired session, so /auth/me decides.
      this.probeSession();
      return;
    }

    this.scheduleReconnect();
  }

  private probeSession(): void {
    this.dependencies.probeSession().subscribe({
      next: (authenticated) => {
        if (this.closed) {
          return;
        }

        if (authenticated) {
          this.scheduleReconnect();
        } else {
          this.finish('unauthenticated');
        }
      },
      error: () => {
        if (!this.closed) {
          // The session check itself failed for a non-auth reason; treat the
          // stream as a network problem rather than inventing a logout.
          this.scheduleReconnect();
        }
      },
    });
  }

  private scheduleReconnect(): void {
    if (this.closed) {
      return;
    }

    const delay = this.dependencies.reconnectDelays[this.attempt];
    if (delay === undefined) {
      this.updatesSubject.next({
        type: 'error',
        code: 'unavailable',
        message:
          'Live updates stopped after several reconnect attempts. The last received run state is still shown.',
      });
      this.finish('disconnected');
      return;
    }

    this.attempt += 1;
    this.setState('reconnecting');
    this.reconnectTimer = setTimeout(() => this.reconnect(), delay);
  }

  private reconnect(): void {
    this.reconnectTimer = null;
    this.open();
  }

  private failProtocol(message: string): void {
    this.updatesSubject.next({ type: 'error', code: 'protocol', message });
    this.finish('disconnected');
  }

  private finish(state: RunConnectionState): void {
    if (this.closed) {
      return;
    }

    this.closed = true;
    this.clearTimer();
    this.closeSource();
    this.setState(state);
    this.updatesSubject.complete();
    this.reportIdle();
  }

  private setState(state: RunConnectionState): void {
    this.state = state;
    this.updatesSubject.next({ type: 'connection', state });
  }

  private closeSource(): void {
    const source = this.source;
    if (source === null) {
      return;
    }

    this.source = null;
    source.onopen = null;
    source.onerror = null;

    for (const entry of this.listeners) {
      if (entry.source === source) {
        source.removeEventListener(entry.type, entry.listener);
      }
    }
    for (let index = this.listeners.length - 1; index >= 0; index -= 1) {
      if (this.listeners[index]?.source === source) {
        this.listeners.splice(index, 1);
      }
    }

    source.close();
  }

  private clearTimer(): void {
    if (this.reconnectTimer !== null) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private reportIdle(): void {
    if (this.idleReported) {
      return;
    }

    this.idleReported = true;
    this.dependencies.onIdle();
  }

  private eventsUrl(): string {
    return `/api/runs/${encodeURIComponent(this.runId)}/events?after=${this.lastSequence}`;
  }
}

/**
 * Resolves whether a fatal stream close was caused by an expired session.
 *
 * `/auth/me` is the contract's discriminator: 401 means the session is gone,
 * while 200 means the stream failure was transient. The interceptor skips
 * `/auth/me`, so this probe cannot redirect on its own.
 */
@Injectable({ providedIn: 'root' })
export class RunSessionProbe {
  private readonly authApi = inject(AuthApi);
  private readonly sessionStore = inject(AuthSessionStore);
  private readonly router = inject(Router);

  probe(): Observable<boolean> {
    return this.authApi.me().pipe(
      map(() => true),
      catchError((error: unknown) => {
        if (error instanceof HttpErrorResponse && error.status === 401) {
          this.sessionStore.markAnonymous();
          const returnUrl = this.router.url;
          if (!returnUrl.startsWith('/login')) {
            void this.router.navigate(['/login'], {
              queryParams: { returnUrl },
            });
          }
          return of(false);
        }

        return throwError(() => error);
      }),
    );
  }
}
