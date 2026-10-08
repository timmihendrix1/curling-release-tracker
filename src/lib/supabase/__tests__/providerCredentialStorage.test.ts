// @vitest-environment jsdom
//
// The provider-credential storage integration — Stage M3b3.
//
// Two halves, deliberately kept apart:
//
//   1. the integration's own contract, against a controllable fake store;
//   2. **the INSTALLED Supabase SDK driven through the real integration seam**,
//      including a SUCCESSFUL session persist-and-restore round trip. A test
//      that supplies unusable credentials, ignores the resulting error and
//      merely asserts "some storage traffic happened" proves nothing about
//      whether the store actually works, so the round trip below asserts the
//      operation succeeds, the expected session is written, and a fresh client
//      restores the same account identity from the same protected store.
//
// **These are mocked native failure models, not physical-device evidence.**
import { afterEach, describe, expect, it, vi } from "vitest";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import {
  createProviderCredentialStorage,
  providerSessionStorageKey,
} from "../providerCredentialStorage";
import { BROWSER_AUTH_OPTIONS } from "../supabaseClient";
import type {
  SecureCredentialReadResult,
  SecureCredentialRemoveResult,
  SecureCredentialStore,
  SecureCredentialWriteResult,
} from "../../persistence/secureCredentialStore";

const SUPABASE_URL = "https://credentials.supabase.co";
// A syntactically valid, entirely fictional local test key. It reaches no
// server: every request below is served by an injected fake `fetch`.
const PUBLISHABLE_KEY = "sb_publishable_" + "d".repeat(24);
const SESSION_KEY = "sb-credentials-auth-token";

/**
 * A syntactically valid but entirely synthetic, UNSIGNED JWT.
 *
 * `setSession` parses the access token's structure before storing it, so an
 * arbitrary string is rejected as `Invalid JWT structure`. Nothing here is a
 * real credential: the signature segment is a fixed placeholder, the token is
 * never sent anywhere (every request is served by an injected transport), and
 * no key material exists to sign it with.
 */
function syntheticAccessToken(subject: string, expiresInSeconds = 3600): string {
  const encode = (value: unknown): string =>
    Buffer.from(JSON.stringify(value))
      .toString("base64")
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  const header = encode({ alg: "HS256", typ: "JWT" });
  const payload = encode({
    sub: subject,
    aud: "authenticated",
    role: "authenticated",
    exp: Math.floor(Date.now() / 1000) + expiresInSeconds,
    iat: Math.floor(Date.now() / 1000),
  });
  return `${header}.${payload}.c3ludGhldGljLXNpZ25hdHVyZQ`;
}

/** Clients constructed by a test, torn down afterwards so no SDK timer or
 * subscription outlives it. */
const openClients: SupabaseClient[] = [];

afterEach(async () => {
  while (openClients.length > 0) {
    const client = openClients.pop();
    try {
      client?.auth.stopAutoRefresh();
    } catch {
      /* nothing to stop */
    }
  }
  window.localStorage.clear();
  vi.restoreAllMocks();
});

type FakeStore = SecureCredentialStore & {
  items: Map<string, string>;
  /** Reads report no absence evidence — what the INSTALLED bindings do. */
  withholdAbsenceEvidence: boolean;
  /** Keys whose individual read fails, leaving every other key readable. */
  itemReadFailures: Set<string>;
  readFails: boolean;
  writeFails: boolean;
  removeFails: boolean;
  reads: string[];
  writes: Array<[string, string]>;
  removals: string[];
};

