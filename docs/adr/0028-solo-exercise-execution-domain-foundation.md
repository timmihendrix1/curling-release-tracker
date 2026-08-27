# ADR-0028: Solo Exercise Execution Domain Foundation

**Status:** Accepted and implemented as Exercise Stage B1 (2026-08-27). ADR-0029 adds
Session persistence and ADR-0030 adds the athlete-facing Solo UI.

## Context

Stage A models immutable curated Exercise content but deliberately stores and executes
nothing. Stage B must add Technique, Shotmaking and Measured execution without forcing
the existing release-timing `Shot` shape onto attempts that may have no release time,
target time or score. It must also preserve existing Release Timing history and avoid a
second implementation of its Fixed, Variable and Blind Weight flows.

## Decision

The execution domain remains inside `src/lib/exercises/`, separate from both curated
content and the existing release-timing types. One `ExerciseExecution` carries a stable
client UUID, a future Training Session UUID, a deep immutable `ExerciseVersion` snapshot,
the actual configuration, lifecycle, role context and athlete-owned results.

Stage B1 implements the Solo cardinality deliberately: exactly one delivering Athlete,
one role segment and one `AthleteExerciseResult`. Team cardinality, rotation and
authorization arrive in Stage C without changing attempt identity or result ownership.

Attempts are a discriminated union. Shotmaking attempts retain intended and actual
handle, a scored `0..4` or an explicit exclusion, and optional Measurements. Measurement
attempts retain one or more Measurements and no fabricated Shotmaking outcome. Technique
execution can complete with no attempt. Measured execution requires a Measurement;
Shotmaking requires a recorded attempt. Terminal attempts are immutable, while the owner
may still edit or clear their private Athlete Note.

Every enabled Measurement Protocol is snapshotted. Persisted validation compares both
the Exercise Version and protocols with their immutable catalog versions and fails closed
on corruption, unsupported schema, broken ownership, duplicate identity, invalid sequence
or incompatible focus. Results remain derived: exclusions never become zero, zero remains
a real score, and percentage is `points / (4 × scored stones)` for the actual variable
length.

ADR-0029 relates Technique and Shotmaking aggregates to application Training Sessions.
It keeps the existing release-timing execution for the Release Time Library entry and
does not duplicate Fixed, Variable or Blind Weight capture in a second runner. No new
storage key, repository, cloud record kind, start action or UI is introduced by B1.

## Consequences

- Stage B can build UI and persistence on tested focus-neutral domain transitions.
- Full Exercise Version snapshots make historical meaning independent of the current
  catalog pointer.
- Current Release Timing Sessions, Training Blocks, Shots, plans and cloud payloads are
  unchanged by B1.
- B1 alone cannot be used by an athlete and is not the Stage B vertical slice.
