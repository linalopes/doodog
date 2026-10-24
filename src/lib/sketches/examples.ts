import type { SketchExample } from './types';

/**
 * Built-in examples (immutable templates).
 *
 * Opening the gallery never mutates these. "Use example" creates a user-owned
 * copy in the sketch library. Examples are ordinary global-mode p5 sketches.
 * The studio convention they follow is `motion(t)` → frame → draw.
 *
 * Six scores adapt the static Plotter Workspace studies (loops, coordinates,
 * sine rows, noise marks, vertex lists) into timed brush travel. The
 * Two-brush Lissajous example is unchanged.
 */

const SCORE_RUNTIME = `// The other brush stays lifted. Change params.brush to 'right' to swap.
function restingBrush() {
  return { x: 22, y: height - 22, contact: false };
}

function pushLine(segments, x0, y0, x1, y1, contact, speed) {
  const distance = Math.hypot(x1 - x0, y1 - y0);
  if (distance < 0.001) return;
  segments.push({
    op: 'line',
    x0: x0,
    y0: y0,
    x1: x1,
    y1: y1,
    contact: contact,
    duration: distance / speed,
  });
}

function pushPause(segments, x, y, contact, duration) {
  if (duration <= 0) return;
  segments.push({ op: 'pause', x: x, y: y, contact: contact, duration: duration });
}

function pushArc(segments, cx, cy, radius, a0, a1, contact, speed) {
  const distance = Math.abs(a1 - a0) * radius;
  if (distance < 0.001) return;
  segments.push({
    op: 'arc',
    cx: cx,
    cy: cy,
    radius: radius,
    a0: a0,
    a1: a1,
    contact: contact,
    duration: distance / speed,
  });
}

function poseOn(segment, u) {
  if (segment.op === 'pause') {
    return { x: segment.x, y: segment.y, contact: segment.contact };
  }
  if (segment.op === 'arc') {
    const angle = segment.a0 + (segment.a1 - segment.a0) * u;
    return {
      x: segment.cx + Math.cos(angle) * segment.radius,
      y: segment.cy + Math.sin(angle) * segment.radius,
      contact: segment.contact,
    };
  }
  return {
    x: segment.x0 + (segment.x1 - segment.x0) * u,
    y: segment.y0 + (segment.y1 - segment.y0) * u,
    contact: segment.contact,
  };
}

// t wraps over a finite period. The score is built so the last pose sits on
// the first pose: repeating it does not teleport the brush.
function sampleScore(t, segments) {
  let period = 0;
  for (let i = 0; i < segments.length; i++) period += segments[i].duration;
  if (!(period > 0)) return { x: width / 2, y: height / 2, contact: false };

  let time = t % period;
  if (time < 0) time += period;

  for (let i = 0; i < segments.length; i++) {
    const segment = segments[i];
    if (time < segment.duration || i === segments.length - 1) {
      const span = segment.duration > 0 ? segment.duration : 1;
      const u = Math.min(1, Math.max(0, time / span));
      return poseOn(segment, u);
    }
    time -= segment.duration;
  }
  return poseOn(segments[0], 0);
}

function scorePeriod() {
  const segments = buildScore();
  let period = 0;
  for (let i = 0; i < segments.length; i++) period += segments[i].duration;
  return period;
}

function motion(t) {
  const pose = sampleScore(t, buildScore());
  const active = { x: pose.x, y: pose.y, contact: pose.contact };
  const resting = restingBrush();
  if (params.brush === 'right') {
    return { time: t, left: resting, right: active };
  }
  return { time: t, left: active, right: resting };
}
`;

