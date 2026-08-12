// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import {
  createSessionRepository,
  CURRENT_SESSION_STORAGE_KEY,
  SESSION_HISTORY_STORAGE_KEY,
} from "../sessionRepository";
import { createLocalStorageAdapter } from "../persistence/localStorageAdapter";
import type {
  PersistenceWriteError,
  PersistenceWriteResult,
  StorageAdapter,
} from "../persistence/types";

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

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((res) => {
    resolve = res;
  });
  return { promise, resolve };
}

function makeSession(id: string) {
  return {
    id,
    title: id,
    date: new Date().toISOString(),
    notes: "",
    blocks: [],
    activeBlockId: "",
    shots: [],
  };
}

/**
 * A deliberately, genuinely asynchronous test adapter — unlike `localStorage`, `set()`
 * does not resolve until the test explicitly releases it. This is required to prove
 * `archiveAndReplace`'s ordering guarantee holds independent of adapter synchronicity
 * (docs/adr/0014-session-archive-write-ordering.md): a fake that resolves immediately
 * (as most mocks would) could pass an ordering assertion for the wrong reason — because
 * everything happens to settle in one microtask, the same way the real
 * `localStorageAdapter` does today. This adapter makes the *first* `set()` call
 * controllable so a test can assert the second call has not even started until the
 * first is released.
 */
