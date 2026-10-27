// Actual same-owner SQLite transactions; bridge faults remain synthetic.
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { setup, protectedArchive, basic, disposeTransferFixtures } from "./installationTransferTestFixture";
import { decodeTransferCodeUnits, encodeTransferCodeUnits } from "../installationTransferCodeUnits";
import type { TransferPairingOptions } from "../installationTransferPairing";
import { createHash } from "node:crypto";
const owners: { close(): Promise<unknown> }[] = [];
beforeEach(() => vi.resetModules());
afterEach(async () => { for (const owner of owners.splice(0)) await owner.close(); await disposeTransferFixtures(); vi.restoreAllMocks(); vi.unstubAllGlobals(); });
const p = "10000000-0000-4000-8000-000000000001", q = "20000000-0000-4000-8000-000000000002", nonce = "30000000-0000-4000-8000-000000000003";
const guardKey = `curling.identity.accountDeletionGuard.${q}.v1`;
const guardRaw = JSON.stringify({ schemaVersion: 1, profileId: q, nonce, revision: 4 });
const identity = "curling.identity.trustedDevice.v1";
function deferred() { let resolve!: (value?: unknown) => void; const promise = new Promise<unknown>(r => { resolve = r; }); return { promise, resolve }; }
const pause = () => new Promise(r => setTimeout(r, 5));
async function fixture(existing?: { sql: Awaited<ReturnType<typeof setup>>; values: Map<string, string> }, old = false) {
  const sql = existing?.sql ?? await setup(), values = existing?.values ?? new Map<string, string>();
  const binding = {
    failedWriteMayLosePreviousValue: false, configure: async () => {},
    inventory: async () => ({ kind: "complete", keys: [...values.keys()].sort() }),
    read: async (key: string) => values.has(key) ? { kind: "value", value: values.get(key) } : { kind: "established_absent" },
    write: async (key: string, raw: string) => { values.set(key, raw); },
    remove: async (key: string) => ({ kind: values.delete(key) ? "deleted" : "nothing_to_delete" }),
  };
  const implementation = await import("../installationTransferPairing");
  const options: TransferPairingOptions = { sqlite: sql.options, protectedBinding: binding, providerConfigIdentity: "pc1:synthetic", sessionStorageKey: "sb-synthetic-auth-token", detectPlatform: () => "ios" };
  const create = (input = options) => { const owner = old ? implementation.createInstallationTransferIdentityOwner(input) : implementation.createInstallationTransferHostOwner(input, () => false); owners.push(owner); return owner; };
  return { sql, values, options, create, owner: create(), implementation };
}
async function runtime(raws: Record<string, string> = { ...basic(), [guardKey]: guardRaw }) {
  const f = await fixture(), archive = await protectedArchive(raws);
  expect(await f.owner.pair(archive.protectedWire, archive.recoveryCode)).toMatchObject({ code: "paired", mayIssue: false, mayPublish: false, mayMount: false });
  const pair = await f.owner.handoff(); expect(pair).not.toBeNull(); return { ...f, archive, pair: pair! };
}
async function sourceRow(sql: Awaited<ReturnType<typeof setup>>) {
  const raw = await sql.raw({ kind: "query", sql: "SELECT package_digest,projection_ascii,projection_digest FROM installation_transfer_source_denial_v1" }) as { values: { package_digest: string; projection_ascii: string; projection_digest: string }[] };
  expect(raw.values).toHaveLength(1); return raw.values[0];
}
it("persists exact negative-only source facts atomically and keeps destination identity private", async () => {
  const f = await runtime(), row = await sourceRow(f.sql);
  const facts = JSON.parse(decodeTransferCodeUnits(row.projection_ascii));
  expect(facts.sportingProfiles).toEqual([p]); expect(facts.guards).toEqual([{ profileId: q, nonce, revision: 4, fencedRevision: null }]);
  expect(facts.preflight).toEqual({ kind: "no_barrier" }); expect(row.package_digest).toBe(f.archive.packageDigest);
  const objects = await f.sql.raw({ kind: "query", sql: "SELECT name FROM sqlite_master" }) as { values: { name: string }[] };
  expect(objects.values).toHaveLength(8); expect(objects.values.some(r => r.name === "records")).toBe(false);
  expect(await f.pair.domain.get(guardKey)).toEqual({ status: "value", value: null });
  for (const key of ["installation_transfer_source_denial_v1", `curling.sporting.profile.v1.${p}.curling-release-tracker-assessment-show-introduction`]) expect(await f.pair.domain.get(key)).toMatchObject({ status: "read_failed" });
  expect(await f.pair.domain.set(identity, "destination")).toEqual({ ok: true }); expect(await f.pair.domain.remove(identity)).toEqual({ ok: true });
  expect(await sourceRow(f.sql)).toEqual(row);
  const inserts = f.sql.trace.filter(e => e.sql?.startsWith("INSERT INTO installation_transfer_source_denial")); expect(inserts).toHaveLength(1); expect(inserts[0].transaction).toBe(false);
  expect(f.sql.trace.some(e => e.sql?.startsWith("UPDATE installation_transfer_source_denial") || e.sql?.startsWith("DELETE FROM installation_transfer_source_denial"))).toBe(false);
});
it("cold requires actual same archive/code before its exact existing projection enables runtime", async () => {
  const f = await runtime(); await f.pair.domain.set(identity, "destination"); const row = await sourceRow(f.sql); expect(await f.owner.close()).toMatchObject({ code: "closed" });
  const cold = f.create(); expect(await cold.inspect()).toMatchObject({ code: "paired_unverified" }); expect(await cold.handoff()).toBeNull();
  expect(await cold.pair(f.archive.protectedWire, "ct1-" + "a".repeat(43))).toMatchObject({ code: "archive_refused" }); expect(await cold.handoff()).toBeNull();
  expect(await cold.pair(f.archive.protectedWire, f.archive.recoveryCode)).toMatchObject({ code: "paired" });
  const pair = await cold.handoff(); expect(pair).not.toBeNull(); expect(await pair!.domain.get(identity)).toEqual({ status: "value", value: "destination" });
  expect(await sourceRow(f.sql)).toEqual(row); expect(f.sql.trace.filter(e => e.sql?.startsWith("INSERT INTO installation_transfer_source_denial"))).toHaveLength(1);
});
it("preserves outstanding source cleanup through destination writes and actual cold revalidation", async () => {
  const cleanupKey = "curling.identity.intentCleanup.v1", recordedAt = "2026-10-26T12:00:00.000Z";
  const raw = JSON.stringify({ schemaVersion: 1, recordedAt });
  const f = await runtime({ ...basic(), [guardKey]: guardRaw, [cleanupKey]: raw });
  const row = await sourceRow(f.sql);
  expect(JSON.parse(decodeTransferCodeUnits(row.projection_ascii))).toMatchObject({ schemaVersion: 2, intentCleanup: { kind: "outstanding", recordedAt } });
  expect(await f.pair.domain.get(cleanupKey)).toEqual({ status: "value", value: null });
  expect(await f.pair.domain.set(identity, "destination")).toEqual({ ok: true });
  expect(await sourceRow(f.sql)).toEqual(row);
  expect(await f.owner.close()).toMatchObject({ code: "closed" });
  const cold = f.create(); expect(await cold.pair(f.archive.protectedWire, f.archive.recoveryCode)).toMatchObject({ code: "paired" });
  const pair = await cold.handoff(); expect(pair).not.toBeNull();
  expect(await pair!.domain.get(cleanupKey)).toEqual({ status: "value", value: null });
  expect(await pair!.domain.get(identity)).toEqual({ status: "value", value: "destination" });
  expect(await sourceRow(f.sql)).toEqual(row);
  expect(f.sql.trace.some(e => e.sql?.startsWith("DELETE FROM installation_transfer_source_denial") || e.sql?.startsWith("UPDATE installation_transfer_source_denial"))).toBe(false);
});
it("refuses a genuine prior canonical v1 target without changing any rows or protected values", async () => {
  const f = await runtime(); await f.pair.domain.set(identity, "destination"); await f.owner.close();
  await f.sql.raw({ kind: "open" });
  const row = await sourceRow(f.sql), facts = JSON.parse(decodeTransferCodeUnits(row.projection_ascii));
  const legacy = { schemaVersion: 1, packageDigest: facts.packageDigest, sportingProfiles: facts.sportingProfiles, preflight: facts.preflight, guards: facts.guards };
  const ascii = encodeTransferCodeUnits(JSON.stringify(legacy));
  const digest = createHash("sha256").update(JSON.stringify(["installation-source-denial/v1", row.package_digest, ascii]), "utf8").digest("hex");
  await f.sql.raw({ kind: "run", sql: "UPDATE installation_transfer_source_denial_v1 SET projection_ascii=?,projection_digest=?", values: [ascii, digest] });
  const dump = async () => {
    const schema = await f.sql.raw({ kind: "query", sql: "SELECT name,sql FROM sqlite_master ORDER BY name" }) as { values: { name: string; sql: string | null }[] };
    const rows: unknown[] = [];
    for (const object of schema.values) if (!object.name.startsWith("sqlite_")) rows.push(await f.sql.raw({ kind: "query", sql: "SELECT * FROM " + object.name }));
    return { schema, rows };
  };
  const before = await dump(), protectedBefore = [...f.values.entries()].sort();
  await f.sql.raw({ kind: "close" }); const at = f.sql.trace.length;
  const cold = f.create();
  expect(await cold.pair(f.archive.protectedWire, f.archive.recoveryCode)).not.toMatchObject({ code: "paired" });
  expect(await cold.handoff()).toBeNull();
  expect(f.sql.trace.slice(at).some(e => e.kind === "run" || e.kind === "execute" || e.kind === "begin")).toBe(false);
  expect([...f.values.entries()].sort()).toEqual(protectedBefore);
  await f.sql.raw({ kind: "open" }); expect(await dump()).toEqual(before); await f.sql.raw({ kind: "close" });
});
it("upgrades genuine old seven-object identity only after current archive/code proof", async () => {
  const old = await fixture(undefined, true), a = await protectedArchive({ ...basic(), [guardKey]: guardRaw });
  expect(await old.owner.pair(a.protectedWire, a.recoveryCode)).toMatchObject({ code: "paired" }); const previous = await old.owner.handoff(); expect(previous).not.toBeNull(); await previous!.domain.set(identity, "destination");
  expect(await old.owner.close()).toMatchObject({ code: "closed" });
  const next = await fixture({ sql: old.sql, values: old.values });
  expect(await next.owner.inspect()).toMatchObject({ code: "paired_unverified" }); expect(await next.owner.handoff()).toBeNull();
  expect(await next.owner.pair(a.protectedWire, a.recoveryCode)).toMatchObject({ code: "paired" }); const pair = await next.owner.handoff(); expect(pair).not.toBeNull();
  expect(await pair!.domain.get(identity)).toEqual({ status: "value", value: "destination" }); expect(JSON.parse(decodeTransferCodeUnits((await sourceRow(old.sql)).projection_ascii)).guards[0].nonce).toBe(nonce);
});
it.each(["pair_only", "old_identity", "ordinary"])("existing %s factories refuse the new private layout", async mode => {
  const f = await runtime(); await f.owner.close();
  if (mode === "ordinary") {
    const implementation = await import("../nativeSqliteAdapter"); const store = implementation.createNativeSqliteStore(f.sql.options); expect(await store.adapter.get(identity)).toMatchObject({ status: "read_failed" }); await store.close();
  } else {
    const owner = mode === "pair_only" ? f.implementation.createInstallationTransferPairing(f.options) : f.implementation.createInstallationTransferIdentityOwner(f.options); owners.push(owner);
    expect(await owner.pair(f.archive.protectedWire, f.archive.recoveryCode)).not.toMatchObject({ code: "paired" });
  }
});
it.each(["ascii", "digest", "package", "missing", "extra_table", "noncanonical", "missing_cleanup", "changed_cleanup"])("holds warm %s drift with no projection repair or further identity write", async field => {
  const f = await runtime(), before = await sourceRow(f.sql);
  if (field === "ascii") { const facts = JSON.parse(decodeTransferCodeUnits(before.projection_ascii)); facts.guards[0].revision++; await f.sql.raw({ kind: "run", sql: "UPDATE installation_transfer_source_denial_v1 SET projection_ascii=?", values: [encodeTransferCodeUnits(JSON.stringify(facts))] }); }
  if (field === "digest") await f.sql.raw({ kind: "execute", sql: "UPDATE installation_transfer_source_denial_v1 SET projection_digest='" + "a".repeat(64) + "'" });
  if (field === "package") await f.sql.raw({ kind: "execute", sql: "UPDATE installation_transfer_source_denial_v1 SET package_digest='" + "a".repeat(64) + "'" });
  if (field === "missing") await f.sql.raw({ kind: "execute", sql: "DELETE FROM installation_transfer_source_denial_v1" });
  if (field === "extra_table") await f.sql.raw({ kind: "execute", sql: "CREATE TABLE foreign_data (x TEXT)" });
  if (field === "noncanonical") await f.sql.raw({ kind: "run", sql: "UPDATE installation_transfer_source_denial_v1 SET projection_ascii=?", values: [encodeTransferCodeUnits(decodeTransferCodeUnits(before.projection_ascii) + " ")] });
  if (field === "missing_cleanup" || field === "changed_cleanup") {
    const facts = JSON.parse(decodeTransferCodeUnits(before.projection_ascii));
    if (field === "missing_cleanup") delete facts.intentCleanup;
    else facts.intentCleanup = { kind: "outstanding", recordedAt: "2026-10-26T12:00:00.000Z" };
    await f.sql.raw({ kind: "run", sql: "UPDATE installation_transfer_source_denial_v1 SET projection_ascii=?", values: [encodeTransferCodeUnits(JSON.stringify(facts))] });
  }
  const n = f.sql.trace.filter(e => e.sql?.startsWith("INSERT INTO installation_transfer_identity")).length;
  expect(await f.pair.domain.set(identity, "denied")).toMatchObject({ ok: false }); expect(f.pair.health().domain).toBe("failed");
  expect(f.sql.trace.filter(e => e.sql?.startsWith("INSERT INTO installation_transfer_identity"))).toHaveLength(n);
  expect(await f.owner.close()).toMatchObject({ code: "fault_held" });
  const namespace = await import("../nativeCredentialNamespace"); expect(namespace.ordinaryCredentialNamespaceAvailable()).toBe(false);
  const native = await import("../nativeSqliteAdapter"), contender = native.createNativeCombinedHeldSqliteHost(f.sql.options); expect((await contender.acquire()).ok).toBe(false);
});
it("cold canonical foreign bytes/hash are structural data and cannot be adopted as authentic", async () => {
  const f = await runtime(), row = await sourceRow(f.sql); await f.owner.close();
  await f.sql.raw({ kind: "open" }); await f.sql.raw({ kind: "run", sql: "UPDATE installation_transfer_source_denial_v1 SET projection_digest=?", values: ["a".repeat(64)] }); await f.sql.raw({ kind: "close" });
  const cold = f.create(); expect(await cold.inspect()).toMatchObject({ code: "paired_unverified" });
  expect(await cold.pair(f.archive.protectedWire, f.archive.recoveryCode)).toMatchObject({ code: "paired" }); expect(await cold.handoff()).toBeNull();
  const foreign = await sourceRow(f.sql); expect(foreign.projection_ascii).toBe(row.projection_ascii); expect(foreign.projection_digest).toBe("a".repeat(64));
  expect(await cold.close()).toMatchObject({ code: "fault_held" });
});
for (const phase of ["begin", "run", "commit"] as const) for (const effect of [false, true]) it(`settles projection ${phase} loss after actual effect=${effect} using fresh durable evidence`, async () => {
  const f = await fixture(), a = await protectedArchive(basic()); expect(await f.owner.pair(a.protectedWire, a.recoveryCode)).toMatchObject({ code: "paired" });
  let projection = false, triggered = false;
  f.sql.faults.hook = async (event, next) => {
    if (event.sql?.startsWith("CREATE TABLE installation_transfer_source_denial")) projection = true;
    // BEGIN is before its DDL, so target the second handoff BEGIN (identity then projection).
    if (event.kind === "begin") begins++;
    const hit = phase === "begin" ? event.kind === "begin" && begins === 2 : phase === "run" ? event.sql?.startsWith("INSERT INTO installation_transfer_source_denial") : projection && event.kind === "commit";
    if (!triggered && hit) { triggered = true; if (effect) await next(); throw Error("Synthetic unknown outcome"); }
    return next();
  };
  let begins = 0;
  const pair = await f.owner.handoff(); expect(triggered).toBe(true);
  if (phase === "commit" && effect) { expect(pair).not.toBeNull(); expect(await sourceRow(f.sql)).toBeDefined(); }
  else expect(pair).toBeNull();
  f.sql.faults.hook = undefined;
  if (pair) expect(await f.owner.close()).toMatchObject({ code: "closed" });
});
it("rejects a forged projection handle before native reads or runtime preparation", async () => {
  const { createInstallationTransferSourceIdentitySql } = await import("../installationTransferQuarantineSql"), f = await setup();
  const sql = createInstallationTransferSourceIdentitySql(f.options, () => false);
  expect(await sql.initializeSourceDenial({}, () => true)).toBe("target_conflict"); expect(f.trace).toEqual([]); expect(await sql.close()).toBe("closed");
});
for (const name of ["beginTransaction", "execute", "run", "commitTransaction", "rollbackTransaction"] as const) it(`retains malformed acquired ${name} before later transaction methods or BEGIN`, async () => {
  const f = await fixture(), a = await protectedArchive(basic()), connection = await f.sql.options.engine.createConnection("");
  const hold = deferred(), acquired = deferred(); let armed = false, later = 0;
  const original = Object.getOwnPropertyDescriptor(connection, name)!;
  // Arm only at the transaction-method acquisition after opening configuration.
  const engine = { ...f.sql.options.engine, createConnection: async () => new Proxy(connection, { getOwnPropertyDescriptor(target, key) {
    if (key === name && armed) { acquired.resolve(); return { configurable: true, value: hold.promise }; }
    if (armed && laterNames.includes(String(key))) later++; return Reflect.getOwnPropertyDescriptor(target, key);
  } }) };
  const order = ["beginTransaction", "execute", "run", "commitTransaction", "rollbackTransaction"], laterNames = order.slice(order.indexOf(name) + 1);
  const owner = f.create({ ...f.options, sqlite: { ...f.sql.options, engine } });
  f.sql.faults.hook = async (event, next) => { const result = await next(); if (event.sql === "PRAGMA synchronous = FULL;") armed = true; return result; };
  let done = false; const pairing = owner.pair(a.protectedWire, a.recoveryCode).then(r => { done = true; return r; });
  await acquired.promise; await pause();
  const before = f.sql.trace.length; const closing = owner.close(); let closed = false; void closing.then(() => { closed = true; }); await pause();
  try { expect(done).toBe(false); expect(closed).toBe(false); expect(later).toBe(0); expect(f.sql.trace.some(e => e.kind === "begin")).toBe(false); expect(f.sql.trace).toHaveLength(before); }
  finally { armed = false; Object.defineProperty(connection, name, original); hold.resolve(); await pairing; await closing; }
});
it("drains malformed projection statement metadata before captured rollback and cleanup", async () => {
  const f = await fixture(), a = await protectedArchive(basic()); await f.owner.pair(a.protectedWire, a.recoveryCode);
  const hold = deferred(), entered = deferred();
  f.sql.faults.hook = async (event, next) => {
    const value = await next();
    if (event.sql?.startsWith("INSERT INTO installation_transfer_source_denial")) { entered.resolve(); return { changes: { changes: hold.promise, lastId: 1, values: [] } }; }
    return value;
  };
  const op = f.owner.handoff(); await entered.promise; const at = f.sql.trace.length; let done = false; void op.then(() => { done = true; }); await pause();
  try { expect(done).toBe(false); expect(f.sql.trace).toHaveLength(at); }
  finally { hold.resolve(); expect(await op).toBeNull(); }
  expect(f.sql.trace.slice(at).some(e => e.kind === "rollback")).toBe(true);
});
it("keeps a late positive created connection for physical cancellation cleanup", async () => {
  const f = await fixture(), a = await protectedArchive(basic()), connection = await f.sql.options.engine.createConnection(""), hold = deferred(), at = deferred();
  f.sql.options.engine.createConnection = async () => { at.resolve(); await hold.promise; return connection; };
  const op = f.owner.pair(a.protectedWire, a.recoveryCode); await at.promise; const close = f.owner.close(); hold.resolve();
  expect(await op).toMatchObject({ code: "closed" }); expect(await close).toMatchObject({ code: "closed" });
  expect(f.sql.trace.filter(e => e.kind === "close").length).toBeGreaterThanOrEqual(2); expect(f.sql.trace.some(e => e.kind === "open")).toBe(false);
});
for (let transaction = 1; transaction <= 6; transaction++) it(`retains an acquired invalid method that synchronously closes its owner at bootstrap transaction ${transaction}`, async () => {
  const f = await fixture(), a = await protectedArchive(basic()), connection = await f.sql.options.engine.createConnection("");
  const hold = deferred(), at = deferred(); let count = 0, closing: Promise<unknown> | null = null;
  const engine = { ...f.sql.options.engine, createConnection: async () => new Proxy(connection, { getOwnPropertyDescriptor(target, name) {
    if (name === "beginTransaction" && ++count === transaction) { closing = owner.close(); at.resolve(); return { configurable: true, value: hold.promise }; }
    return Reflect.getOwnPropertyDescriptor(target, name);
  } }) };
  const owner = f.create({ ...f.options, sqlite: { ...f.sql.options, engine } });
  let op: Promise<unknown>;
  if (transaction <= 4) op = owner.pair(a.protectedWire, a.recoveryCode);
  else { expect(await owner.pair(a.protectedWire, a.recoveryCode)).toMatchObject({ code: "paired" }); op = owner.handoff(); }
  let done = false; void op.then(() => { done = true; }); await at.promise; let closed = false; void closing!.then(() => { closed = true; }); await pause();
  const issued = f.sql.trace.filter(e => e.kind === "begin").length;
  try { expect(done).toBe(false); expect(closed).toBe(false); expect(issued).toBe(transaction - 1); }
  finally { hold.resolve(); await op; await closing; }
});
it.each(["missing", "overlimit", "changed_schema"])("preserves cold %s evidence instead of rebuilding the source table", async mode => {
  const f = await runtime(); await f.owner.close(); await f.sql.raw({ kind: "open" });
  if (mode === "missing") await f.sql.raw({ kind: "execute", sql: "DELETE FROM installation_transfer_source_denial_v1" });
  if (mode === "overlimit") await f.sql.raw({ kind: "run", sql: "UPDATE installation_transfer_source_denial_v1 SET projection_ascii=?", values: ["u16:" + "0".repeat(4 * 1048576 + 4)] });
  if (mode === "changed_schema") await f.sql.raw({ kind: "execute", sql: "ALTER TABLE installation_transfer_source_denial_v1 ADD COLUMN extra TEXT" });
  await f.sql.raw({ kind: "close" }); const before = f.sql.trace.filter(e => e.sql?.startsWith("INSERT INTO installation_transfer_source_denial")).length;
  const cold = f.create(); expect(await cold.pair(f.archive.protectedWire, f.archive.recoveryCode)).not.toMatchObject({ code: "paired" }); expect(await cold.handoff()).toBeNull();
  expect(f.sql.trace.filter(e => e.sql?.startsWith("INSERT INTO installation_transfer_source_denial"))).toHaveLength(before);
});
it("uses captured rollback with the original receiver after statement failure", async () => {
  const f = await fixture(), a = await protectedArchive(basic()), c = await f.sql.options.engine.createConnection(""), rollback = c.rollbackTransaction;
  const later = vi.fn(() => { throw Error("late rollback lookup forbidden"); });
  f.sql.faults.hook = async (event, next) => {
    if (event.sql?.startsWith("INSERT INTO installation_transfer_quarantine")) { Object.defineProperty(c, "rollbackTransaction", { configurable: true, get: later }); throw Error("synthetic statement failure"); }
    return next();
  };
  const op = f.owner.pair(a.protectedWire, a.recoveryCode);
  try { expect(await op).not.toMatchObject({ code: "paired" }); expect(later).not.toHaveBeenCalled(); expect(f.sql.trace.some(e => e.kind === "rollback")).toBe(true); }
  finally { Object.defineProperty(c, "rollbackTransaction", { configurable: true, writable: true, value: rollback }); }
});
it("observes a reused transaction object freshly instead of reusing an earlier ACK", async () => {
  const f = await fixture(), a = await protectedArchive(basic()), c = await f.sql.options.engine.createConnection("");
  const begin = c.beginTransaction, commit = c.commitTransaction, hold = deferred(), at = deferred();
  let armed = false, used = false;
  const shared = Object.assign(Object.create({ get then() { return armed ? (yes: (value: unknown) => void, no: (reason: unknown) => void) => { at.resolve(); void hold.promise.then(() => Reflect.apply(commit, c, [])).then(yes, no); } : undefined; } }), { changes: { changes: 0 } });
  c.beginTransaction = async () => { await Reflect.apply(begin, c, []); return shared; };
  // Return the original shared thenable directly; async return would assimilate it
  // before the actual SQL observer sees this issuance.
  c.commitTransaction = (() => { if (used) return Reflect.apply(commit, c, []); used = true; armed = true; return shared; }) as never;
  let done = false; const op = f.owner.pair(a.protectedWire, a.recoveryCode).then(r => { done = true; return r; }); await at.promise; await pause();
  try { expect(done).toBe(false); expect(f.sql.trace.filter(e => e.kind === "close")).toHaveLength(0); }
  finally { hold.resolve(); c.beginTransaction = begin; c.commitTransaction = commit; await op; }
  expect(f.sql.trace.filter(e => e.kind === "rollback")).toHaveLength(0);
});
it("source-only core drains a masked Promise engine and refuses its fulfillment as construction input", async () => {
  const f = await fixture(), a = await protectedArchive(basic()), hold = deferred(), at = deferred();
  const create = vi.fn(f.sql.options.engine.createConnection);
  const actual = { ...f.sql.options.engine, createConnection: create };
  const engine = new Promise(resolve => { void hold.promise.then(() => resolve(actual)); });
  Object.defineProperty(engine, "constructor", { value: { get [Symbol.species]() { at.resolve(); return Promise; } } });
  Object.defineProperty(engine, "then", { value: null }); Object.assign(engine, actual);
  const owner = f.create({ ...f.options, sqlite: { ...f.sql.options, engine: engine as never } });
  let done = false; const op = owner.pair(a.protectedWire, a.recoveryCode).then(value => { done = true; return value; }); await at.promise;
  const closing = owner.close(); let closed = false; void closing.then(() => { closed = true; }); await pause();
  try { expect(done).toBe(false); expect(closed).toBe(false); expect(create).not.toHaveBeenCalled(); expect(f.sql.trace).toEqual([]); }
  finally { hold.resolve(); await op; await closing; }
  expect(create).not.toHaveBeenCalled(); expect(f.sql.trace.some(e => e.kind === "open")).toBe(false);
});

for(const kind of ["set","remove","get"] as const)it(`excludes exact actual public source domain ${kind} completion from its native query`,async()=>{
 const f=await runtime(),c=await f.sql.options.engine.createConnection(""),query=c.query;let entered=false,pending:Promise<unknown>|null=null;
 c.query=(()=>{entered=true;return pending;}) as never;
 pending=kind==="set"?f.pair.domain.set(identity,"synthetic"):kind==="remove"?f.pair.domain.remove(identity):f.pair.domain.get(identity);
 const result=await Promise.race([pending,new Promise(resolve=>setTimeout(()=>resolve(null),700))]);
 c.query=query;if(result===null)owners.splice(owners.indexOf(f.owner),1);
 expect(entered).toBe(true);expect(result).not.toBeNull();if(result!==null)await f.owner.close();
});
