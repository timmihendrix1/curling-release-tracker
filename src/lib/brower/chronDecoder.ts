// The narrow CHRON candidate decoder authorised by the assisted training pilot
// (docs/BROWER_INTEGRATION_STATUS.md, "Assisted training pilot decision (2026-09-30)").
//
// SCOPE. This decodes exactly the subset of the manufacturer layout that the archived
// evidence supports, and nothing else:
//
//   - the base Split packet's Memory Location, Athlete Number, start-time and appendix-
//     count fields, plus its four split fields;
//   - both appendix packets, read as eight 5-digit split fields each.
//
// Every field position and width below is transcribed from
// `docs/hardware/brower/TC Timer BLE to Smartphone BLE Communication V4.docx` as
// recorded in `docs/BROWER_INTEGRATION_STATUS.md`. The nibble order (high nibble first,
// most-significant digit first) is the one the archived comparisons reproduce.
//
// WHAT THIS FILE DELIBERATELY DOES NOT DO.
//
//   - It does not decide which interval belongs to a shot. No start/finish pairing, no
//     alternating-split parity, no ten-second cutoff, no "last non-zero split is the
//     result" rule. The operator selects the interval; see `assistedCapture.ts`.
//   - It does not interpret the start-time field as a wall-clock instant. Time Base
//     semantics are unresolved, so the field is carried as opaque digits and used only
//     as part of a record's identity.
//   - It does not name the unattributed digits 6-11. Both archived collections show
//     `FF0000` there; two observations are not a documented meaning, so the digits are
//     carried verbatim and never interpreted.
//   - It does not treat a repeat, an update or a longer snapshot as proof of finality.
//     Nothing in the observed bytes marks a record final, and nothing here pretends to.
//
// The unit here is a RECORD, not a packet. One athlete occupies one base packet plus up
// to two appendix packets; the 2026-09-30 three-packet fixture is one record, never
// three independent athletes.

/** Every Athlete Data notification the documented layout describes is 20 bytes. */
export const BROWER_CHRON_PACKET_BYTE_LENGTH = 20;

/** Splits 1-4 live in the base packet. */
export const BROWER_CHRON_BASE_SPLIT_COUNT = 4;

/** Splits 5-12 and 13-20 live in one appendix packet each. */
export const BROWER_CHRON_APPENDIX_SPLIT_COUNT = 8;

/** Documented maximum: each memory location holds up to 20 split times. */
export const BROWER_CHRON_MAX_SPLITS = 20;

/** Documented maximum: a base Split packet plus at most two appendix packets. */
export const BROWER_CHRON_MAX_APPENDIX_COUNT = 2;

/** Width of one packed split field, in hexadecimal digits (2.5 bytes). */
const SPLIT_FIELD_DIGITS = 5;

/** Base-packet field offsets, in hexadecimal digits from the start of the packet. */
const MEMORY_LOCATION_DIGITS = { start: 0, end: 3 } as const;
const ATHLETE_NUMBER_DIGITS = { start: 3, end: 6 } as const;
const UNATTRIBUTED_DIGITS = { start: 6, end: 12 } as const;
const START_TIME_DIGITS = { start: 12, end: 19 } as const;
const FIRST_BASE_SPLIT_DIGIT = 19;
const APPENDIX_COUNT_DIGIT = 39;

/**
 * Renders a packet as uppercase hexadecimal digits. The documented layout is expressed
 * in half-byte fields, so digits — not bytes — are the natural unit to slice.
 */
export function toBrowerHexDigits(bytes: Uint8Array): string {
  let digits = "";
  for (const byte of bytes) {
    digits += byte.toString(16).padStart(2, "0").toUpperCase();
  }
  return digits;
}

export type BrowerChronBasePacket = {
  kind: "base";
  /** Storage slot, not a durable identity — location 499 is continually overwritten. */
  memoryLocationDigits: string;
  athleteNumberDigits: string;
  /** Digits 6-11. Carried verbatim; the document assigns them no meaning this pilot uses. */
  unattributedDigits: string;
  /** Digits 12-18. Opaque: no verified wall-clock mapping exists. */
  startTimeDigits: string;
  /** Splits 1-4 as raw field values; a trailing unused slot reads as 0. */
  splitFields: number[];
  appendixCount: number;
};

export type BrowerChronAppendixPacket = {
  kind: "appendix";
  /** Eight split fields; unused slots read as 0. */
  splitFields: number[];
};

