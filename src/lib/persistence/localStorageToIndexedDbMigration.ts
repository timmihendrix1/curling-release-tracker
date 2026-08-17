// Resumable, per-domain copy migration from the localStorage-backed StorageAdapter into
// IndexedDB — Phase 2, Stage 3. See
// docs/adr/0016-resumable-localstorage-to-indexeddb-copy-migration.md.
//
// This module is a mechanism, not a policy: it copies exact serialized strings from an
// injected source StorageAdapter into an injected IndexedDbMigrationTarget, key by key,
// domain by domain, and never interprets, parses, repairs, or reserializes anything —
// that stays the exclusive job of each domain's existing repository and migration
// function, applied when the copied value is actually read later. Nothing in this file
// is invoked by any repository singleton or component (enforced by
// src/lib/persistence/__tests__/architectureBoundary.test.ts) — localStorage remains
// the sole production source of truth. Running this migration is not, by itself,
// activation: no source-of-truth switch, dual write, or fallback read exists anywhere
// in this codebase yet.
import type { PersistenceReadError, PersistenceWriteError, StorageAdapter } from "./types";
import type {
  IndexedDbMigrationDomainSnapshot,
  IndexedDbMigrationTarget,
} from "./indexedDbAdapter";

import {
  CURRENT_SESSION_STORAGE_KEY,
  SESSION_HISTORY_STORAGE_KEY,
} from "../sessionRepository";
import { HISTORY_FILTERS_STORAGE_KEY } from "../historyFiltersRepository";
import { ASSESSMENT_STORAGE_KEY } from "../assessment/persistence";
import { TRAINING_PLANS_STORAGE_KEY } from "../trainingPlans/persistence";
import { ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY } from "../accuracyToleranceProfiles/persistence";
import { SMART_RANDOM_PROFILES_STORAGE_KEY } from "../smartRandomProfiles/persistence";
import {
  LAST_CUSTOM_THRESHOLD_KEY,
  LAST_THRESHOLD_PRESET_KEY,
  SHOW_INTRODUCTION_KEY,
} from "../assessmentPreferencesRepository";

export type MigrationDomainId =
  | "session"
  | "historyFilters"
  | "assessment"
  | "trainingPlans"
  | "accuracyToleranceProfiles"
  | "smartRandomProfiles"
  | "assessmentPreferences";

interface MigrationDomainDescriptor {
  id: MigrationDomainId;
  sourceKeys: readonly string[];
}

/**
 * The seven domains covering all ten existing storage keys, in the one, fixed,
 * deterministic order this migration always processes them in — see ADR-0016. Every
 * key here is an existing exported repository constant; none is duplicated as a
 * literal string.
 */
export const MIGRATION_DOMAINS: readonly MigrationDomainDescriptor[] = [
  { id: "session", sourceKeys: [CURRENT_SESSION_STORAGE_KEY, SESSION_HISTORY_STORAGE_KEY] },
  { id: "historyFilters", sourceKeys: [HISTORY_FILTERS_STORAGE_KEY] },
  { id: "assessment", sourceKeys: [ASSESSMENT_STORAGE_KEY] },
  { id: "trainingPlans", sourceKeys: [TRAINING_PLANS_STORAGE_KEY] },
  {
    id: "accuracyToleranceProfiles",
    sourceKeys: [ACCURACY_TOLERANCE_PROFILES_STORAGE_KEY],
  },
  { id: "smartRandomProfiles", sourceKeys: [SMART_RANDOM_PROFILES_STORAGE_KEY] },
  {
    id: "assessmentPreferences",
    sourceKeys: [SHOW_INTRODUCTION_KEY, LAST_THRESHOLD_PRESET_KEY, LAST_CUSTOM_THRESHOLD_KEY],
  },
];

export type MigrationFailureStage = "marker_read" | "source_read" | "target_commit";

/** One unified, classified error shape across all three failure stages — a plain
 * read/write storage failure (reused from the existing StorageAdapter error types) or a
 * fail-closed metadata problem (`invalid_marker`), never a raw exception. */
export type MigrationDomainError =
  | PersistenceReadError
  | PersistenceWriteError
  | { kind: "invalid_marker"; reason: string };

