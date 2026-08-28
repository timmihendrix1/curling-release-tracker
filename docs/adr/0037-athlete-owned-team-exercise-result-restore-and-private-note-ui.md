# ADR-0037 — Athlete-owned Team Exercise result restore and private-note UI

**Status:** Accepted and implemented as Exercise Stage C3c (2026-08-28). Audited
correction, post-completion revision, voiding and participant notifications remain later
Stage C work.

## Context

ADR-0032 already makes each accepted Team Exercise bundle readable by its athlete on
Free, keeps the shared Session envelope visible only through ownership of such a bundle,
and isolates the athlete's private note through RLS and an athlete-authenticated RPC.
ADRs 0033-0036 supplied recorder-side upload through one-device capture, but the athlete
could not restore, inspect, export or annotate the accepted result through the app.

The restore path must not turn the recorder's outbox into read authority, infer a Team
membership grant, reveal sibling results or notes, or invent data when offline. A former
Team member must retain access to their own accepted result even when current Team names
or roster profiles are no longer readable.

## Decision 1 — RLS-owned projection, not a Team history grant

The provider-neutral Team Exercise service exposes `listMyResults`. The Supabase adapter
reads the existing six RLS-protected tables and correlates one owned athlete bundle with
its immutable Session envelope, manifests, result reference and optional own private
note. It adds no migration or broad Team-history RPC. Participation, recorder or Coach
status alone still grants no historical result read.

Every response fails closed as one unit on malformed rows, duplicates, orphans,
manifest disagreement, invalid timestamps, recorder disagreement or provider failure.
Opaque payload hashes are recomputed before JSON is trusted. Recorder provenance is
injected only from the server-owned relational rows; payload-supplied recorder claims,
private notes inside result payloads and sibling `athleteResults` inside coordination
payloads are rejected.

## Decision 2 — one strictly validated athlete-owned read model

`deserializeOwnedTeamExerciseResult` reconstructs only the authenticated athlete's
completed result plus the shared non-performance execution context. Validation uses a
narrow owned-result projection: full shared roster, configuration and role history stay
available for contextual validation, while exactly one completed result must belong to
the mounted Profile. A zero-attempt owned projection is valid when another athlete made
the Team Exercise's recorded attempt; hidden sibling attempts are never guessed.

The read model contains no sibling result collection. The athlete's raw JSON export is
built from this same projection and includes only shared Session/execution context, the
athlete's own result and their own private note.

## Decision 3 — reuse the Profile-scoped sync record for verified offline reads

Schema 5 of ADR-0027's existing Profile-scoped sporting sync record adds
`teamExerciseResults`. Schemas 1-4 migrate deterministically with an empty result cache.
There is no new storage key or repository. Cache load is strict, rejects duplicate
result or Session identities and fails closed if any cached athlete differs from the
mounted Profile.

Online refresh validates every returned record before atomically replacing the cache.
An unavailable or invalid refresh never deletes or overwrites the last verified cache:
the UI distinguishes refreshed, cached, unavailable and verification-issue states.
Offline entry may show only that verified cache and never fabricates cloud state.

## Decision 4 — Analyze owns the athlete result surface

Analyze adds an `Exercises` tab alongside Training and Assessments. The tab list uses
complete keyboard and ARIA tab semantics. The result surface lists only the mounted
athlete's accepted Team results and shows factual values: actual Shotmaking average,
points, maximum points, scored/excluded counts, handles, supported Measurements and
non-scored Technique wording. It shows shared context as counts and facts, not current
Team or participant names and not raw identifiers.

The athlete may download the owned raw projection. The UI does not expose sibling
results or notes and does not imply that shared context grants such access.

## Decision 5 — private-note mutation is online and acknowledgement-first

The athlete may create, edit or clear only the private note attached to a cached result
owned by the mounted Profile. The existing athlete-authenticated RPC remains the write
authority. The client updates its cache only after cloud acknowledgement and reports
cloud success separately if the local cache write then fails. Offline note mutation is
not queued because no approved private-note outbox exists.

Whitespace-only input clears the note; non-empty notes preserve entered text and are
limited to 65,536 UTF-8 bytes at both the client boundary and the decoded/cache
boundaries. Note changes emit no participant notification because they do not change a
shared performance result.

## Consequences and non-goals

- Athlete-owned structured raw Team results and their basic restore/export remain part
  of the Free Cloud Core.
- Current Team membership is not required to restore an already-owned result.
- This stage adds no SQL, migration, storage key, second sync engine, Team-name lookup,
  sibling-result read, shared note or Exercise-specific UI branch.
- The read contract is pull-based and refreshes the current result set; pagination can
  be added when real volume requires it.
- Active correction audit, post-completion revision, voiding, result-change
  notifications, Team summaries and coaching grants remain separate later work.

## Verification

Tests cover hash and manifest verification, payload leakage, foreign ownership,
zero-attempt projections, strict schema-5 migration/cache validation, RLS-row
correlation, duplicate/orphan rejection, offline restore, invalid-refresh cache
retention, Profile isolation, acknowledgement-first note save/clear, storage failure,
UTF-8 limits, factual rendering, identifier non-rendering, Analyze tab semantics and
browser navigation. The full TypeScript, lint, unit, build and UI E2E suites remain the
completion gate.
