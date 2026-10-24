/**
 * Geometric reach of the front brushes, sampled in canvas space.
 *
 * Each sample is the same inverse kinematics and brush offset the kinematic
 * preview uses. The region is not a circle and it is not a drawing. Brush
 * down sits on the paper. Brush up sits at the configured lift. Neither
 * result says anything about balance, force, or a collision-free path.
 */

import type { BrushTarget } from '../../motion/types.ts';
import { ASSUMED_CANVAS, type SimConfig } from './defaults.ts';
import { solveLeg } from './kinematics.ts';
import { mapBrushTarget } from './mapping.ts';
import { BODY_POSITION } from './model.ts';

export type ReachHeight = 'down' | 'up';
export type ReachZone = 'both' | 'left' | 'right' | 'neither';

export const REACH_DISCLAIMER =
  'Geometric reach only. This map does not show balance, force, collision-free motion, or a safe path.';

export const REACH_ZONE_RGB: Record<ReachZone, readonly [number, number, number]> = {
  left: [34, 17, 62],
  right: [234, 125, 255],
  both: [8, 242, 219],
  neither: [202, 216, 216],
};

export interface ReachQuery {
  canvas: { width: number; height: number };
  config: SimConfig;
  height: ReachHeight;
}

export interface BrushReach {
  active: boolean;
  reachable: boolean;
  /** Millimetres are derived from this. Null when the brush is inactive. */
  positionErrorM: number | null;
}

export interface PointReach {
  canvasX: number;
  canvasY: number;
  zone: ReachZone;
  /** World Z of the tip target, metres. */
  heightM: number;
  mode: ReachHeight;
  left: BrushReach;
  right: BrushReach;
}

export interface ReachMap {
  columns: number;
  rows: number;
  canvas: { width: number; height: number };
  height: ReachHeight;
  heightM: number;
  key: string;
  cells: PointReach[];
}

export interface DisplayRect {
  x: number;
  y: number;
  width: number;
  height: number;
  scale: number;
}

const MIN_CELLS = 8;
const MAX_CELLS = 48;

export function heightLabel(config: SimConfig, height: ReachHeight): string {
  if (height === 'down') return 'Brush down, on the paper';
  const millimetres = Math.round(config.paper.liftHeightM * 1000);
  return `Brush up, ${millimetres} mm above the paper`;
}

export function evaluationHeightM(config: SimConfig, height: ReachHeight): number {
  return config.paper.origin[2] + (height === 'up' ? config.paper.liftHeightM : 0);
}

export function zoneOf(left: BrushReach, right: BrushReach): ReachZone {
  const leftOk = left.active && left.reachable;
  const rightOk = right.active && right.reachable;
  if (leftOk && rightOk) return 'both';
  if (leftOk) return 'left';
  if (rightOk) return 'right';
  return 'neither';
}

export function gridShape(
  canvas: { width: number; height: number },
  columns: number,
): { columns: number; rows: number } {
  const width = canvas.width > 0 ? canvas.width : ASSUMED_CANVAS.width;
  const height = canvas.height > 0 ? canvas.height : ASSUMED_CANVAS.height;
  const cols = Math.min(MAX_CELLS, Math.max(MIN_CELLS, Math.round(columns)));
  const rows = Math.min(MAX_CELLS, Math.max(MIN_CELLS, Math.round((cols * height) / width)));
  return { columns: cols, rows };
}

/**
 * Where the p5 canvas bitmap sits inside the preview frame.
 * The iframe does not scale the canvas above its pixel size, and a smaller
 * frame letterboxes it. This matches that rule so the overlay meets the drawing.
 */
export function canvasDisplayRect(
  frameWidth: number,
  frameHeight: number,
  canvasWidth: number,
  canvasHeight: number,
): DisplayRect {
  if (frameWidth < 2 || frameHeight < 2 || canvasWidth < 1 || canvasHeight < 1) {
    return { x: 0, y: 0, width: 0, height: 0, scale: 0 };
  }
  const scale = Math.min(1, frameWidth / canvasWidth, frameHeight / canvasHeight);
  const width = canvasWidth * scale;
  const height = canvasHeight * scale;
  return {
    x: (frameWidth - width) / 2,
    y: (frameHeight - height) / 2,
    width,
    height,
    scale,
  };
}

export function reachabilityKey(query: ReachQuery, columns: number): string {
  const { paper, mapping, brushes } = query.config;
  return JSON.stringify({
    canvas: [query.canvas.width, query.canvas.height],
    height: query.height,
    columns,
    paper,
    mapping,
    left: brushes.left,
    right: brushes.right,
  });
}

