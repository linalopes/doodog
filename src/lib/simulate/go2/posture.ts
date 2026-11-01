/**
 * Geometric drawing posture for one solved leg.
 *
 * Position reach stays the existing inverse-kinematics result. These checks
 * do not replace it and they are not a physics result. A check is `valid`,
 * `invalid`, or `not-evaluated`. An unimplemented mesh intersection is never
 * reported as valid.
 *
 * Frames are metres and radians, +X forward, +Y left, +Z up. The brush axis
 * is the kinematic mount offset rotated by the foot orientation: the same
 * vector the Three.js shaft draws. For the default mount that vector is
 * (0.035, 0, −0.045) in the foot frame, which is also the default
 * BrushCalibration tip measured from the attachment. It is not world −Z.
 *
 * The paper has yaw and no pitch or roll, so its normal is world +Z. The
 * drawing direction compared here is the opposite normal, world −Z, the
 * direction into the sheet. The angle is 0 when the brush points straight
 * into the sheet. The default tolerance is 25°.
 *
 * Collision primitives below are the MJCF sizes in `go2.xml` (foot sphere,
 * thigh box, calf cylinders, torso box, head sphere). Triangle meshes are
 * not tested.
 */

import { DEFAULT_BRUSH_OFFSET, type SimConfig } from './defaults.ts';
import {
  clampAngles,
  forwardLeg,
  legFrames,
  REACH_TOLERANCE_M,
  referenceAngles,
  solveLeg,
  type LegSolution,
} from './kinematics.ts';
import { BODY_POSITION, LEGS, type LegId, type LegSpec } from './model.ts';
import {
  add,
  dist,
  norm,
  quatMul,
  quatRotate,
  scale,
  sub,
  yawPoint,
  type Angles,
  type Quat,
  type Transform,
  type Vec3,
} from './math.ts';

export type CheckStatus = 'valid' | 'invalid' | 'not-evaluated';

/** Angle between the brush axis and the inward paper normal. */
export const BRUSH_AXIS_TOLERANCE_RAD = (25 * Math.PI) / 180;

/** Foot collision sphere radius from the MJCF `foot` class. */
export const FOOT_SPHERE_RADIUS_M = 0.022;

/** A joint within this distance of a limit is reported as near it. */
export const JOINT_NEAR_LIMIT_RAD = (2 * Math.PI) / 180;

const INWARD_NORMAL: Vec3 = [0, 0, -1];
const TORSO_HALF: Vec3 = [0.1881, 0.04675, 0.057];
const HEAD_SPHERE_LOCAL: Vec3 = [0.293, 0, -0.06];
const HEAD_SPHERE_RADIUS_M = 0.047;

interface CylinderGeom {
  pos: Vec3;
  quat: Quat;
  radius: number;
  halfLength: number;
}

interface BoxGeom {
  pos: Vec3;
  quat: Quat;
  half: Vec3;
}

const THIGH_BOX: BoxGeom = {
  pos: [0, 0, -0.1065],
  quat: [0.707107, 0, 0.707107, 0],
  half: [0.1065, 0.01225, 0.017],
};

const CALF_LEFT: readonly CylinderGeom[] = [
  { pos: [0.008, 0, -0.06], quat: [0.994493, 0, -0.104807, 0], radius: 0.012, halfLength: 0.06 },
  { pos: [0.02, 0, -0.148], quat: [0.999688, 0, 0.0249974, 0], radius: 0.011, halfLength: 0.0325 },
];

const CALF_RIGHT: readonly CylinderGeom[] = [
  { pos: [0.01, 0, -0.06], quat: [0.995004, 0, -0.0998334, 0], radius: 0.013, halfLength: 0.06 },
  { pos: [0.02, 0, -0.148], quat: [0.999688, 0, 0.0249974, 0], radius: 0.011, halfLength: 0.0325 },
];

