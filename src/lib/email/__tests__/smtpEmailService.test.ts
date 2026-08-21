// Tests the pure, provider-neutral pieces of the SMTP email boundary —
// configuration resolution and message-content builders — plus, in the final
// describe block, the send-failure logging path with `nodemailer` mocked out
// (never a real transport or a real network send — requirement 145). See
// fakeEmailService.test.ts for the shared-contract proof exercised through the
// injected fake, which is what production `TeamService` callers actually depend on.
import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import {
  buildAdminRequestEmail,
  buildMemberRemovalEmail,
  buildTeamInvitationEmail,
  resolveSmtpConfig,
} from "../smtpEmailService";

const ENV_KEYS = ["SMTP_HOST", "SMTP_PORT", "SMTP_USER", "SMTP_PASS", "SMTP_FROM_ADDRESS", "SMTP_SECURE"];

describe("resolveSmtpConfig (requirements 139-146)", () => {
  beforeEach(() => {
    for (const key of ENV_KEYS) vi.stubEnv(key, "");
  });
  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("reports not_configured when every SMTP variable is empty — never an error for the common accountless/no-cloud case", () => {
    expect(resolveSmtpConfig()).toEqual({ status: "not_configured" });
  });

  it("reports invalid, not silently disabled, when partially configured (missing host)", () => {
    vi.stubEnv("SMTP_FROM_ADDRESS", "no-reply@example.com");
    const result = resolveSmtpConfig();
    expect(result.status).toBe("invalid");
  });

  it("reports invalid for a malformed port", () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_FROM_ADDRESS", "no-reply@example.com");
    vi.stubEnv("SMTP_PORT", "not-a-number");
    expect(resolveSmtpConfig().status).toBe("invalid");
  });

  it("resolves a fully configured SMTP endpoint, defaulting the port to 587", () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_FROM_ADDRESS", "no-reply@example.com");
    vi.stubEnv("SMTP_USER", "user");
    vi.stubEnv("SMTP_PASS", "pass");
    const result = resolveSmtpConfig();
    expect(result).toEqual({
      status: "configured",
      config: {
        host: "smtp.example.com",
        port: 587,
        secure: false,
        user: "user",
        pass: "pass",
        fromAddress: "no-reply@example.com",
      },
    });
  });

  it("treats port 465 as implicitly secure even without SMTP_SECURE set", () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_FROM_ADDRESS", "no-reply@example.com");
    vi.stubEnv("SMTP_PORT", "465");
    const result = resolveSmtpConfig();
    expect(result.status === "configured" && result.config.secure).toBe(true);
  });

  it("rejects a port with trailing garbage rather than silently truncating it (no permissive coercion)", () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_FROM_ADDRESS", "no-reply@example.com");
    vi.stubEnv("SMTP_PORT", "587abc");
    expect(resolveSmtpConfig().status).toBe("invalid");
  });

  it("rejects an out-of-range port", () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_FROM_ADDRESS", "no-reply@example.com");
    vi.stubEnv("SMTP_PORT", "70000");
    expect(resolveSmtpConfig().status).toBe("invalid");
  });

  it("rejects a malformed SMTP_SECURE value rather than silently treating it as false", () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_FROM_ADDRESS", "no-reply@example.com");
    vi.stubEnv("SMTP_SECURE", "flase");
    expect(resolveSmtpConfig().status).toBe("invalid");
  });

  it("accepts SMTP_SECURE case-insensitively", () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_FROM_ADDRESS", "no-reply@example.com");
    vi.stubEnv("SMTP_SECURE", "TRUE");
    const result = resolveSmtpConfig();
    expect(result.status === "configured" && result.config.secure).toBe(true);
  });

  it("rejects a From address that doesn't look like an email", () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_FROM_ADDRESS", "not-an-email");
    expect(resolveSmtpConfig().status).toBe("invalid");
  });

  it("rejects a user without a matching password (partial credentials)", () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_FROM_ADDRESS", "no-reply@example.com");
    vi.stubEnv("SMTP_USER", "user-only");
    expect(resolveSmtpConfig().status).toBe("invalid");
  });

  it("rejects a password without a matching user (partial credentials)", () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_FROM_ADDRESS", "no-reply@example.com");
    vi.stubEnv("SMTP_PASS", "pass-only");
    expect(resolveSmtpConfig().status).toBe("invalid");
  });

  it("accepts no credentials at all (an unauthenticated relay is a legitimate configuration)", () => {
    vi.stubEnv("SMTP_HOST", "smtp.example.com");
    vi.stubEnv("SMTP_FROM_ADDRESS", "no-reply@example.com");
    expect(resolveSmtpConfig().status).toBe("configured");
  });
});

