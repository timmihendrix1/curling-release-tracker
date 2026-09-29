// @vitest-environment node
import { createReadStream } from "node:fs";
import { readdir, readFile, rm } from "node:fs/promises";
import { createServer, type Server } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium, type Browser, type ConsoleMessage } from "@playwright/test";
import { build } from "vite";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
  CURRENT_PUBLIC_EXERCISE_ASSET_IDS,
  PUBLIC_EXERCISE_DIAGRAM_PATHS,
} from "../../src/lib/exercises/restrictedAssetCatalog";

const mobileRoot = path.dirname(path.dirname(fileURLToPath(import.meta.url)));
const workRoot = path.join(mobileRoot, ".tmp-verification");

/**
 * Behavioural checks against a REAL production mobile bundle, loaded in a real
 * browser from a plain static server — the closest this repository can get to
 * "Capacitor serves these bytes from the app container" without a device.
 *
 * Each variant is built from the actual mobile/vite.config.ts with a different
 * cloud configuration, so what is exercised is the shipped bundle's own inlined
 * literals rather than a test double of them.
 *
 * Note on "missing" configuration: a build with the two public variables set to
 * empty strings is behaviourally identical to one where they are absent —
 * `resolveCloudConfig` normalises both to "" and returns `cloud_disabled`. The
 * genuinely-absent case inlines the literal `undefined`, and the property that
 * matters about it (that no unreplaced `process.env` reference survives to throw
 * "process is not defined") is proven directly on the artifact in
 * bundle.test.ts.
 */

/** Synthetic cloud configurations. No real project URL or key appears here. */
const UNCONFIGURED = {
  NEXT_PUBLIC_SUPABASE_URL: "",
  NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "",
} as const;

type Variant = {
  /** Vite `--mode`: selects CONFIGURATION only. It must never reach NODE_ENV. */
  readonly mode: string;
  /** Ambient NODE_ENV the build is invoked under. */
  readonly ambientNodeEnv?: string;
  readonly env: Readonly<Record<string, string>>;
};

const VARIANTS = {
  // No cloud configured at all, default production mode.
  unconfigured: { mode: "production", env: UNCONFIGURED },

  // Well-formed key, malformed URL: must fail closed, never "nearly configured".
  malformed: {
    mode: "production",
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "not-a-url",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_verificationonly",
    },
  },

  // Syntactically valid and therefore `configured`, but pointing at a reserved
  // non-resolvable TLD so no request can ever succeed. This is what makes the
  // *real* sign-in gate render, which is M1's completion criterion.
  configuredUnreachable: {
    mode: "production",
    env: {
      NEXT_PUBLIC_SUPABASE_URL: "https://verification.invalid",
      NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: "sb_publishable_verificationonly",
    },
  },

  // --- Build-mode matrix -------------------------------------------------
  // Every artifact this build produces is installable, so NONE of these may
  // ship development React, a development JSX transform, the IS_DEV surfaces or
  // ProfileScopedSportingPersistence's fixed test Profile fallback. `--mode`
  // selects which .env file is read; it is not an application runtime switch.

  // A custom configuration mode, e.g. a staging cloud project.
  customMode: { mode: "staging", env: UNCONFIGURED },

  // The mode whose name collides with the shared code's `NODE_ENV === "test"`
  // Profile-scope bypass. This is the case that previously shipped it.
  testMode: { mode: "test", env: UNCONFIGURED },

  // Built from a shell that already exports NODE_ENV=test, under mode "test" —
  // both axes wrong at once.
  testModeAmbientTestEnv: {
    mode: "test",
    ambientNodeEnv: "test",
    env: UNCONFIGURED,
  },

  // Ambient development NODE_ENV under the default production mode.
  ambientDevelopmentEnv: {
    mode: "production",
    ambientNodeEnv: "development",
    env: UNCONFIGURED,
  },
} as const satisfies Record<string, Variant>;

type VariantName = keyof typeof VARIANTS;

/** Variants that must all behave identically at runtime: production-safe. */
const BUILD_MODE_MATRIX: readonly VariantName[] = [
  "unconfigured",
  "customMode",
  "testMode",
  "testModeAmbientTestEnv",
  "ambientDevelopmentEnv",
];

