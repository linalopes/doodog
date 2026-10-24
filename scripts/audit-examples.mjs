/**
 * Samples every built-in score outside the sketch iframe.
 *
 * The running app samples motion(t) inside the sketch iframe. This audit
 * evaluates the example source in a sandbox with the studio canvas size so
 * the shared MotionFrame contract can be checked without a browser.
 */
import assert from 'node:assert/strict';
import vm from 'node:vm';
import { isMotionFrame } from '../src/lib/motion/types.ts';
import { SKETCH_EXAMPLES, getExampleById } from '../src/lib/sketches/examples.ts';

const CANVAS = 600;
const DT = 0.02;

const EXPECTED_IDS = [
  'simple-line',
  'grid',
  'concentric-circles',
  'wave-lines',
  'noise-field',
  'polyline-composition',
  'two-brush-lissajous',
];

function loadSketch(source) {
  const sandbox = {
    width: CANVAS,
    height: CANVAS,
    sin: Math.sin,
    cos: Math.cos,
    Math,
    console,
  };
  vm.createContext(sandbox);
  vm.runInContext(source, sandbox, { filename: 'sketch.js' });
  assert.equal(typeof sandbox.motion, 'function');
  return sandbox;
}

function brushDistance(a, b) {
  return Math.hypot(b.x - a.x, b.y - a.y);
}

function contactRuns(frames, side) {
  const runs = [];
  let current = null;
  for (const entry of frames) {
    if (entry.frame[side].contact) {
      if (!current) current = [];
      current.push(entry);
    } else if (current) {
      runs.push(current);
      current = null;
    }
  }
  if (current) runs.push(current);
  return runs;
}

function travelStats(frames, side) {
  let painted = 0;
  let lifted = 0;
  let maxStep = 0;
  for (let i = 1; i < frames.length; i += 1) {
    const before = frames[i - 1].frame[side];
    const after = frames[i].frame[side];
    const distance = brushDistance(before, after);
    maxStep = Math.max(maxStep, distance);
    if (before.contact && after.contact) painted += distance;
    else lifted += distance;
  }
  return { painted, lifted, maxStep };
}

function samplePeriod(motion, period) {
  const frames = [];
  for (let t = 0; t < period - 1e-9; t += DT) {
    frames.push({ t, frame: motion(t) });
  }
  return frames;
}

function assertFrame(frame, label) {
  assert.equal(isMotionFrame(frame), true, `${label} is not a MotionFrame`);
  for (const side of ['left', 'right']) {
    assert.equal(Number.isFinite(frame[side].x), true, `${label} ${side}.x`);
    assert.equal(Number.isFinite(frame[side].y), true, `${label} ${side}.y`);
    assert.equal(typeof frame[side].contact, 'boolean');
  }
}

function frameSignature(frame) {
  return JSON.stringify(frame);
}

function assertDeterministic(source, motion, times) {
  const again = loadSketch(source).motion;
  for (const t of times) {
    assert.equal(frameSignature(motion(t)), frameSignature(motion(t)), `motion(${t}) changed between calls`);
    assert.equal(frameSignature(motion(t)), frameSignature(again(t)), `motion(${t}) changed between contexts`);
  }
}

function assertRestingRight(frames, label) {
  for (const entry of frames) {
    const right = entry.frame.right;
    assert.equal(right.contact, false, `${label} right brush drew at t=${entry.t}`);
    assert.equal(right.x, 22, `${label} right brush moved`);
    assert.equal(right.y, CANVAS - 22, `${label} right brush moved`);
  }
}

function assertSeam(sandbox, label) {
  const period = sandbox.scorePeriod();
  assert.equal(Number.isFinite(period), true, label);
  assert.ok(period > 1 && period < 90, `${label} period ${period.toFixed(2)}s is outside 1..90s`);
  const start = sandbox.motion(0);
  const wrapped = sandbox.motion(period);
  const before = sandbox.motion(period - 0.01);
  const negative = sandbox.motion(-0.01);
  assertFrame(start, `${label} t=0`);
  assertFrame(wrapped, `${label} t=period`);
  assertFrame(before, `${label} t=period-0.01`);
  assertFrame(negative, `${label} t=-0.01`);
  assert.equal(wrapped.time, period);
  assert.equal(frameSignature(wrapped.left), frameSignature(start.left), `${label} left pose jumps at the repeat`);
  assert.equal(frameSignature(wrapped.right), frameSignature(start.right), `${label} right pose jumps at the repeat`);
  const seam = brushDistance(before.left, start.left);
  assert.ok(seam < 15, `${label} end is ${seam.toFixed(2)}px from the start`);
  const fromNegative = brushDistance(negative.left, start.left);
  assert.ok(fromNegative < 15, `${label} negative time is ${fromNegative.toFixed(2)}px from the start`);
  return period;
}

