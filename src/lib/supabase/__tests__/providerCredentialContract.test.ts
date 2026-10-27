import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { storePKCEVerifier, removePKCEVerifier, removeAllPKCEVerifiers } from "@supabase/auth-js/dist/main/lib/helpers";
import { chargeCredentialUnits, classifyCredentialKey, contractResult, fixedCredentialSlots, parseBoundedJson, refuse, snapshotJson, unwrap, validateQuiescentCredentialSnapshot, validateRuntimeCredentialValue } from "../providerCredentialContract";
import { providerSessionStorageKey } from "../providerCredentialStorage";
import { parseI, serializeI } from "../../persistence/credentialProtocol";

const root = "sb-fixture-auth-token";
const user = { id: "fixture-provider-user", aud: "authenticated", created_at: "synthetic-date", app_metadata: {}, user_metadata: {} };
const session = { access_token: "SYNTHETIC_ACCESS", refresh_token: "SYNTHETIC_REFRESH", expires_at: 100, expires_in: 0.125, token_type: "bearer" };
const verifier = "a".repeat(112), legacy = root + "-code-verifier", index = root + "-flows-code-verifier";
const slot = (flow: string) => root + "-flow-" + flow + "-code-verifier";
function value(key: string, data: unknown) { return validateRuntimeCredentialValue(root, key, JSON.stringify(data)); }
function listing(present: Record<string, string> = {}) {
  const keys = Object.keys(present);
  return { listedKeys: keys, reads: [...new Set([...keys, ...fixedCredentialSlots(root).map(s => s.key)])].map(key => ({ key, result: Object.hasOwn(present, key) ? { status: "value", value: present[key] } : { status: "absent" } })), enumerationComplete: true };
}
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("review regressions: refusal/reflection/lexical boundaries", () => {
  const hostile = { ok: false, issue: { code: "hostile_input", field: "input" } };
  it.each(["mutate", "getter", "proxy"])("contains a captured refusal replay (%s)", mode => {
    let captured: unknown;
    try { parseBoundedJson("{"); } catch (error) { captured = error; }
    if (mode === "mutate") { try { Object.assign(captured as object, { code: "PRIVATE", field: "PRIVATE" }); } catch { /* immutable is permitted */ } }
    if (mode === "getter") { try { Object.defineProperty(captured, "code", { get() { throw "PRIVATE"; } }); } catch { /* immutable is permitted */ } }
    if (mode === "proxy") captured = new Proxy({}, { get() { throw "PRIVATE"; }, getPrototypeOf() { throw "PRIVATE"; } });
    const input = new Proxy({}, { ownKeys() { throw captured; } });
    expect(contractResult(() => snapshotJson(input))).toEqual(hostile);
    expect(validateQuiescentCredentialSnapshot(root, input)).toEqual(hostile);
    expect(validateRuntimeCredentialValue(root, root, input)).toEqual({ ok: false, issue: { code: "invalid_input", field: "input" } });
  });
  it("sanitizes exported refusal construction", () => {
    expect(contractResult(() => refuse("PRIVATE" as never, "PRIVATE" as never))).toEqual({ ok: false, issue: { code: "invalid_input", field: "input" } });
  });
  it("uses a single checked key view and exactly one descriptor per key", () => {
    let enumerations = 0, descriptors = 0;
    const input = new Proxy({}, {
      ownKeys() { return ++enumerations === 1 ? ["safe"] : ["safe", ...Array.from({ length: 5000 }, (_, i) => "extra" + i)]; },
      getOwnPropertyDescriptor() { descriptors++; return { configurable: true, enumerable: true, value: 1 }; },
    });
    expect(contractResult(() => snapshotJson(input))).toEqual({ ok: true, value: { safe: 1 } });
    expect(enumerations).toBe(1); expect(descriptors).toBe(1);
  });
  it("rejects missing descriptors, symbols and accessors without getter calls", () => {
    let getters = 0;
    for (const descriptor of [undefined, { configurable: true, enumerable: true, get() { getters++; return 1; } }]) {
      const input = new Proxy({}, { ownKeys: () => ["safe"], getOwnPropertyDescriptor: () => descriptor });
      expect(contractResult(() => snapshotJson(input))).toEqual(hostile);
    }
    const input = { [Symbol("private")]: 1 };
    expect(contractResult(() => snapshotJson(input))).toEqual(hostile); expect(getters).toBe(0);
  });
  it.each(['{"a":}', '{"a":{"b":}}', '{"a":[{"b":}]}'])("lexically rejects missing values %s", raw => {
    expect(contractResult(() => parseBoundedJson(raw))).toEqual({ ok: false, issue: { code: "invalid_json", field: "input" } });
  });
  it("lexical JSON precedes invalid root/key grammar", () => {
    expect(validateRuntimeCredentialValue("invalid-root", "invalid-key", "{")).toEqual({ ok: false, issue: { code: "invalid_json", field: "input" } });
  });
});

