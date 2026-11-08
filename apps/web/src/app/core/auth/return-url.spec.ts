import { describe, expect, it } from 'vitest';
import { sanitizeReturnUrl } from './return-url';

describe('sanitizeReturnUrl', () => {
  it('accepts same-origin application paths with query and fragment', () => {
    expect(sanitizeReturnUrl('/runs?status=FAILED#top')).toBe(
      '/runs?status=FAILED#top',
    );
  });

  it.each([
    null,
    undefined,
    '',
    'https://evil.example/steal',
    '//evil.example/steal',
    '///evil.example/steal',
    '/\\evil.example/steal',
    '/..//evil.example/steal',
    'javascript:alert(1)',
    '/login',
    '/login?returnUrl=%2Fplans',
  ])('rejects an unsafe or looping destination: %s', (value) => {
    expect(sanitizeReturnUrl(value)).toBe('/overview');
  });
});
