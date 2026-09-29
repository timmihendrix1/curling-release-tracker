// Brower TCi Timer BLE protocol constants and the one command this diagnostic is
// allowed to send.
//
// EVERY value in this file is transcribed from the manufacturer document
// `docs/hardware/brower/TC Timer BLE to Smartphone BLE Communication V4.docx`. Nothing
// here is inferred, guessed, or derived from BLE convention. Where that document is
// silent — most importantly the byte order of the multi-byte command fields — this
// file does NOT pick a default; the caller must state which hypothesis it is testing.
//
// This is a hardware-discovery module, not a production decoder. It deliberately
// contains no packet parsing: the 20-byte athlete/appendix/session packet layouts the
// document describes use 1.5-, 2.5- and 3.5-byte fields whose nibble ordering is not
// specified, so any "decoder" written today would be a guess presented as a fact.
// Raw bytes are preserved and displayed instead. See
// `docs/BROWER_INTEGRATION_STATUS.md` for the documented-vs-unresolved split.

/** Timing service (document: "BLE Services and Characteristics" → Service UUID). */
export const BROWER_TIMING_SERVICE_UUID = "11574949-d37a-4fd7-a171-f36fcdc3a461";

/** Athlete Data — write commands here, results arrive as notifications here. */
export const BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID =
  "bb8722a4-3810-4fd3-9321-f6cbdcc1ea4e";

/** Time Base — documented readable, 4 bytes, ms since the timer powered on. */
export const BROWER_TIME_BASE_CHARACTERISTIC_UUID =
  "ee152c14-79a7-447d-b435-030880aa7d7d";

/** Power On Counter (a.k.a. current session number) — documented readable, 16 bytes. */
export const BROWER_POWER_ON_COUNTER_CHARACTERISTIC_UUID =
  "882c254a-d1f1-440f-8d08-4d0e5a9d4226";

/** Serial Number service — a second, separate primary service. */
export const BROWER_SERIAL_NUMBER_SERVICE_UUID = "ffae864c-ee9f-4f31-ad8a-9bcbac855a9f";

/** Serial Number characteristic. Its encoding is NOT documented. */
export const BROWER_SERIAL_NUMBER_CHARACTERISTIC_UUID =
  "beef94d7-4124-423d-82e0-5aa556bc722b";

/**
 * The document lists a fourth timing-service characteristic, "Current Memory
 * Location", but never states its UUID. It therefore cannot be addressed; the
 * diagnostic reports any such undocumented characteristic it discovers as unknown
 * rather than assigning it this meaning.
 */
export const BROWER_UNDOCUMENTED_CURRENT_MEMORY_LOCATION_CHARACTERISTIC =
  "Current Memory Location (UUID not stated in the manufacturer document)";

export const BROWER_COMMAND_START_BYTE = 0x55;
export const BROWER_COMMAND_STOP_BYTE = 0xaa;
export const BROWER_COMMAND_BYTE_LENGTH = 7;

/**
 * The only command type this diagnostic may ever emit: request athlete records for a
 * memory range. The document also defines 0x02 (time base/session/sequence), 0x03
 * (frequency channel), 0x04 (test) and 0x0A (New Athlete — explicitly equivalent to
 * pressing "new" on the timer, i.e. state-changing). None of those are implemented
 * here, and 0x0A in particular must never be sent by a diagnostic.
 */
export const BROWER_ATHLETE_DATA_REQUEST_COMMAND_TYPE = 0x01;

/** Location 0 is documented as unused; the first saved time goes to location 1. */
export const BROWER_MIN_MEMORY_ADDRESS = 1;
/** 499 locations; once full, location 499 is continually overwritten. */
export const BROWER_MAX_MEMORY_ADDRESS = 499;

/**
 * Diagnostic-only ceiling on one request's span. The protocol itself permits any
 * range, but a discovery experiment should ask for a small, hand-checkable number of
 * records — not dump the whole memory before anything about the reply format is
 * established.
 */
export const BROWER_DIAGNOSTIC_MAX_ADDRESS_SPAN = 10;

