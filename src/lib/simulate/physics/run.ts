/**
 * Host-clock follower for motors-off physics, and the experiment clock.
 *
 * The creative timeline is not replaced. Motors Off integrates toward that
 * clock from the reference posture. Posture Hold, Three-Leg Stance, Drawing
 * in the Air, and Creative Score Tracking use physics experiment time, and
 * only while they are playing. Seeking the score does not rewind a pose the
 * controller has moved. A creative trajectory is sampled on this thread and
 * then sent to the worker as a buffer.
 */

import { get } from 'svelte/store';
import { motionOutput } from '../../motion/output.ts';
import { seek, setPlayState, timeline } from '../../motion/timeline.ts';
import { paramRevision } from '../../params/store.ts';
import { simSettings } from '../go2/settings.ts';
import { currentScoreEpoch, invalidateScorePreparation, prepareCreativeScore } from './prepareScore.ts';
import { selectSimulationBackend, simulationBackend } from './backend.ts';
import { planPhysicsAdvance, physicsRequestedTime } from './clock.ts';
import { createPhysicsClient, type PhysicsClient } from './client.ts';
import type { ExperimentView, PhysicsMode } from './experiment.ts';
import { applyGroundCandidate, applyMountProfile, setBoardThickness } from './candidate.ts';
import { groundReferenceConfig } from './approachAudit.ts';
import { DEFAULT_EXPERIMENT, EXPERIMENT_STEPS_PER_FRAME, TIMELINE_HOLD_NOTE, type ExperimentConfig } from './settings.ts';
import { writable } from 'svelte/store';
import type { PhysicsModelInfo, PhysicsSnapshot } from './types.ts';

export type PhysicsActivity = 'idle' | 'holding' | 'integrating' | 'replaying' | 'before-run';

export interface PhysicsRunState {
  status: 'idle' | 'loading' | 'ready' | 'error';
  error: string;
  notice: string;
  activity: PhysicsActivity;
  epoch: number | null;
  integrated: number;
  timestep: number;
  info: PhysicsModelInfo | null;
  snapshot: PhysicsSnapshot | null;
  mode: PhysicsMode;
  config: ExperimentConfig;
  experiment: ExperimentView | null;
  /** True after Start until Reset. The creative clock must not move this pose. */
  controllerUsed: boolean;
  timelineFollow: boolean;
  /** True after a completed Candidate A approach. Aerial Gesture stays disabled until then. */
  approachReady: boolean;
  /** True while the sandbox is sampling a creative score for the next Start. */
  preparing: boolean;
}

export const INITIAL_PHYSICS_RUN: PhysicsRunState = {
  status: 'idle',
  error: '',
  notice: '',
  activity: 'idle',
  epoch: null,
  integrated: 0,
  timestep: 0,
  info: null,
  snapshot: null,
  mode: 'motors-off',
  config: DEFAULT_EXPERIMENT,
  experiment: null,
  controllerUsed: false,
  timelineFollow: true,
  approachReady: false,
  preparing: false,
};

export const physicsRun = writable<PhysicsRunState>(INITIAL_PHYSICS_RUN);

let client: PhysicsClient | null = null;
let generation = 0;
let pumping = false;
let queued = false;
let ticking = false;
let attached = false;
let raf = 0;