describe("credential-v1 runtime boundary", () => {
  it("admits a fractional installed-SDK duration without rewriting raw", () => {
    const raw = JSON.stringify(session);
    expect(validateRuntimeCredentialValue(root, root, raw)).toEqual({ ok: true, value: { kind: "session", raw } });
  });
  it("rejects escaped duplicate member names before parse", () => {
    expect(validateRuntimeCredentialValue(root, root, '{"a":1,"\\u0061":2}')).toEqual({ ok: false, issue: { code: "duplicate_member", field: "input" } });
  });
  it.each([0, 0.125, 3599.87700009346, 9_007_199_254_740])("accepts numeric duration %s", duration => {
    expect(value(root, { ...session, expires_in: duration }).ok).toBe(true);
  });
  it.each([-0.1, 9_007_199_254_741, "3600", null, true, [], {}, "", false])("refuses duration %j", duration => {
    expect(value(root, { ...session, expires_in: duration }).ok).toBe(false);
  });
  it.each(["1e309", "-1e309", "NaN", "Infinity", "-Infinity"])("refuses nonfinite lexical %s without stringify", number => {
    expect(validateRuntimeCredentialValue(root, root, JSON.stringify(session).replace('"expires_in":0.125', '"expires_in":' + number)).ok).toBe(false);
  });
  it.each([NaN, Infinity, -Infinity])("rejects trusted seam nonfinite %s before stringify", number => {
    expect(contractResult(() => snapshotJson({ ...session, expires_in: number })).ok).toBe(false);
  });
  it.each(["", "null", "[]", "17", "false", "{", "{}"])("refuses SDK-falsy/malformed raw %j", raw => { expect(validateRuntimeCredentialValue(root, root, raw).ok).toBe(false); });
  it.each(["access_token", "refresh_token"])("checks required token %s", name => {
    for (const bad of ["", "has space", "x\u0000", "x\u0085", 1, null, "a".repeat(65_537)]) expect(value(root, { ...session, [name]: bad }).ok).toBe(false);
    expect(value(root, { ...session, [name]: "a".repeat(65_536) }).ok).toBe(true);
  });
  it.each(["provider_token", "provider_refresh_token"])("checks optional nullable token %s", name => {
    for (const good of [null, "SYNTHETIC"]) expect(value(root, { ...session, [name]: good }).ok).toBe(true);
    for (const bad of ["", false, "has space"]) expect(value(root, { ...session, [name]: bad }).ok).toBe(false);
  });
  it("keeps expires_at integer/millisecond rules separate", () => {
    for (const good of [0, 9_007_199_254_740]) expect(value(root, { ...session, expires_at: good }).ok).toBe(true);
    for (const bad of [-1, 0.1, 9_007_199_254_741, "100", null]) expect(value(root, { ...session, expires_at: bad }).ok).toBe(false);
    expect(value(root, { ...session, token_type: "Bearer" }).ok).toBe(false);
  });
  it("retains opaque own metadata and UTF-16 spellings without interpreting it", () => {
    const raw = '{"access_token":"SYNTHETIC","refresh_token":"SYNTHETIC","expires_at":0,"expires_in":0,"token_type":"bearer","opaque":{"__proto__":{"x":1},"constructor":"\\ud800\\u0000"}}';
    expect(validateRuntimeCredentialValue(root, root, raw)).toEqual({ ok: true, value: { kind: "session", raw } });
    const parsed = unwrap(contractResult(() => parseBoundedJson(raw))) as Record<string, unknown>;
    expect(Object.hasOwn(parsed, "opaque")).toBe(true); expect(({} as Record<string, unknown>).x).toBeUndefined();
  });
  it("accepts full opaque provider User, but not a provider-id-as-Profile grant", () => {
    expect(value(root, { ...session, user }).ok).toBe(true);
    expect(value(root + "-user", { user }).ok).toBe(true);
    for (const bad of [null, [], "scalar", {}, { ...user, id: "with space" }, { ...user, aud: "" }, { ...user, created_at: "" }, { ...user, app_metadata: [] }, { ...user, user_metadata: null }]) expect(value(root + "-user", { user: bad }).ok).toBe(false);
    expect(value(root + "-user", { user, extra: true }).ok).toBe(false);
    expect(value(root, { ...session, __isUserNotAvailableProxy: false }).ok).toBe(false);
    expect(value(root + "-user", { user: { ...user, __isUserNotAvailableProxy: true } }).ok).toBe(false);
  });
  it.each(["confirmation_sent_at", "recovery_sent_at", "email_change_sent_at", "new_email", "new_phone", "invited_at", "action_link", "email", "phone", "confirmed_at", "email_confirmed_at", "phone_confirmed_at", "last_sign_in_at", "role", "updated_at", "deleted_at", "banned_until"])("checks optional User string %s", name => {
    expect(value(root + "-user", { user: { ...user, [name]: "" } }).ok).toBe(true);
    for (const bad of [null, false, "a".repeat(4_097)]) expect(value(root + "-user", { user: { ...user, [name]: bad } }).ok).toBe(false);
  });
  it("checks known metadata, boolean, identity and factor fields", () => {
    const identity = { id: "opaque", user_id: "opaque", identity_id: "opaque", provider: "email", identity_data: {}, created_at: "", future: { retained: true } };
    const factor = { id: "factor", factor_type: "totp", status: "verified", created_at: "synthetic", updated_at: "synthetic" };
    const full = { ...user, is_anonymous: false, is_sso_user: true, app_metadata: { provider: "email", providers: ["email"] }, identities: [identity], factors: [factor] };
    expect(value(root + "-user", { user: full }).ok).toBe(true);
    for (const patch of [{ is_anonymous: null }, { is_sso_user: "yes" }, { app_metadata: { providers: [1] } }, { app_metadata: { provider: null } }, { identities: null }, { identities: [{ ...identity, user_id: "" }] }, { identities: [{ ...identity, identity_data: [] }] }, { identities: [{ ...identity, created_at: null }] }, { factors: [{ ...factor, status: "unknown" }] }, { factors: [{ ...factor, factor_type: "unknown" }] }, { factors: [{ ...factor, friendly_name: null }] }]) expect(value(root + "-user", { user: { ...full, ...patch } }).ok).toBe(false);
    for (const factor_type of ["totp", "phone", "webauthn"]) for (const status of ["verified", "unverified"]) expect(value(root + "-user", { user: { ...user, factors: [{ ...factor, factor_type, status }] } }).ok).toBe(true);
    expect(value(root + "-user", { user: { ...user, identities: Array.from({ length: 1_024 }, () => identity) } }).ok).toBe(true);
    expect(value(root + "-user", { user: { ...user, factors: Array.from({ length: 1_025 }, () => factor) } }).ok).toBe(false);
  });
  it.each([43, 56, 112, 128])("accepts verifier length %s and terminal recovery", length => {
    for (const suffix of ["", "/recovery"]) expect(value(legacy, "a".repeat(length) + suffix).ok).toBe(true);
  });
  it.each(["a".repeat(42), "a".repeat(129), "a".repeat(56) + "/recovery/recovery", "a".repeat(55) + " ", "a".repeat(56) + "=", "a".repeat(56) + "/other", ""])("refuses verifier %j", raw => { expect(value(legacy, raw).ok).toBe(false); });
  it("preserves verifier escape spelling and unsorted index order", () => {
    const raw = '"\\u0061' + "a".repeat(55) + '"';
    expect(validateRuntimeCredentialValue(root, legacy, raw)).toMatchObject({ ok: true, value: { raw } });
    const ordered = '[ "FlowId02", "FlowId01" ]';
    expect(validateRuntimeCredentialValue(root, index, ordered)).toMatchObject({ ok: true, value: { raw: ordered } });
    for (const bad of [null, {}, ["FlowId01", "FlowId01"], ["bad"], [1]]) expect(value(index, bad).ok).toBe(false);
    expect(value(index, []).ok).toBe(true);
    expect(value(index, Array.from({ length: 1_020 }, (_, i) => "Flow" + String(i).padStart(4, "0"))).ok).toBe(true);
    expect(value(index, Array.from({ length: 1_021 }, (_, i) => "Flow" + String(i).padStart(4, "0"))).ok).toBe(false);
  });
  it("classifies fixed before dynamic, never aliases foreign/unsupported own", () => {
    for (const fixed of fixedCredentialSlots(root)) expect(classifyCredentialKey(root, fixed.key)).toEqual({ kind: fixed.kind });
    expect(classifyCredentialKey(root, slot("FlowId01"))).toEqual({ kind: "flow_verifier", flowId: "FlowId01" });
    expect(classifyCredentialKey(root, root + "-mystery")).toEqual({ kind: "unsupported_own" });
    expect(classifyCredentialKey(root, "sb-foreign-auth-token")).toEqual({ kind: "foreign" });
    expect(classifyCredentialKey(root, root + "Extra")).toEqual({ kind: "foreign" });
    for (const bad of ["sb-127.0.0.1-auth-token", "sb-UPPER-auth-token", "custom"]) expect(validateRuntimeCredentialValue(bad, bad, JSON.stringify(session)).ok).toBe(false);
  });
});

