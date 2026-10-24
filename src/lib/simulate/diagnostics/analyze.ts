/**
 * Turn sandbox MotionFrames into joint diagnostics with the existing solver.
 *
 * `solvePose` is the only inverse kinematics used here. Nothing in this module
 * redraws the sketch, moves the Three.js scene, or changes the score.
 * A lifted brush is still solved. An inactive brush keeps the reference pose
 * and is left out of the event list by `collectEvents`.
 */

import type { MotionFrame, SketchMotionErrorCode } from '../../motion/types.ts';
import type { SimConfig } from '../go2/defaults.ts';
import { solvePose, type PoseSnapshot } from '../go2/pose.ts';
import { differentiateSeries } from './differentiate.ts';
import {
  collectEvents,
  type DiagnosticEvent,
  type DiagnosticSide,
  type DiagnosticThresholds,
  type JointIndex,
} from './events.ts';

export interface RawMotionSample {
  time: number;
  frame: MotionFrame | null;
  errorCode: SketchMotionErrorCode | null;
  errorMessage: string | null;
}

export interface BrushDiagnostic {
  active: boolean;
  contact: boolean;
  joints: [number, number, number] | null;
  velocity: [number | null, number | null, number | null];
  acceleration: [number | null, number | null, number | null];
  positionErrorM: number | null;
  reachable: boolean | null;
  onLimit: boolean;
}

export interface DiagnosticSample {
  time: number;
  valid: boolean;
  errorCode: SketchMotionErrorCode | null;
  left: BrushDiagnostic;
  right: BrushDiagnostic;
}

const EMPTY_TRIPLE: [number | null, number | null, number | null] = [null, null, null];

function emptyBrush(contact: boolean): BrushDiagnostic {
  return {
    active: false,
    contact,
    joints: null,
    velocity: [...EMPTY_TRIPLE],
    acceleration: [...EMPTY_TRIPLE],
    positionErrorM: null,
    reachable: null,
    onLimit: false,
  };
}

function copyJoints(joints: readonly number[]): [number, number, number] | null {
  const a = joints[0];
  const b = joints[1];
  const c = joints[2];
  if (a === undefined || b === undefined || c === undefined) return null;
  if (!Number.isFinite(a) || !Number.isFinite(b) || !Number.isFinite(c)) return null;
  return [a, b, c];
}

export function brushFromPose(
  pose: PoseSnapshot,
  side: DiagnosticSide,
  contact: boolean,
): BrushDiagnostic {
  const leg = side === 'left' ? pose.legs.FL : pose.legs.FR;
  const joints = copyJoints(leg.joints);
  return {
    active: leg.active,
    contact,
    joints,
    velocity: [...EMPTY_TRIPLE],
    acceleration: [...EMPTY_TRIPLE],
    positionErrorM: leg.active ? leg.positionErrorM : null,
    reachable: leg.active ? leg.reachable : null,
    onLimit: leg.active && leg.onLimit,
  };
}

/** One solved sample. Joint derivatives are filled later, across the series. */
export function diagnoseFrame(
  raw: RawMotionSample,
  canvas: { width: number; height: number } | null,
  config: SimConfig,
): DiagnosticSample {
  if (!raw.frame || raw.errorCode) {
    return {
      time: raw.time,
      valid: false,
      errorCode: raw.errorCode,
      left: emptyBrush(false),
      right: emptyBrush(false),
    };
  }
  const pose = solvePose(raw.frame, canvas, config, null);
  return {
    time: raw.time,
    valid: true,
    errorCode: null,
    left: brushFromPose(pose, 'left', raw.frame.left.contact),
    right: brushFromPose(pose, 'right', raw.frame.right.contact),
  };
}

function writeDerivatives(
  samples: DiagnosticSample[],
  side: DiagnosticSide,
  joint: JointIndex,
): void {
  const indexes: number[] = [];
  const flush = () => {
    if (indexes.length === 0) return;
    const times: number[] = [];
    const values: number[] = [];
    for (const index of indexes) {
      const sample = samples[index];
      const angle = sample?.[side].joints?.[joint];
      if (!sample || angle === undefined) continue;
      times.push(sample.time);
      values.push(angle);
    }
    const derived = differentiateSeries(times, values);
    indexes.forEach((sampleIndex, cursor) => {
      const sample = samples[sampleIndex];
      if (!sample) return;
      sample[side].velocity[joint] = derived.velocity[cursor] ?? null;
      sample[side].acceleration[joint] = derived.acceleration[cursor] ?? null;
    });
    indexes.length = 0;
  };

  samples.forEach((sample, index) => {
    if (!sample.valid || !sample[side].joints) {
      flush();
      return;
    }
    indexes.push(index);
  });
  flush();
}

/** Fill velocity and acceleration in place. Invalid samples break a segment. */
export function attachDerivatives(samples: DiagnosticSample[]): DiagnosticSample[] {
  const sides: DiagnosticSide[] = ['left', 'right'];
  const joints: JointIndex[] = [0, 1, 2];
  for (const side of sides) {
    for (const joint of joints) writeDerivatives(samples, side, joint);
  }
  return samples;
}

export interface BuiltAnalysis {
  samples: DiagnosticSample[];
  events: DiagnosticEvent[];
}

export function buildAnalysis(
  raw: readonly RawMotionSample[],
  canvas: { width: number; height: number } | null,
  config: SimConfig,
  thresholds: DiagnosticThresholds,
  periodic: boolean,
): BuiltAnalysis {
  const samples = attachDerivatives(raw.map((sample) => diagnoseFrame(sample, canvas, config)));
  return {
    samples,
    events: collectEvents(samples, thresholds, periodic),
  };
}

/** Paper, mapping, and brush mounts. Helper visibility does not change the solve. */
export function analysisConfigKey(config: SimConfig): string {
  return JSON.stringify({
    paper: config.paper,
    mapping: config.mapping,
    brushes: config.brushes,
  });
}

export interface BatchIdentity {
  runId: string;
  serial: number;
  revision: number;
  times: readonly number[];
}

export interface BatchReply {
  runId: string;
  serial: number;
  revision: number;
  samples: readonly { time: number }[];
}

/**
 * A reply is usable only when it belongs to the run, the parameter revision,
 * the analysis serial, and the exact times that were requested.
 */
export function acceptMotionBatch(expected: BatchIdentity | null, message: BatchReply): boolean {
  if (!expected) return false;
  if (message.runId !== expected.runId) return false;
  if (message.serial !== expected.serial) return false;
  if (message.revision !== expected.revision) return false;
  if (message.samples.length !== expected.times.length) return false;
  for (let index = 0; index < expected.times.length; index += 1) {
    const sample = message.samples[index];
    const time = expected.times[index];
    if (!sample || time === undefined) return false;
    if (Math.abs(sample.time - time) > 1e-6) return false;
  }
  return true;
}
