import { get, writable } from 'svelte/store';
import type { ParamControl, ParamPatch, ParamValue } from './types';

/**
 * Creative parameters for the running sketch.
 *
 * Create and Simulate both read this store. It is not the paper, the brush
 * mount, or the robot pose. Source edits do not write it; Run does, when the
 * iframe reports the new `params` object.
 */

export interface CreativeParamState {
  runId: string | null;
  controls: ParamControl[];
  values: ParamPatch;
}

const INITIAL: CreativeParamState = { runId: null, controls: [], values: {} };

const store = writable<CreativeParamState>(INITIAL);
export const creativeParams = { subscribe: store.subscribe };

type FlushListener = (values: ParamPatch, revision: number) => void;

const listeners = new Set<FlushListener>();
let timer = 0;
let waitStarted = 0;
let revision = 0;

const DEBOUNCE_MS = 120;
const MAX_WAIT_MS = 280;

function controlMatches(control: ParamControl, value: ParamValue): boolean {
  if (control.kind === 'boolean') return typeof value === 'boolean';
  if (control.kind === 'number') {
    return (
      typeof value === 'number' &&
      Number.isFinite(value) &&
      (control.min === undefined || value >= control.min - 1e-9) &&
      (control.max === undefined || value <= control.max + 1e-9)
    );
  }
  if (control.kind === 'enum') return typeof value === 'string' && (control.options ?? []).includes(value);
  return typeof value === 'string' && value.length <= 80;
}

export function publishParamSchema(runId: string, controls: ParamControl[]): void {
  const values: ParamPatch = {};
  for (const control of controls) values[control.key] = control.value;
  store.set({ runId, controls, values });
}

export function clearCreativeParams(): void {
  window.clearTimeout(timer);
  timer = 0;
  waitStarted = 0;
  revision += 1;
  store.set(INITIAL);
}

/** True when the value was stored. Invalid values are ignored. */
export function editCreativeParam(key: string, value: ParamValue): boolean {
  const current = get(store);
  const control = current.controls.find((entry) => entry.key === key);
  if (!control || current.runId === null || !controlMatches(control, value)) return false;
  if (Object.is(current.values[key], value)) return true;
  store.set({
    ...current,
    values: { ...current.values, [key]: value },
  });
  scheduleFlush();
  return true;
}

/** Send the latest values now. Used when a slider is released. */
export function flushCreativeParams(): void {
  window.clearTimeout(timer);
  timer = 0;
  waitStarted = 0;
  emit();
}

export function subscribeParamFlush(listener: FlushListener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** Replace displayed values with what the sketch actually kept, if this send is still current. */
export function applyParamResult(runId: string, sentRevision: number, values: ParamPatch): void {
  if (sentRevision !== revision) return;
  const current = get(store);
  if (current.runId !== runId) return;
  const next: ParamPatch = {};
  for (const control of current.controls) {
    const reported = values[control.key];
    next[control.key] =
      reported !== undefined && controlMatches(control, reported)
        ? reported
        : (current.values[control.key] ?? control.value);
  }
  store.set({ ...current, values: next });
}

function scheduleFlush(): void {
  const now = Date.now();
  if (!waitStarted) waitStarted = now;
  window.clearTimeout(timer);
  const due = now - waitStarted >= MAX_WAIT_MS ? 0 : DEBOUNCE_MS;
  timer = window.setTimeout(() => {
    timer = 0;
    waitStarted = 0;
    emit();
  }, due);
}

function emit(): void {
  if (listeners.size === 0) return;
  const current = get(store);
  if (!current.runId) return;
  revision += 1;
  const snapshot = { ...current.values };
  for (const listener of listeners) listener(snapshot, revision);
}
