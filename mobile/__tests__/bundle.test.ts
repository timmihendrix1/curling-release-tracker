// @vitest-environment node
import { readFile, readdir, stat } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import {
  PUBLIC_EXERCISE_ASSET_IDS,
  PUBLIC_EXERCISE_DIAGRAM_PATHS,
} from "../../src/lib/exercises/restrictedAssetCatalog";
import { MOBILE_INLINED_PUBLIC_ENV_NAMES } from "../publicEnv";
import { DIAGNOSTIC_DATABASE_NAME } from "../src/diagnostics/syntheticFixtures";

const mobileRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const repositoryRoot = path.resolve(mobileRoot, "..");
const distRoot = path.join(mobileRoot, "dist");

/**
 * Checks against the ACTUAL built bundle, not against the configuration that
 * was supposed to produce it. Run `npm run mobile:build` first, or use
 * `npm run mobile:verify`, which chains them.
 */
async function readDist(relative: string): Promise<string> {
  return readFile(path.join(distRoot, relative), "utf8");
}

async function bundledScript(): Promise<string> {
  const assets = await readdir(path.join(distRoot, "assets"));
  const scripts = assets.filter((name) => name.endsWith(".js"));
  expect(scripts.length).toBeGreaterThan(0);
  const contents = await Promise.all(
    scripts.map((name) => readDist(path.join("assets", name)))
  );
  return contents.join("\n");
}

async function bundledStylesheet(): Promise<string> {
  const assets = await readdir(path.join(distRoot, "assets"));
  const sheets = assets.filter((name) => name.endsWith(".css"));
  expect(sheets.length).toBeGreaterThan(0);
  const contents = await Promise.all(
    sheets.map((name) => readDist(path.join("assets", name)))
  );
  return contents.join("\n");
}

// These literals also belong to accepted SQL discovery/eligibility, which must
// reject foreign control rows before an ordinary adapter can open. They cannot
// alone identify the dormant executor in an explicitly opted-in SQL artifact.
function admitsOnlyExistingSqlControlReferences(js: string): boolean {
  const names = js.match(/curling\.nativeMigration\.[A-Za-z0-9_.-]*/g) ?? [];
  const sqlOptIn = js.includes(DIAGNOSTIC_DATABASE_NAME) || js.includes("curling-sporting-v1");
  if (!sqlOptIn) return names.length === 0; // strict default artifact absence
  if (!js.includes("SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name;")) return false;
  // Actual SQL adapter: two prefix refusals, D/F addresses. Shared eligibility:
  // source/D/F addresses. Pin exact membership AND multiplicity, never a prefix
  // exemption. Any new address or duplicate requires its own provenance review.
  const expected = new Map([
    ["curling.nativeMigration.", 2],
    ["curling.nativeMigration.activationRecord.v1", 2],
    ["curling.nativeMigration.faultLatch.v1", 2],
    ["curling.nativeMigration.sourceMarker.v1", 1],
  ]);
  if (names.length !== 7) return false;
  for (const name of names) {
    const remaining = expected.get(name);
    if (remaining === undefined || remaining === 0) return false;
    expected.set(name, remaining - 1);
  }
  return [...expected.values()].every(remaining => remaining === 0);
}

