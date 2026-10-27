// Class-L tests for the M3b4a decision function (docs/MOBILE_APP_MIGRATION.md
// Stage M3b0 §§5.1–5.7 and acceptance cases R1–R77). Every `rcase("Rn", …)` is the
// class-L coverage of that case; `nativeMigrationCoverage.test.ts` checks that
// every class-L case is covered somewhere. These are LOGICAL tests over synthetic
// evidence: they establish decisions under the approved model, not native
// transaction atomicity, durability, marker persistence or device behaviour.
import { describe, expect, it } from "vitest";
import {
  decideNativeMigration,
  eligibleSourceKeys,
  permitsOrdinaryAccess,
  type NativeMigrationDecision,
  type KeyObservation,
  type NativeMigrationEvidence,
} from "../nativeMigrationDecision";
import { summarizePlanRun } from "../nativeMigrationPlanOutcome";
import {
  ABSENT,
  BASE_SOURCE,
  ELIGIBLE_BASE,
  KEY_BARRIER,
  KEY_CREDENTIAL,
  KEY_CREDENTIAL_VERIFIER,
  KEY_DIAGRAM,
  KEY_HISTORY,
  KEY_NEW,
  KEY_RESOLUTION,
  KEY_SESSION,
  KEY_SYNC_B,
  KEY_TRUSTED,
  KEY_UNKNOWN,
  MIG_2,
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
  manifestOf,
  parsed,
  present,
  rawRecord,
  recordBytes,
  verifiedBytes,
  world,
} from "./nativeMigrationTestKit";

const rcase = (id: string, title: string, fn: () => void) => it(`${id}: ${title}`, fn);

const rowsOf = (keys: readonly string[], source = BASE_SOURCE) =>
  Object.fromEntries(keys.map((key) => [key, source[key]]));

describe("L0 — the durable fault latch (I-13)", () => {
  rcase("R75", "a latch with malformed bytes blocks at L0b — presence alone latches", () => {
    expectBlocked(decide(evidenceOf(world({ latch: "\u0000not json" }))), "L0b", "latch_present");
  });

  rcase("R76", "a present latch blocks with an active record, an incomplete retirement and no record", () => {
    const states = [
      world({ latch: "{}", record: activeBytes(), rows: rowsOf(ELIGIBLE_BASE), marker: STORE_A }),
      world({ latch: "{}", record: activeBytes(BASE_SOURCE, { sourceRetirement: { state: "in_progress", removedKeys: [KEY_SESSION] } }) }),
      world({ latch: "{}", record: null }),
      world({ latch: "{}", record: null, source: {} }),
    ];
    for (const w of states) {
      const d = decide(evidenceOf(w));
      expectBlocked(d, "L0b");
      expect(permitsOrdinaryAccess(d)).toBe(false);
    }
  });

  rcase("R77", "no latch and a valid active record mount at B4; an unreadable latch blocks at L0a without consulting the source", () => {
    const evidence: NativeMigrationEvidence = {
      latch: ABSENT,
      record: present(activeBytes()),
      targetHealth: { status: "healthy" },
    };
    const ok = decide(evidence);
    expect(ok.kind).toBe("access");
    expect(permitsOrdinaryAccess(ok)).toBe(true);
    const failed = decide({ ...evidence, latch: READ_FAILED });
    expectBlocked(failed, "L0a", "latch_read_failed");
    if (failed.kind === "blocked") expect(failed.retryMayResolve).toBe(true);
  });

  it("an omitted latch observation is not absence: evidence is required", () => {
    const d = decide({ record: present(activeBytes()), targetHealth: { status: "healthy" } });
    expect(d).toMatchObject({ kind: "evidence_required", missing: ["latch"] });
  });
});

