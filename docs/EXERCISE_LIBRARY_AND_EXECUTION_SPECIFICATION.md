# Exercise Library and Execution

> Approved product and domain specification for the curated Exercise Library and its
> Version 1 execution model.
>
> This document records product decisions approved during discovery and separates them
> from later-stage capabilities that are deliberately outside Version 1.
> It defines product meaning and durable domain boundaries, not database tables or UI
> component structure.

---

# 1. Status and authority

This document is **approved for staged implementation** and is the canonical product
and domain source for the Exercise Library and non-release-time exercise execution.
The Swiss Curling rights check in section 5.4 remains an external release gate before
access expands beyond the named closed-beta team; it is not an open Version 1 product
decision.

It complements, and must not contradict:

- `docs/PRODUCT_DIRECTION_AND_PRINCIPLES.md` for Train–Assess–Analyze and the separation
  of intention, perception, measurement, outcome and context;
- `docs/TRAINING_SYSTEM_AND_PLANS.md` for the existing release-timing Training Plan
  product and snapshot principle;
- `docs/DOMAIN_GLOSSARY.md` for current Training Session, Training Block, Shot,
  Measurement and data-ownership terms;
- `docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` for Exercise identity and
  versions, athlete ownership, team permissions, publication and future cloud scope;
- `docs/PLATFORM_NAVIGATION_AND_HOME_EXPERIENCE.md` for the existing Train navigation;
- `docs/UX_WRITING_GUIDELINES.md`, `docs/DESIGN_SYSTEM.md` and
  `docs/COACHING_PRINCIPLES.md` for mobile use, explanations and honest performance
  communication.

The existing `docs/TRAINING_SYSTEM_AND_PLANS.md` remains authoritative for the current,
implemented Release Timing Training Plan Version 1. This document defines its intended
generalisation to curated Exercises; it does not claim that generalisation is already
implemented.

Assessments remain a separate domain governed by
`docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md`. A standardised Measured Exercise
is training, not an Assessment, unless it is deliberately authored and executed under
the Assessment domain's separate protocol, validity and comparison rules.

---

# 2. Product outcome

The Exercise Library is a new pillar within **Train**. It should let athletes move from
measuring release times alone to deliberate practice across a wider set of curling
skills.

Version 1 should let an athlete or team:

1. find a trusted standard exercise;
2. understand why it is useful, how to set it up and how to perform it;
3. execute it alone or with a team on one recording device;
4. record the result for each athlete who delivers a stone;
5. add manual measurements where relevant;
6. retain a private note for each athlete's individual Exercise Result; and
7. combine standard exercises into a simple reusable Training Plan.

The first version proves the value of finding, understanding, performing and recording
exercises. It does not attempt to prove the value of a public content marketplace,
advanced analytics, sensor automation or a visual exercise-authoring tool.

---

# 3. Version 1 product principles

## 3.1 Curated before community-authored

Version 1 contains only platform-curated, immutable Standard Exercises. Athletes and
coaches cannot create, edit, fork, share or publicly publish Exercises in Version 1.

This is a deliberate scope decision, not a rejection of the long-term private, Team
and Community Libraries defined in the cloud architecture. The Version 1 domain must
preserve the identity, version and provenance boundaries those later workflows need,
without implementing their authoring and moderation state machines now.

## 3.2 One consistent exercise language

Every Exercise must explain:

- what the athlete is training;
- why that capability matters;
- how to prepare the ice, stones, people and equipment;
- how to perform the exercise;
- what counts as good, correct, partially successful or unsuccessful where applicable;
- how many attempts or stones are recommended;
- which variations exist; and
- which source and version the curated exercise is based on.

The primary execution screen must remain concise enough for rink-side use. Detailed
explanations belong in progressive disclosure, not as a permanent wall of text.

## 3.3 Configuration is not content editing

An athlete may configure a particular execution without changing the Standard
Exercise. Examples include:

- number of stones or repetitions;
- participants and current roles;
- number of sweepers;
- a curated variation;
- additional compatible Measurement Protocols; and
- a simple execution note.

The actual configuration is captured on the execution. It does not create a new
Exercise or Exercise Version.

## 3.4 Record what actually happened

Planned handle, participant setup, rotation pattern, measurement configuration and
stone count guide the execution but never overwrite reality. Every recorded attempt
retains the actual delivering athlete, actual handle, actual role context, actual
measurements and actual score.

## 3.5 Narrow interface, extensible domain

Version 1 implements a small capability surface on durable boundaries. It must not
hard-code the initial list of Exercises, assume one permanent measurement type, bind a
Training Session to one device identity, or encode diagrams only as opaque raster
images.

Extensibility does not mean implementing dormant authoring, publication, recommendation
or sensor subsystems before they are needed.

## 3.6 Version 1 content language

All Version 1 user-facing Exercise content is English, matching the existing
application. This includes Library titles, purposes, setup and execution instructions,
observation and scoring copy, variations, diagram labels, captions, accessibility text,
filters and actions.

Original German Swiss Curling titles remain only as source metadata for attribution and
traceability. They are not the display titles. `Törli` may remain a source or search
alias, but the visible Technique Exercise title is **Release Gates**.

An approved closed-beta source diagram may be reused only if every user-facing label is
English. German text embedded in the source image must be cropped, replaced or covered
by a faithful English label without changing the sporting meaning. The unmodified
source asset and its attribution metadata remain retained for provenance. Version 1
does not introduce a general localisation framework merely for the initial curated Exercises.

---

# 4. Exercise classification

Exercise classification has independent dimensions. A single overloaded `type` must
not be used for every question.

## 4.1 Primary Exercise Focus

Every Exercise Version has one primary focus used for the main Library grouping and
the default execution experience.

### Technique Exercise

The primary purpose is to practise a movement or delivery characteristic, for example:

- a repeatable release location;
- leg position;
- delivery alignment;
- balance;
- rotation production; or
- another observable technical cue.

Technique Exercises in Version 1 provide instructions and allow a private Athlete Note.
They do not produce a technique score, automated diagnosis or repetition-level
technique analysis. Accurate technical assessment would require explicit human
observation or a future video-analysis capability.

### Shotmaking Exercise

The primary purpose is to execute a defined curling shot or shot sequence toward a
specified outcome. Examples include guards, draws, freezes, soft take-outs and
multi-shot patterns.

Shotmaking Exercises support attempt-level handle and 0–4 outcome scoring.

### Measured Exercise

The primary purpose is to reproduce, vary or observe a measurable property, for
example Release Time or Rotation Count.

A Measured Exercise can stand alone in the Library. Release Time training is therefore
one Exercise family, not a special shortcut outside the Library.

## 4.2 Shot Family

Shot Family describes the curling task and is independent of Primary Exercise Focus.
Initial curated values may include:

- guard;
- draw;
- freeze;
- tap;
- take-out;
- soft take-out / soft shot; and
- sequence / combination.

The final controlled taxonomy is a content decision. The domain must permit a Draw to
be either Shotmaking-focused or Measured-focused. The Swiss Curling Split Time Draws
are an example of this distinction.

## 4.3 Training Purpose

Training Purpose records what capability an Exercise is intended to develop and later
supports discovery and recommendations. Examples include repeatability, weight control,
line control, handle control, release-location control, rotation control and setup
discipline.

