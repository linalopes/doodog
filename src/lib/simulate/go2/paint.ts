/**
 * Turn solved brush marks into line segments.
 *
 * Desired segments are the canvas request on the paper, including points the
 * leg cannot reach. Paint segments require contact, an active brush, a
 * reachable tip, and geometric proximity to the sheet. A lifted sample never
 * paints. Gaps larger than the preview's paint step are not joined.
 */

import type { Vec3 } from './math.ts';
import type { TrailMark } from './pose.ts';

export const PAINT_GAP_SECONDS = 0.75;

export interface TrailLines {
  desired: Array<[Vec3, Vec3]>;
  achieved: Array<[Vec3, Vec3]>;
  paint: Array<[Vec3, Vec3]>;
}

export function trailLines(marks: readonly TrailMark[], maxGapSeconds = PAINT_GAP_SECONDS): TrailLines {
  const desired: Array<[Vec3, Vec3]> = [];
  const achieved: Array<[Vec3, Vec3]> = [];
  const paint: Array<[Vec3, Vec3]> = [];
  for (const side of ['left', 'right'] as const) {
    const series = marks.filter((mark) => mark.side === side);
    for (let index = 1; index < series.length; index += 1) {
      const prev = series[index - 1];
      const next = series[index];
      if (!prev || !next) continue;
      const dt = next.time - prev.time;
      if (dt <= 1e-6 || dt > maxGapSeconds) continue;
      achieved.push([prev.achieved, next.achieved]);
      if (prev.contactRequested && next.contactRequested) desired.push([prev.desired, next.desired]);
      if (prev.paint && next.paint) paint.push([prev.achieved, next.achieved]);
    }
  }
  return { desired, achieved, paint };
}
