import { expect, test } from "@playwright/test";
import { freshLoad } from "./utils";

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
  await page.getByRole("button", { name: "Start Training", exact: true }).click();
  await page.waitForSelector("text=Active Training Block");
  await addShot(page, 3.8, "In");
  await addShot(page, 3.9, "Out");
  await startNewSession(page);

  await page.getByRole("button", { name: "History" }).click();

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
  await page.getByRole("button", { name: "Start Training", exact: true }).click();
  await page.waitForSelector("text=Active Training Block");
  await addShot(page, 3.8);

  await page.getByRole("button", { name: "New Training Block" }).click();
  await page.getByRole("button", { name: "Variable Weight" }).click();
  await page.getByRole("button", { name: "Start Block", exact: true }).click();
  await page.waitForSelector("text=Active Training Block");
  await addShot(page, 3.6);
  await addShot(page, 4.0);

  await startNewSession(page);
  await page.getByRole("button", { name: "History" }).click();

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

  await page.getByRole("button", { name: "Variable Weight" }).click();
  await page.getByRole("button", { name: "Start Training", exact: true }).click();
  await page.waitForSelector("text=Active Training Block");
  await addShot(page, 3.5);
  await addShot(page, 4.0);
  await startNewSession(page);

  await page.getByRole("button", { name: "Variable Weight" }).click();
  await page.getByRole("button", { name: "Start Training", exact: true }).click();
  await page.waitForSelector("text=Active Training Block");
  await addShot(page, 3.7);
  await startNewSession(page);

  await page.getByRole("button", { name: "History" }).click();
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
  await page.getByRole("button", { name: "Start Training", exact: true }).click();
  await page.waitForSelector("text=Active Training Block");
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
  await page.getByRole("button", { name: "Start Training", exact: true }).click();
  await page.waitForSelector("text=Active Training Block");
  await addShot(page, 3.8);

  const boxplotInfo = page.getByRole("button", { name: "About Handle Boxplot" });
  await boxplotInfo.click();
  await expect(
    page.getByText("Statistical outliers are not the same as Major Misses.")
  ).toBeVisible();
});

test("Mobile viewport (390x844): History sticky filters render without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshLoad(page);
  await page.getByRole("button", { name: "Start Training", exact: true }).click();
  await page.waitForSelector("text=Active Training Block");
  await addShot(page, 3.8);
  await startNewSession(page);

  await page.getByRole("button", { name: "History" }).click();
  await expect(page.getByLabel("Training Category")).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(hasHorizontalOverflow).toBe(false);

  // Sticky filter stays reachable after scrolling.
  await page.mouse.wheel(0, 1000);
  await expect(page.getByLabel("Training Category")).toBeVisible();
});
