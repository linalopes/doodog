<script lang="ts">
  import { tick } from 'svelte';
  import { get } from 'svelte/store';
  import ConfirmDialog from '../lib/components/ConfirmDialog.svelte';
  import MainSection from '../lib/components/MainSection.svelte';
  import CodeEditor from '../lib/create/components/CodeEditor.svelte';
  import ExampleGallery from '../lib/create/components/ExampleGallery.svelte';
  import ParametersPanel from '../lib/create/components/ParametersPanel.svelte';
  import PreviewPanel, { type PreviewStatus } from '../lib/create/components/PreviewPanel.svelte';
  import SketchLibrary from '../lib/create/components/SketchLibrary.svelte';
  import MotionReadout from '../lib/components/MotionReadout.svelte';
  import { clearMotionOutput } from '../lib/motion/output';
  import { clearCreativeParams, subscribeParamFlush } from '../lib/params/store';
  import { seek, setPlayState, timeline } from '../lib/motion/timeline';
  import PlaybackControls from '../lib/simulate/components/PlaybackControls.svelte';
  import Timeline from '../lib/simulate/components/Timeline.svelte';
  import {
    createRunSnapshot,
    type RunSnapshot,
    type RunnerError,
    type RuntimeCanvasInfo,
    type RuntimeLogEntry,
    type SketchRunner,
  } from '../lib/p5/runner';
  import { hashSource } from '../lib/sketches/sourceHash';
  import {
    activeSketch,
    createSketch,
    deleteSketch,
    duplicateSketch,
    renameSketch,
    restoreOriginalExample,
    selectSketch,
    sketches,
    updateSketchSource,
    useExample,
  } from '../lib/sketches/store';
  import { createSection } from '../lib/stores/navigation';
  import { preferences, updatePreferences } from '../lib/stores/preferences';

  /**
   * Create workspace — sketch library, CodeMirror editor, sandboxed p5 preview.
   *
   * Source of truth: selected sketch → CodeMirror draft → Run snapshots the
   * draft at click time. Built-in examples may auto-run after "Use example";
   * ordinary user sketches never execute until an explicit Run.
   */

  const MAX_LOG_LINES = 200;

  let draftSource = $state('');
  let draftName = $state('');
  let renaming = $state(false);
  let focusTitlePending = $state(false);
  let titleInput = $state<HTMLInputElement | null>(null);

  let sketchError = $state<RunnerError | null>(null);
  let previewStatus = $state<PreviewStatus>('idle');
  let logs = $state<RuntimeLogEntry[]>([]);
  let starting = $state(false);
  let runner: SketchRunner | null = null;
  let activeRun = $state<RunSnapshot | null>(null);
  let liveRun = $state<{ sketchId: string; sourceHash: string } | null>(null);
  let runtimeCanvas = $state<RuntimeCanvasInfo | null>(null);

  let saveState = $state<'saved' | 'saving' | 'modified'>('saved');
  let saveTimer: ReturnType<typeof setTimeout> | null = null;
  let pendingSave: { sketchId: string; source: string } | null = null;
  let loadedSketchId = $state<string | null>(null);
  /** Bumps when the editor must replace its document. */
  let editorSyncKey = $state('');

  let deleteTargetId = $state<string | null>(null);
  let restoreConfirmOpen = $state(false);

  let splitRatio = $state($preferences.createEditorRatio);
  let dragging = $state(false);
  let splitEl = $state<HTMLDivElement | null>(null);

  const browsingExamples = $derived($createSection === 'examples');
  const deleteTarget = $derived($sketches.find((s) => s.id === deleteTargetId) ?? null);
  const dirtySketchIds = $derived.by(() => {
    if (saveState === 'saved' || !$activeSketch) return new Set<string>();
    return new Set([$activeSketch.id]);
  });

  const isLive = $derived(previewStatus === 'live' || previewStatus === 'stale');

  const statusChip = $derived.by(() => {
    if (starting || previewStatus === 'starting') return 'Starting';
    if (previewStatus === 'error') return 'Error';
    if (previewStatus === 'timeout') return 'Timed out';
    if (previewStatus === 'stale') {
      return $timeline.playState === 'playing' ? 'Playing · source changed' : 'Paused · source changed';
    }
    if (previewStatus === 'live') {
      if ($timeline.playState === 'playing') return 'Playing';
      if ($timeline.playState === 'paused') return 'Paused';
      return 'Stopped';
    }
    if (previewStatus === 'stopped') return 'Stopped';
    if (saveState === 'saving') return 'Saving';
    if (saveState === 'modified') return 'Modified';
    return 'Not running';
  });

  const canvasLabel = $derived(
    runtimeCanvas
      ? `${runtimeCanvas.widthUnits} × ${runtimeCanvas.heightUnits} canvas units · ${runtimeCanvas.renderer.toUpperCase()}`
      : 'Canvas size is read from createCanvas() when the sketch runs.',
  );

  function flushPendingSave() {
    if (saveTimer) {
      clearTimeout(saveTimer);
      saveTimer = null;
    }
    if (!pendingSave) return;
    const { sketchId, source } = pendingSave;
    pendingSave = null;
    updateSketchSource(sketchId, source);
    if ($activeSketch?.id === sketchId) saveState = 'saved';
  }

  function stopRun(reason = 'Stopped.') {
    setPlayState('paused');
    seek(0);
    runner?.stop(reason);
    clearMotionOutput();
    clearCreativeParams();
    activeRun = null;
    liveRun = null;
    starting = false;
  }

  // Slider edits from Create or Simulate land here. Create stays mounted, so
  // one subscription covers both workspaces. Source edits do not use this path.
  $effect(() => {
    return subscribeParamFlush((values, revision) => {
      if (!runner) return;
      runner.setParams(values, revision, get(timeline).time);
    });
  });

  // The host clock is the only time the live sketch hears. One sample is in
  // flight inside the runner; this effect just names the latest time.
  $effect(() => {
    const time = $timeline.time;
    if (!isLive || !runner) return;
    runner.requestTime(time);
  });

  /** Selection transaction: flush edits → stop run → replace editor → reset preview. */
  function applySketchSelection(sketchId: string, source: string, name: string) {
    flushPendingSave();
    stopRun('Switched sketches.');
    loadedSketchId = sketchId;
    draftSource = source;
    draftName = name;
    editorSyncKey = `${sketchId}:${hashSource(source)}`;
    saveState = 'saved';
    sketchError = null;
    runtimeCanvas = null;
    logs = [];
    previewStatus = 'idle';
  }

  $effect(() => {
    const sketch = $activeSketch;
    if (!sketch) {
      flushPendingSave();
      stopRun('No sketch selected.');
      loadedSketchId = null;
      draftSource = '';
      draftName = '';
      editorSyncKey = '';
      previewStatus = 'idle';
      return;
    }
    if (loadedSketchId === sketch.id) return;
    applySketchSelection(sketch.id, sketch.source, sketch.name);
  });

  $effect(() => {
    if (renaming && focusTitlePending && titleInput) {
      titleInput.focus();
      titleInput.select();
      focusTitlePending = false;
    }
  });

  function persistSource(next: string) {
    draftSource = next;
    const sketchId = $activeSketch?.id;
    if (!sketchId) return;
    pendingSave = { sketchId, source: next };
    if (liveRun && liveRun.sketchId === sketchId && liveRun.sourceHash !== hashSource(next)) {
      if (previewStatus === 'live') previewStatus = 'stale';
    }
    if (saveTimer) clearTimeout(saveTimer);
    saveState = 'saving';
    saveTimer = setTimeout(() => {
      const pending = pendingSave;
      if (!pending) return;
      pendingSave = null;
      saveTimer = null;
      updateSketchSource(pending.sketchId, pending.source);
      if ($activeSketch?.id === pending.sketchId) saveState = 'saved';
    }, 350);
  }

  async function runSketch() {
    if (!$activeSketch || starting || !runner || !draftSource.trim()) return;
    flushPendingSave();

    const snapshot = createRunSnapshot({ sketchId: $activeSketch.id, source: draftSource });
    activeRun = snapshot;
    liveRun = null;
    starting = true;
    sketchError = null;
    logs = [];
    previewStatus = 'starting';
    setPlayState('paused');
    seek(0);
    clearMotionOutput();
    clearCreativeParams();

    try {
      const outcome = await runner.run(snapshot);
      if (activeRun?.runId !== snapshot.runId) return; // superseded

      if (outcome.state === 'live') {
        liveRun = { sketchId: snapshot.sketchId, sourceHash: snapshot.sourceHash };
        previewStatus = 'live';
        if (outcome.canvas) runtimeCanvas = outcome.canvas;
        seek(0);
        setPlayState('playing');
        return;
      }
      if (outcome.state === 'timeout') {
        previewStatus = 'timeout';
        sketchError = outcome.error ?? null;
        return;
      }
      if (outcome.state === 'cancelled') {
        previewStatus = 'stopped';
        return;
      }
      previewStatus = 'error';
      sketchError = outcome.error ?? { message: 'Failed to run sketch.', phase: 'runtime' };
    } finally {
      if (activeRun?.runId === snapshot.runId) starting = false;
    }
  }

  function handleRuntimeError(runId: string, error: RunnerError) {
    if (activeRun?.runId !== runId) return;
    sketchError = error;
    previewStatus = 'error';
  }

  function handleRuntimeLog(entry: RuntimeLogEntry) {
    if (activeRun?.runId !== entry.runId) return;
    const next = logs.length >= MAX_LOG_LINES ? logs.slice(logs.length - MAX_LOG_LINES + 1) : logs;
    logs = [...next, entry];
  }

  function handleStop() {
    stopRun('Stopped by user.');
    sketchError = null;
    previewStatus = 'stopped';
  }

  function confirmRestoreExample() {
    if (!$activeSketch) return;
    const id = $activeSketch.id;
    flushPendingSave();
    stopRun('Restore example.');
    if (restoreOriginalExample(id)) {
      const restored = get(sketches).find((s) => s.id === id);
      if (restored) applySketchSelection(restored.id, restored.source, restored.name);
    }
    restoreConfirmOpen = false;
  }

  function commitRename() {
    if (!$activeSketch) return;
    renameSketch($activeSketch.id, draftName);
    renaming = false;
  }

  function cancelRename() {
    draftName = $activeSketch?.name ?? '';
    renaming = false;
  }

  async function handleNewSketch() {
    createSection.set('sketches');
    flushPendingSave();
    stopRun('New sketch.');
    createSketch();
    renaming = true;
    focusTitlePending = true;
    await tick();
  }

  function handleSelectSketch(id: string) {
    createSection.set('sketches');
    if ($activeSketch?.id === id) return;
    flushPendingSave();
    stopRun('Switched sketches.');
    selectSketch(id);
  }

  async function handleUseExample(exampleId: string) {
    flushPendingSave();
    stopRun('Use example.');
    const sketch = useExample(exampleId);
    if (!sketch) return;
    createSection.set('sketches');
    applySketchSelection(sketch.id, sketch.source, sketch.name);
    // Trusted built-in content may auto-run after an explicit Use example.
    await tick();
    await runSketch();
  }

  function handleRenameFromMenu(id: string) {
    handleSelectSketch(id);
    renaming = true;
    focusTitlePending = true;
  }

  function confirmDelete() {
    if (!deleteTargetId) return;
    if (deleteTargetId === $activeSketch?.id) {
      flushPendingSave();
      stopRun('Deleted sketch.');
    }
    deleteSketch(deleteTargetId);
    deleteTargetId = null;
  }

  function onSplitPointerDown(event: PointerEvent) {
    dragging = true;
    (event.currentTarget as HTMLElement).setPointerCapture(event.pointerId);
  }

  function onSplitPointerMove(event: PointerEvent) {
    if (!dragging || !splitEl) return;
    const rect = splitEl.getBoundingClientRect();
    if (rect.width <= 0) return;
    const next = (event.clientX - rect.left) / rect.width;
    splitRatio = Math.min(0.75, Math.max(0.35, next));
  }

  function onSplitPointerUp() {
    if (!dragging) return;
    dragging = false;
    updatePreferences({ createEditorRatio: splitRatio });
  }
