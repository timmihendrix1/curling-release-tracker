// Warm recovery through the REAL I/O layer (Stage M3b4b, I-11/I-13): an
// unknown-outcome two-row checkpoint, then durable state and read failures
// arranged on the plugin-faithful engine, then the surviving runner's next
// evaluation. Covers the four latest warm counterexamples, their negative
// controls, confirmed-step contradictions with an unavailable record, and a
// combination matrix checked against a possible-worlds oracle written from
// I-11's before/after definitions. Class M; synthetic data only.
//
// The evidence collector always attempts the record read, so an UNOBSERVED
// record is not producible through this layer: counterexample A is exercised
// with an UNREADABLE record, which excludes nothing either. The unobserved form
// is covered at class L (`nativeMigrationWarmExclusion.test.ts`).
import { afterEach, describe, expect, it, vi } from "vitest";
import { serializeActivationRecord } from "../nativeMigrationRecord";
import type { NativeMigrationRunReport } from "../nativeMigrationRunner";
import { BASE_SOURCE, ELIGIBLE_BASE } from "./nativeMigrationTestKit";
import {
  LATCH_KEY,
  PLATFORMS,
  RECORD_KEY,
  boot,
  commitReaches,
  committedRecord,
  device,
  recordIn,
  type Device,
  type Process,
} from "./nativeMigrationMTestKit";
import type { PluginPlatform } from "./pluginFaithfulSqliteEngine";

afterEach(() => vi.unstubAllGlobals());

const [A, B] = [...ELIGIBLE_BASE].sort().slice(0, 2);
const firstCheckpoint = commitReaches("copying", (w) => (recordIn(w)?.copied?.length ?? 0) > 0);
const secondCheckpoint = commitReaches("copying", (w) => (recordIn(w)?.copied?.length ?? 0) > 2);

interface Unknown {
  d: Device;
  p: Process;
  before: string;
  after: string;
  /** Live read-failure switches consulted by the engine's query hook. */
  fail: { record: boolean; values: Set<string>; listing: boolean };
}

/** A surviving process whose first checkpoint (rows A and B) ended with an unknown outcome — never committed. */
async function unknownCheckpoint(platform: PluginPlatform): Promise<Unknown> {
  const d = device(platform, BASE_SOURCE);
  const fail = { record: false, values: new Set<string>(), listing: false };
  let after = "";
  const p = await boot(d, {
    faults: {
      onCommit: (w) => {
        if (!firstCheckpoint(w) || after !== "") return "ok";
        after = w.get(RECORD_KEY) as string;
        return "reject_before_effect";
      },
      onQuery: (sql, values) => {
        if (fail.listing && (sql === "SELECT key FROM records ORDER BY key")) return { reject: true };
        if (fail.record && values[0] === RECORD_KEY) return { reject: true };
        if (/SELECT value FROM/.test(sql) && fail.values.has(String(values[0]))) return { reject: true };
        return undefined;
      },
    },
  });
  const halted = await p.run();
  if (halted.outcome !== "halted") throw new Error(JSON.stringify(halted));
  const before = d.state.rows.get(RECORD_KEY) as string;
  expect(committedRecord(d)?.copied).toEqual([]);
  expect(recordIn(new Map([[RECORD_KEY, after]]))?.copied).toEqual([A, B]);
  return { d, p, before, after, fail };
}

function neither(bytes: string): string {
  const record = recordIn(new Map([[RECORD_KEY, bytes]]));
  if (!record) throw new Error("invalid");
  return serializeActivationRecord({ ...record, migrationId: "99999999-9999-4999-8999-999999999999" });
}

function expectDetected(report: NativeMigrationRunReport, d: Device, code = "warm_state_matches_neither"): void {
  expect(report.outcome, JSON.stringify(report)).toBe("fault");
  if (report.outcome !== "fault") return;
  expect(report.findings[0].code).toBe(code);
  expect(report.latch.established).toBe("confirmed");
  expect(d.state.rows.has(LATCH_KEY)).toBe(true);
  // Only metadata: no application value in the report or the latch.
  for (const value of Object.values(BASE_SOURCE)) {
    expect(JSON.stringify(report)).not.toContain(value);
    expect(d.state.rows.get(LATCH_KEY)).not.toContain(value);
  }
}

