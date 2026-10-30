import { test, expect } from "@playwright/test";
test.use({ storageState: { cookies: [], origins: [] } });
test("Web keeps normal OTP and Google choices without app-review password entry", async ({ page }) => {
  await page.goto("/");
  await expect(page.getByRole("button", { name: "Send sign-in code" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Access for app review" })).toHaveCount(0);
  await expect(page.getByLabel("Password", { exact: true })).toHaveCount(0);
});
