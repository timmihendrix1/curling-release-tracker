// @vitest-environment jsdom
//
// Credential health is CONSUMED, not merely exposed — Stage M3b3 correction.
//
// The review's finding was precise: `credentialFailure()` / `observedFailure()`
// had no application consumers, and "exposing a getter is not failure handling".
// This file is the proof that they now have one, at the place where the damage
// would otherwise be done — the auth-operation boundary.
//
// Two SDK facts make this necessary rather than belt-and-braces, and both are
// exercised here against the INSTALLED SDK rather than asserted:
//
//   1. `getItemAsync` treats a resolved falsy value — and one that fails
//      `JSON.parse` — as absence with NO error, so a storage layer that answered
//      `null` on failure would produce a clean `{ session: null, error: null }`.
//   2. `initialize()` catches everything `_initialize()` throws and returns it
//      as a result this application never reads, while `_emitInitialSession` is
//      awaited by nobody. A failure during SDK INITIALISATION can therefore be
//      absorbed entirely, leaving a later successful read to report "no session"
//      over a store that already failed.
//
// `supabaseAuthService` consults the normalised verdict so neither becomes a
// clean signed-out state or a completed sign-out.
//
// **Mocked native failure models, not physical-device evidence.**
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { createSupabaseAuthService } from "../supabaseAuthService";
import {
  claimBrowserAuthStorage,
  claimedBrowserCredentialHealth,
  resetSupabaseBrowserClientForTests,
} from "../supabaseClient";
import { createProviderCredentialStorage } from "../providerCredentialStorage";
import type { ConfiguredCloudConfig } from "../config";
import type {
  SecureCredentialReadResult,
  SecureCredentialRemoveResult,
  SecureCredentialStore,
  SecureCredentialWriteResult,
} from "../../persistence/secureCredentialStore";

// --- The library-internal un-awaited promise this file necessarily provokes -------
//
// `createClient` (supabase-js) calls `_listenForAuthEvents()` in its constructor,
// which calls auth-js's `onAuthStateChange`. That function starts an IIFE it never
// awaits and never attaches a rejection handler to:
//
//     (async () => { await this.initializePromise; await this._emitInitialSession(id) })()
//
// `_emitInitialSession` reads the session through the storage this file deliberately
// breaks, so the adapter's fail-closed `CredentialStorageError` lands in a promise
// nobody owns. The rejection is created entirely inside auth-js/supabase-js and
// cannot be handled from application code: there is no reference to that promise and
// no option to opt out of that subscription.
//
// The adapter MUST keep throwing — resolving instead would make the SDK report a
// clean "no session" over a store that failed, which is the exact defect this file
// exists to prevent.
//
// So the escape is captured here and CHECKED AFTER all asynchronous work has drained,
// not in the middle of the run. The listener is scoped to this file; the only reasons
// it may ever hold are our own fail-closed credential errors, and anything else — at
// any point, including a late rejection arriving during the drain — fails the suite.
//
// This is test interception, NOT production error handling: at runtime the rejection
// still escapes into the host (a console error in a browser). Nothing here makes the
// SDK's un-awaited promise safe; it only stops that known, specific escape from
// silently passing as a clean verification run. See
// docs/TECHNICAL_DEBT_AND_ROADMAP.md for the standing limitation.
const capturedUnhandledRejections: unknown[] = [];

function recordUnhandledRejection(reason: unknown): void {
  capturedUnhandledRejections.push(reason);
}

function isExpectedCredentialEscape(reason: unknown): boolean {
  return reason instanceof Error && reason.name === "CredentialStorageError";
}

// Registered at module scope, not in `beforeAll`: the client is constructed inside
// the tests, but its library-internal IIFE can settle at any point afterwards —
// including after the last test's hooks have run — so the window must cover the whole
// file.
process.on("unhandledRejection", recordUnhandledRejection);

afterAll(async () => {
  // Drain first, THEN judge. Asserting inside the last test would check a list that
  // asynchronous work is still appending to, so a late unexpected rejection would be
  // collected and never looked at.
  try {
    await new Promise((resolve) => setTimeout(resolve, 50));

    // At least one escape is expected: it is the whole point of the
    // broken-store cases below, and its absence would mean they stopped exercising
    // the SDK path they claim to.
    expect(capturedUnhandledRejections.length).toBeGreaterThan(0);

    const unexpected = capturedUnhandledRejections.filter(
      (reason) => !isExpectedCredentialEscape(reason)
    );
    expect(unexpected).toEqual([]);
  } finally {
    // Always removed, even when the assertions above fail, so a failure here can
    // never leak this listener into another test file.
    process.off("unhandledRejection", recordUnhandledRejection);
  }
});

