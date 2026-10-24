import { derived, get, writable } from 'svelte/store';
import { createId, isRecord, toTrimmedString } from '../utils/misc';
import { STORAGE_KEYS, readStored, readStoredRaw, writeStored } from '../utils/storage';
import { BLANK_SKETCH_SOURCE } from './blank';
import { SKETCH_EXAMPLES, getExampleById } from './examples';
import { SKETCH_STORAGE_VERSION, type Sketch, type SketchOrigin } from './types';

/**
 * Sketch library for the Create workspace.
 *
 * Built-in examples are never stored here. Only explicit New sketch /
 * Use example / Duplicate create user documents. Selecting a sketch never
 * runs it. Everything is local to this browser (continuity, not an archive).
 */

const MAX_NAME = 64;
const MAX_SOURCE = 200_000;

function isOrigin(value: unknown): value is SketchOrigin {
  return value === 'blank' || value === 'example';
}

function sanitizeSketch(input: unknown): Sketch | null {
  if (!isRecord(input)) return null;
  const name = toTrimmedString(input.name).slice(0, MAX_NAME);
  const source = typeof input.source === 'string' ? input.source.slice(0, MAX_SOURCE) : '';
  if (name.length === 0 || source.length === 0) return null;

  const id =
    typeof input.id === 'string' && input.id.length > 0
      ? input.id.slice(0, 64)
      : createId('sketch');
  const now = Date.now();
  const createdAt =
    typeof input.createdAt === 'number' && Number.isFinite(input.createdAt)
      ? input.createdAt
      : now;
  const updatedAt =
    typeof input.updatedAt === 'number' && Number.isFinite(input.updatedAt)
      ? input.updatedAt
      : createdAt;
  const exampleId = typeof input.exampleId === 'string' ? input.exampleId : null;
  const origin = isOrigin(input.origin) ? input.origin : exampleId ? 'example' : 'blank';

  return { id, name, source, exampleId, origin, createdAt, updatedAt };
}

function loadSketches(): Sketch[] {
  const raw = readStoredRaw(STORAGE_KEYS.sketches);
  if (!isRecord(raw) || !Array.isArray(raw.sketches)) return [];
  return raw.sketches
    .map((entry) => sanitizeSketch(entry))
    .filter((entry): entry is Sketch => entry !== null);
}

function loadActiveId(list: Sketch[]): string | null {
  const stored = readStored<string | null>(
    STORAGE_KEYS.activeSketchId,
    (v): v is string | null => typeof v === 'string' || v === null,
    null,
  );
  if (stored && list.some((sketch) => sketch.id === stored)) return stored;
  return list[0]?.id ?? null;
}

function wasBootstrapped(): boolean {
  return readStored(
    STORAGE_KEYS.sketchesBootstrapped,
    (v): v is boolean => typeof v === 'boolean',
    false,
  );
}

function uniqueName(base: string, list: Sketch[]): string {
  const taken = new Set(list.map((sketch) => sketch.name));
  if (!taken.has(base)) return base;
  let n = 2;
  while (taken.has(`${base} ${n}`)) n += 1;
  return `${base} ${n}`;
}

/** Prefer "Name", then "Name copy", then "Name copy 2". */
function uniqueCopyName(base: string, list: Sketch[]): string {
  const taken = new Set(list.map((sketch) => sketch.name));
  if (!taken.has(base)) return base;
  const copyBase = `${base} copy`;
  if (!taken.has(copyBase)) return copyBase;
  let n = 2;
  while (taken.has(`${copyBase} ${n}`)) n += 1;
  return `${copyBase} ${n}`;
}

let initialSketches = loadSketches();

// First-ever visit: seed the library with an editable copy of the built-in
// example so the editor has something meaningful to show. Later visits with
// an empty list stay empty — deleting everything is a valid state.
if (initialSketches.length === 0 && !wasBootstrapped()) {
  const example = SKETCH_EXAMPLES[0];
  if (example) {
    const now = Date.now();
    initialSketches = [
      {
        id: createId('sketch'),
        name: example.name,
        source: example.source,
        exampleId: example.id,
        origin: 'example',
        createdAt: now,
        updatedAt: now,
      },
    ];
  }
}
writeStored(STORAGE_KEYS.sketchesBootstrapped, true);