describe.each(PLATFORMS)("%s — the four warm counterexamples through I/O", (platform) => {
  it("A: unreadable record; A present with its issued bytes, B positively absent → detected fault with the latch written", async () => {
    const u = await unknownCheckpoint(platform);
    u.d.state.rows.set(A, BASE_SOURCE[A]);
    u.fail.record = true;
    expectDetected(await u.p.run(), u.d);
  });

  it("B: unreadable record; an inserted row with different bytes → detected fault, not A1", async () => {
    const u = await unknownCheckpoint(platform);
    u.d.state.rows.set(A, "different bytes");
    u.fail.record = true;
    expectDetected(await u.p.run(), u.d);
  });

  it("C: the after-record; the complete listing lacks B; row values unreadable → detected fault", async () => {
    const u = await unknownCheckpoint(platform);
    u.d.state.rows.set(RECORD_KEY, u.after);
    u.d.state.rows.set(A, BASE_SOURCE[A]);
    u.fail.values = new Set([A, B]);
    expectDetected(await u.p.run(), u.d);
  });

  it("D: the before-record; the complete listing contains B; row values unreadable → detected fault", async () => {
    const u = await unknownCheckpoint(platform);
    u.d.state.rows.set(B, BASE_SOURCE[B]);
    u.fail.values = new Set([A, B]);
    expectDetected(await u.p.run(), u.d);
  });
});

describe.each(PLATFORMS)("%s — negative controls: one candidate remains possible", (platform) => {
  const controls: [string, (u: Unknown) => void, string][] = [
    ["before-record, listing shows both absent, values unreadable", (u) => { u.fail.values = new Set([A, B]); }, "I-1"],
    ["after-record, listing shows both, values unreadable", (u) => {
      u.d.state.rows.set(RECORD_KEY, u.after);
      u.d.state.rows.set(A, BASE_SOURCE[A]);
      u.d.state.rows.set(B, BASE_SOURCE[B]);
      u.fail.values = new Set([A, B]);
    }, "I-1"],
    ["unreadable record, both rows issued", (u) => {
      u.d.state.rows.set(A, BASE_SOURCE[A]);
      u.d.state.rows.set(B, BASE_SOURCE[B]);
      u.fail.record = true;
    }, "A1"],
    ["unreadable record, both rows absent", (u) => { u.fail.record = true; }, "A1"],
    ["unreadable record and listing, values unreadable", (u) => { u.fail.record = true; u.fail.listing = true; u.fail.values = new Set([A, B]); }, "A1"],
  ];
  for (const [label, arrange, rule] of controls) {
    it(`${label}: blocked (${rule}), never a fault and never a write`, async () => {
      const u = await unknownCheckpoint(platform);
      arrange(u);
      const rows = new Map(u.d.state.rows);
      const report = await u.p.run();
      expect(report.outcome, JSON.stringify(report)).toBe("blocked");
      if (report.outcome === "blocked") expect(report.rule).toBe(rule);
      expect(u.d.state.rows).toEqual(rows);
    });
  }
});

