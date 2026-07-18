import { describe, expect, it } from "vitest";
import { migrateTrainingPlans } from "../migration";
import { isStepExecutable } from "../validation";

describe("migrateTrainingPlans", () => {
  it("returns an empty state for undefined/absent data (first load)", () => {
    expect(migrateTrainingPlans(undefined)).toEqual({ schemaVersion: 1, plans: [] });
  });

  it("resets to empty state for an unknown/future schemaVersion", () => {
    const result = migrateTrainingPlans({ schemaVersion: 99, plans: [{ id: "p1" }] });
    expect(result).toEqual({ schemaVersion: 1, plans: [] });
  });

  it("migrates a well-formed plan through unchanged", () => {
    const raw = {
      schemaVersion: 1,
      plans: [
        {
          id: "plan-1",
          name: "Release Consistency",
          description: "Warm-up sequence",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          schemaVersion: 1,
          steps: [
            {
              id: "step-1",
              type: "release-timing",
              completion: { type: "shot-count", value: 8 },
              handleStrategy: { type: "alternating", startingHandle: "in" },
              configuration: {
                name: "",
                mode: "fixed",
                measurementMode: "back-hog",
                targetTime: 3.75,
                variableTargetMode: "smart-random",
                blindTargetMode: "fixed",
                smartRandomMin: 2.5,
                smartRandomMax: 4.5,
                accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
              },
            },
          ],
        },
      ],
    };

    const migrated = migrateTrainingPlans(raw);
    expect(migrated.plans).toHaveLength(1);
    expect(migrated.plans[0].name).toBe("Release Consistency");
    expect(migrated.plans[0].steps[0].handleStrategy).toEqual({
      type: "alternating",
      startingHandle: "in",
    });
  });

  it("drops a single structurally broken plan without discarding the rest of the list", () => {
    const raw = {
      schemaVersion: 1,
      plans: [
        "not-an-object",
        {
          id: "plan-2",
          name: "Weight Control",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          schemaVersion: 1,
          steps: [],
        },
      ],
    };

    const migrated = migrateTrainingPlans(raw);
    expect(migrated.plans).toHaveLength(1);
    expect(migrated.plans[0].name).toBe("Weight Control");
  });

  it("repairs structural gaps in a step but never fabricates a valid Hog-Hog Smart Random range", () => {
    const raw = {
      schemaVersion: 1,
      plans: [
        {
          id: "plan-3",
          name: "Legacy Plan",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          schemaVersion: 1,
          steps: [
            {
              // missing id, handleStrategy, completion — all repaired to safe defaults
              type: "release-timing",
              configuration: {
                name: "Broken Step",
                mode: "variable",
                measurementMode: "hog-hog",
                variableTargetMode: "smart-random",
                targetTime: 3.75,
              },
            },
          ],
        },
      ],
    };

    const migrated = migrateTrainingPlans(raw);
    const step = migrated.plans[0].steps[0];

    expect(typeof step.id).toBe("string");
    expect(step.handleStrategy).toEqual({ type: "free" });
    expect(step.completion.value).toBeGreaterThan(0);
    // Structurally repaired, but semantically still invalid — never silently
    // coerced into a fabricated-valid Hog-Hog Smart Random range.
    expect(isStepExecutable(step)).toBe(false);
  });

  it("is idempotent — migrating an already-migrated state twice is a no-op", () => {
    const raw = {
      schemaVersion: 1,
      plans: [
        {
          id: "plan-4",
          name: "Release Consistency",
          createdAt: "2026-01-01T00:00:00.000Z",
          updatedAt: "2026-01-01T00:00:00.000Z",
          schemaVersion: 1,
          steps: [
            {
              id: "step-1",
              type: "release-timing",
              completion: { type: "shot-count", value: 8 },
              handleStrategy: { type: "free" },
              configuration: {
                name: "",
                mode: "fixed",
                measurementMode: "back-hog",
                targetTime: 3.75,
                variableTargetMode: "smart-random",
                blindTargetMode: "fixed",
                smartRandomMin: 2.5,
                smartRandomMax: 4.5,
                accuracyThresholds: { onTarget: 0.1, acceptable: 0.2 },
              },
            },
          ],
        },
      ],
    };

    const once = migrateTrainingPlans(raw);
    const twice = migrateTrainingPlans(JSON.parse(JSON.stringify(once)));
    expect(twice).toEqual(once);
  });
});
