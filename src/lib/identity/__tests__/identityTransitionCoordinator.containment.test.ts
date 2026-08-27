// "All resolve, never throw", proved at every INJECTED boundary.
//
// Each dependency below is supplied by the composition root, so the contract is a
// property of whatever was passed in — not something the coordinator can assume. A
// throwing fake, a defective future implementation, or a browser API that starts
// throwing where it used to return must all produce a fixed closed outcome.
//
// Two properties are asserted for every case: the public method RESOLVES, and its
// substitute value is the DENY-WARD one — a contained failure never becomes a
// permissive result, and never opens the gate.
import { describe, expect, it } from "vitest";
import {
  createIdentityTransitionCoordinator,
  createLiveGenerationCounter,
  type IdentityCoordinatorDeps,
} from "../identityTransitionCoordinator";
import { isGateReady, reduceGateState, initialGateState } from "../gateState";
import {
  ATTEMPT_A,
  BARRIER_A,
  COMPLETE_LEGAL_ROWS,
  FIXED_NOW,
  FLOW_X,
  IDENTITY_A,
  PROFILE_A,
  REDIRECT_TARGET,
  STORAGE_KEYS,
  SYNTHETIC_CODE,
  callbackUrl,
  createFakeAuth,
  createIdentityHarness,
  createMemoryStorage,
  report,
} from "./support/identityTestHarness";
import { createIdentityBarrierRepository } from "../identityBarrierRepository";
import { createInteractiveAttemptRepository } from "../interactiveAttemptRepository";
import { createIdentityBarrierResolutionRepository } from "../identityBarrierResolutionRepository";
import { createTrustedDeviceRepository } from "../trustedDeviceRepository";
import { createPendingIntent, createPendingIntentRepository } from "../pendingIntentRepository";
import {
  createFakeIdentityBackend,
  createFakeIdentityService,
} from "../fakeIdentityService";
import { createCallbackCaptureCell } from "../../supabase/supabaseCallbackCapture";
import { createIdentityAccessBarrier } from "../identityBarrier";
import { createGoogleAttempt } from "../interactiveAttempt";
import { createTrustedDeviceRecord } from "../trustedDevice";

/** Every shape a dependency can fail with. A thrown non-`Error` is the case a
 * naive `error.message` or `instanceof` check gets wrong. */
const HOSTILE_THROWS: Array<[string, unknown]> = [
  ["Error", new Error("sb_secret_must_not_travel")],
  ["string", "sb_secret_must_not_travel"],
  ["Symbol", Symbol("sb_secret_must_not_travel")],
  ["null", null],
  ["undefined", undefined],
  ["number", 42],
  [
    "hostile Proxy",
    new Proxy(
      {},
      {
        get() {
          throw new Error("sb_secret_must_not_travel");
        },
        getPrototypeOf() {
          throw new Error("sb_secret_must_not_travel");
        },
      }
    ),
  ],
];

const SECRET = "sb_secret_must_not_travel";

function baseDeps(overrides: Partial<IdentityCoordinatorDeps> = {}): IdentityCoordinatorDeps {
  const storage = createMemoryStorage();
  const backend = createFakeIdentityBackend();
  backend.legalRows = COMPLETE_LEGAL_ROWS;
  backend.currentAccountScopeId = IDENTITY_A.accountScopeId;
  let counter = 0;
  return {
    auth: createFakeAuth().auth,
    identity: createFakeIdentityService(backend),
    capture: createCallbackCaptureCell({
      readCurrentUrl: () => REDIRECT_TARGET,
      replaceCurrentUrl: () => {},
    }),
    barriers: createIdentityBarrierRepository(storage.adapter),
    attempts: createInteractiveAttemptRepository(storage.adapter),
    resolutions: createIdentityBarrierResolutionRepository(storage.adapter),
    trusted: createTrustedDeviceRepository(storage.adapter),
    intents: createPendingIntentRepository(storage.adapter),
    liveGeneration: createLiveGenerationCounter(),
    now: () => FIXED_NOW,
    newId: () => {
      counter += 1;
      return `80000000-0000-4000-8000-${counter.toString(16).padStart(12, "0")}`;
    },
    resolveRedirectTarget: () => REDIRECT_TARGET,
    ...overrides,
  };
}

function expectNoLeak(value: unknown): void {
  expect(JSON.stringify(value) ?? "").not.toContain(SECRET);
}

