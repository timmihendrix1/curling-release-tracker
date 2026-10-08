// The one owned storage composition — Stage M3b3
// (docs/MOBILE_APP_MIGRATION.md Stage M3b0 §3 and §7, ADR-0049 decisions 3-6).
//
// ## What this module is
//
// A single explicit boundary that, for one document lifetime, decides and then
// OWNS:
//
//   - the selected application storage adapter;
//   - the five identity repositories, constructed over that adapter;
//   - the provider credential storage integration;
//   - a readiness / failure verdict everything else waits on.
//
// Ownership is established before any application consumer starts, and it is not
// changed afterwards. A late attempt to configure it differently is REJECTED
// rather than applied: identity repositories, the Supabase client and React
// effects all capture what they were given, so a second answer would not
// retroactively move the first consumer's data — it would split it.
//
// ## What this module is NOT, in this stage
//
// **It is not a cutover, and it cannot become one.** `composeNativeStorage`
// consults a `NativeActivationAuthority` FIRST, before an adapter is
// constructed, a database is opened or the Keychain is touched. The production
// authority reports `unavailable` unconditionally, because the migration that
// would make a native target authoritative does not exist yet (Stage M3b4) and
// production cutover is a separate named stage (M3b5).
//
// That ordering is the whole safety property. Mounting the ordinary application
// against a fresh, empty native store would run an existing installation's
// normal hydration against nothing — every domain would read `absent`, write its
// documented default, and the result would be an apparently clean workspace over
// data that still exists. The design names this exact failure (Stage M3b0 §5's
// withdrawn rule W2), and the authority-first check is what forecloses it.
//
// There is deliberately **no** force-ready switch, no synthetic activation
// record, no "fresh install" assumption and no test-profile bypass in anything
// that ships. A ready native composition is reachable only by injecting an
// authority, which production never does — asserted by
// `__tests__/architectureBoundary.test.ts`.
//
// ## Failure direction
//
// Every failure blocks. Nothing here falls back to `localStorage`, to memory, or
// to "assume empty". After native selection fails there is no second store to
// try: a fallback would be a silent second authority for the same datum, which
// ADR-0049 rejects outright.
import { createIdentityRepositorySet, type IdentityRepositorySet } from "../identity/identityRepositorySet";
import { detectRuntimePlatform, type RuntimePlatform } from "../platform/runtimePlatform";
import {
  createProviderCredentialStorage,
  type CredentialStorageFailure,
  type ProviderCredentialStorageIntegration,
} from "../supabase/providerCredentialStorage";
import { createNativeSecureCredentialStore, type SecureCredentialStore } from "./secureCredentialStore";
import {
  createSportingStorageSeams,
  type SportingStorageSeams,
  type StorageSelection,
} from "./storageSeams";
import type { RemovableStorageAdapter } from "./types";

export type { StorageSelection };

/**
 * The verdict the future migration/activation authority supplies.
 *
 * `ready` means: a Group-A-valid activation record exists, its `phase` is
 * `active`, and the target is healthy — Stage M3b0 §5.4 row B4, the ONLY state
 * that permits mounting ordinary consumers. Nothing weaker qualifies, and
 * `blocked` is not a transient condition to retry past: it is the design's
 * fail-closed state and it renders a recovery surface and nothing else.
 */
export type NativeActivationVerdict =
  | { status: "ready" }
  | { status: "unavailable"; reason: "migration_not_implemented" }
  | { status: "blocked" };

/**
 * Consulted before anything is constructed.
 *
 * It takes no adapter on purpose. The M3b4 authority will own its own connection
 * to the target — it has to, because reading and validating the activation
 * record IS its job — and handing it an adapter here would mean opening the
 * store before anyone had established that mounting against it is safe.
 */
export interface NativeActivationAuthority {
  verdict(): Promise<NativeActivationVerdict>;
}

/**
 * Why a composition is not ready. Fixed categories, no platform text.
 *
 * `migration_authority_unavailable` is the expected state for every build in
 * this stage. It is not an error in the installation; it is the honest report
 * that the production native path is still closed.
 */
export type StorageCompositionFailure =
  | { kind: "platform_unsupported" }
  | { kind: "storage_unavailable" }
  | { kind: "credential_store_unavailable" }
  | { kind: "migration_authority_unavailable" }
  | { kind: "migration_blocked" }
  | { kind: "ownership_conflict" }
  /** The document's composition was disposed. Disposal is TERMINAL — see the
   * ownership model below — so this is not retryable within this document. */
  | { kind: "composition_disposed" };

