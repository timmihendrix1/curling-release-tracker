# ADR-0032: Team Exercise Cloud Authority and Partial Upload

**Status:** Accepted and implemented as Exercise Stage C2a (2026-08-28). The database
boundary is executed and verified against real local Supabase Postgres. Local durable
queue integration, athlete-facing Team execution UI, post-completion revisions,
voiding and participant notifications remain later Stage C review gates.

## Context

ADR-0031 deliberately stops at a standalone TypeScript Team aggregate. It can model
several athletes, the confirmed roster, one recorder, actual role segments and
athlete-owned results, but it cannot decide whether an offline recorder still has cloud
authority when connectivity returns. Reusing the recorder's Profile-owned Solo
`training_session` record would incorrectly transfer every athlete's data to the
recorder. Uploading the complete aggregate in one transaction would also make one
athlete's missing permission block every other athlete.

The accepted product specification instead requires an explicit prospective
athlete-to-Team recording permission, one shared coordination envelope, independently
owned athlete bundles, per-athlete authority revalidation, safe retry after a lost
acknowledgement, and a concrete-Session approval path for a blocked athlete. Team
participation must never become lasting access to another athlete's result or note.

## Decision 1 — recording permission is its own historical authority record

`team_exercise_recording_permissions` stores time-bounded athlete-to-Team grants. The
athlete alone grants or revokes their own permission through
`set_my_team_exercise_recording_permission`; the RPC derives the athlete Profile from
the authenticated account and requires both completed Free/Athlete identity and an
active Team Membership. Regranting creates a new period rather than erasing history.

The permission is neither Team Membership, a data-sharing grant, an entitlement nor
lasting result access. Active Team members may read only current permission facts for
roster eligibility; an athlete may read their own permission history. Browser roles
receive no direct write privilege.

## Decision 2 — one immutable coordination envelope, separate athlete bundles

`team_exercise_sessions` is the shared completed-Session coordination record. It stores
the Team, exact server-derived recorder Profile, terminal timestamps, schema version,
digest and a lossless TEXT payload. Its relational participant and execution-reference
rows are the authority manifest. The envelope contract excludes performance results and
private Athlete Notes.

`team_exercise_result_bundles` stores one immutable, athlete-owned bundle per training
athlete and Session. Each bundle keeps its own exact TEXT payload, server-derived
recorder provenance, digest and relational stable result/execution references. One
bundle may contain several Exercise Results later without changing the ownership
boundary. Embedded attempts and Measurements retain their stable IDs inside the exact
payload; retry never duplicates them because the complete bundle is immutable under one
stable ID and conflicting content is refused.

TEXT, rather than JSONB, follows ADR-0027's representability decision: exact serialized
TypeScript strings may contain JSON escapes PostgreSQL JSONB cannot losslessly accept.
Only UUID manifests are relational. The next TypeScript integration gate must serialize
coordination and athlete content separately and validate both before upload; the server
never interprets an opaque payload as a permission claim.

## Decision 3 — partial upload is one envelope call plus independent bundle calls

`put_team_exercise_session` first installs the immutable envelope. It authenticates the
recorder, requires current recorder Team authority, proves every snapshotted participant
belonged to the Team at Session start, proves every training athlete has the platform
Athlete/Free foundation, and records the caller Profile as recorder without accepting a
recorder parameter.

`put_team_exercise_result_bundle` is then called independently for each athlete. For a
new bundle it revalidates the current Team, original recorder, athlete participation,
execution manifest, Athlete/Free capability, current athlete Membership and prospective
recording permission. An athlete-specific failure returns `blocked` plus one stable
reason and writes nothing. It cannot roll back a bundle another call already accepted.
Global recorder or Team failure remains a closed RPC error.

The affected athlete may call `approve_my_team_exercise_session`. This one-way approval
applies only to that concrete, already-snapshotted Session and may override missing
current Membership or prospective recording permission for its later retry. It never
creates a prospective Team permission, restores Membership or grants anyone result
access. Only an original training athlete may approve.

## Decision 4 — idempotence is exact and acknowledges already accepted data

Session, bundle, execution and result identities are client-generated UUIDs. The server
calculates payload SHA-256 digests. A retry with identical identity, metadata, payload
and manifest returns `already_present`; a different meaning under the same identity
returns `conflict` and never overwrites. The first envelope insert alone emits the
coordination audit event, so a lost response cannot duplicate it.

An identical retry is acknowledged before current permission is rechecked. That is not
a new write or a retroactive permission shortcut: it lets a device recover a lost
acknowledgement for data the server already accepted. A different authenticated Profile
can never take over the upload; the stored original recorder must match.

## Decision 5 — RLS follows athlete ownership, never former participation

An athlete with an accepted bundle may read their own bundle and its shared coordination
context. They cannot read another athlete's bundle. The recorder, Coach, supporting
participant, later joiner and former participant receive no historical read merely from
their Session role. Lasting Team access still requires the separate data-sharing model.

Private notes live in `team_exercise_private_notes`, physically outside both
recorder-authored payloads. Only the authenticated owner of the referenced Athlete
Result may create, edit, clear or read the note. Clearing removes the note row and emits
no Team notification. All eight tables have RLS; `authenticated` has SELECT only and no
direct write, `anon` has no table or RPC access, and every mutation is a pinned
`SECURITY DEFINER` function.

## Decision 6 — authority races have a defined linearisation boundary

Permission grant/revoke and first bundle acceptance share a per-Team/per-athlete
transaction advisory lock. Team rows and current Membership rows are held with row
locks while first writes decide authority, so archive/removal cannot commit between the
decisive check and insert. A concurrent change therefore linearises fully before or
after the accepted bundle. Session approval and bundle upload share a per-Session/
athlete lock. Exact retry paths perform no new protected write and return the already
durable outcome.

## Verification

The three `20260828120*` migrations apply from scratch after the existing ten. The
`team_exercise_cloud.test.sql` pgTAP suite runs 68 assertions over grant/revoke history,
server recorder derivation, lossless payloads, envelope and bundle idempotence,
conflicts, partial rejection, concrete approval, former-Membership handling, ownership
RLS, private-note isolation, direct-write denial, anonymous denial, grants and pinned
function search paths. It passes 68/68 against real local Supabase Postgres.

The permission-versus-first-bundle lock was also exercised with two independent local
Postgres sessions and an open six-second transaction in both orderings. Bundle-first
accepted exactly one bundle and the concurrent revocation completed afterwards;
revocation-first caused the waiting first bundle attempt to return
`blocked / recording_permission_missing` and inserted nothing. These are manual
multi-session observations, not assertions executed by pgTAP.

## Consequences and remaining gates

- Stage C now has a real server authority and ownership boundary; Team result data is
  no longer waiting on an unspecified relational mapping.
- This stage deliberately does not add a second browser queue. **Since implemented:**
  ADR-0033 extends ADR-0027's existing Profile-scoped durable outbox with envelope and
  bundle entries, reload/account-switch isolation and retry receipts.
- No Team Exercise start/read UI or athlete restore model,
  Measured Team runner integration, revision/void workflow or participant notification
  exists yet. C2a plus C2b are not athlete-usable or release-ready.
- The accepted source-diagram rights gate is unaffected.
