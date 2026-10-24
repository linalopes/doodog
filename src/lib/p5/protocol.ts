/**
 * Typed postMessage protocol between the Create host and the sandboxed sketch
 * runtime iframe.
 *
 * The host never evaluates sketch source. The iframe never receives host
 * stores or robot handles. `SET_TIME` carries one host time. The iframe
 * redraws up to that time, calls `motion(t)` and `scorePeriod()` there, and
 * answers with one `MOTION_FRAME`. The host keeps a single sample in flight.
 *
 * `SET_PARAMS` updates the live `params` object. It does not re-run the
 * editor source. The iframe answers with `PARAMS_RESULT` and, on the next
 * `SET_TIME`, rebuilds paint from the new values.
 */

import { isMotionFrame, type MotionFrame, type SketchMotionErrorCode } from '../motion/types.ts';
import type { ParamControl, ParamPatch, ParamRejection } from '../params/types.ts';

export type HostMessage =
  | { type: 'RUN_SKETCH'; runId: string; source: string }
  | { type: 'STOP_SKETCH'; runId: string }
  | { type: 'SET_TIME'; runId: string; time: number; serial: number }
  | { type: 'SET_PARAMS'; runId: string; revision: number; params: ParamPatch };

export type SketchErrorPhase = 'loading' | 'setup' | 'draw' | 'runtime';

export type RuntimeLogLevel = 'log' | 'warn' | 'error';

export type RuntimeMessage =
  | { type: 'RUNTIME_READY' }
  | { type: 'SKETCH_STARTED'; runId: string }
  | {
      type: 'SKETCH_RENDERED';
      runId: string;
      canvasWidth?: number;
      canvasHeight?: number;
      renderer?: '2d' | 'webgl' | 'unknown';
    }
  | {
      type: 'SKETCH_ERROR';
      runId: string;
      message: string;
      line?: number;
      column?: number;
      stack?: string;
      phase?: SketchErrorPhase;
    }
  | { type: 'RUNTIME_LOG'; runId: string; level: RuntimeLogLevel; values: string[] }
  | {
      type: 'MOTION_FRAME';
      runId: string;
      serial: number;
      /** Null when `motion(t)` is missing, invalid, or threw. */
      frame: MotionFrame | null;
      errorCode: SketchMotionErrorCode | null;
      errorMessage: string | null;
      /** Positive period, or null when the sketch does not declare one. */
      durationSeconds: number | null;
      canvasWidth: number | null;
      canvasHeight: number | null;
      /**
       * Frames the iframe evaluated while redrawing this request.
       * More than one sample means the host should replace its trail.
       * Omitted on older messages.
       */
      samples?: MotionFrame[] | null;
    }
  | { type: 'PARAMS_SCHEMA'; runId: string; controls: ParamControl[] }
  | {
      type: 'PARAMS_RESULT';
      runId: string;
      revision: number;
      applied: ParamPatch;
      rejected: ParamRejection[];
      values: ParamPatch;
    };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isFiniteNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value);
}

function isNullableFinite(value: unknown): boolean {
  return value === null || isFiniteNumber(value);
}

function isMotionErrorCode(value: unknown): value is SketchMotionErrorCode | null {
  return value === null || value === 'missing' || value === 'invalid' || value === 'threw';
}

const MAX_MOTION_SAMPLES = 320;

function isParamValue(value: unknown): boolean {
  if (typeof value === 'boolean') return true;
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'string' && value.length <= 80;
}

function isParamPatch(value: unknown): value is ParamPatch {
  if (!isRecord(value) || Array.isArray(value)) return false;
  return Object.values(value).every((entry) => isParamValue(entry));
}

