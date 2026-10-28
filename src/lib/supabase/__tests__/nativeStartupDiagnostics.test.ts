// Actual host/installed SDK/disposable SQLite; injected bridge faults are NOT device evidence.
import { expect, it, vi } from "vitest";
import { mobileFixture, finishApplication } from "./nativeNewUserMobileFixture";
import { deferred, releases } from "./nativeTrackerFixture";
const privateMarker = "SYNTHETIC_PRIVATE_VALUE_NEVER_PRESENTATION";
async function blocked(app: Awaited<ReturnType<typeof mobileFixture>>["app"]) {
  await Promise.resolve();
  await vi.waitFor(() => expect(app.getSnapshot().phase).toBe("blocked"));
  const value = app.getSnapshot();
  expect(value.runtime).toBeNull(); expect(value.notice).not.toContain(privateMarker);
  expect(value.supportCode).not.toContain(privateMarker);
  expect(value.supportCode).toMatch(/^NU1\/[a-z_]+\/[a-z_]+\/[a-z_]+(?:\/[a-z_]+)?$/);
  return value;
}
for (const edge of ["sql", "protected", "source", "manifest"] as const) it(`fixed diagnostics distinguish actual ${edge} refusal without exposing thrown/stored bytes`, async () => {
  const { h, app } = await mobileFixture();
  const forbidden = { toString() { throw Error(privateMarker); }, message: privateMarker };
  if (edge === "sql") h.sqlFaults.hook = async (event, next) => { if (event.kind === "open") throw forbidden; return next(); };
  if (edge === "protected") h.faults.hook = async () => { throw forbidden; };
  if (edge === "source") h.source.map.set("unknown.synthetic", privateMarker);
  if (edge === "manifest") h.faults.hook = async (event, next) => { if (event.kind === "write") throw forbidden; return next(); };
  app.start();
  try {
    const snapshot = await blocked(app);
    const stage = edge === "sql" ? "sql_observe" : edge === "protected" ? "protected_inventory_configure" : edge === "source" ? "source_capture" : "manifest_write";
    expect(snapshot.supportCode).toContain(`/${stage}/`);
    expect(h.fetch).not.toHaveBeenCalled();
    expect(h.source.writes).toEqual([]);
  } finally { await finishApplication(app); }
});
for (const diagnostic of ["os_missing_entitlement", "sync_shape", "transport_rejected", "transport_shape", "call"] as const) {
  it(`retains protected recovery while distinguishing ${diagnostic} through the actual owner`, async () => {
    const { h, app } = await mobileFixture();
    // fixture() resets modules: use the transport from the actual owner's graph.
    const { inventoryIosCredentialNamespace } = await import("../../persistence/iosKeychainReadEvidence");
    h.faults.hook = async (event, next) => {
      if (event.kind !== "inventory") return next();
      if (diagnostic === "call") throw new Error(privateMarker);
      return inventoryIosCredentialNamespace(async () => {
        if (diagnostic === "transport_rejected") throw new Error(privateMarker);
        if (diagnostic === "transport_shape") return { kind: "complete", keys: null, diagnostic: privateMarker };
        return { kind: diagnostic === "sync_shape" ? "unreadable" : "inaccessible", diagnostic };
      });
    };
    app.start();
    try {
      const snapshot = await blocked(app);
      expect(snapshot.supportCode).toBe(`NU1/recovery_required/protected_inventory_${diagnostic}/recovery_required/protected`);
      expect(h.fetch).not.toHaveBeenCalled(); expect(h.source.writes).toEqual([]); expect(h.values.size).toBe(0);
    } finally { await finishApplication(app); }
  });
}
it("retry clears the previous code before held work, then genuine readiness has no diagnostic", async () => {
  const { h, app } = await mobileFixture(); let failed = false;
  h.sqlFaults.hook = async (event, next) => { if (!failed && event.kind === "open") { failed = true; throw Error(privateMarker); } return next(); };
  app.start(); await blocked(app);
  const entered = deferred<void>(), release = deferred<void>(); releases.push(() => release.resolve());
  h.sqlFaults.hook = async (event, next) => { if (event.kind === "open") { entered.resolve(); await release.promise; } return next(); };
  app.start(); await entered.promise;
  expect(app.getSnapshot()).toMatchObject({ phase: "preparing", supportCode: null });
  release.resolve();
  try { await vi.waitFor(() => expect(app.getSnapshot().phase).toBe("ready")); expect(app.getSnapshot().supportCode).toBeNull(); }
  finally { await finishApplication(app); }
});
it("Close clears the presentation code without treating it as cleanup authority", async () => {
  const { h, app } = await mobileFixture(); h.source.map.set("unknown.synthetic", privateMarker);
  app.start(); await blocked(app);
  app.close(); expect(app.getSnapshot().supportCode).toBeNull();
  await finishApplication(app); expect(app.getSnapshot().runtime).toBeNull();
  expect(h.source.map.get("unknown.synthetic")).toBe(privateMarker);
});
