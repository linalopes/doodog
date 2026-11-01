/**
 * Geometric brush-mount and paper exploration for the front-left leg.
 *
 * The body stays on the home keyframe. Inverse kinematics is the existing
 * position-only `solveLeg`. Posture checks are the existing primitive tests.
 * Mesh intersection is not run, so a point that passes the implemented checks
 * is a candidate, not a validated drawing pose and not a MuJoCo result.
 *
 * The brush axis in this module is the shaft: brush −Z, rotated by the
 * calibration and then by the foot. It is not the vector from the foot origin
 * to the tip, and it is not assumed to be world −Z. The paper has yaw and no
 * pitch or roll, so its inward normal stays world −Z.
 *
 * The sheet sampled here is 0.20 m × 0.20 m. The search below is one finite
 * list. It is not a global optimum.
 */

import { getExampleById } from '../../sketches/examples.ts';
import {
  DEFAULT_BRUSH_CALIBRATION,
  brushQuaternion,
  brushTipInFoot,
  type BrushCalibration,
} from './brush.ts';
import { defaultSimConfig } from './defaults.ts';
import { solveLeg } from './kinematics.ts';
import { mapBrushTarget, type PaperConfig } from './mapping.ts';
import { add, quatRotate, yawPoint, type Vec3 } from './math.ts';
import { BODY_POSITION } from './model.ts';
import { assessPosture, brushAngleToPaper, type CheckStatus } from './posture.ts';

export const WORKSPACE_SHEET_M = 0.2;
export const WORKSPACE_TOLERANCE_DEG = 25;

/** Coarse paper grid used by the documented search. Manual exploration can use 4, 6, or 8. */
export const SEARCH_COLUMNS = 5;

export type CellKind = 'unreachable' | 'posture-invalid' | 'candidate' | 'indeterminate';

export const CELL_KIND_RGB: Record<CellKind, readonly [number, number, number]> = {
  unreachable: [202, 216, 216],
  'posture-invalid': [234, 125, 255],
  candidate: [34, 17, 62],
  indeterminate: [200, 189, 212],
};

export interface WorkspaceQuery {
  calibration: BrushCalibration;
  origin: Vec3;
  yawRad: number;
  toleranceDeg: number;
  columns: number;
}

export interface WorkspaceCell {
  column: number;
  row: number;
  /** Tip target on the sheet, world metres. */
  target: Vec3;
  achieved: Vec3 | null;
  kind: CellKind;
  positionErrorM: number;
  joints: readonly [number, number, number] | null;
  /** Shaft direction in world axes. */
  brushAxis: Vec3 | null;
  brushAngleDeg: number | null;
  footClearanceM: number | null;
  linkClearanceM: number | null;
  sphere: Vec3 | null;
  jointsStatus: CheckStatus | null;
  floor: CheckStatus | null;
  contralateral: CheckStatus | null;
  torso: CheckStatus | null;
  brush: CheckStatus | null;
  mesh: 'not-evaluated';
  reason: string;
}

export interface AngleSpan {
  min: number;
  median: number;
  max: number;
}

export interface WorkspaceSummary {
  columns: number;
  rows: number;
  examined: number;
  unreachable: number;
  postureInvalid: number;
  candidate: number;
  indeterminate: number;
  /** Largest 4-connected block of candidate cells on this sample grid. */
  largestRegion: number;
  candidateFraction: number;
  /** Shaft angle among position-reached samples, degrees. */
  reachedAngle: AngleSpan | null;
  /** Shaft angle among candidates, degrees. */
  candidateAngle: AngleSpan | null;
  /** Lowest link clearance among candidates. Null when there are none. */
  minCandidateClearanceM: number | null;
  mesh: 'not-evaluated';
  mujocoTested: false;
  cells: WorkspaceCell[];
}

export interface WorkspaceCandidate {
  calibration: BrushCalibration;
  origin: Vec3;
  yawRad: number;
  summary: WorkspaceSummary;
}

