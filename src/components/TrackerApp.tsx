"use client";

import TrainingHeader from "./TrainingHeader";

import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
} from "react";
import IdentityAccountControl from "./identity/IdentityAccountControl";
import IdentityPendingTeamIntent from "./identity/IdentityPendingTeamIntent";
import AccuracyToleranceProfilesScreen from "./AccuracyToleranceProfilesScreen";
import AssessScreen from "./AssessScreen";
import AssessmentAnalyze from "./AssessmentAnalyze";
import AssessmentResultScreen from "./AssessmentResultScreen";
import AutoCapture, { type AutoCaptureStartConfig } from "./AutoCapture";
import BlindShotEntry from "./BlindShotEntry";
import BrowerBleDiagnosticScreen from "./BrowerBleDiagnosticScreen";
import ConfirmModal from "./ConfirmModal";
import DashboardCard from "./DashboardCard";
import HomeScreen from "./HomeScreen";
import NewTrainingBlock from "./NewTrainingBlock";
import PrimaryNavigation from "./PrimaryNavigation";
import ReleaseTrendChart from "./ReleaseTrendChart";
import SessionSettings from "./SessionSettings";
import SettingsScreen from "./SettingsScreen";
import ShotSaveStatus from "./ShotSaveStatus";
import ShotEntry, {
  EMPTY_SHOT_ENTRY_DRAFT,
  type AddShotInput,
  type ShotEntryDraft,
  type ShotEntryTarget,
} from "./ShotEntry";
import type { SmartRandomProfileFormValue } from "./SmartRandomProfileForm";
import SmartRandomProfilesScreen from "./SmartRandomProfilesScreen";
import { surfaceClass } from "./Surface";
import TargetTimeSettings from "./TargetTimeSettings";
import TeamsScreen from "./TeamsScreen";
import TimingSimulatorPanel, {
  type SimulatorDiagnosticEntry,
} from "./TimingSimulatorPanel";
import AnalysisContextSummary from "./AnalysisContextSummary";
import HandleAnalysisSection from "./HandleAnalysisSection";
import HistoryFilterBar from "./HistoryFilterBar";
import ProgressMetricChart from "./ProgressMetricChart";
import ShotQualityTrendChart from "./ShotQualityTrendChart";
import TargetAccuracyDashboardCards from "./TargetAccuracyDashboardCards";
import TargetActualScatterChart from "./TargetActualScatterChart";
import TargetErrorChart from "./TargetErrorChart";
import ExerciseSoloExecutionScreen from "./ExerciseSoloExecutionScreen";
import CompleteSessionAction from "./CompleteSessionAction";
import ExerciseSoloSetupScreen from "./ExerciseSoloSetupScreen";
import ExerciseTeamExecutionScreen from "./ExerciseTeamExecutionScreen";
import ExerciseTeamSetupScreen from "./ExerciseTeamSetupScreen";
import ExerciseTeamResultsScreen from "./ExerciseTeamResultsScreen";
import TrainLanding, { type TrainEntryPath } from "./TrainLanding";
import TrainingPlanProgress from "./TrainingPlanProgress";
import TrainingPlanStepTransition from "./TrainingPlanStepTransition";
import TrainingSetup, { type TrainingSetupValue } from "./TrainingSetup";
import MeasuredShotSummary from "./MeasuredShotSummary";
import MissingMeasurementPanel, {
  completionKey,
  type CompletionOutcome,
  type CompletionRequest,
  type CompletionSelection,
  type IncompleteShotEntry,
  type PendingCompletion,
} from "./MissingMeasurementPanel";
import {
  useSportingProfileId,
  useSportingRepositories,
  useSportingCloudSync,
} from "./ProfileScopedSportingPersistence";

import type {
  Handle,
  MeasuredQuantity,
  QuantityTolerance,
  Session,
  Shot,
  ShotType,
  TimingResult,
  TrainingBlock,
  TrainingPlan,
  TrainingPlanStep,
} from "../types";
import type { AssessmentRun } from "../lib/assessment/types";
import { createSoloExerciseExecution } from "../lib/exercises/execution";
import type { ExerciseExecution } from "../lib/exercises/executionTypes";
import type { ExerciseVersion } from "../lib/exercises/types";
import {
  createPublicExerciseAssetResolver,
  preloadPublicExerciseDiagrams,
  type ExerciseAssetResolver,
} from "../lib/exercises/exerciseAssets";
import { EXERCISE_CATALOG } from "../lib/exercises/catalog";
import {
  exerciseRunnerKind,
  resolveMeasurementProtocols,
} from "../lib/exercises/lookup";

import { resolveAccuracyThresholds } from "../lib/accuracyThresholds";
import {
  analyzeShots,
  average,
  computeHandleAccuracyComparison,
  computeHandleTargetErrorBoxPlots,
  computeQuantityAccuracyAnalytics,
  standardDeviationOfValues,
} from "../lib/analytics";
import { targetVsActualExplanation } from "../lib/analyticsExplanations";
import { applyTimingResultToAssessmentRun } from "../lib/assessment/capture";
import {
  createEmptyAssessmentPersistedState,
  deleteAssessmentRunFromHistory,
  getAssessmentRunFromHistory,
  type AssessmentPersistedState,
} from "../lib/assessment/persistence";
import { getCurrentPlannedShot } from "../lib/assessment/progress";
import { pauseAssessmentRun } from "../lib/assessment/run";
import {
  ASSESSMENT_LEAVE_NOTICE,
  ASSESSMENT_QUARANTINE_NOTICE,
} from "../lib/assessmentContent";
import {
  applyTimingResultToSession,
  createCaptureSequence,
  cancelCaptureSequence,
  isCaptureSequenceActive,
  pauseCaptureSequence,
  pauseCaptureSequenceWithError,
  resumeCaptureSequence,
  startCaptureSequence,
  undoLastCapturedShot,
  type ProcessTimingResultOutcome,
} from "../lib/captureSequence";
import {
  historyCsvExport,
} from "../lib/export";
import { DEFAULT_ACTIVE_VIEW, type ActiveView } from "../lib/navigation";
import { useFileExport } from "./useFileExport";
import {
  attachSoloExerciseExecution,
  prepareSessionForArchive,
  replaceExerciseExecution,
  sessionHasArchivableActivity,
} from "../lib/exercises/sessionIntegration";
import type {
  DomainHydrationState,
  PersistenceReadError,
  PersistenceWriteError,
} from "../lib/persistence/types";
import { createNewSession } from "../lib/sessionMigration";
import {
  createSimulatorTimingProvider,
} from "../lib/simulatorTimingProvider";
import {
  prepareTargetErrorByShotData,
  prepareTargetVsActualScatterData,
} from "../lib/chartData";
import { buildTrainingInsight } from "../lib/trainingInsight";
import {
  aggregateQuantityAccuracyAcrossBlocks,
  aggregateTargetAccuracyAcrossBlocks,
  buildHistoryAnalysisContext,
  createDefaultHistoryFilters,
  getAvailableMeasurementModes,
  getAvailableMeasuredQuantities,
  resolveDefaultMeasuredQuantity,
  getAvailableTrainingCategories,
  hasUniformTimeTolerance,
  representativeTimeTolerance,
  resolveDefaultMeasurementMode,
  resolveDefaultTrainingCategory,
  type HistoryAnalysisFilters,
} from "../lib/historyAnalysis";
import {
  DEFAULT_SHOT_FILTER,
  filterShots,
} from "../lib/shotFilters";
import { createManualTimingResult } from "../lib/timingProvider";
import { useOptionalIdentity } from "./identity/IdentityProvider";
import BrowerAssistedCapturePanel, {
  type BrowerAcceptOutcome,
  type BrowerSaveAcknowledgement,
} from "./BrowerAssistedCapturePanel";
import { createBrowerAssistedCaptureController } from "../lib/brower/assistedCaptureController";
import {
  createCapacitorBrowerLifecycle,
  createCapacitorBrowerTransport,
} from "../lib/brower/capacitorTimingTransport";
import { resolveBrowerTransportAvailability } from "../lib/brower/timingTransport";
import { browerIntervalSeconds } from "../lib/brower/chronDecoder";
import {
  verifyBrowerCaptureOwnership,
  browerIntervalFitsShotRange,
  type BrowerCandidate,
  type BrowerCaptureContext,
  type BrowerCaptureOwnershipSnapshot,
} from "../lib/brower/assistedCapture";
import { detectRuntimePlatform } from "../lib/platform/runtimePlatform";
import type { PersistenceWriteResult } from "../lib/persistence/types";
import {
  formatReleaseTime,
  formatSigned,
  parseReleaseTime,
} from "../lib/timeInput";
import {
  formatMeasuredSeconds,
  formatMeasuredSpeed,
} from "../lib/measurement/format";
import {
  MEASURED_QUANTITIES,
  blockQuantityTarget,
  blockTolerance,
  resolveBlockMeasurement,
  speedMeasuredShots,
  timeMeasuredShots,
  shotMeasuredValue,
  shotMeasures,
  type ResolvedBlockMeasurement,
} from "../lib/measurement/quantities";
import {
  buildMeasuredShot,
  completeShotMeasurement,
  findIncompleteShots,
} from "../lib/measurement/operations";
import {
  toleranceFromAccuracyThresholds,
} from "../lib/measurement/tolerance";
import { editableNumber } from "../lib/measurement/toleranceDraft";
import {
  addTrainingBlock,
  advanceBlockTarget,
  blindTargetModeLabel,
  blockModeLabel,
  computeShotTarget,
  createTrainingBlock,
  getActiveBlock,
  getBlockShots,
  getNextShotNumberInBlock,
  getNextShotTarget,
  measurementModeLabel,
  variableTargetModeLabel,
  type NewBlockInput,
} from "../lib/trainingBlocks";
import {
  createEmptyAccuracyToleranceProfilesState,
  type AccuracyToleranceProfilesState,
} from "../lib/accuracyToleranceProfiles/persistence";
import {
  addAccuracyToleranceProfile,
  buildAccuracyToleranceProfile,
  deleteAccuracyToleranceProfile,
  duplicateAccuracyToleranceProfile,
  replaceAccuracyToleranceProfile,
  setDefaultAccuracyToleranceProfile,
  type AccuracyToleranceProfileInput,
} from "../lib/accuracyToleranceProfiles/profiles";
import {
  createEmptySmartRandomProfilesState,
  type SmartRandomProfilesState,
} from "../lib/smartRandomProfiles/persistence";
import {
  addSmartRandomProfile,
  buildSmartRandomProfile,
  deleteSmartRandomProfile,
  duplicateSmartRandomProfile,
  replaceSmartRandomProfile,
  setDefaultSmartRandomProfile,
} from "../lib/smartRandomProfiles/profiles";
import { advanceToNextPlanStep, startPlanExecution } from "../lib/trainingPlans/execution";
import { resolveExpectedHandle } from "../lib/trainingPlans/handleStrategy";
import { mapPlanStepToTrainingBlockInput } from "../lib/trainingPlans/mapping";
import {
  addPlan,
  deletePlan,
  duplicatePlan,
  TRAINING_PLANS_SCHEMA_VERSION,
  updatePlan,
  type TrainingPlansPersistedState,
} from "../lib/trainingPlans/persistence";
import {
  getActiveStepSnapshot,
  getPlanProgressSummary,
  hasNextPlanStep,
  isPlanComplete,
  isPlanExecutionActive,
} from "../lib/trainingPlans/progress";
import { endActivePlanStepRuntime } from "../lib/trainingPlans/stepTransition";
import {
  isReleaseTimingPlanStep,
  trainingPlanStepTitle,
} from "../lib/trainingPlans/steps";

const IS_DEV = process.env.NODE_ENV !== "production";

/**
 * How long an accepted measurement waits for a write acknowledgement before the athlete
 * is told, truthfully, that saving has not confirmed yet. Long enough to cover an
 * ordinary write; short enough that "Saving…" never sits there indefinitely.
 */
const SHOT_DURABILITY_ACKNOWLEDGEMENT_TIMEOUT_MS = 5000;

/**
 * The result of creating exactly one Plan Step's runtime entity. An ordinary,
 * expected rejection (an unexecutable configuration, an Exercise that cannot be
 * attached) is a value, never an exception and never a modal raised from inside the
 * capture queue — the caller decides how to surface it.
 */
type MaterializedPlanStep =
  | {
      ok: true;
      session: Session;
      runtime:
        | { kind: "release-timing-block"; blockId: string }
        | { kind: "exercise-execution"; exerciseExecutionId: string };
      viewingExerciseExecutionId?: string;
    }
  | { ok: false; message: string };

// Compact contextual header copy for every functional screen (DESIGN_SYSTEM.md
// §9.2) — Home keeps the full AppHeader product identity instead, see the
// activeView switch below.


// All ten storage keys are now owned by their respective repositories
// (src/lib/sessionRepository.ts, historyFiltersRepository.ts,
// assessment/repository.ts, trainingPlans/repository.ts,
// accuracyToleranceProfiles/repository.ts, smartRandomProfiles/repository.ts,
// assessmentPreferencesRepository.ts) — see docs/PERSISTENCE_BOUNDARY_DESIGN.md §5 and
// ADR-0013. No key constant lives in this component anymore.

type ConfirmAction = {
  title: string;
  message: string;
  confirmLabel?: string;
  isDanger?: boolean;
  onConfirm: () => void;
};

type EditingShot = {
  id: string;
  releaseTime: string;
  handle: Handle;
  shotType?: ShotType;
};

// Low-effort History note: how many of this block's shots came from Auto Capture, and
// which provider. Returns null (renders nothing) for a block with no captured shots at
// all, which covers every block recorded before this feature existed and every
// classic-manual-only block since.
function describeCaptureBreakdown(shots: Shot[]): string | null {
  const captured = shots.filter((shot) => shot.measurementSource !== undefined);
  if (captured.length === 0) return null;

  const bySource = new Map<string, number>();
  for (const shot of captured) {
    const source = shot.measurementSource as string;
    bySource.set(source, (bySource.get(source) ?? 0) + 1);
  }

  return Array.from(bySource.entries())
    .map(([source, count]) => `${count} ${source}`)
    .join(", ");
}

/** A persisted provenance snapshot must never retain a live catalog reference. */
function snapshotExerciseVersion(version: ExerciseVersion): ExerciseVersion {
  return JSON.parse(JSON.stringify(version)) as ExerciseVersion;
}

/**
 * What the athlete has typed for ONE exercise but has not yet durably recorded.
 *
 * Drafts live in TrackerApp, not inside the entry controls, for two reasons the
 * controls themselves cannot satisfy:
 *
 *   1. They must outlive the Train view. Navigating to Analyze unmounts it, and a
 *      draft owned by ShotEntry would be gone on return with no discard decision.
 *   2. They must be BOUND to what they were typed for. A value typed against one
 *      exercise must never reappear in the next one, where it would be recorded
 *      against a different target.
 *
 * `ownerKey` is that binding. It is compared, never trusted: a draft whose owner no
 * longer matches the current profile/session/block is simply not shown, rather than
 * being carried across or silently cleared on every render.
 *
 * `revision` identifies one SUBMISSION. It is bumped on every edit, so "the draft as
 * it was when it was submitted" is a stable, parent-owned value that survives
 * remounting the entry control — which is what lets an acknowledgement settle only
 * the revision it actually acknowledges.
 *
 * `retainedRevision` identifies where the MEASUREMENTS came from, and is deliberately
 * not derived from `revision`. Choosing a different handle is an edit, so it mints a
 * new revision, while saying nothing about the numbers already in the fields. Reading
 * "these values belong to a stone already submitted" out of the revision alone
 * therefore stopped being true the moment any metadata was touched, and the next
 * measurement the athlete entered was recorded together with the previous stone's
 * untouched sibling value.
 *
 * The draft carries the WHOLE recording intent, not only the measurements. Handle,
 * shot type and an editable target are as much a part of the stone as the numbers;
 * keeping them out would record a retained value against the wrong handle after any
 * remount.
 */
type ManualEntryDraft = {
  ownerKey: string;
  revision: number;
  time: string;
  speed: string;
  handle: Handle;
  shotType: ShotType;
  targetOverride: string;
  /**
   * The revision under which the measurement text now in the fields was submitted, or
   * `null` when those fields hold input for the stone being composed.
   *
   * Non-null means the numbers on screen are RECOVERY values: they belong to a stone
   * already accepted, kept visible so a failed write stays recoverable and nothing is
   * called saved early. They are never input for the next stone — entering a genuine
   * measurement clears whichever side the athlete did not type.
   */
  retainedRevision: number | null;
};

/**
 * Applies one durably-written operation to the manual draft.
 *
 * Addressed by that operation's own owner and revision, so an older or unrelated
 * write can neither erase newer input nor speak for a draft it never described:
 *
 *   - the draft is still exactly what the operation submitted → it is retired whole;
 *   - only its METADATA has changed since — a handle, shot type or editable target
 *     chosen for the next stone → the recovery values are dropped, now that they are
 *     durable, and that explicit choice is kept;
 *   - anything else → untouched.
 */
function settleManualDraftAfterDurableWrite(
  draft: ManualEntryDraft | null,
  settled: ReadonlyArray<{ ownerKey: string; revision: number | null }>
): ManualEntryDraft | null {
  if (!draft) return draft;

  const owned = settled.filter(
    (operation) => operation.ownerKey === draft.ownerKey
  );

  if (owned.some((operation) => operation.revision === draft.revision)) return null;

  if (
    draft.retainedRevision !== null &&
    owned.some((operation) => operation.revision === draft.retainedRevision)
  ) {
    return { ...draft, time: "", speed: "", retainedRevision: null };
  }

  return draft;
}

