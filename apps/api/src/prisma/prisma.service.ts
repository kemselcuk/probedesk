import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { PrismaClient } from './generated/client.js';

interface MigrationStatus {
  applied: number;
  unfinished: number;
}

/**
 * Raised when `_prisma_migrations` shows that the schema is not fully migrated.
 * Readiness uses this to distinguish a reachable-but-unmigrated database from an
 * unreachable one without exposing SQL or connection details.
 */
export class MigrationsNotAppliedError extends Error {
  override readonly name = 'MigrationsNotAppliedError';

  constructor() {
    super('The database schema does not have a fully applied migration state.');
  }
}

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

  /**
   * Verifies that every registered migration finished successfully. A missing
   * `_prisma_migrations` table (an empty database) propagates its query error so
   * readiness reports the schema as not migrated.
   */
  async assertMigrationsApplied(): Promise<void> {
    const rows = await this.$queryRaw<MigrationStatus[]>`
      SELECT
        COUNT(*) FILTER (
          WHERE "finished_at" IS NOT NULL AND "rolled_back_at" IS NULL
        )::int AS "applied",
        COUNT(*) FILTER (
          WHERE "finished_at" IS NULL OR "rolled_back_at" IS NOT NULL
        )::int AS "unfinished"
      FROM "_prisma_migrations"
    `;

    const status = rows[0];
    if (!status || status.applied === 0 || status.unfinished > 0) {
      throw new MigrationsNotAppliedError();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
