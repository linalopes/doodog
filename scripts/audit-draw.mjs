/**
 * Drawing in the Air: the circle is parametric, closed, and not shrunk.
 * A finished schedule is not a success unless the measurements say so.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { get } from 'svelte/store';
import { analyticalFoot } from '../src/lib/simulate/go2/kinematics.ts';
import { add, quatFromAxisAngle, quatRotate } from '../src/lib/simulate/go2/math.ts';
import { selectSimulationBackend, simulationBackend } from '../src/lib/simulate/physics/backend.ts';
import { circlePoint, circleSamples, rmsError, smootherstep, trackingError } from '../src/lib/simulate/physics/circle.ts';
import {
  advanceExperiment,
  begin,
  changeMode,
  configureMemory,
  createMemory,
  pause,
  resume,
  stop,
} from '../src/lib/simulate/physics/experiment.ts';
import { createPhysicsSession } from '../src/lib/simulate/physics/session.ts';
import { DEFAULT_EXPERIMENT, DRAW_MAX_ERROR_M } from '../src/lib/simulate/physics/settings.ts';
import { worldPointToBody } from '../src/lib/simulate/physics/targets.ts';

const anchor = [0.2, 0.14, 0.04];
const path = { anchor, radiusM: 0.01, direction: 'ccw' };
const start = circlePoint(path, 0);
const end = circlePoint(path, 1);
assert.ok(Math.abs(start[0] - anchor[0]) < 1e-12);
assert.ok(Math.abs(start[1] - anchor[1]) < 1e-12);
assert.ok(Math.abs(start[2] - anchor[2]) < 1e-12);
assert.ok(Math.abs(end[0] - anchor[0]) < 1e-12 && Math.abs(end[1] - anchor[1]) < 1e-12);
const far = circlePoint(path, 0.5);
assert.ok(Math.abs(far[0] - (anchor[0] - 0.02)) < 1e-12, 'the far point stays two radii away');
assert.ok(Math.abs(far[1] - anchor[1]) < 1e-12);
assert.equal(far[2], anchor[2]);
const clockwise = circlePoint({ ...path, direction: 'cw' }, 0.25);
const counter = circlePoint(path, 0.25);
assert.ok(Math.abs(clockwise[1] + counter[1] - 2 * anchor[1]) < 1e-9);
assert.equal(clockwise[2], anchor[2]);

const duration = 4;
const smoothStart = horizontalSpeed(path, 0, duration);
const smoothEnd = horizontalSpeed(path, 1 - 1e-4, duration);
const smoothMid = horizontalSpeed(path, 0.5, duration);
assert.ok(smoothStart < 1e-4, `smooth start speed ${smoothStart}`);
assert.ok(smoothEnd < 1e-3, `smooth end speed ${smoothEnd}`);
assert.ok(smoothMid > 0.01);
const linearSpeed = (0.01 * Math.PI * 2) / duration;
assert.ok(linearSpeed > 0.015);
assert.ok(smoothStart < linearSpeed / 10);
assert.equal(smootherstep(0), 0);
assert.equal(smootherstep(1), 1);
assert.ok(Math.abs(smootherstep(0.5) - 0.5) < 1e-12);

const samples = circleSamples(path);
assert.equal(samples.length, 65);
assert.equal(samples[0][0], start[0]);
assert.equal(samples[64][0], end[0]);
assert.ok(Math.abs(trackingError(start, end)) < 1e-12);
assert.ok(Math.abs((rmsError(0.003 * 0.003 + 0.004 * 0.004, 2) ?? 0) - Math.hypot(0.003, 0.004) / Math.SQRT2) < 1e-12);
assert.equal(rmsError(0, 0), null);

const body = [1, 2, 0.3];
const yaw = quatFromAxisAngle([0, 0, 1], Math.PI / 2);
const local = [0.1, -0.2, 0.05];
const world = add(body, quatRotate(yaw, local));
const back = worldPointToBody(body, yaw, world);
assert.ok(Math.abs(back[0] - local[0]) < 1e-12);
assert.ok(Math.abs(back[1] - local[1]) < 1e-12);
assert.ok(Math.abs(back[2] - local[2]) < 1e-12);
const identity = worldPointToBody([0, 0, 0], [1, 0, 0, 0], [0.01, 0.02, 0.03]);
assert.deepEqual(identity, [0.01, 0.02, 0.03]);
const distant = analyticalFoot('FL', [2, 0.2, -0.2]);
assert.equal(distant?.reachable, false);
assert.equal(circlePoint(path, 0.5)[0], anchor[0] - 0.02);

const sketch = { params: { speed: 1 }, source: 'motion(t)' };
const sketchText = JSON.stringify(sketch);
configureMemory(createMemory(), { ...DEFAULT_EXPERIMENT, circleRadiusM: 0.02, direction: 'cw' });
selectSimulationBackend('mujoco');
assert.equal(get(simulationBackend), 'mujoco');
assert.equal(JSON.stringify(sketch), sketchText);
selectSimulationBackend('kinematic');
assert.equal(JSON.stringify(sketch), sketchText);

const wide = Array.from({ length: 12 }, (_, index) => ({
  name: `a${index}`,
  minNm: index % 3 === 2 ? -45.43 : -23.7,
  maxNm: index % 3 === 2 ? 45.43 : 23.7,
}));
const upright = fakeSample(0.27);
assert.equal(begin({ ...createMemory(), mode: 'motors-off' }, upright).outcome, 'idle');
const refused = begin({ ...createMemory(), mode: 'air-draw' }, fakeSample(0.1));
assert.equal(refused.outcome, 'failed');
assert.match(refused.reason, /not jumped/);

const plant = stillPlant(upright, wide);
let memory = begin({ ...createMemory(), mode: 'three-leg' }, plant.sample());
let stepped = advanceExperiment(plant, memory, Math.ceil(5.1 / 0.002));
assert.equal(stepped.memory.stage, 'hold');
assert.equal(stepped.memory.criteria.draw, null);

memory = begin({ ...createMemory(), mode: 'air-draw' }, plant.sample());
stepped = advanceExperiment(plant, memory, Math.ceil(5.1 / 0.002));
assert.equal(stepped.memory.stage, 'draw');
assert.equal(stepped.memory.draw.radiusM, 0.01);
assert.ok(stepped.memory.draw.anchor);
assert.equal(stepped.memory.draw.anchor[2], stepped.memory.flTarget?.[2]);
assert.notEqual(stepped.memory.draw.achievedHeightM, stepped.memory.draw.anchor[2]);
assert.equal(stepped.memory.draw.desired[0][2], stepped.memory.draw.anchor[2]);
assert.equal(stepped.memory.draw.desired.at(-1)[2], stepped.memory.draw.anchor[2]);
const paused = pause(stepped.memory);
const frozen = advanceExperiment(plant, paused, 40);
assert.equal(frozen.memory.elapsed, paused.elapsed);
assert.equal(frozen.snapshot.time, stepped.snapshot.time);
const continued = advanceExperiment(plant, resume(frozen.memory), 40);
assert.ok(continued.memory.elapsed > frozen.memory.elapsed);
const interrupted = stop(continued.memory);
assert.equal(interrupted.outcome, 'interrupted');
assert.match(interrupted.reason, /not jumped/);
assert.equal(advanceExperiment(plant, interrupted, 40).memory.elapsed, interrupted.elapsed);
assert.equal(changeMode(continued.memory, 'posture-hold').outcome, 'interrupted');

const xml = readFileSync('public/models/go2/go2.xml', 'utf8');
const assets = {};
for (const file of readdirSync('public/models/go2/assets')) {
  if (!file.endsWith('.obj')) continue;
  assets[file] = new Uint8Array(readFileSync(`public/models/go2/assets/${file}`));
}
const session = await createPhysicsSession({ xml, assets });
const home = session.reset();
assert.ok(home.feet.FL.onFloor && home.feet.FR.onFloor && home.feet.RL.onFloor && home.feet.RR.onFloor);

const first = await runDraw(session);
const againHome = session.reset();
assert.ok(Math.abs(againHome.basePosition[2] - home.basePosition[2]) < 1e-6);
assert.equal(againHome.maxAbsTorqueNm, 0);
const second = await runDraw(session);
assert.equal(second.memory.outcome, first.memory.outcome);
assert.ok(Math.abs(second.memory.draw.maxErrorM - first.memory.draw.maxErrorM) < 1e-6);
assert.ok(Math.abs(second.snapshot.basePosition[2] - first.snapshot.basePosition[2]) < 1e-6);
session.dispose();

const draw = first.memory.draw;
const peaks = first.memory.peaks;
const rms = rmsError(draw.errorSumSq, draw.samples);
console.log(
  [
    `outcome ${first.memory.outcome}`,
    `max ${(draw.maxErrorM * 1000).toFixed(2)} mm`,
    `rms ${((rms ?? 0) * 1000).toFixed(2)} mm`,
    `drawMargin ${((draw.minMarginM ?? 0) * 1000).toFixed(1)} mm`,
    `runMargin ${((peaks.minThreeLegMarginM ?? 0) * 1000).toFixed(1)} mm during ${peaks.minMarginStage}`,
    `roll ${((peaks.maxAbsRollRad * 180) / Math.PI).toFixed(2)} deg`,
    `pitch ${((peaks.maxAbsPitchRad * 180) / Math.PI).toFixed(2)} deg`,
    `torque ${peaks.maxTorqueNm.toFixed(2)} Nm`,
    `drawTorque ${draw.maxTorqueNm.toFixed(2)} Nm`,
    `span ${((draw.achievedWidthM ?? 0) * 1000).toFixed(1)} x ${((draw.achievedDepthM ?? 0) * 1000).toFixed(1)} mm`,
    `revolution ${draw.revolution}`,
    `return ${first.snapshot.feet.FL.onFloor}`,
    `z ${first.snapshot.basePosition[2].toFixed(3)}`,
    `plane ${((draw.anchor?.[2] ?? 0) * 1000).toFixed(1)} mm`,
    `foot ${((draw.achievedHeightM ?? 0) * 1000).toFixed(1)} mm`,
    `saturated ${draw.saturated}`,
    `threshold ${(DRAW_MAX_ERROR_M * 1000).toFixed(0)} mm`,
    first.memory.reason,
  ].join(' | '),
);
console.log('draw audit ok');

async function runDraw(session) {
  let memory = begin({ ...createMemory(), mode: 'air-draw' }, session.sample());
  let result = advanceUntil(session, memory, (state) => state.stage === 'draw', 8000);
  assert.equal(result.memory.stage, 'draw', result.memory.reason);
  assert.equal(result.memory.draw.radiusM, DEFAULT_EXPERIMENT.circleRadiusM);
  assert.equal(result.snapshot.feet.FL.onFloor, false);
  const held = pause(result.memory);
  const still = advanceExperiment(session, held, 30);
  assert.equal(still.snapshot.time, result.snapshot.time);
  assert.equal(still.memory.elapsed, held.elapsed);
  result = advanceUntil(session, resume(still.memory), (state) => state.playback !== 'playing', 20000);
  assert.equal(result.memory.playback, 'paused');
  assert.ok(result.memory.outcome === 'completed' || result.memory.outcome === 'failed');
  assert.equal(result.memory.draw.radiusM, 0.01);
  assert.ok(result.memory.draw.maxTorqueNm <= 45.43);
  assert.ok(result.memory.peaks.maxTorqueNm <= 45.43);
  assert.equal(result.memory.draw.revolution, true, result.memory.failure);
  if (result.memory.outcome === 'failed') assert.ok(result.memory.failure.length > 0);
  if (result.memory.outcome === 'completed') {
    assert.equal(result.memory.criteria.draw, true);
    assert.ok(result.memory.draw.maxErrorM > 0.001);
    assert.ok(result.memory.draw.maxErrorM <= DRAW_MAX_ERROR_M);
    assert.equal(result.snapshot.feet.FL.onFloor, true);
    assert.equal(result.memory.criteria.return, true);
    assert.ok((result.memory.draw.minMarginM ?? 0) > 0.05);
    assert.ok(result.memory.peaks.maxAbsRollRad < 0.2);
    assert.ok(result.memory.peaks.maxAbsPitchRad < 0.2);
    assert.equal(result.memory.draw.saturated, false);
    assert.ok((result.memory.draw.achievedWidthM ?? 0) > 0.015);
    assert.ok((result.memory.draw.achievedDepthM ?? 0) > 0.012);
  }
  return result;
}

function advanceUntil(session, memory, predicate, limit) {
  let result = { memory, snapshot: session.sample() };
  let steps = 0;
  while (!predicate(result.memory) && steps < limit && result.memory.playback === 'playing') {
    result = advanceExperiment(session, result.memory, 200);
    steps += 200;
  }
  assert.ok(steps < limit, 'the schedule did not finish');
  return result;
}

function horizontalSpeed(circle, unit, seconds) {
  const step = 1e-4;
  const next = Math.min(1, unit + step);
  const from = circlePoint(circle, unit);
  const to = circlePoint(circle, next);
  return Math.hypot(to[0] - from[0], to[1] - from[1], to[2] - from[2]) / ((next - unit) * seconds);
}

function stillPlant(sample, ranges) {
  let time = sample.time;
  return {
    info: { timestep: 0.002, actuatorRanges: ranges },
    sample() {
      return { ...sample, time };
    },
    setTorques() {},
    step() {
      time += 0.002;
      return { ...sample, time };
    },
  };
}

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