export default function TrackerApp() {
  const exerciseAssetResolver = useMemo<ExerciseAssetResolver>(
    () => createPublicExerciseAssetResolver(),
    []
  );
  useEffect(() => {
    void preloadPublicExerciseDiagrams(exerciseAssetResolver);
  }, [exerciseAssetResolver]);
  const athleteProfileId = useSportingProfileId();

  // Stage M3a: file delivery goes through the shared platform boundary. Keyed
  // to the mounted Profile, so a late export completion after an account switch
  // is discarded instead of writing into the next Profile's screen.
  const { status: exportStatus, runExport } = useFileExport({ ownerKey: athleteProfileId });
  const sportingCloudSync = useSportingCloudSync();
  const {
    session: sessionRepository,
    historyFilters: historyFiltersRepository,
    assessment: assessmentRepository,
    trainingPlans: trainingPlansRepository,
    accuracyToleranceProfiles: accuracyToleranceProfilesRepository,
    smartRandomProfiles: smartRandomProfilesRepository,
  } = useSportingRepositories();
  const [activeView, setActiveView] =
    useState<ActiveView>(DEFAULT_ACTIVE_VIEW);

  // Keep the selected Train pillar across short transitions in and out of an
  // Exercise runner. Release Timing launched from the Library reuses the
  // established timing setup and carries only this pending catalog snapshot
  // until the existing block is actually created.
  const [preferredTrainEntryPath, setPreferredTrainEntryPath] =
    useState<TrainEntryPath>("exercises");
  const [pendingReleaseTimingExerciseVersion, setPendingReleaseTimingExerciseVersion] =
    useState<ExerciseVersion | null>(null);
  const [viewingExerciseExecutionId, setViewingExerciseExecutionId] =
    useState<string | null>(null);
  const [pendingSoloExerciseVersion, setPendingSoloExerciseVersion] =
    useState<ExerciseVersion | null>(null);
  const [pendingTeamExerciseVersion, setPendingTeamExerciseVersion] =
    useState<ExerciseVersion | null>(null);
  const [lastCompletedTeamSessionId, setLastCompletedTeamSessionId] =
    useState<string | null>(null);

  const [currentSession, setCurrentSession] =
    useState<Session | null>(null);

  const [sessionHistory, setSessionHistory] = useState<
    Session[]
  >([]);

  // The Training Plan library — its own persisted domain, independent of
  // currentSession/sessionHistory (see docs/TRAINING_SYSTEM_AND_PLANS.md
  // section 37 and ADR-0012). An active/completed execution lives entirely on
  // Session.planExecution, never here.
  const [trainingPlans, setTrainingPlans] = useState<TrainingPlan[]>([]);

  // Accuracy Tolerance Profiles — a small, independent persisted domain (its own
  // localStorage key, its own migration). A profile only ever helps *select*
  // On Target/Acceptable values; TrainingBlock/ReleaseTimingBlockConfiguration
  // always store the actual resolved numbers, never a live profile reference.
  const [accuracyToleranceProfilesState, setAccuracyToleranceProfilesState] =
    useState<AccuracyToleranceProfilesState>(
      createEmptyAccuracyToleranceProfilesState()
    );
  const [
    showAccuracyToleranceProfilesManager,
    setShowAccuracyToleranceProfilesManager,
  ] = useState(false);

  // Smart Random Profiles — a small, independent persisted domain (its own
  // localStorage key, its own migration). A profile only ever helps *select*
  // a Smart Random range; TrainingBlock/ReleaseTimingBlockConfiguration always
  // store the actual smartRandomMin/smartRandomMax numbers, never a live
  // profile reference.
  const [smartRandomProfilesState, setSmartRandomProfilesState] =
    useState<SmartRandomProfilesState>(createEmptySmartRandomProfilesState());
  const [
    showSmartRandomProfilesManager,
    setShowSmartRandomProfilesManager,
  ] = useState(false);

  // Team Foundation (docs/adr/0022) — entirely cloud-backed, so unlike the two
  // profile managers above this owns no local persisted state here; TeamsScreen
  // fetches everything itself once mounted.
  const [showTeamsScreen, setShowTeamsScreen] = useState(false);

  // Development-only Brower TCi BLE hardware diagnostic. Like the Timing Simulator it
  // is gated on IS_DEV at every mount point, and the screen itself refuses to construct
  // its controller outside development — see BrowerBleDiagnosticScreen.tsx.
  const [showBleDiagnostic, setShowBleDiagnostic] = useState(false);

  // The canonical application-owned Profile.id, and the scope every accepted external
  // measurement is attributed to. Optional because presentational component tests mount
  // this tree without the provider; production composition always supplies it.
  const identityProfileId = useOptionalIdentity()?.session?.profileId ?? null;

  const [historyFilters, setHistoryFilters] = useState<HistoryAnalysisFilters>(
    createDefaultHistoryFilters()
  );

  const [blockFilter, setBlockFilter] = useState(
    DEFAULT_SHOT_FILTER
  );

  // Which entry mode the athlete is currently looking at when idle — once a
  // capture sequence is actually running/paused, its own live status takes
  // over regardless of this choice (compositional redesign: Manual Entry and
  // Auto Capture are two alternative ways to do the same task, not two
  // permanently-stacked panels — see docs/MOBILE_UX_AND_DESIGN_PRINCIPLES.md
  // §17's "Auto Capture configuration should not permanently occupy the main
  // execution area").
  const [entryMode, setEntryMode] = useState<"manual" | "auto">("manual");

  const [showNewBlockModal, setShowNewBlockModal] =
    useState(false);

  const [confirmAction, setConfirmAction] =
    useState<ConfirmAction | null>(null);

  const [expandedSessions, setExpandedSessions] =
    useState<Record<string, boolean>>({});

  const [editingShot, setEditingShot] =
    useState<EditingShot | null>(null);

  const [hasUnsavedBlindDraft, setHasUnsavedBlindDraft] =
    useState(false);

  // --- Assessment state (Phase B) — see docs/adr/0011. Its own storage key
  // and its own load/save effect, entirely separate from Session/Session
  // History (ADR-0010). `null` until the mount effect below has loaded it,
  // matching the same "render nothing until loaded" pattern currentSession
  // uses (see docs/TECHNICAL_DEBT_AND_ROADMAP.md's set-state-in-effect note).
  const [assessmentState, setAssessmentState] =
    useState<AssessmentPersistedState | null>(null);

  // --- Persistence hydration state (Phase 1 repository boundary) ---
  // One DomainHydrationState + retained read error per effect-persisted domain (every
  // repository except AssessmentPreferencesRepository, which has no mount/save effect
  // to gate). "loading"/"write_protected" block that domain's save effect; only "ready"
  // (reached via either a real "value" or genuine "absent") permits it to run — see
  // docs/PERSISTENCE_BOUNDARY_DESIGN.md §7. The read-error half of each pair is retained
  // in state (for future reporting/recovery UI, explicitly out of scope for Phase 1 —
  // see ADR-0013) but not read anywhere yet, so it's kept as an unnamed tuple slot rather
  // than an unused binding.
  const [sessionHydration, setSessionHydration] = useState<DomainHydrationState>("loading");
  const [, setSessionReadError] = useState<PersistenceReadError | null>(null);
  const [historyFiltersHydration, setHistoryFiltersHydration] =
    useState<DomainHydrationState>("loading");
  const [, setHistoryFiltersReadError] = useState<PersistenceReadError | null>(null);
  const [assessmentHydration, setAssessmentHydration] =
    useState<DomainHydrationState>("loading");
  const [, setAssessmentReadError] = useState<PersistenceReadError | null>(null);
  const [trainingPlansHydration, setTrainingPlansHydration] =
    useState<DomainHydrationState>("loading");
  const [, setTrainingPlansReadError] = useState<PersistenceReadError | null>(null);
  const [accuracyProfilesHydration, setAccuracyProfilesHydration] =
    useState<DomainHydrationState>("loading");
  const [, setAccuracyProfilesReadError] = useState<PersistenceReadError | null>(null);
  const [smartRandomProfilesHydration, setSmartRandomProfilesHydration] =
    useState<DomainHydrationState>("loading");
  const [, setSmartRandomProfilesReadError] = useState<PersistenceReadError | null>(null);
  // Records exactly which `sessionHistory`/`currentSession` object references were
  // already durably persisted by `sessionRepository.archiveAndReplace` (see
  // docs/adr/0014-session-archive-write-ordering.md), so the two ordinary,
  // independent save effects below (declared for per-shot/per-edit persistence) don't
  // redundantly re-persist — and, in doing so, risk re-persisting in their own
  // declaration order — the exact same archive transition the coordinated call just
  // wrote in the deliberately-chosen history-then-current order. A genuine subsequent
  // edit always produces a new object, so the reference comparison stops matching (and
  // ordinary persistence resumes) the moment there's anything new to persist.
  const sessionWriteQueueRef = useRef<Promise<void>>(Promise.resolve());
  function runSessionWrite<T>(write: () => Promise<T>): Promise<T> {
    const result = sessionWriteQueueRef.current.then(write);
    sessionWriteQueueRef.current = result.then(() => undefined, () => undefined);
    return result;
  }

  /**
   * True while a terminal Session transition (archive-and-replace) is in flight.
   *
   * The archive snapshot — which stones are saved to history — is chosen BEFORE the
   * write is awaited. Without this lock the UI stays interactive across that await, so
   * a stone recorded in between would be accepted, counted on screen, and then
   * silently dropped: it is not in the already-chosen snapshot, and the replacement
   * Session that lands afterwards is empty. The mutation is therefore refused for the
   * duration rather than accepted and lost.
   *
   * Mirrored into a ref as well as state because `handleAddShot` and the capture path
   * read it synchronously, outside any render closure (the same reason `sessionRef`
   * exists). Recoverable input is untouched — the entry field keeps its value, so the
   * athlete simply presses Add Shot again once the transition finishes.
   */
  const [sessionTransitionPending, setSessionTransitionPending] = useState(false);
  const sessionTransitionPendingRef = useRef(false);

  function beginSessionTransition(): void {
    sessionTransitionPendingRef.current = true;
    setSessionTransitionPending(true);
  }

  function endSessionTransition(): void {
    sessionTransitionPendingRef.current = false;
    setSessionTransitionPending(false);
  }

  const lastArchivedHistoryRef = useRef<Session[] | null>(null);
  const lastArchivedCurrentSessionRef = useRef<Session | null>(null);
  // The handle actually executed for the current planned shot — defaults to
  // the shot's Expected Handle (set by AssessScreen) but may be toggled by
  // the athlete. Lives here, not inside AssessScreen, for the same reason
  // captureManualHandle does: the shared TimingProvider subscription
  // callback below needs synchronous access to it.
  const [assessmentExecutedHandle, setAssessmentExecutedHandle] =
    useState<Handle>("in");
  const [assessmentLastCaptureMessage, setAssessmentLastCaptureMessage] =
    useState<string | undefined>(undefined);
  const [assessmentDiagnostics, setAssessmentDiagnostics] = useState<
    SimulatorDiagnosticEntry[]
  >([]);
  // Set at load time if a persisted currentRun had to be force-paused
  // because it was still "warmup"/"in_progress" after a reload (see the
  // mount effect) — consumed exactly once, by the first explicit Resume.
  const [pendingReloadRecoveryRunId, setPendingReloadRecoveryRunId] =
    useState<string | null>(null);
  const [assessmentQuarantineNotice, setAssessmentQuarantineNotice] =
    useState<string | null>(null);
  // Phase C — the id of a completed/incomplete Assessment Run currently
  // shown full-screen via AssessmentResultScreen. Reachable from both Assess
  // (Completion Summary, Landing) and Analyze → Assessments (history, latest
  // card); modeled as an id (not the run object) so it always resolves
  // against the latest assessmentState — e.g. it clears itself correctly if
  // the run is deleted. See docs/adr/0011's note that Phase C is purely
  // additive/read-only relative to capture ownership and navigation guards.
  const [viewingAssessmentResultRunId, setViewingAssessmentResultRunId] =
    useState<string | null>(null);
  const [analyzeTab, setAnalyzeTab] = useState<"training" | "assessments" | "exercises">("training");
  const analyzeTabsId = useId();
  const analyzePanelId = `${analyzeTabsId}-panel`;
  const analyzeTabId = (tab: typeof analyzeTab) => `${analyzeTabsId}-${tab}`;

  function handleAnalyzeTabKeyDown(event: KeyboardEvent<HTMLButtonElement>) {
    const tabs = ["training", "assessments", "exercises"] as const;
    const current = tabs.indexOf(analyzeTab);
    let next = current;
    if (event.key === "ArrowRight") next = (current + 1) % tabs.length;
    else if (event.key === "ArrowLeft") next = (current - 1 + tabs.length) % tabs.length;
    else if (event.key === "Home") next = 0;
    else if (event.key === "End") next = tabs.length - 1;
    else return;
    event.preventDefault();
    setAnalyzeTab(tabs[next]);
    const buttons = event.currentTarget.parentElement?.querySelectorAll<HTMLButtonElement>("[role='tab']");
    buttons?.[next]?.focus();
  }

  // Bumped whenever the user confirms discarding an in-progress Blind
  // Weight draft (see guardLeavingBlindDraft) — forces BlindShotEntry to
  // fully remount with a clean internal state, even if the active block
  // itself hasn't changed yet (e.g. the New Training Block modal is only
  // just being opened, and could still be cancelled).
  const [blindDraftResetToken, setBlindDraftResetToken] = useState(0);

  // The most recent refusal from the recording boundary, shown next to the entry
  // fields. Kept here rather than inside ShotEntry because the refusal can come from
  // the domain (buildMeasuredShot) rather than from what was typed, and because the
  // athlete's input must survive it — a refused stone is never cleared.
  const [shotEntryError, setShotEntryError] = useState<string | null>(null);

  // --- Draft and submission ownership ----------------------------------------------
  //
  // The draft's shape, and the rule for settling one against a durable write, live at
  // module scope (`ManualEntryDraft`, `settleManualDraftAfterDurableWrite`) so that
  // one settlement serves both the acknowledgement path and the covering-write
  // reconciliation, which runs inside a callback that closes over nothing.
  const [manualEntryDraft, setManualEntryDraft] =
    useState<ManualEntryDraft | null>(null);
  /**
   * Monotonic, never reused, never reset.
   *
   * Revisions must stay unique for the whole session's lifetime, not merely within one
   * draft: the draft is cleared when a write is acknowledged, and a counter that
   * restarted there would hand the NEXT stone the same revision as a submission still
   * in flight — which the idempotency check below would then read as a duplicate and
   * silently refuse. Incremented only from event handlers, never during render.
   */
  const draftRevisionRef = useRef(0);
  function nextDraftRevision(): number {
    draftRevisionRef.current += 1;
    return draftRevisionRef.current;
  }

  /**
   * One accepted manual stone whose write has not yet succeeded.
   *
   * A LIST, not a single slot: two stones can legitimately be in flight at once, and a
   * shared slot let an older acknowledgement erase a newer submission's retry target.
   * Each entry carries its own identity, owner and full intent, so an acknowledgement,
   * a retry and a status all address exactly one operation.
   */
  type ManualSubmission = {
    operationId: string;
    ownerKey: string;
    profileId: string;
    sessionId: string;
    blockId: string;
    shotId: string;
    /** Enough identity for the athlete to know WHICH stone is outstanding. */
    description: string;
    /**
     * The shared-draft revision this submission came from, or `null` for a caller
     * that owns its own draft and therefore has no revision identity.
     */
    revision: number | null;
    status: "pending" | "failed";
    message?: string;
  };
  const [manualSubmissions, setManualSubmissions] = useState<ManualSubmission[]>(
    []
  );
  /**
   * Authoritative mirror of the outstanding submissions, written synchronously by
   * every mutation (ADR-0007's ref-mirror pattern, as used for `sessionRef`).
   *
   * A write acknowledgement has to know WHICH operations it just proved durable, so
   * it can settle each one's draft and acknowledgement state — not merely drop the
   * failure row. A `setState` updater cannot answer that: it may run twice and must
   * never cause side effects, so the list is read from this ref instead.
   */
  const manualSubmissionsRef = useRef<ManualSubmission[]>([]);
  const commitManualSubmissions = useCallback(
    (
      update: (current: ManualSubmission[]) => ManualSubmission[]
    ): ManualSubmission[] => {
      const next = update(manualSubmissionsRef.current);
      manualSubmissionsRef.current = next;
      setManualSubmissions(next);
      return next;
    },
    []
  );
  /** The most recent acknowledged manual stone, so "saved" is owner-scoped. */
  const [lastAcknowledgedShot, setLastAcknowledgedShot] = useState<{
    ownerKey: string;
    operationId: string;
  } | null>(null);

  // Typed-but-unsaved completion values, keyed by full stone identity
  // (`completionKey`). A map rather than one value, so switching between stones keeps
  // each one's typing and an acknowledgement for one can never clear another's.
  const [completionDrafts, setCompletionDrafts] = useState<Record<string, string>>(
    {}
  );
  const [completionSelection, setCompletionSelection] =
    useState<CompletionSelection | null>(null);
  // Accepted completions whose write has not yet succeeded, kept visible and
  // retryable even though the domain no longer reports those stones as incomplete.
  const [pendingCompletions, setPendingCompletions] = useState<PendingCompletion[]>(
    []
  );
  /** Same authoritative mirror, for the completion side of the same question. */
  const pendingCompletionsRef = useRef<PendingCompletion[]>([]);
  const commitPendingCompletions = useCallback(
    (
      update: (current: PendingCompletion[]) => PendingCompletion[]
    ): PendingCompletion[] => {
      const next = update(pendingCompletionsRef.current);
      pendingCompletionsRef.current = next;
      setPendingCompletions(next);
      return next;
    },
    []
  );
  const [completionConfirmation, setCompletionConfirmation] = useState<
    | {
        /** Scoped, so a confirmation never outlives the training it belongs to. */
        sessionId: string;
        blockName: string;
        blockPosition: number;
        shotNumber: number;
        quantity: MeasuredQuantity;
        value: number;
      }
    | null
  >(null);

  // --- Capture Sequence UI state ---
  // "Next Handle" for CaptureHandleMode "manual" — the live sequence itself has no
  // opinion on this; it's whatever the person running the sequence taps next.
  const [captureManualHandle, setCaptureManualHandle] = useState<Handle>("in");
  // Editable "current target" text for Variable/Manual-target blocks during a running
  // sequence — mirrors ShotEntry's own editable-target input, but lifted to this level
  // because processIncomingTimingResult (fired from the simulator subscription, not a
  // form submit) needs to read the latest value at result-processing time.
  const [captureManualTargetInput, setCaptureManualTargetInput] = useState("");
  const [lastCaptureMessage, setLastCaptureMessage] = useState<
    string | undefined
  >(undefined);
  const [captureDiagnostics, setCaptureDiagnostics] = useState<
    SimulatorDiagnosticEntry[]
  >([]);

  // Mirrored into refs after every render (via effects, not during render — mutating a
  // ref's `.current` during the render body itself is flagged by this project's lint
  // config as unsafe for React Compiler compatibility) so the simulator's async
  // subscription callback (registered once in the effect below) always reads the latest
  // value instead of a stale one captured at subscribe time.
  const captureManualHandleRef = useRef(captureManualHandle);
  useEffect(() => {
    captureManualHandleRef.current = captureManualHandle;
  }, [captureManualHandle]);

  const captureManualTargetInputRef = useRef(captureManualTargetInput);
  useEffect(() => {
    captureManualTargetInputRef.current = captureManualTargetInput;
  }, [captureManualTargetInput]);

  const assessmentExecutedHandleRef = useRef(assessmentExecutedHandle);
  useEffect(() => {
    assessmentExecutedHandleRef.current = assessmentExecutedHandle;
  }, [assessmentExecutedHandle]);

  // Authoritative mirror of assessmentState, written synchronously by
  // commitAssessmentState (below) at the same instant as setAssessmentState —
  // same rationale as sessionRef (see the Capture Sequence comment below):
  // the shared TimingResult subscription needs a synchronous read of the
  // outcome of the *previous* queued result before processing the next one.
  const assessmentStateRef = useRef<AssessmentPersistedState | null>(
    assessmentState
  );
  useEffect(() => {
    assessmentStateRef.current = assessmentState;
  }, [assessmentState]);

  // --- Capture Sequence result processing: authoritative session mirror + queue ---
  //
  // `sessionRef` mirrors `currentSession`. Every capture-mutating action in this
  // component (processQueuedTimingResult, and every Pause/Resume/Cancel/Undo/Start
  // handler, via `commitSession` below) writes this ref SYNCHRONOUSLY, at the exact
  // point it also calls `setCurrentSession` — not relying on React's own
  // setState-updater timing. React guarantees queued functional updaters chain
  // correctly against each other, but it does NOT guarantee an updater is invoked
  // synchronously at the moment setState is called (that only happens as an internal
  // "eager state" optimization when no other update is already pending) — code that
  // needs to synchronously know the *outcome* of a state transition right after
  // triggering it (as processQueuedTimingResult does, for diagnostics/feedback) cannot
  // safely depend on that. Computing the full next state via the pure
  // `applyTimingResultToSession` and writing it to this ref ourselves removes that
  // dependency entirely.
  //
  // The effect below additionally resyncs `sessionRef` after every render, as a
  // catch-all for the *other*, non-capture handlers (handleAddShot, handleDeleteShot,
  // block creation, ...) that still use the classic functional-setState-updater
  // pattern and don't call `commitSession`. This leaves one known, narrow edge case:
  // if a classic manual shot (ShotEntry) is added in the same render window as a
  // capture result is being processed for the *same* block (both can be visible on
  // screen at once — Auto Capture is additive, not exclusive), there is a brief window
  // before the next render where `sessionRef` may not yet reflect the manual shot. This
  // is out of scope for this pass (which hardens the Capture Sequence path
  // specifically, not classic manual entry) and is documented in
  // docs/TECHNICAL_DEBT_AND_ROADMAP.md rather than silently left unmentioned.
  //
  // `captureQueueRef` is a Promise chain that serializes calls to
  // processIncomingTimingResult: two results arriving back-to-back in the same
  // synchronous tick (e.g. two simulator events fired without an await between them, or
  // a simulator event and a manual "Add Result Manually" click landing together) are
  // still processed one at a time, each reading the immediately-preceding result's
  // already-committed session — never a torn/stale read of the other's in-flight work.
  const sessionRef = useRef<Session | null>(currentSession);
  useEffect(() => {
    sessionRef.current = currentSession;
  }, [currentSession]);
  // Authoritative mirror of sessionHistory — same rationale and pattern as sessionRef
  // (see docs/adr/0014-session-archive-write-ordering.md's Strict-Mode/staleness
  // hardening pass): the session-archive transition below reads this ref, never the
  // render closure's `sessionHistory`, because that transition is deferred through
  // captureQueueRef and must not act on a value that may have been current only at
  // the moment the user clicked, not at the moment the deferred work actually runs.
  const sessionHistoryRef = useRef<Session[]>(sessionHistory);
  useEffect(() => {
    sessionHistoryRef.current = sessionHistory;
  }, [sessionHistory]);
  const captureQueueRef = useRef<Promise<void>>(Promise.resolve());
  // Single-flight guard for the session-archive transition (docs/adr/0014). Checked
  // and set synchronously, before any `await` — a ref, not state, specifically so the
  // check-and-set is not itself subject to React's asynchronous setState batching.
  // Cleared in every exit path (success, either failure step, or an unexpected
  // exception) via the shared .finally() below.
  const sessionArchiveInFlightRef = useRef(false);
  // The same single-flight discipline for the plan's own Next Exercise transition:
  // a double tap (or a Next racing a Finish) must never advance twice, materialise two
  // runtimes, or archive twice. Checked and set synchronously before the work is
  // enqueued; the enqueued work additionally revalidates the Session and step it was
  // bound to, because by the time the queue reaches it the plan may have moved on.
  const planStepAdvanceInFlightRef = useRef(false);
  // Surfaced in the plan controls. A transition or archive that could not be applied
  // must say so rather than silently doing nothing or implying success.
  const [planTransitionError, setPlanTransitionError] = useState<string | null>(null);
  /**
   * The Session a failed save may be retried with. Held as state so the retry control
   * only appears while there is genuinely something to retry, and cleared the moment a
   * retry succeeds or the state moves on. Declared here with the other top-level state
   * — never below an early return — so hook order is unconditional.
   */
  const [retryableSessionSave, setRetryableSessionSave] = useState<Session | null>(
    null
  );
  // The Session that was actually archived by Finish Training — never the empty
  // replacement Session the transition creates.
  const [finishedTrainingSummary, setFinishedTrainingSummary] = useState<
    { session: Session; saved: boolean } | null
  >(null);

  function outcomeToDiagnostic(
    outcome: ProcessTimingResultOutcome
  ): SimulatorDiagnosticEntry {
    return {
      id: crypto.randomUUID(),
      at: new Date().toISOString(),
      status: outcome.status,
      message:
        outcome.status === "accepted"
          ? `Shot captured: ${outcome.shot.releaseTime.toFixed(2)}s`
          : outcome.reason,
    };
  }

  /**
   * Commits a new session value through both channels that need it: `sessionRef`
   * (read synchronously by the capture-result queue) and React state (read by
   * everything that renders). Used by every capture control, for the same reason
   * processQueuedTimingResult writes both — a click on Pause/Resume/Cancel/Undo must be
   * visible to the very next queued result even if React hasn't re-rendered yet.
   */
  function commitSession(nextSession: Session) {
    if (!nextSession.captureSequence ||
        !["ready", "running"].includes(nextSession.captureSequence.status)) {
      browerController.reconcileContext(null);
    }
    // Every commit is stamped with its ordering position before it becomes visible,
    // so a persistence acknowledgement can tell which commit a write speaks for.
    stampSessionSequence(nextSession);
    sessionRef.current = nextSession;
    setCurrentSession(nextSession);
  }

  /** The Assessment-domain counterpart to commitSession — see the comment on assessmentStateRef above. */
  function commitAssessmentState(next: AssessmentPersistedState) {
    assessmentStateRef.current = next;
    setAssessmentState(next);
  }

  /**
   * The one entry point AssessScreen uses to mutate Assessment state — reads
   * the authoritative ref (never a possibly-stale render-closure value),
   * computes the next state via the supplied pure updater (which calls
   * src/lib/assessment/* domain functions), and commits it through both
   * channels. No-ops if Assessment data hasn't finished loading yet.
   */
  function updateAssessmentState(
    updater: (state: AssessmentPersistedState) => AssessmentPersistedState
  ) {
    // Corrected (docs/PERSISTENCE_BOUNDARY_DESIGN.md §7.4): once Assessment
    // hydration is "write_protected" (a genuine read failure), the fallback
    // state is non-null, so the null-check below alone would otherwise let
    // a Run be created/mutated in memory that can never actually persist.
    // "ready" is the only hydration state that permits mutation, matching
    // every other effect-persisted domain.
    if (assessmentHydration !== "ready") return;

    const current = assessmentStateRef.current;
    if (!current) return;
    commitAssessmentState(updater(current));
  }

  /**
   * Capture Ownership rule (see docs/adr/0011): an Assessment Run "owns" the
   * shared TimingResult stream whenever it is actively warming up or scoring
   * — never simultaneously with a Training Capture Sequence. Computed from
   * the ref (not React state) so the queue below always reads the up-to-date
   * value, even mid-queue.
   */
  function isAssessmentCaptureActive(): boolean {
    const run = assessmentStateRef.current?.currentRun;
    return !!run && (run.status === "warmup" || run.status === "in_progress");
  }

  /**
   * The one place a TimingResult (simulator, manual fallback, or later real hardware)
   * is turned into a Shot — see docs/adr/0006 and the "Race conditions" section of
   * docs/SYSTEM_ARCHITECTURE.md. Every call is appended to `captureQueueRef`, so
   * results are processed strictly one at a time, in arrival order — never two
   * "in flight" concurrently, and never against a stale/pre-previous-result session.
   *
   * This is intentionally NOT synchronous: it always defers the actual work by (at
   * least) one microtask, via the queue. That's what guarantees two results arriving
   * in the same synchronous tick — e.g. two simulator events with no await between
   * them, or a simulator event and an "Add Result Manually" click landing together —
   * are still serialized correctly, without depending on React's own setState-updater
   * batching/timing (which chains correctly but does not guarantee synchronous
   * invocation — see the comment on sessionRef/captureQueueRef above).
   *
   * The outer .catch() exists only so a bug in the queue plumbing itself (NOT an
   * ordinary rejection like "duplicate"/"invalid" — those are returned by
   * applyTimingResultToSession, never thrown, and are handled by
   * processQueuedTimingResult's own try/catch) can never permanently wedge the queue
   * and silently drop every subsequent, unrelated result.
   */
  function processIncomingTimingResult(result: TimingResult): void {
    // Ownership is captured HERE, at receipt, and re-verified when the queued work
    // actually runs. The queue defers processing by at least one microtask, and the
    // athlete can finish a step, start a new exercise and start a new Capture Sequence
    // in between — so a result must never be attributed to "whichever capture happens
    // to be current later". A result received while no capture was active belongs to
    // no capture at all and is rejected rather than adopted by the next one.
    const ownership = currentTrainingCaptureOwnership();
    captureQueueRef.current = captureQueueRef.current
      .then(() => {
        processQueuedTimingResult(result, ownership);
      })
      .catch((error) => {
        console.error("Unexpected error while processing a timing result", error);
      });
  }

  /**
   * The identity a Training capture result is bound to: which Session, which Block and
   * which Capture Sequence were active at the instant the result was received. All
   * three must still match when the queued work runs; any change means the result
   * crossed a boundary it must not cross.
   */
  type TrainingCaptureOwnership = {
    sessionId: string;
    blockId: string;
    sequenceId: string;
  };

  function currentTrainingCaptureOwnership(): TrainingCaptureOwnership | null {
    const session = sessionRef.current;
    const sequence = session?.captureSequence;
    if (!session || !sequence) return null;
    // Identity only — deliberately NOT filtered by status. Whether a sequence is
    // ready, running, paused, completed or cancelled is a question about that
    // sequence, and `processTimingResult` already answers it with the right
    // diagnostic ("ignored-paused", "ignored-completed"). Filtering here would
    // pre-empt those answers and report every result against a paused sequence as if
    // it had arrived outside the capture entirely, which is a different and untrue
    // statement. What this guard exists for is the *crossing* case: a result bound to
    // one sequence must never be applied to a different one.
    return {
      sessionId: session.id,
      blockId: sequence.blockId,
      sequenceId: sequence.id,
    };
  }

  function sameTrainingCaptureOwnership(
    left: TrainingCaptureOwnership | null,
    right: TrainingCaptureOwnership | null
  ): boolean {
    if (!left || !right) return false;
    return (
      left.sessionId === right.sessionId &&
      left.blockId === right.blockId &&
      left.sequenceId === right.sequenceId
    );
  }

  /**
   * The actual atomic transition, run strictly one-at-a-time by the queue above.
   * Reads/writes `sessionRef` directly (not `currentSession` from the render closure)
   * so it always starts from the immediately-preceding queued result's committed
   * state, then commits both the ref and React state together before returning.
   */
  function processQueuedTimingResult(
    result: TimingResult,
    ownershipAtReceipt: TrainingCaptureOwnership | null
  ): ProcessTimingResultOutcome | null {
    // Capture Ownership: a Timing Result is routed to exactly one context.
    // While an Assessment Run is actively warming up or scoring, it is the
    // sole consumer of the shared stream — Training's capture logic below
    // never runs for that result. See docs/adr/0011.
    if (isAssessmentCaptureActive()) {
      processQueuedAssessmentTimingResult(result);
      return null;
    }

    // Corrected (docs/PERSISTENCE_BOUNDARY_DESIGN.md §7.4): a Session that
    // is not "ready" (still loading, structurally impossible to reach here
    // since nothing renders before Session's own load resolves — or
    // write_protected after a genuine read failure) must never have a
    // timing result applied to it. This guard, together with the Timing
    // Simulator's own subscription gate above, closes both the automatic
    // (simulator) and manual/capture-sequence paths, which both funnel
    // through this one function.
    if (sessionHydration !== "ready") return null;

    // Same rule as manual entry: a terminal Session transition has already chosen its
    // archive snapshot, so a capture accepted now could not be part of it.
    if (sessionTransitionPendingRef.current) {
      const outcome: ProcessTimingResultOutcome = {
        status: "ignored-completed",
        reason: "This training is being saved; it cannot accept another stone.",
      };
      applyCaptureOutcomeFeedback(outcome);
      return outcome;
    }

    const session = sessionRef.current;
    if (!session) return null;

    // Ownership re-verification (see processIncomingTimingResult). A mismatch means
    // the Session, Block or Capture Sequence changed between receipt and processing —
    // the result is reported as not belonging rather than recorded against whatever is
    // current now. This does NOT claim to distinguish radio events the Brower protocol
    // itself cannot attribute; it only stops the application from re-attributing an
    // event it already received.
    if (!sameTrainingCaptureOwnership(ownershipAtReceipt, currentTrainingCaptureOwnership())) {
      const outcome: ProcessTimingResultOutcome = {
        status: "ignored-completed",
        reason: "This result arrived outside the capture that is active now.",
      };
      applyCaptureOutcomeFeedback(outcome);
      return outcome;
    }

    const activeBlockForOverrides = getActiveBlock(session);
    const isManualTargetSource =
      activeBlockForOverrides?.mode === "variable" &&
      activeBlockForOverrides.variableTargetMode === "manual";
    const parsedManualTarget = isManualTargetSource
      ? parseReleaseTime(captureManualTargetInputRef.current)
      : null;

    let nextSession: Session;
    let outcome: ProcessTimingResultOutcome;

    try {
      const applied = applyTimingResultToSession({
        session,
        result,
        manualTargetOverride:
          parsedManualTarget !== null && parsedManualTarget > 0
            ? parsedManualTarget
            : undefined,
        manualHandleOverride: captureManualHandleRef.current,
      });
      nextSession = applied.session;
      outcome = applied.outcome;
    } catch (error) {
      // A genuine exception (a bug — never how an ordinary rejection like "duplicate"
      // or "invalid" is signaled) must never leave half-applied capture progress. The
      // session's shots/blocks are left exactly as they were; the sequence is instead
      // paused with a visible error, per the Save-Fehler decision in
      // docs/TECHNICAL_DEBT_AND_ROADMAP.md — no partial state, no silent continuation,
      // no automatic retry.
      const message =
        error instanceof Error ? error.message : "Unexpected capture error.";

      nextSession = session.captureSequence
        ? {
            ...session,
            captureSequence: pauseCaptureSequenceWithError(
              session.captureSequence,
              message
            ),
          }
        : session;

      outcome = { status: "invalid", reason: message };
    }

    commitSession(nextSession);
    applyCaptureOutcomeFeedback(outcome);
    // Returned so a caller that must report the real result to the person who triggered
    // it (the assisted Brower acceptance below) can do so, instead of assuming success.
    return outcome;
  }

  function applyCaptureOutcomeFeedback(outcome: ProcessTimingResultOutcome) {
    setCaptureDiagnostics((diagnostics) =>
      [outcomeToDiagnostic(outcome), ...diagnostics].slice(0, 8)
    );

    if (outcome.status === "accepted") {
      setLastCaptureMessage(
        `Shot ${outcome.shot.shotNumber} captured: ${outcome.shot.releaseTime.toFixed(2)}s`
      );

      if (outcome.unusualValueWarning) {
        setLastCaptureMessage(outcome.unusualValueWarning);
      }

      if (
        outcome.updatedBlock.pendingTargetTime !== undefined &&
        (outcome.updatedBlock.mode === "variable" &&
          outcome.updatedBlock.variableTargetMode === "manual")
      ) {
        setCaptureManualTargetInput(
          outcome.updatedBlock.pendingTargetTime.toFixed(2)
        );
      }
    }
  }

  /**
   * The Assessment-domain counterpart to processQueuedTimingResult, run by
   * the same serialized queue whenever isAssessmentCaptureActive() was true
   * at dispatch time. Adapts the TimingResult via
   * applyTimingResultToAssessmentRun (src/lib/assessment/capture.ts) — the
   * only call site that produces a valid Assessment Attempt from captured
   * hardware/simulator input; manual entry (AssessScreen's
   * onSubmitManualTime) reaches this same function via a manually-built
   * TimingResult, so there is exactly one path.
   */
  function processQueuedAssessmentTimingResult(result: TimingResult): void {
    const state = assessmentStateRef.current;
    const run = state?.currentRun;
    if (!state || !run) return;

    const outcome = applyTimingResultToAssessmentRun(
      run,
      result,
      assessmentExecutedHandleRef.current
    );

    if (outcome.status === "accepted") {
      commitAssessmentState({ ...state, currentRun: outcome.run });
      setAssessmentLastCaptureMessage(
        `Shot captured: ${outcome.measuredTime.toFixed(2)}s`
      );
      setAssessmentDiagnostics((diagnostics) =>
        [
          {
            id: crypto.randomUUID(),
            at: new Date().toISOString(),
            status: "accepted",
            message: `Shot captured: ${outcome.measuredTime.toFixed(2)}s`,
          },
          ...diagnostics,
        ].slice(0, 8)
      );
      return;
    }

    // Duplicate/rejected results never change assessment progress and never
    // show user-facing feedback (see spec section 20) — only the dev
    // diagnostics panel is informed.
    setAssessmentDiagnostics((diagnostics) =>
      [
        {
          id: crypto.randomUUID(),
          at: new Date().toISOString(),
          status: outcome.status,
          message:
            outcome.status === "duplicate"
              ? "Duplicate timing result ignored."
              : outcome.reason,
        },
        ...diagnostics,
      ].slice(0, 8)
    );
  }

  // Dev/test-only Timing Simulator — a stable instance for the lifetime of this
  // component. Created unconditionally (cheap, pure in-memory listeners/state) but
  // only ever started/subscribed-to in development (see the effect below) and only
  // ever rendered a UI in development (see TimingSimulatorPanel usage further down).
  const [simulatorProvider] = useState(() => createSimulatorTimingProvider());

  useEffect(() => {
    if (!IS_DEV) return;
    // Corrected (docs/PERSISTENCE_BOUNDARY_DESIGN.md §7.4): the provider may start only
    // once the current-session domain reached "ready" via a successful `loadCurrent()` —
    // either a real "value" or genuine "absent" — never merely because the load
    // attempt finished. A read failure leaves `sessionHydration` at "write_protected"
    // forever (absent a future retry), so the provider is never started in that case,
    // closing the risk of a timing result being generated as processable input for a
    // session that never actually became ready.
    if (sessionHydration !== "ready") return;

    // Exactly one subscription per mounted effect instance. React (including Strict
    // Mode's dev-only mount→cleanup→mount double-invoke) always runs this cleanup
    // before running the effect body again, and `subscribe`/`unsubscribe` are a plain
    // Set add/delete (see simulatorTimingProvider.ts) — so a second mount can never
    // result in two active listeners, and a delayed/in-flight result queued by an
    // instance that has since been cleaned up can never reach a listener that no
    // longer exists. `start`/`stop` are similarly idempotent (a plain boolean flag).
    const unsubscribe = simulatorProvider.subscribe((result) => {
      processIncomingTimingResult(result);
    });
    simulatorProvider.start();

    return () => {
      unsubscribe();
      simulatorProvider.stop();
    };
    // processIncomingTimingResult reads all its inputs from sessionRef/the refs above
    // (always-latest) — it never closes over stale state, so it's intentionally not a
    // dependency here; re-subscribing on every render would defeat the point of a
    // stable provider instance.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [simulatorProvider, sessionHydration]);

  // --- Assisted Brower capture (pilot) ---------------------------------------------
  //
  // A real timer reaches the same boundary every other source uses. After setup,
  // filtered Back–Hog candidates are drained automatically; unfiltered contexts retain
  // manual selection. Both emit `source: "external"` through processQueuedTimingResult
  // (ADR-0006), with no parallel shot-save path.
  //
  // Scoped to an active, non-Blind Training Capture Sequence. Assessment keeps sole
  // ownership of the stream whenever a run is warming up or scoring (ADR-0011), which
  // `verifyBrowerCaptureOwnership` re-checks at execution time.
  const [browerController] = useState(() => {
    const availability = resolveBrowerTransportAvailability(detectRuntimePlatform());
    return createBrowerAssistedCaptureController({
      availability,
      transport: availability.supported ? createCapacitorBrowerTransport() : null,
      lifecycle: availability.supported
        ? createCapacitorBrowerLifecycle()
        : { onActiveStateChange: () => () => undefined },
    });
  });

  useEffect(() => {
    // The controller subscribes its foreground/background listener HERE, not in its
    // factory, so a controller created during a discarded render leaks nothing. Cleanup
    // detaches and releases the connection without terminally killing the controller —
    // Strict Mode replays this cleanup and then runs the effect again on the same
    // instance, and a terminal release would leave Connect permanently dead.
    const detachLifecycle = browerController.attachLifecycle();
    return () => {
      detachLifecycle();
      void browerController.release();
    };
  }, [browerController]);

  /**
   * The context an accepted candidate is bound to, or null when nothing may be
   * accepted. Recomputed from render state, and re-verified independently inside the
   * capture queue — by the time queued work runs, any part of this may have changed.
   */
  const browerCaptureContext: BrowerCaptureContext | null = useMemo(() => {
    if (activeView !== "train") return null;
    if (identityProfileId === null) return null;
    if (sessionHydration !== "ready") return null;
    if (!currentSession) return null;
    const sequence = currentSession.captureSequence;
    // `isCaptureSequenceActive` deliberately includes "paused" — pausing is a
    // sequence-level concern, not a provider one. Offering measurements is different:
    // a paused sequence rejects every result, so a candidate left selectable while
    // paused could only ever fail. Pausing therefore ends eligibility, and resuming
    // requires confirming the setup again.
    if (!sequence) return null;
    if (sequence.status !== "ready" && sequence.status !== "running") return null;
    const block = getActiveBlock(currentSession);
    // Blind Weight never has a Capture Sequence (createCaptureSequence refuses one), so
    // this is a defensive restatement of an existing invariant, not a new rule.
    if (!block || block.mode === "blind") return null;
    if (sequence.blockId !== block.id) return null;
    // A timing device measures a time interval. A block that records no time has
    // none to bind a candidate to, so nothing is eligible for acceptance.
    if (!block.measurementMode) return null;
    const blockMeasurementMode = block.measurementMode;
    if (sequence.blockId !== block.id) return null;
    return {
      profileId: identityProfileId,
      sessionId: currentSession.id,
      blockId: block.id,
      sequenceId: sequence.id,
      measurementMode: blockMeasurementMode,
      shotType: sequence.shotType,
    };
    // Recomputed only when something it actually depends on changes, so the reconcile
    // effect below does not re-run on every unrelated render.
  }, [identityProfileId, sessionHydration, currentSession, activeView]);

  // Reconciled HERE rather than in the panel: leaving Train, switching away from Auto
  // Capture, or any other unmount of the panel must still invalidate an armed window.
  // An effect that lived in the panel would unmount with it and never run.
  useEffect(() => {
    browerController.reconcileContext(browerCaptureContext);
  }, [browerController, browerCaptureContext]);

  const browerAuthorityRef = useRef({ identityProfileId, sessionHydration, activeView });
  useEffect(() => {
    browerAuthorityRef.current = { identityProfileId, sessionHydration, activeView };
  }, [identityProfileId, sessionHydration, activeView]);

  /**
   * Reads what the application actually looks like RIGHT NOW, for the pure ownership
   * rule in `assistedCapture.ts`. Reads `sessionRef` (not the render closure) because
   * this runs inside the capture queue, where the render closure may be stale.
   */
  function readBrowerOwnershipSnapshot(): BrowerCaptureOwnershipSnapshot {
    const session = sessionRef.current;
    const block = session ? getActiveBlock(session) : undefined;
    return {
      sessionReady: browerAuthorityRef.current.sessionHydration === "ready" &&
        browerAuthorityRef.current.activeView === "train",
      assessmentCaptureActive: isAssessmentCaptureActive(),
      profileId: browerAuthorityRef.current.identityProfileId,
      sessionId: session?.id ?? null,
      activeBlockId: block?.id ?? null,
      activeBlockMeasurementMode: block?.measurementMode ?? null,
      captureSequenceId: session?.captureSequence?.id ?? null,
      captureShotType: session?.captureSequence?.shotType,
    };
  }

  // --- Durability acknowledgement for accepted measurements -------------------------
  //
  // The capture transition above is IN MEMORY. The repository write happens in the
  // current-session save effect, and until it acknowledges, nothing may tell the athlete
  // their shot is saved. These waiters carry the acknowledgement back to whoever is
  // waiting on it.
  //
  // Keyed by SHOT id, not by Session object identity: two rapid commits can coalesce
  // into one render, so the write that acknowledges a shot is not necessarily the write
  // of the exact Session object that first contained it.
  const sessionSaveWaitersRef = useRef<
    { shotId: string; settle: (outcome: BrowerSaveAcknowledgement) => void }[]
  >([]);

  /**
   * Session-level save acknowledgement, distinct from the shot-level waiters below.
   *
   * A transition that changes what the athlete sees (advancing a Training Plan step)
   * must be able to tell whether that change was actually persisted, so a storage
   * failure can be reported instead of leaving the screen and storage disagreeing with
   * no visible retry path. One write, one acknowledgement — this never issues a second
   * save of its own; it waits for the ordinary save effect's result.
   */
  type SessionPersistenceAck =
    | { status: "persisted" }
    | { status: "failed"; error: PersistenceWriteError }
    /** The intended state is no longer current, so there is nothing left to report. */
    | { status: "superseded" };

  type SessionSaveAckWaiter = {
    /** The commit this waiter is asking about. */
    sequence: number;
    /** Whether a successfully written session still contains the intended change. */
    covers: (written: Session) => boolean;
    settle: (ack: SessionPersistenceAck) => void;
  };

  const sessionSaveAckWaitersRef = useRef<SessionSaveAckWaiter[]>([]);

  // A monotonically increasing number identifying each Session object's position in
  // the commit order. Object inequality establishes neither ordering nor persistence —
  // two different objects say nothing about which one is newer — so acknowledgement is
  // matched on this explicit sequence instead.
  //
  // Assigned at COMMIT (`commitSession`) or, for the Session objects React produces
  // from a `setCurrentSession` updater, at WRITE SUBMISSION (the save effect below) —
  // in both cases before any asynchronous wait, and in commit order. Never at
  // settlement: a position invented after a write resolves would let a stale snapshot
  // outrank a transition committed while it was in flight.
  const sessionSequenceRef = useRef(0);
  const sessionSequencesRef = useRef(new WeakMap<Session, number>());

  /** Idempotent: a Session already in the order keeps the position it was given. */
  function stampSessionSequence(session: Session): number {
    const existing = sessionSequencesRef.current.get(session);
    if (existing !== undefined) return existing;
    sessionSequenceRef.current += 1;
    sessionSequencesRef.current.set(session, sessionSequenceRef.current);
    return sessionSequenceRef.current;
  }

  /**
   * The position a waiter is asking about. Stamping here is safe and necessary: a
   * waiter is always registered immediately after its own commit, so this runs before
   * any write of a later state could be submitted.
   */
  function sequenceOf(session: Session): number {
    return stampSessionSequence(session);
  }

  /**
   * Resolves once a write that genuinely speaks for this commit has settled.
   *
   * An OLDER or unrelated write never acknowledges it: a write is only allowed to
   * answer for commits at or before its own sequence. A SUPERSEDING write may answer
   * for it, but only when that write actually succeeded AND the state it wrote still
   * contains the intended change (`covers`) — otherwise the caller is told the change
   * was superseded rather than falsely told it is durable.
   */
  function registerSessionPersistenceAck(
    session: Session,
    covers: (written: Session) => boolean,
    onAck: (ack: SessionPersistenceAck) => void
  ): void {
    // A direct callback rather than a promise: the acknowledgement is delivered in
    // the same tick as the write result that produced it, so what the athlete sees
    // cannot lag behind the outcome by an extra microtask. It also cannot block
    // anything, which is what keeps the shared capture/transition queue free.
    sessionSaveAckWaitersRef.current = [
      ...sessionSaveAckWaitersRef.current,
      { sequence: sequenceOf(session), covers, settle: onAck },
    ];
  }

  // Depends only on refs, setState functions and the two commit helpers — all stable
  // for the component's lifetime. That makes it a stable reference the save effect can
  // depend on honestly, instead of being omitted from its dependency list.
  const settleSessionSaveWaiters = useCallback(function settleSessionSaveWaiters(
    saved: Session,
    result: PersistenceWriteResult
  ): void {
    // Session-level acknowledgements first. Inlined rather than extracted so this
    // function provably touches only refs and setState, which is what keeps it out of
    // the save effect's dependencies.
    // A write that SUCCEEDED and genuinely contains an outstanding operation's data
    // proves that operation durable, even though its own acknowledgement waiter was
    // already consumed by an earlier failure. Recording a second stone successfully,
    // or completing a measurement on the same stone, durably writes the first one
    // alongside it; archive reconciliation alone cannot cover that, because the
    // training has not ended.
    //
    // This is the SAME settlement the direct acknowledgement performs — not merely
    // dropping the failure row. Removing the operation without settling its draft
    // left the already-submitted values in the entry fields while removing the very
    // thing that stopped them being recorded a second time, so pressing Save Shot
    // again silently created a duplicate stone.
    //
    // Only FAILED operations are reconciled, and only against data the written
    // session actually carries, so an older, unrelated or non-covering write still
    // cannot speak for newer work and a genuinely unsaved operation stays visible.
    if (result.ok) {
      const coveredSubmissions = manualSubmissionsRef.current.filter(
        (submission) =>
          submission.status === "failed" &&
          submission.sessionId === saved.id &&
          saved.shots.some((shot) => shot.id === submission.shotId)
      );

      if (coveredSubmissions.length > 0) {
        const coveredIds = new Set(
          coveredSubmissions.map((submission) => submission.operationId)
        );
        commitManualSubmissions((current) =>
          current.filter((entry) => !coveredIds.has(entry.operationId))
        );

        const newest = coveredSubmissions[coveredSubmissions.length - 1];
        setLastAcknowledgedShot({
          ownerKey: newest.ownerKey,
          operationId: newest.operationId,
        });

        // Settled ONLY against the exact owner and revision these operations
        // describe. Anything typed since belongs to a later revision and is none of
        // this write's business — which is what keeps a newer draft, and its handle,
        // shot type and editable target, intact.
        setManualEntryDraft((draft) =>
          settleManualDraftAfterDurableWrite(draft, coveredSubmissions)
        );
      }

      const coveredCompletions = pendingCompletionsRef.current.filter(
        (entry) =>
          entry.status === "failed" &&
          entry.sessionId === saved.id &&
          saved.shots.some(
            (shot) => shot.id === entry.shotId && shotMeasures(shot, entry.quantity)
          )
      );

      if (coveredCompletions.length > 0) {
        const coveredKeys = new Set(coveredCompletions.map((entry) => entry.key));
        commitPendingCompletions((current) =>
          current.filter((entry) => !coveredKeys.has(entry.key))
        );

        // Their typed values and open editor are settled too, exactly as a direct
        // acknowledgement settles them — a draft left behind for a measurement that
        // is now in storage would invite the athlete to enter it again.
        setCompletionDrafts((current) => {
          const next = { ...current };
          let changed = false;
          for (const key of coveredKeys) {
            if (key in next) {
              delete next[key];
              changed = true;
            }
          }
          return changed ? next : current;
        });
        setCompletionSelection((current) =>
          current && coveredKeys.has(completionKey(current)) ? null : current
        );

        const newest = coveredCompletions[coveredCompletions.length - 1];
        setCompletionConfirmation({
          sessionId: newest.sessionId,
          blockName: newest.blockName,
          blockPosition: newest.blockPosition,
          shotNumber: newest.shotNumber,
          quantity: newest.quantity,
          value: newest.value,
        });
      }
    }

    const ackWaiters = sessionSaveAckWaitersRef.current;
    if (ackWaiters.length > 0) {
      // Read, never assigned. Settlement happens after the fact and must not invent a
      // chronological position for a snapshot that was never submitted through a
      // tracked path: an unsequenced session is treated as older than everything, so
      // it can never consume a newer transition's acknowledgement.
      const savedSequence = sessionSequencesRef.current.get(saved) ?? 0;
      const stillWaiting: SessionSaveAckWaiter[] = [];

      for (const ackWaiter of ackWaiters) {
        // An older write says nothing about a newer commit. Keep waiting for a write
        // that actually carries it — never let the old success stand in for it.
        if (savedSequence < ackWaiter.sequence) {
          stillWaiting.push(ackWaiter);
          continue;
        }

        // Coverage decides what this write may say about the transition at all. A
        // write that does NOT contain the intended change — a different session, an
        // owner change, a state that moved past it — reports supersession whether it
        // succeeded or failed: its failure is not this transition's failure, and its
        // success is not this transition's durability.
        if (!ackWaiter.covers(saved)) {
          ackWaiter.settle({ status: "superseded" });
          continue;
        }

        ackWaiter.settle(
          result.ok
            ? { status: "persisted" }
            : { status: "failed", error: result.error }
        );
      }

      sessionSaveAckWaitersRef.current = stillWaiting;
    }

    const waiters = sessionSaveWaitersRef.current;
    if (waiters.length === 0) return;

    const remaining: typeof waiters = [];
    for (const waiter of waiters) {
      const present = saved.shots.some((shot) => shot.id === waiter.shotId);
      if (!present) {
        // This write says nothing about that shot — it was undone, or belongs to a
        // session this write did not cover. Keep waiting rather than guessing.
        remaining.push(waiter);
        continue;
      }
      waiter.settle(
        result.ok ? { kind: "saved" } : { kind: "save_failed", error: result.error }
      );
    }
    sessionSaveWaitersRef.current = remaining;
  }, [commitManualSubmissions, commitPendingCompletions]);

  /**
   * Resolves once a repository write has actually acknowledged a session containing
   * this shot, or with `pending` if none has within the bound.
   *
   * `pending` is a truthful third answer, not a disguised success: the measurement is in
   * the session and may yet be written, and the athlete is told exactly that.
   */
  function awaitShotDurability(shotId: string): Promise<BrowerSaveAcknowledgement> {
    return new Promise<BrowerSaveAcknowledgement>((resolve) => {
      let settled = false;
      const settle = (outcome: BrowerSaveAcknowledgement) => {
        if (settled) return;
        settled = true;
        resolve(outcome);
      };

      sessionSaveWaitersRef.current = [
        ...sessionSaveWaitersRef.current,
        { shotId, settle },
      ];

      setTimeout(() => {
        if (settled) return;
        sessionSaveWaitersRef.current = sessionSaveWaitersRef.current.filter(
          (waiter) => waiter.settle !== settle
        );
        settle({ kind: "pending" });
      }, SHOT_DURABILITY_ACKNOWLEDGEMENT_TIMEOUT_MS);
    });
  }

  /**
   * Re-attempts the write for a measurement whose save failed.
   *
   * It re-saves the CURRENT session, never the stale one the failure was reported for,
   * so a retry can never overwrite newer work. It goes nowhere near the capture path, so
   * it can never create a second shot — the shot already exists and is untouched here.
   */
  async function retryBrowerSave(expected: { sessionId: string; shotId: string }): Promise<BrowerSaveAcknowledgement> {
    return runSessionWrite(async () => {
      const session = sessionRef.current;
      if (browerAuthorityRef.current.sessionHydration !== "ready" ||
          session?.id !== expected.sessionId ||
          !session.shots.some((shot) => shot.id === expected.shotId)) {
        return { kind: "save_failed", error: { kind: "unknown", message: "The original measurement is no longer in this training." } };
      }
      try {
        const result = await sessionRepository.saveCurrent(session);
        settleSessionSaveWaiters(session, result);
        return result.ok ? { kind: "saved" } : { kind: "save_failed", error: result.error };
      } catch {
        return { kind: "save_failed", error: { kind: "unknown", message: "The save did not report a result." } };
      }
    });
  }

  /**
   * Accepts exactly one candidate, through the shared capture queue.
   *
   * Resolves with what actually happened — never with an assumption. A duplicate, a
   * paused sequence, a changed context and an unexpected exception all resolve as
   * rejections with the real reason, so the panel cannot show a time as recorded when
   * it was not.
   */
  function handleAcceptBrowerCandidate(
    candidate: BrowerCandidate
  ): Promise<BrowerAcceptOutcome> {
    const result: TimingResult = {
      id: candidate.id,
      // Byte ARRIVAL time. The device supplies no measurement timestamp this pilot can
      // verify, and receipt is never presented as one.
      receivedAt: candidate.observedAt,
      source: "external",
      measurements: [
        {
          measurementMode: candidate.context.measurementMode,
          value: browerIntervalSeconds(candidate.intervalMs),
        },
      ],
    };

    return new Promise<BrowerAcceptOutcome>((resolve) => {
      captureQueueRef.current = captureQueueRef.current
        .then(async () => {
          // Two independent checks, both at EXECUTION time rather than tap time.
          //
          // The first asks the controller whether this candidate is still live in the
          // same connection and arming window: backgrounding, a disconnect, a discard,
          // a pause, a re-arm or an unmount between the tap and here must all revoke it.
          const revoked = browerController.verifyCandidateStillLive(candidate);
          if (revoked !== null) {
            resolve({ status: "rejected", message: revoked });
            return;
          }

          // The second asks whether the training context it was bound to is still the
          // live one, read from the authoritative refs rather than a render closure.
          const refusal = verifyBrowerCaptureOwnership(
            candidate.context,
            readBrowerOwnershipSnapshot()
          );
          if (refusal !== null) {
            resolve({ status: "rejected", message: refusal });
            return;
          }

          if (!browerIntervalFitsShotRange(candidate.intervalMs, candidate.context)) {
            resolve({ status: "rejected", message: "This time is outside the selected shot type's range." });
            return;
          }

          // The assisted-Brower path already proved, immediately above and at
          // EXECUTION time, that this candidate's bound training context is still the
          // live one (verifyBrowerCaptureOwnership). Reading ownership here is
          // therefore the same context that check just confirmed — the generic
          // receipt-time guard is satisfied without weakening either check.
          const outcome = processQueuedTimingResult(
            result,
            currentTrainingCaptureOwnership()
          );

          if (outcome === null) {
            resolve({
              status: "rejected",
              message: "This time was not recorded: training capture did not accept it.",
            });
            return;
          }

          if (outcome.status !== "accepted") {
            resolve({
              status: "rejected",
              message: `This time was not recorded: ${outcome.reason}`,
            });
            return;
          }

          // Applied in memory. NOT yet saved — and not reported as saved until the
          // repository says so.
          const shot = outcome.shot;
          resolve({
            status: "applied",
            shotId: shot.id,
            sessionId: shot.sessionId,
            shotNumber: shot.shotNumber,
            releaseTime: shot.releaseTime,
            durability: awaitShotDurability(shot.id),
          });
        })
        .catch((error: unknown) => {
          console.error("Unexpected error while accepting a Brower candidate", error);
          resolve({
            status: "rejected",
            message: "This time was not recorded because of an unexpected error.",
          });
        });
    });
  }

  // --- Mount-time hydration (Phase 1 repository boundary) ---
  // Replaces the old single synchronous mount effect. Each domain's load is kicked off
  // independently — no domain's outcome blocks or is blocked by another's (except
  // Session's own two keys, which share one hydration state since they're one domain —
  // see docs/PERSISTENCE_BOUNDARY_DESIGN.md §7.1). A shared `cancelled` flag prevents any
  // late-resolving load from updating state after unmount.
  useEffect(() => {
    let cancelled = false;

    Promise.all([sessionRepository.loadCurrent(), sessionRepository.loadHistory()]).then(
      ([currentResult, historyResult]) => {
        if (cancelled) return;

        if (currentResult.status === "value") {
          setCurrentSession(currentResult.value);
          // Home is the normal entry point (see docs/adr/0009), except for the one
          // active training situation reload can hand back: a Capture Sequence that
          // was running or paused when the page closed.
          if (
            isCaptureSequenceActive(currentResult.value.captureSequence) ||
            currentResult.value.activeExerciseExecutionId !== undefined
          ) {
            setActiveView("train");
          }
        } else if (currentResult.status === "absent") {
          setCurrentSession(createNewSession());
        } else {
          setCurrentSession(currentResult.fallback);
        }

        if (historyResult.status === "value") {
          setSessionHistory(historyResult.value);
        } else if (historyResult.status === "absent") {
          setSessionHistory([]);
        } else {
          setSessionHistory(historyResult.fallback);
        }

        if (currentResult.status === "read_failed" || historyResult.status === "read_failed") {
          setSessionReadError(
            currentResult.status === "read_failed" ? currentResult.error : (historyResult as { error: PersistenceReadError }).error
          );
          setSessionHydration("write_protected");
        } else {
          setSessionHydration("ready");
        }
      }
    );

    historyFiltersRepository.load().then((result) => {
      if (cancelled) return;
      if (result.status === "value") {
        setHistoryFilters(result.value);
      } else if (result.status === "absent") {
        setHistoryFilters(createDefaultHistoryFilters());
      } else {
        setHistoryFilters(result.fallback);
        setHistoryFiltersReadError(result.error);
      }
      setHistoryFiltersHydration(result.status === "read_failed" ? "write_protected" : "ready");
    });

    // --- Assessment data (its own key, own migration path — ADR-0010/0011) ---
    assessmentRepository.loadState().then((result) => {
      if (cancelled) return;

      if (result.status === "read_failed") {
        setAssessmentState(result.fallback.state);
        setAssessmentReadError(result.error);
        setAssessmentHydration("write_protected");
        return;
      }

      const migratedAssessment =
        result.status === "value" ? result.value.state : createEmptyAssessmentPersistedState();

      // A raw currentRun existed but failed validation (quarantined) — surface this
      // transparently rather than letting it silently disappear (see
      // docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 24). Never
      // applicable to "absent" — there was nothing to quarantine.
      if (result.status === "value" && result.value.currentRunQuarantined) {
        setAssessmentQuarantineNotice(ASSESSMENT_QUARANTINE_NOTICE);
      }

      // Reload Recovery: a persisted run that was still "warmup"/"in_progress" survived
      // a reload (the app never persists "capture is live" as a separate flag — this
      // status combination IS that signal). Force it to "paused" before it's ever
      // rendered, so capture never silently reactivates without an explicit Resume tap
      // (see spec section 21-23). Only meaningful for a real "value" — "absent" can
      // never have a currentRun.
      let finalAssessment = migratedAssessment;
      if (
        result.status === "value" &&
        migratedAssessment.currentRun &&
        (migratedAssessment.currentRun.status === "warmup" ||
          migratedAssessment.currentRun.status === "in_progress")
      ) {
        const pausedOutcome = pauseAssessmentRun(migratedAssessment.currentRun);
        if (pausedOutcome.ok) {
          const pausedRun = {
            ...pausedOutcome.value,
            interruption: {
              ...pausedOutcome.value.interruption,
              interruptionCount: pausedOutcome.value.interruption.interruptionCount + 1,
            },
          };
          finalAssessment = { ...migratedAssessment, currentRun: pausedRun };
          setPendingReloadRecoveryRunId(pausedRun.id);
          const currentShot = getCurrentPlannedShot(pausedRun);
          if (currentShot) setAssessmentExecutedHandle(currentShot.expectedHandle);
        }
      }

      setAssessmentState(finalAssessment);
      setAssessmentHydration("ready");
    });

    // --- Training Plan library (its own key, own migration path — ADR-0012) ---
    trainingPlansRepository.loadPlans().then((result) => {
      if (cancelled) return;
      if (result.status === "value") {
        setTrainingPlans(result.value);
      } else if (result.status === "absent") {
        setTrainingPlans([]);
      } else {
        setTrainingPlans(result.fallback);
        setTrainingPlansReadError(result.error);
      }
      setTrainingPlansHydration(result.status === "read_failed" ? "write_protected" : "ready");
    });

    // --- Accuracy Tolerance Profiles (its own key, own migration path) ---
    accuracyToleranceProfilesRepository.loadState().then((result) => {
      if (cancelled) return;
      if (result.status === "value") {
        setAccuracyToleranceProfilesState(result.value);
      } else if (result.status === "absent") {
        setAccuracyToleranceProfilesState(createEmptyAccuracyToleranceProfilesState());
      } else {
        setAccuracyToleranceProfilesState(result.fallback);
        setAccuracyProfilesReadError(result.error);
      }
      setAccuracyProfilesHydration(result.status === "read_failed" ? "write_protected" : "ready");
    });

    // --- Smart Random Profiles (its own key, own migration path) ---
    smartRandomProfilesRepository.loadState().then((result) => {
      if (cancelled) return;
      if (result.status === "value") {
        setSmartRandomProfilesState(result.value);
      } else if (result.status === "absent") {
        setSmartRandomProfilesState(createEmptySmartRandomProfilesState());
      } else {
        setSmartRandomProfilesState(result.fallback);
        setSmartRandomProfilesReadError(result.error);
      }
      setSmartRandomProfilesHydration(
        result.status === "read_failed" ? "write_protected" : "ready"
      );
    });

    return () => {
      cancelled = true;
    };
  }, [
    accuracyToleranceProfilesRepository,
    assessmentRepository,
    historyFiltersRepository,
    sessionRepository,
    smartRandomProfilesRepository,
    trainingPlansRepository,
  ]);

  useEffect(() => {
    if (!currentSession) return;
    if (sessionHydration !== "ready") return;
    // Already durably persisted by archiveAndReplace (docs/adr/0014) — skip the
    // redundant rewrite rather than risk re-persisting this exact transition in this
    // effect's own declaration order. Any subsequent real edit produces a new object,
    // so this guard stops matching (and this effect resumes) on the very next change.
    if (currentSession === lastArchivedCurrentSessionRef.current) return;

    const saved = currentSession;
    // Ordering is fixed HERE, at SUBMISSION, before any asynchronous wait.
    //
    // This is the submission point for every Session object React itself produced
    // from a `setCurrentSession` updater — metadata edits, shot edits and deletions,
    // target changes — none of which pass through `commitSession`. Assigning their
    // position later, when the write settles, would give an OLDER snapshot a NEWER
    // number than a transition committed in between, and that stale success would
    // then consume the transition's acknowledgement before its own write failed.
    if (sessionSequencesRef.current.get(saved) === undefined) {
      sessionSequenceRef.current += 1;
      sessionSequencesRef.current.set(saved, sessionSequenceRef.current);
    }

    void runSessionWrite(() => sessionRepository.saveCurrent(saved))
      .then((result) => settleSessionSaveWaiters(saved, result))
      .catch(() =>
        // A repository is not supposed to throw, but a waiter must never be left
        // hanging by one that does — an unacknowledged write is reported as a failure,
        // never as a success.
        settleSessionSaveWaiters(saved, {
          ok: false,
          error: { kind: "unknown", message: "The save did not report a result." },
        })
      );
  }, [currentSession, sessionHydration, sessionRepository, settleSessionSaveWaiters]);

  useEffect(() => {
    if (historyFiltersHydration !== "ready") return;

    historyFiltersRepository.save(historyFilters);
  }, [historyFilters, historyFiltersHydration, historyFiltersRepository]);

  useEffect(() => {
    if (sessionHydration !== "ready") return;
    // See the matching guard in the current-session save effect above.
    if (sessionHistory === lastArchivedHistoryRef.current) return;

    sessionRepository.saveHistory(sessionHistory);
  }, [sessionHistory, sessionHydration, sessionRepository]);

  useEffect(() => {
    if (!assessmentState) return;
    if (assessmentHydration !== "ready") return;

    assessmentRepository.saveState(assessmentState);
  }, [assessmentState, assessmentHydration, assessmentRepository]);

  useEffect(() => {
    if (trainingPlansHydration !== "ready") return;

    trainingPlansRepository.savePlans(trainingPlans);
  }, [trainingPlans, trainingPlansHydration, trainingPlansRepository]);

  useEffect(() => {
    if (accuracyProfilesHydration !== "ready") return;

    accuracyToleranceProfilesRepository.saveState(accuracyToleranceProfilesState);
  }, [
    accuracyToleranceProfilesRepository,
    accuracyToleranceProfilesState,
    accuracyProfilesHydration,
  ]);

  useEffect(() => {
    if (smartRandomProfilesHydration !== "ready") return;

    smartRandomProfilesRepository.saveState(smartRandomProfilesState);
  }, [
    smartRandomProfilesRepository,
    smartRandomProfilesState,
    smartRandomProfilesHydration,
  ]);

  if (!currentSession) {
    return null;
  }

  // Readiness gating (docs/PERSISTENCE_BOUNDARY_DESIGN.md §7.4): "ready" is
  // the only hydration state that permits interaction with a domain's
  // mutating controls — both "loading" and "write_protected" keep the
  // domain's own fallback/default visible but non-mutable. Each flag is
  // independent, so one domain being unavailable never disables another.
  // Also false while a terminal Session transition is in flight — see
  // sessionTransitionPending. This is what disables Add Shot and every other
  // session-mutating control for the duration of the archive write.
  const sessionWritable = sessionHydration === "ready" && !sessionTransitionPending;
  const trainingPlansWritable = trainingPlansHydration === "ready";
  const accuracyProfilesWritable = accuracyProfilesHydration === "ready";
  const smartRandomProfilesWritable = smartRandomProfilesHydration === "ready";

  const activeBlock = getActiveBlock(currentSession);
  const activeTeamExerciseDraft = sportingCloudSync?.activeTeamExerciseDraft ?? null;
  const activeTeamEligibilitySnapshot = activeTeamExerciseDraft?.teamContext
    ? sportingCloudSync?.teamEligibilitySnapshots.find(
        (snapshot) => snapshot.teamId === activeTeamExerciseDraft.teamContext?.teamId
      )
    : undefined;
  const completedTeamSyncReceipt = lastCompletedTeamSessionId
    ? sportingCloudSync?.teamSessions.find(
        (session) => session.sessionId === lastCompletedTeamSessionId
      )
    : undefined;
  const activeExerciseExecution = currentSession.activeExerciseExecutionId
    ? currentSession.exerciseExecutions?.find(
        (execution) => execution.id === currentSession.activeExerciseExecutionId
      )
    : undefined;
  const activeBlockShots = activeBlock
    ? getBlockShots(currentSession, activeBlock.id)
    : [];
  const filteredActiveBlockShots = filterShots(
    activeBlockShots,
    blockFilter
  );
  const activeBlockAccuracyThresholds = activeBlock
    ? resolveAccuracyThresholds(activeBlock.accuracyThresholds)
    : null;
  // What the active block measures, resolved once. Legacy blocks (no stored
  // configuration) resolve to time-only, so every existing training behaves exactly
  // as before without a migration having written anything (ADR-0051).
  const activeBlockMeasurement: ResolvedBlockMeasurement = activeBlock
    ? resolveBlockMeasurement(activeBlock)
    : { quantities: [] };
  const activeBlockMeasuresTime =
    activeBlockMeasurement.quantities.includes("time");

  // Entry availability follows the ACTIVE BLOCK'S CAPABILITIES, not a selection left
  // over from a previous exercise. Auto Capture is a time path; a block that measures
  // no time cannot use it, so it falls back to manual entry rather than rendering
  // neither surface. `entryMode` itself is deliberately NOT mutated here — the
  // athlete's preference is remembered for the next block that can honour it, and
  // nothing is written during render.
  const effectiveEntryMode: "manual" | "auto" = activeBlockMeasuresTime
    ? entryMode
    : "manual";
  // The identity a manual draft belongs to. A draft typed for one exercise is only
  // ever shown while this key still matches; it is never carried into the next one.
  const manualDraftOwnerKey = activeBlock
    ? `${athleteProfileId}:${currentSession.id}:${activeBlock.id}`
    : null;
  const ownedManualDraft =
    manualEntryDraft && manualEntryDraft.ownerKey === manualDraftOwnerKey
      ? manualEntryDraft
      : null;
  // Every operation that belongs to the CURRENT session, and to the exercise whose
  // entry control is on screen. Scoping both ways is what stops a failed stone from a
  // finished training reappearing in the next one, and stops a "saved" confirmation
  // from one exercise showing inside another that has recorded nothing.
  const sessionManualSubmissions = manualSubmissions.filter(
    (submission) =>
      submission.sessionId === currentSession.id &&
      submission.profileId === athleteProfileId
  );
  const ownerManualSubmissions = sessionManualSubmissions.filter(
    (submission) => submission.ownerKey === manualDraftOwnerKey
  );

  // The numbers on screen belong to a stone already accepted, and are shown only so a
  // failed write stays recoverable. Carried by the draft itself rather than inferred
  // from the submission list, because choosing a handle for the next stone mints a new
  // revision and must not turn a recorded stone's values back into fresh input.
  const draftMeasurementsAreRetained =
    ownedManualDraft !== null && ownedManualDraft.retainedRevision !== null;
  // A draft is unsaved WORK only while its measurements are the athlete's own and not
  // yet submitted. Prompting to discard a stone they already recorded, merely because
  // its write has not settled, would put a dialog in front of every ordinary
  // transition.
  const hasUnsavedManualDraft =
    !draftMeasurementsAreRetained &&
    ownedManualDraft !== null &&
    (ownedManualDraft.time.trim() !== "" ||
      ownedManualDraft.speed.trim() !== "");

  // Every stone of the CURRENT training still missing a measurement, in EVERY block —
  // not only the active one. A stone left half-measured in an earlier exercise of the
  // same training stays reachable after moving on; archived sessions do not (that
  // would be general historical editing, which this is deliberately not).
  //
  // `blockPosition` is the exercise's place in this training. Default block names
  // repeat, so name, stone number, handle and value together still do not guarantee
  // two rows differ — the sequence does, without requiring the athlete to have named
  // anything or exposing an identifier that means nothing to them.
  const incompleteSessionShots: IncompleteShotEntry[] = currentSession.blocks.flatMap(
    (block, index) =>
      findIncompleteShots(currentSession, block.id).map((entry) => ({
        ...entry,
        blockId: block.id,
        blockName: block.name,
        blockPosition: index + 1,
      }))
  );

  // Outstanding completions and the acknowledgement belong to the training they were
  // made in. Without this scoping, a failure from a training that has since been
  // finished kept its Retry row — and its own measurement had already been archived
  // successfully — inside a brand-new training it has nothing to do with.
  const sessionPendingCompletions = pendingCompletions.filter(
    (entry) => entry.sessionId === currentSession.id
  );
  const sessionCompletionConfirmation =
    completionConfirmation && completionConfirmation.sessionId === currentSession.id
      ? completionConfirmation
      : null;

  // A completion draft counts as unsaved work only when it is typed AND still points
  // at a stone that is genuinely still missing that measurement.
  const hasUnsavedCompletionDraft = incompleteSessionShots.some((entry) =>
    entry.missing.some((quantity) => {
      const key = completionKey({
        sessionId: entry.shot.sessionId,
        blockId: entry.blockId,
        shotId: entry.shot.id,
        quantity,
      });
      return (completionDrafts[key] ?? "").trim() !== "";
    })
  );

  // The tolerance this block's time measurements were actually judged against. For a
  // legacy block that is its symmetric pair, unchanged; for a measurement-aware block
  // it is the block's own, possibly asymmetric, per-side tolerance. Everything on this
  // screen classifies through it, so Live Performance can never disagree with history
  // aggregation about whether one stone was a Major Miss.
  const activeBlockTimeTolerance =
    activeBlock && activeBlockAccuracyThresholds
      ? blockTolerance(activeBlock, "time") ??
        toleranceFromAccuracyThresholds(activeBlockAccuracyThresholds)
      : null;
  const activeBlockAnalysis = activeBlock && activeBlockTimeTolerance
    ? analyzeShots(filteredActiveBlockShots, activeBlockTimeTolerance)
    : null;
  // Whichever capture path is actually in progress is the screen's Hero; the
  // other stays available as a Primary (non-Hero) fallback (Epic 1: exactly
  // one Hero per screen — see docs/DESIGN_SYSTEM.md §10.1).
  const autoCaptureIsActive = isCaptureSequenceActive(
    currentSession.captureSequence
  );

  // Manual release-time entry is only meaningful against a time target. A block
  // that measures no time offers none, rather than a substituted default.
  const nextShotTarget = activeBlock ? getNextShotTarget(activeBlock) : undefined;
  const shotEntryTarget: ShotEntryTarget | null =
    activeBlock && nextShotTarget !== undefined
    ? {
        value: nextShotTarget,
        editable:
          (activeBlock.mode === "variable" &&
            activeBlock.variableTargetMode === "manual") ||
          (activeBlock.mode === "blind" &&
            activeBlock.blindTargetMode === "manual"),
        autoGenerated:
          (activeBlock.mode === "variable" &&
            activeBlock.variableTargetMode === "smart-random") ||
          (activeBlock.mode === "blind" &&
            activeBlock.blindTargetMode === "smart-random"),
      }
    : null;

  // --- Training Plan execution (derived, never separately persisted UI
  // state — see ADR-0012). isPlanExecutionActive is false whenever the
  // athlete has navigated away from the plan's current block (e.g. manually
  // started a new Training Block instead of the plan's own controls) — the
  // plan progress/controls UI simply stops rendering in that case rather than
  // guessing which block it should apply to.
  const planExecution = currentSession.planExecution;
  const isTrainingPlanActive = planExecution
    ? isPlanExecutionActive(currentSession, planExecution)
    : false;
  const activePlanStepSnapshot =
    planExecution && isTrainingPlanActive
      ? getActiveStepSnapshot(planExecution)
      : undefined;
  const activePlanRuntime = activePlanStepSnapshot?.runtime;
  const activePlanExerciseExecution =
    activePlanRuntime?.kind === "exercise-execution"
      ? currentSession.exerciseExecutions?.find(
          (execution) =>
            execution.id === activePlanRuntime.exerciseExecutionId
        )
      : undefined;
  const displayedExerciseExecution =
    activeExerciseExecution ??
    activePlanExerciseExecution ??
    (viewingExerciseExecutionId
      ? currentSession.exerciseExecutions?.find(
          (execution) => execution.id === viewingExerciseExecutionId
        )
      : undefined);
  const trainingPlanProgressSummary =
    planExecution && isTrainingPlanActive
      ? getPlanProgressSummary(currentSession, planExecution)
      : null;
  // Undefined on the final step, which is what structurally removes the Next
  // Exercise control there — it is never merely disabled or relabelled.
  const nextPlanStepLabel =
    planExecution && hasNextPlanStep(planExecution)
      ? trainingPlanStepTitle(
          planExecution.steps[planExecution.activeStepIndex + 1].step
        )
      : undefined;
  // Preselected (never locked) handle for the next shot — undefined means
  // Free, today's unchanged behavior. Re-derived every render from the
  // number of shots already saved in this step's block, so it always follows
  // the plan's own sequence regardless of any prior one-shot override.
  const shotEntryPresetHandle =
    isTrainingPlanActive && activePlanStepSnapshot &&
    isReleaseTimingPlanStep(activePlanStepSnapshot.step)
      ? resolveExpectedHandle(
          activePlanStepSnapshot.step.handleStrategy,
          activeBlockShots.length
        )
      : undefined;

  // What the NEXT stone starts from: the handle the plan's strategy now expects and
  // whatever target currently applies. Both are derived from the stones recorded so
  // far, so they are already correct the moment a stone is accepted — without waiting
  // for its write.
  const nextStoneDefaults = {
    handle: shotEntryPresetHandle ?? "in",
    targetOverride: shotEntryTarget ? editableNumber(shotEntryTarget.value) : "",
  };

  const manualEntryDraftForOwner: ShotEntryDraft = !ownedManualDraft
    ? { ...EMPTY_SHOT_ENTRY_DRAFT, ...nextStoneDefaults }
    : ownedManualDraft.retainedRevision === ownedManualDraft.revision
      ? {
          // Submitted, and untouched since. Its MEASUREMENTS stay on screen until the
          // write settles, so a failure is recoverable and nothing is called saved
          // early...
          time: ownedManualDraft.time,
          speed: ownedManualDraft.speed,
          // ...but everything that describes the NEXT stone is seeded fresh. Carrying
          // the recorded stone's handle forward meant a second stone entered before
          // the first write acknowledged inherited it, so an alternating plan step
          // recorded In, In instead of In, Out.
          shotType: EMPTY_SHOT_ENTRY_DRAFT.shotType,
          ...nextStoneDefaults,
        }
      : {
          // Either still unsubmitted, or submitted and since given an explicit handle,
          // shot type or target for the next stone. Both are the athlete's own intent,
          // and nothing — an unrelated device result, a later acknowledgement — may
          // rewrite it.
          time: ownedManualDraft.time,
          speed: ownedManualDraft.speed,
          handle: ownedManualDraft.handle,
          shotType: ownedManualDraft.shotType,
          targetOverride: ownedManualDraft.targetOverride,
        };


  // Single available Training Category/Measurement Mode is auto-selected;
  // multiple options keep whatever was previously chosen (persisted above) or
  // fall back to the first available one — never "no selection", which would
  // silently let incompatible categories/modes mix in Progress/Scatterplot.
  // Computed here (not via an effect writing back into state) since this is
  // plain derived data — an explicit user choice from HistoryFilterBar is
  // what actually updates `historyFilters` and gets persisted.
  const effectiveTrainingCategory = resolveDefaultTrainingCategory(
    getAvailableTrainingCategories(sessionHistory),
    historyFilters.trainingCategory
  );
  const effectiveMeasurementMode = resolveDefaultMeasurementMode(
    getAvailableMeasurementModes(sessionHistory, effectiveTrainingCategory),
    historyFilters.measurementMode
  );
  const effectiveMeasuredQuantity = resolveDefaultMeasuredQuantity(
    getAvailableMeasuredQuantities(sessionHistory, effectiveTrainingCategory),
    historyFilters.measuredQuantity
  );
  const effectiveHistoryFilters: HistoryAnalysisFilters = {
    ...historyFilters,
    trainingCategory: effectiveTrainingCategory,
    measuredQuantity: effectiveMeasuredQuantity,
    measurementMode: effectiveMeasurementMode,
  };

  // The one central History selection every History analytics surface reads
  // from — see docs/SYSTEM_ARCHITECTURE.md's "Central History filter
  // pipeline". No History chart/card is allowed to filter sessionHistory on
  // its own.
  const historyAnalysisContext = buildHistoryAnalysisContext(
    sessionHistory,
    effectiveHistoryFilters
  );
  const historyTargetAccuracy = aggregateTargetAccuracyAcrossBlocks(
    historyAnalysisContext.blocks
  );
  // Analyze's opening "what should I learn" sentence — computed only from
  // the same selection every other History surface reads from, never a
  // separate query (Epic 2: insight before raw metrics).
  const trainingInsight = buildTrainingInsight(historyAnalysisContext.blocks);
  // Categorizing rollup: uses the per-side tolerance, so a uniform asymmetric
  // selection is judged as it was actually trained. `historyThresholds` stays what it
  // has always been — a display-only representative pair for labels and bands.
  const historyTimeTolerance = representativeTimeTolerance(
    historyAnalysisContext.blocks
  );

  // --- Analyze's selected measurement governs its figures --------------------------
  //
  // Narrowing the selection to Speed previously narrowed only WHICH BLOCKS were
  // included; every figure above still came from the time pipeline, so a Both block
  // was summarised with its seconds Average Error, seconds tolerance labels and a
  // Back-Hog weight tendency while the athlete was explicitly looking at m/s.
  //
  // With no explicit selection ("All measurements") the view must represent the
  // quantities the selection ACTUALLY contains, each on its own terms. Defaulting to
  // time instead meant a speed-only history reported "Target Accuracy / Not enough
  // shots" — an empty time result for training that measured no time — while offering
  // no selector through which to reach its speed figures, because a single available
  // quantity is deliberately not auto-selected.
  const historySelectedQuantities: MeasuredQuantity[] = effectiveHistoryFilters
    .measuredQuantity
    ? [effectiveHistoryFilters.measuredQuantity]
    : MEASURED_QUANTITIES.filter((quantity) =>
        historyAnalysisContext.blocks.some((entry) =>
          entry.shots.some((shot) => shotMeasures(shot, quantity))
        )
      );
  // An empty selection keeps its existing time-shaped empty state rather than
  // rendering nothing at all.
  const historyQuantities: MeasuredQuantity[] =
    historySelectedQuantities.length > 0 ? historySelectedQuantities : ["time"];
  const historyShowsTime = historyQuantities.includes("time");
  // Seconds and m/s are shown as separate, separately labelled groups whenever both
  // are present; they are never merged into one figure.
  const historyLabelsQuantities = historyQuantities.length > 1;

  // One tolerance may stand for the whole selection only when every block that
  // records speed was judged against the same one; otherwise no single cutoff is true
  // of all of them and none is named.
  const historySpeedTolerances = historyAnalysisContext.blocks
    .map((entry) => blockTolerance(entry.block, "speed"))
    .filter((tolerance): tolerance is QuantityTolerance => tolerance !== undefined);
  const historySpeedTolerance =
    historySpeedTolerances.length > 0 &&
    historySpeedTolerances.every(
      (tolerance) =>
        JSON.stringify(tolerance) === JSON.stringify(historySpeedTolerances[0])
    )
      ? historySpeedTolerances[0]
      : null;

  // Each block is judged against ITS OWN snapshot and then aggregated, so a selection
  // spanning different tolerances is still counted the way each block was trained.
  const historySpeedAccuracy = aggregateQuantityAccuracyAcrossBlocks(
    historyAnalysisContext.blocks,
    "speed"
  );
  const historyFullAnalysis = analyzeShots(
    historyAnalysisContext.shots,
    historyTimeTolerance
  );
  const historyScatterPoints = prepareTargetVsActualScatterData(
    historyAnalysisContext.shots,
    historyAnalysisContext.blocksById,
    historyAnalysisContext.sessionContextByBlockId
  );
  const historyScatterNotices: string[] = [];
  if (historyAnalysisContext.totalShotCount > 0 && historyAnalysisContext.totalShotCount < 8) {
    historyScatterNotices.push(
      `Only ${historyAnalysisContext.totalShotCount} shots are selected. Treat visible patterns as early indications.`
    );
  }
  if (historyAnalysisContext.availableHandles.length === 1) {
    historyScatterNotices.push(
      `Only ${historyAnalysisContext.availableHandles[0] === "in" ? "In" : "Out"} handle is available in this selection.`
    );
  }
  if (historyAnalysisContext.sessionIds.length > 1) {
    historyScatterNotices.push(
      `Points combine shots from ${historyAnalysisContext.totalBlockCount} blocks across ${historyAnalysisContext.sessionIds.length} sessions.`
    );
  }

  // Sessions grouped from the already-filtered block selection (not the raw
  // sessionHistory) — the "Blocks and Sessions" list is a detail/navigation
  // view onto the same central selection, never an independently-filtered one.
  const historySessionGroups = Array.from(
    historyAnalysisContext.blocks
      .reduce((map, entry) => {
        const existing = map.get(entry.session.id);
        if (existing) {
          existing.entries.push(entry);
        } else {
          map.set(entry.session.id, { session: entry.session, entries: [entry] });
        }
        return map;
      }, new Map<string, { session: Session; entries: typeof historyAnalysisContext.blocks }>())
      .values()
  )
    .filter((group) => group.entries.some((entry) => entry.shots.length > 0))
    .sort(
      (a, b) => new Date(b.session.date).getTime() - new Date(a.session.date).getTime()
    );

  function handleChangeActiveBlockTargetTime(newTargetTime: number) {
    if (sessionHydration !== "ready") return;

    setCurrentSession((session) => {
      if (!session) return session;

      return {
        ...session,
        blocks: session.blocks.map((block) =>
          block.id === session.activeBlockId
            ? retargetBlockTime(block, newTargetTime)
            : block
        ),
      };
    });
  }

  /**
   * Moves a block's time target to a new value, keeping BOTH representations of that
   * one target in step.
   *
   * There is exactly one time-target authority (ADR-0051): when a block carries a
   * measurement configuration, `measurement.time.target` is it and `targetTime`
   * mirrors it. Updating only `targetTime` would leave the block showing 4.00 while
   * the configuration still said 3.75 — a contradiction strict validation rightly
   * refuses, which would make every later save of that session fail.
   *
   * Only the TARGET moves. Tolerances, measured quantities and every already-recorded
   * stone's own `targetTime` are untouched, so no historical judgement changes — this
   * is the existing Fixed/Blind target edit, not new mid-block editing of the
   * measurement configuration itself.
   */
  function retargetBlockTime(
    block: TrainingBlock,
    newTargetTime: number
  ): TrainingBlock {
    const configuration = block.measurement;
    if (!configuration?.time) {
      return { ...block, targetTime: newTargetTime };
    }

    return {
      ...block,
      targetTime: newTargetTime,
      measurement: {
        ...configuration,
        time: { ...configuration.time, target: newTargetTime },
      },
    };
  }

  function handleChangeSessionTitle(title: string) {
    if (sessionHydration !== "ready") return;

    setCurrentSession((session) => {
      if (!session) return session;

      return {
        ...session,
        title,
      };
    });
  }

  function handleChangeSessionNotes(notes: string) {
    if (sessionHydration !== "ready") return;

    setCurrentSession((session) => {
      if (!session) return session;

      return {
        ...session,
        notes,
      };
    });
  }

  /**
   * Records ONE stone from whatever measurements the entry control actually gathered.
   *
   * One structured input rather than a positional time-first signature, because a
   * stone may now legitimately carry a time, a speed, or both — and because there
   * must remain exactly ONE path that appends a stone. A second "speed save" handler
   * beside this one would race the same queue, the same authoritative Session mirror
   * and the same transition guards (ADR-0007).
   */
  function handleAddShot(input: AddShotInput): boolean {
    // Returns whether the stone was actually accepted, so the entry control knows
    // whether it may clear the athlete's input. A refusal must never look like a save.
    if (sessionHydration !== "ready") return false;
    // A terminal Session transition has already chosen which stones it is archiving;
    // one accepted now would be counted on screen and then dropped. Refused rather
    // than accepted-and-lost — the entry field keeps its value for an immediate retry.
    if (sessionTransitionPendingRef.current) return false;

    // Computed synchronously from the authoritative mirror rather than inside a
    // setState updater, so the accept/refuse answer this returns is the real one
    // instead of an optimistic guess the updater might later contradict.
    const session = sessionRef.current;
    if (!session) return false;

    const currentActiveBlock = getActiveBlock(session);
    if (!currentActiveBlock) return false;

    const ownerKey = `${athleteProfileId}:${session.id}:${currentActiveBlock.id}`;
    const draft =
      input.usesSharedDraft && manualEntryDraft?.ownerKey === ownerKey
        ? manualEntryDraft
        : null;
    // `null` means "this stone has no shared-draft revision to be identified by" —
    // not "revision zero". A caller that owns its own draft (BlindShotEntry) would
    // otherwise have every submission share one identity, so the second stone would be
    // refused as a duplicate of the first for as long as that first one stayed
    // outstanding after a failed write.
    const submittedRevision: number | null = draft?.revision ?? null;

    // Idempotency lives HERE, in parent state, not in a signature inside the entry
    // control. The shared draft is no longer cleared on acceptance, so pressing the
    // action twice must not record the stone twice — and a control-local guard cannot
    // help, because it is lost the moment the control remounts (leaving Train and
    // coming back is enough).
    //
    // What the FIELDS hold decides this, not the revision alone. A draft whose
    // measurements are still a submitted stone's retained recovery values carries
    // nothing new to record, however much metadata has been chosen since; recording it
    // would append a second stone holding the first one's numbers. That stone's own
    // Retry is what saves it. Re-entering a measurement clears the retained marking,
    // so two successive stones with identical values remain possible.
    if (draft !== null && draft.retainedRevision !== null) return false;

    // Read from the authoritative mirror, not from render state: the submission a
    // previous press added is written there synchronously (ADR-0007), so a second
    // press that has not yet been re-rendered still sees it.
    if (
      submittedRevision !== null &&
      manualSubmissionsRef.current.some(
        (submission) =>
          submission.ownerKey === ownerKey &&
          submission.revision === submittedRevision
      )
    ) {
      return false;
    }

    // A previous refusal is cleared before this attempt is judged, so a stale message
    // can never sit beside a stone that has just been accepted.
    setShotEntryError(null);

    const { quantities } = resolveBlockMeasurement(currentActiveBlock);

    // Each measurement is paired HERE with the target it will be judged against, and
    // the pair is what gets stored. A measurement whose target cannot be resolved is
    // not recorded at all rather than saved against an invented one.
    const targetTime = computeShotTarget(
      currentActiveBlock,
      input.targetTimeOverride
    );
    const recordsTime =
      input.releaseTime !== undefined &&
      quantities.includes("time") &&
      targetTime !== undefined;

    const targetSpeed = blockQuantityTarget(currentActiveBlock, "speed");
    const recordsSpeed =
      input.speed !== undefined &&
      quantities.includes("speed") &&
      targetSpeed !== undefined;

    // Something was offered that this block cannot judge — a release time for a
    // speed-only exercise, or a speed for a time-only one. Refusing is the only safe
    // answer: accepting it would silently drop the value the athlete typed.
    if (input.releaseTime !== undefined && !recordsTime) return false;
    if (input.speed !== undefined && !recordsSpeed) return false;

    const outcome = buildMeasuredShot(currentActiveBlock, {
      id: crypto.randomUUID(),
      sessionId: session.id,
      blockId: currentActiveBlock.id,
      shotNumber: getNextShotNumberInBlock(session, currentActiveBlock.id),
      handle: input.handle,
      shotType: input.shotType,
      createdAt: new Date().toISOString(),
      ...(recordsTime
        ? { time: { value: input.releaseTime as number, target: targetTime as number } }
        : {}),
      ...(recordsSpeed
        ? {
            speed: {
              value: input.speed as number,
              target: targetSpeed as number,
              // The provenance IS known here: this path is manual entry, and nothing
              // else reaches it. Recording it keeps speed's source independent of the
              // time value's, which may well have come from a device on the same stone.
              source: "manual" as const,
            },
          }
        : {}),
      ...(input.predictedTime !== undefined
        ? { predictedTime: input.predictedTime }
        : {}),
    });

    if (!outcome.ok) {
      // A domain refusal (no real measurement, a value outside the valid range) is
      // surfaced rather than swallowed, so a refused stone can never read as saved.
      setShotEntryError(outcome.error.message);
      return false;
    }

    const recentTargets = getBlockShots(session, currentActiveBlock.id)
      .map((shot) => shot.targetTime)
      .filter((target): target is number => target !== undefined);

    // Only a recorded TIME advances a Variable/Blind block's pending target — that
    // sequence is a property of the time target, and a speed entry must not step it.
    const updatedBlock = recordsTime
      ? advanceBlockTarget(
          currentActiveBlock,
          targetTime as number,
          recentTargets
        )
      : currentActiveBlock;

    const committed: Session = {
      ...session,
      shots: [...session.shots, outcome.value],
      blocks: session.blocks.map((block) =>
        block.id === updatedBlock.id ? updatedBlock : block
      ),
    };

    const savedShotId = outcome.value.id;
    const operationId = crypto.randomUUID();
    const submission: ManualSubmission = {
      operationId,
      ownerKey,
      profileId: athleteProfileId,
      sessionId: session.id,
      blockId: currentActiveBlock.id,
      shotId: savedShotId,
      description: `${currentActiveBlock.name} stone ${outcome.value.shotNumber}`,
      revision: submittedRevision,
      status: "pending",
    };

    commitSession(committed);

    // ACCEPTED is not SAVED. The stone is in the session and will be written, but the
    // athlete's typed values stay exactly where they are until storage acknowledges
    // it — clearing them now would lose the measurement outright on a failed write,
    // with nothing on screen to say so. The submission is tracked as its own
    // operation, so a second stone started before this one settles has its own
    // identity, its own status and its own retry.
    commitManualSubmissions((current) => [...current, submission]);

    // Those values are now THIS stone's, not input for the next one. Recorded against
    // the revision just submitted, because a later metadata edit mints a new revision
    // and would otherwise leave the draft indistinguishable from freshly typed input.
    if (submittedRevision !== null) {
      setManualEntryDraft((current) =>
        current &&
        current.ownerKey === ownerKey &&
        current.revision === submittedRevision
          ? { ...current, retainedRevision: submittedRevision }
          : current
      );
    }

    registerSessionPersistenceAck(
      committed,
      // Only a write that actually carries THIS stone may speak for it. An older or
      // unrelated successful write says nothing about it.
      (written) =>
        written.id === committed.id &&
        written.shots.some((shot) => shot.id === savedShotId),
      (ack) => settleManualSubmission(submission, ack)
    );

    return true;
  }

  /**
   * Applies one write acknowledgement to ONE manual submission.
   *
   * Everything it touches is addressed by that submission's own identity. An older
   * acknowledgement therefore cannot clear a newer submission's retry target, replace
   * its status, or erase a draft revision it never described.
   */
  function settleManualSubmission(
    submission: ManualSubmission,
    ack: SessionPersistenceAck
  ): void {
    if (ack.status === "persisted") {
      commitManualSubmissions((current) =>
        current.filter((entry) => entry.operationId !== submission.operationId)
      );
      setLastAcknowledgedShot({
        ownerKey: submission.ownerKey,
        operationId: submission.operationId,
      });
      // Settled ONLY against the exact owner and revision this acknowledgement
      // describes. Anything the athlete has typed since belongs to a later revision
      // and is none of this acknowledgement's business.
      setManualEntryDraft((draft) =>
        settleManualDraftAfterDurableWrite(draft, [submission])
      );
      return;
    }

    const message =
      ack.status === "superseded"
        ? "This training moved on before that stone was saved. Check the shot list before recording it again."
        : "That shot could not be saved yet. It is still here — try saving again.";

    commitManualSubmissions((current) =>
      current.map((entry) =>
        entry.operationId === submission.operationId
          ? { ...entry, status: "failed", message }
          : entry
      )
    );
  }

  /**
   * Re-persists one accepted-but-unsaved stone, addressed by its operation id.
   *
   * Deliberately re-saves the CURRENT authoritative session rather than re-running the
   * recording operation: the stone already exists in it, so recording again would
   * append a second one. Saving the current session also carries anything recorded
   * since, so a retry never rolls newer work back.
   */
  function retryManualSubmission(operationId: string): void {
    const submission = manualSubmissions.find(
      (entry) => entry.operationId === operationId
    );
    const target = sessionRef.current;
    if (!submission || !target) return;

    if (
      target.id !== submission.sessionId ||
      !target.shots.some((shot) => shot.id === submission.shotId)
    ) {
      // The stone is gone, or this is a different training now. Claiming a successful
      // retry here would be untrue.
      commitManualSubmissions((current) =>
        current.map((entry) =>
          entry.operationId === operationId
            ? {
                ...entry,
                status: "failed",
                message:
                  "That stone is no longer part of this training, so it could not be saved.",
              }
            : entry
        )
      );
      return;
    }

    commitManualSubmissions((current) =>
      current.map((entry) =>
        entry.operationId === operationId
          ? { ...entry, status: "pending", message: undefined }
          : entry
      )
    );

    registerSessionPersistenceAck(
      target,
      (written) =>
        written.id === target.id &&
        written.shots.some((shot) => shot.id === submission.shotId),
      (ack) => settleManualSubmission(submission, ack)
    );

    // `settleSessionSaveWaiters` is what resolves the acknowledgement registered
    // above. The ordinary save effect calls it for its own writes; a write issued
    // directly here must do the same, or a successful retry would sit forever as
    // "Saving…".
    void runSessionWrite(() => sessionRepository.saveCurrent(target))
      .then((result) => settleSessionSaveWaiters(target, result))
      .catch(() =>
        // A THROWN write is a failure like any other, not an unhandled rejection that
        // leaves the athlete with no outcome at all.
        settleSessionSaveWaiters(target, {
          ok: false,
          error: { kind: "unknown", message: "The save did not complete." },
        })
      );
  }

  /**
   * Adds ONE missing measurement to ONE explicitly identified stone, and resolves
   * only once a write has actually acknowledged it.
   *
   * The identity is supplied in full — session, block and shot — and is checked
   * against the authoritative Session mirror at the moment the change is computed,
   * not against whatever was on screen when the athlete started typing. A completion
   * prepared for one stone therefore cannot land on another, and one prepared under a
   * previous Profile or Session cannot mutate the current one: the session no longer
   * matches, and the attempt is refused rather than silently retargeted.
   */
  async function handleCompleteShotMeasurement(
    request: CompletionRequest
  ): Promise<CompletionOutcome> {
    if (sessionHydration !== "ready") {
      return {
        status: "rejected",
        message: "This training isn't ready to accept changes yet.",
      };
    }

    // A terminal transition has already chosen what it is archiving; a completion
    // accepted now would be shown and then dropped.
    if (sessionTransitionPendingRef.current) {
      return {
        status: "rejected",
        message: "This training is being saved. Try again in a moment.",
      };
    }

    const session = sessionRef.current;

    // The request's OWN identity is validated against current ownership. The block is
    // the one the athlete selected, never "whichever block happens to be active" —
    // by the time a completion runs the athlete may well have moved on, and
    // reconstructing the target from the active block would land the value on a
    // different stone entirely.
    if (!session || session.id !== request.sessionId) {
      return {
        status: "rejected",
        message: "That stone belongs to a different training.",
      };
    }

    const blockPosition =
      session.blocks.findIndex((candidate) => candidate.id === request.blockId) + 1;
    const block = session.blocks.find(
      (candidate) => candidate.id === request.blockId
    );
    if (!block) {
      return {
        status: "rejected",
        message: "That exercise is no longer part of this training.",
      };
    }

    const shot = session.shots.find((candidate) => candidate.id === request.shotId);

    const outcome = completeShotMeasurement(session, {
      sessionId: request.sessionId,
      blockId: request.blockId,
      shotId: request.shotId,
      quantity: request.quantity,
      value: request.value,
      // Known provenance, recorded rather than left blank. The OTHER quantity's
      // source is untouched by completeShotMeasurement, so a device-captured time
      // keeps its own attribution on the same stone.
      source: "manual",
      recordedAt: new Date().toISOString(),
    });

    if (!outcome.ok) {
      return { status: "rejected", message: outcome.error.message };
    }

    const completed = outcome.value.session;
    const key = completionKey(request);
    const descriptor: Omit<PendingCompletion, "status" | "message"> = {
      key,
      sessionId: request.sessionId,
      blockId: request.blockId,
      blockName: block.name,
      blockPosition,
      shotId: request.shotId,
      shotNumber: shot?.shotNumber ?? outcome.value.shot.shotNumber,
      handle: outcome.value.shot.handle,
      quantity: request.quantity,
      value: request.value,
    };

    // Accepted into the session, but NOT yet durable. Tracked explicitly so the stone
    // stays visible and retryable even though the domain no longer reports it as
    // incomplete — otherwise a failed write would make both the stone and the typed
    // value disappear with nothing to retry.
    commitPendingCompletions((current) => [
      ...current.filter((entry) => entry.key !== key),
      { ...descriptor, status: "pending" },
    ]);
    setCompletionConfirmation(null);
    commitSession(completed);

    return new Promise<CompletionOutcome>((resolve) => {
      registerSessionPersistenceAck(
        completed,
        // The write only speaks for this completion if it wrote THIS session and the
        // stone in it genuinely carries the measurement that was just added.
        (written) =>
          written.id === completed.id &&
          written.shots.some(
            (candidate) =>
              candidate.id === request.shotId &&
              shotMeasures(candidate, request.quantity)
          ),
        (ack) => {
          if (ack.status === "persisted") {
            commitPendingCompletions((current) =>
              current.filter((entry) => entry.key !== key)
            );
            // Cleared by KEY, so an acknowledgement for one stone can never clear a
            // draft the athlete has since typed for a different one.
            setCompletionDrafts((current) => {
              if (!(key in current)) return current;
              const next = { ...current };
              delete next[key];
              return next;
            });
            setCompletionSelection((current) =>
              current && completionKey(current) === key ? null : current
            );
            setCompletionConfirmation({
              sessionId: descriptor.sessionId,
              blockName: descriptor.blockName,
              blockPosition: descriptor.blockPosition,
              shotNumber: descriptor.shotNumber,
              quantity: descriptor.quantity,
              value: descriptor.value,
            });
            resolve({ status: "persisted" });
            return;
          }

          const message =
            ack.status === "superseded"
              ? "This training moved on before that measurement was saved."
              : "That measurement could not be saved yet.";

          commitPendingCompletions((current) =>
            current.map((entry) =>
              entry.key === key ? { ...entry, status: "failed", message } : entry
            )
          );
          resolve(
            ack.status === "superseded"
              ? { status: "superseded", message }
              : { status: "failed", message }
          );
        }
      );
    });
  }

  /**
   * Re-persists an accepted-but-unsaved completion.
   *
   * Re-running `completeShotMeasurement` would be wrong: the value is already on the
   * stone in the current session, so the domain correctly refuses it as
   * `already_recorded` — a rejection that can never make the existing value durable.
   * What actually needs retrying is the WRITE, against the current authoritative
   * session, which also carries anything recorded since.
   */
  function retryCompletionSave(key: string): void {
    const attempt = pendingCompletions.find((entry) => entry.key === key);
    const target = sessionRef.current;
    if (!attempt || !target) return;

    if (
      target.id !== attempt.sessionId ||
      !target.shots.some(
        (shot) =>
          shot.id === attempt.shotId && shotMeasures(shot, attempt.quantity)
      )
    ) {
      // The completion is no longer present to persist — a different session, or the
      // value is gone. Reporting success here would be untrue.
      commitPendingCompletions((current) =>
        current.map((entry) =>
          entry.key === key
            ? {
                ...entry,
                status: "failed",
                message:
                  "That stone is no longer part of this training, so the measurement could not be saved.",
              }
            : entry
        )
      );
      return;
    }

    commitPendingCompletions((current) =>
      current.map((entry) =>
        entry.key === key
          ? { ...entry, status: "pending", message: undefined }
          : entry
      )
    );

    registerSessionPersistenceAck(
      target,
      (written) =>
        written.id === target.id &&
        written.shots.some(
          (shot) =>
            shot.id === attempt.shotId && shotMeasures(shot, attempt.quantity)
        ),
      (ack) => {
        if (ack.status === "persisted") {
          commitPendingCompletions((current) =>
            current.filter((entry) => entry.key !== key)
          );
          setCompletionDrafts((current) => {
            if (!(key in current)) return current;
            const next = { ...current };
            delete next[key];
            return next;
          });
          setCompletionConfirmation({
            sessionId: attempt.sessionId,
            blockName: attempt.blockName,
            blockPosition: attempt.blockPosition,
            shotNumber: attempt.shotNumber,
            quantity: attempt.quantity,
            value: attempt.value,
          });
          return;
        }
        commitPendingCompletions((current) =>
          current.map((entry) =>
            entry.key === key
              ? {
                  ...entry,
                  status: "failed",
                  message: "That measurement still could not be saved.",
                }
              : entry
          )
        );
      }
    );

    void runSessionWrite(() => sessionRepository.saveCurrent(target))
      .then((result) => settleSessionSaveWaiters(target, result))
      .catch(() =>
        settleSessionSaveWaiters(target, {
          ok: false,
          error: { kind: "unknown", message: "The save did not complete." },
        })
      );
  }

  function handleStartCaptureSequence(config: AutoCaptureStartConfig) {
    if (sessionHydration !== "ready") return;

    const session = sessionRef.current;
    if (!session || !activeBlock) return;

    if (isAssessmentCaptureActive()) {
      alert(
        "An Assessment Run is currently active. Pause or finish it in Assess before starting Auto Capture in Training."
      );
      return;
    }

    try {
      const newSequence = startCaptureSequence(
        createCaptureSequence({
          session,
          block: activeBlock,
          expectedShotCount: config.expectedShotCount,
          providerType: "simulator",
          handleMode: config.handleMode,
          startHandle: config.startHandle,
          shotType: config.shotType,
        })
      );

      setCaptureManualHandle(config.startHandle);
      setCaptureManualTargetInput(
        getNextShotTarget(activeBlock)?.toFixed(2) ?? ""
      );
      setLastCaptureMessage(undefined);
      setCaptureDiagnostics([]);

      commitSession({ ...session, captureSequence: newSequence });
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Could not start Auto Capture."
      );
    }
  }

  function handlePauseCaptureSequence() {
    if (sessionHydration !== "ready") return;

    const session = sessionRef.current;
    if (!session || !session.captureSequence) return;

    commitSession({
      ...session,
      captureSequence: pauseCaptureSequence(session.captureSequence),
    });
  }

  function handleResumeCaptureSequence() {
    if (sessionHydration !== "ready") return;

    const session = sessionRef.current;
    if (!session || !session.captureSequence) return;

    commitSession({
      ...session,
      captureSequence: resumeCaptureSequence(session.captureSequence),
    });
  }

  function handleCancelCaptureSequence() {
    if (sessionHydration !== "ready") return;

    setConfirmAction({
      title: "Cancel Auto Capture?",
      message:
        "Already captured shots will remain in the training. No half-finished result will be saved.",
      confirmLabel: "Cancel Capture",
      isDanger: true,
      onConfirm: () => {
        const session = sessionRef.current;

        if (session?.captureSequence) {
          commitSession({
            ...session,
            captureSequence: {
              ...session.captureSequence,
              status: "cancelled",
              cancelledAt: new Date().toISOString(),
            },
          });
        }

        setConfirmAction(null);
      },
    });
  }

  function handleUndoLastCapturedShot() {
    if (sessionHydration !== "ready") return;

    const session = sessionRef.current;
    if (!session || !session.captureSequence) return;

    const currentActiveBlock = getActiveBlock(session);
    if (!currentActiveBlock) return;

    const outcome = undoLastCapturedShot(session.captureSequence, currentActiveBlock);
    if (!outcome) return;

    commitSession({
      ...session,
      shots: session.shots.filter((shot) => shot.id !== outcome.removedShotId),
      blocks: session.blocks.map((block) =>
        block.id === outcome.updatedBlock.id ? outcome.updatedBlock : block
      ),
      captureSequence: outcome.updatedSequence,
    });

    setLastCaptureMessage("Last captured shot undone.");
  }

  function handleManualCaptureResult(value: number) {
    if (sessionHydration !== "ready") return;
    if (!activeBlock) return;
    // A manual fallback reading is still a TIME reading and needs the interval it
    // was measured over; a block without one cannot accept it.
    const measurementMode = activeBlock.measurementMode;
    if (!measurementMode) return;
    processIncomingTimingResult(
      createManualTimingResult(measurementMode, value)
    );
  }

  function handleDeleteShot(shotId: string) {
    if (sessionHydration !== "ready") return;

    setCurrentSession((session) => {
      if (!session) return session;

      const shotToDelete = session.shots.find(
        (shot) => shot.id === shotId
      );

      if (!shotToDelete) return session;

      const remainingShots = session.shots.filter(
        (shot) => shot.id !== shotId
      );

      let nextShotNumber = 0;

      const renumberedShots = remainingShots.map((shot) => {
        if (shot.blockId !== shotToDelete.blockId) {
          return shot;
        }

        nextShotNumber += 1;

        return { ...shot, shotNumber: nextShotNumber };
      });

      return {
        ...session,
        shots: renumberedShots,
      };
    });
  }

  function handleStartEditingShot(shot: Shot) {
    setEditingShot({
      id: shot.id,
      // An empty field for a stone with no recorded time — never "0", which would
      // present a missing measurement as a real one.
      releaseTime: shot.releaseTime?.toString() ?? "",
      handle: shot.handle,
      shotType: shot.shotType,
    });
  }

  function handleSaveEditedShot() {
    if (sessionHydration !== "ready") return;
    if (!editingShot) return;

    const parsedTime = Number(editingShot.releaseTime);

    if (Number.isNaN(parsedTime)) {
      return;
    }

    setCurrentSession((session) => {
      if (!session) return session;

      return {
        ...session,
        shots: session.shots.map((shot) => {
          if (shot.id !== editingShot.id) {
            return shot;
          }

          return {
            ...shot,
            releaseTime: parsedTime,
            handle: editingShot.handle,
            shotType: editingShot.shotType,
          };
        }),
      };
    });

    setEditingShot(null);
  }

  // createTrainingBlock validates the Smart Random / measurement mode
  // combination and throws a clear error for an invalid one. TrainingSetup's
  // own UI already prevents submitting such a combination, so this is only a
  // defensive backstop — but a setCurrentSession updater must never throw,
  // so we validate/construct outside of it first. Accepts NewBlockInput
  // (rather than TrainingSetupValue) so the same defensive path also covers
  // blocks created from a Training Plan Step via
  // mapPlanStepToTrainingBlockInput — every TrainingSetupValue already
  // satisfies NewBlockInput's shape.
  function tryCreateTrainingBlock(value: NewBlockInput) {
    const message = validateTrainingBlockInput(value);
    if (message !== null) {
      alert(message);
      return null;
    }
    return createTrainingBlock(value);
  }

  /**
   * The same defensive pre-validation without the modal: a Training Plan transition
   * runs on the capture queue, where an `alert` would block result processing, and
   * needs the message as a value it can render in the plan controls instead.
   */
  function validateTrainingBlockInput(value: NewBlockInput): string | null {
    try {
      createTrainingBlock(value);
      return null;
    } catch (error) {
      return error instanceof Error
        ? error.message
        : "Could not create this training block.";
    }
  }

  function handleCreateFirstBlock(value: TrainingSetupValue) {
    if (sessionHydration !== "ready") return;

    const block = tryCreateTrainingBlock(value);
    if (!block) return;

    const session = sessionRef.current;
    if (!session) return;
    commitSession({
      ...session,
      blocks: [block],
      activeBlockId: block.id,
      ...(pendingReleaseTimingExerciseVersion
        ? {
            releaseTimingExerciseVersionSnapshot: snapshotExerciseVersion(
              pendingReleaseTimingExerciseVersion
            ),
          }
        : {}),
    });
    setPendingReleaseTimingExerciseVersion(null);
  }

  /** Starts through the runner selected by declared protocol semantics. */
  function handleStartExercise(version: ExerciseVersion): boolean {
    if (sessionHydration !== "ready") return false;

    const runnerKind = exerciseRunnerKind(EXERCISE_CATALOG, version);
    if (runnerKind === "release-timing") {
      setPendingReleaseTimingExerciseVersion(snapshotExerciseVersion(version));
      setPreferredTrainEntryPath("exercises");
      return true;
    }
    if (runnerKind === "unsupported") {
      alert("This Exercise combines Measurements that do not yet share one execution runner.");
      return false;
    }

    return startSoloExercise(version);
  }

  function handleConfirmSoloExerciseStart(): boolean {
    return pendingSoloExerciseVersion ? startSoloExercise(pendingSoloExerciseVersion) : false;
  }

  function startSoloExercise(version: ExerciseVersion): boolean {
    if (sessionHydration !== "ready") return false;
    const session = sessionRef.current;
    if (!session) return false;
    const compatibleProtocols = resolveMeasurementProtocols(
      EXERCISE_CATALOG,
      version.compatibleMeasurementProtocols
    ).map(({ protocol }) => protocol);
    const created = createSoloExerciseExecution(version, {
      trainingSessionId: session.id,
      athleteProfileId,
      enabledMeasurementProtocols: version.primaryFocus === "technique"
        ? []
        : compatibleProtocols.filter(
            (protocol) =>
              version.primaryFocus === "measured" ||
              protocol.metricType === "rotation-count"
          ),
    });
    if (!created.ok) {
      alert(created.error.message);
      return false;
    }
    const attached = attachSoloExerciseExecution(session, created.value);
    if (!attached.ok) {
      alert(attached.error.message);
      return false;
    }

    commitSession(attached.value);
    setPendingSoloExerciseVersion(null);
    setViewingExerciseExecutionId(created.value.id);
    setFinishedTrainingSummary(null);
    return true;
  }

  function handleReplaceExerciseExecution(execution: ExerciseExecution): boolean {
    if (sessionHydration !== "ready") return false;
    const session = sessionRef.current;
    if (!session) return false;
    const replacement = replaceExerciseExecution(session, execution);
    if (!replacement.ok) return false;

    commitSession(replacement.value);
    setViewingExerciseExecutionId(execution.id);
    return true;
  }

  function handleBackToExerciseLibrary() {
    setPendingSoloExerciseVersion(null);
    setViewingExerciseExecutionId(null);
    setPreferredTrainEntryPath("exercises");
  }

  function handleCreateNewBlock(value: TrainingSetupValue) {
    if (sessionHydration !== "ready") return;

    // Pre-validate with a throwaway construction; addTrainingBlock's own
    // internal createTrainingBlock call is then guaranteed not to throw,
    // since the throw condition depends only on measurementMode/
    // variableTargetMode, not on the randomly-generated id or target.
    if (!tryCreateTrainingBlock(value)) return;

    setCurrentSession((session) => {
      if (!session) return session;

      return addTrainingBlock(session, value);
    });

    setBlockFilter(DEFAULT_SHOT_FILTER);
    setShowNewBlockModal(false);
  }

  /** Upserts a Training Plan into the library by id — create or rename/re-edit alike. */
  function handleSaveTrainingPlan(plan: TrainingPlan) {
    if (trainingPlansHydration !== "ready") return;

    setTrainingPlans((current) => {
      const library: TrainingPlansPersistedState = {
        schemaVersion: TRAINING_PLANS_SCHEMA_VERSION,
        plans: current,
      };

      if (current.some((existing) => existing.id === plan.id)) {
        const result = updatePlan(library, plan);
        return result.ok ? result.value.plans : current;
      }

      return addPlan(library, plan).plans;
    });
  }

  /**
   * Removes only the reusable plan definition — never a Session already
   * started from it (see docs/TRAINING_SYSTEM_AND_PLANS.md section 20).
   * TrainingPlansLibrary already confirms this destructive action itself.
   */
  function handleDeleteTrainingPlan(planId: string) {
    if (trainingPlansHydration !== "ready") return;

    setTrainingPlans(
      (current) =>
        deletePlan(
          { schemaVersion: TRAINING_PLANS_SCHEMA_VERSION, plans: current },
          planId
        ).plans
    );
  }

  function handleDuplicateTrainingPlan(plan: TrainingPlan) {
    if (trainingPlansHydration !== "ready") return;

    const copy = duplicatePlan(plan);
    setTrainingPlans(
      (current) =>
        addPlan(
          { schemaVersion: TRAINING_PLANS_SCHEMA_VERSION, plans: current },
          copy
        ).plans
    );
  }

  /**
   * Materialises exactly one profile-owned mixed-plan step through its existing
   * domain boundary. Release Time creates a normal TrainingBlock; curated steps on
   * the generic runner create and attach a normal Solo Exercise Execution. The returned
   * typed runtime reference is the only link the plan orchestrator owns.
   */
  function materializeProfilePlanStep(
    session: Session,
    step: TrainingPlanStep
  ): MaterializedPlanStep {
    if (isReleaseTimingPlanStep(step)) {
      const blockInput = mapPlanStepToTrainingBlockInput(step);
      const validation = validateTrainingBlockInput(blockInput);
      if (validation) return { ok: false, message: validation };
      const withBlock = addTrainingBlock(session, blockInput);
      return {
        ok: true,
        session: withBlock,
        runtime: {
          kind: "release-timing-block",
          blockId: withBlock.activeBlockId,
        },
      };
    }

    const runnerKind = exerciseRunnerKind(
      EXERCISE_CATALOG,
      step.exerciseVersionSnapshot
    );
    if (runnerKind !== "exercise-execution") {
      return {
        ok: false,
        message: "This plan step does not have a supported Exercise Execution runner.",
      };
    }
    const compatibleProtocols = resolveMeasurementProtocols(
      EXERCISE_CATALOG,
      step.exerciseVersionSnapshot.compatibleMeasurementProtocols
    ).map(({ protocol }) => protocol);
    const created = createSoloExerciseExecution(step.exerciseVersionSnapshot, {
      trainingSessionId: session.id,
      athleteProfileId,
      enabledMeasurementProtocols:
        step.exerciseVersionSnapshot.primaryFocus === "technique"
          ? []
          : compatibleProtocols.filter(
              (protocol) =>
                step.exerciseVersionSnapshot.primaryFocus === "measured" ||
                protocol.metricType === "rotation-count"
            ),
    });
    if (!created.ok) return { ok: false, message: created.error.message };
    const attached = attachSoloExerciseExecution(session, created.value);
    if (!attached.ok) return { ok: false, message: attached.error.message };
    return {
      ok: true,
      session: attached.value,
      runtime: {
        kind: "exercise-execution",
        exerciseExecutionId: created.value.id,
      },
      viewingExerciseExecutionId: created.value.id,
    };
  }

  /**
   * Starts a profile-owned mixed Training Plan by materialising its first step and
   * attaching the immutable plan snapshot in one Session commit.
   */
  function handleStartTrainingPlan(plan: TrainingPlan) {
    if (sessionHydration !== "ready") return;

    const firstStep = plan.steps[0];
    if (!firstStep) return;

    const session = sessionRef.current;
    if (!session) return;
    const materialized = materializeProfilePlanStep(session, firstStep);
    if (!materialized.ok) {
      alert(materialized.message);
      return;
    }

    commitSession({
      ...materialized.session,
      planExecution: startPlanExecution(plan, materialized.runtime),
    });

    setBlockFilter(DEFAULT_SHOT_FILTER);
    setEntryMode("manual");
    setViewingExerciseExecutionId(
      materialized.viewingExerciseExecutionId ?? null
    );
    setPendingReleaseTimingExerciseVersion(null);
    setPreferredTrainEntryPath("exercises");
    setPlanTransitionError(null);
    setFinishedTrainingSummary(null);
  }

  function handleCreateAccuracyToleranceProfile(
    input: AccuracyToleranceProfileInput
  ) {
    if (accuracyProfilesHydration !== "ready") return;

    const outcome = buildAccuracyToleranceProfile(input, new Date().toISOString());
    if (!outcome.ok) {
      alert(outcome.error.message);
      return;
    }
    setAccuracyToleranceProfilesState((current) =>
      addAccuracyToleranceProfile(current, outcome.value)
    );
  }

  /** Never rewrites `id`/`createdAt` — only name/values and `updatedAt` change. */
  function handleUpdateAccuracyToleranceProfile(
    profileId: string,
    input: Omit<AccuracyToleranceProfileInput, "id" | "createdAt">
  ) {
    if (accuracyProfilesHydration !== "ready") return;

    setAccuracyToleranceProfilesState((current) => {
      const existing = current.profiles.find((profile) => profile.id === profileId);
      if (!existing) return current;

      // Defence in depth behind the form's own guard: an update must never change a
      // template's unit. The quantity comes from the STORED template, not from the
      // form value, so no edit can relabel seconds as metres per second — which would
      // silently reinterpret every block, plan step and historical judgement that had
      // already copied this template's numbers.
      //
      // Stage A additionally refused to update a speed or asymmetric template at all,
      // because the only editor that existed then had one seconds field per band and
      // would have flattened or re-unitted it on save. Stage B's per-side editor can
      // represent every shape this app stores, so that blanket refusal is lifted; the
      // unit invariant above is the part that was actually protecting correctness.
      const outcome = buildAccuracyToleranceProfile(
        {
          ...input,
          quantity: existing.quantity,
          id: existing.id,
          createdAt: existing.createdAt,
        },
        new Date().toISOString()
      );
      if (!outcome.ok) {
        alert(outcome.error.message);
        return current;
      }

      const result = replaceAccuracyToleranceProfile(current, outcome.value);
      return result.ok ? result.value : current;
    });
  }

  function handleDuplicateAccuracyToleranceProfile(profileId: string) {
    if (accuracyProfilesHydration !== "ready") return;

    setAccuracyToleranceProfilesState((current) => {
      const existing = current.profiles.find((profile) => profile.id === profileId);
      if (!existing) return current;

      const copy = duplicateAccuracyToleranceProfile(
        existing,
        new Date().toISOString()
      );
      return addAccuracyToleranceProfile(current, copy);
    });
  }

  function handleDeleteAccuracyToleranceProfile(profileId: string) {
    if (accuracyProfilesHydration !== "ready") return;

    setAccuracyToleranceProfilesState((current) =>
      deleteAccuracyToleranceProfile(current, profileId)
    );
  }

  function handleSetDefaultAccuracyToleranceProfile(profileId: string | null) {
    if (accuracyProfilesHydration !== "ready") return;

    setAccuracyToleranceProfilesState((current) => {
      const result = setDefaultAccuracyToleranceProfile(current, profileId);
      return result.ok ? result.value : current;
    });
  }

  // Smart Random has no validated range for any Measurement Mode other than
  // Back-Hog (isSmartRandomAvailable) — the profile form never offers a
  // Measurement Mode choice, so every profile created here is explicitly
  // "back-hog"; buildSmartRandomProfile still re-validates this rather than
  // trusting the caller.
  function handleCreateSmartRandomProfile(value: SmartRandomProfileFormValue) {
    if (smartRandomProfilesHydration !== "ready") return;

    const outcome = buildSmartRandomProfile(
      { ...value, measurementMode: "back-hog" },
      new Date().toISOString()
    );
    if (!outcome.ok) {
      alert(outcome.error.message);
      return;
    }
    setSmartRandomProfilesState((current) =>
      addSmartRandomProfile(current, outcome.value)
    );
  }

  /** Never rewrites `id`/`createdAt`/`measurementMode` — only the range and `updatedAt` change. */
  function handleUpdateSmartRandomProfile(
    profileId: string,
    value: SmartRandomProfileFormValue
  ) {
    if (smartRandomProfilesHydration !== "ready") return;

    setSmartRandomProfilesState((current) => {
      const existing = current.profiles.find((profile) => profile.id === profileId);
      if (!existing) return current;

      const outcome = buildSmartRandomProfile(
        {
          ...value,
          id: existing.id,
          measurementMode: existing.measurementMode,
          createdAt: existing.createdAt,
        },
        new Date().toISOString()
      );
      if (!outcome.ok) {
        alert(outcome.error.message);
        return current;
      }

      const result = replaceSmartRandomProfile(current, outcome.value);
      return result.ok ? result.value : current;
    });
  }

  function handleDuplicateSmartRandomProfile(profileId: string) {
    if (smartRandomProfilesHydration !== "ready") return;

    setSmartRandomProfilesState((current) => {
      const existing = current.profiles.find((profile) => profile.id === profileId);
      if (!existing) return current;

      const copy = duplicateSmartRandomProfile(existing, new Date().toISOString());
      return addSmartRandomProfile(current, copy);
    });
  }

  function handleDeleteSmartRandomProfile(profileId: string) {
    if (smartRandomProfilesHydration !== "ready") return;

    setSmartRandomProfilesState((current) =>
      deleteSmartRandomProfile(current, profileId)
    );
  }

  function handleSetDefaultSmartRandomProfile(profileId: string | null) {
    if (smartRandomProfilesHydration !== "ready") return;

    setSmartRandomProfilesState((current) => {
      const result = setDefaultSmartRandomProfile(current, profileId);
      return result.ok ? result.value : current;
    });
  }

  /**
   * Moves a mixed Training Plan on to its next planned Exercise.
   *
   * Never gated on the planned stone count or on an explicit Complete Exercise: the
   * athlete may leave a step below, at or above its planned volume, and with nothing
   * recorded at all (docs/TRAINING_SYSTEM_AND_PLANS.md section 31). What *is* still
   * guarded is unsaved work the athlete would otherwise lose without being asked —
   * a Blind Weight draft and a live Auto Capture — reusing `guardLeavingActiveWork`
   * rather than a second, plan-specific guard.
   */
  function handleContinueToNextPlanStep() {
    if (sessionHydration !== "ready") return;

    const session = sessionRef.current;
    const planExecution = session?.planExecution;
    if (!session || !planExecution || !isPlanExecutionActive(session, planExecution)) {
      return;
    }
    if (!hasNextPlanStep(planExecution)) return;

    // Bound at click time to the exact Session and step this click meant; the queued
    // work below re-checks both, so a stale second click can never advance a plan that
    // has already moved on (or been archived by a competing Finish Training).
    const intent = {
      sessionId: session.id,
      stepIndex: planExecution.activeStepIndex,
    };

    guardLeavingActiveWork(
      hasUnsavedBlindDraft
        ? "You have an unfinished blind-weight shot. Moving to the next planned exercise will discard it — stones you already recorded are kept. Continue?"
        : null,
      isCaptureSequenceActive(session.captureSequence)
        ? "Moving to the next planned exercise will end the current Auto Capture. Already captured shots will remain in this training."
        : null,
      null,
      () => enqueuePlanStepAdvance(intent)
    );
  }

  /**
   * Enqueued onto `captureQueueRef` — the same serialization point every TimingResult
   * and the Session archive transition go through (ADR-0007/0014). That is what
   * guarantees a result accepted *before* this transition is applied to the step it
   * actually belongs to, and that a result submitted while this transition is running
   * waits behind it instead of interleaving with it.
   */
  function enqueuePlanStepAdvance(intent: { sessionId: string; stepIndex: number }) {
    if (planStepAdvanceInFlightRef.current) return;
    planStepAdvanceInFlightRef.current = true;

    captureQueueRef.current = captureQueueRef.current
      .then(() => performPlanStepAdvance(intent))
      .catch((error) => {
        console.error("Unexpected error while advancing the Training Plan", error);
      })
      .finally(() => {
        planStepAdvanceInFlightRef.current = false;
      });
  }

  /**
   * One transition, one Session commit: the outgoing runtime is terminalised, the next
   * step's runtime is materialised, and the advanced plan reference is stamped — all
   * computed as plain values before anything is committed, so no intermediate Session
   * in which the plan points at one step while another is still open is ever
   * observable. Reads `sessionRef`, never the render closure, because by the time the
   * queue reaches this call the closure may be arbitrarily stale.
   */
  async function performPlanStepAdvance(intent: { sessionId: string; stepIndex: number }) {
    if (sessionHydration !== "ready") return;

    const session = sessionRef.current;
    const planExecution = session?.planExecution;
    if (!session || !planExecution) return;
    if (session.id !== intent.sessionId) return;
    if (planExecution.activeStepIndex !== intent.stepIndex) return;
    if (!isPlanExecutionActive(session, planExecution)) return;

    const nextStep = planExecution.steps[intent.stepIndex + 1]?.step;
    if (!nextStep) return;

    const ended = endActivePlanStepRuntime(session, planExecution);
    if (!ended.ok) {
      setPlanTransitionError(ended.error.message);
      return;
    }

    const materialized = materializeProfilePlanStep(ended.value, nextStep);
    if (!materialized.ok) {
      setPlanTransitionError(materialized.message);
      return;
    }

    const advanced: Session = {
      ...materialized.session,
      planExecution: advanceToNextPlanStep(planExecution, materialized.runtime),
    };

    commitSession(advanced);

    setPlanTransitionError(null);
    setRetryableSessionSave(null);
    setBlockFilter(DEFAULT_SHOT_FILTER);
    setEntryMode("manual");
    setLastCaptureMessage(undefined);
    setViewingExerciseExecutionId(
      materialized.viewingExerciseExecutionId ?? null
    );

    // The visible state has moved on; now find out whether storage agrees. Only a
    // write that genuinely speaks for THIS commit may answer — an older in-flight
    // write succeeding says nothing about it (see awaitSessionPersisted).
    //
    // Deliberately NOT awaited inside the queued transition: the transition itself is
    // complete, and blocking the shared capture/transition queue on a storage write
    // that may never settle would wedge every later result behind it.
    const advancedStepIndex = advanced.planExecution?.activeStepIndex ?? 0;
    registerSessionPersistenceAck(
      advanced,
      (written) =>
        written.id === advanced.id &&
        (written.planExecution?.activeStepIndex ?? -1) >= advancedStepIndex,
      (ack) => {
        if (ack.status !== "failed") return;
        setPlanTransitionError(
          "This training moved to the next exercise, but that change could not be saved yet. Everything you recorded is still here — try saving again."
        );
        setRetryableSessionSave(() => advanced);
      }
    );
  }

  function retryFailedSessionSave(): void {
    const pending = retryableSessionSave;
    if (!pending) return;

    // Retried against the CURRENT session, not the stale snapshot: anything recorded
    // since must be saved too, and the current state already contains the transition.
    const target = sessionRef.current ?? pending;
    setPlanTransitionError(null);
    setRetryableSessionSave(null);

    void runSessionWrite(() => sessionRepository.saveCurrent(target))
      .then((result) => {
        settleSessionSaveWaiters(target, result);
        if (result.ok) return;
        setPlanTransitionError(
          "That still could not be saved. Everything you recorded is still here — try again, or finish the training to save it."
        );
        setRetryableSessionSave(() => target);
      })
      .catch(() => {
        setPlanTransitionError(
          "That still could not be saved. Everything you recorded is still here — try again, or finish the training to save it."
        );
        setRetryableSessionSave(() => target);
      });
  }

  /**
   * The actual archive-and-replace work, run strictly through captureQueueRef — the
   * same serialization point every TimingResult goes through (docs/adr/0014-session-archive-write-ordering.md's
   * hardening pass; see ADR-0007 for the queue itself). This is what guarantees:
   * - A capture mutation already queued (accepted) before this transition was enqueued
   *   runs to completion first, so its result is reflected in sessionRef.current by the
   *   time this function's snapshot read happens below — never lost.
   * - A capture mutation submitted while this transition's own persistence write is
   *   still pending gets queued *behind* this function's returned promise, so it can
   *   never interleave between the snapshot read and the current-session replacement.
   * Reads sessionRef/sessionHistoryRef — never the render closure — because by the
   * time the queue actually reaches this call, the closure that scheduled it may be
   * arbitrarily stale.
   */
  async function performSessionArchiveTransition(options: { summarize: boolean }) {
    // Held for the WHOLE transition — from before the archive snapshot is chosen until
    // after the replacement Session is committed — so no mutation can be accepted into
    // a snapshot that has already been taken. Released in the `finally` below on every
    // path, including the early returns and any thrown error.
    beginSessionTransition();
    try {
      return await runSessionArchiveTransition(options);
    } finally {
      endSessionTransition();
    }
  }

  async function runSessionArchiveTransition(options: { summarize: boolean }) {
    const currentSnapshot = sessionRef.current;
    const nextCurrentSession = createNewSession();

    // Finishing a planned training ends its active step through the plan's own
    // transition first, so a step the athlete genuinely finished is recorded as
    // completed rather than as the interruption `prepareSessionForArchive` would
    // otherwise assume. Standalone training is untouched by this. If that transition
    // cannot be applied, the unchanged snapshot is archived instead — the interrupted
    // representation is less flattering but still truthful, and it must never cost the
    // athlete the archive itself.
    const endedSnapshot =
      currentSnapshot?.planExecution &&
      isPlanExecutionActive(currentSnapshot, currentSnapshot.planExecution)
        ? endActivePlanStepRuntime(currentSnapshot, currentSnapshot.planExecution)
        : null;
    const snapshot = endedSnapshot?.ok ? endedSnapshot.value : currentSnapshot;

    if (!snapshot || !sessionHasArchivableActivity(snapshot)) {
      // Re-checked here, against the authoritative ref, rather than trusting the
      // click-time closure's `shots.length` — a capture result accepted while the
      // confirmation dialog was open could have added a shot after the click but
      // before this queued step actually runs.
      commitSession(nextCurrentSession);
      setBlockFilter(DEFAULT_SHOT_FILTER);
      setViewingExerciseExecutionId(null);
      setPendingSoloExerciseVersion(null);
      setPendingReleaseTimingExerciseVersion(null);
      setPreferredTrainEntryPath("exercises");
      setPlanTransitionError(null);
      // Nothing sporting was recorded, so nothing is archived. The summary says
      // exactly that rather than implying a saved training.
      setFinishedTrainingSummary(
        options.summarize && snapshot ? { session: snapshot, saved: false } : null
      );
      setActiveView("train");
      return;
    }

    // An active Capture Sequence is ended as the confirmation already promises
    // ("Finishing this training will end the current Auto Capture. Already captured
    // shots will remain in the training."). Until now that promise was only copy: the
    // sequence was archived still "ready"/"running", which is not a terminal state —
    // restoring such a record would pause it, so the stored payload and the restored
    // value would disagree and the record would be unrestorable. Cancelling keeps
    // every captured stone and makes the archived Session genuinely terminal.
    const terminalSnapshot: Session =
      snapshot.captureSequence &&
      isCaptureSequenceActive(snapshot.captureSequence)
        ? {
            ...snapshot,
            captureSequence: cancelCaptureSequence(snapshot.captureSequence),
          }
        : snapshot;

    // An in-progress library Exercise is a real interruption, not an empty Session.
    // Persist it as abandoned before the Session becomes terminal; never discard it
    // and never upload an in-progress execution as archived cloud history.
    const prepared = prepareSessionForArchive(terminalSnapshot);
    if (!prepared.ok) {
      // Session completion reports a failed archive preparation alongside its action.
      if (options.summarize) {
        setPlanTransitionError(
          "This training could not be closed safely. Nothing was changed — try Complete Session again."
        );
      }
      return;
    }
    const previousSession = prepared.value;

    // Coordinated archive-and-replace: history is durably written before the
    // replacement session is even attempted — never merely "issued first" — so this
    // depends on neither React's effect-declaration order nor the adapter being
    // synchronous. The snapshot (nextHistory) is selected here, once, and held in this
    // local variable for the rest of the transition — nothing queued behind this call
    // on captureQueueRef can run until this whole function returns, so nothing can
    // mutate the session between this read and the eventual replacement below.
    const nextHistory = [previousSession, ...sessionHistoryRef.current];
    const archiveResult = await runSessionWrite(() => sessionRepository.archiveAndReplace(
      nextHistory,
      nextCurrentSession
    ));

    if (!archiveResult.ok && archiveResult.step === "history") {
      // History write failed: neither write took effect. Leave the completed
      // session exactly as it is — no silent data loss — so the user can retry, and
      // never present a summary that would imply the training was saved.
      setFinishedTrainingSummary(null);
      if (options.summarize) {
        setPlanTransitionError(
          "This training could not be saved yet. Everything you recorded is still here — try Complete Session again."
        );
      }
      return;
    }

    // History is now durable either way (the only remaining failure mode,
    // `step === "current"`, happens strictly after a successful history write).
    // Record exactly what was already persisted, in both the render-visible state and
    // its authoritative ref together, so the ordinary, independent save effects don't
    // redundantly (and, in doing so, riskily) re-persist this same transition in their
    // own declaration order.
    lastArchivedHistoryRef.current = nextHistory;
    sessionHistoryRef.current = nextHistory;
    setSessionHistory(nextHistory);

    if (archiveResult.ok) {
      lastArchivedCurrentSessionRef.current = nextCurrentSession;
    }
    // else (step === "current"): leave lastArchivedCurrentSessionRef as-is, so the
    // ordinary current-session save effect naturally retries persisting
    // nextCurrentSession once it's committed below.

    // The archive durably wrote the OUTGOING session, so every operation that was
    // still outstanding against it is now resolved: its measurement is in history.
    // Discarding them here (rather than leaving them to be filtered out later) is what
    // keeps a stale failure from a finished training out of the next one, and stops a
    // late callback from an old operation touching the new training's status.
    reconcileOperationsWithArchive(previousSession);

    commitSession(nextCurrentSession);
    setBlockFilter(DEFAULT_SHOT_FILTER);
    setViewingExerciseExecutionId(null);
    setPendingSoloExerciseVersion(null);
    setPendingReleaseTimingExerciseVersion(null);
    setPreferredTrainEntryPath("exercises");
    setPlanTransitionError(null);
    // The archived Session — deliberately not `nextCurrentSession`, which is empty.
    setFinishedTrainingSummary(
      options.summarize ? { session: previousSession, saved: true } : null
    );
    setActiveView("train");
  }

  /**
   * Resolves every outstanding manual submission and completion that the just-archived
   * session actually carried, and clears drafts and confirmations belonging to it.
   *
   * An archive writes the whole outgoing Session durably (ADR-0014), so an operation
   * that was still "pending" or "failed" against it is neither any more — the
   * measurement is in history. Reporting it as outstanding afterwards would be untrue,
   * and carrying it into the replacement training would attach it to a training it was
   * never part of.
   */
  function reconcileOperationsWithArchive(archived: Session): void {
    commitManualSubmissions((current) =>
      current.filter((submission) => submission.sessionId !== archived.id)
    );
    commitPendingCompletions((current) =>
      current.filter((entry) => entry.sessionId !== archived.id)
    );
    setCompletionConfirmation((current) =>
      current && current.sessionId === archived.id ? null : current
    );
    setLastAcknowledgedShot(null);
    setManualEntryDraft(null);
    setCompletionDrafts({});
    setCompletionSelection(null);
    setShotEntryError(null);
  }

  /**
   * Presents intent-specific copy while keeping the durable archive transition
   * itself shared. Finishing a training is not a destructive action and must not
   * inherit the red treatment used for deletion/discard confirmations.
   *
   * Available throughout an active plan — midway through an exercise and before the
   * final step alike (docs/TRAINING_SYSTEM_AND_PLANS.md section 34). It ends the
   * training and keeps every recorded stone, attempt and note; it is not a discard.
   */
  function handleFinishPlannedTraining() {
    if (sessionHydration !== "ready") return;

    // Truthful confirmation copy: "completed" is claimed only when every planned
    // volume has actually been reached, not merely because this is the last step.
    const session = sessionRef.current;
    const hasPlan =
      !!session?.planExecution &&
      isPlanExecutionActive(session, session.planExecution);
    const planIncomplete =
      hasPlan && !isPlanComplete(session!, session!.planExecution!);

    guardLeavingActiveWork(
      hasUnsavedBlindDraft
        ? "You have an unfinished blind-weight shot. Finishing this training will discard it — recorded work will still be saved to history. Continue?"
        : null,
      isCaptureSequenceActive(session?.captureSequence)
        ? "Finishing this training will end the current Auto Capture. Already captured shots will remain in the training."
        : null,
      null,
      () => {
        openSessionArchiveConfirmation(
          {
            title: "Complete Session",
            message: planIncomplete
              ? "Save this training to history? Everything you recorded is kept; planned work you did not record stays unrecorded."
              : hasPlan
                ? "Save this completed training to history?"
                : "Save this training to history? Every stone you recorded is kept, including stones that are still missing one measurement.",
            confirmLabel: "Complete",
          },
          { summarize: true }
        );
      }
    );
  }

  function openSessionArchiveConfirmation(
    copy: {
      title: string;
      message: string;
      confirmLabel: string;
    },
    options: { summarize: boolean }
  ) {
    setConfirmAction({
      ...copy,
      isDanger: false,
      // Deliberately synchronous, not async: the single-flight check-and-set below
      // must complete before any await exists anywhere in this call, so a second,
      // rapid invocation is rejected unconditionally.
      onConfirm: () => {
        if (sessionArchiveInFlightRef.current) return;
        sessionArchiveInFlightRef.current = true;

        // Enqueued onto the same queue every TimingResult goes through — see
        // performSessionArchiveTransition's doc comment above. An unexpected
        // exception must never leave captureQueueRef permanently rejected.
        captureQueueRef.current = captureQueueRef.current
          .then(() => performSessionArchiveTransition(options))
          .catch((error) => {
            console.error("Unexpected error while archiving the session", error);
          })
          .finally(() => {
            sessionArchiveInFlightRef.current = false;
          });

        setConfirmAction(null);
      },
    });
  }

  /**
   * Gates navigation away from an in-progress Blind Weight shot (History,
   * New Training Block, Complete Session, ...). When there's nothing
   * unsaved, `action` runs immediately; otherwise the user is asked first,
   * and `action` only runs if they confirm — at which point the draft is
   * treated as discarded (no partial shot is ever saved, the shot number and
   * pendingTargetTime are untouched, and blindDraftResetToken forces a clean
   * remount of BlindShotEntry so a cancelled follow-up action, like
   * dismissing the New Training Block modal, can't resurrect the old draft).
   */
  function runOrConfirmBlindDraftDiscard(
    warningMessage: string | null,
    action: () => void
  ) {
    if (!warningMessage) {
      action();
      return;
    }

    setConfirmAction({
      title: "Unfinished Blind Weight Shot",
      message: warningMessage,
      confirmLabel: "Leave",
      isDanger: true,
      onConfirm: () => {
        setHasUnsavedBlindDraft(false);
        setBlindDraftResetToken((token) => token + 1);
        setConfirmAction(null);
        action();
      },
    });
  }

  /**
   * The single entry point PrimaryNavigation calls to switch top-level
   * screens. Only leaving Train while a Blind Weight draft is unsaved or an
   * Auto Capture sequence is active/paused is guarded — every other
   * transition (including navigating *into* Train, or moving between
   * Home/Analyze/Settings) is safe by construction, since Session state
   * itself is untouched by which screen is currently rendered. See
   * docs/adr/0009.
   */
  /**
   * The single point at which a navigation is actually committed. Every guarded and
   * unguarded path in `handleNavigate` goes through here, so leaving Settings always
   * releases the development BLE diagnostic instead of leaving it mounted — and owning a
   * live GATT connection — behind another screen. It never bypasses
   * `guardLeavingActiveWork`: it is only ever reached once a guard has allowed the move.
   */
  function commitNavigation(view: ActiveView) {
    if (view !== "train") browerController.reconcileContext(null);
    if (view !== "settings") setShowBleDiagnostic(false);
    // The finished-training summary describes one just-archived Session; leaving Train
    // dismisses it rather than letting it reappear later in place of the landing.
    if (view !== "train") setFinishedTrainingSummary(null);
    setActiveView(view);
  }

  function handleNavigate(view: ActiveView) {
    if (activeView === "train" && view !== "train") {
      guardLeavingActiveWork(
        hasUnsavedBlindDraft
          ? "You have an unfinished blind-weight shot. Leave without saving it?"
          : null,
        isCaptureSequenceActive(currentSession?.captureSequence)
          ? "Leaving Auto Capture will end the current capture sequence. Already captured shots will remain in the training."
          : null,
        null,
        () => commitNavigation(view)
      );
      return;
    }

    if (activeView === "assess" && view !== "assess") {
      guardLeavingActiveWork(
        null,
        null,
        isAssessmentCaptureActive() ? ASSESSMENT_LEAVE_NOTICE : null,
        () => commitNavigation(view)
      );
      return;
    }

    commitNavigation(view);
  }

  function handleOpenNewBlockModal() {
    if (sessionHydration !== "ready") return;

    guardLeavingActiveWork(
      hasUnsavedBlindDraft
        ? "You have an unfinished blind-weight shot. Starting a new training block will discard it. Continue?"
        : null,
      isCaptureSequenceActive(currentSession?.captureSequence)
        ? "Starting a new training block will end the current Auto Capture. Already captured shots will remain in the training."
        : null,
      null,
      () => setShowNewBlockModal(true)
    );
  }

  /**
   * Gates navigation away from a running/paused Capture Sequence — same shape as
   * runOrConfirmBlindDraftDiscard, for the same reason (History, New Training Block,
   * Complete Session shouldn't silently abandon in-progress work). Confirming ends
   * the sequence (already-captured shots remain; nothing half-finished is ever saved
   * as a shot) before running `action`.
   */
  function runOrConfirmCaptureLeave(
    warningMessage: string | null,
    action: () => void
  ) {
    if (!warningMessage) {
      action();
      return;
    }

    setConfirmAction({
      title: "Auto Capture In Progress",
      message: warningMessage,
      confirmLabel: "Leave",
      isDanger: true,
      onConfirm: () => {
        if (sessionHydration === "ready") {
          setCurrentSession((session) => {
            if (!session || !session.captureSequence) return session;
            return {
              ...session,
              captureSequence: {
                ...session.captureSequence,
                status: "cancelled",
                cancelledAt: new Date().toISOString(),
              },
            };
          });
        }
        setConfirmAction(null);
        action();
      },
    });
  }

  /**
   * Gates navigation away from an active (warmup/in_progress) Assessment Run
   * — the Assess-domain counterpart to runOrConfirmCaptureLeave. Confirming
   * pauses the run (never cancels/abandons it) before `action` runs — see
   * docs/adr/0011: "Leaving the assessment will pause capture. Your recorded
   * attempts and progress will be kept."
   */
  function runOrConfirmAssessmentLeave(
    warningMessage: string | null,
    action: () => void
  ) {
    if (!warningMessage) {
      action();
      return;
    }

    setConfirmAction({
      title: "Assessment In Progress",
      message: warningMessage,
      confirmLabel: "Leave",
      onConfirm: () => {
        updateAssessmentState((state) => {
          const current = state.currentRun;
          if (!current) return state;
          const outcome = pauseAssessmentRun(current);
          return outcome.ok ? { ...state, currentRun: outcome.value } : state;
        });
        setConfirmAction(null);
        action();
      },
    });
  }

  /**
   * Composes the Blind Weight draft guard, the Training Capture Sequence
   * guard, and the Assessment guard: each (if its warning message is
   * non-null) is confirmed in turn before `action` runs. Blind Weight and
   * Training Capture are mutually exclusive with an active Assessment Run in
   * practice (see docs/adr/0011's Capture Ownership rule), but composing all
   * three unconditionally is correct either way and needs no special-casing.
   */
  function guardLeavingActiveWork(
    blindWarningMessage: string | null,
    captureWarningMessage: string | null,
    assessmentWarningMessage: string | null,
    action: () => void
  ) {
    runOrConfirmBlindDraftDiscard(blindWarningMessage, () => {
      runOrConfirmCaptureLeave(captureWarningMessage, () => {
        runOrConfirmAssessmentLeave(assessmentWarningMessage, () => {
          runOrConfirmEntryDraftDiscard(action);
        });
      });
    });
  }

  /**
   * Typed-but-unsaved measurement entry — either a manual stone or a completion for an
   * identified stone. Composed as a fourth guard rather than a separate per-caller
   * check, so every path that already leaves active work resolves it too.
   *
   * Only fires when a value has actually been TYPED — merely having a stone selected,
   * or an entry control on screen, is not unsaved work, and confirming that would be
   * the routine dialog this project's design rules forbid.
   *
   * Confirming genuinely clears the drafts it named. Previously it only flipped a
   * boolean the child ignored, so a "discarded" value was still sitting in the field
   * afterwards — and if the athlete then cancelled the action they had confirmed for,
   * the parent and the child disagreed about whether it existed.
   */
  function runOrConfirmEntryDraftDiscard(action: () => void) {
    if (!hasUnsavedManualDraft && !hasUnsavedCompletionDraft) {
      action();
      return;
    }

    setConfirmAction({
      title: "Unsaved Measurement",
      message:
        "You typed a measurement but haven't recorded it yet. Leaving will discard it — everything already recorded is kept. Continue?",
      confirmLabel: "Discard and Continue",
      isDanger: true,
      onConfirm: () => {
        discardEntryDrafts();
        setConfirmAction(null);
        action();
      },
    });
  }

  /**
   * Clears exactly the drafts the discard confirmation described, and nothing else.
   *
   * The completion SELECTION is deliberately kept. Discarding is about the typed
   * value, not about which stone the athlete was working on; closing the editor too
   * would hide the field they are about to retype into, and — if they then cancel the
   * action they confirmed for — leave no sign of what was discarded.
   */
  function discardEntryDrafts() {
    setManualEntryDraft(null);
    setCompletionDrafts({});
  }

  function handleDeleteHistorySession(sessionId: string) {
    if (sessionHydration !== "ready") return;

    setConfirmAction({
      title: "Delete Session",
      message:
        "Delete this session from history? This cannot be undone.",
      confirmLabel: "Delete",
      isDanger: true,
      onConfirm: () => {
        setSessionHistory((currentHistory) =>
          currentHistory.filter(
            (session) => session.id !== sessionId
          )
        );

        setConfirmAction(null);
      },
    });
  }

  function handleClearSessionHistory() {
    if (sessionHydration !== "ready") return;

    setConfirmAction({
      title: "Clear Session History",
      message:
        "Delete the entire session history? This cannot be undone.",
      confirmLabel: "Clear All",
      isDanger: true,
      onConfirm: () => {
        setSessionHistory([]);
        setConfirmAction(null);
      },
    });
  }

  function toggleSessionExpanded(sessionId: string) {
    setExpandedSessions((current) => ({
      ...current,
      [sessionId]: !current[sessionId],
    }));
  }

  /**
   * Handler-level guard for History Filters, kept as defence in depth
   * alongside the render-level `disabled` gate on `HistoryFilterBar` itself
   * (docs/PERSISTENCE_BOUNDARY_DESIGN.md §7.10) — a bypassed or
   * programmatic call still cannot mutate History Filters state while its
   * own hydration isn't "ready".
   */
  function handleChangeHistoryFilters(next: HistoryAnalysisFilters) {
    if (historyFiltersHydration !== "ready") return;
    setHistoryFilters(next);
  }

  const resolvedAssessmentResultRun: AssessmentRun | null =
    viewingAssessmentResultRunId && assessmentState
      ? getAssessmentRunFromHistory(assessmentState, viewingAssessmentResultRunId) ?? null
      : null;

  /** Removes one archived Assessment Run entirely — see spec's completed-run immutability rules ("delete the entire run after explicit confirmation" is the one destructive action allowed). Never touches currentRun or the Template. */
  function handleDeleteAssessmentRun(runId: string) {
    updateAssessmentState((state) => {
      const outcome = deleteAssessmentRunFromHistory(state, runId);
      return outcome.ok ? outcome.value : state;
    });
    if (viewingAssessmentResultRunId === runId) {
      setViewingAssessmentResultRunId(null);
    }
  }

  /**
   * Work that belongs to the TRAINING rather than to whichever exercise is running:
   * stones accepted but not yet durably written, and measurements still missing
   * anywhere in the current session.
   *
   * Rendered by every runner branch — Release Timing, Blind Weight and a curated
   * Shotmaking/Technique exercise alike. Scoping it to one runner is what made an
   * earlier exercise's missing speed unreachable the moment a plan advanced to Eight
   * Guards, and a Blind Weight write failure unretryable. Archived sessions stay out
   * of it: that is the line between completing a missing measurement and general
   * historical editing.
   */
  const outstandingSessionWork = (
    <>
      <ShotSaveStatus
        submissions={sessionManualSubmissions.map((submission) => ({
          operationId: submission.operationId,
          status: submission.status,
          message: submission.message,
          description: submission.description,
        }))}
        acknowledged={
          lastAcknowledgedShot?.ownerKey === manualDraftOwnerKey &&
          ownerManualSubmissions.length === 0
        }
        onRetry={retryManualSubmission}
        disabled={!sessionWritable}
      />

      <MissingMeasurementPanel
        entries={incompleteSessionShots}
        pending={sessionPendingCompletions}
        drafts={completionDrafts}
        onChangeDraft={(key, value) =>
          setCompletionDrafts((current) => ({ ...current, [key]: value }))
        }
        selection={completionSelection}
        onChangeSelection={setCompletionSelection}
        onComplete={handleCompleteShotMeasurement}
        onRetry={retryCompletionSave}
        confirmation={sessionCompletionConfirmation}
        disabled={!sessionWritable}
      />
    </>
  );

  return (
    <div className={`house-training app-content-clearance space-y-4 ${activeView === "home" ? "house-home-shell" : ""}`} >
      <IdentityPendingTeamIntent onOpenAdminRequests={() => setShowTeamsScreen(true)} />
      <div className="house-status-row"><h1 className="sr-only">{activeView === "home" ? "Curling Performance" : activeView === "assess" ? "Assessments" : activeView.charAt(0).toUpperCase() + activeView.slice(1)}</h1><IdentityAccountControl compact onOpenTeams={() => setShowTeamsScreen(true)} /></div>


      <PrimaryNavigation activeView={activeView} onNavigate={handleNavigate} />

      {viewingAssessmentResultRunId && resolvedAssessmentResultRun && (
        <AssessmentResultScreen
          run={resolvedAssessmentResultRun}
          history={assessmentState?.history ?? []}
          onBack={() => setViewingAssessmentResultRunId(null)}
          onDeleteRun={handleDeleteAssessmentRun}
        />
      )}

      {!viewingAssessmentResultRunId && (
      <>
      {activeView === "home" && (
        <HomeScreen
          currentSession={currentSession}
          sessionHistory={sessionHistory}
          onStartTraining={() => handleNavigate("train")}
          onOpenAnalyze={() => handleNavigate("analyze")}
          onOpenSettings={() => handleNavigate("settings")}
          activeTeamExerciseTitle={activeTeamExerciseDraft?.exerciseVersionSnapshot.title}
          onManageTeams={() => setShowTeamsScreen(true)}
          hasActiveAssessmentRun={
            !!assessmentState?.currentRun &&
            assessmentState.currentRun.status !== "completed" &&
            assessmentState.currentRun.status !== "incomplete"
          }
          onResumeAssessment={() => handleNavigate("assess")}
        />
      )}

      {activeView === "settings" && (
        <SettingsScreen
          accountControl={<IdentityAccountControl showSync={false} showTeams={false} onOpenTeams={() => setShowTeamsScreen(true)} />}
          hasHistory={sessionHistory.length > 0}
          onExportHistoryCsv={() => {
            void runExport(historyCsvExport(sessionHistory));
          }}
          exportStatus={exportStatus}
          onClearHistory={handleClearSessionHistory}
          clearHistoryDisabled={!sessionWritable}
          accuracyToleranceProfiles={accuracyToleranceProfilesState.profiles}
          defaultAccuracyToleranceProfileId={
            accuracyToleranceProfilesState.defaultProfileId
          }
          onManageAccuracyTolerances={() => {
            if (!accuracyProfilesWritable) return;
            setShowAccuracyToleranceProfilesManager(true);
          }}
          manageAccuracyTolerancesDisabled={!accuracyProfilesWritable}
          smartRandomProfiles={smartRandomProfilesState.profiles}
          defaultSmartRandomProfileId={smartRandomProfilesState.defaultProfileId}
          onManageSmartRandomProfiles={() => {
            if (!smartRandomProfilesWritable) return;
            setShowSmartRandomProfilesManager(true);
          }}
          manageSmartRandomProfilesDisabled={!smartRandomProfilesWritable}
          onManageTeams={() => setShowTeamsScreen(true)}
          showDeveloperDiagnostics={IS_DEV}
          onOpenBleDiagnostic={() => setShowBleDiagnostic(true)}
        />
      )}

      {activeView === "train" && (
        <div className={`house-training space-y-4 ${!activeTeamExerciseDraft && !pendingTeamExerciseVersion && !lastCompletedTeamSessionId ? "house-flow" : ""}`} data-testid="house-training">
          {activeTeamExerciseDraft ? (
            <ExerciseTeamExecutionScreen
              exerciseAssetResolver={exerciseAssetResolver}
              execution={activeTeamExerciseDraft}
              eligibilitySnapshot={activeTeamEligibilitySnapshot}
              onSave={async (execution) =>
                sportingCloudSync?.saveActiveTeamExerciseDraft(execution) ?? false}
              onComplete={async (execution) => {
                const completed = await (
                  sportingCloudSync?.finalizeActiveTeamExerciseDraft(execution) ?? false
                );
                if (completed) setLastCompletedTeamSessionId(execution.trainingSessionId);
                return completed;
              }}
              onDiscard={async (executionId) =>
                sportingCloudSync?.discardActiveTeamExerciseDraft(executionId) ?? false}
            />
          ) : pendingTeamExerciseVersion ? (
            <ExerciseTeamSetupScreen
              version={pendingTeamExerciseVersion}
              exerciseAssetResolver={exerciseAssetResolver}
              recorderProfileId={athleteProfileId}
              eligibilitySnapshots={sportingCloudSync?.teamEligibilitySnapshots ?? []}
              onStart={async (execution) => {
                const saved = await (
                  sportingCloudSync?.saveActiveTeamExerciseDraft(execution) ?? false
                );
                if (saved) setPendingTeamExerciseVersion(null);
                return saved;
              }}
              onCancel={() => setPendingTeamExerciseVersion(null)}
            />
          ) : pendingSoloExerciseVersion ? (
            <ExerciseSoloSetupScreen
              version={pendingSoloExerciseVersion}
              exerciseAssetResolver={exerciseAssetResolver}
              disabled={!sessionWritable}
              onConfirm={() => {
                handleConfirmSoloExerciseStart();
              }}
              onCancel={() => setPendingSoloExerciseVersion(null)}
            />
          ) : lastCompletedTeamSessionId ? (
            <div className="space-y-4">
              <section className={surfaceClass("hero")}>
                <p className="text-xs font-semibold uppercase tracking-wide text-slate-500">
                  Team exercise completed
                </p>
                <h2 className="mt-1 text-xl font-semibold text-slate-900">
                  {completedTeamSyncReceipt?.status === "fully_synced"
                    ? "Saved to the cloud"
                    : completedTeamSyncReceipt?.status === "partially_synced_athlete_result_blocked"
                      ? "Some athlete results need approval"
                      : completedTeamSyncReceipt?.status === "sync_issue"
                        ? "Sync needs attention"
                        : "Saved on this device"}
                </h2>
                <p className="mt-2 text-sm text-slate-600">
                  {completedTeamSyncReceipt?.status === "fully_synced"
                    ? "The Team Session and every athlete result were acknowledged."
                    : completedTeamSyncReceipt?.status === "partially_synced_athlete_result_blocked"
                      ? "Accepted results are safe. Blocked athlete results remain on this device and can be retried after approval."
                      : completedTeamSyncReceipt?.status === "sync_issue"
                        ? "The completed Session remains on this device. Use the account sync control to retry."
                        : "The completed Session will upload when a connection is available."}
                </p>
              </section>
              <button
                type="button"
                onClick={() => {
                  setLastCompletedTeamSessionId(null);
                  setPreferredTrainEntryPath("exercises");
                }}
                className="min-h-11 w-full rounded-xl bg-slate-900 px-4 py-3 text-sm font-semibold text-white"
              >
                Back to Exercise Library
              </button>
            </div>
          ) : displayedExerciseExecution ? (
            <div className="space-y-4">
              {isTrainingPlanActive && trainingPlanProgressSummary && planExecution && (
                <TrainingPlanProgress
                  sourcePlanName={planExecution.sourcePlanName}
                  summary={trainingPlanProgressSummary}
                />
              )}
              <ExerciseSoloExecutionScreen
                key={displayedExerciseExecution.id}
                sessionCompletionError={planTransitionError}
                onRetrySessionSave={retryableSessionSave ? retryFailedSessionSave : null}
                exerciseAssetResolver={exerciseAssetResolver}
                execution={displayedExerciseExecution}
                writable={sessionWritable}
                onReplace={handleReplaceExerciseExecution}
                onBackToLibrary={handleBackToExerciseLibrary}
                onStartNewSession={handleFinishPlannedTraining}
                withinTrainingPlan={isTrainingPlanActive}
                progressionActions={isTrainingPlanActive && planExecution && (
                  <TrainingPlanStepTransition
                    appearance="house"
                    nextStepLabel={nextPlanStepLabel}
                    onNextExercise={handleContinueToNextPlanStep}
                    onFinishTraining={handleFinishPlannedTraining}
                    disabled={!sessionWritable}
                    errorMessage={planTransitionError}
                    onRetry={retryableSessionSave ? retryFailedSessionSave : null}
                  />
                )}
              />

              {outstandingSessionWork}
            </div>
          ) : !activeBlock || !activeBlockAnalysis ? (
            // Release Timing keeps its existing setup/runner, but is reached
            // through the Release Time Measured Exercise rather than a
            // top-level Quick Start shortcut.
            <TrainLanding
              completionNotice={finishedTrainingSummary ? finishedTrainingSummary.saved ? "Training saved." : "Training ended. No stones recorded." : undefined}
              exerciseAssetResolver={exerciseAssetResolver}
              releaseTimingSetupContent={
                <div className="space-y-4">
                  <TrainingHeader title="Ready to train." eyebrow="Train / Release Time" />
                  <div>
                    <TrainingSetup
                      submitLabel="Start Training"
                      onSubmit={handleCreateFirstBlock}
                      accuracyToleranceProfiles={
                        accuracyToleranceProfilesState.profiles
                      }
                      defaultAccuracyToleranceProfileId={
                        accuracyToleranceProfilesState.defaultProfileId
                      }
                      smartRandomProfiles={smartRandomProfilesState.profiles}
                      defaultSmartRandomProfileId={
                        smartRandomProfilesState.defaultProfileId
                      }
                      disabled={!sessionWritable}
                    />
                  </div>

                  {/* Optional session naming and notes, behind the same disclosure
                      the block name already uses. Leaving them expanded put two
                      optional text fields between the athlete and Start Training,
                      which is the opposite of the simplification this stage is for. */}
                  <details className="house-training-disclosure">
                    <summary className="flex min-h-11 cursor-pointer items-center text-sm font-medium text-slate-600">
                      Session Name and Notes
                      <span className="ml-2 text-xs font-normal text-slate-400">
                        (optional)
                      </span>
                    </summary>

                    <div className="mt-2">
                      <SessionSettings
                        variant="bare"
                        title={currentSession.title}
                        notes={currentSession.notes}
                        onChangeTitle={handleChangeSessionTitle}
                        onChangeNotes={handleChangeSessionNotes}
                        disabled={!sessionWritable}
                      />
                    </div>
                  </details>
                </div>
              }
              onOpenAssessments={() => handleNavigate("assess")}
              plans={trainingPlans}
              initialEntryPath={preferredTrainEntryPath}
              onEntryPathChange={(path) => {
                setPreferredTrainEntryPath(path);
              }}
              plansTabDisabled={!trainingPlansWritable}
              startPlanDisabled={!sessionWritable}
              onStartExercise={handleStartExercise}
              onCancelReleaseTimingSetup={() =>
                setPendingReleaseTimingExerciseVersion(null)
              }
              startExerciseDisabled={!sessionWritable}
              onSetUpTeamExercise={(version) => {
                setPendingTeamExerciseVersion(snapshotExerciseVersion(version));
                setLastCompletedTeamSessionId(null);
              }}
              teamExerciseStartDisabled={!sportingCloudSync?.ready || !!sportingCloudSync.activeTeamExerciseDraft}
              onSavePlan={handleSaveTrainingPlan}
              onDeletePlan={handleDeleteTrainingPlan}
              onDuplicatePlan={handleDuplicateTrainingPlan}
              onStartPlan={handleStartTrainingPlan}
              accuracyToleranceProfiles={accuracyToleranceProfilesState.profiles}
              defaultAccuracyToleranceProfileId={
                accuracyToleranceProfilesState.defaultProfileId
              }
              smartRandomProfiles={smartRandomProfilesState.profiles}
              defaultSmartRandomProfileId={
                smartRandomProfilesState.defaultProfileId
              }
            />
          ) : (
            <>
              <div className="house-live-context">
                <p className="house-flow-section-title">{activeBlock.name}</p>
                <p className="text-xs text-[var(--house-muted)]">{blockModeLabel(activeBlock.mode)} · {activeBlockMeasurement.quantities.map((quantity) => quantity === "time" ? "Time" : "Speed").join(" + ")}{activeBlockMeasurement.quantities.includes("time") && ` · ${measurementModeLabel(activeBlock.measurementMode ?? "back-hog")}`}</p>
              </div>
              {activeBlock.mode === "blind" ? (
                <>
                  {shotEntryTarget && (
                    <BlindShotEntry
                      key={`${activeBlock.id}-${blindDraftResetToken}`}
                      onAddShot={handleAddShot}
                      target={shotEntryTarget}
                      onDraftStateChange={setHasUnsavedBlindDraft}
                      presetHandle={shotEntryPresetHandle}
                    />
                  )}

                  <p className="px-1 text-xs text-slate-500">
                    Auto Capture isn&apos;t available for Blind Weight yet —
                    prediction must be locked before an automatic reading
                    could be applied.
                  </p>
                </>
              ) : (
                <div className="house-entry-stack">
                  {/* Manual Entry and Auto Capture are two ways to do the
                      same task, not two permanently-stacked panels — a
                      segmented choice while idle; once a sequence is
                      actually running/paused, its own live status takes
                      over and speaks for itself (compositional redesign). */}
                  {/* Auto Capture is a TIME path. A speed-only exercise has no
                      device that could feed it, so the choice is not offered rather
                      than offered and then refused. */}
                  {!autoCaptureIsActive && activeBlockMeasuresTime && (
                    <div
                      role="tablist"
                      aria-label="Shot entry method"
                      className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1"
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={effectiveEntryMode === "manual"}
                        onClick={() => setEntryMode("manual")}
                        className={`min-h-11 rounded-lg px-3 py-2 text-sm font-medium transition ${
                          effectiveEntryMode === "manual"
                            ? "bg-slate-900 text-white"
                            : "text-slate-700 hover:bg-slate-200"
                        }`}
                      >
                        Manual Entry
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={effectiveEntryMode === "auto"}
                        onClick={() => setEntryMode("auto")}
                        className={`min-h-11 rounded-lg px-3 py-2 text-sm font-medium transition ${
                          effectiveEntryMode === "auto"
                            ? "bg-slate-900 text-white"
                            : "text-slate-700 hover:bg-slate-200"
                        }`}
                      >
                        Auto Capture
                      </button>
                    </div>
                  )}

                  {/* Gated on what the block MEASURES and on the EFFECTIVE entry
                      mode, not on a stale `entryMode` left over from the previous
                      exercise. A speed-only block offers no Auto Capture, so a block
                      created while Auto Capture was selected would otherwise have no
                      recordable surface at all. */}
                  {activeBlockMeasurement.quantities.length > 0 &&
                    (autoCaptureIsActive || effectiveEntryMode === "manual") && (
                    <div className={autoCaptureIsActive ? "house-manual-fallback" : "house-primary-entry"}>
                    <ShotEntry
                      appearance="house"
                      key={manualDraftOwnerKey ?? "no-block"}
                      onAddShot={handleAddShot}
                      draft={manualEntryDraftForOwner}
                      onChangeDraft={(draft) => {
                        if (!manualDraftOwnerKey) return;

                        // While the fields still hold a submitted stone's values, a
                        // measurement entered now starts a genuinely NEW stone: the
                        // side the athlete did not touch is still that recorded
                        // stone's reading, and carrying it over would record it a
                        // second time alongside the new one. Metadata says nothing
                        // about where the numbers came from, so choosing a handle or
                        // shot type keeps both the values and their retained marking —
                        // discarding recovery values over a selection would lose a
                        // measurement no write has yet acknowledged.
                        const timeEdited = draft.time !== manualEntryDraftForOwner.time;
                        const speedEdited =
                          draft.speed !== manualEntryDraftForOwner.speed;
                        const startsNewStone =
                          draftMeasurementsAreRetained && (timeEdited || speedEdited);

                        setManualEntryDraft({
                          ownerKey: manualDraftOwnerKey,
                          // Every edit is a NEW revision. That is what makes the next
                          // submission distinguishable from the last one, and what
                          // stops an outstanding acknowledgement from clearing text
                          // the athlete has typed since.
                          revision: nextDraftRevision(),
                          ...draft,
                          ...(startsNewStone
                            ? {
                                time: timeEdited ? draft.time : "",
                                speed: speedEdited ? draft.speed : "",
                              }
                            : {}),
                          retainedRevision: startsNewStone
                            ? null
                            : ownedManualDraft?.retainedRevision ?? null,
                        });
                      }}
                      target={shotEntryTarget}
                      measurement={activeBlockMeasurement}
                      level={autoCaptureIsActive ? "primary" : "hero"}
                      disabled={!sessionWritable}
                      errorMessage={shotEntryError}
                    />
                    </div>
                  )}

                  {(autoCaptureIsActive || effectiveEntryMode === "auto") &&
                    nextShotTarget !== undefined && (
                    <AutoCapture
                      activeBlock={activeBlock}
                      captureSequence={currentSession.captureSequence}
                      currentTargetTime={nextShotTarget}
                      manualHandle={captureManualHandle}
                      onChangeManualHandle={setCaptureManualHandle}
                      manualTargetInput={captureManualTargetInput}
                      onChangeManualTargetInput={setCaptureManualTargetInput}
                      lastCaptureMessage={lastCaptureMessage}
                      onStart={handleStartCaptureSequence}
                      onPause={handlePauseCaptureSequence}
                      onResume={handleResumeCaptureSequence}
                      onCancel={handleCancelCaptureSequence}
                      onUndo={handleUndoLastCapturedShot}
                      onManualResult={handleManualCaptureResult}
                      isDevEnvironment={IS_DEV}
                      level={autoCaptureIsActive ? "hero" : "primary"}
                    />
                  )}

                  {/* A real timer alongside Auto Capture, never instead of it: manual
                      entry and the manual fallback both stay exactly where they were. */}
                  {(autoCaptureIsActive || effectiveEntryMode === "auto") && (
                    <BrowerAssistedCapturePanel
                      key={`${currentSession.id}:${activeBlock.id}`}
                      controller={browerController}
                      context={browerCaptureContext}
                      onAccept={handleAcceptBrowerCandidate}
                      onRetrySave={retryBrowerSave}
                    />
                  )}

                  {IS_DEV && activeBlock.measurementMode && (
                    <TimingSimulatorPanel
                      provider={simulatorProvider}
                      measurementMode={activeBlock.measurementMode}
                      diagnostics={captureDiagnostics}
                    />
                  )}
                </div>
              )}

              <section aria-label="Live Performance" className="house-live-average">
                <p className="text-sm text-[var(--house-muted)]">{activeBlockShots.length} {activeBlockShots.length === 1 ? "stone" : "stones"} recorded</p>
                <div className="flex flex-wrap gap-4">
                  {activeBlockMeasurement.quantities.map((quantity) => {
                    const values = activeBlockShots.map((shot) => shotMeasuredValue(shot, quantity))
                      .filter((value): value is number => value !== null);
                    return <div key={quantity}>
                      <p className="text-xs text-[var(--house-muted)]">Average {quantity === "speed" ? "speed" : "time"}</p>
                      <p className="text-2xl font-medium tabular-nums">
                        {values.length === 0 ? "—" : quantity === "speed"
                          ? formatMeasuredSpeed(average(values)) : formatReleaseTime(average(values))}
                      </p>
                      <p className="text-xs text-[var(--house-muted)]">{values.length} {values.length === 1 ? "measurement" : "measurements"}</p>
                    </div>;
                  })}
                </div>
              </section>

              {outstandingSessionWork}

              {isTrainingPlanActive && trainingPlanProgressSummary && planExecution && (
                <TrainingPlanProgress
                  sourcePlanName={planExecution.sourcePlanName}
                  summary={trainingPlanProgressSummary}
                />
              )}

              {/* Directly after the recording task and before the optional analytics:
                  the plan's controls are the athlete's next decision, not a footer
                  action buried under the session's charts and export. */}
              {isTrainingPlanActive && planExecution && (
                <TrainingPlanStepTransition
                  appearance="house"
                  nextStepLabel={nextPlanStepLabel}
                  onNextExercise={handleContinueToNextPlanStep}
                  onFinishTraining={handleFinishPlannedTraining}
                  disabled={!sessionWritable}
                  errorMessage={planTransitionError}
                  onRetry={retryableSessionSave ? retryFailedSessionSave : null}
                />
              )}

              {!isTrainingPlanActive && <CompleteSessionAction
                onComplete={handleFinishPlannedTraining} disabled={!sessionWritable}
                errorMessage={planTransitionError}
                onRetry={retryableSessionSave ? retryFailedSessionSave : null} />}

                  {/* Secondary action — kept visually subordinate to the
                      block identity beside it and to the primary shot-entry
                      action below (DESIGN_SYSTEM.md §19.1/§12.2). */}
                  {!isTrainingPlanActive && (
                    <button
                      type="button"
                      onClick={handleOpenNewBlockModal}
                      disabled={!sessionWritable}
                      className={activeBlock.mode === "fixed" ? "house-link shrink-0 whitespace-nowrap text-sm disabled:opacity-50" : "min-h-11 whitespace-nowrap rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"}
                    >
                      New Training Block
                    </button>
                  )}
              <details className="house-training-disclosure">
                <summary>Exercise settings</summary>
              {/* Essential context, not the Hero — the current target/capture
                  task below carries the strongest surface (Epic 1). */}
              <div className="px-1 py-2">
                <div className="flex flex-col items-start gap-1 sm:flex-row sm:justify-between sm:gap-4">
                  <div className="min-w-0">
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Current exercise
                    </p>

                    <h2 className="mt-1 break-words text-2xl font-medium text-[var(--house-ink)]">
                      {activeBlock.name}
                    </h2>

                    <p className="mt-1 text-sm text-slate-600">
                      {blockModeLabel(activeBlock.mode)}
                      {activeBlock.mode === "variable" &&
                        activeBlock.variableTargetMode && (
                          <> ({variableTargetModeLabel(
                            activeBlock.variableTargetMode
                          )})</>
                        )}
                      {activeBlock.mode === "blind" &&
                        activeBlock.blindTargetMode && (
                          <> ({blindTargetModeLabel(
                            activeBlock.blindTargetMode
                          )})</>
                        )}{" "}
                      {activeBlock.measurementMode && (
                        <>· {measurementModeLabel(activeBlock.measurementMode)}</>
                      )}
                      {activeBlock.targetTime !== undefined &&
                        (activeBlock.mode === "fixed" ||
                          (activeBlock.mode === "blind" &&
                            activeBlock.blindTargetMode === "fixed")) && (
                          <> · Target {activeBlock.targetTime.toFixed(2)}s</>
                        )}
                      {(activeBlock.variableTargetMode === "smart-random" ||
                        activeBlock.blindTargetMode === "smart-random") &&
                        activeBlock.smartRandomMin !== undefined &&
                        activeBlock.smartRandomMax !== undefined && (
                          <>
                            {" "}
                            · Range {activeBlock.smartRandomMin.toFixed(2)}s–
                            {activeBlock.smartRandomMax.toFixed(2)}s
                          </>
                        )}
                    </p>

                    <p className="mt-1 text-xs text-slate-500">
                      {activeBlockShots.length} shot
                      {activeBlockShots.length === 1 ? "" : "s"}{" "}
                      total
                    </p>
                  </div>

                </div>
              </div>


              </details>

              {/* Recent Shots — and its inline Edit/Delete controls — is a
                  correction tool, not the primary analysis surface, so it
                  stays collapsed by default and below Live Performance
                  ("Editing previous shots is an exception workflow.
                  Monitoring performance is the primary workflow."). */}
              <details className="house-training-disclosure">
                <summary>Recorded stones ({filteredActiveBlockShots.length})</summary>
                <div>
                  <div className="space-y-2">
                  {filteredActiveBlockShots.map((shot) => {
                    const isEditing =
                      editingShot?.id === shot.id;

                    return (
                      <div
                        key={shot.id}
                        className={surfaceClass("inset")}
                      >
                        {isEditing ? (
                          <div className="space-y-3">
                            <input
                              type="number"
                              step="0.01"
                              value={editingShot.releaseTime}
                              onChange={(event) =>
                                setEditingShot({
                                  ...editingShot,
                                  releaseTime:
                                    event.target.value,
                                })
                              }
                              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
                            />

                            <select
                              value={editingShot.handle}
                              onChange={(event) =>
                                setEditingShot({
                                  ...editingShot,
                                  handle:
                                    event.target
                                      .value as Handle,
                                })
                              }
                              className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
                            >
                              <option value="in">In</option>
                              <option value="out">Out</option>
                            </select>

                            {activeBlock.mode !== "blind" && (
                              <select
                                value={editingShot.shotType}
                                onChange={(event) =>
                                  setEditingShot({
                                    ...editingShot,
                                    shotType:
                                      event.target
                                        .value as ShotType,
                                  })
                                }
                                className="w-full rounded-xl border border-slate-300 bg-white px-4 py-3 text-slate-900"
                              >
                                <option value="draw">
                                  Draw
                                </option>

                                <option value="takeout">
                                  Takeout
                                </option>
                              </select>
                            )}

                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={
                                  handleSaveEditedShot
                                }
                                className="flex-1 rounded-xl bg-slate-900 px-4 py-3 font-medium text-white"
                              >
                                Save
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  setEditingShot(null)
                                }
                                className="flex-1 rounded-xl bg-slate-200 px-4 py-3 font-medium text-slate-700"
                              >
                                Cancel
                              </button>
                            </div>
                          </div>
                        ) : activeBlock.mode === "blind" &&
                          shot.predictedTime !== undefined ? (
                          <div className="flex items-center justify-between gap-3">
                            <div className="text-sm">
                              <p className="font-medium text-slate-900">
                                Shot {shot.shotNumber}
                              </p>
                              <p className="text-slate-600">
                                Target {formatMeasuredSeconds(shot.targetTime)} ·
                                Prediction {shot.predictedTime.toFixed(2)} ·
                                Actual {formatMeasuredSeconds(shot.releaseTime)}
                              </p>
                              {shot.releaseTime !== undefined && (
                                <p className="text-slate-600">
                                  Prediction Error{" "}
                                  {formatSigned(
                                    shot.predictedTime - shot.releaseTime
                                  )}
                                </p>
                              )}
                            </div>

                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  handleStartEditingShot(shot)
                                }
                                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
                              >
                                Edit
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  handleDeleteShot(shot.id)
                                }
                                className="rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-200"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        ) : (
                          <div className="flex items-center justify-between gap-3">
                            <div>
                              <p className="text-slate-600">
                                #{shot.shotNumber} ·{" "}
                                {shot.handle === "in"
                                  ? "In"
                                  : "Out"}
                                {shot.shotType && (
                                  <> · {shot.shotType}</>
                                )}
                              </p>

                              {/* Every measurement this block records, each with its
                                  own unit, target, signed deviation and category —
                                  and an explicit "not recorded" for one that is
                                  genuinely still missing. */}
                              <MeasuredShotSummary
                                shot={shot}
                                measurement={activeBlockMeasurement}
                              />
                            </div>

                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  handleStartEditingShot(
                                    shot
                                  )
                                }
                                className="rounded-lg bg-slate-900 px-3 py-2 text-sm font-medium text-white transition hover:bg-slate-700"
                              >
                                Edit
                              </button>

                              <button
                                type="button"
                                onClick={() =>
                                  handleDeleteShot(
                                    shot.id
                                  )
                                }
                                className="rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-200"
                              >
                                Delete
                              </button>
                            </div>
                          </div>
                        )}
                      </div>
                    );
                  })}
                  </div>
                </div>
              </details>

              {/* Session Details During Execution (DESIGN_SYSTEM.md §19.6):
                  collapsed by default rather than repeating the entire
                  Target Time / Session Name / Notes setup form after the
                  analytics area — the athlete opens it explicitly via Edit
                  Details when they actually need to change something. */}
              <details className="group rounded-2xl border border-slate-200 bg-white">
                <summary className="cursor-pointer list-none rounded-2xl px-4 py-3 text-sm font-medium text-slate-700 marker:content-none group-open:rounded-b-none">
                  <span className="flex items-center justify-between gap-2">
                    <span>
                      Edit Details — {currentSession.title || "Untitled Session"}
                    </span>
                    <span className="text-xs text-slate-400 group-open:hidden">
                      Show
                    </span>
                    <span className="hidden text-xs text-slate-400 group-open:inline">
                      Hide
                    </span>
                  </span>
                </summary>

                <div className="space-y-4 border-t border-slate-100 p-4">
                  {activeBlock.targetTime !== undefined &&
                    (activeBlock.mode === "fixed" ||
                    (activeBlock.mode === "blind" &&
                      activeBlock.blindTargetMode === "fixed")) && (
                    <TargetTimeSettings
                      key={activeBlock.id}
                      variant="bare"
                      targetTime={activeBlock.targetTime}
                      onChangeTargetTime={
                        handleChangeActiveBlockTargetTime
                      }
                      disabled={!sessionWritable}
                    />
                  )}

                  <SessionSettings
                    variant="bare"
                    title={currentSession.title}
                    notes={currentSession.notes}
                    onChangeTitle={handleChangeSessionTitle}
                    onChangeNotes={handleChangeSessionNotes}
                    disabled={!sessionWritable}
                  />
                </div>
              </details>


            </>
          )}

        </div>
      )}

      {activeView === "assess" && assessmentState && (
        <>
          <button type="button" className="house-link text-sm" onClick={() => handleNavigate("train")}>← Train</button>
          <AssessScreen
            assessmentState={assessmentState}
            updateAssessmentState={updateAssessmentState}
            assessmentHydration={assessmentHydration}
            isTrainingCaptureActive={isCaptureSequenceActive(
              currentSession?.captureSequence
            )}
            executedHandle={assessmentExecutedHandle}
            onChangeExecutedHandle={setAssessmentExecutedHandle}
            showSimulatorOption={IS_DEV}
            onSubmitManualTime={(value) =>
              processIncomingTimingResult(
                createManualTimingResult("back-hog", value)
              )
            }
            captureStatusMessage={assessmentLastCaptureMessage}
            pendingReloadRecovery={
              pendingReloadRecoveryRunId === assessmentState.currentRun?.id &&
              pendingReloadRecoveryRunId !== null
            }
            onConsumedReloadRecovery={() => setPendingReloadRecoveryRunId(null)}
            quarantineNotice={assessmentQuarantineNotice}
            onDismissQuarantineNotice={() => setAssessmentQuarantineNotice(null)}
            onViewFullResults={(runId) => setViewingAssessmentResultRunId(runId)}
          />

          {IS_DEV &&
            assessmentState.currentRun &&
            (assessmentState.currentRun.status === "warmup" ||
              assessmentState.currentRun.status === "in_progress") && (
              <TimingSimulatorPanel
                provider={simulatorProvider}
                measurementMode="back-hog"
                diagnostics={assessmentDiagnostics}
              />
            )}
        </>
      )}

      {activeView === "analyze" && (
        <>
          <TrainingHeader title="See your progress." eyebrow="Analyze" />
          {/* Training / Assessments / Exercise Results are distinct domain
              concepts that happen to share this one
              Analyze destination — see
              docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md's Analyze
              Integration section. Switching tabs never resets the other
              tab's filters/state (each keeps its own independent state).
              Rendered as an inline segmented control (Level 1 subtle
              surface, DESIGN_SYSTEM.md §13) — the page-level PageHeader
              above already identifies this screen as "Analyze", so this no
              longer repeats that title in its own card. */}
          <div
            role="tablist"
            aria-label="Analyze section"
            className="grid grid-cols-3 gap-1 rounded-xl bg-slate-100 p-1"
          >
            <button
              type="button"
              role="tab"
              id={analyzeTabId("training")}
              aria-controls={analyzePanelId}
              aria-selected={analyzeTab === "training"}
              tabIndex={analyzeTab === "training" ? 0 : -1}
              onClick={() => setAnalyzeTab("training")}
              onKeyDown={handleAnalyzeTabKeyDown}
              className={`min-h-11 rounded-lg px-2 py-2 text-xs font-medium transition sm:px-3 sm:text-sm ${
                analyzeTab === "training"
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-200"
              }`}
            >
              Training
            </button>
            <button
              type="button"
              role="tab"
              id={analyzeTabId("assessments")}
              aria-controls={analyzePanelId}
              aria-selected={analyzeTab === "assessments"}
              tabIndex={analyzeTab === "assessments" ? 0 : -1}
              onClick={() => setAnalyzeTab("assessments")}
              onKeyDown={handleAnalyzeTabKeyDown}
              className={`min-h-11 rounded-lg px-2 py-2 text-xs font-medium transition sm:px-3 sm:text-sm ${
                analyzeTab === "assessments"
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-200"
              }`}
            >
              Assessments
            </button>
            <button
              type="button"
              role="tab"
              id={analyzeTabId("exercises")}
              aria-controls={analyzePanelId}
              aria-selected={analyzeTab === "exercises"}
              tabIndex={analyzeTab === "exercises" ? 0 : -1}
              onClick={() => setAnalyzeTab("exercises")}
              onKeyDown={handleAnalyzeTabKeyDown}
              className={`min-h-11 rounded-lg px-2 py-2 text-xs font-medium transition sm:px-3 sm:text-sm ${
                analyzeTab === "exercises"
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-200"
              }`}
            >
              Exercises
            </button>
          </div>

          <div
            role="tabpanel"
            id={analyzePanelId}
            aria-labelledby={analyzeTabId(analyzeTab)}
            className="space-y-4"
          >

            {analyzeTab === "exercises" && sportingCloudSync && (
              <ExerciseTeamResultsScreen
                results={sportingCloudSync.teamExerciseResults}
                readStatus={sportingCloudSync.teamExerciseResultReadStatus}
                onRefresh={sportingCloudSync.refreshMyTeamExerciseResults}
                onSetPrivateNote={sportingCloudSync.setMyTeamExercisePrivateNote}
                onReviseResult={sportingCloudSync.reviseMyTeamExerciseResult}
                onVoidResult={sportingCloudSync.voidMyTeamExerciseResult}
              />
            )}

          {analyzeTab === "assessments" && assessmentState && (
            <AssessmentAnalyze
              assessmentState={assessmentState}
              onViewResult={(runId) => setViewingAssessmentResultRunId(runId)}
              onResumeCurrent={() => handleNavigate("assess")}
              onGoToAssess={() => handleNavigate("assess")}
              onDeleteRun={handleDeleteAssessmentRun}
            />
          )}

          {analyzeTab === "training" && (
          <>
          {currentSession && sessionHasArchivableActivity(currentSession) && (
            <div className={surfaceClass("utility")} role="note">
              <p className="text-sm font-medium text-slate-800">
                Current training not included yet
              </p>
              <p className="mt-1 text-sm text-slate-600">
                Complete your training to see its time and speed measurements here.
              </p>
            </div>
          )}

          {/* 1. Sticky Analysis Filters — readiness gating
              (docs/PERSISTENCE_BOUNDARY_DESIGN.md §7.10). While
              historyFiltersHydration is "loading", the stored filters
              haven't been applied yet, so the interactive control (backed by
              createDefaultHistoryFilters()) stays unrendered entirely rather
              than exposing a default a user could change and lose the
              instant loading resolves. Once loading settles, the control
              always renders — but "write_protected" (a genuine read
              failure) renders it `disabled`: the documented fallback stays
              visible, every control inside is non-interactive, and (per
              handleChangeHistoryFilters below) even a bypassed interaction
              could not mutate state. This corrects the prior revision,
              which left History Filters mutable-but-never-persisted after
              write_protected — see
              PERSISTENCE_BOUNDARY_PHASE1_FINAL_CORRECTION_REPORT.md. */}
          {historyFiltersHydration === "loading" ? (
            <div className={surfaceClass("primary")}>
              <p className="text-sm text-slate-500">Loading filters…</p>
            </div>
          ) : (
            <HistoryFilterBar
              filters={effectiveHistoryFilters}
              onChange={handleChangeHistoryFilters}
              availableTrainingCategories={
                historyAnalysisContext.availableTrainingCategories
              }
              availableMeasurementModes={
                historyAnalysisContext.availableMeasurementModes
              }
              availableMeasuredQuantities={
                historyAnalysisContext.availableMeasuredQuantities
              }
              sessions={sessionHistory}
              disabled={historyFiltersHydration !== "ready"}
            />
          )}

          {historyAnalysisContext.totalShotCount > 0 ? (
            <>
              {/* 1. The one Hero on this screen answers "what should I learn
                  from this training?" before any metric — a key-takeaway
                  sentence, not a dashboard (Epic 2:
                  docs/INFORMATION_ARCHITECTURE_AND_SCREEN_PHILOSOPHY.md's
                  Analyze hierarchy: "Key takeaway" precedes "Summary
                  metrics"). "What am I looking at" stays directly above it —
                  context the takeaway needs to be read correctly, not a
                  metric itself. */}
              <div className={surfaceClass("hero")}>
                <AnalysisContextSummary context={historyAnalysisContext} variant="bare" />

                <div className="mt-4 border-t border-slate-100 pt-4">
                  <p className="text-xs font-semibold uppercase tracking-wide text-slate-400">
                    What should I learn from this?
                  </p>

                  <p className="mt-2 text-lg font-semibold text-slate-900">
                    {/* The insight is derived from release-time progression and has no
                        speed counterpart. Showing it under a Speed selection would
                        answer a question about seconds while the athlete is looking at
                        m/s, so it is withheld rather than relabelled. */}
                    {!historyShowsTime
                      ? "Speed figures are shown below. Trends over time are available for release time."
                      : trainingInsight
                        ? trainingInsight.headline
                        : "Complete another comparable block to see whether your results are changing."}
                  </p>
                </div>
              </div>

              {/* 2. Summary metrics — demoted beneath the takeaway rather
                  than leading the screen (a standard, not a Hero, surface). */}
              <div className={surfaceClass("primary")}>
                <h2 className="text-sm font-semibold text-slate-500">
                  Key Progress Summary
                </h2>

                {/* One group per measured quantity actually present, each in its own
                    unit, with its own targets, tolerance labels and denominator.
                    Seconds and m/s are never merged, and a quantity the selection does
                    not contain produces no empty figures at all. */}
                {historyQuantities.map((quantity) => (
                  <div key={quantity} className="mt-4">
                    {historyLabelsQuantities && (
                      <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
                        {quantity === "speed"
                          ? "Speed (metres per second)"
                          : "Time (seconds)"}
                      </h3>
                    )}

                    <div className="grid grid-cols-2 gap-3">
                      {quantity === "speed" ? (
                        <TargetAccuracyDashboardCards
                          quantity="speed"
                          targetAccuracy={historySpeedAccuracy}
                          thresholds={historySpeedTolerance}
                        />
                      ) : (
                        <>
                          <TargetAccuracyDashboardCards
                            targetAccuracy={historyTargetAccuracy}
                            measurementMode={
                              effectiveHistoryFilters.measurementMode ?? "back-hog"
                            }
                            thresholds={
                              historyAnalysisContext.thresholdsVaryAcrossBlocks
                                ? null
                                : historyTimeTolerance
                            }
                          />

                          {historyAnalysisContext.hasBlindCategory && (
                            <PredictionDashboardCards analysis={historyFullAnalysis} />
                          )}
                        </>
                      )}
                    </div>
                  </div>
                ))}
              </div>

              {historyShowsTime && effectiveHistoryFilters.measurementMode && (
                // 4. The featured primary trend — one chart answering "is my
                // release becoming more consistent", ahead of the other
                // charts (MOBUX §19: "primary trend" is its own tier, before
                // "accuracy and bias").
                <ProgressMetricChart
                  entries={historyAnalysisContext.progressEntries}
                  measurementMode={effectiveHistoryFilters.measurementMode}
                />
              )}

              {/* 5-7. Detailed Analysis — accuracy/bias, target and handle
                  questions grouped under one open section instead of three
                  more same-weight chart cards (compositional redesign). */}
              <details className="house-support">
                <summary>Detailed Analysis</summary>

                <div className="mt-3 space-y-4">
                  {/* Every chart and comparison below plots a release TIME against a
                      time target, judged by seconds-based thresholds. None has a speed
                      counterpart yet, so under a Speed selection they are withheld
                      rather than relabelled — a seconds axis titled m/s would be worse
                      than no chart. */}
                  {!historyShowsTime && (
                    <p className="px-1 text-xs text-slate-500">
                      Charts and handle comparison are available for release time.
                      Speed figures are shown in the summary above and in each
                      session&apos;s detail below.
                    </p>
                  )}

                  {historyShowsTime &&
                    effectiveHistoryFilters.measurementMode && (
                    <ShotQualityTrendChart
                      entries={historyAnalysisContext.progressEntries}
                      measurementMode={effectiveHistoryFilters.measurementMode}
                    />
                  )}

                  {historyShowsTime && (
                    <>
                      <TargetActualScatterChart
                        points={historyScatterPoints}
                        explanation={targetVsActualExplanation("history")}
                        notices={historyScatterNotices}
                      />

                      <HandleAnalysisSection
                        boxPlots={computeHandleTargetErrorBoxPlots(
                          historyAnalysisContext.shots
                        )}
                        comparison={computeHandleAccuracyComparison(
                          historyAnalysisContext.shots,
                          historyTimeTolerance
                        )}
                      />
                    </>
                  )}
                </div>
              </details>
            </>
          ) : (
            <AnalysisContextSummary context={historyAnalysisContext} />
          )}

          {/* 8. Blocks and Sessions — detail/navigation list onto the same
              central selection; it never dominates the analysis above
              (Epic 1: history visibly steps back). */}
          <div className={surfaceClass("secondary")}>
            <div className="flex items-start justify-between gap-4">
              <h2 className="text-xl font-semibold text-slate-900">
                Blocks and Sessions
              </h2>
            </div>

            <div className="mt-4 space-y-3">
              {historySessionGroups.length === 0 && (
                <p className="text-sm text-slate-500">
                  No sessions match the current filters.
                </p>
              )}

              {historySessionGroups.map(({ session, entries }) => {
                // Judged on the EFFECTIVE per-side tolerance, which is what
                // `aggregateTargetAccuracyAcrossBlocks` below actually classifies
                // against. The legacy symmetric pair can be identical across blocks
                // whose real tolerances differ, so using it here would let one cutoff
                // stand for all of them.
                const sessionTolerancesUniform = hasUniformTimeTolerance(entries);
                const sessionTimeTolerance = representativeTimeTolerance(entries);
                const sessionMeasurementModesUniform = entries.every(
                  (entry) =>
                    entry.block.measurementMode ===
                    entries[0]?.block.measurementMode
                );
                const sessionTargetAccuracy =
                  aggregateTargetAccuracyAcrossBlocks(entries);
                const sessionShots = entries.flatMap((entry) => entry.shots);
                const sessionAnalysis = analyzeShots(
                  sessionShots,
                  sessionTimeTolerance
                );
                // A session may legitimately contain no time measurement at all (a
                // speed-only training). Its seconds figures are then withheld rather
                // than shown as "0.00s" — a reader cannot tell a fabricated zero from
                // a real measurement.
                const sessionTimeCount = timeMeasuredShots(sessionShots).length;
                const sessionSpeedShots = speedMeasuredShots(sessionShots);
                // One tolerance may stand for the whole selection only if every block
                // that records speed was judged against the same one.
                const sessionSpeedTolerances = entries
                  .map((entry) => blockTolerance(entry.block, "speed"))
                  .filter((tolerance): tolerance is QuantityTolerance => tolerance !== undefined);
                const sessionSpeedTolerance =
                  sessionSpeedTolerances.length > 0 &&
                  sessionSpeedTolerances.every(
                    (tolerance) =>
                      JSON.stringify(tolerance) ===
                      JSON.stringify(sessionSpeedTolerances[0])
                  )
                    ? sessionSpeedTolerances[0]
                    : null;
                // Classified per BLOCK against its own snapshot, exactly as the
                // top-level rollup does. A shared cutoff may be absent — two blocks
                // can legitimately have been trained under different bands — but that
                // is a LABELLING fact, not a reason to withhold the measurements and
                // the aggregate result, which previously vanished entirely.
                const sessionSpeedAccuracy =
                  sessionSpeedShots.length > 0
                    ? aggregateQuantityAccuracyAcrossBlocks(entries, "speed")
                    : null;
                const blocksWithShots = entries.filter(
                  (entry) => entry.shots.length > 0
                );

                return (
                  <div
                    key={session.id}
                    className={surfaceClass("inset")}
                  >
                    <div className="flex items-start justify-between gap-4">
                      <button
                        type="button"
                        onClick={() =>
                          toggleSessionExpanded(
                            session.id
                          )
                        }
                        className="flex-1 text-left"
                      >
                        <p className="font-semibold text-slate-900">
                          {session.title}
                        </p>

                        <p className="mt-1 text-sm text-slate-500">
                          {new Date(
                            session.date
                          ).toLocaleDateString()}
                        </p>

                        {session.planExecution && (
                          <p className="mt-1 text-xs text-slate-500">
                            Started from: {session.planExecution.sourcePlanName}
                          </p>
                        )}

                        <p className="mt-2 text-xs font-medium text-slate-700">
                          {expandedSessions[
                            session.id
                          ]
                            ? "Hide Details"
                            : "Show Details"}
                        </p>
                      </button>

                      <button
                        type="button"
                        onClick={() =>
                          handleDeleteHistorySession(
                            session.id
                          )
                        }
                        disabled={!sessionWritable}
                        className="rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>

                    {expandedSessions[session.id] && (
                      <div className="mt-4 space-y-4">
                        {!sessionTolerancesUniform && (
                          <p className="text-xs text-slate-500">
                            Tolerances vary across blocks in this session. Each
                            block&rsquo;s stones are still counted against the
                            tolerance it was trained under, so no single cutoff is
                            shown below.
                          </p>
                        )}
                        {!sessionMeasurementModesUniform && (
                          <p className="text-xs text-slate-500">
                            Measurement modes vary within this session — bias
                            tendency is shown for{" "}
                            {measurementModeLabel(
                              entries[0]?.block.measurementMode ?? "back-hog"
                            )}{" "}
                            only.
                          </p>
                        )}

                        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                          {sessionTimeCount > 0 && (
                            <>
                              <DashboardCard
                                label="Average"
                                value={formatReleaseTime(sessionAnalysis.average)}
                              />

                              <DashboardCard
                                label="Release SD"
                                value={sessionAnalysis.releaseTimeStandardDeviation.toFixed(3)}
                              />

                              <TargetAccuracyDashboardCards
                                targetAccuracy={sessionTargetAccuracy}
                                measurementMode={
                                  entries[0]?.block.measurementMode ?? "back-hog"
                                }
                                thresholds={
                                  sessionTolerancesUniform ? sessionTimeTolerance : null
                                }
                              />
                            </>
                          )}

                          {/* Shown in its own unit, under its own heading, and never
                              averaged together with the seconds figures above. */}
                          {sessionSpeedAccuracy && (
                            <>
                              <DashboardCard
                                label="Average Speed"
                                value={formatMeasuredSpeed(
                                  average(
                                    sessionSpeedShots.map((shot) => shot.speed)
                                  )
                                )}
                              />

                              <DashboardCard
                                label="Speed SD"
                                value={standardDeviationOfValues(
                                  sessionSpeedShots.map((shot) => shot.speed)
                                ).toFixed(3)}
                              />

                              <TargetAccuracyDashboardCards
                                quantity="speed"
                                targetAccuracy={sessionSpeedAccuracy}
                                thresholds={sessionSpeedTolerance}
                              />
                            </>
                          )}

                          {entries.some(
                            (entry) => entry.block.mode === "blind"
                          ) && (
                            <PredictionDashboardCards
                              analysis={sessionAnalysis}
                            />
                          )}
                        </div>

                        <div className="space-y-3">
                          <h3 className="font-semibold text-slate-900">
                            By Training Block
                          </h3>

                          {blocksWithShots.map(
                            ({ block, shots, timeTolerance }) => (
                              <HistoryBlockPanel
                                key={block.id}
                                block={block}
                                shots={shots}
                                timeTolerance={timeTolerance}
                              />
                            )
                          )}
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
          </>
          )}
          </div>
        </>
      )}

      {showNewBlockModal && activeBlock && (
        <NewTrainingBlock
          onCreate={handleCreateNewBlock}
          onCancel={() => setShowNewBlockModal(false)}
          outgoingBlock={activeBlock}
          outgoingBlockShots={activeBlockShots}
          accuracyToleranceProfiles={accuracyToleranceProfilesState.profiles}
          defaultAccuracyToleranceProfileId={
            accuracyToleranceProfilesState.defaultProfileId
          }
          smartRandomProfiles={smartRandomProfilesState.profiles}
          defaultSmartRandomProfileId={smartRandomProfilesState.defaultProfileId}
        />
      )}

      {showAccuracyToleranceProfilesManager && (
        <AccuracyToleranceProfilesScreen
          profiles={accuracyToleranceProfilesState.profiles}
          defaultProfileId={accuracyToleranceProfilesState.defaultProfileId}
          onCreate={handleCreateAccuracyToleranceProfile}
          onUpdate={handleUpdateAccuracyToleranceProfile}
          onDuplicate={handleDuplicateAccuracyToleranceProfile}
          onDelete={handleDeleteAccuracyToleranceProfile}
          onSetDefault={handleSetDefaultAccuracyToleranceProfile}
          onClose={() => setShowAccuracyToleranceProfilesManager(false)}
        />
      )}

      {showSmartRandomProfilesManager && (
        <SmartRandomProfilesScreen
          profiles={smartRandomProfilesState.profiles}
          defaultProfileId={smartRandomProfilesState.defaultProfileId}
          onCreate={handleCreateSmartRandomProfile}
          onUpdate={handleUpdateSmartRandomProfile}
          onDuplicate={handleDuplicateSmartRandomProfile}
          onDelete={handleDeleteSmartRandomProfile}
          onSetDefault={handleSetDefaultSmartRandomProfile}
          onClose={() => setShowSmartRandomProfilesManager(false)}
        />
      )}

      {showTeamsScreen && <TeamsScreen onClose={() => setShowTeamsScreen(false)} />}

      {/* Owned by Settings, where it is opened. Gated on `activeView` as well as the
          flag so that ANY path which changes the view — including the three that call
          `setActiveView` directly for Train — unmounts this overlay and releases its
          connection, rather than relying on the flag reset in `commitNavigation` alone. */}
      {IS_DEV && showBleDiagnostic && activeView === "settings" && (
        <BrowerBleDiagnosticScreen onClose={() => setShowBleDiagnostic(false)} />
      )}

      {confirmAction && (
        <ConfirmModal
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={
            confirmAction.confirmLabel
          }
          isDanger={confirmAction.isDanger}
          onConfirm={confirmAction.onConfirm}
          onCancel={() =>
            setConfirmAction(null)
          }
        />
      )}
      </>
      )}
    </div>
  );
}


type HistoryBlockPanelProps = {
  block: TrainingBlock;
  shots: Shot[];
  /**
   * The effective tolerance for this View — the block's own snapshot in Original
   * mode, or the active Comparison preset. Never re-derived from
   * block.accuracyThresholds here, so Comparison mode can override it.
   *
   * ONE value drives both the classification and every label and band drawn from it;
   * there is deliberately no second, symmetric copy that could disagree with it.
   */
  timeTolerance: QuantityTolerance;
};

function HistoryBlockPanel({
  block,
  shots,
  timeTolerance,
}: HistoryBlockPanelProps) {
  const analysis = analyzeShots(shots, timeTolerance);
  const blockMap = new Map([[block.id, block]]);

  // What this block actually measures. A legacy block resolves to time-only, so every
  // existing history panel renders exactly as before.
  const measurement = resolveBlockMeasurement(block);
  const measuresTime = measurement.quantities.includes("time");
  const speedTolerance = measurement.speed?.tolerance;
  const speedShots = speedMeasuredShots(shots);
  const speedAccuracy =
    speedShots.length > 0 && speedTolerance
      ? computeQuantityAccuracyAnalytics(shots, "speed", speedTolerance)
      : null;

  // The collapsed header's one figure comes from whichever quantity this block
  // actually recorded — never a time rate for a block that measured no time.
  const headerAccuracy = measuresTime ? analysis.targetAccuracy : speedAccuracy;
  const onTargetPercent =
    headerAccuracy && headerAccuracy.shotCount > 0
      ? Math.round((headerAccuracy.onTargetRate ?? 0) * 100)
      : null;

  return (
    // Compact row with on-demand detail, not a second full dashboard per
    // block (Epic 2 / audit finding: session expansion previously repeated
    // the entire aggregate analysis for every block underneath it).
    <details className="group rounded-xl bg-white">
      <summary className="cursor-pointer list-none rounded-xl p-4 marker:content-none">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="font-semibold text-slate-900">
              {block.name}
            </p>

            <p className="mt-1 text-xs text-slate-500">
              {blockModeLabel(block.mode)}
              {block.mode === "variable" && block.variableTargetMode && (
                <> ({variableTargetModeLabel(block.variableTargetMode)})</>
              )}
              {block.mode === "blind" && block.blindTargetMode && (
                <> ({blindTargetModeLabel(block.blindTargetMode)})</>
              )}{" "}
              {block.measurementMode && (
                <>· {measurementModeLabel(block.measurementMode)}</>
              )}
              {block.targetTime !== undefined &&
                (block.mode === "fixed" ||
                  (block.mode === "blind" &&
                    block.blindTargetMode === "fixed")) && (
                  <> · Target {block.targetTime.toFixed(2)}s</>
                )}
              {(block.variableTargetMode === "smart-random" ||
                block.blindTargetMode === "smart-random") &&
                block.smartRandomMin !== undefined &&
                block.smartRandomMax !== undefined && (
                  <>
                    {" "}
                    · Range {block.smartRandomMin.toFixed(2)}s–
                    {block.smartRandomMax.toFixed(2)}s
                  </>
                )}
            </p>
          </div>

          <div className="whitespace-nowrap text-right text-xs text-slate-500">
            <p>
              {shots.length} shot{shots.length === 1 ? "" : "s"}
              {onTargetPercent !== null && <> · {onTargetPercent}% on target</>}
            </p>
            <p className="mt-1 font-medium text-slate-700 group-open:hidden">
              Show detail
            </p>
            <p className="mt-1 hidden font-medium text-slate-700 group-open:block">
              Hide detail
            </p>
          </div>
        </div>
      </summary>

      <div className="border-t border-slate-100 p-4">
      {describeCaptureBreakdown(shots) && (
        <p className="mt-1 text-xs text-slate-500">
          Captured automatically: {describeCaptureBreakdown(shots)}
        </p>
      )}

      <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {/* Withheld entirely for a block that recorded no time. Rendering them would
            print "Average 0.00s" and "Release SD 0.000" from an empty set, which a
            reader cannot distinguish from real measurements. */}
        {measuresTime && (
          <>
            <DashboardCard
              label="Average"
              value={formatReleaseTime(analysis.average)}
            />

            <DashboardCard
              label="Release SD"
              value={analysis.releaseTimeStandardDeviation.toFixed(3)}
            />

            <TargetAccuracyDashboardCards
              targetAccuracy={analysis.targetAccuracy}
              measurementMode={block.measurementMode}
              thresholds={timeTolerance}
            />
          </>
        )}

        {speedAccuracy && (
          <>
            <DashboardCard
              label="Average Speed"
              value={formatMeasuredSpeed(
                average(speedShots.map((shot) => shot.speed))
              )}
            />

            <DashboardCard
              label="Speed SD"
              value={standardDeviationOfValues(
                speedShots.map((shot) => shot.speed)
              ).toFixed(3)}
            />

            <TargetAccuracyDashboardCards
              quantity="speed"
              targetAccuracy={speedAccuracy}
              thresholds={speedTolerance ?? null}
            />
          </>
        )}

        {block.mode === "blind" && (
          <PredictionDashboardCards analysis={analysis} />
        )}
      </div>

      {/* Plots release time against a time target; it has no speed counterpart yet,
          so it is omitted rather than drawn with an empty series. */}
      {measuresTime && (
        <div className="mt-3">
          <ReleaseTrendChart shots={shots} />
        </div>
      )}

      {block.measurementMode && (
        <div className="mt-3">
          <TargetErrorChart
            points={prepareTargetErrorByShotData(shots, blockMap, timeTolerance)}
            thresholds={timeTolerance}
            measurementMode={block.measurementMode}
            context="history"
          />
        </div>
      )}

      <div className="mt-3 space-y-2">
        {shots.map((shot) => (
          <div
            key={shot.id}
            className="rounded-lg bg-slate-100 px-3 py-2"
          >
            {block.mode === "blind" && shot.predictedTime !== undefined ? (
              <div className="text-sm text-slate-600">
                <p className="font-medium text-slate-900">
                  Shot {shot.shotNumber}
                </p>
                <p>
                  Target {formatMeasuredSeconds(shot.targetTime)} · Prediction{" "}
                  {shot.predictedTime.toFixed(2)} · Actual{" "}
                  {formatMeasuredSeconds(shot.releaseTime)}
                  {shot.releaseTime !== undefined && (
                    <>
                      {" "}
                      · Prediction Error{" "}
                      {formatSigned(shot.predictedTime - shot.releaseTime)}
                    </>
                  )}
                </p>
              </div>
            ) : (
              <div className="flex items-start justify-between gap-3">
                <span className="text-sm text-slate-600">
                  #{shot.shotNumber} ·{" "}
                  {shot.handle === "in" ? "In" : "Out"}
                  {shot.shotType && <> · {shot.shotType}</>}
                </span>

                {/* Every measurement this block records, in its own unit, with its own
                    target and classification — and an explicit absence where one was
                    never recorded. */}
                <div className="text-right text-sm">
                  <MeasuredShotSummary shot={shot} measurement={measurement} />
                </div>
              </div>
            )}
          </div>
        ))}
      </div>
      </div>
    </details>
  );
}

type PredictionDashboardCardsProps = {
  analysis: ReturnType<typeof analyzeShots>;
};

function PredictionDashboardCards({
  analysis,
}: PredictionDashboardCardsProps) {
  const hasEnoughData = analysis.prediction.count >= 2;
  const notEnough = "Not enough shots";

  return (
    <>
      <DashboardCard
        label="Prediction Bias"
        value={
          hasEnoughData && analysis.prediction.meanError !== null
            ? `${formatSigned(analysis.prediction.meanError)}s`
            : notEnough
        }
      />

      <DashboardCard
        label="Avg Prediction Error"
        value={
          hasEnoughData && analysis.prediction.meanAbsoluteError !== null
            ? `${analysis.prediction.meanAbsoluteError.toFixed(3)}s`
            : notEnough
        }
      />

      <DashboardCard
        label="Prediction Consistency"
        value={
          hasEnoughData && analysis.prediction.errorStandardDeviation !== null
            ? `${analysis.prediction.errorStandardDeviation.toFixed(3)} SD`
            : notEnough
        }
      />

      <DashboardCard
        label="Prediction Correlation"
        value={
          hasEnoughData && analysis.prediction.correlation !== null
            ? analysis.prediction.correlation.toFixed(2)
            : notEnough
        }
      />
    </>
  );
}
