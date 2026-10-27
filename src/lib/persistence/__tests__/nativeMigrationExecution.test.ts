// Class-M acceptance cases for Stage M3b4b (docs/MOBILE_APP_MIGRATION.md Stage
// M3b0 §7, R1–R77). Each `mcase("Rn", …)` drives the REAL source binding,
// target capability, evidence collector and runner over the plugin-faithful
// engine and a disposable synthetic WebView store, on both platforms, and
// asserts the case's behaviour. `nativeMigrationMCoverage.test.ts` maps these
// labels to the canonical R-table.
//
// Evidence class M only: these tests model the approved atomicity assumption
// (§5.1). "Death" is a process whose bridge call never answers, followed by a
// new process over the same committed state. Nothing here proves real SQLite
// durability, marker persistence, restore pairing, termination during COMMIT or
// power-loss survival — R2, R65 and R66 stay simulator/device obligations, and
// R60 is the documented validation-to-activation residual.
import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeActivationRecord } from "../nativeMigrationRecord";
import {
  BASE_SOURCE,
  ELIGIBLE_BASE,
  KEY_BARRIER,
  KEY_CREDENTIAL,
  KEY_DIAGRAM,
  KEY_NEW,
  KEY_SESSION,
  KEY_SYNC_B,
  KEY_TRUSTED,
  KEY_UNKNOWN,
  STORE_FOREIGN,
} from "./nativeMigrationTestKit";
import {
  LATCH_KEY,
  MARKER_KEY,
  PLATFORMS,
  RECORD_KEY,
  applicationRows,
  boot,
  cloneDevice,
  commitReaches,
  committedRecord,
  device,
  dieAt,
  firstRule,
  once,
  phaseOf,
  reachActive,
  reachCopying,
  reachEnumerating,
  reachVerified,
  recordIn,
  runToRest,
  type Device,
  type Process,
} from "./nativeMigrationMTestKit";
import type { NativeMigrationRunReport } from "../nativeMigrationRunner";
import type { PluginPlatform } from "./pluginFaithfulSqliteEngine";

const mcase = (id: string, title: string, fn: () => Promise<void>) => it(`${id} — ${title}`, fn);

const CREDENTIAL_VALUE = "SYNTHETIC_CREDENTIAL_SENTINEL";
/** The default synthetic WebView store: four eligible keys from two Profiles and identity, plus excluded keys. */
const SOURCE: Readonly<Record<string, string>> = Object.freeze({
  ...BASE_SOURCE,
  [KEY_CREDENTIAL]: CREDENTIAL_VALUE,
  [KEY_DIAGRAM]: "data:synthetic",
  [KEY_UNKNOWN]: "unknown",
});
const SORTED_ELIGIBLE = [...ELIGIBLE_BASE].sort();
const FIRST_BATCH = SORTED_ELIGIBLE.slice(0, 2);
const ELIGIBLE_ROWS = Object.fromEntries(SORTED_ELIGIBLE.map((key) => [key, BASE_SOURCE[key]]));

afterEach(() => vi.unstubAllGlobals());

const fresh = (platform: PluginPlatform, source: Readonly<Record<string, string>> = SOURCE) => device(platform, source);
const marker = (d: Device) => d.storage.map.get(MARKER_KEY);
const begins = (d: Device) => d.state.executed.filter((entry) => entry.requested === "BEGIN TRANSACTION;").length;
const commits = (d: Device) => d.state.executed.filter((entry) => entry.requested === "COMMIT TRANSACTION;").length;

function expectHaltAt(report: NativeMigrationRunReport, step: number, disposition: string): void {
  expect(report.outcome, JSON.stringify(report)).toBe("halted");
  if (report.outcome !== "halted" || report.halt.kind !== "plan_run" || report.halt.report.status !== "halted") {
    throw new Error(JSON.stringify(report));
  }
  expect(report.halt.report.haltedAtStep).toBe(step);
  expect(report.halt.report.dispositions[step]).toBe(disposition);
}

function expectBlocked(report: NativeMigrationRunReport, rule: string, code?: string): void {
  expect(report.outcome, JSON.stringify(report)).toBe("blocked");
  if (report.outcome !== "blocked") return;
  expect(report.rule).toBe(rule);
  if (code) expect(report.findings.map((finding) => finding.code)).toContain(code);
}

function expectFault(report: NativeMigrationRunReport, code: string): void {
  expect(report.outcome, JSON.stringify(report)).toBe("fault");
  if (report.outcome !== "fault") return;
  expect(report.findings[0].code).toBe(code);
}

/** A checkpoint COMMIT (copying, at least one key copied). */
const checkpointCommit = commitReaches("copying", (working) => (recordIn(working)?.copied?.length ?? 0) > 0);
/** The `enumerating → copying` COMMIT. */
const beginCopyingCommit = commitReaches("copying", (working) => (recordIn(working)?.copied?.length ?? -1) === 0);

/** Rewrites the committed record into a structurally valid record that is neither issued state. */
function rewriteRecordNeither(d: Device): void {
  const record = committedRecord(d);
  if (!record) throw new Error("no record");
  d.state.rows.set(RECORD_KEY, serializeActivationRecord({ ...record, migrationId: "99999999-9999-4999-8999-999999999999" }));
}