const CONFIG: ConfiguredCloudConfig = {
  status: "configured",
  url: "https://health.supabase.co",
  publishableKey: "sb_publishable_" + "h".repeat(24),
};
const SESSION_KEY = "sb-health-auth-token";

afterEach(() => {
  resetSupabaseBrowserClientForTests();
  window.localStorage.clear();
});

type ControlledStore = SecureCredentialStore & {
  items: Map<string, string>;
  readFails: boolean;
  removeFails: boolean;
};

function controlledStore(overrides: Partial<ControlledStore> = {}): ControlledStore {
  const store: ControlledStore = {
    items: new Map<string, string>(),
    readFails: false,
    removeFails: false,
    async read(key: string): Promise<SecureCredentialReadResult> {
      if (store.readFails) {
        return { status: "read_failed", error: { kind: "store_inaccessible" } };
      }
      const value = store.items.get(key);
      return value === undefined ? { status: "absent" } : { status: "value", value };
    },
    async write(key: string, value: string): Promise<SecureCredentialWriteResult> {
      store.items.set(key, value);
      return { ok: true };
    },
    async remove(key: string): Promise<SecureCredentialRemoveResult> {
      if (store.removeFails) {
        return { ok: false, error: { kind: "store_inaccessible" } };
      }
      const existed = store.items.delete(key);
      return {
        ok: true,
        outcome: existed ? "deleted_reported" : "nothing_to_delete_reported",
      };
    },
    ...overrides,
  };
  return Object.assign(store, overrides);
}

/** Composes the real integration and claims it exactly as production does. */
function claimedIntegration(store: SecureCredentialStore) {
  const credentials = createProviderCredentialStorage(store, {
    sessionStorageKey: SESSION_KEY,
  });
  const claim = claimBrowserAuthStorage(credentials.storage, () =>
    credentials.observedFailure()
  );
  expect(claim).toEqual({ ok: true });
  return credentials;
}

/** A transport that never reaches a network. */
const offlineFetch = (async () => {
  throw new Error("no network in this test");
}) as unknown as typeof fetch;

describe("the health verdict is claimed together with the storage", () => {
  it("is null on the Web, where nothing is claimed — so behaviour is unchanged", () => {
    expect(claimedBrowserCredentialHealth()).toBeNull();
  });

  it("is the integration's own verdict once claimed", async () => {
    const store = controlledStore();
    const credentials = claimedIntegration(store);
    await credentials.establish();

    const health = claimedBrowserCredentialHealth();
    expect(health).not.toBeNull();
    expect(health?.()).toBeNull();

    store.readFails = true;
    await expect(credentials.storage.getItem("k")).rejects.toThrow();
    expect(health?.()).toEqual({ kind: "read_failed" });
  });
});

