/**
 * Pure timeline transitions.
 *
 * The Svelte store in `timeline.ts` commits these results. Tests and the
 * animation-frame clock share this file so playback does not depend on a
 * particular frame rate. A positive `durationSeconds` is one looping period.
 * `null` means the score did not declare a period, and time grows without wrapping.
 */

export type PlayState = 'stopped' | 'playing' | 'paused';

export interface TimelineState {
  /** Seconds from the start of the score. */
  time: number;
  /**
   * One loop, in seconds, when the sketch's `scorePeriod()` returned a finite
   * number greater than zero. `null` means continuous playback: the host does
   * not invent a duration and does not wrap time.
   */
  durationSeconds: number | null;
  playState: PlayState;
  /** Playback speed. 1 plays one score-second per real second. */
  rate: number;
}

export const MIN_PLAYBACK_RATE = 0.1;
export const MAX_PLAYBACK_RATE = 4;
export const PLAYBACK_RATES = [0.25, 0.5, 1, 2, 4] as const;

/** Largest real-time gap applied in one animation frame. */
export const MAX_FRAME_DELTA_SECONDS = 0.25;

/**
 * Scrub range used when a score has no declared period.
 * This is a view of the clock, not an inferred score length.
 */
export const CONTINUOUS_SCRUB_WINDOW_SECONDS = 30;

export type PlaybackMode = 'loop' | 'continuous';

export function normalizeDuration(value: number | null | undefined): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) return null;
  return value;
}

export function playbackMode(durationSeconds: number | null): PlaybackMode {
  return normalizeDuration(durationSeconds) === null ? 'continuous' : 'loop';
}

function sameDuration(a: number | null, b: number | null): boolean {
  if (a === null || b === null) return a === b;
  return Math.abs(a - b) < 1e-4;
}

export function clampTime(seconds: number, durationSeconds: number | null): number {
  if (!Number.isFinite(seconds) || seconds < 0) return 0;
  const duration = normalizeDuration(durationSeconds);
  if (duration !== null && seconds > duration) return duration;
  return seconds;
}

/**
 * Advance a playing timeline by a real-time delta.
 * `deltaSeconds` is elapsed wall time, not a frame count. The caller caps
 * irregular gaps before calling this; the step itself applies the delta it is given.
 */
export function stepTimeline(state: TimelineState, deltaSeconds: number): TimelineState {
  if (state.playState !== 'playing') return state;
  if (!Number.isFinite(deltaSeconds) || deltaSeconds <= 0) return state;

  const rate = Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, state.rate));
  let time = state.time + deltaSeconds * rate;
  if (!Number.isFinite(time) || time < 0) time = 0;

  const duration = normalizeDuration(state.durationSeconds);
  if (duration !== null) time = time % duration;

  if (time === state.time && rate === state.rate && duration === state.durationSeconds) {
    return state;
  }
  return { ...state, time, rate, durationSeconds: duration };
}

/** Real seconds between two `requestAnimationFrame` timestamps, capped. */
export function frameDeltaSeconds(nowMs: number, previousMs: number | null): number {
  if (previousMs === null || !Number.isFinite(nowMs) || !Number.isFinite(previousMs)) return 0;
  const raw = (nowMs - previousMs) / 1000;
  if (!(raw > 0)) return 0;
  return Math.min(raw, MAX_FRAME_DELTA_SECONDS);
}

export function applySeek(state: TimelineState, seconds: number): TimelineState {
  const time = clampTime(seconds, state.durationSeconds);
  if (time === state.time) return state;
  return { ...state, time };
}

export function applyPlayState(state: TimelineState, playState: PlayState): TimelineState {
  const time = playState === 'stopped' ? 0 : state.time;
  if (state.playState === playState && state.time === time) return state;
  return { ...state, playState, time };
}

export function applyDuration(state: TimelineState, durationSeconds: number | null): TimelineState {
  const next = normalizeDuration(durationSeconds);
  if (sameDuration(state.durationSeconds, next)) return state;
  let time = state.time;
  if (next !== null && time > next) time = time % next;
  if (!Number.isFinite(time) || time < 0) time = 0;
  return { ...state, durationSeconds: next, time };
}

export function applyRate(state: TimelineState, rate: number): TimelineState {
  if (!Number.isFinite(rate)) return state;
  const next = Math.min(MAX_PLAYBACK_RATE, Math.max(MIN_PLAYBACK_RATE, rate));
  if (next === state.rate) return state;
  return { ...state, rate: next };
}

export function scrubMaximum(state: Pick<TimelineState, 'time' | 'durationSeconds'>): number {
  const duration = normalizeDuration(state.durationSeconds);
  if (duration !== null) return duration;
  const time = Number.isFinite(state.time) && state.time > 0 ? state.time : 0;
  return Math.max(CONTINUOUS_SCRUB_WINDOW_SECONDS, time);
}
