// @vitest-environment jsdom
//
// Evidence about the INSTALLED Supabase SDK, not about this app's own mapping
// (that is supabaseAuthService.test.ts). ADR-0025 Decision 10 makes three
// provider facts load-bearing, and this file fails loudly if any of them stops
// being true:
//
//   1. `signInWithOAuth` returns a non-secret `flowId`, and
//      `experimental.appendPkceFlowIdToRedirects` round-trips it into the
//      redirect target — the whole basis for correlating a callback.
//   2. `exchangeCodeForSession` persists the session and emits SIGNED_IN
//      BEFORE it resolves, which is why no normalized event may open the app.
//   3. `verifyOtp` does the same.
//
// No network: `signInWithOAuth` builds its URL locally, and the two exchanges
// run against an injected fake `fetch`. These tests make NO claim that any of
// this resolves a barrier or authorizes entry — (2) and (3) are precisely the
// reason it cannot.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createClient } from "@supabase/supabase-js";
import { readFileSync, readdirSync } from "node:fs";
import { join, relative } from "node:path";
import { BROWSER_AUTH_OPTIONS } from "../supabaseClient";
import { isValidFlowSelector } from "../supabaseCallbackClassifier";

const SUPABASE_URL = "https://compat.supabase.co";
// A syntactically valid, entirely fictional local test key. It reaches no
// server: every request in this file is served by an injected fake `fetch`.
const PUBLISHABLE_KEY = "sb_publishable_" + "c".repeat(24);
const APP_CALLBACK = "https://app.example.test/";

function tokenResponseBody(userId: string) {
  return {
    access_token: "compat-access-token",
    token_type: "bearer",
    expires_in: 3600,
    expires_at: Math.floor(Date.now() / 1000) + 3600,
    refresh_token: "compat-refresh-token",
    user: {
      id: userId,
      aud: "authenticated",
      role: "authenticated",
      email: "compat@example.test",
      app_metadata: {},
      user_metadata: {},
      created_at: "2024-01-01T00:00:00.000Z",
    },
  };
}

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { "Content-Type": "application/json" },
  });
}

/** A client built with EXACTLY the production auth options, plus an injected
 * fake transport so nothing leaves the process. A unique storage key per test
 * keeps stored verifiers and sessions from bleeding across tests. */
function compatClient(
  fetchImpl: typeof fetch,
  storageKey: string
): ReturnType<typeof createClient> {
  return createClient(SUPABASE_URL, PUBLISHABLE_KEY, {
    auth: { ...BROWSER_AUTH_OPTIONS, storageKey },
    global: { fetch: fetchImpl },
  });
}

beforeEach(() => {
  window.localStorage.clear();
});

afterEach(() => {
  window.localStorage.clear();
});

describe("installed SDK — signInWithOAuth exposes a flow selector and round-trips it", () => {
  it("returns a well-formed non-secret flowId and appends it to the redirect target", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const client = compatClient(fetchImpl as unknown as typeof fetch, "compat-oauth");

    const { data, error } = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: APP_CALLBACK, skipBrowserRedirect: true },
    });

    expect(error).toBeNull();
    // If this fails, the installed SDK no longer exposes a flow id and Google
    // sign-in must fail closed — Stage B0.2's Google support is not complete.
    expect(typeof data.flowId).toBe("string");
    expect(isValidFlowSelector(data.flowId)).toBe(true);

    // No navigation and no network: the authorization URL is built locally.
    expect(fetchImpl).not.toHaveBeenCalled();
    expect(data.url).toBeTruthy();

    const authorize = new URL(data.url!);
    expect(authorize.origin).toBe(SUPABASE_URL);
    const redirectTo = authorize.searchParams.get("redirect_to");
    expect(redirectTo).toBeTruthy();
    // The flag is what makes the selector travel through the redirect; without
    // it there is no way to correlate a callback to its verifier.
    expect(new URL(redirectTo!).searchParams.get("sb_flow_id")).toBe(data.flowId);
    // The PKCE challenge travels; the verifier itself never appears in a URL.
    expect(authorize.searchParams.get("code_challenge")).toBeTruthy();
    // The exact method string the strict authorization-route validator in
    // supabaseAuthService.ts requires. If the installed SDK ever emitted `plain`
    // here — which it does when no WebCrypto digest is available — that
    // validator would refuse to navigate, so this pins the fact rather than
    // assuming it.
    expect(authorize.searchParams.get("code_challenge_method")).toBe("s256");
    // Exactly one of each security-relevant parameter, which is what makes the
    // validator's duplicate check a real constraint rather than a theoretical one.
    for (const param of ["provider", "redirect_to", "code_challenge", "code_challenge_method"]) {
      expect(authorize.searchParams.getAll(param), param).toHaveLength(1);
    }
    // The endpoint the validator pins, not merely the right host.
    expect(authorize.pathname).toBe("/auth/v1/authorize");
  });

  it("keeps concurrent flows apart, each with its own selector", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({}));
    const client = compatClient(fetchImpl as unknown as typeof fetch, "compat-concurrent");

    const first = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: APP_CALLBACK, skipBrowserRedirect: true },
    });
    const second = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: APP_CALLBACK, skipBrowserRedirect: true },
    });

    expect(first.data.flowId).not.toBe(second.data.flowId);
  });
});

