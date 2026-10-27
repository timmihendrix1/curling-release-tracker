// Class-L tests for recovery (I-9, I-11, I-12, I-13) in the M3b4a decision layer:
// warm versus cold evaluation, the detected-fault stop and latch, and finite
// synthetic traces. A trace drives the PRODUCTION decision with a mechanical
// executor (`executePlan`) that only applies modeled outcomes; every expected row
// is the specification's, not a value the code produced for itself. Logical
// evidence only — no atomicity, durability or device claim.
import { describe, expect, it } from "vitest";
import {
  decideNativeMigration,
  permitsOrdinaryAccess,
  type NativeMigrationDecision,
  type SurvivingPlanEvidence,
} from "../nativeMigrationDecision";
import { recordLatchWriteAttempt } from "../nativeMigrationPlanOutcome";
import {
  BASE_SOURCE,
  ELIGIBLE_BASE,
  codes,
  KEY_RESOLUTION,
  KEY_SESSION,
  KEY_SYNC_B,
  KEY_TRUSTED,
  MIG_2,
  OPTIONS,
  STORE_A,
  copyingBytes,
  decide,
  enumeratingBytes,
  evidenceOf,
  executePlan,
  expectBlocked,
  expectPlan,
  fp,
  parsed,
  progressOf,
  recordBytes,
  verifiedBytes,
  world,
  type Execution,
  type Injection,
  type World,
} from "./nativeMigrationTestKit";

const rcase = (id: string, title: string, fn: () => void) => it(`${id}: ${title}`, fn);
const rowsOf = (keys: readonly string[]) => Object.fromEntries(keys.map((key) => [key, BASE_SOURCE[key]]));

/** Runs the plan the decision chose, with one injection at the plan's FIRST target transaction. */
function runWith(start: World, injection: Injection, onTx: (op: string) => boolean = () => true): Execution {
  const d = decide(evidenceOf(start));
  if (d.kind !== "plan") throw new Error(`expected a plan, got ${JSON.stringify(d)}`);
  const index = d.plan.steps.findIndex((s) => s.kind === "target_transaction" && onTx(s.transaction.op));
  return executePlan(start, d.plan, { inject: { [index]: injection } });
}

/** The cold and warm decisions for the world an execution left behind. */
function coldAndWarm(run: Execution): [NativeMigrationDecision, NativeMigrationDecision] {
  return [decide(evidenceOf(run.world)), decide(evidenceOf(run.world, run.surviving))];
}

function ruleOf(d: NativeMigrationDecision): string {
  return d.kind === "plan" || d.kind === "blocked" || d.kind === "access" || d.kind === "fault" ? d.rule : d.kind;
}

