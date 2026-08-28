# ADR-0038 — Active Team Exercise attempt corrections

**Status:** Accepted and implemented as Exercise Stage C3d (2026-08-28).
Post-completion athlete revisions, ordinary voiding and participant notifications remain
the final Stage C work.

## Context

ADR-0036 records Team Shotmaking stones durably on one recorder device, but an active
recorder could not correct a mistaken athlete, handle, outcome, Measurement or role
context. Hard-deleting a double entry would remove provenance; rewriting a past role
segment would also change the meaning of every other stone linked to that segment.

The approved product rule allows the authenticated active recorder to correct any
previously recorded stone while the Session is active. No typed reason is required
rink-side. The exact actor, time and before/after facts must remain auditable. A stone
recorded by mistake stops counting but is retained in that audit. These active changes
do not notify participants. After completion, each athlete may see only correction
history affecting their own data.

## Decision 1 — append-only audit plus current result projection

Exercise Execution schema 2 adds `activeAttemptCorrections`. Each event has a stable id,
target attempt id, `updated` or `annulled` kind, authenticated active-recorder Profile,
timestamp and exact before value; an update also retains the exact resulting value.
The current `athleteResults` projection contains only the latest non-annulled attempts
used by live and completed calculations.

Correction events are strictly chronological. A subsequent event for the same attempt
must continue from the prior resulting value, an annulled attempt cannot be corrected
again, and the final current attempt must equal the latest audited result. Completion
cannot predate a correction. Schema 1 history remains readable; creating or correcting
a current Team draft writes schema 2.

## Decision 2 — any active stone and all approved captured facts

The recorder may correct any current Shotmaking attempt, not merely the latest. The
correctable facts are delivering athlete, actual handle, scored/excluded outcome,
manual Rotation Count and observer, Sweepers, sweeping use, Skip, observer, Coaches and
timekeeper. The original attempt id, capture time, original recorder and source role
segment remain stable.

Changing the athlete moves the current attempt into that athlete's result. Per-athlete
sequence numbers are stable positive recording labels rather than positions that must
be silently renumbered. A corrected role context is an attempt-level override: the
captured chronological role segment remains unchanged and continues to describe other
stones, while the corrected stone uses its audited effective context.

## Decision 3 — recorded-by-mistake is an audited annulment

The active UI labels this action `Recorded by Mistake` and requires confirmation. The
attempt is removed from current calculations and cannot satisfy the minimum-one-stone
completion rule, but its full prior facts remain in the append-only event. This is an
active capture correction, not post-completion ordinary voiding and not privacy erasure.
It requires no manually entered reason and emits no notification.

## Decision 4 — durable-first UI and athlete-owned history

The correction editor uses ADR-0035's existing Profile-scoped active-draft save. It
shows a correction only after the complete next aggregate is durably saved; a failed
write leaves the prior draft as truth. Reload and exact completion handoff preserve the
audit.

Cloud payload schema 2 keeps performance audit out of the shared coordination envelope.
Each athlete bundle receives only correction events whose before or after owner is that
athlete. Recorder identity is stripped from the opaque browser payload and reconstructed
only from the server-owned relational recorder row on read. A move between athletes is
therefore present in both affected athlete bundles; unrelated athletes receive nothing.
Analyze shows the affected athlete a factual history without exposing raw Profile ids.

The existing Postgres tables and RPCs accept positive payload schema versions and store
opaque immutable text, so this stage requires no migration or authority change. Cloud
schema 1 remains readable. Raw owned export schema 2 includes only the athlete's filtered
active correction history alongside their own result and note.

## Consequences and remaining work

- Active corrections are usable offline on the recorder device and survive reload.
- Current averages, points, counts and completion eligibility ignore annulled attempts.
- The audit is not a lasting Team-history grant; athlete ownership and private-note
  isolation remain unchanged.
- No active correction requires a reason or generates a notification.
- Post-completion changes still require an athlete-authenticated reason, append-only
  server revision/void authority and filtered in-app notifications. Those are not
  implemented by this ADR.

## Verification

Domain tests cover earlier-stone edits, athlete moves, role overrides, annulling,
impersonation, terminal/no-op/non-monotonic rejection and hostile audit mutation.
Persistence tests cover reload, exact completion and bundle splitting. Read/export tests
cover affected-athlete filtering, recorder reconstruction, annulled facts, schema-1
compatibility and foreign-field rejection. Component tests cover correction without a
reason, durable result updates, confirmation before annulment, current calculation
removal and athlete-owned correction history.
