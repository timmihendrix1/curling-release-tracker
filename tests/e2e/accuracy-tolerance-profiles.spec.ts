import { expect, test } from "@playwright/test";
import { freshLoad, goToSettings, goToTrain, openReleaseTimingSetup } from "./utils";

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

  // Two "0 saved" sections exist (Accuracy Tolerances and
  // Smart Random Profiles) — just confirm the Settings screen loaded cleanly.
  await expect(page.getByText("0 saved").first()).toBeVisible();

  await createProfile(page, { name: "Elite", onTarget: "0.05", acceptable: "0.10" });
  await expect(page.getByText("Elite")).toBeVisible();
  await expect(page.getByText("On Target ±0.05s · Acceptable ±0.10s")).toBeVisible();

  // Set as default.
  await page.getByRole("button", { name: "Set as Default" }).click();
  await expect(page.getByText("Default", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close Accuracy Tolerances" }).click();
  await expect(page.getByText("1 saved · Elite")).toBeVisible();

  // Persists across reload.
  await page.reload();
  await goToSettings(page);
  await expect(page.getByText("1 saved · Elite")).toBeVisible();

  // Release Time setup: the default template already seeds the configuration, and the
  // compact summary states it without the athlete opening anything (Stage B replaced
  // the Standard/Tight/Custom preset row with one summary and one Adjust action).
  await openReleaseTimingSetup(page);
  await expect(
    page.getByText("On Target ±0.05s · Acceptable ±0.10s")
  ).toBeVisible();

  // Adjust opens the editor, where the saved template is offered directly — there is
  // no "Custom" step to find first.
  await page.getByRole("button", { name: "Adjust" }).click();
  await expect(page.getByLabel("On Target (±s)")).toHaveValue("0.05");
  await expect(
    page.getByLabel("Start from a saved value").getByRole("option", { name: /Elite/ })
  ).toHaveCount(1);

  // The athlete can still type a one-off value over it.
  await page.getByLabel("On Target (±s)").fill("0.15");
  await page.getByLabel("Acceptable (±s)").fill("0.30");

  await page.getByRole("button", { name: "Start Training" }).click();
  await page.getByRole("button", { name: "Complete Session", exact: true }).waitFor();
});

test("editing or deleting a profile never changes an already-started Training Block", async ({
  page,
}) => {
  await freshLoad(page);
  await goToSettings(page);
  await createProfile(page, { name: "Elite", onTarget: "0.05", acceptable: "0.10" });
  await page.getByRole("button", { name: "Set as Default" }).click();
  await page.getByRole("button", { name: "Close Accuracy Tolerances" }).click();

  await openReleaseTimingSetup(page);
  await expect(
    page.getByText("On Target ±0.05s · Acceptable ±0.10s")
  ).toBeVisible();
  await page.getByRole("button", { name: "Start Training" }).click();
  await page.getByRole("button", { name: "Complete Session", exact: true }).waitFor();

  // Now edit the profile to different values, and delete it entirely —
  // neither should require or affect the already-active Training Block.
  await goToSettings(page);
  await page.getByRole("button", { name: "Manage Accuracy Tolerances" }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Acceptable (±s)").fill("0.50");
  await page.getByRole("button", { name: "Save Profile" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete Profile" }).click();
  await expect(page.getByText("0 saved").first()).toBeVisible();
  await page.getByRole("button", { name: "Close Accuracy Tolerances" }).click();

  // The active session/block is untouched — still on Train, still active.
  await goToTrain(page);
  await expect(page.getByRole("button", { name: "Complete Session", exact: true })).toBeVisible();
});
