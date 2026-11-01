/**
 * Drawing-posture checks for the Grid frame that the kinematic preview
 * reports as positionally reached. The sheet and the mount stay at their
 * defaults. Mesh collision is not invented.
 */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { getExampleById } from '../src/lib/sketches/examples.ts';
import { defaultSimConfig } from '../src/lib/simulate/go2/defaults.ts';
import { solveLeg } from '../src/lib/simulate/go2/kinematics.ts';
import { mapBrushTarget } from '../src/lib/simulate/go2/mapping.ts';
import { quatRotate } from '../src/lib/simulate/go2/math.ts';
import { BODY_POSITION, LEGS } from '../src/lib/simulate/go2/model.ts';
import { trailLines } from '../src/lib/simulate/go2/paint.ts';
import { interpretFrame } from '../src/lib/simulate/go2/pose.ts';
import {
  assessPosture,
  brushAngleToPaper,
  brushAxisOf,
  defaultMountMatchesCalibration,
  orientationOnSheet,
  solveLegPosture,
} from '../src/lib/simulate/go2/posture.ts';
import { classifyCanvasPoint } from '../src/lib/simulate/go2/reachability.ts';

const canvas = { width: 600, height: 600 };

function load(id) {
  const example = getExampleById(id);
  assert.ok(example);
  const sandbox = { width: 600, height: 600, sin: Math.sin, cos: Math.cos, Math, console };
  vm.createContext(sandbox);
  vm.runInContext(example.source, sandbox, { filename: `${id}.js` });
  return sandbox.motion;
}

function deg(rad) {
  return (rad * 180) / Math.PI;
}

const config = defaultSimConfig();
assert.equal(config.postureAware, false);
assert.equal(config.brushAxisToleranceDeg, 25);
assert.deepEqual([...config.paper.origin], [0.3, 0, 0]);
assert.equal(config.paper.widthM, 0.2);
assert.equal(config.paper.heightM, 0.2);
assert.equal(defaultMountMatchesCalibration(), true);

const grid = load('grid');
const atLift = grid(14.8);
assert.equal(atLift.left.contact, false);
const first = interpretFrame(atLift, canvas, config);
const second = interpretFrame(atLift, canvas, config);
assert.deepEqual(first.snapshot.joints, second.snapshot.joints);

const fl = first.snapshot.legs.FL;
const mapped = mapBrushTarget(atLift.left, canvas, config.paper, config.mapping, true, BODY_POSITION);
const position = solveLeg('FL', mapped.body, config.brushes.left.offset);
assert.equal(fl.reachable, true);
assert.ok(fl.positionErrorM < 1e-4, `position error ${fl.positionErrorM}`);
assert.deepEqual(fl.joints, position.joints);
assert.equal(fl.solver, 'position');
assert.equal(fl.alternateFound, false);
assert.equal(fl.onLimit, false);
assert.equal(fl.posture.joints, 'valid');
assert.equal(fl.posture.nearLimit, false);
assert.ok(fl.footWorld[1] * LEGS.FL.hipPosition[1] < 0, 'front-left foot crosses the body midline');
assert.equal(fl.posture.contralateral, 'invalid');
assert.ok(fl.posture.footClearanceM > 0, 'the lifted frame keeps the foot sphere above the floor');
assert.ok(deg(fl.posture.brushAngleRad) > 90);
assert.equal(fl.posture.brush, 'invalid');
assert.equal(fl.posture.mesh, 'not-evaluated');
assert.equal(fl.posture.drawing, 'invalid');
assert.equal(fl.posture.positionReached, true);
assert.match(fl.note, /Position reached/);
assert.match(fl.note, /Drawing posture invalid/);
assert.equal(fl.drawing, false);
assert.equal(first.marks.find((mark) => mark.side === 'left')?.paint, false);
assert.equal(first.marks.find((mark) => mark.side === 'left')?.rejected, false);

const axis = brushAxisOf(position.footRotation, config.brushes.left.offset);
const rotated = quatRotate(position.footRotation, config.brushes.left.offset);
const rotatedLength = Math.hypot(rotated[0], rotated[1], rotated[2]);
assert.ok(Math.abs(axis[0] - rotated[0] / rotatedLength) < 1e-9);
assert.ok(Math.abs(axis[1] - rotated[1] / rotatedLength) < 1e-9);
assert.ok(Math.abs(axis[2] - rotated[2] / rotatedLength) < 1e-9);
const inward = brushAngleToPaper(axis);
assert.ok(Math.abs(inward - fl.posture.brushAngleRad) < 1e-9);
assert.ok(axis[2] > 0, 'the solved brush axis points upward, not into the sheet');

const searched = solveLegPosture('FL', mapped.body, config.brushes.left.offset);
const searchedAgain = solveLegPosture('FL', mapped.body, config.brushes.left.offset);
assert.deepEqual(searched.joints, searchedAgain.joints);
assert.equal(searched.alternateFound, false);
assert.equal(searched.reachable, true);
assert.ok(Math.abs(searched.joints[0] - position.joints[0]) < 1e-3);
assert.ok(Math.abs(searched.joints[1] - position.joints[1]) < 1e-3);
assert.ok(Math.abs(searched.joints[2] - position.joints[2]) < 1e-3);

