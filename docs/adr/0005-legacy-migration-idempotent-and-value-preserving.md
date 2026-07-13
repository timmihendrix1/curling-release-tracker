# ADR-0005: Migration is idempotent and never overwrites an existing shot value

## Status

Accepted. Implemented.

## Context

`sessionMigration.ts` runs unconditionally on every `localStorage` read, on data that
may be brand new, years old, or already-migrated. Two categories of bugs are especially
dangerous here because they affect *every existing user's data* the moment they reload
the app, not just new usage:

1. Misclassifying data (treating something as "legacy" that isn't).
2. Migration changing its own output on a second run.

Both actually happened during this project's development and were fixed:

- **The `blocks: []` bug.** A freshly created session with no first block configured
  yet (a completely normal, common state — `blocks: []`, an empty array) was
  misdetected as pre-block-architecture legacy data (which is recognized by `blocks`
  being *absent*, not empty) and given a fabricated "Legacy Block" it never asked for,
  silently skipping the intended setup screen. Fixed by checking `Array.isArray(raw.blocks)`
  rather than truthiness or length. **This is now a permanent migration invariant, not
  just a historical bug fix — any future change to `migrateBlocks` must preserve the
  distinction between "no `blocks` key" and "empty `blocks` array".**
- **The shared Smart Random range bug** (see ADR-0004) similarly required a migration
  fix that runs on every load without re-corrupting already-fixed data on the next run.

## Decision

1. Migration never overwrites a shot's `targetTime`, `releaseTime`, `predictedTime`,
   `handle`, or `shotType` if already present — it only fills in genuinely absent
   structure (blocks, target-source fields, ranges, pending targets).
2. Migration never fabricates a value it cannot know — most concretely,
   `predictedTime` is either already present or stays `undefined`; it is never invented
   to satisfy a "Blind Weight shots should have one" expectation during migration.
3. Running `migrateSession` twice on its own output must produce an identical result
   (verified by tests for every migration path: legacy blocks, missing target modes,
   Smart Random range backfill, the Hog-Hog-forced-to-Manual case, and the `blocks: []`
   case specifically).

## Consequences

- Every migration test that exists is effectively also a regression test against a
  real, previously-shipped bug — not a hypothetical one. New migration logic should be
  added with the same "run it twice, assert equality" test pattern already established.
- A new optional field on `TrainingBlock` or `Shot` requires an explicit backfill rule
  and an idempotency test, not just a type change — see `CLAUDE.md`'s working rules.
- This makes migration code slightly more verbose (explicit presence checks everywhere
  rather than blanket overwrites) in exchange for making it safe to run on every single
  page load, forever, without a version flag or a one-time migration script.
