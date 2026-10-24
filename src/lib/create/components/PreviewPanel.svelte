<script lang="ts">
  import { onDestroy } from 'svelte';
  import { SketchRunner, type RunnerError, type RuntimeLogEntry } from '../../p5/runner';
  import ReachabilityOverlay from './ReachabilityOverlay.svelte';

  export type PreviewStatus =
    | 'idle'
    | 'starting'
    | 'live'
    | 'stopped'
    | 'error'
    | 'stale'
    | 'timeout';

  interface Props {
    error: RunnerError | null;
    status: PreviewStatus;
    logs: RuntimeLogEntry[];
    bindRunner: (runner: SketchRunner | null) => void;
    onRuntimeError: (runId: string, error: RunnerError) => void;
    onRuntimeLog: (entry: RuntimeLogEntry) => void;
    onClearLogs: () => void;
  }

  let { error, status, logs, bindRunner, onRuntimeError, onRuntimeLog, onClearLogs }: Props =
    $props();

  let container = $state<HTMLDivElement | null>(null);
  let runner: SketchRunner | null = null;
  let showStack = $state(false);
  let consoleOpen = $state(true);
  let consoleEl = $state<HTMLDivElement | null>(null);

  $effect(() => {
    if (!container || runner) return;
    runner = new SketchRunner(container, {
      onError: (runId, err) => onRuntimeError(runId, err),
      onLog: (entry) => onRuntimeLog(entry),
    });
    bindRunner(runner);
  });

  onDestroy(() => {
    runner?.dispose();
    bindRunner(null);
    runner = null;
  });

  $effect(() => {
    if (error) showStack = false;
  });

  // Keep the console pinned to the latest line.
  $effect(() => {
    logs.length;
    const el = consoleEl;
    if (el) el.scrollTop = el.scrollHeight;
  });

  const locationLabel = $derived.by(() => {
    if (!error || error.line == null) return null;
    const column = error.column != null ? `:${error.column}` : '';
    return `Line ${error.line}${column}`;
  });

  const emptyMessage = $derived.by(() => {
    switch (status) {
      case 'starting':
        return 'Starting sketch…';
      case 'stale':
        return 'Source changed since the last run. Run again to refresh the preview.';
      case 'stopped':
        return 'Sketch stopped. Run to start it again.';
      case 'timeout':
        return 'The sketch did not produce a first frame in time. Check for an infinite loop in setup() and run again.';
      case 'live':
      case 'error':
        return null;
      default:
        return 'Run the sketch to preview it here (⌘/Ctrl + Enter).';
    }
  });
</script>

