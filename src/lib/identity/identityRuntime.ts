// `identityRuntime` — the single non-component composition facade (ADR-0025 §1;
// Stage B0.2c).
//
// It constructs the coordinator and HIDES everything below it: the five identity
// repositories, the page-scoped callback capture cell, the concrete Supabase auth
// service and the concrete Supabase identity service. From Stage B0.2e onward,
// `IdentityProvider` imports exactly this seam and nothing lower — which is what
// makes "no component can reach a repository, an `AuthService`, or the
// coordinator's construction" a checkable property rather than a convention.
//
// **Nothing here runs at module-evaluation time.** No Supabase client is
// constructed, no URL is read, no `history.replaceState` is called and no storage
// is touched until `getIdentityRuntime()` is called — and Phase 0's capture is
// invoked later still, from `startUp()`, which its caller must call from a guarded
// lifecycle boundary and never during render. Capturing at import time would
// rewrite history as a side effect of loading a module.
//
// **The capture cell is page-scoped, and this module is what scopes it.** One cell
// is created on first use and cached at module level, so React Strict Mode's
// replayed effect setup — and any other repeated `startUp()` caller — reads the
// same cell instead of the now-clean URL. A real new page load re-evaluates this
// module and therefore gets a genuinely new scope. Nothing here is durable.
//
// STAGE STATUS: mounted by the application-level `IdentityProvider`, which is the
// only production component allowed to import this facade.

import { resolveCloudConfig } from "../supabase/config";
import type { NormalizedAuthChange } from "../supabase/authService";
import { createSupabaseAuthService } from "../supabase/supabaseAuthService";
import { createSupabaseIdentityService } from "../supabase/supabaseIdentityService";
import { getSupabaseBrowserClient } from "../supabase/supabaseClient";
import {
  browserCallbackUrlAccess,
  createCallbackCaptureCell,
  type CallbackCaptureCell,
} from "../supabase/supabaseCallbackCapture";
import { identityBarrierRepository } from "./identityBarrierRepository";
import { IDENTITY_BARRIER_STORAGE_KEY } from "./identityBarrier";
import { identityBarrierResolutionRepository } from "./identityBarrierResolutionRepository";
import { interactiveAttemptRepository } from "./interactiveAttemptRepository";
import {
  pendingIntentRepository,
  selectDeepLinkIntent,
  type PendingIntent,
} from "./pendingIntentRepository";
import { trustedDeviceRepository } from "./trustedDeviceRepository";
import {
  createIdentityTransitionCoordinator,
  createLiveGenerationCounter,
  type IdentityCoordinatorDeps,
  type IdentityTransitionCoordinator,
  type StartupOutcome,
} from "./identityTransitionCoordinator";
import {
  reduceGateState,
  type GateEvent,
  type GateProgressPhase,
  type GateSession,
  type GateState,
  type TransitionIdentity,
} from "./gateState";

export { reduceGateState };
export type { GateEvent, GateSession, GateState, PendingIntent };

/**
 * What the runtime resolved to.
 *
 * `cloud_unavailable` is not a failure to recover from here: with no configured
 * cloud there is no identity provider, no server-authoritative gate facts and
 * therefore no gate to run. The caller renders the fixed unavailable surface.
 */
export type IdentityProgressListener = (
  phase: GateProgressPhase,
  transition?: TransitionIdentity
) => void;

export type DeepLinkCaptureOutcome =
  | { kind: "not_present" }
  | { kind: "invalid" }
  | { kind: "captured"; intent: PendingIntent }
  | { kind: "blocked" };

export type IdentityRuntimeReady = {
  status: "ready";
  coordinator: IdentityTransitionCoordinator;
  /** One page-scoped startup. Every React lifecycle replay observes the same
   * promise rather than starting a second coordinator operation. */
  startUpOnce(): Promise<StartupOutcome>;
  subscribeToProgress(listener: IdentityProgressListener): () => void;
  subscribeToAuthChanges(listener: (change: NormalizedAuthChange) => void): () => void;
  subscribeToBarrierChanges(listener: () => void): () => void;
  captureCurrentDeepLinkIntent(): Promise<DeepLinkCaptureOutcome>;
  loadPendingIntent(): Promise<PendingIntent | null>;
};

