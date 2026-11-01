/**
 * Candidate A is an explicit mount and paper selection for MuJoCo.
 * The kinematic defaults stay in `DEFAULT_EXPERIMENT`. Selecting Candidate A
 * copies these values into the experiment config. It does not edit go2.xml.
 *
 * The elevated sheet is a static box. Its top is the paper plane. Its
 * thickness is 20 mm, so the underside is at 40 mm and does not share a face
 * with the ground plane at z = 0. The footprint matches the 200 mm sheet.
 * The home front-left support point lies inside that footprint, so Return is
 * not allowed to command the foot down through the box.
 *
 * The brush shaft and tip are not collision geoms.
 */

import { brushTipInFoot, brushWorld, calibrationFrom, type BrushCalibration } from '../go2/brush.ts';
import { quatRotate, type Vec3 } from '../go2/math.ts';
import { brushAngleToPaper } from '../go2/posture.ts';
import { FOOT_RADIUS_M, type ExperimentConfig } from './settings.ts';
import type { FootState, PhysicsSnapshot } from './types.ts';

export const CANDIDATE_A_NAME = 'Candidate A — Elevated Sheet / 45° Brush';
export const PLATFORM_NAME = 'paper_platform';
export const PLATFORM_THICKNESS_M = 0.02;
export const AERIAL_RADIUS_M = 0.005;
export const TIP_TRACK_MAX_M = 0.008;

const TORSO_HALF: Vec3 = [0.1881, 0.04675, 0.057];
const HEAD_LOCAL: Vec3 = [0.293, 0, -0.06];
const HEAD_RADIUS_M = 0.047;

export interface PlatformSpec {
  center: Vec3;
  half: Vec3;
  topZ: number;
  bottomZ: number;
  thicknessM: number;
}

export interface CandidateCheck {
  ok: boolean;
  reason: string;
  tip: Vec3 | null;
  angleDeg: number | null;
  footClearanceM: number | null;
  reachErrorM: number | null;
}

export const GROUND_SHEET_NAME = 'Ground Sheet / Low Clipboard';

export function isCandidate(config: ExperimentConfig): boolean {
  return config.mountProfile === 'candidate-a';
}

export function isGround(config: ExperimentConfig): boolean {
  return config.mountProfile === 'ground';
}

export function platformSpec(config: ExperimentConfig): PlatformSpec | null {
  if (!isCandidate(config)) return null;
  const thickness = config.platformThicknessM;
  const topZ = config.paperOriginZ;
  const bottomZ = topZ - thickness;
  if (!(thickness > 0) || !(bottomZ > 0.005) || !(config.paperWidthM > 0) || !(config.paperHeightM > 0)) return null;
  return {
    center: [config.paperOriginX, config.paperOriginY, topZ - thickness / 2],
    half: [config.paperWidthM / 2, config.paperHeightM / 2, thickness / 2],
    topZ,
    bottomZ,
    thicknessM: thickness,
  };
}

/**
 * Floor-level board. The upper face is the drawing plane at z = thickness.
 * The underside is the ground plane. Zero thickness returns null so the
 * wrapper does not add a degenerate or coplanar box.
 */
export function boardSpec(config: ExperimentConfig): PlatformSpec | null {
  if (!isGround(config)) return null;
  const thickness = config.boardThicknessM;
  if (!(thickness > 1e-4) || thickness > 0.0100001) return null;
  if (!(config.paperWidthM > 0) || !(config.paperHeightM > 0)) return null;
  return {
    center: [config.paperOriginX, config.paperOriginY, thickness / 2],
    half: [config.paperWidthM / 2, config.paperHeightM / 2, thickness / 2],
    topZ: thickness,
    bottomZ: 0,
    thicknessM: thickness,
  };
}

/** Collision box for the active profile. Baseline and a zero-thickness sheet have none. */
export function collisionSpec(config: ExperimentConfig): PlatformSpec | null {
  if (isCandidate(config)) return platformSpec(config);
  if (isGround(config)) return boardSpec(config);
  return null;
}

