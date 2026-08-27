// Shared test harness for the Stage B0.2c identity domain.
//
// Two rules shape it, both from CLAUDE.md's Timing Simulator precedent (ADR-0006):
//
//  1. **A stand-in implements the real contract, never a shortcut.** The callback
//     capture cell here is the REAL `createCallbackCaptureCell` behind a fake
//     window seam, not a hand-rolled imitation — so a test that proves "capture,
//     classify and clean all happen before the first durable read" is proving it
//     about the code that ships. Likewise the storage fake implements
//     `RemovableStorageAdapter` exactly, including its never-throw contract, and
//     the identity service fake is the shipped `fakeIdentityService`.
//  2. **Everything is deterministic.** Injected clock, injected canonical-UUID
//     source, no real timers, and one shared ordered call log so "the barrier was
//     written BEFORE any provider call" is a measured sequence rather than an
//     inference from counters.
//
// No test in this directory prints or snapshots an authorization code, a selector,
// an `Authorization` value or a token. The fixtures below are obviously synthetic.

import {
  authFailed,
  authOk,
  normalizedAuthError,
  type AccountIdentity,
  type AuthProviderMechanics,
  type AuthServiceResult,
  type ExchangeOutcome,
  type NavigationOutcome,
  type NormalizedAuthChange,
  type NormalizedAuthErrorKind,
  type PrepareAuthorizationOutcome,
  type SessionRestoreOutcome,
} from "../../../supabase/authService";
import {
  createCallbackCaptureCell,
  type CallbackCaptureCell,
  type CallbackUrlAccess,
} from "../../../supabase/supabaseCallbackCapture";
import type {
  PersistenceRemoveResult,
  PersistenceWriteResult,
  RemovableStorageAdapter,
  StorageGetResult,
} from "../../../persistence/types";
import { createIdentityBarrierRepository } from "../../identityBarrierRepository";
import { createIdentityBarrierResolutionRepository } from "../../identityBarrierResolutionRepository";
import { createInteractiveAttemptRepository } from "../../interactiveAttemptRepository";
import { createPendingIntentRepository } from "../../pendingIntentRepository";
import { createTrustedDeviceRepository } from "../../trustedDeviceRepository";
import {
  createIdentityTransitionCoordinator,
  createLiveGenerationCounter,
  type IdentityTransitionCoordinator,
  type LiveGenerationCounter,
} from "../../identityTransitionCoordinator";
import {
  createFakeIdentityBackend,
  createFakeIdentityService,
  type FakeIdentityBackend,
  type FakeLegalRow,
} from "../../fakeIdentityService";
import type { IdentityService, PinnedLegalEvidence } from "../../identityService";
import type {
  GateProgressPhase,
  GateState,
  GateStateView,
  TransitionIdentity,
} from "../../gateState";
import { IDENTITY_BARRIER_STORAGE_KEY } from "../../identityBarrier";
import { INTERACTIVE_ATTEMPT_STORAGE_KEY } from "../../interactiveAttempt";
import { resolutionStorageKeyFor } from "../../identityBarrierResolution";
import { TRUSTED_DEVICE_STORAGE_KEY } from "../../trustedDevice";
import {
  INTENT_CLEANUP_STORAGE_KEY,
  PENDING_INTENT_STORAGE_KEY,
} from "../../pendingIntentRepository";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

export const APP_ORIGIN = "https://app.example.test";
export const REDIRECT_TARGET = `${APP_ORIGIN}/`;

/** Canonical UUIDs (lower-case, hyphenated, version 4, RFC-4122 variant) — the
 * only shape the record validators accept. */
export const BARRIER_A = "11111111-1111-4111-8111-111111111111";
export const BARRIER_B = "22222222-2222-4222-8222-222222222222";
export const BARRIER_C = "33333333-3333-4333-8333-333333333333";
export const ATTEMPT_A = "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa";
export const ATTEMPT_B = "bbbbbbbb-2222-4222-8222-bbbbbbbbbbbb";
export const PROFILE_A = "cccccccc-1111-4111-8111-cccccccccccc";
export const TERMS_DOC_V1 = "dddddddd-1111-4111-8111-dddddddddddd";
export const TERMS_DOC_V2 = "dddddddd-2222-4222-8222-dddddddddddd";
export const PRIVACY_DOC_V1 = "eeeeeeee-1111-4111-8111-eeeeeeeeeeee";
export const PRIVACY_DOC_V2 = "eeeeeeee-2222-4222-8222-eeeeeeeeeeee";
export const ADMIN_REQUEST_ID = "ffffffff-1111-4111-8111-ffffffffffff";

