import type { Go2JointState } from '../adapters/types.ts';

/** MuJoCo quaternion order is w, x, y, z. */
export type QuatWxyz = [number, number, number, number];

export interface PhysicsContact {
  geom1: string;
  geom2: string;
  distanceM: number;
}

export interface PhysicsModelInfo {
  timestep: number;
  gravity: [number, number, number];
  massKg: number;
  nq: number;
  nu: number;
  jointNames: string[];
  actuatorNames: string[];
}

export interface PhysicsSnapshot {
  time: number;
  basePosition: [number, number, number];
  baseQuaternion: QuatWxyz;
  joints: Go2JointState;
  contactCount: number;
  contacts: PhysicsContact[];
  /** Largest absolute motor command. The experiment keeps this at 0. */
  maxAbsTorqueNm: number;
}

export const PHYSICS_LABEL = 'MuJoCo Physics — Experimental';

export const JOINT_ORDER = ['FL', 'FR', 'RL', 'RR'] as const;
