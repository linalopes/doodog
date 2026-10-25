/**
 * Stance, air-circle, and creative-score schedule.
 *
 * The creative timeline is not this clock. `elapsed` is physics experiment
 * time. Joint commands are torques from the PD law. Foot targets are solved
 * from the measured body pose. A creative score arrives as samples; this file
 * does not evaluate sketch source. Nothing here writes qpos. A stage that
 * finishes its animation is not a success: completion is the measurement checklist.
 */

import type { Go2JointState } from '../adapters/types.ts';
import type { Quat, Vec3 } from '../go2/math.ts';
import { jointPd } from './pd.ts';
import {
  circlePoint,
  circleSamples,
  pathSpan,
  rmsError,
  smootherstep,
  trackingError,
  type DrawDirection,
} from './circle.ts';
import {
  mapGesture,
  sampleScore,
  splitGesturePaths,
  trackStageSeconds,
  type ScoreBuffer,
  type ScoreChannel,
  type ScoreKind,
} from './score.ts';
import {
  CLOCK_NOTE,
  COMPLETION_NOTE,
  DEFAULT_EXPERIMENT,
  DRAW_MAX_ERROR_M,
  STANCE_CRITERIA,
  STAND_SECONDS,
  clampConfig,
  type ExperimentConfig,
} from './settings.ts';
import { analyticalFoot } from '../go2/kinematics.ts';
import {
  copyJoints,
  footWorld,
  jointsForFeet,
  limitJointStep,
  minimumShift,
  referenceJoints,
  worldPointToBody,
} from './targets.ts';
import {
  JOINT_ORDER,
  type ActuatorRange,
  type LegId,
  type PhysicsSnapshot,
} from './types.ts';

export { CLOCK_NOTE, COMPLETION_NOTE };

export type PhysicsMode = 'motors-off' | 'posture-hold' | 'three-leg' | 'air-draw' | 'score';

export type StanceStage = 'idle' | 'posture' | 'stand' | 'shift' | 'lift' | 'draw' | 'track' | 'hold' | 'return' | 'done';

export type ExperimentOutcome = 'idle' | 'running' | 'paused' | 'completed' | 'failed' | 'interrupted';

export interface StageCriteria {
  stand: boolean | null;
  shift: boolean | null;
  lift: boolean | null;
  /** Null for experiments that do not draw. */
  draw: boolean | null;
  /** Null for experiments that do not track a creative score. */
  track: boolean | null;
  hold: boolean | null;
  return: boolean | null;
}

/** The creative trajectory, without the canvas samples, for the panel and the view. */
export interface ScoreInfo {
  version: number;
  runId: string;
  revision: number;
  channel: ScoreChannel;
  ignoredChannel: ScoreChannel;
  sketchName: string;
  canvasWidth: number;
  canvasHeight: number;
  gestureSizeM: number;
  scaleM: number;
  spanWidthM: number;
  spanHeightM: number;
  kind: ScoreKind;
  scoreStart: number;
  scoreEnd: number;
  interval: number;
  widened: boolean;
  travelPx: number;
}

/** Measurements while FL follows one creative brush. Contact is metadata only. */
export interface ScoreTrack {
  buffer: ScoreBuffer | null;
  origin: Vec3 | null;
  holdTarget: Vec3 | null;
  /** Live rate. Score seconds per physics second. */
  playbackRate: number;
  /** Rate captured when Track begins. It fixes the stage length. */
  entryRate: number;
  cursor: number;
  canvasX: number | null;
  canvasY: number | null;
  contact: boolean | null;
  requested: Vec3 | null;
  measured: Vec3 | null;
  samples: number;
  errorSumSq: number;
  maxErrorM: number;
  lastErrorM: number | null;
  minMarginM: number | null;
  maxAbsRollRad: number;
  maxAbsPitchRad: number;
  maxTorqueNm: number;
  saturated: boolean;
  unreachable: boolean;
  held: boolean;
  finished: boolean;
  initialReachable: boolean | null;
  desiredContact: Vec3[][];
  desiredTravel: Vec3[][];
  achieved: Vec3[];
  achievedWidthM: number | null;
  achievedDepthM: number | null;
}