export interface WorkspaceSnapshot {
  version: 1;
  calibration: BrushCalibration;
  paper: {
    widthM: number;
    heightM: number;
    origin: Vec3;
    yawRad: number;
  };
  toleranceDeg: number;
  columns: number;
  rows: number;
  examined: number;
  unreachable: number;
  postureInvalid: number;
  candidate: number;
  indeterminate: number;
  largestRegion: number;
  candidateFraction: number;
  reachedAngle: AngleSpan | null;
  candidateAngle: AngleSpan | null;
  minCandidateClearanceM: number | null;
  mesh: 'not-evaluated';
  mujocoTested: false;
}

export interface ScoreSample {
  time: number;
  contact: boolean;
  kind: CellKind | null;
  reason: string;
}

export interface ScoreEvaluation {
  id: string;
  samples: number;
  contactSamples: number;
  positionReached: number;
  candidates: number;
  rejected: number;
  indeterminate: number;
  positionPercent: number;
  candidatePercent: number;
  longestAcceptedRun: number;
  longestContactRun: number;
  /** True only when every contact sample is a candidate. Not a continuous-motion proof. */
  completePath: boolean;
  rejections: ScoreSample[];
}

export interface SearchOptions {
  columns?: number;
  /** Stop after this many configurations. The full list is `searchSpecs().length`. */
  maxSpecs?: number;
  signal?: { cancelled: boolean };
}

export interface SearchResult {
  examined: number;
  planned: number;
  cancelled: boolean;
  columns: number;
  candidates: WorkspaceCandidate[];
}

interface Checks {
  joints: CheckStatus;
  floor: CheckStatus;
  contralateral: CheckStatus;
  torso: CheckStatus;
  brush: CheckStatus;
}

const PAPER_WIDTH = WORKSPACE_SHEET_M;
const PAPER_HEIGHT = WORKSPACE_SHEET_M;

/**
 * Finite search. Pitches and rolls aim the shaft. Paper centres stay on the
 * documented list. Attachment and length stay at the default except where a
 * spec says otherwise. Yaw of the sheet stays 0 in the search; the manual
 * controls can still set it.
 */
export function searchSpecs(): WorkspaceQuery[] {
  const pitches = [-90, -45, 0, 45, 90];
  const rolls = [-90, 0, 90];
  const papers: Array<{ origin: Vec3; yawRad: number }> = [
    { origin: [0.3, 0, 0], yawRad: 0 },
    { origin: [0.3, 0.06, 0], yawRad: 0 },
    { origin: [0.2, 0.08, 0.06], yawRad: 0 },
    { origin: [0.12, 0.1, 0.14], yawRad: 0 },
  ];
  const queries: WorkspaceQuery[] = [];
  for (const paper of papers) {
    for (const pitch of pitches) {
      for (const roll of rolls) {
        queries.push({
          calibration: {
            mountOffset: [0.035, 0, 0],
            rollRad: (roll * Math.PI) / 180,
            pitchRad: (pitch * Math.PI) / 180,
            yawRad: 0,
            lengthM: 0.045,
          },
          origin: paper.origin,
          yawRad: paper.yawRad,
          toleranceDeg: WORKSPACE_TOLERANCE_DEG,
          columns: SEARCH_COLUMNS,
        });
      }
    }
  }
  return queries;
}

export function defaultWorkspaceQuery(): WorkspaceQuery {
  const paper = defaultSimConfig().paper;
  return {
    calibration: {
      mountOffset: [...DEFAULT_BRUSH_CALIBRATION.mountOffset],
      rollRad: DEFAULT_BRUSH_CALIBRATION.rollRad,
      pitchRad: DEFAULT_BRUSH_CALIBRATION.pitchRad,
      yawRad: DEFAULT_BRUSH_CALIBRATION.yawRad,
      lengthM: DEFAULT_BRUSH_CALIBRATION.lengthM,
    },
    origin: [paper.origin[0], paper.origin[1], paper.origin[2]],
    yawRad: paper.yawRad,
    toleranceDeg: WORKSPACE_TOLERANCE_DEG,
    columns: 6,
  };
}

