/**
 * Virtual brush on the front-left foot.
 *
 * Frames, all in metres and radians, Menagerie convention (+X forward, +Y left, +Z up):
 *
 * - Foot frame. Origin at the visual foot, which is the calf origin plus
 *   `footInCalf` (0, 0, −0.213). Orientation is the calf body orientation.
 *   This is not the collision sphere.
 * - Attachment frame. The mount offset is expressed in the foot frame, then
 *   roll, pitch, and yaw rotate the brush. Roll is about foot +X, then pitch
 *   about foot +Y, then yaw about foot +Z.
 * - Tip. It sits `lengthM` along the brush −Z axis from the attachment.
 *
 * The default mount is 35 mm forward and the default shaft is 45 mm. Together
 * they land on the kinematic preview's brush offset (0.035, 0, −0.045) in the
 * foot frame. That is an experimental geometry, not a measured hardware mount.
 *
 * A signed distance to the paper plane is not a contact. This module does not
 * collide the brush with the sheet.
 */

import { DEFAULT_BRUSH_OFFSET } from './defaults.ts';
import { analyticalFoot, forwardLeg } from './kinematics.ts';
import { quatMul, quatRotate, sub, yawPoint, type Quat, type Vec3 } from './math.ts';
import { REFERENCE_ANGLES, type LegId } from './model.ts';
import type { PaperConfig } from './mapping.ts';

export interface BrushCalibration {
  /** Attachment point in the foot frame, metres. */
  mountOffset: Vec3;
  rollRad: number;
  pitchRad: number;
  yawRad: number;
  /** Distance from the attachment to the tip along brush −Z, metres. */
  lengthM: number;
}

export const DEFAULT_BRUSH_CALIBRATION: BrushCalibration = {
  mountOffset: [0.035, 0, 0],
  rollRad: 0,
  pitchRad: 0,
  yawRad: 0,
  lengthM: 0.045,
};

/** Within this band the tip is reported as on the nominal plane. It is still not a contact. */
export const PLANE_BAND_M = 0.0005;

export interface BrushWorld {
  attachment: Vec3;
  tip: Vec3;
  /** Brush frame orientation in the world. */
  rotation: Quat;
}

export interface TipPaper {
  /** Positive is on the same side as world +Z, above a horizontal sheet. */
  signedM: number;
  side: 'above' | 'on' | 'below';
  /** The projection of the tip lies inside the sheet rectangle. */
  inside: boolean;
  projection: Vec3;
}

export interface TipSolve {
  joints: readonly [number, number, number];
  foot: Vec3;
  tip: Vec3;
  errorM: number;
  reachable: boolean;
}

export function brushQuaternion(calibration: BrushCalibration): Quat {
  const roll = quatFromX(calibration.rollRad);
  const pitch = quatFromY(calibration.pitchRad);
  const yaw = quatFromZ(calibration.yawRad);
  return quatMul(quatMul(yaw, pitch), roll);
}

/** Tip position in the foot frame. This is the same point the mesh draws. */
export function brushTipInFoot(calibration: BrushCalibration): Vec3 {
  const rotated = quatRotate(brushQuaternion(calibration), [0, 0, -calibration.lengthM]);
  return [
    calibration.mountOffset[0] + rotated[0],
    calibration.mountOffset[1] + rotated[1],
    calibration.mountOffset[2] + rotated[2],
  ];
}

/**
 * World attachment and tip from the foot origin and the foot orientation.
 * The offset is rotated by the foot. It is not added in world axes.
 */
export function brushWorld(footPosition: Vec3, footOrientation: Quat, calibration: BrushCalibration): BrushWorld {
  const local = brushQuaternion(calibration);
  const rotation = quatMul(footOrientation, local);
  const attachment = addVec(footPosition, quatRotate(footOrientation, calibration.mountOffset));
  const tip = addVec(attachment, quatRotate(rotation, [0, 0, -calibration.lengthM]));
  return { attachment, tip, rotation };
}

export function tipToPaper(tip: Vec3, paper: PaperConfig): TipPaper {
  const signed = tip[2] - paper.origin[2];
  const projection: Vec3 = [tip[0], tip[1], paper.origin[2]];
  const local = yawPoint(-paper.yawRad, sub(projection, paper.origin));
  const inside =
    Math.abs(local[0]) <= paper.widthM / 2 + 1e-9 && Math.abs(local[1]) <= paper.heightM / 2 + 1e-9;
  const side = Math.abs(signed) <= PLANE_BAND_M ? 'on' : signed > 0 ? 'above' : 'below';
  return { signedM: signed, side, inside, projection };
}

/** Paper centre, `clearanceM` along +Z. The sheet itself is not moved. */
export function clearanceTarget(paper: PaperConfig, clearanceM: number): Vec3 {
  return [paper.origin[0], paper.origin[1], paper.origin[2] + clearanceM];
}