export interface ScoreView {
  info: ScoreInfo | null;
  playbackRate: number;
  entryRate: number;
  cursor: number;
  canvasX: number | null;
  canvasY: number | null;
  contact: boolean | null;
  requested: Vec3 | null;
  measured: Vec3 | null;
  lastErrorM: number | null;
  maxErrorM: number;
  rmsErrorM: number | null;
  minMarginM: number | null;
  maxAbsRollRad: number;
  maxAbsPitchRad: number;
  maxTorqueNm: number;
  saturated: boolean;
  unreachable: boolean;
  held: boolean;
  finished: boolean;
  initialReachable: boolean | null;
  desiredContact: Vec3[][];
  desiredTravel: Vec3[][];
  achieved: Vec3[];
  achievedWidthM: number | null;
  achievedDepthM: number | null;
  origin: Vec3 | null;
}

/** Measurements gathered while the front-left foot is tracing the circle. */
export interface DrawTrack {
  anchor: Vec3 | null;
  radiusM: number;
  direction: DrawDirection;
  /** Measured foot-frame height when Draw began. The command stays on the anchor plane. */
  achievedHeightM: number | null;
  samples: number;
  errorSumSq: number;
  maxErrorM: number;
  lastErrorM: number | null;
  /** Lowest FR–RL–RR margin while drawing. Null before the first sample. */
  minMarginM: number | null;
  maxAbsRollRad: number;
  maxAbsPitchRad: number;
  maxTorqueNm: number;
  saturated: boolean;
  unreachable: boolean;
  /** Support and clearance held on every Draw sample so far. */
  held: boolean;
  /** The drawing duration elapsed, so the commanded path made one revolution. */
  revolution: boolean;
  /** Requested circle, in the world frame. Not ink. */
  desired: Vec3[];
  /** Measured foot frame during Draw. Not ink. */
  achieved: Vec3[];
  achievedWidthM: number | null;
  achievedDepthM: number | null;
}

/** Extremes over the whole experiment, including the stance stages. */
export interface ExperimentPeaks {
  minThreeLegMarginM: number | null;
  /** Stage in which the lowest three-leg margin was measured. */
  minMarginStage: StanceStage | null;
  maxAbsRollRad: number;
  maxAbsPitchRad: number;
  maxTorqueNm: number;
  saturated: boolean;
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
  draw: DrawTrack;
  score: ScoreTrack;
  peaks: ExperimentPeaks;
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
  draw: DrawTrack;
  score: ScoreView;
  peaks: ExperimentPeaks;
  /** Root-mean-square foot-frame error over the Draw samples. Null before Draw. */
  rmsErrorM: number | null;
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
  draw: null,
  track: null,
  hold: null,
  return: null,
};

const SCORE_SLOT_COUNT = 160;

function emptyScore(): ScoreTrack {
  return {
    buffer: null,
    origin: null,
    holdTarget: null,
    playbackRate: 1,
    entryRate: 0,
    cursor: 0,
    canvasX: null,
    canvasY: null,
    contact: null,
    requested: null,
    measured: null,
    samples: 0,
    errorSumSq: 0,
    maxErrorM: 0,
    lastErrorM: null,
    minMarginM: null,
    maxAbsRollRad: 0,
    maxAbsPitchRad: 0,
    maxTorqueNm: 0,
    saturated: false,
    unreachable: false,
    held: true,
    finished: false,
    initialReachable: null,
    desiredContact: [],
    desiredTravel: [],
    achieved: [],
    achievedWidthM: null,
    achievedDepthM: null,
  };
}

function shareScore(track: ScoreTrack): ScoreTrack {
  return {
    ...track,
    origin: track.origin ? copyVec(track.origin) : null,
    holdTarget: track.holdTarget ? copyVec(track.holdTarget) : null,
    requested: track.requested ? copyVec(track.requested) : null,
    measured: track.measured ? copyVec(track.measured) : null,
  };
}

