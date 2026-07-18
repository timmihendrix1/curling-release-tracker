// Training Plan library persistence — its own root state and its own localStorage
// key, deliberately independent of Session/Session History (see
// docs/TRAINING_SYSTEM_AND_PLANS.md section 37 and ADR-0012). No localStorage access
// happens in this file — these are pure state-shape functions; TrackerApp.tsx is
// responsible for the actual read/write calls, following the same
// one-effect-per-key pattern already used for Session data. This module never
// touches Session.planExecution — that's a Session-level field, migrated by
// sessionMigration.ts, not the plans library.
import type { TrainingPlan, TrainingPlanStep } from "../../types";
import { err, ok, type TrainingPlanOutcome } from "./errors";

export const TRAINING_PLANS_STORAGE_KEY = "curling-release-tracker-training-plans";
export const TRAINING_PLANS_SCHEMA_VERSION = 1;

export type TrainingPlansPersistedState = {
  schemaVersion: number;
  plans: TrainingPlan[];
};

export function createEmptyTrainingPlansPersistedState(): TrainingPlansPersistedState {
  return { schemaVersion: TRAINING_PLANS_SCHEMA_VERSION, plans: [] };
}

export function addPlan(
  state: TrainingPlansPersistedState,
  plan: TrainingPlan
): TrainingPlansPersistedState {
  return { ...state, plans: [...state.plans, plan] };
}

/**
 * Replaces an existing plan's definition in place (rename, step edits, reordering,
 * ...). Never touches any Session that was already started from this plan — a
 * Session's planExecution holds its own deep-copied step snapshots, not a live
 * reference back into this list (spec invariant #2).
 */
export function updatePlan(
  state: TrainingPlansPersistedState,
  plan: TrainingPlan
): TrainingPlanOutcome<TrainingPlansPersistedState> {
  if (!state.plans.some((existing) => existing.id === plan.id)) {
    return err("plan_not_found", "This plan no longer exists.");
  }

  return ok({
    ...state,
    plans: state.plans.map((existing) => (existing.id === plan.id ? plan : existing)),
  });
}

/**
 * Removes only the reusable plan definition. Deleting an already-absent plan is a
 * safe no-op. Never removes any Session previously started from this plan, and never
 * needs to check whether an execution is currently active — a Session's
 * planExecution is fully independent of this list once created (spec section 20).
 */
export function deletePlan(
  state: TrainingPlansPersistedState,
  planId: string
): TrainingPlansPersistedState {
  return { ...state, plans: state.plans.filter((plan) => plan.id !== planId) };
}

function cloneStepForDuplication(step: TrainingPlanStep): TrainingPlanStep {
  return {
    ...step,
    id: crypto.randomUUID(),
    completion: { ...step.completion },
    handleStrategy: { ...step.handleStrategy },
    configuration: {
      ...step.configuration,
      accuracyThresholds: { ...step.configuration.accuracyThresholds },
    },
  };
}

/**
 * Creates a new, fully independent plan (new plan id, new step ids) — later edits to
 * either the original or the copy never affect the other. Per spec section 19. Does
 * not add the copy to `state` itself — callers pass the result to `addPlan`, keeping
 * this function a pure "clone one plan" operation.
 */
export function duplicatePlan(plan: TrainingPlan): TrainingPlan {
  const now = new Date().toISOString();

  return {
    ...plan,
    id: crypto.randomUUID(),
    name: `${plan.name} (Copy)`,
    steps: plan.steps.map(cloneStepForDuplication),
    createdAt: now,
    updatedAt: now,
  };
}

export function serializeTrainingPlansState(
  state: TrainingPlansPersistedState
): string {
  return JSON.stringify(state);
}
