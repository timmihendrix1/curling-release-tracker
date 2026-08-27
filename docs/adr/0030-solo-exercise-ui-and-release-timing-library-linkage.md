# ADR-0030: Solo Exercise UI Reuses the Training Session and Release Timing Runner

**Status:** Accepted and implemented as Exercise Stage B3 (2026-08-27).

## Context

ADR-0028 defined the Solo `ExerciseExecution` aggregate and ADR-0029 embedded Technique
and Shotmaking executions in the existing Profile-owned Training Session. Athletes still
could not start or record an Exercise. Release Time also needed to be reachable from the
Library without creating a second runner or a second copy of timing outcomes.

## Decision

The generic Exercise detail action branches only on `primaryFocus`.

- Technique and Shotmaking create one Solo `ExerciseExecution` for the authenticated
  Profile and attach it to the current Session. The focus-driven rink screen renders the
  snapshotted instructions, actual Solo/sweeping context and private Athlete Note.
- Technique is observation-only. It displays no score, percentage, target-attainment or
  pass/fail control or result.
- Shotmaking records each actual handle and either a 0-4 self-assessed outcome or the
  existing required exclusion reason. It asks for no planned volume. Results remain
  descriptive: scored/excluded counts, points over the actual maximum, average,
  distribution, handle split and the ordered attempt log.
- A Measured Exercise does not create an `ExerciseExecution`. It opens the unchanged
  Fixed Weight, Variable Weight and Blind Weight setup and runner. When that setup creates
  its existing Training Block, the Session stores an exact immutable
  `releaseTimingExerciseVersionSnapshot` solely as Library provenance. Blocks and Shots
  remain the only Release Timing execution and outcome records.

The current Session remains the single persistence authority. There is no new key,
repository, cloud record kind or sync path. The new provenance snapshot and embedded
executions pass the existing strict migration, current/history and Free-cloud Session
boundaries. Direct Quick Start creates no Library provenance.

One active Exercise Execution is shown ahead of any release-timing block. Reloading an
active Exercise returns directly to its rink screen. Completing or abandoning it clears
the active pointer but retains the terminal result for note review. Starting a new
Session uses the existing history-first archive transition and explicitly abandons an
interrupted Exercise.

## Consequences

- Stage B is athlete-usable in Solo mode for the three currently curated Exercises.
- Release Time has one functional implementation even though it has two entry paths.
- The actual athlete Profile comes from authenticated application composition; there is
  no recorder or athlete selector in Solo mode.
- Team participants, role rotation, shared recording and Exercise Training Plan steps
  remain Stages C and D. The remaining six curated Exercises remain Stage E content work.
- Optional Measurements on a Technique or Shotmaking Exercise become executable when a
  curated Exercise declares them and its input workflow exists; B3 does not invent a
  protocol or configuration for the current content.
