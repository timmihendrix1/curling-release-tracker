"use client";

import { useState, type ReactNode } from "react";
import type { AccuracyToleranceProfile } from "../lib/accuracyToleranceProfiles/persistence";
import type { SmartRandomProfile } from "../lib/smartRandomProfiles/persistence";
import type { TrainingPlan } from "../types";
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
   * collection. Quick Start is unaffected — it doesn't read or mutate this
   * collection at all. Defaults to false so every existing call site/test
   * keeps today's always-enabled behavior.
   */
  plansTabDisabled?: boolean;
  onSavePlan: (plan: TrainingPlan) => void;
  onDeletePlan: (planId: string) => void;
  onDuplicatePlan: (plan: TrainingPlan) => void;
  onStartPlan: (plan: TrainingPlan) => void;
  accuracyToleranceProfiles?: AccuracyToleranceProfile[];
  defaultAccuracyToleranceProfileId?: string | null;
  smartRandomProfiles?: SmartRandomProfile[];
  defaultSmartRandomProfileId?: string | null;
};

type PlansSubView =
  | { screen: "library" }
  | { screen: "editor"; plan?: TrainingPlan }
  | { screen: "start-review"; plan: TrainingPlan };

/**
 * The Train "no active block" landing — Quick Start vs. Training Plans, per
 * docs/TRAINING_SYSTEM_AND_PLANS.md section 21/22. Owns the Training Plans
 * library/editor/start-review sub-navigation entirely locally, the same way
 * AssessScreen.tsx owns its own internal phase state — TrackerApp only learns
 * about a plan being started, saved, duplicated or deleted.
 */
export default function TrainLanding({
  quickStartContent,
  plans,
  plansTabDisabled = false,
  onSavePlan,
  onDeletePlan,
  onDuplicatePlan,
  onStartPlan,
  accuracyToleranceProfiles = [],
  defaultAccuracyToleranceProfileId = null,
  smartRandomProfiles = [],
  defaultSmartRandomProfileId = null,
}: TrainLandingProps) {
  const [mode, setMode] = useState<"quick-start" | "plans">("quick-start");
  const [plansSubView, setPlansSubView] = useState<PlansSubView>({
    screen: "library",
  });

  return (
    <div className="space-y-4">
      <div
        role="tablist"
        aria-label="Training entry point"
        className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1"
      >
        <button
          type="button"
          role="tab"
          aria-selected={mode === "quick-start"}
          onClick={() => setMode("quick-start")}
          className={`min-h-11 rounded-lg px-3 py-2 text-sm font-medium transition ${
            mode === "quick-start"
              ? "bg-slate-900 text-white"
              : "text-slate-700 hover:bg-slate-200"
          }`}
        >
          Quick Start
        </button>

        <button
          type="button"
          role="tab"
          aria-selected={mode === "plans"}
          disabled={plansTabDisabled}
          onClick={() => {
            if (plansTabDisabled) return;
            setMode("plans");
            setPlansSubView({ screen: "library" });
          }}
          className={`min-h-11 rounded-lg px-3 py-2 text-sm font-medium transition ${
            mode === "plans"
              ? "bg-slate-900 text-white"
              : "text-slate-700 hover:bg-slate-200"
          } disabled:cursor-not-allowed disabled:opacity-50`}
        >
          Training Plans
        </button>
      </div>

      {mode === "quick-start" && quickStartContent}

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
        />
      )}
    </div>
  );
}
