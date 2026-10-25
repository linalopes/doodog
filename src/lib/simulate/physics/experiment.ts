/**
 * Three-leg stance schedule.
 *
 * The creative timeline is not this clock. `elapsed` is physics experiment
 * time. Joint commands are torques from the PD law. A stage that finishes
 * its animation is not a success: completion is the measurement checklist.
 */

import type { Go2JointState } from '../adapters/types.ts';
import type { Quat, Vec3 } from '../go2/math.ts';
import { jointPd } from './pd.ts';
import {
  CLOCK_NOTE,
  COMPLETION_NOTE,
  DEFAULT_EXPERIMENT,
  STANCE_CRITERIA,
  STAND_SECONDS,
  clampConfig,
  type ExperimentConfig,
} from './settings.ts';
import { analyticalFoot } from '../go2/kinematics.ts';
import { quatRotate, sub } from '../go2/math.ts';
import {
  copyJoints,
  footWorld,
  jointsForFeet,
  limitJointStep,
  minimumShift,
  referenceJoints,
} from './targets.ts';
import {
  JOINT_ORDER,
  type ActuatorRange,
  type LegId,
  type PhysicsSnapshot,
} from './types.ts';

export { CLOCK_NOTE, COMPLETION_NOTE };

export type PhysicsMode = 'motors-off' | 'posture-hold' | 'three-leg';

export type StanceStage = 'idle' | 'posture' | 'stand' | 'shift' | 'lift' | 'hold' | 'return' | 'done';

export type ExperimentOutcome = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'interrupted';

export interface StageCriteria {
  stand: boolean | null;
  shift: boolean | null;
  lift: boolean | null;
  hold: boolean | null;
  return: boolean | null;
}

export interface PlantedStance {
  body: Vec3;
  orientation: Quat;
  feet: Record<LegId, Vec3>;
  flClearanceM: number;
  shift: Vec3;
}

export interface ExperimentMemory {
  mode: PhysicsMode;
  playback: 'paused' | 'playing';
  stage: StanceStage;
  outcome: ExperimentOutcome;
  reason: string;
  /** First measurement that failed. Empty when none has failed. */
  failure: string;
  elapsed: number;
  stageTime: number;
  config: ExperimentConfig;
  planted: PlantedStance | null;
  criteria: StageCriteria;
  targets: Go2JointState | null;
  flTarget: Vec3 | null;
  postureHolding: boolean;
  unreachable: LegId[];
}

export interface ExperimentView {
  mode: PhysicsMode;
  playback: 'paused' | 'playing';
  stage: StanceStage;
  outcome: ExperimentOutcome;
  reason: string;
  failure: string;
  elapsed: number;
  stageTime: number;
  config: ExperimentConfig;
  criteria: StageCriteria;
  targets: Go2JointState | null;
  flTarget: Vec3 | null;
  postureHolding: boolean;
  unreachable: LegId[];
}

export interface TorquePlant {
  readonly info: { timestep: number; actuatorRanges: readonly ActuatorRange[] };
  sample(): PhysicsSnapshot;
  setTorques(values: readonly number[]): void;
  step(count: number): PhysicsSnapshot;
}

const EMPTY_CRITERIA: StageCriteria = {
  stand: null,
  shift: null,
  lift: null,
  hold: null,
  return: null,
};

export function createMemory(config: ExperimentConfig = DEFAULT_EXPERIMENT): ExperimentMemory {
  return {
    mode: 'motors-off',
    playback: 'paused',
    stage: 'idle',
    outcome: 'idle',
    reason: '',
    failure: '',
    elapsed: 0,
    stageTime: 0,
    config: clampConfig(config),
    planted: null,
    criteria: { ...EMPTY_CRITERIA },
    targets: null,
    flTarget: null,
    postureHolding: false,
    unreachable: [],
  };
}

export function viewOf(memory: ExperimentMemory): ExperimentView {
  return {
    mode: memory.mode,
    playback: memory.playback,
    stage: memory.stage,
    outcome: memory.outcome,
    reason: memory.reason,
    failure: memory.failure,
    elapsed: memory.elapsed,
    stageTime: memory.stageTime,
    config: memory.config,
    criteria: { ...memory.criteria },
    targets: memory.targets ? copyJoints(memory.targets) : null,
    flTarget: memory.flTarget ? [memory.flTarget[0], memory.flTarget[1], memory.flTarget[2]] : null,
    postureHolding: memory.postureHolding,
    unreachable: [...memory.unreachable],
  };
}