/**
 * ProfileScopedSportingPersistence's `NODE_ENV === "test"` fallback Profile id.
 * Its presence in an artifact is a production-reachable bypass of Profile scope
 * (docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md: Profile
 * scope is mandatory, and Free is a tier rather than an exemption).
 */
const TEST_PROFILE_FALLBACK = "00000000-0000-4000-8000-000000000001";

/**
 * Markers of a DEVELOPMENT React build in the artifact.
 *
 * `jsxDEV` is the development JSX transform @vitejs/plugin-react emits when Vite
 * considers the build non-production. `Each child in a list…` is a warning string
 * present only in React's development runtime — a direct signature of the
 * development React build being linked, rather than an inference from the
 * transform.
 *
 * Either one in an installable artifact means the build shipped development
 * React, which also means the shared `IS_DEV` condition (`NODE_ENV !==
 * "production"`) is true and the Timing Simulator and Brower BLE diagnostic
 * screen are reachable.
 */
const DEVELOPMENT_REACT_MARKERS = [
  "jsxDEV",
  "Each child in a list should have a unique",
] as const;

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".png": "image/png",
};

function serve(directory: string): Promise<{ origin: string; server: Server }> {
  const server = createServer((request, response) => {
    const requested = decodeURIComponent((request.url ?? "/").split("?")[0]);
    const relative = requested === "/" ? "/index.html" : requested;
    const file = path.join(directory, path.normalize(relative));
    if (!file.startsWith(directory)) {
      response.writeHead(403).end();
      return;
    }
    const stream = createReadStream(file);
    stream.on("error", () => response.writeHead(404).end());
    stream.on("open", () => {
      response.writeHead(200, {
        "content-type":
          CONTENT_TYPES[path.extname(file)] ?? "application/octet-stream",
      });
      stream.pipe(response);
    });
  });
  return new Promise((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      const port = typeof address === "object" && address !== null ? address.port : 0;
      resolve({ origin: `http://127.0.0.1:${port}`, server });
    });
  });
}

/**
 * Builds one variant from the REAL mobile/vite.config.ts.
 *
 * A build that is rejected outright is an acceptable outcome for an unsupported
 * mode — what is not acceptable is producing an artifact that is not
 * production-safe. `error` records which happened so the assertions can accept
 * either.
 */
type BuiltVariant = { outDir: string; error: Error | null };

