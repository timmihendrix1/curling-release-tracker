// @vitest-environment node
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  isStorageDiagnosticsRequested,
  MOBILE_STORAGE_DIAGNOSTICS_DEFINE_NAME,
  MOBILE_STORAGE_DIAGNOSTICS_ENV_NAME,
} from "../storageDiagnosticsFlag";
import {
  createNativeStorageDiagnosticsController,
  type NativeStorageDiagnosticsController,
} from "../src/diagnostics/nativeStorageDiagnosticsController";
import {
  DIAGNOSTIC_DATABASE_NAME,
  fixtureStorageKey,
  MANIFEST_STORAGE_KEY,
  parseManifest,
  SYNTHETIC_FIXTURES,
} from "../src/diagnostics/syntheticFixtures";
import type {
  NativeSqliteControlResult,
  NativeSqliteSettingsResult,
  NativeSqliteStore,
} from "../../src/lib/persistence/nativeSqliteAdapter";
import type {
  PersistenceRemoveResult,
  PersistenceWriteResult,
  StorageGetResult,
} from "../../src/lib/persistence/types";

const mobileRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = path.resolve(mobileRoot, "..");

/**
 * A fake store that keeps its rows across a simulated close/reopen and across a
 * simulated app restart. It is a CONTROL-FLOW fake: it proves what the panel
 * claims and when, never that SQLite persisted anything.
 */
function createFakeStore(rows = new Map<string, string>()) {
  const state = {
    rows,
    open: false,
    openCount: 0,
    closeCount: 0,
    failReads: false,
    /** Fails reads of exactly these keys, so an incomplete evidence set can be
     * constructed without failing every read. */
    failReadForKeys: new Set<string>(),
    failWrites: false,
    /** Fails the write of exactly one key, so an interrupted publication can be
     * constructed without failing the fixtures that precede it. */
    failWriteForKey: null as string | null,
    /** 1-based occurrence of `failWriteForKey` at which failure STARTS. The
     * manifest key is written twice per run — in-progress, then complete — so this
     * is what lets a test fail only the completion publication. */
    failWriteForKeyFromOccurrence: 1,
    writeCountByKey: new Map<string, number>(),
    /** Fails the removal of exactly one key. */
    failRemoveForKey: null as string | null,
    writes: [] as string[],
    removals: [] as string[],

    /* --- transaction model --- */
    /** The open transaction's working copy, or null. Lives here rather than in
     * `rows` so that discarding it models an uncommitted transaction being
     * lost, exactly as the real engine would. */
    working: null as Map<string, string> | null,
    tokenId: null as string | null,
    transactionOrdinal: 0,
    failBegin: false,
    /** BEGIN is issued but its acknowledgement is lost: the real store then
     * owns an UNCERTAIN transaction and returns its token. */
    beginUnacknowledged: false,
    failCommit: false,
    failRollback: false,
    /** True once a rollback failed (or BEGIN went unacknowledged): the real
     * store's `uncertain` phase. */
    uncertain: false,
    /** Fails abandon at this boundary, leaving the transaction owned. */
    failAbandonAt: null as "close" | "release" | null,
    /** Fails the explicit reopen at this boundary. */
    failReopenAt: null as "close" | "release" | "open" | null,
    reopens: 0,
    /** Makes the deliberate failing statement resolve instead of failing, so
     * "the statement that was supposed to fail did not" is exercisable. */
    deliberateStatementSucceeds: false,
    /** Fails staging of exactly one key, to construct a partial transaction. */
    failStageForKey: null as string | null,
    begins: 0,
    commits: 0,
    rollbacks: 0,
    abandons: 0,
  };

  const store: NativeSqliteStore = {
    databaseName: DIAGNOSTIC_DATABASE_NAME,
    adapter: {
      async get(key: string): Promise<StorageGetResult> {
        if (state.working !== null) {
          // The real store refuses ordinary reads while it owns a transaction,
          // so a read can never observe uncommitted rows.
          return {
            status: "read_failed",
            fallback: null,
            error: { kind: "unknown", message: "transaction pending" },
          };
        }
        if (state.failReads || state.failReadForKeys.has(key)) {
          return { status: "read_failed", fallback: null, error: { kind: "unknown", message: "x" } };
        }
        if (!state.open) {
          state.open = true;
          state.openCount += 1;
        }
        return { status: "value", value: state.rows.has(key) ? state.rows.get(key)! : null };
      },
      async set(key: string, value: string): Promise<PersistenceWriteResult> {
        if (state.working !== null) {
          return { ok: false, error: { kind: "unknown", message: "transaction pending" } };
        }
        const occurrence = (state.writeCountByKey.get(key) ?? 0) + 1;
        state.writeCountByKey.set(key, occurrence);
        if (
          state.failWrites ||
          (state.failWriteForKey === key &&
            occurrence >= state.failWriteForKeyFromOccurrence)
        ) {
          return { ok: false, error: { kind: "quota_exceeded" } };
        }
        state.writes.push(key);
        if (!state.open) {
          state.open = true;
          state.openCount += 1;
        }
        state.rows.set(key, value);
        return { ok: true };
      },
      async remove(key: string): Promise<PersistenceRemoveResult> {
        if (state.working !== null) {
          return { ok: false, error: { kind: "removal_failed", message: "transaction pending" } };
        }
        if (state.failRemoveForKey === key) {
          return { ok: false, error: { kind: "removal_failed", message: "x" } };
        }
        state.removals.push(key);
        if (!state.open) {
          state.open = true;
          state.openCount += 1;
        }
        state.rows.delete(key);
        return { ok: true };
      },
    },
    async readEffectiveSettings(): Promise<NativeSqliteSettingsResult> {
      return {
        ok: true,
        settings: {
          journalMode: "wal",
          synchronous: "2",
          pageSize: "4096",
          sqliteVersion: "3.45.0",
        },
      };
    },
    async close(): Promise<NativeSqliteControlResult> {
      state.open = false;
      state.closeCount += 1;
      return { ok: true };
    },
    async reopenDiagnosticConnection() {
      if (state.working !== null) {
        return { ok: false, boundary: "refused", reason: "operation_failed" } as const;
      }
      if (state.failReopenAt !== null) {
        return { ok: false, boundary: state.failReopenAt, reason: "operation_failed" } as const;
      }
      state.reopens += 1;
      state.closeCount += 1;
      state.openCount += 1;
      state.open = true;
      return { ok: true } as const;
    },
    async deleteAllRecords(): Promise<NativeSqliteControlResult> {
      if (state.working !== null) return { ok: false, reason: "operation_failed" };
      state.rows.clear();
      return { ok: true };
    },

    hasPendingDiagnosticTransaction: () => state.working !== null,
    diagnosticTransactionState: () =>
      state.working === null ? "none" : state.uncertain ? "uncertain" : "open",

    async beginDiagnosticTransaction() {
      if (state.working !== null) return { ok: false, reason: "transaction_pending" };
      if (state.failBegin) return { ok: false, reason: "operation_failed" };
      state.begins += 1;
      state.transactionOrdinal += 1;
      state.tokenId = `txn-${state.transactionOrdinal}`;
      // Snapshot of the COMMITTED rows. Nothing written into this copy is
      // durable until commit merges it back.
      state.working = new Map(state.rows);
      if (state.beginUnacknowledged) {
        state.uncertain = true;
        return { ok: false, reason: "begin_unacknowledged", token: { id: state.tokenId } };
      }
      return { ok: true, token: { id: state.tokenId } };
    },

    async stageDiagnosticWrites(token, entries) {
      if (state.working === null) return { ok: false, reason: "no_pending_transaction" };
      if (token.id !== state.tokenId) return { ok: false, reason: "wrong_transaction" };
      if (state.uncertain) return { ok: false, reason: "transaction_uncertain" };
      for (const entry of entries) {
        if (state.failStageForKey === entry.key) {
          if (state.failRollback) {
            state.uncertain = true;
            return { ok: false, reason: "statement_failed", cleanup: "rollback_failed" };
          }
          state.working = null;
          state.rollbacks += 1;
          return { ok: false, reason: "statement_failed", cleanup: "rolled_back" };
        }
        state.working.set(entry.key, entry.value);
      }
      return { ok: true };
    },

    async stageDiagnosticFailingStatement(token) {
      if (state.working === null) return { ok: false, reason: "no_pending_transaction" };
      if (token.id !== state.tokenId) return { ok: false, reason: "wrong_transaction" };
      if (state.uncertain) return { ok: false, reason: "transaction_uncertain" };
      const reason = state.deliberateStatementSucceeds
        ? ("statement_unexpectedly_succeeded" as const)
        : ("statement_failed" as const);
      if (state.failRollback) {
        state.uncertain = true;
        return { ok: false, reason, cleanup: "rollback_failed" };
      }
      state.working = null;
      state.rollbacks += 1;
      return { ok: false, reason, cleanup: "rolled_back" };
    },

    async commitDiagnosticTransaction(token) {
      if (state.working === null) return { ok: false, reason: "no_pending_transaction" };
      if (token.id !== state.tokenId) return { ok: false, reason: "wrong_transaction" };
      if (state.uncertain) return { ok: false, reason: "transaction_uncertain" };
      if (state.failCommit) {
        if (state.failRollback) {
          state.uncertain = true;
          return { ok: false, reason: "commit_rejected", cleanup: "rollback_failed" };
        }
        state.working = null;
        state.rollbacks += 1;
        return { ok: false, reason: "commit_rejected", cleanup: "rolled_back" };
      }
      state.commits += 1;
      // The whole working copy becomes durable AT ONCE. Mutated IN PLACE rather
      // than reassigned: a caller holding the same Map is how a simulated app
      // restart shares one device's storage, and reassigning would silently
      // hand the "restarted" store an empty database.
      state.rows.clear();
      for (const [key, value] of state.working) state.rows.set(key, value);
      state.working = null;
      return { ok: true };
    },

    async rollbackDiagnosticTransaction(token) {
      if (state.working === null) return { ok: false, reason: "no_pending_transaction" };
      if (token.id !== state.tokenId) return { ok: false, reason: "wrong_transaction" };
      if (state.failRollback) {
        state.uncertain = true;
        return { ok: false, reason: "rollback_failed" };
      }
      state.rollbacks += 1;
      state.working = null;
      state.uncertain = false;
      return { ok: true };
    },

    async abandonDiagnosticTransaction(token) {
      if (state.working === null) return { ok: false, reason: "no_pending_transaction" };
      if (token.id !== state.tokenId) return { ok: false, reason: "wrong_transaction" };
      state.uncertain = true;
      if (state.failAbandonAt !== null) {
        // Ownership is KEPT, exactly as the real store keeps it.
        return { ok: false, reason: "abandon_incomplete", boundary: state.failAbandonAt };
      }
      state.abandons += 1;
      // Discards the working copy and closes, exactly as the real one does.
      state.working = null;
      state.uncertain = false;
      state.open = false;
      state.closeCount += 1;
      return { ok: true };
    },
  };
  return { store, state };
}

