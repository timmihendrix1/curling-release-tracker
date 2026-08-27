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

type E2ECloudSportingRecord = {
  record_kind: "training_session" | "assessment_run";
  record_id: string;
  content_sha256: string;
};

function localSupabaseBrowserConfig(): { url: string; publishableKey: string } {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY;
  if (
    typeof url !== "string" ||
    !url.startsWith("http://127.0.0.1:") ||
    typeof publishableKey !== "string" ||
    !publishableKey.startsWith("sb_publishable_")
  ) {
    throw new Error("The local browser-public Supabase E2E configuration is unavailable.");
  }
  return { url, publishableKey };
}

/** Reads the authenticated fixture Profile's real B0.4 cloud records through the
 * same public RPC boundary as production. Credentials remain inside the browser
 * context and are never printed or copied into a fixture. */
export async function readCloudSportingRecords(page: Page): Promise<E2ECloudSportingRecord[]> {
  return page.evaluate(async ({ url, publishableKey }) => {
    let accessToken: string | null = null;
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("sb-")) continue;
      try {
        const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
        if (
          typeof value === "object" &&
          value !== null &&
          "access_token" in value &&
          typeof value.access_token === "string"
        ) {
          accessToken = value.access_token;
          break;
        }
      } catch {
        // Ignore unrelated or malformed browser state. The missing-token failure
        // below remains fail-closed and does not disclose the stored value.
      }
    }
    if (accessToken === null) throw new Error("The authenticated E2E session is unavailable.");

    const response = await fetch(`${url}/rest/v1/rpc/get_my_sporting_records`, {
      method: "POST",
      headers: {
        apikey: publishableKey,
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: "{}",
    });
    if (!response.ok) throw new Error("The sporting-cloud E2E read failed.");
    const body: unknown = await response.json();
    if (!Array.isArray(body)) throw new Error("The sporting-cloud E2E response is malformed.");

    return body.map((value) => {
      if (
        typeof value !== "object" ||
        value === null ||
        !("record_kind" in value) ||
        (value.record_kind !== "training_session" && value.record_kind !== "assessment_run") ||
        !("record_id" in value) ||
        typeof value.record_id !== "string" ||
        !("content_sha256" in value) ||
        typeof value.content_sha256 !== "string"
      ) {
        throw new Error("The sporting-cloud E2E response is malformed.");
      }
      return {
        record_kind: value.record_kind,
        record_id: value.record_id,
        content_sha256: value.content_sha256,
      };
    });
  }, localSupabaseBrowserConfig());
}

async function clearCloudSportingRecords(page: Page): Promise<void> {
  const records = await readCloudSportingRecords(page);
  if (records.length === 0) return;
  await page.evaluate(async ({ config, recordsToDelete }) => {
    let accessToken: string | null = null;
    for (const key of Object.keys(localStorage)) {
      if (!key.startsWith("sb-")) continue;
      try {
        const value: unknown = JSON.parse(localStorage.getItem(key) ?? "null");
        if (
          typeof value === "object" &&
          value !== null &&
          "access_token" in value &&
          typeof value.access_token === "string"
        ) {
          accessToken = value.access_token;
          break;
        }
      } catch {
        // See readCloudSportingRecords: malformed unrelated state is ignored.
      }
    }
    if (accessToken === null) throw new Error("The authenticated E2E session is unavailable.");

    for (const record of recordsToDelete) {
      const response = await fetch(`${config.url}/rest/v1/rpc/delete_my_sporting_record`, {
        method: "POST",
        headers: {
          apikey: config.publishableKey,
          Authorization: `Bearer ${accessToken}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          p_record_kind: record.record_kind,
          p_record_id: record.record_id,
          p_expected_content_sha256: record.content_sha256,
        }),
      });
      if (!response.ok) throw new Error("The sporting-cloud E2E cleanup failed.");
    }
  }, { config: localSupabaseBrowserConfig(), recordsToDelete: records });
}

/** Removes only the current browser's Profile-scoped sporting workspace. It is
 * intentionally separate from cloud cleanup so B0.4 restore can be verified as a
 * real cross-device-style boundary in focused tests. */
export async function clearLocalSportingState(page: Page): Promise<void> {
  await page.evaluate(() => {
    for (const key of Object.keys(localStorage)) {
      if (key.startsWith("curling.identity.") || key.startsWith("sb-")) continue;
      localStorage.removeItem(key);
    }
  });
}

/** Clears sporting/test state while retaining the real authenticated identity and
 * trusted-device records established by global setup. Since B0.4 restores terminal
 * records from the real local cloud, the helper first tombstones the fixture Profile's
 * prior records through the production RPC boundary, then clears its local workspace.
 * Playwright uses one worker so scenarios cannot race on this shared test Profile. */
export async function freshLoad(page: Page) {
  await page.goto("/");
  await page.waitForSelector("text=Today's Plan");
  await clearCloudSportingRecords(page);
  await clearLocalSportingState(page);
  await page.reload();
  await page.waitForSelector("text=Today's Plan");
}

/** Seeds one logical sporting key inside the Profile namespace established by the
 * real identity global setup. Runs before application code, so hydration observes the
 * fixture without a race. */
export async function seedProfileScopedSportingValue(
  page: Page,
  logicalKey: string,
  value: unknown
) {
  await page.addInitScript(
    ({ key, storedValue }) => {
      const trustedRaw = localStorage.getItem("curling.identity.trustedDevice.v1");
      if (trustedRaw === null) throw new Error("The E2E trusted Profile is missing.");
      const trusted: unknown = JSON.parse(trustedRaw);
      if (
        typeof trusted !== "object" ||
        trusted === null ||
        !("profileId" in trusted) ||
        typeof trusted.profileId !== "string"
      ) {
        throw new Error("The E2E trusted Profile is malformed.");
      }
      const physicalKey = `curling.sporting.profile.v1.${trusted.profileId}.${key}`;
      localStorage.setItem(physicalKey, JSON.stringify(storedValue));
    },
    { key: logicalKey, storedValue: value }
  );
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

/**
 * Switches from Manual Entry to the Auto Capture tab, opens its start form,
 * and starts a sequence. Manual Entry is the default selected tab
 * (compositional redesign — Manual Entry and Auto Capture are a segmented
 * choice, not two permanently-stacked panels), so every Auto Capture flow
 * needs this one extra tab click first.
 */
export async function startAutoCapture(
  page: Page,
  { count = 3, handleMode = "Fixed In" }: StartAutoCaptureOptions = {}
) {
  await page.getByRole("tab", { name: "Auto Capture" }).click();
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
