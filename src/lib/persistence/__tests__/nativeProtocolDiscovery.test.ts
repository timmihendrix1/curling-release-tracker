// S3a model evidence; actual SQLite query shapes have separate engine tests.
import { afterEach, describe, expect, it, vi } from "vitest";
import { createNativeMigrationSqliteStore, createNativeSqliteStore } from "../nativeSqliteAdapter";
import { NATIVE_MIGRATION_ACTIVATION_RECORD_KEY, NATIVE_MIGRATION_FAULT_LATCH_KEY } from "../nativeMigrationEligibility";
import { createPluginFaithfulEngine, createPluginFaithfulEngineState, type PluginFaithfulFaults, type PluginPlatform } from "./pluginFaithfulSqliteEngine";
import { boot, committedRecord, device, reachCopying } from "./nativeMigrationMTestKit";
import { BASE_SOURCE, fp } from "./nativeMigrationTestKit";

afterEach(() => vi.unstubAllGlobals());

const KEYS = { record: NATIVE_MIGRATION_ACTIVATION_RECORD_KEY, latch: NATIVE_MIGRATION_FAULT_LATCH_KEY };
const SCHEMA = "SELECT type,name,tbl_name,sql FROM sqlite_master ORDER BY type,name;";
const LIST = "SELECT key FROM records ORDER BY key;";
let ordinal = 0;
function setup(platform: PluginPlatform = "ios", faults: PluginFaithfulFaults = {}) {
  const databaseName = `protocol-discovery-${++ordinal}`;
  const state = createPluginFaithfulEngineState();
  const plugin = createPluginFaithfulEngine({ platform, state, faults });
  const options = { databaseName, engine: plugin.engine, detectPlatform: () => platform };
  const { store, target } = createNativeMigrationSqliteStore({ ...options, reservedKeys: KEYS });
  return { state, plugin, options, store, target, faults };
}
async function lease(h: ReturnType<typeof setup>) {
  const r = await h.target.acquire();
  if (!r.ok) throw new Error("test lease unavailable");
  return r.lease;
}
const mutating = (trace: string[]) => trace.filter(x => x.startsWith("run:") || x.startsWith("execute:") || x === "begin" || x === "commit");

