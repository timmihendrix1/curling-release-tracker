// @vitest-environment node
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import capacitorConfig from "../../capacitor.config";

const mobileRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = path.resolve(mobileRoot, "..");
const iosRoot = path.join(repositoryRoot, "ios");

/**
 * Invariants of the native shell that M1 must not quietly violate — the ones a
 * reviewer would otherwise have to re-derive by reading generated Xcode files.
 *
 * Everything asserted here is a decision, not an accident of generation: a
 * remote wrapper, a background mode, a speculative permission or a claimed
 * domain would each change what this app *is*, and each is explicitly out of
 * the shell's scope (docs/MOBILE_APP_MIGRATION.md §10 M1). P4 now confirms the
 * iOS identity/team, not a callback-domain or background-capability change.
 */

async function readInfoPlist(): Promise<string> {
  return readFile(path.join(iosRoot, "App/App/Info.plist"), "utf8");
}

describe("Capacitor configuration", () => {
  it("loads the locally bundled mobile build, never a remote origin", () => {
    // §3.4: `server.url` is a live-reload facility. Pointing the shell at the
    // deployed origin would turn every same-origin guarantee in
    // src/lib/supabase/authorizedFetch.ts into an accident of where the document
    // was loaded from.
    expect(capacitorConfig).not.toHaveProperty("server");
    expect(JSON.stringify(capacitorConfig)).not.toContain("http://");
    expect(JSON.stringify(capacitorConfig)).not.toContain("https://");
  });

  it("points webDir at the mobile build output", async () => {
    expect(capacitorConfig.webDir).toBe("mobile/dist");
    await expect(
      stat(path.join(repositoryRoot, capacitorConfig.webDir!, "index.html"))
    ).resolves.toBeDefined();
  });

  it("uses the confirmed Evolane identity distinct from the BLE probe's", async () => {
    const probe = await readFile(
      path.join(repositoryRoot, "tools/brower-ios-probe/capacitor.config.ts"),
      "utf8"
    );
    expect(probe).toContain("local.dev.browerbleprobe");
    expect(capacitorConfig.appId).toBe("me.evolane.curling");
    expect(capacitorConfig.appName).toBe("Evolane Curling");
    expect(capacitorConfig.appId).not.toBe("local.dev.browerbleprobe");
  });

  it("leaves the WebView full-bleed so the app owns its own insets", () => {
    // The application already adds `env(safe-area-inset-bottom)` itself
    // (.app-content-clearance). Letting the native shell inset the content as
    // well would pay that edge twice.
    expect(capacitorConfig.ios?.contentInset).toBe("never");
  });
});

