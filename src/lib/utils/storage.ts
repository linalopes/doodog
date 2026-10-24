import { APP_CONFIG } from '../config';

/**
 * LocalStorage helpers.
 *
 * Every read is validated by the caller, because stored data may come from an
 * older application version, a hand-edited value, or a corrupted profile.
 * A failed read always degrades to the supplied fallback instead of throwing.
 */

function namespaced(key: string): string {
  return `${APP_CONFIG.storagePrefix}:${key}`;
}

/** LocalStorage is unavailable in private modes and sandboxed frames. */
function available(): boolean {
  try {
    const probe = namespaced('__probe__');
    window.localStorage.setItem(probe, '1');
    window.localStorage.removeItem(probe);
    return true;
  } catch {
    return false;
  }
}

const STORAGE_AVAILABLE = typeof window !== 'undefined' && available();

export function readStored<T>(
  key: string,
  validate: (value: unknown) => value is T,
  fallback: T,
): T {
  if (!STORAGE_AVAILABLE) return fallback;
  try {
    const raw = window.localStorage.getItem(namespaced(key));
    if (raw === null) return fallback;
    const parsed: unknown = JSON.parse(raw);
    return validate(parsed) ? parsed : fallback;
  } catch {
    return fallback;
  }
}

/** Reads without validating, for consumers that sanitise the whole structure. */
export function readStoredRaw(key: string): unknown {
  if (!STORAGE_AVAILABLE) return null;
  try {
    const raw = window.localStorage.getItem(namespaced(key));
    return raw === null ? null : (JSON.parse(raw) as unknown);
  } catch {
    return null;
  }
}

export function writeStored(key: string, value: unknown): void {
  if (!STORAGE_AVAILABLE) return;
  try {
    window.localStorage.setItem(namespaced(key), JSON.stringify(value));
  } catch {
    // Quota exceeded or storage disabled mid-session. Persistence is a
    // convenience here, never a correctness requirement.
  }
}

export const STORAGE_KEYS = {
  activeTab: 'active-tab',
  preferences: 'preferences',
  sketches: 'sketches',
  activeSketchId: 'active-sketch-id',
  sketchesBootstrapped: 'sketches-bootstrapped',
} as const;
