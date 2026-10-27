// Regressions for the five confirmed M3b4a review findings (Codex, 2026-10-19).
// Each reproduces the reviewer's counterexample and asserts the corrected outcome
// through the PRODUCTION exports. Logical tests over synthetic data only.
import { describe, expect, it } from "vitest";
import {
  buildFaultLatchContent,
  decideNativeMigration,
  permitsOrdinaryAccess,
  type NativeMigrationDecision,
  type NativeMigrationEvidence,
  type SurvivingPlanEvidence,
} from "../nativeMigrationDecision";
import { summarizePlanRun } from "../nativeMigrationPlanOutcome";
import {
  ABSENT,
  BASE_SOURCE,
  ELIGIBLE_BASE,
  KEY_RESOLUTION,
  KEY_SESSION,
  KEY_SYNC_B,
  KEY_TRUSTED,
  OPTIONS,
  READ_FAILED,
  STORE_A,
  STORE_FOREIGN,
  activeBytes,
  codes,
  copyingBytes,
  d1ActiveBytes,
  decide,
  enumeratingBytes,
  evidenceOf,
  executePlan,
  expectBlocked,
  expectPlan,
  fp,
  isSyntheticFingerprint,
  manifestOf,
  present,
  rawRecord,
  recordBytes,
  verifiedBytes,
  world,
  type World,
} from "./nativeMigrationTestKit";

const rowsOf = (keys: readonly string[]) => Object.fromEntries(keys.map((key) => [key, BASE_SOURCE[key]]));
const SENTINEL = "SYNTHETIC_PRIVATE_VALUE";

