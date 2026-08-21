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

**Distinct from the Team Function of the same name.** Team Foundation's `coach`
contextual function (see **Team Function** below) is only a label a Team Admin may
assign to a member — it grants no access to that member's training data by itself. The
data-access relationship described in this entry is the separate, not-yet-built
Coaching capability referenced in
`docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md`'s Coaching model section
(`TeamDataSharingGrant`, a granted data scope) — see `docs/adr/0022`'s Non-goals. The
grant is athlete-to-**Team**, not athlete-to-coach: an athlete shares a chosen data
scope with a Team once, and whoever currently holds that Team's `coach` function may
use it — never a separate acceptance negotiated with each individually named coach. Do
not assume holding the `coach` function implies this grant exists.

---

## Team

**[Implemented — Team Foundation beta, `docs/adr/0022`]** One Team Workspace — a named,
cloud-persisted group with its own membership, invitations, and administration,
independent of any one person's local training history. See **Profile**, **Team
Membership**, **Team Function**, **Team Invitation**, and **Team Admin Request** below
for the concepts a Team is actually built from, and
`docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md`'s Team Workspace/Team Seat
sections for the product- and billing-level model (a **Team Seat** is one active Team
Membership *in a Team whose status is `active`*, regardless of which functions it
holds — not a separate domain concept from Team Membership, only its billing-relevant
count. A pending invitation, an ended Membership, and an active Membership in an
`archived` Team all consume zero Team Seats — see
`docs/TEAM_FOUNDATION_AND_ADMINISTRATION_BETA_SPECIFICATION.md` §14).

An athlete may belong to different teams over time; a former membership's history is
preserved, never deleted, when it ends (see **Team Membership**).

A Team never shares training/performance data with other members — a Team Workspace
carries identity, function, and (Team Admin-only) member email, and nothing else.

---

## Profile

**[Implemented — Team Foundation beta, `docs/adr/0022` Decision 1]** The stable,
app-owned identity a Team Foundation record actually points to — never the same value as
a Supabase Auth account id, and linked to exactly one such account, in both directions,
for that account's lifetime. Carries a `displayName` (shown to teammates) and nothing
else — never an email address, which is reachable only through the narrow, Team-Admin-
gated path described under **Team Membership**.

Distinct from **Athlete**: a Profile is Team Foundation's bare identity record: an
Athlete is the separate, pre-existing training-data-owning concept above. A Profile does
not by itself grant or imply Athlete capability.

---

## Team Membership

**[Implemented — Team Foundation beta, `docs/adr/0022`]** One Profile's period of
belonging to one Team — `active` or `ended` (`left` or `removed`), with an independent
`participationAsPlayer` flag alongside whatever **Team Function**s are currently
assigned to it. A Profile has at most one *active* Membership per Team; rejoining after
leaving creates a new Membership period, never reuses the old one. An ended Membership's
history is always preserved, never deleted.

Member email is visible only to a Team Admin of that same Team, through one narrow,
server-enforced path — never a generally browsable field on a Membership or roster
entry.

---

## Team Function

**[Implemented — Team Foundation beta, `docs/adr/0022` Decision 2]** A composable,
time-bounded, audited capability attached to one Team Membership: `team_admin`,
`coach`, or `training_lead`. A Membership may hold several at once (e.g. a player who is
also `training_lead`). There is no Team Captain function — see `docs/adr/0022` for why.

