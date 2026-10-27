// @vitest-environment jsdom
//
// The owned storage composition — Stage M3b3.
//
// What these tests are for:
//
//   1. **The barrier.** A flag-enabled production path must not become ready
//      without a migration/activation authority, and must not open anything
//      while asking. Both are asserted by call ORDER, not by inspecting a result.
//   2. **Every seam.** Three sporting seams plus the five identity repositories
//      must demonstrably address the SELECTED adapter. The separate outbox
//      adapter and the dynamic barrier-resolution family are checked
//      individually, because those are the two a "swap the default" change
//      silently misses.
//   3. **Ownership as ONE lifecycle** — concurrency, retries, retained claims,
//      disposal and re-entry. The ownership cases below use the **REAL** claim
//      functions (`claimBrowserAuthStorage`, `claimIdentityRepositories`),
//      because always-successful stubs cannot prove production behaviour and
//      previously hid two defects.
//   4. **Profile namespaces stay immutable** across an account switch.
//   5. **No fallback**, ever, after native selection fails.
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  composeNativeStorage,
  resetStorageCompositionForTests,
  storageCompositionPhase,
  NATIVE_APPLICATION_DATABASE_NAME,
  type NativeActivationAuthority,
  type NativeStoreHandle,
  type OwnershipClaimResult,
} from "../storageComposition";
import { WEB_DEFAULT_SPORTING_SEAMS, WEB_DEFAULT_STORAGE_ADAPTER } from "../storageSeams";
import { localStorageAdapter } from "../localStorageAdapter";
import {
  LEGACY_SPORTING_RETIREMENT_MARKER_KEY,
  SPORTING_STORAGE_KEYS,
} from "../profileScopedSportingPersistence";
import { CURRENT_SESSION_STORAGE_KEY } from "../../sessionRepository";
import { CLOUD_SPORTING_SYNC_STORAGE_KEY } from "../../cloudSporting/syncStateRepository";
import { resolutionStorageKeyFor } from "../../identity/identityBarrierResolution";
import { IDENTITY_BARRIER_STORAGE_KEY } from "../../identity/identityBarrier";
import { TRUSTED_DEVICE_STORAGE_KEY } from "../../identity/trustedDevice";
import { INTERACTIVE_ATTEMPT_STORAGE_KEY } from "../../identity/interactiveAttempt";
import {
  INTENT_CLEANUP_STORAGE_KEY,
  PENDING_INTENT_STORAGE_KEY,
} from "../../identity/pendingIntentRepository";
import {
  claimBrowserAuthStorage,
  resetSupabaseBrowserClientForTests,
} from "../../supabase/supabaseClient";
import {
  claimIdentityRepositories,
  resetIdentityRuntimeForTests,
} from "../../identity/identityRuntime";
import type { SecureCredentialStore } from "../secureCredentialStore";
import type { RemovableStorageAdapter } from "../types";
import type { RuntimePlatform } from "../../platform/runtimePlatform";

const PROFILE_A = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const PROFILE_B = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
const SESSION_KEY = "sb-test-auth-token";

/** An in-memory `RemovableStorageAdapter` that records every physical key it
 * was asked about. The keys are the evidence. */
function recordingAdapter() {
  const values = new Map<string, string>();
  const gets: string[] = [];
  const sets: Array<[string, string]> = [];
  const removes: string[] = [];
  const adapter: RemovableStorageAdapter = {
    async get(key) {
      gets.push(key);
      return { status: "value", value: values.has(key) ? (values.get(key) as string) : null };
    },
    async set(key, value) {
      sets.push([key, value]);
      values.set(key, value);
      return { ok: true };
    },
    async remove(key) {
      removes.push(key);
      values.delete(key);
      return { ok: true };
    },
  };
  return { adapter, values, gets, sets, removes };
}

const READY_AUTHORITY: NativeActivationAuthority = {
  async verdict() {
    return { status: "ready" };
  },
};
const UNAVAILABLE_AUTHORITY: NativeActivationAuthority = {
  async verdict() {
    return { status: "unavailable", reason: "migration_not_implemented" };
  },
};
const BLOCKED_AUTHORITY: NativeActivationAuthority = {
  async verdict() {
    return { status: "blocked" };
  },
};

