// @vitest-environment jsdom
import { afterEach, beforeAll, beforeEach, expect, it, vi } from "vitest";
import { createInstallationTransferSourceHelper } from "../src/sourceHelper";

const state = vi.hoisted(() => ({
  calls: [] as string[], thenReads: 0, callback: null as null | ((value: unknown) => void),
  info: { id: "local.dev.curlingperformance", version: "1.0", build: "1" } as unknown,
  foreground: { isActive: true } as unknown,
  registration: null as Promise<unknown> | null,
  infoHook: null as null | (() => unknown), stateHook: null as null | (() => unknown),
  overrides: null as null | Record<string, unknown>, onRegistration: null as null | (() => void), receiver: null as object | null,
  onProperty: null as null | ((name: string) => void),
}));
vi.mock("@capacitor/app", async () => {
  const actual = await vi.importActual<typeof import("@capacitor/app")>("@capacitor/app");
  // Instrument the installed Core/App proxy, not a hand-written plugin engine.
  const receiver = new Proxy(actual.App, { get(target, property) {
    if (property === "then") state.thenReads++;
    if (typeof property === "string") state.onProperty?.(property);
    if (typeof property === "string" && state.overrides && Object.hasOwn(state.overrides, property)) return state.overrides[property];
    return Reflect.get(target, property);
  } });
  state.receiver = receiver; return { App: receiver };
});
let core: typeof import("@capacitor/core")["Capacitor"];
const helpers: ReturnType<typeof createInstallationTransferSourceHelper>[] = [];
function helper() { const value = createInstallationTransferSourceHelper(); helpers.push(value); return value; }
function pending() { let resolve!: (value: unknown) => void; const promise = new Promise<unknown>(yes => { resolve = yes; }); return { promise, resolve }; }
const tick = () => new Promise<void>(resolve => setTimeout(resolve, 5));
const storage = localStorage, prototype = Storage.prototype, nativeGet = prototype.getItem, nativeSet = prototype.setItem, nativeClear = prototype.clear;
const store = (key: string, value: string) => Reflect.apply(nativeSet, storage, [key, value]);

beforeAll(async () => {
  vi.stubGlobal("webkit", { messageHandlers: { bridge: {} } });
  vi.stubGlobal("Capacitor", {
    PluginHeaders: [{ name: "App", methods: ["getState", "getInfo", "then", "removeListener"].map(name => ({ name, rtype: "promise" })).concat([{ name: "addListener", rtype: "callback" }]) }],
    nativePromise(plugin: string, method: string) {
      state.calls.push(plugin + ":" + method);
      if (method === "getInfo") return state.infoHook ? state.infoHook() : Promise.resolve(state.info);
      if (method === "getState") return state.stateHook ? state.stateHook() : Promise.resolve(state.foreground);
      return Promise.resolve(undefined);
    },
    nativeCallback(plugin: string, method: string, _options: unknown, callback: (value: unknown) => void) {
      state.calls.push(plugin + ":" + method); state.callback = callback; state.onRegistration?.();
      return state.registration ?? Promise.resolve("synthetic-listener");
    },
  });
  core = (await import("@capacitor/core")).Capacitor;
});
beforeEach(() => {
  state.calls = []; state.thenReads = 0; state.callback = null; state.registration = null; state.infoHook = null; state.stateHook = null; state.overrides = null; state.onRegistration = null; state.onProperty = null;
  state.info = { id: "local.dev.curlingperformance", version: "1.0", build: "1" }; state.foreground = { isActive: true };
  vi.stubGlobal("webkit", { messageHandlers: { bridge: {} } }); Reflect.apply(nativeClear, storage, []);
});
afterEach(async () => {
  vi.restoreAllMocks();
  for (const value of helpers.splice(0)) await value.close();
  vi.unstubAllGlobals(); Reflect.apply(nativeClear, storage, []);
});

