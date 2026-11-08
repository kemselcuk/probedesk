import { describe, expect, it } from 'vitest';
import {
  RunOutcome,
  RunScenario,
  RunStatus,
  RunStepStatus,
} from '../prisma/generated/client.js';
import type { RunReportDto, RunReportStepDto } from './dto/run-report.dto.js';
import {
  neutraliseReportCsvText,
  quoteReportCsvField,
  REPORT_CSV_BOM,
  REPORT_CSV_HEADER,
  serialiseRunReportCsv,
} from './report-csv.js';

const RUN_ID = '6b6f0a1e-2b64-4e9d-9b8d-0fbe7e75a0c4';
const PLAN_ID = 'a0f2c5d8-1f4e-4b6a-9c2d-7e8f9a0b1c2d';
const VERSION_ID = 'b1e3d6c9-2a5f-4c7b-8d3e-9f0a1b2c3d4e';
const PROFILE_ID = 'c2f4e7da-3b6a-4d8c-9e4f-0a1b2c3d4e5f';
const STEP_ID = 'd3a5f8eb-4c7b-4e9d-8f5a-1b2c3d4e5f60';
const LOGICAL_STEP_ID = 'e4b6a9fc-5d8c-4f0e-9a6b-2c3d4e5f6071';
const DEVICE_ID = 'f5c7ba0d-6e9d-4a1f-8b7c-3d4e5f607182';

