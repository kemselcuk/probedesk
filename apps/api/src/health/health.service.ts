import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../common/errors/api.exception.js';
import { isDatabaseInfrastructureError } from '../common/database/prisma-error.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface LivenessStatus {
  status: 'ok';
}

export interface ReadinessStatus {
  status: 'ok';
  checks: {
    database: 'ok';
    migrations: 'ok';
  };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  getLiveness(): LivenessStatus {
    return { status: 'ok' };
  }

  /**
   * Readiness requires both a reachable database and a fully applied migration
   * state. Failures are reported with fixed messages and safe detail flags; SQL,
   * connection strings and driver errors never leave this method.
   */
  async getReadiness(): Promise<ReadinessStatus> {
    try {
      await this.prisma.ping();
    } catch {
      this.logger.warn('Readiness check failed: database is unavailable.');
      throw serviceUnavailable({ database: 'unavailable' });
    }

    try {
      await this.prisma.assertMigrationsApplied();
    } catch (error) {
      if (isDatabaseInfrastructureError(error)) {
        this.logger.warn('Readiness check failed: database is unavailable.');
        throw serviceUnavailable({ database: 'unavailable' });
      }

      this.logger.warn(
        'Readiness check failed: database migrations are not applied.',
      );
      throw serviceUnavailable({ database: 'ok', migrations: 'pending' });
    }

    return { status: 'ok', checks: { database: 'ok', migrations: 'ok' } };
  }
}

function serviceUnavailable(
  checks: Readonly<Record<string, string>>,
): ApiException {
  return new ApiException(
    HttpStatus.SERVICE_UNAVAILABLE,
    'SERVICE_UNAVAILABLE',
    'The service is not ready.',
    { details: { checks } },
  );
}
