"use client";

import { useEffect, useRef, useState } from "react";
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
import TargetTimeSettings from "./TargetTimeSettings";
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
import TrainingSetup, { type TrainingSetupValue } from "./TrainingSetup";

import type {
  AccuracyThresholds,
  Handle,
  Session,
  Shot,
  ShotType,
  TimingResult,
  TrainingBlock,
} from "../types";
import type { AssessmentRun } from "../lib/assessment/types";

import { resolveAccuracyThresholds } from "../lib/accuracyThresholds";
import {
  analyzeShots,
  computeHandleAccuracyComparison,
  computeHandleTargetErrorBoxPlots,
} from "../lib/analytics";
import { targetVsActualExplanation } from "../lib/analyticsExplanations";
import { applyTimingResultToAssessmentRun } from "../lib/assessment/capture";
import { migrateAssessmentPersistedState } from "../lib/assessment/migration";
import {
  ASSESSMENT_STORAGE_KEY,
  createEmptyAssessmentPersistedState,
  deleteAssessmentRunFromHistory,
  getAssessmentRunFromHistory,
  serializeAssessmentPersistedState,
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
import { migrateSession, migrateSessionHistory } from "../lib/sessionMigration";
import {
  createSimulatorTimingProvider,
} from "../lib/simulatorTimingProvider";
import {
  hasMultipleTargetTimes,
  hasUniformThresholds,
  prepareTargetErrorByShotData,
  prepareTargetVsActualScatterData,
} from "../lib/chartData";
import {
  aggregateTargetAccuracyAcrossBlocks,
  buildHistoryAnalysisContext,
  createDefaultHistoryFilters,
  getAvailableMeasurementModes,
  getAvailableTrainingCategories,
  representativeThresholds,
  resolveDefaultMeasurementMode,
  resolveDefaultTrainingCategory,
  sanitizeHistoryFilters,
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
} from "../lib/trainingBlocks";

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
    description: "Set up a session and record release times as you throw.",
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

const CURRENT_SESSION_STORAGE_KEY =
  "curling-release-tracker-current-session";
const SESSION_HISTORY_STORAGE_KEY =
  "curling-release-tracker-session-history";
const HISTORY_FILTERS_STORAGE_KEY =
  "curling-release-tracker-history-filters";

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

function createNewSession(): Session {
  return {
    id: crypto.randomUUID(),
    title: "Training Session",
    date: new Date().toISOString(),
    notes: "",
    blocks: [],
    activeBlockId: "",
    shots: [],
  };
}

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

export default function TrackerApp() {
  const [activeView, setActiveView] =
    useState<ActiveView>(DEFAULT_ACTIVE_VIEW);

  const [currentSession, setCurrentSession] =
    useState<Session | null>(null);

  const [sessionHistory, setSessionHistory] = useState<
    Session[]
  >([]);

  const [historyFilters, setHistoryFilters] = useState<HistoryAnalysisFilters>(
    createDefaultHistoryFilters()
  );

  const [blockFilter, setBlockFilter] = useState(
    DEFAULT_SHOT_FILTER
  );

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
  const captureQueueRef = useRef<Promise<void>>(Promise.resolve());

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
  }, [simulatorProvider]);

  useEffect(() => {
    const savedSession = localStorage.getItem(
      CURRENT_SESSION_STORAGE_KEY
    );

    const savedHistory = localStorage.getItem(
      SESSION_HISTORY_STORAGE_KEY
    );

    if (savedSession) {
      const loadedSession = migrateSession(JSON.parse(savedSession));
      setCurrentSession(loadedSession);

      // Home is the normal entry point (see docs/adr/0009), except for the one
      // active training situation reload can hand back: a Capture Sequence
      // that was running or paused when the page closed. Landing on Home would
      // hide that in-progress state behind an extra tap for no benefit — Train
      // shows it exactly as left (paused, progress intact) without any risk,
      // so this is the one case that starts there instead.
      if (isCaptureSequenceActive(loadedSession.captureSequence)) {
        setActiveView("train");
      }
    } else {
      setCurrentSession(createNewSession());
    }

    if (savedHistory) {
      setSessionHistory(
        migrateSessionHistory(JSON.parse(savedHistory))
      );
    }

    const savedHistoryFilters = localStorage.getItem(
      HISTORY_FILTERS_STORAGE_KEY
    );

    if (savedHistoryFilters) {
      try {
        setHistoryFilters(sanitizeHistoryFilters(JSON.parse(savedHistoryFilters)));
      } catch {
        // Corrupt/old-shape persisted filters are never fatal — fall back to
        // the defaults already set at initial state.
      }
    }

    // --- Assessment data (its own key, own migration path — ADR-0010/0011) ---
    const savedAssessment = localStorage.getItem(ASSESSMENT_STORAGE_KEY);
    let rawAssessment: unknown = null;
    try {
      rawAssessment = savedAssessment ? JSON.parse(savedAssessment) : null;
    } catch {
      rawAssessment = null;
    }
    const migratedAssessment = rawAssessment
      ? migrateAssessmentPersistedState(rawAssessment)
      : createEmptyAssessmentPersistedState();

    // A raw currentRun existed but failed validation (quarantined) — surface
    // this transparently rather than letting it silently disappear (see
    // docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md section 24).
    const rawHadCurrentRun =
      typeof rawAssessment === "object" &&
      rawAssessment !== null &&
      "currentRun" in rawAssessment &&
      (rawAssessment as { currentRun?: unknown }).currentRun !== undefined;
    if (rawHadCurrentRun && !migratedAssessment.currentRun) {
      setAssessmentQuarantineNotice(ASSESSMENT_QUARANTINE_NOTICE);
    }

    // Reload Recovery: a persisted run that was still "warmup"/"in_progress"
    // survived a reload (the app never persists "capture is live" as a
    // separate flag — this status combination IS that signal). Force it to
    // "paused" before it's ever rendered, so capture never silently
    // reactivates without an explicit Resume tap (see spec section 21-23).
    let finalAssessment = migratedAssessment;
    if (
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
  }, []);

  useEffect(() => {
    if (!currentSession) return;

    localStorage.setItem(
      CURRENT_SESSION_STORAGE_KEY,
      JSON.stringify(currentSession)
    );
  }, [currentSession]);

  useEffect(() => {
    localStorage.setItem(
      HISTORY_FILTERS_STORAGE_KEY,
      JSON.stringify(historyFilters)
    );
  }, [historyFilters]);

  useEffect(() => {
    localStorage.setItem(
      SESSION_HISTORY_STORAGE_KEY,
      JSON.stringify(sessionHistory)
    );
  }, [sessionHistory]);

  useEffect(() => {
    if (!assessmentState) return;
    localStorage.setItem(
      ASSESSMENT_STORAGE_KEY,
      serializeAssessmentPersistedState(assessmentState)
    );
  }, [assessmentState]);

  if (!currentSession) {
    return null;
  }

  const activeBlock = getActiveBlock(currentSession);
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
    setCurrentSession((session) => {
      if (!session) return session;

      return {
        ...session,
        title,
      };
    });
  }

  function handleChangeSessionNotes(notes: string) {
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
    const session = sessionRef.current;
    if (!session || !session.captureSequence) return;

    commitSession({
      ...session,
      captureSequence: pauseCaptureSequence(session.captureSequence),
    });
  }

  function handleResumeCaptureSequence() {
    const session = sessionRef.current;
    if (!session || !session.captureSequence) return;

    commitSession({
      ...session,
      captureSequence: resumeCaptureSequence(session.captureSequence),
    });
  }

  function handleCancelCaptureSequence() {
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
    if (!activeBlock) return;
    processIncomingTimingResult(
      createManualTimingResult(activeBlock.measurementMode, value)
    );
  }

  function handleDeleteShot(shotId: string) {
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
  // so we validate/construct outside of it first.
  function tryCreateTrainingBlock(value: TrainingSetupValue) {
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
    const block = tryCreateTrainingBlock(value);
    if (!block) return;

    setCurrentSession((session) => {
      if (!session) return session;

      return {
        ...session,
        blocks: [block],
        activeBlockId: block.id,
      };
    });
  }

  function handleCreateNewBlock(value: TrainingSetupValue) {
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

  function handleStartNewSession() {
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
          onConfirm: () => {
            if (
              currentSession &&
              currentSession.shots.length > 0
            ) {
              setSessionHistory((currentHistory) => [
                currentSession,
                ...currentHistory,
              ]);
            }

            setCurrentSession(createNewSession());
            setBlockFilter(DEFAULT_SHOT_FILTER);
            setActiveView("train");
            setConfirmAction(null);
          },
        });
      }
    );
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
        />
      )}

      {activeView === "train" && (
        <>
          {!activeBlock || !activeBlockAnalysis ? (
            <>
              <SessionSettings
                title={currentSession.title}
                notes={currentSession.notes}
                onChangeTitle={handleChangeSessionTitle}
                onChangeNotes={handleChangeSessionNotes}
              />

              <div className="rounded-2xl bg-white p-6 shadow-lg">
                <h2 className="text-xl font-semibold text-slate-900">
                  Set Up Training Block
                </h2>

                <p className="mt-2 text-sm text-slate-600">
                  Configure the first training block for this
                  session.
                </p>

                <div className="mt-4">
                  <TrainingSetup
                    submitLabel="Start Training"
                    onSubmit={handleCreateFirstBlock}
                  />
                </div>
              </div>
            </>
          ) : (
            <>
              <div className="rounded-2xl bg-white p-4 shadow-lg">
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
                    className="min-h-11 whitespace-nowrap rounded-xl bg-slate-100 px-3 py-2 text-sm font-medium text-slate-700 transition hover:bg-slate-200"
                  >
                    New Training Block
                  </button>
                </div>
              </div>

              {shotEntryTarget && activeBlock.mode === "blind" ? (
                <BlindShotEntry
                  key={`${activeBlock.id}-${blindDraftResetToken}`}
                  onAddShot={handleAddShot}
                  target={shotEntryTarget}
                  onDraftStateChange={setHasUnsavedBlindDraft}
                />
              ) : (
                shotEntryTarget && (
                  <ShotEntry
                    onAddShot={handleAddShot}
                    target={shotEntryTarget}
                  />
                )
              )}

              {activeBlock.mode === "blind" ? (
                <div className="rounded-2xl bg-slate-100 p-4 text-sm text-slate-600">
                  Auto Capture isn&apos;t available for Blind Weight yet —
                  prediction must be locked before an automatic reading could be
                  applied. Use the manual Blind Weight flow above.
                </div>
              ) : (
                <>
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
                  />

                  {IS_DEV && (
                    <TimingSimulatorPanel
                      provider={simulatorProvider}
                      measurementMode={activeBlock.measurementMode}
                      diagnostics={captureDiagnostics}
                    />
                  )}
                </>
              )}

              <div className="rounded-xl bg-slate-100 p-3">
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

              <div className="rounded-2xl bg-white p-6 shadow-lg">
                <div className="flex items-center justify-between gap-3">
                  <h2 className="text-xl font-semibold text-slate-900">
                    Dashboard
                  </h2>

                  <p className="text-xs text-slate-500">
                    {filteredActiveBlockShots.length} of{" "}
                    {activeBlockShots.length} shots shown
                  </p>
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
                  <div className="mt-4 grid grid-cols-2 gap-3">
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
                      targetAccuracy={activeBlockAnalysis.targetAccuracy}
                      measurementMode={activeBlock.measurementMode}
                      thresholds={
                        activeBlockAccuracyThresholds ??
                        resolveAccuracyThresholds(undefined)
                      }
                    />

                    {activeBlock.mode === "blind" && (
                      <PredictionDashboardCards
                        analysis={activeBlockAnalysis}
                      />
                    )}
                  </div>
                )}
              </div>

              <ReleaseTrendChart shots={filteredActiveBlockShots} />

              {/* Primary live chart — see docs/SYSTEM_ARCHITECTURE.md's
                  Current Session information hierarchy. */}
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

              {/* Scatterplot is prominent for Variable Weight; collapsed by
                  default (secondary) for Fixed Weight with only one target,
                  since there is little to see beyond consistency at that
                  single weight. */}
              {activeBlock.mode === "fixed" &&
              !hasMultipleTargetTimes(targetVsActualScatterData) ? (
                <details className="group">
                  <summary className="cursor-pointer rounded-2xl bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-lg marker:content-none group-open:rounded-b-none group-open:shadow-none">
                    Target vs. Actual (single target — tap to expand)
                  </summary>
                  <TargetActualScatterChart
                    points={targetVsActualScatterData}
                    explanation={targetVsActualExplanation("current")}
                  />
                </details>
              ) : (
                <TargetActualScatterChart
                  points={targetVsActualScatterData}
                  explanation={targetVsActualExplanation("current")}
                />
              )}

              <div className="rounded-2xl bg-white p-6 shadow-lg">
                <h2 className="text-xl font-semibold text-slate-900">
                  Current Shots
                </h2>

                <div className="mt-4 space-y-2">
                  {filteredActiveBlockShots.map((shot) => {
                    const isEditing =
                      editingShot?.id === shot.id;

                    return (
                      <div
                        key={shot.id}
                        className="rounded-xl bg-slate-100 p-4"
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

              {/* Session Details During Execution (DESIGN_SYSTEM.md §19.6):
                  collapsed by default rather than repeating the entire
                  Target Time / Session Name / Notes setup form after the
                  analytics area — the athlete opens it explicitly via Edit
                  Details when they actually need to change something. */}
              <details className="group rounded-2xl bg-white shadow-lg">
                <summary className="cursor-pointer list-none px-4 py-3 text-sm font-medium text-slate-700 marker:content-none">
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
                    />
                  )}

                  <SessionSettings
                    variant="bare"
                    title={currentSession.title}
                    notes={currentSession.notes}
                    onChangeTitle={handleChangeSessionTitle}
                    onChangeNotes={handleChangeSessionNotes}
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
                className="w-full rounded-xl bg-red-100 px-4 py-3 font-medium text-red-700 transition hover:bg-red-200"
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
          {/* 1. Sticky Analysis Filters */}
          <HistoryFilterBar
            filters={effectiveHistoryFilters}
            onChange={setHistoryFilters}
            availableTrainingCategories={
              historyAnalysisContext.availableTrainingCategories
            }
            availableMeasurementModes={
              historyAnalysisContext.availableMeasurementModes
            }
            sessions={sessionHistory}
          />

          {/* 2. Analysis Context */}
          <AnalysisContextSummary context={historyAnalysisContext} />

          {historyAnalysisContext.totalShotCount > 0 && (
            <>
              {/* 3. Key Progress Summary */}
              <div className="rounded-2xl bg-white p-6 shadow-lg">
                <h2 className="text-xl font-semibold text-slate-900">
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
                <>
                  {/* 4. Progress Metric Chart */}
                  <ProgressMetricChart
                    entries={historyAnalysisContext.progressEntries}
                    measurementMode={effectiveHistoryFilters.measurementMode}
                  />

                  {/* 5. Shot Quality Over Time */}
                  <ShotQualityTrendChart
                    entries={historyAnalysisContext.progressEntries}
                    measurementMode={effectiveHistoryFilters.measurementMode}
                  />
                </>
              )}

              {/* 6. Target vs Actual Scatterplot — across every comparable
                  block/session in the selection, shot-level, never reduced
                  to block averages. */}
              <TargetActualScatterChart
                points={historyScatterPoints}
                explanation={targetVsActualExplanation("history")}
                notices={historyScatterNotices}
              />

              {/* 7. Handle Analysis */}
              <HandleAnalysisSection
                boxPlots={computeHandleTargetErrorBoxPlots(
                  historyAnalysisContext.shots
                )}
                comparison={computeHandleAccuracyComparison(
                  historyAnalysisContext.shots,
                  historyThresholds
                )}
              />
            </>
          )}

          {/* 8. Blocks and Sessions — detail/navigation list onto the same
              central selection; it never dominates the analysis above. */}
          <div className="rounded-2xl bg-white p-6 shadow-lg">
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
                    className="rounded-xl bg-slate-100 p-4"
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
                        className="rounded-lg bg-red-100 px-3 py-2 text-sm font-medium text-red-700 transition hover:bg-red-200"
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
        />
      )}

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

  return (
    <div className="rounded-xl bg-white p-4">
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

        <p className="whitespace-nowrap text-xs text-slate-500">
          {shots.length} shot{shots.length === 1 ? "" : "s"}
        </p>
      </div>

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
