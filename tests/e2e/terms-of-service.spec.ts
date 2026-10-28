import { expect, test } from "@playwright/test";

test.describe("public Terms of Service", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("is readable before sign-in at both current and immutable routes", async ({ page }) => {
    for (const [path, version, contact] of [
      ["/terms", "terms-2026-10-28-ch-beta", "notifications@evolane.me"],
      ["/legal/terms/2026-10-28-ch-beta", "terms-2026-10-28-ch-beta", "notifications@evolane.me"],
      ["/legal/terms/2026-10-27-posthog", "terms-2026-10-27-posthog", "notifications@evolane.me"],
      ["/legal/terms/2026-10-27", "terms-2026-10-27", "notifications@evolane.me"],
      ["/legal/terms/2026-10-24", "terms-2026-10-24", "info@evolane.swiss"],
      ["/legal/terms/2026-08-29", "terms-2026-08-29", "info@evolane.swiss"],
    ]) {
      await page.goto(path);

      await expect(page.getByRole("heading", { level: 1, name: "Terms of Service" })).toBeVisible();
      await expect(page.getByText(version, { exact: true })).toBeVisible();
      await expect(page.getByText("Evolane Curling", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: contact })).toHaveAttribute(
        "href",
        `mailto:${contact}`
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
