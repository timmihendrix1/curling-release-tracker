// Real installed SDK + disposable SQLite, synthetic credentials only. These
// private-port adversarial cases supplement the separate actual Tracker UI proof.
import { describe, expect, it, vi } from "vitest";
import { ready, fixture, bootstrap, server, profileId, deferred, releases, response } from "./nativeTrackerFixture";
import { createNewSession } from "../../sessionMigration";
import { createTrainingBlock } from "../../trainingBlocks";
import { CURRENT_SESSION_STORAGE_KEY, SESSION_HISTORY_STORAGE_KEY } from "../../sessionRepository";
import { profileScopedSportingStorageKey } from "../../persistence/profileScopedSportingPersistence";
import { createCompletedTechniqueExecution, FIXTURE_SESSION_ID } from "../../exercises/__tests__/executionFixtures";
function started(id = FIXTURE_SESSION_ID) {
  const value = createNewSession(); value.id = id;
  value.blocks = [createTrainingBlock({ name: "Synthetic block", mode: "fixed", measurementMode: "back-hog", targetTime: 3.75 })]; value.activeBlockId = value.blocks[0].id;
  return value;
}
async function bound(loss = true) {
  const f = await ready(loss); vi.stubGlobal("navigator", { onLine: false });
  const registry = await import("../../persistence/nativeTrackerRegistry");
  expect(registry.authenticateNativeTrackerRuntime(f.runtime)).toBe(true);
  expect(registry.authenticateNativeTrackerRuntime({ ...f.runtime })).toBe(false);
  const binding = registry.bindNativeTrackerRuntime(f.runtime, profileId)!;
  await binding.application.sync.initialize();
  const who = {}, port = binding.tracker; port.attach(who); port.context(who, "train", false);
  return { ...f, ...binding, port, who, registry };
}
async function fault(f: Awaited<ReturnType<typeof bound>>) {
  f.h.faults.hook = async event => { if (event.kind === "read") throw new Error("Synthetic protected read failure"); throw new Error("Unexpected synthetic credential operation"); };
  await f.runtime.coordinator.revalidateGateFacts();
  expect(f.b.host.health().runtime?.credential).toBe("failed");
}
async function write(f: Awaited<ReturnType<typeof bound>>, value = started(), sequence = 1) {
  expect(f.port.commit(f.who, value, sequence)).toBe(true);
  return { value, settled: await f.port.persistCurrent(f.port.prepareCurrent(f.who, value, sequence)) };
}
async function raw(f: Awaited<ReturnType<typeof bound>>, key: typeof CURRENT_SESSION_STORAGE_KEY | typeof SESSION_HISTORY_STORAGE_KEY) {
  const result = await f.h.raw({ kind: "query", sql: "SELECT value FROM records WHERE key = ?;", values: [profileScopedSportingStorageKey(profileId, key)] }) as { values: Array<{ value: string }> };
  return result.values[0]?.value ?? null;
}

