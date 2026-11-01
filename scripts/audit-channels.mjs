/**
 * Creative-channel roles for the kinematic preview.
 * A resting coordinate must not solve a leg. Raised travel still does.
 */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { channelRole, isMotionFrame } from '../src/lib/motion/types.ts';
import { defaultSimConfig } from '../src/lib/simulate/go2/defaults.ts';
import { referenceAngles } from '../src/lib/simulate/go2/kinematics.ts';
import { LEGS } from '../src/lib/simulate/go2/model.ts';
import { interpretFrame, solvePose } from '../src/lib/simulate/go2/pose.ts';
import { getExampleById } from '../src/lib/sketches/examples.ts';

const CANVAS = { width: 600, height: 600 };
const home = referenceAngles();
const config = defaultSimConfig();

function loadSketch(source) {
  const sandbox = { width: 600, height: 600, sin: Math.sin, cos: Math.cos, Math, console };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'sketch.js' });
  return sandbox;
}

function sameJoints(a, b) {
  return a.length === b.length && a.every((value, index) => Math.abs(value - b[index]) < 1e-9);
}

function crosses(legId, foot) {
  return foot[1] * LEGS[legId].hipPosition[1] < 0;
}

const legacy = {
  time: 2.4,
  left: { x: 300, y: 180, contact: true },
  right: { x: 22, y: 578, contact: false },
};
assert.equal(isMotionFrame(legacy), true);
assert.equal(channelRole(legacy.right), 'travel');
const legacyPose = interpretFrame(legacy, CANVAS, config).snapshot;
assert.equal(legacyPose.legs.FR.active, true);
assert.equal(legacyPose.legs.FR.channel, 'travel');
assert.equal(crosses('FR', legacyPose.legs.FR.footWorld), true);
assert.equal(legacyPose.legs.FR.posture.contralateral, 'invalid');
console.log(JSON.stringify({
  case: 'legacy resting corner, active omitted',
  right: legacy.right,
  frFoot: legacyPose.legs.FR.footWorld.map((value) => Number(value.toFixed(4))),
  frHipY: LEGS.FR.hipPosition[1],
  contralateral: legacyPose.legs.FR.posture.contralateral,
}, null, 2));

assert.equal(isMotionFrame({ ...legacy, right: { ...legacy.right, active: 'no' } }), false);

const singleBrush = [
  'simple-line',
  'grid',
  'concentric-circles',
  'wave-lines',
  'noise-field',
  'polyline-composition',
];

for (const id of singleBrush) {
  const example = getExampleById(id);
  assert.ok(example);
  for (const brush of ['left', 'right']) {
    const sandbox = loadSketch(`${example.source}\nparams.brush = ${JSON.stringify(brush)};`);
    const frame = sandbox.motion(1.2);
    const other = brush === 'left' ? 'right' : 'left';
    const idleLeg = brush === 'left' ? 'FR' : 'FL';
    const liveLeg = brush === 'left' ? 'FL' : 'FR';
    assert.equal(frame[other].active, false, `${id} ${other}`);
    assert.equal(frame[other].contact, false);
    const pose = interpretFrame(frame, CANVAS, config).snapshot;
    assert.equal(pose.legs[idleLeg].channel, 'resting');
    assert.equal(pose.legs[idleLeg].active, false);
    assert.ok(sameJoints(pose.legs[idleLeg].joints, home), `${id} ${idleLeg} left the reference pose`);
    assert.equal(crosses(idleLeg, pose.legs[idleLeg].footWorld), false);
    assert.notEqual(pose.legs[liveLeg].channel, 'resting');
    assert.equal(pose.legs[liveLeg].active, true);
  }
}

