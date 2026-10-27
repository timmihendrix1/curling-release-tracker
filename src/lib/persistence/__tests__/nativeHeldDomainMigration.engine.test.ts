// Actual disposable SQLite syntax/transactions for the S3d borrowed preparation.
import { afterEach, expect, it, vi } from "vitest";
import { realHeldSqlite, disposeHeldSqliteFixtures } from "./nativeHeldSqliteTestEngine";
import { createNativeHeldDomainMigrationRunner } from "../nativeMigrationRunner";
import { createNativeMigrationSource } from "../nativeMigrationBindings";
import { SyntheticStorage, RECORD_KEY, MARKER_KEY, LIMITS, syntheticUuid, SYNTHETIC_NOW } from "./nativeMigrationMTestKit";
import { BASE_SOURCE, STORE_A, fp, isSyntheticFingerprint, verifiedBytes } from "./nativeMigrationTestKit";
import { evaluateActivationRecord } from "../nativeMigrationRecord";
afterEach(async () => { vi.unstubAllGlobals(); await disposeHeldSqliteFixtures(); });
async function prepare(initial: Record<string, string>, statements: string[] = []) {
  const storage = new SyntheticStorage(initial); vi.stubGlobal("localStorage", storage);
  const h = await realHeldSqlite(statements), acquired = await h.target.acquire(); if (!acquired.ok) throw new Error("fixture");
  const created = createNativeHeldDomainMigrationRunner({ target: h.target, lease: acquired.lease, source: createNativeMigrationSource(),
    fingerprint: fp, isWellFormedFingerprint: isSyntheticFingerprint, generateUuid: syntheticUuid, now: () => SYNTHETIC_NOW, limits: LIMITS });
  if (!created.ok) throw new Error(created.reason);
  return { ...h, runner: created.runner, lease: acquired.lease, storage };
}
it("real SQLite bootstraps records and holds D1 without an activation write", async () => {
  const h = await prepare({}); const report = await h.runner.run(); expect(report.outcome).toBe("held");
  expect(h.trace.some(x => ["begin", "commit", "run"].includes(x.kind))).toBe(false);
  expect(await h.runner.dispose()).toEqual({ ok: true }); expect(await h.target.release(h.lease)).toEqual({ ok: true });
});
it("real SQLite copies all rows and commits verified D, never active D", async () => {
  const h = await prepare({ ...BASE_SOURCE }); const report = await h.runner.run(); expect(report.outcome).toBe("held");
  const observed = await h.target.readReserved(h.lease); if (!observed.ok || observed.record.status !== "present") throw new Error("fixture");
  const record = evaluateActivationRecord(observed.record.bytes, isSyntheticFingerprint);
  expect(record.ok && record.record.phase).toBe("verified");
  expect(await h.runner.dispose()).toEqual({ ok: false, reason: "plan_evidence_held" });
  expect(await h.target.release(h.lease)).toEqual({ ok: false, reason: "borrowed_evidence_held" });
});
it("real SQLite reopens a verified fixture; all target values are rechecked before a hold", async () => {
  const create = "CREATE TABLE records (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);";
  const literal = (x: string) => "'" + x.replaceAll("'", "''") + "'";
  const rows = { ...BASE_SOURCE, [RECORD_KEY]: verifiedBytes() };
  const h = await prepare({ ...BASE_SOURCE, [MARKER_KEY]: STORE_A }, [create, ...Object.entries(rows).map(([key, raw]) => `INSERT INTO records VALUES (${literal(key)}, ${literal(raw)});`)]);
  expect((await h.runner.run()).outcome).toBe("held"); expect(await h.target.reopen(h.lease)).toMatchObject({ ok: true });
  const next = await h.runner.run(); expect(next.outcome).toBe("held");
  expect(h.trace.some(x => x.kind === "begin")).toBe(false); await h.runner.dispose(); await h.target.release(h.lease);
});
it("real SQLite combined schema cannot be used as a legacy borrowed target", async () => {
  const h = await prepare({}, ["CREATE TABLE records (key TEXT PRIMARY KEY NOT NULL, value TEXT NOT NULL);", "CREATE TABLE curling_credential_meta (slot TEXT PRIMARY KEY NOT NULL CHECK(slot IN ('schema','q','f')), value TEXT NOT NULL);"]);
  expect((await h.runner.run()).outcome).toBe("target_refused");
  expect(h.trace.some(x => x.kind === "begin" || x.kind === "run")).toBe(false);
  await h.runner.dispose(); await h.target.release(h.lease);
});
