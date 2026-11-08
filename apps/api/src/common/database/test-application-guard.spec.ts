import { describe, expect, it } from 'vitest';
import { requireIsolatedApplicationDatabase } from './test-database-guard.js';
const testUrl = 'postgresql://test:test@127.0.0.1:5433/probedesk_guard_test';
const safe = {
  NODE_ENV: 'test',
  DATABASE_URL: testUrl,
  TEST_DATABASE_URL: testUrl,
};
describe('test application database guard', () => {
  it('accepts an explicitly mapped test target', () =>
    expect(requireIsolatedApplicationDatabase(safe).pathname).toBe(
      '/probedesk_guard_test',
    ));
  it.each([
    { ...safe, NODE_ENV: 'development' },
    { ...safe, DATABASE_URL: undefined },
    { ...safe, TEST_DATABASE_URL: undefined },
    {
      ...safe,
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:5434/probedesk',
    },
    {
      ...safe,
      DATABASE_URL: 'postgresql://test:test@remote:5433/probedesk_guard_test',
      TEST_DATABASE_URL:
        'postgresql://test:test@remote:5433/probedesk_guard_test',
    },
    {
      ...safe,
      DATABASE_URL: 'postgresql://test:test@127.0.0.1:5433/probedesk',
      TEST_DATABASE_URL: 'postgresql://test:test@127.0.0.1:5433/probedesk',
    },
  ])('rejects an unsafe application target', (environment) =>
    expect(() => requireIsolatedApplicationDatabase(environment)).toThrow(),
  );
});