export interface PostureReport {
  positionReached: boolean;
  positionErrorM: number;
  joints: CheckStatus;
  nearLimit: boolean;
  floor: CheckStatus;
  /** Foot-sphere surface relative to z = 0. Positive is above the floor. */
  footClearanceM: number;
  /** Lowest tested primitive surface relative to z = 0. */
  linkClearanceM: number;
  contralateral: CheckStatus;
  /** Foot sphere, calf samples, thigh box, and head sphere against the torso box. */
  torso: CheckStatus;
  /** Triangle meshes are not intersected. */
  mesh: 'not-evaluated';
  brush: CheckStatus;
  /** Unit vector from the foot origin toward the tip, in world axes. */
  brushAxis: Vec3;
  /** Radians from world −Z. */
  brushAngleRad: number;
  toleranceRad: number;
  /**
   * Invalid when a confirmed check fails. Not evaluated when every confirmed
   * check passed and mesh intersection was not run. Valid is reserved for a
   * pose whose mesh intersection was actually tested and passed.
   */
  drawing: CheckStatus;
}

export interface PostureSolve extends LegSolution {
  alternateFound: boolean;
}

export function brushAxisOf(footRotation: Quat, offset: Vec3): Vec3 {
  const pointed = quatRotate(footRotation, offset);
  const length = norm(pointed);
  if (length < 1e-9) return [0, 0, -1];
  return [pointed[0] / length, pointed[1] / length, pointed[2] / length];
}

/** Angle from `direction` to the inward paper normal, world −Z. */
export function brushAngleToPaper(direction: Vec3): number {
  const length = norm(direction);
  if (length < 1e-9) return Math.PI;
  const cosine = Math.min(1, Math.max(-1, (direction[0] * INWARD_NORMAL[0] + direction[1] * INWARD_NORMAL[1] + direction[2] * INWARD_NORMAL[2]) / length));
  return Math.acos(cosine);
}

export function assessPosture(
  id: LegId,
  joints: Angles,
  brushOffset: Vec3,
  positionErrorM: number,
  toleranceRad = BRUSH_AXIS_TOLERANCE_RAD,
): PostureReport {
  const spec = LEGS[id];
  const pose = forwardLeg(id, joints, brushOffset);
  const frames = legFrames(spec, joints);
  const axis = brushAxisOf(pose.footRotation, brushOffset);
  const brushAngleRad = brushAngleToPaper(axis);
  const footWorld = add(pose.foot, BODY_POSITION);
  const sphereWorld = add(pose.sphere, BODY_POSITION);
  const footClearanceM = sphereWorld[2] - FOOT_SPHERE_RADIUS_M;
  const linkClearanceM = Math.min(footClearanceM, lowestLinkClearance(spec, frames));
  const jointsStatus = jointStatus(spec, pose.joints);
  const floor: CheckStatus = linkClearanceM >= -1e-6 ? 'valid' : 'invalid';
  const contralateral: CheckStatus = footWorld[1] * spec.hipPosition[1] < 0 ? 'invalid' : 'valid';
  const torso = torsoStatus(spec, frames, sphereWorld);
  const offsetLength = Math.hypot(brushOffset[0], brushOffset[1], brushOffset[2]);
  const brush: CheckStatus =
    offsetLength < 1e-6 ? 'not-evaluated' : brushAngleRad <= toleranceRad + 1e-6 ? 'valid' : 'invalid';
  const confirmed = [jointsStatus, floor, contralateral, torso, brush];
  const drawing: CheckStatus = confirmed.some((status) => status === 'invalid')
    ? 'invalid'
    : confirmed.some((status) => status === 'not-evaluated')
      ? 'not-evaluated'
      : 'not-evaluated';
  return {
    positionReached: Number.isFinite(positionErrorM) && positionErrorM <= REACH_TOLERANCE_M,
    positionErrorM,
    joints: jointsStatus,
    nearLimit: nearJointLimit(spec, pose.joints),
    floor,
    footClearanceM,
    linkClearanceM,
    contralateral,
    torso,
    mesh: 'not-evaluated',
    brush,
    brushAxis: axis,
    brushAngleRad,
    toleranceRad,
    drawing,
  };
}

