import { describe, expect, it } from "vitest";
import {
  BROWER_CHRON_MAX_SPLITS,
  appendixContinuesRecord,
  assembleBrowerChronRecord,
  browerIntervalSeconds,
  decodeBrowerChronAppendixPacket,
  decodeBrowerChronBasePacket,
  deriveBrowerChronIntervals,
  formatBrowerTruncatedHundredths,
  toBrowerHexDigits,
} from "../chronDecoder";

function bytes(hex: string): Uint8Array {
  const clean = hex.replace(/\s/g, "");
  const out = new Uint8Array(clean.length / 2);
  for (let index = 0; index < out.length; index += 1) {
    out[index] = Number.parseInt(clean.slice(index * 2, index * 2 + 2), 16);
  }
  return out;
}

// --- The canonical fixture ---------------------------------------------------------
//
// The three 20-byte notifications recorded in docs/BROWER_INTEGRATION_STATUS.md,
// "Additional training comparison (analysed 2026-09-30)". They are ONE record —
// a base packet plus two appendix packets — not three independent athletes.
const FIXTURE_BASE = bytes("00 10 00 FF 00 00 00 16 CD E0 0E D6 09 16 00 A0 34 12 BD 42");
const FIXTURE_APPENDIX_1 = bytes("13 A2 31 CA 1C 1D 93 13 01 91 31 0E 33 BF 68 3C DE 94 8E 76");
const FIXTURE_APPENDIX_2 = bytes("49 D4 95 35 5C 54 43 F6 4B E2 65 A9 17 5F 62 76 DD B8 14 4B");

/** The 20 cumulative values the document states this fixture yields. */
const FIXTURE_CUMULATIVE_MS = [
  3798, 37216, 41012, 76756, 80419, 117276, 121137, 197009, 200931, 245608, 249321,
  298614, 302409, 341340, 345151, 412642, 416401, 483170, 486875, 529483,
];


/**
 * Builds a base packet from its documented fields rather than from a hand-counted hex
 * string, so a fixture can never silently drift out of the 40-digit layout.
 */
function baseHex(fields: {
  memoryLocation?: string;
  athleteNumber?: string;
  unattributed?: string;
  startTime?: string;
  splits: [number, number, number, number];
  appendixCount: number;
}): Uint8Array {
  const field = (value: number) => value.toString(16).toUpperCase().padStart(5, "0");
  const digits =
    (fields.memoryLocation ?? "001") +
    (fields.athleteNumber ?? "000") +
    (fields.unattributed ?? "FF0000") +
    (fields.startTime ?? "0064CFF") +
    fields.splits.map(field).join("") +
    fields.appendixCount.toString(16).toUpperCase();
  if (digits.length !== 40) {
    throw new Error(`base fixture is ${digits.length} digits, expected 40`);
  }
  return bytes(digits);
}

/** Builds an appendix packet from up to eight split values, zero-filling the rest. */
function appendixHex(splits: number[]): Uint8Array {
  const padded = [...splits, ...Array<number>(8 - splits.length).fill(0)];
  return bytes(padded.map((value) => value.toString(16).toUpperCase().padStart(5, "0")).join(""));
}

// --- The 2026-09-28 multi-split record ---------------------------------------------
//
// Reconstructed from the field values the document records for export 02's final base
// packet (splits 3575 / 14888 / 20733 / 33779, appendix count 1) and its appendix
// packet (split 5 = 44693, then seven zeros).
const EXPORT_02_BASE = baseHex({ splits: [3575, 14888, 20733, 33779], appendixCount: 1 });
const EXPORT_02_APPENDIX = appendixHex([44693]);