/** What a ready composition hands to the application. */
export interface OwnedStorageComposition {
  readonly selection: StorageSelection;
  readonly adapter: RemovableStorageAdapter;
  readonly identityRepositories: IdentityRepositorySet;
  /** `null` only where the SDK keeps its own default storage (the Web). */
  readonly credentials: ProviderCredentialStorageIntegration | null;
  readonly sporting: SportingStorageSeams;
  /**
   * The credential store's sticky, normalised verdict, or `null`.
   *
   * **Why this is exposed and why nothing acts on it yet.** Composition already
   * refuses to become ready over an unusable credential store, so a mounted tree
   * cannot start from a broken one. What this accessor adds is visibility of a
   * failure that happens LATER — a refresh or a removal that the SDK would
   * otherwise absorb into a clean-looking result (see
   * `providerCredentialStorage.ts`).
   *
   * **What a mounted application should DO about a mid-session credential
   * failure is a product decision, and this stage does not settle it.** Blocking
   * the whole workspace on a sticky historical latch would be heavy-handed;
   * ignoring it would be dishonest. The decision belongs to the cutover stage
   * (M3b5), and until then the value's readers are the tests that prove the
   * failure does not vanish. It is never a substitute for the access barrier:
   * a credential — present, absent or unreadable — grants nothing.
   */
  credentialFailure(): CredentialStorageFailure | null;
  /** Releases what this composition owns. Idempotent. A disposed composition is
   * never re-published: the caller checks identity before mounting. */
  dispose(): Promise<void>;
}

export type StorageCompositionState =
  | { status: "ready"; composition: OwnedStorageComposition }
  | { status: "blocked"; failure: StorageCompositionFailure };

/** Result of claiming a module-level ownership slot (the Supabase auth storage,
 * the identity repositories). Shared shape so the composition can treat both
 * uniformly. */
export type OwnershipClaimResult = { ok: true } | { ok: false; reason: string };

/**
 * A native store, as this module needs it: the persistence contract plus the
 * lifecycle handle whose ownership the composition takes over.
 */
export interface NativeStoreHandle {
  readonly adapter: RemovableStorageAdapter;
  close(): Promise<unknown>;
}

export type NativeStorageCompositionOptions = {
  /** The gate on mounting. Production supplies the unavailable authority. */
  activationAuthority: NativeActivationAuthority;
  /**
   * The SDK session key establishment reads, so it reads a key the SDK will
   * actually use. `null` fails closed rather than reading a fabricated key.
   */
  sessionStorageKey: string | null;
  /** Claims the SDK credential-storage ownership slot. */
  establishCredentialStorage(storage: ProviderCredentialStorageIntegration): OwnershipClaimResult;
  /** Claims the identity-repository ownership slot. */
  establishIdentityRepositories(set: IdentityRepositorySet): OwnershipClaimResult;
  /** Test seam for the trusted platform signal (ADR-0047). */
  detectPlatform?: () => RuntimePlatform;
  /** Test seam. Production omits it and the real native adapter is loaded
   * lazily, so no bundle that never composes a native store ships SQLite. */
  createNativeStore?: (platform: "ios" | "android") => Promise<NativeStoreHandle>;
  /** Test seam. Production omits it and the real protected store is used. */
  createCredentialStore?: (platform: "ios" | "android") => SecureCredentialStore;
};

/**
 * The application database. A fixed constant, never derived from configuration,
 * a Profile or user input — and deliberately NOT the diagnostics panel's
 * `curling-storage-diagnostics-synthetic` database, which must stay unreachable
 * from here.
 */
export const NATIVE_APPLICATION_DATABASE_NAME = "curling-sporting-v1";

/**
 * Loads the native adapter. Behind a dynamic import for the same reason the
 * adapter's own plugin binding is: merely importing this module — which the
 * type-checker and the Next/Web build both do — must not pull SQLite, and a
 * bundle that never composes a native store must contain no SQLite
 * implementation at all.
 */
async function loadNativeStore(): Promise<NativeStoreHandle> {
  const adapterModule = await import("./nativeSqliteAdapter");
  const store = adapterModule.createNativeSqliteStore({
    databaseName: NATIVE_APPLICATION_DATABASE_NAME,
  });
  return { adapter: store.adapter, close: () => store.close() };
}

function blocked(failure: StorageCompositionFailure): StorageCompositionState {
  return { status: "blocked", failure };
}