const sketchesStore = writable<Sketch[]>(initialSketches);
const activeSketchIdStore = writable<string | null>(loadActiveId(initialSketches));

function persist(list: Sketch[]): void {
  writeStored(STORAGE_KEYS.sketches, { version: SKETCH_STORAGE_VERSION, sketches: list });
}

persist(initialSketches);
writeStored(STORAGE_KEYS.activeSketchId, get(activeSketchIdStore));

function commit(list: Sketch[]): void {
  sketchesStore.set(list);
  persist(list);
}

export const sketches = { subscribe: sketchesStore.subscribe };
export const activeSketchId = { subscribe: activeSketchIdStore.subscribe };

export const activeSketch = derived(
  [sketchesStore, activeSketchIdStore],
  ([$sketches, $id]) => $sketches.find((sketch) => sketch.id === $id) ?? null,
);

export function selectSketch(id: string): void {
  if (!get(sketchesStore).some((sketch) => sketch.id === id)) return;
  activeSketchIdStore.set(id);
  writeStored(STORAGE_KEYS.activeSketchId, id);
}

export function createSketch(name = 'Untitled sketch', source = BLANK_SKETCH_SOURCE): Sketch {
  const list = get(sketchesStore);
  const now = Date.now();
  const sketch: Sketch = {
    id: createId('sketch'),
    name: uniqueName(name, list),
    source: source.slice(0, MAX_SOURCE),
    exampleId: null,
    origin: 'blank',
    createdAt: now,
    updatedAt: now,
  };
  commit([...list, sketch]);
  selectSketch(sketch.id);
  return sketch;
}

/** Explicit Use example action — the only way a template becomes a user sketch. */
export function useExample(exampleId: string): Sketch | null {
  const example = getExampleById(exampleId);
  if (!example) return null;
  const list = get(sketchesStore);
  const now = Date.now();
  const sketch: Sketch = {
    id: createId('sketch'),
    name: uniqueCopyName(example.name, list),
    source: example.source,
    exampleId: example.id,
    origin: 'example',
    createdAt: now,
    updatedAt: now,
  };
  commit([...list, sketch]);
  selectSketch(sketch.id);
  return sketch;
}

export function duplicateSketch(id: string): Sketch | null {
  const list = get(sketchesStore);
  const source = list.find((sketch) => sketch.id === id);
  if (!source) return null;
  const copy: Sketch = {
    ...source,
    id: createId('sketch'),
    name: uniqueCopyName(source.name, list),
    createdAt: Date.now(),
    updatedAt: Date.now(),
  };
  commit([...list, copy]);
  selectSketch(copy.id);
  return copy;
}

/** Deletes a sketch after the UI has confirmed. Empty libraries are valid. */
export function deleteSketch(id: string): boolean {
  const list = get(sketchesStore);
  const remaining = list.filter((sketch) => sketch.id !== id);
  if (remaining.length === list.length) return false;
  commit(remaining);
  if (get(activeSketchIdStore) === id) {
    const next = remaining[0];
    if (next) selectSketch(next.id);
    else {
      activeSketchIdStore.set(null);
      writeStored(STORAGE_KEYS.activeSketchId, null);
    }
  }
  return true;
}

export function renameSketch(id: string, name: string): void {
  updateSketch(id, { name: name.trim() || 'Untitled sketch' });
}

export function updateSketchSource(id: string, source: string): void {
  updateSketch(id, { source });
}

function updateSketch(id: string, patch: Partial<Pick<Sketch, 'name' | 'source'>>): void {
  const list = get(sketchesStore);
  commit(
    list.map((sketch) => {
      if (sketch.id !== id) return sketch;
      return {
        ...sketch,
        ...patch,
        name: (patch.name ?? sketch.name).slice(0, MAX_NAME),
        source: (patch.source ?? sketch.source).slice(0, MAX_SOURCE),
        updatedAt: Date.now(),
      };
    }),
  );
}

/** Restore the immutable built-in source into an example-derived sketch. */
export function restoreOriginalExample(id: string): boolean {
  const sketch = get(sketchesStore).find((entry) => entry.id === id);
  if (!sketch?.exampleId) return false;
  const example = getExampleById(sketch.exampleId);
  if (!example) return false;
  updateSketch(id, { source: example.source });
  return true;
}
