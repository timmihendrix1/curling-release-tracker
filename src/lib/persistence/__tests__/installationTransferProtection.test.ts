import { createCipheriv, createDecipheriv, webcrypto } from "node:crypto";
import { afterEach, expect, it, vi } from "vitest";
import { sealInstallationTransferV3, openInstallationTransferV3 } from "../installationTransferProtection";
import { encodeInstallationTransferV3, decodeInstallationTransferV3 } from "../installationTransferV3";
import { TRANSFER_SPORTING_SUFFIXES, TRANSFER_IDENTITY_KEYS, TRANSFER_LEGACY_KEY, TRANSFER_LIMITS } from "../installationTransferInventory";

const header = "curling-protected-installation-v1\nAES-256-GCM-V3ASCII\n";
const aad = Buffer.from("curling-protected-installation/v1\0AES-256-GCM\0v3-canonical-ascii\0archive-v3", "ascii");
const profile = "10000000-0000-4000-8000-000000000001", nonce = "20000000-0000-4000-8000-000000000002";
const slot = (index = 0) => `curling.sporting.profile.v1.${profile}.${TRANSFER_SPORTING_SUFFIXES[index]}`;
const guard = `curling.identity.accountDeletionGuard.${profile}.v1`;
const key = Buffer.alloc(32, 7), iv = Buffer.alloc(12, 9); // Public synthetic interop fixtures.
const recovery = "ct1-" + key.toString("base64url");
function pending() { let resolve!: (value: unknown) => void, reject!: (value: unknown) => void; const promise = new Promise<unknown>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 5));
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

async function archive(raws: Record<string, string> = {}) {
  vi.stubGlobal("crypto", webcrypto);
  const profiles = Object.keys(raws).some(name => name.startsWith("curling.sporting.profile.")) ? [profile] : [];
  const fixed = [...TRANSFER_IDENTITY_KEYS, TRANSFER_LEGACY_KEY];
  const dynamic = Object.keys(raws).filter(name => name.startsWith("curling.identity.") && !fixed.includes(name));
  const names = [...fixed, ...dynamic, ...profiles.flatMap(id => TRANSFER_SPORTING_SUFFIXES.map(suffix => `curling.sporting.profile.v1.${id}.${suffix}`))].sort();
  const result = await encodeInstallationTransferV3(JSON.stringify({ schemaVersion: 3,
    transferId: "30000000-0000-4000-8000-000000000003", snapshotId: "40000000-0000-4000-8000-000000000004",
    sourceBuild: { version: "synthetic", build: "test" }, catalogContractId: "synthetic",
    listing: { schemaVersion: 1, keys: Object.keys(raws).sort() },
    observations: names.map(name => Object.hasOwn(raws, name) ? { key: name, state: "present", raw: raws[name] } : { key: name, state: "absent" }),
    sourceControl: { domain: "absent", credential: "excluded" }, snapshotState: "synthetic_frozen" }));
  expect(result.ok).toBe(true); if (!result.ok) throw Error("Synthetic archive refused"); return result.value;
}
function engine() {
  const calls = { random: 0, imports: 0, encrypt: 0, decrypt: 0, digest: 0 };
  const arrays: Uint8Array[] = [];
  const subtle = {
    digest(algorithm: unknown, bytes: unknown): unknown { calls.digest++; return Reflect.apply(webcrypto.subtle.digest, webcrypto.subtle, [algorithm, bytes]); },
    importKey(...args: unknown[]): unknown { calls.imports++; arrays.push(args[1] as Uint8Array); return Reflect.apply(webcrypto.subtle.importKey, webcrypto.subtle, args); },
    encrypt(...args: unknown[]): unknown { calls.encrypt++; arrays.push(args[2] as Uint8Array, (args[0] as AesGcmParams).additionalData as Uint8Array); return Reflect.apply(webcrypto.subtle.encrypt, webcrypto.subtle, args); },
    decrypt(...args: unknown[]): unknown { calls.decrypt++; arrays.push(args[2] as Uint8Array, (args[0] as AesGcmParams).additionalData as Uint8Array); return Reflect.apply(webcrypto.subtle.decrypt, webcrypto.subtle, args); },
  };
  const root = { subtle, getRandomValues(target: Uint8Array): unknown { calls.random++; arrays.push(target); return webcrypto.getRandomValues(target); } };
  vi.stubGlobal("crypto", root); return { root, subtle, calls, arrays };
}
function protectedByNode(plain: Buffer, secret = key, nonceBytes = iv) {
  const cipher = createCipheriv("aes-256-gcm", secret, nonceBytes, { authTagLength: 16 }); cipher.setAAD(aad);
  const output = Buffer.concat([cipher.update(plain), cipher.final(), cipher.getAuthTag()]);
  return header + nonceBytes.toString("base64url") + "\n" + output.toString("base64url");
}
function assertWiped(arrays: readonly Uint8Array[]) { for (const bytes of arrays) expect(bytes.every(value => value === 0)).toBe(true); }

