# Fixed Weight speed and simplified capture

Status: product scope approved on 2026-10-06. **Stage A (measurement model and
compatibility foundation) is implemented and has PASSED independent review. Stage B
(simplified setup, capture and results) is implemented and awaits independent review.**
Rollout readiness remains a separate unmet gate, and real-device iOS/TCi acceptance has
not been established. The architectural decisions Stage A settled, and the defects its
reviews found, are recorded in
`docs/adr/0051-fixed-weight-measured-quantities-and-per-side-tolerances.md`.
This remains the canonical product decision record for this feature. It does not mark
the existing unstaged training-progression, native-storage, or Brower work as reviewed.

Stage A alone was deliberately not a user-ready m/s release: it exposed no speed
recording control, setup field or capture surface. **Stage B changes that** — Fixed
Weight setup now offers Time / Speed (m/s) / Both, speed is recorded manually against
its own target and per-side tolerance, a missing measurement can be completed on an
explicitly identified stone, and results, history and export present each quantity on
its own terms. Production activation is still gated on the unresolved old-client
rollout policy below.

## Approved outcome

Fixed Weight remains one training form. At setup, including a Fixed Weight plan
step, choose Time, Speed (m/s), or Both. Speed is manually entered in this release.
Time keeps its existing manual and supported external capture paths. Measurement
selection is distinct from the timing interval (Backline–Hog or Hog–Hog).

Configure a fixed target for each selected metric. No automatic conversion between
seconds and m/s is provided. Do not invent a default target speed or infer a speed
measurement from a timer interval. Both measurements belong to the same stone.

The first delivery covers Fixed Weight setup, plan configuration, capture and its
necessary storage, history, analysis and export support. Variable Weight, Blind
Weight, Assessments and curated Shotmaking/Technique execution keep their existing
measurement semantics. Shared UI improvements may not remove their capabilities.

## Target accuracy

- Initial speed tolerance: On Target within +/-0.05 m/s; Acceptable outside that
  inner band but within +/-0.10 m/s; Major Miss outside the outer band. Boundaries
  are inclusive for the inner category. These are adjustable app starting values,
  not validated elite, scientific or federation norms.
- Support independent lower and upper tolerances for both bands in this Fixed
  Weight flow. Initially show symmetric values; an explicit asymmetric option
  reveals the separate lower/upper fields.
- Time and speed use independent, unit-specific thresholds and classifications.
  Keep existing time defaults and historical semantics. Do not convert time
  presets into speed presets or select a template with incompatible units.
- On each side the Acceptable band must contain and extend beyond On Target.
  Preserve the existing finite, positive tolerance invariant. Boundary comparisons
  must handle floating-point subtraction without rounding raw measurements first.
- Preserve the targets used by each shot and snapshot thresholds per block.
  Changing a template must never reclassify historical training implicitly.
- Show measured value and signed actual-minus-target deviation. Do not combine
  the two metric classifications into one score or call them Shotmaking percentage.

## Capture and missing measurements

- A stone has one identity, handle, shot type and progress count, even with two
  measurements. Adding a missing metric never adds another stone or advances the
  plan's handle strategy again.
- Both mode permits a stone with only one measurement. Missing is distinct from
  zero and excluded only from that metric's analysis denominator. A saved stone
  must contain at least one real measurement.
- An accepted TCi time is saved without waiting for manual speed entry. Add speed
  explicitly to the identified stone in the current training; never guess pairing
  from the newest stone or notification arrival time. Retain both value sources.
- Completing a missing measurement is not permission for unrestricted correction
  of historical records or rewriting an already recorded measurement.
- Save errors retain recoverable input and the intended stone identity. Only
  acknowledged writes may be described as saved. Retries must not duplicate stones.
- Next Exercise and Finish Training preserve recorded work, including stones with
  one missing metric. Planned counts remain guidance; early next/finish and extra
  stones remain supported. Pending unsaved input must not be silently discarded.

## Simplified user experience

Setup order: training form, measurement selection, applicable target fields, then
Start Training. Speed-only hides time targets, time interval and timing-device
controls. Both displays the two targets with visible units.

