<script lang="ts">
  import { onMount } from 'svelte';
  import { attachPhysicsDirector } from '../physics/run';

  /**
   * Keeps the MuJoCo session alive for the Simulate workspace.
   * The creative sketch and its parameters are not written here.
   */
  onMount(() => attachPhysicsDirector());
</script>
