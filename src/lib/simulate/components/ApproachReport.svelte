<script lang="ts">
  import type { ApproachPreflight } from '../physics/approachAudit';
  import type { ExperimentPeaks } from '../physics/experiment';

  let {
    preflight,
    approachCommanded = false,
    tipSamples = 0,
    elapsed = null,
    stage = '',
    peaks = null,
  }: {
    preflight: ApproachPreflight | null;
    approachCommanded?: boolean;
    tipSamples?: number;
    elapsed?: number | null;
    stage?: string;
    peaks?: ExperimentPeaks | null;
  } = $props();

  function mm(value: number | null | undefined, digits = 1): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    return `${(value * 1000).toFixed(digits)} mm`;
  }

  function point(value: readonly number[] | null | undefined): string {
    if (!value) return '—';
    return value.map((item) => (item * 1000).toFixed(1)).join(', ');
  }

  function status(value: string): string {
    if (value === 'passed') return 'Passed';
    if (value === 'failed') return 'Failed';
    return 'Not Evaluated';
  }
</script>

{#if preflight}
  <details class="approach-report" open>
    <summary>Approach preflight</summary>
    <p class="help-text">{preflight.note}</p>
    <dl class="approach-report__grid">
      <div>
        <dt>Requested clearance</dt>
        <dd>{mm(preflight.requestedClearanceM, 0)}</dd>
      </div>
      <div>
        <dt>Predicted foot clearance</dt>
        <dd>{mm(preflight.footClearanceM)}</dd>
      </div>
      <div>
        <dt>Tip residual</dt>
        <dd>{mm(preflight.tipResidualM)}</dd>
      </div>
      <div>
        <dt>Brush angle</dt>
        <dd>{preflight.brushAngleDeg === null ? '—' : `${preflight.brushAngleDeg.toFixed(1)}°`}</dd>
      </div>
      <div>
        <dt>First failed gate</dt>
        <dd>{preflight.firstFailure ?? 'None'}</dd>
      </div>
      <div>
        <dt>Stage</dt>
        <dd>{stage || '—'}{elapsed === null ? '' : ` · ${elapsed.toFixed(2)} s`}</dd>
      </div>
      <div>
        <dt>Approach commands</dt>
        <dd>{approachCommanded ? 'Applied after the gate' : 'Not applied'}</dd>
      </div>
      <div>
        <dt>Classification</dt>
        <dd>{preflight.classification}</dd>
      </div>
    </dl>
    <p class="mono">
      Requested tip {point(preflight.requestedTip)} mm.
      Predicted tip {point(preflight.predictedTip)} mm.
      Predicted foot {point(preflight.predictedFoot)} mm.
      Collision sphere {point(preflight.predictedSphere)} mm.
    </p>
    <p class="mono">
      Jacobian residual {mm(preflight.jacobianResidualM, 3)}.
      Pass that first meets 5 mm: {preflight.passesToGate ?? 'none'}.
      The gate uses pass 5.
      {#if preflight.firstRejectedSample !== null}
        First rejected path sample {preflight.firstRejectedSample} of {preflight.path.length - 1}.
      {:else}
        No path sample failed inverse kinematics. Calf cylinders and meshes were not evaluated.
      {/if}
    </p>
    <ul class="approach-report__gates">
      {#each preflight.gates as gate (gate.id)}
        <li>
          <strong>{status(gate.status)}.</strong> {gate.label}. {gate.detail}
        </li>
      {/each}
    </ul>
    {#if peaks}
      <p class="help-text">
        Stand, Shift, and Lift were measured before the gate. Body roll peaked at {((peaks.maxAbsRollRad * 180) / Math.PI).toFixed(1)}°
        and pitch at {((peaks.maxAbsPitchRad * 180) / Math.PI).toFixed(1)}°. The lowest three-leg margin was
        {mm(peaks.minThreeLegMarginM)} during {peaks.minMarginStage ?? '—'}. The largest torque was {peaks.maxTorqueNm.toFixed(1)} Nm.
        {peaks.saturated ? 'A command was saturated.' : 'No command was saturated.'}
        These are not approach-tracking measurements.
      </p>
    {/if}
    <p class="help-text">
      {#if approachCommanded && tipSamples > 0}
        Physical tip samples: {tipSamples}. Those samples are measured positions. The residual above is still the preflight prediction.
      {:else if approachCommanded}
        The approach move was commanded. No tip sample has been stored yet.
      {:else}
        Physical tip tracking: Not Evaluated. The approach move was not commanded, so there is no measured tip to compare.
      {/if}
    </p>
  </details>
{/if}

<style>
  .approach-report {
    margin: 12px 0;
  }

  .approach-report__grid {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(140px, 1fr));
    gap: 8px 16px;
    margin: 8px 0;
  }

  .approach-report__grid dt {
    color: #6d6278;
    font-size: 12px;
  }

  .approach-report__grid dd {
    margin: 0;
  }

  .approach-report__gates {
    margin: 8px 0;
    padding-left: 18px;
  }

  .approach-report__gates li {
    margin: 4px 0;
  }
</style>
