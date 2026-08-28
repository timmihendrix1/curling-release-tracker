"use client";

import { useEffect, useRef, useState } from "react";
import IdentityAccountControl from "./identity/IdentityAccountControl";
import IdentityPendingTeamIntent from "./identity/IdentityPendingTeamIntent";
import AccuracyToleranceProfilesScreen from "./AccuracyToleranceProfilesScreen";
import AppHeader from "./AppHeader";
import AssessScreen from "./AssessScreen";
import AssessmentAnalyze from "./AssessmentAnalyze";
import AssessmentResultScreen from "./AssessmentResultScreen";
import AutoCapture, { type AutoCaptureStartConfig } from "./AutoCapture";
import BlindShotEntry from "./BlindShotEntry";
import ConfirmModal from "./ConfirmModal";
import DashboardCard from "./DashboardCard";
import HomeScreen from "./HomeScreen";
import PageHeader from "./PageHeader";
import NewTrainingBlock from "./NewTrainingBlock";
import PrimaryNavigation from "./PrimaryNavigation";
import ReleaseTrendChart from "./ReleaseTrendChart";
import SessionSettings from "./SessionSettings";
import SettingsScreen from "./SettingsScreen";
import ShotEntry, { type ShotEntryTarget } from "./ShotEntry";
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
import ExerciseTeamExecutionScreen from "./ExerciseTeamExecutionScreen";
import ExerciseTeamSetupScreen from "./ExerciseTeamSetupScreen";
import TrainLanding, { type TrainEntryPath } from "./TrainLanding";
import TrainingPlanProgress from "./TrainingPlanProgress";
import TrainingPlanStepTransition from "./TrainingPlanStepTransition";
import TrainingSetup, { type TrainingSetupValue } from "./TrainingSetup";
import {
  useSportingProfileId,
  useSportingRepositories,
  useSportingCloudSync,
} from "./ProfileScopedSportingPersistence";

import type {
  AccuracyThresholds,
  Handle,
  Session,
  Shot,
  ShotType,
  TimingResult,
  TrainingBlock,
  TrainingPlan,
} from "../types";
import type { AssessmentRun } from "../lib/assessment/types";
import { createSoloExerciseExecution } from "../lib/exercises/execution";
import type { ExerciseExecution } from "../lib/exercises/executionTypes";
import type { ExerciseVersion } from "../lib/exercises/types";
import { EXERCISE_CATALOG } from "../lib/exercises/catalog";
import { resolveMeasurementProtocols } from "../lib/exercises/lookup";

import { resolveAccuracyThresholds } from "../lib/accuracyThresholds";
import {
  analyzeShots,
  computeHandleAccuracyComparison,
  computeHandleTargetErrorBoxPlots,
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
  isCaptureSequenceActive,
  pauseCaptureSequence,
  pauseCaptureSequenceWithError,
  resumeCaptureSequence,
  startCaptureSequence,
  undoLastCapturedShot,
  type ProcessTimingResultOutcome,
} from "../lib/captureSequence";
import {
  exportHistoryToCsv,
  exportSessionToCsv,
} from "../lib/export";
import { DEFAULT_ACTIVE_VIEW, type ActiveView } from "../lib/navigation";
import {
  attachSoloExerciseExecution,
  prepareSessionForArchive,
  replaceExerciseExecution,
  sessionHasArchivableActivity,
} from "../lib/exercises/sessionIntegration";
import type { DomainHydrationState, PersistenceReadError } from "../lib/persistence/types";
import { createNewSession } from "../lib/sessionMigration";
import {
  createSimulatorTimingProvider,
} from "../lib/simulatorTimingProvider";
import {
  hasUniformThresholds,
  prepareTargetErrorByShotData,
  prepareTargetVsActualScatterData,
} from "../lib/chartData";
import { buildTrainingInsight } from "../lib/trainingInsight";
import {
  aggregateTargetAccuracyAcrossBlocks,
  buildHistoryAnalysisContext,
  createDefaultHistoryFilters,
  getAvailableMeasurementModes,
  getAvailableTrainingCategories,
  representativeThresholds,
  resolveDefaultMeasurementMode,
  resolveDefaultTrainingCategory,
  type HistoryAnalysisFilters,
} from "../lib/historyAnalysis";
import {
  DEFAULT_SHOT_FILTER,
  filterShots,
  type HandleFilter,
  type ShotTypeFilter,
} from "../lib/shotFilters";
import { createManualTimingResult } from "../lib/timingProvider";
import {
  formatReleaseTime,
  formatSigned,
  parseReleaseTime,
} from "../lib/timeInput";
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
  isActiveStepComplete,
  isFinalStep,
  isPlanComplete,
  isPlanExecutionActive,
} from "../lib/trainingPlans/progress";

const IS_DEV = process.env.NODE_ENV !== "production";

// Compact contextual header copy for every functional screen (DESIGN_SYSTEM.md
// §9.2) — Home keeps the full AppHeader product identity instead, see the
// activeView switch below.
const FUNCTIONAL_PAGE_HEADERS: Record<
  Exclude<ActiveView, "home">,
  { title: string; description: string }
> = {
  train: {
    title: "Train",
    description:
      "Find an exercise, set up a session, and record release times as you throw.",
  },
  assess: {
    title: "Assess",
    description: "Run the Release Time Core Assessment and review results.",
  },
  analyze: {
    title: "Analyze",
    description: "Review training and assessment history.",
  },
  settings: {
    title: "Settings",
    description: "Manage local data and app preferences.",
  },
};

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

