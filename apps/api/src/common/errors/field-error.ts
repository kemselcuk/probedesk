/**
 * One validation failure attached to a request field. Paths use dotted notation
 * and numeric segments for arrays, for example `steps.1.maximum`.
 */
export interface FieldError {
  path: string;
  code: string;
  message: string;
}
