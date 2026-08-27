// The composition facade (ADR-0025 §1, §11).
//
// Two properties are asserted here: nothing runs at module-evaluation time (in
// particular, no URL is read and no history entry is rewritten as a side effect of
// importing a module), and the capture cell is genuinely PAGE-scoped — one cell
// per document, so a replayed caller reads the cell instead of the now-clean URL.
// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  createIdentityRuntime,
  getIdentityRuntime,
  resetIdentityRuntimeForTests,
} from "../identityRuntime";
import { createCallbackCaptureCell, type CallbackUrlAccess } from "../../supabase/supabaseCallbackCapture";

afterEach(() => {
  vi.restoreAllMocks();
  window.history.replaceState(null, "", "/");
});

function dependenciesWithIntentSave(save: (intent: unknown) => Promise<{ ok: boolean }>) {
  return {
    auth: { onAuthChange: () => () => {} } as never,
    identity: {} as never,
    capture: {} as never,
    barriers: {} as never,
    attempts: {} as never,
    resolutions: {} as never,
    trusted: {} as never,
    intents: { save } as never,
    liveGeneration: { current: () => 0, bump: () => 1 },
    now: () => "2026-08-27T10:00:00.000Z",
    newId: () => "11111111-1111-4111-8111-111111111111",
    resolveRedirectTarget: () => null,
  };
}

describe("no side effect at import or construction", () => {
  it("importing the module reads no URL and rewrites no history entry", () => {
    // If capture ran at import time it would already have replaced the URL by the
    // time this test body runs.
    expect(window.location.search).toBe("");
  });

  it("constructing a runtime does not touch the injected window seam", () => {
    const readCurrentUrl = vi.fn(() => "https://app.example.test/?code=x&sb_flow_id=y");
    const replaceCurrentUrl = vi.fn();
    const access: CallbackUrlAccess = { readCurrentUrl, replaceCurrentUrl };
    const cell = createCallbackCaptureCell(access);

    createIdentityRuntime({}, cell);

    // Capture happens later, from `startUp()`, which its caller invokes from a
    // guarded lifecycle boundary — never during render and never at construction.
    expect(readCurrentUrl).not.toHaveBeenCalled();
    expect(replaceCurrentUrl).not.toHaveBeenCalled();
  });
});

describe("cloud availability", () => {
  it("reports cloud_unavailable when no cloud is configured", () => {
    // The test environment has no NEXT_PUBLIC_SUPABASE_* values, so this is the
    // real resolution path, not a stub.
    expect(createIdentityRuntime().status).toBe("cloud_unavailable");
  });

  it("with no cloud there is no coordinator to reach", () => {
    const runtime = createIdentityRuntime();
    expect(runtime.status).toBe("cloud_unavailable");
    if (runtime.status === "cloud_unavailable") {
      expect(Object.keys(runtime)).toEqual(["status"]);
    }
  });
});

describe("the page-scoped cache", () => {
  it("returns the SAME runtime for the whole document lifetime", () => {
    resetIdentityRuntimeForTests();
    const first = getIdentityRuntime();
    const second = getIdentityRuntime();
    // Two callers must not each get their own capture cell: the second would read
    // an already-cleaned URL and conclude no callback arrived.
    expect(second).toBe(first);
  });

  it("a reset models a genuinely new page load", () => {
    resetIdentityRuntimeForTests();
    const first = getIdentityRuntime();
    resetIdentityRuntimeForTests();
    expect(getIdentityRuntime()).not.toBe(first);
  });
});

describe("the injected-dependency seam", () => {
  it("builds a coordinator from a supplied dependency set without constructing a client", () => {
    // Used by tests that need fakes for every seam; production callers never pass
    // this.
    const runtime = createIdentityRuntime({
      deps: {
        auth: {} as never,
        identity: {} as never,
        capture: {} as never,
        barriers: {} as never,
        attempts: {} as never,
        resolutions: {} as never,
        trusted: {} as never,
        intents: {} as never,
        liveGeneration: { current: () => 0, bump: () => 1 },
        now: () => "2026-03-01T10:00:00.000Z",
        newId: () => "11111111-1111-4111-8111-111111111111",
        resolveRedirectTarget: () => null,
      },
    });
    expect(runtime.status).toBe("ready");
    if (runtime.status === "ready") {
      expect(typeof runtime.coordinator.startUp).toBe("function");
      expect(typeof runtime.coordinator.signOut).toBe("function");
      expect(typeof runtime.coordinator.classifyAuthChange).toBe("function");
    }
  });
});