describe.each(PLATFORMS)("%s — provenance, marker and record-first (I-3, I-4)", (platform) => {
  mcase("R1", "death after the AP-D3 record commit, before the marker write → PV14 → E′6 with the same storeIdentity", async () => {
    const d = fresh(platform);
    // The process dies before step 2: its marker write never takes effect.
    d.storage.faults.setItem = (key) => (key === MARKER_KEY ? "reject_before_apply" : "ok");
    await (await boot(d)).run();
    d.storage.faults.setItem = undefined;
    const identity = committedRecord(d)?.storeIdentity;
    expect(phaseOf(d)).toBe("enumerating");
    expect(marker(d)).toBeUndefined();
    const report = await runToRest(await boot(d));
    expect(report.completedPlans[0]).toEqual({ name: "AP-K1′", rule: "E′6" });
    expect(committedRecord(d)?.storeIdentity).toBe(identity);
    expect(marker(d)).toBe(identity);
    expect(report.outcome).toBe("access");
  });

  mcase("R3", "W: the AP-D3 record commit's acknowledgement lost → halt, no marker; committed ⇒ E′6; not committed ⇒ PV7 with new ids", async () => {
    for (const fault of ["reject_after_effect", "reject_before_effect"] as const) {
      const d = fresh(platform);
      let attempted: string | undefined;
      const p = await boot(d, {
        faults: {
          onCommit: once((w) => {
            const hit = commitReaches("enumerating")(w) && !d.state.rows.has(RECORD_KEY);
            if (hit) attempted = recordIn(w)?.storeIdentity;
            return hit;
          }, fault, "ok"),
        },
      });
      const halted = await p.run();
      expectHaltAt(halted, 0, "outcome_unknown");
      expect(d.storage.writes).not.toContain(MARKER_KEY);
      const next = await p.run();
      expect(next.outcome).not.toBe("fault");
      expect(firstRule(next)).toBe(fault === "reject_after_effect" ? "E′6" : "PV7");
      if (fault === "reject_before_effect") expect(committedRecord(d)?.storeIdentity).not.toBe(attempted);
    }
  });

  mcase("R4", "C: the durable states of R3 with plan memory discarded reach the same rows", async () => {
    for (const fault of ["reject_after_effect", "reject_before_effect"] as const) {
      const d = fresh(platform);
      const p = await boot(d, { faults: { onCommit: once((w) => commitReaches("enumerating")(w) && !d.state.rows.has(RECORD_KEY), fault, "ok") } });
      await p.run();
      const cold = await (await boot(d)).run();
      expect(firstRule(cold)).toBe(fault === "reject_after_effect" ? "E′6" : "PV7");
    }
  });

  mcase("R8", "AP-K1′'s marker write rejected before applying → halt with no target transaction; marker absent ⇒ PV14 → E′6", async () => {
    const d = fresh(platform);
    await reachEnumerating(d);
    const p = await boot(d);
    d.storage.faults.setItem = () => "reject_before_apply";
    const before = begins(d);
    const report = await p.run();
    expectHaltAt(report, 0, "outcome_unknown");
    expect(begins(d)).toBe(before);
    expect(marker(d)).toBeUndefined();
    d.storage.faults.setItem = undefined;
    expect(firstRule(await p.run())).toBe("E′6");
  });

  mcase("R9", "a marker write that applies and then rejects — in AP-D3, AP-K1′, AP-COPY, AP-CC and AP-ACT — is an unknown halt; the marker reads equal ⇒ PV13", async () => {
    const setups: [string, (d: Device) => Promise<void>, number][] = [
      ["AP-D3", async () => undefined, 1],
      ["AP-K1′", reachEnumerating, 0],
      ["AP-COPY", (d) => reachCopying(d, 0), 0],
      ["AP-CC", (d) => reachCopying(d, 4), 0],
      ["AP-ACT", reachVerified, 0],
    ];
    for (const [plan, setup, step] of setups) {
      const d = fresh(platform);
      await setup(d);
      d.storage.map.delete(MARKER_KEY);
      const p = await boot(d);
      d.storage.faults.setItem = () => "apply_then_reject";
      const rowsBefore = new Map(d.state.rows);
      const beginsBefore = begins(d);
      const report = await p.run();
      expect(report.outcome === "halted" && report.plan, plan).toBe(plan);
      expectHaltAt(report, step, "outcome_unknown");
      expect(marker(d)).toBe(committedRecord(d)?.storeIdentity);
      if (step === 0) {
        // The target is untouched by a halt at the marker step.
        expect(begins(d)).toBe(beginsBefore);
        expect(d.state.rows).toEqual(rowsBefore);
      }
      d.storage.faults.setItem = undefined;
      const next = await runToRest(p);
      expect(next.outcome, plan).toBe("access");
    }
  });

  mcase("R10", "a marker write's answer lost, or death during it: the marker read decides — PV13, PV14, PV11 or PV10", async () => {
    for (const variant of ["applied", "not_applied", "malformed", "unreadable"] as const) {
      const d = fresh(platform);
      await reachEnumerating(d);
      const p = await boot(d);
      d.storage.faults.setItem = () => (variant === "not_applied" ? "reject_before_apply" : "apply_then_reject");
      await p.run();
      d.storage.faults.setItem = undefined;
      if (variant === "malformed") d.storage.map.set(MARKER_KEY, "not-a-uuid");
      if (variant === "unreadable") d.storage.faults.getItemThrows = (key) => key === MARKER_KEY;
      const cold = await (await boot(d)).run();
      if (variant === "malformed") expectBlocked(cold, "PV11");
      else if (variant === "unreadable") expectBlocked(cold, "PV10");
      else expect(firstRule(cold)).toBe("E′6");
      if (variant === "malformed") expect(marker(d)).toBe("not-a-uuid");
    }
  });

  mcase("R11", "a marker present with no record → PV5 BLOCKED, nothing written", async () => {
    const d = fresh(platform, { ...SOURCE, [MARKER_KEY]: STORE_FOREIGN });
    const report = await (await boot(d)).run();
    expectBlocked(report, "PV5");
    expect(d.state.rows.size).toBe(0);
    expect(d.storage.writes).toEqual([]);
  });

  mcase("R12", "the AP-D3 marker write fails after a confirmed record commit → step 1 confirmed, step 2 unknown; next PV13/PV14 → E′6", async () => {
    for (const mode of ["apply_then_reject", "reject_before_apply"] as const) {
      const d = fresh(platform);
      const p = await boot(d);
      d.storage.faults.setItem = () => mode;
      const report = await p.run();
      expectHaltAt(report, 1, "outcome_unknown");
      if (report.outcome === "halted" && report.halt.kind === "plan_run" && report.halt.report.status === "halted") {
        expect(report.halt.report.confirmedWriteSteps).toEqual([0]);
        expect(report.halt.report.possiblyChangedStores).toEqual(["source", "target"]);
      }
      d.storage.faults.setItem = undefined;
      expect(firstRule(await p.run())).toBe("E′6");
    }
  });

  mcase("R18", "a K2 marker write in AP-COPY, AP-CC or AP-ACT ends unknown → halt with no target transaction; next the same E′ row", async () => {
    const setups: [(d: Device) => Promise<void>, string][] = [
      [(d) => reachCopying(d, 2), "E′9"],
      [(d) => reachCopying(d, 4), "E′10"],
      [reachVerified, "E′11"],
    ];
    for (const [setup, rule] of setups) {
      for (const mode of ["apply_then_reject", "reject_before_apply"] as const) {
        const d = fresh(platform);
        await setup(d);
        d.storage.map.delete(MARKER_KEY);
        const p = await boot(d);
        d.storage.faults.setItem = () => mode;
        const beginsBefore = begins(d);
        const report = await p.run();
        expect(report.outcome === "halted" && report.rule).toBe(rule);
        expectHaltAt(report, 0, "outcome_unknown");
        expect(begins(d)).toBe(beginsBefore);
        d.storage.faults.setItem = undefined;
        expect(firstRule(await p.run())).toBe(rule);
      }
    }
  });

  mcase("R37", "marker alone removed, source intact, copying with copied rows → E′9 (K2), then AP-CC and AP-ACT; staged rows unchanged", async () => {
    const d = fresh(platform);
    await reachCopying(d, 2);
    const staged = applicationRows(d);
    d.storage.map.delete(MARKER_KEY);
    const p = await boot(d);
    const report = await runToRest(p);
    expect(report.completedPlans.map((plan) => plan.rule)).toEqual(["E′9", "E′10", "E′11"]);
    expect(report.outcome).toBe("access");
    for (const [key, value] of Object.entries(staged)) expect(d.state.rows.get(key)).toBe(value);
    expect(marker(d)).toBe(committedRecord(d)?.storeIdentity);
  });

  mcase("R38", "marker alone removed while enumerating → E′6", async () => {
    const d = fresh(platform);
    await reachEnumerating(d);
    expect(firstRule(await (await boot(d)).run())).toBe("E′6");
  });

  mcase("R45", "a foreign marker id with identical content, copying → PV12 BLOCKED, not K2; the marker is not overwritten", async () => {
    const d = fresh(platform);
    await reachCopying(d, 2);
    d.storage.map.set(MARKER_KEY, STORE_FOREIGN);
    const report = await (await boot(d)).run();
    expectBlocked(report, "PV12");
    expect(marker(d)).toBe(STORE_FOREIGN);
  });

  mcase("R46", "a foreign marker id with different content → PV12 BLOCKED", async () => {
    const d = fresh(platform);
    await reachCopying(d, 2);
    d.storage.map.set(MARKER_KEY, STORE_FOREIGN);
    d.storage.map.set(KEY_SESSION, "different");
    const report = await (await boot(d)).run();
    expectBlocked(report, "PV12");
  });

  mcase("R47", "a foreign marker id while enumerating, nothing staged → PV12 BLOCKED; the marker is not overwritten and the record not replaced", async () => {
    const d = fresh(platform);
    await reachEnumerating(d);
    const record = d.state.rows.get(RECORD_KEY);
    d.storage.map.set(MARKER_KEY, STORE_FOREIGN);
    const report = await (await boot(d)).run();
    expectBlocked(report, "PV12");
    expect(marker(d)).toBe(STORE_FOREIGN);
    expect(d.state.rows.get(RECORD_KEY)).toBe(record);
  });

  mcase("R50", "a malformed marker, with and without a record → PV4/PV11 BLOCKED; bytes preserved", async () => {
    const without = fresh(platform, { ...SOURCE, [MARKER_KEY]: "{malformed" });
    expectBlocked(await (await boot(without)).run(), "PV4");
    expect(marker(without)).toBe("{malformed");
    const withRecord = fresh(platform);
    await reachEnumerating(withRecord);
    withRecord.storage.map.set(MARKER_KEY, "{malformed");
    expectBlocked(await (await boot(withRecord)).run(), "PV11");
    expect(marker(withRecord)).toBe("{malformed");
  });

  mcase("R51", "a failing marker read, with and without a record → PV3/PV10 BLOCKED, retryable — never absent", async () => {
    const without = fresh(platform);
    without.storage.faults.getItemThrows = (key) => key === MARKER_KEY;
    const r1 = await (await boot(without)).run();
    expectBlocked(r1, "PV3");
    expect(r1.outcome === "blocked" && r1.retryMayResolve).toBe(true);
    expect(without.state.rows.size).toBe(0);
    const withRecord = fresh(platform);
    await reachEnumerating(withRecord);
    withRecord.storage.faults.getItemThrows = (key) => key === MARKER_KEY;
    expectBlocked(await (await boot(withRecord)).run(), "PV10");
  });
});