describe("Group A and A′ — record metadata only", () => {
  rcase("R54", "an unreadable record blocks at A1; a malformed one at A2", () => {
    expectBlocked(decide(evidenceOf(world({ record: "READ_FAILED" }))), "A1", "record_read_failed");
    expectBlocked(decide(evidenceOf(world({ record: "{not json" }))), "A2", "record_unparseable");
    expectBlocked(decide(evidenceOf(world({ record: "[]" }))), "A2", "record_not_object");
    expectBlocked(decide(evidenceOf(world({ record: rawRecord({ schemaVersion: 1, phase: "done" }) }))), "A2", "record_phase_invalid");
  });

  it("A3/A4 — a newer or older schemaVersion blocks and nothing else is interpreted", () => {
    const newer = decide(evidenceOf(world({ record: rawRecord({ schemaVersion: 2, phase: "active", junk: true }) })));
    expectBlocked(newer, "A3", "record_schema_newer");
    expect(codes(newer)).toEqual(["A3:record_schema_newer"]);
    expectBlocked(decide(evidenceOf(world({ record: rawRecord({ schemaVersion: 0, phase: "copying" }) }))), "A4", "record_schema_older");
    expectBlocked(decide(evidenceOf(world({ record: rawRecord({ schemaVersion: 1.5, phase: "copying" }) }))), "A2", "record_schema_version_invalid");
  });

  it("A5 — a structurally malformed manifest, or none in copying", () => {
    const malformed = JSON.parse(copyingBytes([]));
    malformed.manifest = [{ key: KEY_SESSION }];
    expectBlocked(decide(evidenceOf(world({ record: rawRecord(malformed) }))), "A5", "manifest_malformed");
    const absent = JSON.parse(copyingBytes([]));
    delete absent.manifest;
    expectBlocked(decide(evidenceOf(world({ record: rawRecord(absent) }))), "A5", "manifest_absent");
  });

  it("A6 — copied outside the manifest", () => {
    const record = JSON.parse(copyingBytes([KEY_SESSION]));
    record.copied = [KEY_SESSION, KEY_HISTORY];
    expectBlocked(decide(evidenceOf(world({ record: rawRecord(record) }))), "A6", "copied_not_subset_of_manifest");
  });

  it("A′1 — non-canonical identifiers (upper case, wrong version nibble, non-string)", () => {
    for (const bad of ["ABCDEF01-1111-4111-8111-111111111111", "11111111-1111-9111-8111-111111111111", 42]) {
      const record = JSON.parse(enumeratingBytes());
      record.storeIdentity = bad;
      expectBlocked(decide(evidenceOf(world({ record: rawRecord(record) }))), "A′1", "identifier_not_canonical");
    }
  });

  rcase("R49", "an enumerating record carrying a manifest or copied blocks at A′2", () => {
    expectBlocked(decide(evidenceOf(world({ record: enumeratingBytes(ELIGIBLE_BASE, { copied: [] }) }))), "A′2", "field_present_contrary_to_phase");
    expectBlocked(decide(evidenceOf(world({ record: enumeratingBytes(ELIGIBLE_BASE, { manifest: manifestOf(BASE_SOURCE) }) }))), "A′2");
  });

  rcase("R32", "entryKeys missing, empty, duplicated or ineligible in later phases blocks at A′2/A′3", () => {
    const missing = JSON.parse(copyingBytes([]));
    delete missing.entryKeys;
    expectBlocked(decide(evidenceOf(world({ record: rawRecord(missing) }))), "A′2", "field_absent_contrary_to_phase");
    const empty = JSON.parse(verifiedBytes());
    empty.entryKeys = [];
    expectBlocked(decide(evidenceOf(world({ record: rawRecord(empty) }))), "A′3", "entry_keys_empty");
    const dup = JSON.parse(activeBytes());
    dup.entryKeys = [KEY_SESSION, KEY_SESSION];
    expectBlocked(decide(evidenceOf(world({ record: rawRecord(dup) }))), "A′3", "entry_keys_duplicate");
    const ineligible = JSON.parse(copyingBytes([]));
    ineligible.entryKeys = [KEY_SESSION, KEY_CREDENTIAL];
    const d = decide(evidenceOf(world({ record: rawRecord(ineligible) })));
    expectBlocked(d, "A′3", "entry_keys_ineligible");
    // The ineligible entry key is also outside the manifest: both are reported, A′3 governs.
    expect(codes(d)).toEqual(["A′3:entry_keys_ineligible", "A′5:entry_keys_not_in_manifest"]);
    const notArray = JSON.parse(copyingBytes([]));
    notArray.entryKeys = "x";
    expectBlocked(decide(evidenceOf(world({ record: rawRecord(notArray) }))), "A′3", "entry_keys_malformed");
  });

  rcase("R48", "an empty manifest in copying or verified blocks at A′4, including over a cleared source", () => {
    for (const phase of ["copying", "verified"] as const) {
      const bytes = recordBytes({ phase, entryKeys: ELIGIBLE_BASE, manifest: [], copied: [] });
      const d = decide(evidenceOf(world({ record: bytes, source: {} })));
      expectBlocked(d, "A′4", "manifest_empty");
    }
  });

  it("A′4 — duplicate or ineligible manifest keys and malformed fingerprints; a throwing predicate counts as malformed", () => {
    const record = JSON.parse(copyingBytes([]));
    record.manifest = [...record.manifest, { key: KEY_SESSION, fingerprint: fp("x") }, { key: KEY_UNKNOWN, fingerprint: "sha-nothing" }];
    const d = decide(evidenceOf(world({ record: rawRecord(record) })));
    expect(codes(d)).toEqual(expect.arrayContaining([
      "A′4:manifest_duplicate_key", "A′4:manifest_ineligible_key", "A′4:manifest_fingerprint_malformed",
    ]));
    const throwing = decideNativeMigration(evidenceOf(world({ record: copyingBytes([]) })), {
      ...OPTIONS,
      isWellFormedFingerprint: () => { throw new Error("boom"); },
    });
    expectBlocked(throwing, "A′4", "manifest_fingerprint_malformed");
  });

  rcase("R31", "CE2: entryKeys not contained in the manifest blocks at A′5 in copying, verified and a migrated active record", () => {
    const small = { [KEY_SYNC_B]: BASE_SOURCE[KEY_SYNC_B] };
    for (const bytes of [
      recordBytes({ phase: "copying", entryKeys: [KEY_SESSION], manifest: manifestOf(small), copied: [KEY_SYNC_B] }),
      recordBytes({ phase: "verified", entryKeys: [KEY_SESSION], manifest: manifestOf(small), copied: [KEY_SYNC_B] }),
      activeBytes(small, { entryKeys: [KEY_SESSION] }),
    ]) {
      expectBlocked(decide(evidenceOf(world({ record: bytes, rows: small, source: small }))), "A′5", "entry_keys_not_in_manifest");
    }
  });

  rcase("R24", "CE1: verified with copied ⊊ manifest and a row missing blocks at A′6; never activated", () => {
    const record = JSON.parse(verifiedBytes());
    record.copied = [KEY_SESSION];
    const d = decide(evidenceOf(world({ record: rawRecord(record), rows: rowsOf([KEY_SESSION]), marker: STORE_A })));
    expectBlocked(d, "A′6", "copied_incomplete");
    expect(permitsOrdinaryAccess(d)).toBe(false);
  });

  rcase("R33", "an active record mixing empty and non-empty lists blocks at A′7", () => {
    const d = decide(evidenceOf(world({ record: activeBytes(BASE_SOURCE, { entryKeys: [] }) })));
    expectBlocked(d, "A′7", "active_lists_inconsistent");
  });

  rcase("R34", "a valid D1 record (empty entryKeys, manifest and copied) passes A and A′ and mounts at B4", () => {
    const d = decide(evidenceOf(world({ record: d1ActiveBytes(), source: null, marker: "READ_FAILED" })));
    expect(d).toMatchObject({ kind: "access", rule: "B4", retirement: { state: "complete" } });
    expect(permitsOrdinaryAccess(d)).toBe(true);
  });

  it("A2 — unknown fields, malformed activatedAt and a retirement outside copied", () => {
    const record = JSON.parse(activeBytes());
    record.extra = 1;
    record.activatedAt = "yesterday";
    record.sourceRetirement = { state: "in_progress", removedKeys: [KEY_NEW] };
    const d = decide(evidenceOf(world({ record: rawRecord(record) })));
    expect(codes(d)).toEqual(["A2:record_unknown_field", "A2:activated_at_malformed", "A2:source_retirement_malformed"]);
  });

  it("multiple record defects: A6 governs and every interpretable failure is reported", () => {
    const record = JSON.parse(verifiedBytes());
    record.copied = [KEY_SESSION, KEY_NEW];
    record.entryKeys = [KEY_SESSION, KEY_SESSION];
    record.migrationId = "nope";
    const d = decide(evidenceOf(world({ record: rawRecord(record) })));
    expectBlocked(d, "A6");
    expect(codes(d)).toEqual([
      "A6:copied_not_subset_of_manifest",
      "A′1:identifier_not_canonical",
      "A′3:entry_keys_duplicate",
      "A′6:copied_incomplete",
    ]);
  });
});

