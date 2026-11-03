import { Inject, Injectable, type OnModuleDestroy } from '@nestjs/common';
import { PrismaPg } from '@prisma/adapter-pg';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { PrismaClient } from './generated/client.js';
import { EXPECTED_MIGRATIONS } from './migration-manifest.js';

interface AppliedMigrationRow {
  migration_name: string;
  finished_at: Date | string | null;
  rolled_back_at: Date | string | null;
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
   *
   * The comparison is by migration name against the checked-in manifest, not by
   * count: a database with only the first of two migrations applied is not
   * ready. Any unfinished or rolled-back row also counts as not applied.
   */
  async assertMigrationsApplied(): Promise<void> {
    const rows = await this.$queryRaw<AppliedMigrationRow[]>`
      SELECT "migration_name", "finished_at", "rolled_back_at"
      FROM "_prisma_migrations"
    `;

    const applied = new Set(
      rows
        .filter(
          (row) => row.finished_at !== null && row.rolled_back_at === null,
        )
        .map((row) => row.migration_name),
    );
    const hasUnfinished = rows.some(
      (row) => row.finished_at === null || row.rolled_back_at !== null,
    );

    if (
      hasUnfinished ||
      EXPECTED_MIGRATIONS.some((name) => !applied.has(name))
    ) {
      throw new MigrationsNotAppliedError();
    }
  }

  async onModuleDestroy(): Promise<void> {
    await this.$disconnect();
  }
}
