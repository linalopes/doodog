/**
 * How the Create canvas draws the reachability map.
 *
 * These are display choices. Paper, mapping, brush mounts, and lift stay on
 * the simulation config. The map is not written into a sketch.
 */

import { writable } from 'svelte/store';
import type { ReachHeight } from './reachability';

export interface ReachOverlayState {
  visible: boolean;
  /** 0–1, applied when the map is painted. */
  opacity: number;
  height: ReachHeight;
  /** Columns of the sampling grid. Rows follow the canvas aspect. */
  columns: number;
}

export const REACH_COLUMN_CHOICES = [12, 16, 24, 32] as const;

const INITIAL: ReachOverlayState = {
  visible: true,
  opacity: 0.4,
  height: 'down',
  columns: 16,
};

const store = writable<ReachOverlayState>(INITIAL);
export const reachOverlay = { subscribe: store.subscribe };

export function patchReachOverlay(patch: Partial<ReachOverlayState>): void {
  store.update((current) => {
    const opacity = patch.opacity ?? current.opacity;
    const columns = patch.columns ?? current.columns;
    return {
      ...current,
      ...patch,
      opacity: Math.min(0.85, Math.max(0.1, opacity)),
      columns: Math.min(48, Math.max(8, Math.round(columns))),
    };
  });
}
