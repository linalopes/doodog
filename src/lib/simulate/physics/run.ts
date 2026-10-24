/**
 * Host-clock follower for the physics experiment.
 *
 * The creative timeline is not replaced. Initialize anchors physics at the
 * current host time and loads WASM. Later host times are integrated. Earlier
 * times inside the run are replayed from the reference posture.
 */

import { get } from 'svelte/store';
import { seek, setPlayState, timeline } from '../../motion/timeline.ts';
import { selectSimulationBackend, simulationBackend } from './backend.ts';
import { planPhysicsAdvance, physicsRequestedTime } from './clock.ts';
import { createPhysicsClient, type PhysicsClient } from './client.ts';
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
};

export const physicsRun = writable<PhysicsRunState>(INITIAL_PHYSICS_RUN);

let client: PhysicsClient | null = null;
let generation = 0;
let pumping = false;
let queued = false;

export function attachPhysicsDirector(): () => void {
  client = createPhysicsClient();
  const stopClock = timeline.subscribe(() => {
    void pump();
  });
  const stopBackend = simulationBackend.subscribe(() => {
    void pump();
  });
  return () => {
    stopClock();
    stopBackend();
    generation += 1;
    client?.dispose();
    client = null;
    pumping = false;
    queued = false;
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
  physicsRun.update((state) => ({
    ...state,
    status: 'loading',
    error: '',
    notice: 'Loading MuJoCo and the Unitree Go2 model.',
  }));
  try {
    const loaded = await current.load();
    if (ticket !== generation) return;
    physicsRun.set({
      status: 'ready',
      error: '',
      notice: 'Reference posture. Motor commands are 0 Nm. No balance controller is running.',
      activity: 'holding',
      epoch: get(timeline).time,
      integrated: loaded.snapshot.time,
      timestep: loaded.info.timestep,
      info: loaded.info,
      snapshot: loaded.snapshot,
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
    const snapshot = await current.reset();
    if (ticket !== generation) return;
    physicsRun.update((state) => ({
      ...state,
      epoch: get(timeline).time,
      integrated: snapshot.time,
      snapshot,
      activity: 'holding',
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
  if (run.status !== 'ready' || !(run.timestep > 0)) return;
  const clock = get(timeline);
  setPlayState('paused');
  seek(clock.time + run.timestep);
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
      if (plan.action === 'replay') snapshot = await current.reset();
      if (ticket !== generation) return;
      if (plan.steps > 0) snapshot = await current.step(plan.steps);
      if (ticket !== generation || !snapshot) return;
      const caughtUp = plan.remaining === 0;
      physicsRun.update((state) => ({
        ...state,
        snapshot,
        integrated: snapshot.time,
        activity: caughtUp ? 'holding' : plan.action === 'replay' ? 'replaying' : 'integrating',
        notice: caughtUp
          ? 'Physics time matches the shared timeline. Motor commands are 0 Nm.'
          : state.notice,
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
