// Domain operations on Accuracy Tolerance Profiles. Reuses the exact same tolerance
// validation as Training Blocks and Training Plan Steps (validateAccuracyThresholds,
// src/lib/accuracyThresholds.ts) rather than inventing a second definition of
// On Target/Acceptable — see docs/adr/0008-accuracy-thresholds-are-snapshotted-per-training-block.md.
import type { MeasuredQuantity, QuantityTolerance } from "../../types";
import { cloneQuantityTolerance } from "../measurement/quantities";
import {
  isSymmetricTolerance,
  quantityUnitLabel,
  symmetricTolerance,
  validateQuantityTolerance,
} from "../measurement/tolerance";
import { err, ok, type AccuracyToleranceProfileOutcome } from "./errors";
import type {
  AccuracyToleranceProfile,
  AccuracyToleranceProfilesState,
} from "./persistence";

export const MAX_PROFILE_NAME_LENGTH = 40;

export function validateProfileName(
  name: string
): AccuracyToleranceProfileOutcome<string> {
  const trimmed = name.trim();

  if (!trimmed) {
    return err("invalid_name", "Give this profile a name.");
  }

  if (trimmed.length > MAX_PROFILE_NAME_LENGTH) {
    return err(
      "invalid_name",
      `Profile names must be ${MAX_PROFILE_NAME_LENGTH} characters or fewer.`
    );
  }

  return ok(trimmed);
}

export type AccuracyToleranceProfileInput = {
  id?: string;
  name: string;
  /** Defaults to "time" so every existing call site keeps its exact meaning. */
  quantity?: MeasuredQuantity;
  /**
   * Either form may be supplied. The symmetric `onTarget`/`acceptable` pair is what
   * the current (time-only) UI produces and keeps working unchanged; `tolerance`
   * carries an explicit per-side template. Supplying both is a contradiction and is
   * rejected rather than one being silently preferred.
   */
  onTarget?: number;
  acceptable?: number;
  tolerance?: QuantityTolerance;
  createdAt?: string;
};

/**
 * Validates and builds a single profile. `now` is passed in (never read from
 * `Date.now()`/`new Date()` internally) so callers control timestamping and this
 * function stays a pure, independently-testable transform.
 */
export function buildAccuracyToleranceProfile(
  input: AccuracyToleranceProfileInput,
  now: string
): AccuracyToleranceProfileOutcome<AccuracyToleranceProfile> {
  const nameResult = validateProfileName(input.name);
  if (!nameResult.ok) return nameResult;

  const suppliedSymmetric =
    input.onTarget !== undefined || input.acceptable !== undefined;

  if (suppliedSymmetric && input.tolerance !== undefined) {
    return err(
      "invalid_thresholds",
      "Supply either a symmetric pair or per-side tolerances, not both."
    );
  }

  const candidate = input.tolerance
    ? input.tolerance
    : symmetricTolerance(input.onTarget as number, input.acceptable as number);

  const toleranceResult = validateQuantityTolerance(candidate);
  if (!toleranceResult.valid) {
    return err("invalid_thresholds", toleranceResult.error);
  }

  return ok({
    id: input.id ?? crypto.randomUUID(),
    name: nameResult.value,
    quantity: input.quantity ?? "time",
    // A deep copy, so editing or deleting the caller's object later cannot reach into
    // the stored template — the same isolation rule block snapshots follow.
    tolerance: cloneQuantityTolerance(toleranceResult.tolerance),
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  });
}

/**
 * Whether a template may be applied to a block measuring `quantity`. Units are never
 * interchangeable: selecting a speed template for a time measurement (or the reverse)
 * would silently reinterpret its numbers, so it is refused rather than converted.
 */
export function isProfileCompatibleWithQuantity(
  profile: AccuracyToleranceProfile,
  quantity: MeasuredQuantity
): boolean {
  return profile.quantity === quantity;
}

export function accuracyToleranceProfilesFor(
  profiles: AccuracyToleranceProfile[],
  quantity: MeasuredQuantity
): AccuracyToleranceProfile[] {
  return profiles.filter((profile) =>
    isProfileCompatibleWithQuantity(profile, quantity)
  );
}

/**
 * The templates a LEGACY, one-field-per-band control can represent: time templates
 * whose bands are symmetric. An asymmetric template is stored and preserved faithfully
 * but is not offered by a control that could only show half of it.
 *
 * Stage B's per-side editor (`QuantityToleranceEditor`) represents every stored shape
 * and applies its own compatibility rule, so it does not use this. Retained for any
 * surface that genuinely still has one field per band.
 */