/**
 * ============================================================================
 * THE DOCUMENT-LIFETIME OWNERSHIP MODEL
 * ============================================================================
 *
 * One composition per document, in exactly one of four phases:
 *
 *   1. **unstarted** — no attempt has run. A fresh attempt may begin.
 *   2. **in_flight** — an attempt is running. Every concurrent caller joins
 *      THAT attempt; none starts a second one. Without this, two callers
 *      genuinely race: both open a native store, both claim ownership, and the
 *      loser gets an `ownership_conflict` caused by nothing but the concurrency.
 *   3. **ready** — an attempt succeeded and its claims are bound. Every later
 *      call returns that same composition, because the claims are permanent and
 *      a second attempt could only ever conflict with itself.
 *   4. **disposed — TERMINAL.** Ownership is deliberately terminal rather than
 *      re-entrant, for a concrete reason: the identity repository set is closed
 *      over the adapter instance it was built on, and the ownership slot holds
 *      that set permanently. Once the store is closed there is no way to hand a
 *      later attempt a set that is both the claimed one AND backed by an open
 *      store. Re-entry would have to either present a different set to the
 *      claimed slot (refused) or return a claimed owner backed by closed
 *      resources — a usable-looking corpse. So a disposed document reports
 *      `composition_disposed`, and recovery is a new document.
 *
 * A **blocked** attempt returns the document to `unstarted`, because nothing was
 * claimed and nothing was opened, so a retry is genuinely free. That is the only
 * retry path reachable in this stage, since the activation authority blocks
 * before any claim is made.
 *
 * **Conflicting late configuration is refused, not silently satisfied.** A call
 * carrying a different activation authority from the one the cached or in-flight
 * composition was built with cannot honestly be answered with that composition,
 * so it reports `ownership_conflict` rather than quietly returning an unrelated
 * owner.
 *
 * The credential integration is created once per document and reused, so an
 * attempt that claimed credential storage and then blocked leaves the next
 * attempt presenting the SAME object to that already-claimed slot — which is
 * what makes the claim idempotent instead of self-conflicting.
 */
type CompositionOwnership =
  | { phase: "unstarted" }
  | {
      phase: "in_flight";
      authority: NativeActivationAuthority;
      attempt: Promise<StorageCompositionState>;
    }
  | {
      phase: "ready";
      authority: NativeActivationAuthority;
      state: StorageCompositionState;
    }
  | { phase: "disposed" };

let ownership: CompositionOwnership = { phase: "unstarted" };
let credentialIntegration: ProviderCredentialStorageIntegration | null = null;

/** Test-only: forces the next composition to start from a clean document, which
 * is how a test simulates a genuinely new page load. Production never calls it. */
export function resetStorageCompositionForTests(): void {
  ownership = { phase: "unstarted" };
  credentialIntegration = null;
}

/** The document's current ownership phase. Exported for assertions; production
 * code never branches on it. */
export function storageCompositionPhase(): CompositionOwnership["phase"] {
  return ownership.phase;
}

export function composeNativeStorage(
  options: NativeStorageCompositionOptions
): Promise<StorageCompositionState> {
  if (ownership.phase === "disposed") {
    return Promise.resolve(blocked({ kind: "composition_disposed" }));
  }
  if (ownership.phase === "ready" || ownership.phase === "in_flight") {
    // Conflicting configuration is refused rather than answered with an
    // unrelated owner.
    if (ownership.authority !== options.activationAuthority) {
      return Promise.resolve(blocked({ kind: "ownership_conflict" }));
    }
    // Ready: the document's one answer. In flight: JOIN it — no second store,
    // no second claim, no self-inflicted ownership conflict.
    return ownership.phase === "ready"
      ? Promise.resolve(ownership.state)
      : ownership.attempt;
  }

  const attempt = performComposition(options).then((state) => {
    if (state.status === "ready") {
      ownership = { phase: "ready", authority: options.activationAuthority, state };
    } else if (ownership.phase === "in_flight") {
      // Nothing was claimed and nothing was opened, so the document is free
      // again and a retry may start genuinely fresh.
      ownership = { phase: "unstarted" };
    }
    return state;
  });
  ownership = { phase: "in_flight", authority: options.activationAuthority, attempt };
  return attempt;
}

