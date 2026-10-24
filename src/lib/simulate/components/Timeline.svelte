<script lang="ts">
  import { seek, timeline } from '../../motion/timeline';
  import { scrubMaximum } from '../../motion/timelineMath';
  import { formatSeconds } from '../../utils/misc';

  /**
   * Scrubber for the shared timeline. A declared period is the range.
   * Continuous playback uses a moving window; that window is not a score length.
   */
  interface Props {
    lanes?: boolean;
  }

  let { lanes = true }: Props = $props();

  const maximum = $derived(scrubMaximum($timeline));
  const finite = $derived($timeline.durationSeconds !== null && $timeline.durationSeconds > 0);
</script>

<div class="timeline" aria-label="Timeline">
  <div class="timeline__header">
    <span class="section-label">Timeline</span>
    <span class="mono timeline__time">
      {formatSeconds($timeline.time)}
      {#if !finite}
        · window {formatSeconds(maximum)}
      {/if}
    </span>
  </div>
  <input
    class="timeline__range"
    type="range"
    min="0"
    max={maximum}
    step="0.01"
    value={$timeline.time}
    aria-label="Seek in the score"
    aria-valuemin={0}
    aria-valuemax={maximum}
    aria-valuenow={$timeline.time}
    aria-valuetext={formatSeconds($timeline.time)}
    oninput={(event) => {
      const next = Number(event.currentTarget.value);
      if (Number.isFinite(next)) seek(next);
    }}
  />
  {#if lanes}
    <div class="timeline__lanes" aria-hidden="true">
      <div class="timeline__lane"><span class="timeline__lane-label">Left brush</span></div>
      <div class="timeline__lane"><span class="timeline__lane-label">Right brush</span></div>
    </div>
  {/if}
  <p class="help-text">
    {#if finite}
      Drag to seek. Moving backward redraws the score from the start, so later marks disappear.
    {:else}
      This score did not declare <code>scorePeriod()</code>. The scrubber is a window onto the clock, not a score length.
    {/if}
  </p>
</div>

<style>
  .timeline {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--brand-white);
    padding: var(--space-3);
  }

  .timeline__header {
    display: flex;
    justify-content: space-between;
    align-items: baseline;
    gap: var(--space-2);
  }

  .timeline__time {
    font-size: 12px;
  }

  .timeline__range {
    width: 100%;
    margin: 0;
    accent-color: var(--brand-pink);
  }

  .timeline__lanes {
    display: flex;
    flex-direction: column;
    gap: 2px;
    margin-top: var(--space-1);
  }

  .timeline__lane {
    height: 22px;
    border-radius: var(--radius);
    background: var(--color-surface-tint);
    display: flex;
    align-items: center;
    padding: 0 var(--space-2);
  }

  .timeline__lane-label {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }
</style>
