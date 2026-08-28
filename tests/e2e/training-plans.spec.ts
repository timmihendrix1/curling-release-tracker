import { expect, test } from "@playwright/test";
import {
  freshLoad,
  goToAnalyze,
  goToTrain,
  seedProfileScopedSportingValue,
} from "./utils";

const TRAINING_PLANS_STORAGE_KEY = "curling-release-tracker-training-plans";

function releaseTimingStep(overrides: {
  id: string;
  stones: number;
  handleStrategy: Record<string, unknown>;
}) {
  return {
    id: overrides.id,
    type: "release-timing",
    completion: { type: "shot-count", value: overrides.stones },
    handleStrategy: overrides.handleStrategy,
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
  };
}

// Seeded via addInitScript (before any app script runs) — same technique as
// corrupt-persistence.spec.ts, avoiding a race against TrackerApp's own mount effect.
async function seedTrainingPlan(page: import("@playwright/test").Page) {
  const plan = {
    id: "plan-1",
    name: "Release Consistency",
    createdAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
    schemaVersion: 1,
    steps: [
      releaseTimingStep({
        id: "step-1",
        stones: 2,
        handleStrategy: { type: "alternating", startingHandle: "in" },
      }),
      releaseTimingStep({
        id: "step-2",
        stones: 2,
        handleStrategy: { type: "free" },
      }),
    ],
  };

  await seedProfileScopedSportingValue(page, TRAINING_PLANS_STORAGE_KEY, {
    schemaVersion: 1,
    plans: [plan],
  });
  await page.goto("/");
}

async function addShot(page: import("@playwright/test").Page, releaseTime: string) {
  await page.getByPlaceholder("3.75 or 375").fill(releaseTime);
  await page.getByRole("button", { name: "Add Shot" }).click();
}

test("creates and executes a Training Plan end to end, surviving a mid-plan reload, and shows correctly in History", async ({
  page,
}) => {
  await seedTrainingPlan(page);
  await goToTrain(page);

  await page.getByRole("tab", { name: "Training Plans" }).click();
  await expect(page.getByText("Release Consistency")).toBeVisible();
  await expect(page.getByText("2 steps · 4 planned timing stones")).toBeVisible();

  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "Start Training" }).click();
  await page.waitForSelector("text=Active Training Block");

  await expect(page.getByText(/Step 1 of 2/)).toBeVisible();
  await expect(page.getByText("Stone 0 of 2")).toBeVisible();

  await addShot(page, "3.75");
  await expect(page.getByText("Stone 1 of 2")).toBeVisible();

  // Alternating handles, starting In — after one saved shot Out Handle is expected.
  await expect(
    page.locator("h2", { hasText: "Add Shot" }).locator("..").getByRole("button", { name: "Out Handle" })
  ).toHaveClass(/bg-slate-900/);

  // Reload mid-plan — the active step, shot count and created block must all
  // survive. Reload itself lands on Home by default (same as any other active
  // Training session without a running Capture Sequence — see
  // docs/SYSTEM_ARCHITECTURE.md's "Default view and reload behavior");
  // navigating back to Train shows the plan exactly where it was left.
  await page.reload();
  await goToTrain(page);
  await expect(page.getByText(/Step 1 of 2/)).toBeVisible();
  await expect(page.getByText("Stone 1 of 2")).toBeVisible();
  await expect(page.getByText("Active Training Block", { exact: true })).toBeVisible();

  await addShot(page, "3.80");
  await expect(page.getByText("Step complete — Release Time")).toBeVisible();
  await expect(page.getByText("Next: Release Time")).toBeVisible();

  await page.getByRole("button", { name: "Continue to Next Step" }).click();
  await expect(page.getByText(/Step 2 of 2/)).toBeVisible();
  await expect(page.getByText("Stone 0 of 2")).toBeVisible();

  await addShot(page, "3.76");
  await expect(page.getByText("Stone 1 of 2")).toBeVisible();
  await addShot(page, "3.77");

  await expect(page.getByText("Plan complete")).toBeVisible();
  await expect(page.getByText("All 2 steps completed.")).toBeVisible();
  await expect(page.getByText("Step complete — Release Time")).not.toBeVisible();

  await page.getByRole("button", { name: "Finish Training" }).click();
  await page.getByRole("button", { name: "Start New Session" }).waitFor();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.waitForSelector("text=Set Up Training Block");

  await goToAnalyze(page);
  await expect(page.getByText("Blocks and Sessions")).toBeVisible();
  await expect(page.getByText("Started from: Release Consistency")).toBeVisible();
});

