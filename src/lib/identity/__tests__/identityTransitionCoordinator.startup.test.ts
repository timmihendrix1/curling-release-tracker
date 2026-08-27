// Startup: Phase 0's seven branches end to end, the required ordering, the two
// live Google epochs, the five callback lifecycle stages, and the barrier
// resolution protocol (ADR-0025 §4, §6, §7, §8, §9).
//
// Everything here runs against the REAL capture cell, the REAL repositories and
// the REAL Phase 0 decision — only the window seam, the provider and the identity
// RPCs are faked, and the identity fake performs the same transitions the RPCs do.
import { describe, expect, it } from "vitest";
import {
  ATTEMPT_A,
  ATTEMPT_B,
  BARRIER_A,
  BARRIER_C,
  COMPLETE_LEGAL_ROWS,
  FIXED_NOW,
  FLOW_X,
  FLOW_Y,
  IDENTITY_A,
  PROFILE_A,
  REDIRECT_TARGET,
  STORAGE_KEYS,
  SYNTHETIC_CODE,
  callbackUrl,
  createIdentityHarness,
  createMemoryStorage,
  type MemoryStorage,
  PINNED_PRIVACY,
  PINNED_TERMS,
  report,
} from "./support/identityTestHarness";
import { createIdentityAccessBarrier } from "../identityBarrier";
import { createGoogleAttempt } from "../interactiveAttempt";
import { createIdentityBarrierResolution } from "../identityBarrierResolution";
import { createTrustedDeviceRecord } from "../trustedDevice";
import { isGateReady, reduceGateState, initialGateState } from "../gateState";

function seedBarrier(storage: MemoryStorage, barrierId = BARRIER_A): void {
  storage.seed(
    STORAGE_KEYS.barrier,
    createIdentityAccessBarrier({
      barrierId,
      origin: "interactive_authentication",
      barredAccountScopeId: null,
      barredGeneration: null,
      establishedAt: FIXED_NOW,
    })
  );
}

function seedGoogleAttempt(
  storage: MemoryStorage,
  options: { barrierId?: string; attemptId?: string; flowId?: string; generation?: number } = {}
): void {
  storage.seed(
    STORAGE_KEYS.attempt,
    createGoogleAttempt({
      attemptId: options.attemptId ?? ATTEMPT_A,
      flowId: options.flowId ?? FLOW_X,
      barrierId: options.barrierId ?? BARRIER_A,
      capturedIdentityGeneration: options.generation ?? 1,
      startedAt: FIXED_NOW,
    })
  );
}

function seedResolution(
  storage: MemoryStorage,
  options: {
    barrierId?: string;
    attemptId?: string;
    flowId?: string;
    generation?: number;
    accountScopeId?: string;
  } = {}
): void {
  const barrierId = options.barrierId ?? BARRIER_A;
  storage.seed(
    STORAGE_KEYS.resolutionFor(barrierId),
    createIdentityBarrierResolution({
      barrierId,
      attemptId: options.attemptId ?? ATTEMPT_A,
      method: "google",
      flowId: options.flowId ?? FLOW_X,
      identityGeneration: options.generation ?? 1,
      authenticatedAccountScopeId: options.accountScopeId ?? IDENTITY_A.accountScopeId,
      resolvedAt: FIXED_NOW,
    })
  );
}

function seedTrusted(storage: MemoryStorage, accountScopeId = IDENTITY_A.accountScopeId): void {
  storage.seed(
    STORAGE_KEYS.trusted,
    createTrustedDeviceRecord({
      accountScopeId,
      profileId: PROFILE_A,
      displayName: "Athlete",
      onboardingCompletedAt: "2026-02-01T09:00:00.000Z",
      generation: 1,
      establishedAt: FIXED_NOW,
      lastServerConfirmationAt: FIXED_NOW,
    })
  );
}