export function applyMountProfile(config: ExperimentConfig, profile: ExperimentConfig['mountProfile']): ExperimentConfig {
  if (profile === 'ground') {
    return {
      ...config,
      mountProfile: 'ground',
      brushMountXM: 0.035,
      brushMountYM: 0,
      brushMountZM: 0,
      brushRollRad: 0,
      brushPitchRad: 0,
      brushYawRad: 0,
      brushLengthM: 0.045,
      brushClearanceM: 0.01,
      paperOriginX: 0.3,
      paperOriginY: 0,
      paperOriginZ: 0,
      paperYawRad: 0,
      paperWidthM: 0.2,
      paperHeightM: 0.2,
      boardThicknessM: 0,
      returnStyle: 'gradual',
      gestureKind: 'circle',
      gestureRadiusM: AERIAL_RADIUS_M,
      gestureSeconds: 4,
    };
  }
  if (profile !== 'candidate-a') {
    return {
      ...config,
      mountProfile: 'baseline',
      brushMountXM: 0.035,
      brushMountYM: 0,
      brushMountZM: 0,
      brushRollRad: 0,
      brushPitchRad: 0,
      brushYawRad: 0,
      brushLengthM: 0.045,
      brushClearanceM: 0.01,
      paperOriginX: 0.3,
      paperOriginY: 0,
      paperOriginZ: 0,
      paperYawRad: 0,
      paperWidthM: 0.2,
      paperHeightM: 0.2,
      boardThicknessM: 0,
      returnStyle: 'baseline',
    };
  }
  return {
    ...config,
    mountProfile: 'candidate-a',
    brushMountXM: 0.035,
    brushMountYM: 0,
    brushMountZM: 0,
    brushRollRad: 0,
    brushPitchRad: (45 * Math.PI) / 180,
    brushYawRad: 0,
    brushLengthM: 0.045,
    brushClearanceM: 0.01,
    paperOriginX: 0.2,
    paperOriginY: 0.08,
    paperOriginZ: 0.06,
    paperYawRad: 0,
    paperWidthM: 0.2,
    paperHeightM: 0.2,
    returnStyle: 'gradual',
    platformThicknessM: PLATFORM_THICKNESS_M,
    gestureKind: 'circle',
    gestureRadiusM: AERIAL_RADIUS_M,
    gestureSeconds: 4,
  };
}

/** A point on the clearance plane. The path starts and ends at the paper centre and stays within the radius. */
export function aerialTip(config: ExperimentConfig, progress: number): Vec3 {
  const centre: Vec3 = [
    config.paperOriginX,
    config.paperOriginY,
    config.paperOriginZ + config.brushClearanceM,
  ];
  const radius = Math.min(AERIAL_RADIUS_M, Math.max(0, config.gestureRadiusM));
  const unit = Math.min(1, Math.max(0, progress));
  if (config.gestureKind === 'line') {
    return [centre[0] + radius * Math.sin(unit * Math.PI), centre[1], centre[2]];
  }
  const theta = unit * Math.PI * 2;
  return [
    centre[0] + (radius / 2) * (1 - Math.cos(theta)),
    centre[1] + (radius / 2) * Math.sin(theta),
    centre[2],
  ];
}

export function sphereHitsPlatform(centre: Vec3, radius: number, spec: PlatformSpec): boolean {
  return sphereHitsAabb(centre, radius, spec.center, spec.half);
}

export function supportFootBlocked(foot: Vec3, spec: PlatformSpec): boolean {
  return sphereHitsPlatform(foot, FOOT_RADIUS_M, spec);
}

export function validateGroundPose(snapshot: PhysicsSnapshot, config: ExperimentConfig): CandidateCheck {
  if (!isGround(config)) {
    return { ok: true, reason: 'Not a ground sheet.', tip: null, angleDeg: null, footClearanceM: null, reachErrorM: null };
  }
  const spec = boardSpec(config);
  const fl = snapshot.feet.FL;
  const calibration = calibrationFrom(config);
  const brush = brushWorld(fl.frame, fl.frameQuat, calibration);
  const axis = quatRotate(brush.rotation, [0, 0, -1]);
  const angleDeg = (brushAngleToPaper(axis) * 180) / Math.PI;
  const footClearanceM = fl.sphere[2] - FOOT_RADIUS_M;
  const floorNote = `The home keyframe FL foot clearance is ${(footClearanceM * 1000).toFixed(1)} mm. That floor penetration is pre-existing and is not a board intersection.`;
  if (!spec) {
    return {
      ok: true,
      reason: `Ground sheet with no collision board. The paper lies on the floor at z = 0. ${floorNote} Triangle meshes were not evaluated.`,
      tip: brush.tip,
      angleDeg,
      footClearanceM,
      reachErrorM: null,
    };
  }
  const hits: string[] = [];
  for (const id of ['FL', 'FR', 'RL', 'RR'] as const) {
    const foot = snapshot.feet[id];
    if (sphereHitsPlatform(foot.sphere, FOOT_RADIUS_M, spec)) hits.push(`${id} foot sphere`);
    if (foot.onPlatform) hits.push(`${id} board contact`);
  }
  const boardHits = snapshot.contacts.filter(
    (contact) => contact.geom1.includes('paper_platform') || contact.geom2.includes('paper_platform'),
  );
  if (boardHits.length > 0 || (snapshot.platformContactCount ?? 0) > 0) {
    const detail =
      boardHits.length > 0
        ? boardHits
            .map((contact) =>
              contact.distanceM < 0
                ? `${contact.geom1} × ${contact.geom2} penetration ${(-contact.distanceM * 1000).toFixed(1)} mm`
                : `${contact.geom1} × ${contact.geom2} gap ${(contact.distanceM * 1000).toFixed(1)} mm`,
            )
            .join('; ')
        : `${snapshot.platformContactCount} board contact(s)`;
    hits.push(detail);
  }
  if (hits.length > 0) {
    return {
      ok: false,
      reason: `Ground sheet was not started. The home pose intersects the ${ (spec.thicknessM * 1000).toFixed(0) } mm board: ${hits.join(', ')}. ${floorNote} Mesh interference beyond these contacts was not evaluated. The pose was not jumped.`,
      tip: brush.tip,
      angleDeg,
      footClearanceM,
      reachErrorM: null,
    };
  }
  return {
    ok: true,
    reason: `Board upper surface ${spec.topZ.toFixed(3)} m, underside ${spec.bottomZ.toFixed(3)} m, thickness ${(spec.thicknessM * 1000).toFixed(1)} mm. No board contact at the home keyframe. Brush tip ${fmt(brush.tip)} m, shaft ${angleDeg.toFixed(1)}° from the inward normal. ${floorNote} Triangle meshes were not evaluated.`,
    tip: brush.tip,
    angleDeg,
    footClearanceM,
    reachErrorM: null,
  };
}