describe("restoreSession never reports a clean signed-out state over a credential failure", () => {
  it("reports temporarily_unavailable instead of no_session when a failure stands", async () => {
    // This is the exact substitution the review required: the one place a clean
    // "nobody is signed in" is produced must not be reachable while a credential
    // fault is unresolved.
    const store = controlledStore();
    const credentials = claimedIntegration(store);
    await credentials.establish();

    const auth = createSupabaseAuthService(CONFIG, {
      credentialHealth: () => credentials.observedFailure(),
      resolveAppOrigin: () => "https://app.example.test",
      navigate: () => {},
    });

    // Healthy store, genuinely no session: the honest answer is `no_session`.
    expect(await auth.restoreSession()).toEqual({ kind: "no_session" });

    // Now a failure is recorded — a later read may even succeed, but the
    // absence of a session was never established.
    store.readFails = true;
    await expect(credentials.storage.getItem("probe")).rejects.toThrow();
    store.readFails = false;

    expect(await auth.restoreSession()).toEqual({ kind: "temporarily_unavailable" });
  });

  it("covers a failure that happened during SDK INITIALISATION and was absorbed", async () => {
    // The store is broken from the start, so the SDK's constructor-time read
    // fails. The SDK absorbs it; the application channel does not.
    const store = controlledStore({ readFails: true });
    const credentials = claimedIntegration(store);

    const establishment = await credentials.establish();
    expect(establishment.status).toBe("unavailable");

    const auth = createSupabaseAuthService(CONFIG, {
      credentialHealth: () => credentials.observedFailure(),
      resolveAppOrigin: () => "https://app.example.test",
      navigate: () => {},
    });

    // Let the SDK's own constructor-time work run and be absorbed.
    await new Promise((resolve) => setTimeout(resolve, 0));

    // Even after the store recovers, the unresolved failure means absence was
    // never established — so this must not become `no_session`.
    store.readFails = false;
    expect(await auth.restoreSession()).toEqual({ kind: "temporarily_unavailable" });
  });

  it("does NOT report invalid_session, which would be a definitive verdict", async () => {
    // `invalid_session` triggers the SDK's own session cleanup and tells the
    // gate the session is definitively dead. A storage fault establishes no
    // such thing.
    const store = controlledStore();
    const credentials = claimedIntegration(store);
    await credentials.establish();
    store.readFails = true;
    await expect(credentials.storage.getItem("probe")).rejects.toThrow();

    const auth = createSupabaseAuthService(CONFIG, {
      credentialHealth: () => credentials.observedFailure(),
      resolveAppOrigin: () => "https://app.example.test",
      navigate: () => {},
    });

    const outcome = await auth.restoreSession();
    expect(outcome.kind).not.toBe("invalid_session");
    expect(outcome.kind).not.toBe("no_session");
  });

  it("treats a THROWING health accessor as not-healthy rather than ignoring it", async () => {
    const auth = createSupabaseAuthService(CONFIG, {
      credentialHealth: () => {
        throw new Error("hostile accessor");
      },
      resolveAppOrigin: () => "https://app.example.test",
      navigate: () => {},
    });

    expect(await auth.restoreSession()).toEqual({ kind: "temporarily_unavailable" });
  });

  it("leaves the Web path untouched: with no verdict, no_session is still reported", async () => {
    const auth = createSupabaseAuthService(CONFIG, {
      resolveAppOrigin: () => "https://app.example.test",
      navigate: () => {},
    });

    expect(claimedBrowserCredentialHealth()).toBeNull();
    expect(await auth.restoreSession()).toEqual({ kind: "no_session" });
  });
});

describe("signOut is never reported as durable success over a credential failure", () => {
  it("fails when the SDK resolved but the local credential removal did not", async () => {
    // The SDK's `signOut` can resolve without an error while `_removeSession`'s
    // removals — which go through the claimed storage — failed. Reporting
    // success there is the false durable-sign-out claim the barrier-first
    // protocol depends on not happening.
    const store = controlledStore();
    const credentials = claimedIntegration(store);
    await credentials.establish();

    const auth = createSupabaseAuthService(CONFIG, {
      credentialHealth: () => credentials.observedFailure(),
      resolveAppOrigin: () => "https://app.example.test",
      navigate: () => {},
    });

    // A clean sign-out over a healthy store succeeds.
    const clean = await auth.signOut();
    expect(clean.ok).toBe(true);

    // Now the credential store refuses removals.
    store.items.set(SESSION_KEY, '{"access_token":"x"}');
    store.removeFails = true;
    await expect(credentials.storage.removeItem(SESSION_KEY)).rejects.toThrow();

    const failed = await auth.signOut();
    expect(failed.ok).toBe(false);
  });

  it("leaves the Web path untouched: with no verdict, a clean sign-out still succeeds", async () => {
    const auth = createSupabaseAuthService(CONFIG, {
      resolveAppOrigin: () => "https://app.example.test",
      navigate: () => {},
    });

    expect(await auth.signOut()).toEqual({ ok: true, value: undefined });
  });
});

describe("the health verdict is not an authorization signal", () => {
  it("a HEALTHY store does not make restoreSession report a session", async () => {
    // Nothing about credential health admits anyone. The access barrier decides
    // admission (ADR-0025), and an empty store is still an empty store.
    const store = controlledStore();
    const credentials = claimedIntegration(store);
    await credentials.establish();

    const auth = createSupabaseAuthService(CONFIG, {
      credentialHealth: () => credentials.observedFailure(),
      resolveAppOrigin: () => "https://app.example.test",
      navigate: () => {},
    });

    expect(await auth.restoreSession()).toEqual({ kind: "no_session" });
    void offlineFetch;
  });
});

describe("the SDK's absorbed initialisation failure", () => {
  it("is produced by the broken-store cases, and only as our fail-closed error", () => {
    // A snapshot of what has escaped SO FAR. The authoritative check is in `afterAll`,
    // after every pending promise and timer has drained — a late rejection arriving
    // after this point would not be visible here, which is exactly why this assertion
    // alone is not sufficient.
    expect(
      capturedUnhandledRejections.every(isExpectedCredentialEscape)
    ).toBe(true);
    expect(capturedUnhandledRejections.length).toBeGreaterThan(0);
  });
});
