// S3f: real disposable SQLite; protected storage and bridge failures are injected.
// Reloaded modules below model a NEW JS process only after all old work settles.
import { AuthClient } from "@supabase/supabase-js";
import { storePKCEVerifier, removePKCEVerifier, removeAllPKCEVerifiers } from "@supabase/auth-js/dist/main/lib/helpers";
import { createProviderCredentialStorage } from "../../supabase/providerCredentialStorage";
import { createNativeCredentialSettlementStorage } from "../../supabase/supabaseClient";
import { createHash } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { NativeCommonMigrationOptions, NativeCommonRuntimeOwner } from "../nativeCombinedMigrationOwner";
import { combinedFixture, disposeCombinedFixtures } from "./nativeCombinedHeldSqliteTestEngine";
import { SyntheticStorage, LIMITS, syntheticUuid, SYNTHETIC_NOW } from "./nativeMigrationMTestKit";
import { BASE_SOURCE, fp, isSyntheticFingerprint } from "./nativeMigrationTestKit";
import { credentialManifestSlot, credentialItemSlot } from "../credentialPhysicalSlots";
import { parseQ } from "../credentialProtocol";
const root = "sb-fixture-auth-token", config = "pc1:fixture";
const session = '{"access_token":"SYNTHETIC_ACCESS","refresh_token":"SYNTHETIC_REFRESH","expires_at":100,"expires_in":1,"token_type":"bearer"}';
const hash = (_purpose: string, key: string, raw: string) => createHash("sha256").update(JSON.stringify(["credential-value/v1", key, raw])).digest("hex");
const hashFormat = (value: string) => /^[0-9a-f]{64}$/.test(value);
const unwrap = <T,>(r: { ok: true; value: T } | { ok: false }): T => { if (!r.ok) throw new Error("fixture"); return r.value; };
type Event = { kind: string; key?: string; value?: string };
const unblocks: (() => void)[] = [];
const owners: NativeCommonRuntimeOwner[] = [];
const pairs: import("../nativeCombinedRuntime").NativeCombinedRuntimePair[] = [];
afterEach(async () => { while (unblocks.length) unblocks.pop()!(); for (const pair of pairs.splice(0)) await pair.dispose(); for (const owner of owners.splice(0)) await owner.dispose(); await disposeCombinedFixtures(); vi.unstubAllGlobals(); });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); unblocks.push(resolve); return { promise, resolve }; }
async function fixture(platform: "ios" | "android", initial: Record<string, string> = {}, changes: Partial<NativeCommonMigrationOptions> = {}, wrap: (binding: object) => object = value => value) {
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
    remove: async (key: string) => invoke({ kind: "remove", key }, async () => ({ kind: values.delete(key) ? "deleted" : "nothing_to_delete" })),
  };
  const options: NativeCommonMigrationOptions = { sqlite: { ...h.options, detectPlatform: () => "ios" }, providerConfigIdentity: config, sessionStorageKey: root,
    protectedBinding: wrap(binding), detectPlatform: () => "ios", domainFingerprint: fp, domainFingerprintFormat: isSyntheticFingerprint,
    credentialFingerprint: hash, credentialFingerprintFormat: hashFormat, generateUuid: syntheticUuid, now: () => SYNTHETIC_NOW,
    limits: { ...LIMITS, protocolStepLimit: 100, faultWriteAttemptLimit: 1 }, ...changes };
  const make = async (override: Partial<NativeCommonMigrationOptions> = {}) => {
    const ownerModule = await import("../nativeCombinedMigrationOwner"); const made = ownerModule.createNativeCombinedRuntimeOwner({ ...options, ...override });
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
  return { ...h, binding, storage, values, protectedTrace: trace, protectedFaults: faults, options, make, owner, q, until };
}

async function runtime(platform: "ios" | "android" = "ios", initial: Record<string, string> = {}) {
  const h = await fixture(platform, initial);
  const report = await h.owner.run(); if (report.outcome !== "candidate") throw new Error("migration failed");
  const transferred = await h.owner.handoff(report.candidate);
  expect(transferred.outcome).toBe("runtime"); if (transferred.outcome !== "runtime") throw new Error("handoff refused");
  pairs.push(transferred.pair);
  return { ...h, pair: transferred.pair, candidate: report.candidate };
}

