<script lang="ts">
  /**
   * Reserved home for sketch parameter controls.
   *
   * Phase 01 does not read or write the sketch's `params` object from the
   * host. The slots are disabled on purpose: they mark the layout the later
   * phase will fill, and they do not pretend to drive the preview.
   */
  const slots = [1, 2, 3] as const;
</script>

<section class="params" aria-label="Parameters, reserved for a later phase">
  <div class="params__head">
    <h2 class="section-label">Parameters</h2>
    <span class="tag">Reserved</span>
  </div>
  <p class="params__note">
    These controls will bind to the sketch’s <code>params</code> object, so one set of values
    drives the drawing, the simulation, and the robot. They are not connected in this phase.
    Edit <code>params</code> in the sketch.
  </p>
  <div class="params__slots">
    {#each slots as slot (slot)}
      <label class="field">
        <span class="field__label">Parameter {slot}</span>
        <input type="text" disabled placeholder="—" aria-disabled="true" />
      </label>
    {/each}
  </div>
</section>

<style>
  .params {
    flex: none;
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--color-surface-tint);
    padding: var(--space-2) var(--space-3);
  }

  .params__head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-2);
  }

  .params__head h2 {
    margin: 0;
  }

  .params__note {
    margin: 0;
    font-size: 12px;
    color: var(--color-text-muted);
    max-width: 78ch;
  }

  .params__slots {
    display: grid;
    grid-template-columns: repeat(3, minmax(0, 1fr));
    gap: var(--space-3);
  }

  @media (max-width: 640px) {
    .params__slots {
      grid-template-columns: 1fr;
    }
  }
</style>
