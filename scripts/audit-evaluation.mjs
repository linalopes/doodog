/**
 * Controller-evaluation measurements. No browser and no sketch source.
 * A negative three-leg margin is classified, not treated as a fall.
 */

import assert from 'node:assert/strict';
import { buildScoreBuffer, planScoreTimes, sampleScore } from '../src/lib/simulate/physics/score.ts';
import { assessSupport } from '../src/lib/simulate/physics/support.ts';
import {
  canKeepBaseline,
  classifyReturn,
  errorStats,
  estimateLag,
  maxSagitta,
  noteEvaluation,
  sameExecution,
  summarizeEvaluation,
} from '../src/lib/simulate/physics/evaluation.ts';
import { begin, createMemory, stop, viewOf } from '../src/lib/simulate/physics/experiment.ts';
import { DEFAULT_EXPERIMENT } from '../src/lib/simulate/physics/settings.ts';

function point(partial) {
  const desired = partial.desired ?? [0, 0, 0];
  const measured = partial.measured ?? [0, 0, 0];
  return {
    t: partial.t,
    stage: partial.stage,
    desired: [desired[0], desired[1], desired[2]],
    measured: [measured[0], measured[1], measured[2]],
    body: partial.body ?? [0, 0, 0.27],
    roll: partial.roll ?? 0,
    pitch: partial.pitch ?? 0,
    torque: partial.torque ?? 0,
    saturated: partial.saturated ?? false,
    margin3: partial.margin3 ?? 0.07,
    margin4: partial.margin4 ?? 0.1,
    supportCount: partial.supportCount ?? 3,
    supportLost: partial.supportLost ?? false,
    flDown: partial.flDown ?? false,
    commanded: partial.commanded ?? true,
    jointDesired: null,
    jointMeasured: null,
  };
}

const straight = Array.from({ length: 8 }, (_, index) => {
  const t = index * 0.05;
  return point({
    t,
    stage: 'track',
    desired: [t, 0, 0.04],
    measured: [t - 0.004, 0.001, 0.038],
  });
});

const stats = errorStats(straight);
assert.equal(stats.samples, 8);
assert.ok(Math.abs(stats.mean[0] + 0.004) < 1e-9);
assert.ok(Math.abs(stats.mean[1] - 0.001) < 1e-9);
assert.ok(Math.abs(stats.mean[2] + 0.002) < 1e-9);
assert.ok(Math.abs(stats.maxM - Math.hypot(0.004, 0.001, 0.002)) < 1e-9);
assert.ok(stats.rmsM !== null && Math.abs(stats.rmsM - stats.maxM) < 1e-9);

const delayed = Array.from({ length: 12 }, (_, index) => {
  const t = index * 0.02;
  return point({
    t,
    stage: 'draw',
    desired: [t, 0, 0],
    measured: [Math.max(0, t - 0.04), 0, 0],
  });
});
const lag = estimateLag(delayed);
assert.ok(lag);
assert.ok(Math.abs(lag.lagS - 0.04) < 1e-9, `lag ${lag.lagS}`);
assert.ok(lag.residualRmsM < lag.rawRmsM);

const offsetOnly = Array.from({ length: 8 }, (_, index) =>
  point({
    t: index * 0.05,
    stage: 'track',
    desired: [index * 0.01, 0, 0],
    measured: [index * 0.01 + 0.003, 0, 0],
  }),
);
const still = estimateLag(offsetOnly);
assert.ok(still);
assert.equal(still.lagS, 0);
assert.ok(Math.abs(still.offset[0] - 0.003) < 1e-9);
assert.ok(still.residualRmsM < 1e-9);