Show a compact tolerance summary and one Adjust action. Its editor exposes saved
unit-compatible templates directly, without a Custom prerequisite. Put optional
naming and infrequent settings under More Settings. Keep essential labels and
units visible; put conceptual explanations in contextual help.

During training show the current target, applicable input fields, handle and shot
type in one capture area. Use one primary Save Shot action for manual entry and
subtle factual success feedback. External capture must communicate its saved state
without requiring a second save of the same time. Surface missing speed against
an explicit stone identity. Keep Next Exercise and Finish Training visible;
offer a new training after finishing. Put infrequent management actions in a menu.

Preserve touch usability, keyboard/decimal input and accessible labels. Validate
the flow at 320x700 and 390x844 as well as desktop. Existing app language remains
English; German conversation labels are descriptions, not a localization project.

## Architecture and compatibility constraints

Retain Session / TrainingBlock / Shot ownership, profile scoping, repository-based
storage and the shared web/mobile domain. Do not introduce a separate speed
session, device-specific sporting store, duplicate UI domain model or sync engine.

Preserve the timing boundary and ADR-0050 Brower protocol, observed-baseline,
deduplication, arming, save-confirmation and lifecycle safeguards. Do not interpret
a timing interval enum as a metric selector or add fabricated TCi speed support.

Existing time-only data must remain time-only with its exact recorded values,
targets and historical thresholds. New speed-only or partial stones must never
receive fabricated releaseTime=0, targetTime=3.75, or a made-up timing interval.
Unknown or invalid new formats must not be silently normalized into legacy data.

Archive, reload, backup/export and existing terminal-session cloud upload/restore
must preserve speed, targets, per-side thresholds, provenance, missingness and
stable identities. Existing immutable cloud payload bytes/digests must not change
merely because the updated app reads them. This does not add plan or active-session
cloud sync, background refresh, concurrent editing or cross-device continuation.

### Audit findings and required reconciliation

**Stage A outcome (2026-10-06).** Every finding below is reconciled as described,
except the deployed-old-client rollout gate, which remains open and is a release gate.
`src/types/index.ts` now represents a missing measurement without fabricating one;
`sessionMigration.ts` and plan migration distinguish legacy from measurement-aware
records via the presence of `TrainingBlock.measurement`, leaving every legacy repair
rule untouched; ADR-0008 is extended (not superseded) with per-quantity, per-side
tolerances that re-express a legacy symmetric pair losslessly; `cloudSporting/records.ts`
is version-aware: wire version 2 is selected by the presence of a measurement
configuration anywhere the session persists one — a block, or an embedded plan-step
snapshot whose Block has not been created yet — and therefore also covers an
asymmetric time-only configuration. A session with no configuration anywhere keeps its
existing payload bytes, digest and identity unchanged; and no SQL, RLS or ownership
change was needed.

- `src/types/index.ts` currently requires time fields on every block and shot.
  This feature supersedes that assumption for new Fixed Weight configurations;
  existing timing-only consumers need explicit metric eligibility.
- `sessionMigration.ts` and plan migration reconstruct timing fields and defaults.
  They must distinguish legacy records from new measurement-aware records.
- ADR-0008 describes symmetric time-only threshold pairs. Extend its current
  decision with per-metric/per-side support while retaining block snapshots and
  the original meaning of legacy pairs.
- *(Reconciled in Stage A.)* `cloudSporting/records.ts` accepted training schema version 1 only and
  compares parsed payloads to migration results. `syncManager.ts` also compares
  exact payload strings. Adding defaults to old immutable payloads can cause
  restore rejection or conflicts. Version-aware validation is required.
- Current Supabase terminal-record storage accepts positive schema versions and
  opaque payload strings. There is no demonstrated need for a new SQL table or
  change to ownership/RLS for this feature.
- An already deployed old client stops its restore pass on an unsupported record.
  New code cannot retroactively change that client. Document the compatibility
  matrix and retain a release gate for the rollout/update policy; do not claim
  old-client interoperability or deploy this feature without resolving that gate.