`Consistency` is a Training Purpose, not a third competing meaning for Exercise type.

An Exercise may have several purposes, but content authors must identify one primary
purpose and explain it in plain language.

## 4.4 Participation profile

Library filtering and execution requirements are separate:

- an Exercise may be suitable for solo, team, or both;
- an Exercise Version declares its standard and permitted participant setup;
- an Exercise Execution records the actual participant setup.

`Solo` and `Team` are participation modes, not ownership or visibility states.

---

# 5. Exercise identity, content and provenance

## 5.1 Stable identity and immutable versions

`Exercise` is the stable identity. `ExerciseVersion` is one immutable semantic version
of its content.

A material change creates a new Exercise Version. Material changes include changes to:

- purpose;
- setup;
- execution sequence;
- standard participant or sweeping requirements;
- scoring meaning;
- target definition;
- diagram semantics; or
- safety guidance.

Historical executions and Training Plans retain the exact Exercise Version that was
used or selected. A later curated correction must never silently change the meaning of
completed history.

## 5.2 Required Version 1 content

Every curated Exercise Version contains at least:

- title;
- Primary Exercise Focus;
- primary Training Purpose and optional additional purposes;
- optional Shot Family;
- short purpose statement explaining why the Exercise is useful;
- setup instructions;
- ordered execution instructions;
- observation or evaluation guidance appropriate to the Exercise focus;
- default volume or completion condition where applicable;
- difficulty from 1 to 6, or a bounded difficulty range;
- participation modes and role requirements;
- sweeping policy;
- equipment and stone requirements;
- optional curated variations;
- optional structured Ice Sheet Diagram;
- source and attribution; and
- content schema version.

## 5.3 Sweeping policy

An Exercise Version declares one of:

- `forbidden` — the standard protocol is without sweeping;
- `optional` — sweeping may be selected as an execution variation; or
- `required` — the intended exercise requires sweeping.

It also declares allowed or recommended Sweeper counts where relevant. The execution
may deliberately deviate from the standard, but the deviation must be visible and
stored.

## 5.4 Swiss Curling source collection

The supplied Swiss Curling document, **Einzeltraining On Ice – Übungssammlung**, whose
cover displays Version 2.0 and whose file metadata dates from 2021, is the intended
authoritative domain reference for the first Shotmaking corpus.

The supplied collection contains 37 Exercises:

- 11 Guard Exercises;
- 12 Draw Exercises; and
- 14 Soft-Shot / Soft Take-out Exercises.

Its recurring structure — Goal, Description, Scoring, Variations, difficulty, target
volume and Ice Sheet Diagram — is the reference for the platform's content schema.

The platform uses its own responsive presentation and must not treat the Swiss Curling
slide layout as the application layout. Every adapted Exercise preserves a visible
source attribution and source version.

Rights to adapt and distribute the source content must be confirmed before public
release. The fact that the Exercises are recognised standards does not by itself prove
permission to reproduce their text or illustrations.

For the closed beta with the single named Elite Team, the platform may display the
three corresponding source diagrams from the supplied PDF. That Team already trains
with those Exercises and the beta changes only how it accesses them. The diagrams must
remain visibly attributed to Swiss Curling and restricted to that closed test; the
surrounding application copy, interaction design and page composition remain the
platform's own.

This closed-test exception is not treated as permission for a larger pilot, public or
commercial release. Before access is widened, the product owner must clarify the use
with Swiss Curling. The resulting permission must be recorded with its scope. If it
does not cover the intended use, the source diagrams and any other restricted source
expression must be replaced by independently authored content before widening access.

## 5.5 Curated content delivery

Version 1 curated Exercises are delivered through a versioned content package or seed
mechanism. They must not be implemented as conditional UI logic for 37 named cases.

No user-facing or platform-admin authoring interface is required in Version 1. Curated
content corrections are made through reviewed content changes that create new immutable
Exercise Versions when their meaning changes.

## 5.6 Approved initial closed-test catalogue

The initial closed test contains seven curated Exercises selected with the Elite Team.
The previously discussed Technique Exercises **Rotation** and **Laser** are deliberately
deferred until Team feedback justifies their capture and presentation needs; they remain
future content, not deleted concepts.

### Swiss Curling Shotmaking Exercises

1. **Eight Guards, Progressively Longer** (`Guard`, Level 6; source title:
   `Guard Übung 10: 8 Steine Guard, immer länger`);
2. **Come-around from Outside to Inside, Before the T-Line** (`Draw`, Level 3; source
   title: `Draw Übung 6: Comearound von aussen nach innen, vor T-Line`); and
3. **Soft Take-out on the Centre Line at the T-Line** (`Soft Take-out`, Level 4; source
   title: `Softshot Übung 5: Soft-Takeout auf Centerline T-Line`).

The platform uses its own wording and interaction design while preserving Swiss Curling
attribution and the source exercise identity. For the one-Team closed beta, it may use
the three corresponding source diagrams under Section 5.4's restricted exception. The
closed beta provides the generic 0–4 capture mechanism but no platform-authored,
exercise-specific scoring rubric. The other 34 Exercises in the supplied collection
are deferred content expansion, not Version 1 implementation scope.

### Technique Exercises

1. **Release Point**;
2. **Release Gates** (source / search alias: `Törli`).

### Standalone Measured Exercises

1. **Release Time**; and
2. **Rotation Count**.

The first domain and UI vertical slice uses Release Point, Eight Guards, Progressively
Longer and standalone Release Time. The other four initial-test Exercises expand the
same schemas and renderers before Team testing; none may require a named,
exercise-specific UI branch. Rotation and Laser may be reconsidered after that test.

---

# 6. Structured Ice Sheet Diagrams

## 6.1 Purpose

The diagram is instructional content, not decoration. It should let an athlete
understand setup, intended path, target and sequence without reverse-engineering a
paragraph of text.

## 6.2 Canonical geometry

Platform-authored Diagram elements use a normalised Ice Sheet coordinate system shared
by all Exercises. The structured model must be independent of pixels, screen size and
source-document page geometry.

This provides a future seam for sensor-derived positions and trajectories without
making sensors part of Version 1.

## 6.3 Closed-beta source-image exception

The three Swiss Curling Shotmaking Exercises may use attributed source-image diagrams
only inside the approved one-Team closed beta. The content model distinguishes an
`attributed source image` from a `structured platform diagram` and retains source,
version and permitted-distribution metadata. A source image is a responsive
instructional asset, not coordinate data and not a sensor-compatible diagram.

The source image must not be exposed through a public Library or unauthenticated asset
surface. Widening access requires the rights decision in Section 5.4 and either recorded
permission for the image or a new Exercise Version containing an independently authored
structured diagram.

## 6.4 Structured diagram primitives

The structured renderer seam supports the curated primitives required when the source
images are replaced or new platform diagrams are added:

- sheet, lines and house geometry;
- static stone positions;
- stone numbers or sequence labels;
- shot paths and directional arrows;
- static target zones;
- multiple target zones tied to sequence steps;
- relative targets around another stone;
- setup stones; and
- concise labels or constraints.

The data model uses a versioned discriminated element union so new primitives can be
added later. Unsupported future elements must fail visibly during content validation;
they must not silently disappear from an Exercise.

