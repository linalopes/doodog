/**
 * Kinematic SimulationAdapter.
 *
 * `applyFrame` receives a canvas-space MotionFrame. Mapping and joint angles
 * happen inside this adapter, not in the sketch and not in the timeline.
 * The Three.js view reads `snapshot()` and does not solve the legs itself.
 *
 * A later MuJoCo adapter implements the same interface and can replace this
 * object. It must not require changes to sketches, MotionFrame, or the clock.
 */

import type { MotionFrame, MotionProgramInfo } from '../../motion/types.ts';
import { defaultSimConfig, type SimConfig } from '../go2/defaults.ts';
import { solvePose, type PoseSnapshot } from '../go2/pose.ts';
import type { Go2JointState, SimulationAdapter, SimulationCapabilities } from './types.ts';

export interface KinematicAdapter extends SimulationAdapter {
  setConfig(config: SimConfig): void;
  setManual(joints: Go2JointState | null): void;
  /** Reference pose when no frame is available yet. */
  showReference(): void;
  snapshot(): PoseSnapshot | null;
}

export function createKinematicAdapter(): KinematicAdapter {
  let config = defaultSimConfig();
  let canvas: { width: number; height: number } | null = null;
  let manual: Go2JointState | null = null;
  let current: PoseSnapshot | null = null;

  const capabilities: SimulationCapabilities = {
    backend: 'three-kinematic',
    physics: false,
    reachability: true,
  };

  return {
    capabilities,
    async load(program: MotionProgramInfo): Promise<void> {
      if (program.canvas.width > 0 && program.canvas.height > 0) canvas = program.canvas;
    },
    setConfig(next: SimConfig): void {
      config = next;
    },
    setManual(joints: Go2JointState | null): void {
      manual = joints;
    },
    applyFrame(frame: MotionFrame): void {
      current = solvePose(frame, canvas, config, manual);
    },
    showReference(): void {
      current = solvePose(null, canvas, config, manual);
    },
    readJoints(): Go2JointState | null {
      return current?.joints ?? null;
    },
    snapshot(): PoseSnapshot | null {
      return current;
    },
    dispose(): void {
      current = null;
      manual = null;
    },
  };
}
