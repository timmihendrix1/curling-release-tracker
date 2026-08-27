import { expect, test } from "@playwright/test";
import {
  freshLoad,
  goToAnalyze,
  goToAssess,
  goToHome,
  goToSettings,
  goToTrain,
  primaryNav,
  primaryNavDesktop,
  setupFixedBlock,
  startAutoCapture,
} from "./utils";

test.describe("First Run", () => {
  test("a brand-new user lands on Home with honest empty states and no invented plans", async ({
    page,
  }) => {
    await freshLoad(page);

    await expect(page.getByRole("heading", { name: "Curling Performance" })).toBeVisible();
    await expect(
      page.getByText("Train, assess and understand your performance.")
    ).toBeVisible();
    await expect(page.getByText("Curling Release Tracker")).toHaveCount(0);

    await expect(page.getByText(/^Good (morning|afternoon|evening)$/)).toBeVisible();

    await expect(page.getByText("No scheduled session.")).toBeVisible();
    await expect(page.getByText("Start whenever you're ready.")).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Start Training" })
    ).toBeVisible();

    await expect(page.getByText("Training Overview")).toBeVisible();
    await expect(page.getByText("Performance Snapshot")).toHaveCount(0);
    await expect(page.getByText("No training completed yet.")).toBeVisible();
    await expect(
      page.getByText("Start your first training to build your performance history.")
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "View Analyze" })).toBeVisible();

    await expect(page.getByText("Quick Access")).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Open Analyze" })).toHaveCount(0);

    await expect(page.getByText("Manual Timing")).toBeVisible();
    await expect(
      page.getByText("External timing systems will be supported here.")
    ).toBeVisible();
    await expect(
      page.getByText("External timing systems will appear here when connected.")
    ).toHaveCount(0);

    // Schedule, Coach, and Team are grouped under "Coming next" — visibly
    // future capabilities, not working features, never three separate
    // full-width cards.
    await expect(page.getByRole("heading", { name: "Coming next" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Schedule", exact: true })).toBeVisible();
    await expect(page.getByText("Plan and repeat training sessions.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Coach", exact: true })).toBeVisible();
    await expect(page.getByText("Assigned training and feedback.")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
    await expect(page.getByText("Shared training and performance.")).toBeVisible();
    await expect(page.getByText("Coming soon")).toHaveCount(3);
  });
});

