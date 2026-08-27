import { chromium, type FullConfig } from "@playwright/test";
import { mkdir } from "node:fs/promises";
import { dirname, join } from "node:path";

export const E2E_AUTH_STATE_PATH = join(process.cwd(), "test-results", ".auth", "athlete.json");
export const E2E_TEST_EMAIL = "playwright-athlete@example.invalid";
const MAILPIT_API = "http://127.0.0.1:54324/api/v1";

type MailpitMessage = {
  ID?: unknown;
  Created?: unknown;
  To?: unknown;
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function messageIsForAccount(message: MailpitMessage, email: string): boolean {
  if (!Array.isArray(message.To)) return false;
  return message.To.some((recipient) =>
    isRecord(recipient) && recipient.Address === email
  );
}

export async function readLatestOtp(email: string, notBefore: number): Promise<string> {
  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const listResponse = await fetch(`${MAILPIT_API}/messages`);
    if (!listResponse.ok) throw new Error("Mailpit message list is unavailable.");
    const list: unknown = await listResponse.json();
    const messages = isRecord(list) && Array.isArray(list.messages)
      ? (list.messages as MailpitMessage[])
      : [];
    const candidate = messages.find((message) => {
      const created = typeof message.Created === "string" ? Date.parse(message.Created) : Number.NaN;
      return messageIsForAccount(message, email) && Number.isFinite(created) && created >= notBefore - 1_000;
    });
    if (candidate && typeof candidate.ID === "string") {
      const detailResponse = await fetch(`${MAILPIT_API}/message/${encodeURIComponent(candidate.ID)}`);
      if (!detailResponse.ok) throw new Error("Mailpit message detail is unavailable.");
      const detail: unknown = await detailResponse.json();
      const serialized = JSON.stringify(detail);
      const contextual = serialized.match(/(?:code|token)[^0-9]{0,160}([0-9]{6})/i);
      const fallback = serialized.match(/\b([0-9]{6})\b/);
      const token = contextual?.[1] ?? fallback?.[1];
      if (token) return token;
    }
    await new Promise((resolve) => setTimeout(resolve, 250));
  }
  throw new Error("No six-digit OTP arrived in local Mailpit within 15 seconds.");
}

export default async function globalSetup(config: FullConfig) {
  const baseURL = config.projects[0]?.use.baseURL;
  if (typeof baseURL !== "string") throw new Error("Playwright baseURL is required for identity setup.");

  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    await page.goto(baseURL);
    const email = page.getByLabel("Email address");
    await email.waitFor();
    const requestedAt = Date.now();
    await email.fill(E2E_TEST_EMAIL);
    await page.getByRole("button", { name: "Send sign-in code" }).click();

    const otp = await readLatestOtp(E2E_TEST_EMAIL, requestedAt);
    await page.getByLabel("6-digit code").fill(otp);
    await page.getByRole("button", { name: "Verify code" }).click();

    // A fresh local reset reaches onboarding; a focused rerun against the same
    // local database may find the already-completed fixture Profile. Both paths
    // use the real gate and produce the same authenticated storage state.
    const destination = await Promise.race([
      page.getByLabel("Display Name").waitFor().then(() => "onboarding" as const),
      page.getByText("Today's Plan").waitFor().then(() => "ready" as const),
    ]);
    if (destination === "onboarding") {
      await page.getByLabel("Display Name").fill("Playwright Athlete");
      await page.getByRole("checkbox", { name: /I accept/i }).check();
      await page.getByRole("checkbox", { name: /I acknowledge/i }).check();
      await page.getByRole("button", { name: "Create athlete profile" }).click();
    }
    await page.getByText("Today's Plan").waitFor();

    await mkdir(dirname(E2E_AUTH_STATE_PATH), { recursive: true });
    await page.context().storageState({ path: E2E_AUTH_STATE_PATH });
  } finally {
    await browser.close();
  }
}
