/**
 * How a stateful physics run follows the host timeline.
 *
 * The host clock is the time the artist asked for. MuJoCo time advances only
 * by whole fixed steps. A later host time is caught up with a bounded number
 * of steps. An earlier host time, still inside this run, resets the model and
 * replays from the reference posture. A host time before the run started is
 * refused: the pose is not jumped.
 */

export const MAX_PHYSICS_STEPS_PER_TICK = 16;

export interface PhysicsClockState {
  integrated: number;
  timestep: number;
}

export type PhysicsPlan =
  | { action: 'hold' }
  | { action: 'blocked'; reason: string }
  | { action: 'forward'; steps: number; remaining: number }
  | { action: 'replay'; steps: number; remaining: number };

/** Seconds of physics requested since the run was anchored to the host clock. */
export function physicsRequestedTime(hostSeconds: number, epochSeconds: number): number {
  return hostSeconds - epochSeconds;
}

export function planPhysicsAdvance(
  state: PhysicsClockState,
  requestedSeconds: number,
  maxSteps = MAX_PHYSICS_STEPS_PER_TICK,
): PhysicsPlan {
  const budget = Math.max(0, Math.floor(maxSteps));
  if (!(state.timestep > 0) || !Number.isFinite(state.timestep) || !Number.isFinite(requestedSeconds)) {
    return { action: 'blocked', reason: 'Physics has no fixed timestep yet.' };
  }
  const tolerance = state.timestep * 0.25;
  if (requestedSeconds < -tolerance) {
    return {
      action: 'blocked',
      reason:
        'This seek is before the physics run. Reset physics to start again from the reference posture. The simulation was not jumped.',
    };
  }
  const target = Math.max(0, requestedSeconds);
  if (target + tolerance < state.integrated) {
    const needed = stepsBetween(0, target, state.timestep);
    const steps = Math.min(budget, needed);
    return { action: 'replay', steps, remaining: needed - steps };
  }
  if (target <= state.integrated + tolerance) return { action: 'hold' };
  const needed = stepsBetween(state.integrated, target, state.timestep);
  const steps = Math.min(budget, needed);
  return { action: 'forward', steps, remaining: needed - steps };
}

function stepsBetween(from: number, to: number, timestep: number): number {
  const span = to - from;
  if (!(span > 0)) return 0;
  return Math.max(0, Math.ceil(span / timestep - 1e-9));
}
