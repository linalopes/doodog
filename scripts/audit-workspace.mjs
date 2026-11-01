/**
 * Brush-mount workspace: calibration, paper samples, shaft angle, classification,
 * search cancellation, baseline restoration, and creative-score checks.
 * The default mount and the MuJoCo experiment are not rewritten.
 */
import assert from 'node:assert/strict';
import { get } from 'svelte/store';
import { DEFAULT_BRUSH_CALIBRATION, brushQuaternion, brushTipInFoot } from '../src/lib/simulate/go2/brush.ts';
import { defaultSimConfig } from '../src/lib/simulate/go2/defaults.ts';
import { solveLeg } from '../src/lib/simulate/go2/kinematics.ts';
import { quatRotate, yawPoint } from '../src/lib/simulate/go2/math.ts';
import { BODY_POSITION } from '../src/lib/simulate/go2/model.ts';
import { simSettings } from '../src/lib/simulate/go2/settings.ts';
import { DEFAULT_EXPERIMENT } from '../src/lib/simulate/physics/settings.ts';
import {
  SEARCH_COLUMNS,
  classifyPaperPoint,
  defaultWorkspaceQuery,
  evaluateCreativeScore,
  loadExampleFrames,
  paperPoint,
  runSearch,
  samplePaperWorkspace,
  searchSpecs,
  searchStep,
  workspaceSnapshot,
} from '../src/lib/simulate/go2/workspace.ts';
import { applyCandidate, restoreBaseline, workspaceLab } from '../src/lib/simulate/go2/workspaceLab.ts';

const baselinePaper = defaultSimConfig().paper.origin.join(',');
const baselineOffset = defaultSimConfig().brushes.left.offset.join(',');
const baselineExperiment = DEFAULT_EXPERIMENT.brushMountXM;

const query = defaultWorkspaceQuery();
query.columns = 4;
const tip = brushTipInFoot(query.calibration);
assert.ok(Math.abs(tip[0] - 0.035) < 1e-9);
assert.ok(Math.abs(tip[1]) < 1e-9);
assert.ok(Math.abs(tip[2] + 0.045) < 1e-9);

const target = paperPoint(1, 1, 4, 4, query);
const yawed = { ...query, yawRad: Math.PI / 2, origin: [0.3, 0, 0] };
const localX = (0.5 - (0 + 0.5) / 4) * 0.2;
const localY = (0.5 - (1 + 0.5) / 4) * 0.2;
const turned = yawPoint(Math.PI / 2, [localX, localY, 0]);
const placed = paperPoint(1, 0, 4, 4, yawed);
assert.ok(Math.abs(placed[0] - (0.3 + turned[0])) < 1e-9);
assert.ok(Math.abs(placed[1] - turned[1]) < 1e-9);
assert.ok(Math.abs(placed[2]) < 1e-9);
assert.ok(placed[1] > 0.01);

const cell = classifyPaperPoint(target, query);
const body = [target[0] - BODY_POSITION[0], target[1] - BODY_POSITION[1], target[2] - BODY_POSITION[2]];
const solved = solveLeg('FL', body, tip);
const shaft = quatRotate(solved.footRotation, quatRotate(brushQuaternion(query.calibration), [0, 0, -1]));
const shaftLength = Math.hypot(shaft[0], shaft[1], shaft[2]);
assert.ok(cell.brushAxis);
assert.ok(Math.abs(cell.brushAxis[0] - shaft[0] / shaftLength) < 1e-6);
assert.ok(Math.abs(cell.brushAxis[1] - shaft[1] / shaftLength) < 1e-6);
assert.ok(Math.abs(cell.brushAxis[2] - shaft[2] / shaftLength) < 1e-6);
assert.equal(cell.mesh, 'not-evaluated');
assert.ok(!cell.reason.toLowerCase().includes('collision-free'));
assert.ok(cell.kind !== 'candidate' || cell.reason.includes('not a validated drawing pose'));

const zero = classifyPaperPoint(target, {
  ...query,
  calibration: { ...query.calibration, lengthM: 0 },
});
assert.notEqual(zero.kind, 'candidate');
assert.equal(zero.mesh, 'not-evaluated');
assert.equal(zero.brush, 'not-evaluated');

const missed = classifyPaperPoint([2, 2, 2], query);
assert.equal(missed.kind, 'unreachable');