async function performComposition(
  options: NativeStorageCompositionOptions
): Promise<StorageCompositionState> {
  const detectPlatform = options.detectPlatform ?? detectRuntimePlatform;

  let platform: RuntimePlatform;
  try {
    platform = detectPlatform();
  } catch {
    // A platform signal that throws must not be able to decide we are on the
    // Web, whose adapter is exactly what this composition exists to replace.
    platform = "unsupported_native";
  }
  if (platform !== "ios" && platform !== "android") {
    return blocked({ kind: "platform_unsupported" });
  }

  let verdict: NativeActivationVerdict;
  try {
    verdict = await options.activationAuthority.verdict();
  } catch {
    // An authority that throws has not established `active`, and only a
    // validated `active` may mount.
    return blocked({ kind: "migration_authority_unavailable" });
  }
  if (verdict.status === "unavailable") {
    return blocked({ kind: "migration_authority_unavailable" });
  }
  if (verdict.status !== "ready") {
    return blocked({ kind: "migration_blocked" });
  }

  let store: NativeStoreHandle;
  try {
    store = await (options.createNativeStore
      ? options.createNativeStore(platform)
      : loadNativeStore());
  } catch {
    return blocked({ kind: "storage_unavailable" });
  }

  async function closeStore(): Promise<void> {
    try {
      await store.close();
    } catch {
      /* the reportable outcome is the failure that prompted the close */
    }
  }

  // Establishment reads the SDK's own session key, so a key it cannot name is a
  // fail-closed condition rather than an invitation to read something else.
  if (options.sessionStorageKey === null) {
    await closeStore();
    return blocked({ kind: "credential_store_unavailable" });
  }

  // Reused across attempts, so a retry re-claims the SAME object rather than
  // presenting a competing one to an already-claimed slot.
  if (credentialIntegration === null) {
    const credentialStore = options.createCredentialStore
      ? options.createCredentialStore(platform)
      : createNativeSecureCredentialStore();
    credentialIntegration = createProviderCredentialStorage(credentialStore, {
      sessionStorageKey: options.sessionStorageKey,
    });
  }
  const credentials = credentialIntegration;

  let establishment: Awaited<ReturnType<typeof credentials.establish>>;
  try {
    establishment = await credentials.establish();
  } catch {
    await closeStore();
    return blocked({ kind: "credential_store_unavailable" });
  }
  if (establishment.status !== "established") {
    // A locked or otherwise unusable credential store is NOT a signed-out user
    // and is NOT a reason to keep tokens in WebView storage instead. It blocks.
    await closeStore();
    return blocked({ kind: "credential_store_unavailable" });
  }

  // Ownership is claimed BEFORE the composition is published, and the
  // credential-storage claim comes first because the Supabase client reads
  // storage from its own constructor — a client that already exists cannot be
  // given a different store afterwards.
  //
  // Both claims are CONTAINED: a claim function that throws must not leave the
  // store open and must not escape as a rejection, because an exceptional claim
  // path is still a claim path.
  let identityRepositories: IdentityRepositorySet;
  try {
    const credentialClaim = options.establishCredentialStorage(credentials);
    if (!credentialClaim.ok) {
      await closeStore();
      return blocked({ kind: "ownership_conflict" });
    }

    identityRepositories = createIdentityRepositorySet(store.adapter);
    const identityClaim = options.establishIdentityRepositories(identityRepositories);
    if (!identityClaim.ok) {
      await closeStore();
      return blocked({ kind: "ownership_conflict" });
    }
  } catch {
    await closeStore();
    return blocked({ kind: "ownership_conflict" });
  }

  // LAST GATE before publishing readiness: a failure recorded at any point
  // above — including one the SDK would later absorb — must not become normal
  // readiness. `establish()` refuses to report `established` over an unresolved
  // latch, and this re-check covers anything recorded after it returned.
  const outstanding = credentials.observedFailure();
  if (outstanding !== null) {
    await closeStore();
    return blocked({ kind: "credential_store_unavailable" });
  }

  let disposed = false;
  const composition: OwnedStorageComposition = {
    selection: "native_sqlite",
    adapter: store.adapter,
    identityRepositories,
    credentials,
    sporting: createSportingStorageSeams("native_sqlite", store.adapter),
    credentialFailure: () => credentials.observedFailure(),
    async dispose(): Promise<void> {
      if (disposed) return;
      disposed = true;
      // Disposal is TERMINAL for the document (see the ownership model). The
      // phase is only advanced if this composition is still the owner — an
      // older composition's late disposal must not terminate a document that
      // has since been reset for a test.
      if (ownership.phase === "ready" && ownership.state.status === "ready" && ownership.state.composition === composition) {
        ownership = { phase: "disposed" };
      }
      await closeStore();
    },
  };
  return { status: "ready", composition };
}
