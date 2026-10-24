/**
 * Reachability map. Uses the same inverse kinematics as the Go2 preview.
 * No browser and no sketch evaluation.
 */
import assert from 'node:assert/strict';
import { defaultSimConfig } from '../src/lib/simulate/go2/defaults.ts';
import { solveLeg } from '../src/lib/simulate/go2/kinematics.ts';
import { mapBrushTarget } from '../src/lib/simulate/go2/mapping.ts';
import { BODY_POSITION } from '../src/lib/simulate/go2/model.ts';
import {
  buildReachabilityMap,
  canvasDisplayRect,
  classifyCanvasPoint,
  evaluationHeightM,
  gridShape,
  heightLabel,
  paintReachability,
  REACH_DISCLAIMER,
  REACH_ZONE_RGB,
  reachabilityKey,
} from '../src/lib/simulate/go2/reachability.ts';

const canvas = { width: 600, height: 600 };

function queryFor(config, height = 'down') {
  return { canvas, config, height };
}

const config = defaultSimConfig();
const down = queryFor(config, 'down');
const point = classifyCanvasPoint(300, 300, down);
const mapped = mapBrushTarget(
  { x: 300, y: 300, contact: true },
  canvas,
  config.paper,
  config.mapping,
  true,
  BODY_POSITION,
);
assert.equal(point.heightM, mapped.world[2]);
assert.equal(point.heightM, evaluationHeightM(config, 'down'));
assert.equal(point.mode, 'down');
const solved = solveLeg('FL', mapped.body, config.brushes.left.offset);
assert.equal(point.left.reachable, solved.reachable);
assert.ok(Math.abs(point.left.positionErrorM - solved.positionErrorM) < 1e-9);
const right = solveLeg('FR', mapped.body, config.brushes.right.offset);
assert.equal(point.right.reachable, right.reachable);
assert.ok(Math.abs(point.right.positionErrorM - right.positionErrorM) < 1e-9);

const up = classifyCanvasPoint(300, 300, queryFor(config, 'up'));
assert.ok(Math.abs(up.heightM - point.heightM - config.paper.liftHeightM) < 1e-9);
assert.equal(up.heightM, evaluationHeightM(config, 'up'));
assert.match(heightLabel(config, 'down'), /Brush down, on the paper/);
assert.match(heightLabel(config, 'up'), /Brush up, 40 mm above the paper/);
assert.match(REACH_DISCLAIMER, /Geometric reach only/);
assert.match(REACH_DISCLAIMER, /does not show balance/);

const farConfig = defaultSimConfig();
farConfig.paper = { ...farConfig.paper, origin: [5, 5, 0] };
const far = classifyCanvasPoint(300, 300, queryFor(farConfig));
assert.equal(far.zone, 'neither');
assert.equal(far.left.reachable, false);
assert.equal(far.right.reachable, false);
assert.ok(far.left.positionErrorM > 0.05);

const inactive = defaultSimConfig();
inactive.brushes = {
  ...inactive.brushes,
  left: { ...inactive.brushes.left, active: false },
};
const held = classifyCanvasPoint(300, 300, queryFor(inactive));
assert.equal(held.left.active, false);
assert.equal(held.left.reachable, false);
assert.equal(held.left.positionErrorM, null);
assert.ok(held.zone === 'right' || held.zone === 'neither');

const lifted = defaultSimConfig();
lifted.paper = { ...lifted.paper, liftHeightM: 0.12 };
assert.notEqual(reachabilityKey(down, 8), reachabilityKey(queryFor(lifted, 'up'), 8));
assert.equal(evaluationHeightM(lifted, 'up'), lifted.paper.origin[2] + 0.12);

const yawed = defaultSimConfig();
yawed.paper = { ...yawed.paper, yawRad: Math.PI / 2 };
assert.notEqual(reachabilityKey(down, 8), reachabilityKey(queryFor(yawed), 8));

