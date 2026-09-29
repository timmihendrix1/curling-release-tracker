/// <reference types="vitest/config" />
import { defineConfig } from "vite";

// The probe is packaged into a native iOS app by Capacitor, which loads the built
// assets from the app bundle over a local scheme. Relative asset paths are therefore
// required — an absolute "/assets/..." path does not resolve inside the bundle.
export default defineConfig({
  base: "./",
  build: {
    outDir: "dist",
    // Capacitor serves the bundle from the app container, so a source map adds size
    // without adding a debugging path this prototype can use.
    sourcemap: false,
    target: "es2022",
  },
  test: {
    // Node is the default because every test here exercises pure logic against an
    // injected transport. The one DOM test opts in with its own
    // `@vitest-environment jsdom` pragma, so no test silently gains a browser global.
    environment: "node",
    include: ["src/**/*.test.ts"],
  },
});
