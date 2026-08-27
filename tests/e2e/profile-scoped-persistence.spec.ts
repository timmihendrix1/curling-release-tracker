import { expect, test, type Page } from "@playwright/test";
import { E2E_TEST_EMAIL, readLatestOtp } from "./global-setup";
import { freshLoad, goToHome, goToTrain, setupFixedBlock } from "./utils";

const SECOND_EMAIL = "playwright-profile-switch@example.invalid";

async function signInAndCompleteOnboarding(page: Page, email: string, displayName: string) {
  const requestedAt = Date.now();
  await page.getByLabel("Email address").fill(email);
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  const otp = await readLatestOtp(email, requestedAt);
  await page.getByLabel("6-digit code").fill(otp);
  await page.getByRole("button", { name: "Verify code" }).click();

  const destination = await Promise.race([
    page.getByLabel("Display Name").waitFor().then(() => "onboarding" as const),
    page.getByText("Today's Plan").waitFor().then(() => "ready" as const),
  ]);
  if (destination === "onboarding") {
    await page.getByLabel("Display Name").fill(displayName);
    await page.getByRole("checkbox", { name: /I accept/i }).check();
    await page.getByRole("checkbox", { name: /I acknowledge/i }).check();
    await page.getByRole("button", { name: "Create athlete profile" }).click();
  }
  await page.getByText("Today's Plan").waitFor();
}

async function currentProfileId(page: Page): Promise<string> {
  return page.evaluate(() => {
    const raw = localStorage.getItem("curling.identity.trustedDevice.v1");
    if (raw === null) throw new Error("Trusted Profile missing.");
    const parsed: unknown = JSON.parse(raw);
    if (
      typeof parsed !== "object" ||
      parsed === null ||
      !("profileId" in parsed) ||
      typeof parsed.profileId !== "string"
    ) {
      throw new Error("Trusted Profile malformed.");
    }
    return parsed.profileId;
  });
}

async function signOutThroughAccessibleControl(page: Page) {
  // `next dev` turns the pre-existing Recharts size warning into an overlay that
  // can intercept pointer input. Keyboard activation still exercises the real,
  // accessible button and avoids coupling this identity test to Next's dev UI.
  await page.getByRole("button", { name: "Sign out" }).press("Enter");
}

test("sign-out and account switching hide the previous Profile workspace and restore only its own data", async ({
  page,
}) => {
  test.setTimeout(90_000);
  await freshLoad(page);
  const profileA = await currentProfileId(page);
  await setupFixedBlock(page);
  await page.getByPlaceholder("3.75 or 375").fill("3.80");
  await page.getByRole("button", { name: "Add Shot" }).click();
  await expect(page.getByText("1 shot total")).toBeVisible();

  await goToHome(page);
  await signOutThroughAccessibleControl(page);
  await expect(page.getByLabel("Email address")).toBeVisible();
  await expect(page.getByText("1 shot total")).not.toBeVisible();

  await signInAndCompleteOnboarding(page, SECOND_EMAIL, "Second Playwright Athlete");
  const profileB = await currentProfileId(page);
  expect(profileB).not.toBe(profileA);
  await goToTrain(page);
  await expect(page.getByText("1 shot total")).not.toBeVisible();
  await expect(page.getByText("Set Up Training Block")).toBeVisible();

  const physicalKeys = await page.evaluate(() => Object.keys(localStorage));
  expect(physicalKeys.some((key) => key.includes(`.${profileA}.`))).toBe(true);
  expect(physicalKeys.some((key) => key.includes(`.${profileB}.`))).toBe(true);

  await signOutThroughAccessibleControl(page);
  await signInAndCompleteOnboarding(page, E2E_TEST_EMAIL, "Playwright Athlete");
  expect(await currentProfileId(page)).toBe(profileA);
  await goToTrain(page);
  await expect(page.getByText("1 shot total")).toBeVisible();
});
