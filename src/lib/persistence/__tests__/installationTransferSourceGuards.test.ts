import { afterEach, expect, it, vi } from "vitest";
import { webcrypto } from "node:crypto";
import { createTransferSourceGuardOwner } from "../installationTransferSourceGuards";
import { admitSourceAwareTransferPreparation } from "../installationTransferAdmission";
import { resolveTransferSourceDenial } from "../installationTransferSourceDenial";
import { createAccountDeletionGuardRepository, DELETION_GUARD_PREFIX, DELETION_GUARD_RESOLUTION_PREFIX } from "../../identity/accountDeletionGuard";
import { protectedArchive, setup, disposeTransferFixtures } from "./installationTransferTestFixture";
import type { StorageAdapter } from "../types";
const p = "10000000-0000-4000-8000-000000000001", q = "20000000-0000-4000-8000-000000000002";
const n = "30000000-0000-4000-8000-000000000003", other = "40000000-0000-4000-8000-000000000004";
const gk = (profile = p) => DELETION_GUARD_PREFIX + profile + ".v1";
const rk = (nonce = n) => DELETION_GUARD_RESOLUTION_PREFIX + nonce + ".v1";
const guard = (profile = p, nonce = n, revision = 4) => ({ schemaVersion: 1 as const, profileId: profile, nonce, revision });
const receipt = (profile = p, nonce = n, fencedRevision = 6) => JSON.stringify({ schemaVersion: 1, profileId: profile, nonce, fencedRevision });
const originals = () => ({ [gk()]: JSON.stringify(guard()) });
const owners: { close(): Promise<unknown> }[] = [];
afterEach(async () => { for (const owner of owners.splice(0)) await owner.close(); await disposeTransferFixtures(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function fixture(raws: Record<string, string> = originals()) {
  vi.stubGlobal("crypto", webcrypto);
  const archive = await protectedArchive(raws), admitted = await admitSourceAwareTransferPreparation(archive.protectedWire, archive.recoveryCode, () => true);
  expect(admitted.ok).toBe(true); if (!admitted.ok) throw null;
  const handle = admitted.sourceDenial, source = resolveTransferSourceDenial(handle)!, before = JSON.stringify(source);
  const owner = createTransferSourceGuardOwner(handle)!; expect(owner).not.toBeNull();
  const values = new Map<string, string>(); let live = true;
  const adapter: StorageAdapter = { get: vi.fn(async key => ({ status: "value" as const, value: values.get(key) ?? null })),
    set: vi.fn(async (key, value) => { values.set(key, value); return { ok: true as const }; }) };
  const repo = owner.repository(adapter, () => live);
  return { archive, handle, source, before, owner, values, adapter, repo, current: () => live, stop: () => { live = false; }, assertSource: () => expect(JSON.stringify(source)).toBe(before) };
}
it("accepts only a genuine source handle without reflecting on forgeries", async () => {
  const f = await fixture(), trap = vi.fn(() => { throw null; });
  for (const fake of [null, {}, { ...f.handle }, Object.create(f.handle), new Proxy(f.handle, { get: trap, getPrototypeOf: trap })]) expect(createTransferSourceGuardOwner(fake)).toBeNull();
  expect(trap).not.toHaveBeenCalled(); expect(f.adapter.get).not.toHaveBeenCalled();
});
it("projects only the original negative guard with actual destination reads and no copy/write", async () => {
  const f = await fixture();
  expect(await f.repo.load(p)).toEqual({ status: "guard", guard: guard(), resolved: false });
  expect(await f.repo.canAdmit(p)).toBe(false); expect(await f.repo.canAdmit(q)).toBe(true);
  expect(f.adapter.get).toHaveBeenCalledWith(gk()); expect(f.adapter.get).toHaveBeenCalledWith(rk()); expect(f.adapter.set).not.toHaveBeenCalled();
  expect(f.values.size).toBe(0); f.assertSource();
});
it("uses archived resolved F only as a negative floor and requires a new actual receipt", async () => {
  const f = await fixture({ ...originals(), [rk()]: receipt(p, n, 8) });
  expect(await f.repo.canAdmit(p)).toBe(false);
  for (const revision of [0, 4, 7]) expect(f.repo.acceptControl(p, revision)).toBe(false);
  for (const revision of [8, 9, 2147483646]) expect(f.repo.acceptControl(p, revision)).toBe(true);
  f.values.set(rk(), receipt(p, n, 8)); expect(await f.repo.canAdmit(p)).toBe(false);
  expect(await f.repo.resolve(guard(), 8)).toBe(false); expect(await f.repo.resolve(guard(), 9)).toBe(true);
  expect(await f.repo.canAdmit(p)).toBe(true); expect(f.values.has(gk())).toBe(false); f.assertSource();
});
it.each([-1, 1.5, Number.MAX_SAFE_INTEGER, 2147483647, NaN, Infinity, "6", null])("rejects invalid control revision %s without I/O", async revision => {
  const f = await fixture(); expect(f.repo.acceptControl(p, revision as number)).toBe(false); expect(f.adapter.get).not.toHaveBeenCalled();
});
it("checks actual Profile and owner currentness for every control", async () => {
  const f = await fixture(); expect(f.repo.acceptControl(p, 3)).toBe(false); expect(f.repo.acceptControl(p, 4)).toBe(true);
  expect(f.repo.acceptControl("bad", 9)).toBe(false); expect(f.repo.acceptControl(q, 0)).toBe(true);
  f.stop(); expect(f.repo.acceptControl(p, 9)).toBe(false); expect(await f.repo.load(p)).toEqual({ status: "unavailable" }); expect(await f.repo.canAdmit(q)).toBe(false);
});
it("requires the exact applicable original Profile/nonce/revision and strictly greater F", async () => {
  const f = await fixture();
  for (const wrong of [guard(q), guard(p, other), guard(p, n, 3), { ...guard(), schemaVersion: 2 }]) expect(await f.repo.resolve(wrong as never, 8)).toBe(false);
  for (const bad of [-1, 0, 4, 2147483647, NaN]) expect(await f.repo.resolve(guard(), bad)).toBe(false);
  expect(f.adapter.set).not.toHaveBeenCalled(); expect(await f.repo.resolve(guard(), 5)).toBe(true); expect(f.values.get(rk())).toBe(receipt(p, n, 5)); f.assertSource();
});
it.each(["malformed_guard", "future_guard", "conflicting_revision", "malformed_receipt", "other_profile", "other_nonce", "future_receipt", "not_newer"])('holds %s without overwriting evidence', async kind => {
  const f = await fixture();
  if (kind === "malformed_guard") f.values.set(gk(), "{");
  if (kind === "future_guard") f.values.set(gk(), JSON.stringify({ ...guard(), schemaVersion: 2 }));
  if (kind === "conflicting_revision") f.values.set(gk(), JSON.stringify(guard(p, n, 7)));
  if (kind === "malformed_receipt") f.values.set(rk(), "{");
  if (kind === "other_profile") f.values.set(rk(), receipt(q));
  if (kind === "other_nonce") f.values.set(rk(), receipt(p, other));
  if (kind === "future_receipt") f.values.set(rk(), JSON.stringify({ schemaVersion: 2, profileId: p, nonce: n, fencedRevision: 8 }));
  if (kind === "not_newer") f.values.set(rk(), receipt(p, n, 4));
  const before = [...f.values]; expect(await f.repo.load(p)).toEqual({ status: "unavailable" }); expect(await f.repo.canAdmit(p)).toBe(false);
  expect(await f.repo.resolve(guard(), 9)).toBe(false); expect(await f.repo.begin(p, 9, other)).toBeNull(); expect([...f.values]).toEqual(before); expect(f.adapter.set).not.toHaveBeenCalled(); f.assertSource();
});
it("keeps both original and newer destination constraints until each is legitimately resolved", async () => {
  const f = await fixture(); f.values.set(gk(), JSON.stringify(guard(p, other, 7)));
  expect(await f.repo.load(p)).toEqual({ status: "guard", guard: guard(), resolved: false });
  expect(await f.repo.resolve(guard(p, other, 7), 10)).toBe(false);
  expect(await f.repo.resolve(guard(), 8)).toBe(true); expect(await f.repo.canAdmit(p)).toBe(false);
  expect(await f.repo.load(p)).toEqual({ status: "guard", guard: guard(p, other, 7), resolved: false });
  expect(await f.repo.resolve(guard(p, other, 7), 9)).toBe(true); expect(await f.repo.canAdmit(p)).toBe(true);
  expect(f.values.get(gk())).toBe(JSON.stringify(guard(p, other, 7))); expect(f.values.get(rk())).toBe(receipt(p, n, 8)); f.assertSource();
});
it("never cross-resolves repeated nonces across control-only Profiles or overwrites another Profile receipt", async () => {
  const f = await fixture({ ...originals(), [gk(q)]: JSON.stringify(guard(q)) });
  expect(f.source.facts.sportingProfiles).toEqual([]); expect(await f.repo.resolve(guard(), 7)).toBe(true);
  expect(await f.repo.canAdmit(p)).toBe(true); expect(await f.repo.canAdmit(q)).toBe(false);
  const before = [...f.values]; expect(await f.repo.resolve(guard(q), 8)).toBe(false); expect([...f.values]).toEqual(before); expect(await f.repo.canAdmit(p)).toBe(true); f.assertSource();
});
it("preserves monotonic actual receipts and idempotently confirms an equal exact receipt", async () => {
  const f = await fixture(); expect(await f.repo.resolve(guard(), 9)).toBe(true); const writes = vi.mocked(f.adapter.set).mock.calls.length;
  expect(await f.repo.resolve(guard(), 8)).toBe(false); expect(await f.repo.resolve(guard(), 9)).toBe(true); expect(f.adapter.set).toHaveBeenCalledTimes(writes);
  expect(await f.repo.resolve(guard(), 10)).toBe(true); expect(f.values.get(rk())).toBe(receipt(p, n, 10));
});
it("raises the owner-wide negative floor only from actually validated destination receipts", async () => {
  const f = await fixture(), caller = f.owner.repository(f.adapter, f.current);
  f.values.set(rk(), receipt(p, n, 9)); expect(await f.repo.canAdmit(p)).toBe(true);
  expect(caller.acceptControl(p, 8)).toBe(false); expect(caller.acceptControl(p, 9)).toBe(true);
  expect(await caller.load(p)).toMatchObject({ resolved: true }); expect(await caller.begin(p, 8, other)).toBeNull();
});
it("rechecks control-before-first-load against newly discovered valid receipt evidence", async () => {
  const f = await fixture(); f.values.set(rk(), receipt(p, n, 9)); expect(f.repo.acceptControl(p, 5)).toBe(true);
  expect(await f.repo.load(p)).toEqual({ status: "unavailable" }); expect(await f.repo.resolve(guard(), 10)).toBe(false);
  expect(f.adapter.set).not.toHaveBeenCalled(); expect(f.repo.acceptControl(p, 9)).toBe(true); expect(await f.repo.load(p)).toMatchObject({ resolved: true });
});
it("rechecks a per-call control when another repository raises the same owner's floor", async () => {
  const f = await fixture(), caller = f.owner.repository(f.adapter, f.current);
  expect(caller.acceptControl(p, 5)).toBe(true); expect(await f.repo.resolve(guard(), 9)).toBe(true); expect(await f.repo.canAdmit(p)).toBe(true);
  expect(await caller.resolve(guard(), 10)).toBe(false); expect(await caller.canAdmit(p)).toBe(false); expect(await caller.load(p)).toEqual({ status: "unavailable" });
  expect(caller.acceptControl(p, 9)).toBe(true); expect(await caller.resolve(guard(), 10)).toBe(true);
});
it("never turns malformed or another Profile's receipt into a remembered revision floor", async () => {
  const f = await fixture(); f.values.set(rk(), receipt(q, n, 100)); expect(await f.repo.load(p)).toEqual({ status: "unavailable" });
  f.values.delete(rk()); expect(f.repo.acceptControl(p, 4)).toBe(true); expect(await f.repo.resolve(guard(), 5)).toBe(true);
});
it("begin refuses original/destination holds and allows a new guard only after both resolve", async () => {
  const f = await fixture(); expect(await f.repo.begin(p, 8, other)).toBeNull(); expect(f.adapter.set).not.toHaveBeenCalled();
  expect(await f.repo.resolve(guard(), 8)).toBe(true); expect(await f.repo.begin(p, 9, other)).toEqual(guard(p, other, 9));
  expect(await f.repo.begin(p, 10, n)).toBeNull(); expect(await f.repo.canAdmit(p)).toBe(false); expect(await f.repo.canAdmit(q)).toBe(true); f.assertSource();
});
it("does not re-use the original nonce with a contradictory newer revision", async () => {
  const f = await fixture(); expect(await f.repo.resolve(guard(), 8)).toBe(true); expect(await f.repo.begin(p, 9, n)).toBeNull(); expect(f.values.has(gk())).toBe(false);
});
it("retains ordinary repository behavior without a source guard", async () => {
  const f = await fixture({}), ordinary = createAccountDeletionGuardRepository(f.adapter);
  expect(await f.repo.load(p)).toEqual(await ordinary.load(p)); expect(await f.repo.begin(p, 4, n)).toEqual(guard());
  expect(await f.repo.canAdmit(p)).toBe(false); expect(await f.repo.resolve(guard(), 6)).toBe(true); expect(await f.repo.load(p)).toEqual(await ordinary.load(p));
});
it.each(["guard", "receipt"])('holds unreadable actual %s even when source metadata is valid', async lane => {
  const f = await fixture(), original = vi.mocked(f.adapter.get).getMockImplementation()!;
  vi.mocked(f.adapter.get).mockImplementation(async key => key === (lane === "guard" ? gk() : rk()) ? { status: "read_failed", fallback: null, error: { kind: "storage_unavailable" } } : original(key));
  expect(await f.repo.load(p)).toEqual({ status: "unavailable" }); expect(await f.repo.resolve(guard(), 9)).toBe(false); expect(f.adapter.set).not.toHaveBeenCalled();
});
it.each(["write_failure", "readback_failure", "currentness_loss"])('does not acknowledge %s', async failure => {
  const f = await fixture();
  vi.mocked(f.adapter.set).mockImplementation(async (key, value) => {
    if (failure === "write_failure") return { ok: false, error: { kind: "storage_unavailable" } };
    f.values.set(key, value);
    if (failure === "readback_failure") vi.mocked(f.adapter.get).mockResolvedValue({ status: "read_failed", fallback: null, error: { kind: "storage_unavailable" } });
    else f.stop(); return { ok: true };
  });
  expect(await f.repo.resolve(guard(), 9)).toBe(false); expect(await f.repo.canAdmit(p)).toBe(false); f.assertSource();
});
it("shares one mutation claim across actual repository instances and blocks concurrent outer reads", async () => {
  const f = await fixture(), entered = deferred(), hold = deferred(), get = vi.mocked(f.adapter.get).getMockImplementation()!; let armed = true;
  vi.mocked(f.adapter.get).mockImplementation(async key => { if (armed) { armed = false; entered.resolve(); await hold.promise; } return get(key); });
  const otherRepo = f.owner.repository(f.adapter, f.current), first = f.repo.resolve(guard(), 9); await entered.promise;
  expect(f.owner.ownsCompletion(first)).toBe(true); expect(otherRepo.acceptControl(p, 9)).toBe(false);
  expect(await otherRepo.resolve(guard(), 10)).toBe(false); expect(await otherRepo.begin(p, 10, other)).toBeNull();
  expect(await otherRepo.load(p)).toEqual({ status: "unavailable" }); expect(await otherRepo.canAdmit(p)).toBe(false);
  hold.resolve(); expect(await first).toBe(true); expect(await otherRepo.resolve(guard(), 8)).toBe(false); expect(await otherRepo.resolve(guard(), 10)).toBe(true);
});
it.each(["load", "canAdmit"] as const)('rejects an older %s even if a newer mutation finishes before its read resumes', async method => {
  const f = await fixture(), entered = deferred(), hold = deferred(), get = vi.mocked(f.adapter.get).getMockImplementation()!; let armed = true;
  vi.mocked(f.adapter.get).mockImplementation(async key => { const read = await get(key); if (armed) { armed = false; entered.resolve(); await hold.promise; } return read; });
  const reading = f.repo[method](p); await entered.promise; expect(await f.repo.resolve(guard(), 8)).toBe(true); hold.resolve();
  expect(await reading).toEqual(method === "load" ? { status: "unavailable" } : false);
});
it("registers all exact outward completions before actual adapter work", async () => {
  const f = await fixture({});
  const completions = [f.repo.load(p), f.repo.canAdmit(p), f.repo.begin(p, 4, n)];
  for (const whole of completions) expect(f.owner.ownsCompletion(whole)).toBe(true);
  expect(f.owner.ownsCompletion(Promise.resolve())).toBe(false); expect(f.adapter.get).not.toHaveBeenCalled(); await Promise.all(completions);
  const resolving = f.repo.resolve(guard(), 8); expect(f.owner.ownsCompletion(resolving)).toBe(true); await resolving;
  expect(f.owner.ownsCompletion(new Proxy(resolving, { get() { throw null; } }))).toBe(false);
});
async function actual(f: Awaited<ReturnType<typeof fixture>>, label: string) {
  const sql = await setup();
  const pairing = await import("../installationTransferPairing");
  const protectedValues = new Map<string, string>();
  const owner = pairing.createInstallationTransferHostOwner({ sqlite: sql.options, providerConfigIdentity: "pc1:sourceguards-" + label.toLowerCase(), sessionStorageKey: "sb-sourceguards-" + label.toLowerCase() + "-auth-token", detectPlatform: () => "ios", protectedBinding: {
    failedWriteMayLosePreviousValue: false, configure: async () => {}, inventory: async () => ({ kind: "complete", keys: [...protectedValues.keys()].sort() }),
    read: async (key: string) => protectedValues.has(key) ? { kind: "value", value: protectedValues.get(key) } : { kind: "established_absent" },
    write: async (key: string, value: string) => { protectedValues.set(key, value); }, remove: async (key: string) => ({ kind: protectedValues.delete(key) ? "deleted" : "nothing_to_delete" }),
  } }, f.owner.ownsCompletion); owners.push(owner);
  expect(await owner.pair(f.archive.protectedWire, f.archive.recoveryCode)).toMatchObject({ code: "paired" });
  const pair = await owner.handoff(); expect(pair).not.toBeNull(); const repo = f.owner.repository(pair!.domain, () => true);
  const connection = await sql.options.engine.createConnection(""), original = connection.query;
  return { sql, owner, pair: pair!, repo, connection, original };
}
it.each(["load", "canAdmit", "resolve", "begin"] as const)('excludes actual native self completion of %s without a cycle or acknowledgement', async method => {
  vi.resetModules(); // Intentional native failure retains its own lifetime registry.
  const f = await fixture(method === "begin" ? {} : originals());
  const { owner, repo, connection, original } = await actual(f, method);
  connection.query = (() => whole) as never;
  const whole = method === "load" ? repo.load(p) : method === "canAdmit" ? repo.canAdmit(p) : method === "resolve" ? repo.resolve(guard(), 8) : repo.begin(p, 4, n);
  const result = await Promise.race([whole.then(value => ({ value })), new Promise<null>(resolve => setTimeout(() => resolve(null), 1000))]);
  try { expect(result).not.toBeNull(); expect(result?.value).toEqual(method === "load" ? { status: "unavailable" } : method === "begin" ? null : false); }
  finally { connection.query = original; await owner.close(); }
});
it("joins unrelated actual query work before resolving, and retains the mutation claim through settlement", async () => {
  vi.resetModules(); const f = await fixture(), a = await actual(f, "unrelated"), hold = deferred(), entered = deferred(); let armed = true, done = false;
  a.connection.query = (sql, values) => {
    if (!armed) return a.original(sql, values); armed = false; entered.resolve();
    return hold.promise.then(() => a.original(sql, values));
  };
  const work = a.repo.resolve(guard(), 9); void work.then(() => { done = true; }); await entered.promise;
  const otherRepo = f.owner.repository(a.pair.domain, () => true);
  expect(f.owner.ownsCompletion(work)).toBe(true); expect(f.owner.ownsCompletion(hold.promise)).toBe(false);
  expect(await otherRepo.resolve(guard(), 10)).toBe(false); expect(done).toBe(false);
  hold.resolve(); expect(await work).toBe(true); expect(await a.repo.canAdmit(p)).toBe(true); f.assertSource();
});
it("drains malformed acquired query work before releasing the mutation claim or actual cleanup", async () => {
  vi.resetModules(); const f = await fixture(), a = await actual(f, "malformed"), hold = deferred(), entered = deferred(); let armed = true, done = false, closed = false;
  a.connection.query = ((sql: string, values?: unknown[]) => {
    if (!armed) return a.original(sql, values ?? []); armed = false;
    return new Proxy({ values: hold.promise }, { getOwnPropertyDescriptor(target, name) { if (name === "values") entered.resolve(); return Reflect.getOwnPropertyDescriptor(target, name); } });
  }) as never;
  const work = a.repo.resolve(guard(), 9); void work.then(() => { done = true; }); await entered.promise;
  const close = a.owner.close(); void close.then(() => { closed = true; }); await new Promise(resolve => setTimeout(resolve, 5));
  try { expect(done).toBe(false); expect(closed).toBe(false); expect(await a.repo.resolve(guard(), 10)).toBe(false); }
  finally { hold.resolve(); expect(await work).toBe(false); a.connection.query = a.original; await close; }
});

it("never revives rights from an older matching receipt after a newer fence was observed", async () => {
  const f = await fixture(); expect(await f.repo.resolve(guard(), 9)).toBe(true); expect(await f.repo.canAdmit(p)).toBe(true);
  f.values.set(rk(), receipt(p, n, 6)); expect(await f.repo.canAdmit(p)).toBe(false); expect(await f.repo.resolve(guard(), 8)).toBe(false);
  expect(await f.repo.resolve(guard(), 10)).toBe(true); expect(await f.repo.canAdmit(p)).toBe(true);
});
