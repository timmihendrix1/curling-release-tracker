import { expect, test } from "@playwright/test";
import { freshLoad, goToSettings, goToTrain } from "./utils";

async function createProfile(
  page: import("@playwright/test").Page,
  { name, min, max }: { name: string; min: string; max: string }
) {
  await page.getByRole("button", { name: "Manage Smart Random Profiles" }).click();
  await page.getByRole("button", { name: "New Profile" }).click();
  await page.getByLabel("Profile Name").fill(name);
  await page.getByLabel("Minimum Target Time").fill(min);
  await page.getByLabel("Maximum Target Time").fill(max);
  await page.getByRole("button", { name: "Create Profile" }).click();
}

test("creating, defaulting and using a Smart Random Profile end to end", async ({
  page,
}) => {
  await freshLoad(page);
  await goToSettings(page);

  await expect(page.getByText("No profiles saved yet.").first()).toBeVisible();

  await createProfile(page, { name: "Full Weight Range", min: "2.50", max: "4.50" });
  await expect(page.getByText("Full Weight Range")).toBeVisible();
  await expect(page.getByText("2.50s–4.50s · Backline – Hog")).toBeVisible();

  await page.getByRole("button", { name: "Set as Default" }).click();
  await expect(page.getByText("Default", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Close Smart Random Profiles" }).click();
  await expect(
    page.getByText("1 profile saved · Default: Full Weight Range")
  ).toBeVisible();

  // Persists across reload.
  await page.reload();
  await goToSettings(page);
  await expect(
    page.getByText("1 profile saved · Default: Full Weight Range")
  ).toBeVisible();

  // Quick Start, Variable Weight: the default profile's range prefills
  // Smart Random Settings automatically (Smart Random is Variable Weight's
  // default target source).
  await goToTrain(page);
  await page.getByRole("button", { name: "Variable Weight" }).click();
  await expect(
    page.getByText("Full Weight Range: 2.50s–4.50s")
  ).toBeVisible();

  // The athlete can still fall back to a one-off custom range.
  await page
    .getByLabel("Smart Random Profile")
    .selectOption({ label: "Custom for this exercise" });
  await expect(page.getByLabel("Minimum Target Time")).toHaveValue("2.50");
  await page.getByLabel("Minimum Target Time").fill("3.00");
  await page.getByLabel("Maximum Target Time").fill("3.50");

  await page.getByRole("button", { name: "Start Training" }).click();
  await page.waitForSelector("text=Active Training Block");
});

test("editing or deleting a profile never changes an already-started Training Block", async ({
  page,
}) => {
  await freshLoad(page);
  await goToSettings(page);
  await createProfile(page, { name: "Full Weight Range", min: "2.50", max: "4.50" });
  await page.getByRole("button", { name: "Set as Default" }).click();
  await page.getByRole("button", { name: "Close Smart Random Profiles" }).click();

  await goToTrain(page);
  await page.getByRole("button", { name: "Variable Weight" }).click();
  await expect(
    page.getByText("Full Weight Range: 2.50s–4.50s")
  ).toBeVisible();
  await page.getByRole("button", { name: "Start Training" }).click();
  await page.waitForSelector("text=Active Training Block");

  // Now edit the profile to a different range, and delete it entirely —
  // neither should require or affect the already-active Training Block.
  await goToSettings(page);
  await page.getByRole("button", { name: "Manage Smart Random Profiles" }).click();
  await page.getByRole("button", { name: "Edit" }).click();
  await page.getByLabel("Maximum Target Time").fill("4.00");
  await page.getByRole("button", { name: "Save Profile" }).click();
  await page.getByRole("button", { name: "Delete" }).click();
  await page.getByRole("button", { name: "Delete Profile" }).click();
  await expect(page.getByText("No profiles saved yet.").first()).toBeVisible();
  await page.getByRole("button", { name: "Close Smart Random Profiles" }).click();

  // The active session/block is untouched — still on Train, still active.
  await goToTrain(page);
  await expect(page.getByText("Active Training Block", { exact: true })).toBeVisible();
});

test("Hog – Hog never shows a Smart Random Profile selector, and no profile controls leak into Coach / Manual", async ({
  page,
}) => {
  await freshLoad(page);
  await goToSettings(page);
  await createProfile(page, { name: "Full Weight Range", min: "2.50", max: "4.50" });
  await page.getByRole("button", { name: "Set as Default" }).click();
  await page.getByRole("button", { name: "Close Smart Random Profiles" }).click();

  await goToTrain(page);
  await page.getByRole("button", { name: "Variable Weight" }).click();
  await page.getByRole("button", { name: "Hog – Hog" }).click();
  await expect(page.getByText("Smart Random Settings")).toHaveCount(0);
  await expect(page.getByLabel("Smart Random Profile")).toHaveCount(0);
});
