import { randomUUID } from 'node:crypto';
import type { PrismaClient, Role } from '../../src/prisma/generated/client.js';
import { createTestUser, type TestUser } from './auth-helpers.js';

export const DEVICE_TEST_EMAIL_PREFIX = 'devices-api-e2e-';
export const DEVICE_TEST_PROFILE_CODE_PREFIX = 'devices-api-e2e-profile-';

export function uniqueDeviceTestEmail(): string {
  return `${DEVICE_TEST_EMAIL_PREFIX}${randomUUID()}@example.test`;
}

export async function createDeviceTestUser(
  prisma: PrismaClient,
  role: Role,
): Promise<TestUser> {
  return createTestUser(prisma, {
    role,
    email: uniqueDeviceTestEmail(),
    password: 'Devices-E2E-Password-9',
  });
}

export async function createDeviceTestProfile(prisma: PrismaClient): Promise<{
  id: string;
  code: string;
  name: string;
  description: string | null;
}> {
  return prisma.deviceProfile.create({
    data: {
      code: `${DEVICE_TEST_PROFILE_CODE_PREFIX}${randomUUID()}`,
      name: 'Devices E2E Profile',
      description: 'Fixture profile for device API tests',
    },
    select: { id: true, code: true, name: true, description: true },
  });
}

/**
 * Removes every row created by the device suites. Device rows restrict both
 * their creator and profile, so they are deleted before sessions/users/profile.
 */
export async function deleteDeviceTestData(
  prisma: PrismaClient,
): Promise<void> {
  const users = await prisma.user.findMany({
    where: { email: { startsWith: DEVICE_TEST_EMAIL_PREFIX } },
    select: { id: true },
  });
  const userIds = users.map((user) => user.id);

  await prisma.device.deleteMany({
    where: { createdById: { in: userIds } },
  });
  await prisma.session.deleteMany({ where: { userId: { in: userIds } } });
  await prisma.user.deleteMany({ where: { id: { in: userIds } } });
  await prisma.deviceProfile.deleteMany({
    where: { code: { startsWith: DEVICE_TEST_PROFILE_CODE_PREFIX } },
  });
}
