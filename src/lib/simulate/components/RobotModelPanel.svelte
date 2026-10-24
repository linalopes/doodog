<script lang="ts">
  import { LEGS, LEG_IDS, GO2_MODEL, type LegId } from '../go2/model';
  import {
    followTimeline,
    inspection,
    kinematicPose,
    patchBrush,
    patchBrushOffset,
    patchMapping,
    patchPaper,
    setManualJoint,
    simSettings,
  } from '../go2/settings';
  import type { HorizontalAxis } from '../go2/mapping';

  const AXES: HorizontalAxis[] = ['x', '-x', 'y', '-y'];

  function radians(id: LegId, index: 0 | 1 | 2): number {
    const pose = $kinematicPose;
    const inspect = $inspection;
    const joints = inspect.followTimeline && pose ? pose.joints[id] : inspect.joints[id];
    return joints[index];
  }

  function limit(id: LegId, index: 0 | 1 | 2): { min: number; max: number; name: string } {
    const leg = LEGS[id];
    const spec = index === 0 ? leg.abduction : index === 1 ? leg.hip : leg.knee;
    return { min: spec.min, max: spec.max, name: spec.name };
  }

  function onJoint(id: LegId, index: 0 | 1 | 2, event: Event): void {
    const degrees = Number((event.currentTarget as HTMLInputElement).value);
    if (!Number.isFinite(degrees)) return;
    setManualJoint(id, index, (degrees * Math.PI) / 180, $kinematicPose?.joints ?? null);
  }

  function onNumber(raw: string, apply: (value: number) => void): void {
    const value = Number(raw);
    if (!Number.isFinite(value)) return;
    apply(value);
  }

  function metres(value: number | null | undefined): string {
    if (value === null || value === undefined || !Number.isFinite(value)) return '—';
    return value.toFixed(3);
  }

  function vec(value: readonly number[] | null | undefined): string {
    if (!value) return '—';
    return value.map((entry) => entry.toFixed(3)).join(', ');
  }
</script>

