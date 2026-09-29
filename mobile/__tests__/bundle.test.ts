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