`team_admin` grants real administrative power over the Team (invitations, membership,
other members' functions, member email visibility). It reaches an **already-active**
member only through a **Team Admin Request** the member themselves accepts — never a
direct peer-assignment by another admin. A **new invitee**, by contrast, may be proposed
`team_admin` as part of their complete invitation and receive it the moment they accept
that invitation — accepting the invitation is itself the acceptance step for a brand-new
member, so this is not a second exception to "never direct," it is the other of the two
distinct paths to `team_admin` (see **Team Admin Request** and `docs/adr/0022` Decision
2). `coach` and `training_lead` are directly assignable by any Team Admin on an
already-active member, take effect immediately, and grant no administrative power —
`coach` in particular grants no data access (see the **Coach** entry above); both may
also be freely proposed on a fresh invitation, exactly like `team_admin`.

---

## Team Invitation

**[Implemented — Team Foundation beta, `docs/adr/0022` Decision 5]** A Team Admin's
proposal for one email address to join a Team with a specific participation/function
proposal, delivered as an emailed one-time link. `pending`, `accepted`, `expired`,
`revoked`, or `replaced` — revising or resending an Invitation always replaces it with a
fresh one (a new secret, a new 14-day expiry) rather than mutating the original in
place.

---

## Team Admin Request

**[Implemented — Team Foundation beta, `docs/adr/0022` Decision 4]** A Team Admin's
proposal to promote one *existing, active* Team Membership to hold the `team_admin`
Team Function — never a direct assignment. Requires the nominee's own explicit
acceptance. Mirrors **Team Invitation**'s lifecycle (`pending`/`accepted`/`expired`/
`revoked`/`replaced`) but carries no secret token, since it targets an already-
authenticated member rather than an arbitrary email address.

---

# Training

## Training Plan

**[Implemented — Version 1]** A reusable, ordered configuration of Plan Steps — not
training data. See `docs/TRAINING_SYSTEM_AND_PLANS.md` (the authoritative product/
domain specification) and `docs/adr/0012-training-plans-domain-and-execution-model.md`.

Starting a Training Plan creates one Training Session, in which each Plan Step becomes
one preconfigured Training Block (`src/lib/trainingPlans/`, `TrainingPlan` in
`src/types/index.ts`). Editing or deleting a Training Plan never changes a Session
already started or completed from it — an execution holds its own deep-copied
snapshot of the plan's steps, never a live reference back to the saved plan.

Persisted independently of `currentSession`/`sessionHistory`, under its own
`localStorage` key. Not a calendar, coaching engine, or seasonal planning system in
Version 1.

---

## Training Plan Step / Release Timing Plan Step

**[Implemented — Version 1]** One ordered unit inside a Training Plan
(`TrainingPlanStep`, currently an alias of `ReleaseTimingPlanStep` — the only step type
Version 1 implements, kept as its own discriminated type so a future step type, e.g. a
Rotation or Assessment Plan Step, can be added without redefining this one). Configures
a future Training Block's mode, measurement mode, target configuration, Number of
Stones (`ShotCountCompletion`), and Handle Strategy. A Plan Step is a template; the
Training Block created from it (via `mapPlanStepToTrainingBlockInput`) is a runtime
entity with its own generated id — the Plan Step's own id is never reused as the
Block's id.

---

## Handle Strategy

**[Implemented — Version 1]** How a Plan Step expects Handle to behave across its
shots: Free (no preselect — today's classic manual-entry behavior), Fixed (In or Out),
or Alternating (starting In or Out). Preselects the expected handle for the next shot
but never locks it — the athlete may always override for one shot, and the shot
actually saved always records the handle actually used, never the planned one. See
`resolveExpectedHandle` (`src/lib/trainingPlans/handleStrategy.ts`), which uses the
same shots-saved-parity logic as `captureSequence.ts`'s Capture Sequence alternation.

---

## Plan Execution

**[Implemented — Version 1]** `Session.planExecution` — attached only to a Session
started from a Training Plan; absent from every Quick Start session. Holds a deep
copy of each Plan Step taken at start time (`PlanExecutionStepSnapshot`) plus which
step is active and which steps' Training Blocks have been created so far (Training
Blocks are created lazily, one at a time, as each step is reached — never all upfront).
Step completion, and plan completion, are always derived from the active step's block's
actual saved shots (`isActiveStepComplete`/`isPlanComplete`,
`src/lib/trainingPlans/progress.ts`) — never a separately stored/cached flag.

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

## Assessment Draft