<div class="model">
  <section class="panel panel--soft">
    <h2>Unitree Go2</h2>
    <p class="muted">
      Visual geometry and joint data come from the MuJoCo Menagerie model
      <code>{GO2_MODEL.sourceFile}</code>, itself derived from the Unitree URDF.
      Meshes are the Menagerie OBJ files. The scene does not import MJCF.
      <a href={GO2_MODEL.sourceUrl}>{GO2_MODEL.sourceUrl}</a>
    </p>
    <p class="muted">{GO2_MODEL.copyright}. {GO2_MODEL.license}. The license file is shipped with the meshes.</p>
    <p class="muted">
      World, body, paper, and foot frames are +X forward, +Y left, +Z up, in metres.
      The body stays on the home keyframe at z = 0.27 m. Rear legs hold that reference pose.
      Joint sliders pose only this virtual robot.
    </p>
  </section>

  <section class="panel">
    <div class="model__head">
      <p class="section-label">Joints</p>
      <button
        type="button"
        class="btn btn--small"
        aria-pressed={$inspection.followTimeline}
        onclick={() => followTimeline()}
      >
        {$inspection.followTimeline ? 'Following timeline' : 'Follow timeline'}
      </button>
    </div>
    {#each LEG_IDS as id (id)}
      {@const report = $kinematicPose?.legs[id]}
      <h3 class="model__leg">{id}</h3>
      {#if report}
        <p class="help-text">{report.note}</p>
      {/if}
      <div class="model__joints">
        {#each [0, 1, 2] as index (index)}
          {@const spec = limit(id, index as 0 | 1 | 2)}
          {@const value = radians(id, index as 0 | 1 | 2)}
          <label class="field">
            <span class="field__label">{spec.name}</span>
            <input
              type="range"
              min={(spec.min * 180) / Math.PI}
              max={(spec.max * 180) / Math.PI}
              step="0.1"
              value={(value * 180) / Math.PI}
              aria-valuemin={(spec.min * 180) / Math.PI}
              aria-valuemax={(spec.max * 180) / Math.PI}
              aria-valuenow={(value * 180) / Math.PI}
              oninput={(event) => onJoint(id, index as 0 | 1 | 2, event)}
            />
            <span class="mono model__read">
              {((value * 180) / Math.PI).toFixed(1)}° · {spec.min.toFixed(2)} to {spec.max.toFixed(2)} rad
            </span>
          </label>
        {/each}
      </div>
      {#if report}
        <dl class="model__facts">
          <div><dt>Foot</dt><dd class="mono">{vec(report.footWorld)} m</dd></div>
          <div><dt>Sphere</dt><dd class="mono">{vec(report.sphereWorld)} m</dd></div>
          <div><dt>Tip</dt><dd class="mono">{vec(report.tipWorld)} m</dd></div>
          <div><dt>Target</dt><dd class="mono">{vec(report.targetWorld)} m</dd></div>
          <div><dt>Error</dt><dd class="mono">{metres(report.positionErrorM === null ? null : report.positionErrorM * 1000)} mm</dd></div>
        </dl>
      {/if}
    {/each}
  </section>

  <section class="panel">
    <p class="section-label">Brushes</p>
    <p class="help-text">
      Offsets are in the foot frame, at the visual foot mesh. They are not the collision sphere,
      and they are not part of the sketch.
    </p>
    <div class="model__split">
      {#each ['left', 'right'] as side (side)}
        {@const mount = $simSettings.brushes[side as 'left' | 'right']}
        <div>
          <h3>{side === 'left' ? 'Left · FL' : 'Right · FR'}</h3>
          <label class="check">
            <input
              type="checkbox"
              checked={mount.visible}
              onchange={(event) => patchBrush(side as 'left' | 'right', { visible: event.currentTarget.checked })}
            />
            Visible
          </label>
          <label class="check">
            <input
              type="checkbox"
              checked={mount.active}
              onchange={(event) => patchBrush(side as 'left' | 'right', { active: event.currentTarget.checked })}
            />
            Active
          </label>
          {#each ['x', 'y', 'z'] as axis, axisIndex (axis)}
            <label class="field">
              <span class="field__label">{axis} offset m</span>
              <input
                type="number"
                step="0.001"
                value={mount.offset[axisIndex as 0 | 1 | 2]}
                onchange={(event) =>
                  onNumber(event.currentTarget.value, (value) =>
                    patchBrushOffset(side as 'left' | 'right', axisIndex as 0 | 1 | 2, value),
                  )}
              />
            </label>
          {/each}
        </div>
      {/each}
    </div>
  </section>

  <section class="panel">
    <p class="section-label">Painting surface</p>
    <p class="help-text">
      The sheet has its own size in metres. Scale is metres per canvas unit. Leave scale empty to
      derive it from the sheet and the reported canvas. The drawing is not resized to fit the legs.
    </p>
    <div class="model__split">
      <label class="field">
        <span class="field__label">Width m</span>
        <input type="number" step="0.01" min="0.01" value={$simSettings.paper.widthM} onchange={(event) => onNumber(event.currentTarget.value, (value) => value > 0 && patchPaper({ widthM: value }))} />
      </label>
      <label class="field">
        <span class="field__label">Height m</span>
        <input type="number" step="0.01" min="0.01" value={$simSettings.paper.heightM} onchange={(event) => onNumber(event.currentTarget.value, (value) => value > 0 && patchPaper({ heightM: value }))} />
      </label>
      {#each [0, 1, 2] as axis (axis)}
        <label class="field">
          <span class="field__label">Origin {['x', 'y', 'z'][axis]} m</span>
          <input
            type="number"
            step="0.01"
            value={$simSettings.paper.origin[axis as 0 | 1 | 2]}
            onchange={(event) =>
              onNumber(event.currentTarget.value, (value) => {
                const origin: [number, number, number] = [
                  $simSettings.paper.origin[0],
                  $simSettings.paper.origin[1],
                  $simSettings.paper.origin[2],
                ];
                origin[axis as 0 | 1 | 2] = value;
                patchPaper({ origin });
              })}
          />
        </label>
      {/each}
      <label class="field">
        <span class="field__label">Yaw deg</span>
        <input
          type="number"
          step="1"
          value={($simSettings.paper.yawRad * 180) / Math.PI}
          onchange={(event) =>
            onNumber(event.currentTarget.value, (value) => patchPaper({ yawRad: (value * Math.PI) / 180 }))}
        />
      </label>
      <label class="field">
        <span class="field__label">Lift m</span>
        <input
          type="number"
          step="0.005"
          min="0"
          value={$simSettings.paper.liftHeightM}
          onchange={(event) => onNumber(event.currentTarget.value, (value) => value >= 0 && patchPaper({ liftHeightM: value }))}
        />
      </label>
      <label class="field">
        <span class="field__label">Canvas +X axis</span>
        <select
          value={$simSettings.mapping.canvasXAxis}
          onchange={(event) => patchMapping({ canvasXAxis: event.currentTarget.value as HorizontalAxis })}
        >
          {#each AXES as axis (axis)}
            <option value={axis}>{axis}</option>
          {/each}
        </select>
      </label>
      <label class="field">
        <span class="field__label">Canvas +Y axis</span>
        <select
          value={$simSettings.mapping.canvasYAxis}
          onchange={(event) => patchMapping({ canvasYAxis: event.currentTarget.value as HorizontalAxis })}
        >
          {#each AXES as axis (axis)}
            <option value={axis}>{axis}</option>
          {/each}
        </select>
      </label>
      <label class="field">
        <span class="field__label">Scale X</span>
        <input
          type="number"
          step="0.0001"
          min="0"
          placeholder="from paper"
          value={$simSettings.mapping.scaleX ?? ''}
          onchange={(event) => {
            const raw = event.currentTarget.value.trim();
            patchMapping({ scaleX: raw === '' ? null : Number(raw) });
          }}
        />
      </label>
      <label class="field">
        <span class="field__label">Scale Y</span>
        <input
          type="number"
          step="0.0001"
          min="0"
          placeholder="from paper"
          value={$simSettings.mapping.scaleY ?? ''}
          onchange={(event) => {
            const raw = event.currentTarget.value.trim();
            patchMapping({ scaleY: raw === '' ? null : Number(raw) });
          }}
        />
      </label>
    </div>
    {#if $kinematicPose}
      <p class="help-text">
        Canvas {$kinematicPose.canvas.width}×{$kinematicPose.canvas.height}
        {#if $kinematicPose.canvasAssumed}(assumed until a sketch reports its size){/if}.
        Left target world {vec($kinematicPose.legs.FL.targetWorld)}.
        Right target world {vec($kinematicPose.legs.FR.targetWorld)}.
        Body origin {vec($kinematicPose.bodyPosition)}.
      </p>
    {/if}
  </section>
</div>

<style>
  .model {
    display: flex;
    flex-direction: column;
    gap: var(--space-3);
  }

  .model__head {
    display: flex;
    justify-content: space-between;
    align-items: center;
    gap: var(--space-2);
  }

  .model__leg {
    margin-top: var(--space-3);
  }

  .model__joints,
  .model__split {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--space-3);
  }

  .model__read {
    font-size: 12px;
  }

  .model__facts {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(180px, 1fr));
    gap: var(--space-2);
    margin: var(--space-2) 0 0;
  }

  .model__facts div {
    margin: 0;
  }

  .model__facts dt {
    font-family: var(--font-mono);
    font-size: 10px;
    letter-spacing: 0.12em;
    text-transform: uppercase;
    color: var(--color-text-muted);
  }

  .model__facts dd {
    margin: 0;
    font-size: 12px;
  }

  .check {
    display: flex;
    align-items: center;
    gap: var(--space-1);
    margin: var(--space-1) 0;
    font-size: 13px;
  }
</style>
