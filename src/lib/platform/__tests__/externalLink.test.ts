// @vitest-environment jsdom
//
// Opening public documents without destroying the running native app
// (Stage M3a).
import { describe, expect, it, vi } from "vitest";
import {
  openExternalLink,
  resolveNativeExternalUrl,
  type ExternalLinkDependencies,
} from "../externalLink";
import type { ApiTargetResolution, ApiTargetResolver } from "../apiTarget";

const CONFIGURED_ORIGIN = "https://curling.example.test";

const nativeTarget: ApiTargetResolver = () => ({
  status: "resolved",
  target: { kind: "native_configured", origin: CONFIGURED_ORIGIN },
});

const webTarget: ApiTargetResolver = () => ({
  status: "resolved",
  target: { kind: "web_document", origin: "capacitor://localhost" },
});

const unavailableTarget: ApiTargetResolver = () => ({
  status: "unavailable",
  reason: "native_api_origin_not_configured",
});

describe("resolving a native destination", () => {
  it.each(["/privacy", "/terms", "/legal/privacy/2026-08-28"])(
    "resolves the app-relative route %s against the configured public origin",
    (route) => {
      expect(resolveNativeExternalUrl(route, nativeTarget)).toEqual({
        url: `${CONFIGURED_ORIGIN}${route}`,
      });
    }
  );

  it("never resolves a relative route against the local app scheme", () => {
    // `capacitor://localhost/privacy` serves nothing: the legal documents are
    // Next pages on the public origin, not files in the bundle.
    const resolved = resolveNativeExternalUrl("/privacy", webTarget);
    expect(resolved).toEqual({ rejected: "origin" });
    expect(JSON.stringify(resolved)).not.toContain("capacitor://");
  });

  it("reports an unresolvable origin distinctly from a bad destination", () => {
    expect(resolveNativeExternalUrl("/privacy", unavailableTarget)).toEqual({
      rejected: "origin",
    });
  });

  it("preserves an absolute versioned legal URL exactly", () => {
    // The gate's legal links come from trusted server metadata and name a
    // SPECIFIC document version. Substituting a generic page would show the
    // wrong document.
    const versioned = "https://curling.example.test/legal/privacy/2026-08-28";
    expect(resolveNativeExternalUrl(versioned, nativeTarget)).toEqual({ url: versioned });
  });

  it("allows an approved third-party https destination", () => {
    const regulator = "https://www.edoeb.admin.ch/en";
    expect(resolveNativeExternalUrl(regulator, nativeTarget)).toEqual({ url: regulator });
  });

  it.each([
    ["javascript", "javascript:alert(1)"],
    ["data", "data:text/html,<p>x"],
    ["file", "file:///etc/passwd"],
    ["blob", "blob:https://x/y"],
    ["mailto", "mailto:info@example.test"],
    ["capacitor", "capacitor://localhost/privacy"],
    ["plain http", "http://example.test/privacy"],
    ["protocol-relative", "//evil.test/privacy"],
    ["credentialed", "https://user:pass@example.test/privacy"],
    ["an empty string", ""],
    ["a bare word", "privacy"],
    ["a route with whitespace", "/privacy notice"],
    ["a route with a newline", "/privacy\nhttps://evil.test"],
  ])("rejects the %s destination", (_label, href) => {
    expect(resolveNativeExternalUrl(href, nativeTarget)).toEqual({
      rejected: "destination",
    });
  });
});

