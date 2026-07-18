// Smart Random Profiles — a small, independent persisted domain, its own
// localStorage key and schema version, deliberately not coupled to Session/
// sessionMigration.ts or src/lib/trainingPlans/persistence.ts (same posture as
// src/lib/accuracyToleranceProfiles/). A profile is a reusable configuration
// aid — it helps *select* a Smart Random range. It is never itself the
// authoritative value a Training Block or Training Plan Step generates targets
// from; those always store the actual `smartRandomMin`/`smartRandomMax` numbers
// (see src/lib/variableTargets.ts). No localStorage access happens in this
// file — these are pure state-shape functions; TrackerApp.tsx performs the
// actual read/write calls, following the same one-effect-per-key pattern
// already used for Session/Assessment/Training Plan/Accuracy Tolerance Profile
// data.
import type { MeasurementMode } from "../../types";
import type { SmartRandomRange } from "../variableTargets";

// Reuses the exact existing SmartRandomRange shape ({ min, max }) rather than
// inventing new field names for the same concept (`smartRandomMin`/`Max`'s
// bare-range form) — see docs/SYSTEM_ARCHITECTURE.md's "Smart Random Profiles"
// section.
export type SmartRandomProfile = SmartRandomRange & {
  id: string;
  name: string;
  // Stored so an invalid configuration (e.g. a future Hog-Hog profile) can
  // never be silently applied in the wrong measurement context — see
  // isSmartRandomAvailable. Version 1 only ever accepts "back-hog" here,
  // since Smart Random has no validated Hog-Hog range.
  measurementMode: MeasurementMode;
  createdAt: string;
  updatedAt: string;
};

// One authoritative default reference, rather than every profile independently
// carrying its own conflicting "isDefault" flag. Version 1 only needs one
// reference (not a per-Measurement-Mode map) because Smart Random is only ever
// available for one Measurement Mode today.
export type SmartRandomProfilesState = {
  schemaVersion: number;
  profiles: SmartRandomProfile[];
  defaultProfileId: string | null;
};

export const SMART_RANDOM_PROFILES_STORAGE_KEY =
  "curling-release-tracker-smart-random-profiles";
export const SMART_RANDOM_PROFILES_SCHEMA_VERSION = 1;

export function createEmptySmartRandomProfilesState(): SmartRandomProfilesState {
  return {
    schemaVersion: SMART_RANDOM_PROFILES_SCHEMA_VERSION,
    profiles: [],
    defaultProfileId: null,
  };
}

export function serializeSmartRandomProfilesState(
  state: SmartRandomProfilesState
): string {
  return JSON.stringify(state);
}