const ALLOW: () => OwnershipClaimResult = () => ({ ok: true });

// Each test is a fresh document: the composition, the ownership slots and the
// cached Supabase client are all page-scoped by design.
afterEach(() => {
  resetStorageCompositionForTests();
  resetSupabaseBrowserClientForTests();
  resetIdentityRuntimeForTests();
});

function harness(options: { credentialsWithholdAbsence?: boolean } = {}) {
  const store = recordingAdapter();
  const state = { closes: 0 };
  const credentialItems = new Map<string, string>();

  const handle: NativeStoreHandle = {
    adapter: store.adapter,
    async close() {
      state.closes += 1;
      return { ok: true };
    },
  };

  const createNativeStore = vi.fn(async () => handle);
  const createCredentialStore = vi.fn(
    (): SecureCredentialStore => ({
      async read(key: string) {
        const value = credentialItems.get(key);
        if (value !== undefined) return { status: "value", value };
        return options.credentialsWithholdAbsence
          ? { status: "read_failed", error: { kind: "absence_not_established" } }
          : { status: "absent" };
      },
      async write(key: string, value: string) {
        credentialItems.set(key, value);
        return { ok: true };
      },
      async remove(key: string) {
        const existed = credentialItems.delete(key);
        return {
          ok: true,
          outcome: existed ? "deleted_reported" : "nothing_to_delete_reported",
        };
      },
    })
  );

  return { store, state, createNativeStore, createCredentialStore, credentialItems };
}

function compose(
  authority: NativeActivationAuthority,
  h: ReturnType<typeof harness>,
  overrides: {
    platform?: RuntimePlatform;
    sessionStorageKey?: string | null;
    establishCredentialStorage?: (credentials: unknown) => OwnershipClaimResult;
    establishIdentityRepositories?: (repositories: unknown) => OwnershipClaimResult;
  } = {}
) {
  return composeNativeStorage({
    activationAuthority: authority,
    sessionStorageKey:
      overrides.sessionStorageKey === undefined ? SESSION_KEY : overrides.sessionStorageKey,
    detectPlatform: () => overrides.platform ?? "ios",
    createNativeStore: h.createNativeStore,
    createCredentialStore: h.createCredentialStore,
    establishCredentialStorage: overrides.establishCredentialStorage ?? ALLOW,
    establishIdentityRepositories: overrides.establishIdentityRepositories ?? ALLOW,
  });
}

/** The REAL claim functions, as production wires them. */
function realClaims(h: ReturnType<typeof harness>, authority: NativeActivationAuthority) {
  return composeNativeStorage({
    activationAuthority: authority,
    sessionStorageKey: SESSION_KEY,
    detectPlatform: () => "ios",
    createNativeStore: h.createNativeStore,
    createCredentialStore: h.createCredentialStore,
    establishCredentialStorage: (credentials) =>
      claimBrowserAuthStorage(credentials.storage, () => credentials.observedFailure()),
    establishIdentityRepositories: (repositories) => claimIdentityRepositories(repositories),
  });
}

describe("storage composition — the barrier against premature cutover", () => {
  it("cannot become ready while the migration authority is unavailable", async () => {
    const h = harness();
    expect(await compose(UNAVAILABLE_AUTHORITY, h)).toEqual({
      status: "blocked",
      failure: { kind: "migration_authority_unavailable" },
    });
  });

  it("opens NOTHING while the authority says unavailable — no database, no credential store", async () => {
    const h = harness();
    await compose(UNAVAILABLE_AUTHORITY, h);

    expect(h.createNativeStore).not.toHaveBeenCalled();
    expect(h.createCredentialStore).not.toHaveBeenCalled();
    expect(h.store.sets).toEqual([]);
    expect(h.store.gets).toEqual([]);
    expect(h.credentialItems.size).toBe(0);
  });

  it("reports a BLOCKED activation record distinctly from an unavailable authority", async () => {
    const h = harness();
    expect(await compose(BLOCKED_AUTHORITY, h)).toEqual({
      status: "blocked",
      failure: { kind: "migration_blocked" },
    });
    expect(h.createNativeStore).not.toHaveBeenCalled();
  });

  it("treats a throwing authority as not-ready, never as ready", async () => {
    const h = harness();
    const throwing: NativeActivationAuthority = {
      async verdict() {
        throw new Error("authority exploded");
      },
    };
    expect(await compose(throwing, h)).toEqual({
      status: "blocked",
      failure: { kind: "migration_authority_unavailable" },
    });
    expect(h.createNativeStore).not.toHaveBeenCalled();
  });
});