describe("genuine original native Tracker owner", () => {
  it("joins actual pre-fault Current ACK, then allows another block inside that Session without reviving S5h", async () => {
    const f = await bound(), { value, settled } = await write(f); expect(settled.result.ok).toBe(true);
    await fault(f); expect(f.port.getSnapshot().mode).toBe("continuing");
    const next = { ...value, blocks: [...value.blocks, createTrainingBlock({ name: "Second block", mode: "fixed", measurementMode: "back-hog", targetTime: 3.75 })] };
    expect((await write(f, next, 2)).settled.result.ok).toBe(true);
    expect(JSON.parse((await raw(f, CURRENT_SESSION_STORAGE_KEY))!).blocks).toHaveLength(2);
    expect((await f.application.repositories.session.saveCurrent(next)).ok).toBe(false);
    expect(f.runtime.createSportingApplicationScope(profileId)).toBeNull();
    expect(f.registry.bindNativeTrackerRuntime(f.runtime, profileId)).toBeNull();
    const newSession = started(); newSession.id = "new-session";
    expect(f.port.commit(f.who, newSession, 3)).toBe(false);
  });
  it("does not mint Q1 from a late issued ACK", async () => {
    const f = await bound(), value = started();
    const credentialEntered = deferred<void>(), credentialRelease = deferred<void>(), sqlEntered = deferred<void>(), sqlRelease = deferred<void>();
    releases.push(() => credentialRelease.resolve(), () => sqlRelease.resolve());
    f.h.faults.hook = async event => { if (event.kind === "read") { credentialEntered.resolve(); await credentialRelease.promise; throw new Error("Synthetic protected read failure"); } throw new Error("Unexpected credential operation"); };
    const failing = f.runtime.coordinator.revalidateGateFacts(); await credentialEntered.promise;
    f.h.sqlFaults.hook = async (event, next) => { if (event.kind === "commit") { sqlEntered.resolve(); await sqlRelease.promise; } return next(); };
    expect(f.port.commit(f.who, value, 1)).toBe(true);
    const work = f.port.persistCurrent(f.port.prepareCurrent(f.who, value, 1)); await sqlEntered.promise;
    credentialRelease.resolve(); await failing; expect(f.port.getSnapshot().mode).toBe("blocked");
    sqlRelease.resolve(); expect((await work).result.ok).toBe(true);
    expect(await raw(f, CURRENT_SESSION_STORAGE_KEY)).not.toBeNull(); expect(f.port.getSnapshot().mode).toBe("blocked");
  });
  it.each(["empty", "home", "overlay", "hydrated"] as const)("does not grant from %s without genuine started/context evidence", async kind => {
    const f = await bound(), value = kind === "empty" ? createNewSession() : started();
    if (kind === "hydrated") f.port.hydrated(f.who, value, 1); else expect(f.port.commit(f.who, value, 1)).toBe(true);
    if (kind === "home") f.port.context(f.who, "home", false);
    if (kind === "overlay") f.port.context(f.who, "train", true);
    expect((await f.port.persistCurrent(f.port.prepareCurrent(f.who, value, 1))).result.ok).toBe(true);
    await fault(f); expect(f.port.getSnapshot().mode).toBe("blocked");
    f.port.context(f.who, "train", false); expect(f.port.getSnapshot().mode).toBe("blocked");
  });
  it("owns prepared data and ACK sequence before a UI queue, and replays without another I/O", async () => {
    const f = await bound(), value = started("legacy-session-string"); expect(f.port.commit(f.who, value, 7)).toBe(true);
    const job = f.port.prepareCurrent(f.who, value, 7), original = JSON.stringify(value); value.title = "Mutated after submission"; value.blocks.length = 0;
    const settled = await f.port.persistCurrent(job); expect(settled.result.ok).toBe(true); expect(settled.sequence).toBe(7); expect(JSON.stringify(settled.written)).toBe(original);
    const length = f.h.trace.length; expect(await f.port.persistCurrent(job)).toBe(settled); expect(f.h.trace).toHaveLength(length);
    await fault(f); expect(f.port.getSnapshot().mode).toBe("continuing");
  });
  it("preserves actual stored history, stops on history ACK and never emits an empty successor", async () => {
    const f = await bound(), { value } = await write(f), prior = { ...createNewSession(), id: "legacy-history" };
    expect((await f.application.repositories.session.saveHistory([prior])).ok).toBe(true);
    await fault(f);
    const terminal = { ...value, exerciseExecutions: [createCompletedTechniqueExecution()] };
    const job = f.port.prepareArchive(f.who, terminal, [], createNewSession());
    const result = await f.port.persistArchive(job); expect(result).toMatchObject({ result: { ok: false, step: "current" }, stopAfterCompletion: true });
    expect(JSON.parse((await raw(f, SESSION_HISTORY_STORAGE_KEY))!).map((v: { id: string }) => v.id)).toEqual([value.id, prior.id]);
    expect(JSON.parse((await raw(f, CURRENT_SESSION_STORAGE_KEY))!).id).toBe(value.id);
    expect(f.port.getSnapshot().mode).toBe("completed"); expect(f.port.commit(f.who, createNewSession(), 2)).toBe(false);
    expect((await f.port.persistHistory(f.port.prepareHistory(f.who, []))).ok).toBe(false);
  });
  it("detach retires queued jobs and an old same-ID intent, including StrictMode reattach", async () => {
    const f = await bound(), value = started(); expect(f.port.commit(f.who, value, 1)).toBe(true);
    const intent = f.port.captureIntent(f.who), job = f.port.prepareCurrent(f.who, value, 1);
    f.port.detach(f.who); f.port.attach(f.who); f.port.context(f.who, "train", false);
    expect(f.port.resumeIntent(f.who, intent)).toBe(false); expect((await f.port.persistCurrent(job)).result.ok).toBe(false);
    expect(await raw(f, CURRENT_SESSION_STORAGE_KEY)).toBeNull();
    await write(f, started(), 2); await fault(f); f.port.detach(f.who); f.port.attach(f.who);
    expect(f.port.getSnapshot().mode).toBe("blocked"); expect(f.port.captureIntent(f.who)).toBeNull();
  });
  it("explicit signout and document dispose synchronously close already queued Q1 work", async () => {
    const f = await bound(), { value } = await write(f); await fault(f);
    const job = f.port.prepareCurrent(f.who, { ...value, title: "Queued" }, 2);
    // An unreported object cannot acquire provenance even if its ID matches.
    expect((await f.port.persistCurrent(job)).result.ok).toBe(false);
    const next = { ...value, title: "Actual commit" }; expect(f.port.commit(f.who, next, 2)).toBe(true);
    const queued = f.port.prepareCurrent(f.who, next, 2), signout = f.runtime.coordinator.signOut();
    expect(f.port.captureIntent(f.who)).toBeNull(); expect((await f.port.persistCurrent(queued)).result.ok).toBe(false);
    await signout; await f.b.host.dispose();
  });
});

