# ADR-0039 — Post-completion Team Exercise result authority

**Status:** Accepted and implemented through Exercise Stages C4a/C4b/C4c (2026-08-28).
The complete athlete correction, terminal-void and metadata-only inbox workflow is usable.

## Context

Completed Team Exercise bundles are intentionally immutable and athlete-owned. A later
correction cannot overwrite the recorder-authored bundle, borrow the recorder's former
authority or expose another athlete's performance through a Team notification.

The approved Version 1 product rule lets only the affected athlete change their own
completed result. Correcting athlete attribution is forbidden; ordinary voiding applies
to the complete result, is terminal and is distinct from privacy erasure. Every accepted
change needs a 10-500 character reason and must notify the other original participants
who still have active Team membership and current entitlement.

## Decision 1 — immutable original plus append-only current revisions

`team_exercise_result_revisions` references the existing relational result owner and
stores a stable client revision id, strictly increasing per-result number, kind, schema,
byte-exact replacement payload and digest where corrected, bounded changed-field list,
reason, server-derived actor and time. The original bundle is never updated.

Correction fields are limited to actual handle, evaluation, Measurements and effective
role/Sweeper context. Athlete ownership cannot be named as changed. `voided` stores no
replacement performance payload, targets the whole result and is terminal. Direct
browser writes are denied, RLS exposes only the owner history, and an append-only trigger
also blocks privileged accidental update/delete.

## Decision 2 — serialized, idempotent athlete mutation

Two `SECURITY DEFINER` RPCs derive the actor from the authenticated Free sporting
Profile. Stable revision-id and result advisory locks serialize global id reuse and
same-result races. Exact lost-acknowledgement retries return `already_present`; changed
reuse, stale base revisions and concurrent losers return a non-writing conflict. A
revision cannot be appended after a terminal void.

The server treats the human-authored result payload as bounded lossless text, consistent
with the original bundle boundary. Relational ownership and allowed changed-field
metadata are authoritative; C4b additionally validates the sporting payload before
rendering or caching it.

## Decision 3 — metadata-only, recipient-filtered in-app notifications

The existing `account_notifications` inbox gains the
`team_exercise_result_changed` kind and a nullable stable source-event id. A unique
recipient/source pair makes emission idempotent in the same transaction as the revision.

Recipients are the original Session participant snapshot intersected at emission time
with active membership in the same active Team and a current platform entitlement. The
actor is excluded; non-participants, later joiners and former or currently ineligible
participants receive nothing. Payloads contain Session, actor id plus display-name
snapshot, change kind/count and reason. They contain no result id, before/after value or
performance payload. Detailed grant-aware values remain deferred with the unimplemented
Team data-sharing grant.

## Consequences

- Athlete ownership, immutable upload and private-note boundaries remain unchanged.
- Accepted revisions, notification rows and Team audit events commit atomically.
- Email and push are not introduced.
- C4b adds provider-neutral mutation contracts, strict latest-revision reads and
  schema-6 Profile caching without a second sync engine. C4c adds the online athlete
  editor, stable exact retry after an uncertain acknowledgement, terminal void
  confirmation, audit presentation and metadata-only Team notification cards.
- C4b's mutation builders derive the changed-field list from one replacement stone,
  strip recorder and client-time claims from the wire payload, and reconstruct the
  effective result update time from the server revision timestamp on read.
- Legal erasure remains a separate controlled process and must not be modelled as this
  ordinary append-only void.

## Verification

Three additive migrations apply from scratch. A dedicated 48-assertion pgTAP suite
proves ownership, reason/field bounds, exact retry, stale conflict, terminal void,
recipient filtering, entitlement changes, metadata non-leakage, audit cardinality, RLS,
ACLs, trigger protection, anonymous denial and pinned function search paths. The
existing 68-assertion Team Exercise cloud suite remains green.

C4b additionally verifies strict Supabase correlation, payload hashes, contiguous and
terminal revision chains, exact declared-field changes, immutable athlete/capture facts,
server-derived effective update time, schema-5 cache migration, offline restore and
fail-closed cache replacement in TypeScript.

C4c verifies owner-only mutation orchestration, exact retry identity, stale-conflict
refresh, terminal UI, immutable athlete attribution, current-result/audit presentation,
strict notification metadata parsing, value non-disclosure and dismissal. Visible
mutations require a refreshed online owner projection; cached truth remains readable but
is never treated as post-completion write authority.
