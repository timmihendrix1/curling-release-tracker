// @vitest-environment jsdom
import { afterEach, expect, it, vi } from "vitest";
import { createInstallationTransferWebViewSource } from "../localStorageAdapter";
import * as platform from "../platformSha256";
import * as inventory from "../installationTransferInventory";
import { TRANSFER_SPORTING_SUFFIXES, TRANSFER_IDENTITY_KEYS, TRANSFER_LEGACY_KEY, TRANSFER_CONTROL_KEYS } from "../installationTransferInventory";
const storage = localStorage, prototype = Storage.prototype;
const nativeGet = prototype.getItem, nativeSet = prototype.setItem, nativeKey = prototype.key, nativeClear = prototype.clear;
const get = (name: string) => Reflect.apply(nativeGet, storage, [name]);
const set = (name: string, value: string) => Reflect.apply(nativeSet, storage, [name, value]);
const clear = () => Reflect.apply(nativeClear, storage, []);
const a = "10000000-0000-4000-8000-000000000001", b = "20000000-0000-4000-8000-000000000002";
const key = (index: number, profile = a) => `curling.sporting.profile.v1.${profile}.${TRANSFER_SPORTING_SUFFIXES[index]}`;
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 5));
function deferred() { let resolve!: (value: unknown) => void, reject!: (reason: unknown) => void; const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const sources: ReturnType<typeof createInstallationTransferWebViewSource>[] = [];
function source() { const value = createInstallationTransferWebViewSource(); sources.push(value); return value; }
afterEach(async () => { vi.restoreAllMocks(); vi.unstubAllGlobals(); for (const value of sources.splice(0)) await value.close(); clear(); });
it("constructs inertly and captures actual empty Web Storage using the actual V2 planner", async () => {
  clear(); const spy = vi.spyOn(inventory, "planInstallationTransferInventoryV2");
  let reads = 0; const descriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage")!;
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { reads++; return storage; } });
  try {
    const value = source(); expect(reads).toBe(0);
    const result = await value.capture(); expect(result).toMatchObject({ ok: true, kind: "source_observation", counts: { profiles: 0, slots: 6, present: 0, excluded: 0 }, mayIssue: false, mayPublish: false, mayMount: false });
    expect(reads).toBe(2); expect(spy).toHaveBeenCalledTimes(1);
    if (!result.ok) throw null; expect(Object.getPrototypeOf(result.proof)).toBeNull(); expect(Object.keys(result.proof)).toEqual([]);
    expect(await value.fence(result.proof)).toBe("unchanged");
  } finally { Object.defineProperty(globalThis, "localStorage", descriptor); }
});
it("reads every actual declared slot/absence and preserves opaque stored data without mutation", async () => {
  clear(); set(key(0), "synthetic 🥌\ud800"); set(key(1, b), ""); set(TRANSFER_IDENTITY_KEYS[0], "malformed but stored");
  const gets: string[] = [], getsSpy = vi.spyOn(prototype, "getItem").mockImplementation(function(this: Storage, name) { gets.push(name); return Reflect.apply(nativeGet, this, [name]); });
  const writes = vi.spyOn(prototype, "setItem"), removes = vi.spyOn(prototype, "removeItem"), clears = vi.spyOn(prototype, "clear");
  const value = source(), result = await value.capture(); expect(result).toMatchObject({ ok: true, counts: { profiles: 2, slots: 32, present: 3 } });
  const expected = [...TRANSFER_IDENTITY_KEYS, TRANSFER_LEGACY_KEY, ...TRANSFER_SPORTING_SUFFIXES.flatMap((_, i) => [key(i), key(i, b)])];
  for (const name of expected) expect(gets.filter(v => v === name)).toHaveLength(2);
  for (const name of TRANSFER_CONTROL_KEYS) expect(gets.filter(v => v === name)).toHaveLength(4);
  expect(writes).not.toHaveBeenCalled(); expect(removes).not.toHaveBeenCalled(); expect(clears).not.toHaveBeenCalled(); expect(getsSpy).toHaveBeenCalled();
  expect(get(key(0))).toBe("synthetic 🥌\ud800"); expect(get(key(1, b))).toBe(""); expect(JSON.stringify(result)).not.toContain("synthetic");
});
it("never reads excluded values or named then/constructor/getItem/key values", async () => {
  clear(); const excluded = ["sb-synthetic-auth-token", "sb-synthetic-auth-token-code-verifier", "curling-performance-public-exercise-diagram-v1.synthetic", TRANSFER_SPORTING_SUFFIXES[0], "then", "constructor", "getItem", "key"];
  for (const name of excluded) set(name, "excluded secret");
  const gets: string[] = []; vi.spyOn(prototype, "getItem").mockImplementation(function(this: Storage, name) { gets.push(name); return Reflect.apply(nativeGet, this, [name]); });
  const value = source(), result = await value.capture(); expect(result).toMatchObject({ ok: true, counts: { excluded: excluded.length } });
  if (!result.ok) throw null; expect(await value.fence(result.proof)).toBe("unchanged"); await value.close();
  for (const name of excluded) expect(gets).not.toContain(name);
});
it.each(["curling.sporting.profile.v1.bad.future", `curling.sporting.profile.v1.${a}.future`, "curling.identity.accountDeletionGuard.bad.v1", "curling.nativeMigration.future.v1", "curling-release-tracker-unknown"])("refuses unknown owned family before raw reads: %s", async name => {
  clear(); set(name, "opaque"); const gets = vi.spyOn(prototype, "getItem");
  expect(await source().capture()).toMatchObject({ ok: false, code: "source_unsupported" }); expect(gets).not.toHaveBeenCalled();
});
it.each(TRANSFER_CONTROL_KEYS)("refuses listed migration control without reading it: %s", async name => {
  clear(); set(name, "opaque"); const gets = vi.spyOn(prototype, "getItem");
  expect(await source().capture()).toMatchObject({ ok: false, code: "source_unhealthy" }); expect(gets).not.toHaveBeenCalled();
});
it("positively probes unlisted control addresses rather than trusting enumeration", async () => {
  clear(); set(TRANSFER_CONTROL_KEYS[0], "opaque");
  vi.spyOn(prototype, "key").mockImplementation(() => "foreign-listing");
  expect(await source().capture()).toMatchObject({ ok: false, code: "source_unhealthy" });
});
it("recognizes actual dynamic denial families without deriving a sporting namespace from them", async () => {
  clear(); const names = [`curling.identity.accountDeletionGuard.${a}.v1`, `curling.identity.accountDeletionGuardResolution.${a}.v1`, `curling.identity.accessBarrierResolution.${b}.v1`];
  for (const name of names) set(name, "opaque invalid identity kept unchanged");
  expect(await source().capture()).toMatchObject({ ok: true, counts: { profiles: 0, slots: 9, present: 3 } });
});
it.each(["missing", "unlisted_present"])("does not convert a contradictory slot to absence: %s", async mode => {
  clear(); if (mode === "missing") set(key(0), "opaque");
  vi.spyOn(prototype, "getItem").mockImplementation(function(this: Storage, name) {
    if (name === (mode === "missing" ? key(0) : TRANSFER_LEGACY_KEY)) return mode === "missing" ? null : "true";
    return Reflect.apply(nativeGet, this, [name]);
  });
  expect(await source().capture()).toMatchObject({ ok: false, code: "source_changed" });
});
it.each(["duplicate", "null", "grow", "shrink", "throw"])("contains inconsistent native enumeration: %s", async mode => {
  clear(); set("foreign-a", "a"); set("foreign-b", "b"); let calls = 0;
  vi.spyOn(prototype, "key").mockImplementation(function(this: Storage, index) {
    calls++;
    if (mode === "throw") throw new Proxy({}, { get() { throw null; } });
    if (mode === "null") return null;
    if (mode === "duplicate") return "foreign-a";
    if (calls === 1 && mode === "grow") set("foreign-c", "c");
    if (calls === 1 && mode === "shrink") Reflect.apply(prototype.removeItem, this, ["foreign-b"]);
    return Reflect.apply(nativeKey, this, [index]);
  });
  expect(await source().capture()).toMatchObject({ ok: false, code: mode === "throw" ? "unavailable" : "source_changed" });
});
it("checks genuine native length before any key traversal", async () => {
  clear(); for (let i = 0; i < 4097; i++) set(`f${i}`, ""); const keys = vi.spyOn(prototype, "key"), gets = vi.spyOn(prototype, "getItem");
  expect(await source().capture()).toMatchObject({ ok: false, code: "source_unsupported" }); expect(keys).not.toHaveBeenCalled(); expect(gets).not.toHaveBeenCalled();
});
it.each([["foreign".repeat(37), "x"], [key(0), "x".repeat(1_048_577)], [TRANSFER_IDENTITY_KEYS[0], "x".repeat(65_537)], [TRANSFER_LEGACY_KEY, "x".repeat(9)]])("enforces key and raw caps before retaining: %s", async (name, raw) => {
  clear(); set(name, raw); expect(await source().capture()).toMatchObject({ ok: false, code: "source_unsupported" });
});
it.each([[key(0), 1_048_576], [TRANSFER_IDENTITY_KEYS[0], 65_536], [TRANSFER_LEGACY_KEY, 8]])("retains exact supported cap at %s", async (name, length) => {
  clear(); set(name as string, "x".repeat(length as number)); expect((await source().capture()).ok).toBe(true);
});
it("refuses aggregate raw overflow without source mutation", async () => {
  clear(); for (let i = 0; i < 4; i++) set(key(i), "x".repeat(1_048_576));
  expect(await source().capture()).toMatchObject({ ok: false, code: "source_unsupported" }); expect(get(key(3))?.length).toBe(1_048_576);
});
it("fences whole own values and the entire listing, including later controls", async () => {
  for (const mode of ["value", "new_profile", "foreign_name", "control"]) {
    clear(); set(key(0), "first"); const value = source(), first = await value.capture(); if (!first.ok) throw null;
    if (mode === "value") set(key(0), "second"); if (mode === "new_profile") set(key(1, b), "[]"); if (mode === "foreign_name") set("foreign-new", "new"); if (mode === "control") set(TRANSFER_CONTROL_KEYS[0], "marker");
    expect(await value.fence(first.proof)).toBe("changed"); expect(await value.fence(first.proof)).toBe("unavailable");
  }
});
it("recapture replaces rather than retaining old maps/proofs, including failed recapture", async () => {
  clear(); set(key(0), "one"); const value = source(), first = await value.capture(); if (!first.ok) throw null;
  set(key(0), "two"); const second = await value.capture(); if (!second.ok) throw null;
  expect(second.proof).not.toBe(first.proof); expect(await value.fence(first.proof)).toBe("unavailable"); expect(await value.fence(second.proof)).toBe("unchanged");
  set("curling.future", "unsupported"); expect((await value.capture()).ok).toBe(false); expect(await value.fence(second.proof)).toBe("unavailable");
});
it("bounds repeated retained captures to the single currently recognized proof", async () => {
  clear(); set(key(0), "x".repeat(1_048_576)); const value = source(), proofs: object[] = [];
  for (let i = 0; i < 12; i++) { const result = await value.capture(); if (!result.ok) throw null; proofs.push(result.proof); }
  for (const old of proofs.slice(0, -1)) expect(await value.fence(old)).toBe("unavailable"); expect(await value.fence(proofs.at(-1))).toBe("unchanged");
});
it("refuses foreign/copied/closed proofs without reflecting their fields", async () => {
  clear(); const one = source(), two = source(), result = await one.capture(); if (!result.ok) throw null;
  let touches = 0; const foreign = new Proxy({}, { get() { touches++; throw null; } });
  for (const proof of [result.proof, { ...result.proof }, foreign, null, "wrong"]) expect(await two.fence(proof)).toBe("unavailable");
  await one.close(); expect(await one.fence(result.proof)).toBe("closed"); expect((await one.capture()).ok).toBe(false); expect(touches).toBe(0);
});
it.each(["receiver", "method", "constructor"])("refuses actual source/platform replacement rather than rebinding: %s", async mode => {
  clear(); const value = source(), first = await value.capture(); if (!first.ok) throw null;
  if (mode === "receiver") vi.stubGlobal("localStorage", {});
  if (mode === "constructor") vi.stubGlobal("Storage", function Replacement() {});
  if (mode === "method") vi.spyOn(prototype, "getItem").mockImplementation(() => null);
  expect(await value.fence(first.proof)).toBe("unavailable"); expect((await value.capture()).ok).toBe(false);
});
it.each(["getItem", "key", "global"])("owns directly observed malformed pending work at %s until joined close", async mode => {
  clear(); set(key(0), "opaque"); const pending = deferred();
  if (mode === "getItem") vi.spyOn(prototype, "getItem").mockImplementation(() => pending.promise as unknown as string);
  if (mode === "key") vi.spyOn(prototype, "key").mockImplementation(() => pending.promise as unknown as string);
  if (mode === "global") vi.stubGlobal("localStorage", pending.promise);
  const value = source(); let captured = false, closed = false;
  const work = value.capture().then(result => { captured = true; return result; }); const closing = value.close(); expect(value.close()).toBe(closing); void closing.then(() => { closed = true; });
  await tick(); expect(captured).toBe(false); expect(closed).toBe(false); pending.resolve("invalid result");
  expect(await work).toMatchObject({ ok: false }); await closing; expect(closed).toBe(true);
});
it.each(["masked", "nested", "rejected"])("drains malformed %s native work without inspecting its reason", async mode => {
  clear(); const pending = deferred(); Object.defineProperty(pending.promise, "then", { value: null });
  const returned = mode === "nested" ? Promise.resolve(pending.promise) : pending.promise;
  let seen = 0;
  const drain = platform.drainObservedPlatformWork;
  vi.spyOn(platform, "drainObservedPlatformWork").mockImplementation((root, exclude) => { if (root === returned) { seen++; expect(exclude?.(root)).toBe(false); } return drain(root, exclude); });
  // A Vitest function spy probes a returned Promise's .then itself, so it throws
  // before returning a masked Promise to the source. Use the raw platform fault
  // function here; the source must actually observe the malformed root.
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "getItem")!;
  Object.defineProperty(prototype, "getItem", { ...descriptor, value: () => returned });
  const value = source(); let done = false, reads = 0; const badReason = new Proxy({}, { get() { reads++; throw null; } });
  const work = value.capture().then(result => { done = true; return result; });
  try {
    await tick(); expect(seen).toBe(1); expect(done).toBe(false);
    if (mode === "rejected") pending.reject(badReason); else pending.resolve("still invalid");
    expect(await work).toMatchObject({ ok: false, code: "unavailable" }); expect(reads).toBe(0);
  } finally { pending.resolve(undefined); await work; Object.defineProperty(prototype, "getItem", descriptor); }
});

