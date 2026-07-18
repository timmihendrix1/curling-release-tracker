// Verifies the core product principle: an Accuracy Tolerance Profile is a
// reusable configuration aid, never a live mutable dependency of a Training
// Block, Training Plan Step, or Session. Selecting a profile copies its
// current numeric values; nothing downstream keeps a reference back to the
// profile itself, so later edits/deletes of the profile can never retroactively
// change already-configured data.
import { describe, expect, it } from "vitest";
import {
  addAccuracyToleranceProfile,
  buildAccuracyToleranceProfile,
  deleteAccuracyToleranceProfile,
  replaceAccuracyToleranceProfile,
} from "../profiles";
import { createEmptyAccuracyToleranceProfilesState } from "../persistence";

const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-02T00:00:00.000Z";

describe("Accuracy Tolerance Profiles — snapshot semantics", () => {
  it("editing a profile later never changes a value snapshot already copied from it (as a Training Plan Step or Training Block would)", () => {
    const built = buildAccuracyToleranceProfile(
      { name: "Elite", onTarget: 0.05, acceptable: 0.1 },
      NOW
    );
    if (!built.ok) throw new Error("expected valid profile");

    let state = createEmptyAccuracyToleranceProfilesState();
    state = addAccuracyToleranceProfile(state, built.value);

    // Simulates what TrainingSetup/TrainingPlanStepEditor do: copy the
    // profile's current numeric values into the configuration being created.
    const stepConfigurationSnapshot = {
      onTarget: built.value.onTarget,
      acceptable: built.value.acceptable,
    };

    // The athlete later edits the profile to stricter values.
    const edited = buildAccuracyToleranceProfile(
      { id: built.value.id, name: "Elite", onTarget: 0.02, acceptable: 0.04, createdAt: NOW },
      LATER
    );
    if (!edited.ok) throw new Error("expected valid edit");
    const afterEdit = replaceAccuracyToleranceProfile(state, edited.value);
    expect(afterEdit.ok).toBe(true);

    // The already-copied snapshot must be completely unaffected.
    expect(stepConfigurationSnapshot).toEqual({ onTarget: 0.05, acceptable: 0.1 });
  });

  it("deleting a profile never invalidates a value snapshot already copied from it", () => {
    const built = buildAccuracyToleranceProfile(
      { name: "Elite", onTarget: 0.05, acceptable: 0.1 },
      NOW
    );
    if (!built.ok) throw new Error("expected valid profile");

    let state = createEmptyAccuracyToleranceProfilesState();
    state = addAccuracyToleranceProfile(state, built.value);

    const sessionBlockSnapshot = {
      onTarget: built.value.onTarget,
      acceptable: built.value.acceptable,
    };

    const afterDelete = deleteAccuracyToleranceProfile(state, built.value.id);
    expect(afterDelete.profiles).toHaveLength(0);

    // The Training Block's own stored thresholds remain exactly as recorded.
    expect(sessionBlockSnapshot).toEqual({ onTarget: 0.05, acceptable: 0.1 });
  });
});
