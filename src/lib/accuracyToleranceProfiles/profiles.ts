// Domain operations on Accuracy Tolerance Profiles. Reuses the exact same tolerance
// validation as Training Blocks and Training Plan Steps (validateAccuracyThresholds,
// src/lib/accuracyThresholds.ts) rather than inventing a second definition of
// On Target/Acceptable — see docs/adr/0008-accuracy-thresholds-are-snapshotted-per-training-block.md.
import { validateAccuracyThresholds } from "../accuracyThresholds";
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
  onTarget: number;
  acceptable: number;
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

  const thresholdsResult = validateAccuracyThresholds(
    input.onTarget,
    input.acceptable
  );
  if (!thresholdsResult.valid) {
    return err("invalid_thresholds", thresholdsResult.error);
  }

  return ok({
    id: input.id ?? crypto.randomUUID(),
    name: nameResult.value,
    onTarget: thresholdsResult.onTarget,
    acceptable: thresholdsResult.acceptable,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  });
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
