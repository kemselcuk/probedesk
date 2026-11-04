import {
  PlanRevisionState,
  Role,
  type Prisma,
  type PrismaClient,
  type RunOutcome,
  type RunStatus,
} from '../src/prisma/generated/client.js';
import {
  DEMO_OPERATOR_EMAIL,
  DEMO_PLAN_NAME,
  DEMO_PLAN_PROFILE_CODE,
  DEMO_PLAN_VERSIONS,
  DEMO_PLANNER_EMAIL,
  DEMO_RUNS,
  type DemoPlanVersionSeed,
} from './seed-data.js';
import {
  createSeededDemoRun,
  type DemoPublishedStep,
  type DemoPublishedVersion,
} from './seed-demo-runs.js';

export class DemoSeedConflictError extends Error {
  override readonly name = 'DemoSeedConflictError';
}

export interface DemoRunSeedSummary {
  id: string;
  idempotencyKey: string;
  label: string;
  versionNumber: number;
  status: RunStatus;
  outcome: RunOutcome | null;
  created: boolean;
}

export interface DemoPlanSeedSummary {
  createdPlan: boolean;
  planId: string;
  name: string;
  versions: Array<{ id: string; versionNumber: number }>;
  runs: DemoRunSeedSummary[];
  createdRuns: number;
  existingRuns: number;
}

const DEMO_SEED_LOCK_NAME = 'probedesk-demo-seed';
const TRANSACTION_OPTIONS = { timeout: 60_000, maxWait: 10_000 } as const;
const PLAN_CREATED_MS_AGO = 7 * 60 * 60 * 1000;
const VERSION_PUBLISHED_MS_AGO = [6, 2] as const;

type DemoPlanWithRevisions = Prisma.TestPlanGetPayload<{
  include: {
    deviceProfile: true;
    revisions: { include: { steps: true } };
  };
}>;

type DemoRevisionWithSteps = DemoPlanWithRevisions['revisions'][number];

/**
 * Adds the complete demo plan history only when it is missing.
 *
 * Published revisions, existing runs and measurement rows are never updated or
 * deleted. A repeat seed identifies the plan by the demo planner, the stable
 * plan name and the DC Power Module profile, validates the published rules and
 * then adds only runs whose idempotency key is absent.
 */
