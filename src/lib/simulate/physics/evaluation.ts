/**
 * Measurements for one physics run.
 *
 * Positions are the kinematic foot frame, the point inverse kinematics
 * commands. They are not the virtual brush tip and not the collision sphere.
 * A negative three-leg margin is a static geometry reading. It is not, by
 * itself, a fall.
 */

import type { Vec3 } from '../go2/math.ts';

export const EVAL_MIN_DT_S = 0.05;
export const EVAL_POINT_CAP = 900;
export const FOOT_FRAME_NOTE =
  'Tracking error is the kinematic foot frame: the point inverse kinematics commands. It is not the virtual brush tip. The default tip is an attachment 35 mm forward of the foot, then a 45 mm shaft along the brush −Z axis. That geometry is not part of these foot-frame errors. Brush-tip error is reported separately and is not contact.';

export type ReturnKind = 'not-reached' | 'held' | 'polygon-redefinition' | 'contact-loss' | 'outside-both';

export interface EvalPoint {
  t: number;
  stage: string;
  /** Commanded foot frame. */
  desired: Vec3;
  /** Measured foot frame. */
  measured: Vec3;
  body: Vec3;
  roll: number;
  pitch: number;
  torque: number;
  saturated: boolean;
  margin3: number | null;
  margin4: number | null;
  /** Support feet on the floor, not counting a distinction of which ones. */
  supportCount: number;
  supportLost: boolean;
  flDown: boolean;
  commanded: boolean;
  /** Front-left joint command and measurement, in radians. */
  jointDesired: Vec3 | null;
  jointMeasured: Vec3 | null;
  /** Tip of the commanded foot pose. Null when this sample is not a brush command. */
  tipDesired?: Vec3 | null;
  /** Tip from the simulated foot frame and its orientation. */
  tipMeasured?: Vec3 | null;
  /** Signed distance of the measured tip to the paper plane. Positive is above. Not contact. */
  tipClearanceM?: number | null;
  tipInside?: boolean | null;
  tipSide?: 'above' | 'on' | 'below' | null;
  tipCommanded?: boolean;
}

export interface EvalLog {
  points: EvalPoint[];
}

export interface ErrorStats {
  samples: number;
  maxM: number;
  rmsM: number | null;
  mean: Vec3;
  meanMagnitudeM: number;
  maxAbs: Vec3;
}

export interface LagEstimate {
  /** Positive when the measured foot matches an earlier command. */
  lagS: number;
  /** RMS after shifting by that lag and removing the mean residual. */
  residualRmsM: number;
  /** Mean measured-minus-desired after the lag shift. */
  offset: Vec3;
  rawRmsM: number;
}

export interface ReturnReport {
  kind: ReturnKind;
  minThreeM: number | null;
  minFourM: number | null;
  flTouchT: number | null;
  note: string;
}

export interface EvaluationSummary {
  footFrame: true;
  samples: number;
  tracking: ErrorStats;
  lag: LagEstimate | null;
  /** RMS of foot-frame error on the slower and faster halves of the command. */
  slowRmsM: number | null;
  fastRmsM: number | null;
  /** Largest distance from an interior command to the chord of its neighbours. */
  sagittaM: number | null;
  /** Largest horizontal body move during tracking, from the first tracking sample. */
  bodyDriftM: number | null;
  maxAbsRollRad: number;
  maxAbsPitchRad: number;
  maxTorqueNm: number;
  saturated: boolean;
  returnReport: ReturnReport;
  chart: EvalPoint[];
  /** Brush-tip command error. Separate from the foot-frame tracking above. */
  tip: ErrorStats;
  tipClearanceMinM: number | null;
  tipClearanceMaxM: number | null;
  tipInside: boolean | null;
  tipSide: 'above' | 'on' | 'below' | null;
}

export function emptyEvalLog(): EvalLog {
  return { points: [] };
}

export function noteEvaluation(log: EvalLog, point: EvalPoint): void {
  const previous = log.points[log.points.length - 1];
  if (previous && point.t - previous.t < EVAL_MIN_DT_S - 1e-9) return;
  if (log.points.length >= EVAL_POINT_CAP) return;
  log.points.push(point);
}

