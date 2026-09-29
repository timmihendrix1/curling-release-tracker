// @vitest-environment jsdom
//
// Which destination each platform's authorized requests may reach (ADR-0047).
//
// Two halves, deliberately separated:
//
//  - the PURE decision (`resolveApiTargetFrom`), where every hostile input is
//    reachable without a device;
//  - the PRODUCTION resolver (`resolveApiTarget`), driven through the REAL
//    Capacitor platform detection. That detection reads the bridge objects the
//    native runtime injects on `window` (`androidBridge`, `webkit.messageHandlers
//    .bridge`), so simulating a platform here means installing those objects —
//    the same signal the device uses — not stubbing our own module.
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resolveApiTarget, resolveApiTargetFrom } from "../apiTarget";
import { detectRuntimePlatform } from "../runtimePlatform";

const CONFIGURED = { status: "configured", origin: "https://api.example.test" } as const;
const NOT_CONFIGURED = { status: "not_configured" } as const;
const INVALID = { status: "invalid", reason: "non_https_scheme" } as const;

type BridgeWindow = Window & {
  androidBridge?: unknown;
  webkit?: { messageHandlers?: { bridge?: unknown } };
};

function asBridgeWindow(): BridgeWindow {
  return window as unknown as BridgeWindow;
}

function clearNativeBridges(): void {
  delete asBridgeWindow().androidBridge;
  delete asBridgeWindow().webkit;
}

/** Installs the exact object iOS's WKWebView bridge injects. */
function simulateIos(): void {
  clearNativeBridges();
  asBridgeWindow().webkit = { messageHandlers: { bridge: {} } };
}

/** Installs the exact object the Android bridge injects. */
function simulateAndroid(): void {
  clearNativeBridges();
  asBridgeWindow().androidBridge = {};
}

beforeEach(clearNativeBridges);

afterEach(() => {
  clearNativeBridges();
  vi.unstubAllEnvs();
});

describe("API target — the pure decision", () => {
  it("uses the document origin on Web, exactly as before", () => {
    expect(
      resolveApiTargetFrom("web", "https://app.example.test", NOT_CONFIGURED)
    ).toEqual({
      status: "resolved",
      target: { kind: "web_document", origin: "https://app.example.test" },
    });
  });

  it("does not let a configured native origin retarget Web requests", () => {
    // The whole point of the Web branch: shipping the native configuration must
    // change nothing about the browser application.
    expect(resolveApiTargetFrom("web", "https://app.example.test", CONFIGURED)).toEqual({
      status: "resolved",
      target: { kind: "web_document", origin: "https://app.example.test" },
    });
  });

  it("fails closed on Web when there is no document origin", () => {
    expect(resolveApiTargetFrom("web", null, CONFIGURED)).toEqual({
      status: "unavailable",
      reason: "no_document_origin",
    });
  });

  it.each(["ios", "android"] as const)("uses the configured origin on %s", (platform) => {
    expect(resolveApiTargetFrom(platform, "capacitor://localhost", CONFIGURED)).toEqual({
      status: "resolved",
      target: { kind: "native_configured", origin: "https://api.example.test" },
    });
  });

  it.each(["ios", "android"] as const)(
    "never falls back to the WebView origin on %s",
    (platform) => {
      // The document origin is present and is NOT used. A native build with no
      // configured API origin has no destination at all.
      expect(
        resolveApiTargetFrom(platform, "capacitor://localhost", NOT_CONFIGURED)
      ).toEqual({ status: "unavailable", reason: "native_api_origin_not_configured" });
      expect(resolveApiTargetFrom(platform, "capacitor://localhost", INVALID)).toEqual({
        status: "unavailable",
        reason: "native_api_origin_invalid",
      });
    }
  );

  it("refuses an unrecognized native platform instead of treating it as Web", () => {
    // A future platform must fail closed rather than silently inherit the Web
    // document-origin fallback — which here would be the app scheme.
    expect(
      resolveApiTargetFrom("unsupported_native", "https://app.example.test", CONFIGURED)
    ).toEqual({ status: "unavailable", reason: "unsupported_platform" });
  });
});

describe("platform detection — the real Capacitor signal", () => {
  it("reports web when no native bridge is present", () => {
    expect(detectRuntimePlatform()).toBe("web");
  });

  it("reports ios when the WKWebView bridge is present", () => {
    simulateIos();
    expect(detectRuntimePlatform()).toBe("ios");
  });

  it("reports android when the Android bridge is present", () => {
    simulateAndroid();
    expect(detectRuntimePlatform()).toBe("android");
  });

  it("is not a user-agent heuristic", () => {
    // An attacker-controllable string must not be able to claim a platform.
    Object.defineProperty(window.navigator, "userAgent", {
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Capacitor",
      configurable: true,
    });
    expect(detectRuntimePlatform()).toBe("web");
  });
});

describe("API target — the production resolver", () => {
  it("resolves the document origin on Web", () => {
    vi.stubEnv("NEXT_PUBLIC_NATIVE_API_ORIGIN", "https://api.example.test");
    const resolution = resolveApiTarget();
    expect(resolution).toEqual({
      status: "resolved",
      target: { kind: "web_document", origin: window.location.origin },
    });
  });

  it.each([
    ["ios", simulateIos],
    ["android", simulateAndroid],
  ])("resolves the configured origin on %s", (_platform, simulate) => {
    simulate();
    vi.stubEnv("NEXT_PUBLIC_NATIVE_API_ORIGIN", "https://api.example.test");
    expect(resolveApiTarget()).toEqual({
      status: "resolved",
      target: { kind: "native_configured", origin: "https://api.example.test" },
    });
  });

  it.each([
    ["ios", simulateIos],
    ["android", simulateAndroid],
  ])("fails closed on %s with no configured origin", (_platform, simulate) => {
    simulate();
    vi.stubEnv("NEXT_PUBLIC_NATIVE_API_ORIGIN", "");
    expect(resolveApiTarget()).toEqual({
      status: "unavailable",
      reason: "native_api_origin_not_configured",
    });
  });

  it.each([
    ["ios", simulateIos],
    ["android", simulateAndroid],
  ])("fails closed on %s with a hostile configured origin", (_platform, simulate) => {
    simulate();
    vi.stubEnv("NEXT_PUBLIC_NATIVE_API_ORIGIN", "http://evil.example.test/steal");
    expect(resolveApiTarget()).toEqual({
      status: "unavailable",
      reason: "native_api_origin_invalid",
    });
  });
});
