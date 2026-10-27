// Runner lifecycle and boundaries (Stage M3b4b), class M over the real
// bindings: construction without I/O, single ownership under concurrency,
// disposal and unanswered calls, explicit bounds, preparation failures that
// issue nothing, the injected fingerprint's failure modes, and diagnostics that
// never carry application values, credentials or thrown text. Synthetic data only.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeMigrationRunner } from "../nativeMigrationRunner";
import { createNativeMigrationSource, platformTimestamp, platformUuid } from "../nativeMigrationBindings";
import { BASE_SOURCE, KEY_CREDENTIAL, KEY_SESSION } from "./nativeMigrationTestKit";
import {
  LATCH_KEY,
  LIMITS,
  PLATFORMS,
  RECORD_KEY,
  boot,
  commitReaches,
  committedRecord,
  once,
  device,
  phaseOf,
  recordIn,
  runToRest,
} from "./nativeMigrationMTestKit";
import { isSyntheticFingerprint } from "./nativeMigrationTestKit";
import { serializeActivationRecord } from "../nativeMigrationRecord";

const SENTINEL = "SYNTHETIC_PRIVATE_VALUE";

afterEach(() => vi.unstubAllGlobals());

const tick = async (count = 30) => {
  for (let index = 0; index < count; index += 1) await new Promise((resolve) => setTimeout(resolve, 0));
};
const begins = (d: ReturnType<typeof device>) => d.state.executed.filter((entry) => entry.requested === "BEGIN TRANSACTION;").length;

describe("construction", () => {
  it("constructing the runner and its bindings performs no storage I/O", async () => {
    const d = device("ios", BASE_SOURCE);
    const p = await boot(d);
    expect(d.state.openCount).toBe(0);
    expect(d.storage.lengthReads).toBe(0);
    expect(d.storage.valueReads).toEqual([]);
    expect(p.target.leaseState()).toBe("unowned");
  });

  it("refuses to construct without an injected fingerprint or with invalid bounds — there is no default", async () => {
    const d = device("ios");
    const p = await boot(d);
    const base = {
      source: createNativeMigrationSource(),
      target: p.target,
      fingerprint: (value: string) => value,
      isWellFormedFingerprint: isSyntheticFingerprint,
      generateUuid: platformUuid,
      now: platformTimestamp,
      limits: LIMITS,
    };
    expect(() => createNativeMigrationRunner({ ...base, fingerprint: undefined as never })).toThrow(TypeError);
    for (const limits of [{ ...LIMITS, maxPlansPerRun: 0 }, { ...LIMITS, latchWriteAttemptLimit: 1.5 }, { ...LIMITS, checkpointBatchKeyLimit: -1 }]) {
      expect(() => createNativeMigrationRunner({ ...base, limits })).toThrow(TypeError);
    }
  });

  it("the platform UUID and clock bindings answer valid values or throw — never a fabricated fallback", () => {
    expect(platformUuid()).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    expect(platformTimestamp()).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
    vi.stubGlobal("crypto", { randomUUID: () => "not-a-uuid" });
    expect(() => platformUuid()).toThrow();
    vi.stubGlobal("crypto", {});
    expect(() => platformUuid()).toThrow();
    vi.stubGlobal("crypto", { randomUUID: () => { throw new Error(SENTINEL); } });
    expect(() => platformUuid()).toThrow(/failed/);
  });
});

