/**
 * Loads and steps MuJoCo off the Svelte thread.
 *
 * The single-threaded WASM build does not need cross-origin isolation.
 * The page creates this worker only after the artist asks to initialize physics.
 */

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

interface DisposeMessage {
  id: number;
  type: 'dispose';
}

type Request = LoadMessage | ResetMessage | StepMessage | DisposeMessage;

type Reply =
  | { id: number; ok: true; snapshot: PhysicsSnapshot; info?: PhysicsModelInfo }
  | { id: number; ok: false; error: string };

let session: PhysicsSession | null = null;

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
    return { id: message.id, ok: true, snapshot: session.reset(), info: session.info };
  }
  if (!session) return { id: message.id, ok: false, error: 'Physics is not loaded.' };
  if (message.type === 'reset') return { id: message.id, ok: true, snapshot: session.reset() };
  return { id: message.id, ok: true, snapshot: session.step(message.count) };
}
