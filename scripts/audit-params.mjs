/**
 * Creative parameter inspection. Runs the same functions the sketch iframe
 * pastes in, plus the host message guard. It does not start a browser.
 */
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { PARAM_RUNTIME_SOURCE } from '../src/lib/params/runtime.ts';
import { isRuntimeMessage } from '../src/lib/p5/protocol.ts';
import { SKETCH_EXAMPLES } from '../src/lib/sketches/examples.ts';

const context = {
  Math,
  Object,
  Array,
  Number,
  isFinite,
  String,
};
vm.createContext(context);
vm.runInContext(PARAM_RUNTIME_SOURCE, context);

const { describeParams, applyParamValues } = context;

const numberOnly = describeParams({ amplitude: 120 }, null);
assert.equal(numberOnly.length, 1);
assert.equal(numberOnly[0].kind, 'number');
assert.equal(numberOnly[0].label, 'Amplitude');
assert.equal(numberOnly[0].min, 0);
assert.equal(numberOnly[0].max, 480);
assert.equal(numberOnly[0].step, 1);
assert.equal(numberOnly[0].defaultValue, 120);

const flagged = describeParams(
  { draw: true, note: 'steady', nested: { skip: true } },
  { draw: { label: 'Draw' }, note: { label: 'Note' } },
);
assert.equal(JSON.stringify(flagged.map((control) => control.kind)), JSON.stringify(['boolean', 'text']));
assert.equal(flagged[0].label, 'Draw');
assert.equal(flagged[0].value, true);

const choices = describeParams(
  { brush: 'left' },
  { brush: { options: ['left', 'right'], label: 'Brush' } },
);
assert.equal(choices[0].kind, 'enum');
assert.equal(JSON.stringify(choices[0].options), JSON.stringify(['left', 'right']));

const explicit = describeParams(
  { speed: 140 },
  { speed: { min: 20, max: 480, step: 5, label: 'Draw speed' } },
);
assert.equal(explicit[0].min, 20);
assert.equal(explicit[0].max, 480);
assert.equal(explicit[0].step, 5);
assert.equal(explicit[0].label, 'Draw speed');

assert.equal(JSON.stringify(describeParams(null, null)), '[]');
assert.equal(JSON.stringify(describeParams({}, {})), '[]');

const target = { amplitude: 120, brush: 'left', draw: false };
const controls = describeParams(target, {
  amplitude: { min: 0, max: 400, step: 1 },
  brush: { options: ['left', 'right'] },
});
const same = applyParamValues(target, controls, { amplitude: 120 });
assert.equal(same.changed, false);
assert.equal(target.amplitude, 120);

const edited = applyParamValues(target, controls, { amplitude: 80, brush: 'right', draw: true });
assert.equal(edited.changed, true);
assert.equal(target.amplitude, 80);
assert.equal(target.brush, 'right');
assert.equal(target.draw, true);

const rejected = applyParamValues(target, controls, {
  amplitude: Number.NaN,
  brush: 'both',
  missing: 1,
  draw: 'yes',
  speed: 4,
});
assert.equal(rejected.changed, false);
assert.equal(
  JSON.stringify(rejected.rejected.map((entry) => entry.reason).sort()),
  JSON.stringify(['choice', 'type', 'type', 'unknown', 'unknown']),
);
assert.equal(target.amplitude, 80);
assert.equal(target.brush, 'right');

const outOfRange = applyParamValues(target, controls, { amplitude: 900 });
assert.equal(outOfRange.changed, false);
assert.equal(outOfRange.rejected[0].reason, 'range');
assert.equal(target.amplitude, 80);