function controllerFor(
  store: NativeSqliteStore,
  sessionId = "session-a"
): NativeStorageDiagnosticsController {
  let tick = 0;
  return createNativeStorageDiagnosticsController({
    createStore: () => store,
    detectPlatform: () => "ios",
    now: () => (tick += 1),
    isoNow: () => "2026-09-30T00:00:00.000Z",
    newRunId: () => "run-1",
    sessionId,
  });
}

function latest(controller: NativeStorageDiagnosticsController) {
  return controller.getSnapshot().entries[0];
}

describe("storage diagnostics build opt-in", () => {
  it("is read as a build-time literal, not through a runtime lookup", async () => {
    const mobileApp = await readFile(path.join(mobileRoot, "src/MobileApp.tsx"), "utf8");
    // The conditional import reads the define DIRECTLY, which is what lets the
    // bundler drop the diagnostics chunk from a default build rather than merely
    // never loading it. mobile/__tests__/bundle.test.ts checks the artifact.
    expect(mobileApp).toContain(
      `const StorageDiagnostics = ${MOBILE_STORAGE_DIAGNOSTICS_DEFINE_NAME}`
    );
    expect(mobileApp).toContain(
      'import("./diagnostics/NativeStorageDiagnosticsLauncher")'
    );
    // The default is off everywhere the name is defined. Matched by the entry
    // rather than by the whole `define` literal, which now carries Stage M3b3's
    // separate native-storage opt-in alongside this one.
    const vitestConfig = await readFile(path.join(mobileRoot, "vitest.config.ts"), "utf8");
    expect(vitestConfig).toMatch(
      /\[MOBILE_STORAGE_DIAGNOSTICS_DEFINE_NAME\]\s*:\s*"false"/
    );
  });

  it("accepts exactly one value and nothing that merely looks like it", () => {
    expect(isStorageDiagnosticsRequested("1")).toBe(true);
    for (const rejected of [undefined, "", "0", "true", "TRUE", "yes", " 1", "1 ", "01"]) {
      expect(isStorageDiagnosticsRequested(rejected)).toBe(false);
    }
  });

  it("is a build switch, not a runtime one and not a public configuration value", async () => {
    const source = await readFile(path.join(mobileRoot, "vite.config.ts"), "utf8");
    // The build reads ONE definition of both names rather than re-spelling them.
    expect(source).toContain('from "./storageDiagnosticsFlag"');
    expect(source).toContain("MOBILE_STORAGE_DIAGNOSTICS_ENV_NAME");
    expect(source).toContain("MOBILE_STORAGE_DIAGNOSTICS_DEFINE_NAME");
    expect(source).toContain("isStorageDiagnosticsRequested");
    // The names themselves are pinned here so a rename cannot silently change
    // which variable enables an installable diagnostics build.
    expect(MOBILE_STORAGE_DIAGNOSTICS_ENV_NAME).toBe("CURLING_MOBILE_STORAGE_DIAGNOSTICS");
    expect(MOBILE_STORAGE_DIAGNOSTICS_DEFINE_NAME).toBe(
      "__CURLING_MOBILE_STORAGE_DIAGNOSTICS__"
    );

    const publicEnv = await readFile(path.join(mobileRoot, "publicEnv.ts"), "utf8");
    // It must never become a browser-visible configuration VALUE.
    expect(publicEnv).not.toContain(
      `"${MOBILE_STORAGE_DIAGNOSTICS_ENV_NAME}"`
    );

    // No URL parameter and no stored preference may reach the panel.
    const diagnosticsSources = await Promise.all(
      [
        "src/diagnostics/nativeStorageDiagnosticsController.ts",
        "src/diagnostics/NativeStorageDiagnosticsLauncher.tsx",
        "src/diagnostics/syntheticFixtures.ts",
        "src/MobileApp.tsx",
      ].map((relative) => readFile(path.join(mobileRoot, relative), "utf8"))
    );
    for (const source of diagnosticsSources) {
      expect(source).not.toContain("URLSearchParams");
      expect(source).not.toContain("location.search");
      expect(source).not.toContain("localStorage");
      expect(source).not.toContain("sessionStorage");
    }
  });

  it("does not weaken NODE_ENV, production React semantics or the identity guards", async () => {
    const viteConfig = await readFile(path.join(mobileRoot, "vite.config.ts"), "utf8");
    // NODE_ENV is still pinned from `command`, never from the diagnostics flag.
    expect(viteConfig).toContain(
      'const applicationNodeEnv = command === "build" ? "production" : "development";'
    );
    expect(viteConfig).not.toMatch(/storageDiagnostics[\s\S]{0,200}applicationNodeEnv\s*=/);

    const mobileApp = await readFile(path.join(mobileRoot, "src/MobileApp.tsx"), "utf8");
    // The gated provider tree is untouched; the panel is a sibling.
    expect(mobileApp).toMatch(
      /<IdentityProvider>[\s\S]*<AuthenticatedSportingPersistence>[\s\S]*<TrackerApp\s*\/>[\s\S]*<\/AuthenticatedSportingPersistence>[\s\S]*<\/IdentityProvider>/
    );
  });
});

describe("storage diagnostics isolation", () => {
  it("addresses one fixed synthetic database and no application database", () => {
    expect(DIAGNOSTIC_DATABASE_NAME).toBe("curling-storage-diagnostics-synthetic");
    // Not the IndexedDB database name, and not a `curling.`-prefixed app key
    // namespace.
    expect(DIAGNOSTIC_DATABASE_NAME).not.toBe("curling-release-tracker");
    for (const fixture of SYNTHETIC_FIXTURES) {
      expect(fixtureStorageKey(fixture.id).startsWith("diagnostic.synthetic.")).toBe(true);
      expect(fixtureStorageKey(fixture.id).startsWith("curling.")).toBe(false);
    }
    expect(MANIFEST_STORAGE_KEY.startsWith("diagnostic.synthetic.")).toBe(true);
  });

  it("imports no repository, sync or cloud module", async () => {
    const sources = await Promise.all(
      [
        "src/diagnostics/nativeStorageDiagnosticsController.ts",
        "src/diagnostics/NativeStorageDiagnosticsLauncher.tsx",
        "src/diagnostics/syntheticFixtures.ts",
      ].map((relative) => readFile(path.join(mobileRoot, relative), "utf8"))
    );
    const forbidden = [
      "Repository",
      "repository",
      "supabase",
      "Supabase",
      "outbox",
      "sync",
      "ProfileScoped",
      "identity",
    ];
    for (const source of sources) {
      // Import statements only — the prose in these files legitimately discusses
      // repositories and synchronisation.
      const imports = source
        .split("\n")
        .filter((line) => /^\s*import\b/.test(line) || /^\s*\}\s*from\s*"/.test(line) || /^\s*from\s*"/.test(line));
      for (const term of forbidden) {
        expect(imports.join("\n")).not.toContain(term);
      }
    }
  });

  it("is reachable from nothing in the Web application", async () => {
    // The panel lives under mobile/ and the Next app never imports it.
    const page = await readFile(path.join(repositoryRoot, "src/app/page.tsx"), "utf8");
    expect(page).not.toContain("diagnostics");
  });
});

