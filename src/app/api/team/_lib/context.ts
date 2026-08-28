// Shared plumbing for the Team Foundation Route Handlers (docs/adr/0022 Decision 11).
// Every handler under src/app/api/team/ is a thin wrapper: authenticate the caller via
// their forwarded bearer token, call exactly one RPC, and (for these five
// email-involving mutations only) attempt exactly one email send, recording an honest
// outcome. This module holds only the parts identical across all five routes — it
// intentionally does not know which RPC a given route calls.
//
// Deliberately does NOT import "@supabase/supabase-js" — see
// src/lib/supabase/supabaseServerClient.ts's own header and the architecture-boundary
// test (src/lib/persistence/__tests__/architectureBoundary.test.ts).
import { NextResponse } from "next/server";
import { resolveUserScopedSupabaseContext } from "../../_lib/userScopedSupabaseContext";
import type { SupabaseClient } from "../../../../lib/supabase/supabaseClient";
import { parsePostgresErrorMessage } from "../../../../lib/team/postgresErrorMapping";
import type { TeamErrorKind } from "../../../../lib/team/errors";
import { safeErrorCategory } from "../../../../lib/safeErrorCategory";
import { TEAM_FUNCTIONS } from "../../../../lib/team/types";

export type RouteContext = { client: SupabaseClient };

export type RouteContextResult = { ok: true; value: RouteContext } | { ok: false; response: NextResponse };

/** Validates a request body's function-array field against the allowed set for that
 * boundary (docs/adr/0022 §Function Array Input Validation) — the same total check
 * (non-null array, only allowed values, no duplicates) `private.validate_function_array`
 * enforces in Postgres, applied here so a malformed request is rejected with a clear
 * `invalid_input` before ever reaching the RPC. */
export function isValidFunctionArray(value: unknown, allowed: readonly string[]): value is string[] {
  if (!Array.isArray(value)) return false;
  if (!value.every((fn) => typeof fn === "string" && (allowed as string[]).includes(fn))) return false;
  return new Set(value).size === value.length;
}

/** Postgres RPCs that return a single composite row are surfaced by the client as
 * either that row directly or a one-element array, depending on call shape — this
 * normalizes both to "the row". */
export function firstRow(data: unknown): unknown {
  return Array.isArray(data) ? data[0] : data;
}

const INVITATION_STATUSES: ReadonlySet<string> = new Set(["pending", "accepted", "expired", "revoked", "replaced"]);
const EMAIL_DELIVERY_STATUSES: ReadonlySet<string> = new Set(["pending", "sent", "failed"]);
const ADMIN_REQUEST_STATUSES: ReadonlySet<string> = new Set(["pending", "accepted", "revoked", "replaced", "expired"]);

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || isNonEmptyString(value);
}

/** A required timestamp field must be a non-empty string that actually parses as a
 * date — not merely "some string" (docs/adr/0022 §Route Handler Exception Boundary:
 * "required timestamp strings"). */
function isTimestampString(value: unknown): value is string {
  return isNonEmptyString(value) && !Number.isNaN(Date.parse(value));
}

function isNullableTimestampString(value: unknown): value is string | null {
  return value === null || isTimestampString(value);
}

/** Full shape guard for the `team_invitations` row nested inside
 * `create_invitation`/`revise_invitation`/`resend_invitation`'s
 * `team_invitation_created` composite — every field `mapInvitationRow`
 * (supabaseTeamService.ts) actually reads, not merely `id` (docs/adr/0022 §Route
 * Handler Exception Boundary, strengthened in the third correction pass: "do not
 * accept an object merely because it has an ID"). */
function isInvitationRowShape(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    isNonEmptyString(row.id) &&
    isNonEmptyString(row.team_id) &&
    isNonEmptyString(row.email) &&
    typeof row.participation_as_player === "boolean" &&
    isValidFunctionArray(row.proposed_functions, TEAM_FUNCTIONS) &&
    typeof row.status === "string" &&
    INVITATION_STATUSES.has(row.status) &&
    isTimestampString(row.created_at) &&
    isTimestampString(row.expires_at) &&
    isNullableTimestampString(row.accepted_at) &&
    isNullableTimestampString(row.revoked_at) &&
    isNullableString(row.replaced_by_invitation_id) &&
    typeof row.email_delivery_status === "string" &&
    EMAIL_DELIVERY_STATUSES.has(row.email_delivery_status)
  );
}

/** Narrow shape guard for `create_invitation`/`revise_invitation`/`resend_invitation`'s
 * `team_invitation_created` composite (docs/adr/0022 §Route Handler Exception
 * Boundary: "validate successful RPC result shapes before using them"). A malformed
 * result — a schema/RPC version mismatch, never an expected domain outcome — must
 * fail closed with a generic error rather than let a raw property-access failure
 * throw an unsanitized error, or silently proceed with a broken invitation/token. */
