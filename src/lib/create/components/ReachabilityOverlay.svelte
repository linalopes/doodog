<script lang="ts">
  /**
   * Host-side reachability tint over the sandboxed p5 preview.
   * The sketch iframe is not touched, and nothing here is sketch source.
   */
  import { motionOutput } from '../../motion/output';
  import { ASSUMED_CANVAS } from '../../simulate/go2/defaults';
  import {
    canvasDisplayRect,
    classifyCanvasPoint,
    fillReachabilityRows,
    gridShape,
    heightLabel,
    paintReachability,
    REACH_DISCLAIMER,
    REACH_ZONE_RGB,
    reachabilityKey,
    type PointReach,
    type ReachMap,
    type ReachZone,
  } from '../../simulate/go2/reachability';
  import {
    patchReachOverlay,
    REACH_COLUMN_CHOICES,
    reachOverlay,
  } from '../../simulate/go2/reachOverlay';
  import { simSettings } from '../../simulate/go2/settings';

  interface Props {
    frame: HTMLElement | null;
  }

  let { frame }: Props = $props();

  let mapCanvas = $state<HTMLCanvasElement | null>(null);
  let rect = $state({ x: 0, y: 0, width: 0, height: 0, scale: 0 });
  let map = $state<ReachMap | null>(null);
  let pending = $state(false);
  let probe = $state<PointReach | null>(null);

  const overlay = $derived($reachOverlay);
  const canvasSize = $derived(
    $motionOutput.canvas && $motionOutput.canvas.width > 0 && $motionOutput.canvas.height > 0
      ? $motionOutput.canvas
      : ASSUMED_CANVAS,
  );
  const canvasAssumed = $derived($motionOutput.canvas === null);
  const swatch = (zone: ReachZone) => {
    const [red, green, blue] = REACH_ZONE_RGB[zone];
    return `rgb(${red} ${green} ${blue})`;
  };

  function millimetres(error: number | null): string {
    if (error === null || !Number.isFinite(error)) return '—';
    return `${Math.round(error * 1000)} mm`;
  }

  $effect(() => {
    const node = frame;
    const size = canvasSize;
    if (!node) return;
    const measure = () => {
      rect = canvasDisplayRect(node.clientWidth, node.clientHeight, size.width, size.height);
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  });

  $effect(() => {
    const visible = overlay.visible;
    const height = overlay.height;
    const columns = overlay.columns;
    const config = $simSettings;
    const size = canvasSize;
    const query = { canvas: size, config, height };
    const key = reachabilityKey(query, columns);
    if (!visible) {
      pending = false;
      return;
    }
    if (map?.key === key) {
      pending = false;
      return;
    }

    let cancelled = false;
    const timer = window.setTimeout(() => {
      if (cancelled) return;
      pending = true;
      const shape = gridShape(size, columns);
      const cells: PointReach[] = new Array(shape.columns * shape.rows);
      let row = 0;
      const step = () => {
        if (cancelled) return;
        const end = Math.min(shape.rows, row + 2);
        fillReachabilityRows(cells, query, shape.columns, shape.rows, row, end);
        row = end;
        if (row < shape.rows) {
          window.setTimeout(step, 0);
          return;
        }
        map = {
          columns: shape.columns,
          rows: shape.rows,
          canvas: { width: size.width, height: size.height },
          height,
          heightM: cells[0]?.heightM ?? 0,
          key,
          cells,
        };
        pending = false;
      };
      step();
    }, 140);

    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  });

  $effect(() => {
    const canvas = mapCanvas;
    const current = map;
    const alpha = overlay.opacity;
    const shown = overlay.visible;
    if (!canvas || !current || !shown || rect.width < 2 || rect.height < 2) return;
    const ratio = window.devicePixelRatio || 1;
    const pixelWidth = Math.max(1, Math.floor(rect.width * ratio));
    const pixelHeight = Math.max(1, Math.floor(rect.height * ratio));
    if (canvas.width !== pixelWidth) canvas.width = pixelWidth;
    if (canvas.height !== pixelHeight) canvas.height = pixelHeight;
    const context = canvas.getContext('2d');
    if (!context) return;
    const image = context.createImageData(pixelWidth, pixelHeight);
    paintReachability(image.data, pixelWidth, pixelHeight, current.cells, current.columns, current.rows, alpha);
    context.putImageData(image, 0, 0);
  });

  function inspect(event: PointerEvent) {
    const canvas = mapCanvas;
    if (!canvas || !overlay.visible) return;
    const bounds = canvas.getBoundingClientRect();
    if (bounds.width < 2 || bounds.height < 2) return;
    const across = (event.clientX - bounds.left) / bounds.width;
    const down = (event.clientY - bounds.top) / bounds.height;
    if (across < 0 || down < 0 || across > 1 || down > 1) {
      probe = null;
      return;
    }
    probe = classifyCanvasPoint(across * canvasSize.width, down * canvasSize.height, {
      canvas: canvasSize,
      config: $simSettings,
      height: overlay.height,
    });
  }

  function brushLine(name: string, brush: PointReach['left']): string {
    if (!brush.active) return `${name} inactive`;
    return `${name} ${brush.reachable ? 'reachable' : 'unreachable'} · ${millimetres(brush.positionErrorM)}`;
  }
</script>

<div class="reach">
  <div class="reach__bar">
    <button
      type="button"
      class="btn btn--small"
      aria-pressed={overlay.visible}
      onclick={() => patchReachOverlay({ visible: !overlay.visible })}
    >
      Reach
    </button>
    <span class="reach__swatches" aria-hidden="true">
      <i title="Left only" style:background={swatch('left')}></i>
      <i title="Right only" style:background={swatch('right')}></i>
      <i title="Both brushes" style:background={swatch('both')}></i>
      <i title="Neither brush" style:background={swatch('neither')}></i>
    </span>
    <label class="reach__field">
      <span class="reach__label">Opacity</span>
      <input
        type="range"
        min="0.1"
        max="0.85"
        step="0.05"
        value={overlay.opacity}
        aria-label="Reachability opacity"
        title="Opacity"
        oninput={(event) => patchReachOverlay({ opacity: Number(event.currentTarget.value) })}
      />
    </label>
    <div class="reach__heights" role="group" aria-label="Tip height">
      <button
        type="button"
        class="btn btn--small"
        aria-pressed={overlay.height === 'down'}
        onclick={() => patchReachOverlay({ height: 'down' })}
      >
        Down
      </button>
      <button
        type="button"
        class="btn btn--small"
        aria-pressed={overlay.height === 'up'}
        onclick={() => patchReachOverlay({ height: 'up' })}
      >
        Up
      </button>
    </div>
    <label class="reach__field">
      <span class="reach__label">Grid</span>
      <select
        aria-label="Reachability grid density"
        title="Grid density"
        value={String(overlay.columns)}
        onchange={(event) => patchReachOverlay({ columns: Number(event.currentTarget.value) })}
      >
        {#each REACH_COLUMN_CHOICES as choice (choice)}
          <option value={String(choice)}>{choice}</option>
        {/each}
      </select>
    </label>
    {#if pending}
      <span class="reach__status">Updating</span>
    {/if}
  </div>

  {#if overlay.visible}
    <canvas
      bind:this={mapCanvas}
      class="reach__map"
      style:left="{rect.x}px"
      style:top="{rect.y}px"
      style:width="{rect.width}px"
      style:height="{rect.height}px"
      aria-label="Geometric reach of the front brushes"
      onpointermove={inspect}
      onpointerleave={() => (probe = null)}
    ></canvas>
    <p class="reach__probe mono" role="status">
      {#if probe}
        {overlay.height === 'down' ? 'Down' : 'Up'}
        · x {probe.canvasX.toFixed(0)}, y {probe.canvasY.toFixed(0)}
        · {brushLine('Left', probe.left)}
        · {brushLine('Right', probe.right)}
      {:else}
        {heightLabel($simSettings, overlay.height)}
        {#if canvasAssumed}
          · canvas 600×600 assumed
        {/if}
        · {REACH_DISCLAIMER}
      {/if}
    </p>
  {/if}
</div>

<style>
  .reach {
    position: absolute;
    inset: 0;
    pointer-events: none;
    z-index: 2;
  }

  .reach__bar,
  .reach__probe {
    pointer-events: auto;
  }

  .reach__bar {
    position: absolute;
    top: var(--space-2);
    left: var(--space-2);
    right: var(--space-2);
    z-index: 3;
    display: flex;
    flex-wrap: nowrap;
    align-items: center;
    gap: var(--space-2);
    padding: var(--space-1) var(--space-2);
    overflow-x: auto;
    background: color-mix(in srgb, var(--brand-white) 92%, transparent);
    border: var(--border);
    border-radius: var(--radius);
  }

  .reach__swatches {
    display: inline-flex;
    gap: 4px;
  }

  .reach__swatches i {
    width: 12px;
    height: 12px;
    border-radius: 2px;
    border: 1px solid var(--brand-deep-purple);
  }

  .reach__field {
    display: inline-flex;
    align-items: center;
    gap: var(--space-1);
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-text);
  }

  .reach__field input[type='range'] {
    width: 56px;
  }

  .reach__label {
    position: absolute;
    width: 1px;
    height: 1px;
    overflow: hidden;
    clip: rect(0 0 0 0);
  }

  .reach__heights {
    display: inline-flex;
    gap: 4px;
  }

  .reach__status {
    font-family: var(--font-mono);
    font-size: 11px;
    color: var(--color-text-muted);
  }

  .reach__map {
    position: absolute;
    z-index: 1;
    pointer-events: auto;
    cursor: crosshair;
  }

  .reach__probe {
    position: absolute;
    left: var(--space-2);
    right: var(--space-2);
    bottom: var(--space-2);
    z-index: 3;
    margin: 0;
    padding: 4px 8px;
    background: var(--brand-white);
    border: var(--border);
    border-radius: var(--radius);
    font-size: 11px;
    color: var(--color-text);
  }
</style>
