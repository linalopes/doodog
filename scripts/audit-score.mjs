/**
 * Creative Score Tracking: one brush, one aerial leg, no invented path.
 * A finished schedule is not a success unless the measurements say so.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  advanceExperiment,
  begin,
  changeMode,
  clearScore,
  createMemory,
  installScore,
  setPlaybackRate,
} from '../src/lib/simulate/physics/experiment.ts';
import { createPhysicsSession } from '../src/lib/simulate/physics/session.ts';
import { DRAW_MAX_ERROR_M } from '../src/lib/simulate/physics/settings.ts';
import {
  buildScoreBuffer,
  gestureScale,
  mapGesture,
  planScoreTimes,
  sampleScore,
  trackStageSeconds,
} from '../src/lib/simulate/physics/score.ts';

const square = planScoreTimes({ durationSeconds: 8, windowSeconds: 4 });
assert.equal(square.kind, 'period');
assert.equal(square.widened, false);
assert.equal(square.times[0], 0);
assert.equal(square.times.at(-1), 8);
const longScore = planScoreTimes({ durationSeconds: 28.4, windowSeconds: 8 });
assert.equal(longScore.kind, 'period');
assert.equal(longScore.widened, true);
assert.ok(longScore.times.length <= 320);
assert.ok(longScore.interval > 0.05);
const continuous = planScoreTimes({ durationSeconds: null, windowSeconds: 8 });
assert.equal(continuous.kind, 'window');
assert.equal(continuous.scoreEnd, 8);

assert.equal(gestureScale(600, 300, 0.02), 0.02 / 600);
const widePlan = planScoreTimes({ durationSeconds: 1, windowSeconds: 1 });
const wide = buildScoreBuffer({
  version: 1,
  runId: 'run',
  revision: 1,
  channel: 'left',
  sketchName: 'Wide',
  canvasWidth: 600,
  canvasHeight: 300,
  gestureSizeM: 0.02,
  plan: widePlan,
  points: [
    { time: 0, x: 0, y: 0, contact: true },
    { time: 1, x: 600, y: 300, contact: true },
  ],
});
assert.ok(!('error' in wide));
assert.ok(Math.abs(wide.spanWidthM - 0.02) < 1e-12);
assert.ok(Math.abs(wide.spanHeightM - 0.01) < 1e-12);
const origin = [0.3, 0.1, 0.04];
const centre = mapGesture(wide, origin, 300, 150);
assert.ok(Math.abs(centre[0] - origin[0]) < 1e-12);
assert.ok(Math.abs(centre[1] - origin[1]) < 1e-12);
assert.equal(centre[2], origin[2]);
const canvasRight = mapGesture(wide, origin, 600, 150);
assert.ok(canvasRight[1] < origin[1]);
assert.ok(Math.abs(canvasRight[0] - origin[0]) < 1e-12);
const canvasDown = mapGesture(wide, origin, 300, 300);
assert.ok(canvasDown[0] < origin[0]);
assert.ok(Math.abs(canvasDown[1] - origin[1]) < 1e-12);

const line = bufferFrom([
  { time: 0, x: 280, y: 300, contact: true },
  { time: 1, x: 320, y: 300, contact: false },
]);
const mid = sampleScore(line, 0.5);
assert.ok(Math.abs(mid.x - 300) < 1e-9);
assert.equal(mid.contact, true);
assert.equal(sampleScore(line, 1).contact, false);
const jump = bufferFrom([
  { time: 0, x: 40, y: 40, contact: true },
  { time: 0.05, x: 560, y: 40, contact: false },
]);
const held = sampleScore(jump, 0.025);
assert.equal(held.held, true);
assert.equal(held.x, 40);
assert.equal(held.contact, true);
const still = buildScoreBuffer({
  version: 3,
  runId: 'run',
  revision: 1,
  channel: 'right',
  sketchName: 'Still',
  canvasWidth: 600,
  canvasHeight: 600,
  gestureSizeM: 0.02,
  plan: widePlan,
  points: [
    { time: 0, x: 22, y: 22, contact: false },
    { time: 1, x: 23, y: 22, contact: false },
  ],
});
assert.ok('error' in still);
assert.match(still.error, /right brush does not move/);
assert.match(still.error, /was not used instead/);
assert.equal(trackStageSeconds(line, 2, 1), 1.5);
assert.equal(trackStageSeconds(line, 1, 1), 2);

const sketch = { source: 'motion(t)', params: { brush: 'left' } };
const sketchText = JSON.stringify(sketch);
let memory = changeMode(createMemory(), 'score');
memory = installScore(memory, line);
assert.equal(memory.score.buffer?.version, 1);
assert.equal(memory.score.buffer?.ignoredChannel, 'right');
memory = installScore(memory, { ...line, version: 0 });
assert.equal(memory.score.buffer?.version, 1);
memory.playback = 'playing';
const refused = installScore(memory, { ...line, version: 4 });
assert.match(refused.reason, /not applied/);
assert.equal(refused.score.buffer?.version, 1);
const dropped = clearScore(refused);
assert.equal(dropped.outcome, 'interrupted');
assert.match(dropped.reason, /not jumped/);
assert.equal(dropped.score.buffer, null);
assert.equal(JSON.stringify(sketch), sketchText);

const missing = begin(changeMode(createMemory(), 'score'), { basePosition: [0, 0, 0.27] });
assert.equal(missing.outcome, 'failed');
assert.equal(missing.criteria.track, false);
assert.match(missing.reason, /No creative trajectory/);
assert.match(missing.reason, /not jumped/);
const cleared = changeMode(installScore(changeMode(createMemory(), 'score'), line), 'three-leg');
assert.equal(cleared.score.buffer, null);
assert.equal(cleared.criteria.track, null);

const rated = setPlaybackRate(installScore(changeMode(createMemory(), 'score'), line), 2);
assert.equal(rated.score.playbackRate, 2);
assert.equal(setPlaybackRate(rated, 99).score.playbackRate, 4);

const xml = readFileSync('public/models/go2/go2.xml', 'utf8');
const assets = {};
for (const file of readdirSync('public/models/go2/assets')) {
  if (!file.endsWith('.obj')) continue;
  assets[file] = new Uint8Array(readFileSync(`public/models/go2/assets/${file}`));
}
const session = await createPhysicsSession({ xml, assets });
const home = session.reset();
assert.ok(home.feet.FL.onFloor);
const result = await runScore(session, lineAcross());
session.dispose();
const track = result.memory.score;
console.log(
  [
    `outcome ${result.memory.outcome}`,
    `max ${(track.maxErrorM * 1000).toFixed(2)} mm`,
    `rms ${(((track.errorSumSq / Math.max(track.samples, 1)) ** 0.5) * 1000).toFixed(2)} mm`,
    `margin ${((track.minMarginM ?? 0) * 1000).toFixed(1)} mm`,
    `roll ${((track.maxAbsRollRad * 180) / Math.PI).toFixed(2)} deg`,
    `pitch ${((track.maxAbsPitchRad * 180) / Math.PI).toFixed(2)} deg`,
    `torque ${track.maxTorqueNm.toFixed(2)} Nm`,
    `runTorque ${result.memory.peaks.maxTorqueNm.toFixed(2)} Nm`,
    `saturated ${track.saturated}`,
    `span ${((track.achievedWidthM ?? 0) * 1000).toFixed(1)} x ${((track.achievedDepthM ?? 0) * 1000).toFixed(1)} mm`,
    `contactRuns ${track.desiredContact.length}`,
    `travelRuns ${track.desiredTravel.length}`,
    `return ${result.snapshot.feet.FL.onFloor}`,
    `z ${result.snapshot.basePosition[2].toFixed(3)}`,
    `scale ${(track.buffer?.scaleM ?? 0) * 1000} mm/unit`,
    result.memory.reason,
  ].join(' | '),
);
assert.equal(result.memory.outcome, 'completed', result.memory.failure || result.memory.reason);
assert.equal(result.memory.criteria.track, true);
assert.ok(track.maxErrorM > 0.0005);
assert.ok(track.maxErrorM <= DRAW_MAX_ERROR_M);
assert.equal(track.saturated, false);
assert.ok(track.maxTorqueNm <= 45.43);
assert.equal(result.snapshot.feet.FL.onFloor, true);
assert.equal(result.memory.criteria.return, true);
assert.ok((track.minMarginM ?? 0) > 0.02);
assert.ok(track.desiredContact.length > 0);
assert.ok(track.desiredTravel.length > 0);
assert.equal(track.buffer?.channel, 'left');
assert.equal(track.buffer?.ignoredChannel, 'right');
console.log('score audit ok');

function bufferFrom(points) {
  const built = buildScoreBuffer({
    version: 1,
    runId: 'run',
    revision: 2,
    channel: 'left',
    sketchName: 'Line',
    canvasWidth: 600,
    canvasHeight: 600,
    gestureSizeM: 0.02,
    plan: { times: points.map((point) => point.time), interval: 0.05, widened: false, kind: 'window', scoreStart: points[0].time, scoreEnd: points.at(-1).time },
    points,
  });
  assert.ok(!('error' in built));
  return built;
}

function lineAcross() {
  const points = [];
  const drawSeconds = 4;
  const travelSeconds = 2;
  const steps = 40;
  for (let index = 0; index <= steps; index += 1) {
    const unit = index / steps;
    points.push({
      time: unit * drawSeconds,
      x: 180 + unit * 240,
      y: 220 + unit * 160,
      contact: true,
    });
  }
  for (let index = 1; index <= 20; index += 1) {
    const unit = index / 20;
    const last = points.at(-1);
    points.push({
      time: drawSeconds + unit * travelSeconds,
      x: last.x + (300 - last.x) * unit,
      y: last.y + (300 - last.y) * unit,
      contact: false,
    });
  }
  return bufferFrom(points);
}

async function runScore(session, buffer) {
  let memory = setPlaybackRate(installScore(changeMode(createMemory(), 'score'), buffer), 1);
  memory = begin(memory, session.sample());
  assert.equal(memory.outcome, 'running', memory.reason);
  let result = advanceUntil(session, memory, (state) => state.stage === 'track' || state.outcome === 'failed', 8000);
  assert.equal(result.memory.stage, 'track', result.memory.reason);
  assert.equal(result.memory.score.initialReachable, true);
  const origin = result.memory.score.origin;
  const target = result.memory.flTarget;
  const first = buffer.points[0];
  const firstWorld = mapGesture(buffer, origin, first.x, first.y);
  const moved = Math.hypot(target[0] - origin[0], target[1] - origin[1], target[2] - origin[2]);
  const span = Math.hypot(firstWorld[0] - origin[0], firstWorld[1] - origin[1], firstWorld[2] - origin[2]);
  assert.ok(moved < span * 0.5 + 0.001, `entry moved ${moved} of ${span}`);
  assert.equal(result.snapshot.feet.FR.onFloor, true);
  assert.equal(result.snapshot.feet.RL.onFloor, true);
  assert.equal(result.snapshot.feet.RR.onFloor, true);
  assert.equal(result.snapshot.feet.FL.onFloor, false);
  const paused = result.memory;
  const frozen = advanceExperiment(session, { ...paused, playback: 'paused', outcome: 'paused' }, 20);
  assert.equal(frozen.memory.elapsed, paused.elapsed);
  result = advanceUntil(session, result.memory, (state) => state.playback !== 'playing', 30000);
  return result;
}

function advanceUntil(session, memory, predicate, limit) {
  let result = { memory, snapshot: session.sample() };
  let steps = 0;
  while (!predicate(result.memory) && steps < limit && result.memory.playback === 'playing') {
    result = advanceExperiment(session, result.memory, 200);
    steps += 200;
  }
  assert.ok(steps < limit, result.memory.reason || 'the schedule did not finish');
  return result;
}