export interface MigrationFailure {
  domain: MigrationDomainId;
  stage: MigrationFailureStage;
  error: MigrationDomainError;
}

export interface MigrationRunResult {
  /** Domains this run itself newly copied and marked complete. */
  completedDomains: MigrationDomainId[];
  /** Domains found already complete (via a valid marker) and skipped without reading
   * the source, including a domain another concurrent run completed first. */
  alreadyCompleteDomains: MigrationDomainId[];
  /** The first domain that failed, if any — processing always stops there. `null`
   * means every domain reached either `completedDomains` or `alreadyCompleteDomains`. */
  failedDomain: MigrationFailure | null;
}

export interface MigrationRunOptions {
  /** The existing localStorage-backed (or equivalent) StorageAdapter to copy from.
   * Only ever read — this migration never calls `source.set` and never mutates it. */
  source: StorageAdapter;
  /** The IndexedDB migration-control interface to copy into. */
  target: IndexedDbMigrationTarget;
}

/**
 * Runs the copy migration once, processing `MIGRATION_DOMAINS` in order. Safe to call
 * repeatedly (idempotent) and safe to call concurrently with itself (the target's own
 * per-domain transaction is what makes concurrent commits of the same domain safe — see
 * `IndexedDbMigrationTarget.commitDomainSnapshot`'s doc comment). Never invokes any
 * domain repository's save method, and never reads a domain's source keys once that
 * domain's marker already reports it complete.
 */
export async function runLocalStorageToIndexedDbMigration(
  options: MigrationRunOptions
): Promise<MigrationRunResult> {
  const { source, target } = options;
  const completedDomains: MigrationDomainId[] = [];
  const alreadyCompleteDomains: MigrationDomainId[] = [];

  for (const { id: domain, sourceKeys } of MIGRATION_DOMAINS) {
    const markerResult = await target.readDomainMarker(domain, sourceKeys);

    if (markerResult.status === "read_failed") {
      return {
        completedDomains,
        alreadyCompleteDomains,
        failedDomain: { domain, stage: "marker_read", error: markerResult.error },
      };
    }
    if (markerResult.status === "invalid") {
      return {
        completedDomains,
        alreadyCompleteDomains,
        failedDomain: {
          domain,
          stage: "marker_read",
          error: { kind: "invalid_marker", reason: markerResult.reason },
        },
      };
    }
    if (markerResult.status === "complete") {
      // Already migrated — skip the source entirely, for this and every prior run.
      alreadyCompleteDomains.push(domain);
      continue;
    }

    // status === "absent": read every source key for this domain before attempting
    // any target write — a partial domain must never be committed.
    const records: Array<{ key: string; value: string | null }> = [];
    let sourceReadFailure: PersistenceReadError | null = null;
    for (const key of sourceKeys) {
      const readResult = await source.get(key);
      if (readResult.status === "read_failed") {
        sourceReadFailure = readResult.error;
        break;
      }
      records.push({ key, value: readResult.value });
    }
    if (sourceReadFailure) {
      return {
        completedDomains,
        alreadyCompleteDomains,
        failedDomain: { domain, stage: "source_read", error: sourceReadFailure },
      };
    }

    const snapshot: IndexedDbMigrationDomainSnapshot = { domain, sourceKeys, records };
    const commitResult = await target.commitDomainSnapshot(snapshot);

    if (commitResult.status === "already_complete") {
      // A concurrent run committed this domain between our marker check and our own
      // commit attempt — safe, not a failure.
      alreadyCompleteDomains.push(domain);
      continue;
    }
    if (commitResult.status === "invalid_marker") {
      return {
        completedDomains,
        alreadyCompleteDomains,
        failedDomain: {
          domain,
          stage: "target_commit",
          error: { kind: "invalid_marker", reason: commitResult.reason },
        },
      };
    }
    if (commitResult.status === "failed") {
      return {
        completedDomains,
        alreadyCompleteDomains,
        failedDomain: { domain, stage: "target_commit", error: commitResult.error },
      };
    }

    completedDomains.push(domain);
  }

  return { completedDomains, alreadyCompleteDomains, failedDomain: null };
}
