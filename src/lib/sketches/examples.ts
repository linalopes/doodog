import type { SketchExample } from './types';

/**
 * Built-in examples (immutable templates).
 *
 * Opening the gallery never mutates these. "Use example" creates a user-owned
 * copy in the sketch library. Examples are ordinary global-mode p5 sketches;
 * the only studio convention they follow is `motion(t)` → frame → draw.
 */
export const SKETCH_EXAMPLES: readonly SketchExample[] = [
  {
    id: 'two-brush-lissajous',
    name: 'Two-brush Lissajous',
    description:
      'Two brushes trace coupled Lissajous curves and lift periodically. Motion is a pure function of time, which is how the robot will later read it.',
    tags: ['two brushes', 'time-based', 'lissajous'],
    source: `// Two-brush Lissajous — a generative drawing defined as motion over time.
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

  // Paint only while a brush is in contact for two consecutive frames.
  if (previous) {
    if (frame.left.contact && previous.left.contact) {
      trail.stroke(34, 17, 62);           // Deep Purple
      trail.line(previous.left.x, previous.left.y, frame.left.x, frame.left.y);
    }
    if (frame.right.contact && previous.right.contact) {
      trail.stroke(234, 125, 255);        // Pink
      trail.line(previous.right.x, previous.right.y, frame.right.x, frame.right.y);
    }
  }
  previous = frame;

  image(trail, 0, 0);
  drawBrush(frame.left, color(34, 17, 62));
  drawBrush(frame.right, color(234, 125, 255));
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
`,
  },
];

export function getExampleById(id: string): SketchExample | undefined {
  return SKETCH_EXAMPLES.find((example) => example.id === id);
}
