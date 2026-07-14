import { describe, expect, it } from "vitest";
import {
  INITIAL_BLIND_SHOT_DRAFT,
  confirmMeasuredTime,
  editMeasuredTime,
  editPrediction,
  hasUnsavedBlindProgress,
  isDraftComplete,
  lockPrediction,
  predictionError,
  setMeasuredReleaseTime,
  targetError,
} from "../blindWeight";

describe("Blind Weight phase logic", () => {
  it("starts in predict", () => {
    expect(INITIAL_BLIND_SHOT_DRAFT.phase).toBe("predict");
  });

  it("the measured time cannot be entered while still in predict", () => {
    const draft = INITIAL_BLIND_SHOT_DRAFT;
    const attempted = setMeasuredReleaseTime(draft, 3.8, "manual");
    expect(attempted).toEqual(draft); // no-op, releaseTime never applied
    expect(attempted.releaseTime).toBeUndefined();
  });

  it("locking a prediction advances predict -> measure", () => {
    const draft = lockPrediction(INITIAL_BLIND_SHOT_DRAFT, 3.82);
    expect(draft.phase).toBe("measure");
    expect(draft.predictedTime).toBe(3.82);
  });

  it("review is only reachable after a measured time is confirmed", () => {
    const measuring = lockPrediction(INITIAL_BLIND_SHOT_DRAFT, 3.82);

    // Trying to confirm before any measured time exists is a no-op.
    expect(confirmMeasuredTime(measuring)).toEqual(measuring);

    const withMeasurement = setMeasuredReleaseTime(measuring, 3.78, "manual");
    const reviewing = confirmMeasuredTime(withMeasurement);

    expect(reviewing.phase).toBe("review");
    expect(reviewing.predictedTime).toBe(3.82);
    expect(reviewing.releaseTime).toBe(3.78);
  });

  it("a full happy path produces a complete, review-phase draft", () => {
    let draft = INITIAL_BLIND_SHOT_DRAFT;
    draft = lockPrediction(draft, 3.82);
    draft = setMeasuredReleaseTime(draft, 3.78, "manual");
    draft = confirmMeasuredTime(draft);

    expect(isDraftComplete(draft)).toBe(true);
  });

  it("back-navigation never mutates already-saved data — it only operates on the local draft", () => {
    let draft = INITIAL_BLIND_SHOT_DRAFT;
    draft = lockPrediction(draft, 3.82);
    draft = setMeasuredReleaseTime(draft, 3.78, "manual");
    draft = confirmMeasuredTime(draft);

    const editedPrediction = editPrediction(draft);
    expect(editedPrediction.phase).toBe("predict");
    // The old prediction stays around as an editable starting value.
    expect(editedPrediction.predictedTime).toBe(3.82);

    const editedMeasured = editMeasuredTime(draft);
    expect(editedMeasured.phase).toBe("measure");
    expect(editedMeasured.predictedTime).toBe(3.82); // prediction stays locked
  });

  it("Edit Prediction works from both measure and review", () => {
    const measuring = lockPrediction(INITIAL_BLIND_SHOT_DRAFT, 3.82);
    expect(editPrediction(measuring).phase).toBe("predict");

    const reviewing = confirmMeasuredTime(
      setMeasuredReleaseTime(measuring, 3.78, "manual")
    );
    expect(editPrediction(reviewing).phase).toBe("predict");
  });

  it("Edit Measured Time only works from review", () => {
    const measuring = lockPrediction(INITIAL_BLIND_SHOT_DRAFT, 3.82);
    expect(editMeasuredTime(measuring)).toEqual(measuring); // no-op from measure

    const reviewing = confirmMeasuredTime(
      setMeasuredReleaseTime(measuring, 3.78, "manual")
    );
    expect(editMeasuredTime(reviewing).phase).toBe("measure");
  });

  it("hasUnsavedBlindProgress is false only in predict", () => {
    expect(hasUnsavedBlindProgress(INITIAL_BLIND_SHOT_DRAFT)).toBe(false);

    const measuring = lockPrediction(INITIAL_BLIND_SHOT_DRAFT, 3.82);
    expect(hasUnsavedBlindProgress(measuring)).toBe(true);

    const reviewing = confirmMeasuredTime(
      setMeasuredReleaseTime(measuring, 3.78, "manual")
    );
    expect(hasUnsavedBlindProgress(reviewing)).toBe(true);

    expect(hasUnsavedBlindProgress(editPrediction(reviewing))).toBe(false);
  });
});

describe("Blind Weight external measured-time integration point", () => {
  it("a manual reading can be set during measure", () => {
    const measuring = lockPrediction(INITIAL_BLIND_SHOT_DRAFT, 3.82);
    const withReading = setMeasuredReleaseTime(measuring, 3.78, "manual");
    expect(withReading.releaseTime).toBe(3.78);
  });

  it("an 'external' reading goes through the exact same state path as manual", () => {
    const measuring = lockPrediction(INITIAL_BLIND_SHOT_DRAFT, 3.82);
    const viaManual = setMeasuredReleaseTime(measuring, 3.78, "manual");
    const viaExternal = setMeasuredReleaseTime(measuring, 3.78, "external");
    expect(viaExternal).toEqual(viaManual);
  });

  it("a reading arriving before the prediction is locked never becomes visible", () => {
    // Simulates a hypothetical external device sending a reading too early.
    const tooEarly = setMeasuredReleaseTime(
      INITIAL_BLIND_SHOT_DRAFT,
      3.78,
      "external"
    );
    expect(tooEarly.releaseTime).toBeUndefined();
    expect(tooEarly.phase).toBe("predict");
  });

  it("setting a measured time never advances the phase by itself", () => {
    const measuring = lockPrediction(INITIAL_BLIND_SHOT_DRAFT, 3.82);
    const withReading = setMeasuredReleaseTime(measuring, 3.78, "manual");
    expect(withReading.phase).toBe("measure"); // still measure, not review
  });
});

describe("predictionError / targetError definitions", () => {
  it("matches the documented example exactly", () => {
    // target 3.75, predicted 3.82, actual 3.78
    expect(predictionError(3.82, 3.78)).toBeCloseTo(0.04, 10);
    expect(targetError(3.78, 3.75)).toBeCloseTo(0.03, 10);
  });

  it("sign convention: positive prediction error means the player believed they were slower", () => {
    // Believed 4.00, actually played 3.80 -> believed slower than reality.
    expect(predictionError(4.0, 3.8)).toBeGreaterThan(0);
    // Believed 3.60, actually played 3.80 -> believed faster than reality.
    expect(predictionError(3.6, 3.8)).toBeLessThan(0);
  });
});
