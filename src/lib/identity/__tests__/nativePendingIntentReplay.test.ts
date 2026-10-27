import { describe, expect, it, vi } from "vitest";
import { createFakeIdentityService } from "../fakeIdentityService";
import type { NativePendingIntentReplay, TransitionIdentity } from "../identityTransitionCoordinator";
import { createPendingIntent, INTENT_CLEANUP_STORAGE_KEY } from "../pendingIntentRepository";
import { createIdentityHarness, FIXED_NOW, holdStorageCall, STORAGE_KEYS, type IdentityHarness } from "./support/identityTestHarness";

const invitation = (value = "synthetic-replay-a") => createPendingIntent({ kind: "invitation", value, capturedAt: FIXED_NOW })!;
function harness() {
  let observe!: () => Promise<NativePendingIntentReplay | null>, close!: () => TransitionIdentity;
  const changed = vi.fn();
  const h: IdentityHarness = createIdentityHarness({ now: () => FIXED_NOW, nativeOwnership: {
    bind: () => ({ auth: h.fakeAuth.auth, identity: () => createFakeIdentityService(h.identityBackend), takeAuthObservation: () => null }),
    admissionAllowed: () => true, ownStartup: () => {},
    ownClose: value => { close = value; }, ownPendingIntentReplay: value => { observe = value; }, pendingIntentChanged: changed,
  } });
  const stored = () => h.storage.store.has(STORAGE_KEYS.intent) ? JSON.parse(h.storage.store.get(STORAGE_KEYS.intent)!) : null;
  const captured = async (value = "synthetic-replay-a") => { expect(await h.coordinator.capturePendingIntent(invitation(value))).toEqual({ kind: "applied" }); };
  return { ...h, observe, close, changed, stored, captured };
}
async function present(h: ReturnType<typeof harness>) {
  const view = await h.observe(); expect(view?.intent).not.toBeNull(); expect(view?.current()).toBe(true); return view!;
}

