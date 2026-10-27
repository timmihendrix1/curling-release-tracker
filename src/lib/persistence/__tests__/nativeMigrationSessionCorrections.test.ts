// Stage M3b4c — regressions for the session controller's review findings R1, R2,
// R4 and R5 (docs/MOBILE_APP_MIGRATION.md Stage M3b0 §6, U2-6, U2-9, U2-15).
//
// EVIDENCE CLASS M where a real runner is used: the real source binding, target
// capability, evidence collector and runner over the plugin-faithful engine and
// a disposable synthetic WebView store, on both platforms; fingerprints are the
// labelled synthetic digests. Calls are recorded AT ISSUANCE and asserted after
// the run — never inside a callback that production code absorbs.
//
// Each `ucase(...)` label is traced in `nativeMigrationRecoveryCoverage.test.ts`.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeSqliteEngine } from "../nativeSqliteAdapter";
import type { NativeMigrationDisposeResult, NativeMigrationRunReport, NativeMigrationRunner } from "../nativeMigrationRunner";
import { buildMigrationDiagnosticReport } from "../nativeMigrationPresentation";
import { createNativeMigrationSession, type NativeMigrationSession } from "../nativeMigrationSession";
import { BASE_SOURCE, ELIGIBLE_BASE, KEY_CREDENTIAL, KEY_SESSION, fp } from "./nativeMigrationTestKit";
import {
  MARKER_KEY,
  PLATFORMS,
  RECORD_KEY,
  boot,
  commitReaches,
  deferred,
  device,
  once,
  until,
  type Process,
} from "./nativeMigrationMTestKit";

afterEach(() => vi.unstubAllGlobals());

const ucase = (id: string, title: string, fn: () => Promise<void> | void) => it(`${id} — ${title}`, fn);
const SORTED = [...ELIGIBLE_BASE].sort();
const PROFILE = KEY_SESSION.split(".")[3];

/* ------------------------------------------------------- timing helpers */
// The same technique as nativeMigrationOwnershipCancellation.test.ts: disposal is
// scheduled `hops` promise hops after an observed bridge call settles.

const HOPS = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8];

function afterHops(hops: number, run: () => void): void {
  if (hops < 0) {
    run();
    return;
  }
  if (hops === 0) {
    queueMicrotask(run);
    return;
  }
  let chain = Promise.resolve();
  for (let hop = 1; hop < hops; hop += 1) chain = chain.then(() => undefined);
  void chain.then(() => queueMicrotask(run));
}

interface IssuedCall {
  readonly name: string;
  readonly afterDisposal: boolean;
}

function observingEngine(
  engine: NativeSqliteEngine,
  issued: IssuedCall[],
  disposal: { done: boolean },
  observe: (name: string, pending: Promise<unknown>) => void
): NativeSqliteEngine {
  const record = (name: string) => issued.push({ name, afterDisposal: disposal.done });
  return {
    async createConnection(databaseName) {
      record("create");
      const connection = await engine.createConnection(databaseName);
      const wrap = <A extends unknown[], R>(kind: string, call: (...args: A) => Promise<R>) =>
        (...args: A): Promise<R> => {
          const label = typeof args[0] === "string" ? `${kind}:${args[0]}` : kind;
          record(label);
          const pending = call(...args);
          observe(label, pending);
          return pending;
        };
      return {
        open: wrap("open", () => connection.open()),
        close: wrap("close", () => connection.close()),
        execute: wrap("execute", (sql: string, tx: boolean) => connection.execute(sql, tx)),
        run: wrap("run", (sql: string, values: unknown[], tx: boolean) => connection.run(sql, values, tx)),
        query: wrap("query", (sql: string, values: unknown[]) => connection.query(sql, values)),
        beginTransaction: wrap("begin", () => connection.beginTransaction()),
        commitTransaction: wrap("commit", () => connection.commitTransaction()),
        rollbackTransaction: wrap("rollback", () => connection.rollbackTransaction()),
      };
    },
    async closeConnection(databaseName) {
      record("release");
      return engine.closeConnection(databaseName);
    },
  };
}

