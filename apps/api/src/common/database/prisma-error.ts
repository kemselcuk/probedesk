import { Prisma } from '../../prisma/generated/client.js';

/**
 * Prisma error codes that describe an unavailable, misconfigured or unmigrated
 * database rather than a defect in the calling code. Mapping only this narrow
 * set keeps programming errors (for example an unknown column in a hand-written
 * query) visible as 500s while clients can retry infrastructure failures.
 */
const INFRASTRUCTURE_ERROR_CODES: ReadonlySet<string> = new Set([
  // Connection, authentication, timeout and server-shutdown failures.
  'P1000',
  'P1001',
  'P1002',
  'P1003',
  'P1008',
  'P1010',
  'P1017',
  // Missing schema objects mean migrations have not been applied.
  'P2021',
  'P2022',
  // Connection pool exhaustion is an infrastructure condition.
  'P2024',
  'P2037',
]);

/**
 * True only for errors that prove the database itself is not ready. The check
 * uses Prisma's error classes and stable codes, never message text.
 */
export function isDatabaseInfrastructureError(error: unknown): boolean {
  if (error instanceof Prisma.PrismaClientInitializationError) {
    return true;
  }

  if (error instanceof Prisma.PrismaClientKnownRequestError) {
    return INFRASTRUCTURE_ERROR_CODES.has(error.code);
  }

  return false;
}
