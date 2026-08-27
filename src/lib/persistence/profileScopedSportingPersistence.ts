import {
  accuracyToleranceProfilesRepository,
  createAccuracyToleranceProfilesRepository,
} from "../accuracyToleranceProfiles/repository";
import { ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY } from "../accuracyToleranceProfiles/persistence";
import { assessmentRepository, createAssessmentRepository } from "../assessment/repository";
import {
  ASSESSMENT_DRAFT_STORAGE_KEY,
  ASSESSMENT_HISTORY_STORAGE_KEY,
  ASSESSMENT_STORAGE_KEY,
} from "../assessment/persistence";
import {
  assessmentPreferencesRepository,
  createAssessmentPreferencesRepository,
  LAST_CUSTOM_THRESHOLD_KEY,
  LAST_THRESHOLD_PRESET_KEY,
  SHOW_INTRODUCTION_KEY,
} from "../assessmentPreferencesRepository";
import {
  createHistoryFiltersRepository,
  HISTORY_FILTERS_STORAGE_KEY,
  historyFiltersRepository,
} from "../historyFiltersRepository";
import { isCanonicalUuid } from "../uuid";
import {
  createSessionRepository,
  CURRENT_SESSION_STORAGE_KEY,
  sessionRepository,
  SESSION_HISTORY_STORAGE_KEY,
} from "../sessionRepository";
import { SMART_RANDOM_PROFILES_STORAGE_KEY } from "../smartRandomProfiles/persistence";
import {
  createSmartRandomProfilesRepository,
  smartRandomProfilesRepository,
} from "../smartRandomProfiles/repository";
import { TRAINING_PLANS_STORAGE_KEY } from "../trainingPlans/persistence";
import {
  createTrainingPlansRepository,
  trainingPlansRepository,
} from "../trainingPlans/repository";
import { localStorageAdapter } from "./localStorageAdapter";
import type {
  PersistenceWriteResult,
  RemovableStorageAdapter,
  StorageAdapter,
  StorageGetResult,
} from "./types";
import { CLOUD_SPORTING_SYNC_STORAGE_KEY } from "../cloudSporting/syncStateRepository";

/**
 * The complete, closed set of legacy identity-unscoped sporting keys. B0.3 retires
 * exactly these keys and no others. Keeping the list next to the scoped adapter makes
 * additions reviewable: a new sporting repository cannot accidentally remain global.
 */
export const SPORTING_STORAGE_KEYS = [
  CURRENT_SESSION_STORAGE_KEY,
  SESSION_HISTORY_STORAGE_KEY,
  HISTORY_FILTERS_STORAGE_KEY,
  ASSESSMENT_STORAGE_KEY,
  TRAINING_PLANS_STORAGE_KEY,
  ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY,
  SMART_RANDOM_PROFILES_STORAGE_KEY,
  SHOW_INTRODUCTION_KEY,
  LAST_THRESHOLD_PRESET_KEY,
  LAST_CUSTOM_THRESHOLD_KEY,
] as const;

export type SportingStorageKey = (typeof SPORTING_STORAGE_KEYS)[number];

const PROFILE_SCOPED_SPORTING_STORAGE_KEYS = [
  ...SPORTING_STORAGE_KEYS,
  ASSESSMENT_DRAFT_STORAGE_KEY,
  ASSESSMENT_HISTORY_STORAGE_KEY,
  CLOUD_SPORTING_SYNC_STORAGE_KEY,
] as const;
const SPORTING_STORAGE_KEY_SET: ReadonlySet<string> = new Set(PROFILE_SCOPED_SPORTING_STORAGE_KEYS);
const PROFILE_NAMESPACE_PREFIX = "curling.sporting.profile.v1";

export const LEGACY_SPORTING_RETIREMENT_MARKER_KEY =
  "curling.sporting.legacy-unscoped-retired.v1";
const LEGACY_SPORTING_RETIREMENT_MARKER_VALUE = "complete";

const INVALID_SCOPE_MESSAGE = "The sporting persistence scope is invalid.";
const INVALID_KEY_MESSAGE = "The sporting persistence key is not registered.";

export function profileScopedSportingStorageKey(
  profileId: string,
  key: SportingStorageKey
): string {
  if (!isCanonicalUuid(profileId)) throw new Error(INVALID_SCOPE_MESSAGE);
  if (!SPORTING_STORAGE_KEY_SET.has(key)) throw new Error(INVALID_KEY_MESSAGE);
  return `${PROFILE_NAMESPACE_PREFIX}.${profileId}.${key}`;
}

/**
 * Creates an immutable adapter namespace for exactly one application Profile.
 *
 * The adapter never has a mutable "current profile" pointer. That is the important
 * safety property: a delayed write started by Profile A retains A's physical key even
 * if the React tree has already switched to Profile B.
 */
