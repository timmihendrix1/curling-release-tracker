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
// STAGE STATUS: this module is DORMANT. No production component imports it, so
// user-visible behaviour is unchanged. It exists so that Stage B0.2e's provider
// has exactly one seam to mount.

import { resolveCloudConfig } from "../supabase/config";
import { createSupabaseAuthService } from "../supabase/supabaseAuthService";
import { createSupabaseIdentityService } from "../supabase/supabaseIdentityService";
import { getSupabaseBrowserClient } from "../supabase/supabaseClient";
import {
  browserCallbackUrlAccess,
  createCallbackCaptureCell,
  type CallbackCaptureCell,
} from "../supabase/supabaseCallbackCapture";
import { identityBarrierRepository } from "./identityBarrierRepository";
import { identityBarrierResolutionRepository } from "./identityBarrierResolutionRepository";
import { interactiveAttemptRepository } from "./interactiveAttemptRepository";
import { pendingIntentRepository } from "./pendingIntentRepository";
import { trustedDeviceRepository } from "./trustedDeviceRepository";
import {
  createIdentityTransitionCoordinator,
  createLiveGenerationCounter,
  type IdentityCoordinatorDeps,
  type IdentityTransitionCoordinator,
} from "./identityTransitionCoordinator";
import type { GateProgressPhase, TransitionIdentity } from "./gateState";

/**
 * What the runtime resolved to.
 *
 * `cloud_unavailable` is not a failure to recover from here: with no configured
 * cloud there is no identity provider, no server-authoritative gate facts and
 * therefore no gate to run. The caller renders the fixed unavailable surface.
 */
export type IdentityRuntime =
  | { status: "cloud_unavailable" }
  | { status: "ready"; coordinator: IdentityTransitionCoordinator };

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
  if (overrides.deps !== undefined) {
    return {
      status: "ready",
      coordinator: createIdentityTransitionCoordinator(overrides.deps),
    };
  }

  const config = resolveCloudConfig();
  if (config.status !== "configured") return { status: "cloud_unavailable" };

  const newId = browserIdSource();
  if (newId === null) return { status: "cloud_unavailable" };

  const client = getSupabaseBrowserClient(config);

  return {
    status: "ready",
    coordinator: createIdentityTransitionCoordinator({
      auth: createSupabaseAuthService(config),
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
      onProgress: overrides.onProgress,
    }),
  };
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
