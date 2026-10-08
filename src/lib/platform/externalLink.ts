// Opening a PUBLIC document — the Privacy Notice, the Terms of Service, a
// regulator's page — without destroying the running application.
//
// On the Web this is an ordinary anchor and stays one. On native, following a
// link inside the application WebView would REPLACE the app: the person would
// have to force-quit and relaunch to get back, losing whatever they were doing.
// So native hands the destination to the platform browser surface instead.
//
// THIS IS PUBLIC-DOCUMENT BROWSING ONLY. It is not an authentication session,
// it is not an OAuth flow, and `@capacitor/browser` must not be described as
// one. Native Google sign-in remains unimplemented (docs/MOBILE_APP_MIGRATION.md
// §6 and its open §6.6 scheduling gate).
//
// Nothing here ever attaches an access token, an authorization code or any
// private application state to a destination: the only inputs are a literal
// app-relative legal route or an already-validated absolute https URL.
import { parseSafeLegalUrl } from "../identity/safeLegalUrl";
import { resolveApiTarget, type ApiTargetResolver } from "./apiTarget";
import { detectRuntimePlatform, type RuntimePlatform } from "./runtimePlatform";

/** Why a destination was refused, or how it was opened. */
export type ExternalLinkOutcome =
  | { kind: "opened_in_platform_browser" }
  /** Web: the caller's own anchor handles it; nothing was intercepted. */
  | { kind: "handled_by_anchor" }
  | { kind: "rejected_destination" }
  | { kind: "origin_unavailable" }
  | { kind: "browser_unavailable" }
  | { kind: "open_failed" };

export type ExternalLinkDependencies = {
  platform?: RuntimePlatform;
  resolveTarget?: ApiTargetResolver;
  openInPlatformBrowser?: (url: string) => Promise<void>;
};

/**
 * An app-relative route: exactly one leading slash, then an ordinary path.
 *
 * `//evil.test/x` is protocol-relative, not app-relative, and is refused here
 * rather than being resolved against the configured origin.
 */
function isAppRelativeRoute(href: string): boolean {
  return (
    href.startsWith("/") &&
    !href.startsWith("//") &&
    !/[\s\u0000-\u001f\u007f]/.test(href)
  );
}

/**
 * Resolves what a native build should actually open for a given `href`.
 *
 * Two shapes are accepted and nothing else:
 *
 *  - an app-relative legal route (`/privacy`, `/terms`), resolved against the
 *    configured PUBLIC https origin — never `capacitor://localhost` and never
 *    the local bundle, neither of which serves these documents;
 *  - an absolute URL that already satisfies `parseSafeLegalUrl`, the
 *    application's existing trusted validator (https only, no credentials, no
 *    control characters). Reusing it means there is one definition of a safe
 *    destination, not two that can drift apart.
 *
 * `javascript:`, `data:`, `file:`, `blob:`, `mailto:`, `http:` and malformed
 * values all resolve to `null`.
 */
export function resolveNativeExternalUrl(
  href: string,
  resolveTarget: ApiTargetResolver = resolveApiTarget
): { url: string } | { rejected: "destination" } | { rejected: "origin" } {
  if (typeof href !== "string" || href.length === 0) {
    return { rejected: "destination" };
  }

  if (isAppRelativeRoute(href)) {
    let resolution;
    try {
      resolution = resolveTarget();
    } catch {
      // A misbehaving resolver must not become an exception escaping into a
      // click handler; it is simply an origin this build cannot resolve.
      return { rejected: "origin" };
    }
    if (resolution.status !== "resolved") return { rejected: "origin" };
    const { target } = resolution;
    // On native the resolved target IS the configured public https origin
    // (ADR-0047). A document origin here would be the app scheme, which serves
    // no legal documents at all.
    if (target.kind !== "native_configured") return { rejected: "origin" };
    const candidate = `${target.origin}${href}`;
    // Re-validated through the same trusted validator, so a configured origin
    // and a route cannot combine into something the Web path would refuse.
    return parseSafeLegalUrl(candidate) === null
      ? { rejected: "destination" }
      : { url: candidate };
  }

  return parseSafeLegalUrl(href) === null
    ? { rejected: "destination" }
    : { url: href };
}

async function openWithCapacitorBrowser(url: string): Promise<void> {
  const [{ Browser }, { Capacitor }] = await Promise.all([
    import("@capacitor/browser"),
    import("@capacitor/core"),
  ]);
  if (!Capacitor.isPluginAvailable("Browser")) {
    throw new Error("Browser plugin unavailable");
  }
  await Browser.open({ url });
}

/**
 * Opens a public document.
 *
 * On Web this deliberately does nothing and reports `handled_by_anchor`: the
 * caller's `<a href target="_blank" rel="noreferrer noopener">` already has the
 * right behaviour, accessibility and safety attributes, and replacing it with a
 * click handler would be a regression.
 *
 * Never throws, and never navigates the application away: a failure is a named
 * outcome the caller shows, with the app still exactly where it was.
 */
export async function openExternalLink(
  href: string,
  dependencies: ExternalLinkDependencies = {}
): Promise<ExternalLinkOutcome> {
  const platform = dependencies.platform ?? detectRuntimePlatform();
  if (platform === "web") return { kind: "handled_by_anchor" };

  // An unrecognized native platform has no platform-browser surface this build
  // knows how to use, and must not fall through to WebView navigation.
  if (platform !== "ios" && platform !== "android") {
    return { kind: "browser_unavailable" };
  }

  const resolved = resolveNativeExternalUrl(
    href,
    dependencies.resolveTarget ?? resolveApiTarget
  );
  if ("rejected" in resolved) {
    return resolved.rejected === "origin"
      ? { kind: "origin_unavailable" }
      : { kind: "rejected_destination" };
  }

  try {
    await (dependencies.openInPlatformBrowser ?? openWithCapacitorBrowser)(resolved.url);
    return { kind: "opened_in_platform_browser" };
  } catch {
    return { kind: "open_failed" };
  }
}
