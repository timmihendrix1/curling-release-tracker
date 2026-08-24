import { describe, expect, it } from "vitest";
import type { TimingProviderType } from "../../../types";
import {
  activeFilterCountLabel,
  exerciseTrainingAthleteCountLabel,
  exerciseVersionLabel,
  measurementSourceLabel,
} from "../presentation";

describe("exerciseTrainingAthleteCountLabel", () => {
  it("reads naturally for an unbounded upper limit", () => {
    expect(exerciseTrainingAthleteCountLabel(1, null)).toBe("One or more training athletes");
    expect(exerciseTrainingAthleteCountLabel(2, null)).toBe("2 or more training athletes");
  });

  it("uses the singular only for exactly one athlete", () => {
    expect(exerciseTrainingAthleteCountLabel(1, 1)).toBe("One training athlete");
    expect(exerciseTrainingAthleteCountLabel(4, 4)).toBe("4 training athletes");
  });

  it("renders a bounded range", () => {
    expect(exerciseTrainingAthleteCountLabel(2, 4)).toBe("2–4 training athletes");
    expect(exerciseTrainingAthleteCountLabel(1, 2)).toBe("1–2 training athletes");
  });

  it("never produces the old truncated phrasing", () => {
    for (const [min, max] of [
      [1, null],
      [1, 1],
      [1, 4],
      [3, null],
    ] as const) {
      expect(exerciseTrainingAthleteCountLabel(min, max)).not.toMatch(/^From /);
    }
  });
});

describe("exerciseVersionLabel", () => {
  it("names the Exercise's own version, distinctly from a source version", () => {
    expect(exerciseVersionLabel(1)).toBe("Exercise version 1");
    expect(exerciseVersionLabel(7)).toBe("Exercise version 7");
    expect(exerciseVersionLabel(1)).not.toMatch(/source/i);
  });
});

describe("activeFilterCountLabel", () => {
  it("agrees in number", () => {
    expect(activeFilterCountLabel(1)).toBe("1 active filter");
    expect(activeFilterCountLabel(3)).toBe("3 active filters");
  });
});

describe("measurementSourceLabel", () => {
  it("names each source without development or release framing", () => {
    const sources: TimingProviderType[] = ["manual", "simulator", "external"];
    for (const source of sources) {
      const label = measurementSourceLabel(source);
      expect(label.length).toBeGreaterThan(0);
      expect(label).not.toMatch(/release|development|not supported|coming soon|yet/i);
    }
    expect(measurementSourceLabel("manual")).toBe("Manual entry");
  });
});