describe("storage composition — platform gating fails closed with no fallback", () => {
  it.each<RuntimePlatform>(["web", "unsupported_native"])(
    "refuses on %s before asking the authority or loading a plugin",
    async (platform) => {
      const h = harness();
      const authority = { verdict: vi.fn(READY_AUTHORITY.verdict) };
      const result = await compose(authority, h, { platform });

      expect(result).toEqual({ status: "blocked", failure: { kind: "platform_unsupported" } });
      expect(authority.verdict).not.toHaveBeenCalled();
      expect(h.createNativeStore).not.toHaveBeenCalled();
      expect(h.createCredentialStore).not.toHaveBeenCalled();
    }
  );

  it("treats a throwing platform signal as unsupported rather than as the Web", async () => {
    const h = harness();
    const result = await composeNativeStorage({
      activationAuthority: READY_AUTHORITY,
      sessionStorageKey: SESSION_KEY,
      detectPlatform: () => {
        throw new Error("hostile bridge");
      },
      createNativeStore: h.createNativeStore,
      createCredentialStore: h.createCredentialStore,
      establishCredentialStorage: ALLOW,
      establishIdentityRepositories: ALLOW,
    });
    expect(result).toEqual({ status: "blocked", failure: { kind: "platform_unsupported" } });
  });

  it("offers no localStorage or memory fallback when the native store cannot be opened", async () => {
    const h = harness();
    h.createNativeStore.mockRejectedValue(new Error("cannot open"));

    const result = await compose(READY_AUTHORITY, h);
    expect(result).toEqual({ status: "blocked", failure: { kind: "storage_unavailable" } });
    expect("composition" in result).toBe(false);
  });

  it("blocks and closes the store when the credential store WITHHOLDS absence evidence", async () => {
    // The installed-binding case: reads come back with no evidence that nothing
    // is there, so establishment cannot conclude anything and the path closes.
    const h = harness({ credentialsWithholdAbsence: true });
    const result = await compose(READY_AUTHORITY, h);

    expect(result).toEqual({
      status: "blocked",
      failure: { kind: "credential_store_unavailable" },
    });
    expect(h.state.closes).toBe(1);
  });

  it("blocks and closes the store when the SDK session key cannot be derived", async () => {
    const h = harness();
    const result = await compose(READY_AUTHORITY, h, { sessionStorageKey: null });

    expect(result).toEqual({
      status: "blocked",
      failure: { kind: "credential_store_unavailable" },
    });
    expect(h.state.closes).toBe(1);
    // Nothing was read from a fabricated key.
    expect(h.createCredentialStore).not.toHaveBeenCalled();
  });

  it("blocks and closes the store on an ownership conflict, in either slot", async () => {
    const credentialConflict = harness();
    expect(
      await compose(READY_AUTHORITY, credentialConflict, {
        establishCredentialStorage: () => ({ ok: false, reason: "already_claimed" }),
      })
    ).toEqual({ status: "blocked", failure: { kind: "ownership_conflict" } });
    expect(credentialConflict.state.closes).toBe(1);

    resetStorageCompositionForTests();
    const identityConflict = harness();
    expect(
      await compose(READY_AUTHORITY, identityConflict, {
        establishIdentityRepositories: () => ({ ok: false, reason: "runtime_already_constructed" }),
      })
    ).toEqual({ status: "blocked", failure: { kind: "ownership_conflict" } });
    expect(identityConflict.state.closes).toBe(1);
  });

  it("contains a THROWING claim function and releases the store it had opened", async () => {
    // An exceptional claim path is still a claim path: it must not escape as a
    // rejection and must not leave the native handle open.
    for (const slot of ["credentials", "identity"] as const) {
      resetStorageCompositionForTests();
      const h = harness();
      const result = await compose(READY_AUTHORITY, h, {
        establishCredentialStorage:
          slot === "credentials"
            ? () => {
                throw new Error("claim exploded");
              }
            : ALLOW,
        establishIdentityRepositories:
          slot === "identity"
            ? () => {
                throw new Error("claim exploded");
              }
            : ALLOW,
      });

      expect(result, slot).toEqual({
        status: "blocked",
        failure: { kind: slot === "identity" ? "composition_disposed" : "ownership_conflict" },
      });
      expect(h.state.closes, slot).toBe(1);
    }
  });

  it("claims credential-storage ownership BEFORE identity ownership", async () => {
    const h = harness();
    const order: string[] = [];
    await compose(READY_AUTHORITY, h, {
      establishCredentialStorage: () => {
        order.push("credentials");
        return { ok: true };
      },
      establishIdentityRepositories: () => {
        order.push("identity");
        return { ok: true };
      },
    });
    expect(order).toEqual(["credentials", "identity"]);
  });

  it("a FAILED establishment followed by a retry never publishes ready over the standing failure", async () => {
    // Reproduced defect 2B: a failed establishment latched an error, a later
    // successful establish() returned `established` anyway, and composition
    // published ready while the verdict still reported a failure.
    const h = harness();
    let readFails = true;
    h.createCredentialStore.mockImplementation(
      (): SecureCredentialStore => ({
        async read() {
          return readFails
            ? { status: "read_failed", error: { kind: "store_inaccessible" } }
            : { status: "absent" };
        },
        async write() {
          return { ok: true };
        },
        async remove() {
          return { ok: true, outcome: "nothing_to_delete_reported" };
        },
      })
    );

    const first = await compose(READY_AUTHORITY, h);
    expect(first).toEqual({
      status: "blocked",
      failure: { kind: "credential_store_unavailable" },
    });

    // The store recovers. The retry must STILL refuse, because the recorded
    // failure has not been resolved and is not silently erased — and the
    // credential integration is reused, so the latch travels with it.
    readFails = false;
    const second = await compose(READY_AUTHORITY, h);
    expect(second).toEqual({
      status: "blocked",
      failure: { kind: "credential_store_unavailable" },
    });
    // Both attempts released the store they opened.
    expect(h.state.closes).toBe(2);
  });

});

