import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // tests/e2e/*.spec.ts are Playwright specs (see playwright.config.ts), run via
    // `npm run test:e2e` — Vitest's default include pattern would otherwise also pick
    // them up and fail, since they use @playwright/test's own test()/expect().
    // tools/brower-ios-probe is a standalone Capacitor project with its OWN
    // package.json, node_modules and Vitest run (see
    // docs/BROWER_IOS_FEASIBILITY.md). Without this, the pattern above — which
    // anchors node_modules at the repository root — lets this run collect the
    // .spec.js files shipped inside that project's dependencies and fail on
    // them. Deliberately narrow: it names one directory, not `tools/**`.
    // mobile/** is the Capacitor client's own Vitest project
    // (mobile/vitest.config.ts, run by `npm run mobile:test`). Its checks need
    // the React plugin and, for the built-artifact ones, a completed `npm run
    // mobile:build` — neither of which this run provides. Excluded here so they
    // run where they work, NOT so they go unrun: `npm run mobile:verify` is the
    // command that runs them, and the root `npx tsc --noEmit` and `npm run lint`
    // still cover the same files.
    exclude: [
      "node_modules/**",
      "tests/e2e/**",
      "tools/brower-ios-probe/**",
      "mobile/**",
    ],
  },
});