describe("installed SDK — exchangeCodeForSession persists and emits before resolving", () => {
  it("has already saved the session and emitted SIGNED_IN by the time it resolves", async () => {
    const storageKey = "compat-exchange";
    const fetchImpl = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url.includes("/token")) return jsonResponse(tokenResponseBody("compat-user-1"));
      return jsonResponse({});
    });
    const client = compatClient(fetchImpl as unknown as typeof fetch, storageKey);

    // Start a real flow so a real verifier exists for this selector.
    const prepared = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: APP_CALLBACK, skipBrowserRedirect: true },
    });
    const flowId = prepared.data.flowId!;

    const observed: Array<{ event: string; hadSession: boolean; storedBeforeResolve: boolean }> = [];
    const { data: subscription } = client.auth.onAuthStateChange((event, session) => {
      if (event === "INITIAL_SESSION") return;
      observed.push({
        event,
        hadSession: session !== null,
        storedBeforeResolve: window.localStorage.getItem(storageKey) !== null,
      });
    });

    const { data, error } = await client.auth.exchangeCodeForSession("compat-auth-code", { flowId });
    subscription.subscription.unsubscribe();

    expect(error).toBeNull();
    expect(data.session).toBeTruthy();
    // The event fired, carried a session, and the session was ALREADY in
    // storage — all strictly before this code could evaluate the result. A
    // post-hoc verdict therefore cannot undo it, which is exactly why access is
    // never granted from an event (ADR-0025 Decision 3).
    expect(observed).toEqual([
      { event: "SIGNED_IN", hadSession: true, storedBeforeResolve: true },
    ]);
  });

  it("fails when the explicit selector has no stored verifier, and does not borrow another flow's", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(tokenResponseBody("compat-user-2")));
    const client = compatClient(fetchImpl as unknown as typeof fetch, "compat-no-verifier");

    // A real, valid verifier exists for THIS flow...
    await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: APP_CALLBACK, skipBrowserRedirect: true },
    });

    // ...but the exchange names a different, unknown selector.
    const { data, error } = await client.auth.exchangeCodeForSession("compat-auth-code", {
      flowId: "0f9e8d7c6b5a493827160f5e4d3c2b1a",
    });

    expect(error).toBeTruthy();
    expect(data.session).toBeNull();
    // No token request was made at all — the verifier lookup failed fast.
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it("consumes the verifier, so a replayed exchange of the same selector fails", async () => {
    const fetchImpl = vi.fn(async () => jsonResponse(tokenResponseBody("compat-user-3")));
    const client = compatClient(fetchImpl as unknown as typeof fetch, "compat-replay");
    const prepared = await client.auth.signInWithOAuth({
      provider: "google",
      options: { redirectTo: APP_CALLBACK, skipBrowserRedirect: true },
    });
    const flowId = prepared.data.flowId!;

    expect((await client.auth.exchangeCodeForSession("compat-auth-code", { flowId })).error).toBeNull();
    const replay = await client.auth.exchangeCodeForSession("compat-auth-code", { flowId });

    expect(replay.error).toBeTruthy();
    expect(replay.data.session).toBeNull();
  });
});

