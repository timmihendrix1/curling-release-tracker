// Strict validation of the STORED Accuracy Tolerance Profiles state.
//
// Deliberately separate from migration.ts's quarantine style. Migration answers
// "what can I safely use from this?"; this answers "is this something this build is
// allowed to read and then overwrite?". The distinction matters because the
// application's ordinary save effect writes the loaded state straight back: a state
// that migration quietly emptied (unknown schema version) or quietly shortened
// (a template whose unit this build does not know) would be written back over the
// original bytes, destroying data this build simply could not represent.
//
// So anything unsupported or malformed is reported as UNREADABLE — the repository
// turns that into a protected read failure, leaving the stored bytes untouched —
// rather than as an empty or partial value. Genuine absence stays distinct from it.
//
// Valid version-1 state stays fully readable; its forward migration is lossless.
import { validateAccuracyThresholds } from "../accuracyThresholds";
import { isMeasuredQuantity } from "../measurement/quantities";
import { validateQuantityTolerance } from "../measurement/tolerance";
import {
  ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
  LEGACY_ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
} from "./persistence";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasCommonFields(raw: Record<string, unknown>): boolean {
  return (
    typeof raw.id === "string" &&
    raw.id.length > 0 &&
    typeof raw.name === "string" &&
    raw.name.trim().length > 0 &&
    typeof raw.createdAt === "string" &&
    typeof raw.updatedAt === "string"
  );
}

function legacyProfileIsReadable(raw: Record<string, unknown>): boolean {
  if (typeof raw.onTarget !== "number" || typeof raw.acceptable !== "number") {
    return false;
  }
  return validateAccuracyThresholds(raw.onTarget, raw.acceptable).valid;
}

function currentProfileIsReadable(raw: Record<string, unknown>): boolean {
  if (!isMeasuredQuantity(raw.quantity)) return false;
  return validateQuantityTolerance(
    raw.tolerance as Parameters<typeof validateQuantityTolerance>[0]
  ).valid;
}

/**
 * Whether this build can read the stored state in full. `false` means "protect it",
 * never "start from empty".
 */
export function storedAccuracyToleranceProfilesAreReadable(value: unknown): boolean {
  if (!isRecord(value)) return false;

  const version = value.schemaVersion;
  const isLegacy = version === LEGACY_ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION;
  const isCurrent = version === ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION;
  if (!isLegacy && !isCurrent) return false;

  const profiles = value.profiles;
  if (!Array.isArray(profiles)) return false;

  const ids = new Set<string>();
  for (const candidate of profiles) {
    if (!isRecord(candidate) || !hasCommonFields(candidate)) return false;
    const id = candidate.id as string;
    if (ids.has(id)) return false;
    ids.add(id);

    if (isLegacy ? !legacyProfileIsReadable(candidate) : !currentProfileIsReadable(candidate)) {
      return false;
    }
  }

  const defaultProfileId = value.defaultProfileId;
  if (defaultProfileId !== null && typeof defaultProfileId !== "string") return false;

  return true;
}

/**
 * Whether a state this build is about to WRITE is well formed. A writer must never
 * store what the same implementation would refuse to read back.
 */
export function accuracyToleranceProfilesStateIsWritable(value: unknown): boolean {
  if (!isRecord(value)) return false;
  if (value.schemaVersion !== ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION) return false;
  return storedAccuracyToleranceProfilesAreReadable(value);
}
