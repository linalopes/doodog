/**
 * Ground-sheet Brush Approach diagnostics.
 * A refused move is not a measured tip, and a preflight residual is not tracking.
 */
import assert from 'node:assert/strict';
import { readFileSync, readdirSync } from 'node:fs';
import { auditApproach, describeHomeFoot, groundReferenceConfig, PROGRESSIVE_CLEARANCE_M } from '../src/lib/simulate/physics/approachAudit.ts';
import { advanceExperiment, begin, changeMode, createMemory } from '../src/lib/simulate/physics/experiment.ts';
import { createPhysicsSession } from '../src/lib/simulate/physics/session.ts';
import { DEFAULT_EXPERIMENT } from '../src/lib/simulate/physics/settings.ts';
import { brushWorld, calibrationFrom, solveTipTarget, TIP_SOLVE_PASSES } from '../src/lib/simulate/go2/brush.ts';
import { REFERENCE_ANGLES } from '../src/lib/simulate/go2/model.ts';

const reference = groundReferenceConfig(DEFAULT_EXPERIMENT);
assert.equal(reference.mountProfile, 'ground');
assert.equal(reference.boardThicknessM, 0);
assert.equal(reference.paperOriginZ, 0);
assert.equal(reference.paperWidthM, 0.2);
assert.equal(reference.paperHeightM, 0.2);
assert.equal(reference.paperOriginX, 0.16);
assert.equal(reference.paperOriginY, 0.14);
assert.equal(reference.brushLengthM, 0.12);
assert.equal(reference.brushMountXM, 0.05);
assert.equal(reference.brushMountZM, -0.015);
assert.equal(reference.brushRollRad, 0);
assert.equal(reference.brushYawRad, 0);
assert.ok(Math.abs(reference.brushPitchRad - (15 * Math.PI) / 180) < 1e-12);
assert.equal(reference.returnStyle, 'gradual');
assert.deepEqual([...PROGRESSIVE_CLEARANCE_M], [0.03, 0.02, 0.01]);

