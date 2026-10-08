/**
 * The headless controller behind the native storage diagnostics panel.
 *
 * It drives the real `RemovableStorageAdapter` from
 * `src/lib/persistence/nativeSqliteAdapter.ts` against a DEDICATED SYNTHETIC
 * database (`syntheticFixtures.ts`). It never reads, writes, copies, clears or
 * migrates an application record, it never touches a repository or a cloud
 * uploader, and its only cleanup operation deletes rows of its own table.
 *
 * **What the claims mean, and what they do not.** Three different things are
 * routinely conflated when people talk about durable storage, so this controller
 * reports them as three different claims and never promotes one to another:
 *
 *   - `write_acknowledged` — the engine reported a committed statement. It is
 *     not a power-loss guarantee.
 *   - `verified_same_process` — the values read back inside the same document.
 *     This proves binding, ordering and round-tripping. It proves nothing about
 *     disk, because the read may be served from the same connection's cache.
 *   - `verified_after_reopen` — the connection was closed and reopened. Stronger
 *     than the above, still inside one app process.
 *   - `verified_after_restart` — the values were written by a DIFFERENT document
 *     session than the one verifying them. This is the only claim that involves
 *     the app actually being torn down and started again, and even it cannot, on
 *     its own, distinguish a force-quit from a WebView reload; the manual
 *     procedure in `mobile/README.md` is what supplies that.
 *
 * No claim here is evidence about power loss. Establishing that needs a device
 * that actually loses power, which this panel does not simulate and does not
 * pretend to.
 */
import {
  createNativeSqliteStore,
  type NativeSqliteEffectiveSettings,
  type NativeSqliteStore,
} from "../../../src/lib/persistence/nativeSqliteAdapter";
import {
  detectRuntimePlatform,
  type RuntimePlatform,
} from "../../../src/lib/platform/runtimePlatform";
import {
  byteLength,
  DIAGNOSTIC_DATABASE_NAME,
  fixtureStorageKey,
  MANIFEST_STORAGE_KEY,
  MUTABLE_STORAGE_KEY,
  NEVER_WRITTEN_STORAGE_KEY,
  parseManifest,
  SYNTHETIC_FIXTURES,
  SYNTHETIC_MANIFEST_SCHEMA,
  type SyntheticRunManifest,
} from "./syntheticFixtures";

export type DurabilityClaim =
  | "write_acknowledged"
  | "verified_same_process"
  | "verified_after_reopen"
  | "verified_after_restart"
  | "no_claim";

export const DURABILITY_CLAIM_LABELS: Record<DurabilityClaim, string> = {
  write_acknowledged: "Write acknowledged",
  verified_same_process: "Verified in this app session",
  verified_after_reopen: "Verified after close and reopen",
  verified_after_restart: "Verified after app restart",
  no_claim: "No durability claim",
};

export type DiagnosticsStatus = "ok" | "failed" | "blocked";

export interface DiagnosticsLogEntry {
  id: number;
  action: string;
  status: DiagnosticsStatus;
  claim: DurabilityClaim;
  message: string;
  detail: string[];
  elapsedMs: number | null;
  bytes: number | null;
}

export interface DiagnosticsSnapshot {
  busy: boolean;
  /** The action currently running, for the UI's disabled state. */
  activity: string | null;
  platform: RuntimePlatform;
  databaseName: string;
  /** Identifies this document session. A manifest written under a different one
   * is restart evidence. */
  sessionId: string;
  settings: NativeSqliteEffectiveSettings | null;
  /** Newest first, bounded. */
  entries: DiagnosticsLogEntry[];
}

export interface NativeStorageDiagnosticsController {
  getSnapshot(): DiagnosticsSnapshot;
  subscribe(listener: () => void): () => void;
  writeFixtures(): Promise<void>;
  verifyCurrentSession(): Promise<void>;
  exerciseUpdateAndRemove(): Promise<void>;
  closeAndReopen(): Promise<void>;
  verifyAfterRestart(): Promise<void>;
  readSettings(): Promise<void>;
  clearSyntheticDatabase(): Promise<void>;
}

