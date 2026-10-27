// Regressions for the second M3b4b review (Codex), class M, on both platforms,
// through the REAL bindings, target capability, collector and runner over the
// plugin-faithful engine. Synthetic data only.
//
//   A. Ownership is reserved in the same synchronous turn as its check, BEFORE
//      the first asynchronous boundary of opening (engine resolution included):
//      an ordinary operation already opening the database and a concurrent
//      migration acquisition can never both proceed — in either order.
//   B. Disposal is honoured INSIDE composite operations: a disposed caller's
//      reserved read issues no second query, its verifier invokes no further
//      fingerprint, its transaction issues no BEGIN after a cancelled opening,
//      and its reads, digests and reopen stop there. Already-issued work and its
//      cleanup are awaited; nothing new is issued.
//
// Every bridge call is recorded through the engine's gate with the moment it was
// issued, and asserted afterwards — never only inside a callback the production
// layer would catch.
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeSqliteMigrationTarget, NativeSqliteStore } from "../nativeSqliteAdapter";
import { BASE_SOURCE, fp } from "./nativeMigrationTestKit";
import {
  LATCH_KEY,
  PLATFORMS,
  RECORD_KEY,
  TARGET_DATABASE,
  boot,
  commitReaches,
  deferred,
  device,
  newContext,
  once,
  phaseOf,
  reachCopying,
  reachVerified,
  recordIn,
  syntheticUuid,
  until,
  type Deferred,
  type ExecutionContext,
  type Process,
} from "./nativeMigrationMTestKit";
import {
  createPluginFaithfulEngine,
  createPluginFaithfulEngineState,
  type BridgeCall,
  type PluginFaithfulEngineState,
  type PluginPlatform,
} from "./pluginFaithfulSqliteEngine";

afterEach(() => vi.unstubAllGlobals());

const KEY = "synthetic-key";
const VALUE = "synthetic-value";
let databases = 0;
const nextDatabase = () => `${TARGET_DATABASE}-ownership-${(databases += 1)}`;

/** An ordinary store and a migration target for the SAME database in ONE context, over separate engine wrappers. */
async function competitors(platform: PluginPlatform, databaseName = nextDatabase(), state = createPluginFaithfulEngineState()) {
  const context: ExecutionContext = await newContext();
  const ordinaryWrapper = createPluginFaithfulEngine({ platform, state });
  const targetWrapper = createPluginFaithfulEngine({ platform, state });
  const ordinary: NativeSqliteStore = context.adapter.createNativeSqliteStore({
    databaseName,
    engine: ordinaryWrapper.engine,
    detectPlatform: () => platform,
  });
  const { target } = await context.bindings.createNativeMigrationTarget({
    databaseName,
    engine: targetWrapper.engine,
    detectPlatform: () => platform,
  });
  return { context, state, ordinary, ordinaryWrapper, target, targetWrapper };
}

/** Records the lease state observed AT the ordinary write's statement — the write boundary. */
function observeWriteBoundary(wrapper: ReturnType<typeof createPluginFaithfulEngine>, target: NativeSqliteMigrationTarget) {
  const observed: string[] = [];
  wrapper.faults.onRun = (sql) => {
    if (sql.startsWith("INSERT")) observed.push(target.leaseState());
    return "ok";
  };
  return observed;
}

const upserts = (state: PluginFaithfulEngineState) => state.trace.filter((entry) => entry.startsWith("run:INSERT"));

/* ======================================================================== A */

