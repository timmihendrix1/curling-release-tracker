// Regressions for the four M3b4b review findings (Codex), through the REAL
// source binding, target capability, evidence collector and runner over the
// plugin-faithful engine, on both platforms. Class M; synthetic data only.
//
//   A. ownership of a database spans every factory instance and engine wrapper
//      in one live context — a detected fault cannot be bypassed by constructing
//      another binding;
//   B. disposal is honoured after every asynchronous boundary: nothing new is
//      issued, access is never published, an uncommitted transaction is rolled
//      back and an issued COMMIT's real outcome is reported;
//   C. the source marker's precondition is re-established at the write: a
//      foreign, malformed or unreadable marker is never overwritten;
//   D. every halt is followed, on the next explicit run, by a positively
//      established close → release → fresh open before any evidence is read.
//
// Cancellation points are driven by controllable promises (`deferred`) and
// recorded events, not by timing guesses. Observations made inside bridge hooks
// are recorded and asserted afterwards, never only inside a hook the production
// layer would swallow.
import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeActivationRecord } from "../nativeMigrationRecord";
import type { NativeMigrationRunReport } from "../nativeMigrationRunner";
import { BASE_SOURCE, ELIGIBLE_BASE, STORE_FOREIGN, fp } from "./nativeMigrationTestKit";
import {
  LATCH_KEY,
  MARKER_KEY,
  PLATFORMS,
  RECORD_KEY,
  TARGET_DATABASE,
  boot,
  commitReaches,
  committedRecord,
  deferred,
  device,
  newContext,
  once,
  phaseOf,
  reachActive,
  reachCopying,
  reachEnumerating,
  reachVerified,
  recordIn,
  sameContext,
  syntheticUuid,
  until,
  type Device,
  type Process,
} from "./nativeMigrationMTestKit";
import { createPluginFaithfulEngine, type PluginPlatform } from "./pluginFaithfulSqliteEngine";

afterEach(() => vi.unstubAllGlobals());

const NEITHER_ID = "99999999-9999-4999-8999-999999999999";
const FIRST_BATCH = [...ELIGIBLE_BASE].sort().slice(0, 2);

function rewriteNeither(d: Device): void {
  const record = committedRecord(d);
  if (!record) throw new Error("no record");
  d.state.rows.set(RECORD_KEY, serializeActivationRecord({ ...record, migrationId: NEITHER_ID }));
}

const since = (d: Device, mark: number) => d.state.trace.slice(mark);
const writesIn = (trace: readonly string[]) => trace.filter((entry) => /^(run:|begin|commit)/.test(entry));

/** The first entries after `mark` must be close → release → a fresh connection (create, open), before any query. */
function expectReopenedFirst(d: Device, mark: number): void {
  const trace = since(d, mark);
  const firstQuery = trace.findIndex((entry) => entry.startsWith("query:"));
  expect(firstQuery, JSON.stringify(trace)).toBeGreaterThan(0);
  expect(trace.slice(0, firstQuery), JSON.stringify(trace)).toEqual(["close", "release", "create", "open"]);
}

/** An ordinary native store for the same database, in the same live context, over its own engine wrapper. */
function ordinaryCompetitor(p: Process, platform: PluginPlatform) {
  const wrapper = createPluginFaithfulEngine({ platform, state: p.device.state });
  const store = p.context.adapter.createNativeSqliteStore({
    databaseName: TARGET_DATABASE,
    engine: wrapper.engine,
    detectPlatform: () => platform,
  });
  return { store, wrapper };
}

/* ======================================================================== A */

