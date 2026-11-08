import { randomUUID } from "node:crypto";
import { Client } from "pg";
import { assertE2eCleanupAllowed, requireE2eDatabaseUrl } from "./database";

/**
 * EX-12 edge fixture: terminal report runs seeded straight into the dedicated
 * `_test` database.
 *
 * These rows are a stress fixture, not a product write path: the browser
 * scenario needs a real 10,000-measurement terminal run and failed/partial
 * reports without waiting for the simulator to execute a maximally long plan.
 * The helper therefore follows the executor's own constraint-valid order:
 *
 * 1. create a draft revision, its steps and identities;
 * 2. publish that draft through the allowed DRAFT -> PUBLISHED transition;
 * 3. create the run as RUNNING and insert steps and measurements while the
 *    append-only/terminal rules are active;
 * 4. terminalise the steps and the run.
 *
 * Every value is a canonical six-place decimal, statistics are computed with
 * the same half-away-from-zero rule as the backend, and the database checks and
 * immutability triggers remain enabled. Cleanup uses the shared tracked-id
 * helper (`cleanupE2eData`) from the owning test.
 */

export type EdgeRunStatus = "COMPLETED" | "CANCELLED";
export type EdgeRunOutcome = "PASSED" | "FAILED" | null;
export type EdgeStepStatus = "COMPLETED" | "CANCELLED" | "NOT_RUN";
export type EdgeScenario = "NORMAL" | "FORCED_FAILURE";

export interface EdgeFixtureStepInput {
  readonly name: string;
  readonly unit: string;
  readonly minimum: string;
  readonly maximum: string;
  readonly sampleCount: number;
  readonly intervalMs: number;
  readonly recordedCount?: number;
  readonly status: EdgeStepStatus;
  readonly outcome: EdgeRunOutcome;
  /** Make exactly this recorded sample fall outside the tolerance. */
  readonly failureSampleIndex?: number;
  /** Explicit out-of-tolerance value for `failureSampleIndex`. */
  readonly failureValue?: string;
}

export interface EdgeFixtureInput {
  readonly planName: string;
  readonly deviceName: string;
  readonly deviceSerial: string;
  readonly batchNumber: string;
  readonly status: EdgeRunStatus;
  readonly outcome: EdgeRunOutcome;
  readonly scenario?: EdgeScenario;
  readonly reasonCode?: string | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly steps: readonly EdgeFixtureStepInput[];
}

export interface EdgeFixtureTracker {
  trackPlan(planId: string): void;
  trackDevice(deviceId: string): void;
}

export interface EdgeStoredStatistics {
  readonly minimum: string;
  readonly maximum: string;
  readonly average: string;
  readonly sampleCount: number;
}

export interface EdgeFixtureStepResult extends EdgeFixtureStepInput {
  readonly position: number;
  readonly runStepId: string;
  readonly logicalStepId: string;
  readonly recordedCount: number;
  readonly values: readonly string[];
  readonly outOfToleranceCount: number;
  readonly firstFailureSampleIndex: number | null;
  readonly statistics: EdgeStoredStatistics | null;
}

export interface EdgeFixtureResult {
  readonly planId: string;
  readonly revisionId: string;
  readonly runId: string;
  readonly deviceId: string;
  readonly planName: string;
  readonly deviceName: string;
  readonly deviceSerial: string;
  readonly batchNumber: string;
  readonly status: EdgeRunStatus;
  readonly outcome: EdgeRunOutcome;
  readonly scenario: EdgeScenario;
  readonly reasonCode: string | null;
  readonly startedAt: string;
  readonly finishedAt: string;
  readonly expectedSampleCount: number;
  readonly recordedSampleCount: number;
  readonly steps: readonly EdgeFixtureStepResult[];
}

interface DemoFixtureIds {
  readonly plannerId: string;
  readonly operatorId: string;
  readonly profileId: string;
  readonly profileCode: string;
  readonly profileName: string;
  readonly profileDescription: string | null;
}

