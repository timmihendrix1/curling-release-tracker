// Internal standard-platform primitive. No stores, SDK, environment or app caller.
type Box = Readonly<{ value: unknown }>;
type AlreadyOwned = (value: unknown) => boolean;
type Sha256 = Readonly<{ hash(preimage: string): Promise<string> }>;
type Capture = Readonly<{ ok: true; value: Sha256 } | { ok: false }>;
const apply = Reflect.apply, then = Promise.prototype.then;
const bufferLength = Object.getOwnPropertyDescriptor(ArrayBuffer.prototype, "byteLength")!.get!;
const typedArrayTag = Object.getOwnPropertyDescriptor(Object.getPrototypeOf(Uint8Array.prototype), Symbol.toStringTag)!.get!;
const failures = new WeakMap<object, Promise<void>>();
const primitiveStringify = JSON.stringify;
const box = (value: unknown): Box => Object.freeze(Object.assign(Object.create(null), { value }));

/** Exact JSON array bytes for owned primitive strings, without any toJSON hook. */
export function serializePlatformStringTuple(...values: readonly string[]): string {
  for (let index = 0; index < values.length; index++) if (typeof values[index] !== "string") throw new Error("Platform tuple unavailable");
  let output = "[";
  for (let index = 0; index < values.length; index++) {
    const value = values[index];
    const encoded = primitiveStringify(value);
    if (typeof encoded !== "string") throw new Error("Platform tuple unavailable");
    if (index > 0) output += ",";
    output += encoded;
  }
  return output + "]";
}

// Resolving with a raw masked native Promise would hide its internal state.
// Forward only owned boxes; intrinsically follow actual native fulfillment values.
function nativeObservation(value: unknown, seen: Set<unknown>, alreadyOwned?: AlreadyOwned, invalid?: () => void): Promise<Box> | null {
  if (seen.has(value)) { invalid?.(); return Promise.reject(new Error("Cyclic platform result")); }
  let resolve!: (value: Box) => void, reject!: (reason?: unknown) => void;
  const result = new Promise<Box>((yes, no) => { resolve = yes; reject = no; });
  try {
    apply(then, value, [
      (fulfilled: unknown) => {
        try { void observe(fulfilled, seen, alreadyOwned, invalid).then(resolve, reject); } catch { invalid?.(); reject(); }
      }, (reason: unknown) => { invalid?.(); reject(reason); },
    ]);
  } catch { return null; } // not a native Promise; poisoned species remains C4
  seen.add(value);
  return result;
}
function observe(value: unknown, seen = new Set<unknown>(), alreadyOwned?: AlreadyOwned, invalid?: () => void): Promise<Box> {
  // Completion-only callers can exclude exact work their owner already drains.
  // Check every encountered value before native probing or property reflection.
  if (alreadyOwned?.(value)) return Promise.resolve(box(undefined));
  const native = nativeObservation(value, seen, alreadyOwned, invalid);
  if (native) return native;
  return new Promise((resolve, reject) => {
    try {
      if ((typeof value !== "object" || value === null) && typeof value !== "function") { resolve(box(value)); return; }
      seen.add(value);
      const method: unknown = (value as { then?: unknown }).then;
      if (typeof method !== "function") {
        if (typeof method === "object" && method !== null) {
          // A directly observed malformed async field shares this exact chain;
          // neither native nor conforming thenable work can hide behind it.
          invalid?.();
          void completion(observe(method, seen, alreadyOwned, invalid)).then(() => { reject(); }); return;
        }
        resolve(box(value)); return;
      }
      let settled = false;
      // As with ordinary Promise assimilation, invoke a foreign then in a job.
      void Promise.resolve().then(() => {
        try {
          apply(method, value, [(fulfilled: unknown) => {
            if (settled) return;
            settled = true;
            try { void observe(fulfilled, seen, alreadyOwned, invalid).then(resolve, reject); } catch { invalid?.(); reject(); }
          }, (reason: unknown) => { if (!settled) { settled = true; invalid?.(); reject(reason); } }]);
        } catch { if (!settled) { settled = true; invalid?.(); reject(); } }
      });
    } catch { invalid?.(); reject(); }
  });
}
const completion = (work: Promise<unknown>): Promise<void> => work.then(() => {}, () => {});
/** Drain only: no fulfilled value, hash binding or resource authority escapes. */
export function drainObservedPlatformWork(value: unknown, alreadyOwned?: AlreadyOwned): Promise<void> {
  return completion(observe(value, new Set(), alreadyOwned));
}

