/**
 * Display and analysis choices for motion diagnostics.
 * Sampling choices and thresholds are separate stores so a threshold edit
 * does not ask the sandbox for another pass.
 * These are not robot settings and they are not written into the sketch.
 */

import { writable } from 'svelte/store';
import { DEFAULT_THRESHOLDS, type DiagnosticThresholds } from './events.ts';
import { DEFAULT_ANALYSIS_INTERVAL_S, DEFAULT_ANALYSIS_WINDOW_S } from './range.ts';

export interface SamplingSettings {
  interval: number;
  windowStart: number;
  windowLength: number;
}

const SAMPLING: SamplingSettings = {
  interval: DEFAULT_ANALYSIS_INTERVAL_S,
  windowStart: 0,
  windowLength: DEFAULT_ANALYSIS_WINDOW_S,
};

const samplingStore = writable<SamplingSettings>(SAMPLING);
const thresholdStore = writable<DiagnosticThresholds>({ ...DEFAULT_THRESHOLDS });

export const samplingSettings = { subscribe: samplingStore.subscribe };
export const thresholdSettings = { subscribe: thresholdStore.subscribe };

function clamp(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, value));
}

export function patchSamplingSettings(patch: Partial<SamplingSettings>): void {
  samplingStore.update((current) => ({
    interval:
      patch.interval === undefined ? current.interval : clamp(patch.interval, 0.01, 0.5, current.interval),
    windowStart:
      patch.windowStart === undefined ? current.windowStart : clamp(patch.windowStart, 0, 600, current.windowStart),
    windowLength:
      patch.windowLength === undefined
        ? current.windowLength
        : clamp(patch.windowLength, 1, 60, current.windowLength),
  }));
}

export function patchDiagnosticThresholds(patch: Partial<DiagnosticThresholds>): void {
  thresholdStore.update((current) => ({
    nearLimitRad:
      patch.nearLimitRad === undefined
        ? current.nearLimitRad
        : clamp(patch.nearLimitRad, (0.5 * Math.PI) / 180, (20 * Math.PI) / 180, current.nearLimitRad),
    positionJumpRad:
      patch.positionJumpRad === undefined
        ? current.positionJumpRad
        : clamp(patch.positionJumpRad, (1 * Math.PI) / 180, (90 * Math.PI) / 180, current.positionJumpRad),
    velocityRadPerSec:
      patch.velocityRadPerSec === undefined
        ? current.velocityRadPerSec
        : clamp(patch.velocityRadPerSec, (10 * Math.PI) / 180, (2000 * Math.PI) / 180, current.velocityRadPerSec),
    accelerationRadPerSec2:
      patch.accelerationRadPerSec2 === undefined
        ? current.accelerationRadPerSec2
        : clamp(
            patch.accelerationRadPerSec2,
            (50 * Math.PI) / 180,
            (20000 * Math.PI) / 180,
            current.accelerationRadPerSec2,
          ),
    trackingErrorM:
      patch.trackingErrorM === undefined
        ? current.trackingErrorM
        : clamp(patch.trackingErrorM, 0.001, 0.1, current.trackingErrorM),
  }));
}