function scoreInfo(buffer: ScoreBuffer | null): ScoreInfo | null {
  if (!buffer) return null;
  return {
    version: buffer.version,
    runId: buffer.runId,
    revision: buffer.revision,
    channel: buffer.channel,
    ignoredChannel: buffer.ignoredChannel,
    sketchName: buffer.sketchName,
    canvasWidth: buffer.canvasWidth,
    canvasHeight: buffer.canvasHeight,
    gestureSizeM: buffer.gestureSizeM,
    scaleM: buffer.scaleM,
    spanWidthM: buffer.spanWidthM,
    spanHeightM: buffer.spanHeightM,
    kind: buffer.kind,
    scoreStart: buffer.scoreStart,
    scoreEnd: buffer.scoreEnd,
    interval: buffer.interval,
    widened: buffer.widened,
    travelPx: buffer.travelPx,
  };
}

function viewScore(track: ScoreTrack): ScoreView {
  return {
    info: scoreInfo(track.buffer),
    playbackRate: track.playbackRate,
    entryRate: track.entryRate,
    cursor: track.cursor,
    canvasX: track.canvasX,
    canvasY: track.canvasY,
    contact: track.contact,
    requested: track.requested ? copyVec(track.requested) : null,
    measured: track.measured ? copyVec(track.measured) : null,
    lastErrorM: track.lastErrorM,
    maxErrorM: track.maxErrorM,
    rmsErrorM: rmsError(track.errorSumSq, track.samples),
    minMarginM: track.minMarginM,
    maxAbsRollRad: track.maxAbsRollRad,
    maxAbsPitchRad: track.maxAbsPitchRad,
    maxTorqueNm: track.maxTorqueNm,
    saturated: track.saturated,
    unreachable: track.unreachable,
    held: track.held,
    finished: track.finished,
    initialReachable: track.initialReachable,
    desiredContact: track.desiredContact.map((run) => run.map((point) => copyVec(point))),
    desiredTravel: track.desiredTravel.map((run) => run.map((point) => copyVec(point))),
    achieved: track.achieved.map((point) => copyVec(point)),
    achievedWidthM: track.achievedWidthM,
    achievedDepthM: track.achievedDepthM,
    origin: track.origin ? copyVec(track.origin) : null,
  };
}

function emptyDraw(): DrawTrack {
  return {
    anchor: null,
    radiusM: 0,
    direction: 'ccw',
    achievedHeightM: null,
    samples: 0,
    errorSumSq: 0,
    maxErrorM: 0,
    lastErrorM: null,
    minMarginM: null,
    maxAbsRollRad: 0,
    maxAbsPitchRad: 0,
    maxTorqueNm: 0,
    saturated: false,
    unreachable: false,
    held: true,
    revolution: false,
    desired: [],
    achieved: [],
    achievedWidthM: null,
    achievedDepthM: null,
  };
}

function emptyPeaks(): ExperimentPeaks {
  return {
    minThreeLegMarginM: null,
    minMarginStage: null,
    maxAbsRollRad: 0,
    maxAbsPitchRad: 0,
    maxTorqueNm: 0,
    saturated: false,
  };
}

function copyVec(point: Vec3): Vec3 {
  return [point[0], point[1], point[2]];
}

function copyDraw(track: DrawTrack): DrawTrack {
  return {
    ...track,
    anchor: track.anchor ? copyVec(track.anchor) : null,
    desired: track.desired.map((point) => copyVec(point)),
    achieved: track.achieved.map((point) => copyVec(point)),
  };
}

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
    draw: emptyDraw(),
    score: emptyScore(),
    peaks: emptyPeaks(),
  };
}

