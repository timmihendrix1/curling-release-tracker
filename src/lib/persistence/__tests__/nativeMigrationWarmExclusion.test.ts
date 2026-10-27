// Warm recovery (docs/MOBILE_APP_MIGRATION.md Stage M3b0 §5.1, I-11/I-13): every
// SUCCESSFUL observation excludes the candidate outcomes it contradicts on its own —
// exact record bytes, exact issued-row bytes, and a complete target listing by key
// presence alone — so a fault already proven by row or listing evidence is never
// lost behind an unobserved or unreadable record. Omitted and failed observations
// exclude nothing. Logical tests over synthetic data only, through the production
// exports; the expected outcomes come from a possible-worlds oracle written from the
// before/after definitions, not from the implementation.
import { describe, expect, it } from "vitest";
import {
  permitsOrdinaryAccess,
  type KeyListingObservation,
  type NativeMigrationDecision,
  type NativeMigrationEvidence,
  type RowValueObservation,
  type StoredValueObservation,
  type SurvivingPlanEvidence,
  type UnknownOutcomeTransaction,
} from "../nativeMigrationDecision";
import {
  ABSENT,
  KEY_SESSION,
  KEY_TRUSTED,
  READ_FAILED,
  STORE_A,
  codes,
  copyingBytes,
  decide,
  evidenceOf,
  executePlan,
  expectBlocked,
  expectPlan,
  fp,
  listing,
  present,
  world,
  type World,
} from "./nativeMigrationTestKit";

// A two-key synthetic source; its values are sentinels so a leak is detectable.
const SOURCE: Readonly<Record<string, string>> = Object.freeze({
  [KEY_SESSION]: "SYNTHETIC_ROW_VALUE_SESSION",
  [KEY_TRUSTED]: "SYNTHETIC_ROW_VALUE_TRUSTED",
});
const DIFFERENT = "SYNTHETIC_ROW_VALUE_DIFFERENT";

/** A genuine unknown-outcome checkpoint inserting both previously absent rows, from the production plan. */
function unknownCheckpoint(): { start: World; tx: UnknownOutcomeTransaction } {
  const start = world({ record: copyingBytes([], SOURCE), rows: {}, source: { ...SOURCE }, marker: STORE_A });
  const plan = expectPlan(decide(evidenceOf(start)), "E′9", "AP-COPY");
  const checkpoint = plan.steps.findIndex((s) => s.kind === "target_transaction");
  const run = executePlan(start, plan, { inject: { [checkpoint]: "not_committed_unknown" } });
  const tx = run.surviving.unknownTransaction;
  if (!tx) throw new Error("expected an unknown-outcome checkpoint");
  return { start, tx };
}

const { start: START, tx: TX } = unknownCheckpoint();
const [ROW_A, ROW_B] = TX.insertedRows;
const NEITHER = copyingBytes([ROW_A.key], SOURCE); // valid, but neither issued record
const SURVIVING: SurvivingPlanEvidence = { unknownTransaction: TX, confirmedRows: [] };

it("the fixture is a two-row checkpoint over previously absent rows, with three distinct records", () => {
  expect(TX.kind).toBe("checkpoint");
  expect(TX.insertedRows.map((row) => row.key)).toEqual([KEY_TRUSTED, KEY_SESSION].sort());
  expect(TX.insertedRows.map((row) => row.bytes)).toEqual(TX.insertedRows.map((row) => SOURCE[row.key]));
  expect(START.rows).toEqual({});
  expect(new Set([TX.recordBefore, TX.recordAfter, NEITHER]).size).toBe(3);
  expect(TX.recordBefore).not.toBeNull();
});

type RecordCase = "before" | "after" | "neither" | "unobserved" | "read_failed";
type RowCase = "issued" | "different" | "absent" | "unobserved" | "read_failed";
type ListingCase = "omitted" | "read_failed" | { readonly a: boolean; readonly b: boolean };

const RECORD_CASES: readonly RecordCase[] = ["before", "after", "neither", "unobserved", "read_failed"];
const ROW_CASES: readonly RowCase[] = ["issued", "different", "absent", "unobserved", "read_failed"];
const LISTING_CASES: readonly ListingCase[] = [
  "omitted", "read_failed",
  { a: false, b: false }, { a: true, b: false }, { a: false, b: true }, { a: true, b: true },
];

const listingLabel = (l: ListingCase) => (typeof l === "string" ? `listing ${l}` : `listing {a:${l.a}, b:${l.b}}`);

