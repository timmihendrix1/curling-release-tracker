import type { Handle } from "../../types";
import type {
  AthleteExerciseResult,
  ExerciseMeasurement,
  ShotmakingExclusionReason,
  ShotmakingExerciseAttempt,
} from "./executionTypes";

export type ShotmakingScoreDistribution = Record<0 | 1 | 2 | 3 | 4, number>;

export type ShotmakingHandleSummary = {
  handle: Handle;
  scoredStoneCount: number;
  points: number;
  averagePercentage: number | null;
};

export type ShotmakingResultSummary = {
  scoredStoneCount: number;
  excludedAttemptCount: number;
  excludedReasonCounts: Partial<Record<ShotmakingExclusionReason, number>>;
  points: number;
  maximumPoints: number;
  averagePercentage: number | null;
  distribution: ShotmakingScoreDistribution;
  handles: ShotmakingHandleSummary[];
};

function handleSummary(attempts: ShotmakingExerciseAttempt[], handle: Handle): ShotmakingHandleSummary {
  const scored = attempts.filter(
    (attempt) => attempt.actualHandle === handle && attempt.evaluation.status === "scored"
  );
  const points = scored.reduce(
    (sum, attempt) => sum + (attempt.evaluation.status === "scored" ? attempt.evaluation.score : 0),
    0
  );
  return {
    handle,
    scoredStoneCount: scored.length,
    points,
    averagePercentage: scored.length > 0 ? (points / (4 * scored.length)) * 100 : null,
  };
}
/** Pure factual summary. Source goals and exercise-specific thresholds never enter this calculation. */
export function computeShotmakingResult(result: AthleteExerciseResult): ShotmakingResultSummary {
  const attempts = result.attempts.filter(
    (attempt): attempt is ShotmakingExerciseAttempt => attempt.kind === "shotmaking"
  );
  const scored = attempts.filter((attempt) => attempt.evaluation.status === "scored");
  const excluded = attempts.filter((attempt) => attempt.evaluation.status === "excluded");
  const points = scored.reduce(
    (sum, attempt) => sum + (attempt.evaluation.status === "scored" ? attempt.evaluation.score : 0),
    0
  );
  const distribution: ShotmakingScoreDistribution = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0 };
  for (const attempt of scored) {
    if (attempt.evaluation.status === "scored") distribution[attempt.evaluation.score] += 1;
  }
  const excludedReasonCounts: Partial<Record<ShotmakingExclusionReason, number>> = {};
  for (const attempt of excluded) {
    if (attempt.evaluation.status !== "excluded") continue;
    excludedReasonCounts[attempt.evaluation.reason] =
      (excludedReasonCounts[attempt.evaluation.reason] ?? 0) + 1;
  }
  return {
    scoredStoneCount: scored.length,
    excludedAttemptCount: excluded.length,
    excludedReasonCounts,
    points,
    maximumPoints: scored.length * 4,
    averagePercentage: scored.length > 0 ? (points / (4 * scored.length)) * 100 : null,
    distribution,
    handles: [handleSummary(attempts, "in"), handleSummary(attempts, "out")],
  };
}

export type MeasurementSummary = {
  protocolId: string;
  protocolVersion: number;
  count: number;
  minimum: number;
  maximum: number;
  mean: number;
};

export function computeMeasurementSummaries(result: AthleteExerciseResult): MeasurementSummary[] {
  const grouped = new Map<string, ExerciseMeasurement[]>();
  for (const attempt of result.attempts) {
    for (const measurement of attempt.measurements) {
      const key = `${measurement.protocolId}@${measurement.protocolVersion}`;
      grouped.set(key, [...(grouped.get(key) ?? []), measurement]);
    }
  }
  return [...grouped.values()]
    .map((measurements) => {
      const values = measurements.map((measurement) => measurement.value);
      return {
        protocolId: measurements[0].protocolId,
        protocolVersion: measurements[0].protocolVersion,
        count: values.length,
        minimum: Math.min(...values),
        maximum: Math.max(...values),
        mean: values.reduce((sum, value) => sum + value, 0) / values.length,
      };
    })
    .sort((left, right) =>
      `${left.protocolId}@${left.protocolVersion}`.localeCompare(
        `${right.protocolId}@${right.protocolVersion}`
      )
    );
}
