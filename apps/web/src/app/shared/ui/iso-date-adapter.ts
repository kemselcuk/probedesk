import { Injectable } from '@angular/core';
import { NativeDateAdapter } from '@angular/material/core';

/** Date-only filters use local calendar parts, never UTC-to-local conversion. */
export function parseCalendarDate(value: string): Date | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(0);
  date.setFullYear(year, month - 1, day);
  date.setHours(0, 0, 0, 0);
  return date.getFullYear() === year && date.getMonth() === month - 1 && date.getDate() === day
    ? date
    : null;
}

export function formatCalendarDate(date: Date | null): string {
  if (date === null || !Number.isFinite(date.getTime())) return '';
  return `${String(date.getFullYear()).padStart(4, '0')}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

@Injectable()
export class IsoDateAdapter extends NativeDateAdapter {
  override parse(value: unknown): Date | null {
    if (value === null || value === '') return null;
    if (value instanceof Date) return this.clone(value);
    return typeof value === 'string'
      ? (parseCalendarDate(value) ?? this.invalid())
      : this.invalid();
  }

  override format(date: Date, displayFormat: object | string): string {
    return displayFormat === 'iso-date'
      ? formatCalendarDate(date)
      : super.format(date, displayFormat);
  }
}
