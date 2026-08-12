// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  createHistoryFiltersRepository,
  HISTORY_FILTERS_STORAGE_KEY,
} from "../historyFiltersRepository";
import { createDefaultHistoryFilters } from "../historyAnalysis";
import { createLocalStorageAdapter } from "../persistence/localStorageAdapter";
import type { StorageAdapter } from "../persistence/types";

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

describe("HistoryFiltersRepository", () => {
  it("resolves { status: 'absent' } when nothing is stored", async () => {
    localStorage.clear();
    const repo = createHistoryFiltersRepository(createLocalStorageAdapter());
    const result = await repo.load();
    expect(result.status).toBe("absent");
  });

  it("resolves { status: 'value' } for a real stored filters object, distinct from absent", async () => {
    localStorage.clear();
    const filters = createDefaultHistoryFilters();
    localStorage.setItem(HISTORY_FILTERS_STORAGE_KEY, JSON.stringify(filters));
    const repo = createHistoryFiltersRepository(createLocalStorageAdapter());
    const result = await repo.load();
    expect(result.status).toBe("value");
  });

  it("treats unparseable JSON as absent, matching today's try/catch-to-defaults behavior", async () => {
    localStorage.clear();
    localStorage.setItem(HISTORY_FILTERS_STORAGE_KEY, "{not json");
    const repo = createHistoryFiltersRepository(createLocalStorageAdapter());
    const result = await repo.load();
    expect(result.status).toBe("absent");
  });

  it("resolves { status: 'read_failed' } on a genuine storage failure with a default fallback", async () => {
    const repo = createHistoryFiltersRepository(fakeFailingAdapter());
    const result = await repo.load();
    expect(result.status).toBe("read_failed");
    if (result.status === "read_failed") {
      expect(result.fallback).toEqual(createDefaultHistoryFilters());
    }
  });

  it("save() performs a full overwrite", async () => {
    localStorage.clear();
    const repo = createHistoryFiltersRepository(createLocalStorageAdapter());
    const filters = { ...createDefaultHistoryFilters(), trainingCategory: "fixed" as const };
    await repo.save(filters);
    expect(JSON.parse(localStorage.getItem(HISTORY_FILTERS_STORAGE_KEY)!)).toEqual(filters);
  });

  it("save() surfaces a write failure as a typed result", async () => {
    const repo = createHistoryFiltersRepository(fakeFailingAdapter());
    const result = await repo.save(createDefaultHistoryFilters());
    expect(result.ok).toBe(false);
  });
});
