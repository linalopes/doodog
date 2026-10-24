<script lang="ts">
  /**
   * Motion diagnostics for the shared timeline.
   *
   * Samples come from the sandbox in batches. Each batch is solved with the
   * existing Go2 pose function, off the animation frame and off the Three.js
   * view. Choosing a time on a chart seeks the host timeline.
   */
  import { untrack } from 'svelte';
  import { motionOutput } from '../../motion/output';
  import { timeline, seek } from '../../motion/timeline';
  import { paramRevision } from '../../params/store';
  import { onMotionBatch, requestMotionBatch } from '../../p5/motionBatch';
  import type { SimConfig } from '../go2/defaults';
  import { LEGS } from '../go2/model';
  import { PREVIEW_LABEL } from '../go2/pose';
  import { simSettings } from '../go2/settings';
  import {
    acceptMotionBatch,
    analysisConfigKey,
    attachDerivatives,
    diagnoseFrame,
    type DiagnosticSample,
    type RawMotionSample,
  } from '../diagnostics/analyze';
  import { nearestSampleIndex } from '../diagnostics/chart';
  import {
    JOINT_LABELS,
    THRESHOLD_DISCLAIMER,
    collectEvents,
    eventTitle,
    type DiagnosticEvent,
    type JointIndex,
  } from '../diagnostics/events';
  import {
    ANALYSIS_INTERVAL_CHOICES,
    ANALYSIS_WINDOW_CHOICES,
    planAnalysis,
    type AnalysisRange,
  } from '../diagnostics/range';
  import {
    patchDiagnosticThresholds,
    patchSamplingSettings,
    samplingSettings,
    thresholdSettings,
  } from '../diagnostics/settings';
  import DiagnosticChart from './DiagnosticChart.svelte';

  const BATCH = 32;
  const RAD2DEG = 180 / Math.PI;

  interface MotionIdentity {
    runId: string | null;
    status: string;
    canvas: { width: number; height: number } | null;
    errorCode: string | null;
  }

  interface Capture {
    id: number;
    frames: RawMotionSample[];
    canvas: { width: number; height: number } | null;
    periodic: boolean;
    plan: AnalysisRange;
  }

  let cachedIdentity: MotionIdentity | null = null;
  let cachedIdentityKey = '';
  // A new object would count as a change on every playback frame and cancel
  // the sample in flight. Return the previous value until the sketch, its
  // status, or the canvas size actually changes.
  const motionIdentity = $derived.by(() => {
    const motion = $motionOutput;
    const key = `${motion.runId ?? ''}|${motion.status}|${motion.canvas?.width ?? 0}|${motion.canvas?.height ?? 0}|${motion.errorCode ?? ''}`;
    if (cachedIdentity && cachedIdentityKey === key) return cachedIdentity;
    cachedIdentityKey = key;
    cachedIdentity = {
      runId: motion.runId,
      status: motion.status,
      canvas: motion.canvas,
      errorCode: motion.errorCode,
    };
    return cachedIdentity;
  });

  const scoreDuration = $derived($timeline.durationSeconds);

  let cachedSolve: { key: string; config: SimConfig } | null = null;
  const solveInput = $derived.by(() => {
    const config = $simSettings;
    const key = analysisConfigKey(config);
    if (cachedSolve && cachedSolve.key === key) return cachedSolve;
    cachedSolve = { key, config };
    return cachedSolve;
  });

  let capture = $state<Capture | null>(null);
  let solved = $state<DiagnosticSample[] | null>(null);
  let phase = $state<'idle' | 'sampling' | 'solving' | 'ready' | 'incomplete' | 'missing'>('idle');
  let progress = $state('');
  let notice = $state('');
  let joint = $state<JointIndex>(1);
  let serial = 0;

  const thresholds = $derived($thresholdSettings);
  const events = $derived(
    solved && capture ? collectEvents(solved, thresholds, capture.periodic) : [],
  );
  const cursorTime = $derived($timeline.time);

  const readout = $derived.by(() => {
    if (!solved || solved.length === 0) return null;
    const index = nearestSampleIndex(
      solved.map((sample) => sample.time),
      cursorTime,
    );
    if (index === null) return null;
    return solved[index] ?? null;
  });

  function seriesValue(
    brush: DiagnosticSample['left'],
    source: 'joints' | 'velocity' | 'acceleration',
  ): number | null {
    if (source === 'joints') {
      const angle = brush.joints?.[joint];
      return angle === undefined ? null : angle * RAD2DEG;
    }
    const value = brush[source][joint];
    return value === null || value === undefined ? null : value * RAD2DEG;
  }

  function jointSeries(source: 'joints' | 'velocity' | 'acceleration'): {
    left: (number | null)[];
    right: (number | null)[];
  } {
    const samples = solved ?? [];
    return {
      left: samples.map((sample) => seriesValue(sample.left, source)),
      right: samples.map((sample) => seriesValue(sample.right, source)),
    };
  }

  const jointBounds = $derived(
    joint === 0 ? LEGS.FL.abduction : joint === 1 ? LEGS.FL.hip : LEGS.FL.knee,
  );
  const positionSeries = $derived(jointSeries('joints'));
  const velocitySeries = $derived(jointSeries('velocity'));
  const accelerationSeries = $derived(jointSeries('acceleration'));
  const times = $derived((solved ?? []).map((sample) => sample.time));

  function bandsFor(type: DiagnosticEvent['type']): { start: number; end: number }[] {
    return events
      .filter((event) => event.type === type && (event.joint === null || event.joint === joint))
      .map((event) => ({ start: event.time, end: Math.max(event.time, event.timeEnd) }));
  }

  function formatAmount(event: DiagnosticEvent): string {
    if (event.unit === 'rad') return `${(event.measured * RAD2DEG).toFixed(1)}°`;
    if (event.unit === 'rad/s') return `${(event.measured * RAD2DEG).toFixed(1)}°/s`;
    if (event.unit === 'rad/s2') return `${(event.measured * RAD2DEG).toFixed(0)}°/s²`;
    if (!Number.isFinite(event.measured)) return '—';
    return `${(event.measured * 1000).toFixed(0)} mm`;
  }

  function formatThreshold(event: DiagnosticEvent): string {
    if (event.unit === 'rad') return `${(event.threshold * RAD2DEG).toFixed(1)}°`;
    if (event.unit === 'rad/s') return `${(event.threshold * RAD2DEG).toFixed(1)}°/s`;
    if (event.unit === 'rad/s2') return `${(event.threshold * RAD2DEG).toFixed(0)}°/s²`;
    return `${(event.threshold * 1000).toFixed(0)} mm`;
  }

  function formatTime(event: DiagnosticEvent): string {
    if (Math.abs(event.timeEnd - event.time) < 1e-3) return `${event.time.toFixed(2)} s`;
    return `${event.time.toFixed(2)}–${event.timeEnd.toFixed(2)} s`;
  }

  function brushLine(name: string, brush: DiagnosticSample['left']): string {
    if (!brush.active) return `${name} inactive`;
    const angle = brush.joints?.[joint];
    const velocity = brush.velocity[joint];
    const reach =
      brush.reachable === null ? 'not solved' : brush.reachable ? 'reachable' : 'unreachable';
    const error =
      brush.positionErrorM === null ? '—' : `${Math.round(brush.positionErrorM * 1000)} mm`;
    const angleText = angle === undefined ? '—' : `${(angle * RAD2DEG).toFixed(1)}°`;
    const velocityText = velocity === null || velocity === undefined ? '—' : `${(velocity * RAD2DEG).toFixed(1)}°/s`;
    return `${name} ${angleText} · ${velocityText} · ${reach} · ${error}`;
  }

  function onDegrees(
    key: 'nearLimitRad' | 'positionJumpRad' | 'velocityRadPerSec' | 'accelerationRadPerSec2',
    raw: string,
  ) {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    patchDiagnosticThresholds({ [key]: (value * Math.PI) / 180 });
  }

  $effect(() => {
    const identity = motionIdentity;
    const duration = scoreDuration;
    const revision = $paramRevision;
    const sampling = $samplingSettings;
    if (!identity.runId || identity.status === 'idle') {
      capture = null;
      phase = 'idle';
      progress = '';
      notice = '';
      return;
    }

    const planned = planAnalysis({
      durationSeconds: duration,
      interval: sampling.interval,
      windowStart: sampling.windowStart,
      windowLength: sampling.windowLength,
    });
    if (!planned) {
      capture = null;
      phase = 'idle';
      notice = 'The analysis range has no duration.';
      return;
    }

    let cancelled = false;
    const ticket = untrack(() => {
      serial += 1;
      return serial;
    });
    const runId = identity.runId;
    capture = null;
    phase = 'sampling';
    notice = '';
    progress = `0 / ${planned.times.length}`;
    const collected: RawMotionSample[] = [];
    let cursor = 0;
    let watch = 0;
    let attempts = 0;

    const arm = () => {
      window.clearTimeout(watch);
      watch = window.setTimeout(() => {
        if (cancelled) return;
        phase = 'incomplete';
        notice =
          'The sketch did not finish this analysis sample. A long redraw can delay the sandbox. The chart is withheld until the batch is complete.';
      }, 8000);
    };

    const sendNext = () => {
      if (cancelled) return;
      if (cursor >= planned.times.length) {
        window.clearTimeout(watch);
        const output = identity.canvas;
        capture = {
          id: ticket,
          frames: collected,
          canvas: output,
          periodic: planned.kind === 'period',
          plan: planned,
        };
        return;
      }
      const times = planned.times.slice(cursor, cursor + BATCH);
      const sent = requestMotionBatch(times, ticket, revision);
      if (!sent) {
        attempts += 1;
        if (attempts > 20) {
          phase = 'incomplete';
          notice = 'Run a sketch in Create. Analysis reads motion(t) from that sandbox.';
          return;
        }
        window.setTimeout(() => {
          if (!cancelled) sendNext();
        }, 150);
        return;
      }
      attempts = 0;
      arm();
    };

    const stop = onMotionBatch((message) => {
      if (cancelled) return;
      const times = planned.times.slice(cursor, cursor + BATCH);
      if (!acceptMotionBatch({ runId, serial: ticket, revision, times }, message)) return;
      for (const sample of message.samples) collected.push(sample);
      cursor += times.length;
      progress = `${cursor} / ${planned.times.length}`;
      sendNext();
    });

    sendNext();
    return () => {
      cancelled = true;
      window.clearTimeout(watch);
      stop();
    };
  });

  $effect(() => {
    const current = capture;
    const input = solveInput;
    if (!current) {
      solved = null;
      return;
    }
    let cancelled = false;
    phase = 'solving';
    const samples: DiagnosticSample[] = [];
    let index = 0;
    const step = () => {
      if (cancelled) return;
      const end = Math.min(current.frames.length, index + 40);
      for (; index < end; index += 1) {
        const frame = current.frames[index];
        if (!frame) continue;
        samples.push(diagnoseFrame(frame, current.canvas, input.config));
      }
      progress = `Solving ${samples.length} / ${current.frames.length}`;
      if (index < current.frames.length) {
        window.setTimeout(step, 0);
        return;
      }
      const next = attachDerivatives(samples);
      solved = next;
      const missing = next.length > 0 && next.every((sample) => !sample.valid && sample.errorCode === 'missing');
      phase = missing ? 'missing' : 'ready';
      if (missing) notice = 'This sketch has no motion(t). There is no trajectory to diagnose.';
      else if (!current.canvas) notice = 'Canvas size was not reported. Mapping uses the assumed 600×600 canvas.';
      else notice = '';
    };
    step();
    return () => {
      cancelled = true;
    };
  });
