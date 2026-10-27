import { createHash, webcrypto } from "node:crypto";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createPlatformCredentialFingerprint } from "../platformCredentialFingerprint";
import { fixedCredentialSlots, SDK_RAW_LIMIT } from "../../supabase/providerCredentialContract";

const root = "sb-fixture-auth-token", purpose = "credential-value/v1";
const platformEncoder = globalThis.TextEncoder;
function binding(digest?: unknown) {
  const result = createPlatformCredentialFingerprint(root, digest);
  if (!result.ok) throw new Error("fixture unavailable");
  return result.value;
}
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });

describe("inactive standard platform credential fingerprints", () => {
  for (const target of ["encoder","digest"] as const) for (const property of ["bind","call","apply"]) for (const behavior of ["throw","redirect"]) it(`ignores supplied ${target}.${property} ${behavior} and hashes actual tuple bytes`,async()=>{
    let inspected=0, calls=0, captures=0;const encoderReceivers=new WeakSet<object>();
    const encodeOperation=function(this:object,value:string){expect(encoderReceivers.has(this)).toBe(true);return new platformEncoder().encode(value);};
    const subtle={get digest(){captures++;return digestOperation;}};
    const digestOperation=function(this:object,algorithm:string,bytes:Uint8Array<ArrayBuffer>){expect(this).toBe(subtle);calls++;return Reflect.apply(webcrypto.subtle.digest,webcrypto.subtle,[algorithm,bytes]);};
    Object.defineProperty(target==="encoder"?encodeOperation:digestOperation,property,{get(){inspected++;if(behavior==="throw")throw new Error("must not inspect");return ()=>()=>target==="encoder"?new Uint8Array([1]):new ArrayBuffer(32);}});
    vi.stubGlobal("TextEncoder",class {get encode(){encoderReceivers.add(this);return encodeOperation;}});vi.stubGlobal("crypto",{subtle});
    const port=binding();expect(calls).toBe(0);expect(captures).toBe(1);expect(inspected).toBe(0);
    vi.stubGlobal("TextEncoder",null);vi.stubGlobal("crypto",null);
    const outputs=[];for(const raw of ["SYNTHETIC_FIRST","SYNTHETIC_SECOND"]) {
      const expected=createHash("sha256").update(JSON.stringify([purpose,root,raw]),"utf8").digest("hex");
      const result=await port.fingerprint(purpose,root,raw);expect(result).toBe(expected);outputs.push(result);
    }
    expect(outputs[0]).not.toBe(outputs[1]);expect(inspected).toBe(0);expect(captures).toBe(1);expect(calls).toBe(2);
  });
  it("matches independent SHA-256 of exact JSON tuple bytes on real Web Crypto", async () => {
    vi.stubGlobal("crypto", webcrypto);
    const port = binding();
    for (const key of [...fixedCredentialSlots(root).map(slot => slot.key), root + "-flow-aB_-1234-code-verifier"]) {
      for (const raw of ["", "fixture", "\u0000\n\"\\", "🥌", "é", "e\u0301", "\ud800", "\udc00", "�", "a,b\",\"c"]) {
        const expected = createHash("sha256").update(JSON.stringify([purpose, key, raw]), "utf8").digest("hex");
        expect(await port.fingerprint(purpose, key, raw)).toBe(expected);
      }
    }
    const raws = ["\ud800", "\udc00", "�", "é", "e\u0301"];
    expect(new Set(await Promise.all(raws.map(raw => port.fingerprint(purpose, root, raw)))).size).toBe(raws.length);
    expect(Object.isFrozen(port)).toBe(true);
  });
  it("captures dependencies without computing and uses exact tuple bytes/algorithm", async () => {
    const digest = vi.fn(() => Promise.resolve(new Uint8Array(32).fill(0xab).buffer));
    const port = binding(digest);
    expect(digest).not.toHaveBeenCalled();
    expect(await port.fingerprint(purpose, root, "\ud800")).toBe("ab".repeat(32));
    expect(digest).toHaveBeenCalledTimes(1);
    expect(digest.mock.calls[0]).toEqual(["SHA-256", new platformEncoder().encode('["credential-value/v1","sb-fixture-auth-token","\\ud800"]')]);
  });
  it("retains captured standard digest/encoder even when globals later change", async () => {
    const digest = vi.fn(() => Promise.resolve(new ArrayBuffer(32)));
    vi.stubGlobal("crypto", { subtle: { digest } });
    const port = binding();
    vi.stubGlobal("crypto", null); vi.stubGlobal("TextEncoder", null);
    expect(await port.fingerprint(purpose, root, "fixture")).toBe("00".repeat(32));
    expect(digest).toHaveBeenCalledTimes(1);
  });
  it("reads the digest operation once and rejects a nonfunction with a spoofed bind", async () => {
    const get = vi.fn(() => () => Promise.resolve(new ArrayBuffer(32)));
    vi.stubGlobal("crypto", { subtle: Object.defineProperty({}, "digest", { get }) });
    const port = binding();
    expect(get).toHaveBeenCalledTimes(1);
    expect(await port.fingerprint(purpose, root, "fixture")).toBe("00".repeat(32));
    expect(get).toHaveBeenCalledTimes(1);
    vi.stubGlobal("crypto", { subtle: { digest: { bind: () => () => new ArrayBuffer(32) } } });
    expect(createPlatformCredentialFingerprint(root)).toEqual({ ok: false, issue: { code: "evidence_unavailable", field: "evidence" } });
    expect(createPlatformCredentialFingerprint(root, null).ok).toBe(false);
  });
  it("has a synchronous exact lowercase fixed-length format predicate", () => {
    const format = binding(() => new ArrayBuffer(32)).isWellFormedFingerprint;
    expect(format("01ab".repeat(16))).toBe(true);
    for (const candidate of ["", "a".repeat(63), "a".repeat(65), "A".repeat(64), "a".repeat(64) + "\n", "z".repeat(64), null, {}, new String("a".repeat(64))]) expect(format(candidate as string)).toBe(false);
  });
  it("refuses invalid roots without observing dependencies", () => {
    const get = vi.fn(() => { throw new Error("PRIVATE"); });
    vi.stubGlobal("crypto", Object.defineProperty({}, "subtle", { get }));
    for (const candidate of [null, {}, "", root + "\n", "sb-UPPER-auth-token"]) expect(createPlatformCredentialFingerprint(candidate).ok).toBe(false);
    expect(get).not.toHaveBeenCalled();
  });
  it("returns only fixed construction failures for missing or throwing capabilities", () => {
    for (const crypto of [null, {}, { subtle: null }, { subtle: {} }, Object.defineProperty({}, "subtle", { get() { throw new Error("PRIVATE"); } })]) {
      vi.stubGlobal("crypto", crypto);
      expect(createPlatformCredentialFingerprint(root)).toEqual({ ok: false, issue: { code: "evidence_unavailable", field: "evidence" } });
    }
    vi.stubGlobal("TextEncoder", null);
    expect(createPlatformCredentialFingerprint(root, () => new ArrayBuffer(32)).ok).toBe(false);
  });
  it("rejects invalid inputs before invoking digest, with safe errors and no coercion", async () => {
    const digest = vi.fn(() => new ArrayBuffer(32)), port = binding(digest);
    const hostile = new Proxy({}, { get() { throw new Error("PRIVATE"); } });
    for (const [p, key, raw] of [["wrong", root, "value"], [purpose, "sb-other-auth-token", "value"], [purpose, root + "-unknown", "value"], [purpose, root + "-flow-abcdefgh\n-code-verifier", "value"], [purpose, root, "a".repeat(SDK_RAW_LIMIT + 1)], [purpose, root, hostile], [hostile, root, "value"], [purpose, hostile, "value"]]) {
      await expect(port.fingerprint(p as typeof purpose, key as string, raw as string)).rejects.toThrow(/^Credential fingerprint unavailable$/);
    }
    expect(digest).not.toHaveBeenCalled();
  });
  it("accepts the full code-unit raw budget without granting semantic admission", async () => {
    const digest = vi.fn(() => new ArrayBuffer(32));
    expect(await binding(digest).fingerprint(purpose, root, "\ud800".repeat(SDK_RAW_LIMIT))).toBe("00".repeat(32));
    expect(digest).toHaveBeenCalledTimes(1);
  });
  it("contains rejection/thenable/throw reasons without accessing them or producing fallback hashes", async () => {
    let inspected = false;
    const reason = Object.defineProperty({}, "message", { get() { inspected = true; throw null; } });
    for (const digest of [() => { throw reason; }, () => Promise.reject(reason), () => ({ then() { throw reason; } }), () => Object.defineProperty({}, "then", { get() { throw reason; } })]) {
      await expect(binding(digest).fingerprint(purpose, root, "fixture")).rejects.toThrow(/^Credential fingerprint unavailable$/);
    }
    expect(inspected).toBe(false);
  });
  it("observes real native Promise state with a masked own then", async () => {
    const reject = Object.defineProperty(Promise.reject(new Error("PRIVATE")), "then", { get() { throw new Error("must not inspect"); } });
    await expect(binding(() => reject).fingerprint(purpose, root, "fixture")).rejects.toThrow(/^Credential fingerprint unavailable$/);
    const resolve = Object.defineProperty(Promise.resolve(new ArrayBuffer(32)), "then", { value: null });
    expect(await binding(() => resolve).fingerprint(purpose, root, "fixture")).toBe("00".repeat(32));
  });
  it("requires an actual 32-byte ArrayBuffer without inspecting hostile payload properties", async () => {
    const spoof = new Proxy({}, { get() { throw new Error("PRIVATE"); } });
    for (const output of [null, undefined, "00".repeat(32), new Uint8Array(32), new ArrayBuffer(31), new ArrayBuffer(33), { byteLength: 32 }, spoof]) {
      await expect(binding(() => output).fingerprint(purpose, root, "fixture")).rejects.toThrow(/^Credential fingerprint unavailable$/);
    }
    const detached = new ArrayBuffer(32); structuredClone(detached, { transfer: [detached] });
    await expect(binding(() => detached).fingerprint(purpose, root, "fixture")).rejects.toThrow(/^Credential fingerprint unavailable$/);
  });
  it("leaves a pending dependency pending without timeout/retry/false evidence", async () => {
    let resolve!: (value: ArrayBuffer) => void, settled = false;
    const digest = vi.fn(() => new Promise<ArrayBuffer>(done => { resolve = done; }));
    const result = Promise.resolve(binding(digest).fingerprint(purpose, root, "fixture")).then(hash => { settled = true; return hash; });
    await Promise.resolve(); await Promise.resolve();
    expect(settled).toBe(false); expect(digest).toHaveBeenCalledTimes(1);
    resolve(new ArrayBuffer(32)); expect(await result).toBe("00".repeat(32));
  });
});