describe("AP-D3 and AP-K1′ recovery", () => {
  rcase("R1", "cold: death after the AP-D3 record commit, before the marker write → PV14 → E′6 with the same storeIdentity", () => {
    const plan = expectPlan(decide(evidenceOf(world())), "PV7", "AP-D3");
    const run = executePlan(world(), plan, { dieBeforeStep: 1 });
    expect(run.report).toBeNull();
    expect(run.world.marker).toBeNull();
    const created = parsed(run.world.record as string);
    const next = expectPlan(decide(evidenceOf(run.world)), "E′6", "AP-K1′");
    expect(next.steps[0]).toEqual({ kind: "marker_write", store: "source", storeIdentity: { existing: created.storeIdentity } });
  });

  rcase("R3", "warm: the AP-D3 record commit's acknowledgement lost → halt, no marker; committed ⇒ E′6, not committed ⇒ PV7; no fault", () => {
    const committed = runWith(world(), "lost_ack");
    expect(committed.report).toMatchObject({ status: "halted", unknownStep: 0, notIssuedSteps: [1, 2, 3, 4] });
    expect(committed.world.marker).toBeNull();
    const notCommitted = runWith(world(), "not_committed_unknown");
    const [, warmCommitted] = coldAndWarm(committed);
    const [, warmNot] = coldAndWarm(notCommitted);
    expect(ruleOf(warmCommitted)).toBe("E′6");
    expect(ruleOf(warmNot)).toBe("PV7");
  });

  rcase("R4", "cold: the durable states of R3 without plan memory reach the same rows", () => {
    expect(ruleOf(decide(evidenceOf(runWith(world(), "lost_ack").world)))).toBe("E′6");
    const fresh = decide(evidenceOf(runWith(world(), "not_committed_unknown").world));
    expectPlan(fresh, "PV7", "AP-D3"); // a NEW attempt: its ids are generated afresh, not reconstructed
  });

  rcase("R5", "warm and cold: AP-K1′'s replacement outcome unknown leaves the old or new record; either ⇒ E′5/E′6", () => {
    const start = world({ record: enumeratingBytes(), marker: STORE_A });
    for (const injection of ["lost_ack", "not_committed_unknown"] as const) {
      const run = runWith(start, injection);
      const [cold, warm] = coldAndWarm(run);
      expect(ruleOf(cold)).toBe("E′6");
      expect(warm).toEqual(cold);
    }
  });

  rcase("R6", "warm: the reopened record has the issued new migrationId but differs elsewhere ⇒ detected fault, even though A′ and E′5 pass", () => {
    const start = world({ record: enumeratingBytes(), marker: STORE_A });
    const run = runWith(start, "lost_ack");
    const issued = run.surviving.unknownTransaction!;
    const reopened = parsed(issued.recordAfter);
    const mutated = recordBytes({ ...reopened, entryKeys: [KEY_SESSION, KEY_SYNC_B, KEY_TRUSTED] });
    const w = { ...run.world, record: mutated };
    const warm = decide(evidenceOf(w, run.surviving));
    expect(warm.kind).toBe("fault");
    if (warm.kind !== "fault") return;
    expect(warm.findings).toEqual([{ rule: "I-11", code: "warm_state_matches_neither" }]);
    expect(warm.latchPlan?.name).toBe("AP-LATCH");
    expect(warm.mountsOrdinaryConsumers).toBe(false);
    // The observed record is valid migration metadata, so its canonical form is carried.
    expect(JSON.parse(warm.stop.latchContent)).toMatchObject({
      cause: "warm_state_matches_neither", transactionKind: "replace_enumerating", phase: "enumerating",
      observed: { status: "validated", record: mutated },
    });
  });

  rcase("R7", "cold: the durable state of R6 with no plan memory and no latch is decided by the table — the undetected residual", () => {
    const run = runWith(world({ record: enumeratingBytes(), marker: STORE_A }), "lost_ack");
    const mutated = recordBytes({ ...parsed(run.surviving.unknownTransaction!.recordAfter), entryKeys: [KEY_SESSION, KEY_SYNC_B, KEY_TRUSTED] });
    expectPlan(decide(evidenceOf({ ...run.world, record: mutated })), "E′6", "AP-K1′");
  });

  rcase("R67", "CE5 exactly: issued {a,b}, reopened new id with {a}, source {a} ⇒ warm fault; relaunch with latch L0b; latch absent ⇒ E′6 residual", () => {
    const a = KEY_SESSION;
    const b = KEY_SYNC_B;
    const before = enumeratingBytes([a, b]);
    const after = enumeratingBytes([a, b], { migrationId: MIG_2 });
    const observed = enumeratingBytes([a], { migrationId: MIG_2 });
    const surviving: SurvivingPlanEvidence = {
      unknownTransaction: { kind: "replace_enumerating", recordBefore: before, recordAfter: after, insertedRows: [] },
      confirmedRows: [],
    };
    const w = world({ record: observed, source: { [a]: BASE_SOURCE[a] }, marker: STORE_A });
    const warm = decide(evidenceOf(w, surviving));
    expect(warm.kind).toBe("fault");
    if (warm.kind !== "fault" || !warm.latchPlan) throw new Error("expected a latch plan");
    // The latch write is the only permitted step; then relaunch.
    const latched = executePlan(w, warm.latchPlan);
    expect(latched.report).toMatchObject({ status: "completed" });
    expectBlocked(decide(evidenceOf(latched.world)), "L0b", "latch_present");
    // Had the latch not persisted, a cold start cannot know: the table selects E′6.
    expectPlan(decide(evidenceOf(w)), "E′6", "AP-K1′");
  });
});

