import type { ExerciseExecution } from "../lib/exercises/executionTypes";
import type { ExerciseVersion } from "../lib/exercises/types";

// Personal, editable tolerance bands used to judge target accuracy — a Target
// Accuracy concept, distinct from Prediction Accuracy (Blind Weight). Snapshotted
// per TrainingBlock at creation time so later default changes never retroactively
// change a historical block's on-target/acceptable/major-miss rates. See
// src/lib/accuracyThresholds.ts.
export type AccuracyThresholds = {
  onTarget: number;
  acceptable: number;
};

export type Handle = "in" | "out";

export type ShotType = "draw" | "takeout";

export type BlockMode = "fixed" | "variable" | "blind";

export type MeasurementMode = "back-hog" | "hog-hog";

// Only meaningful when BlockMode is "variable".
export type VariableTargetMode = "smart-random" | "manual";

// Only meaningful when BlockMode is "blind". Unlike Variable Weight, Blind
// Weight also allows a constant "fixed" target — the thing being trained is
// the player's own perception, not the target itself changing.
export type BlindTargetMode = "fixed" | "smart-random" | "manual";

// Where a measured value originated. Shared by two boundaries that are the same
// underlying concept: Blind Weight's `setMeasuredReleaseTime` (src/lib/blindWeight.ts)
// and the Timing Provider / Capture Sequence boundary (src/lib/timingProvider.ts,
// src/lib/captureSequence.ts). "external" is named ahead of time but not yet backed
// by any real hardware, protocol, or manufacturer integration.
export type TimingProviderType = "simulator" | "manual" | "external";

// Alias kept for existing Blind Weight call sites — same concept, same values.
export type ReleaseTimeSource = TimingProviderType;

// A single measured value from a timing provider, tagged with what it measures.
// A TimingResult may carry more than one of these (e.g. a future device reporting
// Back-Hog and Hog-Hog from one sequence) even though the current Capture MVP only
// ever consumes the one matching the active block's measurementMode.
export type TimingMeasurement = {
  measurementMode: MeasurementMode;
  value: number;
};

// A normalized, provider-agnostic timing reading. Every provider — the simulator,
// a manual fallback entry, and (later) real hardware — produces exactly this shape;
// nothing downstream of this type knows or cares which provider produced it.
export type TimingResult = {
  id: string;
  receivedAt: string;
  source: TimingProviderType;
  measurements: TimingMeasurement[];
  deviceId?: string;
  laneId?: string;
};

export type TrainingBlock = {
  id: string;
  name: string;
  mode: BlockMode;
  measurementMode: MeasurementMode;
  // Default/fallback target: the single target for "fixed" blocks, the
  // constant target for "blind"+"fixed", and the initial seed value for
  // "variable"/"blind" blocks using Smart Random or Manual.
  targetTime: number;
  createdAt: string;
  // Set once a newer block becomes active; undefined means this block is active.
  completedAt?: string;
  // Only set (and only meaningful) when mode === "variable".
  variableTargetMode?: VariableTargetMode;
  // Only set (and only meaningful) when mode === "blind".
  blindTargetMode?: BlindTargetMode;
  // The target to use for the *next* shot in a "variable" or "blind" block
  // (when its target mode is "smart-random" or "manual") — either the last
  // auto-generated smart-random value, or the coach's last manual entry.
  // Persisted so a reload doesn't lose or regenerate the in-progress target.
  // Not used for "fixed"-target blocks, which always use `targetTime` directly.
  pendingTargetTime?: number;
  // Only set (and only meaningful) when variableTargetMode/blindTargetMode
  // is "smart-random". The user-configured range Smart Random generates
  // targets within for this block. Fixed/Manual blocks don't use or store one.
  smartRandomMin?: number;
  smartRandomMax?: number;
  // Snapshotted at block creation from whatever thresholds were selected at setup
  // time. Never mutated afterwards and never re-derived from later default changes
  // — this is what keeps a block's historical on-target/acceptable/major-miss rates
  // stable even if the app's default thresholds change later. Absent only for
  // blocks created before this concept existed; migration backfills the legacy
  // default (0.10s / 0.20s) rather than leaving it undefined.
  accuracyThresholds?: AccuracyThresholds;
};

export type Shot = {
  id: string;
  sessionId: string;
  blockId: string;
  shotNumber: number;
  releaseTime: number;
  // The target that actually applied to this specific shot. Always set at
  // creation time and never changed afterwards, even if the block's default
  // or pending target later changes.
  targetTime: number;
  // The thrower's own guess at the release time, locked in before the actual
  // releaseTime is known. Required for Blind Weight shots; always undefined
  // for Fixed/Variable Weight shots — never fabricated for either.
  predictedTime?: number;
  handle: Handle;
  // Blind Weight doesn't require a draw/takeout classification — it trains
  // perception of release time, not shot-type-specific execution. Genuinely
  // absent for those shots; never defaulted to "draw" to fill the gap.
  shotType?: ShotType;
  comment?: string;
  createdAt: string;
  // Only set for shots recorded through a Capture Sequence (src/lib/captureSequence.ts).
  // Undefined for every shot entered through the classic manual flows
  // (ShotEntry/BlindShotEntry) — that distinction is deliberate: "undefined" means
  // "not part of any capture sequence", "manual" means "a manual fallback reading
  // was supplied *within* an active capture sequence". Never fabricated by migration.
  measurementSource?: TimingProviderType;
  captureSequenceId?: string;
  timingResultId?: string;
  deviceId?: string;
  laneId?: string;
};