export function attachPhysicsDirector(): () => void {
  client = createPhysicsClient();
  attached = true;
  const stopClock = timeline.subscribe(() => {
    void pump();
  });
  const stopBackend = simulationBackend.subscribe(() => {
    void pump();
  });
  let scoreKey = scoreSignature();
  const dropStaleScore = () => {
    const nextKey = scoreSignature();
    if (nextKey === scoreKey) return;
    scoreKey = nextKey;
    invalidateScorePreparation();
    const current = client;
    const run = get(physicsRun);
    if (!current || run.status !== 'ready' || run.mode !== 'score') return;
    void current.clearScore().then((experiment) => {
      physicsRun.update((state) => ({
        ...state,
        experiment,
        snapshot: state.snapshot,
        notice: experiment.reason || 'The sketch changed. The previous trajectory was dropped.',
      }));
    });
  };
  const stopMotion = motionOutput.subscribe(dropStaleScore);
  const stopParams = paramRevision.subscribe(dropStaleScore);
  const loop = () => {
    if (!attached) return;
    raf = requestAnimationFrame(() => {
      void experimentFrame();
      loop();
    });
  };
  loop();
  return () => {
    attached = false;
    if (raf) cancelAnimationFrame(raf);
    stopClock();
    stopBackend();
    stopMotion();
    stopParams();
    generation += 1;
    client?.dispose();
    client = null;
    pumping = false;
    queued = false;
    ticking = false;
    physicsRun.set(INITIAL_PHYSICS_RUN);
  };
}

export function chooseKinematicPreview(): void {
  selectSimulationBackend('kinematic');
}

export function choosePhysicsExperiment(): void {
  selectSimulationBackend('mujoco');
}

export async function initializePhysics(): Promise<void> {
  const current = client;
  if (!current) return;
  selectSimulationBackend('mujoco');
  const ticket = ++generation;
  const mode = get(physicsRun).mode;
  const config = get(physicsRun).config;
  physicsRun.update((state) => ({
    ...state,
    status: 'loading',
    error: '',
    notice: 'Loading MuJoCo and the Unitree Go2 model.',
    controllerUsed: false,
  }));
  try {
    const loaded = await current.load();
    if (ticket !== generation) return;
    let experiment = loaded.experiment;
    if (mode !== 'motors-off') experiment = await current.setMode(mode);
    if (ticket !== generation) return;
    const configured = await current.configure(config);
    if (ticket !== generation) return;
    experiment = configured.experiment;
    physicsRun.set({
      status: 'ready',
      error: '',
      notice: experiment.reason || 'Reference posture. Motor commands are 0 Nm until a controller is started.',
      activity: 'holding',
      epoch: get(timeline).time,
      integrated: configured.snapshot.time,
      timestep: loaded.info.timestep,
      info: loaded.info,
      snapshot: configured.snapshot,
      mode,
      config: experiment.config,
      experiment,
      controllerUsed: false,
      timelineFollow: mode === 'motors-off',
      approachReady: false,
      preparing: false,
    });
    void pump();
  } catch (error) {
    if (ticket !== generation) return;
    physicsRun.update((state) => ({
      ...state,
      status: 'error',
      error: error instanceof Error ? error.message : 'MuJoCo failed to load.',
      notice: '',
    }));
  }
}

export async function resetPhysics(): Promise<void> {
  const current = client;
  const run = get(physicsRun);
  if (!current || run.status !== 'ready') return;
  invalidateScorePreparation();
  const ticket = ++generation;
  setPlayState('paused');
  physicsRun.update((state) => ({ ...state, preparing: false }));
  try {
    const result = await current.reset();
    if (ticket !== generation) return;
    physicsRun.update((state) => ({
      ...state,
      epoch: get(timeline).time,
      integrated: result.snapshot.time,
      snapshot: result.snapshot,
      experiment: result.experiment,
      activity: 'holding',
      controllerUsed: false,
      timelineFollow: state.mode === 'motors-off',
      approachReady: false,
      notice: 'Reset to the reference posture. Motor commands are 0 Nm.',
    }));
  } catch (error) {
    if (ticket !== generation) return;
    physicsRun.update((state) => ({
      ...state,
      status: 'error',
      error: error instanceof Error ? error.message : 'Physics reset failed.',
    }));
  }
}

/** Move the shared timeline forward by one physics step, then let the director integrate. */
export function stepPhysicsOnce(): void {
  const run = get(physicsRun);
  if (run.status !== 'ready' || !(run.timestep > 0) || !run.timelineFollow) return;
  const clock = get(timeline);
  setPlayState('paused');
  seek(clock.time + run.timestep);
}