describe("copying, completion and activation recovery", () => {
  rcase("R13", "warm and cold: the enumerating → copying commit lost or interrupted ⇒ enumerating (E′6) or copying with copied = ∅ (E′9)", () => {
    const start = world({ record: enumeratingBytes(), marker: STORE_A });
    const k1 = expectPlan(decide(evidenceOf(start)), "E′6", "AP-K1′");
    const begin = k1.steps.findIndex((s) => s.kind === "target_transaction" && s.transaction.op === "begin_copying");
    for (const [injection, rule] of [["lost_ack", "E′9"], ["not_committed_unknown", "E′6"]] as const) {
      const run = executePlan(start, k1, { inject: { [begin]: injection } });
      const [cold, warm] = coldAndWarm(run);
      expect(ruleOf(cold)).toBe(rule);
      expect(warm).toEqual(cold);
    }
    const died = executePlan(start, k1, { dieBeforeStep: begin });
    expect(ruleOf(decide(evidenceOf(died.world)))).toBe("E′6");
  });

  rcase("R14", "warm: a checkpoint committed with its acknowledgement lost ⇒ the next decision never chooses that batch again", () => {
    const start = world({ record: copyingBytes([]), marker: STORE_A });
    const run = runWith(start, "lost_ack", (op) => op === "checkpoint");
    expect(run.committedBatches).toEqual([[KEY_RESOLUTION, KEY_TRUSTED]]);
    const [, warm] = coldAndWarm(run);
    const plan = expectPlan(warm, "E′9", "AP-COPY");
    const batch = plan.steps.find((s) => s.kind === "target_transaction");
    expect(batch).toMatchObject({ transaction: { batch: [KEY_SESSION, KEY_SYNC_B] } });
  });

  rcase("R15", "cold: death after a checkpoint commit ⇒ as R14, without plan memory", () => {
    const start = world({ record: copyingBytes([]), marker: STORE_A });
    const run = runWith(start, "lost_ack", (op) => op === "checkpoint");
    const plan = expectPlan(decide(evidenceOf(run.world)), "E′9", "AP-COPY");
    expect(plan.steps.find((s) => s.kind === "target_transaction")).toMatchObject({ transaction: { batch: [KEY_SESSION, KEY_SYNC_B] } });
  });

  rcase("R16", "cold: death during a checkpoint before commit ⇒ previous copied and rows; E′9 chooses those keys afresh (nothing replayed)", () => {
    const start = world({ record: copyingBytes([]), marker: STORE_A });
    const run = runWith(start, "not_committed_unknown", (op) => op === "checkpoint");
    expect(run.committedBatches).toEqual([]);
    expect(run.world.record).toBe(start.record);
    const plan = expectPlan(decide(evidenceOf(run.world)), "E′9", "AP-COPY");
    expect(plan.steps.find((s) => s.kind === "target_transaction")).toMatchObject({ transaction: { batch: [KEY_RESOLUTION, KEY_TRUSTED] } });
  });

  rcase("R19", "CE4: copying with manifest = copied = target, all matching ⇒ E′10 → AP-CC → AP-ACT → B4", () => {
    let w = world({ record: copyingBytes(ELIGIBLE_BASE), rows: rowsOf(ELIGIBLE_BASE), marker: STORE_A });
    const cc = expectPlan(decide(evidenceOf(w)), "E′10", "AP-CC");
    w = executePlan(w, cc).world;
    const act = expectPlan(decide(evidenceOf(w)), "E′11", "AP-ACT");
    w = executePlan(w, act).world;
    const access = decide(evidenceOf(w));
    expect(access).toMatchObject({ kind: "access", rule: "B4" });
  });

  rcase("R20", "warm: the AP-CC commit's acknowledgement lost ⇒ verified ⇒ E′11; not committed ⇒ E′10", () => {
    const start = world({ record: copyingBytes(ELIGIBLE_BASE), rows: rowsOf(ELIGIBLE_BASE), marker: STORE_A });
    expect(ruleOf(coldAndWarm(runWith(start, "lost_ack"))[1])).toBe("E′11");
    expect(ruleOf(coldAndWarm(runWith(start, "not_committed_unknown"))[1])).toBe("E′10");
  });

  rcase("R21", "cold: death after the AP-CC commit ⇒ E′11, whose AP-ACT re-reads the evidence", () => {
    const start = world({ record: copyingBytes(ELIGIBLE_BASE), rows: rowsOf(ELIGIBLE_BASE), marker: STORE_A });
    const act = expectPlan(decide(evidenceOf(runWith(start, "lost_ack").world)), "E′11", "AP-ACT");
    expect(act.steps.at(-1)).toMatchObject({ transaction: { op: "activate", readsInside: "complete_target_evidence" } });
  });

  rcase("R22", "cold: death during AP-CC before commit ⇒ E′10 again; never an empty checkpoint", () => {
    const start = world({ record: copyingBytes(ELIGIBLE_BASE), rows: rowsOf(ELIGIBLE_BASE), marker: STORE_A });
    const plan = expectPlan(decide(evidenceOf(runWith(start, "not_committed_unknown").world)), "E′10", "AP-CC");
    expect(plan.steps.some((s) => s.kind === "target_transaction" && s.transaction.op === "checkpoint")).toBe(false);
  });

  rcase("R28", "warm: the activation commit's acknowledgement lost ⇒ active ⇒ B4, never re-activated; not committed ⇒ E′11", () => {
    const start = world({ record: verifiedBytes(), rows: rowsOf(ELIGIBLE_BASE), marker: STORE_A });
    const committed = coldAndWarm(runWith(start, "lost_ack"))[1];
    expect(committed).toMatchObject({ kind: "access", rule: "B4" });
    expect(ruleOf(coldAndWarm(runWith(start, "not_committed_unknown"))[1])).toBe("E′11");
  });

  rcase("R29", "cold: death after the activation commit with the source and marker gone ⇒ B4 without consulting either", () => {
    const start = world({ record: verifiedBytes(), rows: rowsOf(ELIGIBLE_BASE), marker: STORE_A });
    const run = runWith(start, "lost_ack");
    const d = decide(evidenceOf({ ...run.world, source: null, marker: "READ_FAILED" }));
    expect(d).toMatchObject({ kind: "access", rule: "B4" });
  });

  rcase("R30", "cold: death during activation before commit ⇒ E′11 re-validates", () => {
    const start = world({ record: verifiedBytes(), rows: rowsOf(ELIGIBLE_BASE), marker: STORE_A });
    expectPlan(decide(evidenceOf(runWith(start, "not_committed_unknown").world)), "E′11", "AP-ACT");
  });

  rcase("R35", "warm and cold: the D1 creation's outcome unknown or interrupted ⇒ no record ⇒ PV6 again; active ⇒ B4", () => {
    const empty = world({ source: {} });
    const committed = runWith(empty, "lost_ack");
    const lost = runWith(empty, "not_committed_unknown");
    for (const d of coldAndWarm(committed)) expect(d).toMatchObject({ kind: "access", rule: "B4" });
    for (const d of coldAndWarm(lost)) expect(ruleOf(d)).toBe("PV6");
  });
});

