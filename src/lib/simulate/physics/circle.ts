/**
 * Horizontal circle for the front-left foot.
 *
 * The path is defined in the world frame (+X forward, +Y left, +Z up), not
 * in the body frame. Inverse kinematics later converts each point through the
 * measured base pose. The radius is the requested radius. Nothing here
 * shrinks it to make a point reachable.
 *
 * A constant angular speed would leave the Lift stage, where the target
 * velocity is zero, with a sideways speed of R·2π/T. The angle instead
 * follows smootherstep, so target velocity and acceleration are zero at both
 * ends. Draw therefore meets Lift and Hold without a velocity step.
 */

import { dist, type Vec3 } from '../go2/math.ts';

export type DrawDirection = 'ccw' | 'cw';

export interface CirclePath {
  /** Commanded foot position at the end of Lift. The path starts and ends here. */
  anchor: Vec3;
  radiusM: number;
  /** Viewed from above. Counterclockwise is the right-hand sense about +Z. */
  direction: DrawDirection;
}

/** How many points are kept for the requested circle in the viewport. */
export const CIRCLE_SAMPLES = 65;

/**
 * Quintic smootherstep. The value, the first derivative, and the second
 * derivative are zero at both 0 and 1.
 */
export function smootherstep(unit: number): number {
  const t = clamp01(unit);
  return t * t * t * (t * (t * 6 - 15) + 10);
}

/**
 * Point on the circle. The centre sits one radius toward world −X from the
 * anchor, so unit 0 and unit 1 are the anchor and the path is closed.
 * `unit` is the stage fraction, before the smootherstep.
 */
export function circlePoint(path: CirclePath, unit: number): Vec3 {
  const theta = Math.PI * 2 * smootherstep(unit);
  const lateral = path.direction === 'cw' ? -Math.sin(theta) : Math.sin(theta);
  return [
    path.anchor[0] + path.radiusM * (Math.cos(theta) - 1),
    path.anchor[1] + path.radiusM * lateral,
    path.anchor[2],
  ];
}

export function circleSamples(path: CirclePath, count = CIRCLE_SAMPLES): Vec3[] {
  const safe = Math.max(2, Math.floor(count));
  const points: Vec3[] = [];
  for (let index = 0; index < safe; index += 1) {
    points.push(circlePoint(path, index / (safe - 1)));
  }
  return points;
}

/** Distance between the commanded foot frame and the measured foot frame. */
export function trackingError(desired: Vec3, achieved: Vec3): number {
  return dist(desired, achieved);
}

export function rmsError(sumSquares: number, count: number): number | null {
  if (count <= 0 || !Number.isFinite(sumSquares)) return null;
  return Math.sqrt(sumSquares / count);
}

/** Horizontal bounding box of a measured trail. */
export function pathSpan(points: readonly Vec3[]): { widthM: number; depthM: number } | null {
  if (points.length < 2) return null;
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const point of points) {
    minX = Math.min(minX, point[0]);
    maxX = Math.max(maxX, point[0]);
    minY = Math.min(minY, point[1]);
    maxY = Math.max(maxY, point[1]);
  }
  if (!Number.isFinite(minX) || !Number.isFinite(minY)) return null;
  return { widthM: maxX - minX, depthM: maxY - minY };
}

function clamp01(unit: number): number {
  if (!Number.isFinite(unit)) return 0;
  return Math.min(1, Math.max(0, unit));
}
