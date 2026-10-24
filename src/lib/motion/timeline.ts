import { derived, get, writable } from 'svelte/store';
import { clamp } from '../utils/misc';

/**
 * Timeline — the single source of truth for time.
 *
 * Every consumer of motion (2D preview, 3D simulation, physics, robot) reads
 * `time` from here instead of keeping its own clock. In Phase 01 nothing
 * advances the timeline yet: the Simulate workspace displays it with controls
 * disabled, and the Create preview still lets p5 use its own `millis()`.
 * Phase 02 will drive `time` from a requestAnimationFrame loop and route it
 * into the sketch runtime, at which point p5 and Three.js share one clock.
 */

export type PlayState = 'stopped' | 'playing' | 'paused';

export interface TimelineState {
  /** Seconds since the start of the motion program. */
  time: number;
  /** Program duration in seconds, or null when the program loops forever. */
  durationSeconds: number | null;
  playState: PlayState;
  /** Playback speed multiplier. 1 = real time. */
  rate: number;
}

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

/** Progress 0–1 for finite programs; null for looping programs. */
export const timelineProgress = derived(store, ($t) =>
  $t.durationSeconds && $t.durationSeconds > 0
    ? clamp($t.time / $t.durationSeconds, 0, 1)
    : null,
);

export function seek(seconds: number): void {
  const current = get(store);
  const max = current.durationSeconds ?? Number.POSITIVE_INFINITY;
  store.set({ ...current, time: clamp(seconds, 0, max) });
}

export function setDuration(durationSeconds: number | null): void {
  const current = get(store);
  store.set({ ...current, durationSeconds });
}

export function setPlayState(playState: PlayState): void {
  const current = get(store);
  store.set({
    ...current,
    playState,
    time: playState === 'stopped' ? 0 : current.time,
  });
}

export function setRate(rate: number): void {
  const current = get(store);
  store.set({ ...current, rate: clamp(rate, 0.1, 4) });
}

export function resetTimeline(): void {
  store.set(INITIAL);
}
