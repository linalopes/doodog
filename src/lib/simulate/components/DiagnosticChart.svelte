<script lang="ts">
  /**
   * One SVG chart. A pointer or arrow key seeks the host timeline through `onSeek`.
   * This component does not sample motion and does not touch the robot.
   */
  import { chartSeekTime, chartX } from '../diagnostics/chart';

  interface Series {
    id: string;
    name: string;
    color: string;
    dash?: string;
    values: (number | null)[];
  }

  interface Guide {
    value: number;
    label: string;
  }

  interface Mark {
    time: number;
    color: string;
  }

  interface Band {
    start: number;
    end: number;
  }

  interface Props {
    label: string;
    unit: string;
    times: number[];
    start: number;
    end: number;
    cursor: number;
    series: Series[];
    lines?: Guide[];
    marks?: Mark[];
    bands?: Band[];
    onSeek: (time: number) => void;
  }

  let {
    label,
    unit,
    times,
    start,
    end,
    cursor,
    series,
    lines = [],
    marks = [],
    bands = [],
    onSeek,
  }: Props = $props();

  const WIDTH = 1000;
  const HEIGHT = 128;
  const PAD = 10;

  const domain = $derived.by(() => {
    let low = Infinity;
    let high = -Infinity;
    for (const entry of series) {
      for (const value of entry.values) {
        if (value === null || !Number.isFinite(value)) continue;
        low = Math.min(low, value);
        high = Math.max(high, value);
      }
    }
    if (!Number.isFinite(low) || !Number.isFinite(high)) return { low: -1, high: 1 };
    if (low === high) {
      low -= 1;
      high += 1;
    }
    const span = high - low;
    for (const line of lines) {
      if (!Number.isFinite(line.value)) continue;
      if (line.value < low - span || line.value > high + span) continue;
      low = Math.min(low, line.value);
      high = Math.max(high, line.value);
    }
    const pad = (high - low) * 0.08;
    return { low: low - pad, high: high + pad };
  });

  function yOf(value: number): number {
    const span = domain.high - domain.low;
    const fraction = span === 0 ? 0.5 : (value - domain.low) / span;
    return PAD + (1 - fraction) * (HEIGHT - PAD * 2);
  }

  function xOf(time: number): number | null {
    return chartX(time, WIDTH, start, end);
  }

  function pathFor(values: (number | null)[]): string {
    let path = '';
    let drawing = false;
    for (let index = 0; index < values.length; index += 1) {
      const value = values[index];
      const time = times[index];
      if (value === null || value === undefined || time === undefined || !Number.isFinite(value)) {
        drawing = false;
        continue;
      }
      const x = xOf(time);
      if (x === null) {
        drawing = false;
        continue;
      }
      path += `${drawing ? 'L' : 'M'}${x.toFixed(2)} ${yOf(value).toFixed(2)} `;
      drawing = true;
    }
    return path;
  }

  const cursorX = $derived(xOf(cursor));

  function seekFrom(event: PointerEvent) {
    const bounds = (event.currentTarget as SVGSVGElement).getBoundingClientRect();
    const time = chartSeekTime(event.clientX - bounds.left, bounds.width, start, end);
    if (time !== null) onSeek(time);
  }

  function onKey(event: KeyboardEvent) {
    if (event.key !== 'ArrowLeft' && event.key !== 'ArrowRight') return;
    event.preventDefault();
    const step = (end - start) / Math.max(1, times.length - 1);
    const next = cursor + (event.key === 'ArrowRight' ? step : -step);
    onSeek(Math.min(end, Math.max(start, next)));
  }
</script>

<figure class="chart">
  <figcaption>
    <span>{label}</span>
    <span class="chart__unit">{unit}</span>
    <span class="chart__legend">
      {#each series as entry (entry.id)}
        <i style:background={entry.color}></i>
        {entry.name}
      {/each}
    </span>
  </figcaption>
  <svg
    viewBox="0 0 {WIDTH} {HEIGHT}"
    role="slider"
    tabindex="0"
    aria-label={label}
    aria-valuemin={start}
    aria-valuemax={end}
    aria-valuenow={cursor}
    aria-valuetext="{cursor.toFixed(2)} seconds"
    onpointerdown={seekFrom}
    onpointermove={(event) => {
      if (event.buttons === 0) return;
      seekFrom(event);
    }}
    onkeydown={onKey}
  >
    {#each bands as band (`${band.start}-${band.end}`)}
      {@const x = xOf(band.start)}
      {@const endX = xOf(band.end)}
      {#if x !== null && endX !== null}
        <rect class="chart__band" x={x} y={PAD} width={Math.max(1, endX - x)} height={HEIGHT - PAD * 2} />
      {/if}
    {/each}
    {#each lines as line (`${line.label}-${line.value}`)}
      <line class="chart__guide" x1="0" x2={WIDTH} y1={yOf(line.value)} y2={yOf(line.value)} />
    {/each}
    {#each series as entry (entry.id)}
      <path
        d={pathFor(entry.values)}
        fill="none"
        stroke={entry.color}
        stroke-width="2"
        stroke-dasharray={entry.dash ?? 'none'}
        vector-effect="non-scaling-stroke"
      />
    {/each}
    {#each marks as mark (`${mark.time}-${mark.color}`)}
      {@const x = xOf(mark.time)}
      {#if x !== null}
        <circle cx={x} cy={HEIGHT / 2} r="3.5" fill={mark.color} />
      {/if}
    {/each}
    {#if cursorX !== null}
      <line class="chart__cursor" x1={cursorX} x2={cursorX} y1="0" y2={HEIGHT} />
    {/if}
  </svg>
</figure>

<style>
  .chart {
    margin: 0;
    display: flex;
    flex-direction: column;
    gap: 4px;
  }

  figcaption {
    display: flex;
    flex-wrap: wrap;
    align-items: center;
    gap: var(--space-2);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-text);
  }

  .chart__unit,
  .chart__legend {
    color: var(--color-text-muted);
  }

  .chart__legend {
    display: inline-flex;
    align-items: center;
    gap: 8px;
  }

  .chart__legend i {
    width: 12px;
    height: 3px;
    border-radius: 2px;
  }

  svg {
    width: 100%;
    height: 128px;
    background: #f3f6f6;
    border: var(--border);
    border-radius: var(--radius);
    cursor: crosshair;
    touch-action: none;
    overflow: hidden;
  }

  svg:focus-visible {
    outline: 2px solid var(--brand-pink);
    outline-offset: 2px;
  }

  .chart__guide {
    stroke: rgba(34, 17, 62, 0.28);
    stroke-dasharray: 4 4;
    stroke-width: 1;
    vector-effect: non-scaling-stroke;
  }

  .chart__band {
    fill: rgba(234, 125, 255, 0.18);
  }

  .chart__cursor {
    stroke: var(--brand-turquoise);
    stroke-width: 2;
    vector-effect: non-scaling-stroke;
  }
</style>