function isParamControl(value: unknown): value is ParamControl {
  if (!isRecord(value)) return false;
  if (typeof value.key !== 'string' || value.key.length < 1 || value.key.length > 40) return false;
  if (typeof value.label !== 'string' || value.label.length < 1 || value.label.length > 48) return false;
  if (!isParamValue(value.value) || !isParamValue(value.defaultValue)) return false;
  if (value.kind === 'boolean') return typeof value.value === 'boolean';
  if (value.kind === 'number') {
    return (
      typeof value.value === 'number' &&
      isFiniteNumber(value.min) &&
      isFiniteNumber(value.max) &&
      isFiniteNumber(value.step) &&
      (value.step as number) > 0
    );
  }
  if (value.kind === 'enum') {
    return (
      typeof value.value === 'string' &&
      Array.isArray(value.options) &&
      value.options.length > 0 &&
      value.options.length <= 12 &&
      value.options.every((entry) => typeof entry === 'string' && entry.length > 0 && entry.length <= 40)
    );
  }
  return value.kind === 'text' && typeof value.value === 'string';
}

function isParamControlList(value: unknown): value is ParamControl[] {
  return Array.isArray(value) && value.length <= 24 && value.every((entry) => isParamControl(entry));
}

function isRejectionList(value: unknown): value is ParamRejection[] {
  return (
    Array.isArray(value) &&
    value.length <= 32 &&
    value.every(
      (entry) =>
        isRecord(entry) &&
        typeof entry.key === 'string' &&
        entry.key.length <= 40 &&
        typeof entry.reason === 'string' &&
        entry.reason.length > 0 &&
        entry.reason.length <= 24,
    )
  );
}

function isSampleList(value: unknown): boolean {
  if (value === undefined || value === null) return true;
  if (!Array.isArray(value) || value.length > MAX_MOTION_SAMPLES) return false;
  return value.every((entry) => isMotionFrame(entry));
}

export function isRuntimeMessage(value: unknown): value is RuntimeMessage {
  if (!isRecord(value) || typeof value.type !== 'string') return false;
  switch (value.type) {
    case 'RUNTIME_READY':
      return true;
    case 'SKETCH_STARTED':
      return isNonEmptyString(value.runId);
    case 'SKETCH_RENDERED':
      return (
        isNonEmptyString(value.runId) &&
        (value.canvasWidth === undefined || typeof value.canvasWidth === 'number') &&
        (value.canvasHeight === undefined || typeof value.canvasHeight === 'number') &&
        (value.renderer === undefined ||
          value.renderer === '2d' ||
          value.renderer === 'webgl' ||
          value.renderer === 'unknown')
      );
    case 'SKETCH_ERROR':
      return (
        isNonEmptyString(value.runId) &&
        typeof value.message === 'string' &&
        (value.line === undefined || typeof value.line === 'number') &&
        (value.column === undefined || typeof value.column === 'number') &&
        (value.stack === undefined || typeof value.stack === 'string') &&
        (value.phase === undefined || typeof value.phase === 'string')
      );
    case 'RUNTIME_LOG':
      return (
        isNonEmptyString(value.runId) &&
        (value.level === 'log' || value.level === 'warn' || value.level === 'error') &&
        Array.isArray(value.values) &&
        value.values.every((entry) => typeof entry === 'string')
      );
    case 'MOTION_FRAME':
      return (
        isNonEmptyString(value.runId) &&
        isFiniteNumber(value.serial) &&
        (value.frame === null || isMotionFrame(value.frame)) &&
        isMotionErrorCode(value.errorCode) &&
        (value.errorMessage === null || typeof value.errorMessage === 'string') &&
        isNullableFinite(value.durationSeconds) &&
        isNullableFinite(value.canvasWidth) &&
        isNullableFinite(value.canvasHeight) &&
        isSampleList(value.samples)
      );
    case 'PARAMS_SCHEMA':
      return isNonEmptyString(value.runId) && isParamControlList(value.controls);
    case 'PARAMS_RESULT':
      return (
        isNonEmptyString(value.runId) &&
        isFiniteNumber(value.revision) &&
        isParamPatch(value.applied) &&
        isRejectionList(value.rejected) &&
        isParamPatch(value.values)
      );
    default:
      return false;
  }
}

/** True when a runtime message belongs to an obsolete run. */
export function isStaleRunId(message: RuntimeMessage, activeRunId: string | null): boolean {
  if (message.type === 'RUNTIME_READY') return false;
  if (activeRunId === null) return true;
  return message.runId !== activeRunId;
}
