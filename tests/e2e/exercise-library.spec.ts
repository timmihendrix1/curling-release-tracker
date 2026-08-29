import { expect, test } from "@playwright/test";
import { freshLoad, goToTrain, primaryNavDesktop } from "./utils";

const CURATED_TITLES = [
  "Release Point",
  "Eight Guards, Progressively Longer",
  "Release Time",
  "Release Gates",
  "Rotation Count",
  "Come-around from Outside to Inside, Before the T-Line",
  "Soft Take-out on the Centre Line at the T-Line",
] as const;

// Stage A discovery/detail plus Stage B3 Solo execution, at the suite's default
// mobile viewport (390 x 844 — see playwright.config.ts).

async function openTrainTab(page: import("@playwright/test").Page, name: string) {
  await page.getByRole("tab", { name, exact: true }).click();
}

function exerciseCategory(title: typeof CURATED_TITLES[number]): string {
  if (title === "Release Point" || title === "Release Gates") return "Technique";
  if (title === "Release Time" || title === "Rotation Count") return "Measured Exercises";
  return "Shotmaking";
}

async function expandExerciseCategory(
  page: import("@playwright/test").Page,
  title: typeof CURATED_TITLES[number]
) {
  const category = page.getByRole("button", {
    name: new RegExp(`^${exerciseCategory(title)}`),
  });
  if ((await category.getAttribute("aria-expanded")) === "false") await category.click();
}

