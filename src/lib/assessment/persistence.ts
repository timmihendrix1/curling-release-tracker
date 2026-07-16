// Assessment persistence — its own root state and its own LocalStorage key,
// deliberately separate from Session/Session History (see
// docs/adr/0010-assessment-domain-foundation.md for the "Option A: own key"
// decision and rationale). No LocalStorage access happens in this file —
// these are pure state-shape functions; a future UI integration (Phase B)
// is responsible for the actual read/write call sites, following the same
// one-effect-per-key pattern TrackerApp.tsx already uses for Session data.
import { err, ok, type AssessmentOutcome } from "./errors";
import type { AssessmentRun } from "./types";

export const ASSESSMENT_STORAGE_KEY = "curling-release-tracker-assessment-data";
export const ASSESSMENT_PERSISTENCE_SCHEMA_VERSION = 1;

/**
 * The persisted root shape: a schema version, at most one active (current)
 * run, and the history of terminal (completed/incomplete) runs. No derived
 * analytics are stored here — only raw, regenerable-from-source data (see
 * docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 2).
 */
export type AssessmentPersistedState = {
  schemaVersion: number;
  currentRun?: AssessmentRun;
  history: AssessmentRun[];
};

export function createEmptyAssessmentPersistedState(): AssessmentPersistedState {
  return { schemaVersion: ASSESSMENT_PERSISTENCE_SCHEMA_VERSION, history: [] };
}

function isTerminalRunStatus(run: AssessmentRun): boolean {
  return run.status === "completed" || run.status === "incomplete";
}

/**
 * Sets the single active (non-terminal) current run. Refuses to silently
 * overwrite a different, still-active current run — the caller must
 * explicitly archive (or otherwise resolve) it first, so one run's Attempts
 * can never be silently lost by starting another.
 */
export function setCurrentAssessmentRun(
  state: AssessmentPersistedState,
  run: AssessmentRun
): AssessmentOutcome<AssessmentPersistedState> {
  if (state.currentRun && state.currentRun.id !== run.id && !isTerminalRunStatus(state.currentRun)) {
    return err(
      "current_run_already_active",
      "Another Assessment Run is already active. Complete or abandon it before starting a new one."
    );
  }

  return ok({ ...state, currentRun: run });
}

/**
 * Moves a terminal (completed or incomplete) run from `currentRun` into
 * `history`. Idempotent: archiving a run whose ID already exists in history
 * is a safe no-op (still clears a matching `currentRun`), never creates a
 * duplicate history entry.
 */
export function archiveCurrentAssessmentRun(
  state: AssessmentPersistedState,
  run: AssessmentRun
): AssessmentOutcome<AssessmentPersistedState> {
  if (!isTerminalRunStatus(run)) {
    return err(
      "run_not_completable",
      `Only a completed or incomplete run can be archived to history (status was "${run.status}").`
    );
  }

  if (state.history.some((historyRun) => historyRun.id === run.id)) {
    return ok({
      ...state,
      currentRun: state.currentRun?.id === run.id ? undefined : state.currentRun,
    });
  }

  if (state.currentRun && state.currentRun.id !== run.id) {
    return err(
      "current_run_mismatch",
      "The run being archived does not match the currently active run."
    );
  }

  return ok({ ...state, currentRun: undefined, history: [...state.history, run] });
}

export function getAssessmentRunFromHistory(
  state: AssessmentPersistedState,
  id: string
): AssessmentRun | undefined {
  return state.history.find((run) => run.id === id);
}

export function serializeAssessmentPersistedState(state: AssessmentPersistedState): string {
  return JSON.stringify(state);
}
