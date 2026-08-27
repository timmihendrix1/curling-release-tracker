// SessionRepository — owns curling-release-tracker-current-session and
// curling-release-tracker-session-history. Wraps migrateSession/migrateSessionHistory
// and coordinates the history-first archive transition. See ADR-0013/0014. ADR-0029
// adds strict validation for optional embedded Exercise Executions without adding a key.
import type { Session } from "../types";
import {
  isSessionExerciseCloudEligible,
  validateSessionExerciseState,
} from "./exercises/sessionIntegration";
import { createNewSession, migrateSession, migrateSessionHistory } from "./sessionMigration";
import { localStorageAdapter } from "./persistence/localStorageAdapter";
import type {
  DomainLoadResult,
  PersistenceWriteError,
  PersistenceWriteResult,
  StorageAdapter,
} from "./persistence/types";
import { loadedAbsent, loadedValue, loadFailed, writeFailed } from "./persistence/types";

export const CURRENT_SESSION_STORAGE_KEY = "curling-release-tracker-current-session";
export const SESSION_HISTORY_STORAGE_KEY = "curling-release-tracker-session-history";

const INVALID_EXERCISE_STATE_MESSAGE =
  "Stored Training Session contains invalid Exercise Execution state.";

function hasValidExerciseState(value: unknown): boolean {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return true;
  const record = value as Record<string, unknown>;
  const sessionId = typeof record.id === "string" ? record.id : "";
  return validateSessionExerciseState(record, sessionId).valid;
}

function hasValidTerminalExerciseState(value: unknown): boolean {
  if (!hasValidExerciseState(value)) return false;
  if (typeof value !== "object" || value === null || Array.isArray(value)) return true;
  return isSessionExerciseCloudEligible(value as Session);
}

function invalidExerciseStateWrite(): PersistenceWriteResult {
  return writeFailed({ kind: "unknown", message: INVALID_EXERCISE_STATE_MESSAGE });
}

/**
 * Outcome of `SessionRepository.archiveAndReplace` — see docs/adr/0014 for the full
 * rationale. Distinct from the plain `PersistenceWriteResult` every other write method
 * returns because a caller must be able to tell *which* of the two writes failed:
 * `"history"` failing means neither write took effect (the replacement session was
 * never attempted); `"current"` failing means the archive itself is already durable and
 * only the replacement-session write needs a retry. This is a repository-level
 * (domain-shaped) result type, not a widening of the generic `StorageAdapter`/
 * `PersistenceWriteResult` contract — `StorageAdapter.set` itself is untouched.
 */
export type SessionArchiveOutcome =
  | { ok: true }
  | { ok: false; step: "history"; error: PersistenceWriteError }
  | { ok: false; step: "current"; error: PersistenceWriteError };

export interface SessionRepository {
  /**
   * `"absent"` MUST NOT be satisfied by calling migrateSession(null) — migrateBlocks
   * treats a genuinely missing `blocks` array as legacy data and fabricates a
   * "Legacy Block" (ADR-0005). A brand-new, never-stored session is not legacy data.
   * The caller (hydration owner) is responsible for calling createNewSession() itself
   * on "absent" — see docs/PERSISTENCE_BOUNDARY_DESIGN.md §5.1.
   */
  loadCurrent(): Promise<DomainLoadResult<Session>>;
  saveCurrent(session: Session): Promise<PersistenceWriteResult>;
  loadHistory(): Promise<DomainLoadResult<Session[]>>;
  saveHistory(history: Session[]): Promise<PersistenceWriteResult>;

  /**
   * The session-archiving transition: durably move the completed session into history
   * and durably replace the current slot with its successor — coordinated here, at the
   * repository boundary, instead of as two independently-scheduled React effects (see
   * docs/adr/0014-session-archive-write-ordering.md).
   *
   * Order: `saveHistory(nextHistory)` is awaited to completion **before**
   * `saveCurrent(nextCurrentSession)` is even attempted — never merely "issued first."
   * This is a plain sequential `await` inside one function, so the guarantee holds
   * regardless of whether the underlying adapter is synchronous-under-the-hood (today's
   * `localStorage`) or genuinely asynchronous (a future IndexedDB adapter); it does not
   * depend on React's effect-declaration order at all, because no React effect is
   * involved in the coordination.
   *
   * Why history-first: `localStorage`/`StorageAdapter.set` writes one key at a time with
   * no cross-key atomicity (docs/PERSISTENCE_BOUNDARY_DESIGN.md §9) — an interruption
   * between the two writes is possible and not eliminated by this method, only ordered
   * deliberately. History-first means that if an interruption lands between the two
   * writes, the completed session already survives in history (as a value that will
   * also, briefly, still be sitting in the "current" slot too — a recoverable duplicate,
   * never a loss) rather than the reverse ordering's risk (the old current-session slot
   * is already overwritten by the replacement while the completed session was never
   * durably archived at all — an unrecoverable loss).
   *
   * Failure semantics:
   * - History write fails → resolves `{ ok: false, step: "history", error }`. The
   *   current-session write is never attempted. Nothing was persisted.
   * - History write succeeds, current-session write fails → resolves
   *   `{ ok: false, step: "current", error }`. The archive is already durable; only the
   *   replacement session still needs to be persisted (the caller may rely on the
   *   ordinary `saveCurrent` save-effect to retry this on the next state change).
   * - Both succeed → resolves `{ ok: true }`.
   *
   * This method does not decide *what* the next history array or next session are —
   * that stays application-level, exactly as `docs/PERSISTENCE_BOUNDARY_DESIGN.md` §6.2
   * requires for `saveCurrent`/`saveHistory` individually. It also does not introduce any
   * ID-based deduplication for history — same as `saveHistory` today.
   */
  archiveAndReplace(
    nextHistory: Session[],
    nextCurrentSession: Session
  ): Promise<SessionArchiveOutcome>;
}

