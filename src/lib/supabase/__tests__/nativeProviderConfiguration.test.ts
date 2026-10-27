import { createHash, webcrypto } from "node:crypto";
import { runInNewContext } from "node:vm";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { prepareNativeProviderConfiguration as prepare, resolveNativeProviderConfiguration as resolve } from "../nativeProviderConfiguration";

const config = { status: "configured", url: "https://synthetic.supabase.invalid", publishableKey: "sb_publishable_SYNTHETIC_CONFIGURATION" };
const root = "sb-synthetic-auth-token";
const tuple = (value = config) => JSON.stringify(["native-provider-configuration/v1", "auth-js/2.112.3:credential-v1", value.url, value.publishableKey, `sb-${new URL(value.url).hostname.split(".")[0]}-auth-token`]);
beforeEach(() => { vi.stubGlobal("crypto", webcrypto); });
afterEach(() => { vi.unstubAllGlobals(); vi.restoreAllMocks(); });
async function captured(input: unknown = config) { const result = await prepare(input); expect(result.ok).toBe(true); if (!result.ok) throw new Error("Synthetic preparation failed"); return { result, binding: result.value, value: resolve(result.value)! }; }
function digestReturn(value: unknown) { const digest = vi.fn<(algorithm: string, bytes: Uint8Array) => unknown>(() => value); vi.stubGlobal("crypto", { subtle: { digest } }); return digest; }