describe("Group B — after activation (metadata and target health only)", () => {
  rcase("R36", "a migrated active record whose live rows no longer match the manifest still mounts at B4", () => {
    const d = decide(evidenceOf(world({ record: activeBytes(), rows: { [KEY_SESSION]: "edited later" } })));
    expect(d).toMatchObject({ kind: "access", rule: "B4" });
  });

  rcase("R61", "a valid active target with the source missing, cleared or unreadable and any marker state mounts; retirement stalls (B2)", () => {
    const markers: World["marker"][] = [null, "READ_FAILED", "not-a-uuid", STORE_FOREIGN];
    for (const marker of markers) {
      for (const source of [null, {}] as const) {
        const d = decide(evidenceOf(world({ record: activeBytes(), source, marker })));
        expect(d).toMatchObject({ kind: "access", rule: "B4", retirement: { rule: "B2", state: "stalled" } });
      }
    }
    // The marker is never read: omitting it changes nothing.
    const withoutMarker = decide({ latch: ABSENT, record: present(activeBytes()), targetHealth: { status: "healthy" } });
    expect(withoutMarker).toMatchObject({ kind: "access", retirement: { state: "not_evaluated" } });
  });

  rcase("R62", "after activation a migrated key removed (sign-out), changed, or a new key added stays B4", () => {
    for (const rows of [
      rowsOf([KEY_SESSION, KEY_SYNC_B, KEY_RESOLUTION]), // trustedDevice removed by sign-out
      { ...rowsOf(ELIGIBLE_BASE), [KEY_SESSION]: "changed" },
      { ...rowsOf(ELIGIBLE_BASE), [KEY_NEW]: "brand new" },
    ]) {
      expect(decide(evidenceOf(world({ record: activeBytes(), rows }))).kind).toBe("access");
    }
  });

  it("B1 — an active record over a failing target blocks; no fallback to the source", () => {
    const d = decide(evidenceOf(world({ record: activeBytes(), targetFailing: true })));
    expectBlocked(d, "B1", "target_failing");
  });

  it("B3 — retirement resumes only for keys whose source fingerprint matches; changed and unverifiable keys are kept", () => {
    const record = activeBytes(BASE_SOURCE, { sourceRetirement: { state: "in_progress", removedKeys: [KEY_RESOLUTION] } });
    const source = { [KEY_SESSION]: BASE_SOURCE[KEY_SESSION], [KEY_SYNC_B]: "older build rewrote this", [KEY_TRUSTED]: "x" };
    const evidence = evidenceOf(world({ record, source }));
    const entries = (evidence.source as { readonly entries: readonly KeyObservation[] }).entries.map((e) =>
      e.key === KEY_TRUSTED ? { key: e.key, fingerprint: { status: "unavailable" as const } } : e);
    const d = decide({ ...evidence, source: { status: "listed", entries } });
    expect(d).toMatchObject({
      kind: "access",
      retirement: { rule: "B3", state: "resume", deletable: [KEY_SESSION], retainChanged: [KEY_SYNC_B], unverifiable: [KEY_TRUSTED] },
    });
  });
});

describe("Group C and the provenance table", () => {
  rcase("R52", "source enumeration failure blocks at C1 (D3 entry, validation); a failing read inside a plan halts", () => {
    expectBlocked(decide(evidenceOf(world({ source: null }))), "C1", "source_enumeration_failed");
    expectBlocked(decide(evidenceOf(world({ record: copyingBytes([]), source: null }))), "C1");
    expectBlocked(decide(evidenceOf(world({ record: verifiedBytes(), source: null }))), "C1");
    // During AP-K1′ and before activation: the plan's fresh read fails → halt at that read.
    const k1 = expectPlan(decide(evidenceOf(world({ record: enumeratingBytes() }))), "E′6", "AP-K1′");
    const readIndex = k1.steps.findIndex((s) => s.kind === "read_source");
    const halted = executePlan(world({ record: enumeratingBytes() }), k1, { inject: { [readIndex]: "read_fails" } });
    expect(halted.report).toMatchObject({ status: "halted", cause: "read_failed", haltedAtStep: readIndex });
    const v = world({ record: verifiedBytes(), rows: rowsOf(ELIGIBLE_BASE), marker: STORE_A });
    const act = expectPlan(decide(evidenceOf(v)), "E′11", "AP-ACT");
    const actRead = act.steps.findIndex((s) => s.kind === "read_source");
    expect(executePlan(v, act, { inject: { [actRead]: "read_fails" } }).report).toMatchObject({ status: "halted", cause: "read_failed" });
  });

  rcase("R53", "target row enumeration failure blocks at PV1 (no record) and PV9 (pre-active); never 'no rows'", () => {
    const none = decide(evidenceOf(world({ rows: null })));
    expectBlocked(none, "PV1", "target_rows_read_failed");
    const pre = decide(evidenceOf(world({ record: copyingBytes([]), rows: null, marker: STORE_A })));
    expectBlocked(pre, "PV9", "target_rows_read_failed");
    if (pre.kind === "blocked") expect(pre.retryMayResolve).toBe(true);
  });

  it("PV2 — application rows in a target without a record block, whatever the marker", () => {
    for (const marker of [null, STORE_A]) {
      expectBlocked(decide(evidenceOf(world({ rows: rowsOf([KEY_SESSION]), marker }))), "PV2", "target_rows_without_record");
    }
  });

  rcase("R11", "a marker present with no record blocks at PV5 — never adopted", () => {
    const d = decide(evidenceOf(world({ marker: STORE_A })));
    expectBlocked(d, "PV5", "marker_without_record");
  });

  rcase("R50", "a malformed marker blocks at PV4 (no record) and PV11 (record); bytes are never adopted", () => {
    expectBlocked(decide(evidenceOf(world({ marker: "not-a-uuid" }))), "PV4", "marker_malformed");
    expectBlocked(decide(evidenceOf(world({ record: enumeratingBytes(), marker: "ABCDEF01-1111-4111-8111-111111111111" }))), "PV11", "marker_malformed");
  });

  rcase("R51", "an unreadable marker blocks at PV3/PV10 and is never read as absent", () => {
    expectBlocked(decide(evidenceOf(world({ marker: "READ_FAILED" }))), "PV3", "marker_read_failed");
    const d = decide(evidenceOf(world({ record: enumeratingBytes(), marker: "READ_FAILED" })));
    expectBlocked(d, "PV10", "marker_read_failed");
    if (d.kind === "blocked") expect(d.retryMayResolve).toBe(true);
  });

  it("PV6 — no record, no marker, empty target, empty eligible source: the D1 plan; excluded keys do not count", () => {
    const d = decide(evidenceOf(world({ source: { [KEY_DIAGRAM]: "img", [KEY_CREDENTIAL]: "tok", [KEY_UNKNOWN]: "u" } })));
    const plan = expectPlan(d, "PV6", "D1");
    expect(plan.steps).toEqual([{ kind: "target_transaction", store: "target", transaction: { op: "create_fresh_active", generates: ["migrationId", "storeIdentity", "activatedAt"] } }]);
  });

  it("PV7 — a fresh migration: AP-D3 commits the record first and writes the marker only after it", () => {
    const plan = expectPlan(decide(evidenceOf(world())), "PV7", "AP-D3");
    expect(plan.steps.map((s) => (s.kind === "target_transaction" ? s.transaction.op : s.kind))).toEqual([
      "create_enumerating", "marker_write", "read_source", "recheck", "begin_copying",
    ]);
    expect(plan.steps[1]).toMatchObject({ kind: "marker_write", storeIdentity: { generatedInStep: 0 } });
    expect(plan.steps[0]).toMatchObject({ transaction: { entryKeys: ELIGIBLE_BASE } });
  });

  rcase("R45", "a foreign id with identical content in copying blocks at PV12 — not K2", () => {
    const d = decide(evidenceOf(world({ record: copyingBytes([KEY_SESSION]), rows: rowsOf([KEY_SESSION]), marker: STORE_FOREIGN })));
    expectBlocked(d, "PV12", "marker_foreign");
    expect(codes(d)).toEqual(["PV12:marker_foreign"]);
  });

  rcase("R46", "a foreign id with different content blocks at PV12, and the divergence is also reported", () => {
    const source = { ...BASE_SOURCE, [KEY_SESSION]: "different" };
    const d = decide(evidenceOf(world({ record: copyingBytes([]), source, marker: STORE_FOREIGN })));
    expectBlocked(d, "PV12");
    expect(codes(d)).toEqual(["PV12:marker_foreign", "E′7:source_content_diverged"]);
  });

  rcase("R47", "a foreign id in enumerating with nothing staged blocks at PV12 — no plan to overwrite or replace", () => {
    const d = decide(evidenceOf(world({ record: enumeratingBytes(), marker: STORE_FOREIGN })));
    expectBlocked(d, "PV12");
  });
});