/** Marks the identity backend as an onboarded account for `IDENTITY_A`. */
function completeAccount(harness: ReturnType<typeof createIdentityHarness>): void {
  harness.identityBackend.currentAccountScopeId = IDENTITY_A.accountScopeId;
  harness.identityBackend.accounts.set(IDENTITY_A.accountScopeId, {
    profileId: PROFILE_A,
    displayName: "Athlete",
    onboardingCompletedAt: "2026-02-01T09:00:00.000Z",
    hasAthleteCapability: true,
    freeEntitlementActive: true,
    pinnedTerms: PINNED_TERMS,
    pinnedPrivacy: PINNED_PRIVACY,
  });
}

const SUCCESS_URL = callbackUrl({ code: SYNTHETIC_CODE, flowId: FLOW_X });

describe("branch A — no callback candidate", () => {
  it("with no barrier and no session, proceeds to ordinary restoration and offers sign-in", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    const outcome = await harness.coordinator.startUp();
    expect(outcome.callback).toEqual({ kind: "no_return" });
    expect(outcome.verdict.kind).toBe("signed_out");
    expect(outcome.finalization).toBeNull();
    expect(harness.fakeAuth.counts.exchange).toBe(0);
    expect(harness.fakeAuth.counts.restore).toBe(1);
  });

  it("an unresolved barrier with NO admissible continuation stays locked — and never contacts the provider", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    const outcome = await harness.coordinator.startUp();
    expect(outcome.callback).toEqual({ kind: "no_return" });
    expect(outcome.verdict).toEqual({
      kind: "quarantined_locked",
      origin: "interactive_authentication",
    });
    // A barrier with no completed set denies regardless of what a session lookup
    // would say, so no session lookup happens.
    expect(harness.fakeAuth.counts.restore).toBe(0);
    expect(harness.fakeAuth.counts.exchange).toBe(0);
  });

  it("an interrupted OTP flow renders locked recovery on reload", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedBarrier(harness.storage);
    harness.storage.seed(STORAGE_KEYS.attempt, {
      schemaVersion: 1,
      attemptId: ATTEMPT_A,
      method: "email_otp",
      flowId: null,
      barrierId: BARRIER_A,
      capturedIdentityGeneration: 1,
      startedAt: FIXED_NOW,
    });
    const outcome = await harness.coordinator.startUp();
    expect(outcome.verdict.kind).toBe("quarantined_locked");
  });
});

describe("branch B — an admitted continuation", () => {
  it("exchanges exactly once with the callback-matched selector, persists the resolution, and binds the identity", async () => {
    const harness = createIdentityHarness({ url: SUCCESS_URL });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    completeAccount(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await harness.coordinator.startUp();

    expect(harness.fakeAuth.counts.exchange).toBe(1);
    expect(harness.fakeAuth.exchangeSelectors).toEqual([FLOW_X]);
    expect(outcome.callback).toEqual({ kind: "succeeded", identity: IDENTITY_A });
    expect(outcome.verdict.kind).toBe("ready_online");
    expect(outcome.finalization?.kind).toBe("resolved");

    // The resolution was written under the exact barrier's own derived key.
    expect(harness.storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_A))).toBe(true);
    // The barrier key itself was never removed.
    expect(harness.storage.calls).not.toContain(`remove:${STORAGE_KEYS.barrier}`);
    // The server-authoritative gate checks actually ran.
    expect(harness.identityBackend.calls).toContain("ensureProfile");
    expect(harness.identityBackend.calls).toContain("resolveGateFacts");
  });

  it("a missing resolution at intake does NOT quarantine", async () => {
    const harness = createIdentityHarness({ url: SUCCESS_URL });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    completeAccount(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    expect(harness.storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_A))).toBe(false);
    const outcome = await harness.coordinator.startUp();
    expect(outcome.verdict.kind).not.toBe("quarantined_locked");
  });

  it("the application shell stays blocked for the whole continuation, becoming ready only at the end", async () => {
    const harness = createIdentityHarness({ url: SUCCESS_URL });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    completeAccount(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await harness.coordinator.startUp();

    // Replaying the progress phases through the reducer: the gate is never ready
    // until the final verdict is applied.
    let state = initialGateState();
    for (const [phase, transition] of harness.progressEvents) {
      state = reduceGateState(state, { type: "progress", phase, transition });
      expect(isGateReady(state), phase).toBe(false);
    }
    expect(harness.progress).toEqual([
      "intaking_oauth_return",
      "consuming_oauth_return",
      "finalizing_identity",
      "ensuring_profile",
      "resolving_gate_facts",
      "establishing_trusted_state",
    ]);
    state = reduceGateState(state, {
      type: "startup_completed",
      callback: outcome.callback,
      verdict: outcome.verdict,
      transition: outcome.transition,
    });
    expect(isGateReady(state)).toBe(true);
  });
});

