/**
 * Diagnostic events are measurements or estimates under thresholds the artist
 * sets. They are not Unitree motor ratings and they are not a safety verdict.
 *
 * Velocity and acceleration events are derived: they come from the finite-
 * difference estimates. The others are measured on the solved sample: joint
 * gap, angle change between samples, tip error, and the solver's reachable flag.
 */

import { REACH_TOLERANCE_M } from '../go2/kinematics.ts';
import { LEGS } from '../go2/model.ts';

export const JOINT_LABELS = ['Abduction', 'Thigh', 'Knee'] as const;
export type JointIndex = 0 | 1 | 2;
export type DiagnosticSide = 'left' | 'right';

export const THRESHOLD_DISCLAIMER =
  'User-configured analysis thresholds. These are not Unitree motor ratings, and they do not establish that a motion is physically safe.';

export interface DiagnosticThresholds {
  /** Radians inside a joint limit. */
  nearLimitRad: number;
  /** Radians of joint travel between adjacent samples. */
  positionJumpRad: number;
  /** Radians per second. An analysis threshold, not a hardware rating. */
  velocityRadPerSec: number;
  /** Radians per second squared. An analysis threshold, not a hardware rating. */
  accelerationRadPerSec2: number;
  /** Metres of brush-tip error. */
  trackingErrorM: number;
}

export const DEFAULT_THRESHOLDS: DiagnosticThresholds = {
  nearLimitRad: (2 * Math.PI) / 180,
  positionJumpRad: (12 * Math.PI) / 180,
  velocityRadPerSec: Math.PI,
  accelerationRadPerSec2: (1500 * Math.PI) / 180,
  trackingErrorM: 0.015,
};

export type DiagnosticEventType =
  | 'unreachable'
  | 'near-limit'
  | 'position-discontinuity'
  | 'velocity-threshold'
  | 'acceleration-threshold'
  | 'tracking-error';

export interface DiagnosticEvent {
  type: DiagnosticEventType;
  time: number;
  timeEnd: number;
  leg: 'FL' | 'FR';
  joint: JointIndex | null;
  brush: DiagnosticSide | null;
  measured: number;
  threshold: number;
  unit: 'rad' | 'rad/s' | 'rad/s2' | 'm' | 'flag';
  /** True for velocity and acceleration, which are finite-difference estimates. */
  derived: boolean;
  /** True when the comparison is the loop from the last sample back to the first. */
  boundary: boolean;
}

export function jointLimitGap(
  leg: 'FL' | 'FR',
  joint: JointIndex,
  angle: number,
): { gap: number; limit: number } {
  const spec = LEGS[leg];
  const bounds = joint === 0 ? spec.abduction : joint === 1 ? spec.hip : spec.knee;
  const toMin = angle - bounds.min;
  const toMax = bounds.max - angle;
  return toMin <= toMax ? { gap: toMin, limit: bounds.min } : { gap: toMax, limit: bounds.max };
}

export function legIdFor(side: DiagnosticSide): 'FL' | 'FR' {
  return side === 'left' ? 'FL' : 'FR';
}

export function eventTitle(type: DiagnosticEventType, boundary: boolean): string {
  if (boundary) return 'Loop boundary discontinuity';
  switch (type) {
    case 'unreachable':
      return 'Unreachable target';
    case 'near-limit':
      return 'Joint near limit';
    case 'position-discontinuity':
      return 'Joint position discontinuity';
    case 'velocity-threshold':
      return 'Angular velocity threshold';
    case 'acceleration-threshold':
      return 'Angular acceleration threshold';
    case 'tracking-error':
      return 'Brush-tip tracking error';
  }
}

const SIDES: DiagnosticSide[] = ['left', 'right'];
const JOINTS: JointIndex[] = [0, 1, 2];

export interface EventSample {
  time: number;
  valid: boolean;
  left: EventBrush;
  right: EventBrush;
}

export interface EventBrush {
  active: boolean;
  joints: [number, number, number] | null;
  velocity: [number | null, number | null, number | null];
  acceleration: [number | null, number | null, number | null];
  positionErrorM: number | null;
  reachable: boolean | null;
}

function brushOf(sample: EventSample, side: DiagnosticSide): EventBrush {
  return side === 'left' ? sample.left : sample.right;
}

function coalesce(events: DiagnosticEvent[], event: DiagnosticEvent, maxGap: number): void {
  const previous = events[events.length - 1];
  if (
    previous &&
    !previous.boundary &&
    !event.boundary &&
    previous.type === event.type &&
    previous.leg === event.leg &&
    previous.joint === event.joint &&
    previous.brush === event.brush &&
    event.time >= previous.timeEnd &&
    event.time - previous.timeEnd <= maxGap
  ) {
    previous.timeEnd = event.time;
    if (Math.abs(event.measured) > Math.abs(previous.measured)) previous.measured = event.measured;
    return;
  }
  events.push(event);
}