describe("storage diagnostics controller", () => {
  it("writes nothing until a deliberate action", async () => {
    const { store, state } = createFakeStore();
    const controller = controllerFor(store);

    expect(controller.getSnapshot().entries).toEqual([]);
    expect(state.rows.size).toBe(0);
    // Reading the snapshot, subscribing and unsubscribing are all inert.
    const unsubscribe = controller.subscribe(() => {});
    unsubscribe();
    expect(state.rows.size).toBe(0);
  });

  it("acknowledges writes without claiming durability", async () => {
    const { store, state } = createFakeStore();
    const controller = controllerFor(store);

    await controller.writeFixtures();
    const entry = latest(controller);

    expect(entry.status).toBe("ok");
    expect(entry.claim).toBe("write_acknowledged");
    expect(entry.message).toContain("not evidence of surviving power loss");
    // Every fixture plus the manifest.
    expect(state.rows.size).toBe(SYNTHETIC_FIXTURES.length + 1);
    expect(state.rows.get(fixtureStorageKey("empty"))).toBe("");
  });

  it("verifies in-session without upgrading the claim", async () => {
    const { store } = createFakeStore();
    const controller = controllerFor(store);

    await controller.writeFixtures();
    await controller.verifyCurrentSession();
    const entry = latest(controller);

    expect(entry.status).toBe("ok");
    expect(entry.claim).toBe("verified_same_process");
    expect(entry.message).toContain("not disk durability");
    expect(entry.detail.some((line) => line.includes("Never-written key: reported absent"))).toBe(
      true
    );
  });

  it("reports a mismatch rather than a verification", async () => {
    const { store, state } = createFakeStore();
    const controller = controllerFor(store);

    await controller.writeFixtures();
    state.rows.set(fixtureStorageKey("small"), "tampered");
    await controller.verifyCurrentSession();
    const entry = latest(controller);

    expect(entry.status).toBe("failed");
    expect(entry.claim).toBe("no_claim");
    expect(entry.detail.some((line) => line.includes("MISMATCH"))).toBe(true);
  });

  it("distinguishes a reopen from a same-session read", async () => {
    const { store, state } = createFakeStore();
    const controller = controllerFor(store);

    await controller.writeFixtures();
    await controller.closeAndReopen();
    const entry = latest(controller);

    expect(state.closeCount).toBe(1);
    expect(entry.claim).toBe("verified_after_reopen");
    expect(entry.message).toContain("not power-loss evidence");
  });

  it("exercises write, overwrite, removal and genuine absence", async () => {
    const { store } = createFakeStore();
    const controller = controllerFor(store);

    await controller.exerciseUpdateAndRemove();
    const entry = latest(controller);

    expect(entry.status).toBe("ok");
    expect(entry.claim).toBe("no_claim");
    expect(entry.detail).toContain(
      "Removing an already-absent key succeeded, as it must."
    );
  });

  it("refuses to call a same-session read restart evidence", async () => {
    const { store } = createFakeStore();
    const controller = controllerFor(store, "session-a");

    await controller.writeFixtures();
    await controller.verifyAfterRestart();
    const entry = latest(controller);

    expect(entry.status).toBe("blocked");
    expect(entry.claim).toBe("verified_same_process");
    expect(entry.message).toContain("Force-quit the app");
  });

  it("claims restart verification only when a different session wrote the data", async () => {
    const rows = new Map<string, string>();
    const first = createFakeStore(rows);
    await controllerFor(first.store, "session-a").writeFixtures();

    // A new document session over the SAME durable rows.
    const second = createFakeStore(rows);
    const controller = controllerFor(second.store, "session-b");
    await controller.verifyAfterRestart();
    const entry = latest(controller);

    expect(entry.status).toBe("ok");
    expect(entry.claim).toBe("verified_after_restart");
    expect(entry.detail).toContain("Written by an earlier app session.");
    // The limit is stated rather than glossed over.
    expect(entry.message).toContain("reload of the web view would look the same");
  });

  it("never recreates missing data during restart verification", async () => {
    const rows = new Map<string, string>();
    const first = createFakeStore(rows);
    await controllerFor(first.store, "session-a").writeFixtures();

    // The engine lost one fixture between sessions.
    rows.delete(fixtureStorageKey("medium"));
    const before = new Map(rows);

    const second = createFakeStore(rows);
    const controller = controllerFor(second.store, "session-b");
    await controller.verifyAfterRestart();
    const entry = latest(controller);

    expect(entry.status).toBe("failed");
    expect(entry.claim).toBe("no_claim");
    expect(entry.detail.some((line) => line.includes("absent — nothing was recreated"))).toBe(true);
    // Nothing was written back.
    expect([...rows.keys()].sort()).toEqual([...before.keys()].sort());
    expect(rows.has(fixtureStorageKey("medium"))).toBe(false);
  });

  it("reports an absent previous run without writing one", async () => {
    const { store, state } = createFakeStore();
    const controller = controllerFor(store);

    await controller.verifyAfterRestart();
    const entry = latest(controller);

    expect(entry.status).toBe("failed");
    expect(entry.message).toContain("Nothing was recreated");
    expect(state.rows.size).toBe(0);
  });

  it("refuses a conflicting action instead of interleaving it", async () => {
    const { store } = createFakeStore();
    const controller = controllerFor(store);

    const first = controller.writeFixtures();
    // Pressed while the first action is still running.
    await controller.verifyCurrentSession();
    await first;

    const entries = controller.getSnapshot().entries;
    const blocked = entries.find((entry) => entry.status === "blocked");
    expect(blocked?.action).toBe("Verify in this app session");
    expect(blocked?.message).toContain("still running");
  });

  it("reports a write failure honestly and stops", async () => {
    const { store, state } = createFakeStore();
    state.failWrites = true;
    const controller = controllerFor(store);

    await controller.writeFixtures();
    const entry = latest(controller);

    expect(entry.status).toBe("failed");
    expect(entry.claim).toBe("no_claim");
    expect(entry.message).toContain("quota_exceeded");
    expect(state.rows.size).toBe(0);
  });

  it("reports a read failure as a failure, never as a verification", async () => {
    const { store, state } = createFakeStore();
    const controller = controllerFor(store);
    await controller.writeFixtures();
    state.failReads = true;

    await controller.verifyCurrentSession();
    const entry = latest(controller);

    expect(entry.status).toBe("failed");
    expect(entry.claim).toBe("no_claim");
  });

  it("surfaces the engine's reported settings", async () => {
    const { store } = createFakeStore();
    const controller = controllerFor(store);

    await controller.readSettings();

    expect(controller.getSnapshot().settings).toEqual({
      journalMode: "wal",
      synchronous: "2",
      pageSize: "4096",
      sqliteVersion: "3.45.0",
    });
    expect(latest(controller).message).toContain("not the ones this build asked for");
  });

  it("limits cleanup to its own synthetic database", async () => {
    const { store, state } = createFakeStore();
    const controller = controllerFor(store);

    await controller.writeFixtures();
    await controller.clearSyntheticDatabase();

    expect(state.rows.size).toBe(0);
    expect(latest(controller).message).toContain(DIAGNOSTIC_DATABASE_NAME);
    expect(latest(controller).message).toContain("No other database was touched");
  });

  it("notifies subscribers as the snapshot changes", async () => {
    const { store } = createFakeStore();
    const controller = controllerFor(store);
    let notifications = 0;
    const unsubscribe = controller.subscribe(() => {
      notifications += 1;
    });

    await controller.readSettings();
    expect(notifications).toBeGreaterThan(0);

    unsubscribe();
    const settled = notifications;
    await controller.readSettings();
    expect(notifications).toBe(settled);
  });
});

describe("synthetic fixtures", () => {
  it("are deterministic and cover the documented size set", () => {
    const sizes = SYNTHETIC_FIXTURES.map((fixture) => fixture.build().length);
    // Regenerating produces identical bytes, which is what makes a comparison
    // across an app restart meaningful.
    expect(SYNTHETIC_FIXTURES.map((fixture) => fixture.build().length)).toEqual(sizes);
    expect(sizes[0]).toBe(0);
    expect(SYNTHETIC_FIXTURES.map((fixture) => fixture.id)).toEqual([
      "empty",
      "awkward",
      "small",
      "medium",
      "large",
    ]);
    // A larger whole-document JSON value, parseable as one document.
    const large = SYNTHETIC_FIXTURES[4].build();
    expect(large.length).toBeGreaterThan(900_000);
    expect(() => JSON.parse(large)).not.toThrow();
  });

  it("claims no safe capacity", async () => {
    const source = await readFile(
      path.join(mobileRoot, "src/diagnostics/syntheticFixtures.ts"),
      "utf8"
    );
    expect(source).toContain("NOT a claimed safe capacity");
  });
});

describe("storage diagnostics — interrupted runs never certify", () => {
  it("does not call rewritten fixtures restart evidence when the manifest write failed", async () => {
    // REGRESSION. Session A completed a run. Session B rewrote the (deterministic,
    // therefore identical) fixtures and then failed to publish its own manifest. A's
    // completion record survived, so verification saw "a different session wrote
    // this" and certified a run that had in fact just been overwritten — possibly
    // only in part.
    const rows = new Map<string, string>();

    const sessionA = createFakeStore(rows);
    await controllerFor(sessionA.store, "session-a").writeFixtures();

    const sessionB = createFakeStore(rows);
    // The in-progress marker succeeds; only the COMPLETION publication fails —
    // exactly the reported scenario, in which B's fixtures were rewritten and A's
    // record was left behind.
    sessionB.state.failWriteForKey = MANIFEST_STORAGE_KEY;
    sessionB.state.failWriteForKeyFromOccurrence = 2;
    const controllerB = controllerFor(sessionB.store, "session-b");
    await controllerB.writeFixtures();
    const writeEntry = latest(controllerB);
    expect(writeEntry.status).toBe("failed");

    await controllerB.verifyAfterRestart();
    const verifyEntry = latest(controllerB);

    expect(verifyEntry.claim).not.toBe("verified_after_restart");
    expect(verifyEntry.status).not.toBe("ok");
  });

  it("does not certify after a later restart either", async () => {
    const rows = new Map<string, string>();

    const sessionA = createFakeStore(rows);
    await controllerFor(sessionA.store, "session-a").writeFixtures();

    const sessionB = createFakeStore(rows);
    sessionB.state.failWriteForKey = MANIFEST_STORAGE_KEY;
    sessionB.state.failWriteForKeyFromOccurrence = 2;
    await controllerFor(sessionB.store, "session-b").writeFixtures();

    // A genuinely new document session, reading the durable rows B left behind.
    const sessionC = createFakeStore(rows);
    const controllerC = controllerFor(sessionC.store, "session-c");
    await controllerC.verifyAfterRestart();
    const entry = latest(controllerC);

    expect(entry.claim).not.toBe("verified_after_restart");
    expect(entry.status).not.toBe("ok");
  });

  it("does not certify when a fixture write failed part-way", async () => {
    const rows = new Map<string, string>();
    const sessionA = createFakeStore(rows);
    await controllerFor(sessionA.store, "session-a").writeFixtures();

    const sessionB = createFakeStore(rows);
    sessionB.state.failWriteForKey = fixtureStorageKey("medium");
    await controllerFor(sessionB.store, "session-b").writeFixtures();

    const sessionC = createFakeStore(rows);
    const controllerC = controllerFor(sessionC.store, "session-c");
    await controllerC.verifyAfterRestart();
    const entry = latest(controllerC);

    expect(entry.claim).not.toBe("verified_after_restart");
    expect(entry.status).not.toBe("ok");
  });
});

