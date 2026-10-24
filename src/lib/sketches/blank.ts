/**
 * Default source for an explicit New sketch action.
 *
 * It already follows the studio convention: a `motion(t)` function returns a
 * MotionFrame-shaped object and `draw()` renders it. Phase 01 only renders it
 * in 2D; later phases will sample the same function for the robot.
 */
export const BLANK_SKETCH_SOURCE = `// New sketch — describe where each brush should be at time t,
// then draw it. Run to preview.

function motion(t) {
  return {
    time: t,
    left:  { x: width * 0.35, y: height / 2, contact: true },
    right: { x: width * 0.65, y: height / 2, contact: true },
  };
}

function setup() {
  createCanvas(600, 600);
  background(255);
}

function draw() {
  const frame = motion(millis() / 1000);
  noStroke();
  fill(34, 17, 62);
  circle(frame.left.x, frame.left.y, 8);
  fill(234, 125, 255);
  circle(frame.right.x, frame.right.y, 8);
}
`;
