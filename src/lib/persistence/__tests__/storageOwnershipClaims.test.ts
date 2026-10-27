// @vitest-environment jsdom
//
// The two module-level ownership slots — Stage M3b3.
//
// Both exist for the same reason: their consumers CAPTURE what they are given.
// The Supabase client reads storage from its own constructor; the identity
// coordinator holds its five repositories for the runtime's lifetime. So a
// second, different answer would not move a workspace — it would split one. Both
// slots therefore refuse late and conflicting configuration rather than applying
// it, and both are idempotent for the same value so a replayed effect is not a
// conflict.
import { afterEach, describe, expect, it } from "vitest";
import {
  claimBrowserAuthStorage,
  claimedBrowserAuthStorage,
  getSupabaseBrowserClient,
  resetSupabaseBrowserClientForTests,
  BROWSER_AUTH_OPTIONS,
} from "../../supabase/supabaseClient";
import {
  claimIdentityRepositories,
  claimedIdentityRepositorySet,
  createIdentityRuntime,
  getIdentityRuntime,
  resetIdentityRuntimeForTests,
} from "../../identity/identityRuntime";
import {
  createIdentityRepositorySet,
  DEFAULT_IDENTITY_REPOSITORY_SET,
} from "../../identity/identityRepositorySet";
import type { ConfiguredCloudConfig } from "../../supabase/config";
import type { RemovableStorageAdapter } from "../types";

const CONFIG: ConfiguredCloudConfig = {
  status: "configured",
  url: "https://ownership.supabase.co",
  publishableKey: "sb_publishable_" + "e".repeat(24),
};

function memoryAdapter(): RemovableStorageAdapter & { keys: string[] } {
  const values = new Map<string, string>();
  const keys: string[] = [];
  return {
    keys,
    async get(key) {
      keys.push(key);
      return { status: "value", value: values.has(key) ? (values.get(key) as string) : null };
    },
    async set(key, value) {
      keys.push(key);
      values.set(key, value);
      return { ok: true };
    },
    async remove(key) {
      keys.push(key);
      values.delete(key);
      return { ok: true };
    },
  };
}

const noopStorage = {
  async getItem() {
    return null;
  },
  async setItem() {},
  async removeItem() {},
};

/** A health accessor reporting no failure, claimed alongside the storage. */
const healthyCredentials = () => null;

afterEach(() => {
  resetSupabaseBrowserClientForTests();
  resetIdentityRuntimeForTests();
  window.localStorage.clear();
});

describe("credential-storage ownership slot", () => {
  it("is unclaimed by default, so the Web build keeps the SDK's own storage", () => {
    expect(claimedBrowserAuthStorage()).toBeNull();
    const client = getSupabaseBrowserClient(CONFIG);
    expect(client.auth).toBeDefined();
  });

  it("leaves the three ADR-0025 Decision 10 options exactly as they were", () => {
    // Claiming adds `storage` and changes nothing else.
    expect(BROWSER_AUTH_OPTIONS).toEqual({
      flowType: "pkce",
      detectSessionInUrl: false,
      experimental: { appendPkceFlowIdToRedirects: true },
    });
    expect(BROWSER_AUTH_OPTIONS).not.toHaveProperty("storage");
  });

  it("accepts a claim made before any client exists", () => {
    expect(claimBrowserAuthStorage(noopStorage, healthyCredentials)).toEqual({ ok: true });
    expect(claimedBrowserAuthStorage()).toBe(noopStorage);
    expect(getSupabaseBrowserClient(CONFIG).auth).toBeDefined();
  });

  it("REFUSES a claim made after a client was already constructed", () => {
    getSupabaseBrowserClient(CONFIG);

    expect(claimBrowserAuthStorage(noopStorage, healthyCredentials)).toEqual({
      ok: false,
      reason: "client_already_constructed",
    });
    // And the refusal is total: the existing client keeps its own storage.
    expect(claimedBrowserAuthStorage()).toBeNull();
  });

  it("REFUSES a second, different claim", () => {
    expect(claimBrowserAuthStorage(noopStorage, healthyCredentials)).toEqual({ ok: true });
    expect(claimBrowserAuthStorage({ ...noopStorage }, healthyCredentials)).toEqual({
      ok: false,
      reason: "already_claimed",
    });
    expect(claimedBrowserAuthStorage()).toBe(noopStorage);
  });

  it("is idempotent for the same storage, so a replayed effect is not a conflict", () => {
    expect(claimBrowserAuthStorage(noopStorage, healthyCredentials)).toEqual({ ok: true });
    expect(claimBrowserAuthStorage(noopStorage, healthyCredentials)).toEqual({ ok: true });
  });

  it("constructs ONE client, not one per consumer", () => {
    claimBrowserAuthStorage(noopStorage, healthyCredentials);
    expect(getSupabaseBrowserClient(CONFIG)).toBe(getSupabaseBrowserClient(CONFIG));
  });
});

