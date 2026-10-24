import type { MotionFrame, MotionProgramInfo } from '../../motion/types';

/**
 * Simulation adapter boundary (interfaces only).
 *
 * Phase 02A publishes one validated MotionFrame at a time on
 * `src/lib/motion/output.ts`. Phase 02B's first adapter should subscribe to
 * that store and call `applyFrame` with `frame`. Do not sample `motion(t)`
 * again, do not start a second clock, and do not convert canvas units into
 * joint angles before `applyFrame`. The kinematic adapter is the only
 * implementation of this interface. MuJoCo is a separate stateful session:
 * it is not a function from one MotionFrame to one pose, and it does not
 * replace `applyFrame`. Neither path reads sketch source.
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
