import type { components } from '@probedesk/api-client';

/**
 * Plan screen types.
 *
 * These are direct aliases of the generated OpenAPI schemas. The screens do
 * not maintain a second API model: every request and response below is the
 * generated contract type, and `plans-api.ts` validates the fields it consumes
 * at runtime instead of inventing defaults.
 */

export type DeviceProfile = components['schemas']['DeviceProfileDto'];

/** Step fields as stored by the server; the array order is the sequence. */
export type PlanStep = components['schemas']['PlanStepDto'];

/** The open draft revision of a plan, with its ordered steps. */
export type PlanDraft = components['schemas']['DraftRevisionDto'];

/** One row of GET /api/plans/:id/versions, including the publisher. */
export type PublishedVersionListItem = components['schemas']['PublishedVersionListItemDto'];

/** Immutable published content from GET /api/plan-versions/:id or publish. */
export type PublishedRevision = components['schemas']['PublishedRevisionDto'];

/** Role-aware plan row from GET /api/plans. */
export type PlanSummary = components['schemas']['PlanListItemDto'];

/** Plan detail from GET /api/plans/:id and POST /api/plans. */
export type PlanDetail = components['schemas']['PlanDetailDto'];

/** POST /api/plans request body. */
export type CreatePlanRequest = components['schemas']['CreatePlanDto'];

/** One step in PUT /api/plans/:id/draft. */
export type SaveDraftStepRequest = components['schemas']['DraftStepDto'];

/** PUT /api/plans/:id/draft request body. Array order is authoritative. */
export type SaveDraftRequest = components['schemas']['SaveDraftDto'];

/** PUT /api/plans/:id/draft response: the saved draft revision. */
export type SaveDraftResult = components['schemas']['DraftRevisionDto'];

/** POST /api/plans/:id/draft/publish request body. */
export type PublishDraftRequest = components['schemas']['PublishDraftDto'];

export type CopyPlanRequest = components['schemas']['CopyPlanDto'];
export type CopyPlanResponse = components['schemas']['CopyPlanResponseDto'];
