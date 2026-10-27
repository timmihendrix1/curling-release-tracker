// Focused port fixture delegates the old identity owner to the genuine new
// constructor: real seven-object SQLite/runtime/lease, synthetic bridge only.
// Actual eight-object source-host integration is exercised separately in M1b.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setup, protectedArchive, basic, disposeTransferFixtures } from "./installationTransferTestFixture";
import type { prepareTransferIdentityCredentialRuntime } from "../nativeCredentialMigrationPort";
const owners: { close(): Promise<unknown> }[] = [];
beforeEach(() => vi.resetModules());
afterEach(async () => { for (const owner of owners.splice(0)) await owner.close(); await disposeTransferFixtures(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function deferred() { let resolve!: (v?: unknown) => void; const promise = new Promise<unknown>(r => { resolve = r; }); return { promise, resolve }; }
const pause = () => new Promise(r => setTimeout(r, 5));
async function fixture(runtime = true) {
  const sql = await setup(), values = new Map<string, string>(), trace: string[] = [];
  const hooks: { read?: (key: string) => unknown; write?: (key: string, value: string) => unknown; inventory?: () => unknown } = {};
  const binding = { failedWriteMayLosePreviousValue: false, configure: async () => {},
    inventory: () => { trace.push("inventory"); return hooks.inventory ? hooks.inventory() : { kind: "complete", keys: [...values.keys()].sort() }; },
    read: (key: string) => { trace.push("read:" + key); return hooks.read ? hooks.read(key) : values.has(key) ? { kind: "value", value: values.get(key) } : { kind: "established_absent" }; },
    write: (key: string, raw: string) => { trace.push("write:" + key); if (hooks.write) return hooks.write(key, raw); values.set(key, raw); },
    remove: async (key: string) => ({ kind: values.delete(key) ? "deleted" : "nothing_to_delete" }),
  };
  const portModule = await import("../nativeCredentialMigrationPort"), protocol = await import("../installationTransferPublicationProtocol");
  vi.spyOn(portModule, "createTransferCredentialMigrationPort").mockImplementation(portModule.createPublicationTransferCredentialMigrationPort);
  const actual = portModule.prepareTransferIdentityCredentialRuntime;
  let args!: Parameters<typeof prepareTransferIdentityCredentialRuntime>;
  vi.spyOn(portModule, "prepareTransferIdentityCredentialRuntime").mockImplementation((...a) => { args = a; return actual(...a); });
  const pairing = await import("../installationTransferPairing");
  const owner = pairing.createInstallationTransferIdentityOwner({ sqlite: sql.options, protectedBinding: binding, providerConfigIdentity: "pc1:synthetic", sessionStorageKey: "sb-synthetic-auth-token", detectPlatform: () => "ios" }); owners.push(owner);
  const archive = await protectedArchive(basic()); expect(await owner.pair(archive.protectedWire, archive.recoveryCode)).toMatchObject({ code: "paired" });
  const pair = runtime ? await owner.handoff() : null;
  if (runtime) expect(pair).not.toBeNull();
  const cap = runtime ? portModule.publicationTransferCredentialCapability(args[0])! : null;
  const raw = () => protocol.serializePublicationAnchor({ schemaVersion: 1, protocol: "curling-installation-publication-v1", publicationId: "50000000-0000-4000-8000-000000000005", providerConfigIdentity: args[3].providerConfigIdentity, sessionStorageKey: args[3].sessionStorageKey, sdkContractVersion: args[3].sdkContractVersion, protocolId: args[3].protocolId, credentialEpochId: args[3].credentialEpochId, manifestId: args[3].manifestId, storeIdentity: args[3].storeIdentity, packageDigest: archive.packageDigest, sourceDenialDigest: "b".repeat(64), protectedWireDigest: "c".repeat(64), preparedDigest: "d".repeat(64), profiles: ["10000000-0000-4000-8000-000000000001"], selectedProfileId: "10000000-0000-4000-8000-000000000001", accountScopeId: "synthetic-account", controlRevision: 4, workingLayout: "installation-live-ascii-v1" })!;
  return { sql, values, trace, hooks, binding, portModule, protocol, owner, pair: pair!, cap: cap!, args: () => args, raw, slot: protocol.publicationAnchorSlot("pc1:synthetic")!, read: () => cap!.read(args[2], args[3], args[4]), insert: (value = raw()) => cap!.insert(args[2], args[3], args[4], value) };
}
it("positively observes absence, inserts with readback, and treats an equal retry as pre-existing", async () => {
  const f = await fixture(), absent = await f.read(); expect(absent.status).toBe("observed");
  if (absent.status !== "observed") throw null;
  expect(f.protocol.readPublicationAnchorObservation(absent.observation)?.raw).toBeNull();
  const result = await f.insert(); expect(result).toMatchObject({ status: "observed", inserted: true });
  if (result.status !== "observed") throw null;
  expect(f.protocol.readPublicationAnchorObservation(result.observation)?.raw).toBe(f.raw());
  const n = f.trace.filter(x => x === "write:" + f.slot).length;
  expect(await f.insert()).toMatchObject({ status: "observed", inserted: false }); expect(f.trace.filter(x => x === "write:" + f.slot)).toHaveLength(n);
  expect(f.protocol.readPublicationAnchorObservation({ ...result.observation })).toBeNull();
  let traps = 0; expect(f.protocol.readPublicationAnchorObservation(new Proxy(result.observation, { get() { traps++; throw null; } }))).toBeNull(); expect(traps).toBe(0);
  const args = f.args(); expect(f.portModule.publicationTransferCredentialCapability({ ...args[0] })).toBeNull();
  expect(await f.owner.close()).toMatchObject({ code: "closed" }); expect(f.protocol.readPublicationAnchorObservation(result.observation)).toBeNull();
});
it("accepts legitimate SDK entry additions, replacements and removals during runtime", async () => {
  const f = await fixture(), key = "sb-synthetic-auth-token-code-verifier";
  expect(await f.pair.credentials.write(key, JSON.stringify("x".repeat(43)))).toEqual({ ok: true }); expect(await f.read()).toMatchObject({ status: "observed" });
  expect(await f.pair.credentials.write(key, JSON.stringify("y".repeat(43)))).toEqual({ ok: true }); expect(await f.insert()).toMatchObject({ inserted: true });
  expect(await f.pair.credentials.remove(key)).toMatchObject({ ok: true }); expect(await f.read()).toMatchObject({ status: "observed" });
});
it.each(["missing", "different", "malformed", "manifest", "foreign", "epoch", "orphan", "inventory_missing", "unreadable"])("holds contradictory %s without repair", async mode => {
  const f = await fixture(); expect(await f.insert()).toMatchObject({ inserted: true }); const before = f.raw();
  if (mode === "missing") f.values.delete(f.slot);
  if (mode === "different") { const a = f.protocol.parsePublicationAnchor(before)!; f.values.set(f.slot, f.protocol.serializePublicationAnchor({ ...a, controlRevision: 5 })!); }
  if (mode === "malformed") f.values.set(f.slot, "invalid");
  if (mode === "manifest") for (const key of f.values.keys()) if (key.startsWith("m1.")) f.values.set(key, "changed");
  if (mode === "foreign") f.values.set("foreign", "x");
  if (mode === "epoch" || mode === "orphan") { const { credentialItemSlot } = await import("../credentialPhysicalSlots"); const a = f.args(); const slot = credentialItemSlot("pc1:synthetic", "sb-synthetic-auth-token", mode === "epoch" ? "90000000-0000-4000-8000-000000000009" : a[3].credentialEpochId, "sb-synthetic-auth-token-code-verifier"); if (!slot.ok) throw null; f.values.set(slot.value, "bad"); }
  if (mode === "inventory_missing") f.hooks.inventory = () => ({ kind: "complete", keys: [] });
  if (mode === "unreadable") f.hooks.read = () => ({ kind: "unreadable" });
  const writes = f.trace.filter(x => x.startsWith("write:")).length; expect(await f.read()).toEqual({ status: "refused" });
  expect(f.trace.filter(x => x.startsWith("write:"))).toHaveLength(writes); expect(await f.owner.close()).toMatchObject({ code: "fault_held" });
});
it.each(["false", "object", "throw", "missing_readback", "mismatch"])("never acknowledges uncertain %s publication writes", async mode => {
  const f = await fixture();
  f.hooks.write = (key, value) => { if (mode !== "missing_readback") f.values.set(key, mode === "mismatch" ? "bad" : value); if (mode === "throw") throw null; return mode === "false" ? false : mode === "object" ? {} : undefined; };
  expect(await f.insert()).toEqual({ status: "refused" }); expect(f.trace.filter(x => x === "write:" + f.slot)).toHaveLength(1); expect(await f.owner.close()).toMatchObject({ code: "fault_held" });
});
it("refuses bad input and stale permission before effects without poisoning the session", async () => {
  const f = await fixture(), args = f.args(), at = f.trace.length;
  expect(await f.insert("bad")).toEqual({ status: "refused" });
  expect(await f.cap.read(args[2], args[3], args[4], { proceed: () => false })).toEqual({ status: "refused" });
  expect(f.trace).toHaveLength(at); expect(await f.read()).toMatchObject({ status: "observed" }); expect(await f.owner.close()).toMatchObject({ code: "closed" });
});
it("joins pending protected read before cleanup releases either owner", async () => {
  const f = await fixture(), entered = deferred(), held = deferred();
  f.hooks.read = key => { if (key === f.slot) { entered.resolve(); return held.promise; } return { kind: "value", value: f.values.get(key) }; };
  const read = f.read(); await entered.promise; let closed = false; const close = f.owner.close().then(r => { closed = true; return r; });
  await pause(); expect(closed).toBe(false); held.resolve({ kind: "established_absent" }); expect(await read).toEqual({ status: "refused" }); await close;
});
it("excludes the exact outward read completion returned by the bridge", async () => {
  const f = await fixture(); f.hooks.read = () => read;
  const read = f.read(); expect(await read).toEqual({ status: "refused" });
});
it("never adopts an exact own write completion as ACK", async () => {
  const f = await fixture(); f.hooks.write = () => insert;
  const insert = f.insert(); expect(await insert).toEqual({ status: "refused" }); expect(await f.owner.close()).toMatchObject({ code: "fault_held" });
});
it("drains malformed acknowledgement work before fault-held cleanup finishes", async () => {
  const f = await fixture(), entered = deferred(), held = deferred(); f.hooks.write = () => { entered.resolve(); return { then: held.promise }; };
  const insert = f.insert(); await entered.promise; let done = false; const close = f.owner.close().then(r => { done = true; return r; });
  await pause(); expect(done).toBe(false); held.resolve(); expect(await insert).toEqual({ status: "refused" }); expect(await close).toMatchObject({ code: "fault_held" });
});
it("cold reads the exact intent on a new genuine lease and refuses migration writes", async () => {
  const f = await fixture(); expect(await f.insert()).toMatchObject({ inserted: true }); const args = f.args(); await f.owner.close();
  const created = await f.portModule.createPublicationTransferCredentialMigrationPort({ providerConfigIdentity: "pc1:synthetic", sessionStorageKey: "sb-synthetic-auth-token", binding: f.binding, detectPlatform: () => "ios" }, { inventory() {}, slot() {} }, { current: () => true, owns: () => false, failed() {} });
  if (!created.ok) throw null;
  const acquisition = await created.value.acquire(); if (!acquisition.ok) throw null;
  const cap = f.portModule.publicationTransferCredentialCapability(created.value)!;
  const observed = await cap.read(acquisition.lease, args[3], args[4]); expect(observed).toMatchObject({ status: "observed", inserted: false });
  if (observed.status !== "observed") throw null;
  expect(f.protocol.readPublicationAnchorObservation(observed.observation)?.raw).toBe(f.raw());
  const at = f.trace.length; expect(await cap.insert(acquisition.lease, args[3], args[4], f.raw())).toEqual({ status: "refused" }); expect(f.trace).toHaveLength(at);
  expect(await created.value.release(acquisition.lease)).toEqual({ ok: true }); expect(f.protocol.readPublicationAnchorObservation(observed.observation)).toBeNull();
});
it.each(["ordinary", "common", "old_transfer"])("keeps %s constructors outside the publication capability", async kind => {
  const portModule = await import("../nativeCredentialMigrationPort");
  const options = { providerConfigIdentity: "pc1:synthetic", sessionStorageKey: "sb-synthetic-auth-token", detectPlatform: () => "ios" };
  const observer = { inventory() {}, slot() {} };
  const result = kind === "ordinary" ? portModule.createNativeCredentialMigrationPort(options) : kind === "common" ? portModule.createNativeCommonCredentialMigrationPort(options, observer) : await portModule.createTransferCredentialMigrationPort(options, observer, { owns: () => false, current: () => true, failed() {} });
  expect(result.ok).toBe(true); if (!result.ok) throw null; expect(portModule.publicationTransferCredentialCapability(result.value)).toBeNull();
});
it("captures malformed descriptor work without mistaking a future method for a binding", async () => {
  const portModule = await import("../nativeCredentialMigrationPort"), held = deferred(); let done = false;
  const result = portModule.createPublicationTransferCredentialMigrationPort({ providerConfigIdentity: "pc1:synthetic", sessionStorageKey: "sb-synthetic-auth-token", binding: { configure: held.promise }, detectPlatform: () => "ios" }, { inventory() {}, slot() {} }, { owns: () => false, current: () => true, failed() {} }).then(r => { done = true; return r; });
  await pause(); expect(done).toBe(false); held.resolve(() => {}); expect(await result).toMatchObject({ ok: false });
});
it("joins unrelated pending malformed value work before read refusal", async () => {
  const f = await fixture(), held = deferred(), entered = deferred();
  f.hooks.read = () => { entered.resolve(); return { kind: "value", value: held.promise }; };
  let done = false; const read = f.read().then(r => { done = true; return r; }); await entered.promise; await pause(); expect(done).toBe(false);
  held.resolve("bad"); expect(await read).toEqual({ status: "refused" }); expect(await f.owner.close()).toMatchObject({ code: "fault_held" });
});
it("refuses a different existing canonical value and preserves its exact bytes", async () => {
  const f = await fixture(), raw = f.raw(); f.values.set(f.slot, raw);
  const different = f.protocol.serializePublicationAnchor({ ...f.protocol.parsePublicationAnchor(raw), controlRevision: 5 })!;
  expect(await f.insert(different)).toEqual({ status: "refused" }); expect(f.values.get(f.slot)).toBe(raw); expect(f.trace.filter(x => x === "write:" + f.slot)).toHaveLength(0);
});
it.each(["readSlot", "inspectNamespace", "release", "insert", "acquire"] as const)("excludes actual same-lane migration %s without a queue cycle", async method => {
  const f = await fixture(), args = f.args(); await f.owner.close();
  const created = await f.portModule.createPublicationTransferCredentialMigrationPort({ providerConfigIdentity: "pc1:synthetic", sessionStorageKey: "sb-synthetic-auth-token", binding: f.binding, detectPlatform: () => "ios" }, { inventory() {}, slot() {} }, { current: () => true, owns: () => false, failed() {} });
  if (!created.ok) throw null; const acquisition = await created.value.acquire(); if (!acquisition.ok) throw null;
  const cap = f.portModule.publicationTransferCredentialCapability(created.value)!, m = [...f.values.keys()].find(key => key.startsWith("m1."))!;
  let entered = false;
  f.hooks.read = key => {
    if (key === f.slot) { entered = true; return method === "readSlot" ? created.value.readSlot(acquisition.lease, m) : method === "inspectNamespace" ? created.value.inspectNamespace(acquisition.lease) : method === "insert" ? created.value.insert(acquisition.lease, m, args[4]) : method === "acquire" ? created.value.acquire() : created.value.release(acquisition.lease); }
    return f.values.has(key) ? { kind: "value", value: f.values.get(key) } : { kind: "established_absent" };
  };
  const read = cap.read(acquisition.lease, args[3], args[4]);
  const result = await Promise.race([read, new Promise(resolve => setTimeout(() => resolve("timeout"), 100))]);
  expect(entered).toBe(true); expect(result).not.toBe("timeout"); expect(result).toEqual({ status: "refused" });
  await created.value.release(acquisition.lease);
});
it("runtime SDK operations exclude the genuine publication completion queued behind them", async () => {
  const f = await fixture(), args = f.args(); let entered = false;
  f.hooks.read = () => { entered = true; return f.cap.read(args[2], args[3], args[4]); };
  const read = f.pair.credentials.read("sb-synthetic-auth-token-code-verifier");
  const result = await Promise.race([read, new Promise(resolve => setTimeout(() => resolve("timeout"), 100))]);
  expect(entered).toBe(true); expect(result).not.toBe("timeout"); expect(result).toMatchObject({ status: "read_failed" });
});
it.each(["read", "insert"])("never adopts a warm external absent-to-present intent through %s", async method => {
  const f = await fixture(); expect(await f.read()).toMatchObject({ status: "observed" }); f.values.set(f.slot, f.raw());
  const before = f.trace.filter(x => x.startsWith("write:")).length;
  expect(await (method === "read" ? f.read() : f.insert())).toEqual({ status: "refused" });
  expect(f.trace.filter(x => x.startsWith("write:"))).toHaveLength(before); expect(f.values.get(f.slot)).toBe(f.raw()); expect(await f.owner.close()).toMatchObject({ code: "fault_held" });
});
it("accepts first pre-existing presence as historical observation without a write ACK", async () => {
  const f = await fixture(); f.values.set(f.slot, f.raw()); expect(await f.insert()).toMatchObject({ status: "observed", inserted: false });
  expect(f.trace.filter(x => x === "write:" + f.slot)).toHaveLength(0);
});
it("registers acquisition completion and still revokes release synchronously", async () => {
  const f = await fixture(), args = f.args(); await f.owner.close();
  const created = await f.portModule.createPublicationTransferCredentialMigrationPort({ providerConfigIdentity: "pc1:synthetic", sessionStorageKey: "sb-synthetic-auth-token", binding: f.binding, detectPlatform: () => "ios" }, { inventory() {}, slot() {} }, { current: () => true, owns: () => false, failed() {} });
  if (!created.ok) throw null; const acquisition = await created.value.acquire(); if (!acquisition.ok) throw null;
  const cap = f.portModule.publicationTransferCredentialCapability(created.value)!, held = deferred(), entered = deferred();
  f.hooks.read = key => { if (key === f.slot) { entered.resolve(); return held.promise; } return { kind: "value", value: f.values.get(key) }; };
  const read = cap.read(acquisition.lease, args[3], args[4]); await entered.promise;
  const release = created.value.release(acquisition.lease); expect(created.value.leaseState()).toBe("releasing");
  held.resolve({ kind: "established_absent" }); expect(await read).toEqual({ status: "refused" }); expect(await release).toEqual({ ok: true });
});
