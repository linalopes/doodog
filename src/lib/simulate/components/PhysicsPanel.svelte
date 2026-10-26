<script lang="ts">
  import {
    CLOCK_NOTE,
    COMPLETION_NOTE,
  } from '../physics/experiment';
  import {
    configureExperiment,
    initializePhysics,
    pauseExperiment,
    physicsRun,
    resetPhysics,
    resumeExperiment,
    setPhysicsMode,
    startExperiment,
    stepPhysicsOnce,
    stopExperiment,
  } from '../physics/run';
  import { timeline } from '../../motion/timeline';
  import { motionOutput } from '../../motion/output';
  import { activeSketch } from '../../sketches/store';
  import { gestureScale, otherChannel, trackStageSeconds } from '../physics/score';
  import { ASSUMED_CANVAS } from '../go2/defaults';
  import { APPROACH_NOTE, BRUSH_NOTE, CONTROLLER_NOTE, DEFAULT_EXPERIMENT, DRAW_COMPLETION_NOTE, DRAW_NOTE, SCORE_COMPLETION_NOTE, SCORE_NOTE } from '../physics/settings';
  import { paperFrom, tipToPaper } from '../go2/brush';
  import { FLOOR_NOTE, TORQUE_NOTE } from '../physics/scene';
  import { PHYSICS_LABEL, type PhysicsSnapshot } from '../physics/types';
  import type { PhysicsMode } from '../physics/experiment';

  const LEGS = ['FL', 'FR', 'RL', 'RR'] as const;
  const MODES: { id: PhysicsMode; label: string }[] = [
    { id: 'motors-off', label: 'Motors Off' },
    { id: 'posture-hold', label: 'Posture Hold' },
    { id: 'three-leg', label: 'Three-Leg Stance' },
    { id: 'air-draw', label: 'Drawing in the Air' },
    { id: 'score', label: 'Creative Score Tracking' },
    { id: 'brush-approach', label: 'Brush Approach — No Contact' },
  ];
  const STAGE: Record<string, string> = {
    idle: 'Idle',
    posture: 'Posture hold',
    stand: 'Stand',
    shift: 'Shift',
    lift: 'Lift',
    draw: 'Draw',
    track: 'Track Creative Score',
    approach: 'Approach',
    hold: 'Hold',
    return: 'Return',
    done: 'Finished',
  };
  const OUTCOME: Record<string, string> = {
    idle: 'Not started',
    running: 'Running',
    paused: 'Paused',
    completed: 'Completed',
    failed: 'Failed',
    interrupted: 'Interrupted',
  };

  const run = $derived($physicsRun);
  const ready = $derived(run.status === 'ready');
  const snapshot = $derived(run.snapshot);
  const experiment = $derived(run.experiment);
  const playing = $derived(experiment?.playback === 'playing');
  const controlled = $derived(run.mode !== 'motors-off');
  const stance = $derived(
    run.mode === 'three-leg' || run.mode === 'air-draw' || run.mode === 'score' || run.mode === 'brush-approach',
  );
  const approaching = $derived(run.mode === 'brush-approach');
  const drawing = $derived(run.mode === 'air-draw');
  const scoring = $derived(run.mode === 'score');
  const clock = $derived($timeline);
  const canvas = $derived($motionOutput.canvas ?? ASSUMED_CANVAS);
  const configuredScale = $derived(gestureScale(canvas.width, canvas.height, run.config.gestureSizeM));
  const scoreInfo = $derived(experiment?.score.info ?? null);
  const trackingSeconds = $derived.by(() => {
    if (!scoring) return null;
    const rate = Math.max(clock.rate, 0.1);
    const locked = experiment?.score.entryRate && experiment.score.entryRate > 0 ? experiment.score.entryRate : rate;
    if (scoreInfo) return trackStageSeconds(scoreInfo, locked, run.config.approachSeconds);
    const span = clock.durationSeconds && clock.durationSeconds > 0 ? clock.durationSeconds : run.config.trackSeconds;
    return run.config.approachSeconds + span / rate;
  });

  const degrees = (radians: number) => `${((radians * 180) / Math.PI).toFixed(1)}°`;

  function tipRelation(tip: readonly [number, number, number] | null): string {
    if (!tip) return '—';
    const relation = tipToPaper([tip[0], tip[1], tip[2]], paperFrom(run.config));
    const millimetres = (relation.signedM * 1000).toFixed(1);
    return `${millimetres} mm · ${relation.side} · ${relation.inside ? 'inside the sheet' : 'outside the sheet'}. Not contact.`;
  }

  function jointLine(sample: PhysicsSnapshot, leg: (typeof LEGS)[number]): string {
    return sample.joints[leg].map((angle) => degrees(angle)).join('  ');
  }

  function metres(value: number | null, digits = 0): string {
    if (value === null || !Number.isFinite(value)) return '—';
    return `${(value * 1000).toFixed(digits)} mm`;
  }

  function onLift(event: Event): void {
    const mm = Number((event.currentTarget as HTMLInputElement).value);
    void configureExperiment({ ...run.config, liftHeightM: mm / 1000 });
  }

  function onRadius(event: Event): void {
    const mm = Number((event.currentTarget as HTMLInputElement).value);
    void configureExperiment({ ...run.config, circleRadiusM: mm / 1000 });
  }

  function onDirection(event: Event): void {
    const direction = (event.currentTarget as HTMLSelectElement).value === 'cw' ? 'cw' : 'ccw';
    void configureExperiment({ ...run.config, direction });
  }

  function onGesture(event: Event): void {
    const mm = Number((event.currentTarget as HTMLInputElement).value);
    void configureExperiment({ ...run.config, gestureSizeM: mm / 1000 });
  }

  function onChannel(event: Event): void {
    const channel = (event.currentTarget as HTMLSelectElement).value === 'right' ? 'right' : 'left';
    void configureExperiment({ ...run.config, channel });
  }

  function onSeconds(
    key: 'shiftSeconds' | 'liftSeconds' | 'holdSeconds' | 'returnSeconds' | 'drawSeconds' | 'trackSeconds' | 'approachSeconds' | 'brushMoveSeconds',
    event: Event,
  ): void {
    const seconds = Number((event.currentTarget as HTMLInputElement).value);
    void configureExperiment({ ...run.config, [key]: seconds });
  }

  function flag(value: boolean | null): string {
    if (value === true) return 'met';
    if (value === false) return 'not met';
    return 'not reached';
  }

  function pointText(point: readonly [number, number, number] | null): string {
    if (!point) return '—';
    return `${(point[0] * 1000).toFixed(1)}, ${(point[1] * 1000).toFixed(1)}, ${(point[2] * 1000).toFixed(1)} mm`;
  }

  function reachText(initial: boolean | null, unreachable: boolean): string {
    if (initial === false) return 'first target unreachable · drawing was not resized';
    if (unreachable) return 'a later target was unreachable · drawing was not resized';
    if (initial === true) return 'first target inside the geometric workspace';
    return 'checked when tracking starts';
  }
