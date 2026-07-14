/**
 * Central, reusable metric/chart explanation content. One source of truth for
 * every Info popover, mobile bottom sheet, and chart subtitle — no
 * explanation text is ever duplicated per component. See
 * docs/SYSTEM_ARCHITECTURE.md's "Analytics explanation architecture" section.
 *
 * Current Session and History use the same mathematical definitions but
 * different interpretation framing (`ExplanationContext`) — immediate,
 * in-block feedback vs. recurring patterns across comparable blocks. Neither
 * variant ever states an automatic diagnosis ("this proves...") — only
 * "may indicate" framing.
 */
import type { MeasurementMode } from "../types";
import type { ProgressMetricKey } from "./chartData";

export type AnalyticsExplanation = {
  id: string;
  title: string;
  shortDescription: string;
  whatItShows: string;
  howToRead: string[];
  betterMeans: string[];
  possiblePatterns?: string[];
  limitations?: string[];
};

export type ExplanationContext = "current" | "history";

type ThresholdContext = { onTarget: number; acceptable: number };

const BACK_HOG_BIAS_NOTE =
  "For Back–Hog timing, a lower time usually means more weight and a longer result. A higher time usually means less weight and a shorter result.";

const BACK_HOG_TARGET_ERROR_NOTE =
  "For Back–Hog timing, lower times generally mean more weight and a longer result. Higher times generally mean less weight and a shorter result.";

export function biasExplanation(
  measurementMode: MeasurementMode
): AnalyticsExplanation {
  return {
    id: "bias",
    title: "Bias",
    shortDescription:
      "Shows whether your shots systematically fall on one side of the target.",
    whatItShows:
      "Bias is the average signed target error. A value close to zero means there is little systematic tendency. A negative or positive value shows the direction of the average deviation.",
    howToRead: [
      "A low bias does not automatically mean high consistency. Positive and negative errors can cancel each other out.",
      ...(measurementMode === "back-hog" ? [BACK_HOG_BIAS_NOTE] : []),
    ],
    betterMeans: ["Closer to zero is better."],
  };
}

export function averageErrorExplanation(): AnalyticsExplanation {
  return {
    id: "averageError",
    title: "Average Error",
    shortDescription:
      "Average absolute difference between actual and target time. Lower is better.",
    whatItShows:
      "Average absolute difference between actual and target time. Direction is ignored.",
    howToRead: [
      "This is the same as Mean Absolute Error (MAE) — it is not the same as Bias, which keeps the direction of the error.",
    ],
    betterMeans: ["Lower is better."],
  };
}

export function consistencyExplanation(): AnalyticsExplanation {
  return {
    id: "consistency",
    title: "Consistency",
    shortDescription:
      "Standard deviation of target errors. Lower is more consistent.",
    whatItShows:
      "Standard deviation of target errors. It shows how tightly your shots cluster.",
    howToRead: [
      "A low SD means your shots land in a tight spread.",
      "It says nothing on its own about Bias.",
    ],
    betterMeans: ["Lower is more consistent."],
  };
}

export function onTargetExplanation(
  thresholds: ThresholdContext
): AnalyticsExplanation {
  return {
    id: "onTarget",
    title: "On Target",
    shortDescription: `Percentage of shots within ±${thresholds.onTarget.toFixed(2)}s of target.`,
    whatItShows: `Percentage of shots within the selected On Target tolerance (±${thresholds.onTarget.toFixed(2)}s).`,
    howToRead: [],
    betterMeans: ["Higher is better."],
  };
}

export function acceptableExplanation(
  thresholds: ThresholdContext
): AnalyticsExplanation {
  return {
    id: "acceptable",
    title: "Acceptable",
    shortDescription:
      "Shots outside On Target but still within the broader tolerance.",
    whatItShows: `Percentage of shots outside On Target (±${thresholds.onTarget.toFixed(2)}s) but still inside the broader Acceptable tolerance (±${thresholds.acceptable.toFixed(2)}s).`,
    howToRead: [
      "A shift from Major Misses to Acceptable shots can already represent meaningful progress, even before the On-Target rate rises strongly.",
    ],
    betterMeans: ["Higher is better, alongside a rising On Target rate."],
  };
}

