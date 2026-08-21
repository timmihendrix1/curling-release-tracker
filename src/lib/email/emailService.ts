// Provider-neutral, server-only outbound email boundary (requirements 139-147). No
// commercial vendor name appears anywhere in this contract or in the domain code that
// calls it — only `smtpEmailService.ts` (the one production implementation) knows it
// speaks SMTP, and nothing above this interface needs to know even that much. Mirrors
// the never-throw, normalized-result discipline of `src/lib/supabase/authService.ts`
// and `src/lib/team/errors.ts`: every method resolves, never rejects, and a delivery
// failure is reported as an honest `{ ok: false }` result — it is never silently
// upgraded to "sent" (requirement 147).
//
// Server-only: this module (and every implementation of it) may read SMTP
// credentials from `process.env`. It must never be imported from a Client Component,
// and no browser-reachable code path may construct a real (non-fake) implementation —
// see src/app/api/team/ route handlers for the only production call sites.

export type EmailSendResult = { ok: true } | { ok: false; error: { message: string } };

export type TeamInvitationEmailInput = {
  toEmail: string;
  teamName: string;
  inviterDisplayName: string | null;
  participationAsPlayer: boolean;
  proposedFunctions: string[];
  acceptUrl: string;
  expiresAt: string;
};

export type AdminRequestEmailInput = {
  toEmail: string;
  teamName: string;
  requestedByDisplayName: string | null;
  acceptUrl: string;
  expiresAt: string;
};

export type MemberRemovalEmailInput = {
  toEmail: string;
  teamName: string;
};

/**
 * Every method sends exactly one email and resolves with whether it was actually
 * handed off successfully — never a fire-and-forget void. Callers (the Next.js route
 * handlers in src/app/api/team/) are responsible for recording the outcome
 * durably and separately from the domain mutation that triggered the email
 * (requirement 147) — this interface has no persistence of its own.
 */
export interface EmailService {
  sendTeamInvitation(input: TeamInvitationEmailInput): Promise<EmailSendResult>;
  sendAdminRequest(input: AdminRequestEmailInput): Promise<EmailSendResult>;
  sendMemberRemovalNotice(input: MemberRemovalEmailInput): Promise<EmailSendResult>;
}
