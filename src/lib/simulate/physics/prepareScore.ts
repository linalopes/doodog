/**
 * Sample one creative brush through the sandbox, then hand the host a buffer.
 *
 * The physics worker never sees sketch source. Each request is versioned.
 * A late batch from another run, another parameter revision, or an older
 * request is ignored. Failure does not invent a path.
 */

import { get } from 'svelte/store';
import { acceptMotionBatch } from '../diagnostics/analyze.ts';
import { motionOutput } from '../../motion/output.ts';
import { timeline } from '../../motion/timeline.ts';
import { onMotionBatch, requestMotionBatch, type MotionBatchMessage } from '../../p5/motionBatch.ts';
import { paramRevision } from '../../params/store.ts';
import { activeSketch } from '../../sketches/store.ts';
import { ASSUMED_CANVAS } from '../go2/defaults.ts';
import { buildScoreBuffer, planScoreTimes, type ScoreBuffer, type ScoreChannel, type ScorePoint } from './score.ts';

const CHUNK = 32;
const SAMPLE_TIMEOUT_MS = 8000;

export type PrepareResult = { ok: true; buffer: ScoreBuffer } | { ok: false; reason: string };

let prepareToken = 0;
let scoreEpoch = 0;
let serial = 1_000_000;

/** Drop an in-flight sample so its reply cannot become the active trajectory. */
export function invalidateScorePreparation(): void {
  prepareToken += 1;
  scoreEpoch += 1;
}

export function currentScoreEpoch(): number {
  return scoreEpoch;
}

export async function prepareCreativeScore(input: {
  channel: ScoreChannel;
  gestureSizeM: number;
  windowSeconds: number;
}): Promise<PrepareResult> {
  const token = ++prepareToken;
  const output = get(motionOutput);
  if (output.status !== 'ok' || !output.runId) {
    return {
      ok: false,
      reason: 'Run a sketch in Create before tracking. The physics worker does not evaluate sketch source, and no path was invented.',
    };
  }
  const revision = get(paramRevision);
  const runId = output.runId;
  const clock = get(timeline);
  const plan = planScoreTimes({
    durationSeconds: clock.durationSeconds,
    windowSeconds: input.windowSeconds,
  });
  if (plan.times.length < 2) {
    return { ok: false, reason: 'The creative score has no interval to sample. No path was invented.' };
  }
  const points: ScorePoint[] = [];
  let canvas = output.canvas ?? ASSUMED_CANVAS;
  for (let offset = 0; offset < plan.times.length; offset += CHUNK) {
    if (token !== prepareToken) {
      return { ok: false, reason: 'A newer score request replaced this one. Nothing was sent to the robot.' };
    }
    const times = plan.times.slice(offset, offset + CHUNK);
    const ticket = serial;
    serial += 1;
    let message: MotionBatchMessage;
    try {
      message = await requestChunk(times, ticket, revision, runId);
    } catch (error) {
      const text = error instanceof Error ? error.message : 'The sandbox did not return the creative score.';
      return { ok: false, reason: `${text} No path was invented.` };
    }
    if (token !== prepareToken) {
      return { ok: false, reason: 'A newer score request replaced this one. Nothing was sent to the robot.' };
    }
    if (message.durationSeconds !== clock.durationSeconds) {
      return {
        ok: false,
        reason: 'The sketch duration changed while the score was being sampled. The trajectory was discarded.',
      };
    }
    if (message.canvas && message.canvas.width > 0 && message.canvas.height > 0) canvas = message.canvas;
    for (const sample of message.samples) {
      if (!sample.frame) {
        return {
          ok: false,
          reason: sample.errorMessage ?? 'motion(t) did not return a frame. No path was invented.',
        };
      }
      const brush = input.channel === 'left' ? sample.frame.left : sample.frame.right;
      points.push({ time: sample.time, x: brush.x, y: brush.y, contact: brush.contact });
    }
  }
  const built = buildScoreBuffer({
    version: token,
    runId,
    revision,
    channel: input.channel,
    sketchName: get(activeSketch)?.name ?? 'Untitled sketch',
    canvasWidth: canvas.width,
    canvasHeight: canvas.height,
    gestureSizeM: input.gestureSizeM,
    plan,
    points,
  });
  if ('error' in built) return { ok: false, reason: built.error };
  return { ok: true, buffer: built };
}

function requestChunk(times: number[], ticket: number, revision: number, runId: string): Promise<MotionBatchMessage> {
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      unsubscribe();
      callback();
    };
    const timeout = setTimeout(() => {
      finish(() => reject(new Error('The sandbox did not return the creative score in time.')));
    }, SAMPLE_TIMEOUT_MS);
    const unsubscribe = onMotionBatch((message) => {
      if (message.serial !== ticket) return;
      if (message.runId !== runId || message.revision !== revision) {
        finish(() => reject(new Error('The sketch changed while the score was being sampled.')));
        return;
      }
      if (!acceptMotionBatch({ runId, serial: ticket, revision, times }, message)) return;
      finish(() => resolve(message));
    });
    if (!requestMotionBatch(times, ticket, revision)) {
      finish(() => reject(new Error('Run a sketch in Create. The physics worker does not evaluate sketch source.')));
    }
  });
}