export function validateCandidatePose(snapshot: PhysicsSnapshot, config: ExperimentConfig): CandidateCheck {
  if (!isCandidate(config)) {
    return { ok: true, reason: 'Baseline has no elevated platform.', tip: null, angleDeg: null, footClearanceM: null, reachErrorM: null };
  }
  const spec = platformSpec(config);
  if (!spec) {
    return {
      ok: false,
      reason: 'Candidate A needs a platform whose underside is above the ground. The model was not stepped.',
      tip: null,
      angleDeg: null,
      footClearanceM: null,
      reachErrorM: null,
    };
  }
  const hits: string[] = [];
  for (const id of ['FL', 'FR', 'RL', 'RR'] as const) {
    const foot = snapshot.feet[id];
    if (sphereHitsPlatform(foot.sphere, FOOT_RADIUS_M, spec)) hits.push(`${id} foot sphere`);
    if (foot.onPlatform) hits.push(`${id} platform contact`);
  }
  const platformHits = snapshot.contacts.filter(
    (contact) => contact.geom1.includes('paper_platform') || contact.geom2.includes('paper_platform'),
  );
  if (platformHits.length > 0 || (snapshot.platformContactCount ?? 0) > 0) {
    const detail =
      platformHits.length > 0
        ? platformHits
            .map((contact) =>
              contact.distanceM < 0
                ? `${contact.geom1} × ${contact.geom2} penetration ${(-contact.distanceM * 1000).toFixed(1)} mm`
                : `${contact.geom1} × ${contact.geom2} gap ${(contact.distanceM * 1000).toFixed(1)} mm`,
            )
            .join('; ')
        : `${snapshot.platformContactCount} platform contact(s)`;
    hits.push(detail);
  }
  const base = snapshot.basePosition;
  const torso: Vec3 = [base[0], base[1], base[2]];
  if (sphereHitsAabb(torso, Math.hypot(TORSO_HALF[0], TORSO_HALF[1], TORSO_HALF[2]), spec.center, spec.half) && boxHitsAabb(torso, TORSO_HALF, spec)) {
    hits.push('torso box');
  }
  const head = add(base, HEAD_LOCAL);
  if (sphereHitsPlatform(head, HEAD_RADIUS_M, spec)) hits.push('head sphere');
  const fl = snapshot.feet.FL;
  const calibration = calibrationFrom(config);
  const brush = brushWorld(fl.frame, fl.frameQuat, calibration);
  const axis = quatRotate(brush.rotation, [0, 0, -1]);
  const angleDeg = (brushAngleToPaper(axis) * 180) / Math.PI;
  const footClearanceM = fl.sphere[2] - FOOT_RADIUS_M;
  if (hits.length > 0) {
    return {
      ok: false,
      reason: `Candidate A was not started. The home pose intersects the elevated platform: ${hits.join(', ')}. Mesh interference beyond these primitives was not evaluated. The pose was not jumped.`,
      tip: brush.tip,
      angleDeg,
      footClearanceM,
      reachErrorM: null,
    };
  }
  const support = (['FR', 'RL', 'RR'] as const).filter((id) => !snapshot.feet[id].onFloor);
  const supportNote = support.length > 0 ? ` Support feet off the ground geom: ${support.join(', ')}.` : ' FR, RL and RR report ground contact.';
  return {
    ok: true,
    reason: `Platform top ${spec.topZ.toFixed(3)} m, underside ${spec.bottomZ.toFixed(3)} m, thickness ${(spec.thicknessM * 1000).toFixed(0)} mm. Brush tip ${fmt(brush.tip)} m, shaft ${angleDeg.toFixed(1)}° from the inward normal. FL foot clearance ${(footClearanceM * 1000).toFixed(1)} mm.${supportNote} Triangle meshes were not evaluated.`,
    tip: brush.tip,
    angleDeg,
    footClearanceM,
    reachErrorM: null,
  };
}