const xml = readFileSync('public/models/go2/go2.xml', 'utf8');
assert.match(xml, /qpos="0 0 0\.27 1 0 0 0 0 0\.9 -1\.8/);
assert.equal(xml.includes('paper_platform'), false);
const assets = {};
for (const file of readdirSync('public/models/go2/assets')) {
  if (!file.endsWith('.obj')) continue;
  assets[file] = new Uint8Array(readFileSync(`public/models/go2/assets/${file}`));
}

const session = await createPhysicsSession({ xml, assets, platform: null });
const home = session.reset();
const again = session.reset();
assert.deepEqual(again.feet.FL.sphere, home.feet.FL.sphere);
assert.equal(again.time, home.time);
const penetration = describeHomeFoot(home);
assert.equal(penetration.onHomeKeyframe, true);
assert.equal(penetration.sphereMatchesMujoco, true);
assert.equal(penetration.contactMatchesClearance, true);
assert.ok(penetration.kinematicClearanceM < -0.018 && penetration.kinematicClearanceM > -0.019);
assert.ok(penetration.kinematicFrame[2] > 0);
assert.equal(penetration.mesh, 'not-evaluated');
assert.match(penetration.conclusion, /collision sphere/);
assert.match(penetration.conclusion, /not a frame mismatch/);

async function runClearance(clearanceM) {
  const config = { ...reference, brushClearanceM: clearanceM };
  session.reset();
  let memory = begin(changeMode(createMemory(config), 'brush-approach'), session.sample());
  assert.notEqual(memory.outcome, 'failed');
  const result = advanceExperiment(session, memory, 8000);
  memory = result.memory;
  return { memory, snapshot: result.snapshot };
}

const ten = await runClearance(0.01);
assert.equal(ten.memory.outcome, 'failed');
assert.equal(ten.memory.stage, 'done');
assert.equal(ten.memory.criteria.stand, true);
assert.equal(ten.memory.criteria.shift, true);
assert.equal(ten.memory.criteria.lift, true);
assert.equal(ten.memory.criteria.approach, false);
assert.match(ten.memory.reason, /geometric gap is 9\.0 mm/);
assert.match(ten.memory.reason, /was not jumped/);
assert.ok(Math.abs(ten.memory.elapsed - 5) < 0.05);
assert.equal(ten.memory.approach.approachCommanded, false);
assert.equal(ten.memory.approach.tipSamples, 0);
const preflight = ten.memory.approach.preflight;
assert.ok(preflight);
assert.equal(preflight.classification, 'solver-nonconvergence');
assert.equal(preflight.passesToGate, 6);
assert.ok(preflight.passResidualM[4] > 0.005);
assert.ok(preflight.passResidualM[5] <= 0.005);
assert.equal(preflight.firstFailure, 'Tip residual after 5 passes');
const gateStatus = Object.fromEntries(preflight.gates.map((gate) => [gate.id, gate.status]));
assert.equal(gateStatus['tip-residual'], 'failed');
assert.equal(gateStatus['foot-path'], 'passed');
assert.equal(gateStatus['foot-height'], 'passed');
assert.equal(gateStatus.board, 'passed');
assert.equal(gateStatus.jacobian, 'not-evaluated');
assert.equal(gateStatus.mesh, 'not-evaluated');
assert.equal(gateStatus.tracking, 'not-evaluated');
assert.equal(preflight.physicalTracking, 'not-evaluated');
assert.equal(preflight.mesh, 'not-evaluated');
assert.equal(preflight.passesToGate > TIP_SOLVE_PASSES || preflight.jacobianResidualM < 0.005, true);
assert.ok(preflight.jacobianResidualM < 0.001);
assert.equal(preflight.firstRejectedSample, null);
assert.ok(preflight.path.every((sample) => sample.ik === 'passed' && sample.calf === 'not-evaluated' && sample.mesh === 'not-evaluated'));
assert.equal(preflight.path.length, 7);
assert.ok(Math.abs(preflight.passResidualM[TIP_SOLVE_PASSES - 1] - preflight.tipResidualM) < 1e-6);
const solved = solveTipTarget(
  [
    ten.memory.planted.body[0] + ten.memory.planted.shift[0],
    ten.memory.planted.body[1] + ten.memory.planted.shift[1],
    ten.memory.planted.body[2],
  ],
  ten.memory.planted.orientation,
  preflight.requestedTip,
  calibrationFrom(reference),
  ten.snapshot.joints.FL,
);
assert.ok(Math.abs(solved.errorM - preflight.tipResidualM) < 1e-9);
const predicted = brushWorld(preflight.predictedFoot, preflight.footQuat, calibrationFrom(reference));
assert.ok(Math.hypot(
  predicted.tip[0] - preflight.predictedTip[0],
  predicted.tip[1] - preflight.predictedTip[1],
  predicted.tip[2] - preflight.predictedTip[2],
) < 1e-9);
const footGap = Math.hypot(
  preflight.predictedFoot[0] - preflight.requestedTip[0],
  preflight.predictedFoot[1] - preflight.requestedTip[1],
  preflight.predictedFoot[2] - preflight.requestedTip[2],
);
assert.ok(Math.abs(footGap - preflight.tipResidualM) > 0.01);
const repeated = auditApproach({
  config: { ...reference, brushClearanceM: 0.01 },
  body: [
    ten.memory.planted.body[0] + ten.memory.planted.shift[0],
    ten.memory.planted.body[1] + ten.memory.planted.shift[1],
    ten.memory.planted.body[2],
  ],
  orientation: ten.memory.planted.orientation,
  liftFoot: ten.memory.approach.liftFoot,
  seed: ten.snapshot.joints.FL,
  supportReady: true,
});
const repeatedAgain = auditApproach({
  config: { ...reference, brushClearanceM: 0.01 },
  body: [
    ten.memory.planted.body[0] + ten.memory.planted.shift[0],
    ten.memory.planted.body[1] + ten.memory.planted.shift[1],
    ten.memory.planted.body[2],
  ],
  orientation: ten.memory.planted.orientation,
  liftFoot: ten.memory.approach.liftFoot,
  seed: ten.snapshot.joints.FL,
  supportReady: true,
});
assert.equal(repeated.tipResidualM, repeatedAgain.tipResidualM);
assert.equal(repeated.classification, repeatedAgain.classification);
assert.equal(repeated.firstRejectedSample, repeatedAgain.firstRejectedSample);

const fromReference = auditApproach({
  config: { ...reference, brushClearanceM: 0.01 },
  body: [
    ten.memory.planted.body[0] + ten.memory.planted.shift[0],
    ten.memory.planted.body[1] + ten.memory.planted.shift[1],
    ten.memory.planted.body[2],
  ],
  orientation: ten.memory.planted.orientation,
  liftFoot: ten.memory.approach.liftFoot,
  seed: REFERENCE_ANGLES,
  supportReady: true,
});
assert.equal(fromReference.classification, 'accepted');
assert.ok(fromReference.tipResidualM <= 0.005);

const reports = [ten];
for (const clearance of [0.03, 0.02]) {
  reports.push(await runClearance(clearance));
}
for (const report of reports) {
  assert.equal(report.memory.approach.preflight.classification, 'solver-nonconvergence');
  assert.equal(report.memory.approach.approachCommanded, false);
  assert.equal(report.memory.approach.tipSamples, 0);
  assert.notEqual(report.memory.outcome, 'completed');
}

console.log(JSON.stringify({
  homeClearanceMm: Number((penetration.kinematicClearanceM * 1000).toFixed(1)),
  homeFrameMm: Number((penetration.kinematicFrame[2] * 1000).toFixed(1)),
  homeSphereMm: penetration.kinematicSphere.map((value) => Number((value * 1000).toFixed(1))),
  contactMm: Number((penetration.contactDistanceM * 1000).toFixed(1)),
  referenceSeed: {
    residualMm: Number((fromReference.tipResidualM * 1000).toFixed(2)),
    classification: fromReference.classification,
    passesToGate: fromReference.passesToGate,
  },
  trials: reports.map((report) => {
    const item = report.memory.approach.preflight;
    return {
      clearanceMm: report.memory.config.brushClearanceM * 1000,
      outcome: report.memory.outcome,
      reason: report.memory.reason,
      time: Number(report.snapshot.time.toFixed(3)),
      commanded: report.memory.approach.approachCommanded,
      tipSamples: report.memory.approach.tipSamples,
      liftTipMm: report.memory.approach.measuredTip
        ? report.memory.approach.measuredTip.map((value) => Number((value * 1000).toFixed(1)))
        : null,
      classification: item.classification,
      firstFailure: item.firstFailure,
      tipResidualMm: Number((item.tipResidualM * 1000).toFixed(2)),
      passResidualsMm: item.passResidualM.slice(0, 8).map((value) => Number((value * 1000).toFixed(2))),
      passesToGate: item.passesToGate,
      jacobianMm: Number((item.jacobianResidualM * 1000).toFixed(3)),
      jacobianOnLimit: item.jacobianOnLimit,
      predictedTipMm: item.predictedTip.map((value) => Number(value.toFixed(4))),
      predictedFootMm: item.predictedFoot.map((value) => Number((value * 1000).toFixed(1))),
      sphereClearanceMm: Number((item.footClearanceM * 1000).toFixed(1)),
      brushAngleDeg: Number(item.brushAngleDeg.toFixed(1)),
      jointMarginDeg: item.jointMarginDeg.map((value) => Number(value.toFixed(1))),
      pathSamples: item.path.length,
      firstRejected: item.firstRejectedSample,
      body: {
        z: Number(report.snapshot.basePosition[2].toFixed(3)),
        rollDeg: Number(((report.snapshot.rollRad * 180) / Math.PI).toFixed(1)),
        pitchDeg: Number(((report.snapshot.pitchRad * 180) / Math.PI).toFixed(1)),
      },
      supportMarginMm: Number(((report.snapshot.support.threeLegMarginM ?? 0) * 1000).toFixed(1)),
      peakTorqueNm: Number(report.memory.peaks.maxTorqueNm.toFixed(1)),
      saturated: report.memory.peaks.saturated,
      minMarginMm: Number(((report.memory.peaks.minThreeLegMarginM ?? 0) * 1000).toFixed(1)),
      returnedToFourLegs: false,
    };
  }),
}, null, 2));
session.dispose();