describe.each(PLATFORMS)("%s — A: an opening ordinary operation and a migration acquisition never both proceed", (platform) => {
  it("the reported reproduction, write first: the write proceeds and the concurrent acquisition is refused", async () => {
    const { state, ordinary, ordinaryWrapper, target } = await competitors(platform);
    const atWrite = observeWriteBoundary(ordinaryWrapper, target);
    const [written, acquired] = await Promise.all([ordinary.adapter.set(KEY, VALUE), target.acquire()]);
    expect(written.ok).toBe(true);
    expect(acquired).toEqual({ ok: false, reason: "connection_held_elsewhere" });
    expect(atWrite).toEqual(["unowned"]);
    expect(upserts(state)).toHaveLength(1);
    expect(target.leaseState()).toBe("unowned");
  });

  it("acquisition first: the lease is granted and the concurrent write is refused before it opens anything", async () => {
    const { state, ordinary, ordinaryWrapper, target } = await competitors(platform);
    const atWrite = observeWriteBoundary(ordinaryWrapper, target);
    const [acquired, written] = await Promise.all([target.acquire(), ordinary.adapter.set(KEY, VALUE)]);
    expect(acquired.ok).toBe(true);
    expect(written.ok).toBe(false);
    expect(atWrite).toEqual([]);
    expect(upserts(state)).toEqual([]);
    expect(state.rows.has(KEY)).toBe(false);
    expect(ordinaryWrapper.connectionOpen).toBe(false);
  });

  it("concurrent ordinary reads behave the same in both orders", async () => {
    for (const order of ["read_first", "acquire_first"] as const) {
      const { ordinary, ordinaryWrapper, target } = await competitors(platform);
      const read = () => ordinary.adapter.get(KEY);
      const [first, second] = order === "read_first"
        ? await Promise.all([read(), target.acquire()])
        : await Promise.all([target.acquire(), read()]);
      const readResult = order === "read_first" ? first : second;
      const acquireResult = order === "read_first" ? second : first;
      if (order === "read_first") {
        expect(readResult).toEqual({ status: "value", value: null });
        expect(acquireResult).toEqual({ ok: false, reason: "connection_held_elsewhere" });
      } else {
        expect(acquireResult).toMatchObject({ ok: true });
        expect((readResult as { status: string }).status).toBe("read_failed");
        expect(ordinaryWrapper.connectionOpen).toBe(false);
      }
    }
  });

  it("a delayed connection establishment holds its reservation throughout: acquisition is refused while it is pending", async () => {
    const { state, ordinary, ordinaryWrapper, target } = await competitors(platform);
    const gate = deferred();
    let reached = false;
    ordinaryWrapper.faults.gate = (call) => {
      if (call.kind !== "create" || reached) return;
      reached = true;
      return gate.promise;
    };
    const writing = ordinary.adapter.set(KEY, VALUE);
    await until(() => reached, "the pending connection creation");
    expect(await target.acquire()).toEqual({ ok: false, reason: "connection_held_elsewhere" });
    gate.resolve();
    expect((await writing).ok).toBe(true);
    expect(state.rows.get(KEY)).toBe(VALUE);
  });

  it("a failed open whose cleanup succeeded releases its reservation; one whose release failed keeps it until a confirmed release", async () => {
    const clean = await competitors(platform);
    clean.ordinaryWrapper.faults.openRejects = true;
    expect((await clean.ordinary.adapter.set(KEY, VALUE)).ok).toBe(false);
    expect((await clean.target.acquire()).ok).toBe(true);

    const leaky = await competitors(platform);
    leaky.ordinaryWrapper.faults.openRejects = true;
    leaky.ordinaryWrapper.faults.onCloseConnection = () => "reject_before_effect";
    expect((await leaky.ordinary.adapter.set(KEY, VALUE)).ok).toBe(false);
    expect(await leaky.target.acquire()).toEqual({ ok: false, reason: "connection_held_elsewhere" });
    leaky.ordinaryWrapper.faults.openRejects = false;
    leaky.ordinaryWrapper.faults.onCloseConnection = undefined;
    // An explicit, positively established release frees the database.
    expect((await leaky.ordinary.close()).ok).toBe(true);
    expect(leaky.state.trace.at(-1)).toBe("release");
    expect((await leaky.target.acquire()).ok).toBe(true);
  });

  it("a fault-stopped owner stays protected from a competitor's opening", async () => {
    const d = device(platform, {});
    const p = await boot(d, { faults: { onCommit: once(commitReaches("active"), "reject_after_effect" as const, "ok" as const) } });
    await p.run();
    const record = recordIn(d.state.rows);
    if (!record) throw new Error("no record");
    const { serializeActivationRecord } = await import("../nativeMigrationRecord");
    d.state.rows.set(RECORD_KEY, serializeActivationRecord({ ...record, migrationId: "99999999-9999-4999-8999-999999999999" }));
    p.faults.onCommit = (w) => (w.has(LATCH_KEY) ? "reject_before_effect" : "ok");
    expect((await p.run()).outcome).toBe("fault");
    const wrapper = createPluginFaithfulEngine({ platform, state: d.state });
    const ordinary = p.context.adapter.createNativeSqliteStore({ databaseName: TARGET_DATABASE, engine: wrapper.engine, detectPlatform: () => platform });
    const mark = d.state.trace.length;
    expect((await ordinary.adapter.set(KEY, VALUE)).ok).toBe(false);
    expect(d.state.trace.slice(mark)).toEqual([]);
  });

  it("different databases: an opening ordinary operation does not block another database's acquisition", async () => {
    const one = await competitors(platform);
    const other = await competitors(platform);
    const gate = deferred();
    let reached = false;
    one.ordinaryWrapper.faults.gate = (call) => {
      if (call.kind !== "create" || reached) return;
      reached = true;
      return gate.promise;
    };
    const writing = one.ordinary.adapter.set(KEY, VALUE);
    await until(() => reached, "the pending creation");
    expect((await other.target.acquire()).ok).toBe(true);
    gate.resolve();
    expect((await writing).ok).toBe(true);
  });
});