describe("finding 1 — warm recovery compares exact row bytes; checkpoints write the bytes they checked", () => {
  // The reviewer's pair: different bytes, one synthetic fingerprint.
  const ISSUED = "0j686fc1krm9cc";
  const OBSERVED = "1w14t770fhxsnq";
  const KEY = KEY_SESSION;
  const source = { [KEY]: ISSUED };
  const before = recordBytes({ phase: "copying", entryKeys: [KEY], manifest: manifestOf(source), copied: [] });
  const after = recordBytes({ phase: "copying", entryKeys: [KEY], manifest: manifestOf(source), copied: [KEY] });
  const surviving: SurvivingPlanEvidence = {
    unknownTransaction: { kind: "checkpoint", recordBefore: before, recordAfter: after, insertedRows: [{ key: KEY, bytes: ISSUED }] },
    confirmedRows: [],
  };
  const w = (rowValue: string) => world({ record: after, rows: { [KEY]: rowValue }, source, marker: STORE_A });

  it("the synthetic fingerprints of the two values collide — so only a byte comparison can tell them apart", () => {
    expect(ISSUED).not.toBe(OBSERVED);
    expect(fp(ISSUED)).toBe(fp(OBSERVED));
  });

  it("different bytes with an equal fingerprint: cold selects E′10, warm detects a fault", () => {
    expectPlan(decide(evidenceOf(w(OBSERVED))), "E′10", "AP-CC");
    const warm = decide(evidenceOf(w(OBSERVED), surviving));
    expect(warm).toMatchObject({ kind: "fault", findings: [{ rule: "I-11", code: "warm_state_matches_neither" }] });
    expect(permitsOrdinaryAccess(warm)).toBe(false);
  });

  it("exactly equal bytes: warm and cold agree, no fault", () => {
    const cold = decide(evidenceOf(w(ISSUED)));
    expect(decide(evidenceOf(w(ISSUED), surviving))).toEqual(cold);
    expectPlan(cold, "E′10", "AP-CC");
  });

  it("missing warm byte evidence is evidence_required; an unreadable row blocks under I-1 — never equality, never a fault", () => {
    const { targetRowValues: _omitted, ...withoutValues } = evidenceOf(w(ISSUED), surviving);
    void _omitted;
    expect(decide(withoutValues)).toMatchObject({ kind: "evidence_required", missing: ["targetRowValues"] });
    const unreadable = decide({ ...evidenceOf(w(ISSUED), surviving), targetRowValues: [{ key: KEY, value: READ_FAILED }] });
    expectBlocked(unreadable, "I-1", "warm_row_bytes_unreadable");
    if (unreadable.kind === "blocked") expect(unreadable.retryMayResolve).toBe(true);
    // A positively absent row is positive evidence: the after-state is impossible.
    expect(decide({ ...evidenceOf(w(ISSUED), surviving), targetRowValues: [{ key: KEY, value: ABSENT }] }).kind).toBe("fault");
  });

  it("a confirmed row whose bytes changed (equal fingerprint) is a contradicted confirmed step", () => {
    const confirmed: SurvivingPlanEvidence = { confirmedRows: [{ key: KEY, bytes: ISSUED }], lastConfirmedRecord: after };
    const d = decide(evidenceOf(w(OBSERVED), confirmed));
    expect(d).toMatchObject({ kind: "fault", findings: [{ rule: "I-13", code: "confirmed_step_contradicted", detail: [KEY] }] });
    expect(decide(evidenceOf(w(ISSUED), confirmed)).kind).toBe("plan");
  });

  it("a source change between the recheck and the checkpoint commits the CHECKED bytes, never the live ones", () => {
    const start = world({ record: copyingBytes([]), marker: STORE_A });
    const plan = expectPlan(decide(evidenceOf(start)), "E′9", "AP-COPY");
    const checkpoint = plan.steps.findIndex((s) => s.kind === "target_transaction");
    const run = executePlan(start, plan, { before: { [checkpoint]: (x) => { (x.source as Record<string, string>)[KEY_RESOLUTION] = "live change"; } } });
    expect(run.report).toMatchObject({ status: "completed" });
    expect(run.world.rows).toEqual(rowsOf([KEY_RESOLUTION, KEY_TRUSTED]));
    expect(run.surviving.confirmedRows).toEqual([
      { key: KEY_RESOLUTION, bytes: BASE_SOURCE[KEY_RESOLUTION] },
      { key: KEY_TRUSTED, bytes: BASE_SOURCE[KEY_TRUSTED] },
    ]);
    // The staged row matches the manifest; the source divergence is caught on its own.
    const next = decide(evidenceOf(run.world));
    expectBlocked(next, "E′7", "source_content_diverged");
    expect(codes(next)).toEqual(["E′7:source_content_diverged"]);
  });

  it("an entry key vanishing between the digest and the membership recheck halts before begin-copying; next E′5", () => {
    const start = world({ record: enumeratingBytes(), marker: STORE_A });
    const plan = expectPlan(decide(evidenceOf(start)), "E′6", "AP-K1′");
    const recheck = plan.steps.findIndex((s) => s.kind === "recheck");
    expect(plan.steps[recheck]).toMatchObject({ check: "entry_keys_present", observes: "fresh_source_enumeration" });
    const run = executePlan(start, plan, { before: { [recheck]: (x) => { delete (x.source as Record<string, string>)[KEY_TRUSTED]; } } });
    expect(run.report).toMatchObject({ status: "halted", haltedAtStep: recheck, cause: "recheck_failed", notIssuedSteps: [recheck + 1] });
    expectBlocked(decide(evidenceOf(run.world)), "E′5", "entry_key_vanished");
  });

  it("the checkpoint descriptor names the step whose bytes it inserts", () => {
    const plan = expectPlan(decide(evidenceOf(world({ record: copyingBytes([]), marker: STORE_A }))), "E′9", "AP-COPY");
    expect(plan.steps).toEqual([
      { kind: "read_source", fresh: true, purpose: "digest_batch", keys: [KEY_RESOLUTION, KEY_TRUSTED] },
      { kind: "recheck", fresh: true, check: "batch_digests_match_manifest", usesStep: 0, observes: "observations_of_step" },
      { kind: "target_transaction", store: "target", transaction: { op: "checkpoint", batch: [KEY_RESOLUTION, KEY_TRUSTED], rowBytesFromStep: 0 } },
    ]);
  });
});

