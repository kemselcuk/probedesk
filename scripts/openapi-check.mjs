#!/usr/bin/env node
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const committedDocument = join(root, 'apps/api/openapi.json');
const committedSchema = join(root, 'packages/api-client/src/schema.ts');

function run(command, args) {
  return execFileSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    stdio: 'pipe',
    env: { ...process.env, npm_config_audit: 'false', npm_config_fund: 'false' },
  });
}

function fail(message) {
  console.error(`\nOpenAPI drift check failed: ${message}\n`);
  process.exit(1);
}

let tempDirectory;
try {
  // The generated Prisma client is required purely for TypeScript imports in
  // the Nest application; no database connection is opened by the emitter.
  run('npm', ['run', 'db:generate', '--workspace', 'apps/api']);

  let committedDocumentText;
  try {
    committedDocumentText = readFileSync(committedDocument, 'utf8');
  } catch {
    fail(
      'apps/api/openapi.json is missing. Run `npm run openapi:emit` and commit the result.',
    );
  }

  // Regenerating must reproduce the committed document byte for byte.
  run('npm', ['run', 'openapi:emit', '--workspace', 'apps/api']);
  const emittedDocumentText = readFileSync(committedDocument, 'utf8');
  if (committedDocumentText !== emittedDocumentText) {
    fail(
      'apps/api/openapi.json does not match the application. Review the contract change, then commit the regenerated document and client types.',
    );
  }

  tempDirectory = mkdtempSync(join(tmpdir(), 'probedesk-openapi-'));
  const generatedSchema = join(tempDirectory, 'schema.ts');
  run('npx', [
    '--no-install',
    'openapi-typescript',
    committedDocument,
    '-o',
    generatedSchema,
  ]);

  let expectedSchema;
  try {
    expectedSchema = readFileSync(committedSchema, 'utf8');
  } catch {
    fail(
      'packages/api-client/src/schema.ts is missing. Run `npm run openapi:generate` and commit the result.',
    );
  }

  if (expectedSchema !== readFileSync(generatedSchema, 'utf8')) {
    fail(
      'packages/api-client/src/schema.ts is out of date with apps/api/openapi.json. Run `npm run openapi:generate` and commit the result.',
    );
  }

  console.log(
    'OpenAPI contract is current: apps/api/openapi.json and packages/api-client/src/schema.ts match the application.',
  );
} finally {
  if (tempDirectory) {
    rmSync(tempDirectory, { recursive: true, force: true });
  }
}
