// S3e: real disposable SQLite with source-derived installed-plugin execute
// preprocessing and explicitly injected bridge faults. No physical native claim.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeCombinedHeldDomainMigrationRunner, type NativeMigrationRunnerDependencies, type NativeHeldDomainMigrationRunner } from "../nativeMigrationRunner";
import { createNativeMigrationSqliteStore, createNativeSqliteStore, createNativeCredentialSqliteInventory, type NativeCombinedHeldSqliteHost, type NativeMigrationLease } from "../nativeSqliteAdapter";
import { borrowNativeCombinedHeldHost } from "../nativeMigrationBorrowEvidence";
import { createNativeMigrationSource } from "../nativeMigrationBindings";
import { combinedFixture, disposeCombinedFixtures, CREATE, META, MARKER, D, L } from "./nativeCombinedHeldSqliteTestEngine";
import { SyntheticStorage, MARKER_KEY, LIMITS, syntheticUuid, SYNTHETIC_NOW } from "./nativeMigrationMTestKit";
import { BASE_SOURCE, KEY_SESSION, STORE_A, fp, isSyntheticFingerprint, verifiedBytes, activeBytes, enumeratingBytes, copyingBytes } from "./nativeMigrationTestKit";
import { evaluateActivationRecord } from "../nativeMigrationRecord";

afterEach(async () => { vi.unstubAllGlobals(); await disposeCombinedFixtures(); });
const literal = (value: string) => "'" + value.replaceAll("'", "''") + "'";
const recordRow = (key: string, value: string) => `INSERT INTO records VALUES (${literal(key)},${literal(value)});`;
const metaRow = (slot: string, raw: string) => `INSERT INTO curling_credential_meta VALUES (${literal(slot)},${literal(raw)});`;
const combinedRows = (rows: Record<string, string> = {}, meta: Record<string, string> = { schema: MARKER }) => [CREATE, META, ...Object.entries(rows).map(([key, raw]) => recordRow(key, raw)), ...Object.entries(meta).map(([key, raw]) => metaRow(key, raw))];
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
type ChildDeps = Omit<NativeMigrationRunnerDependencies, "target"> & { host: NativeCombinedHeldSqliteHost; lease: NativeMigrationLease };
async function setup(platform: "ios" | "android", initialSource: Record<string, string> = {}, statements: string[] = [], initialize = true) {
  const h = await combinedFixture(platform, statements), storage = new SyntheticStorage(initialSource);
  vi.stubGlobal("localStorage", storage);
  if (initialize) expect(await h.cap.initializeEmpty(h.lease)).toEqual({ status: "confirmed" });
  const deps: ChildDeps = { host: h.cap, lease: h.lease, source: createNativeMigrationSource(), fingerprint: fp,
    isWellFormedFingerprint: isSyntheticFingerprint, generateUuid: syntheticUuid, now: () => SYNTHETIC_NOW, limits: LIMITS };
  const make = (overrides: Partial<ChildDeps> = {}) => createNativeCombinedHeldDomainMigrationRunner({ ...deps, ...overrides });
  const child = (overrides: Partial<ChildDeps> = {}): NativeHeldDomainMigrationRunner => {
    const made = make(overrides); if (!made.ok) throw new Error(made.reason); return made.runner;
  };
  return { ...h, storage, deps, make, child };
}
function observedPhase(raw: string) { const record = evaluateActivationRecord(raw, isSyntheticFingerprint); return record.ok ? record.record.phase : "invalid"; }

