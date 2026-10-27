import { execFileSync } from "node:child_process";
import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";
import { readLatestOtp } from "./global-setup";
import { primaryNav } from "./utils";

// All accounts, grants and mail are confined to the resettable CLI test stack.
// This exercises the mounted UI, PostgREST, Route Handler and real SMTP together.
async function signIn(page: Page, email: string, name: string, path = "/") {
  await page.goto(path);
  await page.getByLabel("Email address").fill(email);
  const requestedAt = Date.now();
  await page.getByRole("button", { name: "Send sign-in code" }).click();
  const code = await readLatestOtp(email, requestedAt);
  await page.getByLabel("6-digit code").fill(code);
  await page.getByRole("button", { name: "Verify code" }).click();
  await page.getByLabel("Display Name").fill(name);
  await page.getByRole("checkbox", { name: /I accept/i }).check();
  await page.getByRole("checkbox", { name: /I acknowledge/i }).check();
  await page.getByRole("button", { name: "Create athlete profile" }).click();
  await expect(page.getByTestId("house-home")).toBeVisible();
}

async function openTeams(page: Page) {
  await primaryNav(page).getByRole("button", { name: "Settings" }).click();
  await page.getByRole("button", { name: "Manage Teams", exact: true }).click();
  await expect(page.getByRole("heading", { name: "Teams", exact: true })).toBeVisible();
}

function grantLocalPilotCreation(email: string) {
  if (!/^[a-z0-9-]+@example\.invalid$/.test(email)) throw new Error("Invalid local test account.");
  execFileSync("docker", ["exec", "-i", "supabase_db_curling-release-mvp",
    "psql", "-U", "postgres", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], {
    input: `insert into public.pilot_team_creation_grants (profile_id)
      select l.profile_id from public.account_profile_links l
      join auth.users u on u.id = l.account_id where u.email = '${email}'
      on conflict do nothing;`,
    stdio: ["pipe", "pipe", "pipe"],
  });
}

