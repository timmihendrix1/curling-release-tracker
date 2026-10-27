// Real coordinator repositories and actual source-aware SQLite, synthetic auth edge.
import { afterEach, expect, it, vi } from "vitest";
import { setup, protectedArchive, basic, disposeTransferFixtures } from "./installationTransferTestFixture";
import type { NativeTransferSourceIdentityContext } from "../installationTransferQuarantineSql";
import { createIdentityHarness, IDENTITY_A, PROFILE_A, PINNED_TERMS, PINNED_PRIVACY, FIXED_NOW } from "../../identity/__tests__/support/identityTestHarness";
const owners: { close(): Promise<unknown> }[] = [];
afterEach(async () => { for (const owner of owners.splice(0)) await owner.close(); await disposeTransferFixtures(); vi.restoreAllMocks(); });
const key = "curling.identity.pendingIntent.v1", email = "synthetic@example.invalid";
function deferred() { let resolve!: () => void; const promise = new Promise<void>(r => { resolve = r; }); return { promise, resolve }; }
async function fixture(holdEvents = false, raws: Record<string, string> = basic()) {
  vi.resetModules();
  const sql = await setup(), archive = await protectedArchive(raws), values = new Map<string, string>();
  const implementation = await import("../installationTransferQuarantineSql"), spy = vi.spyOn(implementation, "createInstallationTransferSourceIdentitySql");
  const portModule = await import("../nativeCredentialMigrationPort"), actualPrepare = portModule.prepareTransferIdentityCredentialRuntime;
  let credentialArgs!: Parameters<typeof actualPrepare>;
  vi.spyOn(portModule, "prepareTransferIdentityCredentialRuntime").mockImplementation((...args) => { credentialArgs = args; return actualPrepare(...args); });
  const pairing = await import("../installationTransferPairing");
  const owner = pairing.createInstallationTransferHostOwner({ sqlite: sql.options, providerConfigIdentity: "pc1:synthetic", sessionStorageKey: "sb-synthetic-auth-token", detectPlatform: () => "ios", protectedBinding: {
    failedWriteMayLosePreviousValue: false, configure: async () => {}, inventory: async () => ({ kind: "complete", keys: [...values.keys()].sort() }),
    read: async (k: string) => values.has(k) ? { kind: "value", value: values.get(k) } : { kind: "established_absent" },
    write: async (k: string, value: string) => { values.set(k, value); }, remove: async (k: string) => ({ kind: values.delete(k) ? "deleted" : "nothing_to_delete" }),
  } }, () => false); owners.push(owner);
  expect(await owner.pair(archive.protectedWire, archive.recoveryCode)).toMatchObject({ code: "paired" });
  const pair = await owner.handoff(); expect(pair).not.toBeNull(); const context = spy.mock.results[0].value as NativeTransferSourceIdentityContext;
  const coordinatorModule = await import("../../identity/identityTransitionCoordinator"), repos = await import("../../identity/identityRepositorySet"), fake = await import("../../identity/fakeIdentityService");
  const h = createIdentityHarness(), identity = fake.createFakeIdentityService(h.identityBackend), sources: object[] = [], events: object[] = [];
  h.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
  h.identityBackend.accounts.set(IDENTITY_A.accountScopeId, { profileId: PROFILE_A, displayName: "Synthetic", onboardingCompletedAt: FIXED_NOW, hasAthleteCapability: true, freeEntitlementActive: true, pinnedTerms: PINNED_TERMS, pinnedPrivacy: PINNED_PRIVACY });
  let close!: () => unknown, counter = 0;
  const coordinator = coordinatorModule.createIdentityTransitionCoordinator({ auth: h.fakeAuth.auth, identity, capture: h.capture,
    ...repos.createIdentityRepositorySet(pair!.domain), liveGeneration: coordinatorModule.createLiveGenerationCounter(), now: () => FIXED_NOW, resolveRedirectTarget: () => "https://app.example.invalid/",
    newId: () => `90000000-0000-4000-8000-${String(++counter).padStart(12, "0")}`,
    nativeOwnership: {
      bind: () => ({ auth: h.fakeAuth.auth, identity: () => identity, takeAuthObservation: () => null }), admissionAllowed: () => pair!.health().domain === "healthy", ownStartup() {}, ownClose(value) { close = value; },
      ownFreshEmailOtpSource(source) { sources.push(source); owner.ownFreshEmailOtpSource(source); },
      ownFreshEmailOtp(event) { events.push(event); if (!holdEvents) owner.ownFreshEmailOtp(event); }, retainFreshEmailOtpWork() {},
    },
  });
  const verify = async () => { expect((await coordinator.requestEmailOtp(email)).kind).toBe("otp_requested"); expect(await coordinator.verifyEmailOtp(email, "123456")).toMatchObject({ kind: "resolved", gate: { kind: "ready_online" } }); expect(events).toHaveLength(1); const stamp = context.pinFreshEmailOtp(events[0]); expect(stamp).not.toBeNull(); return stamp!; };
  return { sql, archive, values, owner, pair: pair!, context, coordinator, verify, sources, events, close, coordinatorModule,
    readAnchor: () => portModule.publicationTransferCredentialCapability(credentialArgs[0])!.read(credentialArgs[2], credentialArgs[3], credentialArgs[4]),
    insertAnchor: (raw: string) => portModule.publicationTransferCredentialCapability(credentialArgs[0])!.insert(credentialArgs[2], credentialArgs[3], credentialArgs[4], raw) };
}
it("binds one genuine source and pins its actual post-write identity without native I/O; public grants stay false", async () => {
  const f = await fixture(), stamp = await f.verify(), before = f.sql.trace.length;
  expect(f.context.freshEmailOtpCurrent(stamp)).toBe(true); expect(f.context.pinFreshEmailOtp(f.events[0])).toBe(stamp);
  expect(f.context.bindFreshEmailOtpSource(f.sources[0])).toBe(true); expect(f.sql.trace).toHaveLength(before);
  expect(Object.keys(stamp)).toEqual([]); expect(Object.getPrototypeOf(stamp)).toBeNull(); expect(Object.isFrozen(stamp)).toBe(true);
  expect(await f.owner.inspect()).toMatchObject({ code: "runtime_owned", mayIssue: false, mayPublish: false, mayMount: false });
});
it("refuses copies, proxies, cross-source events and stamps without reflecting on supplied handles", async () => {
  const f = await fixture(), stamp = await f.verify(), before = f.sql.trace.length;
  for (const fake of [{}, { ...f.sources[0] }, Object.create(f.sources[0]), new Proxy(f.sources[0], { get() { throw null; }, getPrototypeOf() { throw null; } })]) expect(f.context.bindFreshEmailOtpSource(fake)).toBe(false);
  for (const fake of [{}, { ...stamp }, Object.create(stamp), new Proxy(stamp, { get() { throw null; } })]) expect(f.context.freshEmailOtpCurrent(fake)).toBe(false);
  const foreign = createIdentityHarness({ nativeOwnership: { bind: () => { throw null; }, admissionAllowed: () => true, ownStartup() {}, ownClose() {}, ownFreshEmailOtpSource(source) { expect(f.context.bindFreshEmailOtpSource(source)).toBe(false); }, ownFreshEmailOtp() {}, retainFreshEmailOtpWork() {} } });
  expect(foreign).toBeDefined(); expect(f.context.pinFreshEmailOtp({})).toBeNull(); expect(f.sql.trace).toHaveLength(before); expect(f.context.freshEmailOtpCurrent(stamp)).toBe(true);
});
it.each(["set", "remove", "noop_remove"] as const)("revokes at accepted %s enqueue and never repins the old event after completion", async kind => {
  const f = await fixture(), stamp = await f.verify(), beforeSource = await f.sql.raw({ kind: "query", sql: "SELECT * FROM installation_transfer_source_denial_v1" });
  const write = kind === "set" ? f.pair.domain.set(key, "synthetic") : f.pair.domain.remove(kind === "remove" ? "curling.identity.trustedDevice.v1" : key);
  expect(f.context.freshEmailOtpCurrent(stamp)).toBe(false); expect(f.context.pinFreshEmailOtp(f.events[0])).toBeNull();
  expect(await write).toEqual({ ok: true }); expect(f.context.pinFreshEmailOtp(f.events[0])).toBeNull(); expect(f.context.freshEmailOtpCurrent(stamp)).toBe(false);
  expect(await f.sql.raw({ kind: "query", sql: "SELECT * FROM installation_transfer_source_denial_v1" })).toEqual(beforeSource);
});
it("blocks pin while a queued mutation waits behind an actual SQL read", async () => {
  const f = await fixture(), stamp = await f.verify(), entered = deferred(), hold = deferred(); let armed = true;
  f.sql.faults.hook = async (event, next) => { if (armed && event.kind === "query") { armed = false; entered.resolve(); await hold.promise; } return next(); };
  const read = f.pair.domain.get(key); await entered.promise;
  const mutation = f.pair.domain.set(key, "synthetic");
  expect(f.context.freshEmailOtpCurrent(stamp)).toBe(false); expect(f.context.pinFreshEmailOtp(f.events[0])).toBeNull();
  hold.resolve(); await read; expect(await mutation).toEqual({ ok: true }); expect(f.context.pinFreshEmailOtp(f.events[0])).toBeNull();
});
it("consumes a first pin attempt refused during pending mutation, even after work finishes", async () => {
  const f = await fixture(true);
  await f.coordinator.requestEmailOtp(email); expect(await f.coordinator.verifyEmailOtp(email, "123456")).toMatchObject({ kind: "resolved", gate: { kind: "ready_online" } });
  expect(f.events).toHaveLength(1); const event = f.events[0];
  expect(f.coordinatorModule.readNativeFreshEmailOtp(event)!.current()).toBe(true);
  const mutation = f.pair.domain.set(key, "synthetic");
  expect(f.context.pinFreshEmailOtp(event)).toBeNull(); expect(await mutation).toEqual({ ok: true });
  expect(f.coordinatorModule.readNativeFreshEmailOtp(event)!.current()).toBe(true);
  expect(f.context.pinFreshEmailOtp(event)).toBeNull();
});
it("invalid input refusals preserve the original proof and healthy runtime", async () => {
  const f = await fixture(), stamp = await f.verify();
  expect(await f.pair.domain.set("foreign", "synthetic")).toMatchObject({ ok: false });
  expect(await f.pair.domain.set(key, "x".repeat(1048577))).toMatchObject({ ok: false });
  expect(f.context.freshEmailOtpCurrent(stamp)).toBe(true); expect(f.pair.health().domain).toBe("healthy");
});
it.each(["transition", "close", "fault"] as const)("retires the exact original proof on %s", async at => {
  const f = await fixture(), stamp = await f.verify();
  if (at === "transition") { const work = f.coordinator.revalidateGateFacts(); expect(f.context.freshEmailOtpCurrent(stamp)).toBe(false); await work; }
  if (at === "close") { const work = f.owner.close(); expect(f.context.freshEmailOtpCurrent(stamp)).toBe(false); await work; }
  if (at === "fault") { await f.sql.raw({ kind: "execute", sql: "DELETE FROM installation_transfer_source_denial_v1" }); expect(await f.pair.domain.get(key)).toMatchObject({ status: "read_failed" }); }
  expect(f.context.freshEmailOtpCurrent(stamp)).toBe(false); expect(f.context.pinFreshEmailOtp(f.events[0])).toBeNull();
});
it("joins unrelated pending native work and keeps pinning blocked until real settlement", async () => {
  const f = await fixture(), stamp = await f.verify(), hold = deferred(), entered = deferred(); let armed = true, done = false;
  f.sql.faults.hook = async (event, next) => { if (armed && event.kind === "query") { armed = false; entered.resolve(); await hold.promise; } return next(); };
  const removal = f.pair.domain.remove("curling.identity.trustedDevice.v1"); void removal.then(() => { done = true; }); await entered.promise;
  await new Promise(resolve => setTimeout(resolve, 5)); expect(done).toBe(false); expect(f.context.freshEmailOtpCurrent(stamp)).toBe(false); expect(f.context.pinFreshEmailOtp(f.events[0])).toBeNull();
  hold.resolve(); expect(await removal).toEqual({ ok: true }); expect(f.context.pinFreshEmailOtp(f.events[0])).toBeNull();
  f.sql.faults.hook = undefined;
  await f.coordinator.requestEmailOtp(email); expect(await f.coordinator.verifyEmailOtp(email, "123456")).toMatchObject({ kind: "resolved", gate: { kind: "ready_online" } });
  expect(f.events).toHaveLength(2); const current = f.context.pinFreshEmailOtp(f.events[1]); expect(current).not.toBeNull(); expect(f.context.freshEmailOtpCurrent(current)).toBe(true);
});
it("drains unrelated malformed acquired query work before completing mutation and cleanup", async () => {
  const f = await fixture(), stamp = await f.verify(), hold = deferred(), entered = deferred(); let armed = true, done = false, closed = false;
  f.sql.faults.hook = async (event, next) => { const value = await next(); if (armed && event.kind === "query") { armed = false; return new Proxy({ values: hold.promise }, { getOwnPropertyDescriptor(target, name) { if (name === "values") entered.resolve(); return Reflect.getOwnPropertyDescriptor(target, name); } }); } return value; };
  const mutation = f.pair.domain.set(key, "synthetic"); void mutation.then(() => { done = true; }); await entered.promise;
  const close = f.owner.close(); void close.then(() => { closed = true; }); const before = f.sql.trace.length;
  await new Promise(resolve => setTimeout(resolve, 5));
  try { expect(done).toBe(false); expect(closed).toBe(false); expect(f.sql.trace).toHaveLength(before); expect(f.context.freshEmailOtpCurrent(stamp)).toBe(false); expect(f.context.pinFreshEmailOtp(f.events[0])).toBeNull(); }
  finally { hold.resolve(); expect(await mutation).toMatchObject({ ok: false }); await close; }
});