function recordObservation(c: RecordCase): StoredValueObservation | undefined {
  switch (c) {
    case "before": return present(TX.recordBefore as string);
    case "after": return present(TX.recordAfter);
    case "neither": return present(NEITHER);
    case "unobserved": return undefined;
    case "read_failed": return READ_FAILED;
  }
}

function rowObservation(key: string, c: RowCase): RowValueObservation | undefined {
  switch (c) {
    case "issued": return { key, value: present(SOURCE[key]) };
    case "different": return { key, value: present(DIFFERENT) };
    case "absent": return { key, value: ABSENT };
    case "unobserved": return undefined;
    case "read_failed": return { key, value: READ_FAILED };
  }
}

function listingObservation(l: ListingCase): KeyListingObservation | undefined {
  if (l === "omitted") return undefined;
  if (l === "read_failed") return { status: "read_failed" };
  const keys = [...(l.a ? [ROW_A.key] : []), ...(l.b ? [ROW_B.key] : [])].sort();
  return { status: "listed", entries: keys.map((key) => ({ key, fingerprint: { status: "computed", value: fp(SOURCE[key]) } })) };
}

/** A complete warm snapshot: every durable observation the table needs, plus the warm ones under test. */
function snapshot(r: RecordCase, a: RowCase, b: RowCase, l: ListingCase): NativeMigrationEvidence {
  const record = recordObservation(r);
  const rows = listingObservation(l);
  const values = [rowObservation(ROW_A.key, a), rowObservation(ROW_B.key, b)].filter((v): v is RowValueObservation => !!v);
  return {
    latch: ABSENT,
    ...(record ? { record } : {}),
    targetHealth: { status: "healthy" },
    ...(rows ? { targetRows: rows } : {}),
    source: listing(SOURCE),
    marker: present(STORE_A),
    survivingPlan: SURVIVING,
    targetRowValues: values,
  };
}

/** The same durable observations without the plan's memory — what a cold start would evaluate. */
function coldOf(evidence: NativeMigrationEvidence): NativeMigrationEvidence {
  const { survivingPlan: _plan, targetRowValues: _values, ...cold } = evidence;
  void _plan;
  void _values;
  return cold;
}

// ---------------------------------------------------------------- the oracle

interface Candidate {
  readonly name: "before" | "after";
  readonly record: string | null;
  readonly rows: Readonly<Record<string, string>>;
}
/** I-11's two candidate states, written from their definitions. */
const CANDIDATES: readonly Candidate[] = [
  { name: "before", record: TX.recordBefore, rows: {} },
  { name: "after", record: TX.recordAfter, rows: Object.fromEntries(TX.insertedRows.map((row) => [row.key, row.bytes])) },
];

/** Would reading the candidate world have returned these observations? Omitted and failed ones constrain nothing. */
function consistent(c: Candidate, r: RecordCase, rowCases: Readonly<Record<string, RowCase>>, l: ListingCase): boolean {
  const recordBytes = { before: TX.recordBefore, after: TX.recordAfter, neither: NEITHER } as const;
  if (r !== "unobserved" && r !== "read_failed" && recordBytes[r] !== c.record) return false;
  for (const [key, rc] of Object.entries(rowCases)) {
    if (rc === "issued" && c.rows[key] !== SOURCE[key]) return false;
    if (rc === "different" && c.rows[key] !== DIFFERENT) return false;
    if (rc === "absent" && key in c.rows) return false;
  }
  if (typeof l !== "string") {
    if (l.a !== ROW_A.key in c.rows || l.b !== ROW_B.key in c.rows) return false;
  }
  return true;
}

function expectDetectedFault(d: NativeMigrationDecision, label = ""): void {
  expect(d.kind, `${label} ${JSON.stringify(d)}`).toBe("fault");
  if (d.kind !== "fault") return;
  expect(d.rule).toBe("I-13");
  expect(d.findings).toEqual([{ rule: "I-11", code: "warm_state_matches_neither" }]);
  // The in-process stop, and the bounded latch write as the only permitted action.
  expect(d.stop.latchWriteAttempts).toEqual([]);
  expect(d.latchPlan).toEqual({
    name: "AP-LATCH",
    steps: [{ kind: "target_transaction", store: "target", transaction: { op: "write_fault_latch", content: d.stop.latchContent } }],
    continuation: "re_evaluate",
  });
  expect(d.mountsOrdinaryConsumers).toBe(false);
  expect(permitsOrdinaryAccess(d)).toBe(false);
  const content = JSON.parse(d.stop.latchContent);
  expect(content).toMatchObject({ schemaVersion: 1, cause: "warm_state_matches_neither", transactionKind: "checkpoint", phase: "copying" });
  // Only migration metadata: never a row value.
  for (const value of [...Object.values(SOURCE), DIFFERENT]) expect(JSON.stringify(d)).not.toContain(value);
}