function maxStep(samples: readonly EventSample[]): number {
  let step = 0;
  for (let index = 1; index < samples.length; index += 1) {
    const previous = samples[index - 1];
    const current = samples[index];
    if (!previous || !current) continue;
    step = Math.max(step, current.time - previous.time);
  }
  return step * 1.01 + 1e-6;
}

/**
 * Inactive brushes are omitted. A lifted brush stays in the list: contact does
 * not drop the sample. A declared period also compares the last sample with the
 * first. That comparison is not part of the derivative series.
 */
export function collectEvents(
  samples: readonly EventSample[],
  thresholds: DiagnosticThresholds,
  periodic: boolean,
): DiagnosticEvent[] {
  const events: DiagnosticEvent[] = [];
  const gap = maxStep(samples);

  for (let index = 0; index < samples.length; index += 1) {
    const sample = samples[index];
    if (!sample?.valid) continue;
    for (const side of SIDES) {
      const brush = brushOf(sample, side);
      if (!brush.active || !brush.joints) continue;
      const leg = legIdFor(side);
      if (brush.reachable === false) {
        coalesce(events, {
          type: 'unreachable',
          time: sample.time,
          timeEnd: sample.time,
          leg,
          joint: null,
          brush: side,
          measured: brush.positionErrorM ?? Number.NaN,
          threshold: REACH_TOLERANCE_M,
          unit: 'm',
          derived: false,
          boundary: false,
        }, gap);
      } else if (
        brush.positionErrorM !== null &&
        brush.positionErrorM > thresholds.trackingErrorM
      ) {
        coalesce(events, {
          type: 'tracking-error',
          time: sample.time,
          timeEnd: sample.time,
          leg,
          joint: null,
          brush: side,
          measured: brush.positionErrorM,
          threshold: thresholds.trackingErrorM,
          unit: 'm',
          derived: false,
          boundary: false,
        }, gap);
      }

      for (const joint of JOINTS) {
        const angle = brush.joints[joint];
        if (angle === undefined) continue;
        const limit = jointLimitGap(leg, joint, angle);
        if (limit.gap <= thresholds.nearLimitRad) {
          coalesce(events, {
            type: 'near-limit',
            time: sample.time,
            timeEnd: sample.time,
            leg,
            joint,
            brush: side,
            measured: limit.gap,
            threshold: thresholds.nearLimitRad,
            unit: 'rad',
            derived: false,
            boundary: false,
          }, gap);
        }
        const velocity = brush.velocity[joint];
        if (velocity !== null && Math.abs(velocity) > thresholds.velocityRadPerSec) {
          coalesce(events, {
            type: 'velocity-threshold',
            time: sample.time,
            timeEnd: sample.time,
            leg,
            joint,
            brush: side,
            measured: velocity,
            threshold: thresholds.velocityRadPerSec,
            unit: 'rad/s',
            derived: true,
            boundary: false,
          }, gap);
        }
        const acceleration = brush.acceleration[joint];
        if (
          acceleration !== null &&
          Math.abs(acceleration) > thresholds.accelerationRadPerSec2
        ) {
          coalesce(events, {
            type: 'acceleration-threshold',
            time: sample.time,
            timeEnd: sample.time,
            leg,
            joint,
            brush: side,
            measured: acceleration,
            threshold: thresholds.accelerationRadPerSec2,
            unit: 'rad/s2',
            derived: true,
            boundary: false,
          }, gap);
        }
        if (index === 0) continue;
        const previous = samples[index - 1];
        const previousBrush = previous?.valid ? brushOf(previous, side) : null;
        const previousAngle = previousBrush?.active ? previousBrush.joints?.[joint] : undefined;
        if (previousAngle === undefined || !previous) continue;
        const jump = Math.abs(angle - previousAngle);
        if (jump > thresholds.positionJumpRad) {
          coalesce(events, {
            type: 'position-discontinuity',
            time: previous.time,
            timeEnd: sample.time,
            leg,
            joint,
            brush: side,
            measured: jump,
            threshold: thresholds.positionJumpRad,
            unit: 'rad',
            derived: false,
            boundary: false,
          }, gap);
        }
      }
    }
  }

  if (periodic && samples.length >= 2) {
    const first = samples[0];
    const last = samples[samples.length - 1];
    if (first?.valid && last?.valid) {
      for (const side of SIDES) {
        const startBrush = brushOf(first, side);
        const endBrush = brushOf(last, side);
        if (!startBrush.active || !endBrush.active || !startBrush.joints || !endBrush.joints) continue;
        for (const joint of JOINTS) {
          const startAngle = startBrush.joints[joint];
          const endAngle = endBrush.joints[joint];
          if (startAngle === undefined || endAngle === undefined) continue;
          const jump = Math.abs(endAngle - startAngle);
          if (jump <= thresholds.positionJumpRad) continue;
          events.push({
            type: 'position-discontinuity',
            time: last.time,
            timeEnd: first.time + (last.time - first.time),
            leg: legIdFor(side),
            joint,
            brush: side,
            measured: jump,
            threshold: thresholds.positionJumpRad,
            unit: 'rad',
            derived: false,
            boundary: true,
          });
        }
      }
    }
  }

  return events;
}