- The native-storage migration/cutover remains its own incomplete workstream.
  iOS compatibility is not evidence that native production storage has switched.

## Delivery stages and review gates

### A — Measurement model and compatibility foundation — **Implemented; independent review PASSED**

Implement the shared model, validation, targets, per-side metric thresholds,
explicit same-stone completion operations, plan snapshots/mapping, versioned
persistence, migration, cloud round-trip and safe metric selection for consumers.
Existing time-only UI remains functional. Do not expose new recording controls
before Stage B. Adapt legacy consumers only as needed for correct reading,
type-safety and preventing missing-time or mixed-unit calculations.

Acceptance evidence: legacy payload and digest preservation; idempotent migration;
all three configurations and partial Both stones survive the local, archive and
terminal-cloud round trips, plus CSV export — **there is no separate backup/restore
application path in this repository, so no backup round-trip coverage is claimed**;
correct inclusive/asymmetric classifications; invalid/future formats are not silently
rewritten; retries and ownership isolation are preserved.
Run focused and repository-wide verification. Stop for independent Codex review
before Stage B. This stage alone is not a user-ready m/s release.

**Evidence.** Regression coverage lives in `src/lib/measurement/__tests__/`
(tolerance, quantities, operations, compatibility, persistence, consumers, regression,
plan persistence, strict validation, asymmetric consistency),
`src/lib/accuracyToleranceProfiles/__tests__/unitSafeTemplates.test.ts` and
`src/components/__tests__/TrackerApp.trainingPlanProgression.test.tsx`. Exact suite
counts are deliberately not restated here — they go stale immediately and the
repository is the authority; run the verification commands below.

**What the first independent review found, and this pass corrected:** plan execution
silently dropped on reload for a valid speed-only step (and a session the cloud writer
accepted but could not read back); validation that filtered unknown shapes rather than
rejecting them, threw on a null entry, allowed an invalid speed plan to fall back to
executable Back-Hog / 3.75s time training, and let a stone with no real measurement and
a dangling block reference later acquire a fabricated zero time; tolerance snapshots
retained by reference, so editing the source changed an already-created block; a block
able to hold two disagreeing time targets; recording that accepted a foreign block id
and silently discarded supplied time provenance; a tolerance-template model still
symmetric and unitless; consumers that classified one stone as a Major Miss in history
aggregation and On Target in the progress series; and `is_major_miss=false` exported
for a stone with no time classification at all.

### B — Simplified setup, capture and results — **Implemented; independent review outstanding**

The approved UI across direct and planned Fixed Weight training, missing-measurement
completion on explicitly selected stones, metric-specific presentation and concise
help. Existing training forms and assessment behaviour are unchanged.

**What Stage B implements.**

- *Setup.* `TrainingSetup.tsx` follows the approved hierarchy: Training Mode →
  Measures (Fixed Weight only) → applicable targets and timing interval → one compact
  tolerance summary with a single **Adjust** action → Start Training. A new ordinary
  Fixed Weight setup still defaults to today's Time behaviour and still submits NO
  measurement configuration, so its block, stored bytes and cloud payload are
  unchanged. Speed hides the time target, the timing interval and the device controls
  and persists none of them. Block naming moved under **More Settings**.
- *Tolerances and templates.* `QuantityToleranceEditor.tsx` edits one quantity's bands,
  symmetric by default with an explicit per-side option, in that quantity's own unit.
  The app's built-in starting values and the athlete's saved templates appear in ONE
  list, with no "Custom" prerequisite — replacing the former Standard/Tight/Custom
  preset row and its nested picker. `AccuracyToleranceProfileForm.tsx` can now create
  and edit every template shape this app stores (seconds or m/s, symmetric or
  per-side); a saved template's QUANTITY stays immutable, which is the invariant that
  actually protects every copy already taken from it. Stage A's broader refusal to
  update a speed or asymmetric template is therefore lifted, in both the form and
  `handleUpdateAccuracyToleranceProfile`.
- *Plan steps.* `TrainingPlanStepEditor.tsx` now carries the measurement configuration
  in BOTH directions. Before Stage B it wrote neither on save nor on reopen, which
  silently turned a Speed step into ordinary time training.
