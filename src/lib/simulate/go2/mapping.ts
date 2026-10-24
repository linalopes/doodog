/**
 * Canvas units → painting surface.
 *
 * There is no universal pixel-to-metre ratio. Unless a scale is set, one
 * canvas width maps onto the paper's width and one canvas height onto the
 * paper's height, and those two scales may differ. Points outside the sheet
 * are kept; the mapper does not clamp a drawing to make it reachable.
 *
 * p5's canvas has its origin at the top left and +Y downward. The default
 * axes place that sheet in front of the Go2: canvas-right goes to the robot's
 * right (−Y), and canvas-down goes back toward the robot (−X). The paper yaw
 * then rotates that placement about +Z.
 */

import type { BrushTarget } from '../../motion/types.ts';
import { finiteVec, yawPoint, type Vec3 } from './math.ts';

export type HorizontalAxis = 'x' | '-x' | 'y' | '-y';

export interface PaperConfig {
  widthM: number;
  heightM: number;
  /** Centre of the sheet, on the paper plane, in world metres. */
  origin: Vec3;
  yawRad: number;
  /** Height above the paper when the brush is up, or when it is inactive. */
  liftHeightM: number;
}

export interface MappingConfig {
  /** Metres per canvas unit. Null derives the scale from the paper and the canvas. */
  scaleX: number | null;
  scaleY: number | null;
  canvasXAxis: HorizontalAxis;
  canvasYAxis: HorizontalAxis;
}

const AXES: Record<HorizontalAxis, Vec3> = {
  x: [1, 0, 0],
  '-x': [-1, 0, 0],
  y: [0, 1, 0],
  '-y': [0, -1, 0],
};

export interface MappedBrush {
  /** On the paper plane. This is the requested drawing point, ignoring lift. */
  surface: Vec3;
  /** Where the tip is asked to be, including lift when it is not drawing. */
  world: Vec3;
  body: Vec3;
  scaleX: number;
  scaleY: number;
  /** True only when the sketch asked for contact and this brush is active. */
  drawing: boolean;
}

export function mapBrushTarget(
  target: BrushTarget,
  canvas: { width: number; height: number },
  paper: PaperConfig,
  mapping: MappingConfig,
  brushActive: boolean,
  bodyPosition: Vec3,
): MappedBrush {
  const width = canvas.width > 0 ? canvas.width : 1;
  const height = canvas.height > 0 ? canvas.height : 1;
  const scaleX =
    mapping.scaleX !== null && Number.isFinite(mapping.scaleX) && mapping.scaleX > 0
      ? mapping.scaleX
      : paper.widthM / width;
  const scaleY =
    mapping.scaleY !== null && Number.isFinite(mapping.scaleY) && mapping.scaleY > 0
      ? mapping.scaleY
      : paper.heightM / height;
  const alongX = (target.x - width / 2) * scaleX;
  const alongY = (target.y - height / 2) * scaleY;
  const axisX = AXES[mapping.canvasXAxis];
  const axisY = AXES[mapping.canvasYAxis];
  const flat: Vec3 = [
    axisX[0] * alongX + axisY[0] * alongY,
    axisX[1] * alongX + axisY[1] * alongY,
    0,
  ];
  const turned = yawPoint(paper.yawRad, flat);
  const drawing = target.contact && brushActive;
  const lift = drawing ? 0 : paper.liftHeightM;
  const surface: Vec3 = [paper.origin[0] + turned[0], paper.origin[1] + turned[1], paper.origin[2]];
  const world: Vec3 = [surface[0], surface[1], surface[2] + lift];
  const body: Vec3 = [world[0] - bodyPosition[0], world[1] - bodyPosition[1], world[2] - bodyPosition[2]];
  return {
    surface: finiteVec(surface) ? surface : paper.origin,
    world: finiteVec(world) ? world : paper.origin,
    body: finiteVec(body) ? body : [0, 0, 0],
    scaleX,
    scaleY,
    drawing,
  };
}
