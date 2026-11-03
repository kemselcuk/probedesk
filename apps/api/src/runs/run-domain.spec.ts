import { describe, expect, it } from 'vitest';
import { RunStatus, RunStepStatus } from '../prisma/generated/enums.js';
import {
  RUN_EVENT_TYPES,
  RUN_EVENT_WIRE_TYPES,
  isTerminalRunStatus,
  isTerminalRunStepStatus,
  runEventWireType,
} from './run-domain.js';

describe('run domain status rules', () => {
  it('treats every status except RUNNING as terminal', () => {
    expect(isTerminalRunStatus(RunStatus.RUNNING)).toBe(false);
    for (const status of [
      RunStatus.COMPLETED,
      RunStatus.CANCELLED,
      RunStatus.INTERRUPTED,
      RunStatus.ERROR,
    ]) {
      expect(isTerminalRunStatus(status), status).toBe(true);
    }
  });

  it('treats every step status except PENDING and RUNNING as terminal', () => {
    expect(isTerminalRunStepStatus(RunStepStatus.PENDING)).toBe(false);
    expect(isTerminalRunStepStatus(RunStepStatus.RUNNING)).toBe(false);
    for (const status of [
      RunStepStatus.COMPLETED,
      RunStepStatus.CANCELLED,
      RunStepStatus.INTERRUPTED,
      RunStepStatus.ERROR,
      RunStepStatus.NOT_RUN,
    ]) {
      expect(isTerminalRunStepStatus(status), status).toBe(true);
    }
  });

  it('maps every Prisma event identifier to its documented wire name', () => {
    expect(RUN_EVENT_TYPES.map(runEventWireType)).toEqual([
      'run.started',
      'step.started',
      'measurement.recorded',
      'step.completed',
      'run.completed',
      'run.cancelled',
      'run.interrupted',
      'run.errored',
    ]);
    expect(Object.values(RUN_EVENT_WIRE_TYPES)).toEqual([
      'run.started',
      'step.started',
      'measurement.recorded',
      'step.completed',
      'run.completed',
      'run.cancelled',
      'run.interrupted',
      'run.errored',
    ]);
  });
});
