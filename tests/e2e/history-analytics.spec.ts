import { expect, test } from "@playwright/test";
import {
  freshLoad,
  goToAnalyze,
  setupFixedBlock,
  setupVariableSmartRandomBlock,
} from "./utils";

/** ShotEntry panel — scoped away from Auto Capture's differently-labeled controls. */
function shotEntryPanel(page: import("@playwright/test").Page) {
  return page.locator("div", {
    has: page.getByRole("heading", { name: "Add Shot" }),
  });
}

async function addShot(
  page: import("@playwright/test").Page,
  releaseTime: number,
  handle: "In" | "Out" = "In"
) {
  const panel = shotEntryPanel(page);
  await panel.getByRole("button", { name: `${handle} Handle`, exact: true }).click();
  await panel.locator('input[inputmode="decimal"]').first().fill(String(releaseTime));
  await panel.getByRole("button", { name: "Add Shot", exact: true }).click();
}

async function startNewSession(page: import("@playwright/test").Page) {
  await page.getByRole("button", { name: "Start New Session" }).click();
  await page.getByRole("button", { name: "Start", exact: true }).click();
  await page.waitForSelector("text=Set Up Training Block");
}

test("Sticky filters update all History analytics together", async ({ page }) => {
  await freshLoad(page);

  // Session 1: Fixed Weight, target 3.75s, one In and one Out handle shot.
  await setupFixedBlock(page);
  await addShot(page, 3.8, "In");
  await addShot(page, 3.9, "Out");
  await startNewSession(page);

  await goToAnalyze(page);

  await expect(page.getByText("Key Progress Summary")).toBeVisible();
  await expect(page.getByText(/\d+ blocks? · \d+ shots?/)).toBeVisible();

  // Sticky: scroll down, the filter bar (Training Category select) stays reachable.
  await page.mouse.wheel(0, 800);
  await expect(page.getByLabel("Training Category")).toBeVisible();

  // Changing the Handle filter updates the context summary's shot count.
  const before = await page.getByText(/\d+ blocks? · \d+ shots?/).textContent();
  await page.getByLabel("Handle", { exact: true }).selectOption("in");
  await expect(page.getByText(/\d+ blocks? · \d+ shots?/)).not.toHaveText(
    before ?? ""
  );
});

test("Category Progress: switching Training Category shows only comparable blocks", async ({
  page,
}) => {
  await freshLoad(page);

  // Fixed Weight block, then a Variable Weight block in the same session.
  await setupFixedBlock(page);
  await addShot(page, 3.8);

  await page.getByRole("button", { name: "New Training Block" }).click();
  await page.getByRole("button", { name: "Variable Weight", exact: true }).click();
  await page.getByRole("button", { name: "Start Block", exact: true }).click();
  await page.waitForSelector("text=Active Training Block");
  await addShot(page, 3.6);
  await addShot(page, 4.0);

  await startNewSession(page);
  await goToAnalyze(page);

  await page.getByLabel("Training Category").selectOption("variable");
  await expect(
    page.getByText("Variable Weight · Backline – Hog", { exact: true })
  ).toBeVisible();

  await page.getByLabel("Training Category").selectOption("fixed");
  await expect(
    page.getByText("Fixed Weight · Backline – Hog", { exact: true })
  ).toBeVisible();
});

test("Multi-session Scatterplot combines shots across sessions and blocks", async ({
  page,
}) => {
  await freshLoad(page);

  await setupVariableSmartRandomBlock(page);
  await addShot(page, 3.5);
  await addShot(page, 4.0);
  await startNewSession(page);

  await setupVariableSmartRandomBlock(page);
  await addShot(page, 3.7);
  await startNewSession(page);

  await goToAnalyze(page);
  await page.getByLabel("Training Category").selectOption("variable");

  const scatterCard = page.locator("div", {
    has: page.getByText("Target vs. Actual", { exact: false }),
  }).last();

  await expect(scatterCard).toBeVisible();
  await expect(
    page.getByText(/Points combine shots from \d+ blocks across \d+ sessions\./)
  ).toBeVisible();
});