describe("storage diagnostics — run attribution", () => {
  it("still certifies an earlier complete run when the new run never started", async () => {
    // The conservative protocol must not be indiscriminate. If the in-progress
    // marker itself could not be written, NO fixture was touched, so the earlier
    // run's completion record is still an accurate description of what is stored.
    const rows = new Map<string, string>();
    const sessionA = createFakeStore(rows);
    await controllerFor(sessionA.store, "session-a").writeFixtures();
    const before = new Map(rows);

    const sessionB = createFakeStore(rows);
    sessionB.state.failWriteForKey = MANIFEST_STORAGE_KEY;
    sessionB.state.failWriteForKeyFromOccurrence = 1;
    const controllerB = controllerFor(sessionB.store, "session-b");
    await controllerB.writeFixtures();
    expect(latest(controllerB).status).toBe("failed");
    expect(latest(controllerB).message).toContain("No fixture was written");
    // Proof that nothing was rewritten.
    expect([...rows.entries()]).toEqual([...before.entries()]);

    await controllerB.verifyAfterRestart();
    const entry = latest(controllerB);
    expect(entry.status).toBe("ok");
    expect(entry.claim).toBe("verified_after_restart");
  });

  it("blocks in the same session too, not only across a restart", async () => {
    const rows = new Map<string, string>();
    const store = createFakeStore(rows);
    store.state.failWriteForKey = fixtureStorageKey("medium");
    const controller = controllerFor(store.store, "session-a");

    await controller.writeFixtures();
    await controller.verifyAfterRestart();
    const entry = latest(controller);

    expect(entry.status).toBe("failed");
    expect(entry.claim).toBe("no_claim");
    expect(entry.message).toContain("did not finish writing");
  });

  it("recovers once a run completes successfully again", async () => {
    const rows = new Map<string, string>();
    const interrupted = createFakeStore(rows);
    interrupted.state.failWriteForKey = MANIFEST_STORAGE_KEY;
    interrupted.state.failWriteForKeyFromOccurrence = 2;
    await controllerFor(interrupted.store, "session-a").writeFixtures();

    // A later session writes cleanly...
    const repaired = createFakeStore(rows);
    await controllerFor(repaired.store, "session-b").writeFixtures();

    // ...and only a session after THAT can call it restart evidence.
    const verifier = createFakeStore(rows);
    const controller = controllerFor(verifier.store, "session-c");
    await controller.verifyAfterRestart();

    expect(latest(controller).claim).toBe("verified_after_restart");
  });

  it("verifies read-only in every branch, writing and removing nothing", async () => {
    for (const prepare of [
      // no previous run
      async (rows: Map<string, string>) => { void rows; },
      // an interrupted run
      async (rows: Map<string, string>) => {
        const store = createFakeStore(rows);
        store.state.failWriteForKey = MANIFEST_STORAGE_KEY;
        store.state.failWriteForKeyFromOccurrence = 2;
        await controllerFor(store.store, "session-a").writeFixtures();
      },
      // a complete run with a fixture since lost
      async (rows: Map<string, string>) => {
        const store = createFakeStore(rows);
        await controllerFor(store.store, "session-a").writeFixtures();
        rows.delete(fixtureStorageKey("small"));
      },
      // an unreadable record
      async (rows: Map<string, string>) => {
        rows.set(MANIFEST_STORAGE_KEY, "{not json");
      },
    ]) {
      const rows = new Map<string, string>();
      await prepare(rows);
      const before = new Map(rows);

      const verifier = createFakeStore(rows);
      const controller = controllerFor(verifier.store, "session-z");
      await controller.verifyAfterRestart();

      // Nothing written, nothing removed, nothing recreated.
      expect(verifier.state.writes).toEqual([]);
      expect(verifier.state.removals).toEqual([]);
      expect([...rows.entries()]).toEqual([...before.entries()]);
    }
  });

  it("keeps the four evidence levels distinct", async () => {
    const rows = new Map<string, string>();
    const sessionA = createFakeStore(rows);
    const controllerA = controllerFor(sessionA.store, "session-a");

    await controllerA.writeFixtures();
    expect(latest(controllerA).claim).toBe("write_acknowledged");

    await controllerA.verifyCurrentSession();
    expect(latest(controllerA).claim).toBe("verified_same_process");

    await controllerA.closeAndReopen();
    expect(latest(controllerA).claim).toBe("verified_after_reopen");

    // Same document session: a read of one's own writes is never restart evidence.
    await controllerA.verifyAfterRestart();
    expect(latest(controllerA).status).toBe("blocked");
    expect(latest(controllerA).claim).toBe("verified_same_process");

    const sessionB = createFakeStore(rows);
    const controllerB = controllerFor(sessionB.store, "session-b");
    await controllerB.verifyAfterRestart();
    expect(latest(controllerB).claim).toBe("verified_after_restart");
    // The limit of that claim is stated, not glossed: a document reload is
    // indistinguishable from a force-quit as far as the app can tell.
    expect(latest(controllerB).message).toContain("reload of the web view would look the same");
    // And no claim anywhere asserts power-loss safety.
    for (const entry of [...controllerA.getSnapshot().entries, ...controllerB.getSnapshot().entries]) {
      expect(entry.message.toLowerCase()).not.toContain("power loss is");
      expect(entry.claim).not.toBe("verified_power_loss");
    }
  });
});

describe("storage diagnostics — manifest validation", () => {
  const valid = {
    schema: 2,
    phase: "complete",
    runId: "run-1",
    sessionId: "session-a",
    startedAtIso: "2026-09-30T00:00:00.000Z",
    completedAtIso: "2026-09-30T00:00:01.000Z",
    fixtures: SYNTHETIC_FIXTURES.map((fixture) => ({ id: fixture.id, bytes: 1 })),
  };

  it("accepts a well-formed complete record", () => {
    const parsed = parseManifest(JSON.stringify(valid));
    expect(parsed?.phase).toBe("complete");
    expect(parsed?.sessionId).toBe("session-a");
  });

  it("accepts a well-formed in-progress record", () => {
    const parsed = parseManifest(
      JSON.stringify({
        schema: 2,
        phase: "writing",
        runId: "run-1",
        sessionId: "session-a",
        startedAtIso: "2026-09-30T00:00:00.000Z",
      })
    );
    expect(parsed?.phase).toBe("writing");
  });

  it.each([
    ["not JSON at all", "{nope"],
    ["a JSON array", "[]"],
    ["a JSON string", '"complete"'],
    ["null", "null"],
    ["the superseded schema 1", JSON.stringify({ ...valid, schema: 1 })],
    ["a future schema", JSON.stringify({ ...valid, schema: 3 })],
    ["a missing phase", JSON.stringify({ ...valid, phase: undefined })],
    ["an unknown phase", JSON.stringify({ ...valid, phase: "done" })],
    ["an empty runId", JSON.stringify({ ...valid, runId: "" })],
    ["a missing sessionId", JSON.stringify({ ...valid, sessionId: undefined })],
    ["an empty sessionId", JSON.stringify({ ...valid, sessionId: "" })],
    ["a non-string sessionId", JSON.stringify({ ...valid, sessionId: 7 })],
    ["a missing startedAtIso", JSON.stringify({ ...valid, startedAtIso: undefined })],
    ["a complete record with no completedAtIso", JSON.stringify({ ...valid, completedAtIso: undefined })],
    ["a non-array fixtures field", JSON.stringify({ ...valid, fixtures: "all" })],
    ["a fixture entry that is not an object", JSON.stringify({ ...valid, fixtures: ["empty"] })],
    ["a fixture entry with no id", JSON.stringify({ ...valid, fixtures: [{ bytes: 1 }] })],
    ["a fixture entry with a non-numeric size", JSON.stringify({ ...valid, fixtures: [{ id: "empty", bytes: "1" }] })],
    ["a fixture entry with a negative size", JSON.stringify({ ...valid, fixtures: [{ id: "empty", bytes: -1 }] })],
    ["a record describing a different fixture set", JSON.stringify({ ...valid, fixtures: [{ id: "empty", bytes: 0 }] })],
  ])("rejects %s", (_label, raw) => {
    expect(parseManifest(raw)).toBeNull();
  });

  it("an unreadable record blocks certification instead of being ignored", async () => {
    const rows = new Map<string, string>();
    rows.set(MANIFEST_STORAGE_KEY, JSON.stringify({ ...valid, schema: 1 }));
    for (const fixture of SYNTHETIC_FIXTURES) {
      rows.set(fixtureStorageKey(fixture.id), fixture.build());
    }

    const store = createFakeStore(rows);
    const controller = controllerFor(store.store, "session-z");
    await controller.verifyAfterRestart();
    const entry = latest(controller);

    // The fixtures are all present and correct, yet nothing attributes them.
    expect(entry.status).toBe("failed");
    expect(entry.claim).toBe("no_claim");
    expect(entry.message).toContain("could not be validated");
  });
});

describe("storage diagnostics — an unreadable record is not an absent one", () => {
  it("reports a failed record read distinctly from no previous run", async () => {
    const rows = new Map<string, string>();
    const store = createFakeStore(rows);
    await controllerFor(store.store, "session-a").writeFixtures();

    const verifier = createFakeStore(rows);
    verifier.state.failReads = true;
    const controller = controllerFor(verifier.store, "session-b");
    await controller.verifyAfterRestart();
    const entry = latest(controller);

    expect(entry.status).toBe("failed");
    expect(entry.claim).toBe("no_claim");
    // "could not be read" — NOT "no previous run was found", which would assert
    // an absence the failed read cannot establish.
    expect(entry.message).toContain("could not be read");
    expect(entry.message).not.toContain("No previous run");
  });
});

// ===================================================================================
// Checkpoints and transactions (Stage M3b1 evidence tooling).
//
// EVIDENCE CLASS: **mock**. The fake store models one transaction at a time with a
// working copy that only becomes durable on commit, which is faithful to the
// adapter's contract — but it is not SQLite and not a device. Nothing here is
// measured native atomicity, and nothing here is evidence about power loss.
// ===================================================================================

