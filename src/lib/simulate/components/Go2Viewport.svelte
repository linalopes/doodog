<script lang="ts">
  import { onMount } from 'svelte';
  import { motionOutput } from '../../motion/output';
  import { motionTrail } from '../../motion/trail';
  import type { MotionFrame } from '../../motion/types';
  import type { SimConfig } from '../go2/defaults';
  import { interpretFrame, PREVIEW_LABEL, type TrailMark } from '../go2/pose';
  import { kinematicPose, setHelper, simSettings } from '../go2/settings';
  import { simulationBackend, selectSimulationBackend } from '../physics/backend';
  import { physicsRun } from '../physics/run';
  import { PHYSICS_LABEL } from '../physics/types';
  import { createGo2View, type CameraView, type Go2View } from '../scene/createGo2View';

  let host: HTMLDivElement | undefined = $state();
  let ready = $state(false);
  let loadError = $state('');
  let view: Go2View | null = null;
  let unreachableSamples = $state(0);
  let trailsHidden = false;

  const cache: { key: string; fingerprints: string[]; marks: TrailMark[] } = {
    key: '',
    fingerprints: [],
    marks: [],
  };

  function frameFingerprint(frame: MotionFrame): string {
    return [
      frame.time,
      frame.left.x,
      frame.left.y,
      frame.left.contact,
      frame.right.x,
      frame.right.y,
      frame.right.contact,
    ].join('|');
  }

  function syncMarks(
    frames: readonly MotionFrame[],
    canvas: { width: number; height: number } | null,
    config: SimConfig,
  ): TrailMark[] {
    const key = JSON.stringify({ canvas, config });
    const prefix =
      cache.key === key &&
      frames.length >= cache.fingerprints.length &&
      cache.fingerprints.every((fingerprint, index) => {
        const frame = frames[index];
        return frame !== undefined && frameFingerprint(frame) === fingerprint;
      });
    if (!prefix) {
      cache.key = key;
      cache.fingerprints = [];
      cache.marks = [];
    }
    for (let index = cache.fingerprints.length; index < frames.length; index += 1) {
      const frame = frames[index];
      if (!frame) continue;
      cache.marks.push(...interpretFrame(frame, canvas, config).marks);
      cache.fingerprints.push(frameFingerprint(frame));
    }
    return cache.marks;
  }

  onMount(() => {
    if (!host) return;
    const created = createGo2View(host, {
      onReady: () => {
        ready = true;
      },
      onError: (message) => {
        loadError = message;
      },
    });
    view = created;
    const observer = new ResizeObserver(() => created.resize());
    observer.observe(host);
    return () => {
      observer.disconnect();
      created.dispose();
      view = null;
    };
  });

  $effect(() => {
    if (!ready || !view) return;
    const config = $simSettings;
    const pose = $kinematicPose;
    const trail = $motionTrail;
    const canvas = $motionOutput.canvas;
    view.setHelpers(config.showGrid, config.showFrames);
    view.setBrushes(config.brushes.left, config.brushes.right);
    const physics = $simulationBackend === 'mujoco' ? $physicsRun.snapshot : null;
    const experiment = $simulationBackend === 'mujoco' ? $physicsRun.experiment : null;
    let marks: TrailMark[] = [];
    if (physics) {
      if (pose) view.setPaper(pose);
      view.setPhysicsPose({
        joints: physics.joints,
        basePosition: physics.basePosition,
        baseQuaternion: physics.baseQuaternion,
      });
      const drawing = $physicsRun.mode === 'air-draw';
      const scoring = $physicsRun.mode === 'score';
      view.setPhysicsGuide({
        support: physics.support.polygon,
        triangle: $physicsRun.mode === 'three-leg' || drawing || scoring ? physics.support.threeLegTriangle : [],
        com: physics.support.com,
        flTarget: experiment?.flTarget ?? null,
        desiredPath: drawing ? (experiment?.draw.desired ?? []) : [],
        achievedPath: drawing ? (experiment?.draw.achieved ?? []) : scoring ? (experiment?.score.achieved ?? []) : [],
        brushDown: scoring ? (experiment?.score.desiredContact ?? []) : [],
        brushUp: scoring ? (experiment?.score.desiredTravel ?? []) : [],
      });
      if (!trailsHidden) {
        view.setMarks([]);
        trailsHidden = true;
      }
    } else if (pose) {
      trailsHidden = false;
      view.setPhysicsGuide(null);
      view.setPose(pose);
      marks = syncMarks(trail, canvas, config);
      view.setMarks(marks);
    } else {
      view.setPhysicsGuide(null);
    }
    let unreachable = 0;
    for (const mark of marks) {
      if (mark.contactRequested && mark.reachable === false) unreachable += 1;
    }
    if (unreachable !== unreachableSamples) unreachableSamples = unreachable;
  });

  function selectView(next: CameraView): void {
    view?.setView(next);
  }

  const pose = $derived($kinematicPose);
  const physicsSelected = $derived($simulationBackend === 'mujoco');
  const physicsLive = $derived(physicsSelected && $physicsRun.snapshot !== null);
  const experiment = $derived(physicsLive ? $physicsRun.experiment : null);
  const controlled = $derived(experiment !== null && experiment.mode !== 'motors-off');

  const STAGE_LABEL: Record<string, string> = {
    idle: 'Idle',
    posture: 'Posture hold',
    stand: 'Stand',
    shift: 'Shift',
    lift: 'Lift',
    draw: 'Draw',
    track: 'Track Creative Score',
    hold: 'Hold',
    return: 'Return',
    done: 'Finished',
  };
