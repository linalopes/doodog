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
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export const CONTROLLER_NOTE =
  'The Go2 actuators in this MJCF are torque motors. Posture Hold, Three-Leg Stance, Drawing in the Air, and Creative Score Tracking send a PD torque. Foot targets are converted through the measured body pose into joint targets. Commands are clamped to the ctrlrange in go2.xml (about ±23.7 Nm on the hip actuators and ±45.43 Nm on the knees). That range is the model file, not a certified continuous-torque rating. The PD gains are simulation settings.';

export const CLOCK_NOTE =
  'Physics experiment time is the MuJoCo clock. It advances only while Posture Hold, Three-Leg Stance, Drawing in the Air, or Creative Score Tracking is playing. The creative score keeps its own timeline. Playing or seeking that score does not move this pose and does not rewind the physics state.';

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