export type BrowerPacketDecodeFailure = {
  kind: "invalid";
  reason: string;
};

export type BrowerChronBaseDecode = BrowerChronBasePacket | BrowerPacketDecodeFailure;
export type BrowerChronAppendixDecode =
  | BrowerChronAppendixPacket
  | BrowerPacketDecodeFailure;

function readFieldDigits(digits: string, start: number, end: number): string {
  return digits.slice(start, end);
}

function readFieldValue(digits: string, start: number, width: number): number {
  const field = digits.slice(start, start + width);
  return Number.parseInt(field, 16);
}

/**
 * Rejects anything that is not exactly one 20-byte packet of hexadecimal digits.
 * A short, long or non-`Uint8Array` payload is a decode failure, never a partially
 * trusted packet.
 */
function validatePacketBytes(bytes: Uint8Array): string | null {
  if (!(bytes instanceof Uint8Array)) {
    return "Packet is not a byte array.";
  }
  if (bytes.length !== BROWER_CHRON_PACKET_BYTE_LENGTH) {
    return `Packet is ${bytes.length} bytes; the documented layout is ${BROWER_CHRON_PACKET_BYTE_LENGTH}.`;
  }
  return null;
}

export function decodeBrowerChronBasePacket(bytes: Uint8Array): BrowerChronBaseDecode {
  const lengthProblem = validatePacketBytes(bytes);
  if (lengthProblem !== null) {
    return { kind: "invalid", reason: lengthProblem };
  }

  const digits = toBrowerHexDigits(bytes);

  const memoryLocation = Number.parseInt(digits.slice(0, 3), 16);
  const athleteNumber = Number.parseInt(digits.slice(3, 6), 16);
  if (memoryLocation < 1 || memoryLocation > 499 || athleteNumber === 1000) {
    return { kind: "invalid", reason: "Not a supported athlete record (memory slot or session header)." };
  }

  const splitFields: number[] = [];
  for (let index = 0; index < BROWER_CHRON_BASE_SPLIT_COUNT; index += 1) {
    splitFields.push(
      readFieldValue(digits, FIRST_BASE_SPLIT_DIGIT + index * SPLIT_FIELD_DIGITS, SPLIT_FIELD_DIGITS)
    );
  }

  const appendixCount = Number.parseInt(digits.slice(APPENDIX_COUNT_DIGIT, APPENDIX_COUNT_DIGIT + 1), 16);

  if (!Number.isInteger(appendixCount) || appendixCount > BROWER_CHRON_MAX_APPENDIX_COUNT) {
    // The documented layout describes at most two appendix packets. A higher count is
    // not an athlete with more splits; it is a packet this decoder cannot read, and
    // guessing at it would manufacture measurements.
    return {
      kind: "invalid",
      reason: `Appendix count ${digits.slice(APPENDIX_COUNT_DIGIT, APPENDIX_COUNT_DIGIT + 1)} exceeds the documented maximum of ${BROWER_CHRON_MAX_APPENDIX_COUNT}.`,
    };
  }

  return {
    kind: "base",
    memoryLocationDigits: readFieldDigits(digits, MEMORY_LOCATION_DIGITS.start, MEMORY_LOCATION_DIGITS.end),
    athleteNumberDigits: readFieldDigits(digits, ATHLETE_NUMBER_DIGITS.start, ATHLETE_NUMBER_DIGITS.end),
    unattributedDigits: readFieldDigits(digits, UNATTRIBUTED_DIGITS.start, UNATTRIBUTED_DIGITS.end),
    startTimeDigits: readFieldDigits(digits, START_TIME_DIGITS.start, START_TIME_DIGITS.end),
    splitFields,
    appendixCount,
  };
}

export function decodeBrowerChronAppendixPacket(
  bytes: Uint8Array
): BrowerChronAppendixDecode {
  const lengthProblem = validatePacketBytes(bytes);
  if (lengthProblem !== null) {
    return { kind: "invalid", reason: lengthProblem };
  }

  const digits = toBrowerHexDigits(bytes);
  const splitFields: number[] = [];
  for (let index = 0; index < BROWER_CHRON_APPENDIX_SPLIT_COUNT; index += 1) {
    splitFields.push(readFieldValue(digits, index * SPLIT_FIELD_DIGITS, SPLIT_FIELD_DIGITS));
  }

  return { kind: "appendix", splitFields };
}