describe("opening a link", () => {
  function deps(overrides: Partial<ExternalLinkDependencies> = {}): ExternalLinkDependencies {
    return { platform: "ios", resolveTarget: nativeTarget, ...overrides };
  }

  it("leaves the Web anchor entirely alone", async () => {
    const open = vi.fn();
    const outcome = await openExternalLink("/privacy", {
      platform: "web",
      openInPlatformBrowser: open,
    });

    expect(outcome).toEqual({ kind: "handled_by_anchor" });
    expect(open).not.toHaveBeenCalled();
  });

  it.each(["ios", "android"] as const)(
    "opens the platform browser on %s — adapter evidence only, not device verification",
    async (platform) => {
      const open = vi.fn(async () => {});
      const outcome = await openExternalLink("/terms", deps({ platform, openInPlatformBrowser: open }));

      expect(outcome).toEqual({ kind: "opened_in_platform_browser" });
      expect(open).toHaveBeenCalledWith(`${CONFIGURED_ORIGIN}/terms`);
    }
  );

  it("attaches no token, code or private state to the destination", async () => {
    const opened: string[] = [];
    const open = vi.fn(async (url: string) => {
      opened.push(url);
    });
    await openExternalLink("/privacy", deps({ openInPlatformBrowser: open }));

    expect(opened).toHaveLength(1);
    expect(opened[0]).toBe(`${CONFIGURED_ORIGIN}/privacy`);
    expect(opened[0]).not.toMatch(/token|access|bearer|code=|session/i);
    expect(new URL(opened[0]).search).toBe("");
    expect(new URL(opened[0]).hash).toBe("");
  });

  it("does not invoke the browser for a rejected destination", async () => {
    const open = vi.fn(async () => {});
    const outcome = await openExternalLink("javascript:alert(1)", deps({ openInPlatformBrowser: open }));

    expect(outcome).toEqual({ kind: "rejected_destination" });
    expect(open).not.toHaveBeenCalled();
  });

  it("does not invoke the browser when the origin is unavailable", async () => {
    const open = vi.fn(async () => {});
    const outcome = await openExternalLink(
      "/privacy",
      deps({ resolveTarget: unavailableTarget, openInPlatformBrowser: open })
    );

    expect(outcome).toEqual({ kind: "origin_unavailable" });
    expect(open).not.toHaveBeenCalled();
  });

  it("reports a launch failure without navigating the application away", async () => {
    const open = vi.fn(async () => {
      throw new Error("no browser");
    });
    const outcome = await openExternalLink("/privacy", deps({ openInPlatformBrowser: open }));

    // A named outcome, not a thrown error and not a WebView navigation.
    expect(outcome).toEqual({ kind: "open_failed" });
  });

  it("refuses an unsupported native platform rather than falling through", async () => {
    const open = vi.fn(async () => {});
    const outcome = await openExternalLink(
      "/privacy",
      deps({ platform: "unsupported_native", openInPlatformBrowser: open })
    );

    expect(outcome).toEqual({ kind: "browser_unavailable" });
    expect(open).not.toHaveBeenCalled();
  });

  it("is not selected by a user-agent string", async () => {
    // An iOS-looking user agent in an ordinary browser must NOT switch the app
    // onto the native path; only the injected Capacitor bridge does that.
    Object.defineProperty(window.navigator, "userAgent", {
      value: "Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X) Capacitor",
      configurable: true,
    });
    const open = vi.fn(async () => {});

    const outcome = await openExternalLink("/privacy", {
      resolveTarget: nativeTarget,
      openInPlatformBrowser: open,
    });

    expect(outcome).toEqual({ kind: "handled_by_anchor" });
    expect(open).not.toHaveBeenCalled();
  });

  it("never throws, even when the target resolver does", async () => {
    // An exception escaping into a click handler would be an unhandled
    // rejection in the UI; a misbehaving resolver is just an unresolvable
    // origin.
    const exploding: ApiTargetResolver = () => {
      throw new Error("resolver exploded");
    };
    const open = vi.fn(async () => {});

    const outcome = await openExternalLink(
      "/privacy",
      deps({ resolveTarget: exploding, openInPlatformBrowser: open })
    );

    expect(outcome).toEqual({ kind: "origin_unavailable" });
    expect(open).not.toHaveBeenCalled();
  });
});

describe("type surface", () => {
  it("keeps the resolution shape narrow", () => {
    const resolution: ApiTargetResolution = nativeTarget();
    expect(resolution.status).toBe("resolved");
  });
});
