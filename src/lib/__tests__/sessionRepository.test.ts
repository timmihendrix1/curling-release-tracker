// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  createSessionRepository,
  CURRENT_SESSION_STORAGE_KEY,
  SESSION_HISTORY_STORAGE_KEY,
} from "../sessionRepository";
import { createLocalStorageAdapter } from "../persistence/localStorageAdapter";
import type { StorageAdapter } from "../persistence/types";

function fakeFailingAdapter(): StorageAdapter {
  return {
    async get() {
      return {
        status: "read_failed",
        fallback: null,
        error: { kind: "storage_unavailable" },
      };
    },
    async set() {
      return { ok: false, error: { kind: "storage_unavailable" } };
    },
  };
}

describe("SessionRepository", () => {
  describe("loadCurrent", () => {
    it("resolves { status: 'absent' } when nothing is stored — distinct from a stored value", async () => {
      localStorage.clear();
      const repo = createSessionRepository(createLocalStorageAdapter());
      const result = await repo.loadCurrent();
      expect(result.status).toBe("absent");
    });

    it("resolves { status: 'value' } for a real stored session, distinct from absent", async () => {
      localStorage.clear();
      const session = {
        id: "s1",
        title: "My Session",
        date: new Date().toISOString(),
        notes: "",
        blocks: [],
        activeBlockId: "",
        shots: [],
      };
      localStorage.setItem(CURRENT_SESSION_STORAGE_KEY, JSON.stringify(session));
      const repo = createSessionRepository(createLocalStorageAdapter());
      const result = await repo.loadCurrent();
      expect(result.status).toBe("value");
      if (result.status === "value") {
        expect(result.value.id).toBe("s1");
        expect(result.value.title).toBe("My Session");
      }
    });

    it("does not fabricate a Legacy Block on absence — an absent key produces no migration at all", async () => {
      localStorage.clear();
      const repo = createSessionRepository(createLocalStorageAdapter());
      const result = await repo.loadCurrent();
      expect(result.status).toBe("absent");
      // If this had instead called migrateSession(null)/(undefined), the caller would
      // receive a fabricated "Legacy Block" — asserting "absent" carries no value proves
      // that never happens (see docs/PERSISTENCE_BOUNDARY_DESIGN.md §5.1).
      expect((result as { value?: unknown }).value).toBeUndefined();
    });

    it("migrates a legacy session with no blocks array into a single Legacy Block — malformed data stays domain-specific, not a read failure", async () => {
      localStorage.clear();
      const legacy = {
        id: "legacy-1",
        title: "Old Session",
        date: "2024-01-01T00:00:00.000Z",
        targetTime: 3.8,
        notes: "",
        shots: [],
      };
      localStorage.setItem(CURRENT_SESSION_STORAGE_KEY, JSON.stringify(legacy));
      const repo = createSessionRepository(createLocalStorageAdapter());
      const result = await repo.loadCurrent();
      expect(result.status).toBe("value");
      if (result.status === "value") {
        expect(result.value.blocks).toHaveLength(1);
        expect(result.value.blocks[0].name).toBe("Legacy Block");
      }
    });

    it("preserves the blocks: [] vs missing blocks distinction (ADR-0005)", async () => {
      localStorage.clear();
      const freshSession = {
        id: "s2",
        title: "Fresh",
        date: new Date().toISOString(),
        notes: "",
        blocks: [],
        activeBlockId: "",
        shots: [],
      };
      localStorage.setItem(CURRENT_SESSION_STORAGE_KEY, JSON.stringify(freshSession));
      const repo = createSessionRepository(createLocalStorageAdapter());
      const result = await repo.loadCurrent();
      expect(result.status).toBe("value");
      if (result.status === "value") {
        expect(result.value.blocks).toEqual([]);
      }
    });

    it("treats unparseable JSON the same as absence", async () => {
      localStorage.clear();
      localStorage.setItem(CURRENT_SESSION_STORAGE_KEY, "{not json");
      const repo = createSessionRepository(createLocalStorageAdapter());
      const result = await repo.loadCurrent();
      expect(result.status).toBe("absent");
    });

    it("resolves { status: 'read_failed' } on a genuine storage failure, with a fallback and never throwing", async () => {
      const repo = createSessionRepository(fakeFailingAdapter());
      const result = await repo.loadCurrent();
      expect(result.status).toBe("read_failed");
      if (result.status === "read_failed") {
        expect(result.error).toEqual({ kind: "storage_unavailable" });
      }
    });
  });

  describe("saveCurrent", () => {
    it("overwrites the current session key with the full serialized session", async () => {
      localStorage.clear();
      const repo = createSessionRepository(createLocalStorageAdapter());
      const session = {
        id: "s3",
        title: "Saved",
        date: new Date().toISOString(),
        notes: "",
        blocks: [],
        activeBlockId: "",
        shots: [],
      };
      const result = await repo.saveCurrent(session);
      expect(result).toEqual({ ok: true });
      expect(JSON.parse(localStorage.getItem(CURRENT_SESSION_STORAGE_KEY)!).id).toBe("s3");
    });

    it("surfaces a write failure as a typed result, not a thrown exception", async () => {
      const repo = createSessionRepository(fakeFailingAdapter());
      const result = await repo.saveCurrent({
        id: "s4",
        title: "x",
        date: new Date().toISOString(),
        notes: "",
        blocks: [],
        activeBlockId: "",
        shots: [],
      });
      expect(result).toEqual({ ok: false, error: { kind: "storage_unavailable" } });
    });
  });

  describe("loadHistory", () => {
    it("resolves { status: 'absent' } when nothing is stored", async () => {
      localStorage.clear();
      const repo = createSessionRepository(createLocalStorageAdapter());
      const result = await repo.loadHistory();
      expect(result.status).toBe("absent");
    });

    it("resolves { status: 'value' } with the migrated array for a real stored history", async () => {
      localStorage.clear();
      localStorage.setItem(
        SESSION_HISTORY_STORAGE_KEY,
        JSON.stringify([
          {
            id: "h1",
            title: "Past",
            date: new Date().toISOString(),
            notes: "",
            blocks: [],
            activeBlockId: "",
            shots: [],
          },
        ])
      );
      const repo = createSessionRepository(createLocalStorageAdapter());
      const result = await repo.loadHistory();
      expect(result.status).toBe("value");
      if (result.status === "value") {
        expect(result.value).toHaveLength(1);
      }
    });
  });

  describe("saveHistory", () => {
    it("performs a full overwrite matching Clear History's setSessionHistory([]) exactly", async () => {
      localStorage.clear();
      localStorage.setItem(SESSION_HISTORY_STORAGE_KEY, JSON.stringify([{ id: "old" }]));
      const repo = createSessionRepository(createLocalStorageAdapter());
      await repo.saveHistory([]);
      expect(localStorage.getItem(SESSION_HISTORY_STORAGE_KEY)).toBe("[]");
    });

    it("does not deduplicate by id — preserves today's real behavior exactly", async () => {
      localStorage.clear();
      const repo = createSessionRepository(createLocalStorageAdapter());
      const duplicateSession = {
        id: "dup",
        title: "Dup",
        date: new Date().toISOString(),
        notes: "",
        blocks: [],
        activeBlockId: "",
        shots: [],
      };
      await repo.saveHistory([duplicateSession, duplicateSession]);
      const stored = JSON.parse(localStorage.getItem(SESSION_HISTORY_STORAGE_KEY)!);
      expect(stored).toHaveLength(2);
    });
  });

  describe("isolation from other domains", () => {
    it("writing malformed data to the session key does not affect a read of the history key", async () => {
      localStorage.clear();
      localStorage.setItem(CURRENT_SESSION_STORAGE_KEY, "{not json");
      localStorage.setItem(SESSION_HISTORY_STORAGE_KEY, JSON.stringify([]));
      const repo = createSessionRepository(createLocalStorageAdapter());
      const history = await repo.loadHistory();
      expect(history.status).toBe("value");
    });
  });
});