describe("branch C — a correlated provider error", () => {
  it("performs zero exchanges, leaves the barrier unresolved, and stays locked", async () => {
    const harness = createIdentityHarness({
      url: callbackUrl({ flowId: FLOW_X, error: "access_denied", errorDescription: "user cancelled" }),
    });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);

    const outcome = await harness.coordinator.startUp();

    expect(harness.fakeAuth.counts.exchange).toBe(0);
    expect(outcome.callback).toEqual({ kind: "provider_error" });
    expect(outcome.verdict.kind).toBe("quarantined_locked");
    expect(harness.storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_A))).toBe(false);
    // No raw provider text travels anywhere.
    const serialized = JSON.stringify(outcome);
    expect(serialized).not.toContain("access_denied");
    expect(serialized).not.toContain("user cancelled");
  });
});

describe("branch D — a stale callback", () => {
  it("callback X cannot exchange against or resolve attempt Y, and Y is left intact", async () => {
    const harness = createIdentityHarness({
      url: callbackUrl({ code: SYNTHETIC_CODE, flowId: FLOW_X }),
    });
    seedBarrier(harness.storage);
    // The current attempt is the NEWER one, flow Y.
    seedGoogleAttempt(harness.storage, { attemptId: ATTEMPT_B, flowId: FLOW_Y });
    const attemptBefore = harness.storage.store.get(STORAGE_KEYS.attempt);

    const outcome = await harness.coordinator.startUp();

    expect(harness.fakeAuth.counts.exchange).toBe(0);
    expect(outcome.callback).toEqual({ kind: "unowned_callback" });
    expect(outcome.verdict.kind).toBe("quarantined_locked");
    // The newer valid attempt survives byte-for-byte: a failed exchange would have
    // destroyed its verifier, which is why no exchange is attempted at all.
    expect(harness.storage.store.get(STORAGE_KEYS.attempt)).toBe(attemptBefore);
    expect(harness.storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_A))).toBe(false);
  });
});

describe("branch E — a replayed callback", () => {
  it("performs zero exchanges and does not invalidate the existing resolved set", async () => {
    const harness = createIdentityHarness({ url: SUCCESS_URL });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    seedResolution(harness.storage);
    const resolutionBefore = harness.storage.store.get(STORAGE_KEYS.resolutionFor(BARRIER_A));
    completeAccount(harness);
    seedTrusted(harness.storage);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await harness.coordinator.startUp();

    expect(harness.fakeAuth.counts.exchange).toBe(0);
    expect(outcome.callback).toEqual({ kind: "replayed_callback" });
    // Ordinary Phase A and Phase B proceed on the independently valid durable set.
    expect(outcome.verdict.kind).toBe("ready_online");
    expect(harness.storage.store.get(STORAGE_KEYS.resolutionFor(BARRIER_A))).toBe(resolutionBefore);
  });

  it("cleans the owned callback material from the URL", async () => {
    const harness = createIdentityHarness({ url: SUCCESS_URL });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    seedResolution(harness.storage);
    await harness.coordinator.startUp();
    const finalUrl = harness.currentUrl() ?? "";
    expect(finalUrl).not.toContain("code=");
    expect(finalUrl).not.toContain("sb_flow_id=");
    expect(finalUrl).not.toContain(SYNTHETIC_CODE);
  });
});

