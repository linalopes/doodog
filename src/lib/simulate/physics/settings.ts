/**
 * Simulation settings for the stance and air-drawing experiments.
 *
 * None of these numbers are Unitree motor ratings or a stability certificate.
 * Actuator commands are still clamped to the ctrlrange read from the MJCF.
 */

import type { DrawDirection } from './circle.ts';
import type { ScoreChannel } from './score.ts';

export interface ExperimentConfig {
  /** How far the front-left foot target rises, metres. */
  liftHeightM: number;
  shiftSeconds: number;
  liftSeconds: number;
  holdSeconds: number;
  returnSeconds: number;
  /** Requested circle radius. It is not reduced when a point is hard to reach. */
  circleRadiusM: number;
  /** Duration of one revolution. Physics experiment time, not the creative score. */
  drawSeconds: number;
  /** Viewed from above. */
  direction: DrawDirection;
  /** Longer canvas side maps to this length. It is not the 0.20 m paper. */
  gestureSizeM: number;
  /** Score seconds sampled when the sketch does not declare scorePeriod(). */
  trackSeconds: number;
  /** Smooth move from the lift pose to the first score point, in physics seconds. */
  approachSeconds: number;
  /** Which creative brush is sampled. This does not select the physical leg. */
  channel: ScoreChannel;
  /** Multiplier on the PD gains. 1 is the baseline. Not a motor rating. */
  gainScale: number;
  /** Requested sandbox sample interval for a creative score. */
  sampleIntervalS: number;
  /** Baseline lowers the foot and unshifts together. Gradual touches down first. */
  returnStyle: 'baseline' | 'gradual';
  /** Attachment point in the foot frame. Not a hardware measurement. */
  brushMountXM: number;
  brushMountYM: number;
  brushMountZM: number;
  brushRollRad: number;
  brushPitchRad: number;
  brushYawRad: number;
  /** Shaft length along brush −Z. Default 45 mm, with the mount, matches the kinematic tip. */
  brushLengthM: number;
  /** Nominal height of the approach target above the paper plane. Not a contact. */
  brushClearanceM: number;
  /** Physics seconds to move the tip toward that target. */
  brushMoveSeconds: number;
  /** Sheet used by the approach. Snapshotted from the viewport. Not moved to help the reach. */
  paperOriginX: number;
  paperOriginY: number;
  paperOriginZ: number;
  paperYawRad: number;
  paperWidthM: number;
  paperHeightM: number;
}

export const DEFAULT_EXPERIMENT: ExperimentConfig = {
  liftHeightM: 0.015,
  shiftSeconds: 2,
  liftSeconds: 2,
  holdSeconds: 2,
  returnSeconds: 2,
  circleRadiusM: 0.01,
  drawSeconds: 4,
  direction: 'ccw',
  gestureSizeM: 0.02,
  trackSeconds: 8,
  approachSeconds: 1,
  channel: 'left',
  gainScale: 1,
  sampleIntervalS: 0.05,
  returnStyle: 'baseline',
  brushMountXM: 0.035,
  brushMountYM: 0,
  brushMountZM: 0,
  brushRollRad: 0,
  brushPitchRad: 0,
  brushYawRad: 0,
  brushLengthM: 0.045,
  brushClearanceM: 0.01,
  brushMoveSeconds: 3,
  paperOriginX: 0.3,
  paperOriginY: 0,
  paperOriginZ: 0,
  paperYawRad: 0,
  paperWidthM: 0.2,
  paperHeightM: 0.2,
};

/** Physics steps advanced on each animation frame while an experiment is playing. */
export const EXPERIMENT_STEPS_PER_FRAME = 8;

/** How long Stand holds the home posture before the shift. Not a user control. */
export const STAND_SECONDS = 1;

/**
 * PD gains, one per actuator in Menagerie order:
 * FL hip, thigh, calf, then FR, RL, RR.
 * Hip and thigh share the smaller ctrlrange, so their gains stay lower than the knee.
 */
export const PD_KP = [70, 160, 200, 70, 160, 200, 70, 160, 200, 70, 160, 200] as const;
export const PD_KD = [2, 4, 4, 2, 4, 4, 2, 4, 4, 2, 4, 4] as const;

