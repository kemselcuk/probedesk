import { hashPassword, verifyPassword } from './password.js';

describe('password hashing', () => {
  it('uses Argon2id with the documented parameters', async () => {
    const hash = await hashPassword('Correct-Horse-Battery-9');

    expect(hash).toMatch(/^\$argon2id\$v=19\$m=19456,t=2,p=1\$/);
    expect(hash).not.toContain('Correct-Horse-Battery-9');
    expect(await verifyPassword(hash, 'Correct-Horse-Battery-9')).toBe(true);
    expect(await verifyPassword(hash, 'wrong-password')).toBe(false);
  });

  it('returns false instead of throwing for a malformed digest', async () => {
    expect(await verifyPassword('not-a-password-hash', 'anything')).toBe(false);
  });
});