describe("branch F — ambiguous, malformed and implicit-grant returns", () => {
  it("an ambiguous return performs zero exchanges and creates no identity or resolution", async () => {
    const harness = createIdentityHarness({
      url: callbackUrl({ code: SYNTHETIC_CODE, flowId: FLOW_X, error: "access_denied" }),
    });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    const outcome = await harness.coordinator.startUp();
    expect(outcome.callback).toEqual({ kind: "ambiguous_callback" });
    expect(harness.fakeAuth.counts.exchange).toBe(0);
    expect(outcome.verdict.kind).toBe("quarantined_locked");
    expect(harness.storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_A))).toBe(false);
  });

  it("a code with no selector is malformed — never a fallback exchange", async () => {
    const harness = createIdentityHarness({ url: callbackUrl({ code: SYNTHETIC_CODE }) });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    const outcome = await harness.coordinator.startUp();
    expect(outcome.callback).toEqual({ kind: "malformed_callback" });
    expect(harness.fakeAuth.counts.exchange).toBe(0);
    expect(harness.fakeAuth.exchangeSelectors).toEqual([]);
  });

  it("an implicit-grant fragment is malformed, clears the fragment, and creates no identity", async () => {
    const harness = createIdentityHarness({
      url: callbackUrl({ hash: "access_token=must-not-be-used&refresh_token=x&token_type=bearer" }),
    });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    const outcome = await harness.coordinator.startUp();
    expect(outcome.callback).toEqual({ kind: "malformed_callback" });
    expect(harness.fakeAuth.counts.exchange).toBe(0);
    expect(harness.currentUrl() ?? "").not.toContain("access_token");
  });

  it("is NEVER an authentication source, even when a valid resolved set exists", async () => {
    const harness = createIdentityHarness({
      url: callbackUrl({ code: SYNTHETIC_CODE, flowId: FLOW_X, error: "access_denied" }),
    });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    seedResolution(harness.storage);
    seedTrusted(harness.storage);
    completeAccount(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await harness.coordinator.startUp();

    // The malformed arrival contributed nothing: the outcome comes purely from the
    // independently valid durable set plus ordinary restoration.
    expect(outcome.callback).toEqual({ kind: "ambiguous_callback" });
    expect(harness.fakeAuth.counts.exchange).toBe(0);
    expect(outcome.verdict.kind).toBe("ready_online");
  });

  it("with no barrier at all, a malformed return leaves ordinary restoration to decide", async () => {
    const harness = createIdentityHarness({ url: callbackUrl({ code: SYNTHETIC_CODE }) });
    const outcome = await harness.coordinator.startUp();
    expect(outcome.callback).toEqual({ kind: "malformed_callback" });
    expect(outcome.verdict.kind).toBe("signed_out");
    expect(harness.fakeAuth.counts.exchange).toBe(0);
  });
});

describe("branch G — a candidate with no barrier or no matching attempt", () => {
  it("is never a substitute for ordinary session restoration", async () => {
    const harness = createIdentityHarness({ url: SUCCESS_URL });
    // No barrier, no attempt — but a real session exists.
    seedTrusted(harness.storage);
    completeAccount(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.callback).toEqual({ kind: "unowned_callback" });
    expect(harness.fakeAuth.counts.exchange).toBe(0);
    // Access came from ordinary restoration and the trusted record, not from the
    // callback.
    expect(outcome.verdict.kind).toBe("ready_online");
    expect(harness.fakeAuth.counts.restore).toBe(1);
  });

  it("a barrier with no attempt stays locked, with zero exchanges", async () => {
    const harness = createIdentityHarness({ url: SUCCESS_URL });
    seedBarrier(harness.storage);
    const outcome = await harness.coordinator.startUp();
    expect(outcome.callback).toEqual({ kind: "unowned_callback" });
    expect(harness.fakeAuth.counts.exchange).toBe(0);
    expect(outcome.verdict.kind).toBe("quarantined_locked");
  });

  it("a malformed barrier fails closed rather than being treated as absent", async () => {
    const harness = createIdentityHarness({ url: SUCCESS_URL });
    harness.storage.seedRaw(STORAGE_KEYS.barrier, '{"schemaVersion":2}');
    const outcome = await harness.coordinator.startUp();
    expect(outcome.callback).toEqual({ kind: "unowned_callback" });
    expect(outcome.verdict).toEqual({ kind: "quarantined_locked", origin: null });
    expect(harness.fakeAuth.counts.restore).toBe(0);
  });
});

