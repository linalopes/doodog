/**
 * Parameter inspection shared by the sketch iframe and the unit audit.
 *
 * The iframe cannot import this module. `PARAM_RUNTIME_SOURCE` is pasted into
 * the bootstrap. Keep the string free of host imports and of `${`.
 *
 * A sketch declares plain values:
 *
 *   const params = { amplitude: 120, brush: 'left' };
 *
 * Optional metadata, same keys, is not required:
 *
 *   const paramInfo = {
 *     amplitude: { min: 0, max: 400, step: 1, label: 'Amplitude' },
 *     brush: { options: ['left', 'right'], label: 'Brush' },
 *   };
 *
 * Numbers, booleans, and strings are controls. Anything else is skipped.
 * `motion(t)` should read `params` when it is called. A copy taken once at
 * load time will not follow the panel.
 */
export const PARAM_RUNTIME_SOURCE = `
function paramLabel(key) {
  var spaced = String(key).replace(/([a-z0-9])([A-Z])/g, "$1 $2").replace(/[_-]+/g, " ");
  if (!spaced) return String(key);
  return spaced.charAt(0).toUpperCase() + spaced.slice(1);
}

function isPlainObject(value) {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function inferNumberRange(value) {
  var integer = Math.abs(value - Math.round(value)) < 1e-9;
  var step = integer ? 1 : (Math.abs(value) >= 1 ? 0.01 : 0.001);
  var min = 0;
  var max = 1;
  if (value > 0) {
    max = integer ? Math.max(value * 4, value + 10) : value * 4;
  } else if (value < 0) {
    min = value * 4;
    max = 0;
  } else {
    min = integer ? -10 : -1;
    max = integer ? 10 : 1;
  }
  return { min: min, max: max, step: step };
}

function stringOptions(value) {
  if (!Array.isArray(value) || value.length < 1 || value.length > 12) return null;
  var out = [];
  for (var i = 0; i < value.length; i++) {
    if (typeof value[i] !== "string" || value[i].length < 1 || value[i].length > 40) return null;
    out.push(value[i]);
  }
  return out;
}

function describeParams(values, info) {
  var controls = [];
  if (!isPlainObject(values)) return controls;
  var meta = isPlainObject(info) ? info : {};
  var keys = Object.keys(values);
  var limit = Math.min(keys.length, 24);
  for (var i = 0; i < limit; i++) {
    var key = keys[i];
    if (typeof key !== "string" || key.length < 1 || key.length > 40) continue;
    var value = values[key];
    var spec = isPlainObject(meta[key]) ? meta[key] : {};
    var label = typeof spec.label === "string" && spec.label.trim() ? spec.label.trim().slice(0, 48) : paramLabel(key);
    if (typeof value === "boolean") {
      controls.push({ key: key, kind: "boolean", label: label, value: value, defaultValue: value });
      continue;
    }
    if (typeof value === "number" && isFinite(value)) {
      var range = inferNumberRange(value);
      var min = typeof spec.min === "number" && isFinite(spec.min) ? spec.min : range.min;
      var max = typeof spec.max === "number" && isFinite(spec.max) ? spec.max : range.max;
      if (min > max) {
        var swap = min;
        min = max;
        max = swap;
      }
      var step = typeof spec.step === "number" && isFinite(spec.step) && spec.step > 0 ? spec.step : range.step;
      controls.push({
        key: key,
        kind: "number",
        label: label,
        value: value,
        defaultValue: value,
        min: min,
        max: max,
        step: step
      });
      continue;
    }
    if (typeof value === "string") {
      var choices = stringOptions(spec.options);
      if (choices) {
        if (choices.indexOf(value) < 0) choices = [value].concat(choices).slice(0, 12);
        controls.push({
          key: key,
          kind: "enum",
          label: label,
          value: value,
          defaultValue: value,
          options: choices
        });
      } else {
        controls.push({ key: key, kind: "text", label: label, value: value, defaultValue: value });
      }
    }
  }
  return controls;
}

function applyParamValues(target, controls, patch) {
  var applied = {};
  var rejected = [];
  var changed = false;
  if (!isPlainObject(target) || !isPlainObject(patch) || !Array.isArray(controls)) {
    return { applied: applied, rejected: [{ key: "", reason: "invalid" }], changed: false };
  }
  var byKey = {};
  for (var i = 0; i < controls.length; i++) byKey[controls[i].key] = controls[i];
  var keys = Object.keys(patch);
  for (var k = 0; k < keys.length; k++) {
    var key = keys[k];
    var control = byKey[key];
    var value = patch[key];
    if (!control || !Object.prototype.hasOwnProperty.call(target, key)) {
      rejected.push({ key: key, reason: "unknown" });
      continue;
    }
    if (control.kind === "boolean") {
      if (typeof value !== "boolean") {
        rejected.push({ key: key, reason: "type" });
        continue;
      }
    } else if (control.kind === "number") {
      if (typeof value !== "number" || !isFinite(value)) {
        rejected.push({ key: key, reason: "type" });
        continue;
      }
      if (value < control.min - 1e-9 || value > control.max + 1e-9) {
        rejected.push({ key: key, reason: "range" });
        continue;
      }
    } else if (control.kind === "enum") {
      if (typeof value !== "string" || !control.options || control.options.indexOf(value) < 0) {
        rejected.push({ key: key, reason: "choice" });
        continue;
      }
    } else if (control.kind === "text") {
      if (typeof value !== "string" || value.length > 80) {
        rejected.push({ key: key, reason: "type" });
        continue;
      }
    } else {
      rejected.push({ key: key, reason: "type" });
      continue;
    }
    if (target[key] !== value) changed = true;
    target[key] = value;
    applied[key] = value;
  }
  return { applied: applied, rejected: rejected, changed: changed };
}
`;
