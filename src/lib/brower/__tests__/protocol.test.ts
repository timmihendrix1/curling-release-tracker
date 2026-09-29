import { describe, expect, it } from "vitest";
import {
  BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
  BROWER_COMMAND_START_BYTE,
  BROWER_COMMAND_STOP_BYTE,
  BROWER_DIAGNOSTIC_MAX_ADDRESS_SPAN,
  BROWER_MAX_MEMORY_ADDRESS,
  BROWER_MIN_MEMORY_ADDRESS,
  BROWER_POWER_ON_COUNTER_CHARACTERISTIC_UUID,
  BROWER_SERIAL_NUMBER_CHARACTERISTIC_UUID,
  BROWER_SERIAL_NUMBER_SERVICE_UUID,
  BROWER_TIME_BASE_CHARACTERISTIC_UUID,
  BROWER_TIMING_SERVICE_UUID,
  browerCharacteristicLabel,
  buildAthleteDataRequestCommand,
  copyBytesFromDataView,
  formatHexBytes,
  parseAthleteDataRequestRange,
  parseMemoryAddressInput,
  validateAthleteDataRequestRange,
} from "../protocol";

describe("Brower protocol constants", () => {
  it("matches the UUIDs transcribed from the manufacturer document", () => {
    expect(BROWER_TIMING_SERVICE_UUID).toBe("11574949-d37a-4fd7-a171-f36fcdc3a461");
    expect(BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID).toBe(
      "bb8722a4-3810-4fd3-9321-f6cbdcc1ea4e"
    );
    expect(BROWER_TIME_BASE_CHARACTERISTIC_UUID).toBe(
      "ee152c14-79a7-447d-b435-030880aa7d7d"
    );
    expect(BROWER_POWER_ON_COUNTER_CHARACTERISTIC_UUID).toBe(
      "882c254a-d1f1-440f-8d08-4d0e5a9d4226"
    );
    expect(BROWER_SERIAL_NUMBER_SERVICE_UUID).toBe("ffae864c-ee9f-4f31-ad8a-9bcbac855a9f");
    expect(BROWER_SERIAL_NUMBER_CHARACTERISTIC_UUID).toBe(
      "beef94d7-4124-423d-82e0-5aa556bc722b"
    );
  });

  it("uses the documented addressable memory window", () => {
    expect(BROWER_MIN_MEMORY_ADDRESS).toBe(1);
    expect(BROWER_MAX_MEMORY_ADDRESS).toBe(499);
  });

  it("labels documented characteristics and leaves unknown ones unnamed", () => {
    expect(browerCharacteristicLabel(BROWER_TIME_BASE_CHARACTERISTIC_UUID)).toBe("Time Base");
    expect(browerCharacteristicLabel("00001234-0000-1000-8000-00805f9b34fb")).toBeNull();
  });
});

describe("validateAthleteDataRequestRange", () => {
  it("accepts a valid bounded range", () => {
    expect(validateAthleteDataRequestRange(1, 3)).toEqual({ valid: true });
    expect(validateAthleteDataRequestRange(499, 499)).toEqual({ valid: true });
  });

  it("rejects address 0, which the document describes as unused", () => {
    expect(validateAthleteDataRequestRange(0, 3).valid).toBe(false);
  });

  it("rejects an address beyond the documented maximum", () => {
    expect(validateAthleteDataRequestRange(498, 500).valid).toBe(false);
  });

  it("rejects a reversed range", () => {
    const result = validateAthleteDataRequestRange(5, 4);
    expect(result).toEqual({ valid: false, reason: "Start must not be greater than stop." });
  });

  it("rejects non-integers, including NaN from an empty input field", () => {
    expect(validateAthleteDataRequestRange(Number.NaN, 3).valid).toBe(false);
    expect(validateAthleteDataRequestRange(1.5, 3).valid).toBe(false);
    expect(validateAthleteDataRequestRange(1, Number.POSITIVE_INFINITY).valid).toBe(false);
  });

  it("rejects a span wider than this diagnostic's ceiling", () => {
    expect(validateAthleteDataRequestRange(1, BROWER_DIAGNOSTIC_MAX_ADDRESS_SPAN).valid).toBe(
      true
    );
    expect(
      validateAthleteDataRequestRange(1, BROWER_DIAGNOSTIC_MAX_ADDRESS_SPAN + 1).valid
    ).toBe(false);
  });
});