it("constructs without platform/storage operations, then uses the installed App proxy and actual Web Storage", async () => {
  const reads = vi.spyOn(prototype, "getItem"), writes = vi.spyOn(prototype, "setItem"), removes = vi.spyOn(prototype, "removeItem");
  const value = helper(); expect(reads).not.toHaveBeenCalled(); expect(state.calls).toEqual([]);
  const result = await value.inspect();
  expect(result).toMatchObject({ ok: true, kind: "source_observation", counts: { profiles: 0, slots: 6 }, mayIssue: false, mayPublish: false, mayMount: false });
  expect(Object.isFrozen(result)).toBe(true); expect(Object.getPrototypeOf(result)).toBeNull();
  expect(state.calls).toEqual(["App:addListener", "App:getState", "App:getInfo", "App:getState", "App:getInfo"]);
  expect(state.thenReads).toBe(0); expect(reads).toHaveBeenCalled(); expect(writes).not.toHaveBeenCalled(); expect(removes).not.toHaveBeenCalled();
  await value.close(); expect(await value.inspect()).toMatchObject({ ok: false, code: "closed" });
});
it.each(["web", "android", "plugin-missing", "wrong-id", "missing-version", "bad-build", "background"])("refuses %s before any storage observation", async kind => {
  if (kind === "web") vi.stubGlobal("webkit", undefined);
  if (kind === "android") vi.stubGlobal("androidBridge", {});
  if (kind === "plugin-missing") vi.spyOn(core, "isPluginAvailable").mockReturnValue(false);
  if (kind === "wrong-id") state.info = { id: "me.evolane.curling", version: "1", build: "1" };
  if (kind === "missing-version") state.info = { id: "local.dev.curlingperformance", build: "1" };
  if (kind === "bad-build") state.info = { id: "local.dev.curlingperformance", version: "1", build: "https://invalid" };
  if (kind === "background") state.foreground = { isActive: false };
  const reads = vi.spyOn(prototype, "getItem"), keys = vi.spyOn(prototype, "key");
  const value = helper(); expect((await value.inspect()).ok).toBe(false); expect(reads).not.toHaveBeenCalled(); expect(keys).not.toHaveBeenCalled();
  expect(state.thenReads).toBe(0); expect(await value.inspect()).toMatchObject({ ok: false, code: "closed" });
});
it("never reads excluded credentials or foreign raws and exposes no source proof/metadata", async () => {
  store("sb-synthetic-auth-token", "excluded-secret"); store("foreign", "other-private-data");
  const gets: string[] = []; vi.spyOn(prototype, "getItem").mockImplementation(function(this: Storage, key) { gets.push(key); return Reflect.apply(nativeGet, this, [key]); });
  const result = await helper().inspect(); expect(result.ok).toBe(true); expect(gets).not.toContain("sb-synthetic-auth-token"); expect(gets).not.toContain("foreign");
  expect(JSON.stringify(result).includes("private")).toBe(false); expect(Object.hasOwn(result, "proof")).toBe(false); expect(Object.hasOwn(result, "id")).toBe(false); expect(Object.hasOwn(result, "wire")).toBe(false);
});
it.each(["unknown", "throw"])("drains later source refusal without App.then: %s", async kind => {
  if (kind === "unknown") store("curling.future", "opaque");
  else vi.spyOn(prototype, "getItem").mockImplementation(() => { throw new Proxy({}, { get() { throw null; } }); });
  const value = helper(); expect((await value.inspect()).ok).toBe(false); await value.close(); expect(state.thenReads).toBe(0);
  expect(state.calls.every(call => ["App:addListener", "App:getState", "App:getInfo", "App:removeListener"].includes(call))).toBe(true);
});
it("does not invoke AppInfo accessors or inspect thrown reasons", async () => {
  let getters = 0; const info = { id: "local.dev.curlingperformance", build: "1" };
  Object.defineProperty(info, "version", { get() { getters++; throw null; } }); state.info = info;
  expect((await helper().inspect()).ok).toBe(false); expect(getters).toBe(0); expect(state.thenReads).toBe(0);
});
it("holds pending AppInfo through close and refuses concurrent inspection", async () => {
  const gate = pending(), started = pending(); state.infoHook = () => { started.resolve(null); return gate.promise; };
  const value = helper(); let done = false, ended = false; const work = value.inspect().then(result => { done = true; return result; });
  try {
    await started.promise; expect(await value.inspect()).toMatchObject({ ok: false, code: "unavailable" });
    const closing = value.close().then(() => { ended = true; }); await tick(); expect(done).toBe(false); expect(ended).toBe(false);
    gate.resolve(state.info); expect(await work).toMatchObject({ ok: false, code: "closed" }); await closing;
    expect(state.calls.filter(call => call === "App:removeListener")).toHaveLength(1);
  } finally { gate.resolve(state.info); await work; }
});
it("retains a late listener handle through revocation and removes it once", async () => {
  const gate = pending(), started = pending(); state.registration = gate.promise; state.onRegistration = () => { started.resolve(null); }; const value = helper(), work = value.inspect();
  try {
    await Promise.race([started.promise, work.then(() => { throw new Error("Registration was not issued"); })]); let ended = false; const closing = value.close().then(() => { ended = true; }); await tick(); expect(ended).toBe(false);
    gate.resolve("synthetic-listener"); expect(await work).toMatchObject({ ok: false, code: "closed" }); await closing; await tick();
    expect(state.calls.filter(call => call === "App:removeListener")).toHaveLength(1); expect(state.calls).not.toContain("App:getInfo");
  } finally { gate.resolve("synthetic-listener"); await work; }
});
it.each([false, undefined, "true"])("native background/malformed event terminally closes: %s", async isActive => {
  const value = helper(); expect((await value.inspect()).ok).toBe(true); state.callback!({ isActive });
  expect(await value.inspect()).toMatchObject({ ok: false, code: "closed" }); await value.close(); expect(state.thenReads).toBe(0);
});
it("refuses AppInfo changes and source changes between capture/fence", async () => {
  const value = helper(); expect((await value.inspect()).ok).toBe(true);
  state.info = { id: "local.dev.curlingperformance", version: "2", build: "2" };
  const reads = vi.spyOn(prototype, "getItem"); expect((await value.inspect()).ok).toBe(false); expect(reads).not.toHaveBeenCalled();
});
it("refuses an actual source change after capture rather than publishing old counts", async () => {
  let calls = 0; state.infoHook = () => { if (++calls === 2) store("foreign-new", "synthetic"); return Promise.resolve(state.info); };
  expect(await helper().inspect()).toMatchObject({ ok: false, code: "source_changed" }); expect(state.thenReads).toBe(0);
});
it("revokes while an actual source read reenters close, with a normal provider return", async () => {
  const value = helper(); let called = false;
  vi.spyOn(prototype, "getItem").mockImplementation(function(this: Storage, key) {
    if (!called) { called = true; void value.close(); } return Reflect.apply(nativeGet, this, [key]);
  });
  expect(await value.inspect()).toMatchObject({ ok: false, code: "closed" }); await value.close(); expect(called).toBe(true);
});
it.each(["info", "callback"])("never assimilates the admitted App receiver as malformed %s data", async kind => {
  const value = helper();
  if (kind === "info") state.overrides = { getInfo: () => state.receiver };
  const result = await value.inspect();
  if (kind === "info") expect(result.ok).toBe(false);
  else { expect(result.ok).toBe(true); state.callback!(state.receiver); }
  await value.close(); expect(state.thenReads).toBe(0); expect(state.calls).not.toContain("App:then");
});
it.each(["close", "inspection"])("excludes directly observed helper-own %s work without a cycle", async kind => {
  const value = helper();
  state.overrides = { getInfo: () => kind === "close" ? value.close() : work };
  const work = value.inspect(); expect((await work).ok).toBe(false); await value.close(); expect(state.thenReads).toBe(0);
});
it("captures a handle even when listener invocation synchronously closes the helper", async () => {
  const remove = vi.fn(() => Promise.resolve(undefined));
  state.overrides = { addListener: (_name: string, callback: (value: unknown) => void) => {
    callback({ isActive: false }); return Promise.resolve({ remove });
  } };
  const value = helper(); expect(await value.inspect()).toMatchObject({ ok: false, code: "closed" }); await value.close();
  expect(remove).toHaveBeenCalledTimes(1); expect(state.calls).not.toContain("App:getState"); expect(state.thenReads).toBe(0);
});
it("waits for directly observed pending removal work and keeps the exact close identity", async () => {
  const gate = pending(), started = pending(); Object.defineProperty(gate.promise, "then", { value: null });
  state.overrides = { addListener: () => Promise.resolve({ remove() { started.resolve(null); return gate.promise; } }) };
  const value = helper(); expect((await value.inspect()).ok).toBe(true);
  let done = false; const closing = value.close(); expect(value.close()).toBe(closing); void closing.then(() => { done = true; });
  try { await started.promise; await tick(); expect(done).toBe(false); gate.resolve(undefined); await closing; expect(done).toBe(true); }
  finally { gate.resolve(undefined); await closing; }
});
it("owns masked pending method metadata and refuses an asynchronous replacement before storage", async () => {
  const gate = pending(), started = pending(); Object.defineProperty(gate.promise, "then", { value: null }); state.overrides = { getInfo: gate.promise };
  state.onProperty = name => { if (name === "getInfo") started.resolve(null); };
  const reads = vi.spyOn(prototype, "getItem"), value = helper(); let done = false;
  const work = value.inspect().then(result => { done = true; return result; });
  try {
    await Promise.race([started.promise, work.then(() => { throw new Error("Pending metadata not observed"); })]); await tick(); expect(done).toBe(false); const closing = value.close(); gate.resolve(() => Promise.resolve(state.info));
    expect((await work).ok).toBe(false); await closing; expect(reads).not.toHaveBeenCalled(); expect(state.thenReads).toBe(0);
  } finally { gate.resolve(undefined); await work; }
});
it("retains refused callback accessor work without invoking the getter", async () => {
  const value = helper(); expect((await value.inspect()).ok).toBe(true);
  const gate = pending(); let calls = 0, observations = 0;
  const getter = () => { calls++; throw null; };
  Object.defineProperty(getter, "then", { value(resolve: (value: unknown) => void) { observations++; void gate.promise.then(resolve); } });
  const payload = Object.defineProperty({}, "isActive", { get: getter }); state.callback!(payload);
  let done = false; const closing = value.close().then(() => { done = true; });
  try { await tick(); expect(done).toBe(false); expect(calls).toBe(0); expect(observations).toBe(1); gate.resolve(undefined); await closing; }
  finally { gate.resolve(undefined); await closing; }
});
it("bounds overlapping callback observation and terminally revokes on overlap", async () => {
  const value = helper(); expect((await value.inspect()).ok).toBe(true); const gate = pending();
  state.callback!({ isActive: true, then: gate.promise });
  expect(await value.inspect()).toMatchObject({ ok: false, code: "unavailable" });
  state.callback!({ isActive: true }); expect(await value.inspect()).toMatchObject({ ok: false, code: "closed" });
  let done = false; const closing = value.close().then(() => { done = true; });
  try { await tick(); expect(done).toBe(false); gate.resolve(undefined); await closing; }
  finally { gate.resolve(undefined); await closing; }
});
it("does not inspect opaque plugin rejection reasons", async () => {
  let touches = 0; const reason = new Proxy({}, { get() { touches++; throw null; }, ownKeys() { touches++; throw null; }, getPrototypeOf() { touches++; throw null; } });
  state.overrides = { getInfo: () => Promise.reject(reason) };
  const value = helper(); expect((await value.inspect()).ok).toBe(false); await value.close(); expect(touches).toBe(0); expect(state.thenReads).toBe(0);
});