const plan = planScoreTimes({ durationSeconds: 1, windowSeconds: 8, interval: 0.25 });
const built = buildScoreBuffer({
  version: 1,
  runId: 'eval',
  revision: 3,
  channel: 'left',
  sketchName: 'Line',
  canvasWidth: 600,
  canvasHeight: 600,
  gestureSizeM: 0.02,
  plan,
  points: [
    { time: 0, x: 100, y: 100, contact: true },
    { time: 0.25, x: 140, y: 100, contact: true },
    { time: 0.5, x: 180, y: 100, contact: false },
    { time: 0.75, x: 700, y: 100, contact: true },
  ],
  paramSnapshot: { speed: 140, brush: 'left' },
});
assert.ok(!('error' in built));
if ('error' in built) throw new Error('buffer');
const mid = sampleScore(built, 0.125);
assert.ok(Math.abs(mid.x - 120) < 1e-9);
assert.equal(mid.contact, true);
const jump = sampleScore(built, 0.6);
assert.ok(Math.abs(jump.x - 180) < 1e-9);
assert.equal(jump.held, true);
assert.equal(jump.contact, false);
assert.ok((maxSagitta([[0, 0, 0], [1, 1, 0], [2, 0, 0]]) ?? 0) > 0.9);
assert.equal(maxSagitta([[0, 0, 0], [1, 0, 0], [2, 0, 0]]), 0);

const quad = assessSupport([0, 0], [[-1, -1], [1, -1], [1, 1], [-1, 1]]);
assert.ok((quad.marginM ?? 0) > 0.9);
const triangle = assessSupport([-0.2, 0.2], [[0, 0], [0, 1], [1, 0]]);
assert.ok((triangle.marginM ?? 0) < 0);

const returning = [
  point({ t: 1, stage: 'return', margin3: 0.04, margin4: 0.12, flDown: false, supportCount: 3 }),
  point({ t: 1.4, stage: 'return', margin3: -0.01, margin4: 0.08, flDown: true, supportCount: 4 }),
];
const redefined = classifyReturn(returning);
assert.equal(redefined.kind, 'polygon-redefinition');
assert.equal(redefined.flTouchT, 1.4);

const lost = classifyReturn([
  point({ t: 1, stage: 'return', supportLost: true, margin3: -0.02, margin4: -0.01, flDown: true }),
]);
assert.equal(lost.kind, 'contact-loss');

const outside = classifyReturn([
  point({ t: 1, stage: 'return', margin3: -0.02, margin4: -0.01, flDown: false }),
]);
assert.equal(outside.kind, 'outside-both');
assert.equal(classifyReturn([]).kind, 'not-reached');

const summaryA = summarizeEvaluation(straight);
const summaryB = summarizeEvaluation(straight.map((row) => ({ ...row })));
assert.equal(JSON.stringify(summaryA.tracking), JSON.stringify(summaryB.tracking));
assert.equal(JSON.stringify(summaryA.lag), JSON.stringify(summaryB.lag));

const identity = {
  mode: 'score',
  scoreVersion: 4,
  revision: 2,
  runId: 'run',
  channel: 'left',
  gestureSizeM: 0.02,
  sampleIntervalS: 0.05,
  gainScale: 1,
  returnStyle: 'baseline',
  rate: 1,
};
assert.equal(sameExecution(identity, { ...identity }), true);
assert.equal(sameExecution(identity, { ...identity, revision: 9 }), false);
assert.equal(sameExecution(identity, { ...identity, gainScale: 1.2 }), false);
assert.equal(built.paramSnapshot.speed, 140);

assert.equal(DEFAULT_EXPERIMENT.gainScale, 1);
assert.equal(DEFAULT_EXPERIMENT.sampleIntervalS, 0.05);
assert.equal(DEFAULT_EXPERIMENT.returnStyle, 'baseline');

const memory = createMemory();
memory.mode = 'posture-hold';
memory.playback = 'playing';
memory.outcome = 'running';
noteEvaluation(memory.evaluation, point({ t: 0.2, stage: 'stand', commanded: false }));
const stopped = stop(memory);
assert.equal(stopped.outcome, 'interrupted');
assert.equal(stopped.evaluation.points.length, 1);
assert.equal(canKeepBaseline(stopped.outcome), false);
assert.equal(canKeepBaseline('completed'), true);
assert.equal(canKeepBaseline('failed'), true);

const finished = createMemory();
finished.outcome = 'completed';
finished.evaluation.points.push(point({ t: 1, stage: 'return', commanded: false }));
const kept = stop(finished);
assert.equal(kept.outcome, 'completed');
assert.equal(kept.evaluation.points.length, 1);

const restarted = begin(memory, { basePosition: [0, 0, 0.27] });
assert.equal(restarted.evaluation.points.length, 0);
assert.equal(viewOf(restarted).evaluation.returnReport.kind, 'not-reached');

console.log('evaluation audit ok');
