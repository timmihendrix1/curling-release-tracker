import { expect, test } from "@playwright/test";
import {
  clearLocalSportingState,
  completeFullAssessment,
  freshLoad,
  goToAnalyze,
  goToSettings,
  readCloudSportingRecords,
  setupFixedBlock,
} from "./utils";

test("completed training history restores from Free cloud and a clear tombstone prevents resurrection", async ({
  page,
}) => {
  await freshLoad(page);
  await setupFixedBlock(page);

  const shotEntry = page.locator("div", {
    has: page.getByRole("heading", { name: "Add Shot" }),
  }).last();
  await shotEntry.locator('input[inputmode="decimal"]').first().fill("3.80");
  await shotEntry.getByRole("button", { name: "Add Shot", exact: true }).click();

  await page.getByRole("button", { name: "Start New Session" }).click();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.waitForSelector("text=Set Up Training Block");

  await expect
    .poll(async () => (await readCloudSportingRecords(page)).filter(
      (record) => record.record_kind === "training_session"
    ).length)
    .toBe(1);

  // Simulate opening the same Profile on a device with no sporting localStorage.
  await clearLocalSportingState(page);
  await page.reload();
  await page.waitForSelector("text=Today's Plan");
  await goToAnalyze(page);
  await expect(page.getByText("Key Progress Summary")).toBeVisible();
  await expect(page.getByText("1 block · 1 shot")).toBeVisible();

  await goToSettings(page);
  await page.getByRole("button", { name: "Clear History" }).click();
  await page.getByRole("button", { name: "Clear All" }).click();
  await expect(page.getByRole("button", { name: "Export History CSV" })).toBeDisabled();
  await expect.poll(async () => (await readCloudSportingRecords(page)).length).toBe(0);

  // A second blank-device reload proves the deleted server record is not restored.
  await clearLocalSportingState(page);
  await page.reload();
  await page.waitForSelector("text=Today's Plan");
  await goToSettings(page);
  await expect(page.getByRole("button", { name: "Export History CSV" })).toBeDisabled();
  await expect(await readCloudSportingRecords(page)).toHaveLength(0);
});

test("a terminal Assessment restores from Free cloud and remains deleted after a blank-device reload", async ({
  page,
}) => {
  await freshLoad(page);
  await completeFullAssessment(page);

  await expect
    .poll(async () => (await readCloudSportingRecords(page)).filter(
      (record) => record.record_kind === "assessment_run"
    ).length)
    .toBe(1);

  await clearLocalSportingState(page);
  await page.reload();
  await page.waitForSelector("text=Today's Plan");
  await goToAnalyze(page);
  await page.getByRole("tab", { name: "Assessments" }).click();
  await expect(page.getByRole("heading", { name: "Latest Completed Assessment" })).toBeVisible();

  await page.getByRole("button", { name: "View Results" }).first().click();
  await page.getByRole("button", { name: "Delete Run" }).click();
  await page.getByRole("button", { name: "Delete Run" }).last().click();
  await expect.poll(async () => (await readCloudSportingRecords(page)).length).toBe(0);

  await clearLocalSportingState(page);
  await page.reload();
  await page.waitForSelector("text=Today's Plan");
  await goToAnalyze(page);
  await page.getByRole("tab", { name: "Assessments" }).click();
  await expect(page.getByRole("heading", { name: "No completed assessments yet." })).toBeVisible();
  await expect(await readCloudSportingRecords(page)).toHaveLength(0);
});
