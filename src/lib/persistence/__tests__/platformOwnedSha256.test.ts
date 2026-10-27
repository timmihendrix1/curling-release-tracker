import { afterEach, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { captureOwnedPlatformSha256, settlePlatformSha256Preparation } from "../platformSha256";
const Encoder = TextEncoder;
afterEach(() => vi.unstubAllGlobals());
function deferred() { let resolve!: (v?: unknown) => void; const promise = new Promise<unknown>(r => { resolve = r; }); return { promise, resolve }; }
const pause = () => new Promise(r => setTimeout(r, 5));
it("uses actual standard SHA256 without a digest injection", async () => {
  vi.stubGlobal("TextEncoder", Encoder); vi.stubGlobal("crypto", webcrypto);
  const c = captureOwnedPlatformSha256(() => false, () => true); expect(c.ok).toBe(true); if (!c.ok) throw null;
  expect(await c.value.hash("synthetic\ud800" )).toBe(createHash("sha256").update("synthetic\ud800").digest("hex"));
});
it.each(["crypto", "subtle", "digest", "constructor", "encoder", "encode"])("excludes exact owned %s before inspecting it", async field => {
  const own = deferred(); let traps = 0;
  Object.defineProperty(own.promise, "then", { get() { traps++; throw null; } });
  vi.stubGlobal("TextEncoder", field === "constructor" ? own.promise : function () { return field === "encoder" ? own.promise : { encode: field === "encode" ? own.promise : Encoder.prototype.encode }; });
  vi.stubGlobal("crypto", field === "crypto" ? own.promise : { subtle: field === "subtle" ? own.promise : { digest: field === "digest" ? own.promise : webcrypto.subtle.digest } });
  const c = captureOwnedPlatformSha256(v => v === own.promise, () => true);
  expect(c.ok).toBe(false); await settlePlatformSha256Preparation(c); expect(traps).toBe(0); own.resolve();
});
it.each(["crypto", "subtle", "digest", "encoder", "encode"])("joins unrelated async acquired %s before refusal", async field => {
  const held = deferred(); let later = 0;
  vi.stubGlobal("TextEncoder", function () { return field === "encoder" ? held.promise : { encode: field === "encode" ? held.promise : Encoder.prototype.encode }; });
  vi.stubGlobal("crypto", field === "crypto" ? held.promise : { get subtle() { if (field === "encoder" || field === "encode") later++; return field === "subtle" ? held.promise : { digest: held.promise }; } });
  const c = captureOwnedPlatformSha256(() => false, () => true); expect(c.ok).toBe(false);
  let done = false; const wait = settlePlatformSha256Preparation(c).then(() => { done = true; });
  await pause(); expect(done).toBe(false); expect(later).toBe(0); held.resolve(); await wait;
});
it("registers the outward hash before crypto can return that exact completion", async () => {
  vi.stubGlobal("TextEncoder", Encoder); vi.stubGlobal("crypto", { subtle: { digest: () => hash } });
  const c = captureOwnedPlatformSha256(() => false, () => true); if (!c.ok) throw null;
  const hash = c.value.hash("synthetic"); await expect(hash).rejects.toThrow("Owned platform fingerprint unavailable");
});
it("excludes a separately owned prepare completion nested in native fulfillment", async () => {
  const own = deferred(); Object.defineProperty(own.promise, "then", { value: null });
  const wrap = Promise.resolve({ then(resolve: (v: unknown) => void) { resolve(own.promise); } });
  vi.stubGlobal("TextEncoder", Encoder); vi.stubGlobal("crypto", { subtle: { digest: () => wrap } });
  const c = captureOwnedPlatformSha256(v => v === own.promise, () => true); if (!c.ok) throw null;
  await expect(c.value.hash("synthetic")).rejects.toThrow(); own.resolve();
});
it("stops acquisition after a reentrant close but joins the acquired pending value", async () => {
  let live = true, later = 0; const held = deferred();
  vi.stubGlobal("TextEncoder", function () { return { get encode() { live = false; return held.promise; } }; });
  vi.stubGlobal("crypto", { get subtle() { later++; return webcrypto.subtle; } });
  const c = captureOwnedPlatformSha256(() => false, () => live); expect(c.ok).toBe(false);
  let done = false; const wait = settlePlatformSha256Preparation(c).then(() => { done = true; });
  await pause(); expect(done).toBe(false); expect(later).toBe(0); held.resolve(); await wait;
});
it("joins issued digest after close and never adopts its eventual valid bytes", async () => {
  let live = true; const held = deferred();
  vi.stubGlobal("TextEncoder", Encoder); vi.stubGlobal("crypto", { subtle: { digest: () => { live = false; return held.promise; } } });
  const c = captureOwnedPlatformSha256(() => false, () => live); if (!c.ok) throw null;
  let done = false; const hash = c.value.hash("synthetic").catch(() => { done = true; });
  await pause(); expect(done).toBe(false); held.resolve(new ArrayBuffer(32)); await hash; expect(done).toBe(true);
});
it("drains a malformed then field and refuses it rather than interpreting later bytes", async () => {
  const held = deferred(); vi.stubGlobal("TextEncoder", Encoder); vi.stubGlobal("crypto", { subtle: { digest: () => ({ then: held.promise }) } });
  const c = captureOwnedPlatformSha256(() => false, () => true); if (!c.ok) throw null;
  let done = false; const hash = c.value.hash("synthetic").catch(() => { done = true; });
  await pause(); expect(done).toBe(false); held.resolve(new ArrayBuffer(32)); await hash;
});
it("does not reacquire a captured then getter when its original value was exact-owned", async () => {
  const own = deferred(); let gets = 0;
  vi.stubGlobal("crypto", { get then() { gets++; return gets === 1 ? own.promise : undefined; } });
  const capture = captureOwnedPlatformSha256(v => v === own.promise, () => true);
  expect(capture.ok).toBe(false); await settlePlatformSha256Preparation(capture); own.resolve(); expect(gets).toBe(1);
});