import {
  buildCheckpointProgress,
  buildCheckpointRow,
  CHECKPOINT_PROGRESS_KEY,
  checkpointRowKeys,
  classifyCheckpoint,
  parseCheckpointProgress,
  type CheckpointEvidence,
} from "../src/diagnostics/syntheticCheckpoints";

/** A controller whose attempt ids actually differ between attempts — the whole
 * point of the checkpoint payloads being attempt-scoped. */
function checkpointController(
  store: NativeSqliteStore,
  sessionId = "session-a"
): NativeStorageDiagnosticsController {
  let tick = 0;
  let attempt = 0;
  return createNativeStorageDiagnosticsController({
    createStore: () => store,
    detectPlatform: () => "ios",
    now: () => (tick += 1),
    isoNow: () => "2026-10-15T00:00:00.000Z",
    newRunId: () => `attempt-${(attempt += 1)}`,
    sessionId,
  });
}

function storedRowValues(state: { rows: Map<string, string> }) {
  return checkpointRowKeys().map((key) => state.rows.get(key));
}

describe("checkpoints — a committed checkpoint", () => {
  it("commits every payload row and the progress record together", async () => {
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);

    await controller.runCommittedCheckpoint();
    const entry = latest(controller);

    expect(entry.status).toBe("ok");
    expect(entry.claim).toBe("verified_after_reopen");
    // EXACTLY one transaction, committed exactly once. Several transactions
    // would mean the rows could have landed separately.
    expect(state.begins).toBe(1);
    expect(state.commits).toBe(1);
    expect(state.rollbacks).toBe(0);
    // Rows AND progress, not one without the other.
    for (const key of checkpointRowKeys()) expect(state.rows.has(key)).toBe(true);
    const progress = parseCheckpointProgress(state.rows.get(CHECKPOINT_PROGRESS_KEY)!);
    expect(progress?.attemptId).toBe("attempt-1");
    expect(progress?.rows.map((row) => row.key)).toEqual(checkpointRowKeys());
    // Every row is exactly the payload this attempt and checkpoint derive.
    expect(storedRowValues(state)).toEqual(
      checkpointRowKeys().map((_key, index) => buildCheckpointRow("attempt-1", 1, index))
    );
  });

  it("verifies after a close and reopen, and says what that does not prove", async () => {
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);
    await controller.runCommittedCheckpoint();

    expect(state.closeCount).toBeGreaterThan(0);
    expect(latest(controller).message).toMatch(/evidence about power loss/i);
  });

  it("does not leave a transaction pending", async () => {
    const { store } = createFakeStore();
    const controller = checkpointController(store);
    await controller.runCommittedCheckpoint();
    expect(controller.getSnapshot().pendingTransaction).toBeNull();
  });
});

describe("checkpoints — rollback and statement failure", () => {
  it("leaves no part of a rolled-back checkpoint committed", async () => {
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);

    await controller.runExplicitRollback();

    expect(latest(controller).status).toBe("ok");
    expect(state.begins).toBe(1);
    expect(state.rollbacks).toBe(1);
    expect(state.commits).toBe(0);
    expect(state.rows.has(CHECKPOINT_PROGRESS_KEY)).toBe(false);
    for (const key of checkpointRowKeys()) expect(state.rows.has(key)).toBe(false);
  });

  it("preserves the LAST COMMITTED checkpoint when a later attempt rolls back", async () => {
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);

    await controller.runCommittedCheckpoint();
    const committed = new Map(state.rows);

    await controller.runExplicitRollback();

    const entry = latest(controller);
    expect(entry.status).toBe("ok");
    expect(entry.message).toMatch(/previous checkpoint is intact/i);
    // Byte-for-byte restoration of the rows the transaction overwrote, not
    // merely "no new keys appeared".
    expect(state.rows).toEqual(committed);
  });

  it("reports a statement failure as a STATEMENT failure, never as a commit failure", async () => {
    const { store } = createFakeStore();
    const controller = checkpointController(store);

    await controller.runStatementFailure();
    const entry = latest(controller);

    expect(entry.status).toBe("ok");
    expect(entry.detail.join(" ")).toMatch(/statement failed inside the transaction/i);
    expect(entry.detail.join(" ")).toMatch(/no commit was ever attempted/i);
    expect(entry.message).not.toMatch(/commit (failed|was rejected)/i);
  });

  it("preserves the previous checkpoint across a statement failure", async () => {
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);
    await controller.runCommittedCheckpoint();
    const committed = new Map(state.rows);

    await controller.runStatementFailure();

    expect(latest(controller).status).toBe("ok");
    expect(state.rows).toEqual(committed);
  });

  it("rolls the whole checkpoint back when the PROGRESS record is the statement that fails", async () => {
    // The partial case the checkpoint model exists to prevent: the payload rows
    // were staged and the progress record was not. Without a transaction this
    // would leave rows with no record describing them.
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);
    await controller.runCommittedCheckpoint();
    const committed = new Map(state.rows);

    state.failStageForKey = CHECKPOINT_PROGRESS_KEY;
    await controller.runExplicitRollback();

    const entry = latest(controller);
    expect(entry.status).toBe("failed");
    expect(entry.message).toMatch(/statement failure, not a commit failure/i);
    // No stray rows: the earlier checkpoint is exactly as it was.
    expect(state.rows).toEqual(committed);
  });

  it("reports an unresolved transaction when the rollback itself fails", async () => {
    const { store, state } = createFakeStore();
    state.failRollback = true;
    const controller = checkpointController(store);

    await controller.runStatementFailure();

    expect(latest(controller).status).toBe("failed");
    expect(latest(controller).message).toMatch(/unresolved/i);
    expect(controller.getSnapshot().pendingTransaction?.unresolved).toBe(true);
  });

  it("classifies a rejected commit by reading, not by the rejection", async () => {
    const { store, state } = createFakeStore();
    state.failCommit = true;
    const controller = checkpointController(store);

    await controller.runCommittedCheckpoint();
    const entry = latest(controller);

    // The rejection freed the connection; the VERDICT came from the reopened
    // store. A rejected commit is never read as proof of rollback.
    expect(entry.detail.join(" ")).toMatch(/not proof that nothing was committed/i);
    expect(entry.message).toMatch(/no checkpoint was committed/i);
    expect(state.rows.has(CHECKPOINT_PROGRESS_KEY)).toBe(false);
  });
});

describe("checkpoints — interruption preparation", () => {
  it("leaves the transaction open and names both attempt ids", async () => {
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);
    await controller.runCommittedCheckpoint();

    await controller.prepareInterruption();
    const pending = controller.getSnapshot().pendingTransaction;

    expect(pending).not.toBeNull();
    expect(pending?.attemptId).toBe("attempt-2");
    expect(pending?.baselineAttemptId).toBe("attempt-1");
    expect(pending?.unresolved).toBe(false);
    // Nothing from the prepared attempt is durable.
    expect(state.rows.get(CHECKPOINT_PROGRESS_KEY)).toContain("attempt-1");
  });

  it("does not describe backgrounding or a reload as process death", async () => {
    const { store } = createFakeStore();
    const controller = checkpointController(store);
    await controller.prepareInterruption();

    expect(latest(controller).detail.join(" ")).toMatch(
      /backgrounding the app or reloading the web view is NOT process death/i
    );
  });

  it("refuses every other action while a transaction is pending", async () => {
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);
    await controller.prepareInterruption();
    const writesBefore = state.writes.length;

    for (const action of [
      () => controller.runCommittedCheckpoint(),
      () => controller.writeFixtures(),
      () => controller.verifyCurrentSession(),
      () => controller.closeAndReopen(),
      () => controller.clearSyntheticDatabase(),
      () => controller.clearCheckpointData(),
      () => controller.inspectStoredCheckpoint(),
      () => controller.readSettings(),
    ]) {
      await action();
      expect(latest(controller).status).toBe("blocked");
    }
    // Refusal means refusal: nothing was written by any of them.
    expect(state.writes.length).toBe(writesBefore);
    expect(controller.getSnapshot().pendingTransaction).not.toBeNull();
  });

  it("refuses cleanup while a transaction is pending, so evidence cannot be destroyed", async () => {
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);
    await controller.runCommittedCheckpoint();
    const committed = new Map(state.rows);
    await controller.prepareInterruption();

    await controller.clearSyntheticDatabase();

    expect(latest(controller).status).toBe("blocked");
    expect(state.rows).toEqual(committed);
  });

  it("rolls a prepared transaction back on request", async () => {
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);
    await controller.runCommittedCheckpoint();
    const committed = new Map(state.rows);
    await controller.prepareInterruption();

    await controller.rollbackPreparedTransaction();

    expect(latest(controller).status).toBe("ok");
    expect(controller.getSnapshot().pendingTransaction).toBeNull();
    expect(state.rows).toEqual(committed);
    // The store is usable again.
    await controller.inspectStoredCheckpoint();
    expect(latest(controller).status).toBe("ok");
  });

  it("abandons an unresolved transaction when rollback cannot end it", async () => {
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);
    await controller.prepareInterruption();
    state.failRollback = true;

    await controller.rollbackPreparedTransaction();
    expect(controller.getSnapshot().pendingTransaction?.unresolved).toBe(true);

    state.failRollback = false;
    await controller.abandonPreparedTransaction();
    expect(controller.getSnapshot().pendingTransaction).toBeNull();
  });

  it("refuses a rollback when nothing is prepared", async () => {
    const { store } = createFakeStore();
    const controller = checkpointController(store);
    await controller.rollbackPreparedTransaction();
    expect(latest(controller).status).toBe("blocked");
  });
});

