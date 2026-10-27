// Stage M3b4c — the recovery session (controller) over the REAL M3b4b runner.
//
// EVIDENCE CLASS M: real source binding, target capability, evidence collector
// and runner over the plugin-faithful engine and a disposable synthetic WebView
// store, on both platforms. Fingerprints are the labelled synthetic digests.
// These tests prove controller behaviour; they are not simulator or device
// evidence, and a B4 here is a migration result, never an activation verdict.
//
// Each `ucase(...)` label is traced in `nativeMigrationRecoveryCoverage.test.ts`.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeMigrationRunReport, NativeMigrationRunner } from "../nativeMigrationRunner";
import { createNativeMigrationSession, type NativeMigrationSession } from "../nativeMigrationSession";
import { BASE_SOURCE, ELIGIBLE_BASE, KEY_SESSION, fp } from "./nativeMigrationTestKit";
import {
  LATCH_KEY,
  MARKER_KEY,
  PLATFORMS,
  boot,
  commitReaches,
  deferred,
  device,
  once,
  reachActive,
  sameContext,
  until,
  type Device,
  type Process,
} from "./nativeMigrationMTestKit";

afterEach(() => vi.unstubAllGlobals());

const ucase = (id: string, title: string, fn: () => Promise<void>) => it(`${id} — ${title}`, fn);
const SORTED = [...ELIGIBLE_BASE].sort();

/** Waits until the session has settled out of `running`/`handing_over`. */
async function settle(session: NativeMigrationSession): Promise<void> {
  await until(() => {
    const status = session.getSnapshot().status;
    return status !== "running" && status !== "handing_over" && status !== "idle";
  }, "session settled");
}

function sessionFor(p: Process): { session: NativeMigrationSession; runs: () => number } {
  let runs = 0;
  const counted: NativeMigrationRunner = {
    run: () => {
      runs += 1;
      vi.stubGlobal("localStorage", p.device.storage);
      return p.runner.run();
    },
    dispose: () => p.runner.dispose(),
  };
  return { session: createNativeMigrationSession({ runner: counted }), runs: () => runs };
}

const statements = (d: Device, pattern: RegExp) => d.state.executed.filter((entry) => pattern.test(entry.requested)).length;

