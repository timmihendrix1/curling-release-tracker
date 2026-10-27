// Class-M tests for the migration-only TARGET capability (Stage M3b4b) over
// the plugin-faithful engine, on both platforms: lease ownership against
// ordinary and diagnostics work, strict reads, atomic transactions, and the
// BEGIN/COMMIT/ROLLBACK/close/release/open boundaries with their native effect
// modelled explicitly. Mock evidence only — it models the approved atomicity
// assumption and proves nothing about a device.
import { describe, expect, it } from "vitest";
import {
  createNativeMigrationSqliteStore,
  createNativeSqliteStore,
  type NativeMigrationLease,
  type NativeSqliteMigrationTarget,
  type NativeSqliteStore,
} from "../nativeSqliteAdapter";
import {
  createPluginFaithfulEngine,
  createPluginFaithfulEngineState,
  type PluginFaithfulEngineState,
  type PluginFaithfulFaults,
  type PluginPlatform,
} from "./pluginFaithfulSqliteEngine";
import { LATCH_KEY, PLATFORMS, RECORD_KEY, TARGET_DATABASE } from "./nativeMigrationMTestKit";

const SENTINEL = "SYNTHETIC_PRIVATE_VALUE";

interface Harness {
  state: PluginFaithfulEngineState;
  faults: PluginFaithfulFaults;
  plugin: ReturnType<typeof createPluginFaithfulEngine>;
  store: NativeSqliteStore;
  target: NativeSqliteMigrationTarget;
}

let databases = 0;
/** A distinct synthetic database per harness: ownership is per database within this
 * live test context, so unrelated tests must not share one. */
const nextDatabase = () => `${TARGET_DATABASE}-${(databases += 1)}`;

function harness(
  platform: PluginPlatform,
  state = createPluginFaithfulEngineState(),
  faults: PluginFaithfulFaults = {},
  databaseName = nextDatabase()
): Harness {
  const live: PluginFaithfulFaults = Object.assign(faults, { rollbackWithoutTransaction: "platform" as const });
  const plugin = createPluginFaithfulEngine({ platform, state, faults: live });
  const { store, target } = createNativeMigrationSqliteStore({
    databaseName,
    engine: plugin.engine,
    detectPlatform: () => platform,
    reservedKeys: { record: RECORD_KEY, latch: LATCH_KEY },
  });
  return { state, faults: live, plugin, store, target };
}

async function leased(h: Harness): Promise<NativeMigrationLease> {
  const acquired = await h.target.acquire();
  if (!acquired.ok) throw new Error("acquire failed");
  return acquired.lease;
}

/** Puts committed rows in place through the ordinary adapter (before any lease). */
async function seed(h: Harness, rows: Record<string, string>): Promise<void> {
  for (const [key, value] of Object.entries(rows)) {
    expect((await h.store.adapter.set(key, value)).ok).toBe(true);
  }
}

const statementsSince = (h: Harness, mark: number) => h.state.executed.slice(mark).map((entry) => entry.requested);