/**
 * Position-only solution, plus any other pose inside the same 5 mm tolerance
 * that fails fewer geometric checks. The search is a pure function of the
 * target. It does not read the previous frame.
 */
export function solveLegPosture(
  id: LegId,
  tipBody: Vec3,
  brushOffset: Vec3,
  toleranceRad = BRUSH_AXIS_TOLERANCE_RAD,
): PostureSolve {
  const baseline = solveLeg(id, tipBody, brushOffset);
  let best = baseline;
  let bestScore = scoreOf(id, baseline, brushOffset, toleranceRad);
  for (const seed of postureSeeds()) {
    const candidate = refineTip(id, tipBody, brushOffset, seed);
    if (candidate.positionErrorM > REACH_TOLERANCE_M) continue;
    const score = scoreOf(id, candidate, brushOffset, toleranceRad);
    if (score + 1e-6 < bestScore) {
      best = candidate;
      bestScore = score;
    }
  }
  const moved =
    Math.abs(best.joints[0] - baseline.joints[0]) > 1e-3 ||
    Math.abs(best.joints[1] - baseline.joints[1]) > 1e-3 ||
    Math.abs(best.joints[2] - baseline.joints[2]) > 1e-3;
  if (!moved) return { ...baseline, alternateFound: false };
  return { ...best, alternateFound: true };
}

/** Coarse sample of downward, clearance-safe, ipsilateral tips on the default sheet. */
export function orientationOnSheet(
  config: SimConfig,
  toleranceRad = BRUSH_AXIS_TOLERANCE_RAD,
): { examined: number; onSheet: number } {
  const spec = LEGS.FL;
  const offset = config.brushes.left.offset;
  const steps = 10;
  let examined = 0;
  let onSheet = 0;
  const halfW = config.paper.widthM / 2;
  const halfH = config.paper.heightM / 2;
  for (let i = 0; i <= steps; i += 1) {
    for (let j = 0; j <= steps; j += 1) {
      for (let k = 0; k <= steps; k += 1) {
        const joints: Angles = [
          spec.abduction.min + ((spec.abduction.max - spec.abduction.min) * i) / steps,
          spec.hip.min + ((spec.hip.max - spec.hip.min) * j) / steps,
          spec.knee.min + ((spec.knee.max - spec.knee.min) * k) / steps,
        ];
        examined += 1;
        const report = assessPosture(spec.id, joints, offset, 0, toleranceRad);
        if (report.brush !== 'valid' || report.floor !== 'valid' || report.contralateral !== 'valid') continue;
        const pose = forwardLeg('FL', joints, offset);
        const tip = add(pose.tip, BODY_POSITION);
        const local = yawPoint(-config.paper.yawRad, [
          tip[0] - config.paper.origin[0],
          tip[1] - config.paper.origin[1],
          tip[2] - config.paper.origin[2],
        ]);
        if (Math.abs(local[0]) <= halfW && Math.abs(local[1]) <= halfH && Math.abs(local[2]) <= 0.008) onSheet += 1;
      }
    }
  }
  return { examined, onSheet };
}

export function defaultMountMatchesCalibration(): boolean {
  return (
    Math.abs(DEFAULT_BRUSH_OFFSET[0] - 0.035) < 1e-9 &&
    Math.abs(DEFAULT_BRUSH_OFFSET[1]) < 1e-9 &&
    Math.abs(DEFAULT_BRUSH_OFFSET[2] + 0.045) < 1e-9
  );
}

function scoreOf(id: LegId, solution: LegSolution, offset: Vec3, toleranceRad: number): number {
  const report = assessPosture(id, solution.joints, offset, solution.positionErrorM, toleranceRad);
  const violations = [report.joints, report.floor, report.contralateral, report.torso, report.brush].filter(
    (status) => status === 'invalid',
  ).length;
  const reference = referenceAngles();
  const drift = Math.hypot(
    solution.joints[0] - reference[0],
    solution.joints[1] - reference[1],
    solution.joints[2] - reference[2],
  );
  return violations * 100 + (report.brushAngleRad * 180) / Math.PI + drift;
}