export function configureMemory(memory: ExperimentMemory, config: ExperimentConfig): ExperimentMemory {
  return { ...memory, config: clampConfig(config) };
}

export function changeMode(memory: ExperimentMemory, mode: PhysicsMode): ExperimentMemory {
  const next = fresh(memory);
  next.mode = mode;
  next.playback = 'paused';
  next.targets = null;
  next.flTarget = null;
  next.unreachable = [];
  if (memory.playback === 'playing' || memory.outcome === 'running' || memory.outcome === 'paused') {
    next.outcome = 'interrupted';
    next.reason = 'The controller mode changed. The physics state was not jumped.';
    next.stage = memory.stage === 'idle' ? 'idle' : memory.stage;
  }
  if (mode === 'motors-off') next.stage = 'idle';
  return next;
}

export function begin(memory: ExperimentMemory, sample: PhysicsSnapshot): ExperimentMemory {
  if (memory.mode === 'motors-off') return memory;
  const next = fresh(memory);
  next.mode = memory.mode;
  next.config = memory.config;
  next.criteria = { ...EMPTY_CRITERIA };
  next.planted = null;
  next.targets = null;
  next.flTarget = null;
  next.elapsed = 0;
  next.stageTime = 0;
  next.failure = '';
  next.postureHolding = false;
  next.unreachable = [];
  if (sample.basePosition[2] < STANCE_CRITERIA.standHeightM) {
    next.playback = 'paused';
    next.stage = 'done';
    next.outcome = 'failed';
    next.reason =
      'The body is already below the stand height. Reset to the home posture and start again. The pose was not jumped.';
    next.failure = next.reason;
    return next;
  }
  next.playback = 'playing';
  next.outcome = 'running';
  next.stage = memory.mode === 'posture-hold' ? 'posture' : 'stand';
  next.reason =
    next.stage === 'posture'
      ? 'Holding the home joint targets with torque PD. No foot lift is commanded.'
      : 'Stand: holding the home posture on four feet.';
  return next;
}

export function pause(memory: ExperimentMemory): ExperimentMemory {
  if (memory.playback !== 'playing') return memory;
  const next = fresh(memory);
  next.playback = 'paused';
  if (next.outcome === 'running') next.outcome = 'paused';
  return next;
}

export function resume(memory: ExperimentMemory): ExperimentMemory {
  if (memory.outcome !== 'paused') return memory;
  const next = fresh(memory);
  next.playback = 'playing';
  next.outcome = 'running';
  return next;
}

export function stop(memory: ExperimentMemory): ExperimentMemory {
  if (memory.outcome === 'failed' || memory.outcome === 'completed' || memory.outcome === 'interrupted') {
    const next = fresh(memory);
    next.playback = 'paused';
    return next;
  }
  if (memory.outcome === 'idle' && memory.playback !== 'playing') return memory;
  const next = fresh(memory);
  next.playback = 'paused';
  next.outcome = 'interrupted';
  next.reason = 'Stopped. The physics state was not jumped.';
  return next;
}

export interface Command {
  memory: ExperimentMemory;
  torques: number[];
  /** False when this sample should stay where it is. Motor commands are still returned. */
  integrate: boolean;
}

/**
 * One control decision from the current sample. When `integrate` is true the
 * caller applies `torques` and steps the plant once. The returned memory
 * already includes that future step in `elapsed`.
 */
