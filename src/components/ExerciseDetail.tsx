import type { ReactNode } from "react";
import {
  resolvedMeasurementRunnerKind,
  type ResolvedMeasurementProtocol,
} from "../lib/exercises/lookup";
import {
  EXERCISE_DETAIL_BACK_LABEL,
  exerciseDifficultyLabel,
  exerciseFocusLabel,
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
import type { RestrictedAssetResolver } from "../lib/exercises/restrictedAssets";
import type { ExerciseVersion } from "../lib/exercises/types";
import ExerciseDiagramView from "./ExerciseDiagramView";
import { surfaceClass } from "./Surface";

type ExerciseDetailProps = {
  version: ExerciseVersion;
  /** Already resolved against the catalog by the caller (see `resolveMeasurementProtocols`). */
  measurementProtocols: readonly ResolvedMeasurementProtocol[];
  onBack: () => void;
  onStart: () => void;
  onStartTeam?: () => void;
  startDisabled?: boolean;
  teamStartDisabled?: boolean;
  restrictedAssetResolver?: RestrictedAssetResolver;
};

function Badge({ children }: { children: string }) {
  return (
    <span className="rounded-full bg-slate-100 px-2 py-0.5 text-xs font-medium text-slate-600">
      {children}
    </span>
  );
}

/**
 * One coherent responsibility per surface, not one surface per paragraph — see
 * DESIGN_SYSTEM.md §10.2 and its "Card Hierarchy" refactor priority ("stop
 * treating every section as an equally elevated card").
 */
function SectionCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className={surfaceClass("primary")}>
      <h3 className="text-base font-semibold text-slate-900">{title}</h3>
      <div className="mt-3 space-y-3 text-sm text-slate-600">{children}</div>
    </section>
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
 * One progressive-disclosure row. The summary carries a ~44 px touch height
 * (DESIGN_SYSTEM.md §29.1) and keeps the native disclosure marker, so the
 * affordance is not carried by text alone.
 */
function DetailDisclosure({
  title,
  badge,
  defaultOpen = false,
  children,
}: {
  title: string;
  badge?: string;
  defaultOpen?: boolean;
  children: ReactNode;
}) {
  return (
    <details open={defaultOpen} className="border-t border-slate-200 first:border-t-0">
      <summary className="min-h-11 cursor-pointer py-3 text-base font-semibold text-slate-900">
        {title}
        {badge && <span className="ml-1.5 text-sm font-normal text-slate-500">{badge}</span>}
      </summary>
      <div className="pb-3 text-sm text-slate-600">{children}</div>
    </details>
  );
}

/**
 * The one generic Exercise detail renderer. It follows the specification's
 * fixed information order (spec 14.3) and branches only on declared domain
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
  restrictedAssetResolver,
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
    <div className="space-y-4">
      <button
        type="button"
        onClick={onBack}
        className="-mx-1 inline-flex min-h-11 items-center px-1 text-sm font-medium text-slate-500 underline transition hover:text-slate-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-slate-500"
      >
        ← {EXERCISE_DETAIL_BACK_LABEL}
      </button>

      {/* 1. Title, focus, category, difficulty, source and this Exercise's own
             immutable version. */}
      <div className={surfaceClass("hero")}>
        <h2 className="text-xl font-semibold text-slate-900">{version.title}</h2>

        <div className="mt-3 flex flex-wrap gap-1.5">
          <Badge>{exerciseFocusLabel(version.primaryFocus)}</Badge>
          {version.shotFamily && <Badge>{exerciseShotFamilyLabel(version.shotFamily)}</Badge>}
          <Badge>{exerciseDifficultyLabel(version.difficulty)}</Badge>
          <Badge>{exerciseTrainingPurposeLabel(version.primaryTrainingPurpose)}</Badge>
          {version.additionalTrainingPurposes.map((purpose) => (
            <Badge key={purpose}>{exerciseTrainingPurposeLabel(purpose)}</Badge>
          ))}
        </div>

        <div className="mt-3 space-y-0.5 text-xs text-slate-500">
          <p>{source.attribution}</p>
          {/* The Exercise's own version, deliberately worded so it cannot be
              read as the source collection's version — that one appears under
              "Source and attribution" as "Source version". */}
          <p>{exerciseVersionLabel(version.version)}</p>
        </div>
      </div>

      {/* 2. Goal and why it matters, with 3. the Diagram illustrating it. */}
      <SectionCard title="Goal">
        <Block first>
          <p>{version.goal}</p>
          <p>{version.whyItMatters}</p>
        </Block>

        {version.diagram && (
          <Block>
            <ExerciseDiagramView
              diagram={version.diagram}
              restrictedAssetResolver={restrictedAssetResolver}
            />
          </Block>
        )}
      </SectionCard>

      {/* 4. Setup, participants, roles, equipment and sweeping, then
             5. the ordered instructions — one "how to run this" surface. */}
      <SectionCard title="Setup and instructions">
        <Block first>
          <ul className="list-disc space-y-1 pl-4">
            {version.setupInstructions.map((step) => (
              <li key={step.id}>{step.text}</li>
            ))}
          </ul>
        </Block>

        <Block title="Participants">
          <p>{participation.summary}</p>
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
                {role.note && <span> — {role.note}</span>}
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

        <Block title="Instructions">
          <ol className="list-decimal space-y-2 pl-4">
            {version.executionInstructions.map((step) => (
              <li key={step.id}>{step.text}</li>
            ))}
          </ol>
        </Block>
      </SectionCard>

      {/* 6. Observation guidance or the generic 0-4 explanation, then
             7. volume and the descriptive source reference goal. */}
      <SectionCard title={guidance.kind === "observation" ? "What to look for" : "How it is evaluated"}>
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
      </SectionCard>

      {/* 8. Variations, 9. compatible Measurements, and provenance — supporting
             detail, gathered into one grouped container behind progressive
             disclosure rather than three more equally elevated cards. */}
      <section className={surfaceClass("secondary")}>
        {version.variations.length > 0 && (
          <DetailDisclosure title="Variations">
            <ul className="list-disc space-y-1 pl-4">
              {version.variations.map((variation) => (
                <li key={variation.id}>
                  {variation.label}
                  {variation.description && <span> — {variation.description}</span>}
                </li>
              ))}
            </ul>
          </DetailDisclosure>
        )}

        {measurementProtocols.length > 0 && (
          <DetailDisclosure
            title="Compatible Measurements"
            badge={String(measurementProtocols.length)}
            // A Measured Exercise exists to measure something, so its
            // protocols open by default. This branches on the declared
            // Primary Exercise Focus, never on which Exercise it is.
            defaultOpen={version.primaryFocus === "measured"}
          >
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
          </DetailDisclosure>
        )}

        {/* Only English fields are rendered: any retained original-language
            source title is non-displayed search/attribution metadata. */}
        <DetailDisclosure title="Source and attribution">
          <div className="space-y-1">
            <p>{source.attribution}</p>
            <p>
              <span className="font-medium text-slate-700">Exercise version: </span>
              {version.version}
            </p>
            {source.collectionName && (
              <p>
                <span className="font-medium text-slate-700">Collection: </span>
                {source.collectionName}
              </p>
            )}
            {source.collectionVersion && (
              <p>
                <span className="font-medium text-slate-700">Source version: </span>
                {source.collectionVersion}
              </p>
            )}
            {source.sourceExerciseReference && (
              <p>
                <span className="font-medium text-slate-700">Source exercise: </span>
                {source.sourceExerciseReference}
              </p>
            )}
            {source.provenanceNote && (
              <p className="text-xs text-slate-500">{source.provenanceNote}</p>
            )}
          </div>
        </DetailDisclosure>
      </section>

      {/* 10. Start action — wording follows focus semantics, never a named Exercise. */}
      <section className={surfaceClass("hero")}>
        <h3 className="text-base font-semibold text-slate-900">
          {version.primaryFocus === "measured" ? "Set up this exercise" : "Ready to practise?"}
        </h3>
        <p className="mt-2 text-sm text-slate-600">
          {version.primaryFocus === "technique" &&
            "Practise Solo with a private note, or set up a shared Team observation. The app records no technique score."}
          {version.primaryFocus === "shotmaking" &&
            "Practise Solo or with a Team, with no planned stone limit. Record the actual handle, any enabled optional Measurement and a 0–4 outcome for each stone."}
          {version.primaryFocus === "measured" && usesReleaseTimingRunner &&
            "Continue with the existing Fixed, Variable and Blind Weight setup. No second measurement runner is created."}
          {version.primaryFocus === "measured" && measuredRunnerKind === "exercise-execution" &&
            "Start an open-ended measured exercise. Record each observed value, then complete the exercise when you are finished."}
          {version.primaryFocus === "measured" && runnerUnsupported &&
            "This Measurement combination does not yet have a supported execution runner."}
        </p>
        <button
          type="button"
          onClick={onStart}
          disabled={startDisabled || runnerUnsupported}
          className="mt-4 min-h-11 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
        >
          {usesReleaseTimingRunner ? "Continue to Timing Setup" : "Start Exercise"}
        </button>
        {onStartTeam && !runnerUnsupported && !usesReleaseTimingRunner && version.participation.supportedModes.includes("team") && (
          <button
            type="button"
            onClick={onStartTeam}
            disabled={teamStartDisabled}
            className="mt-3 min-h-11 w-full rounded-xl bg-slate-100 px-4 py-3 text-sm font-semibold text-slate-800 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Set Up Team Exercise
          </button>
        )}
      </section>
    </div>
  );
}
