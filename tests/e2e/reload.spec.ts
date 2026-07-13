import { expect, test } from "@playwright/test";
import {
  captureManualResultInput,
  freshLoad,
  setupFixedBlock,
  startAutoCapture,
} from "./utils";

test("a running sequence survives reload as paused, with progress intact", async ({
  page,
}) => {
  await freshLoad(page);
  await setupFixedBlock(page);
  await startAutoCapture(page, { count: 5, handleMode: "Fixed In" });

  await captureManualResultInput(page).fill("3.70");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("1 / 5 shots")).toBeVisible();

  await page.reload();

  // The provider must never silently keep running after a reload — the sequence
  // comes back paused, with its captured progress preserved, and needs an explicit
  // Resume.
  await expect(page.getByText("1 / 5 shots")).toBeVisible();
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByText("Running", { exact: true })).toBeVisible();

  await captureManualResultInput(page).fill("3.72");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("2 / 5 shots")).toBeVisible();
});
