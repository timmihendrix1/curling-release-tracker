import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Development-only Capacitor configuration for the Brower TCi native BLE transport
 * probe.
 *
 * `appId` and `appName` are DEVELOPMENT IDENTIFIERS for a local engineering
 * instrument. They are not a product decision, no app is registered under them, and
 * no signing team is configured here — signing is chosen by a human in Xcode on the
 * machine that installs the build. See docs/BROWER_IOS_FEASIBILITY.md.
 *
 * `server.url` is deliberately absent. Pointing the native shell at a remote origin
 * would load the production web application into a native WebView, which this
 * prototype must not do: the application's authorized requests are confined to its
 * own origin (src/lib/supabase/authorizedFetch.ts), its OAuth callback validation
 * requires the return to land on that same origin, and its Profile-scoped local data
 * lives in browser-origin storage a native WebView does not share.
 */
const config: CapacitorConfig = {
  appId: "local.dev.browerbleprobe",
  appName: "Brower BLE Probe (Dev)",
  webDir: "dist",
  ios: {
    // The probe renders a dark, fixed diagnostic surface; matching the WebView
    // background avoids a white flash on launch.
    backgroundColor: "#0f1115",
    contentInset: "always",
  },
};

export default config;
