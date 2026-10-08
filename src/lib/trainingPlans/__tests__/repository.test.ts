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

  it("treats unparseable JSON as UNREADABLE, not absent (ADR-0051)", async () => {
    // Absence hands the application an empty but writable library, which its ordinary
    // save effect writes straight back — replacing bytes that may still be
    // recoverable (a truncated write, a partially synced file) with an empty library.
    localStorage.clear();
    localStorage.setItem(TRAINING_PLANS_STORAGE_KEY, "{not json");
    const repo = createTrainingPlansRepository(createLocalStorageAdapter());
    const result = await repo.loadPlans();
    expect(result.status).toBe("read_failed");
    expect(localStorage.getItem(TRAINING_PLANS_STORAGE_KEY)).toBe("{not json");
  });

  it("protects an unsupported schemaVersion instead of full-wiping it (ADR-0051)", async () => {
    // The previous full-wipe gate returned an empty but *writable* library, which the
    // ordinary save effect then wrote back — permanently discarding plans a newer
    // build had written. Unreadable storage is now a protected failure, and the
    // stored bytes are left exactly as they were.
    localStorage.clear();
    const stored = JSON.stringify({ schemaVersion: 999, plans: [buildPlan()] });
    localStorage.setItem(TRAINING_PLANS_STORAGE_KEY, stored);
    const repo = createTrainingPlansRepository(createLocalStorageAdapter());
    const result = await repo.loadPlans();
    expect(result.status).toBe("read_failed");
    expect(localStorage.getItem(TRAINING_PLANS_STORAGE_KEY)).toBe(stored);
  });

  it("protects the library when a stored plan is structurally unreadable (ADR-0051)", async () => {
    // A plan object with no identity, name or step list is not something migration may
    // quietly repair into a fabricated plan, nor something the loader may shorten the
    // library by dropping: either outcome is then written back over the original.
    localStorage.clear();
    const goodPlan = buildPlan();
    const stored = JSON.stringify({
      schemaVersion: TRAINING_PLANS_SCHEMA_VERSION,
      plans: [goodPlan, { garbage: true }],
    });
    localStorage.setItem(TRAINING_PLANS_STORAGE_KEY, stored);

    const repo = createTrainingPlansRepository(createLocalStorageAdapter());
    const result = await repo.loadPlans();

    expect(result.status).toBe("read_failed");
    expect(localStorage.getItem(TRAINING_PLANS_STORAGE_KEY)).toBe(stored);
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
