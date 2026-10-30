// Installed SDK + actual disposable SQLite. Only platform/protected/API edges synthetic.
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { expect, it, vi } from "vitest";
import { fixture, onboard, profileId, server, deferred, facts, response } from "./nativeTrackerFixture";
import { createNewSession } from "../../sessionMigration";
import { NEW_USER_CREDENTIAL_CONTRACT, parseQ, parseM } from "../../persistence/credentialProtocol";
import { isPlatformCredentialFingerprint } from "../../persistence/platformCredentialFingerprint";
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function make(h: Fixture) {
  const config = await import("../nativeProviderConfiguration"), prepared = await config.prepareNativeProviderConfiguration(h.options.config);
  if (!prepared.ok) throw Error("Synthetic configuration unavailable");
  const result = await h.module.createConfiguredNewUserNativeSportingIdentityHost(prepared.value, { ...h.options,
    callbackUrlAccess: { readCurrentUrl: () => "https://app.example.invalid/", replaceCurrentUrl: () => {} } });
  expect(result.ok).toBe(true); if (!result.ok) throw Error(result.reason);
  return result.host;
}
async function rawRows(h: Fixture) {
  return await h.raw({ kind: "query", sql: "SELECT key,value FROM records ORDER BY key" }) as { values: { key: string; value: string }[] };
}
it("is inert, atomically creates tagged schema+Q, and runs actual OTP/onboarding/Profile save/reload", async () => {
  const h = await fixture(), events = h.events.length, trace = h.trace.length, host = await make(h);
  expect(h.events).toHaveLength(events); expect(h.trace).toHaveLength(trace); expect(h.fetch).not.toHaveBeenCalled();
  let firstCommit: unknown;
  h.sqlFaults.hook = async (event, next) => { const result = await next(); if (event.kind === "commit" && firstCommit === undefined) firstCommit = await h.raw({ kind: "query", sql: "SELECT slot,value FROM curling_credential_meta ORDER BY slot" }); return result; };
  try {
    const started = await host.start(); expect(started).toMatchObject({ outcome: "ready" }); if (started.outcome !== "ready") throw null;
    const qRaw = (firstCommit as { values: { slot: string; value: string }[] }).values.find(row => row.slot === "q")!.value;
    expect(parseQ(qRaw).ok).toBe(false); expect(parseQ(qRaw, NEW_USER_CREDENTIAL_CONTRACT)).toMatchObject({ ok: true, value: { phase: "intent", initialEntryKeys: [] } });
    const runtime = started.runtime; expect(runtime.createLocalSportingScope(profileId)).toBeNull();
    await onboard(h, runtime); const scope = runtime.createLocalSportingScope(profileId)!; expect(scope).not.toBeNull();
    expect(runtime.createLocalSportingScope("99999999-9999-4999-8999-999999999999")).toBeNull();
    const session = createNewSession(); session.title = "Synthetic new-user session";
    expect(await scope.repositories.session.saveCurrent(session)).toEqual({ ok: true });
    expect(await scope.repositories.session.loadCurrent()).toMatchObject({ status: "value", value: { id: session.id, title: session.title } });
    for (const raw of h.values.values()) expect(JSON.parse(raw).sdkContractVersion).toBe(NEW_USER_CREDENTIAL_CONTRACT);
    expect(h.source.writes).toEqual([]); expect(h.source.map.size).toBe(0);
  } finally { await host.dispose(); }
});
for (const key of ["curling-release-tracker-session-history", "curling.identity.barrier.v1", "curling.sporting.profile.v1.not-a-uuid.unknown", "unknown.namespace", "sb-other-auth-token"]) it(`refuses populated/unknown source ${key} without copying or removing`, async () => {
  const h = await fixture(); h.source.map.set(key, "SYNTHETIC_PRIVATE_SOURCE"); const before = [...h.source.map], host = await make(h);
  try {
    expect(await host.start()).toEqual({ outcome: "waiting", code: "migration_blocked" });
    expect(h.fetch).not.toHaveBeenCalled(); expect(h.values.size).toBe(0); expect([...h.source.map]).toEqual(before); expect(h.source.writes).toEqual([]);
    expect(h.source.valueReads).not.toContain(key);
    expect(h.trace.some(event => event.kind === "begin" || event.kind === "run" || (event.kind === "execute" && event.sql?.startsWith("CREATE TABLE")))).toBe(false);
  } finally { await host.dispose(); }
});
it("reopens a tagged native pair without ANY legacy access after actual training writes", async () => {
  const h = await fixture(), host = await make(h); const started = await host.start(); expect(started.outcome).toBe("ready"); if (started.outcome !== "ready") throw null;
  await onboard(h, started.runtime); const session = createNewSession(); session.title = "Synthetic retained";
  expect(await started.runtime.createLocalSportingScope(profileId)!.repositories.session.saveCurrent(session)).toEqual({ ok: true });
  expect(await host.dispose()).toEqual({ ok: true });
  vi.resetModules(); h.module = await import("../supabaseAuthService");
  const trap = vi.fn(() => { throw Error("Synthetic source must never be consulted"); }); vi.stubGlobal("localStorage", new Proxy({}, { get: trap }));
  const next = await make(h); server(h, true);
  try {
    const open = await next.start(); expect(open.outcome).toBe("ready"); if (open.outcome !== "ready") throw null;
    expect((await open.runtime.startUpOnce()).verdict.kind).toBe("ready_online");
    expect(await open.runtime.createLocalSportingScope(profileId)!.repositories.session.loadCurrent()).toMatchObject({ status: "value", value: { id: session.id } });
    expect(trap).not.toHaveBeenCalled();
  } finally { await next.dispose(); }
});
it("keeps tagged manifest validation closed to the legacy parser", async () => {
  const h = await fixture(), host = await make(h);
  try {
    expect((await host.start()).outcome).toBe("ready"); const raw = [...h.values.values()][0];
    expect(parseM(raw, isPlatformCredentialFingerprint).ok).toBe(false);
    expect(parseM(raw, isPlatformCredentialFingerprint, NEW_USER_CREDENTIAL_CONTRACT)).toMatchObject({ ok: true, value: { items: [] } });
    expect((await rawRows(h)).values).toHaveLength(1);
  } finally { await host.dispose(); }
});
for (const failure of ["enumeration", "marker_read", "malformed_length", "changing_names", "hidden_provider"] as const) it(`never treats ${failure} as empty`, async () => {
  const h = await fixture();
  if (failure === "enumeration") h.source.faults.lengthThrows = true;
  if (failure === "marker_read") h.source.faults.getItemThrows = key => key === "curling.nativeMigration.sourceMarker.v1";
  if (failure === "malformed_length") Object.defineProperty(h.source, "length", { value: NaN });
  if (failure === "changing_names") { h.source.map.set("curling-performance-public-exercise-diagram-v1.synthetic", "CACHE"); h.source.faults.mutateBetweenPasses = storage => { storage.map.set("unknown.added", "SYNTHETIC"); }; }
  if (failure === "hidden_provider") h.source.faults.beforeGetItem = (key, storage) => { if (key.startsWith("sb-")) storage.map.set(key, "SYNTHETIC_UNLISTED"); };
  const host = await make(h);
  try {
    expect((await host.start()).outcome).toBe("waiting"); expect(h.fetch).not.toHaveBeenCalled(); expect(h.values.size).toBe(0);
    expect(h.trace.filter(event => event.kind === "begin")).toEqual([]); expect(h.source.writes).toEqual([]);
  } finally { await host.dispose(); }
});
for (const stage of ["begin", "schema", "q", "after_read"] as const) it(`refuses source additions during actual ${stage} work without copying/deleting`, async () => {
  const h = await fixture(); let added = false;
  h.sqlFaults.hook = async (event, next) => {
    const result = await next();
    const hit = stage === "begin" ? event.kind === "begin" : stage === "schema" ? event.kind === "run" && event.values?.[0] === "schema" : stage === "q" ? event.kind === "run" && event.values?.[0] === "q" : event.kind === "query" && event.sql?.includes("slot = ?") && event.values?.[0] === "q";
    if (hit && !added) { added = true; h.source.map.set("curling-release-tracker-session-history", "SYNTHETIC_ADDITION"); }
    return result;
  };
  const host = await make(h);
  try {
    expect((await host.start()).outcome).toBe("waiting"); expect(added).toBe(true);
    expect(h.source.map.get("curling-release-tracker-session-history")).toBe("SYNTHETIC_ADDITION"); expect(h.source.writes).toEqual([]); expect(h.values.size).toBe(0); expect(h.fetch).not.toHaveBeenCalled();
    expect(h.trace.filter(event => event.kind === "commit")).toEqual([]);
  } finally { await host.dispose(); }
});
for (const failure of ["commit_applied", "commit_not_applied", "ddl_ack_lost"] as const) it(`retries ${failure} using actual reopen and before/after journal`, async () => {
  const h = await fixture(); let injected = false;
  h.sqlFaults.hook = async (event, next) => {
    if (!injected && (failure === "ddl_ack_lost" ? event.kind === "execute" && event.sql?.startsWith("CREATE TABLE") : event.kind === "commit")) {
      injected = true; if (failure !== "commit_not_applied") await next(); throw Error("Synthetic acknowledgement lost");
    }
    return next();
  };
  const host = await make(h);
  try {
    expect(await host.start()).toEqual({ outcome: "waiting", code: "recovery_required" }); expect(injected).toBe(true); expect(h.fetch).not.toHaveBeenCalled();
    const afterFailure = h.trace.length; expect((await host.start()).outcome).toBe("ready");
    expect(h.trace.slice(afterFailure).some(event => event.kind === "close")).toBe(true);
    if (failure.startsWith("commit")) expect(h.trace.filter(event => event.kind === "rollback")).toEqual([]);
  } finally { await host.dispose(); }
});
it("joins duplicate Start and Close drains an actual held bootstrap COMMIT, retaining its late fact", async () => {
  const h = await fixture(), entered = deferred<void>(), release = deferred<void>(); let held = false;
  h.sqlFaults.hook = async (event, next) => { const result = await next(); if (!held && event.kind === "commit") { held = true; entered.resolve(); await release.promise; } return result; };
  const host = await make(h), first = host.start(), second = host.start(); let disposed = false;
  try {
    await entered.promise; const close = host.dispose().then(result => { disposed = true; return result; });
    await Promise.resolve(); expect(disposed).toBe(false); expect(h.fetch).not.toHaveBeenCalled();
    release.resolve(); expect((await first).outcome).toBe("closed"); expect((await second).outcome).toBe("closed"); expect(await close).toEqual({ ok: false, reason: "evidence_held" });
    const meta = await h.raw({ kind: "query", sql: "SELECT slot,value FROM curling_credential_meta ORDER BY slot" }) as { values: { slot: string; value: string }[] };
    expect(meta.values.map(row => row.slot)).toEqual(["q", "schema"]); expect(h.trace.filter(event => event.kind === "commit")).toHaveLength(1); expect(h.trace.filter(event => event.kind === "rollback")).toEqual([]); expect(h.values.size).toBe(0);
  } finally { release.resolve(); await first; await second; await host.dispose(); }
});
it("retries every durable Q phase within the actual owner without registration or an archive", async () => {
  const h = await fixture(); Object.defineProperty(h.options.migration, "limits", { value: { ...h.options.migration.limits, protocolStepLimit: 1 } });
  const host = await make(h); const phases = new Set<string>();
  try {
    let ready = false;
    for (let attempt = 0; attempt < 12; attempt++) {
      const result = await host.start();
      const meta = await h.raw({ kind: "query", sql: "SELECT value FROM curling_credential_meta WHERE slot='q'" }) as { values: { value: string }[] };
      phases.add(JSON.parse(meta.values[0].value).phase);
      if (result.outcome === "ready") { ready = true; await onboard(h, result.runtime); break; }
      expect(result).toEqual({ outcome: "waiting", code: "migration_incomplete" });
    }
    expect(ready).toBe(true); expect([...phases]).toEqual(["intent", "manifest_confirmed", "copying", "credentials_verified", "bound"]);
  } finally { await host.dispose(); }
});
for (const residue of ["keychain_only", "sql_only", "schema_only", "foreign_item", "malformed_q", "untagged_bound"] as const) it(`refuses ${residue} without source fallback, adoption or repair`, async () => {
  const h = await fixture();
  if (residue === "untagged_bound") {
    const c = await import("../nativeProviderConfiguration"), prepared = await c.prepareNativeProviderConfiguration(h.options.config); if (!prepared.ok) throw null;
    const old = await h.module.createConfiguredNativeSportingIdentityHost(prepared.value, { ...h.options, callbackUrlAccess: { readCurrentUrl: () => "https://app.example.invalid/", replaceCurrentUrl: () => {} } }); if (!old.ok) throw null;
    expect((await old.host.start()).outcome).toBe("ready"); await old.host.dispose(); vi.resetModules(); h.module = await import("../supabaseAuthService");
  } else if (residue === "keychain_only" || residue === "foreign_item") h.values.set("unknown.synthetic.protected", "SYNTHETIC_ORPHAN");
  else {
    await h.raw({ kind: "open" });
    await h.raw({ kind: "execute", sql: "CREATE TABLE records (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL)" });
    if (residue === "sql_only") await h.raw({ kind: "run", sql: "INSERT INTO records VALUES (?,?)", values: ["unknown", "SYNTHETIC_ROW"] });
    else {
      await h.raw({ kind: "execute", sql: "CREATE TABLE curling_credential_meta (slot TEXT PRIMARY KEY NOT NULL CHECK(slot IN ('schema','q','f')), value TEXT NOT NULL)" });
      await h.raw({ kind: "run", sql: "INSERT INTO curling_credential_meta VALUES (?,?)", values: ["schema", '{"schemaVersion":1,"kind":"credential-cross-store-meta"}'] });
      if (residue === "malformed_q") await h.raw({ kind: "run", sql: "INSERT INTO curling_credential_meta VALUES (?,?)", values: ["q", "{}"] });
    }
    await h.raw({ kind: "close" });
  }
  const before = [...h.values], from = h.trace.length, eventFrom = h.events.length, host = await make(h);
  try {
    expect((await host.start()).outcome).toBe("waiting"); expect(h.fetch).not.toHaveBeenCalled(); expect([...h.values]).toEqual(before);
    // A bounded fault F may record an actually detected contradiction; no schema creation or data copy.
    expect(h.trace.slice(from).some(event => event.kind === "execute" && event.sql?.startsWith("CREATE TABLE"))).toBe(false);
    expect(h.events.slice(eventFrom).filter(event => event.kind === "remove" || event.kind === "write")).toEqual([]);
  } finally { await host.dispose(); }
});
async function childRun(h: Fixture, stateFile: string, changes: Record<string, unknown> = {}) {
  let data: Record<string, unknown>;
  try { data = JSON.parse(await readFile(stateFile, "utf8")); }
  catch { data = { syntheticOnly: true, parentPid: process.pid, file: path.join(h.options.migration.sqlite.databaseName, "synthetic.sqlite"), databaseName: h.options.migration.sqlite.databaseName, config: h.options.config, protectedValues: [...h.values], facts: facts(true) }; }
  await writeFile(stateFile, JSON.stringify({ ...data, ...changes }));
  await promisify(execFile)(process.execPath, [path.join(process.cwd(), "tests/native/newUserHostChild.mjs"), stateFile], { cwd: process.cwd(), timeout: 45000 });
  return JSON.parse(await readFile(stateFile, "utf8"));
}
it("genuinely new processes reopen the same tagged SQL/protected state and save/reload actual repository training", async () => {
  const h = await fixture(), host = await make(h), started = await host.start(); if (started.outcome !== "ready") throw null;
  await onboard(h, started.runtime); const session = createNewSession();
  expect(await started.runtime.createLocalSportingScope(profileId)!.repositories.session.saveCurrent(session)).toEqual({ ok: true }); await host.dispose();
  const file = path.join(h.options.migration.sqlite.databaseName, "child-state.json");
  const second = await childRun(h, file, { expectSession: session.id, writeSession: true });
  expect(second.result).toMatchObject({ legacyAccess: 0, startup: "ready_online", cleanup: { ok: true }, readSession: session.id });
  const third = await childRun(h, file, { expectSession: second.result.savedId, writeSession: false });
  expect(third.result).toMatchObject({ legacyAccess: 0, readSession: second.result.savedId });
  expect(new Set([process.pid, second.result.pid, third.result.pid]).size).toBe(3);
}, 60000);
for (const interrupt of ["before_commit", "after_commit", "after_manifest", "phase_manifest_confirmed", "phase_copying", "phase_credentials_verified", "phase_bound"] as const) it(`genuinely new process resumes actual process interruption ${interrupt} and later reopens source-free`, async () => {
  const h = await fixture(), file = path.join(h.options.migration.sqlite.databaseName, "interrupted-state.json");
  const first = await childRun(h, file, { interrupt, allowEmptySource: true }); expect(first.result.interrupted).toBe(interrupt);
  // The next real process uses the exact same SQL/protected state, with no module reset surrogate.
  const second = await childRun(h, file, { interrupt: null, freshOtp: true, writeSession: true });
  expect(second.result).toMatchObject({ startup: "signed_out", cleanup: { ok: true } });
  const third = await childRun(h, file, { freshOtp: false, allowEmptySource: false, writeSession: false, expectSession: second.result.savedId });
  expect(third.result).toMatchObject({ startup: "ready_online", legacyAccess: 0, readSession: second.result.savedId });
  expect(new Set([first.result.pid, second.result.pid, third.result.pid]).size).toBe(3);
}, 60000);
for (const change of ["project", "key", "slash"] as const) it(`cold process rejects changed ${change} without protected writes or fallback`, async () => {
  const h = await fixture(), host = await make(h); expect((await host.start()).outcome).toBe("ready"); await host.dispose();
  const file = path.join(h.options.migration.sqlite.databaseName, "changed-state.json"), before = [...h.values];
  const config = { ...h.options.config, ...(change === "project" ? { url: "https://other-new-user.supabase.invalid" } : change === "key" ? { publishableKey: "sb_publishable_SYNTHETIC_DIFFERENT" } : { url: h.options.config.url + "/" }) };
  const result = await childRun(h, file, { config, expectWaiting: true });
  expect(result.protectedValues).toEqual(before); expect(result.result.legacyAccess).toBe(0); expect(result.result.requests).toEqual([]);
}, 60000);
it("accepts only disposable diagram cache beside an empty source and never acquires retirement rights", async () => {
  const h = await fixture(), key = "curling-performance-public-exercise-diagram-v1.synthetic"; h.source.map.set(key, "SYNTHETIC_CACHE");
  const sourceModule = await import("../../persistence/localStorageAdapter"), source = sourceModule.createNativeNewUserWebViewSource(h.root);
  expect(sourceModule.acquireNativeCredentialRetirementSource(source)).toBeNull();
  const host = await make(h);
  try { expect((await host.start()).outcome).toBe("ready"); expect(h.source.valueReads).not.toContain(key); expect(h.source.map.get(key)).toBe("SYNTHETIC_CACHE"); expect(h.source.writes).toEqual([]); }
  finally { await host.dispose(); }
});
for (const edge of ["inventory", "read"] as const) it(`inaccessible protected ${edge} is never absence`, async () => {
  const h = await fixture(); h.faults.hook = async (event, next) => { if (event.kind === edge) throw Error("Synthetic protected unavailable"); return next(); };
  const host = await make(h);
  try { expect((await host.start()).outcome).toBe("waiting"); expect(h.fetch).not.toHaveBeenCalled(); expect(h.values.size).toBe(0); expect(h.trace.some(event => event.kind === "commit")).toBe(false); }
  finally { await host.dispose(); }
});
it("does not convert a changing source during held manifest creation into import or retirement", async () => {
  const h = await fixture(), entered = deferred<void>(), release = deferred<void>(); let once = false;
  h.faults.hook = async (event, next) => { const result = await next(); if (!once && event.kind === "write") { once = true; entered.resolve(); await release.promise; } return result; };
  const host = await make(h), start = host.start();
  try {
    await entered.promise; h.source.map.set(h.root, "SYNTHETIC_LATE_PROVIDER"); release.resolve();
    expect((await start).outcome).toBe("waiting"); expect(h.source.map.get(h.root)).toBe("SYNTHETIC_LATE_PROVIDER");
    expect(h.events.filter(event => event.kind === "remove")).toEqual([]); expect(h.source.writes).toEqual([]); expect(h.fetch).not.toHaveBeenCalled();
    expect([...h.values.values()].map(raw => JSON.parse(raw).items)).toEqual([[]]);
  } finally { release.resolve(); await start; await host.dispose(); }
});
it("Close drains held protected insertion and preserves its actual late empty manifest", async () => {
  const h = await fixture(), entered = deferred<void>(), release = deferred<void>(); let once = false;
  h.faults.hook = async (event, next) => { const result = await next(); if (!once && event.kind === "write") { once = true; entered.resolve(); await release.promise; } return result; };
  const host = await make(h), start = host.start();
  try {
    await entered.promise; let settled = false; const close = host.dispose().then(result => { settled = true; return result; }); await Promise.resolve(); expect(settled).toBe(false);
    release.resolve(); expect((await start).outcome).toBe("closed"); expect(await close).toEqual({ ok: false, reason: "evidence_held" });
    expect(h.values.size).toBe(1); expect(h.events.filter(event => event.kind === "remove")).toEqual([]); expect(h.fetch).not.toHaveBeenCalled();
  } finally { release.resolve(); await start; await host.dispose(); }
});
for (const mismatch of ["manifest_contract", "item_contract", "missing_manifest", "wrong_epoch"] as const) it(`genuine cold owner refuses ${mismatch} without source fallback`, async () => {
  const h = await fixture(), host = await make(h), started = await host.start(); if (started.outcome !== "ready") throw null;
  await onboard(h, started.runtime); await host.dispose(); const original = [...h.values];
  const manifestKey = original.find(([, value]) => Array.isArray(JSON.parse(value).fixedSlots))![0];
  const item = original.find(([, value]) => typeof JSON.parse(value).key === "string")!;
  if (mismatch === "missing_manifest") h.values.delete(manifestKey);
  else if (mismatch === "wrong_epoch") { const value = JSON.parse(item[1]); value.credentialEpochId = "99999999-9999-4999-8999-999999999999"; h.values.set(item[0], JSON.stringify(value)); }
  else { const key = mismatch === "manifest_contract" ? manifestKey : item[0]; const value = JSON.parse(h.values.get(key)!); value.sdkContractVersion = "auth-js/2.112.3:credential-v1"; h.values.set(key, JSON.stringify(value)); }
  const before = [...h.values]; vi.resetModules(); h.module = await import("../supabaseAuthService");
  const trap = vi.fn(() => { throw Error("Synthetic forbidden source fallback"); }); vi.stubGlobal("localStorage", new Proxy({}, { get: trap })); h.fetch.mockClear(); const next = await make(h);
  try { expect((await next.start()).outcome).toBe("waiting"); expect(h.fetch).not.toHaveBeenCalled(); expect(trap).not.toHaveBeenCalled(); expect([...h.values]).toEqual(before); }
  finally { await next.dispose(); }
});
it("the original configured host refuses tagged native stores instead of acquiring new-user rights", async () => {
  const h = await fixture(), host = await make(h); expect((await host.start()).outcome).toBe("ready"); await host.dispose(); vi.resetModules(); h.module = await import("../supabaseAuthService");
  const config = await import("../nativeProviderConfiguration"), prepared = await config.prepareNativeProviderConfiguration(h.options.config); if (!prepared.ok) throw null;
  const old = await h.module.createConfiguredNativeSportingIdentityHost(prepared.value, { ...h.options, callbackUrlAccess: { readCurrentUrl: () => "https://app.example.invalid/", replaceCurrentUrl: () => {} } }); if (!old.ok) throw null;
  try { expect((await old.host.start()).outcome).toBe("waiting"); expect(h.fetch).not.toHaveBeenCalled(); }
  finally { await old.host.dispose(); }
});
it("the existing installation-transfer parser rejects the new tag with its default legacy-only contract", async () => {
  const h = await fixture(); Object.defineProperty(h.options.migration, "limits", { value: { ...h.options.migration.limits, protocolStepLimit: 1 } });
  const host = await make(h);
  try {
    expect((await host.start()).outcome).toBe("waiting");
    const raw = await h.raw({ kind: "query", sql: "SELECT value FROM curling_credential_meta WHERE slot='q'" }) as { values: { value: string }[] };
    const transfer = await import("../../persistence/installationTransferPairProtocol"); expect(transfer.transferIntentQ(raw.values[0].value)).toBeNull();
  } finally { await host.dispose(); }
});

