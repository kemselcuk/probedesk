/** Device identity limits shared by the DTOs, services and tests. */
export const DEVICE_NAME_MAX_LENGTH = 100;
export const DEVICE_SERIAL_NUMBER_MAX_LENGTH = 100;
export const DEVICE_DESCRIPTION_MAX_LENGTH = 500;

/**
 * Display serial numbers preserve their case, but only these ASCII characters
 * are accepted. The database repeats the same check as a final guard.
 */
export const DEVICE_SERIAL_NUMBER_PATTERN = /^[A-Za-z0-9._:/-]+$/;

export function normalizeDeviceName(value: string): string {
  return value.trim();
}

export function normalizeDeviceSerialNumber(value: string): string {
  return value.trim();
}

/**
 * Canonical lookup and uniqueness key. The accepted serial alphabet is ASCII,
 * so the simple uppercase form is stable across runtimes and PostgreSQL.
 */
export function toDeviceSerialNumberKey(serialNumber: string): string {
  return serialNumber.trim().toUpperCase();
}

/** Empty or whitespace-only descriptions are stored as null, never "". */
export function normalizeDeviceDescription(
  value: string | null | undefined,
): string | null {
  if (value === null || value === undefined) {
    return null;
  }

  const trimmed = value.trim();
  return trimmed.length === 0 ? null : trimmed;
}
