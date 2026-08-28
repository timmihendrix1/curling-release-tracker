import { expect, test } from "@playwright/test";

test.describe("public Privacy Notice", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("is readable before sign-in at both current and immutable routes", async ({ page }) => {
    for (const path of ["/privacy", "/legal/privacy/2026-08-28"]) {
      await page.goto(path);

      await expect(page.getByRole("heading", { level: 1, name: "Privacy Notice" })).toBeVisible();
      await expect(page.getByText("privacy-2026-08-28", { exact: true })).toBeVisible();
      await expect(page.getByText("Evolane Curling", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: "info@evolane.swiss" }).first()).toHaveAttribute(
        "href",
        "mailto:info@evolane.swiss"
      );
      await expect(page.getByRole("heading", { name: "Athlete access" })).toHaveCount(0);

      const widths = await page.evaluate(() => ({
        client: document.documentElement.clientWidth,
        scroll: document.documentElement.scrollWidth,
      }));
      expect(widths.scroll).toBeLessThanOrEqual(widths.client);
    }
  });
});
