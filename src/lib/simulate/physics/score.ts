/**
 * Creative-score samples for the aerial FL experiment.
 *
 * The sandbox is the only place that evaluates `motion(t)`. This module stores
 * the samples it already returned and turns one selected brush into a
 * horizontal path around a later drawing origin. It does not stretch the
 * drawing onto the 0.20 m paper and it does not resize it to the reachable
 * workspace. The longer canvas side maps to the configured gesture envelope.
 * The shorter side keeps the canvas aspect ratio.
 *
 * Contact is creative metadata. It is never blended, and it does not mean the
 * foot touches paper.
 */

import { sampleTimes } from '../diagnostics/range.ts';
import type { Vec3 } from '../go2/math.ts';

export const MAX_SCORE_SAMPLES = 320;
export const DEFAULT_SCORE_INTERVAL_S = 0.05;
/** A brush that barely leaves one pixel cluster is not a drawing gesture. */
export const MIN_TRAVEL_PX = 4;
/** A sample step this large, relative to the canvas, is a jump, not a stroke. */
export const JUMP_FRACTION = 0.12;

export type ScoreChannel = 'left' | 'right';
export type ScoreKind = 'period' | 'window';

export interface ScorePoint {
  time: number;
  x: number;
  y: number;
  contact: boolean;
}

export interface ScoreBuffer {
  version: number;
  runId: string;
  revision: number;
  channel: ScoreChannel;
  ignoredChannel: ScoreChannel;
  sketchName: string;
  canvasWidth: number;
  canvasHeight: number;
  gestureSizeM: number;
  /** Metres per canvas pixel. The same value on both axes. */
  scaleM: number;
  spanWidthM: number;
  spanHeightM: number;
  kind: ScoreKind;
  scoreStart: number;
  scoreEnd: number;
  interval: number;
  widened: boolean;
  travelPx: number;
  /** Creative parameter values captured when this buffer was sampled. */
  paramSnapshot: Record<string, string | number | boolean>;
  points: ScorePoint[];
}

export interface ScoreSample {
  time: number;
  x: number;
  y: number;
  contact: boolean;
  /** True when this instant sits on a jump and was not blended across it. */
  held: boolean;
}

export interface ScorePlan {
  times: number[];
  interval: number;
  widened: boolean;
  kind: ScoreKind;
  scoreStart: number;
  scoreEnd: number;
}

export function otherChannel(channel: ScoreChannel): ScoreChannel {
  return channel === 'left' ? 'right' : 'left';
}

/** Longer canvas side → gesture envelope. Proportions stay as drawn. */
export function gestureScale(canvasWidth: number, canvasHeight: number, gestureSizeM: number): number {
  return gestureSizeM / Math.max(canvasWidth, canvasHeight, 1);
}

export function planScoreTimes(input: {
  durationSeconds: number | null;
  windowSeconds: number;
  interval?: number;
}): ScorePlan {
  const finite = input.durationSeconds !== null && input.durationSeconds > 0;
  const scoreStart = 0;
  const scoreEnd = finite ? input.durationSeconds! : Math.max(0.5, input.windowSeconds);
  const planned = sampleTimes(scoreStart, scoreEnd, input.interval ?? DEFAULT_SCORE_INTERVAL_S, MAX_SCORE_SAMPLES);
  return {
    times: planned.times,
    interval: planned.interval,
    widened: planned.widened,
    kind: finite ? 'period' : 'window',
    scoreStart,
    scoreEnd,
  };
}

export function travelPixels(points: readonly ScorePoint[]): number {
  if (points.length === 0) return 0;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point.x);
    maxX = Math.max(maxX, point.x);
    minY = Math.min(minY, point.y);
    maxY = Math.max(maxY, point.y);
  }
  return Math.hypot(maxX - minX, maxY - minY);
}

export function scoreMoves(points: readonly ScorePoint[]): boolean {
  return travelPixels(points) >= MIN_TRAVEL_PX;
}

/**
 * Physics seconds for the Track stage, including the approach.
 * Score time advances at `rate` score-seconds per physics-second.
 */
export function trackStageSeconds(buffer: Pick<ScoreBuffer, 'scoreStart' | 'scoreEnd'>, rate: number, approachSeconds: number): number {
  const span = Math.max(0, buffer.scoreEnd - buffer.scoreStart);
  return approachSeconds + span / Math.max(rate, 0.1);
}