## 6.5 Deferred diagram capabilities

Version 1 does not include:

- a user-facing Diagram Editor;
- draggable stones during execution;
- animated shot sequences;
- interactive simulation;
- actual-position capture;
- sensor trajectory overlays;
- video overlays; or
- automatic scoring from coordinates.

The diagram should support mobile-friendly enlargement, but it is not an analytical
canvas in Version 1.

---

# 7. Training and execution hierarchy

## 7.1 Conceptual hierarchy

The intended product hierarchy is:

```text
Training Plan (optional reusable configuration)
  Planned Exercise Steps

Training Session (what actually happened)
  Exercise Execution
    Participant Roster
    Role Assignment Segments
    Athlete Exercise Results
      Athlete Note
      Shot Attempts
        Shot Intention
        Shot Outcome
        Measurements
```

This hierarchy generalises the existing Session → Training Block → Shot foundation. It
does not decide in this product specification whether `ExerciseExecution` becomes a new
Training Block union member, a generalisation of Training Block, or a related persisted
entity. That implementation decision must preserve existing Release Timing history and
requires a focused domain/persistence design stage.

## 7.2 Exercise Execution

An Exercise Execution is one actual performance of one Exercise Version inside a
Training Session.

It records a snapshot of:

- referenced Exercise Version;
- selected variation;
- planned volume or completion condition;
- enabled Measurement Protocols;
- participant roster;
- planned role and rotation configuration;
- actual role assignment segments;
- sweeping configuration and whether sweeping was actually used;
- deviations from the Exercise standard;
- attempts and athlete associations;
- start and completion state; and
- private Athlete Notes permitted by Version 1.

Changing objective or Exercise creates a new Exercise Execution. Historical execution
configuration is never recomputed from the current Library version.

## 7.3 Technique executions without shots

A Technique Exercise may be completed with instructions and a private Athlete Note but
no scored Shot Attempt. The future execution model must therefore not define a
meaningful Training Session solely as one containing a measured or scored Shot.

The implementation stage must explicitly reconcile this requirement with the current
Session behaviour, which archives only sessions containing shots.

## 7.4 One active execution in Version 1

One Training Session may contain several sequential Exercise Executions, but Version 1
allows exactly one active Exercise Execution at a time.

Parallel stations, multiple active sheets and concurrent recording are deferred.

---

# 8. Participants, roles and rotation

## 8.1 Participants and roles are different

The participant roster records who is present for the Training Session. Role assignments
record what each participant is doing during a particular part of an Exercise.

A participant may rotate between delivering athlete, Sweeper, Skip / broom giver,
observer, Coach or timekeeper. Participation is therefore not inferred from one fixed
role.

Every Team participant in Version 1 resolves to an authenticated Profile. Guest or
free-text participant identities are not part of the Version 1 Team execution model.

## 8.2 Training athletes and supporting participants

The execution distinguishes:

- **training athletes**, whose individual results or completion records are captured;
  and
- **supporting participants**, who may sweep, provide the broom, observe, coach, time or
  prepare stones without receiving the current attempt's performance result.

A Coach may also be a confirmed Session participant and may record attempts.

## 8.3 Start configuration

At Training Session start, the user selects the participant roster. At Exercise start,
the user confirms or configures:

- current delivering athlete or athlete order;
- zero, one or two Sweepers where allowed;
- optional Skip / broom giver;
- any required observer or timekeeper;
- standard or deliberately changed sweeping behaviour; and
- a simple rotation pattern.

Exercise-level defaults inherit from the Exercise Version or Training Plan step and may
be overridden for the actual execution.

## 8.4 Version 1 rotation

Version 1 supports a deliberately small set of rotation behaviours:

- fixed roles;
- change delivering athlete after every stone;
- change delivering athlete after a configured number of stones;
- change after one complete series; and
- manual change at any time.

A free-form role choreography editor is deferred.

## 8.5 Actual role assignment segments

The planned rotation assists the interface but is not historical truth. Whenever the
actual lineup changes, the execution starts a new Role Assignment Segment. Attempts
reference the segment active when they were recorded.

This preserves:

- delivering athlete;
- Sweeper identities and derived Sweeper count;
- Skip / broom-giver identity;
- other selected support roles; and
- whether sweeping was used.

Counts should be derived from known participant identities where identities are
available. Storing only `2 sweepers` would prevent later reconstruction of who filled
the roles.

## 8.6 Deviations

The application may warn when the actual setup differs from the Standard Exercise, but
it does not forbid a deliberate deviation. The deviation is stored and shown on the
result.

Results recorded under materially different contexts must not later be compared without
disclosing the difference. In particular, no-sweep and two-Sweeper executions are not
silently treated as protocol-equivalent.

---

# 9. Recording identity and device scope

## 9.1 Authenticated recorder

The authenticated user submitting an attempt is automatically the recorder. There is
no Recorder selector or Recorder-change button in Version 1.

For a cloud-backed write, the server **authenticates the account, resolves its linked
`Profile`, and derives `recordedByProfileId` from that Profile** (clarified 2026-08-24 —
recorder attribution is Profile-scoped; the account is only how the actor is
authenticated). The client must not be allowed to claim an arbitrary recorder identity.

`recordedByProfileId` is distinct from the `athleteId` whose result is being captured.
A Coach may record a stone for an athlete without becoming the owner of that result.

## 9.2 Recording permission

An athlete may give a Team one explicit, prospective permission to record that
athlete's individual results in shared Training Sessions. This recording permission is
separate from Team membership and from any grant to view historical results or
analytics. It need not be confirmed again before every Training Session.

At Training Session start, the recorder selects the people who are actually present
from eligible active Team Profiles. That roster becomes the confirmed Session
participant set. Roster additions and removals remain attributable; a later Team join
does not retroactively make someone a Session participant.

Every confirmed participant in the active Training Session, including a Coach, may
record on the Version 1 recording device. General Team membership alone does not grant
this permission.

Session-scoped recording authority does not itself grant lasting access to another
athlete's history or analytics. Athlete ownership and Team data-sharing grants remain
governed by the cloud architecture. Revoking the prospective recording permission
prevents capture in later Sessions; it does not silently erase already recorded
history.

## 9.3 One recording device

Version 1 supports one active recording device for a Training Session. Several devices
may not concurrently record the same execution.

Changing to another recording device during an active Session is a Nice-to-Have, not a
Version 1 requirement. The domain must not bind Session identity or data ownership to a
device, so a later explicit takeover mechanism can be added without rewriting history.

A device identifier, if retained for operational diagnostics or measurement provenance,
is not a product ownership identity.

## 9.4 Offline Team capture and later upload

Version 1 supports starting, performing and completing a one-device Team Training
Session without a live connection when the device already has the required Exercise
Versions, Team Profiles and latest known recording-permission state cached locally.
Cached eligibility permits local capture; it is not final cloud authority.

The complete pending Session is stored durably on the recorder device and bound to the
authenticated recorder Profile that created it. Every Session, Exercise Execution,
athlete result, attempt, outcome and Measurement receives a stable client-generated ID
before upload. The UI must distinguish at least:

```text
local draft
  -> locally completed, upload pending
  -> fully synced
  -> partially synced, athlete result blocked
```

The recorder must always be able to see whether data exists only on that device. Pending
data remains locally available across application restart and network interruption and
must not be exposed after an account switch.

