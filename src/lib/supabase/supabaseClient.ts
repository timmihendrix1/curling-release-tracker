// One of the three production files permitted to import @supabase/supabase-js -
// this lazy browser-client factory, the auth-service implementation built on it
// (supabaseAuthService.ts), and the server-only, per-request client the Team
// Route Handlers use (supabaseServerClient.ts). Enforced by the "supabase client
// boundary" describe block in
// src/lib/persistence/__tests__/architectureBoundary.test.ts. Construction is
// lazy and cached: nothing here runs at module-evaluation time, and this is
// never called unless config.ts has already resolved "configured" - avoiding
// eager client construction that could throw while importing modules.
import { AuthRetryableFetchError, createClient, type SupabaseClient } from "@supabase/supabase-js";
import type { ConfiguredCloudConfig } from "./config";

// Re-exported so other production modules (e.g. supabaseTeamService.ts) can name
// the client's type without importing "@supabase/supabase-js" directly themselves —
// keeping the SDK import confined to this file and supabaseAuthService.ts.
export type { SupabaseClient };

/**
 * The three auth options ADR-0025 Decision 10 makes non-negotiable for the one
 * browser client. Exported so the compatibility test can assert the exact
 * shape rather than restating it, and so a reviewer can read the contract in
 * one place.
 *
 * - `flowType: "pkce"` — the SDK defaults to `implicit`, which would return
 *   tokens in the URL fragment instead of an exchangeable code.
 * - `detectSessionInUrl: false` — the SDK defaults to `true`. Left on, it
 *   would consume a callback automatically, indistinguishably from an ordinary
 *   session restore, before any correlation could be checked. Turning it off
 *   is what moves callback detection and URL cleanup into application code
 *   (supabaseCallbackClassifier.ts / supabaseCallbackCapture.ts) — a
 *   deliberate cost accepted in exchange for making callback consumption an
 *   explicit, correlated operation.
 * - `experimental.appendPkceFlowIdToRedirects: true` — makes the provider
 *   round-trip a non-secret `sb_flow_id` selector back on the callback URL, so
 *   a return can be correlated to the attempt that produced it. Without it no
 *   selector travels through the redirect, and `exchangeCodeForSession` would
 *   have to fall back to "the most recently stored verifier" — which a stale
 *   callback could consume, destroying a newer valid attempt. This flag is
 *   therefore a hard dependency for Google sign-in, and the project's redirect
 *   allow list must tolerate the extra query parameter.
 */
export const BROWSER_AUTH_OPTIONS = {
  flowType: "pkce",
  detectSessionInUrl: false,
  experimental: { appendPkceFlowIdToRedirects: true },
} as const;

let cachedClient: SupabaseClient | null = null;
let cachedConfigKey: string | null = null;

// S5a: the explicit dormant AUTH host owns this slot before inspecting foreign
// options or touching migration. The capability never leaves that host. Neither
// test reset nor a failed/uncertain cleanup can release its live reservation.
let nativeAuthReservation: object | null = null;
const nativeConstructedRoots = new Set<string>();
export function reserveNativeAuthSdk(): Readonly<{
  current(): boolean;
  constructOnce(root: string): boolean;
  release(): void;
}> | null {
  if (nativeAuthReservation !== null || cachedClient !== null || claimedAuthStorage !== null || claimedCredentialHealth !== null) return null;
  const token = Object.freeze({});
  nativeAuthReservation = token;
  return Object.freeze({
    current: () => nativeAuthReservation === token,
    constructOnce(root: string) {
      if (nativeAuthReservation !== token || nativeConstructedRoots.has(root)) return false;
      nativeConstructedRoots.add(root);
      return true;
    },
    release() { if (nativeAuthReservation === token) nativeAuthReservation = null; },
  });
}

function configKey(config: ConfiguredCloudConfig): string {
  return JSON.stringify([config.url, config.publishableKey]);
}

