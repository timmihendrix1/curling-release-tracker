import { expect, test } from "@playwright/test";
import { freshLoad, goToAnalyze, goToTrain, setupFixedBlock } from "./utils";

test("classic manual entry, Analyze navigation, and New Block still work", async ({
  page,
}) => {
  await freshLoad(page);
  await setupFixedBlock(page);

  // Auto Capture is additive and renders right below ShotEntry on the same screen —
  // scope to the "Add Shot" panel so its own Handle/Shot-Type buttons (In/Out,
  // draw/takeout) can't collide with Auto Capture's own, differently-scoped controls.
  const shotEntryPanel = page
    .locator("h2", { hasText: "Add Shot" })
    .locator("..");

  await shotEntryPanel.getByPlaceholder("3.75 or 375").fill("3.80");
  await shotEntryPanel.getByRole("combobox", { name: "Handle", exact: true }).selectOption("in");
  await shotEntryPanel.getByRole("combobox", { name: "Shot type", exact: true }).selectOption("draw");
  await shotEntryPanel.getByRole("button", { name: "Save Shot" }).click();

  await expect(page.getByText("1 stone recorded")).toBeVisible();
  // Recorded stones is collapsed by default (Epic 2).
  await page.getByText(/Recorded stones/).click();
  await expect(page.getByText("#1 · In · draw")).toBeVisible();

  // Analyze navigation must still work (this was the subject of an earlier, separate
  // diagnostic pass and must keep working after the Capture Sequence navigation guard
  // was added onto the same navigation).
  await goToAnalyze(page);
  await expect(page.getByText("Blocks and Sessions")).toBeVisible();

  await goToTrain(page);
  await expect(page.getByRole("button", { name: "Complete Session", exact: true })).toBeVisible();
  await page.getByText("Exercise settings", { exact: true }).click();
  await expect(page.getByText("Current exercise", { exact: true })).toBeVisible();

  // New Training Block still works when no capture sequence is running.
  await page.getByRole("button", { name: "New Training Block" }).click();
  await expect(
    page.getByRole("heading", { name: "New Training Block" })
  ).toBeVisible();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(
    page.getByRole("heading", { name: "New Training Block" })
  ).toHaveCount(0);
});
