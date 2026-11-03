import { config as loadDotEnv } from 'dotenv';
import { defineConfig } from 'prisma/config';

// Prisma CLI commands run from apps/api. Accept a workspace-local .env first
// and fall back to the repository root .env used by the rest of the project.
loadDotEnv({
  path: ['.env', '../../.env'],
  quiet: true,
});

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
  },
  datasource: {
    // Left undefined when the variable is absent so `prisma generate` can run
    // without database configuration. Migration commands report a clear error.
    url: process.env.DATABASE_URL,
  },
});