export function viewOf(memory: ExperimentMemory): ExperimentView {
  const draw = copyDraw(memory.draw);
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
    flTarget: memory.flTarget ? copyVec(memory.flTarget) : null,
    postureHolding: memory.postureHolding,
    unreachable: [...memory.unreachable],
    draw,
    score: viewScore(memory.score),
    peaks: { ...memory.peaks },
    rmsErrorM: rmsError(draw.errorSumSq, draw.samples),
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
  next.draw = emptyDraw();
  next.score = emptyScore();
  next.score.playbackRate = memory.score.playbackRate;
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
  next.draw = emptyDraw();
  next.peaks = emptyPeaks();
  next.score = emptyScore();
  next.score.buffer = memory.score.buffer;
  next.score.playbackRate = memory.score.playbackRate;
  if (memory.mode === 'score' && !next.score.buffer) {
    next.playback = 'paused';
    next.stage = 'done';
    next.outcome = 'failed';
    next.criteria = { ...EMPTY_CRITERIA, track: false };
    next.reason = 'No creative trajectory is ready. Run a sketch in Create, then start again. The pose was not jumped.';
    next.failure = next.reason;
    return next;
  }
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
  observePeaks(next, sample);

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
  if (next.stage === 'draw' && plan.flTarget) observeDraw(next, sample, plan.flTarget, plan.unreachable.includes('FL'));
  if (next.stage === 'track' && plan.flTarget) observeScore(next, sample, plan.flTarget, plan.unreachable.includes('FL'));
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
    memory.stageTime = 0;
    if (memory.mode === 'air-draw') {
      beginCircle(memory, sample);
      memory.stage = 'draw';
      memory.reason = 'Draw: the front-left foot follows a horizontal circle. The radius is not reduced.';
      return;
    }
    if (memory.mode === 'score') {
      const supported = memory.criteria.stand === true && memory.criteria.shift === true && memory.criteria.lift === true;
      if (!supported) {
        memory.criteria.track = false;
        memory.playback = 'paused';
        memory.stage = 'done';
        memory.outcome = 'failed';
        if (!memory.failure) memory.failure = 'Three-leg support was not established, so creative tracking did not start.';
        memory.reason = memory.failure;
        return;
      }
      if (beginTrack(memory, sample)) {
        memory.stage = 'track';
        memory.reason = 'Track: FL follows the selected creative brush. The other brush is ignored.';
      }
      return;
    }
    memory.stage = 'hold';
    memory.criteria.hold = holdOk(sample, memory);
    memory.reason = 'Hold: keeping the front-left foot up.';
    return;
  }
  if (memory.stage === 'draw') {
    finishCircle(memory, sample);
    memory.stage = 'hold';
    memory.stageTime = 0;
    memory.criteria.hold = holdOk(sample, memory);
    memory.reason = 'Hold: keeping the foot at the end of the circle.';
    return;
  }
  if (memory.stage === 'track') {
    finishTrack(memory);
    memory.stage = 'hold';
    memory.stageTime = 0;
    memory.criteria.hold = holdOk(sample, memory);
    memory.reason = 'Hold: keeping the foot at the end of the creative score.';
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
    const stancePassed =
      memory.criteria.stand === true &&
      memory.criteria.shift === true &&
      memory.criteria.lift === true &&
      memory.criteria.hold === true &&
      memory.criteria.return === true;
    const gesturePassed =
      memory.mode === 'air-draw'
        ? memory.criteria.draw === true
        : memory.mode === 'score'
          ? memory.criteria.track === true
          : true;
    const passed = stancePassed && gesturePassed;
    memory.outcome = passed ? 'completed' : 'failed';
    memory.reason = passed
      ? memory.mode === 'air-draw'
        ? 'Completed. Every stage met its measurements, including the draw tracking threshold. This is not dynamic stability and it is not a safety result.'
        : memory.mode === 'score'
          ? 'Completed. Every stage met its measurements, including the creative-score tracking threshold. This is not dynamic stability and it is not a safety result.'
          : 'Completed. Every stage met its measurements. This is not dynamic stability and it is not a safety result.'
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
  const drawing = memory.stage === 'draw' && memory.draw.anchor !== null && memory.draw.radiusM > 0;
  if (drawing && memory.draw.anchor) {
    feet.FL = circlePoint(
      { anchor: memory.draw.anchor, radiusM: memory.draw.radiusM, direction: memory.draw.direction },
      progress(memory),
    );
  }
  const tracking = memory.stage === 'track' && memory.score.buffer !== null && memory.score.origin !== null;
  if (tracking) feet.FL = scoreFoot(memory);
  const scoreHold = memory.mode === 'score' && memory.stage === 'hold' && memory.score.holdTarget !== null;
  const scoreReturn = memory.mode === 'score' && memory.stage === 'return' && memory.score.holdTarget !== null;
  if ((scoreHold || scoreReturn) && memory.score.holdTarget) {
    const end = memory.score.holdTarget;
    const home = planted.feet.FL;
    const blendOut = scoreHold ? 1 : 1 - smoothstep(progress(memory));
    feet.FL = [
      home[0] + (end[0] - home[0]) * blendOut,
      home[1] + (end[1] - home[1]) * blendOut,
      home[2] + (end[2] - home[2]) * blendOut,
    ];
  }
  const solved = jointsForFeet(body, planted.orientation, feet);
  if (liftScale > 0.02 || drawing || tracking || scoreHold) {
    // Support legs stay on the commanded body so the shift holds. The lifted
    // foot is solved from the measured body, so a lower body does not leave
    // the foot on the floor. An unreachable point is reported, not shrunk.
    applyMeasuredFoot(solved, sample, feet.FL);
  }
  const showTarget = liftScale > 0 || drawing || tracking || scoreHold || scoreReturn;
  return { joints: solved.joints, flTarget: showTarget ? feet.FL : null, unreachable: solved.unreachable };
}

