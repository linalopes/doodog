/**
 * Typed postMessage protocol between the Create host and the sandboxed sketch
 * runtime iframe.
 *
 * The host never evaluates sketch source. The iframe never receives host
 * stores or (in later phases) robot handles.
 *
 * Planned extension (Phase 02, not implemented here): the host will add
 *   HostMessage    'SET_TIME'      { runId, time }            — timeline → sketch
 *   HostMessage    'SAMPLE_MOTION' { runId, times: number[] } — bake frames
 *   HostMessage    'SET_PARAMS'    { runId, params }          — parameter panel
 *   RuntimeMessage 'MOTION_FRAMES' { runId, frames: MotionFrame[] }
 *   RuntimeMessage 'MOTION_INFO'   { runId, durationSeconds, canvas }
 * so that the same `motion(t)` the sketch draws with is sampled for the robot
 * without any SVG or JSON export step. See README → Architecture.
 */

export type HostMessage =
  | { type: 'RUN_SKETCH'; runId: string; source: string }
  | { type: 'STOP_SKETCH'; runId: string };

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
  | { type: 'RUNTIME_LOG'; runId: string; level: RuntimeLogLevel; values: string[] };

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
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
