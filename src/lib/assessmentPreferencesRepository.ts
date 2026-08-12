// AssessmentPreferencesRepository — owns the three small, independent Assess-flow UI
// preference keys. No shared root, no migration function, no schema version — see
// docs/PERSISTENCE_BOUNDARY_DESIGN.md §4.A.2 and §5.7 for why this grouping is still
// correct (code-organization only; each key stays independently stored). Replaces
// src/lib/assessmentPreferences.ts's direct `localStorage` calls — this repository is
// the only file permitted to reference `localStorage` for these three keys (via the
// shared StorageAdapter).
//
// Deliberately exempt from the hydration gate (docs/PERSISTENCE_BOUNDARY_DESIGN.md §7.6):
// these are read on demand from AssessScreen.tsx at arbitrary interaction points, never
// from an always-on mount/save effect pair, so there is no "write_protected" concept for
// this repository — a read_failed result here only means this specific call is
// provisional.
import type { AccuracyThresholdPreset } from "./accuracyThresholds";
import type { AccuracyThresholds } from "../types";
import { localStorageAdapter } from "./persistence/localStorageAdapter";
import type {
  DomainLoadResult,
  PersistenceWriteResult,
  StorageAdapter,
} from "./persistence/types";
import { loadedAbsent, loadedValue, loadFailed } from "./persistence/types";

export const SHOW_INTRODUCTION_KEY = "curling-release-tracker-assessment-show-introduction";
export const LAST_THRESHOLD_PRESET_KEY =
  "curling-release-tracker-assessment-last-threshold-preset";
export const LAST_CUSTOM_THRESHOLD_KEY =
  "curling-release-tracker-assessment-last-custom-threshold";

const VALID_PRESETS: AccuracyThresholdPreset[] = ["standard", "tight", "custom"];

export interface AssessmentPreferencesRepository {
  getShowIntroduction(): Promise<DomainLoadResult<boolean>>;
  setShowIntroduction(show: boolean): Promise<PersistenceWriteResult>;
  getLastThresholdPreset(): Promise<DomainLoadResult<AccuracyThresholdPreset>>;
  setLastThresholdPreset(preset: AccuracyThresholdPreset): Promise<PersistenceWriteResult>;
  getLastCustomThreshold(): Promise<DomainLoadResult<AccuracyThresholds | null>>;
  setLastCustomThreshold(values: AccuracyThresholds): Promise<PersistenceWriteResult>;
}

export function createAssessmentPreferencesRepository(
  adapter: StorageAdapter = localStorageAdapter
): AssessmentPreferencesRepository {
  return {
    async getShowIntroduction(): Promise<DomainLoadResult<boolean>> {
      const result = await adapter.get(SHOW_INTRODUCTION_KEY);
      if (result.status === "read_failed") {
        return loadFailed<boolean>(true, result.error);
      }
      if (result.value === null) {
        return loadedAbsent<boolean>();
      }
      // Not a "repair to default" situation — an unrecognized stored string (anything
      // other than the literal "true") evaluates to false, exactly as today.
      return loadedValue(result.value === "true");
    },

    async setShowIntroduction(show: boolean): Promise<PersistenceWriteResult> {
      return adapter.set(SHOW_INTRODUCTION_KEY, show ? "true" : "false");
    },

    async getLastThresholdPreset(): Promise<DomainLoadResult<AccuracyThresholdPreset>> {
      const result = await adapter.get(LAST_THRESHOLD_PRESET_KEY);
      if (result.status === "read_failed") {
        return loadFailed<AccuracyThresholdPreset>("standard", result.error);
      }
      if (result.value === null) {
        return loadedAbsent<AccuracyThresholdPreset>();
      }
      const preset = VALID_PRESETS.includes(result.value as AccuracyThresholdPreset)
        ? (result.value as AccuracyThresholdPreset)
        : "standard";
      return loadedValue(preset);
    },

    async setLastThresholdPreset(
      preset: AccuracyThresholdPreset
    ): Promise<PersistenceWriteResult> {
      return adapter.set(LAST_THRESHOLD_PRESET_KEY, preset);
    },

    async getLastCustomThreshold(): Promise<DomainLoadResult<AccuracyThresholds | null>> {
      const result = await adapter.get(LAST_CUSTOM_THRESHOLD_KEY);
      if (result.status === "read_failed") {
        return loadFailed<AccuracyThresholds | null>(null, result.error);
      }
      // `!raw` (absent or empty string) is treated as absent today — preserved exactly.
      if (!result.value) {
        return loadedAbsent<AccuracyThresholds | null>();
      }
      try {
        const parsed = JSON.parse(result.value);
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          typeof parsed.onTarget === "number" &&
          typeof parsed.acceptable === "number"
        ) {
          return loadedValue<AccuracyThresholds | null>({
            onTarget: parsed.onTarget,
            acceptable: parsed.acceptable,
          });
        }
        return loadedValue<AccuracyThresholds | null>(null);
      } catch {
        return loadedValue<AccuracyThresholds | null>(null);
      }
    },

    async setLastCustomThreshold(values: AccuracyThresholds): Promise<PersistenceWriteResult> {
      return adapter.set(LAST_CUSTOM_THRESHOLD_KEY, JSON.stringify(values));
    },
  };
}

export const assessmentPreferencesRepository: AssessmentPreferencesRepository =
  createAssessmentPreferencesRepository();