describe.each(PLATFORMS)("real runner integration (%s)", (platform) => {
  ucase("§6.8:access", "initial check → permitted plans → B4 → handover; a migration result, never an activation verdict", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d);
    const { session } = sessionFor(p);
    expect(session.getSnapshot().status).toBe("idle");
    session.start();
    expect(session.getSnapshot()).toMatchObject({ status: "running", presentation: { kind: "running", group: "G1" } });
    await settle(session);
    const snapshot = session.getSnapshot();
    expect(snapshot.status).toBe("access");
    expect(snapshot.presentation).toMatchObject({ kind: "access", phase: "active" });
    expect(snapshot.completedPlans).toEqual(["AP-D3", "AP-COPY", "AP-COPY", "AP-CC", "AP-ACT"]);
    // No verdict and no composition: the snapshot is a migration status only.
    expect(Object.keys(snapshot).sort()).toEqual(["completedPlans", "lastStoppedPlan", "presentation", "runSequence", "status"]);
    // The handover freed the lease: another owner in this SAME context can now
    // acquire the target, and it finds B4.
    const competitor = await sameContext(p);
    expect((await competitor.run()).outcome).toBe("access");
  });

  ucase("U2-3", "retryable halt (marker outcome unknown) → recheck on the same runner → reopen → continuation", async () => {
    const d = device(platform, BASE_SOURCE);
    d.storage.faults.setItem = once((key: string) => key === MARKER_KEY, "apply_then_reject" as const, "ok" as const);
    const p = await boot(d);
    const { session, runs } = sessionFor(p);
    session.start();
    await settle(session);
    expect(session.getSnapshot().presentation).toMatchObject({ kind: "blocking", group: "G2", explanation: "halt_unknown_outcome", recheck: true });
    const opensBefore = d.state.executed.length;
    expect(session.recheck()).toBe(true);
    await settle(session);
    expect(session.getSnapshot().status).toBe("access");
    expect(runs()).toBe(2);
    // The recheck reopened the connection under the same runner before reading.
    expect(d.state.executed.length).toBeGreaterThan(opensBefore);
  });

  ucase("U2-2", "unknown target-transaction outcome → G2 with confirmed/unknown/not-issued kept apart → recheck continues", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d, { faults: { onCommit: once(commitReaches("copying", (w) => w.has(SORTED[0])), "reject_after_effect" as const, "ok" as const) } });
    const { session } = sessionFor(p);
    session.start();
    await settle(session);
    const halted = session.getSnapshot().presentation;
    expect(halted).toMatchObject({ kind: "blocking", group: "G2", explanation: "halt_unknown_outcome" });
    if (halted.kind !== "blocking") return;
    expect(halted.steps.map((step) => step.disposition)).toContain("outcome_unknown");
    expect(halted.codes).toContain("transaction:outcome_unknown");
    session.recheck();
    await settle(session);
    expect(session.getSnapshot().status).toBe("access");
  });

  ucase("U2-4", "reopen failure at close, release and open: G2, no evidence read before the reopen succeeds", async () => {
    for (const boundary of ["close", "release", "open"] as const) {
      const d = device(platform, BASE_SOURCE);
      d.storage.faults.setItem = once((key: string) => key === MARKER_KEY, "reject_before_apply" as const, "ok" as const);
      const p = await boot(d);
      const { session } = sessionFor(p);
      session.start();
      await settle(session);
      expect(session.getSnapshot().presentation).toMatchObject({ group: "G2" });
      if (boundary === "close") p.faults.onClose = once(() => true, "reject_before_effect" as const, "ok" as const);
      if (boundary === "release") p.faults.onCloseConnection = once(() => true, "reject_before_effect" as const, "ok" as const);
      if (boundary === "open") p.faults.openRejects = true;
      const reads = statements(d, /^\s*SELECT/i);
      session.recheck();
      await settle(session);
      expect(session.getSnapshot().presentation, boundary).toMatchObject({ group: "G2", explanation: "reopen_failed", codes: [`reopen_failed:${boundary}`] });
      expect(statements(d, /^\s*SELECT/i), boundary).toBe(reads);
      p.faults.openRejects = false;
      session.recheck();
      await settle(session);
      expect(session.getSnapshot().status, boundary).toBe("access");
    }
  });

  ucase("U2-4", "an external holder is refused without takeover; continuation only after it positively frees the target", async () => {
    const d = device(platform, BASE_SOURCE);
    const holder = await boot(d);
    // The holder completes and keeps its lease until it is disposed.
    let holderReport = await holder.run();
    while (holderReport.outcome !== "access") holderReport = await holder.run();
    const contender = await sameContext(holder);
    const { session } = sessionFor(contender);
    session.start();
    await settle(session);
    expect(session.getSnapshot().presentation).toMatchObject({ group: "G2", explanation: "storage_busy_elsewhere", recheck: true });
    session.recheck();
    await settle(session);
    expect(session.getSnapshot().presentation).toMatchObject({ explanation: "storage_busy_elsewhere" });
    // The holder resolves its own work and frees the target.
    expect(await holder.runner.dispose()).toEqual({ ok: true });
    session.recheck();
    await settle(session);
    expect(session.getSnapshot().status).toBe("access");
  });

  ucase("§6.8:fault", "warm 'matches neither' → G3; the fault stop holds; disposal keeps the lease; no replacement owner", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d, { faults: { onCommit: once(commitReaches("copying", (w) => w.has(SORTED[0])), "reject_after_effect" as const, "ok" as const) } });
    const { session } = sessionFor(p);
    session.start();
    await settle(session);
    expect(session.getSnapshot().presentation).toMatchObject({ group: "G2" });
    // The issued row now holds bytes the plan never wrote.
    d.state.rows.set(SORTED[0], "bytes no plan issued");
    session.recheck();
    await settle(session);
    expect(session.getSnapshot().presentation).toMatchObject({ kind: "blocking", group: "G3", explanation: "fault_detected", recheck: false });
    expect(session.recheck()).toBe(false);
    expect(d.state.rows.has(LATCH_KEY)).toBe(true);
    expect(await session.dispose()).toEqual({ ok: false, reason: "fault_stop_held" });
    // Ownership retained: a second owner in this context cannot evaluate cold.
    const replacement = await sameContext(p);
    expect(await replacement.run()).toMatchObject({ outcome: "target_refused" });
  });

  ucase("§6.8:latch", "a present latch is G3 without recheck; a latch read failure is G2", async () => {
    const latched = device(platform, BASE_SOURCE);
    await reachActive(latched);
    latched.state.rows.set(LATCH_KEY, "any bytes");
    const a = sessionFor(await boot(latched));
    a.session.start();
    await settle(a.session);
    expect(a.session.getSnapshot().presentation).toMatchObject({ group: "G3", explanation: "latch_present", recheck: false });

    const unreadable = device(platform, BASE_SOURCE);
    await reachActive(unreadable);
    const b = sessionFor(await boot(unreadable, {
      faults: { onQuery: once((_sql: string, values: readonly unknown[]) => values[0] === LATCH_KEY, { reject: true } as const, undefined) },
    }));
    b.session.start();
    await settle(b.session);
    expect(b.session.getSnapshot().presentation).toMatchObject({ group: "G2", recheck: true });
    b.session.recheck();
    await settle(b.session);
    expect(b.session.getSnapshot().status).toBe("access");
  });

  ucase("U2-3", "bound_reached stays non-ready (G2) and needs an explicit recheck; no automatic loop", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d, { limits: { maxPlansPerRun: 1 } });
    const { session, runs } = sessionFor(p);
    session.start();
    await settle(session);
    expect(session.getSnapshot().presentation).toMatchObject({ group: "G2", explanation: "bound_reached", recheck: true });
    // Nothing runs on its own.
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(runs()).toBe(1);
    for (let i = 0; i < 10 && session.getSnapshot().status !== "access"; i += 1) {
      expect(session.recheck()).toBe(true);
      await settle(session);
    }
    expect(session.getSnapshot().status).toBe("access");
  });

  ucase("U2-12", "a healthy active target is used without reading the old source or its marker", async () => {
    const d = device(platform, BASE_SOURCE);
    await reachActive(d);
    d.storage.valueReads.length = 0;
    d.storage.lengthReads = 0;
    d.storage.faults.getItemThrows = () => true;
    d.storage.faults.lengthThrows = true;
    const { session } = sessionFor(await boot(d));
    session.start();
    await settle(session);
    expect(session.getSnapshot().status).toBe("access");
    expect(d.storage.valueReads).toEqual([]);
    expect(d.storage.lengthReads).toBe(0);
  });

  ucase("U2-13", "an access-barrier key is copied as bytes; no session action touches identity", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d);
    const { session } = sessionFor(p);
    session.start();
    await settle(session);
    expect(session.getSnapshot().status).toBe("access");
    // The session's API has no identity entry point at all.
    expect(Object.keys(session).sort()).toEqual(["dispose", "getSnapshot", "recheck", "start", "subscribe"]);
  });
});

