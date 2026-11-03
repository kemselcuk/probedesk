import {
  AbstractControl,
  FormControl,
  FormGroup,
  NonNullableFormBuilder,
  ValidationErrors,
  ValidatorFn,
  Validators,
} from '@angular/forms';
import type { SaveDraftStepRequest } from './plans-api.types';

/** Draft limits from docs/measurement-rules.md. */
export const MAX_DRAFT_STEPS = 30;
export const MAX_TOTAL_SAMPLES = 10_000;
export const MAX_NOMINAL_DURATION_MS = 600_000;
export const MAX_DECIMALS = 6;
export const MIN_TOLERANCE = '-1000000000';
export const MAX_TOLERANCE = '1000000000';

const SCALE = 1_000_000n;
const MIN_TOLERANCE_SCALED = -1_000_000_000_000_000n;
const MAX_TOLERANCE_SCALED = 1_000_000_000_000_000n;
// Mirrors the API's canonical DECIMAL_PATTERN: no leading zeros, no exponent,
// no comma, no surrounding whitespace.
const DECIMAL_PATTERN = /^(-?)(0|[1-9]\d*)(?:\.(\d+))?$/;

export interface StepFormControls {
  readonly clientId: FormControl<string>;
  readonly logicalStepId: FormControl<string>;
  readonly name: FormControl<string>;
  readonly unit: FormControl<string>;
  readonly minimum: FormControl<string>;
  readonly maximum: FormControl<string>;
  readonly sampleCount: FormControl<number>;
  readonly intervalMs: FormControl<number>;
}

/** The typed value of one step row. Decimal values stay strings. */
export interface StepFormValue {
  readonly clientId: string;
  readonly logicalStepId: string;
  readonly name: string;
  readonly unit: string;
  readonly minimum: string;
  readonly maximum: string;
  readonly sampleCount: number;
  readonly intervalMs: number;
}

export type StepFormGroup = FormGroup<StepFormControls>;

export interface NominalTotals {
  readonly stepCount: number;
  readonly totalSamples: number;
  readonly totalDurationMs: number;
}

/** Required after trimming surrounding whitespace. */
export function trimmedRequired(control: AbstractControl): ValidationErrors | null {
  const value: unknown = control.value;
  if (typeof value !== 'string') {
    return value === null || value === undefined ? { required: true } : null;
  }

  return value.trim().length === 0 ? { required: true } : null;
}

/** Maximum character count after trimming surrounding whitespace. */
export function trimmedMaxLength(max: number): ValidatorFn {
  return (control: AbstractControl): ValidationErrors | null => {
    if (typeof control.value !== 'string') {
      return null;
    }

    const actualLength = control.value.trim().length;
    return actualLength > max ? { maxlength: { requiredLength: max, actualLength } } : null;
  };
}

/**
 * Canonical decimal input: optional minus, digits, and an optional dot with at
 * most six decimals. Scientific notation, commas and blank values are rejected.
 */
export function decimalString(control: AbstractControl): ValidationErrors | null {
  const value: unknown = control.value;
  if (typeof value !== 'string' || value.trim().length === 0) {
    return null;
  }

  const match = DECIMAL_PATTERN.exec(value.trim());
  if (match === null) {
    return { decimalFormat: true };
  }

  const fraction = match[3] ?? '';
  if (fraction.length > MAX_DECIMALS) {
    return { decimalPlaces: { max: MAX_DECIMALS } };
  }

  const scaled = scaleDecimal(match[1] === '-', match[2] ?? '', fraction);
  return scaled < MIN_TOLERANCE_SCALED || scaled > MAX_TOLERANCE_SCALED
    ? { decimalRange: { min: MIN_TOLERANCE, max: MAX_TOLERANCE } }
    : null;
}

/** Exact scaled integer for a valid decimal string, or null when malformed. */
export function scaledDecimal(value: string): bigint | null {
  const match = DECIMAL_PATTERN.exec(value.trim());
  if (match === null) {
    return null;
  }

  const fraction = match[3] ?? '';
  if (fraction.length > MAX_DECIMALS) {
    return null;
  }

  return scaleDecimal(match[1] === '-', match[2] ?? '', fraction);
}

function scaleDecimal(negative: boolean, whole: string, fraction: string): bigint {
  const scaled = BigInt(whole) * SCALE + BigInt(fraction.padEnd(MAX_DECIMALS, '0'));
  return negative ? -scaled : scaled;
}

/** sampleCount and intervalMs must be whole numbers. */
export function integerValue(control: AbstractControl): ValidationErrors | null {
  const value: unknown = control.value;
  if (value === null || value === undefined || value === '') {
    return null;
  }

  return typeof value === 'number' && Number.isInteger(value) ? null : { integer: true };
}

