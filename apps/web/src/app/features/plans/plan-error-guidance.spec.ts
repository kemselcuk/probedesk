import { describe, expect, it } from 'vitest';
import type { ApiErrorView } from '../../core/http/http-error-normalizer';
import { createDraftErrorGuidance, publishErrorGuidance } from './plan-error-guidance';

function conflict(reason: string, currentRevision: number | null = null): ApiErrorView {
  return {
    kind: 'api',
    status: 409,
    code: 'DRAFT_CONFLICT',
    message: 'The draft changed.',
    requestId: 'req-conflict',
    fieldErrors: [],
    reason,
    currentRevision,
  };
}

describe('plan error guidance', () => {
  it('explains every publish conflict reason concretely', () => {
    expect(publishErrorGuidance(conflict('DRAFT_CHANGED')).message).toContain(
      'Nothing was published.',
    );
    expect(publishErrorGuidance(conflict('NO_OPEN_DRAFT')).message).toContain(
      'no longer has an open draft',
    );

    const stale = publishErrorGuidance(conflict('', 12));
    expect(stale.heading).toBe('This draft was saved by another session');
    expect(stale.message).toContain('Reload the saved draft');
  });

  it('explains every new-draft conflict reason concretely', () => {
    const openDraft = createDraftErrorGuidance(conflict('OPEN_DRAFT_EXISTS', 4));
    expect(openDraft.heading).toBe('This plan already has an open draft');
    expect(openDraft.message).toContain('Continue editing the existing draft');

    const noPublished = createDraftErrorGuidance(conflict('NO_PUBLISHED_VERSION'));
    expect(noPublished.heading).toBe('There is no published version to copy');
    expect(noPublished.message).toContain('Publish the current draft first');
  });

  it('falls back to the API message for an unclassified failure', () => {
    const guidance = publishErrorGuidance({
      kind: 'api',
      status: 503,
      code: 'SERVICE_UNAVAILABLE',
      message: 'The plan service is temporarily unavailable.',
      requestId: null,
      fieldErrors: [],
      reason: null,
      currentRevision: null,
    });

    expect(guidance.message).toBe('The plan service is temporarily unavailable.');
  });
});