const scaled = defaultSimConfig();
scaled.mapping = { ...scaled.mapping, scaleX: 0.01, scaleY: 0.01 };
assert.notEqual(reachabilityKey(down, 8), reachabilityKey(queryFor(scaled), 8));
const tight = classifyCanvasPoint(0, 0, queryFor(scaled));
const wide = classifyCanvasPoint(0, 0, down);
assert.ok(Math.abs(tight.left.positionErrorM - wide.left.positionErrorM) > 1e-4);

const moved = defaultSimConfig();
moved.brushes = {
  ...moved.brushes,
  left: { ...moved.brushes.left, offset: [0.2, 0.05, -0.02] },
};
assert.notEqual(reachabilityKey(down, 8), reachabilityKey(queryFor(moved), 8));
const withMount = solveLeg('FL', mapped.body, config.brushes.left.offset);
const withOtherMount = solveLeg('FL', mapped.body, moved.brushes.left.offset);
const jointShift =
  Math.abs(withMount.joints[0] - withOtherMount.joints[0]) +
  Math.abs(withMount.joints[1] - withOtherMount.joints[1]) +
  Math.abs(withMount.joints[2] - withOtherMount.joints[2]);
assert.ok(jointShift > 1e-3, 'brush offset did not change the solved pose');

const map = buildReachabilityMap(down, 8);
const again = buildReachabilityMap(down, 8);
assert.equal(map.columns, 8);
assert.equal(map.rows, 8);
assert.equal(map.cells.length, 64);
assert.equal(
  JSON.stringify(map.cells.map((cell) => cell.zone)),
  JSON.stringify(again.cells.map((cell) => cell.zone)),
);
const sample = map.cells[27];
const checked = classifyCanvasPoint(sample.canvasX, sample.canvasY, down);
assert.equal(checked.zone, sample.zone);
assert.equal(checked.left.reachable, sample.left.reachable);
assert.equal(checked.right.reachable, sample.right.reachable);
assert.ok(['both', 'left', 'right', 'neither'].includes(sample.zone));

const shifted = buildReachabilityMap(queryFor(farConfig), 8);
assert.notEqual(map.key, shifted.key);
assert.ok(shifted.cells.every((cell) => cell.zone === 'neither'));

assert.deepEqual(gridShape(canvas, 16), { columns: 16, rows: 16 });
assert.deepEqual(gridShape({ width: 600, height: 300 }, 16), { columns: 16, rows: 8 });

const large = canvasDisplayRect(800, 800, 600, 600);
assert.equal(large.scale, 1);
assert.equal(large.x, 100);
assert.equal(large.y, 100);
assert.equal(large.width, 600);
const shrunk = canvasDisplayRect(300, 300, 600, 600);
assert.equal(shrunk.scale, 0.5);
assert.equal(shrunk.width, 300);
assert.equal(shrunk.x, 0);
const letterbox = canvasDisplayRect(900, 400, 600, 600);
assert.ok(Math.abs(letterbox.scale - 400 / 600) < 1e-9);
assert.equal(letterbox.width, 400);
assert.equal(letterbox.height, 400);
assert.equal(letterbox.x, 250);
assert.equal(letterbox.y, 0);

const pixels = new Uint8ClampedArray(2 * 2 * 4);
paintReachability(
  pixels,
  2,
  2,
  [{ zone: 'left' }, { zone: 'right' }, { zone: 'both' }, { zone: 'neither' }],
  2,
  2,
  0.5,
);
assert.equal(pixels[0], REACH_ZONE_RGB.left[0]);
assert.equal(pixels[1], REACH_ZONE_RGB.left[1]);
assert.equal(pixels[2], REACH_ZONE_RGB.left[2]);
assert.equal(pixels[3], Math.round(255 * 0.5));
assert.equal(pixels[4], REACH_ZONE_RGB.right[0]);
assert.equal(pixels[8], REACH_ZONE_RGB.both[0]);
assert.equal(pixels[9], REACH_ZONE_RGB.both[1]);
assert.equal(pixels[12], REACH_ZONE_RGB.neither[0]);
assert.equal(pixels[15], Math.round(255 * 0.5 * 0.45));
assert.ok(pixels[15] < pixels[3]);

console.log('reachability audit ok');