describe('terminal run CSV serialisation', () => {
  it('starts with a UTF-8 BOM, uses CRLF and keeps the documented header order', () => {
    const csv = serialiseRunReportCsv(makeReport());
    const bytes = Buffer.from(csv, 'utf8');

    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(csv.startsWith(REPORT_CSV_BOM)).toBe(true);
    expect(csv.slice(1).split('\r\n')[0]).toBe(REPORT_CSV_HEADER.join(','));
    expect(csv.endsWith('\r\n')).toBe(true);
    expect(csv).not.toMatch(/(?<!\r)\n/);

    const lines = csv.slice(1).split('\r\n');
    expect(lines.at(-1)).toBe('');
    expect(lines).toHaveLength(4);
  });

  it('writes one row per recorded sample in step position and sample index order', () => {
    const report = makeReport({
      steps: [
        makeStep({
          position: 1,
          measurements: [measurement(0), measurement(1)],
        }),
        makeStep({
          runStepId: 'a6d8cb1e-7f0e-4b2a-9c8d-4e5f60718293',
          logicalStepId: 'b7e9dc2f-8a1f-4c3b-8d9e-5f60718293a4',
          position: 2,
          measurements: [measurement(0), measurement(2)],
        }),
      ],
    });

    const rows = serialiseRunReportCsv(report)
      .slice(1)
      .split('\r\n')
      .filter((line) => line.length > 0);

    expect(rows).toHaveLength(5);
    expect(rows.slice(1).map((row) => row.split(',')[9])).toEqual([
      '1',
      '1',
      '2',
      '2',
    ]);
    expect(rows.slice(1).map((row) => row.split(',')[14])).toEqual([
      '0',
      '1',
      '0',
      '2',
    ]);
  });

  it('quotes commas, quotes and line breaks with RFC 4180 escaping while keeping Unicode', () => {
    const report = makeReport({
      planName: 'Rail, "Türkçe"\r\nölçüm',
      deviceSnapshot: {
        id: DEVICE_ID,
        name: 'Cihaz, "B"\nSatır',
        serialNumber: 'SER-İ/001',
        deviceProfileId: PROFILE_ID,
      },
      steps: [
        makeStep({
          name: 'Gerilim, "A"',
          unit: 'µV',
          measurements: [measurement(0)],
        }),
      ],
    });

    const csv = serialiseRunReportCsv(report);

    expect(csv).toContain('"Rail, ""Türkçe""\r\nölçüm"');
    expect(csv).toContain('"Cihaz, ""B""\nSatır"');
    expect(csv).toContain('"Gerilim, ""A"""');
    expect(csv).toContain('µV');
    expect(csv).toContain('SER-İ/001');
  });

  it('neutralises formula triggers and leading control characters without touching official numeric columns', () => {
    for (const [input, expected] of [
      ['=SUM(A1)', "'=SUM(A1)"],
      ['+cmd', "'+cmd"],
      ['-5V rail', "'-5V rail"],
      ['@SUM(A1)', "'@SUM(A1)"],
      ['\t=cmd', "'\t=cmd"],
      ['\r=cmd', "'\r=cmd"],
      ['\n=cmd', "'\n=cmd"],
      [' =cmd', "' =cmd"],
      ["'=already text", "'=already text"],
      ['Türkçe ölçüm', 'Türkçe ölçüm'],
    ] as const) {
      expect(neutraliseReportCsvText(input)).toBe(expected);
    }

    const report = makeReport({
      deviceSnapshot: {
        id: DEVICE_ID,
        name: '+device',
        serialNumber: '=serial',
        deviceProfileId: PROFILE_ID,
      },
      batchNumber: '@batch',
      steps: [
        makeStep({
          name: '-negative-friendly',
          unit: '=unit',
          minimum: '-0.020000',
          maximum: '0.020000',
          measurements: [
            measurement(0, {
              value: '-0.010000',
              isWithinTolerance: false,
            }),
          ],
        }),
      ],
    });

    const row = serialiseRunReportCsv(report).slice(1).split('\r\n')[1]!;

    expect(row).toContain("'+device");
    expect(row).toContain("'=serial");
    expect(row).toContain("'@batch");
    expect(row).toContain("'-negative-friendly");
    expect(row).toContain("'=unit");
    expect(row).toContain(
      ',-0.020000,0.020000,0,-0.010000,0,2026-11-03T12:00:00.000Z,false',
    );
    expect(row).not.toContain("'-0.020000");
    expect(row).not.toContain("'-0.010000");
  });

  it('emits a header-only document when no measurement was recorded', () => {
    const report = makeReport({
      deviceId: null,
      deviceSnapshot: null,
      batchNumber: null,
      outcome: null,
      status: RunStatus.CANCELLED,
      steps: [
        makeStep({
          status: RunStepStatus.CANCELLED,
          outcome: null,
          recordedCount: 0,
          outOfToleranceCount: 0,
          firstFailureSampleIndex: null,
          hasOutOfTolerance: false,
          statistics: emptyStatistics(),
          measurements: [],
        }),
      ],
    });

    expect(serialiseRunReportCsv(report)).toBe(
      `${REPORT_CSV_BOM}${REPORT_CSV_HEADER.join(',')}\r\n`,
    );
  });

  it('keeps null metadata and a null outcome as empty cells', () => {
    const report = makeReport({
      deviceId: null,
      deviceSnapshot: null,
      batchNumber: null,
      outcome: null,
      status: RunStatus.ERROR,
      steps: [makeStep({ measurements: [measurement(0)] })],
    });

    const row = serialiseRunReportCsv(report).slice(1).split('\r\n')[1]!;
    const cells = row.split(',');

    expect(cells).toHaveLength(19);
    expect(cells[3]).toBe('');
    expect(cells[4]).toBe('');
    expect(cells[5]).toBe('');
    expect(cells[8]).toBe('');
  });

  it('writes six-place decimal strings verbatim and lower-case booleans', () => {
    const report = makeReport({
      steps: [
        makeStep({
          minimum: '-1.234567',
          maximum: '9.876543',
          measurements: [
            measurement(0, {
              value: '-1.234567',
              isWithinTolerance: false,
              elapsedMs: 450,
              recordedAt: '2026-11-03T12:34:56.789Z',
            }),
            measurement(1, {
              value: '9.876543',
              isWithinTolerance: true,
            }),
          ],
        }),
      ],
    });

    const rows = serialiseRunReportCsv(report)
      .slice(1)
      .split('\r\n')
      .filter((line) => line.length > 0);

    expect(rows[1]!.split(',')).toHaveLength(19);
    expect(rows[1]!.split(',').slice(12, 19)).toEqual([
      '-1.234567',
      '9.876543',
      '0',
      '-1.234567',
      '450',
      '2026-11-03T12:34:56.789Z',
      'false',
    ]);
    expect(rows[2]!.split(',').slice(12, 19)).toEqual([
      '-1.234567',
      '9.876543',
      '1',
      '9.876543',
      '200',
      '2026-11-03T12:00:00.200Z',
      'true',
    ]);
  });

  it('quotes only fields that need it', () => {
    expect(quoteReportCsvField('plain')).toBe('plain');
    expect(quoteReportCsvField('with,comma')).toBe('"with,comma"');
    expect(quoteReportCsvField('with"quote')).toBe('"with""quote"');
    expect(quoteReportCsvField('with\r\nbreak')).toBe('"with\r\nbreak"');
  });
});

