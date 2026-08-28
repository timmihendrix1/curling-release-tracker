"use client";

import { useId, useRef, useState, type KeyboardEvent, type ReactNode } from "react";
import type { AccuracyToleranceProfile } from "../lib/accuracyToleranceProfiles/persistence";
import { EXERCISE_CATALOG } from "../lib/exercises/catalog";
import {
  listCurrentExerciseVersions,
  findExerciseVersion,
  exerciseRunnerKind,
  resolveMeasurementProtocols,
} from "../lib/exercises/lookup";
import {
  DEFAULT_EXERCISE_LIBRARY_FILTERS,
  type ExerciseLibraryFilters,
} from "../lib/exercises/query";
import type { SmartRandomProfile } from "../lib/smartRandomProfiles/persistence";
import type { TrainingPlan } from "../types";
import type { ExerciseVersion } from "../lib/exercises/types";
import type { RestrictedAssetResolver } from "../lib/exercises/restrictedAssets";
import ExerciseDetail from "./ExerciseDetail";
import ExerciseLibrary from "./ExerciseLibrary";
import TrainingPlanEditor from "./TrainingPlanEditor";
import TrainingPlansLibrary from "./TrainingPlansLibrary";
import TrainingPlanStartReview from "./TrainingPlanStartReview";

type TrainLandingProps = {
  /**
   * The existing "Set Up Training Block" hero JSX, passed through unchanged
   * from TrackerApp — Quick Start's behavior/component tree is untouched, it
   * simply now sits behind one extra top-level choice (spec section 21).
   */
  quickStartContent: ReactNode;
  plans: TrainingPlan[];
  /**
   * True while the Training Plans library hasn't finished loading, or is
   * write-protected after a read failure (docs/PERSISTENCE_BOUNDARY_DESIGN.md
   * §7.4) — disables the "Training Plans" tab itself so a user can never
   * reach the library/editor/start-review screens and create, edit,
   * duplicate, or delete a plan against a not-yet-loaded (or unrecoverable)
   * collection. Quick Start and Exercises are unaffected — neither reads or
   * mutates this collection at all. Defaults to false so every existing call
   * site/test keeps today's always-enabled behavior.
   */
  plansTabDisabled?: boolean;
  /**
   * True while the Session domain isn't "ready" (see
   * docs/PERSISTENCE_BOUNDARY_DESIGN.md §7.10) — starting a plan creates a
   * Training Block in the current Session, a different domain than
   * `plansTabDisabled` above (the Training Plans library itself).
   * Defaults to false so existing call sites/tests keep today's
   * always-enabled behavior.
   */
  startPlanDisabled?: boolean;
  onSavePlan: (plan: TrainingPlan) => void;
  onDeletePlan: (planId: string) => void;
  onDuplicatePlan: (plan: TrainingPlan) => void;
  onStartPlan: (plan: TrainingPlan) => void;
  accuracyToleranceProfiles?: AccuracyToleranceProfile[];
  defaultAccuracyToleranceProfileId?: string | null;
  smartRandomProfiles?: SmartRandomProfile[];
  defaultSmartRandomProfileId?: string | null;
  initialEntryPath?: TrainEntryPath;
  onEntryPathChange?: (path: TrainEntryPath) => void;
  onStartExercise: (version: ExerciseVersion) => boolean;
  startExerciseDisabled?: boolean;
  onSetUpTeamExercise?: (version: ExerciseVersion) => void;
  teamExerciseStartDisabled?: boolean;
  restrictedAssetResolver?: RestrictedAssetResolver;
};

export type TrainEntryPath = "quick-start" | "exercises" | "plans";

type PlansSubView =
  | { screen: "library" }
  | { screen: "editor"; plan?: TrainingPlan }
  | { screen: "start-review"; plan: TrainingPlan };

type ExercisesSubView = { screen: "library" } | { screen: "detail"; versionId: string };

/**
 * Where Train falls back to when the active entry path becomes unavailable.
 * Quick Start is the only path that can never be gated: it depends on no
 * persisted collection of its own.
 */
const FALLBACK_ENTRY_PATH: TrainEntryPath = "quick-start";

/** Explicitly ordered, so the tab order never depends on object key iteration. */
const TRAIN_ENTRY_PATHS: readonly { id: TrainEntryPath; label: string }[] = [
  { id: "quick-start", label: "Quick Start" },
  { id: "exercises", label: "Exercises" },
  { id: "plans", label: "Training Plans" },
];

/**
 * The Train "no active block" landing — three entry paths: Quick Start,
 * Exercises and Training Plans, per
 * docs/EXERCISE_LIBRARY_AND_EXECUTION_SPECIFICATION.md section 14.1 and
 * docs/TRAINING_SYSTEM_AND_PLANS.md sections 21/22. Owns each pillar's
 * sub-navigation entirely locally, the same way AssessScreen.tsx owns its own
 * internal phase state — TrackerApp only learns about a plan being started,
 * saved, duplicated or deleted.
 *
 * Exercise discovery reads the compiled curated catalog directly. Starting an
 * Exercise delegates to TrackerApp, which owns Session persistence.
 */
