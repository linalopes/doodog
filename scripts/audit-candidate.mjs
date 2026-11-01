/**
 * Candidate A geometry and one MuJoCo attempt.
 * A finished schedule is not a success. This file prints the measured outcome.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { brushWorld } from '../src/lib/simulate/go2/brush.ts';
import {
  AERIAL_RADIUS_M,
  CANDIDATE_A_NAME,
  PLATFORM_THICKNESS_M,
  aerialTip,
  applyMountProfile,
  platformSpec,
  sphereHitsPlatform,
  validateCandidatePose,
} from '../src/lib/simulate/physics/candidate.ts';
import {
  begin,
  changeMode,
  createMemory,
} from '../src/lib/simulate/physics/experiment.ts';
import { go2FloorSceneXml } from '../src/lib/simulate/physics/scene.ts';
import { createPhysicsSession } from '../src/lib/simulate/physics/session.ts';
import { DEFAULT_EXPERIMENT, FOOT_RADIUS_M } from '../src/lib/simulate/physics/settings.ts';

assert.equal(CANDIDATE_A_NAME, 'Candidate A — Elevated Sheet / 45° Brush');
assert.equal(DEFAULT_EXPERIMENT.mountProfile, 'baseline');
assert.equal(DEFAULT_EXPERIMENT.brushPitchRad, 0);
assert.equal(DEFAULT_EXPERIMENT.paperOriginX, 0.3);
assert.equal(DEFAULT_EXPERIMENT.paperOriginZ, 0);
assert.equal(DEFAULT_EXPERIMENT.returnStyle, 'baseline');
assert.equal(DEFAULT_EXPERIMENT.brushClearanceM, 0.01);

const candidate = applyMountProfile({ ...DEFAULT_EXPERIMENT, gainScale: 1.2 }, 'candidate-a');
assert.equal(candidate.gainScale, 1.2);
assert.equal(candidate.mountProfile, 'candidate-a');
assert.equal(candidate.brushMountXM, 0.035);
assert.equal(candidate.brushMountYM, 0);
assert.equal(candidate.brushMountZM, 0);
assert.equal(candidate.brushLengthM, 0.045);
assert.ok(Math.abs(candidate.brushPitchRad - (45 * Math.PI) / 180) < 1e-12);
assert.equal(candidate.brushRollRad, 0);
assert.equal(candidate.brushYawRad, 0);
assert.equal(candidate.paperOriginX, 0.2);
assert.equal(candidate.paperOriginY, 0.08);
assert.equal(candidate.paperOriginZ, 0.06);
assert.equal(candidate.paperYawRad, 0);
assert.equal(candidate.paperWidthM, 0.2);
assert.equal(candidate.paperHeightM, 0.2);
assert.equal(candidate.returnStyle, 'gradual');
assert.equal(candidate.platformThicknessM, PLATFORM_THICKNESS_M);
assert.equal(candidate.brushClearanceM, 0.01);
assert.equal(candidate.gestureRadiusM, AERIAL_RADIUS_M);

const restored = applyMountProfile(candidate, 'baseline');
assert.equal(restored.mountProfile, 'baseline');
assert.equal(restored.paperOriginX, 0.3);
assert.equal(restored.paperOriginZ, 0);
assert.equal(restored.brushPitchRad, 0);
assert.equal(restored.returnStyle, 'baseline');
assert.equal(restored.gainScale, 1.2);

const spec = platformSpec(candidate);
assert.ok(spec);
assert.ok(Math.abs(spec.topZ - 0.06) < 1e-12);
assert.ok(Math.abs(spec.bottomZ - 0.04) < 1e-12);
assert.ok(Math.abs(spec.center[2] - 0.05) < 1e-12);
assert.deepEqual(spec.half, [0.1, 0.1, 0.01]);
assert.equal(platformSpec(DEFAULT_EXPERIMENT), null);
assert.equal(sphereHitsPlatform([0.2, 0.08, 0.01], FOOT_RADIUS_M, spec), false);
assert.equal(sphereHitsPlatform([0.2, 0.08, 0.05], FOOT_RADIUS_M, spec), true);
assert.equal(sphereHitsPlatform([-0.2, -0.14, 0.05], FOOT_RADIUS_M, spec), false);

const plain = go2FloorSceneXml();
assert.match(plain, /include file="go2.xml"/);
assert.match(plain, /name="floor"/);
assert.equal(plain.includes('paper_platform'), false);
const wrapped = go2FloorSceneXml({ center: spec.center, half: spec.half });
assert.match(wrapped, /name="paper_platform"/);
assert.match(wrapped, /name="floor"/);
assert.match(wrapped, /include file="go2.xml"/);
const vendor = readFileSync('public/models/go2/go2.xml', 'utf8');
assert.equal(vendor.includes('paper_platform'), false);
assert.equal(vendor.includes('name="floor"'), false);

const start = aerialTip(candidate, 0);
const end = aerialTip(candidate, 1);
assert.ok(Math.hypot(start[0] - 0.2, start[1] - 0.08, start[2] - 0.07) < 1e-12);
assert.ok(Math.hypot(end[0] - start[0], end[1] - start[1], end[2] - start[2]) < 1e-12);
let farthest = 0;
for (let step = 0; step <= 32; step += 1) {
  const point = aerialTip(candidate, step / 32);
  farthest = Math.max(farthest, Math.hypot(point[0] - 0.2, point[1] - 0.08));
  assert.ok(Math.abs(point[2] - 0.07) < 1e-12);
}
assert.ok(farthest <= AERIAL_RADIUS_M + 1e-9);
assert.ok(farthest > AERIAL_RADIUS_M * 0.9);

const xml = readFileSync('public/models/go2/go2.xml', 'utf8');
const assets = {};
for (const file of readdirSync('public/models/go2/assets')) {
  if (!file.endsWith('.obj')) continue;
  assets[file] = new Uint8Array(readFileSync(`public/models/go2/assets/${file}`));
}
const session = await createPhysicsSession({
  xml,
  assets,
  platform: { center: spec.center, half: spec.half },
});
const home = session.reset();
const report = validateCandidatePose(home, candidate);
console.log(JSON.stringify({
  initOk: report.ok,
  initReason: report.reason,
  fl: home.feet.FL.sphere,
  fr: home.feet.FR.sphere,
  rl: home.feet.RL.sphere,
  rr: home.feet.RR.sphere,
  flOnFloor: home.feet.FL.onFloor,
  supportOnFloor: {
    FR: home.feet.FR.onFloor,
    RL: home.feet.RL.onFloor,
    RR: home.feet.RR.onFloor,
  },
  platformContacts: home.platformContactCount,
  contacts: home.contacts,
  tip: report.tip,
  angleDeg: report.angleDeg,
}, null, 2));
assert.equal(report.ok, false);
assert.match(report.reason, /FL_calf/);
assert.match(report.reason, /was not started/);
assert.equal(home.platformContactCount, 1);
assert.equal(home.feet.FL.onPlatform, false);
assert.equal(home.feet.FR.onPlatform, false);
assert.equal(home.feet.RL.onPlatform, false);
assert.equal(home.feet.RR.onPlatform, false);
assert.ok(home.feet.FR.onFloor && home.feet.RL.onFloor && home.feet.RR.onFloor);

let memory = changeMode(createMemory(candidate), 'brush-approach');
memory = begin(memory, home);
assert.equal(memory.outcome, 'failed');
assert.equal(memory.stage, 'done');
assert.equal(memory.playback, 'paused');
assert.match(memory.reason, /FL_calf/);
assert.match(memory.reason, /not jumped/);
const after = session.sample();
assert.equal(after.time, home.time);
console.log(JSON.stringify({
  outcome: memory.outcome,
  stage: memory.stage,
  reason: memory.reason,
  aerialStarted: false,
}, null, 2));
session.dispose();

const baseline = await createPhysicsSession({ xml, assets });
const baselineHome = baseline.reset();
assert.equal(baselineHome.platformContactCount, 0);
assert.equal(baselineHome.feet.FL.onPlatform, false);
const baselineBrush = changeMode(createMemory(DEFAULT_EXPERIMENT), 'brush-approach');
const baselineBegun = begin(baselineBrush, baselineHome);
assert.equal(baselineBegun.stage, 'stand');
assert.equal(baselineBegun.config.paperOriginX, 0.3);
assert.equal(baselineBegun.config.returnStyle, 'baseline');
baseline.dispose();
