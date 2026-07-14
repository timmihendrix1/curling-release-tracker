"use client";

import { useState } from "react";
import {
  ACCURACY_THRESHOLD_PRESETS,
  STANDARD_ACCURACY_THRESHOLDS,
  TIGHT_ACCURACY_THRESHOLDS,
  validateAccuracyThresholds,
} from "../lib/accuracyThresholds";
import {
  dateRangeLabel,
  type HistoryAnalysisFilters,
  type TrainingCategory,
} from "../lib/historyAnalysis";
import { blockModeLabel, measurementModeLabel } from "../lib/trainingBlocks";
import type { Handle, MeasurementMode, Session, ShotType } from "../types";

type HistoryFilterBarProps = {
  filters: HistoryAnalysisFilters;
  onChange: (filters: HistoryAnalysisFilters) => void;
  availableTrainingCategories: TrainingCategory[];
  availableMeasurementModes: MeasurementMode[];
  sessions: Session[];
};

type SimpleDateRangePreset = "all" | "30d" | "90d" | "6m";

const DATE_RANGE_OPTIONS: SimpleDateRangePreset[] = ["all", "30d", "90d", "6m"];

const HANDLE_OPTIONS: { value: Handle | "both"; label: string }[] = [
  { value: "both", label: "Both handles" },
  { value: "in", label: "In only" },
  { value: "out", label: "Out only" },
];

type ThresholdModeOption = "original" | "standard" | "tight" | "custom";

function selectClassName(): string {
  return "rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm font-medium text-slate-700 transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500";
}

/**
 * The one sticky, central control surface for every History filter (see
 * docs/SYSTEM_ARCHITECTURE.md's "Central History filter pipeline"). Primary
 * filters (Training Category, Measurement Mode, Date Range, Handle) apply
 * immediately — native <select>s, so they're keyboard- and screen-reader
 * friendly for free and work the same on mobile and desktop. Secondary
 * filters live behind "More filters" with explicit Apply/Reset so an
 * in-progress multi-field edit never half-applies.
 */