describe("packet-level decoding", () => {
  it("reads every documented base-packet field of the canonical fixture", () => {
    const decoded = decodeBrowerChronBasePacket(FIXTURE_BASE);
    expect(decoded.kind).toBe("base");
    if (decoded.kind !== "base") return;

    expect(decoded.memoryLocationDigits).toBe("001");
    expect(decoded.athleteNumberDigits).toBe("000");
    expect(decoded.unattributedDigits).toBe("FF0000");
    expect(decoded.startTimeDigits).toBe("0016CDE");
    expect(decoded.splitFields).toEqual([3798, 37216, 41012, 76756]);
    expect(decoded.appendixCount).toBe(2);
  });

  it.each(["000", "1F4", "FFF"])("rejects unsupported memory slot %s", (memoryLocation) => {
    expect(decodeBrowerChronBasePacket(baseHex({ memoryLocation, splits: [1000, 0, 0, 0], appendixCount: 0 })).kind).toBe("invalid");
  });

  it("rejects session headers rather than treating them as athlete measurements", () => {
    expect(decodeBrowerChronBasePacket(baseHex({ athleteNumber: "3E8", splits: [1000, 0, 0, 0], appendixCount: 0 })).kind).toBe("invalid");
    expect(decodeBrowerChronBasePacket(baseHex({ memoryLocation: "1F3", splits: [1000, 0, 0, 0], appendixCount: 0 })).kind).toBe("base");
  });

  it("reads each appendix packet as eight 5-digit split fields", () => {
    const first = decodeBrowerChronAppendixPacket(FIXTURE_APPENDIX_1);
    const second = decodeBrowerChronAppendixPacket(FIXTURE_APPENDIX_2);
    expect(first.kind).toBe("appendix");
    expect(second.kind).toBe("appendix");
    if (first.kind !== "appendix" || second.kind !== "appendix") return;

    expect(first.splitFields).toEqual(FIXTURE_CUMULATIVE_MS.slice(4, 12));
    expect(second.splitFields).toEqual(FIXTURE_CUMULATIVE_MS.slice(12, 20));
  });

  it("renders bytes as uppercase hexadecimal digits", () => {
    expect(toBrowerHexDigits(new Uint8Array([0x00, 0x0a, 0xff]))).toBe("000AFF");
  });

  it.each([0, 1, 19, 21, 40])("rejects a %i-byte packet rather than decoding part of it", (length) => {
    const base = decodeBrowerChronBasePacket(new Uint8Array(length));
    expect(base.kind).toBe("invalid");
    const appendix = decodeBrowerChronAppendixPacket(new Uint8Array(length));
    expect(appendix.kind).toBe("invalid");
  });

  it("rejects an appendix count above the documented maximum of two", () => {
    const overCount = baseHex({ splits: [3798, 37216, 41012, 76756], appendixCount: 3 });
    const decoded = decodeBrowerChronBasePacket(overCount);
    expect(decoded.kind).toBe("invalid");
    if (decoded.kind !== "invalid") return;
    expect(decoded.reason).toMatch(/exceeds the documented maximum/);
  });
});

