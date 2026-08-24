"use client";

import { useState } from "react";
import {
  areDefaultExerciseLibraryFilters,
  availableExerciseDifficultyFilters,
  availableExerciseFocuses,
  availableExerciseParticipationModes,
  availableExerciseShotFamilies,
  availableExerciseSweepingPolicies,
  describeActiveExerciseLibraryFilters,
  DEFAULT_EXERCISE_LIBRARY_FILTERS,
  type ExerciseDifficultyFilter,
  type ExerciseLibraryFilters,
} from "../lib/exercises/query";
import {
  EXERCISE_LIBRARY_RESET_FILTERS_LABEL,
  UNRATED_DIFFICULTY_LABEL,
  activeFilterCountLabel,
  exerciseDifficultyLabel,
  exerciseFocusLabel,
  exerciseParticipationModeLabel,
  exerciseShotFamilyLabel,
  exerciseSweepingPolicyLabel,
} from "../lib/exercises/presentation";
import type { ExerciseVersion } from "../lib/exercises/types";

type ExerciseLibraryFilterBarProps = {
  filters: ExerciseLibraryFilters;
  onChange: (filters: ExerciseLibraryFilters) => void;
  /** The unfiltered set, so every option offered is one some Exercise actually has. */
  allVersions: readonly ExerciseVersion[];
};

const ANY_VALUE = "any";

/** Encodes a difficulty filter as a `<select>` value, and back. */
function difficultyOptionValue(filter: ExerciseDifficultyFilter): string {
  switch (filter.kind) {
    case "any":
      return ANY_VALUE;
    case "unrated":
      return "unrated";
    case "level":
      return `level:${filter.level}`;
  }
}

function difficultyFromOptionValue(value: string): ExerciseDifficultyFilter {
  if (value === "unrated") return { kind: "unrated" };
  if (value.startsWith("level:")) {
    const level = Number(value.slice("level:".length));
    if (Number.isInteger(level)) return { kind: "level", level };
  }
  return { kind: "any" };
}

function difficultyOptionLabel(filter: ExerciseDifficultyFilter): string {
  if (filter.kind === "unrated") return UNRATED_DIFFICULTY_LABEL;
  if (filter.kind === "level") return exerciseDifficultyLabel({ kind: "level", level: filter.level });
  return "Any difficulty";
}

const SELECT_CLASS =
  "min-h-11 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500";

/**
 * Search plus the essential Version 1 filters (spec 14.2). Search is always
 * visible; the rest sit behind one "Filters" toggle so Train's landing does
 * not become a dense management dashboard (spec 14.2 / TRAINING_SYSTEM 22).
 *
 * Every option list is derived from the catalog, so a filter value that no
 * Exercise carries is never offered — and the Shot Family control disappears
 * entirely when no Exercise declares one.
 */