export function errorStats(points: readonly { desired: Vec3; measured: Vec3 }[]): ErrorStats {
  if (points.length === 0) {
    return { samples: 0, maxM: 0, rmsM: null, mean: [0, 0, 0], meanMagnitudeM: 0, maxAbs: [0, 0, 0] };
  }
  let sx = 0;
  let sy = 0;
  let sz = 0;
  let sumSq = 0;
  let maxM = 0;
  let ax = 0;
  let ay = 0;
  let az = 0;
  for (const point of points) {
    const dx = point.measured[0] - point.desired[0];
    const dy = point.measured[1] - point.desired[1];
    const dz = point.measured[2] - point.desired[2];
    sx += dx;
    sy += dy;
    sz += dz;
    const size = Math.hypot(dx, dy, dz);
    sumSq += size * size;
    if (size > maxM) maxM = size;
    ax = Math.max(ax, Math.abs(dx));
    ay = Math.max(ay, Math.abs(dy));
    az = Math.max(az, Math.abs(dz));
  }
  const mean: Vec3 = [sx / points.length, sy / points.length, sz / points.length];
  return {
    samples: points.length,
    maxM,
    rmsM: Math.sqrt(sumSq / points.length),
    mean,
    meanMagnitudeM: Math.hypot(mean[0], mean[1], mean[2]),
    maxAbs: [ax, ay, az],
  };
}

/**
 * Search a few samples of lead and lag. The sample spacing is the resolution.
 * Positive lag means the foot is late relative to the command.
 */
export function estimateLag(points: readonly EvalPoint[], maxLagS = 0.16): LagEstimate | null {
  const track = points.filter((point) => point.commanded && (point.stage === 'track' || point.stage === 'draw'));
  if (track.length < 6) return null;
  const dt = medianDt(track);
  if (!(dt > 0)) return null;
  const shifts = Math.max(1, Math.round(maxLagS / dt));
  const raw = errorStats(track);
  let bestShift = 0;
  let bestRms = raw.rmsM ?? Infinity;
  let bestOffset: Vec3 = raw.mean;
  let bestResidual = residualRms(track, raw.mean);
  for (let shift = -shifts; shift <= shifts; shift += 1) {
    const paired: { desired: Vec3; measured: Vec3 }[] = [];
    for (let index = 0; index < track.length; index += 1) {
      const desired = track[index - shift];
      const measured = track[index];
      if (!desired || !measured) continue;
      paired.push({ desired: desired.desired, measured: measured.measured });
    }
    if (paired.length < 4) continue;
    const stats = errorStats(paired);
    const size = stats.rmsM ?? Infinity;
    const closer = Math.abs(size - bestRms) <= 1e-9 && Math.abs(shift) < Math.abs(bestShift);
    if (size < bestRms - 1e-9 || closer) {
      bestRms = size;
      bestShift = shift;
      bestOffset = stats.mean;
      bestResidual = residualRms(paired, stats.mean);
    }
  }
  return {
    lagS: bestShift * dt,
    residualRmsM: bestResidual,
    offset: bestOffset,
    rawRmsM: raw.rmsM ?? 0,
  };
}