/** Variants that remove or break every observation a proof does not use. */
function withUnrelatedRemoved(evidence: NativeMigrationEvidence): NativeMigrationEvidence[] {
  const { latch: _l, targetHealth: _h, source: _s, marker: _m, ...bare } = evidence;
  void _l; void _h; void _s; void _m;
  return [
    evidence,
    bare,
    { ...evidence, latch: READ_FAILED, source: { status: "read_failed" }, marker: READ_FAILED, targetHealth: { status: "failing" } },
    { ...evidence, latch: present("{}") },
  ];
}

// ---------------------------------------------------------------- the four reproductions

describe("reproductions — a fault proven without a readable record", () => {
  it("A: record unobserved; a present with its issued bytes, b positively absent ⇒ detected fault", () => {
    const evidence: NativeMigrationEvidence = {
      survivingPlan: SURVIVING,
      targetRowValues: [{ key: ROW_A.key, value: present(ROW_A.bytes) }, { key: ROW_B.key, value: ABSENT }],
    };
    for (const variant of withUnrelatedRemoved({ ...snapshot("unobserved", "issued", "absent", "omitted"), ...evidence })) {
      const d = decide(variant);
      expectDetectedFault(d, "A");
      if (d.kind === "fault") expect(JSON.parse(d.stop.latchContent).observed).toEqual({ status: "unreadable" });
    }
    expectDetectedFault(decide(evidence), "A, minimal");
  });

  it("B: record read_failed; an inserted row present with different bytes ⇒ detected fault, not A1", () => {
    const minimal: NativeMigrationEvidence = {
      record: READ_FAILED,
      survivingPlan: SURVIVING,
      targetRowValues: [{ key: ROW_A.key, value: present(DIFFERENT) }],
    };
    expectDetectedFault(decide(minimal), "B, minimal");
    for (const variant of withUnrelatedRemoved(snapshot("read_failed", "different", "unobserved", "omitted"))) {
      expectDetectedFault(decide(variant), "B");
    }
    // Either inserted row, and whatever the other row's observation is.
    for (const other of ROW_CASES) {
      expectDetectedFault(decide(snapshot("read_failed", other, "different", "omitted")), `B/${other}`);
    }
  });

  it("C: record = after-state; a complete listing shows an inserted key absent; row values omitted ⇒ detected fault", () => {
    const minimal: NativeMigrationEvidence = {
      record: present(TX.recordAfter),
      targetRows: listingObservation({ a: true, b: false }),
      survivingPlan: SURVIVING,
    };
    expectDetectedFault(decide(minimal), "C, minimal");
    for (const variant of withUnrelatedRemoved(snapshot("after", "unobserved", "unobserved", { a: true, b: false }))) {
      expectDetectedFault(decide(variant), "C");
    }
    // Key absence alone suffices: no fingerprint, no value.
    expectDetectedFault(decide({ ...minimal, targetRows: { status: "listed", entries: [] } }), "C, empty listing");
  });

  it("D: record = before-state; a complete listing contains an inserted key; row values omitted ⇒ detected fault", () => {
    const minimal: NativeMigrationEvidence = {
      record: present(TX.recordBefore as string),
      targetRows: { status: "listed", entries: [{ key: ROW_B.key }] }, // key presence only, no fingerprint
      survivingPlan: SURVIVING,
    };
    expectDetectedFault(decide(minimal), "D, minimal");
    for (const variant of withUnrelatedRemoved(snapshot("before", "unobserved", "unobserved", { a: false, b: true }))) {
      expectDetectedFault(decide(variant), "D");
    }
  });

  it("each reproduction's latch write carries the stop across a relaunch; without it only the cold table remains", () => {
    // The durable state behind reproduction A: the after-record, but only row a.
    const durable = world({ record: TX.recordAfter, rows: { [ROW_A.key]: ROW_A.bytes }, source: { ...SOURCE }, marker: STORE_A });
    const d = decide(snapshot("unobserved", "issued", "absent", "omitted"));
    if (d.kind !== "fault" || !d.latchPlan) throw new Error("expected a fault with a latch plan");
    const latched = executePlan(durable, d.latchPlan);
    expect(latched.outcomes).toEqual(["confirmed"]);
    expectBlocked(decide(evidenceOf(latched.world)), "L0b", "latch_present");
    // The latch did not persist: a cold start sees only what the table can, here E′2.
    expectBlocked(decide(evidenceOf(durable)), "E′2", "copied_without_row");
  });
});