async function invitationPath(email: string): Promise<string> {
  let path: string | null = null;
  await expect.poll(async () => {
    const response = await fetch("http://127.0.0.1:54324/api/v1/messages");
    const data = await response.json();
    for (const message of data.messages ?? []) {
      if (!message.To?.some((recipient: { Address: string }) => recipient.Address === email)
        || !message.Subject?.startsWith("Invitation to join ")) continue;
      const detail = await fetch(`http://127.0.0.1:54324/api/v1/message/${encodeURIComponent(message.ID)}`);
      const mail = await detail.json();
      const match = typeof mail.Text === "string" ? mail.Text.match(/http:\/\/localhost:3100\/\?inviteToken=[^\s<>"']+/) : null;
      if (match) {
        const url = new URL(match[0]);
        path = `${url.pathname}${url.search}`;
      }
    }
    // Do not expose the invitation secret in assertion output.
    return path !== null;
  }, { timeout: 15_000, message: "A local Team invitation should arrive in Mailpit." }).toBe(true);
  if (path === null) throw new Error("Local invitation unavailable.");
  return path;
}

test("real Team creation, SMTP invitation, onboarding, roster privacy and reload", async ({ browser }) => {
  test.setTimeout(90_000);
  const suffix = crypto.randomUUID();
  const adminEmail = `team-admin-${suffix}@example.invalid`;
  const memberEmail = `team-member-${suffix}@example.invalid`;
  const teamName = `Local beta ${suffix}`;
  const admin = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  const member = await browser.newContext({ storageState: { cookies: [], origins: [] } });
  admin.setDefaultTimeout(15_000);
  member.setDefaultTimeout(15_000);
  try {
    const adminPage = await admin.newPage();
    await signIn(adminPage, adminEmail, "Local Beta Admin");
    await openTeams(adminPage);
    await expect(adminPage.getByRole("button", { name: "Create Team", exact: true })).toHaveCount(0);
    grantLocalPilotCreation(adminEmail);
    await adminPage.reload();
    await openTeams(adminPage);
    await adminPage.getByPlaceholder("Team name").fill(teamName);
    await adminPage.getByRole("button", { name: "Create Team", exact: true }).click();
    await expect(adminPage.getByRole("heading", { name: teamName, exact: true })).toBeVisible();
    await adminPage.getByPlaceholder("Email address", { exact: true }).fill(memberEmail);
    await adminPage.getByRole("button", { name: "Send Invitation", exact: true }).click();
    await expect(adminPage.getByText("Invitation sent.", { exact: true })).toBeVisible();
    const path = await invitationPath(memberEmail);

    const memberPage = await member.newPage();
    await signIn(memberPage, memberEmail, "Local Beta Member", path);
    await expect(memberPage.getByRole("heading", { name: "Team Invitation" })).toBeVisible();
    await memberPage.getByRole("button", { name: "Accept", exact: true }).click();
    await expect(memberPage.getByText("You've joined the team.")).toBeVisible();
    await memberPage.getByRole("button", { name: "Continue", exact: true }).click();
    await openTeams(memberPage);
    await memberPage.getByRole("button", { name: new RegExp(teamName) }).click();
    await expect(memberPage.getByText("Local Beta Admin", { exact: true })).toBeVisible();
    await expect(memberPage.getByText(adminEmail, { exact: true })).toHaveCount(0);
    await expect(memberPage.getByRole("button", { name: "Send Invitation", exact: true })).toHaveCount(0);
    await memberPage.getByRole("button", { name: "Grant Permission", exact: true }).click();
    await expect(memberPage.getByText("Exercise recording permission granted.", { exact: true })).toBeVisible();
    await memberPage.reload();
    await openTeams(memberPage);
    await expect(memberPage.getByRole("button", { name: new RegExp(teamName) })).toBeVisible();

    await adminPage.reload();
    await openTeams(adminPage);
    await adminPage.getByRole("button", { name: new RegExp(teamName) }).click();
    await adminPage.getByRole("button", { name: "Grant Permission", exact: true }).click();
    await expect(adminPage.getByText("Exercise recording permission granted.", { exact: true })).toBeVisible();
    await adminPage.getByRole("button", { name: "Close Teams" }).click();
    await primaryNav(adminPage).getByRole("button", { name: "Train", exact: true }).click();
    await adminPage.getByRole("tab", { name: "Exercises", exact: true }).click();
    await adminPage.getByRole("button", { name: /^Shotmaking/ }).click();
    const showAll = adminPage.getByRole("button", { name: "Show all exercises" });
    if (await showAll.isVisible()) await showAll.click();
    await adminPage.getByRole("button", { name: "View Details: Eight Guards, Progressively Longer" }).click();
    await adminPage.getByRole("button", { name: "Set Up Team Exercise" }).click();
    const present = adminPage.getByRole("heading", { name: "Who is present?" }).locator("..");
    await present.getByLabel("Local Beta Admin").check();
    await present.getByLabel("Local Beta Member").check();
    const athletes = adminPage.getByRole("heading", { name: "Training athletes" }).locator("..");
    await athletes.getByLabel("Local Beta Admin").check();
    await athletes.getByLabel("Local Beta Member").check();
    await adminPage.getByLabel("Athlete rotation plan").selectOption("after-every-stone");
    await adminPage.getByRole("button", { name: "Start Team Exercise" }).click();
    await adminPage.getByRole("button", { name: "Inhandle", exact: true }).click();
    await adminPage.getByRole("button", { name: "4 points, 100 percent" }).click();
    await adminPage.getByRole("button", { name: "Record Stone", exact: true }).click();
    await adminPage.getByRole("button", { name: "Apply Planned Rotation" }).click();
    await adminPage.getByRole("button", { name: "Inhandle", exact: true }).click();
    await adminPage.getByRole("button", { name: "3 points, 75 percent" }).click();
    await adminPage.getByRole("button", { name: "Record Stone", exact: true }).click();
    await adminPage.getByRole("button", { name: "Complete Team Exercise" }).click();
    await expect(adminPage.getByRole("heading", { name: "Saved to the cloud", exact: true })).toBeVisible();

    await memberPage.reload();
    await primaryNav(memberPage).getByRole("button", { name: "Analyze", exact: true }).click();
    await memberPage.getByRole("tab", { name: "Exercises", exact: true }).click();
    await expect(memberPage.getByText("Exercise Results could not be verified. Cached data was not replaced.", { exact: true })).toHaveCount(0);
    const result = memberPage.getByRole("button", { name: /Eight Guards, Progressively Longer/ });
    await expect(result).toHaveCount(1);
    await result.click();
    await memberPage.getByLabel("Your private note").fill("Synthetic private member observation.");
    await memberPage.getByRole("button", { name: "Save Private Note", exact: true }).click();
    await expect(memberPage.getByText("Private note saved.", { exact: true })).toBeVisible();
    await memberPage.reload();
    await primaryNav(memberPage).getByRole("button", { name: "Analyze", exact: true }).click();
    await memberPage.getByRole("tab", { name: "Exercises", exact: true }).click();
    await memberPage.getByRole("button", { name: /Eight Guards, Progressively Longer/ }).click();
    await expect(memberPage.getByLabel("Your private note")).toHaveValue("Synthetic private member observation.");

    await adminPage.reload();
    await primaryNav(adminPage).getByRole("button", { name: "Analyze", exact: true }).click();
    await adminPage.getByRole("tab", { name: "Exercises", exact: true }).click();
    await adminPage.getByRole("button", { name: /Eight Guards, Progressively Longer/ }).click();
    await expect(adminPage.getByLabel("Your private note")).toHaveValue("");
    await primaryNav(adminPage).getByRole("button", { name: "Settings", exact: true }).click();
    await adminPage.getByRole("button", { name: "Delete account", exact: true }).click();
    const downloading = adminPage.waitForEvent("download");
    await adminPage.getByRole("button", { name: "Export my personal data" }).click();
    const downloadPath = await (await downloading).path();
    expect(downloadPath).not.toBeNull();
    const exported = await readFile(downloadPath!, "utf8");
    const personal = JSON.parse(exported);
    expect(personal.cloud.teamResultBundles).toHaveLength(1);
    expect(personal.cloud.teamResultBundles[0].athlete_profile_id).toBe(personal.cloud.profile.id);
    expect(exported).not.toContain("Synthetic private member observation.");
    const sync = JSON.parse(personal.local["curling-release-tracker-cloud-sporting-sync"]);
    expect(sync.ownedTeamResultOutbox.every((row: { athleteProfileId: string }) => row.athleteProfileId === personal.cloud.profile.id)).toBe(true);
    expect(sync.ownedTeamResults.every((row: { athleteProfileId: string }) => row.athleteProfileId === personal.cloud.profile.id)).toBe(true);
  } finally {
    await Promise.allSettled([admin.close(), member.close()]);
  }
});
