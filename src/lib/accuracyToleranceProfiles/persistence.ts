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
import type { MeasuredQuantity, QuantityTolerance } from "../../types";
export type AccuracyToleranceProfile = {
  id: string;
  name: string;
  /**
   * Which measured quantity this template's numbers are expressed in, and therefore
   * which unit they carry — seconds for "time", m/s for "speed". A template is only
   * ever offered for a block measuring the SAME quantity; the two units are never
   * interchangeable and a time preset is never reinterpreted as a speed preset
   * (ADR-0051). Every template stored before schema version 2 is a time template.
   */
  quantity: MeasuredQuantity;
  /**
   * Per-side bands in that quantity's own unit. The single authoritative
   * representation — there is no second symmetric pair that could disagree with it.
   * Every template stored before schema version 2 migrates to the symmetric tolerance
   * its seconds pair always meant, with its meaning completely unchanged.
   */
  tolerance: QuantityTolerance;
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
/**
 * Version 1 stored a symmetric, unitless `{ onTarget, acceptable }` seconds pair.
 * Version 2 stores an explicit quantity plus a per-side tolerance. Version 1 data is
 * migrated forward losslessly (see migration.ts) — never wiped, and never
 * reinterpreted as anything other than the time template it always was.
 */
export const ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION = 2;
export const LEGACY_ACCURACY_TOLERANCE_PROFILES_SCHEMA_VERSION = 1;

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
