# ADR-0029: Exercise Executions Embed in the Existing Training Session

**Status:** Accepted and implemented as Exercise Stage B2 (2026-08-27). ADR-0030 now
implements the athlete-facing Stage B3 UI on top of this boundary.

## Context

ADR-0028 created a strict Solo Exercise Execution aggregate without choosing its
persistence authority. Creating a separate Exercise repository or cloud record would
make one rink training session span two independently archived and synchronized roots.
It would also duplicate the Profile-scoped local and Free-cloud infrastructure already
owned by Training Sessions.

Release Time is a separate constraint: its Library description must open the existing
Fixed, Variable and Blind Weight functionality. A second Measured runner would split the
same sporting facts between `Shot` and `ExerciseAttempt`.

## Decision

A Technique or Shotmaking `ExerciseExecution` is an optional child of the existing
Profile-owned `Session`. `Session.exerciseExecutions` retains every sequential execution;
`activeExerciseExecutionId` names the sole in-progress one. Both fields are absent on
legacy and Release-Time-only Sessions, so their persisted wire shape is unchanged.

The integration has one strict boundary. Each child must pass ADR-0028 validation,
belong to the containing Session, use globally unique entity IDs, and agree with the
single active pointer. Current Session storage may contain one active execution. Session
History accepts terminal Exercise state only. Invalid Exercise state fails repository
loads and writes closed; migration never guesses or partially repairs it.

No eighth sporting key or Exercise repository is added. The existing current/history
Session keys, Profile-scoped adapter and history-first `archiveAndReplace` transition are
reused. A Session containing an Exercise is archivable even when it has no release-timing
Shots. Starting a new Session abandons an interrupted active Exercise before archiving,
so it is retained as an explicit terminal fact rather than discarded or uploaded as
in-progress work.

The existing `training_session` Free-cloud record carries the complete embedded state.
Serialization and restore validate it strictly and reject active or corrupt Exercise
state. There is no new cloud record kind or synchronization engine.

B2 deliberately does not persist a `measured` Exercise Execution. Standalone Release
Time remains on the existing Training Block and Shot path; B3 must connect the Library
entry to that runner rather than creating parallel Measurements. Other Measured
Exercises can be admitted by a later explicit integration once their real execution path
exists.

A terminal execution is immutable except for the owning athlete's private-note fields
already permitted by ADR-0028. The Session integration accepts that narrow update and
rejects a rewritten terminal result, attempt, configuration or content snapshot.

## Consequences

- Technique and Shotmaking work inherits Profile isolation, local durability, archive
  ordering, cloud backup, tombstones and basic restore without a parallel data silo.
- A Technique Exercise with no Attempts and no Shots is still durable history.
- Existing Release Timing, Training Plan, Assessment and Session payloads remain valid.
- Stage B3 can add the rink-side start/configuration/recording UI against one Session
  authority; it still must solve the Release Time Library-to-runner linkage.
- Team role rotation, shared recording, audited revisions and per-athlete upload remain
  Stage C work and are not implied by this embedding.