function applyMeasuredFoot(
  solved: { joints: Go2JointState; unreachable: LegId[] },
  sample: PhysicsSnapshot,
  worldFoot: Vec3,
): void {
  const local = worldPointToBody(sample.basePosition, sample.baseQuaternion, worldFoot);
  const flSolved = analyticalFoot('FL', local);
  const others = solved.unreachable.filter((id) => id !== 'FL');
  if (!flSolved) {
    solved.unreachable = [...others, 'FL'];
    return;
  }
  solved.joints.FL = [flSolved.joints[0], flSolved.joints[1], flSolved.joints[2]];
  solved.unreachable = flSolved.reachable ? others : [...others, 'FL'];
}

function blend(memory: ExperimentMemory, kind: 'shift' | 'lift'): number {
  if (memory.stage === 'hold' || memory.stage === 'draw' || memory.stage === 'track') return 1;
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
  if (memory.stage === 'draw') return memory.config.drawSeconds;
  if (memory.stage === 'track') {
    const buffer = memory.score.buffer;
    if (!buffer) return memory.config.approachSeconds;
    const rate = memory.score.entryRate > 0 ? memory.score.entryRate : memory.score.playbackRate;
    return trackStageSeconds(buffer, rate, memory.config.approachSeconds);
  }
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

function beginCircle(memory: ExperimentMemory, sample: PhysicsSnapshot): void {
  const measured = footWorld(sample, 'FL');
  const anchor = memory.flTarget ? copyVec(memory.flTarget) : copyVec(measured);
  const path = {
    anchor,
    radiusM: memory.config.circleRadiusM,
    direction: memory.config.direction,
  };
  memory.draw = {
    ...emptyDraw(),
    anchor,
    radiusM: path.radiusM,
    direction: path.direction,
    achievedHeightM: measured[2],
    desired: circleSamples(path),
  };
}

function finishCircle(memory: ExperimentMemory, sample: PhysicsSnapshot): void {
  const track = memory.draw;
  track.revolution = true;
  const achieved = footWorld(sample, 'FL');
  track.achieved = [...track.achieved, copyVec(achieved)];
  const span = pathSpan(track.achieved);
  track.achievedWidthM = span?.widthM ?? null;
  track.achievedDepthM = span?.depthM ?? null;
  const within = track.samples > 0 && track.maxErrorM <= DRAW_MAX_ERROR_M;
  if (!within) {
    remember(
      memory,
      `Draw tracking error reached ${(track.maxErrorM * 1000).toFixed(1)} mm. The evaluation threshold is ${(DRAW_MAX_ERROR_M * 1000).toFixed(0)} mm. The circle was not shrunk.`,
    );
  }
  memory.criteria.draw = track.held && !track.unreachable && within;
}

export function installScore(memory: ExperimentMemory, buffer: ScoreBuffer): ExperimentMemory {
  if (!buffer || !Array.isArray(buffer.points) || buffer.points.length < 2 || !Number.isFinite(buffer.version)) {
    const next = fresh(memory);
    next.reason = 'The trajectory buffer was incomplete, so it was not used. No path was invented.';
    return next;
  }
  if (memory.score.buffer && buffer.version < memory.score.buffer.version) return memory;
  if (memory.playback === 'playing') {
    const next = fresh(memory);
    next.reason = 'A trajectory arrived while the experiment was running. It was not applied, and the pose was not jumped.';
    return next;
  }
  const next = fresh(memory);
  next.score = emptyScore();
  next.score.buffer = buffer;
  next.score.playbackRate = memory.score.playbackRate;
  return next;
}

export function clearScore(memory: ExperimentMemory): ExperimentMemory {
  const next = fresh(memory);
  const rate = memory.score.playbackRate;
  next.score = emptyScore();
  next.score.playbackRate = rate;
  if (memory.playback === 'playing' && memory.mode === 'score') {
    next.playback = 'paused';
    next.outcome = 'interrupted';
    next.reason = 'The creative trajectory was dropped because the sketch changed. The pose was not jumped.';
  }
  return next;
}

export function setPlaybackRate(memory: ExperimentMemory, rate: number): ExperimentMemory {
  const safe = Number.isFinite(rate) ? Math.min(4, Math.max(0.1, rate)) : 1;
  if (memory.score.playbackRate === safe) return memory;
  const next = fresh(memory);
  next.score = { ...next.score, playbackRate: safe };
  return next;
}

function beginTrack(memory: ExperimentMemory, sample: PhysicsSnapshot): boolean {
  const buffer = memory.score.buffer;
  const measured = footWorld(sample, 'FL');
  const origin = memory.flTarget ? copyVec(memory.flTarget) : copyVec(measured);
  if (!buffer) {
    memory.criteria.track = false;
    memory.playback = 'paused';
    memory.stage = 'done';
    memory.outcome = 'failed';
    memory.reason = 'No creative trajectory is ready. Tracking did not start, and no path was invented.';
    memory.failure = memory.reason;
    return false;
  }
  const first = buffer.points[0];
  if (!first) {
    memory.criteria.track = false;
    memory.playback = 'paused';
    memory.stage = 'done';
    memory.outcome = 'failed';
    memory.reason = 'The creative trajectory has no first sample. Tracking did not start.';
    memory.failure = memory.reason;
    return false;
  }
  const target = mapGesture(buffer, origin, first.x, first.y);
  const local = worldPointToBody(sample.basePosition, sample.baseQuaternion, target);
  const solved = analyticalFoot('FL', local);
  const reachable = Boolean(solved?.reachable);
  const paths = splitGesturePaths(buffer, origin);
  const rate = memory.score.playbackRate;
  memory.score = {
    ...emptyScore(),
    buffer,
    origin,
    playbackRate: rate,
    entryRate: rate,
    cursor: buffer.scoreStart,
    canvasX: first.x,
    canvasY: first.y,
    contact: first.contact,
    requested: target,
    initialReachable: reachable,
    desiredContact: paths.contact,
    desiredTravel: paths.travel,
  };
  if (!reachable) {
    memory.criteria.track = false;
    memory.playback = 'paused';
    memory.stage = 'done';
    memory.outcome = 'failed';
    memory.reason =
      'The first creative target is outside the reachable workspace. Tracking did not start, and the drawing was not resized.';
    memory.failure = memory.reason;
    return false;
  }
  return true;
}

function finishTrack(memory: ExperimentMemory): void {
  const track = memory.score;
  const buffer = track.buffer;
  track.holdTarget = track.requested ? copyVec(track.requested) : track.origin ? copyVec(track.origin) : null;
  const played = !buffer || track.cursor >= buffer.scoreEnd - Math.max(buffer.interval, 0.05);
  track.finished = played;
  const within = track.samples > 0 && track.maxErrorM <= DRAW_MAX_ERROR_M;
  if (!within) {
    remember(
      memory,
      `Creative tracking error reached ${(track.maxErrorM * 1000).toFixed(1)} mm. The evaluation threshold is ${(DRAW_MAX_ERROR_M * 1000).toFixed(0)} mm. The drawing was not resized.`,
    );
  }
  if (!played) {
    remember(
      memory,
      'The score did not finish inside the tracking stage. Playback rate changes commanded speed, and the stage length stays at the rate from when tracking began.',
    );
  }
  memory.criteria.track = track.held && !track.unreachable && within && played && track.initialReachable === true;
}

function scoreFoot(memory: ExperimentMemory): Vec3 {
  const buffer = memory.score.buffer;
  const origin = memory.score.origin;
  if (!buffer || !origin) return memory.flTarget ? copyVec(memory.flTarget) : [0, 0, 0];
  const approach = memory.config.approachSeconds;
  const first = buffer.points[0]!;
  if (memory.stageTime < approach) {
    const end = mapGesture(buffer, origin, first.x, first.y);
    const unit = smootherstep(memory.stageTime / approach);
    const point: Vec3 = [
      origin[0] + (end[0] - origin[0]) * unit,
      origin[1] + (end[1] - origin[1]) * unit,
      origin[2] + (end[2] - origin[2]) * unit,
    ];
    memory.score.cursor = buffer.scoreStart;
    memory.score.canvasX = first.x;
    memory.score.canvasY = first.y;
    memory.score.contact = first.contact;
    memory.score.requested = point;
    return point;
  }
  const cursor = buffer.scoreStart + (memory.stageTime - approach) * memory.score.playbackRate;
  const sampled = sampleScore(buffer, cursor);
  const point = mapGesture(buffer, origin, sampled.x, sampled.y);
  memory.score.cursor = sampled.time;
  memory.score.canvasX = sampled.x;
  memory.score.canvasY = sampled.y;
  memory.score.contact = sampled.contact;
  memory.score.requested = point;
  if (sampled.time >= buffer.scoreEnd - 1e-6) memory.score.finished = true;
  return point;
}

function observeScore(memory: ExperimentMemory, sample: PhysicsSnapshot, desired: Vec3, unreachable: boolean): void {
  const track = memory.score;
  const achieved = footWorld(sample, 'FL');
  const error = trackingError(desired, achieved);
  track.samples += 1;
  track.errorSumSq += error * error;
  if (error > track.maxErrorM) track.maxErrorM = error;
  track.lastErrorM = error;
  track.measured = copyVec(achieved);
  const margin = sample.support.threeLegMarginM;
  if (margin !== null) track.minMarginM = track.minMarginM === null ? margin : Math.min(track.minMarginM, margin);
  track.maxAbsRollRad = Math.max(track.maxAbsRollRad, Math.abs(sample.rollRad));
  track.maxAbsPitchRad = Math.max(track.maxAbsPitchRad, Math.abs(sample.pitchRad));
  track.maxTorqueNm = Math.max(track.maxTorqueNm, sample.maxAbsTorqueNm);
  if (sample.saturated) track.saturated = true;
  if (unreachable) {
    track.unreachable = true;
    remember(memory, 'Creative tracking asked for a foot position inverse kinematics could not reach. The drawing was not resized.');
  }
  if (!drawSupported(sample, memory)) {
    track.held = false;
    remember(memory, 'Creative tracking lost three-leg support or the front-left foot touched down.');
  }
  if (!track.held || track.unreachable || track.maxErrorM > DRAW_MAX_ERROR_M) memory.criteria.track = false;
  const slot = Math.min(SCORE_SLOT_COUNT - 1, Math.floor(progress(memory) * SCORE_SLOT_COUNT));
  if (track.achieved.length <= slot) track.achieved = [...track.achieved, copyVec(achieved)];
  const span = pathSpan(track.achieved);
  track.achievedWidthM = span?.widthM ?? null;
  track.achievedDepthM = span?.depthM ?? null;
}

function observeDraw(memory: ExperimentMemory, sample: PhysicsSnapshot, desired: Vec3, unreachable: boolean): void {
  const track = memory.draw;
  const achieved = footWorld(sample, 'FL');
  const error = trackingError(desired, achieved);
  track.samples += 1;
  track.errorSumSq += error * error;
  if (error > track.maxErrorM) track.maxErrorM = error;
  track.lastErrorM = error;
  const margin = sample.support.threeLegMarginM;
  if (margin !== null) track.minMarginM = track.minMarginM === null ? margin : Math.min(track.minMarginM, margin);
  track.maxAbsRollRad = Math.max(track.maxAbsRollRad, Math.abs(sample.rollRad));
  track.maxAbsPitchRad = Math.max(track.maxAbsPitchRad, Math.abs(sample.pitchRad));
  track.maxTorqueNm = Math.max(track.maxTorqueNm, sample.maxAbsTorqueNm);
  if (sample.saturated) track.saturated = true;
  if (unreachable) {
    track.unreachable = true;
    remember(memory, 'Draw asked for a foot position inverse kinematics could not reach. The circle was not shrunk.');
  }
  if (!drawSupported(sample, memory)) {
    track.held = false;
    remember(memory, 'Draw lost three-leg support or the front-left foot touched down.');
  }
  if (!track.held || track.unreachable || track.maxErrorM > DRAW_MAX_ERROR_M) memory.criteria.draw = false;
  const slot = Math.min(CIRCLE_SLOT_COUNT - 1, Math.floor(progress(memory) * CIRCLE_SLOT_COUNT));
  if (track.achieved.length <= slot) track.achieved = [...track.achieved, copyVec(achieved)];
  const span = pathSpan(track.achieved);
  track.achievedWidthM = span?.widthM ?? null;
  track.achievedDepthM = span?.depthM ?? null;
}

const CIRCLE_SLOT_COUNT = 64;

function observePeaks(memory: ExperimentMemory, sample: PhysicsSnapshot): void {
  const margin = sample.support.threeLegMarginM;
  if (margin !== null && (memory.peaks.minThreeLegMarginM === null || margin < memory.peaks.minThreeLegMarginM)) {
    memory.peaks.minThreeLegMarginM = margin;
    memory.peaks.minMarginStage = memory.stage;
  }
  memory.peaks.maxAbsRollRad = Math.max(memory.peaks.maxAbsRollRad, Math.abs(sample.rollRad));
  memory.peaks.maxAbsPitchRad = Math.max(memory.peaks.maxAbsPitchRad, Math.abs(sample.pitchRad));
  memory.peaks.maxTorqueNm = Math.max(memory.peaks.maxTorqueNm, sample.maxAbsTorqueNm);
  if (sample.saturated) memory.peaks.saturated = true;
}

function drawSupported(sample: PhysicsSnapshot, memory: ExperimentMemory): boolean {
  return lifted(sample, memory) && sample.support.threeLegInside && (sample.support.threeLegMarginM ?? -1) > 0;
}

function fresh(memory: ExperimentMemory): ExperimentMemory {
  return {
    ...memory,
    config: memory.config,
    criteria: { ...memory.criteria },
    planted: memory.planted,
    targets: memory.targets ? copyJoints(memory.targets) : null,
    flTarget: memory.flTarget ? copyVec(memory.flTarget) : null,
    unreachable: [...memory.unreachable],
    draw: copyDraw(memory.draw),
    score: shareScore(memory.score),
    peaks: { ...memory.peaks },
  };
}

function smoothstep(unit: number): number {
  const t = Math.min(1, Math.max(0, unit));
  return t * t * (3 - 2 * t);
}

function zeroTorques(count: number): number[] {
  return Array.from({ length: count }, () => 0);
}