const BRUSH_PREVIEW = `let trail;
let previous = null;

function setup() {
  createCanvas(600, 600);
  trail = createGraphics(width, height);
  trail.background(255);
  trail.strokeWeight(3);
  trail.strokeCap(ROUND);
  trail.strokeJoin(ROUND);
}

function draw() {
  const frame = motion(millis() / 1000);

  // A mark is painted only while the brush stays down. If the browser skips
  // frames, the gap is walked in small steps so a lift in between is not drawn.
  if (previous) paintSpan(previous, frame);
  previous = frame;

  image(trail, 0, 0);
  drawBrush(frame.left, color(34, 17, 62));
  drawBrush(frame.right, color(234, 125, 255));
}

function paintSpan(before, after) {
  const dt = after.time - before.time;
  if (!(dt > 0) || dt > 0.75) return;
  const steps = Math.max(1, Math.ceil(dt / 0.016));
  let left = before.left;
  let right = before.right;
  for (let i = 1; i <= steps; i++) {
    const t = before.time + (dt * i) / steps;
    const frame = i === steps ? after : motion(t);
    paintIfDown(left, frame.left, 34, 17, 62);
    paintIfDown(right, frame.right, 234, 125, 255);
    left = frame.left;
    right = frame.right;
  }
}

function paintIfDown(before, after, r, g, b) {
  if (before.contact && after.contact) {
    trail.stroke(r, g, b);
    trail.line(before.x, before.y, after.x, after.y);
  }
}

// Filled dot while drawing, outline while lifted.
function drawBrush(brush, c) {
  strokeWeight(1.5);
  if (brush.contact) {
    noStroke();
    fill(c);
  } else {
    stroke(c);
    noFill();
  }
  circle(brush.x, brush.y, 12);
}
`;

function singleBrushScore(body: string): string {
  return `${body}\n${SCORE_RUNTIME}\n${BRUSH_PREVIEW}`;
}

const SIMPLE_LINE = singleBrushScore(`// Simple line.
// Plotter Workspace drew a border and both diagonals in one frozen frame.
// This score keeps the main diagonal and walks it: draw, hold, lift, return.

const params = {
  margin: 80,
  speed: 140,       // canvas units per second while drawing
  liftSpeed: 220,   // return speed with the brush up
  pause: 0.45,      // seconds to hold at each end
  brush: 'left',    // 'left' or 'right'; the other brush stays lifted
};

function buildScore() {
  const segments = [];
  const x0 = params.margin;
  const y0 = params.margin;
  const x1 = width - params.margin;
  const y1 = height - params.margin;

  pushPause(segments, x0, y0, true, params.pause);
  pushLine(segments, x0, y0, x1, y1, true, params.speed);
  pushPause(segments, x1, y1, true, params.pause);
  pushLine(segments, x1, y1, x0, y0, false, params.liftSpeed);
  return segments;
}
`);

const GRID = singleBrushScore(`// Grid.
// The plotter sketch looped vertical lines, then horizontal lines.
// The brush does the same, and lifts whenever it moves to a new line.

const params = {
  margin: 60,
  spacing: 60,      // target gap between strokes
  speed: 340,
  liftSpeed: 680,
  brush: 'left',
};

function evenStops(start, end, spacing) {
  const span = Math.max(0, end - start);
  const gaps = Math.max(1, Math.round(span / Math.max(spacing, 1)));
  const step = span / gaps;
  const values = [];
  for (let i = 0; i <= gaps; i++) values.push(start + step * i);
  return values;
}

function buildScore() {
  const segments = [];
  const x0 = params.margin;
  const y0 = params.margin;
  const x1 = width - params.margin;
  const y1 = height - params.margin;
  const xs = evenStops(x0, x1, params.spacing);
  const ys = evenStops(y0, y1, params.spacing);

  for (let i = 0; i < xs.length; i++) {
    const x = xs[i];
    if (i > 0) pushLine(segments, xs[i - 1], y1, x, y0, false, params.liftSpeed);
    pushLine(segments, x, y0, x, y1, true, params.speed);
  }

  pushLine(segments, xs[xs.length - 1], y1, x0, ys[0], false, params.liftSpeed);

  for (let i = 0; i < ys.length; i++) {
    const y = ys[i];
    if (i > 0) pushLine(segments, x1, ys[i - 1], x0, y, false, params.liftSpeed);
    pushLine(segments, x0, y, x1, y, true, params.speed);
  }

  pushLine(segments, x1, ys[ys.length - 1], xs[0], y0, false, params.liftSpeed);
  return segments;
}
`);

const CONCENTRIC_CIRCLES = singleBrushScore(`// Concentric circles.
// The plotter sketch stroked circle outlines from a small radius outward.
// Each circle is now one timed turn. The step to the next radius is lifted.

const params = {
  count: 8,         // repetitions
  minRadius: 28,
  spacing: 26,      // added to the radius for each new circle
  speed: 220,       // arc length per second
  liftSpeed: 300,
  brush: 'left',
};

function buildScore() {
  const segments = [];
  const cx = width / 2;
  const cy = height / 2;
  const startAngle = 0;
  const endAngle = Math.PI * 2;

  for (let i = 0; i < params.count; i++) {
    const radius = params.minRadius + i * params.spacing;
    if (i > 0) {
      const previous = params.minRadius + (i - 1) * params.spacing;
      pushLine(
        segments,
        cx + Math.cos(startAngle) * previous,
        cy + Math.sin(startAngle) * previous,
        cx + Math.cos(startAngle) * radius,
        cy + Math.sin(startAngle) * radius,
        false,
        params.liftSpeed,
      );
    }
    pushArc(segments, cx, cy, radius, startAngle, endAngle, true, params.speed);
  }

  const outer = params.minRadius + (params.count - 1) * params.spacing;
  const inner = params.minRadius;
  pushLine(
    segments,
    cx + outer,
    cy,
    cx + inner,
    cy,
    false,
    params.liftSpeed,
  );
  return segments;
}
`);

