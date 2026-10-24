<script lang="ts">
  import { motionOutput } from '../motion/output';
  import { timeline } from '../motion/timeline';
  import { playbackMode } from '../motion/timelineMath';
  import { activeSketch } from '../sketches/store';
  import type { BrushTarget } from '../motion/types';
  import { formatSeconds } from '../utils/misc';

  /**
   * The pose the future Three.js adapter will read. One frame, not a log.
   */
  const playLabel = $derived(
    $timeline.playState === 'playing' ? 'Playing' : $timeline.playState === 'paused' ? 'Paused' : 'Stopped',
  );

  const durationLabel = $derived(
    playbackMode($timeline.durationSeconds) === 'continuous'
      ? 'Continuous'
      : `Loop ${formatSeconds($timeline.durationSeconds ?? 0)}`,
  );

  function brushText(brush: BrushTarget | undefined): string {
    if (!brush) return '—';
    return `${brush.x.toFixed(1)}, ${brush.y.toFixed(1)} · ${brush.contact ? 'down' : 'up'}`;
  }
</script>

<div class="readout" aria-label="Motion sample">
  <p class="readout__summary">
    <span class="readout__name">{$activeSketch?.name ?? 'No sketch'}</span>
    <span class="mono">{playLabel}</span>
    <span class="mono">{formatSeconds($timeline.time)}</span>
    <span class="mono readout__mode">{durationLabel}</span>
  </p>
  {#if $motionOutput.status === 'error'}
    <p class="readout__error" role="status">{$motionOutput.errorMessage}</p>
  {:else if $motionOutput.frame}
    <p class="mono readout__brushes">
      Left {$motionOutput.frame ? brushText($motionOutput.frame.left) : '—'}
      <span class="readout__dot">·</span>
      Right {$motionOutput.frame ? brushText($motionOutput.frame.right) : '—'}
    </p>
  {:else}
    <p class="help-text">Run a sketch in Create to sample <code>motion(t)</code>.</p>
  {/if}
</div>

<style>
  .readout {
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .readout__summary {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: baseline;
    margin: 0;
    font-size: 13px;
  }

  .readout__name {
    font-family: var(--font-title);
    font-weight: 500;
  }

  .readout__mode,
  .readout__dot {
    color: var(--color-text-muted);
  }

  .readout__brushes {
    margin: 0;
    font-size: 12px;
  }

  .readout__error {
    margin: 0;
    font-size: 13px;
    color: var(--color-danger);
  }
</style>
