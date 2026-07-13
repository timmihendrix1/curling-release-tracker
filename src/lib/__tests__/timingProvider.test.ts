import { describe, expect, it } from "vitest";
import { createManualTimingResult } from "../timingProvider";

describe("createManualTimingResult", () => {
  it("produces a normalized TimingResult with source 'manual'", () => {
    const result = createManualTimingResult("back-hog", 3.75);

    expect(result.source).toBe("manual");
    expect(result.measurements).toEqual([{ measurementMode: "back-hog", value: 3.75 }]);
    expect(typeof result.id).toBe("string");
    expect(result.id.length).toBeGreaterThan(0);
    expect(typeof result.receivedAt).toBe("string");
  });

  it("produces a fresh id each time, even for the same value", () => {
    const a = createManualTimingResult("back-hog", 3.75);
    const b = createManualTimingResult("back-hog", 3.75);
    expect(a.id).not.toBe(b.id);
  });

  it("carries the measurement mode it was given, not a default", () => {
    const result = createManualTimingResult("hog-hog", 10.2);
    expect(result.measurements[0].measurementMode).toBe("hog-hog");
  });
});