function fakeStore(overrides: Partial<FakeStore> = {}): FakeStore {
  const store: FakeStore = {
    items: new Map<string, string>(),
    withholdAbsenceEvidence: false,
    itemReadFailures: new Set<string>(),
    readFails: false,
    writeFails: false,
    removeFails: false,
    reads: [],
    writes: [],
    removals: [],

    async read(key: string): Promise<SecureCredentialReadResult> {
      store.reads.push(key);
      if (store.readFails) {
        return { status: "read_failed", error: { kind: "store_inaccessible" } };
      }
      if (store.itemReadFailures.has(key)) {
        return { status: "read_failed", error: { kind: "absence_not_established" } };
      }
      const value = store.items.get(key);
      if (value !== undefined) return { status: "value", value };
      return store.withholdAbsenceEvidence
        ? { status: "read_failed", error: { kind: "absence_not_established" } }
        : { status: "absent" };
    },
    async write(key: string, value: string): Promise<SecureCredentialWriteResult> {
      store.writes.push([key, value]);
      if (store.writeFails) {
        return {
          ok: false,
          error: { kind: "store_inaccessible" },
          previousValueMayBeLost: false,
        };
      }
      store.items.set(key, value);
      return { ok: true };
    },
    async remove(key: string): Promise<SecureCredentialRemoveResult> {
      store.removals.push(key);
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

function integrationOver(store: SecureCredentialStore) {
  return createProviderCredentialStorage(store, { sessionStorageKey: SESSION_KEY });
}

/** Lets the SDK's constructor-time, fire-and-forget work settle. */
async function afterSdkConstruction(): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 0));
  await new Promise((resolve) => setTimeout(resolve, 0));
}

/**
 * Captures rejections nothing in the SDK awaited. `_emitInitialSession` is
 * started from the constructor and awaited by nobody, so a storage failure there
 * surfaces as an UNHANDLED rejection — which is itself evidence for why this
 * integration keeps its own failure channel, and means the thrown value must
 * carry nothing sensitive.
 */
async function withUnhandledRejectionsCaptured(
  run: () => Promise<void>
): Promise<unknown[]> {
  const captured: unknown[] = [];
  const onUnhandled = (reason: unknown) => {
    captured.push(reason);
  };
  process.on("unhandledRejection", onUnhandled);
  try {
    await run();
    await afterSdkConstruction();
  } finally {
    process.off("unhandledRejection", onUnhandled);
  }
  return captured;
}

describe("the SDK session key this integration reads", () => {
  it("matches the key the INSTALLED SDK actually writes", async () => {
    // Mirroring SDK-internal derivation is a drift risk, so it is pinned against
    // the real thing rather than trusted: a real client writes a session and the
    // key it used is compared with the derivation.
    const recorded: string[] = [];
    const recordingStorage = {
      async getItem() {
        return null;
      },
      async setItem(key: string) {
        recorded.push(key);
      },
      async removeItem() {},
    };
    const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: { ...BROWSER_AUTH_OPTIONS, storage: recordingStorage },
      global: { fetch: userResponseFetch("11111111-1111-4111-8111-111111111111") },
    });
    openClients.push(client);

    const { error } = await client.auth.setSession({
      access_token: syntheticAccessToken("11111111-1111-4111-8111-111111111111"),
      refresh_token: "derivation-refresh-token",
    });
    expect(error).toBeNull();

    const derived = providerSessionStorageKey(SUPABASE_URL);
    expect(derived).toBe("sb-credentials-auth-token");
    expect(recorded).toContain(derived);
  });

  it("fails closed for a URL it cannot derive a key from", () => {
    for (const bad of ["", "not-a-url", "://nope", "http://"]) {
      expect(providerSessionStorageKey(bad)).toBeNull();
    }
  });
});