describe("required ordering: capture, classify and clean come first", () => {
  it("the URL is read and cleaned BEFORE any durable read and before any provider call", async () => {
    const harness = createIdentityHarness({ url: SUCCESS_URL });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    completeAccount(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    await harness.coordinator.startUp();

    const urlRead = harness.log.indexOf("url:read");
    const urlReplace = harness.log.indexOf("url:replace");
    const firstStorage = harness.log.findIndex((entry) => entry.startsWith("storage:"));
    const firstAuth = harness.log.findIndex((entry) => entry.startsWith("auth:"));

    expect(urlRead).toBeGreaterThanOrEqual(0);
    expect(urlReplace).toBeGreaterThan(urlRead);
    expect(firstStorage).toBeGreaterThan(urlReplace);
    expect(firstAuth).toBeGreaterThan(urlReplace);
  });

  it("the owned material is already gone from the URL by the time the first storage read happens", async () => {
    const harness = createIdentityHarness({ url: SUCCESS_URL });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    const urlsSeenDuringStorage: string[] = [];
    harness.storage.onBeforeCall = () => {
      urlsSeenDuringStorage.push(harness.currentUrl() ?? "");
    };

    await harness.coordinator.startUp();

    expect(urlsSeenDuringStorage.length).toBeGreaterThan(0);
    for (const url of urlsSeenDuringStorage) {
      expect(url).not.toContain("code=");
      expect(url).not.toContain("sb_flow_id=");
    }
  });

  it("the URL is read exactly once per page scope, even across repeated startUp calls", async () => {
    const harness = createIdentityHarness({ url: SUCCESS_URL });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    await harness.coordinator.startUp();
    const readsAfterFirst = harness.urlReads();
    await harness.coordinator.startUp();
    // The now-clean URL is never re-read: the cell is the single source of truth
    // for what this page load arrived with.
    expect(harness.urlReads()).toBe(readsAfterFirst);
  });

  it("unrelated query parameters survive the cleanup", async () => {
    const harness = createIdentityHarness({
      url: callbackUrl({
        code: SYNTHETIC_CODE,
        flowId: FLOW_X,
        extraQuery: { state: "unrelated", inviteToken: "keep-me", adminRequestId: "keep-me-too" },
      }),
    });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    await harness.coordinator.startUp();
    const finalUrl = harness.currentUrl() ?? "";
    expect(finalUrl).toContain("state=unrelated");
    expect(finalUrl).toContain("inviteToken=keep-me");
    expect(finalUrl).toContain("adminRequestId=keep-me-too");
    expect(finalUrl).not.toContain("code=");
  });
});

describe("the two live Google epochs (ADR-0025 §9)", () => {
  it("a flow started at live generation 7 succeeds on a callback page whose counter starts at 0", async () => {
    const storage = createMemoryStorage();

    // START PAGE: five prior bumps plus the barrier's own bump puts the attempt at
    // generation 7.
    const startPage = createIdentityHarness({
      url: REDIRECT_TARGET,
      storage,
      startingGeneration: 6,
    });
    const start = await startPage.coordinator.startGoogleSignIn();
    expect(report(start)).toEqual({ kind: "navigating" });
    const attemptRaw = storage.store.get(STORAGE_KEYS.attempt) as string;
    const persistedAttempt = JSON.parse(attemptRaw) as { capturedIdentityGeneration: number };
    expect(persistedAttempt.capturedIdentityGeneration).toBe(7);

    // CALLBACK PAGE: a genuinely new document. Fresh capture cell, fresh counter
    // at 0. The durable records survive.
    const callbackPage = createIdentityHarness({ url: SUCCESS_URL, storage });
    expect(callbackPage.liveGeneration.current()).toBe(0);
    completeAccount(callbackPage);
    callbackPage.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await callbackPage.coordinator.startUp();

    expect(callbackPage.fakeAuth.counts.exchange).toBe(1);
    expect(outcome.verdict.kind).toBe("ready_online");

    // The resolution copies the ATTEMPT's persisted 7 — never the callback page's
    // freshly reset counter.
    const barrierId = (JSON.parse(storage.store.get(STORAGE_KEYS.barrier) as string) as {
      barrierId: string;
    }).barrierId;
    const resolution = JSON.parse(
      storage.store.get(STORAGE_KEYS.resolutionFor(barrierId)) as string
    ) as { identityGeneration: number };
    expect(resolution.identityGeneration).toBe(7);
    expect(resolution.identityGeneration).not.toBe(callbackPage.liveGeneration.current());
  });

  it("a callback-page generation change while the exchange is pending yields correlation_changed and no resolution", async () => {
    const harness = createIdentityHarness({ url: SUCCESS_URL });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    // Another operation begins during the exchange, invalidating this page's epoch.
    harness.fakeAuth.state.exchange = { kind: "exchanged", identity: IDENTITY_A };
    const originalExchange = harness.fakeAuth.auth.exchangeCorrelatedCallback;
    harness.fakeAuth.auth.exchangeCorrelatedCallback = async (claim, expectedFlowId) => {
      harness.liveGeneration.bump();
      return originalExchange(claim, expectedFlowId);
    };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.callback).toEqual({ kind: "correlation_changed" });
    expect(report(outcome.finalization)).toEqual({ kind: "correlation_changed" });
    expect(harness.storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_A))).toBe(false);
    expect(outcome.verdict.kind).toBe("quarantined_locked");
  });
});