describe("bounded lexical admission and hostile seams", () => {
  const admitted = (raw: unknown, limit?: number) => contractResult(() => parseBoundedJson(raw, limit));
  it.each(['{"a":1,"\\u0061":2}', '{"x":{"__proto__":1,"__proto__":2}}'])("rejects decoded duplicate %s", raw => { expect(admitted(raw)).toMatchObject({ ok: false, issue: { code: "duplicate_member" } }); });
  it.each(["[1,]", '{"a":1,}', "+1", "01", "1.", "1e", "true false", "\ufeff{}", '"\\x00"', '"raw\nnewline"', "[", "{", "", '"\\u000"'])("rejects non-JSON grammar %j", raw => { expect(admitted(raw).ok).toBe(false); });
  it("admits exactly raw UTF-16, depth, node, member and decoded-name limits", () => {
    const raw = JSON.stringify({ opaque: "a".repeat(1_048_563) });
    expect(raw.length).toBe(1_048_576); expect(admitted(raw).ok).toBe(true);
    expect(admitted(raw + " ")).toMatchObject({ ok: false, issue: { code: "limit_exceeded" } });
    expect(admitted("[".repeat(32) + "0" + "]".repeat(32)).ok).toBe(true);
    expect(admitted("[".repeat(33) + "0" + "]".repeat(33))).toMatchObject({ ok: false, issue: { code: "limit_exceeded" } });
    expect(admitted("[" + Array(65_535).fill("0").join(",") + "]").ok).toBe(true);
    expect(admitted("[" + Array(65_536).fill("0").join(",") + "]")).toMatchObject({ ok: false, issue: { code: "limit_exceeded" } });
    const members = (n: number) => "{" + Array.from({ length: n }, (_, i) => '"k' + i + '":0').join(",") + "}";
    expect(admitted(members(4_096)).ok).toBe(true); expect(admitted(members(4_097))).toMatchObject({ ok: false, issue: { code: "limit_exceeded" } });
    expect(admitted(JSON.stringify({ ["a".repeat(128)]: 0 })).ok).toBe(true); expect(admitted(JSON.stringify({ ["a".repeat(129)]: 0 })).ok).toBe(false);
  });
  it("uses bounded addition for the aggregate admission and exact per-value/key limits", () => {
    expect(chargeCredentialUnits(8_388_607, 1)).toBe(8_388_608);
    expect(contractResult(() => chargeCredentialUnits(8_388_608, 1))).toMatchObject({ ok: false, issue: { code: "limit_exceeded" } });
    for (const count of [-1, 0.5, NaN, Infinity, Number.MAX_SAFE_INTEGER + 1]) expect(contractResult(() => chargeCredentialUnits(count, 0))).toMatchObject({ ok: false, issue: { code: "invalid_input" } });
    const base = JSON.stringify({ ...session, opaque: "" });
    const raw = JSON.stringify({ ...session, opaque: "a".repeat(1_048_576 - base.length) });
    expect(raw.length).toBe(1_048_576); expect(validateRuntimeCredentialValue(root, root, raw).ok).toBe(true);
    expect(validateRuntimeCredentialValue(root, root, raw + " ")).toMatchObject({ ok: false, issue: { code: "limit_exceeded" } });
    expect(validateRuntimeCredentialValue(root, "a".repeat(192), raw)).toMatchObject({ ok: false, issue: { code: "invalid_key" } });
    expect(validateRuntimeCredentialValue(root, "a".repeat(193), raw)).toMatchObject({ ok: false, issue: { code: "limit_exceeded" } });
    expect(contractResult(() => parseBoundedJson(JSON.stringify("a".repeat(1_048_576)), 6_300_000)).ok).toBe(true);
    expect(contractResult(() => parseBoundedJson(JSON.stringify("a".repeat(1_048_577)), 6_300_000))).toMatchObject({ ok: false, issue: { code: "limit_exceeded" } });
  });
  it("rejects arbitrary input without getters, iterators or toJSON", () => {
    let calls = 0;
    const hostile = { get value() { calls++; throw "PRIVATE"; }, toJSON() { calls++; return {}; } };
    expect(validateRuntimeCredentialValue(root, root, hostile).ok).toBe(false);
    expect(contractResult(() => snapshotJson(hostile))).toMatchObject({ ok: false, issue: { code: "hostile_input" } });
    expect(calls).toBe(0);
    for (const input of [new String("{}"), Symbol(), BigInt(1), () => ({}), Object.create({ custom: true }), { [Symbol()]: 1 }, Array(2), Object.defineProperty({}, "hidden", { value: 1 }), Object.assign([], { custom: 1 })]) expect(contractResult(() => snapshotJson(input)).ok).toBe(false);
    const cycle: Record<string, unknown> = {}; cycle.self = cycle;
    expect(contractResult(() => snapshotJson(cycle)).ok).toBe(false);
  });
  it("contains reflection traps, including an uninspectable thrown value", () => {
    const thrown = new Proxy({}, { getPrototypeOf() { throw "MUST_NOT_INSPECT"; } });
    const proxy = new Proxy({}, { ownKeys() { throw thrown; } });
    expect(() => contractResult(() => snapshotJson(proxy))).not.toThrow();
    expect(contractResult(() => snapshotJson(proxy))).toEqual({ ok: false, issue: { code: "hostile_input", field: "input" } });
  });
  it("reads each descriptor once and returns detached frozen own data", () => {
    const counts = new Map<PropertyKey, number>();
    const proxy = new Proxy({ nested: { safe: true } }, { getOwnPropertyDescriptor(target, key) { counts.set(key, (counts.get(key) ?? 0) + 1); return Reflect.getOwnPropertyDescriptor(target, key); }, get() { throw "NO_GET"; } });
    const copy = unwrap(contractResult(() => snapshotJson(proxy))) as { nested: { safe: boolean } };
    expect([...counts.values()]).toEqual([1]); expect(Object.isFrozen(copy.nested)).toBe(true);
    expect(copy === proxy).toBe(false);
    expect(contractResult(() => snapshotJson(Object.assign(Object.create(null), { data: true }))).ok).toBe(true);
  });
});

