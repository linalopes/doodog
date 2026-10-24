/**
 * Kinematic, mapping, and trail checks for the Go2 preview.
 * Run via npm test. Does not load meshes or Three.js.
 */
import assert from 'node:assert/strict';
import { mergeMotionSamples } from '../src/lib/motion/sampleList.ts';
import { isRuntimeMessage } from '../src/lib/p5/protocol.ts';
import { createKinematicAdapter } from '../src/lib/simulate/adapters/kinematic.ts';
import { defaultSimConfig } from '../src/lib/simulate/go2/defaults.ts';
import {
  anglesWithinLimits,
  analyticalFoot,
  forwardLeg,
  referenceAngles,
  solveLeg,
} from '../src/lib/simulate/go2/kinematics.ts';
import { mapBrushTarget } from '../src/lib/simulate/go2/mapping.ts';
import { BODY_POSITION, LEGS } from '../src/lib/simulate/go2/model.ts';
import { trailLines } from '../src/lib/simulate/go2/paint.ts';
import { interpretFrame, solvePose } from '../src/lib/simulate/go2/pose.ts';

const canvas = { width: 600, height: 600 };
const zeroOffset = [0, 0, 0];

function close(a, b, eps = 1e-3) {
  assert.ok(Math.abs(a - b) <= eps, `${a} vs ${b}`);
}

const home = referenceAngles();
const fl = forwardLeg('FL', home, zeroOffset);
close(fl.foot[0], 0.1934, 1e-3);
close(fl.foot[1], 0.142, 1e-3);
close(fl.foot[2], -0.265, 2e-3);
const fr = forwardLeg('FR', home, zeroOffset);
close(fr.foot[1], -0.142, 1e-3);
close(fr.foot[0], fl.foot[0], 1e-6);
assert.ok(fl.foot[1] > 0 && fr.foot[1] < 0);

const straight = forwardLeg('FL', [0, 0, -1.8], zeroOffset);
const folded = forwardLeg('FL', [0, 0.9, -1.8], zeroOffset);
assert.ok(folded.foot[0] < straight.foot[0], 'positive thigh pitch swings the foot backward');

const level = forwardLeg('FL', [0, 0.9, -1.8], zeroOffset);
const lifted = forwardLeg('FL', [0.4, 0.9, -1.8], zeroOffset);
assert.ok(lifted.foot[2] > level.foot[2], 'positive FL abduction raises the foot');
const frLevel = forwardLeg('FR', [0, 0.9, -1.8], zeroOffset);
const frDown = forwardLeg('FR', [0.4, 0.9, -1.8], zeroOffset);
assert.ok(frDown.foot[2] < frLevel.foot[2], 'the shared +X axis lowers the right foot');

for (const id of ['FL', 'FR', 'RL', 'RR']) {
  const spec = LEGS[id];
  assert.deepEqual(spec.abduction.axis, [1, 0, 0]);
  assert.deepEqual(spec.hip.axis, [0, 1, 0]);
  assert.deepEqual(spec.knee.axis, [0, 1, 0]);
  assert.ok(spec.knee.min < 0 && spec.knee.max < 0);
  const pose = forwardLeg(id, home, zeroOffset);
  assert.ok(anglesWithinLimits(spec, pose.joints));
}

const round = analyticalFoot('FL', fl.foot);
assert.ok(round);
close(round.joints[0], 0, 1e-3);
close(round.joints[1], 0.9, 1e-3);
close(round.joints[2], -1.8, 1e-3);
assert.equal(round.reachable, true);

const tip = forwardLeg('FL', home, [0.035, 0, -0.045]).tip;
const solved = solveLeg('FL', tip, [0.035, 0, -0.045]);
assert.ok(solved.reachable, `home tip error ${solved.positionErrorM}`);
assert.ok(solved.positionErrorM < 1e-3);
close(solved.joints[0], 0, 0.02);
close(solved.joints[1], 0.9, 0.05);
close(solved.joints[2], -1.8, 0.05);
const again = solveLeg('FL', tip, [0.035, 0, -0.045]);
assert.deepEqual(again.joints, solved.joints);

const far = solveLeg('FL', [4, 4, 1], zeroOffset);
assert.equal(far.reachable, false);
assert.ok(far.positionErrorM > 0.05);
assert.ok(anglesWithinLimits(LEGS.FL, far.joints));
assert.ok(Number.isFinite(far.positionErrorM));

const config = defaultSimConfig();
const centre = mapBrushTarget(
  { x: 300, y: 300, contact: true },
  canvas,
  config.paper,
  config.mapping,
  true,
  BODY_POSITION,
);
assert.deepEqual([...centre.surface], [...config.paper.origin]);
assert.equal(centre.drawing, true);
close(centre.scaleX, config.paper.widthM / 600, 1e-9);

const up = mapBrushTarget(
  { x: 300, y: 300, contact: false },
  canvas,
  config.paper,
  config.mapping,
  true,
  BODY_POSITION,
);
close(up.world[2], config.paper.origin[2] + config.paper.liftHeightM, 1e-9);
assert.equal(up.drawing, false);

const inactive = mapBrushTarget(
  { x: 300, y: 300, contact: true },
  canvas,
  config.paper,
  config.mapping,
  false,
  BODY_POSITION,
);
assert.equal(inactive.drawing, false);
close(inactive.world[2], config.paper.liftHeightM, 1e-9);

const right = mapBrushTarget(
  { x: 600, y: 300, contact: true },
  canvas,
  config.paper,
  config.mapping,
  true,
  BODY_POSITION,
);
assert.ok(right.surface[1] < config.paper.origin[1], 'canvas +X goes to the robot’s right');