describe("record assembly", () => {
  function assembleFixture(appendices: Uint8Array[] = [FIXTURE_APPENDIX_1, FIXTURE_APPENDIX_2]) {
    const base = decodeBrowerChronBasePacket(FIXTURE_BASE);
    if (base.kind !== "base") throw new Error("fixture base packet must decode");
    return assembleBrowerChronRecord(base, appendices);
  }

  it("reproduces all twenty documented cumulative values from the three-packet fixture", () => {
    const assembly = assembleFixture();
    expect(assembly.status).toBe("record");
    if (assembly.status !== "record") return;
    expect(assembly.record.cumulativeMs).toEqual(FIXTURE_CUMULATIVE_MS);
    expect(assembly.record.key).toBe("001-000-0016CDE");
  });

  it("treats the three notifications as one record, not three athletes", () => {
    const assembly = assembleFixture();
    if (assembly.status !== "record") throw new Error("expected a record");
    expect(assembly.record.cumulativeMs).toHaveLength(BROWER_CHRON_MAX_SPLITS);
    expect(assembly.record.appendixCount).toBe(2);
  });

  it("reports an under-delivered appendix as incomplete and decodes nothing", () => {
    const assembly = assembleFixture([FIXTURE_APPENDIX_1]);
    expect(assembly).toEqual({
      status: "incomplete",
      expectedAppendixCount: 2,
      receivedAppendixCount: 1,
    });
  });

  it("rejects more appendix packets than the base packet declares", () => {
    const assembly = assembleFixture([
      FIXTURE_APPENDIX_1,
      FIXTURE_APPENDIX_2,
      FIXTURE_APPENDIX_2,
    ]);
    expect(assembly.status).toBe("invalid");
  });

  it("assembles the 2026-09-28 export-02 record across the first appendix boundary", () => {
    const base = decodeBrowerChronBasePacket(EXPORT_02_BASE);
    if (base.kind !== "base") throw new Error("export 02 base packet must decode");
    expect(base.appendixCount).toBe(1);
    expect(base.startTimeDigits).toBe("0064CFF");

    const assembly = assembleBrowerChronRecord(base, [EXPORT_02_APPENDIX]);
    if (assembly.status !== "record") throw new Error("expected a record");
    expect(assembly.record.cumulativeMs).toEqual([3575, 14888, 20733, 33779, 44693]);
  });

  it("reports a record with no measured split as empty, not as a measurement", () => {
    const base = decodeBrowerChronBasePacket(baseHex({ splits: [0, 0, 0, 0], appendixCount: 0 }));
    if (base.kind !== "base") throw new Error("packet must decode");
    expect(assembleBrowerChronRecord(base, [])).toMatchObject({ status: "empty", record: { cumulativeMs: [] } });
  });

  it("rejects a used split that follows an unused one", () => {
    // Splits 1, 2 and 4 used, split 3 zero — not a contiguous run.
    const base = decodeBrowerChronBasePacket(
      baseHex({ splits: [3575, 14888, 0, 33779], appendixCount: 0 })
    );
    if (base.kind !== "base") throw new Error("packet must decode");
    const assembly = assembleBrowerChronRecord(base, []);
    expect(assembly.status).toBe("invalid");
    if (assembly.status !== "invalid") return;
    expect(assembly.reason).toMatch(/contiguous/);
  });

  it.each([
    ["equal", 14888],
    ["decreasing", 2560],
  ])("rejects a %s cumulative split", (_label, thirdSplit) => {
    const base = decodeBrowerChronBasePacket(
      baseHex({ splits: [3575, 14888, thirdSplit, 0], appendixCount: 0 })
    );
    if (base.kind !== "base") throw new Error("packet must decode");
    const assembly = assembleBrowerChronRecord(base, []);
    expect(assembly.status).toBe("invalid");
    if (assembly.status !== "invalid") return;
    expect(assembly.reason).toMatch(/does not increase/);
  });

  it("rejects an appendix declared while the base packet's own splits are unfilled", () => {
    // Appendix count 1, but only two base splits used: split 5 cannot exist yet, so
    // the appendix's value lands after a gap.
    const base = decodeBrowerChronBasePacket(
      baseHex({ splits: [3575, 14888, 0, 0], appendixCount: 1 })
    );
    if (base.kind !== "base") throw new Error("packet must decode");
    const assembly = assembleBrowerChronRecord(base, [EXPORT_02_APPENDIX]);
    expect(assembly.status).toBe("invalid");
    if (assembly.status !== "invalid") return;
    expect(assembly.reason).toMatch(/contiguous/);
  });

  it("rejects a declared appendix that carries no split at all", () => {
    const base = decodeBrowerChronBasePacket(
      baseHex({ splits: [3575, 14888, 20733, 33779], appendixCount: 1 })
    );
    if (base.kind !== "base") throw new Error("packet must decode");
    const assembly = assembleBrowerChronRecord(base, [appendixHex([])]);
    expect(assembly.status).toBe("invalid");
    if (assembly.status !== "invalid") return;
    expect(assembly.reason).toMatch(/only 4 split/);
  });

  it("rejects a second appendix while the first is not completely filled", () => {
    const base = decodeBrowerChronBasePacket(FIXTURE_BASE);
    if (base.kind !== "base") throw new Error("packet must decode");
    // Appendix 1 carries a single split; appendix 2 must then be impossible.
    const sparseAppendix = appendixHex([80419]);
    const assembly = assembleBrowerChronRecord(base, [sparseAppendix, FIXTURE_APPENDIX_2]);
    expect(assembly.status).toBe("invalid");
  });

  it("rejects a malformed appendix rather than assembling the base packet alone", () => {
    const base = decodeBrowerChronBasePacket(EXPORT_02_BASE);
    if (base.kind !== "base") throw new Error("packet must decode");
    const assembly = assembleBrowerChronRecord(base, [new Uint8Array(19)]);
    expect(assembly.status).toBe("invalid");
    if (assembly.status !== "invalid") return;
    expect(assembly.reason).toMatch(/Appendix packet/);
  });
});