describe("actual Q1 fault and denial source facts", () => {
  it.each(["before_issue", "issued_loss", "issued_no_loss"] as const)("records original credential write failure: %s", async boundary => {
    const f = await bound(boundary !== "issued_no_loss"); await write(f);
    const previous = f.h.fetch.getMockImplementation()!;
    f.h.fetch.mockImplementation(async (...args) => {
      const result = await previous(...args);
      if ((args[0] as Request).url.includes("/token?")) {
        let reads = 0;
        f.h.faults.hook = async (event, next) => {
          // Installed SDK performs one post-refresh root read (manifest + item)
          // before the write's own manifest pre-read. Fail that real third read.
          if (event.kind === "read") reads++;
          if (boundary === "before_issue" && event.kind === "read" && reads === 3) throw new Error("Synthetic pre-write evidence failure");
          if (boundary !== "before_issue" && event.kind === "write" && f.h.item(event) === f.h.root) throw new Error("Synthetic write ACK missing");
          return next();
        };
      }
      return result;
    });
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 3_601_000);
    await f.runtime.coordinator.revalidateGateFacts();
    expect(f.b.host.health().runtime?.firstCredentialFailure).toMatchObject({ operation: "write", issued: boundary !== "before_issue", outcome: boundary === "before_issue" ? "refused" : "unverified", previousValueMayBeLost: boundary === "issued_loss" });
    expect(f.port.getSnapshot().mode).toBe("continuing");
  });
  it("vetoes actual matching definitive denial before pending SDK cleanup can fail", async () => {
    const f = await bound(); const { value } = await write(f);
    const previous = f.h.fetch.getMockImplementation()!, entered = deferred<void>(), release = deferred<void>(); releases.push(() => release.resolve());
    f.h.fetch.mockImplementation(async (...args) => (args[0] as Request).url.includes("/token?") ? response({ code: "refresh_token_not_found", message: "SYNTHETIC_PROVIDER_DETAIL" }, 400) : previous(...args));
    f.h.faults.hook = async (event, next) => { if (event.kind === "remove") { entered.resolve(); await release.promise; throw new Error("Synthetic cleanup failure"); } return next(); };
    const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 3_601_000);
    const work = f.runtime.coordinator.revalidateGateFacts(); await entered.promise;
    expect(f.port.getSnapshot().mode).toBe("blocked"); expect(f.port.captureIntent(f.who)).toBeNull();
    expect(f.port.commit(f.who, { ...value, title: "Should be refused before cleanup" }, 2)).toBe(false);
    release.resolve(); await work; expect(f.port.getSnapshot().mode).toBe("blocked");
  });
  it("does not claim completion after a lost actual SQL commit ACK", async () => {
    const f = await bound(), { value } = await write(f); await fault(f);
    const terminal = { ...value, exerciseExecutions: [createCompletedTechniqueExecution()] };
    f.h.sqlFaults.hook = async (event, next) => { const actual = await next(); if (event.kind === "commit") throw new Error("Synthetic committed but lost ACK"); return actual; };
    const result = await f.port.persistArchive(f.port.prepareArchive(f.who, terminal, [], createNewSession()));
    expect(result).toMatchObject({ result: { ok: false, step: "history" }, stopAfterCompletion: false });
    expect(f.b.host.health().runtime?.domain).toBe("failed"); expect(f.port.captureIntent(f.who)).toBeNull();
    expect(f.port.getSnapshot().mode).toBe("blocked");
  });
  it("cancels unsubmitted work and joins reentrant presentation disposal without a self-await", async () => {
    const f = await bound(), { value } = await write(f);
    const next = { ...value, title: "Not yet submitted" }; expect(f.port.commit(f.who, next, 2)).toBe(true);
    const job = f.port.prepareCurrent(f.who, next, 2);
    let same: ReturnType<typeof f.b.host.dispose> | null = null;
    f.port.subscribe(() => { same = f.b.host.dispose(); return same; });
    const closing = f.b.host.dispose(); expect(same).toBe(closing); await closing;
    expect((await f.port.persistCurrent(job)).result.ok).toBe(false);
  });
});

it("ends a normal in-flight archive on its late history ACK after the first credential fault", async () => {
  const f = await bound(), { value } = await write(f), terminal = { ...value, exerciseExecutions: [createCompletedTechniqueExecution()] };
  const credentialEntered = deferred<void>(), credentialRelease = deferred<void>(), sqlEntered = deferred<void>(), sqlRelease = deferred<void>();
  releases.push(() => credentialRelease.resolve(), () => sqlRelease.resolve());
  f.h.faults.hook = async event => { if (event.kind === "read") { credentialEntered.resolve(); await credentialRelease.promise; } throw new Error("Synthetic protected failure"); };
  const failing = f.runtime.coordinator.revalidateGateFacts(); await credentialEntered.promise;
  f.h.sqlFaults.hook = async (event, next) => { if (event.kind === "commit") { sqlEntered.resolve(); await sqlRelease.promise; } return next(); };
  const work = f.port.persistArchive(f.port.prepareArchive(f.who, terminal, [terminal], createNewSession())); await sqlEntered.promise;
  credentialRelease.resolve(); await failing; expect(f.port.getSnapshot().mode).toBe("continuing");
  sqlRelease.resolve(); expect(await work).toMatchObject({ result: { ok: false, step: "current" }, stopAfterCompletion: true });
  expect(f.port.getSnapshot().mode).toBe("completed"); expect(JSON.parse((await raw(f, CURRENT_SESSION_STORAGE_KEY))!).id).toBe(value.id);
});