export default function TrainLanding({
  quickStartContent,
  plans,
  plansTabDisabled = false,
  startPlanDisabled = false,
  onSavePlan,
  onDeletePlan,
  onDuplicatePlan,
  onStartPlan,
  accuracyToleranceProfiles = [],
  defaultAccuracyToleranceProfileId = null,
  smartRandomProfiles = [],
  defaultSmartRandomProfileId = null,
  initialEntryPath = "quick-start",
  onEntryPathChange,
  onStartExercise,
  startExerciseDisabled = false,
  onSetUpTeamExercise,
  teamExerciseStartDisabled = false,
  restrictedAssetResolver,
}: TrainLandingProps) {
  const reactId = useId();
  const tabId = (path: TrainEntryPath) => `${reactId}-tab-${path}`;
  /**
   * One panel element is reused for whichever entry path is active, so every
   * tab's `aria-controls` resolves to a real element at all times. Rendering
   * three panels and hiding two would mount the Training Plans library while
   * its tab is still disabled, which is exactly what the readiness gate exists
   * to prevent.
   */
  const panelId = `${reactId}-panel`;
  const tablistRef = useRef<HTMLDivElement>(null);

  const [mode, setMode] = useState<TrainEntryPath>(initialEntryPath);
  const [plansSubView, setPlansSubView] = useState<PlansSubView>({
    screen: "library",
  });
  const [exercisesSubView, setExercisesSubView] = useState<ExercisesSubView>({
    screen: "library",
  });
  // Lifted out of ExerciseLibrary so returning from an Exercise detail lands
  // back on the same filtered list; entering the Exercises tab resets both.
  const [exerciseFilters, setExerciseFilters] = useState<ExerciseLibraryFilters>(
    DEFAULT_EXERCISE_LIBRARY_FILTERS
  );

  const currentExerciseVersions = listCurrentExerciseVersions(EXERCISE_CATALOG);

  const openExerciseVersion =
    exercisesSubView.screen === "detail"
      ? findExerciseVersion(EXERCISE_CATALOG, exercisesSubView.versionId)
      : undefined;

  function isPathDisabled(path: TrainEntryPath): boolean {
    return path === "plans" && plansTabDisabled;
  }

  const enabledPaths = TRAIN_ENTRY_PATHS.filter((path) => !isPathDisabled(path.id));

  // `mode` must always name an *enabled* path. The readiness gate can disable
  // Training Plans while it is the active one (a plans read failure part-way
  // through using it), and leaving `mode` there would keep the gated library,
  // editor or start-review screen mounted, keep a disabled tab marked
  // `aria-selected`, and leave the panel labelled by a disabled tab. The
  // invariant is restored here, during render — the same "reset state on a prop
  // change" pattern as `ShotEntry.tsx` and `HistoryFilterBar.tsx`, which costs
  // no effect, no extra committed render and no lint exception. React discards
  // this render pass and immediately retries with the corrected state, so the
  // gated content is never committed to the DOM.
  //
  // This deliberately moves the state rather than deriving around it: when
  // Training Plans becomes available again, `mode` has genuinely moved to Quick
  // Start, so the athlete has to choose Training Plans again instead of finding
  // it silently reopened where they left it.
  if (isPathDisabled(mode)) {
    setMode(FALLBACK_ENTRY_PATH);
    setPlansSubView({ screen: "library" });
  }

  function selectEntryPath(next: TrainEntryPath) {
    if (isPathDisabled(next)) return;

    setMode(next);
    onEntryPathChange?.(next);
    if (next === "plans") setPlansSubView({ screen: "library" });
    if (next === "exercises") {
      setExercisesSubView({ screen: "library" });
      setExerciseFilters(DEFAULT_EXERCISE_LIBRARY_FILTERS);
    }
  }

  function focusTab(path: TrainEntryPath) {
    tablistRef.current
      ?.querySelector<HTMLButtonElement>(`[data-train-tab="${path}"]`)
      ?.focus();
  }

  /**
   * Arrow/Home/End navigation over the *enabled* tabs only, with automatic
   * activation (selection follows focus) — the same behaviour a tap already
   * has, so there is one mental model rather than two. A disabled tab is never
   * a stop: `enabledPaths` simply does not contain it.
   */
  function handleTabKeyDown(event: KeyboardEvent<HTMLDivElement>) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    if (enabledPaths.length === 0) return;

    event.preventDefault();

    const currentIndex = enabledPaths.findIndex((path) => path.id === mode);
    const lastIndex = enabledPaths.length - 1;

    let nextIndex: number;
    switch (event.key) {
      case "Home":
        nextIndex = 0;
        break;
      case "End":
        nextIndex = lastIndex;
        break;
      case "ArrowLeft":
        nextIndex = currentIndex <= 0 ? lastIndex : currentIndex - 1;
        break;
      default:
        nextIndex = currentIndex < 0 || currentIndex === lastIndex ? 0 : currentIndex + 1;
    }

    const next = enabledPaths[nextIndex].id;
    selectEntryPath(next);
    focusTab(next);
  }

  return (
    <div className="space-y-4">
      {/* Three short labels stay on one row at 390 px by tightening the
          horizontal padding and type scale below the `sm` breakpoint
          (DESIGN_SYSTEM.md §13.2) rather than forcing a two-row control. */}
      <div
        ref={tablistRef}
        role="tablist"
        aria-label="Training entry point"
        onKeyDown={handleTabKeyDown}
        className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1"
      >
        {TRAIN_ENTRY_PATHS.map(({ id, label }) => (
          <button
            key={id}
            type="button"
            role="tab"
            id={tabId(id)}
            data-train-tab={id}
            aria-selected={mode === id}
            aria-controls={panelId}
            tabIndex={mode === id ? 0 : -1}
            disabled={isPathDisabled(id)}
            onClick={() => selectEntryPath(id)}
            className={`min-h-11 rounded-lg px-2 py-2 text-xs font-medium leading-tight transition sm:px-3 sm:text-sm ${
              mode === id ? "bg-slate-900 text-white" : "text-slate-700 hover:bg-slate-200"
            } disabled:cursor-not-allowed disabled:opacity-50`}
          >
            {label}
          </button>
        ))}
      </div>

      <div
        role="tabpanel"
        id={panelId}
        aria-labelledby={tabId(mode)}
        className="space-y-4"
      >
        {mode === "quick-start" && quickStartContent}

        {mode === "exercises" && exercisesSubView.screen === "library" && (
          <ExerciseLibrary
            versions={currentExerciseVersions}
            filters={exerciseFilters}
            onFiltersChange={setExerciseFilters}
            onOpenExercise={(versionId) =>
              setExercisesSubView({ screen: "detail", versionId })
            }
          />
        )}

        {mode === "exercises" && exercisesSubView.screen === "detail" && openExerciseVersion && (
          <ExerciseDetail
            version={openExerciseVersion}
            measurementProtocols={resolveMeasurementProtocols(
              EXERCISE_CATALOG,
              openExerciseVersion.compatibleMeasurementProtocols
            )}
            onBack={() => setExercisesSubView({ screen: "library" })}
            onStart={() => {
              if (!onStartExercise(openExerciseVersion)) return;
              if (
                exerciseRunnerKind(EXERCISE_CATALOG, openExerciseVersion) ===
                "release-timing"
              ) {
                setExercisesSubView({ screen: "library" });
                setMode("quick-start");
                onEntryPathChange?.("quick-start");
              }
            }}
            onStartTeam={onSetUpTeamExercise
              ? () => onSetUpTeamExercise(openExerciseVersion)
              : undefined}
            startDisabled={startExerciseDisabled}
            teamStartDisabled={teamExerciseStartDisabled}
            restrictedAssetResolver={restrictedAssetResolver}
          />
        )}

        {mode === "plans" && plansSubView.screen === "library" && (
          <TrainingPlansLibrary
            plans={plans}
            onCreateNew={() => setPlansSubView({ screen: "editor" })}
            onEdit={(plan) => setPlansSubView({ screen: "editor", plan })}
            onDuplicate={onDuplicatePlan}
            onDelete={onDeletePlan}
            onStart={(plan) => setPlansSubView({ screen: "start-review", plan })}
          />
        )}

        {mode === "plans" && plansSubView.screen === "editor" && (
          <TrainingPlanEditor
            initialPlan={plansSubView.plan}
            onSave={(plan) => {
              onSavePlan(plan);
              setPlansSubView({ screen: "library" });
            }}
            onCancel={() => setPlansSubView({ screen: "library" })}
            accuracyToleranceProfiles={accuracyToleranceProfiles}
            defaultAccuracyToleranceProfileId={defaultAccuracyToleranceProfileId}
            smartRandomProfiles={smartRandomProfiles}
            defaultSmartRandomProfileId={defaultSmartRandomProfileId}
          />
        )}

        {mode === "plans" && plansSubView.screen === "start-review" && (
          <TrainingPlanStartReview
            plan={plansSubView.plan}
            onStart={() => onStartPlan(plansSubView.plan)}
            onCancel={() => setPlansSubView({ screen: "library" })}
            startDisabled={startPlanDisabled}
          />
        )}
      </div>
    </div>
  );
}