describe.each(PLATFORMS)("%s — construction and ownership", (platform) => {
  it("constructing it opens nothing; invalid reserved keys are refused at construction", () => {
    const h = harness(platform);
    expect(h.state.openCount).toBe(0);
    expect(h.target.leaseState()).toBe("unowned");
    for (const reservedKeys of [{ record: "a", latch: "a" }, { record: "", latch: "b" }, { record: 1, latch: "b" }]) {
      expect(() => createNativeMigrationSqliteStore({ databaseName: TARGET_DATABASE, reservedKeys: reservedKeys as never })).toThrow(TypeError);
    }
    // The ordinary factory still exposes no migration capability.
    expect("target" in createNativeSqliteStore({ databaseName: TARGET_DATABASE })).toBe(false);
  });

  it("one lease at a time; while held, ordinary, diagnostics and lifecycle work is refused", async () => {
    const h = harness(platform);
    await seed(h, { a: "1" });
    const lease = await leased(h);
    expect(await h.target.acquire()).toEqual({ ok: false, reason: "lease_held" });
    expect((await h.store.adapter.get("a")).status).toBe("read_failed");
    expect((await h.store.adapter.set("a", "2")).ok).toBe(false);
    expect((await h.store.adapter.remove("a")).ok).toBe(false);
    expect((await h.store.close()).ok).toBe(false);
    expect((await h.store.deleteAllRecords()).ok).toBe(false);
    expect((await h.store.readEffectiveSettings()).ok).toBe(false);
    expect(await h.store.beginDiagnosticTransaction()).toEqual({ ok: false, reason: "transaction_pending" });
    expect((await h.store.reopenDiagnosticConnection()).ok).toBe(false);
    expect(h.state.rows.get("a")).toBe("1");
    expect((await h.target.release(lease)).ok).toBe(true);
    expect(await h.store.adapter.get("a")).toEqual({ status: "value", value: "1" });
  });

  it("a diagnostics transaction blocks the lease; a stale or foreign lease resolves nothing", async () => {
    const h = harness(platform);
    const begun = await h.store.beginDiagnosticTransaction();
    expect(begun.ok).toBe(true);
    expect(await h.target.acquire()).toEqual({ ok: false, reason: "diagnostic_transaction_pending" });
    if (begun.ok) await h.store.rollbackDiagnosticTransaction(begun.token);

    const first = await leased(h);
    expect((await h.target.release(first)).ok).toBe(true);
    const second = await leased(h);
    for (const stale of [first, { id: "forged" }]) {
      expect(await h.target.readReserved(stale)).toEqual({ ok: false, reason: "wrong_lease" });
      expect(await h.target.transact(stale, { kind: "create_record", recordAfter: "r" })).toEqual({ status: "refused", reason: "wrong_lease" });
      expect(await h.target.reopen(stale)).toEqual({ ok: false, reason: "wrong_lease" });
      expect(await h.target.release(stale)).toEqual({ ok: false, reason: "wrong_lease" });
    }
    expect(h.state.rows.has(RECORD_KEY)).toBe(false);
    expect((await h.target.release(second)).ok).toBe(true);
    expect(await h.target.readReserved(second)).toEqual({ ok: false, reason: "no_lease" });
  });
});

describe.each(PLATFORMS)("%s — strict reads", (platform) => {
  it("reserved reads and the listing exclude EXACTLY the two reserved keys", async () => {
    const h = harness(platform);
    await seed(h, { [RECORD_KEY]: "rec", [LATCH_KEY]: "latch", b: "2", a: "" });
    const lease = await leased(h);
    expect(await h.target.readReserved(lease)).toEqual({
      ok: true,
      record: { status: "present", bytes: "rec" },
      latch: { status: "present", bytes: "latch" },
    });
    expect(await h.target.listApplicationKeys(lease)).toEqual({ status: "listed", keys: ["a", "b"] });
    const values = await h.target.readValues(lease, ["a", "missing"]);
    expect(values.ok && [...values.values]).toEqual([["a", { status: "present", bytes: "" }], ["missing", { status: "absent" }]]);
    expect(await h.target.readValues(lease, [RECORD_KEY])).toEqual({ ok: false, reason: "invalid_transaction" });
  });

  const malformed: [string, unknown][] = [
    ["no values array", {}],
    ["values not an array", { values: "x" }],
    ["a non-object row", { values: ["a"] }],
    ["a row without the column", { values: [{ other: "a" }] }],
    ["an extra column", { values: [{ key: "a", value: "x" }] }],
    ["a non-string key", { values: [{ key: 7 }] }],
    ["a duplicate row", { values: [{ key: "a" }, { key: "a" }] }],
    ["null", null],
  ];
  for (const [label, envelope] of malformed) {
    it(`a malformed listing (${label}) fails closed — never apparent absence`, async () => {
      const h = harness(platform);
      await seed(h, { a: "1" });
      const lease = await leased(h);
      h.faults.onQuery = (sql) => ((sql === "SELECT key FROM records ORDER BY key") ? { envelope } : undefined);
      expect(await h.target.listApplicationKeys(lease)).toEqual({ status: "read_failed" });
    });
  }

  const malformedValue: [string, unknown][] = [
    ["two rows", { values: [{ value: "a" }, { value: "b" }] }],
    ["a non-string value", { values: [{ value: 1 }] }],
    ["an extra column", { values: [{ value: "a", key: "k" }] }],
    ["a missing column", { values: [{}] }],
  ];
  for (const [label, envelope] of malformedValue) {
    it(`a malformed value read (${label}) is read_failed`, async () => {
      const h = harness(platform);
      const lease = await leased(h);
      h.faults.onQuery = (sql) => (/SELECT value FROM/i.test(sql) ? { envelope } : undefined);
      expect(await h.target.readReserved(lease)).toEqual({ ok: true, record: { status: "read_failed" }, latch: { status: "read_failed" } });
    });
  }

  it("an unreadable record does not hide a readable latch, nor the reverse", async () => {
    const h = harness(platform);
    await seed(h, { [LATCH_KEY]: "L" });
    const lease = await leased(h);
    h.faults.onQuery = (_sql, values) => (values[0] === RECORD_KEY ? { reject: true } : undefined);
    expect(await h.target.readReserved(lease)).toEqual({ ok: true, record: { status: "read_failed" }, latch: { status: "present", bytes: "L" } });
  });
});