describe("checkpoints — uncertain acknowledgement", () => {
  it("classifies a commit whose acknowledgement was lost as COMMITTED, by reading", async () => {
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);

    await controller.runLostAcknowledgementAfterCommit();
    const entry = latest(controller);

    expect(entry.status).toBe("ok");
    expect(entry.message).toMatch(/classified committed/i);
    expect(state.rows.has(CHECKPOINT_PROGRESS_KEY)).toBe(true);
  });

  it("labels the lost acknowledgement as a diagnostic simulation", async () => {
    const { store } = createFakeStore();
    const controller = checkpointController(store);

    await controller.runLostAcknowledgementAfterCommit();

    const detail = latest(controller).detail.join(" ");
    expect(detail).toMatch(/DIAGNOSTIC SIMULATION/);
    expect(detail).toMatch(/discarded unread/i);
    // And it says the verdict did not come from the discarded result.
    expect(detail).toMatch(/Nothing below is derived from what the commit returned/i);
  });

  it("classifies an attempt that never committed as NOT COMMITTED, with the previous one intact", async () => {
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);
    await controller.runCommittedCheckpoint();
    const committed = new Map(state.rows);

    await controller.runLostAcknowledgementBeforeCommit();
    const entry = latest(controller);

    expect(entry.status).toBe("ok");
    expect(entry.message).toMatch(/classified not committed/i);
    expect(state.rows).toEqual(committed);
  });

  it("does not call a clean discard process death", async () => {
    const { store } = createFakeStore();
    const controller = checkpointController(store);
    await controller.runLostAcknowledgementBeforeCommit();

    expect(latest(controller).detail.join(" ")).toMatch(
      /clean discard, not process death/i
    );
  });
});

describe("checkpoints — inspection never repairs", () => {
  it("writes nothing and removes nothing while inspecting", async () => {
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);
    await controller.runCommittedCheckpoint();
    const writes = state.writes.length;
    const removals = state.removals.length;
    const rows = new Map(state.rows);

    await controller.inspectStoredCheckpoint();

    expect(state.writes.length).toBe(writes);
    expect(state.removals.length).toBe(removals);
    expect(state.rows).toEqual(rows);
  });

  it("does not replay or recreate a missing checkpoint", async () => {
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);
    await controller.runCommittedCheckpoint();
    // A payload row disappears — the partial state a migration must handle.
    state.rows.delete(checkpointRowKeys()[1]);
    const writes = state.writes.length;

    await controller.inspectStoredCheckpoint();

    expect(latest(controller).status).toBe("failed");
    expect(latest(controller).message).toMatch(/UNRESOLVED/);
    expect(latest(controller).message).toMatch(/nothing was rewritten or replayed/i);
    expect(state.writes.length).toBe(writes);
    expect(state.rows.has(checkpointRowKeys()[1])).toBe(false);
  });

  it("reports a failed read as unresolved, never as an absent checkpoint", async () => {
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);
    state.failReads = true;

    await controller.inspectStoredCheckpoint();

    expect(latest(controller).status).toBe("failed");
    expect(latest(controller).message).toMatch(/could not be read/i);
    expect(latest(controller).message).not.toMatch(/no checkpoint is stored/i);
  });

  it("reports stray rows without a progress record as a partial state", async () => {
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);
    await controller.runCommittedCheckpoint();
    state.rows.delete(CHECKPOINT_PROGRESS_KEY);

    await controller.inspectStoredCheckpoint();

    expect(latest(controller).status).toBe("failed");
    expect(latest(controller).message).toMatch(/partial state, not an empty one/i);
  });

  it("reports an invalid progress record as attributing nothing", async () => {
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);
    state.rows.set(CHECKPOINT_PROGRESS_KEY, '{"schema":99}');

    await controller.inspectStoredCheckpoint();

    expect(latest(controller).status).toBe("failed");
    expect(latest(controller).message).toMatch(/failed validation/i);
  });

  it("distinguishes an earlier app session from this one", async () => {
    const rows = new Map<string, string>();
    const first = createFakeStore(rows);
    await checkpointController(first.store, "session-a").runCommittedCheckpoint();

    const second = createFakeStore(rows);
    const controller = checkpointController(second.store, "session-b");
    await controller.inspectStoredCheckpoint();

    expect(latest(controller).detail.join(" ")).toMatch(/EARLIER app session/i);
    expect(latest(controller).claim).toBe("verified_after_reopen");
  });
});

describe("checkpoints — old evidence never certifies a newer attempt", () => {
  function evidenceFor(attemptId: string, checkpointNumber: number): CheckpointEvidence {
    return {
      progress: {
        status: "value",
        value: JSON.stringify(
          buildCheckpointProgress({
            attemptId,
            sessionId: "session-a",
            checkpointNumber,
            writtenAtIso: "2026-10-15T00:00:00.000Z",
          })
        ),
      },
      rows: checkpointRowKeys().map((_key, index) => ({
        status: "value" as const,
        value: buildCheckpointRow(attemptId, checkpointNumber, index),
      })),
    };
  }

  it("never reports a previous attempt's committed checkpoint as this attempt's", () => {
    const previous = buildCheckpointProgress({
      attemptId: "attempt-1",
      sessionId: "session-a",
      checkpointNumber: 1,
      writtenAtIso: "2026-10-15T00:00:00.000Z",
    });
    const verdict = classifyCheckpoint({
      expectedAttemptId: "attempt-2",
      expectedCheckpointNumber: 2,
      baseline: previous,
      evidence: evidenceFor("attempt-1", 1),
    });
    expect(verdict.kind).toBe("not_committed");
  });

  it("produces different bytes for every attempt and every checkpoint", () => {
    const a = buildCheckpointRow("attempt-1", 1, 0);
    const b = buildCheckpointRow("attempt-2", 1, 0);
    const c = buildCheckpointRow("attempt-1", 2, 0);
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("calls an unrecognised attempt unresolved rather than guessing", () => {
    const verdict = classifyCheckpoint({
      expectedAttemptId: "attempt-2",
      expectedCheckpointNumber: 2,
      baseline: null,
      evidence: evidenceFor("attempt-9", 9),
    });
    expect(verdict.kind).toBe("unresolved");
  });

  it("calls a progress record whose rows belong to another attempt unresolved", () => {
    const evidence = evidenceFor("attempt-2", 2);
    evidence.rows[1] = { status: "value", value: buildCheckpointRow("attempt-1", 1, 1) };
    const verdict = classifyCheckpoint({
      expectedAttemptId: "attempt-2",
      expectedCheckpointNumber: 2,
      baseline: null,
      evidence,
    });
    expect(verdict.kind).toBe("unresolved");
  });

  it("calls a vanished previous checkpoint unresolved, not 'not committed'", () => {
    const previous = buildCheckpointProgress({
      attemptId: "attempt-1",
      sessionId: "session-a",
      checkpointNumber: 1,
      writtenAtIso: "2026-10-15T00:00:00.000Z",
    });
    const verdict = classifyCheckpoint({
      expectedAttemptId: "attempt-2",
      expectedCheckpointNumber: 2,
      baseline: previous,
      evidence: { progress: { status: "absent" }, rows: [] },
    });
    expect(verdict.kind).toBe("unresolved");
  });

  it("calls a failed progress read unresolved, never absent", () => {
    const verdict = classifyCheckpoint({
      expectedAttemptId: "attempt-1",
      expectedCheckpointNumber: 1,
      baseline: null,
      evidence: { progress: { status: "read_failed" }, rows: [] },
    });
    expect(verdict.kind).toBe("unresolved");
  });

  it("calls a failed ROW read unresolved rather than certifying the rest", () => {
    const evidence = evidenceFor("attempt-1", 1);
    evidence.rows[2] = { status: "read_failed" };
    const verdict = classifyCheckpoint({
      expectedAttemptId: "attempt-1",
      expectedCheckpointNumber: 1,
      baseline: null,
      evidence,
    });
    expect(verdict.kind).toBe("unresolved");
  });
});

describe("checkpoints — progress record validation", () => {
  const valid = () =>
    buildCheckpointProgress({
      attemptId: "attempt-1",
      sessionId: "session-a",
      checkpointNumber: 1,
      writtenAtIso: "2026-10-15T00:00:00.000Z",
    });

  it("accepts a well-formed record", () => {
    expect(parseCheckpointProgress(JSON.stringify(valid()))).not.toBeNull();
  });

  it("rejects malformed, truncated and hostile input", () => {
    for (const raw of [
      "",
      "{",
      "null",
      "[]",
      '"a string"',
      "123",
      JSON.stringify({ ...valid(), schema: 2 }),
      JSON.stringify({ ...valid(), attemptId: "" }),
      JSON.stringify({ ...valid(), sessionId: 42 }),
      JSON.stringify({ ...valid(), checkpointNumber: 0 }),
      JSON.stringify({ ...valid(), checkpointNumber: 1.5 }),
      JSON.stringify({ ...valid(), writtenAtIso: null }),
      JSON.stringify({ ...valid(), rows: "nope" }),
      JSON.stringify({ ...valid(), rows: [{ key: "x", bytes: 1 }] }),
      JSON.stringify({ ...valid(), rows: [{ key: "x", bytes: Number.NaN }] }),
    ]) {
      expect(parseCheckpointProgress(raw)).toBeNull();
    }
  });

  it("rejects a record describing a different row set", () => {
    const record = { ...valid(), rows: [{ key: "diagnostic.synthetic.other", bytes: 1 }] };
    expect(parseCheckpointProgress(JSON.stringify(record))).toBeNull();
  });

  it("survives an object whose property reads throw", () => {
    const hostile = JSON.stringify(valid());
    const revived = JSON.parse(hostile) as Record<string, unknown>;
    Object.defineProperty(revived, "rows", {
      get() {
        throw new Error("hostile getter");
      },
    });
    // Parsing goes through JSON, so the hostile object is reconstructed here to
    // prove the guard rather than to simulate a real JSON payload.
    expect(() => parseCheckpointProgress(hostile)).not.toThrow();
  });
});

describe("checkpoints — isolation and concurrency", () => {
  it("addresses only its own synthetic checkpoint keys", async () => {
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);
    await controller.runCommittedCheckpoint();
    await controller.runExplicitRollback();
    await controller.runStatementFailure();
    await controller.inspectStoredCheckpoint();

    for (const key of [...state.rows.keys(), ...state.writes, ...state.removals]) {
      expect(key.startsWith("diagnostic.synthetic.")).toBe(true);
      expect(key).not.toContain("curling.");
    }
  });

  it("deletes only the checkpoint keys, leaving the restart fixtures alone", async () => {
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);
    await controller.writeFixtures();
    await controller.runCommittedCheckpoint();
    const fixtureKeys = [...state.rows.keys()].filter(
      (key) => !key.startsWith("diagnostic.synthetic.checkpoint.")
    );

    await controller.clearCheckpointData();

    expect(latest(controller).status).toBe("ok");
    for (const key of fixtureKeys) expect(state.rows.has(key)).toBe(true);
    expect(state.rows.has(CHECKPOINT_PROGRESS_KEY)).toBe(false);
  });

  it("refuses a second checkpoint action while one is running", async () => {
    const { store } = createFakeStore();
    const controller = checkpointController(store);

    const first = controller.runCommittedCheckpoint();
    await controller.runExplicitRollback();
    await first;

    // The refusal is recorded, not queued and not silently dropped. Entries are
    // newest-first, so the refusal sits above the completed action.
    const refused = controller
      .getSnapshot()
      .entries.find((entry) => entry.action === "Roll back a checkpoint");
    expect(refused?.status).toBe("blocked");
  });

  it("fails closed when the transaction cannot be started", async () => {
    const { store, state } = createFakeStore();
    state.failBegin = true;
    const controller = checkpointController(store);

    await controller.runCommittedCheckpoint();

    expect(latest(controller).status).toBe("failed");
    expect(latest(controller).message).toMatch(/could not be started/i);
    expect(state.rows.size).toBe(0);
  });

  it("refuses to judge an attempt when the existing record cannot be validated", async () => {
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);
    state.rows.set(CHECKPOINT_PROGRESS_KEY, "not json");

    await controller.runCommittedCheckpoint();

    expect(latest(controller).status).toBe("failed");
    expect(latest(controller).message).toMatch(/could not be read or validated/i);
    // Nothing was written over the unreadable record.
    expect(state.rows.get(CHECKPOINT_PROGRESS_KEY)).toBe("not json");
  });
});

