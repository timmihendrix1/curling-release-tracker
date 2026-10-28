import type { Session } from "../types";
import type { AssessmentPersistedState } from "./assessment/persistence";
import type { ProductEvent } from "./productAnalytics";

export type PrepareProductEvent = (event: ProductEvent, key: string) => () => void;

/** Observes explicit commits only. Hydration/restore never calls these functions. */
export function createProductTransitionObserver(prepare: PrepareProductEvent) {
  const completions = new Map<string, () => void>();
  const assessmentCompletions = new Map<string, () => void>();
  function sessionCommit(previous: Session | null, next: Session) {
    const meaningful = (session: Session | null) => !!session && (session.blocks.length > 0 || !!session.exerciseExecutions?.length || session.shots.length > 0);
    if (previous?.id === next.id && !meaningful(previous) && meaningful(next)) prepare("training_started", next.id)();
    if (next.planExecution && previous?.planExecution !== next.planExecution && previous?.planExecution?.sourcePlanId !== next.planExecution.sourcePlanId) prepare("training_plan_started", `${next.id}:${next.planExecution.sourcePlanId}`)();
    const old = new Map(previous?.exerciseExecutions?.map(execution => [execution.id, execution]) ?? []);
    for (const execution of next.exerciseExecutions ?? []) {
      if (!old.has(execution.id)) prepare("exercise_started", execution.id)();
      if (execution.status === "completed" && old.get(execution.id)?.status !== "completed" && old.has(execution.id)) {
        completions.set(execution.id, prepare("exercise_completed", execution.id));
      }
    }
    if (next.releaseTimingExerciseVersionSnapshot && !previous?.releaseTimingExerciseVersionSnapshot) prepare("exercise_started", `${next.id}:timing`)();
  }
  return {
    sessionCommit,
    sessionSaved(saved: Session) {
      for (const execution of saved.exerciseExecutions ?? []) {
        if (execution.status !== "completed") continue;
        completions.get(execution.id)?.();
        completions.delete(execution.id);
      }
    },
    assessmentCommit(previous: AssessmentPersistedState, next: AssessmentPersistedState) {
      const run = next.currentRun;
      if (run && run.startedAt && (!previous.currentRun || previous.currentRun.id !== run.id || !previous.currentRun.startedAt)) prepare("assessment_started", run.id)();
      const before = new Set(previous.history.map(item => item.id));
      for (const completed of next.history) {
        if (completed.status === "completed" && !before.has(completed.id)) assessmentCompletions.set(completed.id, prepare("assessment_completed", completed.id));
      }
    },
    assessmentSaved(saved: AssessmentPersistedState) {
      for (const run of saved.history) {
        if (run.status !== "completed") continue;
        assessmentCompletions.get(run.id)?.();
        assessmentCompletions.delete(run.id);
      }
    },
  };
}