describe("provider credential storage — establishment", () => {
  it("reports established for a conclusive ABSENT answer, and writes nothing", async () => {
    const store = fakeStore();
    const integration = integrationOver(store);

    expect(await integration.establish()).toEqual({
      status: "established",
      sessionPresent: false,
    });
    // No marker, no probe: a failed or successful establishment cannot have
    // modified the store, which is what lets a failure surface say so honestly.
    expect(store.writes).toEqual([]);
    expect(store.reads).toEqual([SESSION_KEY]);
    expect(integration.observedFailure()).toBeNull();
  });

  it("reports established and sessionPresent for a conclusive VALUE answer", async () => {
    const store = fakeStore();
    store.items.set(SESSION_KEY, '{"access_token":"x"}');
    const integration = integrationOver(store);

    expect(await integration.establish()).toEqual({
      status: "established",
      sessionPresent: true,
    });
    expect(store.writes).toEqual([]);
  });

  it("fails closed when the store WITHHOLDS absence evidence", async () => {
    // The installed-binding case on both platforms. There is no marker to
    // consult and no inference to make: it blocks.
    const store = fakeStore({ withholdAbsenceEvidence: true });
    const integration = integrationOver(store);

    expect(await integration.establish()).toEqual({
      status: "unavailable",
      failure: { kind: "absence_not_established" },
    });
    expect(store.writes).toEqual([]);
  });

  it("fails closed when the session key cannot be read at all", async () => {
    const store = fakeStore({ readFails: true });
    const integration = integrationOver(store);

    expect(await integration.establish()).toEqual({
      status: "unavailable",
      failure: { kind: "read_failed" },
    });
    expect(integration.observedFailure()).toEqual({ kind: "read_failed" });
  });

  it("does NOT return established over an unresolved latch after a retry", async () => {
    // The reproduced defect: a failed establishment latched an error, and a
    // later successful establish() reported `established` while the latch still
    // stood — so composition could publish ready over a recorded failure.
    const store = fakeStore({ readFails: true });
    const integration = integrationOver(store);

    expect((await integration.establish()).status).toBe("unavailable");
    expect(integration.observedFailure()).toEqual({ kind: "read_failed" });

    // The store recovers. Establishment must still refuse, because the recorded
    // failure has not been resolved and is not silently erased.
    store.readFails = false;
    expect(await integration.establish()).toEqual({
      status: "unavailable",
      failure: { kind: "read_failed" },
    });
    expect(integration.observedFailure()).toEqual({ kind: "read_failed" });
  });

  it("reports an unavailable store as its own category", async () => {
    const store = fakeStore();
    store.read = async () => ({
      status: "read_failed",
      error: { kind: "store_unavailable" },
    });
    const integration = integrationOver(store);

    expect(await integration.establish()).toEqual({
      status: "unavailable",
      failure: { kind: "store_unavailable" },
    });
  });
});

describe("provider credential storage — only established absence becomes null", () => {
  it("returns null for a conclusively absent key", async () => {
    const store = fakeStore();
    const integration = integrationOver(store);
    await integration.establish();

    expect(await integration.storage.getItem(SESSION_KEY)).toBeNull();
    expect(integration.observedFailure()).toBeNull();
  });

  it("THROWS for an ITEM-SPECIFIC failure even though other keys read fine", async () => {
    // The invalid marker inference, reproduced: the session key's own read
    // fails while every other key — including any probe one might be tempted to
    // add — reads perfectly. There is no observation that makes this absence.
    const store = fakeStore();
    store.items.set("sb-credentials-auth-token-flows-code-verifier", "[]");
    const integration = integrationOver(store);
    await integration.establish();

    store.itemReadFailures.add(SESSION_KEY);

    await expect(integration.storage.getItem(SESSION_KEY)).rejects.toThrow();
    expect(integration.observedFailure()).toEqual({ kind: "absence_not_established" });
    // And the other key is genuinely still readable, so this is not a
    // store-wide outage being detected by luck.
    const other = await integration.storage.getItem(
      "sb-credentials-auth-token-flows-code-verifier"
    );
    expect(other).toBe("[]");
  });

  it("THROWS when the store withholds absence evidence", async () => {
    const store = fakeStore();
    const integration = integrationOver(store);
    store.items.set(SESSION_KEY, "present");
    await integration.establish();
    store.items.delete(SESSION_KEY);
    store.withholdAbsenceEvidence = true;

    await expect(integration.storage.getItem(SESSION_KEY)).rejects.toThrow();
    expect(integration.observedFailure()).toEqual({ kind: "absence_not_established" });
  });

  it("never resolves null for an outright read failure", async () => {
    const store = fakeStore();
    const integration = integrationOver(store);
    await integration.establish();
    store.readFails = true;

    await expect(integration.storage.getItem(SESSION_KEY)).rejects.toThrow();
    expect(integration.observedFailure()).toEqual({ kind: "read_failed" });
  });

  it("keeps the FIRST failure, so a later success cannot retract it", async () => {
    const store = fakeStore();
    const integration = integrationOver(store);
    await integration.establish();

    store.readFails = true;
    await expect(integration.storage.getItem("k")).rejects.toThrow();
    store.readFails = false;
    store.items.set("k", "value");
    expect(await integration.storage.getItem("k")).toBe("value");

    expect(integration.observedFailure()).toEqual({ kind: "read_failed" });
  });
});