export function createProfileScopedSportingStorageAdapter(
  profileId: string,
  adapter: StorageAdapter = localStorageAdapter
): StorageAdapter {
  if (!isCanonicalUuid(profileId)) throw new Error(INVALID_SCOPE_MESSAGE);

  function scopedKey(key: string): string | null {
    if (!SPORTING_STORAGE_KEY_SET.has(key)) return null;
    return `${PROFILE_NAMESPACE_PREFIX}.${profileId}.${key}`;
  }

  return Object.freeze({
    async get(key: string): Promise<StorageGetResult> {
      const physicalKey = scopedKey(key);
      if (physicalKey === null) {
        return {
          status: "read_failed",
          fallback: null,
          error: { kind: "unknown", message: INVALID_KEY_MESSAGE },
        };
      }
      return adapter.get(physicalKey);
    },

    async set(key: string, value: string): Promise<PersistenceWriteResult> {
      const physicalKey = scopedKey(key);
      if (physicalKey === null) {
        return { ok: false, error: { kind: "unknown", message: INVALID_KEY_MESSAGE } };
      }
      return adapter.set(physicalKey, value);
    },
  });
}

export type SportingRepositories = Readonly<{
  session: ReturnType<typeof createSessionRepository>;
  historyFilters: ReturnType<typeof createHistoryFiltersRepository>;
  assessment: ReturnType<typeof createAssessmentRepository>;
  trainingPlans: ReturnType<typeof createTrainingPlansRepository>;
  accuracyToleranceProfiles: ReturnType<typeof createAccuracyToleranceProfilesRepository>;
  smartRandomProfiles: ReturnType<typeof createSmartRandomProfilesRepository>;
  assessmentPreferences: ReturnType<typeof createAssessmentPreferencesRepository>;
}>;

export function createProfileScopedSportingRepositories(
  profileId: string,
  adapter: StorageAdapter = localStorageAdapter
): SportingRepositories {
  const scopedAdapter = createProfileScopedSportingStorageAdapter(profileId, adapter);
  return Object.freeze({
    session: createSessionRepository(scopedAdapter),
    historyFilters: createHistoryFiltersRepository(scopedAdapter),
    assessment: createAssessmentRepository(scopedAdapter),
    trainingPlans: createTrainingPlansRepository(scopedAdapter),
    accuracyToleranceProfiles: createAccuracyToleranceProfilesRepository(scopedAdapter),
    smartRandomProfiles: createSmartRandomProfilesRepository(scopedAdapter),
    assessmentPreferences: createAssessmentPreferencesRepository(scopedAdapter),
  });
}

/** Explicit test seam for existing component tests. Never use in production composition. */
export function createUnscopedSportingRepositoriesForTests(): SportingRepositories {
  return Object.freeze({
    session: sessionRepository,
    historyFilters: historyFiltersRepository,
    assessment: assessmentRepository,
    trainingPlans: trainingPlansRepository,
    accuracyToleranceProfiles: accuracyToleranceProfilesRepository,
    smartRandomProfiles: smartRandomProfilesRepository,
    assessmentPreferences: assessmentPreferencesRepository,
  });
}

export type LegacySportingRetirementResult =
  | { ok: true; status: "already_retired" | "retired" }
  | {
      ok: false;
      reason: "marker_read_failed" | "legacy_removal_failed" | "marker_write_failed";
    };

/**
 * Retires the disposable early-test workspace without ever reading, parsing, adopting,
 * assigning or copying its contents. The completed marker is written only after every
 * one of the ten bounded removals succeeds. Partial/interrupted work is therefore
 * safely retried; removing an already-absent key is idempotent.
 */
export async function retireLegacyUnscopedSportingData(
  adapter: RemovableStorageAdapter = localStorageAdapter
): Promise<LegacySportingRetirementResult> {
  let marker: Awaited<ReturnType<RemovableStorageAdapter["get"]>>;
  try {
    marker = await adapter.get(LEGACY_SPORTING_RETIREMENT_MARKER_KEY);
  } catch {
    return { ok: false, reason: "marker_read_failed" };
  }

  if (marker.status === "read_failed") {
    return { ok: false, reason: "marker_read_failed" };
  }
  if (marker.value === LEGACY_SPORTING_RETIREMENT_MARKER_VALUE) {
    return { ok: true, status: "already_retired" };
  }

  let removalFailed = false;
  for (const key of SPORTING_STORAGE_KEYS) {
    try {
      const result = await adapter.remove(key);
      if (!result.ok) removalFailed = true;
    } catch {
      removalFailed = true;
    }
  }
  if (removalFailed) return { ok: false, reason: "legacy_removal_failed" };

  try {
    const result = await adapter.set(
      LEGACY_SPORTING_RETIREMENT_MARKER_KEY,
      LEGACY_SPORTING_RETIREMENT_MARKER_VALUE
    );
    return result.ok
      ? { ok: true, status: "retired" }
      : { ok: false, reason: "marker_write_failed" };
  } catch {
    return { ok: false, reason: "marker_write_failed" };
  }
}