function createControllableAsyncAdapter(options?: {
  failKey?: string;
  failError?: PersistenceWriteError;
}) {
  const callLog: string[] = [];
  const pendingGates = new Map<string, ReturnType<typeof createDeferred<void>>>();

  function gateFor(key: string) {
    if (!pendingGates.has(key)) {
      pendingGates.set(key, createDeferred<void>());
    }
    return pendingGates.get(key)!;
  }

  const adapter: StorageAdapter = {
    async get() {
      return { status: "value", value: null };
    },
    async set(key: string): Promise<PersistenceWriteResult> {
      callLog.push(`start:${key}`);
      await gateFor(key).promise;
      callLog.push(`resolve:${key}`);
      if (options?.failKey === key) {
        return { ok: false, error: options.failError ?? { kind: "storage_unavailable" } };
      }
      return { ok: true };
    },
  };

  return {
    adapter,
    callLog,
    /** Releases the gate for one key's set() call, letting it resolve. */
    release(key: string) {
      gateFor(key).resolve();
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

  // See docs/adr/0014-session-archive-write-ordering.md for the decision this
  // coordinated operation implements.
  describe("archiveAndReplace", () => {
    async function flushMicrotasks() {
      for (let i = 0; i < 5; i++) {
        await Promise.resolve();
      }
    }

    it("writes session history to completion before the replacement current-session write even begins — proven with a genuinely asynchronous adapter, not one that resolves in the same microtask", async () => {
      const { adapter, callLog, release } = createControllableAsyncAdapter();
      const repo = createSessionRepository(adapter);

      const resultPromise = repo.archiveAndReplace(
        [makeSession("h1")],
        makeSession("c1")
      );

      // The history write has started; the current-session write must not have
      // started yet. If this adapter resolved synchronously (like localStorage),
      // or in the same microtask, this assertion could pass for the wrong
      // reason — the controllable gate is what makes it a real proof.
      expect(callLog).toEqual([`start:${SESSION_HISTORY_STORAGE_KEY}`]);

      release(SESSION_HISTORY_STORAGE_KEY);
      await flushMicrotasks();

      expect(callLog).toEqual([
        `start:${SESSION_HISTORY_STORAGE_KEY}`,
        `resolve:${SESSION_HISTORY_STORAGE_KEY}`,
        `start:${CURRENT_SESSION_STORAGE_KEY}`,
      ]);

      release(CURRENT_SESSION_STORAGE_KEY);
      const result = await resultPromise;

      expect(result).toEqual({ ok: true });
      expect(callLog).toEqual([
        `start:${SESSION_HISTORY_STORAGE_KEY}`,
        `resolve:${SESSION_HISTORY_STORAGE_KEY}`,
        `start:${CURRENT_SESSION_STORAGE_KEY}`,
        `resolve:${CURRENT_SESSION_STORAGE_KEY}`,
      ]);
    });

    it("persists both the history array and the replacement session correctly against the real localStorage adapter", async () => {
      localStorage.clear();
      const repo = createSessionRepository(createLocalStorageAdapter());
      const history = [makeSession("h1")];
      const nextCurrent = makeSession("c1");

      const result = await repo.archiveAndReplace(history, nextCurrent);

      expect(result).toEqual({ ok: true });
      expect(JSON.parse(localStorage.getItem(SESSION_HISTORY_STORAGE_KEY)!)).toHaveLength(1);
      expect(JSON.parse(localStorage.getItem(CURRENT_SESSION_STORAGE_KEY)!).id).toBe("c1");
    });

    it("never attempts the current-session write when the history write fails — resolving { step: 'history' }, nothing persisted", async () => {
      const { adapter, callLog, release } = createControllableAsyncAdapter({
        failKey: SESSION_HISTORY_STORAGE_KEY,
        failError: { kind: "unknown", message: "simulated history failure" },
      });
      release(SESSION_HISTORY_STORAGE_KEY);
      release(CURRENT_SESSION_STORAGE_KEY);
      const repo = createSessionRepository(adapter);

      const result = await repo.archiveAndReplace(
        [makeSession("h1")],
        makeSession("c1")
      );

      expect(result).toEqual({
        ok: false,
        step: "history",
        error: { kind: "unknown", message: "simulated history failure" },
      });
      expect(callLog).toEqual([
        `start:${SESSION_HISTORY_STORAGE_KEY}`,
        `resolve:${SESSION_HISTORY_STORAGE_KEY}`,
      ]);
      expect(callLog.some((entry) => entry.includes(CURRENT_SESSION_STORAGE_KEY))).toBe(
        false
      );
    });

    it("returns the current-session write failure visibly, distinguished by step, after the history write already succeeded", async () => {
      const { adapter, callLog, release } = createControllableAsyncAdapter({
        failKey: CURRENT_SESSION_STORAGE_KEY,
        failError: { kind: "quota_exceeded" },
      });
      release(SESSION_HISTORY_STORAGE_KEY);
      release(CURRENT_SESSION_STORAGE_KEY);
      const repo = createSessionRepository(adapter);

      const result = await repo.archiveAndReplace(
        [makeSession("h1")],
        makeSession("c1")
      );

      expect(result).toEqual({
        ok: false,
        step: "current",
        error: { kind: "quota_exceeded" },
      });
      expect(callLog).toEqual([
        `start:${SESSION_HISTORY_STORAGE_KEY}`,
        `resolve:${SESSION_HISTORY_STORAGE_KEY}`,
        `start:${CURRENT_SESSION_STORAGE_KEY}`,
        `resolve:${CURRENT_SESSION_STORAGE_KEY}`,
      ]);
    });

    it("leaves the independent saveCurrent/saveHistory operations available and unaffected afterward — ordinary per-shot/per-edit persistence still works", async () => {
      localStorage.clear();
      const repo = createSessionRepository(createLocalStorageAdapter());

      await repo.archiveAndReplace([makeSession("h1")], makeSession("c1"));

      const saveCurrentResult = await repo.saveCurrent(makeSession("c2"));
      expect(saveCurrentResult).toEqual({ ok: true });
      expect(JSON.parse(localStorage.getItem(CURRENT_SESSION_STORAGE_KEY)!).id).toBe("c2");

      const saveHistoryResult = await repo.saveHistory([makeSession("h2")]);
      expect(saveHistoryResult).toEqual({ ok: true });
      expect(JSON.parse(localStorage.getItem(SESSION_HISTORY_STORAGE_KEY)!)).toHaveLength(
        1
      );
    });
  });
});
