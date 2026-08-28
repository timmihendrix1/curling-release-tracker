# ADR-0012: Training Plans are a session-snapshot execution over lazily-created Training Blocks, with plan/step types kept centrally to avoid a domain-type cycle

## Status

Accepted. Implemented for the original Release-Time-only model; generalised by
ADR-0040 for profile-owned mixed Exercise plans. Per `docs/TRAINING_SYSTEM_AND_PLANS.md` (the
authoritative product/domain spec). See `docs/SYSTEM_ARCHITECTURE.md`'s "Training
Plans" section for the current-implementation snapshot this ADR explains the
reasoning behind.

## Context

Training Plans introduce a new persisted domain (a reusable, ordered sequence of
preconfigured release-time steps) that must, when started, drive an ordinary
`Session` through real `TrainingBlock`s — while never letting a later plan edit or
deletion retroactively change an already-started or completed `Session`. Several
architectural questions had to be resolved before implementation, each with more than
one plausible answer:

1. Are all of a plan's `TrainingBlock`s created up front ("eager"), or one at a time as
   the athlete reaches each step ("lazy")? The spec explicitly leaves this open,
   provided the active execution stays independent of later plan edits either way.
2. Where do the new plan/step/execution types live? `Session` needs to reference plan
   execution state directly, but the type-defining file for plan/step types
   (wherever it ends up) will also need to import basic domain types (`Handle`,
   `BlockMode`, ...) that already live in `src/types/index.ts` — a naive "give
   Training Plans its own `types.ts`, the same way `src/lib/assessment/types.ts`
   does" would create an import cycle back into `src/types/index.ts`.
3. Should a Plan Step's persisted configuration be defined in terms of
   `TrainingSetup.tsx`'s existing `TrainingSetupValue` export (reusing it directly),
   or as its own, independently-owned domain type?
4. Migration: does `Session.planExecution` follow `sessionMigration.ts`'s general
   field-by-field repair style, or Assessment's discard-the-whole-record style?
5. What happens when the final step reaches its planned shot count — is it exactly
   the same "Continue" UI as a mid-plan step transition, or something different?
6. How does progression logic find "the current step's block" — by trusting
   `session.blocks` array position, or by an explicit stored reference?

## Decision

### 1. Lazy block creation

Each step's `TrainingBlock` is created via the existing `addTrainingBlock`
(`src/lib/trainingBlocks.ts`) at the exact moment the athlete starts the plan or taps
Continue for that step — never all up front. This reuses `addTrainingBlock` completely
unmodified (the same function "New Training Block" already calls) and avoids inventing
an "inactive future block" concept the current architecture has no other use for. The
trade-off: progression state must track, per step, whether its block has been created
yet (see decision 6).

### 2. Plan/step/execution types live centrally in `src/types/index.ts`, not a separate `trainingPlans/types.ts`

Precedent: `CaptureSequence`, `CaptureStepRecord`, and `CaptureHandleMode` already live
in `src/types/index.ts` even though the logic that operates on them lives in
`src/lib/captureSequence.ts` — a lib module imports types *from* the central file, it
does not define competing ones. Training Plans follows the same rule: `HandleStrategy`,
`ShotCountCompletion`, `ReleaseTimingBlockConfiguration`, `ReleaseTimingPlanStep`,
`TrainingPlanStep`, `TrainingPlan`, `PlanExecutionStepSnapshot`, and
`PlanExecutionState` are all defined in `src/types/index.ts`, alongside the `Session`
field (`planExecution?: PlanExecutionState`) that needs them. Every file under
`src/lib/trainingPlans/*.ts` imports these types one-directionally from
`src/types/index.ts`; none of them defines its own type file. This is a stricter rule
than Assessment's (which does have its own `src/lib/assessment/types.ts`, because
`Session` never needs to reference an Assessment type directly) — Training Plans is
different specifically because `Session.planExecution` creates the direct dependency.

### 3. `ReleaseTimingBlockConfiguration` is its own domain type, independent of `TrainingSetupValue`

Audited `TrainingSetup.tsx`: `TrainingSetupValue` (`name`, `mode`, `measurementMode`,
`targetTime`, `variableTargetMode`, `blindTargetMode`, `smartRandomMin`,
`smartRandomMax`, `accuracyThresholds`) is genuinely block-scoped — no Session-level
field leaks into it — so reusing the `TrainingSetup` *component* for the Plan Step
editor is safe and correct (`TrainingPlanStepEditor.tsx` renders it unmodified for
every field it needs). But the persisted `ReleaseTimingBlockConfiguration` type is
**not** type-derived from `TrainingSetupValue` — a domain model must not depend on a
UI component's form-value export, which could change shape for presentation reasons
unrelated to the domain. `TrainingPlanStepEditor.tsx` converts between the two locally
(structurally identical today, two independently-owned types).

### 4. `Session.planExecution` migration follows Assessment's discard-style, not `sessionMigration.ts`'s general repair style