/** Copy one geometric ground candidate into the experiment. The robot base is not moved. */
export function applyGroundCandidate(
  config: ExperimentConfig,
  candidate: {
    calibration: BrushCalibration;
    origin: Vec3;
    yawRad: number;
    boardThicknessM?: number;
  },
): ExperimentConfig {
  const thickness = Math.min(0.01, Math.max(0, candidate.boardThicknessM ?? candidate.origin[2]));
  return {
    ...config,
    mountProfile: 'ground',
    brushMountXM: candidate.calibration.mountOffset[0],
    brushMountYM: candidate.calibration.mountOffset[1],
    brushMountZM: candidate.calibration.mountOffset[2],
    brushRollRad: candidate.calibration.rollRad,
    brushPitchRad: candidate.calibration.pitchRad,
    brushYawRad: candidate.calibration.yawRad,
    brushLengthM: candidate.calibration.lengthM,
    paperOriginX: candidate.origin[0],
    paperOriginY: candidate.origin[1],
    paperOriginZ: thickness,
    paperYawRad: candidate.yawRad,
    paperWidthM: 0.2,
    paperHeightM: 0.2,
    boardThicknessM: thickness,
    brushClearanceM: 0.01,
    returnStyle: 'gradual',
    gestureKind: 'circle',
    gestureRadiusM: AERIAL_RADIUS_M,
    gestureSeconds: 4,
  };
}

export function setBoardThickness(config: ExperimentConfig, thicknessM: number): ExperimentConfig {
  const thickness = Math.min(0.01, Math.max(0, thicknessM));
  return {
    ...config,
    mountProfile: 'ground',
    boardThicknessM: thickness,
    paperOriginZ: thickness,
    paperWidthM: 0.2,
    paperHeightM: 0.2,
  };
}

export function candidateCalibration(): BrushCalibration {
  return {
    mountOffset: [0.035, 0, 0],
    rollRad: 0,
    pitchRad: (45 * Math.PI) / 180,
    yawRad: 0,
    lengthM: 0.045,
  };
}

export function tipOffsetMatchesCandidate(): boolean {
  const tip = brushTipInFoot(candidateCalibration());
  return tip.every((value) => Number.isFinite(value));
}

function boxHitsAabb(centre: Vec3, half: Vec3, spec: PlatformSpec): boolean {
  const min: Vec3 = [centre[0] - half[0], centre[1] - half[1], centre[2] - half[2]];
  const max: Vec3 = [centre[0] + half[0], centre[1] + half[1], centre[2] + half[2]];
  const boxMin: Vec3 = [spec.center[0] - spec.half[0], spec.center[1] - spec.half[1], spec.center[2] - spec.half[2]];
  const boxMax: Vec3 = [spec.center[0] + spec.half[0], spec.center[1] + spec.half[1], spec.center[2] + spec.half[2]];
  return min[0] <= boxMax[0] && max[0] >= boxMin[0] && min[1] <= boxMax[1] && max[1] >= boxMin[1] && min[2] <= boxMax[2] && max[2] >= boxMin[2];
}

function sphereHitsAabb(centre: Vec3, radius: number, boxCentre: Vec3, half: Vec3): boolean {
  let sum = 0;
  for (let axis = 0; axis < 3; axis += 1) {
    const value = centre[axis] ?? 0;
    const low = (boxCentre[axis] ?? 0) - (half[axis] ?? 0);
    const high = (boxCentre[axis] ?? 0) + (half[axis] ?? 0);
    const delta = value < low ? low - value : value > high ? value - high : 0;
    sum += delta * delta;
  }
  return sum <= radius * radius;
}

function add(a: Vec3, b: Vec3): Vec3 {
  return [a[0] + b[0], a[1] + b[1], a[2] + b[2]];
}

function fmt(point: Vec3): string {
  return point.map((value) => value.toFixed(3)).join(', ');
}

export function footOnPlatform(foot: FootState | undefined): boolean {
  return foot?.onPlatform === true;
}
