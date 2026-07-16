import type { Page } from "@playwright/test";

/**
 * The suite's default project viewport (see playwright.config.ts) is mobile-sized,
 * so PrimaryNavigation's mobile bottom bar (data-testid="primary-nav-mobile") is the
 * one actually visible — its desktop counterpart exists in the DOM too but is
 * `display:none` at this width. Tests that explicitly set a desktop viewport (see the
 * Desktop describe block in navigation.spec.ts) should use primaryNavDesktop instead.
 */
export function primaryNav(page: Page) {
  return page.getByTestId("primary-nav-mobile");
}

export function primaryNavDesktop(page: Page) {
  return page.getByTestId("primary-nav-desktop");
}

async function navigateTo(
  page: Page,
  label: "Home" | "Train" | "Assess" | "Analyze" | "Settings"
) {
  await primaryNav(page).getByRole("button", { name: label }).click();
}

export async function goToHome(page: Page) {
  await navigateTo(page, "Home");
  await page.waitForSelector("text=Today's Plan");
}

export async function goToTrain(page: Page) {
  await navigateTo(page, "Train");
}

export async function goToAssess(page: Page) {
  await navigateTo(page, "Assess");
  await page.waitForSelector("text=Release Time Core Assessment");
}

export async function goToAnalyze(page: Page) {
  await navigateTo(page, "Analyze");
  await page.getByRole("tab", { name: "Training" }).waitFor();
}

export async function goToSettings(page: Page) {
  await navigateTo(page, "Settings");
  await page.waitForSelector("text=Data Management");
}

/** Clears persisted state and loads the app as a brand-new user would see it —
 * lands on Home, since there is no scheduling data yet to require a different flow. */
export async function freshLoad(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("text=Today's Plan");
}

/** Creates the first Training Block of a fresh session using the Setup form's defaults
 * (Fixed Weight, Back-Hog, target 3.75s) and waits for the active-block view. Navigates
 * to Train first if the caller hasn't already (Train's Setup screen is where session
 * setup lives now — see docs/PLATFORM_NAVIGATION_AND_HOME_EXPERIENCE.md). */
export async function setupFixedBlock(page: Page) {
  const alreadyOnSetup = await page
    .getByText("Set Up Training Block")
    .isVisible()
    .catch(() => false);
  if (!alreadyOnSetup) {
    await goToTrain(page);
  }
  await page.waitForSelector("text=Set Up Training Block");
  await page.getByRole("button", { name: "Start Training" }).click();
  await page.waitForSelector("text=Active Training Block");
}

/** Creates a Variable Weight / Smart Random block (the Setup form's Variable default). */
export async function setupVariableSmartRandomBlock(page: Page) {
  const alreadyOnSetup = await page
    .getByText("Set Up Training Block")
    .isVisible()
    .catch(() => false);
  if (!alreadyOnSetup) {
    await goToTrain(page);
  }
  await page.waitForSelector("text=Set Up Training Block");
  await page.getByRole("button", { name: "Variable Weight", exact: true }).click();
  await page.getByRole("button", { name: "Start Training" }).click();
  await page.waitForSelector("text=Active Training Block");
}

type StartAutoCaptureOptions = {
  count?: number;
  handleMode?: "Manual" | "Fixed In" | "Fixed Out" | "Alternate";
};

/** Opens the Auto Capture start form and starts a sequence. */
export async function startAutoCapture(
  page: Page,
  { count = 3, handleMode = "Fixed In" }: StartAutoCaptureOptions = {}
) {
  await page.getByLabel("Number of Shots").fill(String(count));
  await page.getByRole("button", { name: handleMode, exact: true }).click();
  await page.getByRole("button", { name: "Start Auto Capture" }).click();
  await page.waitForSelector(`text=0 / ${count} shots`);
}

/**
 * The "Add Result Manually" text input inside an active Auto Capture panel — scoped
 * separately from ShotEntry's own release-time input, since both happen to share the
 * placeholder "3.75 or 375".
 */
export function captureManualResultInput(page: Page) {
  return page
    .locator("p", { hasText: "Add Result Manually" })
    .locator("..")
    .getByPlaceholder("3.75 or 375");
}

// --- Assess (Release Time Core Assessment v1) helpers — see docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md ---

/** From the Assess landing page, opens the Release Time Core Overview, skipping the Guided Introduction if it's shown. */
export async function openReleaseTimeCoreOverview(page: Page) {
  await page.getByRole("button", { name: "View Assessment" }).click();
  const skipButton = page.getByRole("button", { name: "Skip explanation" });
  if (await skipButton.isVisible().catch(() => false)) {
    await skipButton.click();
  }
  await page.waitForSelector("text=Accuracy Thresholds");
}

export type ThresholdPreset = "Standard" | "Tight" | "Custom";

/** Confirms setup and starts the Warm-up — assumes the Overview is already open. */
export async function confirmAssessSetupAndStartWarmup(
  page: Page,
  { threshold = "Standard" as ThresholdPreset } = {}
) {
  if (threshold !== "Standard") {
    await page.getByRole("radio", { name: threshold }).click();
  }
  await page.getByRole("checkbox").click();
  await page.getByRole("button", { name: "Start Warm-up" }).click();
  await page.getByPlaceholder("3.75 or 375").waitFor();
}

/** Records one manually-entered shot against the current planned shot. */
export async function recordAssessManualShot(page: Page, value: string) {
  await page.getByPlaceholder("3.75 or 375").fill(value);
  await page.getByRole("button", { name: "Record" }).click();
}

/** Completes all 6 fixed warm-up shots via manual entry, then starts the scored assessment. */
export async function completeAssessWarmup(page: Page) {
  for (let i = 0; i < 6; i++) {
    await recordAssessManualShot(page, "3.80");
  }
  await page.waitForSelector("text=Warm-up complete");
  await page.getByRole("button", { name: "Start Scored Assessment" }).click();
  await page.waitForSelector("text=Block 1 of 4");
}

/**
 * Fast-forwards through the remaining scored shots using the dev Timing
 * Simulator's quick-value button (still through the real TimingResult
 * boundary and app UI, not a domain-level shortcut) — clicks through any
 * Block Transition screen along the way. Any positive time is a valid
 * attempt regardless of the shot's own target, so one fixed quick value is
 * sufficient to reach completion.
 */
export async function fastForwardAssessScoredShots(page: Page, count: number) {
  for (let i = 0; i < count; i++) {
    const continueButton = page.getByRole("button", { name: "Continue" });
    if (await continueButton.isVisible().catch(() => false)) {
      await continueButton.click();
    }
    await page.getByRole("button", { name: "3.75s" }).click();
  }
}

/**
 * Full happy-path Assess flow, from Assess Landing through the Completion
 * Summary — the shared setup step for Phase C Result Screen / Analyze
 * Integration E2E tests (see tests/e2e/assessment-results.spec.ts). Assumes
 * the caller has already done a freshLoad and is not currently mid-run.
 */
export async function completeFullAssessment(page: Page, options: { threshold?: ThresholdPreset } = {}) {
  await goToAssess(page);
  await openReleaseTimeCoreOverview(page);
  await confirmAssessSetupAndStartWarmup(page, options);
  await completeAssessWarmup(page);
  await fastForwardAssessScoredShots(page, 32);
  await page.waitForSelector("text=Assessment complete");
}
