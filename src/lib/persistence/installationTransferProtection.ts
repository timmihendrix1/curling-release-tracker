// Private standard envelope only: no file, source, identity or activation grant.
import { decodeInstallationTransferV3 } from "./installationTransferV3";
import { TRANSFER_LIMITS } from "./installationTransferInventory";
import { observePlatformWork, drainObservedPlatformWork } from "./platformSha256";

type Code = "invalid_input" | "archive_invalid" | "protection_unavailable" | "authentication_failed";
type Result<T> = Readonly<({ ok: true } & T | { ok: false; code: Code }) & {
  mayIssue: false; mayPublish: false; mayMount: false;
}>;
type Box = Readonly<{ kind: "value"; value: unknown }>;
type Fn = (...args: never[]) => unknown;
type Context = ReturnType<typeof context>;
type Port = { random: Fn | null; receiver: object; subtle: object; importKey: Fn; operation: Fn; getters: Record<"type" | "extractable" | "algorithm" | "usages", Fn> };
const header = "curling-protected-installation-v1\nAES-256-GCM-V3ASCII\n";
const aad = "curling-protected-installation/v1\0AES-256-GCM\0v3-canonical-ascii\0archive-v3";
const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const maxCipher = TRANSFER_LIMITS.wire + 16;
const maxProtected = header.length + 17 + Math.ceil(maxCipher * 4 / 3);
const apply = Reflect.apply, descriptor = Object.getOwnPropertyDescriptor;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const Bytes = Uint8Array, fill = Uint8Array.prototype.fill, setBytes = Uint8Array.prototype.set;
const fromCharCode = String.fromCharCode;
const seal = <T extends object>(value: T): Readonly<T> => Object.freeze(Object.assign(Object.create(null), value));
const flags = { mayIssue: false as const, mayPublish: false as const, mayMount: false as const };