it("uses the real new-user host, installed password SDK and normal Profile admission without import",async()=>{
  const h=await fixture(),host=await make(h);server(h,true);
  try {
    const opened=await host.start();if(opened.outcome!=="ready")throw Error("Synthetic native startup unavailable");
    const runtime=opened.runtime;expect((await runtime.startUpOnce()).verdict.kind).toBe("signed_out");
    const before=h.fetch.mock.calls.length;
    const result=await runtime.coordinator.signInForReview("synthetic@example.invalid","SYNTHETIC_REVIEW_INPUT");
    expect(result).toMatchObject({kind:"resolved",gate:{kind:"ready_online"}});
    const calls=h.fetch.mock.calls.slice(before).map(([input])=>new URL((input as Request).url));
    expect(calls.filter(url=>url.pathname.endsWith("/token")&&url.searchParams.get("grant_type")==="password")).toHaveLength(1);
    const scope=runtime.createLocalSportingScope(profileId);expect(scope).not.toBeNull();
    const training=createNewSession();expect(await scope!.repositories.session.saveCurrent(training)).toEqual({ok:true});
    expect(h.source.writes).toEqual([]);expect(h.source.map.size).toBe(0);
    expect([...h.values.values()].join()).not.toContain("SYNTHETIC_REVIEW_INPUT");
  }finally{await host.dispose();}
});

