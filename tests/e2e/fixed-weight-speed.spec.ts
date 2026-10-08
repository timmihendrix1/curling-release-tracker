import { expect, test } from "@playwright/test";
import {
  freshLoad,
  primaryNav,
  goToTrain,
  openReleaseTimingSetup,
  primaryNavDesktop,
} from "./utils";

// Stage B's user journeys, in a real browser against the real repositories:
// configuring what a Fixed Weight exercise measures, recording it, completing a
// measurement that is still missing on one identified stone, and reading the result
// back after a reload.
//
// The default project viewport is 390x844 (playwright.config.ts), so these also act as
// the mobile-width check for the new controls; a desktop pass follows at the end.

/** Starts a Fixed Weight block measuring only speed, against a 2.40 m/s target. */
async function startSpeedTraining(page: import("@playwright/test").Page) {
  await openReleaseTimingSetup(page);
  await page.getByRole("radio", { name: "Speed (m/s)" }).click();
  await page.getByLabel("Target Speed (m/s)").fill("2.40");
  await page.getByRole("button", { name: "Start Training", exact: true }).click();
  await page.waitForSelector("text=Active Training Block");
}

/** Starts a Fixed Weight block measuring both time and speed. */
async function startBothTraining(page: import("@playwright/test").Page) {
  await openReleaseTimingSetup(page);
  await page.getByRole("radio", { name: "Both" }).click();
  await page.getByLabel("Target Speed (m/s)").fill("2.40");
  await page.getByRole("button", { name: "Start Training", exact: true }).click();
  await page.waitForSelector("text=Active Training Block");
}

test("Speed setup hides every time control and records a speed-only stone", async ({
  page,
}) => {
  await freshLoad(page);
  await openReleaseTimingSetup(page);

  // Time is the default, exactly as before this feature.
  await expect(page.getByLabel("Target Time (s)")).toBeVisible();

  await page.getByRole("radio", { name: "Speed (m/s)" }).click();

  // A speed-only exercise measures no time: no time target, no timing interval.
  await expect(page.getByLabel("Target Time (s)")).toHaveCount(0);
  await expect(page.getByText("Measurement Mode")).toHaveCount(0);
  // And its tolerance is stated in its own unit.
  await expect(
    page.getByText("On Target ±0.05m/s · Acceptable ±0.10m/s")
  ).toBeVisible();

  await page.getByLabel("Target Speed (m/s)").fill("2.40");
  await page.getByRole("button", { name: "Start Training", exact: true }).click();
  await page.waitForSelector("text=Active Training Block");

  // Auto Capture is a TIME path and is not offered where no device could feed it.
  await expect(page.getByRole("tab", { name: "Auto Capture" })).toHaveCount(0);
  await expect(page.getByLabel("Release Time (s)")).toHaveCount(0);

  await page.getByLabel("Speed (m/s)").fill("2.45");
  await page.getByRole("button", { name: "Save Shot", exact: true }).click();

  // Scoped to the shot list: the same figures legitimately appear in the capture
  // area's target display and in the live summary too.
  const recent = page.locator("details", { has: page.getByText("Recent Shots") });
  await recent.getByText("Recent Shots").click();
  await expect(recent.getByText("2.45 m/s")).toBeVisible();
  // +0.05 m/s sits exactly on the On Target boundary, which is inclusive for the
  // inner category (ADR-0051) — so this is On Target, not Acceptable.
  await expect(
    recent.getByText("Target 2.40 m/s · +0.05 m/s · On Target")
  ).toBeVisible();
});

test("Both records one stone with two measurements, and completes a missing one on an identified stone", async ({
  page,
}) => {
  await freshLoad(page);
  await startBothTraining(page);

  // A complete stone.
  await page.getByLabel("Release Time (s) — optional").fill("3.80");
  await page.getByLabel("Speed (m/s) — optional").fill("2.42");
  await page.getByRole("button", { name: "Save Shot", exact: true }).click();

  // A deliberately partial stone: the time only.
  await page.getByLabel("Release Time (s) — optional").fill("3.70");
  await page.getByRole("button", { name: "Save Shot", exact: true }).click();

  // The partial stone is surfaced against its own identity, not as "the last one".
  const missing = page.getByRole("button", { name: /Stone 2 · In Handle · Time 3.70s/ });
  await expect(missing).toBeVisible();

  await missing.click();
  await page.getByLabel(/Speed for stone 2/).fill("2.38");
  await page.getByRole("button", { name: "Add Speed" }).click();

  // "Saved" appears only after the write is acknowledged — and it stays visible even
  // though that was the LAST outstanding measurement, because a control that vanishes
  // the instant it succeeds gives no confirmation that anything was written.
  await expect(
    page.getByText(/Saved speed 2\.38 m\/s to .* stone 2\./)
  ).toBeVisible();
  await expect(
    page.getByText(/Nothing else is missing in this training/)
  ).toBeVisible();
  // No stone is offered for completion any more.
  await expect(page.getByRole("button", { name: /Stone 2 · In Handle/ })).toHaveCount(0);

  // Two stones, not three — completing a measurement never adds one.
  await expect(page.getByText("2 shots total")).toBeVisible();

  // It survives a reload with both measurements intact.
  await page.reload();
  await goToTrain(page);
  await page.waitForSelector("text=Active Training Block");
  const reloaded = page.locator("details", { has: page.getByText("Recent Shots") });
  await reloaded.getByText("Recent Shots").click();
  await expect(reloaded.getByText(/3\.70s/).first()).toBeVisible();
  await expect(reloaded.getByText(/2\.38 m\/s/).first()).toBeVisible();
});