it("refuses a superseded prepared Current job without overwriting a newer issued sequence", async () => {
  const f = await bound(), old = started(); expect(f.port.commit(f.who, old, 1)).toBe(true);
  const oldJob = f.port.prepareCurrent(f.who, old, 1), next = { ...old, title: "Newer committed value" };
  expect(f.port.commit(f.who, next, 2)).toBe(true); expect((await f.port.persistCurrent(f.port.prepareCurrent(f.who, next, 2))).result.ok).toBe(true);
  expect((await f.port.persistCurrent(oldJob)).result.ok).toBe(false);
  expect(JSON.parse((await raw(f, CURRENT_SESSION_STORAGE_KEY))!).title).toBe(next.title);
});
it("keeps actual domain validation failure separate from healthy SQLite continuation", async () => {
  const f = await bound(), { value } = await write(f); await fault(f);
  const malformed = { ...value, exerciseExecutions: [{}] } as unknown as typeof value;
  expect((await write(f, malformed, 2)).settled.result.ok).toBe(false); expect(f.b.host.health().runtime?.domain).toBe("healthy");
  expect(f.port.getSnapshot().mode).toBe("continuing"); expect((await write(f, { ...value, title: "Still locally usable" }, 3)).settled.result.ok).toBe(true);
});
it.each(["{", "{}", "[null]"])("preserves unprovable existing history rather than treating it as empty: %s", async stored => {
  const f = await bound(), { value } = await write(f); await fault(f);
  const key = profileScopedSportingStorageKey(profileId, SESSION_HISTORY_STORAGE_KEY);
  await f.h.raw({ kind: "run", sql: "INSERT OR REPLACE INTO records(key, value) VALUES (?, ?);", values: [key, stored] });
  const terminal = { ...value, exerciseExecutions: [createCompletedTechniqueExecution()] };
  const result = await f.port.persistArchive(f.port.prepareArchive(f.who, terminal, [], createNewSession()));
  expect(result).toMatchObject({ result: { ok: false, step: "history" }, stopAfterCompletion: false }); expect(await raw(f, SESSION_HISTORY_STORAGE_KEY)).toBe(stored);
});

// Independent adversarial reproductions, retained as permanent regressions.
it("reacts to a genuine domain failure without requiring a later UI permission query", async () => {
 const f = await bound(), {value} = await write(f); await fault(f);
 let changes=0; f.port.subscribe(()=>{ changes++; });
 f.h.sqlFaults.hook = async (event,next)=> { const result=await next(); if(event.kind==='commit') throw new Error('synthetic lost acknowledgement'); return result; };
 const next={...value,title:'Domain uncertainty'}; expect(f.port.commit(f.who,next,2)).toBe(true);
 const saved=await f.port.persistCurrent(f.port.prepareCurrent(f.who,next,2));
 expect(saved.result.ok).toBe(false); expect(f.b.host.health().runtime?.domain).toBe('failed');
 expect(f.port.getSnapshot().mode).toBe('blocked'); expect(changes).toBeGreaterThan(0);
});
it("reacts to actual observed barrier epoch without a later UI permission query",async()=>{
 const f=await bound(); await write(f); await fault(f);
 const {IDENTITY_BARRIER_STORAGE_KEY}=await import('../../identity/identityBarrier');
 await f.h.raw({kind:'run',sql:'INSERT OR REPLACE INTO records(key,value) VALUES (?,?)',values:[IDENTITY_BARRIER_STORAGE_KEY,'invalid-external-barrier']});
 expect(await f.runtime.coordinator.observeNewerBarrier()).toEqual({kind:'newer_barrier'});
 expect(f.port.getSnapshot().mode).toBe('blocked');
});

it("keeps same-line late ACK factual without granting a new context after barrier",async()=>{
 const f=await bound(), value=started(); expect(f.port.commit(f.who,value,1)).toBe(true);
 const entered=deferred<void>(), release=deferred<void>(); releases.push(()=>release.resolve());
 f.h.sqlFaults.hook=async(event,next)=>{if(event.kind==='commit'){entered.resolve();await release.promise;}return next();};
 const saved=f.port.persistCurrent(f.port.prepareCurrent(f.who,value,1)); await entered.promise;
 f.port.context(f.who,'home',false);
 release.resolve(); expect((await saved).result.ok).toBe(true);
 await fault(f); expect(f.port.getSnapshot().mode).toBe('blocked');
 f.port.context(f.who,'train',false); expect(f.port.captureIntent(f.who)).toBeNull();
});
it("owns malformed prepared work through close but never issues the queued Current",async()=>{
 const f=await bound(), {value}=await write(f);
 const wait=deferred<void>(); releases.push(()=>wait.resolve()); Object.defineProperty(wait.promise,'then',{value:null});
 const next={...value,title:'Unsubmitted malformed'}; expect(f.port.commit(f.who,next,2)).toBe(true); Object.defineProperty(next,'metadata',{value:wait.promise,enumerable:true});
 const job=f.port.prepareCurrent(f.who,next,2); let closed=false;
 const closing=f.b.host.dispose().then(()=>{closed=true;}); await new Promise(r=>setTimeout(r,10)); expect(closed).toBe(false);
 wait.resolve(); await closing; expect((await f.port.persistCurrent(job)).result.ok).toBe(false);
});