it("pins exact standard SHA-256 bytes, full physical identity and opaque immutable capability", async () => {
  const { result, binding, value } = await captured();
  expect(value.providerConfigIdentity).toBe(`pc1:${createHash("sha256").update(tuple()).digest("hex")}`);
  expect(value.providerConfigIdentity).toHaveLength(68); expect(value.sessionStorageKey).toBe(root);
  expect(Reflect.ownKeys(binding)).toEqual([]); expect(Object.getPrototypeOf(binding)).toBe(null);
  for (const object of [result, binding, value, value.config, value.domainFingerprint, value.credentialFingerprint]) expect(Object.isFrozen(object)).toBe(true);
  const slots = await import("../../persistence/credentialPhysicalSlots");
  expect(slots.credentialManifestSlot(value.providerConfigIdentity).ok).toBe(true);
  expect(await value.domainFingerprint.fingerprint("synthetic\u0000\ud800")).toBe(createHash("sha256").update(JSON.stringify(["domain-value/v1", "synthetic\u0000\ud800"])).digest("hex"));
  expect(await value.credentialFingerprint.fingerprint("credential-value/v1", root, "synthetic\udfff")).toBe(createHash("sha256").update(JSON.stringify(["credential-value/v1", root, "synthetic\udfff"])).digest("hex"));
});
it("is stable across fresh module lifetime while capabilities remain module-private", async () => {
  const old = await captured(); vi.resetModules(); const fresh = await import("../nativeProviderConfiguration");
  const result = await fresh.prepareNativeProviderConfiguration({ ...config }); expect(result.ok).toBe(true); if (!result.ok) throw null;
  expect(fresh.resolveNativeProviderConfiguration(result.value)?.providerConfigIdentity).toBe(old.value.providerConfigIdentity);
  expect(fresh.resolveNativeProviderConfiguration(old.binding)).toBe(null); expect(resolve(result.value)).toBe(null);
});
it.each(["\ud800", "\udfff", "é", "e\u0301", "\"\\\u0000", "😀"])("preserves exact JSON/UTF-16 tuple bytes %#", async suffix => {
  const input = { ...config, publishableKey: config.publishableKey + suffix };
  const { value } = await captured(input);
  expect(value.providerConfigIdentity).toBe(`pc1:${createHash("sha256").update(tuple(input)).digest("hex")}`);
});
it.each([
  { ...config, publishableKey: config.publishableKey + "ROTATED" },
  { ...config, url: "https://synthetic.other.invalid" },
  { ...config, url: config.url + "/" }, { ...config, url: "https://SYNTHETIC.supabase.invalid" },
  { ...config, url: "https://synthetic.supabase.invalid:443" },
  { ...config, url: config.url + "/path" }, { ...config, url: "https://another.supabase.invalid" },
])("distinguishes exact provider tuple %# without URL equivalence", async input => {
  const a = await captured(), b = await captured(input);
  expect(a.value.providerConfigIdentity).not.toBe(b.value.providerConfigIdentity);
  expect(b.value.providerConfigIdentity).toBe(`pc1:${createHash("sha256").update(tuple(input)).digest("hex")}`);
});
it.each([null, [], "configured", {}, { ...config, extra: true }, { ...config, status: "cloud_disabled" },
  { ...config, url: " " + config.url }, { ...config, publishableKey: "sb_secret_SYNTHETIC_NEVER_VALID" },
  { ...config, url: config.url + "?query=synthetic" }, { ...config, url: config.url + "#synthetic" },
  { ...config, url: "https://synthetic:synthetic@synthetic.invalid" }, { ...config, url: "https://[::1]" },
])("refuses malformed config %# before digest", async input => {
  const digest = digestReturn(new ArrayBuffer(32)); expect(await prepare(input)).toEqual({ ok: false, reason: "invalid_configuration" }); expect(digest).not.toHaveBeenCalled();
});
it("never invokes foreign getters/coercion and drains directly observed async input", async () => {
  const getter = vi.fn(() => { throw new Error("SYNTHETIC_PRIVATE_REASON"); });
  const accessor = Object.defineProperty({ ...config }, "url", { get: getter });
  const digest = digestReturn(new ArrayBuffer(32));
  expect(await prepare(accessor)).toEqual({ ok: false, reason: "invalid_configuration" }); expect(getter).not.toHaveBeenCalled();
  const cyclic: Record<string, unknown> = { ...config }; cyclic.extra = cyclic;
  const thenable = vi.fn((resolve: (value: unknown) => void) => resolve(undefined));
  const malformed = [cyclic, { ...config, [Symbol("synthetic")]: true }, { ...config, then: thenable }, { ...config, constructor: getter }, { ...config, toJSON: getter },
    { ...config, url: Promise.reject("SYNTHETIC_PRIVATE_REASON") }, Promise.reject("SYNTHETIC_PRIVATE_REASON")];
  for (const input of malformed) expect(await prepare(input)).toEqual({ ok: false, reason: "invalid_configuration" });
  expect(getter).not.toHaveBeenCalled(); expect(digest).not.toHaveBeenCalled();
});
it("captures primitives/platform receiver before pending digest and ignores subsequent mutation", async () => {
  let finish!: (value: ArrayBuffer) => void; const pending = new Promise<ArrayBuffer>(resolve => { finish = resolve; });
  const digest = digestReturn(pending), subtle = globalThis.crypto.subtle, input = { ...config };
  const preparation = prepare(input); expect(digest).toHaveBeenCalledTimes(1); expect(digest.mock.contexts[0]).toBe(subtle);
  expect(new TextDecoder().decode(digest.mock.calls[0][1] as Uint8Array)).toBe(tuple());
  input.url = "https://changed.invalid"; input.publishableKey = "sb_publishable_SYNTHETIC_CHANGED";
  vi.stubGlobal("crypto", undefined); finish(new Uint8Array(32).fill(3).buffer);
  const result = await preparation; expect(result.ok).toBe(true); if (!result.ok) throw null;
  expect(resolve(result.value)?.config).toEqual(config); expect(resolve(result.value)?.providerConfigIdentity).toBe("pc1:" + "03".repeat(32));
});
it("keeps invalid directly observed pending input owned until it settles", async () => {
  let finish!: (value: unknown) => void;
  const pending = new Promise(resolve => { finish = resolve; }), digest = digestReturn(new ArrayBuffer(32));
  let settled = false;
  const result = prepare({ ...config, url: pending }).then(value => { settled = true; return value; });
  await Promise.resolve(); await Promise.resolve(); expect(settled).toBe(false); expect(digest).not.toHaveBeenCalled();
  finish(undefined); expect(await result).toEqual({ ok: false, reason: "invalid_configuration" });
});
it.each([undefined, null, {}, new Uint8Array(32), new ArrayBuffer(31), new ArrayBuffer(33), { byteLength: 32 }])("rejects malformed digest %# with fixed opaque error", async value => {
  digestReturn(value); expect(await prepare(config)).toEqual({ ok: false, reason: "evidence_unavailable" });
});
it("contains failed/masked async digests and accepts supported masked success", async () => {
  for (const rejected of [Promise.reject("SYNTHETIC_PRIVATE_REASON"), Object.defineProperty(Promise.reject("SYNTHETIC_PRIVATE_REASON"), "then", { value: null })]) {
    vi.stubGlobal("crypto", { subtle: { digest: () => rejected } }); expect(await prepare(config)).toEqual({ ok: false, reason: "evidence_unavailable" });
  }
  const masked = Object.defineProperty(Promise.resolve(new ArrayBuffer(32)), "then", { value: null });
  vi.stubGlobal("crypto", { subtle: { digest: () => masked } });
  expect((await prepare(config)).ok).toBe(true);
});
it("contains missing/throwing platform capability and a detached result", async () => {
  vi.stubGlobal("crypto", undefined); expect(await prepare(config)).toEqual({ ok: false, reason: "evidence_unavailable" });
  vi.stubGlobal("crypto", { get subtle() { throw "SYNTHETIC_PRIVATE_REASON"; } }); expect(await prepare(config)).toEqual({ ok: false, reason: "evidence_unavailable" });
  vi.stubGlobal("crypto", { subtle: { digest() { throw "SYNTHETIC_PRIVATE_REASON"; } } }); expect(await prepare(config)).toEqual({ ok: false, reason: "evidence_unavailable" });
  const buffer = new ArrayBuffer(32); structuredClone(buffer, { transfer: [buffer] }); digestReturn(buffer);
  expect(await prepare(config)).toEqual({ ok: false, reason: "evidence_unavailable" });
});
it("accepts a genuine cross-realm buffer and observes a conforming thenable", async () => {
  const buffer = runInNewContext("new ArrayBuffer(32)") as ArrayBuffer;
  vi.stubGlobal("crypto", { subtle: { digest: () => ({ then(resolve: (value: unknown) => void) { resolve(buffer); } }) } });
  const result = await prepare(config); expect(result.ok).toBe(true); if (!result.ok) throw null;
  expect(resolve(result.value)?.providerConfigIdentity).toBe("pc1:" + "00".repeat(32));
});
it("rejects forged/proxy/wrapped capability without invoking a trap", async () => {
  const { binding } = await captured(); const trap = vi.fn(() => { throw null; });
  for (const value of [{}, { ...binding }, Object.create(binding), new Proxy(binding, { get: trap, getPrototypeOf: trap }), null, "synthetic"]) expect(resolve(value)).toBe(null);
  expect(trap).not.toHaveBeenCalled();
});
