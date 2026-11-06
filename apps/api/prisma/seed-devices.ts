import { Role, type PrismaClient } from '../src/prisma/generated/client.js';
import { toDeviceSerialNumberKey } from '../src/devices/device-domain.js';
import {
  DEMO_DEVICES,
  DEMO_DEVICE_PROFILES,
  DEMO_PLANNER_EMAIL,
} from './seed-data.js';
import { DemoSeedConflictError } from './seed-demo-plan.js';

export interface DemoDeviceSeedSummary {
  created: number;
  existing: number;
  total: number;
}

const DEMO_DEVICE_SEED_LOCK_NAME = 'probedesk-demo-device-seed';
const TRANSACTION_OPTIONS = { timeout: 30_000, maxWait: 10_000 } as const;

/**
 * Adds the two fixed demo devices when they are absent.
 *
 * An existing fixture id is never updated, so a repeat seed preserves names,
 * serial numbers, descriptions and archive state edited by an operator. Before
 * creating a missing fixture the seed checks the canonical serial number; if
 * another device already owns it, the whole device transaction rolls back with
 * a safe conflict instead of creating a duplicate or overwriting the owner.
 */
export async function seedDemoDevices(
  prisma: PrismaClient,
): Promise<DemoDeviceSeedSummary> {
  return prisma.$transaction(async (tx) => {
    // Serialize concurrent CLI seeds. The lock is released at transaction end.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${DEMO_DEVICE_SEED_LOCK_NAME})::bigint)`;

    const planner = await tx.user.findUnique({
      where: { email: DEMO_PLANNER_EMAIL },
      select: { id: true, role: true },
    });

    if (!planner) {
      throw new DemoSeedConflictError(
        `The demo account ${DEMO_PLANNER_EMAIL} is missing. Run npm run demo:seed again.`,
      );
    }

    if (planner.role !== Role.PLANNER) {
      throw new DemoSeedConflictError(
        `The demo account ${DEMO_PLANNER_EMAIL} no longer has the ${Role.PLANNER} role. The seed never changes an existing account.`,
      );
    }

    const profile = await tx.deviceProfile.findUnique({
      where: { code: DEMO_DEVICE_PROFILES[0]!.code },
      select: { id: true },
    });

    if (!profile) {
      throw new DemoSeedConflictError(
        `The ${DEMO_DEVICE_PROFILES[0]!.code} device profile is missing. Run npm run demo:seed again after the profile step succeeds.`,
      );
    }

    let created = 0;

    for (const fixture of DEMO_DEVICES) {
      const existingFixture = await tx.device.findUnique({
        where: { id: fixture.id },
        select: { id: true },
      });

      if (existingFixture) {
        continue;
      }

      const serialNumberKey = toDeviceSerialNumberKey(fixture.serialNumber);
      const serialOwner = await tx.device.findUnique({
        where: {
          deviceProfileId_serialNumberKey: {
            deviceProfileId: profile.id,
            serialNumberKey,
          },
        },
        select: { id: true },
      });

      if (serialOwner) {
        throw new DemoSeedConflictError(
          `The demo device serial number ${fixture.serialNumber} already belongs to device ${serialOwner.id}. The seed will not overwrite another device.`,
        );
      }

      try {
        await tx.device.create({
          data: {
            id: fixture.id,
            deviceProfileId: profile.id,
            createdById: planner.id,
            name: fixture.name,
            serialNumber: fixture.serialNumber,
            serialNumberKey,
            description: fixture.description,
          },
        });
      } catch (error) {
        if (isUniqueConstraintViolation(error)) {
          throw new DemoSeedConflictError(
            'A device with a fixed demo id or canonical serial number was created concurrently. Refusing to overwrite it.',
          );
        }
        throw error;
      }

      created += 1;
    }

    return {
      created,
      existing: DEMO_DEVICES.length - created,
      total: DEMO_DEVICES.length,
    };
  }, TRANSACTION_OPTIONS);
}

function isUniqueConstraintViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return (error as { code?: unknown }).code === 'P2002';
}