function context(whole: Promise<unknown>) {
  let code: Code = "protection_unavailable";
  const roots = new Set<unknown>();
  const watched = new Map<unknown, ReturnType<typeof observePlatformWork>>();
  const buffers: Uint8Array<ArrayBuffer>[] = [];
  const own = (value: unknown) => value === whole;
  function keep<T>(value: T): T {
    if (value !== null && (typeof value === "object" || typeof value === "function")) roots.add(value);
    return value;
  }
  function stop(next: Code = "protection_unavailable"): never { code = next; throw null; }
  function watch(value: unknown) {
    keep(value);
    let work = watched.get(value);
    if (!work) { work = observePlatformWork(value, own); watched.set(value, work); }
    return work;
  }
  async function value(input: unknown, rejected: Code = "protection_unavailable"): Promise<Box> {
    let observed: Awaited<ReturnType<typeof observePlatformWork>>;
    try { observed = await watch(input); } catch { return stop(rejected); }
    if (observed.kind !== "value") return stop();
    return observed;
  }
  async function sync(input: unknown): Promise<Box> {
    // Metadata/random returns must be synchronous values, never an asynchronously
    // supplied replacement. Box first so masked native settlement stays visible.
    const observed = await value(input);
    if (observed.value !== input) stop();
    return observed;
  }
  function field(target: object, name: string, getter = false): unknown {
    const found = descriptor(target, name);
    if (found) {
      if (Object.hasOwn(found, "value")) keep(found.value);
      if (Object.hasOwn(found, "get")) keep(found.get);
      if (Object.hasOwn(found, "set")) keep(found.set);
    }
    if (!found || !Object.hasOwn(found, getter ? "get" : "value")) stop();
    if (getter && (!Object.hasOwn(found, "set") || found.set !== undefined)) stop();
    return getter ? found.get : found.value;
  }
  function bytes(length: number): Uint8Array<ArrayBuffer> {
    return retainBytes(new Bytes(length));
  }
  function retainBytes(result: Uint8Array<ArrayBuffer>): Uint8Array<ArrayBuffer> {
    buffers.push(result); return result;
  }
  async function finish() {
    // A watched root owns its complete recursive chain, including late children;
    // never re-invoke its then getter/callback while draining a failure.
    await Promise.all([...roots].map(root => {
      const held = watched.get(root);
      return held ? held.then(() => {}, () => {}) : drainObservedPlatformWork(root, own);
    }));
    for (const buffer of buffers) {
      try { apply(fill, buffer, [0]); } catch { /* Detached provider inputs cannot be wiped; never expose a reason. */ }
    }
  }
  return { keep, stop, value, sync, field, bytes, retainBytes, finish, code: () => code };
}
function command<T extends object>(operation: (ctx: Context) => Promise<T>): Promise<Result<T>> {
  let finish!: (result: Result<T>) => void;
  const whole = new Promise<Result<T>>(resolve => { finish = resolve; });
  const ctx = context(whole);
  void (async () => {
    let result: Result<T>;
    try { result = seal({ ok: true as const, ...await operation(ctx), ...flags }); }
    catch { result = seal({ ok: false as const, code: ctx.code(), ...flags }); }
    await ctx.finish();
    finish(result);
  })();
  return whole;
}
function object(ctx: Context, value: unknown): object {
  if (value === null || typeof value !== "object") ctx.stop();
  return value as object;
}
function fn(ctx: Context, value: unknown): Fn {
  if (typeof value !== "function") ctx.stop();
  return value as Fn;
}
async function capture(ctx: Context, mode: "encrypt" | "decrypt"): Promise<Port> {
  const receiver = object(ctx, (await ctx.sync(ctx.keep(globalThis.crypto))).value);
  const subtle = object(ctx, (await ctx.sync(ctx.keep((receiver as { subtle?: unknown }).subtle))).value);
  const random = mode === "encrypt" ? fn(ctx, (await ctx.sync(ctx.keep((receiver as { getRandomValues?: unknown }).getRandomValues))).value) : null;
  const importKey = fn(ctx, (await ctx.sync(ctx.keep((subtle as { importKey?: unknown }).importKey))).value);
  const operation = fn(ctx, (await ctx.sync(ctx.keep((subtle as Record<string, unknown>)[mode]))).value);
  const constructor = fn(ctx, (await ctx.sync(ctx.keep(globalThis.CryptoKey))).value);
  const prototype = object(ctx, (await ctx.sync(ctx.field(constructor, "prototype"))).value);
  const getters = Object.create(null) as Port["getters"];
  for (const name of ["type", "extractable", "algorithm", "usages"] as const) getters[name] = fn(ctx, (await ctx.sync(ctx.field(prototype, name, true))).value);
  return seal({ receiver, subtle, random, importKey, operation, getters });
}
async function admitKey(ctx: Context, port: Port, key: unknown, usage: "encrypt" | "decrypt") {
  const read = async (name: keyof Port["getters"]) => ctx.sync(ctx.keep(apply(port.getters[name], key, [])));
  if ((await read("type")).value !== "secret") ctx.stop();
  if ((await read("extractable")).value !== false) ctx.stop();
  const algorithm = object(ctx, (await read("algorithm")).value);
  if ((await ctx.sync(ctx.field(algorithm, "name"))).value !== "AES-GCM") ctx.stop();
  if ((await ctx.sync(ctx.field(algorithm, "length"))).value !== 256) ctx.stop();
  const usages = (await read("usages")).value;
  if (!Array.isArray(usages)) ctx.stop();
  if ((await ctx.sync(ctx.field(usages as object, "length"))).value !== 1) ctx.stop();
  if ((await ctx.sync(ctx.field(usages as object, "0"))).value !== usage) ctx.stop();
}
function ascii(ctx: Context, text: string): Uint8Array<ArrayBuffer> {
  const bytes = ctx.bytes(text.length);
  for (let index = 0; index < text.length; index++) {
    const value = text.charCodeAt(index); if (value > 127) ctx.stop("archive_invalid"); bytes[index] = value;
  }
  return bytes;
}
function base64(bytes: Uint8Array): string {
  const chunks: string[] = []; let chunk = "";
  for (let index = 0; index < bytes.length; index += 3) {
    const a = bytes[index], b = bytes[index + 1] ?? 0, c = bytes[index + 2] ?? 0;
    chunk += alphabet[a >> 2] + alphabet[((a & 3) << 4) | (b >> 4)];
    if (index + 1 < bytes.length) chunk += alphabet[((b & 15) << 2) | (c >> 6)];
    if (index + 2 < bytes.length) chunk += alphabet[c & 63];
    if (chunk.length >= 8192) { chunks.push(chunk); chunk = ""; }
  }
  chunks.push(chunk); return chunks.join("");
}
function decode64(ctx: Context, input: string, maximum: number): Uint8Array<ArrayBuffer> {
  const length = Math.floor(input.length * 3 / 4);
  if (!input.length || input.length % 4 === 1 || length > maximum) ctx.stop("invalid_input");
  const output = ctx.bytes(length); let bits = 0, accumulator = 0, cursor = 0;
  for (let index = 0; index < input.length; index++) {
    const code = input.charCodeAt(index);
    const value = code >= 65 && code <= 90 ? code - 65 : code >= 97 && code <= 122 ? code - 71 : code >= 48 && code <= 57 ? code + 4 : code === 45 ? 62 : code === 95 ? 63 : -1;
    if (value < 0) ctx.stop("invalid_input");
    accumulator = (accumulator << 6) | value; bits += 6;
    if (bits >= 8) { bits -= 8; output[cursor++] = accumulator >> bits; accumulator &= (1 << bits) - 1; }
  }
  if (accumulator !== 0 || cursor !== length) ctx.stop("invalid_input");
  return output;
}
function copyOutput(ctx: Context, value: unknown, expected: number, plaintext = false): Uint8Array<ArrayBuffer> {
  // The native intrinsic rejects forged, typed/shared/detached buffers without
  // reading arbitrary length/constructor properties or trusting instanceof.
  if (apply(bufferLength, value, []) !== expected) ctx.stop();
  const native = new Bytes(value as ArrayBuffer);
  // The admitted decrypt result is also our operation-owned plaintext. Retain its
  // view before allocating the verification copy, and wipe both only at finish.
  if (plaintext) ctx.retainBytes(native);
  const result = ctx.bytes(expected); apply(setBytes, result, [native]); return result;
}
async function archive(ctx: Context, wire: string): Promise<string> {
  const decoded = await decodeInstallationTransferV3(wire);
  if (!decoded.ok) {
    if (["fingerprint_unavailable", "fingerprint_failed", "fingerprint_invalid"].includes(decoded.code)) return ctx.stop();
    return ctx.stop("archive_invalid");
  }
  return decoded.value.envelope.packageDigest as string;
}
function primitive(ctx: Context, value: unknown, maximum: number): string {
  if (typeof value !== "string" || value.length === 0 || value.length > maximum) ctx.stop("invalid_input");
  return value as string;
}

