/**
 * Analysis samples travel beside the playback sample, not through it.
 *
 * The host asks the sandbox for `motion(t)` at a list of times. The iframe
 * does not redraw and the host does not publish those frames to the live
 * timeline, so the Three.js view stays where the artist left it until they
 * seek. A late batch from another run or parameter revision is ignored.
 */

import type { MotionFrame, SketchMotionErrorCode } from '../motion/types.ts';

export interface MotionBatchSample {
  time: number;
  frame: MotionFrame | null;
  errorCode: SketchMotionErrorCode | null;
  errorMessage: string | null;
}

export interface MotionBatchMessage {
  runId: string;
  serial: number;
  revision: number;
  durationSeconds: number | null;
  canvas: { width: number; height: number } | null;
  samples: MotionBatchSample[];
}

type Sender = (times: number[], serial: number, revision: number) => boolean;
type Listener = (message: MotionBatchMessage) => void;

let sender: Sender | null = null;
const listeners = new Set<Listener>();

export function bindMotionBatchSender(next: Sender | null): void {
  sender = next;
}

export function requestMotionBatch(times: number[], serial: number, revision: number): boolean {
  if (!sender) return false;
  return sender(times, serial, revision);
}

export function onMotionBatch(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function dispatchMotionBatch(message: MotionBatchMessage): void {
  for (const listener of listeners) listener(message);
}