const numberControl = {
  key: 'amplitude',
  kind: 'number',
  label: 'Amplitude',
  value: 120,
  defaultValue: 120,
  min: 0,
  max: 400,
  step: 1,
};
assert.equal(
  isRuntimeMessage({ type: 'PARAMS_SCHEMA', runId: 'run-1', controls: [numberControl] }),
  true,
);
assert.equal(
  isRuntimeMessage({ type: 'PARAMS_SCHEMA', runId: 'run-1', controls: [{ kind: 'nope' }] }),
  false,
);
assert.equal(isRuntimeMessage({ type: 'PARAMS_SCHEMA', runId: '', controls: [] }), false);
assert.equal(
  isRuntimeMessage({
    type: 'PARAMS_RESULT',
    runId: 'run-1',
    revision: 2,
    applied: { amplitude: 80 },
    rejected: [{ key: 'brush', reason: 'choice' }],
    values: { amplitude: 80 },
  }),
  true,
);
assert.equal(
  isRuntimeMessage({
    type: 'PARAMS_RESULT',
    runId: 'run-1',
    revision: Number.NaN,
    applied: {},
    rejected: [],
    values: {},
  }),
  false,
);

const EXPECTED = {
  'simple-line': { margin: 80, speed: 140, liftSpeed: 220, pause: 0.45, brush: 'left' },
  grid: { margin: 60, spacing: 60, speed: 340, liftSpeed: 680, brush: 'left' },
  'concentric-circles': { count: 8, minRadius: 28, spacing: 26, speed: 220, liftSpeed: 300, brush: 'left' },
  'wave-lines': {
    margin: 72,
    amplitude: 16,
    frequency: 3,
    spacing: 40,
    phase: 0,
    phaseStep: 0.4,
    samples: 36,
    speed: 260,
    liftSpeed: 520,
    brush: 'left',
  },
  'noise-field': {
    margin: 60,
    spacing: 48,
    length: 20,
    noiseScale: 0.02,
    turns: 2,
    seed: 42,
    speed: 160,
    liftSpeed: 420,
    brush: 'left',
  },
  'polyline-composition': { speed: 180, liftSpeed: 340, pause: 0.16, waveSamples: 40, circleSides: 24, brush: 'left' },
  'two-brush-lissajous': {
    freqA: 3,
    freqB: 2,
    phase: Math.PI / 2,
    radius: 190,
    speed: 0.55,
    liftEvery: 5,
    liftFor: 0.7,
  },
};

for (const example of SKETCH_EXAMPLES) {
  const sandbox = { Math, width: 600, height: 600, result: null };
  vm.createContext(sandbox);
  vm.runInContext(
    `${example.source}\nresult = { params: params, info: typeof paramInfo === "undefined" ? null : paramInfo };`,
    sandbox,
  );
  const expected = EXPECTED[example.id];
  assert.ok(expected, `${example.id} has no expected defaults`);
  assert.equal(JSON.stringify(sandbox.result.params), JSON.stringify(expected), `${example.id} defaults changed`);
  assert.ok(sandbox.result.info, `${example.id} is missing paramInfo`);
  const described = describeParams(sandbox.result.params, sandbox.result.info);
  assert.equal(
    JSON.stringify(described.map((control) => control.key)),
    JSON.stringify(Object.keys(expected)),
    `${example.id} controls`,
  );
  for (const control of described) {
    assert.equal(control.defaultValue, expected[control.key], `${example.id} ${control.key}`);
    if (control.kind === 'number') {
      assert.ok(control.min <= control.value && control.value <= control.max, `${example.id} ${control.key} range`);
      assert.ok(control.step > 0);
    }
  }
}

const bare = { Math, width: 600, height: 600, saw: false };
vm.createContext(bare);
vm.runInContext('function motion(t) { return t; }\nsaw = typeof params === "undefined";', bare);
assert.equal(bare.saw, true);

const bootstrapFile = fs.readFileSync(new URL('../src/lib/p5/iframeBootstrap.ts', import.meta.url), 'utf8');
const bootstrapMatch = bootstrapFile.match(/const BOOTSTRAP_BODY = String\.raw`([\s\S]*?)`;\n/);
assert.ok(bootstrapMatch, 'bootstrap source was not found');
const bootstrapBody = bootstrapMatch[1].replaceAll('${PARAM_RUNTIME_SOURCE}', PARAM_RUNTIME_SOURCE);
new Function(bootstrapBody);

console.log('param audit ok');
