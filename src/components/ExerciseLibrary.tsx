"use client";

import { useState } from "react";
import {
  EXERCISE_LIBRARY_EMPTY_STATE_BODY,
  EXERCISE_LIBRARY_EMPTY_STATE_TITLE,
  EXERCISE_LIBRARY_HEADING,
  EXERCISE_LIBRARY_RESET_FILTERS_LABEL,
  exerciseDiscoveryCategoryLabel,
  exerciseShotFamilyLabel,
} from "../lib/exercises/presentation";
import {
  DEFAULT_EXERCISE_LIBRARY_FILTERS,
  areDefaultExerciseLibraryFilters,
  filterExerciseVersions,
  availableExerciseShotFamilies,
  groupExerciseVersionsByCategory,
  type ExerciseLibraryFilters,
} from "../lib/exercises/query";
import type { ExerciseDiscoveryCategory } from "../lib/exercises/discovery";
import type { ExerciseVersion } from "../lib/exercises/types";
import ExerciseLibraryFilterBar from "./ExerciseLibraryFilterBar";
import ExerciseSummaryCard from "./ExerciseSummaryCard";
import { surfaceClass } from "./Surface";

type ExerciseLibraryProps = {
  /**
   * The current Exercise Version of every Exercise open to new selection, in catalog
   * order. Retired identities are excluded upstream — see `listDiscoverableExerciseVersions`.
   */
  versions: readonly ExerciseVersion[];
  filters: ExerciseLibraryFilters;
  onFiltersChange: (filters: ExerciseLibraryFilters) => void;
  onOpenExercise: (versionId: string) => void;
};

/**
 * Read-only Exercise discovery. Reads nothing from persistence and owns no
 * persistence. Filters are lifted to `TrainLanding` so leaving a detail screen
 * returns to the same filtered list, while the component owns only ephemeral
 * disclosure state for its initially collapsed category groups.
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
  const [openCategories, setOpenCategories] = useState<Set<ExerciseDiscoveryCategory>>(
    () => new Set()
  );
  const [showAllShotmaking, setShowAllShotmaking] = useState(false);
  const matches = filterExerciseVersions(versions, filters);
  const groups = groupExerciseVersionsByCategory(matches);
  const filtersActive = !areDefaultExerciseLibraryFilters(filters);

  function toggleCategory(category: ExerciseDiscoveryCategory) {
    setOpenCategories((current) => {
      const next = new Set(current);
      if (next.has(category)) next.delete(category);
      else next.add(category);
      return next;
    });
  }

  return (
    <div className="space-y-4">
      <h2 className="px-1 text-lg font-medium">{EXERCISE_LIBRARY_HEADING}</h2>
      <div className="px-1">
        <ExerciseLibraryFilterBar
          filters={filters}
          onChange={onFiltersChange}
          allVersions={versions}
        />
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
            const expanded = filtersActive || openCategories.has(group.category);
            const panelId = `exercise-group-${group.category}`;
            return (
              <section key={group.category} className="space-y-3">
                <button
                  type="button"
                  aria-expanded={expanded}
                  aria-controls={panelId}
                  aria-label={`${exerciseDiscoveryCategoryLabel(group.category)}, ${group.versions.length} ${group.versions.length === 1 ? "exercise" : "exercises"}`}
                  disabled={filtersActive}
                  onClick={() => toggleCategory(group.category)}
                  title={filtersActive ? "Matching categories stay open while search or filters are active." : undefined}
                  className="house-exercise-category flex min-h-11 w-full items-center justify-between rounded-xl border border-slate-200 bg-white px-4 py-3 text-left shadow-sm transition hover:bg-slate-50 disabled:cursor-default disabled:opacity-100"
                >
                  <span className="text-base font-semibold text-slate-900">
                    {exerciseDiscoveryCategoryLabel(group.category)}
                  </span>
                  <span className="flex items-center gap-3 text-xs text-slate-500">
                    {group.versions.length} in category
                    <span aria-hidden="true" className="text-base">
                      {expanded ? "−" : "+"}
                    </span>
                  </span>
                </button>

                <div id={panelId} hidden={!expanded} className="space-y-3">
                  {group.category === "shotmaking" && !filtersActive && !showAllShotmaking ? (
                    <div className="grid grid-cols-2 gap-2" aria-label="Shotmaking categories">
                      {availableExerciseShotFamilies(group.versions).map((family) => (
                        <button key={family} type="button" className="house-category-tile"
                          onClick={() => onFiltersChange({ ...filters, category: "shotmaking", shotFamily: family })}>
                          <span>{exerciseShotFamilyLabel(family)}</span>
                          <span aria-hidden="true">→</span>
                        </button>
                      ))}
                      <button type="button" className="house-link col-span-2 px-2 text-sm" onClick={() => setShowAllShotmaking(true)}>
                        Show all exercises <span aria-hidden="true">→</span>
                      </button>
                    </div>
                  ) : <>
                  {group.category === "shotmaking" && (showAllShotmaking || filters.shotFamily !== "any") && (
                    <button type="button" className="house-link text-sm" onClick={() => {
                      setShowAllShotmaking(false);
                      onFiltersChange(DEFAULT_EXERCISE_LIBRARY_FILTERS);
                      setOpenCategories(new Set(["shotmaking"]));
                    }}>← Shotmaking categories</button>
                  )}
                  {group.versions.map((version) => (
                    <ExerciseSummaryCard
                      key={version.id}
                      version={version}
                      onOpen={onOpenExercise}
                    />
                  ))}
                  </>}
                </div>
              </section>
            );
          })}
        </div>
      )}
    </div>
  );
}