test.describe("Navigation", () => {
  test("Home, Train, Analyze, and Settings are all reachable, with the active tab always marked", async ({
    page,
  }) => {
    await freshLoad(page);
    await expect(primaryNav(page).getByRole("button", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page"
    );

    await goToTrain(page);
    await expect(page.getByText("Set Up Training Block")).toBeVisible();
    await expect(primaryNav(page).getByRole("button", { name: "Train" })).toHaveAttribute(
      "aria-current",
      "page"
    );

    await goToAnalyze(page);
    await expect(page.getByRole("heading", { name: "Analyze" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Training" })).toBeVisible();
    await expect(page.getByRole("tab", { name: "Assessments" })).toBeVisible();
    await expect(
      primaryNav(page).getByRole("button", { name: "Analyze" })
    ).toHaveAttribute("aria-current", "page");

    await goToSettings(page);
    await expect(page.getByText("Data Management")).toBeVisible();
    await expect(
      primaryNav(page).getByRole("button", { name: "Settings" })
    ).toHaveAttribute("aria-current", "page");

    await goToHome(page);
    await expect(page.getByText("No scheduled session.")).toBeVisible();
    await expect(primaryNav(page).getByRole("button", { name: "Home" })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });

  test("Assess is a real, reachable navigation tab", async ({ page }) => {
    await freshLoad(page);
    await expect(primaryNav(page).getByRole("button", { name: "Assess" })).toBeVisible();
    await goToAssess(page);
    await expect(primaryNav(page).getByRole("button", { name: "Assess" })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });
});

test.describe("Start Training", () => {
  test("Home's Start Training reaches Setup, and a recorded shot survives a Home round trip", async ({
    page,
  }) => {
    await freshLoad(page);
    await page.getByRole("button", { name: "Start Training" }).click();
    await expect(page.getByText("Set Up Training Block")).toBeVisible();

    await setupFixedBlock(page);

    const shotEntry = page.locator("div", {
      has: page.getByRole("heading", { name: "Add Shot" }),
    });
    await shotEntry.locator('input[inputmode="decimal"]').first().fill("3.80");
    await shotEntry.getByRole("button", { name: "Add Shot", exact: true }).click();
    await expect(page.getByText("1 shot total")).toBeVisible();

    await goToHome(page);
    await expect(page.getByText("Active Training Block", { exact: true })).toHaveCount(0);

    await goToTrain(page);
    await expect(page.getByText("Active Training Block", { exact: true })).toBeVisible();
    await expect(page.getByText("1 shot total")).toBeVisible();
  });
});

test.describe("Active Capture", () => {
  test("a Home/Train round trip before starting Auto Capture never duplicates the simulator subscription", async ({
    page,
  }) => {
    await freshLoad(page);
    await setupFixedBlock(page);

    // Round-trip through Home before any capture sequence exists — TrackerApp
    // itself never unmounts across navigation, so this must not create a
    // second simulator subscription (see docs/adr/0007 and 0009).
    await goToHome(page);
    await goToTrain(page);
    await expect(page.getByText("Active Training Block", { exact: true })).toBeVisible();

    await startAutoCapture(page, { count: 3, handleMode: "Fixed In" });

    // A single quick-value result must produce exactly one captured shot — a
    // duplicated subscription would capture it twice.
    await page.getByRole("button", { name: "3.50s" }).click();
    await expect(page.getByText("1 / 3 shots")).toBeVisible();
    await expect(page.getByText("#1 ·", { exact: false })).toHaveCount(1);
  });

  test("leaving Train while Auto Capture is running warns before navigating away, and cancelling the warning keeps the sequence intact", async ({
    page,
  }) => {
    await freshLoad(page);
    await setupFixedBlock(page);
    await startAutoCapture(page, { count: 3, handleMode: "Fixed In" });

    await primaryNav(page).getByRole("button", { name: "Analyze" }).click();
    const warningHeading = page.getByRole("heading", { name: "Auto Capture In Progress" });
    await expect(warningHeading).toBeVisible();
    const warningDialog = warningHeading.locator("..");

    await warningDialog.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByText("0 / 3 shots")).toBeVisible();
    await expect(primaryNav(page).getByRole("button", { name: "Train" })).toHaveAttribute(
      "aria-current",
      "page"
    );
  });
});

test.describe("Mobile", () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test("Home is fully usable at 390x844: nav visible, no horizontal overflow, Today's Plan prominent", async ({
    page,
  }) => {
    await freshLoad(page);

    await expect(page.getByTestId("primary-nav-mobile")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Curling Performance" })).toBeVisible();
    await expect(page.getByText("Train, assess and understand your performance.")).toBeVisible();
    await expect(page.getByText("Today's Plan")).toBeVisible();
    await expect(page.getByText("Training Overview")).toBeVisible();
    await expect(page.getByRole("button", { name: "View Analyze" })).toBeVisible();
    await expect(page.getByText("Manual Timing")).toBeVisible();
    await expect(
      page.getByText("External timing systems will be supported here.")
    ).toBeVisible();
    await expect(page.getByRole("heading", { name: "Coming next" })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Schedule", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Coach", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Team", exact: true })).toBeVisible();
    await expect(page.getByText("Plan and repeat training sessions.")).toBeVisible();
    await expect(page.getByText("Assigned training and feedback.")).toBeVisible();
    await expect(page.getByText("Shared training and performance.")).toBeVisible();

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalOverflow).toBe(false);

    // The Coming next section is one shared container, not three separate
    // full-width cards — exactly one dashed border box on the page.
    const dashedContainerCount = await page.locator(".border-dashed").count();
    expect(dashedContainerCount).toBe(1);

    // The "Coming soon" badge must stay on the same line as its capability's
    // title, never wrapping onto its own row.
    const scheduleTitleBox = await page
      .getByRole("heading", { name: "Schedule", exact: true })
      .boundingBox();
    const scheduleBadgeBox = await page.getByText("Coming soon").first().boundingBox();
    expect(scheduleTitleBox).not.toBeNull();
    expect(scheduleBadgeBox).not.toBeNull();
    if (scheduleTitleBox && scheduleBadgeBox) {
      const titleCenterY = scheduleTitleBox.y + scheduleTitleBox.height / 2;
      const badgeCenterY = scheduleBadgeBox.y + scheduleBadgeBox.height / 2;
      expect(Math.abs(titleCenterY - badgeCenterY)).toBeLessThan(8);
    }

    // The bottom nav must not cover the primary action or Coming next content.
    const startTrainingBox = await page
      .getByRole("button", { name: "Start Training" })
      .boundingBox();
    const navBox = await page.getByTestId("primary-nav-mobile").boundingBox();
    expect(startTrainingBox).not.toBeNull();
    expect(navBox).not.toBeNull();
    if (startTrainingBox && navBox) {
      expect(startTrainingBox.y + startTrainingBox.height).toBeLessThanOrEqual(navBox.y);
    }

    // The page should still scroll all the way to its last content (Team,
    // the last Coming next row) without a huge stretch of empty card space
    // from the now-removed sections, and scrolling to the true bottom must
    // leave the last content clear of the fixed bottom nav. Uses an explicit
    // max-scroll rather than scrollIntoViewIfNeeded, which aligns flush to
    // whichever viewport edge is nearest and would falsely fail here even
    // though further, nav-clearing scroll room exists (the page reserves
    // bottom padding for exactly this).
    const lastContent = page.getByText("Shared training and performance.");
    await page.evaluate(() =>
      window.scrollTo(0, document.documentElement.scrollHeight)
    );
    await expect(lastContent).toBeInViewport();
    const comingNextBox = await lastContent.boundingBox();
    const navBoxAfterScroll = await page.getByTestId("primary-nav-mobile").boundingBox();
    expect(comingNextBox).not.toBeNull();
    expect(navBoxAfterScroll).not.toBeNull();
    if (comingNextBox && navBoxAfterScroll) {
      expect(comingNextBox.y + comingNextBox.height).toBeLessThanOrEqual(navBoxAfterScroll.y);
    }
  });
});

test.describe("Narrow Mobile", () => {
  test.use({ viewport: { width: 320, height: 700 } });

  test("Home is fully readable at 320x700: no overflow, all three Coming next capabilities legible", async ({
    page,
  }) => {
    await freshLoad(page);

    const hasHorizontalOverflow = await page.evaluate(
      () => document.documentElement.scrollWidth > document.documentElement.clientWidth
    );
    expect(hasHorizontalOverflow).toBe(false);

    for (const [title, description] of [
      ["Schedule", "Plan and repeat training sessions."],
      ["Coach", "Assigned training and feedback."],
      ["Team", "Shared training and performance."],
    ] as const) {
      const titleHeading = page.getByRole("heading", { name: title, exact: true });
      await titleHeading.scrollIntoViewIfNeeded();
      await expect(titleHeading).toBeVisible();
      await expect(page.getByText(description)).toBeVisible();
    }

    await expect(page.getByText("Coming soon")).toHaveCount(3);

    // No two capability rows overlap vertically — each is its own readable
    // row within the shared container, never overlapping text.
    const boxes = await Promise.all(
      (["Schedule", "Coach", "Team"] as const).map((title) =>
        page.getByRole("heading", { name: title, exact: true }).boundingBox()
      )
    );
    expect(boxes.every((box) => box !== null)).toBe(true);
    const [scheduleBox, coachBox, teamBox] = boxes;
    if (scheduleBox && coachBox && teamBox) {
      expect(scheduleBox.y).toBeLessThan(coachBox.y);
      expect(coachBox.y).toBeLessThan(teamBox.y);
    }
  });
});

test.describe("Desktop", () => {
  test.use({ viewport: { width: 1280, height: 800 } });

  test("desktop navigation shows the same Home/Train/Analyze/Settings structure", async ({
    page,
  }) => {
    await freshLoad(page);

    await expect(primaryNavDesktop(page)).toBeVisible();
    await expect(page.getByTestId("primary-nav-mobile")).toBeHidden();
    await expect(page.getByRole("heading", { name: "Curling Performance" })).toBeVisible();
    await expect(page.getByText("Train, assess and understand your performance.")).toBeVisible();
    await expect(page.getByText("Today's Plan")).toBeVisible();
    await expect(page.getByText("Training Overview")).toBeVisible();
    await expect(page.getByText("Manual Timing")).toBeVisible();
    await expect(
      page.getByText("External timing systems will be supported here.")
    ).toBeVisible();

    // Coming next's items sit side by side at desktop width — they all
    // remain visible together, and use the available width rather than
    // stacking into an unnecessarily long, mobile-style single column.
    const scheduleTile = page.getByRole("heading", { name: "Schedule", exact: true });
    const teamTile = page.getByRole("heading", { name: "Team", exact: true });
    await expect(scheduleTile).toBeVisible();
    await expect(teamTile).toBeVisible();

    const scheduleBox = await scheduleTile.boundingBox();
    const teamBox = await teamTile.boundingBox();
    expect(scheduleBox).not.toBeNull();
    expect(teamBox).not.toBeNull();
    if (scheduleBox && teamBox) {
      // Same row (roughly equal y) and Team sits to the right of Schedule —
      // proof of the 3-column grid, not a single stacked list.
      expect(Math.abs(scheduleBox.y - teamBox.y)).toBeLessThan(8);
      expect(teamBox.x).toBeGreaterThan(scheduleBox.x);
    }

    await primaryNavDesktop(page).getByRole("button", { name: "Train" }).click();
    await expect(page.getByText("Set Up Training Block")).toBeVisible();

    await primaryNavDesktop(page).getByRole("button", { name: "Analyze" }).click();
    await expect(page.getByRole("heading", { name: "Analyze" })).toBeVisible();
  });
});

test.describe("Settings", () => {
  test("Data Management and Data & Privacy are both visible, with export/clear still working", async ({
    page,
  }) => {
    await freshLoad(page);
    await goToSettings(page);

    await expect(page.getByText("Data Management")).toBeVisible();
    await expect(page.getByText("Data & Privacy")).toBeVisible();
    await expect(page.getByText("About", { exact: true })).toHaveCount(0);
    await expect(
      page.getByText(
        "Completed training sessions and Assessment results are saved on this device and synced to your private cloud account when online. In-progress training and Assessment drafts stay on this device."
      )
    ).toBeVisible();

    // No history yet — Export/Clear stay disabled rather than doing nothing silently.
    await expect(page.getByRole("button", { name: "Export History CSV" })).toBeDisabled();
    await expect(page.getByRole("button", { name: "Clear History" })).toBeDisabled();

    await setupFixedBlock(page);
    const shotEntry = page.locator("div", {
      has: page.getByRole("heading", { name: "Add Shot" }),
    });
    await shotEntry.locator('input[inputmode="decimal"]').first().fill("3.80");
    await shotEntry.getByRole("button", { name: "Add Shot", exact: true }).click();
    await expect(page.getByText("1 shot total")).toBeVisible();

    // Ending the session moves it into history, which is what enables Export/Clear.
    await page.getByRole("button", { name: "Start New Session" }).click();
    await page.getByRole("button", { name: "Start", exact: true }).click();

    await goToSettings(page);
    await expect(page.getByRole("button", { name: "Export History CSV" })).toBeEnabled();

    await page.getByRole("button", { name: "Clear History" }).click();
    await expect(page.getByRole("heading", { name: "Clear Session History" })).toBeVisible();
    await page.getByRole("button", { name: "Cancel" }).click();
    await expect(page.getByRole("button", { name: "Export History CSV" })).toBeEnabled();
  });
});

test.describe("Accessibility Smoke Test", () => {
  test("keyboard navigation shows a visible, distinct focus state that never blocks navigation", async ({
    page,
  }) => {
    await freshLoad(page);

    const homeButton = primaryNav(page).getByRole("button", { name: "Home" });
    await homeButton.focus();
    await expect(homeButton).toHaveAttribute("aria-current", "page");
    await expect(homeButton).toBeFocused();

    // Active state (aria-current/background) and focus state are independent —
    // tabbing to a non-active item must not make it look active, and vice versa.
    const trainButton = primaryNav(page).getByRole("button", { name: "Train" });
    await trainButton.focus();
    await expect(trainButton).toBeFocused();
    await expect(trainButton).not.toHaveAttribute("aria-current", "page");

    await page.keyboard.press("Enter");
    await expect(trainButton).toHaveAttribute("aria-current", "page");
    await expect(page.getByText("Set Up Training Block")).toBeVisible();
  });

  test("Coming next tiles never receive keyboard focus", async ({ page }) => {
    await freshLoad(page);

    const scheduleTile = page.getByText("Schedule", { exact: true });
    await expect(scheduleTile).not.toHaveAttribute("tabindex");

    // Tabbing through the page never lands focus inside a Coming-next tile —
    // they're plain, non-interactive content, not disabled buttons/links.
    const scheduleRole = await scheduleTile
      .locator("..")
      .evaluate((el) => el.closest('[role="button"], button, a'));
    expect(scheduleRole).toBeNull();
  });
});

test.describe("Regression", () => {
  test("Start Training, View Analyze, Navigation, Settings, and an active session all still work, with no console errors", async ({
    page,
  }) => {
    const consoleErrors: string[] = [];
    page.on("console", (msg) => {
      if (msg.type() === "error") consoleErrors.push(msg.text());
    });
    page.on("pageerror", (err) => consoleErrors.push(err.message));

    await freshLoad(page);

    // Start Training
    await page.getByRole("button", { name: "Start Training" }).click();
    await expect(page.getByText("Set Up Training Block")).toBeVisible();
    await setupFixedBlock(page);
    const shotEntry = page.locator("div", {
      has: page.getByRole("heading", { name: "Add Shot" }),
    });
    await shotEntry.locator('input[inputmode="decimal"]').first().fill("3.80");
    await shotEntry.getByRole("button", { name: "Add Shot", exact: true }).click();
    await expect(page.getByText("1 shot total")).toBeVisible();

    // Navigation — active session survives a round trip through every screen
    await goToHome(page);
    await expect(page.getByText("Today's Plan")).toBeVisible();

    // View Analyze (from Home's Training Overview)
    await page.getByRole("button", { name: "View Analyze" }).click();
    await expect(page.getByRole("heading", { name: "Analyze" })).toBeVisible();

    await goToSettings(page);
    await expect(page.getByText("Data Management")).toBeVisible();

    await goToTrain(page);
    await expect(page.getByText("Active Training Block", { exact: true })).toBeVisible();
    await expect(page.getByText("1 shot total")).toBeVisible();

    expect(consoleErrors).toEqual([]);
  });
});
