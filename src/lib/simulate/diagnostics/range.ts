/**
 * Which instants an analysis will ask the sandbox for.
 *
 * A declared `scorePeriod()` is one complete period, from 0 to that duration.
 * A missing period is continuous playback. The analysis window is then a
 * choice on this panel. It is not stored as a score length and it is not
 * presented as the whole piece.
 *
 * The sample interval is independent of the playback frame rate. The range
 * endpoint is always a sample, so the last step can be shorter than the
 * others. If the requested interval would exceed the sample cap, the interval
 * is widened and the result says so.
 */

export const DEFAULT_ANALYSIS_INTERVAL_S = 0.05;
export const MAX_ANALYSIS_SAMPLES = 400;
export const DEFAULT_ANALYSIS_WINDOW_S = 8;

export const ANALYSIS_INTERVAL_CHOICES = [0.02, 0.05, 0.1, 0.2] as const;
export const ANALYSIS_WINDOW_CHOICES = [4, 8, 16, 32] as const;

export interface AnalysisRange {
  kind: 'period' | 'window';
  start: number;
  end: number;
  requestedInterval: number;
  interval: number;
  times: number[];
  widened: boolean;
  note: string;
}

export interface RangeRequest {
  /** Positive declared period, or null when the sketch did not declare one. */
  durationSeconds: number | null;
  interval: number;
  windowStart: number;
  windowLength: number;
}

function clampInterval(interval: number): number {
  if (!Number.isFinite(interval)) return DEFAULT_ANALYSIS_INTERVAL_S;
  return Math.min(0.5, Math.max(0.01, interval));
}

function clampWindow(start: number, length: number): { start: number; length: number } {
  const safeStart = Number.isFinite(start) ? Math.min(600, Math.max(0, start)) : 0;
  const safeLength = Number.isFinite(length) ? Math.min(60, Math.max(1, length)) : DEFAULT_ANALYSIS_WINDOW_S;
  return { start: safeStart, length: safeLength };
}

export function sampleTimes(
  start: number,
  end: number,
  requestedInterval: number,
  maxSamples = MAX_ANALYSIS_SAMPLES,
): { times: number[]; interval: number; widened: boolean } {
  const span = end - start;
  if (!(span > 0) || maxSamples < 2) return { times: [], interval: requestedInterval, widened: false };
  let interval = clampInterval(requestedInterval);
  let count = Math.floor(span / interval) + 1;
  let widened = false;
  if (count > maxSamples) {
    interval = span / (maxSamples - 1);
    count = maxSamples;
    widened = true;
  }
  if (count < 2) {
    return { times: [start, end], interval: span, widened };
  }
  const times: number[] = [];
  for (let index = 0; index < count; index += 1) {
    times.push(index === count - 1 ? end : start + index * interval);
  }
  return { times, interval, widened };
}

/** Null when the requested range has no positive length. */
export function planAnalysis(request: RangeRequest): AnalysisRange | null {
  const interval = clampInterval(request.interval);
  const finite = request.durationSeconds !== null && request.durationSeconds > 0;
  if (finite) {
    const duration = request.durationSeconds as number;
    const sampled = sampleTimes(0, duration, interval);
    if (sampled.times.length < 2) return null;
    return {
      kind: 'period',
      start: 0,
      end: duration,
      requestedInterval: interval,
      interval: sampled.interval,
      times: sampled.times,
      widened: sampled.widened,
      note: 'One declared period. This is the score length from scorePeriod().',
    };
  }

  const window = clampWindow(request.windowStart, request.windowLength);
  const sampled = sampleTimes(window.start, window.start + window.length, interval);
  if (sampled.times.length < 2) return null;
  return {
    kind: 'window',
    start: window.start,
    end: window.start + window.length,
    requestedInterval: interval,
    interval: sampled.interval,
    times: sampled.times,
    widened: sampled.widened,
    note: 'Continuous score. This window is not a score length. The sketch did not declare scorePeriod().',
  };
}