export function createSessionRepository(
  adapter: StorageAdapter = localStorageAdapter
): SessionRepository {
  return {
    async loadCurrent(): Promise<DomainLoadResult<Session>> {
      const result = await adapter.get(CURRENT_SESSION_STORAGE_KEY);
      if (result.status === "read_failed") {
        // fallback must never come from migrateSession(undefined) — see the interface
        // doc comment above: that would fabricate a Legacy Block, same as "absent" must
        // avoid. createNewSession() is display-only here; the domain stays
        // write_protected (docs/PERSISTENCE_BOUNDARY_DESIGN.md §7), so this fallback is
        // never persisted.
        return loadFailed<Session>(createNewSession(), result.error);
      }
      if (result.value === null) {
        return loadedAbsent<Session>();
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.value);
      } catch {
        return loadedAbsent<Session>();
      }
      if (!hasValidExerciseState(parsed)) {
        return loadFailed<Session>(createNewSession(), {
          kind: "unknown",
          message: INVALID_EXERCISE_STATE_MESSAGE,
        });
      }
      return loadedValue(migrateSession(parsed));
    },

    async saveCurrent(session: Session): Promise<PersistenceWriteResult> {
      if (!hasValidExerciseState(session)) return invalidExerciseStateWrite();
      return adapter.set(CURRENT_SESSION_STORAGE_KEY, JSON.stringify(session));
    },

    async loadHistory(): Promise<DomainLoadResult<Session[]>> {
      const result = await adapter.get(SESSION_HISTORY_STORAGE_KEY);
      if (result.status === "read_failed") {
        return loadFailed<Session[]>([], result.error);
      }
      if (result.value === null) {
        return loadedAbsent<Session[]>();
      }
      let parsed: unknown;
      try {
        parsed = JSON.parse(result.value);
      } catch {
        return loadedAbsent<Session[]>();
      }
      if (
        Array.isArray(parsed) &&
        parsed.some((session) => !hasValidTerminalExerciseState(session))
      ) {
        return loadFailed<Session[]>([], {
          kind: "unknown",
          message: INVALID_EXERCISE_STATE_MESSAGE,
        });
      }
      return loadedValue(migrateSessionHistory(parsed));
    },

    async saveHistory(history: Session[]): Promise<PersistenceWriteResult> {
      if (history.some((session) => !hasValidTerminalExerciseState(session))) {
        return invalidExerciseStateWrite();
      }
      return adapter.set(SESSION_HISTORY_STORAGE_KEY, JSON.stringify(history));
    },

    async archiveAndReplace(
      nextHistory: Session[],
      nextCurrentSession: Session
    ): Promise<SessionArchiveOutcome> {
      if (
        nextHistory.some((session) => !hasValidTerminalExerciseState(session)) ||
        !hasValidExerciseState(nextCurrentSession)
      ) {
        return {
          ok: false,
          step: "history",
          error: { kind: "unknown", message: INVALID_EXERCISE_STATE_MESSAGE },
        };
      }
      const historyResult = await adapter.set(
        SESSION_HISTORY_STORAGE_KEY,
        JSON.stringify(nextHistory)
      );
      if (!historyResult.ok) {
        return { ok: false, step: "history", error: historyResult.error };
      }

      const currentResult = await adapter.set(
        CURRENT_SESSION_STORAGE_KEY,
        JSON.stringify(nextCurrentSession)
      );
      if (!currentResult.ok) {
        return { ok: false, step: "current", error: currentResult.error };
      }

      return { ok: true };
    },
  };
}

/** One shared repository instance for production use. */
export const sessionRepository: SessionRepository = createSessionRepository();
