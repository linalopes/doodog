<script lang="ts">
  interface Props {
    /** Changing the seed produces a different arrangement. */
    seed?: number;
    columns?: number;
    rows?: number;
  }

  let { seed = 7, columns = 16, rows = 8 }: Props = $props();

  /**
   * Generative brand decoration for reserved / empty states.
   *
   * Deterministic per seed so the layout does not flicker on re-render, always
   * aria-hidden and pointer-events: none so it never interferes with controls.
   * Uses Gray Green and Turquoise only, per the kit's decorative guidance.
   */
  function makeRandom(initial: number) {
    let value = initial * 9301 + 49297;
    return () => {
      value = (value * 9301 + 49297) % 233280;
      return value / 233280;
    };
  }

  const CELL = 24;

  interface Mark {
    key: string;
    x: number;
    y: number;
    kind: 'arc' | 'line' | 'dot';
    rotation: number;
    accent: boolean;
  }

  const marks = $derived.by((): Mark[] => {
    const random = makeRandom(seed);
    const result: Mark[] = [];
    for (let row = 0; row < rows; row += 1) {
      for (let column = 0; column < columns; column += 1) {
        if (random() > 0.42) continue;
        const roll = random();
        result.push({
          key: `${row}-${column}`,
          x: column * CELL,
          y: row * CELL,
          kind: roll < 0.5 ? 'arc' : roll < 0.82 ? 'line' : 'dot',
          rotation: Math.floor(random() * 4) * 90,
          accent: random() > 0.78,
        });
      }
    }
    return result;
  });

  const width = $derived(columns * CELL);
  const height = $derived(rows * CELL);
</script>

<svg
  class="pattern"
  viewBox="0 0 {width} {height}"
  preserveAspectRatio="xMidYMid slice"
  aria-hidden="true"
  focusable="false"
>
  {#each marks as mark (mark.key)}
    <g
      transform="translate({mark.x} {mark.y}) rotate({mark.rotation} {CELL / 2} {CELL / 2})"
      class:accent={mark.accent}
    >
      {#if mark.kind === 'arc'}
        <path d="M 0 {CELL} A {CELL} {CELL} 0 0 1 {CELL} 0" fill="none" />
      {:else if mark.kind === 'line'}
        <line x1="0" y1={CELL / 2} x2={CELL} y2={CELL / 2} />
      {:else}
        <circle cx={CELL / 2} cy={CELL / 2} r="2" />
      {/if}
    </g>
  {/each}
</svg>

<style>
  .pattern {
    position: absolute;
    inset: 0;
    width: 100%;
    height: 100%;
    pointer-events: none;
    opacity: 0.5;
  }

  g {
    stroke: var(--brand-gray-green);
    stroke-width: 1.5;
    fill: none;
  }

  g.accent {
    stroke: var(--brand-turquoise);
  }

  circle {
    fill: var(--brand-gray-green);
    stroke: none;
  }

  g.accent circle {
    fill: var(--brand-turquoise);
  }
</style>
