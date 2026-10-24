import { derived, get, writable } from 'svelte/store';
import { clamp } from '../utils/misc';
import {
  applyDuration,
  applyPlayState,
  applyRate,
  applySeek,
  stepTimeline,
  type PlayState,
  type TimelineState,
} from './timelineMath';

/**
 * Timeline — the single source of truth for simulation time.
 *
 * The Create preview and the future Three.js adapter both read `time` from
 * here. `clock.ts` advances it from `requestAnimationFrame` while `playState`
 * is `playing`. Nothing else should keep a clock. p5's own loop is stopped;
 * the sandbox redraws when this time changes.
 *
 * `durationSeconds === null` is continuous playback (the sketch did not return
 * a positive `scorePeriod()`). A positive duration is one loop.
 */

export type { PlayState, TimelineState } from './timelineMath';

const INITIAL: TimelineState = {
  time: 0,
  durationSeconds: null,
  playState: 'stopped',
  rate: 1,
};

const store = writable<TimelineState>(INITIAL);

export const timeline = { subscribe: store.subscribe };

export const timelineTime = derived(store, ($t) => $t.time);
export const timelinePlayState = derived(store, ($t) => $t.playState);

/** Progress 0–1 for a declared looping period; null for continuous playback. */
export const timelineProgress = derived(store, ($t) =>
  $t.durationSeconds && $t.durationSeconds > 0
    ? clamp($t.time / $t.durationSeconds, 0, 1)
    : null,
);

function commit(current: TimelineState, next: TimelineState): void {
  if (next !== current) store.set(next);
}

export function seek(seconds: number): void {
  const current = get(store);
  commit(current, applySeek(current, seconds));
}

export function setDuration(durationSeconds: number | null): void {
  const current = get(store);
  commit(current, applyDuration(current, durationSeconds));
}

export function setPlayState(playState: PlayState): void {
  const current = get(store);
  commit(current, applyPlayState(current, playState));
}

export function setRate(rate: number): void {
  const current = get(store);
  commit(current, applyRate(current, rate));
}

/** Apply one capped real-time delta. No-op unless the timeline is playing. */
export function advanceTimeline(deltaSeconds: number): void {
  const current = get(store);
  commit(current, stepTimeline(current, deltaSeconds));
}

export function resetTimeline(): void {
  store.set(INITIAL);
}