/**
 * One fully assembled, coherence-checked record.
 *
 * `cumulativeMs` holds only the USED splits, in order, each relative to the record's
 * original start (the documented rule). It never contains a trailing unused slot. It is
 * empty only for an `"empty"` assembly, which establishes the record's identity without
 * claiming any measurement.
 */
export type BrowerChronRecord = {
  /**
   * Identity WITHIN one connected, armed observation window only. It is built from the
   * documented Memory Location, Athlete Number and start-time fields. A memory location
   * is a storage slot that the device overwrites and reuses, so this is deliberately
   * not treated as a durable cross-session identity.
   */
  key: string;
  memoryLocationDigits: string;
  athleteNumberDigits: string;
  unattributedDigits: string;
  startTimeDigits: string;
  cumulativeMs: number[];
  appendixCount: number;
};

export type BrowerChronAssembly =
  | { status: "record"; record: BrowerChronRecord }
  /**
   * A structurally valid record carrying no measured split yet (a zero first split was
   * observed on real hardware). Not an error, and not a selectable measurement — but it
   * DOES establish the record's identity, which is what lets a baseline know which
   * record the timer is on before any time exists on it. `record.cumulativeMs` is empty.
   */
  | { status: "empty"; record: BrowerChronRecord }
  /** Declared appendices have not all arrived. Never partially decoded. */
  | { status: "incomplete"; expectedAppendixCount: number; receivedAppendixCount: number }
  | { status: "invalid"; reason: string };

export function browerChronRecordKey(base: {
  memoryLocationDigits: string;
  athleteNumberDigits: string;
  startTimeDigits: string;
}): string {
  return `${base.memoryLocationDigits}-${base.athleteNumberDigits}-${base.startTimeDigits}`;
}

/**
 * Assembles a base packet and its declared appendix packets into one validated record.
 *
 * Every check below exists because failing it means the bytes cannot be trusted to
 * describe real measurements. An assembly that fails ANY of them yields no selectable
 * measurement at all — it is never partially accepted, and no field of it is reported
 * as a time.
 *
 *  1. The appendix packets present must exactly match the declared count. Fewer is
 *     `incomplete`; more is `invalid`.
 *  2. Every appendix packet must itself decode.
 *  3. Used splits must be a contiguous leading run. A zero followed by a non-zero
 *     means the layout is not being read as intended.
 *  4. Cumulative splits must strictly increase. They are all relative to one start
 *     time, so a flat or decreasing pair is incoherent.
 *  5. An appendix may only exist once the packets before it are completely filled —
 *     split 5 cannot exist while split 4 does not.
 */
export function assembleBrowerChronRecord(
  base: BrowerChronBasePacket,
  appendixPackets: readonly Uint8Array[]
): BrowerChronAssembly {
  if (appendixPackets.length > base.appendixCount) {
    return {
      status: "invalid",
      reason: `Received ${appendixPackets.length} appendix packets but the base packet declares ${base.appendixCount}.`,
    };
  }

  if (appendixPackets.length < base.appendixCount) {
    return {
      status: "incomplete",
      expectedAppendixCount: base.appendixCount,
      receivedAppendixCount: appendixPackets.length,
    };
  }

  const fields: number[] = [...base.splitFields];

  for (const packet of appendixPackets) {
    const decoded = decodeBrowerChronAppendixPacket(packet);
    if (decoded.kind === "invalid") {
      return { status: "invalid", reason: `Appendix packet: ${decoded.reason}` };
    }
    fields.push(...decoded.splitFields);
  }

  if (fields.length > BROWER_CHRON_MAX_SPLITS) {
    return {
      status: "invalid",
      reason: `Assembled ${fields.length} split fields; the documented maximum is ${BROWER_CHRON_MAX_SPLITS}.`,
    };
  }

  const identity = {
    key: browerChronRecordKey(base),
    memoryLocationDigits: base.memoryLocationDigits,
    athleteNumberDigits: base.athleteNumberDigits,
    unattributedDigits: base.unattributedDigits,
    startTimeDigits: base.startTimeDigits,
    appendixCount: base.appendixCount,
  };

  const used: number[] = [];
  let seenUnused = false;

  for (const field of fields) {
    if (!Number.isInteger(field) || field < 0) {
      return { status: "invalid", reason: "A split field did not decode to a whole number." };
    }
    if (field === 0) {
      seenUnused = true;
      continue;
    }
    if (seenUnused) {
      return {
        status: "invalid",
        reason: "A used split follows an unused one; the split fields are not a contiguous run.",
      };
    }
    used.push(field);
  }

  if (used.length === 0) {
    return { status: "empty", record: { ...identity, cumulativeMs: [] } };
  }

  for (let index = 1; index < used.length; index += 1) {
    if (used[index] <= used[index - 1]) {
      return {
        status: "invalid",
        reason: `Split ${index + 1} (${used[index]} ms) does not increase on split ${index} (${used[index - 1]} ms).`,
      };
    }
  }

  // An appendix carries splits 5-12; it cannot be populated while the base packet's own
  // four splits are not. The same holds for the second appendix against the first.
  const requiredFilledFields = base.appendixCount * BROWER_CHRON_APPENDIX_SPLIT_COUNT;
  const minimumUsed = requiredFilledFields > 0
    ? BROWER_CHRON_BASE_SPLIT_COUNT + requiredFilledFields - BROWER_CHRON_APPENDIX_SPLIT_COUNT + 1
    : 0;

  if (used.length < minimumUsed) {
    return {
      status: "invalid",
      reason: `The base packet declares ${base.appendixCount} appendix packet(s), but only ${used.length} split(s) are used.`,
    };
  }

  return { status: "record", record: { ...identity, cumulativeMs: used } };
}

