// @vitest-environment jsdom
//
// Direct tests for supabaseAuthService.ts — the one file (with
// supabaseClient.ts and the server-only supabaseServerClient.ts) permitted to
// call the real Supabase SDK. No network: the Supabase browser client itself
// is mocked at the narrow client boundary (getSupabaseBrowserClient), so
// createSupabaseAuthService runs its real classification/normalization logic
// against a fully controllable fake client, never a real SupabaseClient or a
// real Supabase project. The SDK's *error types* are the genuine ones, which
// is what makes the "typed predicates, never message text" claim testable.
//
// Nothing in this file claims that any outcome resolves an identity barrier or
// authorizes application entry — no barrier, attempt, resolution, or
// coordinator exists in Stage B0.2b.
import { beforeEach, describe, expect, it, vi } from "vitest";
import {
  AuthApiError,
  AuthRetryableFetchError,
  AuthSessionMissingError,
} from "@supabase/supabase-js";
import type { ConfiguredCloudConfig } from "../config";
import type {
  ClaimedCallback,
  NormalizedAuthChange,
  PreparedAuthorization,
} from "../authService";

const { fakeClient, getSupabaseBrowserClientMock } = vi.hoisted(() => {
  const fakeClient = {
    auth: {
      getSession: vi.fn(),
      onAuthStateChange: vi.fn(),
      signInWithOtp: vi.fn(),
      verifyOtp: vi.fn(),
      signOut: vi.fn(),
      signInWithOAuth: vi.fn(),
      exchangeCodeForSession: vi.fn(),
    },
  };
  return { fakeClient, getSupabaseBrowserClientMock: vi.fn(() => fakeClient) };
});

vi.mock("../supabaseClient", () => ({
  getSupabaseBrowserClient: getSupabaseBrowserClientMock,
}));

// Vitest hoists the vi.mock call above this static import too, so
// createSupabaseAuthService always sees the mocked ../supabaseClient.
import { createSupabaseAuthService } from "../supabaseAuthService";

const CONFIG: ConfiguredCloudConfig = {
  status: "configured",
  url: "https://x.supabase.co",
  publishableKey: "sb_publishable_" + "a".repeat(20),
};

const ACCESS_TOKEN = "fake-access-token-must-never-leak";
const REFRESH_TOKEN = "fake-refresh-token-must-never-leak";
const OTP_TOKEN = "654321";
const APP_ORIGIN = "https://app.example.test";
const CALLBACK_TARGET = `${APP_ORIGIN}/`;
const FLOW_ID = "a1b2c3d4e5f60718293a4b5c6d7e8f90";
const OTHER_FLOW_ID = "0f9e8d7c6b5a493827160f5e4d3c2b1a";
const AUTHORIZATION_CODE = "authorization-code-must-never-leak";

function fakeSession(overrides: { id?: string; email?: string | undefined } = {}) {
  return {
    access_token: ACCESS_TOKEN,
    refresh_token: REFRESH_TOKEN,
    token_type: "bearer",
    expires_in: 3600,
    user: {
      id: overrides.id ?? "user-1",
      email: overrides.email === undefined ? "a@example.com" : overrides.email,
      app_metadata: {},
      user_metadata: {},
      aud: "authenticated",
      created_at: "2024-01-01T00:00:00.000Z",
    },
  };
}

/**
 * The provider authorization URL the SDK would build for this config, with the
 * selector appended to `redirect_to` exactly as
 * `experimental.appendPkceFlowIdToRedirects` does — and with every
 * security-relevant part individually perturbable, so each negative case
 * changes exactly one thing.
 *
 * Query pieces are assembled as raw strings rather than through
 * `URLSearchParams`, because several cases need a DUPLICATED parameter, which a
 * map cannot express.
 */
type AuthorizationUrlOptions = {
  origin?: string;
  path?: string;
  /** `null` omits `provider` entirely. */
  provider?: string | null;
  /** `null` omits `sb_flow_id` from the redirect target. */
  flowId?: string | null;
  duplicateFlowId?: string;
  redirectTo?: string;
  omitRedirectTo?: boolean;
  duplicateRedirectTo?: boolean;
  /** `null` omits `code_challenge`. */
  codeChallenge?: string | null;
  /** `null` omits `code_challenge_method`. */
  codeChallengeMethod?: string | null;
  duplicateCodeChallenge?: boolean;
  fragment?: string;
};

function effectiveRedirectTarget(options: AuthorizationUrlOptions): string {
  const target = new URL(options.redirectTo ?? CALLBACK_TARGET);
  const flowId = options.flowId === undefined ? FLOW_ID : options.flowId;
  if (flowId !== null) target.searchParams.append("sb_flow_id", flowId);
  if (options.duplicateFlowId !== undefined) {
    target.searchParams.append("sb_flow_id", options.duplicateFlowId);
  }
  return target.toString();
}

function authorizationUrl(options: AuthorizationUrlOptions = {}): string {
  const base = options.origin ?? CONFIG.url;
  const path = options.path ?? "/auth/v1/authorize";
  const pieces: string[] = [];

  const provider = options.provider === undefined ? "google" : options.provider;
  if (provider !== null) pieces.push(`provider=${encodeURIComponent(provider)}`);

  if (!options.omitRedirectTo) {
    const target = encodeURIComponent(effectiveRedirectTarget(options));
    pieces.push(`redirect_to=${target}`);
    if (options.duplicateRedirectTo) pieces.push(`redirect_to=${target}`);
  }

  const challenge = options.codeChallenge === undefined ? "abc" : options.codeChallenge;
  if (challenge !== null) {
    pieces.push(`code_challenge=${encodeURIComponent(challenge)}`);
    if (options.duplicateCodeChallenge) pieces.push(`code_challenge=${encodeURIComponent(challenge)}`);
  }

  const method = options.codeChallengeMethod === undefined ? "s256" : options.codeChallengeMethod;
  if (method !== null) pieces.push(`code_challenge_method=${encodeURIComponent(method)}`);

  pieces.push("skip_http_redirect=true");
  return `${base}${path}?${pieces.join("&")}${options.fragment ?? ""}`;
}

function preparedFrom(options: AuthorizationUrlOptions = {}) {
  return { authorizationUrl: authorizationUrl(options), flowId: FLOW_ID };
}

function createService(overrides: { navigate?: (url: string) => void } = {}) {
  return createSupabaseAuthService(CONFIG, {
    resolveAppOrigin: () => APP_ORIGIN,
    navigate: overrides.navigate ?? (() => {}),
  });
}

/** A claim shaped exactly like the capture cell's — read-once code, and neither
 * the code NOR the non-secret selector present in its serialized form. */
function fakeClaim(
  options: { flowId?: string; code?: string | null } = {}
): ClaimedCallback {
  const flowId = options.flowId ?? FLOW_ID;
  let remaining: string | null = options.code === undefined ? AUTHORIZATION_CODE : options.code;
  const claim = {} as ClaimedCallback;
  Object.defineProperties(claim, {
    flowId: { value: flowId, enumerable: false },
    readAuthorizationCode: {
      value: (): string | null => {
        const value = remaining;
        remaining = null;
        return value;
      },
      enumerable: false,
    },
    toJSON: { value: (): Record<string, never> => ({}), enumerable: false },
  });
  return claim;
}

/** A deliberately hostile claim: every property access throws. Used to prove the
 * exchange boundary contains a throwing getter instead of rejecting. */
function throwingClaim(thrown: unknown, options: { onlyCodeReader?: boolean } = {}): ClaimedCallback {
  if (options.onlyCodeReader) {
    const claim = {} as ClaimedCallback;
    Object.defineProperties(claim, {
      flowId: { value: FLOW_ID, enumerable: false },
      readAuthorizationCode: {
        get() {
          throw thrown;
        },
        enumerable: false,
      },
    });
    return claim;
  }
  return new Proxy({} as ClaimedCallback, {
    get() {
      throw thrown;
    },
  });
}

/** A provider `Session` whose identity data cannot be read: the named property
 * is backed by a getter that throws. */
