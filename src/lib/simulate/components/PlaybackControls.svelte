<script lang="ts">
  import { timeline } from '../../motion/timeline';
  import { formatSeconds } from '../../utils/misc';

  /**
   * Playback controls bound to the shared timeline store.
   *
   * Disabled in Phase 01: nothing produces motion frames yet, so there is
   * nothing to play. The controls read the real store so that enabling them
   * later is a matter of wiring, not redesign.
   */
  const disabledReason = 'Playback becomes available once the 3D simulation exists (Phase 02).';
</script>

<div class="playback" aria-label="Playback controls" title={disabledReason}>
  <div class="playback__buttons">
    <button type="button" class="btn btn--small" disabled aria-label="Go to start">⏮</button>
    <button type="button" class="btn btn--accent btn--small" disabled aria-label="Play">▶</button>
    <button type="button" class="btn btn--small" disabled aria-label="Pause">⏸</button>
    <button type="button" class="btn btn--small" disabled aria-label="Stop">■</button>
  </div>
  <div class="playback__readout mono">
    <span>{formatSeconds($timeline.time)}</span>
    <span class="playback__sep">/</span>
    <span>{$timeline.durationSeconds === null ? '∞' : formatSeconds($timeline.durationSeconds)}</span>
    <span class="playback__rate">×{$timeline.rate}</span>
  </div>
  <p class="help-text">{disabledReason}</p>
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
</style>