const aware = defaultSimConfig();
aware.postureAware = true;
const awarePose = interpretFrame(atLift, canvas, aware);
assert.equal(awarePose.snapshot.legs.FL.alternateFound, false);
assert.deepEqual(awarePose.snapshot.joints.FL, first.snapshot.joints.FL);
assert.match(awarePose.snapshot.legs.FL.note, /not a physics result/);

const contact = grid(0);
assert.equal(contact.left.contact, true);
const down = interpretFrame(contact, canvas, config);
const downLeg = down.snapshot.legs.FL;
assert.equal(downLeg.reachable, true);
assert.ok(downLeg.footWorld[1] > 0, 'the first Grid contact stays on the front-left side');
assert.ok(downLeg.posture.footClearanceM < -0.02, 'a tip on the sheet puts the foot sphere through the floor');
assert.equal(downLeg.posture.floor, 'invalid');
assert.equal(downLeg.posture.drawing, 'invalid');
assert.equal(down.marks.find((mark) => mark.side === 'left')?.paint, false);
assert.equal(down.marks.find((mark) => mark.side === 'left')?.rejected, true);

const laterContact = grid(0.05);
assert.equal(laterContact.left.contact, true);
const later = interpretFrame(laterContact, canvas, config);
const lines = trailLines([...down.marks, ...later.marks]);
assert.ok(lines.desired.length >= 1);
assert.ok(lines.achieved.length >= 1);
assert.equal(lines.paint.length, 0);
assert.ok(lines.rejected.length >= 1);

const nearby = [14.6, 14.8, 15];
const samples = nearby.map((time) => interpretFrame(grid(time), canvas, aware).snapshot.legs.FL);
for (let index = 1; index < samples.length; index += 1) {
  const previous = samples[index - 1];
  const next = samples[index];
  const jump = Math.hypot(
    next.joints[0] - previous.joints[0],
    next.joints[1] - previous.joints[1],
    next.joints[2] - previous.joints[2],
  );
  assert.ok(jump < 0.8, `posture-aware joints jumped ${jump} rad`);
  assert.equal(next.alternateFound, false);
}

const onLimit = assessPosture(
  'FL',
  [0, 0.9, LEGS.FL.knee.min],
  config.brushes.left.offset,
  0,
);
assert.equal(onLimit.joints, 'invalid');
assert.equal(onLimit.mesh, 'not-evaluated');
assert.notEqual(onLimit.drawing, 'valid');

const workspace = orientationOnSheet(config);
assert.equal(workspace.examined, 1331);
assert.equal(workspace.onSheet, 0);

const qualified = classifyCanvasPoint(atLift.left.x, atLift.left.y, {
  canvas,
  config,
  height: 'up',
  qualification: 'posture',
});
assert.equal(qualified.left.reachable, true);
assert.equal(qualified.posture, 'invalid');
const positional = classifyCanvasPoint(atLift.left.x, atLift.left.y, {
  canvas,
  config,
  height: 'up',
});
assert.equal(positional.posture, null);
assert.equal(positional.left.reachable, true);

for (const id of ['simple-line', 'concentric-circles']) {
  const motion = load(id);
  const frame = motion(1);
  const pose = interpretFrame(frame, canvas, config);
  const only = solveLeg('FL', mapBrushTarget(frame.left, canvas, config.paper, config.mapping, true, BODY_POSITION).body, config.brushes.left.offset);
  assert.deepEqual(pose.snapshot.legs.FL.joints, only.joints);
  assert.equal(pose.snapshot.legs.FL.posture.mesh, 'not-evaluated');
  assert.equal(pose.snapshot.label.includes('Not Physically Validated'), true);
}

console.log('posture audit ok');
console.log(
  'grid 14.8s',
  'canvas',
  atLift.left.x.toFixed(2),
  atLift.left.y.toFixed(2),
  'tip',
  fl.tipWorld.map((value) => value.toFixed(4)).join(', '),
  'foot',
  fl.footWorld.map((value) => value.toFixed(4)).join(', '),
  'joints deg',
  fl.joints.map((value) => deg(value).toFixed(1)).join(', '),
  'axis',
  fl.posture.brushAxis.map((value) => value.toFixed(3)).join(', '),
  'angle',
  deg(fl.posture.brushAngleRad).toFixed(1),
  'sphere clearance mm',
  (fl.posture.footClearanceM * 1000).toFixed(1),
  'link clearance mm',
  (fl.posture.linkClearanceM * 1000).toFixed(1),
  'torso',
  fl.posture.torso,
);
console.log(
  'grid 0s clearance mm',
  (downLeg.posture.footClearanceM * 1000).toFixed(1),
  'angle',
  deg(downLeg.posture.brushAngleRad).toFixed(1),
  'workspace',
  workspace.onSheet,
  '/',
  workspace.examined,
);
