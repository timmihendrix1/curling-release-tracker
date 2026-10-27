// Combination tests for warm-evidence precedence in the M3b4a decision layer
// (docs/MOBILE_APP_MIGRATION.md Stage M3b0 §5.1, I-10/I-11/I-13 and L0):
//   A. evidence that already proves a fault is never lost behind an unrelated omission;
//   B. incomplete or unreadable warm evidence never overrides an established L0 stop;
//   C. unknown snapshot fields are rejected without echoing their names or values.
// Logical tests over synthetic data only.
import { describe, expect, it } from "vitest";
import {
  decideNativeMigration,
  permitsOrdinaryAccess,
  type NativeMigrationDecision,
  type NativeMigrationEvidence,
  type RowValueObservation,
  type StoredValueObservation,
  type SurvivingPlanEvidence,
} from "../nativeMigrationDecision";
import {
  ABSENT,
  BASE_SOURCE,
  ELIGIBLE_BASE,
  KEY_SESSION,
  KEY_TRUSTED,
  MIG_2,
  OPTIONS,
  READ_FAILED,
  STORE_A,
  activeBytes,
  codes,
  copyingBytes,
  d1ActiveBytes,
  decide,
  enumeratingBytes,
  evidenceOf,
  listing,
  present,
  verifiedBytes,
  world,
} from "./nativeMigrationTestKit";

const SENTINEL = "SYNTHETIC_PRIVATE_VALUE";
const rowsOf = (keys: readonly string[]) => Object.fromEntries(keys.map((key) => [key, BASE_SOURCE[key]]));
const value = (key: string, observation: StoredValueObservation): RowValueObservation => ({ key, value: observation });

function expectFault(d: NativeMigrationDecision, code: string): void {
  expect(d.kind, JSON.stringify(d)).toBe("fault");
  if (d.kind !== "fault") return;
  expect(d.findings[0].code).toBe(code);
  expect(d.latchPlan?.name).toBe("AP-LATCH");
  expect(d.latchPlan?.steps).toHaveLength(1);
  expect(d.mountsOrdinaryConsumers).toBe(false);
  expect(permitsOrdinaryAccess(d)).toBe(false);
}

/** Every way to remove or break an observation the PROOF does not use. */
function withoutUnrelated(evidence: NativeMigrationEvidence, keep: readonly (keyof NativeMigrationEvidence)[]): NativeMigrationEvidence[] {
  const variants: NativeMigrationEvidence[] = [];
  for (const field of ["targetRows", "targetRowValues", "source", "marker", "targetHealth", "latch"] as const) {
    if (keep.includes(field)) continue;
    const { [field]: _omitted, ...rest } = evidence;
    void _omitted;
    variants.push(rest);
  }
  variants.push({ ...evidence, targetRows: { status: "read_failed" } });
  variants.push({ ...evidence, source: { status: "read_failed" } });
  variants.push({ ...evidence, marker: READ_FAILED });
  // Everything unrelated omitted at once.
  variants.push(Object.fromEntries(keep.filter((field) => field in evidence).map((field) => [field, evidence[field]])) as NativeMigrationEvidence);
  return variants;
}