it.each(["", "\0", "é", "e\u0301", "🥌", "\ud800", "\udc00", "\ufffd", 'a"\\\r\n', "x".repeat(10), "x".repeat(100)])("interoperates with independent Node GCM and preserves original UTF16: %j", async raw => {
  const original = await archive({ [slot()]: raw }), state = engine();
  const sealed = await sealInstallationTransferV3(original.wire); expect(sealed.ok).toBe(true); if (!sealed.ok) throw null;
  expect(sealed.packageDigest).toBe(original.packageDigest); expect(sealed.mayIssue || sealed.mayPublish || sealed.mayMount).toBe(false);
  const lines = sealed.protectedWire.split("\n"); expect(lines.length).toBe(4);
  const recoveredKey = Buffer.from(sealed.recoveryCode.slice(4), "base64url"), ciphertext = Buffer.from(lines[3], "base64url");
  const decipher = createDecipheriv("aes-256-gcm", recoveredKey, Buffer.from(lines[2], "base64url"), { authTagLength: 16 });
  decipher.setAAD(aad); decipher.setAuthTag(ciphertext.subarray(-16));
  const plain = Buffer.concat([decipher.update(ciphertext.subarray(0, -16)), decipher.final()]);
  expect(plain.equals(Buffer.from(original.wire, "ascii"))).toBe(true);
  assertWiped(state.arrays); expect(state.calls.random).toBe(2); expect(state.calls.imports).toBe(1); expect(state.calls.encrypt).toBe(1);
  const opened = await openInstallationTransferV3(protectedByNode(Buffer.from(original.wire, "ascii")), recovery);
  expect(opened.ok).toBe(true); if (!opened.ok) throw null;
  expect(opened.wire === original.wire).toBe(true); expect(opened.packageDigest).toBe(original.packageDigest);
  const decoded = await decodeInstallationTransferV3(opened.wire); expect(decoded.ok).toBe(true);
  if (decoded.ok) expect((decoded.value.envelope.items as { key: string; raw?: string }[]).find(item => item.key === slot())?.raw === raw).toBe(true);
  assertWiped(state.arrays);
});
it("preserves the complete 13-slot inventory, inert deletion controls and explicit absences", async () => {
  const raws: Record<string, string> = Object.fromEntries(TRANSFER_SPORTING_SUFFIXES.map((_, index) => [slot(index), index === 0 ? "" : `opaque-synthetic-${index}`]));
  raws[guard] = JSON.stringify({ schemaVersion: 1, profileId: profile, nonce, revision: 4 });
  raws[TRANSFER_LEGACY_KEY] = "complete";
  const original = await archive(raws), state = engine(), result = await sealInstallationTransferV3(original.wire);
  expect(result.ok).toBe(true); if (!result.ok) throw null;
  const opened = await openInstallationTransferV3(result.protectedWire, result.recoveryCode); expect(opened.ok).toBe(true);
  if (opened.ok) expect(opened.wire === original.wire).toBe(true);
  expect(Object.isFrozen(result)).toBe(true); expect(Object.getPrototypeOf(result)).toBeNull(); assertWiped(state.arrays);
});
it("supports a genuinely empty archive and obtains fresh key/nonce calls for every seal", async () => {
  const original = await archive(), state = engine(), first = await sealInstallationTransferV3(original.wire), second = await sealInstallationTransferV3(original.wire);
  expect(first.ok && second.ok).toBe(true); if (!first.ok || !second.ok) throw null;
  expect(first.recoveryCode !== second.recoveryCode).toBe(true); expect(first.protectedWire !== second.protectedWire).toBe(true);
  expect(first.packageDigest === second.packageDigest).toBe(true); expect(state.calls.random).toBe(4); assertWiped(state.arrays);
});
it("rejects nonprimitive/oversize API input without property, coercion or crypto access", async () => {
  let touches = 0, reads = 0; const hostile = new Proxy({}, { get() { touches++; throw null; }, ownKeys() { touches++; throw null; }, getPrototypeOf() { touches++; throw null; } });
  vi.stubGlobal("crypto", undefined); Object.defineProperty(globalThis, "crypto", { configurable: true, get() { reads++; throw null; } });
  for (const input of [undefined, null, false, 1, Symbol(), hostile, new String("archive"), "", "x".repeat(TRANSFER_LIMITS.wire + 1)]) {
    const result = await sealInstallationTransferV3(input); expect(result.ok).toBe(false); if (!result.ok) expect(result.code).toBe("invalid_input");
  }
  for (const [a, b] of [[hostile, recovery], [header, hostile], ["", recovery], [header, "x".repeat(48)], ["x".repeat(header.length + 17 + Math.ceil((TRANSFER_LIMITS.wire + 16) * 4 / 3) + 1), recovery]]) {
    const result = await openInstallationTransferV3(a, b); expect(result.ok).toBe(false); if (!result.ok) expect(result.code).toBe("invalid_input");
  }
  expect(touches).toBe(0); expect(reads).toBe(0);
});
it("maps actual archive refusals and unavailable actual SHA before random/AES distinctly", async () => {
  const original = await archive(), state = engine();
  for (const input of ["{malformed", original.wire + " "]) { const result = await sealInstallationTransferV3(input); expect(result.ok).toBe(false); if (!result.ok) expect(result.code).toBe("archive_invalid"); }
  state.subtle.digest = () => { throw null; };
  const failed = await sealInstallationTransferV3(original.wire); expect(failed.ok).toBe(false); if (!failed.ok) expect(failed.code).toBe("protection_unavailable");
  expect(state.calls.random).toBe(0); expect(state.calls.imports).toBe(0); expect(state.calls.encrypt).toBe(0);
});
it.each(["header", "algorithm", "padding", "newline", "short-tag", "bad-alphabet", "one-char", "key-bits", "key-padding", "body-bits"])("refuses closed outer/base64 representation before crypto: %s", async kind => {
  const original = await archive(), real = protectedByNode(Buffer.from(original.wire, "ascii"));
  let input = real, code = recovery;
  if (kind === "header") input = real.replace("v1", "v2");
  if (kind === "algorithm") input = real.replace("AES-256", "AES-128");
  if (kind === "padding") input += "=";
  if (kind === "newline") input += "\n";
  if (kind === "short-tag") input = header + iv.toString("base64url") + "\n" + Buffer.alloc(16).toString("base64url");
  if (kind === "bad-alphabet") input = real.slice(0, -1) + "/";
  if (kind === "one-char") input = header + iv.toString("base64url") + "\nA";
  if (kind === "key-bits") code = recovery.slice(0, -1) + "d"; // Same final data bits as canonical c, nonzero unused bits.
  if (kind === "key-padding") code = recovery.slice(0, -1) + "=";
  if (kind === "body-bits") input = header + iv.toString("base64url") + "\n" + Buffer.alloc(17).toString("base64url").slice(0, -1) + "B";
  let reads = 0; vi.stubGlobal("crypto", undefined); Object.defineProperty(globalThis, "crypto", { configurable: true, get() { reads++; throw null; } });
  const result = await openInstallationTransferV3(input, code); expect(result.ok).toBe(false); if (!result.ok) expect(result.code).toBe("invalid_input"); expect(reads).toBe(0);
});
it.each(["code", "nonce", "ciphertext", "tag"])("does not establish authentication after alteration: %s", async kind => {
  const original = await archive(), lines = protectedByNode(Buffer.from(original.wire, "ascii")).split("\n"); engine(); let code = recovery;
  if (kind === "code") code = "ct1-" + Buffer.alloc(32, 8).toString("base64url");
  else { const index = kind === "nonce" ? 2 : 3, bytes = Buffer.from(lines[index], "base64url"); bytes[kind === "tag" ? bytes.length - 1 : 0] ^= 1; lines[index] = bytes.toString("base64url"); }
  const result = await openInstallationTransferV3(lines.join("\n"), code); expect(result.ok).toBe(false); if (!result.ok) expect(result.code).toBe("authentication_failed");
});
it.each(["malformed", "noncanonical", "nonascii", "sha-unavailable"])("authenticated plaintext is still independently admitted: %s", async kind => {
  const original = await archive(), state = engine();
  const plain = kind === "malformed" ? Buffer.from("{malformed") : kind === "noncanonical" ? Buffer.from(original.wire + " ") : kind === "nonascii" ? Buffer.from([255]) : Buffer.from(original.wire);
  if (kind === "sha-unavailable") state.subtle.digest = () => Promise.reject(null);
  const result = await openInstallationTransferV3(protectedByNode(plain), recovery); expect(result.ok).toBe(false);
  if (!result.ok) expect(result.code).toBe(kind === "sha-unavailable" ? "protection_unavailable" : "archive_invalid");
  expect(Object.hasOwn(result, "wire")).toBe(false); assertWiped(state.arrays);
});
it.each(["AES128", "extractable", "wrong-usage", "extra-usage", "HMAC", "public", "forged"])("admits actual CryptoKey metadata before issuing AES: %s", async kind => {
  const original = await archive();
  const wrong = kind === "forged" ? { type: "secret", extractable: false, algorithm: { name: "AES-GCM", length: 256 }, usages: ["encrypt"] }
    : kind === "public" ? (await webcrypto.subtle.generateKey({ name: "ECDSA", namedCurve: "P-256" }, false, ["sign", "verify"])).publicKey
    : kind === "HMAC" ? await webcrypto.subtle.importKey("raw", key, { name: "HMAC", hash: "SHA-256" }, false, ["sign"])
    : await webcrypto.subtle.importKey("raw", Buffer.alloc(kind === "AES128" ? 16 : 32), "AES-GCM", kind === "extractable", kind === "wrong-usage" ? ["decrypt"] : kind === "extra-usage" ? ["encrypt", "decrypt"] : ["encrypt"]);
  const state = engine(); state.subtle.importKey = () => { state.calls.imports++; return Promise.resolve(wrong); };
  const result = await sealInstallationTransferV3(original.wire); expect(result.ok).toBe(false); if (!result.ok) expect(result.code).toBe("protection_unavailable"); expect(state.calls.encrypt).toBe(0); assertWiped(state.arrays);
});
it.each(["importKey", "encrypt", "decrypt"] as const)("owns masked native settlement for actual %s", async method => {
  const original = await archive(), state = engine(), operation = state.subtle[method];
  state.subtle[method] = (...args: unknown[]) => { const result = Reflect.apply(operation, state.subtle, args); Object.defineProperty(result, "then", { value: null }); return result; };
  const sealed = await sealInstallationTransferV3(original.wire); expect(sealed.ok).toBe(true); if (!sealed.ok) throw null;
  expect((await openInstallationTransferV3(sealed.protectedWire, sealed.recoveryCode)).ok).toBe(true); assertWiped(state.arrays);
});
it.each(["random", "import", "encrypt", "decrypt"])("waits for malformed pending %s work without advancing", async kind => {
  const original = await archive(), state = engine(), gate = pending(), started = pending(); Object.defineProperty(gate.promise, "then", { value: null });
  const observed = () => { started.resolve(undefined); return gate.promise; };
  if (kind === "random") state.root.getRandomValues = target => { state.arrays.push(target); return observed(); };
  if (kind === "import") state.subtle.importKey = observed;
  if (kind === "encrypt") state.subtle.encrypt = observed;
  if (kind === "decrypt") state.subtle.decrypt = observed;
  let done = false; const work = (kind === "decrypt" ? openInstallationTransferV3(protectedByNode(Buffer.from(original.wire)), recovery) : sealInstallationTransferV3(original.wire)).then(result => { done = true; return result; });
  try { await started.promise; await tick(); expect(done).toBe(false); gate.resolve(undefined); const result = await work;
    expect(result.ok).toBe(false); if (!result.ok) expect(result.code).toBe("protection_unavailable"); assertWiped(state.arrays);
  } finally { gate.resolve(undefined); await work; }
});
it("refuses asynchronous algorithm metadata before AES even when it advertises plausible fields", async () => {
  const original = await archive(), state = engine(), gate = pending(), started = pending(), old = Object.getOwnPropertyDescriptor(CryptoKey.prototype, "algorithm")!;
  Object.assign(gate.promise, { name: "AES-GCM", length: 256 }); Object.defineProperty(gate.promise, "then", { value: null });
  Object.defineProperty(CryptoKey.prototype, "algorithm", { configurable: true, get() { started.resolve(undefined); return gate.promise; } });
  let done = false; const work = sealInstallationTransferV3(original.wire).then(result => { done = true; return result; });
  try { await started.promise; await tick(); expect(done).toBe(false); expect(state.calls.encrypt).toBe(0); gate.resolve({ name: "AES-GCM", length: 256 }); const result = await work; expect(result.ok).toBe(false); if (!result.ok) expect(result.code).toBe("protection_unavailable"); }
  finally { gate.resolve(undefined); await work; Object.defineProperty(CryptoKey.prototype, "algorithm", old); }
});
it("observes asynchronous captured metadata once and refuses its replacement after settlement", async () => {
  const original = await archive(), state = engine(), gate = pending(); let reads = 0, thenCalls = 0;
  const metadata = { then(resolve: (value: unknown) => void) { thenCalls++; void gate.promise.then(resolve); } };
  Object.defineProperty(globalThis, "crypto", { configurable: true, get() { return ++reads === 1 ? state.root : metadata; } });
  let done = false; const work = sealInstallationTransferV3(original.wire).then(result => { done = true; return result; });
  await tick(); expect(done).toBe(false); gate.resolve(state.root); const result = await work;
  expect(result.ok).toBe(false); expect(thenCalls).toBe(1); expect(state.calls.random).toBe(0);
});
it.each(["encrypt", "decrypt"] as const)("refuses a fulfilled wrong brand/length from %s before success", async kind => {
  const original = await archive();
  for (const output of [null, {}, new Uint8Array(2), new SharedArrayBuffer(2), new ArrayBuffer(1), new ArrayBuffer(original.wire.length + (kind === "encrypt" ? 15 : 1))]) {
    const state = engine(); state.subtle[kind] = () => output;
    const result = await (kind === "encrypt" ? sealInstallationTransferV3(original.wire) : openInstallationTransferV3(protectedByNode(Buffer.from(original.wire)), recovery));
    expect(result.ok).toBe(false); if (!result.ok) expect(result.code).toBe("protection_unavailable"); assertWiped(state.arrays);
  }
});
it.each(["random", "import", "encrypt", "decrypt-sync", "decrypt-reject"])("keeps thrown/rejected reasons opaque: %s", async kind => {
  const original = await archive(), state = engine(); let touches = 0;
  const reason = new Proxy({}, { get() { touches++; throw null; }, getPrototypeOf() { touches++; throw null; }, ownKeys() { touches++; throw null; } });
  if (kind === "random") state.root.getRandomValues = target => { state.arrays.push(target); throw reason; };
  if (kind === "import") state.subtle.importKey = () => Promise.reject(reason);
  if (kind === "encrypt") state.subtle.encrypt = () => Promise.reject(reason);
  if (kind === "decrypt-sync") state.subtle.decrypt = () => { throw reason; };
  if (kind === "decrypt-reject") state.subtle.decrypt = () => Promise.reject(reason);
  const result = await (kind.startsWith("decrypt") ? openInstallationTransferV3(protectedByNode(Buffer.from(original.wire)), recovery) : sealInstallationTransferV3(original.wire));
  expect(result.ok).toBe(false); if (!result.ok) expect(result.code).toBe(kind === "decrypt-reject" ? "authentication_failed" : "protection_unavailable"); expect(touches).toBe(0); assertWiped(state.arrays);
});
it.each(["importKey", "encrypt", "decrypt"] as const)("does not await or accept its own whole result from %s", async method => {
  const original = await archive(), state = engine();
  state.subtle[method] = () => work;
  const work = method === "decrypt" ? openInstallationTransferV3(protectedByNode(Buffer.from(original.wire)), recovery) : sealInstallationTransferV3(original.wire);
  const result = await work; expect(result.ok).toBe(false); if (!result.ok) expect(result.code).toBe("protection_unavailable"); assertWiped(state.arrays);
});