describe.each(PLATFORMS)("%s — transactions and recovery (I-9, I-11)", (platform) => {
  mcase("R5", "W and C: AP-K1′'s replacement unknown or interrupted → the old or new enumerating record; either ⇒ E′6", async () => {
    const replaceCommit = (d: Device) => (w: ReadonlyMap<string, string>) => commitReaches("enumerating")(w) && d.state.rows.has(RECORD_KEY);
    for (const fault of ["reject_after_effect", "reject_before_effect", "death"] as const) {
      const d = fresh(platform);
      await reachEnumerating(d);
      if (fault === "death") {
        await dieAt(d, replaceCommit(d));
        expect(firstRule(await (await boot(d)).run())).toBe("E′6");
        continue;
      }
      const p = await boot(d, { faults: { onCommit: once(replaceCommit(d), fault, "ok") } });
      await p.run();
      const warm = await p.run();
      expect(warm.outcome).not.toBe("fault");
      expect(firstRule(warm)).toBe("E′6");
    }
  });

  mcase("R6", "W: the reopened record has the issued new migrationId but differs elsewhere → detected fault; E′6 is NOT taken", async () => {
    const d = fresh(platform);
    await reachEnumerating(d);
    const p = await boot(d, { faults: { onCommit: once((w) => commitReaches("enumerating")(w) && d.state.rows.has(RECORD_KEY), "reject_after_effect", "ok") } });
    await p.run();
    // The committed record keeps the new migrationId but carries fewer entryKeys
    // — A′-valid, and E′5 passes over the current source.
    const record = committedRecord(d);
    if (!record) throw new Error("no record");
    d.state.rows.set(RECORD_KEY, serializeActivationRecord({ ...record, entryKeys: (record.entryKeys ?? []).slice(1) }));
    const beginsBefore = begins(d);
    const report = await p.run();
    expectFault(report, "warm_state_matches_neither");
    expect(report.completedPlans).toEqual([]);
    if (report.outcome === "fault") expect(report.latch.established).toBe("confirmed");
    // Only the latch transaction ran.
    expect(begins(d) - beginsBefore).toBe(1);
    expect(d.state.rows.has(LATCH_KEY)).toBe(true);
  });

  mcase("R13", "W and C: the enumerating → copying commit lost or interrupted → enumerating (E′6) or copying with copied = ∅ (E′9)", async () => {
    for (const fault of ["reject_after_effect", "reject_before_effect", "death"] as const) {
      const d = fresh(platform);
      if (fault === "death") {
        await dieAt(d, beginCopyingCommit);
        expect(firstRule(await (await boot(d)).run())).toBe("E′6");
        continue;
      }
      const p = await boot(d, { faults: { onCommit: once(beginCopyingCommit, fault, "ok") } });
      await p.run();
      expect(firstRule(await p.run())).toBe(fault === "reject_after_effect" ? "E′9" : "E′6");
    }
  });

  mcase("R14", "W: a checkpoint committed with its acknowledgement lost → the durable copied decides; that batch is never chosen again", async () => {
    const d = fresh(platform);
    const inserted: string[] = [];
    const p = await boot(d, {
      faults: {
        onCommit: once(checkpointCommit, "reject_after_effect", "ok"),
        onRun: (sql, values) => {
          if (sql.startsWith("INSERT") && values[0] !== RECORD_KEY && values[0] !== LATCH_KEY) inserted.push(String(values[0]));
          return "ok";
        },
      },
    });
    await p.run();
    expect(committedRecord(d)?.copied).toEqual(FIRST_BATCH);
    const report = await runToRest(p);
    expect(report.outcome).toBe("access");
    expect(report.completedPlans[0]).toEqual({ name: "AP-COPY", rule: "E′9" });
    // Every key inserted exactly once: the committed batch was never replayed.
    expect([...inserted].sort()).toEqual(SORTED_ELIGIBLE);
    expect(applicationRows(d)).toEqual(ELIGIBLE_ROWS);
  });

  mcase("R15", "C: death after a checkpoint commit → as R14, without plan memory", async () => {
    const d = fresh(platform);
    // Dies at the SECOND checkpoint, after the first one committed.
    await dieAt(d, commitReaches("copying", (w) => (recordIn(w)?.copied?.length ?? 0) > 2));
    expect(committedRecord(d)?.copied).toEqual(FIRST_BATCH);
    const inserted: string[] = [];
    const p = await boot(d, { faults: { onRun: (sql, values) => { if (sql.startsWith("INSERT")) inserted.push(String(values[0])); return "ok"; } } });
    const report = await runToRest(p);
    expect(report.outcome).toBe("access");
    expect(inserted.filter((key) => FIRST_BATCH.includes(key))).toEqual([]);
    expect(applicationRows(d)).toEqual(ELIGIBLE_ROWS);
  });

  mcase("R16", "C: death during a checkpoint, before commit → the previous copied and rows; E′9 chooses the remaining keys again", async () => {
    const d = fresh(platform);
    await dieAt(d, checkpointCommit);
    expect(committedRecord(d)?.copied).toEqual([]);
    expect(applicationRows(d)).toEqual({});
    const report = await runToRest(await boot(d));
    expect(report.completedPlans[0]).toEqual({ name: "AP-COPY", rule: "E′9" });
    expect(applicationRows(d)).toEqual(ELIGIBLE_ROWS);
  });

  mcase("R17", "rows without progress, or progress without rows → E′2 BLOCKED, nothing written", async () => {
    for (const variant of ["row_without_progress", "progress_without_row"] as const) {
      const d = fresh(platform);
      await reachCopying(d, 2);
      if (variant === "row_without_progress") d.state.rows.set(SORTED_ELIGIBLE[3], BASE_SOURCE[SORTED_ELIGIBLE[3]]);
      else d.state.rows.delete(FIRST_BATCH[0]);
      const beginsBefore = begins(d);
      const report = await (await boot(d)).run();
      expectBlocked(report, "E′2", variant === "row_without_progress" ? "row_without_progress" : "copied_without_row");
      expect(begins(d)).toBe(beginsBefore);
    }
  });

  mcase("R19", "CE4: copying with manifest = copied = target, all matching → E′10 → AP-CC → AP-ACT → B4", async () => {
    const d = fresh(platform);
    await reachCopying(d, 4);
    const report = await runToRest(await boot(d));
    expect(report.completedPlans.map((plan) => plan.rule)).toEqual(["E′10", "E′11"]);
    expect(report.outcome).toBe("access");
    expect(phaseOf(d)).toBe("active");
  });

  mcase("R20", "W: the AP-CC commit's acknowledgement lost → verified ⇒ E′11; copying ⇒ E′10", async () => {
    for (const fault of ["reject_after_effect", "reject_before_effect"] as const) {
      const d = fresh(platform);
      const p = await boot(d, { faults: { onCommit: once(commitReaches("verified"), fault, "ok") } });
      const halted = await p.run();
      expect(halted.outcome === "halted" && halted.plan).toBe("AP-CC");
      expect(firstRule(await p.run())).toBe(fault === "reject_after_effect" ? "E′11" : "E′10");
    }
  });

  mcase("R21", "C: death after the AP-CC commit → verified ⇒ E′11; AP-ACT re-reads the evidence inside its transaction", async () => {
    const d = fresh(platform);
    await reachVerified(d);
    const mark = d.state.executed.length;
    const report = await runToRest(await boot(d));
    expect(report.completedPlans[0]).toEqual({ name: "AP-ACT", rule: "E′11" });
    const statements = d.state.executed.slice(mark).map((entry) => entry.requested);
    const begin = statements.lastIndexOf("BEGIN TRANSACTION;");
    expect(statements.slice(begin).some((sql) => /SELECT key FROM records/.test(sql))).toBe(true);
  });

  mcase("R22", "C: death during AP-CC, before commit → copying ⇒ E′10; never an empty checkpoint", async () => {
    const d = fresh(platform);
    await dieAt(d, commitReaches("verified"));
    expect(phaseOf(d)).toBe("copying");
    const inserted: string[] = [];
    const report = await runToRest(await boot(d, { faults: { onRun: (sql, v) => { if (sql.startsWith("INSERT")) inserted.push(String(v[0])); return "ok"; } } }));
    expect(report.completedPlans[0].rule).toBe("E′10");
    expect(inserted).toEqual([]);
  });

  mcase("R23", "AP-CC finds a missing, extra or mismatched row, or incomplete copied → rolled back, halt; next E′2, E′3 or E′4", async () => {
    const variants: [string, (d: Device) => void, string][] = [
      ["missing", (d) => d.state.rows.delete(KEY_SESSION), "E′2"],
      ["extra", (d) => d.state.rows.set(KEY_NEW, "extra"), "E′3"],
      ["mismatched", (d) => d.state.rows.set(KEY_SESSION, "changed bytes"), "E′4"],
      ["incomplete copied", (d) => {
        const record = committedRecord(d);
        if (record) d.state.rows.set(RECORD_KEY, serializeActivationRecord({ ...record, copied: (record.copied ?? []).slice(1) }));
      }, "E′2"],
    ];
    for (const [label, mutate, rule] of variants) {
      const d = fresh(platform);
      await reachCopying(d, 4);
      const p = await boot(d, { faults: { onBegin: once(() => true, "ok", "ok") } });
      // Mutate natively AFTER the evaluation chose AP-CC, before its transaction.
      p.faults.onBegin = once(() => { mutate(d); return true; }, "ok" as const, "ok" as const);
      const report = await p.run();
      expect(report.outcome === "halted" && report.plan, label).toBe("AP-CC");
      expectHaltAt(report, 0, "aborted_before_write");
      expect(phaseOf(d)).toBe("copying");
      expectBlocked(await p.run(), rule);
    }
  });

  mcase("R25", "verified with complete copied but a target row missing or mismatched → E′2 or E′4 BLOCKED; never activated", async () => {
    for (const [mutate, rule] of [[(d: Device) => d.state.rows.delete(KEY_TRUSTED), "E′2"], [(d: Device) => d.state.rows.set(KEY_TRUSTED, "other"), "E′4"]] as const) {
      const d = fresh(platform);
      await reachVerified(d);
      mutate(d);
      expectBlocked(await (await boot(d)).run(), rule);
      expect(phaseOf(d)).toBe("verified");
    }
  });

  mcase("R26", "final target evidence unreadable inside AP-CC or AP-ACT → rolled back (or rollback unknown) and halt; retry continues; persistent failure blocks at PV9", async () => {
    for (const [setup, plan] of [[(d: Device) => reachCopying(d, 4), "AP-CC"], [reachVerified, "AP-ACT"]] as const) {
      for (const rollback of ["ok", "reject_before_effect"] as const) {
        const d = fresh(platform);
        await setup(d);
        let failInside = true;
        let p: Process | null = null;
        p = await boot(d, {
          faults: {
            onQuery: (sql) => (failInside && (sql === "SELECT key FROM records ORDER BY key") && p?.plugin.transactionOpen ? { reject: true } : undefined),
            onRollback: () => rollback,
          },
        });
        const report = await p.run();
        expect(report.outcome === "halted" && report.plan).toBe(plan);
        // AP-ACT reads and rechecks the source first; its transaction is step 2.
        expectHaltAt(report, plan === "AP-CC" ? 0 : 2, "aborted_before_write");
        expect(phaseOf(d)).toBe(plan === "AP-CC" ? "copying" : "verified");
        failInside = false;
        p.faults.onRollback = undefined;
        expect((await runToRest(p)).outcome).toBe("access");
      }
      const d = fresh(platform);
      await setup(d);
      const p = await boot(d, { faults: { onQuery: (sql) => ((sql === "SELECT key FROM records ORDER BY key") ? { reject: true } : undefined) } });
      expectBlocked(await p.run(), "PV9");
    }
  });

  mcase("R27", "CE3: AP-ACT writes the marker, then final source validation fails → halt at step 2; the marker present; next E′8 BLOCKED", async () => {
    for (const mode of ["ok", "apply_then_reject"] as const) {
      const d = fresh(platform);
      await reachVerified(d);
      d.storage.map.delete(MARKER_KEY);
      const p = await boot(d);
      d.storage.faults.setItem = (key) => {
        if (key === MARKER_KEY) d.storage.map.set(KEY_SESSION, "changed after the marker");
        return mode;
      };
      const report = await p.run();
      expect(report.outcome === "halted" && report.plan).toBe("AP-ACT");
      if (mode === "ok") {
        expectHaltAt(report, 2, "failed");
        if (report.outcome === "halted" && report.halt.kind === "plan_run" && report.halt.report.status === "halted") {
          expect(report.halt.report.confirmedWriteSteps).toEqual([0]);
          expect(report.halt.report.cause).toBe("recheck_failed");
        }
      } else {
        expectHaltAt(report, 0, "outcome_unknown");
      }
      expect(marker(d)).toBe(committedRecord(d)?.storeIdentity);
      d.storage.faults.setItem = undefined;
      expectBlocked(await p.run(), "E′8");
      expect(phaseOf(d)).toBe("verified");
    }
  });

  mcase("R28", "W: the activation commit's acknowledgement lost → active ⇒ B4, never re-activated; verified ⇒ E′11", async () => {
    for (const fault of ["reject_after_effect", "reject_before_effect"] as const) {
      const d = fresh(platform);
      const p = await boot(d, { faults: { onCommit: once(commitReaches("active"), fault, "ok") } });
      const halted = await p.run();
      expect(halted.outcome === "halted" && halted.plan).toBe("AP-ACT");
      const commitsBefore = commits(d);
      const next = await p.run();
      expect(next.outcome).toBe("access");
      if (fault === "reject_after_effect") {
        expect(next.completedPlans).toEqual([]);
        expect(commits(d)).toBe(commitsBefore);
      } else {
        expect(next.completedPlans).toEqual([{ name: "AP-ACT", rule: "E′11" }]);
      }
    }
  });

  mcase("R29", "C: death after the activation commit, with the source and marker gone → B4 without consulting either", async () => {
    const d = fresh(platform);
    await reachActive(d);
    d.storage.map.clear();
    d.storage.faults = { lengthThrows: true, keyThrows: true, getItemThrows: () => true };
    const lengthReads = d.storage.lengthReads;
    const valueReads = d.storage.valueReads.length;
    const report = await (await boot(d)).run();
    expect(report.outcome).toBe("access");
    expect(d.storage.lengthReads).toBe(lengthReads);
    expect(d.storage.valueReads.length).toBe(valueReads);
  });

  mcase("R30", "C: death during activation, before commit → verified ⇒ E′11 re-validates the source", async () => {
    const d = fresh(platform);
    await dieAt(d, commitReaches("active"));
    expect(phaseOf(d)).toBe("verified");
    const reads = d.storage.valueReads.length;
    const report = await runToRest(await boot(d));
    expect(report.completedPlans[0].rule).toBe("E′11");
    expect(d.storage.valueReads.length).toBeGreaterThan(reads);
  });

  mcase("R34", "a valid D1 record → passes A/A′ ⇒ B4", async () => {
    const d = fresh(platform, { [KEY_UNKNOWN]: "x" });
    const report = await runToRest(await boot(d));
    expect(report.completedPlans).toEqual([{ name: "D1", rule: "PV6" }]);
    expect(report.outcome).toBe("access");
    const record = committedRecord(d);
    expect(record).toMatchObject({ phase: "active", entryKeys: [], manifest: [], copied: [] });
    const beginsBefore = begins(d);
    expect((await (await boot(d)).run()).outcome).toBe("access");
    expect(begins(d)).toBe(beginsBefore);
  });

  mcase("R35", "W and C: the D1 creation unknown, or death during it → no record ⇒ PV6 again; active ⇒ B4", async () => {
    const empty = { [KEY_UNKNOWN]: "x" };
    for (const fault of ["reject_after_effect", "reject_before_effect"] as const) {
      const d = fresh(platform, empty);
      const p = await boot(d, { faults: { onCommit: once(commitReaches("active"), fault, "ok") } });
      await p.run();
      const next = await p.run();
      expect(next.outcome).toBe("access");
      expect(next.completedPlans).toEqual(fault === "reject_after_effect" ? [] : [{ name: "D1", rule: "PV6" }]);
    }
    const d = fresh(platform, empty);
    await dieAt(d, commitReaches("active"));
    expect(d.state.rows.has(RECORD_KEY)).toBe(false);
    expect(firstRule(await (await boot(d)).run())).toBe("PV6");
  });

  mcase("R36", "a valid migrated active record whose live rows no longer match the manifest → B4", async () => {
    const d = fresh(platform);
    await reachActive(d);
    d.state.rows.set(KEY_SESSION, "edited after activation");
    expect((await (await boot(d)).run()).outcome).toBe("access");
  });
});

