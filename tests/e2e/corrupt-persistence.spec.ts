import { expect, test } from "@playwright/test";
import { goToTrain } from "./utils";

const STORAGE_KEY = "curling-release-tracker-current-session";

// Seeds localStorage BEFORE any page script runs, via Playwright's addInitScript —
// this avoids a real race against TrackerApp's own mount effect, which (on a page with
// no saved session yet) creates and persists a brand-new blank session shortly after
// mount. Setting localStorage via page.evaluate() *after* goto() would sometimes lose
// that race and have the corrupt fixture clobbered by the app's own blank-session
// write before the reload ever reads it.
async function seedCorruptSession(page: import("@playwright/test").Page, session: unknown) {
  await page.addInitScript(
    ({ key, value }) => {
      localStorage.setItem(key, JSON.stringify(value));
    },
    { key: STORAGE_KEY, value: session }
  );
  await page.goto("/");
}

test("an inconsistent persisted capturedShotCount is repaired from real shots on load, without losing any existing shot", async ({
  page,
}) => {
  const corruptSession = {
    id: "corrupt-1",
    title: "Corrupt Session",
    date: new Date(0).toISOString(),
    notes: "",
    blocks: [
      {
        id: "block-1",
        name: "Fixed Block",
        mode: "fixed",
        measurementMode: "back-hog",
        targetTime: 3.75,
        createdAt: new Date(0).toISOString(),
      },
    ],
    activeBlockId: "block-1",
    shots: [
      {
        id: "shot-1",
        sessionId: "corrupt-1",
        blockId: "block-1",
        shotNumber: 1,
        releaseTime: 3.7,
        targetTime: 3.75,
        handle: "in",
        captureSequenceId: "seq-1",
        createdAt: new Date(0).toISOString(),
      },
    ],
    captureSequence: {
      id: "seq-1",
      sessionId: "corrupt-1",
      blockId: "block-1",
      expectedShotCount: 8,
      // Deliberately inconsistent: claims 5 captured, but only 1 real shot exists.
      capturedShotCount: 5,
      status: "completed",
      providerType: "simulator",
      handleMode: "fixed-in",
      startHandle: "in",
      processedResultIds: ["r1"],
      steps: [
        { resultId: "r1", shotId: "shot-1", targetTime: 3.75, handle: "in" },
      ],
    },
  };

  await seedCorruptSession(page, corruptSession);

  // The repaired sequence is active (paused) — this is the one case Home
  // defers to Train automatically on load (see docs/adr/0009), so no explicit
  // navigation is needed here, unlike the discarded-sequence case below.
  // The existing real shot must survive untouched.
  await expect(page.getByText("1 shot total")).toBeVisible();

  // The impossible "completed with only 1/8 real shots" state must not be trusted as
  // done — it's reopened as paused (with the repaired, real count) so the user can
  // knowingly decide what to do next, rather than the app silently either treating it
  // as finished or continuing to auto-capture from an inconsistent state.
  await expect(page.getByText("Paused", { exact: true })).toBeVisible();
  await expect(page.getByText("1 / 8 shots")).toBeVisible();
  await expect(
    page.getByText("Paused after an unexpected error — resume to try again.")
  ).toBeVisible();

  await page.getByRole("button", { name: "Resume" }).click();
  await expect(page.getByText("Running", { exact: true })).toBeVisible();
});

test("a capture sequence referencing a non-existent block is discarded, but existing shots are untouched", async ({
  page,
}) => {
  const corruptSession = {
    id: "corrupt-2",
    title: "Corrupt Session 2",
    date: new Date(0).toISOString(),
    notes: "",
    blocks: [
      {
        id: "block-1",
        name: "Fixed Block",
        mode: "fixed",
        measurementMode: "back-hog",
        targetTime: 3.75,
        createdAt: new Date(0).toISOString(),
      },
    ],
    activeBlockId: "block-1",
    shots: [
      {
        id: "shot-1",
        sessionId: "corrupt-2",
        blockId: "block-1",
        shotNumber: 1,
        releaseTime: 3.7,
        targetTime: 3.75,
        handle: "in",
        createdAt: new Date(0).toISOString(),
      },
    ],
    captureSequence: {
      id: "seq-1",
      sessionId: "corrupt-2",
      blockId: "block-that-no-longer-exists",
      expectedShotCount: 4,
      capturedShotCount: 0,
      status: "running",
      providerType: "simulator",
      handleMode: "fixed-in",
      startHandle: "in",
      processedResultIds: [],
      steps: [],
    },
  };

  await seedCorruptSession(page, corruptSession);
  await page.waitForSelector("text=Today's Plan");
  await goToTrain(page);

  await expect(page.getByText("1 shot total")).toBeVisible();
  // No stale/broken sequence surfaces — the Start Auto Capture form shows, not a
  // "Previous capture" summary referencing data that no longer makes sense.
  await expect(page.getByText("Start Auto Capture")).toBeVisible();
  await expect(page.getByText(/Previous capture/)).toHaveCount(0);
});