</script>

<section class="physics" aria-label="MuJoCo physics experiment">
  <header class="physics__head">
    <h2>Physics experiment</h2>
    <p class="physics__label">{PHYSICS_LABEL}</p>
  </header>
  <p class="muted">
    Motors Off drops the Go2 under gravity. Posture Hold, Three-Leg Stance, Drawing in the Air, Creative Score
    Tracking, and Brush Approach send torque commands in simulation only. The circle, the creative path, and the
    brush tip are not ink and not contact. Nothing is sent to a physical robot.
  </p>
  <div class="physics__actions" role="group" aria-label="Controller">
    {#each MODES as mode (mode.id)}
      <button
        type="button"
        class="btn btn--small"
        aria-pressed={run.mode === mode.id}
        onclick={() => void setPhysicsMode(mode.id)}
      >
        {mode.label}
      </button>
    {/each}
  </div>
  <div class="physics__actions">
    <button type="button" class="btn btn--small" disabled={run.status === 'loading'} onclick={() => void initializePhysics()}>
      {run.status === 'loading' ? 'Loading…' : 'Initialize'}
    </button>
    <button type="button" class="btn btn--small" disabled={!ready} onclick={() => void resetPhysics()}>Reset</button>
    {#if !controlled}
      <button type="button" class="btn btn--small" disabled={!ready || !run.timelineFollow} onclick={stepPhysicsOnce}>Step</button>
    {:else}
      <button type="button" class="btn btn--small" disabled={!ready || playing || run.preparing} onclick={() => void startExperiment()}>
        {run.preparing ? 'Sampling…' : 'Start'}
      </button>
      <button type="button" class="btn btn--small" disabled={!playing} onclick={() => void pauseExperiment()}>Pause</button>
      <button
        type="button"
        class="btn btn--small"
        disabled={experiment?.outcome !== 'paused'}
        onclick={() => void resumeExperiment()}
      >
        Resume
      </button>
      <button
        type="button"
        class="btn btn--small"
        disabled={!playing && experiment?.outcome !== 'paused'}
        onclick={() => void stopExperiment()}
      >
        Stop
      </button>
    {/if}
  </div>
  {#if stance}
    <div class="physics__fields">
      <label class="field">
        <span class="field__label">Lift height</span>
        <input
          type="number"
          min="5"
          max="40"
          step="1"
          value={Math.round((run.config.liftHeightM || DEFAULT_EXPERIMENT.liftHeightM) * 1000)}
          onchange={onLift}
        />
      </label>
      <label class="field">
        <span class="field__label">Shift</span>
        <input type="number" min="0.5" max="8" step="0.1" value={run.config.shiftSeconds} onchange={(event) => onSeconds('shiftSeconds', event)} />
      </label>
      <label class="field">
        <span class="field__label">Lift</span>
        <input type="number" min="0.5" max="8" step="0.1" value={run.config.liftSeconds} onchange={(event) => onSeconds('liftSeconds', event)} />
      </label>
      <label class="field">
        <span class="field__label">Hold</span>
        <input type="number" min="0.5" max="8" step="0.1" value={run.config.holdSeconds} onchange={(event) => onSeconds('holdSeconds', event)} />
      </label>
      <label class="field">
        <span class="field__label">Return</span>
        <input type="number" min="0.5" max="8" step="0.1" value={run.config.returnSeconds} onchange={(event) => onSeconds('returnSeconds', event)} />
      </label>
      {#if approaching}
        <label class="field">
          <span class="field__label">Clearance</span>
          <input
            type="number"
            min="5"
            max="40"
            step="1"
            value={Math.round((run.config.brushClearanceM || DEFAULT_EXPERIMENT.brushClearanceM) * 1000)}
            onchange={(event) => {
              const mm = Number((event.currentTarget as HTMLInputElement).value);
              if (Number.isFinite(mm)) void configureExperiment({ ...run.config, brushClearanceM: mm / 1000 });
            }}
          />
        </label>
        <label class="field">
          <span class="field__label">Approach</span>
          <input
            type="number"
            min="1"
            max="8"
            step="0.1"
            value={run.config.brushMoveSeconds}
            onchange={(event) => onSeconds('brushMoveSeconds', event)}
          />
        </label>
      {/if}
      {#if drawing}
        <label class="field">
          <span class="field__label">Circle radius</span>
          <input
            type="number"
            min="5"
            max="40"
            step="1"
            value={Math.round((run.config.circleRadiusM || DEFAULT_EXPERIMENT.circleRadiusM) * 1000)}
            onchange={onRadius}
          />
        </label>
        <label class="field">
          <span class="field__label">Draw</span>
          <input type="number" min="1" max="12" step="0.1" value={run.config.drawSeconds} onchange={(event) => onSeconds('drawSeconds', event)} />
        </label>
        <label class="field">
          <span class="field__label">Direction</span>
          <select value={run.config.direction} onchange={onDirection}>
            <option value="ccw">Counterclockwise</option>
            <option value="cw">Clockwise</option>
          </select>
        </label>
      {/if}
      {#if scoring}
        <label class="field">
          <span class="field__label">Creative brush</span>
          <select value={run.config.channel} onchange={onChannel}>
            <option value="left">Left</option>
            <option value="right">Right</option>
          </select>
        </label>
        <label class="field">
          <span class="field__label">Gesture envelope</span>
          <input
            type="number"
            min="5"
            max="80"
            step="1"
            value={Math.round((run.config.gestureSizeM || DEFAULT_EXPERIMENT.gestureSizeM) * 1000)}
            onchange={onGesture}
          />
        </label>
        <label class="field">
          <span class="field__label">Approach</span>
          <input type="number" min="0.5" max="4" step="0.1" value={run.config.approachSeconds} onchange={(event) => onSeconds('approachSeconds', event)} />
        </label>
        <label class="field">
          <span class="field__label">Window</span>
          <input type="number" min="1" max="32" step="0.5" value={run.config.trackSeconds} onchange={(event) => onSeconds('trackSeconds', event)} />
        </label>
      {/if}
    </div>
    <p class="help-text">Durations are seconds of physics experiment time. Lift height is millimetres of foot clearance. Circle radius is millimetres in the horizontal plane, and it is not reduced to make the circle reachable. The gesture envelope is millimetres on the longer canvas side. It is not the 0.20 m paper, and the drawing is not fitted to the reachable workspace.</p>
  {/if}
  <p class="help-text">{controlled ? CLOCK_NOTE : 'Play and pause on the shared timeline. Physics integrates toward that time in fixed steps. Seeking backward inside this run resets the model and replays it. Seeking before the run is refused.'}</p>
  {#if drawing}
    <p class="help-text">{DRAW_NOTE}</p>
    <p class="help-text">{DRAW_COMPLETION_NOTE}</p>
  {:else if scoring}
    <p class="help-text">{SCORE_NOTE}</p>
    <p class="help-text">{SCORE_COMPLETION_NOTE}</p>
    <p class="help-text">
      Active sketch: {$activeSketch?.name ?? 'No sketch'}. Physical drawing leg: FL. The {otherChannel(run.config.channel)} brush
      is ignored and does not command a leg. Creative playback is {clock.playState} at {clock.rate}×. Score time during Track
      advances at that rate. At 1×, one score second takes one physics second.
      {#if clock.durationSeconds}
        One declared score period is {clock.durationSeconds.toFixed(2)} s.
      {:else}
        This score has no declared period. The window of {run.config.trackSeconds.toFixed(1)} score seconds is used.
      {/if}
      Tracking lasts {trackingSeconds === null ? '—' : trackingSeconds.toFixed(2)} s of physics time, including the approach.
      Configured mapping: {(configuredScale * 1000).toFixed(3)} mm per canvas unit, so the canvas is {(canvas.width * configuredScale * 1000).toFixed(1)} mm × {(canvas.height * configuredScale * 1000).toFixed(1)} mm.
    </p>
  {:else if approaching}
    <p class="help-text">{BRUSH_NOTE}</p>
    <p class="help-text">{APPROACH_NOTE}</p>
  {:else if run.mode === 'three-leg'}
    <p class="help-text">{COMPLETION_NOTE}</p>
  {/if}
  {#if run.error}
    <p class="physics__error" role="alert">{run.error}</p>
  {:else if experiment?.failure}
    <p class="physics__error" role="alert">{experiment.failure}</p>
  {:else if run.notice}
    <p class="help-text">{run.notice}</p>
  {/if}
  {#if run.info}
    <p class="mono physics__meta">
      Δt {run.info.timestep.toFixed(3)} s · mass {run.info.massKg.toFixed(3)} kg · gravity {run.info.gravity[2].toFixed(2)} m/s²
      · {run.info.nu} torque motors
    </p>
  {/if}
  {#if snapshot}
    <dl class="physics__readout">
      <div>
        <dt>Stage</dt>
        <dd>{experiment ? (STAGE[experiment.stage] ?? experiment.stage) : 'Motors off'}</dd>
      </div>
      <div>
        <dt>Outcome</dt>
        <dd>{experiment ? (OUTCOME[experiment.outcome] ?? experiment.outcome) : 'Not started'}</dd>
      </div>
      <div>
        <dt>Experiment time</dt>
        <dd>{(experiment?.elapsed ?? 0).toFixed(2)} s</dd>
      </div>
      <div>
        <dt>Physics time</dt>
        <dd>{snapshot.time.toFixed(3)} s</dd>
      </div>
      <div>
        <dt>Body height</dt>
        <dd>{snapshot.basePosition[2].toFixed(3)} m</dd>
      </div>
      <div>
        <dt>Roll / pitch</dt>
        <dd>{degrees(snapshot.rollRad)} / {degrees(snapshot.pitchRad)}</dd>
      </div>
      <div>
        <dt>Feet on floor</dt>
        <dd>{snapshot.support.feet.length ? snapshot.support.feet.join(' ') : 'none'}</dd>
      </div>
      <div>
        <dt>FL clearance</dt>
        <dd>{metres(snapshot.feet.FL.clearanceM)}{snapshot.feet.FL.onFloor ? ' · down' : ' · up'}</dd>
      </div>
      <div>
        <dt>Support margin</dt>
        <dd>{metres(snapshot.support.marginM)}{snapshot.support.inside ? ' · inside' : ' · outside'}</dd>
      </div>
      <div>
        <dt>Three-leg margin</dt>
        <dd>
          {metres(snapshot.support.threeLegMarginM)}
          {snapshot.support.threeLegFeetDown ? '' : ' · a support foot is up'}
        </dd>
      </div>
      <div>
        <dt>Actuator effort</dt>
        <dd>{snapshot.effortNm.toFixed(1)} Nm sum · {snapshot.maxAbsTorqueNm.toFixed(1)} Nm max{snapshot.saturated ? ' · clamped' : ''}</dd>
      </div>
    </dl>
    {#if stance && experiment}
      <ul class="physics__joints">
        <li><span>Stand</span> {flag(experiment.criteria.stand)}</li>
        <li><span>Shift</span> {flag(experiment.criteria.shift)}</li>
        <li><span>Lift</span> {flag(experiment.criteria.lift)}</li>
        {#if drawing}
          <li><span>Draw</span> {flag(experiment.criteria.draw)}</li>
        {/if}
        {#if scoring}
          <li><span>Track</span> {flag(experiment.criteria.track)}</li>
        {/if}
        {#if approaching}
          <li><span>Approach</span> {flag(experiment.criteria.approach)}</li>
        {/if}
        <li><span>Hold</span> {flag(experiment.criteria.hold)}</li>
        <li><span>Return</span> {flag(experiment.criteria.return)}</li>
      </ul>
    {/if}
    {#if approaching && experiment}
      <dl class="physics__readout">
        <div><dt>Brush tip target</dt><dd>{pointText(experiment.approach.tipTarget)}</dd></div>
        <div><dt>Measured tip</dt><dd>{pointText(experiment.approach.measuredTip)}</dd></div>
        <div><dt>Commanded tip</dt><dd>{pointText(experiment.approach.commandedTip)}</dd></div>
        <div><dt>Geometric gap</dt><dd>{experiment.approach.geometricErrorM === null ? '—' : `${(experiment.approach.geometricErrorM * 1000).toFixed(1)} mm`}</dd></div>
        <div><dt>Paper snapshot</dt><dd>{run.config.paperOriginX.toFixed(3)}, {run.config.paperOriginY.toFixed(3)}, {run.config.paperOriginZ.toFixed(3)} m · {(run.config.paperWidthM * 100).toFixed(0)} × {(run.config.paperHeightM * 100).toFixed(0)} cm</dd></div>
        <div><dt>Tip to paper</dt><dd>{tipRelation(experiment.approach.measuredTip)}</dd></div>
      </dl>
      {#if experiment.approach.note}
        <p class="muted">{experiment.approach.note}</p>
      {/if}
    {/if}
    {#if drawing && experiment}
      <dl class="physics__readout">
        <div>
          <dt>Tracking error</dt>
          <dd>{metres(experiment.draw.lastErrorM, 1)}</dd>
        </div>
        <div>
          <dt>Max / RMS error</dt>
          <dd>{metres(experiment.draw.maxErrorM, 1)} / {metres(experiment.rmsErrorM, 1)}</dd>
        </div>
        <div>
          <dt>Draw margin</dt>
          <dd>{metres(experiment.draw.minMarginM, 0)}</dd>
        </div>
        <div>
          <dt>Draw roll / pitch</dt>
          <dd>{degrees(experiment.draw.maxAbsRollRad)} / {degrees(experiment.draw.maxAbsPitchRad)}</dd>
        </div>
        <div>
          <dt>Draw torque</dt>
          <dd>{experiment.draw.maxTorqueNm.toFixed(1)} Nm max{experiment.draw.saturated ? ' · clamped' : ''}</dd>
        </div>
        <div>
          <dt>Run roll / pitch</dt>
          <dd>{degrees(experiment.peaks.maxAbsRollRad)} / {degrees(experiment.peaks.maxAbsPitchRad)}</dd>
        </div>
        <div>
          <dt>Run torque</dt>
          <dd>{experiment.peaks.maxTorqueNm.toFixed(1)} Nm max{experiment.peaks.saturated ? ' · clamped' : ''}</dd>
        </div>
        <div>
          <dt>Lowest three-leg margin</dt>
          <dd>
            {metres(experiment.peaks.minThreeLegMarginM, 0)}
            {experiment.peaks.minMarginStage ? ` · ${STAGE[experiment.peaks.minMarginStage] ?? experiment.peaks.minMarginStage}` : ''}
          </dd>
        </div>
        <div>
          <dt>Commanded radius</dt>
          <dd>{metres(experiment.draw.radiusM || null, 0)}</dd>
        </div>
        <div>
          <dt>Achieved span</dt>
          <dd>{metres(experiment.draw.achievedWidthM, 1)} × {metres(experiment.draw.achievedDepthM, 1)}</dd>
        </div>
        <div>
          <dt>Draw plane</dt>
          <dd>{experiment.draw.anchor ? `${(experiment.draw.anchor[2] * 1000).toFixed(1)} mm` : '—'}</dd>
        </div>
        <div>
          <dt>Foot at draw start</dt>
          <dd>{experiment.draw.achievedHeightM === null ? '—' : `${(experiment.draw.achievedHeightM * 1000).toFixed(1)} mm`}</dd>
        </div>
        <div>
          <dt>Revolution</dt>
          <dd>{experiment.draw.revolution ? 'complete' : 'not complete'}</dd>
        </div>
      </dl>
    {/if}
    {#if scoring && experiment}
      <dl class="physics__readout">
        <div>
          <dt>Creative brush</dt>
          <dd>{experiment.score.info?.channel ?? run.config.channel}</dd>
        </div>
        <div>
          <dt>Ignored brush</dt>
          <dd>{experiment.score.info?.ignoredChannel ?? otherChannel(run.config.channel)}</dd>
        </div>
        <div>
          <dt>Canvas</dt>
          <dd>
            {experiment.score.canvasX === null || experiment.score.canvasY === null
              ? '—'
              : `${experiment.score.canvasX.toFixed(1)}, ${experiment.score.canvasY.toFixed(1)}`}
          </dd>
        </div>
        <div>
          <dt>Contact</dt>
          <dd>{experiment.score.contact === null ? '—' : experiment.score.contact ? 'down · metadata' : 'up · travel'}</dd>
        </div>
        <div>
          <dt>Requested</dt>
          <dd>{pointText(experiment.score.requested)}</dd>
        </div>
        <div>
          <dt>Measured foot</dt>
          <dd>{pointText(experiment.score.measured)}</dd>
        </div>
        <div>
          <dt>Mapping scale</dt>
          <dd>
            {experiment.score.info
              ? `${(experiment.score.info.scaleM * 1000).toFixed(3)} mm/unit · ${(experiment.score.info.spanWidthM * 1000).toFixed(1)} × ${(experiment.score.info.spanHeightM * 1000).toFixed(1)} mm`
              : 'sampled at start'}
          </dd>
        </div>
        <div>
          <dt>Reachability</dt>
          <dd>{reachText(experiment.score.initialReachable, experiment.score.unreachable)}</dd>
        </div>
        <div>
          <dt>Tracking error</dt>
          <dd>{metres(experiment.score.lastErrorM, 1)}</dd>
        </div>
        <div>
          <dt>Max / RMS error</dt>
          <dd>{metres(experiment.score.maxErrorM, 1)} / {metres(experiment.score.rmsErrorM, 1)}</dd>
        </div>
        <div>
          <dt>Track margin</dt>
          <dd>{metres(experiment.score.minMarginM, 0)}</dd>
        </div>
        <div>
          <dt>Track roll / pitch</dt>
          <dd>{degrees(experiment.score.maxAbsRollRad)} / {degrees(experiment.score.maxAbsPitchRad)}</dd>
        </div>
        <div>
          <dt>Track torque</dt>
          <dd>{experiment.score.maxTorqueNm.toFixed(1)} Nm max{experiment.score.saturated ? ' · clamped' : ''}</dd>
        </div>
        <div>
          <dt>Run roll / pitch</dt>
          <dd>{degrees(experiment.peaks.maxAbsRollRad)} / {degrees(experiment.peaks.maxAbsPitchRad)}</dd>
        </div>
        <div>
          <dt>Run torque</dt>
          <dd>{experiment.peaks.maxTorqueNm.toFixed(1)} Nm max{experiment.peaks.saturated ? ' · clamped' : ''}</dd>
        </div>
        <div>
          <dt>Lowest three-leg margin</dt>
          <dd>
            {metres(experiment.peaks.minThreeLegMarginM, 0)}
            {experiment.peaks.minMarginStage ? ` · ${STAGE[experiment.peaks.minMarginStage] ?? experiment.peaks.minMarginStage}` : ''}
          </dd>
        </div>
        <div>
          <dt>Score cursor</dt>
          <dd>{experiment.score.cursor.toFixed(2)} s · {experiment.score.info ? `${experiment.score.info.scoreEnd.toFixed(2)} s` : '—'}</dd>
        </div>
        <div>
          <dt>Playback rate</dt>
          <dd>{experiment.score.playbackRate}× · stage locked at {experiment.score.entryRate > 0 ? `${experiment.score.entryRate}×` : '—'}</dd>
        </div>
        <div>
          <dt>Samples</dt>
          <dd>
            {experiment.score.info
              ? `${experiment.score.info.interval.toFixed(3)} s${experiment.score.info.widened ? ' · interval widened to stay within 320 samples' : ''}`
              : '—'}
          </dd>
        </div>
      </dl>
    {/if}
    <ul class="physics__joints">
      {#each LEGS as leg (leg)}
        <li>
          <span>{leg}</span>
          {jointLine(snapshot, leg)}
        </li>
      {/each}
    </ul>
    {#if snapshot.contacts.length > 0}
      <ul class="physics__contacts">
        {#each snapshot.contacts as contact, index (`${contact.geom1}-${contact.geom2}-${index}`)}
          <li>
            {contact.geom1} · {contact.geom2} · {(contact.distanceM * 1000).toFixed(1)} mm
          </li>
        {/each}
      </ul>
    {:else}
      <p class="help-text">No contacts at this sample.</p>
    {/if}
  {/if}
  <p class="help-text">{controlled ? CONTROLLER_NOTE : TORQUE_NOTE}</p>
  <p class="help-text">{FLOOR_NOTE}</p>
</section>

<style>
  .physics {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--brand-white);
  }

  .physics__head {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: baseline;
    justify-content: space-between;
  }

  .physics h2 {
    margin: 0;
    font-size: 16px;
  }

  .physics__label {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--brand-deep-purple);
  }

  .physics__actions,
  .physics__fields {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  .physics__fields {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(108px, 1fr));
  }

  .physics__error {
    margin: 0;
    color: var(--color-danger);
  }

  .physics__meta,
  .physics__joints,
  .physics__contacts {
    margin: 0;
  }

  .physics__readout {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--space-2);
    margin: 0;
  }

  .physics__readout div {
    min-width: 0;
  }

  .physics__readout dt {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.08em;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .physics__readout dd {
    margin: 0;
    font-variant-numeric: tabular-nums;
  }

  .physics__joints,
  .physics__contacts {
    padding: 0;
    list-style: none;
    font-family: var(--font-mono);
    font-size: 12px;
  }

  .physics__joints li,
  .physics__contacts li {
    display: flex;
    gap: var(--space-2);
  }

  .physics__joints span {
    width: 4.5rem;
    color: var(--brand-deep-purple);
  }
</style>
