/**
 * Optional run metadata shared by start, history and comparisons. The display
 * batch keeps its case; the canonical key is used for identity/filtering so
 * case-only differences are the same value.
 */
export const BATCH_NUMBER_MAX_LENGTH = 100;
export const BATCH_NUMBER_PATTERN = /^[A-Za-z0-9._:/-]+$/;

/** Stored device copy written when a run starts. It never tracks later edits. */
export interface RunDeviceSnapshot {
  id: string;
  name: string;
  serialNumber: string;
  deviceProfileId: string;
  [key: string]: string;
}

export interface NormalizedRunBatch {
  batchNumber: string | null;
  batchNumberKey: string | null;
}

/**
 * Trims the display value and produces its uppercase canonical key. Null,
 * undefined and whitespace-only input are absent metadata.
 */
export function normalizeRunBatch(
  value: string | null | undefined,
): NormalizedRunBatch {
  if (value === null || value === undefined) {
    return { batchNumber: null, batchNumberKey: null };
  }

  const batchNumber = value.trim();
  if (batchNumber.length === 0) {
    return { batchNumber: null, batchNumberKey: null };
  }

  return { batchNumber, batchNumberKey: toBatchNumberKey(batchNumber) };
}

/** Filters compare against the canonical key, not the displayed case. */
export function toBatchNumberKey(value: string): string {
  return value.trim().toUpperCase();
}
