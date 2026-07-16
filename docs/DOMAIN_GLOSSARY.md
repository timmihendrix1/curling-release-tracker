# Domain Glossary

## Purpose

This glossary defines the shared language of the Curling Performance Platform.

Every implementation, specification and architectural decision should use these terms consistently.

If multiple interpretations are possible, the definitions in this document take precedence.

The glossary describes domain concepts rather than implementation details.

---

# Organisation

## Athlete

A person whose performance is tracked by the platform.

An athlete owns training sessions, measurements, goals and performance history.

An athlete may belong to multiple teams over time.

---

## Coach

A person who supports one or more athletes.

A coach may review training sessions, provide feedback and assign training.

A coach does not own athlete data.

---

## Team

A group of athletes participating together.

Teams exist independently of individual training history.

An athlete may belong to different teams throughout their career.

---

# Training

## Training Plan

A structured programme consisting of one or more training sessions.

Training plans define what should be trained over time.

---

## Training Session

A single training event.

A session groups all activities performed during one practice.

Examples:

- Solo release training

- Team practice

- League training

- National squad session

A session contains one or more Training Blocks.

---

## Training Block

A logically connected group of shots with a shared objective.

Examples:

- Draw practice

- Takeout practice

- Fixed weight

- Variable weight

- Blind weight

A block provides context for its shots.

Changing the objective creates a new block rather than modifying the existing one.

---

## Drill

A reusable exercise or practice format.

A drill describes *how* something should be trained.

A Training Block may reference a Drill.

Examples:

- Draw ladder

- Hit &amp; Roll

- Guard practice

- Weight consistency drill

---

# Shot

## Shot

The fundamental unit of performance within the platform.

A Shot represents one executed stone delivery.

Most performance information should ultimately relate to individual shots.

A Shot may contain:

- intention

- measurements

- athlete perception

- outcome

- feedback

---

## Shot Intention

Describes what the athlete intended to execute before delivering the stone.

Examples:

- Shot type

- Handle

- Target weight

- Target rotation

- Tactical objective

The intention exists independently from the execution.

---

## Shot Outcome

Describes what actually happened.

Examples:

- Successful draw

- Heavy

- Light

- Narrow

- Wide

- Hit and roll

- Missed shot

Outcome should not be confused with measurements.

---

# Measurements

## Measurement

An objective or subjective observation associated with a shot, session or athlete.

Measurements always describe one specific property.

Examples:

- Release time

- Rotation

- Heart rate

- Estimated release time

Measurements should remain independent from the device that produced them.

---

## Measurement Type

Defines *what* was measured.

Examples:

- Release Time

- Rotation Count

- Hog-to-Hog Time

- Line Deviation

- Heart Rate

Measurement types remain stable even if hardware changes.

---

## Measurement Source

Describes where a measurement originated.

Examples:

- Manual Entry

- Brower Timing

- Stone Sensor

- Apple Health

- Video Analysis

Sources describe origin—not meaning.

---

## Device

A physical or virtual system capable of producing measurements.

Examples:

- Timing gate

- Stone sensor

- Smartphone

- Smartwatch

A Device may produce multiple Measurement Types.

---

# Targets

## Target

The desired value or objective for a shot.

Examples:

- Target release time

- Target rotation

- Target line

Targets represent intention.

They are not measurements.

---

## Baseline

A reference value used for comparison.

Examples:

- Personal average

- Season average

- Competition average

- Team average

Baselines support analysis but are not goals.

Distinct from a future **Baseline Assessment** (see "Assessment" below) — an optional
assessment type used to establish this kind of reference value, not the reference value
itself.

---

# Feedback

## Athlete Feedback

Information entered by the athlete after a shot.

Examples:

- Estimated release time

- Confidence

- Subjective comments

Athlete Feedback represents perception.

It should remain separate from objective measurements.

---

## Coach Feedback

Observations made by a coach.

Examples:

- Technical comments

- Tactical suggestions

- Training recommendations

Coach Feedback complements objective measurements.

---

# Analytics

## Metric

A calculated value derived from one or more measurements.

Examples:

- Average release time

- Standard deviation

