import { expect, test, type Page } from "@playwright/test";
import { freshLoad, goToHome, goToTrain, goToAssess, goToAnalyze, openReleaseTimingSetup, startAutoCapture, primaryNav, primaryNavDesktop } from "./utils";

async function assertFits(page: Page) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  const nav = page.viewportSize()!.width < 640 ? primaryNav(page) : primaryNavDesktop(page);
  const navBox = (await nav.boundingBox())!;
  for (const label of ["Home", "Train", "Analyze", "Settings"]) {
    const button = nav.getByRole("button", { name: label, exact: true });
    await expect(button).toBeVisible();
    const box = (await button.boundingBox())!;
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(navBox.x);
    expect(box.x + box.width).toBeLessThanOrEqual(navBox.x + navBox.width + 1);
  }
}

for (const viewport of [{ width: 320, height: 700 }, { width: 390, height: 844 }, { width: 768, height: 1024 }, { width: 1280, height: 900 }]) {
  test(`House Home and Both capture remain usable at ${viewport.width}px`, async ({ page }, info) => {
    await page.setViewportSize(viewport);
    await freshLoad(page);
    await assertFits(page);
    if (viewport.width < 640) expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(viewport.height);
    await expect(page.getByRole("region", { name: "Start training" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Resume training", exact: true })).toHaveCount(0);
    await page.mouse.move(0, 0);
    await page.screenshot({ path: info.outputPath(`home-empty-${viewport.width}.png`), fullPage: true });

    await openReleaseTimingSetup(page);
    await page.getByRole("radio", { name: "Both", exact: true }).click();
    await page.getByLabel("Target Speed (m/s)").fill("2.40");
    await page.getByRole("button", { name: "Start Training", exact: true }).click();
    const entry = page.getByTestId("house-shot-entry");
    await expect(entry).toBeVisible();
    await assertFits(page);
    // Recording is the first task, with block context folded below it.
    expect((await entry.boundingBox())!.y).toBeLessThan(viewport.width < 640 ? 180 : 280);
    const time = entry.getByLabel("Release Time (s) — optional");
    const speed = entry.getByLabel("Speed (m/s) — optional");
    await time.fill("3.75");
    await speed.fill("2,38");
    await entry.getByRole("button", { name: "Out Handle" }).click();
    await entry.getByRole("button", { name: "takeout" }).click();
    await expect(entry.getByRole("button", { name: "Out Handle" })).toHaveAttribute("aria-pressed", "true");
    for (const field of [time, speed]) {
      const box = (await field.boundingBox())!;
      expect(box.width).toBeGreaterThan(80);
      expect(box.x + box.width).toBeLessThanOrEqual(viewport.width);
    }
    await page.mouse.move(0, 0);
    await page.screenshot({ path: info.outputPath(`training-both-${viewport.width}.png`), fullPage: true });
    await entry.screenshot({ path: info.outputPath(`both-${viewport.width}.png`) });
    await entry.getByRole("button", { name: "Save Shot", exact: true }).click();
    await expect(page.getByText("1 stone recorded", { exact: true })).toBeVisible();
    await goToHome(page);
    const hero = page.getByRole("region", { name: "Current training" });
    await expect(hero.getByText("1", { exact: true })).toBeVisible();
    await page.mouse.move(0, 0);
    await page.screenshot({ path: info.outputPath(`home-active-${viewport.width}.png`), fullPage: true });
    await hero.getByRole("button", { name: "Resume training" }).click();
    await expect(page.getByText("1 stone recorded", { exact: true })).toBeVisible();
  });
}

test("House speed validation and controls remain reachable in a short viewport", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshLoad(page);
  await openReleaseTimingSetup(page);
  await page.getByRole("radio", { name: "Speed (m/s)" }).click();
  await page.getByLabel("Target Speed (m/s)").fill("2.40");
  await page.getByRole("button", { name: "Start Training", exact: true }).click();
  const entry = page.getByTestId("house-shot-entry");
  await entry.getByLabel("Speed (m/s)").fill("2..38");
  await entry.getByRole("button", { name: "Save Shot", exact: true }).click();
  await expect(entry.getByRole("alert")).toBeVisible();
  await expect(entry.getByLabel("Speed (m/s)")).toHaveValue("2..38");
  await entry.screenshot({ path: info.outputPath("speed-invalid.png") });
  await entry.getByLabel("Speed (m/s)").fill("2.38");
  await entry.screenshot({ path: info.outputPath("speed-entered.png") });
  // A reduced viewport checks scroll reachability, not physical iOS keyboard behavior.
  await page.setViewportSize({ width: 390, height: 420 });
  const save = entry.getByRole("button", { name: "Save Shot", exact: true });
  await save.scrollIntoViewIfNeeded();
  await expect(save).toBeInViewport();
  const saveBox = (await save.boundingBox())!;
  const navBox = (await primaryNav(page).boundingBox())!;
  expect(saveBox.y + saveBox.height).toBeLessThanOrEqual(navBox.y);
  await save.click();
  await expect(page.getByText("1 stone recorded", { exact: true })).toBeVisible();
  await assertFits(page);
});

test("House Time capture keeps shorthand entry and accessible keyboard submission", async ({ page }, info) => {
  await freshLoad(page);
  await openReleaseTimingSetup(page);
  await page.getByRole("button", { name: "Start Training", exact: true }).click();
  const entry = page.getByTestId("house-shot-entry");
  const time = entry.getByLabel("Release Time (s)");
  await expect(entry.getByLabel("Speed (m/s)")).toHaveCount(0);
  await entry.screenshot({ path: info.outputPath("time-empty.png") });
  await time.fill("375");
  await time.press("Enter");
  await expect(page.getByText("1 stone recorded", { exact: true })).toBeVisible();
  await expect(time).toHaveValue("");
  await time.fill("3.80");
  await entry.screenshot({ path: info.outputPath("time-entered.png") });
});

for (const width of [320, 390]) {
  test(`House exercise flow keeps references optional and completion reachable at ${width}px`, async ({ page }, info) => {
    await page.setViewportSize({ width, height: 844 });
    await freshLoad(page);
    await goToTrain(page);
    await page.getByLabel("Search exercises").fill("Eight Guards");
    await assertFits(page);
    await page.screenshot({ path: info.outputPath(`library-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "View Details: Eight Guards, Progressively Longer" }).click();
    await expect(page.getByRole("heading", { name: "Setup and instructions" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Start Exercise", exact: true })).toBeVisible();
    await page.screenshot({ path: info.outputPath(`detail-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Start Exercise", exact: true }).click();
    await expect(page.getByRole("button", { name: "Setup Complete — Start Exercise" })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Assessments", exact: true })).toHaveCount(0);
    await page.getByRole("button", { name: "Inhandle", exact: true }).click();
    const scoreButton = page.getByRole("button", { name: "3 points, 75 percent" });
    const scoreBox = (await scoreButton.boundingBox())!;
    expect(scoreBox.width).toBeGreaterThanOrEqual(44);
    expect(scoreBox.height).toBeGreaterThanOrEqual(44);
    await scoreButton.click();
    await page.getByRole("button", { name: "Record Stone", exact: true }).click();
    await expect(page.getByText("1 scored · 0 excluded")).toBeVisible();
    const resultDetails = page.locator("details").filter({ has: page.locator("summary", { hasText: "Result details and stones" }) });
    await expect(resultDetails).not.toHaveAttribute("open");
    await resultDetails.locator("summary").click();
    await expect(page.getByRole("heading", { name: "Attempt log" })).toBeVisible();
    await resultDetails.locator("summary").click();
    await page.getByLabel("Private athlete note").fill("Release felt consistent.");
    await assertFits(page);
    await page.screenshot({ path: info.outputPath(`shotmaking-${width}.png`), fullPage: true });
    await page.getByRole("button", { name: "Complete Exercise", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Exercise result" })).toBeVisible();
    await expect(page.getByLabel("Private athlete note")).toHaveValue("Release felt consistent.");
    await page.getByRole("button", { name: "Complete Session", exact: true }).click();
    await page.getByRole("button", { name: "Complete", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Exercises", exact: true })).toBeVisible();
    await expect(page.getByText("Training saved.", { exact: true })).toBeVisible();
    await assertFits(page);
    await page.screenshot({ path: info.outputPath(`finished-${width}.png`), fullPage: true });
  });
}

for (const mode of ["Variable Weight", "Blind Weight", "Auto Capture"]) {
  test(`House ${mode} preserves capture at 320px`, async ({ page }, info) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await freshLoad(page);
    await openReleaseTimingSetup(page);
    if (mode !== "Auto Capture") await page.getByRole("button", { name: mode, exact: true }).click();
    await page.getByRole("button", { name: "Start Training", exact: true }).click();
    if (mode === "Blind Weight") {
      await page.getByLabel("Predicted time", { exact: true }).fill("3.70");
      await page.getByRole("button", { name: "Lock Prediction" }).click();
      await page.getByLabel("Measured release time", { exact: true }).fill("3.80");
      await page.getByRole("button", { name: "Review Shot" }).click();
      await assertFits(page);
      await page.screenshot({ path: info.outputPath("blind-review-320.png"), fullPage: true });
      await page.getByRole("button", { name: "Save Shot & Continue" }).click();
    } else if (mode === "Auto Capture") {
      await startAutoCapture(page, { count: 2, handleMode: "Fixed In" });
      const manual = page.locator("details").filter({ has: page.locator("summary", { hasText: "Add Result Manually" }) });
      await expect(manual).not.toHaveAttribute("open");
      await manual.locator("summary").click();
      await manual.getByPlaceholder("3.75 or 375").fill("3.80");
      await manual.getByRole("button", { name: "Add", exact: true }).click();
      await expect(page.getByText("1 / 2 shots", { exact: true })).toBeVisible();
      await page.getByRole("button", { name: "Pause", exact: true }).click();
      await expect(manual.getByRole("button", { name: "Add", exact: true })).toBeDisabled();
      await assertFits(page);
      await page.screenshot({ path: info.outputPath("auto-paused-320.png"), fullPage: true });
    } else {
      const entry = page.getByTestId("house-shot-entry");
      await entry.getByLabel("Release Time (s)", { exact: true }).fill("3.80");
      await assertFits(page);
      await page.screenshot({ path: info.outputPath("variable-320.png"), fullPage: true });
      await entry.getByRole("button", { name: "Save Shot", exact: true }).click();
    }
    await expect(page.getByText("1 stone recorded", { exact: true })).toBeVisible();
  });
}

test("Shotmaking offers families, then one start; diagram corners remain uncut", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshLoad(page);
  await goToTrain(page);
  await page.getByRole("button", { name: /^Shotmaking,/ }).click();
  const families = page.getByLabel("Shotmaking categories");
  await expect(families).toBeVisible();
  await expect(page.getByRole("button", { name: "Show all exercises" })).toBeVisible();
  await families.getByRole("button", { name: "Guard", exact: true }).click();
  await expect(page.getByRole("button", { name: "View Details: Eight Guards, Progressively Longer" })).toBeVisible();
  await expect(page.getByRole("button", { name: /View Details:.*Draws into/ })).toHaveCount(0);
  await page.getByRole("button", { name: "View Details: Eight Guards, Progressively Longer" }).click();
  const diagram = page.locator("figure img").first();
  await expect(diagram).toBeVisible();
  const clipped = await diagram.evaluate((image) => {
    for (let parent = image.parentElement; parent; parent = parent.parentElement) {
      const style = getComputedStyle(parent);
      if (["hidden", "clip"].includes(style.overflow) && parseFloat(style.borderTopLeftRadius) > 0) return true;
    }
    return false;
  });
  expect(clipped).toBe(false);
  await page.screenshot({ path: info.outputPath("guard-detail-uncut.png"), fullPage: true });
  await page.getByRole("button", { name: "Start Exercise", exact: true }).click();
  await expect(page.getByRole("button", { name: "Record Stone", exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: "Setup Complete — Start Exercise" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Complete Session", exact: true })).toBeVisible();
});

test("Home with recent history and native-sized safe areas fits a phone", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshLoad(page);
  await openReleaseTimingSetup(page);
  await page.getByRole("button", { name: "Start Training", exact: true }).click();
  await page.getByLabel("Release Time (s)").fill("3.75");
  await page.getByRole("button", { name: "Save Shot", exact: true }).click();
  await page.getByRole("button", { name: "Complete Session", exact: true }).click();
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Exercises", exact: true })).toBeVisible();
  await goToHome(page);
  // Emulate the space reserved by a phone's sensor housing and Home indicator.
  await page.addStyleTag({ content: '.house-shell { padding-top: 59px; } .house-home-shell { --house-nav-clearance: 114px; }' });
  expect(await page.evaluate(() => document.documentElement.scrollHeight)).toBeLessThanOrEqual(844);
  const home = page.getByTestId("house-home");
  await expect(home.getByRole("button", { name: "See all" })).toBeInViewport();
  await expect(primaryNav(page).getByRole("button", { name: "Home", exact: true })).toHaveAttribute("aria-current", "page");
  await page.mouse.move(0, 0);
  await page.screenshot({ path: info.outputPath("home-history-safe-areas.png"), fullPage: true, animations: "disabled" });
});


test("House Assessments, Analyze, Settings and completion dialog share the phone layout", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshLoad(page);
  await goToAssess(page);
  await expect(page.getByRole("heading", { name: "Find your baseline." })).toBeVisible();
  await assertFits(page);
  await page.screenshot({ path: info.outputPath("assessments-390.png"), fullPage: true });
  await goToAnalyze(page);
  await expect(page.getByRole("heading", { name: "See your progress." })).toBeVisible();
  await assertFits(page);
  await page.screenshot({ path: info.outputPath("analyze-390.png"), fullPage: true });
  await primaryNav(page).getByRole("button", { name: "Settings" }).click();
  await expect(page.getByRole("heading", { name: "Make it yours." })).toBeVisible();
  await assertFits(page);
  await page.screenshot({ path: info.outputPath("settings-390.png"), fullPage: true });
  await openReleaseTimingSetup(page);
  await page.getByRole("button", { name: "Start Training", exact: true }).click();
  await page.getByLabel("Release Time (s)").fill("3.75");
  await page.getByRole("button", { name: "Save Shot", exact: true }).click();
  await page.getByRole("button", { name: "Complete Session", exact: true }).click();
  const dialog = page.getByRole("dialog", { name: "Complete Session" });
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.keyboard.press("Shift+Tab");
  await expect(dialog.getByRole("button", { name: "Complete", exact: true })).toBeFocused();
  await page.keyboard.press("Tab");
  await expect(dialog.getByRole("button", { name: "Cancel" })).toBeFocused();
  await page.screenshot({ path: info.outputPath("complete-session-390.png"), fullPage: true });
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Complete Session", exact: true })).toBeFocused();
  await expect(page.getByText("1 stone recorded", { exact: true })).toBeVisible();
});


test("primary destinations keep their header and sync row at the same height", async ({ page }, info) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshLoad(page);
  const positions: { title: number; status: number; height: number }[] = [];
  for (const destination of ["Home", "Train", "Analyze", "Settings"]) {
    await primaryNav(page).getByRole("button", { name: destination, exact: true }).click();
    const header = page.locator(".house-training-header").first();
    await expect(header).toBeVisible();
    const box = (await header.boundingBox())!;
    const statusBox = (await page.locator(".house-status-row").boundingBox())!;
    positions.push({ title: box.y, status: statusBox.y, height: box.height });
    await page.mouse.move(0, 0);
    await page.screenshot({ path: info.outputPath(`stable-${destination.toLowerCase()}.png`), animations: "disabled", fullPage: true });
    if (destination === "Settings") {
      const account = page.getByRole("region", { name: "Account", exact: true });
      await expect(account.getByRole("button", { name: "Sign out", exact: true })).toBeVisible();
      expect((await account.boundingBox())!.y).toBeGreaterThan(box.y + box.height);
      await expect(page.locator(".house-status-row").getByRole("button", { name: "Sign out" })).toHaveCount(0);
    }
  }
  for (const position of positions) {
    expect(Math.abs(position.title - positions[0].title)).toBeLessThanOrEqual(1);
    expect(Math.abs(position.status - positions[0].status)).toBeLessThanOrEqual(1);
    expect(Math.abs(position.height - positions[0].height)).toBeLessThanOrEqual(1);
  }
});