export function commandFrom(
  memory: ExperimentMemory,
  sample: PhysicsSnapshot,
  ranges: readonly ActuatorRange[],
  dt: number,
): Command {
  const next = fresh(memory);
  const zeros = zeroTorques(ranges.length || 12);
  if (next.playback !== 'playing') return { memory: next, torques: zeros, integrate: false };

  const fell = fallReason(sample);
  if (fell) {
    next.playback = 'paused';
    next.outcome = 'failed';
    next.stage = 'done';
    if (!next.reason.includes('fell') && !next.reason.includes('tipped'))     next.reason = fell;
    if (!next.failure) next.failure = fell;
    next.unreachable = [];
    return { memory: next, torques: zeros, integrate: false };
  }

  if (next.stage === 'posture') {
    next.postureHolding = upright(sample, STANCE_CRITERIA.standHeightM, STANCE_CRITERIA.standTiltDeg);
    next.reason = next.postureHolding
      ? 'Four feet are on the floor and the body is upright. This is a held posture, not a certified stable stance.'
      : 'The posture hold has not met the stand measurements.';
  }

  if (next.stage === 'hold') {
    const holding = holdOk(sample, next);
    next.criteria.hold = (next.criteria.hold ?? true) && holding;
    if (!holding) remember(next, 'Hold lost the three-leg measurements.');
  }

  const duration = stageDuration(next);
  if (duration !== null && next.stageTime >= duration) closeStage(next, sample);

  if (next.playback !== 'playing') {
    if (next.outcome === 'completed' && next.targets) {
      const held = jointPd(sample.joints, sample.jointVelocity, next.targets, next.targets, ranges, dt);
      return { memory: next, torques: held.torques, integrate: false };
    }
    return { memory: next, torques: zeros, integrate: false };
  }

  const plan = planTargets(next, sample);
  const limited = limitJointStep(next.targets, plan.joints, dt);
  const pd = jointPd(sample.joints, sample.jointVelocity, limited, next.targets, ranges, dt);
  next.targets = limited;
  next.flTarget = plan.flTarget;
  next.unreachable = plan.unreachable;
  next.stageTime += dt;
  next.elapsed += dt;
  return { memory: next, torques: pd.torques, integrate: true };
}

export function advanceExperiment(
  plant: TorquePlant,
  memory: ExperimentMemory,
  steps: number,
): { memory: ExperimentMemory; snapshot: PhysicsSnapshot } {
  let snapshot = plant.sample();
  let next = memory;
  const count = Math.max(0, Math.floor(steps));
  for (let index = 0; index < count; index += 1) {
    if (next.playback !== 'playing') break;
    const command = commandFrom(next, snapshot, plant.info.actuatorRanges, plant.info.timestep);
    next = command.memory;
    plant.setTorques(command.torques);
    if (!command.integrate) break;
    snapshot = plant.step(1);
  }
  return { memory: next, snapshot };
}

function closeStage(memory: ExperimentMemory, sample: PhysicsSnapshot): void {
  if (memory.stage === 'stand') {
    memory.criteria.stand = upright(sample, STANCE_CRITERIA.standHeightM, STANCE_CRITERIA.standTiltDeg);
    memory.planted = capture(sample);
    if (!memory.criteria.stand) remember(memory, 'Stand did not hold four feet and an upright body.');
    memory.stage = 'shift';
    memory.stageTime = 0;
    memory.reason = 'Shift: moving the body toward the FR–RL–RR triangle.';
    return;
  }
  if (memory.stage === 'shift') {
    memory.criteria.shift =
      sample.support.threeLegFeetDown &&
      sample.feet.FL.onFloor &&
      sample.support.threeLegInside &&
      (sample.support.threeLegMarginM ?? -1) >= STANCE_CRITERIA.shiftMarginM &&
      upright(sample, STANCE_CRITERIA.moveHeightM, STANCE_CRITERIA.shiftTiltDeg);
    if (!memory.criteria.shift) {
      remember(memory, 'Shift did not place the centre of mass inside the FR–RL–RR triangle.');
    }
    memory.stage = 'lift';
    memory.stageTime = 0;
    memory.reason = 'Lift: raising the front-left foot with the other three feet down.';
    return;
  }
  if (memory.stage === 'lift') {
    memory.criteria.lift = lifted(sample, memory);
    if (!memory.criteria.lift) remember(memory, 'Lift did not raise the front-left foot off the floor.');
    memory.stage = 'hold';
    memory.stageTime = 0;
    memory.criteria.hold = holdOk(sample, memory);
    memory.reason = 'Hold: keeping the front-left foot up.';
    return;
  }
  if (memory.stage === 'hold') {
    if (memory.criteria.hold !== true) remember(memory, 'Hold lost the three-leg measurements.');
    memory.stage = 'return';
    memory.stageTime = 0;
    memory.reason = 'Return: lowering the front-left foot.';
    return;
  }
  if (memory.stage === 'return') {
    memory.criteria.return =
      upright(sample, STANCE_CRITERIA.moveHeightM, STANCE_CRITERIA.returnTiltDeg) &&
      allDown(sample) &&
      sample.feet.FL.clearanceM <= memory.config.liftHeightM * STANCE_CRITERIA.liftFraction;
    if (!memory.criteria.return) remember(memory, 'Return did not put all four feet back on the floor.');
    memory.stage = 'done';
    memory.stageTime = 0;
    memory.playback = 'paused';
    const passed =
      memory.criteria.stand === true &&
      memory.criteria.shift === true &&
      memory.criteria.lift === true &&
      memory.criteria.hold === true &&
      memory.criteria.return === true;
    memory.outcome = passed ? 'completed' : 'failed';
    memory.reason = passed
      ? 'Completed. Every stage met its measurements. This is not dynamic stability and it is not a safety result.'
      : memory.failure || 'The schedule finished without meeting every measurement.';
  }
}