async function buildVariant(name: VariantName): Promise<BuiltVariant> {
  const variant: Variant = VARIANTS[name];
  const outDir = path.join(workRoot, name);
  const previous = new Map<string, string | undefined>();
  // NODE_ENV is saved and restored because the mobile config pins it for a
  // build; this is a Vitest process and must get its own value back.
  previous.set("NODE_ENV", process.env.NODE_ENV);
  // Cast: Vite's types declare NODE_ENV readonly. Driving it is the whole point
  // of the ambient-environment half of this matrix.
  const ambient = process.env as Record<string, string | undefined>;
  if (variant.ambientNodeEnv === undefined) delete ambient.NODE_ENV;
  else ambient.NODE_ENV = variant.ambientNodeEnv;
  for (const [key, value] of Object.entries(variant.env)) {
    previous.set(key, process.env[key]);
    process.env[key] = value;
  }
  let error: Error | null = null;
  try {
    await build({
      configFile: path.join(mobileRoot, "vite.config.ts"),
      mode: variant.mode,
      logLevel: "error",
      build: { outDir, emptyOutDir: true },
    });
  } catch (thrown) {
    error = thrown instanceof Error ? thrown : new Error(String(thrown));
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
  return { outDir, error };
}

async function bundledScript(outDir: string): Promise<string> {
  const assets = await readdir(path.join(outDir, "assets"));
  const scripts = assets.filter((name) => name.endsWith(".js"));
  expect(scripts.length).toBeGreaterThan(0);
  const contents = await Promise.all(
    scripts.map((name) => readFile(path.join(outDir, "assets", name), "utf8"))
  );
  return contents.join("\n");
}

type PageObservation = {
  html: string;
  text: string;
  gateHeading: string | null;
  hasNavigation: boolean;
  randomUuid: string | null;
  /** Uncaught exceptions. Any entry here is a broken bundle. */
  pageErrors: string[];
  /** console.error output, including failed network requests. */
  consoleErrors: string[];
};

let browser: Browser;

/**
 * Waiting for `#identity-gate-title` alone is NOT enough for a variant whose
 * expected state depends on a network attempt failing first: the gate frame —
 * and that heading — render in every state, including the initial "Preparing
 * athlete access…" progress copy. Sampling at that moment races the failed
 * request, which is a load-sensitive flake rather than a product defect.
 *
 * `settledText` names the copy that proves the runtime reached its terminal
 * state, so the observation is taken once, deterministically, after it. No
 * assertion is relaxed by this — the test still requires exactly that text.
 */
async function observe(
  directory: string,
  settledText?: string
): Promise<PageObservation> {
  const { origin, server } = await serve(directory);
  const page = await browser.newPage({ viewport: { width: 390, height: 844 } });
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message: ConsoleMessage) => {
    if (message.type() === "error") consoleErrors.push(message.text());
  });
  try {
    await page.goto(origin, { waitUntil: "load" });
    try {
      await page.waitForSelector("#identity-gate-title", { timeout: 15_000 });
    if (settledText !== undefined) {
      await page.waitForFunction(
        (expected: string) => document.body.innerText.includes(expected),
        settledText,
        { timeout: 15_000 }
      );
    }
    } catch (waitFailure) {
      // DIAGNOSTICS, NOT A RETRY OR A RELAXED ASSERTION. The gate must still
      // appear or this test still fails; this only makes the failure
      // self-explaining. A bare TimeoutError says nothing about whether the
      // bundle threw, failed to load an asset, or simply had not painted —
      // which is exactly the information an intermittent failure needs to be
      // diagnosed rather than re-run until it passes.
      const reason = waitFailure instanceof Error ? waitFailure.message : String(waitFailure);
      throw new Error(
        [
          `The identity gate never rendered for ${directory}.`,
          `wait failure: ${reason}`,
          `page errors: ${pageErrors.length === 0 ? "(none)" : pageErrors.join(" | ")}`,
          `console errors: ${consoleErrors.length === 0 ? "(none)" : consoleErrors.join(" | ")}`,
          `document: ${(await page.content()).slice(0, 2000)}`,
        ].join("\n")
      );
    }
    return {
      html: await page.content(),
      text: await page.locator("body").innerText(),
      gateHeading: await page.textContent("#identity-gate-title"),
      hasNavigation: (await page.locator("nav").count()) > 0,
      // The shared identity runtime's browser id source calls this; M1's
      // physical-device list asks for it explicitly.
      randomUuid: await page.evaluate(() =>
        typeof crypto?.randomUUID === "function" ? crypto.randomUUID() : null
      ),
      pageErrors,
      consoleErrors,
    };
  } finally {
    await page.close();
    server.close();
  }
}

