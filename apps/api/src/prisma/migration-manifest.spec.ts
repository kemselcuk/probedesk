import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { EXPECTED_MIGRATIONS } from './migration-manifest.js';

describe('EXPECTED_MIGRATIONS', () => {
  it('lists exactly the migration directories registered in prisma/migrations', () => {
    const migrationsDirectory = fileURLToPath(
      new URL('../../prisma/migrations', import.meta.url),
    );

    const registered = readdirSync(migrationsDirectory, {
      withFileTypes: true,
    })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();

    expect([...EXPECTED_MIGRATIONS].sort()).toEqual(registered);
  });
});