it("retains plaintext until pending encryption settles, then wipes its private input on refusal", async () => {
  const original = await archive({ [slot()]: "synthetic-private-note" }), state = engine(), gate = pending(), started = pending(); let held: Uint8Array | undefined;
  state.subtle.encrypt = (...args: unknown[]) => { held = args[2] as Uint8Array; started.resolve(undefined); return gate.promise; };
  const work = sealInstallationTransferV3(original.wire);
  try { await started.promise; await tick(); expect(held !== undefined).toBe(true); expect(held?.some(value => value !== 0)).toBe(true);
    gate.resolve(undefined); const result = await work; expect(result.ok).toBe(false); expect(held?.every(value => value === 0)).toBe(true);
    expect(JSON.stringify(result).includes("synthetic-private-note")).toBe(false); assertWiped(state.arrays);
  } finally { gate.resolve(undefined); await work; }
});
it.each(["constructor", "data-descriptor"])("refuses missing/invalid public key metadata before entropy: %s", async kind => {
  const original = await archive(), state = engine(), old = Object.getOwnPropertyDescriptor(CryptoKey.prototype, "type")!;
  if (kind === "constructor") vi.stubGlobal("CryptoKey", undefined);
  else Object.defineProperty(CryptoKey.prototype, "type", { configurable: true, value: "secret" });
  try { const result = await sealInstallationTransferV3(original.wire); expect(result.ok).toBe(false); if (!result.ok) expect(result.code).toBe("protection_unavailable"); expect(state.calls.random).toBe(0); }
  finally { if (kind === "data-descriptor") Object.defineProperty(CryptoKey.prototype, "type", old); }
});
it("never invokes an algorithm metadata accessor and owns the observed refused getter work", async () => {
  const original = await archive(), state = engine(), gate = pending(), old = Object.getOwnPropertyDescriptor(CryptoKey.prototype, "algorithm")!; let getters = 0, thenCalls = 0;
  const getter = function() { getters++; throw null; };
  Object.defineProperty(getter, "then", { value(resolve: (value: unknown) => void) { thenCalls++; void gate.promise.then(resolve); } });
  const metadata = Object.create(null); Object.defineProperty(metadata, "name", { get: getter }); Object.defineProperty(metadata, "length", { value: 256 });
  Object.defineProperty(CryptoKey.prototype, "algorithm", { configurable: true, get() { return metadata; } });
  let done = false; const work = sealInstallationTransferV3(original.wire).then(result => { done = true; return result; });
  try { await tick(); expect(done).toBe(false); expect(getters).toBe(0); expect(thenCalls).toBe(1); expect(state.calls.encrypt).toBe(0); gate.resolve(undefined); expect((await work).ok).toBe(false); }
  finally { gate.resolve(undefined); await work; Object.defineProperty(CryptoKey.prototype, "algorithm", old); }
});
it("keeps independent concurrent operations separate when one encryption fails", async () => {
  const original = await archive(), state = engine(), actual = state.subtle.encrypt; let calls = 0;
  state.subtle.encrypt = (...args: unknown[]) => ++calls === 1 ? Promise.reject(null) : Reflect.apply(actual, state.subtle, args);
  const results = await Promise.all([sealInstallationTransferV3(original.wire), sealInstallationTransferV3(original.wire)]);
  expect(results.filter(result => result.ok).length).toBe(1); expect(results.filter(result => !result.ok).length).toBe(1); assertWiped(state.arrays);
});