export function paperOf(query: WorkspaceQuery): PaperConfig {
  return {
    widthM: PAPER_WIDTH,
    heightM: PAPER_HEIGHT,
    origin: query.origin,
    yawRad: query.yawRad,
    liftHeightM: 0.04,
  };
}

/** One sample on the sheet. Row 0 is robot +X. Column 0 is robot +Y. */
export function paperPoint(column: number, row: number, columns: number, rows: number, query: WorkspaceQuery): Vec3 {
  const localX = (0.5 - (row + 0.5) / rows) * PAPER_WIDTH;
  const localY = (0.5 - (column + 0.5) / columns) * PAPER_HEIGHT;
  const turned = yawPoint(query.yawRad, [localX, localY, 0]);
  return [query.origin[0] + turned[0], query.origin[1] + turned[1], query.origin[2]];
}

export function classifyPaperPoint(target: Vec3, query: WorkspaceQuery): WorkspaceCell {
  const offset = brushTipInFoot(query.calibration);
  const body: Vec3 = [target[0] - BODY_POSITION[0], target[1] - BODY_POSITION[1], target[2] - BODY_POSITION[2]];
  const solved = solveLeg('FL', body, offset);
  const posture = assessPosture(
    'FL',
    solved.joints,
    offset,
    solved.positionErrorM,
    (query.toleranceDeg * Math.PI) / 180,
  );
  const shaftFoot = quatRotate(brushQuaternion(query.calibration), [0, 0, -1]);
  const shaft = unit(quatRotate(solved.footRotation, shaftFoot));
  const angle = brushAngleToPaper(shaft);
  const brush: CheckStatus =
    query.calibration.lengthM <= 0 ? 'not-evaluated' : angle <= (query.toleranceDeg * Math.PI) / 180 + 1e-6 ? 'valid' : 'invalid';
  const checks: Checks = {
    joints: posture.joints,
    floor: posture.floor,
    contralateral: posture.contralateral,
    torso: posture.torso,
    brush,
  };
  const kind = kindOf(solved.reachable, checks);
  const achieved = add(solved.tip, BODY_POSITION);
  const sphere = add(solved.sphere, BODY_POSITION);
  return {
    column: 0,
    row: 0,
    target,
    achieved,
    kind,
    positionErrorM: solved.positionErrorM,
    joints: [solved.joints[0], solved.joints[1], solved.joints[2]],
    brushAxis: shaft,
    brushAngleDeg: (angle * 180) / Math.PI,
    footClearanceM: posture.footClearanceM,
    linkClearanceM: posture.linkClearanceM,
    sphere,
    jointsStatus: posture.joints,
    floor: posture.floor,
    contralateral: posture.contralateral,
    torso: posture.torso,
    brush,
    mesh: 'not-evaluated',
    reason: reasonFor(solved.reachable, solved.positionErrorM, checks, (angle * 180) / Math.PI),
  };
}

export function fillWorkspaceRows(
  cells: WorkspaceCell[],
  query: WorkspaceQuery,
  startRow: number,
  endRow: number,
): void {
  const columns = clampColumns(query.columns);
  const rows = columns;
  const first = Math.max(0, startRow);
  const last = Math.min(rows, endRow);
  for (let row = first; row < last; row += 1) {
    for (let column = 0; column < columns; column += 1) {
      const target = paperPoint(column, row, columns, rows, query);
      const cell = classifyPaperPoint(target, query);
      cell.column = column;
      cell.row = row;
      cells[row * columns + column] = cell;
    }
  }
}