**[Target — `docs/adr/0021-assessment-draft-history-authority-unit-split.md`, Accepted,
design complete, not yet implemented.]** The persistence domain owning **the current
Assessment Run** — not only an active/in-progress one. This includes a **terminal** run
that has completed or been marked incomplete but is still retained here, pending durable
archive: `assessmentDraft` continues to own it until its exact content has been durably
confirmed inserted into Assessment History and the draft has been safely cleared (see
ADR-0021 Decision 14). Permanently device-local throughout — unlike Assessment History
(below), no future ADR may make this domain cloud-eligible, and a terminal run temporarily
retained here does **not** become cloud-eligible merely by existing in this domain; only
its eventual copy in Assessment History can ever become cloud-authoritative. A draft is
exactly the kind of frequently-mutated, in-progress (or briefly pending-archive) entity the
"Session" domain's own `currentSessionDraft` precedent already establishes must stay local.
Not the same concept as a "Blind Shot Draft" (above) — that is a Training-domain, per-shot
entry state; this is an Assessment-domain, per-run persistence-authority unit. Distinct
from Assessment History even while both are, today, still combined in one
running-application key — current runtime has not yet implemented this split.

## Assessment History

**[Target — `docs/adr/0021-assessment-draft-history-authority-unit-split.md`, Accepted,
design complete, not yet implemented.]** The persistence domain owning terminal
(`completed`/`incomplete`) Assessment Runs (today's `AssessmentPersistedState.history`,
inside the combined `curling-release-tracker-assessment-data` key). The only Assessment
persistence domain ADR-0021 permits any future ADR to consider for cloud adoption —
Assessment Draft (above) is permanently excluded. Not the same concept as "History"
(below), which is the Session-domain equivalent (a `Session[]` list) — the two are
separate domains that happen to share a naming pattern; use "Assessment History"
specifically when the Assessment-domain concept is meant, never the bare word "History"
alone in that context.

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

## Accuracy Tolerance Profile

*[Implemented]* `src/lib/accuracyToleranceProfiles/` — a reusable, named
`{ id, name, onTarget, acceptable, createdAt, updatedAt }` configuration aid an
athlete saves under Settings > Accuracy Tolerances, so the same Custom Accuracy
Tolerance values don't need retyping for every Training Block, Training Plan
Step, or (see "Deferred" below) Assessment setup. A profile only ever *helps
select* a pair of Accuracy Thresholds — it is never itself the authoritative
value a Session, Training Block, or Training Plan Step is judged against.
Selecting a profile copies its current numeric values into the configuration
being created; nothing downstream stores a live reference back to the profile,
so editing or deleting a profile later never changes an already-configured
Training Block, Training Plan Step, active Session, completed Session, or
historical analytics — the same "snapshot, never mutated" discipline
`AccuracyThresholds` itself already uses (ADR-0008). Persisted independently of
Sessions/Training Plans, under its own `localStorage` key and schema version
(`src/lib/accuracyToleranceProfiles/persistence.ts`,
`migration.ts`) — malformed profile data fails safely to an empty state and
never invalidates Session or Training Plan data.

## Default Profile

`AccuracyToleranceProfilesState.defaultProfileId` — one authoritative reference
to at most one Accuracy Tolerance Profile, rather than every profile carrying
its own independently-settable "is default" flag (which could otherwise disagree
with itself). Prefills a *brand-new* Training Block/Plan Step's Custom Accuracy
Tolerance fields with that profile's values; never overrides an
already-configured value, and never forces the athlete out of a built-in
Standard/Tight preset into Custom. Deleting the current default profile clears
this reference (`null`) rather than silently promoting another saved profile —
the athlete must explicitly choose a new default afterward.

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

## Smart Random Profile

