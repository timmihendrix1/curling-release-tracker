import { expect, test } from "@playwright/test";
import { freshLoad, goToTrain } from "./utils";

test("Training Category Help: Fixed, Variable and Blind Weight each explain purpose and mechanics", async ({
  page,
}) => {
  await freshLoad(page);
  await goToTrain(page);
  await page.waitForSelector("text=Set Up Training Block");

  // Fixed Weight is selected by default on the first Setup screen.
  await page.getByRole("button", { name: "About Fixed Weight" }).click();
  await expect(page.getByRole("dialog", { name: "Fixed Weight" })).toBeVisible();
  await expect(
    page.getByText("Can I repeatedly reproduce the same release?")
  ).toBeVisible();
  await expect(page.getByText("How it works")).toBeVisible();
  await expect(page.getByText("Useful for")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  await page.getByRole("button", { name: "About Variable Weight" }).click();
  await expect(page.getByRole("dialog", { name: "Variable Weight" })).toBeVisible();
  await expect(
    page.getByText("Can I adapt accurately to changing targets?")
  ).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "About Blind Weight" }).click();
  const blindDialog = page.getByRole("dialog", { name: "Blind Weight" });
  await expect(blindDialog).toBeVisible();
  await expect(
    blindDialog.getByText("Can I accurately judge my own release?")
  ).toBeVisible();
  // Prediction Accuracy and Target Accuracy are named as two distinct questions.
  await expect(blindDialog.getByText(/Prediction Accuracy/)).toBeVisible();
  await expect(blindDialog.getByText(/Target Accuracy/)).toBeVisible();
  await page.keyboard.press("Escape");

  // Opening/closing Info popovers never affected the actual selection —
  // Training Mode selection still works normally afterward.
  await page.getByRole("button", { name: "Blind Weight", exact: true }).click();
  await page.getByRole("button", { name: "Start Training", exact: true }).click();
  await page.waitForSelector("text=Active Training Block");
});

test("Measurement Mode Help: Backline – Hog and Hog – Hog explain the difference", async ({
  page,
}) => {
  await freshLoad(page);
  await goToTrain(page);
  await page.waitForSelector("text=Set Up Training Block");

  await page.getByRole("button", { name: "About Backline – Hog" }).click();
  await expect(page.getByRole("dialog", { name: "Backline – Hog" })).toBeVisible();
  await expect(page.getByText(/more weight/)).toBeVisible();
  await page.keyboard.press("Escape");

  await page.getByRole("button", { name: "About Hog – Hog" }).click();
  await expect(page.getByRole("dialog", { name: "Hog – Hog" })).toBeVisible();
  await expect(page.getByText(/never be mixed or compared directly/)).toBeVisible();
  await page.keyboard.press("Escape");

  // Selecting Measurement Mode still works after reading both explanations.
  await page.getByRole("button", { name: "Hog – Hog", exact: true }).click();
  await page.getByRole("button", { name: "Start Training", exact: true }).click();
  await page.waitForSelector("text=Active Training Block");
});

test("Accuracy Thresholds Help explains On Target / Acceptable / Major Miss at Setup time", async ({
  page,
}) => {
  await freshLoad(page);
  await goToTrain(page);
  await page.waitForSelector("text=Set Up Training Block");

  await page.getByRole("button", { name: "About Accuracy Thresholds" }).click();
  await expect(page.getByRole("dialog", { name: "Accuracy Thresholds" })).toBeVisible();
  await expect(page.getByText(/On Target: shots within/)).toBeVisible();
  await expect(page.getByText(/not scientifically validated/)).toBeVisible();
});

test("Mobile viewport (390x844): Training Category Info popover is fully readable without horizontal overflow", async ({
  page,
}) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await freshLoad(page);
  await goToTrain(page);
  await page.waitForSelector("text=Set Up Training Block");

  await page.getByRole("button", { name: "About Blind Weight" }).click();
  await expect(page.getByRole("dialog", { name: "Blind Weight" })).toBeVisible();
  await expect(
    page.getByText("Can I accurately judge my own release?")
  ).toBeVisible();

  const hasHorizontalOverflow = await page.evaluate(
    () => document.documentElement.scrollWidth > document.documentElement.clientWidth
  );
  expect(hasHorizontalOverflow).toBe(false);

  await page.keyboard.press("Escape");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "About Blind Weight" })
  ).toBeFocused();
});