/** Flow selectors matching the classifier's accepted shape
 * (`/^[a-zA-Z0-9_-]{8,64}$/`). Non-secret, but never printed by any assertion. */
export const FLOW_X = "flow-selector-x-0000000000000000";
export const FLOW_Y = "flow-selector-y-1111111111111111";

export const IDENTITY_A: AccountIdentity = { accountScopeId: "account-a", email: "a@example.test" };
export const IDENTITY_B: AccountIdentity = { accountScopeId: "account-b", email: "b@example.test" };

export const FIXED_NOW = "2026-03-01T10:00:00.000Z";

export function legalRow(
  kind: "terms_of_service" | "privacy_notice",
  id: string,
  versionLabel: string
): FakeLegalRow {
  return {
    id,
    kind,
    version_label: versionLabel,
    document_url: `https://example.invalid/legal/${kind}-${versionLabel}`,
    effective_at: "2026-01-01T00:00:00.000Z",
  };
}

/**
 * The pinned evidence a COMPLETED onboarding necessarily carries.
 *
 * `complete_personal_onboarding()` establishes the completion row and both
 * evidence rows in one transaction (ADR-0025 §16), so completion and evidence
 * exist together or not at all. Both the Supabase mapper and the coordinator's own
 * snapshot boundary reject a response claiming a completed Profile with no pinned
 * evidence — so a fixture that omitted these would be exercising a response the
 * server cannot produce, and would prove nothing about the completed path.
 */
export const PINNED_TERMS: PinnedLegalEvidence = {
  acceptanceId: "0a0a0a0a-1111-4111-8111-0a0a0a0a0a0a",
  documentId: TERMS_DOC_V1,
  versionLabel: "v1",
  actedAt: "2026-02-01T09:00:00.000Z",
};

export const PINNED_PRIVACY: PinnedLegalEvidence = {
  acceptanceId: "0b0b0b0b-1111-4111-8111-0b0b0b0b0b0b",
  documentId: PRIVACY_DOC_V1,
  versionLabel: "v1",
  actedAt: "2026-02-01T09:00:00.000Z",
};

export const COMPLETE_LEGAL_ROWS: FakeLegalRow[] = [
  legalRow("terms_of_service", TERMS_DOC_V1, "v1"),
  legalRow("privacy_notice", PRIVACY_DOC_V1, "v1"),
];

/** Builds a callback URL carrying the owned query fields. Deliberately assembled
 * from parts so no test hard-codes a full provider URL. */
export function callbackUrl(params: {
  code?: string;
  flowId?: string;
  error?: string;
  errorDescription?: string;
  errorCode?: string;
  extraQuery?: Record<string, string>;
  hash?: string;
}): string {
  const url = new URL(REDIRECT_TARGET);
  if (params.code !== undefined) url.searchParams.set("code", params.code);
  if (params.flowId !== undefined) url.searchParams.set("sb_flow_id", params.flowId);
  if (params.error !== undefined) url.searchParams.set("error", params.error);
  if (params.errorDescription !== undefined) {
    url.searchParams.set("error_description", params.errorDescription);
  }
  if (params.errorCode !== undefined) url.searchParams.set("error_code", params.errorCode);
  for (const [key, value] of Object.entries(params.extraQuery ?? {})) {
    url.searchParams.set(key, value);
  }
  if (params.hash !== undefined) url.hash = params.hash;
  return url.toString();
}

/** A synthetic authorization code. Never asserted on, never printed. */
export const SYNTHETIC_CODE = "synthetic-authorization-code";

// ---------------------------------------------------------------------------
// Storage fake
// ---------------------------------------------------------------------------

export type MemoryStorage = {
  adapter: RemovableStorageAdapter;
  store: Map<string, string>;
  /** Every adapter call, in order, as `get:<key>` / `set:<key>` / `remove:<key>`. */
  calls: string[];
  /** Keys whose `get` resolves `read_failed`. */
  failReads: Set<string>;
  /** Keys whose `set` resolves a write failure. */
  failWrites: Set<string>;
  /** Keys whose `remove` resolves a removal failure. */
  failRemoves: Set<string>;
  /** Keys whose `get` THROWS instead of resolving — the adapter contract violated
   * from below, which every identity repository must contain. */
  throwReads: Set<string>;
  /** Keys whose `remove` THROWS. */
  throwRemoves: Set<string>;
  /**
   * Runs immediately BEFORE the named adapter call completes, so a test can
   * simulate another tab acting in the middle of an operation — installing a newer
   * barrier while a resolution write is in flight, for example. The call string is
   * the same `get:<key>` / `set:<key>` / `remove:<key>` form the log uses.
   */
  onBeforeCall: ((call: string) => void | Promise<void>) | null;
  seedRaw(key: string, raw: string): void;
  seed(key: string, record: unknown): void;
};

