# ADR-0048: A Training Plan's planned volume is guidance; progression and finishing are always available

## Status

Accepted and implemented (2026-09-29).

**Six implementation defects in this area were found by independent review and
corrected on 2026-10-06.** They were defects in how this decision was carried out, not
changes to the decision itself — early Next Exercise and Finish Training remain fully
supported and non-destructive, and the planned stone count remains guidance:

1. **Archive race.** Session-mutating controls stayed live across the awaited
   archive-and-replace write, so a stone recorded after the archive snapshot was chosen
   was accepted on screen and then dropped. A transition lock now refuses the mutation
   for the duration (`sessionTransitionPending`); typed input is preserved for an
   immediate retry, and the capture path refuses results on the same rule.
2. **Unacknowledged Next Exercise.** Advancing a step updated visible state and left
   persistence fire-and-forget, so a failed `saveCurrent` left screen and storage
   disagreeing with no visible retry path. The advance now awaits a session-level save
   acknowledgement and reports a real failure.
3. **Abandon inside a plan.** A curated Exercise still offered Abandon Exercise, which
   discards the Exercise Execution the active plan step is bound to and could strand
   the plan without navigation. It is no longer offered inside a plan — the same rule
   "Back to Exercise Library" already followed.
4. **Untruthful completion messaging.** `isPlanComplete` consulted only the final step,
   so skipping an earlier step and completing the last one produced "Save this
   completed training to history?". Completion is now derived from the whole plan.
5. **Finish summary stone count.** The summary counted only `session.shots`, reporting
   "0 stones recorded" after recorded Shotmaking stones. It now counts applicable
   recorded stones across the plan's supported execution types without double counting
   (`countRecordedStones`); Release Time is recorded as Shots and is deliberately never
   duplicated as an Exercise Execution.
6. **Queued timing-result ownership.** A result received while no capture was active
   could be attributed to a capture started before the queued callback ran. Ownership
   (session, block, capture sequence) is now captured at receipt and re-verified at
   processing; a mismatch is reported as not belonging. This bounds re-attribution by
   the application only — it makes no claim about radio events the Brower protocol
   itself cannot distinguish, and the observed-baseline, arming, deduplication and
   save-confirmation safeguards are unchanged.

## Context

Version 1's plan runner treated a Release Time step's configured stone count as a gate.
`Continue to Next Step` appeared only once the count was reached; before that the
athlete saw a "Record N more stones to continue" notice, and a curated Technique or
Shotmaking step had to be explicitly completed before the plan would move. `Finish
Training` only appeared in the final step's own "Plan complete" state, so a training
that had to stop early had no plan-owned way to end — only the red, discard-flavoured
`Start New Session`, which the plan runner deliberately hides.

Real ice time does not work that way. A sheet gets taken away, a warm-up runs long, an
exercise turns out to be worth extending, another turns out to be unnecessary. The
specification already said as much (`docs/TRAINING_SYSTEM_AND_PLANS.md` sections 31-34:
"The plan is guidance, not a hard barrier that blocks valid training data"), but the
implementation contradicted it.

Making the controls always available raises three problems the old gating hid:

1. An in-progress Exercise Execution blocks `attachSoloExerciseExecution`, so the next
   step could not be materialised until the previous one had been terminalised — which,
   under gating, the athlete had always already done by hand.
2. A live Auto Capture belongs to the step being left. Its results must not follow the
   athlete into the next one.
3. `activeStepIndex` was being used as a proxy for "every earlier step is complete".
   Once steps can be left early or skipped past, that inference becomes false.

## Decision

### 1. Planned volume is guidance, never a gate

`Next Exercise` is offered whenever a next Plan Step exists — below, at and beyond the
planned stone count, and with nothing recorded at all. `Finish Training` is offered
throughout an active plan, including midway through an exercise and before the final
step. Reaching the planned count never advances the plan by itself, and extra stones
stay recordable in the same step.

Nothing in the domain's completion rules changed: `isActiveStepComplete` /
`isPlanComplete` still mean exactly what ADR-0012 and ADR-0040 defined. They simply no
longer gate navigation — they describe progress and pick truthful confirmation copy.