describe("finding 2 — a supplied current target failure prevents B4", () => {
  const healthyButUnreadable = (record: string): NativeMigrationEvidence => ({
    latch: ABSENT,
    record: present(record),
    targetHealth: { status: "healthy" },
    targetRows: { status: "read_failed" },
  });

  it("D1 and migrated active records with a healthy summary but failed row enumeration block at B1", () => {
    for (const record of [d1ActiveBytes(), activeBytes()]) {
      const d = decide(healthyButUnreadable(record));
      expectBlocked(d, "B1", "target_rows_read_failed");
      expect(permitsOrdinaryAccess(d)).toBe(false);
    }
  });

  it("a failed row-value read and a failing summary are both B1, reported together", () => {
    const d = decide({
      ...healthyButUnreadable(activeBytes()),
      targetHealth: { status: "failing" },
      targetRowValues: [{ key: KEY_SESSION, value: READ_FAILED }],
    });
    expect(codes(d)).toEqual(["B1:target_failing", "B1:target_rows_read_failed", "B1:target_row_value_read_failed"]);
  });

  it("warm activation recovery over an unreadable target blocks at B1 instead of mounting", () => {
    const start = world({ record: verifiedBytes(), rows: rowsOf(ELIGIBLE_BASE), marker: STORE_A });
    const plan = expectPlan(decide(evidenceOf(start)), "E′11", "AP-ACT");
    const tx = plan.steps.findIndex((s) => s.kind === "target_transaction");
    const run = executePlan(start, plan, { inject: { [tx]: "lost_ack" } });
    expectBlocked(decide(evidenceOf({ ...run.world, rows: null }, run.surviving)), "B1", "target_rows_read_failed");
    expect(decide(evidenceOf(run.world, run.surviving))).toMatchObject({ kind: "access", rule: "B4" });
  });

  it("legitimate post-activation additions, edits and removals still reach B4; the source is never required", () => {
    const variants: Record<string, string>[] = [{ ...rowsOf(ELIGIBLE_BASE), extra: "added" }, { [KEY_SESSION]: "edited" }, {}];
    for (const rows of variants) {
      expect(decide(evidenceOf(world({ record: activeBytes(), rows, source: null, marker: "READ_FAILED" }))).kind).toBe("access");
    }
  });
});

describe("finding 3 — fault-latch diagnostics never carry untrusted content", () => {
  function faultFor(observed: string): NativeMigrationDecision {
    const before = enumeratingBytes();
    const surviving: SurvivingPlanEvidence = {
      unknownTransaction: { kind: "replace_enumerating", recordBefore: before, recordAfter: enumeratingBytes(ELIGIBLE_BASE, { migrationId: "44444444-4444-4444-8444-444444444444" }), insertedRows: [] },
      confirmedRows: [],
    };
    return decide(evidenceOf(world({ record: observed, marker: STORE_A }), surviving));
  }

  const unsafeObservations: [string, string][] = [
    ["an unexpected field carrying a value", rawRecord({ ...JSON.parse(enumeratingBytes()), note: SENTINEL })],
    ["a field NAMED by the value", rawRecord({ ...JSON.parse(enumeratingBytes()), [SENTINEL]: 1 })],
    ["unparseable bytes", `${SENTINEL}{not json`],
    ["text smuggled into a timestamp", rawRecord({ ...JSON.parse(activeBytes()), activatedAt: `2026-10-20T10:00:00.000Z ${SENTINEL}` })],
  ];

  for (const [label, observed] of unsafeObservations) {
    it(`${label}: the fault still stops migration and the sentinel appears nowhere`, () => {
      const d = faultFor(observed);
      expect(d.kind).toBe("fault");
      if (d.kind !== "fault" || !d.latchPlan) throw new Error("expected a fault with a latch plan");
      expect(d.mountsOrdinaryConsumers).toBe(false);
      expect(JSON.stringify(d)).not.toContain(SENTINEL);
      expect(JSON.parse(d.stop.latchContent).observed.status).toBe("omitted_invalid_metadata");
    });
  }

  it("valid migration metadata is carried in canonical form", () => {
    const observed = enumeratingBytes([KEY_SESSION]);
    const d = faultFor(observed);
    if (d.kind !== "fault") throw new Error("expected a fault");
    expect(JSON.parse(d.stop.latchContent).observed).toEqual({ status: "validated", record: observed });
  });

  it("issued row bytes never reach the latch, and cold diagnostics never echo untrusted record content", () => {
    const content = buildFaultLatchContent({
      cause: "warm_state_matches_neither",
      transactionKind: "checkpoint",
      issuedBefore: `${SENTINEL}`,
      issuedAfter: copyingBytes([KEY_SESSION]),
      observed: undefined,
      isWellFormedFingerprint: isSyntheticFingerprint,
    });
    expect(content).not.toContain(SENTINEL);
    expect(JSON.parse(content)).toMatchObject({ issuedBefore: { status: "omitted_invalid_metadata" }, observed: { status: "unreadable" } });
    const cold = decide(evidenceOf(world({ record: rawRecord({ ...JSON.parse(copyingBytes([])), [SENTINEL]: 1, copied: [SENTINEL] }) })));
    expect(cold.kind).toBe("blocked");
    expect(JSON.stringify(cold)).not.toContain(SENTINEL);
  });
});

