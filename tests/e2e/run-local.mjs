import { spawnSync } from "node:child_process";
import { join } from "node:path";
import { realpathSync } from "node:fs";
// Internal child entry only. The public entry creates the owned stack first.
const root = process.env.CURLING_E2E_TEMP_ROOT;
if (process.env.CURLING_E2E_ISOLATED !== "1" || !root || !realpathSync(root).startsWith("/private/tmp/curling-e2e-infra-") || realpathSync(root) !== realpathSync(process.cwd())) {
  throw new Error("Use npm run test:e2e; this child requires a private isolated source copy.");
}
const names = ["PATH", "HOME", "TMPDIR", "LANG", "LC_ALL", "TERM", "CI", "NO_COLOR", "FORCE_COLOR", "PLAYWRIGHT_BROWSERS_PATH",
  "CURLING_E2E_ISOLATED", "CURLING_E2E_OWNER", "CURLING_E2E_DB_CONTAINER", "CURLING_E2E_DB_ID", "CURLING_E2E_APP_ORIGIN", "CURLING_E2E_MAIL_ORIGIN", "CURLING_E2E_BROWSER", "CURLING_E2E_TEMP_ROOT",
  "NEXT_PUBLIC_SUPABASE_URL", "NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY", "NEXT_PUBLIC_POSTHOG_ENABLED", "NEXT_PUBLIC_POSTHOG_TOKEN", "NEXT_PUBLIC_POSTHOG_HOST", "NEXT_PUBLIC_POSTHOG_CH_BETA", "NEXT_TELEMETRY_DISABLED",
  "APP_ORIGIN", "SMTP_HOST", "SMTP_PORT", "SMTP_SECURE", "SMTP_USER", "SMTP_PASS", "SMTP_FROM_ADDRESS"];
const child = Object.fromEntries(names.flatMap(name => typeof process.env[name] === "string" ? [[name, process.env[name]]] : []));
const result = spawnSync(join(root, "node_modules/.bin/playwright"), ["test", ...process.argv.slice(2)], { cwd: root, env: child, stdio: "inherit" });
process.exit(result.status ?? 1);
