import { writable } from 'svelte/store';
import { clearMotionTrail } from './trail.ts';
import { setDuration } from './timeline';
import { isMotionFrame, type MotionFrame, type SketchMotionErrorCode } from './types';

/**
 * Latest validated motion sample.
 *
 * Phase 02B's Three.js adapter should read `frame` and pass it to
 * `SimulationAdapter.applyFrame`. Do not sample `motion(t)` again and do not
 * start another clock. `frame` is canvas space: seconds, both brushes, contact.
 * It is one pose, not a history. Joint angles are not computed here.
 *
 * `durationSeconds` on the timeline is updated from the sketch's `scorePeriod()`.
 * A timeout does not clear a duration the sketch already declared.
 */

export type MotionSampleErrorCode = SketchMotionErrorCode | 'timeout';

export interface MotionOutputState {
  status: 'idle' | 'ok' | 'error';
  frame: MotionFrame | null;
  errorCode: MotionSampleErrorCode | null;
  errorMessage: string | null;
  canvas: { width: number; height: number } | null;
  runId: string | null;
}

export interface MotionSampleEvent {
  runId: string;
  frame: unknown;
  errorCode: MotionSampleErrorCode | null;
  errorMessage: string | null;
  durationSeconds: number | null;
  canvas: { width: number; height: number } | null;
}

const INITIAL: MotionOutputState = {
  status: 'idle',
  frame: null,
  errorCode: null,
  errorMessage: null,
  canvas: null,
  runId: null,
};

const store = writable<MotionOutputState>(INITIAL);

export const motionOutput = { subscribe: store.subscribe };

export function publishMotionSample(sample: MotionSampleEvent): void {
  const canvas = sample.canvas;
  if (sample.errorCode) {
    store.set({
      status: 'error',
      frame: null,
      errorCode: sample.errorCode,
      errorMessage: sample.errorMessage ?? 'Motion sampling failed.',
      canvas,
      runId: sample.runId,
    });
    if (sample.errorCode !== 'timeout') setDuration(sample.durationSeconds);
    return;
  }

  if (!isMotionFrame(sample.frame)) {
    store.set({
      status: 'error',
      frame: null,
      errorCode: 'invalid',
      errorMessage:
        sample.errorMessage ??
        'motion(t) did not return a frame with finite x, y, and a contact boolean for both brushes.',
      canvas,
      runId: sample.runId,
    });
    setDuration(sample.durationSeconds);
    return;
  }

  store.set({
    status: 'ok',
    frame: sample.frame,
    errorCode: null,
    errorMessage: null,
    canvas,
    runId: sample.runId,
  });
  setDuration(sample.durationSeconds);
}

export function clearMotionOutput(): void {
  store.set(INITIAL);
  clearMotionTrail();
  setDuration(null);
}
