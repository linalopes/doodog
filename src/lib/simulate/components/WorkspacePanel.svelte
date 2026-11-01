<script lang="ts">
  import { simulationBackend } from '../physics/backend';
  import { classifyPaperPoint, defaultWorkspaceQuery, type WorkspaceCell, type WorkspaceQuery } from '../go2/workspace';
  import {
    applyCandidate,
    cancelCandidateSearch,
    evaluateLabScore,
    labSnapshotJson,
    resetDraftToDefault,
    restoreBaseline,
    scheduleSample,
    selectWorkspaceCell,
    startGroundSearch,
    setLabQuery,
    showSelectedPose,
    startCandidateSearch,
    workspaceLab,
  } from '../go2/workspaceLab';
  import { followTimeline } from '../go2/settings';

  const SCORES = [
    { id: 'simple-line', label: 'Simple Line' },
    { id: 'grid', label: 'Grid' },
    { id: 'concentric-circles', label: 'Concentric Circles' },
  ];

  const lab = $derived($workspaceLab);
  const query = $derived(lab.query);
  const mount = $derived(query.calibration);
  const selected = $derived(lab.selected !== null ? lab.summary?.cells[lab.selected] ?? null : null);
  const baselineAtSelection = $derived.by(() => {
    if (!selected) return null;
    const baseline = defaultWorkspaceQuery();
    return classifyPaperPoint(selected.target, { ...baseline, origin: query.origin, yawRad: query.yawRad });
  });

  function mm(metres: number | undefined): string {
    if (metres === undefined || !Number.isFinite(metres)) return '—';
    return (metres * 1000).toFixed(1);
  }

  function deg(radians: number): string {
    return ((radians * 180) / Math.PI).toFixed(1);
  }

  function writeMount(axis: 0 | 1 | 2, text: string): void {
    const value = Number(text);
    if (!Number.isFinite(value)) return;
    const mountOffset: [number, number, number] = [mount.mountOffset[0], mount.mountOffset[1], mount.mountOffset[2]];
    mountOffset[axis] = Math.min(0.08, Math.max(-0.08, value / 1000));
    setLabQuery({ calibration: { mountOffset } });
  }

  function writeAngle(key: 'rollRad' | 'pitchRad' | 'yawRad', text: string): void {
    const value = Number(text);
    if (!Number.isFinite(value)) return;
    const radians = (Math.min(180, Math.max(-180, value)) * Math.PI) / 180;
    setLabQuery({ calibration: { [key]: radians } });
  }

  function writeLength(text: string): void {
    const value = Number(text);
    if (!Number.isFinite(value)) return;
    setLabQuery({ calibration: { lengthM: Math.min(0.12, Math.max(0.01, value / 1000)) } });
  }

  function writeOrigin(axis: 0 | 1 | 2, text: string): void {
    const value = Number(text);
    if (!Number.isFinite(value)) return;
    const origin: [number, number, number] = [query.origin[0], query.origin[1], query.origin[2]];
    origin[axis] = value / 1000;
    setLabQuery({ origin });
  }

  function writeYaw(text: string): void {
    const value = Number(text);
    if (!Number.isFinite(value)) return;
    setLabQuery({ yawRad: (Math.min(180, Math.max(-180, value)) * Math.PI) / 180 });
  }

  function writeTolerance(text: string): void {
    const value = Number(text);
    if (!Number.isFinite(value)) return;
    setLabQuery({ toleranceDeg: Math.min(90, Math.max(5, value)) });
  }

  function downloadSnapshot(): void {
    const blob = new Blob([labSnapshotJson()], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = 'doodog-workspace-candidate.json';
    link.click();
    URL.revokeObjectURL(url);
  }

  function percent(count: number, examined: number): string {
    if (examined <= 0) return '0%';
    return `${((100 * count) / examined).toFixed(0)}%`;
  }

  function angleSpan(span: { min: number; median: number; max: number } | null): string {
    if (!span) return '—';
    return `${span.min.toFixed(0)}° / ${span.median.toFixed(0)}° / ${span.max.toFixed(0)}°`;
  }

  function describe(cell: WorkspaceCell): string {
    const joints = cell.joints
      ? cell.joints.map((angle) => ((angle * 180) / Math.PI).toFixed(1)).join('°, ') + '°'
      : '—';
    return joints;
  }

  function mountText(item: WorkspaceQuery['calibration']): string {
    return `${mm(item.mountOffset[0])}, ${mm(item.mountOffset[1])}, ${mm(item.mountOffset[2])} mm · shaft ${mm(item.lengthM)} mm · rpy ${deg(item.rollRad)}°, ${deg(item.pitchRad)}°, ${deg(item.yawRad)}°`;
  }
</script>

<div class="lab">
  <section class="panel panel--soft">
    <h2>Brush mount and workspace</h2>
    <p class="muted">
      Geometric exploration for the front-left leg. The body stays on the home keyframe.
      The sheet stays 200 × 200 mm. A candidate passed the implemented checks only.
      Mesh collision is not evaluated, and nothing here was tested in MuJoCo.
    </p>
    <p class="help-text">{lab.notice}</p>
    {#if $simulationBackend === 'mujoco'}
      <p class="help-text">
        MuJoCo is selected, so the viewport is showing the physics robot. This lab does not change that controller.
        Return to the kinematic preview to see the draft shaft and sheet.
      </p>
    {/if}
  </section>

  <section class="panel">
    <p class="section-label">Manual exploration</p>
    <div class="lab__grid">
      {#each [0, 1, 2] as axis (axis)}
        <label class="field">
          <span class="field__label">Attachment {['X', 'Y', 'Z'][axis]} mm</span>
          <input type="number" step="1" min="-80" max="80" value={mm(mount.mountOffset[axis])} onchange={(event) => writeMount(axis as 0 | 1 | 2, event.currentTarget.value)} />
        </label>
      {/each}
      <label class="field">
        <span class="field__label">Shaft length mm</span>
        <input type="number" step="1" min="10" max="120" value={mm(mount.lengthM)} onchange={(event) => writeLength(event.currentTarget.value)} />
      </label>
      <label class="field">
        <span class="field__label">Roll °</span>
        <input type="number" step="1" min="-180" max="180" value={deg(mount.rollRad)} onchange={(event) => writeAngle('rollRad', event.currentTarget.value)} />
      </label>
      <label class="field">
        <span class="field__label">Pitch °</span>
        <input type="number" step="1" min="-180" max="180" value={deg(mount.pitchRad)} onchange={(event) => writeAngle('pitchRad', event.currentTarget.value)} />
      </label>
      <label class="field">
        <span class="field__label">Yaw °</span>
        <input type="number" step="1" min="-180" max="180" value={deg(mount.yawRad)} onchange={(event) => writeAngle('yawRad', event.currentTarget.value)} />
      </label>
    </div>
    <p class="section-label">Paper placement</p>
    <div class="lab__grid">
      {#each [0, 1, 2] as axis (axis)}
        <label class="field">
          <span class="field__label">Centre {['X', 'Y', 'Z'][axis]} mm</span>
          <input type="number" step="1" value={mm(query.origin[axis])} onchange={(event) => writeOrigin(axis as 0 | 1 | 2, event.currentTarget.value)} />
        </label>
      {/each}
      <label class="field">
        <span class="field__label">Paper yaw °</span>
        <input type="number" step="1" min="-180" max="180" value={deg(query.yawRad)} onchange={(event) => writeYaw(event.currentTarget.value)} />
      </label>
      <label class="field">
        <span class="field__label">Shaft tolerance °</span>
        <input type="number" step="1" min="5" max="90" value={query.toleranceDeg.toFixed(0)} onchange={(event) => writeTolerance(event.currentTarget.value)} />
      </label>
      <label class="field">
        <span class="field__label">Sample columns</span>
        <select value={query.columns} onchange={(event) => setLabQuery({ columns: Number(event.currentTarget.value) })}>
          <option value={4}>4</option>
          <option value={5}>5</option>
          <option value={6}>6</option>
          <option value={8}>8</option>
        </select>
      </label>
    </div>
    <p class="help-text">
      The experimental default tolerance is 25°. The shaft is brush −Z in the foot frame, then turned by the foot. It is not treated as world −Z.
      Sampling uses one row at a time so the viewport can keep drawing.
    </p>
    <div class="lab__actions">
      <button type="button" class="btn btn--small" onclick={() => scheduleSample()}>Sample workspace</button>
      <button type="button" class="btn btn--small" onclick={resetDraftToDefault}>Reset to default</button>
      <button type="button" class="btn btn--small" onclick={restoreBaseline}>Restore baseline</button>
      <button type="button" class="btn btn--small" onclick={downloadSnapshot}>Download snapshot</button>
    </div>
  </section>

  <section class="panel">
    <p class="section-label">Workspace map</p>
    {#if lab.sampling}
      <p class="help-text">Sampling the sheet.</p>
    {/if}
    {#if lab.summary}
      <p class="help-text">
        {lab.summary.columns}×{lab.summary.rows} samples.
        Unreachable {lab.summary.unreachable} ({percent(lab.summary.unreachable, lab.summary.examined)}).
        Posture invalid {lab.summary.postureInvalid} ({percent(lab.summary.postureInvalid, lab.summary.examined)}).
        Candidate {lab.summary.candidate} ({percent(lab.summary.candidate, lab.summary.examined)}).
        Indeterminate {lab.summary.indeterminate}.
        Largest connected candidate region {lab.summary.largestRegion} samples.
        Shaft angle min / median / max {angleSpan(lab.summary.reachedAngle)}.
        Candidate clearance {lab.summary.minCandidateClearanceM === null ? '—' : `${mm(lab.summary.minCandidateClearanceM)} mm`}.
        Mesh collision not evaluated. MuJoCo not tested.
      </p>
      <div class="lab__legend">
        <span><i class="swatch swatch--unreachable"></i> Position unreachable</span>
        <span><i class="swatch swatch--invalid"></i> Reachable, posture invalid</span>
        <span><i class="swatch swatch--candidate"></i> Candidate, mesh not evaluated</span>
        <span><i class="swatch swatch--indeterminate"></i> Indeterminate</span>
      </div>
      <p class="help-text">Top of the map is robot forward. Left of the map is robot left.</p>
      <div class="lab__map" style={`grid-template-columns: repeat(${lab.summary.columns}, 1fr)`}>
        {#each lab.summary.cells as cell, index (`${cell.column}-${cell.row}`)}
          <button
            type="button"
            class={`map__cell map__cell--${cell.kind}`}
            class:is-selected={lab.selected === index}
            aria-label={`Column ${cell.column + 1}, row ${cell.row + 1}, ${cell.kind}`}
            onclick={() => selectWorkspaceCell(index)}
          ></button>
        {/each}
      </div>
    {:else}
      <p class="help-text">Sample the workspace to draw the map. The creative score is not moved.</p>
    {/if}
    {#if selected}
      <div class="lab__detail">
        <p class="section-label">Selected sample</p>
        <p class="mono">Desired tip {selected.target.map((value) => value.toFixed(3)).join(', ')} m</p>
        <p class="mono">Achieved tip {selected.achieved ? selected.achieved.map((value) => value.toFixed(3)).join(', ') : '—'} m</p>
        <p class="mono">Joints {describe(selected)}</p>
        <p class="mono">
          Shaft {selected.brushAxis ? selected.brushAxis.map((value) => value.toFixed(3)).join(', ') : '—'}
          · {selected.brushAngleDeg === null ? '—' : `${selected.brushAngleDeg.toFixed(1)}°`} from the inward normal
        </p>
        <p class="mono">
          Foot clearance {selected.footClearanceM === null ? '—' : `${mm(selected.footClearanceM)} mm`}
          · link clearance {selected.linkClearanceM === null ? '—' : `${mm(selected.linkClearanceM)} mm`}
        </p>
        <p class="mono">
          Midline {selected.contralateral === 'invalid' ? 'crosses' : selected.contralateral === 'valid' ? 'stays on the FL side' : 'not evaluated'}
          · torso {selected.torso}
          · joints {selected.jointsStatus}
          · floor {selected.floor}
          · mesh not evaluated
        </p>
        <p class="mono">Reach error {selected.positionErrorM === null ? '—' : `${(selected.positionErrorM * 1000).toFixed(1)} mm`}</p>
        <p class="help-text">{selected.reason}</p>
        {#if baselineAtSelection}
          <p class="help-text">
            Same target with the default mount: {baselineAtSelection.kind.replace('-', ' ')}.
            Shaft {baselineAtSelection.brushAngleDeg === null ? '—' : `${baselineAtSelection.brushAngleDeg.toFixed(0)}°`}.
            {baselineAtSelection.reason}
          </p>
        {/if}
        <div class="lab__actions">
          <button type="button" class="btn btn--small" onclick={showSelectedPose} disabled={!selected.joints}>Show this pose</button>
          <button type="button" class="btn btn--small" onclick={followTimeline}>Follow timeline</button>
        </div>
      </div>
    {/if}
  </section>

  <section class="panel">
    <p class="section-label">Search candidate configurations</p>
    <p class="help-text">
      The search is a fixed list: attachment 35, 0, 0 mm, shaft 45 mm, yaw 0°, pitch −90 −45 0 45 90°, roll −90 0 90°,
      and four paper centres. Each uses a 5×5 sample. It does not claim a global optimum.
    </p>
    <div class="lab__actions">
      <button type="button" class="btn btn--small" onclick={startCandidateSearch} disabled={lab.searchRunning}>Search</button>
      <button type="button" class="btn btn--small" onclick={startGroundSearch} disabled={lab.searchRunning}>Search ground sheet</button>
      <button type="button" class="btn btn--small" onclick={cancelCandidateSearch} disabled={!lab.searchRunning}>Cancel</button>
    </div>
    {#if lab.searchRunning || lab.searchExamined > 0}
      <p class="help-text">
        {lab.searchExamined} of {lab.searchPlanned} configurations.
        {lab.searchCancelled ? 'Cancelled.' : lab.searchRunning ? 'Running.' : 'Finished.'}
      </p>
    {/if}
    {#each (lab.searchKind === 'ground' ? lab.searchResults : lab.searchResults.filter((item) => item.summary.candidate > 0)).slice(0, 6) as item, index (`${item.origin.join(',')}-${item.calibration.pitchRad}-${item.calibration.rollRad}-${item.boardThicknessM ?? 'h'}-${index}`)}
      <article class="lab__candidate">
        <p class="mono">{mountText(item.calibration)}</p>
        <p class="mono">
          Paper {item.origin.map((value) => (value * 1000).toFixed(0)).join(', ')} mm · yaw {((item.yawRad * 180) / Math.PI).toFixed(0)}°
          {#if item.boardThicknessM !== undefined}
            · board {(item.boardThicknessM * 1000).toFixed(0)} mm · upper surface z = {item.origin[2].toFixed(3)} m
          {/if}
        </p>
        <p class="help-text">
          {item.homeBoardClear === false
            ? 'Home-pose foot sphere intersects this board, so it is not an initialization candidate.'
            : item.summary.largestRegion > 0
              ? 'Geometrically promising on this sample.'
              : 'Geometrically rejected on this sample.'}
          Mesh collision not evaluated. Not dynamically tested here.
        </p>
        <p class="help-text">
          Candidates {item.summary.candidate} of {item.summary.examined} ({percent(item.summary.candidate, item.summary.examined)}).
          Largest region {item.summary.largestRegion} samples.
          Shaft angles {angleSpan(item.summary.candidateAngle)}.
          Minimum candidate clearance {item.summary.minCandidateClearanceM === null ? '—' : `${mm(item.summary.minCandidateClearanceM)} mm`}.
          Mesh collision not evaluated. MuJoCo not tested.
        </p>
        <button type="button" class="btn btn--small" onclick={() => applyCandidate(item)}>Apply to preview</button>
      </article>
    {/each}
    {#if !lab.searchRunning && lab.searchExamined > 0 && lab.searchResults.every((item) => item.summary.candidate === 0)}
      <p class="help-text">No configuration in this search produced a candidate on its sample.</p>
    {/if}
  </section>

  <section class="panel">
    <p class="section-label">Creative scores</p>
    <p class="help-text">
      The original score and its parameters stay as they are. Contact samples are checked against this draft.
      A run of candidate samples is not a proof that the motion between them can be drawn.
    </p>
    <div class="lab__actions">
      {#each SCORES as score (score.id)}
        <button type="button" class="btn btn--small" onclick={() => evaluateLabScore(score.id)}>{score.label}</button>
      {/each}
    </div>
    {#each lab.scores as score (score.id)}
      <article class="lab__candidate">
        <p class="mono">{score.id}</p>
        <p class="help-text">
          Position reached {score.positionPercent.toFixed(0)}% of {score.contactSamples} contact samples.
          Evaluated posture constraints {score.candidatePercent.toFixed(0)}%.
          Longest accepted run {score.longestAcceptedRun} of the longest contact run {score.longestContactRun}.
          Rejected {score.rejected}. Indeterminate {score.indeterminate}.
          {score.completePath ? 'Every contact sample is a candidate.' : 'There is no complete contiguous candidate path through the contact samples.'}
        </p>
        {#each score.rejections.slice(0, 4) as rejection (`${score.id}-${rejection.time}`)}
          <p class="mono">t {rejection.time.toFixed(2)} s · {rejection.kind} · {rejection.reason}</p>
        {/each}
      </article>
    {/each}
  </section>
</div>

<style>
  .lab {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .lab__grid {
    display: grid;
    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
    gap: var(--space-2);
  }

  .lab__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    margin-top: var(--space-2);
  }

  .lab__legend {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
    font-size: 0.85rem;
  }

  .lab__legend span {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
  }

  .swatch {
    width: 12px;
    height: 12px;
    border-radius: 4px;
    display: inline-block;
  }

  .swatch--unreachable { background: #cad8d8; }
  .swatch--invalid { background: #ea7dff; }
  .swatch--candidate { background: #22113e; }
  .swatch--indeterminate { background: #c8bdd4; }

  .lab__map {
    display: grid;
    gap: 3px;
    max-width: 280px;
    margin-top: var(--space-2);
  }

  .map__cell {
    aspect-ratio: 1;
    border: 0;
    border-radius: 4px;
    padding: 0;
    cursor: pointer;
  }

  .map__cell--unreachable { background: #cad8d8; }
  .map__cell--posture-invalid { background: #ea7dff; }
  .map__cell--candidate { background: #22113e; }
  .map__cell--indeterminate { background: #c8bdd4; }

  .map__cell.is-selected {
    outline: 2px solid #08f2db;
    outline-offset: 1px;
  }

  .lab__detail,
  .lab__candidate {
    margin-top: var(--space-2);
    display: flex;
    flex-direction: column;
    gap: var(--space-1);
  }

  .lab__candidate {
    border-top: 1px solid #cad8d8;
    padding-top: var(--space-2);
  }
</style>