/** Joint-target rate limit. Keeps an inverse-kinematics change from becoming a step command. */
export const MAX_JOINT_RATE_RAD_PER_SEC = 2;

/** Largest horizontal body shift the planner will request. */
export const MAX_SHIFT_M = 0.12;

/** Foot collision sphere radius from go2.xml (`class="foot"` geom size). */
export const FOOT_RADIUS_M = 0.022;

export const STANCE_CRITERIA = {
  standHeightM: 0.2,
  moveHeightM: 0.18,
  fallHeightM: 0.12,
  standTiltDeg: 8,
  shiftTiltDeg: 10,
  holdTiltDeg: 12,
  returnTiltDeg: 12,
  fallTiltDeg: 35,
  /** Centre-of-mass projection must be at least this far inside the FR–RL–RR triangle. */
  shiftMarginM: 0.005,
  /** The foot must rise by at least this fraction of the requested lift, and leave the floor. */
  liftFraction: 0.5,
} as const;

/**
 * Largest foot-frame tracking error that still counts as a completed Draw.
 * An evaluation setting for this experiment. Not a motor rating.
 */
export const DRAW_MAX_ERROR_M = 0.008;

export function clampConfig(config: ExperimentConfig): ExperimentConfig {
  return {
    liftHeightM: clamp(config.liftHeightM, 0.005, 0.04),
    shiftSeconds: clamp(config.shiftSeconds, 0.5, 8),
    liftSeconds: clamp(config.liftSeconds, 0.5, 8),
    holdSeconds: clamp(config.holdSeconds, 0.5, 8),
    returnSeconds: clamp(config.returnSeconds, 0.5, 8),
    circleRadiusM: clamp(config.circleRadiusM, 0.005, 0.04),
    drawSeconds: clamp(config.drawSeconds, 1, 12),
    direction: config.direction === 'cw' ? 'cw' : 'ccw',
    gestureSizeM: clamp(config.gestureSizeM, 0.005, 0.08),
    trackSeconds: clamp(config.trackSeconds, 1, 32),
    approachSeconds: clamp(config.approachSeconds, 0.5, 4),
    channel: config.channel === 'right' ? 'right' : 'left',
    gainScale: clamp(config.gainScale, 0.5, 1.5, 1),
    sampleIntervalS: clamp(config.sampleIntervalS, 0.02, 0.2, 0.05),
    returnStyle: config.returnStyle === 'gradual' ? 'gradual' : 'baseline',
    brushMountXM: clamp(config.brushMountXM, -0.08, 0.08, 0.035),
    brushMountYM: clamp(config.brushMountYM, -0.08, 0.08, 0),
    brushMountZM: clamp(config.brushMountZM, -0.08, 0.08, 0),
    brushRollRad: clamp(config.brushRollRad, -Math.PI, Math.PI, 0),
    brushPitchRad: clamp(config.brushPitchRad, -Math.PI, Math.PI, 0),
    brushYawRad: clamp(config.brushYawRad, -Math.PI, Math.PI, 0),
    brushLengthM: clamp(config.brushLengthM, 0.005, 0.12, 0.045),
    brushClearanceM: clamp(config.brushClearanceM, 0.005, 0.04, 0.01),
    brushMoveSeconds: clamp(config.brushMoveSeconds, 1, 8, 3),
    paperOriginX: clamp(config.paperOriginX, -1, 1.5, 0.3),
    paperOriginY: clamp(config.paperOriginY, -1, 1, 0),
    paperOriginZ: clamp(config.paperOriginZ, -0.05, 0.2, 0),
    paperYawRad: clamp(config.paperYawRad, -Math.PI, Math.PI, 0),
    paperWidthM: clamp(config.paperWidthM, 0.05, 0.5, 0.2),
    paperHeightM: clamp(config.paperHeightM, 0.05, 0.5, 0.2),
  };
}

function clamp(value: number, min: number, max: number, fallback = min): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export const CONTROLLER_NOTE =
  'The Go2 actuators in this MJCF are torque motors. Posture Hold, Three-Leg Stance, Drawing in the Air, Creative Score Tracking, and Brush Approach send a PD torque. Foot targets are converted through the measured body pose into joint targets. Commands are clamped to the ctrlrange in go2.xml (about ±23.7 Nm on the hip actuators and ±45.43 Nm on the knees). That range is the model file, not a certified continuous-torque rating. The PD gains are simulation settings.';

