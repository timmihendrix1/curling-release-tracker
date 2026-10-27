// S3f: real disposable SQLite; protected storage and bridge failures are injected.
// Reloaded modules below model a NEW JS process only after all old work settles.
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeCommonMigrationOptions, NativeCommonMigrationOwner } from "../nativeCombinedMigrationOwner";
import { combinedFixture, disposeCombinedFixtures, D } from "./nativeCombinedHeldSqliteTestEngine";
import { SyntheticStorage, LIMITS, syntheticUuid, SYNTHETIC_NOW } from "./nativeMigrationMTestKit";
import { BASE_SOURCE, KEY_SESSION, fp, isSyntheticFingerprint } from "./nativeMigrationTestKit";
import { credentialManifestSlot, credentialItemSlot } from "../credentialPhysicalSlots";
import { parseQ, parseI, serializeI } from "../credentialProtocol";
const root = "sb-fixture-auth-token", config = "pc1:fixture";
const session = '{"access_token":"SYNTHETIC_ACCESS","refresh_token":"SYNTHETIC_REFRESH","expires_at":100,"expires_in":1,"token_type":"bearer"}';
const hash = (_purpose: string, key: string, raw: string) => createHash("sha256").update(JSON.stringify(["credential-value/v1", key, raw])).digest("hex");
const hashFormat = (value: string) => /^[0-9a-f]{64}$/.test(value);
const unwrap = <T,>(r: { ok: true; value: T } | { ok: false }): T => { if (!r.ok) throw new Error("fixture"); return r.value; };
type Event = { kind: string; key?: string; value?: string };
const unblocks: (() => void)[] = [];
const owners: NativeCommonMigrationOwner[] = [];
afterEach(async () => { while (unblocks.length) unblocks.pop()!(); for (const owner of owners.splice(0)) await owner.dispose(); await disposeCombinedFixtures(); vi.unstubAllGlobals(); });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); unblocks.push(resolve); return { promise, resolve }; }
async function fixture(platform: "ios" | "android", initial: Record<string, string> = {}, changes: Partial<NativeCommonMigrationOptions> = {}) {
  vi.resetModules();
  const h = await combinedFixture(platform); expect(await h.cap.release(h.lease)).toEqual({ ok: true });
  const storage = new SyntheticStorage(initial); vi.stubGlobal("localStorage", storage);
  const values = new Map<string, string>(), trace: Event[] = [];
  const faults: { hook?: (event: Event, next: () => Promise<unknown>) => Promise<unknown> } = {};
  const invoke = (event: Event, next: () => Promise<unknown>) => { trace.push(event); return faults.hook ? faults.hook(event, next) : next(); };
  const binding = {
    failedWriteMayLosePreviousValue: true,
    configure: async () => invoke({ kind: "configure" }, async () => undefined),
    inventory: async () => invoke({ kind: "inventory" }, async () => ({ kind: "complete", keys: [...values.keys()].sort() })),
    read: async (key: string) => invoke({ kind: "read", key }, async () => values.has(key) ? { kind: "value", value: values.get(key) } : { kind: "established_absent" }),
    write: async (key: string, value: string) => invoke({ kind: "write", key, value }, async () => { values.set(key, value); }),
    remove: async (key: string) => invoke({ kind: "remove", key }, async () => { values.delete(key); }),
  };
  const options: NativeCommonMigrationOptions = { sqlite: { ...h.options, detectPlatform: () => "ios" }, providerConfigIdentity: config, sessionStorageKey: root,
    protectedBinding: binding, detectPlatform: () => "ios", domainFingerprint: fp, domainFingerprintFormat: isSyntheticFingerprint,
    credentialFingerprint: hash, credentialFingerprintFormat: hashFormat, generateUuid: syntheticUuid, now: () => SYNTHETIC_NOW,
    limits: { ...LIMITS, protocolStepLimit: 100, faultWriteAttemptLimit: 1 }, ...changes };
  const make = async (override: Partial<NativeCommonMigrationOptions> = {}) => {
    const ownerModule = await import("../nativeCombinedMigrationOwner"); const made = ownerModule.createNativeCombinedMigrationOwner({ ...options, ...override });
    if (!made.ok) throw new Error(made.reason); owners.push(made.owner); return made.owner;
  };
  const owner = await make();
  async function q() {
    const observed = await h.raw({ kind: "query", sql: "SELECT value FROM curling_credential_meta WHERE slot='q';" }) as { values: { value: string }[] };
    return observed.values.length ? unwrap(parseQ(observed.values[0].value)) : null;
  }
  async function until(phase: string) {
    for (let attempt = 0; attempt < 30; attempt++) {
      const result = await owner.run(); expect(["incomplete", "candidate"]).toContain(result.outcome);
      const current = await q(); if (current?.phase === phase) return current;
    }
    throw new Error("phase not reached");
  }
  return { ...h, storage, values, protectedTrace: trace, protectedFaults: faults, options, make, owner, q, until };
}