const down = mapBrushTarget(
  { x: 300, y: 600, contact: true },
  canvas,
  config.paper,
  config.mapping,
  true,
  BODY_POSITION,
);
assert.ok(down.surface[0] < config.paper.origin[0], 'canvas +Y goes back toward the robot');

const custom = mapBrushTarget(
  { x: 400, y: 300, contact: true },
  canvas,
  config.paper,
  { ...config.mapping, scaleX: 0.001, scaleY: 0.002 },
  true,
  BODY_POSITION,
);
close(custom.scaleX, 0.001, 1e-12);
assert.ok(Math.abs(custom.scaleX - config.paper.widthM / 600) > 1e-6);

const yawed = mapBrushTarget(
  { x: 600, y: 300, contact: true },
  canvas,
  { ...config.paper, yawRad: Math.PI / 2 },
  config.mapping,
  true,
  BODY_POSITION,
);
const dx = yawed.surface[0] - config.paper.origin[0];
const dy = yawed.surface[1] - config.paper.origin[1];
close(dx, -(right.surface[1] - config.paper.origin[1]), 1e-6);
close(dy, right.surface[0] - config.paper.origin[0], 1e-6);

const frame = {
  time: 1.25,
  left: { x: 300, y: 300, contact: true },
  right: { x: 300, y: 300, contact: false },
};
const first = interpretFrame(frame, canvas, config);
const second = interpretFrame(frame, canvas, config);
assert.deepEqual(first.snapshot.joints, second.snapshot.joints);
assert.equal(first.snapshot.label.includes('Not Physically Validated'), true);
assert.equal(first.snapshot.legs.RL.note.includes('Reference pose'), true);
assert.deepEqual(first.snapshot.legs.RL.joints, [...home]);
assert.equal(first.snapshot.legs.FR.drawing, false);
assert.equal(first.snapshot.legs.FR.nearSurface, false);
assert.ok(first.snapshot.legs.FL.positionErrorM !== null);
for (const id of ['FL', 'FR', 'RL', 'RR']) {
  assert.ok(anglesWithinLimits(LEGS[id], first.snapshot.joints[id]));
}

const liftedFrame = interpretFrame(
  { time: 0, left: { x: 300, y: 300, contact: false }, right: { x: 300, y: 300, contact: false } },
  canvas,
  config,
);
assert.equal(trailLines(liftedFrame.marks).paint.length, 0);
assert.equal(liftedFrame.marks.every((mark) => mark.paint === false), true);

const contact = interpretFrame(
  { time: 0, left: { x: 280, y: 320, contact: true }, right: { x: 320, y: 280, contact: true } },
  canvas,
  config,
);
const later = interpretFrame(
  { time: 0.2, left: { x: 290, y: 330, contact: true }, right: { x: 310, y: 290, contact: true } },
  canvas,
  config,
);
const lines = trailLines([...contact.marks, ...later.marks]);
assert.ok(lines.desired.length >= 1);
const gap = trailLines([
  { ...contact.marks[0], time: 0 },
  { ...later.marks[0], time: 2 },
]);
assert.equal(gap.desired.filter((pair) => pair[0] === contact.marks[0].desired).length, 0);

const off = defaultSimConfig();
off.brushes.left.active = false;
const idle = interpretFrame(frame, canvas, off);
assert.equal(idle.snapshot.legs.FL.active, false);
assert.equal(idle.marks.some((mark) => mark.side === 'left'), false);
assert.deepEqual(idle.snapshot.legs.FL.joints, [...home]);

const previous = [
  { time: 0, left: frame.left, right: frame.right },
  { time: 1, left: frame.left, right: frame.right },
  { time: 2, left: frame.left, right: frame.right },
];
const trimmed = mergeMotionSamples(previous, [{ time: 0.5, left: frame.left, right: frame.right }]);
assert.deepEqual(trimmed.map((sample) => sample.time), [0, 0.5]);
const replaced = mergeMotionSamples(previous, [
  { time: 0, left: frame.left, right: frame.right },
  { time: 0.5, left: frame.left, right: frame.right },
]);
assert.deepEqual(replaced.map((sample) => sample.time), [0, 0.5]);

const valid = {
  type: 'MOTION_FRAME',
  runId: 'run',
  serial: 1,
  frame,
  errorCode: null,
  errorMessage: null,
  durationSeconds: null,
  canvasWidth: 600,
  canvasHeight: 600,
  samples: [frame, { ...frame, time: 1.5 }],
};
assert.equal(isRuntimeMessage(valid), true);
assert.equal(isRuntimeMessage({ ...valid, samples: undefined }), true);
const tooMany = Array.from({ length: 321 }, (_, index) => ({ ...frame, time: index }));
assert.equal(isRuntimeMessage({ ...valid, samples: tooMany }), false);

const adapter = createKinematicAdapter();
await adapter.load({ durationSeconds: 8, canvas });
adapter.applyFrame(frame);
assert.deepEqual(adapter.readJoints(), first.snapshot.joints);
assert.equal(adapter.capabilities.physics, false);
assert.equal(adapter.capabilities.backend, 'three-kinematic');
adapter.dispose();
assert.equal(adapter.readJoints(), null);

console.log('kinematics audit ok');
console.log(
  'home FL foot body',
  fl.foot.map((value) => value.toFixed(4)).join(', '),
  'world z',
  (fl.foot[2] + BODY_POSITION[2]).toFixed(4),
);
