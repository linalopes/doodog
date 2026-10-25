/**
 * Three-leg stance: support geometry, torque limits, and a real MuJoCo run.
 * A finished schedule is not a success unless the measurements say so.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { get } from 'svelte/store';
import { quatFromAxisAngle } from '../src/lib/simulate/go2/math.ts';
import { rollPitch } from '../src/lib/simulate/physics/attitude.ts';
import { selectSimulationBackend, simulationBackend } from '../src/lib/simulate/physics/backend.ts';
import {
  advanceExperiment,
  begin,
  changeMode,
  commandFrom,
  createMemory,
  stop,
} from '../src/lib/simulate/physics/experiment.ts';
import { jointPd } from '../src/lib/simulate/physics/pd.ts';
import { createPhysicsSession } from '../src/lib/simulate/physics/session.ts';
import { assessSupport } from '../src/lib/simulate/physics/support.ts';
import { minimumShift, referenceJoints } from '../src/lib/simulate/physics/targets.ts';

const level = rollPitch(quatFromAxisAngle([1, 0, 0], 0));
assert.ok(Math.abs(level.roll) < 1e-12 && Math.abs(level.pitch) < 1e-12);
const tilted = rollPitch(quatFromAxisAngle([1, 0, 0], 0.2));
assert.ok(Math.abs(tilted.roll - 0.2) < 1e-9);
assert.ok(Math.abs(tilted.pitch) < 1e-9);

const triangle = assessSupport([0.2, 0.2], [[0, 0], [1, 0], [0, 1]]);
assert.equal(triangle.inside, true);
assert.ok((triangle.marginM ?? 0) > 0);
const outside = assessSupport([1, 1], [[0, 0], [1, 0], [0, 1]]);
assert.equal(outside.inside, false);
assert.ok((outside.marginM ?? 0) < 0);
assert.equal(assessSupport([0, 0], [[0, 0], [1, 0]]).marginM, null);

const shift = minimumShift([0, 0], [[0.2, -0.14], [-0.2, 0.14], [-0.2, -0.14]]);
assert.ok(Math.abs(shift[0] + 0.2 / 3) < 1e-9);
assert.ok(Math.abs(shift[1] + 0.14 / 3) < 1e-9);
assert.equal(shift[2], 0);

const rest = referenceJoints();
const still = {
  FL: [0, 0, 0],
  FR: [0, 0, 0],
  RL: [0, 0, 0],
  RR: [0, 0, 0],
};
const wide = Array.from({ length: 12 }, (_, index) => ({
  name: `a${index}`,
  minNm: index % 3 === 2 ? -45.43 : -23.7,
  maxNm: index % 3 === 2 ? 45.43 : 23.7,
}));
const held = jointPd(rest, still, rest, rest, wide, 0.002);
assert.ok(held.torques.every((torque) => torque === 0));
const aggressive = {
  FL: [2, 0.9, -1.8],
  FR: [0, 0.9, -1.8],
  RL: [0, 0.9, -1.8],
  RR: [0, 0.9, -1.8],
};
const saturated = jointPd(rest, still, aggressive, rest, wide, 0.002);
assert.equal(saturated.saturated, true);
assert.equal(saturated.torques[0], 23.7);

const upright = fakeSample(0.27);
const refused = begin({ ...createMemory(), mode: 'three-leg' }, fakeSample(0.1));
assert.equal(refused.outcome, 'failed');
assert.match(refused.reason, /not jumped/);
const running = begin({ ...createMemory(), mode: 'three-leg' }, upright);
const fell = commandFrom(running, fakeSample(0.05), wide, 0.002);
assert.equal(fell.integrate, false);
assert.equal(fell.memory.outcome, 'failed');
assert.match(fell.memory.reason, /fell/);
const holding = begin({ ...createMemory(), mode: 'posture-hold' }, upright);
assert.equal(stop(holding).outcome, 'interrupted');
assert.equal(changeMode(holding, 'motors-off').outcome, 'interrupted');

const sketch = { params: { speed: 1 }, source: 'motion(t)' };
selectSimulationBackend('mujoco');
assert.equal(get(simulationBackend), 'mujoco');
assert.deepEqual(sketch, { params: { speed: 1 }, source: 'motion(t)' });
selectSimulationBackend('kinematic');

const xml = readFileSync('public/models/go2/go2.xml', 'utf8');
const assets = {};
for (const file of readdirSync('public/models/go2/assets')) {
  if (!file.endsWith('.obj')) continue;
  assets[file] = new Uint8Array(readFileSync(`public/models/go2/assets/${file}`));
}
const session = await createPhysicsSession({ xml, assets });
assert.deepEqual(
  session.info.actuatorRanges.map((range) => [range.minNm, range.maxNm]),
  [
    [-23.7, 23.7], [-23.7, 23.7], [-45.43, 45.43],
    [-23.7, 23.7], [-23.7, 23.7], [-45.43, 45.43],
    [-23.7, 23.7], [-23.7, 23.7], [-45.43, 45.43],
    [-23.7, 23.7], [-23.7, 23.7], [-45.43, 45.43],
  ],
);
const home = session.reset();
assert.ok(home.support.com.every((value) => Number.isFinite(value)));
assert.ok(home.feet.FL.onFloor && home.feet.FR.onFloor && home.feet.RL.onFloor && home.feet.RR.onFloor);

let memory = begin({ ...createMemory(), mode: 'posture-hold' }, session.sample());
let result = advanceExperiment(session, memory, 600);
assert.equal(result.memory.postureHolding, true, result.memory.reason);
assert.ok(result.snapshot.basePosition[2] > 0.2);
assert.ok(result.snapshot.maxAbsTorqueNm > 0);
assert.ok(result.snapshot.maxAbsTorqueNm <= 45.43);
assert.equal(result.snapshot.saturated, false);

session.reset();
memory = begin({ ...createMemory(), mode: 'three-leg' }, session.sample());
result = advanceExperiment(session, memory, 100);
const stopped = stop(result.memory);
const frozen = advanceExperiment(session, stopped, 40);
assert.equal(stopped.outcome, 'interrupted');
assert.equal(frozen.snapshot.time, result.snapshot.time);

const reset = session.reset();
assert.ok(Math.abs(reset.basePosition[2] - home.basePosition[2]) < 1e-6);
assert.ok(Math.abs(reset.joints.FL[2] - home.joints.FL[2]) < 1e-6);
assert.equal(reset.maxAbsTorqueNm, 0);

memory = begin({ ...createMemory(), mode: 'three-leg' }, session.sample());
const steps = Math.ceil((1 + 2 + 2 + 2 + 2) / session.info.timestep) + 5;
result = advanceExperiment(session, memory, steps);
assert.equal(result.memory.outcome, 'completed', `${result.memory.reason} ${result.memory.failure}`);
assert.equal(result.memory.criteria.stand, true);
assert.equal(result.memory.criteria.shift, true);
assert.equal(result.memory.criteria.lift, true);
assert.equal(result.memory.criteria.hold, true);
assert.equal(result.memory.criteria.return, true);
assert.equal(result.memory.playback, 'paused');
assert.ok(result.snapshot.basePosition[2] > 0.18);
assert.equal(result.snapshot.feet.FL.onFloor, true);
assert.ok(result.snapshot.maxAbsTorqueNm <= 45.43);

const again = session.reset();
assert.ok(Math.abs(again.basePosition[2] - home.basePosition[2]) < 1e-6);
assert.equal(again.maxAbsTorqueNm, 0);
session.dispose();

console.log('stance audit ok');

function fakeSample(height) {
  const foot = {
    sphere: [0, 0, 0.01],
    clearanceM: -0.012,
    onFloor: true,
    contact: [0, 0, 0],
  };
  const angles = [0, 0.9, -1.8];
  const joints = { FL: [...angles], FR: [...angles], RL: [...angles], RR: [...angles] };
  const still = { FL: [0, 0, 0], FR: [0, 0, 0], RL: [0, 0, 0], RR: [0, 0, 0] };
  return {
    time: 0,
    basePosition: [0, 0, height],
    baseQuaternion: [1, 0, 0, 0],
    rollRad: 0,
    pitchRad: 0,
    joints,
    jointVelocity: still,
    contactCount: 4,
    contacts: [],
    maxAbsTorqueNm: 0,
    effortNm: 0,
    torquesNm: [],
    saturated: false,
    feet: { FL: foot, FR: foot, RL: foot, RR: foot },
    support: {
      feet: ['FL', 'FR', 'RL', 'RR'],
      polygon: [],
      com: [0, 0, height],
      comProjection: [0, 0],
      marginM: 0.02,
      inside: true,
      threeLegFeetDown: true,
      threeLegTriangle: [],
      threeLegMarginM: 0.01,
      threeLegInside: true,
    },
  };
}