export function summarizeWorkspace(cells: readonly WorkspaceCell[], columns: number): WorkspaceSummary {
  const rows = columns;
  let unreachable = 0;
  let postureInvalid = 0;
  let candidate = 0;
  let indeterminate = 0;
  const reachedAngles: number[] = [];
  const candidateAngles: number[] = [];
  let minCandidateClearanceM: number | null = null;
  for (const cell of cells) {
    if (!cell) continue;
    if (cell.kind === 'unreachable') unreachable += 1;
    else if (cell.kind === 'posture-invalid') postureInvalid += 1;
    else if (cell.kind === 'candidate') candidate += 1;
    else indeterminate += 1;
    if (cell.kind !== 'unreachable' && cell.brushAngleDeg !== null) reachedAngles.push(cell.brushAngleDeg);
    if (cell.kind === 'candidate') {
      if (cell.brushAngleDeg !== null) candidateAngles.push(cell.brushAngleDeg);
      if (cell.linkClearanceM !== null) {
        minCandidateClearanceM =
          minCandidateClearanceM === null ? cell.linkClearanceM : Math.min(minCandidateClearanceM, cell.linkClearanceM);
      }
    }
  }
  const examined = unreachable + postureInvalid + candidate + indeterminate;
  return {
    columns,
    rows,
    examined,
    unreachable,
    postureInvalid,
    candidate,
    indeterminate,
    largestRegion: largestCandidateRegion(cells, columns, rows),
    candidateFraction: examined > 0 ? candidate / examined : 0,
    reachedAngle: span(reachedAngles),
    candidateAngle: span(candidateAngles),
    minCandidateClearanceM,
    mesh: 'not-evaluated',
    mujocoTested: false,
    cells: cells.slice(),
  };
}

export function samplePaperWorkspace(query: WorkspaceQuery): WorkspaceSummary {
  const columns = clampColumns(query.columns);
  const cells: WorkspaceCell[] = new Array(columns * columns);
  fillWorkspaceRows(cells, { ...query, columns }, 0, columns);
  return summarizeWorkspace(cells, columns);
}

/** One configuration from the documented list. `'cancelled'` is returned before any solve. */
export function searchStep(
  index: number,
  columns = SEARCH_COLUMNS,
  signal?: { cancelled: boolean },
): WorkspaceCandidate | 'cancelled' | 'done' {
  if (signal?.cancelled) return 'cancelled';
  const spec = searchSpecs()[index];
  if (!spec) return 'done';
  const summary = samplePaperWorkspace({
    ...spec,
    columns: clampColumns(columns),
    toleranceDeg: WORKSPACE_TOLERANCE_DEG,
  });
  return {
    calibration: spec.calibration,
    origin: spec.origin,
    yawRad: spec.yawRad,
    summary,
  };
}

export function runSearch(options: SearchOptions = {}): SearchResult {
  const planned = searchSpecs().length;
  const columns = clampColumns(options.columns ?? SEARCH_COLUMNS);
  const limit = Math.min(planned, options.maxSpecs ?? planned);
  const found: WorkspaceCandidate[] = [];
  let examined = 0;
  for (let index = 0; index < limit; index += 1) {
    const step = searchStep(index, columns, options.signal);
    if (step === 'cancelled') {
      return { examined, planned, cancelled: true, columns, candidates: rankWorkspaceCandidates(found) };
    }
    if (step === 'done') break;
    found.push(step);
    examined += 1;
  }
  return {
    examined,
    planned,
    cancelled: false,
    columns,
    candidates: rankWorkspaceCandidates(found),
  };
}

export function workspaceSnapshot(query: WorkspaceQuery, summary: WorkspaceSummary): WorkspaceSnapshot {
  return {
    version: 1,
    calibration: {
      mountOffset: [...query.calibration.mountOffset],
      rollRad: query.calibration.rollRad,
      pitchRad: query.calibration.pitchRad,
      yawRad: query.calibration.yawRad,
      lengthM: query.calibration.lengthM,
    },
    paper: {
      widthM: PAPER_WIDTH,
      heightM: PAPER_HEIGHT,
      origin: [...query.origin],
      yawRad: query.yawRad,
    },
    toleranceDeg: query.toleranceDeg,
    columns: summary.columns,
    rows: summary.rows,
    examined: summary.examined,
    unreachable: summary.unreachable,
    postureInvalid: summary.postureInvalid,
    candidate: summary.candidate,
    indeterminate: summary.indeterminate,
    largestRegion: summary.largestRegion,
    candidateFraction: summary.candidateFraction,
    reachedAngle: summary.reachedAngle,
    candidateAngle: summary.candidateAngle,
    minCandidateClearanceM: summary.minCandidateClearanceM,
    mesh: 'not-evaluated',
    mujocoTested: false,
  };
}

