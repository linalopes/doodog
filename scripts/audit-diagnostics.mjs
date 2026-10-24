/**
 * Motion diagnostics: derivatives, ranges, events, solver agreement, and chart seeks.
 * No browser. The sandbox protocol is checked as data, not by loading the iframe.
 */
import assert from 'node:assert/strict';
import { isRuntimeMessage } from '../src/lib/p5/protocol.ts';
import { defaultSimConfig } from '../src/lib/simulate/go2/defaults.ts';
import { REACH_TOLERANCE_M } from '../src/lib/simulate/go2/kinematics.ts';
import { LEGS } from '../src/lib/simulate/go2/model.ts';
import { solvePose } from '../src/lib/simulate/go2/pose.ts';
import {
  acceptMotionBatch,
  analysisConfigKey,
  brushFromPose,
  buildAnalysis,
  diagnoseFrame,
} from '../src/lib/simulate/diagnostics/analyze.ts';
import { chartSeekState, chartSeekTime, nearestSampleIndex } from '../src/lib/simulate/diagnostics/chart.ts';
import { differentiateSeries } from '../src/lib/simulate/diagnostics/differentiate.ts';
import {
  DEFAULT_THRESHOLDS,
  collectEvents,
  jointLimitGap,
} from '../src/lib/simulate/diagnostics/events.ts';
import { MAX_ANALYSIS_SAMPLES, planAnalysis } from '../src/lib/simulate/diagnostics/range.ts';