describe("Group E′ — staging, divergence and the continuing rows", () => {
  rcase("R55", "a pre-activation row outside the manifest blocks at E′3; any row while enumerating at E′1", () => {
    expectBlocked(decide(evidenceOf(world({ record: copyingBytes([KEY_SESSION]), rows: { ...rowsOf([KEY_SESSION]), [KEY_NEW]: "?" }, marker: STORE_A }))), "E′3", "row_outside_manifest");
    expectBlocked(decide(evidenceOf(world({ record: enumeratingBytes(), rows: { [KEY_UNKNOWN]: "?" } }))), "E′1", "rows_while_enumerating");
  });

  rcase("R17", "rows without progress, or progress without rows, block at E′2 in both directions", () => {
    const rowsNoProgress = decide(evidenceOf(world({ record: copyingBytes([]), rows: rowsOf([KEY_SESSION]), marker: STORE_A })));
    expectBlocked(rowsNoProgress, "E′2", "row_without_progress");
    const progressNoRows = decide(evidenceOf(world({ record: copyingBytes([KEY_SESSION]), rows: {}, marker: STORE_A })));
    expectBlocked(progressNoRows, "E′2", "copied_without_row");
  });

  rcase("R25", "verified with complete copied but a row missing or mismatched blocks at E′2/E′4; never activated", () => {
    expectBlocked(decide(evidenceOf(world({ record: verifiedBytes(), rows: rowsOf([KEY_SESSION, KEY_SYNC_B, KEY_TRUSTED]), marker: STORE_A }))), "E′2", "copied_without_row");
    const mismatch = decide(evidenceOf(world({ record: verifiedBytes(), rows: { ...rowsOf(ELIGIBLE_BASE), [KEY_TRUSTED]: "tampered" }, marker: STORE_A })));
    expectBlocked(mismatch, "E′4", "row_fingerprint_mismatch");
  });

  it("staged-row digests: unavailable is I-1, malformed is I-7, omitted is evidence_required", () => {
    const base = evidenceOf(world({ record: copyingBytes([KEY_SESSION]), rows: rowsOf([KEY_SESSION]), marker: STORE_A }));
    const withRow = (fingerprint: unknown) => ({ ...base, targetRows: { status: "listed", entries: [{ key: KEY_SESSION, ...(fingerprint ? { fingerprint } : {}) }] } });
    expectBlocked(decideNativeMigration(withRow({ status: "unavailable" }), OPTIONS), "I-1", "row_fingerprint_unavailable");
    expectBlocked(decideNativeMigration(withRow({ status: "computed", value: "md5:abc" }), OPTIONS), "I-7", "row_fingerprint_malformed");
    expect(decideNativeMigration(withRow(undefined), OPTIONS)).toMatchObject({ kind: "evidence_required", missing: ["targetRowFingerprints"] });
  });

  it("source digests: unavailable is I-1, malformed is I-7, omitted is evidence_required — never a pass", () => {
    const base = evidenceOf(world({ record: copyingBytes([]), marker: STORE_A }));
    const entries = (fingerprint: unknown) => ELIGIBLE_BASE.map((key) =>
      key === KEY_SESSION ? { key, ...(fingerprint ? { fingerprint } : {}) } : { key, fingerprint: { status: "computed", value: fp(BASE_SOURCE[key]) } });
    expectBlocked(decideNativeMigration({ ...base, source: { status: "listed", entries: entries({ status: "unavailable" }) } }, OPTIONS), "I-1", "source_fingerprint_unavailable");
    expectBlocked(decideNativeMigration({ ...base, source: { status: "listed", entries: entries({ status: "computed", value: "?" }) } }, OPTIONS), "I-7", "source_fingerprint_malformed");
    expect(decideNativeMigration({ ...base, source: { status: "listed", entries: entries(undefined) } }, OPTIONS)).toMatchObject({ kind: "evidence_required", missing: ["sourceFingerprints"] });
  });

  rcase("R38", "marker alone removed, enumerating: E′6 (K1′) with the marker re-written under the existing id first", () => {
    const plan = expectPlan(decide(evidenceOf(world({ record: enumeratingBytes() }))), "E′6", "AP-K1′");
    expect(plan.steps[0]).toEqual({ kind: "marker_write", store: "source", storeIdentity: { existing: STORE_A } });
    expect(plan.steps[1]).toMatchObject({ transaction: { op: "replace_enumerating", storeIdentity: STORE_A, entryKeys: ELIGIBLE_BASE } });
  });

  rcase("R39", "marker and all eligible keys cleared while enumerating blocks at E′5 — not D1", () => {
    const d = decide(evidenceOf(world({ record: enumeratingBytes(), source: { [KEY_DIAGRAM]: "img" } })));
    expectBlocked(d, "E′5", "entry_key_vanished");
    if (d.kind === "blocked") expect(d.findings[0].detail).toEqual(ELIGIBLE_BASE);
  });

  rcase("R40", "marker and some eligible keys cleared while enumerating blocks at E′5", () => {
    const { [KEY_TRUSTED]: _gone, ...rest } = BASE_SOURCE;
    void _gone;
    expectBlocked(decide(evidenceOf(world({ record: enumeratingBytes(), source: rest }))), "E′5");
  });

  rcase("R41", "keys cleared in copying with copied = ∅ and with rows block at E′7; never re-enumerated", () => {
    const { [KEY_TRUSTED]: _gone, ...rest } = BASE_SOURCE;
    void _gone;
    for (const copied of [[], [KEY_SESSION]]) {
      const d = decide(evidenceOf(world({ record: copyingBytes(copied), rows: rowsOf(copied), source: rest })));
      expectBlocked(d, "E′7", "source_key_missing");
    }
    expectBlocked(decide(evidenceOf(world({ record: copyingBytes([]), source: {} }))), "E′7", "source_key_missing");
  });

  rcase("R42", "marker removed and one value changed blocks at E′7 (copying) and E′8 (verified)", () => {
    const changed = { ...BASE_SOURCE, [KEY_SYNC_B]: "changed" };
    expectBlocked(decide(evidenceOf(world({ record: copyingBytes([]), source: changed }))), "E′7", "source_content_diverged");
    expectBlocked(decide(evidenceOf(world({ record: verifiedBytes(), rows: rowsOf(ELIGIBLE_BASE), source: changed }))), "E′8", "source_content_diverged");
  });

  rcase("R43", "a new eligible key: AP-K1′ includes it while enumerating; E′7 blocks in copying", () => {
    const grown = { ...BASE_SOURCE, [KEY_NEW]: "new" };
    const plan = expectPlan(decide(evidenceOf(world({ record: enumeratingBytes(), source: grown }))), "E′6", "AP-K1′");
    expect(plan.steps[1]).toMatchObject({ transaction: { entryKeys: [...ELIGIBLE_BASE, KEY_NEW].sort() } });
    expectBlocked(decide(evidenceOf(world({ record: copyingBytes([]), source: grown }))), "E′7", "source_key_new");
  });

  rcase("R44", "a source cleared and repopulated: identical bytes continue; different content blocks at E′7", () => {
    expectPlan(decide(evidenceOf(world({ record: copyingBytes([]), source: { ...BASE_SOURCE } }))), "E′9", "AP-COPY");
    expectBlocked(decide(evidenceOf(world({ record: copyingBytes([]), source: { ...BASE_SOURCE, [KEY_SESSION]: "x" } }))), "E′7");
  });

  rcase("R63", "an access-barrier key present at D3 entry that vanishes blocks at E′5/E′7/E′8; never activated without it", () => {
    const source = { ...BASE_SOURCE, [KEY_BARRIER]: "barrier" };
    const { [KEY_BARRIER]: _gone, ...without } = source;
    void _gone;
    expectBlocked(decide(evidenceOf(world({ record: enumeratingBytes(Object.keys(source)), source: without }))), "E′5", "entry_key_vanished");
    expectBlocked(decide(evidenceOf(world({ record: copyingBytes([], source), source: without }))), "E′7", "source_key_missing");
    expectBlocked(decide(evidenceOf(world({ record: verifiedBytes(source), rows: source, source: without }))), "E′8", "source_key_missing");
  });

  rcase("R37", "marker alone removed, copying with ≥1 copied row: E′9 (K2) writes the marker first, staged rows untouched", () => {
    const w = world({ record: copyingBytes([KEY_SESSION]), rows: rowsOf([KEY_SESSION]) });
    const plan = expectPlan(decide(evidenceOf(w)), "E′9", "AP-COPY");
    expect(plan.steps[0]).toEqual({ kind: "marker_write", store: "source", storeIdentity: { existing: STORE_A } });
    const checkpoint = plan.steps.find((s) => s.kind === "target_transaction");
    expect(checkpoint).toMatchObject({ transaction: { op: "checkpoint", batch: [KEY_RESOLUTION, KEY_TRUSTED] } });
    expect(plan.steps.some((s) => s.kind === "target_transaction" && s.transaction.op === "checkpoint" && s.transaction.batch.includes(KEY_SESSION))).toBe(false);
  });

  it("zero copied rows in copying is not enumerating: a committed manifest is still validated and copied, never re-enumerated", () => {
    const plan = expectPlan(decide(evidenceOf(world({ record: copyingBytes([]), marker: STORE_A }))), "E′9", "AP-COPY");
    expect(plan.steps.some((s) => s.kind === "target_transaction" && s.transaction.op === "replace_enumerating")).toBe(false);
  });

  it("AP-CC and AP-ACT carry their own in-transaction evidence reads and a fresh source validation", () => {
    const cc = expectPlan(decide(evidenceOf(world({ record: copyingBytes(ELIGIBLE_BASE), rows: rowsOf(ELIGIBLE_BASE), marker: STORE_A }))), "E′10", "AP-CC");
    expect(cc.steps).toEqual([{ kind: "target_transaction", store: "target", transaction: { op: "complete_copying", readsInside: "complete_target_evidence" } }]);
    const act = expectPlan(decide(evidenceOf(world({ record: verifiedBytes(), rows: rowsOf(ELIGIBLE_BASE), marker: STORE_A }))), "E′11", "AP-ACT");
    expect(act.steps.map((s) => s.kind)).toEqual(["read_source", "recheck", "target_transaction"]);
    expect(act.steps[0]).toMatchObject({ fresh: true, purpose: "validate_source" });
    expect(act.steps[2]).toMatchObject({ transaction: { op: "activate", readsInside: "complete_target_evidence" } });
  });

  it("multiple staging defects: E′2 governs, E′3, E′4 and the divergence are all reported", () => {
    const d = decide(evidenceOf(world({
      record: copyingBytes([KEY_SESSION, KEY_SYNC_B]),
      rows: { [KEY_SYNC_B]: "tampered", [KEY_NEW]: "?" },
      source: { ...BASE_SOURCE, [KEY_TRUSTED]: "changed" },
      marker: STORE_A,
    })));
    expectBlocked(d, "E′2");
    expect(codes(d)).toEqual([
      "E′2:copied_without_row", "E′3:row_outside_manifest", "E′4:row_fingerprint_mismatch", "E′7:source_content_diverged",
    ]);
  });
});

