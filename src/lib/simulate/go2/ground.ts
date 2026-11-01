/**
 * Ground Sheet / Low Clipboard.
 *
 * The drawing surface is the floor, or the top of a thin board that rests on
 * the floor. Thickness is the upper-surface height. These ranges are a finite
 * geometric sample. They are not recommended hardware dimensions, and the
 * search is not a global optimum.
 *
 * The body stays on the home keyframe. Mesh collision is not evaluated.
 */

import type { BrushCalibration } from './brush.ts';
import { forwardLeg, referenceAngles } from './kinematics.ts';
import type { Vec3 } from './math.ts';
import { BODY_POSITION, type LegId } from './model.ts';
import { FOOT_SPHERE_RADIUS_M } from './posture.ts';
import { SEARCH_COLUMNS, WORKSPACE_TOLERANCE_DEG, rankWorkspaceCandidates, samplePaperWorkspace, type WorkspaceCandidate, type WorkspaceQuery } from './workspace.ts';

/** Study values. 10 mm is allowed for exploration and is not a preferred thickness. */
export const GROUND_THICKNESS_M = [0, 0.003, 0.005, 0.008] as const;
export const GROUND_MAX_THICKNESS_M = 0.01;

/**
 * Paper centres, metres, in the floor plane. Z is applied from the board thickness.
 * In front of the body, toward the FL side, and nearer the standing FL foot.
 */
export const GROUND_PAPER_XY: readonly (readonly [number, number])[] = [
  [0.3, 0],
  [0.24, 0.08],
  [0.18, 0.14],
];

/** Shaft lengths tried in the coarse sample. Not a hardware specification. */
export const GROUND_LENGTHS_M = [0.045, 0.08, 0.1] as const;

/** Coarse pitch samples, degrees. Roll stays 0 until refinement. */
export const GROUND_PITCH_DEG = [-90, -45, 0] as const;

const DEFAULT_MOUNT: Vec3 = [0.035, 0, 0];

export function groundQuery(options: {
  thicknessM: number;
  paperX: number;
  paperY: number;
  lengthM: number;
  pitchDeg: number;
  rollDeg?: number;
  mount?: Vec3;
}): WorkspaceQuery {
  const thickness = clampThickness(options.thicknessM);
  const mount = options.mount ?? DEFAULT_MOUNT;
  const calibration: BrushCalibration = {
    mountOffset: [mount[0], mount[1], mount[2]],
    rollRad: ((options.rollDeg ?? 0) * Math.PI) / 180,
    pitchRad: (options.pitchDeg * Math.PI) / 180,
    yawRad: 0,
    lengthM: options.lengthM,
  };
  return {
    calibration,
    origin: [options.paperX, options.paperY, thickness],
    yawRad: 0,
    toleranceDeg: WORKSPACE_TOLERANCE_DEG,
    columns: SEARCH_COLUMNS,
    boardThicknessM: thickness,
  };
}

/** Coarse list. Attachment stays at the default mount. */
export function coarseGroundQueries(): WorkspaceQuery[] {
  const queries: WorkspaceQuery[] = [];
  for (const thicknessM of GROUND_THICKNESS_M) {
    for (const [paperX, paperY] of GROUND_PAPER_XY) {
      for (const lengthM of GROUND_LENGTHS_M) {
        for (const pitchDeg of GROUND_PITCH_DEG) {
          queries.push(groundQuery({ thicknessM, paperX, paperY, lengthM, pitchDeg }));
        }
      }
    }
  }
  return queries;
}

/**
 * Local sample around one coarse result.
 * Pitch ±15°, one longer shaft, paper nudged 20 mm, roll 0° and 15°,
 * and one lower forward attachment. Still a finite list.
 */
export function refineGroundQueries(best: WorkspaceCandidate): WorkspaceQuery[] {
  const thickness = best.boardThicknessM ?? best.origin[2];
  const pitches = [best.calibration.pitchRad, best.calibration.pitchRad - (15 * Math.PI) / 180, best.calibration.pitchRad + (15 * Math.PI) / 180];
  const lengths = [best.calibration.lengthM, Math.min(0.12, best.calibration.lengthM + 0.02)];
  const papers: Array<readonly [number, number]> = [
    [best.origin[0], best.origin[1]],
    [best.origin[0] + 0.02, best.origin[1]],
    [best.origin[0] - 0.02, best.origin[1]],
    [best.origin[0], best.origin[1] + 0.02],
    [best.origin[0], best.origin[1] - 0.02],
  ];
  const rolls = [0, 15];
  const mounts: Vec3[] = [
    [best.calibration.mountOffset[0], best.calibration.mountOffset[1], best.calibration.mountOffset[2]],
    [0.05, 0, -0.015],
  ];
  const queries: WorkspaceQuery[] = [];
  for (const pitch of pitches) {
    for (const lengthM of lengths) {
      for (const [paperX, paperY] of papers) {
        for (const rollDeg of rolls) {
          for (const mount of mounts) {
            queries.push(
              groundQuery({
                thicknessM: thickness,
                paperX,
                paperY,
                lengthM,
                pitchDeg: (pitch * 180) / Math.PI,
                rollDeg,
                mount,
              }),
            );
          }
        }
      }
    }
  }
  return queries;
}