</script>

<div class="workspace">
<SketchLibrary
  sketches={$sketches}
  activeSketchId={$activeSketch?.id ?? null}
  {browsingExamples}
  {dirtySketchIds}
  onNewSketch={() => void handleNewSketch()}
  onSelectSketch={handleSelectSketch}
  onBrowseExamples={() => createSection.set('examples')}
  onRename={handleRenameFromMenu}
  onDuplicate={(id) => {
    duplicateSketch(id);
    createSection.set('sketches');
  }}
  onDelete={(id) => (deleteTargetId = id)}
/>

<MainSection
  title="Create motion with code"
  description="Write a p5.js sketch that describes where each brush should be over time, then run it to preview the drawing."
>
  {#snippet actions()}
    {#if !browsingExamples && $activeSketch}
      <button
        type="button"
        class="btn btn--accent"
        disabled={starting || !draftSource.trim()}
        title="Run the sketch (⌘/Ctrl + Enter)"
        onclick={() => void runSketch()}
      >
        {starting ? 'Starting…' : isLive ? 'Run again' : 'Run'}
      </button>
      <button
        type="button"
        class="btn"
        disabled={!isLive && !starting}
        onclick={handleStop}
      >
        Stop
      </button>
      {#if $activeSketch.exampleId}
        <button
          type="button"
          class="btn btn--ghost"
          disabled={starting}
          onclick={() => (restoreConfirmOpen = true)}
        >
          Restore original
        </button>
      {/if}
    {/if}
  {/snippet}

  {#if browsingExamples}
    <ExampleGallery onUseExample={(id) => void handleUseExample(id)} />
  {:else if !$activeSketch}
    <div class="panel panel--soft empty-stage">
      <h2>No sketch selected</h2>
      <p>Create a new sketch or use a built-in example to begin.</p>
      <div class="btn-row">
        <button type="button" class="btn btn--primary" onclick={() => void handleNewSketch()}>
          New sketch
        </button>
        <button type="button" class="btn" onclick={() => createSection.set('examples')}>
          Browse examples
        </button>
      </div>
    </div>
  {:else}
    <div class="stage">
      <div class="stage__toolbar">
        {#if renaming}
          <div class="rename">
            <label class="visually-hidden" for="sketch-name">Sketch name</label>
            <input
              id="sketch-name"
              bind:this={titleInput}
              type="text"
              bind:value={draftName}
              maxlength="64"
              onkeydown={(event) => {
                if (event.key === 'Enter') commitRename();
                if (event.key === 'Escape') cancelRename();
              }}
              onblur={commitRename}
            />
          </div>
        {:else}
          <button
            type="button"
            class="stage__title"
            title="Click to rename"
            onclick={() => {
              renaming = true;
              focusTitlePending = true;
            }}
          >
            {$activeSketch.name}
          </button>
        {/if}
        <span class="stage__chip" data-tone={previewStatus}>{statusChip}</span>
        <span class="stage__meta mono">{canvasLabel}</span>
      </div>

      <div class="stage__transport">
        <PlaybackControls />
        <Timeline lanes={false} />
      </div>
      <MotionReadout />

      <ParametersPanel />

      <div class="stage__split" bind:this={splitEl} style={`--editor-ratio: ${splitRatio}`}>
        <div class="stage__editor">
          <CodeEditor
            value={draftSource}
            syncKey={editorSyncKey}
            onChange={persistSource}
            onRun={() => void runSketch()}
          />
        </div>
        <button
          type="button"
          class="stage__divider"
          aria-label="Drag to resize editor and preview"
          onpointerdown={onSplitPointerDown}
          onpointermove={onSplitPointerMove}
          onpointerup={onSplitPointerUp}
          onpointercancel={onSplitPointerUp}
        ></button>
        <div class="stage__preview">
          <PreviewPanel
            error={sketchError}
            status={previewStatus}
            {logs}
            bindRunner={(next) => (runner = next)}
            onRuntimeError={handleRuntimeError}
            onRuntimeLog={handleRuntimeLog}
            onClearLogs={() => (logs = [])}
          />
        </div>
      </div>

      <p class="help-text">
        The sketch runs in an isolated sandbox with p5.js in global mode. The timeline above is the
        only clock: play, pause, and seek drive <code>draw()</code> through <code>millis()</code> and
        sample <code>motion(t)</code> for Simulate. Declare <code>scorePeriod()</code> to loop a finite
        score. Without it, playback is continuous. The parameter controls update a running sketch
        immediately. A change to this source still needs Run. Coordinates stay in canvas units.
      </p>
    </div>
  {/if}
</MainSection>
</div>

<ConfirmDialog
  open={deleteTargetId !== null}
  title="Delete sketch?"
  message={deleteTarget ? `Delete “${deleteTarget.name}”? This cannot be undone.` : 'Delete this sketch?'}
  confirmLabel="Delete"
  tone="caution"
  onConfirm={confirmDelete}
  onCancel={() => (deleteTargetId = null)}
/>

<ConfirmDialog
  open={restoreConfirmOpen}
  title="Restore original example?"
  message="Replace your current source with the built-in example? Your edits in this sketch will be overwritten."
  confirmLabel="Restore"
  tone="caution"
  onConfirm={confirmRestoreExample}
  onCancel={() => (restoreConfirmOpen = false)}
/>

<style>
  .workspace {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }

  .stage {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    flex: 1 1 auto;
    min-height: 0;
    min-width: 0;
  }

  .stage__toolbar {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex-wrap: wrap;
    flex: none;
  }

  .stage__transport {
    display: grid;
    grid-template-columns: minmax(220px, 280px) minmax(0, 1fr);
    gap: var(--space-2);
    align-items: start;
    flex: none;
  }

  .stage__title {
    border: 0;
    background: transparent;
    padding: 0;
    margin: 0;
    font-family: var(--font-title);
    font-size: 18px;
    font-weight: 500;
    color: var(--color-text);
    cursor: text;
    text-align: left;
  }

  .stage__title:hover,
  .stage__title:focus-visible {
    text-decoration: underline;
    text-underline-offset: 3px;
  }

  .stage__chip {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
    color: var(--color-text-muted);
    border: var(--border);
    border-radius: 2px;
    padding: 2px 8px;
  }

  .stage__chip[data-tone='live'],
  .stage__chip[data-tone='paused'] {
    border-color: var(--brand-turquoise);
    background: var(--brand-turquoise);
    color: var(--brand-deep-purple);
  }

  .stage__chip[data-tone='stale'] {
    border-color: var(--brand-deep-purple);
    color: var(--brand-deep-purple);
  }

  .stage__chip[data-tone='error'],
  .stage__chip[data-tone='timeout'] {
    border-color: var(--color-danger);
    color: var(--color-danger);
  }

  .stage__meta {
    margin-left: auto;
    font-size: 11px;
    color: var(--color-text-muted);
  }

  .stage__split {
    --editor-ratio: 0.55;
    display: grid;
    grid-template-columns: minmax(200px, calc(var(--editor-ratio) * 100%)) 8px minmax(200px, 1fr);
    gap: 0;
    flex: 1 1 auto;
    min-height: 420px;
    min-width: 0;
  }

  .stage__editor,
  .stage__preview {
    min-height: 0;
    min-width: 0;
  }

  .stage__divider {
    border: 0;
    padding: 0;
    margin: 0 var(--space-1);
    cursor: col-resize;
    background: transparent;
    position: relative;
  }

  .stage__divider::after {
    content: '';
    position: absolute;
    inset: 0 2px;
    border-radius: 2px;
    background: var(--color-border-strong);
  }

  .stage__divider:hover::after,
  .stage__divider:focus-visible::after {
    background: var(--brand-pink);
  }

  .rename {
    flex: 1;
    min-width: 0;
  }

  .rename input {
    width: 100%;
    max-width: 420px;
    font-family: var(--font-title);
    font-size: 18px;
    border: var(--border-strong);
    border-radius: var(--radius);
    padding: var(--space-1) var(--space-2);
  }

  .empty-stage {
    padding: var(--space-4);
  }

  @media (max-width: 640px) {
    .workspace {
      flex-direction: column;
    }
  }

  @media (max-width: 900px) {
    .stage__split {
      grid-template-columns: 1fr;
      grid-template-rows: minmax(220px, 1fr) 8px minmax(260px, 1fr);
    }

    .stage__divider {
      cursor: row-resize;
      margin: var(--space-1) 0;
    }

    .stage__meta {
      margin-left: 0;
      width: 100%;
    }

    .stage__transport {
      grid-template-columns: 1fr;
    }
  }
</style>
