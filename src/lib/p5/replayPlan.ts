/**
 * How to redraw an accumulated p5 trace up to a host time.
 *
 * Sketch `draw()` is not treated as pure: previews keep a trail and a previous
 * pose outside `setup()`. Moving backward, looping, or drawing for the first
 * time re-executes the sketch, then steps forward. A small forward gap is one
 * redraw, because the examples' `paintSpan` fills gaps up to 0.75s and does not
 * join a lift across a larger gap. Wider jumps are stepped at
 * `REPLAY_STEP_SECONDS` so those gaps stay inside that limit.
 *
 * The sandboxed runtime mirrors this function. Keep the two in step.
 */

export const REPLAY_STEP_SECONDS = 0.5;
export const MAX_REPLAY_SPAN_SECONDS = 120;

const BEHIND_EPSILON = 0.001;
const STEP_FACTOR = 1.25;

export interface ReplayPlan {
  /** Re-execute the sketch before drawing so accumulated paint starts clean. */
  rebuild: boolean;
  /** Host times, in seconds, to redraw in order. */
  times: number[];
}

function round6(value: number): number {
  return Math.round(value * 1e6) / 1e6;
}

export function replayPlan(paintedUntil: number | null, requested: number): ReplayPlan {
  if (!Number.isFinite(requested) || requested < 0) {
    return { rebuild: false, times: [] };
  }

  const painted =
    paintedUntil !== null && Number.isFinite(paintedUntil) ? paintedUntil : null;
  const behind = painted === null || requested + BEHIND_EPSILON < painted;
  let rebuild = behind;
  let cursor = behind || painted === null ? 0 : painted;

  if (requested - cursor > MAX_REPLAY_SPAN_SECONDS) {
    rebuild = true;
    cursor = requested - MAX_REPLAY_SPAN_SECONDS;
  }

  const times: number[] = [];
  if (rebuild) times.push(round6(cursor));

  let t = cursor;
  const gate = REPLAY_STEP_SECONDS * STEP_FACTOR;
  while (t + gate < requested) {
    t += REPLAY_STEP_SECONDS;
    times.push(round6(t));
  }

  const last = times.length > 0 ? times[times.length - 1] : undefined;
  if (last === undefined || Math.abs(last - requested) > 1e-4) {
    times.push(round6(requested));
  }

  return { rebuild, times };
}
