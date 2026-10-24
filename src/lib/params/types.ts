/** A value the parameter panel can edit. Objects and arrays are not controls. */
export type ParamValue = number | boolean | string;

export type ParamKind = 'number' | 'boolean' | 'enum' | 'text';

/**
 * One control, reported by the running sketch.
 * `defaultValue` is the value in the sketch source at Run, not a later edit.
 */
export interface ParamControl {
  key: string;
  kind: ParamKind;
  label: string;
  value: ParamValue;
  defaultValue: ParamValue;
  min?: number;
  max?: number;
  step?: number;
  options?: string[];
}

export interface ParamRejection {
  key: string;
  reason: string;
}

export type ParamPatch = Record<string, ParamValue>;
