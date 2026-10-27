// Real installed SDK, actual common owner/coordinator, disposable SQLite.
// Only protected storage/platform/API edges are synthetic; never real Keychain.
import { expect, it, vi } from "vitest";
import { fixture, bootstrap, onboard, server, profileId } from "./nativeTrackerFixture";
import { SESSION_HISTORY_STORAGE_KEY } from "../../sessionRepository";
type Fixture = Awaited<ReturnType<typeof fixture>>;
async function prepare(h: Fixture, config = h.options.config) {
  const configurationModule = await import("../nativeProviderConfiguration");
  const prepared = await configurationModule.prepareNativeProviderConfiguration(config); expect(prepared.ok).toBe(true);
  if (!prepared.ok) throw new Error("Synthetic configuration unavailable");
  return { binding: prepared.value, captured: configurationModule.resolveNativeProviderConfiguration(prepared.value)! };
}
async function rows(h: Fixture) {
  await h.raw({ kind: "open" });
  try { return await h.raw({ kind: "query", sql: "SELECT key,value FROM records ORDER BY key" }); }
  finally { await h.raw({ kind: "close" }); }
}
it("performs no I/O until explicit start and refuses copies before options getters", async () => {
  const h = await fixture(), events = h.events.length, trace = h.trace.length, prepared = await prepare(h);
  expect(h.events).toHaveLength(events); expect(h.trace).toHaveLength(trace); expect(h.fetch).not.toHaveBeenCalled();
  const trap = vi.fn(() => { throw new Error("SYNTHETIC_PRIVATE_OPTIONS"); });
  const options = new Proxy({}, { get: trap }) as Parameters<typeof h.module.createConfiguredNativeSportingIdentityHost>[1];
  for (const candidate of [{}, { ...prepared.binding }, Object.create(prepared.binding), new Proxy(prepared.binding, { get: trap, getPrototypeOf: trap })]) {
    expect(await h.module.createConfiguredNativeSportingIdentityHost(candidate, options)).toEqual({ ok: false, reason: "invalid_configuration" });
  }
  expect(trap).not.toHaveBeenCalled();
  const b = await bootstrap(h, {}, prepared.binding);
  expect(h.events).toHaveLength(events); expect(h.trace).toHaveLength(trace); expect(h.fetch).not.toHaveBeenCalled();
  const conflict = await h.module.createConfiguredNativeSportingIdentityHost(prepared.binding, options);
  expect(conflict).toEqual({ ok: false, reason: "ownership_conflict" }); expect(trap).not.toHaveBeenCalled();
  await b.host.dispose();
});
it("uses genuine captured config/root/standard hashes through actual OTP, admission and sporting data", async () => {
  const h = await fixture(), prepared = await prepare(h), ignored = vi.fn(() => { throw null; });
  const migration = { ...h.options.migration };
  for (const key of ["providerConfigIdentity", "sessionStorageKey", "domainFingerprint", "domainFingerprintFormat", "credentialFingerprint", "credentialFingerprintFormat"]) Object.defineProperty(migration, key, { get: ignored });
  // bootstrap's ordinary options spread would invoke config. Pass the actual
  // new entry directly so the real host itself proves ignored duplicate fields.
  const options = { migration, fetch: h.fetch, callbackUrlAccess: { readCurrentUrl: () => "https://app.example.invalid/", replaceCurrentUrl: () => {} } };
  Object.defineProperty(options, "config", { get: ignored });
  const made = await h.module.createConfiguredNativeSportingIdentityHost(prepared.binding, options);
  expect(made.ok).toBe(true); if (!made.ok) throw null;
  try {
    const started = await made.host.start(); expect(started.outcome).toBe("ready"); if (started.outcome !== "ready") throw null;
    await onboard(h, started.runtime); expect(ignored).not.toHaveBeenCalled();
    const scope = started.runtime.createLocalSportingScope(profileId); expect(scope).not.toBe(null);
    expect([...h.values.keys()].some(key => key.includes(prepared.captured.providerConfigIdentity))).toBe(true);
    expect([...h.values.keys()].some(key => key.includes(h.options.migration.providerConfigIdentity))).toBe(false);
  } finally { await made.host.dispose(); }
});
it("reopens the exact configuration in a fresh module/host lifetime with real identity checks", async () => {
  const h = await fixture(), p = await prepare(h), first = await bootstrap(h, {}, p.binding), runtime = await first.start();
  await onboard(h, runtime); await first.host.dispose(); const oldRows = await rows(h), oldItems = [...h.values];
  vi.resetModules(); h.module = await import("../supabaseAuthService");
  const fresh = await prepare(h); expect(fresh.captured.providerConfigIdentity).toBe(p.captured.providerConfigIdentity);
  const next = await bootstrap(h, {}, fresh.binding); server(h, true); const ready = await next.start();
  expect((await ready.startUpOnce()).verdict.kind).toBe("ready_online");
  expect(ready.createLocalSportingScope(profileId)).not.toBe(null);
  await next.host.dispose(); expect(await rows(h)).toEqual(oldRows); expect([...h.values]).toEqual(oldItems);
});
it.each(["key", "same_label_project", "root", "slash"] as const)("refuses changed %s against actual persisted Q/M/I, preserving raw data", async change => {
  const h = await fixture(); const training = '[{"synthetic":"preserve exactly"}]'; h.source.map.set(SESSION_HISTORY_STORAGE_KEY, training);
  const prepared = await prepare(h), first = await bootstrap(h, {}, prepared.binding), runtime = await first.start();
  await onboard(h, runtime); await first.host.dispose();
  const beforeItems = [...h.values], beforeSource = [...h.source.map], beforeRows = await rows(h);
  const changed = { ...h.options.config,
    ...(change === "key" ? { publishableKey: h.options.config.publishableKey + "ROTATED" } :
      change === "same_label_project" ? { url: h.options.config.url.replace(".supabase.invalid", ".other.invalid") } :
      change === "root" ? { url: "https://different-project.supabase.invalid" } : { url: h.options.config.url + "/" }),
  };
  const replacement = await prepare(h, changed); expect(replacement.captured.providerConfigIdentity).not.toBe(prepared.captured.providerConfigIdentity);
  h.fetch.mockClear(); const next = await bootstrap(h, {}, replacement.binding);
  expect((await next.host.start()).outcome).toBe("waiting"); expect(h.fetch).not.toHaveBeenCalled();
  expect([...h.values]).toEqual(beforeItems); expect([...h.source.map]).toEqual(beforeSource);
  await next.host.dispose(); expect(await rows(h)).toEqual(beforeRows);
  // Existing fault-F metadata may be written; the application rows/items above
  // cannot be reset, overwritten or rebound. No recovery/automatic return claim.
});
it("does not couple missing own API origin to ordinary provider identity", async () => {
  const h = await fixture(); vi.stubEnv("NEXT_PUBLIC_NATIVE_API_ORIGIN", "");
  const p = await prepare(h), b = await bootstrap(h, {}, p.binding), runtime = await b.start(); await onboard(h, runtime);
  const team = runtime.createTeamService(profileId); expect(team).not.toBe(null); h.fetch.mockClear();
  // Ordinary provider admission remains genuine; the own-API origin is captured
  // independently by ADR0047 and is not part of the provider configuration hash.
  expect(runtime.createLocalSportingScope(profileId)).not.toBe(null);
  expect(await team!.resendInvitation("77777777-7777-4777-8777-777777777777")).toMatchObject({ ok: false });
  const again = await prepare(h); expect(again.captured.providerConfigIdentity).toBe(p.captured.providerConfigIdentity);
  expect(h.fetch).not.toHaveBeenCalled();
});