function planTargets(
  memory: ExperimentMemory,
  sample: PhysicsSnapshot,
): { joints: Go2JointState; flTarget: Vec3 | null; unreachable: LegId[] } {
  if (memory.stage === 'posture' || memory.stage === 'stand' || !memory.planted) {
    return { joints: referenceJoints(), flTarget: null, unreachable: [] };
  }
  const planted = memory.planted;
  const shiftScale = blend(memory, 'shift');
  const liftScale = blend(memory, 'lift');
  const body: Vec3 = [
    planted.body[0] + planted.shift[0] * shiftScale,
    planted.body[1] + planted.shift[1] * shiftScale,
    planted.body[2],
  ];
  const feet = {
    FL: [planted.feet.FL[0], planted.feet.FL[1], planted.feet.FL[2]] as Vec3,
    FR: [planted.feet.FR[0], planted.feet.FR[1], planted.feet.FR[2]] as Vec3,
    RL: [planted.feet.RL[0], planted.feet.RL[1], planted.feet.RL[2]] as Vec3,
    RR: [planted.feet.RR[0], planted.feet.RR[1], planted.feet.RR[2]] as Vec3,
  };
  // Lift height is clearance above the floor. The captured stance still has
  // the foot sphere inside the floor, so the frame also has to climb out of
  // that penetration. During the shift the foot stays at the captured pose.
  const buried = Math.max(0, -planted.flClearanceM);
  const rise = (memory.config.liftHeightM + buried) * liftScale;
  feet.FL = [feet.FL[0], feet.FL[1], feet.FL[2] + rise];
  const solved = jointsForFeet(body, planted.orientation, feet);
  if (liftScale > 0.02) {
    // Support legs stay on the commanded body so the shift holds. The lifted
    // foot is solved from the measured body, or a low body keeps it down.
    const inverse: [number, number, number, number] = [
      sample.baseQuaternion[0],
      -sample.baseQuaternion[1],
      -sample.baseQuaternion[2],
      -sample.baseQuaternion[3],
    ];
    const flLocal = quatRotate(inverse, sub(feet.FL, sample.basePosition));
    const flSolved = analyticalFoot('FL', flLocal);
    if (flSolved) {
      solved.joints.FL = [flSolved.joints[0], flSolved.joints[1], flSolved.joints[2]];
      if (!flSolved.reachable && !solved.unreachable.includes('FL')) solved.unreachable = [...solved.unreachable, 'FL'];
    } else if (!solved.unreachable.includes('FL')) {
      solved.unreachable = [...solved.unreachable, 'FL'];
    }
  }
  return { joints: solved.joints, flTarget: liftScale > 0 ? feet.FL : null, unreachable: solved.unreachable };
}

function blend(memory: ExperimentMemory, kind: 'shift' | 'lift'): number {
  if (memory.stage === 'hold') return 1;
  if (memory.stage === 'return') return 1 - smoothstep(progress(memory));
  if (memory.stage === kind) return smoothstep(progress(memory));
  if (kind === 'shift' && memory.stage === 'lift') return 1;
  return 0;
}

function progress(memory: ExperimentMemory): number {
  const duration = stageDuration(memory);
  if (duration === null || duration <= 0) return 1;
  return Math.min(1, Math.max(0, memory.stageTime / duration));
}

