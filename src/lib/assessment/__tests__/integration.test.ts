// End-to-end integration coverage across Domain + Persistence: create a run,
// run through warm-up, invalid/valid/wrong-handle scored attempts, pause,
// persist, reload, resume, complete, archive to history, compute metrics
// under two threshold sets, and check comparison eligibility against a
// second run — see docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md
// section 26 for the scripted scenario this follows.
import { describe, expect, it } from "vitest";
import { addInvalidAttempt, addValidAttempt } from "../attempts";
import { checkProtocolComparisonEligibility } from "../comparison";
import { migrateAssessmentPersistedState } from "../migration";
import { computeCategoryMetrics, computeRawAssessmentMetrics } from "../metrics";
import {
  archiveCurrentAssessmentRun,
  createEmptyAssessmentPersistedState,
  serializeAssessmentPersistedState,
  setCurrentAssessmentRun,
} from "../persistence";
import { getAllPlannedShots, getCurrentPlannedShot, isRunCompletable, isWarmupComplete } from "../progress";
import { createAssessmentRun, transitionAssessmentRun } from "../run";
import { RELEASE_TIME_CORE_ASSESSMENT_V1 } from "../templates";
import { ASSESSMENT_STANDARD_THRESHOLDS, ASSESSMENT_TIGHT_THRESHOLDS, standardAssessmentThresholdSet } from "../thresholds";
import { completeAllScoredShots, expectOk, manualTimingProviderSnapshot } from "./testHelpers";

describe("Assessment Run full lifecycle (domain + persistence)", () => {
  it("runs the complete scripted scenario end to end", () => {
    // 1. Create a run with the Standard threshold.
    let run = expectOk(
      createAssessmentRun(RELEASE_TIME_CORE_ASSESSMENT_V1, standardAssessmentThresholdSet(), {
        timingProviderSnapshot: manualTimingProviderSnapshot(),
      })
    );
    let state = expectOk(setCurrentAssessmentRun(createEmptyAssessmentPersistedState(), run));

    // 2. Start warm-up.
    run = expectOk(transitionAssessmentRun(run, "warmup"));
    expect(isWarmupComplete(run)).toBe(false);

    // 3. Complete all six warm-up shots.
    for (const shot of getAllPlannedShots(run.templateSnapshot).filter((s) => s.phase === "warmup")) {
      run = expectOk(addValidAttempt(run, shot.id, { measuredTime: shot.targetTime, executedHandle: shot.expectedHandle }));
    }
    expect(isWarmupComplete(run)).toBe(true);

    // 4. Start the scored flow.
    run = expectOk(transitionAssessmentRun(run, "in_progress"));

    // 5. Record an invalid attempt on the first scored shot.
    const firstScored = getCurrentPlannedShot(run)!;
    run = expectOk(addInvalidAttempt(run, firstScored.id, "first_gate_missing"));

    // 6. Record a valid attempt for it.
    run = expectOk(
      addValidAttempt(run, firstScored.id, { measuredTime: firstScored.targetTime, executedHandle: firstScored.expectedHandle })
    );

    // 7. Record a wrong-handle (but still valid, scored) attempt for the next shot.
    const secondScored = getCurrentPlannedShot(run)!;
    const wrongHandle = secondScored.expectedHandle === "in" ? "out" : "in";
    run = expectOk(addValidAttempt(run, secondScored.id, { measuredTime: secondScored.targetTime, executedHandle: wrongHandle }));
    expect(run.protocolDeviations).toHaveLength(1);
    expect(run.protocolDeviations[0].type).toBe("wrong_handle");

    // 8. Pause the run.
    run = expectOk(transitionAssessmentRun(run, "paused"));
    expect(run.status).toBe("paused");

    // 9. Persist.
    state = expectOk(setCurrentAssessmentRun(state, run));
    const serialized = serializeAssessmentPersistedState(state);

    // 10. Reload from a plain JSON string, exactly like a real LocalStorage read.
    const reloadedState = migrateAssessmentPersistedState(JSON.parse(serialized));
    expect(reloadedState.currentRun).toBeDefined();
    // 6 warm-up attempts + 1 invalid + 2 valid scored attempts recorded so far.
    expect(reloadedState.currentRun?.attempts).toHaveLength(9);
    run = reloadedState.currentRun!;
    state = reloadedState;

    // 11. Resume.
    run = expectOk(transitionAssessmentRun(run, "in_progress"));
    expect(isRunCompletable(run)).toBe(false);

    // 12. Complete the remaining scored shots (2 of 32 already valid).
    const remainingScoredShots = getAllPlannedShots(run.templateSnapshot).filter(
      (shot) => shot.phase === "scored" && !run.attempts.some((a) => a.status === "valid" && a.plannedShotId === shot.id)
    );
    for (const shot of remainingScoredShots) {
      run = expectOk(addValidAttempt(run, shot.id, { measuredTime: shot.targetTime, executedHandle: shot.expectedHandle }));
    }
    expect(isRunCompletable(run)).toBe(true);

    // 13. Complete and persist (archive to history).
    run = expectOk(transitionAssessmentRun(run, "completed"));
    state = expectOk(archiveCurrentAssessmentRun(state, run));
    expect(state.currentRun).toBeUndefined();
    expect(state.history).toHaveLength(1);

    // 14. Reload from history.
    const finalReload = migrateAssessmentPersistedState(JSON.parse(serializeAssessmentPersistedState(state)));
    const historicalRun = finalReload.history[0];
    expect(historicalRun.status).toBe("completed");

    // 15. Compute raw metrics from the reloaded, historical run.
    const raw = computeRawAssessmentMetrics(historicalRun);
    expect(raw.count).toBe(32);
    expect(raw.meanAbsoluteError).not.toBeNull();

    // 16. Compute Standard and Tight category metrics — same raw data, different categorization.
    const standardCategories = computeCategoryMetrics(historicalRun, ASSESSMENT_STANDARD_THRESHOLDS);
    const tightCategories = computeCategoryMetrics(historicalRun, ASSESSMENT_TIGHT_THRESHOLDS);
    expect(standardCategories.onTargetCount + standardCategories.acceptableCount + standardCategories.majorMissCount).toBe(32);
    expect(tightCategories.onTargetCount + tightCategories.acceptableCount + tightCategories.majorMissCount).toBe(32);

    // 17. Compare against a second, independently-created, protocol-comparable run.
    let secondRun = expectOk(
      createAssessmentRun(RELEASE_TIME_CORE_ASSESSMENT_V1, standardAssessmentThresholdSet(), {
        timingProviderSnapshot: manualTimingProviderSnapshot(),
      })
    );
    secondRun = expectOk(transitionAssessmentRun(secondRun, "warmup"));
    for (const shot of getAllPlannedShots(secondRun.templateSnapshot).filter((s) => s.phase === "warmup")) {
      secondRun = expectOk(
        addValidAttempt(secondRun, shot.id, { measuredTime: shot.targetTime, executedHandle: shot.expectedHandle })
      );
    }
    secondRun = expectOk(transitionAssessmentRun(secondRun, "in_progress"));
    secondRun = completeAllScoredShots(secondRun);
    secondRun = expectOk(transitionAssessmentRun(secondRun, "completed"));

    const eligibility = checkProtocolComparisonEligibility(historicalRun, secondRun);
    expect(eligibility).toEqual({ eligible: true, reasons: [] });
  });
});