export function isInvitationCreatedRow(value: unknown): value is { invitation: Record<string, unknown>; raw_token: string } {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  if (!isNonEmptyString(row.raw_token)) return false;
  return isInvitationRowShape(row.invitation);
}

/** Full shape guard for `create_admin_request`'s returned `team_admin_requests` row
 * — every field `mapAdminRequestRow` (supabaseTeamService.ts) actually reads, not
 * merely `id` (docs/adr/0022 §Route Handler Exception Boundary, strengthened in the
 * third correction pass). */
export function isAdminRequestRow(value: unknown): value is Record<string, unknown> {
  if (typeof value !== "object" || value === null) return false;
  const row = value as Record<string, unknown>;
  return (
    isNonEmptyString(row.id) &&
    isNonEmptyString(row.team_id) &&
    isNonEmptyString(row.membership_id) &&
    typeof row.status === "string" &&
    ADMIN_REQUEST_STATUSES.has(row.status) &&
    isTimestampString(row.created_at) &&
    isTimestampString(row.expires_at) &&
    isNullableTimestampString(row.accepted_at) &&
    isNullableTimestampString(row.revoked_at) &&
    isNullableString(row.replaced_by_request_id)
  );
}

/** Stable HTTP status per `TeamErrorKind` (docs/adr/0022 §Error Boundary Sanitization)
 * — used for both `errorJson` (a route-authored failure) and `rpcErrorJson` (a
 * re-derived RPC failure), so a given kind always crosses the wire with the same
 * status regardless of which layer raised it. */
const STATUS_BY_KIND: Record<TeamErrorKind, number> = {
  invalid_input: 400,
  forbidden: 403,
  not_found: 404,
  already_exists: 409,
  conflict: 409,
  expired: 409,
  revoked: 409,
  replaced: 409,
  already_accepted: 409,
  wrong_email: 403,
  wrong_nominee: 403,
  last_admin_invariant: 409,
  archived_team: 409,
  not_configured: 500,
  network_error: 502,
  unexpected_error: 500,
};

/** `<kind>: <message>` — the same convention every Postgres RPC failure uses (see
 * docs/adr/0022 Decision 13) — so a client-side `postToRoute` caller parses a
 * route-originated error exactly the same way it parses an RPC-originated one. */
export function errorJson(kind: TeamErrorKind, message: string, status: number = STATUS_BY_KIND[kind]): NextResponse {
  return NextResponse.json({ error: `${kind}: ${message}` }, { status });
}

/**
 * Re-derives an RPC failure through the SAME `parsePostgresErrorMessage` parser the
 * direct-RPC browser path uses, then re-serializes only the sanitized `{kind,
 * message}` pair — never the caller-supplied `rawMessage` itself (docs/adr/0022
 * §Error Boundary Sanitization). A malformed/unrecognized provider error (a genuine
 * constraint violation, a permission-denied message, an SMTP/connection error, or
 * any other unhandled exception text) therefore can never reach the browser verbatim
 * through this HTTP boundary, exactly as it already can't through the direct-RPC
 * path — this is the same fail-closed guarantee, applied at the second transport.
 */
export function rpcErrorJson(rawMessage: string | null | undefined): NextResponse {
  const { kind, message } = parsePostgresErrorMessage(rawMessage);
  return errorJson(kind, message);
}

/**
 * Authenticates the incoming request and constructs a fresh, user-scoped Supabase
 * client bound to the caller's own forwarded access token — never the service-role key
 * (requirement 132/156). Every route handler calls this first, before touching its
 * request body.
 */
export function resolveRouteContext(request: Request): RouteContextResult {
  const context = resolveUserScopedSupabaseContext(request);
  if (!context.ok && context.reason === "unauthenticated") {
    return { ok: false, response: errorJson("forbidden", "You must be signed in.", 401) };
  }
  if (!context.ok) {
    return { ok: false, response: errorJson("unexpected_error", "Cloud is not configured.", 500) };
  }
  return { ok: true, value: { client: context.client } };
}

