/**
 * Analyze's "What should I learn from this training?" opening sentence
 * (docs/INFORMATION_ARCHITECTURE_AND_SCREEN_PHILOSOPHY.md's Analyze
 * "Information Hierarchy": key takeaway before summary metrics).
 *
 * Compares the earlier half of the current selection's comparable blocks
 * against the more recent half using the same, already-tested
 * `aggregateTargetAccuracyAcrossBlocks` every other History surface reads
 * from — this module adds no new analytics formula, only a comparison and a
 * plain-language description of it.
 *
 * Follows docs/COACHING_PRINCIPLES.md's Coaching Hierarchy: Level 1 ("what
 * happened") facts only — a measured before/after description, never a
 * diagnosis of technique and never a claim of statistical certainty. Stays
 * silent (returns null) below a minimum sample size rather than reporting
 * noise as a takeaway ("Show uncertainty honestly").
 */
import { aggregateTargetAccuracyAcrossBlocks } from "./historyAnalysis";
import type { HistoryAnalysisBlockContext } from "./historyAnalysis";

export type TrainingInsight = {
  headline: string;
};

/** Fewer comparable blocks than this and there is nothing to compare yet. */
const MIN_BLOCKS_WITH_SHOTS = 2;
/** Fewer shots than this in either half and a rate comparison is noise, not a fact. */
const MIN_SHOTS_PER_HALF = 3;

/** Smallest change worth reporting — anything below this reads as noise, not a takeaway. */
const MAJOR_MISS_RATE_EPSILON = 0.05; // 5 percentage points
const AVERAGE_ERROR_EPSILON = 0.02; // seconds
const ON_TARGET_RATE_EPSILON = 0.05; // 5 percentage points

function percent(rate: number): number {
  return Math.round(rate * 100);
}

/**
 * Builds the one hedged, fact-first sentence Analyze leads with, or null
 * when the current selection doesn't yet support a meaningful comparison —
 * callers should fall back to a plain "keep training" empty state, never a
 * fabricated trend.
 */
export function buildTrainingInsight(
  blocks: HistoryAnalysisBlockContext[]
): TrainingInsight | null {
  const withShots = blocks
    .filter((entry) => entry.shots.length > 0)
    .slice()
    .sort(
      (a, b) =>
        new Date(a.block.createdAt).getTime() -
        new Date(b.block.createdAt).getTime()
    );

  if (withShots.length < MIN_BLOCKS_WITH_SHOTS) return null;

  const mid = Math.ceil(withShots.length / 2);
  const earlierBlocks = withShots.slice(0, mid);
  const recentBlocks = withShots.slice(mid);

  if (earlierBlocks.length === 0 || recentBlocks.length === 0) return null;

  const earlier = aggregateTargetAccuracyAcrossBlocks(earlierBlocks);
  const recent = aggregateTargetAccuracyAcrossBlocks(recentBlocks);

  if (
    earlier.shotCount < MIN_SHOTS_PER_HALF ||
    recent.shotCount < MIN_SHOTS_PER_HALF
  ) {
    return null;
  }

  type Candidate = {
    priority: number;
    magnitude: number;
    headline: string;
  };

  const candidates: Candidate[] = [];

  if (earlier.majorMissRate !== null && recent.majorMissRate !== null) {
    const delta = recent.majorMissRate - earlier.majorMissRate;
    if (Math.abs(delta) >= MAJOR_MISS_RATE_EPSILON) {
      candidates.push({
        priority: 3,
        magnitude: Math.abs(delta),
        headline:
          delta < 0
            ? `Your Major Miss rate has fallen from ${percent(earlier.majorMissRate)}% to ${percent(recent.majorMissRate)}% across your recent blocks.`
            : `Your Major Miss rate has risen from ${percent(earlier.majorMissRate)}% to ${percent(recent.majorMissRate)}% across your recent blocks.`,
      });
    }
  }

  if (
    earlier.meanAbsoluteTargetError !== null &&
    recent.meanAbsoluteTargetError !== null
  ) {
    const delta =
      recent.meanAbsoluteTargetError - earlier.meanAbsoluteTargetError;
    if (Math.abs(delta) >= AVERAGE_ERROR_EPSILON) {
      candidates.push({
        priority: 2,
        magnitude: Math.abs(delta),
        headline:
          delta < 0
            ? `Your Average Error has improved from ${earlier.meanAbsoluteTargetError.toFixed(2)}s to ${recent.meanAbsoluteTargetError.toFixed(2)}s across your recent blocks.`
            : `Your Average Error has moved from ${earlier.meanAbsoluteTargetError.toFixed(2)}s to ${recent.meanAbsoluteTargetError.toFixed(2)}s across your recent blocks.`,
      });
    }
  }

  if (earlier.onTargetRate !== null && recent.onTargetRate !== null) {
    const delta = recent.onTargetRate - earlier.onTargetRate;
    if (Math.abs(delta) >= ON_TARGET_RATE_EPSILON) {
      candidates.push({
        priority: 1,
        magnitude: Math.abs(delta),
        headline:
          delta > 0
            ? `Your On Target rate has improved from ${percent(earlier.onTargetRate)}% to ${percent(recent.onTargetRate)}% across your recent blocks.`
            : `Your On Target rate has moved from ${percent(earlier.onTargetRate)}% to ${percent(recent.onTargetRate)}% across your recent blocks.`,
      });
    }
  }

  if (candidates.length === 0) {
    return {
      headline:
        "Your results have stayed steady across your recent blocks — no clear change yet.",
    };
  }

  // Major Misses first (docs/COACHING_PRINCIPLES.md: "Major Misses deserve
  // special attention... often represent meaningful progress even before
  // precision improves"), then by how large the change is.
  candidates.sort((a, b) => b.priority - a.priority || b.magnitude - a.magnitude);

  return { headline: candidates[0].headline };
}