When connectivity returns, the client uploads the completed Session coordination record
and its athlete-owned result bundles with stable idempotency keys. Retrying an uncertain
or interrupted upload must converge on one cloud record per stable ID and must not
duplicate attempts, Measurements or notifications. Local pending data is not cleared or
treated as synced until the server explicitly acknowledges it.

At upload, the server **authenticates the account, resolves its linked `Profile`, and
derives the recorder from that Profile**, then revalidates the Team, participant and
recording-permission boundary for each athlete result. If current
authority is missing, only the affected athlete bundle is blocked; other valid athlete
results may sync. A blocked bundle is neither discarded nor assigned to another athlete.
The affected athlete may explicitly approve that concrete Session before its result is
accepted.

An unsynced Session cannot move to another recorder device in Version 1. This bounded,
one-way completed-Session upload is not a generic bidirectional sync engine and does not
permit concurrent recording, cross-device continuation or offline Team administration.

---

# 10. Focus-specific Version 1 execution

## 10.1 Technique Exercise

A Technique Exercise execution provides:

- purpose and benefit;
- setup;
- ordered performance guidance;
- observable descriptions of correct and needs-attention behaviour;
- optional compatible manual Measurements; and
- a private Athlete Note.

It does not provide:

- technique score;
- repetition-by-repetition technique judgement;
- automated diagnosis;
- inferred body-position conclusions from Release Time or Shotmaking Score;
- Coach review workflow; or
- video analysis.

Technique Exercises never display Shotmaking score controls, points, percentages,
target attainment or passed / failed status. The athlete may observe themselves or be
observed by another Session participant. Feedback is exchanged verbally in Version 1;
the athlete may retain useful input in their own private Athlete Note.

The four approved Technique Exercises use these instructional protocols:

1. **Release Point** — release the stone consistently at the same location, preferably
   near the hog line or at another reference location defined by the Team. Observe the
   release location and repeatability.
2. **Rotation** — give the stone a consistent rotation and aim for the rotation count
   defined by the Team. This remains unscored Technique guidance. The optional manual
   Rotation Count Measurement may be attached without turning the observation into
   points.
3. **Laser** — aim a point laser at the centre of the hack and film the delivery from
   the front for Draws, Hits and Peels so the athlete and Team can manually inspect and
   improve alignment and release behaviour. In Version 1, the laser and camera are
   external equipment: the application neither records, uploads nor analyses video.
4. **Release Gates** — place one gate at the Release Point and a second gate
   approximately 30 centimetres farther along the delivery line. Observe what happens
   to the stone after release and use the observation as verbal feedback or a private
   Athlete Note.

The final instructional copy, safety guidance, equipment requirements and observable
`correct` / `needs attention` descriptions for these four Exercises require content
review with the testing Elite Team before seed data is approved.

## 10.2 Shotmaking Exercise

For every attempted Shotmaking stone, Version 1 records:

- delivering athlete;
- intended handle where the Exercise or plan prescribes one;
- actual handle;
- evaluation status as scored or excluded;
- score from 0 through 4 when scored, or a required exclusion reason when excluded;
- active role context;
- compatible manual Measurements; and
- ordering within the athlete's series and shared execution.

The actual handle is authoritative for history. A planned handle may preselect the
interface but never locks or rewrites the saved value.

## 10.3 Measured Exercise

A Measured Exercise may stand alone. Its primary purpose and completion guidance centre
on one or more required Measurement Protocols.

Initial examples are:

- Release Time training; and
- manually counted rotations.

Manual observation and future sensor input must converge on the same Measurement domain
boundary. Measurement source remains explicit.

## 10.4 Combined exercise and measurement

A Shotmaking or Technique Exercise may attach compatible Measurement Protocols without
becoming a duplicated Library item.

Example:

```text
Exercise: Draws in front of the house
Primary focus: Shotmaking
Outcome: 0–4 score
Additional measurements: Release Time and Rotation Count
```

Conversely, a Library item whose primary training purpose is Release Time remains a
Measured Exercise.

Outcome and Measurement remain independent even when the interface captures them in
one flow. A 0–4 Shotmaking Score is an outcome evaluation, not an objective sensor
Measurement merely because it is numeric.

Shotmaking Score is stored as Shot Outcome, never as a Measurement `metric_type`. A
persistence implementation may reuse generic typed-value infrastructure only if its
domain semantics and user-facing language preserve that distinction and do not create
two competing score records.

---

# 11. Shotmaking scoring

## 11.1 Per-stone scale

Shotmaking uses curling's familiar 0–4 scale:

| Score | Percentage |
|---:|---:|
| 0 | 0% |
| 1 | 25% |
| 2 | 50% |
| 3 | 75% |
| 4 | 100% |

Zero is a valid scored result and must never be treated as missing data.

## 11.2 Variable exercise length

Exercises may contain any positive number of scored stones. The maximum point value is
therefore derived from the number actually scored, never from an assumed eight stones.

```text
percentage = sum(score) / (4 × scored stone count) × 100
```

The arithmetic mean of the per-stone percentages is equivalent and valid.

Excluded attempts are omitted from both `sum(score)` and `scored stone count`. They
therefore never behave like a hidden zero.

## 11.3 Excluded attempts

An attempted stone may be marked `excluded` when its outcome cannot be evaluated fairly
because the training conditions or capture failed. Version 1 provides this as a
secondary **Do not score** action, not as a sixth value beside 0–4.

The user must select a reason:

- external interruption;
- incorrect or displaced setup;
- technical or capture problem;
- outcome not observable; or
- other, with a short explanation.

The excluded attempt remains visible in sequence and retains its athlete, handle, role
context, timestamps and any independently valid Measurements. It is reported separately
and omitted from Shotmaking points, average percentage and 0–4 distribution.

An execution error by the athlete is not an exclusion reason. Wrong handle, wrong
weight, missed line or a complete miss receives the appropriate 0–4 score. The athlete
may play an additional stone after an exclusion, but Version 1 does not automatically
insert or require a replacement attempt.

## 11.4 Exercise-specific meaning

In the closed-beta Version 1, the application provides the standard Curling 0–4 input
mechanism but no exercise-specific thresholds for deciding between 0, 1, 2, 3 and 4.
The athlete or Team applies its own current judgement to the Exercise goal. Different
Teams may therefore score the same outcome differently.

The UI explains only the generic percentage mapping and labels the result as a
self-/Team-assessed Shotmaking outcome. It must not present this judgement as a
platform-standardised result, and cross-Team comparison of these scores is invalid.
Each Version 1 execution retains an explicit `team-defined / unstructured` evaluation
basis so later analytics cannot mistake it for a standard rubric.

The application must not imply that the score identifies the technical cause of a
miss.

After the beta, the platform should provide a versioned recommended rubric for each
Shotmaking Exercise. A Team may adopt that recommendation unchanged or create an
adjusted Team rubric. The selected rubric identity, version and resolved criteria must
be snapshotted on the Exercise Execution; later edits or improved recommendations never
reinterpret completed results.

Recommended and Team-adjusted rubrics are a deferred feature. Version 1 includes no
rubric editor, no hidden default thresholds and no claim that its unstructured scores
are comparable with results recorded under a later rubric.

## 11.5 Source reference goal

