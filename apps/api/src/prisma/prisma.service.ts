import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { PrismaClient } from './generated/client.js';

/**
 * Prisma access point backed by the pg driver adapter. Connections are opened
 * lazily on the first query so that the API can start and report readiness even
 * while PostgreSQL is unavailable.
 */
@Injectable()
export class PrismaService extends PrismaClient implements OnModuleDestroy {
  constructor(@Inject(APP_CONFIG) config: AppConfig) {
    super({
      adapter: new PrismaPg({
        connectionString: config.databaseUrl,
        application_name: 'probedesk-api',
        connectionTimeoutMillis: 2000,
        idleTimeoutMillis: 30000,
        max: 10,
        query_timeout: 5000,
        statement_timeout: 5000,
      }),
    });
  }

  /** Lightweight readiness probe that never returns database details. */
  async ping(): Promise<void> {
    await this.$queryRaw`SELECT 1`;
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