/** Every transaction kind, the world before it, and the injection that leaves it committed or not. */
function transactionCases(): { label: string; start: World; op: string }[] {
  return [
    { label: "D1", start: world({ source: {} }), op: "create_fresh_active" },
    { label: "AP-D3 creation", start: world(), op: "create_enumerating" },
    { label: "AP-K1′ replacement", start: world({ record: enumeratingBytes(), marker: STORE_A }), op: "replace_enumerating" },
    { label: "enumerating → copying", start: world({ record: enumeratingBytes(), marker: STORE_A }), op: "begin_copying" },
    { label: "checkpoint", start: world({ record: copyingBytes([KEY_SESSION]), rows: rowsOf([KEY_SESSION]), marker: STORE_A }), op: "checkpoint" },
    { label: "AP-CC", start: world({ record: copyingBytes(ELIGIBLE_BASE), rows: rowsOf(ELIGIBLE_BASE), marker: STORE_A }), op: "complete_copying" },
    { label: "activation", start: world({ record: verifiedBytes(), rows: rowsOf(ELIGIBLE_BASE), marker: STORE_A }), op: "activate" },
  ];
}

describe("warm versus cold (I-11) and detected faults (I-13)", () => {
  rcase("R68", "warm: a lost acknowledgement where the reopened state equals the issued after-state ⇒ the cold row, no fault", () => {
    for (const { label, start, op } of transactionCases()) {
      const run = runWith(start, "lost_ack", (o) => o === op);
      const [cold, warm] = coldAndWarm(run);
      expect(warm, label).toEqual(cold);
      expect(warm.kind, label).not.toBe("fault");
    }
  });

  rcase("R69", "warm: the reopened state equals the issued before-state ⇒ the cold row, no fault", () => {
    for (const { label, start, op } of transactionCases()) {
      const run = runWith(start, "not_committed_unknown", (o) => o === op);
      const [cold, warm] = coldAndWarm(run);
      expect(warm, label).toEqual(cold);
      expect(warm.kind, label).not.toBe("fault");
    }
  });

  rcase("R70", "warm: a structurally valid record matching neither, in each phase including activation ⇒ fault; relaunch with latch ⇒ L0b", () => {
    for (const { label, start, op } of transactionCases()) {
      const run = runWith(start, "lost_ack", (o) => o === op);
      const after = parsed(run.surviving.unknownTransaction!.recordAfter);
      // A valid record that is neither: the same after-state under a different, canonical migration id.
      const neither = recordBytes({ ...after, migrationId: MIG_2 });
      const w = { ...run.world, record: neither };
      const warm = decide(evidenceOf(w, run.surviving));
      expect(warm.kind, label).toBe("fault");
      if (warm.kind !== "fault" || !warm.latchPlan) throw new Error(label);
      expect(permitsOrdinaryAccess(warm)).toBe(false);
      const latched = executePlan(w, warm.latchPlan).world;
      expectBlocked(decide(evidenceOf(latched)), "L0b");
    }
  });

  rcase("R71", "warm: a step the process saw confirmed is contradicted after a reopen ⇒ fault; cold blocks at E′2/E′4 without a latch", () => {
    const start = world({ record: copyingBytes([]), marker: STORE_A });
    const plan = expectPlan(decide(evidenceOf(start)), "E′9", "AP-COPY");
    const run = executePlan(start, plan);
    expect(run.report).toMatchObject({ status: "completed" });
    for (const [mutate, coldRule] of [
      [(rows: Record<string, string>) => { delete rows[KEY_RESOLUTION]; }, "E′2"],
      [(rows: Record<string, string>) => { rows[KEY_RESOLUTION] = "different"; }, "E′4"],
    ] as const) {
      const w: World = structuredClone(run.world);
      mutate(w.rows as Record<string, string>);
      const warm = decide(evidenceOf(w, run.surviving));
      expect(warm).toMatchObject({ kind: "fault", findings: [{ rule: "I-13", code: "confirmed_step_contradicted", detail: [KEY_RESOLUTION] }] });
      expectBlocked(decide(evidenceOf(w)), coldRule);
    }
  });

  rcase("R58", "every durable state of the recovery tables: cold and warm-before/after agree; warm-neither is a fault whatever the table selects", () => {
    for (const { label, start, op } of transactionCases()) {
      for (const injection of ["lost_ack", "not_committed_unknown"] as const) {
        const run = runWith(start, injection, (o) => o === op);
        const [cold, warm] = coldAndWarm(run);
        expect(warm, `${label}/${injection}`).toEqual(cold);
      }
      const run = runWith(start, "lost_ack", (o) => o === op);
      const neither = recordBytes({ ...parsed(run.surviving.unknownTransaction!.recordAfter), migrationId: MIG_2 });
      const cold = decide(evidenceOf({ ...run.world, record: neither }));
      expect(cold.kind, label).not.toBe("fault");
      expect(decide(evidenceOf({ ...run.world, record: neither }, run.surviving)).kind, label).toBe("fault");
    }
  });

  it("byte identity, not structural similarity: the same fields in a different key order are 'neither'", () => {
    const run = runWith(world({ record: enumeratingBytes(), marker: STORE_A }), "lost_ack");
    const after = run.surviving.unknownTransaction!.recordAfter;
    const reordered = JSON.stringify(Object.fromEntries(Object.entries(JSON.parse(after)).reverse()));
    expect(reordered).not.toBe(after);
    expect(JSON.parse(reordered)).toEqual(JSON.parse(after));
    expect(decide(evidenceOf({ ...run.world, record: reordered }, run.surviving)).kind).toBe("fault");
  });

  it("a read failure is never a detected fault: an unreadable record or rows fall through to the table", () => {
    const run = runWith(world({ record: enumeratingBytes(), marker: STORE_A }), "lost_ack");
    expectBlocked(decide(evidenceOf({ ...run.world, record: "READ_FAILED" }, run.surviving)), "A1");
    // Unreadable issued rows are neither equality nor a fault. The table's own durable stop (PV9)
    // governs; the unreadable warm rows are reported alongside it.
    const rowsUnreadable = runWith(world({ record: copyingBytes([]), marker: STORE_A }), "lost_ack", (op) => op === "checkpoint");
    const d = decide(evidenceOf({ ...rowsUnreadable.world, rows: null }, rowsUnreadable.surviving));
    expectBlocked(d, "PV9", "target_rows_read_failed");
    expect(codes(d)).toEqual(["PV9:target_rows_read_failed", "I-1:warm_row_bytes_unreadable"]);
  });

  rcase("R72", "a confirmed latch write, then a retry and three relaunches ⇒ L0b every time; nothing written, nothing mounted", () => {
    const run = runWith(world({ record: enumeratingBytes(), marker: STORE_A }), "lost_ack");
    const w = { ...run.world, record: enumeratingBytes(ELIGIBLE_BASE, { migrationId: MIG_2 }) };
    const fault = decide(evidenceOf(w, run.surviving));
    if (fault.kind !== "fault" || !fault.latchPlan) throw new Error("expected fault");
    const latched = executePlan(w, fault.latchPlan);
    const stop = recordLatchWriteAttempt(fault.stop, "confirmed");
    // In process: the stop holds and no further latch write is offered.
    expect(decideNativeMigration({ ...evidenceOf(latched.world), inProcessFault: stop }, OPTIONS)).toMatchObject({ kind: "fault", latchPlan: null });
    for (let relaunch = 0; relaunch < 4; relaunch += 1) {
      const d = decide(evidenceOf(latched.world));
      expectBlocked(d, "L0b");
      expect(d.mountsOrdinaryConsumers).toBe(false);
    }
  });

  rcase("R73", "a latch write rejected, failed or unknown: the in-memory stop holds with bounded retries; relaunch reads present, unreadable or absent", () => {
    const run = runWith(world({ record: enumeratingBytes(), marker: STORE_A }), "lost_ack");
    const w = { ...run.world, record: enumeratingBytes(ELIGIBLE_BASE, { migrationId: MIG_2 }) };
    const first = decide(evidenceOf(w, run.surviving));
    if (first.kind !== "fault") throw new Error("expected fault");
    let stop = first.stop;
    const offered: boolean[] = [];
    for (let attempt = 0; attempt < OPTIONS.latchWriteAttemptLimit + 1; attempt += 1) {
      const d = decideNativeMigration({ ...evidenceOf(w), inProcessFault: stop }, OPTIONS);
      expect(d.kind).toBe("fault");
      if (d.kind !== "fault") return;
      // Only the latch write is ever offered — never a migration plan.
      offered.push(d.latchPlan !== null);
      if (d.latchPlan) {
        expect(d.latchPlan.steps).toHaveLength(1);
        expect(d.latchPlan.steps[0]).toMatchObject({ transaction: { op: "write_fault_latch" } });
      }
      stop = recordLatchWriteAttempt(stop, "outcome_unknown");
    }
    expect(offered).toEqual([true, true, true, false]);
    // Relaunch after a rejected (not applied) latch write.
    const rejected = executePlan(w, first.latchPlan!, { inject: { 0: "reject_before_apply" } });
    expect(rejected.report).toMatchObject({ status: "halted", unknownStep: 0 });
    expectPlan(decide(evidenceOf(rejected.world)), "E′6", "AP-K1′"); // positively absent: the undetected residual
    const applied = executePlan(w, first.latchPlan!, { inject: { 0: "apply_then_reject" } });
    expectBlocked(decide(evidenceOf(applied.world)), "L0b");
    expectBlocked(decide(evidenceOf({ ...applied.world, latch: "READ_FAILED" })), "L0a");
  });

  rcase("R74", "process death before or during the latch write: the relaunch reads present, absent or unreadable exactly as R73", () => {
    const run = runWith(world({ record: enumeratingBytes(), marker: STORE_A }), "lost_ack");
    const w = { ...run.world, record: enumeratingBytes(ELIGIBLE_BASE, { migrationId: MIG_2 }) };
    const fault = decide(evidenceOf(w, run.surviving));
    if (fault.kind !== "fault" || !fault.latchPlan) throw new Error("expected fault");
    const diedBefore = executePlan(w, fault.latchPlan, { dieBeforeStep: 0 });
    expect(diedBefore.report).toBeNull();
    expectPlan(decide(evidenceOf(diedBefore.world)), "E′6", "AP-K1′");
    const diedDuring = executePlan(w, fault.latchPlan, { inject: { 0: "lost_ack" } });
    expectBlocked(decide(evidenceOf(diedDuring.world)), "L0b");
    expectBlocked(decide(evidenceOf({ ...diedDuring.world, latch: "READ_FAILED" })), "L0a");
  });

  it("the latch content carries record metadata only — never an application value or a credential", () => {
    const start = world({ record: copyingBytes([]), marker: STORE_A });
    const run = runWith(start, "lost_ack", (op) => op === "checkpoint");
    const w: World = { ...run.world, record: copyingBytes([KEY_SESSION]) };
    const fault = decide(evidenceOf(w, run.surviving));
    if (fault.kind !== "fault") throw new Error("expected fault");
    for (const value of Object.values(BASE_SOURCE)) expect(fault.stop.latchContent).not.toContain(value);
  });
});

