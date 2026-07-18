"use client";

import { resolveAccuracyThresholds } from "../lib/accuracyThresholds";
import type { AccuracyToleranceProfile } from "../lib/accuracyToleranceProfiles/persistence";
import { analyzeShots } from "../lib/analytics";
import type { SmartRandomProfile } from "../lib/smartRandomProfiles/persistence";
import { formatReleaseTime, formatSigned } from "../lib/timeInput";
import type { Shot, TrainingBlock } from "../types";
import DashboardCard from "./DashboardCard";
import TargetAccuracyDashboardCards from "./TargetAccuracyDashboardCards";
import TrainingSetup, { type TrainingSetupValue } from "./TrainingSetup";

type NewTrainingBlockProps = {
  onCreate: (value: TrainingSetupValue) => void;
  onCancel: () => void;
  outgoingBlock: TrainingBlock;
  outgoingBlockShots: Shot[];
  accuracyToleranceProfiles?: AccuracyToleranceProfile[];
  defaultAccuracyToleranceProfileId?: string | null;
  smartRandomProfiles?: SmartRandomProfile[];
  defaultSmartRandomProfileId?: string | null;
};

export default function NewTrainingBlock({
  onCreate,
  onCancel,
  outgoingBlock,
  outgoingBlockShots,
  accuracyToleranceProfiles = [],
  defaultAccuracyToleranceProfileId = null,
  smartRandomProfiles = [],
  defaultSmartRandomProfileId = null,
}: NewTrainingBlockProps) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-xl font-semibold text-slate-900">
          New Training Block
        </h2>

        <p className="mt-2 text-sm leading-6 text-slate-600">
          The current block will be closed out. The training session itself
          stays the same.
        </p>

        {outgoingBlockShots.length > 0 && (
          <div className="mt-4 rounded-xl bg-slate-100 p-4">
            <p className="text-sm font-medium text-slate-700">
              Summary — {outgoingBlock.name}
            </p>

            <BlockSummaryCards
              block={outgoingBlock}
              shots={outgoingBlockShots}
            />
          </div>
        )}

        <div className="mt-4">
          <TrainingSetup
            submitLabel="Start Block"
            onSubmit={onCreate}
            onCancel={onCancel}
            accuracyToleranceProfiles={accuracyToleranceProfiles}
            defaultAccuracyToleranceProfileId={defaultAccuracyToleranceProfileId}
            smartRandomProfiles={smartRandomProfiles}
            defaultSmartRandomProfileId={defaultSmartRandomProfileId}
          />
        </div>
      </div>
    </div>
  );
}

type BlockSummaryCardsProps = {
  block: TrainingBlock;
  shots: Shot[];
};

function BlockSummaryCards({ block, shots }: BlockSummaryCardsProps) {
  const thresholds = resolveAccuracyThresholds(block.accuracyThresholds);
  const analysis = analyzeShots(shots, thresholds);
  const hasEnoughPredictionData = analysis.prediction.count >= 2;
  const notEnough = "Not enough shots";

  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      <DashboardCard label="Shots" value={String(shots.length)} />

      <DashboardCard
        label="Average Actual"
        value={formatReleaseTime(analysis.average)}
      />

      <TargetAccuracyDashboardCards
        targetAccuracy={analysis.targetAccuracy}
        measurementMode={block.measurementMode}
        thresholds={thresholds}
      />

      {block.mode === "blind" && (
        <>
          <DashboardCard
            label="Mean Prediction Error"
            value={
              hasEnoughPredictionData && analysis.prediction.meanError !== null
                ? `${formatSigned(analysis.prediction.meanError)}s`
                : notEnough
            }
          />

          <DashboardCard
            label="Mean Abs Prediction Error"
            value={
              hasEnoughPredictionData &&
              analysis.prediction.meanAbsoluteError !== null
                ? `${analysis.prediction.meanAbsoluteError.toFixed(3)}s`
                : notEnough
            }
          />

          <DashboardCard
            label="Prediction Error SD"
            value={
              hasEnoughPredictionData &&
              analysis.prediction.errorStandardDeviation !== null
                ? analysis.prediction.errorStandardDeviation.toFixed(3)
                : notEnough
            }
          />

          <DashboardCard
            label="Prediction Correlation"
            value={
              hasEnoughPredictionData && analysis.prediction.correlation !== null
                ? analysis.prediction.correlation.toFixed(2)
                : notEnough
            }
          />
        </>
      )}
    </div>
  );
}