describe("email content builders — no commercial vendor name, no raw token leakage", () => {
  it("team invitation email names the team, inviter, proposal, and accept link, never a raw secret beyond the link itself", () => {
    const { subject, text } = buildTeamInvitationEmail({
      toEmail: "invitee@example.com",
      teamName: "Rink Rats",
      inviterDisplayName: "Tim",
      participationAsPlayer: true,
      proposedFunctions: ["coach"],
      acceptUrl: "https://app.example/invite?token=abc123",
      expiresAt: "2026-06-15T00:00:00.000Z",
    });
    expect(subject).toContain("Rink Rats");
    expect(text).toContain("Tim");
    expect(text).toContain("Player");
    expect(text).toContain("Coach");
    expect(text).toContain("https://app.example/invite?token=abc123");
  });

  it("admin request email names the team and expiry, with an Accept-only framing (no Decline link)", () => {
    const { text } = buildAdminRequestEmail({
      toEmail: "nominee@example.com",
      teamName: "Rink Rats",
      requestedByDisplayName: "Tim",
      acceptUrl: "https://app.example/admin-request?id=req1",
      expiresAt: "2026-06-15T00:00:00.000Z",
    });
    expect(text).toContain("Rink Rats");
    expect(text).toContain("https://app.example/admin-request?id=req1");
    expect(text.toLowerCase()).not.toContain("decline");
  });

  it("member removal email contains no performance data (requirement 82)", () => {
    const { text, subject } = buildMemberRemovalEmail({ toEmail: "former@example.com", teamName: "Rink Rats" });
    expect(subject).toContain("Rink Rats");
    expect(text).toContain("training data was not affected");
    // Sanity: none of the training/assessment domain vocabulary appears.
    for (const forbidden of ["release time", "shot", "assessment", "session"]) {
      expect(text.toLowerCase()).not.toContain(forbidden);
    }
  });
});