function logBestEffortFailure(label: string, err: unknown): void {
  // Never logs a request body, token, email address, authorization header,
  // credential, or the error's own message/name/code/status text, since any of
  // those is exactly where such values leak from (a rejected fetch's message can
  // embed a URL with a bearer token; a Postgrest error's message can embed
  // column/row values; nothing stops code from setting `error.name`/`error.code` to
  // a sensitive value directly). Only a stable label plus one of `safeErrorCategory`'s
  // small set of HARD-CODED category literals is ever logged — never a value read
  // off the caught object. `safeErrorCategory` is itself total and non-throwing: a
  // hostile value whose own reflection behavior (a Proxy's `getPrototypeOf`/`has`
  // traps) throws during classification fails closed to the same generic literal an
  // unrecognized shape already produces, so this call can never itself become the
  // thing that lets an exception escape after a durable mutation has already
  // succeeded (docs/adr/0022 §Sanitized Operational Logging).
  console.error(`${label} failed:`, safeErrorCategory(err));
}

/**
 * Runs a post-mutation side effect (a metadata lookup, an email send, delivery
 * bookkeeping) that must never fail the calling route, regardless of whether the
 * underlying promise rejects OR resolves its own `{ error }` shape (docs/adr/0022
 * §Route Handler Exception Boundary). By the time any of these run, the durable
 * mutation this route exists for has already succeeded — a failure here is logged
 * server-side for operational diagnosis and never allowed to erase or misrepresent
 * that success, and never leaks provider/transport detail to the caller.
 */
export async function bestEffort<T>(label: string, fallback: T, run: () => Promise<T>): Promise<T> {
  try {
    return await run();
  } catch (err) {
    logBestEffortFailure(label, err);
    return fallback;
  }
}

/**
 * The exception boundary for a route's one primary domain mutation (docs/adr/0022
 * §Route Handler Exception Boundary) — every expected RPC failure (a resolved
 * `{ error }`) is re-sanitized via `rpcErrorJson` exactly as before, and an
 * unexpected rejection (a thrown error, a network failure surfacing as a rejected
 * promise rather than a resolved error result) is now ALSO caught here and turned
 * into the same stable, sanitized non-2xx JSON response — never an uncontrolled
 * framework error response, and never a raw provider/transport message. This must
 * only ever wrap the call that performs the durable mutation itself; everything
 * that runs after a successful result uses `bestEffort` instead, so a failure there
 * can never retroactively turn an already-durable success into an error response.
 */
export async function callMutationRpc<T>(
  client: SupabaseClient,
  rpcName: string,
  params: Record<string, unknown>
): Promise<{ ok: true; data: T } | { ok: false; response: NextResponse }> {
  try {
    const { data, error } = await client.rpc(rpcName, params);
    if (error) return { ok: false, response: rpcErrorJson(error.message) };
    return { ok: true, data: data as T };
  } catch (err) {
    logBestEffortFailure(rpcName, err);
    return { ok: false, response: errorJson("unexpected_error", "Something went wrong. Please try again.", 500) };
  }
}

/** Parses a JSON request body, failing closed (never throwing) on malformed input. */
export async function readJsonBody(request: Request): Promise<{ ok: true; value: unknown } | { ok: false; response: NextResponse }> {
  try {
    return { ok: true, value: await request.json() };
  } catch {
    return { ok: false, response: errorJson("invalid_input", "Malformed request body.", 400) };
  }
}

export type AppOriginResolution =
  | { status: "configured"; origin: string }
  | { status: "not_configured" }
  | { status: "invalid"; reason: string };

function isPermittedLocalDevHostname(hostname: string): boolean {
  // `URL#hostname` for the IPv6 loopback address is bracketed in this runtime
  // ("[::1]") — both forms are accepted defensively in case that ever differs.
  return hostname === "localhost" || hostname === "127.0.0.1" || hostname === "::1" || hostname === "[::1]";
}

/**
 * Resolves the ONE explicitly configured, server-only canonical origin
 * server-authored email links are built from (docs/adr/0022 §Canonical Email Link
 * Origin — third correction pass). This is deliberately never derived from an
 * incoming request's URL/Host/forwarded-host header: those are attacker- or
 * proxy-influenced input, and an invitation/Admin-Request link carries a raw
 * one-time secret, so the link's own origin is a security boundary, not cosmetic
 * URL formatting. Accepts an explicit override so tests never need real environment
 * variables; production call sites omit the argument and get the literal
 * `APP_ORIGIN` value. `APP_ORIGIN` is intentionally not a `NEXT_PUBLIC_*` variable —
 * it is read only from this server-only Route Handler code, never bundled into the
 * browser.
 */
