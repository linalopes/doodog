/**
 * One MotionFrame, interpreted with the body held on the Go2 home keyframe.
 *
 * Kinematics run in the base frame (body origin at zero). World positions are
 * that frame plus the home keyframe translation. Rear legs stay at the
 * reference angles. A front leg is solved only while its brush is active.
 * Nothing here reads sketch source or advances time.
 */

import type { MotionFrame } from '../../motion/types.ts';
import type { Go2JointState } from '../adapters/types.ts';
import { ASSUMED_CANVAS, type SimConfig } from './defaults.ts';
import { forwardLeg, referenceAngles, solveLeg, type LegPose, type LegSolution } from './kinematics.ts';
import { BODY_POSITION, type LegId } from './model.ts';
import { mapBrushTarget, type MappedBrush } from './mapping.ts';
import { add, type Angles, type Vec3 } from './math.ts';

export const SURFACE_PROXIMITY_M = 0.008;
export const PREVIEW_LABEL = 'Kinematic Preview — Not Physically Validated';

export interface LegReport {
  id: LegId;
  joints: Angles;
  footWorld: Vec3;
  sphereWorld: Vec3;
  tipWorld: Vec3;
  targetWorld: Vec3 | null;
  targetBody: Vec3 | null;
  surfaceWorld: Vec3 | null;
  positionErrorM: number | null;
  reachable: boolean | null;
  onLimit: boolean;
  active: boolean;
  drawing: boolean;
  nearSurface: boolean;
  note: string;
}

export interface PoseSnapshot {
  time: number | null;
  label: typeof PREVIEW_LABEL;
  canvasAssumed: boolean;
  canvas: { width: number; height: number };
  joints: Go2JointState;
  legs: Record<LegId, LegReport>;
  bodyPosition: Vec3;
  paperOrigin: Vec3;
  paperSize: { widthM: number; heightM: number };
  paperYawRad: number;
  manual: boolean;
}

export interface TrailMark {
  time: number;
  side: 'left' | 'right';
  desired: Vec3;
  achieved: Vec3;
  paint: boolean;
  contactRequested: boolean;
  /** Geometric reach of this sample. Null when the leg was not solved. */
  reachable: boolean | null;
  /** True when the solved pose sits on a joint limit. */
  onLimit: boolean;
}

const REAR_NOTE = 'Reference pose. The body stays fixed, so this leg is not solved.';
const INACTIVE_NOTE = 'Brush inactive. This leg holds the reference pose and does not draw.';
const MANUAL_NOTE =
  'Manual inspection pose. It is not following the timeline and it is not sent to hardware.';
const REACHED_NOTE = 'Reachable in the fixed home pose.';
const MISSED_NOTE =
  'Unreachable with the body fixed on the home keyframe. The pose is the closest one inside the joint limits. The drawing was not rescaled.';

function jointTriple(q: Angles): [number, number, number] {
  return [q[0], q[1], q[2]];
}

function worldOf(point: Vec3): Vec3 {
  return add(point, BODY_POSITION);
}

function toWorld(pose: LegPose, error: number, reachable: boolean, onLimit: boolean): LegSolution {
  return {
    ...pose,
    foot: worldOf(pose.foot),
    footWorld: worldOf(pose.foot),
    sphere: worldOf(pose.sphere),
    sphereWorld: worldOf(pose.sphere),
    tip: worldOf(pose.tip),
    tipWorld: worldOf(pose.tip),
    positionErrorM: error,
    reachable,
    onLimit,
  };
}

function report(
  id: LegId,
  solution: LegSolution,
  mapped: MappedBrush | null,
  active: boolean,
  note: string,
  reachable: boolean | null,
): LegReport {
  const near =
    mapped !== null &&
    reachable === true &&
    Math.abs(solution.tipWorld[2] - mapped.surface[2]) <= SURFACE_PROXIMITY_M;
  return {
    id,
    joints: solution.joints,
    footWorld: solution.footWorld,
    sphereWorld: solution.sphereWorld,
    tipWorld: solution.tipWorld,
    targetWorld: mapped?.world ?? null,
    targetBody: mapped?.body ?? null,
    surfaceWorld: mapped?.surface ?? null,
    positionErrorM: mapped ? solution.positionErrorM : null,
    reachable,
    onLimit: solution.onLimit,
    active,
    drawing: mapped?.drawing ?? false,
    nearSurface: near,
    note,
  };
}