export async function setPhysicsMode(mode: PhysicsMode): Promise<void> {
  invalidateScorePreparation();
  physicsRun.update((state) => ({
    ...state,
    mode,
    preparing: false,
    timelineFollow: mode === 'motors-off' && !state.controllerUsed,
  }));
  const current = client;
  if (!current || get(physicsRun).status !== 'ready') return;
  const ticket = ++generation;
  try {
    const experiment = await current.setMode(mode);
    if (ticket !== generation) return;
    physicsRun.update((state) => ({
      ...state,
      experiment,
      notice: experiment.reason || state.notice,
    }));
  } catch (error) {
    if (ticket !== generation) return;
    physicsRun.update((state) => ({
      ...state,
      status: 'error',
      error: error instanceof Error ? error.message : 'The controller mode could not be changed.',
    }));
  }
}

export async function selectGroundCandidate(candidate: Parameters<typeof applyGroundCandidate>[1]): Promise<void> {
  const next = applyGroundCandidate(get(physicsRun).config, candidate);
  physicsRun.update((state) => ({ ...state, approachReady: false }));
  await configureExperiment(next);
}

export async function selectBoardThickness(thicknessM: number): Promise<void> {
  const next = setBoardThickness(get(physicsRun).config, thicknessM);
  physicsRun.update((state) => ({ ...state, approachReady: false }));
  await configureExperiment(next);
}

export async function selectMountProfile(profile: 'baseline' | 'candidate-a' | 'ground'): Promise<void> {
  const next = applyMountProfile(get(physicsRun).config, profile);
  if (profile !== 'candidate-a') {
    physicsRun.update((state) => ({ ...state, approachReady: false }));
  }
  await configureExperiment(next);
}

export async function loadGroundReference(): Promise<void> {
  const next = groundReferenceConfig(get(physicsRun).config);
  physicsRun.update((state) => ({ ...state, approachReady: false }));
  await configureExperiment(next);
}

/**
 * One clearance, from the home keyframe. A failed trial does not start another.
 * The caller resets before this run, so the next button is a separate trial.
 */
export async function startClearanceTrial(clearanceM: number): Promise<void> {
  const run = get(physicsRun);
  if (run.status !== 'ready' || run.preparing || run.experiment?.playback === 'playing') return;
  await configureExperiment({ ...run.config, brushClearanceM: clearanceM });
  await resetPhysics();
  await setPhysicsMode('brush-approach');
  await startExperiment();
}

export async function startCandidateApproach(): Promise<void> {
  physicsRun.update((state) => ({ ...state, approachReady: false }));
  await setPhysicsMode('brush-approach');
  await startExperiment();
}

export async function startAerialGesture(): Promise<void> {
  if (!get(physicsRun).approachReady) return;
  await setPhysicsMode('aerial-gesture');
  await startExperiment();
}

export async function configureExperiment(config: ExperimentConfig): Promise<void> {
  physicsRun.update((state) => ({ ...state, config }));
  const current = client;
  if (!current || get(physicsRun).status !== 'ready') return;
  try {
    const result = await current.configure(config);
    physicsRun.update((state) => ({
      ...state,
      experiment: result.experiment,
      snapshot: result.snapshot,
      integrated: result.snapshot.time,
      config: result.experiment.config,
      notice: result.experiment.reason || state.notice,
      approachReady:
        result.experiment.config.mountProfile === 'candidate-a' || result.experiment.config.mountProfile === 'ground'
          ? state.approachReady
          : false,
    }));
  } catch (error) {
    physicsRun.update((state) => ({
      ...state,
      status: 'error',
      error: error instanceof Error ? error.message : 'The experiment settings could not be saved.',
    }));
  }
}