// One expected-shot-count-bounded stretch of automatic (or manual-fallback) timing
// capture, scoped to exactly one TrainingBlock. See src/lib/captureSequence.ts.
export type CaptureSequenceStatus =
  | "ready"
  | "running"
  | "paused"
  | "completed"
  | "cancelled";

// How the Handle for each captured shot is determined, since Auto Capture is meant
// to work without a tap between shots.
export type CaptureHandleMode = "manual" | "fixed-in" | "fixed-out" | "alternate";

// Enough context per successfully-captured shot to reverse it exactly (Undo) without
// reconstructing anything — no new random target, no re-derived handle history.
export type CaptureStepRecord = {
  resultId: string;
  shotId: string;
  targetTime: number;
  previousPendingTargetTime?: number;
  nextPendingTargetTime?: number;
  handle: Handle;
};

export type CaptureSequence = {
  id: string;
  sessionId: string;
  blockId: string;
  expectedShotCount: number;
  // Shots actually saved by this sequence — not raw results received. A duplicate,
  // invalid, mismatched, or paused-and-discarded result never increments this.
  capturedShotCount: number;
  status: CaptureSequenceStatus;
  providerType: TimingProviderType;
  handleMode: CaptureHandleMode;
  // Baseline handle for "alternate" (which handle the first captured shot gets);
  // ignored by "fixed-in"/"fixed-out", and by "manual" (handle comes from live UI state).
  startHandle: Handle;
  // Fixed classification applied to every shot this sequence captures — only
  // meaningful for Fixed Weight blocks; Variable/Blind Weight never set this,
  // consistent with those modes never requiring a Shot Type.
  shotType?: ShotType;
  // Every TimingResult id ever submitted to this sequence, accepted or not — a
  // resend of any of these ids is always a duplicate. Bounded by usage (a finite
  // sequence only ever sees on the order of expectedShotCount results), not global.
  processedResultIds: string[];
  // One entry per successfully captured shot, in order; length always equals
  // capturedShotCount. The only data Undo needs.
  steps: CaptureStepRecord[];
  startedAt?: string;
  pausedAt?: string;
  completedAt?: string;
  cancelledAt?: string;
  // Set when processing a TimingResult threw an unexpected exception (a bug, not a
  // normal rejection like "duplicate" or "invalid") — the sequence is forced to
  // "paused" at the same time, never left "running" with an error. Cleared on
  // resumeCaptureSequence, so a successful Resume always starts from a clean slate.
  // There is no separate "error" status — see ADR-0006 and
  // docs/TECHNICAL_DEBT_AND_ROADMAP.md for why "paused" + this field was chosen.
  lastError?: string;
};

// --- Training Plans (see docs/TRAINING_SYSTEM_AND_PLANS.md and
// docs/adr/0012-training-plans-domain-and-execution-model.md) ---
//
// These types live centrally, next to TrainingBlock/Shot/CaptureSequence, rather
// than in a separate src/lib/trainingPlans/types.ts — the same placement already
// used for CaptureSequence/CaptureStepRecord/CaptureHandleMode even though the logic
// that operates on them lives in src/lib/captureSequence.ts. Session.planExecution
// transitively needs ReleaseTimingPlanStep (via PlanExecutionStepSnapshot), so
// keeping the whole family here avoids any import cycle between this file and
// src/lib/trainingPlans/*.ts, which only ever import types *from* here.

// For Version 1, every Release Timing Plan Step completes after a fixed number of
// saved shots. Modeled as a discriminated completion rule (not a bare number) so a
// future step type can use a different completion kind without redefining this one.
export type ShotCountCompletion = {
  type: "shot-count";
  value: number;
};

// How the Handle for each shot in a step is expected to behave. Distinct from, but
// conceptually identical to, CaptureHandleMode's "fixed-in"/"fixed-out"/"alternate" —
// see resolveExpectedHandle/handleStrategyToCaptureHandleMode in
// src/lib/trainingPlans/handleStrategy.ts for the mapping between the two.
export type HandleStrategy =
  | { type: "free" }
  | { type: "fixed"; handle: Handle }
  | { type: "alternating"; startingHandle: Handle };

