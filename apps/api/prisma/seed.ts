import { PrismaPg } from '@prisma/adapter-pg';
import { loadDotEnv, loadEnv } from '../src/config/env.js';
import { PrismaClient } from '../src/prisma/generated/client.js';
import { runDemoSeed } from './seed-demo.js';
import { DemoSeedConflictError } from './seed-demo-plan.js';

/**
 * Demo data seed. Run from apps/api with `npm run demo:seed`.
 *
 * The seed is additive and idempotent: it never resets plans, runs or existing
 * users, and a repeat run only fills in missing fixture rows. The destructive
 * reset is a separate explicitly guarded script (`prisma/seed-reset.ts`).
 */
loadDotEnv();

const config = loadEnv(process.env);

if (config.nodeEnv === 'production') {
  console.error(
    'Refusing to seed demo data with NODE_ENV=production. The documented demo passwords are for local use only.',
  );
  process.exitCode = 1;
} else {
  const prisma = new PrismaClient({
    adapter: new PrismaPg({
      connectionString: config.databaseUrl,
      application_name: 'probedesk-demo-seed',
      connectionTimeoutMillis: 2000,
    }),
  });

  try {
    const summary = await runDemoSeed(prisma);

    console.log(
      `Demo users ready: ${summary.users.total} accounts (${summary.users.created} created, ${summary.users.existing} already present).`,
    );
    console.log(
      `Demo device profiles ready: ${summary.profiles.total} profiles (${summary.profiles.created} created, ${summary.profiles.existing} already present).`,
    );
    console.log(
      `Demo plan ready: ${summary.plan.name} (${summary.plan.createdPlan ? 'created' : 'existing'}), ${summary.plan.versions.length} published versions, ${summary.plan.runs.length} runs (${summary.plan.createdRuns} created, ${summary.plan.existingRuns} already present).`,
    );

    for (const run of summary.plan.runs) {
      console.log(
        `  - ${run.label}: ${run.status}/${run.outcome ?? '-'} (${run.created ? 'created' : 'existing'})`,
      );
    }
  } catch (error) {
    if (error instanceof DemoSeedConflictError) {
      console.error(`Demo seed conflict: ${error.message}`);
    } else {
      // Never print driver errors: they can contain the connection string.
      console.error(
        'Demo seed failed. Check DATABASE_URL and apply migrations before retrying.',
      );
    }
    process.exitCode = 1;
  } finally {
    await prisma.$disconnect();
  }
}
