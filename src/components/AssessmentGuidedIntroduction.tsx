import { useState } from "react";
import {
  ASSESSMENT_GUIDED_INTRODUCTION_BLOCKS,
  ASSESSMENT_WHY_STRUCTURE,
} from "../lib/assessmentContent";
import { surfaceClass } from "./Surface";

type AssessmentGuidedIntroductionProps = {
  onContinue: (dontShowAgain: boolean) => void;
  onSkip: (dontShowAgain: boolean) => void;
};

/**
 * A short, one-screen explanation of the four blocks — shown by default
 * before the first run, reachable afterward via "How this assessment works".
 * Deliberately a single scrollable list, not a carousel library (see
 * docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 23's Guided
 * Introduction). Skipping never skips threshold selection, setup
 * confirmation, or the warm-up itself — this component only controls whether
 * this explanation screen itself is shown automatically.
 */
export default function AssessmentGuidedIntroduction({
  onContinue,
  onSkip,
}: AssessmentGuidedIntroductionProps) {
  const [dontShowAgain, setDontShowAgain] = useState(false);

  return (
    <div className={surfaceClass("hero")}>
      <h2 className="text-xl font-semibold text-slate-900">How this assessment works</h2>
      <p className="mt-2 text-sm text-slate-600">{ASSESSMENT_WHY_STRUCTURE}</p>

      <ol className="mt-4 space-y-3">
        {ASSESSMENT_GUIDED_INTRODUCTION_BLOCKS.map((block, index) => (
          <li key={block.id} className="rounded-xl bg-slate-50 p-3">
            <p className="text-sm font-semibold text-slate-900">
              {index + 1}. {block.name}
            </p>
            <p className="mt-1 text-sm text-slate-600">{block.description}</p>
          </li>
        ))}
      </ol>

      <label className="mt-4 flex items-center gap-2 text-sm text-slate-600">
        <input
          type="checkbox"
          checked={dontShowAgain}
          onChange={(event) => setDontShowAgain(event.target.checked)}
          className="h-4 w-4"
        />
        Do not show this automatically again
      </label>

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={() => onContinue(dontShowAgain)}
          className="flex-1 rounded-xl bg-slate-900 px-4 py-3 text-sm font-medium text-white transition hover:bg-slate-700"
        >
          Continue
        </button>
        <button
          type="button"
          onClick={() => onSkip(dontShowAgain)}
          className="flex-1 rounded-xl bg-slate-100 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
        >
          Skip explanation
        </button>
      </div>
    </div>
  );
}
