import { afterEach, describe, expect, it } from "vitest";
import { createNativeCredentialMigrationPort, type NativeCredentialMigrationPort } from "../nativeCredentialMigrationPort";
import { credentialItemSlot, credentialManifestSlot } from "../credentialPhysicalSlots";
import { fixedCredentialSlots } from "../../supabase/providerCredentialContract";
import { serializeI, serializeM } from "../credentialProtocol";
import { isPlatformCredentialFingerprint } from "../platformCredentialFingerprint";
import { createNativeSecureCredentialStore, SECURE_CREDENTIAL_NAMESPACE, type SecureStorageBinding } from "../secureCredentialStore";
import type { CredentialNamespaceLease } from "../nativeCredentialNamespace";
const root = "sb-fixture-auth-token", config = "pc1:fixture";
const id = "00000001-1111-4111-8111-111111111111";
const otherId = "00000002-1111-4111-8111-111111111111";
const unwrap = <T,>(r: { ok: true; value: T } | { ok: false }): T => { if (!r.ok) throw new Error("synthetic fixture invalid"); return r.value; };
const manifestSlot = unwrap(credentialManifestSlot(config));
const itemSlot = unwrap(credentialItemSlot(config, root, id, root));
const session = '{"access_token":"SYNTHETIC_ACCESS","refresh_token":"SYNTHETIC_REFRESH","expires_at":100,"expires_in":1,"token_type":"bearer"}';
const item = { schemaVersion: 1, protocolId: id, credentialEpochId: id, originManifestId: id, providerConfigIdentity: config, sdkContractVersion: "auth-js/2.112.3:credential-v1", key: root, value: session };
const itemRaw = unwrap(serializeI(item, root));
const manifest = { schemaVersion: 1, protocolId: id, credentialEpochId: id, manifestId: id, providerConfigIdentity: config, sdkContractVersion: item.sdkContractVersion, sessionStorageKey: root, expectedStoreIdentity: id, initialEntryKeys: [], fixedSlots: fixedCredentialSlots(root).map(slot => ({ ...slot, presence: "absent" })), items: [] };
const manifestRaw = unwrap(serializeM(manifest, isPlatformCredentialFingerprint));
type Call = { kind: "configure" | "inventory" | "read" | "write" | "remove"; key?: string; options?: unknown };
type Hook = (call: Call, next: () => Promise<unknown>) => Promise<unknown>;
function fixture() {
  const values = new Map<string, string>(), trace: Call[] = [];
  const faults: { hook?: Hook } = {};
  const invoke = (event: Call, next: () => Promise<unknown>) => { trace.push(event); return faults.hook ? faults.hook(event, next) : next(); };
  const binding: SecureStorageBinding & { inventory(): Promise<unknown> } = {
    failedWriteMayLosePreviousValue: true,
    async configure(options) { return await invoke({ kind: "configure", options }, async () => undefined) as void; },
    async inventory() { return invoke({ kind: "inventory" }, async () => ({ kind: "complete", keys: [...values.keys()].sort() })); },
    async read(key) { return await invoke({ kind: "read", key }, async () => values.has(key) ? { kind: "value", value: values.get(key) } : { kind: "established_absent" }) as Awaited<ReturnType<SecureStorageBinding["read"]>>; },
    async write(key, raw) { return await invoke({ kind: "write", key }, async () => { values.set(key, raw); }) as void; },
    async remove(key) { return await invoke({ kind: "remove", key }, async () => ({ kind: values.delete(key) ? "deleted" : "nothing_to_delete" })) as Awaited<ReturnType<SecureStorageBinding["remove"]>>; },
  };
  return { binding, values, trace, faults };
}
function port(h = fixture(), extra: Record<string, unknown> = {}): NativeCredentialMigrationPort {
  return unwrap(createNativeCredentialMigrationPort({ providerConfigIdentity: config, sessionStorageKey: root, binding: h.binding, detectPlatform: () => "ios", ...extra }));
}
const owned: { port: NativeCredentialMigrationPort; lease: CredentialNamespaceLease }[] = [];
const unblocks: (() => void)[] = [];
async function acquire(p: NativeCredentialMigrationPort) {
  const r = await p.acquire(); if (!r.ok) throw new Error("synthetic lease unavailable");
  owned.push({ port: p, lease: r.lease }); return r.lease;
}
function deferred() { let finish!: () => void; const promise = new Promise<void>(r => { finish = r; }); unblocks.push(() => finish()); return { promise, finish: () => finish() }; }
afterEach(async () => {
  while (unblocks.length) unblocks.pop()!();
  while (owned.length) { const h = owned.pop()!; await h.port.release(h.lease); }
});