Many Swiss Curling Standard Exercises state a reference goal such as `6 of 8` stones in
the target zone. Version 1 preserves that goal transparently in the Exercise description
as source guidance, but does not score, derive or display it as passed or failed.

The reference goal does not affect the 0–4 calculation. It is not treated as a universal
performance threshold because the same target may be too demanding for a beginner and
not demanding enough for an elite athlete.

## 11.6 Basic Version 1 result

Version 1 shows only the following descriptive results where applicable:

- scored stone count;
- excluded attempt count and reasons;
- points and average percentage;
- 0–4 distribution;
- In-/Outhandle split where sample size permits a factual display;
- actual participant and sweeping context; and
- each athlete's own result in a Team execution.

The source reference goal may be repeated as instructional context, but it is not a
result status and never produces a passed / failed label.

It does not provide causation claims, technique diagnosis, recommendations, Team
rankings or longitudinal analytics.

---

# 12. Measurements

## 12.1 Reusable protocol

A Measurement Protocol defines what should be observed and how, independently of the
Exercise that uses it. An execution may enable several compatible protocols, even if
the first UI offers only a narrow curated selection.

Conceptually, the protocol describes:

- metric type;
- unit;
- measurement interval or reference points;
- allowed source types;
- target or tolerance where applicable;
- required supporting role for a manual method; and
- completion guidance.

## 12.2 Version 1 sources

Version 1 scope includes existing Release Time capture paths and manual entry for new
measurements such as Rotation Count.

The Measurement records preserve source provenance such as:

- manual self-entry;
- manual observation by a teammate;
- Brower Timing; or
- future sensor provider.

An observer identity is retained when a known teammate manually measures a property. It
is not the same as the authenticated recorder identity.

## 12.3 Deferred sensor data

Stone position, speed, direction, rotation rate and trajectory are deferred. Their
future model should preserve raw time-series data outside ordinary normalised metrics,
with coordinate-system, calibration, source and quality metadata.

No Version 1 interface or score may pretend such data exists.

---

# 13. Notes

Version 1 supports plain-text notes only. Rich text, attachments, video, threads,
reactions and diagram annotations are deferred.

The Version 1 note is an optional private **Athlete Note** attached to that athlete's
individual Exercise Result. It is not a shared field on the common Exercise Execution.
Each training athlete may therefore have a different note for the same Team execution.

The athlete owns the note and is the only person who may create, edit, clear or read it
in Version 1. The authenticated recorder may not write or edit a note for another
athlete, even though the recorder may capture that athlete's factual attempts and
Measurements under the active-Session permission.

Technique Exercises rely particularly on notes because Version 1 performs no technique
analysis. In Solo execution, the athlete may add the note during or after the Exercise.
In a Team execution, an athlete who is also the active recorder may add their own note
on the recording device; every other athlete adds or edits their note later through
their own authenticated account, and the note is owned by that account's linked `Profile`.

Private Athlete Notes are not included in Team-summary or coaching data grants and are
not disclosed merely because another person participated in the Session. Editing or
clearing a private note does not notify other Session participants because it does not
change a shared performance result.

The existing Training Session note remains unchanged for current Solo / Release Timing
flows. It must not be silently reused as a shared note for a multi-athlete Team Session.
A future shared operational note, Coach Feedback and deliberate athlete-controlled note
sharing require separate models with explicit authorship, ownership and visibility.

---

# 14. Library and detail experience

## 14.1 Navigation

The Exercise Library lives within **Train**. It does not create a new top-level
navigation destination.

Quick Start is an entry mechanism, not a synonym for Release Time. It may later repeat
a recent execution or start a recognised default, but the Library information
architecture must not hard-code Release Time as the meaning of Quick Start.

## 14.2 Version 1 discovery

Version 1 discovery includes:

- text search;
- Primary Exercise Focus;
- Shot Family where applicable;
- difficulty;
- Solo / Team suitability;
- participant requirements; and
- Sweeper requirements.

Recommendations, ratings, public popularity, social signals and personalised ranking
are deferred. Favourites and recent-item shortcuts are also deferred from the required
Version 1 scope.

## 14.3 Standard detail structure

Every Exercise detail uses the same information order:

1. title, focus, category, difficulty and source;
2. short goal and why it matters;
3. Ice Sheet Diagram where applicable;
4. setup, participants, roles, equipment and sweeping policy;
5. ordered instructions;
6. observation guidance and the generic 0–4 capture explanation where applicable;
7. source reference goal or completion guidance;
8. curated variations;
9. compatible Measurements; and
10. start action.

The structure is inspired by the Swiss Curling collection, but the application uses its
own mobile-first design and progressive disclosure.

## 14.4 Exercise start flow

The Version 1 start flow should require only information that changes execution:

1. confirm Solo or Team context;
2. select training athletes and supporting participants;
3. assign initial roles and Sweeper count;
4. select one simple rotation pattern;
5. select a curated variation and compatible optional Measurements;
6. configure volume where the Exercise permits it;
7. review any standard deviations; and
8. start.

Defaults from the Exercise Version or Training Plan should minimise rink-side input.

---

# 15. Training Plans

## 15.1 Generalisation of the existing product

A simple Version 1 Exercise Training Plan is an ordered reusable configuration of
curated Exercise Version steps. It preserves the existing principle:

```text
Training Plan defines what should happen.
Training Session records what actually happened.
```

## 15.2 Plan step configuration

A planned Exercise step may snapshot:

- Exercise Version;
- curated variation;
- volume or completion condition;
- handle strategy;
- required and optional Measurement Protocol configuration;
- intended participant / role defaults; and
- intended sweeping setup.

Actual execution remains overridable and historical truth remains on the resulting
Exercise Execution and attempts.

## 15.3 Version 1 plan scope

Version 1 supports ordered plans only. It does not include:

- calendar scheduling;
- recurring or multi-week programming;
- assignment to athletes or Teams;
- due dates and reminders;
- adaptive progression;
- AI-generated plans;
- plan compliance scoring;
- shared-plan editing; or
- plan marketplaces.

A group may execute one simple plan together on the single Version 1 recording device.

## 15.4 Snapshot integrity

Editing a saved plan or publishing a newer Exercise Version never changes a started or
completed Training Session. A saved plan also stays on its selected Exercise Version
until an explicit update action is defined and performed.

---

# 16. Team execution, ownership and privacy

## 16.1 One logical Team Session, individual athlete results

Version 1 supports several training athletes inside one logical Team Training Session.
Every Shot Attempt is attributed to exactly one delivering athlete.

The shared Session provides execution context and coordination; it does not transfer
ownership of individual performance data to the Team, Coach or recorder.

## 16.2 Result ownership

An athlete owns their attempts, Measurements and individual Exercise result. The
authenticated recorder is retained as provenance but does not become the owner.

The persistence design may need a shared Training Event coordination record linked to
athlete-owned result records so the product can present one Session without violating
the existing ownership model. The exact relational mapping belongs to the domain and
persistence implementation stage.

## 16.3 Access boundary

Participation in an active Session grants only the bounded capability required to
record that Session. It does not automatically grant:

- historical session access;
- longitudinal analytics;
- access after the Session under a Team-membership shortcut; or
- ownership of another athlete's note or result.