- Mean absolute deviation

- Consistency score

Metrics are derived.

They are never directly measured.

---

## Insight

An interpretation generated from metrics.

Examples:

- Out-turn is more consistent than in-turn.

- Release times become slower under fatigue.

- Blind estimation improves over time.

Insights support decision making.

---

# Context

## Training Context

Additional information that helps explain performance.

Examples:

- Ice conditions

- Competition

- Fatigue

- Equipment

- Training objective

- Playing position

Context should not be confused with measurements.

---

## Session Context

Information affecting an entire training session.

Examples:

- Location

- Date

- Coach

- Team

- Ice sheet

---

# Assessment

**[Domain/persistence (Phase A), the Release Time Core Assessment v1 execution flow
(Phase B), and Results/Analyze integration (Phase C) are all implemented — see
`docs/adr/0010-assessment-domain-foundation.md` and
`docs/adr/0011-assessment-capture-ownership-and-app-shell-integration.md`.]** These
terms are defined in full by `docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md`, the
authoritative source for Assessment product and domain rules. This section gives short,
glossary-level definitions only — see that document for execution, comparison and
versioning rules, and `docs/SYSTEM_ARCHITECTURE.md`'s "Assessments" section for the
current implementation snapshot (`src/lib/assessment/`, `AssessScreen.tsx`,
`AssessmentResultScreen.tsx`, `AssessmentAnalyze.tsx`). Not yet implemented:
benchmarking, a synthetic overall score, athlete-level classification, a Custom
Assessment editor, coach/team workflows.

## Assessment

A standardised performance measurement executed under a defined protocol.

An Assessment is **not** a Training Session: it exists to measure current performance
under consistent conditions, not to freely improve it. See "Training Session" above —
the two are deliberately distinct concepts and must not be conflated or modeled as one
another, even though an Assessment Run may reuse Training/Timing infrastructure.

## Assessment Template

A versioned definition of an Assessment protocol (blocks, targets, handles, validity and
scoring rules). Immutable after publication — a semantic change requires a new version,
never a silent edit to an existing one.

## Official Assessment

A fixed, platform- or organisation-controlled Assessment Template, not editable by the
athlete. `Official` describes control and versioning — it does not by itself imply
endorsement by a federation (e.g. Swiss Curling) unless that endorsement genuinely
exists.

## Custom Assessment

A configurable Assessment Template (blocks, targets, handles, rules), potentially
authored by an athlete, coach, team or organisation in the future. A modified Official
Assessment becomes a separate Custom Assessment with its own comparison identity.

## Assessment Block Definition

The definition of one part of an Assessment Template's protocol (e.g. "Slow
Reproduction") — the Assessment-domain counterpart to a Training Block, but part of an
immutable template rather than a mutable, athlete-configured block.

## Planned Assessment Shot

The prescribed target (time, handle) a specific position in an Assessment Run is
supposed to execute, as defined by the template — distinct from a Training Block's
`pendingTargetTime`, which is athlete/session-specific and mutable.

## Assessment Attempt

One physical execution of a Planned Assessment Shot. A planned shot may have multiple
technically invalid attempts, but only one valid, scored attempt.

## Assessment Run

One athlete's execution of one Assessment Template version — the Assessment-domain
counterpart to a Training Session, but with a fixed sequence, a stable template-version
reference, and stricter immutability once completed.

## Assessment Result

The derived evaluation of a completed (or incomplete) Assessment Run. **[Implemented as a
derived view, not a persisted type]** — `src/lib/assessment/result.ts`'s
`AssessmentResultView` (and the block/target/handle/Variable-Adaptation breakdowns it
composes) is always computed on demand from a run's `attempts` plus an explicitly chosen
Threshold Set; there is no `AssessmentResult` record in `AssessmentPersistedState`. This
matches ADR-0010's Decision 4 (raw data stays the sole persisted source; the derivation
functions are cheap and pure enough to recompute every time). `AssessmentResultScreen.tsx`
renders this view; `AssessmentAnalyze.tsx` is where completed/incomplete Assessment Runs
are browsed under Analyze.

## Invalid Attempt