describe.each(["ios", "android"] as const)("%s shared discovery", platform => {
  for (const table of ["curling_credential_meta", "installation_transfer_j_v1", "installation_transfer_rows_v1", "installation_transfer_archive_v1", "installation_transfer_selection_v1", "installation_transfer_fault_v1", "sqlite_sequence", "unknown"] ) {
    it(`refuses ${table} before bootstrap, pragmas or payload reads through every factory`, async () => {
      for (const kind of ["ordinary", "diagnostic", "migration"] as const) {
        const h = setup(platform);
        h.state.tables.add(table);
        const ordinary = createNativeSqliteStore(h.options);
        if (kind === "ordinary") expect((await ordinary.adapter.set("default", "empty")).ok).toBe(false);
        if (kind === "diagnostic") expect((await ordinary.beginDiagnosticTransaction()).ok).toBe(false);
        if (kind === "migration") {
          const owner = await lease(h);
          expect(await h.target.readReserved(owner)).toEqual({ ok: false, reason: "protocol_refused" });
          expect(await h.target.transact(owner, { kind: "create_record", recordAfter: "d" })).toEqual({ status: "refused", reason: "protocol_refused" });
          await h.target.release(owner);
        }
        expect(h.state.pragmas.size).toBe(0);
        expect(mutating(h.state.trace)).toEqual([]);
        expect(h.state.rows.size).toBe(0);
        expect(h.state.trace.some(x => x.includes("SELECT value"))).toBe(false);
        expect(h.state.tables).toEqual(new Set([table]));
      }
    });
  }

  it("bootstraps only after complete empty-schema discovery and verifies the actual result", async () => {
    const h = setup(platform);
    expect(h.state.trace).toEqual([]);
    expect(await h.store.adapter.set("a", "1")).toEqual({ ok: true });
    const trace = h.state.trace;
    expect(trace.indexOf(`query:${SCHEMA}`)).toBeLessThan(trace.findIndex(x => x.includes("journal_mode =")));
    expect(trace.filter(x => x === `query:${SCHEMA}`).length).toBe(2);
    expect(h.state.tables).toEqual(new Set(["records"]));
    expect(await h.store.adapter.get("a")).toEqual({ status: "value", value: "1" });
    expect(trace.filter(x => x === `query:${SCHEMA}`).length).toBe(3);
  });

  it("refuses new protocol names but never reads their values", async () => {
    for (const key of ["curling.credentials.v2.q", "curling.nativeMigration.future.v1", "curling.installationTransfer.selection.v1"]) {
      const h = setup(platform);
      h.state.tables.add("records"); h.state.rows.set(key, "PRIVATE_SENTINEL");
      const owner = await lease(h);
      const result = await h.target.readReserved(owner);
      expect(result).toEqual({ ok: false, reason: "protocol_refused" });
      expect(JSON.stringify(result)).not.toContain("PRIVATE_SENTINEL");
      expect(h.state.trace.some(x => x.includes("SELECT value"))).toBe(false);
      await h.target.release(owner);
    }
  });

  it("preserves independent unreadable D / positive latch and the reverse", async () => {
    const h = setup(platform);
    h.state.tables.add("records"); h.state.rows.set(KEYS.latch, "L");
    const owner = await lease(h);
    h.faults.onQuery = (_sql, values) => values[0] === KEYS.record ? { reject: true } : undefined;
    expect(await h.target.readReserved(owner)).toEqual({ ok: true, record: { status: "read_failed" }, latch: { status: "present", bytes: "L" } });
    h.faults.onQuery = (_sql, values) => values[0] === KEYS.latch ? { reject: true } : undefined;
    expect(await h.target.readReserved(owner)).toEqual({ ok: true, record: { status: "absent" }, latch: { status: "read_failed" } });
    await h.target.release(owner);
  });

  it("distinguishes failed full inventory from a later legacy listing failure", async () => {
    const h = setup(platform); h.state.tables.add("records");
    const owner = await lease(h);
    h.faults.onQuery = sql => sql === LIST ? { reject: true } : undefined;
    expect(await h.target.listApplicationKeys(owner)).toEqual({ status: "refused", reason: "protocol_refused" });
    h.faults.onQuery = sql => sql === LIST.slice(0, -1) ? { reject: true } : undefined;
    expect(await h.target.listApplicationKeys(owner)).toEqual({ status: "read_failed" });
    await h.target.release(owner);
  });

  it("rechecks a reused handle before every ordinary/diagnostic operation", async () => {
    const h = setup(platform);
    expect((await h.store.adapter.set("a", "old")).ok).toBe(true);
    h.state.tables.add("installation_transfer_j_v1");
    const mark = h.state.trace.length;
    expect((await h.store.adapter.get("a")).status).toBe("read_failed");
    expect((await h.store.adapter.set("a", "new")).ok).toBe(false);
    expect((await h.store.adapter.remove("a")).ok).toBe(false);
    expect((await h.store.deleteAllRecords()).ok).toBe(false);
    expect((await h.store.beginDiagnosticTransaction()).ok).toBe(false);
    expect((await h.store.readEffectiveSettings()).ok).toBe(false);
    expect(mutating(h.state.trace.slice(mark))).toEqual([]);
    expect(h.state.rows.get("a")).toBe("old");
    await h.store.close();
  });

  it("checks after a verifier await and rolls back before the first write", async () => {
    const h = setup(platform); h.state.tables.add("records"); h.state.rows.set(KEYS.record, "before");
    const owner = await lease(h);
    const result = await h.target.transact(owner, {
      kind: "replace_record", recordBefore: "before", recordAfter: "after", requireNoApplicationRows: false,
      verifyCompleteEvidence: async () => { h.state.tables.add("curling_credential_meta"); return true; },
    });
    expect(result).toEqual({ status: "not_committed", reason: "protocol_refused", writeIssued: false, connection: "clean" });
    expect(h.state.rows.get(KEYS.record)).toBe("before");
    expect(h.state.trace).not.toContain("commit");
    expect(h.state.trace.some(x => x.startsWith("run:"))).toBe(false);
    await h.target.release(owner);
  });

  it("checks after staged writes and rolls back rather than issuing COMMIT", async () => {
    const h = setup(platform); h.state.tables.add("records");
    const owner = await lease(h);
    h.faults.onRun = () => { h.state.tables.add("curling_credential_meta"); return "ok"; };
    expect(await h.target.transact(owner, { kind: "create_record", recordAfter: "after" })).toEqual({ status: "not_committed", reason: "protocol_refused", writeIssued: true, connection: "clean" });
    expect(h.state.rows.has(KEYS.record)).toBe(false);
    expect(h.state.trace).not.toContain("commit");
    await h.target.release(owner);
  });

  it("a diagnostic selection failure is explicitly before COMMIT and rolls back staged data", async () => {
    const h = setup(platform);
    const begun = await h.store.beginDiagnosticTransaction();
    if (!begun.ok) throw new Error("test transaction");
    expect(await h.store.stageDiagnosticWrites(begun.token, [{ key: "a", value: "uncommitted" }])).toEqual({ ok: true });
    h.state.tables.add("curling_credential_meta");
    expect(await h.store.commitDiagnosticTransaction(begun.token)).toEqual({ ok: false, reason: "protocol_refused", cleanup: "rolled_back" });
    expect(h.state.trace).not.toContain("commit");
    expect(h.state.rows.size).toBe(0);
    await h.store.close();
  });

  it("does not publish B4 from a selection retired after the last evidence read", async () => {
    const d = device(platform);
    const p = await boot(d);
    expect((await p.run()).outcome).toBe("access");
    d.storage.lengthReads = 0; d.storage.valueReads.length = 0;
    const list = p.target.listApplicationKeys.bind(p.target);
    p.target.listApplicationKeys = async (...args) => {
      const result = await list(...args); d.state.tables.add("curling_credential_meta"); return result;
    };
    expect(await p.run()).toMatchObject({ outcome: "target_refused", reason: "protocol_refused" });
    expect(d.storage.lengthReads).toBe(0); expect(d.storage.valueReads).toEqual([]);
    await p.runner.dispose();
  });

  it("does not prepare or issue a checkpoint after a digest callback retires schema selection", async () => {
    const d = device(platform, BASE_SOURCE);
    await reachCopying(d, 0);
    let changed = false;
    const p = await boot(d, { fingerprint: raw => {
      if (!changed) { changed = true; d.state.tables.add("curling_credential_meta"); }
      return fp(raw);
    } });
    const report = await p.run();
    expect(report).toMatchObject({ outcome: "halted", plan: "AP-COPY", halt: { kind: "not_issued", cause: "target_unavailable" } });
    expect(committedRecord(d)?.phase).toBe("copying");
    expect(committedRecord(d)?.copied).toEqual([]);
    expect([...d.state.rows.keys()]).toEqual([KEYS.record]);
    await p.runner.dispose();
  });
});

