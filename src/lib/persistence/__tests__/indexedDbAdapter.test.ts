import { afterEach, describe, expect, it, vi } from "vitest";
import "fake-indexeddb/auto";
import { forceCloseDatabase } from "fake-indexeddb";
import { deleteDB, openDB, unwrap } from "idb";
import {
  createIndexedDbAdapter,
  INDEXED_DB_VERSION,
  METADATA_STORE_NAME,
  RECORDS_STORE_NAME,
} from "../indexedDbAdapter";
import { createSessionRepository } from "../../sessionRepository";
import { createNewSession } from "../../sessionMigration";

// One shared fake-indexeddb factory for the whole file (installed globally by
// "fake-indexeddb/auto") — every test uses a unique, randomly-suffixed database name
// instead of resetting the factory, so tests stay isolated from each other without
// needing to swap out globalThis.indexedDB except where a test is specifically
// exercising "indexedDB is unavailable" (those restore the original reference in a
// finally/afterEach).
function freshDatabaseName(label: string): string {
  return `test-${label}-${Math.floor(Math.random() * 1e9)}`;
}

/** A small, bounded number of macrotask turns — enough for fake-indexeddb's internal
 * task queue to drain a request that was pending behind a just-closed blocking
 * connection, without ever waiting indefinitely if something is actually broken. */
async function flushMicrotasks(ticks = 5): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await new Promise((resolve) => setTimeout(resolve, 0));
  }
}