/**
 * Joint command whose forward tip lands on `targetTip`.
 * The foot orientation is taken from the candidate pose and updated a few
 * times, because the brush offset rotates with the leg.
 */
export function solveTipTarget(
  body: Vec3,
  orientation: Quat,
  targetTip: Vec3,
  calibration: BrushCalibration,
  seed: readonly [number, number, number] = REFERENCE_ANGLES,
): TipSolve {
  let joints: [number, number, number] = [seed[0], seed[1], seed[2]];
  let foot: Vec3 = [body[0], body[1], body[2]];
  let reachable = false;
  for (let pass = 0; pass < 5; pass += 1) {
    const pose = forwardLeg('FL', joints, [0, 0, 0]);
    const footQuat = quatMul(orientation, pose.footRotation);
    const localTip = brushTipInFoot(calibration);
    foot = sub(targetTip, quatRotate(footQuat, localTip));
    const solved = analyticalFoot('FL', worldPointToBody(body, orientation, foot));
    if (!solved) {
      reachable = false;
      break;
    }
    joints = [solved.joints[0], solved.joints[1], solved.joints[2]];
    reachable = solved.reachable;
  }
  const pose = forwardLeg('FL', joints, [0, 0, 0]);
  const worldFoot = addVec(body, quatRotate(orientation, pose.foot));
  const tip = brushWorld(worldFoot, quatMul(orientation, pose.footRotation), calibration).tip;
  const errorM = Math.hypot(tip[0] - targetTip[0], tip[1] - targetTip[1], tip[2] - targetTip[2]);
  return { joints, foot: worldFoot, tip, errorM, reachable: reachable && errorM <= 0.005 };
}

/** True when every foot position on the segment has an inverse-kinematics solution. */
export function pathReachable(
  body: Vec3,
  orientation: Quat,
  from: Vec3,
  to: Vec3,
  steps = 6,
): boolean {
  for (let index = 0; index <= steps; index += 1) {
    const u = index / steps;
    const foot: Vec3 = [
      from[0] + (to[0] - from[0]) * u,
      from[1] + (to[1] - from[1]) * u,
      from[2] + (to[2] - from[2]) * u,
    ];
    const solved = analyticalFoot('FL' as LegId, worldPointToBody(body, orientation, foot));
    if (!solved || !solved.reachable) return false;
  }
  return true;
}

/** The default calibration reproduces the kinematic brush offset in the foot frame. */
export function calibrationFrom(config: {
  brushMountXM: number;
  brushMountYM: number;
  brushMountZM: number;
  brushRollRad: number;
  brushPitchRad: number;
  brushYawRad: number;
  brushLengthM: number;
}): BrushCalibration {
  return {
    mountOffset: [config.brushMountXM, config.brushMountYM, config.brushMountZM],
    rollRad: config.brushRollRad,
    pitchRad: config.brushPitchRad,
    yawRad: config.brushYawRad,
    lengthM: config.brushLengthM,
  };
}

export function paperFrom(config: {
  paperOriginX: number;
  paperOriginY: number;
  paperOriginZ: number;
  paperYawRad: number;
  paperWidthM: number;
  paperHeightM: number;
}): PaperConfig {
  return {
    widthM: config.paperWidthM,
    heightM: config.paperHeightM,
    origin: [config.paperOriginX, config.paperOriginY, config.paperOriginZ],
    yawRad: config.paperYawRad,
    liftHeightM: 0.04,
  };
}

export function defaultTipMatchesPreview(): boolean {
  const tip = brushTipInFoot(DEFAULT_BRUSH_CALIBRATION);
  return (
    Math.abs(tip[0] - DEFAULT_BRUSH_OFFSET[0]) < 1e-9 &&
    Math.abs(tip[1] - DEFAULT_BRUSH_OFFSET[1]) < 1e-9 &&
    Math.abs(tip[2] - DEFAULT_BRUSH_OFFSET[2]) < 1e-9
  );
}

function worldPointToBody(body: Vec3, orientation: Quat, world: Vec3): Vec3 {
  return quatRotate([orientation[0], -orientation[1], -orientation[2], -orientation[3]], sub(world, body));
}

function quatFromX(angle: number): Quat {
  const half = angle * 0.5;
  return [Math.cos(half), Math.sin(half), 0, 0];
}

function quatFromY(angle: number): Quat {
  const half = angle * 0.5;
  return [Math.cos(half), 0, Math.sin(half), 0];
}

function quatFromZ(angle: number): Quat {
  const half = angle * 0.5;
  return [Math.cos(half), 0, 0, Math.sin(half)];
}

function addVec(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}