- *Capture.* `ShotEntry.tsx` is measurement-aware: one compact area carrying the
  applicable targets, measurement fields, handle and shot type, and one primary
  **Save Shot** action.
  Both entry controls submit through one structured `AddShotInput`, so there remains
  exactly one handler that appends a stone. `handleAddShot` routes through Stage A's
  `buildMeasuredShot`. Speed parsing lives in `src/lib/measurement/speedInput.ts` and
  deliberately does NOT share `timeInput.ts`'s hundredths shorthand, so "240" is never
  rescaled to 2.40 m/s. A blank field means missing; a non-blank unparseable field
  blocks the save rather than being dropped.
- *Draft and submission ownership.* Both the manual-entry draft and the per-stone
  completion drafts are owned by `TrackerApp`, not by the entry controls. They
  therefore outlive the Train view (navigating away and back no longer empties them
  without a decision) and are bound to what they were typed for — the manual draft to
  a profile/session/block key, each completion draft to a session/block/shot/quantity
  key. The manual draft carries the WHOLE recording intent, measurements plus handle,
  shot type and any editable target, so a retained value cannot be recorded against
  the wrong handle after a remount. A draft whose owner no longer matches is not shown
  rather than being carried into the next exercise, and a confirmed discard clears
  exactly the drafts the dialog named.

  Each accepted submission is its own OPERATION, with an id, an owner and — when it
  came from the shared draft — the draft REVISION it was produced from. Revisions are
  monotonic and bumped by every athlete edit. That is what makes an acknowledgement
  clear only the revision it actually describes, lets two stones be in flight at once
  with independent statuses and retries, and makes a repeated press of the same
  unedited draft idempotent across a remount — a control-local guard could do none of
  these, because it is lost the moment the control unmounts. Two successive stones with
  identical values remain perfectly possible, because typing them is an edit.

  A caller that owns its own draft lifecycle — BlindShotEntry clears its draft the
  moment a stone is accepted — declares that by omitting `usesSharedDraft`, and its
  submissions carry no revision rather than a shared default. Borrowing one gave every
  Blind stone the same identity, so after one failed write the next legitimate stone
  was refused as a duplicate indefinitely.

  A draft's measurements and its metadata have separate lifecycles, and conflating them
  is what breaks concurrency. The REVISION identifies a submission; a separate RETAINED
  REVISION records which submission the measurement text now in the fields came from,
  and is absent while those fields hold input for the stone being composed. Choosing a
  handle is an edit, so it mints a new revision while saying nothing about the numbers
  already on screen — which is why "already submitted" cannot be derived from the
  revision alone.

  A NEW draft is seeded from the current expected handle and whatever target applies;
  nothing re-applies those afterwards, so no parent state is written during a child's
  render. An UNSUBMITTED draft is entirely the athlete's: a stone arriving from a device
  changes the plan's expected handle and may regenerate the target, but must not rewrite
  a draft already in progress. A SUBMITTED draft awaiting its write keeps its
  MEASUREMENTS on screen so a failure stays recoverable; until it is touched, everything
  describing the NEXT stone is seeded fresh, so a second stone started before the first
  write acknowledges follows the plan's progression instead of inheriting the recorded
  stone's handle.

  Choosing a handle, shot type or target for that next stone keeps both the selection
  and the retained values — a selection discards nothing a write has not acknowledged —
  and the values stay attributed to the stone they were submitted for. Entering a
  measurement then starts a new stone and clears whichever side the athlete did not
  touch, and Save Shot records nothing while every measurement in the fields is still
  retained, so that stone's own retry stays the only thing that saves it. Re-entering a
  measurement clears the retained marking, so two successive stones with identical
  values remain possible. Explicit overrides always win.
