/**
 * Latest list of motion samples for the kinematic trail.
 *
 * Distinct from `motionOutput`, which keeps one frame for the live pose.
 * The list is bounded. A backward seek replaces it with the samples the
 * iframe collected while rebuilding the drawing.
 */

import { writable } from 'svelte/store';
import { mergeMotionSamples } from './sampleList.ts';
import type { MotionFrame } from './types.ts';

const store = writable<MotionFrame[]>([]);

export const motionTrail = { subscribe: store.subscribe };

export function publishMotionSamples(samples: readonly MotionFrame[]): void {
  if (samples.length === 0) return;
  store.update((previous) => mergeMotionSamples(previous, samples));
}

export function clearMotionTrail(): void {
  store.set([]);
}