/** Private native-source value observation. Excluded owned work is NEVER a value. */
export function observePlatformWork(value: unknown, alreadyOwned: AlreadyOwned, invalid?: () => void): Promise<
  Readonly<{ kind: "value"; value: unknown } | { kind: "excluded" }>
> {
  let excluded = false;
  const exclusion = (candidate: unknown) => {
    if (!alreadyOwned(candidate)) return false;
    excluded = true; return true;
  };
  const skipped = () => Object.freeze(Object.assign(Object.create(null), { kind: "excluded" as const }));
  return observe(value, new Set(), exclusion, invalid).then(result => excluded ? skipped()
    : Object.freeze(Object.assign(Object.create(null), { kind: "value" as const, value: result.value })),
  () => { if (excluded) return skipped(); throw new Error("Platform observation unavailable"); });
}

/** Associate only actual internal failure work; copied/wrapped results have none.
 * This bookkeeping conveys no storage, identity, hash or admission authority. */
export function inheritPlatformSha256Failure<T extends object>(source: object, target: T): T {
  const drain = failures.get(source);
  if (drain && !failures.has(target)) failures.set(target, drain);
  return target;
}
export async function settlePlatformSha256Preparation(result: object): Promise<void> {
  const drain = failures.get(result);
  if (drain) await drain;
}

export function capturePlatformSha256(digestOverride?: unknown): Capture {
  let revoked = false;
  const observed = new Set<unknown>(), retained = new Map<unknown, Promise<void>>();
  function remember(value: unknown): unknown {
    if (revoked) throw null;
    observed.add(value);
    const native = nativeObservation(value, new Set());
    if (native) {
      revoked = true;
      retained.set(value, completion(native));
      throw null;
    }
    return value;
  }
  function object(value: unknown): object {
    remember(value);
    if (!value || typeof value !== "object") { revoked = true; throw null; }
    return value;
  }
  function fn(value: unknown): (...args: never[]) => unknown {
    remember(value);
    if (typeof value !== "function") { revoked = true; throw null; }
    return value as (...args: never[]) => unknown;
  }
  try {
    const Constructor = fn(globalThis.TextEncoder) as unknown as typeof TextEncoder;
    const encoder = object(new Constructor()) as TextEncoder;
    const encode = fn(encoder.encode);
    let digest: (bytes: unknown) => unknown;
    if (digestOverride === undefined) {
      const crypto = object(globalThis.crypto) as Crypto;
      const subtle = object(crypto.subtle) as SubtleCrypto;
      const operation = fn(subtle.digest);
      digest = bytes => apply(operation, subtle, ["SHA-256", bytes]);
    } else {
      // Preserve the existing override's no-arbitrary-property-inspection rule.
      // A real native Promise can still be intrinsically observed without traps.
      if (typeof digestOverride !== "function") {
        revoked = true;
        const native = nativeObservation(digestOverride, new Set());
        if (native) retained.set(digestOverride, completion(native));
        throw null;
      }
      const operation = digestOverride;
      digest = bytes => operation("SHA-256", bytes);
    }
    const hash = async (preimage: string): Promise<string> => {
      try {
        if (typeof preimage !== "string") throw null;
        const bytes: unknown = apply(encode, encoder, [preimage]);
        let validBytes = false;
        try { validBytes = apply(typedArrayTag, bytes, []) === "Uint8Array"; } catch { /* invalid return */ }
        if (!validBytes) { await completion(observe(bytes)); throw null; }
        const { value: output } = await observe(digest(bytes));
        if (apply(bufferLength, output, []) !== 32) throw null;
        const hex = Array.from(new Uint8Array(output as ArrayBuffer), byte => byte.toString(16).padStart(2, "0")).join("");
        if (!/^[0-9a-f]{64}$/.test(hex)) throw null;
        return hex;
      } catch { throw new Error("Platform fingerprint unavailable"); }
    };
    return Object.freeze({ ok: true, value: Object.freeze({ hash }) });
  } catch {
    revoked = true; // before any malformed async/thenable assimilation
    for (const value of observed) if (!retained.has(value)) retained.set(value, completion(observe(value)));
    const result = Object.freeze({ ok: false as const });
    failures.set(result, Promise.all([...retained.values()]).then(() => {}));
    return result;
  }
}

