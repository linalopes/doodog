<script lang="ts">
  import { chartSeekTime, nearestSampleIndex } from '../diagnostics/chart.ts';
  import { keptBaseline } from '../physics/baselineStore.ts';
  import {
    FOOT_FRAME_NOTE,
    canKeepBaseline,
    compareSummaries,
    sameExecution,
    type EvalPoint,
    type ExecutionIdentity,
  } from '../physics/evaluation.ts';
  import { configureExperiment, physicsRun } from '../physics/run.ts';
  import { timeline } from '../../motion/timeline.ts';

  const WIDTH = 280;
  const HEIGHT = 72;

  let cursorT = $state<number | null>(null);

  const run = $derived($physicsRun);
  const experiment = $derived(run.experiment);
  const summary = $derived(experiment?.evaluation ?? null);
  const chart = $derived(summary?.chart ?? []);
  const times = $derived(chart.map((point) => point.t));
  const start = $derived(times[0] ?? 0);
  const end = $derived(times[times.length - 1] ?? 0);
  const cursorIndex = $derived(cursorT === null ? null : nearestSampleIndex(times, cursorT));
  const cursor = $derived(cursorIndex === null ? null : (chart[cursorIndex] ?? null));
  const baseline = $derived($keptBaseline);
  const rows = $derived(baseline && summary ? compareSummaries(baseline.summary, summary) : []);
  const info = $derived(experiment?.score.info ?? null);
  const identity = $derived(currentIdentity());
  const sameScore = $derived(baseline ? sameExecution(baseline.identity, identity) : false);

  function currentIdentity(): ExecutionIdentity {
    return {
      mode: run.mode,
      scoreVersion: info?.version ?? null,
      revision: info?.revision ?? null,
      runId: info?.runId ?? null,
      channel: info?.channel ?? null,
      gestureSizeM: info?.gestureSizeM ?? run.config.gestureSizeM,
      sampleIntervalS: info?.interval ?? run.config.sampleIntervalS,
      gainScale: run.config.gainScale,
      returnStyle: run.config.returnStyle,
      rate: experiment?.score.entryRate || $timeline.rate,
      brushLengthM: run.config.brushLengthM,
      brushMountXM: run.config.brushMountXM,
      brushMountYM: run.config.brushMountYM,
      brushMountZM: run.config.brushMountZM,
      brushRollRad: run.config.brushRollRad,
      brushPitchRad: run.config.brushPitchRad,
      brushYawRad: run.config.brushYawRad,
      brushClearanceM: run.config.brushClearanceM,
      paperOriginX: run.config.paperOriginX,
      paperOriginY: run.config.paperOriginY,
      paperOriginZ: run.config.paperOriginZ,
    };
  }

  function keep(): void {
    if (!summary || !experiment || !canKeepBaseline(experiment.outcome)) return;
    keptBaseline.set({
      summary,
      identity,
      label: `${run.mode} · ${experiment.outcome}`,
    });
  }

  function setBrush(
    key: 'brushLengthM' | 'brushMountXM' | 'brushMountYM' | 'brushMountZM' | 'brushRollRad' | 'brushPitchRad' | 'brushYawRad',
    value: number,
  ): void {
    if (!Number.isFinite(value)) return;
    void configureExperiment({ ...run.config, [key]: value });
  }

  function inspect(event: PointerEvent): void {
    const node =
      event.currentTarget instanceof SVGSVGElement
        ? event.currentTarget
        : event.target instanceof Element
          ? event.target.closest('svg')
          : null;
    if (!(node instanceof SVGSVGElement) || end <= start) return;
    const box = node.getBoundingClientRect();
    const time = chartSeekTime(event.clientX - box.left, box.width, start, end);
    if (time !== null) cursorT = time;
  }

  function bounds(values: readonly (number | null)[]): { min: number; max: number } | null {
    const finite = values.filter((value): value is number => value !== null && Number.isFinite(value));
    if (finite.length === 0) return null;
    let min = Math.min(...finite);
    let max = Math.max(...finite);
    if (max - min < 1e-9) {
      min -= 1;
      max += 1;
    }
    return { min, max };
  }

  function series(
    points: readonly EvalPoint[],
    pick: (point: EvalPoint) => number | null,
    scale: { min: number; max: number } | null,
  ): string {
    if (!scale || points.length === 0 || !(end > start)) return '';
    return points
      .map((point) => {
        const value = pick(point);
        if (value === null || !Number.isFinite(value)) return null;
        const x = ((point.t - start) / (end - start)) * WIDTH;
        const y = HEIGHT - ((value - scale.min) / (scale.max - scale.min)) * (HEIGHT - 4) - 2;
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .filter((pair): pair is string => pair !== null)
      .join(' ');
  }

  function cursorX(): number | null {
    if (!cursor || !(end > start)) return null;
    return ((cursor.t - start) / (end - start)) * WIDTH;
  }

  function mm(value: number | null | undefined, digits = 1): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    return `${(value * 1000).toFixed(digits)} mm`;
  }

  function seconds(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    return `${value.toFixed(3)} s`;
  }

  function deg(value: number): string {
    return `${((value * 180) / Math.PI).toFixed(1)}°`;
  }

  function joints(point: readonly [number, number, number] | null): string {
    if (!point) return '—';
    return point.map((value) => value.toFixed(3)).join(', ');
  }

  function vec(point: readonly [number, number, number] | null | undefined): string {
    if (!point) return '—';
    return point.map((value) => (value * 1000).toFixed(1)).join(', ');
  }

  function snapshotText(): string {
    if (!info) return 'No captured score. Drawing in the Air uses the circle settings instead.';
    const params = Object.entries(info.paramSnapshot)
      .map(([key, value]) => `${key}=${String(value)}`)
      .join(', ');
    return [
      `${info.sketchName} · version ${info.version} · revision ${info.revision}`,
      `brush ${info.channel}, ignored ${info.ignoredChannel}`,
      `interval ${info.interval.toFixed(3)} s${info.widened ? ' (widened to the sample cap)' : ''}`,
      `gesture ${(info.gestureSizeM * 1000).toFixed(1)} mm · scale ${(info.scaleM * 1000).toFixed(3)} mm/canvas-unit`,
      params ? `parameters ${params}` : 'no parameter snapshot',
    ].join(' · ');
  }

  const component = (point: EvalPoint, axis: 0 | 1 | 2) => point.measured[axis] - point.desired[axis];
  const errorValues = $derived(
    chart.flatMap((point) => [
      component(point, 0),
      component(point, 1),
      component(point, 2),
      Math.hypot(component(point, 0), component(point, 1), component(point, 2)),
    ]),
  );
  const errorScale = $derived(bounds(errorValues));
  const attitudeScale = $derived(bounds(chart.flatMap((point) => [point.roll, point.pitch])));
  const marginScale = $derived(bounds(chart.flatMap((point) => [point.margin3, point.margin4])));
  const torqueScale = $derived(bounds(chart.map((point) => point.torque)));
  const line = $derived(cursor ? cursorX() : null);
  const errorLine = $derived(series(chart, (point) => Math.hypot(component(point, 0), component(point, 1), component(point, 2)), errorScale));
  const xLine = $derived(series(chart, (point) => component(point, 0), errorScale));
  const yLine = $derived(series(chart, (point) => component(point, 1), errorScale));
  const zLine = $derived(series(chart, (point) => component(point, 2), errorScale));
  const torqueLine = $derived(series(chart, (point) => point.torque, torqueScale));
  const rollLine = $derived(series(chart, (point) => point.roll, attitudeScale));
  const pitchLine = $derived(series(chart, (point) => point.pitch, attitudeScale));
  const threeLine = $derived(series(chart, (point) => point.margin3, marginScale));
  const fourLine = $derived(series(chart, (point) => point.margin4, marginScale));
</script>

<section class="eval" aria-label="Controller evaluation">
  <header class="eval__head">
    <h2>Controller evaluation</h2>
    <p>Foot frame only. A lower error is not an improvement by itself.</p>
  </header>

  <div class="eval__fields">
    <label>
      Gain scale
      <input
        type="number"
        min="0.5"
        max="1.5"
        step="0.1"
        value={run.config.gainScale}
        onchange={(event) => {
          const gainScale = Number(event.currentTarget.value);
          if (Number.isFinite(gainScale)) void configureExperiment({ ...run.config, gainScale });
        }}
      />
    </label>
    <label>
      Sample interval
      <select
        value={run.config.sampleIntervalS <= 0.03 ? '0.02' : run.config.sampleIntervalS >= 0.075 ? '0.1' : '0.05'}
        onchange={(event) => {
          void configureExperiment({ ...run.config, sampleIntervalS: Number(event.currentTarget.value) });
        }}
      >
        <option value="0.02">0.02 s</option>
        <option value="0.05">0.05 s</option>
        <option value="0.1">0.10 s</option>
      </select>
    </label>
    <label>
      Return
      <select
        value={run.config.returnStyle}
        onchange={(event) => {
          const returnStyle = event.currentTarget.value === 'gradual' ? 'gradual' : 'baseline';
          void configureExperiment({ ...run.config, returnStyle });
        }}
      >
        <option value="baseline">Together</option>
        <option value="gradual">Touch down first</option>
      </select>
    </label>
    <label>
      Length
      <input
        type="number"
        min="5"
        max="120"
        step="1"
        value={Math.round(run.config.brushLengthM * 1000)}
        onchange={(event) => setBrush('brushLengthM', Number((event.target as HTMLInputElement).value) / 1000)}
      />
    </label>
    <label>
      Mount X
      <input
        type="number"
        min="-80"
        max="80"
        step="1"
        value={Math.round(run.config.brushMountXM * 1000)}
        onchange={(event) => setBrush('brushMountXM', Number((event.target as HTMLInputElement).value) / 1000)}
      />
    </label>
    <label>
      Mount Y
      <input
        type="number"
        min="-80"
        max="80"
        step="1"
        value={Math.round(run.config.brushMountYM * 1000)}
        onchange={(event) => setBrush('brushMountYM', Number((event.target as HTMLInputElement).value) / 1000)}
      />
    </label>
    <label>
      Mount Z
      <input
        type="number"
        min="-80"
        max="80"
        step="1"
        value={Math.round(run.config.brushMountZM * 1000)}
        onchange={(event) => setBrush('brushMountZM', Number((event.target as HTMLInputElement).value) / 1000)}
      />
    </label>
    <label>
      Roll
      <input
        type="number"
        min="-180"
        max="180"
        step="1"
        value={Math.round((run.config.brushRollRad * 180) / Math.PI)}
        onchange={(event) => setBrush('brushRollRad', (Number((event.target as HTMLInputElement).value) * Math.PI) / 180)}
      />
    </label>
    <label>
      Pitch
      <input
        type="number"
        min="-180"
        max="180"
        step="1"
        value={Math.round((run.config.brushPitchRad * 180) / Math.PI)}
        onchange={(event) => setBrush('brushPitchRad', (Number((event.target as HTMLInputElement).value) * Math.PI) / 180)}
      />
    </label>
    <label>
      Yaw
      <input
        type="number"
        min="-180"
        max="180"
        step="1"
        value={Math.round((run.config.brushYawRad * 180) / Math.PI)}
        onchange={(event) => setBrush('brushYawRad', (Number((event.target as HTMLInputElement).value) * Math.PI) / 180)}
      />
    </label>
  </div>
  <p class="eval__note">
    Change one setting, then Start. Playback rate is the tracking speed and lives on the creative
    timeline. Gesture envelope and return duration stay on the physics panel. These scales are
    experiment settings, not motor ratings. Ground reaction force is not in the contact summary.
  </p>

  {#if summary}
    <dl class="eval__readout">
      <div><dt>Samples</dt><dd>{summary.tracking.samples} tracking / {summary.samples} logged</dd></div>
      <div><dt>Max error</dt><dd>{mm(summary.tracking.maxM)}</dd></div>
      <div><dt>RMS error</dt><dd>{mm(summary.tracking.rmsM)}</dd></div>
      <div><dt>Mean error</dt><dd>{vec(summary.tracking.mean)} mm</dd></div>
      <div><dt>Lag</dt><dd>{seconds(summary.lag?.lagS)}</dd></div>
      <div><dt>Lag residual</dt><dd>{mm(summary.lag?.residualRmsM)}</dd></div>
      <div><dt>Offset after lag</dt><dd>{vec(summary.lag?.offset)} mm</dd></div>
      <div><dt>Slow / fast RMS</dt><dd>{mm(summary.slowRmsM)} / {mm(summary.fastRmsM)}</dd></div>
      <div><dt>Command sagitta</dt><dd>{mm(summary.sagittaM)}</dd></div>
      <div><dt>Body drift</dt><dd>{mm(summary.bodyDriftM)}</dd></div>
      <div><dt>Track roll / pitch</dt><dd>{deg(summary.maxAbsRollRad)} / {deg(summary.maxAbsPitchRad)}</dd></div>
      <div><dt>Track torque</dt><dd>{summary.maxTorqueNm.toFixed(1)} Nm{summary.saturated ? ' · saturated' : ''}</dd></div>
      <div><dt>Return</dt><dd>{summary.returnReport.kind}</dd></div>
      <div><dt>Return margins</dt><dd>three {mm(summary.returnReport.minThreeM)} · four {mm(summary.returnReport.minFourM)}</dd></div>
      <div><dt>FL touchdown</dt><dd>{seconds(summary.returnReport.flTouchT)}</dd></div>
    </dl>
    <h3>Brush tip</h3>
    <p class="eval__note">Separate from the foot-frame numbers above. A tip below the plane is not contact.</p>
    <dl class="eval__readout">
      <div><dt>Tip samples</dt><dd>{summary.tip.samples}</dd></div>
      <div><dt>Tip max error</dt><dd>{mm(summary.tip.samples ? summary.tip.maxM : null)}</dd></div>
      <div><dt>Tip RMS error</dt><dd>{mm(summary.tip.rmsM)}</dd></div>
      <div><dt>Tip mean error</dt><dd>{summary.tip.samples ? `${vec(summary.tip.mean)} mm` : '—'}</dd></div>
      <div><dt>Clearance range</dt><dd>{mm(summary.tipClearanceMinM)} to {mm(summary.tipClearanceMaxM)}</dd></div>
      <div><dt>Tip side</dt><dd>{summary.tipSide ?? '—'}</dd></div>
      <div><dt>Inside sheet</dt><dd>{summary.tipInside === null ? '—' : summary.tipInside ? 'inside' : 'outside'}</dd></div>
    </dl>
    <p class="eval__note">{summary.returnReport.note}</p>
    <p class="eval__note">{snapshotText()}</p>
    <p class="eval__note">
      Gain {run.config.gainScale.toFixed(2)} · return {run.config.returnStyle} · requested interval
      {run.config.sampleIntervalS.toFixed(2)} s · playback rate {$timeline.rate.toFixed(2)} · brush
      {(run.config.brushLengthM * 1000).toFixed(0)} mm · mount
      {(run.config.brushMountXM * 1000).toFixed(0)}, {(run.config.brushMountYM * 1000).toFixed(0)}, {(run.config.brushMountZM * 1000).toFixed(0)} mm
      · rpy {(run.config.brushRollRad * 180 / Math.PI).toFixed(0)}, {(run.config.brushPitchRad * 180 / Math.PI).toFixed(0)}, {(run.config.brushYawRad * 180 / Math.PI).toFixed(0)}°
      · paper {run.config.paperOriginX.toFixed(2)}, {run.config.paperOriginY.toFixed(2)}, {run.config.paperOriginZ.toFixed(2)} m
      · clearance {(run.config.brushClearanceM * 1000).toFixed(0)} mm
    </p>

    <div class="eval__charts">
      <figure>
        <figcaption>Error · total, X, Y, Z</figcaption>
        <svg
          viewBox="0 0 {WIDTH} {HEIGHT}"
          role="img"
          aria-label="Tracking error"
          onpointerdown={inspect}
        >
          <polyline points={errorLine} class="total" />
          <polyline points={xLine} class="axis" />
          <polyline points={yLine} class="axis y" />
          <polyline points={zLine} class="axis z" />
          {#if line !== null}<line x1={line} x2={line} y1="0" y2={HEIGHT} class="cursor" />{/if}
        </svg>
      </figure>
      <figure>
        <figcaption>Torque</figcaption>
        <svg
          viewBox="0 0 {WIDTH} {HEIGHT}"
          role="img"
          aria-label="Torque"
          onpointerdown={inspect}
        >
          <polyline points={torqueLine} class="total" />
          {#if line !== null}<line x1={line} x2={line} y1="0" y2={HEIGHT} class="cursor" />{/if}
        </svg>
      </figure>
      <figure>
        <figcaption>Body roll and pitch, one scale</figcaption>
        <svg
          viewBox="0 0 {WIDTH} {HEIGHT}"
          role="img"
          aria-label="Body attitude"
          onpointerdown={inspect}
        >
          <polyline points={rollLine} class="axis" />
          <polyline points={pitchLine} class="axis z" />
          {#if line !== null}<line x1={line} x2={line} y1="0" y2={HEIGHT} class="cursor" />{/if}
        </svg>
      </figure>
      <figure>
        <figcaption>Support margin · three-leg and four-foot</figcaption>
        <svg
          viewBox="0 0 {WIDTH} {HEIGHT}"
          role="img"
          aria-label="Support margins"
          onpointerdown={inspect}
        >
          <polyline points={threeLine} class="total" />
          <polyline points={fourLine} class="axis z" />
          {#if line !== null}<line x1={line} x2={line} y1="0" y2={HEIGHT} class="cursor" />{/if}
        </svg>
      </figure>
    </div>

    {#if cursor}
      <dl class="eval__readout">
        <div><dt>Cursor</dt><dd>{cursor.t.toFixed(2)} s · {cursor.stage}</dd></div>
        <div><dt>Desired foot</dt><dd>{vec(cursor.desired)} mm</dd></div>
        <div><dt>Measured foot</dt><dd>{vec(cursor.measured)} mm</dd></div>
        <div><dt>Error XYZ</dt><dd>{vec([cursor.measured[0] - cursor.desired[0], cursor.measured[1] - cursor.desired[1], cursor.measured[2] - cursor.desired[2]])} mm</dd></div>
        <div><dt>Body</dt><dd>{vec(cursor.body)} mm · {deg(cursor.roll)} / {deg(cursor.pitch)}</dd></div>
        <div><dt>FL joints</dt><dd>{joints(cursor.jointDesired)} / {joints(cursor.jointMeasured)} rad</dd></div>
        <div><dt>Contacts</dt><dd>{cursor.supportCount} feet · FL {cursor.flDown ? 'down' : 'up'} · torque {cursor.torque.toFixed(1)} Nm</dd></div>
        <div><dt>Margins</dt><dd>three {mm(cursor.margin3)} · four {mm(cursor.margin4)}</dd></div>
        <div><dt>Measured tip</dt><dd>{cursor.tipMeasured ? `${vec(cursor.tipMeasured)} mm` : '—'}</dd></div>
        <div><dt>Commanded tip</dt><dd>{cursor.tipDesired ? `${vec(cursor.tipDesired)} mm` : '—'}</dd></div>
        <div><dt>Tip clearance</dt><dd>{mm(cursor.tipClearanceM)} · {cursor.tipSide ?? '—'} · {cursor.tipInside === null || cursor.tipInside === undefined ? '—' : cursor.tipInside ? 'inside' : 'outside'}</dd></div>
      </dl>
    {/if}

    <div class="eval__actions">
      <button type="button" class="btn btn--small" disabled={!canKeepBaseline(experiment?.outcome ?? 'idle')} onclick={keep}>
        Keep this run as baseline
      </button>
      <button type="button" class="btn btn--small" disabled={!baseline} onclick={() => keptBaseline.set(null)}>
        Clear baseline
      </button>
    </div>
  {/if}

  {#if baseline}
    <p class="eval__note">
      Baseline: {baseline.label}.
      {sameScore ? 'The captured score identity matches this run.' : 'This run is not the same captured score or controller setting as the baseline.'}
      A smaller error with higher torque or a worse return is not counted as an improvement.
    </p>
    <table>
      <thead>
        <tr><th>Measure</th><th>Baseline</th><th>Current</th><th>Current − baseline</th></tr>
      </thead>
      <tbody>
        {#each rows as row (row.label)}
          <tr>
            <th scope="row">{row.label}</th>
            <td>{row.baseline}</td>
            <td>{row.current}</td>
            <td>{row.delta}</td>
          </tr>
        {/each}
        <tr>
          <th scope="row">Return class</th>
          <td>{baseline.summary.returnReport.kind}</td>
          <td>{summary?.returnReport.kind ?? '—'}</td>
          <td></td>
        </tr>
      </tbody>
    </table>
  {/if}

  <p class="eval__note">{FOOT_FRAME_NOTE}</p>
  <p class="eval__note">
    Sagitta is the largest gap between the commanded polyline and the chord of neighbouring
    samples. It is an interpolation scale, separate from the controller residual. Editing the live
    sketch does not change a score the experiment is already executing.
  </p>
</section>

<style>
  .eval {
    display: flex;
    flex-direction: column;
    gap: var(--space-2);
    padding: var(--space-3);
    border: var(--border);
    border-radius: var(--radius);
    background: var(--brand-white);
    color: var(--brand-deep-purple);
  }

  .eval h2,
  .eval h3,
  .eval p,
  .eval figcaption {
    margin: 0;
  }

  .eval h3 {
    font-size: 14px;
  }

  .eval h2 {
    font-size: 16px;
  }

  .eval__head p,
  .eval__note,
  figcaption {
    color: var(--color-text-muted);
    font-size: 12px;
  }

  .eval__fields,
  .eval__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
  }

  label {
    display: flex;
    flex-direction: column;
    gap: 4px;
    font-size: 12px;
  }

  input,
  select {
    border: var(--border);
    border-radius: var(--radius);
    background: var(--brand-white);
    color: var(--brand-deep-purple);
    padding: 4px 6px;
  }

  .eval__readout {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: var(--space-2);
    margin: 0;
  }

  .eval__readout div {
    min-width: 0;
  }

  .eval__readout dt {
    font-size: 11px;
    letter-spacing: 0.04em;
    text-transform: uppercase;
  }

  .eval__readout dd {
    margin: 0;
  }

  .eval__charts {
    display: grid;
    gap: var(--space-2);
  }

  svg {
    width: 100%;
    height: 72px;
    background: var(--color-surface-tint);
    border-radius: var(--radius);
    cursor: crosshair;
  }

  polyline {
    fill: none;
    stroke-width: 1.4;
  }

  .total {
    stroke: var(--brand-deep-purple);
  }

  .axis {
    stroke: var(--brand-pink);
  }

  .y {
    stroke: var(--brand-turquoise);
  }

  .z {
    stroke: var(--brand-gray-green);
    stroke-width: 2;
  }

  .cursor {
    stroke: var(--brand-pink);
    stroke-dasharray: 2 2;
  }

  table {
    width: 100%;
    border-collapse: collapse;
    font-size: 12px;
  }

  th,
  td {
    padding: 4px 6px;
    border-bottom: var(--border);
    text-align: left;
  }
</style>