describe("finding 4 — every step of every plan has a disposition", () => {
  it("the reviewer's AP-D3 example: an unknown first step leaves the read and recheck not issued too", () => {
    const plan = expectPlan(decide(evidenceOf(world())), "PV7", "AP-D3");
    const report = summarizePlanRun(plan, ["outcome_unknown"]);
    expect(report).toMatchObject({
      status: "halted",
      notIssuedSteps: [1, 2, 3, 4],
      dispositions: ["outcome_unknown", "not_issued", "not_issued", "not_issued", "not_issued"],
      possiblyChangedStores: ["target"],
    });
  });

  const plans: [string, World][] = [
    ["D1", world({ source: {} })],
    ["AP-D3", world()],
    ["AP-K1′", world({ record: enumeratingBytes() })],
    ["AP-COPY", world({ record: copyingBytes([]) })],
    ["AP-CC", world({ record: copyingBytes(ELIGIBLE_BASE), rows: rowsOf(ELIGIBLE_BASE) })],
    ["AP-ACT", world({ record: verifiedBytes(), rows: rowsOf(ELIGIBLE_BASE) })],
  ];

  for (const [name, start] of plans) {
    it(`${name}: a halt at each step accounts for every step, and nothing after the halt ran`, () => {
      const d = decide(evidenceOf(start));
      if (d.kind !== "plan") throw new Error(`expected ${name}`);
      expect(d.plan.name).toBe(name);
      const steps = d.plan.steps;
      for (let halt = 0; halt < steps.length; halt += 1) {
        const prefix = steps.slice(0, halt).map((s) =>
          s.kind === "read_source" ? "succeeded" as const : s.kind === "recheck" ? "passed" as const : "confirmed" as const);
        const step = steps[halt];
        const failures = step.kind === "read_source" || step.kind === "recheck"
          ? (["failed"] as const)
          : step.kind === "target_transaction" && (step.transaction.op === "complete_copying" || step.transaction.op === "activate")
            ? (["outcome_unknown", "aborted_before_write"] as const)
            : (["outcome_unknown"] as const);
        for (const failure of failures) {
          const report = summarizePlanRun(d.plan, [...prefix, failure]);
          if (report.status !== "halted") throw new Error(`${name}@${halt}: ${JSON.stringify(report)}`);
          expect(report.dispositions).toHaveLength(steps.length);
          expect(report.dispositions[halt]).toBe(failure);
          expect(report.notIssuedSteps).toEqual(steps.map((_, i) => i).filter((i) => i > halt));
          expect(report.completedSteps).toEqual(steps.map((_, i) => i).filter((i) => i < halt));
          expect(report.unknownStep).toBe(failure === "outcome_unknown" ? halt : null);
          const writesBefore = steps.slice(0, halt).flatMap((s, i) => (s.kind === "marker_write" || s.kind === "target_transaction" ? [i] : []));
          expect(report.confirmedWriteSteps).toEqual(writesBefore);
          // A read or recheck that ran and failed is reported as failed — never as not issued.
          if (failure === "failed") expect(report.notIssuedSteps).not.toContain(halt);
        }
      }
    });
  }

  it("AP-LATCH: an unknown latch write is reported as unknown, with the target possibly changed", () => {
    const run = executePlan(world({ record: enumeratingBytes(), marker: STORE_A }), {
      name: "AP-LATCH",
      steps: [{ kind: "target_transaction", store: "target", transaction: { op: "write_fault_latch", content: "{}" } }],
      continuation: "re_evaluate",
    }, { inject: { 0: "lost_ack" } });
    expect(run.report).toMatchObject({ status: "halted", unknownStep: 0, dispositions: ["outcome_unknown"], possiblyChangedStores: ["target"] });
  });
});

