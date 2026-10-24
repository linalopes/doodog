<script lang="ts">
  import EmptyState from '../lib/components/EmptyState.svelte';
  import MainSection from '../lib/components/MainSection.svelte';
  import Sidebar from '../lib/components/Sidebar.svelte';
  import type { SidebarSection } from '../lib/components/types';
  import { APP_CONFIG } from '../lib/config';
  import { robotSection } from '../lib/stores/navigation';

  /**
   * Robot workspace — reserved for the physical Unitree Go2.
   * Phase 01 has no transport, no SDK, and no motion commands. The sections
   * exist so later phases have a place for connection, safety, and streaming.
   */
  const SECTIONS: SidebarSection[] = [
    { id: 'overview', label: 'Overview' },
    { id: 'connection', label: 'Connection', hint: 'Later' },
    { id: 'safety', label: 'Safety', hint: 'Later' },
  ];

  const META: Record<string, { title: string; description: string }> = {
    overview: {
      title: 'Robot',
      description: 'Connection to the physical Unitree Go2. Not available in this phase.',
    },
    connection: {
      title: 'Connection',
      description: 'Discover and connect to the robot. No transport is implemented yet.',
    },
    safety: {
      title: 'Safety',
      description: 'Workspace limits, speed caps, and emergency stop — defined before any motion ships.',
    },
  };

  const current = $derived(
    SECTIONS.some((s) => s.id === $robotSection) ? $robotSection : 'overview',
  );
  const meta = $derived(META[current] ?? META.overview);
</script>

<div class="workspace">
<Sidebar title="Robot" sections={SECTIONS} active={current} onSelect={(id) => robotSection.set(id)}>
  {#snippet bottom()}
    <p class="section-label">Status</p>
    <p class="status mono">
      <span class="status__dot" aria-hidden="true"></span>
      No robot · no transport
    </p>
  {/snippet}
</Sidebar>

<MainSection title={meta?.title ?? 'Robot'} description={meta?.description} tag="Not available">
  {#snippet actions()}
    <span class="badge badge--outline">{APP_CONFIG.robot.name}</span>
  {/snippet}

  {#if current === 'overview'}
    <EmptyState
      tag="Reserved"
      title="Physical robot control is not in this phase"
      description="The kinematic preview is in Simulate. Nothing here can connect, send commands, or move a Unitree Go2."
      seed={41}
    >
      <div class="callout callout--tint">
        <span class="callout__marker">→</span>
        <p class="callout__text">
          Order of work: simulation first, reachability checks second, then a controller behind
          the <code>RobotController</code> interface with an explicit emergency stop.
        </p>
      </div>
    </EmptyState>
  {:else if current === 'connection'}
    <div class="panel panel--soft">
      <h2>Connection</h2>
      <p class="muted">
        No connection method is chosen yet. Candidates are a local bridge speaking the Unitree
        SDK over WebSocket, or a direct WebRTC session. The choice depends on the Go2 firmware
        and network mode and will be documented before implementation.
      </p>
      <div class="btn-row">
        <button type="button" class="btn btn--primary" disabled>Connect</button>
        <button type="button" class="btn" disabled>Disconnect</button>
      </div>
    </div>
  {:else}
    <div class="panel panel--soft">
      <h2>Safety</h2>
      <p class="muted">
        Before any motion command exists the application will define: a reachable brush
        workspace, joint speed caps, a confirmation step before streaming, and an emergency
        stop that is never a silent no-op.
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

  .status {
    display: flex;
    align-items: center;
    gap: var(--space-2);
    margin: var(--space-1) 0 0;
    font-size: 12px;
    color: var(--color-text-muted);
  }

  .status__dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
    border: 1px solid var(--color-text-muted);
    background: transparent;
  }

  @media (max-width: 640px) {
    .workspace {
      flex-direction: column;
    }
  }
</style>