export async function startExperiment(): Promise<void> {
  const current = client;
  const run = get(physicsRun);
  if (!current || run.status !== 'ready' || run.mode === 'motors-off' || run.preparing) return;
  const ticket = ++generation;
  const epoch = currentScoreEpoch();
  try {
    const paper = get(simSettings).paper;
    const nextConfig =
      run.config.mountProfile === 'candidate-a' || run.config.mountProfile === 'ground'
        ? run.config
        : {
            ...run.config,
            paperOriginX: paper.origin[0],
            paperOriginY: paper.origin[1],
            paperOriginZ: paper.origin[2],
            paperYawRad: paper.yawRad,
            paperWidthM: paper.widthM,
            paperHeightM: paper.heightM,
          };
    const snapped = await current.configure(nextConfig);
    if (ticket !== generation) return;
    physicsRun.update((state) => ({
      ...state,
      config: snapped.experiment.config,
      experiment: snapped.experiment,
      snapshot: snapped.snapshot,
      integrated: snapped.snapshot.time,
      notice: snapped.experiment.reason || state.notice,
    }));
    if (run.mode === 'score') {
      physicsRun.update((state) => ({
        ...state,
        preparing: true,
        error: '',
        notice: 'Sampling the creative score in the sandbox.',
      }));
      const prepared = await prepareCreativeScore({
        channel: run.config.channel,
        gestureSizeM: run.config.gestureSizeM,
        windowSeconds: run.config.trackSeconds,
        sampleIntervalS: run.config.sampleIntervalS,
      });
      if (ticket !== generation) {
        physicsRun.update((state) => ({ ...state, preparing: false }));
        return;
      }
      if (!prepared.ok || prepared.buffer.version === 0 || currentScoreEpoch() !== epoch) {
        physicsRun.update((state) => ({
          ...state,
          preparing: false,
          notice: prepared.ok
            ? 'The sketch changed while the score was being sampled. The trajectory was discarded.'
            : prepared.reason,
        }));
        return;
      }
      const installed = await current.setScore(prepared.buffer);
      if (ticket !== generation || currentScoreEpoch() !== epoch) {
        physicsRun.update((state) => ({ ...state, preparing: false, experiment: installed }));
        return;
      }
      physicsRun.update((state) => ({ ...state, experiment: installed }));
    }
    const result = await current.start();
    if (ticket !== generation) return;
    physicsRun.update((state) => ({
      ...state,
      preparing: false,
      controllerUsed: true,
      timelineFollow: false,
      snapshot: result.snapshot,
      experiment: result.experiment,
      notice: result.experiment.reason,
      activity: 'holding',
    }));
  } catch (error) {
    if (ticket !== generation) return;
    physicsRun.update((state) => ({
      ...state,
      preparing: false,
      status: 'error',
      error: error instanceof Error ? error.message : 'The experiment could not start.',
    }));
  }
}

function scoreSignature(): string {
  const output = get(motionOutput);
  return `${output.runId ?? ''}:${get(paramRevision)}`;
}

export async function pauseExperiment(): Promise<void> {
  await sendPlayback('pause');
}

export async function resumeExperiment(): Promise<void> {
  await sendPlayback('resume');
}

export async function stopExperiment(): Promise<void> {
  await sendPlayback('stop');
}

async function sendPlayback(action: 'pause' | 'resume' | 'stop'): Promise<void> {
  const current = client;
  if (!current || get(physicsRun).status !== 'ready') return;
  const ticket = ++generation;
  try {
    const result = await current[action]();
    if (ticket !== generation) return;
    physicsRun.update((state) => ({
      ...state,
      snapshot: result.snapshot,
      experiment: result.experiment,
      notice: result.experiment.reason || state.notice,
    }));
  } catch (error) {
    if (ticket !== generation) return;
    physicsRun.update((state) => ({
      ...state,
      status: 'error',
      error: error instanceof Error ? error.message : 'The experiment control failed.',
    }));
  }
}