describe("quiescent inventory is stricter than per-item runtime", () => {
  it.each([{}, { [legacy]: JSON.stringify(verifier) }, { [slot("Orphan01")]: JSON.stringify(verifier) }, { [root]: JSON.stringify(session) }, { [root + "-user"]: JSON.stringify({ user }) }, { [root]: JSON.stringify(session), [root + "-user"]: JSON.stringify({ user }) }, { [root]: JSON.stringify({ ...session, user }) }])("accepts complete supported frozen combination %j", present => { expect(validateQuiescentCredentialSnapshot(root, listing(present)).ok).toBe(true); });
  it("requires positive observations and never reads foreign values", () => {
    const empty = unwrap(validateQuiescentCredentialSnapshot(root, listing()));
    expect(empty.fixedSlots.map(s => s.presence)).toEqual(["absent", "absent", "absent", "absent"]);
    const foreign = listing(); foreign.listedKeys.push("foreign"); expect(validateQuiescentCredentialSnapshot(root, foreign).ok).toBe(true);
    foreign.reads.push({ key: "foreign", result: { status: "absent" } }); expect(validateQuiescentCredentialSnapshot(root, foreign).ok).toBe(false);
    const missing = listing(); missing.reads.pop(); expect(validateQuiescentCredentialSnapshot(root, missing)).toMatchObject({ ok: false, issue: { code: "evidence_unavailable" } });
    const duplicate = listing(); duplicate.reads.push(duplicate.reads[0]); expect(validateQuiescentCredentialSnapshot(root, duplicate).ok).toBe(false);
    const failed = listing(); (failed.reads[0] as unknown as { result: unknown }).result = { status: "read_failed" }; expect(validateQuiescentCredentialSnapshot(root, failed).ok).toBe(false);
    expect(validateQuiescentCredentialSnapshot(root, { ...listing(), enumerationComplete: false }).ok).toBe(false);
    expect(validateQuiescentCredentialSnapshot(root, listing({ [root + "-unknown"]: "preserve" })).ok).toBe(false);
  });
  it("blocks frozen missing index references but runtime index remains valid", () => {
    expect(value(index, ["FlowId01"]).ok).toBe(true);
    expect(validateQuiescentCredentialSnapshot(root, listing({ [index]: '["FlowId01"]' })).ok).toBe(false);
    const present = { [index]: '["FlowId01"]', [slot("FlowId01")]: JSON.stringify(verifier), [slot("Orphan01")]: JSON.stringify(verifier) };
    const inventory = unwrap(validateQuiescentCredentialSnapshot(root, listing(present)));
    expect(inventory.initialEntryKeys).toEqual(Object.keys(present).sort());
  });
  it("checks frozen user ID agreement only, retaining different auxiliary fields", () => {
    expect(validateQuiescentCredentialSnapshot(root, listing({ [root]: JSON.stringify({ ...session, user }), [root + "-user"]: JSON.stringify({ user: { ...user, email: "other" } }) })).ok).toBe(true);
    expect(validateQuiescentCredentialSnapshot(root, listing({ [root]: JSON.stringify({ ...session, user }), [root + "-user"]: JSON.stringify({ user: { ...user, id: "foreign" } }) })).ok).toBe(false);
  });
  it("admits 1024 present keys with 1020 flows, refuses one extra", () => {
    const present: Record<string, string> = { [root]: JSON.stringify(session), [root + "-user"]: JSON.stringify({ user }), [legacy]: JSON.stringify(verifier), [index]: "[]" };
    for (let i = 0; i < 1_020; i++) present[slot("Flow" + String(i).padStart(4, "0"))] = JSON.stringify(verifier);
    expect(unwrap(validateQuiescentCredentialSnapshot(root, listing(present))).initialEntryKeys).toHaveLength(1_024);
    present[slot("Extra001")] = JSON.stringify(verifier);
    expect(validateQuiescentCredentialSnapshot(root, listing(present))).toMatchObject({ ok: false, issue: { code: "limit_exceeded" } });
  });
});

