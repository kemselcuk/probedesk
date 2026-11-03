import { Prisma } from '../../prisma/generated/client.js';
import { isDatabaseInfrastructureError } from './prisma-error.js';

describe('isDatabaseInfrastructureError', () => {
  it('recognises Prisma connection and initialization failures', () => {
    expect(
      isDatabaseInfrastructureError(
        new Prisma.PrismaClientInitializationError(
          'Can not reach the database.',
          '7.10.1',
        ),
      ),
    ).toBe(true);

    for (const code of ['P1000', 'P1001', 'P1002', 'P1017', 'P2021', 'P2024']) {
      expect(
        isDatabaseInfrastructureError(
          new Prisma.PrismaClientKnownRequestError('database failure', {
            code,
            clientVersion: '7.10.1',
          }),
        ),
      ).toBe(true);
    }
  });

  it('does not classify request or programming errors as infrastructure', () => {
    for (const code of ['P2002', 'P2003', 'P2025']) {
      expect(
        isDatabaseInfrastructureError(
          new Prisma.PrismaClientKnownRequestError('request failure', {
            code,
            clientVersion: '7.10.1',
          }),
        ),
      ).toBe(false);
    }

    expect(
      isDatabaseInfrastructureError(
        new Prisma.PrismaClientValidationError('Invalid query arguments.', {
          clientVersion: '7.10.1',
        }),
      ),
    ).toBe(false);
    expect(isDatabaseInfrastructureError(new Error('Unexpected bug'))).toBe(
      false,
    );
    expect(isDatabaseInfrastructureError('not an error')).toBe(false);
  });
});