test("Metric Info popover opens with an explanation and closes with Escape", async ({
  page,
}) => {
  await freshLoad(page);
  await setupFixedBlock(page);
  await addShot(page, 3.8);

  const infoButton = page.getByRole("button", { name: "About Average Error" });
  await infoButton.click();

  await expect(
    page.getByText("Average absolute difference between actual and target time.")
  ).toBeVisible();

  await page.keyboard.press("Escape");
  await expect(
    page.getByText("Average absolute difference between actual and target time.")
  ).toHaveCount(0);

  // Focus returns to the trigger button (keyboard-operable, per accessibility rules).
  await expect(infoButton).toBeFocused();
});

test("Chart Info popover distinguishes a statistical outlier from a Major Miss", async ({
  page,
}) => {
  await freshLoad(page);
  await setupFixedBlock(page);
  await addShot(page, 3.8);

  const boxplotInfo = page.getByRole("button", { name: "About Handle Boxplot" });
  await boxplotInfo.click();
  await expect(
    page.getByText("Statistical outliers are not the same as Major Misses.")
  ).toBeVisible();
});

test("Compare: Custom reveals threshold fields, validates, re-classifies shots, and survives reload", async ({
  page,
}) => {
  await freshLoad(page);

  // Default block: Fixed Weight, target 3.75s, Standard thresholds (0.10/0.20).
  await setupFixedBlock(page);
  // targetError = +0.15 -> Acceptable under Standard (0.10 < 0.15 <= 0.20).
  await addShot(page, 3.9);
  await startNewSession(page);

  await goToAnalyze(page);

  const onTargetCard = page
    .getByText("On Target", { exact: true })
    .locator('xpath=ancestor::div[contains(@class,"rounded-xl")][1]');
  await expect(onTargetCard.getByText("0%")).toBeVisible();
  await expect(page.getByText("within ±0.10s").first()).toBeVisible();

  const scatterPointCount = await page.locator(".recharts-scatter-symbol").count();

  // Selecting Custom reveals the fields — this is the bug that was fixed:
  // previously nothing appeared.
  await page.getByLabel("Threshold Comparison Mode").selectOption("custom");
  const onTargetInput = page.getByLabel("Custom On Target threshold");
  const acceptableInput = page.getByLabel("Custom Acceptable threshold");
  await expect(onTargetInput).toBeVisible();
  await expect(acceptableInput).toBeVisible();

  // Invalid: acceptable <= onTarget — Apply stays disabled, error shown at the field.
  await onTargetInput.fill("0.3");
  await acceptableInput.fill("0.1");
  await expect(page.getByText("Acceptable must be greater than On Target.")).toBeVisible();
  await expect(page.getByRole("button", { name: "Apply" }).last()).toBeDisabled();

  // Valid custom values wide enough to reclassify the +0.15 shot as On Target.
  await onTargetInput.fill("0.2");
  await acceptableInput.fill("0.3");
  await page.getByRole("button", { name: "Apply" }).last().click();

  await expect(onTargetCard.getByText("100%")).toBeVisible();
  await expect(page.getByText("within ±0.20s").first()).toBeVisible();

  // Scatterplot point count (raw target/actual coordinates) is unaffected —
  // only the On Target/Acceptable/Major Miss classification changed.
  await expect(page.locator(".recharts-scatter-symbol")).toHaveCount(scatterPointCount);

  // Reload: the applied Custom comparison survives (History filters persist,
  // even though the active navigation tab itself resets to Home — see docs/adr/0009).
  await page.reload();
  await goToAnalyze(page);
  await expect(page.getByLabel("Threshold Comparison Mode")).toHaveValue("custom");
  await expect(onTargetInput).toHaveValue("0.2");
  await expect(acceptableInput).toHaveValue("0.3");
  await expect(onTargetCard.getByText("100%")).toBeVisible();

  // Back to Original Thresholds: the block's own persisted snapshot reappears.
  await page.getByLabel("Threshold Comparison Mode").selectOption("original");
  await expect(onTargetCard.getByText("0%")).toBeVisible();
  await expect(page.getByText("within ±0.10s").first()).toBeVisible();
});

test("Mobile viewport (390x844): Analyze sticky filters render without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshLoad(page);
  await setupFixedBlock(page);
  await addShot(page, 3.8);
  await startNewSession(page);

  await goToAnalyze(page);
  await expect(page.getByLabel("Training Category")).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(hasHorizontalOverflow).toBe(false);

  // Sticky filter stays reachable after scrolling.
  await page.mouse.wheel(0, 1000);
  await expect(page.getByLabel("Training Category")).toBeVisible();
});
