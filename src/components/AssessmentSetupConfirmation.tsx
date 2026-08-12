import { ASSESSMENT_SETUP_NOTES, ASSESSMENT_SETUP_REQUIREMENTS } from "../lib/assessmentContent";

export type AssessmentTimingMethod = "manual" | "simulator";

type AssessmentSetupConfirmationProps = {
  timingMethod: AssessmentTimingMethod;
  onChangeTimingMethod: (method: AssessmentTimingMethod) => void;
  /** The Timing Simulator is a dev/test-only aid (see TimingSimulatorPanel) — never offered in production. */
  showSimulatorOption: boolean;
  confirmed: boolean;
  onChangeConfirmed: (confirmed: boolean) => void;
  /** See AssessmentThresholdSelector's identical prop — same readiness-gating rationale. */
  disabled?: boolean;
};

/**
 * Setup Requirements + a single confirmation before Warm-up can start — see
 * docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md sections 24/25. Manual
 * Timing never claims a physical gate exists; it only asks the athlete to
 * confirm their timing method is ready.
 */
export default function AssessmentSetupConfirmation({
  timingMethod,
  onChangeTimingMethod,
  showSimulatorOption,
  confirmed,
  onChangeConfirmed,
  disabled = false,
}: AssessmentSetupConfirmationProps) {
  return (
    <div>
      <h3 className="text-sm font-semibold text-slate-900">Setup Requirements</h3>

      <ul className="mt-2 list-disc space-y-1 pl-4 text-xs text-slate-600">
        {ASSESSMENT_SETUP_REQUIREMENTS.map((requirement) => (
          <li key={requirement}>{requirement}</li>
        ))}
      </ul>

      <p className="mt-2 text-xs text-slate-500">{ASSESSMENT_SETUP_NOTES}</p>

      {showSimulatorOption && (
        <div className="mt-3">
          <p className="text-xs font-medium text-slate-700">Timing method</p>
          <div className="mt-1 grid grid-cols-2 gap-2">
            <button
              type="button"
              onClick={() => onChangeTimingMethod("manual")}
              disabled={disabled}
              // Selection, not an action — distinct from the primary Start
              // Warm-up button's solid dark treatment (DESIGN_SYSTEM.md §13.1).
              className={`rounded-lg px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                timingMethod === "manual"
                  ? "bg-slate-100 text-slate-900 ring-2 ring-inset ring-slate-900"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {timingMethod === "manual" && <span aria-hidden="true">✓ </span>}
              Manual entry
            </button>
            <button
              type="button"
              onClick={() => onChangeTimingMethod("simulator")}
              disabled={disabled}
              className={`rounded-lg px-3 py-2 text-xs font-medium transition disabled:cursor-not-allowed disabled:opacity-50 ${
                timingMethod === "simulator"
                  ? "bg-slate-100 text-slate-900 ring-2 ring-inset ring-slate-900"
                  : "bg-slate-100 text-slate-700 hover:bg-slate-200"
              }`}
            >
              {timingMethod === "simulator" && <span aria-hidden="true">✓ </span>}
              Timing Simulator (dev)
            </button>
          </div>
        </div>
      )}

      <label className="mt-3 flex items-start gap-2 rounded-xl bg-slate-50 p-3">
        <input
          type="checkbox"
          checked={confirmed}
          disabled={disabled}
          onChange={(event) => onChangeConfirmed(event.target.checked)}
          className="mt-0.5 h-4 w-4"
        />
        <span className="text-sm text-slate-700">
          {timingMethod === "manual" ? (
            <>
              Timing method is ready. I&apos;ll enter measured times manually, using
              Backline–Hog, and the delivery path is clear.
            </>
          ) : (
            <>
              Gates are positioned correctly, Backline–Hog mode is selected, the timing
              system has been tested, and the delivery path is clear.
            </>
          )}
        </span>
      </label>
    </div>
  );
}
