// The editable-number contract.
//
// These strings are reopened, parsed and saved again, so this helper is part of the
// persistence path, not a display concern. Its contract is exact: for every finite
// value the domain accepts, the result is a PLAIN decimal that the quantity's own
// parser reads back as the identical number.
//
// `toFixed` alone cannot satisfy that at either extreme — it caps at 20 fraction
// digits (1e-21 collapsed to "0", silently becoming an invalid zero tolerance) and
// switches to exponent notation at 1e21 and above (which every parser here rejects).
import { describe, expect, it } from "vitest";
import { editableNumber } from "../toleranceDraft";
import { parseSpeedInput } from "../speedInput";
import { parseReleaseTime } from "../../timeInput";

/** Magnitudes the plain-decimal expansion has to survive, not recommendations. */
const EXTREMES = [
  1e-21, 1e-7, 1e-300, Number.MIN_VALUE, 1e21, 1e100, Number.MAX_VALUE,
];

const ORDINARY = [0.01, 0.05, 0.1, 0.055, 0.067, 2.4, 2.3456, 3.75, 1234.5];

describe("editableNumber round-trips every accepted value", () => {
  it.each([...ORDINARY, ...EXTREMES])("never emits exponent notation for %s", (value) => {
    expect(editableNumber(value)).not.toMatch(/e/i);
  });

  it.each([...ORDINARY, ...EXTREMES])("is read back as the identical number: %s", (value) => {
    expect(parseSpeedInput(editableNumber(value))).toBe(value);
  });

  it("holds across a wide random sweep", () => {
    const failures: string[] = [];
    for (let i = 0; i < 2000; i += 1) {
      const value =
        Math.random() * Math.pow(10, Math.floor(Math.random() * 60) - 30);
      if (!(value > 0) || !Number.isFinite(value)) continue;
      const text = editableNumber(value);
      if (/e/i.test(text)) failures.push(`exponent: ${value} -> ${text}`);
      if (parseSpeedInput(text) !== value) failures.push(`lossy: ${value} -> ${text}`);
    }
    expect(failures.slice(0, 5)).toEqual([]);
  });

  it("never turns a small positive tolerance into an invalid zero", () => {
    for (const value of [1e-21, 1e-15, Number.MIN_VALUE]) {
      expect(Number(editableNumber(value))).toBeGreaterThan(0);
    }
  });
});

describe("ordinary formatting is unchanged", () => {
  it("keeps the familiar two-decimal form where it is exact", () => {
    expect(editableNumber(0.1)).toBe("0.10");
    expect(editableNumber(0.2)).toBe("0.20");
    expect(editableNumber(3.75)).toBe("3.75");
    expect(editableNumber(2.4)).toBe("2.40");
  });

  it("keeps every digit of a finer value", () => {
    expect(editableNumber(0.055)).toBe("0.055");
    expect(editableNumber(2.3456)).toBe("2.3456");
  });

  it("round-trips through the seconds parser for ordinary tolerances and targets", () => {
    for (const value of [0.05, 0.1, 0.2, 0.055, 3.75, 4.5, 99.99]) {
      expect(parseReleaseTime(editableNumber(value))).toBe(value);
    }
  });
});
