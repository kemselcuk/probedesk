import { Role } from '../src/prisma/generated/client.js';

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
