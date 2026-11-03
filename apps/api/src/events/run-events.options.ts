/**
 * Tunables for the durable RunEvent stream pump.
 *
 * The polling design reads committed events from PostgreSQL; the interval is a
 * latency target, not a delivery guarantee. The heartbeat is an SSE comment and
 * never consumes a run event sequence.
 */
export interface RunEventStreamOptions {
  /** Delay between two follow-up queries after the replay backlog is drained. */
  readonly pollIntervalMs: number;
  /** Interval of the SSE comment used for liveness and session revalidation. */
  readonly heartbeatIntervalMs: number;
  /** Maximum rows read by one follow-up query. */
  readonly batchSize: number;
}

/** Injection token so integration tests can use short intervals. */
export const RUN_EVENT_STREAM_OPTIONS = Symbol('RUN_EVENT_STREAM_OPTIONS');

export const DEFAULT_RUN_EVENT_STREAM_OPTIONS: RunEventStreamOptions =
  Object.freeze({
    pollIntervalMs: 200,
    heartbeatIntervalMs: 15_000,
    batchSize: 500,
  });