test("creates and executes a profile-owned mixed Technique, Shotmaking and Release Time plan", async ({
  page,
}) => {
  await freshLoad(page);
  await goToTrain(page);
  await page.getByRole("tab", { name: "Training Plans" }).click();
  await page.getByRole("button", { name: "Create Training Plan" }).click();
  await page.getByPlaceholder("e.g. Release Consistency").fill("Mixed Ice Practice");

  async function addCuratedStep(exerciseTitle: string) {
    await page.getByRole("button", { name: "Add Step" }).click();
    await page
      .getByRole("button", { name: "Technique, Shotmaking or Measured Exercise" })
      .click();
    await page.getByLabel("Exercise").selectOption({ label: exerciseTitle });
    await page.getByRole("button", { name: "Add Step" }).last().click();
  }

  await addCuratedStep("Release Point — Technique · Exercise version 1");
  await addCuratedStep(
    "Eight Guards, Progressively Longer — Shotmaking · Exercise version 3"
  );
  await addCuratedStep("Rotation Count — Measured · Exercise version 1");

  await page.getByRole("button", { name: "Add Step" }).click();
  await page.getByRole("button", { name: "Release Time Measurement" }).click();
  await page.getByLabel("Number of Stones").fill("1");
  await page.getByRole("button", { name: "Add Step" }).last().click();
  await page.getByRole("button", { name: "Save Training Plan" }).click();

  await expect(page.getByText("Mixed Ice Practice")).toBeVisible();
  await expect(page.getByText("4 steps · 1 planned timing stone")).toBeVisible();
  await expect(page.getByText("Technique · Shotmaking · Measured")).toBeVisible();
  await page.getByRole("button", { name: "Start" }).click();
  await expect(
    page.getByText("This plan runs in your Profile. Team-plan execution is not included yet.")
  ).toBeVisible();
  await page.getByRole("button", { name: "Start Training" }).click();

  await expect(page.getByRole("heading", { name: "Release Point" })).toBeVisible();
  await expect(page.getByText(/Step 1 of 4/)).toBeVisible();
  await page.getByRole("button", { name: "Complete Exercise" }).click();
  await expect(page.getByText("Next: Eight Guards, Progressively Longer")).toBeVisible();

  // A completed curated step remains the active plan surface until Continue,
  // including after a cold UI reload where activeExerciseExecutionId is terminally clear.
  await page.reload();
  await goToTrain(page);
  await expect(page.getByText(/Step 1 of 4/)).toBeVisible();
  await expect(page.getByText("Next: Eight Guards, Progressively Longer")).toBeVisible();
  await page.getByRole("button", { name: "Continue to Next Step" }).click();

  await expect(
    page.getByRole("heading", { name: "Eight Guards, Progressively Longer" })
  ).toBeVisible();
  await expect(page.getByText(/Step 2 of 4/)).toBeVisible();
  await page.getByRole("button", { name: "Inhandle" }).click();
  await page.getByLabel("Rotation Count (optional)").fill("2.5");
  await page.getByRole("button", { name: "4 points, 100 percent" }).click();
  await page.getByRole("button", { name: "Record Stone" }).click();
  await expect(page.getByText("1 stone recorded")).toBeVisible();
  await expect(page.getByText(/2.5 rotations/)).toBeVisible();

  // The typed Exercise runtime and its result must survive the same reload boundary
  // as an existing Release Time block.
  await page.reload();
  await goToTrain(page);
  await expect(page.getByText(/Step 2 of 4/)).toBeVisible();
  await expect(page.getByText("Stone 1 · Inhandle · 4\/4 \(100%\) · 2.5 rotations")).toBeVisible();
  await page.getByRole("button", { name: "Complete Exercise" }).click();
  await expect(page.getByText("Next: Rotation Count")).toBeVisible();
  await page.getByRole("button", { name: "Continue to Next Step" }).click();

  await expect(page.getByRole("heading", { name: "Rotation Count" })).toBeVisible();
  await expect(page.getByText(/Step 3 of 4/)).toBeVisible();
  await page.getByLabel(/Rotation Count/).fill("2.5");
  await page.getByRole("button", { name: "Record Measurement" }).click();
  await expect(page.getByText(/2.5 rotations/)).toHaveCount(2);
  await page.getByRole("button", { name: "Complete Exercise" }).click();
  await expect(page.getByText("Next: Release Time")).toBeVisible();
  await page.getByRole("button", { name: "Continue to Next Step" }).click();

  await expect(page.getByText(/Step 4 of 4/)).toBeVisible();
  await expect(page.getByText("Stone 0 of 1")).toBeVisible();
  await addShot(page, "3.75");
  await expect(page.getByText("Plan complete")).toBeVisible();
  await expect(page.getByText("All 4 steps completed.")).toBeVisible();
});