// ---------------------------------------------------------------- negative controls

describe("negative controls — one candidate remains possible, so missing or failed evidence is no fault", () => {
  const cases: [string, NativeMigrationEvidence, (d: NativeMigrationDecision) => void][] = [
    ["record unobserved; a issued; b unobserved (after possible)", snapshot("unobserved", "issued", "unobserved", "omitted"),
      (d) => expect(d).toMatchObject({ kind: "evidence_required" })],
    ["record unobserved; both absent (before possible)", snapshot("unobserved", "absent", "absent", "omitted"),
      (d) => expect(d).toEqual({ kind: "evidence_required", missing: ["record"], mountsOrdinaryConsumers: false })],
    ["record read_failed; both issued (after possible)", snapshot("read_failed", "issued", "issued", { a: true, b: true }),
      (d) => expectBlocked(d, "A1", "record_read_failed")],
    ["record after; row values read_failed; listing failed", snapshot("after", "read_failed", "read_failed", "read_failed"),
      (d) => expect(codes(d)).toEqual(["PV9:target_rows_read_failed", "I-1:warm_row_bytes_unreadable"])],
    ["record before; listing failed; values omitted", snapshot("before", "unobserved", "unobserved", "read_failed"),
      (d) => expect(codes(d)).toEqual(["PV9:target_rows_read_failed"])],
    ["record after; listing shows both; values omitted ⇒ the after-state's VALUES are still required",
      snapshot("after", "unobserved", "unobserved", { a: true, b: true }),
      (d) => expect(d).toEqual({ kind: "evidence_required", missing: ["targetRowValues"], mountsOrdinaryConsumers: false })],
  ];
  for (const [label, evidence, check] of cases) {
    it(label, () => {
      const d = decide(evidence);
      expect(d.kind, JSON.stringify(d)).not.toBe("fault");
      expect(permitsOrdinaryAccess(d)).toBe(false);
      check(d);
    });
  }

  it("the before-state is established by key absence alone: no row value is requested, and warm equals cold", () => {
    const evidence = snapshot("before", "unobserved", "unobserved", { a: false, b: false });
    const d = decide(evidence);
    expect(d).toEqual(decide(coldOf(evidence)));
    expectPlan(d, "E′9", "AP-COPY");
  });

  it("an unreadable row value is still a block under I-1 even where the listing settles the before-state", () => {
    const d = decide(snapshot("before", "read_failed", "unobserved", { a: false, b: false }));
    expectBlocked(d, "I-1", "warm_row_bytes_unreadable");
  });
});

// ---------------------------------------------------------------- the exhaustive matrix

