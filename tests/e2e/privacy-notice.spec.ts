import { expect, test } from "@playwright/test";

test.describe("public Privacy Notice", () => {
  test.use({ storageState: { cookies: [], origins: [] } });

  test("is readable before sign-in at both current and immutable routes", async ({ page }) => {
    for (const [path, version, contact] of [
      ["/privacy", "privacy-2026-10-28-ch-beta", "notifications@evolane.me"],
      ["/legal/privacy/2026-10-28-ch-beta", "privacy-2026-10-28-ch-beta", "notifications@evolane.me"],
      ["/legal/privacy/2026-10-27-posthog", "privacy-2026-10-27-posthog", "notifications@evolane.me"],
      ["/legal/privacy/2026-10-27", "privacy-2026-10-27", "notifications@evolane.me"],
      ["/legal/privacy/2026-10-24", "privacy-2026-10-24", "info@evolane.swiss"],
      ["/legal/privacy/2026-08-28", "privacy-2026-08-28", "info@evolane.swiss"],
    ]) {
      await page.goto(path);

      await expect(page.getByRole("heading", { level: 1, name: "Privacy Notice" })).toBeVisible();
      await expect(page.getByText(version, { exact: true })).toBeVisible();
      await expect(page.getByText("Evolane Curling", { exact: true })).toBeVisible();
      await expect(page.getByRole("link", { name: contact }).first()).toHaveAttribute(
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