describe("dormant S3c protected migration port", () => {
  it("constructs/acquires without binding I/O and keeps the complete namespace uncached and frozen", async () => {
    const h = fixture();
    for (const key of ["legacy_raw", "unknown-future", unwrap(credentialManifestSlot("pc1:other")), unwrap(credentialItemSlot(config, root, otherId, root))]) h.values.set(key, "PRIVATE");
    const p = port(h), lease = await acquire(p);
    expect(Object.isFrozen(p)).toBe(true); expect(Object.isFrozen(lease)).toBe(true);
    expect(Object.keys(p).sort()).toEqual(["acquire", "insert", "inspectNamespace", "leaseState", "readSlot", "release"]);
    expect(h.trace).toEqual([]);
    const r = await p.inspectNamespace(lease);
    expect(r).toEqual({ status: "complete", keys: [...h.values.keys()].sort() });
    if (r.status === "complete") expect(Object.isFrozen(r.keys)).toBe(true);
    h.values.set("another_unknown", "retained");
    expect(await p.inspectNamespace(lease)).toEqual({ status: "complete", keys: [...h.values.keys()].sort() });
    expect(h.trace.map(e => e.kind)).toEqual(["configure", "inventory", "inventory"]);
    expect(h.trace[0].options).toEqual({ keyPrefix: SECURE_CREDENTIAL_NAMESPACE, synchronize: false, iosAccess: "afterFirstUnlockThisDeviceOnly" });
  });

  for (const platform of ["android", "web", "unsupported_native", "throw"]) {
    it(`refuses ${platform} before any binding I/O`, async () => {
      const h = fixture(), p = port(h, { detectPlatform: () => { if (platform === "throw") throw "PRIVATE"; return platform; } });
      expect(await p.acquire()).toEqual({ ok: false, reason: "platform_unsupported" });
      expect(h.trace).toEqual([]); expect(p.leaseState()).toBe("unowned");
    });
  }
  it("does not read forbidden remove/clear properties, captures methods once and preserves receiver", async () => {
    const h = fixture();
    Object.defineProperty(h.binding, "remove", { get() { throw new Error("must not inspect remove"); } });
    Object.defineProperty(h.binding, "clear", { get() { throw new Error("must not inspect clear"); } });
    h.binding.inventory = async function() { expect(this).toBe(h.binding); return { kind: "complete", keys: [] }; };
    const p = port(h); h.binding.inventory = async () => { throw "later mutation"; };
    const lease = await acquire(p);
    expect(await p.inspectNamespace(lease)).toEqual({ status: "complete", keys: [] });
  });
  it("rejects invalid config/dependencies without storage calls or coercion", () => {
    const h = fixture();
    for (const bad of [null, 1, {}, { providerConfigIdentity: config, sessionStorageKey: root, binding: {} },
      { get providerConfigIdentity() { throw "PRIVATE"; }, sessionStorageKey: root }]) {
      expect(createNativeCredentialMigrationPort(bad).ok).toBe(false);
    }
    expect(createNativeCredentialMigrationPort({ providerConfigIdentity: "wrong", sessionStorageKey: root })).toEqual({ ok: false, reason: "invalid_configuration" });
    expect(createNativeCredentialMigrationPort({ providerConfigIdentity: config, sessionStorageKey: "wrong" })).toEqual({ ok: false, reason: "invalid_configuration" });
    expect(h.trace).toEqual([]);
  });

  it("shares one actual lease across bindings/configs and refuses stale/copied leases without I/O", async () => {
    const h = fixture(), p = port(h), q = port(fixture(), { providerConfigIdentity: "pc1:other" }), lease = await acquire(p);
    expect(await q.acquire()).toEqual({ ok: false, reason: "lease_held" });
    expect(await p.readSlot({ id: lease.id }, itemSlot)).toEqual({ status: "refused", reason: "wrong_lease" });
    expect(await p.release({ id: lease.id })).toEqual({ ok: false, reason: "wrong_lease" });
    expect(p.leaseState()).toBe("owned"); expect(h.trace).toEqual([]);
    await p.release(lease);
    const next = await acquire(p);
    expect(await p.inspectNamespace(lease)).toEqual({ status: "refused", reason: "wrong_lease" });
    expect(next).not.toBe(lease);
  });

  for (const ordinaryKind of ["read", "write", "remove"] as const) {
    it(`refuses ordinary ${ordinaryKind} at call time even behind queued release`, async () => {
      const h = fixture(), p = port(h), lease = await acquire(p);
      const a = createNativeSecureCredentialStore({ binding: h.binding, detectPlatform: () => "ios" });
      const b = createNativeSecureCredentialStore({ binding: fixture().binding, detectPlatform: () => "ios" });
      const freeing = p.release(lease);
      const results = await Promise.all([a, b].map(store => ordinaryKind === "read" ? store.read(root) : ordinaryKind === "write" ? store.write(root, "ordinary") : store.remove(root)));
      expect(results).toEqual(Array.from({ length: 2 }, () => ordinaryKind === "read" ? { status: "read_failed", error: { kind: "store_inaccessible" } } : ordinaryKind === "write" ? { ok: false, error: { kind: "store_inaccessible" }, previousValueMayBeLost: false } : { ok: false, error: { kind: "store_inaccessible" } }));
      expect(await freeing).toEqual({ ok: true }); expect(h.trace).toEqual([]);
      expect((await a.read(root)).status).toBe("absent");
    });
  }

  it("waits for already issued ordinary work and refuses ordinary work queued behind acquisition", async () => {
    const h = fixture(), at = deferred(), held = deferred();
    h.faults.hook = async (e, next) => { if (e.kind === "read") { at.finish(); await held.promise; } return next(); };
    const ordinary = createNativeSecureCredentialStore({ binding: h.binding, detectPlatform: () => "ios" });
    const read = ordinary.read(root); await at.promise;
    const p = port(h); let acquired = false;
    const taking = acquire(p).then(r => { acquired = true; return r; });
    const behind = ordinary.write(root, "must not run");
    await Promise.resolve(); expect(acquired).toBe(false);
    held.finish();
    expect(await read).toEqual({ status: "absent" });
    await taking;
    expect(await behind).toEqual({ ok: false, error: { kind: "store_inaccessible" }, previousValueMayBeLost: false });
    expect(h.trace.some(e => e.kind === "write")).toBe(false);
  });

  it("serializes complete ordinary operations and configuration across different store/binding instances", async () => {
    const h = fixture(), g = fixture(), at = deferred(), held = deferred();
    h.faults.hook = async (e, next) => { if (e.kind === "configure") { at.finish(); await held.promise; } return next(); };
    const a = createNativeSecureCredentialStore({ binding: h.binding, detectPlatform: () => "ios" });
    const b = createNativeSecureCredentialStore({ binding: g.binding, detectPlatform: () => "ios" });
    const first = a.read(root); await at.promise;
    const second = b.write(root, "ordinary value");
    await Promise.resolve(); expect(g.trace).toEqual([]);
    held.finish();
    expect(await first).toEqual({ status: "absent" });
    expect(await second).toEqual({ ok: true });
    expect(h.trace.map(e => e.kind)).toEqual(["configure", "read"]);
    expect(g.trace.map(e => e.kind)).toEqual(["configure", "write"]);
  });

  it("performs fresh native per-slot reads without borrowing absence from inventory", async () => {
    const h = fixture(), p = port(h), lease = await acquire(p);
    expect(await p.readSlot(lease, itemSlot)).toEqual({ status: "absent" });
    h.values.set(itemSlot, "opaque exact raw");
    expect(await p.readSlot(lease, itemSlot)).toEqual({ status: "value", value: "opaque exact raw" });
    expect(h.trace.map(e => e.kind)).toEqual(["configure", "read", "read"]);
  });
  for (const value of [null, { kind: "complete" }, { kind: "complete", keys: ["a", "a"] }, { kind: "complete", keys: ["z", "a"] }, { kind: "complete", keys: ["\ud800"] }, { kind: "inaccessible" }]) {
    it("faults on malformed/incomplete inventory and never converts it into empty", async () => {
      const h = fixture(); h.faults.hook = async (e, next) => e.kind === "inventory" ? value : next();
      const p = port(h), lease = await acquire(p);
      expect(await p.inspectNamespace(lease)).toEqual({ status: "unavailable" });
      const mark = h.trace.length;
      expect(await p.readSlot(lease, itemSlot)).toEqual({ status: "refused", reason: "faulted" });
      expect(await p.insert(lease, itemSlot, itemRaw)).toEqual({ status: "refused", reason: "faulted" });
      expect(h.trace).toHaveLength(mark);
    });
  }
  for (const value of [null, { kind: "no_absence_evidence" }, { kind: "established_absent", extra: true }, { kind: "value", value: null }]) {
    it("faults ambiguous or malformed per-item evidence with no write", async () => {
      const h = fixture(); h.faults.hook = async (e, next) => e.kind === "read" ? value : next();
      const p = port(h), lease = await acquire(p);
      expect(await p.insert(lease, itemSlot, itemRaw)).toEqual({ status: "not_issued", reason: "evidence_unavailable" });
      expect(h.trace.some(e => e.kind === "write")).toBe(false); expect(p.leaseState()).toBe("faulted");
    });
  }

  for (const [slot, raw] of [[manifestSlot, manifestRaw], [itemSlot, itemRaw]]) {
    it("validates and inserts immutable M/I bytes once, with separate real readback", async () => {
      const h = fixture(), p = port(h), lease = await acquire(p);
      expect(await p.insert(lease, slot, raw)).toEqual({ status: "verified", writeIssued: true, writeAcknowledged: true, readbackVerified: true });
      expect(h.values.get(slot)).toBe(raw);
      expect(await p.insert(lease, slot, raw)).toEqual({ status: "already_present" });
      expect(h.trace.map(e => e.kind)).toEqual(["configure", "read", "write", "read", "read"]);
    });
  }
  it("preserves a different existing value rather than overwriting it", async () => {
    const h = fixture(); h.values.set(itemSlot, "existing unknown bytes");
    const p = port(h), lease = await acquire(p);
    expect(await p.insert(lease, itemSlot, itemRaw)).toEqual({ status: "already_present" });
    expect(h.values.get(itemSlot)).toBe("existing unknown bytes");
    expect(h.trace.some(e => e.kind === "write")).toBe(false);
  });
  for (const badRaw of [JSON.stringify({ ...item, providerConfigIdentity: "pc1:other" }), JSON.stringify({ ...item, credentialEpochId: otherId }), JSON.stringify({ ...item, key: root + "-code-verifier" }), "{}", 1]) {
    it("rejects input/header/address mismatches before binding I/O", async () => {
      const h = fixture(), p = port(h), lease = await acquire(p);
      expect((await p.insert(lease, itemSlot, badRaw)).status).toBe("not_issued");
      expect(h.trace).toEqual([]);
    });
  }

  for (const mode of ["reject-before", "reject-after", "invalid-ack", "bad-readback", "missing-readback", "reject-readback"] as const) {
    it(`retains truthful issued/unverified state after ${mode}, without retry or healing`, async () => {
      const h = fixture(); let reads = 0;
      h.faults.hook = async (e, next) => {
        if (e.kind === "write") {
          if (mode === "reject-before") throw "PRIVATE";
          const r = await next();
          if (mode === "reject-after") throw "PRIVATE";
          return mode === "invalid-ack" ? {} : r;
        }
        if (e.kind === "read" && ++reads === 2) {
          if (mode === "bad-readback") return { kind: "value", value: "changed" };
          if (mode === "missing-readback") return { kind: "established_absent" };
          if (mode === "reject-readback") throw "PRIVATE";
        }
        return next();
      };
      const p = port(h), lease = await acquire(p);
      const r = await p.insert(lease, itemSlot, itemRaw);
      expect(r).toMatchObject({ status: "unverified", writeIssued: true, writeAcknowledged: ["bad-readback", "missing-readback", "reject-readback"].includes(mode) });
      expect(JSON.stringify(r)).not.toContain("PRIVATE");
      expect(p.leaseState()).toBe("faulted");
      expect(reads).toBe(["bad-readback", "missing-readback", "reject-readback"].includes(mode) ? 2 : 1);
      const mark = h.trace.length;
      expect(await p.insert(lease, itemSlot, itemRaw)).toEqual({ status: "refused", reason: "faulted" });
      expect(h.trace).toHaveLength(mark);
      expect(h.values.has(itemSlot)).toBe(mode !== "reject-before");
    });
  }

  for (const mode of ["throw", "invalid", "reject"]) {
    it(`faults configuration ${mode} before any further I/O`, async () => {
      const h = fixture();
      h.faults.hook = async (e, next) => {
        if (e.kind === "configure") {
          if (mode === "invalid") return 17;
          if (mode === "reject") return Promise.reject("PRIVATE");
          throw "PRIVATE";
        }
        return next();
      };
      const p = port(h), lease = await acquire(p);
      expect(await p.inspectNamespace(lease)).toEqual({ status: "unavailable" });
      expect(p.leaseState()).toBe("faulted");
      expect(await p.readSlot(lease, itemSlot)).toEqual({ status: "refused", reason: "faulted" });
      expect(h.trace.map(e => e.kind)).toEqual(["configure"]);
    });
  }
  for (const boundary of ["configure", "absence", "write", "readback"] as const) {
    it(`honestly reports cancellation after ${boundary} with no further native effects`, async () => {
      const h = fixture(); let live = true, reads = 0;
      h.faults.hook = async (e, next) => {
        const r = await next();
        if (e.kind === "read") reads++;
        if ((boundary === "configure" && e.kind === "configure") || (boundary === "absence" && reads === 1) ||
          (boundary === "write" && e.kind === "write") || (boundary === "readback" && reads === 2)) live = false;
        return r;
      };
      const p = port(h), lease = await acquire(p);
      expect(await p.insert(lease, itemSlot, itemRaw, { proceed: () => live })).toEqual(
        ["write", "readback"].includes(boundary) ? { status: "unverified", writeIssued: true, writeAcknowledged: true, reason: "cancelled" } : { status: "refused", reason: "cancelled" });
      expect(h.trace.map(e => e.kind)).toEqual(boundary === "configure" ? ["configure"] : boundary === "absence" ? ["configure", "read"] : boundary === "write" ? ["configure", "read", "write"] : ["configure", "read", "write", "read"]);
    });
  }
  it("does not inspect opaque thrown values or accessor evidence", async () => {
    const h = fixture(); let inspected = 0;
    const reason: object = new Proxy({}, { get() { inspected++; throw reason; }, getPrototypeOf() { inspected++; throw reason; } });
    h.faults.hook = async (e, next) => { if (e.kind === "read") throw reason; return next(); };
    const p = port(h), lease = await acquire(p);
    expect(await p.readSlot(lease, itemSlot)).toEqual({ status: "read_failed" });
    expect(inspected).toBe(0);
    await p.release(lease);
    const g = fixture(); let getters = 0;
    g.faults.hook = async (e, next) => e.kind === "read" ? Object.defineProperty({}, "kind", { get() { getters++; return "established_absent"; } }) : next();
    const q = port(g), second = await acquire(q);
    expect(await q.readSlot(second, itemSlot)).toEqual({ status: "read_failed" });
    expect(getters).toBe(0);
  });
  it("refuses invalid/foreign slots and over-budget values before native I/O", async () => {
    const h = fixture(), p = port(h), lease = await acquire(p);
    for (const slot of ["raw-legacy", unwrap(credentialManifestSlot("pc1:other")), null, itemSlot + "\n"]) {
      expect(await p.readSlot(lease, slot)).toEqual({ status: "refused", reason: "invalid_slot" });
    }
    expect(await p.insert(lease, manifestSlot, "x".repeat(1_048_577))).toEqual({ status: "not_issued", reason: "limit_exceeded" });
    expect(h.trace).toEqual([]);
  });
  it("owns a masked native promise result without using its hostile own then", async () => {
    const h = fixture(); let ownThenReads = 0;
    // Preserve the actual Promise at the captured method boundary (an async
    // wrapper would itself assimilate it before this port could observe it).
    const inventory = Promise.resolve({ kind: "complete", keys: [] });
    Object.defineProperty(inventory, "then", { get() { ownThenReads++; throw "PRIVATE"; } });
    Object.assign(h.binding, { inventory: () => inventory });
    const p = port(h), lease = await acquire(p);
    expect(await p.inspectNamespace(lease)).toEqual({ status: "complete", keys: [] });
    expect(ownThenReads).toBe(0);
  });

  for (const boundary of ["configure", "inventory", "read", "write"] as const) {
    for (const mode of ["callback", "getter"] as const) {
      it(`rechecks owner after a reentrant ${mode} release immediately before ${boundary}`, async () => {
        const h = fixture(), p = port(h), lease = await acquire(p);
        if (boundary !== "configure") { await p.inspectNamespace(lease); h.trace.length = 0; }
        let checks = 0, afterAbsence = 0;
        let freeing: ReturnType<NativeCredentialMigrationPort["release"]> | undefined;
        const gate = () => {
          checks++;
          const atBoundary = boundary === "write"
            ? h.trace.some(e => e.kind === "read") && ++afterAbsence === 2
            : checks === 2;
          if (!freeing && atBoundary) freeing = p.release(lease);
          return true;
        };
        const control = mode === "callback" ? { proceed: gate } : { get proceed() { gate(); return undefined; } };
        const r = boundary === "configure" || boundary === "inventory" ? await p.inspectNamespace(lease, control) :
          boundary === "read" ? await p.readSlot(lease, itemSlot, control) : await p.insert(lease, itemSlot, itemRaw, control);
        expect(freeing).toBeDefined();
        expect(r).toEqual({ status: "refused", reason: "cancelled" });
        expect(h.trace.map(e => e.kind)).toEqual(boundary === "write" ? ["read"] : []);
        expect(h.values.has(itemSlot)).toBe(false);
        expect(await freeing).toEqual({ ok: true });
      });
    }
  }
  it("keeps actual write acknowledgement while stopping reentrant release before readback", async () => {
    const h = fixture(), p = port(h), lease = await acquire(p);
    let freeing: ReturnType<NativeCredentialMigrationPort["release"]> | undefined;
    const r = await p.insert(lease, itemSlot, itemRaw, { proceed: () => {
      if (!freeing && h.trace.some(e => e.kind === "write")) freeing = p.release(lease);
      return true;
    } });
    expect(r).toEqual({ status: "unverified", writeIssued: true, writeAcknowledged: true, reason: "cancelled" });
    expect(h.trace.map(e => e.kind)).toEqual(["configure", "read", "write"]);
    expect(h.values.get(itemSlot)).toBe(itemRaw);
    expect(await freeing).toEqual({ ok: true });
  });

  for (const boundary of ["configure", "read", "write"] as const) {
    it(`holds pending ${boundary} through release, then stops further I/O and preserves issued work`, async () => {
      const h = fixture(), at = deferred(), held = deferred();
      h.faults.hook = async (e, next) => { if (e.kind === boundary) { at.finish(); await held.promise; } return next(); };
      const p = port(h), lease = await acquire(p);
      let settled = false;
      const writing = p.insert(lease, itemSlot, itemRaw).then(r => { settled = true; return r; });
      await at.promise;
      const freeing = p.release(lease);
      expect(p.leaseState()).toBe("releasing");
      expect(await port(fixture()).acquire()).toEqual({ ok: false, reason: "lease_held" });
      await Promise.resolve(); expect(settled).toBe(false);
      held.finish();
      expect(await writing).toEqual(boundary === "write" ? { status: "unverified", writeIssued: true, writeAcknowledged: true, reason: "cancelled" } : { status: "refused", reason: "cancelled" });
      expect(await freeing).toEqual({ ok: true });
      expect(h.trace.map(e => e.kind)).toEqual(boundary === "configure" ? ["configure"] : boundary === "read" ? ["configure", "read"] : ["configure", "read", "write"]);
    });
  }
});