describe.each(PLATFORMS)("%s — source changes (§5.5)", (platform) => {
  mcase("R39", "marker and ALL eligible keys cleared while enumerating → E′5 BLOCKED — not D1", async () => {
    const d = fresh(platform);
    await reachEnumerating(d);
    d.storage.map.clear();
    expectBlocked(await (await boot(d)).run(), "E′5");
    expect(phaseOf(d)).toBe("enumerating");
  });

  mcase("R40", "marker and SOME eligible keys cleared while enumerating → E′5 BLOCKED", async () => {
    const d = fresh(platform);
    await reachEnumerating(d);
    d.storage.map.delete(KEY_SESSION);
    expectBlocked(await (await boot(d)).run(), "E′5", "entry_key_vanished");
  });

  mcase("R41", "marker and all or some keys cleared, copying with copied = ∅ and with rows → E′7 BLOCKED; never re-enumerated", async () => {
    for (const copied of [0, 2]) {
      for (const all of [true, false]) {
        const d = fresh(platform);
        await reachCopying(d, copied);
        const record = d.state.rows.get(RECORD_KEY);
        if (all) d.storage.map.clear();
        else { d.storage.map.delete(MARKER_KEY); d.storage.map.delete(KEY_SYNC_B); }
        expectBlocked(await (await boot(d)).run(), "E′7", "source_key_missing");
        expect(d.state.rows.get(RECORD_KEY)).toBe(record);
      }
    }
  });

  mcase("R42", "marker removed and one value changed, copying/verified → E′7/E′8 BLOCKED", async () => {
    for (const [setup, rule] of [[(d: Device) => reachCopying(d, 2), "E′7"], [reachVerified, "E′8"]] as const) {
      const d = fresh(platform);
      await setup(d);
      d.storage.map.delete(MARKER_KEY);
      d.storage.map.set(KEY_TRUSTED, "changed");
      expectBlocked(await (await boot(d)).run(), rule, "source_content_diverged");
    }
  });

  mcase("R43", "a new eligible key: while enumerating AP-K1′ includes it; while copying E′7 BLOCKED", async () => {
    const enumerating = fresh(platform);
    await reachEnumerating(enumerating);
    enumerating.storage.map.set(KEY_NEW, "new value");
    const report = await runToRest(await boot(enumerating));
    expect(report.outcome).toBe("access");
    expect(enumerating.state.rows.get(KEY_NEW)).toBe("new value");
    const copying = fresh(platform);
    await reachCopying(copying, 2);
    copying.storage.map.set(KEY_NEW, "new value");
    expectBlocked(await (await boot(copying)).run(), "E′7", "source_key_new");
  });

  mcase("R44", "source cleared and repopulated: identical bytes continue; different content → E′7 BLOCKED", async () => {
    for (const identical of [true, false]) {
      const d = fresh(platform);
      await reachCopying(d, 2);
      const snapshot = d.storage.snapshot();
      d.storage.map.clear();
      for (const [key, value] of Object.entries(snapshot)) d.storage.map.set(key, identical || key !== KEY_SYNC_B ? value : "different");
      const report = await runToRest(await boot(d));
      if (identical) expect(report.outcome).toBe("access");
      else expectBlocked(report, "E′7");
    }
  });

  mcase("R52", "source enumeration fails at D3 entry, during AP-K1′, at validation and before activation → C1 or a halt at the failing step", async () => {
    const entry = fresh(platform);
    entry.storage.faults.lengthThrows = true;
    expectBlocked(await (await boot(entry)).run(), "C1");
    expect(entry.state.rows.size).toBe(0);

    const k1 = fresh(platform);
    await reachEnumerating(k1);
    const p = await boot(k1, {
      faults: { onCommit: (w) => { if (commitReaches("enumerating")(w)) k1.storage.faults.keyThrows = true; return "ok"; } },
    });
    const halted = await p.run();
    expect(halted.outcome === "halted" && halted.plan).toBe("AP-K1′");
    if (halted.outcome === "halted" && halted.halt.kind === "plan_run" && halted.halt.report.status === "halted") {
      expect(halted.halt.report.cause).toBe("read_failed");
    }
    expect(phaseOf(k1)).toBe("enumerating");

    const validation = fresh(platform);
    await reachCopying(validation, 2);
    validation.storage.faults.keyThrows = true;
    expectBlocked(await (await boot(validation)).run(), "C1");

    const activation = fresh(platform);
    await reachVerified(activation);
    // The evaluation reads the marker last; enumeration fails from then on.
    activation.storage.faults.beforeGetItem = (key, storage) => { if (key === MARKER_KEY) storage.faults.keyThrows = true; };
    const report = await (await boot(activation)).run();
    expect(report.outcome === "halted" && report.plan).toBe("AP-ACT");
    expectHaltAt(report, 0, "failed");
    expect(phaseOf(activation)).toBe("verified");
  });

  mcase("R59", "a source value changes after validation, before its checkpoint → I-7 halt before issuing; next E′7 BLOCKED", async () => {
    const d = fresh(platform);
    await reachCopying(d, 0);
    let reads = 0;
    d.storage.faults.beforeGetItem = (key, storage) => {
      // The first read is the evaluation's digest; the second is AP-COPY's own read.
      if (key === FIRST_BATCH[0] && ++reads === 2) storage.map.set(key, "changed before its checkpoint");
    };
    const p = await boot(d);
    const beginsBefore = begins(d);
    const report = await p.run();
    expectHaltAt(report, 1, "failed");
    expect(begins(d)).toBe(beginsBefore);
    expect(committedRecord(d)?.copied).toEqual([]);
    d.storage.faults.beforeGetItem = undefined;
    expectBlocked(await p.run(), "E′7", "source_content_diverged");
  });

  mcase("R63", "an access-barrier key present at D3 entry vanishes before activation → E′5/E′7/E′8 BLOCKED; never activated without it", async () => {
    const source = { ...SOURCE, [KEY_BARRIER]: "barrier bytes" };
    const setups: [(d: Device) => Promise<void>, string][] = [[reachEnumerating, "E′5"], [(d) => reachCopying(d, 2), "E′7"], [reachVerified, "E′8"]];
    for (const [setup, rule] of setups) {
      const d = fresh(platform, source);
      await setup(d);
      d.storage.map.delete(KEY_BARRIER);
      expectBlocked(await (await boot(d)).run(), rule);
      expect(phaseOf(d)).not.toBe("active");
    }
  });

  mcase("R64", "provider credentials present, absent or unreadable in the source → no migration decision changes; their value is never read", async () => {
    const sequences: string[] = [];
    for (const variant of ["present", "absent", "unreadable"] as const) {
      const d = fresh(platform, variant === "absent" ? BASE_SOURCE : SOURCE);
      if (variant === "unreadable") d.storage.faults.getItemThrows = (key) => key === KEY_CREDENTIAL;
      const report = await runToRest(await boot(d));
      expect(report.outcome).toBe("access");
      sequences.push(JSON.stringify(report.completedPlans));
      expect(d.storage.valueReads).not.toContain(KEY_CREDENTIAL);
      expect(d.state.rows.has(KEY_CREDENTIAL)).toBe(false);
      expect([...d.state.rows.values()].join("")).not.toContain(CREDENTIAL_VALUE);
    }
    expect(new Set(sequences).size).toBe(1);
  });
});