async function experimentFrame(): Promise<void> {
  if (ticking || !client) return;
  const run = get(physicsRun);
  if (run.status !== 'ready' || run.experiment?.playback !== 'playing') return;
  ticking = true;
  const ticket = generation;
  try {
    const result = await client.tick(EXPERIMENT_STEPS_PER_FRAME, get(timeline).rate);
    if (ticket !== generation || !client) return;
    physicsRun.update((state) => ({
      ...state,
      snapshot: result.snapshot,
      experiment: result.experiment,
      integrated: result.snapshot.time,
      notice: result.experiment.reason,
      activity: result.experiment.playback === 'playing' ? 'integrating' : 'holding',
      approachReady:
        result.experiment.mode === 'brush-approach' &&
        result.experiment.outcome === 'completed' &&
        (result.experiment.config.mountProfile === 'candidate-a' || result.experiment.config.mountProfile === 'ground')
          ? true
          : state.approachReady,
    }));
  } catch (error) {
    if (ticket !== generation) return;
    physicsRun.update((state) => ({
      ...state,
      status: 'error',
      error: error instanceof Error ? error.message : 'Physics step failed.',
    }));
  } finally {
    ticking = false;
  }
}

async function pump(): Promise<void> {
  if (!client) return;
  if (pumping) {
    queued = true;
    return;
  }
  pumping = true;
  try {
    do {
      queued = false;
      const ticket = generation;
      const backend = get(simulationBackend);
      const run = get(physicsRun);
      if (backend !== 'mujoco' || run.status !== 'ready' || run.epoch === null) break;
      if (!run.timelineFollow) {
        if (run.controllerUsed && run.mode === 'motors-off' && run.notice !== TIMELINE_HOLD_NOTE) {
          physicsRun.update((state) => ({ ...state, activity: 'holding', notice: TIMELINE_HOLD_NOTE }));
        }
        break;
      }
      const requested = physicsRequestedTime(get(timeline).time, run.epoch);
      const plan = planPhysicsAdvance({ integrated: run.integrated, timestep: run.timestep }, requested);
      if (plan.action === 'blocked') {
        if (run.activity !== 'before-run' || run.notice !== plan.reason) {
          physicsRun.update((state) => ({ ...state, activity: 'before-run', notice: plan.reason }));
        }
        break;
      }
      if (plan.action === 'hold') {
        if (run.activity !== 'holding') {
          physicsRun.update((state) => ({ ...state, activity: 'holding' }));
        }
        break;
      }
      const current = client;
      if (!current) break;
      physicsRun.update((state) => ({
        ...state,
        activity: plan.action === 'replay' ? 'replaying' : 'integrating',
        notice:
          plan.action === 'replay'
            ? 'Replaying from the reference posture. The simulated pose is not jumped.'
            : 'Integrating fixed steps toward the shared timeline.',
      }));
      let snapshot: PhysicsSnapshot | null = null;
      if (plan.action === 'replay') snapshot = (await current.reset()).snapshot;
      if (ticket !== generation) return;
      if (plan.steps > 0) snapshot = await current.step(plan.steps);
      if (ticket !== generation || !snapshot) return;
      const caughtUp = plan.remaining === 0;
      physicsRun.update((state) => ({
        ...state,
        snapshot,
        integrated: snapshot.time,
        activity: caughtUp ? 'holding' : plan.action === 'replay' ? 'replaying' : 'integrating',
        notice: caughtUp ? 'Physics time matches the shared timeline. Motor commands are 0 Nm.' : state.notice,
      }));
      if (!caughtUp) queued = true;
    } while (queued);
  } catch (error) {
    physicsRun.update((state) => ({
      ...state,
      status: 'error',
      error: error instanceof Error ? error.message : 'Physics step failed.',
    }));
  } finally {
    pumping = false;
    if (queued && client) void pump();
  }
}
