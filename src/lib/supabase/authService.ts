// Pure contract for authentication operations — deliberately contains no
// `@supabase/supabase-js` import. UI and controller code depend only on this
// interface; the real implementation (supabaseAuthService.ts) and any test
// fake are injected, mirroring the TimingProvider/TimingResult boundary
// discipline in src/lib/timingProvider.ts (see ADR-0006): a test stand-in
// must implement this same contract, never a shortcut that feeds a
// different code path.

/** The minimum stable identity the rest of the app is allowed to see. Never
 * the full provider session, an access/refresh token, or the raw provider
 * user object. */
export type AccountIdentity = {
  accountScopeId: string;
  email: string | null;
};

export type NormalizedAuthErrorKind =
  | "invalid_input"
  | "request_failed"
  | "verification_failed"
  | "session_restore_failed"
  | "sign_out_failed"
  | "invalid_configuration"
  | "temporarily_unavailable"
  | "unexpected_error";

/** A user-facing message only — never a raw provider error, stack trace, or
 * internal request identifier. */
export type NormalizedAuthError = {
  kind: NormalizedAuthErrorKind;
  message: string;
};

export type AuthServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: NormalizedAuthError };

export function authOk<T>(value: T): AuthServiceResult<T> {
  return { ok: true, value };
}

export function authFailed<T>(error: NormalizedAuthError): AuthServiceResult<T> {
  return { ok: false, error };
}

/**
 * Narrow boundary the auth controller depends on. Every method resolves —
 * never rejects/throws — with a typed result, the same never-throw
 * discipline `src/lib/persistence/types.ts` establishes for storage.
 */
export interface AuthService {
  getSession(): Promise<AuthServiceResult<AccountIdentity | null>>;
  /** Subscribes to provider auth-state changes; returns an unsubscribe function. */
  onAuthChange(listener: (identity: AccountIdentity | null) => void): () => void;
  requestEmailOtp(email: string): Promise<AuthServiceResult<void>>;
  verifyEmailOtp(email: string, token: string): Promise<AuthServiceResult<AccountIdentity>>;
  signOut(): Promise<AuthServiceResult<void>>;
}
