<script lang="ts">
  import type { Sketch } from '../../sketches/types';

  interface Props {
    sketches: Sketch[];
    activeSketchId: string | null;
    browsingExamples: boolean;
    dirtySketchIds?: Set<string>;
    onNewSketch: () => void;
    onSelectSketch: (id: string) => void;
    onBrowseExamples: () => void;
    onRename: (id: string) => void;
    onDuplicate: (id: string) => void;
    onDelete: (id: string) => void;
  }

  let {
    sketches,
    activeSketchId,
    browsingExamples,
    dirtySketchIds = new Set(),
    onNewSketch,
    onSelectSketch,
    onBrowseExamples,
    onRename,
    onDuplicate,
    onDelete,
  }: Props = $props();

  let openMenuId = $state<string | null>(null);

  function formatUpdated(ts: number): string {
    try {
      return new Date(ts).toLocaleString(undefined, {
        month: 'short',
        day: 'numeric',
        hour: '2-digit',
        minute: '2-digit',
      });
    } catch {
      return '';
    }
  }

  function toggleMenu(id: string, event: MouseEvent) {
    event.stopPropagation();
    openMenuId = openMenuId === id ? null : id;
  }

  function closeMenu() {
    openMenuId = null;
  }
</script>

<svelte:window onclick={closeMenu} onkeydown={(e) => e.key === 'Escape' && closeMenu()} />

<aside class="library" aria-label="Sketch library">
  <div class="library__top">
    <button type="button" class="btn btn--primary library__new" onclick={onNewSketch}>
      + New sketch
    </button>
  </div>

  <div class="library__body">
    <p class="section-label">My sketches</p>
    <p class="library__local mono">Saved locally in this browser</p>

    {#if sketches.length === 0}
      <p class="library__empty muted">No sketches yet. Create one or use an example.</p>
    {:else}
      <ul class="library__list" role="list">
        {#each sketches as sketch (sketch.id)}
          <li class="library__row">
            <button
              type="button"
              class="library__item"
              class:library__item--active={!browsingExamples && activeSketchId === sketch.id}
              aria-current={!browsingExamples && activeSketchId === sketch.id ? 'true' : undefined}
              title={`Updated ${formatUpdated(sketch.updatedAt)}`}
              onclick={() => {
                closeMenu();
                onSelectSketch(sketch.id);
              }}
            >
              <span class="library__name">
                {sketch.name}
                {#if dirtySketchIds.has(sketch.id)}
                  <span class="library__dirty" title="Unsaved changes" aria-label="Unsaved changes">•</span>
                {/if}
              </span>
              {#if sketch.exampleId}
                <span class="library__hint">from example</span>
              {/if}
            </button>

            <div class="library__menu-wrap">
              <button
                type="button"
                class="library__more"
                aria-label={`Actions for ${sketch.name}`}
                aria-haspopup="menu"
                aria-expanded={openMenuId === sketch.id}
                onclick={(event) => toggleMenu(sketch.id, event)}
              >
                ⋯
              </button>
              {#if openMenuId === sketch.id}
                <div class="library__menu" role="menu">
                  <button
                    type="button"
                    role="menuitem"
                    onclick={(event) => {
                      event.stopPropagation();
                      closeMenu();
                      onRename(sketch.id);
                    }}
                  >
                    Rename
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    onclick={(event) => {
                      event.stopPropagation();
                      closeMenu();
                      onDuplicate(sketch.id);
                    }}
                  >
                    Duplicate
                  </button>
                  <button
                    type="button"
                    role="menuitem"
                    class="library__menu-danger"
                    onclick={(event) => {
                      event.stopPropagation();
                      closeMenu();
                      onDelete(sketch.id);
                    }}
                  >
                    Delete
                  </button>
                </div>
              {/if}
            </div>
          </li>
        {/each}
      </ul>
    {/if}

    <p class="section-label library__learn">Learn</p>
    <button
      type="button"
      class="library__item library__browse"
      class:library__item--active={browsingExamples}
      aria-current={browsingExamples ? 'true' : undefined}
      onclick={() => {
        closeMenu();
        onBrowseExamples();
      }}
    >
      <span class="library__name">Browse examples →</span>
    </button>
  </div>

  <div class="library__bottom">
    <p class="section-label">Motion</p>
    <p class="library__bottom-text">
      A sketch defines <code>motion(t)</code>. The preview draws that function; the robot will
      read the same one later.
    </p>
  </div>
</aside>

<style>
  .library {
    width: var(--app-sidebar-width);
    flex: none;
    display: flex;
    flex-direction: column;
    border-right: var(--border);
    background: var(--brand-white);
    overflow: hidden;
  }

  .library__top {
    padding: var(--space-3);
    border-bottom: var(--border);
  }

  .library__new {
    width: 100%;
  }

  .library__body {
    flex: 1 1 auto;
    overflow-y: auto;
    padding: var(--space-3) var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
  }

  .library__local {
    margin: 0 0 var(--space-1);
    padding: 0 var(--space-2);
    font-size: 11px;
    color: var(--color-text-muted);
  }

  .library__list {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 2px;
  }

  .library__row {
    display: grid;
    grid-template-columns: minmax(0, 1fr) auto;
    align-items: stretch;
    gap: 2px;
  }

  .library__item {
    width: 100%;
    text-align: left;
    display: flex;
    flex-direction: column;
    gap: 2px;
    border: 0;
    border-left: 2px solid transparent;
    background: transparent;
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-body);
    font-size: 13px;
    color: var(--color-text);
    cursor: pointer;
    min-width: 0;
  }

  .library__item:hover {
    background: var(--color-surface-tint);
  }

  .library__item--active {
    border-left-color: var(--brand-pink);
    background: rgba(234, 125, 255, 0.05);
    font-weight: 600;
  }

  .library__name {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
  }

  .library__hint {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-text-muted);
    font-weight: 400;
  }

  .library__dirty {
    color: var(--brand-pink);
    font-size: 18px;
    line-height: 1;
  }

  .library__more {
    border: 0;
    background: transparent;
    border-radius: var(--radius);
    width: 28px;
    cursor: pointer;
    color: var(--color-text-muted);
    font-size: 16px;
    line-height: 1;
  }

  .library__more:hover,
  .library__more:focus-visible {
    background: var(--color-surface-tint);
    color: var(--color-text);
  }

  .library__menu-wrap {
    position: relative;
  }

  .library__menu {
    position: absolute;
    right: 0;
    top: 100%;
    z-index: 20;
    min-width: 140px;
    border: var(--border-strong);
    border-radius: var(--radius);
    background: var(--brand-white);
    padding: var(--space-1);
    display: flex;
    flex-direction: column;
  }

  .library__menu button {
    border: 0;
    background: transparent;
    text-align: left;
    padding: var(--space-2);
    border-radius: var(--radius);
    font: inherit;
    font-size: 13px;
    cursor: pointer;
  }

  .library__menu button:hover {
    background: var(--color-surface-tint);
  }

  .library__menu-danger {
    color: var(--color-danger);
  }

  .library__learn {
    margin-top: var(--space-3);
  }

  .library__empty {
    margin: 0;
    padding: 0 var(--space-2);
    font-size: 13px;
  }

  .library__bottom {
    border-top: var(--border);
    padding: var(--space-3);
    background: var(--color-surface-tint);
  }

  .library__bottom-text {
    margin: var(--space-1) 0 0;
    font-size: 12px;
    color: var(--color-text-muted);
  }

  @media (max-width: 640px) {
    .library {
      width: 100%;
      max-height: 220px;
      border-right: 0;
      border-bottom: var(--border);
    }
  }
</style>