describe("createIndexedDbAdapter", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("does not open a database merely by being imported or constructed — proven against a genuinely fresh module evaluation", async () => {
    // The file-level static import above already resolved this module once, before
    // any test ran — re-importing that cached instance would prove nothing about
    // module-evaluation side effects. vi.resetModules() forces the next import() to
    // re-execute indexedDbAdapter.ts's top-level code from scratch, and the spy is in
    // place *before* that import runs, so it would catch an indexedDB.open() call made
    // during evaluation itself, not just during later use.
    const openSpy = vi.spyOn(globalThis.indexedDB, "open");
    try {
      vi.resetModules();
      const mod = await import("../indexedDbAdapter");
      expect(openSpy).not.toHaveBeenCalled();

      const databaseName = freshDatabaseName("fresh-import-only");
      const adapter = mod.createIndexedDbAdapter({ databaseName });
      expect(openSpy).not.toHaveBeenCalled();

      await adapter.get("k");
      expect(openSpy).toHaveBeenCalledTimes(1);
      expect(openSpy).toHaveBeenCalledWith(databaseName, mod.INDEXED_DB_VERSION);
    } finally {
      openSpy.mockRestore();
      // Leave the module registry as this file found it, so every later test's
      // already-bound top-level imports keep referring to a live, unaffected module
      // graph (resetModules() only changes what a future import() resolves to, never
      // bindings already captured — but restoring it here keeps this test's side
      // effect from outliving it).
      vi.resetModules();
    }
  });

  it("is safe to construct and call when indexedDB is unavailable", async () => {
    const original = globalThis.indexedDB;
    // @ts-expect-error -- simulate an environment (e.g. Next.js server evaluation)
    // with no indexedDB global at all.
    delete globalThis.indexedDB;
    try {
      const adapter = createIndexedDbAdapter({ databaseName: freshDatabaseName("unavailable") });
      const getResult = await adapter.get("k");
      expect(getResult).toEqual({
        status: "read_failed",
        fallback: null,
        error: { kind: "storage_unavailable" },
      });
      const setResult = await adapter.set("k", "v");
      expect(setResult).toEqual({ ok: false, error: { kind: "storage_unavailable" } });
    } finally {
      globalThis.indexedDB = original;
    }
  });

  it("lazily creates the database at version 1 on first get/set, with both stores present", async () => {
    const databaseName = freshDatabaseName("lazy-create");
    const adapter = createIndexedDbAdapter({ databaseName });

    let databases = await globalThis.indexedDB.databases();
    expect(databases.some((d) => d.name === databaseName)).toBe(false);

    await adapter.set("k", "v");

    databases = await globalThis.indexedDB.databases();
    const entry = databases.find((d) => d.name === databaseName);
    expect(entry).toBeDefined();
    expect(entry?.version).toBe(INDEXED_DB_VERSION);

    const db = await openDB(databaseName, INDEXED_DB_VERSION);
    expect(Array.from(db.objectStoreNames).sort()).toEqual(
      [METADATA_STORE_NAME, RECORDS_STORE_NAME].sort()
    );
    db.close();
  });

  it("round-trips the exact string given to set()", async () => {
    const adapter = createIndexedDbAdapter({ databaseName: freshDatabaseName("roundtrip") });
    await adapter.set("session", '{"a":1,"b":"two"}');
    const result = await adapter.get("session");
    expect(result).toEqual({ status: "value", value: '{"a":1,"b":"two"}' });
  });

  it("returns value:null for a missing key", async () => {
    const adapter = createIndexedDbAdapter({ databaseName: freshDatabaseName("missing-key") });
    const result = await adapter.get("nonexistent");
    expect(result).toEqual({ status: "value", value: null });
  });

  it("persists across separate adapter instances sharing the same database name", async () => {
    const databaseName = freshDatabaseName("shared-name");
    const first = createIndexedDbAdapter({ databaseName });
    await first.set("k", "persisted-value");

    const second = createIndexedDbAdapter({ databaseName });
    const result = await second.get("k");
    expect(result).toEqual({ status: "value", value: "persisted-value" });
  });

  it("keeps different database names fully isolated", async () => {
    const adapterA = createIndexedDbAdapter({ databaseName: freshDatabaseName("isolated-a") });
    const adapterB = createIndexedDbAdapter({ databaseName: freshDatabaseName("isolated-b") });

    await adapterA.set("k", "value-a");
    const resultFromB = await adapterB.get("k");
    expect(resultFromB).toEqual({ status: "value", value: null });
  });

  it("keeps metadata fully isolated from the generic records get/set path, in both directions", async () => {
    const databaseName = freshDatabaseName("metadata-isolation");
    const adapter = createIndexedDbAdapter({ databaseName });

    // Direction 1: writing through the generic adapter path must not also write
    // metadata for the same key.
    await adapter.set("k", "records-value");
    let db = await openDB(databaseName, INDEXED_DB_VERSION);
    const metadataAfterRecordsWrite = await db.get(METADATA_STORE_NAME, "k");
    expect(metadataAfterRecordsWrite).toBeUndefined();

    // Plant a raw metadata sentinel for the same key, directly, bypassing the adapter.
    const metadataTx = db.transaction(METADATA_STORE_NAME, "readwrite");
    await metadataTx.store.put("metadata-sentinel", "k");
    await metadataTx.done;
    db.close();

    // Direction 2: a subsequent generic write/read for that same key must neither read
    // nor disturb the metadata sentinel that's sitting there.
    const setResult = await adapter.set("k", "updated-records-value");
    expect(setResult).toEqual({ ok: true });
    const getResult = await adapter.get("k");
    expect(getResult).toEqual({ status: "value", value: "updated-records-value" });

    db = await openDB(databaseName, INDEXED_DB_VERSION);
    const metadataAfterSecondWrite = await db.get(METADATA_STORE_NAME, "k");
    expect(metadataAfterSecondWrite).toBe("metadata-sentinel");
    db.close();
  });

  describe("retry after failure", () => {
    it("allows a later call to retry after an open failure", async () => {
      const databaseName = freshDatabaseName("retry-after-failure");
      const original = globalThis.indexedDB;
      // @ts-expect-error -- force the very first open attempt to fail.
      delete globalThis.indexedDB;
      const adapter = createIndexedDbAdapter({ databaseName });
      const failedResult = await adapter.get("k");
      expect(failedResult.status).toBe("read_failed");

      globalThis.indexedDB = original;
      const setResult = await adapter.set("k", "v");
      expect(setResult).toEqual({ ok: true });
      const getResult = await adapter.get("k");
      expect(getResult).toEqual({ status: "value", value: "v" });
    });
  });

  describe("error classification", () => {
    it("classifies a QuotaExceededError on set() as quota_exceeded", async () => {
      const adapter = createIndexedDbAdapter({ databaseName: freshDatabaseName("quota") });
      // Warm the connection first so the mock below only affects the store write.
      await adapter.set("warm", "up");

      const quotaError = new DOMException("quota exceeded", "QuotaExceededError");
      const putSpy = vi
        .spyOn(IDBObjectStore.prototype, "put")
        .mockImplementation(() => {
          throw quotaError;
        });
      const result = await adapter.set("k", "v");
      expect(result).toEqual({ ok: false, error: { kind: "quota_exceeded" } });
      putSpy.mockRestore();
    });

    it("classifies SecurityError as storage_unavailable", async () => {
      const adapter = createIndexedDbAdapter({ databaseName: freshDatabaseName("security") });
      const openSpy = vi.spyOn(globalThis.indexedDB, "open").mockImplementation(() => {
        throw new DOMException("blocked", "SecurityError");
      });
      const result = await adapter.get("k");
      expect(result).toEqual({
        status: "read_failed",
        fallback: null,
        error: { kind: "storage_unavailable" },
      });
      openSpy.mockRestore();
    });

    it("classifies NotAllowedError as storage_unavailable", async () => {
      const adapter = createIndexedDbAdapter({ databaseName: freshDatabaseName("not-allowed") });
      const openSpy = vi.spyOn(globalThis.indexedDB, "open").mockImplementation(() => {
        throw new DOMException("denied", "NotAllowedError");
      });
      const result = await adapter.set("k", "v");
      expect(result).toEqual({ ok: false, error: { kind: "storage_unavailable" } });
      openSpy.mockRestore();
    });

    it("classifies InvalidStateError as storage_unavailable", async () => {
      const adapter = createIndexedDbAdapter({ databaseName: freshDatabaseName("invalid-state") });
      const openSpy = vi.spyOn(globalThis.indexedDB, "open").mockImplementation(() => {
        throw new DOMException("invalid state", "InvalidStateError");
      });
      const result = await adapter.get("k");
      expect(result).toEqual({
        status: "read_failed",
        fallback: null,
        error: { kind: "storage_unavailable" },
      });
      openSpy.mockRestore();
    });

    it("classifies missing indexedDB as storage_unavailable", async () => {
      const original = globalThis.indexedDB;
      // @ts-expect-error -- simulate missing API.
      delete globalThis.indexedDB;
      const adapter = createIndexedDbAdapter({ databaseName: freshDatabaseName("missing-api") });
      const result = await adapter.get("k");
      expect(result).toEqual({
        status: "read_failed",
        fallback: null,
        error: { kind: "storage_unavailable" },
      });
      globalThis.indexedDB = original;
    });

    it("classifies an unrecognized thrown error as unknown", async () => {
      const adapter = createIndexedDbAdapter({ databaseName: freshDatabaseName("unknown-error") });
      const openSpy = vi.spyOn(globalThis.indexedDB, "open").mockImplementation(() => {
        throw new Error("disk on fire");
      });
      const result = await adapter.get("k");
      expect(result).toEqual({
        status: "read_failed",
        fallback: null,
        error: { kind: "unknown", message: "disk on fire" },
      });
      openSpy.mockRestore();
    });

    it("never lets a raw DOMException or rejection escape get()/set()", async () => {
      const adapter = createIndexedDbAdapter({ databaseName: freshDatabaseName("no-leak") });
      const openSpy = vi.spyOn(globalThis.indexedDB, "open").mockImplementation(() => {
        throw new DOMException("boom", "QuotaExceededError");
      });
      const getResult = await adapter.get("k");
      const setResult = await adapter.set("k", "v");
      expect(getResult).not.toBeInstanceOf(DOMException);
      expect(setResult).not.toBeInstanceOf(DOMException);
      expect(getResult.status).toBe("read_failed");
      expect(setResult).toEqual({ ok: false, error: { kind: "quota_exceeded" } });
      openSpy.mockRestore();
    });
  });

  describe("blocked opening", () => {
    it("settles (as a classified failure) rather than hanging, and directly closes the late-resolving connection instead of leaking it", async () => {
      const databaseName = freshDatabaseName("blocked-settle");

      // Spy on the real IDBDatabase.close boundary — calling through to the original
      // implementation — so every close() anywhere in this test is observable by the
      // *version* of the connection it was called on. This is what makes the leak
      // check direct rather than inferred: a same-version open succeeding again would
      // prove nothing (IndexedDB permits multiple simultaneous connections at the same
      // version regardless of whether an earlier one leaked), but an explicit close()
      // call recorded against version 2 can only be the adapter's own late-connection
      // cleanup, since nothing else in this test ever opens or closes a version-2
      // connection.
      const originalClose = IDBDatabase.prototype.close;
      const closedVersions: Array<number | null> = [];
      const closeSpy = vi
        .spyOn(IDBDatabase.prototype, "close")
        .mockImplementation(function (this: IDBDatabase) {
          closedVersions.push(this.version);
          return originalClose.call(this);
        });

      let corroborationDb: Awaited<ReturnType<typeof openDB>> | undefined;
      try {
        // Establish a real connection at version 1 first, held open with no
        // listeners of its own — this is the "other, uncooperative connection" that
        // will block a version upgrade. The adapter under test is then configured
        // (test-only seam) to request version 2 against the same name, which
        // requires exactly the kind of upgrade transaction that a still-open,
        // non-cooperating version-1 connection blocks — the real IndexedDB mechanism
        // this adapter must not hang on.
        const rogueConnection = await openDB(databaseName, 1);
        const adapter = createIndexedDbAdapter({ databaseName, databaseVersion: 2 });

        const result = await adapter.get("k");
        expect(result).toEqual({
          status: "read_failed",
          fallback: null,
          error: { kind: "storage_unavailable" },
        });
        // Nothing has closed yet: the rogue connection is still open, and the
        // adapter's own version-2 open request is still pending behind it.
        expect(closedVersions).toEqual([]);

        // Unblock the real open. This should produce exactly two close() calls, in
        // order: the rogue's own explicit close (version 1), then — once its now-
        // unblocked version-2 open finally resolves — the adapter's own immediate
        // close of that late connection (version 2), which it must issue itself
        // rather than adopting a connection the caller already moved on from.
        rogueConnection.close();
        await flushMicrotasks();

        expect(closedVersions).toEqual([1, 2]);

        // Corroborate directly: with the rogue (v1) closed by the test and the
        // adapter's late connection (v2) closed by the adapter itself, nothing should
        // still be open below version 3 — a fresh open at version 3 must resolve
        // without ever seeing `blocked()`, which could only fire if some connection
        // below version 3 were still alive.
        let blockedDuringCorroboration = false;
        corroborationDb = await openDB(databaseName, 3, {
          blocked() {
            blockedDuringCorroboration = true;
          },
        });
        expect(blockedDuringCorroboration).toBe(false);
      } finally {
        closeSpy.mockRestore();
        corroborationDb?.close();
      }
    });

    it("allows a later call to retry opening after a blocked failure", async () => {
      const databaseName = freshDatabaseName("blocked-retry");
      const rogueConnection = await openDB(databaseName, 1);
      const adapter = createIndexedDbAdapter({ databaseName, databaseVersion: 2 });

      const failed = await adapter.get("k");
      expect(failed.status).toBe("read_failed");

      rogueConnection.close();
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));

      const retried = await adapter.set("k", "v");
      expect(retried).toEqual({ ok: true });
    });
  });

  describe("version-change and termination invalidate the cached connection", () => {
    it("closes and drops its cached connection when another operation needs it to close, and reopens cleanly afterward", async () => {
      const databaseName = freshDatabaseName("version-change");
      const adapter = createIndexedDbAdapter({ databaseName });

      // Establish and cache a connection.
      await adapter.set("k", "v");

      // Deleting the database fires 'versionchange' (newVersion: null) on the
      // adapter's cached connection, exactly as a real schema upgrade would — without
      // permanently moving the stored version past what this fixed-version-1 adapter
      // requests (which a real version-2 upgrade would, making every later open at
      // version 1 an impossible downgrade). The adapter must respond by closing (and
      // dropping its cache) rather than blocking the delete indefinitely.
      await deleteDB(databaseName);

      // The adapter must reopen cleanly (a fresh, non-stale connection) to service this
      // call, proving the previous cached connection was actually invalidated rather
      // than reused after being closed underneath it — the database was deleted, so
      // the key is legitimately gone, but the read must not fail with an invalid-state
      // error against the stale handle.
      const result = await adapter.get("k");
      expect(result).toEqual({ status: "value", value: null });
    });

    it("drops its cached connection on abnormal termination", async () => {
      const databaseName = freshDatabaseName("terminated");
      const adapter = createIndexedDbAdapter({ databaseName });
      await adapter.set("k", "v");

      // Simulate the browser abnormally terminating every open connection to this
      // database (e.g. the user clearing site data while the tab is open) — idb's
      // `terminated` callback is wired to the connection's 'close' event, which
      // fake-indexeddb's forceCloseDatabase is the documented way to trigger
      // deterministically. The adapter's own connection is internal to it, so it's
      // reached indirectly here via the raw database's connection registry rather
      // than a handle the test could hold directly.
      const probe = await openDB(databaseName, INDEXED_DB_VERSION);
      // `_rawDatabase`/`connections` are fake-indexeddb internals with no public
      // typings — accessed only here, in a test, to reach every connection.
      const rawDatabase = (unwrap(probe) as unknown as { _rawDatabase: { connections: unknown[] } })
        ._rawDatabase;
      for (const connection of [...rawDatabase.connections]) {
        forceCloseDatabase(connection as never);
      }

      // Data survives (forceCloseDatabase only closes connections, it doesn't delete
      // anything) — the adapter must reopen a fresh connection to read it back,
      // proving `terminated()` dropped the stale cached one rather than reusing it.
      const result = await adapter.get("k");
      expect(result).toEqual({ status: "value", value: "v" });
    });
  });

  it("lets SessionRepository use a created IndexedDB adapter with no repository or shape changes", async () => {
    const adapter = createIndexedDbAdapter({ databaseName: freshDatabaseName("session-repo") });
    const repository = createSessionRepository(adapter);

    const absent = await repository.loadCurrent();
    expect(absent).toEqual({ status: "absent" });

    const session = createNewSession();
    const saveResult = await repository.saveCurrent(session);
    expect(saveResult).toEqual({ ok: true });

    const loaded = await repository.loadCurrent();
    expect(loaded).toEqual({ status: "value", value: session });
  });
});