describe("storage composition — a ready composition reaches every seam", () => {
  async function ready() {
    const h = harness();
    const result = await compose(READY_AUTHORITY, h);
    if (result.status !== "ready") throw new Error("expected a ready composition");
    return { h, composition: result.composition };
  }

  it("selects the native store and names the fixed application database", async () => {
    const { h, composition } = await ready();

    expect(composition.selection).toBe("native_sqlite");
    expect(composition.sporting.selection).toBe("native_sqlite");
    expect(h.createNativeStore).toHaveBeenCalledTimes(1);
    expect(NATIVE_APPLICATION_DATABASE_NAME).toBe("curling-sporting-v1");
    expect(NATIVE_APPLICATION_DATABASE_NAME).not.toContain("diagnostics");
  });

  it("routes SEAM 1 — all seven sporting repositories — through the selected adapter", async () => {
    const { h, composition } = await ready();
    const repositories = composition.sporting.createSportingRepositories(PROFILE_A);

    await repositories.session.loadCurrent();
    await repositories.session.loadHistory();
    await repositories.historyFilters.load();
    await repositories.assessment.loadState();
    await repositories.trainingPlans.loadPlans();
    await repositories.accuracyToleranceProfiles.loadState();
    await repositories.smartRandomProfiles.loadState();
    await repositories.assessmentPreferences.getShowIntroduction();
    await repositories.assessmentPreferences.getLastThresholdPreset();
    await repositories.assessmentPreferences.getLastCustomThreshold();

    expect(h.store.gets.length).toBeGreaterThan(0);
    for (const key of h.store.gets) {
      expect(key.startsWith(`curling.sporting.profile.v1.${PROFILE_A}.`)).toBe(true);
    }
    expect(h.store.gets).toContain(
      `curling.sporting.profile.v1.${PROFILE_A}.${CURRENT_SESSION_STORAGE_KEY}`
    );
  });

  it("routes SEAM 2 — the SEPARATE sync-state / outbox adapter — through the same store", async () => {
    const { h, composition } = await ready();
    const adapter = composition.sporting.createSportingSyncStateAdapter(PROFILE_A);

    await adapter.get(CLOUD_SPORTING_SYNC_STORAGE_KEY);
    await adapter.set(CLOUD_SPORTING_SYNC_STORAGE_KEY, '{"schemaVersion":6}');

    const physical = `curling.sporting.profile.v1.${PROFILE_A}.${CLOUD_SPORTING_SYNC_STORAGE_KEY}`;
    expect(h.store.gets).toContain(physical);
    expect(h.store.values.get(physical)).toBe('{"schemaVersion":6}');
  });

  it("routes SEAM 3 — legacy retirement — at the selected store, not blindly at an empty target", async () => {
    const { h, composition } = await ready();

    const outcome = await composition.sporting.retireLegacyUnscopedData();

    expect(outcome).toEqual({ ok: true, status: "retired" });
    expect(h.store.gets).toContain(LEGACY_SPORTING_RETIREMENT_MARKER_KEY);
    expect(h.store.removes).toEqual([...SPORTING_STORAGE_KEYS]);
    expect(h.store.values.get(LEGACY_SPORTING_RETIREMENT_MARKER_KEY)).toBe("complete");

    h.store.removes.length = 0;
    expect(await composition.sporting.retireLegacyUnscopedData()).toEqual({
      ok: true,
      status: "already_retired",
    });
    expect(h.store.removes).toEqual([]);
  });

  it("routes SEAM 4 — all five identity repositories, INCLUDING the dynamic resolution family and intent cleanup", async () => {
    const { h, composition } = await ready();
    const identity = composition.identityRepositories;
    const barrierId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";

    await identity.barriers.load();
    await identity.attempts.load();
    await identity.trusted.load();
    await identity.intents.load();
    await identity.intents.settleIntentBeforeReady();
    await identity.resolutions.loadForBarrier(barrierId);

    expect(h.store.gets).toContain(IDENTITY_BARRIER_STORAGE_KEY);
    expect(h.store.gets).toContain(INTERACTIVE_ATTEMPT_STORAGE_KEY);
    expect(h.store.gets).toContain(TRUSTED_DEVICE_STORAGE_KEY);
    expect(h.store.gets).toContain(PENDING_INTENT_STORAGE_KEY);
    expect(h.store.gets).toContain(INTENT_CLEANUP_STORAGE_KEY);
    expect(h.store.gets).toContain(resolutionStorageKeyFor(barrierId));
  });

  it("keeps the barrier repository unable to remove, even over the native store", async () => {
    const { h, composition } = await ready();

    expect("remove" in composition.identityRepositories.barriers).toBe(false);
    await composition.identityRepositories.barriers.load();
    expect(h.store.removes).toEqual([]);
  });

  it("exposes the credential store's verdict, so a later failure cannot vanish", async () => {
    const { h, composition } = await ready();
    expect(composition.credentialFailure()).toBeNull();

    const credentials = composition.credentials;
    expect(credentials).not.toBeNull();

    const store = h.createCredentialStore.mock.results[0]?.value as {
      remove: (key: string) => Promise<unknown>;
    };
    store.remove = async () => ({ ok: false, error: { kind: "store_inaccessible" } });
    await expect(credentials?.storage.removeItem("sb-x-auth-token")).rejects.toThrow();

    expect(composition.credentialFailure()).toEqual({ kind: "removal_failed" });
  });
});

