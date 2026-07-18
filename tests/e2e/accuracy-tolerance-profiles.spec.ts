import { expect, test } from "@playwright/test";
import { freshLoad, goToSettings, goToTrain } from "./utils";

async function createProfile(
  page: import("@playwright/test").Page,
  { name, onTarget, acceptable }: { name: string; onTarget: string; acceptable: string }
) {
  await page.getByRole("button", { name: "Manage Accuracy Tolerances" }).click();
  await page.getByRole("button", { name: "New Profile" }).click();
  await page.getByLabel("Profile Name").fill(name);
  await page.getByLabel("On Target (±s)").fill(onTarget);
  await page.getByLabel("Acceptable (±s)").fill(acceptable);
  await page.getByRole("button", { name: "Create Profile" }).click();
}

test("creating, defaulting and using an Accuracy Tolerance Profile end to end", async ({
  page,
}) => {
  await freshLoad(page);
  await goToSettings(page);

  // Two "No profiles saved yet." sections exist (Accuracy Tolerances and
  // Smart Random Profiles) — just confirm the Settings screen loaded cleanly.
  await expect(page.getByText("No profiles saved yet.").first()).toBeVisible();

  await createProfile(page, { name: "Elite", onTarget: "0.05", acceptable: "0.10" });
  await expect(page.getByText("Elite")).toBeVisible();
  await expect(page.getByText("On Target ±0.05s · Acceptable ±0.10s")).toBeVisible();

  // Set as default.
  await page.getByRole("button", { name: "Set as Default" }).click();
  await expect(page.getByText("Default", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close Accuracy Tolerances" }).click();
  await expect(page.getByText("1 profile saved · Default: Elite")).toBeVisible();

  // Persists across reload.
  await page.reload();
  await goToSettings(page);
  await expect(page.getByText("1 profile saved · Default: Elite")).toBeVisible();

  // Quick Start: Custom preselects the default profile's values, without
  // forcing the athlete out of the Standard preset first.
  await goToTrain(page);
  await expect(page.getByText("Set Up Training Block")).toBeVisible();
  await expect(page.getByRole("button", { name: "Standard" })).toHaveClass(/bg-slate-900/);

  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await expect(page.getByText("Elite: On Target ±0.05s · Acceptable ±0.10s")).toBeVisible();

  // The athlete can still fall back to a one-off custom value.
  await page.getByLabel("Accuracy Tolerance Profile").selectOption({ label: "Custom for this exercise" });
  await expect(page.getByLabel("On Target (±s)")).toHaveValue("0.05");
  await page.getByLabel("On Target (±s)").fill("0.15");
  await page.getByLabel("Acceptable (±s)").fill("0.30");

  await page.getByRole("button", { name: "Start Training" }).click();
  await page.waitForSelector("text=Active Training Block");
});

test("editing or deleting a profile never changes an already-started Training Block", async ({
  page,
}) => {
  await freshLoad(page);
  await goToSettings(page);
  await createProfile(page, { name: "Elite", onTarget: "0.05", acceptable: "0.10" });
  await page.getByRole("button", { name: "Set as Default" }).click();
  await page.getByRole("button", { name: "Close Accuracy Tolerances" }).click();

  await goToTrain(page);
  await page.getByRole("button", { name: "Custom", exact: true }).click();
  await expect(page.getByText("Elite: On Target ±0.05s · Acceptable ±0.10s")).toBeVisible();
  await page.getByRole("button", { name: "Start Training" }).click();
  await page.waitForSelector("text=Active Training Block");

  // Now edit the profile to different values, and delete it entirely —
  // neither should require or affect the already-active Training Block.
  await goToSettings(page);
  await page.getByRole("button", { name: "Manage Accuracy Tolerances" }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Acceptable (±s)").fill("0.50");
  await page.getByRole("button", { name: "Save Profile" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete Profile" }).click();
  await expect(page.getByText("No profiles saved yet.").first()).toBeVisible();
  await page.getByRole("button", { name: "Close Accuracy Tolerances" }).click();

  // The active session/block is untouched — still on Train, still active.
  await goToTrain(page);
  await expect(page.getByText("Active Training Block", { exact: true })).toBeVisible();
});