export function legacySelectableProfiles(
  profiles: AccuracyToleranceProfile[]
): AccuracyToleranceProfile[] {
  return accuracyToleranceProfilesFor(profiles, "time").filter((profile) =>
    isSymmetricTolerance(profile.tolerance)
  );
}

/** The symmetric seconds pair a legacy-shaped consumer needs, or undefined. */
export function profileSymmetricPair(
  profile: AccuracyToleranceProfile
): { onTarget: number; acceptable: number } | undefined {
  if (!isSymmetricTolerance(profile.tolerance)) return undefined;
  return {
    onTarget: profile.tolerance.onTarget.lower,
    acceptable: profile.tolerance.acceptable.lower,
  };
}

/** A factual, unit-bearing one-line description of a template. */
export function profileToleranceLabel(profile: AccuracyToleranceProfile): string {
  const unit = quantityUnitLabel(profile.quantity);
  const { onTarget, acceptable } = profile.tolerance;

  const band = (lower: number, upper: number) =>
    lower === upper
      ? `±${lower.toFixed(2)}${unit}`
      : `-${lower.toFixed(2)} / +${upper.toFixed(2)}${unit}`;

  return `On Target ${band(onTarget.lower, onTarget.upper)} · Acceptable ${band(acceptable.lower, acceptable.upper)}`;
}

export function findAccuracyToleranceProfile(
  state: AccuracyToleranceProfilesState,
  profileId: string
): AccuracyToleranceProfile | undefined {
  return state.profiles.find((profile) => profile.id === profileId);
}

export function addAccuracyToleranceProfile(
  state: AccuracyToleranceProfilesState,
  profile: AccuracyToleranceProfile
): AccuracyToleranceProfilesState {
  return { ...state, profiles: [...state.profiles, profile] };
}

export function replaceAccuracyToleranceProfile(
  state: AccuracyToleranceProfilesState,
  profile: AccuracyToleranceProfile
): AccuracyToleranceProfileOutcome<AccuracyToleranceProfilesState> {
  if (!state.profiles.some((existing) => existing.id === profile.id)) {
    return err("profile_not_found", "This profile no longer exists.");
  }

  return ok({
    ...state,
    profiles: state.profiles.map((existing) =>
      existing.id === profile.id ? profile : existing
    ),
  });
}

/**
 * Creates a new, fully independent copy (new id) — later edits to either the
 * original or the copy never affect the other. `now` is caller-supplied, same
 * reasoning as buildAccuracyToleranceProfile.
 */
export function duplicateAccuracyToleranceProfile(
  profile: AccuracyToleranceProfile,
  now: string
): AccuracyToleranceProfile {
  return {
    ...profile,
    id: crypto.randomUUID(),
    name: `${profile.name} (Copy)`,
    // A spread copies the nested tolerance by REFERENCE, so editing the duplicate
    // would silently edit the original — and anything already snapshotted from it.
    tolerance: cloneQuantityTolerance(profile.tolerance),
    createdAt: now,
    updatedAt: now,
  };
}

/**
 * Removes a profile. Per product spec: deleting the current default profile
 * removes the default *reference* rather than silently promoting another
 * profile to default — the athlete must explicitly choose a new default
 * afterward. Deleting an already-absent profile is a safe no-op.
 */
export function deleteAccuracyToleranceProfile(
  state: AccuracyToleranceProfilesState,
  profileId: string
): AccuracyToleranceProfilesState {
  return {
    ...state,
    profiles: state.profiles.filter((profile) => profile.id !== profileId),
    defaultProfileId:
      state.defaultProfileId === profileId ? null : state.defaultProfileId,
  };
}

/** Pass `null` to clear the default without choosing a replacement. */
export function setDefaultAccuracyToleranceProfile(
  state: AccuracyToleranceProfilesState,
  profileId: string | null
): AccuracyToleranceProfileOutcome<AccuracyToleranceProfilesState> {
  if (profileId !== null && !state.profiles.some((profile) => profile.id === profileId)) {
    return err("profile_not_found", "This profile no longer exists.");
  }

  return ok({ ...state, defaultProfileId: profileId });
}

/**
 * Resolves the default profile reference to an actual profile, or `null` if
 * none is set or the reference is dangling (e.g. malformed persisted state) —
 * defensively treated as "no default" rather than guessing.
 */
export function getDefaultAccuracyToleranceProfile(
  state: AccuracyToleranceProfilesState
): AccuracyToleranceProfile | null {
  if (!state.defaultProfileId) return null;
  return findAccuracyToleranceProfile(state, state.defaultProfileId) ?? null;
}