describe("the five callback lifecycle stages (ADR-0025 §7)", () => {
  it("stage 1 — before navigation: barrier and attempt exist, the resolution is intentionally absent", async () => {
    const storage = createMemoryStorage();
    const harness = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    await harness.coordinator.startGoogleSignIn();
    expect(storage.store.has(STORAGE_KEYS.barrier)).toBe(true);
    expect(storage.store.has(STORAGE_KEYS.attempt)).toBe(true);
    const barrierId = (JSON.parse(storage.store.get(STORAGE_KEYS.barrier) as string) as {
      barrierId: string;
    }).barrierId;
    expect(storage.store.has(STORAGE_KEYS.resolutionFor(barrierId))).toBe(false);
  });

  it("stage 2 — callback arrival before exchange: Phase 0 admits it, and Phase A's three-record rule does not apply", async () => {
    const harness = createIdentityHarness({ url: SUCCESS_URL });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    completeAccount(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    const outcome = await harness.coordinator.startUp();
    expect(outcome.verdict.kind).toBe("ready_online");
  });

  it("stage 3 — exchange pending while the SDK has already emitted SIGNED_IN: the app stays blocked", async () => {
    const harness = createIdentityHarness({ url: SUCCESS_URL });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    // The provider persists the session and emits the event BEFORE resolving, and
    // then the exchange itself fails. A post-hoc verdict cannot undo the session —
    // only the unresolved barrier can keep the app closed.
    let stateDuringExchange = initialGateState();
    harness.fakeAuth.auth.exchangeCorrelatedCallback = async () => {
      harness.fakeAuth.emit({ reason: "signed_in", identity: IDENTITY_A });
      stateDuringExchange = reduceGateState(stateDuringExchange, {
        type: "provider_auth_change",
        change: { reason: "signed_in", identity: IDENTITY_A },
      });
      return { kind: "exchange_failed" };
    };
    harness.fakeAuth.auth.onAuthChange(() => {});

    const outcome = await harness.coordinator.startUp();

    expect(isGateReady(stateDuringExchange)).toBe(false);
    expect(outcome.verdict.kind).toBe("quarantined_locked");
    expect(harness.storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_A))).toBe(false);
  });

  it("stage 4 — the resolution is written but C7 has not passed: no ready-producing outcome is emitted", async () => {
    const harness = createIdentityHarness({ url: SUCCESS_URL });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    completeAccount(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    // Another tab installs barrier C the instant the resolution write lands.
    const resolutionKey = STORAGE_KEYS.resolutionFor(BARRIER_A);
    harness.storage.onBeforeCall = (call) => {
      if (call === `set:${resolutionKey}`) {
        harness.storage.onBeforeCall = null;
        seedBarrier(harness.storage, BARRIER_C);
      }
    };

    const outcome = await harness.coordinator.startUp();

    expect(report(outcome.finalization)).toEqual({ kind: "correlation_changed" });
    expect(outcome.verdict.kind).not.toBe("ready_online");
    // Resolution B is on disk and harmless; barrier C is still unresolved.
    expect(harness.storage.store.has(resolutionKey)).toBe(true);
    expect(harness.storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_C))).toBe(false);
  });

  it("stage 5 — a completed set on a later load passes Phase A and Phase B", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    seedResolution(harness.storage);
    seedTrusted(harness.storage);
    completeAccount(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.callback).toEqual({ kind: "no_return" });
    expect(outcome.verdict.kind).toBe("ready_online");
  });
});