/** Calls a stopped owner may still issue: required cleanup only. */
const CLEANUP = new Set(["close", "release", "rollback"]);

function countingRunner(p: Process): { runner: NativeMigrationRunner; runs: () => number; disposals: () => number } {
  let runs = 0;
  let disposals = 0;
  return {
    runner: {
      run: () => {
        runs += 1;
        vi.stubGlobal("localStorage", p.device.storage);
        return p.runner.run();
      },
      dispose: () => {
        disposals += 1;
        return p.runner.dispose();
      },
    },
    runs: () => runs,
    disposals: () => disposals,
  };
}

async function settle(session: NativeMigrationSession): Promise<void> {
  await until(() => !["idle", "running", "handing_over"].includes(session.getSnapshot().status), "settled");
}

/* ------------------------------------------------------------------- R1 */

describe.each(PLATFORMS)("R1 — session disposal reaches the runner in the same turn (%s)", (platform) => {
  const boundaries: Array<[string, (name: string) => boolean]> = [
    ["open settles", (name) => name === "open"],
    ["the journal-mode PRAGMA settles", (name) => name.startsWith("query:PRAGMA journal_mode")],
    ["the synchronous PRAGMA settles", (name) => name.startsWith("execute:PRAGMA synchronous")],
    ["the schema command settles", (name) => name.startsWith("execute:CREATE TABLE")],
    ["the first evidence read settles", (name) => name.startsWith("query:SELECT")],
  ];

  for (const [label, trigger] of boundaries) {
    ucase("U2-6", `opening/reading: ${label} — after session.dispose(), only cleanup is issued, at every hop`, async () => {
      for (const hops of HOPS) {
        const d = device(platform, BASE_SOURCE);
        const issued: IssuedCall[] = [];
        const disposal = { done: false };
        const ref: { session?: NativeMigrationSession; disposing?: Promise<NativeMigrationDisposeResult> } = {};
        let armed = true;
        const p = await boot(d, {
          wrapEngine: (engine) => observingEngine(engine, issued, disposal, (name, pending) => {
            if (!armed || !trigger(name)) return;
            armed = false;
            void pending.then(() => afterHops(hops, () => {
              disposal.done = true;
              ref.disposing = ref.session?.dispose();
            }), () => undefined);
          }),
        });
        const session = (ref.session = createNativeMigrationSession({ runner: countingRunner(p).runner }));
        session.start();
        await until(() => ref.disposing !== undefined, `${label} at hop ${hops}`);
        const result = await ref.disposing;
        const afterDisposal = issued.filter((call) => call.afterDisposal).map((call) => call.name);
        expect(afterDisposal.filter((name) => !CLEANUP.has(name)), `hops ${hops}: ${JSON.stringify(issued)}`).toEqual([]);
        expect(issued.some((call) => /^(run:|begin|commit)/.test(call.name)), `hops ${hops}`).toBe(false);
        expect(d.state.rows.has(RECORD_KEY), `hops ${hops}`).toBe(false);
        expect(result, `hops ${hops}`).toEqual({ ok: true });
        expect(session.getSnapshot().status).toBe("disposed");
      }
    });
  }

  ucase("U2-6", "transaction: disposal after BEGIN — before COMMIT it rolls back; an issued COMMIT is awaited and never rolled back; nothing new follows, at every hop", async () => {
    for (const hops of HOPS) {
      const d = device(platform, BASE_SOURCE);
      const issued: IssuedCall[] = [];
      const disposal = { done: false };
      const ref: { session?: NativeMigrationSession; disposing?: Promise<NativeMigrationDisposeResult> } = {};
      let armed = true;
      const p = await boot(d, {
        wrapEngine: (engine) => observingEngine(engine, issued, disposal, (name, pending) => {
          if (!armed || name !== "begin") return;
          armed = false;
          void pending.then(() => afterHops(hops, () => {
            disposal.done = true;
            ref.disposing = ref.session?.dispose();
          }), () => undefined);
        }),
      });
      const session = (ref.session = createNativeMigrationSession({ runner: countingRunner(p).runner }));
      session.start();
      await until(() => ref.disposing !== undefined, `begin at hop ${hops}`);
      const result = await ref.disposing;
      const afterDisposal = issued.filter((call) => call.afterDisposal).map((call) => call.name);
      expect(afterDisposal.filter((name) => !CLEANUP.has(name)), `hops ${hops}: ${JSON.stringify(issued)}`).toEqual([]);
      const commit = issued.findIndex((call) => call.name === "commit");
      if (commit >= 0) {
        // Disposal landed after COMMIT was issued: it was awaited, and nothing
        // was rolled back afterwards.
        expect(issued[commit].afterDisposal, `hops ${hops}`).toBe(false);
        expect(issued.slice(commit + 1).some((call) => call.name === "rollback"), `hops ${hops}`).toBe(false);
      } else {
        // Stopped before COMMIT: rolled back, nothing durable.
        expect(issued.some((call) => call.name === "rollback"), `hops ${hops}`).toBe(true);
        expect(d.state.rows.has(RECORD_KEY), `hops ${hops}`).toBe(false);
      }
      // Either way the write is unevaluated plan evidence: the lease is retained.
      expect(result, `hops ${hops}`).toEqual({ ok: false, reason: "plan_evidence_held" });
    }
  });

  ucase("U2-6", "source and digest: disposal during the first digest — no further source read or digest, at every hop", async () => {
    for (const hops of HOPS) {
      const d = device(platform, BASE_SOURCE);
      const reads: Array<{ key: string; afterDisposal: boolean }> = [];
      const digests: boolean[] = [];
      const disposal = { done: false };
      d.storage.faults.beforeGetItem = (key) => { reads.push({ key, afterDisposal: disposal.done }); };
      const ref: { session?: NativeMigrationSession; disposing?: Promise<NativeMigrationDisposeResult> } = {};
      let first = true;
      const p = await boot(d, {
        fingerprint: (value) => {
          digests.push(disposal.done);
          if (first) {
            first = false;
            afterHops(hops, () => {
              disposal.done = true;
              ref.disposing = ref.session?.dispose();
            });
          }
          return fp(value);
        },
      });
      const session = (ref.session = createNativeMigrationSession({ runner: countingRunner(p).runner }));
      session.start();
      await until(() => ref.disposing !== undefined, `digest at hop ${hops}`);
      await ref.disposing;
      expect(reads.filter((read) => read.afterDisposal), `hops ${hops}`).toEqual([]);
      expect(digests.filter(Boolean), `hops ${hops}`).toEqual([]);
    }
  });

  ucase("U2-6", "a running-state subscriber that disposes the session prevents the run entirely", async () => {
    const p = await boot(device(platform, BASE_SOURCE));
    const { runner, runs, disposals } = countingRunner(p);
    const session = createNativeMigrationSession({ runner });
    let result: Promise<NativeMigrationDisposeResult> | undefined;
    session.subscribe(() => {
      if (session.getSnapshot().status === "running" && result === undefined) result = session.dispose();
    });
    session.start();
    expect(runs()).toBe(0);
    expect(disposals()).toBe(1);
    expect(await result).toEqual({ ok: true });
    expect(session.getSnapshot()).toMatchObject({ status: "disposed", presentation: { kind: "ended" } });
    expect(p.device.state.executed).toEqual([]);
  });
});

