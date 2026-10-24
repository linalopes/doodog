<script lang="ts">
  import type { Snippet } from 'svelte';

  interface Props {
    title: string;
    description?: string;
    /** Short status label, e.g. "Planned". */
    tag?: string;
    tagTone?: 'neutral' | 'accent' | 'primary';
    /** Controls rendered on the right of the section heading. */
    actions?: Snippet;
    children: Snippet;
  }

  let { title, description, tag, tagTone = 'neutral', actions, children }: Props = $props();
</script>

<!--
  Standard frame for the main workspace: a fixed-height heading chrome with a
  single scrolling body underneath, so the page itself never scrolls and the
  title band does not jump between tabs or sections.
-->
<section class="section" aria-label={title}>
  <div class="section-chrome section__chrome">
    <header class="section__header">
      <div class="section__heading">
        <h1 class="section__title">{title}</h1>
        {#if tag}
          <span
            class="badge"
            class:badge--accent={tagTone === 'accent'}
            class:badge--primary={tagTone === 'primary'}
          >
            {tag}
          </span>
        {/if}
      </div>
      {#if actions}
        <div class="section__actions">{@render actions()}</div>
      {/if}
    </header>

    <p class="section__description" class:section__description--empty={!description}>
      {description ?? ''}
    </p>
  </div>

  <div class="section__body">
    {@render children()}
  </div>
</section>

<style>
  .section {
    flex: 1 1 auto;
    min-width: 0;
    display: flex;
    flex-direction: column;
    min-height: 0;
    height: 100%;
    padding: var(--space-4) var(--space-5);
    gap: var(--space-3);
  }

  .section__chrome {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: var(--space-1);
    overflow: hidden;
  }

  .section__header {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: var(--space-3);
    flex: none;
    min-height: 40px;
    max-height: 40px;
    overflow: hidden;
  }

  .section__heading {
    display: flex;
    align-items: center;
    gap: var(--space-3);
    min-width: 0;
    overflow: hidden;
  }

  .section__title {
    font-size: 24px;
    line-height: 1.15;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .section__actions {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    flex: none;
    flex-wrap: nowrap;
    max-height: 40px;
    overflow: hidden;
  }

  .section__description {
    flex: none;
    margin: 0;
    color: var(--color-text-muted);
    line-height: 1.45;
    min-height: calc(1.45em * 2);
    max-height: calc(1.45em * 2);
    overflow: hidden;
    display: -webkit-box;
    -webkit-box-orient: vertical;
    -webkit-line-clamp: 2;
    line-clamp: 2;
  }

  .section__description--empty {
    visibility: hidden;
  }

  .section__body {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
    scrollbar-gutter: stable;
    display: flex;
    flex-direction: column;
    gap: var(--space-4);
    padding-bottom: var(--space-4);
  }

  @media (max-width: 900px) {
    .section {
      padding: var(--space-3) var(--space-3);
    }
  }
</style>
