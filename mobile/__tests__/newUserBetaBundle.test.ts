// @vitest-environment node
import { createServer, type Server } from "node:http";
import { mkdtemp, readFile, readdir, rm } from "node:fs/promises";
import path from "node:path";
import { tmpdir } from "node:os";
import { build } from "vite";
import { chromium, type Browser } from "@playwright/test";
import { afterAll, beforeAll, expect, it } from "vitest";
import { isNewUserBetaRequested } from "../newUserBetaFlag";
let directory: string, server: Server, browser: Browser, origin: string;
const flags = ["CURLING_MOBILE_NEW_USER_BETA", "CURLING_MOBILE_NATIVE_STORAGE", "CURLING_MOBILE_STORAGE_DIAGNOSTICS"];
async function betaBuild(conflict?: string) {
  const ambient = process.env as Record<string, string | undefined>;
  const prior = new Map([...flags, "NODE_ENV"].map(key => [key, ambient[key]]));
  try {
    flags.forEach(key => { ambient[key] = key === flags[0] || key === conflict ? "1" : "0"; });
    await build({ configFile: path.join(process.cwd(), "mobile/vite.config.ts"), logLevel: "silent",
      define: { "process.env.NEXT_PUBLIC_SUPABASE_URL": '""', "process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY": '""', "process.env.NEXT_PUBLIC_NATIVE_API_ORIGIN": '""' },
      build: { outDir: directory, emptyOutDir: true } });
  } finally { for (const [key, value] of prior) { if (value === undefined) delete ambient[key]; else ambient[key] = value; } }
}
beforeAll(async () => {
  directory = await mkdtemp(path.join(tmpdir(), "curling-new-user-bundle-"));
  await betaBuild();
  server = createServer(async (request, response) => {
    try {
      const name = new URL(request.url!, "http://synthetic.invalid").pathname;
      const file = name === "/" ? "index.html" : name.slice(1);
      response.setHeader("Content-Type", file.endsWith(".js") ? "text/javascript" : file.endsWith(".css") ? "text/css" : "text/html");
      response.end(await readFile(path.join(directory, file)));
    } catch { response.statusCode = 404; response.end(); }
  });
  await new Promise<void>(resolve => server.listen(0, "127.0.0.1", resolve));
  const address = server.address(); if (!address || typeof address === "string") throw Error("Synthetic server unavailable");
  origin = `http://127.0.0.1:${address.port}`;
  browser = await chromium.launch({ headless: true });
}, 30000);
afterAll(async () => { await browser?.close(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); if (directory) await rm(directory, { recursive: true, force: true }); });
it("enables only the exact build selection and rejects ambiguous artifacts", async () => {
  for (const raw of [undefined, "", "true", "0", " 1", "1 "]) expect(isNewUserBetaRequested(raw)).toBe(false);
  expect(isNewUserBetaRequested("1")).toBe(true);
  for (const conflict of flags.slice(1)) await expect(betaBuild(conflict)).rejects.toThrow("New-user beta cannot be combined");
});
it("actual beta artifact includes new-user admission and excludes import/diagnostic execution", async () => {
  const assets = path.join(directory, "assets"), names = await readdir(assets);
  const js = (await Promise.all(names.filter(name => name.endsWith(".js")).map(name => readFile(path.join(assets, name), "utf8")))).join("\n");
  expect(js).toContain("auth-js/2.112.3:credential-v1:empty-source-v1"); expect(js).toContain("curling-sporting-v1");
  expect(js).not.toContain("curling-protected-installation-v1"); expect(js).not.toContain("curling-storage-diagnostics");
  expect(js).not.toContain("process.env.");
});
for (const failure of ["web", "ios_missing_config", "sdk_probe_set", "sdk_probe_remove", "sdk_probe_get"] as const) it(`real built root fails closed for ${failure} with independently observed I/O`, async () => {
  const page = await browser.newPage(), external: string[] = [], errors: string[] = [];
  page.on("request", request => { if (!request.url().startsWith(origin)) external.push("unexpected"); });
  page.on("pageerror", () => { errors.push("unexpected"); });
  await page.addInitScript(({ mode }) => {
    type WindowState = Window & { CapacitorCustomPlatform?: { name: string }; betaIo: { kind: string; key: string }[] };
    const state = window as unknown as WindowState; state.betaIo = [];
    if (mode !== "web") state.CapacitorCustomPlatform = { name: "ios" };
    const get = Storage.prototype.getItem, set = Storage.prototype.setItem, remove = Storage.prototype.removeItem;
    Storage.prototype.setItem = function (key, value) { state.betaIo.push({ kind: "write", key }); if (mode === "sdk_probe_set") throw Error("Synthetic unavailable"); return set.call(this, key, value); };
    Storage.prototype.removeItem = function (key) { state.betaIo.push({ kind: "remove", key }); if (mode === "sdk_probe_remove") throw Error("Synthetic unavailable"); return remove.call(this, key); };
    Storage.prototype.getItem = function (key) { state.betaIo.push({ kind: "read", key }); if (mode === "sdk_probe_get") throw Error("Synthetic unavailable"); return get.call(this, key); };
  }, { mode: failure });
  try {
    await page.goto(origin);
    await page.getByText(failure === "sdk_probe_get" ? "Athlete access could not be loaded. Close and reopen the app. Existing data has been preserved." : failure === "web" ? "This beta build requires the iOS app." : "Athlete sign-in is unavailable in this build. The training application remains locked.").waitFor();
    expect(await page.getByRole("navigation").count()).toBe(0); expect(external).toEqual([]); expect(errors).toEqual([]);
    const events = await page.evaluate(() => (window as unknown as { betaIo: { kind: string; key: string }[] }).betaIo);
    expect(events.length).toBeGreaterThan(0);
    expect(events.every(event => event.key.startsWith("lswt-") || event.kind === "read" && event.key === "supabase.gotrue-js.locks.debug")).toBe(true);
    if (failure === "web" || failure === "ios_missing_config") expect(events.map(event => event.kind)).toEqual(["write", "remove", "read"]);
  } finally { await page.close(); }
});
