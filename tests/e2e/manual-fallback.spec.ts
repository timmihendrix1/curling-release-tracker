import { expect, test } from "@playwright/test";
import {
  captureManualResultInput,
  freshLoad,
  setupFixedBlock,
  startAutoCapture,
} from "./utils";

test("manual fallback completes a capture sequence without the simulator", async ({
  page,
}) => {
  await freshLoad(page);
  await setupFixedBlock(page);
  await startAutoCapture(page, { count: 2, handleMode: "Fixed In" });

  const manualInput = captureManualResultInput(page);

  await manualInput.fill("3.68");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(page.getByText("1 / 2 shots")).toBeVisible();
  await expect(page.getByText(/Shot 1 captured: 3\.68s/)).toBeVisible();

  await manualInput.fill("3.71");
  await page.getByRole("button", { name: "Add", exact: true }).click();
  await expect(
    page.getByText("Previous capture complete: 2 / 2 shots captured.")
  ).toBeVisible();

  // The classic manual flow (outside any capture sequence) must remain fully intact.
  await expect(page.getByText("2 shots total")).toBeVisible();
});
