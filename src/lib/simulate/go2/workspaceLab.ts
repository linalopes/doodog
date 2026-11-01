/**
 * Draft brush mount and paper placement for the geometric lab.
 *
 * The draft is not the baseline, and it is not written into the MuJoCo
 * experiment. Applying a candidate changes only this preview. Restore puts
 * the draft back on the default mount and the default sheet.
 */

import { get, writable } from 'svelte/store';
import type { BrushCalibration } from './brush.ts';
import { followTimeline, kinematicPose, previewFrontLeft } from './settings.ts';
import type { Vec3 } from './math.ts';
import { coarseGroundQueries, refineGroundQueries, solveGroundQuery, rankGroundCandidates } from './ground.ts';
import {
  SEARCH_COLUMNS,
  WORKSPACE_TOLERANCE_DEG,
  defaultWorkspaceQuery,
  evaluateCreativeScore,
  fillWorkspaceRows,
  loadExampleFrames,
  rankWorkspaceCandidates,
  searchSpecs,
  searchStep,
  summarizeWorkspace,
  workspaceSnapshot,
  type ScoreEvaluation,
  type WorkspaceCandidate,
  type WorkspaceCell,
  type WorkspaceQuery,
  type WorkspaceSummary,
} from './workspace.ts';

export interface WorkspaceLabState {
  query: WorkspaceQuery;
  /** True while the viewport is showing this draft instead of the baseline mount and sheet. */
  preview: boolean;
  sampling: boolean;
  summary: WorkspaceSummary | null;
  selected: number | null;
  searchRunning: boolean;
  searchExamined: number;
  searchPlanned: number;
  searchCancelled: boolean;
  searchResults: WorkspaceCandidate[];
  searchKind: 'historical' | 'ground';
  scores: ScoreEvaluation[];
  notice: string;
}

const initialQuery = defaultWorkspaceQuery();

export const workspaceLab = writable<WorkspaceLabState>({
  query: initialQuery,
  preview: false,
  sampling: false,
  summary: null,
  selected: null,
  searchRunning: false,
  searchExamined: 0,
  searchPlanned: searchSpecs().length,
  searchCancelled: false,
  searchResults: [],
  searchKind: 'historical',
  scores: [],
  notice: 'Baseline mount and sheet. The preview has not been changed.',
});

let sampleToken = 0;
let searchToken = 0;

export function labQuery(): WorkspaceQuery {
  return get(workspaceLab).query;
}

export function setLabQuery(patch: Partial<Omit<WorkspaceQuery, 'calibration'>> & { calibration?: Partial<BrushCalibration> }): void {
  workspaceLab.update((state) => {
    const calibration = { ...state.query.calibration, ...patch.calibration };
    if (patch.calibration?.mountOffset) calibration.mountOffset = patch.calibration.mountOffset;
    const query: WorkspaceQuery = {
      ...state.query,
      ...patch,
      calibration,
    };
    return {
      ...state,
      query,
      preview: true,
      selected: null,
      scores: [],
      notice: 'Draft geometry. It is not the baseline, and the MuJoCo controller was not changed.',
    };
  });
  scheduleSample();
}

export function selectWorkspaceCell(index: number | null): void {
  workspaceLab.update((state) => ({ ...state, selected: index }));
}

export function showSelectedPose(): void {
  const state = get(workspaceLab);
  const cell = state.selected !== null ? state.summary?.cells[state.selected] : undefined;
  if (!cell?.joints) return;
  previewFrontLeft(cell.joints, get(kinematicPose)?.joints ?? null);
  workspaceLab.update((current) => ({
    ...current,
    notice: 'The front-left joints show the selected sample. Follow timeline restores the score.',
  }));
}

