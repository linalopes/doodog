<script lang="ts">
  /**
   * Creative parameters for the running sketch.
   *
   * Create and Simulate render this same panel. Both read `creativeParams`.
   * Paper size, brush mounts, and the robot pose are not edited here.
   */
  import {
    creativeParams,
    editCreativeParam,
    flushCreativeParams,
  } from '../../params/store';
  import type { ParamControl, ParamValue } from '../../params/types';

  const state = $derived($creativeParams);
  const running = $derived(state.runId !== null);

  function shown(control: ParamControl): ParamValue {
    return state.values[control.key] ?? control.value;
  }

  function onNumber(control: ParamControl, raw: string): boolean {
    const value = Number(raw);
    if (!Number.isFinite(value)) return false;
    return editCreativeParam(control.key, value);
  }
</script>

<section class="params" data-role="creative-params" aria-label="Sketch parameters">
  <div class="params__head">
    <h2 class="section-label">Parameters</h2>
    <span class="tag">{running ? 'Live' : 'Idle'}</span>
  </div>
  <p class="params__note">
    These values are the sketch’s <code>params</code>. They update the drawing and the robot
    together. They do not move the paper or the brush mounts. Editing the source still needs Run.
  </p>

  {#if !running}
    <p class="params__empty">Run a sketch to edit its parameters.</p>
  {:else if state.controls.length === 0}
    <p class="params__empty">
      This sketch does not declare <code>params</code>. It still runs. Add
      <code>const params = &#123; &#125;</code> when you want controls.
    </p>
  {:else}
    <div class="params__grid">
      {#each state.controls as control (control.key)}
        {#if control.kind === 'number'}
          {@const current = shown(control)}
          {@const numeric = typeof current === 'number' ? current : 0}
          <label class="field">
            <span class="field__label">{control.label}</span>
            <input
              type="range"
              min={control.min}
              max={control.max}
              step={control.step}
              value={numeric}
              aria-valuemin={control.min}
              aria-valuemax={control.max}
              aria-valuenow={numeric}
              oninput={(event) => onNumber(control, event.currentTarget.value)}
              onchange={() => flushCreativeParams()}
            />
            <input
              type="number"
              min={control.min}
              max={control.max}
              step={control.step}
              value={numeric}
              onchange={(event) => {
                const input = event.currentTarget;
                if (!onNumber(control, input.value)) input.value = String(numeric);
                else flushCreativeParams();
              }}
            />
          </label>
        {:else if control.kind === 'boolean'}
          <label class="field params__check">
            <span class="field__label">{control.label}</span>
            <input
              type="checkbox"
              checked={shown(control) === true}
              onchange={(event) => {
                editCreativeParam(control.key, event.currentTarget.checked);
                flushCreativeParams();
              }}
            />
          </label>
        {:else if control.kind === 'enum'}
          <label class="field">
            <span class="field__label">{control.label}</span>
            <select
              value={String(shown(control))}
              onchange={(event) => {
                editCreativeParam(control.key, event.currentTarget.value);
                flushCreativeParams();
              }}
            >
              {#each control.options ?? [] as option (option)}
                <option value={option}>{option}</option>
              {/each}
            </select>
          </label>
        {:else}
          <label class="field">
            <span class="field__label">{control.label}</span>
            <input
              type="text"
              maxlength="80"
              value={String(shown(control))}
              oninput={(event) => editCreativeParam(control.key, event.currentTarget.value)}
              onchange={() => flushCreativeParams()}
            />
          </label>
        {/if}
      {/each}
    </div>
  {/if}
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

  .params__note,
  .params__empty {
    margin: 0;
    font-size: 12px;
    color: var(--color-text-muted);
    max-width: 78ch;
  }

  .params__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--space-3);
  }

  .params__check {
    flex-direction: row;
    align-items: center;
    justify-content: space-between;
  }

  .field input[type='range'] {
    width: 100%;
  }
</style>