function held(id: LegId, offset: Vec3, mapped: MappedBrush | null, note: string): LegReport {
  const pose = forwardLeg(id, referenceAngles(), offset);
  const error = mapped ? Math.hypot(
    worldOf(pose.tip)[0] - mapped.world[0],
    worldOf(pose.tip)[1] - mapped.world[1],
    worldOf(pose.tip)[2] - mapped.world[2],
  ) : 0;
  return report(id, toWorld(pose, error, false, false), mapped, false, note, null);
}

function frontLeg(
  id: 'FL' | 'FR',
  side: 'left' | 'right',
  frame: MotionFrame | null,
  canvas: { width: number; height: number },
  config: SimConfig,
  manualJoints: Go2JointState | null,
): LegReport {
  const mount = side === 'left' ? config.brushes.left : config.brushes.right;
  const target = frame ? (side === 'left' ? frame.left : frame.right) : null;
  const mapped = target
    ? mapBrushTarget(target, canvas, config.paper, config.mapping, mount.active, BODY_POSITION)
    : null;

  if (manualJoints) {
    const pose = forwardLeg(id, manualJoints[id], mount.offset);
    const error = mapped
      ? Math.hypot(
          worldOf(pose.tip)[0] - mapped.world[0],
          worldOf(pose.tip)[1] - mapped.world[1],
          worldOf(pose.tip)[2] - mapped.world[2],
        )
      : 0;
    return report(id, toWorld(pose, error, false, false), mapped, mount.active, MANUAL_NOTE, null);
  }

  if (!mount.active || !mapped) return held(id, mount.offset, mapped, INACTIVE_NOTE);

  const solution = solveLeg(id, mapped.body, mount.offset);
  const world = toWorld(solution, solution.positionErrorM, solution.reachable, solution.onLimit);
  return report(id, world, mapped, true, solution.reachable ? REACHED_NOTE : MISSED_NOTE, solution.reachable);
}

export function solvePose(
  frame: MotionFrame | null,
  canvas: { width: number; height: number } | null,
  config: SimConfig,
  manualJoints: Go2JointState | null,
): PoseSnapshot {
  const size = canvas && canvas.width > 0 && canvas.height > 0 ? canvas : ASSUMED_CANVAS;
  const fl = frontLeg('FL', 'left', frame, size, config, manualJoints);
  const fr = frontLeg('FR', 'right', frame, size, config, manualJoints);
  const rl = held('RL', [0, 0, 0], null, REAR_NOTE);
  const rr = held('RR', [0, 0, 0], null, REAR_NOTE);

  return {
    time: frame?.time ?? null,
    label: PREVIEW_LABEL,
    canvasAssumed: !(canvas && canvas.width > 0 && canvas.height > 0),
    canvas: size,
    joints: {
      FL: jointTriple(fl.joints),
      FR: jointTriple(fr.joints),
      RL: jointTriple(rl.joints),
      RR: jointTriple(rr.joints),
    },
    legs: { FL: fl, FR: fr, RL: rl, RR: rr },
    bodyPosition: BODY_POSITION,
    paperOrigin: config.paper.origin,
    paperSize: { widthM: config.paper.widthM, heightM: config.paper.heightM },
    paperYawRad: config.paper.yawRad,
    manual: manualJoints !== null,
  };
}

export function marksForSnapshot(snapshot: PoseSnapshot, side: 'left' | 'right'): TrailMark | null {
  if (snapshot.time === null || snapshot.manual) return null;
  const leg = side === 'left' ? snapshot.legs.FL : snapshot.legs.FR;
  if (!leg.surfaceWorld || !leg.active) return null;
  return {
    time: snapshot.time,
    side,
    desired: leg.surfaceWorld,
    achieved: leg.tipWorld,
    paint: leg.drawing && leg.reachable === true && leg.nearSurface,
    contactRequested: leg.drawing,
    reachable: leg.reachable,
    onLimit: leg.onLimit,
  };
}

export function interpretFrame(
  frame: MotionFrame,
  canvas: { width: number; height: number } | null,
  config: SimConfig,
): { snapshot: PoseSnapshot; marks: TrailMark[] } {
  const snapshot = solvePose(frame, canvas, config, null);
  const marks = [marksForSnapshot(snapshot, 'left'), marksForSnapshot(snapshot, 'right')].filter(
    (mark): mark is TrailMark => mark !== null,
  );
  return { snapshot, marks };
}
