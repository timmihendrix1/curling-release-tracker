# ADR-0011: Assessment execution shares the app shell's capture, navigation-guard, and persistence patterns with Training, under one active-capture-owner rule

## Status

Accepted. Implemented for Phase B (Release Time Core Assessment v1 execution flow) —
see `docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md` for the product/domain
rules this implements, `docs/adr/0010` for the Phase A domain/persistence foundation
this builds on, and `docs/TECHNICAL_DEBT_AND_ROADMAP.md`'s "Assessment Framework"
section for phase sequencing.

## Context

Phase A built a complete Assessment domain and persistence layer with no app-shell
integration at all (see ADR-0010's "Known limitation, not solved by this pass").
Wiring a real Assess screen into `TrackerApp.tsx` raised three architectural questions
that the domain layer alone could not answer:

1. Training already has exactly one shared `TimingProvider`/`TimingResult`
   subscription (ADR-0006) feeding exactly one Capture Sequence at a time. Does
   Assessment get a second subscription, or share the first one? If shared, which
   context — Training or Assessment — gets a given `TimingResult` when both a
   Training Session and an Assessment Run technically exist at once?
2. `handleNavigate`'s guard (ADR-0009) only ever protected leaving Train. Does an
   active Assessment Run need the same kind of protection, and if so, does confirming
   it cancel the run (like Training's Capture Sequence) or something else?
3. Phase A's `persistence.ts` deliberately has no `localStorage` read/write call site
   (ADR-0010, "Known limitation"). Where does that read/write actually happen, and
   does it risk worsening the one pre-existing, documented
   `react-hooks/set-state-in-effect` lint condition on `TrackerApp`'s mount effect?

## Decision

### 1. One shared TimingResult subscription; capture ownership is derived from Assessment Run status, never a separate flag

`TrackerApp` keeps its single simulator subscription (unchanged from Training's
existing wiring) and its single serialized processing queue
(`captureQueueRef`/`processIncomingTimingResult`, ADR-0007). A new function,
`isAssessmentCaptureActive()`, reads the authoritative `assessmentStateRef` and
returns true iff a `currentRun` exists with status `"warmup"` or `"in_progress"`.
`processQueuedTimingResult` checks this first: if true, the result is routed to
`processQueuedAssessmentTimingResult` (which adapts it via
`applyTimingResultToAssessmentRun`, `src/lib/assessment/capture.ts`) and Training's
own capture logic never runs for that result; otherwise Training's existing logic
runs unchanged.

Why derive ownership from status rather than a separate `activeCaptureOwner` flag:
a Run's status already encodes exactly the fact needed ("is this run currently able to
receive a valid attempt"), and a Run can only be in `"warmup"`/`"in_progress"` while
the app itself put it there — introducing a second, independently-settable flag would
create a state that could desync from the Run's own status (the flag says "assessment
owns capture" while the Run says `"paused"`, for example), which is exactly the kind of
duplicated-source-of-truth bug this project's principles warn against. A pure derived
check has no desync to guard against.

Manual entry (`AssessScreen`'s `onSubmitManualTime`) is not a separate code path: it
builds a `TimingResult` via the same `createManualTimingResult` Training's manual
fallback already uses, and pushes it through the same `processIncomingTimingResult`
queue — so a manually-typed Assessment time and a Timing-Simulator-emitted Assessment
time are processed identically, and `addValidAttempt` is called from exactly one place
(`applyTimingResultToAssessmentRun`), matching this project's existing "one shot-save
path" discipline (ADR-0006/0007) rather than inventing a second one for Assessment.

### 2. Leaving Assess while a Run is warming up or scoring pauses it (never cancels/loses attempts); `guardLeavingActiveWork` grows a third composed guard

`handleNavigate`'s guard condition was generalized from "leaving Train" to "leaving
Train OR leaving Assess," each with its own warning-message input.
`runOrConfirmAssessmentLeave` (new, shaped identically to the existing
`runOrConfirmBlindDraftDiscard`/`runOrConfirmCaptureLeave`) confirms via the same
`ConfirmModal`, and on confirmation calls `pauseAssessmentRun` (see Decision 4) rather
than abandoning or cancelling anything — attempts, position, and the threshold/template
snapshots are all untouched. `guardLeavingActiveWork` now composes all three guards in
sequence (blind draft → capture sequence → assessment), which is correct unconditionally
even though at most one of the three is ever actually active at a time under Capture
Ownership rule 1.

Why pause rather than reuse the Training pattern's "cancel": a cancelled Training
Capture Sequence is a bounded, disposable unit of work (its own shots remain, but the
*sequence* itself is meaningless to resume). An Assessment Run is the opposite — its
entire value is the ability to resume later without any loss, and the domain layer
already has a well-defined `"paused"` status built for exactly this. Treating "leaving
the screen" as equivalent to "abandoning the run" would force an athlete to explicitly
re-confirm abandonment just to check Home, which the product spec explicitly rules out
("keine stille Beendigung", but also no forced abandonment for merely navigating away).

### 3. `pauseAssessmentRun` composes two already-legal transitions rather than adding a new state-machine edge

Phase A's `ALLOWED_TRANSITIONS` (`run.ts`) has `"warmup" -> ["in_progress",
"incomplete"]` — no direct edge to `"paused"`. A first implementation of the
navigation guard (and of Reload Recovery, Decision 4) called
`transitionAssessmentRun(run, "paused")` unconditionally and silently failed (returned
an ignored error) whenever the guard fired during warm-up, leaving the run live and
defeating the entire guard. The fix, `pauseAssessmentRun` (`run.ts`), transitions
`"warmup" -> "in_progress" -> "paused"` when starting from warm-up, or directly
`-> "paused"` otherwise, and is now the only function this app ever calls to pause a
run (`AssessScreen.handlePause`, `TrackerApp`'s leave-guard, and Reload Recovery all
use it).

This does not add a new transition edge to the table — it composes two that already
exist. It was chosen over adding `"warmup" -> "paused"` directly to
`ALLOWED_TRANSITIONS` because the UI's own warm-up/scored distinction is already
independent of `status` (see `isWarmupComplete`, `progress.ts`, which counts attempts,
not status) specifically so that this exact composition is safe: after resuming a
warm-up-time pause, `status` reads `"in_progress"` while the UI still correctly shows
the remaining warm-up shots, because it was never reading `status` for that in the
first place.

### 4. Assessment persistence gets its own load/save effect pair in `TrackerApp`, mirroring Session's; Reload Recovery force-pauses via the same function

A new `assessmentState` (`AssessmentPersistedState | null`) mirrors `currentSession`'s
existing pattern exactly: `useState(null)`, read via `localStorage.getItem` +
`migrateAssessmentPersistedState` inside the existing mount effect, `null` while
unloaded (nothing renders until it resolves), and one dedicated `useEffect` writing
`serializeAssessmentPersistedState` on every change. This is the read/write call site
ADR-0010 explicitly deferred to Phase B. An `assessmentStateRef` mirrors it
synchronously (same rationale as `sessionRef`, ADR-0007) so the capture queue always
reads committed state.

If the loaded `currentRun` is still `"warmup"`/`"in_progress"` (i.e. it survived an
actual reload rather than an explicit Pause), the mount effect force-pauses it via
`pauseAssessmentRun` before it is ever rendered — the run's own status is the "was this
resumed after a reload" signal, so no separate boolean is needed, and no silent
capture-subscription auto-start ever occurs (Capture Ownership, Decision 1, already
derives from status, so a paused run is automatically excluded). A separate
`pendingReloadRecoveryRunId` is set at that moment and consumed by the first explicit
Resume afterward, which appends a `resumed_after_reload` Protocol Deviation and sets
`interruption.resumedAfterReload` — an ordinary in-session Pause/Resume (no reload in
between) never touches either field, since the mount effect is the only place that sets
`pendingReloadRecoveryRunId`.

Adding this second load/save effect pair does not worsen the existing, documented
`react-hooks/set-state-in-effect` condition on the mount effect (see
`docs/TECHNICAL_DEBT_AND_ROADMAP.md`'s "On demand" section): that lint finding already
existed before this change (confirmed against the pre-Phase-B commit) and fires on
`setCurrentSession`, a call this change never touches; the new Assessment-loading code
added to the same effect body is not itself flagged (Vitest's `react-hooks/*` rules
did not add a second occurrence for this specific pattern in practice).

A currentRun that fails validation (Phase A's conservative quarantine, ADR-0010) is
detected by comparing "did the raw parsed object have a `currentRun`" against "did
migration keep one" — if a `currentRun` was dropped, a transparent, non-technical
notice (`ASSESSMENT_QUARANTINE_NOTICE`) is shown and dismissible; Training is
completely unaffected (separate key, per ADR-0010).

## Alternatives Considered

- **A second, Assessment-specific `TimingProvider` subscription.** Rejected — this is
  exactly the "parallel shot-save path" ADR-0006 already ruled out for Training; two
  independent subscriptions to the same simulator instance would also risk duplicate
  delivery of a single result to both contexts if ownership were ever momentarily
  ambiguous.
- **A separate `activeCaptureOwner: "training" | "assessment" | "none"` state slot,
  set explicitly on every relevant transition.** Rejected in favor of the pure
  derived check (Decision 1) — see the reasoning there.
- **Cancelling (not pausing) an Assessment Run on navigation-guard confirmation**, to
  mirror Training's Capture Sequence guard exactly. Rejected — see Decision 2.
- **Adding `"warmup" -> "paused"` directly to `ALLOWED_TRANSITIONS`.** Rejected in
  favor of composing existing edges (Decision 3) — avoids widening Phase A's
  state-machine surface for a Phase B integration need.

## Consequences

- Phase C (Result screen, Analyze integration, run comparison) can read completed/
  incomplete runs from `history` without touching any of this — nothing here assumes
  anything about how a finished run is later displayed.
- **Known limitation, not solved by this pass:** the defensive guard in
  `handleStartCaptureSequence` (block starting Training Auto Capture while
  `isAssessmentCaptureActive()`) is, by construction, unreachable through normal
  navigation — leaving Assess always pauses an active run first, so by the time a user
  reaches Train, Capture Ownership already excludes Assessment. It is kept anyway as a
  defense-in-depth backstop against a future navigation path that might not route
  through the guard, not because it currently fires in practice.
- **Known limitation, not solved by this pass:** `pauseAssessmentRun`'s
  warmup-through-in_progress composition means a Run paused mid-warmup and inspected
  directly (e.g. a future export or Phase C detail view) will show `status:
  "in_progress"` even though the athlete never explicitly started the scored portion.
  Any future code reading `status` to mean "scored execution has begun" must use
  `isWarmupComplete`/`calculateWarmupProgress` (`progress.ts`) instead, exactly as this
  pass's own UI does — never re-introduce a `status === "warmup"` check for that
  purpose.
