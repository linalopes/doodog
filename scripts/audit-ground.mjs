/**
 * Ground sheet geometry, a finite mount search, and MuJoCo initialization.
 * A refused experiment is not reported as a completed approach.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { coarseGroundQueries, runGroundStudy, solveGroundQuery } from '../src/lib/simulate/go2/ground.ts';
import {
  GROUND_SHEET_NAME,
  applyGroundCandidate,
  applyMountProfile,
  boardSpec,
  collisionSpec,
  platformSpec,
  setBoardThickness,
  validateGroundPose,
} from '../src/lib/simulate/physics/candidate.ts';
import { advanceExperiment, begin, changeMode, createMemory } from '../src/lib/simulate/physics/experiment.ts';
import { go2FloorSceneXml } from '../src/lib/simulate/physics/scene.ts';
import { createPhysicsSession } from '../src/lib/simulate/physics/session.ts';
import { DEFAULT_EXPERIMENT } from '../src/lib/simulate/physics/settings.ts';

assert.equal(GROUND_SHEET_NAME, 'Ground Sheet / Low Clipboard');
assert.equal(DEFAULT_EXPERIMENT.mountProfile, 'baseline');
assert.equal(DEFAULT_EXPERIMENT.boardThicknessM, 0);
assert.equal(DEFAULT_EXPERIMENT.brushMountXM, 0.035);
assert.equal(DEFAULT_EXPERIMENT.brushPitchRad, 0);

const ground = applyMountProfile({ ...DEFAULT_EXPERIMENT, gainScale: 1.2 }, 'ground');
assert.equal(ground.mountProfile, 'ground');
assert.equal(ground.gainScale, 1.2);
assert.equal(ground.brushMountXM, 0.035);
assert.equal(ground.brushPitchRad, 0);
assert.equal(ground.brushLengthM, 0.045);
assert.equal(ground.paperOriginX, 0.3);
assert.equal(ground.paperOriginY, 0);
assert.equal(ground.paperOriginZ, 0);
assert.equal(ground.paperWidthM, 0.2);
assert.equal(ground.paperHeightM, 0.2);
assert.equal(ground.boardThicknessM, 0);
assert.equal(ground.returnStyle, 'gradual');
assert.equal(ground.brushClearanceM, 0.01);
assert.equal(boardSpec(ground), null);
assert.equal(collisionSpec(ground), null);
assert.equal(go2FloorSceneXml(null).includes('paper_platform'), false);

const thin = setBoardThickness(ground, 0.005);
assert.equal(thin.paperOriginZ, 0.005);
assert.equal(thin.boardThicknessM, 0.005);
const five = boardSpec(thin);
assert.ok(five);
assert.ok(Math.abs(five.topZ - 0.005) < 1e-12);
assert.ok(Math.abs(five.bottomZ - 0) < 1e-12);
assert.ok(Math.abs(five.center[2] - 0.0025) < 1e-12);
assert.ok(Math.abs(five.half[2] - 0.0025) < 1e-12);
assert.deepEqual([five.half[0], five.half[1]], [0.1, 0.1]);
const three = boardSpec(setBoardThickness(ground, 0.003));
const eight = boardSpec(setBoardThickness(ground, 0.008));
assert.ok(three && Math.abs(three.topZ - 0.003) < 1e-12 && Math.abs(three.bottomZ) < 1e-12);
assert.ok(eight && Math.abs(eight.topZ - 0.008) < 1e-12 && Math.abs(eight.center[2] - 0.004) < 1e-12);
const capped = setBoardThickness(ground, 0.02);
assert.equal(capped.boardThicknessM, 0.01);
assert.equal(capped.paperOriginZ, 0.01);

const wrapped = go2FloorSceneXml({ center: five.center, half: five.half });
assert.match(wrapped, /name="paper_platform"/);
assert.match(wrapped, /name="floor"/);
assert.match(wrapped, /include file="go2.xml"/);
const vendor = readFileSync('public/models/go2/go2.xml', 'utf8');
assert.equal(vendor.includes('paper_platform'), false);

const candidate = applyMountProfile(ground, 'candidate-a');
assert.equal(candidate.mountProfile, 'candidate-a');
assert.ok(platformSpec(candidate));
assert.equal(boardSpec(candidate), null);
const restored = applyMountProfile(candidate, 'baseline');
assert.equal(restored.mountProfile, 'baseline');
assert.equal(restored.paperOriginZ, 0);
assert.equal(restored.returnStyle, 'baseline');
assert.equal(restored.brushPitchRad, 0);

const queries = coarseGroundQueries();
assert.equal(queries.length, 108);
assert.ok(queries.every((query) => query.origin[2] === query.boardThicknessM));
assert.ok(queries.some((query) => query.boardThicknessM === 0));
assert.ok(queries.some((query) => query.boardThicknessM === 0.008));
const once = solveGroundQuery(queries[0]);
const twice = solveGroundQuery(queries[0]);
assert.equal(once.summary.candidate, twice.summary.candidate);
assert.equal(once.summary.largestRegion, twice.summary.largestRegion);
assert.equal(once.summary.mesh, 'not-evaluated');
assert.equal(once.summary.mujocoTested, false);

const study = runGroundStudy();
assert.equal(study.cancelled, false);
assert.equal(study.coarsePlanned, 108);
assert.ok(study.refinedPlanned > 0);
assert.equal(study.candidates.length, study.coarsePlanned + study.refinedPlanned);
const again = runGroundStudy();
assert.equal(again.candidates[0].summary.largestRegion, study.candidates[0].summary.largestRegion);
assert.equal(again.candidates[0].origin[0], study.candidates[0].origin[0]);
assert.equal(again.candidates[0].calibration.lengthM, study.candidates[0].calibration.lengthM);
const leader = study.candidates.find((item) => item.homeBoardClear !== false && item.summary.largestRegion > 0) ?? study.candidates[0];
assert.equal(leader.homeBoardClear, true);
console.log(JSON.stringify({
  coarse: study.coarsePlanned,
  refined: study.refinedPlanned,
  evaluated: study.candidates.length,
  leader: {
    thicknessMm: (leader.boardThicknessM ?? 0) * 1000,
    originMm: leader.origin.map((value) => Math.round(value * 1000)),
    lengthMm: Math.round(leader.calibration.lengthM * 1000),
    pitchDeg: Math.round((leader.calibration.pitchRad * 180) / Math.PI),
    rollDeg: Math.round((leader.calibration.rollRad * 180) / Math.PI),
    mountMm: leader.calibration.mountOffset.map((value) => Math.round(value * 1000)),
    candidates: leader.summary.candidate,
    examined: leader.summary.examined,
    region: leader.summary.largestRegion,
    clearanceMm: leader.summary.minCandidateClearanceM === null ? null : Number((leader.summary.minCandidateClearanceM * 1000).toFixed(1)),
    angle: leader.summary.candidateAngle,
    mesh: leader.summary.mesh,
  },
  top: study.candidates.slice(0, 3).map((item) => ({
    thicknessMm: (item.boardThicknessM ?? 0) * 1000,
    originMm: item.origin.map((value) => Math.round(value * 1000)),
    lengthMm: Math.round(item.calibration.lengthM * 1000),
    pitchDeg: Math.round((item.calibration.pitchRad * 180) / Math.PI),
    region: item.summary.largestRegion,
    candidates: item.summary.candidate,
  })),
}, null, 2));

const xml = readFileSync('public/models/go2/go2.xml', 'utf8');
const assets = {};
for (const file of readdirSync('public/models/go2/assets')) {
  if (!file.endsWith('.obj')) continue;
  assets[file] = new Uint8Array(readFileSync(`public/models/go2/assets/${file}`));
}

async function init(config) {
  const spec = collisionSpec(config);
  const session = await createPhysicsSession({
    xml,
    assets,
    platform: spec ? { center: spec.center, half: spec.half } : null,
  });
  const home = session.reset();
  const report = validateGroundPose(home, config);
  return { session, home, report };
}

const sheet = await init(ground);
assert.equal(sheet.report.ok, true);
assert.match(sheet.report.reason, /no collision board/);
assert.match(sheet.report.reason, /pre-existing/);
assert.equal(sheet.home.platformContactCount, 0);
const sheetBegun = begin(changeMode(createMemory(ground), 'brush-approach'), sheet.home);
assert.equal(sheetBegun.stage, 'stand');
assert.notEqual(sheetBegun.outcome, 'failed');
sheet.session.dispose();

const board = await init(thin);
console.log(JSON.stringify({
  fiveMm: {
    ok: board.report.ok,
    reason: board.report.reason,
    platformContacts: board.home.platformContactCount,
    flClearanceMm: Number((board.home.feet.FL.clearanceM * 1000).toFixed(1)),
  },
}, null, 2));
board.session.dispose();

const underFoot = setBoardThickness(ground, 0.005);
underFoot.paperOriginX = 0.19;
underFoot.paperOriginY = 0.14;
const blocked = await init(underFoot);
assert.equal(blocked.report.ok, false);
assert.match(blocked.report.reason, /was not started/);
assert.match(blocked.report.reason, /not jumped/);
const refused = begin(changeMode(createMemory(underFoot), 'brush-approach'), blocked.home);
assert.equal(refused.outcome, 'failed');
assert.equal(refused.stage, 'done');
assert.equal(blocked.session.sample().time, blocked.home.time);
blocked.session.dispose();

const loaded = applyGroundCandidate(DEFAULT_EXPERIMENT, leader);
assert.equal(loaded.paperWidthM, 0.2);
assert.equal(loaded.paperOriginZ, loaded.boardThicknessM);
const leaderInit = await init(loaded);
console.log(JSON.stringify({
  leaderInit: {
    ok: leaderInit.report.ok,
    reason: leaderInit.report.reason,
    platformContacts: leaderInit.home.platformContactCount,
    tip: leaderInit.report.tip,
  },
}, null, 2));

async function attemptApproach(config, label) {
  const started = await init(config);
  if (!started.report.ok) {
    started.session.dispose();
    return { label, outcome: 'refused', executed: false, reason: started.report.reason };
  }
  let memory = begin(changeMode(createMemory(config), 'brush-approach'), started.home);
  if (memory.outcome === 'failed') {
    const refusedRun = { label, outcome: memory.outcome, stage: memory.stage, reason: memory.reason, executed: false };
    started.session.dispose();
    return refusedRun;
  }
  const result = advanceExperiment(started.session, memory, 8000);
  memory = result.memory;
  const report = {
    label,
    outcome: memory.outcome,
    stage: memory.stage,
    reason: memory.reason,
    executed: true,
    time: result.snapshot.time,
  };
  started.session.dispose();
  return report;
}

const defaultAttempt = await attemptApproach(ground, 'ground-0mm');
const fiveAttempt = await attemptApproach(thin, 'board-5mm');
console.log(JSON.stringify({ defaultAttempt, fiveAttempt }, null, 2));

let approach = null;
let aerial = null;
if (leaderInit.report.ok) {
  let memory = begin(changeMode(createMemory(loaded), 'brush-approach'), leaderInit.home);
  if (memory.outcome === 'failed') {
    approach = { outcome: memory.outcome, stage: memory.stage, reason: memory.reason, executed: false };
  } else {
    let result = advanceExperiment(leaderInit.session, memory, 8000);
    memory = result.memory;
    approach = {
      outcome: memory.outcome,
      stage: memory.stage,
      reason: memory.reason,
      executed: true,
      tipError: memory.approach?.tipErrorM ?? null,
      time: result.snapshot.time,
    };
    if (memory.outcome === 'completed') {
      let gesture = begin(changeMode(createMemory(loaded), 'aerial-gesture'), result.snapshot);
      if (gesture.outcome !== 'failed') {
        const moved = advanceExperiment(leaderInit.session, gesture, 4000);
        gesture = moved.memory;
        aerial = {
          outcome: gesture.outcome,
          stage: gesture.stage,
          reason: gesture.reason,
          executed: true,
        };
      } else {
        aerial = { outcome: gesture.outcome, reason: gesture.reason, executed: false };
      }
    }
  }
} else {
  approach = { outcome: 'refused', executed: false, reason: leaderInit.report.reason };
}
console.log(JSON.stringify({ approach, aerial }, null, 2));
leaderInit.session.dispose();