/**
 * The credential-storage ownership slot (Stage M3b3; ADR-0049 decision 4).
 *
 * The SDK reads storage from its OWN CONSTRUCTOR — `GoTrueClient.initialize()`
 * runs `_recoverAndRefresh()`, which reads `<storageKey>` — so where credentials
 * live is decided once, before the client exists, or not at all. There is no
 * "change the storage afterwards": a client that already restored a session from
 * `localStorage` would not retroactively move it.
 *
 * Hence the claim below rather than a parameter on `getSupabaseBrowserClient`.
 * A parameter would let two consumers ask for two different stores and get
 * whichever won the race, which is precisely the split-authority outcome
 * ADR-0049 rejects. Claiming is therefore:
 *
 *   - refused once a client exists (`client_already_constructed`);
 *   - refused when a DIFFERENT storage was already claimed (`already_claimed`);
 *   - idempotent for the same storage object, so a replayed effect is not a
 *     conflict.
 *
 * Unclaimed — the Web build, and every build in this stage — means the SDK keeps
 * its own `window.localStorage` default, exactly as before. ADR-0025
 * Decision 10's three options are untouched either way: the claim adds `storage`
 * and changes nothing else.
 */
export type AuthStorageClaimResult =
  | { ok: true }
  | { ok: false; reason: "client_already_constructed" | "already_claimed" };

/** The three members the SDK calls on a custom storage. Declared structurally so
 * this file does not need the SDK's `SupportedStorage` type import. */
type BrowserAuthStorage = {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
};

/**
 * The credential-health accessor claimed alongside the storage.
 *
 * It is claimed HERE, in the same call, because the two are one decision: the
 * module that decides where credentials live is the module that knows whether
 * that store has failed, and `supabaseAuthService` needs the second fact to
 * avoid reporting a storage fault as a clean signed-out state. Splitting them
 * would allow a client built on a custom storage whose health nobody can see.
 *
 * Returning a non-null value means "a credential failure has been recorded and
 * is unresolved". It is NOT an authorization signal: the access barrier decides
 * admission (ADR-0025), and this only prevents a false `no_session` or a false
 * completed sign-out.
 */
export type BrowserCredentialHealth = () => { kind: string } | null;

export type NativeCredentialSettlementResult =
  | { readonly ok: false; readonly reason: "invalid_dependency" }
  | { readonly ok: true; readonly value: Readonly<{ storage: BrowserAuthStorage; failed(): boolean }> };
const nativeApply = Reflect.apply;
const nativePromiseThen = Promise.prototype.then;
function observeStorageDependency(candidate: unknown): Promise<unknown> {
  return new Promise((resolve, reject) => {
    try { nativeApply(nativePromiseThen, candidate, [resolve, reject]); }
    catch { void new Promise<unknown>(done => { done(candidate); }).then(resolve, reject); }
  });
}

/** Dormant SDK settlement binding, NOT native auth composition. Storage and
 * health must belong to one owner/integration. This fixed SDK error is a private
 * settlement signal; it never reclassifies the real fault as a network outage.
 * Provider-owned observable async returns only (S2 C4); poisoned constructors/
 * species and otherwise orphaned rejections remain the provider's responsibility.
 */