describe.each(PLATFORMS)("%s — transactions", (platform) => {
  it("a checkpoint commits its rows and the record TOGETHER, every statement with the per-statement flag off", async () => {
    const h = harness(platform);
    await seed(h, { [RECORD_KEY]: "before" });
    const lease = await leased(h);
    const mark = h.state.executed.length;
    const result = await h.target.transact(lease, {
      kind: "checkpoint",
      recordBefore: "before",
      recordAfter: "after",
      rows: [{ key: "a", value: SENTINEL }, { key: "b", value: "" }],
    });
    expect(result).toEqual({ status: "confirmed" });
    expect(Object.fromEntries(h.state.rows)).toEqual({ [RECORD_KEY]: "after", a: SENTINEL, b: "" });
    const statements = statementsSince(h, mark);
    expect(statements[0]).toBe("PRAGMA schema_version;");
    expect(statements.indexOf("BEGIN TRANSACTION;")).toBeGreaterThan(statements.indexOf("PRAGMA schema_version;"));
    expect(statements.at(-1)).toBe("COMMIT TRANSACTION;");
    // Every write ran INSIDE the one owned transaction.
    const writes = h.state.executed.slice(mark).filter((entry) => /^(INSERT|UPDATE)/.test(entry.requested));
    expect(writes).toHaveLength(3);
    expect(writes.every((entry) => entry.inTransaction === true)).toBe(true);
    expect(statements.filter((sql) => sql === "COMMIT TRANSACTION;")).toHaveLength(1);
  });

  it("refuses an empty, duplicate or reserved-key checkpoint before BEGIN", async () => {
    const h = harness(platform);
    const lease = await leased(h);
    const mark = h.state.executed.length;
    for (const rows of [[], [{ key: "a", value: "1" }, { key: "a", value: "2" }], [{ key: LATCH_KEY, value: "x" }]]) {
      expect(await h.target.transact(lease, { kind: "checkpoint", recordBefore: "b", recordAfter: "a", rows })).toEqual({
        status: "refused",
        reason: "invalid_transaction",
      });
    }
    expect(statementsSince(h, mark)).toEqual([]);
  });

  it("stale evidence cannot authorise a write: a changed record, an existing row or a populated target abort before writing", async () => {
    const cases: [Record<string, string>, Parameters<NativeSqliteMigrationTarget["transact"]>[1]][] = [
      [{ [RECORD_KEY]: "other" }, { kind: "replace_record", recordBefore: "expected", recordAfter: "x", requireNoApplicationRows: false }],
      [{ [RECORD_KEY]: "before", a: "staged" }, { kind: "checkpoint", recordBefore: "before", recordAfter: "x", rows: [{ key: "a", value: "new" }] }],
      [{ a: "1" }, { kind: "create_record", recordAfter: "x" }],
      [{ [RECORD_KEY]: "r" }, { kind: "create_record", recordAfter: "x" }],
      [{ [RECORD_KEY]: "e", a: "1" }, { kind: "replace_record", recordBefore: "e", recordAfter: "x", requireNoApplicationRows: true }],
    ];
    for (const [rows, tx] of cases) {
      const h = harness(platform);
      await seed(h, rows);
      const lease = await leased(h);
      expect(await h.target.transact(lease, tx)).toEqual({
        status: "not_committed",
        reason: "precondition_failed",
        writeIssued: false,
        connection: "clean",
      });
      expect(Object.fromEntries(h.state.rows)).toEqual(rows);
      expect(h.plugin.transactionOpen).toBe(false);
      expect(h.target.leaseState()).toBe("owned");
    }
  });

  it("a staged row is never overwritten: rows are INSERTed without a conflict clause, which the engine rejects over an existing key", async () => {
    const h = harness(platform);
    await seed(h, { [RECORD_KEY]: "before" });
    const lease = await leased(h);
    const mark = h.state.executed.length;
    await h.target.transact(lease, { kind: "checkpoint", recordBefore: "before", recordAfter: "after", rows: [{ key: "a", value: "1" }] });
    const inserts = statementsSince(h, mark).filter((sql) => sql.startsWith("INSERT"));
    expect(inserts).toEqual(["INSERT INTO records (key, value) VALUES (?, ?)"]);
    // The statement itself, over a row that exists, is a constraint violation.
    const raw = await h.plugin.engine.createConnection();
    await expect(raw.run(inserts[0], ["a", "overwrite"], true)).rejects.toBeTruthy();
    expect(h.state.rows.get("a")).toBe("1");
  });

  it("partial statement failure: the second INSERT fails and NOTHING of the batch or its progress lands", async () => {
    const h = harness(platform);
    await seed(h, { [RECORD_KEY]: "before" });
    const lease = await leased(h);
    h.faults.onRun = (sql, values) => (/^INSERT/.test(sql) && values[0] === "b" ? "reject_before_effect" : "ok");
    const result = await h.target.transact(lease, {
      kind: "checkpoint",
      recordBefore: "before",
      recordAfter: "after",
      rows: [{ key: "a", value: "1" }, { key: "b", value: "2" }],
    });
    expect(result).toEqual({ status: "not_committed", reason: "statement_failed", writeIssued: true, connection: "clean" });
    expect(Object.fromEntries(h.state.rows)).toEqual({ [RECORD_KEY]: "before" });
    expect(h.plugin.transactionOpen).toBe(false);
  });

  it("a write acknowledged with anything but one changed row is a statement failure", async () => {
    for (const fault of ["malformed_after_effect", "reject_after_effect"] as const) {
      const h = harness(platform);
      await seed(h, { [RECORD_KEY]: "before" });
      const lease = await leased(h);
      h.faults.onRun = () => fault;
      expect(await h.target.transact(lease, { kind: "replace_record", recordBefore: "before", recordAfter: "after", requireNoApplicationRows: false }))
        .toMatchObject({ status: "not_committed", reason: "statement_failed", writeIssued: true });
      expect(h.state.rows.get(RECORD_KEY)).toBe("before");
    }
  });

  it("the record is replaced in place: UPDATE, never DELETE then INSERT", async () => {
    const h = harness(platform);
    await seed(h, { [RECORD_KEY]: "before" });
    const lease = await leased(h);
    const mark = h.state.executed.length;
    await h.target.transact(lease, { kind: "replace_record", recordBefore: "before", recordAfter: "after", requireNoApplicationRows: true });
    const writes = statementsSince(h, mark).filter((sql) => /^(INSERT|UPDATE|DELETE)/.test(sql));
    expect(writes).toEqual(["UPDATE records SET value = ? WHERE key = ?"]);
  });

  it("an in-transaction verifier sees every application row, and its refusal or throw aborts before writing", async () => {
    for (const verdict of [false, "throw"] as const) {
      const h = harness(platform);
      await seed(h, { [RECORD_KEY]: "v", a: "1", b: "2" });
      const lease = await leased(h);
      let seen: unknown = null;
      const result = await h.target.transact(lease, {
        kind: "replace_record",
        recordBefore: "v",
        recordAfter: "x",
        requireNoApplicationRows: false,
        verifyCompleteEvidence: async (rows) => {
          seen = rows;
          if (verdict === "throw") throw new Error(SENTINEL);
          return verdict;
        },
      });
      expect(seen).toEqual([{ key: "a", value: "1" }, { key: "b", value: "2" }]);
      expect(result).toEqual({ status: "not_committed", reason: "evidence_mismatch", writeIssued: false, connection: "clean" });
      expect(h.state.rows.get(RECORD_KEY)).toBe("v");
    }
  });

  it("the latch transaction writes only the latch, and finds an existing one without writing", async () => {
    const h = harness(platform);
    await seed(h, { [RECORD_KEY]: "r", a: "1" });
    const lease = await leased(h);
    expect(await h.target.transact(lease, { kind: "insert_latch", content: "{}" })).toEqual({ status: "confirmed" });
    expect(Object.fromEntries(h.state.rows)).toEqual({ [RECORD_KEY]: "r", a: "1", [LATCH_KEY]: "{}" });
    expect(await h.target.transact(lease, { kind: "insert_latch", content: "{2}" })).toMatchObject({
      status: "not_committed",
      reason: "latch_already_present",
      writeIssued: false,
    });
    expect(h.state.rows.get(LATCH_KEY)).toBe("{}");
  });
});