export function createMemoryStorage(log?: string[]): MemoryStorage {
  const store = new Map<string, string>();
  const calls: string[] = [];
  const failReads = new Set<string>();
  const failWrites = new Set<string>();
  const failRemoves = new Set<string>();
  const throwReads = new Set<string>();
  const throwRemoves = new Set<string>();

  function record(call: string): void {
    calls.push(call);
    log?.push(`storage:${call}`);
  }

  const state: { onBeforeCall: ((call: string) => void | Promise<void>) | null } = {
    onBeforeCall: null,
  };

  const adapter: RemovableStorageAdapter = {
    async get(key: string): Promise<StorageGetResult> {
      record(`get:${key}`);
      await state.onBeforeCall?.(`get:${key}`);
      if (throwReads.has(key)) throw new Error("synthetic storage read failure");
      if (failReads.has(key)) {
        return { status: "read_failed", fallback: null, error: { kind: "storage_unavailable" } };
      }
      return { status: "value", value: store.has(key) ? (store.get(key) as string) : null };
    },
    async set(key: string, value: string): Promise<PersistenceWriteResult> {
      record(`set:${key}`);
      await state.onBeforeCall?.(`set:${key}`);
      if (failWrites.has(key)) return { ok: false, error: { kind: "storage_unavailable" } };
      store.set(key, value);
      return { ok: true };
    },
    async remove(key: string): Promise<PersistenceRemoveResult> {
      record(`remove:${key}`);
      await state.onBeforeCall?.(`remove:${key}`);
      if (throwRemoves.has(key)) throw new Error("synthetic storage removal failure");
      if (failRemoves.has(key)) {
        return { ok: false, error: { kind: "removal_failed", message: "synthetic" } };
      }
      store.delete(key);
      return { ok: true };
    },
  };

  return {
    adapter,
    store,
    calls,
    failReads,
    failWrites,
    failRemoves,
    throwReads,
    throwRemoves,
    get onBeforeCall() {
      return state.onBeforeCall;
    },
    set onBeforeCall(hook: ((call: string) => void | Promise<void>) | null) {
      state.onBeforeCall = hook;
    },
    seedRaw(key, raw) {
      store.set(key, raw);
    },
    seed(key, value) {
      store.set(key, JSON.stringify(value));
    },
  };
}

/** The outstanding-denial-cleanup tombstone's key (ADR-0025 §22). */
export const intentCleanupKey = INTENT_CLEANUP_STORAGE_KEY;

export const STORAGE_KEYS = {
  barrier: IDENTITY_BARRIER_STORAGE_KEY,
  attempt: INTERACTIVE_ATTEMPT_STORAGE_KEY,
  trusted: TRUSTED_DEVICE_STORAGE_KEY,
  intent: PENDING_INTENT_STORAGE_KEY,
  resolutionFor: (barrierId: string): string => {
    const key = resolutionStorageKeyFor(barrierId);
    if (key === null) throw new Error("test fixture used a non-canonical barrier id");
    return key;
  },
} as const;

// ---------------------------------------------------------------------------
// Provider-mechanics fake
// ---------------------------------------------------------------------------

export type FakeAuthState = {
  restore: SessionRestoreOutcome;
  prepare: PrepareAuthorizationOutcome;
  navigation: NavigationOutcome;
  exchange: ExchangeOutcome;
  otpRequest: AuthServiceResult<void>;
  otpVerify: AuthServiceResult<AccountIdentity>;
  signOut: AuthServiceResult<void>;
};

export type FakeAuthCounts = {
  restore: number;
  prepare: number;
  navigate: number;
  exchange: number;
  otpRequest: number;
  otpVerify: number;
  signOut: number;
};

export type FakeAuth = {
  auth: AuthProviderMechanics;
  state: FakeAuthState;
  counts: FakeAuthCounts;
  /** The selectors `exchangeCorrelatedCallback` was actually called with. Used to
   * assert an exchange never happens without the explicit, callback-matched
   * selector. */
  exchangeSelectors: string[];
  changeListeners: Array<(change: NormalizedAuthChange) => void>;
  emit(change: NormalizedAuthChange): void;
};

