import { describe, expect, it } from "vitest";
import {
  computeMeasurementSummaries,
  computeShotmakingResult,
} from "../executionResult";
import type {
  AthleteExerciseResult,
  ExerciseMeasurement,
  ShotmakingExerciseAttempt,
} from "../executionTypes";

const ATHLETE_ID = "20000000-0000-4000-8000-000000000002";
const SEGMENT_ID = "30000000-0000-4000-8000-000000000003";
const AT = "2026-08-27T10:00:00.000Z";

function shot(
  sequenceNumber: number,
  handle: "in" | "out",
  evaluation: ShotmakingExerciseAttempt["evaluation"]
): ShotmakingExerciseAttempt {
  return {
    id: `40000000-0000-4000-8000-${String(sequenceNumber).padStart(12, "0")}`,
    kind: "shotmaking",
    athleteProfileId: ATHLETE_ID,
    roleAssignmentSegmentId: SEGMENT_ID,
    sequenceNumber,
    actualHandle: handle,
    evaluation,
    measurements: [],
    createdAt: AT,
  };
}

function result(attempts: AthleteExerciseResult["attempts"]): AthleteExerciseResult {
  return {
    id: "50000000-0000-4000-8000-000000000005",
    athleteProfileId: ATHLETE_ID,
    attempts,
    createdAt: AT,
    updatedAt: AT,
  };
}

describe("Exercise result derivation", () => {
  it("derives variable-length 0-4 arithmetic and omits exclusions from the denominator", () => {
    const summary = computeShotmakingResult(
      result([
        shot(1, "in", { status: "scored", score: 0 }),
        shot(2, "in", { status: "scored", score: 4 }),
        shot(3, "out", { status: "excluded", reason: "outcome-not-observable" }),
        shot(4, "out", { status: "scored", score: 2 }),
      ])
    );
    expect(summary).toEqual({
      scoredStoneCount: 3,
      excludedAttemptCount: 1,
      excludedReasonCounts: { "outcome-not-observable": 1 },
      points: 6,
      maximumPoints: 12,
      averagePercentage: 50,
      distribution: { 0: 1, 1: 0, 2: 1, 3: 0, 4: 1 },
      handles: [
        { handle: "in", scoredStoneCount: 2, points: 4, averagePercentage: 50 },
        { handle: "out", scoredStoneCount: 1, points: 2, averagePercentage: 50 },
      ],
    });
  });

  it("returns null percentages rather than NaN when no attempt is scored", () => {
    const summary = computeShotmakingResult(
      result([shot(1, "in", { status: "excluded", reason: "external-interruption" })])
    );
    expect(summary.averagePercentage).toBeNull();
    expect(summary.maximumPoints).toBe(0);
    expect(summary.handles.every((handle) => handle.averagePercentage === null)).toBe(true);
  });

  it("groups factual Measurements by the snapshotted protocol identity", () => {
    const measurement = (id: string, protocolId: string, value: number): ExerciseMeasurement => ({
      id,
      protocolId,
      protocolVersion: 1,
      value,
      source: "manual",
      recordedAt: AT,
    });
    const athleteResult = result([
      {
        id: "60000000-0000-4000-8000-000000000006",
        kind: "measurement",
        athleteProfileId: ATHLETE_ID,
        roleAssignmentSegmentId: SEGMENT_ID,
        sequenceNumber: 1,
        measurements: [
          measurement("70000000-0000-4000-8000-000000000007", "back-hog", 3.5),
          measurement("80000000-0000-4000-8000-000000000008", "hog-hog", 12),
        ],
        createdAt: AT,
      },
      {
        id: "90000000-0000-4000-8000-000000000009",
        kind: "measurement",
        athleteProfileId: ATHLETE_ID,
        roleAssignmentSegmentId: SEGMENT_ID,
        sequenceNumber: 2,
        measurements: [
          measurement("a0000000-0000-4000-8000-000000000010", "back-hog", 4),
        ],
        createdAt: AT,
      },
    ]);
    expect(computeMeasurementSummaries(athleteResult)).toEqual([
      {
        protocolId: "back-hog",
        protocolVersion: 1,
        count: 2,
        minimum: 3.5,
        maximum: 4,
        mean: 3.75,
      },
      {
        protocolId: "hog-hog",
        protocolVersion: 1,
        count: 1,
        minimum: 12,
        maximum: 12,
        mean: 12,
      },
    ]);
  });
});