function postureSeeds(): Angles[] {
  const seeds: Angles[] = [];
  const abduction = [-0.8, -0.4, 0, 0.4, 0.8];
  const hip = [0.4, 0.9, 1.6, 2.4, 3.2];
  const knee = [-1, -1.5, -2.1, -2.6];
  for (const q1 of abduction) {
    for (const q2 of hip) {
      for (const q3 of knee) seeds.push([q1, q2, q3]);
    }
  }
  return seeds;
}

function refineTip(id: LegId, tipBody: Vec3, offset: Vec3, seed: Angles): LegSolution {
  const spec = LEGS[id];
  let joints = clampAngles(spec, seed);
  for (let iter = 0; iter < 10; iter += 1) {
    const pose = forwardLeg(id, joints, offset);
    const error = sub(tipBody, pose.tip);
    if (norm(error) < 1e-5) break;
    const step = dampedStep(id, joints, offset, error);
    if (!step) break;
    const magnitude = norm(step);
    const limited = magnitude > 0.3 ? scale(step, 0.3 / magnitude) : step;
    joints = clampAngles(spec, [joints[0] + limited[0], joints[1] + limited[1], joints[2] + limited[2]]);
  }
  const pose = forwardLeg(id, joints, offset);
  const positionErrorM = dist(pose.tip, tipBody);
  return {
    ...pose,
    joints,
    positionErrorM,
    reachable: positionErrorM <= REACH_TOLERANCE_M,
    onLimit: jointStatus(spec, joints) === 'invalid',
  };
}

function dampedStep(id: LegId, joints: Angles, offset: Vec3, error: Vec3): Vec3 | null {
  const eps = 1e-4;
  const base = forwardLeg(id, joints, offset).tip;
  const columns: number[][] = [];
  for (let axis = 0; axis < 3; axis += 1) {
    const nudged: Angles = [
      joints[0] + (axis === 0 ? eps : 0),
      joints[1] + (axis === 1 ? eps : 0),
      joints[2] + (axis === 2 ? eps : 0),
    ];
    const next = forwardLeg(id, nudged, offset).tip;
    columns.push([(next[0] - base[0]) / eps, (next[1] - base[1]) / eps, (next[2] - base[2]) / eps]);
  }
  const lambda = 0.08;
  const matrix = [0, 1, 2].map((row) =>
    [0, 1, 2].map((col) => {
      let sum = row === col ? lambda * lambda : 0;
      for (let k = 0; k < 3; k += 1) sum += (columns[k]?.[row] ?? 0) * (columns[k]?.[col] ?? 0);
      return sum;
    }),
  );
  const solved = solve3(matrix, error);
  if (!solved) return null;
  const step: number[] = [0, 0, 0];
  for (let col = 0; col < 3; col += 1) {
    let sum = 0;
    for (let row = 0; row < 3; row += 1) sum += (columns[col]?.[row] ?? 0) * (solved[row] ?? 0);
    step[col] = sum;
  }
  return [step[0] ?? 0, step[1] ?? 0, step[2] ?? 0];
}

