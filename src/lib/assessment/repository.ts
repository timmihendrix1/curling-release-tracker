// AssessmentRepository — owns curling-release-tracker-assessment-data. Wraps
// migrateAssessmentPersistedState (migration.ts) unchanged. See
// docs/PERSISTENCE_BOUNDARY_DESIGN.md §5.3 and ADR-0013.
//
// A stored-but-unparseable string is folded into "absent" here (not "value"), matching
// TrackerApp.tsx's existing `rawAssessment ? migrate(rawAssessment) :
// createEmptyAssessmentPersistedState()` shortcut exactly — both "nothing stored" and
// "couldn't parse" set `rawAssessment = null` today and take the same
// non-migration-calling path.
import { localStorageAdapter } from "../persistence/localStorageAdapter";
import type {
  DomainLoadResult,
  PersistenceWriteResult,
  StorageAdapter,
} from "../persistence/types";
import { loadedAbsent, loadedValue, loadFailed } from "../persistence/types";
import {
  ASSESSMENT_STORAGE_KEY,
  ASSESSMENT_DRAFT_STORAGE_KEY,
  ASSESSMENT_HISTORY_STORAGE_KEY,
  ASSESSMENT_PERSISTENCE_SCHEMA_VERSION,
  createEmptyAssessmentPersistedState,
  type AssessmentPersistedState,
} from "./persistence";
import { migrateAssessmentPersistedState } from "./migration";

/**
 * Extends the plain migrated state with the one additional signal `TrackerApp.tsx`
 * currently derives itself by comparing raw vs. migrated data, to surface the existing
 * user-visible quarantine notice (see
 * docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 24).
 */
export type AssessmentLoadResult = {
  state: AssessmentPersistedState;
  /** True when a raw `currentRun` existed in storage but failed validation and was
   * quarantined during migration. */
  currentRunQuarantined: boolean;
};