const SCALE = 1_000_000n;
const DECIMAL = /^-?(?:0|[1-9]\d{0,11})\.\d{6}$/;
const MEASUREMENT_CHUNK = 1_000;

export function parseEdgeDecimal(value: string): bigint {
  if (!DECIMAL.test(value)) {
    throw new Error(`Not a canonical six-place decimal: ${value}`);
  }

  const negative = value.startsWith("-");
  const unsigned = negative ? value.slice(1) : value;
  const [integerPart = "0", fractionPart = ""] = unsigned.split(".");
  const magnitude =
    BigInt(integerPart) * SCALE + BigInt(fractionPart.padEnd(6, "0"));

  return negative ? -magnitude : magnitude;
}

export function formatEdgeDecimal(value: bigint): string {
  const negative = value < 0n;
  const magnitude = negative ? -value : value;
  const integerPart = magnitude / SCALE;
  const fractionPart = (magnitude % SCALE).toString().padStart(6, "0");
  return `${negative ? "-" : ""}${integerPart}.${fractionPart}`;
}

/**
 * Deterministic in-tolerance values spread across the recorded range. The
 * result is stable so the browser test can assert the exact first/last sample
 * in the CSV without reimplementing the generator.
 */
export function generateEdgeValues(
  stepIndex: number,
  minimum: string,
  maximum: string,
  sampleCount: number,
  failureSampleIndex?: number,
  failureValue?: string,
): string[] {
  const minimumScaled = parseEdgeDecimal(minimum);
  const maximumScaled = parseEdgeDecimal(maximum);
  if (minimumScaled > maximumScaled) {
    throw new Error("The edge fixture minimum must not exceed its maximum.");
  }
  if (failureValue !== undefined) {
    const scaled = parseEdgeDecimal(failureValue);
    if (
      failureSampleIndex === undefined ||
      (scaled >= minimumScaled && scaled <= maximumScaled)
    ) {
      throw new Error(
        "An explicit edge failure value needs an out-of-tolerance failure sample.",
      );
    }
  }

  const span = maximumScaled - minimumScaled;
  const distance =
    (maximumScaled - minimumScaled + 1n) / 2n > 1n
      ? (maximumScaled - minimumScaled + 1n) / 2n
      : 1n;
  const values: string[] = [];

  for (let index = 0; index < sampleCount; index += 1) {
    if (index === failureSampleIndex) {
      values.push(failureValue ?? formatEdgeDecimal(maximumScaled + distance));
      continue;
    }

    const numerator =
      span === 0n
        ? 0n
        : (span * BigInt((index * 7919 + stepIndex * 104_729) % 1000)) / 1000n;
    values.push(formatEdgeDecimal(minimumScaled + numerator));
  }

  return values;
}

/** Same exact half-away-from-zero rounding as the API statistics writer. */
export function calculateEdgeStatistics(
  values: readonly string[],
): EdgeStoredStatistics | null {
  if (values.length === 0) return null;

  const scaled = values.map(parseEdgeDecimal);
  let minimum = scaled[0]!;
  let maximum = scaled[0]!;
  let total = 0n;

  for (const value of scaled) {
    if (value < minimum) minimum = value;
    if (value > maximum) maximum = value;
    total += value;
  }

  const negative = total < 0n;
  const magnitude = negative ? -total : total;
  const count = BigInt(scaled.length);
  const quotient = magnitude / count;
  const remainder = magnitude % count;
  const rounded = remainder * 2n >= count ? quotient + 1n : quotient;
  const average = negative ? -rounded : rounded;

  return {
    minimum: formatEdgeDecimal(minimum),
    maximum: formatEdgeDecimal(maximum),
    average: formatEdgeDecimal(average),
    sampleCount: scaled.length,
  };
}

