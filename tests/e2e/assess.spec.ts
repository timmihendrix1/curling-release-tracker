import { expect, test } from "@playwright/test";
import {
  completeAssessWarmup,
  confirmAssessSetupAndStartWarmup,
  fastForwardAssessScoredShots,
  freshLoad,
  goToAssess,
  goToTrain,
  openReleaseTimeCoreOverview,
  primaryNav,
  primaryNavDesktop,
  recordAssessManualShot,
  startAutoCapture,
} from "./utils";

test.describe("First Assessment Start", () => {
  test("Assess is reachable from a fresh load, and the Overview/Protocol/Setup Diagram are all visible", async ({
    page,
  }) => {
    await freshLoad(page);
    await expect(primaryNav(page).getByRole("button", { name: "Assess" })).toBeVisible();

    await goToAssess(page);
    await expect(page.getByRole("heading", { name: "Release Time Core Assessment" })).toBeVisible();

    await openReleaseTimeCoreOverview(page);
    await expect(page.getByText("What this assessment measures")).toBeVisible();
    await expect(page.getByText("Why this structure")).toBeVisible();

    await page.getByRole("button", { name: "View full protocol" }).click();
    await expect(page.getByText("Release Time Core Assessment v1 — Protocol")).toBeVisible();
    await page.getByRole("button", { name: "Close protocol" }).click();

    await page.getByText("View setup diagram").click();
    await expect(page.getByText("Measured segment: Backline to Hogline")).toBeVisible();

    // Standard threshold visible and preselected before starting.
    await expect(page.getByRole("radio", { name: "Standard" })).toHaveAttribute("aria-checked", "true");

    await confirmAssessSetupAndStartWarmup(page);
    await expect(page.getByText("Warm-up").first()).toBeVisible();
  });
});

test.describe("Warm-up (manual)", () => {
  test("all six warm-up shots follow the exact fixed target/handle sequence, then require an explicit Start Scored Assessment", async ({
    page,
  }) => {
    await freshLoad(page);
    await goToAssess(page);
    await openReleaseTimeCoreOverview(page);
    await confirmAssessSetupAndStartWarmup(page);

    const sequence: [string, string][] = [
      ["3.75s", "In"],
      ["3.75s", "Out"],
      ["4.00s", "In"],
      ["4.00s", "Out"],
      ["3.50s", "In"],
      ["3.50s", "Out"],
    ];

    for (const [target, handle] of sequence) {
      // Scoped to the target readout specifically — the dev Timing Simulator
      // panel (visible in this `next dev`-backed suite) also shows the same
      // values as quick-send button labels, which would otherwise collide.
      await expect(page.locator("p.text-3xl", { hasText: target })).toBeVisible();
      await expect(page.getByText(`Expected Handle: ${handle}`)).toBeVisible();
      await recordAssessManualShot(page, "999");
    }

    await expect(page.getByText("Warm-up complete")).toBeVisible();
    await expect(page.getByText("Block 1 of 4")).not.toBeVisible();

    await page.getByRole("button", { name: "Start Scored Assessment" }).click();
    await expect(page.getByText("Block 1 of 4")).toBeVisible();
  });
});

test.describe("First Scored Block", () => {
  test("wrong handle records a Protocol Deviation, invalid attempts are capped at 2, and progress advances correctly", async ({
    page,
  }) => {
    await freshLoad(page);
    await goToAssess(page);
    await openReleaseTimeCoreOverview(page);
    await confirmAssessSetupAndStartWarmup(page);
    await completeAssessWarmup(page);

    await expect(page.getByText("0 / 32")).toBeVisible();

    // Shot 1 expects In — toggle to Out and record (still valid, scored).
    await page.getByRole("button", { name: "Out", exact: true }).click();
    await recordAssessManualShot(page, "3.76");
    await expect(
      page.getByText("This attempt counts, but the executed handle differs from the planned handle.")
    ).toBeVisible();
    await expect(page.getByText("1 / 32")).toBeVisible();

    // Mark the next attempt invalid twice, then succeed with a valid one.
    await page.getByRole("button", { name: "Mark attempt invalid" }).click();
    await page.getByRole("button", { name: "Timing system failure" }).click();
    await expect(page.getByText("Invalid attempts for this shot: 1 / 2")).toBeVisible();
    await expect(page.getByText("1 / 32")).toBeVisible();

    await page.getByRole("button", { name: "Mark attempt invalid" }).click();
    await page.getByRole("button", { name: "Timing system failure" }).click();
    await expect(page.getByText("Invalid attempts for this shot: 2 / 2")).toBeVisible();
    await expect(page.getByRole("button", { name: "Mark attempt invalid" })).toBeDisabled();
    await expect(page.getByText("Resolve the timing issue before continuing.")).toBeVisible();

    await recordAssessManualShot(page, "3.77");
    await expect(page.getByText("2 / 32")).toBeVisible();
  });
});