function brushReport(active: boolean, reachable: boolean, positionErrorM: number | null): BrushReach {
  return {
    active,
    reachable: active && reachable,
    positionErrorM: active ? positionErrorM : null,
  };
}

export function classifyCanvasPoint(x: number, y: number, query: ReachQuery): PointReach {
  const canvas = {
    width: query.canvas.width > 0 ? query.canvas.width : ASSUMED_CANVAS.width,
    height: query.canvas.height > 0 ? query.canvas.height : ASSUMED_CANVAS.height,
  };
  const target: BrushTarget = { x, y, contact: query.height === 'down' };
  const mapped = mapBrushTarget(
    target,
    canvas,
    query.config.paper,
    query.config.mapping,
    true,
    BODY_POSITION,
  );
  const leftMount = query.config.brushes.left;
  const rightMount = query.config.brushes.right;
  const leftSolve = leftMount.active ? solveLeg('FL', mapped.body, leftMount.offset) : null;
  const rightSolve = rightMount.active ? solveLeg('FR', mapped.body, rightMount.offset) : null;
  const left = brushReport(leftMount.active, leftSolve?.reachable ?? false, leftSolve?.positionErrorM ?? null);
  const right = brushReport(
    rightMount.active,
    rightSolve?.reachable ?? false,
    rightSolve?.positionErrorM ?? null,
  );
  return {
    canvasX: x,
    canvasY: y,
    zone: zoneOf(left, right),
    heightM: mapped.world[2],
    mode: query.height,
    left,
    right,
  };
}

export function fillReachabilityRows(
  cells: PointReach[],
  query: ReachQuery,
  columns: number,
  rows: number,
  startRow: number,
  endRow: number,
): void {
  const width = query.canvas.width > 0 ? query.canvas.width : ASSUMED_CANVAS.width;
  const height = query.canvas.height > 0 ? query.canvas.height : ASSUMED_CANVAS.height;
  const first = Math.max(0, startRow);
  const last = Math.min(rows, endRow);
  for (let row = first; row < last; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const x = ((column + 0.5) / columns) * width;
      const y = ((row + 0.5) / rows) * height;
      cells[row * columns + column] = classifyCanvasPoint(x, y, query);
    }
  }
}

export function buildReachabilityMap(query: ReachQuery, columns: number): ReachMap {
  const shape = gridShape(query.canvas, columns);
  const cells: PointReach[] = new Array(shape.columns * shape.rows);
  fillReachabilityRows(cells, query, shape.columns, shape.rows, 0, shape.rows);
  return {
    columns: shape.columns,
    rows: shape.rows,
    canvas: {
      width: query.canvas.width > 0 ? query.canvas.width : ASSUMED_CANVAS.width,
      height: query.canvas.height > 0 ? query.canvas.height : ASSUMED_CANVAS.height,
    },
    height: query.height,
    heightM: evaluationHeightM(query.config, query.height),
    key: reachabilityKey(query, columns),
    cells,
  };
}

function channel(value: number, alpha: number): number {
  return Math.max(0, Math.min(255, Math.round(value * alpha)));
}

/** One cell per block of pixels. `opacity` is 0–1 and is baked into alpha. */
export function paintReachability(
  pixels: Uint8ClampedArray,
  pixelWidth: number,
  pixelHeight: number,
  cells: readonly { zone: ReachZone }[],
  columns: number,
  rows: number,
  opacity: number,
): void {
  const gain = Math.max(0, Math.min(1, opacity));
  for (let y = 0; y < pixelHeight; y += 1) {
    const row = Math.min(rows - 1, Math.floor((y / pixelHeight) * rows));
    for (let x = 0; x < pixelWidth; x += 1) {
      const column = Math.min(columns - 1, Math.floor((x / pixelWidth) * columns));
      const cell = cells[row * columns + column];
      const index = (y * pixelWidth + x) * 4;
      if (!cell) {
        pixels[index] = 0;
        pixels[index + 1] = 0;
        pixels[index + 2] = 0;
        pixels[index + 3] = 0;
        continue;
      }
      const rgb = REACH_ZONE_RGB[cell.zone];
      const alpha = cell.zone === 'neither' ? gain * 0.45 : gain;
      pixels[index] = rgb[0];
      pixels[index + 1] = rgb[1];
      pixels[index + 2] = rgb[2];
      pixels[index + 3] = channel(255, alpha);
    }
  }
}