</script>

<section class="panel diagnostics" aria-label="Motion diagnostics">
  <header class="diagnostics__header">
    <p class="section-label">Motion diagnostics</p>
    <p class="diagnostics__label">{PREVIEW_LABEL}</p>
  </header>
  <p class="help-text">
    Reachable means the existing solver can place the brush tip within 5 mm. A quiet chart means
    the samples look smooth at the thresholds below. Neither result is dynamic feasibility, and
    neither result is a claim that the motion is safe to run on a Unitree Go2. The score is not
    smoothed, clipped, or slowed down.
  </p>
  <p class="help-text">{THRESHOLD_DISCLAIMER}</p>

  <div class="diagnostics__controls">
    <label class="field">
      <span class="field__label">Sample interval</span>
      <select
        aria-label="Analysis sample interval"
        value={String($samplingSettings.interval)}
        onchange={(event) => patchSamplingSettings({ interval: Number(event.currentTarget.value) })}
      >
        {#each ANALYSIS_INTERVAL_CHOICES as choice (choice)}
          <option value={String(choice)}>{choice} s</option>
        {/each}
      </select>
    </label>
    {#if capture?.plan.kind === 'window' || scoreDuration === null}
      <label class="field">
        <span class="field__label">Window start s</span>
        <input
          type="number"
          min="0"
          step="1"
          value={$samplingSettings.windowStart}
          aria-label="Analysis window start"
          onchange={(event) => patchSamplingSettings({ windowStart: Number(event.currentTarget.value) })}
        />
      </label>
      <label class="field">
        <span class="field__label">Window length</span>
        <select
          aria-label="Analysis window length"
          value={String($samplingSettings.windowLength)}
          onchange={(event) => patchSamplingSettings({ windowLength: Number(event.currentTarget.value) })}
        >
          {#each ANALYSIS_WINDOW_CHOICES as choice (choice)}
            <option value={String(choice)}>{choice} s</option>
          {/each}
        </select>
      </label>
    {/if}
    <div class="diagnostics__joints" role="group" aria-label="Joint">
      {#each JOINT_LABELS as label, index (label)}
        <button
          type="button"
          class="btn btn--small"
          aria-pressed={joint === index}
          onclick={() => (joint = index as JointIndex)}
        >
          {label}
        </button>
      {/each}
    </div>
  </div>

  <p class="diagnostics__status mono">
    {#if phase === 'idle'}
      Run a sketch in Create to analyze motion(t).
    {:else if phase === 'sampling'}
      Sampling motion {progress}. The robot stays on the playhead while this runs.
    {:else if phase === 'solving'}
      Solving kinematics {progress}.
    {:else if phase === 'incomplete'}
      Analysis incomplete.
    {:else if phase === 'missing'}
      No motion(t).
    {:else if capture}
      {capture.plan.times.length} samples · every {capture.plan.interval.toFixed(3)} s · {capture.plan.note}
      {#if capture.plan.widened}
        The requested interval was {capture.plan.requestedInterval} s and was widened to stay within 400 samples.
      {/if}
    {/if}
  </p>
  {#if notice}
    <p class="help-text">{notice}</p>
  {/if}
  <p class="help-text">
    Derivatives use the analysis sample times, not the playback frame rate. Interior slopes are a
    three-point stencil. Acceleration is that same stencil applied to the velocity estimate. A
    spike shorter than the interval can be missed.
  </p>

  {#if phase === 'ready' && solved && capture}
    <DiagnosticChart
      label={`${JOINT_LABELS[joint]} position · limits ${ (jointBounds.min * RAD2DEG).toFixed(0) }° to ${ (jointBounds.max * RAD2DEG).toFixed(0) }°`}
      unit="degrees"
      {times}
      start={capture.plan.start}
      end={capture.plan.end}
      cursor={cursorTime}
      series={[
        { id: 'fl', name: 'FL', color: '#22113e', values: positionSeries.left },
        { id: 'fr', name: 'FR', color: '#ea7dff', values: positionSeries.right },
      ]}
      lines={[
        { value: jointBounds.min * RAD2DEG, label: 'min' },
        { value: jointBounds.max * RAD2DEG, label: 'max' },
      ]}
      bands={bandsFor('near-limit').concat(bandsFor('position-discontinuity'))}
      onSeek={seek}
    />
    <DiagnosticChart
      label={`${JOINT_LABELS[joint]} angular velocity`}
      unit="degrees/second"
      {times}
      start={capture.plan.start}
      end={capture.plan.end}
      cursor={cursorTime}
      series={[
        { id: 'fl', name: 'FL', color: '#22113e', values: velocitySeries.left },
        { id: 'fr', name: 'FR', color: '#ea7dff', values: velocitySeries.right },
      ]}
      lines={[
        { value: thresholds.velocityRadPerSec * RAD2DEG, label: 'threshold' },
        { value: -thresholds.velocityRadPerSec * RAD2DEG, label: 'threshold-neg' },
      ]}
      bands={bandsFor('velocity-threshold')}
      onSeek={seek}
    />
    <DiagnosticChart
      label={`${JOINT_LABELS[joint]} angular acceleration`}
      unit="degrees/second²"
      {times}
      start={capture.plan.start}
      end={capture.plan.end}
      cursor={cursorTime}
      series={[
        { id: 'fl', name: 'FL', color: '#22113e', values: accelerationSeries.left },
        { id: 'fr', name: 'FR', color: '#ea7dff', values: accelerationSeries.right },
      ]}
      lines={[
        { value: thresholds.accelerationRadPerSec2 * RAD2DEG, label: 'threshold' },
        { value: -thresholds.accelerationRadPerSec2 * RAD2DEG, label: 'threshold-neg' },
      ]}
      bands={bandsFor('acceleration-threshold')}
      onSeek={seek}
    />
    <DiagnosticChart
      label="Brush-tip tracking error"
      unit="millimetres"
      {times}
      start={capture.plan.start}
      end={capture.plan.end}
      cursor={cursorTime}
      series={[
        {
          id: 'left',
          name: 'Left',
          color: '#22113e',
          values: solved.map((sample) =>
            sample.left.positionErrorM === null ? null : sample.left.positionErrorM * 1000,
          ),
        },
        {
          id: 'right',
          name: 'Right',
          color: '#ea7dff',
          values: solved.map((sample) =>
            sample.right.positionErrorM === null ? null : sample.right.positionErrorM * 1000,
          ),
        },
      ]}
      lines={[{ value: thresholds.trackingErrorM * 1000, label: 'threshold' }]}
      marks={solved
        .filter((sample) => sample.left.reachable === false || sample.right.reachable === false)
        .map((sample) => ({ time: sample.time, color: '#cc4444' }))}
      bands={bandsFor('unreachable').concat(bandsFor('tracking-error'))}
      onSeek={seek}
    />

    {#if readout}
      <p class="diagnostics__readout mono">
        Playhead {cursorTime.toFixed(2)} s · sample {readout.time.toFixed(2)} s ·
        {brushLine('FL', readout.left)} · {brushLine('FR', readout.right)}
      </p>
    {/if}

    <div class="diagnostics__events">
      <p class="section-label">Events</p>
      {#if events.length === 0}
        <p class="help-text">
          No diagnostic events at these thresholds. That is a statement about this sampling, not a
          clearance to run the motion.
        </p>
      {:else}
        <ul>
          {#each events.slice(0, 16) as event (`${event.type}-${event.leg}-${event.joint}-${event.time}-${event.boundary}`)}
            <li>
              <button type="button" class="diagnostics__event" onclick={() => seek(event.time)}>
                <span>{formatTime(event)}</span>
                <span>{eventTitle(event.type, event.boundary)}</span>
                <span>{event.leg}{event.joint === null ? '' : ` ${JOINT_LABELS[event.joint]}`}</span>
                <span>{formatAmount(event)} · threshold {formatThreshold(event)}</span>
                <span>{event.derived ? 'estimate' : 'measured'}</span>
              </button>
            </li>
          {/each}
        </ul>
        {#if events.length > 16}
          <p class="help-text">{events.length - 16} more events are not listed.</p>
        {/if}
      {/if}
    </div>
  {/if}

  <div class="diagnostics__thresholds">
    <p class="section-label">Thresholds</p>
    <label class="field">
      <span class="field__label">Near limit °</span>
      <input
        type="number"
        min="0.5"
        max="20"
        step="0.5"
        value={thresholds.nearLimitRad * RAD2DEG}
        aria-label="Near-limit margin in degrees"
        onchange={(event) => onDegrees('nearLimitRad', event.currentTarget.value)}
      />
    </label>
    <label class="field">
      <span class="field__label">Position jump °</span>
      <input
        type="number"
        min="1"
        max="90"
        step="1"
        value={thresholds.positionJumpRad * RAD2DEG}
        aria-label="Position discontinuity threshold in degrees"
        onchange={(event) => onDegrees('positionJumpRad', event.currentTarget.value)}
      />
    </label>
    <label class="field">
      <span class="field__label">Velocity °/s</span>
      <input
        type="number"
        min="10"
        max="2000"
        step="10"
        value={thresholds.velocityRadPerSec * RAD2DEG}
        aria-label="Angular velocity threshold in degrees per second"
        onchange={(event) => onDegrees('velocityRadPerSec', event.currentTarget.value)}
      />
    </label>
    <label class="field">
      <span class="field__label">Acceleration °/s²</span>
      <input
        type="number"
        min="50"
        max="20000"
        step="50"
        value={thresholds.accelerationRadPerSec2 * RAD2DEG}
        aria-label="Angular acceleration threshold in degrees per second squared"
        onchange={(event) => onDegrees('accelerationRadPerSec2', event.currentTarget.value)}
      />
    </label>
    <label class="field">
      <span class="field__label">Tip error mm</span>
      <input
        type="number"
        min="1"
        max="100"
        step="1"
        value={thresholds.trackingErrorM * 1000}
        aria-label="Brush tracking error threshold in millimetres"
        onchange={(event) => {
          const value = Number(event.currentTarget.value);
          if (Number.isFinite(value)) patchDiagnosticThresholds({ trackingErrorM: value / 1000 });
        }}
      />
    </label>
  </div>
</section>

<style>
  .diagnostics {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
    padding: var(--space-3);
  }

  .diagnostics__header {
    display: flex;
    justify-content: space-between;
    gap: var(--space-2);
    align-items: baseline;
  }

  .diagnostics__label {
    margin: 0;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-text-muted);
  }

  .diagnostics__controls,
  .diagnostics__thresholds {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    align-items: end;
  }

  .diagnostics__joints {
    display: inline-flex;
    gap: 4px;
  }

  .diagnostics__status,
  .diagnostics__readout {
    margin: 0;
    font-size: 12px;
  }

  .diagnostics__events ul {
    list-style: none;
    margin: 0;
    padding: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  .diagnostics__event {
    width: 100%;
    display: grid;
    grid-template-columns: 8.5rem 1.4fr 0.8fr 1.2fr auto;
    gap: var(--space-2);
    text-align: left;
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-text);
    background: var(--brand-white);
    border: var(--border);
    border-radius: var(--radius);
    padding: 6px 8px;
  }

  .diagnostics__event:hover {
    border-color: var(--brand-pink);
  }

  @media (max-width: 800px) {
    .diagnostics__event {
      grid-template-columns: 1fr;
    }
  }
</style>