// Installed helper tests, not copies of helper algorithms. All data is synthetic.
function memory(seed: Record<string, string> = {}, interruptAfter = Infinity) {
  const data = new Map(Object.entries(seed)), trace: string[] = [];
  function boundary(op: string, key: string) { trace.push(op + ":" + key); if (trace.length === interruptAfter) throw new Error("synthetic interruption"); }
  return { data, trace, storage: {
    async getItem(key: string) { const raw = data.get(key) ?? null; if (raw !== null) unwrap(validateRuntimeCredentialValue(root, key, raw)); boundary("get", key); return raw; },
    async setItem(key: string, raw: string) { unwrap(validateRuntimeCredentialValue(root, key, raw)); data.set(key, raw); boundary("set", key); },
    async removeItem(key: string) { expect(["foreign", "unsupported_own"]).not.toContain(classifyCredentialKey(root, key).kind); data.delete(key); boundary("remove", key); },
  } };
}
const seed = { [slot("FlowId01")]: JSON.stringify(verifier), [slot("Orphan01")]: JSON.stringify("b".repeat(56)), [index]: '["FlowId01"]', [legacy]: JSON.stringify(verifier) };
describe("installed SDK helper compatibility", () => {
  it("performs actual store/eviction/index/legacy sequence", async () => {
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("unexpected fetch"); }));
    const m = memory({ [index]: JSON.stringify(["FlowId00", "FlowId01", "FlowId02", "FlowId03", "FlowId04"]) });
    await storePKCEVerifier(m.storage, root, "FlowId05", verifier);
    expect(m.trace).toEqual(["set:" + slot("FlowId05"), "get:" + index, "remove:" + slot("FlowId00"), "set:" + index, "set:" + legacy]);
    expect(m.data.get(index)).toBe('["FlowId01","FlowId02","FlowId03","FlowId04","FlowId05"]');
    expect(m.data.get(legacy)).toBe(JSON.stringify(verifier)); expect(fetch).not.toHaveBeenCalled();
  });
  it("removes slot before reading the still-referencing valid index", async () => {
    const m = memory(seed);
    await removePKCEVerifier(m.storage, root, "FlowId01");
    expect(m.trace).toEqual(["get:" + slot("FlowId01"), "remove:" + slot("FlowId01"), "get:" + index, "remove:" + index, "get:" + legacy, "remove:" + legacy]);
    expect(m.data.get(slot("Orphan01"))).toBe(seed[slot("Orphan01")]);
  });
  it("removeAll uses index order and leaves unindexed raw untouched", async () => {
    const m = memory({ ...seed, [slot("FlowId02")]: JSON.stringify(verifier), [index]: '["FlowId02","FlowId01"]' });
    await removeAllPKCEVerifiers(m.storage, root);
    expect(m.trace).toEqual(["get:" + index, "remove:" + slot("FlowId02"), "remove:" + slot("FlowId01"), "remove:" + index, "remove:" + legacy]);
    expect([...m.data]).toEqual([[slot("Orphan01"), seed[slot("Orphan01")]]]);
  });
  it.each(["store", "remove", "removeAll"])("preserves actual partial %s state after EACH storage call, no repair", async operation => {
    const run = (m: ReturnType<typeof memory>) => operation === "store" ? storePKCEVerifier(m.storage, root, "FlowId02", verifier) : operation === "remove" ? removePKCEVerifier(m.storage, root, "FlowId01") : removeAllPKCEVerifiers(m.storage, root);
    const complete = memory(seed); await run(complete);
    for (let call = 1; call <= complete.trace.length; call++) {
      const m = memory(seed, call); await expect(run(m)).rejects.toThrow("synthetic interruption");
      expect(m.trace).toEqual(complete.trace.slice(0, call));
      expect(m.data.get(slot("Orphan01"))).toBe(seed[slot("Orphan01")]);
      for (const [key, raw] of m.data) expect(validateRuntimeCredentialValue(root, key, raw).ok).toBe(true);
      const before = [...m.data]; validateQuiescentCredentialSnapshot(root, listing(Object.fromEntries(m.data))); expect([...m.data]).toEqual(before);
    }
  });
  it("allows lost concurrent index update without a runtime cross-key latch", async () => {
    const m = memory();
    await Promise.all([storePKCEVerifier(m.storage, root, "FlowId01", verifier), storePKCEVerifier(m.storage, root, "FlowId02", verifier)]);
    expect(m.data.has(slot("FlowId01"))).toBe(true); expect(m.data.has(slot("FlowId02"))).toBe(true);
    expect(JSON.parse(m.data.get(index)!)).toHaveLength(1);
    await removeAllPKCEVerifiers(m.storage, root);
    expect([...m.data.keys()].filter(key => key.includes("-flow-"))).toHaveLength(1);
  });
  it("executes public installed setSession with fractional duration through REAL validator and I", async () => {
    vi.stubGlobal("fetch", vi.fn(() => { throw new Error("unexpected global fetch"); }));
    const clock = vi.spyOn(Date, "now").mockReturnValue(1_700_000_000_123);
    const m = memory();
    const transport = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
      if (new URL(url).pathname !== "/auth/v1/user" || (init?.method ?? "GET") !== "GET") throw new Error("unexpected SDK fetch");
      return new Response(JSON.stringify(user), { status: 200, headers: { "Content-Type": "application/json" } });
    });
    const client = createClient("https://fixture.supabase.invalid", "synthetic-publishable-key", { auth: { storage: m.storage, storageKey: root, persistSession: true, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: transport } });
    try {
      await client.auth.initialize();
      const encode = (data: unknown) => Buffer.from(JSON.stringify(data)).toString("base64url");
      const jwt = encode({ alg: "HS256", typ: "JWT" }) + "." + encode({ sub: user.id, exp: 1_700_003_600 }) + ".c3ludGhldGlj";
      const result = await client.auth.setSession({ access_token: jwt, refresh_token: "SYNTHETIC_REFRESH" });
      expect(result.error).toBeNull(); expect(transport).toHaveBeenCalledTimes(1);
      expect(m.trace.filter(op => op === "set:" + root)).toHaveLength(1);
      const raw = m.data.get(root)!;
      const duration = JSON.parse(raw).expires_in;
      expect(Number.isFinite(duration)).toBe(true); expect(Number.isInteger(duration)).toBe(false);
      expect(duration).toBe(1_700_003_600 - 1_700_000_000_123 / 1_000);
      expect(duration >= 0 && duration <= 9_007_199_254_740).toBe(true);
      expect(await m.storage.getItem(root)).toBe(raw);
      expect(providerSessionStorageKey("https://fixture.supabase.invalid")).toBe(root);
      const id = "00000001-1111-4111-8111-111111111111";
      const wire = unwrap(serializeI({ schemaVersion: 1, protocolId: id, credentialEpochId: id, originManifestId: id, providerConfigIdentity: "pc1:fixture", sdkContractVersion: "auth-js/2.112.3:credential-v1", key: root, value: raw }, root));
      expect(unwrap(parseI(wire, root)).value).toBe(raw);
      expect(fetch).not.toHaveBeenCalled();
    } finally { client.auth.stopAutoRefresh(); await client.removeAllChannels(); clock.mockRestore(); }
  });
});
