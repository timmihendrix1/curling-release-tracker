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

**Athlete is a capability attached to a Profile, not an authentication role.**

**[Implemented — Stage B0.2.]** Completed *personal* onboarding establishes Athlete
capability together with the default Free **Entitlement**. No Team Foundation RPC and
no bare **Profile** creation path creates one (`docs/adr/0022` Decision 10; ADR-0025).

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

## UserAccount

The **authentication identity** used to sign in. It answers *who is acting*, and nothing
else — it is never the sporting identity, never an ownership key, and never itself a paid
product.

**[Implemented — Stage B0.2.]** A Supabase Auth account, reachable only as an
`AccountIdentity` (an id and an email) past `src/lib/supabase/authService.ts`'s boundary.
A UserAccount plus a completed personal **Profile** is required to reach the authenticated
application. Deliberately public marketing material stays public. Closed-test sign-in
methods are six-digit email OTP and Google sign-in; magic links, passwords and Apple
sign-in stay deferred.

Distinct from **Profile**: one UserAccount is linked 1:1 to one Profile, and the two ids
are never the same value. Never use a UserAccount id as an ownership or scope key.

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

**[Implemented through Stage B0.4 —
`docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md` §2/§4,
ADR-0024/0026/0027.]** The Profile is the platform-wide, mandatory sporting and ownership
identity. Athlete-owned local persistence and recorder/actor attribution are
Profile-scoped (`Profile.id`, never the authentication-provider user id); the Free Cloud
terminal sporting-record authority uses that same scope. This closes `docs/adr/0020`'s former `account_scope_id`
question as **Profile scope, not account scope**, without making ADR-0020 itself the
forward implementation path.

---

## Entitlement

**[Default Free entitlement and application integration implemented in B0.2; paid lifecycles planned —
`docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md` §6.]** The active
commercial tier or capability set for a Profile or a Team Workspace. **An entitlement is
not inherently paid:** it covers both the **default Free entitlement** and any
**additional paid entitlement** (the paid personal tier, Team Workspace, later Coaching).
Free is a genuine entitlement even though nothing is paid for it.

B0.2 implements the default-Free entitlement schema and onboarding transaction; the
mounted global gate validates and consumes that fact before the sporting app opens. No
paid entitlement or billing lifecycle is implemented.

**The default Free entitlement is granted by completed personal onboarding** — never by
authentication or Profile creation alone (see **UserAccount**, **Profile**, and
`docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md` §3.4). A **paid**
capability additionally requires the relevant **paid** entitlement to be active,
alongside the applicable domain permission.

An entitlement is **not** an identity, **not** a **Profile**, **not** a permission, and
**not** a **Team Function** — all of these, plus data ownership, remain separate concepts.
An entitlement never transfers ownership of athlete data, payment never transfers
ownership, and a lapsed *paid* entitlement never withdraws the **Free Cloud Core** for data
already recorded.

Named layers: **Free** (the default, granted on **completed** personal onboarding, never
merely because a Profile exists — includes the Free
Cloud Core), the **paid personal tier** (derived analysis; **its final commercial name is
undecided** — `Personal Athlete` is a working label only), **Team Workspace**, and the
deferred **Coaching** module. The closed beta uses reversible **pilot** entitlements and
collects no payment.

---

## Free Cloud Core

**[Implemented for current executable domains —
`docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md` §6.1 and ADR-0027.]** The set of structured raw sporting
and training data that is persisted in the cloud for **every Profile holding the Free
entitlement — that is, every Profile that has completed personal onboarding** — regardless
of any *paid* entitlement, because it is what is needed to reconstruct the athlete's
history and compute future analytics — Training Sessions, Training Blocks, Shots,
Assessment Runs and Attempts, Exercise Executions and Attempts, athlete assignment and
ownership references, Handle and Shotmaking 0–4 evaluations, "do not score" and
void/revision facts, Release Time and Rotation Count measurements, the configuration and
immutable version snapshots needed to interpret results, private Athlete Notes, and the
provenance/audit records needed to preserve factual history.

**No date cutoff may be imposed on it**, and it includes **basic restore** after signing in
on a new device. It excludes large or operationally expensive artifacts (video,
high-frequency sensor streams, large coordinate traces, AI output), which may carry their
own limits later, and it excludes derived projections and cached aggregates, which are not
the canonical record and may be recomputed.

