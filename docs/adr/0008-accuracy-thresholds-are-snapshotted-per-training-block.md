# ADR-0008: Accuracy Thresholds are snapshotted per Training Block

## Status

Accepted. Implemented.

## Context

Every shot already carries an immutable `targetTime` (ADR-0001), so target error
(`releaseTime - targetTime`) has always been computable. What was missing was a
personal, interpretable notion of *how close counts as good* — the raw numbers
(bias, mean absolute error, standard deviation) don't by themselves answer "am I
hitting my target?" without a tolerance to judge them against.

That tolerance needs to be editable (different athletes, different drills, different
training phases want different bands) but also historically stable: if a coach
tightens the default tolerance next month, a block trained and reviewed last month
must not silently become "worse" because it's now judged against a stricter band it
was never actually trained under.

## Decision

1. A new domain type, `AccuracyThresholds` (`{ onTarget: number; acceptable: number }`,
   `src/lib/accuracyThresholds.ts`), defines three mutually exclusive categories for a
   shot's absolute target error:
   - **On Target**: `absoluteTargetError <= onTarget`
   - **Acceptable**: `onTarget < absoluteTargetError <= acceptable`
   - **Major Miss**: `absoluteTargetError > acceptable`
2. Two named presets exist: **Standard** (0.10s / 0.20s) and **Tight** (0.05s / 0.10s),
   plus **Custom** (freely entered, validated). These are explicitly documented as
   recommendations, not objective or scientifically validated performance norms — same
   posture as Smart Random's ranges (see ADR-0004 and the "No fabricated precision"
   product principle). "Tight" was chosen over "Elite" specifically to avoid an
   unearned claim of competitive validation.
3. **`TrainingBlock.accuracyThresholds` is a snapshot, taken once at block creation**
   (`createTrainingBlock` in `trainingBlocks.ts`) from whatever preset/custom pair was
   selected in `TrainingSetup` at that moment. It is never re-derived from the app's
   current default afterward, and nothing mutates an existing block's snapshot.
4. **Validation** (`validateAccuracyThresholds`) requires both values to be finite,
   positive numbers with `acceptable > onTarget` — no fixed upper bound is invented, and
   category-boundary comparisons use a small epsilon (`1e-9`) to absorb floating-point
   subtraction noise (`3.85 - 3.75 !== 0.1` in IEEE 754) without blurring two genuinely
   different values.
5. **Migration** (`sessionMigration.ts`) backfills any block missing a threshold
   snapshot, or carrying an invalid one (NaN, Infinity, zero/negative, or
   `acceptable <= onTarget`), to the fixed legacy default (0.10s / 0.20s) — never to
   whichever preset the app happens to default to today. This follows the same
   idempotent, value-preserving discipline as every other migration rule (ADR-0005):
   already-recorded shot values are never touched, only the missing/broken block-level
   configuration is repaired.
6. **This is a Target Accuracy concept, not a Prediction Accuracy one.** Blind Weight's
   existing prediction metrics (bias, MAE, SD, correlation — see `analytics.ts`) are
   completely unaffected and remain a separate lens; `AccuracyThresholds` only judges
   `releaseTime` against `targetTime`, for every training mode including Blind Weight.
7. **A statistical boxplot outlier (beyond 1.5x IQR, `boxPlotStatistics.ts`) is a
   different concept from a Major Miss** and the two must never be labeled,
   colored, or exported as one another. Major Miss is a fixed personal/coaching
   tolerance judgement; a statistical outlier is a property of a specific dataset's
   spread and would flag a different shot depending on what's in the sample.

## Extension (History Analytics and Filtering pass): Threshold Comparison Mode

The decisions above still stand — `TrainingBlock.accuracyThresholds` remains a snapshot,
never mutated, never re-derived from today's default. This pass adds a **non-persisting
evaluation mode for History analytics only** (`ThresholdComparisonMode`,
`src/lib/historyAnalysis.ts`):

- **Original** (default) — unchanged from the decision above: each block is judged
  against its own snapshot.
- **Comparison** — a temporarily-selected `AccuracyThresholds` (Standard/Tight preset,
  or Custom) is used to re-classify every selected shot's On Target/Acceptable/Major
  Miss category for that render only. No `TrainingBlock` or `Shot` is ever written to;
  `HistoryAnalysisBlockContext.thresholds` simply holds the override instead of the
  block's snapshot when building History's analytics. Scatterplot coordinates are
  unaffected either way — only classification changes.

This does not weaken point 3 of the Decision above (the snapshot is still taken once, at
creation, and never mutated) — it adds a second, explicit, clearly-labeled *lens* for
viewing already-recorded history, the same way Original Thresholds already was one lens
among what a coach might want to ask. The UI always states which mode is active, and
which thresholds it's using, so "how did I do against what I trained under" and "how do
all these trainings compare on one scale" are never silently conflated.

## Consequences

- Every chart and dashboard metric that needs "is this shot good?" (Dashboard cards,
  Target Error by Shot's reference bands, Shot Quality Over Time, CSV's
  `target_error_category`/`is_major_miss`) reads the same
  `resolveAccuracyThresholds(block.accuracyThresholds)` + `categorizeTargetError` pair —
  no parallel threshold logic anywhere.
- Comparing blocks with different threshold snapshots (different presets, or edited
  over time) requires showing that difference explicitly (`hasUniformThresholds`,
  surfaced as a "Thresholds vary across selected blocks" notice) rather than silently
  averaging across incompatible bands or recomputing historical rates under today's
  default.
- Cost: every `TrainingBlock` carries a small amount of redundant, block-scoped
  configuration (the snapshot) instead of a single global setting — the same trade-off
  ADR-0001 already made for `shot.targetTime`, for the same reason: historical
  correctness must never depend on today's configuration still matching yesterday's.