export function classifyReturn(points: readonly EvalPoint[]): ReturnReport {
  const rows = points.filter((point) => point.stage === 'return');
  if (rows.length === 0) {
    return {
      kind: 'not-reached',
      minThreeM: null,
      minFourM: null,
      flTouchT: null,
      note: 'Return has not been sampled.',
    };
  }
  let minThree: number | null = null;
  let minFour: number | null = null;
  let flTouchT: number | null = null;
  let lost = false;
  for (const row of rows) {
    if (row.margin3 !== null) minThree = minThree === null ? row.margin3 : Math.min(minThree, row.margin3);
    if (row.margin4 !== null) minFour = minFour === null ? row.margin4 : Math.min(minFour, row.margin4);
    if (row.flDown && flTouchT === null) flTouchT = row.t;
    if (row.supportLost) lost = true;
  }
  if (lost) {
    return {
      kind: 'contact-loss',
      minThreeM: minThree,
      minFourM: minFour,
      flTouchT,
      note: 'A supporting foot left the floor during Return. That is contact loss, not only a change of polygon.',
    };
  }
  const threeNeg = minThree !== null && minThree < -0.001;
  const fourNeg = minFour !== null && minFour < -0.001;
  if (threeNeg && !fourNeg && flTouchT !== null) {
    return {
      kind: 'polygon-redefinition',
      minThreeM: minThree,
      minFourM: minFour,
      flTouchT,
      note: 'The three-leg margin went negative while the front-left foot was down and the four-foot margin stayed non-negative. The centre of mass was leaving the FR–RL–RR triangle as weight moved back onto four feet. This is not evidence that the body fell.',
    };
  }
  if (threeNeg && (fourNeg || flTouchT === null)) {
    return {
      kind: 'outside-both',
      minThreeM: minThree,
      minFourM: minFour,
      flTouchT,
      note: 'The projection left the reported support area during Return. This is still a static margin, not a measured fall.',
    };
  }
  return {
    kind: 'held',
    minThreeM: minThree,
    minFourM: minFour,
    flTouchT,
    note: 'The three-leg margin stayed non-negative through the sampled Return.',
  };
}

export function speedSplit(points: readonly EvalPoint[]): { slowRmsM: number | null; fastRmsM: number | null } {
  const track = points.filter((point) => point.commanded && (point.stage === 'track' || point.stage === 'draw'));
  if (track.length < 4) return { slowRmsM: null, fastRmsM: null };
  const speeds: { point: EvalPoint; speed: number }[] = [];
  for (let index = 1; index < track.length; index += 1) {
    const previous = track[index - 1];
    const current = track[index];
    if (!previous || !current) continue;
    const dt = current.t - previous.t;
    if (!(dt > 0)) continue;
    const speed = Math.hypot(
      current.desired[0] - previous.desired[0],
      current.desired[1] - previous.desired[1],
      current.desired[2] - previous.desired[2],
    ) / dt;
    speeds.push({ point: current, speed });
  }
  if (speeds.length < 4) return { slowRmsM: null, fastRmsM: null };
  const ordered = [...speeds].sort((a, b) => a.speed - b.speed);
  const mid = Math.floor(ordered.length / 2);
  return {
    slowRmsM: errorStats(ordered.slice(0, mid).map((row) => row.point)).rmsM,
    fastRmsM: errorStats(ordered.slice(mid).map((row) => row.point)).rmsM,
  };
}

/** Distance from each interior command to the chord through its neighbours. */
export function maxSagitta(points: readonly Vec3[]): number | null {
  if (points.length < 3) return null;
  let max = 0;
  for (let index = 1; index < points.length - 1; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    const next = points[index + 1];
    if (!previous || !current || !next) continue;
    max = Math.max(max, pointLineDistance(current, previous, next));
  }
  return max;
}

export function bodyDrift(points: readonly EvalPoint[]): number | null {
  const track = points.filter((point) => point.stage === 'track' || point.stage === 'draw');
  const first = track[0];
  if (!first) return null;
  let max = 0;
  for (const point of track) {
    max = Math.max(max, Math.hypot(point.body[0] - first.body[0], point.body[1] - first.body[1]));
  }
  return max;
}

