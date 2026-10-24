<script lang="ts">
  import { onMount } from 'svelte';
  import { motionOutput } from '../../motion/output';
  import { motionTrail } from '../../motion/trail';
  import type { MotionFrame } from '../../motion/types';
  import type { SimConfig } from '../go2/defaults';
  import { interpretFrame, PREVIEW_LABEL, type TrailMark } from '../go2/pose';
  import { kinematicPose, setHelper, simSettings } from '../go2/settings';
  import { createGo2View, type CameraView, type Go2View } from '../scene/createGo2View';

  let host: HTMLDivElement | undefined = $state();
  let ready = $state(false);
  let loadError = $state('');
  let view: Go2View | null = null;
  let unreachableSamples = $state(0);

  const cache: { key: string; fingerprints: string[]; marks: TrailMark[] } = {
    key: '',
    fingerprints: [],
    marks: [],
  };

  function frameFingerprint(frame: MotionFrame): string {
    return [
      frame.time,
      frame.left.x,
      frame.left.y,
      frame.left.contact,
      frame.right.x,
      frame.right.y,
      frame.right.contact,
    ].join('|');
  }

  function syncMarks(
    frames: readonly MotionFrame[],
    canvas: { width: number; height: number } | null,
    config: SimConfig,
  ): TrailMark[] {
    const key = JSON.stringify({ canvas, config });
    const prefix =
      cache.key === key &&
      frames.length >= cache.fingerprints.length &&
      cache.fingerprints.every((fingerprint, index) => {
        const frame = frames[index];
        return frame !== undefined && frameFingerprint(frame) === fingerprint;
      });
    if (!prefix) {
      cache.key = key;
      cache.fingerprints = [];
      cache.marks = [];
    }
    for (let index = cache.fingerprints.length; index < frames.length; index += 1) {
      const frame = frames[index];
      if (!frame) continue;
      cache.marks.push(...interpretFrame(frame, canvas, config).marks);
      cache.fingerprints.push(frameFingerprint(frame));
    }
    return cache.marks;
  }

  onMount(() => {
    if (!host) return;
    const created = createGo2View(host, {
      onReady: () => {
        ready = true;
      },
      onError: (message) => {
        loadError = message;
      },
    });
    view = created;
    const observer = new ResizeObserver(() => created.resize());
    observer.observe(host);
    return () => {
      observer.disconnect();
      created.dispose();
      view = null;
    };
  });

  $effect(() => {
    if (!ready || !view) return;
    const config = $simSettings;
    const pose = $kinematicPose;
    const trail = $motionTrail;
    const canvas = $motionOutput.canvas;
    view.setHelpers(config.showGrid, config.showFrames);
    view.setBrushes(config.brushes.left, config.brushes.right);
    if (pose) view.setPose(pose);
    const marks = syncMarks(trail, canvas, config);
    view.setMarks(marks);
    let unreachable = 0;
    for (const mark of marks) {
      if (mark.contactRequested && mark.reachable === false) unreachable += 1;
    }
    if (unreachable !== unreachableSamples) unreachableSamples = unreachable;
  });

  function selectView(next: CameraView): void {
    view?.setView(next);
  }

  const pose = $derived($kinematicPose);
</script>