export function majorMissExplanation(
  thresholds: ThresholdContext
): AnalyticsExplanation {
  return {
    id: "majorMiss",
    title: "Major Misses",
    shortDescription: `Shots outside ±${thresholds.acceptable.toFixed(2)}s of target.`,
    whatItShows: `Shots outside the selected Acceptable tolerance (±${thresholds.acceptable.toFixed(2)}s).`,
    howToRead: [
      "This is a coaching/tolerance category, not a statistical one — it is not the same as a boxplot's statistical outlier.",
    ],
    betterMeans: ["Lower is better."],
  };
}

export function largestMissExplanation(): AnalyticsExplanation {
  return {
    id: "largestMiss",
    title: "Largest Miss",
    shortDescription: "The largest absolute target error in the selected shots.",
    whatItShows: "The largest absolute target error in the selected shots.",
    howToRead: [],
    betterMeans: ["Lower is better."],
  };
}

export function targetErrorByShotExplanation(
  measurementMode: MeasurementMode,
  context: ExplanationContext
): AnalyticsExplanation {
  return {
    id: "targetErrorByShot",
    title: "Target Error by Shot",
    shortDescription: "Shows how far each shot was from its individual target.",
    whatItShows:
      "Each point represents one shot. The zero line means the target was hit exactly. Values below zero indicate a lower release time than the target. Values above zero indicate a higher release time than the target.",
    howToRead: [
      "Points closer to zero are more accurate.",
      "A repeated shift to one side may indicate a systematic bias.",
      "A growing spread may indicate reduced consistency.",
      ...(measurementMode === "back-hog" ? [BACK_HOG_TARGET_ERROR_NOTE] : []),
    ],
    betterMeans: ["Points closer to the zero line are more accurate."],
    possiblePatterns:
      context === "current"
        ? [
            "A repeated shift below zero may indicate that you are currently delivering more weight than intended.",
          ]
        : [
            "Look for sustained changes across several comparable blocks rather than one unusually good session.",
          ],
    limitations: ["A short run of shots does not establish a stable trend."],
  };
}

export function targetVsActualExplanation(
  context: ExplanationContext
): AnalyticsExplanation {
  return {
    id: "targetVsActual",
    title: "Target vs. Actual",
    shortDescription:
      "Shows how closely actual release times match different target times.",
    whatItShows:
      "The horizontal axis shows the target time. The vertical axis shows the actual release time. Points on the diagonal reference line represent a perfect match. Points closer to the line are more accurate.",
    howToRead: [
      "A consistent position above or below the line may indicate bias.",
      "A wide spread around one target may indicate lower consistency at that weight.",
      "Different patterns for In and Out may indicate a handle-specific difference.",
    ],
    betterMeans: ["Points closer to the diagonal are more accurate."],
    possiblePatterns: [
      "Points close to the diagonal: targets are reproduced accurately.",
      "Points remain near one actual time despite changing targets: you may be returning to a preferred weight instead of fully adjusting.",
      "One handle is consistently farther from the diagonal: there may be a handle-specific accuracy or consistency difference.",
    ],
    limitations:
      context === "current"
        ? [
            "Small samples and a single target time limit how much this chart can show yet.",
          ]
        : [
            "Small samples, different ice conditions and unequal target distributions can influence the pattern.",
          ],
  };
}

export function handleBoxplotExplanation(): AnalyticsExplanation {
  return {
    id: "handleBoxplot",
    title: "Handle Boxplot",
    shortDescription: "Shows the distribution of target errors by handle.",
    whatItShows:
      "The line inside each box is the median. The box contains the middle 50% of shots. The whiskers show the typical range. Separate points are statistical outliers.",
    howToRead: [
      "A box centred close to zero suggests low bias.",
      "A narrower box suggests greater consistency.",
      "A shifted box suggests a handle-specific tendency.",
      "Statistical outliers are not the same as Major Misses. Major Misses are defined by your selected accuracy tolerance.",
    ],
    betterMeans: ["A narrow box centred on zero is best."],
  };
}

