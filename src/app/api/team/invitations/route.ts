// POST /api/team/invitations — creates a Team Invitation and attempts one email send
// (docs/adr/0022 Decision 11). See src/app/api/team/_lib/context.ts for the shared
// authentication/response plumbing every Team Foundation route handler uses.
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
  isValidFunctionArray,
  readJsonBody,
  recordDeliveryBestEffort,
  resolveRouteContext,
} from "../_lib/context";
import { mapInvitationCreatedRow } from "../../../../lib/supabase/supabaseTeamService";
import { createSmtpEmailServiceFromEnv } from "../../../../lib/email/smtpEmailService";
import { TEAM_FUNCTIONS, type TeamFunction } from "../../../../lib/team/types";

type CreateInvitationBody = {
  teamId: string;
  email: string;
  participationAsPlayer: boolean;
  proposedFunctions: TeamFunction[];
};

function isValidBody(value: unknown): value is CreateInvitationBody {
  if (typeof value !== "object" || value === null) return false;
  const body = value as Record<string, unknown>;
  return (
    typeof body.teamId === "string" &&
    typeof body.email === "string" &&
    typeof body.participationAsPlayer === "boolean" &&
    isValidFunctionArray(body.proposedFunctions, TEAM_FUNCTIONS)
  );
}

export async function POST(request: Request): Promise<NextResponse> {
  const context = resolveRouteContext(request);
  if (!context.ok) return context.response;
  const { client } = context.value;

  const parsedBody = await readJsonBody(request);
  if (!parsedBody.ok) return parsedBody.response;
  if (!isValidBody(parsedBody.value)) {
    return errorJson("invalid_input", "Missing or malformed invitation fields.", 400);
  }
  const { teamId, email, participationAsPlayer, proposedFunctions } = parsedBody.value;

  const mutation = await callMutationRpc(client, "create_invitation", {
    p_team_id: teamId,
    p_email: email,
    p_participation_as_player: participationAsPlayer,
    p_functions: proposedFunctions,
  });
  if (!mutation.ok) return mutation.response;

  const row = firstRow(mutation.data);
  if (!isInvitationCreatedRow(row)) {
    return errorJson("unexpected_error", "Something went wrong. Please try again.", 500);
  }
  const { invitation, rawToken } = mapInvitationCreatedRow(row);

  const [teamName, inviterDisplayName] = await Promise.all([
    fetchTeamName(client, teamId),
    fetchMyDisplayName(client),
  ]);

  // The SMTP service construction, the canonical accept-link resolution, and the
  // send itself are all non-essential post-mutation side effects — none of them may
  // throw out of this handler, and a missing/invalid canonical origin must report
  // an honest emailSent:false rather than fall back to the request's own origin
  // (docs/adr/0022 §Canonical Email Link Origin / §Route Handler Exception
  // Boundary).
  const emailSent = await bestEffort("sendTeamInvitation", false, async () => {
    const emailService = createSmtpEmailServiceFromEnv();
    const acceptUrl = buildAcceptUrl("inviteToken", rawToken);
    if (!emailService || !acceptUrl) return false;
    const result = await emailService.sendTeamInvitation({
      toEmail: email,
      teamName: teamName ?? "your team",
      inviterDisplayName,
      participationAsPlayer,
      proposedFunctions,
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