export function createFakeAuth(log?: string[], flowId: string = FLOW_X): FakeAuth {
  const state: FakeAuthState = {
    restore: { kind: "no_session" },
    prepare: {
      kind: "prepared",
      prepared: { authorizationUrl: `https://project.supabase.test/auth/v1/authorize`, flowId },
    },
    navigation: { kind: "navigating" },
    exchange: { kind: "exchanged", identity: IDENTITY_A },
    otpRequest: authOk(undefined),
    otpVerify: authOk(IDENTITY_A),
    signOut: authOk(undefined),
  };
  const counts: FakeAuthCounts = {
    restore: 0,
    prepare: 0,
    navigate: 0,
    exchange: 0,
    otpRequest: 0,
    otpVerify: 0,
    signOut: 0,
  };
  const exchangeSelectors: string[] = [];
  const changeListeners: Array<(change: NormalizedAuthChange) => void> = [];

  function record(call: string): void {
    log?.push(`auth:${call}`);
  }

  const auth: AuthProviderMechanics = {
    async restoreSession(): Promise<SessionRestoreOutcome> {
      counts.restore += 1;
      record("restoreSession");
      return state.restore;
    },
    onAuthChange(listener) {
      changeListeners.push(listener);
      return () => {
        const index = changeListeners.indexOf(listener);
        if (index >= 0) changeListeners.splice(index, 1);
      };
    },
    async requestEmailOtp(): Promise<AuthServiceResult<void>> {
      counts.otpRequest += 1;
      record("requestEmailOtp");
      return state.otpRequest;
    },
    async verifyEmailOtp(): Promise<AuthServiceResult<AccountIdentity>> {
      counts.otpVerify += 1;
      record("verifyEmailOtp");
      return state.otpVerify;
    },
    async signOut(): Promise<AuthServiceResult<void>> {
      counts.signOut += 1;
      record("signOut");
      return state.signOut;
    },
    async prepareGoogleSignIn(): Promise<PrepareAuthorizationOutcome> {
      counts.prepare += 1;
      record("prepareGoogleSignIn");
      return state.prepare;
    },
    navigateToAuthorizationUrl(): NavigationOutcome {
      counts.navigate += 1;
      record("navigateToAuthorizationUrl");
      return state.navigation;
    },
    async exchangeCorrelatedCallback(claim, expectedFlowId): Promise<ExchangeOutcome> {
      counts.exchange += 1;
      record("exchangeCorrelatedCallback");
      exchangeSelectors.push(expectedFlowId);
      // The real boundary reads the code exactly once; doing the same here keeps
      // the claim's single-use semantics exercised rather than bypassed.
      claim.readAuthorizationCode();
      return state.exchange;
    },
  };

  return { auth, state, counts, exchangeSelectors, changeListeners, emit: (change) => {
    for (const listener of [...changeListeners]) listener(change);
  } };
}

export function authError(kind: NormalizedAuthErrorKind): AuthServiceResult<never> {
  return authFailed(normalizedAuthError(kind));
}

// ---------------------------------------------------------------------------
// Deterministic interleaving
// ---------------------------------------------------------------------------

export type Deferred<T> = {
  promise: Promise<T>;
  resolve(value: T): void;
};

/**
 * A promise a test resolves explicitly.
 *
 * Two operations genuinely overlap only if one is still awaiting when the other
 * starts. A timer would make that a race; a deferred makes it an exact, repeatable
 * sequence — the same discipline the storage fake's `onBeforeCall` hook uses.
 */
export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((settle) => {
    resolve = settle;
  });
  return { promise, resolve };
}

/** Lets the microtask queue drain, so an operation that is only awaiting already
 * settled promises reaches its next real suspension point. */
export async function settleMicrotasks(): Promise<void> {
  for (let index = 0; index < 20; index += 1) await Promise.resolve();
}

export type HeldCall = {
  /** Resolves once the held call has actually been reached. */
  reached: Promise<void>;
  /** Lets the held call complete. */
  release(): void;
  /** Whether the call was reached at all. */
  hit(): boolean;
};

/**
 * Holds one adapter call open until the test releases it — a **delayed injected
 * adapter**, made exact.
 *
 * Today's `localStorage` adapter resolves promptly; an IndexedDB or network adapter
 * will not, and a defective one may resolve arbitrarily late. Every interleaving
 * that matters is a question of what another operation can do WHILE a dependency is
 * still in flight, so the delay has to be a controllable suspension rather than a
 * timer or a microtask-ordering coincidence.
 *
 * @param occurrence which occurrence of `call` to hold, 1-based.
 */
