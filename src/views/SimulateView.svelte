<script lang="ts">
  import MainSection from '../lib/components/MainSection.svelte';
  import Sidebar from '../lib/components/Sidebar.svelte';
  import type { SidebarSection } from '../lib/components/types';
  import { APP_CONFIG } from '../lib/config';
  import ParametersPanel from '../lib/create/components/ParametersPanel.svelte';
  import KinematicSession from '../lib/simulate/components/KinematicSession.svelte';
  import PlaybackControls from '../lib/simulate/components/PlaybackControls.svelte';
  import RobotModelPanel from '../lib/simulate/components/RobotModelPanel.svelte';
  import SimulationStage from '../lib/simulate/components/SimulationStage.svelte';
  import Timeline from '../lib/simulate/components/Timeline.svelte';
  import { timeline } from '../lib/motion/timeline';
  import { simulateSection } from '../lib/stores/navigation';

  /**
   * Simulate workspace. Playback writes the same timeline Create uses.
   * The viewport poses a kinematic Unitree Go2 from the latest MotionFrame.
   * MuJoCo and the physical robot are not part of this view.
   */
  const SECTIONS: SidebarSection[] = [
    { id: 'viewport', label: 'Viewport', hint: 'Live' },
    { id: 'robot-model', label: 'Robot model', hint: 'Go2' },
    { id: 'physics', label: 'Physics', hint: 'Later' },
  ];

  const META: Record<string, { title: string; description: string; tag: string }> = {
    viewport: {
      title: 'Simulate the robot',
      description:
        'The shared timeline poses a kinematic Unitree Go2 from the sketch’s motion(t). This is a geometric preview, not a physics simulation.',
      tag: 'Preview',
    },
    'robot-model': {
      title: 'Robot model',
      description:
        'Joint limits from the Go2 model, brush mounts, and the painting surface. These controls do not leave the browser.',
      tag: 'Inspection',
    },
    physics: {
      title: 'Physics',
      description: 'MuJoCo is not running. Reachability here is kinematic only and does not imply balance or contact.',
      tag: 'Not implemented',
    },
  };

  const current = $derived(
    SECTIONS.some((s) => s.id === $simulateSection) ? $simulateSection : 'viewport',
  );
  const meta = $derived(META[current] ?? META.viewport);
</script>

<div class="workspace">
<KinematicSession />
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

<MainSection
  title={meta?.title ?? 'Simulate'}
  description={meta?.description}
  tag={meta?.tag ?? 'Not implemented'}
>
  {#snippet actions()}
    <span class="badge badge--outline">{APP_CONFIG.robot.name}</span>
  {/snippet}

  {#if current === 'viewport'}
    <div class="layout">
      <SimulationStage />
      <ParametersPanel />
      <div class="layout__controls">
        <div class="panel">
          <p class="section-label">Playback</p>
          <PlaybackControls />
        </div>
        <Timeline />
      </div>
    </div>
  {:else if current === 'robot-model'}
    <RobotModelPanel />
  {:else}
    <div class="panel panel--soft">
      <h2>Physics</h2>
      <p class="muted">
        The kinematic adapter already implements <code>SimulationAdapter</code>. A MuJoCo
        WebAssembly adapter can replace it later without changing sketches, <code>MotionFrame</code>,
        or the timeline. It is not included. Reachability in the viewport is not contact, friction,
        or balance.
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
    min-height: min-content;
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