/**
 * The document writes the start/stop memory locations as `uint16` with the example
 * `0x0004` but never states the wire byte order, and the diagnostic must not infer one
 * from BLE convention or from the advertising example. Both orderings are therefore
 * experimental hypotheses that a human selects explicitly before sending.
 */
export type BrowerMultiByteOrderHypothesis = "little-endian" | "big-endian";

export const BROWER_BYTE_ORDER_HYPOTHESES: readonly BrowerMultiByteOrderHypothesis[] = [
  "little-endian",
  "big-endian",
];

export function browerByteOrderLabel(order: BrowerMultiByteOrderHypothesis): string {
  return order === "little-endian"
    ? "Little-endian (least significant byte first)"
    : "Big-endian (most significant byte first)";
}

export type BrowerAthleteDataRequest = {
  startAddress: number;
  stopAddress: number;
  byteOrder: BrowerMultiByteOrderHypothesis;
};

export type BrowerRangeValidation =
  | { valid: true }
  | { valid: false; reason: string };

/**
 * Validates a requested memory range against the documented addressable window and
 * this diagnostic's own span ceiling. Rejects non-integers and non-finite values
 * explicitly rather than coercing them.
 */
export function validateAthleteDataRequestRange(
  startAddress: number,
  stopAddress: number
): BrowerRangeValidation {
  if (!Number.isInteger(startAddress) || !Number.isInteger(stopAddress)) {
    return { valid: false, reason: "Start and stop must be whole numbers." };
  }
  if (
    startAddress < BROWER_MIN_MEMORY_ADDRESS ||
    startAddress > BROWER_MAX_MEMORY_ADDRESS ||
    stopAddress < BROWER_MIN_MEMORY_ADDRESS ||
    stopAddress > BROWER_MAX_MEMORY_ADDRESS
  ) {
    return {
      valid: false,
      reason: `Start and stop must be between ${BROWER_MIN_MEMORY_ADDRESS} and ${BROWER_MAX_MEMORY_ADDRESS}.`,
    };
  }
  if (startAddress > stopAddress) {
    return { valid: false, reason: "Start must not be greater than stop." };
  }
  const span = stopAddress - startAddress + 1;
  if (span > BROWER_DIAGNOSTIC_MAX_ADDRESS_SPAN) {
    return {
      valid: false,
      reason: `This diagnostic requests at most ${BROWER_DIAGNOSTIC_MAX_ADDRESS_SPAN} memory locations at a time. That range covers ${span}.`,
    };
  }
  return { valid: true };
}

export type BrowerAddressParse =
  | { ok: true; value: number }
  | { ok: false; reason: string };

/**
 * Parses ONE memory-address field from raw user input, rejecting anything that is not a
 * complete plain decimal integer.
 *
 * `Number.parseInt` must never be used for this. It accepts a numeric *prefix* and
 * silently discards the rest — `"1.9"` and `"1e2"` both become `1` — so a request built
 * from its output would address a different memory location than the one the operator
 * typed, and the integer check in `validateAthleteDataRequestRange` could not detect it
 * because the value it receives is already a clean integer. In a diagnostic whose whole
 * purpose is to establish what a device does with a *known* request, that is a
 * correctness defect, not a formatting nicety.
 *
 * Exponent syntax is rejected outright rather than evaluated: `"1e2"` is far more likely
 * to be a typo than a deliberate request for address 100, and an explicit rejection is
 * honest where either interpretation would be a guess.
 */
export function parseMemoryAddressInput(raw: string): BrowerAddressParse {
  const trimmed = raw.trim();
  if (trimmed.length === 0) {
    return { ok: false, reason: "Enter a start and stop address." };
  }
  if (!/^\d+$/.test(trimmed)) {
    return {
      ok: false,
      reason:
        "Addresses must be whole numbers written in full digits — no decimal point, sign, or exponent.",
    };
  }
  const value = Number(trimmed);
  if (!Number.isSafeInteger(value)) {
    return {
      ok: false,
      reason: `Addresses must be between ${BROWER_MIN_MEMORY_ADDRESS} and ${BROWER_MAX_MEMORY_ADDRESS}.`,
    };
  }
  return { ok: true, value };
}

