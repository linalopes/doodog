/**
 * Joint targets for a stance. The foot path is smooth in time. Inverse
 * kinematics only chooses the joint command. It never writes MuJoCo state.
 */

import type { Go2JointState } from '../adapters/types.ts';
import { analyticalFoot, forwardLeg } from '../go2/kinematics.ts';
import { REFERENCE_ANGLES, type LegId } from '../go2/model.ts';
import { quatRotate, sub, type Quat, type Vec3 } from '../go2/math.ts';
import { JOINT_ORDER, type PhysicsSnapshot } from './types.ts';
import { MAX_JOINT_RATE_RAD_PER_SEC, MAX_SHIFT_M } from './settings.ts';
import { centroid, type Planar } from './support.ts';

export interface FootPlan {
  joints: Go2JointState;
  unreachable: LegId[];
}

export function referenceJoints(): Go2JointState {
  const angles: [number, number, number] = [REFERENCE_ANGLES[0], REFERENCE_ANGLES[1], REFERENCE_ANGLES[2]];
  return {
    FL: [angles[0], angles[1], angles[2]],
    FR: [angles[0], angles[1], angles[2]],
    RL: [angles[0], angles[1], angles[2]],
    RR: [angles[0], angles[1], angles[2]],
  };
}

/** Foot-frame origin in the world, from the measured base pose and joint angles. */
export function footWorld(sample: PhysicsSnapshot, id: LegId): Vec3 {
  const local = forwardLeg(id, sample.joints[id], [0, 0, 0]).foot;
  const world = quatRotate(sample.baseQuaternion, local);
  return [
    sample.basePosition[0] + world[0],
    sample.basePosition[1] + world[1],
    sample.basePosition[2] + world[2],
  ];
}

/**
 * World shift that moves the centre of mass toward the triangle centroid.
 * Stopping at the minimum 5 mm margin leaves the front-left foot loaded,
 * so the lift pulls the body down onto that foot. The centroid is the
 * planner's target. The distance is capped. The completion check is still
 * the smaller measured margin.
 */
export function minimumShift(com: Planar, triangle: readonly Planar[]): Vec3 {
  const center = centroid(triangle);
  if (!center) return [0, 0, 0];
  let dx = center[0] - com[0];
  let dy = center[1] - com[1];
  const magnitude = Math.hypot(dx, dy);
  if (magnitude > MAX_SHIFT_M) {
    const scale = MAX_SHIFT_M / magnitude;
    dx *= scale;
    dy *= scale;
  }
  return [dx, dy, 0];
}

/** World point expressed in the body frame. The body pose is the reference, not a joint command. */
export function worldPointToBody(body: Vec3, orientation: Quat, world: Vec3): Vec3 {
  return quatRotate(conjugate(orientation), sub(world, body));
}

export function jointsForFeet(body: Vec3, orientation: Quat, feetWorld: Readonly<Record<LegId, Vec3>>): FootPlan {
  const joints = referenceJoints();
  const unreachable: LegId[] = [];
  for (const id of JOINT_ORDER) {
    const world = feetWorld[id];
    const local = worldPointToBody(body, orientation, world);
    const solved = analyticalFoot(id, local);
    if (!solved) {
      unreachable.push(id);
      continue;
    }
    joints[id] = [solved.joints[0], solved.joints[1], solved.joints[2]];
    if (!solved.reachable) unreachable.push(id);
  }
  return { joints, unreachable };
}

export function limitJointStep(current: Go2JointState | null, desired: Go2JointState, dt: number): Go2JointState {
  if (!current) return copyJoints(desired);
  const maxStep = Math.max(0, MAX_JOINT_RATE_RAD_PER_SEC * dt);
  const next = referenceJoints();
  for (const id of JOINT_ORDER) {
    next[id] = [0, 1, 2].map((axis) => {
      const from = current[id][axis] ?? 0;
      const to = desired[id][axis] ?? from;
      const delta = Math.min(maxStep, Math.max(-maxStep, to - from));
      return from + delta;
    }) as [number, number, number];
  }
  return next;
}

export function copyJoints(joints: Go2JointState): Go2JointState {
  return {
    FL: [joints.FL[0], joints.FL[1], joints.FL[2]],
    FR: [joints.FR[0], joints.FR[1], joints.FR[2]],
    RL: [joints.RL[0], joints.RL[1], joints.RL[2]],
    RR: [joints.RR[0], joints.RR[1], joints.RR[2]],
  };
}

function conjugate(quaternion: Quat): Quat {
  return [quaternion[0], -quaternion[1], -quaternion[2], -quaternion[3]];
}
