import { createId } from '../utils/misc';
import { hashSource } from '../sketches/sourceHash';
import { buildRuntimeSrcdoc } from './iframeBootstrap';
import {
  isRuntimeMessage,
  isStaleRunId,
  type HostMessage,
  type RuntimeLogLevel,
  type RuntimeMessage,
  type SketchErrorPhase,
} from './protocol';

/**
 * Host-side sketch controller.
 *
 * The preview is a sandboxed iframe (`sandbox="allow-scripts"` only). Sketch
 * source is never evaluated in the Svelte application scope. The classic p5
 * build is served from /vendor (synced from node_modules by
 * scripts/sync-sketch-vendor.mjs) so the iframe can load it as an ordinary
 * script without a CDN.
 *
 * A single preview frame is reused across runs; it is recreated only when a
 * run fails to settle (timeout) so a hung sketch cannot poison the next one.
 */

export const SKETCH_RUNTIME_ASSETS = {
  p5: '/vendor/p5.min.js',
} as const;

export const DEFAULT_START_TIMEOUT_MS = 10_000;

export interface RunnerError {
  message: string;
  line?: number;
  column?: number;
  stack?: string;
  phase?: SketchErrorPhase;
}

export interface RuntimeCanvasInfo {
  widthUnits: number;
  heightUnits: number;
  renderer: '2d' | 'webgl' | 'unknown';
}

export interface RuntimeLogEntry {
  id: string;
  runId: string;
  level: RuntimeLogLevel;
  text: string;
  at: number;
}

/** Immutable snapshot of a run at click time. */
export interface RunSnapshot {
  runId: string;
  sketchId: string;
  source: string;
  sourceHash: string;
  startedAt: number;
}

export type RunTerminalState = 'live' | 'error' | 'cancelled' | 'timeout';

export interface RunOutcome {
  state: RunTerminalState;
  runId: string;
  sketchId: string;
  sourceHash: string;
  error?: RunnerError;
  canvas?: RuntimeCanvasInfo;
}

export function createRunSnapshot(input: { sketchId: string; source: string }): RunSnapshot {
  return {
    runId: createId('run'),
    sketchId: input.sketchId,
    source: input.source,
    sourceHash: hashSource(input.source),
    startedAt: Date.now(),
  };
}

export class RunCancelledError extends Error {
  constructor(message = 'Run cancelled.') {
    super(message);
    this.name = 'RunCancelledError';
  }
}

export class RunTimeoutError extends Error {
  constructor(message = 'The sketch did not start in time.') {
    super(message);
    this.name = 'RunTimeoutError';
  }
}

export interface RunnerEvents {
  /** Errors raised after the run has started (e.g. inside draw()). */
  onError: (runId: string, error: RunnerError) => void;
  onLog: (entry: RuntimeLogEntry) => void;
}

type Pending = {
  runId: string;
  resolve: (canvas: RuntimeCanvasInfo | undefined) => void;
  reject: (error: Error) => void;
  timer: number;
};

