import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import {
  CSRF_COOKIE_NAME,
  SESSION_COOKIE_NAME,
} from '../src/auth/auth.constants.js';
import {
  Role,
  RunEventType,
  RunOutcome,
  RunScenario,
  RunStatus,
  RunStepStatus,
} from '../src/prisma/generated/client.js';
import { PrismaService } from '../src/prisma/prisma.service.js';
import type { RunReportDto } from '../src/reports/dto/run-report.dto.js';
import {
  cookieHeader,
  getCookie,
  readSetCookies,
  type TestUser,
} from './support/auth-helpers.js';
import { createReportTestApplication } from './support/report-test-application.js';
import {
  createPublishedRunFixture,
  type PublishedRunFixture,
  type RunFixtureStepTemplate,
} from './support/run-helpers.js';
import {
  assertReportTestDatabase,
  createReportTestDevice,
  createReportTestProfile,
  createReportTestUser,
  deleteReportTestData,
  seedReportRun,
  type ReportDeviceSnapshotInput,
  type SeedReportMeasurement,
  type SeedReportStep,
} from './support/report-helpers.js';
import {
  REPORT_CSV_BOM,
  REPORT_CSV_HEADER,
} from '../src/reports/report-csv.js';

interface ClientSession {
  cookie: string;
  csrfToken: string;
}

const RICH_PLAN_NAME =
  '=HYPERLINK("https://example.test","Türkçe"), rail\nline';
const DEVICE_NAME = 'Cihaz, "B"\nSatır';
const EVENT_SECRET = 'report-event-payload-secret-7f31c0';

const REPORT_KEYS = [
  'schemaVersion',
  'generatedAt',
  'runId',
  'planId',
  'planVersionId',
  'planName',
  'versionNumber',
  'profile',
  'deviceId',
  'deviceSnapshot',
  'batchNumber',
  'scenario',
  'seed',
  'errorProbability',
  'failureStepId',
  'simulatorVersion',
  'evaluationVersion',
  'startedAt',
  'finishedAt',
  'status',
  'outcome',
  'reasonCode',
  'expectedSampleCount',
  'recordedSampleCount',
  'requestedBy',
  'steps',
];

const STEP_KEYS = [
  'runStepId',
  'logicalStepId',
  'position',
  'name',
  'unit',
  'minimum',
  'maximum',
  'sampleCount',
  'intervalMs',
  'status',
  'outcome',
  'recordedCount',
  'outOfToleranceCount',
  'firstFailureSampleIndex',
  'hasOutOfTolerance',
  'statistics',
  'measurements',
];

