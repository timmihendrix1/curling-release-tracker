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