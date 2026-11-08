import { Role, RunScenario } from '../src/prisma/generated/client.js';

export interface DemoUserSeed {
  email: string;
  role: Role;
  password: string;
}

/**
 * Local demonstration accounts only. The passwords are intentionally published
 * in apps/api/README.md and must never be reused outside a disposable demo
 * environment.
 */
export const DEMO_USERS = [
  {
    email: 'planner@probedesk.local',
    role: Role.PLANNER,
    password: 'PlannerDemo!2026',
  },
  {
    email: 'operator@probedesk.local',
    role: Role.OPERATOR,
    password: 'OperatorDemo!2026',
  },
  {
    email: 'viewer@probedesk.local',
    role: Role.VIEWER,
    password: 'ViewerDemo!2026',
  },
] as const satisfies readonly DemoUserSeed[];

export const DEMO_USER_EMAILS: readonly string[] = DEMO_USERS.map(
  (user) => user.email,
);

export interface DemoDeviceProfileSeed {
  code: string;
  name: string;
  description: string;
}

/**
 * The single simulated device profile. `code` is the stable natural key used by
 * the idempotent seed; plans keep the generated profile id.
 */
export const DEMO_DEVICE_PROFILES = [
  {
    code: 'DC_POWER_MODULE',
    name: 'DC Power Module',
    description:
      'Deterministic simulated DC power module used for local demonstrations.',
  },
] as const satisfies readonly DemoDeviceProfileSeed[];

export interface DemoDeviceSeed {
  /** Stable fixture id; a repeat seed treats this row as existing. */
  id: string;
  name: string;
  serialNumber: string;
  description: string | null;
}

/**
 * Two additive device records for the seeded DC Power Module profile. The
 * fixed ids make a repeat seed preserve any edits made through the API instead
 * of recreating or overwriting the rows. Existing demo runs are never linked
 * to these devices.
 */
export const DEMO_DEVICES = [
  {
    id: '5f0d3c1e-2a4b-4c6d-8e9f-000000000001',
    name: 'Bench Power Module A',
    serialNumber: 'PSU-DEMO-0001',
    description: 'Primary demo unit used for local walkthroughs.',
  },
  {
    id: '5f0d3c1e-2a4b-4c6d-8e9f-000000000002',
    name: 'Bench Power Module B',
    serialNumber: 'PSU-DEMO-0002',
    description: 'Secondary demo unit for device selection examples.',
  },
] as const satisfies readonly DemoDeviceSeed[];

export const DEMO_PLANNER_EMAIL = 'planner@probedesk.local';
export const DEMO_OPERATOR_EMAIL = 'operator@probedesk.local';

export const DEMO_PLAN_NAME = 'Power Supply Validation';
export const DEMO_PLAN_PROFILE_CODE = 'DC_POWER_MODULE';

export interface DemoPlanStepSeed {
  /** Stable fixture key; never stored. Logical step ids are generated once. */
  key: string;
  name: string;
  unit: string;
  minimum: string;
  maximum: string;
  sampleCount: number;
  intervalMs: number;
}

const DEMO_PLAN_STEPS_V1: readonly DemoPlanStepSeed[] = [
  {
    key: 'output-voltage',
    name: 'Output Voltage',
    unit: 'V',
    minimum: '4.750000',
    maximum: '5.250000',
    sampleCount: 30,
    intervalMs: 200,
  },
  {
    key: 'current-draw',
    name: 'Current Draw',
    unit: 'A',
    minimum: '0.450000',
    maximum: '0.550000',
    sampleCount: 30,
    intervalMs: 200,
  },
  {
    key: 'case-temperature',
    name: 'Case Temperature',
    unit: '°C',
    minimum: '20.000000',
    maximum: '60.000000',
    sampleCount: 30,
    intervalMs: 200,
  },
];

export interface DemoPlanVersionSeed {
  versionNumber: number;
  steps: readonly DemoPlanStepSeed[];
}

/**
 * The published demo history. Version 2 keeps the same logical step ids and
 * only widens the Current Draw maximum, exactly as the demo script expects.
 */
export const DEMO_PLAN_VERSIONS: readonly DemoPlanVersionSeed[] = [
  { versionNumber: 1, steps: DEMO_PLAN_STEPS_V1 },
  {
    versionNumber: 2,
    steps: DEMO_PLAN_STEPS_V1.map((step) =>
      step.key === 'current-draw'
        ? { ...step, maximum: '0.650000' }
        : { ...step },
    ),
  },
];

export interface DemoRunSeed {
  /** Stable idempotency key; also identifies the run during a repeat seed. */
  idempotencyKey: string;
  label: string;
  versionNumber: number;
  scenario: typeof RunScenario.NORMAL | typeof RunScenario.FORCED_FAILURE;
  seed: number;
  failureStepName: string | null;
  /** Stop after this many recorded samples and cancel the active step. */
  cancelAfterSampleCount: number | null;
  startedMinutesAgo: number;
}

/**
 * Deterministic history for the demo plan. The forced-failure run uses seed 42
 * and Current Draw, which produces exactly 0.600000 A at zero-based sample 14.
 * The partial run records the complete first step and 15 Current Draw samples
 * before cancellation.
 */
export const DEMO_RUNS: readonly DemoRunSeed[] = [
  {
    idempotencyKey: 'demo-seed:power-supply-validation:v1:cancelled',
    label: 'Partial cancelled v1',
    versionNumber: 1,
    scenario: RunScenario.NORMAL,
    seed: 42,
    failureStepName: null,
    cancelAfterSampleCount: 45,
    startedMinutesAgo: 300,
  },
  {
    idempotencyKey: 'demo-seed:power-supply-validation:v1:forced-failure',
    label: 'Forced failure v1',
    versionNumber: 1,
    scenario: RunScenario.FORCED_FAILURE,
    seed: 42,
    failureStepName: 'Current Draw',
    cancelAfterSampleCount: null,
    startedMinutesAgo: 240,
  },
  {
    idempotencyKey: 'demo-seed:power-supply-validation:v1:normal',
    label: 'Normal v1',
    versionNumber: 1,
    scenario: RunScenario.NORMAL,
    seed: 42,
    failureStepName: null,
    cancelAfterSampleCount: null,
    startedMinutesAgo: 180,
  },
  {
    idempotencyKey: 'demo-seed:power-supply-validation:v2:normal',
    label: 'Normal v2',
    versionNumber: 2,
    scenario: RunScenario.NORMAL,
    seed: 42,
    failureStepName: null,
    cancelAfterSampleCount: null,
    startedMinutesAgo: 60,
  },
];
