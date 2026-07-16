/**
 * Central, reusable copy for Assessment Result screens (Phase C) — the
 * result-viewing counterpart to assessmentContent.ts (which covers the
 * execution flow). Every explanation follows
 * docs/UX_WRITING_GUIDELINES.md's "Separate facts from interpretation" and
 * docs/COACHING_PRINCIPLES.md's "Never diagnose technique directly": facts
 * (MAE, Bias, Standard Deviation, category rates) are described as
 * measurements, never as a verdict, ranking, or diagnosis. No result label
 * here is ever "Perfect", "Poor", "Elite", or similar — see
 * docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md sections 2 and 20.
 */
import type { AnalyticsExplanation } from "./analyticsExplanations";

export const ASSESSMENT_MAE_EXPLANATION: AnalyticsExplanation = {
  id: "assessment-mae",
  title: "Mean Absolute Error",
  shortDescription: "The average absolute difference between actual and target time.",
  whatItShows: "The average absolute difference between actual and target time.",
  howToRead: ["Direction is ignored — a shot that ran long and one that ran short count the same."],
  betterMeans: ["Lower means the measured times were closer to target, on average."],
};

export const ASSESSMENT_BIAS_EXPLANATION: AnalyticsExplanation = {
  id: "assessment-bias",
  title: "Bias",
  shortDescription: "The average signed difference from target time.",
  whatItShows: "The average signed difference from target time.",
  howToRead: [
    "A positive Bias means the measured time was higher than target, on average.",
    "A negative Bias means the measured time was lower than target, on average.",
    "A low Bias does not by itself mean high consistency — positive and negative errors can cancel out.",
  ],
  betterMeans: ["Closer to zero means less systematic tendency to run long or short."],
};

export const ASSESSMENT_STANDARD_DEVIATION_EXPLANATION: AnalyticsExplanation = {
  id: "assessment-standard-deviation",
  title: "Standard Deviation",
  shortDescription: "How consistently the timing errors are grouped around the average error.",
  whatItShows: "How consistently the timing errors are grouped around the average error.",
  howToRead: ["This describes consistency, not accuracy — a tightly grouped set of errors can still be far from zero."],
  betterMeans: ["Lower means the errors were more tightly grouped."],
};

export function assessmentCategoryExplanation(thresholds: {
  onTarget: number;
  acceptable: number;
}): AnalyticsExplanation {
  return {
    id: "assessment-category",
    title: "On Target / Acceptable / Major Miss",
    shortDescription: "Category rates depend on the active threshold configuration.",
    whatItShows: `Under the active thresholds: On Target is within ±${thresholds.onTarget.toFixed(2)}s of target, Acceptable is within ±${thresholds.acceptable.toFixed(2)}s, and Major Miss is anything beyond that.`,
    howToRead: [
      "These rates change if the active Analysis Threshold Set changes — Mean Absolute Error, Bias, and Standard Deviation never do.",
    ],
    betterMeans: ["A higher On Target rate and lower Major Miss rate, under the same threshold set."],
  };
}

export const ASSESSMENT_TARGET_AGGREGATION_EXPLANATION =
  "Target results combine all scored attempts with the same target time across the Assessment Run, including Variable Adaptation.";

export const ASSESSMENT_HANDLE_COMPARISON_EXPLANATION =
  "Timing differences between handles can indicate a pattern worth reviewing, but timing data alone does not identify the technical cause.";

export const ASSESSMENT_HANDLE_GROUPING_NOTE =
  "Handle results group attempts by the handle actually executed. A wrong-handle attempt still counts, and stays visible as a protocol deviation.";

export const ASSESSMENT_VARIABLE_ADAPTATION_RESTRAINT_NOTE =
  "This block contains eight scored stones. Breakdowns by target should be treated as descriptive, not definitive.";

export const ASSESSMENT_THRESHOLD_CONTROL_EXPLANATION =
  "Changing analysis thresholds only changes how results are grouped. It does not change the recorded times or original Assessment Run.";

export const ASSESSMENT_ORIGINAL_THRESHOLD_NOTE =
  "Original shows the thresholds selected before this run began, kept for historical transparency.";

export const ASSESSMENT_COMPARISON_THRESHOLD_EXPLANATION =
  "Comparing category-based metrics across runs requires one shared Comparison Threshold Set. The original Run Thresholds for each run may differ and remain visible in that run's own detail.";

export const ASSESSMENT_NO_SECOND_RUN_NOTICE =
  "Complete another comparable assessment to see development over time.";

export const ASSESSMENT_TREND_LIMITED_NOTICE =
  "A line between two runs shows a change, not a trend. Treat it as a starting point, not a conclusion.";

export const ASSESSMENT_RESULT_RECORDED_TIMES_UNCHANGED_NOTE =
  "Recorded times remain unchanged. This view only changes how they are grouped for analysis.";

export const ASSESSMENT_DELETE_RUN_EXPLANATION =
  "Deleting this Assessment Run removes its results and any comparisons that use it. This does not affect Training Sessions or the Assessment Template.";