const WAVE_LINES = singleBrushScore(`// Wave lines.
// Each row is the plotter sine polyline: phase shifts by phaseStep, and the
// brush travels the curve instead of emitting every vertex in one frame.
// It lifts on the way to the next row.

const params = {
  margin: 72,
  amplitude: 16,
  frequency: 3,     // cycles across one row
  spacing: 40,      // target distance between row baselines
  phase: 0,
  phaseStep: 0.4,   // phase difference added per row, in radians
  samples: 36,      // straight segments used to walk one sine
  speed: 260,
  liftSpeed: 520,
  brush: 'left',
};

function rowBaselines() {
  const top = params.margin + params.amplitude;
  const bottom = height - params.margin - params.amplitude;
  const span = Math.max(0, bottom - top);
  const gaps = Math.max(1, Math.round(span / Math.max(params.spacing, 1)));
  const step = span / gaps;
  const rows = [];
  for (let i = 0; i <= gaps; i++) rows.push(top + step * i);
  return rows;
}

function wavePoint(rowIndex, yBase, u) {
  const x0 = params.margin;
  const x1 = width - params.margin;
  const phase = params.phase + rowIndex * params.phaseStep;
  return {
    x: x0 + (x1 - x0) * u,
    y: yBase + Math.sin(u * Math.PI * 2 * params.frequency + phase) * params.amplitude,
  };
}

function buildScore() {
  const segments = [];
  const rows = rowBaselines();

  for (let row = 0; row < rows.length; row++) {
    let previous = wavePoint(row, rows[row], 0);
    if (row > 0) {
      const from = wavePoint(row - 1, rows[row - 1], 1);
      pushLine(segments, from.x, from.y, previous.x, previous.y, false, params.liftSpeed);
    }
    const pieces = Math.max(2, params.samples);
    for (let i = 1; i <= pieces; i++) {
      const next = wavePoint(row, rows[row], i / pieces);
      pushLine(segments, previous.x, previous.y, next.x, next.y, true, params.speed);
      previous = next;
    }
  }

  const last = rows.length - 1;
  const end = wavePoint(last, rows[last], 1);
  const start = wavePoint(0, rows[0], 0);
  pushLine(segments, end.x, end.y, start.x, start.y, false, params.liftSpeed);
  return segments;
}
`);

const NOISE_FIELD = singleBrushScore(`// Noise field.
// Same construction as the plotter study: nested loops, a short mark whose
// angle comes from noise(x, y) * turns. Travel between marks stays lifted.
// The noise below is deterministic value noise with seed 42, so motion(t)
// does not depend on p5's noiseSeed.

const params = {
  margin: 60,
  spacing: 48,
  length: 20,
  noiseScale: 0.02,
  turns: 2,
  seed: 42,
  speed: 160,
  liftSpeed: 420,
  brush: 'left',
};

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

function cellPoints(origin, limit, spacing) {
  const points = [];
  const step = Math.max(spacing, 1);
  for (let value = origin; value <= limit + 0.001; value += step) {
    points.push(value);
  }
  return points;
}

function buildScore() {
  const segments = [];
  const xs = cellPoints(params.margin, width - params.margin, params.spacing);
  const ys = cellPoints(params.margin, height - params.margin, params.spacing);
  let cursor = null;

  for (let yi = 0; yi < ys.length; yi++) {
    for (let xi = 0; xi < xs.length; xi++) {
      const x = xs[xi];
      const y = ys[yi];
      const angle = fieldNoise(x * params.noiseScale, y * params.noiseScale, params.seed) * Math.PI * 2 * params.turns;
      const tipX = x + Math.cos(angle) * params.length;
      const tipY = y + Math.sin(angle) * params.length;
      if (cursor) pushLine(segments, cursor.x, cursor.y, x, y, false, params.liftSpeed);
      pushLine(segments, x, y, tipX, tipY, true, params.speed);
      cursor = { x: tipX, y: tipY };
    }
  }

  pushLine(segments, cursor.x, cursor.y, xs[0], ys[0], false, params.liftSpeed);
  return segments;
}
`);

