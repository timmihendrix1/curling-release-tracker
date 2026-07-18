// Migration for the Accuracy Tolerance Profiles domain — its own localStorage key,
// deliberately independent of sessionMigration.ts and src/lib/trainingPlans/migration.ts
// (see docs/TECHNICAL_DEBT_AND_ROADMAP.md). Malformed profile data must never
// invalidate Sessions or Training Plans — this module only ever touches its own
// persisted state.
import { validateAccuracyThresholds } from "../accuracyThresholds";
import {
  ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
  createEmptyAccuracyToleranceProfilesState,
  type AccuracyToleranceProfile,
  type AccuracyToleranceProfilesState,
} from "./persistence";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function migrateProfile(raw: unknown): AccuracyToleranceProfile | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.id !== "string" || !raw.id) return undefined;
  if (typeof raw.name !== "string" || !raw.name.trim()) return undefined;
  if (typeof raw.onTarget !== "number" || typeof raw.acceptable !== "number") {
    return undefined;
  }
  if (!validateAccuracyThresholds(raw.onTarget, raw.acceptable).valid) {
    return undefined;
  }
  if (typeof raw.createdAt !== "string" || typeof raw.updatedAt !== "string") {
    return undefined;
  }

  return {
    id: raw.id,
    name: raw.name.trim(),
    onTarget: raw.onTarget,
    acceptable: raw.acceptable,
    createdAt: raw.createdAt,
    updatedAt: raw.updatedAt,
  };
}

/**
 * Unknown/future schemaVersion, or any structurally broken top-level shape,
 * resolves to a safe, empty state — never guess-migrated, same rule as
 * src/lib/trainingPlans/migration.ts and src/lib/assessment/migration.ts. A single
 * structurally invalid profile is dropped (quarantine style); it never invalidates
 * the rest of the list — a profile has no cross-field invariants worth a
 * field-by-field repair. A `defaultProfileId` that no longer resolves to a real,
 * surviving profile is cleared to `null` rather than left dangling. Idempotent:
 * migrating an already-migrated state twice is a no-op.
 */
export function migrateAccuracyToleranceProfilesState(
  raw: unknown
): AccuracyToleranceProfilesState {
  if (!isRecord(raw)) return createEmptyAccuracyToleranceProfilesState();
  if (raw.schemaVersion !== ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION) {
    return createEmptyAccuracyToleranceProfilesState();
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
    .filter((profile): profile is AccuracyToleranceProfile => profile !== undefined);

  const rawDefaultProfileId = raw.defaultProfileId;
  const defaultProfileId =
    typeof rawDefaultProfileId === "string" &&
    profiles.some((profile) => profile.id === rawDefaultProfileId)
      ? rawDefaultProfileId
      : null;

  return {
    schemaVersion: ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
    profiles,
    defaultProfileId,
  };
}
