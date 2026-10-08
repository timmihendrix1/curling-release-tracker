// The production native-storage composition entry — Stage M3b3.
//
// This is the ONE place that decides what a flag-enabled installed build
// actually does, and it is short on purpose: it supplies the activation
// authority and the two ownership claims, and nothing else.
//
// ## The barrier against premature cutover
//
// `PRODUCTION_ACTIVATION_AUTHORITY` reports `unavailable` unconditionally. That
// is not a placeholder to be filled in casually — it is the barrier this stage
// exists to put in place:
//
//   - the migration that would make a native target authoritative is Stage M3b4
//     and does not exist;
//   - production cutover is Stage M3b5, a separate reviewed stage;
//   - three engineering items still block M3b4 (docs/MOBILE_APP_MIGRATION.md
//     Stage M3b0 §7): the missing pre-activation source marker (P-1), two
//     differing provenance ids (P-2), and human-authorised recovery from a
//     source-generation divergence.
//
// Reporting `ready` here would mount an existing installation's hydration
// against an empty SQLite database and an empty Keychain. Every domain would
// read `absent`, write its documented default, and the user would be looking at
// a clean-looking workspace over training data that still exists in the old
// store. The design names this exact outcome as the withdrawn rule W2, and
// `composeNativeStorage` asks this authority BEFORE it opens anything so that
// outcome is unreachable rather than merely unlikely.
//
// There is no force-ready switch, no synthetic activation record and no
// "fresh install" assumption. `nativeActivationReadyForTests` below is the only
// way to obtain a ready verdict, and no production module may call it —
// asserted by `src/lib/persistence/__tests__/architectureBoundary.test.ts`.
import {
  composeNativeStorage,
  type NativeActivationAuthority,
  type NativeActivationVerdict,
  type StorageCompositionState,
} from "../../../src/lib/persistence/storageComposition";
import { claimBrowserAuthStorage } from "../../../src/lib/supabase/supabaseClient";
import { claimIdentityRepositories } from "../../../src/lib/identity/identityRuntime";
import { providerSessionStorageKey } from "../../../src/lib/supabase/providerCredentialStorage";
import { resolveCloudConfig } from "../../../src/lib/supabase/config";

/**
 * The only authority any shipped build consults.
 *
 * `migration_not_implemented` is a factual statement about this build, not a
 * device fault and not a transient condition. It does not become `ready` when
 * retried, and the gate's retry exists for the storage and credential failures
 * that genuinely can change, not for this one.
 */
export const PRODUCTION_ACTIVATION_AUTHORITY: NativeActivationAuthority = {
  async verdict(): Promise<NativeActivationVerdict> {
    return { status: "unavailable", reason: "migration_not_implemented" };
  },
};

/**
 * TEST-ONLY. The single constructor of a `ready` verdict.
 *
 * It exists so that a ready native composition — every seam wired, readiness
 * gating exercised, Profile namespaces checked — can be tested at all, and it is
 * named so that "no production module can reach it" is a grep-able, asserted
 * property rather than a promise. **No production module may call this.**
 */
export function nativeActivationReadyForTests(): NativeActivationAuthority {
  return {
    async verdict(): Promise<NativeActivationVerdict> {
      return { status: "ready" };
    },
  };
}

/**
 * One composition attempt, as the installed application performs it.
 *
 * The two claims are passed by reference rather than called here: the
 * composition owns the ORDER in which ownership is taken (credential storage
 * before identity repositories, both before publishing a ready composition),
 * and that order is part of what the tests assert.
 */
export function composeProductionNativeStorage(): Promise<StorageCompositionState> {
  // The SDK's session key is derived from the SAME configured URL the client is
  // built from, so establishment reads a key the SDK will actually use. With no
  // configured cloud there is no key and the composition fails closed rather
  // than reading a fabricated one.
  const config = resolveCloudConfig();
  const sessionStorageKey =
    config.status === "configured" ? providerSessionStorageKey(config.url) : null;

  return composeNativeStorage({
    activationAuthority: PRODUCTION_ACTIVATION_AUTHORITY,
    sessionStorageKey,
    // The storage and its health verdict are claimed together: the verdict is
    // what `supabaseAuthService` consults so a credential fault cannot be
    // reported as a clean signed-out state or a completed sign-out.
    establishCredentialStorage: (credentials) =>
      claimBrowserAuthStorage(credentials.storage, () => credentials.observedFailure()),
    establishIdentityRepositories: (repositories) => claimIdentityRepositories(repositories),
  });
}
