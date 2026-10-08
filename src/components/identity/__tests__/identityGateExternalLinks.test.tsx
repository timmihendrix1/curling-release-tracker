// @vitest-environment jsdom
//
// The signed-out gate's own privacy link, through the REAL screen.
//
// An independent review found that only `LegalLink` had been migrated to the
// shared external-document boundary: `SignInChoices` still rendered
// `privacyHref` through a plain `target="_blank"` anchor. On native that anchor
// navigates the application WebView away — the person has to force-quit to get
// back — and neither a helper-only test nor an anchor-attribute check on
// Settings could see it.
//
// So this renders the actual `IdentityGateScreen` in its signed-out state, on a
// native platform, and asserts the click is prevented and the platform browser
// is invoked.
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const PRIVACY_HREF = "https://curling.example.test/legal/privacy/2026-08-28";

const identityState = {
  state: {
    kind: "signed_out",
    legal: { privacy: { href: PRIVACY_HREF, versionLabel: "2026-08-28" } },
  },
};

vi.mock("../IdentityProvider", () => ({
  useIdentity: () => identityState,
  useOptionalIdentity: () => identityState,
}));

const detectRuntimePlatform = vi.hoisted(() => vi.fn(() => "web"));
vi.mock("../../../lib/platform/runtimePlatform", () => ({ detectRuntimePlatform }));

const openedUrls = vi.hoisted(() => [] as string[]);
const openInPlatformBrowser = vi.hoisted(() => vi.fn());
vi.mock("@capacitor/browser", () => ({
  Browser: {
    open: async ({ url }: { url: string }) => {
      openedUrls.push(url);
      openInPlatformBrowser();
    },
  },
}));
vi.mock("@capacitor/core", () => ({
  Capacitor: { isPluginAvailable: () => true, getPlatform: () => "ios", isNativePlatform: () => true },
}));

import IdentityGateScreen from "../IdentityGateScreen";

beforeEach(() => {
  openedUrls.length = 0;
  openInPlatformBrowser.mockClear();
  detectRuntimePlatform.mockReturnValue("web");
});

afterEach(cleanup);

function clickPrivacyLink(): { event: MouseEvent; link: HTMLElement } {
  const link = screen.getByRole("link", { name: /Privacy Notice \(2026-08-28\)/ });
  const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
  return { event, link };
}

describe("the signed-out gate's privacy link", () => {
  it("renders the exact versioned URL trusted metadata supplied", () => {
    render(<IdentityGateScreen />);

    // Not a generic /privacy page — the specific version the server named.
    expect(clickPrivacyLink().link).toHaveAttribute("href", PRIVACY_HREF);
  });

  it("keeps ordinary Web anchor behaviour", async () => {
    render(<IdentityGateScreen />);
    const { event, link } = clickPrivacyLink();

    await act(async () => {
      link.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(openInPlatformBrowser).not.toHaveBeenCalled();
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noreferrer noopener");
  });

  it("intercepts native WebView navigation and opens the platform browser", async () => {
    detectRuntimePlatform.mockReturnValue("ios");
    render(<IdentityGateScreen />);
    const { event, link } = clickPrivacyLink();

    await act(async () => {
      link.dispatchEvent(event);
    });

    // Prevented SYNCHRONOUSLY: an async decision would arrive after the
    // WebView had already navigated away from the application.
    expect(event.defaultPrevented).toBe(true);
    expect(openedUrls).toEqual([PRIVACY_HREF]);
  });

  it("carries no token, code or private state to the destination", async () => {
    detectRuntimePlatform.mockReturnValue("ios");
    render(<IdentityGateScreen />);
    const { event, link } = clickPrivacyLink();

    await act(async () => {
      link.dispatchEvent(event);
    });

    expect(openedUrls).toHaveLength(1);
    const opened = openedUrls[0];
    expect(opened).toBe(PRIVACY_HREF);
    expect(new URL(opened).search).toBe("");
    expect(opened).not.toMatch(/token|bearer|code=|session/i);
  });
});
