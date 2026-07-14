import { expect, test } from "@playwright/test";
import { freshLoad, setupFixedBlock, startAutoCapture } from "./utils";

test("pausing discards new results and resuming lets capture continue", async ({
  page,
}) => {
  await freshLoad(page);
  await setupFixedBlock(page);
  await startAutoCapture(page, { count: 2, handleMode: "Fixed In" });

  await page.getByRole("button", { name: "Pause" }).click();
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();

  // A result arriving while paused must be discarded, not buffered or saved.
  await page.getByRole("button", { name: "3.75s" }).click();
  await expect(page.getByText("0 / 2 shots")).toBeVisible();
  await expect(page.getByText(/^ignored-paused —/)).toBeVisible();

  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByText("Running", { exact: true })).toBeVisible();

  await page.getByRole("button", { name: "3.75s" }).click();
  await expect(page.getByText("1 / 2 shots")).toBeVisible();
});