const grid = loadSketch(getExampleById('grid').source);
let travel = null;
let previous = grid.motion(0);
for (let time = 0.05; time < grid.scorePeriod(); time += 0.05) {
  const frame = grid.motion(time);
  const moved = Math.hypot(frame.left.x - previous.left.x, frame.left.y - previous.left.y);
  if (!frame.left.contact && frame.left.active !== false && moved > 5) {
    travel = { time, frame, previous };
    break;
  }
  previous = frame;
}
assert.ok(travel, 'grid has no raised moving left brush');
const travelPose = interpretFrame(travel.frame, CANVAS, config).snapshot;
assert.equal(travelPose.legs.FL.channel, 'travel');
assert.equal(travelPose.legs.FL.active, true);
assert.equal(travelPose.legs.FL.drawing, false);
assert.equal(sameJoints(travelPose.legs.FL.joints, home), false);
assert.equal(travelPose.legs.FR.channel, 'resting');
assert.ok(sameJoints(travelPose.legs.FR.joints, home));
const again = interpretFrame(grid.motion(travel.time), CANVAS, config).snapshot;
assert.deepEqual(again.joints, travelPose.joints);

const drawing = grid.motion(0);
assert.equal(drawing.left.contact, true);
const drawn = interpretFrame(drawing, CANVAS, config).snapshot;
const drawnAgain = interpretFrame(grid.motion(0), CANVAS, config).snapshot;
assert.deepEqual(drawn.joints, drawnAgain.joints);
assert.equal(drawn.legs.FL.channel, 'drawing');
assert.equal(drawn.legs.FR.channel, 'resting');
console.log(JSON.stringify({
  case: 'grid left, t=0',
  left: drawing.left,
  right: drawing.right,
  flChannel: drawn.legs.FL.channel,
  frChannel: drawn.legs.FR.channel,
  frFootY: Number(drawn.legs.FR.footWorld[1].toFixed(4)),
}, null, 2));

const hidden = defaultSimConfig();
hidden.brushes.right.visible = false;
const hiddenPose = interpretFrame(
  { time: 0, left: drawing.left, right: { x: 420, y: 180, contact: true } },
  CANVAS,
  hidden,
).snapshot;
assert.equal(hidden.brushes.right.visible, false);
assert.equal(hiddenPose.legs.FR.active, true);
assert.equal(hiddenPose.legs.FR.channel, 'drawing');

const shown = defaultSimConfig();
shown.brushes.right.visible = true;
const shownPose = interpretFrame(
  { time: 0, left: drawing.left, right: { x: 22, y: 578, contact: false, active: false } },
  CANVAS,
  shown,
).snapshot;
assert.equal(shown.brushes.right.visible, true);
assert.equal(shownPose.legs.FR.channel, 'resting');
assert.ok(sameJoints(shownPose.legs.FR.joints, home));

const manual = {
  FL: [0.2, 0.4, -1.2],
  FR: [-0.2, 0.5, -1.4],
  RL: [...home],
  RR: [...home],
};
const inspected = solvePose(drawing, CANVAS, config, manual);
assert.equal(inspected.manual, true);
assert.equal(inspected.legs.FL.note.includes('Manual inspection'), true);
assert.deepEqual(inspected.legs.FL.joints, manual.FL);
assert.deepEqual(inspected.legs.FR.joints, manual.FR);
assert.equal(inspected.legs.FL.active, false);

const lissajous = loadSketch(getExampleById('two-brush-lissajous').source);
const both = lissajous.motion(1.2);
assert.equal(both.left.active, undefined);
assert.equal(both.right.active, undefined);
assert.notEqual(channelRole(both.left), 'resting');
assert.notEqual(channelRole(both.right), 'resting');
const coupled = interpretFrame(both, CANVAS, config).snapshot;
assert.equal(coupled.legs.FL.active, true);
assert.equal(coupled.legs.FR.active, true);
assert.equal(sameJoints(coupled.legs.FL.joints, home), false);
assert.equal(sameJoints(coupled.legs.FR.joints, home), false);
assert.equal(coupled.label.includes('Not Physically Validated'), true);
