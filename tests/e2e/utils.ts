import type { Page } from "@playwright/test";

/** Clears persisted state and loads the app as a brand-new user would see it. */
export async function freshLoad(page: Page) {
  await page.goto("/");
  await page.evaluate(() => localStorage.clear());
  await page.reload();
  await page.waitForSelector("text=Set Up Training Block");
}

/** Creates the first Training Block of a fresh session using the Setup form's defaults
 * (Fixed Weight, Back-Hog, target 3.75s) and waits for the active-block view. */
export async function setupFixedBlock(page: Page) {
  await page.getByRole("button", { name: "Start Training" }).click();
  await page.waitForSelector("text=Active Training Block");
}

/** Creates a Variable Weight / Smart Random block (the Setup form's Variable default). */
export async function setupVariableSmartRandomBlock(page: Page) {
  await page.getByRole("button", { name: "Variable Weight" }).click();
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
