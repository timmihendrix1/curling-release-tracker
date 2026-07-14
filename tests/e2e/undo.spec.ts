import { expect, test } from "@playwright/test";
import {
  captureManualResultInput,
  freshLoad,
  setupVariableSmartRandomBlock,
  startAutoCapture,
} from "./utils";

test("undo restores the exact pre-capture Smart Random target, not a new one", async ({
  page,
}) => {
  await freshLoad(page);
  await setupVariableSmartRandomBlock(page);
  await startAutoCapture(page, { count: 5, handleMode: "Fixed In" });

  const targetText = page
    .getByText("Current Target", { exact: true })
    .locator("..")
    .locator("p")
    .last();
  const targetBefore = await targetText.textContent();

  await captureManualResultInput(page).fill("3.60");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("1 / 5 shots")).toBeVisible();

  const targetAfterCapture = await targetText.textContent();
  expect(targetAfterCapture).not.toBe(targetBefore);

  await page.getByRole("button", { name: "Undo Last Captured Shot" }).click();
  await expect(page.getByText("0 / 5 shots")).toBeVisible();

  const targetAfterUndo = await targetText.textContent();
  expect(targetAfterUndo).toBe(targetBefore);
});

test("undo of the shot that completed a sequence reopens it as running, and a new result completes it again correctly", async ({
  page,
}) => {
  await freshLoad(page);
  await setupVariableSmartRandomBlock(page);
  await startAutoCapture(page, { count: 2, handleMode: "Fixed In" });

  await captureManualResultInput(page).fill("3.60");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("1 / 2 shots")).toBeVisible();

  await captureManualResultInput(page).fill("3.62");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText("Previous capture complete: 2 / 2 shots captured.")
  ).toBeVisible();

  // Undo remains available right after completion, on the completion summary itself.
  await page.getByRole("button", { name: "Undo Last Captured Shot" }).click();

  // Back to the running panel — status reopened, count back down.
  await expect(page.getByText("1 / 2 shots")).toBeVisible();
  await expect(page.getByText("Running", { exact: true })).toBeVisible();

  // A new result completes it again correctly (no leftover inconsistency).
  await captureManualResultInput(page).fill("3.64");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText("Previous capture complete: 2 / 2 shots captured.")
  ).toBeVisible();
});
