import { expect, test } from "@playwright/test";
import { freshLoad, setupFixedBlock, startAutoCapture } from "./utils";

test("a delayed simulator result scheduled before Cancel must not create a shot after cancelling", async ({
  page,
}) => {
  await freshLoad(page);
  await setupFixedBlock(page);
  await startAutoCapture(page, { count: 4, handleMode: "Fixed In" });

  // Schedule a delayed result (fires ~1.5s later) via the Simulator's "Delayed" button.
  await page.getByRole("button", { name: "Delayed (1.5s)" }).click();

  // Cancel the sequence well before the delayed result fires.
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page
    .getByRole("button", { name: "Cancel Capture" })
    .click();

  // Back to the Start form — the previous sequence is now cancelled.
  await expect(page.getByText(/Previous capture cancelled/)).toBeVisible();

  // Wait past the delay window; the stale result must not have created a shot —
  // cancelling the sequence means processTimingResult sees status "cancelled" and
  // returns "ignored-completed" for it, regardless of when it actually arrives.
  await page.waitForTimeout(2000);
  await expect(page.getByText(/Previous capture cancelled after 0 shot/)).toBeVisible();
});

test("documents a known scope limit: a delayed result outliving a Cancel is attributed to whatever sequence is running when it arrives", async ({
  page,
}) => {
  // A TimingResult carries no sequence identity (see docs/adr/0006 — real hardware has
  // no concept of "which capture sequence" either). Cancel is guarded by status
  // ("cancelled" sequences ignore every result, per the test above); it is NOT a
  // per-result "generation token" that also invalidates a *new* sequence's willingness
  // to accept a result that happened to be in flight before it started. This is a
  // deliberate, documented scope limit (see docs/TECHNICAL_DEBT_AND_ROADMAP.md), not an
  // oversight — this test locks in the current, real behavior so a future change to it
  // is a conscious decision, not a silent regression.
  await freshLoad(page);
  await setupFixedBlock(page);
  await startAutoCapture(page, { count: 4, handleMode: "Fixed In" });

  await page.getByRole("button", { name: "Delayed (1.5s)" }).click();

  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.getByRole("button", { name: "Cancel Capture" }).click();

  // Start a brand-new sequence right away, for the same block.
  await startAutoCapture(page, { count: 3, handleMode: "Fixed In" });

  // The old delayed result fires while the new sequence is running — it becomes the
  // new sequence's first captured shot.
  await expect(page.getByText("1 / 3 shots")).toBeVisible({ timeout: 3000 });
});