**Signing in is required but not sufficient.** The Free entitlement is granted by
**completed personal onboarding**, never by authentication or Profile creation alone (see
**Entitlement** above and `docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md`
§3.4). A Profile that is merely resolved or signed in holds no entitlement and no Free
Cloud Core. The former Team-specific bootstrap route is retired; completed personal
onboarding is the only browser-accessible completion path.

Do not use this term for the paid personal tier's derived analysis, and do not describe
basic restore as cross-device continuation (see **Sync Status**).

---

## Identity Gate

**[Implemented — Stage B0.2,
`docs/adr/0025-application-identity-gate-onboarding-completion-and-trusted-device-state.md`.
The application-level provider mounts the sporting shell only after a reducer-accepted
ready verdict. ADR-0026's implemented B0.3 boundary then mounts only that Profile's
sporting repositories.]**
The blocking boundary that must be passed before any authenticated application surface — including all
training, Assessment and Analyze functionality — is reachable. Passing it requires an authenticated
**UserAccount**, a resolved **Profile**, a completed personal onboarding, **Athlete** capability and the
default **Free** entitlement, all derived from server-authoritative facts rather than a stored flag.

Distinct from **authentication**: signing in is necessary but never sufficient. A Profile that has been
resolved but has not completed onboarding does not pass the gate.

---

## Identity Access Barrier

**[Implemented and integrated — Stage B0.2, `docs/adr/0025`.]** A durable, local,
deny-by-default record.
While an **unresolved** barrier exists, the authenticated application is blocked. **The two transition
categories write it at different points:**

- a **deliberate user transition** — signing in with either method, locked-screen recovery, explicit
  sign-out or invitation account recovery — writes it **before** that transition's provider call,
  navigation or persistent local mutation;
- a **server-driven invalidation**, which no person initiates and which is therefore not a deliberate
  transition, begins with **immediate in-memory denial**; the barrier is then **attempted** as the
  first *durable* denial mechanism, and if that attempt fails, **trusted-record removal is attempted as
  the fallback**.

It exists because the authentication provider persists a session and announces it *before* the calling
code can judge whether the transition it belongs to actually succeeded; the barrier is the durable
denial that makes that ordering safe. **A barrier is never deleted as a security transition** — it is
superseded by writing a newer one, and completed by a separate **Identity Barrier Resolution**.
If a grant-bearing write completes after its same-page operation lost ownership, a fresh unresolved
barrier with origin `unconfirmed_grant_fence` retracts that stale grant before another effect section
runs; this origin is durable history, never a distinct permission.

Distinct from a provider sign-out: provider sign-out is attempted last and may fail without weakening
the denial.

---

## Identity Barrier Resolution

**[Implemented and integrated — Stage B0.2, `docs/adr/0025`.]** The local record proving that one exact
**Identity Access Barrier** was completed by one exact **Interactive Authentication Attempt**. It is
stored under a key derived from that barrier's own identifier, so writing one can never resolve or
remove a different barrier.

**A resolution grants nothing on its own.** It establishes only that this barrier was completed; the
restored session, Profile, onboarding, entitlement, trusted state and account scope are all still
checked. A resolution belonging to an older barrier binds nothing.

---

## Interactive Authentication Attempt

**[Implemented and integrated — Stage B0.2, `docs/adr/0025`.]** The local record of one deliberately
started authentication, bound to the **Identity Access Barrier** written for it and, for the redirect
provider, to the exact provider flow it created. It is what lets a full-page return be recognised as a
genuine continuation of *this* attempt rather than a stale or unrelated one.

Distinct from a provider session: an attempt records that a user deliberately began authenticating, not
that they are authenticated.

---

## Trusted Device Record

**[Implemented and integrated — Stage B0.2, `docs/adr/0025`.]** The local record establishing that this
device previously completed authentication and onboarding for one account scope, written **only** from
a successful server-authoritative result. It is what makes offline entry possible for a previously
onboarded Profile, and it is keyed to the account scope — a record belonging to a different account can
never grant access, online or offline.

It holds **no** session, token, verifier or one-time code.

**Its removal is attempted, never assumed — and three different situations remove it for three
different reasons, under three different protocols.** They must not be treated as one rule.

**A. Explicit sign-out and invitation account recovery.** A fresh unresolved **Identity Access Barrier**
is established **before** the required removal of this record. **If the removal fails, the application
stays locked and provider sign-out is not called** — the already-written barrier remains authoritative,
so a failed removal never leaves a usable grant behind.

