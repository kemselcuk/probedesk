/**
 * Stable error codes from the API contract. Feature modules may throw
 * ApiException with one of these codes; unexpected failures always map to
 * INTERNAL_ERROR.
 */
export const API_ERROR_CODES = [
  'VALIDATION_ERROR',
  'UNAUTHENTICATED',
  'FORBIDDEN',
  'NOT_FOUND',
  'DRAFT_CONFLICT',
  'RUN_ALREADY_ACTIVE',
  'IDEMPOTENCY_CONFLICT',
  'RUN_NOT_TERMINAL',
  'COMPARISON_PLAN_MISMATCH',
  'TOO_MANY_REQUESTS',
  'INTERNAL_ERROR',
  'SERVICE_UNAVAILABLE',
] as const;

export type ApiErrorCode = (typeof API_ERROR_CODES)[number];
