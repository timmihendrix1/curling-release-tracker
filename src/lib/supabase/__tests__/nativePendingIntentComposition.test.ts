import { expect, it, vi } from "vitest";
import { bootstrap, deferred, fixture, releases } from "./nativeTrackerFixture";
import { createPendingIntent, PENDING_INTENT_STORAGE_KEY } from "../../identity/pendingIntentRepository";
const intent = (value = "synthetic-native-link-a") => createPendingIntent({ kind: "invitation", value, capturedAt: "2026-10-25T12:00:00Z" })!;
async function host() {
  const h = await fixture(), b = await bootstrap(h), runtime = await b.start();
  const { resolveNativeApplicationComposition } = await import("../../persistence/nativeTrackerRegistry");
  const composition = resolveNativeApplicationComposition(runtime)!;
  const capture = (value?: string) => runtime.coordinator.capturePendingIntent(intent(value));
  const observe = async () => { const view = await composition.observePendingIntent(); if (view.kind !== "known" || !view.intent) throw new Error("Synthetic replay unavailable"); return view.intent; };
  return { h, b, runtime, composition, capture, observe };
}
it("binds the final frozen public view and memoizes unchanged observations", async () => {
  const a = await host(); await a.capture(); const first = await a.observe();
  expect(Object.isFrozen(first)).toBe(true); expect(await a.observe()).toBe(first);
  expect(await a.composition.discardPendingIntent(first)).toBe(true); expect(await a.runtime.loadPendingIntent()).toBeNull();
});
it("rejects copies/lookalikes/throwing proxies without reflection, SQL, or provider I/O", async () => {
  const a = await host(); await a.capture(); const first = await a.observe(), calls = a.h.trace.length;
  const touched = vi.fn(() => { throw new Error("Synthetic candidate must remain opaque"); });
  for (const value of [{ ...first }, {}, new Proxy(first, { get: touched, getPrototypeOf: touched, ownKeys: touched })]) {
    expect(await a.composition.discardPendingIntent(value)).toBe(false);
    expect(await a.composition.recoverInvitationAccount(value)).toBeNull();
  }
  expect(touched).not.toHaveBeenCalled(); expect(a.h.trace).toHaveLength(calls); expect(a.h.fetch).not.toHaveBeenCalled();
});
it("keeps a newer identical A after an actual A→B→A capture with frozen time", async () => {
  const a = await host(); await a.capture(); const old = await a.observe(); await a.capture("synthetic-b"); await a.capture();
  const fresh = await a.observe(); expect(fresh).toEqual(old); expect(fresh).not.toBe(old);
  expect(await a.composition.discardPendingIntent(old)).toBe(false); expect(await a.composition.recoverInvitationAccount(old)).toBeNull();
  expect(await a.runtime.loadPendingIntent()).toEqual(fresh);
});
it("refuses a snapshot made stale between real lane read and final host publication", async () => {
  const a = await host(); await a.capture();
  const readEntered = deferred<void>(), readRelease = deferred<void>(), saveEntered = deferred<void>(), saveRelease = deferred<void>();
  releases.push(() => readRelease.resolve(), () => saveRelease.resolve()); let first = true;
  a.h.sqlFaults.hook = async (event, next) => {
    if (first && event.kind === "query" && event.values?.[0] === PENDING_INTENT_STORAGE_KEY) { first = false; const result = await next(); readEntered.resolve(); await readRelease.promise; return result; }
    if (event.kind === "run" && event.values?.[0] === PENDING_INTENT_STORAGE_KEY) { saveEntered.resolve(); await saveRelease.promise; }
    return next();
  };
  const observation = a.composition.observePendingIntent(); await readEntered.promise;
  const replacement = a.capture("synthetic-b"); readRelease.resolve(); await saveEntered.promise;
  expect(await observation).toEqual({ kind: "unavailable" }); saveRelease.resolve(); await replacement;
  expect(await a.observe()).toMatchObject({ value: "synthetic-b" });
});
it("publishes genuine changes without waiting for listener read reentrancy", async () => {
  const a = await host(); let callback!: Promise<unknown>;
  const changed = vi.fn(() => { callback = a.composition.observePendingIntent(); return callback; });
  const off = a.composition.subscribeToPendingIntentChanges(changed);
  expect(await a.capture()).toEqual({ kind: "applied" }); expect(changed).toHaveBeenCalledOnce();
  expect(await callback).toMatchObject({ kind: "known", intent: { value: intent().value } });
  off(); await a.capture("synthetic-b"); expect(changed).toHaveBeenCalledOnce();
});
it("holds real callback work and SDK reservation through terminal close", async () => {
  const a = await host(), gate = deferred<void>(); releases.push(() => gate.resolve());
  const changed = vi.fn(() => gate.promise); a.composition.subscribeToPendingIntentChanges(changed);
  expect(await a.capture()).toEqual({ kind: "applied" });
  let done = false; const close = a.b.host.dispose().then(result => { done = true; return result; });
  expect((await a.h.make()).ok).toBe(false); expect(done).toBe(false);
  gate.resolve(); expect(await close).toEqual({ ok: true }); expect(changed).toHaveBeenCalledOnce();
  expect(await a.composition.observePendingIntent()).toEqual({ kind: "unavailable" });
});
it("keeps an issued but unverified SQLite removal blocked when close prevents commit", async () => {
  const a = await host(); await a.capture(); const view = await a.observe();
  const entered = deferred<void>(), gate = deferred<void>(); releases.push(() => gate.resolve());
  a.h.sqlFaults.hook = async (event, next) => {
    const actual = await next();
    if (event.kind === "run" && event.sql?.startsWith("DELETE FROM records") && event.values?.[0] === PENDING_INTENT_STORAGE_KEY) { entered.resolve(); await gate.promise; }
    return actual;
  };
  const removal = a.composition.discardPendingIntent(view); await entered.promise;
  let done = false; const close = a.b.host.dispose().then(result => { done = true; return result; });
  expect(done).toBe(false); gate.resolve(); expect(await removal).toBe(false);
  // The actual source revoked before COMMIT and reports evidence held; the
  // presentation boundary must not invent a factual successful removal.
  expect(await close).toMatchObject({ ok: false });
});
it("preserves the real positive removal ACK when its notification closes the host before publication", async () => {
  const a = await host(); await a.capture(); const view = await a.observe();
  let closed!: ReturnType<typeof a.b.host.dispose>;
  a.composition.subscribeToPendingIntentChanges(() => { closed = a.b.host.dispose(); return closed; });
  expect(await a.composition.discardPendingIntent(view)).toBe(true); expect(await closed).toEqual({ ok: true });
});
it("owns the exact genuine disposal only once and stops later notification delivery on close", async () => {
  const a = await host(); let closed!: ReturnType<typeof a.b.host.dispose>;
  const later = vi.fn();
  a.composition.subscribeToPendingIntentChanges(() => { closed = a.b.host.dispose(); return closed; });
  a.composition.subscribeToPendingIntentChanges(later);
  // Capture itself is durable; its general runtime projection may be vetoed by
  // close. The returned genuine disposal must not become its own prerequisite.
  await a.capture(); expect(await closed).toEqual({ ok: true }); expect(later).not.toHaveBeenCalled();
});