describe.each(PLATFORMS)("%s — ownership and lifecycle", (platform) => {
  it("concurrent run() calls join ONE execution: no duplicate plans or transactions", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d);
    const [first, second] = await Promise.all([p.run(), p.run()]);
    expect(first).toBe(second);
    expect(first.outcome).toBe("access");
    // AP-D3 (2 tx), two checkpoints, AP-CC and AP-ACT: six transactions, once each.
    expect(begins(d)).toBe(6);
  });

  it("a second runner on the same target is refused while the first holds the lease", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d);
    await p.run();
    const intruder = createNativeMigrationRunner({
      source: createNativeMigrationSource(),
      target: p.target,
      fingerprint: (value) => value,
      isWellFormedFingerprint: isSyntheticFingerprint,
      generateUuid: platformUuid,
      now: platformTimestamp,
      limits: LIMITS,
    });
    expect(await intruder.run()).toMatchObject({ outcome: "target_refused", reason: "lease_held" });
    expect((await p.runner.dispose()).ok).toBe(true);
    expect((await intruder.run()).outcome).toBe("access");
  });

  it("dispose before or during a run issues nothing further, then frees ownership", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d);
    const running = p.run();
    const disposing = p.runner.dispose();
    expect((await running).outcome).toBe("disposed");
    expect(await disposing).toEqual({ ok: true });
    expect(begins(d)).toBe(0);
    expect(p.target.leaseState()).toBe("unowned");
    expect((await p.run()).outcome).toBe("disposed");
    // The ordinary store works again once ownership is free.
    expect((await p.store.adapter.get("anything")).status).toBe("value");
  });

  it("an unanswered bridge call never releases ownership; a late answer issues no further step", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d, { faults: { onCommit: (w) => (commitReaches("enumerating")(w) ? "hang" : "ok") } });
    void p.run();
    await tick();
    const disposing = p.runner.dispose();
    let settled = false;
    void disposing.then(() => { settled = true; });
    await tick();
    expect(settled).toBe(false);
    expect(p.target.leaseState()).not.toBe("unowned");
    // Nothing else can reach the connection either: an ordinary read queued behind
    // the unanswered call does not run underneath it.
    let ordinaryAnswered = false;
    void p.store.adapter.get(RECORD_KEY).then(() => { ordinaryAnswered = true; });
    await tick();
    expect(ordinaryAnswered).toBe(false);
    expect(d.state.rows.has(RECORD_KEY)).toBe(false);
  });

  it("dispose with unevaluated plan evidence keeps the lease; after an explicit run evaluates it, dispose reopens and releases", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d, { faults: { onCommit: once(commitReaches("enumerating"), "reject_after_effect" as const, "ok" as const) } });
    await p.run();
    expect(await p.runner.dispose()).toEqual({ ok: false, reason: "plan_evidence_held" });
    expect(p.target.leaseState()).not.toBe("unowned");
  });

  it("dispose after a halt with no plan evidence releases by close and explicit release only; a failed close KEEPS the lease", async () => {
    const d = device(platform, BASE_SOURCE);
    let first = true;
    const p = await boot(d, { generateUuid: () => { if (first) { first = false; throw new Error("x"); } return platformUuid(); } });
    expect((await p.run()).outcome).toBe("halted");
    p.faults.onClose = () => "reject_before_effect";
    expect(await p.runner.dispose()).toEqual({ ok: false, boundary: "close" });
    expect(p.target.leaseState()).not.toBe("unowned");
    p.faults.onClose = undefined;
    const mark = d.state.trace.length;
    expect(await p.runner.dispose()).toEqual({ ok: true });
    // Disposal issued no fresh open and no statement.
    expect(d.state.trace.slice(mark)).toEqual(["close", "release"]);
    expect(p.target.leaseState()).toBe("unowned");
  });

  it("a failed reopen before evaluation reads no evidence and reports its boundary", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d, { faults: { onCommit: once(commitReaches("enumerating"), "reject_after_effect" as const, "ok" as const) } });
    await p.run();
    for (const [boundary, set, clear] of [
      ["release", () => { p.faults.onCloseConnection = () => "reject_before_effect"; }, () => { p.faults.onCloseConnection = undefined; }],
      ["open", () => { p.faults.openRejects = true; }, () => { p.faults.openRejects = false; }],
    ] as const) {
      set();
      const reads = d.storage.lengthReads;
      expect(await p.run()).toMatchObject({ outcome: "reopen_failed", boundary });
      expect(d.storage.lengthReads).toBe(reads);
      clear();
    }
    expect((await runToRest(p)).outcome).toBe("access");
  });
});

describe.each(PLATFORMS)("%s — the in-process fault stop outlives disposal (I-13)", (platform) => {
  it("after a detected fault the runner keeps its lease: dispose refuses, and no second runner can resume", async () => {
    const d = device(platform, BASE_SOURCE);
    // The latch write never lands, so only the in-process stop holds.
    const p = await boot(d, {
      faults: {
        onCommit: (w) => {
          if (w.has(LATCH_KEY)) return "reject_before_effect";
          return (recordIn(w)?.copied?.length ?? 0) > 0 && commitReaches("copying")(w) ? "reject_after_effect" : "ok";
        },
      },
    });
    await p.run();
    const record = committedRecord(d);
    if (!record) throw new Error("no record");
    d.state.rows.set(RECORD_KEY, serializeActivationRecord({ ...record, migrationId: "99999999-9999-4999-8999-999999999999" }));
    const fault = await p.run();
    expect(fault.outcome).toBe("fault");
    expect(d.state.rows.has(LATCH_KEY)).toBe(false);
    expect(await p.runner.dispose()).toEqual({ ok: false, reason: "fault_stop_held" });
    expect(p.target.leaseState()).not.toBe("unowned");
    const second = createNativeMigrationRunner({
      source: createNativeMigrationSource(),
      target: p.target,
      fingerprint: (value) => value,
      isWellFormedFingerprint: isSyntheticFingerprint,
      generateUuid: platformUuid,
      now: platformTimestamp,
      limits: LIMITS,
    });
    const beginsBefore = begins(d);
    expect(await second.run()).toMatchObject({ outcome: "target_refused", reason: "lease_held" });
    expect(begins(d)).toBe(beginsBefore);
  });
});