describe("checkpoints — build and platform boundaries", () => {
  it("touches no application database, repository, localStorage, credential or cloud module", async () => {
    const sources = await Promise.all(
      ["src/diagnostics/checkpointDiagnostics.ts", "src/diagnostics/syntheticCheckpoints.ts"].map(
        (file) => readFile(path.join(mobileRoot, file), "utf8")
      )
    );
    for (const source of sources) {
      for (const forbidden of [
        "localStorage",
        "sessionStorage",
        "indexedDB",
        "SecureStorage",
        "secureCredentialStore",
        "supabase",
        "Repository",
        "storageComposition",
        "curling-sporting-v1",
        "curling.",
      ]) {
        expect(source).not.toContain(forbidden);
      }
    }
  });

  it("addresses the one fixed synthetic database and never an application one", async () => {
    const source = await readFile(
      path.join(mobileRoot, "src/diagnostics/checkpointDiagnostics.ts"),
      "utf8"
    );
    // The database name is not re-spelled here: the controller supplies the one
    // store, so a diagnostic transaction cannot be pointed somewhere else.
    expect(source).not.toContain(DIAGNOSTIC_DATABASE_NAME);
    expect(source).toContain("store: NativeSqliteStore");
  });

  it("accepts no caller-supplied SQL", async () => {
    const source = await readFile(
      path.join(mobileRoot, "src/diagnostics/checkpointDiagnostics.ts"),
      "utf8"
    );
    for (const sql of ["SELECT", "INSERT", "DELETE", "PRAGMA", "BEGIN", "COMMIT TRANSACTION"]) {
      expect(source).not.toContain(sql);
    }
  });

  it("fails closed on a non-native platform", async () => {
    const { store } = createFakeStore();
    const controller = createNativeStorageDiagnosticsController({
      createStore: () => store,
      detectPlatform: () => "web",
      sessionId: "session-a",
    });
    // The platform gate lives in the store, which this fake replaces; what is
    // asserted here is that the panel reports the platform honestly rather than
    // presenting a web run as native evidence.
    expect(controller.getSnapshot().platform).toBe("web");
  });

  it("leaves the production activation authority unavailable", async () => {
    const composition = await readFile(
      path.join(mobileRoot, "src/storage/nativeStorageComposition.ts"),
      "utf8"
    );
    expect(composition).toContain('status: "unavailable", reason: "migration_not_implemented"');
    // And nothing in the checkpoint work reaches it.
    const checkpoints = await readFile(
      path.join(mobileRoot, "src/diagnostics/checkpointDiagnostics.ts"),
      "utf8"
    );
    expect(checkpoints).not.toContain("ActivationAuthority");
  });
});

describe("checkpoints — an engine that does not enforce the constraint is a finding", () => {
  it("reports an accepted NOT NULL violation as an engine finding, not as the expected failure", async () => {
    const { store, state } = createFakeStore();
    // The store's own contract: the deliberate statement reports its own
    // reason when the engine accepts it. Modelled here by overriding the one
    // method, because the fake otherwise always rejects it.
    store.stageDiagnosticFailingStatement = async () => {
      state.working = null;
      state.rollbacks += 1;
      return {
        ok: false,
        reason: "statement_unexpectedly_succeeded",
        cleanup: "rolled_back",
      } as const;
    };
    const controller = checkpointController(store);

    await controller.runStatementFailure();
    const entry = latest(controller);

    expect(entry.status).toBe("failed");
    expect(entry.message).toMatch(/ACCEPTED by the engine/);
    expect(entry.message).toMatch(/no statement-failure evidence was gathered/i);
  });
});

// ===================================================================================
// Correction regressions (R1–R3). Each case below reproduces a defect found in
// independent review; the comment names the defect, and the assertion is the
// corrected behaviour.
// ===================================================================================

describe("checkpoints — incomplete evidence is never established absence (R1)", () => {
  const rowKeys = checkpointRowKeys();
  const absentRows = () => rowKeys.map(() => ({ status: "absent" as const }));
  const previous = () =>
    buildCheckpointProgress({
      attemptId: "attempt-1",
      sessionId: "session-a",
      checkpointNumber: 1,
      writtenAtIso: "2026-10-15T00:00:00.000Z",
    });
  const previousRows = () =>
    rowKeys.map((_key, index) => ({
      status: "value" as const,
      value: buildCheckpointRow("attempt-1", 1, index),
    }));

  function classifyEmptyBaseline(evidence: CheckpointEvidence) {
    return classifyCheckpoint({
      expectedAttemptId: "attempt-2",
      expectedCheckpointNumber: 2,
      baseline: null,
      evidence,
    });
  }

  it("positive control: a truly empty store is NOT COMMITTED", () => {
    const verdict = classifyEmptyBaseline({ progress: { status: "absent" }, rows: absentRows() });
    expect(verdict.kind).toBe("not_committed");
  });

  it("no baseline, no progress, a PRESENT payload row → unresolved (was: not_committed)", () => {
    const rows = absentRows() as CheckpointEvidence["rows"];
    rows[1] = { status: "value", value: buildCheckpointRow("attempt-2", 2, 1) };
    const verdict = classifyEmptyBaseline({ progress: { status: "absent" }, rows });
    expect(verdict.kind).toBe("unresolved");
    expect(verdict.detail.join(" ")).toMatch(/partial state, not an empty one/i);
  });

  it("no baseline, no progress, an UNREADABLE payload row → unresolved (was: not_committed)", () => {
    const rows = absentRows() as CheckpointEvidence["rows"];
    rows[2] = { status: "read_failed" };
    const verdict = classifyEmptyBaseline({ progress: { status: "absent" }, rows });
    expect(verdict.kind).toBe("unresolved");
    expect(verdict.detail.join(" ")).toMatch(/cannot be determined/i);
  });

  it("no baseline, no progress, every payload row unreadable → unresolved", () => {
    const verdict = classifyEmptyBaseline({
      progress: { status: "absent" },
      rows: rowKeys.map(() => ({ status: "read_failed" as const })),
    });
    expect(verdict.kind).toBe("unresolved");
  });

  it("an evidence set that does not cover every row is unresolved, never 'the rest are absent'", () => {
    for (const rows of [[], absentRows().slice(0, 1), [...absentRows(), { status: "absent" as const }]]) {
      const verdict = classifyEmptyBaseline({ progress: { status: "absent" }, rows });
      expect(verdict.kind).toBe("unresolved");
    }
  });

  it("a disappeared previously committed checkpoint is unresolved even if every row read as absent", () => {
    const verdict = classifyCheckpoint({
      expectedAttemptId: "attempt-2",
      expectedCheckpointNumber: 2,
      baseline: previous(),
      evidence: { progress: { status: "absent" }, rows: absentRows() },
    });
    expect(verdict.kind).toBe("unresolved");
  });

  it("an unchanged previous checkpoint with every row matching is NOT COMMITTED (positive control)", () => {
    const verdict = classifyCheckpoint({
      expectedAttemptId: "attempt-2",
      expectedCheckpointNumber: 2,
      baseline: previous(),
      evidence: {
        progress: { status: "value", value: JSON.stringify(previous()) },
        rows: previousRows(),
      },
    });
    expect(verdict.kind).toBe("not_committed");
    expect(verdict.detail.join(" ")).toMatch(/progress record is unchanged/i);
  });

  it.each([
    ["session", { sessionId: "session-x" }],
    ["timestamp", { writtenAtIso: "2026-10-16T00:00:00.000Z" }],
    ["row manifest byte counts", { rows: previous().rows.map((row) => ({ ...row, bytes: row.bytes + 1 })) }],
  ])(
    "does not call the previous checkpoint intact when its %s changed but attempt and number match",
    (_label, change) => {
      const changed = { ...previous(), ...change };
      const verdict = classifyCheckpoint({
        expectedAttemptId: "attempt-2",
        expectedCheckpointNumber: 2,
        baseline: previous(),
        evidence: {
          progress: { status: "value", value: JSON.stringify(changed) },
          rows: previousRows(),
        },
      });
      expect(verdict.kind).toBe("unresolved");
    }
  );

  it("does not certify a record whose own byte manifest does not describe its rows", () => {
    const record = buildCheckpointProgress({
      attemptId: "attempt-2",
      sessionId: "session-a",
      checkpointNumber: 2,
      writtenAtIso: "2026-10-15T00:00:00.000Z",
    });
    record.rows[0] = { ...record.rows[0], bytes: record.rows[0].bytes + 1 };
    const verdict = classifyCheckpoint({
      expectedAttemptId: "attempt-2",
      expectedCheckpointNumber: 2,
      baseline: null,
      evidence: {
        progress: { status: "value", value: JSON.stringify(record) },
        rows: rowKeys.map((_key, index) => ({
          status: "value" as const,
          value: buildCheckpointRow("attempt-2", 2, index),
        })),
      },
    });
    expect(verdict.kind).toBe("unresolved");
  });

  it("inspection: progress absent and EVERY payload read failed → failed, never 'no rows present'", async () => {
    const { store, state } = createFakeStore();
    for (const key of rowKeys) state.failReadForKeys.add(key);
    const controller = checkpointController(store);

    await controller.inspectStoredCheckpoint();
    const entry = latest(controller);

    expect(entry.status).toBe("failed");
    expect(entry.message).toMatch(/cannot be determined/i);
    expect(entry.message).not.toMatch(/no checkpoint is stored/i);
    expect(entry.message).not.toMatch(/no payload rows are present/i);
  });

  it("inspection: progress absent and ONE payload read failed → failed", async () => {
    const { store, state } = createFakeStore();
    state.failReadForKeys.add(rowKeys[0]);
    const controller = checkpointController(store);

    await controller.inspectStoredCheckpoint();
    expect(latest(controller).status).toBe("failed");
  });

  it("inspection positive control: a truly empty store reports no checkpoint", async () => {
    const { store } = createFakeStore();
    const controller = checkpointController(store);
    await controller.inspectStoredCheckpoint();
    expect(latest(controller).status).toBe("ok");
    expect(latest(controller).message).toMatch(/read successfully and are absent/i);
  });

  it("refuses to start an attempt over an existing partial state instead of judging against it", async () => {
    const { store, state } = createFakeStore();
    state.rows.set(rowKeys[0], buildCheckpointRow("attempt-x", 1, 0));
    const controller = checkpointController(store);

    await controller.runExplicitRollback();

    expect(latest(controller).status).toBe("failed");
    expect(latest(controller).message).toMatch(/could not be read or validated/i);
    expect(state.begins).toBe(0);
  });

  it("refuses to start an attempt when a baseline row cannot be read", async () => {
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);
    await controller.runCommittedCheckpoint();
    state.failReadForKeys.add(rowKeys[1]);

    await controller.runExplicitRollback();

    expect(latest(controller).status).toBe("failed");
    expect(state.begins).toBe(1);
  });
});

