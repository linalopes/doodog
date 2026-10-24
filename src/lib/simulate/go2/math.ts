/**
 * Small rigid-transform helpers for the Go2 kinematic chain.
 *
 * Quaternions are MuJoCo order (w, x, y, z). Positions are metres in the
 * Menagerie frame: +X forward, +Y left, +Z up. Three.js is given this same
 * frame (`camera.up` is +Z). Nothing here converts to Y-up.
 */

export type Vec3 = readonly [number, number, number];
export type Quat = readonly [number, number, number, number];
export type Angles = readonly [number, number, number];

export interface Transform {
  p: Vec3;
  q: Quat;
}

export const IDENTITY_QUAT: Quat = [1, 0, 0, 0];

export function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

export function sub(a: Vec3, b: Vec3): Vec3 {
  return [a[0] - b[0], a[1] - b[1], a[2] - b[2]];
}

export function scale(a: Vec3, s: number): Vec3 {
  return [a[0] * s, a[1] * s, a[2] * s];
}

export function dot(a: Vec3, b: Vec3): number {
  return a[0] * b[0] + a[1] * b[1] + a[2] * b[2];
}

export function norm(a: Vec3): number {
  return Math.hypot(a[0], a[1], a[2]);
}

export function dist(a: Vec3, b: Vec3): number {
  return norm(sub(a, b));
}

export function quatFromAxisAngle(axis: Vec3, angle: number): Quat {
  const half = angle * 0.5;
  const s = Math.sin(half);
  return [Math.cos(half), axis[0] * s, axis[1] * s, axis[2] * s];
}

export function quatMul(a: Quat, b: Quat): Quat {
  const aw = a[0];
  const ax = a[1];
  const ay = a[2];
  const az = a[3];
  const bw = b[0];
  const bx = b[1];
  const by = b[2];
  const bz = b[3];
  return [
    aw * bw - ax * bx - ay * by - az * bz,
    aw * bx + ax * bw + ay * bz - az * by,
    aw * by - ax * bz + ay * bw + az * bx,
    aw * bz + ax * by - ay * bx + az * bw,
  ];
}

export function quatRotate(q: Quat, v: Vec3): Vec3 {
  const w = q[0];
  const x = q[1];
  const y = q[2];
  const z = q[3];
  const vx = v[0];
  const vy = v[1];
  const vz = v[2];
  const tx = 2 * (y * vz - z * vy);
  const ty = 2 * (z * vx - x * vz);
  const tz = 2 * (x * vy - y * vx);
  return [
    vx + w * tx + (y * tz - z * ty),
    vy + w * ty + (z * tx - x * tz),
    vz + w * tz + (x * ty - y * tx),
  ];
}

export function compose(parent: Transform, localPosition: Vec3, localRotation: Quat): Transform {
  return {
    p: add(parent.p, quatRotate(parent.q, localPosition)),
    q: quatMul(parent.q, localRotation),
  };
}

/** Yaw about +Z. Pitch and roll of the paper are not represented. */
export function yawPoint(yaw: number, v: Vec3): Vec3 {
  const c = Math.cos(yaw);
  const s = Math.sin(yaw);
  return [c * v[0] - s * v[1], s * v[0] + c * v[1], v[2]];
}

export function finiteVec(v: Vec3): boolean {
  return Number.isFinite(v[0]) && Number.isFinite(v[1]) && Number.isFinite(v[2]);
}

export function finiteAngles(q: Angles): boolean {
  return Number.isFinite(q[0]) && Number.isFinite(q[1]) && Number.isFinite(q[2]);
}