describe.each(PLATFORMS)("%s — confirmed-step contradiction with the record unavailable", (platform) => {
  async function confirmedThenUnknown() {
    const d = device(platform, BASE_SOURCE);
    const fail = { record: false, values: false };
    const p = await boot(d, {
      faults: {
        onCommit: (w) => (secondCheckpoint(w) ? "reject_before_effect" : "ok"),
        onQuery: (sql, values) => {
          if (fail.record && values[0] === RECORD_KEY) return { reject: true };
          if (fail.values && /SELECT value FROM/.test(sql) && values[0] !== RECORD_KEY && values[0] !== LATCH_KEY) return { reject: true };
          return undefined;
        },
      },
    });
    await p.run();
    expect(committedRecord(d)?.copied).toEqual([A, B]);
    return { d, p, fail };
  }

  it("a confirmed row deleted, record unreadable → fault (by its absent value)", async () => {
    const { d, p, fail } = await confirmedThenUnknown();
    d.state.rows.delete(A);
    fail.record = true;
    const report = await p.run();
    expect(report.outcome).toBe("fault");
    if (report.outcome === "fault") expect(report.findings[0]).toEqual({ rule: "I-13", code: "confirmed_step_contradicted", detail: [A] });
  });

  it("a confirmed row deleted, record AND row values unreadable → fault (by the complete listing)", async () => {
    const { d, p, fail } = await confirmedThenUnknown();
    d.state.rows.delete(A);
    fail.record = true;
    fail.values = true;
    const report = await p.run();
    expect(report.outcome).toBe("fault");
  });

  it("control: confirmed rows intact, record and values unreadable → blocked, no fault", async () => {
    const { p, fail } = await confirmedThenUnknown();
    fail.record = true;
    fail.values = true;
    expect((await p.run()).outcome).toBe("blocked");
  });
});

describe.each(PLATFORMS)("%s — combination matrix against the possible-worlds oracle", (platform) => {
  type RecordCase = "before" | "after" | "neither" | "read_failed";
  type RowCase = "issued" | "different" | "absent";
  const RECORDS: RecordCase[] = ["before", "after", "neither", "read_failed"];
  const ROWS: RowCase[] = ["issued", "different", "absent"];

  for (const record of RECORDS) {
    it(`record ${record}: every row pair × value reads ok/failed × listing ok/failed`, async () => {
      let faults = 0;
      for (const a of ROWS) {
        for (const b of ROWS) {
          for (const valuesFail of [false, true]) {
            for (const listingFails of [false, true]) {
              const label = `record ${record}, a ${a}, b ${b}, values ${valuesFail ? "failed" : "ok"}, listing ${listingFails ? "failed" : "ok"}`;
              const u = await unknownCheckpoint(platform);
              if (record === "after") u.d.state.rows.set(RECORD_KEY, u.after);
              if (record === "neither") u.d.state.rows.set(RECORD_KEY, neither(u.before));
              u.fail.record = record === "read_failed";
              for (const [key, rowCase] of [[A, a], [B, b]] as const) {
                if (rowCase === "issued") u.d.state.rows.set(key, BASE_SOURCE[key]);
                if (rowCase === "different") u.d.state.rows.set(key, "different bytes");
              }
              if (valuesFail) u.fail.values = new Set([A, B]);
              u.fail.listing = listingFails;

              // The oracle: would reading each candidate world have produced these observations?
              const observedRecord = record === "read_failed" ? null : u.d.state.rows.get(RECORD_KEY);
              const candidates = [
                { record: u.before, rows: {} as Record<string, string> },
                { record: u.after, rows: { [A]: BASE_SOURCE[A], [B]: BASE_SOURCE[B] } },
              ];
              const consistent = candidates.filter((candidate) => {
                if (observedRecord !== null && observedRecord !== candidate.record) return false;
                for (const key of [A, B]) {
                  const stored = u.d.state.rows.get(key);
                  if (!valuesFail && stored !== candidate.rows[key]) return false;
                  if (!listingFails && (stored !== undefined) !== (key in candidate.rows)) return false;
                }
                return true;
              });
              const report = await u.p.run();
              if (consistent.length === 0) {
                faults += 1;
                expect(report.outcome, label).toBe("fault");
                expect(u.d.state.rows.has(LATCH_KEY), label).toBe(true);
              } else {
                expect(report.outcome, `${label} ${JSON.stringify(report)}`).not.toBe("fault");
                expect(u.d.state.rows.has(LATCH_KEY), label).toBe(false);
              }
            }
          }
        }
      }
      // Non-vacuous: each record case contains detected faults.
      expect(faults).toBeGreaterThan(0);
    });
  }
});
