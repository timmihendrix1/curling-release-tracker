import { exerciseDifficultyLabel, exerciseParticipationModesLabel } from "../lib/exercises/presentation";
import type { ExerciseVersion } from "../lib/exercises/types";

type ExerciseSummaryCardProps = {
  version: ExerciseVersion;
  onOpen: (versionId: string) => void;
};

/** A generic catalog row; exercise-specific instructions remain in the detail view. */
export default function ExerciseSummaryCard({ version, onOpen }: ExerciseSummaryCardProps) {
  return (
    <div className="house-exercise-row relative">
      <div className="min-w-0">
        <h3>{version.title}</h3>
        <p>{exerciseParticipationModesLabel(version.participation.supportedModes)}{version.difficulty && <> · {exerciseDifficultyLabel(version.difficulty)}</>}</p>
      </div>
      <span aria-hidden="true" className="shrink-0 text-xl text-[var(--house-accent)]">↗</span>
      <button type="button" onClick={() => onOpen(version.id)}
        aria-label={`View Details: ${version.title}`}
        className="absolute inset-0 w-full rounded-[inherit]" />
    </div>
  );
}