export function handleBiasConsistencyExplanation(
  handleCount: 1 | 2
): AnalyticsExplanation {
  return {
    id: "handleBiasConsistency",
    title: "Handle Bias and Consistency",
    shortDescription:
      handleCount === 2
        ? "Compares average bias and consistency between handles."
        : "Shows average bias and consistency for the available handle.",
    whatItShows:
      "The point shows the average signed target error. The error bar shows one standard deviation.",
    howToRead: [
      "Point near zero and short error bar: accurate and consistent.",
      "Point away from zero and short error bar: consistent, but systematically biased.",
      "Point near zero and long error bar: little average bias, but inconsistent individual shots.",
      "Point away from zero and long error bar: both bias and inconsistency may require attention.",
    ],
    betterMeans: ["A point near zero with a short error bar is best."],
  };
}

const PROGRESS_METRIC_SUBTITLES: Record<ProgressMetricKey, string> = {
  meanAbsoluteTargetError:
    "Shows how average absolute target error changes across comparable blocks.",
  meanTargetError:
    "Shows whether the systematic tendency moves closer to zero over time.",
  targetErrorStandardDeviation:
    "Shows whether the spread of target errors decreases across blocks.",
  onTargetRate:
    "Shows how often shots meet the selected On Target tolerance.",
  majorMissRate:
    "Shows how often shots fall outside the selected Acceptable tolerance.",
};

export function progressMetricSubtitle(metric: ProgressMetricKey): string {
  return PROGRESS_METRIC_SUBTITLES[metric];
}

export function progressMetricExplanation(
  metric: ProgressMetricKey
): AnalyticsExplanation {
  return {
    id: "progressMetric",
    title: "Progress",
    shortDescription: PROGRESS_METRIC_SUBTITLES[metric],
    whatItShows:
      "Each point represents one training block in chronological order.",
    howToRead: [
      "Lower is better for Average Error, Consistency and Major-Miss Rate.",
      "Closer to zero is better for Bias.",
      "Higher is better for On-Target Rate.",
    ],
    betterMeans: ["See How to Read for the direction that counts as better for this metric."],
    limitations: [
      "Compare blocks with similar training categories, measurement modes and difficulty. Changes in target range, shot count or thresholds can affect results.",
    ],
  };
}

/**
 * The Setup-time overview of Accuracy Thresholds — deliberately short (see
 * UX_WRITING_GUIDELINES.md's "explain, don't overwhelm"), behind the same
 * `InfoButton` used everywhere else. Reuses the On Target/Acceptable/Major
 * Miss category definitions already established by `onTargetExplanation`/
 * `acceptableExplanation`/`majorMissExplanation` above, framed for someone
 * about to choose a tolerance rather than someone reading a result.
 */
export function accuracyThresholdsSetupExplanation(): AnalyticsExplanation {
  return {
    id: "accuracyThresholdsSetup",
    title: "Accuracy Thresholds",
    shortDescription:
      "How close counts as On Target, Acceptable, or a Major Miss for this block.",
    whatItShows:
      "On Target: shots within the tighter tolerance. Acceptable: shots outside On Target but within the broader tolerance. Major Miss: shots outside the Acceptable tolerance.",
    howToRead: [
      "Standard and Tight are recommendations, not scientifically validated performance levels.",
      "Custom lets you match a tolerance to your own training level and goal.",
      "Thresholds are saved with this block, so past blocks stay judged against what you actually trained under.",
    ],
    betterMeans: [],
  };
}

export function shotQualityExplanation(): AnalyticsExplanation {
  return {
    id: "shotQuality",
    title: "Shot Quality Over Time",
    shortDescription:
      "Shows how accurate, acceptable and major-miss shots change over time.",
    whatItShows:
      "Each bar represents one training block and totals 100%. On Target: within the tighter accuracy tolerance. Acceptable: outside On Target but within the broader tolerance. Major Miss: outside the Acceptable tolerance.",
    howToRead: [
      "More On Target indicates greater precision.",
      "Fewer Major Misses indicate better control of severe errors.",
      "A shift from Major Misses to Acceptable shots can already represent meaningful progress, even before On-Target rate rises strongly.",
    ],
    betterMeans: ["More On Target and fewer Major Misses is better."],
  };
}
