import { describe, expect, it } from "vitest";
import {
  formatMeasuredDeviation,
  formatMeasuredSeconds,
  formatMeasuredSpeed,
  formatMeasuredValue,
  NOT_RECORDED,
} from "../format";

describe("measured value formatting", () => {
  it("renders an absent value as an explicit placeholder, never as a zero", () => {
    expect(formatMeasuredSeconds(undefined)).toBe(NOT_RECORDED);
    expect(formatMeasuredSpeed(undefined)).toBe(NOT_RECORDED);
    expect(formatMeasuredSeconds(undefined)).not.toContain("0");
    expect(formatMeasuredSpeed(undefined)).not.toContain("0");
  });

  it("distinguishes a real zero-adjacent measurement from an absent one", () => {
    expect(formatMeasuredSeconds(0)).toBe("0.00s");
    expect(formatMeasuredSeconds(0)).not.toBe(formatMeasuredSeconds(undefined));
  });

  it("always renders the value with its own unit, and never swaps the two", () => {
    expect(formatMeasuredSeconds(3.8)).toBe("3.80s");
    expect(formatMeasuredSpeed(2.4)).toBe("2.40 m/s");
    expect(formatMeasuredValue(3.8, "time")).toBe("3.80s");
    expect(formatMeasuredValue(2.4, "speed")).toBe("2.40 m/s");
  });

  it("renders a signed deviation with its unit, and the placeholder when there is none", () => {
    expect(formatMeasuredDeviation(0.06, "time")).toBe("+0.06s");
    expect(formatMeasuredDeviation(-0.06, "speed")).toBe("-0.06 m/s");
    expect(formatMeasuredDeviation(0, "time")).toBe("+0.00s");
    expect(formatMeasuredDeviation(null, "speed")).toBe(NOT_RECORDED);
  });
});