export function createNativeCredentialSettlementStorage(storage: unknown, health: unknown): NativeCredentialSettlementResult {
  let read: (...args: never[]) => unknown, write: (...args: never[]) => unknown, remove: (...args: never[]) => unknown;
  try {
    if (typeof storage !== "object" || storage === null || Array.isArray(storage) || typeof health !== "function") throw null;
    const supplied = storage as Record<string, unknown>;
    const get = supplied.getItem, set = supplied.setItem, del = supplied.removeItem;
    if (typeof get !== "function" || typeof set !== "function" || typeof del !== "function") throw null;
    read = get as typeof read; write = set as typeof write; remove = del as typeof remove;
  } catch { return Object.freeze({ ok: false, reason: "invalid_dependency" }); }
  let terminal = false;
  function healthy(): boolean {
    if (terminal) return false;
    let result: unknown;
    try { result = nativeApply(health as (...args: never[]) => unknown, undefined, []); }
    catch { terminal = true; return false; }
    if (result !== null) {
      terminal = true; // latch BEFORE any assimilation can reenter the binding
      if ((typeof result === "object" && result !== null) || typeof result === "function") {
        void observeStorageDependency(result).then(() => {}, () => {});
      }
      return false;
    }
    return !terminal; // a reentrant health callback may have faulted us
  }
  async function operate(method: typeof read, args: unknown[], reading: boolean): Promise<unknown> {
    try {
      if (!healthy()) throw null;
      const result = await observeStorageDependency(nativeApply(method, storage, args));
      // Known malformed acknowledgements fault BEFORE any external callback
      // can reenter and issue another operation on this binding.
      if (reading ? result !== null && typeof result !== "string" : result !== undefined) throw null;
      if (!healthy()) throw null;
      return result;
    } catch {
      terminal = true;
      throw new AuthRetryableFetchError("Credential storage unavailable", 503);
    }
  }
  const bound: BrowserAuthStorage = Object.freeze({
    async getItem(key: string) { return await operate(read, [key], true) as string | null; },
    async setItem(key: string, value: string) { await operate(write, [key, value], false); },
    async removeItem(key: string) { await operate(remove, [key], false); },
  });
  return Object.freeze({ ok: true, value: Object.freeze({ storage: bound, failed: () => terminal }) });
}

let claimedAuthStorage: BrowserAuthStorage | null = null;
let claimedCredentialHealth: BrowserCredentialHealth | null = null;

export function claimBrowserAuthStorage(
  storage: BrowserAuthStorage,
  health: BrowserCredentialHealth
): AuthStorageClaimResult {
  if (nativeAuthReservation !== null) return { ok: false, reason: "already_claimed" };
  if (claimedAuthStorage !== null) {
    return claimedAuthStorage === storage ? { ok: true } : { ok: false, reason: "already_claimed" };
  }
  if (cachedClient !== null) {
    return { ok: false, reason: "client_already_constructed" };
  }
  claimedAuthStorage = storage;
  claimedCredentialHealth = health;
  return { ok: true };
}

/** Which storage the next client will be built with, or `null` for the SDK
 * default. Exported for assertions; production code never branches on it. */
export function claimedBrowserAuthStorage(): BrowserAuthStorage | null {
  return claimedAuthStorage;
}

/**
 * The claimed credential-health accessor, or `null`.
 *
 * `null` is the Web build and every build in this stage: nothing claimed, so the
 * SDK keeps its own `window.localStorage` and `supabaseAuthService` has no extra
 * verdict to consult — its behaviour is byte-for-byte what it was.
 */
export function claimedBrowserCredentialHealth(): BrowserCredentialHealth | null {
  return claimedCredentialHealth;
}

/**
 * Returns the one browser Supabase client for the given configuration,
 * constructing it on first use. A later call with a different URL/key
 * replaces the cached client rather than returning a stale one - relevant
 * only to tests, since production configuration never changes at runtime.
 */
export function getSupabaseBrowserClient(config: ConfiguredCloudConfig): SupabaseClient {
  if (nativeAuthReservation !== null) throw new Error("Authentication ownership is reserved.");
  const key = configKey(config);
  if (cachedClient && cachedConfigKey === key) {
    return cachedClient;
  }
  // `storage: undefined` is what the SDK receives when nothing was claimed, and
  // it is indistinguishable from the option being absent — the Web build's
  // client is byte-for-byte the client it was before this stage.
  cachedClient = createClient(config.url, config.publishableKey, {
    auth: { ...BROWSER_AUTH_OPTIONS, storage: claimedAuthStorage ?? undefined },
  });
  cachedConfigKey = key;
  return cachedClient;
}

/**
 * Test-only escape hatch forcing the next call to construct a fresh client.
 * Production code never calls this.
 */
export function resetSupabaseBrowserClientForTests(): void {
  cachedClient = null;
  cachedConfigKey = null;
  claimedAuthStorage = null;
  claimedCredentialHealth = null;
}