describe("SEG derivation", () => {
  it("reproduces the ten independently recomputed CSV comparisons", () => {
    const intervals = deriveBrowerChronIntervals(FIXTURE_CUMULATIVE_MS);
    // The document's operator selected split 1 and the intervals ending at splits
    // 3, 5, ... 19. The decoder offers every interval; this only checks the arithmetic.
    const selected = [1, 3, 5, 7, 9, 11, 13, 15, 17, 19].map(
      (splitIndex) => intervals.find((interval) => interval.splitIndex === splitIndex)!
    );

    expect(selected.map((interval) => interval.intervalMs)).toEqual([
      3798, 3796, 3663, 3861, 3922, 3713, 3795, 3811, 3759, 3705,
    ]);
    expect(selected.map((interval) => formatBrowerTruncatedHundredths(interval.intervalMs))).toEqual([
      "3.79", "3.79", "3.66", "3.86", "3.92", "3.71", "3.79", "3.81", "3.75", "3.70",
    ]);
  });

  it("takes the first interval relative to the original start", () => {
    const [first] = deriveBrowerChronIntervals([3798, 37216]);
    expect(first).toEqual({ splitIndex: 1, intervalMs: 3798, cumulativeMs: 3798 });
    expect(first.precedingCumulativeMs).toBeUndefined();
  });

  it("keeps the cumulative context of every later interval", () => {
    const intervals = deriveBrowerChronIntervals([3798, 37216, 41012]);
    expect(intervals[2]).toEqual({
      splitIndex: 3,
      intervalMs: 3796,
      cumulativeMs: 41012,
      precedingCumulativeMs: 37216,
    });
  });

  it("derives one interval per split, including the twentieth", () => {
    const intervals = deriveBrowerChronIntervals(FIXTURE_CUMULATIVE_MS);
    expect(intervals).toHaveLength(BROWER_CHRON_MAX_SPLITS);
    expect(intervals.at(-1)).toMatchObject({ splitIndex: 20, intervalMs: 42608 });
  });

  it("subtracts before truncating, never after", () => {
    // Truncating each cumulative value to hundredths first would give 5.42 - 1.99 = 3.43.
    const [, second] = deriveBrowerChronIntervals([1999, 5429]);
    expect(second.intervalMs).toBe(3430);
    expect(formatBrowerTruncatedHundredths(second.intervalMs)).toBe("3.43");
  });

  it("preserves millisecond precision in the accepted seconds value", () => {
    expect(browerIntervalSeconds(3798)).toBe(3.798);
    expect(browerIntervalSeconds(5415)).toBe(5.415);
  });

  it("truncates the display value rather than rounding it", () => {
    // The one documented behaviour the physical collections corroborated seven times.
    expect(formatBrowerTruncatedHundredths(19999)).toBe("19.99");
    expect(formatBrowerTruncatedHundredths(5415)).toBe("5.41");
    expect(formatBrowerTruncatedHundredths(10232)).toBe("10.23");
    expect(formatBrowerTruncatedHundredths(2704)).toBe("2.70");
  });
});

describe("telling an appendix from a base packet", () => {
  it("accepts a packet that continues the record's cumulative sequence", () => {
    expect(appendixContinuesRecord(appendixHex([44693]), 33779)).toBe(true);
    expect(
      appendixContinuesRecord(appendixHex([80419, 117276, 121137]), 76756)
    ).toBe(true);
  });

  it("rejects a NEW BASE PACKET arriving while an appendix is outstanding", () => {
    // The dangerous case: consuming this as an appendix could assemble a
    // coherent-looking record out of identity digits and present fabricated times.
    const newRecordBase = baseHex({
      memoryLocation: "002",
      splits: [3575, 14888, 20733, 33779],
      appendixCount: 0,
    });
    expect(appendixContinuesRecord(newRecordBase, 33779)).toBe(false);
  });

  it("rejects a base packet whose memory location alone would clear the last split", () => {
    // Memory location 0x084 makes appendix field 0 read as 33792, above the record's
    // last split — the increasing-run check is what still refuses it.
    const highLocationBase = baseHex({
      memoryLocation: "084",
      splits: [3575, 14888, 20733, 33779],
      appendixCount: 1,
    });
    expect(appendixContinuesRecord(highLocationBase, 33779)).toBe(false);
  });

  it("rejects an update of the SAME base packet", () => {
    const base = baseHex({ splits: [3575, 14888, 20733, 33779], appendixCount: 1 });
    expect(appendixContinuesRecord(base, 33779)).toBe(false);
  });

  it("rejects a packet that does not exceed the record's last split", () => {
    expect(appendixContinuesRecord(appendixHex([33779]), 33779)).toBe(false);
    expect(appendixContinuesRecord(appendixHex([1000]), 33779)).toBe(false);
  });

  it("rejects a declared appendix carrying nothing", () => {
    expect(appendixContinuesRecord(appendixHex([]), 33779)).toBe(false);
  });

  it("rejects a non-contiguous or non-increasing appendix", () => {
    expect(appendixContinuesRecord(appendixHex([44693, 0, 50000]), 33779)).toBe(false);
    expect(appendixContinuesRecord(appendixHex([44693, 44000]), 33779)).toBe(false);
  });

  it("rejects a malformed packet", () => {
    expect(appendixContinuesRecord(new Uint8Array(10), 0)).toBe(false);
  });
});
