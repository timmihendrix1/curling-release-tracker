import {
  exerciseDifficultyLabel,
  exerciseFocusLabel,
  exerciseParticipationModesLabel,
  exerciseShotFamilyLabel,
  exerciseSweeperCountSummary,
  exerciseSweepingPolicyLabel,
} from "../lib/exercises/presentation";
import type { ExerciseVersion } from "../lib/exercises/types";
import { surfaceClass } from "./Surface";

type ExerciseSummaryCardProps = {
  version: ExerciseVersion;
  onOpen: (versionId: string) => void;
};

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
      {children}
    </span>
  );
}

/**
 * One Library row, generated entirely from Exercise Version data. There is no
 * per-Exercise branch here and no Exercise id or title is ever compared — a
 * fourth curated Exercise renders through this component unchanged.
 */
export default function ExerciseSummaryCard({ version, onOpen }: ExerciseSummaryCardProps) {
  return (
    <div className={surfaceClass("secondary")}>
      <h3 className="font-semibold text-slate-900">{version.title}</h3>

      <p className="mt-1 text-sm text-slate-600">{version.goal}</p>

      <div className="mt-3 flex flex-wrap gap-1.5">
        <Badge>{exerciseFocusLabel(version.primaryFocus)}</Badge>
        {version.shotFamily && <Badge>{exerciseShotFamilyLabel(version.shotFamily)}</Badge>}
        <Badge>{exerciseDifficultyLabel(version.difficulty)}</Badge>
        <Badge>{exerciseParticipationModesLabel(version.participation.supportedModes)}</Badge>
        <Badge>{exerciseSweepingPolicyLabel(version.sweeping.policy)}</Badge>
        <Badge>{exerciseSweeperCountSummary(version.sweeping)}</Badge>
      </div>

      {/* The visible label stays a plain "View Details"; the accessible name
          names the Exercise too, so a screen-reader user hearing several
          identical buttons in the list can still tell them apart. */}
      <button
        type="button"
        onClick={() => onOpen(version.id)}
        aria-label={`View Details: ${version.title}`}
        className="mt-3 min-h-11 w-full rounded-xl bg-slate-100 px-4 py-3 text-sm font-medium text-slate-700 transition hover:bg-slate-200 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
      >
        View Details
      </button>
    </div>
  );
}
