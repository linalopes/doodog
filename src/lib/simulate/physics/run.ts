/**
 * Host-clock follower for motors-off physics, and the stance experiment clock.
 *
 * The creative timeline is not replaced. Motors Off integrates toward that
 * clock from the reference posture. Posture Hold and Three-Leg Stance use
 * physics experiment time instead, and only while they are playing. Seeking
 * the score does not rewind a pose the controller has moved.
 */

import { get } from 'svelte/store';
import { seek, setPlayState, timeline } from '../../motion/timeline.ts';
import { selectSimulationBackend, simulationBackend } from './backend.ts';
import { planPhysicsAdvance, physicsRequestedTime } from './clock.ts';
import { createPhysicsClient, type PhysicsClient } from './client.ts';
import type { ExperimentView, PhysicsMode } from './experiment.ts';
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
    experiment = await current.configure(config);
    if (ticket !== generation) return;
    physicsRun.set({
      status: 'ready',
      error: '',
      notice: 'Reference posture. Motor commands are 0 Nm until a controller is started.',
      activity: 'holding',
      epoch: get(timeline).time,
      integrated: loaded.snapshot.time,
      timestep: loaded.info.timestep,
      info: loaded.info,
      snapshot: loaded.snapshot,
      mode,
      config: experiment.config,
      experiment,
      controllerUsed: false,
      timelineFollow: mode === 'motors-off',
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
  const ticket = ++generation;
  setPlayState('paused');
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
  physicsRun.update((state) => ({
    ...state,
    mode,
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

export async function configureExperiment(config: ExperimentConfig): Promise<void> {
  physicsRun.update((state) => ({ ...state, config }));
  const current = client;
  if (!current || get(physicsRun).status !== 'ready') return;
  try {
    const experiment = await current.configure(config);
    physicsRun.update((state) => ({ ...state, experiment, config: experiment.config }));
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
  if (!current || run.status !== 'ready' || run.mode === 'motors-off') return;
  const ticket = ++generation;
  try {
    const result = await current.start();
    if (ticket !== generation) return;
    physicsRun.update((state) => ({
      ...state,
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
      status: 'error',
      error: error instanceof Error ? error.message : 'The experiment could not start.',
    }));
  }
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
    const result = await client.tick(EXPERIMENT_STEPS_PER_FRAME);
    if (ticket !== generation || !client) return;
    physicsRun.update((state) => ({
      ...state,
      snapshot: result.snapshot,
      experiment: result.experiment,
      integrated: result.snapshot.time,
      notice: result.experiment.reason,
      activity: result.experiment.playback === 'playing' ? 'integrating' : 'holding',
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
