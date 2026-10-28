import { expect, test } from "@playwright/test";
import { freshLoad, goToAnalyze, goToSettings, setupFixedBlock, startNewSessionFromManagement } from "./utils";

test("optional analytics uses the real SDK, explicit consent, matching events and sanitized payloads", async ({ page }, testInfo) => {
  // PostHog intentionally suppresses webdriver-driven traffic. This local test
  // models a consenting human browser; all provider traffic is still intercepted.
  await page.addInitScript(() => {
    Object.defineProperty(navigator, "webdriver", { get: () => false });
    Object.defineProperty(navigator, "userAgentData", { get: () => undefined });
  });
  const requests: string[] = [];
  const payloads: Array<{ event?: string; properties?: Record<string, unknown>; $set?: unknown; $set_once?: unknown }> = [];
  // Every provider request is fulfilled locally: no test credentials, sporting
  // data or fixture usage can ever reach a real PostHog project.
  await page.route(/https:\/\/[^/]*posthog\.com\//, async route => {
    const request = route.request();
    requests.push(request.url());
    const body = request.postData();
    if (body) {
      try {
        const data = new URLSearchParams(body).get("data");
        const parsed = JSON.parse(data ? Buffer.from(data, "base64").toString("utf8") : body);
        payloads.push(...(Array.isArray(parsed.batch) ? parsed.batch : Array.isArray(parsed) ? parsed : [parsed]));
      } catch { /* flags/config requests carry no capture payload */ }
    }
    await route.fulfill({ status: 200, contentType: "application/json", headers: { "access-control-allow-origin": "*", "access-control-allow-headers": "*", "access-control-allow-methods": "*" }, body: '{"status":1}' });
  });

  await freshLoad(page);
  await goToSettings(page);
  const consent = page.getByRole("checkbox", { name: /Help improve Evolane Curling/ });
  await expect(consent).not.toBeChecked();
  expect(requests).toHaveLength(0);
  await consent.check();
  await expect(consent).toBeChecked();
  await expect.poll(() => payloads.some(item => item.event === "$identify")).toBe(true);
  const widths = await page.evaluate(() => ({ client: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
  expect(widths.scroll).toBeLessThanOrEqual(widths.client);
  await page.getByRole("region", { name: "Optional usage analytics" }).screenshot({ path: testInfo.outputPath("analytics-consent.png") });

  await setupFixedBlock(page);
  const shotEntry = page.locator("div", { has: page.getByRole("heading", { name: "Add Shot" }) }).last();
  await shotEntry.locator('input[inputmode="decimal"]').first().fill("3.80");
  await shotEntry.getByRole("button", { name: "Save Shot", exact: true }).click();
  await startNewSessionFromManagement(page);
  await page.getByRole("button", { name: "Complete", exact: true }).click();
  await page.getByRole("heading", { level: 2, name: "Exercises" }).waitFor();
  await goToAnalyze(page);
  for (const event of ["exercise_viewed", "exercise_started", "exercise_completed", "training_started", "training_completed", "analysis_viewed"]) {
    await expect.poll(() => payloads.some(item => item.event === event), { message: `Missing ${event}` }).toBe(true);
  }
  expect(payloads.filter(item => item.event === "training_completed")).toHaveLength(1);
  for (const payload of payloads) {
    if (!payload.event) continue;
    expect(payload.$set).toBeUndefined(); expect(payload.$set_once).toBeUndefined();
    expect(payload.properties?.token).toBe("phc_syntheticE2EOnly0001");
    expect(payload.properties?.distinct_id).toMatch(/^profile_[0-9a-f]{64}$/);
    expect(Object.keys(payload.properties ?? {})).toEqual(expect.arrayContaining(["analytics_schema_version", "environment"]));
    const allowed = new Set(["distinct_id", "$anon_distinct_id", "$process_person_profile", "app_platform", "analytics_schema_version", "environment", "token"]);
    for (const key of Object.keys(payload.properties ?? {})) expect(allowed.has(key), `Unexpected outgoing property: ${key}`).toBe(true);
    expect(JSON.stringify(payload)).not.toContain("3.80");
  }

  await goToSettings(page);
  await consent.uncheck();
  await expect(consent).not.toBeChecked();
  const count = requests.length;
  await goToAnalyze(page);
  await page.reload();
  await page.getByTestId("house-home").waitFor();
  await goToSettings(page);
  await expect(consent).not.toBeChecked();
  expect(requests).toHaveLength(count);
  // Optionality does not disable sporting history or its export.
  await expect(page.getByRole("button", { name: "Export History CSV" })).toBeEnabled();
});