describe.each(PLATFORMS)("%s — target failures and activation (Groups A, B)", (platform) => {
  mcase("R53", "target row enumeration fails, with and without a record → PV1/PV9 BLOCKED; never “no rows”", async () => {
    const reject = { onQuery: (sql: string) => ((sql === "SELECT key FROM records ORDER BY key") ? { reject: true as const } : undefined) };
    const without = fresh(platform);
    expectBlocked(await (await boot(without, { faults: reject })).run(), "PV1");
    expect(without.state.rows.size).toBe(0);
    const withRecord = fresh(platform);
    await reachCopying(withRecord, 2);
    expectBlocked(await (await boot(withRecord, { faults: reject })).run(), "PV9");
    // A malformed envelope is the same failure.
    const malformed = fresh(platform);
    const p = await boot(malformed, { faults: { onQuery: (sql) => ((sql === "SELECT key FROM records ORDER BY key") ? { envelope: { values: [{ key: 1 }] } } : undefined) } });
    expectBlocked(await p.run(), "PV1");
  });

  mcase("R54", "a target record unreadable or malformed → A1/A2 BLOCKED", async () => {
    const unreadable = fresh(platform);
    await reachEnumerating(unreadable);
    const p = await boot(unreadable, { faults: { onQuery: (_sql, values) => (values[0] === RECORD_KEY ? { reject: true } : undefined) } });
    expectBlocked(await p.run(), "A1");
    const malformed = fresh(platform);
    await reachEnumerating(malformed);
    malformed.state.rows.set(RECORD_KEY, "{not a record");
    expectBlocked(await (await boot(malformed)).run(), "A2");
    expect(malformed.state.rows.get(RECORD_KEY)).toBe("{not a record");
  });

  mcase("R61", "a valid active target with the source missing, cleared or unreadable and the marker missing, unreadable, malformed or foreign → B4; the marker is never read", async () => {
    const variants: ((d: Device) => void)[] = [
      (d) => d.storage.map.clear(),
      (d) => { d.storage.faults.lengthThrows = true; d.storage.faults.getItemThrows = () => true; },
      (d) => d.storage.map.set(MARKER_KEY, "{malformed"),
      (d) => d.storage.map.set(MARKER_KEY, STORE_FOREIGN),
      (d) => { d.storage.faults.getItemThrows = (key) => key === MARKER_KEY; },
    ];
    for (const vary of variants) {
      const d = fresh(platform);
      await reachActive(d);
      vary(d);
      const reads = d.storage.valueReads.length;
      const report = await (await boot(d)).run();
      expect(report.outcome).toBe("access");
      if (report.outcome === "access") expect(report.retirement).toEqual({ state: "not_evaluated", reason: "source_not_observed" });
      expect(d.storage.valueReads.slice(reads)).not.toContain(MARKER_KEY);
    }
  });

  mcase("R62", "after activation a migrated key removed, changed, or a new key added → B4; no re-import, no restore", async () => {
    const d = fresh(platform);
    const p = await boot(d);
    expect((await runToRest(p)).outcome).toBe("access");
    d.state.rows.delete(KEY_TRUSTED); // sign-out removing trustedDevice
    d.state.rows.set(KEY_SESSION, "changed");
    d.state.rows.set(KEY_NEW, "new key");
    const rows = new Map(d.state.rows);
    // The surviving runner, whose memory is retired at B4, and a relaunch.
    for (const process of [p, await boot(d)]) {
      expect((await process.run()).outcome).toBe("access");
      expect(d.state.rows).toEqual(rows);
    }
  });

  mcase("R77", "no latch and a valid active record; then the L0 read fails → L0a BLOCKED; the source is never consulted", async () => {
    const d = fresh(platform);
    await reachActive(d);
    expect((await (await boot(d)).run()).outcome).toBe("access");
    const lengthReads = d.storage.lengthReads;
    const p = await boot(d, { faults: { onQuery: (_sql, values) => (values[0] === LATCH_KEY ? { reject: true } : undefined) } });
    const report = await p.run();
    expectBlocked(report, "L0a");
    expect(report.outcome === "blocked" && report.retryMayResolve).toBe(true);
    expect(d.storage.lengthReads).toBe(lengthReads);
  });
});

