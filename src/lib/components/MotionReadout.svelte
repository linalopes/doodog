<script lang="ts">
  import { motionOutput } from '../motion/output';
  import { timeline } from '../motion/timeline';
  import { playbackMode } from '../motion/timelineMath';
  import { activeSketch } from '../sketches/store';
  import type { BrushTarget } from '../motion/types';
  import { channelRole } from '../motion/types';
  import { formatSeconds } from '../utils/misc';

  /**
   * One live MotionFrame. The grid keeps a fixed height while coordinates,
   * contact, and playback change, so Create and Simulate do not jump.
   */
  const playLabel = $derived(
    $timeline.playState === 'playing' ? 'Playing' : $timeline.playState === 'paused' ? 'Paused' : 'Stopped',
  );

  const durationLabel = $derived(
    playbackMode($timeline.durationSeconds) === 'continuous'
      ? 'Continuous'
      : `Loop ${formatSeconds($timeline.durationSeconds ?? 0)}`,
  );

  const frame = $derived($motionOutput.frame);
  const sketchName = $derived($activeSketch?.name ?? 'No sketch');

  function brushParts(brush: BrushTarget | undefined): { coords: string; status: string } {
    if (!brush) return { coords: '—', status: '—' };
    const role = channelRole(brush);
    const label = role === 'drawing' ? 'drawing' : role === 'travel' ? 'travel' : 'resting';
    return {
      coords: `${brush.x.toFixed(1)}, ${brush.y.toFixed(1)}`,
      status: `${brush.contact ? 'down' : 'up'} · ${label}`,
    };
  }

  const left = $derived(brushParts(frame?.left));
  const right = $derived(brushParts(frame?.right));
</script>

<div class="readout" aria-label="Motion sample">
  <div class="readout__grid">
    <div class="readout__summary">
      <span class="readout__name" title={sketchName}>{sketchName}</span>
      <span class="mono readout__state">{playLabel}</span>
      <span class="mono readout__time">{formatSeconds($timeline.time)}</span>
      <span class="mono readout__mode">{durationLabel}</span>
    </div>

    {#if $motionOutput.frame}
      <div class="readout__channels">
        <div class="readout__channel">
          <span class="readout__label">Left</span>
          <span class="mono readout__coords">{left.coords}</span>
          <span class="mono readout__status">{left.status}</span>
        </div>
        <div class="readout__channel">
          <span class="readout__label">Right</span>
          <span class="mono readout__coords">{right.coords}</span>
          <span class="mono readout__status">{right.status}</span>
        </div>
      </div>
    {:else if $motionOutput.status !== 'error'}
      <p class="readout__empty">Run a sketch in Create to sample <code>motion(t)</code>.</p>
    {/if}

    {#if $motionOutput.status === 'error'}
      <p class="readout__error" role="status">{$motionOutput.errorMessage}</p>
    {/if}
  </div>
</div>

<style>
  /*
    Width follows the readout itself, not the viewport. Create's stage can be
    a narrow column inside a wide window. Breakpoints stay fixed so playback
    never switches between one and two rows.
  */
  .readout {
    container: readout / inline-size;
    min-width: 0;
  }

  .readout__grid {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    grid-template-rows: 1.4em minmax(calc(1.4em * 2 + var(--space-1)), auto);
    row-gap: var(--space-1);
    min-width: 0;
    font-size: 13px;
    line-height: 1.4;
  }

  .readout__summary {
    display: grid;
    grid-template-columns: minmax(0, 1fr) 7ch minmax(8ch, max-content) max-content;
    column-gap: var(--space-2);
    align-items: center;
    min-width: 0;
  }

  .readout__name {
    min-width: 0;
    overflow: hidden;
    font-family: var(--font-title);
    font-weight: 500;
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .readout__state,
  .readout__time,
  .readout__mode,
  .readout__coords,
  .readout__status {
    font-variant-numeric: tabular-nums;
    white-space: nowrap;
  }

  .readout__state {
    min-width: 7ch;
  }

  .readout__mode {
    min-width: 12ch;
    color: var(--color-text-muted);
  }

  .readout__channels {
    display: grid;
    grid-template-columns: minmax(0, 1fr);
    row-gap: var(--space-1);
    align-items: center;
    min-width: 0;
  }

  .readout__channel {
    display: grid;
    grid-template-columns: auto minmax(13ch, 1fr) minmax(14ch, max-content);
    column-gap: var(--space-2);
    align-items: center;
    min-width: 0;
    min-height: 1.4em;
  }

  .readout__label {
    color: var(--color-text-muted);
  }

  .readout__coords {
    min-width: 13ch;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .readout__status {
    min-width: 14ch;
  }

  .readout__empty {
    margin: 0;
    overflow: hidden;
    font-size: 12px;
    line-height: 1.4;
    color: var(--color-text-muted);
    white-space: nowrap;
    text-overflow: ellipsis;
  }

  .readout__error {
    margin: 0;
    font-size: 12px;
    line-height: 1.4;
    color: var(--color-danger);
  }

  /* Two one-line brush cells once each cell can hold a normal coordinate. */
  @container readout (min-width: 40rem) {
    .readout__grid {
      grid-template-rows: 1.4em minmax(1.4em, auto);
    }

    .readout__channels {
      grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
      column-gap: var(--space-3);
      row-gap: 0;
    }
  }

  /* Below this, a one-line channel would crush "600.0, 600.0". */
  @container readout (max-width: 22rem) {
    .readout__grid {
      grid-template-rows: auto minmax(calc(1.4em * 4 + var(--space-1)), auto);
    }

    .readout__summary {
      grid-template-columns: minmax(0, 1fr) max-content;
      grid-template-areas:
        "name state"
        "time mode";
      row-gap: 0;
    }

    .readout__name {
      grid-area: name;
    }

    .readout__state {
      grid-area: state;
    }

    .readout__time {
      grid-area: time;
    }

    .readout__mode {
      grid-area: mode;
      justify-self: end;
    }

    .readout__channel {
      grid-template-columns: auto minmax(13ch, 1fr);
      row-gap: 0;
    }

    .readout__status {
      grid-column: 1 / -1;
    }

    .readout__empty {
      white-space: normal;
    }
  }
</style>