`PlanExecutionState` has strict cross-field invariants — `activeStepIndex` must
validly index `steps`; every step at or before it must have a `blockId` resolving to a
real, already-migrated block; every step after it must not have one yet — much closer
to `AssessmentRun`'s invariants than to a `TrainingBlock`'s independently-optional
fields. `sessionMigration.ts`'s `migratePlanExecution` therefore validates the whole
`planExecution` record and discards it entirely on any structural problem, rather than
patching one field in isolation (which could silently attribute the wrong block to the
wrong step). Discarding only ever removes the plan-progress *decoration* on a
`Session` — `blocks`/`shots` (the actual training data) are migrated independently,
before this runs, and are never affected by a corrupt or missing `planExecution`. The
Training Plan *library*'s own migration (`src/lib/trainingPlans/migration.ts`, a
separate persisted domain/key) follows the opposite, `sessionMigration.ts`-style
field-by-field repair instead, since a `TrainingPlan`'s fields are mostly independent
scalars — but it never silently coerces a step's sport-specific configuration (e.g.
Hog-Hog + Smart Random) into a different, fabricated-valid combination; an
unexecutable step stays unexecutable and visible, per spec section 53.

### 5. Final-step completion is a distinct state, never a mislabeled "Continue"

Two mutually exclusive, derived states once the active step's shot count is reached:
not-final-step shows `TrainingPlanStepTransition kind="continue"`; final-step shows
`kind="plan-complete"` with an explicit **Finish Training** action. Finish Training
calls the *existing* `handleStartNewSession` — plan completion introduces no new
session-archiving logic of its own. A misleading "Continue to next step" is
structurally prevented from appearing on the final step (the two kinds are mutually
exclusive props, not an ad hoc boolean flag).

### 6. Progression is always keyed by the snapshot's stored `blockId`, never array position

**Generalised by ADR-0040:** the same principle now uses a discriminated `runtime`
reference. A Release Time step remains keyed by its stored `blockId`; a curated
Technique/Shotmaking step is keyed by its stored `exerciseExecutionId`. Array position
is still never used to resolve a sporting runtime entity.

Every place that needs "the block for the current step" resolves it via
`session.blocks.find(b => b.id === snapshot.blockId)` (or the equivalent
`getBlockShots(session, blockId)`) — `session.blocks[stepIndex]` is never assumed to
equal `planExecution.steps[stepIndex]`'s block. `isPlanExecutionActive(session,
planExecution)` (`src/lib/trainingPlans/progress.ts`) is the one guard everything else
composes with: it is false whenever `session.activeBlockId` doesn't match the active
step's stored `blockId`, or that `blockId` doesn't resolve to a real block at all. This
covers, without a crash or a silent wrong-block guess:

- **A manual "New Training Block" interrupts an active plan.** The athlete's own
  `activeBlockId` now points at a fresh, non-plan block; `isPlanExecutionActive`
  becomes false, the plan progress/transition UI simply stops rendering, and no
  re-entry mechanism is built for V1 — a documented scope limit, not an oversight.
- **A corrupted/dangling `blockId` at runtime.** The plan UI treats this exactly like
  "not currently active" — it never guesses which block to advance into.
- **A deleted shot.** `getBlockShots` recomputes from `session.shots` fresh on every
  read, so step completion is never based on a stale cached count.

### Also decided, in brief

- **No new `ActiveView`.** Training Plans live entirely inside the existing `"train"`
  view (`TrainLanding.tsx`, mounted only when there's no active block), per spec
  section 21.
- **No new "leave" guard.** A Plan Execution is just a `Session` with one extra field;
  the existing Start-New-Session/History behavior already archives whatever state
  exists, and the existing Blind-draft/Capture-Sequence guards fire correctly
  regardless of whether the active block came from a plan.
- **Handle Strategy reuses Capture Sequence's alternation parity math.**
  `resolveExpectedHandle` (`src/lib/trainingPlans/handleStrategy.ts`) uses the same
  `shotsSaved % 2` logic as `captureSequence.ts`'s `computeNextCaptureHandle`, applied
  to classic manual entry (`ShotEntry`/`BlindShotEntry`'s new `presetHandle` prop)
  instead of a Capture Sequence's `capturedShotCount`. `handleStrategyToCaptureHandleMode`
  additionally maps a Handle Strategy onto `CaptureHandleMode` so a plan-driven block's
  Auto Capture setup can be pre-filled — still fully overridable, never locked.

## Consequences

- Adding a Rotation/Line/Assessment Plan Step type later only requires extending the
  `TrainingPlanStep` union and its own mapping/validation module — the central-types
  placement, the lazy-creation model, and the blockId-keyed progression all generalize
  without redesign.
- The Training Plan library and `Session.planExecution` are migrated independently,
  by different functions, in different styles, deliberately — a future contributor
  should not try to unify them into one shared migration helper without re-deriving
  why the invariants differ (see decision 4).
- History/Analyze show only a one-line "Started from: {plan name}" label; no new
  analytics system was introduced for plans (spec sections 35/36) — scope
  intentionally kept small for Version 1.
