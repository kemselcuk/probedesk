import type { components } from '@probedesk/api-client';

/**
 * Plan screen types.
 *
 * Wire DTOs come from the generated OpenAPI client. The list and editor use a
 * small view model on top of them so the UI can distinguish "the API did not
 * send draft information" from "the plan has no open draft" without guessing.
 */

export type DeviceProfile = components['schemas']['DeviceProfileDto'];

/** Step fields used by the editor; the server-assigned position is implicit. */
export type PlanStep = Pick<
  components['schemas']['PlanStepDto'],
  'logicalStepId' | 'name' | 'unit' | 'minimum' | 'maximum' | 'sampleCount' | 'intervalMs'
>;

/** The open draft revision of a plan, with its ordered steps. */
export type PlanDraft = Pick<
  components['schemas']['DraftRevisionDto'],
  'id' | 'editRevision' | 'name'
> & {
  readonly steps: readonly PlanStep[];
};

export type PublishedVersion = components['schemas']['PublishedVersionSummaryDto'];

/**
 * Role-aware plan summary used by the list screen.
 *
 * `draftKnown` and `versionsKnown` tell the UI whether the API actually
 * supplied the corresponding information, so missing data is never rendered as
 * "no draft" or "not published".
 */
export interface PlanSummary {
  readonly id: string;
  readonly name: string;
  readonly profile: DeviceProfile | null;
  readonly latestPublishedVersion: PublishedVersion | null;
  readonly versionsKnown: boolean;
  readonly hasDraft: boolean;
  readonly draftKnown: boolean;
  readonly draftRevision: number | null;
}

/** Plan detail for the editor. The open draft is null when none exists. */
export interface PlanDetail extends PlanSummary {
  readonly draft: PlanDraft | null;
  readonly versions: readonly PublishedVersion[];
}

/** POST /api/plans request body. */
export type CreatePlanRequest = components['schemas']['CreatePlanDto'];

/** One step in PUT /api/plans/:id/draft. */
export type SaveDraftStepRequest = components['schemas']['DraftStepDto'];

/** PUT /api/plans/:id/draft request body. Array order is authoritative. */
export type SaveDraftRequest = components['schemas']['SaveDraftDto'];

/**
 * The useful part of the save response.
 *
 * The API returns the new revision and the saved steps (including server
 * generated logicalStepIds). `logicalStepIds` is accepted as a fallback for a
 * response that only lists identifiers.
 */
export interface SaveDraftResult {
  readonly editRevision: number;
  readonly steps: readonly PlanStep[] | null;
  readonly logicalStepIds: readonly string[] | null;
}
