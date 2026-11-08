import type { Params } from '@angular/router';
import type { Overview, OverviewQuery } from './analytics-api';

export function defaultOverviewQuery(now = new Date()): OverviewQuery {
  const to = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1);
  return { from: new Date(to - 30 * 86_400_000).toISOString(), to: new Date(to).toISOString() };
}
export function historyParams(data: Overview, extra: Params = {}): Params {
  const filters = data.filters;
  return {
    ...Object.fromEntries(Object.entries(filters).filter(([, value]) => value !== null)),
    ...extra,
  };
}
export function historyDayParams(data: Overview, date: string): Params {
  const start = Date.parse(date + 'T00:00:00.000Z');
  return historyParams(data, {
    from: new Date(Math.max(start, Date.parse(data.filters.from))).toISOString(),
    to: new Date(Math.min(start + 86_400_000, Date.parse(data.filters.to))).toISOString(),
  });
}
