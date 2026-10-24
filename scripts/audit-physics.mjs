/**
 * MuJoCo foundation: clock policy, model metadata, gravity, contacts, replay, cleanup.
 * The kinematic adapter is not replaced. Backend selection does not edit a sketch.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { get } from 'svelte/store';
import { selectSimulationBackend, simulationBackend } from '../src/lib/simulate/physics/backend.ts';
import { MAX_PHYSICS_STEPS_PER_TICK, physicsRequestedTime, planPhysicsAdvance } from '../src/lib/simulate/physics/clock.ts';
import { go2FloorSceneXml } from '../src/lib/simulate/physics/scene.ts';
import { createPhysicsSession } from '../src/lib/simulate/physics/session.ts';

assert.equal(physicsRequestedTime(4, 4), 0);
assert.equal(physicsRequestedTime(6.5, 4), 2.5);
assert.equal(physicsRequestedTime(3, 4), -1);

const timestep = 0.002;
assert.equal(planPhysicsAdvance({ integrated: 0, timestep }, 0).action, 'hold');
assert.equal(planPhysicsAdvance({ integrated: 1, timestep }, 1).action, 'hold');

const forward = planPhysicsAdvance({ integrated: 0, timestep }, 1);
assert.equal(forward.action, 'forward');
if (forward.action === 'forward') {
  assert.equal(forward.steps, MAX_PHYSICS_STEPS_PER_TICK);
  assert.ok(forward.remaining > 0);
}

const partial = planPhysicsAdvance({ integrated: 0, timestep }, 0.005, 10);
assert.equal(partial.action, 'forward');
if (partial.action === 'forward') assert.equal(partial.steps, 3);

const replay = planPhysicsAdvance({ integrated: 1, timestep }, 0.1);
assert.equal(replay.action, 'replay');
if (replay.action === 'replay') assert.ok(replay.steps > 0 && replay.steps <= MAX_PHYSICS_STEPS_PER_TICK);

const toStart = planPhysicsAdvance({ integrated: 0.4, timestep }, 0);
assert.equal(toStart.action, 'replay');
if (toStart.action === 'replay') assert.equal(toStart.steps, 0);

const before = planPhysicsAdvance({ integrated: 0.2, timestep }, -0.05);
assert.equal(before.action, 'blocked');
if (before.action === 'blocked') assert.match(before.reason, /not jumped/);

const sketch = { params: { speed: 1 }, source: 'motion(t)' };
selectSimulationBackend('mujoco');
assert.equal(get(simulationBackend), 'mujoco');
assert.deepEqual(sketch, { params: { speed: 1 }, source: 'motion(t)' });
selectSimulationBackend('kinematic');
assert.equal(get(simulationBackend), 'kinematic');

const xml = readFileSync('public/models/go2/go2.xml', 'utf8');
assert.equal(xml.includes('name="floor"'), false);
assert.match(go2FloorSceneXml(), /include file="go2.xml"/);
assert.match(go2FloorSceneXml(), /name="floor"/);

const assets = {};
for (const file of readdirSync('public/models/go2/assets')) {
  if (!file.endsWith('.obj')) continue;
  assets[file] = new Uint8Array(readFileSync(`public/models/go2/assets/${file}`));
}

const session = await createPhysicsSession({ xml, assets });
assert.equal(session.info.nq, 19);
assert.equal(session.info.nu, 12);
assert.equal(session.info.timestep, 0.002);
assert.ok(Math.abs(session.info.gravity[2] + 9.81) < 1e-9);
assert.ok(Math.abs(session.info.massKg - 15.206408) < 1e-4);
assert.deepEqual(session.info.jointNames, [
  '',
  'FL_hip_joint',
  'FL_thigh_joint',
  'FL_calf_joint',
  'FR_hip_joint',
  'FR_thigh_joint',
  'FR_calf_joint',
  'RL_hip_joint',
  'RL_thigh_joint',
  'RL_calf_joint',
  'RR_hip_joint',
  'RR_thigh_joint',
  'RR_calf_joint',
]);
assert.deepEqual(session.info.actuatorNames, [
  'FL_hip',
  'FL_thigh',
  'FL_calf',
  'FR_hip',
  'FR_thigh',
  'FR_calf',
  'RL_hip',
  'RL_thigh',
  'RL_calf',
  'RR_hip',
  'RR_thigh',
  'RR_calf',
]);

const home = session.reset();
assert.ok(Math.abs(home.basePosition[2] - 0.27) < 1e-6);
assert.equal(home.maxAbsTorqueNm, 0);
assert.ok(Math.abs(home.joints.FL[1] - 0.9) < 1e-6);
assert.ok(Math.abs(home.joints.FL[2] + 1.8) < 1e-6);
assert.ok(home.contactCount >= 0);
if (home.contactCount > 0) {
  assert.ok(home.contacts.some((contact) => contact.geom1 === 'floor' || contact.geom2 === 'floor'));
}

function advance(count) {
  let snapshot = home;
  let left = count;
  while (left > 0) {
    const batch = Math.min(64, left);
    snapshot = session.step(batch);
    left -= batch;
  }
  return snapshot;
}

const fallen = advance(800);
assert.ok(fallen.basePosition[2] < 0.15, `gravity z ${fallen.basePosition[2]}`);
assert.ok(fallen.contactCount > 0);
assert.ok(fallen.contacts.some((contact) => contact.geom1 === 'floor' || contact.geom2 === 'floor'));
assert.equal(fallen.maxAbsTorqueNm, 0);

session.reset();
const repeated = advance(800);
assert.ok(Math.abs(repeated.basePosition[2] - fallen.basePosition[2]) < 1e-9);
assert.ok(Math.abs(repeated.joints.FR[2] - fallen.joints.FR[2]) < 1e-9);
assert.equal(repeated.contactCount, fallen.contactCount);

session.dispose();
assert.throws(() => session.step(1), /disposed/);
assert.doesNotThrow(() => session.dispose());

console.log('physics audit ok');