describe("A — a positive fault proof survives partial observations", () => {
  it("A1: an observed record matching neither issued state proves the fault on its own", () => {
    const before = copyingBytes([]);
    const after = copyingBytes([KEY_SESSION]);
    const observed = copyingBytes([KEY_TRUSTED]); // valid, but neither
    const surviving: SurvivingPlanEvidence = {
      unknownTransaction: { kind: "checkpoint", recordBefore: before, recordAfter: after, insertedRows: [{ key: KEY_SESSION, bytes: BASE_SOURCE[KEY_SESSION] }] },
      confirmedRows: [],
    };
    const full = evidenceOf(world({ record: observed, rows: rowsOf([KEY_TRUSTED]), marker: STORE_A }), surviving);
    for (const evidence of withoutUnrelated(full, ["record", "survivingPlan"])) {
      expectFault(decide(evidence), "warm_state_matches_neither");
    }
  });

  it("A2: CE5 with targetRows (and every other unrelated observation) omitted is still a detected fault", () => {
    const a = KEY_SESSION;
    const b = "curling.sporting.profile.v1.66666666-6666-4666-8666-666666666666.curling-release-tracker-cloud-sporting-sync";
    const surviving: SurvivingPlanEvidence = {
      unknownTransaction: {
        kind: "replace_enumerating",
        recordBefore: enumeratingBytes([a, b]),
        recordAfter: enumeratingBytes([a, b], { migrationId: MIG_2 }),
        insertedRows: [],
      },
      confirmedRows: [],
    };
    const full = evidenceOf(world({ record: enumeratingBytes([a], { migrationId: MIG_2 }), source: { [a]: BASE_SOURCE[a] }, marker: STORE_A }), surviving);
    for (const evidence of withoutUnrelated(full, ["record", "survivingPlan"])) {
      expectFault(decide(evidence), "warm_state_matches_neither");
    }
  });

  it("A3: a record contradicting the last confirmed record is a fault even with row observations omitted", () => {
    const surviving: SurvivingPlanEvidence = {
      confirmedRows: [{ key: KEY_SESSION, bytes: BASE_SOURCE[KEY_SESSION] }],
      lastConfirmedRecord: copyingBytes([KEY_SESSION]),
    };
    const full = evidenceOf(world({ record: copyingBytes([KEY_TRUSTED]), rows: rowsOf([KEY_TRUSTED]), marker: STORE_A }), surviving);
    for (const evidence of withoutUnrelated(full, ["record", "survivingPlan"])) {
      expectFault(decide(evidence), "confirmed_step_contradicted");
    }
  });

  it("A3: one contradicted confirmed row is a fault even when another row's observation is omitted or unreadable", () => {
    const surviving: SurvivingPlanEvidence = {
      confirmedRows: [
        { key: KEY_SESSION, bytes: BASE_SOURCE[KEY_SESSION] },
        { key: KEY_TRUSTED, bytes: BASE_SOURCE[KEY_TRUSTED] },
      ],
    };
    const record = present(copyingBytes([KEY_SESSION, KEY_TRUSTED]));
    for (const other of [undefined, READ_FAILED]) {
      for (const contradiction of [ABSENT, present("changed bytes")]) {
        const evidence: NativeMigrationEvidence = {
          record,
          survivingPlan: surviving,
          targetRowValues: [value(KEY_SESSION, contradiction), ...(other ? [value(KEY_TRUSTED, other)] : [])],
        };
        const d = decide(evidence);
        expectFault(d, "confirmed_step_contradicted");
        if (d.kind === "fault") expect(d.findings[0].detail).toEqual([KEY_SESSION]);
      }
    }
  });

  it("A3: a contradicted confirmed row is a fault while the record is unobserved or unreadable", () => {
    const surviving: SurvivingPlanEvidence = { confirmedRows: [{ key: KEY_SESSION, bytes: BASE_SOURCE[KEY_SESSION] }] };
    for (const record of [undefined, READ_FAILED]) {
      const d = decide({
        ...(record ? { record } : {}),
        survivingPlan: surviving,
        targetRowValues: [value(KEY_SESSION, present("changed"))],
      });
      expectFault(d, "confirmed_step_contradicted");
    }
  });

  it("A4: an unknown activation whose observed active record matches neither is a fault, despite an omitted confirmed row", () => {
    const before = verifiedBytes();
    const after = activeBytes();
    const observed = activeBytes(BASE_SOURCE, { migrationId: MIG_2 }); // valid active, neither
    const surviving: SurvivingPlanEvidence = {
      unknownTransaction: { kind: "activate", recordBefore: before, recordAfter: after, insertedRows: [] },
      confirmedRows: [{ key: KEY_SESSION, bytes: BASE_SOURCE[KEY_SESSION] }],
    };
    const w = world({ record: observed, rows: rowsOf(ELIGIBLE_BASE), marker: STORE_A });
    const { targetRowValues: _omitted, ...withoutRowValue } = evidenceOf(w, surviving);
    void _omitted;
    expectFault(decide(withoutRowValue), "warm_state_matches_neither");
    // Without the warm process the evidence is gone: a cold start without a latch reaches
    // B4 (the stated residual), and one with the latch is held at L0b.
    expect(decide(evidenceOf(w)).kind).toBe("access");
    expect(decide(evidenceOf({ ...w, latch: "{}" }))).toMatchObject({ kind: "blocked", rule: "L0b" });
  });

  it("no fault provable: an omitted issued row is requested only when the table would otherwise permit", () => {
    const after = copyingBytes([KEY_SESSION]);
    const surviving: SurvivingPlanEvidence = {
      unknownTransaction: { kind: "checkpoint", recordBefore: copyingBytes([]), recordAfter: after, insertedRows: [{ key: KEY_SESSION, bytes: BASE_SOURCE[KEY_SESSION] }] },
      confirmedRows: [],
    };
    const { targetRowValues: _omitted, ...evidence } = evidenceOf(world({ record: after, rows: rowsOf([KEY_SESSION]), marker: STORE_A }), surviving);
    void _omitted;
    expect(decide(evidence)).toMatchObject({ kind: "evidence_required", missing: ["targetRowValues"] });
    // A read failure alone is never a fault.
    const unreadable = decide({ ...evidence, targetRowValues: [value(KEY_SESSION, READ_FAILED)] });
    expect(unreadable).toMatchObject({ kind: "blocked", rule: "I-1", retryMayResolve: true });
  });

  it("a genuine committed D1 reaches the same B4 warm and cold, with no row listing at all", () => {
    const d1 = d1ActiveBytes();
    const cold: NativeMigrationEvidence = { latch: ABSENT, record: present(d1), targetHealth: { status: "healthy" } };
    const warm: NativeMigrationEvidence = {
      ...cold,
      survivingPlan: { unknownTransaction: { kind: "create_fresh_active", recordBefore: null, recordAfter: d1, insertedRows: [] }, confirmedRows: [] },
    };
    const coldDecision = decide(cold);
    expect(coldDecision).toMatchObject({ kind: "access", rule: "B4" });
    expect(decide(warm)).toEqual(coldDecision);
  });
});