A technically or objectively invalid Assessment Attempt (e.g. a timing gate failure),
excluded from scored metrics and repeatable within a documented limit.

## Protocol Deviation

A recorded, transparent deviation from the prescribed execution of an Assessment Run
(e.g. the wrong handle was used) that does not invalidate the attempt but must be
disclosed.

## Comparison Eligibility

The rules determining whether two Assessment Runs may be directly compared (same
template, version, measurement mode, and sequence, among others). **[Implemented]** —
`checkProtocolComparisonEligibility`/`checkCategoryComparisonEligibility`
(`src/lib/assessment/comparison.ts`) implement the rule; `src/lib/assessment/result.ts`'s
`compareAssessmentRuns` and `AssessmentComparisonEligibilityNotice.tsx` surface it in the
UI, mapping every `ComparisonIneligibilityReason` to plain-language copy rather than a
raw enum value. Different original Run Threshold Sets never make two runs
protocol-ineligible; a shared Comparison Threshold Set (see "Comparison Threshold" below)
is still required for any category-based comparison.

## Comparison Threshold

The Threshold Set currently applied when analyzing one or more Assessment Runs —
Original (single-run only), Standard, Tight, or Custom. Distinct from a Run's own,
immutable Run Threshold Snapshot: changing the Comparison Threshold recalculates
threshold-dependent category metrics on screen only, never the stored run. When
comparing multiple runs, one shared Comparison Threshold Set must be applied to all of
them for their category metrics to be comparable. **[Implemented]** — see
`AssessmentThresholdControl.tsx` and `resolveAnalysisThresholdSet` in
`src/lib/assessment/result.ts`; the selection is local UI/preference state, never
persisted onto the Assessment Run.

## Release Time Core Assessment v1

The proposed first standardised Assessment: Backline–Hog measurement, Draw shot type,
targets of 3.50s / 3.75s / 4.00s, 32 scored stones across four blocks, 6 warm-up stones.
Proposed, not yet externally validated — see
`docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md` for the full protocol and open
validation questions. Do not restate or vary these numbers elsewhere in the
documentation; treat the specification as the single source for them.

---

# Integrations

## Integration

A connection between the platform and an external system.

Examples:

- Brower Timing

- Apple Health

- WHOOP

- Garmin

Integrations provide data.

They do not define the domain model.

---

## Provider

A software component responsible for communicating with an external system.

Examples:

- Manual Input Provider

- Brower Provider

- CSV Import Provider

Providers translate external information into domain concepts.

---

# General principles

## Domain before implementation

Domain concepts should exist independently from technical implementation.

Technology may change.

The domain language should remain stable.

---

## Domain before manufacturers

Manufacturers are integrations.

The domain model should describe curling—not hardware.

---

## One concept, one meaning

Each domain concept should have exactly one meaning.

Avoid introducing synonyms that describe the same concept.

For example:

Use:

- Training Session

Do not introduce:

- Practice

- Workout

- Event

- Session Record

unless they describe genuinely different concepts.

---

## Prefer explicit terminology

If a concept is ambiguous, choose the more explicit name.

Clarity is preferred over brevity.

---

## Evolving glossary

The glossary should evolve together with the product.

New concepts should only be added when they become part of the domain.

Existing definitions should rarely change, as they form the shared language of the platform.

---

# Current Implementation Terms (Curling Release Tracker MVP)

The sections above define the long-term Curling Performance Platform vocabulary. The
terms below are how those concepts (and a few MVP-specific additions) are actually
named in the current code (`src/types/index.ts` and `src/lib/`). **[Implemented]**
unless marked otherwise. Where a term below refines an existing entry above rather than
introducing a new concept, it says so explicitly — this is not a competing vocabulary.

## Session

*Refines: Training Session (above).* The code's `Session` type **is** a Training
Session — same concept, shorter code name. Exactly one exists at a time (`currentSession`);
finished ones move into a `Session[]` history list. Contains `blocks` and a flat `shots`
list (shots reference their block by id, not nested inside it).

## Training Block

