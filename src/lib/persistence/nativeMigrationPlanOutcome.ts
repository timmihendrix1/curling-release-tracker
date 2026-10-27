// Native-migration plan outcomes — Stage M3b4a (pure decision layer).
//
// Turns the per-step outcomes an executor observed into the halt report I-9
// requires (docs/MOBILE_APP_MIGRATION.md Stage M3b0 §5.1). It executes nothing.
//
// Every write step ends CONFIRMED, OUTCOME UNKNOWN or NOT ISSUED. A rejected
// write is outcome unknown, never "did not happen": whether a store can apply a
// write and then report failure is unmeasured. A halt keeps every confirmed step,
// may include the one unknown step's effect, issues nothing after it, and never
// claims a cross-store rollback. Re-evaluation then starts from fresh durable
// evidence (I-11) — never from this report.
import type { InProcessFaultStop, LatchWriteAttempt, MigrationPlan, PlanStep } from "./nativeMigrationDecision";

export type WriteStepOutcome =
  /** Positively acknowledged. */
  | "confirmed"
  /** Issued, then rejected, failed, unanswered or interrupted. */
  | "outcome_unknown"
  /** AP-CC/AP-ACT only: the in-transaction evidence read failed or did not match, so no write was issued. */
  | "aborted_before_write";

export type ReadStepOutcome = "succeeded" | "failed";
export type RecheckStepOutcome = "passed" | "failed";
export type StepOutcome = WriteStepOutcome | ReadStepOutcome | RecheckStepOutcome;

export type Store = "source" | "target";

/**
 * What actually happened to ONE step. Every step of the plan has exactly one.
 * `failed` is a read or recheck that RAN and failed; `aborted_before_write` is an
 * AP-CC/AP-ACT transaction whose in-transaction reads ran and whose write was never
 * issued; `not_issued` is a step that never started.
 */
export type StepDisposition =
  | "confirmed"
  | "succeeded"
  | "passed"
  | "failed"
  | "outcome_unknown"
  | "aborted_before_write"
  | "not_issued";

export type PlanRunReport =
  | {
      readonly status: "completed";
      /** One disposition per plan step, in order. */
      readonly dispositions: readonly StepDisposition[];
      readonly confirmedWriteSteps: readonly number[];
      readonly possiblyChangedStores: readonly Store[];
      readonly continuation: "re_evaluate";
    }
  | {
      readonly status: "halted";
      readonly haltedAtStep: number;
      readonly cause: "write_outcome_unknown" | "read_failed" | "recheck_failed" | "aborted_before_write";
      /** One disposition per plan step, in order — the complete account of the run. */
      readonly dispositions: readonly StepDisposition[];
      /** Every step that ran to success (writes confirmed, reads succeeded, rechecks passed). */
      readonly completedSteps: readonly number[];
      /** Write steps positively acknowledged; they stay in effect. */
      readonly confirmedWriteSteps: readonly number[];
      /** The one write step whose effect is unknown, if the halt was at a write. */
      readonly unknownStep: number | null;
      /** EVERY step after the halt — writes, reads and rechecks alike. None of them ran. */
      readonly notIssuedSteps: readonly number[];
      /** Stores a confirmed or unknown write may have changed. Never "nothing changed" by assumption. */
      readonly possiblyChangedStores: readonly Store[];
      /** No later ordinary step follows a halt. */
      readonly ordinaryContinuationPermitted: false;
      readonly continuation: "re_evaluate";
    }
  | { readonly status: "invalid"; readonly problem: string };

function isWrite(step: PlanStep): boolean {
  return step.kind === "marker_write" || step.kind === "target_transaction";
}

function storeOf(step: PlanStep): Store | null {
  if (step.kind === "marker_write") return "source";
  if (step.kind === "target_transaction") return "target";
  return null;
}

function readsInside(step: PlanStep): boolean {
  return step.kind === "target_transaction" &&
    (step.transaction.op === "complete_copying" || step.transaction.op === "activate");
}

function allowed(step: PlanStep, outcome: StepOutcome): boolean {
  if (isWrite(step)) {
    return outcome === "confirmed" || outcome === "outcome_unknown" ||
      (outcome === "aborted_before_write" && readsInside(step));
  }
  if (step.kind === "read_source") return outcome === "succeeded" || outcome === "failed";
  return outcome === "passed" || outcome === "failed";
}

const SUCCESS: ReadonlySet<StepOutcome> = new Set(["confirmed", "succeeded", "passed"]);

/**
 * Summarises a run. `outcomes[i]` is step i's observed outcome, in order. The
 * sequence must stop at the first non-success outcome: an outcome reported for a
 * step after a halt is rejected as invalid, because that step was never issued.
 */
export function summarizePlanRun(plan: MigrationPlan, outcomes: readonly StepOutcome[]): PlanRunReport {
  if (outcomes.length > plan.steps.length) return { status: "invalid", problem: "more_outcomes_than_steps" };
  const dispositions: StepDisposition[] = [];
  const completed: number[] = [];
  const confirmedWrites: number[] = [];
  const changed = new Set<Store>();
  for (let index = 0; index < outcomes.length; index += 1) {
    const step = plan.steps[index];
    const outcome = outcomes[index];
    if (!allowed(step, outcome)) return { status: "invalid", problem: `outcome_not_allowed_at_step_${index}` };
    const store = storeOf(step);
    dispositions.push(outcome);
    if (SUCCESS.has(outcome)) {
      completed.push(index);
      if (store) {
        confirmedWrites.push(index);
        changed.add(store);
      }
      continue;
    }
    if (index !== outcomes.length - 1) return { status: "invalid", problem: "outcome_after_halt" };
    const unknown = outcome === "outcome_unknown";
    if (unknown && store) changed.add(store);
    const notIssued: number[] = [];
    for (let later = index + 1; later < plan.steps.length; later += 1) {
      notIssued.push(later);
      dispositions.push("not_issued");
    }
    return {
      status: "halted",
      haltedAtStep: index,
      cause: unknown
        ? "write_outcome_unknown"
        : outcome === "aborted_before_write"
          ? "aborted_before_write"
          : step.kind === "read_source"
            ? "read_failed"
            : "recheck_failed",
      dispositions,
      completedSteps: completed,
      confirmedWriteSteps: confirmedWrites,
      unknownStep: unknown ? index : null,
      notIssuedSteps: notIssued,
      possiblyChangedStores: [...changed].sort(),
      ordinaryContinuationPermitted: false,
      continuation: "re_evaluate",
    };
  }
  if (outcomes.length < plan.steps.length) return { status: "invalid", problem: "outcomes_incomplete" };
  return {
    status: "completed",
    dispositions,
    confirmedWriteSteps: confirmedWrites,
    possiblyChangedStores: [...changed].sort(),
    continuation: "re_evaluate",
  };
}

/**
 * Records one latch-write attempt (I-13). Returns a NEW stop; the in-memory stop is
 * never released, whatever the outcome — only a confirmed attempt ends further
 * attempts, and the decision bounds them by its attempt limit.
 */
export function recordLatchWriteAttempt(stop: InProcessFaultStop, outcome: LatchWriteAttempt): InProcessFaultStop {
  return Object.freeze({
    latchContent: stop.latchContent,
    latchWriteAttempts: Object.freeze([...stop.latchWriteAttempts, outcome]),
  });
}