function pointLineDistance(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const length = Math.hypot(dx, dy) || 1;
  return Math.abs((point.x - a.x) * dy - (point.y - a.y) * dx) / length;
}

function distanceToSegment(point, a, b) {
  const dx = b.x - a.x;
  const dy = b.y - a.y;
  const lengthSq = dx * dx + dy * dy;
  const t = lengthSq === 0 ? 0 : Math.min(1, Math.max(0, ((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSq));
  return Math.hypot(point.x - (a.x + dx * t), point.y - (a.y + dy * t));
}

function hasHold(run, seconds) {
  const need = Math.ceil(seconds / DT);
  let still = 1;
  for (let i = 1; i < run.length; i += 1) {
    const step = brushDistance(run[i - 1].frame.left, run[i].frame.left);
    still = step < 0.25 ? still + 1 : 1;
    if (still >= need) return true;
  }
  return false;
}

function auditSimpleLine(frames) {
  const a = { x: 80, y: 80 };
  const b = { x: 520, y: 520 };
  const runs = contactRuns(frames, 'left');
  assert.equal(runs.length, 1, `simple line contact runs ${runs.length}`);
  for (const entry of frames) {
    if (!entry.frame.left.contact) continue;
    const offset = pointLineDistance(entry.frame.left, a, b);
    assert.ok(offset < 1.5, `simple line left the diagonal by ${offset}`);
  }
  const stats = travelStats(frames, 'left');
  const diagonal = Math.hypot(440, 440);
  assert.ok(Math.abs(stats.painted - diagonal) < 30, `painted ${stats.painted} vs ${diagonal}`);
  assert.ok(Math.abs(stats.lifted - diagonal) < 40, `lifted ${stats.lifted} vs ${diagonal}`);
  assert.ok(stats.lifted > 100, 'return travel was not lifted');
}

function auditGrid(frames) {
  const runs = contactRuns(frames, 'left');
  assert.equal(runs.length, 18, `grid contact runs ${runs.length}`);
  let vertical = 0;
  let horizontal = 0;
  for (let i = 1; i < frames.length; i += 1) {
    const before = frames[i - 1].frame.left;
    const after = frames[i].frame.left;
    if (!(before.contact && after.contact)) continue;
    const dx = Math.abs(after.x - before.x);
    const dy = Math.abs(after.y - before.y);
    assert.ok(dx < 0.2 || dy < 0.2, `grid painted a diagonal ${dx}, ${dy}`);
  }
  for (const run of runs) {
    const first = run[0].frame.left;
    const last = run[run.length - 1].frame.left;
    const dx = Math.abs(last.x - first.x);
    const dy = Math.abs(last.y - first.y);
    if (dx < 1 && dy > 400) vertical += 1;
    if (dy < 1 && dx > 400) horizontal += 1;
  }
  assert.equal(vertical, 9, `vertical strokes ${vertical}`);
  assert.equal(horizontal, 9, `horizontal strokes ${horizontal}`);
  assert.ok(travelStats(frames, 'left').lifted > 500);
}

function auditCircles(frames) {
  const runs = contactRuns(frames, 'left');
  assert.equal(runs.length, 8, `circle contact runs ${runs.length}`);
  const center = { x: 300, y: 300 };
  runs.forEach((run, index) => {
    const radii = run.map((entry) => brushDistance(center, entry.frame.left));
    const mean = radii.reduce((sum, value) => sum + value, 0) / radii.length;
    const expected = 28 + index * 26;
    const deviation = Math.sqrt(radii.reduce((sum, value) => sum + (value - mean) ** 2, 0) / radii.length);
    assert.ok(Math.abs(mean - expected) < 2, `circle ${index} radius ${mean} expected ${expected}`);
    assert.ok(deviation < 1.5, `circle ${index} radius wobble ${deviation}`);
  });
  assert.ok(travelStats(frames, 'left').lifted > 20);
}

function auditWaves(frames) {
  const runs = contactRuns(frames, 'left');
  assert.equal(runs.length, 12, `wave rows ${runs.length}`);
  let previousMean = -Infinity;
  for (const run of runs) {
    let minY = Infinity;
    let maxY = -Infinity;
    let meanY = 0;
    for (let i = 0; i < run.length; i += 1) {
      const point = run[i].frame.left;
      minY = Math.min(minY, point.y);
      maxY = Math.max(maxY, point.y);
      meanY += point.y;
      if (i > 0) {
        assert.ok(point.x >= run[i - 1].frame.left.x - 0.5, 'wave row moved backward while drawing');
      }
    }
    meanY /= run.length;
    assert.ok(maxY - minY > 28 && maxY - minY < 36, `wave amplitude span ${maxY - minY}`);
    assert.ok(meanY > previousMean, 'wave rows are not stacked downward');
    previousMean = meanY;
  }
  assert.ok(travelStats(frames, 'left').lifted > 100);
}

function hashUnit(ix, iy, seed) {
  let n = Math.imul(ix, 374761393) + Math.imul(iy, 668265263) + Math.imul(seed | 0, 1442695041);
  n = Math.imul(n ^ (n >>> 13), 1274126177);
  return ((n ^ (n >>> 16)) >>> 0) / 4294967296;
}

function fade(amount) {
  return amount * amount * (3 - 2 * amount);
}

function fieldNoise(x, y, seed) {
  const x0 = Math.floor(x);
  const y0 = Math.floor(y);
  const tx = fade(x - x0);
  const ty = fade(y - y0);
  const a = hashUnit(x0, y0, seed);
  const b = hashUnit(x0 + 1, y0, seed);
  const c = hashUnit(x0, y0 + 1, seed);
  const d = hashUnit(x0 + 1, y0 + 1, seed);
  return a + (b - a) * tx + (c - a) * ty + (a - b - c + d) * tx * ty;
}

function auditNoise(frames) {
  const runs = contactRuns(frames, 'left');
  assert.equal(runs.length, 121, `noise marks ${runs.length}`);
  for (const run of runs) {
    let length = 0;
    for (let i = 1; i < run.length; i += 1) {
      length += brushDistance(run[i - 1].frame.left, run[i].frame.left);
    }
    assert.ok(length > 12 && length < 26, `noise mark length ${length}`);
  }
  const angle = fieldNoise(60 * 0.02, 60 * 0.02, 42) * Math.PI * 2 * 2;
  const first = frames[0].frame.left;
  assert.ok(brushDistance(first, { x: 60, y: 60 }) < 1, 'noise field does not start on the first cell');
  const early = frames.find((entry) => entry.t > 0.05);
  const expected = { x: 60 + Math.cos(angle) * 20, y: 60 + Math.sin(angle) * 20 };
  const along = brushDistance(early.frame.left, { x: 60, y: 60 });
  const toward = Math.hypot(expected.x - 60, expected.y - 60) || 1;
  const cross = Math.abs((early.frame.left.x - 60) * (expected.y - 60) - (early.frame.left.y - 60) * (expected.x - 60));
  assert.ok(cross / toward < 1.5, 'first noise mark left its angle');
  assert.ok(along > 4 && along < 20, `first noise mark progress ${along}`);
  assert.ok(travelStats(frames, 'left').lifted > runs.length * 10);
}

function auditPolyline(frames) {
  const runs = contactRuns(frames, 'left');
  assert.equal(runs.length, 4, `polyline shapes ${runs.length}`);
  const quad = [
    { x: 90, y: 120 },
    { x: 270, y: 90 },
    { x: 330, y: 210 },
    { x: 180, y: 300 },
  ];
  for (const entry of runs[0]) {
    const nearest = Math.min(
      ...quad.map((point, index) => distanceToSegment(entry.frame.left, point, quad[(index + 1) % quad.length])),
    );
    assert.ok(nearest < 1.5, `quad vertex walk left the edges by ${nearest}`);
  }
  assert.equal(hasHold(runs[0], 0.1), true, 'quad has no corner pause');

  const wave = runs[1];
  assert.ok(wave[0].frame.left.x < 340 && wave[wave.length - 1].frame.left.x > 500);
  assert.equal(hasHold(wave, 0.1), true, 'wave has no pause at an endpoint');

  for (const entry of runs[2]) {
    const { x, y } = entry.frame.left;
    const onRect =
      (Math.abs(y - 360) < 1.5 && x >= 89 && x <= 241) ||
      (Math.abs(y - 510) < 1.5 && x >= 89 && x <= 241) ||
      (Math.abs(x - 90) < 1.5 && y >= 359 && y <= 511) ||
      (Math.abs(x - 240) < 1.5 && y >= 359 && y <= 511);
    assert.equal(onRect, true, `rectangle walk left the outline at ${x}, ${y}`);
  }

  const radii = runs[3].map((entry) => brushDistance({ x: 420, y: 150 }, entry.frame.left));
  const mean = radii.reduce((sum, value) => sum + value, 0) / radii.length;
  assert.ok(Math.abs(mean - 52.5) < 2, `circle polyline radius ${mean}`);
  assert.ok(travelStats(frames, 'left').lifted > 200);
}

function auditLissajous(sandbox) {
  const times = [0, 0.35, 1.7, 5.1, 12];
  const frames = [];
  for (let t = 0; t <= 12; t += DT) frames.push({ t, frame: sandbox.motion(t) });
  for (const t of times) assertFrame(sandbox.motion(t), `lissajous t=${t}`);
  const leftDown = frames.some((entry) => entry.frame.left.contact);
  const leftUp = frames.some((entry) => !entry.frame.left.contact);
  const rightDown = frames.some((entry) => entry.frame.right.contact);
  const rightUp = frames.some((entry) => !entry.frame.right.contact);
  assert.equal(leftDown && leftUp && rightDown && rightUp, true, 'lissajous brushes do not lift and draw');
  const stats = travelStats(frames, 'left');
  assert.ok(stats.maxStep < 20, `lissajous jumped ${stats.maxStep}`);
  assert.ok(stats.painted > 100 && stats.lifted > 20);
  const start = sandbox.motion(0);
  assert.equal(start.left.contact, false);
  assert.ok(brushDistance(start.left, { x: 300, y: 300 }) > 100);
}

function assertCatalog() {
  assert.deepEqual(
    SKETCH_EXAMPLES.map((example) => example.id),
    EXPECTED_IDS,
  );
  assert.equal(new Set(EXPECTED_IDS).size, EXPECTED_IDS.length);
  assert.equal(getExampleById('missing'), undefined);
  const lissajous = getExampleById('two-brush-lissajous');
  assert.equal(lissajous.name, 'Two-brush Lissajous');
  assert.match(lissajous.source, /freqA: 3/);
  assert.match(lissajous.source, /function motion\(t\)/);
  assert.doesNotMatch(lissajous.source, /buildScore/);

  const snapshot = SKETCH_EXAMPLES.map((example) => example.source);
  for (const example of SKETCH_EXAMPLES) {
    assert.ok(example.name.length > 0);
    assert.ok(example.description.length > 40, example.id);
    assert.ok(example.tags.length >= 3, example.id);
    assert.match(example.source, /function motion\(/);
    assert.match(example.source, /function setup\(/);
    assert.match(example.source, /function draw\(/);
    assert.match(example.source, /createCanvas\(600, 600\)/);
    assert.doesNotMatch(example.source, /noLoop\s*\(/);
    assert.doesNotMatch(example.source, /beginShape\s*\(/);
    assert.match(example.source, /\.contact && /);
    loadSketch(example.source);
  }
  assert.deepEqual(
    SKETCH_EXAMPLES.map((example) => example.source),
    snapshot,
    'auditing mutated an example source',
  );
}

const auditors = {
  'simple-line': auditSimpleLine,
  grid: auditGrid,
  'concentric-circles': auditCircles,
  'wave-lines': auditWaves,
  'noise-field': auditNoise,
  'polyline-composition': auditPolyline,
};

assertCatalog();

const report = [];
for (const example of SKETCH_EXAMPLES) {
  const sandbox = loadSketch(example.source);
  if (example.id === 'two-brush-lissajous') {
    assert.equal(sandbox.scorePeriod, undefined);
    assertDeterministic(example.source, sandbox.motion, [0, 1.25, 4.9]);
    auditLissajous(sandbox);
    report.push(`${example.id}  continuous  both brushes`);
    continue;
  }

  assert.equal(typeof sandbox.scorePeriod, 'function', example.id);
  assert.match(example.source, /brush: 'left'/);
  const period = assertSeam(sandbox, example.id);
  const frames = samplePeriod(sandbox.motion, period);
  for (const entry of frames) assertFrame(entry.frame, `${example.id} t=${entry.t.toFixed(2)}`);
  assertRestingRight(frames, example.id);
  assertDeterministic(example.source, sandbox.motion, [0, period / 2, period]);
  const repeated = sandbox.motion(period + 1.25);
  const once = sandbox.motion(1.25);
  assert.equal(frameSignature(repeated.left), frameSignature(once.left), `${example.id} repeat drifted`);
  assert.equal(frameSignature(repeated.right), frameSignature(once.right), `${example.id} repeat drifted`);
  const stats = travelStats(frames, 'left');
  assert.ok(stats.painted > 50, `${example.id} painted almost nothing`);
  assert.ok(stats.lifted > 10, `${example.id} has no lifted travel`);
  assert.ok(stats.maxStep < 20, `${example.id} jumped ${stats.maxStep.toFixed(2)}px between samples`);
  auditors[example.id](frames);
  report.push(
    `${example.id}  period=${period.toFixed(2)}s  painted=${stats.painted.toFixed(0)}  lifted=${stats.lifted.toFixed(0)}`,
  );
}

console.log(report.join('\n'));
console.log(`audited ${SKETCH_EXAMPLES.length} examples`);
