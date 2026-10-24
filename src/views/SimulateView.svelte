<script lang="ts">
  import MainSection from '../lib/components/MainSection.svelte';
  import Sidebar from '../lib/components/Sidebar.svelte';
  import type { SidebarSection } from '../lib/components/types';
  import { APP_CONFIG } from '../lib/config';
  import PlaybackControls from '../lib/simulate/components/PlaybackControls.svelte';
  import SimulationStage from '../lib/simulate/components/SimulationStage.svelte';
  import Timeline from '../lib/simulate/components/Timeline.svelte';
  import { timeline } from '../lib/motion/timeline';
  import { simulateSection } from '../lib/stores/navigation';

  /**
   * Simulate workspace — reserved for the Three.js Go2 visualisation.
   * Layout and controls exist so Phase 02 fills the viewport without
   * reorganising the page. Nothing moves in Phase 01.
   */
  const SECTIONS: SidebarSection[] = [
    { id: 'viewport', label: 'Viewport', hint: 'Phase 02' },
    { id: 'robot-model', label: 'Robot model', hint: 'Phase 02' },
    { id: 'physics', label: 'Physics', hint: 'Later' },
  ];

  const META: Record<string, { title: string; description: string }> = {
    viewport: {
      title: 'Simulate the robot',
      description:
        'Preview how the sketch’s brush motion translates into the articulated legs of the Unitree Go2.',
    },
    'robot-model': {
      title: 'Robot model',
      description: 'Dimensions, joint limits, and brush mount positions used by the simulation.',
    },
    physics: {
      title: 'Physics',
      description: 'MuJoCo WebAssembly adapter for contact and balance — not part of Phase 01.',
    },
  };

  const current = $derived(
    SECTIONS.some((s) => s.id === $simulateSection) ? $simulateSection : 'viewport',
  );
  const meta = $derived(META[current] ?? META.viewport);
</script>

<div class="workspace">
<Sidebar title="Simulate" sections={SECTIONS} active={current} onSelect={(id) => simulateSection.set(id)}>
  {#snippet bottom()}
    <p class="section-label">Shared timeline</p>
    <p class="mono side-readout">
      t = {$timeline.time.toFixed(2)} s · {$timeline.playState}
    </p>
    <p class="help-text">
      One clock for the 2D preview, the 3D robot, and later the physical Go2.
    </p>
  {/snippet}
</Sidebar>

<MainSection title={meta?.title ?? 'Simulate'} description={meta?.description} tag="Not implemented">
  {#snippet actions()}
    <span class="badge badge--outline">{APP_CONFIG.robot.name}</span>
  {/snippet}

  {#if current === 'viewport'}
    <div class="layout">
      <SimulationStage />
      <div class="layout__controls">
        <div class="panel">
          <p class="section-label">Playback</p>
          <PlaybackControls />
        </div>
        <Timeline />
      </div>
    </div>
  {:else if current === 'robot-model'}
    <div class="panel panel--soft">
      <h2>Robot model</h2>
      <p class="muted">
        Phase 02 will load the Unitree Go2 geometry and joint limits here. Legs:
        {APP_CONFIG.robot.legs.join(', ')}. Brush mounts are planned on the two front legs, which
        correspond to the <code>left</code> and <code>right</code> brush targets of the motion model.
      </p>
    </div>
  {:else}
    <div class="panel panel--soft">
      <h2>Physics</h2>
      <p class="muted">
        A MuJoCo WebAssembly adapter is planned behind the same <code>SimulationAdapter</code>
        interface as the kinematic preview. It will need cross-origin isolation headers for
        SharedArrayBuffer; see the README for the dependency notes.
      </p>
    </div>
  {/if}
</MainSection>
</div>

<style>
  .workspace {
    display: flex;
    flex: 1 1 auto;
    min-width: 0;
    min-height: 0;
  }

  .layout {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    flex: 1 1 auto;
    min-height: 0;
  }

  .layout__controls {
    display: grid;
    grid-template-columns: minmax(240px, 320px) minmax(0, 1fr);
    gap: var(--space-3);
    align-items: start;
  }

  .side-readout {
    margin: var(--space-1) 0 0;
    font-size: 12px;
  }

  @media (max-width: 640px) {
    .workspace {
      flex-direction: column;
    }
  }

  @media (max-width: 900px) {
    .layout__controls {
      grid-template-columns: 1fr;
    }
  }
</style>
