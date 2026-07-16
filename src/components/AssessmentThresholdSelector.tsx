import type { AccuracyThresholdPreset } from "../lib/accuracyThresholds";
import {
  ASSESSMENT_STANDARD_THRESHOLDS,
  ASSESSMENT_TIGHT_THRESHOLDS,
  type ThresholdValidationIssueCode,
  type ThresholdValidationResult,
} from "../lib/assessment/thresholds";
import { ASSESSMENT_THRESHOLD_EXPLANATION } from "../lib/assessmentContent";

const ISSUE_MESSAGES: Record<ThresholdValidationIssueCode, string> = {
  on_target_must_be_finite: "Enter a valid number for On Target.",
  acceptable_must_be_finite: "Enter a valid number for Acceptable.",
  on_target_must_be_positive: "On Target must be greater than zero.",
  acceptable_must_be_positive: "Acceptable must be greater than zero.",
  on_target_must_be_less_than_acceptable: "On Target must be smaller than Acceptable.",
  unsupported_precision: "Use hundredths of a second, e.g. 0.12.",
  out_of_supported_range: "Must be between 0.01s and 5s.",
};

type AssessmentThresholdSelectorProps = {
  preset: AccuracyThresholdPreset;
  onChangePreset: (preset: AccuracyThresholdPreset) => void;
  customOnTargetInput: string;
  customAcceptableInput: string;
  onChangeCustomOnTargetInput: (value: string) => void;
  onChangeCustomAcceptableInput: (value: string) => void;
  /** Only meaningful (and only shown) when preset === "custom". */
  customValidation: ThresholdValidationResult | null;
};

const PRESET_OPTIONS: { id: AccuracyThresholdPreset; label: string }[] = [
  { id: "standard", label: "Standard" },
  { id: "tight", label: "Tight" },
  { id: "custom", label: "Custom" },
];

/**
 * Accuracy Threshold selection required before every Assessment Run — see
 * docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 10. Standard
 * and Tight are recommendations, not validated sporting standards; "Tight"
 * is deliberately not framed as a harder or more elite protocol (see
 * docs/UX_WRITING_GUIDELINES.md's Assessment Language section).
 */
export default function AssessmentThresholdSelector({
  preset,
  onChangePreset,
  customOnTargetInput,
  customAcceptableInput,
  onChangeCustomOnTargetInput,
  onChangeCustomAcceptableInput,
  customValidation,
}: AssessmentThresholdSelectorProps) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900">Accuracy Thresholds</h3>
      <p className="mt-1 text-xs text-slate-600">{ASSESSMENT_THRESHOLD_EXPLANATION}</p>

      <div
        role="radiogroup"
        aria-label="Accuracy Threshold preset"
        className="mt-3 grid grid-cols-3 gap-2"
      >
        {PRESET_OPTIONS.map((option) => (
          <button
            key={option.id}
            type="button"
            role="radio"
            aria-checked={preset === option.id}
            onClick={() => onChangePreset(option.id)}
            className={`rounded-xl px-3 py-3 text-sm font-medium transition focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500 ${
              preset === option.id
                ? "bg-slate-900 text-white"
                : "bg-slate-100 text-slate-700 hover:bg-slate-200"
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>

      <div className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
        {preset === "standard" && (
          <p>
            On Target: ±{ASSESSMENT_STANDARD_THRESHOLDS.onTarget.toFixed(2)}s · Acceptable: ±
            {ASSESSMENT_STANDARD_THRESHOLDS.acceptable.toFixed(2)}s
          </p>
        )}
        {preset === "tight" && (
          <p>
            On Target: ±{ASSESSMENT_TIGHT_THRESHOLDS.onTarget.toFixed(2)}s · Acceptable: ±
            {ASSESSMENT_TIGHT_THRESHOLDS.acceptable.toFixed(2)}s
          </p>
        )}
        {preset === "custom" && (
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

            <p className="text-slate-500">
              Supported precision: hundredths of a second, between 0.01s and 5s. These
              limits are technical bounds, not a validated sporting standard.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