- *Missing measurements.* `MissingMeasurementPanel.tsx` lists the incomplete stones of
  the whole CURRENT training — every block, not only the active one. It and the
  durability/retry panel are rendered by every runner branch (Release Timing, Blind
  Weight and a curated Shotmaking/Technique exercise), so a stone left half-measured in
  an earlier step stays reachable after a mixed plan advances, without returning to
  that step or changing plan progress. Each row is identified by the exercise's POSITION in
  the training as well as its name, stone number, handle and what it already carries:
  block names default and repeat, so the sequence is what actually guarantees two rows
  can be told apart, without requiring the athlete to have named anything or showing
  them an identifier that means nothing at the rink. It completes ONE explicitly
  selected stone through `completeShotMeasurement`. The `CompletionRequest`
  carries the full session/block/shot/quantity identity the athlete selected, and
  execution validates that identity against current ownership instead of re-deriving
  the block from whichever one happens to be active. Archived sessions and
  already-recorded quantities stay outside the operation. The panel holds no draft
  state of its own and performs no parent update during render.
- *Durability, retry and scope.* Accepted is not saved. A recorded stone and a
  completion both stay visible and recoverable until a write that genuinely covers
  them is acknowledged; "Saved" and "Saving…" are distinct and truthful, and a failure
  keeps the value, its identity and a retry addressed to that one operation. Retry
  re-persists the CURRENT authoritative session rather than re-running the domain
  operation — the stone or measurement is already in it, so recording again would
  duplicate it, and re-running `completeShotMeasurement` would be rejected as
  `already_recorded`, a rejection that can never make the existing value durable. A
  write that does not cover the operation cannot acknowledge it, a thrown write is
  reported as a failure, and nothing blocks the shared capture queue while waiting.

  Outstanding operations and confirmations identify their originating session, block
  and stone, and are rendered only in that context. Reconciliation happens on every
  write, not only on archive: a write that SUCCEEDS and genuinely contains a failed
  operation's data resolves it, because that operation's own acknowledgement waiter was
  consumed by the earlier failure and nothing else would ever revisit it. That
  reconciliation runs the SAME settlement a direct acknowledgement runs — settling the
  matching draft, settling a covered completion's draft and selection, and
  recording a truthful acknowledgement. Dropping the failure row alone removed the very
  thing that stopped the retained values being recorded a second time, so pressing Save
  Shot again created a duplicate stone. A failure therefore disappears exactly when it
  stops being true, stays visible while the data is not durably covered, and never
  disturbs a newer draft revision. A successful archive reconciles the session it wrote
  the same way, so nothing outstanding is carried into the replacement training.
- *Entry reachability.* Which entry surfaces are shown follows the active block's own
  capabilities, not a selection left over from the previous exercise. Auto Capture is
  a time path, so a speed-only block always exposes manual entry.
- *Precision and validation.* Editable values are rendered losslessly
  (`editableNumber`), separately from display formatting, and always as plain decimals
  — never exponent notation, which the parsers that read those fields back reject. The
  contract is exact at both extremes: the expansion derives from `toExponential()`
  rather than `toFixed`, which caps at 20 fraction digits (collapsing a tiny tolerance
  to an invalid zero) and itself returns exponent notation at 1e21 and above.
  Reopening and re-saving a configuration or template cannot move a target or a
  tolerance, and a small valid value cannot round to zero. Entry and completion share
  one positive-finite rule, so a typed `0` is refused with an actionable message
  instead of looking valid until submission silently drops it; an execution-time
  rejection is surfaced rather than discarded with the returned outcome.
- *Results.* `MeasuredShotSummary.tsx` renders each measurement with its own unit,
  target, signed deviation and category, and an explicit "not recorded yet" where one
  is genuinely absent. `TargetAccuracyDashboardCards` takes an explicit `quantity` and
  is unit-correct throughout; the Back-Hog curling tendency is deliberately NOT derived
  from a speed bias. Live Performance offers a Time/Speed selection when a block
  records both and keeps separate denominators per quantity. The time-only charts are
  withheld from a speed view rather than relabelled. The collapsed Live Performance
  header no longer states a seconds figure for a block that records no time, and never
  denies stones that exist — a quantity with no recorded value yet is a separately
  worded fact. CSV export was already complete from Stage A and is unchanged.