/**
 * One SEG interval derived from adjacent cumulative splits.
 *
 * `splitIndex` is the 1-based position of the split that ENDS the interval. That is
 * what makes two equal times at different positions distinguishable: 3.79 s ending at
 * split 3 and 3.79 s ending at split 13 are different measurements, never one.
 */
export type BrowerChronInterval = {
  splitIndex: number;
  /** Integer milliseconds. The first interval is relative to the original start. */
  intervalMs: number;
  cumulativeMs: number;
  /** Absent for the first split, whose reference is the record's start. */
  precedingCumulativeMs?: number;
};

/**
 * Derives every SEG interval from a record's cumulative splits, in integer
 * milliseconds. Subtraction happens on the millisecond values — never on a value that
 * was first truncated for display.
 */
export function deriveBrowerChronIntervals(
  cumulativeMs: readonly number[]
): BrowerChronInterval[] {
  return cumulativeMs.map((cumulative, index) => {
    if (index === 0) {
      return { splitIndex: 1, intervalMs: cumulative, cumulativeMs: cumulative };
    }
    const preceding = cumulativeMs[index - 1];
    return {
      splitIndex: index + 1,
      intervalMs: cumulative - preceding,
      cumulativeMs: cumulative,
      precedingCumulativeMs: preceding,
    };
  });
}

/**
 * The exact value a measurement carries into the application, in seconds.
 *
 * Milliseconds are integers and 1/1000 is exact enough in binary64 across the whole
 * range this device produces, so nothing is lost here. This is NOT the TCi's display
 * value — see `formatBrowerTruncatedHundredths`.
 */
export function browerIntervalSeconds(intervalMs: number): number {
  return intervalMs / 1000;
}

/**
 * The TCi's own display rendering: hundredths, TRUNCATED, never rounded. 19.999 s
 * displays as 19.99, not 20.00 — the one documented behaviour the physical collections
 * independently corroborated, seven times across two transports.
 *
 * Used only to let the operator compare against the timer's screen. The accepted value
 * is always the full-precision one above.
 */
export function formatBrowerTruncatedHundredths(intervalMs: number): string {
  const sign = intervalMs < 0 ? "-" : "";
  const magnitude = Math.abs(intervalMs);
  const hundredths = Math.trunc(magnitude / 10);
  return `${sign}${Math.trunc(hundredths / 100)}.${String(hundredths % 100).padStart(2, "0")}`;
}

/**
 * Decides whether a just-arrived packet can be the NEXT appendix of a record whose
 * splits so far end at `lastCumulativeMs`.
 *
 * This exists because the documented layout gives appendix packets no header: nothing
 * in the bytes says "I am an appendix". Arrival order after a declared appendix count
 * is the only association the evidence supports, and order alone is not enough — the
 * device was observed sending SIX versions of one base packet, so a packet arriving
 * while an appendix is outstanding may well be another base-packet update, or the base
 * packet of a different record.
 *
 * Consuming a base packet as an appendix would be the worst possible failure: it could
 * assemble into a coherent-looking record and present fabricated numbers as
 * measurements. So an appendix is accepted only when its own fields behave like the
 * continuation they claim to be:
 *
 *   - the first field is used (non-zero) — a declared appendix carrying nothing is not
 *     a continuation;
 *   - it strictly exceeds the record's last split, because every split is cumulative
 *     from the same start;
 *   - its own used fields form a contiguous, strictly increasing run.
 *
 * A base packet fails this in practice: read as appendix fields, its unattributed
 * region and start-time digits collapse into a small value part-way through, breaking
 * the increasing run. This is a structural check, not a proof of packet type — which is
 * why failing it abandons the record rather than decoding it a different way.
 */
