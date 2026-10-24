/**
 * Lazy handle for the physics worker.
 *
 * Importing this module does not load the WASM binary. The worker, and
 * therefore `@mujoco/mujoco`, is created on the first `load()`.
 */

import type { PhysicsModelInfo, PhysicsSnapshot } from './types.ts';

interface Success {
  id: number;
  ok: true;
  snapshot: PhysicsSnapshot;
  info?: PhysicsModelInfo;
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
}

export interface PhysicsClient {
  load(): Promise<PhysicsLoad>;
  reset(): Promise<PhysicsSnapshot>;
  step(count: number): Promise<PhysicsSnapshot>;
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

  function request(message: { type: 'load' } | { type: 'reset' } | { type: 'step'; count: number }): Promise<Success> {
    const id = nextId;
    nextId += 1;
    return new Promise((resolve, reject) => {
      pending.set(id, { resolve, reject });
      ensure().postMessage({ ...message, id });
    });
  }

  return {
    async load(): Promise<PhysicsLoad> {
      const reply = await request({ type: 'load' });
      if (!reply.info) throw new Error('MuJoCo did not return the Go2 model description.');
      return { info: reply.info, snapshot: reply.snapshot };
    },
    async reset(): Promise<PhysicsSnapshot> {
      return (await request({ type: 'reset' })).snapshot;
    },
    async step(count: number): Promise<PhysicsSnapshot> {
      return (await request({ type: 'step', count })).snapshot;
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
