"use client";

import { useEffect, useRef, useState } from "react";
import type { Handle } from "../types";
import type { AccuracyThresholdPreset } from "../lib/accuracyThresholds";
import {
  addInvalidAttempt,
} from "../lib/assessment/attempts";
import {
  archiveCurrentAssessmentRun,
  getLatestCompletedAssessmentRun,
  setCurrentAssessmentRun,
  type AssessmentPersistedState,
} from "../lib/assessment/persistence";
import {
  calculateScoredProgress,
  calculateWarmupProgress,
  getAllPlannedShots,
  getCurrentBlock,
  getCurrentPlannedShot,
  isRunCompletable,
  isWarmupComplete,
} from "../lib/assessment/progress";
import { createAssessmentRun, pauseAssessmentRun, transitionAssessmentRun } from "../lib/assessment/run";
import { RELEASE_TIME_CORE_ASSESSMENT_V1 } from "../lib/assessment/templates";
import {
  createAccuracyThresholdSet,
  standardAssessmentThresholdSet,
  tightAssessmentThresholdSet,
  validateThresholdValues,
  type ThresholdValidationResult,
} from "../lib/assessment/thresholds";
import { signedError } from "../lib/assessment/metrics";
import type { AssessmentRun, InvalidAttemptReason } from "../lib/assessment/types";
import { categorizeTargetError } from "../lib/accuracyThresholds";
import { assessmentPreferencesRepository } from "../lib/assessmentPreferencesRepository";
import { parseReleaseTime } from "../lib/timeInput";
import AssessmentCompletionSummary from "./AssessmentCompletionSummary";
import type { AssessmentLastResult } from "./AssessmentCurrentShot";
import AssessmentExecution, { type PendingBlockTransition } from "./AssessmentExecution";
import AssessmentGuidedIntroduction from "./AssessmentGuidedIntroduction";
import AssessmentLanding from "./AssessmentLanding";
import AssessmentOverview from "./AssessmentOverview";
import AssessmentPausedView from "./AssessmentPausedView";
import AssessmentProtocolSheet from "./AssessmentProtocolSheet";
import type { AssessmentTimingMethod } from "./AssessmentSetupConfirmation";
import ConfirmModal from "./ConfirmModal";

type PreRunView = "landing" | "guidedIntroduction" | "overview";

type AssessScreenProps = {
  assessmentState: AssessmentPersistedState;
  updateAssessmentState: (
    updater: (state: AssessmentPersistedState) => AssessmentPersistedState
  ) => void;
  isTrainingCaptureActive: boolean;
  executedHandle: Handle;
  onChangeExecutedHandle: (handle: Handle) => void;
  showSimulatorOption: boolean;
  onSubmitManualTime: (value: number) => void;
  captureStatusMessage?: string;
  pendingReloadRecovery: boolean;
  onConsumedReloadRecovery: () => void;
  quarantineNotice: string | null;
  onDismissQuarantineNotice: () => void;
  /** Opens the full Phase C Result Screen for a completed run — owned by TrackerApp, since it's reachable from Analyze too. */
  onViewFullResults: (runId: string) => void;
};

type LocalConfirmAction = {
  title: string;
  message: string;
  confirmLabel: string;
  onConfirm: () => void;
};

/**
 * Top-level Assess orchestrator — the Assess-domain counterpart to
 * TrackerApp's Train branch. Composes the Assess sub-screens, calls
 * src/lib/assessment/* domain functions directly, and never duplicates
 * their logic (state-transition legality, attempt/invalid-repeat rules,
 * metrics) in JSX. See docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md
 * and docs/adr/0011.
 *
 * Valid attempts are created exactly once, centrally, in TrackerApp's
 * capture routing (applyTimingResultToAssessmentRun) — both manual entry
 * and the dev Timing Simulator funnel through the same TimingResult queue
 * (see onSubmitManualTime). This component only *reacts* to the resulting
 * `run.currentPlannedShotIndex` advancing (via the effect below) to derive
 * transient UI state (last result, warm-up-complete transition, block
 * transition, completion) — it never calls addValidAttempt itself.
 */
