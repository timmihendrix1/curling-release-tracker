# Team Foundation database tests

**Status: written, NOT executed.** This environment has no `supabase` or `docker`
CLI available, so these pgTAP tests could not be run against a real Postgres
instance, and the schema/RLS/RPC migrations in `supabase/migrations/` could not be
verified by actually applying them. Do not treat this suite as proof the backend
works — it is a reviewed, unexecuted specification of the required database test
matrix, manually traced statement-by-statement against the actual RPC bodies for
internal consistency (correct role at each step, correct GUC values in scope,
correct expected error kind), which is a real but different thing from having
actually run once. Run it with:

```sh
supabase start
supabase db reset   # applies every migration in supabase/migrations/ from scratch
supabase test db    # runs every *.sql file in this directory via pgTAP
```

## Role discipline (corrected)

An earlier revision of `team_foundation.test.sql` performed privileged fixture
setup (seeding `auth.users`, granting a pilot capability, deliberately violating
the one-active-membership constraint to prove it's enforced) while `SET ROLE
authenticated` was still in effect from a preceding `tests.act_as(...)` call.
`authenticated` has no table-level INSERT/UPDATE/DELETE grant on any Team
Foundation table at all (every mutation goes through a SECURITY DEFINER RPC — see
the RLS migration's own header) — those statements would have failed on a bare
permission error before ever reaching whatever the test actually meant to exercise,
or, worse, could have silently behaved differently from what the test's `-- comment`
claimed if the local grant model ever happened to differ from that assumption.

This is corrected: `tests.reset_to_owner()` (calls `reset role`) is now called,
explicitly, before every privileged fixture statement, and the correct
`tests.act_as(...)`/`tests.act_as_anon()` call is repeated immediately afterward to
restore the exact role a following behavioral assertion needs. Every remaining
`insert`/`update` in the file that is NOT wrapped this way is a genuine RPC call
running under the role actually being tested.

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
| 10 | Admin request success/wrong-nominee/idempotent-accept/effectively-pending uniqueness/membership-invalidation | `team_foundation.test.sql` §5 (correction item 1) |
| 10b | Admin request revoke-vs-accept ordering (sequential case: revoking an already-accepted request is a no-op, never retroactive) | `team_foundation.test.sql` §5; the genuinely CONCURRENT race (both operations racing in real time) is **not** exercised here — see "Manual two-session procedures" below |
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
| 23 | `restore_team`/`relinquish_own_admin` lock ordering regression coverage — the sequential cases pgTAP can represent (correction item 1); the genuine cross-session race is manual-only, see Procedures D/E below | `team_foundation.test.sql` §15 |
| 24 | `list_admin_requests_for_team` is genuinely admin-only, not merely RLS-gated (correction item 2); its return type is a narrow, explicit 9-field composite, not `team_admin_requests` itself/`select *` (correction item 5, third pass) | `team_foundation.test.sql` §16 |

`select plan(91);` at the top of `team_foundation.test.sql` is kept in sync with the
actual assertion count in that file — re-run
`grep -cE "select (is|isnt|ok|lives_ok|throws_like)\(" team_foundation.test.sql`
after editing the file and update `plan(...)` to match before trusting it; a
mismatched plan count is itself a pgTAP failure (missing or extra test), not merely
a documentation nit.

## Executed vs. structural vs. manual-only coverage (correction item 12)

To avoid overclaiming, this suite's assertions fall into three distinct categories:

- **Behavioral, single-session assertions** (the large majority — §1–§9 minus the
  spoofing/search_path checks, §10, §12): each exercises one real RPC call under the
  exact role being tested and asserts its outcome. These are "written, reviewed,
  never executed" — not "verified."
- **Structural/introspection assertions** (parts of §9, all of §11, and one
  assertion in §16): query `pg_proc`/`pg_namespace`/`pg_type`/`pg_attribute`/
  `has_function_privilege` directly rather than calling an RPC — these prove a
  property of the compiled function catalog (search_path pinning, grant
  revocation, absence of a caller-identity parameter, and — added in the third
  correction pass — `list_admin_requests_for_team`'s actual declared return
  columns, so reverting it to `select *`/`returns setof team_admin_requests` would
  be caught even if the now-unused narrow composite type were left behind) and do
  not depend on any table data at all.
- **Manual, two-session procedures** (documented as SQL comments at the end of
  `team_foundation.test.sql`, NOT executed by this file or any automated process):
  Procedure A (accept vs. revoke a single Admin Request racing), Procedure B (accept
  an Admin Request vs. remove_member/leave_team ending its membership, racing),
  Procedure C (two concurrent `create_admin_request` calls for the same membership),
  Procedure D (`restore_team` vs. the final active admin's `leave_team`), and
  Procedure E (`restore_team` vs. the final active admin's `relinquish_own_admin`).
  Procedures D and E are the primary scenario this correction pass's lock-ordering
  fix (docs/adr/0022 §Team Lifecycle Lock Ordering) exists to close — an active Team
  reaching zero active Team Admins via a restore racing a final admin's exit. pgTAP
  runs single-threaded inside one transaction and cannot make one backend block on a
  row lock held by another — these five scenarios are exactly the ones the SQL-level
  locking added in this and the prior correction pass is meant to make safe, and
  they are the ones most in need of hand verification with two real concurrent
  `psql`/client connections once `supabase`/docker tooling is available in an
  environment that has it. Do not describe these as "covered" without actually
  running them.

**Honest scope note:** given this suite could not be executed even once, it remains
a representative, reviewed set of assertions per category rather than an
exhaustively enumerated one-test-per-scenario suite.
