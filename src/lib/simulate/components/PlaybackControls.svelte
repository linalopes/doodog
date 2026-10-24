<script lang="ts">
  import { timeline, setPlayState, setRate, seek } from '../../motion/timeline';
  import { PLAYBACK_RATES, playbackMode } from '../../motion/timelineMath';
  import { formatSeconds } from '../../utils/misc';

  /**
   * Playback for the shared timeline. Create and Simulate both render this.
   * The buttons write the one timeline store; they do not keep a second clock.
   */
  const playing = $derived($timeline.playState === 'playing');
  const mode = $derived(playbackMode($timeline.durationSeconds));
</script>

<div class="playback" aria-label="Playback controls">
  <div class="playback__buttons">
    <button type="button" class="btn btn--small" aria-label="Go to start" onclick={() => seek(0)}>
      ⏮
    </button>
    <button
      type="button"
      class="btn btn--accent btn--small"
      aria-label="Play"
      aria-pressed={playing}
      onclick={() => setPlayState('playing')}
    >
      ▶
    </button>
    <button
      type="button"
      class="btn btn--small"
      aria-label="Pause"
      aria-pressed={$timeline.playState === 'paused'}
      onclick={() => setPlayState('paused')}
    >
      ⏸
    </button>
    <button
      type="button"
      class="btn btn--small"
      aria-label="Stop and reset"
      aria-pressed={$timeline.playState === 'stopped'}
      onclick={() => setPlayState('stopped')}
    >
      ■
    </button>
  </div>
  <div class="playback__readout mono">
    <span>{formatSeconds($timeline.time)}</span>
    <span class="playback__sep">/</span>
    <span>{$timeline.durationSeconds === null ? '∞' : formatSeconds($timeline.durationSeconds)}</span>
    <span class="playback__rate">×{$timeline.rate}</span>
  </div>
  <label class="playback__speed">
    <span class="section-label">Speed</span>
    <select
      aria-label="Playback speed"
      value={String($timeline.rate)}
      onchange={(event) => setRate(Number(event.currentTarget.value))}
    >
      {#each PLAYBACK_RATES as rate (rate)}
        <option value={String(rate)}>{rate}×</option>
      {/each}
    </select>
  </label>
  <p class="help-text">
    {#if mode === 'continuous'}
      Continuous playback. A score declares its length with <code>scorePeriod()</code>.
    {:else}
      Loops every {formatSeconds($timeline.durationSeconds ?? 0)}.
    {/if}
  </p>
</div>

<style>
  .playback {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .playback__buttons {
    display: flex;
    gap: var(--space-1);
  }

  .playback__buttons button[aria-pressed='true'] {
    border-color: var(--brand-deep-purple);
    background: var(--color-surface-tint);
  }

  .playback__readout {
    display: flex;
    gap: var(--space-1);
    font-size: 13px;
    color: var(--color-text);
  }

  .playback__sep,
  .playback__rate {
    color: var(--color-text-muted);
  }

  .playback__rate {
    margin-left: var(--space-2);
  }

  .playback__speed {
    display: flex;
    align-items: center;
    gap: var(--space-2);
  }

  .playback__speed select {
    font-family: var(--font-mono);
    font-size: 12px;
    color: var(--color-text);
    background: var(--brand-white);
    border: var(--border-strong);
    border-radius: var(--radius);
    padding: 4px 8px;
  }
</style>
