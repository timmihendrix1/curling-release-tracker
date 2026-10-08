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
  };
  const store: NativeSqliteStore = {
    databaseName: DIAGNOSTIC_DATABASE_NAME,
    adapter: {
      async get(key: string): Promise<StorageGetResult> {
        if (state.failReads) {
          return { status: "read_failed", fallback: null, error: { kind: "unknown", message: "x" } };
        }
        if (!state.open) {
          state.open = true;
          state.openCount += 1;
        }
        return { status: "value", value: state.rows.has(key) ? state.rows.get(key)! : null };
      },
      async set(key: string, value: string): Promise<PersistenceWriteResult> {
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
    async deleteAllRecords(): Promise<NativeSqliteControlResult> {
      state.rows.clear();
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
