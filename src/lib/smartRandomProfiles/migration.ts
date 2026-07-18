// Migration for the Smart Random Profiles domain — its own localStorage key,
// deliberately independent of sessionMigration.ts and
// src/lib/trainingPlans/migration.ts (same posture as
// src/lib/accuracyToleranceProfiles/migration.ts). Malformed profile data must
// never invalidate Sessions or Training Plans — this module only ever touches
// its own persisted state.
import { isSmartRandomAvailable, validateSmartRandomRange } from "../variableTargets";
import type { MeasurementMode } from "../../types";
import {
  SMART_RANDOM_PROFILES_SCHEMA_VERSION,
  createEmptySmartRandomProfilesState,
  type SmartRandomProfile,
  type SmartRandomProfilesState,
} from "./persistence";

const VALID_MEASUREMENT_MODES: MeasurementMode[] = ["back-hog", "hog-hog"];

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function migrateProfile(raw: unknown): SmartRandomProfile | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.id !== "string" || !raw.id) return undefined;
  if (typeof raw.name !== "string" || !raw.name.trim()) return undefined;
  if (!VALID_MEASUREMENT_MODES.includes(raw.measurementMode as MeasurementMode)) {
    return undefined;
  }
  // An unknown future Measurement Mode Smart Random gains support for later,
  // or one that never had it, both stay non-applicable rather than being
  // silently coerced into a fabricated-valid combination.
  if (!isSmartRandomAvailable(raw.measurementMode as MeasurementMode)) {
    return undefined;
  }
  if (typeof raw.min !== "number" || typeof raw.max !== "number") return undefined;
  const rangeValidation = validateSmartRandomRange(raw.min, raw.max);
  if (!rangeValidation.valid) return undefined;
  if (typeof raw.createdAt !== "string" || typeof raw.updatedAt !== "string") {
    return undefined;
  }

  return {
    id: raw.id,
    name: raw.name.trim(),
    measurementMode: raw.measurementMode as MeasurementMode,
    min: rangeValidation.min,
    max: rangeValidation.max,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

/**
 * Unknown/future schemaVersion, or any structurally broken top-level shape,
 * resolves to a safe, empty state — never guess-migrated, same rule as
 * src/lib/accuracyToleranceProfiles/migration.ts. A single structurally
 * invalid profile is dropped (quarantine style); it never invalidates the rest
 * of the list. A `defaultProfileId` that no longer resolves to a real,
 * surviving profile is cleared to `null` rather than left dangling.
 * Idempotent: migrating an already-migrated state twice is a no-op. Legacy
 * installations with no Smart Random Profile storage at all (raw === null)
 * resolve to an empty state, same as every other independent persisted
 * domain in this project — Sessions/Training Plans are entirely unaffected,
 * since this module never reads or writes their storage keys.
 */
export function migrateSmartRandomProfilesState(
  raw: unknown
): SmartRandomProfilesState {
  if (!isRecord(raw)) return createEmptySmartRandomProfilesState();
  if (raw.schemaVersion !== SMART_RANDOM_PROFILES_SCHEMA_VERSION) {
    return createEmptySmartRandomProfilesState();
  }

  const rawProfiles = Array.isArray(raw.profiles) ? raw.profiles : [];

  const profiles = rawProfiles
    .map((profile) => {
      try {
        return migrateProfile(profile);
      } catch {
        return undefined;
      }
    })
    .filter((profile): profile is SmartRandomProfile => profile !== undefined);

  const rawDefaultProfileId = raw.defaultProfileId;
  const defaultProfileId =
    typeof rawDefaultProfileId === "string" &&
    profiles.some((profile) => profile.id === rawDefaultProfileId)
      ? rawDefaultProfileId
      : null;

  return {
    schemaVersion: SMART_RANDOM_PROFILES_SCHEMA_VERSION,
    profiles,
    defaultProfileId,
  };
}
