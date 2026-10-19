import type { ReactNode } from "react";
import {
  resolvedMeasurementRunnerKind,
  type ResolvedMeasurementProtocol,
} from "../lib/exercises/lookup";
import {
  EXERCISE_DETAIL_BACK_LABEL,
  exerciseDifficultyLabel,
  exerciseDiscoveryCategoryLabel,
  exerciseParticipantRoleLabel,
  exerciseParticipationModesLabel,
  exerciseRecommendedVolumeLabel,
  exerciseRequirementLabel,
  exerciseShotFamilyLabel,
  exerciseSweeperCountSummary,
  exerciseSweepingPolicyLabel,
  exerciseTrainingAthleteCountLabel,
  exerciseTrainingPurposeLabel,
  exerciseVersionLabel,
  measurementSourceLabel,
  measurementUnitLabel,
} from "../lib/exercises/presentation";
import { exerciseDiscoveryCategory } from "../lib/exercises/discovery";
import type { ExerciseAssetResolver } from "../lib/exercises/exerciseAssets";
import type { ExerciseVersion } from "../lib/exercises/types";
import TrainingHeader from "./TrainingHeader";
import ExerciseDiagramView from "./ExerciseDiagramView";

type ExerciseDetailProps = {
  version: ExerciseVersion;
  /** Already resolved against the catalog by the caller (see `resolveMeasurementProtocols`). */
  measurementProtocols: readonly ResolvedMeasurementProtocol[];
  onBack: () => void;
  onStart: () => void;
  onStartTeam?: () => void;
  startDisabled?: boolean;
  teamStartDisabled?: boolean;
  exerciseAssetResolver?: ExerciseAssetResolver;
};

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
      {children}
    </span>
  );
}

/**
 * A titled block inside a card, separated from the previous one by a rule
 * rather than by its own card (DESIGN_SYSTEM.md §10.5 — "prefer one shared
 * container with dividers over multiple small cards"). `first` skips the rule
 * for the block that opens a card.
 */
function Block({
  title,
  first = false,
  children,
}: {
  title?: string;
  first?: boolean;
  children: ReactNode;
}) {
  return (
    <div className={first ? undefined : "border-t border-slate-100 pt-3"}>
      {title && (
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">{title}</p>
      )}
      <div className={title ? "mt-1.5 space-y-1.5" : "space-y-1.5"}>{children}</div>
    </div>
  );
}

/**
 * The one generic Exercise detail renderer. It follows the specification's
 * approved House information hierarchy and branches only on declared domain
 * semantics — the guidance union's `kind`, the diagram's `kind`, the Primary
 * Exercise Focus, and whether an optional field is present. It never compares
 * an Exercise id or title, so adding a curated Exercise needs no change here.
 *
 * The final action delegates execution to the application shell. This renderer
 * still knows no Exercise id or title and owns no Session state.
 */