describe("built mobile bundle in a browser", () => {
  const built = new Map<VariantName, BuiltVariant>();

  /** The output directory of a variant that was expected to build. */
  function supported(name: VariantName): string {
    const result = built.get(name);
    expect(result, `variant ${name} was never built`).toBeDefined();
    expect(result!.error, `variant ${name} failed to build`).toBeNull();
    return result!.outDir;
  }

  beforeAll(async () => {
    await rm(workRoot, { recursive: true, force: true });
    browser = await chromium.launch();
    for (const name of Object.keys(VARIANTS) as VariantName[]) {
      built.set(name, await buildVariant(name));
    }
  }, 180_000);

  afterAll(async () => {
    await browser?.close();
    await rm(workRoot, { recursive: true, force: true });
  });

  it("reaches the real identity gate with no cloud configured", async () => {
    const observed = await observe(supported("unconfigured"));

    expect(observed.pageErrors).toEqual([]);
    expect(observed.consoleErrors).toEqual([]);
    expect(observed.gateHeading).toBe("Athlete access");
    expect(observed.html).toContain(
      "Athlete sign-in is unavailable in this build. The training application remains locked."
    );
    // The sporting workspace never mounted.
    expect(observed.hasNavigation).toBe(false);
    expect(observed.randomUuid).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/
    );
  }, 60_000);

  it("fails closed on malformed cloud configuration", async () => {
    const observed = await observe(supported("malformed"));

    expect(observed.pageErrors).toEqual([]);
    expect(observed.consoleErrors).toEqual([]);
    expect(observed.gateHeading).toBe("Athlete access");
    expect(observed.html).toContain("The training application remains locked.");
    expect(observed.hasNavigation).toBe(false);
  }, 60_000);

  it("runs the real identity runtime when a cloud is configured", async () => {
    const observed = await observe(
      supported("configuredUnreachable"),
      "Sign-in is not available yet because the current Privacy Notice is unavailable."
    );

    // No uncaught exception: an unreachable cloud is a state the shared runtime
    // handles, not a crash. The failed request itself DOES reach the console —
    // the host is deliberately unresolvable — so console errors are expected
    // here and only `pageErrors` must be empty.
    expect(observed.pageErrors).toEqual([]);
    expect(observed.consoleErrors.join("\n")).toContain("ERR_NAME_NOT_RESOLVED");

    expect(observed.gateHeading).toBe("Athlete access");
    // The runtime got far enough to construct a client and attempt the legal
    // snapshot, then reported the real, specific reason it cannot offer
    // sign-in — the application's own copy, not a build placeholder. Sign-in
    // itself is Stage M2 and is not claimed here.
    expect(observed.text).toContain(
      "Sign-in is not available yet because the current Privacy Notice is unavailable."
    );
    // Still no sporting workspace: no session exists.
    expect(observed.hasNavigation).toBe(false);
  }, 60_000);

  describe.each(BUILD_MODE_MATRIX)(
    "build mode %s produces an installable, production-safe artifact",
    (name) => {
      it("is either rejected outright or free of development runtime semantics", async () => {
        const result = built.get(name)!;
        if (result.error !== null) {
          // Explicit rejection of an unsupported mode is an acceptable outcome;
          // what must never happen is a non-production artifact.
          expect(result.error.message.length).toBeGreaterThan(0);
          return;
        }
        const js = await bundledScript(result.outDir);

        // The Profile-scope bypass. `--mode test` shipped this before the fix.
        expect(js).not.toContain(TEST_PROFILE_FALLBACK);
        // Development React. `--mode <anything but production>` shipped this
        // before the fix, so an installable artifact carried the development
        // runtime and had IS_DEV true.
        for (const marker of DEVELOPMENT_REACT_MARKERS) {
          expect(js).not.toContain(marker);
        }
        // And NODE_ENV itself is fully inlined, so nothing reads it at runtime.
        expect(js).not.toMatch(/process\s*\.\s*env/);
      }, 60_000);

      it("starts in a real browser and reaches the real identity gate", async () => {
        const result = built.get(name)!;
        if (result.error !== null) return; // rejected builds have no artifact

        const observed = await observe(result.outDir);

        expect(observed.pageErrors).toEqual([]);
        expect(observed.gateHeading).toBe("Athlete access");
        expect(observed.html).toContain(
          "Athlete sign-in is unavailable in this build. The training application remains locked."
        );
        // The sporting workspace never mounted.
        expect(observed.hasNavigation).toBe(false);
      }, 60_000);
    }
  );

  it("serves the bundled Exercise diagrams from the app's own origin", async () => {
    const { origin, server } = await serve(supported("unconfigured"));
    const page = await browser.newPage();
    try {
      await page.goto(origin, { waitUntil: "load" });
      for (const assetId of CURRENT_PUBLIC_EXERCISE_ASSET_IDS.slice(0, 5)) {
        const registeredPath = PUBLIC_EXERCISE_DIAGRAM_PATHS[assetId];
        // Fetched exactly as createPublicExerciseAssetResolver fetches it: a
        // root-relative path against the document's own origin.
        const result = await page.evaluate(async (assetPath) => {
          const response = await fetch(assetPath, { method: "GET" });
          return {
            ok: response.ok,
            contentType: response.headers.get("content-type"),
            byteLength: (await response.arrayBuffer()).byteLength,
          };
        }, registeredPath);
        const source = await readFile(
          path.join(mobileRoot, "..", "public", registeredPath)
        );
        expect(result.ok).toBe(true);
        expect(result.contentType).toBe("image/png");
        expect(result.byteLength).toBe(source.byteLength);
      }
    } finally {
      await page.close();
      server.close();
    }
  }, 60_000);
});
