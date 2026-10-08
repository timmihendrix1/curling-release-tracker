// @vitest-environment jsdom
//
// The sign-out authority chain, end to end, when the PROTECTED CREDENTIAL STORE
// refuses to delete — Stage M3b3.
//
// Moving the provider session into a Keychain/Keystore-backed store changes where
// "local credential cleanup" happens, and nothing else (Stage M3b0 §4's three
// separate concerns). This file proves that, by walking the whole chain rather
// than trusting each link's own test:
//
//   1. the credential store's removal fails;
//   2. the installed SDK's `signOut({scope:"local"})` therefore does not report
//      success;
//   3. `supabaseAuthService.signOut` maps that to an HONEST failure — a failed
//      local sign-out has not deleted the session, and saying otherwise would be
//      a false claim the caller cannot detect;
//   4. the coordinator's durable ACCESS BARRIER is written FIRST, before any
//      provider call, so the application is locked regardless; and
//   5. the outcome is `signed_out_locked` — denied, not "signed out cleanly".
//
// The barrier, not the provider call, is the latch. ADR-0025's ordering is
// preserved exactly, and the storage topology does not touch it.
import { afterEach, describe, expect, it } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { createProviderCredentialStorage } from "../../supabase/providerCredentialStorage";
import {
  BROWSER_AUTH_OPTIONS,
  resetSupabaseBrowserClientForTests,
} from "../../supabase/supabaseClient";
import { createIdentityAccessBarrier } from "../identityBarrier";
import {
  authError,
  createIdentityHarness,
  FIXED_NOW,
  firstIndex,
  report,
  REDIRECT_TARGET,
  STORAGE_KEYS,
} from "./support/identityTestHarness";
import type {
  SecureCredentialReadResult,
  SecureCredentialRemoveResult,
  SecureCredentialStore,
  SecureCredentialWriteResult,
} from "../../persistence/secureCredentialStore";

const SUPABASE_URL = "https://signout.supabase.co";
const PUBLISHABLE_KEY = "sb_publishable_" + "f".repeat(24);

afterEach(() => {
  resetSupabaseBrowserClientForTests();
  window.localStorage.clear();
});

/** A protected store whose removals fail — the locked-keychain / keystore-error
 * shape — while reads and writes work. */
function removalRefusingStore(): SecureCredentialStore & { items: Map<string, string> } {
  const items = new Map<string, string>();
  return {
    items,
    async read(key): Promise<SecureCredentialReadResult> {
      const value = items.get(key);
      return value === undefined ? { status: "absent" } : { status: "value", value };
    },
    async write(key, value): Promise<SecureCredentialWriteResult> {
      items.set(key, value);
      return { ok: true };
    },
    async remove(): Promise<SecureCredentialRemoveResult> {
      return { ok: false, error: { kind: "store_inaccessible" } };
    },
  };
}

describe("a refused credential deletion is never reported as a completed sign-out", () => {
  it("the installed SDK does not report success when the protected store refuses removal", async () => {
    const store = removalRefusingStore();
    const credentials = createProviderCredentialStorage(store, {
      sessionStorageKey: "sb-signout-chain-auth-token",
    });
    expect(await credentials.establish()).toEqual({
      status: "established",
      sessionPresent: false,
    });

    const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: {
        ...BROWSER_AUTH_OPTIONS,
        storageKey: "sb-signout-chain-auth-token",
        storage: credentials.storage,
      },
      global: { fetch: (async () => new Response("{}", { status: 200 })) as typeof fetch },
    });
    // Let the SDK's constructor-time work settle against the working store.
    await new Promise((resolve) => setTimeout(resolve, 0));

    const outcome = await client.auth
      .signOut({ scope: "local" })
      .then((value) => ({ kind: "resolved" as const, value }))
      .catch(() => ({ kind: "rejected" as const }));

    if (outcome.kind === "resolved") {
      expect(outcome.value.error).not.toBeNull();
    } else {
      expect(outcome.kind).toBe("rejected");
    }
    // And the application's own channel recorded it, independently of the SDK.
    expect(credentials.observedFailure()).toEqual({ kind: "removal_failed" });
  });
});