async function readDemoFixtureIds(client: Client): Promise<DemoFixtureIds> {
  const users = await client.query<{ id: string; email: string }>(
    "SELECT id, email FROM users WHERE email = ANY($1::text[])",
    [["planner@probedesk.local", "operator@probedesk.local"]],
  );
  const planner = users.rows.find(
    (row) => row.email === "planner@probedesk.local",
  );
  const operator = users.rows.find(
    (row) => row.email === "operator@probedesk.local",
  );
  const profile = await client.query<{
    id: string;
    code: string;
    name: string;
    description: string | null;
  }>(
    "SELECT id, code, name, description FROM device_profiles WHERE code = $1",
    ["DC_POWER_MODULE"],
  );
  const profileRow = profile.rows[0];

  if (!planner || !operator || !profileRow) {
    throw new Error(
      "The isolated E2E database is missing the demo users or DC_POWER_MODULE profile.",
    );
  }

  return {
    plannerId: planner.id,
    operatorId: operator.id,
    profileId: profileRow.id,
    profileCode: profileRow.code,
    profileName: profileRow.name,
    profileDescription: profileRow.description,
  };
}

async function insertRows(
  client: Client,
  sql: string,
  values: readonly unknown[],
): Promise<void> {
  await client.query(sql, [...values]);
}

/**
 * Seeds one fully terminal report run. The caller must register both tracked
 * ids immediately so the shared cleanup helper can remove the fixture even when
 * a later browser assertion fails.
 */