/** Sensitive private result: keep the recovery code separate from protectedWire. */
export function sealInstallationTransferV3(input: unknown) {
  return command(async ctx => {
    const wire = primitive(ctx, input, TRANSFER_LIMITS.wire), packageDigest = await archive(ctx, wire);
    const port = await capture(ctx, "encrypt"), keyBytes = ctx.bytes(32), nonce = ctx.bytes(12);
    for (const target of [keyBytes, nonce]) {
      const returned = ctx.keep(apply(port.random!, port.receiver, [target]));
      if ((await ctx.sync(returned)).value !== target) ctx.stop();
    }
    const key = (await ctx.value(ctx.keep(apply(port.importKey, port.subtle, ["raw", keyBytes, { name: "AES-GCM" }, false, ["encrypt"]])))).value;
    await admitKey(ctx, port, key, "encrypt");
    const plain = ascii(ctx, wire), additionalData = ascii(ctx, aad);
    const output = (await ctx.value(ctx.keep(apply(port.operation, port.subtle, [{ name: "AES-GCM", iv: nonce, additionalData, tagLength: 128 }, key, plain])))).value;
    const encrypted = copyOutput(ctx, output, plain.length + 16);
    return seal({ protectedWire: header + base64(nonce) + "\n" + base64(encrypted), recoveryCode: "ct1-" + base64(keyBytes), packageDigest });
  });
}

/** Authentication under this key does not establish source or Profile authority. */
export function openInstallationTransferV3(input: unknown, code: unknown) {
  return command(async ctx => {
    const protectedWire = primitive(ctx, input, maxProtected), recovery = primitive(ctx, code, 47);
    if (recovery.length !== 47 || !recovery.startsWith("ct1-") || !protectedWire.startsWith(header) || protectedWire[header.length + 16] !== "\n") ctx.stop("invalid_input");
    const nonce = decode64(ctx, protectedWire.slice(header.length, header.length + 16), 12);
    const ciphertext = decode64(ctx, protectedWire.slice(header.length + 17), maxCipher);
    const keyBytes = decode64(ctx, recovery.slice(4), 32);
    if (nonce.length !== 12 || keyBytes.length !== 32 || ciphertext.length <= 16) ctx.stop("invalid_input");
    const port = await capture(ctx, "decrypt");
    const key = (await ctx.value(ctx.keep(apply(port.importKey, port.subtle, ["raw", keyBytes, { name: "AES-GCM" }, false, ["decrypt"]])))).value;
    await admitKey(ctx, port, key, "decrypt");
    // A synchronous invocation error is a platform failure. Only observed issued
    // decrypt rejection gets the neutral "authentication not established" label.
    const returned = ctx.keep(apply(port.operation, port.subtle, [{ name: "AES-GCM", iv: nonce, additionalData: ascii(ctx, aad), tagLength: 128 }, key, ciphertext]));
    const output = (await ctx.value(returned, "authentication_failed")).value;
    const plain = copyOutput(ctx, output, ciphertext.length - 16, true), chunks: string[] = [];
    for (let index = 0; index < plain.length; index += 4096) {
      const numbers: number[] = [];
      for (let offset = index; offset < Math.min(index + 4096, plain.length); offset++) {
        if (plain[offset] > 127) ctx.stop("archive_invalid"); numbers.push(plain[offset]);
      }
      chunks.push(apply(fromCharCode, String, numbers));
    }
    const wire = chunks.join(""), packageDigest = await archive(ctx, wire);
    return seal({ wire, packageDigest });
  });
}
