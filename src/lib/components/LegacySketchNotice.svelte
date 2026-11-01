<script lang="ts">
  import ConfirmDialog from './ConfirmDialog.svelte';
  import { requestExampleRestore } from '../sketches/exampleRestore';
  import { isUnchangedOlderExample } from '../sketches/legacyExample';
  import { activeSketch } from '../sketches/store';

  let open = $state(false);
  const sketch = $derived($activeSketch);
  const stale = $derived(isUnchangedOlderExample(sketch));
</script>

{#if stale && sketch}
  <div class="legacy" role="status">
    <p>
      <strong>This saved sketch uses an older motion definition. The unused brush may still move its robot leg.</strong>
    </p>
    <p>
      The current {sketch.name} example marks that channel resting. Update original replaces this saved
      copy with that example and runs it. Nothing is replaced until you confirm.
    </p>
    <div>
      <button type="button" class="btn btn--small" onclick={() => (open = true)}>Update original</button>
    </div>
  </div>
{/if}

<ConfirmDialog
  {open}
  title="Update this saved example?"
  message="Replace this saved copy with the current built-in example? The unused brush will rest, and the sketch will run."
  confirmLabel="Update and run"
  tone="caution"
  onConfirm={() => {
    const id = sketch?.id;
    open = false;
    if (id) requestExampleRestore(id);
  }}
  onCancel={() => (open = false)}
/>

<style>
  .legacy {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    border: var(--border-strong);
    border-left: 3px solid var(--brand-pink);
    border-radius: var(--radius);
    background: var(--brand-white);
    padding: var(--space-3);
  }

  .legacy p {
    margin: 0;
    color: var(--color-text);
    font-size: 13px;
    line-height: 1.45;
  }

  .legacy p + p {
    color: var(--color-text-muted);
  }
</style>
