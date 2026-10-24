/**
 * Classic-script bootstrap embedded in the sandboxed sketch iframe.
 *
 * Intentionally plain JavaScript (string). It must not import host modules.
 * p5 runs in true global mode so sketches read exactly like p5 Web Editor
 * sketches. Console output is forwarded to the host as RUNTIME_LOG.
 *
 * The host timeline is the only clock. After p5 binds its globals, `millis`
 * is replaced with the host time and `noLoop()` stops p5 from scheduling
 * frames. `SET_TIME` redraws up to that time, then `motion(t)` is sampled
 * once. `replayPlan.ts` is the spec for which times get a redraw.
 */
import { MAX_REPLAY_SPAN_SECONDS, REPLAY_STEP_SECONDS } from './replayPlan';

const BOOTSTRAP_BODY = String.raw`
(function () {
  "use strict";

  var preview = document.getElementById("preview");
  var activeRunId = null;
  var userScriptEl = null;
  var p5Instance = null;
  var phase = "idle";
  var renderedForRun = null;
  var logBudget = 0;
  var hostSeconds = 0;
  var paintedUntil = null;
  var currentSource = "";
  var acceptDraw = false;
  var drawCount = 0;
  var drawFailed = false;
  var frameToken = 0;
  var replayToken = 0;
  var pendingTime = null;
  var replaying = false;
  var pristine = Object.create(null);
  var replayStep = __REPLAY_STEP__;
  var maxReplaySpan = __MAX_REPLAY_SPAN__;

  function post(message) {
    parent.postMessage(message, "*");
  }

  function stringifyArg(value) {
    try {
      if (typeof value === "string") return value;
      if (value instanceof Error) return value.message;
      if (typeof value === "number" || typeof value === "boolean") return String(value);
      if (value === undefined) return "undefined";
      return JSON.stringify(value);
    } catch (_err) {
      return String(value);
    }
  }

  // Forward console output, rate limited per run so a log() inside draw()
  // cannot flood the host.
  function forwardConsole(level) {
    var original = console[level];
    console[level] = function () {
      if (activeRunId && logBudget > 0) {
        logBudget -= 1;
        var values = [];
        for (var i = 0; i < arguments.length; i++) values.push(stringifyArg(arguments[i]));
        post({ type: "RUNTIME_LOG", runId: activeRunId, level: level, values: values });
      }
      if (typeof original === "function") original.apply(console, arguments);
    };
  }
  forwardConsole("log");
  forwardConsole("warn");
  forwardConsole("error");

  function parseLocation(error) {
    var line;
    var column;
    var stack = error && typeof error.stack === "string" ? error.stack : undefined;
    var message =
      error && typeof error.message === "string" ? error.message : String(error || "Unknown error");
    var pattern = /(?:<anonymous>|about:srcdoc|blob:[^\s:]+):(\d+)(?::(\d+))?/;
    var direct = pattern.exec(message);
    if (direct) {
      line = Number(direct[1]);
      if (direct[2]) column = Number(direct[2]);
    }
    if (stack) {
      var stackMatch = pattern.exec(stack);
      if (stackMatch) {
        line = Number(stackMatch[1]);
        if (stackMatch[2]) column = Number(stackMatch[2]);
      }
    }
    return { message: message, line: line, column: column, stack: stack };
  }

  function reportError(runId, error, errorPhase) {
    var loc = parseLocation(error);
    var line = error && typeof error.line === "number" ? error.line : loc.line;
    var column = error && typeof error.column === "number" ? error.column : loc.column;
    post({
      type: "SKETCH_ERROR",
      runId: runId,
      message: loc.message,
      line: line,
      column: column,
      stack: loc.stack,
      phase: errorPhase || phase || "runtime"
    });
  }

  function capturePristine() {
    var names = Object.getOwnPropertyNames(window);
    for (var i = 0; i < names.length; i++) pristine[names[i]] = true;
  }

  // Function declarations in a classic script become window properties.
  // Drop the ones this runtime did not start with so scorePeriod() from the
  // previous sketch cannot leak into a sketch that does not declare one.
  function clearAddedGlobals() {
    var names = Object.getOwnPropertyNames(window);
    for (var i = 0; i < names.length; i++) {
      var key = names[i];
      if (pristine[key]) continue;
      var value;
      try { value = window[key]; } catch (_err) { continue; }
      if (typeof value !== "function") continue;
      try { delete window[key]; } catch (_err2) {}
    }
    var extras = ["params", "motion", "scorePeriod", "setup", "draw", "preload", "buildScore"];
    for (var j = 0; j < extras.length; j++) {
      if (pristine[extras[j]]) continue;
      try { delete window[extras[j]]; } catch (_err3) {}
    }
  }

  // p5's remove() is async and unbinds createCanvas (and the rest) when it
  // finishes. A new sketch must wait for that, or the old remove deletes the
  // new sketch's globals before setup runs.
  var turn = Promise.resolve();

  function exclusive(fn) {
    var previous = turn;
    var release;
    var gate = new Promise(function (resolve) { release = resolve; });
    turn = gate;
    return previous.then(fn, fn).then(function (value) {
      release();
      return value;
    }, function (error) {
      release();
      throw error;
    });
  }

  async function stopSketch() {
    phase = "idle";
    renderedForRun = null;
    acceptDraw = false;
    frameToken += 1;
    paintedUntil = null;
    hostSeconds = 0;
    drawFailed = false;

    var oldInstance = p5Instance;
    p5Instance = null;
    if (oldInstance && typeof oldInstance.remove === "function") {
      try { await oldInstance.remove(); } catch (_err) {}
    }
    if (userScriptEl && userScriptEl.parentNode) {
      userScriptEl.parentNode.removeChild(userScriptEl);
    }
    userScriptEl = null;
    if (preview) preview.innerHTML = "";

    var canvases = document.querySelectorAll("canvas");
    for (var c = 0; c < canvases.length; c++) {
      if (canvases[c].parentNode) canvases[c].parentNode.removeChild(canvases[c]);
    }
    clearAddedGlobals();
  }

  function injectSource(source) {
    phase = "loading";
    userScriptEl = document.createElement("script");
    userScriptEl.setAttribute("data-sketch-source", "1");
    // let/const at the top of a classic script live in the page's global
    // lexical environment and cannot be deleted. A second run would throw
    // "already been declared". The wrapper keeps those bindings private and
    // publishes only the hooks p5 and the host call. The prefix is on the
    // first line, so later editor lines stay where they are.
    var hooks = [
      "setup", "draw", "preload", "windowResized",
      "mousePressed", "mouseReleased", "mouseClicked", "mouseMoved", "mouseDragged",
      "keyPressed", "keyReleased", "keyTyped",
      "touchStarted", "touchMoved", "touchEnded",
      "motion", "scorePeriod"
    ];
    var list = hooks.map(function (name) { return "'" + name + "'"; }).join(",");
    var epilogue = "\nvar __doodogHooks=[" + list + "];" +
      "for(var __doodogI=0;__doodogI<__doodogHooks.length;__doodogI++){" +
      "try{var __doodogV=eval(__doodogHooks[__doodogI]);" +
      "if(typeof __doodogV==='function')window[__doodogHooks[__doodogI]]=__doodogV;" +
      "else delete window[__doodogHooks[__doodogI]];}" +
      "catch(__doodogE){try{delete window[__doodogHooks[__doodogI]];}catch(__doodogE2){}}" +
      "}";
    userScriptEl.textContent = "(function(){" + source + epilogue + "\n})();";
    document.body.appendChild(userScriptEl);
  }

  function readCanvasInfo() {
    var info = { canvasWidth: undefined, canvasHeight: undefined, renderer: "unknown" };
    try {
      var w = window.width;
      var h = window.height;
      if (typeof w === "number" && isFinite(w) && w > 0) info.canvasWidth = w;
      if (typeof h === "number" && isFinite(h) && h > 0) info.canvasHeight = h;
      var ctx = window.drawingContext;
      if (ctx) {
        if (typeof WebGLRenderingContext !== "undefined" && ctx instanceof WebGLRenderingContext) {
          info.renderer = "webgl";
        } else if (typeof WebGL2RenderingContext !== "undefined" && ctx instanceof WebGL2RenderingContext) {
          info.renderer = "webgl";
        } else if (typeof CanvasRenderingContext2D !== "undefined" && ctx instanceof CanvasRenderingContext2D) {
          info.renderer = "2d";
        }
      }
    } catch (_err) {}
    return info;
  }

  // p5 defines millis as a non-writable window property. Replace it after
  // new p5() so sketch code reads host seconds. p5's own loop is not a clock.
  function installHostClock() {
    try {
      Object.defineProperty(window, "millis", {
        configurable: true,
        enumerable: true,
        writable: true,
        value: function () { return hostSeconds * 1000; }
      });
    } catch (_err) {}
  }

  function callNoLoop() {
    try {
      if (typeof window.noLoop === "function") window.noLoop();
    } catch (_err) {}
  }

  function installHooks(runId) {
    var userSetup = typeof window.setup === "function" ? window.setup : null;
    var userDraw = typeof window.draw === "function" ? window.draw : null;

    if (!userSetup && !userDraw) {
      throw new Error("No setup() or draw() function was found in the sketch.");
    }

    window.setup = function () {
      phase = "setup";
      try {
        if (userSetup) userSetup();
        post({ type: "SKETCH_STARTED", runId: runId });
      } catch (error) {
        reportError(runId, error, "setup");
        throw error;
      } finally {
        callNoLoop();
      }
    };

    window.draw = function () {
      if (!acceptDraw) return;
      installHostClock();
      phase = "draw";
      try {
        if (userDraw) userDraw();
        callNoLoop();
        drawCount += 1;
        paintedUntil = hostSeconds;
        if (renderedForRun !== runId) {
          renderedForRun = runId;
          post(Object.assign({ type: "SKETCH_RENDERED", runId: runId }, readCanvasInfo()));
        }
      } catch (error) {
        callNoLoop();
        if (!drawFailed) {
          drawFailed = true;
          reportError(runId, error, "draw");
        }
      }
    };
  }

  function startP5() {
    if (typeof p5 !== "function") {
      throw new Error("p5.js failed to load in the sketch runtime.");
    }
    acceptDraw = false;
    p5Instance = new p5(undefined, preview);
    installHostClock();
    callNoLoop();
    acceptDraw = true;
  }

  // p5 2 may skip or defer the first draw. redraw() is a no-op until setup
  // has finished, so this retries briefly. A rebuild cancels the timer.
  function ensureFirstFrame(runId) {
    var token = ++frameToken;
    var attempts = 0;
    function tick() {
      if (token !== frameToken || activeRunId !== runId || renderedForRun === runId) return;
      attempts += 1;
      try {
        if (typeof window.redraw === "function") window.redraw();
      } catch (error) {
        reportError(runId, error, "draw");
        return;
      }
      if (renderedForRun === runId || attempts >= 160) return;
      setTimeout(tick, 50);
    }
    setTimeout(tick, 0);
  }

  function runSketch(runId, source) {
    return exclusive(async function () {
      try {
        await stopSketch();
        activeRunId = runId;
        currentSource = typeof source === "string" ? source : "";
        logBudget = 200;
        hostSeconds = 0;
        paintedUntil = null;
        drawFailed = false;
        drawCount = 0;
        injectSource(currentSource);
        installHooks(runId);
        startP5();
        ensureFirstFrame(runId);
      } catch (error) {
        reportError(runId, error, phase === "idle" ? "loading" : phase);
      }
    });
  }

  function rebuildSketch(startAt) {
    var runId = activeRunId;
    var source = currentSource;
    if (!runId || typeof source !== "string") {
      throw new Error("No sketch is running.");
    }
    return exclusive(async function () {
      await stopSketch();
      activeRunId = runId;
      currentSource = source;
      logBudget = 200;
      hostSeconds = startAt;
      paintedUntil = null;
      drawFailed = false;
      drawCount = 0;
      injectSource(source);
      installHooks(runId);
      startP5();
    });
  }

  // Mirrors replayPlan() in the host. A backward move re-executes the sketch
  // because draw() accumulates paint and is not assumed to be pure.
  function planReplay(painted, requested) {
    if (typeof requested !== "number" || !isFinite(requested) || requested < 0) {
      return { rebuild: false, times: [] };
    }
    var hasPaint = typeof painted === "number" && isFinite(painted);
    var behind = !hasPaint || requested + 0.001 < painted;
    var rebuild = behind;
    var cursor = behind || !hasPaint ? 0 : painted;
    if (requested - cursor > maxReplaySpan) {
      rebuild = true;
      cursor = requested - maxReplaySpan;
    }
    var times = [];
    function push(value) {
      times.push(Math.round(value * 1e6) / 1e6);
    }
    if (rebuild) push(cursor);
    var t = cursor;
    var gate = replayStep * 1.25;
    while (t + gate < requested) {
      t += replayStep;
      push(t);
    }
    var last = times.length ? times[times.length - 1] : null;
    if (last === null || Math.abs(last - requested) > 0.0001) push(requested);
    return { rebuild: rebuild, times: times };
  }

  function delay(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  // redraw() resolves before setup finishes without calling draw. Wait until
  // a draw actually runs. One failure is enough; do not retry a broken draw.
  async function drawWhenReady(time, token) {
    var attempts = 0;
    while (attempts < 160) {
      if (token !== replayToken || drawFailed) return false;
      hostSeconds = time;
      installHostClock();
      var before = drawCount;
      try {
        if (typeof window.redraw === "function") await window.redraw();
      } catch (error) {
        reportError(activeRunId, error, "draw");
        return false;
      }
      if (drawCount > before) {
        paintedUntil = time;
        return true;
      }
      if (drawFailed || token !== replayToken) return false;
      attempts += 1;
      await delay(20);
    }
    return false;
  }

  async function advancePaint(target, token) {
    var plan = planReplay(paintedUntil, target);
    var samples = [];
    if (plan.rebuild) {
      if (token !== replayToken) return samples;
      var startAt = plan.times.length ? plan.times[0] : 0;
      await rebuildSketch(startAt);
      if (token !== replayToken) return samples;
    }
    for (var i = 0; i < plan.times.length; i++) {
      if (token !== replayToken) return samples;
      var ok = await drawWhenReady(plan.times[i], token);
      if (!ok) break;
      var sampled = readMotion(plan.times[i]);
      if (sampled.frame && samples.length < 320) samples.push(sampled.frame);
    }
    if (token !== replayToken) return samples;
    hostSeconds = target;
    installHostClock();
    return samples;
  }

  function isFiniteNumber(value) {
    return typeof value === "number" && isFinite(value);
  }

  function isBrush(value) {
    return !!value && typeof value === "object" &&
      isFiniteNumber(value.x) && isFiniteNumber(value.y) &&
      typeof value.contact === "boolean";
  }

  function isFrame(value) {
    return !!value && typeof value === "object" &&
      isFiniteNumber(value.time) && isBrush(value.left) && isBrush(value.right);
  }

  function readDuration() {
    if (typeof window.scorePeriod !== "function") return null;
    try {
      var value = window.scorePeriod();
      if (typeof value === "number" && isFinite(value) && value > 0) return value;
    } catch (_err) {}
    return null;
  }

  function readMotion(time) {
    if (typeof window.motion !== "function") {
      return {
        frame: null,
        errorCode: "missing",
        errorMessage: "This sketch has no motion(t). The preview can still draw, but the simulation has no frame to follow."
      };
    }
    try {
      var value = window.motion(time);
      if (!isFrame(value)) {
        return {
          frame: null,
          errorCode: "invalid",
          errorMessage: "motion(t) did not return a frame with finite x, y, and a contact boolean for both brushes."
        };
      }
      return { frame: value, errorCode: null, errorMessage: null };
    } catch (error) {
      return {
        frame: null,
        errorCode: "threw",
        errorMessage: error && error.message ? String(error.message) : String(error)
      };
    }
  }

  function postMotion(runId, serial, motion, duration, samples) {
    var canvas = readCanvasInfo();
    post({
      type: "MOTION_FRAME",
      runId: runId,
      serial: serial,
      frame: motion.frame,
      errorCode: motion.errorCode,
      errorMessage: motion.errorMessage,
      durationSeconds: duration,
      canvasWidth: typeof canvas.canvasWidth === "number" ? canvas.canvasWidth : null,
      canvasHeight: typeof canvas.canvasHeight === "number" ? canvas.canvasHeight : null,
      samples: samples || null
    });
  }

  function enqueueTime(data) {
    pendingTime = data;
    replayToken += 1;
    if (!replaying) drainTimes();
  }

  async function drainTimes() {
    if (replaying) return;
    replaying = true;
    try {
      while (pendingTime) {
        var data = pendingTime;
        pendingTime = null;
        var token = replayToken;
        try {
          if (!activeRunId || data.runId !== activeRunId) continue;
          var samples = await advancePaint(data.time, token);
          if (token !== replayToken || pendingTime) continue;
          if (!activeRunId || data.runId !== activeRunId) continue;
          postMotion(data.runId, data.serial, readMotion(data.time), readDuration(), samples);
        } catch (error) {
          if (token !== replayToken || pendingTime) continue;
          if (!activeRunId || data.runId !== activeRunId) continue;
          postMotion(data.runId, data.serial, {
            frame: null,
            errorCode: "threw",
            errorMessage: error && error.message ? String(error.message) : String(error)
          }, null, null);
        }
      }
    } finally {
      replaying = false;
      if (pendingTime) drainTimes();
    }
  }

  window.addEventListener("error", function (event) {
    if (!activeRunId) return;
    var error = event.error || new Error(event.message || "Script error");
    if (typeof event.lineno === "number" && event.lineno > 0 && !error.line) {
      reportError(activeRunId, {
        message: error.message || event.message || "Script error",
        stack: error.stack,
        line: event.lineno,
        column: event.colno
      }, phase === "idle" ? "loading" : phase);
      return;
    }
    reportError(activeRunId, error, phase === "idle" ? "loading" : phase);
  });

  window.addEventListener("unhandledrejection", function (event) {
    if (!activeRunId) return;
    reportError(activeRunId, event.reason || new Error("Unhandled promise rejection"), phase);
  });

  window.addEventListener("message", function (event) {
    if (event.source !== parent) return;
    var data = event.data;
    if (!data || typeof data !== "object" || typeof data.type !== "string") return;

    if (data.type === "RUN_SKETCH") {
      if (typeof data.runId !== "string" || typeof data.source !== "string") return;
      replayToken += 1;
      pendingTime = null;
      runSketch(data.runId, data.source);
      return;
    }

    if (data.type === "STOP_SKETCH") {
      if (typeof data.runId !== "string") return;
      replayToken += 1;
      pendingTime = null;
      exclusive(async function () {
        await stopSketch();
        activeRunId = null;
        currentSource = "";
      });
      return;
    }

    if (data.type === "SET_TIME") {
      if (typeof data.runId !== "string" || typeof data.serial !== "number" || !isFinite(data.serial)) return;
      if (!activeRunId || data.runId !== activeRunId) return;
      if (typeof data.time !== "number" || !isFinite(data.time) || data.time < 0) {
        postMotion(data.runId, data.serial, {
          frame: null,
          errorCode: "invalid",
          errorMessage: "The host sent a time that is not a finite number of seconds."
        }, null);
        return;
      }
      enqueueTime(data);
    }
  });

  capturePristine();
  post({ type: "RUNTIME_READY" });
})();
`;

export const IFRAME_BOOTSTRAP_SOURCE = BOOTSTRAP_BODY.replace(
  '__REPLAY_STEP__',
  String(REPLAY_STEP_SECONDS),
).replace('__MAX_REPLAY_SPAN__', String(MAX_REPLAY_SPAN_SECONDS));

export function buildRuntimeSrcdoc(p5Url: string): string {
  const escapeAttr = (value: string) =>
    value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;');

  return `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="utf-8" />
  <meta name="viewport" content="width=device-width, initial-scale=1" />
  <title>Sketch runtime</title>
  <style>
    html, body {
      margin: 0;
      width: 100%;
      height: 100%;
      overflow: hidden;
      background: #f3f6f6;
    }
    #preview {
      width: 100%;
      height: 100%;
      display: flex;
      align-items: center;
      justify-content: center;
    }
    canvas {
      display: block;
      max-width: 100%;
      max-height: 100%;
      object-fit: contain;
    }
  </style>
</head>
<body>
  <div id="preview"></div>
  <script src="${escapeAttr(p5Url)}"></script>
  <script>
${IFRAME_BOOTSTRAP_SOURCE}
  </script>
</body>
</html>`;
}
