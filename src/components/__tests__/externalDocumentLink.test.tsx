// @vitest-environment jsdom
//
// Public-document links, at the real call sites (Stage M3a).
//
// The failure this prevents is specific: on native, following one of these
// links inside the application WebView REPLACES the app, and the only way back
// is to force-quit and relaunch — losing whatever was in progress.
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import ExternalDocumentLink from "../platform/ExternalDocumentLink";
import SettingsScreen from "../SettingsScreen";
import type { ApiTargetResolver } from "../../lib/platform/apiTarget";

const CONFIGURED_ORIGIN = "https://curling.example.test";

const nativeTarget: ApiTargetResolver = () => ({
  status: "resolved",
  target: { kind: "native_configured", origin: CONFIGURED_ORIGIN },
});

afterEach(cleanup);

describe("ExternalDocumentLink on the Web", () => {
  it("renders a real anchor with safe new-tab attributes", () => {
    render(
      <ExternalDocumentLink href="/privacy" dependencies={{ platform: "web" }}>
        Read the Privacy Notice
      </ExternalDocumentLink>
    );

    const anchor = screen.getByRole("link", { name: "Read the Privacy Notice" });
    expect(anchor).toHaveAttribute("href", "/privacy");
    expect(anchor).toHaveAttribute("target", "_blank");
    expect(anchor).toHaveAttribute("rel", "noreferrer noopener");
  });

  it("does not prevent the anchor's own navigation", async () => {
    const open = vi.fn(async () => {});
    render(
      <ExternalDocumentLink
        href="/privacy"
        dependencies={{ platform: "web", openInPlatformBrowser: open }}
      >
        Privacy
      </ExternalDocumentLink>
    );

    const anchor = screen.getByRole("link", { name: "Privacy" });
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    await act(async () => {
      anchor.dispatchEvent(event);
    });

    // The browser still does what it always did, and nothing was intercepted.
    expect(event.defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});

describe("ExternalDocumentLink on native", () => {
  function renderNative(href: string, open: (url: string) => Promise<void>) {
    render(
      <ExternalDocumentLink
        href={href}
        dependencies={{
          platform: "ios",
          resolveTarget: nativeTarget,
          openInPlatformBrowser: open,
        }}
      >
        Open
      </ExternalDocumentLink>
    );
    return screen.getByRole("link", { name: "Open" });
  }

  async function clickAndSettle(anchor: HTMLElement): Promise<MouseEvent> {
    const event = new MouseEvent("click", { bubbles: true, cancelable: true, button: 0 });
    await act(async () => {
      anchor.dispatchEvent(event);
    });
    return event;
  }

  it("prevents WebView navigation and opens the platform browser", async () => {
    const opened: string[] = [];
    const anchor = renderNative("/privacy", async (url) => {
      opened.push(url);
    });

    const event = await clickAndSettle(anchor);

    // Prevented synchronously: by the time an async decision resolved, the
    // WebView would already have navigated away from the app.
    expect(event.defaultPrevented).toBe(true);
    expect(opened).toEqual([`${CONFIGURED_ORIGIN}/privacy`]);
  });

  it("keeps the versioned destination trusted metadata supplied", async () => {
    const opened: string[] = [];
    const versioned = `${CONFIGURED_ORIGIN}/legal/privacy/2026-08-28`;
    const anchor = renderNative(versioned, async (url) => {
      opened.push(url);
    });

    await clickAndSettle(anchor);

    // Not replaced with a generic unversioned page.
    expect(opened).toEqual([versioned]);
  });

  it("shows a failure and leaves the application where it was", async () => {
    const anchor = renderNative("/privacy", async () => {
      throw new Error("no browser");
    });

    const event = await clickAndSettle(anchor);

    expect(event.defaultPrevented).toBe(true);
    expect(screen.getByRole("status")).toHaveTextContent(
      "The browser could not be opened. Try again."
    );
    // The link is still on screen and still usable: nothing navigated.
    expect(screen.getByRole("link", { name: "Open" })).toBeInTheDocument();
  });

  it("refuses an unsupported scheme without invoking the browser", async () => {
    const open = vi.fn(async () => {});
    const anchor = renderNative("javascript:alert(1)", open);

    const event = await clickAndSettle(anchor);

    expect(event.defaultPrevented).toBe(true);
    expect(open).not.toHaveBeenCalled();
    expect(screen.getByRole("status")).toHaveTextContent("That link could not be opened.");
  });

  it("leaves modified clicks to the platform", async () => {
    const open = vi.fn(async () => {});
    const anchor = renderNative("/privacy", open);

    const event = new MouseEvent("click", {
      bubbles: true,
      cancelable: true,
      button: 0,
      metaKey: true,
    });
    await act(async () => {
      anchor.dispatchEvent(event);
    });

    expect(event.defaultPrevented).toBe(false);
    expect(open).not.toHaveBeenCalled();
  });
});

describe("the real Settings screen composition", () => {
  type SettingsProps = React.ComponentProps<typeof SettingsScreen>;

  const settingsProps = {
    hasHistory: true,
    onExportHistoryCsv: () => {},
    onClearHistory: () => {},
    accuracyToleranceProfiles: [],
    defaultAccuracyToleranceProfileId: null,
    smartRandomProfiles: [],
    defaultSmartRandomProfileId: null,
  } as unknown as SettingsProps;

  it("renders both legal links as real anchors with their routes intact", () => {
    // Exercising the ACTUAL screen, not the link component in isolation: the
    // point is that the audited sites use it and keep their destinations.
    render(<SettingsScreen {...settingsProps} />);

    expect(screen.getByRole("link", { name: /Privacy Notice/i })).toHaveAttribute(
      "href",
      "/privacy"
    );
    expect(screen.getByRole("link", { name: /Terms of Service/i })).toHaveAttribute(
      "href",
      "/terms"
    );
  });
});