it.each(["root", "child"])("joins exact reentrant own-close %s without self-cycle", async mode => {
  clear(); const value = source(); let closing!: Promise<void>;
  vi.stubGlobal("localStorage", undefined);
  Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { closing = value.close(); return mode === "root" ? closing : { then(resolve: (value: unknown) => void) { resolve(closing); } }; } });
  expect(await value.capture()).toMatchObject({ ok: false, code: "closed" }); await closing; expect(value.close()).toBe(closing);
});
it.each(["pending_global", "pending_metadata"])("reentrant close still owns later observed work: %s", async mode => {
  clear(); const value = source(), pending = deferred(); let closing!: Promise<void>, reads = 0;
  if (mode === "pending_global") {
    vi.stubGlobal("localStorage", undefined); Object.defineProperty(globalThis, "localStorage", { configurable: true, get() { reads++; closing = value.close(); return pending.promise; } });
  } else {
    const fakeConstructor = function SourceStorage() {};
    const proxy = new Proxy(prototype, { getOwnPropertyDescriptor(target, name) {
      if (name === "getItem") { closing = value.close(); return { configurable: true, enumerable: true, writable: true, value: pending.promise }; }
      return Reflect.getOwnPropertyDescriptor(target, name);
    } });
    fakeConstructor.prototype = proxy; vi.stubGlobal("Storage", fakeConstructor);
  }
  let done = false; const work = value.capture().then(result => { done = true; return result; }); await tick(); expect(done).toBe(false);
  pending.resolve("ignored"); expect(await work).toMatchObject({ ok: false, code: "closed" }); await closing;
  if (mode === "pending_global") expect(reads).toBe(1);
});
it("retains earlier observed callable metadata when later reflection throws", async () => {
  clear(); const pending = deferred(); const callable = function keyMetadata() { return null; };
  Object.defineProperty(callable, "then", { value: (resolve: (value: unknown) => void) => { void pending.promise.then(resolve); } });
  const fakeConstructor = function SourceStorage() {};
  fakeConstructor.prototype = new Proxy(prototype, { getOwnPropertyDescriptor(target, name) {
    if (name === "key") return { configurable: true, enumerable: true, writable: true, value: callable };
    if (name === "getItem") throw new Proxy({}, { get() { throw null; } });
    return Reflect.getOwnPropertyDescriptor(target, name);
  } }); vi.stubGlobal("Storage", fakeConstructor);
  const value = source(); let done = false; const work = value.capture().then(result => { done = true; return result; }); await tick(); expect(done).toBe(false);
  pending.resolve(undefined); expect(await work).toMatchObject({ ok: false, code: "unavailable" });
});
it("never touches named Storage values in failure/close or a malformed Promise-to-Storage child", async () => {
  clear(); for (const name of ["then", "constructor", "getItem", "key"]) set(name, "excluded"); set(key(0), "opaque");
  let namedReads = 0; const wrapped = new Proxy(storage, { get(target, name, receiver) { if (["then", "constructor", "getItem", "key"].includes(String(name))) namedReads++; return Reflect.get(target, name, receiver); } });
  vi.stubGlobal("localStorage", wrapped); let fail = false;
  vi.spyOn(prototype, "getItem").mockImplementation(function(this: Storage, name) { if (fail && name === key(0)) throw null; return Reflect.apply(nativeGet, this, [name]); });
  const value = source(), result = await value.capture(); expect(result.ok).toBe(true); if (!result.ok) throw null;
  fail = true; expect(await value.fence(result.proof)).toBe("unavailable"); await value.close(); expect(namedReads).toBe(0);
  vi.restoreAllMocks(); const pending = deferred(); vi.spyOn(prototype, "getItem").mockImplementation(() => pending.promise as unknown as string);
  const second = source(), work = second.capture();
  // Native resolve itself consults then. Hide it from this measurement, then reset
  // so only the completion observer's handling of the Storage child is counted.
  pending.resolve(wrapped); namedReads = 0;
  expect(await work).toMatchObject({ ok: false }); await second.close(); expect(namedReads).toBe(0);
});
it("refuses reentrant capture/fence without replacing the active operation", async () => {
  clear(); const value = source(); let inner: Promise<unknown>[] = [];
  vi.spyOn(prototype, "getItem").mockImplementation(function(this: Storage, name) { inner.push(value.capture(), value.fence({})); return Reflect.apply(nativeGet, this, [name]); });
  const result = await value.capture(); expect(result.ok).toBe(true);
  for (const answer of await Promise.all(inner)) expect(answer).not.toMatchObject({ ok: true });
  inner = []; if (!result.ok) throw null; expect(await value.fence(result.proof)).toBe("unchanged");
});