async function openExerciseDetail(
  page: import("@playwright/test").Page,
  title: typeof CURATED_TITLES[number]
) {
  await expandExerciseCategory(page, title);
  await page.getByRole("button", { name: `View Details: ${title}` }).click();
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

async function seedTeamExerciseEligibility(page: import("@playwright/test").Page) {
  await page.evaluate(() => {
    const trustedRaw = localStorage.getItem("curling.identity.trustedDevice.v1");
    if (trustedRaw === null) throw new Error("The trusted E2E Profile is missing.");
    const trusted: unknown = JSON.parse(trustedRaw);
    if (typeof trusted !== "object" || trusted === null || !("profileId" in trusted) || typeof trusted.profileId !== "string") {
      throw new Error("The trusted E2E Profile is malformed.");
    }
    const state = {
      schemaVersion: 4,
      entries: [],
      teamEntries: [],
      teamEligibilitySnapshots: [{
        teamId: "41000000-0000-4000-8000-000000000004",
        teamName: "Elite E2E Team",
        cachedAt: "2026-08-28T08:00:00.000Z",
        participants: [
          { profileId: trusted.profileId, displayName: "E2E Recorder", participationAsPlayer: false, functions: ["coach"], recordingPermissionGranted: false },
          { profileId: "42000000-0000-4000-8000-000000000004", displayName: "Athlete A", participationAsPlayer: true, functions: [], recordingPermissionGranted: true },
          { profileId: "43000000-0000-4000-8000-000000000004", displayName: "Athlete B", participationAsPlayer: true, functions: [], recordingPermissionGranted: true },
        ],
      }],
      activeTeamExerciseDraft: null,
    };
    const key = `curling.sporting.profile.v1.${trusted.profileId}.curling-release-tracker-cloud-sporting-sync`;
    localStorage.setItem(key, JSON.stringify(state));
  });
  await page.reload();
  await page.waitForSelector("text=Today's Plan");
}

test.describe("Exercise Library and Solo execution", () => {
  test("Train exposes Exercises and Training Plans, with the Library selected and unclipped at 390 px", async ({
    page,
  }) => {
    await freshLoad(page);
    await goToTrain(page);

    const tabs = page.getByRole("tab");
    await expect(tabs).toHaveCount(2);
    await expect(tabs.nth(0)).toHaveText("Exercises");
    await expect(tabs.nth(1)).toHaveText("Training Plans");

    // The grouped Exercise Library is the default; timing setup is not a
    // separate top-level shortcut.
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { level: 2, name: "Exercises" })).toBeVisible();
    await expect(page.getByText("Set Up Training Block")).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Technique/ })).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: /^Shotmaking/ })).toHaveAttribute("aria-expanded", "false");
    await expect(page.getByRole("button", { name: /^Measured Exercises/ })).toHaveAttribute("aria-expanded", "false");

    // No tab label is truncated inside its own button, and the page does not
    // scroll sideways.
    for (let index = 0; index < 2; index++) {
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

    await expect(page.getByText("41 exercises")).toBeVisible();
    for (const title of CURATED_TITLES) {
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeHidden();
    }
    await expectNoHorizontalOverflow(page);

    // Text search narrows the list.
    await page.getByLabel("Search exercises").fill("guard");
    await expect(page.getByText("16 exercises")).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Release Point", exact: true })
    ).toHaveCount(0);

    // Reset brings everything back.
    await page.getByRole("button", { name: "Reset filters" }).first().click();
    await expect(page.getByText("41 exercises")).toBeVisible();

    // Filters are progressively disclosed, then applied.
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    await page.getByLabel("Focus").selectOption("technique");
    await expect(page.getByText("2 exercises")).toBeVisible();
    await expect(page.getByRole("heading", { name: "Release Point", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Release Gates", exact: true })).toBeVisible();

    // An honest shared empty state when nothing matches.
    await page.getByLabel("Difficulty").selectOption("level:6");
    await expect(page.getByText("No exercises match these filters")).toBeVisible();
    await page.getByRole("button", { name: "Reset filters" }).first().click();
    await expect(page.getByText("41 exercises")).toBeVisible();

    // Every representative detail opens and returns with one focus-semantic start action.
    for (const title of CURATED_TITLES) {
      await openExerciseDetail(page, title);
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(page.getByText("Instructions", { exact: true })).toBeVisible();
      await expect(
        page.getByRole("button", { name: /Start Exercise|Continue to Timing Setup/i })
      ).toHaveCount(1);
      await expectNoHorizontalOverflow(page);

      await page.getByRole("button", { name: "← Back to Exercises" }).click();
    await expect(page.getByText("41 exercises")).toBeVisible();
    }
  });

  test("keeps the public Guard diagram available from its local cache while offline", async ({
    page,
  }) => {
    await freshLoad(page);
    await goToTrain(page);
    await openTrainTab(page, "Exercises");
    await openExerciseDetail(page, "Eight Guards, Progressively Longer");

    const diagram = page.getByRole("img", {
      name: /eight numbered guard positions/i,
    });
    await expect(diagram).toBeVisible();
    await expect(diagram).toHaveAttribute("src", /^data:image\/png;base64,/);
    await expect(page.getByText("Guard Exercise 10 — original Swiss Curling diagram.")).toBeVisible();
    await expect(page.getByText(/Source: .*Swiss Curling.*Guard Exercise 10/)).toBeVisible();
    await expectNoHorizontalOverflow(page);

    // The already loaded application must keep using the locally persisted
    // data URL when connectivity disappears; no network request is needed.
    await page.getByRole("button", { name: "← Back to Exercises" }).click();
    await page.context().setOffline(true);
    await openExerciseDetail(page, "Eight Guards, Progressively Longer");
    await expect(diagram).toBeVisible();
    await expect(diagram).toHaveAttribute("src", /^data:image\/png;base64,/);
    await expect(page.getByTestId("exercise-restricted-diagram-unavailable")).toHaveCount(0);

    // Embedded German labels stay covered by the data-driven English overlay.
    const body = await page.locator("body").textContent();
    expect(body).not.toMatch(/Übung|Steine|immer länger/);
    await page.context().setOffline(false);
  });

  test("Train tabs are keyboard operable and carry complete tab semantics", async ({ page }) => {
    await freshLoad(page);
    await goToTrain(page);

    const tabs = page.getByRole("tab");
    const panel = page.getByRole("tabpanel");
    const panelId = await panel.getAttribute("id");
    expect(panelId).toBeTruthy();

    for (let index = 0; index < 2; index++) {
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
    await expect(page.getByText("No training plans yet")).toBeVisible();

    await page.keyboard.press("End");
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("No training plans yet")).toBeVisible();

    await page.keyboard.press("Home");
    await expect(tabs.nth(0)).toHaveAttribute("aria-selected", "true");
    await expect(page.getByText("41 exercises")).toBeVisible();

    // Wraps backward from the first tab to the last.
    await page.keyboard.press("ArrowLeft");
    await expect(tabs.nth(1)).toHaveAttribute("aria-selected", "true");
    await expect(panel).toHaveAttribute(
      "aria-labelledby",
      (await tabs.nth(1).getAttribute("id"))!
    );
  });

  test("mobile touch targets on the new Exercise surfaces are at least 44 px tall", async ({
    page,
  }) => {
    await freshLoad(page);
    await goToTrain(page);
    await openTrainTab(page, "Exercises");
    await expandExerciseCategory(page, "Release Point");

    // Every tab, and the Library's own controls.
    for (const locator of [
      page.getByRole("tab").nth(0),
      page.getByRole("tab").nth(1),
      page.getByRole("button", { name: "Filters", exact: true }),
      page.getByRole("button", { name: "View Details: Release Point" }),
    ]) {
      const box = await locator.boundingBox();
      expect(box).not.toBeNull();
      expect(box!.height).toBeGreaterThanOrEqual(44);
    }

    await openExerciseDetail(page, "Eight Guards, Progressively Longer");

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
    await expect(page.getByText("2 exercises")).toBeVisible();

    // Collapse the panel: the narrowing it applied must still be stated.
    await page.getByRole("button", { name: "Filters", exact: true }).click();
    const summary = page.getByTestId("exercise-library-active-filter-summary");
    await expect(summary).toBeVisible();
    await expect(summary).toContainText("1 active filter");
    await expect(summary).toContainText("Focus: Technique");

    await page.getByRole("button", { name: "Reset filters" }).first().click();
    await expect(summary).toHaveCount(0);
    await expect(page.getByText("41 exercises")).toBeVisible();
  });

  test("shows each Exercise's own version, and no internal id or source metadata", async ({
    page,
  }) => {
    await freshLoad(page);
    await goToTrain(page);
    await openTrainTab(page, "Exercises");

    for (const [title, version] of [
      ["Release Point", 1],
      ["Eight Guards, Progressively Longer", 5],
      ["Release Time", 1],
    ] as const) {
      await openExerciseDetail(page, title);
      await expect(page.getByText(`Exercise version ${version}`)).toBeVisible();

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

    await expect(page.getByText("41 exercises")).toBeVisible();
    await expectNoHorizontalOverflow(page);

    for (const title of CURATED_TITLES) {
      await openExerciseDetail(page, title);
      await expect(page.getByRole("heading", { name: title, exact: true })).toBeVisible();
      await expect(page.getByText("Instructions", { exact: true })).toBeVisible();
      await expectNoHorizontalOverflow(page);
      await page.getByRole("button", { name: "← Back to Exercises" }).click();
    }

    await openExerciseDetail(page, "Eight Guards, Progressively Longer");
    await expect(page.getByRole("img", {
      name: /eight numbered guard positions/i,
    })).toBeVisible();
  });

  test("keeps Training Plans reachable and starts Release Timing through its Measured Exercise", async ({ page }) => {
    await freshLoad(page);
    await goToTrain(page);

    // Existing Training Plans flow still reachable from its own tab.
    await openTrainTab(page, "Training Plans");
    await expect(page.getByText("No training plans yet")).toBeVisible();
    await expect(page.getByRole("button", { name: "Create Training Plan" })).toBeVisible();

    // Release Timing is reached from the Library, while its established
    // Fixed/Variable/Blind setup and runner remain unchanged.
    await openTrainTab(page, "Exercises");
    await expect(page.getByText("41 exercises")).toBeVisible();
    await openExerciseDetail(page, "Release Time");
    await page.getByRole("button", { name: "Continue to Timing Setup" }).click();
    await expect(page.getByText("Set Up Training Block")).toBeVisible();
    await page.getByRole("button", { name: "Start Training" }).click();
    await expect(page.getByText("Active Training Block", { exact: true })).toBeVisible();
  });

  test("runs Technique as an unscored observation with a private note", async ({ page }) => {
    await freshLoad(page);
    await goToTrain(page);
    await openTrainTab(page, "Exercises");
    await openExerciseDetail(page, "Release Point");
    await page.getByRole("button", { name: "Start Exercise" }).click();
    await expect(page.getByText("Prepare the exercise, then confirm when you are ready to record.")).toBeVisible();
    await page.getByRole("button", { name: "Setup Complete — Start Exercise" }).click();

    await expect(page.getByRole("heading", { name: "Release Point", exact: true })).toBeVisible();
    await expect(page.getByText("Observe and discuss")).toBeVisible();
    await expect(page.getByRole("button", { name: /points/ })).toHaveCount(0);
    await page.getByLabel("Private athlete note").fill("Observed by a teammate.");
    await page.getByRole("button", { name: "Complete Exercise" }).click();

    await expect(page.getByText(/Completed without a score/)).toBeVisible();
    await expect(page.getByLabel("Private athlete note")).toHaveValue("Observed by a teammate.");
    await page.getByRole("button", { name: "Back to Exercise Library" }).click();
    await expect(page.getByText("41 exercises")).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("records zero and an exclusion as distinct Shotmaking outcomes", async ({ page }) => {
    await freshLoad(page);
    await goToTrain(page);
    await openTrainTab(page, "Exercises");
    await openExerciseDetail(page, "Eight Guards, Progressively Longer");
    await page.getByRole("button", { name: "Start Exercise" }).click();
    await expect(page.getByText("Prepare the exercise, then confirm when you are ready to record.")).toBeVisible();
    await page.getByRole("button", { name: "Setup Complete — Start Exercise" }).click();
    await expect(page.getByRole("heading", { name: "Record outcome" })).toBeVisible();
    await expect(page.getByText("Exercise setup and reference")).toBeVisible();
    await page.getByRole("button", { name: "Inhandle" }).click();
    await page.getByRole("button", { name: "0 points, 0 percent" }).click();
    await page.getByRole("button", { name: "Record Stone" }).click();
    await expect(page.getByText("0/4", { exact: true })).toBeVisible();
    await expect(page.getByText("1 scored · 0 excluded")).toBeVisible();

    await page.getByRole("button", { name: "Outhandle" }).click();
    await page.getByRole("button", { name: "Do not score this stone" }).click();
    await page.getByLabel("Reason").selectOption("outcome-not-observable");
    await page.getByRole("button", { name: "Record Excluded Stone" }).click();
    await expect(page.getByText("1 scored · 1 excluded")).toBeVisible();
    await expect(page.getByText("Outcome not observable: 1")).toBeVisible();

    await page.getByRole("button", { name: "Complete Exercise" }).click();
    await expect(page.getByRole("heading", { name: "Exercise result" })).toBeVisible();
    await expect(page.getByText("0/4", { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("routes measured Release Time into the existing Fixed Variable Blind setup", async ({ page }) => {
    await freshLoad(page);
    await goToTrain(page);
    await openTrainTab(page, "Exercises");
    await openExerciseDetail(page, "Release Time");
    await page.getByRole("button", { name: "Continue to Timing Setup" }).click();

    await expect(page.getByRole("status").filter({ hasText: "From Exercise Library" }))
      .toContainText("From Exercise Library");
    await expect(page.getByRole("button", { name: "Fixed Weight", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Variable Weight", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: "Blind Weight", exact: true })).toBeVisible();
    await page.getByRole("button", { name: "Blind Weight", exact: true }).click();
    await page.getByRole("button", { name: "Start Training" }).click();
    await expect(page.getByText("Active Training Block", { exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Blind Weight Block" })).toBeVisible();
  });

  test("runs Rotation Count as a standalone manual measured Exercise", async ({ page }) => {
    await freshLoad(page);
    await goToTrain(page);
    await openTrainTab(page, "Exercises");
    await openExerciseDetail(page, "Rotation Count");
    await page.getByRole("button", { name: "Start Exercise" }).click();
    await page.getByRole("button", { name: "Setup Complete — Start Exercise" }).click();

    await expect(page.getByRole("heading", { name: "Rotation Count", exact: true })).toBeVisible();
    await page.getByLabel(/Rotation Count/).fill("2.5");
    await page.getByRole("button", { name: "Inhandle" }).click();
    await page.getByRole("button", { name: "Record Measurement" }).click();

    await expect(page.getByText("2.5 rotations")).toHaveCount(2);
    await expect(page.getByText("· Inhandle", { exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /points/ })).toHaveCount(0);

    await page.reload();
    await goToTrain(page);
    await expect(page.getByRole("heading", { name: "Rotation Count", exact: true })).toBeVisible();
    await expect(page.getByText("2.5 rotations")).toHaveCount(2);
    await page.getByRole("button", { name: "Complete Exercise" }).click();
    await expect(page.getByRole("heading", { name: "Exercise result" })).toBeVisible();
    await expect(page.getByText(/No target, score or pass\/fail result is applied/)).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });

  test("routes Team setup through the Profile-scoped boundary and fails closed without a cached roster", async ({ page }) => {
    await freshLoad(page);
    await goToTrain(page);
    await openTrainTab(page, "Exercises");
    await openExerciseDetail(page, "Eight Guards, Progressively Longer");

    const teamAction = page.getByRole("button", { name: "Set Up Team Exercise" });
    await expect(teamAction).toBeEnabled();
    await teamAction.click();

    await expect(page.getByRole("heading", { name: "Team setup unavailable" })).toBeVisible();
    await expect(page.getByText(/previously verified active roster/)).toBeVisible();
    await expect(page.getByRole("button", { name: "Start Team Exercise" })).toHaveCount(0);
    await page.getByRole("button", { name: "Back to Exercise Library" }).click();
    await expect(page.getByText("41 exercises")).toBeVisible();
  });

  test("persists one-device Team Shotmaking, corrections, rotations and role changes across reload", async ({ page, context }) => {
    await freshLoad(page);
    await seedTeamExerciseEligibility(page);
    await goToTrain(page);
    await openTrainTab(page, "Exercises");
    await openExerciseDetail(page, "Eight Guards, Progressively Longer");
    await page.getByRole("button", { name: "Set Up Team Exercise" }).click();
    await expectNoHorizontalOverflow(page);

    const present = page.getByRole("heading", { name: "Who is present?" }).locator("..");
    await present.getByLabel("Athlete A").check();
    await present.getByLabel("Athlete B").check();
    const athletes = page.getByRole("heading", { name: "Training athletes" }).locator("..");
    await athletes.getByLabel("Athlete A").check();
    await athletes.getByLabel("Athlete B").check();
    await page.getByLabel("Athlete rotation plan").selectOption("after-every-stone");
    await page.getByRole("button", { name: "Start Team Exercise" }).click();

    await expect(page.getByText("Athlete A · Stone 1")).toBeVisible();
    await page.getByRole("button", { name: "Inhandle" }).click();
    await page.getByLabel(/Rotation Count/).fill("2.5");
    await page.getByRole("button", { name: "4 points, 100 percent" }).click();
    await page.getByRole("button", { name: "Record Stone" }).click();
    await expect(page.getByText(/2.5 rotations/)).toBeVisible();
    await expect(page.getByText(/Planned rotation: Athlete B delivers next/)).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.reload();
    await goToTrain(page);
    await expect(page.getByText(/2.5 rotations/)).toBeVisible();
    await expectNoHorizontalOverflow(page);

    await page.getByRole("button", { name: "Correct Stone" }).click();
    await page.getByLabel("Score").selectOption("3");
    await page.getByRole("button", { name: "Save Correction" }).click();
    await expect(page.getByText(/75% average/)).toBeVisible();
    await page.reload();
    await goToTrain(page);
    await expect(page.getByText(/75% average/)).toBeVisible();
    await expect(page.getByText(/2.5 rotations/)).toBeVisible();

    await page.getByRole("button", { name: "Apply Planned Rotation" }).click();
    await expect(page.getByText("Athlete B · Stone 1")).toBeVisible();

    await context.setOffline(true);
    await page.getByRole("button", { name: "Complete Team Exercise" }).click();
    await expect(page.getByRole("heading", { name: "Saved on this device" })).toBeVisible();
    await context.setOffline(false);
  });
});
