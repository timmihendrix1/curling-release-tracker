// Every Team Foundation Postgres RPC (supabase/migrations/20260820120200_team_foundation_functions.sql)
// raises expected failures as `'<kind>: <message>'`, where `<kind>` is one of this
// module's `TeamErrorKind` values. This is the one place that convention is parsed
// back into a `TeamError` on the client/server-route side — never a raw passthrough
// of a Postgres/PostgREST error message, which could otherwise leak schema details,
// constraint names, or other internal information (requirement 23).
import { type TeamErrorKind } from "./errors";

const KNOWN_KINDS: ReadonlySet<TeamErrorKind> = new Set<TeamErrorKind>([
  "invalid_input",
  "forbidden",
  "not_found",
  "already_exists",
  "conflict",
  "expired",
  "revoked",
  "replaced",
  "already_accepted",
  "wrong_email",
  "wrong_nominee",
  "last_admin_invariant",
  "archived_team",
  "not_configured",
  "network_error",
  "unexpected_error",
]);

const GENERIC_MESSAGE = "Something went wrong. Please try again.";

/**
 * Parses a raw Postgres/PostgREST error message into a `{ kind, message }` pair.
 * Anything not matching the exact `'<known-kind>: <text>'` shape — including a
 * genuine, unhandled database error, a permission-denied message from a revoked
 * grant, or a constraint-violation message — resolves to `unexpected_error` with a
 * generic, non-leaking message. This is a fail-closed default: an attacker cannot
 * get a more specific error out of the system by causing an unexpected failure.
 */
export function parsePostgresErrorMessage(rawMessage: string | null | undefined): {
  kind: TeamErrorKind;
  message: string;
} {
  if (!rawMessage) {
    return { kind: "unexpected_error", message: GENERIC_MESSAGE };
  }
  const separatorIndex = rawMessage.indexOf(":");
  if (separatorIndex <= 0) {
    return { kind: "unexpected_error", message: GENERIC_MESSAGE };
  }
  const candidateKind = rawMessage.slice(0, separatorIndex).trim();
  if (!KNOWN_KINDS.has(candidateKind as TeamErrorKind)) {
    return { kind: "unexpected_error", message: GENERIC_MESSAGE };
  }
  const message = rawMessage.slice(separatorIndex + 1).trim();
  return { kind: candidateKind as TeamErrorKind, message: message.length > 0 ? message : GENERIC_MESSAGE };
}
