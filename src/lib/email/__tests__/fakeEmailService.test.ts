import { describe, expect, expectTypeOf, it } from "vitest";
import { FakeEmailService } from "../fakeEmailService";
import type { EmailService } from "../emailService";
import { SmtpEmailService } from "../smtpEmailService";

describe("FakeEmailService implements the exact same EmailService contract as production (requirement 144)", () => {
  it("type-level: FakeEmailService and SmtpEmailService are both assignable to EmailService", () => {
    expectTypeOf<FakeEmailService>().toMatchTypeOf<EmailService>();
    expectTypeOf<SmtpEmailService>().toMatchTypeOf<EmailService>();
  });

  it("captures every send with its full input", async () => {
    const fake = new FakeEmailService();
    await fake.sendTeamInvitation({
      toEmail: "a@example.com",
      teamName: "Team",
      inviterDisplayName: "Tim",
      participationAsPlayer: true,
      proposedFunctions: [],
      acceptUrl: "https://app.example/x",
      expiresAt: "2026-06-15T00:00:00.000Z",
    });
    await fake.sendAdminRequest({
      toEmail: "b@example.com",
      teamName: "Team",
      requestedByDisplayName: "Tim",
      acceptUrl: "https://app.example/y",
      expiresAt: "2026-06-15T00:00:00.000Z",
    });
    await fake.sendMemberRemovalNotice({ toEmail: "c@example.com", teamName: "Team" });
    expect(fake.sent).toHaveLength(3);
    expect(fake.sent.map((s) => s.kind)).toEqual(["team_invitation", "admin_request", "member_removal"]);
  });

  it("can be scripted to fail exactly once per address, proving honest failure/retry semantics (requirements 66, 83, 147)", async () => {
    const fake = new FakeEmailService();
    fake.failNextSendTo("fails@example.com");
    const first = await fake.sendMemberRemovalNotice({ toEmail: "fails@example.com", teamName: "Team" });
    expect(first).toEqual({ ok: false, error: { message: "Simulated delivery failure." } });
    const retry = await fake.sendMemberRemovalNotice({ toEmail: "fails@example.com", teamName: "Team" });
    expect(retry).toEqual({ ok: true });
  });

  it("failure scripting is per-address and case-insensitive", async () => {
    const fake = new FakeEmailService();
    fake.failNextSendTo("Fails@Example.com");
    const result = await fake.sendMemberRemovalNotice({ toEmail: "fails@example.com", teamName: "Team" });
    expect(result.ok).toBe(false);
  });

  it("never throws even under scripted failure", async () => {
    const fake = new FakeEmailService();
    fake.failNextSendTo("x@example.com");
    await expect(
      fake.sendTeamInvitation({
        toEmail: "x@example.com",
        teamName: "Team",
        inviterDisplayName: null,
        participationAsPlayer: false,
        proposedFunctions: [],
        acceptUrl: "https://app.example/z",
        expiresAt: "2026-06-15T00:00:00.000Z",
      })
    ).resolves.toEqual({ ok: false, error: { message: "Simulated delivery failure." } });
  });
});
