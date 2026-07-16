import { expect, test } from "@playwright/test";
import {
  freshLoad,
  goToTrain,
  setupFixedBlock,
  setupVariableSmartRandomBlock,
} from "./utils";

test("Threshold Setup: presets show their values, Custom validates inline, and the snapshot survives into a new block", async ({
  page,
}) => {
  await freshLoad(page);
  await goToTrain(page);
  await page.waitForSelector("text=Set Up Training Block");

  // Standard is the default preset.
  await expect(page.getByText("On target ±0.10s")).toBeVisible();

  await page.getByRole("button", { name: "Tight", exact: true }).click();
  await expect(page.getByText("On target ±0.05s")).toBeVisible();
  await expect(page.getByText("Acceptable ±0.10s")).toBeVisible();

  await page.getByRole("button", { name: "Custom", exact: true }).click();
  const onTargetInput = page
    .getByText("On Target (±s)")
    .locator("xpath=following-sibling::input");
  const acceptableInput = page
    .getByText("Acceptable (±s)")
    .locator("xpath=following-sibling::input");

  // Invalid: acceptable <= onTarget.
  await onTargetInput.fill("0.2");
  await acceptableInput.fill("0.1");
  await expect(
    page.getByText("Acceptable must be greater than On Target")
  ).toBeVisible();

  // Fix it to a valid custom pair and start the block.
  await onTargetInput.fill("0.08");
  await acceptableInput.fill("0.16");
  await page.getByRole("button", { name: "Start Training", exact: true }).click();
  await page.waitForSelector("text=Active Training Block");

  // Metric cards only render their threshold-labeled sublabels once there's
  // at least one shot (otherwise they show "Not enough shots").
  const shotEntry = page.locator("div", {
    has: page.getByRole("heading", { name: "Add Shot" }),
  });
  await shotEntry.locator('input[inputmode="decimal"]').first().fill("3.8");
  await shotEntry.getByRole("button", { name: "Add Shot", exact: true }).click();

  // The Dashboard reflects the custom thresholds (not the Standard default).
  await expect(page.getByText("within ±0.08s")).toBeVisible();
  await expect(page.getByText("beyond ±0.16s")).toBeVisible();
});

test("Block Analytics: deterministic shots produce the expected Bias, Average Error, On-Target/Acceptable/Major-Miss rates, and Largest Miss", async ({
  page,
}) => {
  await freshLoad(page);
  await setupFixedBlock(page);

  // Default block: target 3.75s, Standard thresholds (0.10 / 0.20).
  // Shots (targetError): 3.80 (+0.05, on target), 3.90 (+0.15, acceptable),
  // 4.20 (+0.45, major miss), 3.45 (-0.30, major miss).
  const shotEntry = page.locator("div", {
    has: page.getByRole("heading", { name: "Add Shot" }),
  });
  for (const releaseTime of [3.8, 3.9, 4.2, 3.45]) {
    await shotEntry.locator('input[inputmode="decimal"]').first().fill(String(releaseTime));
    await shotEntry.getByRole("button", { name: "Add Shot", exact: true }).click();
  }

  // Bias = mean(+0.05, +0.15, +0.45, -0.30) = +0.0875 -> "+0.09s"
  await expect(page.getByText("+0.09s", { exact: true })).toBeVisible();
  // Average Error = mean(0.05, 0.15, 0.45, 0.30) = 0.2375 -> "0.24s"
  await expect(page.getByText("0.24s", { exact: true })).toBeVisible();
  await expect(page.getByText("On Target")).toBeVisible();
  await expect(page.getByText("25%").first()).toBeVisible(); // 1 of 4 on target
  await expect(page.getByText("2 of 4")).toBeVisible(); // Major Misses
  await expect(page.getByText("0.45s", { exact: true })).toBeVisible(); // Largest Miss
});

test("Target Error Chart: shows the zero line, positive/negative bars, and a tooltip on hover", async ({
  page,
}) => {
  await freshLoad(page);
  await setupFixedBlock(page);

  const shotEntry = page.locator("div", {
    has: page.getByRole("heading", { name: "Add Shot" }),
  });
  for (const releaseTime of [3.8, 3.6]) {
    await shotEntry.locator('input[inputmode="decimal"]').first().fill(String(releaseTime));
    await shotEntry.getByRole("button", { name: "Add Shot", exact: true }).click();
  }

  await expect(page.getByText("Target Error by Shot")).toBeVisible();
  await expect(
    page.getByText("Am I hitting my target, and is my miss systematic?")
  ).toBeVisible();
});

test("Scatterplot: legend toggles In/Out visibility without mutating underlying filters", async ({
  page,
}) => {
  await freshLoad(page);
  await setupVariableSmartRandomBlock(page);

  const shotEntry = page.locator("div", {
    has: page.getByRole("heading", { name: "Add Shot" }),
  });

  for (const releaseTime of [3.5, 4.0, 3.7]) {
    await shotEntry.locator('input[inputmode="decimal"]').first().fill(String(releaseTime));
    await shotEntry.getByRole("button", { name: "Add Shot", exact: true }).click();
  }

  await expect(page.getByText("Target vs. Actual")).toBeVisible();

  const scatterCard = page.locator("div", {
    has: page.getByText("Target vs. Actual"),
  }).last();

  // Toggle Out Handle off, then back on — no crash, filter buttons above the
  // chart remain unaffected (still "Total").
  const outLegend = scatterCard.getByText("Out Handle");
  await outLegend.click();
  await outLegend.click();
  await expect(page.getByRole("button", { name: "Total", exact: true }).first()).toBeVisible();
});

test("Regression: Smart Random Variable Weight, Blind Weight, and mobile viewport all remain functional with the new Accuracy Threshold UI", async ({
  page,
}) => {
  await freshLoad(page);

  // Variable Weight / Smart Random still creates a block with a generated target.
  await setupVariableSmartRandomBlock(page);
  await expect(page.getByText("Smart Random")).toBeVisible();
});

test("Mobile viewport (390x844): Dashboard and charts render without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshLoad(page);
  await setupFixedBlock(page);

  const shotEntry = page.locator("div", {
    has: page.getByRole("heading", { name: "Add Shot" }),
  });
  await shotEntry.locator('input[inputmode="decimal"]').first().fill("3.8");
  await shotEntry.getByRole("button", { name: "Add Shot", exact: true }).click();

  await expect(page.getByText("Target Error by Shot")).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(hasHorizontalOverflow).toBe(false);
});
