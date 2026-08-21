// Normalized result type for every Team domain/service operation — mirrors
// src/lib/supabase/authService.ts's AuthServiceResult discipline: a service method
// resolves, never throws/rejects, and never leaks a raw provider/Postgres error message
// to the UI (requirement 23).

export type TeamErrorKind =
  | "invalid_input"
  | "forbidden"
  | "not_found"
  | "already_exists"
  | "conflict"
  | "expired"
  | "revoked"
  | "replaced"
  | "already_accepted"
  | "wrong_email"
  | "wrong_nominee"
  | "last_admin_invariant"
  | "archived_team"
  | "not_configured"
  | "network_error"
  | "unexpected_error";

export type TeamError = {
  kind: TeamErrorKind;
  message: string;
};

export type TeamResult<T> = { ok: true; value: T } | { ok: false; error: TeamError };

export function teamOk<T>(value: T): TeamResult<T> {
  return { ok: true, value };
}

export function teamFailed<T>(kind: TeamErrorKind, message: string): TeamResult<T> {
  return { ok: false, error: { kind, message } };
}
