// The other of the two production files permitted to import
// `@supabase/supabase-js` (the other is supabaseClient.ts). This is the only
// place `signInWithOtp`/`verifyOtp`/`getSession`/`onAuthStateChange`/
// `signOut` are called. Every method resolves — never throws — and nothing
// past this boundary ever sees a raw provider error, an access/refresh
// token, or the full session — only `AccountIdentity` (authService.ts) and a
// normalized, static, user-facing error message.
import type { AuthChangeEvent, Session } from "@supabase/supabase-js";
import { getSupabaseBrowserClient } from "./supabaseClient";
import type { ConfiguredCloudConfig } from "./config";
import type {
  AccountIdentity,
  AuthService,
  AuthServiceResult,
  NormalizedAuthError,
  NormalizedAuthErrorKind,
} from "./authService";
import { authFailed, authOk } from "./authService";

const FRIENDLY_MESSAGE: Record<NormalizedAuthErrorKind, string> = {
  invalid_input: "That doesn't look right — check the value and try again.",
  request_failed: "We couldn't send the code. Please try again.",
  verification_failed: "That code didn't work. Check it and try again.",
  session_restore_failed: "We couldn't restore your sign-in. Please sign in again.",
  sign_out_failed: "Sign-out didn't complete. Please try again.",
  invalid_configuration: "Cloud sign-in isn't configured correctly.",
  temporarily_unavailable: "Cloud sign-in is temporarily unavailable. Please try again shortly.",
  unexpected_error: "Something went wrong. Please try again.",
};

function normalizedError(kind: NormalizedAuthErrorKind): NormalizedAuthError {
  return { kind, message: FRIENDLY_MESSAGE[kind] };
}

/** The only place a provider `Session`/`User` is read — reduced immediately
 * to the minimum stable identity, never passed upward as-is. */
function toIdentity(session: Session | null): AccountIdentity | null {
  if (!session || !session.user) return null;
  return {
    accountScopeId: session.user.id,
    email: session.user.email ?? null,
  };
}

export function createSupabaseAuthService(config: ConfiguredCloudConfig): AuthService {
  const client = getSupabaseBrowserClient(config);

  return {
    async getSession(): Promise<AuthServiceResult<AccountIdentity | null>> {
      try {
        const { data, error } = await client.auth.getSession();
        if (error) {
          return authFailed(normalizedError("session_restore_failed"));
        }
        return authOk(toIdentity(data.session));
      } catch {
        return authFailed(normalizedError("temporarily_unavailable"));
      }
    },

    onAuthChange(listener: (identity: AccountIdentity | null) => void): () => void {
      const { data } = client.auth.onAuthStateChange(
        (_event: AuthChangeEvent, session: Session | null) => {
          listener(toIdentity(session));
        }
      );
      // Idempotent regardless of whether the provider's own unsubscribe is
      // (real Supabase subscriptions tolerate a repeat call, but this
      // doesn't rely on that) - a caller invoking cleanup twice must not
      // reach the provider twice.
      let unsubscribed = false;
      return () => {
        if (unsubscribed) return;
        unsubscribed = true;
        data.subscription.unsubscribe();
      };
    },

    async requestEmailOtp(email: string): Promise<AuthServiceResult<void>> {
      try {
        const { error } = await client.auth.signInWithOtp({ email });
        if (error) {
          return authFailed(normalizedError("request_failed"));
        }
        return authOk(undefined);
      } catch {
        return authFailed(normalizedError("temporarily_unavailable"));
      }
    },

    async verifyEmailOtp(email: string, token: string): Promise<AuthServiceResult<AccountIdentity>> {
      try {
        const { data, error } = await client.auth.verifyOtp({ email, token, type: "email" });
        const identity = error ? null : toIdentity(data.session);
        if (!identity) {
          return authFailed(normalizedError("verification_failed"));
        }
        return authOk(identity);
      } catch {
        return authFailed(normalizedError("temporarily_unavailable"));
      }
    },

    async signOut(): Promise<AuthServiceResult<void>> {
      try {
        // "local" scope: sign out only this session, not every device the
        // account is signed in on — see @supabase/auth-js's own signOut()
        // guidance for what most apps want from a sign-out button.
        const { error } = await client.auth.signOut({ scope: "local" });
        if (error) {
          return authFailed(normalizedError("sign_out_failed"));
        }
        return authOk(undefined);
      } catch {
        return authFailed(normalizedError("temporarily_unavailable"));
      }
    },
  };
}
