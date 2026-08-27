import { expect, test } from "@playwright/test";

test.describe("mandatory identity gate", () => {
  test.describe("without an authenticated profile", () => {
    test.use({ storageState: { cookies: [], origins: [] } });

    test("keeps the sporting application unmounted and offers the real sign-in entry", async ({ page }) => {
      await page.goto("/");

      await expect(page.getByRole("heading", { name: "Athlete access" })).toBeVisible();
      await expect(page.getByLabel("Email address")).toBeVisible();
      await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
      await expect(page.getByRole("link", { name: /Privacy Notice \(e2e-fixture-privacy-v1\)/ })).toBeVisible();
      await expect(page.getByText("Today's Plan")).toHaveCount(0);
      await expect(page.getByTestId("primary-nav-mobile")).toHaveCount(0);
    });
  });
});