export function appendixContinuesRecord(
  bytes: Uint8Array,
  lastCumulativeMs: number
): boolean {
  const decoded = decodeBrowerChronAppendixPacket(bytes);
  if (decoded.kind === "invalid") return false;

  const fields = decoded.splitFields;
  if (fields.length === 0 || fields[0] === 0) return false;

  let previous = lastCumulativeMs;
  let seenUnused = false;

  for (const field of fields) {
    if (field === 0) {
      seenUnused = true;
      continue;
    }
    if (seenUnused) return false;
    if (field <= previous) return false;
    previous = field;
  }

  return true;
}

/**
 * Whether reading these bytes as a BASE packet would yield a record that could offer
 * measurements.
 *
 * Applies documented constraints only — appendix count within the documented maximum,
 * a contiguous strictly increasing split run, and an appendix declared only once the
 * base's own four splits are full. It deliberately assigns **no** meaning to the opaque
 * digits 6-11 or to the start-time field: inventing one to force a classification is
 * exactly the kind of guess this module exists to avoid.
 *
 * An all-zero base reading is NOT selectable: it offers nothing, so it is not a rival
 * interpretation that could put fabricated numbers in front of the operator.
 */
export function browerBaseInterpretationIsSelectable(bytes: Uint8Array): boolean {
  const decoded = decodeBrowerChronBasePacket(bytes);
  if (decoded.kind === "invalid") return false;

  const used: number[] = [];
  let seenUnused = false;
  for (const field of decoded.splitFields) {
    if (field === 0) {
      seenUnused = true;
      continue;
    }
    if (seenUnused) return false;
    used.push(field);
  }

  if (used.length === 0) return false;
  for (let index = 1; index < used.length; index += 1) {
    if (used[index] <= used[index - 1]) return false;
  }
  if (decoded.appendixCount > 0 && used.length < BROWER_CHRON_BASE_SPLIT_COUNT) return false;

  return true;
}

/**
 * What a packet arriving while a declared appendix is still outstanding may be treated as.
 *
 * The documented layout gives appendix packets **no header**: nothing in the bytes says
 * "I am an appendix". Arrival order after a declared count is therefore the only
 * association the evidence supports, and order alone is not enough — the device was
 * observed sending six versions of one base packet, so the next packet may well be
 * another base-packet update or a different record's base packet.
 *
 * `"ambiguous"` is a real, reachable outcome, not a defensive branch: a packet can
 * satisfy the appendix-continuation check **and** decode as a base packet carrying its
 * own coherent, increasing splits. Choosing either reading would present one of two
 * incompatible sets of numbers as measurements. The caller must reject this transfer;
 * it may wait for an unambiguous full snapshot without revoking setup confirmation.
 *
 * **Recorded limit.** A genuine appendix carrying exactly one split, whose seven unused
 * slots are zero-filled, is structurally indistinguishable from a base packet whose
 * opaque and start-time digits are *also* all zero. That case reads as `"appendix"`
 * here, because the rival base reading offers nothing at all. This is a structural
 * check, not packet-type verification — see ADR-0050 and the roadmap's B-P5 entry.
 */
export type BrowerAwaitedPacketRole =
  | { role: "appendix" }
  | { role: "base" }
  | { role: "ambiguous"; reason: string };

export function classifyBrowerPacketAwaitingAppendix(
  bytes: Uint8Array,
  lastCumulativeMs: number
): BrowerAwaitedPacketRole {
  const continuesRecord = appendixContinuesRecord(bytes, lastCumulativeMs);
  const baseSelectable = browerBaseInterpretationIsSelectable(bytes);

  if (continuesRecord && baseSelectable) {
    return {
      role: "ambiguous",
      reason:
        "A packet is readable both as the outstanding appendix and as a new record with its own times. Nothing in the documented layout distinguishes them, so no measurement was taken from it.",
    };
  }
  if (continuesRecord) return { role: "appendix" };
  return { role: "base" };
}
