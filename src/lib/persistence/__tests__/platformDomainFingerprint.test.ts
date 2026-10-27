import { createHash, webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlatformDomainFingerprint } from "../platformDomainFingerprint";
import { digestValue, type NativeMigrationFingerprint } from "../nativeMigrationEvidence";

const platformEncoder = globalThis.TextEncoder;
const independent = (raw: string) => createHash("sha256").update(JSON.stringify(["domain-value/v1",raw]),"utf8").digest("hex");
function binding(digest?: unknown) {
  const result=createPlatformDomainFingerprint(digest);
  if(!result.ok)throw Error("Synthetic binding unavailable");
  return result.value;
}
afterEach(()=>{vi.unstubAllGlobals();vi.restoreAllMocks();});

describe("dormant standard domain fingerprint binding", () => {
  it.each(["", "synthetic", "\"\\\u0000\n\r\t", "🥌", "é", "e\u0301", "\ud800", "\udc00", "\ufffd", "a,b\",\"c"])("matches independent real WebCrypto SHA-256: %j", async raw => {
    vi.stubGlobal("crypto",webcrypto);
    expect(await binding().fingerprint(raw)).toBe(independent(raw));
  });
  it("distinguishes code units lost by direct TextEncoder and separates all adopted domains", async () => {
    vi.stubGlobal("crypto",webcrypto);const port=binding();
    const inputs=["\ud800","\udc00","\ufffd","é","e\u0301"];
    expect(new Set(await Promise.all(inputs.map(raw=>port.fingerprint(raw)))).size).toBe(inputs.length);
    expect(new platformEncoder().encode("\ud800")).toEqual(new platformEncoder().encode("\ufffd"));
    const raw="synthetic";const own=await port.fingerprint(raw);
    expect(own).not.toBe(createHash("sha256").update(JSON.stringify(["credential-value/v1","sb-fixture-auth-token",raw])).digest("hex"));
    for(const purpose of ["curling-transfer-value/v1","curling-transfer-value/v2"]){expect(own).not.toBe(createHash("sha256").update(purpose+"\u0000"+raw).digest("hex"));}
  });
  it("captures standard receivers and operations once, without digest at construction", async () => {
    let digestReads=0,encodeReads=0,digests=0,encodes=0;
    const subtle=Object.defineProperty({},"digest",{get(){digestReads++;return function(this:unknown,algorithm:string,bytes:Uint8Array){expect(this).toBe(subtle);expect(algorithm).toBe("SHA-256");expect(bytes).toEqual(new platformEncoder().encode('["domain-value/v1","\\ud800"]'));digests++;return new ArrayBuffer(32);};}});
    class Encoder {
      get encode(){encodeReads++;return function(this:unknown,input:string){expect(this).toBeInstanceOf(Encoder);encodes++;return new platformEncoder().encode(input);};}
    }
    vi.stubGlobal("crypto",{subtle});vi.stubGlobal("TextEncoder",Encoder);
    const result=createPlatformDomainFingerprint();expect(result.ok).toBe(true);expect(digests).toBe(0);expect(encodes).toBe(0);expect(digestReads).toBe(1);expect(encodeReads).toBe(1);if(!result.ok)return;
    vi.stubGlobal("crypto",null);vi.stubGlobal("TextEncoder",null);
    expect(await result.value.fingerprint("\ud800")).toBe("00".repeat(32));expect(digests).toBe(1);expect(encodes).toBe(1);expect(digestReads).toBe(1);expect(encodeReads).toBe(1);
    expect(Object.isFrozen(result)).toBe(true);expect(Object.isFrozen(result.value)).toBe(true);
  });
  it("pins exact tuple bytes and invokes only SHA-256 with no override default", async () => {
    const calls:unknown[][]=[];
    const port=binding((...args:unknown[])=>{calls.push(args);return new Uint8Array(32).fill(0xab).buffer;});
    expect(calls).toEqual([]);expect(await port.fingerprint("a\u0000\ud800")).toBe("ab".repeat(32));
    expect(calls).toEqual([["SHA-256",new platformEncoder().encode('["domain-value/v1","a\\u0000\\ud800"]')]]);
  });
  it("has an exact synchronous format predicate without coercion", () => {
    const format=binding(()=>new ArrayBuffer(32)).isWellFormedFingerprint;
    expect(format("01ab".repeat(16))).toBe(true);
    let touched=0;const hostile=new Proxy({}, {get(){touched++;throw 0;}});
    for(const value of ["","a".repeat(63),"a".repeat(65),"A".repeat(64),"z".repeat(64),"a".repeat(64)+"\n",hostile,new String("a".repeat(64)),null,undefined,1,Symbol()])expect(format(value)).toBe(false);
    expect(touched).toBe(0);
  });
  it("returns only immutable safe construction failures for unavailable or hostile capabilities", () => {
    let touched=0;const reason=new Proxy({}, {get(){touched++;throw 0;},getPrototypeOf(){touched++;throw 0;}});
    for(const crypto of [null,{}, {subtle:null}, {subtle:{}}, {subtle:{digest:null}}, {subtle:{digest:{bind(){throw reason;}}}},Object.defineProperty({},"subtle",{get(){throw reason;}}),{subtle:Object.defineProperty({},"digest",{get(){throw reason;}})}]){
      vi.stubGlobal("crypto",crypto);const result=createPlatformDomainFingerprint();expect(result).toEqual({ok:false,reason:"evidence_unavailable"});expect(Object.isFrozen(result)).toBe(true);
    }
    for(const encoder of [null,class {encode=null;},class {get encode(){throw reason;}}]){vi.stubGlobal("TextEncoder",encoder);expect(createPlatformDomainFingerprint(()=>new ArrayBuffer(32))).toEqual({ok:false,reason:"evidence_unavailable"});}
    vi.stubGlobal("TextEncoder",platformEncoder);
    for(const override of [null,{},false,"SHA-256",new Proxy({}, {get(){touched++;throw 0;}})])expect(createPlatformDomainFingerprint(override)).toEqual({ok:false,reason:"evidence_unavailable"});
    expect(touched).toBe(0);
  });
  it("does not inspect invalid raw inputs or invoke digest", async () => {
    let touches=0,calls=0;const hostile=new Proxy({}, {get(){touches++;throw 0;},ownKeys(){touches++;throw 0;},getPrototypeOf(){touches++;throw 0;}});
    const port=binding(()=>{calls++;return new ArrayBuffer(32);});
    for(const input of [hostile,new String("synthetic"),null,undefined,1,true,Symbol(),()=>0])await expect(port.fingerprint(input as string)).rejects.toThrow(/^Domain fingerprint unavailable$/);
    expect(touches).toBe(0);expect(calls).toBe(0);
  });
  it("adds no credential raw cap or weak truncation for large domain values", async () => {
    vi.stubGlobal("crypto",webcrypto);const raw="\ud800".repeat(1048577);
    expect(await binding().fingerprint(raw)).toBe(independent(raw));
  });
  it("contains platform encode/operation throws as a fixed safe error", async () => {
    const reason={privateValue:"synthetic-private"};
    vi.stubGlobal("TextEncoder",class {encode(){throw reason;}});
    await expect(binding(()=>new ArrayBuffer(32)).fingerprint("synthetic")).rejects.toThrow(/^Domain fingerprint unavailable$/);
    vi.stubGlobal("TextEncoder",platformEncoder);
    await expect(binding(()=>{throw reason;}).fingerprint("synthetic")).rejects.toThrow(/^Domain fingerprint unavailable$/);
  });
  it.each(["throw","reject","then throw","then getter","masked reject"])("contains observable dependency failure without inspecting reasons: %s", async kind => {
    let touches=0,maskedReads=0;const opaque=new Proxy({}, {get(){touches++;throw 0;},ownKeys(){touches++;throw 0;},getPrototypeOf(){touches++;throw 0;}});
    const digest=()=>{
      if(kind==="throw")throw opaque;
      if(kind==="reject")return Promise.reject(opaque);
      if(kind==="then throw")return {then(){throw opaque;}};
      if(kind==="then getter")return Object.defineProperty({},"then",{get(){throw opaque;}});
      const promise=Promise.reject(opaque);Object.defineProperty(promise,"then",{get(){maskedReads++;throw opaque;}});return promise;
    };
    await expect(binding(digest).fingerprint("synthetic")).rejects.toThrow(/^Domain fingerprint unavailable$/);
    await new Promise<void>(resolve=>setImmediate(resolve));expect(touches).toBe(0);expect(maskedReads).toBe(0);
  });
  it.each(["native","masked","thenable"])("observes supported async success: %s", async kind => {
    let maskedReads=0;
    const output=new Uint8Array(32).fill(0xab).buffer;
    const digest=()=>{
      if(kind==="thenable")return {then(resolve:(value:ArrayBuffer)=>void){resolve(output);}};
      const promise=Promise.resolve(output);if(kind==="masked")Object.defineProperty(promise,"then",{get(){maskedReads++;throw 0;}});return promise;
    };
    expect(await binding(digest).fingerprint("synthetic")).toBe("ab".repeat(32));expect(maskedReads).toBe(0);
  });
  it("requires real readable exact buffers, including cross-realm, with no property inspection", async () => {
    let touched=0;const spoof=new Proxy({}, {get(_target,key){if(key==="then")return undefined;touched++;throw 0;},getPrototypeOf(){touched++;throw 0;}});
    const detached=new ArrayBuffer(32);structuredClone(detached,{transfer:[detached]});
    for(const output of [null,undefined,"00".repeat(32),false,new Uint8Array(32),new DataView(new ArrayBuffer(32)),new ArrayBuffer(31),new ArrayBuffer(33),detached,spoof,{byteLength:32}])await expect(binding(()=>output).fingerprint("synthetic")).rejects.toThrow(/^Domain fingerprint unavailable$/);
    const crossRealm=runInNewContext("new ArrayBuffer(32)");expect(crossRealm instanceof ArrayBuffer).toBe(false);expect(await binding(()=>crossRealm).fingerprint("synthetic")).toBe("00".repeat(32));expect(touched).toBe(0);
  });
  it("waits for actual pending settlement without retries, timeout or assumed success", async () => {
    let resolve!:(value:ArrayBuffer)=>void,calls=0,done=false;
    const pending=new Promise<ArrayBuffer>(settle=>{resolve=settle;});
    const operation=binding(()=>{calls++;return pending;}).fingerprint("synthetic").then(value=>{done=true;return value;});
    await Promise.resolve();await Promise.resolve();expect(done).toBe(false);expect(calls).toBe(1);
    resolve(new ArrayBuffer(32));expect(await operation).toBe("00".repeat(32));expect(calls).toBe(1);
  });
  it("matches the unchanged actual D fingerprint normalization without new grants or defaults", async () => {
    vi.stubGlobal("crypto",webcrypto);const port=binding();const injected:NativeMigrationFingerprint=port.fingerprint;
    expect(await digestValue(injected,"synthetic")).toEqual({status:"computed",value:independent("synthetic")});
    const unavailable:NativeMigrationFingerprint=binding(()=>Promise.reject({private:"synthetic"})).fingerprint;
    expect(await digestValue(unavailable,"synthetic")).toEqual({status:"unavailable"});
    expect(port.isWellFormedFingerprint(independent("synthetic"))).toBe(true);
  });
  for(const dependency of ["digest","encode"] as const)for(const kind of ["redirect","throw"] as const)it(`captures actual ${dependency} with its receiver, ignoring supplied invocation properties (${kind})`, async () => {
    let suppliedReads=0,actualCalls=0;
    const digest=function(this:unknown,algorithm:"SHA-256",bytes:Uint8Array<ArrayBuffer>){expect(this).toBe(subtle);if(dependency==="digest")actualCalls++;return webcrypto.subtle.digest(algorithm,bytes);};
    const encode=function(this:unknown,input:string){expect(this).toBeInstanceOf(Encoder);if(dependency==="encode")actualCalls++;return new platformEncoder().encode(input);};
    const operation=dependency==="digest"?digest:encode;
    for(const property of ["bind","call","apply"])Object.defineProperty(operation,property,{get(){suppliedReads++;if(kind==="throw")throw new Error("synthetic getter");return ()=>dependency==="digest"?()=>new ArrayBuffer(32):()=>new platformEncoder().encode("wrong frame");}});
    const subtle={digest};class Encoder {encode=encode;}
    vi.stubGlobal("crypto",{subtle});vi.stubGlobal("TextEncoder",Encoder);
    const result=createPlatformDomainFingerprint();expect(result.ok).toBe(true);if(!result.ok)return;
    expect(actualCalls).toBe(0);expect(await result.value.fingerprint("actual raw")).toBe(independent("actual raw"));expect(actualCalls).toBe(1);expect(suppliedReads).toBe(0);
  });
  it("uses the intrinsic buffer length despite an own spoofed getter", async () => {
    let reads=0;const output=new Uint8Array(32).fill(0xab).buffer;
    Object.defineProperty(output,"byteLength",{get(){reads++;throw new Error("must use intrinsic");}});
    expect(await binding(()=>output).fingerprint("raw")).toBe("ab".repeat(32));expect(reads).toBe(0);
  });
  it("refuses shared buffers despite a matching byte length", async () => {
    await expect(binding(()=>new SharedArrayBuffer(32)).fingerprint("raw")).rejects.toThrow(/^Domain fingerprint unavailable$/);
  });
  it("observes a conforming delayed thenable with exact Unicode framing", async () => {
    const port=binding((algorithm:"SHA-256",bytes:Uint8Array<ArrayBuffer>)=>({then(resolve:(value:ArrayBuffer)=>void,reject:(reason:unknown)=>void){queueMicrotask(()=>{void webcrypto.subtle.digest(algorithm,bytes).then(resolve,reject);});}}));
    expect(await port.fingerprint("e\u0301\ud801\u0000🥌")).toBe(independent("e\u0301\ud801\u0000🥌"));
  });
  it("contains a null-masked native rejection without inspecting reason metadata", async () => {
    let reads=0;const reason=new Proxy({}, {get(){reads++;throw 0;},getPrototypeOf(){reads++;throw 0;}});
    const port=binding(()=>{const promise=Promise.reject(reason);Object.defineProperty(promise,"then",{value:null});return promise;});
    await expect(port.fingerprint("raw")).rejects.toThrow(/^Domain fingerprint unavailable$/);
    await new Promise<void>(resolve=>setImmediate(resolve));expect(reads).toBe(0);
  });
});
