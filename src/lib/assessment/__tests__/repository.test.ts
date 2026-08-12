// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { createAssessmentRepository } from "../repository";
import {
  ASSESSMENT_PERSISTENCE_SCHEMA_VERSION,
  ASSESSMENT_STORAGE_KEY,
  createEmptyAssessmentPersistedState,
} from "../persistence";
import { createLocalStorageAdapter } from "../../persistence/localStorageAdapter";
import type { StorageAdapter } from "../../persistence/types";
import { createTestRun } from "./testHelpers";

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

describe("AssessmentRepository", () => {
  it("resolves { status: 'absent' } when nothing is stored", async () => {
    localStorage.clear();
    const repo = createAssessmentRepository(createLocalStorageAdapter());
    const result = await repo.loadState();
    expect(result.status).toBe("absent");
  });

  it("resolves { status: 'value' } with the migrated state for a real stored value, distinct from absent", async () => {
    localStorage.clear();
    const state = {
      schemaVersion: ASSESSMENT_PERSISTENCE_SCHEMA_VERSION,
      history: [createTestRun()],
    };
    localStorage.setItem(ASSESSMENT_STORAGE_KEY, JSON.stringify(state));
    const repo = createAssessmentRepository(createLocalStorageAdapter());
    const result = await repo.loadState();
    expect(result.status).toBe("value");
    if (result.status === "value") {
      expect(result.value.state.history).toHaveLength(1);
      expect(result.value.currentRunQuarantined).toBe(false);
    }
  });

  it("treats unparseable JSON as absent, matching today's shortcut exactly", async () => {
    localStorage.clear();
    localStorage.setItem(ASSESSMENT_STORAGE_KEY, "{not json");
    const repo = createAssessmentRepository(createLocalStorageAdapter());
    const result = await repo.loadState();
    expect(result.status).toBe("absent");
  });

  it("resolves an unrecognized schemaVersion to the fresh empty state, still as 'value'", async () => {
    localStorage.clear();
    localStorage.setItem(
      ASSESSMENT_STORAGE_KEY,
      JSON.stringify({ schemaVersion: 999, history: [] })
    );
    const repo = createAssessmentRepository(createLocalStorageAdapter());
    const result = await repo.loadState();
    expect(result.status).toBe("value");
    if (result.status === "value") {
      expect(result.value.state).toEqual(createEmptyAssessmentPersistedState());
    }
  });

  it("surfaces the quarantine-notice signal when a raw currentRun failed validation", async () => {
    localStorage.clear();
    localStorage.setItem(
      ASSESSMENT_STORAGE_KEY,
      JSON.stringify({
        schemaVersion: ASSESSMENT_PERSISTENCE_SCHEMA_VERSION,
        currentRun: { garbage: true },
        history: [],
      })
    );
    const repo = createAssessmentRepository(createLocalStorageAdapter());
    const result = await repo.loadState();
    expect(result.status).toBe("value");
    if (result.status === "value") {
      expect(result.value.state.currentRun).toBeUndefined();
      expect(result.value.currentRunQuarantined).toBe(true);
    }
  });

  it("resolves { status: 'read_failed' } on a genuine storage failure with a safe fallback", async () => {
    const repo = createAssessmentRepository(fakeFailingAdapter());
    const result = await repo.loadState();
    expect(result.status).toBe("read_failed");
    if (result.status === "read_failed") {
      expect(result.fallback.currentRunQuarantined).toBe(false);
      expect(result.fallback.state).toEqual(createEmptyAssessmentPersistedState());
    }
  });

  it("saveState() performs a full overwrite", async () => {
    localStorage.clear();
    const repo = createAssessmentRepository(createLocalStorageAdapter());
    const state = { schemaVersion: ASSESSMENT_PERSISTENCE_SCHEMA_VERSION, history: [createTestRun()] };
    await repo.saveState(state);
    expect(JSON.parse(localStorage.getItem(ASSESSMENT_STORAGE_KEY)!).history).toHaveLength(1);
  });

  it("saveState() surfaces a write failure as a typed result", async () => {
    const repo = createAssessmentRepository(fakeFailingAdapter());
    const result = await repo.saveState(createEmptyAssessmentPersistedState());
    expect(result.ok).toBe(false);
  });
});
