// The provider-session storage integration — Stage M3b3 (docs/MOBILE_APP_MIGRATION.md
// Stage M3b0 §4, ADR-0049; user decision **S2**, 2026-09-30).
//
// This is the object handed to the Supabase SDK's `storage` option on native. It
// does three things and refuses to do a fourth:
//
//   1. It routes every key the SDK asks for into the fixed application-owned
//      protected namespace, **byte-for-byte**. No JSON normalisation, no
//      truncation, no interpretation of a credential as domain data.
//   2. It turns a storage failure into a REJECTION, so the SDK cannot conclude
//      "no session" from a store it could not read.
//   3. It records the same failure in a normalised, application-owned channel
//      that the identity layer consumes **independently of the SDK**, because
//      the SDK does not reliably surface one (see "Why (2) is not enough").
//
// What it does not do: it never decides whether anyone is signed in. The access
// barrier is the latch (ADR-0025), and a credential — present, absent, or
// unreadable — never grants workspace access by itself.
//
// ## Absence is never inferred
//
// An earlier revision inferred absence from a separate readability marker: if a
// marker key read back, an ambiguous empty read of another key became "no
// session". **That inference was invalid and is removed, along with the marker.**
// Reading one key successfully establishes nothing about another key — an
// item-specific read or decoding failure, or a transient failure followed by a
// successful marker read, produces the identical observation.
//
// `null` is now returned to the SDK **only** for a `SecureCredentialStore` result
// of `{status: "absent"}`, which that contract defines as positively established
// by the platform. Every other outcome rejects. Nothing here writes a probe, so
// no failure path can have left a marker behind.
//
// ## Which keys the SDK actually uses
//
// Audited in the INSTALLED `@supabase/auth-js` 2.112.3, not assumed. With
// `storageKey` defaulting to `sb-<url-host-first-label>-auth-token`
// (`@supabase/supabase-js` `SupabaseClient`), the SDK addresses:
//
//   - `<storageKey>`                                — the session (GoTrueClient
//     `__loadSession`, `_saveSession`, `_removeSession`);
//   - `<storageKey>-code-verifier`                  — the fixed legacy PKCE
//     verifier, written on every flow start as a deprecation-window dual write
//     (`lib/helpers.js` `storePKCEVerifier`);
//   - `<storageKey>-flow-<flowId>-code-verifier`    — one slot PER FLOW,
//     `flowId` generated at runtime (`pkceVerifierSlotKey`). **Unbounded in
//     name**, ring-evicted in count;
//   - `<storageKey>-flows-code-verifier`            — the slot index, a JSON
//     array (`pkceFlowIndexKey`);
//   - `<storageKey>-user`                           — read by
//     `_recoverAndRefresh` and removed by `_removeSession` even though
//     `userStorage` is NOT configured here.
//
// So this integration must accept **any** key the SDK passes. An allow-list of
// one assumed session key would silently drop verifier slots and break Google
// sign-in; a prefix match on `<storageKey>` alone would still have missed the
// `-user` read. The namespace is applied by the store, and the key is passed
// through unmodified.
//
// ## Why (2) is not enough on its own
//
// Rejecting from `getItem` does propagate: `getItemAsync` → `__loadSession`
// (which has `try/finally`, no `catch`) → `_useSession` → `getSession()`
// rejects. But the SDK converts a storage fault into a clean "no session" in two
// further ways: `getItemAsync` treats a RESOLVED falsy value — or one that fails
// `JSON.parse` — as absence with no error at all, and `initialize()` catches
// everything `_initialize()` throws and returns it as a result this application
// never reads (`_emitInitialSession` is started from the constructor and awaited
// by nobody, so its failures surface as unhandled rejections).
//
// So the verdict below is **consumed by `supabaseAuthService`**, which refuses to
// report `no_session` or a successful sign-out while a credential failure stands.
// That is the integration, not this getter's existence.
import {
  SECURE_CREDENTIAL_NAMESPACE,
  type SecureCredentialStore,
} from "../persistence/secureCredentialStore";

/** The namespace every credential item lives under, re-exported so callers and
 * tests can assert isolation without importing the store's internals. */
export { SECURE_CREDENTIAL_NAMESPACE };