export function evaluateCreativeScore(
  id: string,
  frames: readonly { time: number; left: { x: number; y: number; contact: boolean } }[],
  canvas: { width: number; height: number },
  query: WorkspaceQuery,
): ScoreEvaluation {
  const paper = paperOf(query);
  const mapping = defaultSimConfig().mapping;
  const samples: ScoreSample[] = [];
  let contactSamples = 0;
  let positionReached = 0;
  let candidates = 0;
  let rejected = 0;
  let indeterminate = 0;
  let acceptedRun = 0;
  let contactRun = 0;
  let longestAcceptedRun = 0;
  let longestContactRun = 0;
  for (const frame of frames) {
    if (!frame.left.contact) {
      longestAcceptedRun = Math.max(longestAcceptedRun, acceptedRun);
      longestContactRun = Math.max(longestContactRun, contactRun);
      acceptedRun = 0;
      contactRun = 0;
      samples.push({ time: frame.time, contact: false, kind: null, reason: 'Brush up. Not a drawing sample.' });
      continue;
    }
    contactSamples += 1;
    contactRun += 1;
    const mapped = mapBrushTarget(frame.left, canvas, paper, mapping, true, BODY_POSITION);
    const cell = classifyPaperPoint(mapped.surface, query);
    if (cell.kind !== 'unreachable') positionReached += 1;
    if (cell.kind === 'candidate') {
      candidates += 1;
      acceptedRun += 1;
    } else {
      longestAcceptedRun = Math.max(longestAcceptedRun, acceptedRun);
      acceptedRun = 0;
      if (cell.kind === 'indeterminate') indeterminate += 1;
      else rejected += 1;
    }
    samples.push({ time: frame.time, contact: true, kind: cell.kind, reason: cell.reason });
  }
  longestAcceptedRun = Math.max(longestAcceptedRun, acceptedRun);
  longestContactRun = Math.max(longestContactRun, contactRun);
  const rejections = samples.filter((sample) => sample.contact && sample.kind !== 'candidate');
  return {
    id,
    samples: frames.length,
    contactSamples,
    positionReached,
    candidates,
    rejected,
    indeterminate,
    positionPercent: contactSamples > 0 ? (100 * positionReached) / contactSamples : 0,
    candidatePercent: contactSamples > 0 ? (100 * candidates) / contactSamples : 0,
    longestAcceptedRun,
    longestContactRun,
    completePath: contactSamples > 0 && candidates === contactSamples && indeterminate === 0,
    rejections,
  };
}

/** Load one built-in score. The source is not modified. */
export function loadExampleFrames(
  id: string,
  canvas = { width: 600, height: 600 },
  stepSeconds = 0.5,
): { time: number; left: { x: number; y: number; contact: boolean } }[] {
  const example = getExampleById(id);
  if (!example) return [];
  const runner = new Function(
    'width',
    'height',
    'Math',
    `${example.source}\nreturn { motion, period: typeof scorePeriod === 'function' ? scorePeriod() : null };`,
  ) as (
    width: number,
    height: number,
    math: Math,
  ) => { motion: (time: number) => { left: { x: number; y: number; contact: boolean } }; period: number | null };
  const loaded = runner(canvas.width, canvas.height, Math);
  const period = loaded.period && loaded.period > 0 ? loaded.period : 8;
  const frames = [];
  for (let time = 0; time < period - 1e-9; time += stepSeconds) {
    const frame = loaded.motion(time);
    frames.push({ time, left: { x: frame.left.x, y: frame.left.y, contact: frame.left.contact } });
  }
  return frames;
}

export function sameCalibration(a: BrushCalibration, b: BrushCalibration): boolean {
  return (
    Math.abs(a.mountOffset[0] - b.mountOffset[0]) < 1e-9 &&
    Math.abs(a.mountOffset[1] - b.mountOffset[1]) < 1e-9 &&
    Math.abs(a.mountOffset[2] - b.mountOffset[2]) < 1e-9 &&
    Math.abs(a.rollRad - b.rollRad) < 1e-9 &&
    Math.abs(a.pitchRad - b.pitchRad) < 1e-9 &&
    Math.abs(a.yawRad - b.yawRad) < 1e-9 &&
    Math.abs(a.lengthM - b.lengthM) < 1e-9
  );
}

