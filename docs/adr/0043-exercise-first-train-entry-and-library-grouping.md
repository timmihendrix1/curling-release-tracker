# ADR-0043: Exercise-first Train entry and Library grouping

- Status: Accepted and implemented
- Date: 2026-08-29
- Supersedes: ADR-0030 only where it retained a separate Quick Start entry

## Context

Train exposed Quick Start, Exercises and Training Plans as equal entry paths. In
practice, Quick Start meant Release Timing, which gave one Measured Exercise a
privileged position outside the Exercise Library and made the Library appear as one
undifferentiated list. Release Time already had a Library description but delegated to
the same Fixed Weight, Variable Weight and Blind Weight runner.

## Decision

1. Train exposes two entry paths: **Exercises** and **Training Plans**. Exercises is the
   default and the fail-safe fallback while Training Plans is unavailable.
2. The Exercise Library groups filtered results, in fixed order, under **Technique**,
   **Shotmaking**, and **Measured Exercises**. Empty groups are omitted. Search and
   filters retain catalog order inside every group.
3. Release Time remains a normal Measured Exercise. Its detail action opens the existing
   timing setup as a nested Exercise subview; Fixed/Variable/Blind configuration, Block
   creation, capture, persistence, analytics and Training Plan execution are unchanged.
4. Starting Release Timing through the Library still snapshots the immutable Exercise
   Version on the Session. There is no second runner or result aggregate.
5. Leaving the nested timing setup without starting clears its pending provenance. A
   back action returns to the Release Time detail.
6. Restricted source diagrams retain ADR-0023's authenticated, configured-Team delivery
   boundary. Navigation changes do not make those assets public or weaken authorization.

## Consequences

- Athletes choose the sporting activity before configuration; Release Time no longer
  appears to be the platform's default Exercise.
- Existing release-time functionality and historical data remain compatible.
- Tests and documentation must use the real Library-to-timing path; no hidden or
  test-only Quick Start path exists.
- Showing Swiss Curling diagrams in a deployed closed beta still requires an existing
  Team, active membership, and that Team's UUID in
  `CLOSED_BETA_EXERCISE_ASSET_TEAM_ID` for the deployment environment.

## Rejected alternatives

- **Rename Quick Start but keep it beside the Library:** retains the same privileged
  Release Time architecture under different copy.
- **Create a new Release Time runner inside Exercise execution:** duplicates proven
  capture and persistence logic and risks divergent results.
- **Serve source diagrams publicly to avoid Team setup:** violates ADR-0023 and the
  closed-test permission boundary.