describe.each(PLATFORMS)("%s — relaunches (R56, R57)", (platform) => {
  mcase("R56", "three or more relaunches after every blocked decision → the same outcome, no write to either store, nothing mounted", async () => {
    const blockedStates: [string, () => Promise<Device>][] = [
      ["PV5", async () => fresh(platform, { ...SOURCE, [MARKER_KEY]: STORE_FOREIGN })],
      ["PV12", async () => { const d = fresh(platform); await reachEnumerating(d); d.storage.map.set(MARKER_KEY, STORE_FOREIGN); return d; }],
      ["E′7", async () => { const d = fresh(platform); await reachCopying(d, 2); d.storage.map.set(KEY_SESSION, "x"); return d; }],
      ["A2", async () => { const d = fresh(platform); await reachEnumerating(d); d.state.rows.set(RECORD_KEY, "{"); return d; }],
      ["C1", async () => { const d = fresh(platform); d.storage.faults.lengthThrows = true; return d; }],
    ];
    for (const [rule, make] of blockedStates) {
      const d = await make();
      const rows = new Map(d.state.rows);
      const sourceWrites = d.storage.writes.length;
      const beginsBefore = begins(d);
      for (let launch = 0; launch < 3; launch += 1) {
        const report = await (await boot(d)).run();
        expectBlocked(report, rule);
      }
      expect(d.state.rows).toEqual(rows);
      expect(d.storage.writes.length).toBe(sourceWrites);
      expect(begins(d)).toBe(beginsBefore);
    }
  });

  mcase("R57", "relaunches after every halt, unknown outcome and interruption, discarding plan memory → progress kept, nothing replayed, no duplicate activation, I-12 never decreases", async () => {
    const observed = await relaunchUntilActive(platform);
    // Asserted HERE, outside the bridge callback: the adapter catches anything
    // thrown inside `onCommit` and treats it as a commit failure.
    expect(observed.violations).toEqual([]);
    expect(observed.measureDecreased).toEqual([]);
    expect(observed.faultLaunches).toEqual([]);
    expect(observed.commitsObserved).toBeGreaterThan(5);
    expect(observed.activations).toBeLessThanOrEqual(1);
    expect(observed.final).toBe("access");
    expect(applicationRows(observed.device)).toEqual(ELIGIBLE_ROWS);
  });

  it("R57 negative control: one wrong staged value slipped into a commit is RECORDED and fails the assertion", async () => {
    const observed = await relaunchUntilActive(platform, { sabotage: true });
    expect(observed.violations.length).toBeGreaterThan(0);
    expect(() => expect(observed.violations).toEqual([])).toThrow();
  });
});

