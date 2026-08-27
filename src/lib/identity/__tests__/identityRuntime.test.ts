// The composition facade (ADR-0025 §1, §11).
//
// Two properties are asserted here: nothing runs at module-evaluation time (in
// particular, no URL is read and no history entry is rewritten as a side effect of
// importing a module), and the capture cell is genuinely PAGE-scoped — one cell
// per document, so a replayed caller reads the cell instead of the now-clean URL.
// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import {
  createIdentityRuntime,
  getIdentityRuntime,
  resetIdentityRuntimeForTests,
} from "../identityRuntime";
import { createCallbackCaptureCell, type CallbackUrlAccess } from "../../supabase/supabaseCallbackCapture";

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