function solve3(matrix: number[][], rhs: Vec3): Vec3 | null {
  const rows = matrix.map((row, index) => [...row, rhs[index]]);
  for (let col = 0; col < 3; col += 1) {
    let pivot = col;
    for (let row = col + 1; row < 3; row += 1) {
      if (Math.abs(rows[row]?.[col] ?? 0) > Math.abs(rows[pivot]?.[col] ?? 0)) pivot = row;
    }
    const pivotRow = rows[pivot];
    const colRow = rows[col];
    if (!pivotRow || !colRow || Math.abs(pivotRow[col] ?? 0) < 1e-12) return null;
    if (pivot !== col) {
      rows[pivot] = colRow;
      rows[col] = pivotRow;
    }
    const div = rows[col]?.[col] ?? 1;
    for (let row = col + 1; row < 3; row += 1) {
      const target = rows[row];
      if (!target) continue;
      const factor = (target[col] ?? 0) / div;
      for (let k = col; k < 4; k += 1) target[k] = (target[k] ?? 0) - factor * (rows[col]?.[k] ?? 0);
    }
  }
  const value = [0, 0, 0];
  for (let row = 2; row >= 0; row -= 1) {
    let sum = rows[row]?.[3] ?? 0;
    for (let col = row + 1; col < 3; col += 1) sum -= (rows[row]?.[col] ?? 0) * (value[col] ?? 0);
    const diag = rows[row]?.[row] ?? 0;
    if (Math.abs(diag) < 1e-12) return null;
    value[row] = sum / diag;
  }
  return [value[0] ?? 0, value[1] ?? 0, value[2] ?? 0];
}

function jointStatus(spec: LegSpec, joints: Angles): CheckStatus {
  const jointsOn = [
    [joints[0], spec.abduction.min, spec.abduction.max],
    [joints[1], spec.hip.min, spec.hip.max],
    [joints[2], spec.knee.min, spec.knee.max],
  ] as const;
  for (const [value, min, max] of jointsOn) {
    if (value < min - 1e-4 || value > max + 1e-4) return 'invalid';
    if (Math.abs(value - min) < 1e-3 || Math.abs(value - max) < 1e-3) return 'invalid';
  }
  return 'valid';
}

function nearJointLimit(spec: LegSpec, joints: Angles): boolean {
  const pairs = [
    [joints[0], spec.abduction.min, spec.abduction.max],
    [joints[1], spec.hip.min, spec.hip.max],
    [joints[2], spec.knee.min, spec.knee.max],
  ] as const;
  return pairs.some(([value, min, max]) => value - min < JOINT_NEAR_LIMIT_RAD || max - value < JOINT_NEAR_LIMIT_RAD);
}

function lowestLinkClearance(spec: LegSpec, frames: ReturnType<typeof legFrames>): number {
  const samples: number[] = [];
  const sign = spec.thighOffsetY >= 0 ? 1 : -1;
  const hip: CylinderGeom = {
    pos: [0, sign * 0.08, 0],
    quat: normalizeQuat([1, 1, 0, 0]),
    radius: 0.046,
    halfLength: 0.02,
  };
  samples.push(cylinderLowest(frames.hip, hip));
  for (const corner of boxCorners(frames.thigh, THIGH_BOX)) samples.push(corner[2]);
  const calves = sign > 0 ? CALF_LEFT : CALF_RIGHT;
  for (const geom of calves) samples.push(cylinderLowest(frames.calf, geom));
  return Math.min(...samples);
}

function torsoStatus(spec: LegSpec, frames: ReturnType<typeof legFrames>, footSphereWorld: Vec3): CheckStatus {
  const min: Vec3 = [
    BODY_POSITION[0] - TORSO_HALF[0],
    BODY_POSITION[1] - TORSO_HALF[1],
    BODY_POSITION[2] - TORSO_HALF[2],
  ];
  const max: Vec3 = [
    BODY_POSITION[0] + TORSO_HALF[0],
    BODY_POSITION[1] + TORSO_HALF[1],
    BODY_POSITION[2] + TORSO_HALF[2],
  ];
  if (sphereHitsAabb(footSphereWorld, FOOT_SPHERE_RADIUS_M, min, max)) return 'invalid';
  const head = add(BODY_POSITION, HEAD_SPHERE_LOCAL);
  if (dist(footSphereWorld, head) < FOOT_SPHERE_RADIUS_M + HEAD_SPHERE_RADIUS_M) return 'invalid';
  const sign = spec.thighOffsetY >= 0 ? 1 : -1;
  const calves = sign > 0 ? CALF_LEFT : CALF_RIGHT;
  for (const geom of calves) {
    for (const point of cylinderEnds(frames.calf, geom)) {
      const world = add(point, BODY_POSITION);
      if (sphereHitsAabb(world, geom.radius, min, max)) return 'invalid';
    }
  }
  return 'valid';
}

