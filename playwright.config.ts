import { defineConfig, devices } from "@playwright/test";

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
  use: {
    baseURL: "http://localhost:3100",
    trace: "retain-on-failure",
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
    reuseExistingServer: !process.env.CI,
    timeout: 60_000,
  },
});
