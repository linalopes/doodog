import { get } from 'svelte/store';
import { advanceTimeline, timeline } from './timeline';
import { frameDeltaSeconds } from './timelineMath';

/**
 * Host clock for the shared timeline.
 *
 * `requestAnimationFrame` only schedules the next read. The amount of time
 * added is the elapsed timestamp delta, capped, so a slow or resumed tab does
 * not skip ahead by the wall-clock gap. While playback is paused or stopped,
 * the previous timestamp is dropped so resume does not apply the gap.
 */

let handle = 0;
let lastTimestamp: number | null = null;

function tick(now: number): void {
  if (get(timeline).playState !== 'playing') {
    lastTimestamp = null;
  } else {
    const delta = frameDeltaSeconds(now, lastTimestamp);
    lastTimestamp = now;
    if (delta > 0) advanceTimeline(delta);
  }
  handle = requestAnimationFrame(tick);
}

export function startTimelineClock(): void {
  if (handle !== 0) return;
  if (typeof requestAnimationFrame !== 'function') return;
  handle = requestAnimationFrame(tick);
}

export function stopTimelineClock(): void {
  if (typeof cancelAnimationFrame === 'function') cancelAnimationFrame(handle);
  handle = 0;
  lastTimestamp = null;
}