export default function ExerciseDetail({
  version,
  measurementProtocols,
  onBack,
  onStart,
  onStartTeam,
  startDisabled = false,
  teamStartDisabled = false,
  exerciseAssetResolver,
}: ExerciseDetailProps) {
  const measuredRunnerKind = version.primaryFocus === "measured"
    ? resolvedMeasurementRunnerKind(measurementProtocols)
    : null;
  const usesReleaseTimingRunner = measuredRunnerKind === "release-timing";
  const runnerUnsupported = measuredRunnerKind === "unsupported";
  const { guidance, participation, sweeping, source } = version;

  const hasCompletionGuidance =
    version.recommendedVolume !== undefined || version.sourceReferenceGoal !== undefined;

  return (
    <div className="house-exercise-detail space-y-4">
      <button type="button" onClick={onBack} className="house-flow-link w-full">
        ← {EXERCISE_DETAIL_BACK_LABEL}
      </button>
      <TrainingHeader title={version.title} eyebrow={exerciseDiscoveryCategoryLabel(exerciseDiscoveryCategory(version))} />
      <p>{version.goal}</p>
      {version.diagram && (
        <ExerciseDiagramView diagram={version.diagram} exerciseAssetResolver={exerciseAssetResolver} contained />
      )}
      <section className="space-y-4" aria-labelledby="exercise-setup-title">
        <h3 id="exercise-setup-title" className="house-flow-section-title">Setup and play</h3>
        <ul className="space-y-2">
          {version.setupInstructions.map((step) => <li key={step.id}>{step.text}</li>)}
        </ul>
        {(participation.minTrainingAthletes > 1 || sweeping.policy === "required") && (
          <p className="text-xs text-slate-500">
            {exerciseTrainingAthleteCountLabel(participation.minTrainingAthletes, participation.maxTrainingAthletes)}
            {" · "}{exerciseSweepingPolicyLabel(sweeping.policy)} · {exerciseSweeperCountSummary(sweeping)}
          </p>
        )}
        <ol className="list-decimal space-y-3 pl-4">
          {version.executionInstructions.map((step) => <li key={step.id}>{step.text}</li>)}
        </ol>
      </section>
      <div className="space-y-2">
        <button
          type="button"
          onClick={onStart}
          disabled={startDisabled || runnerUnsupported}
          className="house-flow-primary"
        >
          {usesReleaseTimingRunner ? "Continue to Timing Setup" : "Start Exercise"}
        </button>
        {onStartTeam && !runnerUnsupported && !usesReleaseTimingRunner && version.participation.supportedModes.includes("team") && (
          <button
            type="button"
            onClick={onStartTeam}
            disabled={teamStartDisabled}
            className="house-flow-link w-full"
          >
            Set Up Team Exercise
          </button>
        )}

        {runnerUnsupported && <p role="status" className="text-sm text-slate-500">This combination of measurements is not available yet.</p>}
      </div>
      <details className="house-training-disclosure">
        <summary>People and equipment</summary>
        <div className="space-y-3 text-sm text-slate-600">
        <Block title="Participants">
          {!["Usable Solo or in a Team. An observer is optional.", "Solo or in a Team. One athlete delivers at a time.", "Usable Solo or in a Team. A second person can take the time.", "Solo or in a Team. A second person can take the time.", "Usable Solo or in a Team. Another participant may count the rotations."].includes(participation.summary) && <p>{participation.summary}</p>}
          <p className="text-xs text-slate-500">
            {exerciseParticipationModesLabel(participation.supportedModes)} ·{" "}
            {exerciseTrainingAthleteCountLabel(
              participation.minTrainingAthletes,
              participation.maxTrainingAthletes
            )}
          </p>
          <ul className="space-y-1">
            {participation.roles.map((role) => (
              <li key={role.role}>
                <span className="font-medium text-slate-700">
                  {exerciseParticipantRoleLabel(role.role)}
                </span>{" "}
                <span className="text-xs text-slate-500">
                  ({exerciseRequirementLabel(role.requirement)})
                </span>
                {role.note && !["Another person can take the time and say what they measured.", "A second person can take the time consistently."].includes(role.note) && <span> — {role.note}</span>}
              </li>
            ))}
          </ul>
        </Block>

        <Block title="Equipment">
          <ul className="space-y-1">
            {version.equipment.map((item) => (
              <li key={item.id}>
                <span className="font-medium text-slate-700">{item.label}</span>{" "}
                <span className="text-xs text-slate-500">
                  ({exerciseRequirementLabel(item.requirement)})
                </span>
                {item.note && <span> — {item.note}</span>}
              </li>
            ))}
          </ul>
        </Block>

        <Block title="Sweeping">
          <p>
            {exerciseSweepingPolicyLabel(sweeping.policy)} ·{" "}
            {exerciseSweeperCountSummary(sweeping)}
          </p>
          <p>{sweeping.note}</p>
        </Block>


        </div>
      </details>
      <details className="house-training-disclosure">
        <summary>Guidance and scoring</summary>
        <div className="space-y-3 text-sm text-slate-600">
          <p>{version.whyItMatters}</p>
        {guidance.kind === "observation" ? (
          <Block first>
            <ul className="list-disc space-y-1 pl-4">
              {guidance.observations.map((observation) => (
                <li key={observation}>{observation}</li>
              ))}
            </ul>
            {/* Kept visually distinct from the observations above: this states
                what the application does, not what the athlete should observe. */}
            <p className="text-xs text-slate-500">{guidance.noScoringNote}</p>
          </Block>
        ) : (
          <Block first>
            <ul className="list-disc space-y-1 pl-4">
              {guidance.explanation.map((line) => (
                <li key={line}>{line}</li>
              ))}
            </ul>

            <div className="rounded-lg bg-slate-50 px-3 py-2">
              <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                The 0–4 scale
              </p>
              <ul className="mt-1 grid grid-cols-1 gap-0.5 sm:grid-cols-2">
                {guidance.scale.map((entry) => (
                  <li key={entry.score} className="text-sm">
                    <span className="font-medium text-slate-700">{entry.score}</span> ={" "}
                    {entry.percentage}%
                  </li>
                ))}
              </ul>
            </div>

            <p className="text-xs text-slate-500">{guidance.evaluationBasisNote}</p>
          </Block>
        )}

        {hasCompletionGuidance && (
          <Block title="Volume and reference goal">
            {version.recommendedVolume && (
              <p>
                <span className="font-medium text-slate-700">Recommended volume: </span>
                {exerciseRecommendedVolumeLabel(version.recommendedVolume)}
              </p>
            )}
            {version.sourceReferenceGoal && (
              <p className="rounded-lg bg-slate-50 px-3 py-2">
                {version.sourceReferenceGoal.text}
              </p>
            )}
          </Block>
        )}

        </div>
      </details>
      {(version.variations.length > 0 || measurementProtocols.length > 0) && (
        <details className="house-training-disclosure">
          <summary>Variations and measurements</summary>
          <div className="space-y-4 text-sm text-slate-600">
          {version.variations.length > 0 && (
            <Block title="Variations" first>
              <ul className="list-disc space-y-1 pl-4">
                {version.variations.map((variation) => (
                  <li key={variation.id}>
                    {variation.label}
                    {variation.description && <span> — {variation.description}</span>}
                  </li>
                ))}
              </ul>
            </Block>
          )}

          {measurementProtocols.length > 0 && (
            <Block title="Compatible Measurements" first={version.variations.length === 0}>
              <ul className="space-y-3">
                {measurementProtocols.map(({ protocol, requirement }) => (
                  <li key={`${protocol.id}-${protocol.version}`}>
                    <p>
                      <span className="font-medium text-slate-700">{protocol.name}</span>{" "}
                      <span className="text-xs text-slate-500">
                        ({exerciseRequirementLabel(requirement)})
                      </span>
                    </p>
                    <p className="mt-0.5">{protocol.referencePoints}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      Measured in {measurementUnitLabel(protocol.unit)} ·{" "}
                      {protocol.allowedSources.map(measurementSourceLabel).join(", ")}
                    </p>
                    <p className="mt-0.5">{protocol.guidance}</p>
                  </li>
                ))}
              </ul>
            </Block>
          )}
        </div>
        </details>
      )}


      <details className="house-training-disclosure">
        <summary>Exercise details</summary>
        <div>
        <div className="mt-3 flex flex-wrap gap-1.5">
          {version.shotFamily && <Badge>{exerciseShotFamilyLabel(version.shotFamily)}</Badge>}
          {version.difficulty && <Badge>{exerciseDifficultyLabel(version.difficulty)}</Badge>}
          <Badge>{exerciseTrainingPurposeLabel(version.primaryTrainingPurpose)}</Badge>
          {version.additionalTrainingPurposes.map((purpose) => (
            <Badge key={purpose}>{exerciseTrainingPurposeLabel(purpose)}</Badge>
          ))}
        </div>

        <p className="mt-3 text-xs text-slate-500">
          {exerciseVersionLabel(version.version)}
        </p>        </div>
      </details>

      <p className="px-1 text-xs text-slate-500">
        Source: {source.attribution}
        {source.sourceExerciseReference ? ` · ${source.sourceExerciseReference}` : ""}
      </p>
    </div>
  );
}