describe.each(PLATFORMS)("%s — A: ownership spans every binding of a database in one live context", (platform) => {
  it("the reported reproduction: a fault whose latch failed cannot be bypassed by a second binding in the same context", async () => {
    const d = device(platform, {});
    const p = await boot(d, {
      faults: {
        onCommit: once(commitReaches("active"), "reject_after_effect" as const, "ok" as const),
      },
    });
    expect((await p.run()).outcome).toBe("halted");
    rewriteNeither(d);
    p.faults.onCommit = (w) => (w.has(LATCH_KEY) ? "reject_before_effect" : "ok");
    const fault = await p.run();
    expect(fault.outcome).toBe("fault");
    if (fault.outcome === "fault") expect(fault.latch).toMatchObject({ established: null, attemptsRemain: false });
    expect(d.state.rows.has(LATCH_KEY)).toBe(false);
    expect(await p.runner.dispose()).toEqual({ ok: false, reason: "fault_stop_held" });

    // Another engine wrapper, binding and runner for the SAME database, SAME context.
    const traceBefore = d.state.trace.length;
    const second = await sameContext(p);
    const report = await second.run();
    expect(report).toMatchObject({ outcome: "target_refused", reason: "lease_held" });
    expect(second.plugin.connectionOpen).toBe(false);
    expect(since(d, traceBefore)).toEqual([]);
    // Nor can its ordinary, diagnostic or lifecycle surfaces touch the database.
    expect((await second.store.adapter.get(RECORD_KEY)).status).toBe("read_failed");
    expect(await second.store.beginDiagnosticTransaction()).toEqual({ ok: false, reason: "transaction_pending" });
    expect((await second.store.close()).ok).toBe(false);
    expect(since(d, traceBefore)).toEqual([]);

    // Only a genuinely new context (a new process) evaluates afresh: the latch did
    // not persist, so that is the stated cold-start residual — and only then.
    expect((await (await boot(d)).run()).outcome).toBe("access");
  });

  it("a held lease refuses a second binding; after a normal release the second one proceeds", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d);
    expect((await p.run()).outcome).toBe("access");
    const second = await sameContext(p);
    expect(await second.run()).toMatchObject({ outcome: "target_refused", reason: "lease_held" });
    expect(await p.runner.dispose()).toEqual({ ok: true });
    const traceBefore = d.state.trace.length;
    expect((await second.run()).outcome).toBe("access");
    expect(writesIn(since(d, traceBefore))).toEqual([]);
  });

  it("an ordinary store holding a handle blocks the lease; once it closes, migration proceeds; then the store is refused", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d);
    const { store, wrapper } = ordinaryCompetitor(p, platform);
    await store.adapter.get("anything");
    expect(wrapper.connectionOpen).toBe(true);
    expect(await p.run()).toMatchObject({ outcome: "target_refused", reason: "connection_held_elsewhere" });
    expect(d.state.trace.filter((entry) => entry === "begin")).toEqual([]);
    expect((await store.close()).ok).toBe(true);
    expect((await p.run()).outcome).toBe("access");
    // Now the lease is held: the competitor can neither use nor reopen nor release the handle.
    const traceBefore = d.state.trace.length;
    expect((await store.adapter.get(RECORD_KEY)).status).toBe("read_failed");
    expect((await store.adapter.set("k", "v")).ok).toBe(false);
    expect(await store.beginDiagnosticTransaction()).toEqual({ ok: false, reason: "transaction_pending" });
    expect((await store.reopenDiagnosticConnection()).ok).toBe(false);
    expect((await store.deleteAllRecords()).ok).toBe(false);
    expect((await store.close()).ok).toBe(false);
    expect(since(d, traceBefore)).toEqual([]);
    expect(wrapper.connectionOpen).toBe(false);
  });

  it("a diagnostic transaction on another binding blocks the lease", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d);
    const { store } = ordinaryCompetitor(p, platform);
    const begun = await store.beginDiagnosticTransaction();
    expect(begun.ok).toBe(true);
    expect(await p.run()).toMatchObject({ outcome: "target_refused", reason: "connection_held_elsewhere" });
    if (begun.ok) await store.rollbackDiagnosticTransaction(begun.token);
    await store.close();
    expect((await p.run()).outcome).toBe("access");
  });

  it("a pending bridge call keeps ownership: a second binding is refused while it is unanswered", async () => {
    const d = device(platform, BASE_SOURCE);
    const gate = deferred();
    let reached = false;
    const p = await boot(d, {
      faults: {
        gate: (call) => {
          if (call.kind !== "commit" || reached) return;
          reached = true;
          return gate.promise;
        },
      },
    });
    const running = p.run();
    await until(() => reached, "the first COMMIT");
    const second = await sameContext(p);
    expect(await second.run()).toMatchObject({ outcome: "target_refused", reason: "lease_held" });
    gate.resolve();
    expect((await running).outcome).toBe("access");
  });

  it("an owner whose cleanup is uncertain keeps the lease: dispose fails and a second binding stays refused", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d, { faults: { onCommit: once(commitReaches("enumerating"), "reject_after_effect" as const, "ok" as const) } });
    expect((await p.run()).outcome).toBe("halted");
    // It holds an unresolved unknown outcome: releasing would let a cold
    // evaluation in this same context replace the warm comparison.
    expect(await p.runner.dispose()).toEqual({ ok: false, reason: "plan_evidence_held" });
    expect(p.target.leaseState()).not.toBe("unowned");
    expect(await (await sameContext(p)).run()).toMatchObject({ outcome: "target_refused", reason: "lease_held" });
  });

  it("stale and cross-owner leases resolve nothing — including a forged lease with an identical id", async () => {
    const context = await newContext();
    const name = `${TARGET_DATABASE}-leases-${platform}`;
    const make = async () => (await context.bindings.createNativeMigrationTarget({
      databaseName: name,
      engine: createPluginFaithfulEngine({ platform }).engine,
      detectPlatform: () => platform,
    })).target;
    const first = await make();
    const second = await make();
    const a = await first.acquire();
    if (!a.ok) throw new Error("acquire");
    expect(await second.acquire()).toEqual({ ok: false, reason: "lease_held" });
    expect(await second.readReserved(a.lease)).toEqual({ ok: false, reason: "wrong_lease" });
    expect(await second.transact(a.lease, { kind: "insert_latch", content: "{}" })).toEqual({ status: "refused", reason: "wrong_lease" });
    expect(await second.release(a.lease)).toEqual({ ok: false, reason: "wrong_lease" });
    expect((await first.release(a.lease)).ok).toBe(true);
    const b = await second.acquire();
    if (!b.ok) throw new Error("acquire");
    expect(b.lease.id).not.toBe(a.lease.id);
    for (const stale of [a.lease, { id: b.lease.id }, { id: a.lease.id }]) {
      expect(await second.readReserved(stale)).toEqual({ ok: false, reason: "wrong_lease" });
      expect(await first.readReserved(stale)).toEqual({ ok: false, reason: "wrong_lease" });
    }
    expect(await first.readReserved(b.lease)).toEqual({ ok: false, reason: "wrong_lease" });
    expect((await second.readReserved(b.lease)).ok).toBe(true);
  });

  it("different databases are owned independently in the same context", async () => {
    const context = await newContext();
    const targets = await Promise.all(["one", "two"].map((suffix) => context.bindings.createNativeMigrationTarget({
      databaseName: `${TARGET_DATABASE}-${suffix}-${platform}`,
      engine: createPluginFaithfulEngine({ platform }).engine,
      detectPlatform: () => platform,
    })));
    const leases = await Promise.all(targets.map((binding) => binding.target.acquire()));
    expect(leases.every((lease) => lease.ok)).toBe(true);
  });
});