/** Closed publication-only standard string entry. Exclusion is refusal, not a
 * digest. Default string/byte captures deliberately keep their existing policy. */
export function captureOwnedPlatformSha256(alreadyOwned: AlreadyOwned, current: () => boolean): Capture {
  let revoked = false;
  const hashes = new WeakSet<object>(), observed = new Set<unknown>();
  const retained = new Map<unknown, Promise<void>>();
  const owns = (value: unknown) => {
    const excluded = value !== null && (typeof value === "object" || typeof value === "function") && hashes.has(value) || alreadyOwned(value);
    if (excluded) revoked = true;
    return excluded;
  };
  function retain(value: unknown, work = retained): void {
    if (!owns(value) && !work.has(value)) work.set(value, drainObservedPlatformWork(value, owns));
  }
  function check(work = retained): void {
    if (revoked) throw null;
    const allowed: unknown = current();
    if (allowed !== true) { revoked = true; if (allowed !== false) retain(allowed, work); throw null; }
  }
  function capture(value: unknown): unknown {
    if (owns(value)) throw null;
    observed.add(value);
    check();
    const native = nativeObservation(value, new Set(), owns, () => { revoked = true; });
    if (native) { revoked = true; retained.set(value, completion(native)); throw null; }
    check();
    if (value !== null && (typeof value === "object" || typeof value === "function")) {
      let method: unknown;
      try { method = (value as { then?: unknown }).then; }
      catch { retained.set(value, Promise.resolve()); throw null; }
      if (owns(method)) { retained.set(value, Promise.resolve()); throw null; }
      if (method !== undefined) {
        revoked = true;
        if (typeof method === "function") {
          const bridge = Object.assign(Object.create(null), { then(resolve: (v: unknown) => void, reject: (v?: unknown) => void) { apply(method, value, [resolve, reject]); } });
          retained.set(value, completion(observe(bridge, new Set([value]), owns)));
        } else { retain(method); retained.set(value, Promise.resolve()); }
        throw null;
      }
    }
    retained.set(value, Promise.resolve());
    check(); return value;
  }
  function object(value: unknown): object {
    capture(value); if (value === null || typeof value !== "object") throw null; return value;
  }
  function fn(value: unknown): (...args: never[]) => unknown {
    capture(value); if (typeof value !== "function") throw null; return value as (...args: never[]) => unknown;
  }
  try {
    check(); const Constructor = fn(globalThis.TextEncoder) as unknown as typeof TextEncoder;
    check(); const encoder = object(new Constructor()) as TextEncoder;
    check(); const encode = fn(encoder.encode);
    check(); const crypto = object(globalThis.crypto) as Crypto;
    check(); const subtle = object(crypto.subtle) as SubtleCrypto;
    check(); const digest = fn(subtle.digest);
    const hash = (preimage: string): Promise<string> => {
      // Register before any encoder/crypto callback can return this completion.
      const result = Promise.resolve().then(async () => {
        const pending = new Map<unknown, Promise<void>>();
        try {
          check(pending); if (typeof preimage !== "string") throw null;
          const bytes: unknown = apply(encode, encoder, [preimage]);
          if (owns(bytes)) throw null;
          let valid = false;
          try { valid = apply(typedArrayTag, bytes, []) === "Uint8Array"; } catch { /* Refuse; drain the original acquired value. */ }
          if (!valid) { revoked = true; retain(bytes, pending); throw null; }
          check(pending);
          const raw: unknown = apply(digest, subtle, ["SHA-256", bytes]);
          // Even after reentrant currentness loss, the original issued work must
          // settle. It cannot become a digest or a later construction input.
          let live = false;
          try { check(pending); live = true; } catch { /* Join issued work below. */ }
          const output = await observePlatformWork(raw, owns, () => { revoked = true; });
          if (!live || output.kind !== "value") throw null;
          check(pending);
          if (apply(bufferLength, output.value, []) !== 32) throw null;
          const hex = Array.from(new Uint8Array(output.value as ArrayBuffer), b => b.toString(16).padStart(2, "0")).join("");
          check(pending); return hex;
        } catch {
          await Promise.all([...pending.values()]);
          throw new Error("Owned platform fingerprint unavailable");
        }
      });
      hashes.add(result); return result;
    };
    return Object.freeze({ ok: true, value: Object.freeze({ hash }) });
  } catch {
    revoked = true;
    for (const value of observed) if (!retained.has(value)) retain(value);
    const result = Object.freeze({ ok: false as const });
    failures.set(result, Promise.all([...retained.values()]).then(() => {}));
    return result;
  }
}

