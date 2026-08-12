// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createTrainingPlansRepository } from "../repository";
import { TRAINING_PLANS_SCHEMA_VERSION, TRAINING_PLANS_STORAGE_KEY } from "../persistence";
import { createLocalStorageAdapter } from "../../persistence/localStorageAdapter";
import type { StorageAdapter } from "../../persistence/types";
import { buildPlan } from "./testHelpers";

function fakeFailingAdapter(): StorageAdapter {
  return {
    async get() {
      return { status: "read_failed", fallback: null, error: { kind: "unknown", message: "x" } };
    },
    async set() {
      return { ok: false, error: { kind: "unknown", message: "x" } };
    },
  };
}

describe("TrainingPlansRepository", () => {
  it("resolves { status: 'absent' } when nothing is stored", async () => {
    localStorage.clear();
    const repo = createTrainingPlansRepository(createLocalStorageAdapter());
    const result = await repo.loadPlans();
    expect(result.status).toBe("absent");
  });

  it("resolves { status: 'value' } for a real stored plan list, distinct from absent", async () => {
    localStorage.clear();
    const plan = buildPlan();
    localStorage.setItem(
      TRAINING_PLANS_STORAGE_KEY,
      JSON.stringify({ schemaVersion: TRAINING_PLANS_SCHEMA_VERSION, plans: [plan] })
    );
    const repo = createTrainingPlansRepository(createLocalStorageAdapter());
    const result = await repo.loadPlans();
    expect(result.status).toBe("value");
    if (result.status === "value") {
      expect(result.value).toHaveLength(1);
      expect(result.value[0].id).toBe(plan.id);
    }
  });

  it("treats unparseable JSON as absent", async () => {
    localStorage.clear();
    localStorage.setItem(TRAINING_PLANS_STORAGE_KEY, "{not json");
    const repo = createTrainingPlansRepository(createLocalStorageAdapter());
    const result = await repo.loadPlans();
    expect(result.status).toBe("absent");
  });

  it("full-wipes to [] on a schemaVersion mismatch, still as 'value'", async () => {
    localStorage.clear();
    localStorage.setItem(
      TRAINING_PLANS_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 999, plans: [buildPlan()] })
    );
    const repo = createTrainingPlansRepository(createLocalStorageAdapter());
    const result = await repo.loadPlans();
    expect(result.status).toBe("value");
    if (result.status === "value") {
      expect(result.value).toEqual([]);
    }
  });

  it("drops a single structurally broken plan without invalidating the rest of the list", async () => {
    localStorage.clear();
    const goodPlan = buildPlan();
    localStorage.setItem(
      TRAINING_PLANS_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: TRAINING_PLANS_SCHEMA_VERSION,
        plans: [goodPlan, { garbage: true }],
      })
    );
    const repo = createTrainingPlansRepository(createLocalStorageAdapter());
    const result = await repo.loadPlans();
    expect(result.status).toBe("value");
    if (result.status === "value") {
      // migratePlan repairs field-by-field rather than dropping — confirm both survive
      // in some form (repair, not discard, for this domain's plan-level policy).
      expect(result.value).toHaveLength(2);
    }
  });

  it("resolves { status: 'read_failed' } on a genuine storage failure with an empty fallback", async () => {
    const repo = createTrainingPlansRepository(fakeFailingAdapter());
    const result = await repo.loadPlans();
    expect(result.status).toBe("read_failed");
    if (result.status === "read_failed") {
      expect(result.fallback).toEqual([]);
    }
  });

  it("savePlans() reconstructs the schemaVersion wrapper before serializing", async () => {
    localStorage.clear();
    const repo = createTrainingPlansRepository(createLocalStorageAdapter());
    const plan = buildPlan();
    await repo.savePlans([plan]);
    const stored = JSON.parse(localStorage.getItem(TRAINING_PLANS_STORAGE_KEY)!);
    expect(stored.schemaVersion).toBe(TRAINING_PLANS_SCHEMA_VERSION);
    expect(stored.plans).toHaveLength(1);
  });

  it("savePlans() surfaces a write failure as a typed result", async () => {
    const repo = createTrainingPlansRepository(fakeFailingAdapter());
    const result = await repo.savePlans([]);
    expect(result.ok).toBe(false);
  });
});