/* ======================================================================== B */

describe.each(PLATFORMS)("%s — B: disposal is honoured after every asynchronous boundary", (platform) => {
  /** Pauses the injected fingerprint at the first call for which `when` holds. */
  function pausingFingerprint(when: () => boolean) {
    const gate = deferred();
    const state = { paused: false };
    const fingerprint = async (value: string) => {
      if (!state.paused && when()) {
        state.paused = true;
        await gate.promise;
      }
      return fp(value);
    };
    return { gate, state, fingerprint };
  }

  it("reproduction 1: disposal during AP-ACT's in-transaction verifier → no UPDATE, no COMMIT, still verified, never access", async () => {
    const d = device(platform, BASE_SOURCE);
    await reachVerified(d);
    // The pause reads the process's engine after boot() returns; a holder makes that explicit.
    const ref: { p?: Process } = {};
    const pause = pausingFingerprint(() => ref.p?.plugin.transactionOpen === true);
    const p = (ref.p = await boot(d, { fingerprint: pause.fingerprint }));
    const mark = d.state.trace.length;
    const running = p.run();
    await until(() => pause.state.paused, "the verifier digest");
    const disposing = p.runner.dispose();
    pause.gate.resolve();
    const report = await running;
    expect(report).toMatchObject({ outcome: "disposed", plan: "AP-ACT", transaction: { status: "not_committed", reason: "cancelled", writeIssued: false } });
    expect(phaseOf(d)).toBe("verified");
    const trace = since(d, mark);
    expect(trace.some((entry) => entry.startsWith("run:UPDATE"))).toBe(false);
    expect(trace).not.toContain("commit");
    expect(trace).toContain("rollback");
    expect(await disposing).toEqual({ ok: true });
    expect(p.target.leaseState()).toBe("unowned");
  });

  it("reproduction 2: disposal during an active evaluation's reserved read → the old run never reports access", async () => {
    const d = device(platform, BASE_SOURCE);
    await reachActive(d);
    const gate = deferred();
    let reached = false;
    const p = await boot(d, {
      faults: {
        gate: (call) => {
          if (reached || call.kind !== "query" || call.values?.[0] !== LATCH_KEY) return;
          reached = true;
          return gate.promise;
        },
      },
    });
    const running = p.run();
    await until(() => reached, "the latch read");
    const disposing = p.runner.dispose();
    gate.resolve();
    expect((await running).outcome).toBe("disposed");
    expect(await disposing).toEqual({ ok: true });
  });

  it("disposal during the target listing of a pre-activation evaluation issues nothing", async () => {
    const d = device(platform, BASE_SOURCE);
    await reachCopying(d, 2);
    const gate = deferred();
    let reached = false;
    const p = await boot(d, {
      faults: {
        gate: (call) => {
          if (reached || call.kind !== "query" || !/SELECT key FROM/.test(call.statement ?? "")) return;
          reached = true;
          return gate.promise;
        },
      },
    });
    const mark = d.state.trace.length;
    const running = p.run();
    await until(() => reached, "the listing");
    void p.runner.dispose();
    gate.resolve();
    expect((await running).outcome).toBe("disposed");
    expect(writesIn(since(d, mark))).toEqual([]);
  });

  it("disposal between two digests of AP-COPY's source read → the read step stops, no checkpoint is begun", async () => {
    const d = device(platform, BASE_SOURCE);
    await reachCopying(d, 0);
    let calls = 0;
    // The evaluation digests the four eligible source values; AP-COPY's own read
    // then digests the batch — pause on the batch's second value.
    const pause = pausingFingerprint(() => (calls += 1) === 6);
    const p = await boot(d, { fingerprint: pause.fingerprint });
    const mark = d.state.trace.length;
    const running = p.run();
    await until(() => pause.state.paused, "the second batch digest");
    void p.runner.dispose();
    pause.gate.resolve();
    const report = await running;
    expect(report).toMatchObject({ outcome: "disposed", plan: "AP-COPY" });
    if (report.outcome === "disposed" && report.halt?.kind === "plan_run" && report.halt.report.status === "halted") {
      expect(report.halt.report.dispositions).toEqual(["failed", "not_issued", "not_issued"]);
    } else throw new Error(JSON.stringify(report));
    expect(since(d, mark)).not.toContain("begin");
    expect(committedRecord(d)?.copied).toEqual([]);
  });

  it("disposal during AP-CC's in-transaction verifier → rolled back, still copying", async () => {
    const d = device(platform, BASE_SOURCE);
    await reachCopying(d, 4);
    // The pause reads the process's engine after boot() returns; a holder makes that explicit.
    const ref: { p?: Process } = {};
    const pause = pausingFingerprint(() => ref.p?.plugin.transactionOpen === true);
    const p = (ref.p = await boot(d, { fingerprint: pause.fingerprint }));
    const mark = d.state.trace.length;
    const running = p.run();
    await until(() => pause.state.paused, "the verifier digest");
    void p.runner.dispose();
    pause.gate.resolve();
    const report = await running;
    expect(report).toMatchObject({ outcome: "disposed", plan: "AP-CC" });
    if (report.outcome === "disposed" && report.halt?.kind === "plan_run" && report.halt.report.status === "halted") {
      expect(report.halt.report.dispositions[0]).toBe("aborted_before_write");
    }
    expect(phaseOf(d)).toBe("copying");
    expect(since(d, mark)).not.toContain("commit");
  });

  it("disposal while a checkpoint statement awaits its acknowledgement → no COMMIT; the batch and progress are rolled back", async () => {
    const d = device(platform, BASE_SOURCE);
    await reachCopying(d, 0);
    const gate = deferred();
    let reached = false;
    const p = await boot(d, {
      faults: {
        gate: (call) => {
          if (reached || call.kind !== "run" || call.values?.[0] !== FIRST_BATCH[1]) return;
          reached = true;
          return gate.promise;
        },
      },
    });
    const mark = d.state.trace.length;
    const running = p.run();
    await until(() => reached, "the second INSERT");
    const disposing = p.runner.dispose();
    gate.resolve();
    const report = await running;
    expect(report).toMatchObject({
      outcome: "disposed",
      plan: "AP-COPY",
      transaction: { status: "not_committed", reason: "cancelled", writeIssued: true, connection: "clean" },
    });
    const trace = since(d, mark);
    expect(trace).not.toContain("commit");
    expect(trace).toContain("rollback");
    expect(committedRecord(d)?.copied).toEqual([]);
    expect(FIRST_BATCH.some((key) => d.state.rows.has(key))).toBe(false);
    // Writes were issued: the issued bytes are warm evidence, so the lease is kept.
    expect(await disposing).toEqual({ ok: false, reason: "plan_evidence_held" });
  });

  it("disposal after COMMIT was issued: its real outcome lands and is reported — confirmed or unknown — never undone", async () => {
    for (const answer of ["ok", "reject_after_effect"] as const) {
      const d = device(platform, BASE_SOURCE);
      await reachCopying(d, 0);
      const gate = deferred();
      let reached = false;
      const p = await boot(d, {
        faults: {
          gate: (call) => {
            if (reached || call.kind !== "commit") return;
            reached = true;
            return gate.promise;
          },
          onCommit: () => answer,
        },
      });
      const running = p.run();
      await until(() => reached, "the COMMIT");
      const disposing = p.runner.dispose();
      gate.resolve();
      const report = await running;
      expect(report.outcome).toBe("disposed");
      // The COMMIT took effect either way.
      expect(committedRecord(d)?.copied).toEqual(FIRST_BATCH);
      if (answer === "ok") {
        expect(report.completedPlans).toEqual([{ name: "AP-COPY", rule: "E′9" }]);
      } else {
        expect(report).toMatchObject({ plan: "AP-COPY", transaction: { status: "outcome_unknown" } });
      }
      // A confirmed or unknown write no completed evaluation has checked: kept.
      expect(await disposing).toEqual({ ok: false, reason: "plan_evidence_held" });
    }
  });

  it("negative control: disposal after completion leaves the completed access report untouched", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d);
    const report = await p.run();
    expect(report.outcome).toBe("access");
    expect(await p.runner.dispose()).toEqual({ ok: true });
  });

  /** A runner whose D1 commit ended unknown and whose durable record now matches neither issued state. */
  async function faultPending(gate: (call: import("./pluginFaithfulSqliteEngine").BridgeCall) => Promise<void> | void) {
    const d = device(platform, {});
    let armed = false;
    const p = await boot(d, {
      faults: {
        onCommit: once(commitReaches("active"), "reject_after_effect" as const, "ok" as const),
        gate: (call) => (armed ? gate(call) : undefined),
      },
    });
    expect((await p.run()).outcome).toBe("halted");
    rewriteNeither(d);
    armed = true;
    return { d, p };
  }

  it("disposal BEFORE the fault is established (mid-evidence): no decision, no write — and the unresolved warm evidence keeps the lease", async () => {
    const gate = deferred();
    let reached = false;
    const { d, p } = await faultPending((call) => {
      if (reached || call.kind !== "query" || call.values?.[0] !== RECORD_KEY) return;
      reached = true;
      return gate.promise;
    });
    const mark = d.state.trace.length;
    const running = p.run();
    await until(() => reached, "the record read");
    const disposing = p.runner.dispose();
    gate.resolve();
    expect((await running).outcome).toBe("disposed");
    expect(writesIn(since(d, mark))).toEqual([]);
    expect(await disposing).toEqual({ ok: false, reason: "plan_evidence_held" });
    // No other runner in this context can evaluate cold in its place.
    expect(await (await sameContext(p)).run()).toMatchObject({ outcome: "target_refused", reason: "lease_held" });
  });

  it("disposal AFTER the fault is established (its latch transaction pending): the stop and lease are retained; the latch is rolled back, not counted", async () => {
    const gate = deferred();
    let reached = false;
    const { d, p } = await faultPending((call) => {
      if (reached || call.kind !== "begin") return;
      reached = true;
      return gate.promise;
    });
    const running = p.run();
    await until(() => reached, "the latch BEGIN");
    const disposing = p.runner.dispose();
    gate.resolve();
    const report = await running;
    expect(report.outcome).toBe("fault");
    if (report.outcome === "fault") expect(report.latch.attempts).toEqual([]);
    expect(d.state.rows.has(LATCH_KEY)).toBe(false);
    expect(await disposing).toEqual({ ok: false, reason: "fault_stop_held" });
    expect(await (await sameContext(p)).run()).toMatchObject({ outcome: "target_refused", reason: "lease_held" });
  });
});

