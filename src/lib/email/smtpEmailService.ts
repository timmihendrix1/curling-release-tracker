// The one production implementation of EmailService — server-only, provider-neutral
// SMTP (requirements 139-146). Deliberately built on the generic SMTP protocol via
// `nodemailer` rather than any commercial vendor's HTTP API/SDK: any provider that
// exposes an SMTP endpoint (a self-hosted mail server, or any commercial transactional
// email service's SMTP relay) can be configured here without a code change or a
// vendor-specific import anywhere in domain code.
//
// SERVER-ONLY. This module reads SMTP credentials from `process.env` and must only be
// imported from server-side code (the Next.js Route Handlers under src/app/api/team/).
// It must never be imported by a Client Component or any module reachable from the
// browser bundle. Config values are read lazily (inside the constructor/functions),
// never at module top-level import time, so importing this file never throws even if
// SMTP is unconfigured — only actually sending does.

import nodemailer, { type Transporter } from "nodemailer";
import type {
  AdminRequestEmailInput,
  EmailSendResult,
  EmailService,
  MemberRemovalEmailInput,
  TeamInvitationEmailInput,
} from "./emailService";
import { safeErrorCategory } from "../safeErrorCategory";

export type SmtpConfig = {
  host: string;
  port: number;
  secure: boolean;
  user: string;
  pass: string;
  fromAddress: string;
};

export type SmtpConfigResolution =
  | { status: "configured"; config: SmtpConfig }
  | { status: "not_configured" }
  | { status: "invalid"; reason: string };

function readEnv(name: string): string {
  return (process.env[name] ?? "").trim();
}

// Same pattern as useSupabaseAuthController.ts's EMAIL_PATTERN — kept in sync
// deliberately rather than importing across the client/server boundary this file
// otherwise avoids.
const EMAIL_FORMAT = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

/**
 * Resolves server-only SMTP environment variables into a typed configuration. Never
 * throws. `"not_configured"` (every variable empty) is a distinct, non-error outcome
 * from `"invalid"` (some variables set, but not enough — or not well-formed enough —
 * to form a valid config) — mirroring `src/lib/supabase/config.ts`'s
 * `resolveCloudConfig` three-outcome shape, so a half-configured or malformed
 * deployment fails loudly instead of silently trying to send with a blank host or a
 * value that was only coincidentally coerced into something parseable
 * (docs/adr/0022 §Email Configuration Hardening — validation here is strict, never
 * permissive: `SMTP_PORT="587abc"` or `SMTP_SECURE="flase"` are rejected as invalid,
 * never silently truncated/defaulted).
 */
export function resolveSmtpConfig(): SmtpConfigResolution {
  const host = readEnv("SMTP_HOST");
  const portRaw = readEnv("SMTP_PORT");
  const user = readEnv("SMTP_USER");
  const pass = readEnv("SMTP_PASS");
  const fromAddress = readEnv("SMTP_FROM_ADDRESS");
  const secureRaw = readEnv("SMTP_SECURE");

  if (!host && !portRaw && !user && !pass && !fromAddress && !secureRaw) {
    return { status: "not_configured" };
  }
  if (!host) return { status: "invalid", reason: "SMTP_HOST is not set." };
  if (!fromAddress) return { status: "invalid", reason: "SMTP_FROM_ADDRESS is not set." };
  if (!EMAIL_FORMAT.test(fromAddress)) {
    return { status: "invalid", reason: "SMTP_FROM_ADDRESS is not a valid email address." };
  }
  // Strict: only an unbroken sequence of digits is accepted — Number.parseInt would
  // otherwise silently accept "587abc" as 587.
  if (portRaw && !/^\d+$/.test(portRaw)) {
    return { status: "invalid", reason: "SMTP_PORT is not a valid port number." };
  }
  const port = portRaw ? Number.parseInt(portRaw, 10) : 587;
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    return { status: "invalid", reason: "SMTP_PORT is not a valid port number." };
  }
  // Strict: only "true"/"false" (case-insensitive) are recognized — anything else
  // (a typo like "flase", or "1"/"yes") is rejected rather than silently treated as
  // false.
  if (secureRaw && !/^(true|false)$/i.test(secureRaw)) {
    return { status: "invalid", reason: "SMTP_SECURE must be \"true\" or \"false\"." };
  }
  // Partial credentials (one of user/pass set without the other) are rejected —
  // never silently attempt an unauthenticated connection to a relay that likely
  // requires the missing half.
  if ((user && !pass) || (!user && pass)) {
    return { status: "invalid", reason: "SMTP_USER and SMTP_PASS must both be set, or both left blank." };
  }
  const secure = secureRaw ? /^true$/i.test(secureRaw) : port === 465;
  return { status: "configured", config: { host, port, secure, user, pass, fromAddress } };
}

function functionLabel(fn: string): string {
  switch (fn) {
    case "team_admin":
      return "Team Admin";
    case "coach":
      return "Coach";
    case "training_lead":
      return "Training Lead";
    default:
      return fn;
  }
}