const POLYLINE_COMPOSITION = singleBrushScore(`// Polyline composition.
// Plotter Workspace drew a closed quad, an open sine, a rectangle, and a
// circle in one frame, on a 400 canvas. The vertices below are that
// composition on this 600 canvas (each original coordinate times 1.5).
// The brush interpolates them in order, holds on the corners, and lifts
// between shapes.

const params = {
  speed: 180,
  liftSpeed: 340,
  pause: 0.16,       // hold on each corner, in seconds
  waveSamples: 40,
  circleSides: 24,
  brush: 'left',
};

function traceShape(segments, points, closed, pauseOnVertices) {
  pushPause(segments, points[0].x, points[0].y, true, params.pause);
  for (let i = 1; i < points.length; i++) {
    pushLine(segments, points[i - 1].x, points[i - 1].y, points[i].x, points[i].y, true, params.speed);
    if (pauseOnVertices) pushPause(segments, points[i].x, points[i].y, true, params.pause);
  }
  if (closed) {
    const last = points[points.length - 1];
    const first = points[0];
    pushLine(segments, last.x, last.y, first.x, first.y, true, params.speed);
    pushPause(segments, first.x, first.y, true, params.pause);
    return { x: first.x, y: first.y };
  }
  const last = points[points.length - 1];
  pushPause(segments, last.x, last.y, true, params.pause);
  return { x: last.x, y: last.y };
}

function buildScore() {
  const segments = [];

  const quad = [
    { x: 90, y: 120 },
    { x: 270, y: 90 },
    { x: 330, y: 210 },
    { x: 180, y: 300 },
  ];

  const wave = [];
  for (let i = 0; i <= params.waveSamples; i++) {
    const u = i / params.waveSamples;
    wave.push({
      x: 330 + u * 180,
      y: 330 + Math.sin(u * Math.PI * 2 * 2) * 60,
    });
  }

  const rectangle = [
    { x: 90, y: 360 },
    { x: 240, y: 360 },
    { x: 240, y: 510 },
    { x: 90, y: 510 },
  ];

  const circle = [];
  const cx = 420;
  const cy = 150;
  const radius = 52.5;
  for (let i = 0; i < params.circleSides; i++) {
    const angle = (i / params.circleSides) * Math.PI * 2;
    circle.push({
      x: cx + Math.cos(angle) * radius,
      y: cy + Math.sin(angle) * radius,
    });
  }

  let cursor = traceShape(segments, quad, true, true);
  pushLine(segments, cursor.x, cursor.y, wave[0].x, wave[0].y, false, params.liftSpeed);
  cursor = traceShape(segments, wave, false, false);
  pushLine(segments, cursor.x, cursor.y, rectangle[0].x, rectangle[0].y, false, params.liftSpeed);
  cursor = traceShape(segments, rectangle, true, true);
  pushLine(segments, cursor.x, cursor.y, circle[0].x, circle[0].y, false, params.liftSpeed);
  cursor = traceShape(segments, circle, true, false);
  pushLine(segments, cursor.x, cursor.y, quad[0].x, quad[0].y, false, params.liftSpeed);
  return segments;
}
`);

