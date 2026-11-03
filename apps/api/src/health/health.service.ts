import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { ApiException } from '../common/errors/api.exception.js';
import { PrismaService } from '../prisma/prisma.service.js';

export interface LivenessStatus {
  status: 'ok';
}

export interface ReadinessStatus {
  status: 'ok';
  checks: {
    database: 'ok';
  };
}

@Injectable()
export class HealthService {
  private readonly logger = new Logger(HealthService.name);

  constructor(private readonly prisma: PrismaService) {}

  getLiveness(): LivenessStatus {
    return { status: 'ok' };
  }

  async getReadiness(): Promise<ReadinessStatus> {
    try {
      await this.prisma.ping();
      return { status: 'ok', checks: { database: 'ok' } };
    } catch {
      this.logger.warn('Readiness check failed: database is unavailable.');

      throw new ApiException(
        HttpStatus.SERVICE_UNAVAILABLE,
        'SERVICE_UNAVAILABLE',
        'The service is not ready.',
        {
          details: {
            checks: {
              database: 'unavailable',
            },
          },
        },
      );
    }
  }
}
