// Test/dev fake implementing the exact same EmailService contract production code
// uses — never a shortcut that skips the boundary (requirement 144). Captures every
// send so tests can assert on recipient/content, and supports scripting a failure for
// a specific address to exercise honest-failure paths (requirements 66, 83, 147)
// without ever sending a real external email (requirement 145).

import type {
  AdminRequestEmailInput,
  EmailSendResult,
  EmailService,
  MemberRemovalEmailInput,
  TeamInvitationEmailInput,
} from "./emailService";

export type CapturedEmail =
  | { kind: "team_invitation"; input: TeamInvitationEmailInput }
  | { kind: "admin_request"; input: AdminRequestEmailInput }
  | { kind: "member_removal"; input: MemberRemovalEmailInput };

export class FakeEmailService implements EmailService {
  readonly sent: CapturedEmail[] = [];
  /** Email addresses (case-insensitive) for which the next matching send should fail,
   * simulating a delivery failure. Consumed once per address per call — set it again
   * before each send you want to fail. */
  private readonly failNextSendFor = new Set<string>();

  failNextSendTo(email: string): void {
    this.failNextSendFor.add(email.trim().toLowerCase());
  }

  private resolve(email: string): EmailSendResult {
    const key = email.trim().toLowerCase();
    if (this.failNextSendFor.has(key)) {
      this.failNextSendFor.delete(key);
      return { ok: false, error: { message: "Simulated delivery failure." } };
    }
    return { ok: true };
  }

  async sendTeamInvitation(input: TeamInvitationEmailInput): Promise<EmailSendResult> {
    this.sent.push({ kind: "team_invitation", input });
    return this.resolve(input.toEmail);
  }

  async sendAdminRequest(input: AdminRequestEmailInput): Promise<EmailSendResult> {
    this.sent.push({ kind: "admin_request", input });
    return this.resolve(input.toEmail);
  }

  async sendMemberRemovalNotice(input: MemberRemovalEmailInput): Promise<EmailSendResult> {
    this.sent.push({ kind: "member_removal", input });
    return this.resolve(input.toEmail);
  }
}