describe("private native pending-intent replay on the real effect lane", () => {
  it("observes without claiming access, and memoizes only the same immutable observation", async () => {
    const h = harness(); await h.captured(); const before = h.issuedIds.length;
    const a = await present(h); expect(Object.isFrozen(a.intent)).toBe(true); expect(await h.observe()).toBe(a);
    expect(h.issuedIds).toHaveLength(before); expect(h.progress).toEqual([]);
  });
  it("revokes old A across A→B→A with identical bytes and a frozen clock", async () => {
    const h = harness(); await h.captured(); const old = await present(h);
    await h.captured("synthetic-replay-b"); await h.captured();
    const newer = await present(h); expect(newer.intent).toEqual(old.intent); expect(newer).not.toBe(old);
    expect(old.current()).toBe(false); expect(await old.discard()).toEqual({ kind: "superseded" }); expect(h.stored()).toEqual(newer.intent);
  });
  it("orders a queued capture before an older discard", async () => {
    const h = harness(); await h.captured(); const old = await present(h);
    const hold = holdStorageCall(h.storage, `set:${STORAGE_KEYS.intent}`);
    const capture = h.coordinator.capturePendingIntent(invitation("synthetic-replay-b")); await hold.reached;
    const removal = old.discard(); hold.release(); await capture;
    expect(await removal).toEqual({ kind: "superseded" }); expect(h.stored().value).toBe("synthetic-replay-b");
  });
  it("finishes an earlier discard before admitting the next capture", async () => {
    const h = harness(); await h.captured(); const old = await present(h);
    const hold = holdStorageCall(h.storage, `remove:${STORAGE_KEYS.intent}`);
    const removal = old.discard(); await hold.reached;
    const capture = h.coordinator.capturePendingIntent(invitation("synthetic-replay-b")); hold.release();
    expect(await removal).toEqual({ kind: "applied" }); await capture; expect(h.stored().value).toBe("synthetic-replay-b");
  });
  it.each(["read_failed", "malformed"])("keeps %s distinct from known absence and retires the old observation", async mode => {
    const h = harness(); await h.captured(); const old = await present(h);
    if (mode === "read_failed") h.storage.failReads.add(STORAGE_KEYS.intent); else h.storage.seedRaw(STORAGE_KEYS.intent, "{synthetic malformed");
    expect(await h.observe()).toBeNull(); expect(old.current()).toBe(false);
    h.storage.failReads.clear(); h.storage.seed(STORAGE_KEYS.intent, invitation());
    const fresh = await present(h); expect(fresh).not.toBe(old); expect(await old.discard()).toEqual({ kind: "superseded" });
  });
  it("retires A on observed absence and never restores it when the same bytes return", async () => {
    const h = harness(); await h.captured(); const old = await present(h);
    h.storage.store.delete(STORAGE_KEYS.intent); expect((await h.observe())?.intent).toBeNull();
    h.storage.seed(STORAGE_KEYS.intent, invitation()); expect(await present(h)).not.toBe(old);
    expect(await old.discard()).toEqual({ kind: "superseded" });
  });
  it("refuses a changed fresh record even without a local capture notification", async () => {
    const h = harness(); await h.captured(); const old = await present(h);
    h.storage.seed(STORAGE_KEYS.intent, invitation("synthetic-external-b"));
    expect(await old.discard()).toEqual({ kind: "superseded" }); expect(h.stored().value).toBe("synthetic-external-b");
  });
  it("recovery's fresh changed observation permanently retires A even if identical bytes return", async () => {
    const h = harness(); await h.captured(); const old = await present(h);
    h.storage.seed(STORAGE_KEYS.intent, invitation("synthetic-external-b")); expect(await old.recover()).toBeNull();
    h.storage.seed(STORAGE_KEYS.intent, invitation()); expect(old.current()).toBe(false); expect(await old.recover()).toBeNull();
    expect(h.progress).toEqual([]); expect(h.fakeAuth.counts.signOut).toBe(0);
  });
  it.each(["absent", "unreadable"])("conditional discard distinguishes fresh %s from replacement", async mode => {
    const h = harness(); await h.captured(); const old = await present(h);
    if (mode === "absent") h.storage.store.delete(STORAGE_KEYS.intent); else h.storage.failReads.add(STORAGE_KEYS.intent);
    expect(await old.discard()).toEqual({ kind: mode === "absent" ? "not_required" : "blocked" }); expect(old.current()).toBe(false);
  });
  it.each(["failed_capture", "absent_discard"])("conservatively revokes on %s", async mode => {
    const h = harness(); await h.captured(); const old = await present(h); h.changed.mockClear();
    if (mode === "failed_capture") { h.storage.failWrites.add(STORAGE_KEYS.intent); await h.coordinator.capturePendingIntent(invitation("synthetic-b")); }
    else { h.storage.store.delete(STORAGE_KEYS.intent); await h.coordinator.discardPendingIntent(); }
    expect(h.changed).toHaveBeenCalledOnce(); expect(old.current()).toBe(false);
  });
  it("rejects before removal after a foreground begins, even before its first barrier await", async () => {
    const h = harness(); await h.captured(); const old = await present(h), epoch = h.liveGeneration.current();
    const hold = holdStorageCall(h.storage, `set:${STORAGE_KEYS.barrier}`);
    const otp = h.coordinator.requestEmailOtp("synthetic@example.invalid");
    expect(h.liveGeneration.current()).toBe(epoch); expect(old.current()).toBe(false);
    await hold.reached; const discard = old.discard(); hold.release(); await otp;
    expect(await discard).toEqual({ kind: "superseded" }); expect(h.stored()).not.toBeNull();
  });
  it("a background operation sequence alone does not synchronously revoke the foreground observation", async () => {
    const h = harness(); await h.captured(); const old = await present(h);
    const operation = h.coordinator.revalidateGateFacts(); expect(old.current()).toBe(true); await operation;
  });
  it("retains an actually issued removal's ACK after its own revision rotation and close", async () => {
    const h = harness(); await h.captured(); const old = await present(h);
    const hold = holdStorageCall(h.storage, `remove:${STORAGE_KEYS.intent}`);
    const removal = old.discard(); await hold.reached; expect(old.current()).toBe(false); h.close(); hold.release();
    expect(await removal).toEqual({ kind: "applied" }); expect(h.stored()).toBeNull(); expect(await h.observe()).toBeNull();
  });
  it("returns the actual failed remove without resurrecting its observation", async () => {
    const h = harness(); await h.captured(); const old = await present(h); h.storage.failRemoves.add(STORAGE_KEYS.intent);
    expect(await old.discard()).toEqual({ kind: "blocked" }); expect(old.current()).toBe(false); expect(h.stored()).not.toBeNull();
  });
  it("close before entry causes no new storage or provider work", async () => {
    const h = harness(); await h.captured(); const old = await present(h); h.close(); const calls = [...h.storage.calls];
    expect(await old.discard()).toEqual({ kind: "superseded" }); expect(await old.recover()).toBeNull(); expect(await h.observe()).toBeNull();
    expect(h.storage.calls).toEqual(calls); expect(h.fakeAuth.counts.signOut).toBe(0);
  });
  it("keeps outstanding denial cleanup authoritative over capture and recovery", async () => {
    const h = harness(); await h.captured(); const old = await present(h);
    h.storage.seed(INTENT_CLEANUP_STORAGE_KEY, { schemaVersion: 1, recordedAt: FIXED_NOW });
    expect(await h.coordinator.capturePendingIntent(invitation("synthetic-b"))).toEqual({ kind: "blocked" });
    expect(await old.recover()).toBeNull(); expect(h.fakeAuth.counts.signOut).toBe(0);
    const fresh = await present(h); expect(await fresh.recover()).toMatchObject({ kind: "intent_state_not_persisted" });
    expect(h.fakeAuth.counts.signOut).toBe(0); expect(h.storage.store.has(INTENT_CLEANUP_STORAGE_KEY)).toBe(true);
  });
});

