import { expect, test } from "@playwright/test";
import {
  completeAssessWarmup,
  completeFullAssessment,
  confirmAssessSetupAndStartWarmup,
  fastForwardAssessScoredShots,
  freshLoad,
  goToAnalyze,
  openReleaseTimeCoreOverview,
  primaryNavDesktop,
} from "./utils";

// Phase C — Assessment Results & Analyze Integration. See
// docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md and the Phase C brief
// in CLAUDE.md for the full scenario list; this is a scoped subset covering
// the highest-value flows (unit/component tests cover the detailed metric
// derivation and recalculation logic more cheaply than E2E can).

test.describe("Completion to Full Results", () => {
  test("View Full Results opens the Result Screen with core sections visible", async ({ page }) => {
    await freshLoad(page);
    await completeFullAssessment(page);

    await page.getByRole("button", { name: "View Full Results" }).click();

    await expect(page.getByRole("heading", { name: "Release Time Core Assessment" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Core Metrics" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Block Results" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Target Results" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Handle Comparison" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Variable Adaptation" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Protocol Integrity" })).toBeVisible();
    await expect(page.getByText(/Original Run Thresholds:/).first()).toBeVisible();
  });

  test("Back returns to the Assess Landing without losing the archived run", async ({ page }) => {
    await freshLoad(page);
    await completeFullAssessment(page);
    await page.getByRole("button", { name: "View Full Results" }).click();
    await page.getByText("← Back").click();

    await expect(page.getByRole("button", { name: "View Assessment" })).toBeVisible();
    await expect(page.getByRole("button", { name: "Resume Assessment" })).not.toBeVisible();
  });
});

test.describe("Threshold Switching", () => {
  test("switching Original → Standard → Tight recalculates the view without changing Mean Absolute Error", async ({
    page,
  }) => {
    await freshLoad(page);
    await completeFullAssessment(page);
    await page.getByRole("button", { name: "View Full Results" }).click();

    // The whole "Core Metrics" card is threshold-independent — its full text
    // (including MAE/Bias/Std. Dev.) must stay byte-identical across every
    // Analysis Threshold switch, unlike the separate "Category Metrics" card.
    const coreMetricsCard = page.getByRole("heading", { name: "Core Metrics" }).locator("xpath=..");
    const maeBefore = await coreMetricsCard.textContent();

    const analysisControl = page.getByRole("radiogroup", { name: "Analysis Threshold Set" });
    await analysisControl.getByRole("radio", { name: "Standard" }).click();
    await analysisControl.getByRole("radio", { name: "Tight" }).click();

    const maeAfter = await coreMetricsCard.textContent();
    expect(maeAfter).toBe(maeBefore);
  });

  test("an invalid Custom threshold shows a validation message and never crashes the view", async ({ page }) => {
    await freshLoad(page);
    await completeFullAssessment(page);
    await page.getByRole("button", { name: "View Full Results" }).click();

    const analysisControl = page.getByRole("radiogroup", { name: "Analysis Threshold Set" });
    await analysisControl.getByRole("radio", { name: "Custom" }).click();
    await page.getByLabel("Custom On Target threshold, seconds").fill("0.50");
    await page.getByLabel("Custom Acceptable threshold, seconds").fill("0.10");

    await expect(page.getByText("On Target must be smaller than Acceptable.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Core Metrics" })).toBeVisible();
  });
});

test.describe("Analyze Assessments", () => {
  test("Analyze → Assessments shows the latest completed run and Training Analyze remains intact", async ({
    page,
  }) => {
    await freshLoad(page);
    await completeFullAssessment(page);
    await page.getByRole("button", { name: "Done" }).click();

    await goToAnalyze(page);
    await expect(page.getByText("History & Analytics")).toBeVisible();

    await page.getByRole("tab", { name: "Assessments" }).click();
    await expect(page.getByRole("heading", { name: "Latest Completed Assessment" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Assessment History" })).toBeVisible();

    await page.getByRole("tab", { name: "Training" }).click();
    await expect(page.getByText("History & Analytics")).toBeVisible();
  });

  test("View Results from Analyze opens the correct run's Result Screen", async ({ page }) => {
    await freshLoad(page);
    await completeFullAssessment(page);
    await page.getByRole("button", { name: "Done" }).click();

    await goToAnalyze(page);
    await page.getByRole("tab", { name: "Assessments" }).click();
    await page.getByRole("button", { name: "View Results" }).first().click();

    await expect(page.getByRole("heading", { name: "Release Time Core Assessment" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Core Metrics" })).toBeVisible();
  });
});

test.describe("Run Comparison and Trends", () => {
  test("two completed runs become protocol-comparable with a visible shared Comparison Threshold", async ({
    page,
  }) => {
    await freshLoad(page);

    await completeFullAssessment(page);
    await page.getByRole("button", { name: "Start New Assessment" }).click();
    const skipButton = page.getByRole("button", { name: "Skip explanation" });
    if (await skipButton.isVisible().catch(() => false)) {
      await skipButton.click();
    }
    await page.waitForSelector("text=Accuracy Thresholds");
    await confirmAssessSetupAndStartWarmup(page);
    await completeAssessWarmup(page);
    await fastForwardAssessScoredShots(page, 32);
    await page.waitForSelector("text=Assessment complete");

    await page.getByRole("button", { name: "View Full Results" }).click();

    await expect(page.getByText("This run remains protocol-comparable.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Run Comparison" })).toBeVisible();
    await expect(page.getByText(/MAE change/).first()).toBeVisible();

    await expect(page.getByRole("heading", { name: "Development Trends" })).toBeVisible();
    await expect(page.getByText(/Comparison Threshold: Standard/).first()).toBeVisible();
  });
});

test.describe("Mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Result Screen and Analyze Assessments render without horizontal overflow", async ({ page }) => {
    await freshLoad(page);
    await completeFullAssessment(page);
    await page.getByRole("button", { name: "View Full Results" }).click();
    await expect(page.getByRole("heading", { name: "Core Metrics" })).toBeVisible();

    let hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalOverflow).toBe(false);

    // Back unmounts AssessScreen's in-flight Completion Summary state and
    // returns to Assess Landing (see the "Back returns to the Assess
    // Landing" test above) — the archived run itself is untouched.
    await page.getByText("← Back").click();
    await expect(page.getByRole("button", { name: "View Assessment" })).toBeVisible();
    await goToAnalyze(page);
    await page.getByRole("tab", { name: "Assessments" }).click();

    hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalOverflow).toBe(false);
  });
});

test.describe("Desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("Result Screen renders correctly at desktop width", async ({ page }) => {
    await freshLoad(page);
    // Desktop viewport: the mobile bottom bar is CSS-hidden, so navigate via
    // the desktop top bar directly rather than through completeFullAssessment
    // (which calls the mobile-only goToAssess) — same convention as
    // assess.spec.ts's own Desktop describe block.
    await primaryNavDesktop(page).getByRole("button", { name: "Assess" }).click();
    await page.waitForSelector("text=Release Time Core Assessment");
    await openReleaseTimeCoreOverview(page);
    await confirmAssessSetupAndStartWarmup(page);
    await completeAssessWarmup(page);
    await fastForwardAssessScoredShots(page, 32);
    await page.waitForSelector("text=Assessment complete");

    await page.getByRole("button", { name: "View Full Results" }).click();
    await expect(page.getByRole("heading", { name: "Core Metrics" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Block Results" })).toBeVisible();
  });
});