for (const platform of ["ios", "android"] as const) describe(`${platform} isolated combined held SQL host`, () => {
  it("exposes only parent controls, requires actual initialization, and holds fresh D1 without active writes", async () => {
    const h = await setup(platform, {}, [], false);
    expect(Object.keys(h.cap).sort()).toEqual(["acquire", "initializeEmpty", "leaseState", "observe", "release", "reopen"]);
    expect(Object.isFrozen(h.cap)).toBe(true); expect(h.trace).toEqual([]);
    expect(h.make()).toEqual({ ok: false, reason: "schema_unproven" });
    expect(await h.cap.initializeEmpty(h.lease)).toEqual({ status: "confirmed" });
    const child = h.child(), now = h.trace.length, report = await child.run(); expect(report.outcome).toBe("held");
    expect(h.trace.slice(now).some(e => e.kind === "begin" || e.kind === "run")).toBe(false);
    if (report.outcome !== "held") throw new Error("fixture"); expect(child.isCurrentHold(report.hold)).toBe(true);
    expect(await h.cap.initializeEmpty(h.lease)).toEqual({ status: "refused", reason: "borrowed_evidence_held" });
    expect(await h.cap.release(h.lease)).toEqual({ ok: false, reason: "borrowed_evidence_held" });
    const observation = h.cap.observe(h.lease); expect(child.isCurrentHold(report.hold)).toBe(false); expect(await observation).toMatchObject({ ok: true, layout: "combined", record: { status: "absent" } });
    expect(child.isCurrentHold(report.hold)).toBe(false); expect(await child.dispose()).toEqual({ ok: true }); expect(await h.cap.release(h.lease)).toEqual({ ok: true });
  });
  it("copies source byte-exactly to verified using one owner and holds without activating", async () => {
    const h = await setup(platform, { ...BASE_SOURCE }), child = h.child(), report = await child.run();
    expect(report.outcome, JSON.stringify(report)).toBe("held"); const observed = await h.cap.observe(h.lease);
    if (!observed.ok || observed.record.status !== "present") throw new Error(JSON.stringify(observed));
    expect(observedPhase(observed.record.bytes)).toBe("verified"); expect(observed.q).toEqual({ status: "absent" }); expect(observed.f).toEqual({ status: "absent" });
    const rows = await h.raw({ kind: "query", sql: "SELECT key,value FROM records" }) as { values: { key: string; value: string }[] };
    for (const [key, value] of Object.entries(BASE_SOURCE)) expect(rows.values.find(row => row.key === key)?.value).toBe(value);
    expect(h.storage.map.has(MARKER_KEY)).toBe(true); expect(await child.dispose()).toEqual({ ok: false, reason: "plan_evidence_held" });
  });
  it("reopens an existing initialized verified target without marker adoption or an active transition", async () => {
    const h = await setup(platform, { ...BASE_SOURCE, [MARKER_KEY]: STORE_A }, combinedRows({ ...BASE_SOURCE, [D]: verifiedBytes() }), false);
    expect(h.make()).toEqual({ ok: false, reason: "schema_unproven" });
    expect(await h.cap.observe(h.lease)).toMatchObject({ ok: true, layout: "combined" });
    expect((await h.child().run()).outcome).toBe("held"); expect(h.trace.some(e => e.kind === "begin")).toBe(false);
  });
  for (const [slot, raw] of [["q", ""], ["q", '{"phase":"bound"}'], ["q", '{"schemaVersion":99}'], ["f", ""], ["f", "malformed"]]) {
    it(`observes ${slot} presence ${raw || "empty"} but never resumes or prepares normally`, async () => {
      const h = await setup(platform, {}, combinedRows({}, { schema: MARKER, [slot]: raw }), false);
      const observed = await h.cap.observe(h.lease); expect(observed).toMatchObject({ ok: true, [slot]: { status: "present", bytes: raw } });
      const child = h.child(); expect((await child.run()).outcome).not.toBe("held");
      expect(h.trace.some(e => e.kind === "begin" || e.kind === "run")).toBe(false);
      expect(await h.cap.release(h.lease)).toEqual({ ok: false, reason: "control_evidence_held" });
    });
  }
  it("does not add a schema marker to existing legacy D or application rows", async () => {
    const h = await setup(platform, { ...BASE_SOURCE }, [CREATE, recordRow(D, verifiedBytes()), recordRow(KEY_SESSION, "private")], false);
    expect(await h.cap.observe(h.lease)).toMatchObject({ ok: true, layout: "records" });
    expect(await h.cap.initializeEmpty(h.lease)).toEqual({ status: "refused", reason: "target_not_empty" });
    expect(h.make()).toEqual({ ok: false, reason: "schema_unproven" }); expect(h.trace.some(e => e.kind === "begin" || e.kind === "run")).toBe(false);
  });
  it("keeps older ordinary, legacy and S3b capability boundaries unchanged", async () => {
    const h = await setup(platform); expect(await h.cap.release(h.lease)).toEqual({ ok: true });
    const ordinary = createNativeSqliteStore(h.options); expect((await ordinary.adapter.get(KEY_SESSION)).status).not.toBe("value"); await ordinary.close();
    const legacy = createNativeMigrationSqliteStore({ ...h.options, reservedKeys: { record: D, latch: L } });
    const owned = await legacy.target.acquire(); if (!owned.ok) throw new Error("fixture");
    expect(await legacy.target.readReserved(owned.lease)).toEqual({ ok: false, reason: "protocol_refused" }); await legacy.target.release(owned.lease);
    const inventory = createNativeCredentialSqliteInventory(h.options), acquired = await inventory.acquire(); if (!acquired.ok) throw new Error("fixture");
    expect(await inventory.observe(acquired.lease)).toMatchObject({ ok: true, layout: "combined" }); await inventory.release(acquired.lease);
  });
  it("rejects copied/fake/Proxy hosts and copied leases without resolving caller target methods", async () => {
    const h = await setup(platform), before = h.trace.length;
    for (const host of [{ ...h.cap }, new Proxy(h.cap, { get() { throw new Error("do not inspect"); } })]) {
      expect(h.make({ host: host as NativeCombinedHeldSqliteHost })).toEqual({ ok: false, reason: "unregistered_host" });
    }
    expect(h.make({ lease: { ...h.lease } })).toEqual({ ok: false, reason: "wrong_lease" }); expect(h.trace).toHaveLength(before);
  });
  it("rejects active, copied, unregistered and reused transaction permissions before native I/O", async () => {
    const h = await setup(platform), borrowed = borrowNativeCombinedHeldHost(h.cap, h.lease); if (!borrowed.ok) throw new Error("fixture");
    const cap = borrowed.capability; expect(cap.beginRun?.()).toBe(true); const before = h.trace.length;
    const active = { kind: "create_record" as const, recordAfter: activeBytes() };
    expect(cap.seal?.(active, "create_enumerating", isSyntheticFingerprint)).toBeNull();
    expect(await cap.target.transact(h.lease, active)).toEqual({ status: "refused", reason: "invalid_transaction" });
    expect(h.trace).toHaveLength(before);
    const tx = cap.seal?.({ kind: "create_record", recordAfter: enumeratingBytes([KEY_SESSION]) }, "create_enumerating", isSyntheticFingerprint); if (!tx) throw new Error("fixture seal");
    expect(Object.isFrozen(tx)).toBe(true); expect(await cap.target.transact(h.lease, { ...tx })).toEqual({ status: "refused", reason: "invalid_transaction" });
    expect(await cap.target.transact(h.lease, tx)).toEqual({ status: "confirmed" }); const after = h.trace.length;
    expect(await cap.target.transact(h.lease, tx)).toEqual({ status: "refused", reason: "invalid_transaction" }); expect(h.trace).toHaveLength(after); cap.endRun?.();
  });
  it("permission validation fences its own format callbacks after parent supersession", async () => {
    const h = await setup(platform), borrowed = borrowNativeCombinedHeldHost(h.cap, h.lease); if (!borrowed.ok) throw new Error("fixture");
    const cap = borrowed.capability; cap.beginRun?.(); let calls = 0, reopen: Promise<unknown> | undefined;
    const sealed = cap.seal?.({ kind: "replace_record", recordBefore: "copying", recordAfter: verifiedBytes(), requireNoApplicationRows: false }, "complete_copying", () => {
      if (++calls === 1) reopen = h.cap.reopen(h.lease); return true;
    });
    expect(sealed).toBeNull(); expect(calls).toBe(1); cap.endRun?.(); await reopen;
    expect(h.trace.some(e => e.kind === "begin" && h.trace.indexOf(e) > h.trace.findIndex(x => x.kind === "commit"))).toBe(false);
  });
  for (const when of ["before_write", "before_commit"] as const) it(`rechecks controls inside a domain transaction ${when}`, async () => {
    const h = await setup(platform, { ...BASE_SOURCE }), child = h.child(); let inTx = false, wrote = false, injected = false;
    const before = h.trace.length;
    h.faults.hook = async (event, next) => {
      if (event.kind === "begin") inTx = true;
      if (event.kind === "run" && event.sql?.includes("records")) wrote = true;
      if (inTx && !injected && event.kind === "query" && event.sql?.includes("curling_credential_meta") && event.values?.[0] === "q" && (when === "before_write" || wrote)) {
        injected = true; return { values: [{ value: "unexpected Q (injected bridge evidence)" }] };
      }
      return next();
    };
    const report = await child.run(); expect(report.outcome).toBe("halted"); expect(injected).toBe(true);
    if (report.outcome === "halted") expect(report.transaction).toMatchObject({ status: "not_committed", writeIssued: when === "before_commit", connection: "clean" });
    expect(h.trace.slice(before).some(e => e.kind === "commit")).toBe(false);
    const observed = await h.cap.observe(h.lease); expect(observed).toMatchObject({ ok: true, record: { status: "absent" } });
  });
  it("refuses parent observation in COMMIT-ack to child-memory continuation window", async () => {
    const h = await setup(platform, { ...BASE_SOURCE }), child = h.child(); let observation: ReturnType<typeof h.cap.observe> | undefined;
    h.faults.hook = async (event, next) => {
      const result = await next();
      if (event.kind === "commit" && !observation) observation = h.cap.observe(h.lease);
      return result;
    };
    expect((await child.run()).outcome).toBe("held"); expect(await observation).toEqual({ ok: false, reason: "parent_busy" });
    expect(await h.cap.observe(h.lease)).toMatchObject({ ok: true });
  });
  it("keeps a real pending parent observation admitted; child returns busy without demanding reopen", async () => {
    const h = await setup(platform), child = h.child(), first = await child.run(); if (first.outcome !== "held") throw new Error("fixture");
    const entered = deferred(), release = deferred(); let once = true;
    h.faults.hook = async (event, next) => { if (once && event.kind === "query") { once = false; entered.resolve(); await release.promise; } return next(); };
    const observing = h.cap.observe(h.lease); await entered.promise; const before = h.trace.length;
    expect((await child.run()).outcome).toBe("parent_busy"); expect(h.trace).toHaveLength(before); expect(child.isCurrentHold(first.hold)).toBe(false);
    release.resolve(); expect(await observing).toMatchObject({ ok: true }); expect((await child.run()).outcome).toBe("held");
  });
  it("retains positive F before later parent-observation cancellation and attempted F removal", async () => {
    const h = await setup(platform, {}, combinedRows({}, { schema: MARKER, f: "positive" }), false); let observedF = false, reopen: Promise<unknown> | undefined;
    h.faults.hook = async (event, next) => { const value = await next(); if (event.sql?.includes("curling_credential_meta") && event.values?.[0] === "f") observedF = true; return value; };
    const observed = await h.cap.observe(h.lease, { proceed: () => { if (observedF && !reopen) reopen = h.cap.reopen(h.lease); return true; } });
    expect(observed).toEqual({ ok: false, reason: "cancelled" }); await reopen;
    h.faults.hook = undefined; await h.raw({ kind: "execute", sql: "DELETE FROM curling_credential_meta WHERE slot='f';" });
    expect(await h.cap.observe(h.lease)).toMatchObject({ ok: true, f: { status: "absent" } });
    expect((await h.child().run()).outcome).not.toBe("held"); expect(await h.cap.release(h.lease)).toEqual({ ok: false, reason: "control_evidence_held" });
  });
  it("publishes positive D contradiction to the settled warm child before later metadata cancellation", async () => {
    const h = await setup(platform, { ...BASE_SOURCE }), child = h.child(); expect((await child.run()).outcome).toBe("held");
    const first = await h.cap.observe(h.lease); if (!first.ok || first.record.status !== "present") throw new Error("fixture");
    const verified = first.record.bytes; await h.raw({ kind: "execute", sql: `UPDATE records SET value='changed' WHERE key=${literal(D)};` });
    let gotRecord = false, reopen: Promise<unknown> | undefined;
    h.faults.hook = async (event, next) => { const result = await next(); if (event.sql?.startsWith("SELECT value FROM records") && event.values?.[0] === D) gotRecord = true; return result; };
    expect(await h.cap.observe(h.lease, { proceed: () => { if (gotRecord && !reopen) reopen = h.cap.reopen(h.lease); return true; } })).toEqual({ ok: false, reason: "cancelled" });
    await reopen; h.faults.hook = undefined; await h.raw({ kind: "execute", sql: `UPDATE records SET value=${literal(verified)} WHERE key=${literal(D)};` });
    expect((await child.run()).outcome).toBe("fault"); expect(await child.dispose()).toEqual({ ok: false, reason: "fault_stop_held" });
  });
  for (const blocked of ["q", "f"] as const) it(`allows ONLY bounded D latch when ${blocked} is unreadable after proven domain loss`, async () => {
    const h = await setup(platform, { ...BASE_SOURCE }), child = h.child(); await child.run();
    await h.raw({ kind: "execute", sql: `DELETE FROM records WHERE key=${literal(KEY_SESSION)};` });
    h.faults.hook = async (event, next) => { if (event.sql?.startsWith("SELECT value FROM curling_credential_meta") && event.values?.[0] === blocked) throw new Error("opaque"); return next(); };
    const report = await child.run(); expect(report.outcome).toBe("fault");
    if (report.outcome === "fault") expect(report.latch.established).toBe("confirmed");
    expect(await child.dispose()).toEqual({ ok: false, reason: "fault_stop_held" });
  });
  it("retains proven domain fault but writes no latch with an unproven schema marker", async () => {
    const h = await setup(platform, { ...BASE_SOURCE }), child = h.child(); await child.run();
    await h.raw({ kind: "execute", sql: `DELETE FROM records WHERE key=${literal(KEY_SESSION)};` });
    h.faults.hook = async (event, next) => { if (event.sql?.startsWith("SELECT value FROM curling_credential_meta") && event.values?.[0] === "schema") throw new Error("opaque"); return next(); };
    expect((await child.run()).outcome).toBe("parent_recovery_required");
    const raw = await h.raw({ kind: "query", sql: `SELECT value FROM records WHERE key=${literal(L)};` }) as { values: unknown[] }; expect(raw.values).toEqual([]);
    expect(await child.dispose()).toEqual({ ok: false, reason: "fault_stop_held" });
  });
  it("unknown initialization COMMIT needs real reopen and fresh observation before borrowing", async () => {
    const h = await setup(platform, {}, [], false); let once = true;
    h.faults.hook = async (event, next) => { const result = await next(); if (once && event.kind === "commit") { once = false; throw new Error("ack lost"); } return result; };
    expect(await h.cap.initializeEmpty(h.lease)).toEqual({ status: "outcome_unknown" }); expect(h.make()).toEqual({ ok: false, reason: "requires_reopen" });
    h.faults.hook = undefined; await h.cap.reopen(h.lease); expect(h.make()).toEqual({ ok: false, reason: "schema_unproven" });
    await h.cap.observe(h.lease); expect((await h.child().run()).outcome).toBe("held");
  });
  it("never returns access from a cold active D and never reads its old source", async () => {
    const h = await setup(platform, { ...BASE_SOURCE }, combinedRows({ ...BASE_SOURCE, [D]: activeBytes() }), false);
    await h.cap.observe(h.lease); const child = h.child();
    expect((await child.run()).outcome).toBe("active_refused"); expect(h.storage.lengthReads).toBe(0); expect(h.storage.valueReads).toEqual([]);
    expect(h.trace.some(e => e.kind === "begin")).toBe(false);
  });
  it("rejects latch without retained fault, and stale permissions cannot survive real parent reopen", async () => {
    const h = await setup(platform), borrowed = borrowNativeCombinedHeldHost(h.cap, h.lease); if (!borrowed.ok) throw new Error("fixture");
    const cap = borrowed.capability; cap.beginRun?.();
    expect(cap.seal?.({ kind: "insert_latch", content: "caller Boolean is not proof" }, "write_fault_latch", isSyntheticFingerprint)).toBeNull();
    const tx = cap.seal?.({ kind: "create_record", recordAfter: enumeratingBytes([KEY_SESSION]) }, "create_enumerating", isSyntheticFingerprint); if (!tx) throw new Error("fixture");
    await h.cap.reopen(h.lease); const before = h.trace.length;
    expect(await cap.target.transact(h.lease, tx)).toEqual({ status: "refused", reason: "invalid_transaction" });
    expect(cap.seal?.({ kind: "create_record", recordAfter: enumeratingBytes([KEY_SESSION]) }, "create_enumerating", isSyntheticFingerprint)).toBeNull();
    expect(h.trace).toHaveLength(before); cap.endRun?.();
  });
  it("seals owned immutable checkpoint rows instead of retaining caller mutations", async () => {
    const h = await setup(platform, {}, combinedRows({ [D]: copyingBytes([]) }), false); await h.cap.observe(h.lease);
    const borrowed = borrowNativeCombinedHeldHost(h.cap, h.lease); if (!borrowed.ok) throw new Error("fixture");
    const cap = borrowed.capability; cap.beginRun?.(); const row = { key: KEY_SESSION, value: BASE_SOURCE[KEY_SESSION] };
    const tx = cap.seal?.({ kind: "checkpoint", recordBefore: copyingBytes([]), recordAfter: copyingBytes([KEY_SESSION]), rows: [row] }, "checkpoint", isSyntheticFingerprint);
    if (!tx || tx.kind !== "checkpoint") throw new Error("fixture"); row.value = "later mutation";
    expect(Object.isFrozen(tx.rows)).toBe(true); expect(Object.isFrozen(tx.rows[0])).toBe(true);
    expect(await cap.target.transact(h.lease, tx)).toEqual({ status: "confirmed" });
    const raw = await h.raw({ kind: "query", sql: `SELECT value FROM records WHERE key=${literal(KEY_SESSION)};` }) as { values: { value: string }[] };
    expect(raw.values).toEqual([{ value: BASE_SOURCE[KEY_SESSION] }]); cap.endRun?.();
  });
  it("an older confirmed initializer cannot certify a superseding reopen without fresh observation", async () => {
    const h = await setup(platform, {}, [], false); let reopen: Promise<unknown> | undefined;
    h.faults.hook = async (event, next) => { const result = await next(); if (event.kind === "commit" && !reopen) reopen = h.cap.reopen(h.lease); return result; };
    expect(await h.cap.initializeEmpty(h.lease)).toEqual({ status: "confirmed" }); await reopen;
    expect(h.make()).toEqual({ ok: false, reason: "schema_unproven" }); h.faults.hook = undefined;
    await h.cap.observe(h.lease); expect((await h.child().run()).outcome).toBe("held");
  });
  it("uncertain failed-open cleanup blocks new host work until positive parent reopen", async () => {
    const h = await setup(platform, {}, [], false); let creates = 0;
    h.faults.hook = async (event, next) => { if (event.kind === "open") { creates++; throw new Error("open"); } if (event.kind === "close") throw new Error("release"); return next(); };
    expect(await h.cap.initializeEmpty(h.lease)).toMatchObject({ status: "not_begun" });
    expect(await h.cap.observe(h.lease)).toEqual({ ok: false, reason: "requires_reopen" }); expect(creates).toBe(1);
    h.faults.hook = undefined; await h.cap.reopen(h.lease); expect(await h.cap.initializeEmpty(h.lease)).toEqual({ status: "confirmed" });
    expect((await h.child().run()).outcome).toBe("held");
  });
  it("refuses async format output and owns its rejection after synchronous supersession", async () => {
    const h = await setup(platform), borrowed = borrowNativeCombinedHeldHost(h.cap, h.lease); if (!borrowed.ok) throw new Error("fixture");
    const cap = borrowed.capability; cap.beginRun?.(); let reopen: Promise<unknown> | undefined;
    const format = (() => { reopen = h.cap.reopen(h.lease); const result = Promise.reject(new Error("private predicate reason")); Object.defineProperty(result, "then", { value: undefined }); return result; }) as unknown as NativeMigrationRunnerDependencies["isWellFormedFingerprint"];
    expect(cap.seal?.({ kind: "replace_record", recordBefore: "before", recordAfter: verifiedBytes(), requireNoApplicationRows: false }, "complete_copying", format)).toBeNull();
    cap.endRun?.(); await reopen; await Promise.resolve();
  });
  it("a borrowed collector also closes rejected asynchronous format dependencies", async () => {
    const h = await setup(platform, { ...BASE_SOURCE, [MARKER_KEY]: STORE_A }, combinedRows({ ...BASE_SOURCE, [D]: verifiedBytes() }), false);
    await h.cap.observe(h.lease);
    const format = (() => Promise.reject(new Error("private predicate reason"))) as unknown as NativeMigrationRunnerDependencies["isWellFormedFingerprint"];
    expect((await h.child({ isWellFormedFingerprint: format }).run()).outcome).not.toBe("held"); await Promise.resolve();
  });
  it("a newer failed parent reopen cannot inherit an older successful receipt", async () => {
    const h = await setup(platform), child = h.child(); await child.run(); let closes = 0;
    h.faults.hook = async (event, next) => { if (event.kind === "close" && ++closes === 3) throw new Error("release unavailable"); return next(); };
    const first = h.cap.reopen(h.lease), second = h.cap.reopen(h.lease); expect(await first).toMatchObject({ ok: true }); expect(await second).toMatchObject({ ok: false });
    expect((await child.run()).outcome).toBe("parent_recovery_required"); h.faults.hook = undefined; await h.cap.reopen(h.lease);
    expect((await child.run()).outcome).toBe("held");
  });
  for (const latchOutcome of ["failed", "confirmed"] as const) it(`parent observations preserve the first fault and ${latchOutcome} latch budget across recovery`, async () => {
    const h = await setup(platform, { ...BASE_SOURCE }), child = h.child({ limits: { ...LIMITS, latchWriteAttemptLimit: 1 } });
    expect((await child.run()).outcome).toBe("held");
    const before = await h.cap.observe(h.lease); if (!before.ok || before.record.status !== "present") throw new Error("fixture");
    await h.raw({ kind: "execute", sql: `UPDATE records SET value='contradiction' WHERE key=${literal(D)};` });
    const writes: unknown[] = [];
    h.faults.hook = async (event, next) => {
      if (event.kind === "run" && event.values?.[0] === L) {
        writes.push(event.values[1]);
        if (latchOutcome === "failed") throw new Error("injected latch failure");
      }
      return next();
    };
    const first = await child.run(); if (first.outcome !== "fault") throw new Error(JSON.stringify(first));
    expect(first.latch.attempts).toHaveLength(1); expect(first.latch.attemptsRemain).toBe(false);
    for (let recovery = 0; recovery < 3; recovery++) {
      expect(await h.cap.reopen(h.lease)).toMatchObject({ ok: true });
      // Later, different evidence must not replace the first findings or budget.
      if (recovery === 1) {
        await h.raw({ kind: "execute", sql: `UPDATE records SET value=${literal(before.record.bytes)} WHERE key=${literal(D)};` });
        await h.raw({ kind: "execute", sql: `DELETE FROM records WHERE key=${literal(KEY_SESSION)};` });
      }
      expect(await h.cap.observe(h.lease)).toMatchObject({ ok: true });
      expect(await child.run()).toMatchObject({ outcome: "fault", findings: first.findings, latch: first.latch });
    }
    expect(writes).toHaveLength(1); expect(await child.dispose()).toEqual({ ok: false, reason: "fault_stop_held" });
  });
  for (const loss of ["meta", "all"] as const) it(`retains known initialized schema loss (${loss}) and refuses rebootstrap`, async () => {
    const h = await setup(platform); await h.cap.observe(h.lease);
    await h.raw({ kind: "execute", sql: "DROP TABLE curling_credential_meta;" });
    if (loss === "all") await h.raw({ kind: "execute", sql: "DROP TABLE records;" });
    expect(await h.cap.observe(h.lease)).toMatchObject({ ok: true, layout: loss === "meta" ? "records" : "empty", schema: { status: "absent" } });
    expect(h.make()).toEqual({ ok: false, reason: "schema_unproven" });
    expect(await h.cap.release(h.lease)).toEqual({ ok: false, reason: "control_evidence_held" });
    expect(await h.cap.reopen(h.lease)).toMatchObject({ ok: true });
    const before = h.trace.length;
    expect(await h.cap.initializeEmpty(h.lease)).toEqual({ status: "refused", reason: "control_evidence_held" });
    expect(h.trace).toHaveLength(before);
  });
  it("first legacy observation is not fabricated into a previous schema-loss fault", async () => {
    const h = await setup(platform, {}, [CREATE], false);
    expect(await h.cap.observe(h.lease)).toMatchObject({ ok: true, layout: "records", schema: { status: "absent" } });
    expect(h.make()).toEqual({ ok: false, reason: "schema_unproven" });
    expect(await h.cap.initializeEmpty(h.lease)).toEqual({ status: "confirmed" });
    expect((await h.child().run()).outcome).toBe("held");
  });
  for (const reopenFirst of [false, true]) for (const loss of ["meta", "all"] as const) it(`initializer itself retains prior schema loss (${loss}, reopen=${reopenFirst}) before BEGIN`, async () => {
    const h = await setup(platform);
    await h.raw({ kind: "execute", sql: "DROP TABLE curling_credential_meta;" });
    if (loss === "all") await h.raw({ kind: "execute", sql: "DROP TABLE records;" });
    if (reopenFirst) expect(await h.cap.reopen(h.lease)).toMatchObject({ ok: true });
    const before = h.trace.length;
    expect(await h.cap.initializeEmpty(h.lease)).toEqual({ status: "refused", reason: "control_evidence_held" });
    expect(h.trace.slice(before).some(event => event.kind === "begin" || event.kind === "execute" || event.kind === "run")).toBe(false);
    expect(h.make()).toEqual({ ok: false, reason: "schema_unproven" });
    expect(await h.cap.release(h.lease)).toEqual({ ok: false, reason: "control_evidence_held" });
    expect(await h.cap.reopen(h.lease)).toMatchObject({ ok: true });
    const after = h.trace.length;
    expect(await h.cap.initializeEmpty(h.lease)).toEqual({ status: "refused", reason: "control_evidence_held" }); expect(h.trace).toHaveLength(after);
  });
  it("stale favorable schema read cannot certify a superseding parent reopen", async () => {
    const h = await setup(platform); let once = true, reopen: Promise<unknown> | undefined;
    h.faults.hook = async (event, next) => {
      const result = await next();
      if (once && event.kind === "query" && event.sql?.startsWith("SELECT value FROM curling_credential_meta") && event.values?.[0] === "schema") {
        once = false; reopen = h.cap.reopen(h.lease);
      }
      return result;
    };
    expect(await h.cap.observe(h.lease)).toEqual({ ok: false, reason: "cancelled" }); expect(reopen).toBeDefined();
    expect(await reopen).toMatchObject({ ok: true }); expect(h.make()).toEqual({ ok: false, reason: "schema_unproven" });
    h.faults.hook = undefined; await h.cap.observe(h.lease); expect((await h.child().run()).outcome).toBe("held");
  });
  it("stale positive schema contradiction survives the superseding reopen", async () => {
    const h = await setup(platform); await h.raw({ kind: "execute", sql: "UPDATE curling_credential_meta SET value='invalid' WHERE slot='schema';" });
    let once = true, reopen: Promise<unknown> | undefined;
    h.faults.hook = async (event, next) => {
      const result = await next();
      if (once && event.kind === "query" && event.sql?.startsWith("SELECT value FROM curling_credential_meta") && event.values?.[0] === "schema") {
        once = false; reopen = h.cap.reopen(h.lease);
      }
      return result;
    };
    expect(await h.cap.observe(h.lease)).toEqual({ ok: false, reason: "cancelled" }); await reopen;
    h.faults.hook = undefined; await h.raw({ kind: "execute", sql: `UPDATE curling_credential_meta SET value=${literal(MARKER)} WHERE slot='schema';` });
    await h.cap.observe(h.lease); expect((await h.child().run()).outcome).not.toBe("held");
    expect(await h.cap.release(h.lease)).toEqual({ ok: false, reason: "control_evidence_held" });
  });
});
