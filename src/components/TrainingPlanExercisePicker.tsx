"use client";

import { useState } from "react";
import type { ExerciseAssetResolver } from "../lib/exercises/exerciseAssets";
import {
  exerciseDiscoveryCategoryDescription,
  exerciseDiscoveryCategoryLabel,
  exerciseParticipationModesLabel,
  exerciseShotFamilyLabel,
  exerciseTrainingPurposeLabel,
} from "../lib/exercises/presentation";
import { matchesExerciseSearchTerm } from "../lib/exercises/query";
import {
  EXERCISE_DISCOVERY_CATEGORIES,
  exerciseDiscoveryCategory,
  type ExerciseDiscoveryCategory,
} from "../lib/exercises/discovery";
import type { ExerciseVersion } from "../lib/exercises/types";
import ExerciseSetupOverview from "./ExerciseSetupOverview";

type Props = {
  versions: readonly ExerciseVersion[];
  onChoose: (version: ExerciseVersion) => void;
  onCancel: () => void;
  exerciseAssetResolver?: ExerciseAssetResolver;
  initialCategory?: ExerciseDiscoveryCategory;
};

function Tag({ children }: { children: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
      {children}
    </span>
  );
}

/**
 * Rich, catalog-driven selection for Training Plan steps. The picker uses the
 * same two discovery categories and searchable content as the Library, but owns
 * plan-specific Choose/Preview actions instead of navigating away from the
 * editor.
 */
export default function TrainingPlanExercisePicker({
  versions,
  onChoose,
  onCancel,
  exerciseAssetResolver,
  initialCategory,
}: Props) {
  const [category, setCategory] = useState<ExerciseDiscoveryCategory | null>(
    initialCategory ?? null
  );
  const [searchTerm, setSearchTerm] = useState("");
  const [previewVersionId, setPreviewVersionId] = useState<string | null>(null);

  const searching = searchTerm.trim().length > 0;
  const visibleVersions = versions.filter(
    (version) =>
      (searching ||
        category === null ||
        exerciseDiscoveryCategory(version) === category) &&
      matchesExerciseSearchTerm(version, searchTerm)
  );

  return (
    <div className="mt-4 space-y-4">
      <div>
        <label htmlFor="training-plan-exercise-search" className="text-sm font-medium text-slate-700">
          Search exercises
        </label>
        <input
          id="training-plan-exercise-search"
          type="search"
          value={searchTerm}
          onChange={(event) => {
            setSearchTerm(event.target.value);
            setPreviewVersionId(null);
          }}
          placeholder="Goal, shot type or exercise name…"
          className="mt-2 min-h-11 w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
        />
      </div>

      {!searching && category === null ? (
        <div className="space-y-3">
          <p className="text-sm text-slate-600">Choose a category.</p>
          {EXERCISE_DISCOVERY_CATEGORIES.map((candidate) => {
            const count = versions.filter(
              (version) => exerciseDiscoveryCategory(version) === candidate
            ).length;
            return (
              <button
                key={candidate}
                type="button"
                onClick={() => setCategory(candidate)}
                className="min-h-11 w-full rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-left transition hover:bg-slate-100"
              >
                <span className="flex items-center justify-between gap-3">
                  <span className="font-semibold text-slate-900">
                    {exerciseDiscoveryCategoryLabel(candidate)}
                  </span>
                  <span className="text-xs text-slate-500">{count}</span>
                </span>
                <span className="mt-1 block text-sm text-slate-600">
                  {exerciseDiscoveryCategoryDescription(candidate)}
                </span>
              </button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-3">
          {!searching && category && (
            <button
              type="button"
              onClick={() => {
                setCategory(null);
                setPreviewVersionId(null);
              }}
              className="inline-flex min-h-11 items-center text-sm font-medium text-slate-600 underline"
            >
              ← Back to categories
            </button>
          )}

          <div>
            <h3 className="font-semibold text-slate-900">
              {searching
                ? "Matching Exercises"
                : category
                  ? exerciseDiscoveryCategoryLabel(category)
                  : "Exercises"}
            </h3>
            <p className="mt-1 text-xs text-slate-500">
              {visibleVersions.length} {visibleVersions.length === 1 ? "exercise" : "exercises"}
            </p>
          </div>

          {visibleVersions.length === 0 ? (
            <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
              No exercise matches this search.
            </p>
          ) : (
            visibleVersions.map((version) => {
              const previewing = previewVersionId === version.id;
              return (
                <section
                  key={version.id}
                  className="rounded-xl border border-slate-200 bg-white p-4"
                >
                  <h4 className="font-semibold text-slate-900">{version.title}</h4>
                  <p className="mt-1 text-sm text-slate-600">{version.goal}</p>
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    <Tag>{exerciseDiscoveryCategoryLabel(exerciseDiscoveryCategory(version))}</Tag>
                    {version.shotFamily && (
                      <Tag>{exerciseShotFamilyLabel(version.shotFamily)}</Tag>
                    )}
                    <Tag>{exerciseTrainingPurposeLabel(version.primaryTrainingPurpose)}</Tag>
                    <Tag>{exerciseParticipationModesLabel(version.participation.supportedModes)}</Tag>
                  </div>

                  <div className="mt-3 grid grid-cols-2 gap-2">
                    <button
                      type="button"
                      aria-expanded={previewing}
                      onClick={() =>
                        setPreviewVersionId(previewing ? null : version.id)
                      }
                      className="min-h-11 rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700"
                    >
                      {previewing ? "Hide Setup" : "View Setup"}
                    </button>
                    <button
                      type="button"
                      onClick={() => onChoose(version)}
                      className="min-h-11 rounded-xl bg-slate-900 px-3 py-2 text-sm font-semibold text-white"
                    >
                      Select Exercise
                    </button>
                  </div>

                  {previewing && (
                    <div className="mt-4 border-t border-slate-100 pt-4">
                      <ExerciseSetupOverview
                        version={version}
                        exerciseAssetResolver={exerciseAssetResolver}
                      />
                    </div>
                  )}
                </section>
              );
            })
          )}
        </div>
      )}

      <button
        type="button"
        onClick={onCancel}
        className="min-h-11 w-full rounded-xl px-4 py-3 text-sm font-medium text-slate-600 underline"
      >
        Cancel
      </button>
    </div>
  );
}