describe.each(PLATFORMS)("lifecycle and ownership (%s)", (platform) => {
  ucase("U2-3", "concurrent start and recheck calls join one execution", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d);
    const { session, runs } = sessionFor(p);
    session.start();
    session.start();
    expect(session.recheck()).toBe(false);
    session.start();
    await settle(session);
    expect(runs()).toBe(1);
  });

  ucase("U2-6", "disposal before COMMIT: the transaction is rolled back, nothing new is issued, nothing is published", async () => {
    const d = device(platform, BASE_SOURCE);
    const gate = deferred();
    let held = false;
    const p = await boot(d, {
      faults: {
        gate: (call) => {
          if (held || call.kind !== "run") return;
          held = true;
          return gate.promise;
        },
      },
    });
    const { session } = sessionFor(p);
    let published = 0;
    session.subscribe(() => { published += 1; });
    session.start();
    await until(() => held, "a statement inside the first transaction");
    const before = published;
    const disposing = session.dispose();
    gate.resolve();
    const result = await disposing;
    expect(statements(d, /^COMMIT/i)).toBe(0);
    expect(statements(d, /^ROLLBACK/i)).toBeGreaterThan(0);
    // The stopped write is kept as I-11 plan evidence, so the approved runner
    // keeps the lease rather than letting a cold owner replace it.
    expect(result).toEqual({ ok: false, reason: "plan_evidence_held" });
    expect(await (await sameContext(p)).run()).toMatchObject({ outcome: "target_refused" });
    // Exactly one notification — the terminal invalidation at the disposal
    // boundary — and no late progress afterwards.
    expect(published).toBe(before + 1);
    expect(session.getSnapshot()).toMatchObject({ status: "disposed", presentation: { kind: "ended" } });
  });

  ucase("U2-6", "disposal after COMMIT was issued: it is awaited and never rolled back afterwards", async () => {
    const d = device(platform, BASE_SOURCE);
    const gate = deferred();
    let held = false;
    const p = await boot(d, {
      faults: {
        gate: (call) => {
          if (held || call.kind !== "commit") return;
          held = true;
          return gate.promise;
        },
      },
    });
    const { session } = sessionFor(p);
    session.start();
    await until(() => held, "the first COMMIT");
    const rollbacksBefore = statements(d, /^ROLLBACK/i);
    const disposing = session.dispose();
    let settledEarly = false;
    void disposing.then(() => { settledEarly = true; });
    await new Promise((resolve) => setTimeout(resolve, 10));
    // Disposal waits for the unanswered COMMIT; a timeout releases nothing.
    expect(settledEarly).toBe(false);
    gate.resolve();
    await disposing;
    expect(statements(d, /^COMMIT/i)).toBe(1);
    expect(statements(d, /^ROLLBACK/i)).toBe(rollbacksBefore);
    expect(session.getSnapshot().status).not.toBe("access");
  });

  ucase("U2-6", "disposal while a digest is pending: no further read or digest, and the late result is not published", async () => {
    const d = device(platform, BASE_SOURCE);
    const digest = deferred();
    let pending = 0;
    let after = 0;
    const p = await boot(d, {
      fingerprint: async (value) => {
        if (pending === 0) {
          pending += 1;
          await digest.promise;
          return fp(value);
        }
        after += 1;
        return fp(value);
      },
    });
    const { session } = sessionFor(p);
    session.start();
    await until(() => pending === 1, "the first digest");
    const reads = d.storage.valueReads.length;
    const disposing = session.dispose();
    digest.resolve();
    await disposing;
    expect(after).toBe(0);
    expect(d.storage.valueReads.length).toBe(reads);
    expect(session.getSnapshot()).toMatchObject({ status: "disposed", presentation: { kind: "ended" } });
  });

  ucase("U2-6", "retained plan evidence keeps the lease; no replacement owner in the same context", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d, { faults: { onCommit: once(commitReaches("copying", (w) => w.has(SORTED[0])), "reject_after_effect" as const, "ok" as const) } });
    const { session } = sessionFor(p);
    session.start();
    await settle(session);
    expect(await session.dispose()).toEqual({ ok: false, reason: "plan_evidence_held" });
    expect(await session.dispose()).toEqual({ ok: false, reason: "plan_evidence_held" });
    expect(await (await sameContext(p)).run()).toMatchObject({ outcome: "target_refused" });
  });

  ucase("U2-6", "uncertain cleanup keeps ownership: a failed close is reported, not swallowed", async () => {
    const d = device(platform, BASE_SOURCE);
    d.storage.faults.setItem = once((key: string) => key === MARKER_KEY, "reject_before_apply" as const, "ok" as const);
    const p = await boot(d);
    const { session } = sessionFor(p);
    session.start();
    await settle(session);
    p.faults.closeRejects = true;
    const result = await session.dispose();
    expect(result.ok).toBe(false);
    expect(await (await sameContext(p)).run()).toMatchObject({ outcome: "target_refused" });
  });

  ucase("U2-5", "an unanswered call keeps the session running indefinitely; nothing times out into a halt", async () => {
    const d = device(platform, BASE_SOURCE);
    const gate = deferred();
    const p = await boot(d, { faults: { gate: (call) => (call.kind === "commit" ? gate.promise : undefined) } });
    const { session, runs } = sessionFor(p);
    session.start();
    await until(() => d.state.executed.length > 0, "work issued");
    await new Promise((resolve) => setTimeout(resolve, 30));
    expect(session.getSnapshot().status).toBe("running");
    expect(session.recheck()).toBe(false);
    expect(runs()).toBe(1);
    gate.resolve();
    await settle(session);
  });
});

