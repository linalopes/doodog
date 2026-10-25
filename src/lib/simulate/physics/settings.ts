/**
 * Simulation settings for the stance experiment.
 *
 * None of these numbers are Unitree motor ratings or a stability certificate.
 * Actuator commands are still clamped to the ctrlrange read from the MJCF.
 */

export interface ExperimentConfig {
  /** How far the front-left foot target rises, metres. */
  liftHeightM: number;
  shiftSeconds: number;
  liftSeconds: number;
  holdSeconds: number;
  returnSeconds: number;
}

export const DEFAULT_EXPERIMENT: ExperimentConfig = {
  liftHeightM: 0.015,
  shiftSeconds: 2,
  liftSeconds: 2,
  holdSeconds: 2,
  returnSeconds: 2,
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

export function clampConfig(config: ExperimentConfig): ExperimentConfig {
  return {
    liftHeightM: clamp(config.liftHeightM, 0.005, 0.04),
    shiftSeconds: clamp(config.shiftSeconds, 0.5, 8),
    liftSeconds: clamp(config.liftSeconds, 0.5, 8),
    holdSeconds: clamp(config.holdSeconds, 0.5, 8),
    returnSeconds: clamp(config.returnSeconds, 0.5, 8),
  };
}

function clamp(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return min;
  return Math.min(max, Math.max(min, value));
}

export const CONTROLLER_NOTE =
  'The Go2 actuators in this MJCF are torque motors. Posture Hold and Three-Leg Stance send a PD torque. Commands are clamped to the ctrlrange in go2.xml (about ±23.7 Nm on the hip actuators and ±45.43 Nm on the knees). That range is the model file, not a certified continuous-torque rating. The PD gains are simulation settings.';

export const CLOCK_NOTE =
  'Physics experiment time is the MuJoCo clock. It advances only while Posture Hold or Three-Leg Stance is playing. The creative score keeps its own timeline. Playing or seeking that score does not move this pose and does not rewind the physics state.';

export const COMPLETION_NOTE =
  'Completed means every stage met its measurements: four feet on the floor and an upright body after Stand, the centre-of-mass projection at least 5 mm inside the FR–RL–RR triangle after Shift, the front-left foot off the floor and at least halfway up the requested lift after Lift and throughout Hold, and four feet on the floor again after Return. A projection inside that triangle is not dynamic stability, and it is not a safety result.';

export const TIMELINE_HOLD_NOTE =
  'Motors are off, but this pose came from the controller. Reset physics before the shared timeline can move it. The simulation was not jumped.';
