/**
 * Brush geometry, paper-plane distance, and the no-contact approach gate.
 * A tip below the plane is not a collision. The sheet is not moved to help a reach.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import {
  brushTipInFoot,
  brushWorld,
  calibrationFrom,
  clearanceTarget,
  defaultTipMatchesPreview,
  paperFrom,
  pathReachable,
  solveTipTarget,
  tipToPaper,
  DEFAULT_BRUSH_CALIBRATION,
} from '../src/lib/simulate/go2/brush.ts';
import { forwardLeg } from '../src/lib/simulate/go2/kinematics.ts';
import { quatFromAxisAngle } from '../src/lib/simulate/go2/math.ts';
import { begin, commandFrom, createMemory } from '../src/lib/simulate/physics/experiment.ts';
import { createPhysicsSession } from '../src/lib/simulate/physics/session.ts';
import { clampConfig, DEFAULT_EXPERIMENT } from '../src/lib/simulate/physics/settings.ts';
import { footWorld } from '../src/lib/simulate/physics/targets.ts';

assert.equal(defaultTipMatchesPreview(), true);
const preview = brushTipInFoot(DEFAULT_BRUSH_CALIBRATION);
assert.ok(Math.abs(preview[0] - 0.035) < 1e-9);
assert.ok(Math.abs(preview[1]) < 1e-9);
assert.ok(Math.abs(preview[2] + 0.045) < 1e-9);

const shaft = { ...DEFAULT_BRUSH_CALIBRATION, mountOffset: [0, 0, 0] };
const down = brushWorld([1, 2, 3], [1, 0, 0, 0], shaft);
assert.ok(Math.abs(down.tip[0] - 1) < 1e-9);
assert.ok(Math.abs(down.tip[1] - 2) < 1e-9);
assert.ok(Math.abs(down.tip[2] - (3 - 0.045)) < 1e-9);

// Positive pitch about +Y by 90° takes brush −Z to world −X. A fixed world offset would stay on −Z.
const pitched = brushWorld([0, 0, 0], quatFromAxisAngle([0, 1, 0], Math.PI / 2), shaft);
assert.ok(Math.abs(pitched.tip[0] + 0.045) < 1e-6, `pitched tip ${pitched.tip}`);
assert.ok(Math.abs(pitched.tip[1]) < 1e-6);
assert.ok(Math.abs(pitched.tip[2]) < 1e-6);

const longer = brushTipInFoot({ ...DEFAULT_BRUSH_CALIBRATION, lengthM: 0.08 });
assert.ok(Math.abs(longer[2] + 0.08) < 1e-9);
assert.ok(Math.abs(longer[0] - 0.035) < 1e-9);

const sheet = {
  widthM: 0.2,
  heightM: 0.2,
  origin: [0.3, 0, 0],
  yawRad: 0,
  liftHeightM: 0.04,
};
const above = tipToPaper([0.3, 0, 0.01], sheet);
assert.ok(Math.abs(above.signedM - 0.01) < 1e-12);
assert.equal(above.side, 'above');
assert.equal(above.inside, true);
const band = tipToPaper([0.3, 0, 0.0004], sheet);
assert.equal(band.side, 'on');
const below = tipToPaper([0.3, 0, -0.002], sheet);
assert.equal(below.side, 'below');
assert.equal(below.inside, true);
assert.equal(tipToPaper([0.45, 0, 0.01], sheet).inside, false);
const turned = { ...sheet, origin: [0, 0, 0], yawRad: Math.PI / 2 };
assert.equal(tipToPaper([0.05, 0, 0.01], turned).inside, true);
assert.equal(tipToPaper([0.2, 0, 0.01], turned).inside, false);

const kept = clampConfig({ ...DEFAULT_EXPERIMENT, brushLengthM: Number.NaN, brushClearanceM: Number.NaN });
assert.equal(kept.brushLengthM, 0.045);
assert.equal(kept.brushClearanceM, 0.01);
assert.equal(DEFAULT_EXPERIMENT.returnStyle, 'baseline');
assert.equal(DEFAULT_EXPERIMENT.paperWidthM, 0.2);
assert.equal(DEFAULT_EXPERIMENT.paperHeightM, 0.2);

const body = [0, 0, 0.27];
const joints = [0, 0.9, -1.8];
const pose = forwardLeg('FL', joints, [0, 0, 0]);
const foot = [body[0] + pose.foot[0], body[1] + pose.foot[1], body[2] + pose.foot[2]];
const calibration = calibrationFrom(DEFAULT_EXPERIMENT);
const homeTip = brushWorld(foot, pose.footRotation, calibration).tip;
const reachable = solveTipTarget(body, [1, 0, 0, 0], homeTip, calibration, joints);
assert.equal(reachable.reachable, true);
assert.ok(reachable.errorM < 0.005);
const far = solveTipTarget(body, [1, 0, 0, 0], [2, 2, 0.2], calibration, joints);
assert.equal(far.reachable, false);
assert.equal(pathReachable(body, [1, 0, 0, 0], foot, reachable.foot), true);
assert.equal(pathReachable(body, [1, 0, 0, 0], foot, [5, 0, 0.2]), false);

const ranges = Array.from({ length: 12 }, (_, index) => ({
  name: `a${index}`,
  minNm: -23.7,
  maxNm: 23.7,
}));

const stale = createMemory();
stale.mode = 'brush-approach';
stale.approach.note = 'stale';
stale.approach.reachable = true;
const reset = begin(stale, sample(0.27, true));
assert.equal(reset.approach.note, '');
assert.equal(reset.approach.reachable, null);
assert.equal(reset.criteria.approach, null);
assert.equal(reset.stage, 'stand');

const raised = 0.04;
const nearPaper = {
  paperOriginX: homeTip[0],
  paperOriginY: homeTip[1],
  paperOriginZ: homeTip[2] + raised - DEFAULT_EXPERIMENT.brushClearanceM,
};
const started = commandFrom(ready(nearPaper, foot), sample(0.27, false), ranges, 0.002);
assert.equal(started.memory.stage, 'approach');
assert.equal(started.memory.approach.reachable, true);
assert.equal(started.memory.criteria.approach, true);
assert.ok(started.memory.approach.tipTarget);
assert.ok(Math.abs(started.memory.approach.tipTarget[2] - (homeTip[2] + raised)) < 1e-6);
assert.ok(started.memory.approach.footTarget[2] >= foot[2] + DEFAULT_EXPERIMENT.liftHeightM - 1e-4);
assert.equal(started.memory.outcome, 'running');

const belowLift = commandFrom(ready({}, foot), sample(0.27, false), ranges, 0.002);
assert.equal(belowLift.memory.outcome, 'failed');
assert.equal(belowLift.memory.stage, 'done');
assert.equal(belowLift.memory.approach.reachable, false);
assert.match(belowLift.memory.reason, /lifted foot/);
assert.match(belowLift.memory.reason, /not moved/);
assert.equal(belowLift.memory.config.paperOriginX, 0.3);
assert.equal(belowLift.integrate, false);

const missed = commandFrom(
  ready({ paperOriginX: 1.2, paperOriginY: 0, paperOriginZ: 0 }, foot),
  sample(0.27, false),
  ranges,
  0.002,
);
assert.equal(missed.memory.outcome, 'failed');
assert.equal(missed.memory.stage, 'done');
assert.equal(missed.memory.approach.reachable, false);
assert.match(missed.memory.reason, /cannot reach/);
assert.match(missed.memory.reason, /not moved/);
assert.equal(missed.memory.config.paperOriginX, 1.2);
assert.equal(missed.integrate, false);

const examples = readFileSync('src/lib/sketches/examples.ts', 'utf8');
for (const id of ['simple-line', 'grid', 'concentric-circles', 'wave-lines', 'noise-field', 'polyline-composition', 'two-brush-lissajous']) {
  assert.match(examples, new RegExp(`id: '${id}'`));
}
assert.equal(readFileSync('public/models/go2/go2.xml', 'utf8').includes('name="floor"'), false);

const assets = {};
for (const file of readdirSync('public/models/go2/assets')) {
  if (!file.endsWith('.obj')) continue;
  assets[file] = new Uint8Array(readFileSync(`public/models/go2/assets/${file}`));
}
const session = await createPhysicsSession({
  xml: readFileSync('public/models/go2/go2.xml', 'utf8'),
  assets,
});
const home = session.reset();
const kinematic = footWorld(home, 'FL');
const simulated = home.feet.FL.frame;
const gap = Math.hypot(simulated[0] - kinematic[0], simulated[1] - kinematic[1], simulated[2] - kinematic[2]);
assert.ok(gap < 0.008, `foot frame gap ${gap}`);
const measured = brushWorld(home.feet.FL.frame, home.feet.FL.frameQuat, calibration).tip;
const added = [
  home.feet.FL.frame[0] + 0,
  home.feet.FL.frame[1] + 0,
  home.feet.FL.frame[2] - calibration.lengthM,
];
assert.ok(Math.hypot(measured[0] - added[0], measured[1] - added[1], measured[2] - added[2]) > 0.01);
session.dispose();

const target = clearanceTarget(paperFrom(DEFAULT_EXPERIMENT), 0.01);
assert.deepEqual(target, [0.3, 0, 0.01]);

function ready(patch, plantedFoot) {
  const memory = createMemory();
  memory.mode = 'brush-approach';
  memory.playback = 'playing';
  memory.outcome = 'running';
  memory.stage = 'lift';
  memory.stageTime = memory.config.liftSeconds;
  memory.config = { ...memory.config, ...patch };
  memory.criteria = { ...memory.criteria, stand: true, shift: true, lift: true };
  memory.planted = {
    body: [0, 0, 0.27],
    orientation: [1, 0, 0, 0],
    feet: { FL: plantedFoot, FR: plantedFoot, RL: plantedFoot, RR: plantedFoot },
    flClearanceM: 0,
    shift: [0, 0, 0],
  };
  return memory;
}

function sample(height, flDown) {
  const foot = {
    sphere: [0, 0, 0.01],
    clearanceM: flDown ? -0.012 : 0.02,
    onFloor: flDown,
    contact: flDown ? [0, 0, 0] : null,
    frame: [0.19, 0.14, 0.02],
    frameQuat: [1, 0, 0, 0],
  };
  const angles = [0, 0.9, -1.8];
  const still = [0, 0, 0];
  return {
    time: 0,
    basePosition: [0, 0, height],
    baseQuaternion: [1, 0, 0, 0],
    rollRad: 0,
    pitchRad: 0,
    joints: { FL: [...angles], FR: [...angles], RL: [...angles], RR: [...angles] },
    jointVelocity: { FL: [...still], FR: [...still], RL: [...still], RR: [...still] },
    contactCount: flDown ? 4 : 3,
    contacts: [],
    maxAbsTorqueNm: 0,
    effortNm: 0,
    torquesNm: [],
    saturated: false,
    feet: { FL: foot, FR: { ...foot, onFloor: true, clearanceM: -0.012 }, RL: foot, RR: foot },
    support: {
      feet: flDown ? ['FL', 'FR', 'RL', 'RR'] : ['FR', 'RL', 'RR'],
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
