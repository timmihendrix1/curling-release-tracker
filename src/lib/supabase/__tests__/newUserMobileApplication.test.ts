import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { createNewSession } from "../../sessionMigration";
import { facts, profileId } from "./nativeTrackerFixture";
import { afterEach, expect, it, vi } from "vitest";
import { onboard, deferred, releases } from "./nativeTrackerFixture";
import type { createNewUserMobileApplication } from "../newUserMobileApplication";
import { finishApplication, mobileFixture as makeFixture } from "./nativeNewUserMobileFixture";
async function mobileFixture() { const result = await makeFixture(); apps.push(result.app); return result; }
type App = ReturnType<typeof createNewUserMobileApplication>;
const apps: App[] = [];
afterEach(async () => { for (const app of apps.splice(0)) await finishApplication(app); });
async function settled(app: App) { await Promise.resolve(); await vi.waitFor(() => expect(["ready", "blocked", "closed"]).toContain(app.getSnapshot().phase)); return app.getSnapshot(); }
it("constructs inertly and retains one real SDK/store through duplicate starts and replay", async () => {
  const { h, app, engine, protectedFactory } = await mobileFixture(), trace = h.trace.length;
  expect(h.trace).toHaveLength(trace); expect(engine).not.toHaveBeenCalled(); expect(protectedFactory).not.toHaveBeenCalled(); expect(h.fetch).not.toHaveBeenCalled();
  const release = app.retain(); release(); const releaseAgain = app.retain(); app.start(); app.start();
  expect((await settled(app)).phase).toBe("ready"); expect(engine).toHaveBeenCalledTimes(1); expect(protectedFactory).toHaveBeenCalledTimes(1);
  const runtime = app.getSnapshot().runtime!; await onboard(h, runtime);
  expect(runtime.createLocalSportingScope("99999999-9999-4999-8999-999999999999")).toBeNull();
  releaseAgain(); await vi.waitFor(() => expect(app.getSnapshot().phase).toBe("closed"));
  expect(app.getSnapshot().runtime).toBeNull(); expect(await finishApplication(app)).toEqual({ ok: true });
  app.retain(); app.start(); await Promise.resolve(); expect(app.getSnapshot().phase).toBe("closed"); expect(engine).toHaveBeenCalledTimes(1);
});
for (const key of ["curling-release-tracker-session-history", "curling.identity.barrier.v1", "unknown.namespace", "sb-other-auth-token", "lswt-synthetic-leftover", "supabase.gotrue-js.locks.debug"]) it(`actual root owner refuses ${key} unchanged`, async () => {
  const { h, app } = await mobileFixture(); h.source.map.set(key, "SYNTHETIC_SOURCE"); app.start();
  expect((await settled(app)).phase).toBe("blocked"); expect(app.getSnapshot().runtime).toBeNull();
  expect(h.source.map.get(key)).toBe("SYNTHETIC_SOURCE"); expect(h.source.writes).toEqual([]); expect(h.source.valueReads).not.toContain(key); expect(h.fetch).not.toHaveBeenCalled();
  expect(app.close()).toBeUndefined(); expect(app.close()).toBeUndefined(); expect(await finishApplication(app)).toEqual({ ok: true });
});
for (const invalid of ["web", "android", "unsupported_native", "cloud_missing", "cloud_invalid", "cloud_http", "api_missing", "api_invalid"] as const) it(`blocks ${invalid} before native or network I/O`, async () => {
  const { h, app, engine, protectedFactory } = await mobileFixture();
  if (["web", "android", "unsupported_native"].includes(invalid)) vi.mocked((await import("../../platform/runtimePlatform")).detectRuntimePlatform).mockReturnValue(invalid as "web");
  else if (invalid.startsWith("cloud")) vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", invalid === "cloud_http" ? "http://synthetic-provider.example.invalid" : invalid.endsWith("missing") ? "" : "invalid");
  else vi.stubEnv("NEXT_PUBLIC_NATIVE_API_ORIGIN", invalid.endsWith("missing") ? "" : "http://synthetic.invalid");
  const trace = h.trace.length; app.start(); expect((await settled(app)).phase).toBe("blocked");
  expect(engine).not.toHaveBeenCalled(); expect(protectedFactory).not.toHaveBeenCalled(); expect(h.trace).toHaveLength(trace); expect(h.events).toHaveLength(0); expect(h.fetch).not.toHaveBeenCalled();
});
it("close during real held SHA preparation stays pending until work drains and never creates a host", async () => {
  const { h, app, engine } = await mobileFixture(), entered = deferred<void>(), release = deferred<void>(); releases.push(() => release.resolve());
  const original = crypto.subtle.digest.bind(crypto.subtle);
  vi.spyOn(crypto.subtle, "digest").mockImplementation(async (...args) => { entered.resolve(); await release.promise; return original(...args); });
  app.start(); await entered.promise; expect(app.close()).toBeUndefined(); expect(app.getSnapshot()).toMatchObject({ phase: "closing", cleanupPending: true, runtime: null });
  app.start(); release.resolve(); expect((await settled(app)).phase).toBe("closed"); expect(engine).not.toHaveBeenCalled(); expect(h.fetch).not.toHaveBeenCalled();
});
it("same host retries uncertain real COMMIT and closes held native work without late readiness", async () => {
  const { h, app, engine } = await mobileFixture(); let failed = false;
  h.sqlFaults.hook = async (event, next) => { const value = await next(); if (!failed && event.kind === "commit") { failed = true; throw Error("Synthetic lost acknowledgement"); } return value; };
  app.start(); expect((await settled(app)).phase).toBe("blocked"); expect(app.getSnapshot().retry).toBe(true);
  app.start(); expect((await settled(app)).phase).toBe("ready"); expect(engine).toHaveBeenCalledTimes(1);
  expect(await finishApplication(app)).toEqual({ ok: true });
});
it("close joins actual held COMMIT and preserves its late durable fact", async () => {
  const { h, app } = await mobileFixture(), entered = deferred<void>(), release = deferred<void>(); releases.push(() => release.resolve()); let held = false;
  h.sqlFaults.hook = async (event, next) => { const value = await next(); if (!held && event.kind === "commit") { held = true; entered.resolve(); await release.promise; } return value; };
  app.start(); await entered.promise; expect(app.close()).toBeUndefined(); expect(app.close()).toBeUndefined();
  await Promise.resolve(); expect(app.getSnapshot()).toMatchObject({ phase: "closing", cleanup: null, runtime: null });
  release.resolve(); expect(await finishApplication(app)).toEqual({ ok: false, reason: "evidence_held" }); expect(app.getSnapshot()).toMatchObject({ phase: "blocked", cleanupPending: true, retry: false }); expect(h.trace.filter(event => event.kind === "rollback")).toHaveLength(0); expect(h.fetch).not.toHaveBeenCalled();
});

