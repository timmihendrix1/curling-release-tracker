// POST /api/team/admin-requests — nominates an existing active member for the Team
// Admin function and attempts one email send (docs/adr/0022 Decisions 4/11). The
// nominee also receives an in-app AccountNotification regardless of email outcome —
// created inside the same RPC transaction, not by this route.
import { NextResponse } from "next/server";
import {
  bestEffort,
  buildAcceptUrl,
  callMutationRpc,
  errorJson,
  fetchMyDisplayName,
  fetchTeamMemberEmailsBestEffort,
  fetchTeamName,
  firstRow,
  isAdminRequestRow,
  readJsonBody,
  recordDeliveryBestEffort,
  resolveRouteContext,
} from "../_lib/context";
import { mapAdminRequestRow } from "../../../../lib/supabase/supabaseTeamService";
import { createSmtpEmailServiceFromEnv } from "../../../../lib/email/smtpEmailService";

type CreateAdminRequestBody = { teamId: string; membershipId: string };

function isValidBody(value: unknown): value is CreateAdminRequestBody {
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
    return errorJson("invalid_input", "Missing or malformed admin request fields.", 400);
  }
  const { teamId, membershipId } = parsedBody.value;

  const mutation = await callMutationRpc(client, "create_admin_request", {
    p_team_id: teamId,
    p_membership_id: membershipId,
  });
  if (!mutation.ok) return mutation.response;

  const row = firstRow(mutation.data);
  if (!isAdminRequestRow(row)) {
    return errorJson("unexpected_error", "Something went wrong. Please try again.", 500);
  }
  const adminRequest = mapAdminRequestRow(row);

  const [emailRows, teamName, requestedByDisplayName] = await Promise.all([
    fetchTeamMemberEmailsBestEffort(client, teamId),
    fetchTeamName(client, teamId),
    fetchMyDisplayName(client),
  ]);
  const nomineeEmail = emailRows.find((memberEmailRow) => memberEmailRow.membership_id === membershipId)?.email;

  // See invitations/route.ts's equivalent block for why SMTP construction, the
  // canonical accept-link resolution, and the send are all wrapped in one
  // exception boundary (docs/adr/0022 §Canonical Email Link Origin / §Route Handler
  // Exception Boundary).
  const emailSent = await bestEffort("sendAdminRequest", false, async () => {
    if (!nomineeEmail) return false;
    const emailService = createSmtpEmailServiceFromEnv();
    const acceptUrl = buildAcceptUrl("adminRequestId", adminRequest.id);
    if (!emailService || !acceptUrl) return false;
    const result = await emailService.sendAdminRequest({
      toEmail: nomineeEmail,
      teamName: teamName ?? "your team",
      requestedByDisplayName,
      acceptUrl,
      expiresAt: adminRequest.expiresAt,
    });
    return result.ok;
  });

  await recordDeliveryBestEffort(client, "record_admin_request_email_delivery", {
    p_request_id: adminRequest.id,
    p_delivered: emailSent,
  });

  return NextResponse.json({ request: adminRequest, emailSent });
}
