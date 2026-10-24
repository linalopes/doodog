<script lang="ts">
  import type { Snippet } from 'svelte';
  import BrandPattern from './BrandPattern.svelte';

  interface Props {
    title: string;
    description: string;
    /** Milestone label, e.g. "Planned · Phase 02". */
    tag?: string;
    seed?: number;
    /** Extra content rendered under the description. */
    children?: Snippet;
    /** Fills the available height instead of sizing to content. */
    grow?: boolean;
  }

  let { title, description, tag, seed = 7, children, grow = true }: Props = $props();
</script>

<div class="empty" class:empty--grow={grow}>
  <BrandPattern {seed} />
  <div class="empty__content">
    {#if tag}
      <span class="badge">{tag}</span>
    {/if}
    <h2 class="empty__title">{title}</h2>
    <p class="empty__description">{description}</p>
    {#if children}
      <div class="empty__extra">
        {@render children()}
      </div>
    {/if}
  </div>
</div>

<style>
  .empty {
    position: relative;
    display: flex;
    align-items: center;
    justify-content: center;
    border: var(--border);
    border-radius: var(--radius);
    background: var(--brand-white);
    padding: var(--space-6) var(--space-4);
    overflow: hidden;
  }

  .empty--grow {
    flex: 1 1 auto;
    min-height: 280px;
  }

  .empty__content {
    position: relative;
    max-width: 52ch;
    text-align: center;
    display: flex;
    flex-direction: column;
    align-items: center;
    gap: var(--space-3);
    background: color-mix(in srgb, var(--brand-white) 90%, transparent);
    padding: var(--space-4);
    border-radius: var(--radius);
  }

  .empty__title {
    font-size: 24px;
    margin: 0;
  }

  .empty__description {
    margin: 0;
    color: var(--color-text-muted);
  }

  .empty__extra {
    display: flex;
    gap: var(--space-2);
    flex-wrap: wrap;
    justify-content: center;
    width: 100%;
  }
</style>
