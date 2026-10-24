/**
 * Forward and inverse kinematics for the Unitree Go2 legs.
 *
 * Forward kinematics follows the MJCF chain: translate to the body origin,
 * rotate about the joint axis, then place the next body. Inverse kinematics
 * solves the front (or any) leg for a brush tip in the body frame. The knee
 * solution is the negative branch, which is the only one inside the model
 * limits. The result is a pure function of the target and the brush offset,
 * so the same timestamp always produces the same angles.
 *
 * An unreachable target is not clipped into a fake success. The returned
 * angles stay inside the limits, and `reachable` is false when the tip is
 * more than 5 mm from the request. The body is not moved to help the reach.
 */

import { LEGS, REFERENCE_ANGLES, type LegId, type LegSpec } from './model.ts';
import {
  IDENTITY_QUAT,
  add,
  compose,
  dist,
  dot,
  finiteAngles,
  finiteVec,
  norm,
  quatFromAxisAngle,
  quatRotate,
  scale,
  sub,
  type Angles,
  type Quat,
  type Transform,
  type Vec3,
} from './math.ts';

export const REACH_TOLERANCE_M = 0.005;

/** Chain root. The home keyframe translation is applied by the caller. */
const BODY: Transform = { p: [0, 0, 0], q: IDENTITY_QUAT };

export interface LegPose {
  joints: Angles;
  /** Foot-frame origin. The brush offset is expressed here. */
  foot: Vec3;
  footWorld: Vec3;
  /** Collision-sphere centre from the MJCF foot geom. Not the brush. */
  sphere: Vec3;
  sphereWorld: Vec3;
  tip: Vec3;
  tipWorld: Vec3;
  footRotation: Quat;
}

export interface LegSolution extends LegPose {
  positionErrorM: number;
  reachable: boolean;
  /** True when a joint is sitting on a limit. */
  onLimit: boolean;
}

export function referenceAngles(): Angles {
  return [REFERENCE_ANGLES[0], REFERENCE_ANGLES[1], REFERENCE_ANGLES[2]];
}

export function clampAngle(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return (min + max) / 2;
  return Math.min(max, Math.max(min, value));
}

export function clampAngles(leg: LegSpec, q: Angles): Angles {
  return [
    clampAngle(q[0], leg.abduction.min, leg.abduction.max),
    clampAngle(q[1], leg.hip.min, leg.hip.max),
    clampAngle(q[2], leg.knee.min, leg.knee.max),
  ];
}

export function anglesWithinLimits(leg: LegSpec, q: Angles): boolean {
  return (
    q[0] >= leg.abduction.min - 1e-6 &&
    q[0] <= leg.abduction.max + 1e-6 &&
    q[1] >= leg.hip.min - 1e-6 &&
    q[1] <= leg.hip.max + 1e-6 &&
    q[2] >= leg.knee.min - 1e-6 &&
    q[2] <= leg.knee.max + 1e-6
  );
}

function onLimit(leg: LegSpec, q: Angles): boolean {
  const near = (value: number, min: number, max: number) =>
    Math.abs(value - min) < 1e-3 || Math.abs(value - max) < 1e-3;
  return (
    near(q[0], leg.abduction.min, leg.abduction.max) ||
    near(q[1], leg.hip.min, leg.hip.max) ||
    near(q[2], leg.knee.min, leg.knee.max)
  );
}

export function legFrames(spec: LegSpec, joints: Angles): {
  hip: Transform;
  thigh: Transform;
  calf: Transform;
  foot: Transform;
} {
  const q = finiteAngles(joints) ? joints : referenceAngles();
  const hip = compose(BODY, spec.hipPosition, quatFromAxisAngle(spec.abduction.axis, q[0]));
  const thigh = compose(hip, [0, spec.thighOffsetY, 0], quatFromAxisAngle(spec.hip.axis, q[1]));
  const calf = compose(thigh, [0, 0, -spec.thighLength], quatFromAxisAngle(spec.knee.axis, q[2]));
  const foot = compose(calf, spec.footInCalf, IDENTITY_QUAT);
  return { hip, thigh, calf, foot };
}

export function forwardLeg(id: LegId, joints: Angles, brushOffset: Vec3): LegPose {
  const spec = LEGS[id];
  const frames = legFrames(spec, joints);
  const tip = add(frames.foot.p, quatRotate(frames.foot.q, brushOffset));
  const sphere = compose(frames.calf, spec.footSphereInCalf, IDENTITY_QUAT).p;
  return {
    joints: clampAngles(spec, finiteAngles(joints) ? joints : referenceAngles()),
    foot: frames.foot.p,
    footWorld: frames.foot.p,
    sphere,
    sphereWorld: sphere,
    tip,
    tipWorld: tip,
    footRotation: frames.foot.q,
  };
}

