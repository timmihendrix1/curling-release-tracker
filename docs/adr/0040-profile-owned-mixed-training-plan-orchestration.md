# ADR-0040: Mixed Training Plans orchestrate profile-owned domain runtimes through typed references

## Status

Accepted and implemented for Exercise Stage D (2026-08-28).

## Context

The original Training Plan implementation supported only Release Time. Every step
therefore created a `TrainingBlock`, stored a `blockId`, and completed after a planned
shot count. Exercise Stage D must mix Technique, Shotmaking and Measured Exercises
without duplicating their already-implemented execution logic or allowing later plan or
catalog edits to reinterpret history.

Team Technique/Shotmaking execution is a separately persisted recorder-owned cloud
draft, while Release Time remains on the Profile Session's Block/Shot runner. Combining
those persistence authorities safely is a separate orchestration problem. For the first
test, mixed-plan execution is explicitly Profile-owned; Team-plan execution remains a
future execution context, not an implicit side effect of selecting a Team-capable
Exercise.

## Decision

`TrainingPlanStep` is a persisted discriminated union of `ReleaseTimingPlanStep` and
`CuratedExercisePlanStep`. Every member snapshots an exact immutable curated
`ExerciseVersion`. Release Time additionally retains its Block configuration, planned
stone count and Handle Strategy. A curated Technique or Shotmaking step uses explicit
Exercise completion and does not invent a planned-volume requirement.

`PlanExecutionStepSnapshot.runtime` is a second discriminated union:

- `release-timing-block` references the ordinary `TrainingBlock` created by the
  existing timing runner; and
- `exercise-execution` references the ordinary Profile-owned embedded
  `ExerciseExecution` created by the existing Solo boundary.

The plan orchestrator owns only ordering, immutable snapshots and typed runtime
references. It does not own measurement, scoring, notes or completion internals.
Steps remain lazy: the next runtime entity is created only when Continue is chosen, and
the runtime reference plus advanced plan state enter one Session commit.

Release Time completes from its saved Shot count. Technique and Shotmaking complete
only through their existing `Complete Exercise` transition; arbitrary exercise length
is preserved. Abandoning an Exercise interrupts the plan rather than fabricating a
completed step. Finishing the final step still uses the existing Session archive/new-
Session transition.

Training Plan library schema 2 stores the new snapshots and union. Schema 1 Release
Time plans migrate forward by attaching the curated Release Time Version that represents
their already-existing runner. Unknown future schemas fail closed. Session migration
accepts the legacy `blockId` snapshot shape, converts it to the typed runtime, and
otherwise validates the complete plan execution against real migrated Blocks or
Exercise Executions; a mismatch discards only plan-progress decoration, never sporting
data.

## Consequences

- A profile can author and execute any ordered mix of currently curated Technique,
  Shotmaking and Release Time steps in one Training Session.
- Editing/deleting a plan or publishing another Exercise Version cannot mutate a
  started or completed Session because both plan start and Exercise execution hold
  deep snapshots.
- Existing Release Time plans and their Session history remain readable.
- Team-plan execution can add another runtime-reference member and a reviewed cross-
  authority coordinator later; no current Team draft is attached to a personal Session
  or falsely treated as atomic.
- Scheduling, assignment, plan sharing, planned Shotmaking volume and Exercise
  authoring remain outside this stage.
