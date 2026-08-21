// POST /api/team/invitations/[id]/resend — replaces a still-pending invitation with an
// identical proposal under a freshly rotated secret (docs/adr/0022 Decision 5) and
// attempts one email send. No request body — every field comes from the existing row.
import { NextResponse } from "next/server";
import {
  bestEffort,
  buildAcceptUrl,
  callMutationRpc,
  errorJson,
  fetchMyDisplayName,
  fetchTeamName,
  firstRow,
  isInvitationCreatedRow,
  recordDeliveryBestEffort,
  resolveRouteContext,
} from "../../../_lib/context";
import { mapInvitationCreatedRow } from "../../../../../../lib/supabase/supabaseTeamService";
import { createSmtpEmailServiceFromEnv } from "../../../../../../lib/email/smtpEmailService";

export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const context = resolveRouteContext(request);
  if (!context.ok) return context.response;
  const { client } = context.value;

  const { id: invitationId } = await params;

  const mutation = await callMutationRpc(client, "resend_invitation", { p_invitation_id: invitationId });
  if (!mutation.ok) return mutation.response;

  const row = firstRow(mutation.data);
  if (!isInvitationCreatedRow(row)) {
    return errorJson("unexpected_error", "Something went wrong. Please try again.", 500);
  }
  const { invitation, rawToken } = mapInvitationCreatedRow(row);

  const [teamName, inviterDisplayName] = await Promise.all([
    fetchTeamName(client, invitation.teamId),
    fetchMyDisplayName(client),
  ]);

  // See invitations/route.ts's equivalent block for why SMTP construction, the
  // canonical accept-link resolution, and the send are all wrapped in one
  // exception boundary (docs/adr/0022 §Canonical Email Link Origin / §Route Handler
  // Exception Boundary).
  const emailSent = await bestEffort("sendTeamInvitation", false, async () => {
    const emailService = createSmtpEmailServiceFromEnv();
    const acceptUrl = buildAcceptUrl("inviteToken", rawToken);
    if (!emailService || !acceptUrl) return false;
    const result = await emailService.sendTeamInvitation({
      toEmail: invitation.email,
      teamName: teamName ?? "your team",
      inviterDisplayName,
      participationAsPlayer: invitation.participationAsPlayer,
      proposedFunctions: invitation.proposedFunctions,
      acceptUrl,
      expiresAt: invitation.expiresAt,
    });
    return result.ok;
  });

  await recordDeliveryBestEffort(client, "record_invitation_email_delivery", {
    p_invitation_id: invitation.id,
    p_delivered: emailSent,
  });

  return NextResponse.json({
    invitation: { ...invitation, emailDeliveryStatus: emailSent ? "sent" : "failed" },
    emailSent,
  });
}
