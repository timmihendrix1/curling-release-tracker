import { expect, test } from "@playwright/test";
import { freshLoad, goToTrain, openReleaseTimingSetup } from "./utils";

for (const width of [320, 390]) {
  test(`compact setup and recording drafts survive disclosure changes at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await freshLoad(page);
    await openReleaseTimingSetup(page);
    await page.getByRole("button", { name: "Done changing configuration" }).click();
    await expect(page.getByRole("button", { name: "Fixed Weight", exact: true })).toBeHidden();
    await expect(page.getByLabel("Target Time (s)")).toBeVisible();
    await page.screenshot({ path: info.outputPath(`setup-compact-${width}.png`), fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Change", exact: true }).click();
    await page.getByRole("radio", { name: "Both", exact: true }).click();
    await page.getByLabel("Target Speed (m/s)").fill("2.40");
    await page.getByRole("button", { name: "Done changing configuration" }).click();
    await expect(page.getByLabel("Target Speed (m/s)")).toHaveValue("2.40");
    await page.getByRole("button", { name: "Start Training", exact: true }).click();
    const entry = page.getByTestId("house-shot-entry");
    await entry.getByLabel("Release Time (s) — optional").fill("375");
    await entry.getByRole("combobox", { name: "Handle", exact: true }).selectOption("out");
    await page.getByText("Exercise settings", { exact: true }).click();
    await page.getByText("Exercise settings", { exact: true }).click();
    await expect(entry.getByLabel("Release Time (s) — optional")).toHaveValue("375");
    await entry.getByRole("button", { name: "Save Shot" }).click();
    await expect(page.getByRole("region", { name: "Live Performance" })).toContainText("1 stone recorded");
    await expect(page.getByRole("region", { name: "Live Performance" })).toContainText("0 measurements");
  });

  test(`note view retains the pending attempt and completion leaves the session open at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await freshLoad(page);
    await goToTrain(page);
    await page.getByLabel("Search exercises").fill("Eight Guards");
    await page.getByRole("button", { name: "View Details: Eight Guards, Progressively Longer" }).click();
    await expect(page.getByRole("heading", { name: "Setup and play" })).toBeVisible();
    await expect(page.getByText("People and equipment", { exact: true }).locator("..")).not.toHaveAttribute("open");
    await page.getByRole("button", { name: "Start Exercise", exact: true }).click();
    await page.getByRole("button", { name: "Outhandle", exact: true }).click();
    const score = page.getByRole("button", { name: "3 points, 75 percent" });
    await score.click();
    const scoreBox = (await score.boundingBox())!;
    expect(scoreBox.width).toBeGreaterThanOrEqual(44);
    await page.screenshot({ path: info.outputPath(`recording-${width}.png`), fullPage: true, animations: "disabled" });
    await page.locator("summary").filter({ hasText: "Private athlete note" }).click();
    await expect(page.getByRole("heading", { name: "Record outcome" })).toBeHidden();
    await page.getByLabel("Private athlete note").fill("Keep this observation.");
    await page.screenshot({ path: info.outputPath(`note-expanded-${width}.png`), fullPage: true, animations: "disabled" });
    await page.getByRole("button", { name: "Back to recording" }).click();
    await expect(score).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByRole("button", { name: "Outhandle", exact: true })).toHaveAttribute("aria-pressed", "true");
    await expect(page.getByText("0 scored · 0 excluded", { exact: true })).toBeVisible();
    await expect(page.getByText("· Added", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Record Stone", exact: true }).click();
    await expect(page.getByText("1 scored · 0 excluded", { exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Complete Exercise", exact: true }).click();
    await expect(page.getByText("Your session stays open for another exercise.")).toBeVisible();
    await expect(page.getByRole("region", { name: "Exercise result" })).toContainText("75%");
    await expect(page.getByRole("button", { name: "Complete Session", exact: true })).toHaveCount(1);
    await page.screenshot({ path: info.outputPath(`result-${width}.png`), fullPage: true, animations: "disabled" });
    await page.locator("summary").filter({ hasText: "Private athlete note" }).click();
    await expect(page.getByLabel("Private athlete note")).toHaveValue("Keep this observation.");
    await page.getByRole("button", { name: "Back to Exercise Library", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Exercises", exact: true })).toBeVisible();
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    // Continuing from the completed result starts another exercise in the same open Session.
    await page.getByLabel("Search exercises").fill("Release Point");
    const technique = page.getByRole("button", { name: /^Technique,/ });
    if (await technique.getAttribute("aria-expanded") === "false") await technique.click();
    await page.getByRole("button", { name: "View Details: Release Point" }).click();
    await page.getByRole("button", { name: "Start Exercise", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Observe and discuss" })).toBeVisible();
    await expect(page.getByRole("button", { name: /points/ })).toHaveCount(0);
    await page.getByLabel("Private athlete note").fill("Release felt more consistent after the third delivery.");
    await page.screenshot({ path: info.outputPath(`technique-${width}.png`), fullPage: true, animations: "disabled" });
  });
}
