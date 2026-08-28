# ADR-0031: Team Exercise Execution Domain Foundation

**Status:** Accepted and implemented as Exercise Stage C1 (2026-08-28). ADR-0032-0039
now implement server authority, outbox/eligibility/draft persistence and one-device Team
capture, owned reads/private notes, active attempt corrections and C4a/C4b's post-
completion authority/projection. C4c now completes the athlete mutation/inbox UI.

## Context

ADR-0028 through ADR-0030 implement one-athlete Technique and Shotmaking execution
inside the existing Profile-owned Training Session. Stage C must add several training
athletes, supporting participants, role rotation and one authenticated recorder without
turning a Team into the owner of athlete results or exposing private Athlete Notes on a
shared recorder device.

The complete Team feature also needs new cloud authority: explicit Team recording
permission, a shared coordination envelope, athlete-owned result bundles, per-athlete
partial rejection, audited revisions and notifications. Those behaviours cannot be
proved by a TypeScript aggregate. They require a separately reviewed persistence/upload
design plus real Postgres, RLS and transaction execution.

## Decision

Stage C begins with a standalone Team execution aggregate in `src/lib/exercises/`.
`ExerciseExecution.teamContext` is an additive optional field: absence remains the
byte-compatible Solo shape; presence snapshots the Team id, active recorder Profile,
confirmed Profile roster, training-versus-supporting participation and one of the five
approved simple rotation configurations.

One `AthleteExerciseResult` exists for every selected training athlete. Actual role
truth is an ordered series of immutable assignment segments. Each segment names the
delivering athlete, known Sweepers, optional Skip, observer, Coaches and timekeeper,
whether sweeping was used, the recorder and the transition reason. Planned rotation is
only an interface recommendation. A new segment is created for an actual lineup change;
attempts always reference the segment active when recorded.

Team Shotmaking attempts retain separate athlete ownership and recorder provenance.
The recorder is fixed to the authenticated Profile snapshotted for this one-device
execution; callers cannot substitute another participant. Attempt sequence is per
athlete, while rink chronology is derived from stable timestamps and ids. Deliberate
departures from standard Sweeper, sweeping and required-role guidance remain explicit
configuration deviations instead of being blocked.

The persisted validator treats the aggregate as untrusted. It verifies catalog
snapshots, roster/result cardinality, role membership, recorder attribution, globally
unique ids, chronological segments, planned automatic-rotation claims, per-athlete
attempt sequence and required deviations together, returning every detected issue.

Private Athlete Notes are forbidden in this shared Team aggregate. They will live only
in the affected athlete's authenticated, athlete-owned bundle. The recorder therefore
cannot read or write another athlete's note merely because it holds the Team execution.

C1 does not attach Team execution to the existing Profile-owned Solo Session, serialize
it as a `training_session`, add a storage key, call Supabase or expose Team start UI.
Those boundaries fail closed. Team Release Time also remains on the existing
Block/Shot runner and may not create a parallel Measured execution.

## Consequences

- Several athlete results, roster identities and actual role rotation now have a tested
  domain representation without weakening Solo history.
- The later recorder UI can use rotation recommendations while persisting actual role
  changes rather than inferred choreography.
- Cached eligibility and client recorder fields are not mistaken for cloud authority;
  ADR-0032 now supplies the separately reviewed permission and upload boundary against a
  real database without changing this aggregate.
- C1 is not athlete-usable and does not make Stage C complete or release-ready.
