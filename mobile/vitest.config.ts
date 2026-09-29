import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vitest/config";

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
  test: {
    root: mobileRoot,
    include: ["__tests__/**/*.test.ts", "__tests__/**/*.test.tsx"],
    // Every file opts in to its own environment with a `@vitest-environment`
    // pragma, matching the repository's existing convention, so no test
    // silently gains a browser global it did not ask for.
    environment: "node",
  },
});