export async function seedDemoPowerSupplyPlan(
  prisma: PrismaClient,
): Promise<DemoPlanSeedSummary> {
  const now = new Date();

  return prisma.$transaction(async (tx) => {
    // Serialize two concurrent CLI seeds without holding a lock across the
    // entire connection pool. The lock is released at transaction end.
    await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${DEMO_SEED_LOCK_NAME})::bigint)`;

    const planner = await loadActor(tx, DEMO_PLANNER_EMAIL, Role.PLANNER);
    const operator = await loadActor(tx, DEMO_OPERATOR_EMAIL, Role.OPERATOR);
    const profile = await tx.deviceProfile.findUnique({
      where: { code: DEMO_PLAN_PROFILE_CODE },
    });

    if (!profile) {
      throw new DemoSeedConflictError(
        `The ${DEMO_PLAN_PROFILE_CODE} device profile is missing. Run npm run demo:seed again after the profile step succeeds.`,
      );
    }

    const existingPlan = await resolveExistingDemoPlan(
      tx,
      planner.id,
      operator.id,
      profile.id,
    );
    let planId: string;
    let createdPlan = false;
    let versions: DemoPublishedVersion[];

    if (existingPlan) {
      versions = validateExistingPlan(existingPlan, profile.id);
      planId = existingPlan.id;
    } else {
      const created = await createDemoPlan(tx, planner.id, profile, now);
      planId = created.planId;
      versions = created.versions;
      createdPlan = true;
    }

    const versionByNumber = new Map(
      versions.map((version) => [version.versionNumber, version]),
    );
    const runs: DemoRunSeedSummary[] = [];
    let createdRuns = 0;

    for (const spec of DEMO_RUNS) {
      const version = versionByNumber.get(spec.versionNumber);
      if (!version) {
        throw new DemoSeedConflictError(
          `The demo plan is missing published version ${spec.versionNumber}.`,
        );
      }

      const existingRun = await tx.testRun.findFirst({
        where: {
          requestedById: operator.id,
          idempotencyKey: spec.idempotencyKey,
        },
        select: {
          id: true,
          planId: true,
          planRevisionId: true,
          status: true,
          outcome: true,
        },
      });

      if (existingRun) {
        if (
          existingRun.planId !== planId ||
          existingRun.planRevisionId !== version.id
        ) {
          throw new DemoSeedConflictError(
            `The idempotency key ${spec.idempotencyKey} already belongs to another run.`,
          );
        }

        runs.push({
          id: existingRun.id,
          idempotencyKey: spec.idempotencyKey,
          label: spec.label,
          versionNumber: spec.versionNumber,
          status: existingRun.status,
          outcome: existingRun.outcome,
          created: false,
        });
        continue;
      }

      const startedAt = new Date(
        now.getTime() - spec.startedMinutesAgo * 60 * 1000,
      );
      const created = await createSeededDemoRun(
        tx,
        version,
        operator.id,
        spec,
        startedAt,
      );
      createdRuns += 1;
      runs.push({
        id: created.id,
        idempotencyKey: spec.idempotencyKey,
        label: spec.label,
        versionNumber: spec.versionNumber,
        status: created.status,
        outcome: created.outcome,
        created: true,
      });
    }

    return {
      createdPlan,
      planId,
      name: DEMO_PLAN_NAME,
      versions: versions.map((version) => ({
        id: version.id,
        versionNumber: version.versionNumber,
      })),
      runs,
      createdRuns,
      existingRuns: runs.length - createdRuns,
    };
  }, TRANSACTION_OPTIONS);
}

async function loadActor(
  tx: Prisma.TransactionClient,
  email: string,
  expectedRole: Role,
): Promise<{ id: string }> {
  const user = await tx.user.findUnique({
    where: { email },
    select: { id: true, role: true },
  });

  if (!user) {
    throw new DemoSeedConflictError(
      `The demo account ${email} is missing. Run npm run demo:seed again.`,
    );
  }

  if (user.role !== expectedRole) {
    throw new DemoSeedConflictError(
      `The demo account ${email} no longer has the ${expectedRole} role. The seed never changes an existing account.`,
    );
  }

  return { id: user.id };
}

async function findDemoPlans(
  tx: Prisma.TransactionClient,
  plannerId: string,
): Promise<DemoPlanWithRevisions[]> {
  return tx.testPlan.findMany({
    where: {
      createdById: plannerId,
      revisions: { some: { name: DEMO_PLAN_NAME } },
    },
    include: {
      deviceProfile: true,
      revisions: {
        include: { steps: { orderBy: { position: 'asc' } } },
        orderBy: [{ versionNumber: 'asc' }, { id: 'asc' }],
      },
    },
  });
}

async function createDemoPlan(
  tx: Prisma.TransactionClient,
  plannerId: string,
  profile: {
    id: string;
    code: string;
    name: string;
    description: string | null;
  },
  now: Date,
): Promise<{ planId: string; versions: DemoPublishedVersion[] }> {
  const planCreatedAt = new Date(now.getTime() - PLAN_CREATED_MS_AGO);
  const plan = await tx.testPlan.create({
    data: {
      deviceProfileId: profile.id,
      createdById: plannerId,
      createdAt: planCreatedAt,
    },
  });

  const baseSteps = DEMO_PLAN_VERSIONS[0]?.steps ?? [];
  const identities = new Map<string, string>();

  for (const step of baseSteps) {
    const identity = await tx.stepIdentity.create({
      data: { planId: plan.id, createdAt: planCreatedAt },
      select: { id: true },
    });
    identities.set(step.key, identity.id);
  }

  const publishedVersions: DemoPublishedVersion[] = [];
  let baseVersionId: string | null = null;

  for (const [index, version] of DEMO_PLAN_VERSIONS.entries()) {
    const draft: { id: string } = await tx.planRevision.create({
      data: {
        planId: plan.id,
        state: PlanRevisionState.DRAFT,
        name: DEMO_PLAN_NAME,
        editRevision: 1,
        baseVersionId,
      },
    });

    await tx.planStep.createMany({
      data: version.steps.map((step, position) => {
        const logicalStepId = identities.get(step.key);
        if (!logicalStepId) {
          throw new DemoSeedConflictError(
            `The demo plan version ${version.versionNumber} references an unknown step key.`,
          );
        }

        return {
          planId: plan.id,
          revisionId: draft.id,
          logicalStepId,
          position: position + 1,
          name: step.name,
          unit: step.unit,
          minimum: step.minimum,
          maximum: step.maximum,
          sampleCount: step.sampleCount,
          intervalMs: step.intervalMs,
        };
      }),
    });

    const published: DemoRevisionWithSteps = await tx.planRevision.update({
      where: { id: draft.id },
      data: {
        state: PlanRevisionState.PUBLISHED,
        versionNumber: version.versionNumber,
        publishedById: plannerId,
        publishedAt: new Date(
          now.getTime() -
            (VERSION_PUBLISHED_MS_AGO[index] ?? 0) * 60 * 60 * 1000,
        ),
      },
      include: { steps: { orderBy: { position: 'asc' } } },
    });

    publishedVersions.push(toDemoPublishedVersion(plan.id, published, profile));
    baseVersionId = published.id;
  }

  return { planId: plan.id, versions: publishedVersions };
}

/**
 * Finds the seeded plan without guessing when unrelated plans share the demo
 * name. Existing demo runs are the strongest marker because their idempotency
 * keys are unique. A plan without those runs is adopted only when its published
 * v1/v2 rules exactly match the fixture; otherwise a new plan is created and
 * nothing existing is touched.
 */
async function resolveExistingDemoPlan(
  tx: Prisma.TransactionClient,
  plannerId: string,
  operatorId: string,
  profileId: string,
): Promise<DemoPlanWithRevisions | null> {
  const markedPlanIds = await findMarkedDemoPlanIds(tx, operatorId);
  if (markedPlanIds.length > 1) {
    throw new DemoSeedConflictError(
      `Demo run keys point at more than one plan. Refusing to guess which one to use.`,
    );
  }

  if (markedPlanIds.length === 1) {
    const markedPlan = await findDemoPlanById(tx, markedPlanIds[0]!);
    if (!markedPlan) {
      throw new DemoSeedConflictError(
        'A demo run references a plan that no longer exists.',
      );
    }
    return markedPlan;
  }

  const candidates = await findDemoPlans(tx, plannerId);
  const matching = candidates.filter(
    (plan) => buildVersionsIfMatch(plan, profileId) !== null,
  );

  if (matching.length > 1) {
    throw new DemoSeedConflictError(
      `More than one existing plan matches the demo fixture "${DEMO_PLAN_NAME}". Refusing to guess which one to use.`,
    );
  }

  return matching[0] ?? null;
}

async function findMarkedDemoPlanIds(
  tx: Prisma.TransactionClient,
  operatorId: string,
): Promise<string[]> {
  const runs = await tx.testRun.findMany({
    where: {
      requestedById: operatorId,
      idempotencyKey: {
        in: DEMO_RUNS.map((run) => run.idempotencyKey),
      },
    },
    select: { planId: true },
  });

  return [...new Set(runs.map((run) => run.planId))];
}

async function findDemoPlanById(
  tx: Prisma.TransactionClient,
  planId: string,
): Promise<DemoPlanWithRevisions | null> {
  return tx.testPlan.findUnique({
    where: { id: planId },
    include: {
      deviceProfile: true,
      revisions: {
        include: { steps: { orderBy: { position: 'asc' } } },
        orderBy: [{ versionNumber: 'asc' }, { id: 'asc' }],
      },
    },
  });
}

function validateExistingPlan(
  plan: DemoPlanWithRevisions,
  expectedProfileId: string,
): DemoPublishedVersion[] {
  const versions = buildVersionsIfMatch(plan, expectedProfileId);
  if (versions === null) {
    throw new DemoSeedConflictError(
      `The existing demo plan "${DEMO_PLAN_NAME}" does not match the published v1/v2 fixture. Refusing to rewrite history.`,
    );
  }

  return versions;
}

function buildVersionsIfMatch(
  plan: DemoPlanWithRevisions,
  expectedProfileId: string,
): DemoPublishedVersion[] | null {
  if (plan.deviceProfileId !== expectedProfileId) {
    return null;
  }

  const byVersion = new Map<number, DemoRevisionWithSteps>();
  for (const revision of plan.revisions) {
    if (
      revision.state === PlanRevisionState.PUBLISHED &&
      revision.versionNumber !== null
    ) {
      byVersion.set(revision.versionNumber, revision);
    }
  }

  const versions: DemoPublishedVersion[] = [];
  let previousLogicalStepIds: string[] | null = null;

  for (const expected of DEMO_PLAN_VERSIONS) {
    const revision = byVersion.get(expected.versionNumber);
    if (revision === undefined || !versionMatches(revision, expected)) {
      return null;
    }

    const logicalStepIds = revision.steps.map((step) => step.logicalStepId);
    if (
      previousLogicalStepIds !== null &&
      !sameStringOrder(previousLogicalStepIds, logicalStepIds)
    ) {
      return null;
    }
    previousLogicalStepIds = logicalStepIds;

    versions.push(
      toDemoPublishedVersion(plan.id, revision, plan.deviceProfile),
    );
  }

  return versions;
}

function versionMatches(
  revision: DemoRevisionWithSteps,
  expected: DemoPlanVersionSeed,
): boolean {
  if (
    revision.name !== DEMO_PLAN_NAME ||
    revision.steps.length !== expected.steps.length
  ) {
    return false;
  }

  return revision.steps.every((actual, index) => {
    const wanted = expected.steps[index]!;

    return (
      actual.position === index + 1 &&
      actual.name === wanted.name &&
      actual.unit === wanted.unit &&
      actual.minimum.toFixed(6) === wanted.minimum &&
      actual.maximum.toFixed(6) === wanted.maximum &&
      actual.sampleCount === wanted.sampleCount &&
      actual.intervalMs === wanted.intervalMs
    );
  });
}

function toDemoPublishedVersion(
  planId: string,
  revision: {
    id: string;
    name: string;
    versionNumber: number | null;
    steps: Array<{
      logicalStepId: string;
      position: number;
      name: string;
      unit: string;
      minimum: { toFixed(digits: number): string };
      maximum: { toFixed(digits: number): string };
      sampleCount: number;
      intervalMs: number;
    }>;
  },
  profile: {
    id: string;
    code: string;
    name: string;
    description: string | null;
  },
): DemoPublishedVersion {
  if (revision.versionNumber === null) {
    throw new Error('A published demo revision must have a version number.');
  }

  const steps: DemoPublishedStep[] = revision.steps.map((step) => ({
    logicalStepId: step.logicalStepId,
    position: step.position,
    name: step.name,
    unit: step.unit,
    minimum: step.minimum.toFixed(6),
    maximum: step.maximum.toFixed(6),
    sampleCount: step.sampleCount,
    intervalMs: step.intervalMs,
  }));

  return {
    id: revision.id,
    planId,
    planName: revision.name,
    versionNumber: revision.versionNumber,
    profile: {
      id: profile.id,
      code: profile.code,
      name: profile.name,
      description: profile.description,
    },
    steps,
  };
}

function sameStringOrder(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}
