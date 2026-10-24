/**
 * Host-side list of motion samples for the kinematic trail.
 *
 * The motion store still keeps one frame. This list is only the samples the
 * iframe already evaluated while redrawing. A multi-sample message replaces
 * the list, which is how a backward seek reconstructs the sheet. A single
 * sample appends, or trims anything later than that time.
 */

import type { MotionFrame } from './types.ts';

export const MAX_MOTION_SAMPLES = 6000;

export function mergeMotionSamples(previous: readonly MotionFrame[], incoming: readonly MotionFrame[]): MotionFrame[] {
  if (incoming.length === 0) return previous.slice();
  if (incoming.length > 1) return incoming.slice(-MAX_MOTION_SAMPLES);
  const next = incoming[0];
  if (!next) return previous.slice();
  if (previous.length === 0) return [next];
  const last = previous[previous.length - 1];
  if (!last) return [next];

  if (next.time + 1e-4 < last.time) {
    const trimmed = previous.filter((frame) => frame.time <= next.time + 1e-6);
    const tail = trimmed[trimmed.length - 1];
    if (tail && Math.abs(tail.time - next.time) < 1e-4) {
      const copy = trimmed.slice();
      copy[copy.length - 1] = next;
      return copy;
    }
    return [...trimmed, next];
  }

  if (Math.abs(next.time - last.time) < 1e-4) {
    const copy = previous.slice();
    copy[copy.length - 1] = next;
    return copy;
  }

  const base = previous.length >= MAX_MOTION_SAMPLES ? previous.slice(previous.length - MAX_MOTION_SAMPLES + 1) : previous.slice();
  base.push(next);
  return base;
}