it("actual beta owner cold-opens in a genuine new process with no legacy fallback", async () => {
  const { h, app } = await mobileFixture(); app.start(); expect((await settled(app)).phase).toBe("ready");
  const runtime = app.getSnapshot().runtime!; await onboard(h, runtime);
  const session = createNewSession(); session.title = "Synthetic mobile root training";
  expect(await runtime.createLocalSportingScope(profileId)!.repositories.session.saveCurrent(session)).toEqual({ ok: true });
  expect(await finishApplication(app)).toEqual({ ok: true });
  const stateFile = path.join(h.options.migration.sqlite.databaseName, "mobile-child.json");
  const data = { syntheticOnly: true, parentPid: process.pid, file: path.join(h.options.migration.sqlite.databaseName, "synthetic.sqlite"),
    config: h.options.config, protectedValues: [...h.values], facts: facts(true), expectSession: session.id };
  await writeFile(stateFile, JSON.stringify(data));
  await promisify(execFile)(process.execPath, [path.join(process.cwd(), "tests/native/newUserMobileChild.mjs"), stateFile], { timeout: 45000 });
  const result = JSON.parse(await readFile(stateFile, "utf8"));
  expect(result.result).toMatchObject({ legacyAccess: 0, readSession: session.id, startup: "ready_online", cleanup: { ok: true } });
  expect(result.result.pid).not.toBe(process.pid);
}, 45000);

it("pre-host Close retains late genuine constructor delivery and disposes it without starting stores", async () => {
  const { h, app, engine } = await mobileFixture(), entered = deferred<void>(), release = deferred<void>(); releases.push(() => release.resolve());
  const actual = h.module.createConfiguredNewUserNativeSportingIdentityHost;
  vi.spyOn(h.module, "createConfiguredNewUserNativeSportingIdentityHost").mockImplementation(async (...args) => {
    const made = await actual(...args); expect(made.ok).toBe(true);
    entered.resolve(); await release.promise; return made;
  });
  app.start(); await entered.promise; expect(app.close()).toBeUndefined();
  expect(app.getSnapshot()).toMatchObject({ phase: "closing", cleanupPending: true });
  release.resolve(); await vi.waitFor(() => expect(app.getSnapshot().phase).toBe("closed"));
  expect(engine).not.toHaveBeenCalled(); expect(h.fetch).not.toHaveBeenCalled();
});

it("a direct native callback returning app.close cannot form a disposal self-cycle", async () => {
  const { h, app } = await mobileFixture(); let returned: unknown = "not called";
  h.binding.configure = (() => { returned = app.close(); return returned; }) as typeof h.binding.configure;
  app.start();
  await vi.waitFor(() => expect(app.getSnapshot().phase).toBe("closed"));
  expect(returned).toBeUndefined(); expect(app.getSnapshot().cleanup).toEqual({ ok: true });
  expect(app.close()).toBeUndefined(); expect(h.fetch).not.toHaveBeenCalled(); expect(app.getSnapshot().runtime).toBeNull();
});
it("pre-host digest returning app.close exposes no owned work and never starts stores", async () => {
  const { h, app, engine } = await mobileFixture(); let returned: unknown = "not called";
  vi.spyOn(crypto.subtle, "digest").mockImplementation((() => { returned = app.close(); return returned; }) as typeof crypto.subtle.digest);
  app.start(); await vi.waitFor(() => expect(app.getSnapshot().phase).toBe("closed"));
  expect(returned).toBeUndefined(); expect(engine).not.toHaveBeenCalled(); expect(h.fetch).not.toHaveBeenCalled();
});