describe("parseMemoryAddressInput", () => {
  it("accepts a plain decimal integer, with surrounding whitespace trimmed", () => {
    expect(parseMemoryAddressInput("1")).toEqual({ ok: true, value: 1 });
    expect(parseMemoryAddressInput("499")).toEqual({ ok: true, value: 499 });
    expect(parseMemoryAddressInput("  42  ")).toEqual({ ok: true, value: 42 });
  });

  it("rejects empty input", () => {
    expect(parseMemoryAddressInput("").ok).toBe(false);
    expect(parseMemoryAddressInput("   ").ok).toBe(false);
  });

  it("rejects fractional input instead of truncating it", () => {
    // Number.parseInt("1.9", 10) is 1 — a different address from the one typed.
    expect(Number.parseInt("1.9", 10)).toBe(1);
    expect(parseMemoryAddressInput("1.9").ok).toBe(false);
    expect(parseMemoryAddressInput("1.0").ok).toBe(false);
    expect(parseMemoryAddressInput(".5").ok).toBe(false);
  });

  it("rejects exponent syntax explicitly rather than guessing at the intent", () => {
    // Number.parseInt("1e2", 10) is 1, not 100.
    expect(Number.parseInt("1e2", 10)).toBe(1);
    expect(parseMemoryAddressInput("1e2").ok).toBe(false);
    expect(parseMemoryAddressInput("1E2").ok).toBe(false);
  });

  it("rejects a numeric prefix followed by anything else", () => {
    expect(parseMemoryAddressInput("3abc").ok).toBe(false);
    expect(parseMemoryAddressInput("0x10").ok).toBe(false);
    expect(parseMemoryAddressInput("1 2").ok).toBe(false);
  });

  it("rejects signs, which could otherwise smuggle a negative address past a prefix parse", () => {
    expect(parseMemoryAddressInput("-1").ok).toBe(false);
    expect(parseMemoryAddressInput("+1").ok).toBe(false);
  });

  it("rejects a value too large to be a safe integer", () => {
    expect(parseMemoryAddressInput("99999999999999999999").ok).toBe(false);
  });
});

describe("parseAthleteDataRequestRange", () => {
  it("returns the exact parsed values for a valid range", () => {
    expect(parseAthleteDataRequestRange("4", "6")).toEqual({
      valid: true,
      startAddress: 4,
      stopAddress: 6,
    });
  });

  it("accepts the documented boundary addresses", () => {
    expect(parseAthleteDataRequestRange("1", "1")).toEqual({
      valid: true,
      startAddress: 1,
      stopAddress: 1,
    });
    expect(parseAthleteDataRequestRange("499", "499")).toEqual({
      valid: true,
      startAddress: 499,
      stopAddress: 499,
    });
  });

  it("rejects a fractional or exponent-form field without truncating it", () => {
    expect(parseAthleteDataRequestRange("1.9", "3").valid).toBe(false);
    expect(parseAthleteDataRequestRange("1", "3.5").valid).toBe(false);
    expect(parseAthleteDataRequestRange("1e2", "3").valid).toBe(false);
  });

  it("rejects empty, out-of-range, reversed and oversized ranges", () => {
    expect(parseAthleteDataRequestRange("", "3").valid).toBe(false);
    expect(parseAthleteDataRequestRange("0", "3").valid).toBe(false);
    expect(parseAthleteDataRequestRange("1", "500").valid).toBe(false);
    expect(parseAthleteDataRequestRange("5", "4").valid).toBe(false);
    expect(parseAthleteDataRequestRange("1", "30").valid).toBe(false);
  });
});