describe("conditional recovery before actual BEGIN and inside the real recovery body", () => {
  it.each([false, true])("refuses queued newer capture before BEGIN, including identical ABA=%s", async aba => {
    const h = harness(); await h.captured(); const old = await present(h);
    const capture = h.coordinator.capturePendingIntent(invitation("synthetic-b"));
    const second = aba ? h.coordinator.capturePendingIntent(invitation()) : null;
    const recovery = old.recover(); await capture; await second;
    expect(await recovery).toBeNull(); expect(h.progress).toEqual([]); expect(h.issuedIds).toEqual([]); expect(h.fakeAuth.counts.signOut).toBe(0);
    expect(h.stored().value).toBe(aba ? invitation().value : "synthetic-b");
  });
  it("preserves B arriving after BEGIN but before survival marking, with zero provider signout", async () => {
    const h = harness(); await h.captured(); const old = await present(h);
    const hold = holdStorageCall(h.storage, `get:${STORAGE_KEYS.trusted}`);
    const recovery = old.recover(); await hold.reached;
    await h.captured("synthetic-b"); hold.release();
    expect(await recovery).toMatchObject({ kind: "intent_state_not_persisted" }); expect(h.stored().value).toBe("synthetic-b"); expect(h.fakeAuth.counts.signOut).toBe(0);
  });
  it("serializes mark and other-intent cleanup so a capture queued during mark survives afterwards", async () => {
    const h = harness(); await h.captured(); const old = await present(h);
    const hold = holdStorageCall(h.storage, `set:${STORAGE_KEYS.intent}`);
    const recovery = old.recover(); await hold.reached;
    const capture = h.coordinator.capturePendingIntent(invitation("synthetic-b")); hold.release();
    expect(await recovery).toMatchObject({ kind: "signed_out_locked" }); await capture;
    expect(h.stored()).toMatchObject({ value: "synthetic-b", survival: "ordinary" }); expect(h.fakeAuth.counts.signOut).toBe(1);
  });
  it("checks actual access ownership again after a delayed mark ACK", async () => {
    const h = harness(); await h.captured(); const old = await present(h);
    const hold = holdStorageCall(h.storage, `set:${STORAGE_KEYS.intent}`);
    const recovery = old.recover(); await hold.reached;
    const readsAtMark = h.storage.calls.filter(value => value === `get:${STORAGE_KEYS.intent}`).length;
    const otp = h.coordinator.requestEmailOtp("synthetic@example.invalid"); hold.release();
    expect(await recovery).toMatchObject({ kind: "superseded" }); await otp;
    expect(h.storage.calls.filter(value => value === `get:${STORAGE_KEYS.intent}`)).toHaveLength(readsAtMark);
    expect(h.fakeAuth.counts.signOut).toBe(0);
  });
});
