import { isNewUserBetaRequested, MOBILE_NEW_USER_BETA_DEFINE_NAME, MOBILE_NEW_USER_BETA_ENV_NAME } from "./newUserBetaFlag";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import { defineConfig, loadEnv, type Plugin } from "vite";
import { MOBILE_INLINED_PUBLIC_ENV_NAMES } from "./publicEnv";
import {
  isStorageDiagnosticsRequested,
  MOBILE_STORAGE_DIAGNOSTICS_DEFINE_NAME,
  MOBILE_STORAGE_DIAGNOSTICS_ENV_NAME,
} from "./storageDiagnosticsFlag";
import {
  isNativeStorageCompositionRequested,
  MOBILE_NATIVE_STORAGE_DEFINE_NAME,
  MOBILE_NATIVE_STORAGE_ENV_NAME,
} from "./nativeStorageFlag";
import {
  PUBLIC_EXERCISE_ASSET_IDS,
  PUBLIC_EXERCISE_DIAGRAM_PATHS,
} from "../src/lib/exercises/restrictedAssetCatalog";

const mobileRoot = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(mobileRoot, "..");

/**
 * Emits every registered public Exercise diagram into the bundle.
 *
 * Deliberately not Vite's `publicDir`: pointing that at the repository's
 * `public/` would also copy Next's placeholder SVGs, the stray
 * `public/public/manifest.json` and anything else that lands there. This copies
 * exactly the assets the catalogue registers — current AND superseded ids, because
 * a saved Training Plan step or a recorded result may reference a superseded
 * diagram and must keep resolving offline (ADR-0046).
 *
 * A registered asset whose file is missing FAILS THE BUILD. Shipping an app that
 * silently cannot render a diagram offline is the failure this prevents.
 */
export function exerciseDiagramsPlugin(
  // Injectable only so the negative case — a registered diagram with no file —
  // can be exercised against a temporary fixture directory instead of by
  // removing a real repository asset. The default is the only value the build
  // ever uses.
  publicRoot: string = path.join(repositoryRoot, "public")
): Plugin {
  return {
    name: "mobile-exercise-diagrams",
    async buildStart() {
      const missing: string[] = [];
      for (const assetId of PUBLIC_EXERCISE_ASSET_IDS) {
        const registeredPath = PUBLIC_EXERCISE_DIAGRAM_PATHS[assetId];
        const source = path.join(publicRoot, registeredPath);
        let bytes: Buffer;
        try {
          bytes = await readFile(source);
        } catch {
          missing.push(`${assetId} (${registeredPath})`);
          continue;
        }
        this.emitFile({
          type: "asset",
          // `registeredPath` is the absolute request path the shared resolver
          // fetches (`/exercise-diagrams/…`); the bundle must answer it at
          // exactly that path.
          fileName: registeredPath.replace(/^\/+/, ""),
          source: bytes,
        });
      }
      if (missing.length > 0) {
        this.error(
          `Mobile build aborted: ${missing.length} registered public Exercise diagram(s) have no file under public/ — ` +
            `${missing.join(", ")}. The bundle is the app's only offline source for these images.`
        );
      }
    },
  };
}