describe("finding 5 — applicable diagnostics, with each row's full guard", () => {
  it("example A: unreadable target rows do not hide an independently established source divergence", () => {
    const d = decide(evidenceOf(world({
      record: copyingBytes([]),
      rows: null,
      source: { ...BASE_SOURCE, [KEY_SYNC_B]: "changed" },
      marker: STORE_FOREIGN,
    })));
    expectBlocked(d, "PV9");
    expect(codes(d)).toEqual(["PV9:target_rows_read_failed", "PV12:marker_foreign", "E′7:source_content_diverged"]);
  });

  it("example B: rows in a target without a record report PV2 only — PV5 needs an EMPTY target", () => {
    const d = decide(evidenceOf(world({ rows: rowsOf([KEY_SESSION]), marker: STORE_A })));
    expect(codes(d)).toEqual(["PV2:target_rows_without_record"]);
    // Likewise PV3/PV4 are not attached when the target is unreadable or populated.
    expect(codes(decide(evidenceOf(world({ rows: null, marker: "READ_FAILED" }))))).toEqual(["PV1:target_rows_read_failed"]);
    expect(codes(decide(evidenceOf(world({ rows: rowsOf([KEY_SESSION]), marker: "bad" }))))).toEqual(["PV2:target_rows_without_record"]);
  });

  it("C1 governs, and the provenance and staging failures it does not depend on are reported with it", () => {
    const d = decide(evidenceOf(world({ record: copyingBytes([KEY_SESSION]), rows: {}, source: null, marker: STORE_FOREIGN })));
    expectBlocked(d, "C1");
    expect(codes(d)).toEqual(["C1:source_enumeration_failed", "PV12:marker_foreign", "E′2:copied_without_row"]);
    const enumerating = decide(evidenceOf(world({ record: enumeratingBytes(), rows: { [KEY_SESSION]: "x" }, source: null })));
    expect(codes(enumerating)).toEqual(["C1:source_enumeration_failed", "E′1:rows_while_enumerating"]);
  });

  it("early-return boundaries invent nothing: a latch hides the record, an invalid record hides the table, active access ignores the source", () => {
    expect(codes(decide(evidenceOf(world({ latch: "x", record: "{bad", rows: null, source: null }))))).toEqual(["L0b:latch_present"]);
    expect(codes(decide(evidenceOf(world({ record: "{bad", rows: null, source: null, marker: STORE_FOREIGN }))))).toEqual(["A2:record_unparseable"]);
    expect(decide(evidenceOf(world({ record: activeBytes(), source: null, marker: STORE_FOREIGN }))).kind).toBe("access");
  });

  it("decisions are unchanged by evaluation order and remain frozen", () => {
    const e = evidenceOf(world({ record: copyingBytes([]), rows: null, source: { ...BASE_SOURCE, [KEY_SYNC_B]: "changed" }, marker: STORE_FOREIGN }));
    expect(decideNativeMigration(e, OPTIONS)).toEqual(decideNativeMigration(structuredClone(e), OPTIONS));
  });
});