describe("storage composition — ONE ownership lifecycle, proven with the REAL claim functions", () => {
  it("shares ONE in-flight attempt between concurrent callers", async () => {
    // Reproduced defect 3A: two concurrent calls created two handles, one ready
    // and one ownership_conflict, because only a COMPLETED composition was
    // cached and there was no shared in-flight owner.
    const h = harness();
    const [first, second] = await Promise.all([
      realClaims(h, READY_AUTHORITY),
      realClaims(h, READY_AUTHORITY),
    ]);

    expect(first.status).toBe("ready");
    expect(second).toBe(first);
    // ONE store opened, ONE set of claims.
    expect(h.createNativeStore).toHaveBeenCalledTimes(1);
    expect(h.state.closes).toBe(0);
    expect(storageCompositionPhase()).toBe("ready");
  });

  it("returns the same composition to a later caller, with the real claims already bound", async () => {
    const h = harness();
    const first = await realClaims(h, READY_AUTHORITY);
    const second = await realClaims(h, READY_AUTHORITY);

    expect(first.status).toBe("ready");
    expect(second).toBe(first);
    expect(h.createNativeStore).toHaveBeenCalledTimes(1);
  });

  it("DISPOSAL IS TERMINAL: re-entry reports it instead of conflicting with the retained claims", async () => {
    // Reproduced defect 3B: compose → dispose → compose returned
    // `ownership_conflict`, because disposal cleared the cached composition but
    // left the identity claim bound to the old repository set, so the next
    // attempt presented a different one. Terminal disposal states that outcome
    // instead of stumbling into it.
    const h = harness();
    const first = await realClaims(h, READY_AUTHORITY);
    if (first.status !== "ready") throw new Error("expected ready");

    await first.composition.dispose();
    expect(storageCompositionPhase()).toBe("disposed");
    expect(h.state.closes).toBe(1);

    const second = await realClaims(h, READY_AUTHORITY);
    expect(second).toEqual({
      status: "blocked",
      failure: { kind: "composition_disposed" },
    });
    // And no second store was opened behind a usable-looking cached owner.
    expect(h.createNativeStore).toHaveBeenCalledTimes(1);
  });

  it("disposal is idempotent and closes the store exactly once", async () => {
    const h = harness();
    const first = await realClaims(h, READY_AUTHORITY);
    if (first.status !== "ready") throw new Error("expected ready");

    await first.composition.dispose();
    await first.composition.dispose();
    expect(h.state.closes).toBe(1);
  });

  it("a PRE-CLAIM block leaves the document free, so a retry starts genuinely fresh", async () => {
    // The only retry path reachable in this stage: the activation authority
    // blocks before any claim is made.
    const h = harness();
    expect(await realClaims(h, UNAVAILABLE_AUTHORITY)).toEqual({
      status: "blocked",
      failure: { kind: "migration_authority_unavailable" },
    });
    expect(storageCompositionPhase()).toBe("unstarted");

    const retried = await realClaims(h, UNAVAILABLE_AUTHORITY);
    expect(retried.status).toBe("blocked");
    expect(h.createNativeStore).not.toHaveBeenCalled();
  });

  it("a retry after a partial claim presents the SAME credential integration, so the real claim stays idempotent", async () => {
    // Attempt 1 claims credential storage with the REAL slot, then blocks on the
    // identity slot. Attempt 2 must present the same credential object, or the
    // real slot would refuse it as `already_claimed`.
    const h = harness();
    let allowIdentity = false;
    const presented: unknown[] = [];

    const options = () => ({
      activationAuthority: READY_AUTHORITY,
      sessionStorageKey: SESSION_KEY,
      detectPlatform: () => "ios" as const,
      createNativeStore: h.createNativeStore,
      createCredentialStore: h.createCredentialStore,
      establishCredentialStorage: (credentials: {
        storage: Parameters<typeof claimBrowserAuthStorage>[0];
        observedFailure: () => unknown;
      }) => {
        presented.push(credentials.storage);
        return claimBrowserAuthStorage(credentials.storage, () => null);
      },
      establishIdentityRepositories: (repositories: Parameters<
        typeof claimIdentityRepositories
      >[0]) =>
        allowIdentity
          ? claimIdentityRepositories(repositories)
          : ({ ok: false, reason: "already_claimed" } as const),
    });

    const first = await composeNativeStorage(options());
    expect(first).toEqual({ status: "blocked", failure: { kind: "ownership_conflict" } });

    allowIdentity = true;
    const second = await composeNativeStorage(options());
    expect(second.status).toBe("ready");

    expect(presented).toHaveLength(2);
    // The SAME storage object, which is what makes the REAL claim idempotent.
    expect(presented[1]).toBe(presented[0]);
  });

  it("REFUSES a call carrying a different activation authority rather than returning an unrelated composition", async () => {
    const h = harness();
    const first = await realClaims(h, READY_AUTHORITY);
    expect(first.status).toBe("ready");

    const conflicting = await composeNativeStorage({
      activationAuthority: BLOCKED_AUTHORITY,
      sessionStorageKey: SESSION_KEY,
      detectPlatform: () => "ios",
      createNativeStore: h.createNativeStore,
      createCredentialStore: h.createCredentialStore,
      establishCredentialStorage: ALLOW,
      establishIdentityRepositories: ALLOW,
    });

    expect(conflicting).toEqual({
      status: "blocked",
      failure: { kind: "ownership_conflict" },
    });
  });
});

