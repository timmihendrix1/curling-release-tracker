import { execFileSync } from "node:child_process";
import { realpathSync } from "node:fs";

/** These selectors identify a disposable test stack; none has a default. */
export function isolatedEnvironment() {
  const owner = process.env.CURLING_E2E_OWNER;
  const database = process.env.CURLING_E2E_DB_CONTAINER;
  const databaseId = process.env.CURLING_E2E_DB_ID;
  const root = process.env.CURLING_E2E_TEMP_ROOT;
  if (process.env.CURLING_E2E_ISOLATED !== "1" || !owner || !/^curling-review-test-[a-f0-9]{12}$/.test(owner)
      || !databaseId || !/^[a-f0-9]{64}$/.test(databaseId) || database !== `${owner}-db` || !root || !realpathSync(root).startsWith("/private/tmp/curling-e2e-infra-")
      || realpathSync(process.cwd()) !== realpathSync(root)) throw new Error("Owned isolated E2E environment required.");
  function loopback(name: string) {
    const value = process.env[name];
    if (!value || !/^http:\/\/127\.0\.0\.1:[1-9][0-9]*$/.test(value)) throw new Error("Explicit isolated loopback endpoint required.");
    const url = new URL(value);
    if (!url.port || Number(url.port) > 65535) throw new Error("Invalid isolated loopback port.");
    return value;
  }
  const appOrigin = loopback("CURLING_E2E_APP_ORIGIN");
  const mailOrigin = loopback("CURLING_E2E_MAIL_ORIGIN");
  const apiOrigin = loopback("NEXT_PUBLIC_SUPABASE_URL");
  if (process.env.APP_ORIGIN !== appOrigin || new Set([appOrigin, mailOrigin, apiOrigin]).size !== 3) throw new Error("Inconsistent isolated endpoints.");
  return { owner, database, databaseId, appOrigin, mailOrigin, apiOrigin };
}

/** Resolve immutable ID only after checking the random label, before every SQL call. */
export function ownedDatabaseSql(query: string) {
  const { owner, database, databaseId } = isolatedEnvironment();
  const raw = execFileSync("docker", ["inspect", "--format", '{{.Id}}|{{index .Config.Labels "curling.review-test"}}', database], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
  const [id, actualOwner] = raw.split("|");
  if (!/^[a-f0-9]{64}$/.test(id) || actualOwner !== owner || id !== databaseId) throw new Error("Database ownership check refused the operation.");
  return execFileSync("docker", ["exec", "-i", id, "psql", "-U", "supabase_admin", "-d", "postgres", "-v", "ON_ERROR_STOP=1", "-q"], { input: query, stdio: ["pipe", "pipe", "pipe"] });
}
