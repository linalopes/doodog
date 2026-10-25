/**
 * Loads and steps MuJoCo off the Svelte thread.
 *
 * The single-threaded WASM build does not need cross-origin isolation.
 * The page creates this worker only after the artist asks to initialize physics.
 * Stance torques are computed here, in the same step as the integrator.
 */

import {
  advanceExperiment,
  begin,
  changeMode,
  configureMemory,
  createMemory,
  pause,
  resume,
  stop,
  viewOf,
  type ExperimentMemory,
  type ExperimentView,
  type PhysicsMode,
} from './experiment.ts';
import type { ExperimentConfig } from './settings.ts';
import { createPhysicsSession, type PhysicsSession } from './session.ts';
import { PHYSICS_ASSET_FILES } from './scene.ts';
import type { PhysicsModelInfo, PhysicsSnapshot } from './types.ts';

interface LoadMessage {
  id: number;
  type: 'load';
}

interface ResetMessage {
  id: number;
  type: 'reset';
}

interface StepMessage {
  id: number;
  type: 'step';
  count: number;
}

interface ExperimentMessage {
  id: number;
  type: 'experiment';
  action: 'configure' | 'mode' | 'start' | 'pause' | 'resume' | 'stop' | 'tick';
  config?: ExperimentConfig;
  mode?: PhysicsMode;
  steps?: number;
}

interface DisposeMessage {
  id: number;
  type: 'dispose';
}

type Request = LoadMessage | ResetMessage | StepMessage | ExperimentMessage | DisposeMessage;

type Reply =
  | { id: number; ok: true; snapshot: PhysicsSnapshot; info?: PhysicsModelInfo; experiment: ExperimentView }
  | { id: number; ok: false; error: string };

let session: PhysicsSession | null = null;
let memory: ExperimentMemory = createMemory();

onmessage = (event: MessageEvent<Request>) => {
  const message = event.data;
  void handle(message).then(
    (reply) => postMessage(reply),
    (error: unknown) => {
      const text = error instanceof Error ? error.message : 'MuJoCo failed.';
      const reply: Reply = { id: message.id, ok: false, error: text };
      postMessage(reply);
    },
  );
};

async function handle(message: Request): Promise<Reply> {
  if (message.type === 'dispose') {
    session?.dispose();
    session = null;
    memory = createMemory();
    return { id: message.id, ok: false, error: 'Physics session disposed.' };
  }
  if (message.type === 'load') {
    session?.dispose();
    const xmlResponse = await fetch('/models/go2/go2.xml');
    if (!xmlResponse.ok) throw new Error('The Go2 MJCF could not be fetched.');
    const xml = await xmlResponse.text();
    const assets: Record<string, Uint8Array> = {};
    await Promise.all(
      PHYSICS_ASSET_FILES.map(async (file) => {
        const response = await fetch(`/models/go2/assets/${file}`);
        if (!response.ok) throw new Error(`The Go2 mesh ${file} could not be fetched.`);
        assets[file] = new Uint8Array(await response.arrayBuffer());
      }),
    );
    session = await createPhysicsSession({ xml, assets });
    memory = createMemory();
    return reply(message.id, session.reset(), session.info);
  }
  if (!session) return { id: message.id, ok: false, error: 'Physics is not loaded.' };
  if (message.type === 'reset') {
    const mode = memory.mode;
    const config = memory.config;
    const snapshot = session.reset();
    memory = createMemory(config);
    memory.mode = mode;
    return reply(message.id, snapshot);
  }
  if (message.type === 'step') {
    if (memory.mode === 'motors-off') session.setTorques(zeros());
    return reply(message.id, session.step(message.count));
  }
  return reply(message.id, applyExperiment(session, message));
}

function applyExperiment(plant: PhysicsSession, message: ExperimentMessage): PhysicsSnapshot {
  if (message.action === 'configure' && message.config) {
    memory = configureMemory(memory, message.config);
    return plant.sample();
  }
  if (message.action === 'mode' && message.mode) {
    memory = changeMode(memory, message.mode);
    plant.setTorques(zeros());
    return plant.sample();
  }
  if (message.action === 'start') {
    memory = begin(memory, plant.sample());
    return plant.sample();
  }
  if (message.action === 'pause') {
    memory = pause(memory);
    return plant.sample();
  }
  if (message.action === 'resume') {
    memory = resume(memory);
    return plant.sample();
  }
  if (message.action === 'stop') {
    memory = stop(memory);
    plant.setTorques(zeros());
    return plant.sample();
  }
  const advanced = advanceExperiment(plant, memory, message.steps ?? 1);
  memory = advanced.memory;
  return advanced.snapshot;
}

function reply(id: number, snapshot: PhysicsSnapshot, info?: PhysicsModelInfo): Reply {
  return { id, ok: true, snapshot, info, experiment: viewOf(memory) };
}

function zeros(): number[] {
  return [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0];
}