describe("the barrier stays authoritative when credential deletion fails", () => {
  /** A device that is signed in and trusted, so `signOut()` has something to do. */
  function seedSignedInDevice(storage: ReturnType<typeof createIdentityHarness>["storage"]) {
    storage.seed(
      STORAGE_KEYS.trusted,
      {
        schemaVersion: 1,
        accountScopeId: "account-a",
        profileId: "cccccccc-1111-4111-8111-cccccccccccc",
        establishedAt: FIXED_NOW,
        onboardingCompletedAt: FIXED_NOW,
        displayName: "Trusted Athlete",
        entitlement: "free",
        legalAcceptance: {
          termsDocumentId: "dddddddd-1111-4111-8111-dddddddddddd",
          termsVersion: 1,
          privacyDocumentId: "eeeeeeee-1111-4111-8111-eeeeeeeeeeee",
          privacyVersion: 1,
          acceptedAt: FIXED_NOW,
        },
      }
    );
  }

  it("writes the barrier BEFORE the provider call and reports a locked, not a clean, sign-out", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedSignedInDevice(harness.storage);
    // Exactly what `supabaseAuthService.signOut` returns when the SDK reports a
    // failed local sign-out — which is what a refused credential deletion
    // produces, per the chain proven above.
    harness.fakeAuth.state.signOut = authError("sign_out_failed");

    const outcome = await harness.coordinator.signOut();

    // 1. Denied, not "signed out cleanly".
    expect(report(outcome)).toEqual({ kind: "signed_out_locked" });

    // 2. ORDER, measured from the shared log rather than inferred: the durable
    //    barrier write precedes the provider call, so the denial is already in
    //    force when the provider fails.
    const barrierWrite = firstIndex(harness.log, `storage:set:${STORAGE_KEYS.barrier}`);
    const providerCall = firstIndex(harness.log, "auth:signOut");
    expect(barrierWrite).toBeGreaterThanOrEqual(0);
    expect(providerCall).toBeGreaterThan(barrierWrite);

    // 3. The barrier is durable and names this transition.
    const barrier = JSON.parse(harness.storage.store.get(STORAGE_KEYS.barrier) as string) as {
      origin: string;
    };
    expect(barrier.origin).toBe("explicit_sign_out");

    // 4. Trusted state is gone, so no leftover credential can reconstruct an
    //    identity context.
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(false);
  });

  it("a barrier that could not be written performs ZERO provider calls, so no credential is deleted either", async () => {
    // The converse direction: the latch is established first, so a failure to
    // establish it stops everything — including the credential cleanup.
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    seedSignedInDevice(harness.storage);
    harness.storage.failWrites.add(STORAGE_KEYS.barrier);

    const outcome = await harness.coordinator.signOut();

    expect(report(outcome)).not.toEqual({ kind: "signed_out_locked" });
    expect(harness.fakeAuth.counts.signOut).toBe(0);
    // Trusted state survives, because nothing past the barrier ran.
    expect(harness.storage.store.has(STORAGE_KEYS.trusted)).toBe(true);
  });
});

describe("a retained credential does not bypass missing or denying identity state", () => {
  it("a stored provider session with NO trusted-device record does not admit anyone", async () => {
    // The S2 asymmetry the design names explicitly: on iOS a Keychain item can
    // survive an uninstall, while app-private identity records cannot. The
    // result is a credential with no identity context — and the gate must admit
    // nobody on that basis.
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    // No trusted-device record seeded. The provider, however, restores happily.
    harness.fakeAuth.state.restore = {
      kind: "authenticated",
      identity: { accountScopeId: "account-a", email: "a@example.test" },
    };

    const outcome = await harness.coordinator.startUp();

    // Whatever the provider says, the verdict is not a ready session: identity
    // continuity is what admits, and it is absent.
    expect(outcome.verdict.kind).not.toBe("ready");
    // Nothing erased the retained credential either — this stage does not
    // automatically clear leftover Keychain material.
    expect(harness.fakeAuth.counts.signOut).toBe(0);
  });

  it("a stored provider session behind a DENYING barrier still does not admit anyone", async () => {
    const harness = createIdentityHarness({ url: REDIRECT_TARGET });
    harness.storage.seed(
      STORAGE_KEYS.barrier,
      createIdentityAccessBarrier({
        barrierId: "11111111-1111-4111-8111-111111111111",
        origin: "explicit_sign_out",
        barredAccountScopeId: null,
        barredGeneration: null,
        establishedAt: FIXED_NOW,
      })
    );
    harness.fakeAuth.state.restore = {
      kind: "authenticated",
      identity: { accountScopeId: "account-a", email: "a@example.test" },
    };

    const outcome = await harness.coordinator.startUp();

    expect(outcome.verdict.kind).not.toBe("ready");
  });
});