describe.each(PLATFORMS)("%s — uncertain boundaries", (platform) => {
  const replace = { kind: "replace_record" as const, recordBefore: "before", recordAfter: "after", requireNoApplicationRows: false };

  async function begun(faults: PluginFaithfulFaults) {
    const h = harness(platform, createPluginFaithfulEngineState(), faults);
    await seed(h, { [RECORD_KEY]: "before" });
    const lease = await leased(h);
    return { h, lease };
  }

  for (const fault of ["reject_before_effect", "reject_after_effect", "malformed_after_effect"] as const) {
    it(`BEGIN ${fault}: nothing written, the lease requires a reopen, and reads are refused until then`, async () => {
      const { h, lease } = await begun({});
      h.faults.onBegin = () => fault;
      expect(await h.target.transact(lease, replace)).toEqual({
        status: "not_committed",
        reason: "begin_unacknowledged",
        writeIssued: false,
        connection: "uncertain",
      });
      expect(h.target.leaseState()).toBe("requires_reopen");
      expect(await h.target.readReserved(lease)).toEqual({ ok: false, reason: "requires_reopen" });
      expect(await h.target.listApplicationKeys(lease)).toEqual({ status: "refused", reason: "requires_reopen" });
      expect(await h.target.transact(lease, replace)).toEqual({ status: "refused", reason: "requires_reopen" });
      expect((await h.store.adapter.get(RECORD_KEY)).status).toBe("read_failed");
      h.faults.onBegin = undefined;
      expect(await h.target.reopen(lease)).toEqual({ ok: true, generation: 1 });
      expect(h.plugin.transactionOpen).toBe(false);
      expect(h.state.rows.get(RECORD_KEY)).toBe("before");
    });
  }

  for (const fault of ["reject_after_effect", "malformed_after_effect", "reject_before_effect"] as const) {
    it(`COMMIT ${fault}: outcome unknown, NO rollback issued, and only a reopen clears it`, async () => {
      const { h, lease } = await begun({});
      h.faults.onCommit = () => fault;
      const mark = h.state.executed.length;
      expect(await h.target.transact(lease, replace)).toEqual({ status: "outcome_unknown" });
      expect(statementsSince(h, mark)).not.toContain("ROLLBACK TRANSACTION;");
      expect(h.target.leaseState()).toBe("requires_reopen");
      // The durable state is whatever the native effect left.
      expect(h.state.rows.get(RECORD_KEY)).toBe(fault === "reject_before_effect" ? "before" : "after");
      h.faults.onCommit = undefined;
      expect((await h.target.reopen(lease)).ok).toBe(true);
      // Reopening discarded a still-open transaction (reject_before_effect) without committing it.
      expect(h.state.rows.get(RECORD_KEY)).toBe(fault === "reject_before_effect" ? "before" : "after");
      const read = await h.target.readReserved(lease);
      expect(read.ok && read.record).toEqual({ status: "present", bytes: fault === "reject_before_effect" ? "before" : "after" });
    });
  }

  it("release from requires_reopen closes the connection and releases its handle — ending any native transaction — before giving up the lease; a failing close keeps both", async () => {
    const { h, lease } = await begun({});
    h.faults.onBegin = () => "reject_after_effect";
    await h.target.transact(lease, replace);
    expect(h.plugin.transactionOpen).toBe(true);
    expect(h.target.leaseState()).toBe("requires_reopen");
    h.faults.onClose = () => "reject_before_effect";
    expect(await h.target.release(lease)).toEqual({ ok: false, boundary: "close" });
    expect(h.target.leaseState()).toBe("requires_reopen");
    expect(h.plugin.transactionOpen).toBe(true);
    h.faults.onClose = undefined;
    const mark = h.state.trace.length;
    expect(await h.target.release(lease)).toEqual({ ok: true });
    // Close and explicit release only — no fresh open, no new work.
    expect(statementsSince(h, mark)).toEqual([]);
    expect(h.state.trace.slice(mark)).toEqual(["close", "release"]);
    expect(h.plugin.transactionOpen).toBe(false);
    expect(h.target.leaseState()).toBe("unowned");
    expect(h.state.rows.get(RECORD_KEY)).toBe("before");
  });

  it("an unacknowledged ROLLBACK after a pre-write abort leaves the connection uncertain", async () => {
    for (const fault of ["reject_before_effect", "malformed_after_effect"] as const) {
      const { h, lease } = await begun({});
      h.faults.onRollback = () => fault;
      expect(await h.target.transact(lease, { ...replace, recordBefore: "not this" })).toEqual({
        status: "not_committed",
        reason: "precondition_failed",
        writeIssued: false,
        connection: "uncertain",
      });
      expect(h.target.leaseState()).toBe("requires_reopen");
    }
  });

  it("an Android ROLLBACK acknowledgement with no transaction is modelled, and never consulted after a COMMIT", async () => {
    const { h } = await begun({});
    const raw = await h.plugin.engine.createConnection();
    await raw.open();
    const answer = raw.rollbackTransaction();
    if (platform === "android") await expect(answer).resolves.toEqual({ changes: { changes: 0 } });
    else await expect(answer).rejects.toBeTruthy();
  });

  const boundaries: [string, (f: PluginFaithfulFaults) => void, "close" | "release" | "open"][] = [
    ["close", (f) => { f.onClose = () => "reject_before_effect"; }, "close"],
    ["release", (f) => { f.onCloseConnection = () => "reject_before_effect"; }, "release"],
    ["open", (f) => { f.openRejects = true; }, "open"],
  ];
  for (const [label, arrange, boundary] of boundaries) {
    it(`a failed ${label} keeps the reopen unestablished; no read is accepted until a complete reopen`, async () => {
      const { h, lease } = await begun({});
      h.faults.onCommit = () => "reject_after_effect";
      await h.target.transact(lease, replace);
      h.faults.onCommit = undefined;
      arrange(h.faults);
      const failed = await h.target.reopen(lease);
      expect(failed).toMatchObject({ ok: false, boundary });
      expect(h.target.leaseState()).toBe("requires_reopen");
      expect(await h.target.readReserved(lease)).toEqual({ ok: false, reason: "requires_reopen" });
      h.faults.onClose = undefined;
      h.faults.onCloseConnection = undefined;
      h.faults.openRejects = false;
      expect((await h.target.reopen(lease)).ok).toBe(true);
      expect((await h.target.readReserved(lease)).ok).toBe(true);
    });
  }

  it("reopen releases the native handle explicitly — the binding's own best-effort release is never relied on", async () => {
    const { h, lease } = await begun({});
    let releases = 0;
    h.faults.onCloseConnection = () => {
      releases += 1;
      return "ok";
    };
    await h.target.readReserved(lease); // opens the connection
    expect((await h.target.reopen(lease)).ok).toBe(true);
    expect(releases).toBe(1);
  });

  it("release closes and releases before giving up the lease; a failing close keeps the lease", async () => {
    const { h, lease } = await begun({});
    await h.target.readReserved(lease);
    h.faults.onClose = () => "reject_before_effect";
    expect(await h.target.release(lease)).toEqual({ ok: false, boundary: "close" });
    expect(h.target.leaseState()).toBe("owned");
    expect((await h.store.adapter.get(RECORD_KEY)).status).toBe("read_failed");
    h.faults.onClose = undefined;
    expect(await h.target.release(lease)).toEqual({ ok: true });
    expect(h.plugin.connectionOpen).toBe(false);
    expect(h.target.leaseState()).toBe("unowned");
  });

  it("an unanswered bridge call never releases ownership", async () => {
    const { h, lease } = await begun({});
    h.faults.onCommit = () => "hang";
    void h.target.transact(lease, replace);
    const release = h.target.release(lease);
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(h.target.leaseState()).not.toBe("unowned");
    let settled = false;
    void release.then(() => { settled = true; });
    await new Promise((resolve) => setTimeout(resolve, 5));
    expect(settled).toBe(false);
  });
});
