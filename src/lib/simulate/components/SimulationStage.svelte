<script lang="ts">
  import { APP_CONFIG } from '../../config';
  import EmptyState from '../../components/EmptyState.svelte';

  /**
   * Reserved viewport for the Three.js Unitree Go2 visualisation (Phase 02).
   * Nothing is rendered here yet — no placeholder robot, no fake motion.
   */
</script>

<div class="stage" data-role="simulation-viewport">
  <EmptyState
    tag="Planned · Phase 02"
    title="3D simulation not yet implemented"
    description={`This viewport is reserved for a Three.js model of the ${APP_CONFIG.robot.name}. It will pose the robot's legs from the same motion(t) function the Create preview draws from — no export step in between.`}
    seed={23}
  >
    <ul class="plan">
      <li><span class="plan__num">01</span> Three.js scene, camera, paper plane</li>
      <li><span class="plan__num">02</span> Go2 articulated legs ({APP_CONFIG.robot.legs.join(' · ')})</li>
      <li><span class="plan__num">03</span> Brush targets → leg inverse kinematics</li>
      <li><span class="plan__num">04</span> MuJoCo WebAssembly physics adapter</li>
    </ul>
  </EmptyState>
</div>

<style>
  .stage {
    flex: 1 1 auto;
    min-height: 360px;
    display: flex;
  }

  .plan {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
    text-align: left;
    font-size: 13px;
    width: 100%;
  }

  .plan li {
    display: flex;
    gap: var(--space-2);
    align-items: baseline;
  }

  .plan__num {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    color: var(--brand-pink);
  }
</style>
