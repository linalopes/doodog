<script lang="ts">
  import { onMount } from 'svelte';
  import AppFooter from './lib/components/AppFooter.svelte';
  import AppHeader from './lib/components/AppHeader.svelte';
  import { APP_CONFIG } from './lib/config';
  import { startTimelineClock, stopTimelineClock } from './lib/motion/clock';
  import { activeTab } from './lib/stores/navigation';
  import CreateView from './views/CreateView.svelte';
  import RobotView from './views/RobotView.svelte';
  import SimulateView from './views/SimulateView.svelte';

  onMount(() => {
    startTimelineClock();
    return () => stopTimelineClock();
  });

  /**
   * Application shell.
   *
   * Create stays mounted while other workspaces are shown, so the sketch
   * iframe and the shared timeline survive a tab change. Inactive panels are
   * hidden. Layout uses CSS grid with a fixed header row so page content can
   * never compress the top navigation.
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
    <div
      class="app__panel"
      role="tabpanel"
      id="panel-create"
      aria-labelledby="tab-create"
      hidden={$activeTab !== 'create'}
      inert={$activeTab !== 'create'}
    >
      <CreateView />
    </div>
    <div
      class="app__panel"
      role="tabpanel"
      id="panel-simulate"
      aria-labelledby="tab-simulate"
      hidden={$activeTab !== 'simulate'}
      inert={$activeTab !== 'simulate'}
    >
      <SimulateView />
    </div>
    <div
      class="app__panel"
      role="tabpanel"
      id="panel-robot"
      aria-labelledby="tab-robot"
      hidden={$activeTab !== 'robot'}
      inert={$activeTab !== 'robot'}
    >
      <RobotView />
    </div>
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

  .app__panel[hidden] {
    display: none;
  }
</style>