describe("finite synthetic traces (I-12)", () => {
  /** Drives the production decision to completion, with interruptions, discarding plan memory each round. */
  function trace(start: World, interrupt: (round: number) => Injection | "die" | null) {
    let w = start;
    const progress: [number, number][] = [progressOf(w)];
    const committed: string[] = [];
    const decisions: string[] = [];
    for (let round = 0; round < 40; round += 1) {
      const d = decide(evidenceOf(w));
      decisions.push(ruleOf(d));
      if (d.kind === "access") return { w, progress, committed, decisions, final: d };
      if (d.kind !== "plan") return { w, progress, committed, decisions, final: d };
      expect(d.mountsOrdinaryConsumers).toBe(false);
      const mode = interrupt(round);
      const txIndex = d.plan.steps.findIndex((s) => s.kind === "target_transaction");
      const run = mode === "die"
        ? executePlan(w, d.plan, { dieBeforeStep: txIndex })
        : executePlan(w, d.plan, mode ? { inject: { [txIndex]: mode } } : {});
      committed.push(...run.committedBatches.flat());
      w = run.world;
      progress.push(progressOf(w));
    }
    throw new Error(`no completion: ${decisions.join(" → ")}`);
  }

  rcase("R57", "three or more relaunches after every halt and interruption keep committed progress, never replay a checkpoint and never mount early", () => {
    const schedules: ((round: number) => Injection | "die" | null)[] = [
      () => null,
      (r) => (r % 2 === 0 ? "lost_ack" : null),
      (r) => (r % 3 === 1 ? "not_committed_unknown" : null),
      (r) => (r % 2 === 1 ? "die" : null),
      (r) => (["lost_ack", "die", "not_committed_unknown", null] as const)[r % 4],
    ];
    for (const schedule of schedules) {
      const result = trace(world(), schedule);
      expect(result.final).toMatchObject({ kind: "access", rule: "B4" });
      // No checkpoint key was ever committed twice.
      expect(new Set(result.committed).size).toBe(result.committed.length);
      expect([...result.committed].sort()).toEqual(ELIGIBLE_BASE);
      // The I-12 measure never decreases.
      for (let i = 1; i < result.progress.length; i += 1) {
        const [pr, pc] = result.progress[i - 1];
        const [cr, cc] = result.progress[i];
        expect(cr > pr || (cr === pr && cc >= pc), result.decisions.join(" → ")).toBe(true);
      }
      // Access appears only at the very end.
      expect(result.decisions.slice(0, -1)).not.toContain("B4");
    }
  });

  it("an uninterrupted fresh migration passes AP-D3, AP-COPY (non-empty batches), AP-CC and AP-ACT to B4 and stops", () => {
    const result = trace(world(), () => null);
    expect(result.decisions).toEqual(["PV7", "E′9", "E′9", "E′10", "E′11", "B4"]);
    expect(fp("x").startsWith("synthetic-fp:")).toBe(true); // the fingerprints in these traces are synthetic labels
  });
});