- *History and Analyze selection.* `HistoryAnalysisFilters` distinguishes the measured
  QUANTITY from the timing INTERVAL, and the selected quantity governs the whole
  pipeline, not merely which blocks are included: the figures, their units, their
  targets, deviations, classifications, denominators and tolerance labels all follow
  it. Under a Speed selection the summary reports m/s from each block's own speed
  snapshot, no Back-Hog weight tendency is derived (this project has no approved speed
  mapping), and the time-only charts and handle comparison are withheld rather than
  relabelled. Every seconds-specific control — the timing interval, the Target Time
  range and the comparison-threshold override — is withheld in that view AND does not
  apply in it, so a stale value cannot silently remove a Both block's speed records and
  no control implies it reclassifies m/s. Their stored values are untouched, so
  returning to Time restores them exactly, and they continue to apply to Time analysis,
  preserving comparable-interval safeguards. The context line names only what actually
  governed the figures; where BOTH quantities are shown, its comparison and
  varying-threshold notices say so explicitly, because a seconds override describes the
  time results and never the speed ones.

  A measurement selection is offered whenever the history holds more than one quantity
  and is deliberately NOT auto-selected. The default "all measurements" view renders
  one summary group per quantity the selection actually contains, each with its own
  unit, tolerance snapshot and denominator — so a speed-only history reports its speed
  results without needing a selector that is not there, and no empty time figures are
  fabricated for training that measured no time. Expanded session results aggregate
  each quantity against each block's OWN tolerance snapshot, so blocks trained under
  different bands keep their results even though no single cutoff can be named.
  Seconds and m/s are never merged.
- *Finishing.* Direct training has an explicit **Finish Training** action beside the
  recording workflow, sharing the existing durable archive transition with planned
  training: every complete and partial stone is kept, an archive failure is visible and
  retryable, and a new training follows. Export and the no-summary "Start New Session"
  moved behind one Session Management disclosure. Session naming and notes moved under
  a disclosure alongside block naming.

**Evidence.** `src/components/__tests__/` —
`TrackerApp.speedCapture.test.tsx`, `TrackerApp.speedDraftSafety.test.tsx`,
`TrackerApp.speedScopeAndSelection.test.tsx`, `TrackerApp.speedHistory.test.tsx`,
`TrainingSetup.measurementSelection.test.tsx`,
`TrainingSetup.precisionAndShapes.test.tsx`,
`TrainingPlanStepEditor.measurementSelection.test.tsx`, the updated
`TrainingSetup.templateUnitSafety.test.tsx`,
`TrainingSetup.accuracyToleranceProfiles.test.tsx`,
`TrainingPlanStepEditor.accuracyToleranceProfiles.test.tsx` and
`AccuracyToleranceProfilesScreen.test.tsx`; plus
`src/lib/measurement/__tests__/deviceCaptureInteraction.test.ts`,
`tests/e2e/fixed-weight-speed.spec.ts` and the retained Stage A suites. Exact counts
are deliberately not restated — run the verification commands.

**Known limitations, carried deliberately.** Speed has no chart of its own yet, so a
speed view shows its figures without the trend, target-error and scatter charts time
has; those plot a release time against a time target and are withheld rather than
relabelled. Completion is scoped to the CURRENT training: an archived session is not
editable through it, which is the boundary between completing a missing measurement
and general historical editing.

Independent review is outstanding before any release or guarded commit preparation,
and no agent report is proof of correctness.

## Deferred work and release evidence

No general app redesign, automatic speed device integration, global history editing,
team expansion, new Shotmaking analytics, cloud scope expansion or native storage
cutover is included. Mid-block configuration editing is not introduced by this
feature; existing immutable block/plan snapshot rules continue to govern changes.

Real-device iOS/TCi acceptance must be reported separately from automated tests.
Repository scripts provide unit, E2E and mobile verification. The local Supabase
CLI is installed; Docker availability was not established in this specification
audit because sandbox access to its socket was denied. If SQL changes become
necessary, real local database execution is a required gate, not replaceable by
mock tests. No application verification suite was run for this documentation-only
specification task.