/** Cross-field rule: minimum must not exceed maximum. */
export function stepRangeValidator(control: AbstractControl): ValidationErrors | null {
  const minimum = control.get('minimum');
  const maximum = control.get('maximum');

  if (minimum === null || maximum === null || minimum.invalid || maximum.invalid) {
    return null;
  }

  const min = scaledDecimal(String(minimum.value ?? ''));
  const max = scaledDecimal(String(maximum.value ?? ''));
  return min !== null && max !== null && min > max ? { minimumGreaterThanMaximum: true } : null;
}

/** Drafts may hold at most 30 steps; zero steps remain saveable. */
export function stepLimitValidator(control: AbstractControl): ValidationErrors | null {
  const steps = control.value;
  if (!Array.isArray(steps)) {
    return null;
  }

  return steps.length > MAX_DRAFT_STEPS
    ? { stepLimit: { max: MAX_DRAFT_STEPS, actual: steps.length } }
    : null;
}

/** Plan-level sample and nominal duration limits. */
export function planTotalsValidator(control: AbstractControl): ValidationErrors | null {
  const totals = nominalTotals(asStepValues(control.value));
  const errors: ValidationErrors = {};

  if (totals.totalSamples > MAX_TOTAL_SAMPLES) {
    errors['totalSamples'] = {
      max: MAX_TOTAL_SAMPLES,
      actual: totals.totalSamples,
    };
  }

  if (totals.totalDurationMs > MAX_NOMINAL_DURATION_MS) {
    errors['totalDuration'] = {
      max: MAX_NOMINAL_DURATION_MS,
      actual: totals.totalDurationMs,
    };
  }

  return Object.keys(errors).length > 0 ? errors : null;
}

export function nominalTotals(steps: readonly StepFormValue[]): NominalTotals {
  let totalSamples = 0;
  let totalDurationMs = 0;

  for (const step of steps) {
    if (!Number.isInteger(step.sampleCount) || !Number.isInteger(step.intervalMs)) {
      continue;
    }

    totalSamples += step.sampleCount;
    totalDurationMs += step.sampleCount * step.intervalMs;
  }

  return {
    stepCount: steps.length,
    totalSamples,
    totalDurationMs,
  };
}

export function createStepFormGroup(
  formBuilder: NonNullableFormBuilder,
  initial?: Partial<StepFormValue>,
): StepFormGroup {
  return formBuilder.group<StepFormControls>(
    {
      clientId: formBuilder.control(initial?.clientId ?? ''),
      logicalStepId: formBuilder.control(initial?.logicalStepId ?? ''),
      name: formBuilder.control(initial?.name ?? '', [trimmedRequired, trimmedMaxLength(100)]),
      unit: formBuilder.control(initial?.unit ?? '', [trimmedRequired, trimmedMaxLength(16)]),
      minimum: formBuilder.control(initial?.minimum ?? '', [trimmedRequired, decimalString]),
      maximum: formBuilder.control(initial?.maximum ?? '', [trimmedRequired, decimalString]),
      sampleCount: formBuilder.control(initial?.sampleCount ?? 10, [
        Validators.required,
        Validators.min(1),
        Validators.max(1000),
        integerValue,
      ]),
      intervalMs: formBuilder.control(initial?.intervalMs ?? 1000, [
        Validators.required,
        Validators.min(100),
        Validators.max(5000),
        integerValue,
      ]),
    },
    { validators: stepRangeValidator },
  );
}

/** Builds the wire step with trimmed names, units and decimal strings. */
export function toSaveDraftStep(value: StepFormValue): SaveDraftStepRequest {
  return {
    logicalStepId: value.logicalStepId,
    name: value.name.trim(),
    unit: value.unit.trim(),
    minimum: value.minimum.trim(),
    maximum: value.maximum.trim(),
    sampleCount: value.sampleCount,
    intervalMs: value.intervalMs,
  };
}

/**
 * Fingerprint of the user-editable draft content. It excludes ids and client
 * bookkeeping so a save response can tell whether edits happened while saving.
 */
export function draftFingerprint(name: string, steps: readonly StepFormValue[]): string {
  return JSON.stringify([
    name.trim(),
    steps.map((step) => [
      step.name.trim(),
      step.unit.trim(),
      step.minimum.trim(),
      step.maximum.trim(),
      step.sampleCount,
      step.intervalMs,
    ]),
  ]);
}

export function formatDuration(totalMs: number): string {
  if (totalMs < 1000) {
    return `${totalMs} ms`;
  }

  if (totalMs < 60_000) {
    return `${(totalMs / 1000).toFixed(1)} s`;
  }

  const minutes = Math.floor(totalMs / 60_000);
  const seconds = Math.round((totalMs % 60_000) / 1000);
  return `${minutes} min ${seconds} s`;
}

function asStepValues(value: unknown): readonly StepFormValue[] {
  return Array.isArray(value) ? (value as StepFormValue[]) : [];
}