export default function TrackerApp() {
  const athleteProfileId = useSportingProfileId();
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

  // Stage B3 keeps the selected Train pillar across the short transitions in
  // and out of a Solo Exercise runner. Release Timing launched from the
  // Library reuses Quick Start and carries only this pending catalog snapshot
  // until the existing block is actually created.
  const [preferredTrainEntryPath, setPreferredTrainEntryPath] =
    useState<TrainEntryPath>("quick-start");
  const [pendingReleaseTimingExerciseVersion, setPendingReleaseTimingExerciseVersion] =
    useState<ExerciseVersion | null>(null);
  const [viewingExerciseExecutionId, setViewingExerciseExecutionId] =
    useState<string | null>(null);
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
  const [analyzeTab, setAnalyzeTab] = useState<"training" | "assessments">("training");

  // Bumped whenever the user confirms discarding an in-progress Blind
  // Weight draft (see guardLeavingBlindDraft) — forces BlindShotEntry to
  // fully remount with a clean internal state, even if the active block
  // itself hasn't changed yet (e.g. the New Training Block modal is only
  // just being opened, and could still be cancelled).
  const [blindDraftResetToken, setBlindDraftResetToken] = useState(0);

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
    captureQueueRef.current = captureQueueRef.current
      .then(() => processQueuedTimingResult(result))
      .catch((error) => {
        console.error("Unexpected error while processing a timing result", error);
      });
  }

  /**
   * The actual atomic transition, run strictly one-at-a-time by the queue above.
   * Reads/writes `sessionRef` directly (not `currentSession` from the render closure)
   * so it always starts from the immediately-preceding queued result's committed
   * state, then commits both the ref and React state together before returning.
   */
  function processQueuedTimingResult(result: TimingResult): void {
    // Capture Ownership: a Timing Result is routed to exactly one context.
    // While an Assessment Run is actively warming up or scoring, it is the
    // sole consumer of the shared stream — Training's capture logic below
    // never runs for that result. See docs/adr/0011.
    if (isAssessmentCaptureActive()) {
      processQueuedAssessmentTimingResult(result);
      return;
    }

    // Corrected (docs/PERSISTENCE_BOUNDARY_DESIGN.md §7.4): a Session that
    // is not "ready" (still loading, structurally impossible to reach here
    // since nothing renders before Session's own load resolves — or
    // write_protected after a genuine read failure) must never have a
    // timing result applied to it. This guard, together with the Timing
    // Simulator's own subscription gate above, closes both the automatic
    // (simulator) and manual/capture-sequence paths, which both funnel
    // through this one function.
    if (sessionHydration !== "ready") return;

    const session = sessionRef.current;
    if (!session) return;

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

    sessionRepository.saveCurrent(currentSession);
  }, [currentSession, sessionHydration, sessionRepository]);

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
  const sessionWritable = sessionHydration === "ready";
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
  const displayedExerciseExecution =
    activeExerciseExecution ??
    (viewingExerciseExecutionId
      ? currentSession.exerciseExecutions?.find(
          (execution) => execution.id === viewingExerciseExecutionId
        )
      : undefined);
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
  const activeBlockAnalysis = activeBlock && activeBlockAccuracyThresholds
    ? analyzeShots(filteredActiveBlockShots, activeBlockAccuracyThresholds)
    : null;

  // Whichever capture path is actually in progress is the screen's Hero; the
  // other stays available as a Primary (non-Hero) fallback (Epic 1: exactly
  // one Hero per screen — see docs/DESIGN_SYSTEM.md §10.1).
  const autoCaptureIsActive = isCaptureSequenceActive(
    currentSession.captureSequence
  );

  const activeBlockMap = activeBlock
    ? new Map([[activeBlock.id, activeBlock]])
    : new Map();
  const targetErrorByShotData = activeBlockAccuracyThresholds
    ? prepareTargetErrorByShotData(
        filteredActiveBlockShots,
        activeBlockMap,
        activeBlockAccuracyThresholds
      )
    : [];
  const targetVsActualScatterData = prepareTargetVsActualScatterData(
    filteredActiveBlockShots,
    activeBlockMap
  );

  const shotEntryTarget: ShotEntryTarget | null = activeBlock
    ? {
        value: getNextShotTarget(activeBlock),
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
  // started a new Training Block instead of Continue/Finish) — the plan
  // progress/transition UI simply stops rendering in that case rather than
  // guessing which block it should apply to.
  const planExecution = currentSession.planExecution;
  const isTrainingPlanActive = planExecution
    ? isPlanExecutionActive(currentSession, planExecution)
    : false;
  const activePlanStepSnapshot =
    planExecution && isTrainingPlanActive
      ? getActiveStepSnapshot(planExecution)
      : undefined;
  const isActivePlanStepComplete =
    planExecution && isTrainingPlanActive
      ? isActiveStepComplete(currentSession, planExecution)
      : false;
  const isActivePlanStepFinal = planExecution ? isFinalStep(planExecution) : false;
  const isTrainingPlanComplete =
    planExecution && isTrainingPlanActive
      ? isPlanComplete(currentSession, planExecution)
      : false;
  const trainingPlanProgressSummary =
    planExecution && isTrainingPlanActive
      ? getPlanProgressSummary(currentSession, planExecution)
      : null;
  const nextPlanStepLabel =
    planExecution && !isActivePlanStepFinal
      ? blockModeLabel(
          planExecution.steps[planExecution.activeStepIndex + 1].step.configuration
            .mode
        )
      : null;
  // Preselected (never locked) handle for the next shot — undefined means
  // Free, today's unchanged behavior. Re-derived every render from the
  // number of shots already saved in this step's block, so it always follows
  // the plan's own sequence regardless of any prior one-shot override.
  const shotEntryPresetHandle =
    isTrainingPlanActive && activePlanStepSnapshot
      ? resolveExpectedHandle(
          activePlanStepSnapshot.step.handleStrategy,
          activeBlockShots.length
        )
      : undefined;

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
  const effectiveHistoryFilters: HistoryAnalysisFilters = {
    ...historyFilters,
    trainingCategory: effectiveTrainingCategory,
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
  const historyThresholds = representativeThresholds(
    historyAnalysisContext.blocks
  );
  const historyTargetAccuracy = aggregateTargetAccuracyAcrossBlocks(
    historyAnalysisContext.blocks
  );
  // Analyze's opening "what should I learn" sentence — computed only from
  // the same selection every other History surface reads from, never a
  // separate query (Epic 2: insight before raw metrics).
  const trainingInsight = buildTrainingInsight(historyAnalysisContext.blocks);
  const historyFullAnalysis = analyzeShots(
    historyAnalysisContext.shots,
    historyThresholds
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
            ? { ...block, targetTime: newTargetTime }
            : block
        ),
      };
    });
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

  function handleAddShot(
    releaseTime: number,
    handle: Handle,
    shotType: ShotType | undefined,
    targetTimeOverride?: number,
    predictedTime?: number
  ) {
    if (sessionHydration !== "ready") return;

    setCurrentSession((session) => {
      if (!session) return session;

      const currentActiveBlock = getActiveBlock(session);
      if (!currentActiveBlock) return session;

      const targetTime = computeShotTarget(
        currentActiveBlock,
        targetTimeOverride
      );

      const newShot: Shot = {
        id: crypto.randomUUID(),
        sessionId: session.id,
        blockId: currentActiveBlock.id,
        shotNumber: getNextShotNumberInBlock(
          session,
          currentActiveBlock.id
        ),
        releaseTime,
        targetTime,
        predictedTime,
        handle,
        shotType,
        createdAt: new Date().toISOString(),
      };

      const recentTargets = getBlockShots(
        session,
        currentActiveBlock.id
      ).map((shot) => shot.targetTime);

      const updatedBlock = advanceBlockTarget(
        currentActiveBlock,
        targetTime,
        recentTargets
      );

      return {
        ...session,
        shots: [...session.shots, newShot],
        blocks: session.blocks.map((block) =>
          block.id === updatedBlock.id ? updatedBlock : block
        ),
      };
    });
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
      setCaptureManualTargetInput(getNextShotTarget(activeBlock).toFixed(2));
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
    processIncomingTimingResult(
      createManualTimingResult(activeBlock.measurementMode, value)
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
      releaseTime: shot.releaseTime.toString(),
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
    try {
      return createTrainingBlock(value);
    } catch (error) {
      alert(
        error instanceof Error
          ? error.message
          : "Could not create this training block."
      );
      return null;
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

  /**
   * Starts a curated Solo Exercise. Technique and Shotmaking use the B1/B2
   * Exercise Execution aggregate. A Measured Exercise deliberately redirects
   * into the existing Release Timing setup instead of creating a parallel
   * measurement runner or duplicating Shot data.
   */
  function handleStartExercise(version: ExerciseVersion): boolean {
    if (sessionHydration !== "ready") return false;

    if (version.primaryFocus === "measured") {
      setPendingReleaseTimingExerciseVersion(snapshotExerciseVersion(version));
      setPreferredTrainEntryPath("quick-start");
      return true;
    }

    const session = sessionRef.current;
    if (!session) return false;
    const created = createSoloExerciseExecution(version, {
      trainingSessionId: session.id,
      athleteProfileId,
      enabledMeasurementProtocols: version.primaryFocus === "shotmaking"
        ? resolveMeasurementProtocols(EXERCISE_CATALOG, version.compatibleMeasurementProtocols)
            .map(({ protocol }) => protocol)
            .filter((protocol) => protocol.metricType === "rotation-count")
        : [],
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
    setViewingExerciseExecutionId(created.value.id);
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
   * Starts a Training Plan: creates step 0's TrainingBlock through the exact
   * same validated path as "New Training Block" (tryCreateTrainingBlock),
   * then attaches the plan-execution snapshot in the very same atomic session
   * update — never two separate setCurrentSession calls, so the session is
   * never briefly missing one half of the pair. See ADR-0012.
   */
  function handleStartTrainingPlan(plan: TrainingPlan) {
    if (sessionHydration !== "ready") return;

    const firstStep = plan.steps[0];
    if (!firstStep) return;

    const blockInput = mapPlanStepToTrainingBlockInput(firstStep);
    if (!tryCreateTrainingBlock(blockInput)) return;

    setCurrentSession((session) => {
      if (!session) return session;

      const withBlock = addTrainingBlock(session, blockInput);
      return {
        ...withBlock,
        planExecution: startPlanExecution(plan, withBlock.activeBlockId),
      };
    });

    setBlockFilter(DEFAULT_SHOT_FILTER);
    setEntryMode("manual");
    setPendingReleaseTimingExerciseVersion(null);
    setPreferredTrainEntryPath("quick-start");
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

      const outcome = buildAccuracyToleranceProfile(
        { ...input, id: existing.id, createdAt: existing.createdAt },
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
   * Advances a Training Plan execution to its next step — same composition as
   * handleStartTrainingPlan: atomically creates the next TrainingBlock and
   * stamps its id onto the execution snapshot in one session update. A no-op
   * if the plan execution isn't actually driving the current active block
   * (see isPlanExecutionActive) or there is no next step.
   */
  function handleContinueToNextPlanStep() {
    if (sessionHydration !== "ready") return;

    const session = currentSession;
    const planExecution = session?.planExecution;
    if (!session || !planExecution || !isPlanExecutionActive(session, planExecution)) {
      return;
    }

    const nextIndex = planExecution.activeStepIndex + 1;
    const nextStep = planExecution.steps[nextIndex]?.step;
    if (!nextStep) return;

    const blockInput = mapPlanStepToTrainingBlockInput(nextStep);
    if (!tryCreateTrainingBlock(blockInput)) return;

    setCurrentSession((current) => {
      if (!current || !current.planExecution) return current;

      const withBlock = addTrainingBlock(current, blockInput);
      return {
        ...withBlock,
        planExecution: advanceToNextPlanStep(
          current.planExecution,
          withBlock.activeBlockId
        ),
      };
    });

    setBlockFilter(DEFAULT_SHOT_FILTER);
    setEntryMode("manual");
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
  async function performSessionArchiveTransition() {
    const currentSnapshot = sessionRef.current;
    const nextCurrentSession = createNewSession();

    if (!currentSnapshot || !sessionHasArchivableActivity(currentSnapshot)) {
      // Re-checked here, against the authoritative ref, rather than trusting the
      // click-time closure's `shots.length` — a capture result accepted while the
      // confirmation dialog was open could have added a shot after the click but
      // before this queued step actually runs.
      commitSession(nextCurrentSession);
      setBlockFilter(DEFAULT_SHOT_FILTER);
      setViewingExerciseExecutionId(null);
      setPendingReleaseTimingExerciseVersion(null);
      setPreferredTrainEntryPath("quick-start");
      setActiveView("train");
      return;
    }

    // An in-progress library Exercise is a real interruption, not an empty Session.
    // Persist it as abandoned before the Session becomes terminal; never discard it
    // and never upload an in-progress execution as archived cloud history.
    const prepared = prepareSessionForArchive(currentSnapshot);
    if (!prepared.ok) return;
    const previousSession = prepared.value;

    // Coordinated archive-and-replace: history is durably written before the
    // replacement session is even attempted — never merely "issued first" — so this
    // depends on neither React's effect-declaration order nor the adapter being
    // synchronous. The snapshot (nextHistory) is selected here, once, and held in this
    // local variable for the rest of the transition — nothing queued behind this call
    // on captureQueueRef can run until this whole function returns, so nothing can
    // mutate the session between this read and the eventual replacement below.
    const nextHistory = [previousSession, ...sessionHistoryRef.current];
    const archiveResult = await sessionRepository.archiveAndReplace(
      nextHistory,
      nextCurrentSession
    );

    if (!archiveResult.ok && archiveResult.step === "history") {
      // History write failed: neither write took effect. Leave the completed
      // session exactly as it is — no silent data loss — so the user can retry.
      // Consistent with this codebase's existing, documented, deliberate deferral of
      // write-failure UX (see docs/TECHNICAL_DEBT_AND_ROADMAP.md's "Persistence
      // write-failure visibility, retry, and recovery UX" item) — this fix's scope is
      // ordering/coordination, not new failure UI.
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

    commitSession(nextCurrentSession);
    setBlockFilter(DEFAULT_SHOT_FILTER);
    setViewingExerciseExecutionId(null);
    setPendingReleaseTimingExerciseVersion(null);
    setPreferredTrainEntryPath("quick-start");
    setActiveView("train");
  }

  function handleStartNewSession() {
    if (sessionHydration !== "ready") return;

    guardLeavingActiveWork(
      hasUnsavedBlindDraft
        ? "You have an unfinished blind-weight shot. Starting a new session will discard it — the current session itself will still be saved to history. Continue?"
        : null,
      isCaptureSequenceActive(currentSession?.captureSequence)
        ? "Starting a new session will end the current Auto Capture. Already captured shots will remain in the training."
        : null,
      null,
      () => {
        setConfirmAction({
          title: "Start New Session",
          message:
            "Current session will be saved to history. Continue?",
          confirmLabel: "Start",
          // Deliberately synchronous, not async: the single-flight check-and-set below
          // must complete before any await exists anywhere in this call, so a second,
          // rapid invocation (a double click landing before React removes this modal)
          // is rejected unconditionally, not merely discouraged by a disabled button or
          // a state update that hasn't committed yet.
          onConfirm: () => {
            if (sessionArchiveInFlightRef.current) return;
            sessionArchiveInFlightRef.current = true;

            // Enqueued onto the same queue every TimingResult goes through — see
            // performSessionArchiveTransition's doc comment above. The .catch() mirrors
            // ADR-0007's processIncomingTimingResult exactly: an unexpected exception
            // must never leave captureQueueRef permanently rejected, which would
            // silently break all future capture processing, not just this transition.
            captureQueueRef.current = captureQueueRef.current
              .then(() => performSessionArchiveTransition())
              .catch((error) => {
                console.error(
                  "Unexpected error while archiving the session",
                  error
                );
              })
              .finally(() => {
                sessionArchiveInFlightRef.current = false;
              });

            setConfirmAction(null);
          },
        });
      }
    );
  }

  /**
   * A completed Training Plan's "Finish Training" action is simply this same
   * existing session-completion path — plan completion introduces no new
   * session-archiving logic of its own (see ADR-0012).
   */
  function handleFinishPlannedTraining() {
    handleStartNewSession();
  }

  /**
   * Gates navigation away from an in-progress Blind Weight shot (History,
   * New Training Block, Start New Session, ...). When there's nothing
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
        () => setActiveView(view)
      );
      return;
    }

    if (activeView === "assess" && view !== "assess") {
      guardLeavingActiveWork(
        null,
        null,
        isAssessmentCaptureActive() ? ASSESSMENT_LEAVE_NOTICE : null,
        () => setActiveView(view)
      );
      return;
    }

    setActiveView(view);
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
   * Start New Session shouldn't silently abandon in-progress work). Confirming ends
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
        runOrConfirmAssessmentLeave(assessmentWarningMessage, action);
      });
    });
  }

  function handleDeleteHistorySession(sessionId: string) {
    if (sessionHydration !== "ready") return;

    setConfirmAction({
      title: "Delete Session",
      message:
        "Delete this session from history? This cannot be undone.",
      confirmLabel: "Delete",
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

  return (
    <div className="app-content-clearance space-y-4">
      <IdentityPendingTeamIntent onOpenAdminRequests={() => setShowTeamsScreen(true)} />
      <IdentityAccountControl onOpenTeams={() => setShowTeamsScreen(true)} />

      {activeView === "home" ? (
        <AppHeader />
      ) : (
        <PageHeader
          title={FUNCTIONAL_PAGE_HEADERS[activeView].title}
          description={FUNCTIONAL_PAGE_HEADERS[activeView].description}
        />
      )}

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
          hasHistory={sessionHistory.length > 0}
          onExportHistoryCsv={() => exportHistoryToCsv(sessionHistory)}
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
        />
      )}

      {activeView === "train" && (
        <>
          {activeTeamExerciseDraft ? (
            <ExerciseTeamExecutionScreen
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
            <ExerciseSoloExecutionScreen
              execution={displayedExerciseExecution}
              writable={sessionWritable}
              onReplace={handleReplaceExerciseExecution}
              onBackToLibrary={handleBackToExerciseLibrary}
              onStartNewSession={handleStartNewSession}
            />
          ) : !activeBlock || !activeBlockAnalysis ? (
            // Quick Start (below) preserves the exact existing hero, unchanged
            // — Training Plans is a second, equally-reachable entry path
            // alongside it, not a replacement (spec section 21/22).
            <TrainLanding
              quickStartContent={
                // One Hero setup surface, composed around the actual decision
                // order from docs/INFORMATION_ARCHITECTURE_AND_SCREEN_PHILOSOPHY.md's
                // Train Information Priority — training objective and
                // configuration first, session naming last as the clearly
                // optional detail it is (compositional redesign, not a
                // Session-card-then-Block-card stack).
                <div className={surfaceClass("hero")}>
                  {pendingReleaseTimingExerciseVersion && (
                    <div
                      role="status"
                      className="mb-5 rounded-xl border border-blue-200 bg-blue-50 p-4"
                    >
                      <p className="text-xs font-semibold uppercase tracking-wide text-blue-700">
                        From Exercise Library
                      </p>
                      <p className="mt-1 text-sm font-semibold text-slate-900">
                        {pendingReleaseTimingExerciseVersion.title}
                      </p>
                      <p className="mt-1 text-xs text-slate-600">
                        Choose Fixed Weight, Variable Weight, or Blind Weight below. The existing
                        Release Timing runner records the session; no duplicate exercise runner is created.
                      </p>
                    </div>
                  )}
                  <h2 className="text-xl font-semibold text-slate-900">
                    Set Up Training Block
                  </h2>

                  <p className="mt-2 text-sm text-slate-600">
                    Choose what you&apos;re training, then start.
                  </p>

                  <div className="mt-5">
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

                  <div className="mt-6 border-t border-slate-100 pt-4">
                    <label className="text-xs font-medium text-slate-500">
                      Session name <span className="font-normal">(optional)</span>
                    </label>

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
                  </div>
                </div>
              }
              plans={trainingPlans}
              initialEntryPath={preferredTrainEntryPath}
              onEntryPathChange={(path) => {
                setPreferredTrainEntryPath(path);
                if (path !== "quick-start") {
                  setPendingReleaseTimingExerciseVersion(null);
                }
              }}
              plansTabDisabled={!trainingPlansWritable}
              startPlanDisabled={!sessionWritable}
              onStartExercise={handleStartExercise}
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
              {/* Essential context, not the Hero — the current target/capture
                  task below carries the strongest surface (Epic 1). */}
              <div className={surfaceClass("primary")}>
                <div className="flex items-start justify-between gap-4">
                  <div>
                    <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
                      Active Training Block
                    </p>

                    <h2 className="mt-1 text-xl font-semibold text-slate-900">
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
                      · {measurementModeLabel(
                        activeBlock.measurementMode
                      )}
                      {(activeBlock.mode === "fixed" ||
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

                  {/* Secondary action — kept visually subordinate to the
                      block identity beside it and to the primary shot-entry
                      action below (DESIGN_SYSTEM.md §19.1/§12.2). */}
                  <button
                    type="button"
                    onClick={handleOpenNewBlockModal}
                    disabled={!sessionWritable}
                    className="min-h-11 whitespace-nowrap rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    New Training Block
                  </button>
                </div>
              </div>

              {isTrainingPlanActive && trainingPlanProgressSummary && planExecution && (
                <TrainingPlanProgress
                  sourcePlanName={planExecution.sourcePlanName}
                  summary={trainingPlanProgressSummary}
                />
              )}

              {isTrainingPlanActive &&
                isActivePlanStepComplete &&
                planExecution &&
                activePlanStepSnapshot &&
                (isTrainingPlanComplete ? (
                  <TrainingPlanStepTransition
                    kind="plan-complete"
                    totalPlannedStones={trainingPlanProgressSummary?.totalPlannedShots ?? 0}
                    totalActualStones={trainingPlanProgressSummary?.totalActualShots ?? 0}
                    onFinish={handleFinishPlannedTraining}
                  />
                ) : (
                  nextPlanStepLabel && (
                    <TrainingPlanStepTransition
                      kind="continue"
                      completedStepLabel={blockModeLabel(
                        activePlanStepSnapshot.step.configuration.mode
                      )}
                      nextStepLabel={nextPlanStepLabel}
                      onContinue={handleContinueToNextPlanStep}
                    />
                  )
                ))}

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
                <>
                  {/* Manual Entry and Auto Capture are two ways to do the
                      same task, not two permanently-stacked panels — a
                      segmented choice while idle; once a sequence is
                      actually running/paused, its own live status takes
                      over and speaks for itself (compositional redesign). */}
                  {!autoCaptureIsActive && (
                    <div
                      role="tablist"
                      aria-label="Shot entry method"
                      className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1"
                    >
                      <button
                        type="button"
                        role="tab"
                        aria-selected={entryMode === "manual"}
                        onClick={() => setEntryMode("manual")}
                        className={`min-h-11 rounded-lg px-3 py-2 text-sm font-medium transition ${
                          entryMode === "manual"
                            ? "bg-slate-900 text-white"
                            : "text-slate-700 hover:bg-slate-200"
                        }`}
                      >
                        Manual Entry
                      </button>
                      <button
                        type="button"
                        role="tab"
                        aria-selected={entryMode === "auto"}
                        onClick={() => setEntryMode("auto")}
                        className={`min-h-11 rounded-lg px-3 py-2 text-sm font-medium transition ${
                          entryMode === "auto"
                            ? "bg-slate-900 text-white"
                            : "text-slate-700 hover:bg-slate-200"
                        }`}
                      >
                        Auto Capture
                      </button>
                    </div>
                  )}

                  {shotEntryTarget && (autoCaptureIsActive || entryMode === "manual") && (
                    <ShotEntry
                      onAddShot={handleAddShot}
                      target={shotEntryTarget}
                      level={autoCaptureIsActive ? "primary" : "hero"}
                      presetHandle={shotEntryPresetHandle}
                    />
                  )}

                  {(autoCaptureIsActive || entryMode === "auto") && (
                    <AutoCapture
                      activeBlock={activeBlock}
                      captureSequence={currentSession.captureSequence}
                      currentTargetTime={getNextShotTarget(activeBlock)}
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

                  {IS_DEV && (
                    <TimingSimulatorPanel
                      provider={simulatorProvider}
                      measurementMode={activeBlock.measurementMode}
                      diagnostics={captureDiagnostics}
                    />
                  )}
                </>
              )}

              {/* Live Summary — filter, live metrics and shot history are
                  one continuous "how am I doing so far" reading, not three
                  stacked cards (compositional redesign: IA doc's Active
                  Training priority groups Session Progress/Live Summary
                  together, below the current task above). */}
              <div className={surfaceClass("secondary")}>
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xl font-semibold text-slate-900">
                    Live Summary
                  </h2>

                  <p className="text-xs text-slate-500">
                    {filteredActiveBlockShots.length} of{" "}
                    {activeBlockShots.length} shots shown
                  </p>
                </div>

                <div className={`${surfaceClass("utility")} mt-3`}>
                  <p className="text-sm font-medium text-slate-700">
                    Filter
                  </p>

                  <div className="mt-3 grid grid-cols-3 gap-2">
                    {(
                      [
                        ["all", "Total"],
                        ["in", "In Handle"],
                        ["out", "Out Handle"],
                      ] as [HandleFilter, string][]
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          setBlockFilter((filter) => ({
                            ...filter,
                            handle: value,
                          }))
                        }
                        className={`min-h-11 rounded-lg px-3 py-2 text-sm font-medium transition ${blockFilter.handle === value
                            ? "bg-slate-900 text-white"
                            : "bg-white text-slate-700"
                          }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>

                  <div className="mt-2 grid grid-cols-3 gap-2">
                    {(
                      [
                        ["all", "Total"],
                        ["draw", "Draw"],
                        ["takeout", "Takeout"],
                      ] as [ShotTypeFilter, string][]
                    ).map(([value, label]) => (
                      <button
                        key={value}
                        type="button"
                        onClick={() =>
                          setBlockFilter((filter) => ({
                            ...filter,
                            shotType: value,
                          }))
                        }
                        className={`min-h-11 rounded-lg px-3 py-2 text-sm font-medium transition ${blockFilter.shotType === value
                            ? "bg-slate-900 text-white"
                            : "bg-white text-slate-700"
                          }`}
                      >
                        {label}
                      </button>
                    ))}
                  </div>
                </div>

                {activeBlockAnalysis.count === 0 ? (
                  // One compact group-level empty state rather than a false
                  // "Average 0.00s"/"Release SD 0.000" plus several repeated
                  // "Not enough shots" cards (DESIGN_SYSTEM.md §21.2/§25.1).
                  <p className="mt-4 text-sm text-slate-500">
                    {filteredActiveBlockShots.length === activeBlockShots.length
                      ? "Add a shot to begin the live summary."
                      : "No shots match this filter yet."}
                  </p>
                ) : (
                  <div className="mt-4 space-y-3">
                    {/* Not every KPI deserves equal weight (Epic 2): Average
                        Error is the one number the eye should go to first,
                        with Bias/On Target/Major Misses as compact
                        supporting context right beside it. */}
                    <TargetAccuracyDashboardCards
                      variant="hero"
                      targetAccuracy={activeBlockAnalysis.targetAccuracy}
                      measurementMode={activeBlock.measurementMode}
                      thresholds={
                        activeBlockAccuracyThresholds ??
                        resolveAccuracyThresholds(undefined)
                      }
                    />

                    {activeBlock.mode === "blind" && (
                      <div className="grid grid-cols-2 gap-2">
                        <PredictionDashboardCards
                          analysis={activeBlockAnalysis}
                        />
                      </div>
                    )}

                    {/* Quietly-supporting figures — same data, lower visual
                        weight, kept in view rather than hidden (this is a
                        secondary surface already; the tiering happens
                        within it, not behind another click). */}
                    <div className="grid grid-cols-2 gap-2">
                      <DashboardCard
                        label="Average"
                        value={formatReleaseTime(
                          activeBlockAnalysis.average
                        )}
                      />

                      <DashboardCard
                        label="Release SD"
                        value={activeBlockAnalysis.releaseTimeStandardDeviation.toFixed(
                          3
                        )}
                      />

                      <TargetAccuracyDashboardCards
                        variant="supporting"
                        targetAccuracy={activeBlockAnalysis.targetAccuracy}
                        measurementMode={activeBlock.measurementMode}
                        thresholds={
                          activeBlockAccuracyThresholds ??
                          resolveAccuracyThresholds(undefined)
                        }
                      />
                    </div>
                  </div>
                )}
              </div>

              {/* Detailed Analytics comes right after Live Summary — before
                  Recent Shots/Edit Shots/Session Actions, matching the IA
                  doc's Active Training priority (Live Summary, then Detailed
                  Analytics) and closing this gap: editing tools must never
                  outrank analysis in the reading order. */}
              <details className="group rounded-2xl border border-slate-200 bg-white">
                <summary className="cursor-pointer list-none rounded-2xl px-4 py-3 text-sm font-medium text-slate-700 marker:content-none group-open:rounded-b-none">
                  <span className="flex items-center justify-between gap-2">
                    <span>Detailed Analytics</span>
                    <span className="text-xs text-slate-400 group-open:hidden">Show</span>
                    <span className="hidden text-xs text-slate-400 group-open:inline">Hide</span>
                  </span>
                </summary>

                <div className="space-y-4 border-t border-slate-100 p-4">
                  <ReleaseTrendChart shots={filteredActiveBlockShots} />

                  <TargetErrorChart
                    points={targetErrorByShotData}
                    thresholds={activeBlockAccuracyThresholds}
                    measurementMode={activeBlock.measurementMode}
                    context="current"
                  />

                  {activeBlockAnalysis && (
                    <HandleAnalysisSection
                      boxPlots={activeBlockAnalysis.handleTargetErrorBoxPlots}
                      comparison={activeBlockAnalysis.handleAccuracy}
                    />
                  )}

                  <TargetActualScatterChart
                    points={targetVsActualScatterData}
                    explanation={targetVsActualExplanation("current")}
                  />
                </div>
              </details>

              {/* Recent Shots — and its inline Edit/Delete controls — is a
                  correction tool, not the primary analysis surface, so it
                  stays collapsed by default and below Detailed Analytics
                  ("Editing previous shots is an exception workflow.
                  Monitoring performance is the primary workflow."). */}
              <details className="group rounded-2xl border border-slate-200 bg-white">
                <summary className="cursor-pointer list-none rounded-2xl px-4 py-3 text-sm font-medium text-slate-700 marker:content-none group-open:rounded-b-none">
                  <span className="flex items-center justify-between gap-2">
                    <span>
                      Recent Shots ({filteredActiveBlockShots.length})
                    </span>
                    <span className="text-xs text-slate-400 group-open:hidden">Show</span>
                    <span className="hidden text-xs text-slate-400 group-open:inline">Hide</span>
                  </span>
                </summary>

                <div className="border-t border-slate-100 p-4">
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
                                Target {shot.targetTime.toFixed(2)} ·
                                Prediction {shot.predictedTime.toFixed(2)} ·
                                Actual {shot.releaseTime.toFixed(2)}
                              </p>
                              <p className="text-slate-600">
                                Prediction Error{" "}
                                {formatSigned(
                                  shot.predictedTime - shot.releaseTime
                                )}
                              </p>
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

                              <p className="font-semibold text-slate-900">
                                {shot.releaseTime.toFixed(
                                  2
                                )}
                                s
                              </p>

                              <p className="text-xs text-slate-500">
                                Target {shot.targetTime.toFixed(2)}s
                              </p>
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
                  {(activeBlock.mode === "fixed" ||
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

              <button
                type="button"
                onClick={() =>
                  exportSessionToCsv(currentSession)
                }
                className="w-full rounded-xl bg-slate-900 px-4 py-3 font-medium text-white transition hover:bg-slate-700"
              >
                Export Current Session CSV
              </button>

              <button
                type="button"
                onClick={handleStartNewSession}
                disabled={!sessionWritable}
                className="w-full rounded-xl bg-red-100 px-4 py-3 font-medium text-red-700 transition hover:bg-red-200 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Start New Session
              </button>
            </>
          )}
        </>
      )}

      {activeView === "assess" && assessmentState && (
        <>
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
          {/* Training / Assessments are distinct domain concepts (Training
              Sessions vs. Assessment Runs) that happen to share this one
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
            className="grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1"
          >
            <button
              type="button"
              role="tab"
              aria-selected={analyzeTab === "training"}
              onClick={() => setAnalyzeTab("training")}
              className={`min-h-11 rounded-lg px-3 py-2 text-sm font-medium transition ${
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
              aria-selected={analyzeTab === "assessments"}
              onClick={() => setAnalyzeTab("assessments")}
              className={`min-h-11 rounded-lg px-3 py-2 text-sm font-medium transition ${
                analyzeTab === "assessments"
                  ? "bg-slate-900 text-white"
                  : "text-slate-700 hover:bg-slate-200"
              }`}
            >
              Assessments
            </button>
          </div>

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
                    {trainingInsight
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

                <div className="mt-4 grid grid-cols-2 gap-3">
                  <TargetAccuracyDashboardCards
                    targetAccuracy={historyTargetAccuracy}
                    measurementMode={effectiveHistoryFilters.measurementMode ?? "back-hog"}
                    thresholds={historyThresholds}
                  />

                  {historyAnalysisContext.hasBlindCategory && (
                    <PredictionDashboardCards analysis={historyFullAnalysis} />
                  )}
                </div>
              </div>

              {effectiveHistoryFilters.measurementMode && (
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
              <div>
                <h3 className="px-1 text-sm font-semibold text-slate-500">
                  Detailed Analysis
                </h3>

                <div className="mt-3 space-y-4">
                  {effectiveHistoryFilters.measurementMode && (
                    <ShotQualityTrendChart
                      entries={historyAnalysisContext.progressEntries}
                      measurementMode={effectiveHistoryFilters.measurementMode}
                    />
                  )}

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
                      historyThresholds
                    )}
                  />
                </div>
              </div>
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
                const sessionThresholdsUniform = hasUniformThresholds(
                  entries.map((entry) => entry.thresholds)
                );
                const sessionThresholds = representativeThresholds(entries);
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
                  sessionThresholds
                );
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
                        {!sessionThresholdsUniform && (
                          <p className="text-xs text-slate-500">
                            Thresholds vary across blocks in this session —
                            rates below use a representative default for
                            comparison.
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
                            thresholds={sessionThresholds}
                          />

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
                            ({ block, shots, thresholds }) => (
                              <HistoryBlockPanel
                                key={block.id}
                                block={block}
                                shots={shots}
                                thresholds={thresholds}
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

      {confirmAction && (
        <ConfirmModal
          title={confirmAction.title}
          message={confirmAction.message}
          confirmLabel={
            confirmAction.confirmLabel
          }
          isDanger
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
  /** The effective thresholds for this View — the block's own snapshot in
      Original mode, or the active Comparison preset. Never re-derives from
      block.accuracyThresholds itself, so Comparison mode can override it. */
  thresholds: AccuracyThresholds;
};

function HistoryBlockPanel({
  block,
  shots,
  thresholds,
}: HistoryBlockPanelProps) {
  const analysis = analyzeShots(shots, thresholds);
  const blockMap = new Map([[block.id, block]]);
  const onTargetPercent =
    analysis.targetAccuracy.shotCount > 0
      ? Math.round((analysis.targetAccuracy.onTargetRate ?? 0) * 100)
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
              · {measurementModeLabel(block.measurementMode)}
              {(block.mode === "fixed" ||
                (block.mode === "blind" && block.blindTargetMode === "fixed")) && (
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
          thresholds={thresholds}
        />

        {block.mode === "blind" && (
          <PredictionDashboardCards analysis={analysis} />
        )}
      </div>

      <div className="mt-3">
        <ReleaseTrendChart shots={shots} />
      </div>

      <div className="mt-3">
        <TargetErrorChart
          points={prepareTargetErrorByShotData(shots, blockMap, thresholds)}
          thresholds={thresholds}
          measurementMode={block.measurementMode}
          context="history"
        />
      </div>

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
                  Target {shot.targetTime.toFixed(2)} · Prediction{" "}
                  {shot.predictedTime.toFixed(2)} · Actual{" "}
                  {shot.releaseTime.toFixed(2)} · Prediction Error{" "}
                  {formatSigned(shot.predictedTime - shot.releaseTime)}
                </p>
              </div>
            ) : (
              <div className="flex items-center justify-between">
                <span className="text-sm text-slate-600">
                  #{shot.shotNumber} ·{" "}
                  {shot.handle === "in" ? "In" : "Out"}
                  {shot.shotType && <> · {shot.shotType}</>} · Target{" "}
                  {shot.targetTime.toFixed(2)}s
                </span>

                <span className="text-sm font-semibold text-slate-900">
                  {shot.releaseTime.toFixed(2)}s
                </span>
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
