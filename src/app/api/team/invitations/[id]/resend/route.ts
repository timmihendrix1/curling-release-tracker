// POST /api/team/invitations/[id]/resend — replaces a still-pending invitation with an
// identical proposal under a freshly rotated secret (docs/adr/0022 Decision 5) and
// attempts one email send. No request body — every field comes from the existing row.
import { NextResponse } from "next/server";
// Native mobile clients are cross-origin (ADR-0047). `withNativeCors` refuses a
// request from an origin this application does not serve BEFORE this handler
// runs — so an unapproved cross-origin caller cannot cause a mutation or an
// email send — and adds the CORS grant to whatever this handler returns.
import { nativeCorsPreflight, withNativeCors } from "../../../../_lib/nativeCors";
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

async function handlePost(request: Request, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
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

/** This route family's sanitized internal-error response — the same
 * `'<kind>: <message>'` contract every other Team failure uses
 * (docs/adr/0022 §Error Boundary Sanitization). Never embeds a caught value. */
function internalError() {
  return errorJson("unexpected_error", "Something went wrong. Please try again.", 500);
}

export const POST = withNativeCors<{ params: Promise<{ id: string }> }>(handlePost, internalError);
export const OPTIONS = nativeCorsPreflight(["POST"]);
