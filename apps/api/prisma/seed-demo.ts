import type { PrismaClient } from '../src/prisma/generated/client.js';
import {
  seedDemoDeviceProfiles,
  type DemoDeviceProfileSeedSummary,
} from './seed-device-profiles.js';
import {
  seedDemoPowerSupplyPlan,
  type DemoPlanSeedSummary,
} from './seed-demo-plan.js';
import { seedDemoUsers, type DemoSeedSummary } from './seed-users.js';

export interface DemoDataSeedSummary {
  users: DemoSeedSummary;
  profiles: DemoDeviceProfileSeedSummary;
  plan: DemoPlanSeedSummary;
}

/**
 * The single entry point shared by `npm run demo:seed` and its integration
 * test. It is additive: users and the device profile are only inserted when
 * absent, and plan/run history is identified by stable markers before any write.
 */
export async function runDemoSeed(
  prisma: PrismaClient,
): Promise<DemoDataSeedSummary> {
  const users = await seedDemoUsers(prisma);
  const profiles = await seedDemoDeviceProfiles(prisma);
  const plan = await seedDemoPowerSupplyPlan(prisma);

  return { users, profiles, plan };
}