All lasting access continues to use the athlete-to-Team sharing model defined in the
cloud architecture.

## 16.4 Corrections while the Session is active

While a Training Session is active, the authenticated active recorder may correct
manually captured facts such as athlete attribution, handle and Shot Outcome. Every
correction retains the actor and time in an audit record; the current recorder may not
impersonate the original recorder or another participant.

These rink-side corrections do not generate participant notifications. They remain
visible in the audit history so completion cannot turn an untraceable overwrite into
the historical record.

The active recorder may correct **any** already recorded Shotmaking stone, not only the
latest. Version 1 correction covers delivering athlete, actual handle, evaluation or
exclusion, manual Rotation Count and observer, and the stone's Sweeper/sweeping, Skip,
observer, Coach and timekeeper context. No typed reason is required before completion;
the system retains exact before/after values, recorder and time automatically.

A stone entered accidentally may be marked `Recorded by Mistake`. It is excluded from
the current attempt count, result calculations and completion eligibility but remains in
the active correction audit with its original facts. This is neither hard deletion nor
post-completion ordinary voiding. After completion, the audit is visible only through
the affected athlete-owned result projection; it does not create lasting recorder or
participant access.

## 16.5 Post-completion revisions and ordinary voiding

After Session completion, only the affected athlete may revise or void their own
result in Version 1. A Coach, recorder or other participant receives no post-completion
write authority merely through their former Session role. Broader Coach correction
workflows require a separate future permission decision.

Version 1 post-completion correction is stone-specific but cannot change athlete
attribution. The athlete may correct the actual handle, evaluation or exclusion,
supported Measurements and that stone's effective role/Sweeper context. Reassigning a
stone to another athlete would mutate that person's ownership boundary and is therefore
forbidden after completion.

Every post-completion change requires a reason and creates an append-only audited
revision. The history retains at least:

- the original and resulting values;
- the fields that changed;
- the affected Session, Exercise Execution and athlete;
- the authenticated actor and timestamp; and
- the stated reason.

The current result and calculations use the latest valid revision and visibly mark it
as changed after completion. A normal user-facing deletion is an audited `voided`
state: the result is excluded from current calculations but its provenance and revision
history remain. Version 1 voiding applies only to the athlete's complete result, is
terminal and cannot be undone or edited back into use. Individual stones are corrected,
not separately deleted. The required reason is trimmed free text of 10 through 500
characters. Irreversible account deletion, legally required erasure and retention
expiry are separate privacy operations and must not be implemented as ordinary result
editing.

## 16.6 Post-completion change notifications

A post-completion revision or ordinary voiding produces an in-app notification for the
original confirmed Session participants who are still authorised to receive that
Session's operational notifications when delivery is evaluated. The recipient basis is
the completed Session's participant snapshot intersected with current entitlement and
access; it is not the whole Team.

In particular, the application does not notify non-participants, later Team joiners or
former participants whose current access has ended. The notification identifies the
actor, Session, time, reason and kind or number of changed records. Before-and-after
performance values are included only for recipients whose current data-sharing grant
allows those values; other eligible recipients receive change metadata without the
athlete's private result values.

Email and push transports are deferred. Notifications are required only for changes
after Session completion, not for each correction during active rink-side recording.
The athlete making the change is not notified. Version 1 evaluates current eligibility
as an active membership in the same Team plus a current platform entitlement, uses the
existing unread in-app Team notification inbox and sends metadata only because the
future Team data-sharing grant is not implemented. The actor's display name is
snapshotted at change time; no foreign result payload or performance value is copied
into a notification.

---

# 17. Version 1 results and analytics boundary

The Version 1 Exercise Library records sufficient raw facts for future analysis but
deliberately provides only current-execution and simple result summaries.

Version 1 excludes:

- recommendations;
- inferred training needs;
- correlations between measurements and outcome;
- cross-session trends;
- athlete-to-athlete comparison;
- Team ranking;
- public benchmark comparison;
- automatic progression; and
- synthetic overall Exercise scores.

Future analytics must compare compatible Exercise Versions and disclose materially
different variations, participant configurations, Sweeper counts, measurement sources
and evaluation bases or scoring rubrics. Unstructured Version 1 Team judgements must
not be pooled with standardised or differently customised rubric results.

---

# 18. Complete Version 1 scope boundary

## 18.1 Included

- platform-curated Standard Exercises with immutable versions;
- the approved nine-Exercise closed-beta catalogue from Section 5.6;
- source attribution and own platform presentation;
- Technique, Shotmaking and Measured Exercise focus;
- Shot Family and Training Purpose as independent classifications;
- responsive attributed source diagrams for the three restricted beta Exercises and a
  structured platform-diagram seam;
- search and essential filters;
- Solo and Team execution;
- multiple individually recorded athletes in one Team Session;
- one active Exercise and one recording device;
- offline Team capture with a visible, durable later-upload state on that device;
- simple role assignment and rotation;
- zero, one or two Sweepers and optional Skip / broom giver;
- deliberate deviation from standards with visible marking;
- actual handle and 0–4 score per Shotmaking attempt;
- generic self-/Team-assessed 0–4 capture without exercise-specific beta thresholds;
- separately retained excluded attempts that never count as zero;
- variable exercise length and correct percentage arithmetic;
- standalone and attached Measurement Protocols;
- manual Release Time and Rotation Count paths, plus existing compatible timing input;
- one optional private plain-text Athlete Note per individual Exercise Result;
- audited active-session corrections;
- athlete-owned post-completion revisions and ordinary voiding;
- in-app change notifications to the original, still-authorised Session participants;
- basic per-athlete execution summaries; and
- simple ordered Training Plans containing curated Exercises.

## 18.2 Explicitly deferred

- athlete-, Coach- or Team-authored Exercises;
- editing, forking, copying and publishing Exercises;
- My, Team and Community Library interfaces;
- Diagram Editor;
- moderation, reports, ratings and public ranking;
- advanced or longitudinal Exercise analytics;
- recommendations and AI-generated training;
- platform-recommended and Team-adjustable Shotmaking rubrics;
- Coach review and comment workflows;
- shared operational or Team notes;
- Coach-authored notes and deliberate sharing of private Athlete Notes;
- rich notes, attachments and video;
- complex role choreography;
- parallel stations or sheets;
- multiple active recording devices;
- mid-Session device takeover;
- generic bidirectional offline synchronisation or offline Team administration;
- complex scoring formulas or multiple judges;
- coordinate-based automatic scoring;
- stone-position sensors and trajectories;
- video analysis;
- calendar, assignments and multi-week plans; and
- public or Team plan sharing.

---

# 19. Required future extension seams

Version 1 must preserve these boundaries even where the corresponding feature is
deferred:

1. `Exercise` identity is separate from immutable `ExerciseVersion` content.
2. Exercise classification dimensions are independent and extensible.
3. Diagrams use versioned structured elements in normalised sheet coordinates.
4. Execution configuration is a snapshot, not a mutation of Library content.
5. Shot intention, outcome, Measurement, perception and context remain separate.
6. Each attempt identifies its athlete independently of recorder and device.
7. Measurements are repeatable typed records with source provenance, not fixed Release
   Time columns.
