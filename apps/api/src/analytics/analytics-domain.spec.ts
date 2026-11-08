import { ValidationFailedException } from '../common/errors/validation.exception.js';
import { RunScenario } from '../prisma/generated/client.js';
import {
  ANALYTICS_MAX_RANGE_DAYS,
  enumerateUtcDates,
  resolveAnalyticsFilters,
} from './analytics-domain.js';
import type { AnalyticsOverviewQueryDto } from './dto/analytics-overview-query.dto.js';

function query(
  overrides: Partial<AnalyticsOverviewQueryDto> = {},
): AnalyticsOverviewQueryDto {
  return {
    from: '2026-10-01T00:00:00.000Z',
    to: '2026-10-04T00:00:00.000Z',
    ...overrides,
  } as AnalyticsOverviewQueryDto;
}

function expectInvalid(input: AnalyticsOverviewQueryDto, field: string): void {
  try {
    resolveAnalyticsFilters(input);
    throw new Error('Expected the filter resolution to fail.');
  } catch (error) {
    expect(error).toBeInstanceOf(ValidationFailedException);
    const exception = error as ValidationFailedException;
    expect(exception.fieldErrors?.map((entry) => entry.path)).toContain(field);
  }
}

describe('analytics filter resolution', () => {
  it('canonicalises UTC instants, UUIDs, batch key and scenario', () => {
    const resolved = resolveAnalyticsFilters(
      query({
        from: '2026-10-01T03:00:00+03:00',
        to: '2026-10-04T02:30:00.000+02:30',
        planId: 'AAAAAAAA-AAAA-4AAA-8AAA-AAAAAAAAAAAA',
        planVersionId: 'BBBBBBBB-BBBB-4BBB-8BBB-BBBBBBBBBBBB',
        deviceId: 'CCCCCCCC-CCCC-4CCC-8CCC-CCCCCCCCCCCC',
        batchNumber: '  batch-2026-001  ',
        scenario: RunScenario.FORCED_FAILURE,
      }),
    );

    expect(resolved.from.toISOString()).toBe('2026-10-01T00:00:00.000Z');
    expect(resolved.to.toISOString()).toBe('2026-10-04T00:00:00.000Z');
    expect(resolved.planId).toBe('aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa');
    expect(resolved.planVersionId).toBe('bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb');
    expect(resolved.deviceId).toBe('cccccccc-cccc-4ccc-8ccc-cccccccccccc');
    expect(resolved.batchNumberKey).toBe('BATCH-2026-001');
    expect(resolved.scenario).toBe(RunScenario.FORCED_FAILURE);
  });

  it('keeps absent optional filters null rather than inventing values', () => {
    const resolved = resolveAnalyticsFilters(query());

    expect(resolved.planId).toBeNull();
    expect(resolved.planVersionId).toBeNull();
    expect(resolved.deviceId).toBeNull();
    expect(resolved.batchNumberKey).toBeNull();
    expect(resolved.scenario).toBeNull();
  });

  it('rejects an empty or inverted range at the to field', () => {
    expectInvalid(query({ to: '2026-10-01T00:00:00.000Z' }), 'to');
    expectInvalid(query({ to: '2026-09-30T23:59:59.999Z' }), 'to');
  });

  it('accepts exactly 366 days and rejects one millisecond more', () => {
    const accepted = resolveAnalyticsFilters(
      query({
        from: '2025-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.000Z',
      }),
    );

    expect(accepted.to.getTime() - accepted.from.getTime()).toBe(
      ANALYTICS_MAX_RANGE_DAYS * 86_400_000,
    );

    expectInvalid(
      query({
        from: '2025-01-01T00:00:00.000Z',
        to: '2026-01-02T00:00:00.001Z',
      }),
      'to',
    );
  });

  it('rejects an unparseable instant', () => {
    expectInvalid(query({ from: 'not-a-date' }), 'from');
  });
});

describe('analytics UTC day expansion', () => {
  it('includes both partial boundary days and every day between them', () => {
    expect(
      enumerateUtcDates(
        new Date('2026-10-20T06:00:00.000Z'),
        new Date('2026-10-23T18:00:00.000Z'),
      ),
    ).toEqual(['2026-10-20', '2026-10-21', '2026-10-22', '2026-10-23']);
  });

  it('does not include the day that starts exactly at the exclusive bound', () => {
    expect(
      enumerateUtcDates(
        new Date('2026-10-20T00:00:00.000Z'),
        new Date('2026-10-22T00:00:00.000Z'),
      ),
    ).toEqual(['2026-10-20', '2026-10-21']);
  });

  it('includes the final day for a bound one millisecond after midnight', () => {
    expect(
      enumerateUtcDates(
        new Date('2026-10-20T00:00:00.000Z'),
        new Date('2026-10-22T00:00:00.001Z'),
      ),
    ).toEqual(['2026-10-20', '2026-10-21', '2026-10-22']);
  });

  it('crosses a UTC year boundary', () => {
    expect(
      enumerateUtcDates(
        new Date('2026-12-31T23:00:00.000Z'),
        new Date('2027-01-02T01:00:00.000Z'),
      ),
    ).toEqual(['2026-12-31', '2027-01-01', '2027-01-02']);
  });
});