export type IdentityRuntime =
  | { status: "cloud_unavailable" }
  | IdentityRuntimeReady;

/** The current origin's ROOT, which is the only Google redirect target this
 * application uses. `null` when there is no document — preparation then fails
 * closed rather than guessing an origin. */
function browserRedirectTarget(): string | null {
  if (typeof window === "undefined") return null;
  const origin = window.location.origin;
  if (typeof origin !== "string" || origin.length === 0 || origin === "null") return null;
  return `${origin}/`;
}

function browserNow(): string {
  return new Date().toISOString();
}

/**
 * A canonical UUID for a barrier or an attempt.
 *
 * `crypto.randomUUID` is required rather than approximated: these ids are the
 * selectors a resolution key is derived from, and the record validators accept
 * only the canonical shape. Where it is unavailable this returns `null` and the
 * caller treats the runtime as unusable — an invented id would produce records
 * that cannot be validated on the next load.
 */
function browserIdSource(): (() => string) | null {
  if (typeof crypto === "undefined" || typeof crypto.randomUUID !== "function") return null;
  return () => crypto.randomUUID();
}

/** Test-only seams. Production callers pass none. */
export type IdentityRuntimeOverrides = {
  onProgress?: (phase: GateProgressPhase, transition?: TransitionIdentity) => void;
  /** Replaces the whole dependency set — used by tests that need fakes for every
   * seam. When supplied, no Supabase client is constructed. */
  deps?: IdentityCoordinatorDeps;
};

/**
 * Builds a runtime. Exported for tests and for the future provider's own
 * composition; production code uses the cached `getIdentityRuntime()` below so
 * that the capture cell is genuinely page-scoped.
 */
