import type { Go2JointState } from '../adapters/types.ts';

/** MuJoCo quaternion order is w, x, y, z. */
export type QuatWxyz = [number, number, number, number];

export const JOINT_ORDER = ['FL', 'FR', 'RL', 'RR'] as const;
export type LegId = (typeof JOINT_ORDER)[number];

export interface PhysicsContact {
  geom1: string;
  geom2: string;
  distanceM: number;
}

export interface ActuatorRange {
  name: string;
  /** Inclusive command limits from the MJCF ctrlrange, in Nm. */
  minNm: number;
  maxNm: number;
}

export interface PhysicsModelInfo {
  timestep: number;
  gravity: [number, number, number];
  massKg: number;
  nq: number;
  nu: number;
  jointNames: string[];
  actuatorNames: string[];
  actuatorRanges: ActuatorRange[];
}

export interface FootState {
  /** Collision-sphere centre in the world frame. */
  sphere: [number, number, number];
  /** Sphere centre height minus the MJCF foot radius. Negative intersects the floor. */
  clearanceM: number;
  /** This foot geom is touching the floor geom. */
  onFloor: boolean;
  /** Mean position of this foot's floor contacts. Null when it is not on the floor. */
  contact: [number, number, number] | null;
  /**
   * Visual foot origin in the world. Calf pose plus the foot offset.
   * Not the collision sphere.
   */
  frame: [number, number, number];
  /** Calf orientation, which is the foot frame orientation. w, x, y, z. */
  frameQuat: QuatWxyz;
}

export interface SupportState {
  /** Feet touching the floor, in FL, FR, RL, RR order. */
  feet: LegId[];
  /** Convex hull of those contact positions, on the ground plane. */
  polygon: [number, number, number][];
  com: [number, number, number];
  comProjection: [number, number];
  /** Positive when the projection is inside the hull. Null when there is no area. */
  marginM: number | null;
  inside: boolean;
  /** FR, RL and RR are all on the floor, so the three-leg triangle is a contact polygon. */
  threeLegFeetDown: boolean;
  threeLegTriangle: [number, number, number][];
  threeLegMarginM: number | null;
  threeLegInside: boolean;
}

export interface PhysicsSnapshot {
  time: number;
  basePosition: [number, number, number];
  baseQuaternion: QuatWxyz;
  rollRad: number;
  pitchRad: number;
  joints: Go2JointState;
  jointVelocity: Go2JointState;
  contactCount: number;
  contacts: PhysicsContact[];
  /** Largest absolute motor command currently stored. */
  maxAbsTorqueNm: number;
  /** Sum of absolute motor commands. */
  effortNm: number;
  torquesNm: number[];
  /** True when the last command was clamped to a ctrlrange. */
  saturated: boolean;
  feet: FootStateMap;
  support: SupportState;
}

export type FootStateMap = Record<LegId, FootState>;

export const PHYSICS_LABEL = 'MuJoCo Physics — Experimental';
