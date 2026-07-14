import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // tests/e2e/*.spec.ts are Playwright specs (see playwright.config.ts), run via
    // `npm run test:e2e` — Vitest's default include pattern would otherwise also pick
    // them up and fail, since they use @playwright/test's own test()/expect().
    exclude: ["node_modules/**", "tests/e2e/**"],
  },
});
