/**
 * Joint-space PD whose output is a torque command.
 *
 * The Go2 MJCF uses `<motor>` actuators, so `data.ctrl` is torque in Nm,
 * not a position. The result is clamped to the ranges passed in. Those
 * ranges come from the model file.
 */

import type { Go2JointState } from '../adapters/types.ts';
import { JOINT_ORDER, type ActuatorRange, type LegId } from './types.ts';
import { PD_KD, PD_KP } from './settings.ts';

export interface PdCommand {
  torques: number[];
  saturated: boolean;
}

export function jointPd(
  joints: Go2JointState,
  velocity: Go2JointState,
  target: Go2JointState,
  previous: Go2JointState | null,
  ranges: readonly ActuatorRange[],
  dt: number,
  gainScale = 1,
): PdCommand {
  const torques: number[] = [];
  let saturated = false;
  let index = 0;
  for (const id of JOINT_ORDER) {
    for (const axis of [0, 1, 2] as const) {
      const measured = component(joints, id, axis);
      const speed = component(velocity, id, axis);
      const desired = component(target, id, axis);
      const prior = previous ? component(previous, id, axis) : desired;
      const targetSpeed = dt > 0 ? (desired - prior) / dt : 0;
      const scale = Number.isFinite(gainScale) ? gainScale : 1;
      const kp = (PD_KP[index] ?? 0) * scale;
      const kd = (PD_KD[index] ?? 0) * scale;
      const raw = kp * (desired - measured) + kd * (targetSpeed - speed);
      const range = ranges[index];
      const min = range?.minNm ?? -23.7;
      const max = range?.maxNm ?? 23.7;
      const clamped = Math.min(max, Math.max(min, Number.isFinite(raw) ? raw : 0));
      if (Math.abs(clamped - raw) > 1e-6) saturated = true;
      torques.push(clamped);
      index += 1;
    }
  }
  return { torques, saturated };
}

function component(joints: Go2JointState, id: LegId, axis: 0 | 1 | 2): number {
  return joints[id][axis] ?? 0;
}