it.each(["receiver", "method"])("refuses ambient replacement during the synchronous examination: %s", async mode => {
  clear(); set(key(0), "opaque"); let replaced = false;
  vi.spyOn(prototype, "getItem").mockImplementation(function(this: Storage, name) {
    const result = Reflect.apply(nativeGet, this, [name]);
    if (name === key(0) && !replaced) {
      replaced = true;
      if (mode === "receiver") vi.stubGlobal("localStorage", new Proxy(storage, {}));
      else Object.defineProperty(prototype, "getItem", { configurable: true, writable: true, enumerable: true, value: nativeGet });
    }
    return result;
  });
  expect(await source().capture()).toMatchObject({ ok: false, code: "unavailable" }); expect(replaced).toBe(true);
});
it.each(["profiles", "dynamic"])("uses actual planner namespace/dynamic bounds before raw reads: %s", async mode => {
  clear(); if (mode === "profiles") for (let i = 1; i <= 33; i++) set(key(0, `60000000-0000-4000-8000-${String(i).padStart(12, "0")}`), "");
  else for (let i = 1; i <= 513; i++) set(`curling.identity.accountDeletionGuard.60000000-0000-4000-8000-${String(i).padStart(12, "0")}.v1`, "");
  const gets = vi.spyOn(prototype, "getItem"); expect(await source().capture()).toMatchObject({ ok: false, code: "source_unsupported" }); expect(gets).not.toHaveBeenCalled();
});
it("does not derive another sporting namespace from a raw participant/recorder identity", async () => {
  clear(); set(key(0), JSON.stringify({ recorderProfileId: b, participantProfileIds: [b] }));
  expect(await source().capture()).toMatchObject({ ok: true, counts: { profiles: 1, slots: 19 } });
});
it("never reflects a thrown reason or arbitrary malformed payload fields", async () => {
  clear(); let touches = 0;
  const reason = new Proxy({}, { get() { touches++; throw null; } });
  vi.spyOn(prototype, "getItem").mockImplementation(() => { throw reason; });
  expect(await source().capture()).toMatchObject({ ok: false, code: "unavailable" }); expect(touches).toBe(0);
});
it("owns a malformed async then-field without scanning arbitrary payload objects", async () => {
  clear(); let touches = 0; const pending = deferred(), malformed = { then: pending.promise, get payload() { touches++; throw null; } };
  const descriptor = Object.getOwnPropertyDescriptor(prototype, "getItem")!;
  Object.defineProperty(prototype, "getItem", { ...descriptor, value: () => malformed });
  const value = source(); let done = false; const work = value.capture().then(result => { done = true; return result; });
  try { await tick(); expect(done).toBe(false); expect(touches).toBe(0); pending.resolve("ignored"); expect(await work).toMatchObject({ ok: false }); expect(touches).toBe(0); }
  finally { pending.resolve(undefined); await work; Object.defineProperty(prototype, "getItem", descriptor); }
});
it("failed pending recapture invalidates an old proof before its observed work settles", async () => {
  clear(); const pending = deferred(); let fail = false, reads = 0;
  vi.spyOn(prototype, "getItem").mockImplementation(function(this: Storage, name) { reads++; return fail ? pending.promise as unknown as string : Reflect.apply(nativeGet, this, [name]); });
  const value = source(), first = await value.capture(); if (!first.ok) throw null;
  fail = true; const work = value.capture(); const before = reads;
  expect(await value.fence(first.proof)).toBe("unavailable"); expect((await value.capture()).ok).toBe(false); expect(reads).toBe(before);
  pending.resolve(null); expect(await work).toMatchObject({ ok: false }); expect(await value.fence(first.proof)).toBe("unavailable");
});
it("owns malformed pending work during a fresh fence and joins it on close", async () => {
  clear(); const pending = deferred(); let fail = false;
  vi.spyOn(prototype, "getItem").mockImplementation(function(this: Storage, name) { return fail ? pending.promise as unknown as string : Reflect.apply(nativeGet, this, [name]); });
  const value = source(), first = await value.capture(); if (!first.ok) throw null;
  fail = true; let done = false; const work = value.fence(first.proof).then(result => { done = true; return result; }); const closing = value.close();
  await tick(); expect(done).toBe(false); pending.resolve(null); expect(await work).toBe("closed"); await closing;
});
it("ignores caller-supplied source/policy/metadata overrides and returns only frozen value-free data", async () => {
  clear(); let touches = 0; const foreign = new Proxy({}, { get() { touches++; throw null; } });
  const value = Reflect.apply(createInstallationTransferWebViewSource, undefined, [foreign]); sources.push(value);
  const result = await Reflect.apply(value.capture, value, [foreign]); expect(result).toMatchObject({ ok: true, counts: { profiles: 0 } });
  expect(Object.isFrozen(value)).toBe(true); expect(Object.isFrozen(result)).toBe(true); expect(Object.getPrototypeOf(result)).toBeNull(); expect(touches).toBe(0);
});

