import { generateOpaqueToken, hashToken, tokenHashMatches } from './token.js';

describe('opaque session tokens', () => {
  it('creates 256 bits of URL-safe randomness', () => {
    const token = generateOpaqueToken();

    expect(token).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(Buffer.from(token, 'base64url')).toHaveLength(32);
    expect(generateOpaqueToken()).not.toBe(token);
  });

  it('stores only a SHA-256 hex digest', () => {
    const token = generateOpaqueToken();
    const digest = hashToken(token);

    expect(digest).toMatch(/^[0-9a-f]{64}$/);
    expect(digest).not.toBe(token);
    expect(hashToken(token)).toBe(digest);
  });

  it('matches equal digests and rejects wrong or missing values', () => {
    const token = generateOpaqueToken();
    const digest = hashToken(token);

    expect(tokenHashMatches(hashToken(token), digest)).toBe(true);
    expect(tokenHashMatches(hashToken(`${token}x`), digest)).toBe(false);
    expect(tokenHashMatches('not-a-digest', digest)).toBe(false);
    expect(tokenHashMatches(hashToken(token), null)).toBe(false);
  });
});
