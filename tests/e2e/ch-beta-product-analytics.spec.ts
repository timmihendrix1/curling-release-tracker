import { expect, test, type Page } from "@playwright/test";
import { goToAnalyze, goToSettings } from "./utils";

test.skip(process.env.NEXT_PUBLIC_POSTHOG_CH_BETA !== "1", "Dedicated Swiss beta build; default suite verifies explicit opt-in.");

async function setup(page: Page, freshChoice = true) {
  const requests: string[] = [];
  const payloads: Array<{ event?: string; properties?: Record<string, unknown> }> = [];
  await page.addInitScript(({ fresh }) => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "userAgentData", { get: () => undefined });
    if (fresh && !sessionStorage.getItem("qa.ch.entry.prepared")) {
      localStorage.removeItem("curling.product-analytics-consent.v1");
      sessionStorage.setItem("qa.ch.entry.prepared", "1");
    }
  }, { fresh: freshChoice });
  await page.route(/https:\/\/[^/]*posthog\.com\//, async route => {
    requests.push(route.request().url());
    const body = route.request().postData();
    if (body) {
      try {
        const data = new URLSearchParams(body).get("data");
        const parsed = JSON.parse(data ? Buffer.from(data, "base64").toString("utf8") : body);
        payloads.push(...(Array.isArray(parsed.batch) ? parsed.batch : Array.isArray(parsed) ? parsed : [parsed]));
      } catch { /* non-event requests carry no event body */ }
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }, body: '{"status":1}' });
  });
  await page.goto("/");
  return { requests, payloads };
}

test("Swiss notice precedes SDK traffic, Continue enables and Settings withdrawal survives reload", async ({ page }, info) => {
  const { requests, payloads } = await setup(page);
  await expect(page.getByRole("heading", { name: "Help improve Evolane Curling", exact: true })).toBeVisible();
  expect(requests).toHaveLength(0);
  await expect(page.getByRole("link", { name: "How usage analytics works", exact: true })).toHaveAttribute("href", "/legal/privacy/2026-10-28-ch-beta");
  await page.screenshot({ path: info.outputPath("swiss-beta-entry.png"), fullPage: true });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
  for (const name of ["Continue", "Continue without usage analytics"]) {
    const button = await page.getByRole("button", { name, exact: true }).boundingBox();
    expect(button).not.toBeNull();
    expect(button!.y + button!.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
  }
  await page.getByRole("button", { name: "Continue", exact: true }).click();
  await page.getByTestId("house-home").waitFor();
  await expect.poll(() => payloads.some(p => p.event === "$identify")).toBe(true);
  await goToSettings(page);
  const choice = page.getByRole("checkbox", { name: /Help improve Evolane Curling/ });
  await expect(choice).toBeChecked();
  await choice.uncheck();
  const count = requests.length;
  await page.reload(); await page.getByTestId("house-home").waitFor();
  await goToAnalyze(page); await goToSettings(page);
  await expect(choice).not.toBeChecked();
  expect(requests).toHaveLength(count);
});

test("Continue without analytics retains the same app and keeps refusal after reload", async ({ page }) => {
  const { requests } = await setup(page);
  await page.getByRole("button", { name: "Continue without usage analytics", exact: true }).click();
  await page.getByTestId("house-home").waitFor();
  await expect(page.getByRole("button", { name: /Start Training/ })).toBeEnabled();
  await goToAnalyze(page);
  await page.reload(); await page.getByTestId("house-home").waitFor();
  await goToSettings(page);
  await expect(page.getByRole("checkbox", { name: /Help improve Evolane Curling/ })).not.toBeChecked();
  expect(requests).toHaveLength(0);
});

test("legacy refusal is never replaced by the Swiss default", async ({ page }) => {
  const { requests } = await setup(page, false);
  await page.getByTestId("house-home").waitFor();
  await expect(page.getByRole("button", { name: "Continue", exact: true })).toHaveCount(0);
  await goToSettings(page);
  await expect(page.getByRole("checkbox", { name: /Help improve Evolane Curling/ })).not.toBeChecked();
  expect(requests).toHaveLength(0);
});