/* ======================================================================== B */

/** Records every bridge call, marking those issued after `disposedAt` was set. */
function callLog() {
  const calls: { call: BridgeCall; afterDisposal: boolean }[] = [];
  const state = { disposed: false };
  return {
    calls,
    state,
    after: () => calls.filter((entry) => entry.afterDisposal).map((entry) => entry.call.kind + (entry.call.values?.[0] ? `:${String(entry.call.values[0])}` : "")),
    record: (call: BridgeCall) => { calls.push({ call, afterDisposal: state.disposed }); },
  };
}

describe.each(PLATFORMS)("%s — B: disposal is honoured inside composite operations", (platform) => {
  it("counterexample 1: the latch query is pending at disposal → no activation-record query is issued afterwards", async () => {
    const d = device(platform, BASE_SOURCE);
    const log = callLog();
    const gate = deferred();
    let reached = false;
    const p = await boot(d, {
      faults: {
        gate: (call) => {
          log.record(call);
          if (reached || call.kind !== "query" || call.values?.[0] !== LATCH_KEY) return;
          reached = true;
          return gate.promise;
        },
      },
    });
    const running = p.run();
    await until(() => reached, "the latch query");
    log.state.disposed = true;
    const disposing = p.runner.dispose();
    gate.resolve();
    expect((await running).outcome).toBe("disposed");
    expect(await disposing).toEqual({ ok: true });
    expect(log.after()).toEqual([]);
    expect(log.calls.some((entry) => entry.call.values?.[0] === RECORD_KEY)).toBe(false);
  });

  it("counterexample 2: a four-row AP-ACT verifier paused at its first fingerprint invokes NO further fingerprint after disposal", async () => {
    const d = device(platform, BASE_SOURCE);
    await reachVerified(d);
    const ref: { p?: Process } = {};
    const first = deferred();
    const invokedAfterDisposal: string[] = [];
    let paused = false;
    let disposed = false;
    const fingerprint = (value: string): Promise<string> | string => {
      if (ref.p?.plugin.transactionOpen !== true) return fp(value);
      if (!paused) {
        paused = true;
        return first.promise.then(() => fp(value));
      }
      // A second in-transaction fingerprint would never answer.
      if (disposed) invokedAfterDisposal.push("fingerprint");
      return new Promise<string>(() => undefined);
    };
    const p = (ref.p = await boot(d, { fingerprint }));
    const mark = d.state.trace.length;
    const running = p.run();
    await until(() => paused, "the first verifier fingerprint");
    disposed = true;
    const disposing = p.runner.dispose();
    first.resolve();
    const report = await running;
    expect(report).toMatchObject({ outcome: "disposed", plan: "AP-ACT", transaction: { status: "not_committed", reason: "cancelled", writeIssued: false } });
    expect(invokedAfterDisposal).toEqual([]);
    expect(await disposing).toEqual({ ok: true });
    expect(phaseOf(d)).toBe("verified");
    const trace = d.state.trace.slice(mark);
    expect(trace.some((entry) => entry.startsWith("run:"))).toBe(false);
    expect(trace).not.toContain("commit");
  });

  for (const stage of ["create", "open"] as const) {
    it(`counterexample 3: transact() whose ${stage === "create" ? "connection creation" : "connection open"} is pending when the caller stops issues NO BEGIN`, async () => {
      const { targetWrapper, target, state } = await competitors(platform);
      const acquired = await target.acquire();
      if (!acquired.ok) throw new Error("acquire");
      const gate: Deferred = deferred();
      let reached = false;
      targetWrapper.faults.gate = (call) => {
        if (call.kind !== stage || reached) return;
        reached = true;
        return gate.promise;
      };
      let proceed = true;
      const transacting = target.transact(acquired.lease, { kind: "create_record", recordAfter: "synthetic-record" }, { proceed: () => proceed });
      await until(() => reached, `the pending ${stage}`);
      proceed = false;
      gate.resolve();
      expect(await transacting).toEqual({ status: "refused", reason: "cancelled" });
      expect(state.trace).not.toContain("begin");
      expect(state.trace.some((entry) => entry.startsWith("query:") || entry.startsWith("run:"))).toBe(false);
      if (stage === "create") expect(state.trace).not.toContain("open");
      // The half-opened connection was cleaned up; the lease is untouched.
      expect(state.trace.slice(-1)).toEqual(["release"]);
      expect(target.leaseState()).toBe("owned");
      expect(state.rows.has(RECORD_KEY)).toBe(false);
    });
  }

  it("the evidence collector invokes no further digest after disposal: a second digest that would hang is never called", async () => {
    const d = device(platform, BASE_SOURCE);
    await reachCopying(d, 2);
    const first = deferred();
    let calls = 0;
    let disposed = false;
    const invokedAfterDisposal: number[] = [];
    const fingerprint = (value: string): Promise<string> | string => {
      calls += 1;
      if (calls === 1) return first.promise.then(() => fp(value));
      if (disposed) invokedAfterDisposal.push(calls);
      return new Promise<string>(() => undefined);
    };
    const p = await boot(d, { fingerprint });
    const mark = d.state.trace.length;
    const running = p.run();
    await until(() => calls === 1, "the first digest");
    disposed = true;
    const disposing = p.runner.dispose();
    first.resolve();
    expect((await running).outcome).toBe("disposed");
    expect(invokedAfterDisposal).toEqual([]);
    expect(await disposing).toEqual({ ok: true });
    expect(d.state.trace.slice(mark).some((entry) => /^(run:|begin|commit)/.test(entry))).toBe(false);
  });

  it("readValues stops between keys: a value query pending at disposal is followed by no other", async () => {
    const d = device(platform, BASE_SOURCE);
    // A halted runner with plan evidence: the next run reads several row values.
    const p = await boot(d, { faults: { onCommit: once(commitReaches("copying", (w) => (recordIn(w)?.copied?.length ?? 0) > 2), "reject_before_effect" as const, "ok" as const) } });
    expect((await p.run()).outcome).toBe("halted");
    const log = callLog();
    const gate = deferred();
    let reached = false;
    p.faults.gate = (call) => {
      log.record(call);
      const key = call.values?.[0];
      if (reached || call.kind !== "query" || key === undefined || key === RECORD_KEY || key === LATCH_KEY) return;
      reached = true;
      return gate.promise;
    };
    const running = p.run();
    await until(() => reached, "the first row-value query");
    log.state.disposed = true;
    const disposing = p.runner.dispose();
    gate.resolve();
    expect((await running).outcome).toBe("disposed");
    expect(log.after()).toEqual([]);
    // It holds an unresolved unknown outcome: the lease is kept, as before.
    expect(await disposing).toEqual({ ok: false, reason: "plan_evidence_held" });
  });

  it("a reopen pending at disposal issues no fresh open afterwards; disposal then releases by close and explicit release only", async () => {
    const d = device(platform, BASE_SOURCE);
    let firstUuid = true;
    const p = await boot(d, {
      generateUuid: () => {
        if (firstUuid) {
          firstUuid = false;
          throw new Error("synthetic generator failure");
        }
        return syntheticUuid();
      },
    });
    expect((await p.run()).outcome).toBe("halted"); // a halt with no plan evidence
    const log = callLog();
    const gate = deferred();
    let reached = false;
    p.faults.gate = (call) => {
      log.record(call);
      if (reached || call.kind !== "create") return;
      reached = true;
      return gate.promise;
    };
    const mark = d.state.trace.length;
    const running = p.run();
    await until(() => reached, "the reopen's connection creation");
    log.state.disposed = true;
    const disposing = p.runner.dispose();
    gate.resolve();
    expect((await running).outcome).toBe("disposed");
    expect(await disposing).toEqual({ ok: true });
    expect(log.after()).toEqual([]);
    const trace = d.state.trace.slice(mark);
    expect(trace).not.toContain("open");
    expect(trace.some((entry) => entry.startsWith("query:"))).toBe(false);
    expect(trace.at(-1)).toBe("release");
    expect(p.target.leaseState()).toBe("unowned");
  });

  it("controls: completion before disposal, and an uninterrupted migration, are unaffected", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d);
    expect((await p.run()).outcome).toBe("access");
    expect(await p.runner.dispose()).toEqual({ ok: true });
  });
});

