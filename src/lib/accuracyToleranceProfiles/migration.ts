// Migration for the Accuracy Tolerance Profiles domain — its own localStorage key,
// deliberately independent of sessionMigration.ts and src/lib/trainingPlans/migration.ts
// (see docs/TECHNICAL_DEBT_AND_ROADMAP.md). Malformed profile data must never
// invalidate Sessions or Training Plans — this module only ever touches its own
// persisted state.
import { validateAccuracyThresholds } from "../accuracyThresholds";
import { isMeasuredQuantity } from "../measurement/quantities";
import {
  symmetricTolerance,
  validateQuantityTolerance,
} from "../measurement/tolerance";
import {
  ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
  createEmptyAccuracyToleranceProfilesState,
  LEGACY_ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
  type AccuracyToleranceProfile,
  type AccuracyToleranceProfilesState,
} from "./persistence";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

/**
 * A version-1 template: a symmetric, unitless `{ onTarget, acceptable }` seconds pair.
 * It is re-expressed as an explicit TIME template with the symmetric per-side
 * tolerance it always meant — the numbers and their meaning are untouched, and it is
 * never reinterpreted as a speed preset.
 */
function migrateLegacyProfile(
  raw: Record<string, unknown>
): AccuracyToleranceProfile | undefined {
  if (typeof raw.onTarget !== "number" || typeof raw.acceptable !== "number") {
    return undefined;
  }
  const thresholds = validateAccuracyThresholds(raw.onTarget, raw.acceptable);
  if (!thresholds.valid) return undefined;

  return {
    id: raw.id as string,
    name: (raw.name as string).trim(),
    quantity: "time",
    tolerance: symmetricTolerance(thresholds.onTarget, thresholds.acceptable),
    createdAt: raw.createdAt as string,
    updatedAt: raw.updatedAt as string,
  };
}

function migrateProfile(
  raw: unknown,
  sourceSchemaVersion: number
): AccuracyToleranceProfile | undefined {
  if (!isRecord(raw)) return undefined;
  if (typeof raw.id !== "string" || !raw.id) return undefined;
  if (typeof raw.name !== "string" || !raw.name.trim()) return undefined;
  if (typeof raw.createdAt !== "string" || typeof raw.updatedAt !== "string") {
    return undefined;
  }

  if (sourceSchemaVersion === LEGACY_ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION) {
    return migrateLegacyProfile(raw);
  }

  // Version 2 and later: the quantity and its per-side tolerance are explicit and are
  // never defaulted. A template whose unit this build does not know is DROPPED rather
  // than silently treated as seconds, which would change what its numbers mean.
  if (!isMeasuredQuantity(raw.quantity)) return undefined;

  const tolerance = validateQuantityTolerance(
    raw.tolerance as AccuracyToleranceProfile["tolerance"] | undefined
  );
  if (!tolerance.valid) return undefined;

  return {
    id: raw.id,
    name: raw.name.trim(),
    quantity: raw.quantity,
    tolerance: tolerance.tolerance,
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
  // Version 1 is migrated forward losslessly rather than wiped; anything else unknown
  // (a future version) still resolves to the safe empty state.
  if (
    raw.schemaVersion !== ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION &&
    raw.schemaVersion !== LEGACY_ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION
  ) {
    return createEmptyAccuracyToleranceProfilesState();
  }

  const sourceSchemaVersion = raw.schemaVersion as number;
  const rawProfiles = Array.isArray(raw.profiles) ? raw.profiles : [];

  const profiles = rawProfiles
    .map((profile) => {
      try {
        return migrateProfile(profile, sourceSchemaVersion);
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