export default defineConfig(({ command, mode }) => {
  // MODE SELECTS CONFIGURATION. NODE_ENV IS RUNTIME SEMANTICS. They are not the
  // same axis and this build must never collapse one into the other.
  //
  // `--mode` exists so a build can pick a different `.env.<mode>` file (a
  // staging cloud project, a synthetic configuration for verification). It must
  // NOT decide whether the application runs its production guards, because
  // every artifact this build produces is installable:
  //
  //   - `NODE_ENV !== "production"` is the shared `IS_DEV` condition
  //     (TrackerApp.tsx), which exposes the Timing Simulator and the Brower BLE
  //     diagnostic screen.
  //   - `NODE_ENV === "test"` is ProfileScopedSportingPersistence's fixed test
  //     Profile fallback — a bypass of Profile scope that must never exist in an
  //     installable build.
  //   - Vite derives `isProduction` — and therefore which JSX transform
  //     @vitejs/plugin-react emits and which React runtime is linked — from the
  //     AMBIENT `process.env.NODE_ENV`. A mismatch dies on first render with
  //     "jsxDEV is not a function".
  //
  // So: any `vite build`, under ANY mode and from ANY ambient environment,
  // produces a production artifact. Only a dev server is "development", and a
  // dev server is not something anyone installs.
  const applicationNodeEnv = command === "build" ? "production" : "development";
  // Cast: Vite's own types declare NODE_ENV readonly, but setting it is the
  // documented way to fix `isProduction`. This is set before `loadEnv` and
  // before Vite computes `isProduction`, so it governs both the React runtime
  // and the JSX transform as well as the `define` below.
  (process.env as Record<string, string>).NODE_ENV = applicationNodeEnv;

  // `loadEnv` reads the repository's .env files the same way `next build` does,
  // so the mobile build uses the same configuration source as the Web build.
  // Its values are never logged, and only the names in
  // MOBILE_INLINED_PUBLIC_ENV_NAMES are ever read out of it — this object is
  // never serialised into the bundle.
  const env = loadEnv(mode, repositoryRoot, "");

  // THE DIAGNOSTICS OPT-IN IS A THIRD AXIS, independent of both `mode` and
  // NODE_ENV. It decides one thing only: whether the native storage diagnostics
  // panel exists in the artifact. It does not relax production React semantics,
  // does not re-enable `IS_DEV` surfaces and does not reach the
  // `NODE_ENV === "test"` Profile-scope fallback, because those all come from
  // the `applicationNodeEnv` pinned above and are untouched here.
  //
  // The variable's VALUE never reaches the bundle: it is read, compared, and
  // replaced by a plain boolean literal, which is what lets Rollup eliminate the
  // panel's dynamic import from a default build entirely.
  const storageDiagnostics = isStorageDiagnosticsRequested(
    process.env[MOBILE_STORAGE_DIAGNOSTICS_ENV_NAME]
  );

  // NATIVE STORAGE COMPOSITION IS A FOURTH AXIS, independent of `mode`,
  // NODE_ENV and the diagnostics opt-in above. It decides one thing only:
  // whether the artifact contains the native storage composition at all.
  //
  // It is NOT the same switch as diagnostics, and the two must not be merged:
  // diagnostics drives a synthetic database and never touches application data,
  // whereas this flag governs where the real application's data would come from.
  //
  // Turning it on does not cut over. The composition consults a
  // migration/activation authority that is unavailable in this stage, so the
  // build blocks with a preparation state rather than mounting the app against
  // an empty store (mobile/nativeStorageFlag.ts, mobile/README.md).
  //
  // The variable's VALUE never reaches the bundle: it is read, compared, and
  // replaced by a plain boolean literal, which is what lets Rollup eliminate the
  // composition's dynamic import from a default build entirely.
  const nativeStorage = isNativeStorageCompositionRequested(
    process.env[MOBILE_NATIVE_STORAGE_ENV_NAME]
  );

  const newUserBeta = isNewUserBetaRequested(process.env[MOBILE_NEW_USER_BETA_ENV_NAME]);
  if (newUserBeta && (storageDiagnostics || nativeStorage)) throw new Error("New-user beta cannot be combined with storage diagnostics or legacy storage composition.");

  const define: Record<string, string> = {
    [MOBILE_NEW_USER_BETA_DEFINE_NAME]: JSON.stringify(newUserBeta),
    // Deliberately NOT derived from `mode` — see the note above.
    "process.env.NODE_ENV": JSON.stringify(applicationNodeEnv),
    [MOBILE_STORAGE_DIAGNOSTICS_DEFINE_NAME]: JSON.stringify(storageDiagnostics),
    [MOBILE_NATIVE_STORAGE_DEFINE_NAME]: JSON.stringify(nativeStorage),
  };
  for (const name of MOBILE_INLINED_PUBLIC_ENV_NAMES) {
    const value = env[name] ?? process.env[name];
    // An absent value is inlined as the literal `undefined`, NOT as "". That is
    // what `resolveCloudConfig`'s optional parameters expect, so a build with no
    // cloud configuration reaches the honest `cloud_unavailable` gate instead of
    // throwing "process is not defined" — and it never fabricates a configured
    // cloud.
    define[`process.env.${name}`] =
      value === undefined ? "undefined" : JSON.stringify(value);
  }

  return {
    root: mobileRoot,
    // Capacitor serves the bundle from the app container; relative asset URLs
    // resolve there regardless of how the native scheme is mounted.
    base: "./",
    // .env files live at the repository root, next to the Web build's.
    envDir: repositoryRoot,
    define,
    plugins: [react(), tailwindcss(), exerciseDiagramsPlugin()],
    build: {
      outDir: path.join(mobileRoot, "dist"),
      emptyOutDir: true,
      target: "es2022",
      sourcemap: false,
      rollupOptions: {
        onwarn(warning, defaultHandler) {
          // The shared components carry Next's "use client" directive. Rollup
          // has no use for it and warns once per file; the directive is
          // meaningless — not harmful — in this build.
          if (
            warning.code === "MODULE_LEVEL_DIRECTIVE" ||
            /"use client"/.test(warning.message)
          ) {
            return;
          }
          defaultHandler(warning);
        },
      },
    },
    server: { port: 5183 },
    preview: { port: 5183 },
  };
});