// Independent S6d descriptor-admission and adjacent lifetime regressions.
it("refuses an accessor method descriptor before any inherited value read",async()=>{
 clear();const old=Object.getOwnPropertyDescriptor(prototype,"key")!, prior=Object.getOwnPropertyDescriptor(Object.prototype,"value");let inherited=0, ownGetter=0;const value=source();let work:ReturnType<typeof value.capture>;
 try {Object.defineProperty(prototype,"key",{configurable:true,get(){ownGetter++;throw null;}});Object.defineProperty(Object.prototype,"value",{configurable:true,get(){inherited++;return undefined;}});work=value.capture();}
 finally {if(prior)Object.defineProperty(Object.prototype,"value",prior);else Reflect.deleteProperty(Object.prototype,"value");Object.defineProperty(prototype,"key",old);}
 expect(await work!).toMatchObject({ok:false,code:"unavailable"});expect(ownGetter).toBe(0);expect(inherited).toBe(0);
});
it("preserves source_changed when a real mismatch callback installs a later throwing getter",async()=>{
 clear();set(key(0),"original");const old=Object.getOwnPropertyDescriptor(prototype,"getItem")!;let changed=false;Object.defineProperty(prototype,"getItem",{...old,value:function(this:Storage,name:string){if(changed&&name===key(0))return "new";return Reflect.apply(nativeGet,this,[name]);}});
 const value=source();try {const first=await value.capture();if(!first.ok)throw null;changed=true;expect(await value.fence(first.proof)).toBe("changed");expect(await value.fence(first.proof)).toBe("unavailable");}finally{Object.defineProperty(prototype,"getItem",old);}
});
it("retains a directly observed Promise returned after reentrant close through a descriptor",async()=>{
 clear();const value=source(),pending=deferred();let closing:Promise<void>|undefined;const original=Object.getOwnPropertyDescriptor(prototype,"key")!;const fake=function StorageReplacement(){};
 fake.prototype=new Proxy(prototype,{getOwnPropertyDescriptor(target,name){if(name==="key"){closing=value.close();return {...original,value:pending.promise};}return Reflect.getOwnPropertyDescriptor(target,name);}});vi.stubGlobal("Storage",fake);
 let done=false;const work=value.capture().then(result=>{done=true;return result;});try{await tick();expect(done).toBe(false);pending.resolve(undefined);expect(await work).toMatchObject({ok:false,code:"closed"});await closing;}finally{pending.resolve(undefined);await work;}
});
it("does not consume excluded named data on cold receiver brand failure draining native child",async()=>{
 clear();set("then","private excluded");set("constructor","private excluded");let names=0;const root=new Proxy(storage,{get(target,name,receiver){if(name==="then"||name==="constructor")names++;return Reflect.get(target,name,receiver);}});const p=deferred();vi.stubGlobal("localStorage",p.promise);const value=source();const work=value.capture();p.resolve(root);names=0;expect(await work).toMatchObject({ok:false,code:"unavailable"});expect(names).toBe(0);
});
it("fresh source recovers a changed proof only through a complete new capture",async()=>{
 clear();set(key(0),"a");const value=source();const a=await value.capture();if(!a.ok)throw null;set(key(0),"b");expect(await value.fence(a.proof)).toBe("changed");set(key(0),"a");expect(await value.fence(a.proof)).toBe("unavailable");const b=await value.capture();expect(b.ok).toBe(true);if(!b.ok)throw null;expect(await value.fence(b.proof)).toBe("unchanged");
});
it("does not issue raw reads before a complete unknown-family planner refusal",async()=>{
 clear();set("curling.future.v99","not read");let reads=0;const old=Object.getOwnPropertyDescriptor(prototype,"getItem")!;Object.defineProperty(prototype,"getItem",{...old,value:function(this:Storage,name:string){reads++;return Reflect.apply(nativeGet,this,[name]);}});try{expect(await source().capture()).toMatchObject({ok:false,code:"source_unsupported"});expect(reads).toBe(0);}finally{Object.defineProperty(prototype,"getItem",old);}
});

