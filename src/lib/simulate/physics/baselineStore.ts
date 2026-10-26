import { writable } from 'svelte/store';
import type { EvaluationSummary, ExecutionIdentity } from './evaluation.ts';

export interface KeptRun {
  summary: EvaluationSummary;
  identity: ExecutionIdentity;
  label: string;
}

/** Session memory only. A new page load does not restore a baseline. */
export const keptBaseline = writable<KeptRun | null>(null);
