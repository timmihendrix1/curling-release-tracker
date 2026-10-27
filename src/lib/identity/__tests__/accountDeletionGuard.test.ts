import { describe, expect, it } from "vitest";
import { createAccountDeletionGuardRepository, DELETION_GUARD_PREFIX, DELETION_GUARD_RESOLUTION_PREFIX } from "../accountDeletionGuard";
import { createIdentityHarness, createMemoryStorage, IDENTITY_A, PROFILE_A, PINNED_TERMS, PINNED_PRIVACY } from "./support/identityTestHarness";
const PROFILE_B = "50000000-0000-4000-8000-000000000005";
const nonce = "30000000-0000-4000-8000-000000000003";
const newerNonce = "40000000-0000-4000-8000-000000000004";
function fixture() {
  const storage = createMemoryStorage();
  return { storage, guards: createAccountDeletionGuardRepository(storage.adapter) };
}
function onboard(h: ReturnType<typeof createIdentityHarness>) {
  h.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
  h.identityBackend.accounts.set(IDENTITY_A.accountScopeId, { profileId: PROFILE_A, displayName: "Athlete", onboardingCompletedAt: "2026-02-01T09:00:00.000Z", hasAthleteCapability: true, freeEntitlementActive: true, pinnedTerms: PINNED_TERMS, pinnedPrivacy: PINNED_PRIVACY });
  h.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
}
describe("deletion operation admission guard", () => {
  it("survives fresh same-Profile OTP and an offline reload even when ordinary trust is rewritten", async () => {
    const { storage, guards } = fixture();
    const first = createIdentityHarness({ storage, deletionGuards: guards }); onboard(first);
    await first.coordinator.requestEmailOtp("a@example.test");
    expect((await first.coordinator.verifyEmailOtp("a@example.test", "123456")).kind).toBe("resolved");
    expect(await guards.begin(PROFILE_A, 0, nonce)).not.toBeNull();
    await first.coordinator.invalidateIdentity();
    const second = createIdentityHarness({ storage, deletionGuards: guards }); onboard(second);
    await second.coordinator.requestEmailOtp("a@example.test");
    const reauth = await second.coordinator.verifyEmailOtp("a@example.test", "123456");
    expect(reauth.kind).toBe("resolved");
    if (reauth.kind === "resolved") expect(reauth.gate.kind).toBe("identity_unconfirmed");
    const reload = createIdentityHarness({ storage, deletionGuards: guards });
    reload.fakeAuth.state.restore = { kind: "temporarily_unavailable" };
    expect((await reload.coordinator.startUp()).verdict.kind).toBe("identity_unconfirmed");
    expect(await guards.canAdmit(PROFILE_B)).toBe(true);
  });
  it("denies a mounted tab on guard observation and background revalidation even offline", async () => {
    const { storage, guards } = fixture();
    const h = createIdentityHarness({ storage, deletionGuards: guards }); onboard(h);
    await h.coordinator.requestEmailOtp("a@example.test"); await h.coordinator.verifyEmailOtp("a@example.test", "123456");
    await guards.begin(PROFILE_A, 0, nonce);
    expect((await h.coordinator.observeNewerBarrier()).kind).toBe("newer_barrier");
    h.fakeAuth.state.restore = { kind: "temporarily_unavailable" };
    expect((await h.coordinator.revalidateGateFacts()).kind).toBe("identity_invalidated");
  });
  it("an old resolution cannot erase a newer operation, including another tab's overlapping write", async () => {
    const { guards } = fixture();
    const old = await guards.begin(PROFILE_A, 0, nonce);
    await guards.begin(PROFILE_A, 1, newerNonce);
    expect(await guards.resolve(old!, 1)).toBe(true);
    expect(await guards.canAdmit(PROFILE_A)).toBe(false);
    const current = await guards.load(PROFILE_A);
    if (current.status !== "guard") throw Error("missing guard");
    expect(await guards.resolve(current.guard, 1)).toBe(false);
    expect(await guards.resolve(current.guard, 2)).toBe(true);
    expect(await guards.canAdmit(PROFILE_A)).toBe(true);
  });
  it.each(["{", "null", '{"schemaVersion":2}', JSON.stringify({ schemaVersion: 1, profileId: PROFILE_B, nonce, revision: 0 })])("refuses malformed/future/foreign guard evidence: %s", async raw => {
    const { storage, guards } = fixture();
    storage.store.set(`${DELETION_GUARD_PREFIX}${PROFILE_A}.v1`, raw);
    expect(await guards.canAdmit(PROFILE_A)).toBe(false);
    expect(await guards.begin(PROFILE_A, 0, nonce)).toBeNull();
  });
  it("refuses malformed resolutions and failed storage reads/writes", async () => {
    const { storage, guards } = fixture();
    await guards.begin(PROFILE_A, 0, nonce);
    storage.store.set(`${DELETION_GUARD_RESOLUTION_PREFIX}${nonce}.v1`, "{}");
    expect(await guards.canAdmit(PROFILE_A)).toBe(false);
    const bad = createAccountDeletionGuardRepository({ get: async () => { throw null; }, set: async () => { throw null; } });
    expect(await bad.canAdmit(PROFILE_A)).toBe(false);
    expect(await bad.begin(PROFILE_A, 0, nonce)).toBeNull();
  });
});
