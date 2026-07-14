# ADR-0007: Capture Sequence result processing is serialized, atomic, and self-healing on reload

## Status

Accepted. Implemented.

## Context

ADR-0006 established a shared, provider-neutral `TimingResult` boundary for Capture
Sequences. That pass did not, by itself, guarantee correctness under three conditions
real usage (and testing) can produce:

1. **Two results arriving in the same synchronous tick** — two Simulator events fired
   without an `await` between them, or a Simulator event landing at the same time as an
   "Add Result Manually" click. The original implementation bridged a result's
   processing outcome out of a `setCurrentSession` functional updater via a plain
   object ref, read synchronously right after the `setCurrentSession` call. This relies
   on React's internal "eager state" optimization — React only invokes a queued
   functional updater synchronously at dispatch time when no other update is already
   pending. For a *second* result queued in the same tick, that optimization does not
   fire, so the ref-read comes back empty: the underlying session data still updates
   correctly (React's update queue chains functional updaters correctly, with or
   without eager evaluation), but the outcome-dependent diagnostic feedback for that
   second result would be silently dropped.
2. **A genuine exception during processing** (a bug, not an ordinary rejection like
   "duplicate") had no defined handling — it would have surfaced as an unhandled
   promise-adjacent error with no visible recovery path and no way to know afterward
   whether any capture progress had partially applied.
3. **Persisted `CaptureSequence` data can drift from the shots that actually exist** — a
   stored `capturedShotCount` or `steps` list is just a cache of what happened; nothing
   previously re-verified it against `session.shots` on load.

## Decision

1. **A hand-rolled Promise queue serializes result processing**, not a new state
   library. `TrackerApp.tsx`'s `processIncomingTimingResult` appends each call onto
   `captureQueueRef.current.then(...)`. Because `.then()` callbacks for one promise
   chain always run in registration order, two results queued back-to-back — even in
   the exact same synchronous tick — are processed strictly one at a time.
2. **An authoritative `sessionRef` mirror, written synchronously** by every
   capture-mutating action (`commitSession`), replaces the ref-bridge-through-setState
   pattern. Result processing reads and writes this ref directly instead of depending
   on React's `setState` timing at all, which removes dependency #1's root cause rather
   than working around it.
3. **`applyTimingResultToSession` is the single, pure atomic transition** — old
   `Session` + `TimingResult` → new `Session`, computed in one synchronous step with no
   framework dependency. `processIncomingTimingResult`'s queued step calls this once,
   then commits the result; there is no way to observe a partially-applied state (shot
   saved but sequence not advanced, or vice versa).
4. **A genuine exception during processing is caught, never left unhandled.** The
   session is left byte-for-byte unchanged (no partial capture progress); the sequence
   is instead forced into `"paused"` with a new `lastError: string` field
   (`pauseCaptureSequenceWithError`). No new `"error"` `CaptureSequenceStatus` was
   added — reusing `"paused"` means every existing paused-state UI/guard/migration rule
   already applies, and "Resume" already means "the user explicitly decided to
   continue"; `resumeCaptureSequence` clears `lastError` on a successful resume. No
   automatic retry is attempted.
5. **`sanitizeCaptureSequence` reconciles a persisted sequence against real shots on
   every load**, called from `sessionMigration.ts`. Real, already-saved shots are the
   primary source of truth: `capturedShotCount` and `steps` are recomputed/filtered
   against them, `processedResultIds` is only ever widened (never narrowed, so a
   result whose shot later vanished still stays permanently "spent"), and a
   `"completed"` sequence whose real shot count doesn't actually reach
   `expectedShotCount` is reopened as `"paused"` with an explanatory `lastError` rather
   than either being trusted as done or silently discarding real shots. A sequence is
   discarded outright only when it's structurally unsalvageable (invalid
   `expectedShotCount`, or more real shots than `expectedShotCount` allows) — never
   repaired by inventing a shot or a result id.

## Consequences

- Two results arriving in the same tick — from the Simulator, from "Add Result
  Manually", or any mix of the two — are now provably serialized independent of React's
  internal `setState` batching/eager-evaluation behavior, not merely "usually correct in
  practice." `applyTimingResultToSession` being a pure, framework-independent function
  makes this directly unit-testable (apply it N times in a row, feeding each output into
  the next call) without needing a browser or a React test renderer.
- `processIncomingTimingResult` is no longer synchronous — every call is deferred by at
  least one microtask via the queue. This is a deliberate, imperceptible trade-off: the
  correctness guarantee no longer depends on an internal React optimization that could
  change between versions.
- A bug in capture processing now has a defined, visible failure mode (paused +
  `lastError`) instead of an undefined one — consistent with this project's "no silent
  half-states" principle already established for migration (ADR-0005) and Blind Weight
  drafts (ADR-0002).
- Reload is now self-healing against a corrupted or drifted persisted `CaptureSequence`,
  not just "trusts the numbers that happen to be there" — closing a real gap ADR-0006's
  original migration logic (re-deriving `capturedShotCount` from `steps.length` alone)
  did not cover: `steps` and `session.shots` could themselves have drifted apart (e.g. a
  step referencing a shot that was separately deleted).
- **Known, accepted limitation not solved by this pass:** a `TimingResult` still carries
  no sequence identity. A stale delayed result that outlives a Cancel can be attributed
  to a *new* sequence started for the same block before the stale result arrives — this
  is different from (and safe against) the already-handled "result arrives after this
  same sequence was cancelled" case, which the sequence's own `status` check rejects
  regardless of timing. See `docs/TECHNICAL_DEBT_AND_ROADMAP.md`.
- The other, non-capture session-mutating handlers (`handleAddShot`, `handleDeleteShot`,
  block creation) were deliberately left on the classic functional-`setState`-updater
  pattern, not migrated to `commitSession` — out of scope for a Capture-Sequence-focused
  hardening pass. `sessionRef` is still resynced after every render as a catch-all for
  them; see `docs/TECHNICAL_DEBT_AND_ROADMAP.md`'s note on the resulting narrow,
  documented edge case (a classic manual shot and a capture result for the same block,
  landing in the same render window).