*[Implemented]* `src/lib/smartRandomProfiles/` — a reusable, named
`{ id, name, measurementMode, min, max, createdAt, updatedAt }` configuration aid an
athlete saves under Settings > Smart Random Profiles, so the same range doesn't need
retyping for every Variable Weight or Blind Weight exercise using Smart Random. Reuses
the exact existing `SmartRandomRange` shape (`min`/`max`) rather than inventing new
field names, and reuses `isSmartRandomAvailable`/`validateSmartRandomRange`
(`src/lib/variableTargets.ts`) unchanged for validation — a profile can only ever be
created for Back-Hog, since Smart Random has no validated range for any other
Measurement Mode. A profile only ever *helps select* a range; it is never itself the
authoritative value a Training Block or Training Plan Step generates targets from.
Selecting a profile copies its current `min`/`max` into the configuration being built;
nothing downstream stores a live reference back to the profile, so editing or deleting
a profile later never changes an already-configured Training Block, Training Plan
Step, active Session, or historical analytics — the same "snapshot, never mutated"
discipline `AccuracyThresholds` and Accuracy Tolerance Profiles already use. Note:
Smart Random's step size (0.05s) and repeat-avoidance memory are **not** part of a
profile, or configurable at all — they remain the fixed implementation constants they
already were (`SMART_RANDOM_STEP`, `NORMAL_REPEAT_AVOIDANCE_MEMORY`,
`LARGE_JUMP_REPEAT_AVOIDANCE_MEMORY` in `src/lib/variableTargets.ts`); a profile only
ever varies the range.

## Default Smart Random Profile

`SmartRandomProfilesState.defaultProfileId` — one authoritative reference to at most
one Smart Random Profile (Version 1 needs only one, not a per-Measurement-Mode map,
since Smart Random is only ever available for one Measurement Mode today). Prefills a
*brand-new* Variable/Blind Weight configuration's Smart Random range when Smart Random
is already the selected target source; never activates Smart Random on its own, never
overrides an already-configured value, and never bypasses Measurement Mode
restrictions. Deleting the current default profile clears this reference (`null`)
rather than silently promoting another saved profile.

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
deliberately UI-only. See `docs/PLATFORM_NAVIGATION_AND_HOME_EXPERIENCE.md`. Not the same
domain as Assessment History (above) — a separate persistence unit for a separate entity
type; use "Assessment History" explicitly when that domain is meant.

## Migration

`sessionMigration.ts`'s `migrateSession`/`migrateSessionHistory`, run unconditionally on
every load. Normalizes old or partial JSON into a valid, current-shape `Session` without
ever rewriting an already-recorded shot value. Must be idempotent. See
`SYSTEM_ARCHITECTURE.md` for the full set of migration rules and the `blocks: []`
invariant.

## Local Adoption