export function holdStorageCall(
  storage: MemoryStorage,
  call: string,
  occurrence = 1
): HeldCall {
  const gate = deferred<void>();
  const arrival = deferred<void>();
  let seen = 0;
  let reached = false;
  const previous = storage.onBeforeCall;
  storage.onBeforeCall = async (observed) => {
    await previous?.(observed);
    if (observed !== call) return;
    seen += 1;
    if (seen !== occurrence) return;
    reached = true;
    arrival.resolve();
    await gate.promise;
  };
  return {
    reached: arrival.promise,
    release: () => gate.resolve(),
    hit: () => reached,
  };
}

// ---------------------------------------------------------------------------
// The harness
// ---------------------------------------------------------------------------

export type IdentityHarness = {
  coordinator: IdentityTransitionCoordinator;
  storage: MemoryStorage;
  fakeAuth: FakeAuth;
  identityBackend: FakeIdentityBackend;
  capture: CallbackCaptureCell;
  liveGeneration: LiveGenerationCounter;
  /** Every storage call, provider call and progress phase, in one ordered log. */
  log: string[];
  progress: GateProgressPhase[];
  /** Every progress phase with the identity AND ORDER its operation announced, so
   * a test can replay them through the reducer exactly as the provider will. */
  progressEvents: Array<[GateProgressPhase, TransitionIdentity | undefined]>;
  /** The URL the fake window seam currently exposes. */
  currentUrl(): string | null;
  urlReads(): number;
  /** Ids handed out, in order, so a test can name the barrier the coordinator
   * created. */
  issuedIds: string[];
};

export type HarnessOptions = {
  /** The URL this "page load" arrived with. */
  url?: string | null;
  /** The selector the Google preparation returns. */
  flowId?: string;
  legalRows?: unknown;
  redirectTarget?: string | null;
  /**
   * Reuse an existing storage fake. This is how a test models a RELOAD or a
   * genuinely new page load: a second harness over the same store gets a fresh
   * capture cell and a fresh live-generation counter — exactly what a new document
   * gets — while the durable records survive.
   */
  storage?: MemoryStorage;
  /** Advances the live generation before anything else runs, so a test can start
   * an operation at a specific epoch (ADR-0025 §9's two Google epochs). */
  startingGeneration?: number;
  /**
   * Replaces individual `IdentityService` methods over the faithful fake. Used
   * only to reach a state the real RPCs cannot produce — notably a "successful"
   * completion whose derived facts do not add up, which the coordinator has to
   * fail closed on rather than trust.
   */
  identityOverrides?: Partial<IdentityService>;
  /** A defective id generator, for proving that an unusable identifier cannot
   * establish a barrier, an attempt or a resolution. */
  newId?: () => string;
  /** A defective clock, for the same reason. */
  now?: () => string;
  /**
   * Replaces individual `AuthProviderMechanics` methods over the faithful fake.
   * Used to hold one provider call open — the only way to make two coordinator
   * operations genuinely overlap without a timer.
   */
  authOverrides?: Partial<AuthProviderMechanics>;
};

/** Per-harness id namespace, so two harnesses never issue the same identifier. */
let harnessNamespaceCounter = 0;

function nextHarnessNamespace(): string {
  harnessNamespaceCounter += 1;
  return harnessNamespaceCounter.toString(16).padStart(4, "0");
}