export default function AssessScreen({
  assessmentState,
  updateAssessmentState,
  isTrainingCaptureActive,
  executedHandle,
  onChangeExecutedHandle,
  showSimulatorOption,
  onSubmitManualTime,
  captureStatusMessage,
  pendingReloadRecovery,
  onConsumedReloadRecovery,
  quarantineNotice,
  onDismissQuarantineNotice,
  onViewFullResults,
}: AssessScreenProps) {
  const [view, setView] = useState<PreRunView>("landing");
  const [introductionReturnView, setIntroductionReturnView] = useState<PreRunView>("landing");

  // Preference reads are asynchronous (AssessmentPreferencesRepository, see
  // docs/PERSISTENCE_BOUNDARY_DESIGN.md §5.7) — these start at the same defaults the
  // synchronous reads used to return on absence, then correct once the repository
  // resolves. This repository is exempt from the app's hydration-gate/write-protection
  // model (no passive save effect to protect), so a plain corrective effect is enough.
  const [thresholdPreset, setThresholdPreset] = useState<AccuracyThresholdPreset>("standard");
  const lastCustom = useRef<{ onTarget: number; acceptable: number } | null>(null);
  const [customOnTargetInput, setCustomOnTargetInput] = useState("0.10");
  const [customAcceptableInput, setCustomAcceptableInput] = useState("0.20");

  useEffect(() => {
    let cancelled = false;
    assessmentPreferencesRepository.getLastThresholdPreset().then((result) => {
      if (cancelled) return;
      if (result.status === "value") setThresholdPreset(result.value);
    });
    assessmentPreferencesRepository.getLastCustomThreshold().then((result) => {
      if (cancelled) return;
      const values = result.status === "value" ? result.value : null;
      if (!values) return;
      lastCustom.current = values;
      setCustomOnTargetInput(values.onTarget.toFixed(2));
      setCustomAcceptableInput(values.acceptable.toFixed(2));
    });
    return () => {
      cancelled = true;
    };
  }, []);

  const [timingMethod, setTimingMethod] = useState<AssessmentTimingMethod>("manual");
  const [setupConfirmed, setSetupConfirmed] = useState(false);

  const [protocolOpen, setProtocolOpen] = useState(false);
  const [invalidDialogOpen, setInvalidDialogOpen] = useState(false);
  const [lastResult, setLastResult] = useState<AssessmentLastResult | null>(null);
  const [pendingWarmupComplete, setPendingWarmupComplete] = useState(false);
  const [pendingBlockTransition, setPendingBlockTransition] = useState<PendingBlockTransition | null>(
    null
  );
  const [completedRunSummary, setCompletedRunSummary] = useState<AssessmentRun | null>(null);
  const [confirmAction, setConfirmAction] = useState<LocalConfirmAction | null>(null);

  const run = assessmentState.currentRun;
  const activeRun = run && run.status !== "completed" && run.status !== "incomplete" ? run : null;

  // Tracks the run identity/shot position this component last reacted to —
  // plain state (not a ref), since this project's lint config flags ref
  // mutation during the render body even for the "adjust state during
  // render" pattern used below (see ShotEntry.tsx's local *state* version,
  // which is unaffected — that rule is specific to refs).
  const [trackedRunId, setTrackedRunId] = useState<string | undefined>(activeRun?.id);
  const [trackedShotIndex, setTrackedShotIndex] = useState<number | undefined>(
    activeRun?.currentPlannedShotIndex
  );
  // Set (during render, below) when a just-recorded valid attempt makes the
  // run completable — consumed by the effect further down, which is the one
  // place allowed to notify the external assessmentState (an effect's job:
  // "update external systems with the latest state from React").
  const [runPendingCompletion, setRunPendingCompletion] = useState<AssessmentRun | null>(
    null
  );

  /**
   * Derives every piece of transient execution UI (last result, warm-up-
   * complete transition, block transition, reset-on-new-run) directly from
   * activeRun during render — the React-recommended way to react to a prop
   * change without an effect (see
   * https://react.dev/learn/you-might-not-need-an-effect), matching this
   * codebase's existing convention (ShotEntry.tsx's lastSeenTargetValue).
   * A just-recorded valid attempt (from either Manual Timing or the dev
   * Simulator — both funnel through the same TimingResult queue in
   * TrackerApp) is detected here because it's the only thing that advances
   * activeRun.currentPlannedShotIndex; an invalid attempt never does.
   */
  if (
    activeRun &&
    (activeRun.id !== trackedRunId || activeRun.currentPlannedShotIndex !== trackedShotIndex)
  ) {
    const isNewRun = activeRun.id !== trackedRunId;
    const previousIndex = isNewRun ? undefined : trackedShotIndex;

    setTrackedRunId(activeRun.id);
    setTrackedShotIndex(activeRun.currentPlannedShotIndex);

    if (isNewRun) {
      setLastResult(null);
      setPendingWarmupComplete(false);
      setPendingBlockTransition(null);
    } else if (previousIndex !== undefined && activeRun.currentPlannedShotIndex > previousIndex) {
      const allShots = getAllPlannedShots(activeRun.templateSnapshot);
      const completedShot = allShots[previousIndex];

      if (completedShot) {
        const attempt = [...activeRun.attempts]
          .reverse()
          .find(
            (candidate) =>
              candidate.plannedShotId === completedShot.id && candidate.status === "valid"
          );

        if (attempt && attempt.measuredTime !== undefined) {
          const signed = signedError(attempt.measuredTime, completedShot.targetTime);
          const category =
            completedShot.phase === "scored"
              ? categorizeTargetError(Math.abs(signed), activeRun.thresholdSnapshot.values)
              : null;
          setLastResult({
            actualTime: attempt.measuredTime,
            difference: signed,
            category,
            wrongHandle: attempt.protocolDeviations?.includes("wrong_handle") ?? false,
          });
        }

        if (completedShot.phase === "warmup" && isWarmupComplete(activeRun)) {
          setPendingWarmupComplete(true);
        } else if (isRunCompletable(activeRun)) {
          setRunPendingCompletion(activeRun);
        } else if (completedShot.phase === "scored") {
          const completedBlock = activeRun.templateSnapshot.blocks.find(
            (block) => block.id === completedShot.blockId
          );
          const nextBlock = getCurrentBlock(activeRun);
          const nextShot = getCurrentPlannedShot(activeRun);
          if (nextBlock && completedBlock && nextShot && nextBlock.id !== completedBlock.id) {
            setPendingBlockTransition({
              completedBlockName: completedBlock.name,
              nextBlock,
              nextTargetTime: nextShot.targetTime,
            });
          }
        }
      }
    }
  }

  // The one effect that notifies the *external* assessmentState (owned by
  // TrackerApp) that this run is now completable — set synchronously during
  // render above. Never needs to reset runPendingCompletion back to null
  // afterward: a *different* run would be a different object reference (a
  // new dependency-array value), so this can never re-fire for the same
  // completed run, and once completedRunSummary is set (inside completeRun)
  // this component renders the Completion Summary branch instead.
  useEffect(() => {
    if (!runPendingCompletion) return;
    completeRun(runPendingCompletion);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [runPendingCompletion]);

  // Keep Executed Handle defaulted to the current planned shot's Expected
  // Handle whenever the current shot changes (a fresh run, or advancing past
  // a valid attempt) — but not on an invalid-attempt retry for the *same*
  // shot, since currentPlannedShotIndex doesn't move for those.
  useEffect(() => {
    if (!activeRun) return;
    const shot = getCurrentPlannedShot(activeRun);
    if (shot) onChangeExecutedHandle(shot.expectedHandle);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeRun?.id, activeRun?.currentPlannedShotIndex]);

  function completeRun(runToComplete: AssessmentRun) {
    const completedOutcome = transitionAssessmentRun(runToComplete, "completed");
    if (!completedOutcome.ok) return;
    updateAssessmentState((state) => {
      const archivedOutcome = archiveCurrentAssessmentRun(state, completedOutcome.value);
      return archivedOutcome.ok ? archivedOutcome.value : state;
    });
    setCompletedRunSummary(completedOutcome.value);
  }

  function buildThresholdSet() {
    if (thresholdPreset === "standard") return standardAssessmentThresholdSet();
    if (thresholdPreset === "tight") return tightAssessmentThresholdSet();
    const onTarget = parseReleaseTime(customOnTargetInput) ?? NaN;
    const acceptable = parseReleaseTime(customAcceptableInput) ?? NaN;
    const outcome = createAccuracyThresholdSet("custom", { onTarget, acceptable });
    return outcome.ok ? outcome.value : null;
  }

  const customValidation: ThresholdValidationResult | null =
    thresholdPreset === "custom"
      ? validateThresholdValues(
          parseReleaseTime(customOnTargetInput) ?? NaN,
          parseReleaseTime(customAcceptableInput) ?? NaN
        )
      : null;

  const thresholdIsValid = thresholdPreset !== "custom" || (customValidation?.valid ?? false);
  const canStart = setupConfirmed && thresholdIsValid && !isTrainingCaptureActive;

  // The disabled "Start Warm-up" button must say why nearby, not just refuse
  // to activate (docs/DESIGN_SYSTEM.md §12.5). The training-conflict case
  // already has its own visible amber notice, so this only covers the two
  // silent requirements: threshold decision and setup confirmation.
  const startBlockedReason = !thresholdIsValid
    ? "Fix the Custom threshold values above to continue."
    : !setupConfirmed
      ? "Confirm your setup above to continue."
      : null;

  function handleViewAssessment() {
    assessmentPreferencesRepository.getShowIntroduction().then((result) => {
      const show = result.status === "read_failed" ? result.fallback : result.status === "value" ? result.value : true;
      if (show) {
        setIntroductionReturnView("overview");
        setView("guidedIntroduction");
      } else {
        setView("overview");
      }
    });
  }

  function handleStartNewFromLanding() {
    if (activeRun) {
      setConfirmAction({
        title: "Start New Assessment",
        message:
          "The current assessment is still in progress. Starting a new one will mark it incomplete — its recorded attempts will be kept, but it will not count as a completed assessment.",
        confirmLabel: "Start New Assessment",
        onConfirm: () => {
          abandonRun(activeRun);
          setConfirmAction(null);
          setSetupConfirmed(false);
          handleViewAssessment();
        },
      });
      return;
    }
    handleViewAssessment();
  }

  function abandonRun(runToAbandon: AssessmentRun) {
    const incompleteOutcome = transitionAssessmentRun(runToAbandon, "incomplete");
    if (!incompleteOutcome.ok) return;
    updateAssessmentState((state) => {
      const archivedOutcome = archiveCurrentAssessmentRun(state, incompleteOutcome.value);
      return archivedOutcome.ok ? archivedOutcome.value : state;
    });
  }

  function handleAbandon() {
    if (!activeRun) return;
    setConfirmAction({
      title: "Abandon Assessment",
      message:
        "Attempts recorded so far will be kept as an incomplete run. It will not count as a completed assessment and will not appear in future comparisons. Starting again creates a new Assessment Run.",
      confirmLabel: "Abandon Assessment",
      onConfirm: () => {
        abandonRun(activeRun);
        setConfirmAction(null);
        setView("landing");
        // A fresh Setup Confirmation must be required for the *next* run —
        // never silently carried over from the abandoned one (a stray click
        // on an already-checked checkbox would otherwise uncheck it instead
        // of confirming, permanently blocking Start Warm-up).
        setSetupConfirmed(false);
      },
    });
  }

  function handleStartWarmup() {
    if (!canStart) return;
    const thresholdSet = buildThresholdSet();
    if (!thresholdSet) return;

    updateAssessmentState((state) => {
      const runOutcome = createAssessmentRun(RELEASE_TIME_CORE_ASSESSMENT_V1, thresholdSet, {
        timingProviderSnapshot: {
          providerId: timingMethod === "simulator" ? "simulator" : "manual",
          captureMode: timingMethod === "simulator" ? "automatic" : "manual",
          measurementMode: "back-hog",
        },
      });
      if (!runOutcome.ok) return state;

      const warmupOutcome = transitionAssessmentRun(runOutcome.value, "warmup");
      if (!warmupOutcome.ok) return state;

      const setOutcome = setCurrentAssessmentRun(state, warmupOutcome.value);
      return setOutcome.ok ? setOutcome.value : state;
    });

    assessmentPreferencesRepository.setLastThresholdPreset(thresholdPreset);
    if (thresholdPreset === "custom") {
      assessmentPreferencesRepository.setLastCustomThreshold(thresholdSet.values);
    }
  }

  function handleStartScored() {
    updateAssessmentState((state) => {
      const current = state.currentRun;
      if (!current) return state;
      if (current.status !== "warmup") return state;
      const outcome = transitionAssessmentRun(current, "in_progress");
      return outcome.ok ? { ...state, currentRun: outcome.value } : state;
    });
    setPendingWarmupComplete(false);
  }

  function handlePause() {
    updateAssessmentState((state) => {
      const current = state.currentRun;
      if (!current) return state;
      const outcome = pauseAssessmentRun(current);
      return outcome.ok ? { ...state, currentRun: outcome.value } : state;
    });
  }

  function handleResume() {
    updateAssessmentState((state) => {
      const current = state.currentRun;
      if (!current || current.status !== "paused") return state;
      const outcome = transitionAssessmentRun(current, "in_progress");
      if (!outcome.ok) return state;

      let next = outcome.value;
      if (pendingReloadRecovery) {
        const currentShot = getCurrentPlannedShot(next);
        next = {
          ...next,
          interruption: { ...next.interruption, resumedAfterReload: true },
          protocolDeviations: [
            ...next.protocolDeviations,
            {
              id: crypto.randomUUID(),
              type: "resumed_after_reload",
              plannedShotId: currentShot?.id ?? "",
              occurredAt: new Date().toISOString(),
            },
          ],
        };
      }
      return { ...state, currentRun: next };
    });
    if (pendingReloadRecovery) onConsumedReloadRecovery();
  }

  function handleSelectInvalidReason(reason: InvalidAttemptReason) {
    if (!activeRun) return;
    const currentShot = getCurrentPlannedShot(activeRun);
    if (!currentShot) return;
    updateAssessmentState((state) => {
      const current = state.currentRun;
      if (!current) return state;
      const outcome = addInvalidAttempt(current, currentShot.id, reason);
      return outcome.ok ? { ...state, currentRun: outcome.value } : state;
    });
    setInvalidDialogOpen(false);
  }

  function handleContinueBlockTransition() {
    setPendingBlockTransition(null);
  }

  const trainingConflictMessage = isTrainingCaptureActive
    ? "A Training Auto Capture sequence is currently active. Pause or finish it in Train before starting an assessment."
    : null;

  if (completedRunSummary) {
    return (
      <>
        <AssessmentCompletionSummary
          run={completedRunSummary}
          onDone={() => {
            setCompletedRunSummary(null);
            setSetupConfirmed(false);
            setView("landing");
          }}
          onViewProtocol={() => setProtocolOpen(true)}
          onStartNew={() => {
            setCompletedRunSummary(null);
            setSetupConfirmed(false);
            handleViewAssessment();
          }}
          onViewFullResults={() => onViewFullResults(completedRunSummary.id)}
        />
        <AssessmentProtocolSheet open={protocolOpen} onClose={() => setProtocolOpen(false)} />
      </>
    );
  }

  if (!activeRun) {
    return (
      <>
        {quarantineNotice && (
          <div className="mb-4 rounded-2xl bg-amber-50 p-4 text-sm text-amber-800 ring-1 ring-amber-200">
            <p>{quarantineNotice}</p>
            <button
              type="button"
              onClick={onDismissQuarantineNotice}
              className="mt-2 rounded-lg bg-amber-100 px-3 py-1.5 text-xs font-medium text-amber-800 hover:bg-amber-200"
            >
              Dismiss
            </button>
          </div>
        )}

        {view === "landing" && (
          <AssessmentLanding
            currentRun={null}
            onViewAssessment={handleViewAssessment}
            onResume={handleViewAssessment}
            onStartNew={handleStartNewFromLanding}
            latestCompletedRun={getLatestCompletedAssessmentRun(assessmentState)}
            onViewLatestResult={onViewFullResults}
          />
        )}

        {view === "guidedIntroduction" && (
          <AssessmentGuidedIntroduction
            onContinue={(dontShowAgain) => {
              if (dontShowAgain) assessmentPreferencesRepository.setShowIntroduction(false);
              setView(introductionReturnView);
            }}
            onSkip={(dontShowAgain) => {
              if (dontShowAgain) assessmentPreferencesRepository.setShowIntroduction(false);
              setView(introductionReturnView);
            }}
          />
        )}

        {view === "overview" && (
          <AssessmentOverview
            thresholdPreset={thresholdPreset}
            onChangeThresholdPreset={setThresholdPreset}
            customOnTargetInput={customOnTargetInput}
            customAcceptableInput={customAcceptableInput}
            onChangeCustomOnTargetInput={setCustomOnTargetInput}
            onChangeCustomAcceptableInput={setCustomAcceptableInput}
            customValidation={customValidation}
            timingMethod={timingMethod}
            onChangeTimingMethod={setTimingMethod}
            showSimulatorOption={showSimulatorOption}
            setupConfirmed={setupConfirmed}
            onChangeSetupConfirmed={setSetupConfirmed}
            onOpenProtocol={() => setProtocolOpen(true)}
            onShowIntroduction={() => {
              setIntroductionReturnView("overview");
              setView("guidedIntroduction");
            }}
            canStart={canStart}
            startBlockedReason={startBlockedReason}
            trainingConflictMessage={trainingConflictMessage}
            onStartWarmup={handleStartWarmup}
            onBack={() => setView("landing")}
          />
        )}

        <AssessmentProtocolSheet open={protocolOpen} onClose={() => setProtocolOpen(false)} />

        {confirmAction && (
          <ConfirmModal
            title={confirmAction.title}
            message={confirmAction.message}
            confirmLabel={confirmAction.confirmLabel}
            isDanger
            onConfirm={confirmAction.onConfirm}
            onCancel={() => setConfirmAction(null)}
          />
        )}
      </>
    );
  }

  if (activeRun.status === "paused") {
    const inWarmup = !isWarmupComplete(activeRun);
    const progress = inWarmup
      ? calculateWarmupProgress(activeRun)
      : calculateScoredProgress(activeRun);
    return (
      <>
        <AssessmentPausedView
          progressLabel={`${inWarmup ? "Warm-up" : "Scored"} ${progress.completed} / ${progress.total}`}
          onResume={handleResume}
          onAbandon={handleAbandon}
        />
        {confirmAction && (
          <ConfirmModal
            title={confirmAction.title}
            message={confirmAction.message}
            confirmLabel={confirmAction.confirmLabel}
            isDanger
            onConfirm={confirmAction.onConfirm}
            onCancel={() => setConfirmAction(null)}
          />
        )}
      </>
    );
  }

  return (
    <>
      <AssessmentExecution
        run={activeRun}
        executedHandle={executedHandle}
        onChangeExecutedHandle={onChangeExecutedHandle}
        lastResult={lastResult}
        invalidDialogOpen={invalidDialogOpen}
        onOpenInvalidDialog={() => setInvalidDialogOpen(true)}
        onCloseInvalidDialog={() => setInvalidDialogOpen(false)}
        onSelectInvalidReason={handleSelectInvalidReason}
        onSubmitManualTime={onSubmitManualTime}
        captureStatusMessage={captureStatusMessage}
        pendingWarmupComplete={pendingWarmupComplete}
        onStartScored={handleStartScored}
        pendingBlockTransition={pendingBlockTransition}
        onContinueBlockTransition={handleContinueBlockTransition}
        onPause={handlePause}
        onOpenProtocol={() => setProtocolOpen(true)}
      />

      <div className="mt-2 text-center">
        <button
          type="button"
          onClick={handleAbandon}
          className="text-xs font-medium text-slate-400 underline hover:text-slate-600"
        >
          Abandon Assessment
        </button>
      </div>

      <AssessmentProtocolSheet open={protocolOpen} onClose={() => setProtocolOpen(false)} />

      {confirmAction && (
        <ConfirmModal
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={confirmAction.confirmLabel}
          isDanger
          onConfirm={confirmAction.onConfirm}
          onCancel={() => setConfirmAction(null)}
        />
      )}
    </>
  );
}
