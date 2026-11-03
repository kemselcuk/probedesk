import type { ApiErrorView } from '../../core/http/http-error-normalizer';

/**
 * User-facing guidance for the two plan mutations that can return a
 * DRAFT_CONFLICT with a specific `details.reason`.
 *
 * The API repeats a safe `message`, but the screen has to tell the user what
 * happened and what to do next. Keeping the mapping here makes every reason
 * testable without opening a dialog or an HTTP request.
 */
export interface PlanErrorGuidance {
  readonly heading: string;
  readonly message: string;
}

export type PlanConflictReason =
  | 'DRAFT_CHANGED'
  | 'NO_OPEN_DRAFT'
  | 'OPEN_DRAFT_EXISTS'
  | 'NO_PUBLISHED_VERSION';

export function publishErrorGuidance(error: ApiErrorView): PlanErrorGuidance {
  if (error.status === 409 && error.code === 'DRAFT_CONFLICT') {
    switch (error.reason) {
      case 'NO_OPEN_DRAFT':
        return {
          heading: 'There is no open draft to publish',
          message:
            'This plan no longer has an open draft. It may have been published from another session. Reload the plan to see its current state.',
        };
      case 'DRAFT_CHANGED':
        return {
          heading: 'The saved draft changed during publish',
          message:
            'Nothing was published. Another request changed the saved draft while it was being published. Reload the plan, check the saved content, and publish again.',
        };
      default:
        return {
          heading: 'This draft was saved by another session',
          message:
            'Nothing was published. The saved draft is newer than the revision this screen loaded. Reload the saved draft before publishing again.',
        };
    }
  }

  if (error.status === 400 && error.code === 'VALIDATION_ERROR') {
    return {
      heading: 'The saved draft cannot be published',
      message:
        'The server validates the saved draft, not the current form. Fix the saved values, save again, and retry publishing.',
    };
  }

  if (error.status === 403) {
    return {
      heading: 'Your role cannot publish this plan',
      message: 'Publishing requires the Planner role. Ask a planner to publish this draft.',
    };
  }

  if (error.status === 404) {
    return {
      heading: 'The plan is no longer available',
      message:
        'The plan or its draft could not be found. It may have been removed, or your role may no longer have access.',
    };
  }

  return {
    heading: 'The draft could not be published',
    message: error.message,
  };
}

export function createDraftErrorGuidance(error: ApiErrorView): PlanErrorGuidance {
  if (error.status === 409 && error.code === 'DRAFT_CONFLICT') {
    switch (error.reason) {
      case 'OPEN_DRAFT_EXISTS':
        return {
          heading: 'This plan already has an open draft',
          message:
            'Only one draft can be open at a time. Continue editing the existing draft instead of creating a new one.',
        };
      case 'NO_PUBLISHED_VERSION':
        return {
          heading: 'There is no published version to copy',
          message:
            'A new draft is created from the latest published version. Publish the current draft first, then create a new draft.',
        };
      default:
        return {
          heading: 'The new draft could not be created',
          message:
            'The plan changed before the draft could be created. Reload the plan and check its current state.',
        };
    }
  }

  if (error.status === 403) {
    return {
      heading: 'Your role cannot create a draft',
      message: 'Creating a draft requires the Planner role.',
    };
  }

  if (error.status === 404) {
    return {
      heading: 'The plan is no longer available',
      message:
        'The plan could not be found. It may have been removed, or your role may no longer have access.',
    };
  }

  return {
    heading: 'The new draft could not be created',
    message: error.message,
  };
}
