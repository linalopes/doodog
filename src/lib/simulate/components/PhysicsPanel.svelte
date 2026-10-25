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
  import { CONTROLLER_NOTE, DEFAULT_EXPERIMENT } from '../physics/settings';
  import { FLOOR_NOTE, TORQUE_NOTE } from '../physics/scene';
  import { PHYSICS_LABEL, type PhysicsSnapshot } from '../physics/types';
  import type { PhysicsMode } from '../physics/experiment';

  const LEGS = ['FL', 'FR', 'RL', 'RR'] as const;
  const MODES: { id: PhysicsMode; label: string }[] = [
    { id: 'motors-off', label: 'Motors Off' },
    { id: 'posture-hold', label: 'Posture Hold' },
    { id: 'three-leg', label: 'Three-Leg Stance' },
  ];
  const STAGE: Record<string, string> = {
    idle: 'Idle',
    posture: 'Posture hold',
    stand: 'Stand',
    shift: 'Shift',
    lift: 'Lift',
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

  const degrees = (radians: number) => `${((radians * 180) / Math.PI).toFixed(1)}°`;

  function jointLine(sample: PhysicsSnapshot, leg: (typeof LEGS)[number]): string {
    return sample.joints[leg].map((angle) => degrees(angle)).join('  ');
  }

  function metres(value: number | null): string {
    if (value === null || !Number.isFinite(value)) return '—';
    return `${(value * 1000).toFixed(0)} mm`;
  }

  function onLift(event: Event): void {
    const mm = Number((event.currentTarget as HTMLInputElement).value);
    void configureExperiment({ ...run.config, liftHeightM: mm / 1000 });
  }

  function onSeconds(key: 'shiftSeconds' | 'liftSeconds' | 'holdSeconds' | 'returnSeconds', event: Event): void {
    const seconds = Number((event.currentTarget as HTMLInputElement).value);
    void configureExperiment({ ...run.config, [key]: seconds });
  }

  function flag(value: boolean | null): string {
    if (value === true) return 'met';
    if (value === false) return 'not met';
    return 'not reached';
  }
</script>

<section class="physics" aria-label="MuJoCo physics experiment">
  <header class="physics__head">
    <h2>Physics experiment</h2>
    <p class="physics__label">{PHYSICS_LABEL}</p>
  </header>
  <p class="muted">
    Motors Off drops the Go2 under gravity. Posture Hold and Three-Leg Stance send torque commands in
    simulation only. Brush trajectories are not tracked. Nothing is sent to a physical robot.
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
      <button type="button" class="btn btn--small" disabled={!ready || playing} onclick={() => void startExperiment()}>Start</button>
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
  {#if run.mode === 'three-leg'}
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
    </div>
    <p class="help-text">Durations are seconds of physics experiment time. Lift height is millimetres of foot clearance.</p>
  {/if}
  <p class="help-text">{controlled ? CLOCK_NOTE : 'Play and pause on the shared timeline. Physics integrates toward that time in fixed steps. Seeking backward inside this run resets the model and replays it. Seeking before the run is refused.'}</p>
  {#if run.mode === 'three-leg'}
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
    {#if run.mode === 'three-leg' && experiment}
      <ul class="physics__joints">
        <li><span>Stand</span> {flag(experiment.criteria.stand)}</li>
        <li><span>Shift</span> {flag(experiment.criteria.shift)}</li>
        <li><span>Lift</span> {flag(experiment.criteria.lift)}</li>
        <li><span>Hold</span> {flag(experiment.criteria.hold)}</li>
        <li><span>Return</span> {flag(experiment.criteria.return)}</li>
      </ul>
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