export function createIdentityRuntime(
  overrides: IdentityRuntimeOverrides = {},
  capture: CallbackCaptureCell = createCallbackCaptureCell(browserCallbackUrlAccess())
): IdentityRuntime {
  const progressListeners = new Set<IdentityProgressListener>();
  const relayProgress: IdentityProgressListener = (phase, transition) => {
    try {
      overrides.onProgress?.(phase, transition);
    } catch {
      // A diagnostic/test listener is never allowed to break the gate.
    }
    for (const listener of progressListeners) {
      try {
        listener(phase, transition);
      } catch {
        // One React consumer cannot prevent another from observing progress.
      }
    }
  };

  function readyRuntime(
    coordinator: IdentityTransitionCoordinator,
    auth: IdentityCoordinatorDeps["auth"]
  ): IdentityRuntimeReady {
    let startup: Promise<StartupOutcome> | null = null;
    let deepLinkCapture: Promise<DeepLinkCaptureOutcome> | null = null;

    async function captureDeepLinkIntent(): Promise<DeepLinkCaptureOutcome> {
      try {
        if (typeof window === "undefined") return { kind: "not_present" };
        const url = new URL(window.location.href);
        const inviteToken = url.searchParams.get("inviteToken");
        const adminRequestId = url.searchParams.get("adminRequestId");
        if (inviteToken === null && adminRequestId === null) return { kind: "not_present" };

        const intent = selectDeepLinkIntent(
          { inviteToken, adminRequestId },
          browserNow()
        );
        if (intent === null) {
          // Invalid input is not an intent and is never repaired. Remove only the
          // two application-owned Team parameters; unrelated URL state survives.
          url.searchParams.delete("inviteToken");
          url.searchParams.delete("adminRequestId");
          window.history.replaceState(null, "", url.toString());
          return { kind: "invalid" };
        }

        const captured = await coordinator.capturePendingIntent(intent);
        if (captured.kind !== "applied") return { kind: "blocked" };
        url.searchParams.delete("inviteToken");
        url.searchParams.delete("adminRequestId");
        window.history.replaceState(null, "", url.toString());
        return { kind: "captured", intent };
      } catch {
        // Reading or rewriting browser URL state is part of the durable-capture
        // boundary. A throwing history implementation, Location getter, URL
        // implementation, or any unexpected coordinator rejection must never
        // escape as an unhandled rejection and strand the Provider in startup.
        // The caught value may contain URL or token material, so it is discarded
        // without inspection, logging, serialization, or forwarding.
        return { kind: "blocked" };
      }
    }

    return {
      status: "ready",
      coordinator,
      startUpOnce() {
        if (startup === null) startup = coordinator.startUp();
        return startup;
      },
      subscribeToProgress(listener) {
        progressListeners.add(listener);
        return () => {
          progressListeners.delete(listener);
        };
      },
      subscribeToAuthChanges(listener) {
        // Subscription construction is the AuthService contract's sole
        // synchronous throwing boundary. Let the provider fail closed and make
        // the denial durable; silently returning a no-op would leave a mounted
        // app unable to observe provider invalidation.
        return auth.onAuthChange(listener);
      },
      subscribeToBarrierChanges(listener) {
        if (typeof window === "undefined") return () => {};
        const onStorage = (event: StorageEvent) => {
          if (event.key !== IDENTITY_BARRIER_STORAGE_KEY) return;
          try {
            listener();
          } catch {
            // Storage-event delivery is advisory; a consumer exception must not
            // escape the browser event boundary.
          }
        };
        window.addEventListener("storage", onStorage);
        return () => window.removeEventListener("storage", onStorage);
      },
      captureCurrentDeepLinkIntent(): Promise<DeepLinkCaptureOutcome> {
        // React Strict Mode may replay the provider effect. Capturing is a
        // page-scoped transition just like startup, so every replay observes
        // this same promise and cannot persist/clean the link twice.
        if (deepLinkCapture === null) deepLinkCapture = captureDeepLinkIntent();
        return deepLinkCapture;
      },
      async loadPendingIntent(): Promise<PendingIntent | null> {
        const loaded = await pendingIntentRepository.load();
        return loaded.status === "value" ? loaded.value : null;
      },
    };
  }

  if (overrides.deps !== undefined) {
    const deps = { ...overrides.deps, onProgress: relayProgress };
    return readyRuntime(createIdentityTransitionCoordinator(deps), deps.auth);
  }

  const config = resolveCloudConfig();
  if (config.status !== "configured") return { status: "cloud_unavailable" };

  const newId = browserIdSource();
  if (newId === null) return { status: "cloud_unavailable" };

  const client = getSupabaseBrowserClient(config);

  const auth = createSupabaseAuthService(config);
  const coordinator = createIdentityTransitionCoordinator({
      auth,
      identity: createSupabaseIdentityService(client),
      capture,
      barriers: identityBarrierRepository,
      attempts: interactiveAttemptRepository,
      resolutions: identityBarrierResolutionRepository,
      trusted: trustedDeviceRepository,
      intents: pendingIntentRepository,
      liveGeneration: createLiveGenerationCounter(),
      now: browserNow,
      newId,
      resolveRedirectTarget: browserRedirectTarget,
      onProgress: relayProgress,
    });
  return readyRuntime(coordinator, auth);
}

let cachedRuntime: IdentityRuntime | null = null;

/**
 * The one production entry point. Constructs the runtime — and with it the
 * page-scoped capture cell and the page-lifetime live generation counter — on
 * first use, and returns the same instance for the rest of the document's
 * lifetime.
 *
 * Caching is what makes the cell page-scoped: two callers must NOT each get their
 * own cell, or the second would read an already-cleaned URL and conclude no
 * callback arrived.
 */
export function getIdentityRuntime(): IdentityRuntime {
  if (cachedRuntime === null) cachedRuntime = createIdentityRuntime();
  return cachedRuntime;
}

/** Test-only: forces the next `getIdentityRuntime()` to build a fresh runtime,
 * which is how a test simulates a genuinely new page load. Production code never
 * calls this. */
export function resetIdentityRuntimeForTests(): void {
  cachedRuntime = null;
}