describe("observers and unexpected failures (stub runners)", () => {
  const report = (r: Partial<NativeMigrationRunReport> & { outcome: string }) => ({ completedPlans: [], ...r }) as NativeMigrationRunReport;

  ucase("U2-15", "a rejecting runner is G4 'unexpected', and the thrown text is never in the snapshot", async () => {
    const session = createNativeMigrationSession({
      runner: { run: () => Promise.reject(new Error("bridge exploded with SYNTHETIC_CREDENTIAL_SENTINEL")), dispose: async () => ({ ok: true }) },
    });
    session.start();
    await settle(session);
    expect(session.getSnapshot().presentation).toMatchObject({ group: "G4", explanation: "internal_check", recheck: false });
    expect(JSON.stringify(session.getSnapshot())).not.toContain("SYNTHETIC_CREDENTIAL_SENTINEL");
  });

  ucase("U2-17", "an already-known retirement finding is rendered from the report; the runner is asked nothing else", async () => {
    const calls: string[] = [];
    const session = createNativeMigrationSession({
      runner: {
        run: async () => { calls.push("run"); return report({ outcome: "access", rule: "B4", recordPhase: "active", retirement: { rule: "B3", state: "resume", deletable: [], retainChanged: [KEY_SESSION], unverifiable: [] } } as never); },
        dispose: async () => { calls.push("dispose"); return { ok: true }; },
      },
    });
    session.start();
    await settle(session);
    expect(session.getSnapshot()).toMatchObject({ status: "access", presentation: { kind: "access", retirement: { kind: "declined_deletion", retained: 1 } } });
    expect(calls).toEqual(["run", "dispose"]);
  });

  ucase("U2-15", "a B4 whose lease could not be freed is G4 'handover_failed', never access", async () => {
    const session = createNativeMigrationSession({
      runner: { run: async () => report({ outcome: "access", rule: "B4", retirement: { state: "complete" } } as never), dispose: async () => ({ ok: false, boundary: "release" }) },
    });
    session.start();
    await settle(session);
    expect(session.getSnapshot()).toMatchObject({ status: "settled", presentation: { group: "G4", explanation: "handover_failed", recheck: false } });
  });

  ucase("U2-6", "a late success after disposal is never published", async () => {
    let resolveRun: (r: NativeMigrationRunReport) => void = () => undefined;
    const session = createNativeMigrationSession({
      runner: { run: () => new Promise((resolve) => { resolveRun = resolve; }), dispose: async () => ({ ok: true }) },
    });
    const seen: string[] = [];
    session.subscribe(() => seen.push(session.getSnapshot().status));
    session.start();
    await session.dispose();
    resolveRun(report({ outcome: "access", rule: "B4", retirement: { state: "complete" } } as never));
    await new Promise((resolve) => setTimeout(resolve, 5));
    // The terminal state is announced once, at disposal; the late success is not.
    expect(seen).toEqual(["running", "disposed"]);
    expect(session.getSnapshot()).toMatchObject({ status: "disposed", presentation: { kind: "ended" } });
    session.start();
    expect(session.recheck()).toBe(false);
  });

  ucase("U2-6", "a throwing observer cannot stop a run or alter its outcome; unsubscribing never disposes", async () => {
    let disposed = 0;
    const session = createNativeMigrationSession({
      runner: { run: async () => report({ outcome: "bound_reached" }), dispose: async () => { disposed += 1; return { ok: true }; } },
    });
    const unsubscribe = session.subscribe(() => { throw new Error("observer failure"); });
    const quiet = session.subscribe(() => undefined);
    session.start();
    await settle(session);
    expect(session.getSnapshot().presentation).toMatchObject({ explanation: "bound_reached" });
    unsubscribe();
    quiet();
    expect(disposed).toBe(0);
  });

  it("refuses to start without a runner", () => {
    expect(() => createNativeMigrationSession({ runner: undefined as unknown as NativeMigrationRunner })).toThrow(TypeError);
  });
});
