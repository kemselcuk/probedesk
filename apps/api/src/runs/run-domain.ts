import {
  RunEventType,
  RunStatus,
  RunStepStatus,
} from '../prisma/generated/enums.js';

/**
 * Statuses that can no longer produce measurements. RUNNING is the only
 * non-terminal run status; NOT_RUN is terminal for a step that never started.
 */
export const TERMINAL_RUN_STATUSES = [
  RunStatus.COMPLETED,
  RunStatus.CANCELLED,
  RunStatus.INTERRUPTED,
  RunStatus.ERROR,
] as const satisfies readonly RunStatus[];

export const TERMINAL_RUN_STEP_STATUSES = [
  RunStepStatus.COMPLETED,
  RunStepStatus.CANCELLED,
  RunStepStatus.INTERRUPTED,
  RunStepStatus.ERROR,
  RunStepStatus.NOT_RUN,
] as const satisfies readonly RunStepStatus[];

const terminalRunStatuses: ReadonlySet<RunStatus> = new Set(
  TERMINAL_RUN_STATUSES,
);
const terminalRunStepStatuses: ReadonlySet<RunStepStatus> = new Set(
  TERMINAL_RUN_STEP_STATUSES,
);

/** Terminal runs are immutable history; no new measurement may be appended. */
export function isTerminalRunStatus(status: RunStatus): boolean {
  return terminalRunStatuses.has(status);
}

/** True when a step has stopped for any reason, including never starting. */
export function isTerminalRunStepStatus(status: RunStepStatus): boolean {
  return terminalRunStepStatuses.has(status);
}

/** The SSE/domain event names in their contract order. */
export const RUN_EVENT_TYPES = [
  RunEventType.RUN_STARTED,
  RunEventType.STEP_STARTED,
  RunEventType.MEASUREMENT_RECORDED,
  RunEventType.STEP_COMPLETED,
  RunEventType.RUN_COMPLETED,
  RunEventType.RUN_CANCELLED,
  RunEventType.RUN_INTERRUPTED,
  RunEventType.RUN_ERRORED,
] as const satisfies readonly RunEventType[];

/**
 * Prisma keeps the enum identifiers in TypeScript while the database stores the
 * documented dotted wire names. API/SSE serializers use this map so they never
 * leak the Prisma-only identifier.
 */
export const RUN_EVENT_WIRE_TYPES: Readonly<Record<RunEventType, string>> = {
  [RunEventType.RUN_STARTED]: 'run.started',
  [RunEventType.STEP_STARTED]: 'step.started',
  [RunEventType.MEASUREMENT_RECORDED]: 'measurement.recorded',
  [RunEventType.STEP_COMPLETED]: 'step.completed',
  [RunEventType.RUN_COMPLETED]: 'run.completed',
  [RunEventType.RUN_CANCELLED]: 'run.cancelled',
  [RunEventType.RUN_INTERRUPTED]: 'run.interrupted',
  [RunEventType.RUN_ERRORED]: 'run.errored',
};

export function runEventWireType(type: RunEventType): string {
  return RUN_EVENT_WIRE_TYPES[type];
}

/** Envelope schema version stored on every row and sent over SSE. */
export const RUN_EVENT_SCHEMA_VERSION = 1;

/**
 * Version of the tolerance/summary evaluation rules stamped on every run.
 * P3-05 implements the evaluator; changing its verdict or summary rules must
 * bump this value so historical runs stay traceable.
 */
export const RUN_EVALUATION_VERSION = 'decimal-v1';

/** Seed is a uint32 and therefore does not fit a signed PostgreSQL INTEGER. */
export const MAX_RUN_SEED = 4_294_967_295n;