export function solveGroundQuery(query: WorkspaceQuery): WorkspaceCandidate {
  const summary = samplePaperWorkspace({ ...query, columns: SEARCH_COLUMNS, toleranceDeg: WORKSPACE_TOLERANCE_DEG });
  return {
    calibration: query.calibration,
    origin: [query.origin[0], query.origin[1], query.origin[2]],
    yawRad: query.yawRad,
    boardThicknessM: query.boardThicknessM ?? 0,
    homeBoardClear: homeBoardClear(query),
    summary,
  };
}

/** Home-keyframe foot spheres against the board. Zero thickness has no board. */
export function homeBoardClear(query: WorkspaceQuery): boolean {
  const thickness = query.boardThicknessM ?? 0;
  if (!(thickness > 1e-4)) return true;
  const centre: Vec3 = [query.origin[0], query.origin[1], thickness / 2];
  const half: Vec3 = [0.1, 0.1, thickness / 2];
  return homeFootSpheres().every((sphere) => !sphereHitsAabb(sphere, FOOT_SPHERE_RADIUS_M, centre, half));
}

export function rankGroundCandidates(found: readonly WorkspaceCandidate[]): WorkspaceCandidate[] {
  const desiredX = 0.24;
  const desiredY = 0.1;
  return found.slice().sort((a, b) => {
    const blocked = Number(b.homeBoardClear !== false) - Number(a.homeBoardClear !== false);
    if (blocked !== 0) return blocked;
    if (b.summary.largestRegion !== a.summary.largestRegion) return b.summary.largestRegion - a.summary.largestRegion;
    if (b.summary.candidate !== a.summary.candidate) return b.summary.candidate - a.summary.candidate;
    const clearance = (b.summary.minCandidateClearanceM ?? -1) - (a.summary.minCandidateClearanceM ?? -1);
    if (Math.abs(clearance) > 1e-6) return clearance;
    const angle = (a.summary.candidateAngle?.median ?? 180) - (b.summary.candidateAngle?.median ?? 180);
    if (Math.abs(angle) > 1e-6) return angle;
    const distance = (origin: WorkspaceCandidate) => Math.hypot(origin.origin[0] - desiredX, origin.origin[1] - desiredY);
    return distance(a) - distance(b);
  });
}

export interface GroundStudy {
  coarsePlanned: number;
  refinedPlanned: number;
  cancelled: boolean;
  candidates: WorkspaceCandidate[];
}

/** Coarse sample, then refinement around the best coarse result. Deterministic. */
export function runGroundStudy(signal?: { cancelled: boolean }): GroundStudy {
  const coarseQueries = coarseGroundQueries();
  const coarse: WorkspaceCandidate[] = [];
  for (const query of coarseQueries) {
    if (signal?.cancelled) {
      return { coarsePlanned: coarseQueries.length, refinedPlanned: 0, cancelled: true, candidates: rankGroundCandidates(coarse) };
    }
    coarse.push(solveGroundQuery(query));
  }
  const ranked = rankGroundCandidates(coarse);
  const best = ranked.find((item) => item.homeBoardClear !== false && item.summary.largestRegion > 0) ?? ranked[0];
  const refinedQueries = best ? refineGroundQueries(best) : [];
  const all = coarse.slice();
  for (const query of refinedQueries) {
    if (signal?.cancelled) {
      return {
        coarsePlanned: coarseQueries.length,
        refinedPlanned: refinedQueries.length,
        cancelled: true,
        candidates: rankGroundCandidates(all),
      };
    }
    all.push(solveGroundQuery(query));
  }
  return {
    coarsePlanned: coarseQueries.length,
    refinedPlanned: refinedQueries.length,
    cancelled: false,
    candidates: rankGroundCandidates(all),
  };
}

export function clampThickness(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(GROUND_MAX_THICKNESS_M, Math.max(0, value));
}

const HOME_LEGS: readonly LegId[] = ['FL', 'FR', 'RL', 'RR'];

function homeFootSpheres(): Vec3[] {
  const angles = referenceAngles();
  return HOME_LEGS.map((id) => {
    const pose = forwardLeg(id, angles, [0, 0, 0]);
    return [pose.sphere[0] + BODY_POSITION[0], pose.sphere[1] + BODY_POSITION[1], pose.sphere[2] + BODY_POSITION[2]];
  });
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

export { rankWorkspaceCandidates };
