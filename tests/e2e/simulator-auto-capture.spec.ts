import { expect, test } from "@playwright/test";
import { freshLoad, setupFixedBlock, startAutoCapture } from "./utils";

test("simulator drives a full capture sequence, including duplicate handling", async ({
  page,
}) => {
  await freshLoad(page);
  await setupFixedBlock(page);
  await startAutoCapture(page, { count: 3, handleMode: "Fixed In" });

  // Shot 1 via a quick-value button.
  await page.getByRole("button", { name: "3.50s" }).click();
  await expect(page.getByText("1 / 3 shots")).toBeVisible();
  await expect(page.getByText(/Shot 1 captured: 3\.50s/)).toBeVisible();

  // Resending the exact same result must not create a second shot or advance
  // the sequence counter.
  await page.getByRole("button", { name: "Duplicate Result" }).click();
  await expect(page.getByText("1 / 3 shots")).toBeVisible();
  await expect(page.getByText(/^duplicate —/)).toBeVisible();

  // Shot 2 and 3 complete the sequence.
  await page.getByRole("button", { name: "3.75s" }).click();
  await expect(page.getByText("2 / 3 shots")).toBeVisible();

  await page.getByRole("button", { name: "4.00s" }).click();

  // Sequence auto-completes at expectedShotCount; the Start form reappears
  // with a completion summary instead of the active panel.
  await expect(page.getByText("Previous capture complete: 3 / 3 shots captured.")).toBeVisible();

  // A result arriving after completion must be diagnosed, not silently applied.
  await page.getByRole("button", { name: "3.50s" }).click();
  await expect(page.getByText(/^ignored-completed —/)).toBeVisible();
});
