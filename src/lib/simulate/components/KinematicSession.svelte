<script lang="ts">
  import { onMount } from 'svelte';
  import { motionOutput } from '../../motion/output';
  import { createKinematicAdapter, type KinematicAdapter } from '../adapters/kinematic';
  import { inspection, kinematicPose, simSettings } from '../go2/settings';

  /**
   * Owns the kinematic adapter for the Simulate workspace.
   * The Three.js view and the inspection panel both read its pose.
   * Closing the viewport does not drop the solved joints.
   */
  let ready = $state(false);
  let adapter: KinematicAdapter | null = null;

  onMount(() => {
    adapter = createKinematicAdapter();
    ready = true;
    return () => {
      ready = false;
      adapter?.dispose();
      adapter = null;
      kinematicPose.set(null);
    };
  });

  $effect(() => {
    if (!ready || !adapter) return;
    const config = $simSettings;
    const output = $motionOutput;
    const inspect = $inspection;
    if (output.canvas) void adapter.load({ durationSeconds: null, canvas: output.canvas });
    adapter.setConfig(config);
    adapter.setManual(inspect.followTimeline ? null : inspect.joints);
    if (output.frame) adapter.applyFrame(output.frame);
    else adapter.showReference();
    const snapshot = adapter.snapshot();
    if (snapshot) kinematicPose.set(snapshot);
  });
</script>