describe("R1 — one synchronous, contained, reentrancy-safe runner disposal", () => {
  const report = { outcome: "bound_reached", completedPlans: [] } as unknown as NativeMigrationRunReport;

  ucase("U2-6", "runner.dispose() is called synchronously by session.dispose(), once, and its result is shared", async () => {
    let calls = 0;
    const session = createNativeMigrationSession({
      runner: { run: async () => report, dispose: async () => { calls += 1; return { ok: true }; } },
    });
    const first = session.dispose();
    expect(calls).toBe(1);
    const second = session.dispose();
    expect(calls).toBe(1);
    expect(await first).toEqual({ ok: true });
    expect(await second).toEqual({ ok: true });
  });

  ucase("U2-6", "a reentrant session.dispose() from inside runner.dispose() joins the one disposal", async () => {
    let calls = 0;
    let inner: Promise<NativeMigrationDisposeResult> | undefined;
    const holder: { session?: NativeMigrationSession } = {};
    holder.session = createNativeMigrationSession({
      runner: {
        run: async () => report,
        dispose: async () => {
          calls += 1;
          inner = holder.session?.dispose();
          return { ok: false, reason: "plan_evidence_held" };
        },
      },
    });
    const outer = await holder.session.dispose();
    expect(calls).toBe(1);
    expect(outer).toEqual({ ok: false, reason: "plan_evidence_held" });
    expect(await inner).toEqual(outer);
  });

  ucase("U2-6", "a throwing, rejecting or malformed runner disposal never reads as freed ownership", async () => {
    const cases: Array<() => Promise<NativeMigrationDisposeResult>> = [
      () => { throw new Error("sync throw"); },
      () => Promise.reject(new Error("rejected")),
      async () => ({ ok: "yes" }) as unknown as NativeMigrationDisposeResult,
      async () => undefined as unknown as NativeMigrationDisposeResult,
    ];
    for (const dispose of cases) {
      const session = createNativeMigrationSession({ runner: { run: async () => report, dispose } });
      expect(await session.dispose()).toEqual({ ok: false, boundary: "release" });
      expect(session.getSnapshot().status).toBe("disposed");
    }
  });
});

