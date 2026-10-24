<script lang="ts">
  import AppFooter from './lib/components/AppFooter.svelte';
  import AppHeader from './lib/components/AppHeader.svelte';
  import { APP_CONFIG } from './lib/config';
  import { activeTab } from './lib/stores/navigation';
  import CreateView from './views/CreateView.svelte';
  import RobotView from './views/RobotView.svelte';
  import SimulateView from './views/SimulateView.svelte';

  /**
   * Application shell.
   *
   * The three workspaces are mounted one at a time. Layout uses CSS grid with
   * a fixed header row so page content can never compress the top navigation.
   *
   * The root element carries data-document-role="page": it is the artboard
   * boundary for design tooling and screenshots.
   */
  $effect(() => {
    document.title = `${APP_CONFIG.productName} — ${APP_CONFIG.organization.name}`;
  });
</script>

<div class="app" data-document-role="page">
  <AppHeader />

  <main class="app__body">
    {#if $activeTab === 'create'}
      <div class="app__panel" role="tabpanel" id="panel-create" aria-labelledby="tab-create">
        <CreateView />
      </div>
    {:else if $activeTab === 'simulate'}
      <div class="app__panel" role="tabpanel" id="panel-simulate" aria-labelledby="tab-simulate">
        <SimulateView />
      </div>
    {:else}
      <div class="app__panel" role="tabpanel" id="panel-robot" aria-labelledby="tab-robot">
        <RobotView />
      </div>
    {/if}
  </main>

  <AppFooter />
</div>

<style>
  .app {
    display: grid;
    grid-template-rows: var(--app-header-height) minmax(0, 1fr) auto;
    height: 100%;
    min-width: 0;
    overflow: hidden;
  }

  .app__body {
    min-height: 0;
    display: flex;
    overflow: hidden;
  }

  .app__panel {
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
    display: flex;
    overflow: hidden;
  }
</style>