function cylinderLowest(parent: Transform, geom: CylinderGeom): number {
  return Math.min(...cylinderEnds(parent, geom).map((point) => point[2] - geom.radius)) + BODY_POSITION[2];
}

function cylinderEnds(parent: Transform, geom: CylinderGeom): [Vec3, Vec3] {
  const rotation = quatMul(parent.q, normalizeQuat(geom.quat));
  const centre = add(parent.p, quatRotate(parent.q, geom.pos));
  const axis = quatRotate(rotation, [0, 0, 1]);
  return [
    add(centre, scale(axis, geom.halfLength)),
    add(centre, scale(axis, -geom.halfLength)),
  ];
}

function boxCorners(parent: Transform, geom: BoxGeom): Vec3[] {
  const rotation = quatMul(parent.q, normalizeQuat(geom.quat));
  const centre = add(parent.p, quatRotate(parent.q, geom.pos));
  const corners: Vec3[] = [];
  for (const x of [-1, 1]) {
    for (const y of [-1, 1]) {
      for (const z of [-1, 1]) {
        const local: Vec3 = [x * geom.half[0], y * geom.half[1], z * geom.half[2]];
        corners.push(add(centre, quatRotate(rotation, local)));
      }
    }
  }
  return corners.map((corner) => add(corner, BODY_POSITION));
}

export interface BoardBox {
  center: Vec3;
  half: Vec3;
}

/**
 * Foot sphere and calf cylinders against a floor-level board.
 * Triangle meshes are not tested. A `valid` result is not collision-free.
 * A missing or zero-thickness board is not evaluated.
 */
export function boardPrimitiveStatus(id: LegId, joints: Angles, board: BoardBox | null): CheckStatus {
  if (!board || !(board.half[2] > 1e-4)) return 'not-evaluated';
  const spec = LEGS[id];
  const frames = legFrames(spec, joints);
  const pose = forwardLeg(id, joints, [0, 0, 0]);
  const sphere = add(pose.sphere, BODY_POSITION);
  const min: Vec3 = [
    board.center[0] - board.half[0],
    board.center[1] - board.half[1],
    board.center[2] - board.half[2],
  ];
  const max: Vec3 = [
    board.center[0] + board.half[0],
    board.center[1] + board.half[1],
    board.center[2] + board.half[2],
  ];
  if (sphereHitsAabb(sphere, FOOT_SPHERE_RADIUS_M, min, max)) return 'invalid';
  const sign = spec.thighOffsetY >= 0 ? 1 : -1;
  const calves = sign > 0 ? CALF_LEFT : CALF_RIGHT;
  for (const geom of calves) {
    for (const point of cylinderEnds(frames.calf, geom)) {
      const world = add(point, BODY_POSITION);
      if (sphereHitsAabb(world, geom.radius, min, max)) return 'invalid';
    }
  }
  return 'valid';
}

function sphereHitsAabb(centre: Vec3, radius: number, min: Vec3, max: Vec3): boolean {
  let distance = 0;
  for (let index = 0; index < 3; index += 1) {
    const value = centre[index] ?? 0;
    const low = min[index] ?? 0;
    const high = max[index] ?? 0;
    if (value < low) distance += (low - value) * (low - value);
    else if (value > high) distance += (value - high) * (value - high);
  }
  return distance <= radius * radius;
}

function normalizeQuat(quat: Quat): Quat {
  const length = Math.hypot(quat[0], quat[1], quat[2], quat[3]);
  if (length < 1e-12) return [1, 0, 0, 0];
  return [quat[0] / length, quat[1] / length, quat[2] / length, quat[3] / length];
}