it("ends at a confirmed History ACK while preserving earlier actual history on failed successor",async()=>{
 const f=await bound(), {value}=await write(f);
 const prior={...createNewSession(),id:'prior-legacy-row',title:'Prior real stored history'};
 expect((await f.application.repositories.session.saveHistory([prior])).ok).toBe(true);
 await fault(f); const terminal={...value,title:'Terminal snapshot',exerciseExecutions:[createCompletedTechniqueExecution()]};
 const job=f.port.prepareArchive(f.who,terminal,[],createNewSession()); terminal.title='Aliased after prepare';
 expect(await f.port.persistArchive(job)).toMatchObject({result:{ok:false,step:'current'},stopAfterCompletion:true});
 const stored=JSON.parse((await raw(f,SESSION_HISTORY_STORAGE_KEY))!);
 expect(stored.map((v: { id: string })=>v.id)).toEqual([value.id,prior.id]); expect(stored[0].title).toBe('Terminal snapshot');
 expect(f.port.captureIntent(f.who)).toBeNull(); expect(JSON.parse((await raw(f,CURRENT_SESSION_STORAGE_KEY))!).id).toBe(value.id);
});
it("foreground transition retires presentation immediately without a subsequent port query",async()=>{
 const f=await bound(); await write(f); await fault(f);
 const work=f.runtime.coordinator.requestEmailOtp('synthetic@example.invalid');
 expect(f.port.getSnapshot().mode).toBe('blocked'); await work;
});

it("permits a fresh healthy actual Tracker incarnation only after retiring the previous incarnation",async()=>{
 const f=await bound(), {value: prior}=await write(f); const old=f.port.captureIntent(f.who);
 const queuedValue={...prior,title:'Old incarnation queue'}; expect(f.port.commit(f.who,queuedValue,2)).toBe(true);
 const queued=f.port.prepareCurrent(f.who,queuedValue,2);
 f.port.detach(f.who); const fresh={}; f.port.attach(fresh); f.port.context(fresh,'train',false);
 expect(f.port.resumeIntent(fresh,old)).toBe(false);
 expect(f.port.captureIntent(fresh)).not.toBeNull();
 const value=started('healthy-remount-session'); expect(f.port.commit(fresh,value,2)).toBe(true);
 expect((await f.port.persistCurrent(f.port.prepareCurrent(fresh,value,2))).result.ok).toBe(true);
 expect((await f.port.persistCurrent(queued)).result.ok).toBe(false);
 expect(JSON.parse((await raw(f,CURRENT_SESSION_STORAGE_KEY))!).id).toBe('healthy-remount-session');
});
it("requires a fresh actual ACK after healthy remount rather than inheriting the old training proof",async()=>{
 const f=await bound(), {value}=await write(f); f.port.detach(f.who);
 const fresh={}; f.port.attach(fresh); f.port.context(fresh,'train',false); f.port.hydrated(fresh,value,0);
 await fault(f); expect(f.port.getSnapshot().mode).toBe('blocked'); expect(f.port.captureIntent(fresh)).toBeNull();
});
it("never reattaches a fresh Tracker incarnation after the actual fault",async()=>{
 const f=await bound(); await write(f); await fault(f); f.port.detach(f.who);
 const fresh={}; f.port.attach(fresh); f.port.context(fresh,'train',false);
 expect(f.port.captureIntent(fresh)).toBeNull(); expect(f.port.getSnapshot().mode).toBe('blocked');
});

// Capture-phase retirement and incarnation ACK controls from independent review.
it("fresh incarnation earns Q1 only from its own actual Current ACK",async()=>{
 const f=await bound(); await write(f); f.port.detach(f.who);
 const fresh={}; f.port.attach(fresh); f.port.context(fresh,'train',false);
 const value=started('fresh-proof-session'); expect(f.port.commit(fresh,value,1)).toBe(true);
 expect((await f.port.persistCurrent(f.port.prepareCurrent(fresh,value,1))).result.ok).toBe(true);
 await fault(f); expect(f.port.getSnapshot().mode).toBe('continuing');
 expect(f.port.captureIntent(fresh)).not.toBeNull(); expect(f.port.captureIntent(f.who)).toBeNull();
});
it("late old-incarnation ACK cannot confirm a new same-ID lifetime",async()=>{
 const f=await bound(), value=started(); expect(f.port.commit(f.who,value,1)).toBe(true);
 const entered=deferred<void>(), release=deferred<void>(); releases.push(()=>release.resolve());
 f.h.sqlFaults.hook=async(event,next)=>{if(event.kind==='commit'){entered.resolve();await release.promise;}return next();};
 const oldSave=f.port.persistCurrent(f.port.prepareCurrent(f.who,value,1)); await entered.promise;
 f.port.detach(f.who); const fresh={}; f.port.attach(fresh); f.port.context(fresh,'train',false);
 const current={...value,title:'new incarnation same domain id'}; expect(f.port.commit(fresh,current,1)).toBe(true);
 release.resolve(); expect((await oldSave).result.ok).toBe(true);
 await fault(f); expect(f.port.getSnapshot().mode).toBe('blocked'); expect(f.port.captureIntent(fresh)).toBeNull();
});

