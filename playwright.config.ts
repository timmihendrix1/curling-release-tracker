import { defineConfig, devices } from "@playwright/test";
import { E2E_AUTH_STATE_PATH } from "./tests/e2e/global-setup";

// Formal Playwright config, replacing the ad hoc chromium.launch() scripts used for
// verification in earlier feature passes (see docs/TECHNICAL_DEBT_AND_ROADMAP.md).
//
// Runs against `next dev`, not a production build — deliberately. The Timing Simulator
// (src/components/TimingSimulatorPanel.tsx) is gated behind
// `process.env.NODE_ENV !== "production"` by design (it's a development/test tool, not
// part of the production UX — see docs/SYSTEM_ARCHITECTURE.md's Capture Sequence
// section), so a production-build server would hide the exact UI most of this suite
// exercises. The Regression group (tests/e2e/regression.spec.ts) covers the
// classic manual-entry flows that work identically in both modes.
export default defineConfig({
  testDir: "./tests/e2e",
  fullyParallel: false,
  retries: 0,
  reporter: "list",
  globalSetup: "./tests/e2e/global-setup.ts",
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
    storageState: E2E_AUTH_STATE_PATH,
  },
  projects: [
    {
      name: "chromium",
      use: { ...devices["Desktop Chrome"], viewport: { width: 390, height: 844 } },
    },
  ],
  webServer: {
    command: "npm run dev -- -p 3100",
    url: "http://localhost:3100",
    // The E2E runner injects the local browser-public Supabase values into this
    // process. Reusing an older dev server could silently retain another build's
    // environment and make the gate test something else.
    reuseExistingServer: false,
    timeout: 60_000,
  },
});