describe("Team deep-link capture", () => {
  it("performs one durable capture when lifecycle callers race on the same page", async () => {
    let releaseSave = () => {};
    const saveGate = new Promise<void>((resolve) => { releaseSave = resolve; });
    const save = vi.fn(async () => {
      await saveGate;
      return { ok: true };
    });
    window.history.replaceState(null, "", "/?inviteToken=opaque-token");
    const runtime = createIdentityRuntime({ deps: dependenciesWithIntentSave(save) });
    if (runtime.status !== "ready") throw new Error("expected ready runtime");

    const first = runtime.captureCurrentDeepLinkIntent();
    const second = runtime.captureCurrentDeepLinkIntent();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(save).toHaveBeenCalledTimes(1));
    releaseSave();

    await expect(first).resolves.toMatchObject({ kind: "captured" });
    expect(save).toHaveBeenCalledTimes(1);
  });

  it("persists the validated intent before removing only application-owned query parameters", async () => {
    const save = vi.fn(async () => ({ ok: true }));
    window.history.replaceState(null, "", "/?inviteToken=opaque-token&keep=1");
    const runtime = createIdentityRuntime({ deps: dependenciesWithIntentSave(save) });
    if (runtime.status !== "ready") throw new Error("expected ready runtime");

    const outcome = await runtime.captureCurrentDeepLinkIntent();

    expect(outcome).toMatchObject({ kind: "captured", intent: { kind: "invitation", value: "opaque-token" } });
    expect(save).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("?keep=1");
  });

  it("keeps the URL intact when durable capture cannot be proven", async () => {
    const save = vi.fn(async () => ({ ok: false }));
    window.history.replaceState(null, "", "/?inviteToken=opaque-token&keep=1");
    const runtime = createIdentityRuntime({ deps: dependenciesWithIntentSave(save) });
    if (runtime.status !== "ready") throw new Error("expected ready runtime");

    expect(await runtime.captureCurrentDeepLinkIntent()).toEqual({ kind: "blocked" });
    expect(window.location.search).toBe("?inviteToken=opaque-token&keep=1");
  });

  it("removes malformed owned parameters without touching unrelated URL state", async () => {
    const save = vi.fn(async () => ({ ok: true }));
    window.history.replaceState(null, "", "/?adminRequestId=not-a-uuid&keep=1");
    const runtime = createIdentityRuntime({ deps: dependenciesWithIntentSave(save) });
    if (runtime.status !== "ready") throw new Error("expected ready runtime");

    expect(await runtime.captureCurrentDeepLinkIntent()).toEqual({ kind: "invalid" });
    expect(save).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?keep=1");
  });

  it("fails closed when URL cleanup throws after durable capture", async () => {
    const save = vi.fn(async () => ({ ok: true }));
    window.history.replaceState(null, "", "/?inviteToken=opaque-token&keep=1");
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {
      throw new Error("secret URL material");
    });
    const runtime = createIdentityRuntime({ deps: dependenciesWithIntentSave(save) });
    if (runtime.status !== "ready") throw new Error("expected ready runtime");

    await expect(runtime.captureCurrentDeepLinkIntent()).resolves.toEqual({ kind: "blocked" });
    expect(save).toHaveBeenCalledTimes(1);
    expect(window.location.search).toBe("?inviteToken=opaque-token&keep=1");
  });

  it("fails closed when malformed-parameter cleanup throws", async () => {
    const save = vi.fn(async () => ({ ok: true }));
    window.history.replaceState(null, "", "/?adminRequestId=not-a-uuid&keep=1");
    vi.spyOn(window.history, "replaceState").mockImplementation(() => {
      throw Symbol("uninspectable URL failure");
    });
    const runtime = createIdentityRuntime({ deps: dependenciesWithIntentSave(save) });
    if (runtime.status !== "ready") throw new Error("expected ready runtime");

    await expect(runtime.captureCurrentDeepLinkIntent()).resolves.toEqual({ kind: "blocked" });
    expect(save).not.toHaveBeenCalled();
    expect(window.location.search).toBe("?adminRequestId=not-a-uuid&keep=1");
  });
});