describe("the barrier resolution protocol (ADR-0025 §6)", () => {
  it("resolution B cannot resolve, remove or authorize a newer barrier C", async () => {
    const harness = createIdentityHarness({ url: SUCCESS_URL });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    completeAccount(harness);
    harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };

    const resolutionKey = STORAGE_KEYS.resolutionFor(BARRIER_A);
    harness.storage.onBeforeCall = (call) => {
      if (call === `set:${resolutionKey}`) {
        harness.storage.onBeforeCall = null;
        seedBarrier(harness.storage, BARRIER_C);
      }
    };

    await harness.coordinator.startUp();

    // Barrier C is untouched and unresolved.
    const barrierNow = JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      barrierId: string;
    };
    expect(barrierNow.barrierId).toBe(BARRIER_C);
    expect(harness.storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_C))).toBe(false);
    expect(harness.storage.calls).not.toContain(`remove:${STORAGE_KEYS.barrier}`);
  });

  it("a reload after that interleaving is still locked by barrier C", async () => {
    const storage = createMemoryStorage();
    seedBarrier(storage, BARRIER_C);
    seedGoogleAttempt(storage, { barrierId: BARRIER_A });
    seedResolution(storage, { barrierId: BARRIER_A });
    const harness = createIdentityHarness({ url: REDIRECT_TARGET, storage });
    const outcome = await harness.coordinator.startUp();
    expect(outcome.verdict).toEqual({
      kind: "quarantined_locked",
      origin: "interactive_authentication",
    });
  });

  it("a resolution write failure leaves no ready state and reports barrier_resolution_failed", async () => {
    const harness = createIdentityHarness({ url: SUCCESS_URL });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    harness.storage.failWrites.add(STORAGE_KEYS.resolutionFor(BARRIER_A));

    const outcome = await harness.coordinator.startUp();

    expect(report(outcome.finalization)).toEqual({ kind: "barrier_resolution_failed" });
    expect(outcome.verdict.kind).toBe("quarantined_locked");
    expect(harness.storage.store.has(STORAGE_KEYS.resolutionFor(BARRIER_A))).toBe(false);
    // The exchange DID happen and a session exists — the barrier is what keeps the
    // app closed.
    expect(harness.fakeAuth.counts.exchange).toBe(1);
  });

  it("no code path removes the current barrier key, in any startup branch", async () => {
    for (const url of [
      REDIRECT_TARGET,
      SUCCESS_URL,
      callbackUrl({ flowId: FLOW_X, error: "access_denied" }),
      callbackUrl({ code: SYNTHETIC_CODE, flowId: FLOW_X, error: "x" }),
      callbackUrl({ code: SYNTHETIC_CODE }),
    ]) {
      const harness = createIdentityHarness({ url });
      seedBarrier(harness.storage);
      seedGoogleAttempt(harness.storage);
      completeAccount(harness);
      harness.fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
      await harness.coordinator.startUp();
      expect(harness.storage.calls, url).not.toContain(`remove:${STORAGE_KEYS.barrier}`);
    }
  });
});