/**
 * Parses and validates both address fields together. This is the single entry point the
 * UI uses, so the preview, the enabled/disabled state of Send, and the bytes actually
 * written can never disagree about which addresses were requested.
 */
export function parseAthleteDataRequestRange(
  rawStart: string,
  rawStop: string
): { valid: true; startAddress: number; stopAddress: number } | { valid: false; reason: string } {
  const start = parseMemoryAddressInput(rawStart);
  if (!start.ok) return { valid: false, reason: start.reason };
  const stop = parseMemoryAddressInput(rawStop);
  if (!stop.ok) return { valid: false, reason: stop.reason };

  const range = validateAthleteDataRequestRange(start.value, stop.value);
  if (!range.valid) return { valid: false, reason: range.reason };

  return { valid: true, startAddress: start.value, stopAddress: stop.value };
}

/**
 * Builds the documented 7-byte athlete-data request for one explicitly chosen byte-order
 * hypothesis. Throws on an invalid range rather than clamping — a diagnostic that
 * silently rewrote the requested range would make its own log untrustworthy.
 */
export function buildAthleteDataRequestCommand({
  startAddress,
  stopAddress,
  byteOrder,
}: BrowerAthleteDataRequest): Uint8Array {
  const validation = validateAthleteDataRequestRange(startAddress, stopAddress);
  if (!validation.valid) throw new Error(validation.reason);
  if (byteOrder !== "little-endian" && byteOrder !== "big-endian") {
    throw new Error("A byte-order hypothesis must be selected explicitly.");
  }

  const bytes = new Uint8Array(BROWER_COMMAND_BYTE_LENGTH);
  bytes[0] = BROWER_COMMAND_START_BYTE;
  bytes[1] = BROWER_ATHLETE_DATA_REQUEST_COMMAND_TYPE;

  const view = new DataView(bytes.buffer);
  const littleEndian = byteOrder === "little-endian";
  view.setUint16(2, startAddress, littleEndian);
  view.setUint16(4, stopAddress, littleEndian);

  bytes[6] = BROWER_COMMAND_STOP_BYTE;
  return bytes;
}

/** Uppercase space-separated hex, the form the diagnostic shows and logs. */
export function formatHexBytes(bytes: Uint8Array): string {
  return Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0").toUpperCase()).join(
    " "
  );
}

/**
 * Copies a `DataView` delivered by Web Bluetooth into an independent `Uint8Array` at
 * receipt time. The platform may reuse the characteristic's underlying buffer for the
 * next notification, so preserving the view itself would silently corrupt earlier
 * observations.
 */
export function copyBytesFromDataView(view: DataView): Uint8Array {
  const bytes = new Uint8Array(view.byteLength);
  for (let index = 0; index < view.byteLength; index += 1) {
    bytes[index] = view.getUint8(index);
  }
  return bytes;
}

export type BrowerKnownCharacteristic = {
  uuid: string;
  label: string;
  /** What the manufacturer document says this characteristic is for. */
  documentedAs: string;
};

export const BROWER_KNOWN_CHARACTERISTICS: readonly BrowerKnownCharacteristic[] = [
  {
    uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
    label: "Athlete Data",
    documentedAs:
      "Write a request command here; athlete records are delivered back as notifications.",
  },
  {
    uuid: BROWER_TIME_BASE_CHARACTERISTIC_UUID,
    label: "Time Base",
    documentedAs: "Readable. 4 bytes, milliseconds since the timer powered on.",
  },
  {
    uuid: BROWER_POWER_ON_COUNTER_CHARACTERISTIC_UUID,
    label: "Power On Counter",
    documentedAs: "Readable. 16 bytes, also described as the current session number.",
  },
  {
    uuid: BROWER_SERIAL_NUMBER_CHARACTERISTIC_UUID,
    label: "Serial Number",
    documentedAs: "Identifies a TCi unit. Its encoding is not documented.",
  },
];

export function browerCharacteristicLabel(uuid: string): string | null {
  const normalized = uuid.toLowerCase();
  return (
    BROWER_KNOWN_CHARACTERISTICS.find((entry) => entry.uuid === normalized)?.label ?? null
  );
}
