<script lang="ts">
  import { PRIMARY_TABS, TAB_LABELS, TAB_STATUS, activeTab } from '../stores/navigation';

  /**
   * Primary navigation implemented as an ARIA tab list. Left and right arrows
   * move between tabs, matching what keyboard users expect from this pattern.
   */
  let buttons: HTMLButtonElement[] = $state([]);

  function focusTab(index: number) {
    const target = (index + PRIMARY_TABS.length) % PRIMARY_TABS.length;
    const tab = PRIMARY_TABS[target];
    if (!tab) return;
    activeTab.goTo(tab);
    buttons[target]?.focus();
  }

  function onKeydown(event: KeyboardEvent, index: number) {
    if (event.key === 'ArrowRight') {
      event.preventDefault();
      focusTab(index + 1);
    } else if (event.key === 'ArrowLeft') {
      event.preventDefault();
      focusTab(index - 1);
    } else if (event.key === 'Home') {
      event.preventDefault();
      focusTab(0);
    } else if (event.key === 'End') {
      event.preventDefault();
      focusTab(PRIMARY_TABS.length - 1);
    }
  }
</script>

<nav class="tabs on-dark" aria-label="Workspaces">
  <div role="tablist" aria-label="Workspaces" class="tabs__list">
    {#each PRIMARY_TABS as tab, index (tab)}
      <button
        bind:this={buttons[index]}
        type="button"
        role="tab"
        id="tab-{tab}"
        aria-selected={$activeTab === tab}
        aria-controls="panel-{tab}"
        tabindex={$activeTab === tab ? 0 : -1}
        class="tab"
        class:tab--active={$activeTab === tab}
        onclick={() => activeTab.goTo(tab)}
        onkeydown={(event) => onKeydown(event, index)}
      >
        <span class="tab__index">0{index + 1}</span>
        <span class="tab__label">{TAB_LABELS[tab]}</span>
        {#if TAB_STATUS[tab] === 'planned'}
          <span class="tab__planned" title="Reserved for a later phase">planned</span>
        {/if}
      </button>
    {/each}
  </div>
</nav>

<style>
  .tabs {
    display: flex;
    align-items: center;
    height: 100%;
  }

  .tabs__list {
    display: flex;
    align-items: center;
    gap: 2px;
    height: 44px;
  }

  .tab {
    position: relative;
    display: inline-flex;
    align-items: baseline;
    gap: var(--space-1);
    font-family: var(--font-title);
    font-weight: 500;
    font-size: 14px;
    letter-spacing: 0.01em;
    color: var(--brand-gray-green);
    background: transparent;
    border: 0;
    padding: 0 var(--space-3);
    height: 44px;
    line-height: 44px;
    cursor: pointer;
    border-radius: var(--radius);
  }

  /* Numbered sections echo the brand kit's sidebar numbering. */
  .tab__index {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.14em;
    opacity: 0.55;
  }

  .tab__planned {
    font-family: var(--font-mono);
    font-size: 9px;
    letter-spacing: 0.1em;
    text-transform: uppercase;
    opacity: 0.5;
  }

  .tab:hover {
    color: var(--brand-white);
  }

  .tab:focus-visible {
    outline: 2px solid var(--brand-turquoise);
    outline-offset: -2px;
  }

  /* Pink as a structural accent on Deep Purple: an approved pair. */
  .tab--active {
    color: var(--brand-white);
  }

  .tab--active .tab__index {
    color: var(--brand-pink);
    opacity: 1;
  }

  .tab--active::after {
    content: '';
    position: absolute;
    left: var(--space-2);
    right: var(--space-2);
    bottom: 4px;
    height: 2px;
    background: var(--brand-pink);
    border-radius: 1px;
  }
</style>
