import { expect, test } from "@playwright/test";
import { freshLoad, goToTrain, primaryNavDesktop } from "./utils";

// Stage A of the Exercise Library: Train's three entry paths, read-only
// discovery/detail, and the structured Ice Sheet diagram at the suite's default
// mobile viewport (390 x 844 — see playwright.config.ts).

async function openTrainTab(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("tab", { name, exact: true }).click();
}

/** The page must never scroll sideways, and no visible control may be clipped. */
async function expectNoHorizontalOverflow(page: import("@playwright/test").Page) {
  const overflow = await page.evaluate(() => ({
    documentScroll: document.documentElement.scrollWidth,
    documentClient: document.documentElement.clientWidth,
    bodyScroll: document.body.scrollWidth,
    innerWidth: window.innerWidth,
  }));
  expect(overflow.documentScroll).toBeLessThanOrEqual(overflow.documentClient);
  expect(overflow.bodyScroll).toBeLessThanOrEqual(overflow.innerWidth);
}

test.describe("Exercise Library (Stage A)", () => {
  test("Train exposes Quick Start, Exercises and Training Plans, all reachable and unclipped at 390 px", async ({
    page,
  }) => {
    await freshLoad(page);
    await goToTrain(page);

    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(3);
    await expect(tabs.nth(0)).toHaveText("Quick Start");
    await expect(tabs.nth(1)).toHaveText("Exercises");
    await expect(tabs.nth(2)).toHaveText("Training Plans");

    // Quick Start stays the default, with the existing setup hero.
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Set Up Training Block")).toBeVisible();

    // No tab label is truncated inside its own button, and the page does not
    // scroll sideways.
    for (let index = 0; index < 3; index++) {
      const clipping = await tabs.nth(index).evaluate((element) => ({
        scrollWidth: element.scrollWidth,
        clientWidth: element.clientWidth,
        height: element.getBoundingClientRect().height,
      }));
      expect(clipping.scrollWidth).toBeLessThanOrEqual(clipping.clientWidth + 1);
      expect(clipping.height).toBeGreaterThanOrEqual(44);
    }
    await expectNoHorizontalOverflow(page);

    // The Train header now names finding an exercise too.
    await expect(
      page.getByText("Find an exercise, set up a session, and record release times as you throw.")
    ).toBeVisible();
  });

  test("searches, filters, resets and opens each Exercise detail, then returns", async ({ page }) => {
    await freshLoad(page);
    await goToTrain(page);
    await openTrainTab(page, "Exercises");

    await expect(page.getByText("3 exercises")).toBeVisible();
    for (const title of ["Release Point", "Eight Guards, Progressively Longer", "Release Time"]) {
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
    }
    await expectNoHorizontalOverflow(page);

    // Text search narrows the list.
    await page.getByLabel("Search exercises").fill("guard");
    await expect(page.getByText("1 exercise")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Release Point", exact: true })
    ).toHaveCount(0);

    // Reset brings everything back.
    await page.getByRole("button", { name: "Reset filters" }).first().click();
    await expect(page.getByText("3 exercises")).toBeVisible();

    // Filters are progressively disclosed, then applied.
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByLabel("Focus").selectOption("technique");
    await expect(page.getByText("1 exercise")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Release Point", exact: true })).toBeVisible();

    // An honest shared empty state when nothing matches.
    await page.getByLabel("Difficulty").selectOption("level:6");
    await expect(page.getByText("No exercises match these filters")).toBeVisible();
    await page.getByRole("button", { name: "Reset filters" }).first().click();
    await expect(page.getByText("3 exercises")).toBeVisible();

    // Every representative detail opens and returns, with no start action.
    for (const title of ["Release Point", "Eight Guards, Progressively Longer", "Release Time"]) {
      await page.getByRole("button", { name: `View Details: ${title}` }).click();
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(page.getByText("Instructions", { exact: true })).toBeVisible();
      await expect(page.getByRole("button", { name: /Start Exercise/i })).toHaveCount(0);
      await expectNoHorizontalOverflow(page);

      await page.getByRole("button", { name: "← Back to Exercises" }).click();
      await expect(page.getByText("3 exercises")).toBeVisible();
    }
  });

  test("renders the Guard structured diagram responsively, with a textual alternative", async ({
    page,
  }) => {
    await freshLoad(page);
    await goToTrain(page);
    await openTrainTab(page, "Exercises");
    await page
      .getByRole("button", { name: "View Details: Eight Guards, Progressively Longer" })
      .click();

    const diagram = page.getByTestId("exercise-structured-diagram");
    await expect(diagram).toBeVisible();
    await expect(diagram).toHaveAttribute("role", "img");
    await expect(diagram).toHaveAttribute("viewBox", /^0 0 100 /);
    // The visible caption is the <figcaption>, not the SVG <title>.
    await expect(
      page.locator("figcaption", { hasText: "Eight guards, progressively deeper" })
    ).toBeVisible();

    // Fits the 390 px viewport: never wider than its container, and the page
    // still does not scroll sideways.
    const box = await diagram.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeLessThanOrEqual(390);
    expect(box!.height).toBeGreaterThan(0);
    await expectNoHorizontalOverflow(page);

    // All eight numbered target positions plus their set-aside markers are
    // rendered from catalog data.
    await expect(diagram.locator('[data-element-kind="target-zone"]')).toHaveCount(8);
    await expect(diagram.locator('[data-element-kind="stone"]')).toHaveCount(8);

    // The textual alternative is present for screen-reader users.
    const description = await diagram.locator("desc").textContent();
    expect(description).toContain("A top-down view of the playing end of the sheet");
    expect(description).toContain("No sweeping is used.");

    // No German source text and no restricted source image anywhere.
    const body = await page.locator("body").textContent();
    expect(body).not.toMatch(/Übung|Steine|immer länger/);
    await expect(page.locator("img")).toHaveCount(0);
  });

  test("Train tabs are keyboard operable and carry complete tab semantics", async ({ page }) => {
    await freshLoad(page);
    await goToTrain(page);

    const tabs = page.getByRole("tab");
    const panel = page.getByRole("tabpanel");
    const panelId = await panel.getAttribute("id");
    expect(panelId).toBeTruthy();

    for (let index = 0; index < 3; index++) {
      await expect(tabs.nth(index)).toHaveAttribute("aria-controls", panelId!);
    }
    await expect(panel).toHaveAttribute(
      "aria-labelledby",
      (await tabs.nth(0).getAttribute("id"))!
    );

    // Roving tabindex: one keyboard stop, on the selected tab.
    await expect(tabs.nth(0)).toHaveAttribute("tabindex", "0");
    await expect(tabs.nth(1)).toHaveAttribute("tabindex", "-1");

    // Focus the tablist's single stop, then drive it from the keyboard only.
    await tabs.nth(0).focus();
    await page.keyboard.press("ArrowRight");
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(tabs.nth(1)).toBeFocused();
    await expect(page.getByText("3 exercises")).toBeVisible();

    await page.keyboard.press("End");
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("No training plans yet")).toBeVisible();

    await page.keyboard.press("Home");
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("Set Up Training Block")).toBeVisible();

    // Wraps backward from the first tab to the last.
    await page.keyboard.press("ArrowLeft");
    await expect(tabs.nth(2)).toHaveAttribute("aria-selected", "true");
    await expect(panel).toHaveAttribute(
      "aria-labelledby",
      (await tabs.nth(2).getAttribute("id"))!
    );
  });

  test("mobile touch targets on the new Exercise surfaces are at least 44 px tall", async ({
    page,
  }) => {
    await freshLoad(page);
    await goToTrain(page);
    await openTrainTab(page, "Exercises");

    // Every tab, and the Library's own controls.
    for (const locator of [
      page.getByRole("tab").nth(0),
      page.getByRole("tab").nth(1),
      page.getByRole("tab").nth(2),
      page.getByRole("button", { name: "Filters", exact: true }),
      page.getByRole("button", { name: "View Details: Release Point" }),
    ]) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }

    await page
      .getByRole("button", { name: "View Details: Eight Guards, Progressively Longer" })
      .click();

    const backBox = await page
      .getByRole("button", { name: "← Back to Exercises" })
      .boundingBox();
    expect(backBox).not.toBeNull();
    expect(backBox!.height).toBeGreaterThanOrEqual(44);

    const summaries = page.locator("summary");
    const summaryCount = await summaries.count();
    expect(summaryCount).toBeGreaterThan(0);
    for (let index = 0; index < summaryCount; index++) {
      const box = await summaries.nth(index).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }

    await expectNoHorizontalOverflow(page);
  });

  test("keeps the active advanced-filter selection visible after the panel collapses", async ({
    page,
  }) => {
    await freshLoad(page);
    await goToTrain(page);
    await openTrainTab(page, "Exercises");

    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByLabel("Focus").selectOption("technique");
    await expect(page.getByText("1 exercise")).toBeVisible();

    // Collapse the panel: the narrowing it applied must still be stated.
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    const summary = page.getByTestId("exercise-library-active-filter-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("1 active filter");
    await expect(summary).toContainText("Focus: Technique");

    await page.getByRole("button", { name: "Reset filters" }).first().click();
    await expect(summary).toHaveCount(0);
    await expect(page.getByText("3 exercises")).toBeVisible();
  });

  test("shows each Exercise's own version, and no internal id or source metadata", async ({
    page,
  }) => {
    await freshLoad(page);
    await goToTrain(page);
    await openTrainTab(page, "Exercises");

    for (const title of ["Release Point", "Eight Guards, Progressively Longer", "Release Time"]) {
      await page.getByRole("button", { name: `View Details: ${title}` }).click();
      await expect(page.getByText("Exercise version 1")).toBeVisible();

      const body = await page.locator("body").textContent();
      expect(body).not.toMatch(/Übung|Steine|immer länger/);
      expect(body).not.toContain("eight-guards-progressively-longer");
      expect(body).not.toContain("release-time-back-hog");

      await page.getByRole("button", { name: "← Back to Exercises" }).click();
    }
  });

  test("renders the Library and every Exercise detail at desktop width", async ({ page }) => {
    await freshLoad(page);
    // Above the `sm` breakpoint the mobile bottom bar is display:none, so
    // navigation goes through the desktop nav (see tests/e2e/utils.ts).
    await page.setViewportSize({ width: 1280, height: 900 });
    await primaryNavDesktop(page).getByRole("button", { name: "Train" }).click();
    await openTrainTab(page, "Exercises");

    await expect(page.getByText("3 exercises")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    for (const title of ["Release Point", "Eight Guards, Progressively Longer", "Release Time"]) {
      await page.getByRole("button", { name: `View Details: ${title}` }).click();
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(page.getByText("Instructions", { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.getByRole("button", { name: "← Back to Exercises" }).click();
    }

    const diagramTitle = "View Details: Eight Guards, Progressively Longer";
    await page.getByRole("button", { name: diagramTitle }).click();
    await expect(page.getByTestId("exercise-structured-diagram")).toBeVisible();
  });

  test("leaves Training Plans and Quick Start behaving exactly as before", async ({ page }) => {
    await freshLoad(page);
    await goToTrain(page);

    // Existing Training Plans flow still reachable from its own tab.
    await openTrainTab(page, "Training Plans");
    await expect(page.getByText("No training plans yet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Training Plan" })).toBeVisible();

    // Visiting Exercises in between changes nothing about Quick Start.
    await openTrainTab(page, "Exercises");
    await expect(page.getByText("3 exercises")).toBeVisible();

    await openTrainTab(page, "Quick Start");
    await expect(page.getByText("Set Up Training Block")).toBeVisible();
    await page.getByRole("button", { name: "Start Training" }).click();
    await expect(page.getByText("Active Training Block", { exact: true })).toBeVisible();
  });
});