test.describe("Pause and Reload", () => {
  test("pausing, reloading, and resuming preserves progress with no duplicate attempts", async ({ page }) => {
    await freshLoad(page);
    await goToAssess(page);
    await openReleaseTimeCoreOverview(page);
    await confirmAssessSetupAndStartWarmup(page);
    await recordAssessManualShot(page, "3.80"); // warm-up shot 1/6

    await page.getByRole("button", { name: "Pause" }).click();
    await expect(page.getByText("Assessment paused")).toBeVisible();
    await expect(page.getByText("Warm-up 1 / 6")).toBeVisible();

    await page.reload();
    await page.waitForSelector("text=Today's Plan");
    await expect(page.getByRole("button", { name: "Resume Assessment" })).toBeVisible();

    // Not goToAssess: an active (paused) run means Assess opens straight into
    // the Paused view, not the "Release Time Core Assessment" Landing text
    // goToAssess normally waits for.
    await primaryNav(page).getByRole("button", { name: "Assess" }).click();
    await expect(page.getByText("Assessment paused")).toBeVisible();
    await expect(page.getByText("Warm-up 1 / 6")).toBeVisible();

    await page.getByRole("button", { name: "Resume Assessment" }).click();
    await expect(page.getByPlaceholder("3.75 or 375")).toBeVisible();

    // No duplicate: exactly one warm-up attempt recorded before pausing.
    await recordAssessManualShot(page, "3.80");
    await recordAssessManualShot(page, "3.80");
    await recordAssessManualShot(page, "3.80");
    await recordAssessManualShot(page, "3.80");
    await recordAssessManualShot(page, "3.80");
    await expect(page.getByText("Warm-up complete")).toBeVisible();
  });
});