</script>

<div class="viewport">
  <div class="viewport__stage" bind:this={host} data-role="simulation-viewport"></div>

  <div class="viewport__overlay">
    <p class="viewport__banner">{physicsLive ? PHYSICS_LABEL : PREVIEW_LABEL}</p>
    {#if physicsLive && $physicsRun.snapshot}
      <p class="viewport__note">
        {#if controlled && experiment}
          {STAGE_LABEL[experiment.stage] ?? experiment.stage}. Torque PD. Contacts and the centre of mass are measured. The dark marker is the requested front-left target.
          {#if experiment.mode === 'air-draw'}
            The dark line is the requested circle and the pink line is the measured foot. Neither line is ink.
          {/if}
          {#if experiment.mode === 'score'}
            The purple line is the creative brush-down path, the turquoise line is brush-up travel, and the pink line is the measured foot. None of these lines is ink. The other creative brush is ignored. The physical drawing leg is FL.
          {/if}
          This is not a safe path, and geometric paint is hidden.
        {:else}
          Zero torque. The robot may fall. Contacts are from MuJoCo. This is not a safe path, and geometric paint is hidden.
        {/if}
      </p>
      <p class="mono viewport__reach">
        base z {$physicsRun.snapshot.basePosition[2].toFixed(3)} m · roll {(($physicsRun.snapshot.rollRad * 180) / Math.PI).toFixed(1)}° · pitch {(($physicsRun.snapshot.pitchRad * 180) / Math.PI).toFixed(1)}° · FL clearance {($physicsRun.snapshot.feet.FL.clearanceM * 1000).toFixed(0)} mm · t {$physicsRun.snapshot.time.toFixed(2)} s
      </p>
    {:else}
      <p class="viewport__note">
        Geometric preview of paint. A reachable pose is not dynamically safe, and contact is not a physics result.
      </p>
    {/if}
    {#if pose && !physicsLive}
      <p class="mono viewport__reach">
        FL {pose.legs.FL.reachable === null ? 'held' : pose.legs.FL.reachable ? 'reachable' : 'unreachable'}
        {#if pose.legs.FL.positionErrorM !== null}
          · {(pose.legs.FL.positionErrorM * 1000).toFixed(0)} mm
        {/if}
        <span class="viewport__dot">·</span>
        FR {pose.legs.FR.reachable === null ? 'held' : pose.legs.FR.reachable ? 'reachable' : 'unreachable'}
        {#if pose.legs.FR.positionErrorM !== null}
          · {(pose.legs.FR.positionErrorM * 1000).toFixed(0)} mm
        {/if}
        {#if pose.manual}
          <span class="viewport__dot">·</span> manual
        {/if}
        {#if pose.canvasAssumed}
          <span class="viewport__dot">·</span> canvas 600×600 assumed
        {/if}
        {#if pose.legs.FL.onLimit || pose.legs.FR.onLimit}
          <span class="viewport__dot">·</span> joint limit
        {/if}
      </p>
      {#if unreachableSamples > 0}
        <p class="viewport__note">
          {unreachableSamples} unreachable
          {unreachableSamples === 1 ? 'sample' : 'samples'} on this trail. The drawing was not rescaled.
        </p>
      {/if}
    {/if}
  </div>

  <div class="viewport__bar">
    <div class="viewport__views" role="group" aria-label="Simulation backend">
      <button
        type="button"
        class="btn btn--small"
        aria-pressed={!physicsSelected}
        onclick={() => selectSimulationBackend('kinematic')}
      >
        Kinematic Preview
      </button>
      <button
        type="button"
        class="btn btn--small"
        aria-pressed={physicsSelected}
        onclick={() => selectSimulationBackend('mujoco')}
      >
        MuJoCo Physics — Experimental
      </button>
    </div>
    <div class="viewport__views" role="group" aria-label="Camera">
      <button type="button" class="btn btn--small" onclick={() => selectView('perspective')}>Perspective</button>
      <button type="button" class="btn btn--small" onclick={() => selectView('top')}>Top</button>
      <button type="button" class="btn btn--small" onclick={() => selectView('side')}>Side</button>
    </div>
    <div class="viewport__views" role="group" aria-label="Scene helpers">
      <button
        type="button"
        class="btn btn--small"
        aria-pressed={$simSettings.showGrid}
        onclick={() => setHelper('showGrid', !$simSettings.showGrid)}
      >
        Grid
      </button>
      <button
        type="button"
        class="btn btn--small"
        aria-pressed={$simSettings.showFrames}
        onclick={() => setHelper('showFrames', !$simSettings.showFrames)}
      >
        Frames
      </button>
    </div>
    {#if physicsLive}
      <p class="viewport__legend">
        <span><i class="swatch swatch--achieved"></i> Measured support</span>
        <span><i class="swatch swatch--desired"></i> FR–RL–RR triangle</span>
        <span><i class="swatch swatch--paint"></i> Centre of mass</span>
        <span><i class="swatch swatch--target"></i> FL target</span>
        {#if experiment?.mode === 'air-draw'}
          <span><i class="swatch swatch--circle"></i> Requested circle</span>
          <span><i class="swatch swatch--foot"></i> Measured foot</span>
        {/if}
        {#if experiment?.mode === 'score'}
          <span><i class="swatch swatch--circle"></i> Brush down</span>
          <span><i class="swatch swatch--achieved"></i> Brush up</span>
          <span><i class="swatch swatch--foot"></i> Measured foot</span>
        {/if}
      </p>
    {:else}
      <p class="viewport__legend">
        <span><i class="swatch swatch--desired"></i> Desired</span>
        <span><i class="swatch swatch--achieved"></i> Achieved tip</span>
        <span><i class="swatch swatch--paint"></i> Geometric paint</span>
      </p>
    {/if}
  </div>

  {#if !ready && !loadError}
    <p class="viewport__status">Loading the Unitree Go2 model…</p>
  {/if}
  {#if loadError}
    <p class="viewport__status viewport__status--error" role="alert">{loadError}</p>
  {/if}
</div>

<style>
  .viewport {
    position: relative;
    flex: 1 1 auto;
    min-height: 420px;
    border: var(--border-strong);
    border-radius: var(--radius);
    overflow: hidden;
    background: #f4f7f7;
  }

  .viewport__stage {
    position: absolute;
    inset: 0;
  }

  .viewport__stage :global(canvas) {
    width: 100%;
    height: 100%;
    display: block;
    touch-action: none;
  }

  .viewport__overlay {
    position: absolute;
    top: var(--space-2);
    left: var(--space-2);
    right: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: 2px;
    pointer-events: none;
    max-width: 46rem;
  }

  .viewport__banner,
  .viewport__note,
  .viewport__reach {
    margin: 0;
    background: rgba(255, 255, 255, 0.9);
    border-radius: var(--radius);
    padding: 2px 8px;
    width: fit-content;
    max-width: 100%;
  }

  .viewport__banner {
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--brand-deep-purple);
  }

  .viewport__note,
  .viewport__reach {
    font-size: 12px;
    color: var(--color-text-muted);
  }

  .viewport__dot {
    margin: 0 0.3em;
  }

  .viewport__bar {
    position: absolute;
    left: var(--space-2);
    right: var(--space-2);
    bottom: var(--space-2);
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: center;
    justify-content: space-between;
  }

  .viewport__views {
    display: flex;
    gap: var(--space-1);
    background: rgba(255, 255, 255, 0.9);
    border-radius: var(--radius);
    padding: 4px;
  }

  .viewport__legend {
    margin: 0;
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    font-size: 12px;
    background: rgba(255, 255, 255, 0.9);
    border-radius: var(--radius);
    padding: 4px 8px;
  }

  .viewport__legend span {
    display: inline-flex;
    align-items: center;
    gap: 6px;
  }

  .swatch {
    width: 14px;
    height: 3px;
    display: inline-block;
  }

  .swatch--desired {
    background: repeating-linear-gradient(90deg, var(--brand-deep-purple) 0 5px, transparent 5px 8px);
  }

  .swatch--achieved {
    background: var(--brand-turquoise);
  }

  .swatch--paint {
    background: var(--brand-pink);
  }

  .swatch--target {
    width: 8px;
    height: 8px;
    border: 2px solid var(--brand-deep-purple);
    background: transparent;
  }

  .swatch--circle {
    background: var(--brand-deep-purple);
  }

  .swatch--foot {
    background: var(--brand-pink);
  }

  .viewport__status {
    position: absolute;
    inset: auto 16px 64px 16px;
    margin: 0;
    color: var(--color-text-muted);
  }

  .viewport__status--error {
    color: var(--color-danger);
  }
</style>
