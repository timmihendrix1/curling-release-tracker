import {
  EXERCISE_LIBRARY_DESCRIPTION,
  EXERCISE_LIBRARY_EMPTY_STATE_BODY,
  EXERCISE_LIBRARY_EMPTY_STATE_TITLE,
  EXERCISE_LIBRARY_HEADING,
  EXERCISE_LIBRARY_RESET_FILTERS_LABEL,
  exerciseLibraryExplanation,
} from "../lib/exercises/presentation";
import {
  DEFAULT_EXERCISE_LIBRARY_FILTERS,
  areDefaultExerciseLibraryFilters,
  filterExerciseVersions,
  type ExerciseLibraryFilters,
} from "../lib/exercises/query";
import type { ExerciseVersion } from "../lib/exercises/types";
import ExerciseLibraryFilterBar from "./ExerciseLibraryFilterBar";
import ExerciseSummaryCard from "./ExerciseSummaryCard";
import InfoButton from "./InfoButton";
import { surfaceClass } from "./Surface";

type ExerciseLibraryProps = {
  /** The current Exercise Version of every catalog Exercise, in catalog order. */
  versions: readonly ExerciseVersion[];
  filters: ExerciseLibraryFilters;
  onFiltersChange: (filters: ExerciseLibraryFilters) => void;
  onOpenExercise: (versionId: string) => void;
};

/**
 * Read-only Exercise discovery. Reads nothing from persistence and owns no
 * state of its own — filters are lifted to `TrainLanding` so leaving a detail
 * screen returns to the same filtered list, while entering the Exercises tab
 * starts clean.
 *
 * Every row is produced by one generic card component from catalog data. There
 * is no authoring, favourites, recommendation, popularity, rating or
 * recent-items surface here — all deferred (spec 14.2).
 */
export default function ExerciseLibrary({
  versions,
  filters,
  onFiltersChange,
  onOpenExercise,
}: ExerciseLibraryProps) {
  const matches = filterExerciseVersions(versions, filters);

  return (
    <div className="space-y-4">
      <div className={surfaceClass("secondary")}>
        {/* The Info action is a *sibling* of the heading, never a child: nesting
            it inside the h2 folded "About Exercises" into the heading's own
            accessible name. */}
        <div className="flex items-center">
          <h2 className="text-lg font-semibold text-slate-900">
            {EXERCISE_LIBRARY_HEADING}
          </h2>
          <InfoButton explanation={exerciseLibraryExplanation()} />
        </div>

        <p className="mt-1 text-sm text-slate-600">{EXERCISE_LIBRARY_DESCRIPTION}</p>

        <div className="mt-4">
          <ExerciseLibraryFilterBar
            filters={filters}
            onChange={onFiltersChange}
            allVersions={versions}
          />
        </div>
      </div>

      {matches.length === 0 ? (
        <div className={surfaceClass("secondary")}>
          <h3 className="font-semibold text-slate-900">
            {EXERCISE_LIBRARY_EMPTY_STATE_TITLE}
          </h3>
          <p className="mt-2 text-sm text-slate-600">{EXERCISE_LIBRARY_EMPTY_STATE_BODY}</p>

          {!areDefaultExerciseLibraryFilters(filters) && (
            <button
              type="button"
              onClick={() => onFiltersChange(DEFAULT_EXERCISE_LIBRARY_FILTERS)}
              className="mt-4 min-h-11 w-full rounded-xl bg-slate-100 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
            >
              {EXERCISE_LIBRARY_RESET_FILTERS_LABEL}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          <p className="px-1 text-xs text-slate-500">
            {matches.length === 1 ? "1 exercise" : `${matches.length} exercises`}
          </p>

          {matches.map((version) => (
            <ExerciseSummaryCard
              key={version.id}
              version={version}
              onOpen={onOpenExercise}
            />
          ))}
        </div>
      )}
    </div>
  );
}