describe("plans, halts and markers", () => {
  rcase("R8", "an AP-K1′ marker write rejected before applying halts with no target transaction issued; next PV14 → E′6", () => {
    const start = world({ record: enumeratingBytes() });
    const plan = expectPlan(decide(evidenceOf(start)), "E′6", "AP-K1′");
    const run = executePlan(start, plan, { inject: { 0: "reject_before_apply" } });
    expect(run.report).toMatchObject({ status: "halted", unknownStep: 0, confirmedWriteSteps: [], possiblyChangedStores: ["source"] });
    // Every later step is accounted for — the replacement, the read, the recheck and begin-copying.
    if (run.report?.status === "halted") {
      expect(run.report.notIssuedSteps).toEqual([1, 2, 3, 4]);
      expect(run.report.dispositions).toEqual(["outcome_unknown", "not_issued", "not_issued", "not_issued", "not_issued"]);
    }
    expect(run.world.record).toBe(start.record);
    expectPlan(decide(evidenceOf(run.world)), "E′6", "AP-K1′");
  });

  rcase("R9", "a marker write that applies and then rejects is outcome unknown in every plan; the marker reads equal (PV13)", () => {
    const cases: [World, string][] = [
      [world({ record: enumeratingBytes() }), "E′6"],
      [world({ record: copyingBytes([]) }), "E′9"],
      [world({ record: copyingBytes(ELIGIBLE_BASE), rows: rowsOf(ELIGIBLE_BASE) }), "E′10"],
      [world({ record: verifiedBytes(), rows: rowsOf(ELIGIBLE_BASE) }), "E′11"],
    ];
    for (const [start, rule] of cases) {
      const d = decide(evidenceOf(start));
      expect(d.kind).toBe("plan");
      if (d.kind !== "plan") continue;
      expect(d.rule).toBe(rule);
      const run = executePlan(start, d.plan, { inject: { 0: "apply_then_reject" } });
      expect(run.report).toMatchObject({ status: "halted", unknownStep: 0, possiblyChangedStores: ["source"] });
      expect(run.world.record).toBe(start.record);
      expect(run.world.marker).toBe(STORE_A);
      const next = decide(evidenceOf(run.world));
      expect(next.kind === "plan" && next.rule).toBe(rule);
      if (next.kind === "plan") expect(next.plan.steps[0].kind).not.toBe("marker_write");
    }
    // AP-D3: the record step was confirmed first, so the target changed by step 0, not by the marker step.
    const d3 = expectPlan(decide(evidenceOf(world())), "PV7", "AP-D3");
    const run = executePlan(world(), d3, { inject: { 1: "apply_then_reject" } });
    expect(run.report).toMatchObject({ status: "halted", confirmedWriteSteps: [0], unknownStep: 1, possiblyChangedStores: ["source", "target"] });
    const generatedId = parsed(run.world.record as string).storeIdentity;
    expect(run.world.marker).toBe(generatedId);
    expectPlan(decide(evidenceOf(run.world)), "E′6", "AP-K1′");
  });

  rcase("R10", "after a lost marker answer (warm) or death mid-write (cold) the marker read decides: PV13, PV14, PV11 or PV10", () => {
    const base = { record: enumeratingBytes() };
    expectPlan(decide(evidenceOf(world({ ...base, marker: STORE_A }))), "E′6", "AP-K1′");
    expectPlan(decide(evidenceOf(world({ ...base, marker: null }))), "E′6", "AP-K1′");
    expectBlocked(decide(evidenceOf(world({ ...base, marker: "half-writ" }))), "PV11");
    expectBlocked(decide(evidenceOf(world({ ...base, marker: "READ_FAILED" }))), "PV10");
    const plan = expectPlan(decide(evidenceOf(world(base))), "E′6", "AP-K1′");
    expect(executePlan(world(base), plan, { inject: { 0: "lost_ack" } }).report).toMatchObject({ status: "halted", unknownStep: 0 });
  });

  rcase("R12", "AP-D3's marker write failing after a confirmed record commit: step 0 confirmed, step 1 unknown; next PV13/PV14 → E′6", () => {
    const plan = expectPlan(decide(evidenceOf(world())), "PV7", "AP-D3");
    for (const injection of ["reject_before_apply", "apply_then_reject"] as const) {
      const run = executePlan(world(), plan, { inject: { 1: injection } });
      expect(run.report).toMatchObject({ status: "halted", confirmedWriteSteps: [0], unknownStep: 1, notIssuedSteps: [2, 3, 4] });
      expectPlan(decide(evidenceOf(run.world)), "E′6", "AP-K1′");
    }
  });

  rcase("R18", "a K2 marker write ending unknown in AP-COPY, AP-CC or AP-ACT halts with no target transaction issued", () => {
    for (const start of [
      world({ record: copyingBytes([]) }),
      world({ record: copyingBytes(ELIGIBLE_BASE), rows: rowsOf(ELIGIBLE_BASE) }),
      world({ record: verifiedBytes(), rows: rowsOf(ELIGIBLE_BASE) }),
    ]) {
      const first = decide(evidenceOf(start));
      if (first.kind !== "plan") throw new Error("expected a plan");
      const run = executePlan(start, first.plan, { inject: { 0: "reject_before_apply" } });
      expect(run.report).toMatchObject({ status: "halted", unknownStep: 0, possiblyChangedStores: ["source"] });
      expect(run.world.record).toBe(start.record);
      const again = decide(evidenceOf(run.world));
      expect(again.kind === "plan" && again.rule).toBe(first.rule);
    }
  });

  rcase("R23", "AP-CC finding a missing, extra or mismatched row or incomplete copied aborts before writing; next blocks at E′2/E′3/E′4", () => {
    const start = world({ record: copyingBytes(ELIGIBLE_BASE), rows: rowsOf(ELIGIBLE_BASE), marker: STORE_A });
    const plan = expectPlan(decide(evidenceOf(start)), "E′10", "AP-CC");
    const mutations: [(w: World) => void, string][] = [
      [(w) => { delete (w.rows as Record<string, string>)[KEY_TRUSTED]; }, "E′2"],
      [(w) => { (w.rows as Record<string, string>)[KEY_NEW] = "?"; }, "E′3"],
      [(w) => { (w.rows as Record<string, string>)[KEY_SESSION] = "tampered"; }, "E′4"],
    ];
    for (const [mutate, rule] of mutations) {
      const run = executePlan(start, plan, { before: { 0: mutate } });
      // The transaction's in-transaction reads RAN; only its write was never issued.
      expect(run.report).toMatchObject({
        status: "halted", cause: "aborted_before_write", dispositions: ["aborted_before_write"], notIssuedSteps: [], possiblyChangedStores: [],
      });
      expect(parsed(run.world.record as string).phase).toBe("copying");
      expectBlocked(decide(evidenceOf(run.world)), rule);
    }
    // Incomplete copied: the record itself mutated so progress no longer covers the manifest.
    const incomplete = executePlan(start, plan, { before: { 0: (w) => { w.record = copyingBytes([KEY_SESSION]); } } });
    expect(incomplete.report).toMatchObject({ status: "halted", cause: "aborted_before_write" });
  });

  rcase("R26", "final target evidence unreadable inside AP-CC or AP-ACT aborts before writing; persistent failure blocks at PV9", () => {
    const cc = world({ record: copyingBytes(ELIGIBLE_BASE), rows: rowsOf(ELIGIBLE_BASE), marker: STORE_A });
    const act = world({ record: verifiedBytes(), rows: rowsOf(ELIGIBLE_BASE), marker: STORE_A });
    for (const start of [cc, act]) {
      const d = decide(evidenceOf(start));
      if (d.kind !== "plan") throw new Error("expected a plan");
      const tx = d.plan.steps.length - 1;
      const run = executePlan(start, d.plan, { inject: { [tx]: "inside_read_fails" } });
      expect(run.report).toMatchObject({ status: "halted", cause: "aborted_before_write", unknownStep: null });
      expect(run.world.record).toBe(start.record);
      expect(decide(evidenceOf({ ...run.world, rows: null }))).toMatchObject({ kind: "blocked", rule: "PV9" });
    }
  });

  rcase("R27", "CE3: AP-ACT writes the marker, then the final source validation fails: halt at the recheck; next PV13 → E′8", () => {
    const start = world({ record: verifiedBytes(), rows: rowsOf(ELIGIBLE_BASE), marker: null });
    const plan = expectPlan(decide(evidenceOf(start)), "E′11", "AP-ACT");
    expect(plan.steps.map((s) => s.kind)).toEqual(["marker_write", "read_source", "recheck", "target_transaction"]);
    const run = executePlan(start, plan, { before: { 1: (w) => { (w.source as Record<string, string>)[KEY_SYNC_B] = "changed"; } } });
    expect(run.report).toMatchObject({
      status: "halted", haltedAtStep: 2, cause: "recheck_failed", confirmedWriteSteps: [0], completedSteps: [0, 1],
      notIssuedSteps: [3], dispositions: ["confirmed", "succeeded", "failed", "not_issued"], possiblyChangedStores: ["source"],
    });
    expect(run.world.marker).toBe(STORE_A);
    expectBlocked(decide(evidenceOf(run.world)), "E′8", "source_content_diverged");
    // With the marker write's outcome unknown instead, the next evaluation reads whatever landed.
    const unknown = executePlan(start, plan, { inject: { 0: "lost_ack" } });
    expect(unknown.report).toMatchObject({ status: "halted", unknownStep: 0 });
  });

  rcase("R59", "a source value changing after validation, before its checkpoint, halts before issuing; next E′7", () => {
    const start = world({ record: copyingBytes([]), marker: STORE_A });
    const plan = expectPlan(decide(evidenceOf(start)), "E′9", "AP-COPY");
    // The first batch is [accessBarrierResolution, trustedDevice]; change one of ITS values after validation.
    const run = executePlan(start, plan, { before: { 0: (w) => { (w.source as Record<string, string>)[KEY_RESOLUTION] = "changed"; } } });
    expect(run.report).toMatchObject({ status: "halted", cause: "recheck_failed", unknownStep: null, notIssuedSteps: [2] });
    expect(run.world.rows).toEqual({});
    expectBlocked(decide(evidenceOf(run.world)), "E′7", "source_content_diverged");
  });

  rcase("R60", "a write after the final validation and before the activation commit is a stated residual, not a detection", () => {
    const start = world({ record: verifiedBytes(), rows: rowsOf(ELIGIBLE_BASE), marker: STORE_A });
    const plan = expectPlan(decide(evidenceOf(start)), "E′11", "AP-ACT");
    const run = executePlan(start, plan, { before: { 2: (w) => { (w.source as Record<string, string>)[KEY_SESSION] = "older build"; } } });
    expect(run.report).toMatchObject({ status: "completed" });
    // Activation committed; the decision layer has no rule that detects this window (§5.5).
    expect(decide(evidenceOf(run.world)).kind).toBe("access");
  });

  it("the halt reducer rejects outcomes after a halt and outcomes that do not fit the step", () => {
    const plan = expectPlan(decide(evidenceOf(world())), "PV7", "AP-D3");
    expect(summarizePlanRun(plan, ["outcome_unknown", "confirmed"])).toEqual({ status: "invalid", problem: "outcome_after_halt" });
    expect(summarizePlanRun(plan, ["passed"])).toMatchObject({ status: "invalid" });
    expect(summarizePlanRun(plan, ["confirmed", "confirmed"])).toEqual({ status: "invalid", problem: "outcomes_incomplete" });
    expect(summarizePlanRun(plan, ["aborted_before_write"])).toMatchObject({ status: "invalid" });
  });
});