/**
 * The normalised, application-owned failure channel. Fixed categories only — no
 * platform text, no key name, no value fragment.
 *
 * `absence_not_established` is kept distinct from `read_failed` because it is
 * the category the installed native bindings actually produce, and conflating it
 * with a transient read error would hide why the native path is closed.
 */
export type CredentialStorageFailure =
  | { kind: "store_unavailable" }
  | { kind: "read_failed" }
  | { kind: "absence_not_established" }
  | { kind: "write_failed" }
  | { kind: "removal_failed" };

/**
 * What establishment could determine.
 *
 * `established` means the store answered a real read CONCLUSIVELY — a value, or
 * a positively established absence — and that no failure has been recorded. It
 * says nothing about whether a session exists.
 */
export type CredentialStoreEstablishment =
  | { status: "established"; sessionPresent: boolean }
  | { status: "unavailable"; failure: CredentialStorageFailure };

/**
 * The SDK's `SupportedStorage` shape, declared locally.
 *
 * Declared rather than imported so this module carries no `@supabase/supabase-js`
 * import — the SDK boundary is enforced to three files
 * (`__tests__/architectureBoundary.test.ts`) and this is not one of them. The
 * three members are all the SDK ever calls on a custom storage
 * (`lib/helpers.js` `getItemAsync`/`setItemAsync`/`removeItemAsync`).
 */
