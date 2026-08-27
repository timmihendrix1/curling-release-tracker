import { spawnSync } from "node:child_process";
import { join } from "node:path";

// Read the local CLI status into this process, select only the two browser-public
// values, and discard the rest without printing or forwarding it. No committed or
// user-local environment file is read, and no server credential enters Playwright.
const status = spawnSync("supabase", ["status", "-o", "json"], {
  cwd: process.cwd(),
  encoding: "utf8",
  stdio: ["ignore", "pipe", "pipe"],
});
if (status.status !== 0) {
  throw new Error("Local Supabase status is unavailable. Run the E2E preflight first.");
}

let values;
try {
  values = JSON.parse(status.stdout);
} catch {
  throw new Error("Local Supabase status returned an invalid response.");
}

const apiUrl = values.API_URL;
const publishableKey = values.PUBLISHABLE_KEY;
if (typeof apiUrl !== "string" || !apiUrl.startsWith("http://127.0.0.1:")) {
  throw new Error("Local Supabase did not report its expected loopback API URL.");
}
if (typeof publishableKey !== "string" || !publishableKey.startsWith("sb_publishable_")) {
  throw new Error("Local Supabase did not report a browser publishable key.");
}

const playwright = join(process.cwd(), "node_modules", ".bin", "playwright");
const inheritedEnvironmentNames = [
  "PATH",
  "HOME",
  "TMPDIR",
  "LANG",
  "LC_ALL",
  "TERM",
  "CI",
  "NO_COLOR",
  "FORCE_COLOR",
  "PLAYWRIGHT_BROWSERS_PATH",
];
const childEnvironment = Object.fromEntries(
  inheritedEnvironmentNames.flatMap((name) => {
    const value = process.env[name];
    return typeof value === "string" ? [[name, value]] : [];
  })
);
const run = spawnSync(playwright, ["test", ...process.argv.slice(2)], {
  cwd: process.cwd(),
  stdio: "inherit",
  env: {
    // Deliberately do not inherit arbitrary shell variables. In particular,
    // server credentials for Supabase, SMTP or a real OAuth provider must never
    // enter Playwright or the browser-facing Next.js process.
    ...childEnvironment,
    NEXT_PUBLIC_SUPABASE_URL: apiUrl,
    NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY: publishableKey,
  },
});

process.exit(run.status ?? 1);