describe("contract, purity and independence", () => {
  rcase("R64", "provider credentials present, absent or unreadable change no decision", () => {
    const states = [world(), world({ record: copyingBytes([KEY_SESSION]), rows: rowsOf([KEY_SESSION]), marker: STORE_A }), world({ record: activeBytes() })];
    for (const w of states) {
      const without = decide(evidenceOf(w));
      const withCredentials = decide(evidenceOf({ ...w, source: w.source && { ...w.source, [KEY_CREDENTIAL]: "tok", [KEY_CREDENTIAL_VERIFIER]: "v" } }));
      expect(withCredentials).toEqual(without);
    }
    // An unreadable credential store is not an input at all: the evidence contract has no such field.
    expect(decideNativeMigration({ ...evidenceOf(world()), credentials: READ_FAILED }, OPTIONS)).toMatchObject({ kind: "invalid_evidence" });
  });

  rcase("R56", "three or more re-evaluations of a blocked snapshot give identical results and write nothing", () => {
    const evidence = evidenceOf(world({ record: copyingBytes([]), source: { ...BASE_SOURCE, [KEY_SESSION]: "x" }, marker: STORE_FOREIGN }));
    const frozen = structuredClone(evidence);
    const results = [1, 2, 3, 4].map(() => decide(evidence));
    for (const r of results) expect(r).toEqual(results[0]);
    expect(evidence).toEqual(frozen);
    expect(results[0].mountsOrdinaryConsumers).toBe(false);
  });

  it("inputs are never mutated and results are frozen (deeply frozen inputs would throw on mutation)", () => {
    const evidence = evidenceOf(world({ record: copyingBytes([KEY_SESSION]), rows: rowsOf([KEY_SESSION]), marker: STORE_A }));
    const result = decide(evidence);
    expect(Object.isFrozen(result)).toBe(true);
    if (result.kind === "plan") expect(Object.isFrozen(result.plan.steps)).toBe(true);
  });

  it("no hidden state between calls: interleaving unrelated snapshots changes nothing", () => {
    const a = evidenceOf(world({ record: enumeratingBytes() }));
    const b = evidenceOf(world({ latch: "{}" }));
    const first = decide(a);
    decide(b);
    decideNativeMigration(evidenceOf(world({ record: "{" })), OPTIONS);
    expect(decide(a)).toEqual(first);
  });

  it("invalid runtime values that bypass the types are rejected, never permitted", () => {
    const bad: unknown[] = [
      null, 42, "evidence", [],
      { latch: { status: "maybe" } },
      { latch: ABSENT, record: { status: "present" } },
      { latch: ABSENT, record: ABSENT, targetRows: { status: "listed", entries: [{ key: 1 }] } },
      { latch: ABSENT, record: ABSENT, targetRows: { status: "listed", entries: [{ key: "a" }, { key: "a" }] } },
      { latch: ABSENT, record: ABSENT, targetRows: { status: "listed", entries: [{ key: "curling.nativeMigration.activationRecord.v1" }] } },
      { latch: ABSENT, survivingPlan: { confirmedRows: "no" } },
      { inProcessFault: { latchContent: "x", latchWriteAttempts: ["maybe"] } },
    ];
    for (const evidence of bad) {
      const d = decideNativeMigration(evidence, OPTIONS);
      expect(d.kind, JSON.stringify(evidence)).toBe("invalid_evidence");
      expect(d.mountsOrdinaryConsumers).toBe(false);
    }
    for (const options of [null, {}, { ...OPTIONS, checkpointBatchKeyLimit: 0 }, { ...OPTIONS, latchWriteAttemptLimit: Infinity }]) {
      expect(decideNativeMigration(evidenceOf(world()), options).kind).toBe("invalid_evidence");
    }
  });

  it("an omitted observation a rule needs is evidence_required, not a successful empty read", () => {
    const { source: _s, ...noSource } = evidenceOf(world({ record: enumeratingBytes() }));
    void _s;
    expect(decide(noSource)).toMatchObject({ kind: "evidence_required", missing: ["source"] });
    const { marker: _m, targetRows: _t, ...noMarker } = evidenceOf(world({ record: enumeratingBytes() }));
    void _m; void _t;
    expect(decide(noMarker)).toMatchObject({ kind: "evidence_required", missing: ["targetRows", "marker"] });
    expect(decide({ latch: ABSENT, record: present(activeBytes()) })).toMatchObject({ kind: "evidence_required", missing: ["targetHealth"] });
  });

  it("only B4 permits ordinary access", () => {
    const decisions: NativeMigrationDecision[] = [
      decide(evidenceOf(world())),
      decide(evidenceOf(world({ latch: "x" }))),
      decide(evidenceOf(world({ record: verifiedBytes(), rows: rowsOf(ELIGIBLE_BASE), marker: STORE_A }))),
      decide(evidenceOf(world({ record: activeBytes() }))),
    ];
    expect(decisions.map(permitsOrdinaryAccess)).toEqual([false, false, false, true]);
  });

  it("a verified phase alone is never authority to activate: E′11 returns a plan, not access", () => {
    const d = decide(evidenceOf(world({ record: verifiedBytes(), rows: rowsOf(ELIGIBLE_BASE), marker: STORE_A })));
    expect(d.kind).toBe("plan");
    expect(permitsOrdinaryAccess(d)).toBe(false);
  });

  it("MIG_2 is a distinct canonical id used by structurally similar records", () => {
    expect(enumeratingBytes(ELIGIBLE_BASE, { migrationId: MIG_2 })).not.toBe(enumeratingBytes());
  });
});

type World = ReturnType<typeof world>;

it.each(["accountDeletionGuard", "accountDeletionGuardResolution"])("migration preserves opaque %s evidence in the initial inventory", family => {
  const key = `curling.identity.${family}.10000000-0000-4000-8000-000000000001.v1`;
  const result = decide(evidenceOf(world({ source: { ...BASE_SOURCE, [key]: "opaque denial evidence" } })));
  expect(result.kind).toBe("plan");
  expect(eligibleSourceKeys([{ key }])).toEqual([key]);
});