<div class="viewport">
  <div class="viewport__stage" bind:this={host} data-role="simulation-viewport"></div>

  <div class="viewport__overlay">
    <p class="viewport__banner">{PREVIEW_LABEL}</p>
    <p class="viewport__note">
      Geometric preview of paint. A reachable pose is not dynamically safe, and contact is not a physics result.
    </p>
    {#if pose}
      <p class="mono viewport__reach">
        FL {pose.legs.FL.reachable === null ? 'held' : pose.legs.FL.reachable ? 'reachable' : 'unreachable'}
        {#if pose.legs.FL.positionErrorM !== null}
          · {(pose.legs.FL.positionErrorM * 1000).toFixed(0)} mm
        {/if}
        <span class="viewport__dot">·</span>
        FR {pose.legs.FR.reachable === null ? 'held' : pose.legs.FR.reachable ? 'reachable' : 'unreachable'}
        {#if pose.legs.FR.positionErrorM !== null}
          · {(pose.legs.FR.positionErrorM * 1000).toFixed(0)} mm
        {/if}
        {#if pose.manual}
          <span class="viewport__dot">·</span> manual
        {/if}
        {#if pose.canvasAssumed}
          <span class="viewport__dot">·</span> canvas 600×600 assumed
        {/if}
        {#if pose.legs.FL.onLimit || pose.legs.FR.onLimit}
          <span class="viewport__dot">·</span> joint limit
        {/if}
      </p>
      {#if unreachableSamples > 0}
        <p class="viewport__note">
          {unreachableSamples} unreachable
          {unreachableSamples === 1 ? 'sample' : 'samples'} on this trail. The drawing was not rescaled.
        </p>
      {/if}
    {/if}
  </div>

  <div class="viewport__bar">
    <div class="viewport__views" role="group" aria-label="Camera">
      <button type="button" class="btn btn--small" onclick={() => selectView('perspective')}>Perspective</button>
      <button type="button" class="btn btn--small" onclick={() => selectView('top')}>Top</button>
      <button type="button" class="btn btn--small" onclick={() => selectView('side')}>Side</button>
    </div>
    <div class="viewport__views" role="group" aria-label="Scene helpers">
      <button
        type="button"
        class="btn btn--small"
        aria-pressed={$simSettings.showGrid}
        onclick={() => setHelper('showGrid', !$simSettings.showGrid)}
      >
        Grid
      </button>
      <button
        type="button"
        class="btn btn--small"
        aria-pressed={$simSettings.showFrames}
        onclick={() => setHelper('showFrames', !$simSettings.showFrames)}
      >
        Frames
      </button>
    </div>
    <p class="viewport__legend">
      <span><i class="swatch swatch--desired"></i> Desired</span>
      <span><i class="swatch swatch--achieved"></i> Achieved tip</span>
      <span><i class="swatch swatch--paint"></i> Geometric paint</span>
    </p>
  </div>

  {#if !ready && !loadError}
    <p class="viewport__status">Loading the Unitree Go2 model…</p>
  {/if}
  {#if loadError}
    <p class="viewport__status viewport__status--error" role="alert">{loadError}</p>
  {/if}
</div>

<style>
  .viewport {
    position: relative;
    flex: 1 1 auto;
    min-height: 420px;
    border: var(--border-strong);
    border-radius: var(--radius);
    overflow: hidden;
    background: #f4f7f7;
  }

  .viewport__stage {
    position: absolute;
    inset: 0;
  }

  .viewport__stage :global(canvas) {
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
  }

  .viewport__overlay {
    position: absolute;
    top: var(--space-2);
    left: var(--space-2);
    right: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: 2px;
    pointer-events: none;
    max-width: 46rem;
  }

  .viewport__banner,
  .viewport__note,
  .viewport__reach {
    margin: 0;
    background: rgba(255, 255, 255, 0.9);
    border-radius: var(--radius);
    padding: 2px 8px;
    width: fit-content;
    max-width: 100%;
  }

  .viewport__banner {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--brand-deep-purple);
  }

  .viewport__note,
  .viewport__reach {
    font-size: 12px;
    color: var(--color-text-muted);
  }

  .viewport__dot {
    margin: 0 0.3em;
  }

  .viewport__bar {
    position: absolute;
    left: var(--space-2);
    right: var(--space-2);
    bottom: var(--space-2);
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    justify-content: space-between;
  }

  .viewport__views {
    display: flex;
    gap: var(--space-1);
    background: rgba(255, 255, 255, 0.9);
    border-radius: var(--radius);
    padding: 4px;
  }

  .viewport__legend {
    margin: 0;
    display: flex;
    gap: var(--space-2);
    font-size: 12px;
    background: rgba(255, 255, 255, 0.9);
    border-radius: var(--radius);
    padding: 4px 8px;
  }

  .viewport__legend span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .swatch {
    width: 14px;
    height: 3px;
    display: inline-block;
  }

  .swatch--desired {
    background: repeating-linear-gradient(90deg, var(--brand-deep-purple) 0 5px, transparent 5px 8px);
  }

  .swatch--achieved {
    background: var(--brand-turquoise);
  }

  .swatch--paint {
    background: var(--brand-pink);
  }

  .viewport__status {
    position: absolute;
    inset: auto 16px 64px 16px;
    margin: 0;
    color: var(--color-text-muted);
  }

  .viewport__status--error {
    color: var(--color-danger);
  }
</style>