describe("B — L0 precedence when warm evidence is incomplete or unreadable", () => {
  type LatchCase = "present" | "read_failed" | "absent";
  type RowCase = "present" | "omitted" | "read_failed";
  const records = { active: activeBytes(), "pre-active": copyingBytes([KEY_SESSION]) } as const;

  function evidenceFor(latch: LatchCase, rowCase: RowCase, phase: keyof typeof records, contradiction: boolean): NativeMigrationEvidence {
    const recordBytes = records[phase];
    const w = world({
      latch: latch === "present" ? "{}" : latch === "read_failed" ? "READ_FAILED" : null,
      record: recordBytes,
      rows: phase === "active" ? rowsOf(ELIGIBLE_BASE) : rowsOf([KEY_SESSION]),
      marker: STORE_A,
    });
    const base = evidenceOf(w);
    const surviving: SurvivingPlanEvidence = {
      confirmedRows: [{ key: KEY_SESSION, bytes: BASE_SOURCE[KEY_SESSION] }],
      // A positive contradiction comes from the RECORD, independent of the row axis.
      lastConfirmedRecord: contradiction ? copyingBytes([KEY_TRUSTED]) : recordBytes,
    };
    const rowValues: RowValueObservation[] | undefined =
      rowCase === "omitted" ? undefined
        : [value(KEY_SESSION, rowCase === "present" ? present(BASE_SOURCE[KEY_SESSION]) : READ_FAILED)];
    return { ...base, survivingPlan: surviving, ...(rowValues ? { targetRowValues: rowValues } : {}) };
  }

  for (const latch of ["present", "read_failed", "absent"] as const) {
    for (const rowCase of ["present", "omitted", "read_failed"] as const) {
      for (const phase of ["active", "pre-active"] as const) {
        for (const contradiction of [true, false]) {
          it(`latch ${latch}, warm rows ${rowCase}, ${phase}, ${contradiction ? "positive contradiction" : "no contradiction"}`, () => {
            const d = decide(evidenceFor(latch, rowCase, phase, contradiction));
            if (contradiction) {
              // A newly proven positive warm fault is always the fault stop (I-13).
              expectFault(d, "confirmed_step_contradicted");
              return;
            }
            expect(d.mountsOrdinaryConsumers).toBe(latch === "absent" && rowCase === "present" && phase === "active");
            if (latch === "present" || latch === "read_failed") {
              const rule = latch === "present" ? "L0b" : "L0a";
              expect(d).toMatchObject({ kind: "blocked", rule, retryMayResolve: latch === "read_failed" });
              const expected = [`${rule}:${latch === "present" ? "latch_present" : "latch_read_failed"}`];
              if (rowCase === "read_failed") expected.push("I-1:warm_row_bytes_unreadable");
              expect(codes(d)).toEqual(expected);
              return;
            }
            if (rowCase === "present") {
              expect(d.kind).toBe(phase === "active" ? "access" : "plan");
            } else if (rowCase === "omitted") {
              expect(d).toMatchObject({ kind: "evidence_required", missing: ["targetRowValues"] });
            } else if (phase === "active") {
              // On an active record an unreadable row is a CURRENT target failure: B1 governs.
              expect(d).toMatchObject({ kind: "blocked", rule: "B1", retryMayResolve: true });
              expect(codes(d)).toEqual(["B1:target_row_value_read_failed", "I-1:warm_row_bytes_unreadable"]);
            } else {
              expect(d).toMatchObject({ kind: "blocked", rule: "I-1", retryMayResolve: true });
              expect(codes(d)).toEqual(["I-1:warm_row_bytes_unreadable"]);
            }
            if (d.kind === "blocked") expect("plan" in d).toBe(false);
          });
        }
      }
    }
  }

  it("the reviewer's example: a present latch with an unreadable confirmed row governs as L0b, not retryable", () => {
    const d = decide(evidenceFor("present", "read_failed", "pre-active", false));
    expect(d).toMatchObject({ kind: "blocked", rule: "L0b", retryMayResolve: false });
    expect(codes(d)).toEqual(["L0b:latch_present", "I-1:warm_row_bytes_unreadable"]);
  });

  it("a present latch is honoured without any other observation, warm or cold", () => {
    const survivingOnly: NativeMigrationEvidence = {
      latch: present("{}"),
      survivingPlan: { confirmedRows: [{ key: KEY_SESSION, bytes: "x" }] },
    };
    expect(decide(survivingOnly)).toMatchObject({ kind: "blocked", rule: "L0b", retryMayResolve: false });
  });
});

