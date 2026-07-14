import { expect, test } from "@playwright/test";
import {
  captureManualResultInput,
  freshLoad,
  setupFixedBlock,
  startAutoCapture,
} from "./utils";

// Fires two quick-value buttons via native DOM .click() calls inside a single
// page.evaluate() — both handlers run synchronously, back to back, in the exact same
// JS tick, with no `await` gap between them. This is what actually reproduces "two
// results arrive essentially simultaneously," which two separately-awaited
// Playwright .click() calls would not (each does its own actionability wait).
async function clickQuickValuesSynchronously(page: import("@playwright/test").Page, values: string[]) {
  await page.evaluate((labels) => {
    const buttons = Array.from(document.querySelectorAll("button"));
    for (const label of labels) {
      const button = buttons.find((b) => b.textContent?.trim() === label);
      (button as HTMLButtonElement | undefined)?.click();
    }
  }, values);
}

test("two simulator results fired in the same tick are both captured, in order, none lost or duplicated", async ({
  page,
}) => {
  await freshLoad(page);
  await setupFixedBlock(page);
  await startAutoCapture(page, { count: 4, handleMode: "Alternate" });

  await clickQuickValuesSynchronously(page, ["3.50s", "3.75s"]);

  await expect(page.getByText("2 / 4 shots")).toBeVisible();
  await expect(page.getByText("#1 · In", { exact: false })).toBeVisible();
  await expect(page.getByText("#2 · Out", { exact: false })).toBeVisible();
  await expect(page.getByText("3.50", { exact: false }).first()).toBeVisible();
  await expect(page.getByText("3.75", { exact: false }).first()).toBeVisible();
});

test("three simulator results fired without any await between dispatches all land, no shot-number collision", async ({
  page,
}) => {
  await freshLoad(page);
  await setupFixedBlock(page);
  await startAutoCapture(page, { count: 5, handleMode: "Fixed In" });

  await clickQuickValuesSynchronously(page, ["3.50s", "3.75s", "4.00s"]);

  await expect(page.getByText("3 / 5 shots")).toBeVisible();
  await expect(page.getByText("#1 ·", { exact: false })).toBeVisible();
  await expect(page.getByText("#2 ·", { exact: false })).toBeVisible();
  await expect(page.getByText("#3 ·", { exact: false })).toBeVisible();
});

test("a simulator result and a manual fallback fired together each get a distinct shot, and the sequence completes exactly once", async ({
  page,
}) => {
  await freshLoad(page);
  await setupFixedBlock(page);
  await startAutoCapture(page, { count: 2, handleMode: "Fixed In" });

  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const quickValue = buttons.find((b) => b.textContent?.trim() === "3.50s");
    (quickValue as HTMLButtonElement | undefined)?.click();
  });

  // Manual fallback fired essentially right after, before waiting for the UI to settle.
  const manualInput = captureManualResultInput(page);
  await manualInput.fill("3.60");
  await page.getByRole("button", { name: "Add", exact: true }).click();

  await expect(
    page.getByText("Previous capture complete: 2 / 2 shots captured.")
  ).toBeVisible();

  // A third result after completion must be diagnosed, not silently applied.
  await page.evaluate(() => {
    const buttons = Array.from(document.querySelectorAll("button"));
    const quickValue = buttons.find((b) => b.textContent?.trim() === "3.75s");
    (quickValue as HTMLButtonElement | undefined)?.click();
  });
  await expect(page.getByText(/^ignored-completed —/)).toBeVisible();
});
