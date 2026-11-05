import { TestBed } from '@angular/core/testing';
import { describe, expect, it } from 'vitest';
import { formatCalendarDate, IsoDateAdapter, parseCalendarDate } from './iso-date-adapter';

describe('date-only calendar filters', () => {
  it('round-trips calendar dates without shifting across local UTC offsets', () => {
    for (const value of ['2026-01-01', '2026-03-29', '2026-10-25', '2024-02-29']) {
      const date = parseCalendarDate(value);
      expect(date).not.toBeNull();
      expect(formatCalendarDate(date)).toBe(value);
      expect(date?.getHours()).toBe(0);
    }
  });

  it('rejects impossible or ambiguous typed dates instead of rolling them over', () => {
    const adapter = TestBed.runInInjectionContext(() => new IsoDateAdapter());
    for (const value of ['2026-02-29', '2026-02-30', '2026-13-01', '11/05/2026', 'garbage']) {
      expect(parseCalendarDate(value)).toBeNull();
      const parsed = adapter.parse(value);
      expect(parsed).not.toBeNull();
      expect(adapter.isValid(parsed!)).toBe(false);
    }
    expect(adapter.parse('')).toBeNull();
  });
});
