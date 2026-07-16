// Assessment Run creation and the Run Status state machine — centralized
// transition validation, no status logic scattered across call sites (see
// docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md sections 5/17).
import { err, ok, type AssessmentOutcome } from "./errors";
import { isRunCompletable } from "./progress";
import { validateThresholdValues } from "./thresholds";
import {
  ASSESSMENT_RUN_SCHEMA_VERSION,
  type AccuracyThresholdSet,
  type AssessmentRun,
  type AssessmentRunStatus,
  type AssessmentTemplate,
  type AssessmentTimingProviderSnapshot,
} from "./types";

/** Deep clone — a run's template snapshot must never share a mutable reference with its source template. */
function cloneTemplateSnapshot(template: AssessmentTemplate): AssessmentTemplate {
  return JSON.parse(JSON.stringify(template)) as AssessmentTemplate;
}

export type CreateAssessmentRunOptions = {
  timingProviderSnapshot: AssessmentTimingProviderSnapshot;
  notes?: string;
};

/**
 * Creates a new AssessmentRun in "not_started" status. A threshold set must
 * be explicitly provided — this function never silently picks a default (see
 * docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 5). Returns a
 * structured error for a missing or invalid threshold set rather than
 * throwing, since that is an ordinary, expected caller mistake (e.g. an
 * athlete-entered Custom threshold that failed validation).
 */
export function createAssessmentRun(
  template: AssessmentTemplate,
  thresholdSet: AccuracyThresholdSet | undefined,
  options: CreateAssessmentRunOptions
): AssessmentOutcome<AssessmentRun> {
  if (!thresholdSet) {
    return err(
      "invalid_threshold_set",
      "A threshold set must be explicitly provided to create an Assessment Run."
    );
  }

  const validation = validateThresholdValues(thresholdSet.values.onTarget, thresholdSet.values.acceptable);
  if (!validation.valid) {
    return err(
      "invalid_threshold_set",
      `The provided threshold set is invalid: ${validation.issues.join(", ")}`
    );
  }

  const now = new Date().toISOString();

  const run: AssessmentRun = {
    id: crypto.randomUUID(),
    templateId: template.id,
    templateVersion: template.version,
    templateSnapshot: cloneTemplateSnapshot(template),
    status: "not_started",
    createdAt: now,
    currentPlannedShotIndex: 0,
    attempts: [],
    protocolDeviations: [],
    interruption: { interruptionCount: 0, resumedAfterReload: false },
    timingProviderSnapshot: { ...options.timingProviderSnapshot },
    thresholdSnapshot: { ...thresholdSet, values: { ...thresholdSet.values } },
    notes: options.notes,
    schemaVersion: ASSESSMENT_RUN_SCHEMA_VERSION,
  };

  return ok(run);
}

const ALLOWED_TRANSITIONS: Record<AssessmentRunStatus, AssessmentRunStatus[]> = {
  not_started: ["warmup"],
  warmup: ["in_progress", "incomplete"],
  in_progress: ["paused", "completed", "incomplete"],
  paused: ["in_progress", "incomplete"],
  completed: [],
  incomplete: [],
};

export function canTransitionAssessmentRunStatus(
  from: AssessmentRunStatus,
  to: AssessmentRunStatus
): boolean {
  return ALLOWED_TRANSITIONS[from].includes(to);
}

export type TransitionAssessmentRunOptions = {
  at?: string;
};

/**
 * The single, centralized Run Status transition function. A completed or
 * incomplete run can never transition again (terminal states — see
 * docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 17).
 * Transitioning to "completed" additionally requires every scored planned
 * shot to already have a valid attempt (`isRunCompletable`).
 */
export function transitionAssessmentRun(
  run: AssessmentRun,
  to: AssessmentRunStatus,
  options: TransitionAssessmentRunOptions = {}
): AssessmentOutcome<AssessmentRun> {
  if (run.status === "completed") {
    return err("run_already_completed", "This Assessment Run has already been completed and cannot change status.");
  }
  if (run.status === "incomplete") {
    return err("run_already_incomplete", "This Assessment Run has already been marked incomplete and cannot change status.");
  }

  if (!canTransitionAssessmentRunStatus(run.status, to)) {
    return err(
      "invalid_status_transition",
      `Cannot transition an Assessment Run from "${run.status}" to "${to}".`
    );
  }

  if (to === "completed" && !isRunCompletable(run)) {
    return err(
      "run_not_completable",
      "All scored planned shots need a valid attempt before an Assessment Run can be completed."
    );
  }

  const at = options.at ?? new Date().toISOString();

  const next: AssessmentRun = { ...run, status: to };

  switch (to) {
    case "warmup":
      next.startedAt = run.startedAt ?? at;
      break;
    case "in_progress":
      next.pausedAt = undefined;
      break;
    case "paused":
      next.pausedAt = at;
      break;
    case "completed":
      next.completedAt = at;
      next.pausedAt = undefined;
      break;
    case "incomplete":
      next.pausedAt = undefined;
      break;
    case "not_started":
      break;
  }

  return ok(next);
}

/**
 * Pauses a run regardless of whether it is currently "warmup" or
 * "in_progress" — the one composed transition Phase B's Pause action needs.
 * `ALLOWED_TRANSITIONS` deliberately has no direct "warmup" -> "paused" edge
 * (only "in_progress" -> "paused"), since pausing collapses the warm-up/
 * scored distinction into one "active" lifecycle; the UI itself never reads
 * status to tell warm-up and scored apart (see `isWarmupComplete` in
 * progress.ts) specifically because of this. This composes two already-legal
 * transitions ("warmup" -> "in_progress" -> "paused") rather than adding a
 * new edge to the table, so it can never leave a run in an
 * otherwise-unreachable state.
 */
export function pauseAssessmentRun(
  run: AssessmentRun,
  options: TransitionAssessmentRunOptions = {}
): AssessmentOutcome<AssessmentRun> {
  if (run.status === "warmup") {
    const advanced = transitionAssessmentRun(run, "in_progress", options);
    if (!advanced.ok) return advanced;
    return transitionAssessmentRun(advanced.value, "paused", options);
  }
  return transitionAssessmentRun(run, "paused", options);
}
