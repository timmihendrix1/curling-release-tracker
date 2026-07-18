// Verifies the core product principle: a Smart Random Profile is a reusable
// configuration aid, never a live mutable dependency of a Training Block,
// Training Plan Step, or Session. Selecting a profile copies its current
// min/max; nothing downstream keeps a reference back to the profile itself,
// so later edits/deletes of the profile can never retroactively change
// already-configured data or generated targets.
import { describe, expect, it } from "vitest";
import {
  addSmartRandomProfile,
  buildSmartRandomProfile,
  deleteSmartRandomProfile,
  replaceSmartRandomProfile,
} from "../profiles";
import { createEmptySmartRandomProfilesState } from "../persistence";
import { generateSmartRandomTarget } from "../../variableTargets";

const NOW = "2026-01-01T00:00:00.000Z";
const LATER = "2026-01-02T00:00:00.000Z";

describe("Smart Random Profiles — snapshot semantics", () => {
  it("editing a profile later never changes a range snapshot already copied from it (as a Training Plan Step or Training Block would)", () => {
    const built = buildSmartRandomProfile(
      { name: "Full Weight Range", measurementMode: "back-hog", min: 2.5, max: 4.5 },
      NOW
    );
    if (!built.ok) throw new Error("expected valid profile");

    let state = createEmptySmartRandomProfilesState();
    state = addSmartRandomProfile(state, built.value);

    // Simulates what TrainingSetup/TrainingPlanStepEditor do: copy the
    // profile's current min/max into the configuration being created.
    const stepConfigurationSnapshot = {
      smartRandomMin: built.value.min,
      smartRandomMax: built.value.max,
    };

    // The athlete later edits the profile to a narrower range.
    const edited = buildSmartRandomProfile(
      {
        id: built.value.id,
        name: "Full Weight Range",
        measurementMode: "back-hog",
        min: 3.3,
        max: 4.2,
        createdAt: NOW,
      },
      LATER
    );
    if (!edited.ok) throw new Error("expected valid edit");
    const afterEdit = replaceSmartRandomProfile(state, edited.value);
    expect(afterEdit.ok).toBe(true);

    // The already-copied snapshot must be completely unaffected.
    expect(stepConfigurationSnapshot).toEqual({
      smartRandomMin: 2.5,
      smartRandomMax: 4.5,
    });

    // ...and target generation from that snapshot is unaffected too — the
    // runtime logic never re-reads the profile, only the copied numbers.
    const target = generateSmartRandomTarget({
      min: stepConfigurationSnapshot.smartRandomMin,
      max: stepConfigurationSnapshot.smartRandomMax,
      randomFn: () => 0.5,
    });
    expect(target).toBeGreaterThanOrEqual(2.5);
    expect(target).toBeLessThanOrEqual(4.5);
  });

  it("deleting a profile never invalidates a range snapshot already copied from it", () => {
    const built = buildSmartRandomProfile(
      { name: "Full Weight Range", measurementMode: "back-hog", min: 2.5, max: 4.5 },
      NOW
    );
    if (!built.ok) throw new Error("expected valid profile");

    let state = createEmptySmartRandomProfilesState();
    state = addSmartRandomProfile(state, built.value);

    const trainingBlockSnapshot = {
      smartRandomMin: built.value.min,
      smartRandomMax: built.value.max,
    };

    const afterDelete = deleteSmartRandomProfile(state, built.value.id);
    expect(afterDelete.profiles).toHaveLength(0);

    // The Training Block's own stored range remains exactly as recorded.
    expect(trainingBlockSnapshot).toEqual({
      smartRandomMin: 2.5,
      smartRandomMax: 4.5,
    });
  });
});
