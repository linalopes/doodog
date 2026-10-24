/**
 * Classic-script bootstrap embedded in the sandboxed sketch iframe.
 *
 * Intentionally plain JavaScript (string). It must not import host modules.
 * p5 runs in true global mode so sketches read exactly like p5 Web Editor
 * sketches. Console output is forwarded to the host as RUNTIME_LOG.
 */
export const IFRAME_BOOTSTRAP_SOURCE = String.raw`
(function () {
  "use strict";

  var preview = document.getElementById("preview");
  var activeRunId = null;
  var userScriptEl = null;
  var p5Instance = null;
  var phase = "idle";
  var renderedForRun = null;
  var logBudget = 0;

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

  function clearUserHooks() {
    var names = [
      "setup", "draw", "preload", "windowResized",
      "mousePressed", "mouseReleased", "mouseClicked", "mouseMoved", "mouseDragged",
      "keyPressed", "keyReleased", "keyTyped",
      "touchStarted", "touchMoved", "touchEnded",
      "motion", "params"
    ];
    for (var i = 0; i < names.length; i++) {
      try {
        delete window[names[i]];
      } catch (_err) {
        window[names[i]] = undefined;
      }
    }
  }

  function stopSketch() {
    phase = "idle";
    renderedForRun = null;

    if (p5Instance) {
      try { p5Instance.remove(); } catch (_err) {}
      p5Instance = null;
    }
    if (typeof window.remove === "function") {
      try { window.remove(); } catch (_err) {}
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
    clearUserHooks();
  }

  function injectSource(source) {
    phase = "loading";
    userScriptEl = document.createElement("script");
    userScriptEl.setAttribute("data-sketch-source", "1");
    // Classic script body: line numbers map 1:1 to the editor document.
    userScriptEl.textContent = source;
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
      }
    };

    window.draw = function () {
      phase = "draw";
      try {
        if (userDraw) userDraw();
        if (renderedForRun !== runId) {
          renderedForRun = runId;
          post(Object.assign({ type: "SKETCH_RENDERED", runId: runId }, readCanvasInfo()));
        }
      } catch (error) {
        reportError(runId, error, "draw");
        if (typeof noLoop === "function") {
          try { noLoop(); } catch (_err) {}
        }
      }
    };
  }

  function startP5() {
    if (typeof p5 !== "function") {
      throw new Error("p5.js failed to load in the sketch runtime.");
    }
    // Global mode: no sketch function. Second argument is the preview node.
    p5Instance = new p5(undefined, preview);
  }

  // p5 2 skips the first looping draw when it falls inside the same frame as
  // setup, then waits for requestAnimationFrame. A hidden or throttled view
  // may not deliver that frame before the host's start timeout, so the
  // runtime asks for one redraw itself. redraw() is a no-op until setup has
  // finished, which is why this retries briefly.
  function ensureFirstFrame(runId) {
    var attempts = 0;
    function tick() {
      if (activeRunId !== runId || renderedForRun === runId) return;
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
    try {
      stopSketch();
      activeRunId = runId;
      logBudget = 200;
      injectSource(typeof source === "string" ? source : "");
      installHooks(runId);
      startP5();
      ensureFirstFrame(runId);
    } catch (error) {
      reportError(runId, error, phase === "idle" ? "loading" : phase);
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
    // Only accept messages from the embedding host window.
    if (event.source !== parent) return;
    var data = event.data;
    if (!data || typeof data !== "object" || typeof data.type !== "string") return;

    if (data.type === "RUN_SKETCH") {
      if (typeof data.runId !== "string" || typeof data.source !== "string") return;
      runSketch(data.runId, data.source);
      return;
    }

    if (data.type === "STOP_SKETCH") {
      if (typeof data.runId !== "string") return;
      stopSketch();
      activeRunId = null;
    }
  });

  post({ type: "RUNTIME_READY" });
})();
`;

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
