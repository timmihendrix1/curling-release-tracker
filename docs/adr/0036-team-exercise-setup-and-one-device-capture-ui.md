# ADR-0036 — Team Exercise setup and one-device capture UI

**Status:** Accepted and implemented as Exercise Stage C3b (2026-08-28). Since then,
ADR-0037 implements Team-result restore/read and private-note UI; ADR-0038 implements
audited active-attempt correction/annulment. Post-completion revision/voiding and
participant notifications remain later Stage C work.

## Context

ADR-0031 defines the Team execution aggregate and its transitions. ADR-0034 caches the
last server-observed roster and prospective recording permissions for an offline-capable
start. ADR-0035 persists one recorder-owned active draft and atomically hands an exact
completion to ADR-0033's outbox. Those boundaries were not yet reachable from the rink
UI. Shotmaking also needs the already-approved manual Rotation Count input, including
half rotations, without mutating the existing Guard Exercise Version.

## Decision 1 — generic Solo and Team entry from one Exercise detail

Technique and Shotmaking details retain the existing Solo action and add a distinct
`Set Up Team Exercise` action. The Team action is gated by Profile-scoped sporting
persistence readiness, not by Training Plan readiness. A Measured Exercise never opens a
parallel Team execution: Release Time still enters the unchanged Fixed/Variable/Blind
timing runner for both individual and Team use.

The components branch only on declared domain semantics such as primary focus and
guidance kind. No Exercise id or title selects capture behaviour.

## Decision 2 — cache-bounded setup and authenticated recorder

Team setup offers only cached Team snapshots containing the signed-in Profile. When no
such snapshot exists, setup fails closed and instructs the athlete to refresh Team
settings online; it never guesses a roster. The signed-in Profile is included as a
present supporting participant and becomes the active recorder automatically. There is
no Recorder selector.

The recorder confirms who is present, chooses one or more eligible training athletes,
records the initial deliverer and zero to two Sweepers, optional supporting roles,
actual sweeping use, a variation and one of the five C1 rotation plans. Only a cached
active player with prospective recording permission can receive an Athlete Exercise
Result. No planned volume is requested. Upload still revalidates every athlete against
server authority, so cached eligibility is availability evidence, not permission
authority.

## Decision 3 — durable-first capture and actual role truth

Setup becomes an active screen only after ADR-0035 durably saves the created aggregate.
Every recorded attempt and role change likewise goes through its C1 transition and is
shown only after the updated draft is durably saved. After a reload, returning to Train
resumes that saved draft; the platform's existing default route remains Home.
Failure leaves the previous durable draft as truth. Discard requires explicit
confirmation and targets only the active draft.

The capture screen shows the actual current lineup and recorder. Automatic rotation
plans produce a recommendation that the recorder applies as a new role-assignment
segment; after-series and manual changes are explicit. Planned rotation never rewrites
history. Technique remains instruction and observation only, with no score or shared
note field.

## Decision 4 — Shotmaking capture and Rotation Count

Each Team Shotmaking stone is attributed to the actual delivering athlete and active
recorder and stores actual handle plus either a 0–4 Team-assessed outcome or a named
exclusion. Live results are factual per-athlete averages, points, maximum points and
excluded counts; no Swiss source goal or platform rubric becomes a score threshold.

The curated catalog adds `Rotation Count` protocol version 1: manual source, rotations
unit, no target or tolerance, and values in positive 0.5 increments. `Eight Guards,
Progressively Longer` Version 1 remains byte-for-byte unchanged. Version 2 becomes
current and adds the optional protocol reference. Solo and Team Shotmaking automatically
enable this compatible protocol, while each stone may omit the value. If supplied, the
recorder may identify which present participant counted it. Release-time protocols keep
their required Measurement Mode and seconds unit; Rotation Count has no release-time
mode and must use rotations.

## Decision 5 — exact completion and honest sync receipt

Completion uses the C1 terminal transition and ADR-0035's exact atomic
draft-to-outbox finaliser. The UI then reports the manager's real per-Session state:
fully synced, partially blocked, issue, or saved on device and pending. It does not claim
that completion implies cloud acceptance.

## Consequences and non-goals

- Several authenticated athletes can receive individual results in one one-device Team
  Session; supporting participants receive none.
- Capture works from cached eligibility and a saved draft while offline, then uploads
  through the existing partial-acceptance boundary when possible.
- The recorder aggregate contains no private Athlete Note. Athlete-owned note/read UI is
  not smuggled into this stage.
- This stage adds no database migration, RPC, storage key, Exercise-specific renderer,
  Team Measured execution or second timing path.
- Since implemented by ADR-0037/0038: result restore/read, own private-note UI and active
  correction audit. Post-completion revision/voiding, notifications and multi-device
  recorder transfer remain later decisions/work.

## Verification

Domain tests cover catalog immutability/versioning, protocol semantics, half-rotation
acceptance and finer-increment rejection at transition and persisted-validation
boundaries. Component tests cover cache-bounded setup, recorder binding, athlete
eligibility, absence of planned volume, durable-save failure, Technique observation,
Shotmaking attribution/evaluation/Rotation Count, rotation, exact completion, explicit
discard, generic detail entry and independent action gating. The full TypeScript, lint,
unit, build and UI E2E suites remain the completion gate.