describe("identity-repository ownership slot", () => {
  it("is unclaimed by default, so the runtime uses the existing singletons", () => {
    expect(claimedIdentityRepositorySet()).toBeNull();
    // Non-vacuous: the default set names the five repositories the coordinator
    // needs, under the member names it needs.
    expect(Object.keys(DEFAULT_IDENTITY_REPOSITORY_SET).sort()).toEqual([
      "attempts",
      "barriers",
      "deletionGuards",
      "intents",
      "resolutions",
      "trusted",
    ]);
  });

  it("accepts a claim made before any runtime exists", () => {
    const set = createIdentityRepositorySet(memoryAdapter());
    expect(claimIdentityRepositories(set)).toEqual({ ok: true });
    expect(claimedIdentityRepositorySet()).toBe(set);
  });

  it("REFUSES a claim made after the runtime was already constructed", () => {
    // `getIdentityRuntime()` caches, and the coordinator it built has already
    // captured its repositories.
    getIdentityRuntime();
    const set = createIdentityRepositorySet(memoryAdapter());

    expect(claimIdentityRepositories(set)).toEqual({
      ok: false,
      reason: "runtime_already_constructed",
    });
    expect(claimedIdentityRepositorySet()).toBeNull();
  });

  it("REFUSES a second, different claim", () => {
    const first = createIdentityRepositorySet(memoryAdapter());
    const second = createIdentityRepositorySet(memoryAdapter());

    expect(claimIdentityRepositories(first)).toEqual({ ok: true });
    expect(claimIdentityRepositories(second)).toEqual({
      ok: false,
      reason: "already_claimed",
    });
    expect(claimedIdentityRepositorySet()).toBe(first);
  });

  it("is idempotent for the same set", () => {
    const set = createIdentityRepositorySet(memoryAdapter());
    expect(claimIdentityRepositories(set)).toEqual({ ok: true });
    expect(claimIdentityRepositories(set)).toEqual({ ok: true });
  });
});

describe("loadPendingIntent uses the SAME ownership as the coordinator", () => {
  it("reads through the injected repository, not the import-time singleton", async () => {
    // This is the seam-4 defect the stage had to fix: `loadPendingIntent`
    // previously reached the module-level singleton directly, which under
    // injected ownership is a DIFFERENT store from the one every coordinator
    // transition writes to.
    let loads = 0;
    const injected = {
      ...DEFAULT_IDENTITY_REPOSITORY_SET.intents,
      async load() {
        loads += 1;
        return { status: "absent" as const };
      },
    };

    const runtime = createIdentityRuntime({
      deps: {
        ...fakeDeps(),
        intents: injected,
      },
    });
    if (runtime.status !== "ready") throw new Error("expected a ready runtime");

    expect(await runtime.loadPendingIntent()).toBeNull();
    expect(loads).toBe(1);
  });

  it("the unscoped singleton is NOT consulted when a repository is injected", async () => {
    // Proven by storage traffic: the injected repository is backed by a memory
    // adapter, and `window.localStorage` — where the singleton lives — stays
    // untouched.
    const adapter = memoryAdapter();
    const set = createIdentityRepositorySet(adapter);
    const runtime = createIdentityRuntime({ deps: { ...fakeDeps(), intents: set.intents } });
    if (runtime.status !== "ready") throw new Error("expected a ready runtime");

    adapter.keys.length = 0;
    await runtime.loadPendingIntent();

    expect(adapter.keys).toEqual(["curling.identity.pendingIntent.v1"]);
    expect(window.localStorage.length).toBe(0);
  });
});

/**
 * The minimum dependency set `createIdentityRuntime` needs to reach its ready
 * branch without constructing a Supabase client. Only `intents` matters to the
 * assertions above; every other member is an inert stand-in that these tests
 * never exercise, which is why the cast is confined to this one helper.
 */
type RuntimeDeps = NonNullable<Parameters<typeof createIdentityRuntime>[0]>["deps"];

function fakeDeps(): NonNullable<RuntimeDeps> {
  return {
    auth: { onAuthChange: () => () => {} },
    identity: {},
    capture: { consume: () => null },
    barriers: DEFAULT_IDENTITY_REPOSITORY_SET.barriers,
    attempts: DEFAULT_IDENTITY_REPOSITORY_SET.attempts,
    resolutions: DEFAULT_IDENTITY_REPOSITORY_SET.resolutions,
    trusted: DEFAULT_IDENTITY_REPOSITORY_SET.trusted,
    intents: DEFAULT_IDENTITY_REPOSITORY_SET.intents,
    liveGeneration: { current: () => 0, next: () => 1 },
    now: () => "2026-09-30T00:00:00.000Z",
    newId: () => "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
    resolveRedirectTarget: () => "https://app.example.test/",
  } as unknown as NonNullable<RuntimeDeps>;
}
