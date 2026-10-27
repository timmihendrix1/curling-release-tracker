import { afterEach, expect, it, vi } from "vitest";
import { createHash, webcrypto } from "node:crypto";
import { encodeInstallationTransferV3 } from "../installationTransferV3";
import { sealInstallationTransferV3 } from "../installationTransferProtection";
import { admitSourceAwareTransferPreparation, admitTransferPreparation } from "../installationTransferAdmission";
import { evaluateTransferSourceDenial, resolveTransferSourceDenial, parseTransferSourceDenial, MAX_SOURCE_DENIAL_ASCII, MAX_SOURCE_DENIAL_JSON } from "../installationTransferSourceDenial";
import { encodeTransferCodeUnits, decodeTransferCodeUnits } from "../installationTransferCodeUnits";
import { TRANSFER_IDENTITY_KEYS, TRANSFER_LEGACY_KEY, TRANSFER_SPORTING_SUFFIXES, TRANSFER_PROFILE_PREFIX } from "../installationTransferInventory";
import { IDENTITY_BARRIER_STORAGE_KEY } from "../../identity/identityBarrier";
import { INTERACTIVE_ATTEMPT_STORAGE_KEY } from "../../identity/interactiveAttempt";
import { INTENT_CLEANUP_STORAGE_KEY } from "../../identity/pendingIntentRepository";
import { resolutionStorageKeyFor } from "../../identity/identityBarrierResolution";
import { createIdentityBarrierRepository } from "../../identity/identityBarrierRepository";
import { createInteractiveAttemptRepository } from "../../identity/interactiveAttemptRepository";
import { createIdentityBarrierResolutionRepository } from "../../identity/identityBarrierResolutionRepository";
import { createAccountDeletionGuardRepository, DELETION_GUARD_PREFIX, DELETION_GUARD_RESOLUTION_PREFIX } from "../../identity/accountDeletionGuard";
const id = (n: number) => n.toString(16).padStart(8, "0") + "-0000-4000-8000-000000000001";
const p = id(1), q = id(2), nonce = id(3), barrierId = id(4), attemptId = id(5);
const now = "2026-10-26T12:00:00.000Z";
const sporting = (profile = p) => `${TRANSFER_PROFILE_PREFIX}${profile}.${TRANSFER_SPORTING_SUFFIXES[7]}`;
const gk = (profile = p) => `${DELETION_GUARD_PREFIX}${profile}.v1`;
const rk = (n = nonce) => `${DELETION_GUARD_RESOLUTION_PREFIX}${n}.v1`;
const guard = (profile = p, n = nonce, revision = 4) => JSON.stringify({ schemaVersion: 1, profileId: profile, nonce: n, revision });
const receipt = (profile = p, n = nonce, fencedRevision = 5) => JSON.stringify({ schemaVersion: 1, profileId: profile, nonce: n, fencedRevision });
const barrier = () => ({ schemaVersion: 1, barrierId, origin: "explicit_sign_out", barredAccountScopeId: "source-account", barredGeneration: 7, establishedAt: now });
const attempt = () => ({ schemaVersion: 1, barrierId, attemptId, method: "email_otp", flowId: null, capturedIdentityGeneration: 8, startedAt: now });
const resolution = () => ({ schemaVersion: 1, barrierId, attemptId, method: "email_otp", flowId: null, identityGeneration: 8, authenticatedAccountScopeId: "source-account", resolvedAt: now });
const correlation = () => ({ [IDENTITY_BARRIER_STORAGE_KEY]: JSON.stringify(barrier()), [INTERACTIVE_ATTEMPT_STORAGE_KEY]: JSON.stringify(attempt()), [resolutionStorageKeyFor(barrierId)!]: JSON.stringify(resolution()) });
function snapshot(raws: Record<string, string>) {
  const profiles = [...new Set(Object.keys(raws).filter(k => k.startsWith(TRANSFER_PROFILE_PREFIX)).map(k => k.slice(TRANSFER_PROFILE_PREFIX.length, TRANSFER_PROFILE_PREFIX.length + 36)))];
  const names = [...new Set([...Object.keys(raws), ...TRANSFER_IDENTITY_KEYS, TRANSFER_LEGACY_KEY, ...profiles.flatMap(profile => TRANSFER_SPORTING_SUFFIXES.map(s => `${TRANSFER_PROFILE_PREFIX}${profile}.${s}`))])].sort();
  return { schemaVersion: 3, transferId: id(8), snapshotId: id(9), sourceBuild: { version: "synthetic", build: "test" }, catalogContractId: "synthetic", listing: { schemaVersion: 1, keys: Object.keys(raws).sort() }, observations: names.map(key => Object.hasOwn(raws, key) ? { key, state: "present", raw: raws[key] } : { key, state: "absent" }), sourceControl: { domain: "absent", credential: "excluded" }, snapshotState: "synthetic_frozen" };
}
async function archive(raws: Record<string, string> = {}) {
  vi.stubGlobal("crypto", webcrypto);
  const encoded = await encodeInstallationTransferV3(JSON.stringify(snapshot(raws)));
  if (!encoded.ok) throw Error("Synthetic V3 refused: " + encoded.code);
  return { wire: encoded.value.wire, digest: JSON.parse(encoded.value.wire).packageDigest as string };
}
async function projected(raws: Record<string, string> = {}) {
  const a = await archive(raws), handle = await evaluateTransferSourceDenial(a.wire, a.digest, () => true);
  expect(handle).not.toBeNull();
  const projection = resolveTransferSourceDenial(handle);
  expect(projection).not.toBeNull();
  return { ...a, handle, projection: projection! };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });
