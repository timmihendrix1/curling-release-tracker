"use client";

import { useState } from "react";
import {
  EXERCISE_LIBRARY_DESCRIPTION,
  EXERCISE_LIBRARY_EMPTY_STATE_BODY,
  EXERCISE_LIBRARY_EMPTY_STATE_TITLE,
  EXERCISE_LIBRARY_HEADING,
  EXERCISE_LIBRARY_RESET_FILTERS_LABEL,
  exerciseFocusGroupLabel,
  exerciseLibraryExplanation,
} from "../lib/exercises/presentation";
import {
  DEFAULT_EXERCISE_LIBRARY_FILTERS,
  areDefaultExerciseLibraryFilters,
  filterExerciseVersions,
  groupExerciseVersionsByFocus,
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
 * persistence. Filters are lifted to `TrainLanding` so leaving a detail screen
 * returns to the same filtered list, while the component owns only ephemeral
 * disclosure state for its initially collapsed focus groups.
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
  const [openFocuses, setOpenFocuses] = useState<Set<ExerciseVersion["primaryFocus"]>>(
    () => new Set()
  );
  const matches = filterExerciseVersions(versions, filters);
  const groups = groupExerciseVersionsByFocus(matches);
  const filtersActive = !areDefaultExerciseLibraryFilters(filters);

  function toggleFocus(focus: ExerciseVersion["primaryFocus"]) {
    setOpenFocuses((current) => {
      const next = new Set(current);
      if (next.has(focus)) next.delete(focus);
      else next.add(focus);
      return next;
    });
  }

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
        <div className="space-y-6">
          <p className="px-1 text-xs text-slate-500">
            {matches.length === 1 ? "1 exercise" : `${matches.length} exercises`}
          </p>

          {groups.map((group) => {
            const expanded = filtersActive || openFocuses.has(group.focus);
            const panelId = `exercise-group-${group.focus}`;
            return (
              <section key={group.focus} className="space-y-3">
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  aria-label={`${exerciseFocusGroupLabel(group.focus)}, ${group.versions.length} ${group.versions.length === 1 ? "exercise" : "exercises"}`}
                  disabled={filtersActive}
                  onClick={() => toggleFocus(group.focus)}
                  title={filtersActive ? "Matching categories stay open while search or filters are active." : undefined}
                  className="flex min-h-11 w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:bg-slate-50 disabled:cursor-default disabled:opacity-100"
                >
                  <span className="text-base font-semibold text-slate-900">
                    {exerciseFocusGroupLabel(group.focus)}
                  </span>
                  <span className="flex items-center gap-3 text-xs text-slate-500">
                    {group.versions.length} in category
                    <span aria-hidden="true" className="text-base">
                      {expanded ? "−" : "+"}
                    </span>
                  </span>
                </button>

                <div id={panelId} hidden={!expanded} className="space-y-3">
                  {group.versions.map((version) => (
                    <ExerciseSummaryCard
                      key={version.id}
                      version={version}
                      onOpen={onOpenExercise}
                    />
                  ))}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
