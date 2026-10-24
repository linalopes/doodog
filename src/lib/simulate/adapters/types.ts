import type { MotionFrame, MotionProgramInfo } from '../../motion/types';

/**
 * Simulation adapter boundary (interfaces only in Phase 01).
 *
 * The Simulate workspace will talk to the robot model through this interface
 * so the Three.js kinematic preview (Phase 02) and a MuJoCo WebAssembly
 * physics adapter (later) are interchangeable. Both receive the same
 * MotionFrame stream from the shared timeline; neither reads sketch source.
 *
 * Nothing in this file is instantiated yet. There is no fake motion.
 */

export type SimulationBackend = 'three-kinematic' | 'mujoco-wasm';

export interface SimulationCapabilities {
  backend: SimulationBackend;
  /** True when the adapter integrates contact / gravity rather than posing joints. */
  physics: boolean;
  /** True when the adapter can report whether a brush target is reachable. */
  reachability: boolean;
}

/** Joint angles for the Unitree Go2: 4 legs × (hip abduction, hip flexion, knee). */
export interface Go2JointState {
  FL: [number, number, number];
  FR: [number, number, number];
  RL: [number, number, number];
  RR: [number, number, number];
}

export interface SimulationAdapter {
  readonly capabilities: SimulationCapabilities;
  /** Prepare resources (scene, WASM module) for a program with the given info. */
  load(program: MotionProgramInfo): Promise<void>;
  /** Pose or step the robot toward a frame. Pure w.r.t. the timeline: same frame, same pose. */
  applyFrame(frame: MotionFrame): void;
  /** Current joint state, if the adapter solves for it. */
  readJoints(): Go2JointState | null;
  dispose(): void;
}