it("keeps review-password onboarding ordinary and restores only the existing tagged session",async()=>{
  const h=await fixture(),host=await make(h);server(h,false);
  try {
    const opened=await host.start();if(opened.outcome!=="ready")throw Error("Synthetic native startup unavailable");
    const runtime=opened.runtime;await runtime.startUpOnce();
    const signed=await runtime.coordinator.signInForReview("synthetic@example.invalid","SYNTHETIC_REVIEW_INPUT");
    expect(signed).toMatchObject({kind:"resolved",gate:{kind:"onboarding_required"}});
    expect(runtime.createLocalSportingScope(profileId)).toBeNull();
    if(signed.kind!=="resolved"||signed.gate.kind!=="onboarding_required"||!signed.gate.legal.terms||!signed.gate.legal.privacy)throw Error("Synthetic legal snapshot unavailable");
    expect(await runtime.coordinator.submitOnboarding({displayName:"Synthetic reviewer",terms:signed.gate.legal.terms,privacy:signed.gate.legal.privacy})).toMatchObject({kind:"completed",gate:{kind:"ready_online"}});
    expect(runtime.createLocalSportingScope(profileId)).not.toBeNull();
  }finally{await host.dispose();}
  vi.resetModules();h.module=await import("../supabaseAuthService");server(h,true);h.fetch.mockClear();
  const next=await make(h);
  try{
    const opened=await next.start();if(opened.outcome!=="ready")throw Error("Synthetic native restart unavailable");
    expect((await opened.runtime.startUpOnce()).verdict.kind).toBe("ready_online");
    expect(h.fetch.mock.calls.map(([input])=>new URL((input as Request).url)).some(url=>url.searchParams.get("grant_type")==="password")).toBe(false);
  }finally{await next.dispose();}
});
it("native bound password command cannot admit after a newer sign-out",async()=>{
  const h=await fixture(),host=await make(h);server(h,true);
  try{
    const opened=await host.start();if(opened.outcome!=="ready")throw Error("Synthetic native startup unavailable");
    const runtime=opened.runtime;await runtime.startUpOnce();const actual=h.fetch.getMockImplementation()!,entered=deferred<void>(),released=deferred<void>();
    h.fetch.mockImplementation(async(...args)=>{const url=new URL((args[0]as Request).url);if(url.searchParams.get("grant_type")==="password"){entered.resolve();await released.promise;}return actual(...args);});
    const old=runtime.coordinator.signInForReview("synthetic@example.invalid","SYNTHETIC_REVIEW_INPUT");await entered.promise;
    const newer=runtime.coordinator.signOut();released.resolve();
    expect((await old).kind).not.toBe("resolved");expect((await newer).kind).toBe("signed_out_locked");expect(runtime.createLocalSportingScope(profileId)).toBeNull();
  }finally{await host.dispose();}
});
for(const mode of ["denied","rpc_failure","pending_deletion"]as const)it(`native password result cannot bypass ${mode}`,async()=>{
  const h=await fixture(),host=await make(h);server(h,true);
  const actual=h.fetch.getMockImplementation()!;
  h.fetch.mockImplementation(async(...args)=>{
    const path=new URL((args[0]as Request).url).pathname;
    if(path.endsWith("/get_my_gate_state")){
      if(mode==="denied")return new Response(JSON.stringify({message:"forbidden: Synthetic denied"}),{status:403,headers:{"Content-Type":"application/json"}});
      if(mode==="rpc_failure")throw Error("Synthetic unavailable");
      return new Response(JSON.stringify({...facts(false),profile_id:null,display_name:null}),{headers:{"Content-Type":"application/json"}});
    }
    return actual(...args);
  });
  try{
    const opened=await host.start();if(opened.outcome!=="ready")throw Error("Synthetic native startup unavailable");
    await opened.runtime.startUpOnce();const result=await opened.runtime.coordinator.signInForReview("synthetic@example.invalid","SYNTHETIC_REVIEW_INPUT");
    expect(result).not.toMatchObject({gate:{kind:"ready_online"}});expect(opened.runtime.createLocalSportingScope(profileId)).toBeNull();
  }finally{await host.dispose();}
});

