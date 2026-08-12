// SessionRepository — owns curling-release-tracker-current-session and
// curling-release-tracker-session-history. Wraps migrateSession/migrateSessionHistory
// (sessionMigration.ts) unchanged. See docs/PERSISTENCE_BOUNDARY_DESIGN.md §5.1 and
// ADR-0013. Deliberately has no composed archive operation — see design doc §6 and
// TrackerApp.tsx's handleStartNewSession, which composes saveCurrent/saveHistory itself,
// in that order, preserving today's exact write order and lack of deduplication.
import type { Session } from "../types";
import { createNewSession, migrateSession, migrateSessionHistory } from "./sessionMigration";
import { localStorageAdapter } from "./persistence/localStorageAdapter";
import type {
  DomainLoadResult,
  PersistenceWriteResult,
  StorageAdapter,
} from "./persistence/types";
import { loadedAbsent, loadedValue, loadFailed } from "./persistence/types";

export const CURRENT_SESSION_STORAGE_KEY = "curling-release-tracker-current-session";
export const SESSION_HISTORY_STORAGE_KEY = "curling-release-tracker-session-history";

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
      return loadedValue(migrateSession(parsed));
    },

    async saveCurrent(session: Session): Promise<PersistenceWriteResult> {
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
      return loadedValue(migrateSessionHistory(parsed));
    },

    async saveHistory(history: Session[]): Promise<PersistenceWriteResult> {
      return adapter.set(SESSION_HISTORY_STORAGE_KEY, JSON.stringify(history));
    },
  };
}

/** One shared repository instance for production use. */
export const sessionRepository: SessionRepository = createSessionRepository();