export function buildScoreBuffer(input: {
  version: number;
  runId: string;
  revision: number;
  channel: ScoreChannel;
  sketchName: string;
  canvasWidth: number;
  canvasHeight: number;
  gestureSizeM: number;
  plan: ScorePlan;
  points: ScorePoint[];
  paramSnapshot?: Record<string, string | number | boolean>;
}): ScoreBuffer | { error: string } {
  if (input.points.length < 2) return { error: 'The creative score returned fewer than two samples.' };
  for (const point of input.points) {
    if (![point.time, point.x, point.y].every(Number.isFinite)) {
      return { error: 'The creative score returned a sample that is not a finite position.' };
    }
  }
  const travelPx = travelPixels(input.points);
  if (travelPx < MIN_TRAVEL_PX) {
    return {
      error: `The ${input.channel} brush does not move in this score. The other brush was not used instead.`,
    };
  }
  const scaleM = gestureScale(input.canvasWidth, input.canvasHeight, input.gestureSizeM);
  return {
    version: input.version,
    runId: input.runId,
    revision: input.revision,
    channel: input.channel,
    ignoredChannel: otherChannel(input.channel),
    sketchName: input.sketchName,
    canvasWidth: input.canvasWidth,
    canvasHeight: input.canvasHeight,
    gestureSizeM: input.gestureSizeM,
    scaleM,
    spanWidthM: input.canvasWidth * scaleM,
    spanHeightM: input.canvasHeight * scaleM,
    kind: input.plan.kind,
    scoreStart: input.plan.scoreStart,
    scoreEnd: input.plan.scoreEnd,
    interval: input.plan.interval,
    widened: input.plan.widened,
    travelPx,
    paramSnapshot: input.paramSnapshot ?? {},
    points: input.points,
  };
}

function jumpLimit(buffer: ScoreBuffer): number {
  return JUMP_FRACTION * Math.hypot(buffer.canvasWidth, buffer.canvasHeight);
}

/** Step contact. Hold position across a spatial jump. Lerp ordinary strokes. */
export function sampleScore(buffer: ScoreBuffer, scoreTime: number): ScoreSample {
  const points = buffer.points;
  const first = points[0]!;
  const last = points[points.length - 1]!;
  const time = Math.min(Math.max(scoreTime, first.time), last.time);
  let index = 0;
  while (index < points.length - 2 && points[index + 1]!.time < time) index += 1;
  const a = points[index]!;
  const b = points[Math.min(index + 1, points.length - 1)]!;
  if (a === b || b.time <= a.time) {
    return { time, x: a.x, y: a.y, contact: a.contact, held: false };
  }
  const jumped = Math.hypot(b.x - a.x, b.y - a.y) > jumpLimit(buffer);
  if (jumped && time < b.time) {
    return { time, x: a.x, y: a.y, contact: a.contact, held: true };
  }
  const u = (time - a.time) / (b.time - a.time);
  return {
    time,
    x: a.x + (b.x - a.x) * u,
    y: a.y + (b.y - a.y) * u,
    contact: time < b.time ? a.contact : b.contact,
    held: false,
  };
}

/**
 * Canvas centre lands on the drawing origin. Canvas +x follows robot −Y and
 * canvas +y follows robot −X, the same axes as the kinematic paper mapping.
 * Z stays on the aerial plane. The 0.20 m paper is not involved.
 */
export function mapGesture(buffer: ScoreBuffer, origin: Vec3, x: number, y: number): Vec3 {
  const alongX = (x - buffer.canvasWidth / 2) * buffer.scaleM;
  const alongY = (y - buffer.canvasHeight / 2) * buffer.scaleM;
  return [origin[0] - alongY, origin[1] - alongX, origin[2]];
}

/** Separate brush-down and brush-up runs. A spatial jump starts a new run. */
export function splitGesturePaths(buffer: ScoreBuffer, origin: Vec3): { contact: Vec3[][]; travel: Vec3[][] } {
  const contact: Vec3[][] = [];
  const travel: Vec3[][] = [];
  const limit = jumpLimit(buffer);
  let previous: ScorePoint | null = null;
  for (const point of buffer.points) {
    const world = mapGesture(buffer, origin, point.x, point.y);
    const runs = point.contact ? contact : travel;
    const jumped = previous !== null && Math.hypot(point.x - previous.x, point.y - previous.y) > limit;
    const switched = previous !== null && previous.contact !== point.contact;
    let run = runs[runs.length - 1];
    if (!run || jumped || switched) {
      run = [];
      runs.push(run);
      if (switched && !jumped && previous) run.push(mapGesture(buffer, origin, previous.x, previous.y));
    }
    run.push(world);
    previous = point;
  }
  return { contact, travel };
}
