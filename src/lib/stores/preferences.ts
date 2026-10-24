import { get, writable } from 'svelte/store';
import { STORAGE_KEYS, readStoredRaw, writeStored } from '../utils/storage';
import { isRecord } from '../utils/misc';

/**
 * Durable interface preferences. Only inert display choices belong here;
 * nothing about a robot connection or a running sketch is ever restored.
 */
export interface Preferences {
  /** Editor share of the Create split (0.35–0.75). */
  createEditorRatio: number;
}

const DEFAULTS: Preferences = {
  createEditorRatio: 0.55,
};

function sanitize(value: unknown): Preferences {
  if (!isRecord(value)) return { ...DEFAULTS };
  const ratio =
    typeof value.createEditorRatio === 'number' && Number.isFinite(value.createEditorRatio)
      ? Math.min(0.75, Math.max(0.35, value.createEditorRatio))
      : DEFAULTS.createEditorRatio;
  return { createEditorRatio: ratio };
}

const store = writable<Preferences>(sanitize(readStoredRaw(STORAGE_KEYS.preferences)));

export const preferences = { subscribe: store.subscribe };

export function updatePreferences(patch: Partial<Preferences>): void {
  const next = sanitize({ ...get(store), ...patch });
  store.set(next);
  writeStored(STORAGE_KEYS.preferences, next);
}