export function summarizeEvaluation(points: readonly EvalPoint[]): EvaluationSummary {
  const track = points.filter((point) => point.commanded && (point.stage === 'track' || point.stage === 'draw'));
  const tracking = errorStats(track);
  const speeds = speedSplit(points);
  let maxRoll = 0;
  let maxPitch = 0;
  let maxTorque = 0;
  let saturated = false;
  for (const point of track) {
    maxRoll = Math.max(maxRoll, Math.abs(point.roll));
    maxPitch = Math.max(maxPitch, Math.abs(point.pitch));
    maxTorque = Math.max(maxTorque, point.torque);
    if (point.saturated) saturated = true;
  }
  const tips = points.filter((point) => point.tipCommanded && point.tipDesired && point.tipMeasured);
  let tipClearanceMinM: number | null = null;
  let tipClearanceMaxM: number | null = null;
  for (const point of tips) {
    if (point.tipClearanceM == null) continue;
    tipClearanceMinM = tipClearanceMinM === null ? point.tipClearanceM : Math.min(tipClearanceMinM, point.tipClearanceM);
    tipClearanceMaxM = tipClearanceMaxM === null ? point.tipClearanceM : Math.max(tipClearanceMaxM, point.tipClearanceM);
  }
  const lastTip = tips.at(-1);
  return {
    footFrame: true,
    samples: points.length,
    tracking,
    lag: estimateLag(points),
    slowRmsM: speeds.slowRmsM,
    fastRmsM: speeds.fastRmsM,
    sagittaM: maxSagitta(track.map((point) => point.desired)),
    bodyDriftM: bodyDrift(points),
    maxAbsRollRad: maxRoll,
    maxAbsPitchRad: maxPitch,
    maxTorqueNm: maxTorque,
    saturated,
    returnReport: classifyReturn(points),
    chart: decimate(points, 200),
    tip: errorStats(tips.map((point) => ({ desired: point.tipDesired as Vec3, measured: point.tipMeasured as Vec3 }))),
    tipClearanceMinM,
    tipClearanceMaxM,
    tipInside: lastTip?.tipInside ?? null,
    tipSide: lastTip?.tipSide ?? null,
  };
}

export interface ExecutionIdentity {
  mode: string;
  scoreVersion: number | null;
  revision: number | null;
  runId: string | null;
  channel: string | null;
  gestureSizeM: number | null;
  sampleIntervalS: number;
  gainScale: number;
  returnStyle: string;
  rate: number;
  brushLengthM: number;
  brushMountXM: number;
  brushMountYM: number;
  brushMountZM: number;
  brushRollRad: number;
  brushPitchRad: number;
  brushYawRad: number;
  brushClearanceM: number;
  paperOriginX: number;
  paperOriginY: number;
  paperOriginZ: number;
}

export function sameExecution(a: ExecutionIdentity, b: ExecutionIdentity): boolean {
  return (
    a.mode === b.mode &&
    a.scoreVersion === b.scoreVersion &&
    a.revision === b.revision &&
    a.runId === b.runId &&
    a.channel === b.channel &&
    a.gestureSizeM === b.gestureSizeM &&
    a.sampleIntervalS === b.sampleIntervalS &&
    a.gainScale === b.gainScale &&
    a.returnStyle === b.returnStyle &&
    a.rate === b.rate &&
    a.brushLengthM === b.brushLengthM &&
    a.brushMountXM === b.brushMountXM &&
    a.brushMountYM === b.brushMountYM &&
    a.brushMountZM === b.brushMountZM &&
    a.brushRollRad === b.brushRollRad &&
    a.brushPitchRad === b.brushPitchRad &&
    a.brushYawRad === b.brushYawRad &&
    a.brushClearanceM === b.brushClearanceM &&
    a.paperOriginX === b.paperOriginX &&
    a.paperOriginY === b.paperOriginY &&
    a.paperOriginZ === b.paperOriginZ
  );
}

/** Interrupted and idle runs are not baselines. */
export function canKeepBaseline(outcome: string): boolean {
  return outcome === 'completed' || outcome === 'failed';
}

export interface ComparisonRow {
  label: string;
  baseline: string;
  current: string;
  delta: string;
}

export function compareSummaries(baseline: EvaluationSummary, current: EvaluationSummary): ComparisonRow[] {
  return [
    row('Max error', baseline.tracking.maxM, current.tracking.maxM, 'mm'),
    row('RMS error', baseline.tracking.rmsM, current.tracking.rmsM, 'mm'),
    row('Mean offset', baseline.tracking.meanMagnitudeM, current.tracking.meanMagnitudeM, 'mm'),
    row('Lag', baseline.lag?.lagS ?? null, current.lag?.lagS ?? null, 's'),
    row('Lag residual', baseline.lag?.residualRmsM ?? null, current.lag?.residualRmsM ?? null, 'mm'),
    row('Body drift', baseline.bodyDriftM, current.bodyDriftM, 'mm'),
    row('Max torque', baseline.maxTorqueNm, current.maxTorqueNm, 'Nm'),
    row('Return three-leg margin', baseline.returnReport.minThreeM, current.returnReport.minThreeM, 'mm'),
    row('Return four-foot margin', baseline.returnReport.minFourM, current.returnReport.minFourM, 'mm'),
    row('Tip max error', baseline.tip.samples ? baseline.tip.maxM : null, current.tip.samples ? current.tip.maxM : null, 'mm'),
    row('Tip RMS error', baseline.tip.rmsM, current.tip.rmsM, 'mm'),
    row('Tip clearance min', baseline.tipClearanceMinM, current.tipClearanceMinM, 'mm'),
  ];
}