for(const mode of ["no_session","malformed_user","hook_denial","rate_limit","network"]as const)it(`original new-user SDK contains password failure: ${mode}`,async()=>{
  const h=await fixture(),host=await make(h);server(h,true);
  try{
    const opened=await host.start();if(opened.outcome!=="ready")throw Error("Synthetic native startup unavailable");
    const runtime=opened.runtime;await runtime.startUpOnce();const actual=h.fetch.getMockImplementation()!;
    let issued=false;
    h.fetch.mockImplementation(async(...args)=>{
      const url=new URL((args[0]as Request).url);
      if(url.searchParams.get("grant_type")!=="password")return actual(...args);
      issued=true;
      if(mode==="network")throw Error("SYNTHETIC_PRIVATE");
      if(mode==="hook_denial"||mode==="rate_limit")return response({code:"invalid_credentials",message:"SYNTHETIC_PRIVATE"},mode==="rate_limit"?429:403);
      if(mode==="no_session")return response({});
      const normal=await actual(...args);return response({...await normal.json(),user:{}});
    });
    const result=await runtime.coordinator.signInForReview("synthetic@example.invalid","SYNTHETIC_REVIEW_INPUT");
    expect(issued).toBe(true);expect(result.kind).not.toBe("resolved");expect(runtime.createLocalSportingScope(profileId)).toBeNull();
    expect(JSON.stringify(result)).not.toMatch(/SYNTHETIC|invalid_credentials/);
  }finally{await host.dispose();}
});
it("actual new-user credential-write failure prevents signed-in publication and admission",async()=>{
  const h=await fixture(),host=await make(h);server(h,true);
  try{
    const opened=await host.start();if(opened.outcome!=="ready")throw Error("Synthetic native startup unavailable");
    const runtime=opened.runtime;await runtime.startUpOnce();const observed=vi.fn();runtime.subscribeToAuthChanges(observed);
    let refused=false;
    h.faults.hook=async(event,next)=>{if(event.kind==="write"){refused=true;throw null;}return next();};
    expect((await runtime.coordinator.signInForReview("synthetic@example.invalid","SYNTHETIC_REVIEW_INPUT")).kind).not.toBe("resolved");
    expect(refused).toBe(true);expect(host.health().storageFailed).toBe(true);expect(observed.mock.calls.some(([event])=>event.reason==="signed_in")).toBe(false);
    expect(runtime.createLocalSportingScope(profileId)).toBeNull();
  }finally{await host.dispose();}
});
it("actual new-user password command remains owned through disposal and late completion",async()=>{
  const h=await fixture(),host=await make(h);server(h,true);
  const opened=await host.start();if(opened.outcome!=="ready")throw Error("Synthetic native startup unavailable");
  const runtime=opened.runtime;await runtime.startUpOnce();const actual=h.fetch.getMockImplementation()!,entered=deferred<void>(),released=deferred<void>(),observed=vi.fn();runtime.subscribeToAuthChanges(observed);
  h.fetch.mockImplementation(async(...args)=>{if(new URL((args[0]as Request).url).searchParams.get("grant_type")==="password"){entered.resolve();await released.promise;}return actual(...args);});
  const pending=runtime.coordinator.signInForReview("synthetic@example.invalid","SYNTHETIC_REVIEW_INPUT");await entered.promise;
  const disposing=host.dispose();let closed=false;void disposing.then(()=>{closed=true;});await Promise.resolve();expect(closed).toBe(false);
  released.resolve();expect((await pending).kind).not.toBe("resolved");await disposing;
  expect(observed.mock.calls.some(([event])=>event.reason==="signed_in")).toBe(false);
});
it("denied actual new-user password request preserves existing OTP credentials",async()=>{
  const h=await fixture(),host=await make(h);
  try{
    const opened=await host.start();if(opened.outcome!=="ready")throw Error("Synthetic native startup unavailable");
    await onboard(h,opened.runtime);const previous=h.rawRoot(),actual=h.fetch.getMockImplementation()!;
    h.fetch.mockImplementation(async(...args)=>new URL((args[0]as Request).url).searchParams.get("grant_type")==="password"?response({code:"invalid_credentials",message:"SYNTHETIC_PRIVATE"},403):actual(...args));
    expect((await opened.runtime.coordinator.signInForReview("synthetic@example.invalid","SYNTHETIC_REVIEW_INPUT")).kind).not.toBe("resolved");
    expect(h.rawRoot()).toBe(previous);expect(host.health().storageFailed).toBe(false);
  }finally{await host.dispose();}
});
for(const rewrite of ["origin","grant","extra_query","route","other_command"]as const)it(`actual new-user password transport denies ${rewrite} before SEND`,async()=>{
  const h=await fixture(),RealRequest=globalThis.Request;
  vi.stubGlobal("Request",class extends RealRequest{constructor(input:RequestInfo|URL,init?:RequestInit){
    const url=new URL(typeof input==="string"?input:input instanceof URL?input.href:input.url);
    if(url.pathname.endsWith("/token")){
      if(rewrite==="origin")url.hostname="other.example.invalid";
      if(rewrite==="grant")url.searchParams.set("grant_type","client_credentials");
      if(rewrite==="extra_query")url.searchParams.set("other","1");
      if(rewrite==="route")url.pathname="/other/token";
    }
    if(rewrite==="other_command"&&url.pathname.endsWith("/otp")){url.pathname="/auth/v1/token";url.search="?grant_type=password";}
    super(url,init);
  }});
  const host=await make(h);server(h,true);
  try{
    const opened=await host.start();if(opened.outcome!=="ready")throw Error("Synthetic native startup unavailable");await opened.runtime.startUpOnce();
    const before=h.fetch.mock.calls.length;
    if(rewrite==="other_command")expect((await opened.runtime.coordinator.requestEmailOtp("synthetic@example.invalid")).kind).not.toBe("otp_requested");
    else expect((await opened.runtime.coordinator.signInForReview("synthetic@example.invalid","SYNTHETIC_REVIEW_INPUT")).kind).not.toBe("resolved");
    expect(h.fetch).toHaveBeenCalledTimes(before);
  }finally{await host.dispose();}
});
