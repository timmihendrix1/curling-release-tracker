import { describe, expect, it } from "vitest";
import {
  completeAllScoredShots,
  completeWarmup,
  createTestRun,
  expectOk,
} from "../../assessment/__tests__/testHelpers";
import { transitionAssessmentRun } from "../../assessment/run";
import {
  deserializeAssessmentRun,
  serializeAssessmentRun,
  sha256Hex,
} from "../records";

describe("cloud sporting record serialization", () => {
  it("round-trips a canonical completed Assessment Run through its cloud payload", async () => {
    let run = expectOk(transitionAssessmentRun(createTestRun(), "warmup"));
    run = completeWarmup(run);
    run = expectOk(transitionAssessmentRun(run, "in_progress"));
    run = completeAllScoredShots(run);
    run = expectOk(transitionAssessmentRun(run, "completed"));
    run = {
      ...run,
      attempts: run.attempts.map((attempt, index) => index === 0
        ? {
            ...attempt,
            providerMetadata: {
              providerId: "simulator" as const,
              providerVersion: "e2e-v1",
              hardwareMetadata: { lane: 2, trusted: true },
            },
          }
        : attempt),
    };

    const serialized = serializeAssessmentRun(run);
    expect(serialized).not.toBeNull();
    if (!serialized) return;
    const contentSha256 = await sha256Hex(serialized.payload);
    expect(contentSha256).not.toBeNull();
    if (!contentSha256) return;

    expect(deserializeAssessmentRun({ ...serialized, contentSha256 })).toEqual(run);
  });
});