describe('terminal run report and export API', () => {
  let app: INestApplication;
  let prisma: PrismaService;
  let plannerUser: TestUser;
  let operatorUser: TestUser;
  let viewerUser: TestUser;
  let planner: ClientSession;
  let operator: ClientSession;
  let viewer: ClientSession;
  let profile: PublishedRunFixture['profile'];
  let fixture: PublishedRunFixture;
  let bigFixture: PublishedRunFixture;
  let device: ReportDeviceSnapshotInput;
  let richRunId: string;
  let cancelledRunId: string;
  let interruptedRunId: string;
  let errorRunId: string;

  beforeAll(async () => {
    const target = assertReportTestDatabase();
    console.log(
      `Report e2e target: ${target.hostname}:${target.port}/${target.databaseName}`,
    );

    app = await createReportTestApplication();
    prisma = app.get(PrismaService);

    plannerUser = await createReportTestUser(prisma, Role.PLANNER);
    operatorUser = await createReportTestUser(prisma, Role.OPERATOR);
    viewerUser = await createReportTestUser(prisma, Role.VIEWER);
    planner = await login(plannerUser);
    operator = await login(operatorUser);
    viewer = await login(viewerUser);

    profile = await createReportTestProfile(prisma);
    fixture = await createPublishedRunFixture(prisma, plannerUser.id, profile, {
      planName: 'Report projection fixture',
      versionNumber: 1,
      steps: [
        {
          name: 'Gerilim, "A"',
          unit: 'V',
          minimum: '-0.020000',
          maximum: '0.020000',
          sampleCount: 2,
          intervalMs: 200,
        },
        {
          name: '@Akım',
          unit: 'A',
          minimum: '0.000000',
          maximum: '1.000000',
          sampleCount: 2,
          intervalMs: 250,
        },
        {
          name: 'Sıcaklık °C',
          unit: '°C',
          minimum: '20.000000',
          maximum: '60.000000',
          sampleCount: 1,
          intervalMs: 500,
        },
      ],
    });

    device = await createReportTestDevice(prisma, {
      deviceProfileId: profile.id,
      createdById: plannerUser.id,
      name: DEVICE_NAME,
      serialNumber: 'RPT-SER-001',
    });

    const richRun = await seedReportRun(prisma, {
      fixture,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.FAILED,
      startedAt: '2026-11-03T12:00:00.000Z',
      finishedAt: '2026-11-03T12:00:02.000Z',
      planNameSnapshot: RICH_PLAN_NAME,
      device,
      batchNumber: 'BATCH-2026-001',
      scenario: RunScenario.RANDOM,
      seed: 123_456_789n,
      errorProbability: '0.050000',
      steps: [
        completedStep(
          0,
          [
            measurement(0, '-0.010000', true, 0),
            measurement(1, '0.010000', true, 200),
          ],
          {
            minimum: '-0.010000',
            maximum: '0.010000',
            average: '0.000000',
            sampleCount: 2,
          },
          RunOutcome.PASSED,
        ),
        completedStep(
          1,
          [
            measurement(0, '0.500000', true, 0),
            measurement(1, '1.500000', false, 250),
          ],
          {
            minimum: '0.500000',
            maximum: '1.500000',
            average: '1.000000',
            sampleCount: 2,
          },
          RunOutcome.FAILED,
        ),
        completedStep(
          2,
          [measurement(0, '25.000000', true, 0)],
          {
            minimum: '25.000000',
            maximum: '25.000000',
            average: '25.000000',
            sampleCount: 1,
          },
          RunOutcome.PASSED,
        ),
      ],
    });
    richRunId = richRun.id;

    await prisma.runEvent.create({
      data: {
        runId: richRunId,
        sequence: 2,
        type: RunEventType.RUN_COMPLETED,
        occurredAt: new Date('2026-11-03T12:00:02.000Z'),
        payload: { secretEventPayload: EVENT_SECRET },
      },
    });

    const cancelled = await seedReportRun(prisma, {
      fixture,
      requestedById: operatorUser.id,
      status: RunStatus.CANCELLED,
      outcome: null,
      startedAt: '2026-11-03T13:00:00.000Z',
      finishedAt: '2026-11-03T13:00:01.000Z',
      planNameSnapshot: 'Cancelled partial',
      batchNumber: 'BATCH-PARTIAL',
      reasonCode: 'USER_CANCELLED',
      steps: [
        completedStep(
          0,
          [
            measurement(0, '0.000000', true, 0),
            measurement(1, '0.010000', true, 200),
          ],
          {
            minimum: '0.000000',
            maximum: '0.010000',
            average: '0.005000',
            sampleCount: 2,
          },
          RunOutcome.PASSED,
        ),
        {
          status: RunStepStatus.CANCELLED,
          outcome: null,
          measurements: [measurement(0, '0.500000', true, 0)],
          statistics: null,
        },
        {
          status: RunStepStatus.NOT_RUN,
          outcome: null,
          measurements: [],
          statistics: null,
        },
      ],
    });
    cancelledRunId = cancelled.id;

    const interrupted = await seedReportRun(prisma, {
      fixture,
      requestedById: operatorUser.id,
      status: RunStatus.INTERRUPTED,
      outcome: null,
      startedAt: '2026-11-03T14:00:00.000Z',
      finishedAt: '2026-11-03T14:00:01.000Z',
      planNameSnapshot: 'Interrupted empty',
      reasonCode: 'SERVER_RESTART',
      steps: [notRunStep(), notRunStep(), notRunStep()],
    });
    interruptedRunId = interrupted.id;

    const errored = await seedReportRun(prisma, {
      fixture,
      requestedById: operatorUser.id,
      status: RunStatus.ERROR,
      outcome: null,
      startedAt: '2026-11-03T15:00:00.000Z',
      finishedAt: '2026-11-03T15:00:00.500Z',
      planNameSnapshot: 'Errored partial',
      reasonCode: 'SIMULATOR_FAILURE',
      steps: [
        {
          status: RunStepStatus.ERROR,
          outcome: null,
          measurements: [measurement(0, '0.500000', true, 0)],
          statistics: null,
        },
        notRunStep(),
        notRunStep(),
      ],
    });
    errorRunId = errored.id;

    const bigStepTemplates: RunFixtureStepTemplate[] = Array.from(
      { length: 10 },
      (_, index) => ({
        name: `Big step ${index + 1}`,
        unit: 'V',
        minimum: '0.000000',
        maximum: '10.000000',
        sampleCount: 1_000,
        intervalMs: 100,
      }),
    );
    bigFixture = await createPublishedRunFixture(
      prisma,
      plannerUser.id,
      profile,
      {
        planName: 'Report big fixture',
        versionNumber: 1,
        steps: bigStepTemplates,
      },
    );
  });

  afterAll(async () => {
    try {
      if (prisma) {
        await deleteReportTestData(prisma);
      }
    } finally {
      if (prisma) {
        await prisma.$disconnect();
      }
      if (app) {
        await app.close();
      }
    }
  });

  it('returns the versioned projection to all three roles with snapshot metadata', async () => {
    for (const session of [planner, operator, viewer]) {
      const response = await request(server())
        .get(`/api/runs/${richRunId}/report`)
        .set('Cookie', session.cookie)
        .expect(200);

      expect(response.headers['content-type']).toBe(
        'application/json; charset=utf-8',
      );
      expect(response.headers['cache-control']).toBe('no-store');

      const report = response.body as RunReportDto;

      expect(Object.keys(report).sort()).toEqual([...REPORT_KEYS].sort());
      expect(report.schemaVersion).toBe(1);
      expect(report.generatedAt.endsWith('Z')).toBe(true);
      expect(Number.isNaN(Date.parse(report.generatedAt))).toBe(false);
      expect(report.runId).toBe(richRunId);
      expect(report.planId).toBe(fixture.planId);
      expect(report.planVersionId).toBe(fixture.revisionId);
      expect(report.planName).toBe(RICH_PLAN_NAME);
      expect(report.versionNumber).toBe(1);
      expect(report.profile).toEqual(fixture.profile);
      expect(report.deviceId).toBe(device.id);
      expect(report.deviceSnapshot).toEqual(device);
      expect(report.batchNumber).toBe('BATCH-2026-001');
      expect(report.scenario).toBe(RunScenario.RANDOM);
      expect(report.seed).toBe(123_456_789);
      expect(report.errorProbability).toBe('0.050000');
      expect(report.failureStepId).toBeNull();
      expect(report.simulatorVersion).toBeTruthy();
      expect(report.evaluationVersion).toBe('decimal-v1');
      expect(report.startedAt).toBe('2026-11-03T12:00:00.000Z');
      expect(report.finishedAt).toBe('2026-11-03T12:00:02.000Z');
      expect(report.status).toBe(RunStatus.COMPLETED);
      expect(report.outcome).toBe(RunOutcome.FAILED);
      expect(report.reasonCode).toBeNull();
      expect(report.expectedSampleCount).toBe(5);
      expect(report.recordedSampleCount).toBe(5);
      expect(report.requestedBy).toEqual({
        id: operatorUser.id,
        email: operatorUser.email,
        role: Role.OPERATOR,
      });

      expect(report.steps).toHaveLength(3);
      expect(report.steps.map((step) => step.position)).toEqual([1, 2, 3]);
      expect(report.steps.map((step) => step.name)).toEqual([
        'Gerilim, "A"',
        '@Akım',
        'Sıcaklık °C',
      ]);
      expect(report.steps[0]!.minimum).toBe('-0.020000');
      expect(report.steps[0]!.maximum).toBe('0.020000');
      expect(report.steps[1]!.firstFailureSampleIndex).toBe(1);
      expect(report.steps[1]!.outOfToleranceCount).toBe(1);
      expect(report.steps[1]!.hasOutOfTolerance).toBe(true);
      expect(report.steps[1]!.statistics).toEqual({
        minimum: '0.500000',
        maximum: '1.500000',
        average: '1.000000',
        sampleCount: 2,
      });
      expect(report.steps[1]!.measurements).toEqual([
        {
          sampleIndex: 0,
          value: '0.500000',
          isWithinTolerance: true,
          recordedAt: '2026-11-03T12:00:00.000Z',
          elapsedMs: 0,
        },
        {
          sampleIndex: 1,
          value: '1.500000',
          isWithinTolerance: false,
          recordedAt: '2026-11-03T12:00:00.250Z',
          elapsedMs: 250,
        },
      ]);

      for (const step of report.steps) {
        expect(Object.keys(step).sort()).toEqual([...STEP_KEYS].sort());
        expect(typeof step.minimum).toBe('string');
        expect(step.minimum).toMatch(/^-?\d+\.\d{6}$/);
        expect(step.maximum).toMatch(/^-?\d+\.\d{6}$/);
        for (const sample of step.measurements) {
          expect(sample.value).toMatch(/^-?\d+\.\d{6}$/);
        }
      }

      const raw = JSON.stringify(report);
      for (const forbidden of [
        'passwordHash',
        'tokenHash',
        'csrfToken',
        'session',
        'requestHash',
        'idempotencyKey',
        'eventSequence',
        'cancelledById',
        EVENT_SECRET,
      ]) {
        expect(raw).not.toContain(forbidden);
      }
    }
  });

  it('rejects RUNNING, unknown and malformed ids without leaking data', async () => {
    const running = await seedReportRun(prisma, {
      fixture,
      requestedById: operatorUser.id,
      status: RunStatus.RUNNING,
      outcome: null,
      startedAt: '2026-11-03T16:00:00.000Z',
      finishedAt: null,
      planNameSnapshot: 'Running report',
      steps: [notRunStep(), notRunStep(), notRunStep()],
    });

    try {
      const runningReport = await request(server())
        .get(`/api/runs/${running.id}/report`)
        .set('Cookie', operator.cookie)
        .expect(409);
      expect(runningReport.body).toMatchObject({
        code: 'RUN_NOT_TERMINAL',
        details: { status: RunStatus.RUNNING },
      });
      expect(runningReport.body.message).toMatch(/terminal/i);

      const runningExport = await request(server())
        .get(`/api/runs/${running.id}/export`)
        .query({ format: 'csv' })
        .set('Cookie', operator.cookie)
        .expect(409);
      expect(runningExport.body.code).toBe('RUN_NOT_TERMINAL');
    } finally {
      await prisma.testRun.update({
        where: { id: running.id },
        data: {
          status: RunStatus.CANCELLED,
          finishedAt: new Date('2026-11-03T16:00:01.000Z'),
          reasonCode: 'USER_CANCELLED',
        },
      });
    }

    const unknownId = randomUUID();
    const unknownReport = await request(server())
      .get(`/api/runs/${unknownId}/report`)
      .set('Cookie', viewer.cookie)
      .expect(404);
    expect(unknownReport.body.code).toBe('NOT_FOUND');

    const unknownExport = await request(server())
      .get(`/api/runs/${unknownId}/export`)
      .query({ format: 'json' })
      .set('Cookie', viewer.cookie)
      .expect(404);
    expect(unknownExport.body.code).toBe('NOT_FOUND');

    const malformed = await request(server())
      .get('/api/runs/not-a-uuid/report')
      .set('Cookie', viewer.cookie)
      .expect(400);
    expect(malformed.body).toMatchObject({ code: 'VALIDATION_ERROR' });

    const unauthenticated = await request(server())
      .get(`/api/runs/${richRunId}/report`)
      .expect(401);
    expect(unauthenticated.body.code).toBe('UNAUTHENTICATED');
  });

  it('supports every terminal status including partial and empty runs', async () => {
    const cancelled = await getReport(cancelledRunId);
    expect(cancelled.status).toBe(RunStatus.CANCELLED);
    expect(cancelled.outcome).toBeNull();
    expect(cancelled.reasonCode).toBe('USER_CANCELLED');
    expect(cancelled.expectedSampleCount).toBe(5);
    expect(cancelled.recordedSampleCount).toBe(3);
    expect(cancelled.deviceSnapshot).toBeNull();
    expect(cancelled.batchNumber).toBe('BATCH-PARTIAL');
    expect(cancelled.steps.map((step) => step.status)).toEqual([
      RunStepStatus.COMPLETED,
      RunStepStatus.CANCELLED,
      RunStepStatus.NOT_RUN,
    ]);
    expect(cancelled.steps[1]!.statistics).toEqual({
      minimum: null,
      maximum: null,
      average: null,
      sampleCount: null,
    });
    expect(cancelled.steps[1]!.measurements).toHaveLength(1);
    expect(cancelled.steps[2]!.measurements).toEqual([]);

    const partialExport = await request(server())
      .get(`/api/runs/${cancelledRunId}/export`)
      .query({ format: 'csv' })
      .set('Cookie', viewer.cookie)
      .expect(200);
    const partialRows = parseCsv(responseText(partialExport)).rows;
    expect(partialRows).toHaveLength(3);
    expect(partialRows.map((row) => row[14])).toEqual(['0', '1', '0']);
    expect(partialRows.every((row) => row[8] === '')).toBe(true);

    const interrupted = await getReport(interruptedRunId);
    expect(interrupted.status).toBe(RunStatus.INTERRUPTED);
    expect(interrupted.outcome).toBeNull();
    expect(interrupted.reasonCode).toBe('SERVER_RESTART');
    expect(interrupted.recordedSampleCount).toBe(0);
    expect(
      interrupted.steps.every((step) => step.status === RunStepStatus.NOT_RUN),
    ).toBe(true);
    expect(
      interrupted.steps.every((step) => step.measurements.length === 0),
    ).toBe(true);

    const errored = await getReport(errorRunId);
    expect(errored.status).toBe(RunStatus.ERROR);
    expect(errored.outcome).toBeNull();
    expect(errored.steps[0]!.status).toBe(RunStepStatus.ERROR);
    expect(errored.steps[0]!.statistics.sampleCount).toBeNull();
    expect(errored.steps[0]!.measurements).toHaveLength(1);
  });

  it('keeps the start-time device snapshot after a live device rename', async () => {
    const before = await getReport(richRunId);
    expect(before.deviceSnapshot).toEqual(device);

    await prisma.device.update({
      where: { id: device.id },
      data: { name: 'Renamed live device' },
    });

    const after = await getReport(richRunId);
    expect(after.deviceSnapshot).toEqual(device);
    expect(JSON.stringify(after)).not.toContain('Renamed live device');
  });

  it('exports CSV with BOM, CRLF, RFC 4180 quoting, safe text and exact decimals', async () => {
    const response = await request(server())
      .get(`/api/runs/${richRunId}/export`)
      .query({ format: 'csv' })
      .set('Cookie', planner.cookie)
      .expect(200);

    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['cache-control']).toBe('no-store');
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="probedesk-run-${richRunId}.csv"`,
    );

    const text = responseText(response);
    const bytes = Buffer.from(text, 'utf8');
    expect([...bytes.subarray(0, 3)]).toEqual([0xef, 0xbb, 0xbf]);
    expect(text.slice(0, 1)).toBe(REPORT_CSV_BOM);

    const parsed = parseCsv(text);
    expect(parsed.header).toEqual([...REPORT_CSV_HEADER]);
    expect(parsed.rows).toHaveLength(5);

    for (const row of parsed.rows) {
      expect(row).toHaveLength(REPORT_CSV_HEADER.length);
      expect(row[0]).toBe(richRunId);
      expect(row[1]).toBe(`'${RICH_PLAN_NAME}`);
      expect(row[2]).toBe('1');
      expect(row[3]).toBe(DEVICE_NAME);
      expect(row[4]).toBe('RPT-SER-001');
      expect(row[5]).toBe('BATCH-2026-001');
      expect(row[6]).toBe('RANDOM');
      expect(row[7]).toBe('COMPLETED');
      expect(row[8]).toBe('FAILED');
    }

    expect(parsed.rows.map((row) => row[9])).toEqual(['1', '1', '2', '2', '3']);
    expect(parsed.rows.map((row) => row[14])).toEqual([
      '0',
      '1',
      '0',
      '1',
      '0',
    ]);
    expect(parsed.rows[0]![10]).toBe('Gerilim, "A"');
    expect(parsed.rows[0]![11]).toBe('V');
    expect(parsed.rows[2]![10]).toBe("'@Akım");
    expect(parsed.rows[4]![10]).toBe('Sıcaklık °C');
    expect(parsed.rows[4]![11]).toBe('°C');

    expect(parsed.rows[0]!.slice(12, 18)).toEqual([
      '-0.020000',
      '0.020000',
      '0',
      '-0.010000',
      '0',
      '2026-11-03T12:00:00.000Z',
    ]);
    expect(parsed.rows[0]![18]).toBe('true');
    expect(parsed.rows[3]!.slice(15, 19)).toEqual([
      '1.500000',
      '250',
      '2026-11-03T12:00:00.250Z',
      'false',
    ]);
    for (const row of parsed.rows) {
      expect(row[12]).not.toContain("'");
      expect(row[13]).not.toContain("'");
      expect(row[15]).not.toContain("'");
    }

    expect(responseText(response)).not.toContain("'-0.020000");
    expect(responseText(response)).not.toContain("'-0.010000");
  });

  it('returns a header-only CSV without invented measurement rows', async () => {
    const response = await request(server())
      .get(`/api/runs/${interruptedRunId}/export`)
      .query({ format: 'csv' })
      .set('Cookie', viewer.cookie)
      .expect(200);

    expect(response.headers['content-type']).toBe('text/csv; charset=utf-8');
    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="probedesk-run-${interruptedRunId}.csv"`,
    );

    const text = responseText(response);
    expect(text).toBe(`${REPORT_CSV_BOM}${REPORT_CSV_HEADER.join(',')}\r\n`);
    expect(parseCsv(text).rows).toEqual([]);
  });

  it('exports the same versioned projection as JSON with decimal strings preserved', async () => {
    const reportResponse = await request(server())
      .get(`/api/runs/${richRunId}/report`)
      .set('Cookie', operator.cookie)
      .expect(200);
    const report = reportResponse.body as RunReportDto;

    const exportResponse = await request(server())
      .get(`/api/runs/${richRunId}/export`)
      .query({ format: 'json' })
      .set('Cookie', operator.cookie)
      .expect(200);

    expect(exportResponse.headers['content-type']).toBe(
      'application/json; charset=utf-8',
    );
    expect(exportResponse.headers['cache-control']).toBe('no-store');
    expect(exportResponse.headers['content-disposition']).toBe(
      `attachment; filename="probedesk-run-${richRunId}.json"`,
    );

    const exported = exportResponse.body as RunReportDto;
    const { generatedAt: reportGeneratedAt, ...reportBody } = report;
    const { generatedAt: exportGeneratedAt, ...exportBody } = exported;

    expect(reportGeneratedAt.endsWith('Z')).toBe(true);
    expect(exportGeneratedAt.endsWith('Z')).toBe(true);
    expect(exportBody).toEqual(reportBody);
    expect(exported.steps[0]!.minimum).toBe('-0.020000');
    expect(exported.steps[0]!.maximum).toBe('0.020000');
    expect(exported.steps[0]!.measurements[0]!.value).toBe('-0.010000');
  });

  it('validates format and rejects unknown query fields', async () => {
    for (const query of [
      {},
      { format: 'xlsx' },
      { format: 'CSV' },
      { format: 'csv', extra: '1' },
      { format: ['csv', 'json'] },
    ]) {
      const response = await request(server())
        .get(`/api/runs/${richRunId}/export`)
        .query(query)
        .set('Cookie', viewer.cookie)
        .expect(400);
      expect(response.body.code).toBe('VALIDATION_ERROR');
    }
  });

  it('uses the canonical lower-case run UUID in the response and filename', async () => {
    const response = await request(server())
      .get(`/api/runs/${richRunId.toUpperCase()}/export`)
      .query({ format: 'csv' })
      .set('Cookie', viewer.cookie)
      .expect(200);

    expect(response.headers['content-disposition']).toBe(
      `attachment; filename="probedesk-run-${richRunId}.csv"`,
    );
    expect(parseCsv(responseText(response)).rows[0]![0]).toBe(richRunId);
  });

  it('exports all 10,000 recorded measurements without truncation or fake rows', async () => {
    const steps: SeedReportStep[] = Array.from({ length: 10 }, (_, stepIndex) =>
      completedStep(
        stepIndex,
        Array.from({ length: 1_000 }, (_, sampleIndex) =>
          measurement(sampleIndex, '5.000000', true, sampleIndex * 100),
        ),
        {
          minimum: '5.000000',
          maximum: '5.000000',
          average: '5.000000',
          sampleCount: 1_000,
        },
        RunOutcome.PASSED,
      ),
    );

    const bigRun = await seedReportRun(prisma, {
      fixture: bigFixture,
      requestedById: operatorUser.id,
      status: RunStatus.COMPLETED,
      outcome: RunOutcome.PASSED,
      startedAt: '2026-11-03T17:00:00.000Z',
      finishedAt: '2026-11-03T17:01:40.000Z',
      planNameSnapshot: 'Report big run',
      steps,
    });

    const response = await request(server())
      .get(`/api/runs/${bigRun.id}/export`)
      .query({ format: 'csv' })
      .set('Cookie', viewer.cookie)
      .expect(200);

    const text = responseText(response);
    expect(text.length).toBeGreaterThan(1_000_000);
    expect(Number(response.headers['content-length'])).toBeGreaterThan(
      1_000_000,
    );

    const parsed = parseCsv(text);
    expect(parsed.rows).toHaveLength(10_000);
    expect(parsed.rows[0]!.slice(9, 16)).toEqual([
      '1',
      'Big step 1',
      'V',
      '0.000000',
      '10.000000',
      '0',
      '5.000000',
    ]);
    expect(parsed.rows.at(-1)!.slice(9, 16)).toEqual([
      '10',
      'Big step 10',
      'V',
      '0.000000',
      '10.000000',
      '999',
      '5.000000',
    ]);
    expect(parsed.rows.every((row) => row[7] === 'COMPLETED')).toBe(true);
    expect(parsed.rows.every((row) => row[18] === 'true')).toBe(true);
  }, 60_000);

  function server(): ReturnType<INestApplication['getHttpServer']> {
    return app.getHttpServer();
  }

  async function login(user: TestUser): Promise<ClientSession> {
    const response = await request(server())
      .post('/api/auth/login')
      .send({ email: user.email, password: user.password })
      .expect(200);

    const cookies = readSetCookies(response);
    const csrfCookie = getCookie(cookies, CSRF_COOKIE_NAME);

    return {
      cookie: cookieHeader(getCookie(cookies, SESSION_COOKIE_NAME), csrfCookie),
      csrfToken: csrfCookie.value,
    };
  }

  async function getReport(runId: string): Promise<RunReportDto> {
    const response = await request(server())
      .get(`/api/runs/${runId}/report`)
      .set('Cookie', viewer.cookie)
      .expect(200);

    return response.body as RunReportDto;
  }
});

function completedStep(
  stepIndex: number,
  measurements: readonly SeedReportMeasurement[],
  statistics: NonNullable<SeedReportStep['statistics']>,
  outcome: RunOutcome,
): SeedReportStep {
  return {
    status: RunStepStatus.COMPLETED,
    outcome,
    measurements,
    statistics: {
      ...statistics,
      sampleCount: measurements.length,
    },
  };
}

function notRunStep(): SeedReportStep {
  return {
    status: RunStepStatus.NOT_RUN,
    outcome: null,
    measurements: [],
    statistics: null,
  };
}

function measurement(
  sampleIndex: number,
  value: string,
  isWithinTolerance: boolean,
  elapsedMs: number,
): SeedReportMeasurement {
  return {
    sampleIndex,
    value,
    isWithinTolerance,
    elapsedMs,
    recordedAt: new Date(Date.parse('2026-11-03T12:00:00.000Z') + elapsedMs),
  };
}

function responseText(response: request.Response): string {
  if (typeof response.text === 'string' && response.text.length > 0) {
    return response.text;
  }

  if (Buffer.isBuffer(response.body)) {
    return response.body.toString('utf8');
  }

  return String(response.body ?? '');
}

interface ParsedCsv {
  header: string[];
  rows: string[][];
}

/**
 * Minimal RFC 4180 reader used only by the test. It proves that quoted commas,
 * quotes and CRLF inside a user-text cell stay inside one record.
 */
function parseCsv(document: string): ParsedCsv {
  const text = document.startsWith(REPORT_CSV_BOM)
    ? document.slice(1)
    : document;
  const records: string[][] = [];
  let record: string[] = [];
  let field = '';
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const character = text.charAt(index);

    if (quoted) {
      if (character === '"') {
        if (text.charAt(index + 1) === '"') {
          field += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        field += character;
      }
      continue;
    }

    if (character === '"') {
      quoted = true;
    } else if (character === ',') {
      record.push(field);
      field = '';
    } else if (character === '\r') {
      if (text.charAt(index + 1) === '\n') {
        index += 1;
      }
      record.push(field);
      field = '';
      records.push(record);
      record = [];
    } else if (character === '\n') {
      record.push(field);
      field = '';
      records.push(record);
      record = [];
    } else {
      field += character;
    }
  }

  if (field.length > 0 || record.length > 0) {
    record.push(field);
    records.push(record);
  }

  const [header, ...rows] = records;

  if (!header) {
    throw new Error('The CSV document does not contain a header.');
  }

  return { header, rows };
}
