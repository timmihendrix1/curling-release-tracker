import type { Handle } from "../types";
import {
  calculateBlockProgress,
  calculateScoredProgress,
  calculateWarmupProgress,
  getCurrentBlock,
  getCurrentPlannedShot,
  isWarmupComplete,
} from "../lib/assessment/progress";
import type { AssessmentBlockDefinition, AssessmentRun, InvalidAttemptReason } from "../lib/assessment/types";
import { MAX_INVALID_ATTEMPTS_PER_PLANNED_SHOT } from "../lib/assessment/attempts";
import AssessmentAttemptEntry from "./AssessmentAttemptEntry";
import AssessmentBlockTransition from "./AssessmentBlockTransition";
import AssessmentCurrentShot, { type AssessmentLastResult } from "./AssessmentCurrentShot";
import AssessmentInvalidAttemptDialog from "./AssessmentInvalidAttemptDialog";
import AssessmentProgress from "./AssessmentProgress";
import { surfaceClass } from "./Surface";

export type PendingBlockTransition = {
  completedBlockName?: string;
  nextBlock: AssessmentBlockDefinition;
  nextTargetTime: number;
};

type AssessmentExecutionProps = {
  run: AssessmentRun;
  executedHandle: Handle;
  onChangeExecutedHandle: (handle: Handle) => void;
  lastResult: AssessmentLastResult | null;
  invalidDialogOpen: boolean;
  onOpenInvalidDialog: () => void;
  onCloseInvalidDialog: () => void;
  onSelectInvalidReason: (reason: InvalidAttemptReason) => void;
  onSubmitManualTime: (value: number) => void;
  captureStatusMessage?: string;
  pendingWarmupComplete: boolean;
  onStartScored: () => void;
  pendingBlockTransition: PendingBlockTransition | null;
  onContinueBlockTransition: () => void;
  onPause: () => void;
  onOpenProtocol: () => void;
};

function thresholdLabel(run: AssessmentRun): string {
  return run.thresholdSnapshot.type === "custom"
    ? "Custom"
    : run.thresholdSnapshot.type === "tight"
      ? "Tight"
      : "Standard";
}

/**
 * The active warm-up/scored execution surface — one Planned Shot at a time,
 * driven entirely by the run's own state (never a separately-maintained shot
 * counter). See docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md sections
 * 12-14.
 */
export default function AssessmentExecution({
  run,
  executedHandle,
  onChangeExecutedHandle,
  lastResult,
  invalidDialogOpen,
  onOpenInvalidDialog,
  onCloseInvalidDialog,
  onSelectInvalidReason,
  onSubmitManualTime,
  captureStatusMessage,
  pendingWarmupComplete,
  onStartScored,
  pendingBlockTransition,
  onContinueBlockTransition,
  onPause,
  onOpenProtocol,
}: AssessmentExecutionProps) {
  if (pendingWarmupComplete) {
    return (
      <div className={surfaceClass("hero")}>
        <p className="text-sm font-medium text-emerald-700">Warm-up complete</p>
        <p className="mt-2 text-sm text-slate-600">
          All six warm-up stones are done. Scored attempts start now.
        </p>
        <button
          type="button"
          onClick={onStartScored}
          className="mt-4 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          Start Scored Assessment
        </button>
      </div>
    );
  }

  if (pendingBlockTransition) {
    return (
      <AssessmentBlockTransition
        completedBlockName={pendingBlockTransition.completedBlockName}
        nextBlockName={pendingBlockTransition.nextBlock.name}
        nextBlockPurpose={pendingBlockTransition.nextBlock.purpose}
        nextTargetTime={pendingBlockTransition.nextTargetTime}
        onContinue={onContinueBlockTransition}
      />
    );
  }

  const currentShot = getCurrentPlannedShot(run);
  const inWarmup = !isWarmupComplete(run);
  const block = getCurrentBlock(run);
  const scoredProgress = calculateScoredProgress(run);
  const warmupProgress = calculateWarmupProgress(run);
  const blockProgress = block ? calculateBlockProgress(run, block) : null;
  const totalBlockCount = run.templateSnapshot.blocks.length;

  if (!currentShot) {
    return null;
  }

  const invalidAttemptCount = run.attempts.filter(
    (attempt) => attempt.plannedShotId === currentShot.id && attempt.status === "invalid"
  ).length;

  return (
    <div className="space-y-4">
      {/* Compose around the protocol itself: current phase/progress and the
          current planned shot are one continuous "where am I, what's next"
          unit during execution, not two stacked cards (compositional
          redesign — see docs/MOBILE_UX_AND_DESIGN_PRINCIPLES.md §18 and
          docs/INFORMATION_ARCHITECTURE_AND_SCREEN_PHILOSOPHY.md's
          Assessment Information Priority). This is the screen's one Hero. */}
      <div className={surfaceClass("hero")}>
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="text-sm font-semibold text-slate-900">Release Time Core Assessment</p>
            <p className="text-xs text-slate-500">
              {inWarmup
                ? "Warm-up"
                : block
                  ? `Block ${block.sequenceIndex + 1} of ${totalBlockCount} · ${block.name}`
                  : "Scored"}{" "}
              · Threshold: {thresholdLabel(run)}
            </p>
          </div>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onOpenProtocol}
              aria-label="View protocol"
              className="min-h-11 min-w-11 rounded-full bg-slate-100 px-3 text-xs font-medium text-slate-600 hover:bg-slate-200"
            >
              Protocol
            </button>
            <button
              type="button"
              onClick={onPause}
              className="min-h-11 min-w-11 rounded-full bg-slate-100 px-3 text-xs font-medium text-slate-600 hover:bg-slate-200"
            >
              Pause
            </button>
          </div>
        </div>

        <div className="mt-3 space-y-2">
          {inWarmup ? (
            <AssessmentProgress label="Warm-up" completed={warmupProgress.completed} total={warmupProgress.total} />
          ) : (
            <>
              {block && blockProgress && (
                <AssessmentProgress
                  label={`This block (${block.name})`}
                  completed={blockProgress.completed}
                  total={blockProgress.total}
                />
              )}
              <AssessmentProgress
                label="Overall progress"
                completed={scoredProgress.completed}
                total={scoredProgress.total}
              />
            </>
          )}
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4">
          <AssessmentCurrentShot
            variant="bare"
            phase={inWarmup ? "warmup" : "scored"}
            blockName={block?.name}
            targetTime={currentShot.targetTime}
            expectedHandle={currentShot.expectedHandle}
            executedHandle={executedHandle}
            onChangeExecutedHandle={onChangeExecutedHandle}
            lastResult={lastResult}
          />
        </div>
      </div>

      <AssessmentAttemptEntry
        onSubmitManualTime={onSubmitManualTime}
        onOpenInvalidDialog={onOpenInvalidDialog}
        invalidAttemptCount={invalidAttemptCount}
        maxInvalidAttempts={MAX_INVALID_ATTEMPTS_PER_PLANNED_SHOT}
        captureStatusMessage={captureStatusMessage}
      />

      {invalidDialogOpen && (
        <AssessmentInvalidAttemptDialog
          onSelectReason={onSelectInvalidReason}
          onCancel={onCloseInvalidDialog}
        />
      )}
    </div>
  );
}