const first = samplePaperWorkspace(query);
const second = samplePaperWorkspace(query);
assert.equal(first.examined, 16);
assert.equal(first.columns, 4);
assert.equal(first.rows, 4);
assert.equal(first.mesh, 'not-evaluated');
assert.equal(first.mujocoTested, false);
assert.equal(
  first.cells.map((item) => item.kind).join(','),
  second.cells.map((item) => item.kind).join(','),
);
for (const item of first.cells) {
  assert.equal(item.mesh, 'not-evaluated');
  assert.ok(['unreachable', 'posture-invalid', 'candidate', 'indeterminate'].includes(item.kind));
}

const snapshot = workspaceSnapshot(query, first);
assert.equal(snapshot.version, 1);
assert.equal(snapshot.paper.widthM, 0.2);
assert.equal(snapshot.paper.heightM, 0.2);
assert.equal(snapshot.mujocoTested, false);
assert.equal(snapshot.mesh, 'not-evaluated');

assert.equal(searchSpecs().length, 60);
assert.equal(SEARCH_COLUMNS, 5);
const signal = { cancelled: false };
const step = searchStep(0, 4, signal);
assert.notEqual(step, 'cancelled');
assert.notEqual(step, 'done');
signal.cancelled = true;
assert.equal(searchStep(1, 4, signal), 'cancelled');
const repeated = searchStep(0, 4);
assert.notEqual(repeated, 'cancelled');
assert.notEqual(repeated, 'done');
if (step !== 'cancelled' && step !== 'done' && repeated !== 'cancelled' && repeated !== 'done') {
  assert.equal(step.summary.candidate, repeated.summary.candidate);
  assert.equal(step.summary.largestRegion, repeated.summary.largestRegion);
  assert.equal(step.summary.examined, repeated.summary.examined);
}

const cancelled = runSearch({ maxSpecs: 3, columns: 4, signal: { cancelled: true } });
assert.equal(cancelled.cancelled, true);
assert.equal(cancelled.examined, 0);
assert.equal(cancelled.planned, 60);

const once = runSearch({ maxSpecs: 1, columns: 4 });
const twice = runSearch({ maxSpecs: 1, columns: 4 });
assert.equal(once.cancelled, false);
assert.equal(once.examined, 1);
assert.equal(once.candidates[0].summary.candidate, twice.candidates[0].summary.candidate);
assert.equal(once.candidates[0].summary.largestRegion, twice.candidates[0].summary.largestRegion);

const frames = [
  { time: 0, left: { x: 300, y: 300, contact: true } },
  { time: 0.5, left: { x: 300, y: 300, contact: false } },
  { time: 1, left: { x: 300, y: 300, contact: true } },
];
const score = evaluateCreativeScore('synthetic', frames, { width: 600, height: 600 }, query);
assert.equal(score.contactSamples, 2);
assert.equal(score.samples, 3);
assert.ok(score.positionPercent >= 0 && score.positionPercent <= 100);
assert.equal(score.completePath, score.candidates === 2 && score.indeterminate === 0);
assert.ok(score.rejections.length + score.candidates === 2);
const loaded = loadExampleFrames('simple-line', { width: 600, height: 600 }, 4);
assert.ok(loaded.length > 0);
const line = evaluateCreativeScore('simple-line', loaded, { width: 600, height: 600 }, query);
assert.equal(line.id, 'simple-line');
assert.ok(line.contactSamples > 0);

const candidate = once.candidates[0];
applyCandidate(candidate);
const applied = get(workspaceLab);
assert.equal(applied.preview, true);
assert.ok(Math.abs(applied.query.origin[0] - candidate.origin[0]) < 1e-9);
assert.ok(Math.abs(applied.query.calibration.pitchRad - candidate.calibration.pitchRad) < 1e-9);
assert.equal(get(simSettings).paper.origin.join(','), baselinePaper);
assert.equal(get(simSettings).brushes.left.offset.join(','), baselineOffset);
assert.equal(DEFAULT_EXPERIMENT.brushMountXM, baselineExperiment);
assert.equal(DEFAULT_BRUSH_CALIBRATION.mountOffset[0], 0.035);

restoreBaseline();
const restored = get(workspaceLab);
assert.equal(restored.preview, false);
assert.equal(restored.summary, null);
assert.ok(Math.abs(restored.query.origin[0] - 0.3) < 1e-9);
assert.ok(Math.abs(restored.query.calibration.mountOffset[0] - 0.035) < 1e-9);
assert.equal(restored.query.calibration.pitchRad, 0);
assert.equal(get(simSettings).paper.origin.join(','), baselinePaper);
assert.equal(get(simSettings).brushes.left.offset.join(','), baselineOffset);

console.log('workspace audit ok');