it("uses complete archive absence and exact standard tuple framing without granting identity", async () => {
  const { projection, digest } = await projected();
  expect(projection.facts).toEqual({ schemaVersion: 2, packageDigest: digest, sportingProfiles: [], preflight: { kind: "no_barrier" }, guards: [], intentCleanup: { kind: "absent" } });
  const json = '{"schemaVersion":2,"packageDigest":"' + digest + '","sportingProfiles":[],"preflight":{"kind":"no_barrier"},"guards":[],"intentCleanup":{"kind":"absent"}}';
  expect(decodeTransferCodeUnits(projection.ascii)).toBe(json);
  expect(projection.digest).toBe(createHash("sha256").update(JSON.stringify(["installation-source-denial/v2", digest, projection.ascii]), "utf8").digest("hex"));
  expect(parseTransferSourceDenial(projection.ascii, digest)).toEqual(projection.facts);
  expect(Object.isFrozen(projection)).toBe(true);
});
it.each(["active", "resolved", "wrong_nonce", "orphan"])("retains original guard evidence with %s receipt", async mode => {
  const raws: Record<string, string> = { [sporting()]: "true", [gk(q)]: guard(q) };
  if (mode === "resolved") raws[rk()] = receipt(q);
  if (mode === "wrong_nonce") raws[rk(id(10))] = receipt(q, id(10));
  if (mode === "orphan") { delete raws[gk(q)]; raws[rk()] = receipt(q); }
  const { projection } = await projected(raws);
  expect(projection.facts.sportingProfiles).toEqual([p]);
  expect(projection.facts.guards).toEqual(mode === "orphan" ? [] : [{ profileId: q, nonce, revision: 4, fencedRevision: mode === "resolved" ? 5 : null }]);
});
it("preserves multiple control-only Profiles including repeated nonces without namespace invention", async () => {
  const { projection } = await projected({ [gk(q)]: guard(q), [gk()]: guard() });
  expect(projection.facts.sportingProfiles).toEqual([]);
  expect(projection.facts.guards.map(g => g.profileId)).toEqual([p, q]);
  expect(projection.facts.guards.map(g => g.nonce)).toEqual([nonce, nonce]);
});
it.each(["barrier_only", "attempt_only", "mismatched_attempt", "mismatched_generation", "correlated"])("uses actual durable preflight for %s", async mode => {
  let raws: Record<string, string> = correlation();
  if (mode === "barrier_only") raws = { [IDENTITY_BARRIER_STORAGE_KEY]: raws[IDENTITY_BARRIER_STORAGE_KEY] };
  if (mode === "attempt_only") raws = { [INTERACTIVE_ATTEMPT_STORAGE_KEY]: raws[INTERACTIVE_ATTEMPT_STORAGE_KEY] };
  if (mode === "mismatched_attempt") raws[INTERACTIVE_ATTEMPT_STORAGE_KEY] = JSON.stringify({ ...attempt(), attemptId: id(11) });
  if (mode === "mismatched_generation") raws[resolutionStorageKeyFor(barrierId)!] = JSON.stringify({ ...resolution(), identityGeneration: 9 });
  const { projection } = await projected(raws), preflight = projection.facts.preflight;
  expect(preflight.kind).toBe(mode === "attempt_only" ? "no_barrier" : mode === "correlated" ? "correlated" : "quarantined");
  if (preflight.kind !== "no_barrier") expect(preflight.barrier).toEqual(barrier());
  if (preflight.kind === "correlated") expect(preflight.authenticatedAccountScopeId).toBe("source-account");
  expect(JSON.stringify(projection.facts)).not.toContain('"attemptId"');
});
it("uses all actual repositories only for loads against one private immutable snapshot", async () => {
  const barrierLoad = vi.spyOn(await import("../../identity/identityBarrierRepository"), "createIdentityBarrierRepository");
  const attemptLoad = vi.spyOn(await import("../../identity/interactiveAttemptRepository"), "createInteractiveAttemptRepository");
  const resolutionLoad = vi.spyOn(await import("../../identity/identityBarrierResolutionRepository"), "createIdentityBarrierResolutionRepository");
  const guardLoad = vi.spyOn(await import("../../identity/accountDeletionGuard"), "createAccountDeletionGuardRepository");
  await projected({ ...correlation(), [gk()]: guard(), [rk()]: receipt() });
  const adapters = [barrierLoad, attemptLoad, resolutionLoad, guardLoad].map(spy => spy.mock.calls[0][0]);
  expect(adapters.every(a => a === adapters[0])).toBe(true);
  expect(adapters[0]).toBeDefined();
  const a = adapters[0]!;
  expect(await a.get(gk())).toEqual({ status: "value", value: guard() });
  // This is a refusal even if a future load implementation mistakenly writes.
  expect(await a.set(gk(), "changed")).toMatchObject({ ok: false });
  expect(await a.get(gk())).toEqual({ status: "value", value: guard() });
});
it("does not execute archived trusted state, intent cleanup, or default browser storage", async () => {
  const a = await archive({ ...correlation(), [gk()]: guard() });
  const storage = vi.fn(() => { throw Error("default storage forbidden"); });
  vi.stubGlobal("localStorage", undefined); Object.defineProperty(globalThis, "localStorage", { configurable: true, get: storage });
  const handle = await evaluateTransferSourceDenial(a.wire, a.digest, () => true);
  expect(handle).not.toBeNull(); expect(storage).not.toHaveBeenCalled();
  const facts = resolveTransferSourceDenial(handle)!.facts;
  expect(Object.keys(facts)).toEqual(["schemaVersion", "packageDigest", "sportingProfiles", "preflight", "guards", "intentCleanup"]);
});
it("authenticates handle identity without touching proxies, wrappers or copies", async () => {
  const { handle, projection } = await projected();
  const touched = vi.fn(() => { throw null; }), proxy = new Proxy(handle!, { get: touched, ownKeys: touched, getPrototypeOf: touched });
  for (const value of [null, 1, "handle", { ...handle }, { handle }, projection, projection.facts, proxy]) expect(resolveTransferSourceDenial(value)).toBeNull();
  expect(touched).not.toHaveBeenCalled();
  expect(Object.isFrozen(handle)).toBe(true);
  expect(Object.keys(handle!)).toEqual([]);
  expect(Object.isFrozen(projection.facts.guards)).toBe(true);
});
it("reads actual outstanding cleanup as immutable negative evidence without settling its source", async () => {
  const raw = JSON.stringify({ schemaVersion: 1, recordedAt: now });
  const { projection, digest, wire } = await projected({ [INTENT_CLEANUP_STORAGE_KEY]: raw });
  expect(projection.facts.intentCleanup).toEqual({ kind: "outstanding", recordedAt: now });
  expect(Object.isFrozen(projection.facts.intentCleanup)).toBe(true);
  expect(parseTransferSourceDenial(projection.ascii, digest)).toEqual(projection.facts);
  expect(JSON.parse(wire).items.find((i: { key: string }) => i.key === INTENT_CLEANUP_STORAGE_KEY).raw).toBe(raw);
  expect(projection.digest).not.toBe(createHash("sha256").update(JSON.stringify(["installation-source-denial/v1", digest, projection.ascii]), "utf8").digest("hex"));
});
it.each(["absent", "outstanding", "malformed", "read_failed"])("uses the actual cleanup helper result %s rather than inferring absence", async mode => {
  const helper = await import("../../identity/untrustedValue"), actual = helper.readIdentityRecord;
  const seen: string[] = [];
  vi.spyOn(helper, "readIdentityRecord").mockImplementation(async (adapter, key, validate) => {
    seen.push(key);
    if (key !== INTENT_CLEANUP_STORAGE_KEY || mode === "absent" || mode === "outstanding") return actual(adapter, key, validate);
    return mode === "malformed" ? { status: "malformed" } : { status: "read_failed", error: { kind: "storage_unavailable" } };
  });
  const a = await archive(mode === "outstanding" ? { [INTENT_CLEANUP_STORAGE_KEY]: JSON.stringify({ schemaVersion: 1, recordedAt: now }) } : {});
  const handle = await evaluateTransferSourceDenial(a.wire, a.digest, () => true);
  expect(seen).toContain(INTENT_CLEANUP_STORAGE_KEY);
  if (mode === "malformed" || mode === "read_failed") expect(handle).toBeNull();
  else expect(resolveTransferSourceDenial(handle)?.facts.intentCleanup.kind).toBe(mode);
});
it("refuses currentness loss during the actual cleanup read", async () => {
  const helper = await import("../../identity/untrustedValue"), actual = helper.readIdentityRecord;
  let live = true;
  vi.spyOn(helper, "readIdentityRecord").mockImplementation(async (adapter, key, validate) => {
    const result = await actual(adapter, key, validate);
    if (key === INTENT_CLEANUP_STORAGE_KEY) live = false;
    return result;
  });
  const a = await archive();
  expect(await evaluateTransferSourceDenial(a.wire, a.digest, () => live)).toBeNull();
});
it.each(["legacy", "legacy_missing", "missing", "null", "unknown", "extra", "absent_date", "missing_date", "invalid_date", "reversed"])("refuses incomplete or noncanonical cleanup metadata %s", async mode => {
  const { projection, digest } = await projected({ [INTENT_CLEANUP_STORAGE_KEY]: JSON.stringify({ schemaVersion: 1, recordedAt: now }) });
  const data = JSON.parse(decodeTransferCodeUnits(projection.ascii));
  if (mode === "legacy" || mode === "legacy_missing") data.schemaVersion = 1;
  if (mode === "missing" || mode === "legacy_missing") delete data.intentCleanup;
  if (mode === "null") data.intentCleanup = null;
  if (mode === "unknown") data.intentCleanup.kind = "resolved";
  if (mode === "extra") data.intentCleanup.extra = true;
  if (mode === "absent_date") data.intentCleanup.kind = "absent";
  if (mode === "missing_date") delete data.intentCleanup.recordedAt;
  if (mode === "invalid_date") data.intentCleanup.recordedAt = "invalid";
  if (mode === "reversed") data.intentCleanup = { recordedAt: now, kind: "outstanding" };
  expect(parseTransferSourceDenial(encodeTransferCodeUnits(JSON.stringify(data)), digest)).toBeNull();
});
it.each(["invalid_date", "wrong_version", "missing_date"])("actual V3 refuses malformed cleanup %s before projection", async mode => {
  vi.stubGlobal("crypto", webcrypto);
  const record: Record<string, unknown> = { schemaVersion: 1, recordedAt: now };
  if (mode === "invalid_date") record.recordedAt = "invalid";
  if (mode === "wrong_version") record.schemaVersion = 2;
  if (mode === "missing_date") delete record.recordedAt;
  expect((await encodeInstallationTransferV3(JSON.stringify(snapshot({ [INTENT_CLEANUP_STORAGE_KEY]: JSON.stringify(record) })))).ok).toBe(false);
});
it.each(["wrong_package", "training_only", "truncated_inventory", "malformed", "boxed"])("refuses %s as complete source evidence", async mode => {
  const a = await archive({ [gk()]: guard() });
  const wire: unknown = mode === "training_only" ? JSON.stringify({ schemaVersion: 1, training: [] }) : mode === "truncated_inventory" ? a.wire.slice(0, -10) : mode === "malformed" ? "{" : mode === "boxed" ? new String(a.wire) : a.wire;
  expect(await evaluateTransferSourceDenial(wire, mode === "wrong_package" ? "a".repeat(64) : a.digest, () => true)).toBeNull();
});
it.each([0, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14])("never mints after ownership loss at checkpoint %s", async boundary => {
  const a = await archive({ ...correlation(), [gk()]: guard(), [rk()]: receipt() });
  let n = 0;
  expect(await evaluateTransferSourceDenial(a.wire, a.digest, () => n++ < boundary)).toBeNull();
});
it("rejects a mutation attempted by an actual load, with no source mutation", async () => {
  const repositoryModule = await import("../../identity/identityBarrierRepository"), actual = createIdentityBarrierRepository;
  vi.spyOn(repositoryModule, "createIdentityBarrierRepository").mockImplementation(adapter => {
    const repo = actual(adapter); return { ...repo, async load() { await adapter!.set(IDENTITY_BARRIER_STORAGE_KEY, "bad"); return repo.load(); } };
  });
  const a = await archive();
  expect(await evaluateTransferSourceDenial(a.wire, a.digest, () => true)).toBeNull();
});
it.each(["barrier", "attempt", "resolution", "guard"])("refuses unavailable actual %s loads rather than manufacturing absence", async family => {
  if (family === "barrier") { const m = await import("../../identity/identityBarrierRepository"), actual = createIdentityBarrierRepository; vi.spyOn(m, "createIdentityBarrierRepository").mockImplementation(a => ({ ...actual(a), load: async () => ({ status: "read_failed", error: { kind: "storage_unavailable" } }) })); }
  if (family === "attempt") { const m = await import("../../identity/interactiveAttemptRepository"), actual = createInteractiveAttemptRepository; vi.spyOn(m, "createInteractiveAttemptRepository").mockImplementation(a => ({ ...actual(a), load: async () => ({ status: "malformed" }) })); }
  if (family === "resolution") { const m = await import("../../identity/identityBarrierResolutionRepository"), actual = createIdentityBarrierResolutionRepository; vi.spyOn(m, "createIdentityBarrierResolutionRepository").mockImplementation(a => ({ ...actual(a), loadForBarrier: async () => ({ status: "malformed" }) })); }
  if (family === "guard") { const m = await import("../../identity/accountDeletionGuard"), actual = createAccountDeletionGuardRepository; vi.spyOn(m, "createAccountDeletionGuardRepository").mockImplementation(a => ({ ...actual(a), load: async () => ({ status: "unavailable" }) })); }
  const a = await archive({ ...correlation(), [gk()]: guard() });
  expect(await evaluateTransferSourceDenial(a.wire, a.digest, () => true)).toBeNull();
});
it("separate source-aware admission preserves the original exact admission shape", async () => {
  const a = await archive({ [sporting()]: "true", [gk(q)]: guard(q) });
  const sealed = await sealInstallationTransferV3(a.wire); if (!sealed.ok) throw Error("synthetic protection refused");
  const old = await admitTransferPreparation(sealed.protectedWire, sealed.recoveryCode, () => true);
  const next = await admitSourceAwareTransferPreparation(sealed.protectedWire, sealed.recoveryCode, () => true);
  expect(old.ok && next.ok).toBe(true); if (!old.ok || !next.ok) return;
  expect(Object.keys(old)).toEqual(["ok", "wire", "digest", "rows", "recoveryRequired"]);
  const { sourceDenial, ...original } = next; expect(original).toEqual(old);
  expect(resolveTransferSourceDenial(sourceDenial)?.facts.guards[0].profileId).toBe(q);
  expect(JSON.stringify(next)).not.toContain("openedWire");
  expect(await admitSourceAwareTransferPreparation(sealed.protectedWire, "ct1-" + "a".repeat(43), () => true)).toEqual({ ok: false, code: "archive_refused" });
});
it.each(["duplicate", "whitespace", "order", "unknown", "revision", "negative_zero", "scope", "profile_order", "guard_order", "wrong_digest", "extra_barrier"])("cold structural parser rejects noncanonical %s metadata", async mode => {
  const { projection, digest } = await projected({ ...correlation(), [gk()]: guard(), [gk(q)]: guard(q) });
  let json = decodeTransferCodeUnits(projection.ascii);
  const data = JSON.parse(json);
  if (mode === "duplicate") json = json.replace('"schemaVersion":2', '"schemaVersion":2,"schemaVersion":2');
  if (mode === "whitespace") json += " ";
  if (mode === "order") { const { schemaVersion, ...rest } = data; json = JSON.stringify({ ...rest, schemaVersion }); }
  if (mode === "unknown") { data.extra = false; json = JSON.stringify(data); }
  if (mode === "revision") { data.guards[0].fencedRevision = 4; json = JSON.stringify(data); }
  if (mode === "negative_zero") json = json.replace('"revision":4', '"revision":-0');
  if (mode === "scope") { data.preflight.authenticatedAccountScopeId = ""; json = JSON.stringify(data); }
  if (mode === "profile_order") { data.sportingProfiles = [q, p]; json = JSON.stringify(data); }
  if (mode === "guard_order") { data.guards.reverse(); json = JSON.stringify(data); }
  if (mode === "extra_barrier") { data.preflight.barrier.extra = 1; json = JSON.stringify(data); }
  expect(parseTransferSourceDenial(encodeTransferCodeUnits(json), mode === "wrong_digest" ? "a".repeat(64) : digest)).toBeNull();
});
it("rejects hostile/overlimit cold input before parsing or coercing", () => {
  const touched = vi.fn(() => { throw null; });
  const input = new Proxy({}, { get: touched, ownKeys: touched });
  const parse = vi.spyOn(JSON, "parse");
  for (const value of [input, new String("u16:"), "u16:" + "0".repeat(MAX_SOURCE_DENIAL_ASCII), "u16:zzzz"]) expect(parseTransferSourceDenial(value, "a".repeat(64))).toBeNull();
  expect(parse).not.toHaveBeenCalled(); expect(touched).not.toHaveBeenCalled();
});
it("supports every 32 sporting Profiles and 512 guard controls beyond the 64KiB decision quota", async () => {
  // Each source identity raw is <=65536 code units. Both admitted timestamps
  // can therefore expand by at most 6*65536 in tuple quoting; all 512 guards
  // fit 512*256, Profiles 2048, both scopes 2*6*256 and framing <2048.
  // Conservative combined bound 924672 remains below the 1MiB JSON quota.
  expect(2 * 6 * 65536 + 512 * 256 + 2048 + 2 * 6 * 256 + 2048).toBeLessThan(MAX_SOURCE_DENIAL_JSON);
  const paddedDate = " ".repeat(65000) + "Mon, 26 Oct 2026 12:00:00 GMT";
  const raws: Record<string, string> = { [IDENTITY_BARRIER_STORAGE_KEY]: JSON.stringify({ ...barrier(), establishedAt: paddedDate }), [INTENT_CLEANUP_STORAGE_KEY]: JSON.stringify({ schemaVersion: 1, recordedAt: paddedDate }) };
  for (let i = 0; i < 32; i++) raws[sporting(id(i + 100))] = "true";
  for (let i = 0; i < 512; i++) raws[gk(id(i + 1000))] = guard(id(i + 1000));
  const { projection, digest } = await projected(raws);
  expect(projection.facts.sportingProfiles).toHaveLength(32); expect(projection.facts.guards).toHaveLength(512);
  expect(projection.facts.intentCleanup).toEqual({ kind: "outstanding", recordedAt: paddedDate });
  expect(decodeTransferCodeUnits(projection.ascii).length).toBeGreaterThan(65536);
  expect(decodeTransferCodeUnits(projection.ascii).length).toBeLessThan(MAX_SOURCE_DENIAL_JSON);
  expect(parseTransferSourceDenial(projection.ascii, digest)).toEqual(projection.facts);
});
it("refuses broken actual crypto without an injected fallback and joins outstanding work", async () => {
  const a = await archive();
  vi.stubGlobal("crypto", undefined);
  expect(await evaluateTransferSourceDenial(a.wire, a.digest, () => true)).toBeNull();
  let release!: (v: unknown) => void; const pending = new Promise(resolve => { release = resolve; });
  Object.defineProperty(pending, "then", { value: null });
  vi.stubGlobal("crypto", pending);
  let done = false; const op = evaluateTransferSourceDenial(a.wire, a.digest, () => true).then(value => { done = true; return value; });
  await new Promise(r => setTimeout(r, 10)); expect(done).toBe(false);
  release(undefined); expect(await op).toBeNull();
});
it("preserves exact opaque Unicode scope code units without inherited JSON hooks", async () => {
  const scope = 'é"\\\ud800🥌';
  const a = await archive({ ...correlation(), [resolutionStorageKeyFor(barrierId)!]: JSON.stringify({ ...resolution(), authenticatedAccountScopeId: scope }) });
  const prototypes = [Object.prototype, Array.prototype], saved = prototypes.map(p => Object.getOwnPropertyDescriptor(p, "toJSON"));
  const hook = vi.fn(() => { throw null; });
  let handle: object | null = null;
  try {
    for (const prototype of prototypes) Object.defineProperty(prototype, "toJSON", { configurable: true, value: hook });
    handle = await evaluateTransferSourceDenial(a.wire, a.digest, () => true);
  } finally {
    prototypes.forEach((p, i) => { if (saved[i]) Object.defineProperty(p, "toJSON", saved[i]!); else Reflect.deleteProperty(p, "toJSON"); });
  }
  expect(hook).not.toHaveBeenCalled();
  const projection = resolveTransferSourceDenial(handle)!;
  expect(projection.facts.preflight).toMatchObject({ kind: "correlated", authenticatedAccountScopeId: scope });
  expect(parseTransferSourceDenial(projection.ascii, a.digest)).toEqual(projection.facts);
});
it.each(["wrong_profile", "same_revision", "older_revision"])("real V3 refuses %s exact-nonce receipts before any projection", async mode => {
  vi.stubGlobal("crypto", webcrypto);
  const raw = receipt(mode === "wrong_profile" ? q : p, nonce, mode === "same_revision" ? 4 : mode === "older_revision" ? 3 : 5);
  expect((await encodeInstallationTransferV3(JSON.stringify(snapshot({ [gk()]: guard(), [rk()]: raw })))).ok).toBe(false);
});
it("joins malformed final projection-hash work and rejects late ownership loss", async () => {
  const a = await archive();
  let release!: (value: unknown) => void;
  const pending = new Promise(resolve => { release = resolve; });
  Object.defineProperty(pending, "then", { value: null });
  let calls = 0;
  vi.stubGlobal("crypto", { subtle: { digest(_algorithm: string, bytes: Uint8Array) { return ++calls === 1 ? webcrypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>) : pending; } } });
  let done = false;
  const op = evaluateTransferSourceDenial(a.wire, a.digest, () => true).then(value => { done = true; return value; });
  await new Promise(r => setTimeout(r, 10)); expect(calls).toBe(2); expect(done).toBe(false);
  release(new ArrayBuffer(31)); expect(await op).toBeNull();
  calls = 0; let live = true;
  vi.stubGlobal("crypto", { subtle: { digest(_algorithm: string, bytes: Uint8Array) { if (++calls === 2) live = false; return webcrypto.subtle.digest("SHA-256", bytes as Uint8Array<ArrayBuffer>); } } });
  expect(await evaluateTransferSourceDenial(a.wire, a.digest, () => live)).toBeNull();
});