/* ------------------------------------------------------------------- R2 */

describe("R2 — disposal is terminal and observable from every state", () => {
  type Stage = "idle" | "running" | "G2" | "G3" | "G4" | "handing_over" | "access";
  const BLOCKED: Record<"G2" | "G3" | "G4", unknown> = {
    G2: { outcome: "blocked", rule: "C1", findings: [{ rule: "C1", code: "source_enumeration_failed" }], retryMayResolve: true, completedPlans: [] },
    G3: { outcome: "blocked", rule: "E′7", findings: [{ rule: "E′7", code: "source_key_missing" }], retryMayResolve: false, completedPlans: [] },
    G4: { outcome: "blocked", rule: "A3", findings: [{ rule: "A3", code: "record_schema_newer" }], retryMayResolve: false, completedPlans: [] },
  };
  const ACCESS = { outcome: "access", rule: "B4", retirement: { state: "complete" }, completedPlans: [] };

  async function reach(stage: Stage) {
    const run = deferred();
    const release = deferred();
    let runs = 0;
    let disposals = 0;
    const session = createNativeMigrationSession({
      runner: {
        run: async () => {
          runs += 1;
          if (stage === "running") await run.promise;
          return (stage === "G2" || stage === "G3" || stage === "G4" ? BLOCKED[stage] : ACCESS) as NativeMigrationRunReport;
        },
        dispose: async () => {
          disposals += 1;
          if (stage === "handing_over") await release.promise;
          return { ok: true };
        },
      },
    });
    if (stage !== "idle") session.start();
    if (stage === "running") expect(session.getSnapshot().status).toBe("running");
    else if (stage === "handing_over") await until(() => session.getSnapshot().status === "handing_over", "handing over");
    else if (stage !== "idle") await settle(session);
    return { session, run, release, runs: () => runs, disposals: () => disposals };
  }

  for (const stage of ["idle", "running", "G2", "G3", "G4", "handing_over", "access"] as const) {
    ucase("U2-6", `disposed from ${stage}: terminal, not actionable, not accessible; late results cannot restore a state`, async () => {
      const { session, run, release, runs, disposals } = await reach(stage);
      const runsBefore = runs();
      const disposing = session.dispose();
      expect(session.getSnapshot()).toMatchObject({ status: "disposed", presentation: { kind: "ended" } });
      run.resolve();
      release.resolve();
      await disposing;
      await new Promise((resolve) => setTimeout(resolve, 5));
      expect(session.getSnapshot()).toMatchObject({ status: "disposed", presentation: { kind: "ended" } });
      session.start();
      expect(session.recheck()).toBe(false);
      expect(runs()).toBe(runsBefore);
      expect(disposals()).toBe(1);
      // A new observer after disposal sees the same terminal snapshot and is never notified.
      let notified = 0;
      const unsubscribe = session.subscribe(() => { notified += 1; });
      unsubscribe();
      expect(notified).toBe(0);
    });
  }
});