test("the two measurements are summarised separately, each with its own denominator", async ({
  page,
}) => {
  await freshLoad(page);
  await startBothTraining(page);

  // Two stones with a time; only one of them with a speed.
  await page.getByLabel("Release Time (s) — optional").fill("3.76");
  await page.getByLabel("Speed (m/s) — optional").fill("2.41");
  await page.getByRole("button", { name: "Save Shot", exact: true }).click();

  await page.getByLabel("Release Time (s) — optional").fill("3.78");
  await page.getByRole("button", { name: "Save Shot", exact: true }).click();

  await page.getByText("Live Performance").click();

  const live = page.locator("details", {
    has: page.getByText("Live Performance"),
  });
  await live.getByRole("tab", { name: "Speed" }).click();

  // The speed figures describe the ONE stone that carries a speed — never two with a
  // fabricated 0.00 m/s — and are labelled in m/s throughout.
  await expect(
    page.getByText("1 of 2 stones carry a recorded speed.")
  ).toBeVisible();
  // "0.01 m/s" is correct in several cards at once (Average Error, Bias, Largest
  // Miss), so the assertion names the card instead of the bare figure.
  await expect(live.getByText("Average Error")).toBeVisible();
  await expect(live.getByText("within ±0.05m/s")).toBeVisible();

  await live.getByRole("tab", { name: "Time" }).click();
  await expect(live.getByText("within ±0.10s")).toBeVisible();
});

test("a speed exercise is reachable, readable and free of fabricated seconds on a small phone", async ({
  page,
}) => {
  await page.setViewportSize({ width: 320, height: 700 });
  await freshLoad(page);
  await startSpeedTraining(page);

  await page.getByLabel("Speed (m/s)").fill("2.44");
  await page.getByRole("button", { name: "Save Shot", exact: true }).click();

  // The collapsed Live Performance header must not state a seconds figure for a
  // training that recorded no time.
  const summary = page.locator("summary", {
    has: page.getByText("Live Performance"),
  });
  await expect(summary).toContainText("2.44 m/s");
  await expect(summary).not.toContainText("0.00s");

  // Nothing overflows the viewport horizontally.
  const scrollWidth = await page.evaluate(
    () => document.documentElement.scrollWidth
  );
  expect(scrollWidth).toBeLessThanOrEqual(320);

  // The primary action stays reachable and large enough to tap.
  const save = page.getByRole("button", { name: "Save Shot", exact: true });
  const box = await save.boundingBox();
  expect(box?.height ?? 0).toBeGreaterThanOrEqual(44);
});

test("Desktop: the same journey works at a wide viewport", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 900 });
  await freshLoad(page);
  // At desktop width the mobile bottom bar is display:none, so the shared helpers
  // (which target it) cannot be used — the desktop navigation is a separate element.
  await primaryNavDesktop(page).getByRole("button", { name: "Train" }).click();
  await page
    .getByRole("button", { name: /^Technique,/ })
    .click()
    .catch(() => {});
  await page.getByRole("button", { name: "View Details: Release Time" }).click();
  await page.getByRole("button", { name: "Continue to Timing Setup" }).click();
  await page.waitForSelector("text=Set Up Training Block");

  await page.getByRole("radio", { name: "Both" }).click();
  await page.getByLabel("Target Speed (m/s)").fill("2.40");
  await page.getByRole("button", { name: "Start Training", exact: true }).click();
  await page.waitForSelector("text=Active Training Block");

  await page.getByLabel("Release Time (s) — optional").fill("3.80");
  await page.getByLabel("Speed (m/s) — optional").fill("2.42");
  await page.getByRole("button", { name: "Save Shot", exact: true }).click();

  const list = page.locator("details", { has: page.getByText("Recent Shots") });
  await list.getByText("Recent Shots").click();
  await expect(list.getByText(/3\.80s/).first()).toBeVisible();
  await expect(list.getByText(/2\.42 m\/s/).first()).toBeVisible();
});


test("a stone left half-measured in an earlier exercise stays completable", async ({
  page,
}) => {
  await freshLoad(page);
  await startBothTraining(page);

  // Record the time only, then move on to a different exercise.
  await page.getByLabel("Release Time (s) — optional").fill("3.70");
  await page.getByRole("button", { name: "Save Shot", exact: true }).click();

  await page.getByRole("button", { name: "New Training Block" }).click();
  await page.getByRole("radio", { name: "Speed (m/s)" }).click();
  await page.getByLabel("Target Speed (m/s)").fill("2.40");
  await page.getByRole("button", { name: "Start Block", exact: true }).click();
  await page.waitForSelector("text=Active Training Block");

  // The stone from the previous exercise is still reachable, named by its block so a
  // repeated stone number stays unambiguous.
  const earlier = page.getByRole("button", { name: /Stone 1 · In Handle/ });
  await expect(earlier).toBeVisible();
  await earlier.click();
  await page.getByLabel(/Speed for stone 1/).fill("2.41");
  await page.getByRole("button", { name: "Add Speed" }).click();

  await expect(
    page.getByText(/Saved speed 2\.41 m\/s to .* stone 1\./)
  ).toBeVisible();

  // The new exercise gained nothing from the completion.
  await expect(page.getByText("0 shots total")).toBeVisible();
});

