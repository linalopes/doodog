/**
 * Lazy handle for the physics worker.
 *
 * Importing this module does not load the WASM binary. The worker, and
 * therefore `@mujoco/mujoco`, is created on the first `load()`.
 */

import type { ExperimentView, PhysicsMode } from './experiment.ts';
import type { ScoreBuffer } from './score.ts';
import type { ExperimentConfig } from './settings.ts';
import type { PhysicsModelInfo, PhysicsSnapshot } from './types.ts';

interface Success {
  id: number;
  ok: true;
  snapshot: PhysicsSnapshot;
  info?: PhysicsModelInfo;
  experiment: ExperimentView;
}

interface Failure {
  id: number;
  ok: false;
  error: string;
}

type Reply = Success | Failure;

export interface PhysicsLoad {
  info: PhysicsModelInfo;
  snapshot: PhysicsSnapshot;
  experiment: ExperimentView;
}

export interface PhysicsStep {
  snapshot: PhysicsSnapshot;
  experiment: ExperimentView;
}

export interface PhysicsClient {
  load(): Promise<PhysicsLoad>;
  reset(): Promise<PhysicsStep>;
  step(count: number): Promise<PhysicsSnapshot>;
  configure(config: ExperimentConfig): Promise<ExperimentView>;
  setMode(mode: PhysicsMode): Promise<ExperimentView>;
  start(): Promise<PhysicsStep>;
  pause(): Promise<PhysicsStep>;
  resume(): Promise<PhysicsStep>;
  stop(): Promise<PhysicsStep>;
  tick(steps: number, rate?: number): Promise<PhysicsStep>;
  setScore(score: ScoreBuffer): Promise<ExperimentView>;
  clearScore(): Promise<ExperimentView>;
  dispose(): void;
}

export function createPhysicsClient(): PhysicsClient {
  let worker: Worker | null = null;
  let nextId = 1;
  const pending = new Map<number, { resolve: (reply: Success) => void; reject: (error: Error) => void }>();

  function ensure(): Worker {
    if (worker) return worker;
    worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
    worker.onmessage = (event: MessageEvent<Reply>) => {
      const reply = event.data;
      const waiter = pending.get(reply.id);
      if (!waiter) return;
      pending.delete(reply.id);
      if (reply.ok) waiter.resolve(reply);
      else waiter.reject(new Error(reply.error));
    };
    worker.onerror = () => {
      for (const waiter of pending.values()) waiter.reject(new Error('The physics worker failed.'));
      pending.clear();
    };
    return worker;
  }

  function request(message: Record<string, unknown>): Promise<Success> {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ensure().postMessage({ ...message, id });
    });
  }

  function stepOf(reply: Success): PhysicsStep {
    return { snapshot: reply.snapshot, experiment: reply.experiment };
  }

  return {
    async load(): Promise<PhysicsLoad> {
      const reply = await request({ type: 'load' });
      if (!reply.info) throw new Error('MuJoCo did not return the Go2 model description.');
      return { info: reply.info, snapshot: reply.snapshot, experiment: reply.experiment };
    },
    async reset(): Promise<PhysicsStep> {
      return stepOf(await request({ type: 'reset' }));
    },
    async step(count: number): Promise<PhysicsSnapshot> {
      return (await request({ type: 'step', count })).snapshot;
    },
    async configure(config: ExperimentConfig): Promise<ExperimentView> {
      return (await request({ type: 'experiment', action: 'configure', config })).experiment;
    },
    async setMode(mode: PhysicsMode): Promise<ExperimentView> {
      return (await request({ type: 'experiment', action: 'mode', mode })).experiment;
    },
    async start(): Promise<PhysicsStep> {
      return stepOf(await request({ type: 'experiment', action: 'start' }));
    },
    async pause(): Promise<PhysicsStep> {
      return stepOf(await request({ type: 'experiment', action: 'pause' }));
    },
    async resume(): Promise<PhysicsStep> {
      return stepOf(await request({ type: 'experiment', action: 'resume' }));
    },
    async stop(): Promise<PhysicsStep> {
      return stepOf(await request({ type: 'experiment', action: 'stop' }));
    },
    async tick(steps: number, rate?: number): Promise<PhysicsStep> {
      return stepOf(await request({ type: 'experiment', action: 'tick', steps, rate }));
    },
    async setScore(score: ScoreBuffer): Promise<ExperimentView> {
      return (await request({ type: 'experiment', action: 'score', score })).experiment;
    },
    async clearScore(): Promise<ExperimentView> {
      return (await request({ type: 'experiment', action: 'score' })).experiment;
    },
    dispose(): void {
      if (!worker) return;
      worker.postMessage({ id: nextId, type: 'dispose' });
      worker.terminate();
      worker = null;
      for (const waiter of pending.values()) waiter.reject(new Error('Physics session disposed.'));
      pending.clear();
    },
  };
}