`docs/TRAINING_SYSTEM_AND_PLANS.md` section 31 is the canonical statement; every other
document references it rather than restating the rule.

### 2. Ending a step is one domain transition, not a UI convention

`endActivePlanStepRuntime` (`src/lib/trainingPlans/stepTransition.ts`) is a pure
old-Session + event → new-Session function:

- A curated step is **completed** when the Exercise domain considers it completable and
  **abandoned** when it does not (an empty Shotmaking execution, for example). An
  already-terminal execution is returned untouched — never reopened, never rewritten.
  No attempt, measurement, exclusion or private Athlete Note is ever invented or lost,
  and global Exercise validation is not weakened to let an empty step "complete".
- A Release Time step keeps its Block and Shots exactly as recorded; only an Auto
  Capture sequence still bound to that Block is cancelled, which is what makes a late
  Timing Result unattributable to the step that replaces it.

Finish Training applies the same transition before archiving, so an exercise the
athlete genuinely finished is recorded as completed rather than as the interruption
`prepareSessionForArchive` would otherwise assume. Standalone (non-plan) training is
untouched by this.

### 3. The transition runs on the existing capture queue and is bound to its intent

`Next Exercise` is enqueued onto `captureQueueRef` — the same serialization point every
`TimingResult` and the Session archive transition already use (ADR-0007, ADR-0014) —
behind a synchronous single-flight ref. The enqueued work re-reads `sessionRef` and
revalidates the Session id *and* the step index the click was bound to, so a stale
second click, or a click racing a `Finish Training` that already archived the Session,
finds its precondition gone instead of advancing a plan that has moved on.

Ending the previous runtime, materialising the next one and stamping the advanced plan
reference are computed as plain values and committed **together**, so no Session in
which the plan points at one step while another is still open is ever observable.

Leaving a step still passes through `guardLeavingActiveWork`, unchanged: an unsaved
Blind Weight draft and a live Auto Capture are confirmed first. No second, plan-specific
guard exists.

### 4. Step outcomes are derived, never stored

`getPlanStepSummaries` derives each step's outcome from the Session's own recorded data:
`not-started` (no runtime was ever materialised), `in-progress`, `completed`,
`ended-early` and `nothing-recorded`. `completedStepCount` is counted from those
outcomes rather than from `activeStepIndex`, so a step the athlete never reached can
never read as completed.

No new persisted field is introduced and `sessionMigration.ts` is unchanged: an existing
Session's steps already record everything these outcomes need (whether a runtime
reference exists, the Shots in its Block, the Exercise Execution's own terminal status).
Historical status is therefore derived, never invented.

### 5. Finishing opens a factual summary of the archived Session

`TrainingPlanFinishSummary` renders the Session that was actually archived — never the
empty replacement Session the transition creates — with each step's planned figure
beside its actual one. A lower actual figure is stated as a recorded fact and never
interpreted as a shortfall. When nothing sporting was recorded, the existing
empty-Session policy still applies (nothing is archived) and the summary says exactly
that rather than implying a saved training. A failed history write shows a retry-able
message and no summary at all, so a persistence failure can never read as success.

There is no new Save, Abort or Discard action: recorded work continues to use the
existing automatic persistence, and `Start New Session` remains hidden while a plan owns
progression, in the curated-Exercise runner as well as the timing runner.

## Consequences

- An athlete can shorten, extend or skip past a planned exercise and end a training at
  any point without losing recorded work or being told they did something wrong.
- A Session archived mid-plan is an ordinary Training Session: History, Analyze and the
  cloud record treat it exactly as before.
- An empty step that could not legally complete is visible as `abandoned` in the
  archived Session. That is a truthful interruption record, not an error state, and the
  plan UI never describes routine early progression as a destructive abort.
- Backward navigation to an earlier step, runtime plan editing, resuming after Finish
  and planned volumes for step types that have none remain out of scope — see
  `docs/TECHNICAL_DEBT_AND_ROADMAP.md`.
- The summary is in-memory only: it is dismissed by leaving Train and does not survive a
  reload. The archived Session itself is unaffected.