/* ------------------------------------------------------------------- R4 */

describe.each(PLATFORMS)("R4 — an unresolved write outcome survives checks that cannot resolve it (%s)", (platform) => {
  function report(session: NativeMigrationSession): string {
    const snapshot = session.getSnapshot();
    return buildMigrationDiagnosticReport({
      presentation: snapshot.presentation,
      completedPlans: snapshot.completedPlans,
      earlierStoppedPlan: snapshot.lastStoppedPlan,
      applicationVersion: "0.1.0",
    });
  }

  ucase("U2-9", "unknown marker outcome → failed reopen: the earlier steps stay, labelled as history", async () => {
    const d = device(platform, { ...BASE_SOURCE, [KEY_CREDENTIAL]: "SYNTHETIC_CREDENTIAL_SENTINEL" });
    d.storage.faults.setItem = once((key: string) => key === MARKER_KEY, "apply_then_reject" as const, "ok" as const);
    const p = await boot(d);
    const session = createNativeMigrationSession({ runner: countingRunner(p).runner });
    session.start();
    await settle(session);
    expect(session.getSnapshot().presentation).toMatchObject({ explanation: "halt_unknown_outcome" });
    p.faults.openRejects = true;
    session.recheck();
    await settle(session);
    expect(session.getSnapshot().presentation).toMatchObject({ group: "G2", codes: ["reopen_failed:open"] });
    const text = report(session);
    expect(text).toContain("Codes: reopen_failed:open");
    expect(text).toContain("Steps of a plan stopped by this check: none");
    expect(text).toContain("Earlier in this session, plan AP-D3 stopped. Its steps as recorded when it stopped (not re-checked by this check):");
    expect(text).toContain("Step 1: confirmed");
    expect(text).toContain("Step 2: outcome unknown");
    expect(text).toContain("Step 3: not issued");
    // Never a fresh phase observation for this check.
    expect(text).toContain("Phase at this check: not available");
    for (const sentinel of [PROFILE, "SYNTHETIC_CREDENTIAL_SENTINEL", "curling.", "fp:"]) expect(text).not.toContain(sentinel);
  });

  ucase("U2-9", "unknown target-transaction outcome → failed reopen: confirmed earlier effects stay distinct from the unknown step", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d, { faults: { onCommit: once(commitReaches("copying", (w) => w.has(SORTED[0])), "reject_after_effect" as const, "ok" as const) } });
    const session = createNativeMigrationSession({ runner: countingRunner(p).runner });
    session.start();
    await settle(session);
    const halted = session.getSnapshot().presentation;
    expect(halted).toMatchObject({ explanation: "halt_unknown_outcome" });
    p.faults.openRejects = true;
    session.recheck();
    await settle(session);
    const text = report(session);
    expect(text).toContain("Earlier in this session, plan AP-COPY stopped.");
    expect(text).toMatch(/Step \d+: passed/);
    expect(text).toMatch(/Step \d+: outcome unknown/);
    expect(text).not.toMatch(/Phase at this check: (copying|enumerating|verified)/);
  });

  ucase("U2-9", "a later unreadable evidence check that cannot resolve the earlier outcome keeps it", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d, { faults: { onCommit: once(commitReaches("copying", (w) => w.has(SORTED[0])), "reject_after_effect" as const, "ok" as const) } });
    const session = createNativeMigrationSession({ runner: countingRunner(p).runner });
    session.start();
    await settle(session);
    // The next check's target listing cannot be read.
    p.faults.onQuery = (statement) => ((statement === "SELECT key FROM records ORDER BY key") ? { reject: true } : undefined);
    session.recheck();
    await settle(session);
    const now = session.getSnapshot().presentation;
    expect(now).toMatchObject({ kind: "blocking", group: "G2" });
    if (now.kind !== "blocking") return;
    expect(now.steps).toEqual([]);
    const text = report(session);
    expect(text).toContain("Earlier in this session, plan AP-COPY stopped.");
    expect(text).toMatch(/Step \d+: outcome unknown/);
  });

  ucase("U2-9", "a check that stops a new plan reports that plan's steps as the current ones, not as history", async () => {
    const d = device(platform, BASE_SOURCE);
    d.storage.faults.setItem = once((key: string) => key === MARKER_KEY, "apply_then_reject" as const, "ok" as const);
    const p = await boot(d, { faults: { onCommit: once(commitReaches("copying", (w) => w.has(SORTED[0])), "reject_after_effect" as const, "ok" as const) } });
    const session = createNativeMigrationSession({ runner: countingRunner(p).runner });
    session.start();
    await settle(session);
    session.recheck();
    await settle(session);
    const text = report(session);
    expect(text).toContain("Steps of the plan stopped by this check:");
    expect(text).not.toContain("Earlier in this session");
  });
});