describe("storage composition — Profile namespaces are immutable", () => {
  it("a delayed write started for Profile A keeps A's physical key after switching to B", async () => {
    const h = harness();
    const result = await compose(READY_AUTHORITY, h);
    if (result.status !== "ready") throw new Error("expected a ready composition");

    const a = result.composition.sporting.createSportingSyncStateAdapter(PROFILE_A);
    const b = result.composition.sporting.createSportingSyncStateAdapter(PROFILE_B);
    await b.set(CLOUD_SPORTING_SYNC_STORAGE_KEY, "B");
    await a.set(CLOUD_SPORTING_SYNC_STORAGE_KEY, "A");

    expect(
      h.store.values.get(
        `curling.sporting.profile.v1.${PROFILE_A}.${CLOUD_SPORTING_SYNC_STORAGE_KEY}`
      )
    ).toBe("A");
    expect(
      h.store.values.get(
        `curling.sporting.profile.v1.${PROFILE_B}.${CLOUD_SPORTING_SYNC_STORAGE_KEY}`
      )
    ).toBe("B");
  });

  it("the same holds for a repository closure across the switch", async () => {
    const h = harness();
    const result = await compose(READY_AUTHORITY, h);
    if (result.status !== "ready") throw new Error("expected a ready composition");

    const aRepositories = result.composition.sporting.createSportingRepositories(PROFILE_A);
    result.composition.sporting.createSportingRepositories(PROFILE_B);

    h.store.gets.length = 0;
    await aRepositories.session.loadCurrent();

    for (const key of h.store.gets) {
      expect(key).toContain(PROFILE_A);
      expect(key).not.toContain(PROFILE_B);
    }
  });
});