it.each(["dispose", "detach"] as const)("drains a prototype observed only after reentrant %s retires a preparing opaque job",async boundary=>{
 const f=await bound(); await write(f);
 const currentWrites=()=>f.h.trace.filter(event=>event.kind==='run' && event.values?.includes(profileScopedSportingStorageKey(profileId,CURRENT_SESSION_STORAGE_KEY))).length;
 const before=currentWrites();
 const waiting=deferred<void>(); releases.push(()=>waiting.resolve()); Object.defineProperty(waiting.promise,'then',{value:null});
 let armed=false, closing: ReturnType<typeof f.b.host.dispose>|null=null, closed=false;
 const target=started('preparing-cancel-session');
 const proxy=new Proxy(target,{getPrototypeOf(value){if(armed){ if(boundary==='dispose'){closing=f.b.host.dispose(); void closing.then(()=>{closed=true;});}else f.port.detach(f.who); return waiting.promise;}return Reflect.getPrototypeOf(value);}});
 expect(f.port.commit(f.who,proxy,2)).toBe(true); armed=true;
 const job=f.port.prepareCurrent(f.who,proxy,2);
 if(boundary==='detach'){closing=f.b.host.dispose(); void closing.then(()=>{closed=true;});}
 expect(closing).not.toBeNull(); await new Promise(r=>setTimeout(r,20));
 expect(closed).toBe(false);
 waiting.resolve(); await closing!;
 expect((await f.port.persistCurrent(job)).result.ok).toBe(false);
 expect(currentWrites()).toBe(before);
});

it("never treats an exact own-disposal prototype as a new drain dependency",async()=>{
 const f=await bound(); await write(f); let armed=false, closing: ReturnType<typeof f.b.host.dispose>|null=null;
 const proxy=new Proxy(started('own-disposal-prototype'),{getPrototypeOf(value){if(armed){closing=f.b.host.dispose();return closing;}return Reflect.getPrototypeOf(value);}});
 expect(f.port.commit(f.who,proxy,2)).toBe(true); armed=true;
 const job=f.port.prepareCurrent(f.who,proxy,2); expect(closing).not.toBeNull(); await closing!;
 expect((await f.port.persistCurrent(job)).result.ok).toBe(false);
});

// A real unsigned Account poll must not manufacture identity invalidation.
it('classifies unsigned native Account polling against a genuine freshly captured intent',async()=>{
 const h=await fixture(), b=await bootstrap(h), runtime=await b.start(); server(h);
 b.setUrl('https://app.example.invalid/?inviteToken=synthetic-preserve-unsigned');
 expect((await runtime.startUpOnce()).verdict.kind).toBe('signed_out');
 expect((await runtime.captureCurrentDeepLinkIntent()).kind).toBe('captured');
 expect(await runtime.loadPendingIntent()).toMatchObject({kind:'invitation'});
 const denial:unknown[]=[]; runtime.subscribeToIdentityInvalidations(v=>{denial.push(v);});
 const httpBefore=h.fetch.mock.calls.length, writesBefore=h.trace.filter(event=>event.kind==='run').length;
 await runtime.accountDeletion.getState();
 expect(await runtime.loadPendingIntent(),'incoming intent after unsigned background account poll').toMatchObject({kind:'invitation'});
 expect(denial).toHaveLength(0);
 expect(h.fetch.mock.calls).toHaveLength(httpBefore); expect(h.trace.filter(event=>event.kind==='run')).toHaveLength(writesBefore);
});

it("still removes an incoming intent on actual provider denial of an original admitted account", async () => {
  const f = await bound(); await write(f);
  f.b.setUrl("https://app.example.invalid/?inviteToken=synthetic-denial-policy");
  expect((await f.runtime.captureCurrentDeepLinkIntent()).kind).toBe("captured");
  const notices: unknown[] = []; f.runtime.subscribeToIdentityInvalidations(value => { notices.push(value); });
  const original = f.h.fetch.getMockImplementation()!;
  f.h.fetch.mockImplementation(async (...args) => (args[0] as Request).url.includes("/token?")
    ? response({ code: "refresh_token_not_found", message: "SYNTHETIC_PROVIDER_DENIAL" }, 400) : original(...args));
  const now = Date.now(); vi.spyOn(Date, "now").mockReturnValue(now + 3_601_000);
  expect((await f.runtime.accountDeletion.getState()).ok).toBe(false);
  expect(notices).toEqual([expect.objectContaining({ kind: "identity_invalidated" })]);
  expect(await f.runtime.loadPendingIntent()).toBeNull();
  expect(f.port.getSnapshot().mode).toBe("blocked");
});

