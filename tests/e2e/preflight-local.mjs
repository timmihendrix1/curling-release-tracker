import { spawnSync } from "node:child_process";

// Supabase CLI startup output contains local development credentials. Keep that
// output inside this process and report only success or a generic failure.
const start = spawnSync("supabase", ["start"], {
  cwd: process.cwd(),
  stdio: ["ignore", "ignore", "ignore"],
});
if (start.status !== 0) {
  throw new Error("Local Supabase could not be started for E2E verification.");
}

// This is deliberately destructive only to the CLI's local test database. The
// reset applies committed migrations and local automated-test fixtures.
const reset = spawnSync("supabase", ["db", "reset", "--local", "--yes"], {
  cwd: process.cwd(),
  stdio: "inherit",
});
if (reset.status !== 0) {
  throw new Error("The local Supabase E2E database could not be reset.");
}
