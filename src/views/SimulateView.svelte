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
  import DiagnosticsPanel from '../lib/simulate/components/DiagnosticsPanel.svelte';
  import PhysicsDirector from '../lib/simulate/components/PhysicsDirector.svelte';
  import PhysicsPanel from '../lib/simulate/components/PhysicsPanel.svelte';
  import Timeline from '../lib/simulate/components/Timeline.svelte';
  import { timeline } from '../lib/motion/timeline';
  import { simulationBackend } from '../lib/simulate/physics/backend';
  import { simulateSection } from '../lib/stores/navigation';

  /**
   * Simulate workspace. Playback writes the same timeline Create uses.
   * The viewport poses a kinematic Unitree Go2 from the latest MotionFrame.
   * MuJoCo is an optional experiment in the same viewport. It does not edit the sketch.
   */
  const SECTIONS: SidebarSection[] = [
    { id: 'viewport', label: 'Viewport', hint: 'Live' },
    { id: 'robot-model', label: 'Robot model', hint: 'Go2' },
    { id: 'physics', label: 'Physics', hint: 'Experimental' },
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
      description:
        'An optional MuJoCo experiment. The Go2 can fall under gravity. Brush paths are not tracked, and nothing here is a safety result.',
      tag: 'Experimental',
    },
  };

  const current = $derived(
    SECTIONS.some((s) => s.id === $simulateSection) ? $simulateSection : 'viewport',
  );
  const meta = $derived(META[current] ?? META.viewport);
</script>

<div class="workspace">
<KinematicSession />
<PhysicsDirector />
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
      <DiagnosticsPanel />
      {#if $simulationBackend === 'mujoco'}
        <PhysicsPanel />
      {/if}
    </div>
  {:else if current === 'robot-model'}
    <RobotModelPanel />
  {:else}
    <div class="layout">
      <PhysicsPanel />
      <p class="muted">
        The robot is drawn in the viewport. Switching to MuJoCo there does not change the sketch
        or its parameters. Kinematic reachability and motion diagnostics stay on the geometric solve.
      </p>
      <button type="button" class="btn btn--small" onclick={() => simulateSection.set('viewport')}>
        Open the viewport
      </button>
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