function makeReport(overrides: Partial<RunReportDto> = {}): RunReportDto {
  return {
    schemaVersion: 1,
    generatedAt: '2026-11-07T10:00:00.000Z',
    runId: RUN_ID,
    planId: PLAN_ID,
    planVersionId: VERSION_ID,
    planName: 'Power rail verification',
    versionNumber: 1,
    profile: {
      id: PROFILE_ID,
      code: 'DC_POWER_MODULE',
      name: 'DC Power Module',
      description: 'Simulated module',
    },
    deviceId: DEVICE_ID,
    deviceSnapshot: {
      id: DEVICE_ID,
      name: 'Bench Power Module',
      serialNumber: 'PSU-001',
      deviceProfileId: PROFILE_ID,
    },
    batchNumber: 'BATCH-2026-001',
    scenario: RunScenario.NORMAL,
    seed: 42,
    errorProbability: null,
    failureStepId: null,
    simulatorVersion: 'sim-v1',
    evaluationVersion: 'decimal-v1',
    startedAt: '2026-11-03T12:00:00.000Z',
    finishedAt: '2026-11-03T12:00:01.000Z',
    status: RunStatus.COMPLETED,
    outcome: RunOutcome.PASSED,
    reasonCode: null,
    expectedSampleCount: 2,
    recordedSampleCount: 2,
    requestedBy: {
      id: 'a8d0ed3f-9b2a-4c4d-9f6e-6f708293a4b5',
      email: 'operator@example.test',
      role: 'OPERATOR',
    },
    steps: [
      makeStep({
        measurements: [measurement(0), measurement(1)],
      }),
    ],
    ...overrides,
  };
}

function makeStep(overrides: Partial<RunReportStepDto> = {}): RunReportStepDto {
  return {
    runStepId: STEP_ID,
    logicalStepId: LOGICAL_STEP_ID,
    position: 1,
    name: 'Output voltage',
    unit: 'V',
    minimum: '4.750000',
    maximum: '5.250000',
    sampleCount: 2,
    intervalMs: 200,
    status: RunStepStatus.COMPLETED,
    outcome: RunOutcome.PASSED,
    recordedCount: 2,
    outOfToleranceCount: 0,
    firstFailureSampleIndex: null,
    hasOutOfTolerance: false,
    statistics: {
      minimum: '5.000000',
      maximum: '5.001000',
      average: '5.000500',
      sampleCount: 2,
    },
    measurements: [measurement(0), measurement(1)],
    ...overrides,
  };
}

function measurement(
  sampleIndex: number,
  overrides: Partial<RunReportStepDto['measurements'][number]> = {},
): RunReportStepDto['measurements'][number] {
  return {
    sampleIndex,
    value: sampleIndex === 0 ? '5.000000' : '5.001000',
    isWithinTolerance: true,
    recordedAt: `2026-11-03T12:00:00.${String(sampleIndex * 200).padStart(3, '0')}Z`,
    elapsedMs: sampleIndex * 200,
    ...overrides,
  };
}

function emptyStatistics(): RunReportStepDto['statistics'] {
  return {
    minimum: null,
    maximum: null,
    average: null,
    sampleCount: null,
  };
}