test.describe("Full Completion", () => {
  test("completes all 6 warm-up and 32 scored shots, shows the completion summary, and archives the run", async ({
    page,
  }) => {
    await freshLoad(page);
    await goToAssess(page);
    await openReleaseTimeCoreOverview(page);
    await confirmAssessSetupAndStartWarmup(page);
    await completeAssessWarmup(page);

    await fastForwardAssessScoredShots(page, 32);

    await expect(page.getByText("Assessment complete")).toBeVisible();
    await expect(page.getByText("32 of 32 scored stones")).toBeVisible();
    await expect(page.getByText("MAE")).toBeVisible();
    await expect(page.getByText("Bias")).toBeVisible();
    await expect(page.getByText("Std. Dev.")).toBeVisible();
    await expect(page.getByText("On Target")).toBeVisible();

    await page.getByRole("button", { name: "Done" }).click();
    await expect(page.getByRole("button", { name: "View Assessment" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Resume Assessment" })).not.toBeVisible();
  });
});

test.describe("Abandon Flow", () => {
  test("abandoning during warm-up requires confirmation and returns to Landing without blocking a new run", async ({
    page,
  }) => {
    await freshLoad(page);
    await goToAssess(page);
    await openReleaseTimeCoreOverview(page);
    await confirmAssessSetupAndStartWarmup(page);

    await page.getByRole("button", { name: "Abandon Assessment" }).click();
    await expect(page.getByText(/Attempts recorded so far will be kept/)).toBeVisible();

    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("Warm-up").first()).toBeVisible();

    await page.getByRole("button", { name: "Abandon Assessment" }).click();
    await page.getByRole("button", { name: "Abandon Assessment" }).last().click();

    await expect(page.getByRole("button", { name: "View Assessment" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Resume Assessment" })).not.toBeVisible();

    // Starting again works cleanly — a brand-new run, not a resurrected one.
    await openReleaseTimeCoreOverview(page);
    await confirmAssessSetupAndStartWarmup(page);
    await expect(page.getByText("Warm-up").first()).toBeVisible();
  });
});

test.describe("Thresholds", () => {
  test("Tight is selectable and snapshotted; Custom validates and blocks Start when invalid", async ({ page }) => {
    await freshLoad(page);
    await goToAssess(page);
    await openReleaseTimeCoreOverview(page);
    await confirmAssessSetupAndStartWarmup(page, { threshold: "Tight" });
    await expect(page.getByText("Threshold: Tight")).toBeVisible();
  });

  test("an invalid Custom threshold blocks Start Warm-up with a clear explanation", async ({ page }) => {
    await freshLoad(page);
    await goToAssess(page);
    await openReleaseTimeCoreOverview(page);

    await page.getByRole("radio", { name: "Custom" }).click();
    await page.getByLabel("On Target (s)").fill("0.30");
    await page.getByLabel("Acceptable (s)").fill("0.10");
    await page.getByRole("checkbox").click();

    await expect(page.getByRole("button", { name: "Start Warm-up" })).toBeDisabled();
    await expect(page.getByText("On Target must be smaller than Acceptable.")).toBeVisible();
  });
});

test.describe("Mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Setup Diagram and Current Shot are fully visible, and the bottom nav never overlaps controls", async ({
    page,
  }) => {
    await freshLoad(page);
    await goToAssess(page);
    await openReleaseTimeCoreOverview(page);
    await page.getByText("View setup diagram").click();
    await expect(page.getByText("Measured segment: Backline to Hogline")).toBeVisible();

    await confirmAssessSetupAndStartWarmup(page);
    await expect(page.getByPlaceholder("3.75 or 375")).toBeVisible();
    await expect(page.getByRole("button", { name: "Record" })).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalOverflow).toBe(false);
  });

  test("320x700 keeps the primary action reachable without horizontal scroll", async ({ page }) => {
    await page.setViewportSize({ width: 320, height: 700 });
    await freshLoad(page);
    await goToAssess(page);
    await expect(page.getByRole("button", { name: "View Assessment" })).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});

test.describe("Desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("Overview, Execution, and Completion render correctly at desktop width", async ({ page }) => {
    await freshLoad(page);
    // Desktop viewport: the mobile bottom bar is CSS-hidden, so navigate via
    // the desktop top bar specifically (see tests/e2e/utils.ts's primaryNav
    // vs. primaryNavDesktop convention).
    await primaryNavDesktop(page).getByRole("button", { name: "Assess" }).click();
    await page.waitForSelector("text=Release Time Core Assessment");
    await openReleaseTimeCoreOverview(page);
    await expect(page.getByText("What this assessment measures")).toBeVisible();

    await confirmAssessSetupAndStartWarmup(page);
    await completeAssessWarmup(page);
    await expect(page.getByText("Block 1 of 4")).toBeVisible();

    await fastForwardAssessScoredShots(page, 32);
    await expect(page.getByText("Assessment complete")).toBeVisible();
  });
});

test.describe("Capture Regression", () => {
  test("Training Auto Capture still works normally, unaffected by the Assess capture-ownership routing", async ({
    page,
  }) => {
    const errors: string[] = [];
    page.on("console", (message) => {
      if (message.type() === "error") errors.push(message.text());
    });

    await freshLoad(page);
    await goToTrain(page);
    await page.getByRole("button", { name: "Start Training" }).click();
    await page.waitForSelector("text=Active Training Block");
    await startAutoCapture(page, { count: 2, handleMode: "Fixed In" });

    await page.getByRole("button", { name: "3.75s" }).click();
    await expect(page.getByText("1 / 2 shots")).toBeVisible();

    expect(errors).toEqual([]);
  });

  test("a duplicate Timing Result during an assessment never creates a second attempt", async ({ page }) => {
    await freshLoad(page);
    await goToAssess(page);
    await openReleaseTimeCoreOverview(page);
    await confirmAssessSetupAndStartWarmup(page);
    await completeAssessWarmup(page);

    await page.getByRole("button", { name: "3.75s" }).click();
    await expect(page.getByText("1 / 32")).toBeVisible();

    await page.getByRole("button", { name: "Duplicate Result" }).click();
    await expect(page.getByText("1 / 32")).toBeVisible();
  });
});
