/**
 * Shared parametric motion model.
 *
 * This is the single vocabulary that the 2D drawing preview, the Three.js
 * robot simulation, a future MuJoCo physics adapter, and a future Unitree Go2
 * controller will all consume. Nothing is exported between stages as SVG or
 * JSON files: a sketch defines motion as a function of time, and every
 * consumer samples that same function through the same timeline.
 *
 * These are initial interfaces and are expected to be refined in Phase 02
 * once the Three.js viewport exists. Fields are kept minimal on purpose.
 */

/**
 * Where one brush should be at a given instant, in canvas space.
 *
 * `x` and `y` are expressed in the sketch's own canvas units (the same units
 * `createCanvas` uses), so a sketch author never has to think in metres.
 * Mapping canvas units to the robot's reachable workspace is the adapter's
 * responsibility, not the sketch's.
 */
export type BrushTarget = {
  x: number;
  y: number;
  /** True when the brush should touch the surface (draw), false when lifted. */
  contact: boolean;
};

/** A complete pose request for both drawing brushes at one instant. */
export type MotionFrame = {
  /** Seconds from the start of the motion program. */
  time: number;
  left: BrushTarget;
  right: BrushTarget;
};

/** Which physical leg carries each brush. Fixed for now; configurable later. */
export type BrushSide = 'left' | 'right';

/**
 * A pure, deterministic function of time. Sketches will eventually register
 * one of these; the host samples it rather than recording its output.
 */
export type MotionFunction = (time: number) => MotionFrame;

/**
 * Static description of a motion program, independent of any renderer.
 * `durationSeconds` is `null` for programs that loop forever.
 */
export type MotionProgramInfo = {
  durationSeconds: number | null;
  /** Canvas size the brush coordinates are expressed in. */
  canvas: { width: number; height: number };
};

/** Runtime guards used wherever a frame crosses a trust boundary (postMessage). */
export function isBrushTarget(value: unknown): value is BrushTarget {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.x === 'number' &&
    Number.isFinite(v.x) &&
    typeof v.y === 'number' &&
    Number.isFinite(v.y) &&
    typeof v.contact === 'boolean'
  );
}

export function isMotionFrame(value: unknown): value is MotionFrame {
  if (typeof value !== 'object' || value === null) return false;
  const v = value as Record<string, unknown>;
  return (
    typeof v.time === 'number' &&
    Number.isFinite(v.time) &&
    isBrushTarget(v.left) &&
    isBrushTarget(v.right)
  );
}
