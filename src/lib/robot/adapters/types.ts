import type { MotionFrame } from '../../motion/types';
import type { Go2JointState } from '../../simulate/adapters/types';

/**
 * Physical robot controller boundary (interfaces only in Phase 01).
 *
 * A future Unitree Go2 adapter will implement this. The application talks to
 * the robot only through these semantic operations; it never constructs SDK
 * packets elsewhere. Nothing in this file is instantiated in Phase 01 and no
 * transport exists: the Robot workspace cannot connect or move anything.
 */

export type RobotConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error';

export interface RobotController {
  readonly name: string;
  readonly state: RobotConnectionState;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Stream one frame. Implementations must refuse while not connected. */
  sendFrame(frame: MotionFrame): Promise<void>;
  /** Read back joints for comparison with the simulation. */
  readJoints(): Promise<Go2JointState | null>;
  /** Immediate stop. Must never be a silent no-op. */
  emergencyStop(): Promise<void>;
}