function formatFunctionsAndParticipation(participationAsPlayer: boolean, proposedFunctions: string[]): string {
  const parts: string[] = [];
  if (participationAsPlayer) parts.push("Player");
  parts.push(...proposedFunctions.map(functionLabel));
  return parts.length > 0 ? parts.join(", ") : "No function or player participation proposed";
}

export function buildTeamInvitationEmail(input: TeamInvitationEmailInput): { subject: string; text: string } {
  const inviter = input.inviterDisplayName ?? "A Team Admin";
  const summary = formatFunctionsAndParticipation(input.participationAsPlayer, input.proposedFunctions);
  return {
    subject: `Invitation to join ${input.teamName}`,
    text: [
      `${inviter} invited you to join the team "${input.teamName}".`,
      "",
      `Proposed: ${summary}`,
      "",
      `Accept the invitation: ${input.acceptUrl}`,
      "",
      `This link expires on ${input.expiresAt}.`,
      "If you weren't expecting this, you can ignore this email.",
    ].join("\n"),
  };
}

export function buildAdminRequestEmail(input: AdminRequestEmailInput): { subject: string; text: string } {
  const requester = input.requestedByDisplayName ?? "A Team Admin";
  return {
    subject: `Team Admin request for ${input.teamName}`,
    text: [
      `${requester} asked you to take on the Team Admin function for "${input.teamName}".`,
      "",
      `Accept the request: ${input.acceptUrl}`,
      "",
      `This request expires on ${input.expiresAt}.`,
      "If you don't want this responsibility, no action is needed — the request will expire on its own.",
    ].join("\n"),
  };
}

export function buildMemberRemovalEmail(input: MemberRemovalEmailInput): { subject: string; text: string } {
  return {
    subject: `You were removed from ${input.teamName}`,
    text: [
      `You were removed from the team "${input.teamName}".`,
      "Your personal training data was not affected and remains yours.",
    ].join("\n"),
  };
}

function toSendFailure(error: unknown): EmailSendResult {
  // Logged server-side only (stderr) for operational diagnosis — never returned to a
  // caller, which mirrors AuthService's normalized-error discipline. The raw SMTP
  // error's own message/name/code/status is never logged — only one of
  // `safeErrorCategory`'s hard-coded category literals — since an SMTP client
  // library's error can embed the configured host, port, or authentication context
  // in any of those fields, exactly the kind of detail this boundary exists to keep
  // out of any log or response. `safeErrorCategory` is itself total and
  // non-throwing, so even a hostile rejected value can never make this call throw
  // and skip the normalized `{ ok: false, ... }` result below (docs/adr/0022
  // §Sanitized Operational Logging).
  console.error("SMTP send failed:", safeErrorCategory(error));
  return { ok: false, error: { message: "Email delivery failed." } };
}

export class SmtpEmailService implements EmailService {
  private cachedTransporter: Transporter | null = null;
  private readonly fromAddress: string;

  constructor(private readonly config: SmtpConfig) {
    this.fromAddress = config.fromAddress;
  }

  private transporter(): Transporter {
    if (!this.cachedTransporter) {
      this.cachedTransporter = nodemailer.createTransport({
        host: this.config.host,
        port: this.config.port,
        secure: this.config.secure,
        auth: this.config.user ? { user: this.config.user, pass: this.config.pass } : undefined,
      });
    }
    return this.cachedTransporter;
  }

  private async send(to: string, subject: string, text: string): Promise<EmailSendResult> {
    try {
      await this.transporter().sendMail({ from: this.fromAddress, to, subject, text });
      return { ok: true };
    } catch (error) {
      return toSendFailure(error);
    }
  }

  async sendTeamInvitation(input: TeamInvitationEmailInput): Promise<EmailSendResult> {
    const { subject, text } = buildTeamInvitationEmail(input);
    return this.send(input.toEmail, subject, text);
  }

  async sendAdminRequest(input: AdminRequestEmailInput): Promise<EmailSendResult> {
    const { subject, text } = buildAdminRequestEmail(input);
    return this.send(input.toEmail, subject, text);
  }

  async sendMemberRemovalNotice(input: MemberRemovalEmailInput): Promise<EmailSendResult> {
    const { subject, text } = buildMemberRemovalEmail(input);
    return this.send(input.toEmail, subject, text);
  }
}

/**
 * Constructs the production EmailService from environment configuration, or `null`
 * when SMTP is not configured/invalid — callers (the Route Handlers) must treat a
 * `null` result as "cannot send right now" and report an honest delivery failure
 * (requirement 146/147), never fabricate success.
 */
export function createSmtpEmailServiceFromEnv(): EmailService | null {
  const resolution = resolveSmtpConfig();
  if (resolution.status !== "configured") return null;
  return new SmtpEmailService(resolution.config);
}
