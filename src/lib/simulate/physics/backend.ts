/**
 * Which Simulate view is driving the Go2 mesh.
 *
 * Changing this does not write creative parameters, sketch source, or the
 * host timeline. MuJoCo stays unloaded until the artist initializes it.
 */

import { writable } from 'svelte/store';

export type SimulationBackendChoice = 'kinematic' | 'mujoco';

export const simulationBackend = writable<SimulationBackendChoice>('kinematic');

export function selectSimulationBackend(choice: SimulationBackendChoice): void {
  simulationBackend.set(choice);
}
