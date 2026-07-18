// Accuracy Tolerance Profiles — a small, independent persisted domain, its own
// localStorage key and schema version, deliberately not coupled to Session/
// sessionMigration.ts or Training Plans' own persistence (see
// docs/TECHNICAL_DEBT_AND_ROADMAP.md and docs/SYSTEM_ARCHITECTURE.md's
// "Accuracy Tolerance Profiles" section). A profile is a reusable configuration
// aid — it helps *select* On Target / Acceptable values. It is never itself the
// authoritative value a Session, Training Block, or Training Plan Step judges a
// shot against; those always store the actual numeric values used (see
// src/lib/accuracyThresholds.ts's AccuracyThresholds, ADR-0008). No localStorage
// access happens in this file — these are pure state-shape functions;
// TrackerApp.tsx performs the actual read/write calls, following the same
// one-effect-per-key pattern already used for Session/Assessment/Training Plan data.
export type AccuracyToleranceProfile = {
  id: string;
  name: string;
  onTarget: number;
  acceptable: number;
  createdAt: string;
  updatedAt: string;
};

// One authoritative default reference, rather than every profile independently
// carrying its own conflicting "isDefault" flag — there is exactly one place a
// dangling/removed default can go wrong (this field), not N places.
export type AccuracyToleranceProfilesState = {
  schemaVersion: number;
  profiles: AccuracyToleranceProfile[];
  defaultProfileId: string | null;
};

export const ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY =
  "curling-release-tracker-accuracy-tolerance-profiles";
export const ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION = 1;

export function createEmptyAccuracyToleranceProfilesState(): AccuracyToleranceProfilesState {
  return {
    schemaVersion: ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION,
    profiles: [],
    defaultProfileId: null,
  };
}

export function serializeAccuracyToleranceProfilesState(
  state: AccuracyToleranceProfilesState
): string {
  return JSON.stringify(state);
}