describe("storage composition — the Web default is unchanged", () => {
  it("the Web seams are the localStorage adapter, not a composed one", () => {
    expect(WEB_DEFAULT_SPORTING_SEAMS.selection).toBe("web_local");
    expect(WEB_DEFAULT_STORAGE_ADAPTER).toBe(localStorageAdapter);
  });

  it("the Web seams build Profile-scoped repositories over localStorage", () => {
    const repositories = WEB_DEFAULT_SPORTING_SEAMS.createSportingRepositories(PROFILE_A);
    expect(typeof repositories.session.loadCurrent).toBe("function");
    const adapter = WEB_DEFAULT_SPORTING_SEAMS.createSportingSyncStateAdapter(PROFILE_A);
    expect(typeof adapter.get).toBe("function");
  });
});

describe("S-P3 exceptional composition resource ownership", () => {
  it.each([undefined, null, Symbol("synthetic"), { get message() { throw null; } }])("contains a credential factory throw without poisoning retry (%#)", async reason => {
    const h = harness();
    h.createCredentialStore.mockImplementationOnce(() => { throw reason; });
    const claim = vi.fn(ALLOW);
    expect(await compose(READY_AUTHORITY, h, { establishCredentialStorage: claim })).toEqual({ status: "blocked", failure: { kind: "credential_store_unavailable" } });
    expect(h.state.closes).toBe(1);
    expect(claim).not.toHaveBeenCalled();
    expect(storageCompositionPhase()).toBe("unstarted");
    const retry = await compose(READY_AUTHORITY, h);
    expect(retry.status).toBe("ready");
    expect(h.createNativeStore).toHaveBeenCalledTimes(2);
    if (retry.status === "ready") await retry.composition.dispose();
    expect(h.state.closes).toBe(2);
  });

  it("keeps the same in-flight owner until failed-start cleanup actually answers", async () => {
    const h = harness();
    let release!: () => void;
    const close = vi.fn(() => new Promise<{ok:true}>(resolve => { release = () => resolve({ok:true}); }));
    h.createNativeStore.mockResolvedValue({ adapter: h.store.adapter, close });
    h.createCredentialStore.mockImplementationOnce(() => { throw null; });
    const first = compose(READY_AUTHORITY, h);
    await vi.waitFor(() => expect(close).toHaveBeenCalledOnce());
    expect(compose(READY_AUTHORITY, h)).toBe(first);
    expect(storageCompositionPhase()).toBe("in_flight");
    expect(h.createNativeStore).toHaveBeenCalledOnce();
    release();
    expect((await first).status).toBe("blocked");
    expect(storageCompositionPhase()).toBe("unstarted");
    h.createNativeStore.mockResolvedValue({ adapter: h.store.adapter, close: async () => ({ok:true}) });
    expect((await compose(READY_AUTHORITY, h)).status).toBe("ready");
  });

  it.each([
    { boundary: "factory", reported: false }, { boundary: "claim", reported: false },
    { boundary: "factory", reported: true }, { boundary: "claim", reported: true },
  ])("failed close after $boundary (reported=$reported) forbids another handle", async ({ boundary, reported }) => {
    const h = harness();
    const close = vi.fn(async () => { if (reported) return { ok: false as const }; throw null; });
    h.createNativeStore.mockResolvedValue({ adapter: h.store.adapter, close });
    if (boundary === "factory") h.createCredentialStore.mockImplementationOnce(() => { throw null; });
    const overrides = boundary === "claim" ? { establishCredentialStorage: () => ({ ok: false as const, reason: "synthetic" }) } : {};
    expect(await compose(READY_AUTHORITY, h, overrides)).toEqual({ status: "blocked", failure: { kind: "storage_release_unconfirmed" } });
    expect(storageCompositionPhase()).toBe("disposed");
    expect(await compose(READY_AUTHORITY, h)).toEqual({ status: "blocked", failure: { kind: "storage_release_unconfirmed" } });
    expect(h.createNativeStore).toHaveBeenCalledOnce();
    expect(close).toHaveBeenCalledOnce();
  });

  it("joins disposal and keeps a failed release terminal", async () => {
    const h = harness();
    let rejectClose!: () => void;
    const close = vi.fn(() => new Promise<{ok:true}>((_resolve, reject) => { rejectClose = () => reject(null); }));
    h.createNativeStore.mockResolvedValue({ adapter: h.store.adapter, close });
    const state = await compose(READY_AUTHORITY, h);
    if (state.status !== "ready") throw Error("fixture not ready");
    const first = state.composition.dispose();
    expect(state.composition.dispose()).toBe(first);
    expect(await compose(READY_AUTHORITY, h)).toEqual({ status: "blocked", failure: { kind: "composition_disposed" } });
    rejectClose();
    await first;
    expect(await compose(READY_AUTHORITY, h)).toEqual({ status: "blocked", failure: { kind: "storage_release_unconfirmed" } });
    expect(close).toHaveBeenCalledOnce();
    expect(h.createNativeStore).toHaveBeenCalledOnce();
  });

  it("contains an unexpected post-acquisition throw and still closes exactly once", async () => {
    const h = harness(); let reads = 0;
    const close = vi.fn(async () => ({ok:true as const}));
    h.createNativeStore.mockResolvedValue({ get adapter() { if (++reads > 1) throw null; return h.store.adapter; }, close });
    expect(await compose(READY_AUTHORITY, h)).toEqual({ status: "blocked", failure: { kind: "composition_disposed" } });
    expect(close).toHaveBeenCalledOnce();
    expect(storageCompositionPhase()).toBe("disposed");
  });

  it("an older document attempt cannot publish over the current owner", async () => {
    const old = harness(); let release!: () => void;
    old.createCredentialStore.mockImplementation(() => ({ read: () => new Promise(resolve => { release = () => resolve({ status: "absent" }); }), write: async () => ({ ok: true }), remove: async () => ({ ok: true, outcome: "nothing_to_delete_reported" }) }));
    const abandoned = compose(READY_AUTHORITY, old);
    await vi.waitFor(() => expect(release).toBeTypeOf("function"));
    resetStorageCompositionForTests();
    const current = harness(); const ready = await compose(READY_AUTHORITY, current);
    release();
    expect(await abandoned).toEqual({ status: "blocked", failure: { kind: "composition_disposed" } });
    expect(old.state.closes).toBe(1);
    expect(await compose(READY_AUTHORITY, current)).toBe(ready);
    expect(current.state.closes).toBe(0);
    if (ready.status === "ready") await ready.composition.dispose();
  });
});
