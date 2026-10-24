/**
 * Map a pointer on a diagnostic chart back to a time on the shared timeline.
 * The chart does not keep a clock. The panel calls `seek`, which commits
 * `applySeek`. `chartSeekState` is that same transition for tests.
 */
import { applySeek, type TimelineState } from '../../motion/timelineMath.ts';

export function chartSeekTime(
  pointerX: number,
  width: number,
  start: number,
  end: number,
): number | null {
  if (!(width > 0) || !(end > start) || !Number.isFinite(pointerX)) return null;
  const fraction = Math.min(1, Math.max(0, pointerX / width));
  return start + fraction * (end - start);
}

export function chartX(time: number, width: number, start: number, end: number): number | null {
  if (!(width > 0) || !(end > start) || !Number.isFinite(time)) return null;
  const fraction = (time - start) / (end - start);
  if (fraction < 0 || fraction > 1) return null;
  return fraction * width;
}

/** The timeline state a chart click would commit. */
export function chartSeekState(
  state: TimelineState,
  pointerX: number,
  width: number,
  start: number,
  end: number,
): TimelineState {
  const time = chartSeekTime(pointerX, width, start, end);
  if (time === null) return state;
  return applySeek(state, time);
}

/** Index of the sample closest to `time`. Null when there are no samples. */
export function nearestSampleIndex(times: readonly number[], time: number): number | null {
  if (times.length === 0 || !Number.isFinite(time)) return null;
  let best = 0;
  let bestDistance = Infinity;
  for (let index = 0; index < times.length; index += 1) {
    const sampleTime = times[index];
    if (sampleTime === undefined) continue;
    const distance = Math.abs(sampleTime - time);
    if (distance < bestDistance) {
      best = index;
      bestDistance = distance;
    }
  }
  return best;
}