**B. Server-driven invalidation.** Access is denied **in memory first**; only then is the invalidation
barrier attempted, and only after it succeeds is this record removed. **If the barrier write fails,
removal is attempted as the fallback durable denial.** If **both** fail, access is denied for that page
lifetime and the situation is reported honestly — **no durable offline revocation is claimed**.

**C. Explicitly correlated account replacement** (ADR-0025 Case A). **This is not an invalidation and
writes no new invalidation barrier.** The provider authentication and its correlation may already have
succeeded; what remains is that this record still belongs to the *previous* account. **The old
account's record is never honoured for the new identity**, and **no ready state is entered until the new
account's record is durably established or replaced**. A failure to write it yields
`trusted_state_not_established` — server success does not substitute for it, and **a completed,
resolved correlation set alone grants no access**.

**Browser storage is not a security boundary.** A person able to alter it can forge this record. B0.3
now limits the sporting application to the Profile namespace named by the mounted identity, but it
cannot protect against someone already controlling local storage on the device; forging local state
still grants **no** server-side authority. See **Profile-Scoped Local Data** and ADR-0026.

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

**[Implemented — ADR-0021 and ADR-0027.]** The persistence domain owning **the current
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
from Assessment History and persisted under its own Profile-scoped local key.

## Assessment History

**[Implemented — ADR-0021 and ADR-0027.]** The persistence domain owning terminal
(`completed`/`incomplete`) Assessment Runs under its own Profile-scoped local key. The only Assessment
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

## Profile-Scoped Local Data

**[Implemented — Stage B0.3; ADR-0026.]** Local persistence isolated to one **Profile**. Once a
device has completed authentication and Profile onboarding, its trusted Profile-scoped
local state is what makes fully offline training possible; **explicit sign-out or account
switching immediately hides and locks the previous Profile's local data**, including any
record still pending upload.

A device with no previously established trusted Profile **may reach the public,
sign-in and onboarding surfaces while online** — that is how it becomes trusted — but
**cannot reach any authenticated training or application surface** until authentication and
Profile onboarding complete, and **cannot bypass that gate by going offline**. Public
marketing material sits outside the authenticated-app gate entirely.

**Implementation:** one immutable adapter namespace is bound to canonical application
`Profile.id` and composes all seven existing sporting repositories without changing their
domain APIs. The React boundary is keyed by Profile and remounts the sporting application on
account change. The ten former unscoped early-test keys are removed content-blind behind a
one-time completion marker before sporting repositories mount; they are never adopted or
assigned (see **Local Adoption** below and ADR-0026).

No fixed expiry period for trusted local state is decided. Do not invent one.

## Outbox

**[Implemented for terminal Training Sessions and Assessment Runs — Stage B0.4,
ADR-0027.]** The durable, Profile-scoped
local queue of records created offline and not yet acknowledged by the server. Every record
receives a **stable client-generated ID before upload**; upload is automatic on reconnect
and **idempotent**, so a retry converges on one cloud record per stable ID rather than
duplicating sporting data. Before uploading, the client revalidates server authority and
**fails closed** if authorization is no longer valid. A pending record from one Profile is
never visible or uploaded under another Profile.

The implemented queue stores the exact serialized payload and digest for desired-present
records together with desired presence/deletion and `pending`/`synced`/`issue` state. A
deletion drops its queued payload immediately and retains only the digest and identity
needed for the server tombstone. Exercise execution will extend this
backbone when its own terminal record exists; it must not introduce a parallel queue.

## Sync Status

**[Implemented — Stage B0.4, ADR-0027.]** The user-visible aggregate truth about where the
Profile's supported terminal sporting records actually exist. Three states are distinguished:

- **Saved on this device** — durable locally, not yet acknowledged by the server;
- **Synced** — the server has acknowledged it;
- **Sync issue** — the upload failed or is uncertain; the local record is preserved and the
  attempt remains retryable.

