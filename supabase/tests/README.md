# Team Foundation database tests

**Status: executed and passing.** The three migrations in `supabase/migrations/` have
been applied from scratch against a real local Supabase Postgres, and this suite runs
green against that database:

```sh
supabase db reset --local --no-seed --yes            # applies all three migrations
supabase test db --local supabase/tests/team_foundation.test.sql
```

Recorded result: **101 assertions planned, 101 run, 0 failures** — `Files=1,
Tests=101 ... Result: PASS`. The two-session concurrency procedures at the end of
`team_foundation.test.sql` have also been executed for real (see "Concurrency
procedures" below); they are the one part of the matrix pgTAP itself cannot cover.

The suite is self-contained: it needs nothing in the database beyond the three
product migrations. The `tests` schema, its role-switching helpers, and the single
`grant usage on schema tests to authenticated, anon` they require are created inside
the file's own transaction and removed again by its closing `rollback`. No product
migration creates a `tests` schema (that would ship test scaffolding to production),
and the suite depends on no optional test-helper extension — only pgTAP itself, which
`supabase test db` provides for the duration of the run.

## Table privileges are load-bearing, not decoration

RLS **narrows** an access the table ACL already permits; it never **grants** one. A
role with no table-level `SELECT` privilege is rejected before any policy is
consulted, so a `SELECT` policy with no matching grant is dead code — which is
exactly what the RLS migration originally shipped. The migration now issues explicit
grants, and §17 of the suite asserts the resulting boundary directly:

- `authenticated` holds `SELECT` on all eleven Team Foundation tables and remains
  constrained by the policies;
- `authenticated` holds no `INSERT`/`UPDATE`/`DELETE` on any of them — every mutation
  stays SECURITY DEFINER RPC-only;
- `anon` holds nothing at all, so a signed-out direct read fails closed with
  `permission denied` rather than returning an empty result set.

§17 exists because the behavioural assertions cannot see all of these failure modes
on their own: adding a write grant, or an `anon` `SELECT` grant, would leave every
other assertion in the file still passing.

## Role discipline

`authenticated` has no table-level `INSERT`/`UPDATE`/`DELETE` grant on any Team
Foundation table, so privileged fixture setup (seeding `auth.users`, granting a pilot
capability, deliberately violating the one-active-membership constraint to prove it is
enforced) must not run under it — those statements would fail on a bare permission
error before reaching whatever the test meant to exercise.

`tests.reset_to_owner()` (which calls `reset role`) is therefore called explicitly
before every privileged fixture statement, and the correct
`tests.act_as(...)`/`tests.act_as_anon()` call is repeated immediately afterward to
restore the exact role a following behavioural assertion needs. Every remaining
`insert`/`update` in the file that is NOT wrapped this way is a genuine RPC call
running under the role actually being tested.

## Fixture identity discipline

The whole file runs in one transaction, where `now()` — and therefore every
`created_at` — is constant, and two of its teams deliberately share the name
`Rink Rats`. Neither a name lookup nor `order by created_at` can distinguish rows
created inside it. Every Team, Membership and Invitation the suite refers to later is
therefore identified by an ID captured at the moment it was created or accepted and
held in a `tests.*` GUC.

Two further rules follow from RLS rather than from ordering:

- A Membership ID is captured **while acting as the account that owns it** (a caller
  always sees its own membership rows). `account_profile_links` exposes only the
  caller's own link row, so resolving another account's profile through it from an
  authenticated context silently yields no row — and an assertion built on that then
  passes for the wrong reason.
- Every capture uses `select ... into strict`, so a fixture that matches no row (or
  more than one) aborts the suite loudly instead of binding NULL into a later
  assertion.

## Coverage map (required test items 1-20, plus correction-pass additions)

| # | Requirement area | Covered by |
|---|---|---|
| 1 | Profile/account-link cardinality, Profile id ≠ auth uid | `team_foundation.test.sql` §1 |
| 2 | Lazy Athlete creation, idempotency | Not schema-enforced by a trigger in this beta — `athletes` rows are only ever inserted by a future athlete-activation RPC not yet built (no UI path creates one yet); §1 asserts the table/constraint shape only |
| 3 | Pilot-gated creation; invite-based joining without the grant | `team_foundation.test.sql` §2 |
| 4 | Duplicate team names allowed | `team_foundation.test.sql` §2 |
| 5 | Multiple active teams per Profile | `team_foundation.test.sql` §2, §4b (a fourth account creates and administers its own, separate team) |
| 6 | One active Membership per Team/Profile; historical periods allowed | `team_foundation.test.sql` §3 (unique index, exercised under the owning role — see Role discipline above) |
| 7 | Composable functions, independent participation | `team_foundation.test.sql` §3; the full 8-combination matrix is covered by `src/lib/team/__tests__/fakeTeamService.test.ts`, not re-enumerated here |
| 8 | Team creation atomically creates membership + Team Admin | `team_foundation.test.sql` §2 |
| 9 | Invitation success/expiry/replacement/resend/revocation/replay/wrong-email/malformed/already-member | `team_foundation.test.sql` §4, §12 (revision invalidates the old link, correction item 7) |
| 9b | Invitation attribution — the CREATOR of a specific invitation, not the team's founder | `team_foundation.test.sql` §4b (correction item 7) |
| 9c | Invitation token generation and token-at-rest: a real `create_invitation` proves `private.generate_raw_token`/`private.hash_token` resolve pgcrypto (installed in `extensions`, while every calling RPC pins `search_path = public, pg_temp`), the stored value is exactly SHA-256(raw token), and the raw token is never persisted | `team_foundation.test.sql` §4a |
| 10 | Admin request success/wrong-nominee/idempotent-accept/effectively-pending uniqueness/membership-invalidation | `team_foundation.test.sql` §5 (correction item 1) |
| 10b | Admin request revoke-vs-accept ordering (sequential case: revoking an already-accepted request is a no-op, never retroactive) | `team_foundation.test.sql` §5; the genuinely CONCURRENT race (both operations racing in real time) is not exercised by pgTAP — see "Concurrency procedures" below, where it is executed with two real sessions |
| 11 | Last-Admin invariant: relinquish, leave, remove_admin_function (self-targeting) | `team_foundation.test.sql` §6 |
| 12 | Member leave/removal atomically ends every authorization path | `team_foundation.test.sql` §6 |
| 13 | Archived-team write denial (rename, remove_admin_function on another member), leave-while-archived (both an ordinary member and, separately, the sole admin), restore, exclusion of left-while-archived | `team_foundation.test.sql` §7 (correction item 8: `remove_admin_function` targeting another member is now confirmed blocked while archived, matching the `permissions.ts` fix) |
| 14 | Restricted recovery unreachable by anon/authenticated | `team_foundation.test.sql` §8 (`operational_recover_team_admin` grants) |
| 15 | Full RLS positive/negative matrix | `team_foundation.test.sql` §9 |
| 16 | Active-member email hidden from ordinary members, admin-only path | `team_foundation.test.sql` §9 |
| 17 | Client-supplied identity/team/owner spoofing rejected | `team_foundation.test.sql` §9 (every RPC derives identity from `auth.uid()`, never a parameter) |
| 17b | Cross-Team fail-closed: a Team ID or Membership ID from another Team is rejected, never silently reinterpreted | `team_foundation.test.sql` §9 (correction item: security invariants) |
| 18 | Audit events created exactly once, never client-forgeable | `team_foundation.test.sql` §10 |
| 19 | SECURITY DEFINER ownership/grants/search_path/PUBLIC-execute revocation | `team_foundation.test.sql` §11 |
| 20 | No service-role/secret capability accessible from browser roles | `team_foundation.test.sql` §11 (`operational_recover_team_admin` grant check) |
| 21 | Function-array input validation is total: NULL, duplicate, and unknown values all fail closed with `invalid_input` (correction item 6) | `team_foundation.test.sql` §13 |
| 22 | Membership write-time mutations (`set_participation`, `assign_direct_function`, `remove_direct_function`) succeed/are idempotent while active, and never create or modify state on an already-ended Membership (correction item 4) | `team_foundation.test.sql` §14 |
| 23 | `restore_team`/`relinquish_own_admin` lock ordering regression coverage — the sequential cases pgTAP can represent (correction item 1); the genuine cross-session race is two-session-only, see Procedures D/E below | `team_foundation.test.sql` §15 |
| 24 | `list_admin_requests_for_team` is genuinely admin-only, not merely RLS-gated (correction item 2); its return type is a narrow, explicit 9-field composite, not `team_admin_requests` itself/`select *` (correction item 5, third pass) | `team_foundation.test.sql` §16 |
| 25 | Table-level privilege boundary beneath RLS: `authenticated` has SELECT and no writes on all eleven tables; `anon` has no direct privilege of any kind | `team_foundation.test.sql` §17 |

`select plan(101);` at the top of `team_foundation.test.sql` is kept in sync with the
actual assertion count in that file — re-run
`grep -cE "^select (is|isnt|ok|lives_ok|throws_like|matches)\(" team_foundation.test.sql`
after editing the file and update `plan(...)` to match before trusting it; a
mismatched plan count is itself a pgTAP failure (missing or extra test), not merely
a documentation nit.

## Kinds of coverage

This suite's assertions fall into three categories, which prove different things:

- **Behavioural, single-session assertions** (the large majority): each exercises one
  real RPC call, or one RLS-gated `select`, under the exact role being tested and
  asserts its outcome.
- **Structural/introspection assertions** (parts of §9, all of §11 and §17, and one
  assertion in §16): query `pg_proc`/`pg_namespace`/`pg_type`/`pg_attribute`/
  `has_function_privilege`/`has_table_privilege` directly rather than calling an RPC.
  These prove properties of the catalog — `search_path` pinning, PUBLIC-execute
  revocation, absence of a caller-identity parameter,
  `list_admin_requests_for_team`'s actual declared return columns (so reverting it to
  `select *`/`returns setof team_admin_requests` is caught even if the narrow
  composite type were left behind), and the table-privilege boundary of §17 — and do
  not depend on table data at all.
