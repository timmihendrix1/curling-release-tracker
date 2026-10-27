import { expect, test, type Page } from "@playwright/test";
import { readLatestOtp } from "./global-setup";
import { primaryNav } from "./utils";

async function verifyCode(page: Page, email: string, requestedAt: number) {
  const otp = await readLatestOtp(email, requestedAt);
  await page.getByLabel("6-digit code").fill(otp);
  await page.getByRole("button", { name: "Verify code", exact: true }).click();
}

test("in-app export, deletion denial across reload, reauthentication and controlled cancellation", async ({ browser }) => {
  test.setTimeout(90_000);
  const context = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  context.setDefaultTimeout(15_000);
  const page = await context.newPage();
  const email = `deletion-${crypto.randomUUID()}@example.invalid`;
  try {
    await page.goto("/");
    await page.getByLabel("Email address").fill(email);
    let requestedAt = Date.now();
    await page.getByRole("button", { name: "Send sign-in code" }).click();
    await verifyCode(page, email, requestedAt);
    const resendAllowedAt = Date.now() + 1_100;
    await page.getByLabel("Display Name").fill("Local Deletion Athlete");
    await page.getByRole("checkbox", { name: /I accept/i }).check();
    await page.getByRole("checkbox", { name: /I acknowledge/i }).check();
    await page.getByRole("button", { name: "Create athlete profile" }).click();
    await expect(page.getByTestId("house-home")).toBeVisible();
    await primaryNav(page).getByRole("button", { name: "Settings", exact: true }).click();
    await page.getByRole("button", { name: "Delete account", exact: true }).click();
    await expect(page.getByRole("heading", { name: "Delete your account", exact: true })).toBeVisible();
    const download = page.waitForEvent("download");
    await page.getByRole("button", { name: "Export my personal data" }).click();
    expect((await download).suggestedFilename()).toBe("Evolane Curling personal data.json");
    await expect(page.getByRole("button", { name: "Request account deletion" })).toBeDisabled();
    await page.getByRole("checkbox", { name: /I understand what will be deleted/ }).check();
    await page.getByRole("button", { name: "Request account deletion" }).click();
    await expect(page.getByRole("heading", { name: "Account deletion requested" })).toBeVisible();
    await expect(page.getByTestId("house-home")).toHaveCount(0);
    await page.reload();
    await expect(page.getByRole("heading", { name: "Account deletion requested" })).toBeVisible();
    await expect(page.getByTestId("house-home")).toHaveCount(0);

    await page.getByLabel("Confirm your account email").fill(email);
    // Honour the real local provider's per-account resend interval. This is
    // independent of UI speed and does not weaken the provider's rate policy.
    await new Promise(resolve => setTimeout(resolve, Math.max(0, resendAllowedAt - Date.now())));
    requestedAt = Date.now();
    await page.getByRole("button", { name: "Send a new confirmation code" }).click();
    await verifyCode(page, email, requestedAt);
    await expect(page.getByRole("heading", { name: "Account deletion requested" })).toBeVisible();
    await page.getByRole("button", { name: "Keep my account", exact: true }).click();
    // The fresh owned sign-in supplies correlation; cancellation must complete
    // normal trusted-state establishment before the sporting UI returns.
    await expect(page.getByTestId("house-home")).toBeVisible();
    await page.reload();
    await expect(page.getByTestId("house-home")).toBeVisible();
  } finally {
    await context.close().catch(() => {});
  }
});
