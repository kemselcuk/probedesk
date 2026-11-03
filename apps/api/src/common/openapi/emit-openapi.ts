import { writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { AppModule } from '../../app.module.js';
import { configureApp } from '../bootstrap/configure-app.js';
import { loadDotEnv, loadEnv } from '../../config/env.js';
import { createOpenApiDocument } from './openapi.js';

/**
 * Emits apps/api/openapi.json without opening a database connection. A
 * placeholder DATABASE_URL is used only when the environment has none so that
 * configuration validation can run in a clean checkout; Prisma is never
 * queried by the document generator.
 */
loadDotEnv();

if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL =
    'postgresql://probedesk:probedesk@127.0.0.1:5432/probedesk?schema=public';
}

loadEnv(process.env);

const app = await NestFactory.create(AppModule, { logger: false });
configureApp(app);

const document = createOpenApiDocument(app);
const outputPath = fileURLToPath(
  new URL('../../../openapi.json', import.meta.url),
);

await writeFile(outputPath, `${JSON.stringify(document, null, 2)}\n`, 'utf8');
await app.close();

console.log(`Wrote OpenAPI document to ${outputPath}`);