export default function HistoryFilterBar({
  filters,
  onChange,
  availableTrainingCategories,
  availableMeasurementModes,
  sessions,
}: HistoryFilterBarProps) {
  const [showMoreFilters, setShowMoreFilters] = useState(false);
  const [pendingShotTypes, setPendingShotTypes] = useState<ShotType[]>(
    filters.shotTypes
  );
  const [pendingSessionId, setPendingSessionId] = useState<string>(
    filters.sessionIds[0] ?? ""
  );
  const [pendingBlockId, setPendingBlockId] = useState<string>(
    filters.blockIds[0] ?? ""
  );
  const [pendingTargetMin, setPendingTargetMin] = useState<string>(
    filters.targetRange?.min !== undefined
      ? String(filters.targetRange.min)
      : ""
  );
  const [pendingTargetMax, setPendingTargetMax] = useState<string>(
    filters.targetRange?.max !== undefined
      ? String(filters.targetRange.max)
      : ""
  );

  const [customOnTarget, setCustomOnTarget] = useState(
    STANDARD_ACCURACY_THRESHOLDS.onTarget.toString()
  );
  const [customAcceptable, setCustomAcceptable] = useState(
    STANDARD_ACCURACY_THRESHOLDS.acceptable.toString()
  );
  const [customThresholdError, setCustomThresholdError] = useState<
    string | null
  >(null);

  const thresholdMode: ThresholdModeOption =
    filters.thresholdComparisonMode.type === "original"
      ? "original"
      : filters.thresholdComparisonMode.thresholds.onTarget ===
            STANDARD_ACCURACY_THRESHOLDS.onTarget &&
          filters.thresholdComparisonMode.thresholds.acceptable ===
            STANDARD_ACCURACY_THRESHOLDS.acceptable
        ? "standard"
        : filters.thresholdComparisonMode.thresholds.onTarget ===
              TIGHT_ACCURACY_THRESHOLDS.onTarget &&
            filters.thresholdComparisonMode.thresholds.acceptable ===
              TIGHT_ACCURACY_THRESHOLDS.acceptable
          ? "tight"
          : "custom";

  const availableSessionsForBlockPicker = pendingSessionId
    ? sessions.filter((session) => session.id === pendingSessionId)
    : sessions;

  function handleThresholdModeChange(mode: ThresholdModeOption) {
    setCustomThresholdError(null);

    if (mode === "original") {
      onChange({ ...filters, thresholdComparisonMode: { type: "original" } });
      return;
    }
    if (mode === "standard" || mode === "tight") {
      onChange({
        ...filters,
        thresholdComparisonMode: {
          type: "comparison",
          thresholds: ACCURACY_THRESHOLD_PRESETS[mode],
        },
      });
      return;
    }
    // "custom" needs explicit values before it can apply — handled below.
  }

  function applyCustomThresholds() {
    const result = validateAccuracyThresholds(
      Number(customOnTarget),
      Number(customAcceptable)
    );
    if (!result.valid) {
      setCustomThresholdError(result.error);
      return;
    }
    setCustomThresholdError(null);
    onChange({
      ...filters,
      thresholdComparisonMode: {
        type: "comparison",
        thresholds: { onTarget: result.onTarget, acceptable: result.acceptable },
      },
    });
  }

  function applyMoreFilters() {
    const min = pendingTargetMin.trim() === "" ? undefined : Number(pendingTargetMin);
    const max = pendingTargetMax.trim() === "" ? undefined : Number(pendingTargetMax);

    onChange({
      ...filters,
      shotTypes: pendingShotTypes,
      sessionIds: pendingSessionId ? [pendingSessionId] : [],
      blockIds: pendingBlockId ? [pendingBlockId] : [],
      targetRange:
        min !== undefined || max !== undefined
          ? { min, max }
          : undefined,
    });
    setShowMoreFilters(false);
  }

  function resetMoreFilters() {
    setPendingShotTypes([]);
    setPendingSessionId("");
    setPendingBlockId("");
    setPendingTargetMin("");
    setPendingTargetMax("");
    onChange({
      ...filters,
      shotTypes: [],
      sessionIds: [],
      blockIds: [],
      targetRange: undefined,
    });
  }

  const moreFiltersActive =
    filters.shotTypes.length > 0 ||
    filters.sessionIds.length > 0 ||
    filters.blockIds.length > 0 ||
    filters.targetRange !== undefined;

  return (
    <div className="sticky top-0 z-20 -mx-4 bg-slate-100/95 px-4 pb-3 pt-3 backdrop-blur sm:-mx-6 sm:px-6">
      <div className="rounded-2xl bg-white p-3 shadow-lg">
        <div className="flex flex-wrap items-center gap-2">
          <select
            aria-label="Training Category"
            className={selectClassName()}
            value={filters.trainingCategory ?? ""}
            onChange={(event) =>
              onChange({
                ...filters,
                trainingCategory: (event.target.value ||
                  null) as TrainingCategory | null,
              })
            }
          >
            {availableTrainingCategories.length === 0 && (
              <option value="">No data yet</option>
            )}
            {availableTrainingCategories.map((category) => (
              <option key={category} value={category}>
                {blockModeLabel(category)}
              </option>
            ))}
          </select>

          <select
            aria-label="Measurement Mode"
            className={selectClassName()}
            value={filters.measurementMode ?? ""}
            onChange={(event) =>
              onChange({
                ...filters,
                measurementMode: (event.target.value ||
                  null) as MeasurementMode | null,
              })
            }
          >
            {availableMeasurementModes.length === 0 && (
              <option value="">No data yet</option>
            )}
            {availableMeasurementModes.map((mode) => (
              <option key={mode} value={mode}>
                {measurementModeLabel(mode)}
              </option>
            ))}
          </select>

          <select
            aria-label="Date Range"
            className={selectClassName()}
            value={filters.dateRange.preset === "custom" ? "all" : filters.dateRange.preset}
            onChange={(event) =>
              onChange({
                ...filters,
                dateRange: {
                  preset: event.target.value as SimpleDateRangePreset,
                },
              })
            }
          >
            {DATE_RANGE_OPTIONS.map((preset) => (
              <option key={preset} value={preset}>
                {dateRangeLabel({ preset })}
              </option>
            ))}
          </select>

          <select
            aria-label="Handle"
            className={selectClassName()}
            value={
              filters.handles.length === 1 ? filters.handles[0] : "both"
            }
            onChange={(event) =>
              onChange({
                ...filters,
                handles:
                  event.target.value === "both"
                    ? []
                    : [event.target.value as Handle],
              })
            }
          >
            {HANDLE_OPTIONS.map((option) => (
              <option key={option.value} value={option.value}>
                {option.label}
              </option>
            ))}
          </select>

          <select
            aria-label="Threshold Comparison Mode"
            className={selectClassName()}
            value={thresholdMode}
            onChange={(event) =>
              handleThresholdModeChange(event.target.value as ThresholdModeOption)
            }
          >
            <option value="original">Original Thresholds</option>
            <option value="standard">Compare: Standard (±0.10s/±0.20s)</option>
            <option value="tight">Compare: Tight (±0.05s/±0.10s)</option>
            <option value="custom">Compare: Custom…</option>
          </select>

          <button
            type="button"
            onClick={() => setShowMoreFilters((value) => !value)}
            aria-expanded={showMoreFilters}
            className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
              moreFiltersActive
                ? "bg-slate-900 text-white"
                : "bg-slate-200 text-slate-700"
            }`}
          >
            More filters{moreFiltersActive ? " •" : ""}
          </button>
        </div>

        {thresholdMode === "custom" && (
          <div className="mt-3 flex flex-wrap items-end gap-2 rounded-xl bg-slate-100 p-3">
            <label className="text-xs text-slate-600">
              On Target (±s)
              <input
                type="number"
                step="0.01"
                value={customOnTarget}
                onChange={(event) => setCustomOnTarget(event.target.value)}
                className="mt-1 block w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <label className="text-xs text-slate-600">
              Acceptable (±s)
              <input
                type="number"
                step="0.01"
                value={customAcceptable}
                onChange={(event) => setCustomAcceptable(event.target.value)}
                className="mt-1 block w-24 rounded-lg border border-slate-300 px-2 py-1 text-sm"
              />
            </label>
            <button
              type="button"
              onClick={applyCustomThresholds}
              className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white"
            >
              Apply
            </button>
            {customThresholdError && (
              <p className="w-full text-xs text-red-600">{customThresholdError}</p>
            )}
          </div>
        )}

        {showMoreFilters && (
          <div className="mt-3 space-y-3 rounded-xl bg-slate-100 p-3">
            <div>
              <p className="text-xs font-medium text-slate-700">Shot Type</p>
              <div className="mt-1 grid grid-cols-3 gap-2">
                {(
                  [
                    ["all", "All"],
                    ["draw", "Draw"],
                    ["takeout", "Takeout"],
                  ] as [ShotType | "all", string][]
                ).map(([value, label]) => {
                  const isActive =
                    value === "all"
                      ? pendingShotTypes.length === 0
                      : pendingShotTypes.includes(value as ShotType);
                  return (
                    <button
                      key={value}
                      type="button"
                      onClick={() =>
                        setPendingShotTypes(
                          value === "all" ? [] : [value as ShotType]
                        )
                      }
                      className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                        isActive
                          ? "bg-slate-900 text-white"
                          : "bg-white text-slate-700"
                      }`}
                    >
                      {label}
                    </button>
                  );
                })}
              </div>
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <label className="text-xs text-slate-600">
                Session
                <select
                  className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"
                  value={pendingSessionId}
                  onChange={(event) => {
                    setPendingSessionId(event.target.value);
                    setPendingBlockId("");
                  }}
                >
                  <option value="">All sessions</option>
                  {sessions.map((session) => (
                    <option key={session.id} value={session.id}>
                      {session.title} ({new Date(session.date).toLocaleDateString()})
                    </option>
                  ))}
                </select>
              </label>

              <label className="text-xs text-slate-600">
                Block
                <select
                  className="mt-1 block w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"
                  value={pendingBlockId}
                  onChange={(event) => setPendingBlockId(event.target.value)}
                >
                  <option value="">All blocks</option>
                  {availableSessionsForBlockPicker.flatMap((session) =>
                    session.blocks.map((block) => (
                      <option key={block.id} value={block.id}>
                        {block.name} ({session.title})
                      </option>
                    ))
                  )}
                </select>
              </label>
            </div>

            <div className="grid grid-cols-2 gap-3">
              <label className="text-xs text-slate-600">
                Target min (s)
                <input
                  type="number"
                  step="0.01"
                  value={pendingTargetMin}
                  onChange={(event) => setPendingTargetMin(event.target.value)}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                />
              </label>
              <label className="text-xs text-slate-600">
                Target max (s)
                <input
                  type="number"
                  step="0.01"
                  value={pendingTargetMax}
                  onChange={(event) => setPendingTargetMax(event.target.value)}
                  className="mt-1 block w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
                />
              </label>
            </div>

            <div className="flex gap-2">
              <button
                type="button"
                onClick={applyMoreFilters}
                className="flex-1 rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white"
              >
                Apply
              </button>
              <button
                type="button"
                onClick={resetMoreFilters}
                className="flex-1 rounded-lg bg-white px-3 py-2 text-sm font-medium text-slate-700"
              >
                Reset
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