- **Two-session concurrency procedures**, documented as SQL comments at the end of
  `team_foundation.test.sql`. pgTAP runs single-threaded inside one transaction and
  cannot make one backend block on a lock held by another, so these are run by hand
  against a real database with two concurrent connections. They are NOT executed by
  this file or by any automated process in the repository.

## Concurrency procedures

All five procedures, in both orderings each, have been executed against the local
Supabase Postgres with two genuinely concurrent sessions. In every ordering the
blocked session was confirmed to be waiting on a lock via `pg_stat_activity`
(`Lock/transactionid` for the row-lock cases, `Lock/advisory` for the team-invariant
cases) rather than merely being slow, and the resulting state was read back from a
third connection.

| Procedure | Ordering | Outcome |
|---|---|---|
| A — accept vs. revoke an Admin Request | accept first | revoke blocked, then completed as a no-op; request stayed `accepted`; nominee held exactly one active Team Admin function |
| A | revoke first | accept blocked, then failed `revoked`; request `revoked`; no Team Admin function granted |
| B — accept vs. `remove_member` | accept first | removal blocked, then ended the Membership (`removed`) and its just-granted Team Admin function atomically |
| B | remove first | accept blocked, then failed **`revoked`** (see below); Membership ended `removed`; no Team Admin function granted |
| C — two concurrent `create_admin_request` | — | exactly one succeeded; the other blocked, then failed `conflict: An Admin Request is already pending for this member.`; exactly one request row existed afterwards |
| D — `restore_team` vs. final admin's `leave_team` | restore first | leave blocked, then failed `last_admin_invariant`; final state: active Team, active Membership, one active Team Admin |
| D | leave first | restore blocked, then failed `forbidden`; final state: archived Team, zero active Memberships, zero active Team Admins |
| E — `restore_team` vs. final admin's `relinquish_own_admin` | restore first | relinquish blocked, then failed `last_admin_invariant`; final state: active Team, active Membership, one active Team Admin |
| E | relinquish first | restore blocked, then failed `forbidden`; final state: archived Team, active non-admin Membership, zero active Team Admins |

Procedures D and E are the primary scenario the lock-ordering design
(`docs/adr/0022` §Team Lifecycle Lock Ordering) exists to close — an active Team
reaching zero active Team Admins via a restore racing a final admin's exit. **No
observed state, in any procedure or ordering, contained an active Team with zero
active Team Admin functions.**

### Procedure B's remove-first error kind

An earlier revision of this documentation predicted that the blocked
`accept_admin_request` would fail with `conflict: This membership has already ended.`
It fails with `revoked: This Admin Request can no longer be accepted.` instead, and
the code is right: `remove_member` atomically revokes the member's pending Admin
Request as part of ending the Membership, and `accept_admin_request` checks the
request's status before the Membership's — so the request is already `revoked` by the
time the blocked call resumes, and it never reaches the membership-status branch.
Both are correct closed failures. The prose was wrong, not the precedence; the
precedence must not be reordered to match the old prose.

**Scope note:** this remains a representative set of assertions per category rather
than an exhaustively enumerated one-test-per-scenario suite.
