# ADR-0035 — Active Team Exercise draft persistence

**Status:** Accepted and implemented as Exercise Stage C3a (2026-08-28). ADR-0036 now
uses this boundary for Team setup and one-device capture; result/private-note reads,
revisions, voiding and notifications remain later Stage C work.

## Context

ADR-0031 defines the one-device Team aggregate, ADR-0033 durably queues only completed
Team Sessions, and ADR-0034 supplies the last server-observed roster and recording
permissions needed for a bounded offline start. A rink recording must also survive a
reload or temporary loss of power before completion without entering the Solo Session
aggregate or pretending to be an uploadable terminal record.

## Decision 1 — one Profile-scoped active Team draft

The existing Profile-scoped sporting sync record advances from schema 3 to schema 4 and
adds `activeTeamExerciseDraft`. It is either `null` or exactly one strictly validated,
in-progress C1 Team `ExerciseExecution`. Schemas 1-3 migrate deterministically with no
active draft. A malformed, terminal or Solo value fails the whole sync-state load
closed.

The draft is stored in the immutable physical namespace of the authenticated recorder's
Profile. The manager additionally verifies that the aggregate's recorder, the
authenticated Profile supplied by production composition and the mounted Profile
namespace agree. A mismatched persisted draft is not exposed and makes the boundary
non-writable for that mount. Account switching therefore cannot reveal or retarget the
previous Profile's active work.

## Decision 2 — durable-first save and explicit discard

Starting or changing the active aggregate is accepted only after the full schema-4
record has been durably rewritten. A failed write restores the prior in-memory state.
Version 1 refuses a second execution id while one is active. Discard removes only the
matching recorder-owned draft through an explicit boundary; the future UI must obtain
confirmation before calling it.

This persistence boundary validates aggregate truth but does not invent the active-edit
audit policy. Capture UI must use the domain transitions from ADR-0031; audited active
corrections remain a separate Stage C decision.

## Decision 3 — atomic draft-to-outbox finalisation

Finalisation accepts only a valid completed aggregate that is the exact lifecycle
completion of the saved draft: all non-lifecycle fields must remain identical. In one
local record write it removes the draft and adds ADR-0033's immutable Session envelope
plus one athlete bundle per training athlete. No RPC is attempted before that write
succeeds. If it fails, the saved draft remains the reload truth and nothing is uploaded.

Existing stable-id/digest conflict handling, envelope-before-bundle ordering, partial
athlete rejection and retry behaviour are unchanged. The active draft is never itself a
cloud upload entry or Team read model.

## Consequences and non-goals

- One recorder device can resume one in-progress Team Technique or Shotmaking execution
  after reload, including offline.
- Solo Technique/Shotmaking still use the existing Session aggregate. Team Release Time
  still extends the existing timing runner rather than creating a Team Measured
  `ExerciseExecution`.
- This slice itself added no capture or resume UI; ADR-0036 now supplies it without a
  new storage key, database table, RPC or cloud authority.
- Private Athlete Notes remain absent from the shared draft and completed upload
  package; they use ADR-0032's athlete-authenticated boundary.

## Verification

Tests cover schema-1/2/3 migration, strict schema-4 parsing, reload and account
isolation, recorder/Profile mismatch, one-draft cardinality, failed-write rollback,
explicit discard, exact-completion refusal, atomic draft-to-outbox finalisation and the
rule that a failed final write triggers no upload.
