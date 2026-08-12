// HistoryFiltersRepository — owns curling-release-tracker-history-filters. Wraps
// sanitizeHistoryFilters/sanitizeThresholdComparisonMode (historyAnalysis.ts) unchanged.
// See docs/PERSISTENCE_BOUNDARY_DESIGN.md §5.2 and ADR-0013.
//
// A stored-but-unparseable string is folded into "absent" here (not "value"), matching
// TrackerApp.tsx's existing `if (savedHistoryFilters) { try {...} catch {} }` exactly —
// today's code leaves the already-set default untouched on either "nothing stored" or
// "couldn't parse," without distinguishing them, so this repository preserves that exact
// grouping rather than inventing a new distinction current code never made.
import { createDefaultHistoryFilters, sanitizeHistoryFilters } from "./historyAnalysis";
import type { HistoryAnalysisFilters } from "./historyAnalysis";
import { localStorageAdapter } from "./persistence/localStorageAdapter";
import type {
  DomainLoadResult,
  PersistenceWriteResult,
  StorageAdapter,
} from "./persistence/types";
import { loadedAbsent, loadedValue, loadFailed } from "./persistence/types";

export const HISTORY_FILTERS_STORAGE_KEY = "curling-release-tracker-history-filters";

export interface HistoryFiltersRepository {
  load(): Promise<DomainLoadResult<HistoryAnalysisFilters>>;
  save(filters: HistoryAnalysisFilters): Promise<PersistenceWriteResult>;
}

export function createHistoryFiltersRepository(
  adapter: StorageAdapter = localStorageAdapter
): HistoryFiltersRepository {
  return {
    async load(): Promise<DomainLoadResult<HistoryAnalysisFilters>> {
      const result = await adapter.get(HISTORY_FILTERS_STORAGE_KEY);
      if (result.status === "read_failed") {
        return loadFailed<HistoryAnalysisFilters>(createDefaultHistoryFilters(), result.error);
      }
      if (result.value === null) {
        return loadedAbsent<HistoryAnalysisFilters>();
      }
      try {
        return loadedValue(sanitizeHistoryFilters(JSON.parse(result.value)));
      } catch {
        return loadedAbsent<HistoryAnalysisFilters>();
      }
    },

    async save(filters: HistoryAnalysisFilters): Promise<PersistenceWriteResult> {
      return adapter.set(HISTORY_FILTERS_STORAGE_KEY, JSON.stringify(filters));
    },
  };
}

export const historyFiltersRepository: HistoryFiltersRepository =
  createHistoryFiltersRepository();