function sessionThrowingAt(at: "user" | "id" | "email", thrown: unknown): unknown {
  const boom = () => {
    throw thrown;
  };
  if (at === "user") return { access_token: ACCESS_TOKEN, get user() { return boom(); } };
  if (at === "id") return { access_token: ACCESS_TOKEN, user: { get id() { return boom(); } } };
  return {
    access_token: ACCESS_TOKEN,
    user: { id: "user-1", get email() { return boom(); } },
  };
}

/** A provider `Session` backed entirely by a hostile Proxy: every property read
 * throws, including the very first one. */
function proxySession(thrown: unknown): unknown {
  return new Proxy(
    {},
    {
      get() {
        throw thrown;
      },
      has() {
        throw thrown;
      },
    }
  );
}

/** A provider error whose own `has` trap throws — the SDK's typed predicates use
 * the `in` operator, so this is what an unclassifiable value looks like. */
function proxyError(thrown: unknown): unknown {
  return new Proxy(
    {},
    {
      has() {
        throw thrown;
      },
      get() {
        throw thrown;
      },
    }
  );
}

const HOSTILE_THROWN: Array<[string, unknown]> = [
  ["an Error", new Error("provider getter boom")],
  ["a non-Error string", "provider getter boom"],
  ["a Symbol", Symbol("provider getter boom")],
  ["null", null],
  ["undefined", undefined],
];

function captureListener() {
  const listeners: Array<(event: string, session: unknown) => void> = [];
  const unsubscribe = vi.fn();
  fakeClient.auth.onAuthStateChange.mockImplementation((listener) => {
    listeners.push(listener);
    return { data: { subscription: { unsubscribe } } };
  });
  return { emit: (event: string, session: unknown) => listeners.forEach((l) => l(event, session)), unsubscribe };
}

beforeEach(() => {
  vi.clearAllMocks();
  getSupabaseBrowserClientMock.mockImplementation(() => fakeClient);
  fakeClient.auth.onAuthStateChange.mockImplementation(() => ({
    data: { subscription: { unsubscribe: vi.fn() } },
  }));
});

describe("createSupabaseAuthService — restoreSession's five outcomes (ADR-0025 Decision 2)", () => {
  it("classifies a cached session as authenticated, carrying only the minimal identity", async () => {
    fakeClient.auth.getSession.mockResolvedValue({
      data: { session: fakeSession({ id: "user-42", email: "person@example.com" }) },
      error: null,
    });

    const outcome = await createService().restoreSession();

    expect(outcome).toEqual({
      kind: "authenticated",
      identity: { accountScopeId: "user-42", email: "person@example.com" },
    });
    if (outcome.kind === "authenticated") {
      expect(Object.keys(outcome.identity).sort()).toEqual(["accountScopeId", "email"]);
    }
  });

  it("classifies a null session with no error as no_session", async () => {
    fakeClient.auth.getSession.mockResolvedValue({ data: { session: null }, error: null });

    expect(await createService().restoreSession()).toEqual({ kind: "no_session" });
  });

  it("classifies a retryable fetch error as temporarily_unavailable", async () => {
    fakeClient.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });

    expect(await createService().restoreSession()).toEqual({ kind: "temporarily_unavailable" });
  });

  it("classifies an AuthApiError as invalid_session", async () => {
    fakeClient.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: new AuthApiError("refresh_token_not_found", 400, "refresh_token_not_found"),
    });

    expect(await createService().restoreSession()).toEqual({ kind: "invalid_session" });
  });

  it("classifies an AuthSessionMissingError as invalid_session", async () => {
    fakeClient.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: new AuthSessionMissingError(),
    });

    expect(await createService().restoreSession()).toEqual({ kind: "invalid_session" });
  });

  it("classifies an unrecognized provider error as restore_failed", async () => {
    fakeClient.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: { message: "something the SDK does not classify", status: 500 },
    });

    expect(await createService().restoreSession()).toEqual({ kind: "restore_failed" });
  });

  it("classifies a contained thrown failure as restore_failed", async () => {
    fakeClient.auth.getSession.mockRejectedValue(new Error("network exploded"));

    expect(await createService().restoreSession()).toEqual({ kind: "restore_failed" });
  });

  it("classifies a session whose user id is unusable as restore_failed, never fabricating an identity", async () => {
    fakeClient.auth.getSession.mockResolvedValue({
      data: { session: { ...fakeSession(), user: { ...fakeSession().user, id: "" } } },
      error: null,
    });

    expect(await createService().restoreSession()).toEqual({ kind: "restore_failed" });
  });

  it("classifies by the SDK's typed predicates, NOT by error-message text", async () => {
    // A plain object whose message is exactly what a substring classifier would
    // read as retryable, and a real AuthApiError whose message says nothing of
    // the kind. Getting these two right is only possible by type.
    fakeClient.auth.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: { message: "Failed to fetch", name: "AuthRetryableFetchError", status: 0 },
    });
    expect(await createService().restoreSession()).toEqual({ kind: "restore_failed" });

    fakeClient.auth.getSession.mockResolvedValueOnce({
      data: { session: null },
      error: new AuthApiError("all good here, honestly", 401, "bad_jwt"),
    });
    expect(await createService().restoreSession()).toEqual({ kind: "invalid_session" });
  });

  it("lets no raw Session/User/token/provider-error value escape in any outcome", async () => {
    const cases = [
      { data: { session: fakeSession() }, error: null },
      { data: { session: null }, error: new AuthApiError("provider detail here", 401, "bad_jwt") },
      { data: { session: null }, error: new AuthRetryableFetchError("provider detail here", 0) },
      { data: { session: null }, error: { message: "provider detail here", status: 500 } },
    ];
    for (const result of cases) {
      fakeClient.auth.getSession.mockResolvedValueOnce(result);
      const serialized = JSON.stringify(await createService().restoreSession());
      for (const secret of [ACCESS_TOKEN, REFRESH_TOKEN, "provider detail here", "aud", "app_metadata"]) {
        expect(serialized).not.toContain(secret);
      }
    }
  });

  it("does not clear the SDK's stored session on a retryable failure", async () => {
    fakeClient.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });

    await createService().restoreSession();

    // A bad network must never sign a legitimate device out.
    expect(fakeClient.auth.signOut).not.toHaveBeenCalled();
  });

  it("adds no cleanup of its own on a definitive invalid session — the SDK's own cleanup stands", async () => {
    fakeClient.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: new AuthApiError("refresh_token_not_found", 400, "refresh_token_not_found"),
    });

    await createService().restoreSession();

    expect(fakeClient.auth.signOut).not.toHaveBeenCalled();
    expect(fakeClient.auth.getSession).toHaveBeenCalledTimes(1);
  });
});

