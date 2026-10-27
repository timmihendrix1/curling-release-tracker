// @vitest-environment jsdom
import "@testing-library/jest-dom/vitest";
import { act, cleanup, render, screen } from "@testing-library/react";
import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it, vi } from "vitest";
import NativeStorageCompositionRoot from "../src/storage/NativeStorageCompositionRoot";
import {
  composeProductionNativeStorage,
  nativeActivationReadyForTests,
  PRODUCTION_ACTIVATION_AUTHORITY,
} from "../src/storage/nativeStorageComposition";
import {
  isNativeStorageCompositionRequested,
  MOBILE_NATIVE_STORAGE_DEFINE_NAME,
  MOBILE_NATIVE_STORAGE_ENV_NAME,
  MOBILE_NATIVE_STORAGE_ON_VALUE,
} from "../nativeStorageFlag";
import {
  MOBILE_STORAGE_DIAGNOSTICS_DEFINE_NAME,
  MOBILE_STORAGE_DIAGNOSTICS_ENV_NAME,
} from "../storageDiagnosticsFlag";
import { resetSupabaseBrowserClientForTests } from "../../src/lib/supabase/supabaseClient";
import { resetIdentityRuntimeForTests } from "../../src/lib/identity/identityRuntime";
import { resetStorageCompositionForTests } from "../../src/lib/persistence/storageComposition";
import type { StorageCompositionState } from "../../src/lib/persistence/storageComposition";

const mobileRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = path.resolve(mobileRoot, "..");

afterEach(() => {
  cleanup();
  // Every test is a fresh document: the composition, the ownership slots and the
  // cached Supabase client are all page-scoped by design.
  resetStorageCompositionForTests();
  resetSupabaseBrowserClientForTests();
  resetIdentityRuntimeForTests();
  window.localStorage.clear();
});

describe("the native storage opt-in is its own build-time axis", () => {
  it("accepts exactly one spelling, so it cannot turn on by accident", () => {
    expect(isNativeStorageCompositionRequested(MOBILE_NATIVE_STORAGE_ON_VALUE)).toBe(true);
    for (const wrong of [undefined, "", "0", "true", "TRUE", "yes", " 1", "1 ", "01"]) {
      expect(isNativeStorageCompositionRequested(wrong)).toBe(false);
    }
  });

  it("is a DIFFERENT switch from the storage-diagnostics opt-in", () => {
    // Merging them would mean anyone gathering engine evidence had also opted
    // their real training data into a different store.
    expect(MOBILE_NATIVE_STORAGE_ENV_NAME).not.toBe(MOBILE_STORAGE_DIAGNOSTICS_ENV_NAME);
    expect(MOBILE_NATIVE_STORAGE_DEFINE_NAME).not.toBe(MOBILE_STORAGE_DIAGNOSTICS_DEFINE_NAME);
  });

  it("is not NODE_ENV, a URL parameter or a stored preference", () => {
    const source = readFileSync(path.join(mobileRoot, "nativeStorageFlag.ts"), "utf8");
    const code = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    for (const runtimeSwitch of ["NODE_ENV", "searchParams", "localStorage", "location"]) {
      expect(code).not.toContain(runtimeSwitch);
    }
  });

  it("the build reads the flag from the process environment, never from a bundled value", () => {
    const config = readFileSync(path.join(mobileRoot, "vite.config.ts"), "utf8");
    // Read and compared at build time; only a boolean literal is inlined.
    expect(config).toContain("isNativeStorageCompositionRequested");
    expect(config).toContain(`JSON.stringify(nativeStorage)`);
    // Its NAME must not join the allow-list of environment VALUES the bundle
    // inlines.
    const publicEnv = readFileSync(path.join(mobileRoot, "publicEnv.ts"), "utf8");
    expect(publicEnv).not.toContain(MOBILE_NATIVE_STORAGE_ENV_NAME);
  });

  it("the test run itself executes with BOTH opt-ins off, matching a default build", () => {
    const config = readFileSync(path.join(mobileRoot, "vitest.config.ts"), "utf8");
    expect(config).toMatch(/\[MOBILE_STORAGE_DIAGNOSTICS_DEFINE_NAME\]\s*:\s*"false"/);
    expect(config).toMatch(/\[MOBILE_NATIVE_STORAGE_DEFINE_NAME\]\s*:\s*"false"/);
  });
});

