// POST /api/team/members/remove — ends an active membership and attempts one
// removal-notice email (docs/adr/0022 Decision 11). The member's email is looked up
// BEFORE calling remove_member, since get_team_member_emails only returns active
// members and the RPC ends the membership's active status as part of the removal.
import { NextResponse } from "next/server";
import {
  bestEffort,
  callMutationRpc,
  errorJson,
  fetchTeamMemberEmailsBestEffort,
  fetchTeamName,
  readJsonBody,
  resolveRouteContext,
} from "../../_lib/context";
import { createSmtpEmailServiceFromEnv } from "../../../../../lib/email/smtpEmailService";

type RemoveMemberBody = { teamId: string; membershipId: string };

function isValidBody(value: unknown): value is RemoveMemberBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return typeof body.teamId === "string" && typeof body.membershipId === "string";
}

export async function POST(request: Request): Promise<NextResponse> {
  const context = resolveRouteContext(request);
  if (!context.ok) return context.response;
  const { client } = context.value;

  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;
  if (!isValidBody(parsedBody.value)) {
    return errorJson("invalid_input", "Missing or malformed member-removal fields.", 400);
  }
  const { teamId, membershipId } = parsedBody.value;

  // Looked up BEFORE remove_member, since get_team_member_emails only returns
  // active members and the mutation ends this membership's active status — a
  // best-effort lookup failure here just means no removal email can be sent, never
  // a reason to abort the removal itself.
  const [emailRows, teamName] = await Promise.all([
    fetchTeamMemberEmailsBestEffort(client, teamId),
    fetchTeamName(client, teamId),
  ]);
  const removedMemberEmail = emailRows.find((memberEmailRow) => memberEmailRow.membership_id === membershipId)?.email;

  const mutation = await callMutationRpc(client, "remove_member", { p_team_id: teamId, p_membership_id: membershipId });
  if (!mutation.ok) return mutation.response;

  // SMTP service construction and the send itself are both non-essential
  // post-mutation side effects — a synchronous factory/configuration failure must
  // not throw out of this handler after the removal has already durably completed
  // (docs/adr/0022 §Route Handler Exception Boundary).
  const notificationEmailSent = await bestEffort("sendMemberRemovalNotice", false, async () => {
    if (!removedMemberEmail) return false;
    const emailService = createSmtpEmailServiceFromEnv();
    if (!emailService) return false;
    const result = await emailService.sendMemberRemovalNotice({
      toEmail: removedMemberEmail,
      teamName: teamName ?? "your team",
    });
    return result.ok;
  });

  return NextResponse.json({ notificationEmailSent });
}