for (const platform of ["ios", "android"] as const) describe(`${platform} SQLite model / dormant paired runtime`, () => {
  it("authenticates private revocation observations and joins reentrant close before notifying", async () => {
    const h = await runtime(platform);
    const { subscribeNativeRuntimeRevocation } = await import("../nativeCombinedRuntime");
    const foreign = vi.fn();
    subscribeNativeRuntimeRevocation(new Proxy({}, { get() { throw new Error("Foreign pair getter"); } }) as typeof h.pair, foreign);
    let reentered: ReturnType<typeof h.pair.dispose> | null = null;
    const notified = vi.fn(() => { expect(h.pair.health().lifecycle).toBe("closed"); reentered = h.pair.dispose(); });
    subscribeNativeRuntimeRevocation(h.pair, notified);
    const closed = h.pair.dispose();
    expect(reentered).toBe(closed); expect(notified).toHaveBeenCalledTimes(1); expect(foreign).not.toHaveBeenCalled();
    expect(await closed).toEqual({ ok: true });
  });
  it("hands off actual resources once, keeps both old controls terminal, and mutates generic domain keys", async () => {
    const h = await runtime(platform, BASE_SOURCE);
    const opens = h.trace.filter(e => e.kind === "open").length, configs = h.protectedTrace.filter(e => e.kind === "configure").length;
    expect(await h.owner.run()).toEqual({ outcome: "disposed" }); expect(await h.owner.recover()).toEqual({ outcome: "disposed" });
    expect(await h.owner.dispose()).toEqual({ ok: false, reason: "evidence_held" }); expect(await h.owner.handoff(h.candidate)).toEqual({ outcome: "refused" });
    expect(await h.pair.domain.set("profile:one:sporting", "updated")).toEqual({ ok: true });
    expect(await h.pair.domain.get("profile:one:sporting")).toEqual({ status: "value", value: "updated" });
    expect(await h.pair.domain.remove("profile:one:sporting")).toEqual({ ok: true });
    expect(await h.pair.domain.remove("already-absent")).toEqual({ ok: true });
    expect(await h.pair.domain.get("profile:one:sporting")).toEqual({ status: "value", value: null });
    expect(h.trace.filter(e => e.kind === "open")).toHaveLength(opens); expect(h.protectedTrace.filter(e => e.kind === "configure")).toHaveLength(configs);
    expect(await h.pair.dispose()).toEqual({ ok: true });
    const count = h.trace.length; expect((await h.pair.domain.get("x")).status).toBe("read_failed"); expect(h.trace).toHaveLength(count);
    const replacement = await h.make(); expect((await replacement.run()).outcome).toBe("candidate");
  });
  it("joins an authentic handoff but refuses copied candidates without I/O", async () => {
    const h = await fixture(platform); const result = await h.owner.run(); if (result.outcome !== "candidate") throw new Error("fixture");
    const before = [h.trace.length, h.protectedTrace.length]; expect(await h.owner.handoff({ ...result.candidate })).toEqual({ outcome: "refused" });
    expect([h.trace.length, h.protectedTrace.length]).toEqual(before);
    const first = h.owner.handoff(result.candidate); expect(h.owner.handoff(result.candidate)).toBe(first);
    const pair = await first; expect(pair.outcome).toBe("runtime"); if (pair.outcome === "runtime") pairs.push(pair.pair);
  });
  for (const key of ["curling.nativeMigration.other", "curling.credential.bad", "curling.installationTransfer.x", "sb-any-auth-token"]) it(`refuses reserved domain key ${key} before SQL I/O`, async () => {
    const h = await runtime(platform); const count = h.trace.length;
    expect((await h.pair.domain.get(key)).status).toBe("read_failed"); expect((await h.pair.domain.set(key, "x")).ok).toBe(false); expect((await h.pair.domain.remove(key)).ok).toBe(false);
    expect(h.trace).toHaveLength(count); expect(await h.pair.domain.set("sessions", "legacy-retirement")).toEqual({ ok: true });
  });
  it("updates exact current SDK values and new flows outside M, without old source access", async () => {
    const h = await runtime(platform, { [root]: session });
    vi.stubGlobal("localStorage", new Proxy({}, { get() { throw new Error("old source must not be consulted"); } }));
    const raw = session.replace('"expires_in":1', '"expires_in":1.5'), flow = root + "-flow-flow1234-code-verifier", verifier = '"' + "a".repeat(43) + '"';
    expect(await h.pair.credentials.write(root, raw)).toEqual({ ok: true }); expect(await h.pair.credentials.read(root)).toEqual({ status: "value", value: raw });
    expect(await h.pair.credentials.write(flow, verifier)).toEqual({ ok: true }); expect(await h.pair.credentials.read(flow)).toEqual({ status: "value", value: verifier });
    expect(await h.pair.credentials.write(root + "-flows-code-verifier", "[]")).toEqual({ ok: true });
    expect(await h.pair.credentials.remove(root)).toEqual({ ok: true, outcome: "deleted_reported" });
    expect(await h.pair.credentials.remove(root)).toEqual({ ok: true, outcome: "nothing_to_delete_reported" });
    expect(await h.pair.credentials.read(root)).toEqual({ status: "absent" });
    expect(h.pair.health()).toMatchObject({ domain: "healthy", credential: "healthy", protocol: "healthy" });
  });
  for (const kind of ["read", "write", "remove"] as const) it(`keeps healthy SQL usable after a sticky credential ${kind} failure`, async () => {
    const h = await runtime(platform, { [root]: session }); const q = await h.q(); if (!q) throw new Error("fixture");
    const slot = unwrap(credentialItemSlot(config, root, q.credentialEpochId, root));
    h.protectedFaults.hook = async (event, next) => { if (event.kind === kind && event.key === slot) throw new Error("injected protected failure"); return next(); };
    if (kind === "read") expect((await h.pair.credentials.read(root)).status).toBe("read_failed");
    else if (kind === "write") expect(await h.pair.credentials.write(root, session)).toMatchObject({ ok: false, previousValueMayBeLost: true });
    else expect((await h.pair.credentials.remove(root)).ok).toBe(false);
    h.protectedFaults.hook = undefined; const count = h.protectedTrace.length;
    expect((await h.pair.credentials.read(root)).status).toBe("read_failed"); expect(h.protectedTrace).toHaveLength(count);
    expect(await h.pair.domain.set("healthy-training", "saved")).toEqual({ ok: true });
    const f = await h.raw({ kind: "query", sql: "SELECT value FROM curling_credential_meta WHERE slot='f';" }); expect(f).toEqual({ values: [] });
    expect(h.pair.health()).toMatchObject({ domain: "healthy", credential: "failed", protocol: "healthy" });
    expect(await h.pair.dispose()).toEqual({ ok: false, reason: "evidence_held" });
    const nextOwner = await h.make(); expect((await nextOwner.run()).outcome).toBe("blocked");
  });
  for (const outcome of ["applied_throw", "invalid_ack", "readback_failed", "readback_mismatch"]) for (const kind of ["write", "remove"] as const) it(`does not heal ${kind} ${outcome}`, async () => {
    const h = await runtime(platform, { [root]: session }); let afterEffect = false;
    h.protectedFaults.hook = async (event, next) => {
      if (event.kind === kind) { afterEffect = true; await next(); if (outcome === "applied_throw") throw new Error("lost"); if (outcome === "invalid_ack") return false; return kind === "remove" ? { kind: "deleted" } : undefined; }
      if (afterEffect && event.kind === "read") { if (outcome === "readback_failed") throw new Error("lost readback"); if (outcome === "readback_mismatch") return kind === "write" ? { kind: "established_absent" } : { kind: "value", value: "malformed" }; }
      return next();
    };
    const result = kind === "write" ? await h.pair.credentials.write(root, session) : await h.pair.credentials.remove(root);
    expect(result.ok).toBe(false); const count = h.protectedTrace.length;
    expect((await h.pair.credentials.read(root)).status).toBe("read_failed"); expect(h.protectedTrace).toHaveLength(count);
    expect(h.pair.health().lastCredential).toMatchObject({ operation: kind, issued: true, verified: false, outcome: "unverified" });
  });
  it("stops both lanes on a positive protected header contradiction and retains bounded F", async () => {
    const h = await runtime(platform, { [root]: session }); const q = await h.q(); if (!q) throw new Error("fixture");
    let faultCommitAcknowledged = false;
    h.faults.hook = async (event, next) => {
      const result = await next();
      if (event.kind === "commit") faultCommitAcknowledged = true;
      return result;
    };
    const slot = unwrap(credentialItemSlot(config, root, q.credentialEpochId, root)); h.values.set(slot, "malformed");
    expect((await h.pair.credentials.read(root)).status).toBe("read_failed");
    expect((await h.pair.domain.set("cannot-save", "x")).ok).toBe(false);
    // Await the actual COMMIT acknowledgement, then observe F. A same-connection
    // SELECT alone could see an uncommitted insert; a fixed 20ms delay races SQL.
    await expect.poll(() => faultCommitAcknowledged, { timeout: 3000, interval: 10 }).toBe(true);
    const f = await h.raw({ kind: "query", sql: "SELECT value FROM curling_credential_meta WHERE slot='f';" }) as { values: unknown[] }; expect(f.values).toHaveLength(1);
    expect(h.pair.health().protocol).toBe("faulted");
  });
  for (const boundary of ["begin", "run", "commit"] as const) it(`never reuses SQL after unconfirmed ${boundary}`, async () => {
    const h = await runtime(platform); let once = true;
    h.faults.hook = async (event, next) => { if (once && event.kind === boundary) { once = false; if (boundary === "commit") await next(); throw new Error("lost SQL acknowledgement"); } return next(); };
    expect((await h.pair.domain.set("unknown-write", "x")).ok).toBe(false); const count = h.trace.length;
    expect((await h.pair.domain.get("unknown-write")).status).toBe("read_failed"); expect((await h.pair.domain.set("other", "x")).ok).toBe(false);
    expect((await h.pair.credentials.read(root)).status).toBe("read_failed"); expect(h.trace).toHaveLength(count);
    expect(h.trace.filter(e => e.kind === "rollback")).toHaveLength(boundary === "run" ? 1 : 0);
  });
  it("does not queue a healthy domain write behind pending protected I/O", async () => {
    const h = await runtime(platform); const entered = deferred(), release = deferred(); let once = true;
    h.protectedFaults.hook = async (event, next) => { if (once && event.kind === "read") { once = false; entered.resolve(); await release.promise; } return next(); };
    const protectedRead = h.pair.credentials.read(root); await entered.promise;
    expect(await h.pair.domain.set("training", "saved while Keychain pending")).toEqual({ ok: true });
    release.resolve(); expect(await protectedRead).toEqual({ status: "absent" });
  });
  it("revokes a previously prepared protected anchor synchronously after domain failure", async () => {
    const h = await runtime(platform); const entered = deferred(), release = deferred(); let once = true;
    h.protectedFaults.hook = async (event, next) => { if (once && event.kind === "read") { once = false; entered.resolve(); await release.promise; } return next(); };
    const read = h.pair.credentials.read(root); await entered.promise;
    h.faults.hook = async event => { if (event.kind === "query") throw new Error("SQL failed"); return {}; };
    expect((await h.pair.domain.get("x")).status).toBe("read_failed");
    const count = h.protectedTrace.length; release.resolve(); expect((await read).status).toBe("read_failed"); expect(h.protectedTrace).toHaveLength(count);
  });
  for (const boundary of ["close", "release"] as const) it(`retains both reservations after failed physical ${boundary}`, async () => {
    const h = await runtime(platform); let closes = 0;
    h.faults.hook = async (event, next) => { if (event.kind === "close" && ++closes === (boundary === "close" ? 1 : 2)) throw new Error("cleanup failed"); return next(); };
    const first = h.pair.dispose(); expect(h.pair.dispose()).toBe(first); expect(await first).toEqual({ ok: false, reason: "cleanup_unconfirmed" });
    expect(h.pair.health().lifecycle).toBe("closed"); const replacement = await h.make(); expect((await replacement.run()).outcome).toBe("blocked");
  });
});