/** Every way a COMMIT could replay or lose staged progress, as fixed descriptions. */
function preservationViolations(
  committed: ReadonlyMap<string, string>,
  working: ReadonlyMap<string, string>
): string[] {
  const before = recordIn(committed);
  const after = recordIn(working);
  const violations: string[] = [];
  for (const key of before?.copied ?? []) {
    // No checkpoint is replayed: committed staged rows never change …
    if (working.get(key) !== committed.get(key)) violations.push(`staged row changed: ${key}`);
    // … and a commit never removes progress.
    if (!(after?.copied ?? []).includes(key)) violations.push(`progress removed: ${key}`);
  }
  return violations;
}

interface RelaunchObservations {
  readonly device: Device;
  readonly violations: readonly string[];
  readonly measureDecreased: readonly number[];
  readonly faultLaunches: readonly number[];
  readonly commitsObserved: number;
  readonly activations: number;
  readonly final: string;
}

/**
 * R57's scenario: each launch is a new process that dies, loses an answer or is
 * rejected at its second COMMIT, until the record is active. Inside the bridge
 * hook it only RECORDS; fault injection is separate from observation, and
 * `sabotage` deliberately corrupts one already-staged row in the first COMMIT
 * that follows staged progress — before the observation — for the negative control.
 */
async function relaunchUntilActive(
  platform: PluginPlatform,
  options: { sabotage?: boolean } = {}
): Promise<RelaunchObservations> {
  const d = fresh(platform);
  const rank = { none: 0, enumerating: 1, copying: 2, verified: 3, active: 4 } as const;
  const measure = (): [number, number] => {
    const record = committedRecord(d);
    return [rank[record?.phase ?? "none"], record?.copied?.length ?? 0];
  };
  const faults = ["hang", "reject_after_effect", "reject_before_effect"] as const;
  const violations: string[] = [];
  const measureDecreased: number[] = [];
  const faultLaunches: number[] = [];
  let commitsObserved = 0;
  let activations = 0;
  let sabotaged = false;
  let previous = measure();
  for (let launch = 0; launch < 30 && phaseOf(d) !== "active"; launch += 1) {
    let seen = 0;
    const fault = faults[launch % faults.length];
    const p = await boot(d, {
      faults: {
        onCommit: (working) => {
          commitsObserved += 1;
          const victim = recordIn(d.state.rows)?.copied?.[0];
          if (options.sabotage && !sabotaged && victim !== undefined) {
            sabotaged = true;
            (working as Map<string, string>).set(victim, "SABOTAGED STAGED VALUE");
          }
          violations.push(...preservationViolations(d.state.rows, working));
          const before = recordIn(d.state.rows);
          if (recordIn(working)?.phase === "active" && before?.phase !== "active") activations += 1;
          seen += 1;
          return seen === 2 ? fault : "ok";
        },
      },
    });
    if (fault === "hang") {
      void p.run();
      for (let tick = 0; tick < 50; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0));
    } else if ((await p.run()).outcome === "fault") {
      faultLaunches.push(launch);
    }
    const now = measure();
    if (!(now[0] > previous[0] || (now[0] === previous[0] && now[1] >= previous[1]))) measureDecreased.push(launch);
    previous = now;
  }
  const final = await runToRest(await boot(d));
  return { device: d, violations, measureDecreased, faultLaunches, commitsObserved, activations, final: final.outcome };
}