function absoluteAssetUrl(url: string): string {
  if (/^https?:\/\//i.test(url) || url.startsWith('blob:') || url.startsWith('data:')) return url;
  if (typeof window === 'undefined') return url;
  return new URL(url, window.location.origin).href;
}

function toRunnerError(error: unknown, fallbackPhase: SketchErrorPhase): RunnerError {
  if (error && typeof error === 'object') {
    const e = error as Partial<RunnerError> & { message?: unknown };
    return {
      message: typeof e.message === 'string' ? e.message : 'The sketch could not be started.',
      line: typeof e.line === 'number' ? e.line : undefined,
      column: typeof e.column === 'number' ? e.column : undefined,
      stack: typeof e.stack === 'string' ? e.stack : undefined,
      phase: typeof e.phase === 'string' ? e.phase : fallbackPhase,
    };
  }
  return { message: String(error), phase: fallbackPhase };
}

class RuntimeFrame {
  readonly iframe: HTMLIFrameElement;
  #ready = false;
  #readyWaiters: Array<() => void> = [];
  #activeRunId: string | null = null;
  #pending: Pending | null = null;
  #disposed = false;
  #onMessage: (message: RuntimeMessage) => void;

  constructor(parent: HTMLElement, onMessage: (message: RuntimeMessage) => void) {
    this.#onMessage = onMessage;
    this.iframe = document.createElement('iframe');
    this.iframe.title = 'p5 sketch preview';
    // Intentionally omit allow-same-origin: the runtime must stay opaque to the
    // host DOM, stores, and any future robot connection objects.
    this.iframe.setAttribute('sandbox', 'allow-scripts');
    Object.assign(this.iframe.style, {
      border: '0',
      width: '100%',
      height: '100%',
      display: 'block',
      background: '#f3f6f6',
    });
    parent.appendChild(this.iframe);
    window.addEventListener('message', this.#handleWindowMessage);
    this.iframe.srcdoc = buildRuntimeSrcdoc(absoluteAssetUrl(SKETCH_RUNTIME_ASSETS.p5));
  }

  get activeRunId(): string | null {
    return this.#activeRunId;
  }

  waitUntilReady(timeoutMs = 15_000): Promise<void> {
    if (this.#ready) return Promise.resolve();
    return new Promise((resolve, reject) => {
      const timer = window.setTimeout(() => {
        reject(new RunTimeoutError('Sketch runtime failed to become ready.'));
      }, timeoutMs);
      this.#readyWaiters.push(() => {
        window.clearTimeout(timer);
        resolve();
      });
    });
  }

  post(message: HostMessage): void {
    const target = this.iframe.contentWindow;
    if (!target) throw new Error('Sketch runtime is not available.');
    // Opaque sandboxed documents expose origin "null"; "*" is required.
    target.postMessage(message, '*');
  }

  /** Posts RUN_SKETCH and waits until first frame, error, cancel, or timeout. */
  async runAndWait(
    source: string,
    runId: string,
    timeoutMs: number,
  ): Promise<RuntimeCanvasInfo | undefined> {
    await this.waitUntilReady(Math.min(timeoutMs, 15_000));
    if (this.#disposed) throw new RunCancelledError();

    this.#settlePending(new RunCancelledError('Superseded by a new run.'));
    this.#activeRunId = runId;

    return new Promise<RuntimeCanvasInfo | undefined>((resolve, reject) => {
      const timer = window.setTimeout(() => {
        if (this.#pending?.runId !== runId) return;
        this.#pending = null;
        reject(new RunTimeoutError());
      }, timeoutMs);

      this.#pending = { runId, resolve, reject, timer };
      try {
        this.post({ type: 'RUN_SKETCH', runId, source });
      } catch (error) {
        window.clearTimeout(timer);
        this.#pending = null;
        this.#activeRunId = null;
        reject(error instanceof Error ? error : new Error(String(error)));
      }
    });
  }

  /** Stops the sketch; settles any pending start promise as cancelled. */
  stop(reason = 'Run stopped.'): void {
    this.#settlePending(new RunCancelledError(reason));
    const runId = this.#activeRunId ?? createId('stop');
    this.#activeRunId = null;
    try {
      this.post({ type: 'STOP_SKETCH', runId });
    } catch {
      // Frame may already be torn down.
    }
  }

  dispose(): void {
    if (this.#disposed) return;
    this.#disposed = true;
    this.#settlePending(new RunCancelledError('Sketch runtime disposed.'));
    this.#activeRunId = null;
    window.removeEventListener('message', this.#handleWindowMessage);
    this.iframe.remove();
    this.#ready = false;
    this.#readyWaiters = [];
  }

  #settlePending(error: Error | null, canvas?: RuntimeCanvasInfo): void {
    const pending = this.#pending;
    if (!pending) return;
    this.#pending = null;
    window.clearTimeout(pending.timer);
    if (error) pending.reject(error);
    else pending.resolve(canvas);
  }

  #handleWindowMessage = (event: MessageEvent): void => {
    if (this.#disposed) return;
    if (event.source !== this.iframe.contentWindow) return;
    if (!isRuntimeMessage(event.data)) return;

    const message = event.data;
    if (message.type === 'RUNTIME_READY') {
      this.#ready = true;
      const waiters = this.#readyWaiters;
      this.#readyWaiters = [];
      for (const waiter of waiters) waiter();
      return;
    }

    if (isStaleRunId(message, this.#activeRunId)) return;

    if (message.type === 'SKETCH_RENDERED' && this.#pending?.runId === message.runId) {
      const canvas =
        typeof message.canvasWidth === 'number' &&
        typeof message.canvasHeight === 'number' &&
        message.canvasWidth > 0 &&
        message.canvasHeight > 0
          ? {
              widthUnits: message.canvasWidth,
              heightUnits: message.canvasHeight,
              renderer: message.renderer ?? 'unknown',
            }
          : undefined;
      this.#settlePending(null, canvas);
      return;
    }

    if (message.type === 'SKETCH_ERROR' && this.#pending?.runId === message.runId) {
      // Failed before first frame: reject the start promise.
      const err = Object.assign(new Error(message.message), {
        line: message.line,
        column: message.column,
        stack: message.stack,
        phase: message.phase,
      });
      this.#settlePending(err);
      return;
    }

    this.#onMessage(message);
  };
}

export class SketchRunner {
  #host: HTMLElement;
  #events: RunnerEvents;
  #frame: RuntimeFrame | null = null;
  #activeRun: RunSnapshot | null = null;

  constructor(container: HTMLElement, events: RunnerEvents) {
    this.#host = container;
    this.#events = events;
    this.#ensureFrame();
  }

  get activeRunId(): string | null {
    return this.#activeRun?.runId ?? null;
  }

  /**
   * Runs an immutable snapshot until it reaches a terminal start state.
   * `live` means the sketch produced its first frame and is now animating.
   */
  async run(
    snapshot: RunSnapshot,
    options: { timeoutMs?: number } = {},
  ): Promise<RunOutcome> {
    const timeoutMs = options.timeoutMs ?? DEFAULT_START_TIMEOUT_MS;
    this.#activeRun = snapshot;
    const base = {
      runId: snapshot.runId,
      sketchId: snapshot.sketchId,
      sourceHash: snapshot.sourceHash,
    };

    try {
      this.#ensureFrame();
      const canvas = await this.#frame!.runAndWait(snapshot.source, snapshot.runId, timeoutMs);
      return { state: 'live', ...base, ...(canvas ? { canvas } : {}) };
    } catch (error) {
      // Only a 'live' outcome keeps the run active (the sketch keeps animating).
      if (this.#activeRun?.runId === snapshot.runId) this.#activeRun = null;

      if (error instanceof RunCancelledError) {
        return { state: 'cancelled', ...base };
      }
      if (error instanceof RunTimeoutError) {
        // A hung runtime is replaced so the next run starts clean.
        this.#resetFrame();
        return {
          state: 'timeout',
          ...base,
          error: { message: error.message, phase: 'runtime' },
        };
      }
      return { state: 'error', ...base, error: toRunnerError(error, 'loading') };
    }
  }

  stop(reason = 'Run stopped.'): void {
    this.#activeRun = null;
    this.#frame?.stop(reason);
  }

  dispose(): void {
    this.#activeRun = null;
    this.#frame?.dispose();
    this.#frame = null;
  }

  #ensureFrame(): void {
    if (this.#frame) return;
    this.#host.replaceChildren();
    this.#frame = new RuntimeFrame(this.#host, (message) => this.#handleMessage(message));
  }

  #resetFrame(): void {
    this.#frame?.dispose();
    this.#frame = null;
    this.#host.replaceChildren();
    this.#ensureFrame();
  }

  #handleMessage(message: RuntimeMessage): void {
    if (message.type === 'SKETCH_ERROR') {
      this.#events.onError(message.runId, {
        message: message.message,
        line: message.line,
        column: message.column,
        stack: message.stack,
        phase: message.phase,
      });
      return;
    }
    if (message.type === 'RUNTIME_LOG') {
      this.#events.onLog({
        id: createId('log'),
        runId: message.runId,
        level: message.level,
        text: message.values.join(' '),
        at: Date.now(),
      });
    }
  }
}
