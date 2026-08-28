# ADR-0033 — Team Exercise Profile-scoped outbox and upload service

**Status:** Accepted and implemented as Exercise Stage C2b (2026-08-28). ADR-0034-0036
now add permission cache/UI, active-draft persistence and one-device capture. Athlete
ADR-0037 now implements restore/read models and ADR-0038 carries filtered active-correction
audit through payload schema 2; post-completion revisions, voiding and notifications remain
later Stage C work.

## Context

ADR-0031 supplies a complete one-device Team aggregate and ADR-0032 supplies the real
server-authoritative Session/bundle RPC boundary. The application still needed a
durable bridge between them. That bridge must survive reload and account switching,
must never upload before local durability is established, and must retain one athlete's
server rejection without rolling back another athlete's accepted result.

## Decision 1 — split one completed aggregate at a strict serializer boundary

`serializeCompletedTeamExercise` accepts only a catalog-valid, completed C1 Team
aggregate. It creates one non-private coordination payload and one result payload per
training athlete. The coordination payload contains no athlete results; result payloads
contain no private note. Recorder claims are removed from both opaque payloads because
the C2a RPCs derive recorder provenance from the authenticated Profile.

The Session id and Execution id remain their existing client UUIDs. In the current C1
shape one athlete has exactly one Result in one execution, so that Result's stable UUID
also serves as the stable V1 bundle UUID. The tables keep Result and bundle identities
as separate namespaces; a future multi-execution Session may introduce a dedicated
bundle identity without rewriting accepted V1 records.

## Decision 2 — extend the existing outbox, never add a second sync engine

The existing Profile-scoped `curling-release-tracker-cloud-sporting-sync` record is
upgraded from schema 1 to schema 2. Its existing personal entries remain represented
under `entries`; new `teamEntries` hold the immutable Session envelope and athlete
bundles. Loading schema 1 deterministically yields schema 2 with an empty Team list.
Invalid Team manifests, statuses, hashes, UUIDs or unnamed block reasons fail the whole
sync-state load closed.

The full package is written to that Profile namespace before any RPC is called. A failed
outbox write prevents upload. Because the namespace is immutable per Profile and the
public enqueue method verifies the aggregate's recorder against the mounted Profile,
pending data is unavailable after an account switch and cannot be rebound to another
recorder.

## Decision 3 — envelope first, then independently retried bundles

The sync manager uploads and acknowledges the Session envelope before any child bundle.
Every acknowledgement must return the exact locally computed SHA-256 digest; conflict
or digest mismatch becomes a durable issue. `unavailable` leaves an entry pending, so a
lost acknowledgement is retried under the same stable id and converges through C2a's
`already_present` outcome.

A named C2a `blocked` outcome is stored only on that athlete bundle. Snapshot truth
therefore distinguishes locally completed/upload pending, fully synced, partially
synced with an athlete result blocked, and a sync issue. Explicit Retry returns blocked
bundles to pending so a later concrete-Session approval or permission change can be
revalidated server-side. Accepted sibling bundles are never resent or rolled back.

After an exact successful acknowledgement, the recorder outbox clears that entry's
opaque coordination/result payload and retains only its ids, manifest, digest and
receipt status. Pending, unavailable, blocked and issue entries keep the payload needed
for retry. The outbox therefore does not silently become a permanent second archive of
other athletes' accepted results.

## Decision 4 — one provider-neutral service covers the C2a RPCs

`TeamExerciseCloudService` names Session upload, bundle upload, recording permission,
concrete-Session approval and private-note mutation without importing Supabase types.
`createSupabaseTeamExerciseCloudService` is the only browser adapter for those RPCs. It
maps only named outcomes, block reasons, hashes, UUIDs and timestamps; provider errors
are normalized and raw details never cross the boundary. Production composition injects
this adapter into the existing Profile-scoped sync manager.

## Consequences and non-goals

- Completed Team capture now has a durable, reload-safe, account-isolated upload path,
  but no rink UI invokes capture yet.
- The local outbox is a one-way recorder queue, not a generic bidirectional Team store.
- Athlete-owned cloud restore/read models and private-note UI are not implemented by
  this upload stage; ADR-0037 now supplies them as a separate owned projection.
- The existing Solo Session/Assessment restore, tombstone and sync semantics are
  unchanged.
- Stage C revision history, voiding and notifications remain separate product and
  authority work.

## Verification

Tests cover strict payload separation, stable identities, legacy schema migration,
malformed Team state, exact RPC mapping, provider-error redaction, reload, account
switch, durable-write failure, envelope-before-bundle ordering, per-athlete block and
retry, and lost-acknowledgement convergence.
