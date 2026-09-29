import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor configuration for the Curling Performance Platform mobile client.
 *
 * DEVELOPMENT PLACEHOLDERS. `appId` and `appName` are development identifiers
 * for Stage M1's shell. Product app identity — bundle identifier / application
 * id, app name, the production API origin, the callback domain and distribution
 * commitments — is open decision **P4** in docs/MOBILE_APP_MIGRATION.md §4 and
 * is NOT settled here. No app is registered under these values, no scheme or
 * domain is claimed, and no provider redirect is configured. They must be
 * replaced before M6.
 *
 * `appId` is deliberately distinct from the standalone BLE probe's
 * `local.dev.browerbleprobe` (tools/brower-ios-probe) so both development builds
 * can be installed on the same device without replacing one another.
 *
 * `server.url` is deliberately absent and must never appear in a release
 * configuration (§3.4). Pointing the shell at the deployed origin would load the
 * Web application into a native WebView and silently convert every same-origin
 * guarantee in src/lib/supabase/authorizedFetch.ts into an accident of where the
 * document happened to be loaded from. The bundle is local.
 *
 * No `UIBackgroundModes`, no Bluetooth permission string, no OAuth scheme, no
 * Associated Domains entitlement and no deep-link registration are declared.
 * Background measurement is open decision **P3**; native identity is M2; Brower
 * capture is M4. M1 declares only what it exercises.
 */
const config: CapacitorConfig = {
  appId: "local.dev.curlingperformance",
  appName: "Curling Performance (Dev)",
  // Built by `npm run mobile:build` (mobile/vite.config.ts), relative to this file.
  webDir: "mobile/dist",
  ios: {
    // The shell's own background behind the WebView. `src/app/globals.css`
    // paints the document, so this only shows for the instant before first
    // paint; slate-100 matches `page.tsx`'s <main> surface.
    backgroundColor: "#f1f5f9",
    // `never` keeps the WebView full-bleed so `viewport-fit=cover` yields real
    // `env(safe-area-inset-*)` values. The application already pays the BOTTOM
    // inset itself (`.app-content-clearance`), and mobile/src/mobile.css adds
    // the top and sides — letting the native shell inset the content as well
    // would double-pad the bottom edge.
    contentInset: "never",
  },
};

export default config;
