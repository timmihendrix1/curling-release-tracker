// The five identity repositories as one injectable set — Stage M3b3
// (docs/MOBILE_APP_MIGRATION.md Stage M3b0 §3 seam 4, ADR-0049 decision 5).
//
// The obstacle this module exists to remove is real and was named explicitly in
// the design: every `…Repository` below is exported as a MODULE-LEVEL SINGLETON
// bound at import time (`export const trustedDeviceRepository =
// createTrustedDeviceRepository()`), so swapping a default adapter cannot reach
// them. Explicit injection is the only thing that does.
//
// Two properties this set is responsible for:
//
//   - **All five, or none.** A partial swap would leave, say, the access barrier
//     on WebView `localStorage` while the trusted-device record moved — and the
//     barrier is the authority latch. The set is constructed as a unit.
//   - **The dynamic family travels with it.** Barrier resolutions are
//     `curling.identity.accessBarrierResolution.<barrierId>.v1`, ONE KEY PER
//     BARRIER, addressed by membership test rather than a fixed list. It is one
//     repository and therefore one member here, but a reader who counts "five
//     fixed keys" and stops has missed it: the key set behind this member is
//     unbounded.
//
// The pending-intent repository owns BOTH `…pendingIntent.v1` and
// `…intentCleanup.v1`, so intent cleanup is covered by the same member rather
// than needing a sixth.
import { createIdentityBarrierRepository, identityBarrierRepository, type IdentityBarrierRepository } from "./identityBarrierRepository";
import {
  createIdentityBarrierResolutionRepository,
  identityBarrierResolutionRepository,
  type IdentityBarrierResolutionRepository,
} from "./identityBarrierResolutionRepository";
import {
  createInteractiveAttemptRepository,
  interactiveAttemptRepository,
  type InteractiveAttemptRepository,
} from "./interactiveAttemptRepository";
import {
  createPendingIntentRepository,
  pendingIntentRepository,
  type PendingIntentRepository,
} from "./pendingIntentRepository";
import {
  createTrustedDeviceRepository,
  trustedDeviceRepository,
  type TrustedDeviceRepository,
} from "./trustedDeviceRepository";
import type { RemovableStorageAdapter } from "../persistence/types";

/**
 * Exactly the five repositories `IdentityCoordinatorDeps` needs, under the same
 * member names, so the set can be spread into the coordinator's dependencies
 * without a translation step that could quietly drop one.
 */
export type IdentityRepositorySet = Readonly<{
  barriers: IdentityBarrierRepository;
  attempts: InteractiveAttemptRepository;
  resolutions: IdentityBarrierResolutionRepository;
  trusted: TrustedDeviceRepository;
  intents: PendingIntentRepository;
}>;

/**
 * Builds the complete set over one adapter.
 *
 * `identityBarrierRepository` is annotated with the BASE `StorageAdapter` on
 * purpose (ADR-0025 Decision 6: no code path may remove a current barrier), and
 * passing a removable adapter to a parameter typed as the narrower contract is
 * fine — the repository still cannot call `remove`.
 */
export function createIdentityRepositorySet(
  adapter: RemovableStorageAdapter
): IdentityRepositorySet {
  return Object.freeze({
    barriers: createIdentityBarrierRepository(adapter),
    attempts: createInteractiveAttemptRepository(adapter),
    resolutions: createIdentityBarrierResolutionRepository(adapter),
    trusted: createTrustedDeviceRepository(adapter),
    intents: createPendingIntentRepository(adapter),
  });
}

/**
 * The existing import-time singletons, assembled.
 *
 * This is the Web default and it changes nothing: the same instances that have
 * always been bound to `localStorageAdapter` are simply named as a set. No new
 * repository is constructed here, so no second workspace appears alongside the
 * one already in use.
 */
export const DEFAULT_IDENTITY_REPOSITORY_SET: IdentityRepositorySet = Object.freeze({
  barriers: identityBarrierRepository,
  attempts: interactiveAttemptRepository,
  resolutions: identityBarrierResolutionRepository,
  trusted: trustedDeviceRepository,
  intents: pendingIntentRepository,
});