/* ------------------------------------------------------------------- R5 */

describe("R5 — the whole result-processing path is contained", () => {
  function sessionFor(run: () => unknown, dispose: () => Promise<NativeMigrationDisposeResult> = async () => ({ ok: true })) {
    return createNativeMigrationSession({ runner: { run: run as NativeMigrationRunner["run"], dispose } });
  }
  const unhandled: unknown[] = [];
  const onUnhandled = (reason: unknown) => unhandled.push(reason);

  async function expectG4(session: NativeMigrationSession) {
    process.on("unhandledRejection", onUnhandled);
    try {
      session.start();
      await settle(session);
      await new Promise((resolve) => setTimeout(resolve, 5));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
    expect(session.getSnapshot()).toMatchObject({
      status: "settled",
      presentation: { kind: "blocking", group: "G4", explanation: "internal_check", recheck: false, codes: ["unexpected_failure"] },
    });
    expect(session.recheck()).toBe(false);
    expect(JSON.stringify(session.getSnapshot())).not.toContain("SENTINEL");
  }

  ucase("U2-15", "a throwing completedPlans getter is G4, with no unhandled rejection and no raw text", async () => {
    await expectG4(sessionFor(async () => ({
      outcome: "bound_reached",
      get completedPlans(): never { throw new Error("getter SENTINEL"); },
    })));
  });

  ucase("U2-15", "a malformed completedPlans entry is G4", async () => {
    for (const completedPlans of [[{ name: "NOT_A_PLAN" }], [null], [{ get name(): never { throw new Error("SENTINEL"); } }], "AP-D3"]) {
      unhandled.length = 0;
      await expectG4(sessionFor(async () => ({ outcome: "bound_reached", completedPlans })));
    }
  });

  ucase("U2-15", "a synchronous run throw and a rejected run are G4", async () => {
    await expectG4(sessionFor(() => { throw new Error("sync SENTINEL"); }));
    await expectG4(sessionFor(() => Promise.reject(new Error("rejected SENTINEL"))));
  });

  ucase("U2-15", "a processing failure arriving after disposal publishes nothing", async () => {
    let resolveRun: (value: unknown) => void = () => undefined;
    const session = sessionFor(() => new Promise((resolve) => { resolveRun = resolve; }));
    const seen: string[] = [];
    session.subscribe(() => seen.push(session.getSnapshot().status));
    session.start();
    await session.dispose();
    process.on("unhandledRejection", onUnhandled);
    try {
      resolveRun({ outcome: "bound_reached", get completedPlans(): never { throw new Error("SENTINEL"); } });
      await new Promise((resolve) => setTimeout(resolve, 5));
    } finally {
      process.off("unhandledRejection", onUnhandled);
    }
    expect(unhandled).toEqual([]);
    expect(seen).toEqual(["running", "disposed"]);
    expect(session.getSnapshot().status).toBe("disposed");
  });
});
