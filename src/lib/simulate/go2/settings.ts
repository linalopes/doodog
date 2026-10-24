/**
 * Shared placement and inspection state for the kinematic preview.
 * One store: Create does not keep a second copy, and the Robot workspace
 * does not read it.
 */

import { writable } from 'svelte/store';
import type { Go2JointState } from '../adapters/types.ts';
import { defaultSimConfig, type BrushMount, type SimConfig } from './defaults.ts';
import { referenceAngles } from './kinematics.ts';
import type { PaperConfig } from './mapping.ts';
import type { LegId } from './model.ts';
import type { PoseSnapshot } from './pose.ts';

function referenceJoints(): Go2JointState {
  const angles = referenceAngles();
  const copy = (): [number, number, number] => [angles[0], angles[1], angles[2]];
  return { FL: copy(), FR: copy(), RL: copy(), RR: copy() };
}

export const simSettings = writable<SimConfig>(defaultSimConfig());

export interface InspectionState {
  followTimeline: boolean;
  joints: Go2JointState;
}

export const inspection = writable<InspectionState>({
  followTimeline: true,
  joints: referenceJoints(),
});

/** Last pose the adapter produced. The viewport writes it; the panel reads it. */
export const kinematicPose = writable<PoseSnapshot | null>(null);

export function patchPaper(patch: Partial<PaperConfig>): void {
  simSettings.update((config) => ({ ...config, paper: { ...config.paper, ...patch } }));
}

export function patchMapping(patch: Partial<SimConfig['mapping']>): void {
  simSettings.update((config) => ({ ...config, mapping: { ...config.mapping, ...patch } }));
}

export function patchBrush(side: 'left' | 'right', patch: Partial<BrushMount>): void {
  simSettings.update((config) => ({
    ...config,
    brushes: {
      ...config.brushes,
      [side]: { ...config.brushes[side], ...patch },
    },
  }));
}

export function patchBrushOffset(side: 'left' | 'right', axis: 0 | 1 | 2, value: number): void {
  simSettings.update((config) => {
    const current = config.brushes[side].offset;
    const offset: [number, number, number] = [current[0], current[1], current[2]];
    offset[axis] = value;
    return {
      ...config,
      brushes: {
        ...config.brushes,
        [side]: { ...config.brushes[side], offset },
      },
    };
  });
}

export function setHelper(key: 'showGrid' | 'showFrames', value: boolean): void {
  simSettings.update((config) => ({ ...config, [key]: value }));
}

export function followTimeline(): void {
  inspection.update((state) => ({ ...state, followTimeline: true }));
}

export function setManualJoint(
  leg: LegId,
  index: 0 | 1 | 2,
  radians: number,
  seed: Go2JointState | null,
): void {
  inspection.update((state) => {
    const source = state.followTimeline && seed ? seed : state.joints;
    const joints: Go2JointState = {
      FL: [source.FL[0], source.FL[1], source.FL[2]],
      FR: [source.FR[0], source.FR[1], source.FR[2]],
      RL: [source.RL[0], source.RL[1], source.RL[2]],
      RR: [source.RR[0], source.RR[1], source.RR[2]],
    };
    const next = joints[leg];
    next[index] = radians;
    return { followTimeline: false, joints };
  });
}
