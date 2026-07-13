# ADR-0002: A Blind Weight draft is not a Shot

## Status

Accepted. Implemented.

## Context

A Blind Weight entry has three phases (predict, measure, review) before it's complete.
At any point before Review, the entry is provisional: a prediction might get corrected,
a measured time might get corrected, or the player might abandon the shot entirely
(open History, switch blocks, end the session).

## Decision

An in-progress Blind Weight entry is modeled as a `BlindShotDraft` — plain, local
component state (`src/lib/blindWeight.ts` / `BlindShotEntry.tsx`) — not a `Shot`. A
`Shot` is only created once, at the moment "Save Shot & Continue" is pressed from a
complete (`isDraftComplete`) `review`-phase draft.

The draft:
- Never appears in analytics, History, charts, CSV export, or the shot count.
- Is not guaranteed to survive a page reload — only the block's own configuration and
  `pendingTargetTime` are guaranteed to. An incomplete Blind shot is not yet a reliable
  training record; losing it on reload is an acceptable, deliberate first-cut behavior.
- Is discarded (never silently completed) when the user navigates away from it —
  `TrackerApp.tsx` warns via the existing `ConfirmModal` before History, a new block, or
  a new session is started while a draft has unsaved progress
  (`hasUnsavedBlindProgress`), and discards it if confirmed.

## Consequences

- Analytics, charts, filters, and export never need to understand "partially entered"
  shot data — every `Shot` they see is complete by construction.
- Correcting a prediction or measured time before saving is just a local state
  transition (`editPrediction`/`editMeasuredTime`), never a mutation of persisted data.
- Cost: an interrupted Blind Weight shot (app closed mid-entry, browser crash) loses
  that one in-progress shot. This was an explicit, documented trade-off (see
  `docs/TECHNICAL_DEBT_AND_ROADMAP.md`), not an oversight — draft persistence can be
  added later without changing this decision, only extending it.