describe("generated iOS project", () => {
  it("uses the approved display name while keeping identifier, version and English region semantics", async () => {
    const plist = await readInfoPlist();
    expect(plist).toMatch(/<key>CFBundleDisplayName<\/key>\s*<string>Evolane Curling<\/string>/);
    expect(plist).toMatch(/<key>CFBundleIdentifier<\/key>\s*<string>\$\(PRODUCT_BUNDLE_IDENTIFIER\)<\/string>/);
    expect(plist).toMatch(/<key>CFBundleShortVersionString<\/key>\s*<string>\$\(MARKETING_VERSION\)<\/string>/);
    expect(plist).toMatch(/<key>CFBundleVersion<\/key>\s*<string>\$\(CURRENT_PROJECT_VERSION\)<\/string>/);
    expect(plist).toMatch(/<key>CFBundleDevelopmentRegion<\/key>\s*<string>en<\/string>/);
    expect(plist).not.toContain("Curling Performance (Dev)");
  });
  it("declares no background mode", async () => {
    // P3 is still open, and the assisted Brower capture pilot does NOT change
    // that: it captures in the foreground only and invalidates on backgrounding.
    // `UIBackgroundModes` changes App Review exposure and must not be declared
    // speculatively.
    expect(await readInfoPlist()).not.toContain("UIBackgroundModes");
  });

  it("requests exactly the Bluetooth permission the assisted capture pilot uses", async () => {
    // The pilot connects to a Brower TCi timer from the foreground (ADR-0050), so
    // the usage description is now a capability the build genuinely exercises.
    // The deprecated peripheral (advertising) string is still absent: this app
    // acts only as a central.
    const plist = await readInfoPlist();
    expect(plist).toContain("NSBluetoothAlwaysUsageDescription");
    expect(plist).not.toContain("NSBluetoothPeripheralUsageDescription");
  });

  it("registers no URL scheme and claims no associated domain", async () => {
    // Native identity is Stage M2, and the callback domain is open decision P4.
    // Nothing in M1 registers a scheme, a domain or a provider redirect.
    const plist = await readInfoPlist();
    expect(plist).not.toContain("CFBundleURLTypes");
    expect(plist).not.toContain("LSApplicationQueriesSchemes");

    const entitlements: string[] = [];
    async function collect(directory: string): Promise<void> {
      for (const entry of await readdir(directory, { withFileTypes: true })) {
        const full = path.join(directory, entry.name);
        if (entry.isDirectory()) await collect(full);
        else if (entry.name.endsWith(".entitlements")) entitlements.push(full);
      }
    }
    await collect(iosRoot);
    expect(entitlements).toEqual([]);
  });

  it("supports the orientations M1's device check exercises", async () => {
    const plist = await readInfoPlist();
    expect(plist).toContain("UIInterfaceOrientationPortrait");
    expect(plist).toContain("UIInterfaceOrientationLandscapeLeft");
    expect(plist).toContain("UIInterfaceOrientationLandscapeRight");
  });

  it("uses the confirmed identity and automatic team signing in both target configurations", async () => {
    const project = await readFile(
      path.join(iosRoot, "App/App.xcodeproj/project.pbxproj"),
      "utf8"
    );
    const targets = [...project.matchAll(/\/\* (Debug|Release) \*\/ = \{\s*isa = XCBuildConfiguration;([\s\S]*?)\n\t\t\};/g)]
      .filter((match) => match[2].includes("INFOPLIST_FILE = App/Info.plist;"));
    expect(targets.map((match) => match[1]).sort()).toEqual(["Debug", "Release"]);
    for (const [, configuration, settings] of targets) {
      expect(settings, configuration).toContain("PRODUCT_BUNDLE_IDENTIFIER = me.evolane.curling;");
      expect(settings, configuration).toContain("DEVELOPMENT_TEAM = J98U2J78B3;");
      expect(settings, configuration).toContain("CODE_SIGN_STYLE = Automatic;");
      expect(settings, configuration).toContain("MARKETING_VERSION = 1.0;");
      expect(settings, configuration).toContain("CURRENT_PROJECT_VERSION = 1;");
      expect(settings, configuration).toContain("IPHONEOS_DEPLOYMENT_TARGET = 15.0;");
      expect(settings, configuration).toContain('TARGETED_DEVICE_FAMILY = "1,2";');
      expect(settings, configuration).toContain('PRODUCT_NAME = "$(TARGET_NAME)";');
      expect(settings, configuration).not.toContain("CAPACITOR_DEBUG");
    }
    const release = targets.find((match) => match[1] === "Release")![2];
    expect(release).not.toContain("debug.xcconfig");
    // The chosen team is configuration, not a certificate or provisioning credential.
    expect(project).not.toContain("local.dev.curlingperformance");
    expect(project).not.toContain("PROVISIONING_PROFILE_SPECIFIER");
    expect(project).not.toContain("CODE_SIGN_ENTITLEMENTS");
    expect(project).not.toMatch(/CODE_SIGN_STYLE = Manual;/);
    expect(project).not.toMatch(/CODE_SIGN_IDENTITY = "iPhone Distribution[^"]*";/);
  });

  it("keeps the project reviewable while ignoring generated state", async () => {
    const ignore = await readFile(path.join(iosRoot, ".gitignore"), "utf8");
    // The copied web bundle and Xcode/SPM user state are generated per machine.
    for (const generated of ["App/App/public", "DerivedData", "xcuserdata", "App/build"]) {
      expect(ignore).toContain(generated);
    }
    // The native project itself IS source and must stay reviewable.
    expect(ignore).not.toMatch(/^\/?\*$/m);
    await expect(
      stat(path.join(iosRoot, "App/App.xcodeproj/project.pbxproj"))
    ).resolves.toBeDefined();
    await expect(
      stat(path.join(iosRoot, "App/CapApp-SPM/Package.swift"))
    ).resolves.toBeDefined();
  });
});