export function applyCandidate(candidate: WorkspaceCandidate): void {
  searchToken += 1;
  workspaceLab.update((state) => ({
    ...state,
    query: {
      calibration: {
        mountOffset: [...candidate.calibration.mountOffset] as Vec3,
        rollRad: candidate.calibration.rollRad,
        pitchRad: candidate.calibration.pitchRad,
        yawRad: candidate.calibration.yawRad,
        lengthM: candidate.calibration.lengthM,
      },
      origin: [...candidate.origin] as Vec3,
      yawRad: candidate.yawRad,
      toleranceDeg: WORKSPACE_TOLERANCE_DEG,
      columns: SEARCH_COLUMNS,
      boardThicknessM: candidate.boardThicknessM,
    },
    preview: true,
    searchRunning: false,
    selected: null,
    scores: [],
    notice: 'Candidate applied to the geometric preview only. MuJoCo was not changed and has not tested this mount.',
  }));
  scheduleSample();
}

export function restoreBaseline(): void {
  sampleToken += 1;
  searchToken += 1;
  followTimeline();
  workspaceLab.set({
    query: defaultWorkspaceQuery(),
    preview: false,
    sampling: false,
    summary: null,
    selected: null,
    searchRunning: false,
    searchExamined: 0,
    searchPlanned: searchSpecs().length,
    searchCancelled: false,
    searchResults: get(workspaceLab).searchResults,
    searchKind: get(workspaceLab).searchKind,
    scores: [],
    notice: 'Baseline restored. The default mount and the sheet at (0.30, 0, 0) m are showing. MuJoCo was not changed.',
  });
}

export function resetDraftToDefault(): void {
  const columns = get(workspaceLab).query.columns;
  workspaceLab.update((state) => ({
    ...state,
    query: { ...defaultWorkspaceQuery(), columns },
    preview: true,
    selected: null,
    scores: [],
    notice: 'Draft reset to the default mount and sheet. This did not change the stored baseline or MuJoCo.',
  }));
  scheduleSample();
}

export function scheduleSample(): void {
  const token = ++sampleToken;
  const query = get(workspaceLab).query;
  const columns = query.columns;
  const cells: WorkspaceCell[] = new Array(columns * columns);
  workspaceLab.update((state) => ({
    ...state,
    sampling: true,
    preview: true,
    notice: state.preview
      ? state.notice
      : 'The geometric preview is showing this draft. The stored baseline and the MuJoCo controller were not changed.',
  }));
  let row = 0;
  const step = (): void => {
    if (token !== sampleToken) return;
    fillWorkspaceRows(cells, get(workspaceLab).query, row, row + 1);
    row += 1;
    if (row < columns) {
      setTimeout(step, 0);
      return;
    }
    if (token !== sampleToken) return;
    const summary = summarizeWorkspace(cells, columns);
    workspaceLab.update((state) => ({
      ...state,
      sampling: false,
      summary,
      notice: state.notice,
    }));
  };
  setTimeout(step, 0);
}

export function startGroundSearch(): void {
  const token = ++searchToken;
  const coarse = coarseGroundQueries();
  const found: WorkspaceCandidate[] = [];
  workspaceLab.update((state) => ({
    ...state,
    searchRunning: true,
    searchCancelled: false,
    searchExamined: 0,
    searchPlanned: coarse.length,
    searchResults: [],
    searchKind: 'ground',
    notice: `Ground sheet search: ${coarse.length} coarse configurations, then a local refinement. Thickness 0, 3, 5 and 8 mm. Shaft 45, 80 and 100 mm. Pitch −90, −45 and 0°. Paper centres (300, 0), (240, 80) and (180, 140) mm. This is not a global optimum and not a hardware dimension.`,
  }));
  let index = 0;
  let refined: WorkspaceQuery[] = [];
  let refining = false;
  const step = (): void => {
    if (token !== searchToken) return;
    if (!refining && index >= coarse.length) {
      const best = rankGroundCandidates(found)[0];
      refined = best ? refineGroundQueries(best) : [];
      refining = true;
      index = 0;
      workspaceLab.update((state) => ({
        ...state,
        searchPlanned: coarse.length + refined.length,
        searchExamined: found.length,
        notice: `Coarse sample finished. Refining ${refined.length} configurations around the leading result.`,
      }));
    }
    const query = refining ? refined[index] : coarse[index];
    if (!query) {
      finish(false);
      return;
    }
    found.push(solveGroundQuery(query));
    index += 1;
    workspaceLab.update((state) => ({
      ...state,
      searchExamined: found.length,
      searchPlanned: coarse.length + (refining ? refined.length : 0),
      searchResults: rankGroundCandidates(found),
    }));
    if (token !== searchToken) {
      finish(true);
      return;
    }
    setTimeout(step, 0);
  };
  const finish = (cancelled: boolean): void => {
    const ranked = rankGroundCandidates(found);
    const promising = ranked.filter((item) => item.summary.largestRegion > 0).length;
    workspaceLab.update((state) => ({
      ...state,
      searchRunning: false,
      searchCancelled: cancelled,
      searchExamined: found.length,
      searchResults: ranked,
      searchKind: 'ground',
      notice: cancelled
        ? `Ground search cancelled after ${found.length} configurations.`
        : `Ground search finished ${found.length} configurations. ${promising} have a connected candidate region. Mesh collision was not evaluated. MuJoCo has not tested them.`,
    }));
  };
  setTimeout(step, 0);
}

