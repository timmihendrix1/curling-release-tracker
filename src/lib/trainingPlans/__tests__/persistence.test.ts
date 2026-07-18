import { describe, expect, it } from "vitest";
import {
  addPlan,
  createEmptyTrainingPlansPersistedState,
  deletePlan,
  duplicatePlan,
  updatePlan,
} from "../persistence";
import { buildPlan } from "./testHelpers";

describe("Training Plans persistence", () => {
  it("addPlan appends a plan to an empty state", () => {
    const plan = buildPlan();
    const state = addPlan(createEmptyTrainingPlansPersistedState(), plan);
    expect(state.plans).toEqual([plan]);
  });

  it("updatePlan replaces the matching plan by id", () => {
    const plan = buildPlan({ name: "Original" });
    const state = addPlan(createEmptyTrainingPlansPersistedState(), plan);

    const result = updatePlan(state, { ...plan, name: "Renamed" });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.plans[0].name).toBe("Renamed");
    }
  });

  it("updatePlan fails for a plan that no longer exists", () => {
    const result = updatePlan(createEmptyTrainingPlansPersistedState(), buildPlan());
    expect(result.ok).toBe(false);
  });

  it("deletePlan removes only the reusable plan definition", () => {
    const plan = buildPlan();
    const state = addPlan(createEmptyTrainingPlansPersistedState(), plan);
    const afterDelete = deletePlan(state, plan.id);
    expect(afterDelete.plans).toEqual([]);
  });

  it("deletePlan on an already-absent plan is a safe no-op", () => {
    const state = createEmptyTrainingPlansPersistedState();
    expect(deletePlan(state, "does-not-exist")).toEqual(state);
  });

  it("duplicatePlan produces an independent plan with new ids", () => {
    const plan = buildPlan({ name: "Release Consistency" });
    const copy = duplicatePlan(plan);

    expect(copy.id).not.toBe(plan.id);
    expect(copy.steps[0].id).not.toBe(plan.steps[0].id);
    expect(copy.name).toBe("Release Consistency (Copy)");

    // Later edits to either plan must not affect the other.
    copy.steps[0].configuration.targetTime = 999;
    expect(plan.steps[0].configuration.targetTime).not.toBe(999);
  });
});