describe("the flag-enabled production path cannot become ready", () => {
  it("the production authority reports unavailable, permanently", async () => {
    expect(await PRODUCTION_ACTIVATION_AUTHORITY.verdict()).toEqual({
      status: "unavailable",
      reason: "migration_not_implemented",
    });
    // Not transient: a retry returns the same verdict.
    expect(await PRODUCTION_ACTIVATION_AUTHORITY.verdict()).toEqual({
      status: "unavailable",
      reason: "migration_not_implemented",
    });
  });

  it("the real production composer BLOCKS, with no database and no credential store opened", async () => {
    // On this platform the gate stops at `platform_unsupported`; on a device it
    // stops one step later at the authority. Either way it blocks, and neither
    // path opens anything.
    const result = await composeProductionNativeStorage();

    expect(result.status).toBe("blocked");
    if (result.status === "blocked") {
      expect([
        "platform_unsupported",
        "migration_authority_unavailable",
      ]).toContain(result.failure.kind);
    }
    // Nothing was claimed, so no consumer has been pointed anywhere new.
    expect(window.localStorage.length).toBe(0);
  });

  it("the ONLY ready verdict comes from a factory named for being test-only", async () => {
    expect(await nativeActivationReadyForTests().verdict()).toEqual({ status: "ready" });
    // `src/lib/persistence/__tests__/architectureBoundary.test.ts` asserts that
    // no production module references it.
  });
});

describe("a flag-enabled build shows a blocking state instead of mounting the app", () => {
  it("renders the preparation state, then the honest blocked state — never the workspace", async () => {
    let settle: (state: StorageCompositionState) => void = () => {};
    const compose = vi.fn(
      () =>
        new Promise<StorageCompositionState>((resolve) => {
          settle = resolve;
        })
    );

    render(
      <NativeStorageCompositionRoot compose={compose}>
        <p>sporting workspace</p>
      </NativeStorageCompositionRoot>
    );

    expect(screen.getByRole("heading", { name: "Preparing device storage" })).toBeInTheDocument();
    expect(screen.queryByText("sporting workspace")).not.toBeInTheDocument();

    await act(async () => {
      settle({ status: "blocked", failure: { kind: "migration_authority_unavailable" } });
    });

    const alert = screen.getByRole("alert");
    expect(alert).toHaveTextContent("not switched on in this build");
    // No silent fallback and no reset. The claim is about the user's TRAINING
    // DATA, deliberately not an absolute "nothing on this device changed":
    // opening the native database creates its file before the credential step
    // runs, so the stronger claim would not always be true.
    expect(alert).toHaveTextContent("has not been opened, changed or removed");
    expect(screen.queryByText("sporting workspace")).not.toBeInTheDocument();
    // The stage barrier is a fact about this build, not a transient fault: no
    // "Try again" suggests a recheck could activate it (Stage M3b4c).
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
    expect(alert).toHaveTextContent("Checking again will not change this.");
  });

  it("uses the production composer when nothing is injected, and still does not mount", async () => {
    render(
      <NativeStorageCompositionRoot>
        <p>sporting workspace</p>
      </NativeStorageCompositionRoot>
    );

    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(screen.queryByText("sporting workspace")).not.toBeInTheDocument();
    expect(screen.getByRole("alert")).toBeInTheDocument();
  });
});

describe("the NATIVE CREDENTIAL PATH IS CLOSED, and says so rather than guessing", () => {
  it("the installed binding reports no absence evidence, so a real read can never establish absence", async () => {
    // The dependency audit's conclusion, pinned as behaviour: the installed
    // plugin discards iOS's `lastResultCode` and reports Android key loss as
    // nothing, so this binding cannot supply item-specific missing-versus-failed
    // evidence. It reports `no_absence_evidence`, which the store turns into a
    // failure — closing the path instead of inferring absence.
    const { createCapacitorSecureStorageBinding } = await import(
      "../../src/lib/persistence/capacitorSecureStorageBinding"
    );
    const binding = createCapacitorSecureStorageBinding();

    // The plugin's own web stub answers `null` here, which is exactly the shape
    // a device returns for a missing item AND for an unreadable one.
    const evidence = await binding
      .read("anything")
      .catch(() => ({ kind: "threw" as const }));

    expect(["no_absence_evidence", "threw"]).toContain(evidence.kind);
    expect(evidence.kind).not.toBe("established_absent");
  });

  it("declares that a failed replacement may destroy the previous value", async () => {
    // `KeychainSwift.set` deletes before `SecItemAdd`, so the binding must not
    // let a caller believe the old bytes survive a failed write.
    const { createCapacitorSecureStorageBinding } = await import(
      "../../src/lib/persistence/capacitorSecureStorageBinding"
    );
    expect(createCapacitorSecureStorageBinding().failedWriteMayLosePreviousValue).toBe(true);
  });

  it("records the blocker in the binding itself, where the next reader will look", () => {
    const source = readFileSync(
      path.join(repositoryRoot, "src/lib/persistence/capacitorSecureStorageBinding.ts"),
      "utf8"
    );
    // The audit names the gap, the alternatives and what would close it, so the
    // decision is reviewable without re-deriving it.
    expect(source).toContain("DEPENDENCY SUITABILITY AUDIT");
    expect(source).toContain("capacitor-secure-storage-plugin");
    expect(source).toContain("@evva/capacitor-secure-storage-plugin");
    expect(source).toContain("lastResultCode");
    expect(source).toContain("What would close the gap");
    // And it does not claim the requirement is met.
    expect(source).toContain("the native credential path is CLOSED");
  });
});