describe("createSupabaseAuthService — invalid_session versus INITIAL_SESSION, in both orderings", () => {
  it("ordering A (event arrives while restoration is in flight): the held initial_session is delivered with no identity", async () => {
    const { emit } = captureListener();
    let resolveGetSession!: (value: unknown) => void;
    fakeClient.auth.getSession.mockImplementation(
      () => new Promise((resolve) => (resolveGetSession = resolve))
    );

    const service = createService();
    const seen: NormalizedAuthChange[] = [];
    service.onAuthChange((change) => seen.push(change));

    const restoring = service.restoreSession();
    // The SDK's own initialization emits this with a stale stored session.
    emit("INITIAL_SESSION", fakeSession({ id: "stale-user" }));
    expect(seen).toEqual([]); // held, not delivered as authenticated-looking

    resolveGetSession({
      data: { session: null },
      error: new AuthApiError("refresh_token_not_found", 400, "refresh_token_not_found"),
    });
    expect(await restoring).toEqual({ kind: "invalid_session" });
    expect(seen).toEqual([{ reason: "initial_session", identity: null }]);
  });

  it("ordering B (classification first): a later initial_session is normalized with no identity", async () => {
    const { emit } = captureListener();
    fakeClient.auth.getSession.mockResolvedValue({
      data: { session: null },
      error: new AuthSessionMissingError(),
    });

    const service = createService();
    const seen: NormalizedAuthChange[] = [];
    service.onAuthChange((change) => seen.push(change));

    expect(await service.restoreSession()).toEqual({ kind: "invalid_session" });
    emit("INITIAL_SESSION", fakeSession({ id: "stale-user" }));

    expect(seen).toEqual([{ reason: "initial_session", identity: null }]);
  });

  it("does not hold initial_session when no restoration is in flight, so a consumer that never restores is never starved", () => {
    const { emit } = captureListener();
    const service = createService();
    const seen: NormalizedAuthChange[] = [];
    service.onAuthChange((change) => seen.push(change));

    emit("INITIAL_SESSION", null);

    expect(seen).toEqual([{ reason: "initial_session", identity: null }]);
  });

  it("delivers a held initial_session unchanged when the restoration succeeded", async () => {
    const { emit } = captureListener();
    let resolveGetSession!: (value: unknown) => void;
    fakeClient.auth.getSession.mockImplementation(
      () => new Promise((resolve) => (resolveGetSession = resolve))
    );

    const service = createService();
    const seen: NormalizedAuthChange[] = [];
    service.onAuthChange((change) => seen.push(change));

    const restoring = service.restoreSession();
    emit("INITIAL_SESSION", fakeSession({ id: "user-7", email: "seven@example.com" }));
    resolveGetSession({ data: { session: fakeSession({ id: "user-7", email: "seven@example.com" }) }, error: null });
    await restoring;

    expect(seen).toEqual([
      { reason: "initial_session", identity: { accountScopeId: "user-7", email: "seven@example.com" } },
    ]);
  });

  it("does not deliver a held initial_session to a listener that unsubscribed first", async () => {
    const { emit } = captureListener();
    let resolveGetSession!: (value: unknown) => void;
    fakeClient.auth.getSession.mockImplementation(
      () => new Promise((resolve) => (resolveGetSession = resolve))
    );

    const service = createService();
    const seen: NormalizedAuthChange[] = [];
    const unsubscribe = service.onAuthChange((change) => seen.push(change));

    const restoring = service.restoreSession();
    emit("INITIAL_SESSION", fakeSession());
    unsubscribe();
    resolveGetSession({ data: { session: null }, error: null });
    await restoring;

    expect(seen).toEqual([]);
  });
});