describe("handoff admission and terminal evidence", () => {
  it("revalidates a cold bound pair without either old source", async () => {
    const h = await runtime("ios", { ...BASE_SOURCE, [root]: session }); expect(await h.pair.dispose()).toEqual({ ok: true });
    vi.stubGlobal("localStorage", new Proxy({}, { get() { throw new Error("must remain source-free"); } }));
    const next = await h.make(); const report = await next.run(); expect(report.outcome).toBe("candidate"); if (report.outcome !== "candidate") throw new Error("fixture");
    const result = await next.handoff(report.candidate); expect(result.outcome).toBe("runtime"); if (result.outcome !== "runtime") throw new Error("fixture"); pairs.push(result.pair);
    expect(await result.pair.credentials.read(root)).toEqual({ status: "value", value: session });
  });
  it("refuses stale and cross-owner candidates before handoff I/O", async () => {
    const h = await fixture("ios"); const old = await h.owner.run(), current = await h.owner.run();
    if (old.outcome !== "candidate" || current.outcome !== "candidate") throw new Error("fixture");
    const other = await h.make(), count = h.trace.length;
    expect(await h.owner.handoff(old.candidate)).toEqual({ outcome: "refused" }); expect(await other.handoff(current.candidate)).toEqual({ outcome: "refused" }); expect(h.trace).toHaveLength(count);
  });
  for (const action of ["dispose", "recover"] as const) it(`cancels handoff at a real asynchronous preparation boundary via ${action}`, async () => {
    const h = await fixture("ios"), entered = deferred(), release = deferred(); const report = await h.owner.run(); if (report.outcome !== "candidate") throw new Error("fixture");
    let once = true; h.protectedFaults.hook = async (event, next) => { if (event.kind === "read" && once) { once = false; entered.resolve(); await release.promise; } return next(); };
    const handoff = h.owner.handoff(report.candidate); await entered.promise; const cancel = h.owner[action](); release.resolve();
    expect(await handoff).toEqual({ outcome: "refused" }); await cancel;
    if (action === "recover") { const retried = await h.owner.run(); expect(retried.outcome).toBe("candidate"); if (retried.outcome !== "candidate") throw new Error("fixture"); const next = await h.owner.handoff(retried.candidate); expect(next.outcome).toBe("runtime"); if (next.outcome === "runtime") pairs.push(next.pair); }
  });
  for (const dependency of ["remove", "failedWriteMayLosePreviousValue"]) for (const mode of ["missing", "getter", "invalid"]) it(`captures ${dependency} only for handoff and refuses ${mode} without a half pair`, async () => {
    const h = await fixture("ios"); const report = await h.owner.run(); if (report.outcome !== "candidate") throw new Error("fixture");
    const old = Object.getOwnPropertyDescriptor(h.binding, dependency)!;
    if (mode === "missing") Reflect.deleteProperty(h.binding, dependency);
    else if (mode === "getter") Object.defineProperty(h.binding, dependency, { configurable: true, get() { throw new Error("must not invoke accessor"); } });
    else Object.defineProperty(h.binding, dependency, { configurable: true, value: 1 });
    expect(await h.owner.handoff(report.candidate)).toEqual({ outcome: "refused" });
    Object.defineProperty(h.binding, dependency, old);
    const fresh = await h.owner.run(); expect(fresh.outcome).toBe("candidate"); if (fresh.outcome !== "candidate") throw new Error("fixture");
    const result = await h.owner.handoff(fresh.candidate); expect(result.outcome).toBe("runtime"); if (result.outcome === "runtime") pairs.push(result.pair);
  });
  it("checks current ownership after the mutable-dependency reflection trap", async () => {
    let cancellation: Promise<unknown> | null = null, owner: NativeCommonRuntimeOwner | null = null;
    const h = await fixture("ios", {}, {}, binding => new Proxy(binding, { getOwnPropertyDescriptor(target, name) { if (name === "remove" && owner) cancellation = owner.recover(); return Reflect.getOwnPropertyDescriptor(target, name); } }));
    owner = h.owner; const report = await owner.run(); if (report.outcome !== "candidate") throw new Error("fixture");
    expect(await owner.handoff(report.candidate)).toEqual({ outcome: "refused" }); await cancellation;
  });
  for (const mismatch of ["config", "epoch", "key", "manifest"]) it(`preserves and stops on a current ${mismatch} contradiction`, async () => {
    const h = await runtime("ios", { [root]: session }); const q = await h.q(); if (!q) throw new Error("fixture");
    const slot = unwrap(credentialItemSlot(config, root, q.credentialEpochId, root)), before = h.values.get(slot)!;
    if (mismatch === "manifest") h.values.set(unwrap(credentialManifestSlot(config)), "malformed");
    else { const envelope = JSON.parse(before); if (mismatch === "config") envelope.providerConfigIdentity = "pc1:other"; else if (mismatch === "epoch") envelope.credentialEpochId = "11111111-1111-4111-8111-111111111111"; else envelope.key = root + "-user"; h.values.set(slot, JSON.stringify(envelope)); }
    const retained = new Map(h.values); expect((await h.pair.credentials.remove(root)).ok).toBe(false); expect(h.values).toEqual(retained); expect(h.pair.health().protocol).toBe("faulted");
  });
  it("keeps SQL-read unavailability distinct from a positive data fault", async () => {
    const h = await runtime(); h.faults.hook = async event => { if (event.kind === "query") throw new Error("temporarily inaccessible"); return {}; };
    expect((await h.pair.domain.get("x")).status).toBe("read_failed"); expect(h.pair.health()).toMatchObject({ domain: "failed", protocol: "healthy" });
    h.faults.hook = undefined;
    expect(await h.raw({ kind: "query", sql: "SELECT value FROM curling_credential_meta WHERE slot='f';" })).toEqual({ values: [] });
  });
  it("closes both facades at disposal call time and owns already-issued work through settlement", async () => {
    const h = await runtime(), entered = deferred(), release = deferred(); let once = true;
    h.protectedFaults.hook = async (event, next) => { if (once && event.kind === "read") { once = false; entered.resolve(); await release.promise; } return next(); };
    const pending = h.pair.credentials.read(root); await entered.promise; const dispose = h.pair.dispose(), count = h.trace.length;
    expect((await h.pair.domain.set("after-close", "x")).ok).toBe(false); expect(h.trace.slice(count).every(event => event.kind === "close")).toBe(true);
    let done = false; void dispose.then(() => { done = true; }); await Promise.resolve(); expect(done).toBe(false);
    release.resolve(); expect((await pending).status).toBe("read_failed"); expect((await dispose).ok).toBe(false);
  });
});

