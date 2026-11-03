import { LoginRateLimiter } from './login-rate-limiter.js';

describe('LoginRateLimiter', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('blocks the eleventh failure in a fixed 15 minute window', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-03T10:00:00Z'));
    const limiter = new LoginRateLimiter();
    const key = '127.0.0.1|demo@example.test';

    for (let attempt = 0; attempt < 10; attempt += 1) {
      expect(limiter.check(key).limited).toBe(false);
      limiter.recordFailure(key);
    }

    const status = limiter.check(key);
    expect(status.limited).toBe(true);
    expect(status.retryAfterSeconds).toBe(15 * 60);

    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(limiter.check(key).limited).toBe(false);
  });

  it('clears failures after a successful login', () => {
    const limiter = new LoginRateLimiter();
    const key = '127.0.0.1|demo@example.test';

    for (let attempt = 0; attempt < 10; attempt += 1) {
      limiter.recordFailure(key);
    }
    expect(limiter.check(key).limited).toBe(true);

    limiter.reset(key);
    expect(limiter.check(key).limited).toBe(false);
  });

  it('supports an aggregate limit for one client address', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-11-03T10:00:00Z'));
    const limiter = new LoginRateLimiter();
    const address = '127.0.0.1';
    const maximum = 50;

    for (let attempt = 0; attempt < maximum; attempt += 1) {
      expect(limiter.check(address, Date.now(), maximum).limited).toBe(false);
      limiter.recordFailure(address);
    }

    const status = limiter.check(address, Date.now(), maximum);
    expect(status.limited).toBe(true);
    expect(status.retryAfterSeconds).toBe(15 * 60);

    vi.advanceTimersByTime(15 * 60 * 1000);
    expect(limiter.check(address, Date.now(), maximum).limited).toBe(false);
  });
});
