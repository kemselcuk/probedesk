import { Injectable } from '@nestjs/common';
import {
  LOGIN_RATE_LIMIT_MAX_FAILURES,
  LOGIN_RATE_LIMIT_WINDOW_MS,
} from './auth.constants.js';

export interface LoginRateLimitStatus {
  limited: boolean;
  retryAfterSeconds: number;
}

/**
 * In-memory failed-login throttle. The application contract runs a single API
 * process, so a database-backed counter is intentionally unnecessary. Entries
 * are keyed by client address and normalised email; successful login clears the
 * key. Account existence is never reflected in the key or the response.
 */
@Injectable()
export class LoginRateLimiter {
  private readonly failures = new Map<string, number[]>();

  check(key: string, now = Date.now()): LoginRateLimitStatus {
    const timestamps = this.activeTimestamps(key, now);

    if (timestamps.length < LOGIN_RATE_LIMIT_MAX_FAILURES) {
      return { limited: false, retryAfterSeconds: 0 };
    }

    const oldest = timestamps[0] ?? now;
    return {
      limited: true,
      retryAfterSeconds: Math.max(
        1,
        Math.ceil((oldest + LOGIN_RATE_LIMIT_WINDOW_MS - now) / 1000),
      ),
    };
  }

  recordFailure(key: string, now = Date.now()): void {
    const timestamps = this.activeTimestamps(key, now);
    timestamps.push(now);
    this.failures.set(key, timestamps);
    this.pruneWhenLarge(now);
  }

  reset(key: string): void {
    this.failures.delete(key);
  }

  private activeTimestamps(key: string, now: number): number[] {
    const timestamps = (this.failures.get(key) ?? []).filter(
      (timestamp) => now - timestamp < LOGIN_RATE_LIMIT_WINDOW_MS,
    );

    if (timestamps.length === 0) {
      this.failures.delete(key);
    } else {
      this.failures.set(key, timestamps);
    }

    return timestamps;
  }

  private pruneWhenLarge(now: number): void {
    if (this.failures.size <= 10_000) {
      return;
    }

    for (const key of this.failures.keys()) {
      this.activeTimestamps(key, now);
    }
  }
}