export const CLOCK_NOTE =
  'Physics experiment time is the MuJoCo clock. It advances only while Posture Hold, Three-Leg Stance, Drawing in the Air, Creative Score Tracking, or Brush Approach is playing. The creative score keeps its own timeline. Playing or seeking that score does not move this pose and does not rewind the physics state.';

export const BRUSH_NOTE =
  'Brush Geometry Preview — No Contact Physics. The shaft and the tip use one calibration: an attachment in the foot frame, then a length along the brush −Z axis, rotated with the simulated foot. The default attachment is 35 mm forward and the default length is 45 mm, which is the kinematic preview tip. It is not a measured hardware mount. A tip below the paper plane is a signed distance, not a collision. The sheet stays where it is.';

export const APPROACH_NOTE =
  'Brush Approach stands, shifts onto FR, RL and RR, lifts FL, then moves the brush tip toward a point above the paper centre. The clearance is a nominal height, starting at 10 mm. The path is checked for geometric reach before it runs. If the tip cannot reach that point from this stance and calibration, or the only solution lowers the front-left foot below the lift, the experiment stops at the lift and says so. The robot is not teleported and the paper is not moved. There is no paper collision and no brush pressure.';

export const COMPLETION_NOTE =
  'Completed means every stage met its measurements: four feet on the floor and an upright body after Stand, the centre-of-mass projection at least 5 mm inside the FR–RL–RR triangle after Shift, the front-left foot off the floor and at least halfway up the requested lift after Lift and throughout Hold, and four feet on the floor again after Return. A projection inside that triangle is not dynamic stability, and it is not a safety result.';

export const DRAW_NOTE =
  'The circle lies in a horizontal world plane through the front-left foot target at the end of Lift. It starts and ends on that target, so the command does not jump. The centre is one radius toward world −X. The angle follows a smootherstep, because a constant speed would leave Lift with a sideways velocity. The measured foot height is reported and is not used to move the command. The radius is not reduced to make a point reachable. The line is not ink.';

export const DRAW_COMPLETION_NOTE =
  `Drawing in the Air uses the three-leg measurements, and Draw also requires the front-left foot to stay up, the three support feet to stay down, every circle point to be reachable, and the foot-frame tracking error to stay within ${(DRAW_MAX_ERROR_M * 1000).toFixed(0)} mm. That distance is an evaluation threshold, not a motor rating. Finishing the drawing time is not enough. A projection inside the triangle is not dynamic stability, and it is not a safety result.`;

export const SCORE_NOTE =
  'Creative Score Tracking raises FL and then follows one brush from the running p5 sketch. The other brush is ignored and does not command a leg. The physical drawing leg stays FL. The longer canvas side maps to the gesture envelope, and the shorter side keeps the canvas proportions. This envelope is not the 0.20 m paper, and the drawing is not resized to the reachable workspace. Contact is metadata: it does not touch paper and it does not leave ink. Brush-up travel is still commanded. Playback rate is score-seconds per physics-second during Track. The stage length is fixed from the rate at the start of Track. Raising the rate finishes the score sooner and then holds the last sample. Lowering it leaves the score unfinished when the stage ends. Motion diagnostics keep sampling the score clock, not the physics step.';

export const SCORE_COMPLETION_NOTE =
  `Creative Score Tracking uses the three-leg measurements, and Track also requires the front-left foot to stay up, the three support feet to stay down, the first target to be reachable before tracking starts, later targets to stay reachable, the selected score to be played, and the foot-frame tracking error to stay within ${(DRAW_MAX_ERROR_M * 1000).toFixed(0)} mm. That distance is an evaluation threshold, not a motor rating. Finishing the tracking time is not enough. A projection inside the triangle is not dynamic stability, and it is not a safety result.`;

export const TIMELINE_HOLD_NOTE =
  'Motors are off, but this pose came from the controller. Reset physics before the shared timeline can move it. The simulation was not jumped.';
