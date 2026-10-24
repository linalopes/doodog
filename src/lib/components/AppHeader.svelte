<script lang="ts">
  import { APP_CONFIG } from '../config';
  import PrimaryTabs from './PrimaryTabs.svelte';
</script>

<header class="app-header header on-dark">
  <div class="header__identity">
    <!-- Brand mark on Deep Purple is an approved background (brand kit §Logos). -->
    <img
      class="header__mark"
      src="/brand/sota-mark.svg"
      alt=""
      aria-hidden="true"
      width="36"
      height="36"
    />
    <div class="header__names">
      <span class="header__product">{APP_CONFIG.productName}</span>
      <span class="header__org">{APP_CONFIG.organization.name}</span>
    </div>
  </div>

  <PrimaryTabs />

  <div class="header__status">
    <span class="header__phase" title="Current development phase">
      <span class="header__phase-dot" aria-hidden="true"></span>
      {APP_CONFIG.phase.label}
    </span>
  </div>
</header>

<style>
  .header {
    display: grid;
    grid-template-columns: minmax(200px, 1fr) auto minmax(200px, 1fr);
    align-items: center;
    column-gap: var(--space-4);
    padding: 0 var(--space-4);
    background: var(--brand-deep-purple);
    color: var(--brand-white);
    overflow: hidden;
  }

  .header__identity {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    min-width: 0;
    overflow: hidden;
  }

  /* Minimum mark size per brand kit is 32px; breathe is the kit's own motion. */
  .header__mark {
    flex: none;
    width: 36px;
    height: 36px;
    display: block;
    animation: sota-breathe var(--motion-breathe-duration) ease-in-out infinite;
    transform-origin: center;
  }

  .header__names {
    display: flex;
    flex-direction: column;
    justify-content: center;
    gap: 2px;
    line-height: 1.2;
    min-width: 0;
    overflow: hidden;
  }

  .header__product {
    font-family: var(--font-title);
    font-weight: 500;
    font-size: 17px;
    letter-spacing: -0.01em;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header__org {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.14em;
    text-transform: uppercase;
    color: var(--brand-gray-green);
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
  }

  .header__status {
    display: flex;
    justify-content: flex-end;
    align-items: center;
    min-width: 0;
    overflow: hidden;
  }

  .header__phase {
    display: inline-flex;
    align-items: center;
    gap: var(--space-2);
    height: 32px;
    padding: 0 var(--space-3);
    border: 1px solid var(--color-border-on-dark);
    border-radius: 999px;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--brand-gray-green);
    white-space: nowrap;
  }

  .header__phase-dot {
    width: 7px;
    height: 7px;
    border-radius: 50%;
    background: var(--brand-turquoise);
  }

  @media (max-width: 760px) {
    .header {
      grid-template-columns: auto 1fr;
    }
    .header__status {
      display: none;
    }
  }
</style>
