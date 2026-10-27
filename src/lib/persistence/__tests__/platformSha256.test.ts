import { afterEach, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { capturePlatformSha256, inheritPlatformSha256Failure, settlePlatformSha256Preparation, serializePlatformStringTuple } from "../platformSha256";
const encoder = TextEncoder;
const root = "sb-synthetic-auth-token";
const releases: (() => void)[] = [];
afterEach(() => { while (releases.length) releases.pop()!(); vi.unstubAllGlobals(); });
function pending() { let resolve!: (value?: unknown) => void; const promise = new Promise(done => { resolve = done; }); releases.push(() => resolve()); return { promise, resolve }; }
it("keeps simultaneous genuine failure drains distinct and aliases only registered work", async () => {
  const first = pending(), second = pending();
  vi.stubGlobal("TextEncoder", class { encode = first.promise; }); const a = capturePlatformSha256();
  vi.stubGlobal("TextEncoder", class { encode = second.promise; }); const b = capturePlatformSha256();
  expect(a.ok).toBe(false); expect(b.ok).toBe(false);
  const aliasA = inheritPlatformSha256Failure(a, Object.freeze({ issue: "synthetic A" }));
  const aliasB = inheritPlatformSha256Failure(b, Object.freeze({ issue: "synthetic B" }));
  inheritPlatformSha256Failure(a, aliasB); // cannot replace B's existing work
  let doneA = false, doneB = false;
  const waitA = settlePlatformSha256Preparation(aliasA).then(() => { doneA = true; });
  const waitB = settlePlatformSha256Preparation(aliasB).then(() => { doneB = true; });
  await Promise.resolve(); expect(doneA).toBe(false); expect(doneB).toBe(false);
  first.resolve(); await waitA; expect(doneA).toBe(true); expect(doneB).toBe(false);
  second.resolve(); await waitB; expect(doneB).toBe(true);
  // A lookalike has no provenance; settling it says nothing about a real capture.
  await settlePlatformSha256Preparation({ ...a });
});
it.each(["crypto", "subtle", "digest", "constructor", "encode"] as const)("owns malformed observed %s before any later read", async slot => {
  const held = pending(); let later = 0;
  vi.stubGlobal("TextEncoder", slot === "constructor" ? function () { return held.promise; } : slot === "encode" ? class { encode = held.promise; } : encoder);
  vi.stubGlobal("crypto", slot === "crypto" ? held.promise : { get subtle() {
    if (slot === "constructor" || slot === "encode") { later++; throw null; }
    return slot === "subtle" ? held.promise : { digest: held.promise };
  } });
  const result = capturePlatformSha256(); expect(result.ok).toBe(false); expect(later).toBe(0);
  let done = false; const wait = settlePlatformSha256Preparation(result).then(() => { done = true; });
  await Promise.resolve(); expect(done).toBe(false); held.resolve(); await wait;
});
it("follows conforming thenables containing masked native fulfillment through real bytes", async () => {
  vi.stubGlobal("TextEncoder", encoder);
  const held = pending(); Object.defineProperty(held.promise, "then", { value: null });
  const captured = capturePlatformSha256(() => ({ then(resolve: (value: unknown) => void) { resolve(held.promise); } }));
  expect(captured.ok).toBe(true); if (!captured.ok) throw null;
  let done = false; const hash = captured.value.hash("synthetic").then(value => { done = true; return value; });
  await Promise.resolve(); expect(done).toBe(false);
  held.resolve(await webcrypto.subtle.digest("SHA-256", new TextEncoder().encode("synthetic")));
  expect(await hash).toBe(createHash("sha256").update("synthetic").digest("hex"));
});
it("refuses an actual masked native fulfillment cycle without recurring work", async () => {
  vi.stubGlobal("TextEncoder", encoder); const a = pending(), b = pending();
  for (const value of [a.promise, b.promise]) Object.defineProperty(value, "then", { value: null });
  a.resolve(b.promise); b.resolve(a.promise);
  const captured = capturePlatformSha256(() => a.promise); expect(captured.ok).toBe(true); if (!captured.ok) throw null;
  await expect(captured.value.hash("synthetic")).rejects.toThrow("Platform fingerprint unavailable");
});
it("contains a thenable fulfillment cycle and ignores its second settlement", async () => {
  vi.stubGlobal("TextEncoder", encoder);
  let calls = 0;
  const cyclic = { then(resolve: (value: unknown) => void) { calls++; resolve(cyclic); resolve(new ArrayBuffer(32)); } };
  const captured = capturePlatformSha256(() => cyclic); expect(captured.ok).toBe(true); if (!captured.ok) throw null;
  await expect(captured.value.hash("synthetic")).rejects.toThrow("Platform fingerprint unavailable"); expect(calls).toBe(1);
});
it("owns a directly observed malformed thenable then-field before refusal", async () => {
  vi.stubGlobal("TextEncoder", encoder); const held = pending(); Object.defineProperty(held.promise, "then", { value: null });
  const value = { then: { then(resolve: (value: unknown) => void) { resolve(held.promise); } } };
  const captured = capturePlatformSha256(() => value); expect(captured.ok).toBe(true); if (!captured.ok) throw null;
  let done = false;
  const hash = captured.value.hash("synthetic").catch(() => { done = true; });
  await Promise.resolve(); await Promise.resolve(); expect(done).toBe(false);
  held.resolve(); await hash; expect(done).toBe(true);
});
it("preserves standalone synchronous helper failure shapes while their actual drain remains owned", async () => {
  const { createPlatformDomainFingerprint } = await import("../platformDomainFingerprint");
  const { createPlatformCredentialFingerprint } = await import("../platformCredentialFingerprint");
  for (const create of [() => createPlatformDomainFingerprint(), () => createPlatformCredentialFingerprint(root)]) {
    const held = pending(); vi.stubGlobal("TextEncoder", encoder); vi.stubGlobal("crypto", { subtle: { digest: held.promise } });
    const result = create(); expect(result.ok).toBe(false);
    let done = false; const wait = settlePlatformSha256Preparation(result).then(() => { done = true; });
    await Promise.resolve(); expect(done).toBe(false); held.resolve(); await wait;
  }
});
it("preserves exact tuple vectors without Array/Object/String inherited toJSON or coercion", () => {
  const values = ["", "quotes\"\\\u0000\n", "é", "e\u0301", "😀", "\ud800", "\udfff"];
  const expected = JSON.stringify(values);
  const prototypes = [Array.prototype, Object.prototype, String.prototype];
  const previous = prototypes.map(value => Object.getOwnPropertyDescriptor(value, "toJSON"));
  let callbacks = 0, actual: string;
  try {
    for (const prototype of prototypes) Object.defineProperty(prototype, "toJSON", { configurable: true, get() { callbacks++; throw null; } });
    actual = serializePlatformStringTuple("", "quotes\"\\\u0000\n", "é", "e\u0301", "😀", "\ud800", "\udfff");
  } finally {
    for (let index = 0; index < prototypes.length; index++) {
      const descriptor = previous[index];
      if (descriptor) Object.defineProperty(prototypes[index], "toJSON", descriptor);
      else Reflect.deleteProperty(prototypes[index], "toJSON");
    }
  }
  expect(callbacks).toBe(0); expect(actual!).toBe(expected);
  const hostile = { get toJSON() { callbacks++; throw null; }, toString() { callbacks++; throw null; } };
  expect(() => serializePlatformStringTuple("valid", hostile as never)).toThrow("Platform tuple unavailable");
  expect(callbacks).toBe(0);
});
it.each(['native','thenable','field'] as const)('excludes only exact already-owned %s children before reflection', async mode => {
  const {drainObservedPlatformWork}=await import('../platformSha256');
  const held=pending(); let reflected=0;
  Object.defineProperty(held.promise,'then',{configurable:true,get(){reflected++;throw null;}});
  let value:unknown;
  if(mode==='native') {
    // A masked native fulfillment can contain another native Promise directly.
    const outer=pending(); Object.defineProperty(held.promise,'then',{value:null,configurable:true});
    outer.resolve(held.promise); value=outer.promise;
  } else value=mode==='thenable'?{then(resolve:(value:unknown)=>void){resolve(held.promise);}}:{get then(){return held.promise;}};
  await drainObservedPlatformWork(value,candidate=>candidate===held.promise);
  expect(reflected).toBe(0);
});
it('still owns unrelated pending children with an exclusion and without one', async () => {
  const {drainObservedPlatformWork}=await import('../platformSha256');
  for(const exclude of [undefined,()=>false]) {
    const held=pending(); Object.defineProperty(held.promise,'then',{value:null});
    let done=false; const work=drainObservedPlatformWork({then:held.promise},exclude).then(()=>{done=true;});
    await Promise.resolve();await Promise.resolve();expect(done).toBe(false);
    held.resolve();await work;expect(done).toBe(true);
  }
});
it.each(['root','native','thenable','field'] as const)('value observation reports excluded %s work without fabricating undefined',async mode=>{
  const {observePlatformWork}=await import('../platformSha256');const held=pending();let value:unknown=held.promise;
  if(mode==='native'){Object.defineProperty(held.promise,'then',{value:null});value=(async()=>held.promise)();}
  if(mode==='thenable')value={then(resolve:(value:unknown)=>void){resolve(held.promise);}};
  if(mode==='field')value={then:held.promise};
  const result=await observePlatformWork(value,candidate=>candidate===held.promise);expect(result).toEqual({kind:'excluded'});expect(Object.hasOwn(result,'value')).toBe(false);expect(Object.getPrototypeOf(result)).toBeNull();expect(Object.isFrozen(result)).toBe(true);
});
it('value observation preserves genuinely fulfilled undefined and drains unrelated masked work',async()=>{
  const {observePlatformWork}=await import('../platformSha256');expect(await observePlatformWork(Promise.resolve(undefined),()=>false)).toEqual({kind:'value',value:undefined});
  const held=pending();Object.defineProperty(held.promise,'then',{value:null});let done=false;const wait=observePlatformWork({then(resolve:(value:unknown)=>void){resolve(held.promise);}},()=>false).then(value=>{done=true;return value;});
  await Promise.resolve();await Promise.resolve();expect(done).toBe(false);held.resolve('synthetic');expect(await wait).toEqual({kind:'value',value:'synthetic'});
});

it("optional private invalidation precedes malformed then-field drain, default still drains", async () => {
  const { observePlatformWork } = await import("../platformSha256");
  const gate = pending(); let invalid = false, done = false;
  const work = observePlatformWork({ then: gate.promise }, () => false, () => { invalid = true; }).then(() => {}, () => { done = true; });
  await Promise.resolve(); await Promise.resolve(); expect(invalid).toBe(true); expect(done).toBe(false);
  gate.resolve(); await work; expect(done).toBe(true);
});
it("optional private invalidation records rejection and then-getter failure without exposing reasons", async () => {
  const { observePlatformWork } = await import("../platformSha256");
  for(const raw of [Promise.reject(Error("synthetic")),{get then(){throw Error("synthetic");}}]){
    let invalid=false;await expect(observePlatformWork(raw,()=>false,()=>{invalid=true;})).rejects.toThrow("Platform observation unavailable");expect(invalid).toBe(true);
  }
});

it("quarantine completion ownership does not revisit an observed native fulfillment",async()=>{
 const {createQuarantineWork}=await import("../installationTransferQuarantineWork");let armed=false,reads=0;
 const raw=Object.assign(Object.create({get then(){if(armed)reads++;return undefined;}}),{values:[]});const native=Promise.resolve(raw);armed=true;
 const work=createQuarantineWork();const box=await work.value(native);expect(work.rows(box.value,["value"],0)).toEqual([]);await work.finish();expect(reads).toBe(1);
});