describe("C — unknown snapshot fields are rejected with fixed codes only", () => {
  const base = evidenceOf(world());

  it("an unknown field NAMED or VALUED by a sentinel is invalid_evidence, and the sentinel appears nowhere", () => {
    for (const evidence of [
      { ...base, [SENTINEL]: 1 },
      { ...base, extraField: SENTINEL },
      { ...base, latch: { status: "present", bytes: "x", [SENTINEL]: SENTINEL } },
      { ...base, survivingPlan: { confirmedRows: [], [SENTINEL]: true } },
      { ...base, targetRowValues: [{ key: KEY_SESSION, value: ABSENT, [SENTINEL]: 1 }] },
    ]) {
      const d = decideNativeMigration(evidence, OPTIONS);
      expect(d.kind).toBe("invalid_evidence");
      expect(d.mountsOrdinaryConsumers).toBe(false);
      expect(JSON.stringify(d)).not.toContain(SENTINEL);
    }
    expect(decideNativeMigration({ ...base, [SENTINEL]: 1 }, OPTIONS)).toEqual({
      kind: "invalid_evidence",
      problems: ["evidence_unknown_field"],
      mountsOrdinaryConsumers: false,
    });
  });

  it("known fixed codes still name the malformed part", () => {
    const d = decideNativeMigration({ ...base, latch: { status: "maybe" }, source: listing({}), marker: { status: "present" } }, OPTIONS);
    expect(d).toMatchObject({ kind: "invalid_evidence", problems: ["latch_malformed", "marker_malformed"] });
  });
});