function row(label: string, baseline: number | null, current: number | null, unit: 'mm' | 's' | 'Nm'): ComparisonRow {
  const scale = unit === 'mm' ? 1000 : 1;
  const digits = unit === 's' ? 3 : unit === 'Nm' ? 1 : 1;
  return {
    label,
    baseline: formatMeasure(baseline, scale, digits, unit),
    current: formatMeasure(current, scale, digits, unit),
    delta: formatMeasure(baseline === null || current === null ? null : current - baseline, scale, digits, unit),
  };
}

function formatMeasure(value: number | null, scale: number, digits: number, unit: string): string {
  if (value === null || !Number.isFinite(value)) return '—';
  return `${(value * scale).toFixed(digits)} ${unit}`;
}

function residualRms(points: readonly { desired: Vec3; measured: Vec3 }[], mean: Vec3): number {
  if (points.length === 0) return Infinity;
  let sum = 0;
  for (const point of points) {
    const dx = point.measured[0] - point.desired[0] - mean[0];
    const dy = point.measured[1] - point.desired[1] - mean[1];
    const dz = point.measured[2] - point.desired[2] - mean[2];
    sum += dx * dx + dy * dy + dz * dz;
  }
  return Math.sqrt(sum / points.length);
}

function medianDt(points: readonly EvalPoint[]): number {
  const gaps: number[] = [];
  for (let index = 1; index < points.length; index += 1) {
    const previous = points[index - 1];
    const current = points[index];
    if (!previous || !current) continue;
    const dt = current.t - previous.t;
    if (dt > 0) gaps.push(dt);
  }
  if (gaps.length === 0) return 0;
  gaps.sort((a, b) => a - b);
  return gaps[Math.floor(gaps.length / 2)] ?? 0;
}

function pointLineDistance(point: Vec3, start: Vec3, end: Vec3): number {
  const ab: Vec3 = [end[0] - start[0], end[1] - start[1], end[2] - start[2]];
  const ap: Vec3 = [point[0] - start[0], point[1] - start[1], point[2] - start[2]];
  const length = Math.hypot(ab[0], ab[1], ab[2]);
  if (length < 1e-9) return Math.hypot(ap[0], ap[1], ap[2]);
  const cross = Math.hypot(
    ab[1] * ap[2] - ab[2] * ap[1],
    ab[2] * ap[0] - ab[0] * ap[2],
    ab[0] * ap[1] - ab[1] * ap[0],
  );
  return cross / length;
}

function decimate(points: readonly EvalPoint[], cap: number): EvalPoint[] {
  if (points.length <= cap) return points.map(copyPoint);
  const last = points.length - 1;
  const out: EvalPoint[] = [];
  for (let slot = 0; slot < cap; slot += 1) {
    const index = Math.round((slot / (cap - 1)) * last);
    const point = points[index];
    if (point) out.push(copyPoint(point));
  }
  return out;
}

function copyPoint(point: EvalPoint): EvalPoint {
  return {
    ...point,
    desired: [point.desired[0], point.desired[1], point.desired[2]],
    measured: [point.measured[0], point.measured[1], point.measured[2]],
    body: [point.body[0], point.body[1], point.body[2]],
    jointDesired: point.jointDesired ? [point.jointDesired[0], point.jointDesired[1], point.jointDesired[2]] : null,
    jointMeasured: point.jointMeasured ? [point.jointMeasured[0], point.jointMeasured[1], point.jointMeasured[2]] : null,
    tipDesired: point.tipDesired ? [point.tipDesired[0], point.tipDesired[1], point.tipDesired[2]] : null,
    tipMeasured: point.tipMeasured ? [point.tipMeasured[0], point.tipMeasured[1], point.tipMeasured[2]] : null,
  };
}