test("a Speed block created while Auto Capture was selected is still recordable", async ({
  page,
}) => {
  await freshLoad(page);
  await startBothTraining(page);

  // Switch to Auto Capture WITHOUT starting a sequence, then create a Speed block.
  await page.getByRole("tab", { name: "Auto Capture" }).click();
  await page.getByRole("button", { name: "New Training Block" }).click();
  await page.getByRole("radio", { name: "Speed (m/s)" }).click();
  await page.getByLabel("Target Speed (m/s)").fill("2.40");
  await page.getByRole("button", { name: "Start Block", exact: true }).click();
  await page.waitForSelector("text=Active Training Block");

  // Auto Capture is a time path and is not offered; manual entry must be.
  await expect(page.getByRole("tab", { name: "Auto Capture" })).toHaveCount(0);
  await page.getByLabel("Speed (m/s)").fill("2.45");
  await page.getByRole("button", { name: "Save Shot", exact: true }).click();
  await expect(page.getByText("Shot saved.")).toBeVisible();
});

test("direct training can be finished, and offers a new training afterwards", async ({
  page,
}) => {
  await freshLoad(page);
  await startSpeedTraining(page);

  await page.getByLabel("Speed (m/s)").fill("2.45");
  await page.getByRole("button", { name: "Save Shot", exact: true }).click();
  await expect(page.getByText("Shot saved.")).toBeVisible();

  await page.getByRole("button", { name: "Finish Training" }).click();
  await page.getByRole("button", { name: "Finish", exact: true }).click();

  // A truthful finish result, and a way to start the next training.
  await expect(page.getByText("Training finished")).toBeVisible();
  await expect(page.getByText(/Saved to history/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Start New Training" })
  ).toBeVisible();
});


test("a failed save keeps the stone recoverable and a retry persists it once", async ({
  page,
}) => {
  await freshLoad(page);
  await startSpeedTraining(page);

  // Make the next local write fail, from inside the page, so the real repository
  // boundary is exercised rather than a mocked module.
  await page.evaluate(() => {
    const original = Storage.prototype.setItem;
    let failed = false;
    Storage.prototype.setItem = function patched(key: string, value: string) {
      if (!failed && key.includes("current-session")) {
        failed = true;
        throw new Error("simulated storage failure");
      }
      return original.call(this, key, value);
    };
  });

  await page.getByLabel("Speed (m/s)").fill("2.45");
  await page.getByRole("button", { name: "Save Shot", exact: true }).click();

  // Truthful failure, with the typed value kept and a retry offered.
  const retry = page.getByRole("button", { name: "Retry Saving" });
  await expect(retry).toBeVisible();
  await expect(page.getByLabel("Speed (m/s)")).toHaveValue("2.45");

  await retry.click();
  await expect(page.getByText("Shot saved.")).toBeVisible();

  // Exactly one stone — a retry re-persists, it never records a second.
  await page.getByText("Recent Shots").click();
  await expect(page.getByText(/Recent Shots \(1\)/)).toBeVisible();
});

test("Analyze's Speed selection governs the figures it reports", async ({ page }) => {
  await freshLoad(page);
  await startBothTraining(page);

  // time 3.85 vs 3.75 => +0.10s;  speed 2.42 vs 2.40 => +0.02 m/s.
  await page.getByLabel("Release Time (s) — optional").fill("3.85");
  await page.getByLabel("Speed (m/s) — optional").fill("2.42");
  await page.getByRole("button", { name: "Save Shot", exact: true }).click();
  await expect(page.getByText("Shot saved.")).toBeVisible();

  await page.getByRole("button", { name: "Finish Training" }).click();
  await page.getByRole("button", { name: "Finish", exact: true }).click();
  await expect(page.getByText("Training finished")).toBeVisible();

  await primaryNav(page).getByRole("button", { name: "Analyze" }).click();
  // Exact: "Measurement" is a prefix of "Measurement Mode", which is a different
  // control — the timing interval, not the measured quantity.
  await page.getByLabel("Measurement", { exact: true }).selectOption("speed");

  // The summary PANEL itself, not every ancestor that happens to contain it: the
  // session detail further down legitimately shows this Both block's time figures too.
  const summary = page
    .getByRole("heading", { name: "Key Progress Summary" })
    .locator("..");
  await expect(summary.getByText("0.02 m/s").first()).toBeVisible();
  await expect(summary.getByText("0.10s")).toHaveCount(0);
  await expect(summary.getByText(/more weight|less weight/)).toHaveCount(0);
});
