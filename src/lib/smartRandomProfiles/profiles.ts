// Domain operations on Smart Random Profiles. Reuses the exact same Smart
// Random availability/range validation as Training Blocks and Training Plan
// Steps (isSmartRandomAvailable, validateSmartRandomRange —
// src/lib/variableTargets.ts) rather than inventing a second definition of a
// valid Smart Random range or Measurement Mode restriction.
import { isSmartRandomAvailable, validateSmartRandomRange } from "../variableTargets";
import { err, ok, type SmartRandomProfileOutcome } from "./errors";
import type { MeasurementMode } from "../../types";
import type {
  SmartRandomProfile,
  SmartRandomProfilesState,
} from "./persistence";

export const MAX_PROFILE_NAME_LENGTH = 40;

export function validateProfileName(
  name: string
): SmartRandomProfileOutcome<string> {
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

export type SmartRandomProfileInput = {
  id?: string;
  name: string;
  measurementMode: MeasurementMode;
  min: number;
  max: number;
  createdAt?: string;
};

/**
 * Validates and builds a single profile. Rejects a Measurement Mode Smart
 * Random has no validated range for (today: anything but Back-Hog) — a
 * profile can never be saved in a state that would later be silently applied
 * in the wrong measurement context. `now` is passed in (never read from
 * `Date.now()`/`new Date()` internally) so callers control timestamping and
 * this function stays a pure, independently-testable transform.
 */
export function buildSmartRandomProfile(
  input: SmartRandomProfileInput,
  now: string
): SmartRandomProfileOutcome<SmartRandomProfile> {
  const nameResult = validateProfileName(input.name);
  if (!nameResult.ok) return nameResult;

  if (!isSmartRandomAvailable(input.measurementMode)) {
    return err(
      "unsupported_measurement_mode",
      "Smart Random isn't available for this Measurement Mode yet."
    );
  }

  const rangeResult = validateSmartRandomRange(input.min, input.max);
  if (!rangeResult.valid) {
    return err("invalid_range", rangeResult.error);
  }

  return ok({
    id: input.id ?? crypto.randomUUID(),
    name: nameResult.value,
    measurementMode: input.measurementMode,
    min: rangeResult.min,
    max: rangeResult.max,
    createdAt: input.createdAt ?? now,
    updatedAt: now,
  });
}

export function findSmartRandomProfile(
  state: SmartRandomProfilesState,
  profileId: string
): SmartRandomProfile | undefined {
  return state.profiles.find((profile) => profile.id === profileId);
}

export function addSmartRandomProfile(
  state: SmartRandomProfilesState,
  profile: SmartRandomProfile
): SmartRandomProfilesState {
  return { ...state, profiles: [...state.profiles, profile] };
}

export function replaceSmartRandomProfile(
  state: SmartRandomProfilesState,
  profile: SmartRandomProfile
): SmartRandomProfileOutcome<SmartRandomProfilesState> {
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
 * reasoning as buildSmartRandomProfile.
 */
export function duplicateSmartRandomProfile(
  profile: SmartRandomProfile,
  now: string
): SmartRandomProfile {
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
export function deleteSmartRandomProfile(
  state: SmartRandomProfilesState,
  profileId: string
): SmartRandomProfilesState {
  return {
    ...state,
    profiles: state.profiles.filter((profile) => profile.id !== profileId),
    defaultProfileId:
      state.defaultProfileId === profileId ? null : state.defaultProfileId,
  };
}

/** Pass `null` to clear the default without choosing a replacement. */
export function setDefaultSmartRandomProfile(
  state: SmartRandomProfilesState,
  profileId: string | null
): SmartRandomProfileOutcome<SmartRandomProfilesState> {
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
export function getDefaultSmartRandomProfile(
  state: SmartRandomProfilesState
): SmartRandomProfile | null {
  if (!state.defaultProfileId) return null;
  return findSmartRandomProfile(state, state.defaultProfileId) ?? null;
}
