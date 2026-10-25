/**
 * Horizontal support geometry.
 *
 * Margin is the signed distance from the centre-of-mass projection to the
 * convex hull of the given points. Positive means inside. This is a static
 * measurement. It is not a stability certificate.
 */

export type Planar = readonly [number, number];

export interface SupportAssessment {
  polygon: Planar[];
  inside: boolean;
  /** Null when the points do not form an area. */
  marginM: number | null;
}

export function assessSupport(com: Planar, points: readonly Planar[]): SupportAssessment {
  const finite = points.filter((point) => Number.isFinite(point[0]) && Number.isFinite(point[1]));
  const polygon = convexHull(finite);
  if (polygon.length < 3 || !Number.isFinite(com[0]) || !Number.isFinite(com[1])) {
    return { polygon, inside: false, marginM: null };
  }
  let margin = Number.POSITIVE_INFINITY;
  for (let index = 0; index < polygon.length; index += 1) {
    const start = polygon[index];
    const end = polygon[(index + 1) % polygon.length];
    if (!start || !end) continue;
    const edgeX = end[0] - start[0];
    const edgeY = end[1] - start[1];
    const length = Math.hypot(edgeX, edgeY);
    if (length < 1e-9) continue;
    const signed = ((end[0] - start[0]) * (com[1] - start[1]) - (end[1] - start[1]) * (com[0] - start[0])) / length;
    margin = Math.min(margin, signed);
  }
  if (!Number.isFinite(margin)) return { polygon, inside: false, marginM: null };
  return { polygon, inside: margin >= -1e-9, marginM: margin };
}

export function centroid(points: readonly Planar[]): Planar | null {
  if (points.length === 0) return null;
  let x = 0;
  let y = 0;
  for (const point of points) {
    x += point[0];
    y += point[1];
  }
  return [x / points.length, y / points.length];
}

/** Andrew's monotone chain. The result is counter-clockwise. */
export function convexHull(points: readonly Planar[]): Planar[] {
  const sorted = [...points].sort((a, b) => a[0] - b[0] || a[1] - b[1]);
  const unique: Planar[] = [];
  for (const point of sorted) {
    const previous = unique[unique.length - 1];
    if (previous && previous[0] === point[0] && previous[1] === point[1]) continue;
    unique.push(point);
  }
  if (unique.length <= 2) return unique;
  const lower: Planar[] = [];
  for (const point of unique) pushHull(lower, point);
  const upper: Planar[] = [];
  for (let index = unique.length - 1; index >= 0; index -= 1) {
    const point = unique[index];
    if (point) pushHull(upper, point);
  }
  lower.pop();
  upper.pop();
  return lower.concat(upper);
}

function pushHull(hull: Planar[], point: Planar): void {
  while (hull.length >= 2) {
    const a = hull[hull.length - 2];
    const b = hull[hull.length - 1];
    if (!a || !b || cross(a, b, point) > 0) break;
    hull.pop();
  }
  hull.push(point);
}

function cross(origin: Planar, a: Planar, b: Planar): number {
  return (a[0] - origin[0]) * (b[1] - origin[1]) - (a[1] - origin[1]) * (b[0] - origin[0]);
}
