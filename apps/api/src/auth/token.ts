import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

const SHA256_HEX_PATTERN = /^[0-9a-f]{64}$/;

/**
 * Creates an opaque, URL-safe bearer value with 256 bits of entropy. The raw
 * value is returned to the browser once and never stored by the API.
 */
export function generateOpaqueToken(): string {
  return randomBytes(32).toString('base64url');
}

/** Stores only a deterministic SHA-256 digest of an opaque token. */
export function hashToken(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex');
}

/**
 * Compares a freshly hashed token with a stored digest without leaking byte
 * positions through timing. Malformed or absent digests never match.
 */
export function tokenHashMatches(
  candidateHash: string,
  storedHash: string | null | undefined,
): boolean {
  if (
    !storedHash ||
    !SHA256_HEX_PATTERN.test(candidateHash) ||
    !SHA256_HEX_PATTERN.test(storedHash)
  ) {
    return false;
  }

  return timingSafeEqual(
    Buffer.from(candidateHash, 'hex'),
    Buffer.from(storedHash, 'hex'),
  );
}