function provider(pair: import("../nativeCombinedRuntime").NativeCombinedRuntimePair) {
  const integrated = createProviderCredentialStorage(pair.credentials, { sessionStorageKey: root });
  const settled = createNativeCredentialSettlementStorage(integrated.storage, () => integrated.observedFailure()); if (!settled.ok) throw new Error("fixture");
  return { integrated, settlement: settled.value, storage: settled.value.storage };
}
describe("installed SDK helpers through the actual mutable envelope store", () => {
  for (const action of ["store", "remove", "removeAll"] as const) it(`retains actual helper state after every completed ${action} call interruption`, async () => {
    const run = (storage: ReturnType<typeof provider>["storage"]) => action === "store" ? storePKCEVerifier(storage, root, "FlowId02", "b".repeat(43)) : action === "remove" ? removePKCEVerifier(storage, root, "FlowId01") : removeAllPKCEVerifiers(storage, root);
    const seed = { [root + "-flow-FlowId01-code-verifier"]: JSON.stringify("a".repeat(43)), [root + "-flows-code-verifier"]: '["FlowId01"]', [root + "-code-verifier"]: JSON.stringify("a".repeat(43)), [root + "-flow-Orphan01-code-verifier"]: JSON.stringify("c".repeat(43)) };
    const complete = await runtime("ios", seed), full = provider(complete.pair), expected: string[] = [];
    const storage = (base: typeof full.storage, trace: string[], interrupt: number) => ({
      async getItem(key: string) { const value = await base.getItem(key); trace.push("read"); if (trace.length === interrupt) throw new Error("synthetic process interruption"); return value; },
      async setItem(key: string, value: string) { await base.setItem(key, value); trace.push("write"); if (trace.length === interrupt) throw new Error("synthetic process interruption"); },
      async removeItem(key: string) { await base.removeItem(key); trace.push("remove"); if (trace.length === interrupt) throw new Error("synthetic process interruption"); },
    });
    await run(storage(full.storage, expected, Infinity)); expect(await complete.pair.dispose()).toEqual({ ok: true });
    for (let interrupted = 1; interrupted <= expected.length; interrupted++) {
      const h = await runtime("ios", seed), p = provider(h.pair), actual: string[] = [];
      await expect(run(storage(p.storage, actual, interrupted))).rejects.toThrow("synthetic process interruption");
      expect(actual).toEqual(expected.slice(0, interrupted));
      expect(await p.storage.getItem(root + "-flow-Orphan01-code-verifier")).toBe(seed[root + "-flow-Orphan01-code-verifier"]);
      // The call has settled; stop this owner rather than replaying the helper.
      expect(await h.pair.dispose()).toEqual({ ok: true });
    }
  });

  it("stores/removes current flows and removes all indexed slots without historical M constraints", async () => {
    const h = await runtime(), p = provider(h.pair), verifier = "a".repeat(43);
    await storePKCEVerifier(p.storage, root, "FlowId01", verifier); await storePKCEVerifier(p.storage, root, "FlowId02", verifier);
    expect(await p.storage.getItem(root + "-flow-FlowId01-code-verifier")).toBe(JSON.stringify(verifier));
    await removePKCEVerifier(p.storage, root, "FlowId01"); expect(await p.storage.getItem(root + "-flow-FlowId01-code-verifier")).toBeNull();
    await removeAllPKCEVerifiers(p.storage, root); expect(await p.storage.getItem(root + "-flows-code-verifier")).toBeNull(); expect(p.integrated.observedFailure()).toBeNull();
  });
  it("permits concurrent helper index lost updates without deleting an unindexed item as repair", async () => {
    const h = await runtime(), p = provider(h.pair), verifier = "a".repeat(43);
    await Promise.all([storePKCEVerifier(p.storage, root, "FlowId01", verifier), storePKCEVerifier(p.storage, root, "FlowId02", verifier)]);
    const index = JSON.parse((await p.storage.getItem(root + "-flows-code-verifier"))!); expect(index).toHaveLength(1);
    const orphan = index[0] === "FlowId01" ? "FlowId02" : "FlowId01";
    await removeAllPKCEVerifiers(p.storage, root); expect(await p.storage.getItem(root + "-flow-" + orphan + "-code-verifier")).toBe(JSON.stringify(verifier)); expect(h.pair.health().protocol).toBe("healthy");
  });
  for (const operation of ["store", "remove", "removeAll"] as const) for (const position of [1, 2, 3]) it(`settles an interrupted ${operation} at mutable effect ${position} without repair`, async () => {
    const h = await runtime(), p = provider(h.pair), verifier = "a".repeat(43); await storePKCEVerifier(p.storage, root, "FlowId01", verifier);
    let effects = 0;
    h.protectedFaults.hook = async (event, next) => { if ((event.kind === "write" || event.kind === "remove") && ++effects === position) { await next(); throw new Error("lost acknowledgement"); } return next(); };
    const action = operation === "store" ? storePKCEVerifier(p.storage, root, "FlowId02", verifier) : operation === "remove" ? removePKCEVerifier(p.storage, root, "FlowId01") : removeAllPKCEVerifiers(p.storage, root);
    await expect(action).rejects.toBeDefined(); expect(p.settlement.failed()).toBe(true); expect(h.pair.health()).toMatchObject({ credential: "failed", protocol: "healthy", domain: "healthy" });
    expect(await h.pair.domain.set("training", "retained")).toEqual({ ok: true });
  });
});