describe("a throwing clock or id generator", () => {
  it("cannot establish a barrier, and produces ZERO provider calls", async () => {
    for (const [label, thrown] of HOSTILE_THROWS) {
      for (const key of ["now", "newId"] as const) {
        const fakeAuth = createFakeAuth();
        const deps = baseDeps({
          auth: fakeAuth.auth,
          [key]: () => {
            throw thrown;
          },
        } as Partial<IdentityCoordinatorDeps>);
        const coordinator = createIdentityTransitionCoordinator(deps);

        const google = await coordinator.startGoogleSignIn();
        expect(report(google), `${key} / ${label}`).toEqual({ kind: "barrier_not_established" });
        const otp = await coordinator.requestEmailOtp("athlete@example.test");
        expect(report(otp), `${key} / ${label}`).toEqual({ kind: "barrier_not_established" });
        expect(fakeAuth.counts.prepare, `${key} / ${label}`).toBe(0);
        expect(fakeAuth.counts.navigate).toBe(0);
        expect(fakeAuth.counts.otpRequest).toBe(0);
        expectNoLeak(google);
      }
    }
  });

  it("a non-string return is treated the same as a throw", async () => {
    const fakeAuth = createFakeAuth();
    const coordinator = createIdentityTransitionCoordinator(
      baseDeps({ auth: fakeAuth.auth, newId: () => 7 as unknown as string })
    );
    await expect(coordinator.startGoogleSignIn().then(report)).resolves.toEqual({
      kind: "barrier_not_established",
    });
    expect(fakeAuth.counts.prepare).toBe(0);
  });
});

describe("a throwing live-generation counter", () => {
  it("makes every checkpoint fail rather than pass", async () => {
    for (const [label, thrown] of HOSTILE_THROWS) {
      const fakeAuth = createFakeAuth();
      const coordinator = createIdentityTransitionCoordinator(
        baseDeps({
          auth: fakeAuth.auth,
          liveGeneration: {
            current: () => {
              throw thrown;
            },
            bump: () => {
              throw thrown;
            },
          },
        })
      );
      const outcome = await coordinator.startGoogleSignIn();
      // A generation that cannot be read can never match a captured one, so the
      // transition is superseded — never silently allowed through.
      expect(["barrier_not_established", "superseded"], label).toContain(outcome.kind);
      expect(fakeAuth.counts.navigate, label).toBe(0);
      expectNoLeak(outcome);
    }
  });
});

describe("a throwing redirect resolver", () => {
  it("fails preparation closed, with zero provider calls", async () => {
    for (const [label, thrown] of HOSTILE_THROWS) {
      const fakeAuth = createFakeAuth();
      const coordinator = createIdentityTransitionCoordinator(
        baseDeps({
          auth: fakeAuth.auth,
          resolveRedirectTarget: () => {
            throw thrown;
          },
        })
      );
      const outcome = await coordinator.startGoogleSignIn();
      expect(report(outcome), label).toEqual({ kind: "preparation_failed" });
      expect(fakeAuth.counts.prepare, label).toBe(0);
    }
  });
});

