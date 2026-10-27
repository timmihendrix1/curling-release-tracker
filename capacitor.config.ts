import type { CapacitorConfig } from "@capacitor/cli";

/**
 * Capacitor configuration for the Curling Performance Platform mobile client.
 *
 * Confirmed iOS identity: Evolane Curling / me.evolane.curling, team J98U2J78B3
 * (user approval, 2026-10-21; docs/MOBILE_APP_MIGRATION.md P4). This replaces
 * the local.dev.curlingperformance development placeholder in the project only.
 * The existing iPhone installation and its data are NOT migrated by this change.
 * Device installation remains blocked until its separate preservation gates pass.
 * The API origin is configured separately; callback/background decisions and
 * distribution acceptance are not settled by the identity configuration.
 *
 * `appId` remains distinct from the standalone BLE probe's
 * `local.dev.browerbleprobe` (tools/brower-ios-probe). No probe identity is changed.
 *
 * `server.url` is deliberately absent and must never appear in a release
 * configuration (§3.4). Pointing the shell at the deployed origin would load the
 * Web application into a native WebView and silently convert every same-origin
 * guarantee in src/lib/supabase/authorizedFetch.ts into an accident of where the
 * document happened to be loaded from. The bundle is local.
 *
 * The iOS target declares Bluetooth permission for the assisted Brower pilot.
 * No `UIBackgroundModes`, OAuth scheme, Associated Domains entitlement or deep-link
 * registration is declared. Background measurement remains open decision **P3**;
 * native OAuth and full production Brower integration retain their separate gates.
 */
const config: CapacitorConfig = {
  appId: "me.evolane.curling",
  appName: "Evolane Curling",
  // Built by `npm run mobile:build` (mobile/vite.config.ts), relative to this file.
  webDir: "mobile/dist",
  // Capacitor's bridge logger can print native response payloads. A secure
  // credential read must not put its returned value in device logs, even in Debug.
  loggingBehavior: "none",
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