it("denies actual account replacement during an account-first poll of an original admitted Tracker",async()=>{
 const f=await bound(); await write(f);
 const notices:unknown[]=[]; f.runtime.subscribeToIdentityInvalidations(v=>{notices.push(v);});
 const original=f.h.fetch.getMockImplementation()!; let foreignControlCalls=0;
 f.h.fetch.mockImplementation(async(...args)=>{
   if((args[0] as Request).url.includes('/token?')) {const result=await original(...args); const body=await result.json(); body.user.id='77777777-7777-4777-8777-777777777777'; return response(body);}
   if((args[0] as Request).url.endsWith('/get_my_account_deletion_control')) { foreignControlCalls++; return response({profile_id:'88888888-8888-4888-8888-888888888888',revision:0,pending:null}); }
   return original(...args);
 });
 const now=Date.now(); vi.spyOn(Date,'now').mockReturnValue(now+3_601_000);
 expect((await f.runtime.accountDeletion.getState()).ok).toBe(false);
 expect(notices).toEqual([expect.objectContaining({kind:'identity_invalidated'})]);
 expect(f.port.getSnapshot().mode).toBe('blocked');
 expect(foreignControlCalls).toBe(0); await fault(f); expect(f.port.getSnapshot().mode).toBe('blocked');
});

it("keeps same-account status confirmation and original Q1 proof healthy", async () => {
  const f = await bound(); await write(f);
  expect(await f.runtime.accountDeletion.getState()).toEqual({ ok: true, value: null });
  expect(f.port.getSnapshot().mode).toBe("normal");
  await fault(f); expect(f.port.getSnapshot().mode).toBe("continuing");
});
it("allows actual account-first status before completed Profile admission after genuine OTP", async () => {
  const h = await fixture(), b = await bootstrap(h), runtime = await b.start(); server(h);
  expect((await runtime.startUpOnce()).verdict.kind).toBe("signed_out");
  expect((await runtime.coordinator.requestEmailOtp("synthetic@example.invalid")).kind).toBe("otp_requested");
  expect(await runtime.coordinator.verifyEmailOtp("synthetic@example.invalid", "123456")).toMatchObject({ kind: "resolved", gate: { kind: "onboarding_required" } });
  expect(runtime.createSportingApplicationScope(profileId)).toBeNull();
  expect(await runtime.accountDeletion.getState()).toEqual({ ok: true, value: null });
});

// Supersession and genuine null-admission denial controls.
it("does not lend a replacement-account denial to a newer actual OTP admission",async()=>{
 const f=await bound(); await write(f); const notice:unknown[]=[]; f.runtime.subscribeToIdentityInvalidations(v=>notice.push(v));
 const entered=deferred<void>(), release=deferred<void>(); releases.push(()=>release.resolve()); const original=f.h.fetch.getMockImplementation()!;
 f.h.fetch.mockImplementation(async(...args)=>{if((args[0] as Request).url.includes('/token?')){entered.resolve();await release.promise;const result=await original(...args);const body=await result.json();body.user.id='77777777-7777-4777-8777-777777777777';return response(body);}return original(...args);});
 const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+3_601_000);
 const old=f.runtime.accountDeletion.getState();await entered.promise;
 const otp=f.runtime.coordinator.requestEmailOtp('synthetic@example.invalid');release.resolve();
 expect((await old).ok).toBe(false);expect((await otp).kind).toBe('otp_requested');
 expect(await f.runtime.coordinator.verifyEmailOtp('synthetic@example.invalid','123456')).toMatchObject({kind:'resolved',gate:{kind:'ready_online'}});
 expect(notice).toHaveLength(0);
 const binding=f.registry.bindNativeTrackerRuntime(f.runtime,profileId)!;expect(binding).not.toBeNull();const who={};binding.tracker.attach(who);binding.tracker.context(who,'train',false);
 const value=started('new-admission-training');expect(binding.tracker.commit(who,value,1)).toBe(true);
 expect((await binding.tracker.persistCurrent(binding.tracker.prepareCurrent(who,value,1))).result.ok).toBe(true);
 await fault(f);expect(binding.tracker.getSnapshot().mode).toBe('continuing');expect(f.port.getSnapshot().mode).toBe('blocked');
});
it("retains actual invalid_session denial without any original Profile admission",async()=>{
 const h=await fixture('valid'),b=await bootstrap(h),runtime=await b.start();server(h);
 b.setUrl('https://app.example.invalid/?inviteToken=actual-null-admission-denial');
 expect((await runtime.captureCurrentDeepLinkIntent()).kind).toBe('captured');expect(await runtime.loadPendingIntent()).not.toBeNull();
 const notice:unknown[]=[];runtime.subscribeToIdentityInvalidations(v=>notice.push(v));const original=h.fetch.getMockImplementation()!;
 h.fetch.mockImplementation(async(...args)=>(args[0] as Request).url.includes('/token?')?response({code:'refresh_token_not_found',message:'SYNTHETIC_TYPED_DENIAL'},400):original(...args));
 const now=Date.now();vi.spyOn(Date,'now').mockReturnValue(now+3_601_000);
 expect((await runtime.accountDeletion.getState()).ok).toBe(false);expect(notice).toEqual([expect.objectContaining({kind:'identity_invalidated'})]);expect(await runtime.loadPendingIntent()).toBeNull();
});