<div class="preview">
  <div class="preview__stage">
    <div class="preview__frame" bind:this={container}></div>
    <ReachabilityOverlay frame={container} />

    {#if error}
      <div class="preview__error" role="alert">
        <strong>Sketch error{error.phase ? ` · ${error.phase}` : ''}</strong>
        {#if locationLabel}
          <p class="preview__location">{locationLabel}</p>
        {/if}
        <p>{error.message}</p>
        {#if error.stack}
          <button
            type="button"
            class="preview__stack-toggle"
            aria-expanded={showStack}
            onclick={() => (showStack = !showStack)}
          >
            {showStack ? 'Hide details' : 'Show details'}
          </button>
          {#if showStack}
            <pre class="preview__stack">{error.stack}</pre>
          {/if}
        {/if}
      </div>
    {:else if emptyMessage}
      <div
        class="preview__empty"
        class:preview__empty--stale={status === 'stale'}
        class:preview__empty--timeout={status === 'timeout'}
        role="status"
      >
        <p>{emptyMessage}</p>
      </div>
    {/if}
  </div>

  <div class="console" class:console--open={consoleOpen}>
    <div class="console__bar">
      <button
        type="button"
        class="console__toggle"
        aria-expanded={consoleOpen}
        onclick={() => (consoleOpen = !consoleOpen)}
      >
        <span class="section-label">Console</span>
        {#if logs.length > 0}
          <span class="console__count">{logs.length}</span>
        {/if}
      </button>
      <button
        type="button"
        class="console__clear"
        disabled={logs.length === 0}
        onclick={onClearLogs}
      >
        Clear
      </button>
    </div>
    {#if consoleOpen}
      <div class="console__body" bind:this={consoleEl} aria-live="polite">
        {#if logs.length === 0}
          <p class="console__empty">console.log() output from the sketch appears here.</p>
        {:else}
          {#each logs as entry (entry.id)}
            <p class="console__line console__line--{entry.level}">{entry.text}</p>
          {/each}
        {/if}
      </div>
    {/if}
  </div>
</div>

<style>
  .preview {
    display: flex;
    flex-direction: column;
    height: 100%;
    min-height: 240px;
    gap: var(--space-2);
  }

  .preview__stage {
    position: relative;
    flex: 1 1 auto;
    min-height: 0;
    border: var(--border-strong);
    border-radius: var(--radius);
    background: #f3f6f6;
    overflow: hidden;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .preview__frame {
    width: 100%;
    height: 100%;
    display: flex;
    align-items: center;
    justify-content: center;
  }

  .preview__error,
  .preview__empty {
    position: absolute;
    z-index: 4;
    inset: auto var(--space-3) var(--space-3);
    max-width: calc(100% - var(--space-6));
    background: var(--brand-white);
    border: var(--border-strong);
    border-radius: var(--radius);
    padding: var(--space-2) var(--space-3);
    font-size: 13px;
  }

  .preview__error {
    border-color: var(--color-danger);
    border-left-width: 3px;
    color: var(--color-text);
  }

  .preview__error strong {
    color: var(--color-danger);
    font-weight: 600;
  }

  .preview__error p,
  .preview__empty p {
    margin: var(--space-1) 0 0;
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .preview__location {
    font-weight: 700;
  }

  .preview__stack-toggle {
    margin-top: var(--space-2);
    border: 0;
    background: transparent;
    color: inherit;
    font: inherit;
    text-decoration: underline;
    cursor: pointer;
    padding: 0;
  }

  .preview__stack {
    margin: var(--space-2) 0 0;
    max-height: 120px;
    overflow: auto;
    font-family: var(--font-mono);
    font-size: 11px;
    white-space: pre-wrap;
  }

  .preview__empty {
    color: var(--color-text-muted);
  }

  .preview__empty--stale {
    border-color: var(--brand-deep-purple);
    color: var(--brand-deep-purple);
  }

  .preview__empty--timeout {
    border-color: var(--color-warning);
    color: var(--color-warning);
  }

  /* --------------------------------------------------------------- console */

  .console {
    flex: none;
    border: var(--border);
    border-radius: var(--radius);
    background: var(--brand-white);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .console--open {
    height: 120px;
  }

  .console__bar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: var(--space-1) var(--space-2);
    border-bottom: var(--border);
    flex: none;
  }

  .console__toggle {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    border: 0;
    background: transparent;
    padding: 2px 4px;
    cursor: pointer;
  }

  .console__count {
    font-family: var(--font-mono);
    font-size: 10px;
    color: var(--color-text);
    background: var(--color-surface);
    border-radius: 999px;
    padding: 1px 6px;
  }

  .console__clear {
    border: 0;
    background: transparent;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-text-muted);
    text-decoration: underline;
    text-underline-offset: 2px;
    cursor: pointer;
  }

  .console__clear:disabled {
    text-decoration: none;
    opacity: 0.5;
    cursor: default;
  }

  .console__body {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: var(--space-1) var(--space-2);
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .console__empty {
    margin: 0;
    color: var(--color-text-muted);
  }

  .console__line {
    margin: 0;
    padding: 1px 0;
    white-space: pre-wrap;
    word-break: break-word;
    border-bottom: 1px solid var(--color-border-subtle);
  }

  .console__line--warn {
    color: var(--color-warning);
  }

  .console__line--error {
    color: var(--color-danger);
  }
</style>