describe("mobile production bundle", () => {
  beforeAll(async () => {
    try {
      await stat(distRoot);
    } catch {
      throw new Error(
        `No mobile bundle at ${distRoot}. Run \`npm run mobile:build\` first (or \`npm run mobile:verify\`).`
      );
    }
  });

  it("ships every registered public Exercise diagram, byte for byte", async () => {
    const diagramDirectory = path.join(distRoot, "exercise-diagrams");
    const bundled = (await readdir(diagramDirectory)).sort();
    const expected = PUBLIC_EXERCISE_ASSET_IDS
      .map((assetId) => path.basename(PUBLIC_EXERCISE_DIAGRAM_PATHS[assetId]))
      .sort();

    // Current AND superseded ids: a saved Training Plan step or a recorded Team
    // result may reference a superseded diagram, and it has to keep resolving
    // offline (ADR-0046).
    expect(bundled).toEqual(expected);

    for (const assetId of PUBLIC_EXERCISE_ASSET_IDS) {
      const registeredPath = PUBLIC_EXERCISE_DIAGRAM_PATHS[assetId];
      const source = await readFile(
        path.join(repositoryRoot, "public", registeredPath)
      );
      const shipped = await readFile(
        path.join(distRoot, registeredPath.replace(/^\/+/, ""))
      );
      expect(shipped.equals(source)).toBe(true);
    }
  });

  it("places diagrams at exactly the path the shared resolver fetches", async () => {
    // createPublicExerciseAssetResolver fetches PUBLIC_EXERCISE_DIAGRAM_PATHS
    // verbatim, as a root-relative path. If the bundle put them anywhere else,
    // every diagram would 404 inside the app container.
    for (const assetId of PUBLIC_EXERCISE_ASSET_IDS) {
      const registeredPath = PUBLIC_EXERCISE_DIAGRAM_PATHS[assetId];
      expect(registeredPath.startsWith("/exercise-diagrams/")).toBe(true);
      await expect(
        stat(path.join(distRoot, registeredPath.replace(/^\/+/, "")))
      ).resolves.toBeDefined();
    }
  });

  it("does not sweep in unrelated public-directory content", async () => {
    const top = await readdir(distRoot);

    expect(top.sort()).toEqual(["assets", "exercise-diagrams", "index.html"]);
    // Next's starter SVGs, the app icon and the misplaced
    // public/public/manifest.json all live in the same public/ directory the
    // diagrams do. A `publicDir` pointed at it would have shipped them.
    for (const unrelated of [
      "next.svg",
      "vercel.svg",
      "globe.svg",
      "file.svg",
      "window.svg",
      "icon.png",
      "public",
      "manifest.json",
    ]) {
      expect(top).not.toContain(unrelated);
    }
  });

  it("styles the shared components, not just the mobile entry", async () => {
    const css = await bundledStylesheet();

    // Each of these appears ONLY in src/components — never in mobile/. Their
    // presence proves Tailwind scanned the shared UI; without the @source
    // directives in mobile.css the app would ship unstyled.
    for (const sharedOnlyClass of [
      "min-h-11",
      "underline-offset-4",
      "rounded-2xl",
    ]) {
      expect(css).toContain(sharedOnlyClass);
    }
    // The application's own safe-area rule, carried over from globals.css.
    expect(css).toContain("app-content-clearance");
    expect(css).toContain("env(safe-area-inset-bottom)");
    // The shell's own top/side insets.
    expect(css).toContain("env(safe-area-inset-top)");
  });

  it("resolves every build-time literal the shared client reads", async () => {
    const js = await bundledScript();

    // Not one `process.env.X` survives. An unreplaced reference is precisely
    // the "process is not defined" crash a native WebView would take on launch.
    expect(js).not.toMatch(/process\s*\.\s*env/);
    // The complete allow-list. Adding a name here makes it browser-visible, so
    // this list is pinned rather than merely non-empty. Server-only
    // configuration must never appear in it.
    expect([...MOBILE_INLINED_PUBLIC_ENV_NAMES]).toEqual([
      "NEXT_PUBLIC_SUPABASE_URL",
      "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY",
      "NEXT_PUBLIC_NATIVE_API_ORIGIN",
      "NEXT_PUBLIC_POSTHOG_ENABLED",
      "NEXT_PUBLIC_POSTHOG_TOKEN",
      "NEXT_PUBLIC_POSTHOG_HOST",
      "NEXT_PUBLIC_POSTHOG_CH_BETA",
    ]);
  });

  it("inlines NODE_ENV as production, closing the test-only scope bypass", async () => {
    const js = await bundledScript();

    // `ProfileScopedSportingPersistence` falls back to a fixed test Profile id
    // behind `process.env.NODE_ENV === "test"`. With NODE_ENV inlined as
    // "production" that branch folds to `if (false)` and is eliminated, so the
    // literal disappears from the bundle. Its absence is therefore direct
    // evidence of BOTH facts that matter: the define carries "production", and a
    // shipped mobile bundle contains no production-reachable bypass of Profile
    // scope.
    expect(js).not.toContain("00000000-0000-4000-8000-000000000001");
    expect(js).not.toContain("createUnscopedSportingRepositoriesForTests");

    // Deliberately NOT asserted: the absence of the Timing Simulator's or the
    // Brower diagnostic screen's own strings. Those modules are statically
    // imported by TrackerApp, so their text survives minification even though
    // `IS_DEV` — the same inlined NODE_ENV comparison proven above — folds to
    // false and neither can render. Asserting on their strings would test the
    // bundler's tree-shaking, not the gate.
  });

  it("ships the typed-code email sign-in path", async () => {
    const js = await bundledScript();

    // Stage M2a's acceptance path is email OTP, which needs no OAuth callback,
    // no deep link and no authentication browser: `signInWithOtp` +
    // `verifyOtp` talk directly to the configured Supabase origin. Its UI copy
    // shipping in the native bundle is what makes on-device acceptance possible
    // before any Universal Link work exists.
    expect(js).toContain("Send sign-in code");
  });

  it("carries no Next runtime and no server-side module", async () => {
    const js = await bundledScript();

    for (const serverOnly of [
      "next/server",
      "nodemailer",
      "createTransport",
      "SUPABASE_SECRET_KEY",
      "service_role",
      "APP_ORIGIN",
      "CLOSED_BETA_EXERCISE_ASSET_TEAM_ID",
    ]) {
      expect(js).not.toContain(serverOnly);
    }
  });

  it("excludes the storage diagnostics panel unless the build opted in", async () => {
    const assets = await readdir(path.join(distRoot, "assets"));
    const scripts = assets.filter((name) => name.endsWith(".js"));
    const chunks = new Map<string, string>();
    for (const name of scripts) {
      chunks.set(name, await readDist(path.join("assets", name)));
    }
    const diagnosticChunks = [...chunks].filter(([, code]) =>
      code.includes(DIAGNOSTIC_DATABASE_NAME)
    );

    if (diagnosticChunks.length === 0) {
      // No DIAGNOSTICS in this artifact. The panel is not merely inert — it is
      // ABSENT: the conditional import in MobileApp.tsx folds away, so no
      // synthetic key namespace and no panel copy reaches the artifact.
      const js = [...chunks.values()].join("\n");
      expect(js).not.toContain("diagnostic.synthetic.");
      expect(js).not.toContain("Native storage diagnostics");
      expect(js).not.toContain("Write synthetic fixtures");
      // The checkpoint/transaction scenarios are part of the same opt-in and
      // are absent too — including the synthetic checkpoint namespace and the
      // wording that labels an injected fault as a simulation.
      expect(js).not.toContain("diagnostic.synthetic.checkpoint.");
      expect(js).not.toContain("Checkpoints and transactions");
      expect(js).not.toContain("Commit a checkpoint");
      expect(js).not.toContain("DIAGNOSTIC SIMULATION");
      expect(assets.some((name) => name.includes("Diagnostics"))).toBe(false);

      // The SQLITE PLUGIN is a separate question from the panel, because Stage
      // M3b3's native storage composition reaches it through its own,
      // independent opt-in. So its absence may only be asserted when THAT
      // opt-in is off too — otherwise this check would fail on a legitimate
      // native-storage build and say nothing about diagnostics.
      if (!js.includes("curling-sporting-v1")) {
        expect(js).not.toContain("CapacitorSQLite");
        expect(assets.some((name) => name.includes("SqliteEngine"))).toBe(false);
        // With the plugin out of the artifact entirely, its Web stub — and the
        // `jeep-sqlite` element name with it — is gone too.
        expect(js).not.toContain("jeep-sqlite");
      }
      return;
    }

    // A DIAGNOSTICS build (`npm run mobile:build:diagnostics`).
    const js = [...chunks.values()].join("\n");
    expect(js).toContain("Native storage diagnostics");
    // The checkpoint scenarios ship with the panel, in the same opt-in.
    expect(js).toContain("Checkpoints and transactions");
    expect(js).toContain("diagnostic.synthetic.checkpoint.");
    // The two opt-ins are independent: a diagnostics build composes nothing.
    expect(js).not.toContain("curling-sporting-v1");
    // Everything that makes an artifact a PRODUCTION artifact must still hold:
    // the opt-in is a third axis, not a development mode.
    expect(js).not.toContain("00000000-0000-4000-8000-000000000001");
    expect(js).not.toContain("createUnscopedSportingRepositoriesForTests");
    expect(js).not.toMatch(/process\s*\.\s*env/);

    // The synthetic database is the only one the diagnostics code can address.
    // Checked per chunk, because unrelated dormant code elsewhere in the bundle
    // legitimately names other stores.
    for (const [, code] of diagnosticChunks) {
      expect(code).not.toContain("curling-release-tracker");
      expect(code).not.toContain("curling.identity.");
      expect(code).not.toContain("curling.session");
    }
  });

  it("omits ALL native storage composition code unless the build opted in", async () => {
    // Stage M3b3's opt-in is a separate axis from the diagnostics one above, so
    // this check is separate too: a diagnostics build must still contain no
    // composition, and a composition build must still contain no diagnostics.
    const js = await bundledScript();
    const assets = await readdir(path.join(distRoot, "assets"));

    // The application database name is the single most telling marker: it exists
    // nowhere except the composition module.
    const composed = js.includes("curling-sporting-v1");

    if (!composed) {
      // A DEFAULT (or diagnostics-only) build. The composition is not merely
      // inert — it is ABSENT, because the conditional import in MobileApp.tsx
      // folds away.
      expect(js).not.toContain("curling.credentials.v1.");
      expect(js).not.toContain("Preparing device storage");
      expect(js).not.toContain("migration_not_implemented");
      expect(js).not.toContain("SecureStorage");
      expect(js).not.toContain("capacitor-storage_");
      expect(assets.some((name) => name.includes("NativeStorageComposition"))).toBe(false);
      expect(assets.some((name) => name.includes("SecureStorageBinding"))).toBe(false);
      return;
    }

    // A NATIVE-STORAGE build (`npm run mobile:build:native-storage`).
    expect(js).toContain("Preparing device storage");
    expect(js).toContain("curling.credentials.v1.");
    // The barrier ships; a ready verdict does not. `nativeActivationReadyForTests`
    // is the only constructor of one, and it is eliminated because no production
    // module references it.
    expect(js).toContain("migration_not_implemented");
    expect(js).not.toContain("nativeActivationReadyForTests");
    // The diagnostics panel and its synthetic database stay out — the two
    // opt-ins are independent.
    expect(js).not.toContain(DIAGNOSTIC_DATABASE_NAME);
    expect(js).not.toContain("Native storage diagnostics");
    expect(js).not.toContain("Checkpoints and transactions");
    expect(js).not.toContain("diagnostic.synthetic.checkpoint.");
    // Everything that makes an artifact a PRODUCTION artifact still holds.
    expect(js).not.toContain("00000000-0000-4000-8000-000000000001");
    expect(js).not.toContain("createUnscopedSportingRepositoriesForTests");
    expect(js).not.toMatch(/process\s*\.\s*env/);
  });

  it("ships no native-migration executor in ANY build mode (Stage M3b4b is dormant)", async () => {
    // The migration runner, its evidence collector and its bindings are imported
    // by no application root, so no build — default, diagnostics or native
    // storage — may contain them. Ordinary opted-in SQL discovery does need
    // the exact pre-existing control addresses; it supplies no migration grant.
    const js = await bundledScript();
    expect(admitsOnlyExistingSqlControlReferences(js)).toBe(true);
    // Boolean assertions keep an unexpected full built bundle (which contains
    // public configuration) out of failure diagnostics.
    for (const marker of [
      "The migration runner needs every dependency",
      "curling-installation-transfer",
      "curling-protected-installation-v1",
      "installation_transfer_quarantine_v1",
      "installation_transfer_publication_v1", "installation_transfer_live_v1",
      "installation_transfer_prepared_v1",
      "installation_transfer_sporting_v1", "installation_transfer_pair_v1", "installation_transfer_binding_v1", "installation_transfer_identity_v1", "installation-source-denial/v1", "installation-source-denial/v2", "installation_transfer_source_denial_v1", "admitSourceAwareTransferPreparation", "evaluateTransferSourceDenial", "createInstallationTransferIdentityOwner", "publishTransferIdentityRuntime", "createConfiguredInstallationTransferIdentityHost", "createConfiguredInstallationTransferApplicationHost", "createInstallationTransferApplication", "createInstallationTransferHostOwner", "createTransferSourceGuardOwner", "createTransferAccountControlObservation", "readTransferAccountControlObservation", "createPublicationTransferCredentialMigrationPort", "publicationTransferCredentialCapability", "curling-installation-publication-v1", "installation-publication-anchor/v1", "installation-published-wire/v1", "installation-published-sporting/v1",
      "u16:",
      "source_observation",
      "The data check has ended. Reopen the helper to check again.",
    ]) expect(js.includes(marker)).toBe(false);
  });

  it("the SQL control exception rejects default, extra, duplicate and unproven references", () => {
    const addresses = [
      "curling.nativeMigration.", "curling.nativeMigration.",
      "curling.nativeMigration.activationRecord.v1", "curling.nativeMigration.activationRecord.v1",
      "curling.nativeMigration.faultLatch.v1", "curling.nativeMigration.faultLatch.v1",
      "curling.nativeMigration.sourceMarker.v1",
    ].join(" ");
    const schema = "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name;";
    for (const mode of [DIAGNOSTIC_DATABASE_NAME, "curling-sporting-v1"]) {
      const admitted = `${mode} ${schema} ${addresses}`;
      expect(admitsOnlyExistingSqlControlReferences(admitted)).toBe(true);
      expect(admitsOnlyExistingSqlControlReferences(`${mode} ${addresses}`)).toBe(false);
      expect(admitsOnlyExistingSqlControlReferences(`${admitted} curling.nativeMigration.future.v2`)).toBe(false);
      expect(admitsOnlyExistingSqlControlReferences(`${admitted} curling.nativeMigration.sourceMarker.v1`)).toBe(false);
      expect(admitsOnlyExistingSqlControlReferences(admitted.replace("sourceMarker", "unexpected"))).toBe(false);
    }
    expect(admitsOnlyExistingSqlControlReferences(`${schema} ${addresses}`)).toBe(false);
    expect(admitsOnlyExistingSqlControlReferences("curling.nativeMigration.sourceMarker.v1")).toBe(false);
    expect(admitsOnlyExistingSqlControlReferences("ordinary default artifact")).toBe(true);
  });

  it("ships no migration recovery interface in ANY build mode (Stage M3b4c is dormant)", async () => {
    // The recovery session, presentation model and view are imported by no
    // application root. Their own fixed strings are the markers.
    const js = await bundledScript();
    expect(js).not.toContain("A migration session needs an already-constructed runner");
    expect(js).not.toContain("Storage transfer diagnostic report");
    expect(js).not.toContain("Conflicting data — recovery required");
    expect(js).not.toContain("The transfer cannot continue in this version");
  });

  it("deploys no Web SQLite ENGINE in any build, and the plugin's web stub fails closed", async () => {
    // Unconditional, and separate from every opt-in above: the native adapter is
    // native-only by design (ADR-0049), the Web keeps `localStorageAdapter`, and
    // no build may carry a browser SQLite deployment.
    //
    // Stated precisely, because the naive check is wrong. `registerPlugin`'s
    // loader map means importing `@capacitor-community/sqlite` at all emits the
    // plugin's own `web.js` as a lazy chunk, and that file NAMES `jeep-sqlite`.
    // It is a stub: it looks for a `<jeep-sqlite>` custom element in the DOM and
    // throws when there is none. So the property to assert is that no ENGINE is
    // deployed and nothing provides that element — not that the string is
    // absent.
    const assets = await readdir(path.join(distRoot, "assets"));
    const top = await readdir(distRoot);
    const html = await readDist("index.html");

    // No WebAssembly engine, anywhere.
    expect(assets.some((name) => name.endsWith(".wasm"))).toBe(false);
    expect(top.some((name) => name.endsWith(".wasm"))).toBe(false);
    const js = await bundledScript();
    expect(js).not.toContain("sql-wasm");
    expect(js).not.toContain("sqlite3.wasm");

    // And nothing registers or renders the element the stub needs, so the Web
    // path cannot silently start working.
    expect(html).not.toContain("jeep-sqlite");
    expect(js).not.toContain('define("jeep-sqlite"');
    expect(js).not.toContain("createElement(`jeep-sqlite`)");
    expect(js).not.toContain('createElement("jeep-sqlite")');
  });

  it("loads entirely from the app container", async () => {
    const html = await readDist("index.html");

    // Every script and stylesheet reference is relative. A remote one would
    // break offline launch and reintroduce the remote-wrapper security model
    // docs/MOBILE_APP_MIGRATION.md §3.4 rejects.
    const references = [...html.matchAll(/(?:src|href)="([^"]+)"/g)].map(
      (match) => match[1]
    );
    expect(references.length).toBeGreaterThan(0);
    for (const reference of references) {
      expect(reference.startsWith("./")).toBe(true);
    }
    expect(html).toContain("viewport-fit=cover");
  });
});