export function createIdentityHarness(options: HarnessOptions = {}): IdentityHarness {
  const log: string[] = [];
  const progress: GateProgressPhase[] = [];
  const progressEvents: Array<[GateProgressPhase, TransitionIdentity | undefined]> = [];
  const storage = options.storage ?? createMemoryStorage(log);
  const fakeAuth = createFakeAuth(log, options.flowId ?? FLOW_X);

  const identityBackend = createFakeIdentityBackend();
  identityBackend.legalRows = options.legalRows ?? COMPLETE_LEGAL_ROWS;

  let url: string | null = options.url ?? REDIRECT_TARGET;
  let urlReads = 0;
  const access: CallbackUrlAccess = {
    readCurrentUrl() {
      urlReads += 1;
      log.push("url:read");
      return url;
    },
    replaceCurrentUrl(next: string) {
      log.push("url:replace");
      url = next;
    },
  };
  const capture = createCallbackCaptureCell(access);

  const issuedIds: string[] = [];
  let idCounter = 0;
  // Each harness gets its own id namespace. Two harnesses in one test model two
  // genuinely different page loads, and `crypto.randomUUID()` would never hand
  // them the same id — a shared counter would, and would make a "the recovery
  // wrote a NEW barrier" assertion pass or fail for the wrong reason.
  const namespace = nextHarnessNamespace();
  const newId = (): string => {
    idCounter += 1;
    const value =
      options.newId !== undefined
        ? options.newId()
        : `90000000-${namespace}-4000-8000-${idCounter.toString(16).padStart(12, "0")}`;
    issuedIds.push(value);
    return value;
  };

  let clock = 0;
  const now = (): string => {
    if (options.now !== undefined) return options.now();
    clock += 1;
    return new Date(Date.UTC(2026, 2, 1, 10, 0, clock)).toISOString();
  };

  const liveGeneration = createLiveGenerationCounter();
  for (let index = 0; index < (options.startingGeneration ?? 0); index += 1) liveGeneration.bump();

  const identityService: IdentityService = {
    ...createFakeIdentityService(identityBackend),
    ...options.identityOverrides,
  };

  const coordinator = createIdentityTransitionCoordinator({
    // The fake's own object is passed through UNCOPIED when no override is
    // supplied, so a test can still swap a method after construction.
    auth:
      options.authOverrides === undefined
        ? fakeAuth.auth
        : { ...fakeAuth.auth, ...options.authOverrides },
    identity: identityService,
    capture,
    barriers: createIdentityBarrierRepository(storage.adapter),
    attempts: createInteractiveAttemptRepository(storage.adapter),
    resolutions: createIdentityBarrierResolutionRepository(storage.adapter),
    trusted: createTrustedDeviceRepository(storage.adapter),
    intents: createPendingIntentRepository(storage.adapter),
    liveGeneration,
    now,
    newId,
    resolveRedirectTarget: () =>
      options.redirectTarget === undefined ? REDIRECT_TARGET : options.redirectTarget,
    onProgress: (phase, transition) => {
      progress.push(phase);
      progressEvents.push([phase, transition]);
      log.push(`progress:${phase}`);
    },
  });

  return {
    coordinator,
    storage,
    fakeAuth,
    identityBackend,
    capture,
    liveGeneration,
    log,
    progress,
    progressEvents,
    currentUrl: () => url,
    urlReads: () => urlReads,
    issuedIds,
  };
}

/**
 * A coordinator result with its ANNOTATION removed.
 *
 * Every ordered operation annotates its result with `transition` — the operation
 * that produced it — and a server-driven invalidation adds `denial` plus the
 * complete `outstanding` residue list. Those facts are asserted directly by the
 * tests that are about ordering, denial and residue; restating them in every other
 * assertion would bury the outcome under noise. This removes exactly those three
 * keys and nothing else, so an unexpected extra field still fails the comparison.
 */
function omitKeys<T extends object, K extends string>(value: T, keys: readonly K[]): Omit<T, K> {
  const copy = { ...value } as Record<string, unknown>;
  for (const key of keys) delete copy[key];
  return copy as Omit<T, K>;
}

type Annotated = { transition?: unknown; denial?: unknown; outstanding?: unknown };

const ANNOTATION_KEYS = ["transition", "denial", "outstanding"] as const;

export function report<T extends Annotated>(
  outcome: T
): Omit<T, "transition" | "denial" | "outstanding">;
export function report<T extends Annotated>(
  outcome: T | null
): Omit<T, "transition" | "denial" | "outstanding"> | null;
export function report<T extends Annotated>(
  outcome: T | null
): Omit<T, "transition" | "denial" | "outstanding"> | null {
  return outcome === null ? null : omitKeys(outcome, ANNOTATION_KEYS);
}

/**
 * A gate state with its page-lifetime ORDERING removed — the view it renders.
 *
 * Every state carries the operation that produced it and the highest operation
 * sequence it has accepted an event from. Both are asserted directly by the tests
 * that are about ordering; restating them in every other expectation would bury
 * what is actually under test.
 */
export function view(state: GateState): GateStateView {
  return omitKeys(state, ["transition", "acceptedSequence"] as const) as GateStateView;
}

/** The index of the first log entry matching `predicate`, or `-1`. Used for
 * ordering assertions like "the barrier write precedes every provider call". */
export function firstIndex(log: string[], match: string): number {
  return log.findIndex((entry) => entry === match);
}

export function indexOfPrefix(log: string[], prefix: string): number {
  return log.findIndex((entry) => entry.startsWith(prefix));
}
