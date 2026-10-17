"use client";

import { resolveAccuracyThresholds } from "../lib/accuracyThresholds";
import type { AccuracyToleranceProfile } from "../lib/accuracyToleranceProfiles/persistence";
import {
  analyzeShots,
  average,
  computeQuantityAccuracyAnalytics,
} from "../lib/analytics";
import {
  resolveBlockMeasurement,
  speedMeasuredShots,
} from "../lib/measurement/quantities";
import { toleranceFromAccuracyThresholds } from "../lib/measurement/tolerance";
import { formatMeasuredSpeed } from "../lib/measurement/format";
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
    <div className="house-training fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 px-4">
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
        <h2 className="text-xl font-semibold text-slate-900">
          New Training Block
        </h2>

        <p className="mt-2 text-sm leading-6 text-slate-600">
          The current block will be closed out. The training session itself
          stays the same.
        </p>

        {outgoingBlockShots.length > 0 && (
          <details className="house-training-disclosure mt-4">
            <summary>
              Summary — {outgoingBlock.name}
            </summary>

            <BlockSummaryCards
              block={outgoingBlock}
              shots={outgoingBlockShots}
            />
          </details>
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
  // What this block actually measured, and the tolerance snapshot it was actually
  // judged against. The legacy symmetric pair cannot express an asymmetric tolerance,
  // so using it here would let the outgoing summary classify a stone differently from
  // every other surface in the app (ADR-0008/ADR-0051).
  const measurement = resolveBlockMeasurement(block);
  const measuresTime = measurement.quantities.includes("time");
  const timeTolerance =
    measurement.time?.tolerance ??
    toleranceFromAccuracyThresholds(resolveAccuracyThresholds(block.accuracyThresholds));
  const analysis = analyzeShots(shots, timeTolerance);
  const hasEnoughPredictionData = analysis.prediction.count >= 2;
  const notEnough = "Not enough shots";

  const speedTolerance = measurement.speed?.tolerance;
  const speedValues = speedMeasuredShots(shots).map((shot) => shot.speed);
  const speedAccuracy = speedTolerance
    ? computeQuantityAccuracyAnalytics(shots, "speed", speedTolerance)
    : null;

  return (
    <div className="mt-3 grid grid-cols-2 gap-2">
      {/* The stone count, which is not the same as the number of recorded values for
          any one quantity — a Both stone may carry only one of the two. */}
      <DashboardCard label="Shots" value={String(shots.length)} />

      {/* Withheld entirely for a block that recorded no time: an average over an empty
          set renders as "0.00s", which a reader cannot tell from a real measurement. */}
      {measuresTime && analysis.targetAccuracy.shotCount > 0 && (
        <>
          <DashboardCard
            label="Average Actual"
            value={formatReleaseTime(analysis.average)}
          />

          <TargetAccuracyDashboardCards
            targetAccuracy={analysis.targetAccuracy}
            measurementMode={block.measurementMode}
            thresholds={timeTolerance}
          />
        </>
      )}

      {speedAccuracy && speedAccuracy.shotCount > 0 && (
        <>
          <DashboardCard
            label="Average Speed"
            value={formatMeasuredSpeed(average(speedValues))}
          />

          <TargetAccuracyDashboardCards
            quantity="speed"
            targetAccuracy={speedAccuracy}
            thresholds={speedTolerance ?? null}
          />
        </>
      )}

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