describe("createSupabaseAuthService — hostile provider values cannot break the closed-outcome contract", () => {
  // `restoreSession` promises exactly one of five outcomes. A Session, User, id
  // or email backed by a throwing getter or a hostile Proxy must therefore
  // produce an outcome, never a rejected promise — and specifically
  // `restore_failed`, because a truthy session whose identity cannot be read is
  // neither an absence nor an identity.
  it("resolves restore_failed for a throwing getter at every level of the session, for every thrown value", async () => {
    for (const at of ["user", "id", "email"] as const) {
      for (const [label, thrown] of HOSTILE_THROWN) {
        fakeClient.auth.getSession.mockResolvedValueOnce({
          data: { session: sessionThrowingAt(at, thrown) },
          error: null,
        });

        const outcome = await createService().restoreSession();

        expect(outcome, `${at} / ${label}`).toEqual({ kind: "restore_failed" });
      }
    }
  });

  it("resolves restore_failed for a fully Proxy-backed session — never no_session, never an identity", async () => {
    for (const [label, thrown] of HOSTILE_THROWN) {
      fakeClient.auth.getSession.mockResolvedValueOnce({
        data: { session: proxySession(thrown) },
        error: null,
      });

      const outcome = await createService().restoreSession();

      expect(outcome, label).toEqual({ kind: "restore_failed" });
      expect(outcome.kind, label).not.toBe("no_session");
      expect(outcome, label).not.toHaveProperty("identity");
    }
  });

  it("resolves restore_failed for an unclassifiable provider error whose own trap throws", async () => {
    for (const [label, thrown] of HOSTILE_THROWN) {
      fakeClient.auth.getSession.mockResolvedValueOnce({
        data: { session: null },
        error: proxyError(thrown),
      });

      expect(await createService().restoreSession(), label).toEqual({ kind: "restore_failed" });
    }
  });

  it("still distinguishes a genuinely absent session from an unreadable one", async () => {
    fakeClient.auth.getSession.mockResolvedValueOnce({ data: { session: null }, error: null });
    expect(await createService().restoreSession()).toEqual({ kind: "no_session" });

    fakeClient.auth.getSession.mockResolvedValueOnce({
      data: { session: sessionThrowingAt("user", new Error("boom")) },
      error: null,
    });
    expect(await createService().restoreSession()).toEqual({ kind: "restore_failed" });
  });

  it("fails closed to the already-defined normalized shape for a hostile session on any event", () => {
    const { emit } = captureListener();
    const service = createService();
    const seen: NormalizedAuthChange[] = [];
    service.onAuthChange((change) => seen.push(change));

    emit("SIGNED_IN", sessionThrowingAt("user", new Error("boom")));
    emit("TOKEN_REFRESHED", proxySession(Symbol("boom")));
    emit("USER_UPDATED", sessionThrowingAt("id", "boom"));
    emit("INITIAL_SESSION", proxySession(new Error("boom")));
    emit("PASSWORD_RECOVERY", sessionThrowingAt("email", null));

    expect(seen).toEqual([
      { reason: "other", identity: null },
      { reason: "other", identity: null },
      { reason: "other", identity: null },
      { reason: "initial_session", identity: null },
      { reason: "other", identity: null },
    ]);
  });

  it("returns a typed OTP failure rather than rejecting for a hostile verified session", async () => {
    for (const [label, thrown] of HOSTILE_THROWN) {
      fakeClient.auth.verifyOtp.mockResolvedValueOnce({
        data: { session: proxySession(thrown) },
        error: null,
      });

      const result = await createService().verifyEmailOtp("a@example.com", OTP_TOKEN);
      expect(result.ok, label).toBe(false);
      if (!result.ok) expect(result.error.kind, label).toBe("verification_failed");
    }
  });

  it("returns exchange_failed rather than rejecting for a hostile exchanged session", async () => {
    for (const [label, thrown] of HOSTILE_THROWN) {
      fakeClient.auth.exchangeCodeForSession.mockResolvedValueOnce({
        data: { session: proxySession(thrown) },
        error: null,
      });

      expect(
        await createService().exchangeCorrelatedCallback(fakeClaim(), FLOW_ID),
        label
      ).toEqual({ kind: "exchange_failed" });
    }
  });

  it("lets no thrown provider value or token reach an outcome, and logs nothing", async () => {
    const spies = (["log", "error", "warn", "info", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {})
    );
    const secret = "hostile-provider-detail-must-never-escape";

    fakeClient.auth.getSession.mockResolvedValue({
      data: { session: sessionThrowingAt("user", new Error(secret)) },
      error: null,
    });
    fakeClient.auth.verifyOtp.mockResolvedValue({
      data: { session: proxySession(new Error(secret)) },
      error: null,
    });
    fakeClient.auth.exchangeCodeForSession.mockResolvedValue({
      data: { session: proxySession(new Error(secret)) },
      error: null,
    });
    const { emit } = captureListener();
    const service = createService();
    const seen: NormalizedAuthChange[] = [];
    service.onAuthChange((change) => seen.push(change));

    const outcomes: unknown[] = [
      await service.restoreSession(),
      await service.verifyEmailOtp("a@example.com", OTP_TOKEN),
      await service.exchangeCorrelatedCallback(fakeClaim(), FLOW_ID),
    ];
    emit("SIGNED_IN", sessionThrowingAt("id", new Error(secret)));

    for (const value of [...outcomes, seen]) {
      const serialized = JSON.stringify(value);
      for (const forbidden of [secret, ACCESS_TOKEN, REFRESH_TOKEN, "provider getter boom"]) {
        expect(serialized).not.toContain(forbidden);
      }
    }
    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe("createSupabaseAuthService — a throwing subscriber is contained, not propagated", () => {
  it("contains a throwing direct listener and still delivers to another subscriber", () => {
    const { emit } = captureListener();
    const service = createService();
    const secondSeen: NormalizedAuthChange[] = [];

    for (const [, thrown] of HOSTILE_THROWN) {
      service.onAuthChange(() => {
        throw thrown;
      });
    }
    service.onAuthChange((change) => secondSeen.push(change));

    // Nothing escapes into the SDK's own callback dispatch, so its other
    // callbacks — including this second subscriber — still run.
    expect(() => emit("SIGNED_OUT", null)).not.toThrow();
    expect(secondSeen).toEqual([{ reason: "signed_out" }]);
  });

  it("contains a throwing listener on every normalized reason", () => {
    const { emit } = captureListener();
    const service = createService();
    service.onAuthChange(() => {
      throw new Error("subscriber boom");
    });

    for (const event of ["SIGNED_IN", "TOKEN_REFRESHED", "USER_UPDATED", "SIGNED_OUT", "PASSWORD_RECOVERY", "INITIAL_SESSION"]) {
      expect(() => emit(event, fakeSession()), event).not.toThrow();
    }
  });

  it("does not let a throwing HELD subscriber reject restoreSession, and still flushes the next one", async () => {
    // The held-INITIAL_SESSION path runs from restoreSession's `finally`, so an
    // uncontained subscriber throw there would reject an otherwise valid
    // five-outcome result AND starve every later held subscriber.
    const { emit } = captureListener();
    let resolveGetSession!: (value: unknown) => void;
    fakeClient.auth.getSession.mockImplementation(
      () => new Promise((resolve) => (resolveGetSession = resolve))
    );

    const service = createService();
    const firstCalls: NormalizedAuthChange[] = [];
    const secondSeen: NormalizedAuthChange[] = [];
    const thirdSeen: NormalizedAuthChange[] = [];

    service.onAuthChange((change) => {
      firstCalls.push(change);
      throw new Error("first subscriber boom");
    });
    service.onAuthChange((change) => secondSeen.push(change));
    service.onAuthChange((change) => thirdSeen.push(change));

    const restoring = service.restoreSession();
    emit("INITIAL_SESSION", fakeSession({ id: "user-7", email: "seven@example.com" }));
    expect(firstCalls).toEqual([]); // all three held while restoration is in flight

    resolveGetSession({
      data: { session: fakeSession({ id: "user-7", email: "seven@example.com" }) },
      error: null,
    });

    // The valid outcome survives the throwing subscriber.
    await expect(restoring).resolves.toEqual({
      kind: "authenticated",
      identity: { accountScopeId: "user-7", email: "seven@example.com" },
    });
    const expected = {
      reason: "initial_session",
      identity: { accountScopeId: "user-7", email: "seven@example.com" },
    };
    expect(firstCalls).toEqual([expected]);
    // ...and so do the subscribers queued behind it.
    expect(secondSeen).toEqual([expected]);
    expect(thirdSeen).toEqual([expected]);
  });

  it("contains a non-Error throw from a held subscriber", async () => {
    const { emit } = captureListener();
    let resolveGetSession!: (value: unknown) => void;
    fakeClient.auth.getSession.mockImplementation(
      () => new Promise((resolve) => (resolveGetSession = resolve))
    );
    const service = createService();
    const secondSeen: NormalizedAuthChange[] = [];
    service.onAuthChange(() => {
      throw Symbol("held subscriber boom");
    });
    service.onAuthChange((change) => secondSeen.push(change));

    const restoring = service.restoreSession();
    emit("INITIAL_SESSION", null);
    resolveGetSession({ data: { session: null }, error: null });

    await expect(restoring).resolves.toEqual({ kind: "no_session" });
    expect(secondSeen).toEqual([{ reason: "initial_session", identity: null }]);
  });

  it("logs nothing and leaks nothing when a subscriber throws", async () => {
    const spies = (["log", "error", "warn", "info", "debug"] as const).map((level) =>
      vi.spyOn(console, level).mockImplementation(() => {})
    );
    const secret = "subscriber-thrown-detail-must-never-escape";
    const { emit } = captureListener();
    let resolveGetSession!: (value: unknown) => void;
    fakeClient.auth.getSession.mockImplementation(
      () => new Promise((resolve) => (resolveGetSession = resolve))
    );
    const service = createService();
    service.onAuthChange(() => {
      throw new Error(secret);
    });

    const restoring = service.restoreSession();
    emit("INITIAL_SESSION", fakeSession());
    resolveGetSession({ data: { session: null }, error: null });
    const outcome = await restoring;
    emit("SIGNED_IN", fakeSession());

    expect(JSON.stringify(outcome)).not.toContain(secret);
    for (const spy of spies) {
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          const text = typeof arg === "string" ? arg : JSON.stringify(arg);
          expect(text).not.toContain(secret);
        }
      }
      expect(spy).not.toHaveBeenCalled();
      spy.mockRestore();
    }
  });
});

describe("createSupabaseAuthService — normalized auth changes (ADR-0025 Decision 3)", () => {
  it("maps each provider event onto exactly one normalized reason, and never leaks the raw event string", () => {
    const { emit } = captureListener();
    const service = createService();
    const seen: NormalizedAuthChange[] = [];
    service.onAuthChange((change) => seen.push(change));

    const identity = { accountScopeId: "user-9", email: "nine@example.com" };
    emit("SIGNED_IN", fakeSession({ id: "user-9", email: "nine@example.com" }));
    emit("TOKEN_REFRESHED", fakeSession({ id: "user-9", email: "nine@example.com" }));
    emit("USER_UPDATED", fakeSession({ id: "user-9", email: "nine@example.com" }));
    emit("SIGNED_OUT", null);
    emit("PASSWORD_RECOVERY", fakeSession({ id: "user-9", email: "nine@example.com" }));

    expect(seen).toEqual([
      { reason: "signed_in", identity },
      { reason: "token_refreshed", identity },
      { reason: "user_updated", identity },
      { reason: "signed_out" },
      { reason: "other", identity },
    ]);
    expect(JSON.stringify(seen)).not.toContain("SIGNED_IN");
    expect(JSON.stringify(seen)).not.toContain("PASSWORD_RECOVERY");
  });

  it("fails closed to `other` with no identity when an identity-requiring event carries unusable data", () => {
    const { emit } = captureListener();
    const service = createService();
    const seen: NormalizedAuthChange[] = [];
    service.onAuthChange((change) => seen.push(change));

    emit("SIGNED_IN", { ...fakeSession(), user: null });
    emit("TOKEN_REFRESHED", { ...fakeSession(), user: { ...fakeSession().user, id: 42 } });

    expect(seen).toEqual([
      { reason: "other", identity: null },
      { reason: "other", identity: null },
    ]);
  });

  it("never lets a raw token reach a normalized change", () => {
    const { emit } = captureListener();
    const service = createService();
    const seen: NormalizedAuthChange[] = [];
    service.onAuthChange((change) => seen.push(change));

    emit("SIGNED_IN", fakeSession());

    const serialized = JSON.stringify(seen);
    expect(serialized).not.toContain(ACCESS_TOKEN);
    expect(serialized).not.toContain(REFRESH_TOKEN);
  });

  it("returns a cleanup function that unsubscribes exactly once", () => {
    const { unsubscribe } = captureListener();
    const cleanup = createService().onAuthChange(() => {});

    cleanup();
    cleanup();

    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });
});

describe("createSupabaseAuthService — prepareGoogleSignIn", () => {
  it("uses skipBrowserRedirect, returns the URL and selector, and neither navigates nor establishes an identity", async () => {
    const navigate = vi.fn();
    fakeClient.auth.signInWithOAuth.mockResolvedValue({
      data: { provider: "google", url: authorizationUrl(), flowId: FLOW_ID },
      error: null,
    });

    const outcome = await createService({ navigate }).prepareGoogleSignIn(CALLBACK_TARGET);

    expect(fakeClient.auth.signInWithOAuth).toHaveBeenCalledWith({
      provider: "google",
      options: { redirectTo: CALLBACK_TARGET, skipBrowserRedirect: true },
    });
    expect(outcome).toEqual({
      kind: "prepared",
      prepared: { authorizationUrl: authorizationUrl(), flowId: FLOW_ID },
    });
    expect(navigate).not.toHaveBeenCalled();
    // Preparation is preparation: no session was read and no identity produced.
    expect(fakeClient.auth.getSession).not.toHaveBeenCalled();
    expect(JSON.stringify(outcome)).not.toContain("accountScopeId");
  });

  it("rejects an invalid redirect target before reaching the provider", async () => {
    for (const target of [
      "not-a-url",
      "javascript:alert(1)",
      "https://evil.example.test/",
      `${APP_ORIGIN}/ with space`,
      `${APP_ORIGIN}/#fragment`,
      `${APP_ORIGIN}/?sb_flow_id=${FLOW_ID}`,
      `https://user:pass@app.example.test/`,
    ]) {
      const outcome = await createService().prepareGoogleSignIn(target);
      expect(outcome, target).toEqual({ kind: "invalid_redirect" });
    }
    expect(fakeClient.auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("fails closed when the app origin cannot be resolved", async () => {
    const service = createSupabaseAuthService(CONFIG, {
      resolveAppOrigin: () => null,
      navigate: () => {},
    });

    expect(await service.prepareGoogleSignIn(CALLBACK_TARGET)).toEqual({ kind: "invalid_redirect" });
    expect(fakeClient.auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("fails closed with flow_selector_unavailable when the SDK returns no usable selector", async () => {
    for (const flowId of [null, undefined, "", "short", "not valid!", "x".repeat(65)]) {
      fakeClient.auth.signInWithOAuth.mockResolvedValueOnce({
        data: { provider: "google", url: authorizationUrl(), flowId },
        error: null,
      });
      const outcome = await createService().prepareGoogleSignIn(CALLBACK_TARGET);
      expect(outcome, String(flowId)).toEqual({ kind: "flow_selector_unavailable" });
    }
  });

  it("fails closed when the selector did not round-trip into the authorization URL's redirect target", async () => {
    // `appendPkceFlowIdToRedirects` silently stopped appending: the return would
    // carry no selector, so this is caught before anyone leaves the page. Only
    // the selector is removed — everything else about the URL stays valid, so
    // this isolates the selector branch rather than tripping a structural one.
    fakeClient.auth.signInWithOAuth.mockResolvedValue({
      data: { provider: "google", url: authorizationUrl({ flowId: null }), flowId: FLOW_ID },
      error: null,
    });

    expect(await createService().prepareGoogleSignIn(CALLBACK_TARGET)).toEqual({
      kind: "flow_selector_unavailable",
    });
  });

  it("refuses an authorization URL whose redirect target points at another origin", async () => {
    // An external redirect target would hand the provider's response to someone
    // else. That is a structural/routing failure, not a selector problem.
    fakeClient.auth.signInWithOAuth.mockResolvedValue({
      data: {
        provider: "google",
        url: authorizationUrl({ redirectTo: "https://elsewhere.example.test/" }),
        flowId: FLOW_ID,
      },
      error: null,
    });

    expect(await createService().prepareGoogleSignIn(CALLBACK_TARGET)).toEqual({
      kind: "preparation_failed",
    });
  });

  it("rejects an authorization URL that is not on the configured Supabase origin", async () => {
    fakeClient.auth.signInWithOAuth.mockResolvedValue({
      data: {
        provider: "google",
        url: authorizationUrl({ origin: "https://someone-else.supabase.co" }),
        flowId: FLOW_ID,
      },
      error: null,
    });

    expect(await createService().prepareGoogleSignIn(CALLBACK_TARGET)).toEqual({
      kind: "preparation_failed",
    });
  });

  it("separates a retryable provider failure from an unrecognized one, and leaks neither", async () => {
    fakeClient.auth.signInWithOAuth.mockResolvedValueOnce({
      data: { provider: "google", url: null, flowId: null },
      error: new AuthRetryableFetchError("provider detail here", 0),
    });
    expect(await createService().prepareGoogleSignIn(CALLBACK_TARGET)).toEqual({
      kind: "temporarily_unavailable",
    });

    fakeClient.auth.signInWithOAuth.mockResolvedValueOnce({
      data: { provider: "google", url: null, flowId: null },
      error: new AuthApiError("provider detail here", 400, "oauth_error"),
    });
    const outcome = await createService().prepareGoogleSignIn(CALLBACK_TARGET);
    expect(outcome).toEqual({ kind: "preparation_failed" });
    expect(JSON.stringify(outcome)).not.toContain("provider detail here");
  });

  it("contains a thrown signInWithOAuth call", async () => {
    fakeClient.auth.signInWithOAuth.mockRejectedValue(new Error("boom"));

    expect(await createService().prepareGoogleSignIn(CALLBACK_TARGET)).toEqual({
      kind: "preparation_failed",
    });
  });
});

describe("createSupabaseAuthService — navigateToAuthorizationUrl", () => {
  it("navigates to a revalidated authorization URL on the configured Supabase origin", () => {
    const navigate = vi.fn();
    const url = authorizationUrl();

    const outcome = createService({ navigate }).navigateToAuthorizationUrl({
      authorizationUrl: url,
      flowId: FLOW_ID,
    });

    expect(outcome).toEqual({ kind: "navigating" });
    expect(navigate).toHaveBeenCalledWith(url);
  });

  it("performs zero navigation when revalidation fails", () => {
    const navigate = vi.fn();
    const service = createService({ navigate });
    const rejected = [
      { authorizationUrl: "https://evil.example.test/auth/v1/authorize", flowId: FLOW_ID },
      { authorizationUrl: "not-a-url", flowId: FLOW_ID },
      { authorizationUrl: `javascript:alert(1)`, flowId: FLOW_ID },
      { authorizationUrl: `${CONFIG.url}/auth/v1/authorize?x= y`, flowId: FLOW_ID },
      { authorizationUrl: authorizationUrl(), flowId: "not-a-selector!" },
    ];

    for (const prepared of rejected) {
      expect(service.navigateToAuthorizationUrl(prepared), prepared.authorizationUrl).toEqual({
        kind: "navigation_failed",
      });
    }
    expect(navigate).not.toHaveBeenCalled();
  });

  it("contains a synchronous navigation failure instead of throwing", () => {
    const navigate = vi.fn(() => {
      throw new Error("navigation refused");
    });

    const outcome = createService({ navigate }).navigateToAuthorizationUrl({
      authorizationUrl: authorizationUrl(),
      flowId: FLOW_ID,
    });

    expect(outcome).toEqual({ kind: "navigation_failed" });
    expect(navigate).toHaveBeenCalledTimes(1);
  });
});

describe("createSupabaseAuthService — the strict authorization-route validator (shared by preparation and navigation)", () => {
  // One validator, two callers. Each case perturbs exactly ONE part of an
  // otherwise-valid authorization URL, and asserts BOTH that preparation
  // refuses it and that navigation performs zero navigation — "it is on the
  // right origin" is nowhere near enough.
  const structural: Array<[string, AuthorizationUrlOptions]> = [
    ["same Supabase origin but a different path", { path: "/auth/v1/token" }],
    ["same origin, a path that merely starts the same", { path: "/auth/v1/authorize-evil" }],
    ["no provider at all", { provider: null }],
    ["a different provider", { provider: "github" }],
    ["an external redirect target", { redirectTo: "https://elsewhere.example.test/" }],
    ["a redirect target on a look-alike origin", { redirectTo: "https://app.example.test.evil.test/" }],
    ["no redirect target", { omitRedirectTo: true }],
    ["a duplicated redirect target", { duplicateRedirectTo: true }],
    ["no PKCE challenge", { codeChallenge: null }],
    ["an empty PKCE challenge", { codeChallenge: "" }],
    ["a duplicated PKCE challenge", { duplicateCodeChallenge: true }],
    ["no PKCE challenge method", { codeChallengeMethod: null }],
    ["an unhashed (plain) PKCE challenge method", { codeChallengeMethod: "plain" }],
    ["an unknown PKCE challenge method", { codeChallengeMethod: "sha1" }],
    ["a fragment", { fragment: "#anything" }],
    ["a different Supabase origin", { origin: "https://someone-else.supabase.co" }],
  ];

  const selectorRelated: Array<[string, AuthorizationUrlOptions]> = [
    ["no flow selector in the redirect target", { flowId: null }],
    ["a different flow selector", { flowId: OTHER_FLOW_ID }],
    ["a duplicated flow selector", { duplicateFlowId: FLOW_ID }],
    ["two conflicting flow selectors", { duplicateFlowId: OTHER_FLOW_ID }],
    ["a malformed flow selector", { flowId: "not a selector!" }],
    ["a too-short flow selector", { flowId: "abc" }],
  ];

  it("refuses every structural defect at preparation as preparation_failed", async () => {
    for (const [label, options] of structural) {
      fakeClient.auth.signInWithOAuth.mockResolvedValueOnce({
        data: { provider: "google", url: authorizationUrl(options), flowId: FLOW_ID },
        error: null,
      });
      expect(await createService().prepareGoogleSignIn(CALLBACK_TARGET), label).toEqual({
        kind: "preparation_failed",
      });
    }
  });

  it("refuses every selector defect at preparation as flow_selector_unavailable", async () => {
    for (const [label, options] of selectorRelated) {
      fakeClient.auth.signInWithOAuth.mockResolvedValueOnce({
        data: { provider: "google", url: authorizationUrl(options), flowId: FLOW_ID },
        error: null,
      });
      expect(await createService().prepareGoogleSignIn(CALLBACK_TARGET), label).toEqual({
        kind: "flow_selector_unavailable",
      });
    }
  });

  it("performs zero navigation for every one of those defects", () => {
    const navigate = vi.fn();
    const service = createService({ navigate });

    for (const [label, options] of [...structural, ...selectorRelated]) {
      expect(service.navigateToAuthorizationUrl(preparedFrom(options)), label).toEqual({
        kind: "navigation_failed",
      });
    }
    expect(navigate).not.toHaveBeenCalled();
  });

  it("refuses a prepared value whose selector does not match the one inside its own redirect target", () => {
    const navigate = vi.fn();
    const service = createService({ navigate });

    // The URL is internally consistent, but the caller is holding a different
    // selector — exactly the stale-attempt case that must never navigate.
    const outcome = service.navigateToAuthorizationUrl({
      authorizationUrl: authorizationUrl(),
      flowId: OTHER_FLOW_ID,
    });

    expect(outcome).toEqual({ kind: "navigation_failed" });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("fails closed when no application origin can be resolved at navigation time", () => {
    const navigate = vi.fn();
    const service = createSupabaseAuthService(CONFIG, {
      resolveAppOrigin: () => null,
      navigate,
    });

    expect(service.navigateToAuthorizationUrl(preparedFrom())).toEqual({
      kind: "navigation_failed",
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("navigates exactly once, to the exact validated string, for a valid untouched prepared authorization", () => {
    const navigate = vi.fn();
    const prepared = preparedFrom();

    const outcome = createService({ navigate }).navigateToAuthorizationUrl(prepared);

    expect(outcome).toEqual({ kind: "navigating" });
    expect(navigate).toHaveBeenCalledTimes(1);
    expect(navigate).toHaveBeenCalledWith(prepared.authorizationUrl);
  });
});

describe("createSupabaseAuthService — preparation proves the callback target survived intact", () => {
  it("accepts a requested target whose unrelated parameters all survive, plus exactly the appended selector", async () => {
    const requested = `${APP_ORIGIN}/?inviteToken=tok&adminRequestId=req-1&state=abc`;
    fakeClient.auth.signInWithOAuth.mockResolvedValue({
      data: {
        provider: "google",
        url: authorizationUrl({ redirectTo: requested }),
        flowId: FLOW_ID,
      },
      error: null,
    });

    const outcome = await createService().prepareGoogleSignIn(requested);
    expect(outcome.kind).toBe("prepared");
  });

  it("refuses a redirect target that silently DROPPED an unrelated callback parameter", async () => {
    // A dropped `inviteToken` would strand a deep link after the round trip,
    // with nothing left to diagnose it from.
    const requested = `${APP_ORIGIN}/?inviteToken=tok&adminRequestId=req-1`;
    fakeClient.auth.signInWithOAuth.mockResolvedValue({
      data: {
        provider: "google",
        url: authorizationUrl({ redirectTo: `${APP_ORIGIN}/?adminRequestId=req-1` }),
        flowId: FLOW_ID,
      },
      error: null,
    });

    expect(await createService().prepareGoogleSignIn(requested)).toEqual({
      kind: "preparation_failed",
    });
  });

  it("refuses a redirect target whose unrelated callback parameter was CHANGED", async () => {
    const requested = `${APP_ORIGIN}/?inviteToken=tok`;
    fakeClient.auth.signInWithOAuth.mockResolvedValue({
      data: {
        provider: "google",
        url: authorizationUrl({ redirectTo: `${APP_ORIGIN}/?inviteToken=someone-elses-token` }),
        flowId: FLOW_ID,
      },
      error: null,
    });

    expect(await createService().prepareGoogleSignIn(requested)).toEqual({
      kind: "preparation_failed",
    });
  });

  it("refuses a redirect target with an ADDED parameter that was never requested", async () => {
    fakeClient.auth.signInWithOAuth.mockResolvedValue({
      data: {
        provider: "google",
        url: authorizationUrl({ redirectTo: `${APP_ORIGIN}/?injected=1` }),
        flowId: FLOW_ID,
      },
      error: null,
    });

    expect(await createService().prepareGoogleSignIn(CALLBACK_TARGET)).toEqual({
      kind: "preparation_failed",
    });
  });

  it("refuses a redirect target on the right origin but a different path", async () => {
    fakeClient.auth.signInWithOAuth.mockResolvedValue({
      data: {
        provider: "google",
        url: authorizationUrl({ redirectTo: `${APP_ORIGIN}/somewhere-else` }),
        flowId: FLOW_ID,
      },
      error: null,
    });

    expect(await createService().prepareGoogleSignIn(CALLBACK_TARGET)).toEqual({
      kind: "preparation_failed",
    });
  });
});

describe("createSupabaseAuthService — the synchronous boundaries never throw (ADR-0025 provider mechanics)", () => {
  const hostileThrows: Array<[string, unknown]> = [
    ["an Error", new Error("boom")],
    ["a non-Error string", "boom"],
    ["a Symbol", Symbol("boom")],
    ["null", null],
    ["undefined", undefined],
  ];

  it("contains a throwing resolveAppOrigin during preparation, without reaching the provider", async () => {
    for (const [label, thrown] of hostileThrows) {
      const service = createSupabaseAuthService(CONFIG, {
        resolveAppOrigin: () => {
          throw thrown;
        },
        navigate: () => {},
      });

      expect(await service.prepareGoogleSignIn(CALLBACK_TARGET), label).toEqual({
        kind: "invalid_redirect",
      });
    }
    expect(fakeClient.auth.signInWithOAuth).not.toHaveBeenCalled();
  });

  it("contains a throwing resolveAppOrigin during navigation, with zero navigation", () => {
    for (const [label, thrown] of hostileThrows) {
      const navigate = vi.fn();
      const service = createSupabaseAuthService(CONFIG, {
        resolveAppOrigin: () => {
          throw thrown;
        },
        navigate,
      });

      expect(service.navigateToAuthorizationUrl(preparedFrom()), label).toEqual({
        kind: "navigation_failed",
      });
      expect(navigate, label).not.toHaveBeenCalled();
    }
  });

  it("contains a Proxy-backed prepared value whose every property access throws", () => {
    for (const [label, thrown] of hostileThrows) {
      const navigate = vi.fn();
      const hostile = new Proxy({} as PreparedAuthorization, {
        get() {
          throw thrown;
        },
      });

      expect(createService({ navigate }).navigateToAuthorizationUrl(hostile), label).toEqual({
        kind: "navigation_failed",
      });
      expect(navigate, label).not.toHaveBeenCalled();
    }
  });

  it("contains a prepared value with a throwing getter on just one property", () => {
    const navigate = vi.fn();
    const hostile = {} as PreparedAuthorization;
    Object.defineProperties(hostile, {
      flowId: { value: FLOW_ID, enumerable: true },
      authorizationUrl: {
        get() {
          throw new Error("getter refused");
        },
        enumerable: true,
      },
    });

    expect(createService({ navigate }).navigateToAuthorizationUrl(hostile)).toEqual({
      kind: "navigation_failed",
    });
    expect(navigate).not.toHaveBeenCalled();
  });

  it("contains a non-object prepared value", () => {
    const navigate = vi.fn();
    const service = createService({ navigate });

    for (const hostile of [null, undefined, 42, "string", Symbol("s")]) {
      expect(
        service.navigateToAuthorizationUrl(hostile as unknown as PreparedAuthorization),
        String(hostile)
      ).toEqual({ kind: "navigation_failed" });
    }
    expect(navigate).not.toHaveBeenCalled();
  });

  it("contains a navigate that throws a non-Error value", () => {
    const navigate = vi.fn(() => {
      throw Symbol("refused");
    });

    expect(createService({ navigate }).navigateToAuthorizationUrl(preparedFrom())).toEqual({
      kind: "navigation_failed",
    });
    expect(navigate).toHaveBeenCalledTimes(1);
  });

  it("contains a throwing claim selector as selector_mismatch, with zero provider calls", async () => {
    for (const [label, thrown] of hostileThrows) {
      expect(
        await createService().exchangeCorrelatedCallback(throwingClaim(thrown), FLOW_ID),
        label
      ).toEqual({ kind: "selector_mismatch" });
    }
    expect(fakeClient.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("contains a non-object claim as selector_mismatch, with zero provider calls", async () => {
    const service = createService();
    for (const hostile of [null, undefined, 42, "string"]) {
      expect(
        await service.exchangeCorrelatedCallback(hostile as unknown as ClaimedCallback, FLOW_ID),
        String(hostile)
      ).toEqual({ kind: "selector_mismatch" });
    }
    expect(fakeClient.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("contains a throwing readAuthorizationCode as exchange_failed, with zero provider calls", async () => {
    for (const [label, thrown] of hostileThrows) {
      expect(
        await createService().exchangeCorrelatedCallback(
          throwingClaim(thrown, { onlyCodeReader: true }),
          FLOW_ID
        ),
        label
      ).toEqual({ kind: "exchange_failed" });
    }
    expect(fakeClient.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("contains a claim whose readAuthorizationCode is not callable, with zero provider calls", async () => {
    const claim = {} as ClaimedCallback;
    Object.defineProperties(claim, {
      flowId: { value: FLOW_ID, enumerable: false },
      readAuthorizationCode: { value: "not a function", enumerable: false },
    });

    expect(await createService().exchangeCorrelatedCallback(claim, FLOW_ID)).toEqual({
      kind: "exchange_failed",
    });
    expect(fakeClient.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("contains a claim whose readAuthorizationCode returns a non-string, with zero provider calls", async () => {
    const service = createService();
    for (const returned of [42, {}, [], true, ""]) {
      const claim = {} as ClaimedCallback;
      Object.defineProperties(claim, {
        flowId: { value: FLOW_ID, enumerable: false },
        readAuthorizationCode: { value: () => returned, enumerable: false },
      });
      expect(
        await service.exchangeCorrelatedCallback(claim, FLOW_ID),
        JSON.stringify(returned)
      ).toEqual({ kind: "exchange_failed" });
    }
    expect(fakeClient.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("never lets a thrown value from any of those boundaries reach the outcome", async () => {
    const secret = "hostile-thrown-detail";
    const service = createSupabaseAuthService(CONFIG, {
      resolveAppOrigin: () => APP_ORIGIN,
      navigate: () => {
        throw new Error(secret);
      },
    });

    const outcomes: unknown[] = [
      service.navigateToAuthorizationUrl(preparedFrom()),
      await service.exchangeCorrelatedCallback(throwingClaim(new Error(secret)), FLOW_ID),
      await service.exchangeCorrelatedCallback(
        throwingClaim(new Error(secret), { onlyCodeReader: true }),
        FLOW_ID
      ),
    ];
    for (const outcome of outcomes) {
      expect(JSON.stringify(outcome)).not.toContain(secret);
      expect(Object.keys(outcome as object)).toEqual(["kind"]);
    }
  });

  it("contains a throwing provider unsubscribe and stays idempotent", () => {
    const unsubscribe = vi.fn(() => {
      throw new Error("provider unsubscribe refused");
    });
    fakeClient.auth.onAuthStateChange.mockImplementation(() => ({
      data: { subscription: { unsubscribe } },
    }));

    const cleanup = createService().onAuthChange(() => {});

    expect(() => cleanup()).not.toThrow();
    expect(() => cleanup()).not.toThrow();
    // A second call reaches the provider zero further times.
    expect(unsubscribe).toHaveBeenCalledTimes(1);
  });

  it("contains a provider subscription object with no usable unsubscribe", () => {
    fakeClient.auth.onAuthStateChange.mockImplementation(() => ({ data: {} }));

    const cleanup = createService().onAuthChange(() => {});

    expect(() => cleanup()).not.toThrow();
  });

  it("deliberately does NOT swallow a subscription-construction failure", () => {
    // There is no outcome channel on a synchronous subscribe, and pretending to
    // have subscribed would be worse than throwing: the caller
    // (useSupabaseAuthController) contains this and reports it honestly.
    fakeClient.auth.onAuthStateChange.mockImplementation(() => {
      throw new Error("subscription refused");
    });

    expect(() => createService().onAuthChange(() => {})).toThrow();
  });
});

describe("createSupabaseAuthService — exchangeCorrelatedCallback", () => {
  it("exchanges with an explicit flowId and returns only the minimal identity", async () => {
    fakeClient.auth.exchangeCodeForSession.mockResolvedValue({
      data: { session: fakeSession({ id: "user-5", email: "five@example.com" }) },
      error: null,
    });

    const outcome = await createService().exchangeCorrelatedCallback(fakeClaim(), FLOW_ID);

    expect(fakeClient.auth.exchangeCodeForSession).toHaveBeenCalledWith(AUTHORIZATION_CODE, {
      flowId: FLOW_ID,
    });
    expect(outcome).toEqual({
      kind: "exchanged",
      identity: { accountScopeId: "user-5", email: "five@example.com" },
    });
    expect(JSON.stringify(outcome)).not.toContain(ACCESS_TOKEN);
    expect(JSON.stringify(outcome)).not.toContain(AUTHORIZATION_CODE);
  });

  it("rejects a selector mismatch with ZERO provider calls, leaving the code unread", async () => {
    const claim = fakeClaim({ flowId: OTHER_FLOW_ID });

    const outcome = await createService().exchangeCorrelatedCallback(claim, FLOW_ID);

    expect(outcome).toEqual({ kind: "selector_mismatch" });
    expect(fakeClient.auth.exchangeCodeForSession).not.toHaveBeenCalled();
    // A failed exchange removes the verifier it selected, so refusing before
    // the call is what stops a stale callback from destroying a newer attempt.
    expect(claim.readAuthorizationCode()).toBe(AUTHORIZATION_CODE);
  });

  it("rejects a malformed expected selector with zero provider calls", async () => {
    for (const expected of ["", "short", "not valid!", "x".repeat(65)]) {
      const outcome = await createService().exchangeCorrelatedCallback(fakeClaim(), expected);
      expect(outcome, expected).toEqual({ kind: "selector_mismatch" });
    }
    expect(fakeClient.auth.exchangeCodeForSession).not.toHaveBeenCalled();
  });

  it("fails with zero provider calls when the claim's code has already been read (a replayed exchange)", async () => {
    fakeClient.auth.exchangeCodeForSession.mockResolvedValue({
      data: { session: fakeSession() },
      error: null,
    });
    const service = createService();
    const claim = fakeClaim();

    expect((await service.exchangeCorrelatedCallback(claim, FLOW_ID)).kind).toBe("exchanged");
    expect(fakeClient.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);

    expect(await service.exchangeCorrelatedCallback(claim, FLOW_ID)).toEqual({
      kind: "exchange_failed",
    });
    expect(fakeClient.auth.exchangeCodeForSession).toHaveBeenCalledTimes(1);
  });

  it("reports an absent verifier as exchange_failed without leaking the provider error", async () => {
    fakeClient.auth.exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: new AuthApiError("code verifier could not be found", 400, "validation_failed"),
    });

    const outcome = await createService().exchangeCorrelatedCallback(fakeClaim(), FLOW_ID);

    expect(outcome).toEqual({ kind: "exchange_failed" });
    expect(JSON.stringify(outcome)).not.toContain("code verifier");
  });

  it("separates a retryable exchange failure from a definitive one", async () => {
    fakeClient.auth.exchangeCodeForSession.mockResolvedValueOnce({
      data: { session: null },
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });

    expect(await createService().exchangeCorrelatedCallback(fakeClaim(), FLOW_ID)).toEqual({
      kind: "temporarily_unavailable",
    });
  });

  it("reports a successful call that produced no usable identity as exchange_failed", async () => {
    fakeClient.auth.exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: null,
    });

    expect(await createService().exchangeCorrelatedCallback(fakeClaim(), FLOW_ID)).toEqual({
      kind: "exchange_failed",
    });
  });

  it("contains a thrown exchange", async () => {
    fakeClient.auth.exchangeCodeForSession.mockRejectedValue(new Error("boom"));

    expect(await createService().exchangeCorrelatedCallback(fakeClaim(), FLOW_ID)).toEqual({
      kind: "exchange_failed",
    });
  });
});

describe("createSupabaseAuthService — requestEmailOtp (unchanged six-digit flow)", () => {
  it("calls signInWithOtp with the exact email it was given, verbatim", async () => {
    fakeClient.auth.signInWithOtp.mockResolvedValue({ data: {}, error: null });

    await createService().requestEmailOtp("User.Name@Example.COM");

    expect(fakeClient.auth.signInWithOtp).toHaveBeenCalledWith({ email: "User.Name@Example.COM" });
  });

  it("normalizes a provider error to request_failed", async () => {
    fakeClient.auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: { message: "rate limited", status: 429 },
    });

    const result = await createService().requestEmailOtp("a@example.com");

    expect(result).toEqual({
      ok: false,
      error: { kind: "request_failed", message: expect.any(String) },
    });
    expect(JSON.stringify(result)).not.toContain("rate limited");
  });

  it("normalizes a thrown signInWithOtp() call to a non-fatal error", async () => {
    fakeClient.auth.signInWithOtp.mockRejectedValue(new Error("boom"));

    const result = await createService().requestEmailOtp("a@example.com");
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("temporarily_unavailable");
  });
});

describe("createSupabaseAuthService — verifyEmailOtp (unchanged six-digit flow)", () => {
  it("calls verifyOtp with exactly { email, token, type: 'email' }", async () => {
    fakeClient.auth.verifyOtp.mockResolvedValue({
      data: { session: fakeSession(), user: fakeSession().user },
      error: null,
    });

    await createService().verifyEmailOtp("a@example.com", OTP_TOKEN);

    expect(fakeClient.auth.verifyOtp).toHaveBeenCalledWith({
      email: "a@example.com",
      token: OTP_TOKEN,
      type: "email",
    });
  });

  it("returns only the minimal identity on successful verification", async () => {
    fakeClient.auth.verifyOtp.mockResolvedValue({
      data: { session: fakeSession({ id: "user-7", email: "seven@example.com" }) },
      error: null,
    });

    const result = await createService().verifyEmailOtp("seven@example.com", OTP_TOKEN);

    expect(result).toEqual({
      ok: true,
      value: { accountScopeId: "user-7", email: "seven@example.com" },
    });
    expect(JSON.stringify(result)).not.toContain(ACCESS_TOKEN);
  });

  it("fails deterministically when the provider returns no error but also no session", async () => {
    fakeClient.auth.verifyOtp.mockResolvedValue({ data: { session: null }, error: null });

    const result = await createService().verifyEmailOtp("a@example.com", OTP_TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("verification_failed");
  });

  it("normalizes a provider verification error", async () => {
    fakeClient.auth.verifyOtp.mockResolvedValue({
      data: { session: null },
      error: { message: "Token has expired or is invalid", status: 403 },
    });

    const result = await createService().verifyEmailOtp("a@example.com", OTP_TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error.kind).toBe("verification_failed");
      expect(result.error.message).not.toContain("Token has expired");
    }
  });

  it("normalizes a thrown verifyOtp() call to a non-fatal error", async () => {
    fakeClient.auth.verifyOtp.mockRejectedValue(new Error("boom"));

    const result = await createService().verifyEmailOtp("a@example.com", OTP_TOKEN);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("temporarily_unavailable");
  });
});

describe("createSupabaseAuthService — signOut", () => {
  it("calls signOut with exactly { scope: 'local' }", async () => {
    fakeClient.auth.signOut.mockResolvedValue({ error: null });

    await createService().signOut();

    expect(fakeClient.auth.signOut).toHaveBeenCalledWith({ scope: "local" });
  });

  it("never reports an offline sign-out failure as a successful local session deletion", async () => {
    fakeClient.auth.signOut.mockResolvedValueOnce({
      error: new AuthRetryableFetchError("Failed to fetch", 0),
    });
    const first = await createService().signOut();
    expect(first.ok).toBe(false);

    fakeClient.auth.signOut.mockRejectedValueOnce(new Error("offline"));
    const second = await createService().signOut();
    expect(second.ok).toBe(false);
  });

  it("normalizes a provider sign-out error", async () => {
    fakeClient.auth.signOut.mockResolvedValue({ error: { message: "internal", status: 500 } });

    const result = await createService().signOut();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("sign_out_failed");
  });

  it("normalizes a thrown signOut() call to a non-fatal error", async () => {
    fakeClient.auth.signOut.mockRejectedValue(new Error("boom"));

    const result = await createService().signOut();
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error.kind).toBe("temporarily_unavailable");
  });
});

describe("createSupabaseAuthService — nothing sensitive is ever logged", () => {
  it("logs no token, authorization code, provider error, OTP, or authorization URL across every operation", async () => {
    const logSpy = vi.spyOn(console, "log").mockImplementation(() => {});
    const errorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => {});
    const infoSpy = vi.spyOn(console, "info").mockImplementation(() => {});
    const debugSpy = vi.spyOn(console, "debug").mockImplementation(() => {});

    fakeClient.auth.getSession.mockResolvedValue({
      data: { session: fakeSession() },
      error: { message: "some provider detail", status: 500 },
    });
    fakeClient.auth.signInWithOtp.mockResolvedValue({
      data: {},
      error: { message: "some provider detail", status: 500 },
    });
    fakeClient.auth.verifyOtp.mockResolvedValue({
      data: { session: fakeSession() },
      error: { message: "some provider detail", status: 500 },
    });
    fakeClient.auth.signOut.mockResolvedValue({
      error: { message: "some provider detail", status: 500 },
    });
    fakeClient.auth.signInWithOAuth.mockResolvedValue({
      data: { provider: "google", url: authorizationUrl(), flowId: FLOW_ID },
      error: null,
    });
    fakeClient.auth.exchangeCodeForSession.mockResolvedValue({
      data: { session: null },
      error: { message: "some provider detail", status: 400 },
    });

    const service = createService();
    await service.restoreSession();
    await service.requestEmailOtp("a@example.com");
    await service.verifyEmailOtp("a@example.com", OTP_TOKEN);
    await service.signOut();
    await service.prepareGoogleSignIn(CALLBACK_TARGET);
    service.navigateToAuthorizationUrl({ authorizationUrl: authorizationUrl(), flowId: FLOW_ID });
    await service.exchangeCorrelatedCallback(fakeClaim(), FLOW_ID);

    const sensitive = [
      ACCESS_TOKEN,
      REFRESH_TOKEN,
      OTP_TOKEN,
      AUTHORIZATION_CODE,
      "some provider detail",
      "code_challenge",
    ];
    for (const spy of [logSpy, errorSpy, warnSpy, infoSpy, debugSpy]) {
      for (const call of spy.mock.calls) {
        for (const arg of call) {
          const text = typeof arg === "string" ? arg : JSON.stringify(arg);
          for (const value of sensitive) {
            expect(text).not.toContain(value);
          }
        }
      }
    }
  });
});
