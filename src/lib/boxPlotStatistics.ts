/**
 * Pure, generic boxplot statistics over a plain list of numbers. Used for
 * Target Error distributions (overall and per-handle) — never for raw
 * Release Times, per this project's Boxplot rule (see
 * docs/DOMAIN_GLOSSARY.md / SYSTEM_ARCHITECTURE.md analytics section).
 *
 * Quantile method: Moore/McCabe "median-of-halves" (Tukey hinges). Sort
 * ascending; Q2 (median) is the median of the whole set; split the sorted
 * values into a lower and upper half — excluding the middle value when the
 * count is odd — and Q1/Q3 are the median of the lower/upper half
 * respectively. This is the same method used throughout this module's tests
 * and must stay the single method used by analytics and charts alike (no
 * mixing with e.g. linear-interpolation quantiles).
 *
 * Outlier rule: standard Tukey fences — a value is a statistical outlier if
 * it falls below (Q1 - 1.5*IQR) or above (Q3 + 1.5*IQR). Whiskers extend to
 * the most extreme *in-fence* data point, not to the fence value itself.
 *
 * This "statistical outlier" concept is intentionally distinct from the
 * "Major Miss" domain concept (absoluteTargetError > thresholds.acceptable,
 * see src/lib/accuracyThresholds.ts) — the two must never be conflated,
 * relabeled as one another, or cross-exported.
 */
export type BoxPlotStatistics = {
  count: number;
  minWhisker: number | null;
  q1: number | null;
  median: number | null;
  q3: number | null;
  maxWhisker: number | null;
  outliers: number[];
};

const EMPTY_BOX_PLOT: BoxPlotStatistics = {
  count: 0,
  minWhisker: null,
  q1: null,
  median: null,
  q3: null,
  maxWhisker: null,
  outliers: [],
};

function medianOfSorted(sortedValues: number[]): number {
  const middle = Math.floor(sortedValues.length / 2);

  if (sortedValues.length % 2 === 0) {
    return (sortedValues[middle - 1] + sortedValues[middle]) / 2;
  }

  return sortedValues[middle];
}

export function computeBoxPlotStatistics(values: number[]): BoxPlotStatistics {
  if (values.length === 0) return EMPTY_BOX_PLOT;

  const sorted = [...values].sort((a, b) => a - b);
  const count = sorted.length;
  const med = medianOfSorted(sorted);

  const halfIndex = Math.floor(count / 2);
  const lowerHalf = sorted.slice(0, halfIndex);
  const upperHalf =
    count % 2 === 0 ? sorted.slice(halfIndex) : sorted.slice(halfIndex + 1);

  const q1 = lowerHalf.length > 0 ? medianOfSorted(lowerHalf) : med;
  const q3 = upperHalf.length > 0 ? medianOfSorted(upperHalf) : med;
  const iqr = q3 - q1;

  const lowerFence = q1 - 1.5 * iqr;
  const upperFence = q3 + 1.5 * iqr;

  const inFence = sorted.filter(
    (value) => value >= lowerFence && value <= upperFence
  );
  const outliers = sorted.filter(
    (value) => value < lowerFence || value > upperFence
  );

  return {
    count,
    minWhisker: inFence.length > 0 ? Math.min(...inFence) : med,
    q1,
    median: med,
    q3,
    maxWhisker: inFence.length > 0 ? Math.max(...inFence) : med,
    outliers,
  };
}