describe.each(PLATFORMS)("%s — bounds and preparation", (platform) => {
  it("reaching maxPlansPerRun while migration is incomplete is bound_reached, never success; later runs continue", async () => {
    const d = device(platform, BASE_SOURCE);
    const p = await boot(d, { limits: { maxPlansPerRun: 2 } });
    const first = await p.run();
    expect(first.outcome).toBe("bound_reached");
    expect(first.completedPlans).toHaveLength(2);
    expect(phaseOf(d)).not.toBe("active");
    let next = await p.run();
    for (let run = 0; run < 5 && next.outcome === "bound_reached"; run += 1) {
      expect(next.completedPlans.length).toBeLessThanOrEqual(2);
      next = await p.run();
    }
    expect(next.outcome).toBe("access");
  });

  it("a UUID generator that throws or answers garbage halts BEFORE issuing the transaction", async () => {
    for (const generateUuid of [() => { throw new Error(SENTINEL); }, () => "not-a-uuid", () => 42 as unknown as string]) {
      const d = device(platform, BASE_SOURCE);
      const p = await boot(d, { generateUuid });
      const report = await p.run();
      expect(report).toMatchObject({ outcome: "halted", plan: "AP-D3", halt: { kind: "not_issued", step: 0, cause: "preparation_failed" } });
      expect(begins(d)).toBe(0);
      expect(d.state.rows.size).toBe(0);
      expect(JSON.stringify(report)).not.toContain(SENTINEL);
    }
  });

  it("an invalid timestamp is refused before D1 or activation is issued", async () => {
    const empty = device(platform, {});
    const d1 = await boot(empty, { now: () => "yesterday" });
    expect(await d1.run()).toMatchObject({ outcome: "halted", plan: "D1", halt: { kind: "not_issued", cause: "preparation_failed" } });
    expect(empty.state.rows.size).toBe(0);
    const d = device(platform, BASE_SOURCE);
    let clock = "2026-10-20T12:00:00.000Z";
    const p = await boot(d, { now: () => clock });
    const reached = await boot(d, { faults: { onCommit: (w) => (commitReaches("active")(w) ? "hang" : "ok") } });
    void reached.run();
    await tick(60);
    expect(phaseOf(d)).toBe("verified");
    clock = "not a time";
    expect(await p.run()).toMatchObject({ outcome: "halted", plan: "AP-ACT", halt: { kind: "not_issued", cause: "preparation_failed" } });
    expect(phaseOf(d)).toBe("verified");
  });

  it("a fingerprint that throws, rejects or answers a non-string is never a match: the plan's read halts and nothing is staged", async () => {
    for (const fingerprint of [
      () => { throw new Error(SENTINEL); },
      () => Promise.reject(new Error(SENTINEL)),
      () => 7 as unknown as string,
    ]) {
      const d = device(platform, BASE_SOURCE);
      const report = await (await boot(d, { fingerprint })).run();
      expect(report).toMatchObject({ outcome: "halted", plan: "AP-D3" });
      expect(phaseOf(d)).toBe("enumerating");
      expect(JSON.stringify(report)).not.toContain(SENTINEL);
    }
  });
});

describe.each(PLATFORMS)("%s — diagnostics carry no values, credentials or thrown text", (platform) => {
  it("sentinel application values, credentials and hostile thrown objects never reach a report or the latch", async () => {
    const source = { ...BASE_SOURCE, [KEY_SESSION]: SENTINEL, [KEY_CREDENTIAL]: SENTINEL };
    const d = device(platform, source);
    const hostile = () => new Proxy({}, { get() { throw new Error(SENTINEL); } });
    const p = await boot(d, { faults: { onCommit: (w) => ((recordIn(w)?.copied?.length ?? 0) > 0 && commitReaches("copying")(w) ? "reject_after_effect" : "ok") } });
    const reports = [await p.run()];
    // A hostile source failure, then a fault with its latch.
    d.storage.faults = { keyThrows: true, thrownValue: hostile };
    reports.push(await p.run());
    d.storage.faults = {};
    const record = committedRecord(d);
    if (record) d.state.rows.set(RECORD_KEY, serializeActivationRecord({ ...record, migrationId: "99999999-9999-4999-8999-999999999999" }));
    reports.push(await p.run());
    expect(reports.map((report) => report.outcome)).toContain("fault");
    for (const report of reports) expect(JSON.stringify(report)).not.toContain(SENTINEL);
    expect(d.state.rows.get(LATCH_KEY)).toBeDefined();
    expect(d.state.rows.get(LATCH_KEY)).not.toContain(SENTINEL);
    expect(d.storage.valueReads).not.toContain(KEY_CREDENTIAL);
  });
});