// Separate byte entry for the private V3 archive wrapper. String callers above
// retain their original capture/encoding behavior and public shapes.
const ByteArray = Uint8Array;
const bytePrototype = Object.getPrototypeOf(ByteArray.prototype);
const byteBuffer = Object.getOwnPropertyDescriptor(bytePrototype, "buffer")!.get!;
const byteOffset = Object.getOwnPropertyDescriptor(bytePrototype, "byteOffset")!.get!;
const byteLength = Object.getOwnPropertyDescriptor(bytePrototype, "byteLength")!.get!;
const byteSet = ByteArray.prototype.set;
const MAX_BYTE_PREIMAGE = 16_777_216;
export function capturePlatformByteSha256(): Readonly<
  { ok: true; value: Readonly<{ hashBytes(preimage: Uint8Array): Promise<string> }> } | { ok: false }
> {
  let revoked = false;
  const observed = new Set<unknown>(), retained = new Map<unknown, Promise<void>>();
  function remember(value: unknown): unknown {
    if (revoked) throw null;
    observed.add(value);
    const native = nativeObservation(value, new Set());
    if (native) { revoked = true; retained.set(value, completion(native)); throw null; }
    if ((typeof value === "object" && value !== null) || typeof value === "function") {
      let method: unknown;
      try { method = (value as { then?: unknown }).then; }
      catch { revoked = true; retained.set(value, Promise.resolve()); throw null; }
      if (method !== undefined) {
        revoked = true; observed.add(method);
        if (typeof method === "function") {
          // Own the single captured then method/receiver, never reread its getter.
          const bridge = Object.assign(Object.create(null), { then(resolve: (value: unknown) => void, reject: (reason?: unknown) => void) {
            apply(method, value, [resolve, reject]);
          } });
          retained.set(value, completion(observe(bridge, new Set([value]))));
        } else {
          const drain = completion(observe(method));
          retained.set(value, drain); retained.set(method, drain);
        }
        throw null;
      }
      // The directly observed synchronous value has no async continuation.
      retained.set(value, Promise.resolve());
    }
    return value;
  }
  function object(value: unknown): object {
    remember(value);
    if (value === null || typeof value !== "object") { revoked = true; throw null; }
    return value;
  }
  try {
    const crypto = object(globalThis.crypto) as Crypto;
    const subtle = object(crypto.subtle) as SubtleCrypto;
    const operation = remember(subtle.digest);
    if (typeof operation !== "function") { revoked = true; throw null; }
    const hashBytes = async (preimage: Uint8Array): Promise<string> => {
      try {
        if (apply(typedArrayTag, preimage, []) !== "Uint8Array") throw null;
        const size = apply(byteLength, preimage, []);
        if (size > MAX_BYTE_PREIMAGE) throw null;
        const sourceBuffer = apply(byteBuffer, preimage, []);
        apply(bufferLength, sourceBuffer, []); // Refuse shared/non-ArrayBuffer inputs.
        const source = new ByteArray(sourceBuffer, apply(byteOffset, preimage, []), size);
        const copy = new ByteArray(size);
        apply(byteSet, copy, [source]); // No caller iterator/coercion/species hook.
        const { value: output } = await observe(apply(operation, subtle, ["SHA-256", copy]));
        if (apply(bufferLength, output, []) !== 32) throw null;
        const bytes = new ByteArray(output as ArrayBuffer), digits = "0123456789abcdef";
        let hex = "";
        for (let index = 0; index < 32; index++) hex += digits[bytes[index] >>> 4] + digits[bytes[index] & 15];
        return hex;
      } catch { throw new Error("Platform byte fingerprint unavailable"); }
    };
    return Object.freeze({ ok: true, value: Object.freeze({ hashBytes }) });
  } catch {
    revoked = true;
    for (const value of observed) if (!retained.has(value)) retained.set(value, completion(observe(value)));
    const result = Object.freeze({ ok: false as const });
    failures.set(result, Promise.all([...retained.values()]).then(() => {}));
    return result;
  }
}
