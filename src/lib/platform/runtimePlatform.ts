// The trusted platform signal.
//
// `Capacitor.getPlatform()` reports `android` when the native Android bridge
// object exists on `window`, `ios` when the WKWebView message handler exists,
// and `web` otherwise. Those objects are injected by the native runtime itself
// — this is NOT a user-agent heuristic, a query parameter, a stored preference
// or anything a page, a deep link or a user can influence.
//
// An unrecognized native platform is reported as `unsupported_native` rather
// than collapsing into `web`: a future platform must fail closed at the API
// boundary instead of silently inheriting the Web document-origin fallback.
import { Capacitor } from "@capacitor/core";

export type RuntimePlatform = "web" | "ios" | "android" | "unsupported_native";

export function detectRuntimePlatform(): RuntimePlatform {
  let native: boolean;
  let platform: string;
  try {
    native = Capacitor.isNativePlatform();
    platform = Capacitor.getPlatform();
  } catch {
    // A bridge that misbehaves must not be able to decide we are on the Web.
    return "unsupported_native";
  }
  if (!native) return platform === "web" ? "web" : "unsupported_native";
  if (platform === "ios" || platform === "android") return platform;
  return "unsupported_native";
}