describe("installed SDK — verifyOtp persists and emits before resolving", () => {
  it("has already saved the session and emitted SIGNED_IN by the time it resolves", async () => {
    const storageKey = "compat-verify";
    const fetchImpl = vi.fn(async () => jsonResponse(tokenResponseBody("compat-user-4")));
    const client = compatClient(fetchImpl as unknown as typeof fetch, storageKey);

    const observed: Array<{ event: string; storedBeforeResolve: boolean }> = [];
    const { data: subscription } = client.auth.onAuthStateChange((event) => {
      if (event === "INITIAL_SESSION") return;
      observed.push({ event, storedBeforeResolve: window.localStorage.getItem(storageKey) !== null });
    });

    const { data, error } = await client.auth.verifyOtp({
      email: "compat@example.test",
      token: "123456",
      type: "email",
    });
    subscription.subscription.unsubscribe();

    expect(error).toBeNull();
    expect(data.session).toBeTruthy();
    expect(observed).toEqual([{ event: "SIGNED_IN", storedBeforeResolve: true }]);
  });
});

describe("the browser client's auth options are exactly the three ADR-0025 requires", () => {
  it("pins flowType, detectSessionInUrl and the PKCE flow-id flag", () => {
    expect(BROWSER_AUTH_OPTIONS).toEqual({
      flowType: "pkce",
      detectSessionInUrl: false,
      experimental: { appendPkceFlowIdToRedirects: true },
    });
  });
});

describe("no code path exchanges a callback without an explicit flow selector", () => {
  const SRC_ROOT = join(process.cwd(), "src");

  function collectSourceFiles(dir: string): string[] {
    const files: string[] = [];
    for (const entry of readdirSync(dir, { withFileTypes: true })) {
      const fullPath = join(dir, entry.name);
      if (entry.isDirectory()) files.push(...collectSourceFiles(fullPath));
      else if (/\.tsx?$/.test(entry.name) && !entry.name.endsWith(".d.ts")) files.push(fullPath);
    }
    return files;
  }

  function stripComments(source: string): string {
    return source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  }

  /** Matches `exchangeCodeForSession(` and captures everything up to the
   * matching close paren, so a call with no second argument is detectable. */
  const CALL_PATTERN = /exchangeCodeForSession\s*\(([^()]*(?:\([^()]*\)[^()]*)*)\)/g;

  it("the detector itself distinguishes an explicit selector from the prohibited no-selector form (non-vacuous)", () => {
    const withSelector = 'await client.auth.exchangeCodeForSession(code, { flowId: expectedFlowId });';
    const withoutSelector = "await client.auth.exchangeCodeForSession(code);";

    const explicit = [...withSelector.matchAll(CALL_PATTERN)].map((m) => m[1]);
    const bare = [...withoutSelector.matchAll(CALL_PATTERN)].map((m) => m[1]);

    expect(explicit).toHaveLength(1);
    expect(explicit[0]).toContain("flowId");
    expect(bare).toHaveLength(1);
    expect(bare[0]).not.toContain("flowId");
  });

  it("every production call in src/ passes an explicit flowId", () => {
    // Production code only. Test files deliberately contain the prohibited
    // no-selector form as a negative fixture (see the detector test above), and
    // the prohibition is about reachable code paths.
    const productionFiles = collectSourceFiles(SRC_ROOT).filter(
      (path) => !path.includes("__tests__") && !/\.test\.tsx?$/.test(path)
    );
    const offenders: string[] = [];
    let callsFound = 0;
    for (const path of productionFiles) {
      const code = stripComments(readFileSync(path, "utf8"));
      for (const match of code.matchAll(CALL_PATTERN)) {
        callsFound += 1;
        if (!/\bflowId\b/.test(match[1])) offenders.push(`${relative(SRC_ROOT, path)}: ${match[0]}`);
      }
    }
    // Non-vacuous: the one production exchange really was found and inspected.
    expect(callsFound).toBe(1);
    expect(offenders).toEqual([]);
  });
});