export interface AssessmentRepository {
  loadState(): Promise<DomainLoadResult<AssessmentLoadResult>>;
  saveState(state: AssessmentPersistedState): Promise<PersistenceWriteResult>;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function computeCurrentRunQuarantined(
  raw: Record<string, unknown>,
  migrated: AssessmentPersistedState
): boolean {
  const rawHadCurrentRun = "currentRun" in raw && raw.currentRun !== undefined;
  return rawHadCurrentRun && !migrated.currentRun;
}

export function createAssessmentRepository(
  adapter: StorageAdapter = localStorageAdapter
): AssessmentRepository {
  async function resolvePendingArchive(
    state: AssessmentPersistedState,
    fallback: AssessmentLoadResult
  ): Promise<DomainLoadResult<AssessmentLoadResult> | AssessmentPersistedState> {
    const current = state.currentRun;
    if (!current) return state;
    const archived = state.history.find((run) => run.id === current.id);
    if (!archived) return state;
    if (
      (current.status !== "completed" && current.status !== "incomplete") ||
      JSON.stringify(current) !== JSON.stringify(archived)
    ) {
      return loadFailed(fallback, {
        kind: "unknown",
        message: "Assessment draft conflicts with Assessment history.",
      });
    }
    const cleared = { ...state, currentRun: undefined };
    const written = await adapter.set(
      ASSESSMENT_DRAFT_STORAGE_KEY,
      JSON.stringify({ schemaVersion: ASSESSMENT_PERSISTENCE_SCHEMA_VERSION })
    );
    return written.ok
      ? cleared
      : loadFailed(fallback, {
          kind: "unknown",
          message: "The archived Assessment draft could not be cleared.",
        });
  }

  return {
    async loadState(): Promise<DomainLoadResult<AssessmentLoadResult>> {
      const [draftResult, historyResult, legacyResult] = await Promise.all([
        adapter.get(ASSESSMENT_DRAFT_STORAGE_KEY),
        adapter.get(ASSESSMENT_HISTORY_STORAGE_KEY),
        adapter.get(ASSESSMENT_STORAGE_KEY),
      ]);
      const emptyFallback: AssessmentLoadResult = {
        state: createEmptyAssessmentPersistedState(),
        currentRunQuarantined: false,
      };
      if (draftResult.status === "read_failed") return loadFailed(emptyFallback, draftResult.error);
      if (historyResult.status === "read_failed") return loadFailed(emptyFallback, historyResult.error);
      if (legacyResult.status === "read_failed") return loadFailed(emptyFallback, legacyResult.error);

      function parse(raw: string | null): unknown | null {
        if (raw === null) return null;
        try { return JSON.parse(raw); } catch { return null; }
      }

      const draftRaw = parse(draftResult.value);
      const historyRaw = parse(historyResult.value);
      const legacyRaw = parse(legacyResult.value);

      if (draftResult.value === null && historyResult.value === null && legacyResult.value === null) {
        return loadedAbsent<AssessmentLoadResult>();
      }
      if (draftResult.value === null && historyResult.value === null && legacyRaw === null) {
        // Preserves the pre-split policy: a present-but-unparseable combined value is
        // quarantined as absence, never promoted into a split authority.
        return loadedAbsent<AssessmentLoadResult>();
      }

      if (draftRaw !== null && historyRaw !== null) {
        if (
          !isRecord(draftRaw) ||
          draftRaw.schemaVersion !== ASSESSMENT_PERSISTENCE_SCHEMA_VERSION ||
          !isRecord(historyRaw) ||
          historyRaw.schemaVersion !== ASSESSMENT_PERSISTENCE_SCHEMA_VERSION ||
          !Array.isArray(historyRaw.history)
        ) {
          return loadFailed(emptyFallback, {
            kind: "unknown",
            message: "Assessment persistence split has an unsupported or invalid authority shape.",
          });
        }
        const combined = {
          schemaVersion: ASSESSMENT_PERSISTENCE_SCHEMA_VERSION,
          ...("currentRun" in draftRaw
            ? { currentRun: draftRaw.currentRun }
            : {}),
          history: historyRaw.history,
        };
        const migrated = migrateAssessmentPersistedState(combined);
        const currentRunQuarantined = computeCurrentRunQuarantined(combined, migrated);
        const resolved = await resolvePendingArchive(migrated, emptyFallback);
        if ("status" in resolved) return resolved;
        return loadedValue({
          state: resolved,
          currentRunQuarantined,
        });
      }

      // Fresh Profile-scoped transition from B0.3's combined representation. A partial
      // prior attempt is recoverable only when its existing half byte-matches what the
      // still-authoritative combined value deterministically yields.
      if (legacyRaw === null || !isRecord(legacyRaw)) {
        return loadFailed(emptyFallback, { kind: "unknown", message: "Assessment persistence split is incomplete." });
      }
      const migratedState = migrateAssessmentPersistedState(legacyRaw);
      const currentRunQuarantined = computeCurrentRunQuarantined(legacyRaw, migratedState);
      const resolved = await resolvePendingArchive(migratedState, emptyFallback);
      if ("status" in resolved) return resolved;
      const state = resolved;
      const draftSerialized = JSON.stringify({
        schemaVersion: ASSESSMENT_PERSISTENCE_SCHEMA_VERSION,
        ...(state.currentRun ? { currentRun: state.currentRun } : {}),
      });
      const historySerialized = JSON.stringify({
        schemaVersion: ASSESSMENT_PERSISTENCE_SCHEMA_VERSION,
        history: state.history,
      });
      if (draftResult.value !== null && draftResult.value !== draftSerialized) {
        return loadFailed(emptyFallback, { kind: "unknown", message: "Assessment draft conflicts with the split source." });
      }
      if (historyResult.value !== null && historyResult.value !== historySerialized) {
        return loadFailed(emptyFallback, { kind: "unknown", message: "Assessment history conflicts with the split source." });
      }
      if (historyResult.value === null) {
        const written = await adapter.set(ASSESSMENT_HISTORY_STORAGE_KEY, historySerialized);
        if (!written.ok) return loadFailed(emptyFallback, { kind: "unknown", message: "Assessment history could not be established." });
      }
      if (draftResult.value === null) {
        const written = await adapter.set(ASSESSMENT_DRAFT_STORAGE_KEY, draftSerialized);
        if (!written.ok) return loadFailed(emptyFallback, { kind: "unknown", message: "Assessment draft could not be established." });
      }
      return loadedValue({
        state,
        currentRunQuarantined,
      });
    },

    async saveState(state: AssessmentPersistedState): Promise<PersistenceWriteResult> {
      const historyResult = await adapter.set(
        ASSESSMENT_HISTORY_STORAGE_KEY,
        JSON.stringify({ schemaVersion: ASSESSMENT_PERSISTENCE_SCHEMA_VERSION, history: state.history })
      );
      if (!historyResult.ok) return historyResult;
      return adapter.set(
        ASSESSMENT_DRAFT_STORAGE_KEY,
        JSON.stringify({
          schemaVersion: ASSESSMENT_PERSISTENCE_SCHEMA_VERSION,
          ...(state.currentRun ? { currentRun: state.currentRun } : {}),
        })
      );
    },
  };
}

export const assessmentRepository: AssessmentRepository = createAssessmentRepository();
