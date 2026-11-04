import type { PrismaClient } from '../src/prisma/generated/client.js';
import { DEMO_DEVICE_PROFILES } from './seed-data.js';

export interface DemoDeviceProfileSeedSummary {
  created: number;
  existing: number;
  total: number;
}

/**
 * Creates the demo device profile when its stable code is absent. Existing rows
 * are never updated so re-running the seed cannot silently change a profile an
 * operator has edited.
 */
export async function seedDemoDeviceProfiles(
  prisma: PrismaClient,
): Promise<DemoDeviceProfileSeedSummary> {
  let created = 0;

  for (const profile of DEMO_DEVICE_PROFILES) {
    const existing = await prisma.deviceProfile.findUnique({
      where: { code: profile.code },
      select: { id: true },
    });
    if (existing !== null) {
      continue;
    }

    try {
      await prisma.deviceProfile.create({
        data: {
          code: profile.code,
          name: profile.name,
          description: profile.description,
        },
      });
      created += 1;
    } catch (error) {
      // A concurrent seed may have inserted the same code first. Treat that as
      // an existing profile instead of overwriting it.
      if (!isUniqueConstraintViolation(error)) {
        throw error;
      }
    }
  }

  return {
    created,
    existing: DEMO_DEVICE_PROFILES.length - created,
    total: DEMO_DEVICE_PROFILES.length,
  };
}

function isUniqueConstraintViolation(error: unknown): boolean {
  if (typeof error !== 'object' || error === null || !('code' in error)) {
    return false;
  }

  return (error as { code?: unknown }).code === 'P2002';
}