for (const platform of ["ios", "android"] as const) describe(`${platform} plugin preprocessing / dormant iOS common executor`, () => {
  it("completes fresh empty D1 with every Q phase and an actual empty protected manifest", async () => {
    const h = await fixture(platform); expect(h.protectedTrace).toEqual([]); expect(h.storage.lengthReads).toBe(0);
    const report = await h.owner.run(); expect(report.outcome, JSON.stringify(report)).toBe("candidate");
    if (report.outcome !== "candidate") throw new Error("fixture");
    expect(h.owner.isCurrentCandidate(report.candidate)).toBe(true); expect(h.owner.isCurrentCandidate({ ...report.candidate })).toBe(false);
    expect((await h.q())?.phase).toBe("bound");
    const m = JSON.parse(h.values.get(unwrap(credentialManifestSlot(config)))!); expect(m.items).toEqual([]); expect(m.fixedSlots.map((slot: { presence: string }) => slot.presence)).toEqual(Array(4).fill("absent"));
    const phases = h.trace.filter(e => e.kind === "run").flatMap(e => e.values ?? []).filter(v => typeof v === "string" && v.includes('"protocolId"')).map(raw => parseQ(raw)).filter(q => q.ok).map(q => q.ok ? q.value.phase : "invalid");
    expect(phases).toEqual(expect.arrayContaining(["intent", "manifest_confirmed", "copying", "credentials_verified", "bound"]));
    expect(await h.owner.dispose()).toEqual({ ok: false, reason: "evidence_held" }); expect(h.owner.isCurrentCandidate(report.candidate)).toBe(false);
  });
  it("copies full domain and credentials exactly, preserves source and binds the same SID", async () => {
    const h = await fixture(platform, { ...BASE_SOURCE, [root]: session, [root + "-code-verifier"]: JSON.stringify("a".repeat(43)) });
    const report = await h.owner.run(); expect(report.outcome, JSON.stringify(report)).toBe("candidate");
    const q = await h.q(); if (!q) throw new Error("fixture");
    const rows = await h.raw({ kind: "query", sql: "SELECT key,value FROM records;" }) as { values: { key: string; value: string }[] };
    const d = JSON.parse(rows.values.find(row => row.key === D)!.value); expect(d.phase).toBe("active"); expect(q.storeIdentity).toBe(d.storeIdentity);
    for (const [key, value] of Object.entries(BASE_SOURCE)) expect(rows.values.find(row => row.key === key)?.value).toBe(value);
    const item = unwrap(parseI(h.values.get(unwrap(credentialItemSlot(config, root, q.credentialEpochId, root))), root, q)); expect(item.value).toBe(session);
    expect(h.storage.map.get(root)).toBe(session); expect(h.protectedTrace.filter(e => e.kind === "write")).toHaveLength(3);
  });
  it("joins concurrent runs and retains ownership through a real pending protected write", async () => {
    const h = await fixture(platform, { [root]: session }), entered = deferred(), release = deferred(); let once = true;
    h.protectedFaults.hook = async (event, next) => { if (event.kind === "write" && once) { once = false; entered.resolve(); await release.promise; } return next(); };
    const first = h.owner.run(); expect(h.owner.run()).toBe(first); await entered.promise;
    const ordinary = await import("../secureCredentialStore");
    const store = ordinary.createNativeSecureCredentialStore({ binding: h.options.protectedBinding as never, detectPlatform: () => "ios" });
    const before = h.protectedTrace.length; expect((await store.read("session")).status).toBe("read_failed"); expect(h.protectedTrace).toHaveLength(before);
    release.resolve(); expect((await first).outcome).toBe("candidate");
  });
  for (const phase of ["intent", "manifest_confirmed", "copying", "credentials_verified"]) for (const domain of [false, true]) it(`cold restart ${phase}, domain=${domain}, retains the actual expected SID`, async () => {
    const h = await fixture(platform, { ...(domain ? BASE_SOURCE : {}), [root]: session }, { limits: { ...LIMITS, protocolStepLimit: 1, faultWriteAttemptLimit: 1 } });
    const before = await h.until(phase); expect(before.expectedStoreIdentity).toBeDefined();
    expect(await h.owner.dispose()).toEqual({ ok: false, reason: "evidence_held" });
    await h.raw({ kind: "close" }); vi.resetModules();
    const restarted = await h.make({ limits: { ...LIMITS, protocolStepLimit: 100, faultWriteAttemptLimit: 1 } });
    const result = await restarted.run(); expect(result.outcome, JSON.stringify(result)).toBe("candidate");
    expect((await h.q())?.storeIdentity).toBe(before.expectedStoreIdentity);
  });
  for (const lostPhase of ["intent", "manifest_confirmed", "copying", "credentials_verified", "bound"]) it(`classifies actual SQL after-state after lost ${lostPhase} COMMIT acknowledgement`, async () => {
    const h = await fixture(platform, { ...BASE_SOURCE, [root]: session }); let pending = false, injected = false;
    h.faults.hook = async (event, next) => {
      if (!injected && event.kind === "run") for (const value of event.values ?? []) {
        const q = parseQ(value); if (q.ok && q.value.phase === lostPhase) pending = true;
      }
      const result = await next();
      if (pending && !injected && event.kind === "commit") { injected = true; throw new Error("lost synthetic SQL acknowledgement"); }
      return result;
    };
    expect(await h.owner.run()).toEqual({ outcome: "recovery_required", boundary: "sql" }); expect(injected).toBe(true);
    h.faults.hook = undefined;
    const reads = h.storage.valueReads.length, lengths = h.storage.lengthReads;
    if (lostPhase === "bound") { h.storage.faults.lengthThrows = true; h.storage.faults.getItemThrows = () => true; }
    expect(await h.owner.recover()).toEqual({ outcome: "recovered" });
    const result = await h.owner.run(); expect(result.outcome, JSON.stringify(result)).toBe("candidate");
    if (lostPhase === "bound") { expect(h.storage.valueReads).toHaveLength(reads); expect(h.storage.lengthReads).toBe(lengths); }
    expect((await h.q())?.phase).toBe("bound");
  });
  for (const slotKind of ["manifest", "item"] as const) it(`recovers applied ${slotKind} write with lost acknowledgement under a NEW protected lease`, async () => {
    const h = await fixture(platform, { [root]: session }); let injected = false;
    h.protectedFaults.hook = async (event, next) => {
      const result = await next();
      if (!injected && event.kind === "write" && event.key?.startsWith(slotKind === "manifest" ? "m1." : "i1.")) { injected = true; throw new Error("lost synthetic protected acknowledgement"); }
      return result;
    };
    expect(await h.owner.run()).toEqual({ outcome: "recovery_required", boundary: "protected" });
    const before = h.protectedTrace.length; expect(await h.owner.run()).toEqual({ outcome: "recovery_required", boundary: "protected" }); expect(h.protectedTrace).toHaveLength(before);
    h.protectedFaults.hook = undefined; expect(await h.owner.recover()).toEqual({ outcome: "recovered" });
    const result = await h.owner.run(); expect(result.outcome, JSON.stringify(result)).toBe("candidate");
    expect(h.protectedTrace.filter(event => event.kind === "write" && event.key?.startsWith(slotKind === "manifest" ? "m1." : "i1."))).toHaveLength(1);
  });
  it("final synchronous source fence prevents COMMIT after source changes during the last SQL await", async () => {
    const h = await fixture(platform, { ...BASE_SOURCE, [root]: session }); let finalizing = false, changed = false, finalCommits = 0;
    h.faults.hook = async (event, next) => {
      if (event.kind === "run" && (event.values ?? []).some(value => { const q = parseQ(value); return q.ok && q.value.phase === "bound"; })) finalizing = true;
      const result = await next();
      if (finalizing && !changed && event.kind === "query" && event.values?.[0] === KEY_SESSION) { changed = true; h.storage.map.set(root, session + " "); }
      if (event.kind === "commit" && finalizing) finalCommits++;
      if (event.kind === "rollback") finalizing = false;
      return result;
    };
    const result = await h.owner.run(); expect(result.outcome).toBe("fault"); expect(changed).toBe(true); expect(finalCommits).toBe(0);
    expect((await h.q())?.phase).toBe("credentials_verified");
  });
  it("bound observation reads neither old source, permits changed runtime values and a positively absent session", async () => {
    const h = await fixture(platform, { ...BASE_SOURCE, [root]: session }); expect((await h.owner.run()).outcome).toBe("candidate");
    const q = (await h.q())!, reads = h.storage.valueReads.length, lengths = h.storage.lengthReads;
    h.values.delete(unwrap(credentialItemSlot(config, root, q.credentialEpochId, root)));
    const flowKey = root + "-flow-runtime1-code-verifier";
    const raw = unwrap(serializeI({ schemaVersion: 1, protocolId: q.protocolId, credentialEpochId: q.credentialEpochId, originManifestId: q.manifestId,
      providerConfigIdentity: config, sdkContractVersion: q.sdkContractVersion, key: flowKey, value: JSON.stringify("b".repeat(43)) }, root));
    h.values.set(unwrap(credentialItemSlot(config, root, q.credentialEpochId, flowKey)), raw);
    await h.raw({ kind: "run", sql: "UPDATE records SET value=? WHERE key=?;", values: [BASE_SOURCE[KEY_SESSION] + " ", KEY_SESSION] });
    h.storage.faults.lengthThrows = true; h.storage.faults.getItemThrows = () => true;
    const result = await h.owner.run(); expect(result.outcome, JSON.stringify(result)).toBe("candidate");
    expect(h.storage.valueReads).toHaveLength(reads); expect(h.storage.lengthReads).toBe(lengths);
  });
  it("retains known missing M before a later read could fail and never overwrites it", async () => {
    const h = await fixture(platform, { [root]: session }, { limits: { ...LIMITS, protocolStepLimit: 1, faultWriteAttemptLimit: 1 } }); await h.until("copying");
    const mSlot = unwrap(credentialManifestSlot(config)); h.values.delete(mSlot);
    const beforeWrites = h.protectedTrace.filter(event => event.kind === "write").length;
    h.protectedFaults.hook = async (event, next) => { if (event.kind === "read" && event.key === mSlot) throw new Error("later unavailable read"); return next(); };
    expect(await h.owner.run()).toMatchObject({ outcome: "fault", code: "protected_evidence_lost" });
    expect(h.protectedTrace.filter(event => event.kind === "write")).toHaveLength(beforeWrites);
  });
  it("retains the bounded F write attempt budget through explicit recovery", async () => {
    const h = await fixture(platform, { [root]: session }, { limits: { ...LIMITS, protocolStepLimit: 1, faultWriteAttemptLimit: 1 } }); await h.until("copying");
    h.values.delete(unwrap(credentialManifestSlot(config))); let writes = 0;
    h.faults.hook = async (event, next) => { if (event.kind === "run" && event.values?.[0] === "f") { writes++; throw new Error("fault persistence unavailable"); } return next(); };
    expect(await h.owner.run()).toMatchObject({ outcome: "fault", faultWriteAttempts: 1 });
    for (let retry = 0; retry < 3; retry++) { await h.owner.recover(); expect(await h.owner.run()).toMatchObject({ outcome: "fault", faultWriteAttempts: 1 }); }
    expect(writes).toBe(1);
  });
  for (const phase of ["intent", "copying", "bound"]) it(`reopens and retries only a freshly proved SQL before-state (${phase})`, async () => {
    const h = await fixture(platform, { [root]: session }); let pending = false, injected = false;
    h.faults.hook = async (event, next) => {
      if (!injected && event.kind === "run") for (const raw of event.values ?? []) { const q = parseQ(raw); if (q.ok && q.value.phase === phase) pending = true; }
      if (pending && !injected && event.kind === "commit") { injected = true; throw new Error("commit did not apply"); }
      return next();
    };
    expect(await h.owner.run()).toEqual({ outcome: "recovery_required", boundary: "sql" });
    h.faults.hook = undefined; expect(await h.owner.recover()).toEqual({ outcome: "recovered" });
    const result = await h.owner.run(); expect(result.outcome, JSON.stringify(result)).toBe("candidate");
  });
  it("refuses a mixed final tuple after an actually applied unknown COMMIT without old-source reads", async () => {
    const h = await fixture(platform, { [root]: session }); let beforeQ: string | null = null, final = false;
    h.faults.hook = async (event, next) => {
      if (event.kind === "run" && event.values?.[1] === "q") { const q = parseQ(event.values[0]); if (q.ok && q.value.phase === "bound") { final = true; beforeQ = event.values[2] as string; } }
      const result = await next(); if (final && event.kind === "commit") { final = false; throw new Error("lost final acknowledgement"); } return result;
    };
    expect(await h.owner.run()).toEqual({ outcome: "recovery_required", boundary: "sql" }); expect(beforeQ).not.toBeNull();
    h.faults.hook = undefined; await h.owner.recover();
    await h.raw({ kind: "run", sql: "UPDATE curling_credential_meta SET value=? WHERE slot='q';", values: [beforeQ] });
    const reads = h.storage.valueReads.length, lengths = h.storage.lengthReads; h.storage.faults.lengthThrows = true; h.storage.faults.getItemThrows = () => true;
    expect(await h.owner.run()).toMatchObject({ outcome: "fault", code: "sql_evidence_mismatch" });
    expect(h.storage.valueReads).toHaveLength(reads); expect(h.storage.lengthReads).toBe(lengths);
  });
  it("preserves a known Q loss before a later target read failure", async () => {
    const h = await fixture(platform, { ...BASE_SOURCE, [root]: session }, { limits: { ...LIMITS, protocolStepLimit: 1, faultWriteAttemptLimit: 1 } }); await h.until("copying");
    await h.raw({ kind: "run", sql: "DELETE FROM curling_credential_meta WHERE slot='q';" });
    h.faults.hook = async (event, next) => { if (event.kind === "query" && event.values?.[0] === KEY_SESSION) throw new Error("later row unavailable"); return next(); };
    expect(await h.owner.run()).toMatchObject({ outcome: "fault", code: "sql_evidence_mismatch" });
    h.faults.hook = undefined; await h.owner.recover(); expect((await h.owner.run()).outcome).toBe("fault");
  });
  for (const unknown of ["legacy_sdk_key", "i1.unknown", "m1.0f.pc1:another"]) it(`preserves unsupported namespace residue ${unknown} without source reads or overwrite`, async () => {
    const h = await fixture(platform, { [root]: session }); h.values.set(unknown, "preserve");
    const result = await h.owner.run(); expect(result.outcome).toBe("fault"); expect(h.values.get(unknown)).toBe("preserve");
    expect(h.storage.lengthReads).toBe(0); expect(h.storage.valueReads).toEqual([]); expect(h.protectedTrace.some(event => event.kind === "write")).toBe(false);
  });
  it("allows same-key source value changes before M is first frozen", async () => {
    const h = await fixture(platform, { [root]: session }, { limits: { ...LIMITS, protocolStepLimit: 1, faultWriteAttemptLimit: 1 } }); await h.until("intent");
    const changed = session + " "; h.storage.map.set(root, changed);
    const restartedOptions = { limits: { ...LIMITS, protocolStepLimit: 100, faultWriteAttemptLimit: 1 } };
    await h.owner.dispose(); await h.raw({ kind: "close" }); vi.resetModules(); const restarted = await h.make(restartedOptions);
    expect((await restarted.run()).outcome).toBe("candidate");
    const q = (await h.q())!, item = unwrap(parseI(h.values.get(unwrap(credentialItemSlot(config, root, q.credentialEpochId, root))), root, q)); expect(item.value).toBe(changed);
  });
  it("never re-freezes source content after M exists", async () => {
    const h = await fixture(platform, { [root]: session }, { limits: { ...LIMITS, protocolStepLimit: 1, faultWriteAttemptLimit: 1 } }); await h.until("copying");
    const slot = unwrap(credentialManifestSlot(config)), before = h.values.get(slot); h.storage.map.set(root, session + " ");
    expect(await h.owner.run()).toMatchObject({ outcome: "fault", code: "source_changed" }); expect(h.values.get(slot)).toBe(before);
  });
  it("requires new full proofs for a final SQL-before retry when the old source changed", async () => {
    const h = await fixture(platform, { [root]: session }); let final = false, injected = false;
    h.faults.hook = async (event, next) => {
      if (event.kind === "run" && (event.values ?? []).some(value => { const q = parseQ(value); return q.ok && q.value.phase === "bound"; })) final = true;
      if (final && !injected && event.kind === "commit") { injected = true; throw new Error("no commit"); } return next();
    };
    expect(await h.owner.run()).toEqual({ outcome: "recovery_required", boundary: "sql" }); h.faults.hook = undefined;
    await h.owner.recover(); h.storage.map.set(root, session + " ");
    expect(await h.owner.run()).toMatchObject({ outcome: "fault", code: "source_changed" }); expect((await h.q())?.phase).toBe("credentials_verified");
  });
  for (const change of ["add", "value", "marker"] as const) it(`retains post-Intent domain source contradiction (${change}) even if later restored`, async () => {
    const h = await fixture(platform, { ...(change === "add" ? {} : BASE_SOURCE), [root]: session }, { limits: { ...LIMITS, protocolStepLimit: 1, faultWriteAttemptLimit: 1 } });
    await h.until("credentials_verified");
    const marker = "curling.nativeMigration.sourceMarker.v1", old = new Map(h.storage.map);
    if (change === "add") h.storage.map.set(KEY_SESSION, BASE_SOURCE[KEY_SESSION]);
    else if (change === "value") h.storage.map.set(KEY_SESSION, BASE_SOURCE[KEY_SESSION] + " ");
    else h.storage.map.set(marker, "changed");
    expect((await h.owner.run()).outcome).toBe("fault");
    h.storage.map.clear(); for (const [key, value] of old) h.storage.map.set(key, value);
    expect((await h.owner.run()).outcome).toBe("fault");
  });
  for (const statement of ["domain", "q"] as const) for (const failure of ["throw", "zero_ack"] as const) it(`rolls back BOTH final controls after ${statement} ${failure}`, async () => {
    const h = await fixture(platform, { ...BASE_SOURCE, [root]: session }); let injected = false;
    h.faults.hook = async (event, next) => {
      const selected = event.kind === "run" && (event.values ?? []).some(value => {
        if (typeof value !== "string") return false;
        if (statement === "q") { const q = parseQ(value); return q.ok && q.value.phase === "bound"; }
        try { return JSON.parse(value).phase === "active"; } catch { return false; }
      });
      if (!injected && selected) {
        injected = true;
        if (failure === "throw") throw new Error("synthetic final statement failure");
        await next(); return { changes: { changes: 0 } };
      }
      return next();
    };
    expect(await h.owner.run()).toEqual({ outcome: "recovery_required", boundary: "sql" }); expect(injected).toBe(true);
    expect((await h.q())?.phase).toBe("credentials_verified");
    const rows = await h.raw({ kind: "query", sql: "SELECT value FROM records WHERE key=?;", values: [D] }) as { values: { value: string }[] };
    expect(JSON.parse(rows.values[0].value).phase).toBe("verified");
    h.faults.hook = undefined; expect(await h.owner.recover()).toEqual({ outcome: "recovered" });
    expect((await h.owner.run()).outcome).toBe("candidate");
  });
  it("disposal while a real protected read is pending issues no later write and waits for settlement", async () => {
    const h = await fixture(platform, { [root]: session }), entered = deferred(), release = deferred(); let once = true;
    h.protectedFaults.hook = async (event, next) => { if (event.kind === "read" && once) { once = false; entered.resolve(); await release.promise; } return next(); };
    const running = h.owner.run(); await entered.promise; const writes = h.protectedTrace.filter(event => event.kind === "write").length;
    let settled = false; const disposing = h.owner.dispose().then(result => { settled = true; return result; }); await Promise.resolve(); expect(settled).toBe(false);
    release.resolve(); expect((await running).outcome).toBe("disposed"); expect(await disposing).toEqual({ ok: false, reason: "evidence_held" });
    expect(h.protectedTrace.filter(event => event.kind === "write")).toHaveLength(writes);
  });
  it("rejects a bound envelope whose key differs from its physical slot", async () => {
    const h = await fixture(platform, { [root]: session }); expect((await h.owner.run()).outcome).toBe("candidate"); const q = (await h.q())!;
    const key = root + "-flow-wrongkey-code-verifier";
    const raw = unwrap(serializeI({ schemaVersion: 1, protocolId: q.protocolId, credentialEpochId: q.credentialEpochId, originManifestId: q.manifestId,
      providerConfigIdentity: config, sdkContractVersion: q.sdkContractVersion, key, value: JSON.stringify("a".repeat(43)) }, root));
    h.values.set(unwrap(credentialItemSlot(config, root, q.credentialEpochId, root)), raw);
    expect(await h.owner.run()).toMatchObject({ outcome: "fault", code: "pairing_mismatch" });
  });
  it("retains a cold complete credential key contradiction before a later payload read fails", async () => {
    const h = await fixture(platform, { [root]: session }, { limits: { ...LIMITS, protocolStepLimit: 1, faultWriteAttemptLimit: 1 } }); await h.until("copying");
    await h.owner.dispose(); await h.raw({ kind: "close" }); vi.resetModules();
    const extra = root + "-code-verifier"; h.storage.map.set(extra, JSON.stringify("a".repeat(43))); h.storage.faults.getItemThrows = key => key === root;
    const restarted = await h.make({ limits: { ...LIMITS, protocolStepLimit: 100, faultWriteAttemptLimit: 1 } });
    expect(await restarted.run()).toMatchObject({ outcome: "fault", code: "source_changed" });
    h.storage.map.delete(extra); h.storage.faults.getItemThrows = () => false;
    expect(await restarted.run()).toMatchObject({ outcome: "fault", code: "source_changed" });
  });
  it("retains positive F from inside the SQL before-tuple through rollback and recovery", async () => {
    const h = await fixture(platform, { [root]: session }, { limits: { ...LIMITS, protocolStepLimit: 1, faultWriteAttemptLimit: 1 } }); await h.until("manifest_confirmed");
    let inTx = false, injected = false;
    h.faults.hook = async (event, next) => { if (event.kind === "begin") inTx = true;
      if (inTx && !injected && event.kind === "query" && event.values?.[0] === "f") { injected = true; return { values: [{ value: "positively observed fault" }] }; } return next(); };
    expect(await h.owner.run()).toMatchObject({ outcome: "fault", code: "sql_evidence_mismatch" }); expect(injected).toBe(true);
    h.faults.hook = undefined; await h.owner.recover(); expect((await h.owner.run()).outcome).toBe("fault");
  });
  it("reobserves a clean SQL before-state under the actual reopened lifecycle", async () => {
    const h = await fixture(platform, { [root]: session }, { limits: { ...LIMITS, protocolStepLimit: 1, faultWriteAttemptLimit: 1 } }); await h.until("manifest_confirmed");
    let inTx = false, injected = false;
    h.faults.hook = async (event, next) => { if (event.kind === "begin") inTx = true;
      if (inTx && !injected && event.kind === "query" && event.values?.[0] === "f") { injected = true; throw new Error("temporary SQL read failure"); } return next(); };
    expect((await h.owner.run()).outcome).toBe("recovery_required"); h.faults.hook = undefined;
    const before = h.trace.length; expect((await h.owner.recover()).outcome).toBe("recovered");
    let result = await h.owner.run(); for (let n = 0; n < 20 && result.outcome === "incomplete"; n++) result = await h.owner.run();
    expect(result.outcome).toBe("candidate"); expect(h.trace.slice(before).some(event => event.kind === "begin")).toBe(true);
  });
  it("issues no fault BEGIN/write after disposal inside a preceding SQL fault read", async () => {
    const h = await fixture(platform, { [root]: session }, { limits: { ...LIMITS, protocolStepLimit: 1, faultWriteAttemptLimit: 1 } }); await h.until("copying");
    h.values.delete(unwrap(credentialManifestSlot(config))); let faultPhase = false, disposing: Promise<unknown> | undefined, writesAfter = 0, beginsAfter = 0;
    h.protectedFaults.hook = async (event, next) => { const result = await next(); if (event.kind === "inventory") faultPhase = true; return result; };
    h.faults.hook = async (event, next) => { const result = await next();
      if (faultPhase && !disposing && event.kind === "query" && event.values?.[0] === "f") disposing = h.owner.dispose();
      else if (disposing && event.kind === "run" && event.values?.[0] === "f") writesAfter++;
      else if (disposing && event.kind === "begin") beginsAfter++; return result; };
    await h.owner.run(); await disposing; expect(disposing).toBeDefined(); expect(writesAfter).toBe(0); expect(beginsAfter).toBe(0);
  });
  it("checks private owner currentness after reentrant final source reads without another foreign callback", async () => {
    const h = await fixture(platform, { ...BASE_SOURCE, [root]: session }); let finalizing = false, disposing: Promise<unknown> | undefined, commitsAfter = 0;
    const get = h.storage.getItem.bind(h.storage); h.storage.getItem = key => { const value = get(key); if (finalizing && !disposing && key === KEY_SESSION) disposing = h.owner.dispose(); return value; };
    h.faults.hook = async (event, next) => {
      if (event.kind === "run" && (event.values ?? []).some(value => { const q = parseQ(value); return q.ok && q.value.phase === "bound"; })) finalizing = true;
      if (event.kind === "commit" && disposing) commitsAfter++; return next(); };
    expect((await h.owner.run()).outcome).toBe("disposed"); await disposing; expect(disposing).toBeDefined(); expect(commitsAfter).toBe(0); expect((await h.q())?.phase).toBe("credentials_verified");
  });
  it("stops held-child domain writes after parent disposal inside a domain fingerprint", async () => {
    let disposing: Promise<unknown> | undefined, writesAfter = 0;
    const current = { owner: undefined as NativeCommonMigrationOwner | undefined };
    const h = await fixture(platform, { ...BASE_SOURCE, [root]: session }, { domainFingerprint: value => { if (current.owner && !disposing) disposing = current.owner.dispose(); return fp(value); } }); current.owner = h.owner;
    h.faults.hook = async (event, next) => { if (disposing && event.kind === "run" && event.sql?.includes("records")) writesAfter++; return next(); };
    expect((await h.owner.run()).outcome).toBe("disposed"); await disposing; expect(disposing).toBeDefined(); expect(writesAfter).toBe(0);
  });
  it("binds the actual held raw target A rather than unrelated earlier snapshot B", async () => {
    const h = await fixture(platform, { ...BASE_SOURCE, [root]: session }, { limits: { ...LIMITS, protocolStepLimit: 1, faultWriteAttemptLimit: 1 } }); await h.until("credentials_verified");
    await h.owner.dispose(); await h.raw({ kind: "close" }); vi.resetModules();
    const original = BASE_SOURCE[KEY_SESSION], changed = original + " "; h.storage.map.set(KEY_SESSION, changed);
    await h.raw({ kind: "open" }); await h.raw({ kind: "run", sql: "UPDATE records SET value=? WHERE key=?", values: [changed, KEY_SESSION] }); await h.raw({ kind: "close" });
    let phase = 0, heldReads = 0;
    h.faults.hook = async (event, next) => { const result = await next();
      if (phase === 0 && event.kind === "query" && event.sql?.startsWith("SELECT value FROM records") && event.values?.[0] === KEY_SESSION) {
        phase = 1; h.storage.map.set(KEY_SESSION, original); await h.raw({ kind: "run", sql: "UPDATE records SET value=? WHERE key=?", values: [original, KEY_SESSION] });
      } else if (phase === 1 && event.kind === "query" && event.values?.[0] === KEY_SESSION) heldReads++;
      else if (phase === 1 && heldReads >= 2 && event.kind === "query" && event.values?.[0] === "f") {
        phase = 2; h.storage.map.set(KEY_SESSION, changed); await h.raw({ kind: "run", sql: "UPDATE records SET value=? WHERE key=?", values: [changed, KEY_SESSION] });
      } return result; };
    const restarted = await h.make({ limits: { ...LIMITS, protocolStepLimit: 100, faultWriteAttemptLimit: 1 } });
    const result = await restarted.run(); expect(phase).toBe(2); expect(result.outcome).not.toBe("candidate"); expect((await h.q())?.phase).toBe("credentials_verified");
  });

  it("does not lend a replacement lifecycle to an old fault continuation", async () => {
    const h = await fixture(platform, { [root]: session }, { limits: { ...LIMITS, protocolStepLimit: 1, faultWriteAttemptLimit: 1 } }); await h.until("copying");
    h.values.delete(unwrap(credentialManifestSlot(config)));
    let recovering: Promise<unknown> | undefined, recovered = false, earlyWrites = 0;
    h.protectedFaults.hook = async (event, next) => { const result = await next();
      if (event.kind === "inventory" && !recovering) queueMicrotask(() => { recovering = h.owner.recover().then(value => { recovered = true; return value; }); });
      return result; };
    h.faults.hook = async (event, next) => { if (recovering && !recovered && event.kind === "run" && event.values?.[0] === "f") earlyWrites++; return next(); };
    await h.owner.run(); await recovering; expect(recovering).toBeDefined(); expect(earlyWrites).toBe(0);
    h.protectedFaults.hook = undefined; h.faults.hook = undefined;
    expect(await h.owner.run()).toMatchObject({ outcome: "fault", faultWriteAttempts: 1 });
  });

  it("does not let an old source continuation cancel the replacement normal control", async () => {
    const h = await fixture(platform, { [root]: session }, { limits: { ...LIMITS, protocolStepLimit: 1, faultWriteAttemptLimit: 1 } });
    let reads = 0, armed = false, recovering: Promise<unknown> | undefined;
    const get = h.storage.getItem.bind(h.storage); h.storage.getItem = key => { const value = get(key); if (armed && key === root && ++reads === 3 && !recovering) recovering = h.owner.recover(); return value; };
    await h.until("copying"); armed = true; await h.owner.run(); await recovering; expect(recovering).toBeDefined(); armed = false;
    let result = await h.owner.run(); for (let n = 0; n < 25 && result.outcome === "incomplete"; n++) result = await h.owner.run(); expect(result.outcome).toBe("candidate");
  });
  for (const dependency of ["domainDigest", "domainFormat", "credentialFormat"] as const) for (const failure of ["throw", "async", "malformed"] as const) it(`preserves unchanged cold data through unavailable ${dependency}/${failure}`, async () => {
    const h = await fixture(platform, { ...BASE_SOURCE, [root]: session }, { limits: { ...LIMITS, protocolStepLimit: 1, faultWriteAttemptLimit: 1 } }); await h.until("credentials_verified");
    await h.owner.dispose(); await h.raw({ kind: "close" }); vi.resetModules(); let unavailable = true;
    const bad = () => { if (failure === "throw") throw new Error("synthetic unavailable dependency");
      if (failure === "async") { const pending = Promise.reject("synthetic dependency rejection"); Object.defineProperty(pending, "then", { get() { throw "masked then"; } }); return pending; }
      return dependency === "domainDigest" ? "malformed" : undefined; };
    const changes: Partial<NativeCommonMigrationOptions> = dependency === "domainDigest" ? { domainFingerprint: (value => unavailable ? bad() : fp(value)) as NativeCommonMigrationOptions["domainFingerprint"] } :
      dependency === "domainFormat" ? { domainFingerprintFormat: (value => unavailable ? bad() : isSyntheticFingerprint(value)) as NativeCommonMigrationOptions["domainFingerprintFormat"] } :
      { credentialFingerprintFormat: (value => unavailable ? bad() : hashFormat(value)) as NativeCommonMigrationOptions["credentialFingerprintFormat"] };
    const restarted = await h.make({ ...changes, limits: { ...LIMITS, protocolStepLimit: 100, faultWriteAttemptLimit: 1 } });
    expect((await restarted.run()).outcome).toBe("blocked"); unavailable = false; expect((await restarted.run()).outcome).toBe("candidate");
  });
  for (const phase of ["intent", "manifest_confirmed"] as const) it(`requires independent protected fixed absences before ${phase} advances`, async () => {
    const h = await fixture(platform, {}, { limits: { ...LIMITS, protocolStepLimit: 1, faultWriteAttemptLimit: 1 } }); await h.until(phase);
    if (phase === "intent") { await h.owner.run(); expect(h.values.has(unwrap(credentialManifestSlot(config)))).toBe(true); }
    let reads = 0; h.protectedFaults.hook = async (event, next) => { if (event.kind === "read" && event.key !== unwrap(credentialManifestSlot(config))) { reads++; throw new Error("protected fixed absence unavailable"); } return next(); };
    expect((await h.owner.run()).outcome).toBe("recovery_required"); expect(reads).toBeGreaterThan(0); expect((await h.q())?.phase).toBe(phase);
    h.protectedFaults.hook = undefined; expect((await h.owner.recover()).outcome).toBe("recovered");
    let result = await h.owner.run(); for (let n = 0; n < 25 && result.outcome === "incomplete"; n++) result = await h.owner.run(); expect(result.outcome).toBe("candidate");
  });
  for (const dependency of ["uuid", "clock", "platform", "platform_port"] as const) for (const masked of [false, true]) it(`owns rejected ${dependency} callback output (masked=${masked})`, async () => {
    const rejected = () => { const pending = Promise.reject("synthetic unexpected async callback"); if (masked) Object.defineProperty(pending, "then", { get() { throw "masked"; } }); return pending; };
    let calls = 0;
    const changes: Partial<NativeCommonMigrationOptions> = dependency === "uuid" ? { generateUuid: (() => ++calls === 2 ? rejected() : syntheticUuid()) as unknown as () => string } :
      dependency === "clock" ? { now: rejected as unknown as () => string } : { detectPlatform: dependency === "platform_port" ? () => ++calls === 2 ? rejected() : "ios" : rejected };
    const h = await fixture(platform, {}, changes); expect((await h.owner.run()).outcome).toBe("blocked");
    await new Promise(resolve => setTimeout(resolve, 0));
  });
  it("does not manufacture invalid metadata when the SQL selection format dependency becomes unavailable", async () => {
    const h = await fixture(platform, { ...BASE_SOURCE, [root]: session }, { limits: { ...LIMITS, protocolStepLimit: 1, faultWriteAttemptLimit: 1 } }); await h.until("credentials_verified");
    await h.owner.dispose(); await h.raw({ kind: "close" }); vi.resetModules(); let unavailable = false;
    h.protectedFaults.hook = async (event, next) => { const result = await next(); if (event.kind === "inventory") unavailable = true; return result; };
    const restarted = await h.make({ limits: { ...LIMITS, protocolStepLimit: 100, faultWriteAttemptLimit: 1 }, domainFingerprintFormat: value => { if (unavailable) throw "synthetic selection failure"; return isSyntheticFingerprint(value); } });
    expect((await restarted.run()).outcome).toBe("blocked"); unavailable = false; h.protectedFaults.hook = undefined;
    expect((await restarted.run()).outcome).toBe("candidate");
  });

});