describe.each(PLATFORMS)("%s — warm recovery and the fault latch (I-11, I-13)", (platform) => {
  /** Each transaction kind, with the setup that reaches it and its COMMIT. */
  const kinds: [string, Readonly<Record<string, string>>, (d: Device) => Promise<void>, (d: Device) => (w: ReadonlyMap<string, string>) => boolean][] = [
    ["D1", { [KEY_UNKNOWN]: "x" }, async () => undefined, () => commitReaches("active")],
    ["AP-D3 creation", SOURCE, async () => undefined, (d) => (w) => commitReaches("enumerating")(w) && !d.state.rows.has(RECORD_KEY)],
    ["AP-K1′ replacement", SOURCE, reachEnumerating, (d) => (w) => commitReaches("enumerating")(w) && d.state.rows.has(RECORD_KEY)],
    ["enumerating → copying", SOURCE, async () => undefined, () => beginCopyingCommit],
    ["checkpoint", SOURCE, async () => undefined, () => checkpointCommit],
    ["AP-CC", SOURCE, async () => undefined, () => commitReaches("verified")],
    ["activation", SOURCE, async () => undefined, (d) => (w) => commitReaches("active")(w) && d.state.rows.has(RECORD_KEY)],
  ];

  /** A lost acknowledgement on each transaction kind; the warm process must reach the cold row. */
  async function warmEqualsCold(fault: "reject_after_effect" | "reject_before_effect"): Promise<void> {
    for (const [label, source, setup, at] of kinds) {
      const d = fresh(platform, source);
      await setup(d);
      const p = await boot(d, { faults: { onCommit: once(at(d), fault, "ok") } });
      const halted = await p.run();
      expect(halted.outcome, label).toBe("halted");
      const cold = await (await boot(cloneDevice(d))).run();
      const warm = await p.run();
      expect(warm.outcome, label).not.toBe("fault");
      expect(firstRule(warm), label).toBe(firstRule(cold));
    }
  }

  mcase("R68", "W: a lost acknowledgement where the reopened state equals the issued after-state — every transaction kind — reaches the cold row; no fault", () =>
    warmEqualsCold("reject_after_effect"));

  mcase("R69", "W: as R68, but the reopened state equals the issued before-state — the cold row; no fault", () =>
    warmEqualsCold("reject_before_effect"));

  mcase("R70", "W: a structurally valid record matching neither, in each phase including activation → fault; nothing mounts; relaunch with the latch ⇒ L0b although B4 would otherwise mount", async () => {
    for (const [label, source, setup, at] of kinds) {
      const d = fresh(platform, source);
      await setup(d);
      const p = await boot(d, { faults: { onCommit: once(at(d), "reject_after_effect", "ok") } });
      await p.run();
      rewriteRecordNeither(d);
      const report = await p.run();
      expectFault(report, "warm_state_matches_neither");
      expect(report.outcome === "fault" && report.latch.established, label).toBe("confirmed");
      expect((await p.run()).outcome, label).toBe("fault");
      expectBlocked(await (await boot(d)).run(), "L0b");
      if (label === "D1" || label === "activation") {
        // Without the latch a cold start would mount: B4 — the stated residual.
        const unlatched = cloneDevice(d);
        unlatched.state.rows.delete(LATCH_KEY);
        expect((await (await boot(unlatched)).run()).outcome, label).toBe("access");
      }
    }
  });

  mcase("R67", "CE5 exactly → warm fault with the latch written; relaunch with the latch ⇒ L0b; relaunch where it is absent ⇒ E′6, the stated residual", async () => {
    const a = KEY_SESSION;
    const b = KEY_SYNC_B;
    const d = fresh(platform, { [a]: BASE_SOURCE[a], [b]: BASE_SOURCE[b] });
    await reachEnumerating(d);
    d.storage.map.set(MARKER_KEY, committedRecord(d)?.storeIdentity as string);
    const p = await boot(d, { faults: { onCommit: once((w) => commitReaches("enumerating")(w) && d.state.rows.has(RECORD_KEY), "reject_after_effect", "ok") } });
    await p.run();
    const record = committedRecord(d);
    if (!record) throw new Error("no record");
    d.state.rows.set(RECORD_KEY, serializeActivationRecord({ ...record, entryKeys: [a] }));
    d.storage.map.delete(b);
    const report = await p.run();
    expectFault(report, "warm_state_matches_neither");
    expect(d.state.rows.has(LATCH_KEY)).toBe(true);
    expectBlocked(await (await boot(d)).run(), "L0b");
    d.state.rows.delete(LATCH_KEY);
    expect(firstRule(await (await boot(d)).run())).toBe("E′6");
  });

  mcase("R71", "W: a step the process saw confirmed is contradicted after a reopen → fault; a cold start reaching the same state blocks at E′2/E′4 without a latch", async () => {
    for (const [mutate, coldRule] of [[(d: Device) => d.state.rows.delete(FIRST_BATCH[0]), "E′2"], [(d: Device) => d.state.rows.set(FIRST_BATCH[0], "different bytes"), "E′4"]] as const) {
      const d = fresh(platform);
      // The first checkpoint is confirmed; the second ends unknown (not committed).
      const p = await boot(d, { faults: { onCommit: once(commitReaches("copying", (w) => (recordIn(w)?.copied?.length ?? 0) > 2), "reject_before_effect", "ok") } });
      await p.run();
      mutate(d);
      const cold = await (await boot(cloneDevice(d))).run();
      expectBlocked(cold, coldRule);
      const report = await p.run();
      expectFault(report, "confirmed_step_contradicted");
      if (report.outcome === "fault") expect(report.findings[0].detail).toEqual([FIRST_BATCH[0]]);
    }
  });

  mcase("R72", "latch write confirmed; then a retry and three relaunches → L0b every time; no write to either store; the latch is never cleared", async () => {
    const d = fresh(platform);
    const p = await boot(d, { faults: { onCommit: once(checkpointCommit, "reject_after_effect", "ok") } });
    await p.run();
    rewriteRecordNeither(d);
    expectFault(await p.run(), "warm_state_matches_neither");
    const latch = d.state.rows.get(LATCH_KEY);
    const beginsBefore = begins(d);
    const sourceWrites = d.storage.writes.length;
    const retry = await p.run();
    expect(retry.outcome).toBe("fault");
    if (retry.outcome === "fault") expect(retry.latch.attempts).toEqual(["confirmed"]);
    for (let launch = 0; launch < 3; launch += 1) expectBlocked(await (await boot(d)).run(), "L0b");
    expect(begins(d)).toBe(beginsBefore);
    expect(d.storage.writes.length).toBe(sourceWrites);
    expect(d.state.rows.get(LATCH_KEY)).toBe(latch);
  });

  mcase("R73", "a latch write rejected, failed or unknown → the process stays latched with only bounded latch retries; relaunch: present ⇒ L0b, unreadable ⇒ L0a, absent ⇒ ordinary cold evaluation", async () => {
    const latchCommit = (w: ReadonlyMap<string, string>) => w.has(LATCH_KEY);
    for (const fault of ["reject_before_effect", "malformed_after_effect"] as const) {
      const d = fresh(platform);
      const p = await boot(d, { faults: { onCommit: once(checkpointCommit, "reject_after_effect", "ok") } });
      await p.run();
      rewriteRecordNeither(d);
      p.faults.onCommit = (w) => (latchCommit(w) ? fault : "ok");
      const statementsBefore = d.state.executed.length;
      const report = await p.run();
      expect(report.outcome).toBe("fault");
      if (report.outcome !== "fault") continue;
      if (fault === "reject_before_effect") {
        expect(report.latch).toEqual({ attempts: ["outcome_unknown", "outcome_unknown", "outcome_unknown"], established: null, attemptsRemain: false });
      } else {
        // The first write landed; the bounded retry finds it present.
        expect(report.latch).toEqual({ attempts: ["outcome_unknown", "confirmed"], established: "already_present", attemptsRemain: false });
      }
      // No ordinary plan step ran: the only writes after the fault were latch inserts.
      const writes = d.state.executed.slice(statementsBefore).map((entry) => entry.requested).filter((sql) => /^(INSERT|UPDATE|DELETE)/.test(sql));
      expect(writes.every((sql) => sql.startsWith("INSERT"))).toBe(true);
      const beginsAfter = begins(d);
      expect((await p.run()).outcome).toBe("fault");
      expect(begins(d)).toBe(beginsAfter);
      if (fault === "reject_before_effect") {
        expect(d.state.rows.has(LATCH_KEY)).toBe(false);
        // Absent ⇒ the ordinary cold evaluation: the undetected residual.
        expect((await (await boot(cloneDevice(d))).run()).outcome).not.toBe("fault");
      } else {
        expectBlocked(await (await boot(d)).run(), "L0b");
      }
      const unreadable = await boot(cloneDevice(d), { faults: { onQuery: (_s, v) => (v[0] === LATCH_KEY ? { reject: true } : undefined) } });
      expectBlocked(await unreadable.run(), "L0a");
    }
  });

  mcase("R74", "process death before or during the latch write → the relaunch reads present, absent or unreadable exactly as R73", async () => {
    for (const when of ["before", "during"] as const) {
      const d = fresh(platform);
      const p = await boot(d, { faults: { onCommit: once(checkpointCommit, "reject_after_effect", "ok") } });
      await p.run();
      rewriteRecordNeither(d);
      if (when === "before") p.faults.onBegin = () => "hang";
      else p.faults.onCommit = (w) => (w.has(LATCH_KEY) ? "hang" : "ok");
      void p.run();
      for (let tick = 0; tick < 50; tick += 1) await new Promise((resolve) => setTimeout(resolve, 0));
      expect(d.state.rows.has(LATCH_KEY)).toBe(false);
      expect((await (await boot(d)).run()).outcome).not.toBe("fault");
      const unreadable = await boot(cloneDevice(d), { faults: { onQuery: (_s, v) => (v[0] === LATCH_KEY ? { reject: true } : undefined) } });
      expectBlocked(await unreadable.run(), "L0a");
    }
  });
});