**A record is never described as cloud-backed or synced before the server acknowledges
it** — an observation/interpretation boundary as much as an engineering one (see
`docs/UX_WRITING_GUIDELINES.md`'s "Separate Facts from Interpretation").

**Basic restore** — recovering an athlete's history after signing in on a new device — is
part of the **Free Cloud Core**. It is *not* cross-device continuation: continuing the same
in-progress Session on another device, concurrent multi-device editing, and transferring an
unsynced Session elsewhere are all deferred and must never be described as available.

## Local Adoption

**[Superseded as the forward path by `docs/adr/0024-mandatory-identity-and-free-structured-cloud-foundation.md`
(Accepted). Retained here as a definition of a historical proposed design — Proposed,
incomplete, never implemented: `docs/adr/0019-cloud-identity-and-data-authority-transition.md`.]**

**Why it is superseded:** Local Adoption exists to reconcile pre-existing *anonymous* local
data with a later account. Identity is now mandatory, and the existing unscoped local data
is disposable early-test data that Stage B0.3 discards once, safely and explicitly —
**there is no adoption, claim, import, merge or per-session migration flow for it.** Do not
build against this entry, and do not describe legacy local data as requiring adoption. The
one conclusion of ADR-0019 that survives independently of the accountless premise is its
Decision 8 non-participating-old-build hazard, which remains real for any future
local-authority transition.

The historical design it named: the explicit, **one-time** protocol that uploads a device's
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

## Exercise

A stable Library identity for one deliberate-practice activity (`{ id, currentVersionId }`,
`src/lib/exercises/types.ts`). The identity survives content revisions; user-facing
instructions, diagrams, defaults and provenance live in an immutable **Exercise
Version**. Version 1 exposes only platform-curated Standard Exercises. Athlete-, Team-
and Community-authored Exercises are deferred.
**[Implemented — identity and lookup; three curated Exercises. ADR-0028/0029 add the
Solo execution and Session-persistence foundations; ADR-0030 adds athlete-facing Solo
start and recording. See `docs/SYSTEM_ARCHITECTURE.md`'s "Exercise Library" section.]**

## Exercise Version

One immutable, attributable version of an Exercise's sporting meaning and presentation:
classification, goal, purpose, setup, instructions, observation or evaluation guidance,
volume, variations, participant and sweeping requirements, compatible Measurement
Protocols and Diagram. A meaningful correction creates a new version; completed
executions keep their original version snapshot.
**[Implemented — immutable versioned content, recursively frozen at runtime, resolvable
forever by its own Version id. ADR-0028 snapshots it into executions and ADR-0029 retains
those snapshots inside persisted Training Sessions.]**

## Primary Exercise Focus

The one dimension that determines an Exercise's main training and execution experience:
**Technique**, **Shotmaking**, or **Measured**. It is independent of Shot Family and
Training Purpose. `Consistency` is a Training Purpose, not a fourth focus.
**[Implemented — all three values drive Library discovery, detail and the B3 execution
entry. Technique and Shotmaking use their focus-specific Solo UI; Measured Release Time
opens the existing timing runner. Validation prevents incompatible guidance.]**

## Shot Family

The curling task an Exercise trains — guard, draw, freeze, tap, take-out, soft take-out
or sequence — independent of Primary Exercise Focus, and absent on an Exercise where it
does not apply. A Draw may be either Shotmaking- or Measured-focused.
**[Implemented — declared per Exercise Version, filterable, and offered as a filter only
where some Exercise actually declares one.]**

## Training Purpose

What capability an Exercise is intended to develop (repeatability, weight control, line
control, handle control, release-location control, rotation control, progressive
distance control, setup discipline, consistency). An Exercise names one primary purpose
plus optional additional ones. `Consistency` lives here, never as an Exercise focus.
**[Implemented — declared and displayed per Exercise Version; discovery beyond text
search and using it for recommendations is Planned.]**

## Exercise Diagram

Instructional content explaining setup, intended path, target or sequence. The domain
distinguishes a restricted, attributed source image from a versioned structured
platform diagram in normalised Ice Sheet coordinates. It is not captured position data
and does not itself perform automatic scoring.
**[Implemented — both variants are modelled and validated; the structured variant has a
generic responsive SVG renderer (`normalized-ice-sheet-v1`), and unsupported content
fails visibly rather than disappearing. No editor, animation, actual positions or
sensor overlay exists (Planned). No restricted source asset is bundled — see ADR-0023.]**

## Restricted Source Asset

A source image the platform may show only to an explicitly permitted audience. It is
named by an **opaque asset reference** — never a URL or public path — and is renderable
only through an explicitly injected authorized resolver. Every uncertain path fails
closed, including a resolver that throws, and attribution/provenance stay visible either
way.
**[Implemented — boundary only. No restricted asset and no authorized resolver exist in
this repository. See `docs/adr/0023-restricted-source-asset-delivery-boundary.md`.]**

## Measurement Protocol

A reusable definition of what is measured, in which unit, between which reference
points, by which allowed sources and under which validation rules. It can define a
standalone Measured Exercise or be attached compatibly to another Exercise; a protocol
is not duplicated inside every Exercise definition.
**[Implemented — two versioned release-time protocols reuse the existing Measurement
Mode semantics, and one manual Rotation Count protocol uses the rotations unit with no
release-time mode. None prescribes a target or tolerance or claims hardware capture.
Rotation Count accepts positive full or half rotations and is optionally referenced by
Eight Guards Version 2. Solo and Team Shotmaking can snapshot and retain it; Library
Release Time still opens the existing Block/Shot runner and retains only its exact
Exercise Version as Session provenance.]**

## Exercise Catalog Package

The versioned curated content package the Library is delivered in: a package schema
version, a content language, the Exercises, their Exercise Versions and the Measurement
Protocols they reference. Compiled with the application, recursively frozen, and
validated once at import — invalid content fails fast rather than rendering.
**[Implemented. It stores nothing: a future package schema change requires an explicit
loader or migration, never a guessed upgrade.]**

## Exercise Execution

One actual performance of one Exercise Version inside a Training Session. It snapshots
selected variation, volume, Measurements, participants, roles, sweeping and deviations,
then owns the athlete-associated results and attempts. Version 1 permits one active
Exercise Execution at a time. **[Implemented for Solo Technique and Shotmaking — ADR-0028
provides the aggregate, ADR-0029 embeds it in Profile-owned Session persistence, and
ADR-0030 supplies the generic rink UI. ADR-0031 adds standalone Team cardinality,
participant/recorder context and role rotation as Stage C1. ADR-0032 adds the
server-authoritative completed-Session/bundle boundary as Stage C2a; ADR-0033 adds its
Profile-scoped durable serializer/outbox/upload bridge as Stage C2b; ADR-0034 adds the
Profile-scoped offline eligibility snapshot and athlete-owned permission UI as Stage C2c;
ADR-0035 adds one reload-safe Profile-bound active Team draft and atomic completion
handoff as Stage C3a. ADR-0036 adds cache-bounded Team setup and durable one-device
Technique/Shotmaking capture as Stage C3b. ADR-0037 adds athlete-owned result restore,
verified offline caching, factual Analyze detail/raw export and own private-note UI as
Stage C3c. ADR-0038 adds append-only active-attempt correction/annulment, durable rink
UI and affected-athlete-only correction restore as Stage C3d. Measured Release Time intentionally uses the existing Block/Shot runner
with immutable Library provenance rather than a parallel `ExerciseExecution`.]**

## Exercise Role Assignment Segment

One immutable stretch of actual Team lineup inside an Exercise Execution: delivering
athlete, known Sweepers, optional Skip, observer, Coaches and timekeeper, actual sweeping
use, active recorder and the transition reason. Attempts reference the segment active
when recorded. Planned rotation is never substituted for this historical truth.
**[Implemented in the Stage C1 Team domain, persisted as part of ADR-0035's active Team
draft and shown/changed by ADR-0036's Team capture UI.]**

## Active Team Attempt Correction

An append-only correction made by the authenticated active recorder before Team Session
completion. It retains the exact Shotmaking attempt before and after, actor and time;
the current Athlete Result uses the latest non-annulled value. Athlete, handle,
evaluation, supported Measurement and the stone's effective role/Sweeper context may be
corrected without rewriting the original role segment. No typed reason or participant
notification is required while the Session is active. **[Implemented by ADR-0038 under
Exercise Execution schema 2. After completion, only affected athletes receive this
history through their owned bundle.]**

## Recorded-by-Mistake Annulment

The active-capture correction for a stone that was entered but did not belong in the
current result. It removes that attempt from calculations and completion eligibility
without erasing its original facts or provenance. It is distinct from post-completion
ordinary voiding and from legal/privacy erasure. **[Implemented by ADR-0038; confirmed
in the rink UI and retained in the affected athlete's audit.]**

## Exercise Rotation Configuration

The planned athlete order and one of five Version 1 behaviours: fixed roles, change
after every stone, change after a configured stone count, change after one complete
series, or manual change. It assists recording but never rewrites actual role segments.
**[Implemented in the standalone Stage C1 Team domain. Automatic stone-based changes
are recommendations until the recorder applies them as a new actual segment; series
completion and manual changes are explicit in ADR-0036's UI. ADR-0035 persists the
configuration and its recorded segments inside the active Team draft.]**

## Athlete Exercise Result

The athlete-owned result within an Exercise Execution. Several athletes may receive
individual results in the same Team Session. It may contain attempts, Measurements and
one private Athlete Note; recorder, device and Team do not become its owner. **[Implemented
for the one-athlete Stage B flow and for multiple result slots in the standalone Stage
C1 Team domain. A private note is intentionally forbidden in the shared recorder
aggregate. ADR-0032 stores Team private notes only through an athlete-authenticated SQL
boundary and cloud-persists immutable athlete-owned bundles; ADR-0033 supplies their
recorder-side upload queue, ADR-0035 persists the in-progress non-private results, and
ADR-0036 captures and displays live factual results per athlete. Athlete-owned cloud
restore/read, owned raw export and private-note UI are implemented by ADR-0037; sibling
results and notes remain outside the projection.]**

## Team Exercise Recording Permission

An explicit prospective permission from one athlete to one Team to record that athlete's
individual results in shared Training Sessions. It is separate from Membership,
entitlement and every lasting data-sharing grant. Revocation affects future authority and
does not erase accepted history; an affected athlete may instead approve one concrete
already-confirmed Session. **[Implemented server-side in Stage C2a — historical grant
periods, athlete-owned grant/revoke RPC, active-Team eligibility visibility and
per-bundle revalidation. ADR-0034 implements the self-service Team UI and a strict,
Profile-scoped latest-known eligibility cache; cached state never replaces upload-time authority.]**

## Team Exercise Session Envelope

The immutable shared coordination record for one completed Team Training Session:
Team, server-derived recorder provenance, timestamps, confirmed participant kinds,
Exercise Execution stable IDs and non-private coordination payload. It owns no athlete's
performance result and participation alone grants no historical read. **[Implemented
server-side in Stage C2a with exact TEXT payload, digest, relational manifest,
stable-ID idempotence and owner-result-gated RLS. Local serialization/outbox wiring is
implemented by ADR-0033 with an exact-digest upload receipt.]**

## Team Exercise Athlete Bundle

One immutable cloud record containing one training athlete's results for a completed
Team Session. It is owned by that athlete, retains server-derived recorder provenance,
and retries independently so another athlete's missing authority cannot roll it back.
Its private notes are stored separately and writable only by the authenticated athlete.
**[Implemented server-side in Stage C2a, including result/execution stable references,
partial rejection, concrete-Session approval and private-note RLS. The TypeScript upload
service and durable local queue integration are implemented by ADR-0033, including
independently retained pending, synced, blocked and issue outcomes. ADR-0037 adds the
athlete-authenticated read projection and own private-note surface. ADR-0038's cloud
payload schema 2 additionally carries only correction events affecting that bundle's
athlete; schema 1 remains readable.]**

## Owned Team Exercise Result Projection

The mounted athlete's verified read model for one accepted Team Exercise bundle. It
combines immutable shared Session/execution context with exactly that athlete's result
and optional private note; it never contains a sibling Athlete Result collection. The
projection is rebuilt from owner-result-gated relational manifests plus hash-verified
opaque payloads, cached only in the same immutable Profile namespace and exported from
that same bounded shape. Its active-session correction history is likewise filtered to
events whose before or after owner is the mounted athlete. **[Implemented by ADR-0037
and extended by ADR-0038 in `teamExerciseRecords.ts`, schema 5 of the sporting sync
record and Analyze → Exercises.]**

## Shotmaking Evaluation Basis

The provenance for a Shotmaking attempt's 0–4 outcome meaning. The closed beta records
generic Team/self-assessed values without a platform rubric, so results are not assumed
comparable across Teams. Future recommended or Team-adjusted rubrics require versioned
snapshots and never reinterpret history. **[Implemented for Solo and Team execution: the
curated Version and `ExerciseExecution` retain `team-defined-unstructured`; ADR-0036
shows the same generic 0–4 Team-assessed scale and no standardised rubric or cross-Team
comparison exists.]**

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