/**
 * Body-frame foot target → joint angles, using the two-link geometry.
 * Returns null when the target is inside the hip-link cylinder (no abduction
 * solution). Out-of-reach lengths are clamped to the knee limit and flagged.
 */
export function analyticalFoot(
  id: LegId,
  footBody: Vec3,
): { joints: Angles; reachable: boolean } | null {
  const spec = LEGS[id];
  if (!finiteVec(footBody)) return null;
  const dy = footBody[1] - spec.hipPosition[1];
  const dz = footBody[2] - spec.hipPosition[2];
  const radial = Math.hypot(dy, dz);
  const link = spec.thighOffsetY;
  if (radial < Math.abs(link) - 1e-9) return null;

  const alpha = Math.atan2(dz, dy);
  const ratio = Math.min(1, Math.max(-1, link / radial));
  const delta = Math.acos(ratio);
  const candidates = [alpha + delta, alpha - delta];
  let q1 = candidates[0] ?? 0;
  let best = Infinity;
  for (const candidate of candidates) {
    const clamped = clampAngle(candidate, spec.abduction.min, spec.abduction.max);
    const score = Math.abs(candidate) + (Math.abs(clamped - candidate) > 1e-4 ? 10 : 0);
    if (score < best) {
      best = score;
      q1 = clamped;
    }
  }

  const c1 = Math.cos(q1);
  const s1 = Math.sin(q1);
  const thighOrigin: Vec3 = [
    spec.hipPosition[0],
    spec.hipPosition[1] + spec.thighOffsetY * c1,
    spec.hipPosition[2] + spec.thighOffsetY * s1,
  ];
  const offset = sub(footBody, thighOrigin);
  const localX = offset[0];
  const localZ = -s1 * offset[1] + c1 * offset[2];
  const length = spec.thighLength;
  const d2 = localX * localX + localZ * localZ;
  const cosKnee = d2 / (2 * length * length) - 1;
  let reachable = radial + 1e-6 >= Math.abs(link) && Math.abs(link / radial) <= 1;
  let q3: number;
  if (cosKnee >= 1) {
    reachable = false;
    q3 = spec.knee.max;
  } else if (cosKnee <= -1) {
    reachable = false;
    q3 = spec.knee.min;
  } else {
    q3 = -Math.acos(cosKnee);
    if (q3 < spec.knee.min || q3 > spec.knee.max) {
      reachable = false;
      q3 = clampAngle(q3, spec.knee.min, spec.knee.max);
    }
  }

  const c3 = Math.cos(q3);
  const s3 = Math.sin(q3);
  const det = 2 * (1 + c3);
  let q2: number = REFERENCE_ANGLES[1];
  if (Math.abs(det) < 1e-6) {
    reachable = false;
  } else {
    const bx = -localX / length;
    const bz = -localZ / length;
    const sinq2 = ((1 + c3) * bx - s3 * bz) / det;
    const cosq2 = (s3 * bx + (1 + c3) * bz) / det;
    q2 = wrapHip(Math.atan2(sinq2, cosq2), spec);
    if (q2 < spec.hip.min - 1e-4 || q2 > spec.hip.max + 1e-4) reachable = false;
    q2 = clampAngle(q2, spec.hip.min, spec.hip.max);
  }

  return { joints: [q1, q2, q3], reachable };
}

function wrapHip(angle: number, spec: LegSpec): number {
  const options = [angle - Math.PI * 2, angle, angle + Math.PI * 2];
  let best = clampAngle(angle, spec.hip.min, spec.hip.max);
  let score = Infinity;
  for (const option of options) {
    const inside = option >= spec.hip.min - 1e-6 && option <= spec.hip.max + 1e-6;
    const penalty = inside ? 0 : 5;
    const next = Math.abs(option - REFERENCE_ANGLES[1]) + penalty;
    if (next < score) {
      score = next;
      best = option;
    }
  }
  return best;
}

function tipAt(id: LegId, joints: Angles, offset: Vec3): Vec3 {
  return forwardLeg(id, joints, offset).tip;
}

function jacobian(id: LegId, joints: Angles, offset: Vec3): number[][] {
  const eps = 1e-5;
  const base = tipAt(id, joints, offset);
  const columns: number[][] = [[], [], []];
  for (let axis = 0; axis < 3; axis += 1) {
    const nudged: [number, number, number] = [joints[0], joints[1], joints[2]];
    nudged[axis] = (nudged[axis] ?? 0) + eps;
    const next = tipAt(id, nudged, offset);
    columns[axis] = [(next[0] - base[0]) / eps, (next[1] - base[1]) / eps, (next[2] - base[2]) / eps];
  }
  return [
    [columns[0]?.[0] ?? 0, columns[1]?.[0] ?? 0, columns[2]?.[0] ?? 0],
    [columns[0]?.[1] ?? 0, columns[1]?.[1] ?? 0, columns[2]?.[1] ?? 0],
    [columns[0]?.[2] ?? 0, columns[1]?.[2] ?? 0, columns[2]?.[2] ?? 0],
  ];
}

