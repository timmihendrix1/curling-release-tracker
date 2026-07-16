import type { AnalysisThresholdMode } from "../lib/assessment/result";
import {
  ASSESSMENT_STANDARD_THRESHOLDS,
  ASSESSMENT_TIGHT_THRESHOLDS,
  type ThresholdValidationIssueCode,
  type ThresholdValidationResult,
} from "../lib/assessment/thresholds";
import type { AccuracyThresholdSet } from "../lib/assessment/types";
import { ASSESSMENT_THRESHOLD_CONTROL_EXPLANATION } from "../lib/assessmentResultContent";

const ISSUE_MESSAGES: Record<ThresholdValidationIssueCode, string> = {
  on_target_must_be_finite: "Enter a valid number for On Target.",
  acceptable_must_be_finite: "Enter a valid number for Acceptable.",
  on_target_must_be_positive: "On Target must be greater than zero.",
  acceptable_must_be_positive: "Acceptable must be greater than zero.",
  on_target_must_be_less_than_acceptable: "On Target must be smaller than Acceptable.",
  unsupported_precision: "Use hundredths of a second, e.g. 0.12.",
  out_of_supported_range: "Must be between 0.01s and 5s.",
};

type AssessmentThresholdControlProps = {
  mode: AnalysisThresholdMode;
  onChangeMode: (mode: AnalysisThresholdMode) => void;
  /** Omit together with `allowOriginal={false}` for multi-run contexts (comparison/trends), where "Original" is ambiguous across runs — see spec section 19. */
  originalThresholdSet?: AccuracyThresholdSet;
  allowOriginal?: boolean;
  customOnTargetInput: string;
  customAcceptableInput: string;
  onChangeCustomOnTargetInput: (value: string) => void;
  onChangeCustomAcceptableInput: (value: string) => void;
  customValidation: ThresholdValidationResult | null;
};

const ALL_MODE_OPTIONS: { id: AnalysisThresholdMode; label: string }[] = [
  { id: "original", label: "Original" },
  { id: "standard", label: "Standard" },
  { id: "tight", label: "Tight" },
  { id: "custom", label: "Custom" },
];

/**
 * The Analysis Threshold control for a single completed run's Result Screen
 * — distinct from AssessmentThresholdSelector (used before a run starts, to
 * pick the Run Threshold Snapshot). This one only affects how the same
 * recorded times are grouped for on-screen category metrics; it never
 * mutates the run. See
 * docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 21.
 */
export default function AssessmentThresholdControl({
  mode,
  onChangeMode,
  originalThresholdSet,
  allowOriginal = true,
  customOnTargetInput,
  customAcceptableInput,
  onChangeCustomOnTargetInput,
  onChangeCustomAcceptableInput,
  customValidation,
}: AssessmentThresholdControlProps) {
  const modeOptions = allowOriginal
    ? ALL_MODE_OPTIONS
    : ALL_MODE_OPTIONS.filter((option) => option.id !== "original");

  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900">
        {allowOriginal ? "Analysis Thresholds" : "Comparison Threshold"}
      </h3>
      <p className="mt-1 text-xs text-slate-600">{ASSESSMENT_THRESHOLD_CONTROL_EXPLANATION}</p>

      <div
        role="radiogroup"
        aria-label={allowOriginal ? "Analysis Threshold Set" : "Comparison Threshold Set"}
        className={`mt-3 grid gap-2 ${allowOriginal ? "grid-cols-4" : "grid-cols-3"}`}
      >
        {modeOptions.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={mode === option.id}
            onClick={() => onChangeMode(option.id)}
            className={`rounded-xl px-2 py-3 text-xs font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 sm:text-sm ${
              mode === option.id
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
        {mode === "original" && originalThresholdSet && (
          <p>
            On Target: ±{originalThresholdSet.values.onTarget.toFixed(2)}s · Acceptable: ±
            {originalThresholdSet.values.acceptable.toFixed(2)}s — the thresholds selected before this
            run began.
          </p>
        )}
        {mode === "standard" && (
          <p>
            On Target: ±{ASSESSMENT_STANDARD_THRESHOLDS.onTarget.toFixed(2)}s · Acceptable: ±
            {ASSESSMENT_STANDARD_THRESHOLDS.acceptable.toFixed(2)}s
          </p>
        )}
        {mode === "tight" && (
          <p>
            On Target: ±{ASSESSMENT_TIGHT_THRESHOLDS.onTarget.toFixed(2)}s · Acceptable: ±
            {ASSESSMENT_TIGHT_THRESHOLDS.acceptable.toFixed(2)}s
          </p>
        )}
        {mode === "custom" && (
          <div className="space-y-3">
            <div className="grid grid-cols-2 gap-3">
              <label className="block">
                <span className="text-xs font-medium text-slate-700">On Target (s)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={customOnTargetInput}
                  onChange={(event) => onChangeCustomOnTargetInput(event.target.value)}
                  placeholder="0.10"
                  aria-label="Custom On Target threshold, seconds"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                />
              </label>

              <label className="block">
                <span className="text-xs font-medium text-slate-700">Acceptable (s)</span>
                <input
                  type="text"
                  inputMode="decimal"
                  value={customAcceptableInput}
                  onChange={(event) => onChangeCustomAcceptableInput(event.target.value)}
                  placeholder="0.20"
                  aria-label="Custom Acceptable threshold, seconds"
                  className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
                />
              </label>
            </div>

            {customValidation && !customValidation.valid && (
              <ul className="list-disc space-y-1 pl-4 text-red-700">
                {customValidation.issues.map((issue) => (
                  <li key={issue}>{ISSUE_MESSAGES[issue]}</li>
                ))}
              </ul>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
