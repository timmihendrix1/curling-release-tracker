import type { ProtocolIntegritySummary } from "../lib/assessment/result";
import { surfaceClass } from "./Surface";

type AssessmentProtocolIntegrityProps = {
  summary: ProtocolIntegritySummary;
  eligibilityNote?: string;
};

const CAPTURE_MODE_LABELS: Record<string, string> = {
  automatic: "Automatic",
  manual: "Manual",
};

const PROVIDER_LABELS: Record<string, string> = {
  simulator: "Timing Simulator",
  manual: "Manual entry",
  external: "External timing provider",
};

/** Factual protocol-quality disclosure — see Phase C brief section 11. Never treats a deviation as automatic invalidation. */
export default function AssessmentProtocolIntegrity({
  summary,
  eligibilityNote,
}: AssessmentProtocolIntegrityProps) {
  const facts: string[] = [];

  facts.push(
    summary.completedInOneSession
      ? "Completed in one session."
      : "This run was interrupted or resumed across more than one session."
  );

  if (summary.resumedAfterReload) facts.push("This run was resumed after reload.");
  if (summary.longInterruption) facts.push("This run had a long interruption.");
  if (summary.wrongHandleDeviationCount > 0) {
    facts.push(
      `${summary.wrongHandleDeviationCount} wrong-handle deviation${summary.wrongHandleDeviationCount === 1 ? "" : "s"} recorded.`
    );
  }
  if (summary.nonStandardWarmupCount > 0) facts.push("A non-standard warm-up was recorded.");
  if (summary.manualOverrideCount > 0) facts.push("A manual override was recorded.");
  if (summary.otherDeviationCount > 0) {
    facts.push(`${summary.otherDeviationCount} other protocol deviation${summary.otherDeviationCount === 1 ? "" : "s"} recorded.`);
  }
  facts.push(`${summary.invalidAttemptCount} invalid attempt${summary.invalidAttemptCount === 1 ? "" : "s"}.`);
  facts.push(`Timing provider: ${PROVIDER_LABELS[summary.timingProviderId] ?? summary.timingProviderId} (${CAPTURE_MODE_LABELS[summary.captureMode] ?? summary.captureMode}).`);

  return (
    <div className={surfaceClass("secondary")}>
      <h2 className="text-lg font-semibold text-slate-900">Protocol Integrity</h2>
      <ul className="mt-3 space-y-1.5 text-sm text-slate-600">
        {facts.map((fact) => (
          <li key={fact}>{fact}</li>
        ))}
      </ul>
      {eligibilityNote && (
        <p className="mt-3 rounded-xl bg-slate-50 p-3 text-xs text-slate-600">{eligibilityNote}</p>
      )}
    </div>
  );
}