/* ======================================================================== C */

describe.each(PLATFORMS)("%s — C: the marker's precondition is re-established at the write", (platform) => {
  type Variant = "foreign" | "malformed" | "unreadable";
  const inject: Record<Variant, (d: Device) => void> = {
    foreign: (d) => d.storage.map.set(MARKER_KEY, STORE_FOREIGN),
    malformed: (d) => d.storage.map.set(MARKER_KEY, "{malformed"),
    unreadable: (d) => { d.storage.faults.getItemThrows = (key) => key === MARKER_KEY; },
  };
  const nextRule: Record<Variant, string> = { foreign: "PV12", malformed: "PV11", unreadable: "PV10" };

  function expectRefusedAt(report: NativeMigrationRunReport, step: number, reason: string): void {
    expect(report, JSON.stringify(report)).toMatchObject({
      outcome: "halted",
      halt: { kind: "not_issued", step, cause: "precondition_failed" },
      marker: { step, status: "refused", reason },
    });
  }

  for (const variant of ["foreign", "malformed", "unreadable"] as const) {
    it(`AP-D3 (reproduction): a ${variant} marker appearing after the record commit is never overwritten; next ${nextRule[variant]}`, async () => {
      const d = device(platform, BASE_SOURCE);
      const original = variant === "foreign" ? STORE_FOREIGN : variant === "malformed" ? "{malformed" : undefined;
      const p = await boot(d, {
        faults: {
          onCommit: (w) => {
            if (commitReaches("enumerating")(w) && !d.state.rows.has(RECORD_KEY)) inject[variant](d);
            return "ok";
          },
        },
      });
      const report = await p.run();
      expectRefusedAt(report, 1, variant === "unreadable" ? "marker_unreadable" : "marker_present");
      expect(phaseOf(d)).toBe("enumerating"); // step 1's confirmed record is kept
      expect(d.storage.map.get(MARKER_KEY)).toBe(original);
      expect(d.storage.writes.filter((key) => key === MARKER_KEY)).toEqual([]);
      const afterHalt = d.state.trace.lastIndexOf("commit");
      expect(d.state.trace.slice(afterHalt + 1)).not.toContain("begin");
      const mark = d.state.trace.length;
      const next = await p.run();
      expect(next).toMatchObject({ outcome: "blocked", rule: nextRule[variant] });
      expectReopenedFirst(d, mark);
      expect(d.storage.map.get(MARKER_KEY)).toBe(original);
    });
  }

  it("AP-D3: an already matching marker writes nothing and continues, reported as such; an absent one is written", async () => {
    const matching = device(platform, BASE_SOURCE);
    const p = await boot(matching, {
      faults: {
        onCommit: (w) => {
          const record = recordIn(w);
          if (record?.phase === "enumerating" && !matching.state.rows.has(RECORD_KEY)) matching.storage.map.set(MARKER_KEY, record.storeIdentity);
          return "ok";
        },
      },
    });
    const report = await p.run();
    expect(report.outcome).toBe("access");
    expect(report.completedPlans[0]).toEqual({ name: "AP-D3", rule: "PV7", markerAlreadyMatching: true });
    expect(matching.storage.writes.filter((key) => key === MARKER_KEY)).toEqual([]);
    const absent = device(platform, BASE_SOURCE);
    expect((await (await boot(absent)).run()).completedPlans[0]).toEqual({ name: "AP-D3", rule: "PV7" });
    expect(absent.storage.writes.filter((key) => key === MARKER_KEY)).toEqual([MARKER_KEY]);
  });

  it("AP-D3: a write rejected before or after it applied is an ISSUED write with an unknown outcome", async () => {
    for (const mode of ["reject_before_apply", "apply_then_reject"] as const) {
      const d = device(platform, BASE_SOURCE);
      const p = await boot(d);
      d.storage.faults.setItem = () => mode;
      const report = await p.run();
      expect(report).toMatchObject({ outcome: "halted", marker: { step: 1, status: "write_failed" } });
      if (report.outcome === "halted" && report.halt.kind === "plan_run" && report.halt.report.status === "halted") {
        expect(report.halt.report.unknownStep).toBe(1);
      }
      expect(d.storage.map.has(MARKER_KEY)).toBe(mode === "apply_then_reject");
    }
  });

  const continuations: [string, (d: Device) => Promise<void>][] = [
    ["AP-K1′", reachEnumerating],
    ["AP-COPY", (d) => reachCopying(d, 2)],
    ["AP-CC", (d) => reachCopying(d, 4)],
    ["AP-ACT", reachVerified],
  ];
  for (const [plan, setup] of continuations) {
    for (const variant of ["foreign", "malformed", "unreadable"] as const) {
      it(`${plan}: a ${variant} marker appearing after the decision, before the write, is refused; no target transaction; next ${nextRule[variant]}`, async () => {
        const d = device(platform, BASE_SOURCE);
        await setup(d);
        d.storage.map.delete(MARKER_KEY);
        const p = await boot(d);
        let markerReads = 0;
        // The evaluation reads the marker once; the write's own check is the second read.
        d.storage.faults.beforeGetItem = (key) => {
          if (key === MARKER_KEY && ++markerReads === 2) inject[variant](d);
        };
        const rows = new Map(d.state.rows);
        const mark = d.state.trace.length;
        const report = await p.run();
        expect(report.outcome === "halted" && report.plan).toBe(plan);
        expectRefusedAt(report, 0, variant === "unreadable" ? "marker_unreadable" : "marker_present");
        expect(since(d, mark)).not.toContain("begin");
        expect(d.state.rows).toEqual(rows);
        expect(markerReads).toBe(2);
        d.storage.faults.beforeGetItem = undefined;
        expect(await p.run()).toMatchObject({ outcome: "blocked", rule: nextRule[variant] });
      });
    }
  }
});