describe("durable correlation-set failures fail closed", () => {
  it("a missing current attempt while a resolution exists leaves the barrier unresolved", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedBarrier(harness.storage);
    seedResolution(harness.storage);
    const outcome = await harness.coordinator.startUp();
    expect(outcome.verdict.kind).toBe("quarantined_locked");
  });

  it("every mismatched resolution field fails closed", async () => {
    const mismatches: Array<[string, Parameters<typeof seedResolution>[1]]> = [
      ["a different attemptId", { attemptId: ATTEMPT_B }],
      ["a different selector", { flowId: FLOW_Y }],
      ["a different generation", { generation: 99 }],
    ];
    for (const [label, overrides] of mismatches) {
      const harness = createIdentityHarness({ url: REDIRECT_TARGET });
      seedBarrier(harness.storage);
      seedGoogleAttempt(harness.storage);
      seedResolution(harness.storage, overrides);
      const outcome = await harness.coordinator.startUp();
      expect(outcome.verdict.kind, label).toBe("quarantined_locked");
    }
  });

  it("a malformed resolution fails closed", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    harness.storage.seedRaw(STORAGE_KEYS.resolutionFor(BARRIER_A), "{oops");
    const outcome = await harness.coordinator.startUp();
    expect(outcome.verdict.kind).toBe("quarantined_locked");
  });

  it("a resolution stored under one barrier's key but naming another fails closed", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedBarrier(harness.storage);
    seedGoogleAttempt(harness.storage);
    harness.storage.seed(
      STORAGE_KEYS.resolutionFor(BARRIER_A),
      createIdentityBarrierResolution({
        barrierId: BARRIER_C,
        attemptId: ATTEMPT_A,
        method: "google",
        flowId: FLOW_X,
        identityGeneration: 1,
        authenticatedAccountScopeId: IDENTITY_A.accountScopeId,
        resolvedAt: FIXED_NOW,
      })
    );
    const outcome = await harness.coordinator.startUp();
    expect(outcome.verdict.kind).toBe("quarantined_locked");
  });

  it("an unreadable barrier fails closed without contacting the provider", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.failReads.add(STORAGE_KEYS.barrier);
    const outcome = await harness.coordinator.startUp();
    expect(outcome.verdict).toEqual({ kind: "quarantined_locked", origin: null });
    expect(harness.fakeAuth.counts.restore).toBe(0);
  });
});

describe("legal availability at the gate", () => {
  it("a missing current Privacy Notice means sign-in is not offered", async () => {
    const harness = createIdentityHarness({
      url: REDIRECT_TARGET,
      legalRows: [COMPLETE_LEGAL_ROWS[0]],
    });
    const outcome = await harness.coordinator.startUp();
    expect(outcome.verdict).toEqual({ kind: "legal_unavailable" });
  });

  it("an invalid legal response also means sign-in is not offered, and leaks nothing", async () => {
    const harness = createIdentityHarness({
      url: REDIRECT_TARGET,
      legalRows: [{ ...COMPLETE_LEGAL_ROWS[0], kind: "shadow_policy" }],
    });
    const outcome = await harness.coordinator.startUp();
    expect(outcome.verdict).toEqual({ kind: "legal_unavailable" });
    expect(JSON.stringify(outcome)).not.toContain("shadow_policy");
  });
});
