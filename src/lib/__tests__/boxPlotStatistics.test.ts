import { describe, expect, it } from "vitest";
import { computeBoxPlotStatistics } from "../boxPlotStatistics";

describe("computeBoxPlotStatistics — empty/degenerate input", () => {
  it("returns all-null/zero for an empty list", () => {
    expect(computeBoxPlotStatistics([])).toEqual({
      count: 0,
      minWhisker: null,
      q1: null,
      median: null,
      q3: null,
      maxWhisker: null,
      outliers: [],
    });
  });

  it("handles a single data point — median/q1/q3/whiskers all equal it, no outliers", () => {
    const result = computeBoxPlotStatistics([3.75]);
    expect(result.count).toBe(1);
    expect(result.median).toBe(3.75);
    expect(result.q1).toBe(3.75);
    expect(result.q3).toBe(3.75);
    expect(result.minWhisker).toBe(3.75);
    expect(result.maxWhisker).toBe(3.75);
    expect(result.outliers).toEqual([]);
  });

  it("handles two data points", () => {
    const result = computeBoxPlotStatistics([1, 3]);
    expect(result.count).toBe(2);
    expect(result.median).toBe(2);
    expect(result.q1).toBe(1);
    expect(result.q3).toBe(3);
    expect(result.minWhisker).toBe(1);
    expect(result.maxWhisker).toBe(3);
    expect(result.outliers).toEqual([]);
  });

  it("handles identical values with zero spread — no outliers, no divide-by-zero artifacts", () => {
    const result = computeBoxPlotStatistics([2, 2, 2, 2]);
    expect(result.median).toBe(2);
    expect(result.q1).toBe(2);
    expect(result.q3).toBe(2);
    expect(result.minWhisker).toBe(2);
    expect(result.maxWhisker).toBe(2);
    expect(result.outliers).toEqual([]);
  });
});

describe("computeBoxPlotStatistics — median-of-halves quantiles", () => {
  it("computes an odd-count median as the middle value", () => {
    const result = computeBoxPlotStatistics([1, 2, 3, 4, 5]);
    expect(result.median).toBe(3);
    // lower half [1,2] -> q1 = 1.5, upper half [4,5] -> q3 = 4.5
    expect(result.q1).toBe(1.5);
    expect(result.q3).toBe(4.5);
  });

  it("computes an even-count median as the average of the two middle values", () => {
    const result = computeBoxPlotStatistics([1, 2, 3, 4]);
    expect(result.median).toBe(2.5);
    // lower half [1,2] -> q1 = 1.5, upper half [3,4] -> q3 = 3.5
    expect(result.q1).toBe(1.5);
    expect(result.q3).toBe(3.5);
  });

  it("does not depend on input order", () => {
    const sortedResult = computeBoxPlotStatistics([1, 2, 3, 4, 5]);
    const shuffledResult = computeBoxPlotStatistics([5, 1, 4, 2, 3]);
    expect(shuffledResult).toEqual(sortedResult);
  });
});

describe("computeBoxPlotStatistics — whiskers and statistical outliers", () => {
  it("flags a strong outlier beyond the upper 1.5xIQR fence and excludes it from the whisker", () => {
    // [1,2,3,4,5]: q1=1.5, q3=4.5, iqr=3, upper fence = 4.5+4.5=9
    const result = computeBoxPlotStatistics([1, 2, 3, 4, 5, 50]);
    expect(result.outliers).toContain(50);
    expect(result.maxWhisker).not.toBe(50);
    expect(result.maxWhisker).toBeLessThan(50);
  });

  it("flags a strong outlier beyond the lower 1.5xIQR fence", () => {
    const result = computeBoxPlotStatistics([-50, 1, 2, 3, 4, 5]);
    expect(result.outliers).toContain(-50);
    expect(result.minWhisker).not.toBe(-50);
  });

  it("a value exactly on the fence is not an outlier", () => {
    // q1=1.5, q3=4.5 (from [1,2,3,4,5]), iqr=3, upper fence=9
    const result = computeBoxPlotStatistics([1, 2, 3, 4, 5, 9]);
    expect(result.outliers).not.toContain(9);
    expect(result.maxWhisker).toBe(9);
  });

  it("has no outliers when the data is tightly clustered", () => {
    const result = computeBoxPlotStatistics([3.7, 3.72, 3.75, 3.78, 3.8]);
    expect(result.outliers).toEqual([]);
  });
});

describe("computeBoxPlotStatistics — in/out handle separation is the caller's job", () => {
  it("computes independent statistics per array — no cross-contamination by construction", () => {
    const inErrors = [0.01, 0.02, -0.01, 0.0];
    const outErrors = [0.1, 0.12, 0.09, 0.11];

    const inStats = computeBoxPlotStatistics(inErrors);
    const outStats = computeBoxPlotStatistics(outErrors);

    expect(inStats.median).not.toBe(outStats.median);
    expect(inStats.count).toBe(4);
    expect(outStats.count).toBe(4);
  });
});