8. Actual role context and protocol deviations are retained for future comparability.
9. Plans reference immutable Exercise Versions and snapshot configuration.
10. Team coordination never changes athlete ownership of performance data.
11. Deferred authoring and publication can add lifecycle states without changing
    completed execution history.
12. Future sensor data can attach derived metrics and raw-data references without
    replacing manually captured history.
13. Offline Team records receive stable IDs before upload and cross the cloud boundary
    through a dedicated idempotent completed-Session envelope.
14. Every Shotmaking execution identifies its evaluation basis; future recommended and
    Team-adjusted rubrics are versioned snapshots and never reinterpret history.

These are domain invariants, not instructions to build every future table or screen in
Version 1.

---

# 20. Approved commercial boundary

The closed beta enables every required Exercise Library capability through the existing
reversible pilot entitlement. It performs no payment collection or production billing.

**Corrected 2026-08-24** per
`docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md` §6 and
`docs/adr/0024-mandatory-identity-and-free-structured-cloud-foundation.md`: structured raw
Exercise results, private Athlete Notes, their cloud persistence and basic restore are
**Free** — part of the **Free Cloud Core**. The paid personal tier sells value *derived*
from that data. The paid tier's **final commercial name is undecided**; `Personal Athlete`
below is a working label only. Free is a **signed-in** tier: every participant still needs
their own account and Profile.

The approved post-pilot capability mapping is:

| Capability | Commercial boundary |
|---|---|
| Browse the curated Standard Exercise Library | Free |
| Solo execution with manual 0–4 evaluation or manual Measurements | Free |
| Private Athlete Note and basic current-execution result | Free |
| **Cloud persistence of structured raw Exercise Executions, Attempts, evaluations, Measurements, void/revision facts and Athlete Notes** | **Free** (Free Cloud Core, no date cutoff) |
| **Basic restore of the athlete's own history after signing in on a new device** | **Free** |
| Reusable personal Training Plans | Paid personal tier |
| Longitudinal analytics, comparisons, trends and benchmarks over Exercise history | Paid personal tier |
| Supported automatic hardware capture | Paid personal tier |
| Multi-athlete Team Session, roster, roles, rotation and one active recorder | Team Workspace |
| Bounded offline Team capture and later upload | Team Workspace |
| Team-owned or Team-executed Training Plans | Team Workspace |
| Structured Coach analysis and Coach Feedback | Deferred Coaching module |

**Cross-device continuation is not on this table in either column** — continuing an
in-progress Session on another device, concurrent multi-device editing, and moving an
unsynced Session to another recorder device are all deferred (§9.2 already states the
last of these for Version 1).

An athlete may always view and export their own raw result created in a Team Session,
**and that result remains stored and cloud-persisted for them on Free alone.** Subscription
state never transfers data ownership or hides athlete-owned raw data. Entitlement checks
remain configurable and separate from identity, permission and persistence models: a Team
permission is never an entitlement, and an entitlement is never a permission.

No unresolved product decision remains in this specification. Section 5.4's Swiss
Curling rights clarification is an external gate before a larger test or release, not
authority for an implementation agent to widen distribution.