describe("buildAthleteDataRequestCommand", () => {
  it("builds the documented 7-byte frame under the little-endian hypothesis", () => {
    const bytes = buildAthleteDataRequestCommand({
      startAddress: 4,
      stopAddress: 6,
      byteOrder: "little-endian",
    });

    expect(Array.from(bytes)).toEqual([0x55, 0x01, 0x04, 0x00, 0x06, 0x00, 0xaa]);
    expect(bytes[0]).toBe(BROWER_COMMAND_START_BYTE);
    expect(bytes[6]).toBe(BROWER_COMMAND_STOP_BYTE);
  });

  it("builds the documented 7-byte frame under the big-endian hypothesis", () => {
    const bytes = buildAthleteDataRequestCommand({
      startAddress: 4,
      stopAddress: 6,
      byteOrder: "big-endian",
    });

    expect(Array.from(bytes)).toEqual([0x55, 0x01, 0x00, 0x04, 0x00, 0x06, 0xaa]);
  });

  it("orders a multi-byte address differently under each hypothesis", () => {
    const little = buildAthleteDataRequestCommand({
      startAddress: 300,
      stopAddress: 301,
      byteOrder: "little-endian",
    });
    const big = buildAthleteDataRequestCommand({
      startAddress: 300,
      stopAddress: 301,
      byteOrder: "big-endian",
    });

    expect(Array.from(little)).toEqual([0x55, 0x01, 0x2c, 0x01, 0x2d, 0x01, 0xaa]);
    expect(Array.from(big)).toEqual([0x55, 0x01, 0x01, 0x2c, 0x01, 0x2d, 0xaa]);
  });

  it("only ever emits command type 0x01", () => {
    for (let start = 1; start <= 5; start += 1) {
      const bytes = buildAthleteDataRequestCommand({
        startAddress: start,
        stopAddress: start,
        byteOrder: "little-endian",
      });
      expect(bytes[1]).toBe(0x01);
      // 0x0A is the state-changing "New Athlete" command. Nothing here may produce it.
      expect(bytes[1]).not.toBe(0x0a);
    }
  });

  it("throws rather than clamping an invalid range", () => {
    expect(() =>
      buildAthleteDataRequestCommand({
        startAddress: 0,
        stopAddress: 3,
        byteOrder: "little-endian",
      })
    ).toThrow();
  });

  it("throws when no byte-order hypothesis was selected", () => {
    expect(() =>
      buildAthleteDataRequestCommand({
        startAddress: 1,
        stopAddress: 2,
        byteOrder: "unspecified" as unknown as "little-endian",
      })
    ).toThrow("A byte-order hypothesis must be selected explicitly.");
  });
});

describe("byte helpers", () => {
  it("formats bytes as uppercase two-digit hex", () => {
    expect(formatHexBytes(new Uint8Array([0x00, 0x0a, 0xff, 0x55]))).toBe("00 0A FF 55");
    expect(formatHexBytes(new Uint8Array())).toBe("");
  });

  it("copies a DataView into an independent array", () => {
    const backing = new Uint8Array([1, 2, 3, 4]);
    const view = new DataView(backing.buffer);
    const copy = copyBytesFromDataView(view);

    expect(Array.from(copy)).toEqual([1, 2, 3, 4]);

    backing[0] = 99;
    expect(copy[0]).toBe(1);
  });

  it("copies only the view's own window of a larger buffer", () => {
    const backing = new Uint8Array([1, 2, 3, 4, 5, 6]);
    const copy = copyBytesFromDataView(new DataView(backing.buffer, 2, 3));

    expect(Array.from(copy)).toEqual([3, 4, 5]);
    expect(copy.byteLength).toBe(3);
  });
});
