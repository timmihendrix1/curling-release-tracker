import { MOBILE_NEW_USER_BETA_DEFINE_NAME } from "./newUserBetaFlag";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";
import { MOBILE_STORAGE_DIAGNOSTICS_DEFINE_NAME } from "./storageDiagnosticsFlag";
import { MOBILE_NATIVE_STORAGE_DEFINE_NAME } from "./nativeStorageFlag";

const mobileRoot = path.dirname(fileURLToPath(import.meta.url));

/**
 * Stage M1's own checks (`npm run mobile:test`).
 *
 * These are NOT part of the root `npm test` run: the root Vitest project has no
 * React plugin and the built-artifact checks here require `npm run mobile:build`
 * to have run first. `npm run mobile:verify` chains the two in the right order.
 *
 * The root run does not silently lose sight of these files — the root
 * `vitest.config.ts` excludes `mobile/**` explicitly and names this config as
 * where they run instead.
 */
export default defineConfig({
  plugins: [react()],
  // These checks run against a DEFAULT build's semantics: BOTH storage opt-ins
  // are off, exactly as they are for anyone who did not set the environment
  // variables. The names come from the same modules the production build reads,
  // so they cannot drift. A test that needs the flag-enabled tree renders the
  // composition root directly rather than flipping a define.
  define: {
    [MOBILE_NEW_USER_BETA_DEFINE_NAME]: "false",
    [MOBILE_STORAGE_DIAGNOSTICS_DEFINE_NAME]: "false",
    [MOBILE_NATIVE_STORAGE_DEFINE_NAME]: "false",
  },
  test: {
    root: mobileRoot,
    include: ["__tests__/**/*.test.ts", "__tests__/**/*.test.tsx"],
    // Every file opts in to its own environment with a `@vitest-environment`
    // pragma, matching the repository's existing convention, so no test
    // silently gains a browser global it did not ask for.
    environment: "node",
  },
});