function stageDuration(memory: ExperimentMemory): number | null {
  if (memory.stage === 'stand') return STAND_SECONDS;
  if (memory.stage === 'shift') return memory.config.shiftSeconds;
  if (memory.stage === 'lift') return memory.config.liftSeconds;
  if (memory.stage === 'hold') return memory.config.holdSeconds;
  if (memory.stage === 'return') return memory.config.returnSeconds;
  return null;
}

function capture(sample: PhysicsSnapshot): PlantedStance {
  const feet = {
    FL: footWorld(sample, 'FL'),
    FR: footWorld(sample, 'FR'),
    RL: footWorld(sample, 'RL'),
    RR: footWorld(sample, 'RR'),
  };
  const triangle = (['FR', 'RL', 'RR'] as const).map((id) => groundPoint(sample, id));
  return {
    body: [sample.basePosition[0], sample.basePosition[1], sample.basePosition[2]],
    orientation: [
      sample.baseQuaternion[0],
      sample.baseQuaternion[1],
      sample.baseQuaternion[2],
      sample.baseQuaternion[3],
    ],
    feet,
    flClearanceM: sample.feet.FL.clearanceM,
    shift: minimumShift(sample.support.comProjection, triangle),
  };
}

function groundPoint(sample: PhysicsSnapshot, id: LegId): readonly [number, number] {
  const contact = sample.feet[id].contact;
  if (contact) return [contact[0], contact[1]];
  const sphere = sample.feet[id].sphere;
  return [sphere[0], sphere[1]];
}

function lifted(sample: PhysicsSnapshot, memory: ExperimentMemory): boolean {
  const risen = sample.feet.FL.clearanceM >= memory.config.liftHeightM * STANCE_CRITERIA.liftFraction;
  return risen && !sample.feet.FL.onFloor && supported(sample, STANCE_CRITERIA.moveHeightM, STANCE_CRITERIA.holdTiltDeg);
}

function supported(sample: PhysicsSnapshot, heightM: number, tiltDeg: number): boolean {
  const limit = (tiltDeg * Math.PI) / 180;
  return (
    sample.support.threeLegFeetDown &&
    sample.basePosition[2] >= heightM &&
    Math.abs(sample.rollRad) <= limit &&
    Math.abs(sample.pitchRad) <= limit
  );
}

function holdOk(sample: PhysicsSnapshot, memory: ExperimentMemory): boolean {
  return lifted(sample, memory) && sample.support.threeLegInside && (sample.support.threeLegMarginM ?? -1) > 0;
}

function upright(sample: PhysicsSnapshot, heightM: number, tiltDeg: number): boolean {
  const limit = (tiltDeg * Math.PI) / 180;
  return (
    allDown(sample) &&
    sample.basePosition[2] >= heightM &&
    Math.abs(sample.rollRad) <= limit &&
    Math.abs(sample.pitchRad) <= limit
  );
}

function allDown(sample: PhysicsSnapshot): boolean {
  return JOINT_ORDER.every((id) => sample.feet[id].onFloor);
}

function fallReason(sample: PhysicsSnapshot): string | null {
  if (sample.basePosition[2] < STANCE_CRITERIA.fallHeightM) {
    return 'The body fell. Its height is below the fall threshold. The schedule stopped.';
  }
  const limit = (STANCE_CRITERIA.fallTiltDeg * Math.PI) / 180;
  if (Math.abs(sample.rollRad) > limit || Math.abs(sample.pitchRad) > limit) {
    return 'The body tipped past the fall threshold. The schedule stopped.';
  }
  return null;
}

function remember(memory: ExperimentMemory, reason: string): void {
  if (!memory.failure) memory.failure = reason;
}

function fresh(memory: ExperimentMemory): ExperimentMemory {
  return {
    ...memory,
    config: memory.config,
    criteria: { ...memory.criteria },
    planted: memory.planted,
    targets: memory.targets ? copyJoints(memory.targets) : null,
    flTarget: memory.flTarget ? [memory.flTarget[0], memory.flTarget[1], memory.flTarget[2]] : null,
    unreachable: [...memory.unreachable],
  };
}

function smoothstep(unit: number): number {
  const t = Math.min(1, Math.max(0, unit));
  return t * t * (3 - 2 * t);
}

function zeroTorques(count: number): number[] {
  return Array.from({ length: count }, () => 0);
}
