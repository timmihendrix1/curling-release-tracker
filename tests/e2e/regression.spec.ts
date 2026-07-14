import { expect, test } from "@playwright/test";
import { freshLoad, setupFixedBlock } from "./utils";

test("classic manual entry, History navigation, and New Block still work", async ({
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
  await shotEntryPanel.getByRole("button", { name: "In Handle" }).click();
  await shotEntryPanel.getByRole("button", { name: "draw", exact: true }).click();
  await shotEntryPanel.getByRole("button", { name: "Add Shot" }).click();

  await expect(page.getByText("1 shot total")).toBeVisible();
  await expect(page.getByText("#1 · In · draw")).toBeVisible();

  // History navigation must still work (this was the subject of an earlier, separate
  // diagnostic pass and must keep working after the Capture Sequence navigation guard
  // was added onto the same button).
  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByText("Blocks and Sessions")).toBeVisible();

  await page.getByRole("button", { name: "Current Session" }).click();
  await expect(
    page.getByText("Active Training Block", { exact: true })
  ).toBeVisible();

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