export function resolveAppOriginConfig(rawOrigin: string | undefined = process.env.APP_ORIGIN): AppOriginResolution {
  const value = (rawOrigin ?? "").trim();
  if (value === "") {
    return { status: "not_configured" };
  }
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return { status: "invalid", reason: "APP_ORIGIN is not a valid URL." };
  }
  if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
    return { status: "invalid", reason: "APP_ORIGIN must use the http or https scheme." };
  }
  if (parsed.protocol === "http:" && !isPermittedLocalDevHostname(parsed.hostname)) {
    return {
      status: "invalid",
      reason: "APP_ORIGIN may only use http for localhost/127.0.0.1/::1 — a production origin must use https.",
    };
  }
  // Must be exactly a bare origin — no path, query, fragment, or embedded
  // credentials. `URL#origin` never includes userinfo/path/query/fragment, so
  // requiring an exact match against the raw configured value rejects all of
  // those in one check, rather than inspecting each component separately.
  if (parsed.origin !== value) {
    return {
      status: "invalid",
      reason: "APP_ORIGIN must be a bare origin (scheme://host[:port]) with no path, query, fragment, or credentials.",
    };
  }
  return { status: "configured", origin: parsed.origin };
}

/**
 * Builds an emailed accept-link URL from the one explicitly configured canonical
 * app origin — see `resolveAppOriginConfig`. This app has no server-side routing
 * (docs/adr/0009) — invitation/admin-request accept links point back at the single
 * root page with a query parameter TrackerApp reads on mount, never a dedicated
 * Next.js page route, so this feature doesn't introduce one.
 *
 * Returns `null` when the canonical origin is absent or invalid. Every call site
 * MUST treat a `null` result as "cannot send this email right now" — never fall back
 * to the incoming request's own origin, and never fabricate delivery success
 * (docs/adr/0022 §Canonical Email Link Origin).
 */
export function buildAcceptUrl(param: string, value: string): string | null {
  const resolution = resolveAppOriginConfig();
  if (resolution.status !== "configured") return null;
  return `${resolution.origin}/?${param}=${encodeURIComponent(value)}`;
}

/** Best-effort display name for the acting admin, for email copy only ("X invited you
 * to..."). Never fails the calling route if it can't be resolved (a resolved
 * `{ error }` OR a rejected promise) — a null inviter name just falls back to a
 * generic "A Team Admin" in the email copy (see buildTeamInvitationEmail/
 * buildAdminRequestEmail). */
export async function fetchMyDisplayName(client: SupabaseClient): Promise<string | null> {
  return bestEffort("get_my_profile", null, async () => {
    const { data, error } = await client.rpc("get_my_profile");
    if (error || !data) return null;
    const row = Array.isArray(data) ? data[0] : data;
    return (row?.display_name as string | null) ?? null;
  });
}

/** Best-effort team name for email copy. Never fails the calling route (a resolved
 * `{ error }` OR a rejected promise) — a missing name just falls back to a short
 * placeholder in the email copy. */
export async function fetchTeamName(client: SupabaseClient, teamId: string): Promise<string | null> {
  return bestEffort("fetch team name", null, async () => {
    const { data, error } = await client.from("teams").select("name").eq("id", teamId).maybeSingle();
    if (error || !data) return null;
    return (data.name as string | null) ?? null;
  });
}

/** Best-effort lookup of a team's active member emails, for the two routes that need
 * one member's email for a notification (create_admin_request, remove_member). Never
 * fails the calling route (a resolved `{ error }` OR a rejected promise) — an empty
 * result simply means no email can be found for the target member, and the caller
 * already treats a missing email as "cannot send right now," never as a route
 * failure. */
export async function fetchTeamMemberEmailsBestEffort(
  client: SupabaseClient,
  teamId: string
): Promise<Array<{ membership_id: string; email: string }>> {
  return bestEffort("get_team_member_emails", [], async () => {
    const { data, error } = await client.rpc("get_team_member_emails", { p_team_id: teamId });
    if (error || !data) return [];
    return data as Array<{ membership_id: string; email: string }>;
  });
}

/**
 * Records an email-delivery outcome as best-effort bookkeeping, distinct from the
 * durable domain mutation and the email send itself (docs/adr/0022 §Email
 * Configuration Hardening: "response semantics must distinguish the durable
 * mutation outcome from email delivery outcome"). By the time this runs, both the
 * mutation and the send attempt have already completed — a failure recording the
 * outcome (a resolved `{ error }` OR a rejected promise) must never roll back
 * either, and must never leak internal detail to the caller; it is only logged
 * server-side for operational diagnosis.
 */
export async function recordDeliveryBestEffort(
  client: SupabaseClient,
  rpcName: "record_invitation_email_delivery" | "record_admin_request_email_delivery",
  params: Record<string, unknown>
): Promise<void> {
  await bestEffort<void>(rpcName, undefined, async () => {
    const { error } = await client.rpc(rpcName, params);
    if (error) {
      logBestEffortFailure(rpcName, error);
    }
  });
}
