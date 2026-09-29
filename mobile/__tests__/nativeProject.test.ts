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
 * M1's scope (docs/MOBILE_APP_MIGRATION.md §10 M1, and open decisions P3/P4).
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

  it("uses a development app identity distinct from the BLE probe's", async () => {
    // P4 is open: these are placeholders and must be replaced before M6. What
    // matters now is only that both development builds can coexist on one
    // device.
    const probe = await readFile(
      path.join(repositoryRoot, "tools/brower-ios-probe/capacitor.config.ts"),
      "utf8"
    );
    expect(probe).toContain("local.dev.browerbleprobe");
    expect(capacitorConfig.appId).toBe("local.dev.curlingperformance");
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
  it("declares no background mode", async () => {
    // P3 is open. `UIBackgroundModes` changes App Review exposure and must not
    // be declared speculatively; M1 scaffolds the foreground-only scope it
    // actually exercises.
    expect(await readInfoPlist()).not.toContain("UIBackgroundModes");
  });

  it("requests no Bluetooth permission", async () => {
    // Brower capture is Stage M4. A usage-description string here would claim a
    // capability this build never uses.
    const plist = await readInfoPlist();
    expect(plist).not.toContain("NSBluetoothAlwaysUsageDescription");
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

  it("carries the development app identity into the native target", async () => {
    const project = await readFile(
      path.join(iosRoot, "App/App.xcodeproj/project.pbxproj"),
      "utf8"
    );
    expect(project).toContain("PRODUCT_BUNDLE_IDENTIFIER = local.dev.curlingperformance;");
    // Deliberately NOT asserted: the absence of a DEVELOPMENT_TEAM. Signing is
    // chosen by a human in Xcode on the machine that installs the build, and
    // once they do, Xcode writes their team into this file. Failing the suite
    // because a developer signed the app would punish the exact step device
    // acceptance requires. Nothing in this repository selects an account, and
    // no signing credential is stored here.
    //
    // What still must hold is that signing stays Xcode-managed and the
    // repository pins no provisioning profile of its own.
    expect(project).not.toContain("PROVISIONING_PROFILE_SPECIFIER");
    expect(project).toContain("CODE_SIGN_STYLE = Automatic;");
    expect(project).not.toMatch(/CODE_SIGN_STYLE = Manual;/);
    // The generic Xcode default, not a specific certificate.
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