Two things this specification depends on but does not decide: the **final commercial name
of the paid personal tier** (undecided — see above), and the **identity and persistence
foundation** Stages B0.2-B0.4 provide (see §21's prerequisites). Neither is an unresolved
*Exercise* decision; both are prerequisites recorded in
`docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md`.

---

# 21. Staged implementation and review gates

This feature crosses content, domain, persistence, UI, Team authorization and future
cloud boundaries. It must not be implemented as one undifferentiated pass.

## Identity and persistence prerequisites (added 2026-08-24)

Stage B depended on the following foundations. Per
`docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md` §11 and
`docs/adr/0024-mandatory-identity-and-free-structured-cloud-foundation.md`, these must be
implemented and independently reviewed **before Stage B began**:

- **Stage B0.2 — Identity and Onboarding Gate (implemented).** Required by §9.1 (the recorder is derived
  from the authenticated Profile, with no Recorder selector), §8.1 (every Team participant
  resolves to an authenticated Profile), and §12/§13 (each athlete edits only their own
  private note through their own authenticated account). Every participating athlete,
  recorder and coach needs their own account and Profile; they do not all sign into the
  recorder's device.
- **Stage B0.3 — Profile-scoped Local Data (implemented and verified).** Required by §9.2's rule that pending Session
  data must not be exposed after an account switch, and by the requirement that a private
  Athlete Note stay invisible to the recorder.
- **Stage B0.4 — Free Cloud Data Backbone (implemented and verified).** Provides the stable-ID, idempotent-upload,
  durable-outbox and honest sync-status behaviour §9.2's `local draft → locally completed,
  upload pending → fully synced → partially synced, athlete result blocked` model needs.
  Stage C's own Team-authority revalidation and per-athlete partial-rejection behaviour
  remain Stage C's work.

**Earlier documents that assumed optional identity, or that placed basic cloud backup
behind a paid personal entitlement, are corrected** — see §20 above. Nothing about the
Exercise domain decisions already approved in this specification changes.

## Stage 0 — Product and content approval

- approve this specification;
- verify the restricted source-diagram beta boundary and preserve the wider-release
  rights gate from Section 5.4;
- approve the detailed content and diagrams for the initial-test Exercises in Section 5.6; and
- reconcile canonical glossary and roadmap references.

No production implementation begins before this gate.

## Stage A — Domain and curated content foundation

- define versioned Exercise, Exercise Version, attributed source-image / structured
  Diagram and Measurement Protocol domain contracts;
- define validation and migration/failure behaviour;
- add Release Point, Eight Guards, Progressively Longer and standalone Release Time;
- render their detail and diagrams consistently; and
- prove that no exercise-specific UI conditionals are required.

Independent review must verify version immutability, invalid-content handling,
attribution, restricted source-asset access, accessibility and responsive diagram
behaviour. It must also prove that replacing an attributed source image with a
structured platform diagram creates a new Exercise Version without rewriting history.

## Stage B — Solo execution vertical slice

**Prerequisite:** Stages B0.2-B0.4 above, implemented and independently reviewed.

**Implementation status (2026-08-27):** Implemented through Stage B3. ADR-0028 implements the Solo domain foundation:
execution types, lifecycle transitions, immutable content/protocol snapshots, attempts,
private Athlete Note ownership, strict validation and factual result derivation.
ADR-0029 implements the second internal slice: Technique and Shotmaking executions embed
in the existing Profile-owned Training Session, use its strict current/history repository
and existing Free-cloud `training_session` record, and survive a no-shot Technique archive.
Active work is explicitly abandoned on Session replacement; archived/cloud state must be
terminal. ADR-0030 adds the generic Solo start/record/complete UI. Technique remains
unscored; Shotmaking captures actual handle, 0-4 or an exclusion, private note and the
basic factual result without asking for planned volume. Release Time opens the unchanged
Fixed/Variable/Blind Block-and-Shot runner and stores only an exact Library provenance
snapshot on the Session, never a parallel Measured execution. The three currently curated
Exercises therefore satisfy the Solo vertical slice; Team execution and further content
remain later stages.

- execute one Technique, one Shotmaking and one Measured Exercise;
- capture the athlete's private note, handles, 0–4 scores and supported Measurements;
- preserve standard versus actual configuration;
- produce basic factual results; and
- preserve existing Release Timing history and flows.

Independent review must cover zero scores, variable stone counts, interruption,
excluded-attempt calculations, corrupted persisted data, unsupported diagram elements
and plan/session coexistence. It must also prove that no exercise-specific threshold is
presented as a platform recommendation and that the unstructured evaluation basis is
retained with the result.

## Stage C — Team execution on one device

**Implementation status (2026-08-28): Stages C1-C4c are implemented; Stage C is
complete.** ADR-0031 adds the standalone Team aggregate: confirmed Profile
participants, several athlete-owned result slots, the authenticated active-recorder
snapshot, all five approved simple rotation configurations, actual role-assignment
segments and per-attempt athlete/recorder attribution. Its strict validator rejects
corrupt roster, role, rotation, result and recorder claims together. Private Athlete
Notes are forbidden in this shared recorder aggregate. C1 deliberately introduced no
Session attachment, local storage, upload service, revision/notification workflow or
UI; later ADRs now supply the completed upload, active-draft and capture boundaries,
while Team Release Time still uses the existing timing runner rather than creating a
parallel Measured execution. ADR-0032 implements the real Postgres boundary for explicit
recording permission, immutable completed-Session envelopes, independently retried
athlete-owned bundles, concrete-Session approval and athlete-only private notes. Its
three migrations and 68-test pgTAP suite are executed. ADR-0033 adds the strict
coordination/result serializer, provider-neutral plus Supabase RPC service and schema-v2
extension of the existing Profile-scoped sporting outbox. It durably stores the complete
package before ordered upload and retains pending, blocked, issue and exact-digest
acknowledgement state across reload and account switching. ADR-0034 advances that same
state to schema 3 with a strict latest-known active roster/permission snapshot and adds
the athlete-owned permission control in Team settings. ADR-0035 advances the same record
to schema 4 with one Profile-bound active Team draft and atomically replaces its exact
completion with the immutable Session/bundle outbox. ADR-0036 adds cache-bounded Team
setup and durable one-device Technique/Shotmaking capture with actual role changes,
per-athlete results, optional manual half-step Rotation Count and honest completion sync
truth. ADR-0037 restores the authenticated athlete's accepted bundle and shared context
through the existing RLS boundary, verifies payload hashes/manifests, caches only the
strict Profile-owned projection for offline read, and exposes factual result detail, raw
export and own private-note save/clear in Analyze. ADR-0038 adds durable, append-only
active-session attempt corrections, including athlete/role changes and audited
recorded-by-mistake annulment. Post-completion revisions, ordinary voiding and
participant notifications now have ADR-0039's executed Postgres authority, RLS,
idempotency and notification-emission foundation. C4b adds provider-neutral mutation
contracts, strict owner-only revision-chain projection and schema-6 offline caching.
The athlete-facing mutation and inbox UI is implemented by C4c, completing the Stage C
workflow on top of C4a/C4b's server and client boundaries.

- select several training athletes and supporting participants;
- enforce the athlete's explicit Team recording permission;
- assign and rotate roles;
- attribute each attempt and result to the correct athlete;
- derive recorder identity server-side from the authenticated account's linked `Profile`,
  never from a client-supplied value;
- enforce Session-scoped recording permission;
- prevent the recorder from reading or writing another athlete's private note;
- allow each athlete to add or edit only their own note through their authenticated
  account;
- preserve audited active and post-completion revisions;
- treat ordinary deletion as voiding rather than silent erasure;
- notify only original, still-authorised participants about post-completion changes;
- persist the complete Team Session locally for offline capture and application restart;
- upload Session and per-athlete bundles later with stable IDs and idempotency keys;
- retain and clearly surface pending, partially synced and permission-blocked states;
- revalidate authority per athlete at upload without blocking valid athlete bundles;
  and
- prove that Team coordination does not transfer data ownership.

The server authority and client persistence/upload portions have real database and
application-service verification. Permission control, bounded offline Team capture,
honest completion sync receipts and athlete-owned restore/private notes are exposed in
UI by C2c/C3b/C3c/C3d. C4a adds the server half of post-completion revision, whole-result
voiding and notification emission; C4b adds the strict client projection, provider-
neutral mutations and offline cache. C4c adds the athlete-facing stone correction,
terminal whole-result void and metadata-only Team inbox UI, completing Stage C.
TypeScript mocks alone remain insufficient evidence for any new cloud-authority change.

Independent review must additionally verify that completion prevents silent overwrite,
that before-and-after values follow current data grants, that private Athlete Notes
remain invisible despite Team or coaching access, and that non-participants, later
joiners and former members do not receive change notifications. Offline verification
must cover reload, storage failure, interrupted and repeated upload, lost acknowledgement,
account switch, stale cached permission, partial athlete rejection and exact deduplication
of every accepted child record and emitted notification.

## Stage D — Generalised simple Training Plans

**Implementation status (2026-08-28): Implemented for Profile-owned plans.** ADR-0040
generalises the persisted step union and lazy runtime reference, retains the existing
Release Time runner, and composes Technique/Shotmaking through the embedded Solo
Exercise Execution. Exact Exercise Version snapshots survive plan edits and catalog
updates. Team-plan execution is a preserved future execution context; it is not part of
the initial test implementation.

- extend the existing discriminated Training Plan step model with curated Exercise
  steps;
- preserve lazy execution and snapshot integrity where still appropriate;
- support a mixed sequence of Technique, Shotmaking and Measured Exercises; and
- keep scheduling, assignment and plan sharing out of scope.

Independent review must verify that plan edits and newer Exercise Versions never alter
started or completed history.

## Stage E — Initial-test content expansion and release hardening

- add the remaining four approved initial-test Exercises from Section 5.6;
- validate every instruction, source diagram and attribution inside the restricted
  beta boundary;
- verify generic 0–4 capture without hidden exercise-specific thresholds;
- test essential Library filters and mobile execution;
- review all coaching and result copy for unsupported claims;
- test recovery from interruption and malformed content; and
- reconcile architecture, glossary, roadmap and current-implementation documentation.

Only after every required stage has its own evidence should Version 1 be described as
implemented.

---

# 22. Success criteria

Version 1 is successful when:

- an athlete can quickly find and understand a relevant standard Exercise;
- the same Exercise can be performed alone or in an allowed Team context;
- each delivering athlete receives the correct individual attempts and result;
- role rotation and Sweeper context do not corrupt attribution;
- each athlete can retain a private Exercise note without exposing it to the recorder,
  other participants or a Team data-sharing grant;
- completed result changes remain attributable, visible and correctly notified without
  disclosing values to unauthorised recipients;
- an offline one-device Team Session survives restart and later uploads without silent
  loss, cross-account disclosure or duplicate records;
- Technique guidance remains useful without pretending the application can diagnose
  technique;
- Shotmaking scoring is fast, mathematically correct and faithful to curling's 0–4
  language;
- beta Shotmaking results are visibly identified as self-/Team-assessed and never
  presented as exercise-standardised or cross-Team comparable;
- Measured Exercises stand alone and Measurements can also augment other Exercises;
- a simple Training Plan can mix the supported Exercise focuses;
- completed history remains tied to immutable content and actual execution context; and
- deferred authoring, sensors, analytics and collaboration capabilities can be added
  through the preserved extension seams rather than a rewrite of Version 1 history.