export function startCandidateSearch(): void {
  const token = ++searchToken;
  const planned = searchSpecs().length;
  const found: WorkspaceCandidate[] = [];
  workspaceLab.update((state) => ({
    ...state,
    searchRunning: true,
    searchCancelled: false,
    searchExamined: 0,
    searchPlanned: planned,
    searchResults: [],
    searchKind: 'historical',
    notice: `Searching ${planned} documented configurations on a ${SEARCH_COLUMNS}×${SEARCH_COLUMNS} sheet sample. This is not a global optimum.`,
  }));
  let index = 0;
  const step = (): void => {
    if (token !== searchToken) return;
    const outcome = searchStep(index, SEARCH_COLUMNS);
    if (outcome === 'cancelled' || outcome === 'done') {
      finish(found, false);
      return;
    }
    found.push(outcome);
    index += 1;
    const ranked = rankWorkspaceCandidates(found);
    workspaceLab.update((state) => ({
      ...state,
      searchExamined: index,
      searchResults: ranked,
    }));
    if (index >= planned || token !== searchToken) {
      finish(found, token !== searchToken);
      return;
    }
    setTimeout(step, 0);
  };
  const finish = (results: WorkspaceCandidate[], cancelled: boolean): void => {
    if (token !== searchToken && !cancelled) return;
    const ranked = rankWorkspaceCandidates(results);
    const any = ranked.some((item) => item.summary.candidate > 0);
    workspaceLab.update((state) => ({
      ...state,
      searchRunning: false,
      searchCancelled: cancelled,
      searchExamined: results.length,
      searchResults: ranked,
      notice: cancelled
        ? `Search cancelled after ${results.length} of ${planned} configurations.`
        : any
          ? `Search finished ${results.length} configurations. Candidates below passed only the implemented geometric checks.`
          : `Search finished ${results.length} configurations. None produced a candidate on this sample.`,
    }));
  };
  setTimeout(step, 0);
}

export function cancelCandidateSearch(): void {
  if (!get(workspaceLab).searchRunning) return;
  searchToken += 1;
  workspaceLab.update((state) => ({
    ...state,
    searchRunning: false,
    searchCancelled: true,
    notice: `Search cancelled after ${state.searchExamined} of ${state.searchPlanned} configurations.`,
  }));
}

export function evaluateLabScore(id: string): void {
  const query = get(workspaceLab).query;
  const frames = loadExampleFrames(id);
  const score = evaluateCreativeScore(id, frames, { width: 600, height: 600 }, query);
  workspaceLab.update((state) => ({
    ...state,
    scores: [...state.scores.filter((item) => item.id !== id), score],
  }));
}

export function labSnapshotJson(): string {
  const state = get(workspaceLab);
  const summary = state.summary ?? emptySummary(state.query.columns);
  return JSON.stringify(workspaceSnapshot(state.query, summary), null, 2);
}

function emptySummary(columns: number): WorkspaceSummary {
  return {
    columns,
    rows: columns,
    examined: 0,
    unreachable: 0,
    postureInvalid: 0,
    candidate: 0,
    indeterminate: 0,
    largestRegion: 0,
    candidateFraction: 0,
    reachedAngle: null,
    candidateAngle: null,
    minCandidateClearanceM: null,
    mesh: 'not-evaluated',
    mujocoTested: false,
    cells: [],
  };
}