describe("provider credential storage — failed writes and removals are not successes", () => {
  it("throws on a failed write and latches it", async () => {
    const store = fakeStore();
    const integration = integrationOver(store);
    await integration.establish();
    store.writeFails = true;

    await expect(integration.storage.setItem("k", "v")).rejects.toThrow();
    expect(integration.observedFailure()).toEqual({ kind: "write_failed" });
    expect(store.items.has("k")).toBe(false);
  });

  it("throws on a failed removal and latches it", async () => {
    const store = fakeStore();
    const integration = integrationOver(store);
    await integration.establish();
    store.items.set("k", "v");
    store.removeFails = true;

    await expect(integration.storage.removeItem("k")).rejects.toThrow();
    expect(integration.observedFailure()).toEqual({ kind: "removal_failed" });
    expect(store.items.get("k")).toBe("v");
  });

  it("does not latch 'nothing to delete', which is an idempotent success", async () => {
    const store = fakeStore();
    const integration = integrationOver(store);
    await integration.establish();

    await expect(integration.storage.removeItem("never-written")).resolves.toBeUndefined();
    expect(integration.observedFailure()).toBeNull();
  });
});

describe("provider credential storage — the failure channel notifies", () => {
  it("delivers the first failure to subscribers, and only the first", async () => {
    const store = fakeStore();
    const integration = integrationOver(store);
    await integration.establish();

    const seen: unknown[] = [];
    integration.subscribe((failure) => seen.push(failure));

    store.readFails = true;
    await expect(integration.storage.getItem("a")).rejects.toThrow();
    await expect(integration.storage.getItem("b")).rejects.toThrow();

    expect(seen).toEqual([{ kind: "read_failed" }]);
  });

  it("delivers a failure recorded BEFORE the subscription, so a late subscriber cannot miss it", async () => {
    const store = fakeStore({ readFails: true });
    const integration = integrationOver(store);
    await integration.establish();

    const seen: unknown[] = [];
    integration.subscribe((failure) => seen.push(failure));

    expect(seen).toEqual([{ kind: "read_failed" }]);
  });

  it("a throwing subscriber cannot break a storage operation or starve another subscriber", async () => {
    const store = fakeStore();
    const integration = integrationOver(store);
    await integration.establish();

    const seen: unknown[] = [];
    integration.subscribe(() => {
      throw new Error("hostile listener");
    });
    integration.subscribe((failure) => seen.push(failure));

    store.readFails = true;
    await expect(integration.storage.getItem("a")).rejects.toThrow(
      "Protected credential storage is unavailable."
    );
    expect(seen).toEqual([{ kind: "read_failed" }]);
  });

  it("unsubscribes cleanly", async () => {
    const store = fakeStore();
    const integration = integrationOver(store);
    await integration.establish();

    const seen: unknown[] = [];
    const unsubscribe = integration.subscribe((failure) => seen.push(failure));
    unsubscribe();

    store.readFails = true;
    await expect(integration.storage.getItem("a")).rejects.toThrow();
    expect(seen).toEqual([]);
  });
});