for (const method of ["state", "cancel"] as const) it.each(["none", "pending", "wrong-request"] as const)(`denies a validated different Profile before Account ${method} %s effects`, async variant => {
  const f = await bound(); await write(f);
  const foreign = "88888888-8888-4888-8888-888888888888", requestId = "99999999-9999-4999-8999-999999999999";
  const pending = variant === "none" ? null : { profile_id: foreign, request_id: variant === "pending" ? requestId : "77777777-7777-4777-8777-777777777777", requested_at: "2026-10-25T00:00:00Z", finalize_after: "2026-11-24T00:00:00Z" };
  const notices: unknown[] = []; f.runtime.subscribeToIdentityInvalidations(value => { notices.push(value); });
  const observed = vi.fn(), original = f.h.fetch.getMockImplementation()!; let mutationCalls = 0;
  f.h.fetch.mockImplementation(async (...args) => {
    const url = (args[0] as Request).url;
    if (/\/(cancel_my_account_deletion|abort_my_uncommitted_account_deletion)$/.test(url)) mutationCalls++;
    return url.endsWith("/get_my_account_deletion_control") ? response({ profile_id: foreign, revision: 0, pending }) : original(...args);
  });
  expect((await (method === "state" ? f.runtime.accountDeletion.getState(observed) : f.runtime.accountDeletion.cancel(requestId))).ok).toBe(false);
  expect(observed).not.toHaveBeenCalled(); expect(mutationCalls).toBe(0);
  const { DELETION_GUARD_PREFIX } = await import("../../identity/accountDeletionGuard");
  expect(f.h.trace.some(event => event.values?.some(value => typeof value === "string" && value.startsWith(DELETION_GUARD_PREFIX + foreign)))).toBe(false);
  expect(f.port.getSnapshot().mode).toBe("blocked");
  expect(notices).toEqual([expect.objectContaining({ kind: "identity_invalidated" })]);
  await fault(f); expect(f.port.getSnapshot().mode).toBe("blocked");
});
it.each(["revision", "pending-profile", "pending-date"] as const)("does not invent Profile denial from malformed %s control", async malformed => {
  const f = await bound(); await write(f); const notices: unknown[] = []; f.runtime.subscribeToIdentityInvalidations(value => { notices.push(value); });
  const foreign = "88888888-8888-4888-8888-888888888888", original = f.h.fetch.getMockImplementation()!;
  const pending = malformed === "revision" ? null : { profile_id: malformed === "pending-profile" ? profileId : foreign, request_id: "99999999-9999-4999-8999-999999999999", requested_at: "2026-10-25T00:00:00Z", finalize_after: malformed === "pending-date" ? "invalid" : "2026-11-24T00:00:00Z" };
  f.h.fetch.mockImplementation(async (...args) => (args[0] as Request).url.endsWith("/get_my_account_deletion_control") ? response({ profile_id: foreign, revision: malformed === "revision" ? -1 : 0, pending }) : original(...args));
  expect((await f.runtime.accountDeletion.getState()).ok).toBe(false); expect(notices).toHaveLength(0);
  expect(f.port.getSnapshot().mode).toBe("normal"); await fault(f); expect(f.port.getSnapshot().mode).toBe("continuing");
});
it("does not let a late contradicted Profile deny a newer actual admission", async () => {
  const f = await bound(); await write(f); const notices: unknown[] = []; f.runtime.subscribeToIdentityInvalidations(value => { notices.push(value); });
  const entered = deferred<void>(), release = deferred<void>(); releases.push(() => release.resolve()); const original = f.h.fetch.getMockImplementation()!;
  f.h.fetch.mockImplementation(async (...args) => { if ((args[0] as Request).url.endsWith("/get_my_account_deletion_control")) { entered.resolve(); await release.promise; return response({ profile_id: "88888888-8888-4888-8888-888888888888", revision: 0, pending: null }); } return original(...args); });
  const old = f.runtime.accountDeletion.getState(); await entered.promise;
  const otp = f.runtime.coordinator.requestEmailOtp("synthetic@example.invalid"); release.resolve();
  expect((await old).ok).toBe(false); expect((await otp).kind).toBe("otp_requested");
  expect(await f.runtime.coordinator.verifyEmailOtp("synthetic@example.invalid", "123456")).toMatchObject({ kind: "resolved", gate: { kind: "ready_online" } });
  expect(notices).toHaveLength(0); const binding = f.registry.bindNativeTrackerRuntime(f.runtime, profileId)!; expect(binding).not.toBeNull();
  const who = {}, value = started("fresh-after-profile-supersession"); binding.tracker.attach(who); binding.tracker.context(who, "train", false);
  expect(binding.tracker.commit(who, value, 1)).toBe(true); expect((await binding.tracker.persistCurrent(binding.tracker.prepareCurrent(who, value, 1))).result.ok).toBe(true);
  await fault(f); expect(binding.tracker.getSnapshot().mode).toBe("continuing"); expect(f.port.getSnapshot().mode).toBe("blocked");
});