/**
 * Generated ONCE per JavaScript document, at module evaluation. Not per
 * controller and not per mount: opening and closing the panel inside one app
 * session must not look like a restart.
 */
function createSessionId(): string {
  const cryptoApi = globalThis.crypto;
  if (cryptoApi && typeof cryptoApi.randomUUID === "function") {
    return cryptoApi.randomUUID();
  }
  // No fabricated randomness: a monotonic-ish stamp is enough to tell two
  // document sessions apart, and it is honest about being a fallback.
  return `session-${Date.now().toString(36)}`;
}

const DOCUMENT_SESSION_ID = createSessionId();

const MAX_LOG_ENTRIES = 40;

export interface DiagnosticsControllerOptions {
  createStore?: (databaseName: string) => NativeSqliteStore;
  detectPlatform?: () => RuntimePlatform;
  /** Monotonic milliseconds, for elapsed measurements. */
  now?: () => number;
  /** Wall-clock ISO string, recorded in the manifest. */
  isoNow?: () => string;
  newRunId?: () => string;
  sessionId?: string;
}

export function createNativeStorageDiagnosticsController(
  options: DiagnosticsControllerOptions = {}
): NativeStorageDiagnosticsController {
  const detectPlatform = options.detectPlatform ?? detectRuntimePlatform;
  const now =
    options.now ??
    (() =>
      typeof performance !== "undefined" && typeof performance.now === "function"
        ? performance.now()
        : Date.now());
  const isoNow = options.isoNow ?? (() => new Date().toISOString());
  const newRunId = options.newRunId ?? createSessionId;
  const sessionId = options.sessionId ?? DOCUMENT_SESSION_ID;
  const makeStore =
    options.createStore ??
    ((databaseName: string) => createNativeSqliteStore({ databaseName }));

  // ONE store for the whole controller lifetime. `close()` does not discard it —
  // the store reopens on the next operation, which is exactly the close/reopen
  // behaviour being exercised.
  const store = makeStore(DIAGNOSTIC_DATABASE_NAME);
  const adapter = store.adapter;

  let nextEntryId = 1;
  let listeners: (() => void)[] = [];
  let snapshot: DiagnosticsSnapshot = {
    busy: false,
    activity: null,
    platform: safePlatform(),
    databaseName: store.databaseName,
    sessionId,
    settings: null,
    entries: [],
  };

  function safePlatform(): RuntimePlatform {
    try {
      return detectPlatform();
    } catch {
      return "unsupported_native";
    }
  }

  function publish(next: Partial<DiagnosticsSnapshot>): void {
    snapshot = { ...snapshot, ...next };
    for (const listener of listeners) listener();
  }

  function appendEntry(entry: Omit<DiagnosticsLogEntry, "id">): void {
    const withId: DiagnosticsLogEntry = { id: nextEntryId, ...entry };
    nextEntryId += 1;
    publish({ entries: [withId, ...snapshot.entries].slice(0, MAX_LOG_ENTRIES) });
  }

  type ActionOutcome = Omit<DiagnosticsLogEntry, "id" | "action">;

  /**
   * One deliberate action at a time. A second press while an action is running
   * is REFUSED and recorded, never queued and never silently dropped: two
   * overlapping exercises would make every measurement and every verification
   * verdict unattributable.
   */
  async function run(action: string, task: () => Promise<ActionOutcome>): Promise<void> {
    if (snapshot.busy) {
      appendEntry({
        action,
        status: "blocked",
        claim: "no_claim",
        message: `Refused: "${snapshot.activity ?? "another action"}" is still running.`,
        detail: [],
        elapsedMs: null,
        bytes: null,
      });
      return;
    }
    publish({ busy: true, activity: action, platform: safePlatform() });
    try {
      appendEntry({ action, ...(await task()) });
    } catch {
      // The adapter never rejects, so reaching here means the controller itself
      // failed. It is reported, not swallowed, and the raw value is not read.
      appendEntry({
        action,
        status: "failed",
        claim: "no_claim",
        message: "The diagnostic action failed unexpectedly.",
        detail: [],
        elapsedMs: null,
        bytes: null,
      });
    } finally {
      publish({ busy: false, activity: null });
    }
  }

  /** Reads every fixture and compares it to its regenerated expected value.
   * Returns a per-fixture report; it NEVER writes, so a verification can never
   * recreate data that is missing. */
  async function compareFixtures(): Promise<{
    ok: boolean;
    detail: string[];
    totalBytes: number;
    elapsedMs: number;
  }> {
    const detail: string[] = [];
    let ok = true;
    let totalBytes = 0;
    const startedAt = now();
    for (const fixture of SYNTHETIC_FIXTURES) {
      const expected = fixture.build();
      const result = await adapter.get(fixtureStorageKey(fixture.id));
      if (result.status === "read_failed") {
        ok = false;
        detail.push(`${fixture.label}: read failed (${result.error.kind}).`);
        continue;
      }
      if (result.value === null) {
        ok = false;
        detail.push(`${fixture.label}: absent — nothing was recreated.`);
        continue;
      }
      totalBytes += byteLength(result.value);
      if (result.value === expected) {
        detail.push(`${fixture.label}: matches exactly (${byteLength(expected)} B).`);
      } else {
        ok = false;
        detail.push(
          `${fixture.label}: MISMATCH — stored ${byteLength(result.value)} B, expected ${byteLength(expected)} B.`
        );
      }
    }
    // Genuine absence must read back as absence, not as a failure and not as a
    // fabricated value.
    const missing = await adapter.get(NEVER_WRITTEN_STORAGE_KEY);
    if (missing.status === "read_failed") {
      ok = false;
      detail.push("Never-written key: read failed instead of reporting absence.");
    } else if (missing.value !== null) {
      ok = false;
      detail.push("Never-written key: a value appeared where none was ever written.");
    } else {
      detail.push("Never-written key: reported absent, as it must be.");
    }
    return { ok, detail, totalBytes, elapsedMs: now() - startedAt };
  }

  /**
   * Four outcomes, deliberately not three. A storage read that FAILED says nothing
   * about whether a run record exists, while a record that is present but invalid
   * is a different fact — and neither of them certifies anything.
   */
  async function readManifest(): Promise<
    | { status: "value"; manifest: SyntheticRunManifest }
    | { status: "absent" }
    | { status: "read_failed" }
    | { status: "invalid" }
  > {
    const result = await adapter.get(MANIFEST_STORAGE_KEY);
    if (result.status === "read_failed") return { status: "read_failed" };
    if (result.value === null) return { status: "absent" };
    const manifest = parseManifest(result.value);
    return manifest === null ? { status: "invalid" } : { status: "value", manifest };
  }

  return {
    getSnapshot: () => snapshot,

    subscribe(listener: () => void): () => void {
      listeners = [...listeners, listener];
      return () => {
        listeners = listeners.filter((candidate) => candidate !== listener);
      };
    },

    writeFixtures: () =>
      run("Write synthetic fixtures", async () => {
        const detail: string[] = [];
        let totalBytes = 0;
        const runId = newRunId();
        const startedAtIso = isoNow();
        const startedAt = now();
        const written: { id: string; bytes: number }[] = [];

        // STEP 1 — INVALIDATE BEFORE WRITING ANYTHING.
        //
        // The fixtures are deterministic, so a rewritten fixture is byte-identical
        // to the one it replaced and nothing about the DATA can reveal which run
        // produced it. Attribution rests entirely on the manifest, so any previous
        // completion record must stop being a completion record BEFORE the first
        // fixture is touched. Otherwise an interrupted rewrite leaves the earlier
        // run's "complete" record standing over freshly rewritten — possibly
        // partially rewritten — fixtures, and a later verification reads that as
        // "a different session wrote this" and certifies it.
        //
        // If this write fails, no fixture is touched, so any existing completion
        // record is still accurate and is deliberately left alone.
        const inProgress: SyntheticRunManifest = {
          schema: SYNTHETIC_MANIFEST_SCHEMA,
          phase: "writing",
          runId,
          sessionId,
          startedAtIso,
        };
        const marked = await adapter.set(MANIFEST_STORAGE_KEY, JSON.stringify(inProgress));
        if (!marked.ok) {
          return {
            status: "failed",
            claim: "no_claim",
            message: `The run could not be started (${marked.error.kind}). No fixture was written, and any previous run's record is untouched.`,
            detail,
            elapsedMs: now() - startedAt,
            bytes: 0,
          };
        }
        detail.push(`Run ${runId} marked in progress before any fixture was written.`);

        // STEP 2 — write the fixtures. Any failure here leaves the in-progress
        // record standing, which is what blocks certification later.
        for (const fixture of SYNTHETIC_FIXTURES) {
          const payload = fixture.build();
          const bytes = byteLength(payload);
          const before = now();
          const result = await adapter.set(fixtureStorageKey(fixture.id), payload);
          const elapsed = now() - before;
          if (!result.ok) {
            return {
              status: "failed",
              claim: "no_claim",
              message: `Writing "${fixture.label}" failed (${result.error.kind}). The run stays marked incomplete, so it cannot be mistaken for restart evidence.`,
              detail,
              elapsedMs: now() - startedAt,
              bytes: totalBytes,
            };
          }
          totalBytes += bytes;
          written.push({ id: fixture.id, bytes });
          detail.push(`${fixture.label}: ${bytes} B acknowledged in ${elapsed.toFixed(1)} ms.`);
        }

        // STEP 3 — publish completion. Only now may this run attribute anything.
        const completedAtIso = isoNow();
        const completed: SyntheticRunManifest = {
          schema: SYNTHETIC_MANIFEST_SCHEMA,
          phase: "complete",
          runId,
          sessionId,
          startedAtIso,
          completedAtIso,
          fixtures: written,
        };
        const published = await adapter.set(
          MANIFEST_STORAGE_KEY,
          JSON.stringify(completed)
        );
        if (!published.ok) {
          return {
            status: "failed",
            claim: "no_claim",
            message: `Every fixture was written but the run could not be marked complete (${published.error.kind}). It stays marked incomplete and will not be reported as restart evidence.`,
            detail,
            elapsedMs: now() - startedAt,
            bytes: totalBytes,
          };
        }
        detail.push(`Run ${runId} marked complete at ${completedAtIso}.`);
        return {
          status: "ok",
          claim: "write_acknowledged",
          message:
            "The engine acknowledged every write. Acknowledgement is not evidence of surviving power loss.",
          detail,
          elapsedMs: now() - startedAt,
          bytes: totalBytes,
        };
      }),

    verifyCurrentSession: () =>
      run("Verify in this app session", async () => {
        const report = await compareFixtures();
        return {
          status: report.ok ? "ok" : "failed",
          claim: report.ok ? "verified_same_process" : "no_claim",
          message: report.ok
            ? "Every fixture read back byte-for-byte in the same app session. This shows binding and round-tripping, not disk durability."
            : "At least one fixture did not read back as written.",
          detail: report.detail,
          elapsedMs: report.elapsedMs,
          bytes: report.totalBytes,
        };
      }),

    exerciseUpdateAndRemove: () =>
      run("Update and remove a test key", async () => {
        const detail: string[] = [];
        const startedAt = now();
        const first = "first-value";
        const second = "second-value";

        const wroteFirst = await adapter.set(MUTABLE_STORAGE_KEY, first);
        if (!wroteFirst.ok) {
          return failure(`The first write failed (${wroteFirst.error.kind}).`, detail, startedAt);
        }
        const readFirst = await adapter.get(MUTABLE_STORAGE_KEY);
        if (readFirst.status !== "value" || readFirst.value !== first) {
          return failure("The first value did not read back.", detail, startedAt);
        }
        detail.push("Wrote and read back the first value.");

        const wroteSecond = await adapter.set(MUTABLE_STORAGE_KEY, second);
        if (!wroteSecond.ok) {
          return failure(`The overwrite failed (${wroteSecond.error.kind}).`, detail, startedAt);
        }
        const readSecond = await adapter.get(MUTABLE_STORAGE_KEY);
        if (readSecond.status !== "value" || readSecond.value !== second) {
          return failure("The overwrite did not replace the stored value.", detail, startedAt);
        }
        detail.push("Overwrote the same key and read back the new value.");

        const removed = await adapter.remove(MUTABLE_STORAGE_KEY);
        if (!removed.ok) {
          return failure(`Removal failed (${removed.error.kind}).`, detail, startedAt);
        }
        const readRemoved = await adapter.get(MUTABLE_STORAGE_KEY);
        if (readRemoved.status !== "value" || readRemoved.value !== null) {
          return failure("The removed key did not report genuine absence.", detail, startedAt);
        }
        detail.push("Removed the key; it now reports absence rather than a failure.");

        const removedAgain = await adapter.remove(MUTABLE_STORAGE_KEY);
        if (!removedAgain.ok) {
          return failure(
            "Removing an already-absent key was reported as a failure.",
            detail,
            startedAt
          );
        }
        detail.push("Removing an already-absent key succeeded, as it must.");

        return {
          status: "ok",
          claim: "no_claim",
          message: "Write, overwrite, removal and genuine absence all behaved as the contract requires.",
          detail,
          elapsedMs: now() - startedAt,
          bytes: null,
        };

        function failure(message: string, lines: string[], began: number): ActionOutcome {
          return {
            status: "failed",
            claim: "no_claim",
            message,
            detail: lines,
            elapsedMs: now() - began,
            bytes: null,
          };
        }
      }),

    closeAndReopen: () =>
      run("Close and reopen the database", async () => {
        const startedAt = now();
        const closed = await store.close();
        if (!closed.ok) {
          return {
            status: "failed",
            claim: "no_claim",
            message: `The database could not be closed (${closed.reason}).`,
            detail: [],
            elapsedMs: now() - startedAt,
            bytes: null,
          };
        }
        // The next adapter call reopens; the comparison below is that reopen.
        const report = await compareFixtures();
        return {
          status: report.ok ? "ok" : "failed",
          claim: report.ok ? "verified_after_reopen" : "no_claim",
          message: report.ok
            ? "The connection was closed, reopened, and every fixture still matched. Still one app process — not power-loss evidence."
            : "After closing and reopening, at least one fixture did not match.",
          detail: ["Connection closed.", ...report.detail],
          elapsedMs: now() - startedAt,
          bytes: report.totalBytes,
        };
      }),

    verifyAfterRestart: () =>
      run("Verify after app restart", async () => {
        const startedAt = now();
        const manifestResult = await readManifest();
        if (manifestResult.status === "read_failed") {
          return {
            status: "failed",
            claim: "no_claim",
            message:
              "The run record could not be read, so whether a previous run exists is unknown. Nothing was rewritten.",
            detail: [],
            elapsedMs: now() - startedAt,
            bytes: null,
          };
        }
        if (manifestResult.status === "invalid") {
          return {
            status: "failed",
            claim: "no_claim",
            message:
              "A run record exists but could not be validated, so it attributes nothing. Nothing was rewritten.",
            detail: [],
            elapsedMs: now() - startedAt,
            bytes: null,
          };
        }
        if (manifestResult.status === "absent") {
          return {
            status: "failed",
            claim: "no_claim",
            message:
              "No previous run was found. Nothing was recreated — write the fixtures first, then force-quit and relaunch.",
            detail: [],
            elapsedMs: now() - startedAt,
            bytes: null,
          };
        }
        const { manifest } = manifestResult;
        if (manifest.phase === "writing") {
          // The fixtures may be complete, partial, or a mixture of two runs, and
          // nothing stored can tell them apart. Certifying here is exactly the
          // false "verified after app restart" this protocol exists to prevent.
          return {
            status: "failed",
            claim: "no_claim",
            message:
              "The last run did not finish writing, so the fixtures cannot be attributed to it. Write them again, then force-quit and relaunch. Nothing was recreated.",
            detail: [
              `Run ${manifest.runId} started at ${manifest.startedAtIso} and was never marked complete.`,
              manifest.sessionId === sessionId
                ? "It was started by THIS app session."
                : "It was started by an earlier app session.",
            ],
            elapsedMs: now() - startedAt,
            bytes: null,
          };
        }
        const sameSession = manifest.sessionId === sessionId;
        const report = await compareFixtures();
        const detail = [
          `Run ${manifest.runId} completed at ${manifest.completedAtIso}.`,
          sameSession
            ? "Written by THIS app session — this is not restart evidence."
            : "Written by an earlier app session.",
          ...report.detail,
        ];
        if (!report.ok) {
          return {
            status: "failed",
            claim: "no_claim",
            message: "The previous run's fixtures did not all survive.",
            detail,
            elapsedMs: now() - startedAt,
            bytes: report.totalBytes,
          };
        }
        return {
          status: sameSession ? "blocked" : "ok",
          claim: sameSession ? "verified_same_process" : "verified_after_restart",
          message: sameSession
            ? "The fixtures match, but they were written by the session now reading them. Force-quit the app, relaunch, and run this again."
            : "The fixtures were written by an earlier app session, that run was marked complete, and every value read back byte-for-byte. A reload of the web view would look the same to the app, so the manual force-quit step is what makes this a restart.",
          detail,
          elapsedMs: now() - startedAt,
          bytes: report.totalBytes,
        };
      }),

    readSettings: () =>
      run("Read effective SQLite settings", async () => {
        const startedAt = now();
        const result = await store.readEffectiveSettings();
        if (!result.ok) {
          publish({ settings: null });
          return {
            status: "failed",
            claim: "no_claim",
            message: `The effective settings could not be read (${result.reason}).`,
            detail: [],
            elapsedMs: now() - startedAt,
            bytes: null,
          };
        }
        publish({ settings: result.settings });
        return {
          status: "ok",
          claim: "no_claim",
          message: "These are the pragmas the engine reports, not the ones this build asked for.",
          detail: [
            `journal_mode = ${result.settings.journalMode ?? "unreported"}`,
            `synchronous = ${result.settings.synchronous ?? "unreported"}`,
            `page_size = ${result.settings.pageSize ?? "unreported"}`,
            `sqlite_version = ${result.settings.sqliteVersion ?? "unreported"}`,
          ],
          elapsedMs: now() - startedAt,
          bytes: null,
        };
      }),

    clearSyntheticDatabase: () =>
      run("Delete the synthetic data", async () => {
        const startedAt = now();
        const result = await store.deleteAllRecords();
        return result.ok
          ? {
              status: "ok",
              claim: "no_claim",
              message: `Every row of "${store.databaseName}" was deleted. No other database was touched.`,
              detail: [],
              elapsedMs: now() - startedAt,
              bytes: null,
            }
          : {
              status: "failed",
              claim: "no_claim",
              message: `The synthetic data could not be deleted (${result.reason}).`,
              detail: [],
              elapsedMs: now() - startedAt,
              bytes: null,
            };
      }),
  };
}

let sharedController: NativeStorageDiagnosticsController | null = null;

/**
 * One controller — and therefore one connection owner — per document. Closing
 * and reopening the panel must not create a second owner of the same database,
 * and must not look like an app restart.
 */
export function getNativeStorageDiagnosticsController(): NativeStorageDiagnosticsController {
  if (sharedController === null) {
    sharedController = createNativeStorageDiagnosticsController();
  }
  return sharedController;
}
