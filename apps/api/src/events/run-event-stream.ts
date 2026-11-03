import type { RunEventType } from '../prisma/generated/client.js';
import { RUN_EVENT_TYPES, runEventWireType } from '../runs/run-domain.js';

/** Envelope carried by the `data:` field of every domain event frame. */
export interface RunEventEnvelope {
  readonly schemaVersion: number;
  readonly runId: string;
  readonly sequence: number;
  readonly occurredAt: string;
  readonly payload: unknown;
}

/** The committed RunEvent columns needed to serialise one SSE frame. */
export interface StoredRunEvent {
  readonly runId: string;
  readonly sequence: number;
  readonly type: RunEventType;
  readonly schemaVersion: number;
  readonly occurredAt: Date;
  readonly payload: unknown;
}

/** A prepared connection: cursor validated against one consistent run read. */
export interface PreparedRunEventStream {
  readonly runId: string;
  readonly cursor: number;
  /**
   * True when the run was already terminal at connect. The pump then replays
   * through the snapshot backlog and closes even if a corrupt history is
   * missing its terminal event.
   */
  readonly closeAfterCatchUp: boolean;
}

/** The eight documented wire names, in contract order. */
export const RUN_EVENT_WIRE_TYPE_NAMES: readonly string[] = RUN_EVENT_TYPES.map(
  (type) => runEventWireType(type),
);

const TERMINAL_RUN_EVENT_TYPES: ReadonlySet<RunEventType> = new Set([
  'RUN_COMPLETED',
  'RUN_CANCELLED',
  'RUN_INTERRUPTED',
  'RUN_ERRORED',
]);

/** A terminal event must be the last frame of a stream. */
export function isTerminalRunEventType(type: RunEventType): boolean {
  return TERMINAL_RUN_EVENT_TYPES.has(type);
}

/**
 * Serialises one committed row. `id` is the run-local sequence, never a
 * connection-local counter; a reconnect can therefore resume exactly.
 */
export function formatRunEventFrame(event: StoredRunEvent): string {
  const envelope: RunEventEnvelope = {
    schemaVersion: event.schemaVersion,
    runId: event.runId,
    sequence: event.sequence,
    occurredAt: event.occurredAt.toISOString(),
    payload: event.payload,
  };

  return `id: ${event.sequence}\nevent: ${runEventWireType(event.type)}\ndata: ${JSON.stringify(envelope)}\n\n`;
}

/** Liveness comment; it carries no id, event or data and consumes no sequence. */
export const HEARTBEAT_FRAME = ': heartbeat\n\n';