export interface SupportedStorageLike {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface ProviderCredentialStorageIntegration {
  /** Handed to `createClient`'s `auth.storage` option. */
  readonly storage: SupportedStorageLike;
  /**
   * Proves the store answers conclusively, by performing ONE real read of the
   * SDK's own session key. Must be awaited BEFORE the Supabase client is
   * constructed: the SDK reads storage from its own constructor.
   *
   * It writes nothing. An earlier revision wrote a marker here, which both made
   * an invalid absence inference possible and meant a "failed" establishment
   * could already have modified the store — so "nothing has been changed" could
   * not be said truthfully. Neither is true now.
   *
   * **A recorded failure is not silently cleared.** If one already stands, this
   * reports `unavailable` with it rather than returning `established` over an
   * unresolved latch.
   */
  establish(): Promise<CredentialStoreEstablishment>;
  /**
   * The sticky verdict. Non-null once any operation has failed, and it STAYS
   * non-null: a later successful read does not retract it, because the
   * application cannot know what the failed operation would have said.
   *
   * Consumed by `supabaseAuthService` so that a credential fault cannot be
   * reported as a clean signed-out state or a completed sign-out.
   */
  observedFailure(): CredentialStorageFailure | null;
  /**
   * Notifies on the FIRST recorded failure. Returns an unsubscribe function.
   *
   * This exists because the most dangerous failures happen inside the SDK's own
   * constructor-time initialisation, which no application call site awaits.
   */
  subscribe(listener: (failure: CredentialStorageFailure) => void): () => void;
}

/**
 * The SDK's session key, which is the one key establishment reads.
 *
 * Supplied by the caller rather than recomputed here: it is derived from the
 * configured Supabase URL by `SupabaseClient` (`sb-<first-host-label>-auth-token`),
 * and re-deriving it in a second place is how the two drift apart.
 */
export type ProviderCredentialStorageOptions = {
  sessionStorageKey: string;
};

/**
 * The SDK's default session storage key for a configured project URL.
 *
 * `SupabaseClient` computes `sb-${new URL(url).hostname.split(".")[0]}-auth-token`
 * and this mirrors it, because establishment has to read a key the SDK will
 * actually use. Mirroring SDK-internal logic is a drift risk, so it is pinned
 * against the REAL installed SDK by a compatibility test rather than trusted:
 * a client is constructed over a recording storage and the key it writes is
 * compared with this function's output.
 *
 * Returns `null` for a URL that cannot be parsed or yields no label, so a caller
 * fails closed instead of reading a fabricated key.
 */
export function providerSessionStorageKey(url: string): string | null {
  let hostname: string;
  try {
    hostname = new URL(url).hostname;
  } catch {
    return null;
  }
  const label = hostname.split(".")[0];
  if (typeof label !== "string" || label.length === 0) return null;
  return `sb-${label}-auth-token`;
}

/**
 * A fixed message for the error the SDK receives. It names what failed and
 * carries nothing else — no key, no value, no platform text. The SDK may log or
 * wrap a thrown value (`AuthUnknownError` embeds it), so it must be safe to see.
 */
const REJECTION_MESSAGE = "Protected credential storage is unavailable.";

class CredentialStorageError extends Error {
  constructor() {
    super(REJECTION_MESSAGE);
    this.name = "CredentialStorageError";
  }
}

/** Maps a store failure onto the application-owned category. */
function readFailureFor(
  kind: "store_unavailable" | "store_inaccessible" | "entry_unreadable" | "absence_not_established"
): CredentialStorageFailure {
  switch (kind) {
    case "store_unavailable":
      return { kind: "store_unavailable" };
    case "absence_not_established":
      return { kind: "absence_not_established" };
    default:
      // `store_inaccessible` and `entry_unreadable` are both "could not read
      // this item", which is what the caller needs to act on.
      return { kind: "read_failed" };
  }
}

export function createProviderCredentialStorage(
  store: SecureCredentialStore,
  options: ProviderCredentialStorageOptions
): ProviderCredentialStorageIntegration {
  let observed: CredentialStorageFailure | null = null;
  const listeners = new Set<(failure: CredentialStorageFailure) => void>();

  function latch(failure: CredentialStorageFailure): CredentialStorageFailure {
    // First failure wins. Overwriting it would let a benign later category hide
    // the one that actually mattered.
    if (observed !== null) return observed;
    observed = failure;
    for (const listener of [...listeners]) {
      try {
        listener(failure);
      } catch {
        // One consumer cannot prevent another from observing the failure, and a
        // listener must never break a storage operation.
      }
    }
    return failure;
  }

  const storage: SupportedStorageLike = {
    async getItem(key: string): Promise<string | null> {
      const result = await store.read(key);
      if (result.status === "value") return result.value;
      if (result.status === "absent") {
        // The ONLY path to a `null` the SDK reads as "no session", and the store
        // contract defines it as positively established by the platform.
        return null;
      }
      latch(readFailureFor(result.error.kind));
      throw new CredentialStorageError();
    },

    async setItem(key: string, value: string): Promise<void> {
      const result = await store.write(key, value);
      if (result.ok) return;
      latch(
        result.error.kind === "store_unavailable"
          ? { kind: "store_unavailable" }
          : { kind: "write_failed" }
      );
      throw new CredentialStorageError();
    },

    async removeItem(key: string): Promise<void> {
      const result = await store.remove(key);
      // `nothing_to_delete_reported` is a success — removal is idempotent — but
      // it is NOT proof the bytes are gone (see `SecureCredentialRemoveResult`).
      // It is not latched as a failure, because nothing here can tell "was never
      // there" from "Android alias already gone, ciphertext retained", and
      // claiming the stronger of the two would be the false success this
      // boundary exists to avoid.
      if (result.ok) return;
      latch(
        result.error.kind === "store_unavailable"
          ? { kind: "store_unavailable" }
          : { kind: "removal_failed" }
      );
      throw new CredentialStorageError();
    },
  };

  return {
    storage,

    async establish(): Promise<CredentialStoreEstablishment> {
      // An unresolved failure is never silently stepped over. Recovery is a new
      // document, not a second establishment attempt — see the composition's
      // ownership model.
      if (observed !== null) return { status: "unavailable", failure: observed };

      const stored = await store.read(options.sessionStorageKey);
      if (stored.status === "read_failed") {
        return {
          status: "unavailable",
          failure: latch(readFailureFor(stored.error.kind)),
        };
      }
      // A conclusive answer either way. Nothing was written.
      return { status: "established", sessionPresent: stored.status === "value" };
    },

    observedFailure(): CredentialStorageFailure | null {
      return observed;
    },

    subscribe(listener): () => void {
      listeners.add(listener);
      // A failure recorded before subscription is still delivered, so a late
      // subscriber cannot miss the one that matters.
      if (observed !== null) {
        try {
          listener(observed);
        } catch {
          /* as above */
        }
      }
      return () => {
        listeners.delete(listener);
      };
    },
  };
}