/* ======================================================================== D */

describe.each(PLATFORMS)("%s — D: every halt is followed by close → release → fresh open before any read", (platform) => {
  it("the reported reproduction: a failed AP-D3 marker write, then an explicit run, reopens first", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d);
    d.storage.faults.setItem = () => "apply_then_reject";
    expect((await p.run()).outcome).toBe("halted");
    expect([d.state.openCount, d.state.closeCount]).toEqual([1, 0]);
    d.storage.faults.setItem = undefined;
    const mark = d.state.trace.length;
    const next = await p.run();
    expect(next.outcome).toBe("access");
    expect([d.state.openCount, d.state.closeCount]).toEqual([2, 1]);
    expectReopenedFirst(d, mark);
  });

  const categories: [string, () => Promise<{ d: Device; p: Process; clear: () => void }>][] = [
    ["a refused marker precondition", async () => {
      const d = device(platform, BASE_SOURCE);
      const p = await boot(d, { faults: { onCommit: (w) => { if (commitReaches("enumerating")(w) && !d.state.rows.has(RECORD_KEY)) d.storage.map.set(MARKER_KEY, STORE_FOREIGN); return "ok"; } } });
      return { d, p, clear: () => undefined };
    }],
    ["a failed read step", async () => {
      const d = device(platform, BASE_SOURCE);
      await reachEnumerating(d);
      const p = await boot(d, { faults: { onCommit: (w) => { if (commitReaches("enumerating")(w)) d.storage.faults.keyThrows = true; return "ok"; } } });
      return { d, p, clear: () => { d.storage.faults.keyThrows = false; p.faults.onCommit = undefined; } };
    }],
    ["a failed recheck", async () => {
      const d = device(platform, BASE_SOURCE);
      await reachCopying(d, 0);
      let reads = 0;
      d.storage.faults.beforeGetItem = (key, storage) => { if (key === FIRST_BATCH[0] && ++reads === 2) storage.map.set(key, "changed"); };
      const p = await boot(d);
      return { d, p, clear: () => { d.storage.faults.beforeGetItem = undefined; } };
    }],
    ["a preparation failure", async () => {
      const d = device(platform, BASE_SOURCE);
      let first = true;
      const p = await boot(d, {
        generateUuid: () => {
          if (first) {
            first = false;
            throw new Error("synthetic generator failure");
          }
          return syntheticUuid();
        },
      });
      return { d, p, clear: () => undefined };
    }],
    ["an AP-CC abort before writing", async () => {
      const d = device(platform, BASE_SOURCE);
      await reachCopying(d, 4);
      let fail = true;
      const ref: { p?: Process } = {};
      const p = (ref.p = await boot(d, { faults: { onQuery: (sql) => (fail && (sql === "SELECT key FROM records ORDER BY key") && ref.p?.plugin.transactionOpen ? { reject: true } : undefined) } }));
      return { d, p, clear: () => { fail = false; } };
    }],
    ["an unknown checkpoint outcome", async () => {
      const d = device(platform, BASE_SOURCE);
      const p = await boot(d, { faults: { onCommit: once(commitReaches("copying", (w) => (recordIn(w)?.copied?.length ?? 0) > 0), "reject_after_effect" as const, "ok" as const) } });
      return { d, p, clear: () => undefined };
    }],
  ];
  for (const [label, arrange] of categories) {
    it(`after ${label}, the next run reopens before reading and keeps the surviving plan evidence`, async () => {
      const { d, p, clear } = await arrange();
      const halted = await p.run();
      expect(halted.outcome, JSON.stringify(halted)).toBe("halted");
      clear();
      const mark = d.state.trace.length;
      const next = await p.run();
      expect(next.outcome).not.toBe("fault");
      expectReopenedFirst(d, mark);
    });
  }

  it("surviving unknown-outcome evidence crosses the reopen: a matching-neither state found after it is still a fault", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d, { faults: { onCommit: once(commitReaches("copying", (w) => (recordIn(w)?.copied?.length ?? 0) > 0), "reject_after_effect" as const, "ok" as const) } });
    expect((await p.run()).outcome).toBe("halted");
    rewriteNeither(d);
    const mark = d.state.trace.length;
    expect((await p.run()).outcome).toBe("fault");
    expectReopenedFirst(d, mark);
  });

  it("a failed close, release or open blocks evidence collection and continuation; each boundary is established separately", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d);
    d.storage.faults.setItem = () => "apply_then_reject";
    await p.run();
    d.storage.faults.setItem = undefined;
    const attempt = async (boundary: string) => {
      const mark = d.state.trace.length;
      expect(await p.run()).toMatchObject({ outcome: "reopen_failed", boundary });
      expect(since(d, mark).some((entry) => entry.startsWith("query:"))).toBe(false);
      expect(writesIn(since(d, mark))).toEqual([]);
      return since(d, mark);
    };
    p.faults.onClose = () => "reject_before_effect";
    expect(await attempt("close")).toEqual([]);
    p.faults.onClose = undefined;
    p.faults.onCloseConnection = () => "reject_before_effect";
    expect(await attempt("release")).toEqual(["close"]);
    p.faults.onCloseConnection = undefined;
    p.faults.openRejects = true;
    // The release succeeds; the open fails, and the adapter's own cleanup of the
    // half-opened connection closes and releases it again. No open is established.
    expect(await attempt("open")).toEqual(["release", "create", "close", "release"]);
    p.faults.openRejects = false;
    const mark = d.state.trace.length;
    expect((await p.run()).outcome).toBe("access");
    // The handle was already closed and released; only the fresh open remained.
    expect(since(d, mark).slice(0, 2)).toEqual(["create", "open"]);
  });

  it("a normal, uninterrupted migration never reopens mid-run", async () => {
    const d = device(platform, BASE_SOURCE);
    expect((await (await boot(d)).run()).outcome).toBe("access");
    expect(d.state.trace.filter((entry) => entry === "open" || entry === "create")).toEqual(["create", "open"]);
    expect(d.state.trace).not.toContain("close");
  });
});