// The block-scoped configuration a Release Timing Plan Step stores. Structurally
// close to TrainingSetup.tsx's TrainingSetupValue, but deliberately a separate,
// domain-owned type — a persisted plan must not depend on a UI component's form-value
// shape. src/components/TrainingPlanStepEditor.tsx converts between the two locally.
export type ReleaseTimingBlockConfiguration = {
  name: string;
  mode: BlockMode;
  measurementMode: MeasurementMode;
  targetTime: number;
  variableTargetMode: VariableTargetMode;
  blindTargetMode: BlindTargetMode;
  smartRandomMin: number;
  smartRandomMax: number;
  accuracyThresholds: AccuracyThresholds;
};

// One Release Time unit inside a Training Plan. Its explicit discriminant coexists
// with CuratedExercisePlanStep after Stage D — see ADR-0040.
export type ReleaseTimingPlanStep = {
  id: string;
  type: "release-timing";
  /** Immutable Library provenance for the Measured Exercise this step executes. */
  exerciseVersionSnapshot: ExerciseVersion;
  completion: ShotCountCompletion;
  handleStrategy: HandleStrategy;
  configuration: ReleaseTimingBlockConfiguration;
};

/**
 * A curated Technique or Shotmaking step. Its content snapshot is the complete
 * plan-time instruction/configuration reference; the resulting Exercise Execution
 * records the actual variation, Measurements and execution context separately.
 * Open-ended completion is deliberate: these Exercises finish through the existing
 * explicit Complete Exercise transition, not an invented planned-volume threshold.
 */
export type CuratedExercisePlanStep = {
  id: string;
  type: "curated-exercise";
  exerciseVersionSnapshot: ExerciseVersion;
  completion: { type: "exercise-completion" };
};

/** The extensible, persisted discriminated union used by mixed Training Plans. */
export type TrainingPlanStep = ReleaseTimingPlanStep | CuratedExercisePlanStep;

// A reusable, ordered configuration — not training data. Persisted independently of
// currentSession/sessionHistory (its own localStorage key, see
// src/lib/trainingPlans/persistence.ts). Editing a plan never mutates a Session that
// was already started or completed from it — see PlanExecutionState below.
export type TrainingPlan = {
  id: string;
  name: string;
  description?: string;
  steps: TrainingPlanStep[];
  createdAt: string;
  updatedAt: string;
  schemaVersion: number;
};

// One step's state within an active/completed plan execution. `step` is a deep copy
// taken at plan-start time (never a live reference to the saved TrainingPlan) — this
// is what makes a later plan edit or deletion incapable of affecting an
// already-started or completed Session. `runtime` is set only once the step's own
// execution entity has actually been created (lazy creation — see ADR-0012/ADR-0040);
// a step without one hasn't been reached. The discriminated runtime reference keeps
// release-time blocks and embedded Exercise Executions distinct without teaching the
// plan aggregate either domain's internal measurement logic.
export type PlanStepRuntimeReference =
  | { kind: "release-timing-block"; blockId: string }
  | { kind: "exercise-execution"; exerciseExecutionId: string };

export type PlanExecutionStepSnapshot = {
  step: TrainingPlanStep;
  /** Absent only on a future, lazily-unmaterialised step. */
  runtime?: PlanStepRuntimeReference;
};

// Attached to a Session when it was started from a Training Plan. Absent for every
// Quick Start session. `activeStepIndex` always indexes a real entry in `steps`
// (0..steps.length-1) — there is no separate "plan complete" index value; plan
// completion is derived from the final step's own runtime (Release Time shot count or
// curated Exercise completion status), never stored separately. See
// src/lib/trainingPlans/progress.ts.
export type PlanExecutionState = {
  sourcePlanId: string;
  sourcePlanName: string;
  sourcePlanUpdatedAt?: string;
  steps: PlanExecutionStepSnapshot[];
  activeStepIndex: number;
};

export type Session = {
  id: string;
  title: string;
  date: string;
  notes?: string;
  blocks: TrainingBlock[];
  activeBlockId: string;
  shots: Shot[];
  // At most one at a time, for the current session only — see
  // docs/adr/0006-capture-sequences-share-the-timing-result-boundary.md.
  captureSequence?: CaptureSequence;
  // Set only when this Session was started from a Training Plan. See
  // docs/TRAINING_SYSTEM_AND_PLANS.md and docs/adr/0012.
  planExecution?: PlanExecutionState;
  // Technique and Shotmaking Exercise Library work is embedded in the same
  // Profile-owned Training Session aggregate. Release Time continues to use
  // blocks/shots above; it is not duplicated as an ExerciseExecution.
  exerciseExecutions?: ExerciseExecution[];
  // Present exactly while one embedded Exercise Execution is in progress.
  activeExerciseExecutionId?: string;
  // Present when the Release Time Library entry started this Session's existing
  // Block/Shot runner. This is instructional provenance, not a parallel execution.
  releaseTimingExerciseVersionSnapshot?: ExerciseVersion;
};
