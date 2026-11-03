import {
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ValidationErrors,
  Validators,
} from '@angular/forms';
import type { RunScenario, StartRunRequest } from './runs-api.types';

export const MIN_SEED = 0;
export const MAX_SEED = 4_294_967_295;
export const MAX_PROBABILITY_DECIMALS = 6;

const PROBABILITY_SCALE = 1_000_000;
const PROBABILITY_PATTERN = /^(0|[1-9]\d*)(?:\.(\d{1,6}))?$/;
const UINT32_PATTERN = /^\d+$/;

export interface RunStartFormControls {
  readonly scenario: FormControl<RunScenario>;
  readonly seed: FormControl<string>;
  readonly failureStepId: FormControl<string>;
  readonly errorProbability: FormControl<string>;
}

/** The typed value of the start form. Decimal input stays a string. */
export interface RunStartFormValue {
  readonly scenario: RunScenario;
  readonly seed: string;
  readonly failureStepId: string;
  readonly errorProbability: string;
}

export type RunStartFormGroup = FormGroup<RunStartFormControls>;

/**
 * A seed is a uint32 written as decimal digits. The string is validated and
 * converted only when the payload is built, so no value is rounded or defaulted.
 */
export function seedValue(control: FormControl<string>): ValidationErrors | null {
  const trimmed = control.value.trim();
  if (trimmed.length === 0) {
    return null;
  }

  if (!UINT32_PATTERN.test(trimmed)) {
    return { seed: true };
  }

  const value = Number(trimmed);
  return Number.isSafeInteger(value) && value >= MIN_SEED && value <= MAX_SEED
    ? null
    : { seed: true };
}

/** A failure probability is a canonical decimal between 0 and 1. */
export function probabilityValue(control: FormControl<string>): ValidationErrors | null {
  return validateProbability(control.value);
}

function validateProbability(raw: string): ValidationErrors | null {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return null;
  }

  const match = PROBABILITY_PATTERN.exec(trimmed);
  if (match === null) {
    return { probability: true };
  }

  const whole = match[1] ?? '';
  const fraction = match[2] ?? '';
  const scaled = Number(whole) * PROBABILITY_SCALE + Number(fraction.padEnd(6, '0'));

  return scaled <= PROBABILITY_SCALE ? null : { probability: true };
}

export function createRunStartForm(formBuilder: NonNullableFormBuilder): RunStartFormGroup {
  return formBuilder.group<RunStartFormControls>({
    scenario: formBuilder.control<RunScenario>('NORMAL', [Validators.required]),
    seed: formBuilder.control('', [Validators.required, seedValue]),
    failureStepId: formBuilder.control(''),
    errorProbability: formBuilder.control(''),
  });
}

/**
 * Applies only the validators that belong to the selected scenario. The caller
 * clears the unused values, so a hidden field can never reach the payload.
 */
export function applyScenarioValidation(
  form: RunStartFormGroup,
  scenario: RunScenario,
): void {
  const failureStepId = form.controls.failureStepId;
  const errorProbability = form.controls.errorProbability;

  if (scenario === 'FORCED_FAILURE') {
    failureStepId.setValidators([Validators.required]);
    errorProbability.clearValidators();
  } else if (scenario === 'RANDOM') {
    errorProbability.setValidators([Validators.required, probabilityValue]);
    failureStepId.clearValidators();
  } else {
    failureStepId.clearValidators();
    errorProbability.clearValidators();
  }

  failureStepId.updateValueAndValidity({ emitEvent: false });
  errorProbability.updateValueAndValidity({ emitEvent: false });
}

/**
 * Builds the exact wire body: only the fields that belong to the selected
 * scenario are present. Invalid input throws instead of inventing a value.
 */
export function buildStartRunRequest(
  planVersionId: string,
  value: RunStartFormValue,
): StartRunRequest {
  const seed = parseSeed(value.seed);
  const base = {
    planVersionId,
    scenario: value.scenario,
    seed,
  };

  if (value.scenario === 'FORCED_FAILURE') {
    const failureStepId = value.failureStepId.trim();
    if (failureStepId.length === 0) {
      throw new Error('A failure step is required for the FORCED_FAILURE scenario.');
    }

    return { ...base, failureStepId };
  }

  if (value.scenario === 'RANDOM') {
    const errorProbability = value.errorProbability.trim();
    if (
      errorProbability.length === 0 ||
      validateProbability(errorProbability) !== null
    ) {
      throw new Error('A decimal error probability between 0 and 1 is required.');
    }

    return { ...base, errorProbability };
  }

  return base;
}

function parseSeed(raw: string): number {
  const trimmed = raw.trim();
  const value = Number(trimmed);

  if (
    !UINT32_PATTERN.test(trimmed) ||
    !Number.isSafeInteger(value) ||
    value < MIN_SEED ||
    value > MAX_SEED
  ) {
    throw new Error('The seed must be an integer from 0 to 4294967295.');
  }

  return value;
}

/** One random uint32, rendered as the decimal text the seed input expects. */
export function generateSeed(): string {
  const values = new Uint32Array(1);
  globalThis.crypto.getRandomValues(values);
  return String(values[0]);
}

/** RFC 4122 version 4 key for one logical start attempt. */
export function generateIdempotencyKey(): string {
  if (typeof globalThis.crypto.randomUUID === 'function') {
    return globalThis.crypto.randomUUID();
  }

  const bytes = new Uint8Array(16);
  globalThis.crypto.getRandomValues(bytes);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x40;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');

  return [
    hex.slice(0, 8),
    hex.slice(8, 12),
    hex.slice(12, 16),
    hex.slice(16, 20),
    hex.slice(20),
  ].join('-');
}

/**
 * Keeps the idempotency key stable for the same logical request and replaces it
 * only when the request content changes. A network failure and a retry of the
 * same values therefore reuse the key; editing a setting starts a new attempt.
 */
export class RunStartAttempt {
  private key: string | null = null;
  private fingerprint: string | null = null;

  constructor(private readonly createKey: () => string = generateIdempotencyKey) {}

  keyFor(request: StartRunRequest): string {
    const fingerprint = requestFingerprint(request);

    if (this.key === null || this.fingerprint !== fingerprint) {
      this.key = this.createKey();
      this.fingerprint = fingerprint;
    }

    return this.key;
  }

  reset(): void {
    this.key = null;
    this.fingerprint = null;
  }
}

function requestFingerprint(request: StartRunRequest): string {
  return JSON.stringify([
    request.planVersionId,
    request.scenario,
    request.seed,
    request.failureStepId ?? null,
    request.errorProbability ?? null,
  ]);
}
