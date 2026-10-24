<script lang="ts">
  import { timeline, timelineProgress } from '../../motion/timeline';
  import { formatSeconds } from '../../utils/misc';

  /**
   * Timeline scrubber. Reserved: renders the shared timeline store but is not
   * interactive until motion frames exist.
   */
  const ticks = [0, 0.25, 0.5, 0.75, 1];
</script>

<div class="timeline" aria-label="Timeline (reserved)">
  <div class="timeline__header">
    <span class="section-label">Timeline</span>
    <span class="mono timeline__time">{formatSeconds($timeline.time)}</span>
  </div>
  <div
    class="timeline__track"
    role="slider"
    aria-valuemin="0"
    aria-valuemax="100"
    aria-valuenow={Math.round(($timelineProgress ?? 0) * 100)}
    aria-disabled="true"
    tabindex="-1"
  >
    <div class="timeline__fill" style={`width: ${($timelineProgress ?? 0) * 100}%`}></div>
    {#each ticks as tick (tick)}
      <span class="timeline__tick" style={`left: ${tick * 100}%`}></span>
    {/each}
    <span class="timeline__head" style={`left: ${($timelineProgress ?? 0) * 100}%`}></span>
  </div>
  <div class="timeline__lanes" aria-hidden="true">
    <div class="timeline__lane"><span class="timeline__lane-label">Left brush</span></div>
    <div class="timeline__lane"><span class="timeline__lane-label">Right brush</span></div>
  </div>
  <p class="help-text">
    Brush contact segments will be drawn on these lanes once the sketch runtime exposes
    <code>motion(t)</code> to the host.
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
  }

  .timeline__time {
    font-size: 12px;
  }

  .timeline__track {
    position: relative;
    height: 10px;
    border-radius: 999px;
    background: var(--color-surface);
    overflow: visible;
    opacity: 0.8;
  }

  .timeline__fill {
    position: absolute;
    inset: 0 auto 0 0;
    border-radius: 999px;
    background: var(--brand-pink);
  }

  .timeline__tick {
    position: absolute;
    top: -3px;
    width: 1px;
    height: 16px;
    background: var(--color-border-strong);
  }

  .timeline__head {
    position: absolute;
    top: -3px;
    width: 16px;
    height: 16px;
    margin-left: -8px;
    border-radius: 50%;
    background: var(--brand-white);
    border: 2px solid var(--brand-deep-purple);
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
