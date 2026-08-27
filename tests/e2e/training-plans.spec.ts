import { expect, test } from "@playwright/test";
import { goToAnalyze, goToTrain, seedProfileScopedSportingValue } from "./utils";

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
  await expect(page.getByText("2 steps · 4 stones")).toBeVisible();

  await page.getByRole("button", { name: "Start" }).click();
  await page.getByRole("button", { name: "Start Training" }).click();
  await page.waitForSelector("text=Active Training Block");

  await expect(page.getByText(/Step 1 of 2/)).toBeVisible();
  await expect(page.getByText("Shot 0 of 2")).toBeVisible();

  await addShot(page, "3.75");
  await expect(page.getByText("Shot 1 of 2")).toBeVisible();

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
  await expect(page.getByText("Shot 1 of 2")).toBeVisible();
  await expect(page.getByText("Active Training Block", { exact: true })).toBeVisible();

  await addShot(page, "3.80");
  await expect(page.getByText("Step complete — Fixed Weight")).toBeVisible();
  await expect(page.getByText("Next: Fixed Weight")).toBeVisible();

  await page.getByRole("button", { name: "Continue to Next Step" }).click();
  await expect(page.getByText(/Step 2 of 2/)).toBeVisible();
  await expect(page.getByText("Shot 0 of 2")).toBeVisible();

  await addShot(page, "3.76");
  await expect(page.getByText("Shot 1 of 2")).toBeVisible();
  await addShot(page, "3.77");

  await expect(page.getByText("Plan complete")).toBeVisible();
  await expect(page.getByText("4 of 4 planned stones recorded.")).toBeVisible();
  await expect(page.getByText("Step complete — Fixed Weight")).not.toBeVisible();

  await page.getByRole("button", { name: "Finish Training" }).click();
  await page.getByRole("button", { name: "Start New Session" }).waitFor();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.waitForSelector("text=Set Up Training Block");

  await goToAnalyze(page);
  await expect(page.getByText("Blocks and Sessions")).toBeVisible();
  await expect(page.getByText("Started from: Release Consistency")).toBeVisible();
});