// Independent CODE review witnesses, including both original native-output failures.
it.each(["valid", "nonascii", "invalid-archive", "hash-unavailable"])("wipes the actual native decrypted buffer after %s", async kind => {
  const original = await archive(), state = engine(); let native: ArrayBuffer | undefined;
  state.subtle.decrypt = (...args: unknown[]) => webcrypto.subtle.decrypt(...args as Parameters<typeof webcrypto.subtle.decrypt>).then(value => { native = value; return value; });
  if (kind === "hash-unavailable") state.subtle.digest = () => Promise.reject(null);
  const plain = kind === "nonascii" ? Buffer.from([255]) : kind === "invalid-archive" ? Buffer.from("{malformed") : Buffer.from(original.wire);
  const result = await openInstallationTransferV3(protectedByNode(plain), recovery);
  expect(result.ok).toBe(kind === "valid"); expect(native !== undefined).toBe(true);
  expect(new Uint8Array(native!).every(value => value === 0)).toBe(true);
  if (!result.ok) expect(result.code).toBe(kind === "hash-unavailable" ? "protection_unavailable" : "archive_invalid");
});
it.each(["success", "refusal"])("keeps native plaintext until pending post-decrypt hash settles: %s", async kind => {
  const original = await archive(), state = engine(), gate = pending(), started = pending(); let native: ArrayBuffer | undefined, done = false;
  state.subtle.decrypt = (...args: unknown[]) => webcrypto.subtle.decrypt(...args as Parameters<typeof webcrypto.subtle.decrypt>).then(value => { native = value; return value; });
  state.subtle.digest = (...args: unknown[]) => {
    const actual = Reflect.apply(webcrypto.subtle.digest, webcrypto.subtle, args);
    started.resolve(undefined);
    return gate.promise.then(() => kind === "success" ? actual : Promise.reject(null));
  };
  const work = openInstallationTransferV3(protectedByNode(Buffer.from(original.wire)), recovery).then(result => { done = true; return result; });
  try {
    await started.promise; await tick(); expect(done).toBe(false); expect(native !== undefined).toBe(true);
    expect(new Uint8Array(native!).some(value => value !== 0)).toBe(true);
    gate.resolve(undefined); expect((await work).ok).toBe(kind === "success");
    expect(new Uint8Array(native!).every(value => value === 0)).toBe(true);
  } finally { gate.resolve(undefined); await work; }
});
it.each(["native-child", "thenable-child", "malformed-field"])("independent import observation drains %s without advancing", async kind => {
  const original = await archive(), state = engine(), gate = pending(), started = pending(); Object.defineProperty(gate.promise, "then", { value: null });
  state.subtle.importKey = () => {
    started.resolve(undefined);
    if (kind === "native-child") return Promise.resolve(gate.promise);
    if (kind === "thenable-child") return { then(resolve: (value: unknown) => void) { resolve(gate.promise); } };
    return { then: gate.promise };
  };
  let done = false; const work = sealInstallationTransferV3(original.wire).then(result => { done = true; return result; });
  try { await started.promise; await tick(); expect(done).toBe(false); gate.resolve(null); expect(await work).toMatchObject({ ok: false, code: "protection_unavailable" }); expect(state.calls.encrypt).toBe(0); }
  finally { gate.resolve(null); await work; }
});
it.each(["type", "extractable", "algorithm", "usages"])("independent malformed key observation drains %s before AES", async name => {
  const original = await archive(), state = engine(), gate = pending(), started = pending(), old = Object.getOwnPropertyDescriptor(CryptoKey.prototype, name)!;
  Object.defineProperty(gate.promise, "then", { value: null });
  Object.defineProperty(CryptoKey.prototype, name, { configurable: true, get() { started.resolve(undefined); return gate.promise; } });
  let done = false; const work = sealInstallationTransferV3(original.wire).then(result => { done = true; return result; });
  try { await started.promise; await tick(); expect(done).toBe(false); expect(state.calls.encrypt).toBe(0); gate.resolve(null); expect(await work).toMatchObject({ ok: false, code: "protection_unavailable" }); }
  finally { gate.resolve(null); await work; Object.defineProperty(CryptoKey.prototype, name, old); }
});
it("independent second operation completes while a malformed first operation remains pending", async () => {
  const original = await archive(), state = engine(), gate = pending(), started = pending(), actual = state.subtle.encrypt; let count = 0;
  state.subtle.encrypt = (...args: unknown[]) => { if (++count === 1) { started.resolve(undefined); return gate.promise; } return Reflect.apply(actual, state.subtle, args); };
  const first = sealInstallationTransferV3(original.wire);
  try { await started.promise; expect((await sealInstallationTransferV3(original.wire)).ok).toBe(true); gate.resolve(null); expect(await first).toMatchObject({ ok: false }); }
  finally { gate.resolve(null); await first; }
});
it.each(["thenable", "masked-native", "field"])("independent own whole-result child from %s is excluded without a cycle", async kind => {
  const original = await archive(), state = engine();
  state.subtle.importKey = () => {
    if (kind === "thenable") return { then(resolve: (value: unknown) => void) { resolve(work); } };
    if (kind === "field") return { then: work };
    Object.defineProperty(work, "then", { value: null }); return Promise.resolve(work);
  };
  const work = sealInstallationTransferV3(original.wire);
  expect(await work).toMatchObject({ ok: false, code: "protection_unavailable" }); expect(state.calls.encrypt).toBe(0);
});
it("independent captured operation ignores poisoned invocation properties", async () => {
  const original = await archive(), state = engine();
  for (const operation of [state.root.getRandomValues, state.subtle.importKey, state.subtle.encrypt]) {
    for (const name of ["bind", "call", "apply"]) Object.defineProperty(operation, name, { get() { throw null; } });
  }
  expect((await sealInstallationTransferV3(original.wire)).ok).toBe(true);
});