it("does not read inherited get while rejecting a non-accessor length descriptor",async()=>{
 clear();const old=Object.getOwnPropertyDescriptor(prototype,"length")!, prior=Object.getOwnPropertyDescriptor(Object.prototype,"get");let inherited=0, stack="";const value=source();let work:ReturnType<typeof value.capture>;
 try {Object.defineProperty(prototype,"length",{configurable:true,value:0});Object.defineProperty(Object.prototype,"get",{configurable:true,get(){inherited++;stack=new Error("probe").stack??"";return undefined;}});work=value.capture();}
 finally {if(prior)Object.defineProperty(Object.prototype,"get",prior);else Reflect.deleteProperty(Object.prototype,"get");Object.defineProperty(prototype,"length",old);}
 expect(await work!).toMatchObject({ok:false,code:"unavailable"});if(inherited)expect(stack).toContain("localStorageAdapter.ts");expect(inherited).toBe(0);
});
it("owns any actually observed inherited metadata pending value until close",async()=>{
 clear();const old=Object.getOwnPropertyDescriptor(prototype,"key")!, prior=Object.getOwnPropertyDescriptor(Object.prototype,"value"), pending=deferred();let inherited=0, stack="";const value=source();let work:ReturnType<typeof value.capture>;
 try {Object.defineProperty(prototype,"key",{configurable:true,get(){throw null;}});Object.defineProperty(Object.prototype,"value",{configurable:true,get(){inherited++;stack=new Error("probe").stack??"";return pending.promise;}});work=value.capture();}
 finally {if(prior)Object.defineProperty(Object.prototype,"value",prior);else Reflect.deleteProperty(Object.prototype,"value");Object.defineProperty(prototype,"key",old);}
 let done=false,closed=false;void work!.then(()=>{done=true;});const closing=value.close();void closing.then(()=>{closed=true;});
 try {await tick();if(inherited){expect(stack).toContain("localStorageAdapter.ts");expect(done).toBe(false);expect(closed).toBe(false);}else{expect(done).toBe(true);expect(closed).toBe(true);}expect(inherited).toBe(0);}
 finally {pending.resolve(undefined);await work!;await closing;}
});