const TWO_BRUSH_LISSAJOUS = `// Two-brush Lissajous — a generative drawing defined as motion over time.
//
// Studio convention: a sketch does not export paths. It defines where each
// brush should be at time t. In this phase p5 renders the result in 2D; the
// same function will later drive the Unitree Go2 simulation.
//
//   BrushTarget = { x, y, contact }
//   MotionFrame = { time, left: BrushTarget, right: BrushTarget }

const params = {
  freqA: 3,          // horizontal frequency
  freqB: 2,          // vertical frequency
  phase: Math.PI / 2,
  radius: 190,       // reach of the left brush, in canvas units
  speed: 0.55,       // time scale
  liftEvery: 5.0,    // seconds between brush lifts
  liftFor: 0.7,      // how long each lift lasts
};

let trail;
let previous = null;

// The parametric motion model. Pure: same t, same frame.
function motion(t) {
  const cx = width / 2;
  const cy = height / 2;
  const a = t * params.speed;

  const left = {
    x: cx + params.radius * sin(params.freqA * a + params.phase),
    y: cy + params.radius * sin(params.freqB * a),
    contact: (t % params.liftEvery) > params.liftFor,
  };

  const right = {
    x: cx + params.radius * 0.6 * cos(params.freqB * a),
    y: cy + params.radius * 0.6 * sin(params.freqA * a + params.phase),
    contact: ((t + params.liftEvery / 2) % params.liftEvery) > params.liftFor,
  };

  return { time: t, left, right };
}

function setup() {
  createCanvas(600, 600);
  trail = createGraphics(width, height);
  trail.background(255);
  trail.strokeWeight(3);
  trail.strokeCap(ROUND);
}

function draw() {
  const frame = motion(millis() / 1000);

  // Paint only while a brush stays down. Skipped frames are subdivided so a
  // lift between them does not become a line.
  if (previous) paintSpan(previous, frame);
  previous = frame;

  image(trail, 0, 0);
  drawBrush(frame.left, color(34, 17, 62));
  drawBrush(frame.right, color(234, 125, 255));
}

function paintSpan(before, after) {
  const dt = after.time - before.time;
  if (!(dt > 0) || dt > 0.75) return;
  const steps = Math.max(1, Math.ceil(dt / 0.016));
  let left = before.left;
  let right = before.right;
  for (let i = 1; i <= steps; i++) {
    const t = before.time + (dt * i) / steps;
    const frame = i === steps ? after : motion(t);
    if (left.contact && frame.left.contact) {
      trail.stroke(34, 17, 62);           // Deep Purple
      trail.line(left.x, left.y, frame.left.x, frame.left.y);
    }
    if (right.contact && frame.right.contact) {
      trail.stroke(234, 125, 255);        // Pink
      trail.line(right.x, right.y, frame.right.x, frame.right.y);
    }
    left = frame.left;
    right = frame.right;
  }
}

// A filled dot while drawing, an outline while lifted.
function drawBrush(brush, c) {
  strokeWeight(1.5);
  if (brush.contact) {
    noStroke();
    fill(c);
  } else {
    stroke(c);
    noFill();
  }
  circle(brush.x, brush.y, 12);
}
`;

export const SKETCH_EXAMPLES: readonly SketchExample[] = [
  {
    id: 'simple-line',
    name: 'Simple Line',
    description:
      'One brush draws a diagonal, holds, lifts, and returns along the same line. The other brush stays up.',
    tags: ['line', 'lift', 'time-based'],
    source: SIMPLE_LINE,
  },
  {
    id: 'grid',
    name: 'Grid',
    description:
      'Vertical strokes, then horizontal strokes. The brush lifts between lines that do not connect.',
    tags: ['grid', 'lines', 'lift'],
    source: GRID,
  },
  {
    id: 'concentric-circles',
    name: 'Concentric Circles',
    description:
      'Full turns at increasing radii. Moving out to the next circle happens with the brush lifted.',
    tags: ['circles', 'arcs', 'lift'],
    source: CONCENTRIC_CIRCLES,
  },
  {
    id: 'wave-lines',
    name: 'Wave Lines',
    description:
      'Repeating sine rows. Amplitude, frequency, spacing, and phase are editable. The brush lifts between rows.',
    tags: ['wave', 'sine', 'phase'],
    source: WAVE_LINES,
  },
  {
    id: 'noise-field',
    name: 'Noise Field',
    description:
      'Short strokes steered by deterministic noise. The brush lifts while travelling between marks.',
    tags: ['noise', 'field', 'lift'],
    source: NOISE_FIELD,
  },
  {
    id: 'polyline-composition',
    name: 'Polyline Composition',
    description:
      'A quad, a sine, a rectangle, and a circle, walked vertex to vertex with corner pauses and lifts between shapes.',
    tags: ['polyline', 'pause', 'shapes'],
    source: POLYLINE_COMPOSITION,
  },
  {
    id: 'two-brush-lissajous',
    name: 'Two-brush Lissajous',
    description:
      'Two brushes trace coupled Lissajous curves and lift periodically. Motion is a pure function of time, which is how the robot will later read it.',
    tags: ['two brushes', 'time-based', 'lissajous'],
    source: TWO_BRUSH_LISSAJOUS,
  },
];

export function getExampleById(id: string): SketchExample | undefined {
  return SKETCH_EXAMPLES.find((example) => example.id === id);
}