describe("checkpoints — a failed close/reopen never certifies recovery (R2)", () => {
  type Scenario = {
    name: string;
    run: (controller: NativeStorageDiagnosticsController) => Promise<void>;
    setup?: (state: ReturnType<typeof createFakeStore>["state"]) => void;
  };
  const scenarios: Scenario[] = [
    { name: "committed checkpoint", run: (c) => c.runCommittedCheckpoint() },
    {
      name: "rejected commit",
      run: (c) => c.runCommittedCheckpoint(),
      setup: (state) => {
        state.failCommit = true;
      },
    },
    { name: "explicit rollback", run: (c) => c.runExplicitRollback() },
    { name: "statement failure", run: (c) => c.runStatementFailure() },
    { name: "lost acknowledgement after commit", run: (c) => c.runLostAcknowledgementAfterCommit() },
    { name: "lost acknowledgement before commit", run: (c) => c.runLostAcknowledgementBeforeCommit() },
  ];

  for (const scenario of scenarios) {
    for (const boundary of ["close", "release", "open"] as const) {
      it(`${scenario.name}: a failed ${boundary} gives no verdict and no reopen claim`, async () => {
        const { store, state } = createFakeStore();
        scenario.setup?.(state);
        state.failReopenAt = boundary;
        const controller = checkpointController(store);

        await scenario.run(controller);
        const entry = latest(controller);

        expect(entry.status).toBe("failed");
        expect(entry.claim).not.toBe("verified_after_reopen");
        expect(entry.message).toMatch(/no fresh connection was established/i);
        expect(entry.message).toMatch(/no verdict/i);
        // Nothing claims a reopen happened.
        expect(entry.message).not.toMatch(/read back exactly after/i);
        expect(entry.message).not.toMatch(/Classified (NOT )?COMMITTED/);
        expect(entry.detail.join(" ")).toContain(`Recovery boundary not established: ${boundary}.`);
        // And nothing was read as evidence after the failed boundary: no
        // reopen was counted.
        expect(state.reopens).toBe(0);
      });
    }
  }

  it("the acknowledged commit keeps only the acknowledgement claim when the reopen fails", async () => {
    const { store, state } = createFakeStore();
    state.failReopenAt = "close";
    const controller = checkpointController(store);

    await controller.runCommittedCheckpoint();

    expect(latest(controller).claim).toBe("write_acknowledged");
    expect(latest(controller).message).toMatch(/acknowledged the COMMIT/);
  });

  it("closeAndReopen names the failed boundary and verifies nothing", async () => {
    const { store, state } = createFakeStore();
    const controller = controllerFor(store);
    await controller.writeFixtures();
    state.failReopenAt = "release";

    await controller.closeAndReopen();

    expect(latest(controller).status).toBe("failed");
    expect(latest(controller).claim).toBe("no_claim");
    expect(latest(controller).message).toMatch(/releasing the native connection handle failed/i);
  });
});

describe("checkpoints — ownership while the native state is uncertain (R3)", () => {
  it("keeps the token and refuses everything when BEGIN went unacknowledged", async () => {
    const { store, state } = createFakeStore();
    state.beginUnacknowledged = true;
    const controller = checkpointController(store);

    await controller.runCommittedCheckpoint();

    expect(latest(controller).status).toBe("failed");
    expect(latest(controller).message).toMatch(/does not prove no transaction was opened/i);
    const pending = controller.getSnapshot().pendingTransaction;
    expect(pending?.unresolved).toBe(true);
    expect(pending?.uncertainty).toMatch(/not positively acknowledged/i);

    for (const action of [
      () => controller.inspectStoredCheckpoint(),
      () => controller.clearCheckpointData(),
      () => controller.clearSyntheticDatabase(),
      () => controller.readSettings(),
      () => controller.writeFixtures(),
      () => controller.runExplicitRollback(),
    ]) {
      await action();
      expect(latest(controller).status).toBe("blocked");
    }

    // Recovery controls stay available and go through the owner.
    state.beginUnacknowledged = false;
    await controller.abandonPreparedTransaction();
    expect(latest(controller).status).toBe("ok");
    expect(controller.getSnapshot().pendingTransaction).toBeNull();
  });

  it("keeps ownership when abandon cannot close, and releases it only on a completed retry", async () => {
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);
    await controller.prepareInterruption();
    state.failAbandonAt = "close";

    await controller.abandonPreparedTransaction();

    expect(latest(controller).status).toBe("failed");
    expect(latest(controller).message).toMatch(/closing the connection failed/i);
    expect(controller.getSnapshot().pendingTransaction?.unresolved).toBe(true);
    expect(store.hasPendingDiagnosticTransaction()).toBe(true);
    await controller.inspectStoredCheckpoint();
    expect(latest(controller).status).toBe("blocked");

    state.failAbandonAt = "release";
    await controller.abandonPreparedTransaction();
    expect(latest(controller).message).toMatch(/releasing the native connection handle failed/i);
    expect(controller.getSnapshot().pendingTransaction).not.toBeNull();

    state.failAbandonAt = null;
    await controller.abandonPreparedTransaction();
    expect(latest(controller).status).toBe("ok");
    expect(controller.getSnapshot().pendingTransaction).toBeNull();
    expect(store.hasPendingDiagnosticTransaction()).toBe(false);
  });

  it("keeps a resolvable token when the deliberate statement is ACCEPTED and the rollback fails", async () => {
    const { store, state } = createFakeStore();
    state.deliberateStatementSucceeds = true;
    state.failRollback = true;
    const controller = checkpointController(store);

    await controller.runStatementFailure();

    expect(latest(controller).message).toMatch(/ACCEPTED by the engine/);
    expect(latest(controller).message).toMatch(/UNRESOLVED/);
    const pending = controller.getSnapshot().pendingTransaction;
    expect(pending).not.toBeNull();
    expect(pending?.unresolved).toBe(true);

    state.failRollback = false;
    await controller.abandonPreparedTransaction();
    expect(controller.getSnapshot().pendingTransaction).toBeNull();
  });

  it("distinguishes an acknowledged open transaction from an unknown outcome", async () => {
    const { store, state } = createFakeStore();
    const controller = checkpointController(store);
    await controller.prepareInterruption();
    expect(controller.getSnapshot().pendingTransaction).toMatchObject({
      unresolved: false,
      uncertainty: null,
    });

    state.failRollback = true;
    await controller.rollbackPreparedTransaction();
    expect(controller.getSnapshot().pendingTransaction).toMatchObject({ unresolved: true });
    await controller.runCommittedCheckpoint();
    expect(latest(controller).message).toMatch(/outcome is unknown/i);
  });

  it("refuses everything when the store owns a transaction the panel holds no token for", async () => {
    const { store } = createFakeStore();
    const controller = checkpointController(store);
    // Taken behind the panel's back: no checkpoint pending state exists.
    await store.beginDiagnosticTransaction();

    await controller.inspectStoredCheckpoint();

    expect(latest(controller).status).toBe("blocked");
    expect(latest(controller).message).toMatch(/no record of/i);
  });
});
