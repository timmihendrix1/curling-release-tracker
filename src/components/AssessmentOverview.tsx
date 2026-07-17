import type { AccuracyThresholdPreset } from "../lib/accuracyThresholds";
import { RELEASE_TIME_CORE_ASSESSMENT_V1 } from "../lib/assessment/templates";
import type { ThresholdValidationResult } from "../lib/assessment/thresholds";
import {
  ASSESSMENT_WHAT_IT_DOES_NOT_MEASURE,
  ASSESSMENT_WHAT_IT_MEASURES,
  ASSESSMENT_WHY_STRUCTURE,
} from "../lib/assessmentContent";
import AssessmentSetupConfirmation, {
  type AssessmentTimingMethod,
} from "./AssessmentSetupConfirmation";
import AssessmentSetupDiagram from "./AssessmentSetupDiagram";
import AssessmentThresholdSelector from "./AssessmentThresholdSelector";
import { surfaceClass } from "./Surface";

type AssessmentOverviewProps = {
  thresholdPreset: AccuracyThresholdPreset;
  onChangeThresholdPreset: (preset: AccuracyThresholdPreset) => void;
  customOnTargetInput: string;
  customAcceptableInput: string;
  onChangeCustomOnTargetInput: (value: string) => void;
  onChangeCustomAcceptableInput: (value: string) => void;
  customValidation: ThresholdValidationResult | null;
  timingMethod: AssessmentTimingMethod;
  onChangeTimingMethod: (method: AssessmentTimingMethod) => void;
  showSimulatorOption: boolean;
  setupConfirmed: boolean;
  onChangeSetupConfirmed: (confirmed: boolean) => void;
  onOpenProtocol: () => void;
  onShowIntroduction: () => void;
  canStart: boolean;
  trainingConflictMessage: string | null;
  onStartWarmup: () => void;
  onBack: () => void;
};

const template = RELEASE_TIME_CORE_ASSESSMENT_V1;

/**
 * Compact Release Time Core Assessment v1 overview with progressive
 * disclosure — see
 * docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 23. Threshold
 * selection and setup confirmation are both required, visibly, before
 * "Start Warm-up" becomes available.
 */
export default function AssessmentOverview({
  thresholdPreset,
  onChangeThresholdPreset,
  customOnTargetInput,
  customAcceptableInput,
  onChangeCustomOnTargetInput,
  onChangeCustomAcceptableInput,
  customValidation,
  timingMethod,
  onChangeTimingMethod,
  showSimulatorOption,
  setupConfirmed,
  onChangeSetupConfirmed,
  onOpenProtocol,
  onShowIntroduction,
  canStart,
  trainingConflictMessage,
  onStartWarmup,
  onBack,
}: AssessmentOverviewProps) {
  return (
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="text-sm font-medium text-slate-600 hover:text-slate-900"
      >
        ← Back to Assess
      </button>

      {/* Compose around the protocol itself: identity, required threshold
          decision and the final readiness confirmation are three sections
          of ONE setup task, not three competing cards (compositional
          redesign — see docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md
          section 23 and this screen's IA purpose, "readiness to start"). */}
      <div className={surfaceClass("hero")}>
        <h1 className="text-xl font-semibold text-slate-900">
          {template.name} <span className="text-slate-400">v{template.version}</span>
        </h1>
        <p className="mt-1 text-sm text-slate-600">{template.description}</p>

        <ul className="mt-3 grid grid-cols-2 gap-2 text-xs text-slate-600">
          <li>{template.protocolMetadata.scoredShotCount} scored stones</li>
          <li>{template.protocolMetadata.warmupShotCount} warm-up stones</li>
          <li>{template.blocks.length} blocks</li>
          <li>Backline–Hog</li>
          <li className="col-span-2">
            Approximately {template.estimatedDurationMinutes.min}–
            {template.estimatedDurationMinutes.max} minutes
          </li>
        </ul>

        <div className="mt-3 flex flex-wrap gap-3 text-sm">
          <button
            type="button"
            onClick={onShowIntroduction}
            className="font-medium text-slate-700 underline hover:text-slate-900"
          >
            How this assessment works
          </button>
          <button
            type="button"
            onClick={onOpenProtocol}
            className="font-medium text-slate-700 underline hover:text-slate-900"
          >
            View full protocol
          </button>
        </div>

        <div className="mt-6 border-t border-slate-100 pt-5">
          <AssessmentThresholdSelector
            preset={thresholdPreset}
            onChangePreset={onChangeThresholdPreset}
            customOnTargetInput={customOnTargetInput}
            customAcceptableInput={customAcceptableInput}
            onChangeCustomOnTargetInput={onChangeCustomOnTargetInput}
            onChangeCustomAcceptableInput={onChangeCustomAcceptableInput}
            customValidation={customValidation}
          />
        </div>

        <div className="mt-6 border-t border-slate-100 pt-5">
          <AssessmentSetupConfirmation
            timingMethod={timingMethod}
            onChangeTimingMethod={onChangeTimingMethod}
            showSimulatorOption={showSimulatorOption}
            confirmed={setupConfirmed}
            onChangeConfirmed={onChangeSetupConfirmed}
          />

          <details className="mt-3 group">
            <summary className="cursor-pointer text-sm font-medium text-slate-700 marker:content-none">
              View setup diagram
            </summary>
            <div className="mt-3">
              <AssessmentSetupDiagram />
            </div>
          </details>
        </div>
      </div>

      {/* Reference material, not a required setup step — collapsed by
          default (progressive disclosure). */}
      <details className="group rounded-xl border border-slate-200 bg-white">
        <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-700 marker:content-none">
          <span className="flex items-center justify-between gap-2">
            <span>What this assessment measures</span>
            <span className="text-xs text-slate-400 group-open:hidden">Show</span>
            <span className="hidden text-xs text-slate-400 group-open:inline">Hide</span>
          </span>
        </summary>

        <div className="border-t border-slate-100 px-4 py-3">
          <ul className="list-disc space-y-1 pl-4 text-sm text-slate-600">
            {ASSESSMENT_WHAT_IT_MEASURES.map((line) => (
              <li key={line}>{line}</li>
            ))}
          </ul>
          <p className="mt-3 text-xs text-slate-500">{ASSESSMENT_WHAT_IT_DOES_NOT_MEASURE}</p>

          <h2 className="mt-4 text-sm font-semibold text-slate-900">Why this structure</h2>
          <p className="mt-1 text-sm text-slate-600">{ASSESSMENT_WHY_STRUCTURE}</p>
        </div>
      </details>

      {trainingConflictMessage && (
        <div className="rounded-2xl bg-amber-50 p-4 text-sm text-amber-800 ring-1 ring-amber-200">
          {trainingConflictMessage}
        </div>
      )}

      <button
        type="button"
        onClick={onStartWarmup}
        disabled={!canStart}
        className="w-full rounded-xl bg-slate-900 px-4 py-4 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:bg-slate-300"
      >
        Start Warm-up
      </button>
    </div>
  );
}
