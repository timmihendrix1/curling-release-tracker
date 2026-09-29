// Where an authorized API request is allowed to go, decided once, from trusted
// inputs only.
//
// Web keeps exactly today's behaviour: the document origin. Native resolves the
// one explicitly configured, validated HTTPS origin. Nothing else is a
// candidate, and there is no mutable setter — a caller cannot retarget requests
// and neither can a deep link, a response, a stored value or a query parameter.
//
// See docs/adr/0047-configured-native-api-origin-boundary.md.
import {
  resolveNativeApiOriginConfig,
  type NativeApiOriginResolution,
} from "./nativeApiOrigin";
import { detectRuntimePlatform, type RuntimePlatform } from "./runtimePlatform";

export type ApiTarget =
  /** The document's own origin, as every Web request has always used. */
  | { kind: "web_document"; origin: string }
  /** The one configured API origin. Cross-origin by construction. */
  | { kind: "native_configured"; origin: string };

export type ApiTargetUnavailableReason =
  | "no_document_origin"
  | "native_api_origin_not_configured"
  | "native_api_origin_invalid"
  | "unsupported_platform";

export type ApiTargetResolution =
  | { status: "resolved"; target: ApiTarget }
  | { status: "unavailable"; reason: ApiTargetUnavailableReason };

export type ApiTargetResolver = () => ApiTargetResolution;

function documentOrigin(): string | null {
  if (typeof window === "undefined") return null;
  const origin = window.location?.origin;
  return typeof origin === "string" && origin.length > 0 && origin !== "null"
    ? origin
    : null;
}

/**
 * The pure decision. Every input is supplied, so every branch — including the
 * hostile ones — is testable without a browser, a device or an environment.
 */
export function resolveApiTargetFrom(
  platform: RuntimePlatform,
  origin: string | null,
  nativeConfig: NativeApiOriginResolution
): ApiTargetResolution {
  if (platform === "web") {
    return origin === null
      ? { status: "unavailable", reason: "no_document_origin" }
      : { status: "resolved", target: { kind: "web_document", origin } };
  }

  // Deliberately NOT a Web fallback. An unrecognized native platform has no
  // validated destination, so it gets none.
  if (platform !== "ios" && platform !== "android") {
    return { status: "unavailable", reason: "unsupported_platform" };
  }

  switch (nativeConfig.status) {
    case "configured":
      return {
        status: "resolved",
        target: { kind: "native_configured", origin: nativeConfig.origin },
      };
    case "not_configured":
      return { status: "unavailable", reason: "native_api_origin_not_configured" };
    default:
      return { status: "unavailable", reason: "native_api_origin_invalid" };
  }
}

/**
 * The production resolver. Reads the real platform signal, the real document
 * origin and the real build-time configuration — nothing injectable, so no
 * production code path can be pointed somewhere else.
 */
export function resolveApiTarget(): ApiTargetResolution {
  return resolveApiTargetFrom(
    detectRuntimePlatform(),
    documentOrigin(),
    resolveNativeApiOriginConfig()
  );
}