async function controlFixture(raws: Record<string, string> = basic()) {
  const f = await fixture(false, raws), stamp = await f.verify();
  const helper = await import("../installationTransferAccountControl");
  const facts = f.coordinatorModule.readNativeFreshEmailOtp(f.events[0])!;
  let live = true;
  const observation = helper.createTransferAccountControlObservation(f.events[0], facts.accountScopeId, facts.profileId, 7, () => live)!;
  expect(observation).not.toBeNull();
  return { ...f, stamp, helper, facts, observation, revoke() { live = false; } };
}
it("binds genuine final-control observation to the exact original SQL fresh stamp without I/O or publication", async () => {
  const f = await controlFixture(), before = f.sql.trace.length;
  const stamp = f.context.pinAccountControl(f.stamp, f.observation); expect(stamp).not.toBeNull();
  expect(f.context.accountControlCurrent(stamp)).toBe(true);
  expect(f.context.pinAccountControl(f.stamp, f.observation)).toBe(stamp);
  expect(f.sql.trace).toHaveLength(before); expect(Object.keys(stamp!)).toEqual([]); expect(Object.isFrozen(stamp)).toBe(true);
  expect(Object.keys(f.observation)).toEqual([]); expect(Object.isFrozen(f.observation)).toBe(true);
  expect(await f.owner.inspect()).toMatchObject({ mayPublish: false, mayMount: false });
});
it.each(["account", "profile", "revision", "event", "current"])("cannot mint server provenance from mismatched %s facts", async kind => {
  const f = await controlFixture();
  expect(f.helper.createTransferAccountControlObservation(kind === "event" ? {} : f.events[0], kind === "account" ? "foreign" : f.facts.accountScopeId,
    kind === "profile" ? "aaaaaaaa-0000-4000-8000-000000000001" : f.facts.profileId, kind === "revision" ? -1 : 7, () => kind !== "current")).toBeNull();
});
it("does not inspect copies or proxies of observation and SQL control stamps", async () => {
  const f = await controlFixture(), stamp = f.context.pinAccountControl(f.stamp, f.observation), touched = vi.fn(() => { throw null; });
  for (const value of [null, {}, { ...f.observation }, Object.create(f.observation), new Proxy(f.observation, { get: touched, ownKeys: touched, getPrototypeOf: touched })]) {
    expect(f.helper.readTransferAccountControlObservation(value)).toBeNull(); expect(f.context.pinAccountControl(f.stamp, value)).toBeNull();
  }
  for (const value of [{}, { ...stamp }, Object.create(stamp), new Proxy(stamp!, { get: touched, ownKeys: touched })]) expect(f.context.accountControlCurrent(value)).toBe(false);
  expect(touched).not.toHaveBeenCalled();
});
it("consumes an observation refused for a foreign stamp without recapturing the current SQL revision", async () => {
  const f = await controlFixture(); expect(f.context.pinAccountControl({}, f.observation)).toBeNull();
  expect(f.context.pinAccountControl(f.stamp, f.observation)).toBeNull();
});
it.each(["set", "remove", "host"])("revokes original account control after %s and never revives it", async kind => {
  const f = await controlFixture(), stamp = f.context.pinAccountControl(f.stamp, f.observation);
  if (kind === "host") f.revoke();
  else { const mutation = kind === "set" ? f.pair.domain.set(key, "synthetic") : f.pair.domain.remove(key); expect(f.context.accountControlCurrent(stamp)).toBe(false); await mutation; }
  expect(f.context.accountControlCurrent(stamp)).toBe(false); expect(f.context.pinAccountControl(f.stamp, f.observation)).toBeNull();
});
it("requires actual protected observations and context-owned draft tokens before accepting its own exact insertion", async () => {
  const raws = Object.fromEntries(Object.entries(basic()).map(([key, value]) => [key.replace("10000000-0000-4000-8000-000000000001", PROFILE_A), value]));
  const f = await controlFixture(raws), stamp = f.context.pinAccountControl(f.stamp, f.observation); expect(stamp).not.toBeNull();
  let traps = 0; const trap = () => { traps++; throw null; };
  for (const value of [{}, { raw: null }, new Proxy({}, { get: trap, ownKeys: trap })]) expect(await f.context.preparePublication(stamp, value)).toBeNull();
  expect(traps).toBe(0);
  const observed = await f.readAnchor(); if (observed.status !== "observed") throw null;
  const draft = await f.context.preparePublication(stamp, observed.observation); expect(draft).not.toBeNull();
  const payload = f.context.publicationDraftPayload(draft); expect(payload).not.toBeNull(); expect(Object.keys(draft!)).toEqual([]); expect(Object.isFrozen(draft)).toBe(true);
  for (const value of [undefined, null, {}, { ...draft }, Object.create(draft), new Proxy(draft!, { get: trap, ownKeys: trap })]) {
    expect(f.context.publicationDraftPayload(value)).toBeNull(); expect(await f.context.acceptPublicationAnchor(value, observed.observation)).toBe(false);
  }
  for (const value of [{}, { ...observed.observation }, new Proxy(observed.observation, { get: trap, ownKeys: trap })]) expect(await f.context.acceptPublicationAnchor(draft, value)).toBe(false);
  expect(await f.context.acceptPublicationAnchor(draft, observed.observation)).toBe(false); // genuine absence is not positive readback
  const inserted = await f.insertAnchor(payload!.raw); if (inserted.status !== "observed") throw null;
  expect(await f.context.acceptPublicationAnchor(draft, inserted.observation)).toBe(true); expect(f.context.publicationDraftPayload(draft)).toEqual(payload);
  expect(traps).toBe(0); const objects = await f.sql.raw({ kind: "query", sql: "SELECT name FROM sqlite_master" }) as { values: unknown[] }; expect(objects.values).toHaveLength(8);
  const mutation = f.pair.domain.remove("curling.identity.pendingIntent.v1"); expect(f.context.publicationDraftPayload(draft)).toBeNull(); expect(await mutation).toEqual({ ok: true });
  expect(await f.context.acceptPublicationAnchor(draft, inserted.observation)).toBe(false); expect(f.context.publicationDraftPayload(draft)).toBeNull();
});