// Independent review's three failures and eight passing controls, unchanged in meaning.
it("repeats a healthy unchanged actual inspection without new listener or App.then", async () => {
  const value = helper(); expect(await value.inspect()).toMatchObject({ ok: true }); expect(await value.inspect()).toMatchObject({ ok: true });
  expect(state.calls.filter(call => call === "App:addListener")).toHaveLength(1); expect(state.thenReads).toBe(0);
});
it("stops before a later AppInfo descriptor after known malformed version", async () => {
  const gate = pending(), started = pending(); let later = 0;
  state.info = new Proxy({ id: "local.dev.curlingperformance", version: 17, build: "1" }, {
    getOwnPropertyDescriptor(target, name) {
      if (name === "version") started.resolve(null);
      if (name === "build") { later++; return { configurable: true, enumerable: true, writable: true, value: gate.promise }; }
      return Reflect.getOwnPropertyDescriptor(target, name);
    },
  });
  const value = helper(), work = value.inspect(); let done = false; void work.then(() => { done = true; });
  try { await started.promise; await tick(); expect(later).toBe(0); expect(done).toBe(true); }
  finally { gate.resolve("1"); await work; }
});
it("does not read another AppInfo descriptor after malformed id", async () => {
  let later = 0; state.info = new Proxy({ id: 17, version: "1", build: "1" }, {
    getOwnPropertyDescriptor(target, name) { if (name !== "id") later++; return Reflect.getOwnPropertyDescriptor(target, name); },
  });
  expect((await helper().inspect()).ok).toBe(false); expect(later).toBe(0);
});
it.each(["native", "thenable", "field"])("independent malformed issued info %s remains owned until settlement", async kind => {
  const gate = pending(), started = pending(); Object.defineProperty(gate.promise, "then", { value: null });
  state.overrides = { getInfo: () => {
    started.resolve(null);
    if (kind === "native") return Promise.resolve(gate.promise);
    if (kind === "thenable") return { then(resolve: (value: unknown) => void) { resolve(gate.promise); } };
    return { then: gate.promise };
  } };
  const value = helper(); let done = false; const work = value.inspect().then(result => { done = true; return result; });
  try { await started.promise; await tick(); expect(done).toBe(false); const closing = value.close(); gate.resolve(null); expect((await work).ok).toBe(false); await closing; }
  finally { gate.resolve(null); await work; }
});
it.each(["native", "thenable", "field"])("independent helper-close removal child %s is excluded", async kind => {
  const value = helper(); state.overrides = { addListener: () => Promise.resolve({ remove() {
    const closing = value.close();
    if (kind === "native") { Object.defineProperty(closing, "then", { value: null }); return Promise.resolve(closing); }
    if (kind === "thenable") return { then(resolve: (value: unknown) => void) { resolve(closing); } };
    return { then: closing };
  } }) };
  expect((await value.inspect()).ok).toBe(true); await value.close();
});
it("independent native Core/App harness positive control", async () => {
  const value = helper(); expect(await value.inspect()).toMatchObject({ ok: true }); expect(core.isNativePlatform()).toBe(true); expect(core.getPlatform()).toBe("ios"); expect(core.isPluginAvailable("App")).toBe(true);
});
async function realEntry() {
  vi.resetModules(); vi.stubGlobal("Capacitor", core);
  document.body.innerHTML = '<button id="inspect" disabled>Check data</button><p id="status" role="status"></p>';
  vi.spyOn(document, "visibilityState", "get").mockReturnValue("visible");
  const sourceModule = await import("../src/sourceHelper"), actual = sourceModule.createInstallationTransferSourceHelper;
  let value!: ReturnType<typeof actual>;
  vi.spyOn(sourceModule, "createInstallationTransferSourceHelper").mockImplementation(() => { value = actual(); helpers.push(value); return value; });
  await import("../src/main");
  return { value, button: document.getElementById("inspect") as HTMLButtonElement, status: document.getElementById("status")! };
}
it("updates the idle visible entry after actual native retirement, including repeated healthy checks", async () => {
  const { value, button, status } = await realEntry();
  try {
    button.click(); await expect.poll(() => status.textContent).toContain("Source data observed");
    button.click(); await expect.poll(() => status.textContent).toContain("Source data observed");
    expect(state.calls.filter(call => call === "App:addListener")).toHaveLength(1); expect(state.thenReads).toBe(0);
    state.callback!({ isActive: false }); await value.whenRevoked;
    expect(button.disabled).toBe(true); expect(status.textContent).toContain("ended");
  } finally { window.dispatchEvent(new Event("pagehide")); await value.close(); }
});
it("signals native revocation during pending inspection before joined close can settle", async () => {
  const gate = pending(), started = pending(); state.infoHook = () => { started.resolve(null); return gate.promise; };
  const { value, button, status } = await realEntry();
  try {
    button.click(); await started.promise; state.callback!({ isActive: false }); expect(await value.whenRevoked).toBe("closed");
    expect(button.disabled).toBe(true); expect(status.textContent).toContain("ended");
    let closed = false; const closing = value.close().then(() => { closed = true; }); await tick(); expect(closed).toBe(false);
    gate.resolve(state.info); await closing; await tick(); expect(status.textContent).toContain("ended");
  } finally { gate.resolve(state.info); window.dispatchEvent(new Event("pagehide")); await value.close(); }
});
it("signals idle native revocation while removal is still pending", async () => {
  const gate = pending(), started = pending(); state.overrides = { addListener: (_name: string, callback: (value: unknown) => void) => {
    state.callback = callback; return Promise.resolve({ remove() { started.resolve(null); return gate.promise; } });
  } };
  const { value, button, status } = await realEntry();
  try {
    button.click(); await expect.poll(() => status.textContent).toContain("Source data observed");
    state.callback!({ isActive: false }); expect(await value.whenRevoked).toBe("closed"); await started.promise;
    expect(button.disabled).toBe(true); expect(status.textContent).toContain("ended");
    let closed = false; const closing = value.close().then(() => { closed = true; }); await tick(); expect(closed).toBe(false);
    gate.resolve(undefined); await closing;
  } finally { gate.resolve(undefined); window.dispatchEvent(new Event("pagehide")); await value.close(); }
});
it("reinspection recaptures the actual source while preserving one listener", async () => {
  const reads = vi.spyOn(prototype, "getItem"), value = helper(); expect(await value.inspect()).toMatchObject({ ok: true, counts: { profiles: 0 } });
  const before = reads.mock.calls.length;
  store("curling.sporting.profile.v1.10000000-0000-4000-8000-000000000001.curling-release-tracker-current-session", "synthetic-raw");
  expect(await value.inspect()).toMatchObject({ ok: true, counts: { profiles: 1, slots: 19 } }); expect(reads.mock.calls.length > before).toBe(true);
  expect(state.calls.filter(call => call === "App:addListener")).toHaveLength(1); expect(state.thenReads).toBe(0);
});
it("never treats its logical revocation signal as a platform result or cleanup ACK", async () => {
  const value = helper(); state.overrides = { getInfo: () => value.whenRevoked };
  expect((await value.inspect()).ok).toBe(false); expect(await value.whenRevoked).toBe("unavailable"); await value.close(); expect(state.thenReads).toBe(0);
});
it("stops a known nonnative host before reading later platform method metadata", async () => {
  vi.spyOn(core, "isNativePlatform").mockReturnValue(false);
  const original = Object.getOwnPropertyDescriptor(core, "getPlatform")!; let reads = 0;
  Object.defineProperty(core, "getPlatform", { configurable: true, get() { reads++; throw null; } });
  try { expect(await helper().inspect()).toMatchObject({ ok: false, code: "wrong_host" }); expect(reads).toBe(0); }
  finally { Object.defineProperty(core, "getPlatform", original); }
});