/* ======================================================= between continuations */

/**
 * Disposal that lands BETWEEN a helper's completion and its caller's
 * continuation — after the helper's own post-call check, before the caller
 * issues its next dependency call. Each case observes a bridge call's (or a
 * fingerprint's) own promise and schedules disposal `hops` microtasks after it
 * settles, sweeping several hop counts so the boundary is hit whatever the
 * exact continuation depth. Every call is recorded AT ISSUANCE and asserted
 * afterwards; no assertion runs inside a callback production catches.
 */
const HOPS = [-1, 0, 1, 2, 3, 4, 5, 6, 7, 8];

/**
 * `-1`: synchronously, in the observer's own callback. `0`: one queued
 * microtask — exactly the reported `pending.then(() => queueMicrotask(dispose))`.
 * `n`: `n` further promise hops before that microtask.
 */
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

/** Wraps an engine: records every bridge call at issuance and lets a test observe one call's promise. */
function observingEngine(
  engine: import("../nativeSqliteAdapter").NativeSqliteEngine,
  issued: IssuedCall[],
  disposal: { done: boolean },
  observe: (name: string, pending: Promise<unknown>) => void
): import("../nativeSqliteAdapter").NativeSqliteEngine {
  const record = (name: string) => issued.push({ name, afterDisposal: disposal.done });
  return {
    async createConnection(databaseName) {
      record("create");
      const connection = await engine.createConnection(databaseName);
      /** Records a call at issuance — labelled `kind` or `kind:<statement>` — and exposes its promise. */
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

/** Calls a stopped caller may still issue: cleanup only. */
const CLEANUP = new Set(["close", "release", "rollback"]);

describe.each(PLATFORMS)("%s — disposal between a helper's completion and its caller's continuation", (platform) => {
  const boundaries: [string, (name: string) => boolean, string][] = [
    ["open completes before the next PRAGMA", (name) => name === "open", "query:PRAGMA journal_mode = WAL;"],
    ["the journal-mode PRAGMA completes before the next setup command", (name) => name.startsWith("query:PRAGMA journal_mode"), "execute:PRAGMA synchronous = FULL;"],
    ["the synchronous PRAGMA completes before the schema command", (name) => name.startsWith("execute:PRAGMA synchronous"), "execute:CREATE TABLE IF NOT EXISTS records (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);"],
  ];

  for (const [label, trigger, forbidden] of boundaries) {
    it(`opening: ${label} — no further opening command after disposal, at any hop`, async () => {
      for (const hops of HOPS) {
        const d = device(platform, BASE_SOURCE);
        const issued: IssuedCall[] = [];
        const disposal = { done: false };
        const ref: { p?: Process; disposing?: Promise<unknown> } = {};
        let armed = true;
        const p = (ref.p = await boot(d, {
          wrapEngine: (engine) => observingEngine(engine, issued, disposal, (name, pending) => {
            if (!armed || !trigger(name)) return;
            armed = false;
            void pending.then(() => afterHops(hops, () => {
              disposal.done = true;
              ref.disposing = ref.p?.runner.dispose();
            }));
          }),
        }));
        const report = await p.run();
        await ref.disposing;
        const afterDisposal = issued.filter((call) => call.afterDisposal).map((call) => call.name);
        expect(report.outcome, `hops ${hops}`).toBe("disposed");
        expect(afterDisposal.filter((name) => !CLEANUP.has(name)), `hops ${hops}: ${JSON.stringify(issued)}`).toEqual([]);
        expect(afterDisposal, `hops ${hops}`).not.toContain(forbidden);
        expect(issued.some((call) => /^(run:|begin|commit)/.test(call.name)), `hops ${hops}`).toBe(false);
        expect(d.state.rows.has(RECORD_KEY)).toBe(false);
      }
    });
  }

  it("opening, the reported trace: disposal right after open settles yields create, open, then only cleanup", async () => {
    const d = device(platform, BASE_SOURCE);
    const issued: IssuedCall[] = [];
    const disposal = { done: false };
    const ref: { p?: Process; disposing?: Promise<unknown> } = {};
    let armed = true;
    const p = (ref.p = await boot(d, {
      wrapEngine: (engine) => observingEngine(engine, issued, disposal, (name, pending) => {
        if (!armed || name !== "open") return;
        armed = false;
        void pending.then(() => queueMicrotask(() => {
          disposal.done = true;
          ref.disposing = ref.p?.runner.dispose();
        }));
      }),
    }));
    expect((await p.run()).outcome).toBe("disposed");
    expect(await ref.disposing).toEqual({ ok: true });
    // Before the correction: create, open, query:PRAGMA journal_mode = WAL;, close, release.
    expect(issued.map((call) => call.name)).toEqual(["create", "open", "close", "release"]);
    expect(p.target.leaseState()).toBe("unowned");
  });

  it("source read loop: an inner read completing before the outer loop resumes issues no further getItem after disposal, at any hop", async () => {
    for (const hops of HOPS) {
      const d = device(platform, BASE_SOURCE);
      const reads: { key: string; afterDisposal: boolean }[] = [];
      const disposal = { done: false };
      d.storage.faults.beforeGetItem = (key) => { reads.push({ key, afterDisposal: disposal.done }); };
      const ref: { p?: Process; disposing?: Promise<unknown> } = {};
      let first = true;
      const p = (ref.p = await boot(d, {
        // AP-D3's read step is the run's first digest: its evaluation of a target
        // without a record digests nothing.
        fingerprint: (value) => {
          if (first) {
            first = false;
            afterHops(hops, () => {
              disposal.done = true;
              ref.disposing = ref.p?.runner.dispose();
            });
          }
          return fp(value);
        },
      }));
      const report = await p.run();
      const disposed = await ref.disposing;
      expect(report.outcome, `hops ${hops}`).toBe("disposed");
      expect(reads.filter((read) => read.afterDisposal), `hops ${hops}`).toEqual([]);
      // The AP-D3 record committed before the read step: that confirmed write is
      // unevaluated plan evidence, so the lease is retained.
      expect(disposed, `hops ${hops}`).toEqual({ ok: false, reason: "plan_evidence_held" });
      expect(phaseOf(d)).toBe("enumerating");
    }
  });

  it("target transact(): the synchronous PRAGMA completing as the caller stops issues no CREATE TABLE, BEGIN or write afterwards, at any hop", async () => {
    for (const hops of HOPS) {
      const context = await newContext();
      const state = createPluginFaithfulEngineState();
      const issued: IssuedCall[] = [];
      const disposal = { done: false };
      let armed = true;
      const engine = observingEngine(createPluginFaithfulEngine({ platform, state }).engine, issued, disposal, (name, pending) => {
        if (!armed || !name.startsWith("execute:PRAGMA synchronous")) return;
        armed = false;
        void pending.then(() => afterHops(hops, () => { disposal.done = true; }));
      });
      const { target } = await context.bindings.createNativeMigrationTarget({
        databaseName: nextDatabase(),
        engine,
        detectPlatform: () => platform,
      });
      const acquired = await target.acquire();
      if (!acquired.ok) throw new Error("acquire");
      const result = await target.transact(
        acquired.lease,
        { kind: "create_record", recordAfter: "synthetic-record" },
        { proceed: () => !disposal.done }
      );
      // Wherever the stop lands, it is honoured from that point: before BEGIN the
      // transaction is refused; if BEGIN was already issued it is rolled back.
      const beganBeforeStop = issued.some((call) => call.name === "begin" && !call.afterDisposal);
      expect(result, `hops ${hops}`).toEqual(beganBeforeStop
        ? { status: "not_committed", reason: "cancelled", writeIssued: false, connection: "clean" }
        : { status: "refused", reason: "cancelled" });
      const afterDisposal = issued.filter((call) => call.afterDisposal).map((call) => call.name);
      expect(afterDisposal.filter((name) => !CLEANUP.has(name)), `hops ${hops}: ${JSON.stringify(issued)}`).toEqual([]);
      expect(issued.some((call) => /^(run:|commit)/.test(call.name)), `hops ${hops}`).toBe(false);
      expect(state.rows.has(RECORD_KEY)).toBe(false);
    }
  });

  it("controls: the same observing engine and fingerprint without disposal complete normally", async () => {
    const d = device(platform, BASE_SOURCE);
    const issued: IssuedCall[] = [];
    const p = await boot(d, { wrapEngine: (engine) => observingEngine(engine, issued, { done: false }, () => undefined) });
    expect((await p.run()).outcome).toBe("access");
    expect(issued.slice(0, 5).map((call) => call.name)).toEqual([
      "create",
      "open",
      "query:PRAGMA schema_version;",
      "query:SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name;",
      "query:PRAGMA schema_version;",
    ]);
  });
});
