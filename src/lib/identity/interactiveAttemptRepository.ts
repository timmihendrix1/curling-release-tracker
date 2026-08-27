// Persistence for the `InteractiveAuthAttempt` (ADR-0025 §7, §19; Stage B0.2c).
//
// Removal here is **best-effort cleanup of an already non-current record, and
// nothing else**. ADR-0025 §7 is explicit that the current attempt is NOT removed
// while the correlation set is active — removing it would make the resolution
// unverifiable and lock the user out permanently — and that cleanup can never
// affect authorization.
//
// That rule is enforced by this module rather than trusted to callers:
// `cleanUpNonCurrentAttempt` takes the CURRENT `barrierId`, reads the stored
// attempt first, and **refuses** to remove one that is bound to it. A caller
// cannot ask this repository to delete the current attempt, and a cleanup failure
// resolves a closed outcome that no authorization decision reads.

import { localStorageAdapter } from "../persistence/localStorageAdapter";
import type { PersistenceWriteResult, RemovableStorageAdapter } from "../persistence/types";
import type { IdentityRecordLoad } from "./errors";
import {
  INTERACTIVE_ATTEMPT_STORAGE_KEY,
  validateInteractiveAuthAttempt,
  type InteractiveAuthAttempt,
} from "./interactiveAttempt";
import { readIdentityRecord, removeIdentityRecord, writeIdentityRecord } from "./untrustedValue";

/**
 * The closed result of a best-effort cleanup. Every member is informational:
 * **no authorization decision reads any of them.**
 */
export type AttemptCleanupOutcome =
  /** A non-current attempt was removed. */
  | { kind: "removed" }
  /** Nothing was stored, so there was nothing to clean. */
  | { kind: "nothing_to_clean" }
  /** The stored attempt is bound to the CURRENT barrier. Refused — removing it
   * would make the current correlation set unverifiable. */
  | { kind: "retained_current" }
  /** Storage could not be read, or the removal failed. Changes nothing. */
  | { kind: "cleanup_failed" };

export interface InteractiveAttemptRepository {
  load(): Promise<IdentityRecordLoad<InteractiveAuthAttempt>>;
  save(attempt: InteractiveAuthAttempt): Promise<PersistenceWriteResult>;
  /**
   * Best-effort removal of a **non-current** attempt.
   *
   * @param currentBarrierId the barrier that is current right now. An attempt
   * bound to it is retained, not removed.
   */
  cleanUpNonCurrentAttempt(currentBarrierId: string): Promise<AttemptCleanupOutcome>;
}

export function createInteractiveAttemptRepository(
  adapter: RemovableStorageAdapter = localStorageAdapter
): InteractiveAttemptRepository {
  return {
    async load(): Promise<IdentityRecordLoad<InteractiveAuthAttempt>> {
      return readIdentityRecord(
        adapter,
        INTERACTIVE_ATTEMPT_STORAGE_KEY,
        validateInteractiveAuthAttempt
      );
    },

    async save(attempt: InteractiveAuthAttempt): Promise<PersistenceWriteResult> {
      const snapshot = validateInteractiveAuthAttempt(attempt);
      if (snapshot === null) {
        return { ok: false, error: { kind: "unknown", message: "The record could not be stored." } };
      }
      return writeIdentityRecord(
        adapter,
        INTERACTIVE_ATTEMPT_STORAGE_KEY,
        snapshot,
        validateInteractiveAuthAttempt
      );
    },

    async cleanUpNonCurrentAttempt(currentBarrierId: string): Promise<AttemptCleanupOutcome> {
      const stored = await readIdentityRecord(
        adapter,
        INTERACTIVE_ATTEMPT_STORAGE_KEY,
        validateInteractiveAuthAttempt
      );

      if (stored.status === "absent") return { kind: "nothing_to_clean" };
      if (stored.status === "read_failed") return { kind: "cleanup_failed" };
      // A malformed attempt cannot be the current one: the current attempt is
      // established by a validated write, and an unusable record can never
      // satisfy the correlation checks. Removing it is safe and is not a
      // security transition — the barrier it might have named stays in force.
      if (stored.status === "value" && stored.value.barrierId === currentBarrierId) {
        return { kind: "retained_current" };
      }

      const removal = await removeIdentityRecord(adapter, INTERACTIVE_ATTEMPT_STORAGE_KEY);
      return removal.ok ? { kind: "removed" } : { kind: "cleanup_failed" };
    },
  };
}

export const interactiveAttemptRepository: InteractiveAttemptRepository =
  createInteractiveAttemptRepository();