describe("ownership and malformed discovery", () => {
  it("reserves before a pending first query; another ordinary factory cannot release/open it", async () => {
    let release!: () => void; let entered!: () => void;
    const waiting = new Promise<void>(resolve => { release = resolve; });
    const reached = new Promise<void>(resolve => { entered = resolve; });
    const h = setup("ios", { gate: async call => {
      if (call.kind === "query" && call.statement === "PRAGMA schema_version;") { entered(); await waiting; }
    } });
    const first = h.store.adapter.get("a"); await reached;
    const second = createNativeSqliteStore(h.options);
    expect((await second.adapter.get("a")).status).toBe("read_failed");
    expect((await second.reopenDiagnosticConnection()).ok).toBe(false);
    expect((await second.close()).ok).toBe(false);
    expect(h.state.openCount).toBe(1); expect(h.state.closeCount).toBe(0);
    release(); expect(await first).toEqual({ status: "value", value: null });
    await h.store.close();
    expect(await second.adapter.get("a")).toEqual({ status: "value", value: null });
    await second.close();
  });

  it("retains exclusion if failed-open native release is uncertain", async () => {
    const h = setup("ios", { closeConnectionRejects: true }); h.state.tables.add("unknown");
    expect((await h.store.adapter.get("a")).status).toBe("read_failed");
    const second = createNativeSqliteStore(h.options);
    const count = h.state.openCount;
    expect((await second.adapter.set("a", "default")).ok).toBe(false);
    expect(h.state.openCount).toBe(count);
    h.faults.closeConnectionRejects = false;
    expect((await h.store.close()).ok).toBe(true);
  });

  it("cancellation after a pending query prevents all further discovery and mutations", async () => {
    let alive = true;
    const h = setup("ios", { gate: call => { if (call.statement === "PRAGMA schema_version;") alive = false; } });
    const owner = await lease(h);
    expect(await h.target.checkProtocolSelection(owner, { proceed: () => alive })).toEqual({ ok: false, reason: "cancelled" });
    expect(h.state.trace.some(x => x.includes("sqlite_master"))).toBe(false);
    expect(h.state.pragmas.size).toBe(0);
    await h.target.release(owner);
  });

  for (const raw of [null, {}, { values: null }, { values: [null] }, { values: [{ schema_version: -1 }] }, { values: [{ schema_version: 0 }, { schema_version: 0 }] }]) {
    it("never infers absence from malformed schema-version evidence", async () => {
      const h = setup("ios", { onQuery: sql => sql === "PRAGMA schema_version;" ? { envelope: raw } : undefined });
      const owner = await lease(h);
      expect(await h.target.checkProtocolSelection(owner)).toEqual({ ok: false, reason: "protocol_refused" });
      expect(h.state.pragmas.size).toBe(0);
      await h.target.release(owner);
    });
  }

  it("rejects schema-version drift during discovery", async () => {
    let version = 0;
    const h = setup("ios", { onQuery: sql => sql === "PRAGMA schema_version;" ? { envelope: { values: [{ schema_version: ++version }] } } : undefined });
    const owner = await lease(h);
    expect(await h.target.checkProtocolSelection(owner)).toEqual({ ok: false, reason: "protocol_refused" });
    expect(h.state.pragmas.size).toBe(0);
    await h.target.release(owner);
  });

  for (const sql of [SCHEMA, "PRAGMA table_info('records');", "PRAGMA index_list('records');", "PRAGMA index_info('sqlite_autoindex_records_1');", LIST]) {
    it(`rejects missing/extra result fields for ${sql}`, async () => {
      const h = setup("ios", { onQuery: query => query === sql ? { envelope: { values: [{ unexpected: "PRIVATE_SENTINEL" }] } } : undefined });
      h.state.tables.add("records");
      const owner = await lease(h);
      expect(await h.target.checkProtocolSelection(owner)).toEqual({ ok: false, reason: "protocol_refused" });
      expect(h.state.pragmas.size).toBe(0);
      await h.target.release(owner);
    });
  }

  it("rejects accessors without invoking them or exposing their content", async () => {
    let called = false;
    const envelope = Object.defineProperty({}, "values", { get() { called = true; throw new Error("PRIVATE_SENTINEL"); } });
    const h = setup("ios", { onQuery: () => ({ envelope }) });
    const owner = await lease(h);
    expect(await h.target.checkProtocolSelection(owner)).toEqual({ ok: false, reason: "protocol_refused" });
    expect(called).toBe(false);
    await h.target.release(owner);
  });
});
