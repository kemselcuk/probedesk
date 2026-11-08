import type { RunReportDto } from './dto/run-report.dto.js';

/**
 * The exact column contract for the terminal-run CSV attachment. The order is
 * part of the API contract and must not be changed without a schema version
 * bump.
 */
export const REPORT_CSV_HEADER = [
  'runId',
  'planName',
  'versionNumber',
  'deviceName',
  'serialNumber',
  'batchNumber',
  'scenario',
  'runStatus',
  'runOutcome',
  'stepPosition',
  'stepName',
  'unit',
  'minimum',
  'maximum',
  'sampleIndex',
  'value',
  'elapsedMs',
  'recordedAt',
  'isWithinTolerance',
] as const;

export const REPORT_CSV_CONTENT_TYPE = 'text/csv; charset=utf-8';
export const REPORT_JSON_CONTENT_TYPE = 'application/json; charset=utf-8';
export const REPORT_CSV_BOM = '\uFEFF';

const CSV_RECORD_SEPARATOR = '\r\n';
const CSV_QUOTE_TRIGGER = /[",\r\n]/;
const FORMULA_TRIGGER = /^[=+\-@]/;
const WHITESPACE = /\s/u;

/**
 * Keeps user text intact while removing the leading characters spreadsheet
 * programs may interpret as a formula. Official numeric columns never pass
 * through this function, so a negative decimal such as "-0.010000" stays
 * exactly as stored.
 */
export function neutraliseReportCsvText(value: string): string {
  if (value.length === 0) {
    return value;
  }

  const first = value.charAt(0);
  const firstCodePoint = value.codePointAt(0) ?? 0;

  return FORMULA_TRIGGER.test(first) ||
    firstCodePoint <= 0x20 ||
    firstCodePoint === 0x7f ||
    WHITESPACE.test(first)
    ? `'${value}`
    : value;
}

/** RFC 4180 quoting: quote only when needed and double embedded quotes. */
export function quoteReportCsvField(value: string): string {
  return CSV_QUOTE_TRIGGER.test(value)
    ? `"${value.replaceAll('"', '""')}"`
    : value;
}

/**
 * Serialises the same projection returned by GET /runs/:id/report. Every
 * recorded measurement becomes exactly one row; an unrecorded sample never
 * becomes a placeholder row. A run without measurements produces a header-only
 * document (plus the UTF-8 BOM and trailing CRLF).
 */
export function serialiseRunReportCsv(report: RunReportDto): string {
  const rows: string[] = [REPORT_CSV_HEADER.join(',')];

  for (const step of report.steps) {
    for (const measurement of step.measurements) {
      rows.push(
        [
          textCell(report.runId),
          userTextCell(report.planName),
          textCell(String(report.versionNumber)),
          userTextCell(report.deviceSnapshot?.name ?? null),
          userTextCell(report.deviceSnapshot?.serialNumber ?? null),
          userTextCell(report.batchNumber),
          textCell(report.scenario),
          textCell(report.status),
          textCell(report.outcome ?? ''),
          textCell(String(step.position)),
          userTextCell(step.name),
          userTextCell(step.unit),
          textCell(step.minimum),
          textCell(step.maximum),
          textCell(String(measurement.sampleIndex)),
          textCell(measurement.value),
          textCell(String(measurement.elapsedMs)),
          textCell(measurement.recordedAt),
          measurement.isWithinTolerance ? 'true' : 'false',
        ].join(','),
      );
    }
  }

  return `${REPORT_CSV_BOM}${rows.join(CSV_RECORD_SEPARATOR)}${CSV_RECORD_SEPARATOR}`;
}

function textCell(value: string): string {
  return quoteReportCsvField(value);
}

function userTextCell(value: string | null): string {
  if (value === null) {
    return '';
  }

  return quoteReportCsvField(neutraliseReportCsvText(value));
}