describe("a throwing progress callback", () => {
  it("cannot prevent the in-memory denial or skip the durable fallback", async () => {
    const storage = createMemoryStorage();
    storage.seed(
      STORAGE_KEYS.trusted,
      createTrustedDeviceRecord({
        accountScopeId: IDENTITY_A.accountScopeId,
        profileId: PROFILE_A,
        displayName: "Athlete",
        onboardingCompletedAt: "2026-02-01T09:00:00.000Z",
        generation: 1,
        establishedAt: FIXED_NOW,
        lastServerConfirmationAt: FIXED_NOW,
      })
    );
    // The barrier write fails, so the durable fallback — trusted removal — is the
    // only remaining denial. A throwing progress callback must not skip it.
    storage.failWrites.add(STORAGE_KEYS.barrier);
    const coordinator = createIdentityTransitionCoordinator(
      baseDeps({
        barriers: createIdentityBarrierRepository(storage.adapter),
        attempts: createInteractiveAttemptRepository(storage.adapter),
        resolutions: createIdentityBarrierResolutionRepository(storage.adapter),
        trusted: createTrustedDeviceRepository(storage.adapter),
        intents: createPendingIntentRepository(storage.adapter),
        onProgress: () => {
          throw new Error(SECRET);
        },
      })
    );

    const outcome = await coordinator.invalidateIdentity();

    expect(report(outcome)).toEqual({ kind: "identity_invalidated" });
    expect(storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
    expectNoLeak(outcome);
  });

  it("cannot break an ordinary transition either", async () => {
    for (const [label, thrown] of HOSTILE_THROWS) {
      const coordinator = createIdentityTransitionCoordinator(
        baseDeps({
          onProgress: () => {
            throw thrown;
          },
        })
      );
      await expect(coordinator.startGoogleSignIn().then(report), label).resolves.toEqual({ kind: "navigating" });
    }
  });
});

describe("a throwing capture cell", () => {
  it("fails Phase 0 closed with zero exchanges", async () => {
    for (const [label, thrown] of HOSTILE_THROWS) {
      const fakeAuth = createFakeAuth();
      const coordinator = createIdentityTransitionCoordinator(
        baseDeps({
          auth: fakeAuth.auth,
          capture: {
            initializeCallbackCapture: () => {
              throw thrown;
            },
            peekCallbackCandidate: () => {
              throw thrown;
            },
            claimCallbackForExchange: () => {
              throw thrown;
            },
            finalizeTerminalCallbackOutcome: () => {
              throw thrown;
            },
          },
        })
      );
      const outcome = await coordinator.startUp();
      expect(outcome.callback, label).toEqual({ kind: "malformed_callback" });
      expect(fakeAuth.counts.exchange, label).toBe(0);
      expect(isGateReady(reduceGateState(initialGateState(), {
        type: "startup_completed",
        callback: outcome.callback,
        verdict: outcome.verdict,
        finalization: outcome.finalization,
      })), label).toBe(false);
      expectNoLeak(outcome);
    }
  });

  it("a throwing claim during an ADMITTED continuation performs zero exchanges", async () => {
    const storage = createMemoryStorage();
    storage.seed(
      STORAGE_KEYS.barrier,
      createIdentityAccessBarrier({
        barrierId: BARRIER_A,
        origin: "interactive_authentication",
        barredAccountScopeId: null,
        barredGeneration: null,
        establishedAt: FIXED_NOW,
      })
    );
    storage.seed(
      STORAGE_KEYS.attempt,
      createGoogleAttempt({
        attemptId: ATTEMPT_A,
        flowId: FLOW_X,
        barrierId: BARRIER_A,
        capturedIdentityGeneration: 1,
        startedAt: FIXED_NOW,
      })
    );
    const realCell = createCallbackCaptureCell({
      readCurrentUrl: () => callbackUrl({ code: SYNTHETIC_CODE, flowId: FLOW_X }),
      replaceCurrentUrl: () => {},
    });
    const fakeAuth = createFakeAuth();
    const coordinator = createIdentityTransitionCoordinator(
      baseDeps({
        auth: fakeAuth.auth,
        capture: {
          initializeCallbackCapture: () => realCell.initializeCallbackCapture(),
          peekCallbackCandidate: () => realCell.peekCallbackCandidate(),
          claimCallbackForExchange: () => {
            throw new Error(SECRET);
          },
          finalizeTerminalCallbackOutcome: () => realCell.finalizeTerminalCallbackOutcome(),
        },
        barriers: createIdentityBarrierRepository(storage.adapter),
        attempts: createInteractiveAttemptRepository(storage.adapter),
        resolutions: createIdentityBarrierResolutionRepository(storage.adapter),
        trusted: createTrustedDeviceRepository(storage.adapter),
        intents: createPendingIntentRepository(storage.adapter),
      })
    );

    const outcome = await coordinator.startUp();

    expect(outcome.callback).toEqual({ kind: "exchange_failed" });
    expect(fakeAuth.counts.exchange).toBe(0);
    expect(outcome.verdict.kind).toBe("quarantined_locked");
    expectNoLeak(outcome);
  });
});

describe("a throwing AuthService", () => {
  it("every method resolves a closed deny-ward outcome", async () => {
    for (const [label, thrown] of HOSTILE_THROWS) {
      const throwingAuth = {
        restoreSession: async () => {
          throw thrown;
        },
        onAuthChange: () => {
          throw thrown;
        },
        requestEmailOtp: async () => {
          throw thrown;
        },
        verifyEmailOtp: async () => {
          throw thrown;
        },
        signOut: async () => {
          throw thrown;
        },
        prepareGoogleSignIn: async () => {
          throw thrown;
        },
        navigateToAuthorizationUrl: () => {
          throw thrown;
        },
        exchangeCorrelatedCallback: async () => {
          throw thrown;
        },
      } as unknown as IdentityCoordinatorDeps["auth"];
      const coordinator = createIdentityTransitionCoordinator(baseDeps({ auth: throwingAuth }));

      const startup = await coordinator.startUp();
      expect(startup.verdict.kind, label).toBe("identity_unconfirmed");

      const google = await coordinator.startGoogleSignIn();
      expect(report(google), label).toEqual({ kind: "preparation_failed" });

      const otp = await coordinator.requestEmailOtp("athlete@example.test");
      expect(report(otp), label).toEqual({ kind: "provider_error" });

      const signedOut = await coordinator.signOut();
      expect(report(signedOut), label).toEqual({ kind: "signed_out_locked" });

      const revalidated = await coordinator.revalidateGateFacts();
      expect(report(revalidated), label).toEqual({ kind: "temporarily_unavailable" });

      for (const value of [startup, google, otp, signedOut, revalidated]) expectNoLeak(value);
    }
  });

  it("a garbage-shaped return is treated as a failure, not as a session", async () => {
    const garbageAuth = {
      ...createFakeAuth().auth,
      restoreSession: async () => ({ kind: "authenticated" }) as never,
    } as IdentityCoordinatorDeps["auth"];
    const coordinator = createIdentityTransitionCoordinator(baseDeps({ auth: garbageAuth }));
    const startup = await coordinator.startUp();
    // An `authenticated` outcome with no usable identity is not an identity.
    expect(startup.verdict.kind).toBe("identity_unconfirmed");
  });
});

describe("a throwing IdentityService", () => {
  it("fails closed as UNCONFIRMED — never as a definitive negative that invalidates", async () => {
    for (const [label, thrown] of HOSTILE_THROWS) {
      const storage = createMemoryStorage();
      const throwingService = {
        getLegalSnapshot: async () => {
          throw thrown;
        },
        ensureProfile: async () => {
          throw thrown;
        },
        resolveGateFacts: async () => {
          throw thrown;
        },
        completeOnboarding: async () => {
          throw thrown;
        },
      } as unknown as IdentityCoordinatorDeps["identity"];
      const fakeAuth = createFakeAuth();
      fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
      const coordinator = createIdentityTransitionCoordinator(
        baseDeps({
          auth: fakeAuth.auth,
          identity: throwingService,
          barriers: createIdentityBarrierRepository(storage.adapter),
          attempts: createInteractiveAttemptRepository(storage.adapter),
          resolutions: createIdentityBarrierResolutionRepository(storage.adapter),
          trusted: createTrustedDeviceRepository(storage.adapter),
          intents: createPendingIntentRepository(storage.adapter),
        })
      );

      const startup = await coordinator.startUp();

      expect(startup.verdict, label).toEqual({ kind: "identity_unconfirmed" });
      // A throwing service must not be read as "the server said no": no
      // invalidation barrier is written and no trusted state is destroyed.
      expect(storage.store.has(STORAGE_KEYS.barrier), label).toBe(false);
      expectNoLeak(startup);
    }
  });
});

describe("throwing repositories", () => {
  it("a throwing barrier repository refuses to start anything", async () => {
    const fakeAuth = createFakeAuth();
    const coordinator = createIdentityTransitionCoordinator(
      baseDeps({
        auth: fakeAuth.auth,
        barriers: {
          load: async () => {
            throw new Error(SECRET);
          },
          save: async () => {
            throw new Error(SECRET);
          },
        },
      })
    );

    const startup = await coordinator.startUp();
    // An unreadable barrier fails closed toward denial.
    expect(startup.verdict).toEqual({ kind: "quarantined_locked", origin: null });

    const google = await coordinator.startGoogleSignIn();
    expect(report(google)).toEqual({ kind: "barrier_not_established" });
    expect(fakeAuth.counts.prepare).toBe(0);
    expectNoLeak(startup);
  });

  it("a throwing trusted repository blocks sign-out before any provider call", async () => {
    const fakeAuth = createFakeAuth();
    const coordinator = createIdentityTransitionCoordinator(
      baseDeps({
        auth: fakeAuth.auth,
        trusted: {
          load: async () => {
            throw new Error(SECRET);
          },
          save: async () => {
            throw new Error(SECRET);
          },
          remove: async () => {
            throw new Error(SECRET);
          },
        },
      })
    );

    const outcome = await coordinator.signOut();

    expect(report(outcome)).toEqual({ kind: "trusted_state_not_invalidated" });
    expect(fakeAuth.counts.signOut).toBe(0);
    expectNoLeak(outcome);
  });

  it("a throwing intent repository blocks sign-out before any provider call", async () => {
    const fakeAuth = createFakeAuth();
    const coordinator = createIdentityTransitionCoordinator(
      baseDeps({
        auth: fakeAuth.auth,
        intents: {
          load: async () => {
            throw new Error(SECRET);
          },
          save: async () => {
            throw new Error(SECRET);
          },
          deleteIntent: async () => {
            throw new Error(SECRET);
          },
          clearOutstandingDenialCleanup: async () => {
            throw new Error(SECRET);
          },
          deleteOrdinaryIntents: async () => {
            throw new Error(SECRET);
          },
          markInvitationForRecovery: async () => {
            throw new Error(SECRET);
          },
          deleteOtherOrdinaryIntents: async () => {
            throw new Error(SECRET);
          },
          recordOutstandingDenialCleanup: async () => {
            throw new Error(SECRET);
          },
          settleIntentBeforeReady: async () => {
            throw new Error(SECRET);
          },
        },
      })
    );

    const outcome = await coordinator.signOut();

    expect(report(outcome)).toEqual({ kind: "intent_state_not_persisted" });
    expect(fakeAuth.counts.signOut).toBe(0);
    expectNoLeak(outcome);
  });

  it("a throwing attempt or resolution CLEANUP is inert — cleanup never affects authorization", async () => {
    const storage = createMemoryStorage();
    const realAttempts = createInteractiveAttemptRepository(storage.adapter);
    const realResolutions = createIdentityBarrierResolutionRepository(storage.adapter);
    const fakeAuth = createFakeAuth();
    const coordinator = createIdentityTransitionCoordinator(
      baseDeps({
        auth: fakeAuth.auth,
        barriers: createIdentityBarrierRepository(storage.adapter),
        trusted: createTrustedDeviceRepository(storage.adapter),
        intents: createPendingIntentRepository(storage.adapter),
        attempts: {
          load: () => realAttempts.load(),
          save: (attempt) => realAttempts.save(attempt),
          cleanUpNonCurrentAttempt: async () => {
            throw new Error(SECRET);
          },
        },
        resolutions: {
          loadForBarrier: (barrierId) => realResolutions.loadForBarrier(barrierId),
          saveForBarrier: (resolution) => realResolutions.saveForBarrier(resolution),
          retractUnconfirmedResolution: (barrierId) =>
            realResolutions.retractUnconfirmedResolution(barrierId),
          cleanUpNonCurrentResolution: async () => {
            throw new Error(SECRET);
          },
        },
      })
    );

    // Both transitions complete normally: a cleanup failure changes nothing.
    await expect(coordinator.startGoogleSignIn().then(report)).resolves.toEqual({ kind: "navigating" });
    await expect(coordinator.signOut().then(report)).resolves.toEqual({ kind: "signed_out_locked" });
    expect(fakeAuth.counts.signOut).toBe(1);
  });
});

describe("no public method rejects, for any hostile dependency", () => {
  it("every coordinator method resolves", async () => {
    const thrower = () => {
      throw new Error(SECRET);
    };
    const asyncThrower = async () => {
      throw new Error(SECRET);
    };
    const coordinator = createIdentityTransitionCoordinator({
      auth: {
        restoreSession: asyncThrower,
        onAuthChange: thrower,
        requestEmailOtp: asyncThrower,
        verifyEmailOtp: asyncThrower,
        signOut: asyncThrower,
        prepareGoogleSignIn: asyncThrower,
        navigateToAuthorizationUrl: thrower,
        exchangeCorrelatedCallback: asyncThrower,
      } as unknown as IdentityCoordinatorDeps["auth"],
      identity: {
        getLegalSnapshot: asyncThrower,
        ensureProfile: asyncThrower,
        resolveGateFacts: asyncThrower,
        completeOnboarding: asyncThrower,
      } as unknown as IdentityCoordinatorDeps["identity"],
      capture: {
        initializeCallbackCapture: thrower,
        peekCallbackCandidate: thrower,
        claimCallbackForExchange: thrower,
        finalizeTerminalCallbackOutcome: thrower,
      } as unknown as IdentityCoordinatorDeps["capture"],
      barriers: { load: asyncThrower, save: asyncThrower } as unknown as IdentityCoordinatorDeps["barriers"],
      attempts: {
        load: asyncThrower,
        save: asyncThrower,
        cleanUpNonCurrentAttempt: asyncThrower,
      } as unknown as IdentityCoordinatorDeps["attempts"],
      resolutions: {
        loadForBarrier: asyncThrower,
        saveForBarrier: asyncThrower,
        cleanUpNonCurrentResolution: asyncThrower,
      } as unknown as IdentityCoordinatorDeps["resolutions"],
      trusted: {
        load: asyncThrower,
        save: asyncThrower,
        remove: asyncThrower,
      } as unknown as IdentityCoordinatorDeps["trusted"],
      intents: {
        load: asyncThrower,
        save: asyncThrower,
        deleteIntent: asyncThrower,
        deleteOrdinaryIntents: asyncThrower,
        markInvitationForRecovery: asyncThrower,
        deleteOtherOrdinaryIntents: asyncThrower,
        resetSurvivalToOrdinary: asyncThrower,
      } as unknown as IdentityCoordinatorDeps["intents"],
      liveGeneration: { current: thrower, bump: thrower } as unknown as IdentityCoordinatorDeps["liveGeneration"],
      now: thrower,
      newId: thrower,
      resolveRedirectTarget: thrower,
      onProgress: thrower,
    });

    const pendingIntent = createPendingIntent({
      kind: "invitation",
      value: "opaque-invitation-token-0001",
      capturedAt: FIXED_NOW,
    });
    if (pendingIntent === null) throw new Error("fixture is invalid");

    const results = [
      await coordinator.startUp(),
      await coordinator.startGoogleSignIn(),
      await coordinator.requestEmailOtp("athlete@example.test"),
      await coordinator.verifyEmailOtp("athlete@example.test", "123456"),
      await coordinator.refreshLegalSnapshot(),
      await coordinator.retryTrustedStateEstablishment(),
      await coordinator.signOut(),
      await coordinator.invalidateIdentity(),
      await coordinator.revalidateGateFacts(),
      await coordinator.discardPendingIntent(),
      await coordinator.capturePendingIntent(pendingIntent),
      await coordinator.observeNewerBarrier(),
      coordinator.classifyAuthChange({ reason: "signed_in", identity: IDENTITY_A }),
    ];

    for (const result of results) {
      expect(result).toBeDefined();
      expectNoLeak(result);
    }
    // And none of them opened the gate.
    const startup = results[0] as Awaited<ReturnType<typeof coordinator.startUp>>;
    expect(isGateReady(reduceGateState(initialGateState(), {
      type: "startup_completed",
      callback: startup.callback,
      verdict: startup.verdict,
      finalization: startup.finalization,
    }))).toBe(false);
  });
});

describe("the harness's own dependencies are unaffected", () => {
  it("an ordinary transition still succeeds through the contained wrappers", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    await expect(harness.coordinator.startGoogleSignIn().then(report)).resolves.toEqual({ kind: "navigating" });
    expect(harness.fakeAuth.counts.prepare).toBe(1);
    expect(harness.fakeAuth.counts.navigate).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Beyond immediately-throwing dependencies: results that LOOK successful.
//
// Checking only a discriminator and then passing the original object onward lets
// accessors, Proxies, malformed nested data, unknown variants and values that
// change between reads escape the boundary. Every accepted result is therefore
// copied into inert plain data, and anything that cannot be copied cleanly fails
// closed as transient/unconfirmed — never as a definitive server negative.
// ---------------------------------------------------------------------------

/** A value that answers differently on each read. */
function changingIdentity(first: string, second: string): unknown {
  let reads = 0;
  return {
    get accountScopeId(): string {
      reads += 1;
      return reads === 1 ? first : second;
    },
    email: null,
  };
}

describe("partial and unknown dependency results", () => {
  it("an unknown restore variant fails closed as restore_failed", async () => {
    for (const outcome of [
      { kind: "signed_in" },
      { kind: "" },
      { kind: 7 },
      {},
      null,
      "authenticated",
      [],
    ]) {
      const fakeAuth = createFakeAuth();
      const coordinator = createIdentityTransitionCoordinator(
        baseDeps({
          auth: {
            ...fakeAuth.auth,
            restoreSession: async () => outcome as never,
          } as IdentityCoordinatorDeps["auth"],
        })
      );
      const startup = await coordinator.startUp();
      expect(startup.verdict, JSON.stringify(outcome)).toEqual({ kind: "identity_unconfirmed" });
    }
  });

  it("an `authenticated` result with a partial or malformed identity is not an identity", async () => {
    for (const identity of [
      {},
      { accountScopeId: "" },
      { accountScopeId: 7 },
      { accountScopeId: "account-a", email: 7 },
      null,
      new Proxy({}, { get() { throw new Error(SECRET); } }),
    ]) {
      const fakeAuth = createFakeAuth();
      const coordinator = createIdentityTransitionCoordinator(
        baseDeps({
          auth: {
            ...fakeAuth.auth,
            restoreSession: async () => ({ kind: "authenticated", identity }) as never,
          } as IdentityCoordinatorDeps["auth"],
        })
      );
      const startup = await coordinator.startUp();
      expect(startup.verdict.kind).toBe("identity_unconfirmed");
      expectNoLeak(startup);
    }
  });

  it("an identity that CHANGES between reads cannot be observed twice", async () => {
    const fakeAuth = createFakeAuth();
    const coordinator = createIdentityTransitionCoordinator(
      baseDeps({
        auth: {
          ...fakeAuth.auth,
          restoreSession: async () =>
            ({ kind: "authenticated", identity: changingIdentity("account-a", "account-b") }) as never,
        } as IdentityCoordinatorDeps["auth"],
      })
    );
    // The identity is copied once at the boundary, so nothing downstream can see
    // the second value. It is either account-a throughout, or nothing.
    const startup = await coordinator.startUp();
    expect(JSON.stringify(startup)).not.toContain("account-b");
  });

  it("an unknown prepare/exchange/navigate variant is a failure, never a success", async () => {
    const fakeAuth = createFakeAuth();
    const coordinator = createIdentityTransitionCoordinator(
      baseDeps({
        auth: {
          ...fakeAuth.auth,
          prepareGoogleSignIn: async () => ({ kind: "definitely_prepared" }) as never,
        } as IdentityCoordinatorDeps["auth"],
      })
    );
    await expect(coordinator.startGoogleSignIn().then(report)).resolves.toEqual({ kind: "preparation_failed" });
  });

  it("a `prepared` result with a malformed selector or URL is refused, and never navigates", async () => {
    for (const prepared of [{}, { flowId: 7, authorizationUrl: "u" }, { flowId: "f" }, null]) {
      const fakeAuth = createFakeAuth();
      const coordinator = createIdentityTransitionCoordinator(
        baseDeps({
          auth: {
            ...fakeAuth.auth,
            prepareGoogleSignIn: async () => ({ kind: "prepared", prepared }) as never,
          } as IdentityCoordinatorDeps["auth"],
        })
      );
      const outcome = await coordinator.startGoogleSignIn();
      expect(report(outcome), JSON.stringify(prepared)).toEqual({ kind: "preparation_failed" });
      expect(fakeAuth.counts.navigate).toBe(0);
    }
  });

  it("a provider error kind that is not in the closed set becomes unexpected_error", async () => {
    const fakeAuth = createFakeAuth();
    const coordinator = createIdentityTransitionCoordinator(
      baseDeps({
        auth: {
          ...fakeAuth.auth,
          requestEmailOtp: async () =>
            ({ ok: false, error: { kind: "totally_made_up", message: SECRET } }) as never,
        } as IdentityCoordinatorDeps["auth"],
      })
    );
    const outcome = await coordinator.requestEmailOtp("athlete@example.test");
    expect(report(outcome)).toEqual({ kind: "provider_error" });
    expectNoLeak(outcome);
  });

  it("a provider error MESSAGE never travels, even for a known kind", async () => {
    const fakeAuth = createFakeAuth();
    const coordinator = createIdentityTransitionCoordinator(
      baseDeps({
        auth: {
          ...fakeAuth.auth,
          requestEmailOtp: async () =>
            ({ ok: false, error: { kind: "request_failed", message: SECRET } }) as never,
        } as IdentityCoordinatorDeps["auth"],
      })
    );
    expectNoLeak(await coordinator.requestEmailOtp("athlete@example.test"));
  });
});

describe("malformed identity-service payloads", () => {
  function withIdentityService(
    overrides: Partial<IdentityCoordinatorDeps["identity"]>
  ): { coordinator: ReturnType<typeof createIdentityTransitionCoordinator>; storage: ReturnType<typeof createMemoryStorage> } {
    const storage = createMemoryStorage();
    const backend = createFakeIdentityBackend();
    backend.legalRows = COMPLETE_LEGAL_ROWS;
    backend.currentAccountScopeId = IDENTITY_A.accountScopeId;
    const fakeAuth = createFakeAuth();
    fakeAuth.state.restore = { kind: "authenticated", identity: IDENTITY_A };
    const coordinator = createIdentityTransitionCoordinator(
      baseDeps({
        auth: fakeAuth.auth,
        identity: { ...createFakeIdentityService(backend), ...overrides },
        barriers: createIdentityBarrierRepository(storage.adapter),
        attempts: createInteractiveAttemptRepository(storage.adapter),
        resolutions: createIdentityBarrierResolutionRepository(storage.adapter),
        trusted: createTrustedDeviceRepository(storage.adapter),
        intents: createPendingIntentRepository(storage.adapter),
      })
    );
    return { coordinator, storage };
  }

  it("a malformed gate-facts payload fails closed as UNCONFIRMED, never as a server negative", async () => {
    // Labelled rather than stringified: `JSON.stringify` reads `toJSON` off the
    // value, so a hostile Proxy would throw from the ASSERTION MESSAGE and fail
    // the test before the implementation under test was ever judged.
    const cases: Array<[string, unknown]> = [
      ["null", null],
      ["empty object", {}],
      ["non-uuid profileId", { profileId: "not-a-uuid" }],
      // Athlete capability and the Free entitlement come only from completed
      // onboarding, so this combination cannot exist.
      [
        "capability and entitlement without completed onboarding",
        {
          profileId: PROFILE_A,
          displayName: "Athlete",
          onboardingCompletedAt: null,
          hasAthleteCapability: true,
          freeEntitlementActive: true,
          pinnedTerms: null,
          pinnedPrivacy: null,
          currentTermsDocumentId: null,
          currentTermsVersionLabel: null,
          currentPrivacyDocumentId: null,
          currentPrivacyVersionLabel: null,
        },
      ],
      ["hostile Proxy", new Proxy({}, { get() { throw new Error(SECRET); } })],
    ];
    for (const [label, value] of cases) {
      const { coordinator, storage } = withIdentityService({
        resolveGateFacts: async () => ({ ok: true, value: value as never }),
      });
      const startup = await coordinator.startUp();
      expect(startup.verdict.kind, label).toBe("identity_unconfirmed");
      // Not a definitive negative: no invalidation barrier, no trusted destruction.
      expect(storage.store.has(STORAGE_KEYS.barrier), label).toBe(false);
      expectNoLeak(startup);
    }
  });

  it("a malformed bare-Profile payload fails closed as unconfirmed", async () => {
    for (const value of [null, {}, { profileId: "nope" }, { profileId: PROFILE_A, displayName: 7 }]) {
      const { coordinator, storage } = withIdentityService({
        ensureProfile: async () => ({ ok: true, value: value as never }),
      });
      const startup = await coordinator.startUp();
      expect(startup.verdict.kind, JSON.stringify(value)).toBe("identity_unconfirmed");
      expect(storage.store.has(STORAGE_KEYS.barrier)).toBe(false);
    }
  });

  it("an unknown identity error kind can never become a definitive negative", async () => {
    const { coordinator, storage } = withIdentityService({
      ensureProfile: async () => ({ ok: false, error: { kind: "forbidden_ish", message: SECRET } }) as never,
    });
    const startup = await coordinator.startUp();
    expect(startup.verdict.kind).toBe("identity_unconfirmed");
    // `forbidden` WOULD have invalidated; an unrecognized kind must not.
    expect(storage.store.has(STORAGE_KEYS.barrier)).toBe(false);
    expectNoLeak(startup);
  });

  it("a legal snapshot carrying an unsafe href is refused rather than rendered", async () => {
    const { coordinator } = withIdentityService({
      getLegalSnapshot: async () =>
        ({
          ok: true,
          value: {
            terms: {
              id: "dddddddd-1111-4111-8111-dddddddddddd",
              kind: "terms_of_service",
              versionLabel: "v1",
              href: "javascript:alert(1)",
              effectiveAt: "2026-01-01T00:00:00.000Z",
            },
            privacy: null,
            fetchedAt: "2026-03-01T10:00:00.000Z",
          },
        }) as never,
    });
    const startup = await coordinator.startUp();
    expect(startup.verdict).toEqual({ kind: "legal_unavailable" });
    expect(JSON.stringify(startup)).not.toContain("javascript:");
  });

  it("ensureProfile and gate facts must describe the SAME Profile", async () => {
    const otherProfile = "cccccccc-9999-4999-8999-cccccccccccc";
    const { coordinator, storage } = withIdentityService({
      ensureProfile: async () => ({ ok: true, value: { profileId: otherProfile, displayName: null } }),
    });
    const startup = await coordinator.startUp();
    expect(startup.verdict).toEqual({ kind: "identity_unconfirmed" });
    expect(storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });
});

describe("malformed repository results", () => {
  it("an unknown load status is unreadable, and a hostile value is malformed", async () => {
    const fakeAuth = createFakeAuth();
    const unknownStatus = createIdentityTransitionCoordinator(
      baseDeps({
        auth: fakeAuth.auth,
        barriers: {
          load: async () => ({ status: "probably_fine" }) as never,
          save: async () => ({ ok: true }),
        },
      })
    );
    const startup = await unknownStatus.startUp();
    expect(startup.verdict).toEqual({ kind: "quarantined_locked", origin: null });

    const hostileValue = createIdentityTransitionCoordinator(
      baseDeps({
        barriers: {
          load: async () =>
            ({
              status: "value",
              value: new Proxy({}, { get() { throw new Error(SECRET); } }),
            }) as never,
          save: async () => ({ ok: true }),
        },
      })
    );
    const hostile = await hostileValue.startUp();
    expect(hostile.verdict).toEqual({ kind: "quarantined_locked", origin: null });
    expectNoLeak(hostile);
  });

  it("an unknown write or mutation result is never read as a success", async () => {
    const fakeAuth = createFakeAuth();
    const unknownWrite = createIdentityTransitionCoordinator(
      baseDeps({
        auth: fakeAuth.auth,
        barriers: {
          load: async () => ({ status: "absent" }),
          save: async () => ({ ok: "yes" }) as never,
        },
      })
    );
    await expect(unknownWrite.startGoogleSignIn().then(report)).resolves.toEqual({
      kind: "barrier_not_established",
    });
    expect(fakeAuth.counts.prepare).toBe(0);

    const unknownMutation = createIdentityTransitionCoordinator(
      baseDeps({
        auth: fakeAuth.auth,
        intents: {
          load: async () => ({ status: "absent" }),
          save: async () => ({ ok: true }),
          deleteIntent: async () => ({ ok: true }),
          clearOutstandingDenialCleanup: async () => ({ ok: true }),
          deleteOrdinaryIntents: async () => ({ kind: "probably_applied" }) as never,
          markInvitationForRecovery: async () => ({ ok: true }),
          deleteOtherOrdinaryIntents: async () => ({ kind: "applied" }),
          recordOutstandingDenialCleanup: async () => ({ kind: "not_required" }),
          settleIntentBeforeReady: async () => ({ kind: "not_required" }),
        },
      })
    );
    const signedOut = await unknownMutation.signOut();
    expect(report(signedOut)).toEqual({ kind: "intent_state_not_persisted" });
  });
});

describe("every public method is exercised against hostile dependencies", () => {
  it("submitOnboarding and recoverInvitationAccount resolve closed outcomes", async () => {
    const thrower = () => {
      throw new Error(SECRET);
    };
    const asyncThrower = async () => {
      throw new Error(SECRET);
    };
    const coordinator = createIdentityTransitionCoordinator(
      baseDeps({
        auth: {
          restoreSession: asyncThrower,
          onAuthChange: thrower,
          requestEmailOtp: asyncThrower,
          verifyEmailOtp: asyncThrower,
          signOut: asyncThrower,
          prepareGoogleSignIn: asyncThrower,
          navigateToAuthorizationUrl: thrower,
          exchangeCorrelatedCallback: asyncThrower,
        } as unknown as IdentityCoordinatorDeps["auth"],
        identity: {
          getLegalSnapshot: asyncThrower,
          ensureProfile: asyncThrower,
          resolveGateFacts: asyncThrower,
          completeOnboarding: asyncThrower,
        } as unknown as IdentityCoordinatorDeps["identity"],
      })
    );

    const onboarding = await coordinator.submitOnboarding({
      displayName: "Athlete",
      terms: { id: "x", kind: "terms_of_service", versionLabel: "v", href: "h", effectiveAt: "e" } as never,
      privacy: { id: "y", kind: "privacy_notice", versionLabel: "v", href: "h", effectiveAt: "e" } as never,
    });
    expect(report(onboarding)).toEqual({ kind: "temporarily_unavailable" });
    expectNoLeak(onboarding);

    const recovery = await coordinator.recoverInvitationAccount({
      schemaVersion: 1,
      kind: "invitation",
      value: "opaque-invitation-token-0001",
      capturedAt: "2026-03-01T10:00:00.000Z",
      survival: "ordinary",
    });
    expect(recovery.kind).toBeDefined();
    expectNoLeak(recovery);
  });

  it("recoverInvitationAccount refuses a hostile intent argument without any provider call", async () => {
    const fakeAuth = createFakeAuth();
    const coordinator = createIdentityTransitionCoordinator(baseDeps({ auth: fakeAuth.auth }));
    const hostile = new Proxy(
      {},
      {
        get() {
          throw new Error(SECRET);
        },
        ownKeys() {
          throw new Error(SECRET);
        },
      }
    ) as never;

    const outcome = await coordinator.recoverInvitationAccount(hostile);

    expect(report(outcome)).toEqual({ kind: "intent_state_not_persisted" });
    expect(fakeAuth.counts.signOut).toBe(0);
    expectNoLeak(outcome);
  });
});
