import { writable } from 'svelte/store';
import { readStored, writeStored, STORAGE_KEYS } from '../utils/storage';

/** The three primary workspaces, in navigation order. */
export const PRIMARY_TABS = ['create', 'simulate', 'robot'] as const;

export type PrimaryTab = (typeof PRIMARY_TABS)[number];

export const TAB_LABELS: Record<PrimaryTab, string> = {
  create: 'Create',
  simulate: 'Simulate',
  robot: 'Robot',
};

/** Availability shown next to each tab. Robot stays reserved. */
export const TAB_STATUS: Record<PrimaryTab, 'available' | 'planned'> = {
  create: 'available',
  simulate: 'available',
  robot: 'planned',
};

/** First-time visitors land on Create, the functional workspace. */
const DEFAULT_TAB: PrimaryTab = 'create';

function isPrimaryTab(value: unknown): value is PrimaryTab {
  return (
    typeof value === 'string' && (PRIMARY_TABS as readonly string[]).includes(value)
  );
}

function createNavigationStore() {
  const initial = readStored(STORAGE_KEYS.activeTab, isPrimaryTab, DEFAULT_TAB);
  const { subscribe, set } = writable<PrimaryTab>(initial);

  return {
    subscribe,
    goTo(tab: PrimaryTab) {
      set(tab);
      writeStored(STORAGE_KEYS.activeTab, tab);
    },
  };
}

export const activeTab = createNavigationStore();

/**
 * Section selected inside each workspace's sidebar. Not persisted: sections
 * are cheap to re-enter and the first one is the least surprising default.
 */
export const createSection = writable<'sketches' | 'examples'>('sketches');
export const simulateSection = writable<string>('viewport');
export const robotSection = writable<string>('overview');
