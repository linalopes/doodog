<script lang="ts">
  import { onMount } from 'svelte';
  import { motionOutput } from '../../motion/output';
  import { motionTrail } from '../../motion/trail';
  import type { MotionFrame } from '../../motion/types';
  import type { SimConfig } from '../go2/defaults';
  import { brushTipInFoot, brushWorld, calibrationFrom } from '../go2/brush';
  import { WORKSPACE_SHEET_M } from '../go2/workspace';
  import { workspaceLab } from '../go2/workspaceLab';
  import { interpretFrame, PREVIEW_LABEL, type LegReport, type TrailMark } from '../go2/pose';
  import { kinematicPose, setBrushAxisTolerance, setHelper, setPostureAware, simSettings } from '../go2/settings';
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
  let showCollision = $state(false);

  const cache: { key: string; fingerprints: string[]; marks: TrailMark[] } = {
    key: '',
    fingerprints: [],
    marks: [],
  };

  function channelLine(name: 'FL' | 'FR', leg: LegReport): string {
    const role = leg.channel === 'drawing' ? 'Drawing' : leg.channel === 'travel' ? 'Travel' : leg.channel === 'resting' ? 'Resting' : '—';
    const contact = leg.channel === 'drawing' ? 'down' : leg.channel === null ? '—' : 'up';
    const physical = name === 'FL' ? 'FL follows the left channel' : 'FR follows the right channel';
    const pose = leg.active
      ? physical
      : leg.note.includes('Manual')
        ? 'manual pose'
        : 'reference pose';
    return `${name} ${role} · ${contact} · ${pose}`;
  }

  function frameFingerprint(frame: MotionFrame): string {
    return [
      frame.time,
      frame.left.x,
      frame.left.y,
      frame.left.contact,
      frame.left.active === false ? 0 : 1,
      frame.right.x,
      frame.right.y,
      frame.right.contact,
      frame.right.active === false ? 0 : 1,
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
    const lab = $workspaceLab;
    const physics = $simulationBackend === 'mujoco' ? $physicsRun.snapshot : null;
    if (!lab.preview || physics) view.setBrushes(config.brushes.left, config.brushes.right);
    if (physics) view.setBrushCalibration(calibrationFrom($physicsRun.config));
    else if (!lab.preview) view.setBrushCalibration(null);
    const experiment = $simulationBackend === 'mujoco' ? $physicsRun.experiment : null;
    let marks: TrailMark[] = [];
    if (physics) {
      const mount = $physicsRun.config;
      if (mount.mountProfile === 'candidate-a') {
        const thickness = mount.platformThicknessM;
        view.setPlatform({
          center: [mount.paperOriginX, mount.paperOriginY, mount.paperOriginZ - thickness / 2],
          size: [mount.paperWidthM, mount.paperHeightM, thickness],
          paperZ: mount.paperOriginZ,
          yawRad: mount.paperYawRad,
          widthM: mount.paperWidthM,
          heightM: mount.paperHeightM,
        });
      } else if (mount.mountProfile === 'ground' && mount.boardThicknessM > 1e-4) {
        const thickness = mount.boardThicknessM;
        view.setPlatform({
          center: [mount.paperOriginX, mount.paperOriginY, thickness / 2],
          size: [mount.paperWidthM, mount.paperHeightM, thickness],
          paperZ: thickness,
          yawRad: mount.paperYawRad,
          widthM: mount.paperWidthM,
          heightM: mount.paperHeightM,
        });
      } else if (mount.mountProfile === 'ground') {
        view.setPlatform(null);
        view.setSurface(
          [mount.paperOriginX, mount.paperOriginY, 0],
          mount.paperYawRad,
          mount.paperWidthM,
          mount.paperHeightM,
        );
      } else if (pose) {
        view.setPlatform(null);
        view.setPaper(pose);
      }
      const feet = physics.feet;
      view.setFootSpheres(
        showCollision
          ? [feet.FL.sphere, feet.FR.sphere, feet.RL.sphere, feet.RR.sphere]
          : null,
      );
      view.setPhysicsPose({
        joints: physics.joints,
        basePosition: physics.basePosition,
        baseQuaternion: physics.baseQuaternion,
      });
      const drawing = $physicsRun.mode === 'air-draw';
      const scoring = $physicsRun.mode === 'score';
      const approaching = $physicsRun.mode === 'brush-approach' || $physicsRun.mode === 'aerial-gesture';
      const calibration = calibrationFrom($physicsRun.config);
      const measuredTip = brushWorld(physics.feet.FL.frame, physics.feet.FL.frameQuat, calibration).tip;
      view.setPhysicsGuide({
        support: physics.support.polygon,
        triangle: $physicsRun.mode === 'three-leg' || drawing || scoring || approaching ? physics.support.threeLegTriangle : [],
        com: physics.support.com,
        flTarget: experiment?.flTarget ?? null,
        desiredPath: drawing ? (experiment?.draw.desired ?? []) : approaching ? (experiment?.approach.desired ?? []) : [],
        achievedPath: drawing
          ? (experiment?.draw.achieved ?? [])
          : scoring
            ? (experiment?.score.achieved ?? [])
            : approaching
              ? (experiment?.approach.achieved ?? [])
              : [],
        brushDown: scoring ? (experiment?.score.desiredContact ?? []) : [],
        brushUp: scoring ? (experiment?.score.desiredTravel ?? []) : [],
        tipMeasured: measuredTip,
        tipDesired: experiment?.approach.commandedTip ?? experiment?.approach.tipTarget ?? null,
      });
      if (!trailsHidden) {
        view.setMarks([]);
        trailsHidden = true;
      }
    } else if (pose) {
      trailsHidden = false;
      view.setPhysicsGuide(null);
      view.setFootSpheres(null);
      view.setPose(pose);
      if (lab.preview) {
        const offset = brushTipInFoot(lab.query.calibration);
        const board = lab.query.boardThicknessM ?? 0;
        if (board > 1e-4) {
          view.setPlatform({
            center: [lab.query.origin[0], lab.query.origin[1], board / 2],
            size: [WORKSPACE_SHEET_M, WORKSPACE_SHEET_M, board],
            paperZ: board,
            yawRad: lab.query.yawRad,
            widthM: WORKSPACE_SHEET_M,
            heightM: WORKSPACE_SHEET_M,
          });
        } else {
          view.setPlatform(null);
          view.setSurface(lab.query.origin, lab.query.yawRad, WORKSPACE_SHEET_M, WORKSPACE_SHEET_M);
        }
        view.setBrushes(
          { ...config.brushes.left, offset: [offset[0], offset[1], offset[2]] },
          config.brushes.right,
        );
        view.setBrushCalibration(lab.query.calibration);
      } else {
        view.setPlatform(null);
      }
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
    if (!physics && lab.preview && lab.summary) {
      const selected = lab.selected !== null ? lab.summary.cells[lab.selected] : undefined;
      view.setWorkspace(
        lab.summary.cells.map((cell) => ({ position: cell.target, kind: cell.kind })),
        selected
          ? { target: selected.target, sphere: selected.sphere, clearanceM: selected.footClearanceM }
          : null,
      );
    } else {
      view.setWorkspace(null, null);
    }
  });

  function selectView(next: CameraView): void {
    view?.setView(next);
  }

  const pose = $derived($kinematicPose);
  const physicsSelected = $derived($simulationBackend === 'mujoco');
  const physicsLive = $derived(physicsSelected && $physicsRun.snapshot !== null);
  const experiment = $derived(physicsLive ? $physicsRun.experiment : null);
  const controlled = $derived(experiment !== null && experiment.mode !== 'motors-off');
  const compactWarning = $derived.by(() => {
    if (physicsLive && !controlled) return 'Zero torque. The robot may fall.';
    if (!pose || physicsLive) return null;
    const legs = [pose.legs.FL, pose.legs.FR];
    if (legs.some((leg) => leg.reachable === false)) return 'A front leg missed its position.';
    if (legs.some((leg) => leg.active && leg.posture?.drawing === 'invalid')) return 'Drawing posture invalid.';
    if (legs.some((leg) => leg.active && leg.posture?.contralateral === 'invalid')) return 'A front leg crosses the midline.';
    if (unreachableSamples > 0) {
      return `${unreachableSamples} unreachable ${unreachableSamples === 1 ? 'sample' : 'samples'} on this trail.`;
    }
    return null;
  });

  const STAGE_LABEL: Record<string, string> = {
    idle: 'Idle',
    posture: 'Posture hold',
    stand: 'Stand',
    shift: 'Shift',
    lift: 'Lift',
    draw: 'Draw',
    track: 'Track Creative Score',
    approach: 'Approach',
    gesture: 'Aerial gesture',
    hold: 'Hold',
    return: 'Return',
    done: 'Finished',
  };
</script>

<div class="viewport-stack">
<div class="viewport">
  <div class="viewport__stage" bind:this={host} data-role="simulation-viewport"></div>

  <div class="viewport__overlay">
    <p class="viewport__banner">{physicsLive ? PHYSICS_LABEL : PREVIEW_LABEL}</p>
    {#if physicsLive && $physicsRun.snapshot && experiment}
      <p class="mono viewport__reach">
        {STAGE_LABEL[experiment.stage] ?? experiment.stage} · t {$physicsRun.snapshot.time.toFixed(2)} s
      </p>
    {:else if pose}
      <p class="mono viewport__reach">
        {channelLine('FL', pose.legs.FL)}
        <span class="viewport__dot">·</span>
        {channelLine('FR', pose.legs.FR)}
      </p>
    {/if}
    {#if compactWarning}
      <p class="viewport__note">{compactWarning}</p>
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
      <button type="button" class="btn btn--small" onclick={() => selectView('front')}>Front</button>
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
      <button
        type="button"
        class="btn btn--small"
        aria-pressed={$simSettings.postureAware}
        onclick={() => setPostureAware(!$simSettings.postureAware)}
      >
        Posture IK
      </button>
      <label class="viewport__tolerance">
        <span>Axis</span>
        <input
          type="number"
          min="5"
          max="90"
          step="1"
          aria-label="Brush axis tolerance in degrees"
          value={$simSettings.brushAxisToleranceDeg}
          onchange={(event) => setBrushAxisTolerance(Number(event.currentTarget.value))}
        />
        <span>°</span>
      </label>
    </div>
    {#if physicsLive}
      <p class="viewport__legend">
        <span><i class="swatch swatch--achieved"></i> Measured support</span>
        <span><i class="swatch swatch--desired"></i> FR–RL–RR triangle</span>
        <span><i class="swatch swatch--paint"></i> Centre of mass</span>
        <span><i class="swatch swatch--target"></i> FL foot target</span>
        <span><i class="swatch swatch--foot"></i> Measured brush tip</span>
        <span><i class="swatch swatch--achieved"></i> Commanded brush tip</span>
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
        <span><i class="swatch swatch--rejected"></i> Rejected contact</span>
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

  <details class="viewport__details">
    <summary>Pose measurements</summary>
    <label class="viewport__note">
      <input type="checkbox" bind:checked={showCollision} />
      Show foot collision spheres
    </label>
  <div class="viewport__details-body">
    {#if physicsLive}
      <p class="viewport__banner">Brush Geometry Preview — No Contact Physics</p>
    {/if}
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
          {#if experiment.mode === 'brush-approach' || experiment.mode === 'aerial-gesture'}
            The turquoise marker is the commanded brush tip and the pink marker is the measured tip. A tip below the sheet is a signed distance, not contact.
            {#if experiment.config.mountProfile === 'candidate-a'}
              The gray block is the elevated collision platform. Its top is the paper. The brush shaft does not collide.
            {/if}
            {#if experiment.config.mountProfile === 'ground' && experiment.config.boardThicknessM > 0}
              The gray block is the low clipboard. Its top is the paper and its underside is the floor.
            {/if}
            {#if experiment.config.mountProfile === 'ground' && experiment.config.boardThicknessM <= 0}
              The paper lies on the floor. There is no collision board.
            {/if}
          {/if}
          This is not a safe path, and geometric paint is hidden.
        {:else}
          Zero torque. The robot may fall. Contacts are from MuJoCo. This is not a safe path, and geometric paint is hidden.
        {/if}
      </p>
      <p class="mono viewport__reach">
        base z {$physicsRun.snapshot.basePosition[2].toFixed(3)} m · roll {(($physicsRun.snapshot.rollRad * 180) / Math.PI).toFixed(1)}° · pitch {(($physicsRun.snapshot.pitchRad * 180) / Math.PI).toFixed(1)}° · FL clearance {($physicsRun.snapshot.feet.FL.clearanceM * 1000).toFixed(0)} mm · platform contacts {$physicsRun.snapshot.platformContactCount ?? 0} · t {$physicsRun.snapshot.time.toFixed(2)} s
      </p>
    {:else}
      <p class="viewport__note">
        Geometric preview of paint. A position the leg can reach is not a drawing posture, and it is not a physics result.
      </p>
      {#if $workspaceLab.preview}
        <p class="viewport__note">
          Brush-mount preview. The sheet and shaft follow the draft. The score trail still uses the baseline paper and mount. Mesh collision is not evaluated.
        </p>
      {/if}
    {/if}
    {#if pose && !physicsLive}
      {@const fl = pose.legs.FL}
      <p class="mono viewport__reach">
        FL {fl.reachable === null ? 'held' : fl.reachable ? 'Position reached' : 'Position missed'}
        {#if fl.positionErrorM !== null}
          · {(fl.positionErrorM * 1000).toFixed(0)} mm
        {/if}
        {#if fl.reachable === true && fl.posture.drawing === 'invalid'}
          · Drawing posture invalid
        {:else if fl.reachable === true}
          · No confirmed posture violation
        {/if}
        <span class="viewport__dot">·</span>
        FR {pose.legs.FR.reachable === null ? 'held' : pose.legs.FR.reachable ? 'Position reached' : 'Position missed'}
        {#if pose.legs.FR.positionErrorM !== null}
          · {(pose.legs.FR.positionErrorM * 1000).toFixed(0)} mm
        {/if}
      </p>
      <p class="mono viewport__reach">
        {channelLine('FL', fl)}
        <span class="viewport__dot">·</span>
        {channelLine('FR', pose.legs.FR)}
      </p>
      {#if fl.posture}
        <p class="mono viewport__reach">
          Brush axis {((fl.posture.brushAngleRad * 180) / Math.PI).toFixed(0)}° from the paper normal
          · tolerance {((fl.posture.toleranceRad * 180) / Math.PI).toFixed(0)}°
          · Joints {fl.posture.joints === 'valid' ? (fl.posture.nearLimit ? 'near a limit' : 'clear') : 'on a limit'}
          · Floor {(fl.posture.linkClearanceM * 1000).toFixed(0)} mm
          · {fl.posture.contralateral === 'invalid' ? 'Crosses the midline' : 'Stays on its side'}
          · Torso primitives {fl.posture.torso}
          · Mesh collision not evaluated
          {#if pose.canvasAssumed}
            · canvas 600×600 assumed
          {/if}
          {#if pose.manual}
            · manual
          {/if}
          {#if fl.alternateFound}
            · posture-aware pose
          {:else if $simSettings.postureAware}
            · no alternate pose within 5 mm
          {/if}
        </p>
      {/if}
      {#if unreachableSamples > 0}
        <p class="viewport__note">
          {unreachableSamples} unreachable
          {unreachableSamples === 1 ? 'sample' : 'samples'} on this trail. The drawing was not rescaled.
        </p>
      {/if}
    {/if}
  </div>
</details>
</div>

<style>
  .viewport-stack {
    display: flex;
    flex: 1 0 auto;
    flex-direction: column;
    gap: var(--space-2);
    min-width: 0;
  }

  .viewport {
    position: relative;
    flex: 1 0 auto;
    height: clamp(420px, 64vh, 720px);
    min-height: clamp(420px, 64vh, 720px);
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
    align-items: center;
    background: rgba(255, 255, 255, 0.9);
    border-radius: var(--radius);
    padding: 4px;
  }

  .viewport__tolerance {
    display: flex;
    align-items: center;
    gap: 6px;
    color: var(--color-text);
    font-size: 12px;
  }

  .viewport__tolerance input {
    width: 52px;
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

  .swatch--rejected {
    background: repeating-linear-gradient(90deg, var(--brand-pink) 0 5px, transparent 5px 8px);
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

  .viewport__details {
    flex: none;
    border: var(--border);
    border-radius: var(--radius);
    background: var(--brand-white);
  }

  .viewport__details summary {
    cursor: pointer;
    padding: var(--space-2) var(--space-3);
    font-family: var(--font-mono);
    font-size: 12px;
    letter-spacing: 0.06em;
    text-transform: uppercase;
    color: var(--brand-deep-purple);
  }

  .viewport__details-body {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: 0 var(--space-3) var(--space-3);
  }

  .viewport__details .viewport__banner,
  .viewport__details .viewport__note,
  .viewport__details .viewport__reach {
    width: auto;
    max-width: none;
    background: transparent;
    padding: 0;
  }

  @media (max-width: 720px) {
    .viewport {
      height: clamp(360px, 58vh, 520px);
      min-height: 360px;
    }
  }
</style>