describe("matrix — record × row a × row b × listing, against the possible-worlds oracle", () => {
  for (const r of RECORD_CASES) {
    for (const l of LISTING_CASES) {
      it(`record ${r}, ${listingLabel(l)}: all 25 row combinations`, () => {
        for (const a of ROW_CASES) {
          for (const b of ROW_CASES) {
            const label = `record ${r}, a ${a}, b ${b}, ${listingLabel(l)}`;
            const evidence = snapshot(r, a, b, l);
            const d = decide(evidence);
            const possible = CANDIDATES.filter((c) => consistent(c, r, { [ROW_A.key]: a, [ROW_B.key]: b }, l));
            expect(d.mountsOrdinaryConsumers, label).toBe(false);

            if (possible.length === 0) {
              expectDetectedFault(d, label);
              continue;
            }
            expect(d.kind, `${label} ${JSON.stringify(d)}`).not.toBe("fault");

            // Is the remaining candidate fully established? The record must be read; every
            // row needs its exact bytes, except that the before-state needs only absence,
            // which a complete listing proves without a value.
            const only = possible.length === 1 ? possible[0] : null;
            const recordRead = r !== "unobserved" && r !== "read_failed";
            const rowFailed = a === "read_failed" || b === "read_failed";
            const rowSettled = (rc: RowCase) => (rc !== "unobserved" && rc !== "read_failed") ||
              (rc === "unobserved" && only?.name === "before" && typeof l !== "string");
            if (only && recordRead && !rowFailed && rowSettled(a) && rowSettled(b)) {
              // I-11: warm and cold choose the same action from the same durable evidence.
              expect(d, label).toEqual(decide(coldOf(evidence)));
            } else if (rowFailed) {
              expect(d.kind, label).toBe("blocked");
              expect(codes(d), label).toContain("I-1:warm_row_bytes_unreadable");
            } else if (r === "read_failed") {
              expectBlocked(d, "A1", "record_read_failed");
            } else if (r === "unobserved") {
              expect(d.kind, label).toBe("evidence_required");
              if (d.kind === "evidence_required") expect(d.missing, label).toContain("record");
            } else if (l === "read_failed") {
              // A durable stop governs; the omitted warm value is not requested over it.
              expectBlocked(d, "PV9", "target_rows_read_failed");
            } else {
              expect(d.kind, label).toBe("evidence_required");
              if (d.kind === "evidence_required") expect(d.missing, label).toContain("targetRowValues");
            }
          }
        }
      });
    }
  }

  it("the oracle's matrix is non-vacuous: both outcomes occur, including faults with no readable record", () => {
    let faults = 0;
    let faultsWithoutReadableRecord = 0;
    let total = 0;
    for (const r of RECORD_CASES) {
      for (const l of LISTING_CASES) {
        for (const a of ROW_CASES) {
          for (const b of ROW_CASES) {
            total += 1;
            if (CANDIDATES.some((c) => consistent(c, r, { [ROW_A.key]: a, [ROW_B.key]: b }, l))) continue;
            faults += 1;
            if (r === "unobserved" || r === "read_failed") faultsWithoutReadableRecord += 1;
          }
        }
      }
    }
    expect(total).toBe(750);
    expect(faults).toBeGreaterThan(0);
    expect(total - faults).toBeGreaterThan(0);
    expect(faultsWithoutReadableRecord).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------- confirmed steps

describe("confirmed-step contradiction uses the same positive evidence", () => {
  const confirmed = ROW_A;
  const surviving: SurvivingPlanEvidence = { confirmedRows: [confirmed], lastConfirmedRecord: TX.recordAfter };
  type ConfirmedRecord = "last" | "other" | "absent" | "unobserved" | "read_failed";
  type ConfirmedListing = "omitted" | "read_failed" | "with_key" | "without_key";

  function confirmedSnapshot(r: ConfirmedRecord, row: RowCase, l: ConfirmedListing): NativeMigrationEvidence {
    const record = { last: present(TX.recordAfter), other: present(NEITHER), absent: ABSENT, unobserved: undefined, read_failed: READ_FAILED }[r];
    const rows: KeyListingObservation | undefined = l === "omitted" ? undefined : l === "read_failed" ? { status: "read_failed" }
      : { status: "listed", entries: l === "with_key" ? [{ key: confirmed.key }] : [] };
    const value = rowObservation(confirmed.key, row);
    return {
      ...(record ? { record } : {}),
      ...(rows ? { targetRows: rows } : {}),
      survivingPlan: surviving,
      ...(value ? { targetRowValues: [value] } : {}),
    };
  }

  for (const r of ["last", "other", "absent", "unobserved", "read_failed"] as const) {
    for (const l of ["omitted", "read_failed", "with_key", "without_key"] as const) {
      it(`record ${r}, listing ${l}: all five row observations`, () => {
        for (const row of ROW_CASES) {
          const label = `record ${r}, row ${row}, listing ${l}`;
          const d = decide(confirmedSnapshot(r, row, l));
          // The confirmed world: the last confirmed record, the row with its confirmed bytes.
          const rowContradicted = row === "different" || row === "absent" || l === "without_key";
          const recordContradicted = r === "other" || r === "absent";
          if (rowContradicted || recordContradicted) {
            expect(d.kind, label).toBe("fault");
            if (d.kind !== "fault") continue;
            expect(d.findings[0], label).toEqual({
              rule: "I-13",
              code: "confirmed_step_contradicted",
              ...(rowContradicted ? { detail: [confirmed.key] } : {}),
            });
            expect(d.latchPlan?.name).toBe("AP-LATCH");
            expect(JSON.stringify(d)).not.toContain(confirmed.bytes);
          } else {
            expect(d.kind, label).not.toBe("fault");
            expect(permitsOrdinaryAccess(d), label).toBe(false);
          }
        }
      });
    }
  }

  it("a listed confirmed key with its value omitted is not a contradiction; its bytes are still requested", () => {
    const d = decide({
      latch: ABSENT,
      record: present(TX.recordAfter),
      targetHealth: { status: "healthy" },
      targetRows: listingObservation({ a: true, b: true }),
      source: listing(SOURCE),
      marker: present(STORE_A),
      survivingPlan: surviving,
    });
    expect(d).toEqual({ kind: "evidence_required", missing: ["targetRowValues"], mountsOrdinaryConsumers: false });
  });
});