export async function seedEdgeFixture(
  input: EdgeFixtureInput,
  tracker: EdgeFixtureTracker,
): Promise<EdgeFixtureResult> {
  const connectionString = requireE2eDatabaseUrl();
  assertE2eCleanupAllowed(connectionString);

  if (input.steps.length === 0) {
    throw new Error("An edge fixture run needs at least one step.");
  }

  const totalSamples = input.steps.reduce(
    (total, step) => total + step.sampleCount,
    0,
  );
  const scenario = input.scenario ?? "NORMAL";
  const client = new Client({
    connectionString,
    application_name: "probedesk-ex12-edge-fixture",
    connectionTimeoutMillis: 5_000,
  });
  await client.connect();

  const startedAt = new Date(input.startedAt);
  const finishedAt = new Date(input.finishedAt);
  if (
    Number.isNaN(startedAt.getTime()) ||
    Number.isNaN(finishedAt.getTime()) ||
    finishedAt < startedAt
  ) {
    throw new Error("The edge fixture timestamps are invalid.");
  }

  try {
    const demo = await readDemoFixtureIds(client);
    const planId = randomUUID();
    const revisionId = randomUUID();
    const runId = randomUUID();
    const deviceId = randomUUID();
    const stepIdentities = input.steps.map(() => randomUUID());
    const runStepIds = input.steps.map(() => randomUUID());

    const preparedSteps = input.steps.map((step, index) => {
      const recordedCount = step.recordedCount ?? step.sampleCount;
      if (
        !Number.isInteger(recordedCount) ||
        recordedCount < 0 ||
        recordedCount > step.sampleCount
      ) {
        throw new Error("The edge fixture recorded count is invalid.");
      }
      if (step.status === "COMPLETED" && recordedCount !== step.sampleCount) {
        throw new Error(
          "A completed edge step must record every expected sample.",
        );
      }
      if (step.status === "NOT_RUN" && recordedCount !== 0) {
        throw new Error("A NOT_RUN edge step cannot have measurements.");
      }

      const values = generateEdgeValues(
        index,
        step.minimum,
        step.maximum,
        recordedCount,
        step.failureSampleIndex,
        step.failureValue,
      );
      const flags = values.map((value) => {
        const scaled = parseEdgeDecimal(value);
        return (
          scaled >= parseEdgeDecimal(step.minimum) &&
          scaled <= parseEdgeDecimal(step.maximum)
        );
      });
      const failures = flags
        .map((flag, sampleIndex) => (flag ? null : sampleIndex))
        .filter((sampleIndex): sampleIndex is number => sampleIndex !== null);

      if (
        step.status === "COMPLETED" &&
        (step.outcome === "PASSED") !== (failures.length === 0)
      ) {
        throw new Error(
          "The edge fixture completed outcome does not match its samples.",
        );
      }
      if (step.status !== "COMPLETED" && step.outcome !== null) {
        throw new Error("A non-completed edge step cannot have an outcome.");
      }

      return {
        ...step,
        position: index + 1,
        payloadIndex: index,
        runStepId: runStepIds[index]!,
        logicalStepId: stepIdentities[index]!,
        recordedCount,
        values,
        flags,
        outOfToleranceCount: failures.length,
        firstFailureSampleIndex: failures[0] ?? null,
        statistics:
          step.status === "COMPLETED" && step.outcome !== null
            ? calculateEdgeStatistics(values)
            : null,
      };
    });

    const recordedSampleCount = preparedSteps.reduce(
      (total, step) => total + step.recordedCount,
      0,
    );

    if (input.status === "COMPLETED" && recordedSampleCount !== totalSamples) {
      throw new Error(
        "A completed edge run must record every expected sample.",
      );
    }

    const profileSnapshot = JSON.stringify({
      id: demo.profileId,
      code: demo.profileCode,
      name: demo.profileName,
      description: demo.profileDescription,
    });
    const deviceSnapshot = JSON.stringify({
      id: deviceId,
      name: input.deviceName,
      serialNumber: input.deviceSerial,
      deviceProfileId: demo.profileId,
    });

    await client.query("BEGIN");
    try {
      await insertRows(
        client,
        `INSERT INTO "devices"
           (id, "deviceProfileId", name, "serialNumber", "serialNumberKey",
            description, "editRevision", "createdById", "createdAt", "updatedAt")
         VALUES ($1, $2, $3, $4, $5, $6, 1, $7, $8, $8)`,
        [
          deviceId,
          demo.profileId,
          input.deviceName,
          input.deviceSerial,
          input.deviceSerial.toUpperCase(),
          "EX-12 edge fixture device; created directly in the isolated test database.",
          demo.plannerId,
          startedAt,
        ],
      );
      tracker.trackDevice(deviceId);

      await insertRows(
        client,
        `INSERT INTO "test_plans" (id, "deviceProfileId", "createdById", "createdAt")
         VALUES ($1, $2, $3, $4)`,
        [planId, demo.profileId, demo.plannerId, startedAt],
      );
      tracker.trackPlan(planId);

      for (const logicalStepId of stepIdentities) {
        await insertRows(
          client,
          `INSERT INTO "step_identities" (id, "planId", "createdAt")
           VALUES ($1, $2, $3)`,
          [logicalStepId, planId, startedAt],
        );
      }

      await insertRows(
        client,
        `INSERT INTO "plan_revisions"
           (id, "planId", state, name, "versionNumber", "editRevision",
            "baseVersionId", "publishedById", "publishedAt")
         VALUES ($1, $2, 'DRAFT', $3, NULL, 1, NULL, NULL, NULL)`,
        [revisionId, planId, input.planName],
      );

      await insertRows(
        client,
        `INSERT INTO "plan_steps"
           (id, "revisionId", "planId", "logicalStepId", "position", name, unit,
            minimum, maximum, "sampleCount", "intervalMs")
         SELECT * FROM unnest(
           $1::uuid[], $2::uuid[], $3::uuid[], $4::uuid[], $5::int[],
           $6::text[], $7::text[], $8::numeric[], $9::numeric[],
           $10::int[], $11::int[]
         )`,
        [
          preparedSteps.map(() => randomUUID()),
          preparedSteps.map(() => revisionId),
          preparedSteps.map(() => planId),
          preparedSteps.map((step) => step.logicalStepId),
          preparedSteps.map((step) => step.position),
          preparedSteps.map((step) => step.name),
          preparedSteps.map((step) => step.unit),
          preparedSteps.map((step) => step.minimum),
          preparedSteps.map((step) => step.maximum),
          preparedSteps.map((step) => step.sampleCount),
          preparedSteps.map((step) => step.intervalMs),
        ],
      );

      await insertRows(
        client,
        `UPDATE "plan_revisions"
            SET state = 'PUBLISHED', "versionNumber" = 1,
                "publishedById" = $2, "publishedAt" = $3
          WHERE id = $1`,
        [revisionId, demo.plannerId, startedAt],
      );

      await insertRows(
        client,
        `INSERT INTO "test_runs"
           (id, "planId", "planRevisionId", "planNameSnapshot",
            "versionNumberSnapshot", "profileSnapshot", "deviceId",
            "deviceSnapshot", "batchNumber", "batchNumberKey", status, outcome,
            "requestedById", scenario, seed, "errorProbability", "failureStepId",
            "simulatorVersion", "evaluationVersion", "idempotencyKey",
            "requestHash", "eventSequence", "expectedSampleCount",
            "recordedSampleCount", "startedAt", "finishedAt", "cancelledById",
            "reasonCode")
         VALUES ($1, $2, $3, $4, 1, $5::jsonb, $6, $7::jsonb, $8, $9,
                 'RUNNING', NULL, $10, $11, 17, NULL, $12, 'mulberry32-v1',
                 'decimal-v1', $13, $14, 0, $15, 0, $16, NULL, NULL, NULL)`,
        [
          runId,
          planId,
          revisionId,
          input.planName,
          profileSnapshot,
          deviceId,
          deviceSnapshot,
          input.batchNumber,
          input.batchNumber.toUpperCase(),
          demo.operatorId,
          scenario,
          scenario === "FORCED_FAILURE" &&
          preparedSteps.some((step) => step.outOfToleranceCount > 0)
            ? preparedSteps.find((step) => step.outOfToleranceCount > 0)!
                .logicalStepId
            : null,
          `ex12-edge-${randomUUID()}`,
          `ex12-edge-hash-${randomUUID()}`,
          totalSamples,
          startedAt,
        ],
      );

      await insertRows(
        client,
        `INSERT INTO "run_steps"
           (id, "runId", "logicalStepId", "position", name, unit, minimum,
            maximum, "sampleCount", "intervalMs", status, outcome,
            "recordedCount", "outOfToleranceCount", "firstFailureSampleIndex",
            "startedAt", "finishedAt", statistics)
         SELECT * FROM unnest(
           $1::uuid[], $2::uuid[], $3::uuid[], $4::int[], $5::text[],
           $6::text[], $7::numeric[], $8::numeric[], $9::int[], $10::int[],
           $11::"RunStepStatus"[], $12::"RunOutcome"[], $13::int[], $14::int[],
           $15::int[], $16::timestamptz[], $17::timestamptz[], $18::jsonb[]
         )`,
        [
          preparedSteps.map((step) => step.runStepId),
          preparedSteps.map(() => runId),
          preparedSteps.map((step) => step.logicalStepId),
          preparedSteps.map((step) => step.position),
          preparedSteps.map((step) => step.name),
          preparedSteps.map((step) => step.unit),
          preparedSteps.map((step) => step.minimum),
          preparedSteps.map((step) => step.maximum),
          preparedSteps.map((step) => step.sampleCount),
          preparedSteps.map((step) => step.intervalMs),
          preparedSteps.map(() => "PENDING"),
          preparedSteps.map(() => null),
          preparedSteps.map(() => 0),
          preparedSteps.map(() => 0),
          preparedSteps.map(() => null),
          preparedSteps.map(() => null),
          preparedSteps.map(() => null),
          preparedSteps.map(() => null),
        ],
      );

      for (const step of preparedSteps) {
        for (
          let offset = 0;
          offset < step.values.length;
          offset += MEASUREMENT_CHUNK
        ) {
          const values = step.values.slice(offset, offset + MEASUREMENT_CHUNK);
          const flags = step.flags.slice(offset, offset + MEASUREMENT_CHUNK);
          const indexes = values.map((_, index) => offset + index);
          const elapsed = indexes.map(
            (sampleIndex) => sampleIndex * step.intervalMs,
          );
          const recordedAt = elapsed.map(
            (elapsedMs) => new Date(startedAt.getTime() + elapsedMs),
          );

          await insertRows(
            client,
            `INSERT INTO "measurements"
               (id, "runId", "runStepId", "sampleIndex", value,
                "isWithinTolerance", "recordedAt", "elapsedMs")
             SELECT gen_random_uuid(), $1, $2, sample.sample_index,
                    sample.value::numeric, sample.within_tolerance,
                    sample.recorded_at, sample.elapsed_ms
               FROM unnest(
                 $3::int[], $4::text[], $5::boolean[],
                 $6::timestamptz[], $7::int[]
               ) AS sample(sample_index, value, within_tolerance, recorded_at, elapsed_ms)`,
            [
              runId,
              step.runStepId,
              indexes,
              values,
              flags,
              recordedAt,
              elapsed,
            ],
          );
        }
      }

      for (const step of preparedSteps) {
        const stepFinishedAt =
          step.status === "NOT_RUN"
            ? null
            : step.status === "COMPLETED"
              ? new Date(
                  startedAt.getTime() +
                    (step.recordedCount - 1) * step.intervalMs,
                )
              : finishedAt;
        const stepStartedAt = step.status === "NOT_RUN" ? null : startedAt;

        await insertRows(
          client,
          `UPDATE "run_steps"
              SET status = $2, outcome = $3, "recordedCount" = $4,
                  "outOfToleranceCount" = $5,
                  "firstFailureSampleIndex" = $6, statistics = $7::jsonb,
                  "startedAt" = $8, "finishedAt" = $9
            WHERE id = $1`,
          [
            step.runStepId,
            step.status,
            step.outcome,
            step.recordedCount,
            step.outOfToleranceCount,
            step.firstFailureSampleIndex,
            step.statistics === null ? null : JSON.stringify(step.statistics),
            stepStartedAt,
            stepFinishedAt,
          ],
        );
      }

      await insertRows(
        client,
        `UPDATE "test_runs"
            SET status = $2, outcome = $3, "recordedSampleCount" = $4,
                "finishedAt" = $5, "cancelledById" = $6, "reasonCode" = $7,
                "eventSequence" = 1
          WHERE id = $1`,
        [
          runId,
          input.status,
          input.outcome,
          recordedSampleCount,
          finishedAt,
          input.status === "CANCELLED" ? demo.operatorId : null,
          input.reasonCode ?? null,
        ],
      );

      const eventType =
        input.status === "CANCELLED" ? "run.cancelled" : "run.completed";
      await insertRows(
        client,
        `INSERT INTO "run_events"
           (id, "runId", sequence, type, "schemaVersion", "occurredAt", payload)
         VALUES ($1, $2, 1, $3, 1, $4, $5::jsonb)`,
        [
          randomUUID(),
          runId,
          eventType,
          finishedAt,
          JSON.stringify({
            fixture: "ex12-edge",
            status: input.status,
            outcome: input.outcome,
            recordedSampleCount,
            expectedSampleCount: totalSamples,
          }),
        ],
      );

      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK").catch(() => undefined);
      throw error;
    }

    return {
      planId,
      revisionId,
      runId,
      deviceId,
      planName: input.planName,
      deviceName: input.deviceName,
      deviceSerial: input.deviceSerial,
      batchNumber: input.batchNumber,
      status: input.status,
      outcome: input.outcome,
      scenario,
      reasonCode: input.reasonCode ?? null,
      startedAt: startedAt.toISOString(),
      finishedAt: finishedAt.toISOString(),
      expectedSampleCount: totalSamples,
      recordedSampleCount,
      steps: preparedSteps.map((step) => ({
        name: step.name,
        unit: step.unit,
        minimum: step.minimum,
        maximum: step.maximum,
        sampleCount: step.sampleCount,
        intervalMs: step.intervalMs,
        recordedCount: step.recordedCount,
        status: step.status,
        outcome: step.outcome,
        failureSampleIndex: step.failureSampleIndex,
        position: step.position,
        runStepId: step.runStepId,
        logicalStepId: step.logicalStepId,
        values: step.values,
        outOfToleranceCount: step.outOfToleranceCount,
        firstFailureSampleIndex: step.firstFailureSampleIndex,
        statistics: step.statistics,
      })),
    };
  } finally {
    await client.end();
  }
}
