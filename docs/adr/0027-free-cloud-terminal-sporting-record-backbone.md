# ADR-0027: Free Cloud Terminal Sporting Record Backbone

**Status:** Accepted and implemented (2026-08-27).

## Context

Stages B0.2 and B0.3 established mandatory identity and Profile-scoped local repositories,
but completed sporting history still existed on one device only. The Free Cloud Core
requires durable upload, basic restore, retry, honest sync truth, explicit conflicts and
real database verification. It must not turn an in-progress Session or Assessment draft
into a concurrently editable cross-device record.

The TypeScript domains can serialize strings PostgreSQL `jsonb` cannot represent
losslessly, including escaped U+0000 and unpaired Unicode surrogates.

## Decision

### Cloud authority units

The first B0.4 units are archived Training Sessions (including Blocks, Shots, snapshots,
notes and provenance) and terminal (`completed` or `incomplete`) Assessment Runs (including
Attempts and their snapshots/provenance). The current Training Session and Assessment draft
remain device-local. Basic restore is history restore, not cross-device continuation.
Exercise execution will extend this backbone when that domain exists.

ADR-0021's Assessment split is implemented: draft and history use separate Profile-scoped
keys, and history alone is cloud-eligible. The former Profile-scoped combined value is split
on first load. History is written before draft; an exact matching half-written transition
can resume; an unexplained partial or conflicting layout fails closed. New writes never
update the combined key.

### Lossless server representation

`public.sporting_records.payload` stores the exact serialized JSON as **TEXT**, not `jsonb`.
The server computes SHA-256 over its UTF-8 bytes. Kind, stable client-generated UUID, schema
version and recorded timestamp remain typed columns. A restore must match the digest and
pass the relevant domain validator before local use. Later query-oriented projections may
be derived, but never replace or rewrite this exact raw authority.

### Idempotency, conflicts and deletion

The identity is `(profile_id, record_kind, record_id)`; Profile is always server-derived.
Under a transaction and per-record advisory lock, an absent identity inserts, an exact
retry returns `already_present`, and different content or a tombstone returns `conflict`
without overwrite.

Deletion requires the last locally known digest. A different cloud digest conflicts. A
matching or cloud-absent identity creates one permanent tombstone and deletes any raw
payload row in the same transaction; an exact retry returns `already_deleted`. Restore
excludes tombstones and a stale retry cannot resurrect one.

### Authorization and local queue

Every RPC proves completed onboarding, Athlete capability and active Free entitlement.
Browser roles have no direct write privilege and no write policy. Own-Profile RLS prevents
cross-Profile reads; no client Profile parameter exists.

One new Profile-scoped local sync state holds exact payloads for desired-present records,
digests, desired presence or deletion, and `pending` / `synced` / `issue`. When a local
record is deleted, the queue immediately drops its payload and retains only the digest and
identity needed to tombstone the cloud record. It reuses no retired IndexedDB migration
marker. Local persistence completes first; reconciliation then queues terminal history, so
startup can repair an interruption between those steps.

Online startup restores and validates cloud history before the sporting app mounts, merges
cloud-only records, reconciles local history and drains the queue. Offline startup uses
local history and queues changes; reconnect repeats restore, reconciliation and drain.
Only server acknowledgement produces **Synced**. Aggregate UI truth is **Saved on this
device**, **Synced**, or **Sync issue** with retry. Failures preserve local records.

## Consequences

- Free includes cloud durability and basic history restore.
- Raw values round-trip losslessly and remain usable for future derived analytics.
- In-progress cross-device continuation, concurrent editing and live deletion propagation
  into an already-open older device remain deferred. A tombstone still prevents cloud
  resurrection.
- Account deletion, retention and shared Team-result anonymisation remain separate work.

## Verification

The B0.4 migrations apply from scratch to local Supabase. The dedicated pgTAP suite covers
authorization, grants, RLS, exact TEXT preservation, server digests, idempotency,
conflicts, cross-Profile isolation, transactional raw-payload deletion, tombstones,
restore exclusion and direct/anon denial. TypeScript tests cover offline queueing,
reconnect, deletion-before-restore ordering, restore-write failure, honest sync truth,
retry, conflicts, Assessment-draft exclusion and the untrusted Supabase response boundary.
The real-browser E2E slice proves cloud-only restore and permanent deletion for both a
Training Session and a terminal Assessment Run.
