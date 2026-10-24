<script lang="ts">
  import { FLOOR_NOTE, TORQUE_NOTE } from '../physics/scene';
  import {
    initializePhysics,
    physicsRun,
    resetPhysics,
    stepPhysicsOnce,
  } from '../physics/run';
  import { PHYSICS_LABEL, type PhysicsSnapshot } from '../physics/types';

  const LEGS = ['FL', 'FR', 'RL', 'RR'] as const;

  const run = $derived($physicsRun);
  const ready = $derived(run.status === 'ready');
  const snapshot = $derived(run.snapshot);

  const degrees = (radians: number) => `${((radians * 180) / Math.PI).toFixed(1)}°`;

  function jointLine(sample: PhysicsSnapshot, leg: (typeof LEGS)[number]): string {
    return sample.joints[leg].map((angle) => degrees(angle)).join('  ');
  }
</script>

<section class="physics" aria-label="MuJoCo physics experiment">
  <header class="physics__head">
    <h2>Physics experiment</h2>
    <p class="physics__label">{PHYSICS_LABEL}</p>
  </header>
  <p class="muted">
    The Go2 starts in the Menagerie home posture and then moves only under gravity and contact.
    Brush trajectories are not tracked. Nothing is sent to a physical robot.
  </p>
  <div class="physics__actions">
    <button type="button" class="btn btn--small" disabled={run.status === 'loading'} onclick={() => void initializePhysics()}>
      {run.status === 'loading' ? 'Loading…' : 'Initialize'}
    </button>
    <button type="button" class="btn btn--small" disabled={!ready} onclick={() => void resetPhysics()}>Reset</button>
    <button type="button" class="btn btn--small" disabled={!ready} onclick={stepPhysicsOnce}>Step</button>
  </div>
  <p class="help-text">
    Play and pause on the shared timeline. Physics integrates toward that time in fixed steps.
    Stepping pauses playback and moves the shared clock forward by one physics timestep.
    Seeking backward inside this run resets the model and replays it. Seeking before the run is refused.
  </p>
  {#if run.error}
    <p class="physics__error" role="alert">{run.error}</p>
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
        <dt>Physics time</dt>
        <dd>{snapshot.time.toFixed(3)} s</dd>
      </div>
      <div>
        <dt>Base position</dt>
        <dd>
          {snapshot.basePosition.map((value) => value.toFixed(3)).join(', ')} m
        </dd>
      </div>
      <div>
        <dt>Motor command</dt>
        <dd>{snapshot.maxAbsTorqueNm.toFixed(1)} Nm max</dd>
      </div>
      <div>
        <dt>Contacts</dt>
        <dd>{snapshot.contactCount}</dd>
      </div>
    </dl>
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
  <p class="help-text">{TORQUE_NOTE}</p>
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

  .physics__actions {
    display: flex;
    flex-wrap: wrap;
    gap: var(--space-2);
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
    width: 2rem;
    color: var(--brand-deep-purple);
  }
</style>