describe("provider credential storage — values and keys pass through untouched", () => {
  it("round-trips the empty string and Unicode exactly", async () => {
    const store = fakeStore();
    const integration = integrationOver(store);
    await integration.establish();

    for (const value of ['""', "", "Zürich 🥌", '{"a":"ö"}', "  padded  ", " "]) {
      await integration.storage.setItem("k", value);
      expect(await integration.storage.getItem("k")).toBe(value);
      expect(store.items.get("k")).toBe(value);
    }
  });

  it("carries no secret or key material in the error it hands the SDK", async () => {
    const store = fakeStore({ readFails: true });
    const integration = integrationOver(store);
    await integration.establish();

    const thrown = await integration.storage
      .getItem("sb-secret-auth-token")
      .then(
        () => null,
        (error: unknown) => error
      );
    const text = String(thrown instanceof Error ? thrown.stack ?? thrown.message : thrown);

    expect(text).not.toContain("sb-secret-auth-token");
    expect(text).not.toContain("store_inaccessible");
    expect(thrown).toBeInstanceOf(Error);
    expect((thrown as Error).message).toBe("Protected credential storage is unavailable.");
  });
});

/** A transport that answers the SDK's `GET /auth/v1/user` with a fixed account
 * and refuses every other request, so nothing can reach a network. */