describe("SmtpEmailService send-failure logging (docs/adr/0022 §Sanitized Operational Logging)", () => {
  it("never logs the raw transport error's message, even when it looks like it carries host/credential detail", async () => {
    vi.resetModules();
    const sendMail = vi.fn(async () => {
      throw new Error("Authentication failed for user smtp_user:S3cr3tPass at smtp.internal.example:587");
    });
    vi.doMock("nodemailer", () => ({
      default: { createTransport: vi.fn(() => ({ sendMail })) },
    }));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { SmtpEmailService } = await import("../smtpEmailService");
    const service = new SmtpEmailService({
      host: "smtp.internal.example",
      port: 587,
      secure: false,
      user: "smtp_user",
      pass: "S3cr3tPass",
      fromAddress: "no-reply@example.com",
    });

    const result = await service.sendTeamInvitation({
      toEmail: "invitee@example.com",
      teamName: "Rink Rats",
      inviterDisplayName: "Tim",
      participationAsPlayer: true,
      proposedFunctions: ["coach"],
      acceptUrl: "https://app.example.com/?inviteToken=raw-secret",
      expiresAt: "2026-06-15T00:00:00.000Z",
    });

    expect(result).toEqual({ ok: false, error: { message: "Email delivery failed." } });
    expect(consoleErrorSpy).toHaveBeenCalledWith("SMTP send failed:", "Error");
    const loggedText = consoleErrorSpy.mock.calls.flat().join(" ");
    expect(loggedText).not.toContain("S3cr3tPass");
    expect(loggedText).not.toContain("smtp.internal.example");
    expect(loggedText).not.toContain("smtp_user");
    expect(JSON.stringify(result)).not.toContain("S3cr3tPass");

    consoleErrorSpy.mockRestore();
    vi.doUnmock("nodemailer");
    vi.resetModules();
  });

  it("never logs a sensitive value placed in the caught error's own name, code, or status (docs/adr/0022 §Sanitized Operational Logging, fourth pass)", async () => {
    vi.resetModules();
    const sensitiveToken = "rawInvitationToken123abcXYZ";
    // A nodemailer/SMTP client error is often a plain object (or an Error with
    // extra fields) carrying a `.code` — simulating both an overwritten `.name` and
    // a sensitive `.code` in the same thrown value.
    const sendMail = vi.fn(async () => {
      const err = new Error("Connection failed");
      err.name = sensitiveToken;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (err as any).code = sensitiveToken;
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      (err as any).status = "482913";
      throw err;
    });
    vi.doMock("nodemailer", () => ({
      default: { createTransport: vi.fn(() => ({ sendMail })) },
    }));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { SmtpEmailService } = await import("../smtpEmailService");
    const service = new SmtpEmailService({
      host: "smtp.internal.example",
      port: 587,
      secure: false,
      user: "",
      pass: "",
      fromAddress: "no-reply@example.com",
    });

    const result = await service.sendTeamInvitation({
      toEmail: "invitee@example.com",
      teamName: "Rink Rats",
      inviterDisplayName: "Tim",
      participationAsPlayer: true,
      proposedFunctions: ["coach"],
      acceptUrl: "https://app.example.com/?inviteToken=raw-secret",
      expiresAt: "2026-06-15T00:00:00.000Z",
    });

    expect(result).toEqual({ ok: false, error: { message: "Email delivery failed." } });
    // Still an Error instance (overwriting .name/.code/.status doesn't change that),
    // so the hard-coded "Error" literal is logged — never the sensitive values.
    expect(consoleErrorSpy).toHaveBeenCalledWith("SMTP send failed:", "Error");
    const loggedText = consoleErrorSpy.mock.calls.flat().join(" ");
    expect(loggedText).not.toContain(sensitiveToken);
    expect(loggedText).not.toContain("482913");

    consoleErrorSpy.mockRestore();
    vi.doUnmock("nodemailer");
    vi.resetModules();
  });

  it("a hostile Proxy rejection (whose getPrototypeOf/has traps throw) never escapes — send... resolves with the normalized generic failure, never rejects (docs/adr/0022 §Sanitized Operational Logging, fifth pass)", async () => {
    vi.resetModules();
    const sensitiveToken = "rawInvitationToken123abcXYZ";
    const hostileRejection = new Proxy(
      {},
      {
        getPrototypeOf() {
          throw new Error(`proxy trap escaped: ${sensitiveToken}`);
        },
        has() {
          throw new Error(`proxy trap escaped: ${sensitiveToken}`);
        },
      }
    );
    const sendMail = vi.fn(async () => {
      throw hostileRejection;
    });
    vi.doMock("nodemailer", () => ({
      default: { createTransport: vi.fn(() => ({ sendMail })) },
    }));
    const consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});

    const { SmtpEmailService } = await import("../smtpEmailService");
    const service = new SmtpEmailService({
      host: "smtp.internal.example",
      port: 587,
      secure: false,
      user: "",
      pass: "",
      fromAddress: "no-reply@example.com",
    });

    let result: Awaited<ReturnType<typeof service.sendTeamInvitation>> | undefined;
    await expect(
      (async () => {
        result = await service.sendTeamInvitation({
          toEmail: "invitee@example.com",
          teamName: "Rink Rats",
          inviterDisplayName: "Tim",
          participationAsPlayer: true,
          proposedFunctions: ["coach"],
          acceptUrl: "https://app.example.com/?inviteToken=raw-secret",
          expiresAt: "2026-06-15T00:00:00.000Z",
        });
      })()
    ).resolves.toBeUndefined();

    expect(result).toEqual({ ok: false, error: { message: "Email delivery failed." } });
    expect(consoleErrorSpy).toHaveBeenCalledWith("SMTP send failed:", "unknown_error");
    const loggedText = consoleErrorSpy.mock.calls.flat().join(" ");
    expect(loggedText).not.toContain(sensitiveToken);
    expect(loggedText).not.toContain("proxy trap escaped");

    consoleErrorSpy.mockRestore();
    vi.doUnmock("nodemailer");
    vi.resetModules();
  });
});