function almost(actual, expected, tolerance, label) {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${label}: ${actual} vs ${expected}`);
}

const uniformTimes = Array.from({ length: 201 }, (_, index) => index * 0.01);
const sine = uniformTimes.map((time) => Math.sin(time));
const sineDerivative = differentiateSeries(uniformTimes, sine);
const mid = 100;
almost(sineDerivative.velocity[mid], Math.cos(uniformTimes[mid]), 1e-4, 'sine velocity');
almost(sineDerivative.acceleration[mid], -Math.sin(uniformTimes[mid]), 1e-3, 'sine acceleration');
almost(sineDerivative.velocity[0], Math.cos(uniformTimes[0]), 1e-3, 'sine endpoint velocity');

const unevenTimes = [0, 0.02, 0.05, 0.09, 0.1];
const quadratic = unevenTimes.map((time) => time * time);
const quadraticDerivative = differentiateSeries(unevenTimes, quadratic);
for (let index = 0; index < unevenTimes.length; index += 1) {
  almost(quadraticDerivative.velocity[index], 2 * unevenTimes[index], 1e-9, `quadratic velocity ${index}`);
  almost(quadraticDerivative.acceleration[index], 2, 1e-6, `quadratic acceleration ${index}`);
}

const stillTimes = [0, 0.05, 0.1, 0.15];
const still = differentiateSeries(stillTimes, [0.4, 0.4, 0.4, 0.4]);
for (const value of still.velocity) almost(value, 0, 1e-9, 'stationary velocity');
for (const value of still.acceleration) almost(value, 0, 1e-9, 'stationary acceleration');
assert.equal(differentiateSeries([1], [2]).velocity[0], null);

const jumpTimes = [0, 0.1, 0.2, 0.3, 0.4];
const jump = differentiateSeries(jumpTimes, [0, 0, 0, 1, 1]);
assert.ok(Math.abs(jump.velocity[2]) > 2, 'a step must produce a large velocity estimate');
assert.ok(Math.abs(jump.acceleration[2]) > 5, 'a step must produce an acceleration spike');

const stepSamples = jumpTimes.map((time, index) => {
  const angle = index < 3 ? 0 : 1;
  const velocity = jump.velocity[index];
  const acceleration = jump.acceleration[index];
  const brush = {
    active: true,
    joints: [angle, 0, -1.8],
    velocity: [velocity, 0, 0],
    acceleration: [acceleration, 0, 0],
    positionErrorM: 0,
    reachable: true,
  };
  return { time, valid: true, left: brush, right: { ...brush, joints: [0, 0, -1.8], velocity: [0, 0, 0], acceleration: [0, 0, 0] } };
});
const stepEvents = collectEvents(stepSamples, DEFAULT_THRESHOLDS, false);
assert.ok(stepEvents.some((event) => event.type === 'position-discontinuity' && event.leg === 'FL' && event.derived === false));
assert.ok(stepEvents.some((event) => event.type === 'velocity-threshold' && event.derived === true));

const quiet = collectEvents(
  stillTimes.map((time) => ({
    time,
    valid: true,
    left: {
      active: true,
      joints: [0, 0.4, -1.8],
      velocity: [0, 0, 0],
      acceleration: [0, 0, 0],
      positionErrorM: 0.001,
      reachable: true,
    },
    right: {
      active: false,
      joints: [0, 0.9, -1.8],
      velocity: [0, 0, 0],
      acceleration: [0, 0, 0],
      positionErrorM: 1,
      reachable: false,
    },
  })),
  DEFAULT_THRESHOLDS,
  false,
);
assert.equal(quiet.length, 0, 'a stationary active joint and an inactive brush raise no events');

const near = LEGS.FL.abduction.max - 0.01;
const gap = jointLimitGap('FL', 0, near);
assert.ok(gap.gap <= DEFAULT_THRESHOLDS.nearLimitRad);
const nearEvents = collectEvents(
  [
    {
      time: 0,
      valid: true,
      left: {
        active: true,
        joints: [near, 0.4, -1.8],
        velocity: [0, 0, 0],
        acceleration: [0, 0, 0],
        positionErrorM: 0,
        reachable: true,
      },
      right: {
        active: true,
        joints: [0, 0.4, -1.8],
        velocity: [0, 0, 0],
        acceleration: [0, 0, 0],
        positionErrorM: 0,
        reachable: true,
      },
    },
  ],
  DEFAULT_THRESHOLDS,
  false,
);
assert.ok(nearEvents.some((event) => event.type === 'near-limit' && event.leg === 'FL' && event.joint === 0));
assert.equal(jointLimitGap('FL', 0, 0).gap > DEFAULT_THRESHOLDS.nearLimitRad, true);

const period = planAnalysis({ durationSeconds: 8, interval: 0.05, windowStart: 3, windowLength: 2 });
assert.equal(period.kind, 'period');
assert.equal(period.start, 0);
assert.equal(period.end, 8);
assert.equal(period.times[0], 0);
assert.equal(period.times[period.times.length - 1], 8);
assert.equal(period.note.includes('scorePeriod'), true);
assert.equal(period.times.length <= MAX_ANALYSIS_SAMPLES, true);

const windowPlan = planAnalysis({ durationSeconds: null, interval: 0.05, windowStart: 2, windowLength: 8 });
assert.equal(windowPlan.kind, 'window');
assert.equal(windowPlan.start, 2);
assert.equal(windowPlan.end, 10);
assert.match(windowPlan.note, /not a score length/);
assert.equal(planAnalysis({ durationSeconds: null, interval: 0.05, windowStart: 0, windowLength: 8 }).kind, 'window');

const wide = planAnalysis({ durationSeconds: 100, interval: 0.05, windowStart: 0, windowLength: 8 });
assert.equal(wide.widened, true);
assert.ok(wide.times.length <= MAX_ANALYSIS_SAMPLES);
assert.equal(wide.times[wide.times.length - 1], 100);
assert.ok(wide.interval > 0.05);

const canvas = { width: 600, height: 600 };
const frame = {
  time: 1.25,
  left: { x: 300, y: 300, contact: false },
  right: { x: 280, y: 340, contact: true },
};
const config = defaultSimConfig();
const pose = solvePose(frame, canvas, config, null);
const diagnosed = diagnoseFrame({ time: 1.25, frame, errorCode: null, errorMessage: null }, canvas, config);
assert.deepEqual(diagnosed.left.joints, pose.legs.FL.joints);
assert.deepEqual(diagnosed.right.joints, pose.legs.FR.joints);
assert.equal(diagnosed.left.positionErrorM, pose.legs.FL.positionErrorM);
assert.equal(diagnosed.right.reachable, pose.legs.FR.reachable);
assert.equal(diagnosed.left.contact, false);
assert.equal(diagnosed.left.active, true);
assert.ok(diagnosed.left.joints.every((angle) => Number.isFinite(angle)));
assert.deepEqual(brushFromPose(pose, 'left', false).joints, pose.legs.FL.joints);

const far = defaultSimConfig();
far.paper = { ...far.paper, origin: [5, 5, 0] };
const unreachable = buildAnalysis(
  [{ time: 0, frame: { time: 0, left: frame.left, right: frame.right }, errorCode: null, errorMessage: null }],
  canvas,
  far,
  DEFAULT_THRESHOLDS,
  false,
);
assert.equal(unreachable.samples[0].left.reachable, false);
assert.ok(unreachable.events.some((event) => event.type === 'unreachable' && event.derived === false));
assert.ok(unreachable.samples[0].left.positionErrorM > REACH_TOLERANCE_M);

const loop = buildAnalysis(
  [
    { time: 0, frame: { time: 0, left: { x: 300, y: 300, contact: true }, right: { x: 300, y: 300, contact: true } }, errorCode: null, errorMessage: null },
    { time: 1, frame: { time: 1, left: { x: 40, y: 40, contact: true }, right: { x: 300, y: 300, contact: true } }, errorCode: null, errorMessage: null },
  ],
  canvas,
  config,
  { ...DEFAULT_THRESHOLDS, positionJumpRad: (1 * Math.PI) / 180 },
  true,
);
assert.ok(loop.events.some((event) => event.boundary && event.type === 'position-discontinuity'));

const baseKey = analysisConfigKey(config);
const helpers = defaultSimConfig();
helpers.showGrid = !helpers.showGrid;
assert.equal(analysisConfigKey(helpers), baseKey);
const moved = defaultSimConfig();
moved.paper = { ...moved.paper, origin: [0.4, 0, 0] };
assert.notEqual(analysisConfigKey(moved), baseKey);

const expected = { runId: 'run-a', serial: 4, revision: 2, times: [0, 0.05] };
assert.equal(
  acceptMotionBatch(expected, {
    runId: 'run-a',
    serial: 4,
    revision: 2,
    samples: [{ time: 0 }, { time: 0.05 }],
  }),
  true,
);
assert.equal(acceptMotionBatch(expected, { runId: 'run-b', serial: 4, revision: 2, samples: [{ time: 0 }, { time: 0.05 }] }), false);
assert.equal(acceptMotionBatch(expected, { runId: 'run-a', serial: 5, revision: 2, samples: [{ time: 0 }, { time: 0.05 }] }), false);
assert.equal(acceptMotionBatch(expected, { runId: 'run-a', serial: 4, revision: 3, samples: [{ time: 0 }, { time: 0.05 }] }), false);
assert.equal(acceptMotionBatch(expected, { runId: 'run-a', serial: 4, revision: 2, samples: [{ time: 0 }, { time: 0.2 }] }), false);
assert.equal(acceptMotionBatch(null, { runId: 'run-a', serial: 4, revision: 2, samples: [] }), false);

assert.equal(chartSeekTime(50, 200, 1, 9), 3);
assert.equal(chartSeekTime(-10, 200, 0, 4), 0);
assert.equal(chartSeekTime(10, 0, 0, 4), null);
assert.equal(nearestSampleIndex([0, 0.5, 1.2], 0.6), 1);
const clock = { time: 0, durationSeconds: 8, playState: 'paused', rate: 1 };
const sought = chartSeekState(clock, 25, 100, 0, 8);
assert.equal(sought.time, 2);
assert.equal(sought.playState, 'paused');
assert.equal(chartSeekState(clock, 10, 0, 0, 8), clock);

assert.equal(
  isRuntimeMessage({
    type: 'MOTION_BATCH',
    runId: 'run-a',
    serial: 1,
    revision: 2,
    durationSeconds: null,
    canvasWidth: 600,
    canvasHeight: 600,
    samples: [{ time: 0, frame: frame, errorCode: null, errorMessage: null }],
  }),
  true,
);
assert.equal(
  isRuntimeMessage({
    type: 'MOTION_BATCH',
    runId: 'run-a',
    serial: 1,
    revision: 2,
    durationSeconds: 4,
    canvasWidth: 600,
    canvasHeight: 600,
    samples: [{ time: 0, frame: { time: 0, left: { x: 1, y: 2, contact: true } }, errorCode: null, errorMessage: null }],
  }),
  false,
);

console.log('diagnostics audit ok');