*Refines: Training Block (above), same concept.* Implemented as `TrainingBlock` with a
`mode` (Fixed / Variable / Blind — see below), a `measurementMode`, and — for Variable
and Blind — a Target Source. Ending a block never edits it; a new block is created and
the old one is stamped `completedAt`.

## Active Block

The one `TrainingBlock` in the current session currently receiving shots
(`session.activeBlockId`). An empty `activeBlockId` (`""`) means the session has no
configured block yet — the Setup screen, not an error state.

## Shot

*Refines: Shot (above).* One recorded stone delivery: `releaseTime`, `targetTime`,
optionally `predictedTime` and `shotType`, always a `handle` and a `blockId`. See
"Target Time", "Predicted Time", "Shot Type" below for the fields most often confused
with each other.

## Fixed Weight

A Training Block mode with one constant target for every shot
(`mode: "fixed"`, or `mode: "blind"` with `blindTargetMode: "fixed"`).

## Variable Weight

A Training Block mode (`mode: "variable"`) whose target changes shot to shot, via one
of two Target Sources: Smart Random or Coach / Manual. No Shot Type is required to
generate a target, though the UI still offers one.

## Blind Weight

A Training Block mode (`mode: "blind"`) that trains perceiving one's own release time.
Adds a locked Prediction and a Review step before a shot is saved (see "Blind Shot
Draft"). Supports all three Target Sources, including Fixed — uniquely among the modes.

## Target Time

The value a shot is judged against. Two distinct things share this name and must not be
confused:

- **`shot.targetTime`** — the immutable, actually-used target for *that specific shot*,
  set once at save time and never changed afterwards.
- **`block.targetTime`** — see "Default Target" below; a block-level configuration
  value, not what any individual shot was judged against.

## Default Target

`block.targetTime`. The constant target for Fixed Weight / Blind+Fixed, or the seed
value used to create a block's first Pending Target for Manual mode. Not itself a shot
target — see "Target Time".

## Pending Target

`block.pendingTargetTime`. The target that will be used for the *next* shot in a Smart
Random or Manual block. Persisted, survives reload, only changes after a shot is saved
(never speculatively, never on every render).

## Release Time

`shot.releaseTime`. The measured time, in seconds, from the release-related event
defined by the block's Measurement Mode to the corresponding hog line. Always present.

## Predicted Time

`shot.predictedTime`. The player's own subjective guess at their release time, locked in
**before** the Release Time is known. Present only on Blind Weight shots; `undefined`
for Fixed/Variable Weight and never invented by migration.

## Prediction Error

`predictedTime - releaseTime` (`src/lib/blindWeight.ts`'s `predictionError`, and
`src/lib/analytics.ts`'s `predictionErrors`/`meanPredictionError`). Positive: the player
believed they were slower than they actually were. Negative: believed faster. Blind
Weight only — see "Analytics" in `SYSTEM_ARCHITECTURE.md` for why correlation must never
be read alone.

## Target Error

`releaseTime - targetTime` (`src/lib/blindWeight.ts`'s `targetError`, and
`src/lib/analytics.ts`'s deviation-from-target family). Applies to every shot in every
training mode, not just Blind Weight.

## Bias

The signed mean of Target Error (`meanTargetError` /
`averageDeviationFromTarget`) — a systematic tendency to run long or short, fast or
slow. Always kept distinct from **Average (Absolute) Error** (magnitude only,
`meanAbsoluteTargetError`) — a player can have a large average error with zero bias
(equally-sized misses in both directions) or a small average error with a large bias
(consistently, slightly off in one direction). Never conflate the two in code, UI, or
documentation.

## Accuracy Thresholds

*[Implemented, see ADR-0008]* `{ onTarget: number; acceptable: number }`
(`src/lib/accuracyThresholds.ts`, `TrainingBlock.accuracyThresholds`) — a personal,
editable Target Accuracy tolerance, snapshotted once per Training Block at creation and
never re-derived from the app's current default afterward. Two presets exist,
**Standard** (0.10s / 0.20s) and **Tight** (0.05s / 0.10s), plus **Custom**; these are
recommendations, not validated sporting standards (same posture as Smart Random's
ranges — see "No fabricated precision" in `PRODUCT_DIRECTION_AND_PRINCIPLES.md`).
Unrelated to Blind Weight's Prediction Accuracy, which has no threshold concept.

## On Target / Acceptable / Major Miss

The three mutually exclusive Target Accuracy categories a shot's absolute Target Error
falls into, judged against a block's Accuracy Thresholds
(`categorizeTargetError` in `src/lib/accuracyThresholds.ts`):

- **On Target** — `absoluteTargetError <= onTarget`
- **Acceptable** — `onTarget < absoluteTargetError <= acceptable`
- **Major Miss** — `absoluteTargetError > acceptable`

**Major Miss is a fachlicher/coaching concept, not a statistical one** — see
"Statistical Outlier" below. The two must never be labeled, colored, or exported as one
another.

## Statistical Outlier

A value falling outside a dataset's boxplot whiskers (below `Q1 - 1.5*IQR` or above
`Q3 + 1.5*IQR`, `src/lib/boxPlotStatistics.ts`). A property of *this specific sample's*
spread — the same shot could be a statistical outlier in one dataset and not in
another, depending on what else is in the sample. Deliberately distinct from **Major
Miss** (a fixed personal tolerance judgement, independent of any other shot in the
dataset). Never exported, colored, or narrated as a Major Miss, and vice versa.

## Target Accuracy

The general lens of "how close did this shot land to its own recorded `targetTime`" —
Bias, Average (Absolute) Error, Target Error Standard Deviation, On Target/Acceptable/
Major Miss rates, Largest Miss (`TargetAccuracyAnalytics` in `src/lib/analytics.ts`).
Applies to every training mode, including Blind Weight, where it is a second,
independent lens alongside — never merged with — Prediction Accuracy (see "Prediction
Error" above).

## Measurement Mode

*Refines: Measurement Type (above), narrowed to this MVP's one measurement.* What the
Release Time physically measures: Back-Hog or Hog-Hog. A property of the Training
Block, independent of training mode and Target Source.

## Back-Hog

A Measurement Mode. The only one with a validated Smart Random range today. Supports
every training mode and Target Source.

## Hog-Hog

A Measurement Mode. Smart Random is **[Open decision]** — deliberately unavailable,
since no validated Hog-Hog target range exists in this project. Fixed and Coach/Manual
remain fully usable. Never derives its numbers from Back-Hog.

## Smart Random

A Target Source (`variableTargetMode`/`blindTargetMode: "smart-random"`). Automatically
generates the next target within a per-block configured range (`smartRandomMin`/`max`,
0.05s steps), favoring realistic transitions with occasional larger jumps. See
`SYSTEM_ARCHITECTURE.md`'s Target Model for the exact constants.

## Coach / Manual

A Target Source (`variableTargetMode`/`blindTargetMode: "manual"`). A human enters the
next target before each shot; the last-used value stays as an editable starting point.

## Target Source

*New concept introduced by Variable/Blind Weight — not a synonym for Training Mode or
Measurement Mode.* How the next target is determined: Fixed (Blind Weight only), Smart
Random, or Coach / Manual.

## Handle

`shot.handle`: `"in"` or `"out"`. Required for every shot in every training mode,
including Blind Weight.

## Shot Type

*Refines: part of Shot Intention (above).* `shot.shotType`: `"draw"` or `"takeout"`,
**optional**. Effectively required for Fixed/Variable Weight (the UI always sets one);
genuinely absent for Blind Weight. Never used to generate a target.

## Unclassified Shot

A shot with no `shotType` — normal and expected for Blind Weight, not an error or a
migration artifact. Filters treat it correctly: the "All" view includes it, the
explicit Draw/Takeout filters correctly exclude it (an unclassified shot is neither).

## Blind Shot Draft

The in-progress state of a Blind Weight entry (`BlindShotDraft`: `phase`,
`predictedTime?`, `releaseTime?`) before it is saved. **Not a Shot.** Never appears in
analytics, History, charts, or CSV export. Not guaranteed to survive a reload — see
"Blind Weight State Machine" in `SYSTEM_ARCHITECTURE.md`.

## Review

The third Blind Weight phase (`BlindShotDraft.phase === "review"`), where Target,
Prediction, Actual, Prediction Error, and Target Error are all shown together before
saving. **This is the term the code actually uses — not "Reveal".** "Reveal" would
suggest the app already had the real time and was uncovering it; that's not what
happens. The player reads the external timing system and *enters* the value themselves,
after locking their prediction — "Review" describes what follows correctly. This
glossary entry exists specifically to settle that question: use "Review", not "Reveal",
in any future documentation or UI copy.

## History

The `Session[]` list of completed sessions, kept in a separate `localStorage` key from
the current session. Append-only aside from explicit per-entry or clear-all deletion.
**Analyze** (see below) is the visible screen name for the view onto this data — "History"
remains the correct term for the data concept itself (types, storage key, function names
like `migrateSessionHistory`); the two are not the same thing and this rename was
deliberately UI-only. See `docs/PLATFORM_NAVIGATION_AND_HOME_EXPERIENCE.md`.

## Migration

`sessionMigration.ts`'s `migrateSession`/`migrateSessionHistory`, run unconditionally on
every load. Normalizes old or partial JSON into a valid, current-shape `Session` without
ever rewriting an already-recorded shot value. Must be idempotent. See
`SYSTEM_ARCHITECTURE.md` for the full set of migration rules and the `blocks: []`
invariant.

## External Release-Time Source

**[Prepared, not implemented.]** `ReleaseTimeSource` (a type alias of `TimingProviderType`
— see below) and `setMeasuredReleaseTime(draft, releaseTime, source)` name the boundary a
future timing device would use, without any device, protocol, or hardware assumption
existing yet. See `docs/EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md`.

## Timing Provider

*Refines: Provider (above).* `TimingProvider` (`src/lib/timingProvider.ts`): the small
contract (`type`, `start`, `stop`, `subscribe`) every timing source implements — the
Simulator, manual entry, and (later) real hardware. **[Implemented]** for Simulator and
Manual; **[Planned]** for real hardware (`"external"`).

## Timing Result

*Refines: Measurement (above), the normalized wire shape.* `TimingResult`: a
provider-agnostic reading (`id`, `receivedAt`, `source`, `measurements`, optional
`deviceId`/`laneId`). The one shape every `TimingProvider` produces — nothing downstream
(Capture Sequence processing, shot saving, analytics, export) knows or needs to know
which provider produced a given result. **[Implemented]**

## Timing Measurement

A single measured value inside a Timing Result, tagged with which Measurement Mode it
belongs to (`measurementMode`, `value`). A Timing Result may carry more than one (e.g. a
future device reporting Back-Hog and Hog-Hog at once); only the one matching the active
Training Block's Measurement Mode is ever used. **[Implemented]**

## Capture Sequence

An expected-shot-count-bounded stretch of automatic (or manual-fallback) shot capture,
scoped to exactly one Training Block. At most one exists per Session at a time
(`session.captureSequence`). Not available for Blind Weight blocks — see ADR-0006 and
`SYSTEM_ARCHITECTURE.md`'s "Capture Sequences" section. **[Implemented]** for Fixed and
Variable Weight.

## Capture Handle Mode

How the Handle for each shot in a Capture Sequence is determined without a tap between
shots: `"manual"` (live UI toggle), `"fixed-in"`, `"fixed-out"`, or `"alternate"`
(flips every shot). Deterministic from `capturedShotCount` alone for the three
non-manual modes — nothing extra needs to be stored or reconstructed for Undo.
**[Implemented]**

## Capture Step Record

Per-captured-shot reversal context (`resultId`, `shotId`, `targetTime`,
`previousPendingTargetTime`, `handle`) — the only state Undo needs to exactly restore a
Capture Sequence to how it was before its most recently captured shot, without
reconstructing anything (no new Smart Random draw, no re-derived handle history).
**[Implemented]**

## Measurement Source

*Refines: Measurement Source (above), narrowed to this MVP's implementation.*
`shot.measurementSource` (a `TimingProviderType`): which kind of provider supplied this
specific shot's value — `undefined` for every shot entered through the classic manual
flows (ShotEntry/BlindShotEntry, outside any Capture Sequence); `"manual"` for a manual
fallback reading supplied *within* an active Capture Sequence; `"simulator"` for the
development-only Timing Simulator; `"external"` reserved for real hardware, not yet
implemented. Never fabricated by migration. **[Implemented]**

## Training Category

*UI-facing name for `BlockMode` (above) — not a new or competing concept.* The History
filter UI and `src/lib/historyAnalysis.ts` say "Training Category" where the code type
is `BlockMode`; `TrainingCategory` is a plain type alias, not a rename of the domain
model. Always one of Fixed Weight / Variable Weight / Blind Weight. Progress and Shot
Quality are always computed per comparable Training Block *within* one selected
Training Category — different categories are never merged into one figure.
**[Implemented]**

## History Analysis Filters

The central, shared filter selection for the History view (`HistoryAnalysisFilters` in
`src/lib/historyAnalysis.ts`): Training Category, Measurement Mode, Date Range, Handle,
Shot Type, Session, Block, Target Range, and Threshold Comparison Mode. Every History
analytics surface — Key Progress Summary, Progress, Shot Quality, the Scatterplot,
Handle Analysis, and the Blocks/Sessions list — reads from the one
`HistoryAnalysisContext` this selection produces; no surface filters independently. See
`SYSTEM_ARCHITECTURE.md`'s "History Analytics and Filtering". **[Implemented]**

## Threshold Comparison Mode

*New concept, distinct from Accuracy Thresholds (above), which it never mutates.* How
History analytics classify On Target/Acceptable/Major Miss for the current selection:

- **Original** — each Training Block is judged against its own persisted Accuracy
  Thresholds snapshot (ADR-0008): "how well did I perform against the standard used in
  that training?"
- **Comparison** — every selected shot is temporarily re-classified with one shared
  Accuracy Thresholds value (a Standard/Tight preset, or Custom): "how do all selected
  trainings compare under one consistent standard?"

Switching modes never rewrites a `TrainingBlock`'s or `Shot`'s persisted values — only
which thresholds *this render's* History analytics use to categorize them.
**[Implemented]**

## Home / Train / Assess / Analyze / Settings

The five visible top-level navigation sections (`ActiveView` in `src/lib/navigation.ts`).
UI/screen names, not new domain concepts layered on top of the ones above:

- **Home** — "what is relevant today"; composes a plain greeting, Today's Plan (incl. a
  contextual "Resume Assessment" action when an active Assessment Run exists), Training
  Overview (an honestly-scoped rename of "Performance Snapshot", with a secondary "View
  Analyze" action — there is no separate Quick Access section), Devices, and a grouped
  "Coming next" preview of Schedule/Coach/Team. Never an analytics dashboard.
- **Train** — the former "Current Session" view (Setup, active Training Block, Shot
  Entry, Auto Capture, current-session analytics) under a new name; no behavior change.
- **Assess** — the Release Time Core Assessment v1 execution flow (`AssessScreen.tsx`,
  Phase B): Landing, Overview, Guided Introduction, Threshold/Setup, Warm-up, Scored
  Execution, Pause/Resume/Abandon, Completion Summary. The Completion Summary's "View
  Full Results" action (Phase C) opens `AssessmentResultScreen.tsx`. See **Assessment**
  above and `docs/adr/0011`.
- **Analyze** — the visible name for the History view (see **History** above); the
  underlying Training data/filter concepts are unchanged. Also hosts a separate
  Assessments tab (Phase C, `AssessmentAnalyze.tsx`) — Training and Assessment analytics
  are distinct domain concepts sharing this one destination; switching tabs never resets
  the other tab's state.
- **Settings** — app-wide Data Management (Export History CSV, Clear History) and About.
  Session-specific settings (title/notes, fixed-target adjustment) stay in Train.

**[Implemented — Home/Train/Assess/Analyze/Settings]** See `docs/adr/0009` (navigation
model), `docs/adr/0011` (Assess-specific capture-ownership/navigation-guard/persistence
integration), and `docs/PLATFORM_NAVIGATION_AND_HOME_EXPERIENCE.md`.