describe("the native project integrates the protected credential plugin and nothing more", () => {
  it("the iOS SPM package lists exactly the expected Capacitor plugins", () => {
    const packageSwift = readFileSync(
      path.join(repositoryRoot, "ios/App/CapApp-SPM/Package.swift"),
      "utf8"
    );
    const packages = [...packageSwift.matchAll(/node_modules\/(@[^"]+)"/g)].map(
      (match) => match[1]
    );

    expect(packages.sort()).toEqual(
      [
        "@aparajita/capacitor-secure-storage",
        "@capacitor-community/bluetooth-le",
        "@capacitor-community/sqlite",
        "@capacitor/app",
        "@capacitor/browser",
        "@capacitor/filesystem",
        "@capacitor/share",
      ].sort()
    );
  });

  it("does NOT integrate a plugin's transitive Capacitor plugins", () => {
    // `@aparajita/capacitor-secure-storage` declares `@capacitor/app` and
    // `@capacitor/keyboard` as RUNTIME dependencies, and both carry a
    // `capacitor` manifest — so they would become plugins if the CLI scanned
    // transitive dependencies. It does not (`@capacitor/cli`'s `getDependencies`
    // reads only the app's own dependencies/devDependencies), and this pins that
    // rather than trusting it.
    //
    // `@capacitor/app` is now a DIRECT, deliberate dependency of the assisted
    // Brower capture pilot's foreground/background boundary (ADR-0050), declared
    // by this application rather than inherited. `@capacitor/keyboard` is still
    // wanted by nothing, and is the assertion that keeps this test honest.
    const packageSwift = readFileSync(
      path.join(repositoryRoot, "ios/App/CapApp-SPM/Package.swift"),
      "utf8"
    );
    expect(packageSwift).not.toContain("@capacitor/keyboard");

    const manifest = JSON.parse(
      readFileSync(path.join(repositoryRoot, "package.json"), "utf8")
    ) as { dependencies: Record<string, string>; devDependencies: Record<string, string> };
    const declared = { ...manifest.dependencies, ...manifest.devDependencies };
    expect(declared).not.toHaveProperty("@capacitor/keyboard");
    // Declared by this application, exactly pinned, not inherited transitively.
    expect(manifest.dependencies["@capacitor/app"]).toBe("8.1.1");
  });

  it("pins the Bluetooth plugin the assisted capture pilot depends on", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(repositoryRoot, "package.json"), "utf8")
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies["@capacitor-community/bluetooth-le"]).toBe("8.3.0");
  });

  it("pins the secure-storage plugin exactly, with no range", () => {
    const manifest = JSON.parse(
      readFileSync(path.join(repositoryRoot, "package.json"), "utf8")
    ) as { dependencies: Record<string, string> };
    expect(manifest.dependencies["@aparajita/capacitor-secure-storage"]).toBe("8.0.1");
  });

  it("resolves the plugin's own native dependency and keeps the pinned Capacitor version", () => {
    const resolved = JSON.parse(
      readFileSync(
        path.join(
          repositoryRoot,
          "ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved"
        ),
        "utf8"
      )
    ) as { pins: Array<{ identity: string; state: { version: string } }> };
    const byIdentity = new Map(resolved.pins.map((pin) => [pin.identity, pin.state.version]));

    // The Keychain implementation the plugin's Package.swift requires.
    expect(byIdentity.get("keychain-swift")).toBe("21.0.0");
    // The plugin asks for capacitor-swift-pm `from: "8.0.0"`, which the root
    // project's `exact: "8.5.2"` pin satisfies. A change here would mean the
    // plugin had forced the shared Capacitor version to move.
    expect(byIdentity.get("capacitor-swift-pm")).toBe("8.5.2");
  });

  it("claims no keychain-sharing entitlement and no iCloud keychain", () => {
    // The default access group (bundle id) is what isolates this app's Keychain
    // items. A sharing entitlement would widen that, and there is no
    // entitlements file at all — asserted in `nativeProject.test.ts` too.
    const packageSwift = readFileSync(
      path.join(repositoryRoot, "ios/App/CapApp-SPM/Package.swift"),
      "utf8"
    );
    expect(packageSwift).not.toContain("keychain-access-groups");
    const pbxproj = readFileSync(
      path.join(repositoryRoot, "ios/App/App.xcodeproj/project.pbxproj"),
      "utf8"
    );
    expect(pbxproj).not.toContain("CODE_SIGN_ENTITLEMENTS");
  });
});
