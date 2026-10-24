<script lang="ts">
  import MotionReadout from '../../components/MotionReadout.svelte';
  import Go2Viewport from './Go2Viewport.svelte';

  /**
   * Live kinematic stage. The readout and the viewport share the host timeline
   * and the latest MotionFrame. The adapter inside the viewport is what turns
   * that frame into a pose.
   */
</script>

<div class="stage" data-role="simulation-stage">
  <div class="panel stage__sample">
    <p class="section-label">Shared motion</p>
    <MotionReadout />
  </div>
  <Go2Viewport />
</div>

<style>
  .stage {
    flex: 1 1 auto;
    min-height: min-content;
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .stage__sample {
    flex: none;
    padding: var(--space-3);
  }
</style>
