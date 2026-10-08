"use client";

import { useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import {
  openExternalLink,
  type ExternalLinkDependencies,
} from "../../lib/platform/externalLink";
import { detectRuntimePlatform } from "../../lib/platform/runtimePlatform";

/**
 * One anchor for the audited public-document links.
 *
 * On the Web this renders — and behaves as — exactly the anchor it replaces:
 * a real `href`, `target="_blank"`, `rel="noreferrer noopener"`, keyboard and
 * screen-reader behaviour intact, middle-click and "open in new tab" intact.
 * Nothing is intercepted.
 *
 * On native, following the link inside the WebView would replace the running
 * application, so the click is prevented and the destination is handed to the
 * platform browser instead. A failure is shown next to the link and the app
 * stays exactly where it was.
 *
 * This is deliberately a small component used at the audited sites, NOT a
 * global click interceptor or a navigation rewrite: a blanket handler would
 * capture links nobody reviewed, including future ones.
 */
export type ExternalDocumentLinkProps = {
  href: string;
  children: ReactNode;
  className?: string;
  /** Test seam; production passes nothing and uses the real platform. */
  dependencies?: ExternalLinkDependencies;
};

const FAILURE_COPY: Record<string, string> = {
  rejected_destination: "That link could not be opened.",
  origin_unavailable: "That link is unavailable in this build.",
  browser_unavailable: "No browser is available to open that link.",
  open_failed: "The browser could not be opened. Try again.",
};

export default function ExternalDocumentLink({
  href,
  children,
  className,
  dependencies,
}: ExternalDocumentLinkProps) {
  const [failure, setFailure] = useState<string | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  const handleClick = useCallback(
    (event: React.MouseEvent<HTMLAnchorElement>) => {
      // Let the browser do its normal thing for modified clicks and for any
      // non-primary button, on every platform.
      if (
        event.defaultPrevented ||
        event.button !== 0 ||
        event.metaKey ||
        event.ctrlKey ||
        event.shiftKey ||
        event.altKey
      ) {
        return;
      }

      void (async () => {
        const outcome = await openExternalLink(href, dependencies ?? {});
        if (outcome.kind === "handled_by_anchor") return; // Web: never prevented.
        if (!mountedRef.current) return;
        setFailure(
          outcome.kind === "opened_in_platform_browser"
            ? null
            : FAILURE_COPY[outcome.kind] ?? "That link could not be opened."
        );
      })();

      // The decision to prevent must be synchronous — by the time the async
      // resolution above settles, the WebView would already have navigated.
      // `openExternalLink` reports `handled_by_anchor` on Web, so this only
      // fires on native, where the anchor must not be followed.
      if (!isWebPlatform(dependencies)) event.preventDefault();
    },
    [dependencies, href]
  );

  return (
    <>
      <a
        href={href}
        target="_blank"
        rel="noreferrer noopener"
        className={className}
        onClick={handleClick}
      >
        {children}
      </a>
      {failure !== null && (
        <span role="status" className="ml-2 text-xs text-amber-700">
          {failure}
        </span>
      )}
    </>
  );
}

/**
 * Whether the anchor's own navigation should be allowed to proceed.
 *
 * Resolved synchronously and from the same trusted platform signal the rest of
 * the boundary uses — the Capacitor bridge object, never a user-agent string,
 * which a page can set and which would let the Web build start preventing its
 * own links.
 */
function isWebPlatform(dependencies: ExternalLinkDependencies | undefined): boolean {
  return (dependencies?.platform ?? detectRuntimePlatform()) === "web";
}