const userId = "11111111-1111-4111-8111-111111111111";
const sdkUser = { id: userId, aud: "authenticated", role: "authenticated", email: "fixture@example.invalid", created_at: "2026-01-01T00:00:00Z", app_metadata: { provider: "email" }, user_metadata: {} };
function sdkSession(expired = false) {
  const expires = Math.floor(Date.now() / 1000) + (expired ? -60 : 3600);
  const token = [Buffer.from(JSON.stringify({ alg: "HS256", typ: "JWT" })).toString("base64url"), Buffer.from(JSON.stringify({ sub: userId, exp: expires })).toString("base64url"), Buffer.alloc(32).toString("base64url")].join(".");
  return { access_token: token, refresh_token: "synthetic-refresh", token_type: "bearer", expires_in: 3600, expires_at: expires, user: sdkUser };
}
describe("owned public AuthClient compatibility through the actual pair — no app admission", () => {
  for (const operation of ["read", "refresh", "verify", "exchange", "signout"] as const) for (const storageFault of [false, true]) it(`settles actual public ${operation}, storageFault=${storageFault}`, async () => {
    const flow = "FlowId01", verifier = "a".repeat(43), initial = JSON.stringify(sdkSession());
    const h = await runtime("ios", { [root]: initial }), p = provider(h.pair);
    if (operation === "exchange") await storePKCEVerifier(p.storage, root, flow, verifier);
    const denied = false;
    const transport = vi.fn(async () => {
      if (storageFault) h.protectedFaults.hook = async (event, next) => { if (event.kind === "write" || event.kind === "remove") throw new Error("storage failed after provider response"); return next(); };
      return operation === "signout" ? new Response(null, { status: 204 }) : new Response(JSON.stringify(sdkSession()), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const auth = new AuthClient({ url: "https://fixture.supabase.invalid/auth/v1", storageKey: root, storage: p.storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, skipAutoInitialize: true, flowType: "pkce", fetch: transport });
    let tail = Promise.resolve();
    const owned = <T,>(command: () => Promise<T>): Promise<{ ok: boolean; value?: T }> => {
      const task = tail.then(async () => { try { const value = await command(); return { ok: !p.settlement.failed() && !p.integrated.observedFailure(), value }; } catch { return { ok: false }; } }); tail = task.then(() => undefined, () => undefined); return task;
    };
    try {
      expect((await owned(() => auth.initialize())).ok).toBe(true); await auth.stopAutoRefresh();
      if (operation === "read" && storageFault) h.protectedFaults.hook = async () => { throw new Error("read failed"); };
      const result = await owned(() => operation === "read" ? auth.getSession() : operation === "refresh" ? auth.refreshSession({ refresh_token: "synthetic-refresh" }) : operation === "verify" ? auth.verifyOtp({ email: "fixture@example.invalid", token: "123456", type: "email" }) : operation === "exchange" ? auth.exchangeCodeForSession("synthetic-code", { flowId: flow }) : auth.signOut({ scope: "local" }));
      expect(result.ok).toBe(!storageFault); if (!storageFault && result.value) expect(result.value.error).toBeNull(); expect(denied).toBe(false); expect(h.pair.health().credential).toBe(storageFault ? "failed" : "healthy");
      expect(await h.pair.domain.set("training", "still healthy")).toEqual({ ok: true });
    } finally { await auth.stopAutoRefresh(); await tail; }
  });
  for (const cleanupFailure of [false, true]) it(`retains causal provider denial independently of cleanupFailure=${cleanupFailure}`, async () => {
    const h = await runtime("ios", { [root]: JSON.stringify(sdkSession()) }), p = provider(h.pair); let denied = false;
    const transport = vi.fn(async () => { denied = true; if (cleanupFailure) h.protectedFaults.hook = async (event, next) => { if (event.kind === "remove") throw new Error("cleanup failed"); return next(); }; return new Response(JSON.stringify({ code: "refresh_token_not_found", message: "Synthetic denial" }), { status: 400, headers: { "Content-Type": "application/json", "x-supabase-api-version": "2024-01-01" } }); });
    const auth = new AuthClient({ url: "https://fixture.supabase.invalid/auth/v1", storageKey: root, storage: p.storage, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false, skipAutoInitialize: true, fetch: transport });
    try {
      await auth.initialize(); await auth.stopAutoRefresh();
      expect(await h.pair.credentials.write(root, JSON.stringify(sdkSession(true)))).toEqual({ ok: true });
      try { const result = await auth.refreshSession({ refresh_token: "synthetic-refresh" }); expect(result.error).not.toBeNull(); } catch { expect(cleanupFailure).toBe(true); }
      expect(denied).toBe(true); expect(p.integrated.observedFailure() !== null).toBe(cleanupFailure); expect(transport).toHaveBeenCalledTimes(1);
    } finally { await auth.stopAutoRefresh(); }
  });
});

describe("runtime callback, acknowledgement and capture boundaries", () => {
  for (const operation of ["read", "write", "remove"] as const) for (const masked of [false, true]) it(`owns ${masked ? "masked" : "native"} rejection returned by actual ${operation}`, async () => {
    const h = await runtime("ios", { [root]: session }); const q = await h.q(); if (!q) throw new Error("fixture");
    const slot = unwrap(credentialItemSlot(config, root, q.credentialEpochId, root));
    h.protectedFaults.hook = (event, next) => {
      if (event.kind === operation && event.key === slot) {
        const failure = Promise.reject(new Error("synthetic native rejection"));
        if (masked) Object.defineProperty(failure, "then", { value: null });
        return failure;
      }
      return next();
    };
    const result = operation === "read" ? await h.pair.credentials.read(root) : operation === "write" ? await h.pair.credentials.write(root, session) : await h.pair.credentials.remove(root);
    expect("ok" in result ? result.ok : result.status !== "read_failed").toBe(false);
    expect(h.pair.health()).toMatchObject({ domain: "healthy", credential: "failed", protocol: "healthy" });
  });
  for (const acknowledgement of [false, true, null, { kind: "no_evidence" }, { kind: "deleted", extra: true }, { kind: "unknown" }]) it(`rejects a malformed removal acknowledgement without read-to-heal: ${JSON.stringify(acknowledgement)}`, async () => {
    const h = await runtime("ios", { [root]: session }); let effect = false, readback = false;
    h.protectedFaults.hook = async (event, next) => {
      if (event.kind === "remove") { effect = true; await next(); return acknowledgement; }
      if (effect && event.kind === "read") readback = true;
      return next();
    };
    expect((await h.pair.credentials.remove(root)).ok).toBe(false); expect(readback).toBe(false);
    expect(h.pair.health().lastCredential).toMatchObject({ issued: true, acknowledged: false, verified: false });
  });
  it("captures actual mutable methods and replacement-loss policy exactly once from the same receiver", async () => {
    const h = await runtime("ios", { [root]: session });
    Object.defineProperty(h.binding, "remove", { configurable: true, get() { throw new Error("must not recapture"); } });
    Object.defineProperty(h.binding, "failedWriteMayLosePreviousValue", { configurable: true, get() { throw new Error("must not recapture"); } });
    expect(await h.pair.credentials.remove(root)).toEqual({ ok: true, outcome: "deleted_reported" });
  });
  it("rechecks private rights after a reentrant removal-ack descriptor before readback", async () => {
    const h = await runtime("ios", { [root]: session }); let disposal: Promise<unknown> | null = null, readback = false, removed = false;
    h.protectedFaults.hook = async (event, next) => {
      if (event.kind === "remove") {
        await next(); removed = true;
        return new Proxy({ kind: "deleted" }, { getOwnPropertyDescriptor(target, name) { disposal ??= h.pair.dispose(); return Reflect.getOwnPropertyDescriptor(target, name); } });
      }
      if (removed && event.kind === "read") readback = true;
      return next();
    };
    expect((await h.pair.credentials.remove(root)).ok).toBe(false); await disposal; expect(readback).toBe(false); expect(h.pair.health().lifecycle).toBe("closed");
  });
  it("reports no previous-value loss for a write refused before mutation issuance", async () => {
    const h = await runtime(); const count = h.protectedTrace.length;
    expect(await h.pair.credentials.write("foreign", session)).toMatchObject({ ok: false, previousValueMayBeLost: false }); expect(h.protectedTrace).toHaveLength(count);
  });
});


// Positive regressions converted from the independent real-SQLite review.
for(const platform of ['ios','android'] as const){
 it(`${platform}: runtime F rights revoked before dispose waits`,async()=>{
  const h=await runtime(platform,{[root]:session}),q=(await h.q())!;
  const slot=unwrap(credentialItemSlot(config,root,q.credentialEpochId,root));h.values.set(slot,'malformed');
  let seen=false,disposing:Promise<unknown>|undefined,begins=0,writes=0,commits=0;
  h.protectedFaults.hook=async(event,next)=>{const result=await next();if(event.kind==='read'&&event.key===slot)seen=true;return result};
  h.faults.hook=async(event,next)=>{const result=await next();if(seen&&!disposing&&event.kind==='query'&&event.values?.[0]==='f')disposing=h.pair.dispose();else if(disposing&&event.kind==='begin')begins++;else if(disposing&&event.kind==='run'&&event.values?.[0]==='f')writes++;else if(disposing&&event.kind==='commit')commits++;return result};
  expect((await h.pair.credentials.read(root)).status).toBe('read_failed');
  for(let n=0;n<100&&!disposing;n++)await new Promise(resolve=>setTimeout(resolve,1));await disposing;expect(disposing).toBeDefined();
  expect(begins).toBe(0);expect(writes).toBe(0);expect(commits).toBe(0);
 });
 it(`${platform}: legacy undefined query throw stays protocol_refused`,async()=>{
  const h=await fixture(platform);const adapter=await import("../nativeSqliteAdapter");
  const legacy=adapter.createNativeMigrationSqliteStore({...h.options.sqlite,reservedKeys:{record:'curling.nativeMigration.activationRecord.v1',latch:'curling.nativeMigration.faultLatch.v1'}});
  const acquired=await legacy.target.acquire();if(!acquired.ok)throw new Error('fixture');
  h.faults.hook=async(event,next)=>{if(event.kind==='query')throw undefined;return next()};
  const result=await legacy.target.readReserved(acquired.lease);expect(result).toEqual({ok:false,reason:'protocol_refused'});
 });
 it(`${platform}: never inspects caught native Proxy prototype`,async()=>{
  const h=await runtime(platform);let inspected=0;
  const reason=new Proxy({}, {getPrototypeOf(){inspected++;throw new Error('foreign prototype inspected')}});
  h.faults.hook=async(event,next)=>{if(event.kind==='query'&&event.values?.[0]==='probe')throw reason;return next()};
  expect((await h.pair.domain.get('probe')).status).toBe('read_failed');expect(inspected).toBe(0);
 });
 it(`${platform}: queued SQL read refuses with truthful no-I/O evidence`,async()=>{
  const h=await runtime(platform),entered=deferred(),release=deferred();let block=true;
  h.faults.hook=async(event,next)=>{if(block&&event.kind==='query'){block=false;entered.resolve();await release.promise;throw new Error('first read failure')}return next()};
  const first=h.pair.domain.get('one');await entered.promise;const second=h.pair.domain.get('two');const before=h.trace.length;release.resolve();
  expect((await first).status).toBe('read_failed');expect((await second).status).toBe('read_failed');expect(h.trace).toHaveLength(before);
  expect(h.pair.health().lastDomain).toMatchObject({issued:false,outcome:'refused'});
 });
}

for(const platform of ['ios','android'] as const)for(const boundary of ['close','release'] as const)it(`${platform}: malformed ${boundary} acknowledgement retains both reservations`,async()=>{
 const h=await fixture(platform);const engine=h.options.sqlite.engine!;
 if(boundary==='close'){
  const create=engine.createConnection.bind(engine);engine.createConnection=(async(...args:Parameters<typeof create>)=>{const connection=await create(...args);return {...connection,close:async()=>false}}) as unknown as typeof engine.createConnection;
 }else engine.closeConnection=(async()=>false) as unknown as typeof engine.closeConnection;
 const migrated=await h.owner.run();if(migrated.outcome!=='candidate')throw new Error('fixture');const transfer=await h.owner.handoff(migrated.candidate);if(transfer.outcome!=='runtime')throw new Error('fixture');pairs.push(transfer.pair);
 const result=await transfer.pair.dispose();const another=await h.make();const replacement=await another.run();expect(result).toEqual({ok:false,reason:'cleanup_unconfirmed'});expect(replacement.outcome).toBe('blocked');
});

for(const platform of ['ios','android'] as const)it(`${platform}: keeps clean rollback versus unknown commit evidence`,async()=>{
 const evidence=[];
 for(const phase of ['run','commit'] as const){
  const h=await runtime(platform);let once=true;
  h.faults.hook=async(event,next)=>{if(once&&event.kind===phase){once=false;if(phase==='commit')await next();throw new Error('synthetic failed acknowledgement')}return next()};
  expect((await h.pair.domain.set('evidence-key','changed')).ok).toBe(false);
  const stored=await h.raw({kind:'query',sql:'SELECT value FROM records WHERE key=?',values:['evidence-key']});
  expect(stored).toEqual({ values: phase === 'run' ? [] : [{ value: 'changed' }] });
  evidence.push(h.pair.health().lastDomain);
  await h.pair.dispose();await disposeCombinedFixtures();
 }
 expect(evidence[0]).not.toEqual(evidence[1]);
});


// Directly observed malformed provider values, without a global rejection hook.
const masked=()=>{const p=Promise.reject(new Error('SYNTHETIC_OBSERVABLE_PROVIDER_REJECTION'));Object.defineProperty(p,'then',{value:null});return p};
for(const platform of ['ios','android'] as const)for(const method of ['read','write','remove'] as const)it(`${platform}: owns malformed fulfilled Promise at ${method} boundary`,async()=>{
 const h=await runtime(platform,{[root]:session}),q=(await h.q())!,slot=unwrap(credentialItemSlot(config,root,q.credentialEpochId,root));
 h.protectedFaults.hook=(event,next)=>event.kind===method&&event.key===slot?masked():next();
 const result=method==='read'?await h.pair.credentials.read(root):method==='write'?await h.pair.credentials.write(root,session):await h.pair.credentials.remove(root);
 expect(method==='read'?(result as { status?: string }).status==='read_failed':(result as { ok?: boolean }).ok===false).toBe(true);await new Promise(resolve=>setTimeout(resolve,0));
});
for(const dependency of ['remove','failedWriteMayLosePreviousValue'])for(const hide of [false,true])it(`owns observed malformed ${dependency} dependency hide=${hide}`,async()=>{
 let armed=false;
 const h=await fixture('ios',{}, {},binding=>new Proxy(binding,{getOwnPropertyDescriptor(target,name){if(armed&&name===dependency){const result=Promise.reject(new Error('SYNTHETIC_OBSERVED_DEPENDENCY_REJECTION'));if(hide)Object.defineProperty(result,'then',{value:null});return {value:result,writable:true,configurable:true,enumerable:true}}return Reflect.getOwnPropertyDescriptor(target,name)}}));
 const report=await h.owner.run();if(report.outcome!=='candidate')throw new Error('fixture');armed=true;
 expect(await h.owner.handoff(report.candidate)).toEqual({outcome:'refused'});await new Promise(resolve=>setTimeout(resolve,0));
});
for(const method of ['read','write','remove'] as const)it(`direct non-async masked Promise ${method} control remains owned`,async()=>{
 let armed=false;
 const h=await fixture('ios',{[root]:session},{},binding=>{const copy={...binding} as Record<string, (...args: unknown[]) => unknown>;const old=copy[method];copy[method]=(...args:unknown[])=>armed&&args[0]!==unwrap(credentialManifestSlot(config))?masked():Reflect.apply(old,binding,args);return copy});
 const report=await h.owner.run();if(report.outcome!=='candidate')throw new Error('fixture');const result=await h.owner.handoff(report.candidate);if(result.outcome!=='runtime')throw new Error('fixture');pairs.push(result.pair);armed=true;
 if(method==='read')expect((await result.pair.credentials.read(root)).status).toBe('read_failed');else if(method==='write')expect((await result.pair.credentials.write(root,session)).ok).toBe(false);else expect((await result.pair.credentials.remove(root)).ok).toBe(false);
 await new Promise(resolve=>setTimeout(resolve,0));
});


for (const platform of ["ios", "android"] as const) describe(`${platform} runtime cleanup and SQL outcome receipts`, () => {
  for (const boundary of ["close", "release"] as const) for (const response of ["object", "inner_promise"] as const) it(`retains both resources after malformed ${boundary} ${response}`, async () => {
    const h = await fixture(platform), engine = h.options.sqlite.engine!;
    const malformed = () => response === "object" ? {} : masked();
    if (boundary === "close") {
      const create = engine.createConnection;
      engine.createConnection = (async (...args: Parameters<typeof create>) => { const connection = await Reflect.apply(create, engine, args); return { ...connection, close: async () => malformed() }; }) as unknown as typeof create;
    } else engine.closeConnection = (async () => malformed()) as unknown as typeof engine.closeConnection;
    const report = await h.owner.run(); if (report.outcome !== "candidate") throw new Error("fixture");
    const result = await h.owner.handoff(report.candidate); if (result.outcome !== "runtime") throw new Error("fixture"); pairs.push(result.pair);
    expect(await result.pair.dispose()).toEqual({ ok: false, reason: "cleanup_unconfirmed" });
    const replacement = await h.make(); expect((await replacement.run()).outcome).toBe("blocked");
    expect(result.pair.health().cleanup).toMatchObject({ sqlCloseIssued: true, sqlCloseAcknowledged: boundary === "release", engineReleaseIssued: boundary === "release", engineReleaseAcknowledged: false, namespaceDrainIssued: true, namespaceDrainAcknowledged: true });
  });
  for (const boundary of ["query", "begin", "run", "commit", "rollback"] as const) it(`owns a directly observed malformed Promise at SQL ${boundary}`, async () => {
    const h = await runtime(platform); let once = true;
    h.faults.hook = (event, next) => {
      if (boundary === "rollback" && event.kind === "run") throw new Error("actual statement failed");
      if (once && event.kind === boundary && (boundary !== "query" || event.values?.[0] === "probe")) { once = false; return masked(); }
      return next();
    };
    const result = boundary === "query" ? await h.pair.domain.get("probe") : await h.pair.domain.set("probe", "x");
    expect("ok" in result ? result.ok : result.status !== "read_failed").toBe(false);
    expect(h.pair.health().domain).toBe("failed");
    if (boundary !== "query") expect(h.pair.health().lastDomain?.transaction).toMatchObject({ beginIssued: true, commitIssued: boundary === "commit", commitAcknowledged: false, rollbackIssued: boundary === "run" || boundary === "rollback", rollbackAcknowledged: boundary === "run" });
  });
  it("retains the first unverified transaction after later refused calls", async () => {
    const h = await runtime(platform); let once = true;
    h.faults.hook = async (event, next) => { if (event.kind === "commit" && once) { once = false; await next(); throw new Error("actual applied commit with lost ack"); } return next(); };
    expect((await h.pair.domain.set("unknown", "actual committed")).ok).toBe(false);
    const original = h.pair.health().firstDomainFailure;
    expect(original?.transaction).toMatchObject({ beginIssued: true, beginAcknowledged: true, statementIssued: true, statementAcknowledged: true, commitIssued: true, commitAcknowledged: false, rollbackIssued: false, rollbackAcknowledged: false });
    expect((await h.pair.domain.get("unknown")).status).toBe("read_failed");
    expect(h.pair.health().firstDomainFailure).toEqual(original); expect(h.pair.health().lastDomain).toMatchObject({ issued: false, outcome: "refused" });
    expect(Object.isFrozen(original?.transaction)).toBe(true);
  });
});


// Invalid typed PRAGMA evidence is unavailable, not a persistent data fault.
for (const platform of ["ios", "android"] as const) for (const position of [1,2]) for (const malformed of ["bad", null]) it(`${platform}: unavailable PRAGMA value ${String(malformed)} at ${position} does not create protocol fault`, async()=>{
 const h=await runtime(platform);let reads=0;
 h.faults.hook=async(event,next)=>{
   if(event.kind==="query"&&event.sql==="PRAGMA schema_version;"&&++reads===position)return {values:[{schema_version:malformed}]};
   return next();
 };
 expect((await h.pair.domain.get("probe")).status).toBe("read_failed");
 const health=h.pair.health();
 for(let i=0;i<10;i++)await new Promise(resolve=>setTimeout(resolve,0));
 const f=await h.raw({kind:"query",sql:"SELECT value FROM curling_credential_meta WHERE slot='f';"});

 expect(health).toMatchObject({domain:"failed",protocol:"healthy"});expect(f).toEqual({values:[]});
 const count = h.trace.length; expect((await h.pair.domain.get("later")).status).toBe("read_failed"); expect(h.trace).toHaveLength(count);
});

for (const platform of ["ios", "android"] as const) describe(`${platform} typed Runtime discovery evidence`, () => {
  for (const position of [1, 2]) for (const malformed of ["empty", "duplicate", "negative", "fraction", "nonfinite", "inner_promise"] as const) it(`refuses unavailable schema_version ${malformed} at observation ${position} without F`, async () => {
    const h = await runtime(platform); let reads = 0;
    h.faults.hook = async (event, next) => {
      if (event.kind === "query" && event.sql === "PRAGMA schema_version;" && ++reads === position) {
        if (malformed === "empty") return { values: [] };
        if (malformed === "duplicate") return { values: [{ schema_version: 1 }, { schema_version: 1 }] };
        const value = malformed === "negative" ? -1 : malformed === "fraction" ? 1.5 : malformed === "nonfinite" ? Infinity : masked();
        return { values: [{ schema_version: value }] };
      }
      return next();
    };
    expect((await h.pair.domain.get("probe")).status).toBe("read_failed"); expect(h.pair.health()).toMatchObject({ domain: "failed", protocol: "healthy" });
    expect(await h.raw({ kind: "query", sql: "SELECT value FROM curling_credential_meta WHERE slot='f';" })).toEqual({ values: [] });
  });
  for (const [sql, field] of [["PRAGMA table_info('records');", "cid"], ["PRAGMA index_list('records');", "unique"], ["PRAGMA index_info('sqlite_autoindex_records_1');", "seqno"]]) for (const malformed of ["text", "inner_promise"] as const) it(`refuses malformed fixed PRAGMA field ${field} ${malformed} without F`, async () => {
    const h = await runtime(platform);
    h.faults.hook = async (event, next) => {
      const result = await next();
      if (event.kind === "query" && event.sql === sql) {
        const rows = result as { values: Record<string, unknown>[] }; rows.values[0][field] = malformed === "text" ? "bad" : masked();
      }
      return result;
    };
    expect((await h.pair.domain.get("probe")).status).toBe("read_failed"); expect(h.pair.health()).toMatchObject({ domain: "failed", protocol: "healthy" });
    expect(await h.raw({ kind: "query", sql: "SELECT value FROM curling_credential_meta WHERE slot='f';" })).toEqual({ values: [] });
  });
  for (const kind of ["structure", "marker"] as const) it(`retains a real positive ${kind} contradiction as a protocol fault`, async () => {
    const h = await runtime(platform);
    await h.raw({ kind: "execute", sql: kind === "structure" ? "CREATE TABLE unexpected (value TEXT);" : "UPDATE curling_credential_meta SET value='unsupported-marker' WHERE slot='schema';" });
    expect((await h.pair.domain.get("probe")).status).toBe("read_failed"); expect(h.pair.health().protocol).toBe("faulted");
    const count = h.protectedTrace.length; expect((await h.pair.credentials.read(root)).status).toBe("read_failed"); expect(h.protectedTrace).toHaveLength(count);
  });
});


// Lazy descriptor repros: capture stops at the first malformed fixed value.
for(const platform of ["ios","android"] as const)for(const mode of ["two_values","later_value"] as const)it(`${platform}: owns every actually read malformed fixed-field value ${mode}`,async()=>{
 const h=await runtime(platform);let armed=true,seen=0;
 const rejected=()=>{const p=Promise.reject(new Error("synthetic-fixed-field-rejection"));Object.defineProperty(p,"then",{value:null});return p;};
 const row=(value:()=>unknown)=>new Proxy({schema_version:0},{getOwnPropertyDescriptor(target,key){if(key==="schema_version"){seen++;return {value:value(),writable:true,enumerable:true,configurable:true};}return Reflect.getOwnPropertyDescriptor(target,key);}});
 h.faults.hook=async(event,next)=>{
  if(armed&&event.kind==="query"&&event.sql==="PRAGMA schema_version;"){
    armed=false;return {values:[row(()=>mode==="two_values"?rejected():"bad"),row(rejected)]};
  }
  return next();
 };
 expect((await h.pair.domain.get("probe")).status).toBe("read_failed");expect(seen).toBe(1); // Immediate validation stops before the second foreign descriptor.
 expect(h.pair.health()).toMatchObject({domain:"failed",protocol:"healthy"});
 await new Promise(resolve=>setTimeout(resolve,0));
});

for (const platform of ["ios", "android"] as const) describe(`${platform} bounded fixed-field capture`, () => {
  for (const mode of ["later_promise", "later_throw"] as const) it(`owns observed fixed values and stops before an unobserved third row: ${mode}`, async () => {
    const h = await runtime(platform); let seen = 0;
    const row = (index: number) => new Proxy({ schema_version: 0 }, { getOwnPropertyDescriptor(target, name) {
      if (name === "schema_version") {
        seen++; if (index === 1) return { value: 0, configurable: true, writable: true, enumerable: true };
        if (mode === "later_throw") throw new Error("synthetic descriptor failure");
        return { value: masked(), configurable: true, writable: true, enumerable: true };
      }
      return Reflect.getOwnPropertyDescriptor(target, name);
    } });
    h.faults.hook = async (event, next) => event.kind === "query" && event.sql === "PRAGMA schema_version;" ? { values: [row(1), row(2), row(3)] } : next();
    expect((await h.pair.domain.get("probe")).status).toBe("read_failed"); expect(seen).toBe(2);
    expect(h.pair.health()).toMatchObject({ domain: "failed", protocol: "healthy" });
  });
  for (const kind of ["domain_value", "metadata_value", "begin_count", "statement_count", "commit_count", "rollback_count"] as const) it(`owns an actually observed malformed ${kind} fixed value`, async () => {
    const h = await runtime(platform); let once = true;
    h.faults.hook = async (event, next) => {
      if (kind === "rollback_count" && event.kind === "run") throw new Error("statement failure");
      const matches = kind === "domain_value" ? event.kind === "query" && event.values?.[0] === "probe" : kind === "metadata_value" ? event.kind === "query" && event.values?.[0] === "q" : kind === "begin_count" ? event.kind === "begin" : kind === "statement_count" ? event.kind === "run" : kind === "commit_count" ? event.kind === "commit" : event.kind === "rollback";
      if (once && matches) { once = false; return kind.endsWith("value") ? { values: [{ value: masked() }] } : { changes: { changes: masked() } }; }
      return next();
    };
    const result = kind.endsWith("value") ? await h.pair.domain.get("probe") : await h.pair.domain.set("probe", "x");
    expect("ok" in result ? result.ok : result.status !== "read_failed").toBe(false); expect(h.pair.health()).toMatchObject({ domain: "failed", protocol: "healthy" });
    expect(await h.raw({ kind: "query", sql: "SELECT value FROM curling_credential_meta WHERE slot='f';" })).toEqual({ values: [] });
  });
});


// Positive independent regression: normalized boundary failures.
for (const platform of ["ios","android"] as const)for(const shape of ["missing_values","wrong_values_type","null_row","extra_column"] as const)it(`${platform}: malformed addressed SELECT ${shape} is unavailable not F`,async()=>{
 const h=await runtime(platform);
 h.faults.hook=async(event,next)=>{
  if(event.kind==="query"&&event.values?.[0]==="probe")return shape==="missing_values"?{}:shape==="wrong_values_type"?{values:null}:shape==="null_row"?{values:[null]}:{values:[{value:"ordinary",extra:"malformed"}]};
  return next();
 };
 expect((await h.pair.domain.get("probe")).status).toBe("read_failed");
 const protocol=h.pair.health().protocol;
 for(let i=0;i<10;i++)await new Promise(resolve=>setTimeout(resolve,0));
 const f=await h.raw({kind:"query",sql:"SELECT value FROM curling_credential_meta WHERE slot='f';"});

 expect(protocol).toBe("healthy");expect(f).toEqual({values:[]});
});


// Positive independent regression: normalized boundary failures.
for(const platform of ["ios","android"] as const)for(const boundary of ["read_value","remove_kind"] as const)it(`${platform}: owns directly read protected ${boundary} field`,async()=>{
 const h=await runtime(platform,{[root]:session}),q=(await h.q())!,slot=unwrap(credentialItemSlot(config,root,q.credentialEpochId,root));let seen=0;
 const malformed=()=>{const p=Promise.reject(new Error("synthetic-observed-protected-field"));Object.defineProperty(p,"then",{value:null});return p;};
 h.protectedFaults.hook=async(event,next)=>{
  if(event.key===slot&&event.kind===(boundary==="read_value"?"read":"remove")){
   const field=boundary==="read_value"?"value":"kind",shape=boundary==="read_value"?{kind:"value",value:""}:{kind:"deleted"};
   return new Proxy(shape,{getOwnPropertyDescriptor(target,name){if(name===field){seen++;return {value:malformed(),configurable:true,writable:true,enumerable:true};}return Reflect.getOwnPropertyDescriptor(target,name);}});
  }
  return next();
 };
 const result=boundary==="read_value"?await h.pair.credentials.read(root):await h.pair.credentials.remove(root);
 expect("ok" in result?result.ok:result.status!=="read_failed").toBe(false);expect(seen).toBe(1);
 expect(h.pair.health()).toMatchObject({credential:"failed",protocol:"healthy"});
 await new Promise(resolve=>setTimeout(resolve,0));
});

for (const platform of ["ios", "android"] as const) it(`${platform}: stops protected capture after invalid kind before reading an unobserved value`, async () => {
  const h = await runtime(platform, { [root]: session }); const q = await h.q(); if (!q) throw new Error("fixture");
  const slot = unwrap(credentialItemSlot(config, root, q.credentialEpochId, root)); let kinds = 0, values = 0;
  h.protectedFaults.hook = async (event, next) => {
    if (event.kind === "read" && event.key === slot) return new Proxy({ kind: "value", value: "" }, { getOwnPropertyDescriptor(target, name) {
      if (name === "kind") { kinds++; return { value: masked(), writable: true, configurable: true, enumerable: true }; }
      if (name === "value") { values++; return { value: masked(), writable: true, configurable: true, enumerable: true }; }
      return Reflect.getOwnPropertyDescriptor(target, name);
    } });
    return next();
  };
  expect((await h.pair.credentials.read(root)).status).toBe("read_failed"); expect(kinds).toBe(1); expect(values).toBe(0);
  expect(h.pair.health()).toMatchObject({ credential: "failed", protocol: "healthy", domain: "healthy" });
});