function kindOf(positionReached: boolean, checks: Checks): CellKind {
  if (!positionReached) return 'unreachable';
  const values = [checks.joints, checks.floor, checks.contralateral, checks.torso, checks.brush];
  if (values.some((status) => status === 'invalid')) return 'posture-invalid';
  if (values.some((status) => status === 'not-evaluated')) return 'indeterminate';
  return 'candidate';
}

function reasonFor(positionReached: boolean, errorM: number, checks: Checks, angleDeg: number): string {
  if (!positionReached) return `Position missed by ${(errorM * 1000).toFixed(0)} mm.`;
  const failed: string[] = [];
  if (checks.joints === 'invalid') failed.push('joint limit');
  if (checks.floor === 'invalid') failed.push('link or foot sphere below the floor');
  if (checks.contralateral === 'invalid') failed.push('foot crosses the midline');
  if (checks.torso === 'invalid') failed.push('torso primitive intersection');
  if (checks.brush === 'invalid') failed.push(`shaft ${angleDeg.toFixed(0)}° from the inward paper normal`);
  if (checks.brush === 'not-evaluated') return 'Shaft direction was not evaluated. Mesh collision was not evaluated.';
  if (failed.length > 0) {
    return `Position reached. Rejected: ${failed.join('; ')}. Mesh collision was not evaluated.`;
  }
  return 'Candidate. The implemented geometric checks passed. Mesh collision was not evaluated. This is not a validated drawing pose and it was not tested in MuJoCo.';
}

function largestCandidateRegion(cells: readonly WorkspaceCell[], columns: number, rows: number): number {
  const seen = new Set<number>();
  let largest = 0;
  for (let index = 0; index < cells.length; index += 1) {
    if (seen.has(index) || cells[index]?.kind !== 'candidate') continue;
    let size = 0;
    const stack = [index];
    seen.add(index);
    while (stack.length > 0) {
      const current = stack.pop();
      if (current === undefined) continue;
      size += 1;
      const column = current % columns;
      const row = Math.floor(current / columns);
      const neighbors = [
        column > 0 ? current - 1 : -1,
        column + 1 < columns ? current + 1 : -1,
        row > 0 ? current - columns : -1,
        row + 1 < rows ? current + columns : -1,
      ];
      for (const next of neighbors) {
        if (next < 0 || seen.has(next) || cells[next]?.kind !== 'candidate') continue;
        seen.add(next);
        stack.push(next);
      }
    }
    largest = Math.max(largest, size);
  }
  return largest;
}

function span(values: number[]): AngleSpan | null {
  if (values.length === 0) return null;
  const sorted = values.slice().sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  const median = sorted.length % 2 === 1 ? sorted[mid] ?? 0 : ((sorted[mid - 1] ?? 0) + (sorted[mid] ?? 0)) / 2;
  return { min: sorted[0] ?? 0, median, max: sorted[sorted.length - 1] ?? 0 };
}

export function rankWorkspaceCandidates(found: readonly WorkspaceCandidate[]): WorkspaceCandidate[] {
  return found.slice().sort((a, b) => {
    if (b.summary.largestRegion !== a.summary.largestRegion) return b.summary.largestRegion - a.summary.largestRegion;
    if (b.summary.candidate !== a.summary.candidate) return b.summary.candidate - a.summary.candidate;
    return (b.summary.minCandidateClearanceM ?? -1) - (a.summary.minCandidateClearanceM ?? -1);
  });
}

function clampColumns(columns: number): number {
  if (!Number.isFinite(columns)) return 6;
  return Math.min(8, Math.max(4, Math.round(columns)));
}

function unit(direction: Vec3): Vec3 {
  const length = Math.hypot(direction[0], direction[1], direction[2]);
  if (length < 1e-9) return [0, 0, -1];
  return [direction[0] / length, direction[1] / length, direction[2] / length];
}