function solve3(matrix: number[][], rhs: Vec3): Vec3 | null {
  const a = matrix.map((row, index) => [...row, rhs[index]]);
  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 3; row += 1) {
      if (Math.abs(a[row]?.[col] ?? 0) > Math.abs(a[pivot]?.[col] ?? 0)) pivot = row;
    }
    const pivotRow = a[pivot];
    const colRow = a[col];
    if (!pivotRow || !colRow || Math.abs(pivotRow[col] ?? 0) < 1e-12) return null;
    if (pivot !== col) {
      a[pivot] = colRow;
      a[col] = pivotRow;
    }
    const div = a[col]?.[col] ?? 1;
    for (let row = col + 1; row < 3; row += 1) {
      const target = a[row];
      if (!target) continue;
      const factor = (target[col] ?? 0) / div;
      for (let k = col; k < 4; k += 1) target[k] = (target[k] ?? 0) - factor * (a[col]?.[k] ?? 0);
    }
  }
  const x: number[] = [0, 0, 0];
  for (let row = 2; row >= 0; row -= 1) {
    let sum = a[row]?.[3] ?? 0;
    for (let col = row + 1; col < 3; col += 1) sum -= (a[row]?.[col] ?? 0) * (x[col] ?? 0);
    const diag = a[row]?.[row] ?? 0;
    if (Math.abs(diag) < 1e-12) return null;
    x[row] = sum / diag;
  }
  return [x[0] ?? 0, x[1] ?? 0, x[2] ?? 0];
}

function dampedStep(J: number[][], error: Vec3, lambda: number): Vec3 | null {
  const jjt = [0, 1, 2].map((row) =>
    [0, 1, 2].map((col) => {
      let sum = row === col ? lambda * lambda : 0;
      for (let k = 0; k < 3; k += 1) sum += (J[row]?.[k] ?? 0) * (J[col]?.[k] ?? 0);
      return sum;
    }),
  );
  const y = solve3(jjt, error);
  if (!y) return null;
  const step: number[] = [0, 0, 0];
  for (let col = 0; col < 3; col += 1) {
    let sum = 0;
    for (let row = 0; row < 3; row += 1) sum += (J[row]?.[col] ?? 0) * (y[row] ?? 0);
    step[col] = sum;
  }
  return [step[0] ?? 0, step[1] ?? 0, step[2] ?? 0];
}

export function solveLeg(id: LegId, tipBody: Vec3, brushOffset: Vec3): LegSolution {
  const spec = LEGS[id];
  const fallback = forwardLeg(id, referenceAngles(), brushOffset);
  if (!finiteVec(tipBody) || !finiteVec(brushOffset)) {
    return { ...fallback, positionErrorM: Number.POSITIVE_INFINITY, reachable: false, onLimit: false };
  }

  let joints = referenceAngles();
  for (let warm = 0; warm < 3; warm += 1) {
    const foot = forwardLeg(id, joints, [0, 0, 0]);
    const footTarget = sub(tipBody, quatRotate(foot.footRotation, brushOffset));
    const analytic = analyticalFoot(id, footTarget);
    if (!analytic) break;
    joints = clampAngles(spec, analytic.joints);
  }

  for (let iter = 0; iter < 16; iter += 1) {
    const current = tipAt(id, joints, brushOffset);
    const error = sub(tipBody, current);
    if (norm(error) < 1e-5) break;
    const step = dampedStep(jacobian(id, joints, brushOffset), error, 0.05);
    if (!step) break;
    const magnitude = norm(step);
    const limited = magnitude > 0.35 ? scale(step, 0.35 / magnitude) : step;
    joints = clampAngles(spec, [
      joints[0] + limited[0],
      joints[1] + limited[1],
      joints[2] + limited[2],
    ]);
  }

  const pose = forwardLeg(id, joints, brushOffset);
  const positionErrorM = dist(pose.tip, tipBody);
  return {
    ...pose,
    joints,
    positionErrorM,
    reachable: positionErrorM <= REACH_TOLERANCE_M && finiteVec(pose.tip),
    onLimit: onLimit(spec, joints),
  };
}

/** Hip-plane residual. Zero when `point` lies in the leg's sagittal plane. */
export function abductionResidual(id: LegId, joints: Angles, point: Vec3): number {
  const spec = LEGS[id];
  const q1 = joints[0];
  const axis: Vec3 = [0, Math.cos(q1), Math.sin(q1)];
  return dot(sub(point, spec.hipPosition), axis) - spec.thighOffsetY;
}