**[Proposed, incomplete design — `docs/adr/0019-cloud-identity-and-data-authority-transition.md`,
not implemented.]** The explicit, **one-time** protocol that uploads a device's
*pre-existing legacy* local data into a signed-in athlete's cloud account, then commits
that account/domain to cloud authority via a server-side **Adoption Run** (a
**seven-outcome** query model — `prepared`, `committed`, `aborted`, plus four distinct,
never-conflated, fail-closed failure outcomes including a "no such run" result, which is
never treated as an authoritative `aborted`; commit/abort are mutually exclusive) plus a
local **Adoption Transition Fence** (a new, exactly-validated, discriminated
`Prepared`/`Committed` record binding the account, domain, run, and source fingerprint —
stored under **one stable key per domain, not scoped by account**, so a valid fence is
discoverable, and quarantines the legacy data it adopted, with no identity, no cloud
capability, and no **Claim Marker** required; never a reuse of ADR-0016's or ADR-0017's
marker/witness/ledger namespaces) and a one-envelope **role-B archive**. The Claim
Marker itself never carries an "adopted" state, but authority is never derived from the
fence either — **the server-side `AccountDomainAuthorityRecord` alone determines
account-domain authority** (ADR-0019 Decision 6); a committed fence is local-generation
evidence only. A committed fence **permanently quarantines** the legacy local data it
adopted from ordinary application flows — it is never physically deleted by this
protocol, since `localStorage` has no compare-and-swap. **A discovered fence proves only
that this browser's legacy generation is permanently quarantined and records which
adoption originally caused that quarantine — it never proves which account currently
holds cloud authority for the domain, and the currently signed-in account is never
required to match the account the fence happens to record.** A currently signed-in
account may use its own cloud repository only when its own
`AccountDomainAuthorityRecord`, `SessionAccessibility`, and RLS authorize it — a
mismatched, unauthenticated, or `disabled` session sees the domain as blocked, never
silently as reachable — these three concerns (local evidence, server authority, and
this session's own accessibility) are tracked as three independent state machines,
never one combined value, and never cross-checked against each other's identity
fields. A **second device that never
locally adopted a domain still discovers its cloud authority correctly**, by querying a
server-side account-domain authority registry keyed by `(accountScopeId, domain)` — one
**transactionally-maintained, exact discriminated-union record per pair**, created at
account bootstrap with `authorityRevision` explicitly `"0"` and never deleted, updated
in the same transaction as every Adoption Run state change, with an exact-format
`authorityRevision` string compared only by equality, never a value the browser
reconstructs by sorting runs — it never needs, and this ADR never gives it, a local
fence of its own. On first discovering that registry record, such a device writes
and validates a permanent local **`RemoteAuthorityBarrier`** *before* exposing any cloud
repository — using the same exclusive domain lock adoption itself uses, since
establishing a barrier is an authority transition, not an ordinary write — an exact,
discriminated record distinct from the fence, surviving logout, reload, and account
switch, and never overwritten by a later sign-in. If the device had pre-existing local
content when the barrier was created, that content is preserved as a **read-only
quarantined branch, for every participating build** — never appended to by ordinary
application flows, never displayed by them, never uploaded to Supabase automatically,
visible only through a future, separately designed recovery/export UI; if it had none,
the barrier still prevents that device's participating builds from creating new legacy
content for the domain going forward. **This does not prove the underlying bytes can
never change**: a non-participating old build ignores the protocol entirely and can
still write legacy keys directly; a barrier only makes a later, participating
resolution detect that drift, by re-comparing the current snapshot against the
fingerprint recorded when the barrier was created, never by preventing the write. Once
drift is detected, it is recorded in its own permanent local artifact,
`RemoteAuthorityDriftEvidence`, so the detection survives a reload rather than being a
purely live, in-memory comparison re-derived on every resolution. A
device that instead observes the registry record as merely `adoption_prepared` (a
still-unsettled adoption in progress, elsewhere) and holds none of that specific run's
own local artifacts must not upload, finalize, abort, or fabricate evidence for it — it
reports a distinct, session-level `adoption_in_progress_elsewhere` result and waits.
Every ordinary write to the legacy local data is serialized by **one stable,
domain-scoped mutation lock** (never scoped by account, since the legacy generation is
one shared resource), held in shared mode by ordinary writes and in exclusive mode by
adoption itself. **Once a domain is quarantined on a given browser, no second,
ordinary, writable local workspace is created for it** — anonymous use and any
non-owning account are explicitly blocked from local use of that domain on that browser
(a proposed MVP restriction); a non-owning account may only use its
own, separately server-authoritative domain, resolved independently of this browser's
fence or barrier. Deliberately distinct from **Migration** (below), which repairs a
domain's own stored shape on every load, on the same device.

**Local Adoption is not the same operation as ongoing synchronization of newly created
data.** Once a domain is cloud-authoritative, uploading each subsequently completed
record (e.g. a newly finished training session) requires a separately designed,
mandatory **transfer/outbox protocol** — not another Local Adoption, and not automatic
**Branch Reconciliation** either. A device whose own pre-existing local content was
preserved rather than reconciled into an already-adopted account/domain is a distinct,
read-only **quarantined branch** (`local_branch_quarantined`) for every participating
build — never silently treated as part of the adopted record and never a second
writable copy of it there — though a non-participating old build can still mutate it
directly, a residual this protocol durably records once detected but cannot prevent. See
ADR-0019 for the full authority model, the `RemoteAuthorityBarrier`, the account-scoped
local namespace, and the non-participating-build limitation this protocol cannot fully
close.

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