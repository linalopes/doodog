/**
 * Placement of the virtual sheet and the two brushes.
 *
 * Brush offsets are in the foot frame from `go2.xml` (the visual foot mesh),
 * not at the collision sphere. They are calibration values for later hardware.
 * They are not written into sketch source.
 *
 * The default sheet is 0.20 m × 0.20 m, centred 0.30 m in front of the body
 * origin. That size is a physical choice. It is not a fit of the seven scores
 * into the legs' reach.
 */

import type { PaperConfig, MappingConfig } from './mapping.ts';
import type { Vec3 } from './math.ts';

export interface BrushMount {
  visible: boolean;
  /** When false the leg holds the reference pose and cannot leave a mark. */
  active: boolean;
  /** Tip position in the foot frame, metres. */
  offset: Vec3;
}

export interface SimConfig {
  paper: PaperConfig;
  mapping: MappingConfig;
  brushes: { left: BrushMount; right: BrushMount };
  showGrid: boolean;
  showFrames: boolean;
}

export const DEFAULT_BRUSH_OFFSET: Vec3 = [0.035, 0, -0.045];

export function defaultSimConfig(): SimConfig {
  return {
    paper: {
      widthM: 0.2,
      heightM: 0.2,
      origin: [0.3, 0, 0],
      yawRad: 0,
      liftHeightM: 0.04,
    },
    mapping: {
      scaleX: null,
      scaleY: null,
      canvasXAxis: '-y',
      canvasYAxis: '-x',
    },
    brushes: {
      left: { visible: true, active: true, offset: DEFAULT_BRUSH_OFFSET },
      right: { visible: true, active: true, offset: DEFAULT_BRUSH_OFFSET },
    },
    showGrid: true,
    showFrames: true,
  };
}

/** Studio canvas used only until a sketch reports `createCanvas`. */
export const ASSUMED_CANVAS = { width: 600, height: 600 };
