// S3d: real dormant runner and adapter over the installed-plugin statement
// model. Synthetic stores/digests only; no device or Keychain evidence.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeHeldDomainMigrationRunner, type NativeMigrationRunnerDependencies, type NativeHeldDomainMigrationRunner } from "../nativeMigrationRunner";
import { createNativeMigrationSqliteStore, type NativeMigrationLease } from "../nativeSqliteAdapter";
import { createNativeMigrationSource } from "../nativeMigrationBindings";
import { createPluginFaithfulEngine, createPluginFaithfulEngineState, type PluginFaithfulFaults } from "./pluginFaithfulSqliteEngine";
import { SyntheticStorage, RECORD_KEY, LATCH_KEY, MARKER_KEY, LIMITS, syntheticUuid, SYNTHETIC_NOW } from "./nativeMigrationMTestKit";
import { BASE_SOURCE, KEY_SESSION, STORE_A, fp, isSyntheticFingerprint, verifiedBytes, activeBytes } from "./nativeMigrationTestKit";
import { evaluateActivationRecord } from "../nativeMigrationRecord";
import { DELETION_GUARD_PREFIX } from "../../identity/accountDeletionGuard";

let ordinal = 0;
afterEach(() => vi.unstubAllGlobals());
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function harness(platform: "ios" | "android", initial: Record<string, string> = {}, rows: Record<string, string> = {}, faults: PluginFaithfulFaults = {}) {
  const storage = new SyntheticStorage(initial); vi.stubGlobal("localStorage", storage);
  const state = createPluginFaithfulEngineState();
  for (const [key, value] of Object.entries(rows)) state.rows.set(key, value);
  if (state.rows.size) state.tables.add("records");
  const plugin = createPluginFaithfulEngine({ platform, state, faults });
  const binding = createNativeMigrationSqliteStore({ databaseName: `s3d-synthetic-${++ordinal}`, engine: plugin.engine, detectPlatform: () => platform, reservedKeys: { record: RECORD_KEY, latch: LATCH_KEY } });
  const acquired = await binding.target.acquire(); if (!acquired.ok) throw new Error("fixture acquire");
  const deps: NativeMigrationRunnerDependencies & { lease: NativeMigrationLease } = {
    source: createNativeMigrationSource(), target: binding.target, lease: acquired.lease,
    fingerprint: fp, isWellFormedFingerprint: isSyntheticFingerprint, generateUuid: syntheticUuid,
    now: () => SYNTHETIC_NOW, limits: LIMITS,
  };
  const make = (overrides: Partial<typeof deps> = {}) => createNativeHeldDomainMigrationRunner({ ...deps, ...overrides });
  const child = (overrides: Partial<typeof deps> = {}): NativeHeldDomainMigrationRunner => {
    const result = make(overrides); if (!result.ok) throw new Error(result.reason); return result.runner;
  };
  return { ...binding, storage, state, faults, deps, lease: acquired.lease, make, child };
}
function phase(rows: Map<string, string>) {
  const raw = rows.get(RECORD_KEY); if (!raw) return null;
  const record = evaluateActivationRecord(raw, isSyntheticFingerprint); return record.ok ? record.record.phase : "invalid";
}