function userResponseFetch(userId: string): typeof fetch {
  return (async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input instanceof URL ? input.href : input.url;
    if (url.includes("/auth/v1/user")) {
      return new Response(
        JSON.stringify({
          id: userId,
          aud: "authenticated",
          role: "authenticated",
          email: "credentials@example.test",
          app_metadata: {},
          user_metadata: {},
          created_at: "2024-01-01T00:00:00.000Z",
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }
    throw new Error(`unexpected request: ${url}`);
  }) as unknown as typeof fetch;
}

describe("INSTALLED SDK driven through the real integration seam", () => {
  function clientWith(
    storage: ReturnType<typeof createProviderCredentialStorage>["storage"],
    storageKey: string,
    fetchImpl: typeof fetch
  ): SupabaseClient {
    const client = createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
      auth: { ...BROWSER_AUTH_OPTIONS, storageKey, storage },
      global: { fetch: fetchImpl },
    });
    openClients.push(client);
    return client;
  }

  it("SUCCESSFULLY persists a session, then restores the same identity in a fresh client", async () => {
    const userId = "22222222-2222-4222-8222-222222222222";
    const store = fakeStore();
    const integration = integrationOver(store);
    expect(await integration.establish()).toEqual({
      status: "established",
      sessionPresent: false,
    });

    const writer = clientWith(integration.storage, SESSION_KEY, userResponseFetch(userId));
    await afterSdkConstruction();

    // 1. The operation SUCCEEDS — not "errored but touched storage".
    const accessToken = syntheticAccessToken(userId);
    const saved = await writer.auth.setSession({
      access_token: accessToken,
      refresh_token: "round-trip-refresh-token",
    });
    expect(saved.error).toBeNull();
    expect(saved.data.session?.user.id).toBe(userId);

    // 2. The expected session is in the protected store, under the SDK's key,
    //    carrying the tokens that were saved.
    const persisted = store.items.get(SESSION_KEY);
    expect(persisted).toBeDefined();
    const parsed = JSON.parse(persisted as string) as {
      access_token: string;
      refresh_token: string;
      user?: { id?: string };
    };
    expect(parsed.access_token).toBe(accessToken);
    expect(parsed.refresh_token).toBe("round-trip-refresh-token");
    expect(parsed.user?.id).toBe(userId);

    // 3. A FRESH client — a new document, sharing only the protected store —
    //    restores the same account identity.
    const secondIntegration = integrationOver(store);
    expect(await secondIntegration.establish()).toEqual({
      status: "established",
      sessionPresent: true,
    });
    const reader = clientWith(
      secondIntegration.storage,
      SESSION_KEY,
      userResponseFetch(userId)
    );
    const restored = await reader.auth.getSession();
    expect(restored.error).toBeNull();
    expect(restored.data.session?.user.id).toBe(userId);
    expect(restored.data.session?.access_token).toBe(accessToken);

    // 4. Nothing went to WebView storage, and no failure was recorded.
    expect(window.localStorage.length).toBe(0);
    expect(integration.observedFailure()).toBeNull();
    expect(secondIntegration.observedFailure()).toBeNull();
  });

  it("does NOT report a clean signed-out session when the credential store cannot be read", async () => {
    const store = fakeStore();
    const integration = integrationOver(store);
    await integration.establish();
    const client = clientWith(integration.storage, SESSION_KEY, userResponseFetch("x"));
    await afterSdkConstruction();

    store.readFails = true;

    const outcome = await client.auth
      .getSession()
      .then((value) => ({ kind: "resolved" as const, value }))
      .catch(() => ({ kind: "rejected" as const }));

    if (outcome.kind === "resolved") {
      expect(outcome.value.error).not.toBeNull();
    } else {
      expect(outcome.kind).toBe("rejected");
    }
    expect(integration.observedFailure()).toEqual({ kind: "read_failed" });
  });

  it("records a storage failure that happens during SDK INITIALISATION", async () => {
    // `initialize()` wraps `_initialize()` in a catch that converts any thrown
    // value into a RETURNED `{ error }` nobody reads, and
    // `_emitInitialSession()` is awaited by nothing — so the SDK is not a
    // reliable reporter and the application's own channel is.
    const store = fakeStore({ readFails: true });
    const integration = integrationOver(store);

    const unhandled = await withUnhandledRejectionsCaptured(async () => {
      const client = clientWith(integration.storage, SESSION_KEY, userResponseFetch("x"));
      await client.auth.getSession().then(
        () => undefined,
        () => undefined
      );
    });

    expect(integration.observedFailure()).toEqual({ kind: "read_failed" });
    for (const reason of unhandled) {
      expect(reason).toBeInstanceOf(Error);
      expect((reason as Error).message).toBe("Protected credential storage is unavailable.");
      expect(String((reason as Error).stack ?? "")).not.toContain(SESSION_KEY);
    }
  });

  it("routes EVERY key the SDK actually uses through the protected store, including verifier slots", async () => {
    const store = fakeStore();
    const integration = integrationOver(store);
    await integration.establish();
    const client = clientWith(integration.storage, SESSION_KEY, userResponseFetch("x"));
    await afterSdkConstruction();

    const { data, error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: "https://app.example.test/", skipBrowserRedirect: true },
    });
    expect(error).toBeNull();
    expect(typeof data.flowId).toBe("string");

    const written = store.writes.map(([key]) => key);
    expect(written).toContain(`${SESSION_KEY}-flow-${data.flowId}-code-verifier`);
    expect(written).toContain(`${SESSION_KEY}-flows-code-verifier`);
    expect(written).toContain(`${SESSION_KEY}-code-verifier`);
    expect(written.filter((key) => key.startsWith(SESSION_KEY)).length).toBeGreaterThanOrEqual(3);

    await client.auth.signOut({ scope: "local" });
    expect(store.removals).toContain(`${SESSION_KEY}-user`);
    expect(store.removals).toContain(SESSION_KEY);

    expect(window.localStorage.length).toBe(0);
  });

  it("does not report sign-out as durable success when credential removal fails", async () => {
    const store = fakeStore();
    const integration = integrationOver(store);
    await integration.establish();
    const client = clientWith(integration.storage, SESSION_KEY, userResponseFetch("x"));
    await afterSdkConstruction();

    store.removeFails = true;
    const outcome = await client.auth
      .signOut({ scope: "local" })
      .then((value) => ({ kind: "resolved" as const, value }))
      .catch(() => ({ kind: "rejected" as const }));

    if (outcome.kind === "resolved") {
      expect(outcome.value.error).not.toBeNull();
    } else {
      expect(outcome.kind).toBe("rejected");
    }
    expect(integration.observedFailure()).toEqual({ kind: "removal_failed" });
  });
});