export default function ExerciseLibraryFilterBar({
  filters,
  onChange,
  allVersions,
}: ExerciseLibraryFilterBarProps) {
  const [showFilters, setShowFilters] = useState(false);

  const focuses = availableExerciseFocuses(allVersions);
  const shotFamilies = availableExerciseShotFamilies(allVersions);
  const participationModes = availableExerciseParticipationModes(allVersions);
  const sweepingPolicies = availableExerciseSweepingPolicies(allVersions);
  const difficultyOptions = availableExerciseDifficultyFilters(allVersions);

  const isDefault = areDefaultExerciseLibraryFilters(filters);
  const activeAdvancedFilters = describeActiveExerciseLibraryFilters(filters);

  return (
    <div className="space-y-3">
      <div>
        <label
          htmlFor="exercise-library-search"
          className="text-xs font-medium text-slate-500"
        >
          Search exercises
        </label>
        <input
          id="exercise-library-search"
          type="search"
          value={filters.searchTerm}
          onChange={(event) => onChange({ ...filters, searchTerm: event.target.value })}
          placeholder="Guard, release, weight control…"
          className="mt-1 min-h-11 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
        />
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          aria-expanded={showFilters}
          onClick={() => setShowFilters((value) => !value)}
          className="min-h-11 rounded-lg bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
        >
          Filters
        </button>

        {!isDefault && (
          <button
            type="button"
            onClick={() => onChange(DEFAULT_EXERCISE_LIBRARY_FILTERS)}
            className="min-h-11 rounded-lg px-2 py-2 text-sm font-medium text-slate-500 underline transition hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
          >
            {EXERCISE_LIBRARY_RESET_FILTERS_LABEL}
          </button>
        )}
      </div>

      {/* With the advanced panel collapsed, the selects are gone — so the
          narrowing they applied is restated here, or it would be invisible
          (DESIGN_SYSTEM.md §23.2). While the panel is open the controls
          themselves already show it, so this would only duplicate them. */}
      {!showFilters && activeAdvancedFilters.length > 0 && (
        <p
          className="text-xs text-slate-500"
          data-testid="exercise-library-active-filter-summary"
        >
          <span className="font-medium text-slate-600">
            {activeFilterCountLabel(activeAdvancedFilters.length)}:
          </span>{" "}
          {activeAdvancedFilters
            .map((filter) => `${filter.label}: ${filter.value}`)
            .join(" · ")}
        </p>
      )}

      {showFilters && (
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <div>
            <label htmlFor="exercise-filter-focus" className="text-xs font-medium text-slate-500">
              Focus
            </label>
            <select
              id="exercise-filter-focus"
              value={filters.focus}
              onChange={(event) =>
                onChange({
                  ...filters,
                  focus: event.target.value === ANY_VALUE
                    ? "any"
                    : (event.target.value as ExerciseLibraryFilters["focus"]),
                })
              }
              className={`mt-1 ${SELECT_CLASS}`}
            >
              <option value={ANY_VALUE}>Any focus</option>
              {focuses.map((focus) => (
                <option key={focus} value={focus}>
                  {exerciseFocusLabel(focus)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="exercise-filter-difficulty"
              className="text-xs font-medium text-slate-500"
            >
              Difficulty
            </label>
            <select
              id="exercise-filter-difficulty"
              value={difficultyOptionValue(filters.difficulty)}
              onChange={(event) =>
                onChange({ ...filters, difficulty: difficultyFromOptionValue(event.target.value) })
              }
              className={`mt-1 ${SELECT_CLASS}`}
            >
              <option value={ANY_VALUE}>{difficultyOptionLabel({ kind: "any" })}</option>
              {difficultyOptions.map((option) => (
                <option key={difficultyOptionValue(option)} value={difficultyOptionValue(option)}>
                  {difficultyOptionLabel(option)}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="exercise-filter-participation"
              className="text-xs font-medium text-slate-500"
            >
              Solo or Team
            </label>
            <select
              id="exercise-filter-participation"
              value={filters.participationMode}
              onChange={(event) =>
                onChange({
                  ...filters,
                  participationMode: event.target.value === ANY_VALUE
                    ? "any"
                    : (event.target.value as ExerciseLibraryFilters["participationMode"]),
                })
              }
              className={`mt-1 ${SELECT_CLASS}`}
            >
              <option value={ANY_VALUE}>Solo or Team</option>
              {participationModes.map((mode) => (
                <option key={mode} value={mode}>
                  {`${exerciseParticipationModeLabel(mode)} capable`}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label
              htmlFor="exercise-filter-sweeping"
              className="text-xs font-medium text-slate-500"
            >
              Sweepers
            </label>
            <select
              id="exercise-filter-sweeping"
              value={filters.sweeping}
              onChange={(event) =>
                onChange({
                  ...filters,
                  sweeping: event.target.value === ANY_VALUE
                    ? "any"
                    : (event.target.value as ExerciseLibraryFilters["sweeping"]),
                })
              }
              className={`mt-1 ${SELECT_CLASS}`}
            >
              <option value={ANY_VALUE}>Any Sweeper requirement</option>
              {sweepingPolicies.map((policy) => (
                <option key={policy} value={policy}>
                  {exerciseSweepingPolicyLabel(policy)}
                </option>
              ))}
            </select>
          </div>

          {/* Shot Family only applies where an Exercise declares one, so the
              control itself is absent when none does (spec 14.2's "where
              applicable"). */}
          {shotFamilies.length > 0 && (
            <div>
              <label
                htmlFor="exercise-filter-shot-family"
                className="text-xs font-medium text-slate-500"
              >
                Shot Family
              </label>
              <select
                id="exercise-filter-shot-family"
                value={filters.shotFamily}
                onChange={(event) =>
                  onChange({
                    ...filters,
                    shotFamily: event.target.value === ANY_VALUE
                      ? "any"
                      : (event.target.value as ExerciseLibraryFilters["shotFamily"]),
                  })
                }
                className={`mt-1 ${SELECT_CLASS}`}
              >
                <option value={ANY_VALUE}>Any Shot Family</option>
                {shotFamilies.map((family) => (
                  <option key={family} value={family}>
                    {exerciseShotFamilyLabel(family)}
                  </option>
                ))}
              </select>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