for (const platform of ["ios", "android"] as const) describe(`${platform} borrowed domain preparation`, () => {
  it("D1 holds without active bytes, timestamps, marker writes or B4; clean disposal only unpins", async () => {
    const h = await harness(platform), uuid = vi.fn(syntheticUuid), now = vi.fn(() => SYNTHETIC_NOW);
    const child = h.child({ generateUuid: uuid, now });
    expect(h.state.trace).toEqual([]);
    const first = await child.run(); expect(first.outcome).toBe("held");
    if (first.outcome !== "held") throw new Error(JSON.stringify(first));
    expect(first.preparation).toBe("fresh"); expect(child.isCurrentHold(first.hold)).toBe(true);
    expect(child.isCurrentHold({ ...first.hold })).toBe(false);
    expect(h.state.rows.size).toBe(0); expect(h.storage.writes).toEqual([]); expect(now).not.toHaveBeenCalled(); expect(uuid).toHaveBeenCalledTimes(1);
    const second = await child.run(); expect(second.outcome).toBe("held");
    expect(child.isCurrentHold(first.hold)).toBe(false); expect(uuid).toHaveBeenCalledTimes(1);
    expect(await h.target.release(h.lease)).toEqual({ ok: false, reason: "borrowed_evidence_held" });
    const closes = h.state.closeCount;
    expect(await child.dispose()).toEqual({ ok: true }); expect(h.state.closeCount).toBe(closes);
    expect(h.target.leaseState()).toBe("owned"); expect(h.make()).toEqual({ ok: false, reason: "borrowed_evidence_held" });
    expect(await h.target.release(h.lease)).toEqual({ ok: true });
  });
  it("copies to verified with its own transactions and holds; retains warm evidence on dispose", async () => {
    const h = await harness(platform, { ...BASE_SOURCE }), now = vi.fn(() => SYNTHETIC_NOW), child = h.child({ now });
    const report = await child.run(); expect(report.outcome).toBe("held"); expect(phase(h.state.rows)).toBe("verified");
    expect(report.completedPlans.some(p => p.name === "AP-ACT")).toBe(false);
    expect(now).not.toHaveBeenCalled();
    for (const [key, raw] of Object.entries(BASE_SOURCE)) expect(h.state.rows.get(key)).toBe(raw);
    expect(await child.dispose()).toEqual({ ok: false, reason: "plan_evidence_held" });
    expect(await h.target.release(h.lease)).toEqual({ ok: false, reason: "borrowed_evidence_held" });
    expect(h.make()).toEqual({ ok: false, reason: "borrowed_evidence_held" });
  });
  it("existing verified D holds freshly without changing D or calling now", async () => {
    const raw = verifiedBytes(BASE_SOURCE), h = await harness(platform, { ...BASE_SOURCE, [MARKER_KEY]: STORE_A }, { ...BASE_SOURCE, [RECORD_KEY]: raw });
    const now = vi.fn(() => SYNTHETIC_NOW), child = h.child({ now });
    const report = await child.run(); expect(report.outcome).toBe("held"); expect(h.state.rows.get(RECORD_KEY)).toBe(raw);
    expect(h.state.trace).not.toContain("begin"); expect(now).not.toHaveBeenCalled();
  });
  it("refuses an active D separately, with no source listing/marker/value reads", async () => {
    const h = await harness(platform, { [KEY_SESSION]: "private" }, { ...BASE_SOURCE, [RECORD_KEY]: activeBytes() });
    const child = h.child(), report = await child.run(); expect(report.outcome).toBe("active_refused");
    expect(h.storage.lengthReads).toBe(0); expect(h.storage.valueReads).toEqual([]); expect(h.state.trace).not.toContain("begin");
  });
  it("uses registered execution methods even if the public target is replaced before borrowing", async () => {
    const h = await harness(platform), replacement = vi.fn(() => { throw new Error("not real"); });
    h.target.readReserved = replacement; h.target.checkProtocolSelection = replacement;
    h.target.transact = replacement; h.target.leaseState = replacement;
    const child = h.child(); expect((await child.run()).outcome).toBe("held"); expect(replacement).not.toHaveBeenCalled();
  });
  it("rejects fake/copied/Proxy targets, wrong/copied leases, and a second borrower without I/O", async () => {
    const h = await harness(platform);
    for (const target of [{ ...h.target }, new Proxy(h.target, { get() { throw new Error("opaque"); } })]) {
      expect(h.make({ target })).toEqual({ ok: false, reason: "unregistered_target" });
    }
    expect(h.make({ lease: { ...h.lease } })).toEqual({ ok: false, reason: "wrong_lease" });
    const child = h.child(); expect(h.make()).toEqual({ ok: false, reason: "borrowed_evidence_held" });
    expect(h.state.trace).toEqual([]); await child.dispose(); await h.target.release(h.lease);
  });
  it("rejects malformed dependency before pinning an actual lease", async () => {
    const h = await harness(platform);
    expect(h.make({ generateUuid: undefined })).toEqual({ ok: false, reason: "invalid_dependency" });
    expect(await h.target.release(h.lease)).toEqual({ ok: true });
  });
  for (const [label, change] of [
    ["unsupported deletion control", (h: Awaited<ReturnType<typeof harness>>) => h.storage.map.set(DELETION_GUARD_PREFIX + "unsupported.v2", "opaque")],
    ["new eligible deletion control", (h: Awaited<ReturnType<typeof harness>>) => h.storage.map.set(DELETION_GUARD_PREFIX + STORE_A + ".v1", "opaque")],
    ["changed staged target value", (h: Awaited<ReturnType<typeof harness>>) => h.state.rows.set(KEY_SESSION, "changed")],
  ] as const) it(`fresh AP-ACT collection catches ${label}`, async () => {
    const h = await harness(platform, { ...BASE_SOURCE, [MARKER_KEY]: STORE_A }, { ...BASE_SOURCE, [RECORD_KEY]: verifiedBytes() });
    const source = h.deps.source; let lists = 0;
    const child = h.child({ source: { ...source, listKeys: async () => { lists++; if (lists === (label === "changed staged target value" ? 1 : 2)) change(h); return source.listKeys(); } } });
    const report = await child.run(); expect(report.outcome).not.toBe("held"); expect(report.outcome).not.toBe("access"); expect(phase(h.state.rows)).toBe("verified");
  });
  it("fresh D1 listing prevents an empty hold after a late source addition", async () => {
    const h = await harness(platform), source = h.deps.source; let lists = 0;
    const child = h.child({ source: { ...source, listKeys: async () => { if (++lists === 2) h.storage.map.set(KEY_SESSION, "late"); return source.listKeys(); } } });
    expect((await child.run()).outcome).toBe("preparation_changed"); expect(h.state.rows.size).toBe(0);
  });
  for (const kind of ["rolled_back", "confirmed", "unknown"] as const) it(`invalidates holds at ${kind} parent-write issuance without changing lifecycle authority`, async () => {
    const h = await harness(platform), child = h.child(), report = await child.run();
    if (report.outcome !== "held") throw new Error("fixture hold");
    if (kind === "unknown") h.faults.onCommit = () => "reject_after_effect";
    const tx = h.target.transact(h.lease, kind === "rolled_back" ?
      { kind: "replace_record", recordBefore: "absent", recordAfter: "never", requireNoApplicationRows: true } : { kind: "insert_latch", content: "fault" });
    expect(child.isCurrentHold(report.hold)).toBe(false);
    const result = await tx; expect(result.status).toBe(kind === "rolled_back" ? "not_committed" : kind === "unknown" ? "outcome_unknown" : "confirmed");
    expect(child.isCurrentHold(report.hold)).toBe(false);
  });
  it("reopen invalidates a hold immediately and an independently prepared new hold replaces it", async () => {
    const h = await harness(platform), child = h.child(), first = await child.run(); if (first.outcome !== "held") throw new Error("fixture");
    const pending = h.target.reopen(h.lease); expect(child.isCurrentHold(first.hold)).toBe(false);
    expect(await pending).toMatchObject({ ok: true }); const second = await child.run(); expect(second.outcome).toBe("held");
    if (second.outcome === "held") expect(child.isCurrentHold(second.hold)).toBe(true);
    expect(child.isCurrentHold(first.hold)).toBe(false);
  });
  it("unknown COMMIT requests actual parent recovery, retaining memory; old success and failed new reopen do not suffice", async () => {
    const h = await harness(platform, { ...BASE_SOURCE }), child = h.child();
    expect(await h.target.reopen(h.lease)).toMatchObject({ ok: true });
    let once = true; h.faults.onCommit = () => { if (once) { once = false; return "reject_after_effect"; } return "ok"; };
    expect((await child.run()).outcome).toBe("halted"); const opens = h.state.openCount;
    expect((await child.run()).outcome).toBe("parent_recovery_required"); expect(h.state.openCount).toBe(opens);
    h.faults.closeRejects = true; expect(await h.target.reopen(h.lease)).toMatchObject({ ok: false });
    expect((await child.run()).outcome).toBe("parent_recovery_required");
    h.faults.closeRejects = false; expect(await h.target.reopen(h.lease)).toMatchObject({ ok: true });
    expect((await child.run()).outcome).toBe("held"); expect(phase(h.state.rows)).toBe("verified");
  });
  it("retains confirmed warm row loss despite an unreadable D, and pins the fault", async () => {
    const h = await harness(platform, { ...BASE_SOURCE }), child = h.child();
    expect((await child.run()).outcome).toBe("held"); h.state.rows.delete(KEY_SESSION);
    h.faults.onQuery = (sql, values) => sql.startsWith("SELECT value FROM records") && values[0] === RECORD_KEY ? { reject: true } : undefined;
    const report = await child.run(); expect(report.outcome).toBe("fault");
    expect(await child.dispose()).toEqual({ ok: false, reason: "fault_stop_held" });
    expect(await h.target.release(h.lease)).toEqual({ ok: false, reason: "borrowed_evidence_held" });
  });
  it("latch uncertainty asks parent recovery and keeps bounded attempts in the same child", async () => {
    const h = await harness(platform, {}, { [RECORD_KEY]: "malformed" });
    // Invalid D alone is blocked, so first create warm memory and then destroy a row.
    await h.target.release(h.lease);
    const a = await harness(platform, { ...BASE_SOURCE }), child = a.child(); await child.run(); a.state.rows.delete(KEY_SESSION);
    a.faults.onCommit = () => "reject_before_effect";
    expect((await child.run()).outcome).toBe("parent_recovery_required");
    expect((await child.run()).outcome).toBe("parent_recovery_required");
    for (let i = 0; i < 3; i++) { await a.target.reopen(a.lease); await child.run(); }
    const report = await child.run(); expect(report.outcome).toBe("fault");
    if (report.outcome === "fault") { expect(report.latch.attempts).toHaveLength(LIMITS.latchWriteAttemptLimit); expect(report.latch.attemptsRemain).toBe(false); }
  });
  it("synchronous uuid callback starting parent reopen cannot issue a hold or further write", async () => {
    const h = await harness(platform); let reopen: Promise<unknown> | undefined;
    const child = h.child({ generateUuid: () => { reopen = h.target.reopen(h.lease); return syntheticUuid(); } });
    expect((await child.run()).outcome).toBe("preparation_changed"); await reopen;
    expect(h.state.rows.size).toBe(0); expect(h.state.trace).not.toContain("begin");
  });
  it("disposal joins actual pending transaction, issues no later write, and never releases parent", async () => {
    const entered = deferred(), release = deferred(), h = await harness(platform, { ...BASE_SOURCE });
    h.faults.gate = call => { if (call.kind === "begin") { entered.resolve(); return release.promise; } };
    const child = h.child(), run = child.run(); await entered.promise;
    let settled = false; const disposal = child.dispose().then(x => { settled = true; return x; });
    await Promise.resolve(); expect(settled).toBe(false); expect(await h.target.release(h.lease)).toEqual({ ok: false, reason: "borrowed_evidence_held" });
    release.resolve(); expect((await run).outcome).toBe("disposed"); expect(await disposal).toEqual({ ok: false, reason: "plan_evidence_held" });
    expect(h.target.leaseState()).toBe("owned"); expect(h.state.rows.size).toBe(0); expect(await h.target.release(h.lease)).toEqual({ ok: false, reason: "borrowed_evidence_held" });
  });
  it("two requested parent reopens cannot certify a newer failed attempt with the older success", async () => {
    const h = await harness(platform), child = h.child(); await child.run();
    let releases = 0; h.faults.onCloseConnection = () => ++releases === 2 ? "reject_before_effect" : "ok";
    const first = h.target.reopen(h.lease), second = h.target.reopen(h.lease);
    expect(await first).toMatchObject({ ok: true }); expect(await second).toMatchObject({ ok: false });
    expect((await child.run()).outcome).toBe("parent_recovery_required");
    h.faults.onCloseConnection = undefined; expect(await h.target.reopen(h.lease)).toMatchObject({ ok: true });
    expect((await child.run()).outcome).toBe("held");
  });
  it("combined schema is refused by the legacy target before holding", async () => {
    const h = await harness(platform); h.state.tables.add("curling_credential_meta");
    const report = await h.child().run(); expect(report.outcome).not.toBe("held"); expect(h.state.trace).not.toContain("begin");
  });
  it("does not borrow a genuine adapter with custom reserved keys", async () => {
    const plugin = createPluginFaithfulEngine({ platform });
    const binding = createNativeMigrationSqliteStore({ databaseName: `s3d-custom-${++ordinal}`, engine: plugin.engine, detectPlatform: () => platform, reservedKeys: { record: "custom-d", latch: "custom-f" } });
    const acquired = await binding.target.acquire(); if (!acquired.ok) throw new Error("fixture");
    const h = await harness(platform);
    expect(h.make({ target: binding.target, lease: acquired.lease })).toEqual({ ok: false, reason: "unregistered_target" });
    await binding.target.release(acquired.lease); await h.target.release(h.lease);
  });
  it("failed parent release cannot mint borrow readiness from legacy public owned phase", async () => {
    const h = await harness(platform); await h.target.readReserved(h.lease);
    h.faults.closeRejects = true; expect(await h.target.release(h.lease)).toMatchObject({ ok: false });
    expect(h.target.leaseState()).toBe("owned"); expect(h.make()).toEqual({ ok: false, reason: "requires_reopen" });
    h.faults.closeRejects = false; await h.target.reopen(h.lease);
    const child = h.child(); expect((await child.run()).outcome).toBe("held"); await child.dispose(); await h.target.release(h.lease);
  });
  it("promotes unknown AP-CC after-state before holding, so exact before-state rollback is a fault", async () => {
    const h = await harness(platform, { ...BASE_SOURCE }); let before: string | undefined, once = true;
    h.faults.onCommit = working => {
      const raw = working.get(RECORD_KEY), record = raw ? evaluateActivationRecord(raw, isSyntheticFingerprint) : null;
      if (once && record?.ok && record.record.phase === "verified") {
        once = false; before = h.state.rows.get(RECORD_KEY); return "reject_after_effect";
      }
      return "ok";
    };
    const child = h.child(); expect(await child.run()).toMatchObject({ outcome: "halted", transaction: { status: "outcome_unknown" } });
    await h.target.reopen(h.lease); expect((await child.run()).outcome).toBe("held");
    if (!before) throw new Error("fixture"); h.state.rows.set(RECORD_KEY, before);
    expect((await child.run()).outcome).toBe("fault"); expect(phase(h.state.rows)).toBe("copying");
    expect(h.state.rows.has(LATCH_KEY)).toBe(true);
  });
  for (const cancelledBy of ["source", "target_digest"] as const) it(`retains complete-listing warm loss before later ${cancelledBy} cancellation`, async () => {
    const h = await harness(platform, { ...BASE_SOURCE }); let trigger = false, cancelled = false;
    const source = h.deps.source;
    const child = h.child({ source: { ...source, listKeys: async () => {
      if (trigger && cancelledBy === "source") { cancelled = true; void h.target.reopen(h.lease); }
      return source.listKeys();
    } }, fingerprint: raw => {
      if (trigger && cancelledBy === "target_digest") { cancelled = true; void h.target.reopen(h.lease); }
      return fp(raw);
    } });
    expect((await child.run()).outcome).toBe("held"); h.state.rows.delete(KEY_SESSION); trigger = true;
    expect((await child.run()).outcome).toBe("fault"); expect(cancelled).toBe(false);
    h.state.rows.set(KEY_SESSION, BASE_SOURCE[KEY_SESSION]); await h.target.reopen(h.lease);
    expect((await child.run()).outcome).toBe("fault"); expect(h.state.rows.has(LATCH_KEY)).toBe(true);
  });
  it("retains an individual wrong warm value before any later native value read or digest", async () => {
    const h = await harness(platform, { ...BASE_SOURCE }), child = h.child(); await child.run();
    const [first, second] = Object.keys(BASE_SOURCE).sort(); h.state.rows.set(first, "changed"); let later = false;
    h.faults.onQuery = (sql, values) => { if (sql.startsWith("SELECT value FROM records") && values[0] === second) later = true; return undefined; };
    expect((await child.run()).outcome).toBe("fault"); expect(later).toBe(false);
    h.state.rows.set(first, BASE_SOURCE[first]); expect((await child.run()).outcome).toBe("fault");
  });
  it("does not turn failed individual warm value reads into a positive fault", async () => {
    const h = await harness(platform, { ...BASE_SOURCE }), child = h.child(); await child.run();
    h.faults.onQuery = (sql, values) => sql.startsWith("SELECT value FROM records") && values[0] === KEY_SESSION ? { reject: true } : undefined;
    expect((await child.run()).outcome).toBe("blocked"); expect(h.state.rows.has(LATCH_KEY)).toBe(false);
    h.faults.onQuery = undefined; expect((await child.run()).outcome).toBe("held");
  });
  it("executes guarded AP-ACT marker prefix before holding, without activating", async () => {
    const h = await harness(platform, { ...BASE_SOURCE }, { ...BASE_SOURCE, [RECORD_KEY]: verifiedBytes() });
    const child = h.child(); expect((await child.run()).outcome).toBe("held");
    expect(h.storage.map.get(MARKER_KEY)).toBe(STORE_A); expect(h.storage.writes).toEqual([MARKER_KEY]); expect(phase(h.state.rows)).toBe("verified");
  });
  it("stops before a second UUID callback after the first supersedes the parent lifecycle", async () => {
    const h = await harness(platform, { ...BASE_SOURCE }); let calls = 0, reopen: Promise<unknown> | undefined;
    const child = h.child({ generateUuid: () => { calls++; if (calls === 1) reopen = h.target.reopen(h.lease); return syntheticUuid(); } });
    expect((await child.run()).outcome).toBe("parent_recovery_required"); expect(calls).toBe(1); await reopen;
    expect(h.state.rows.size).toBe(0); expect(h.state.trace).not.toContain("begin");
  });
  it("does not issue a second native open after an uncertain borrowed open-cleanup", async () => {
    const h = await harness(platform), child = h.child();
    h.faults.openRejects = true; h.faults.closeConnectionRejects = true;
    const report = await child.run();
    expect(h.state.trace.filter(x => x === "create")).toHaveLength(1);
    expect(report.outcome).toBe("target_refused");
    expect((await child.run()).outcome).toBe("parent_recovery_required");
    expect(h.state.trace.filter(x => x === "create")).toHaveLength(1);
    h.faults.openRejects = false; h.faults.closeConnectionRejects = false;
    expect(await h.target.reopen(h.lease)).toMatchObject({ ok: true });
    expect((await child.run()).outcome).toBe("held"); await child.dispose(); await h.target.release(h.lease);
  });
  it("holds cannot cross child identity", async () => {
    const a = await harness(platform), childA = a.child(), report = await childA.run();
    const b = await harness(platform), childB = b.child(); await childB.run();
    if (report.outcome !== "held") throw new Error("fixture"); expect(childB.isCurrentHold(report.hold)).toBe(false);
  });
});
