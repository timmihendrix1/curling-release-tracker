# Database tests

This directory holds three pgTAP suites over the ten migrations in
`supabase/migrations/`. All three have been executed against a real local Supabase
Postgres applied from scratch, and all three are green.

| Suite | Covers | Recorded result |
|---|---|---|
| `identity_onboarding.test.sql` | Stage B0.2a — the four Identity/Onboarding tables, their RLS and grant boundary, and the four new RPCs | **187 planned, 187 run, 0 failures** |
| `team_foundation.test.sql` | The Team Foundation beta plus B0.2e bootstrap-retirement privilege boundary | **102 planned, 102 run, 0 failures** |
| `free_cloud_sporting_records.test.sql` | Stage B0.4 exact terminal records, authority, RLS, idempotency, conflicts, transactional raw-payload deletion, tombstones and restore | **37 planned, 37 run, 0 failures** |

Run them from scratch, in this order:

```sh
supabase db reset --local --no-seed --yes            # applies all ten migrations
supabase test db --local supabase/tests/identity_onboarding.test.sql
supabase test db --local supabase/tests/team_foundation.test.sql
supabase db reset --local --no-seed --yes
supabase test db --local supabase/tests/free_cloud_sporting_records.test.sql
```

**Reset first.** `identity_onboarding.test.sql` asserts global zero-counts, and both
suites publish their own active legal-document fixtures. They therefore require a
freshly reset database without `supabase/seed.sql` — see the detailed precondition
notes below. Running a suite after the E2E seed correctly fails on the one-active-
document-per-kind constraint rather than silently reusing a different legal snapshot.

Neither suite ships any test scaffolding into a product migration: each creates its
`tests` schema, role-switching helpers and their single `grant usage` inside its own
transaction and removes them again with its closing `rollback`. Neither depends on an
optional test-helper extension — only pgTAP itself, which `supabase test db` provides
for the duration of the run.

---

# Identity and Onboarding suite (Stage B0.2a)

**Status: executed and passing. This does not make Stage B0.2 releasable** — see
"Stage status" at the end of this section.

## Purpose

`identity_onboarding.test.sql` exercises the additive, server-authoritative Identity
and Onboarding foundation introduced by the three `20260825*` migrations:

- **`public.legal_documents`** — immutable versioned legal metadata, one active version
  per kind, one-way retirement, atomic rotation, and the defence-in-depth safe-URL
  constraint;
- **`public.legal_acceptances`** — append-only evidence whose action is coupled to its
  document kind by constraint and whose kind is pinned to the document by a composite
  foreign key;
- **`public.profile_onboarding`** — the write-once completion fact, pinned to both exact
  evidence rows by composite foreign keys that prove same-Profile, correct-kind and
  correct-action structurally;
- **`public.profile_entitlements`** — at most one active entitlement per (Profile, tier);
- **`get_current_legal_documents()`**, **`ensure_my_profile()`**,
  **`get_my_gate_state()`** and **`complete_personal_onboarding()`**.

## Command, precondition and recorded result

```sh
supabase db reset --local --no-seed --yes
supabase test db --local supabase/tests/identity_onboarding.test.sql
```

Recorded result: **187 assertions planned, 187 run, 0 failures** — `Files=1,
Tests=187 ... Result: PASS`.

**The reset is a genuine precondition, not a habit.** Several assertions are
deliberately *global* zero-counts — "`ensure_my_profile` creates no Athlete capability
**anywhere**" is a stronger claim than "none for this Profile" — and the suite publishes
its own legal-document fixtures, which collide with any already-published current
version. Committed pre-existing rows (for example the ones the concurrency procedures
below deliberately leave behind) therefore make the file **fail loudly with a bad
plan**. That direction is intended: a dirty database can never produce a vacuous pass
here. Re-run `supabase db reset` before trusting a result.

`select plan(187);` is kept in sync with the actual assertion count; re-run

```sh
grep -cE "^select (ok|is|isnt|lives_ok|throws_like)\(" supabase/tests/identity_onboarding.test.sql
```

after editing and update `plan(...)` to match. A mismatched plan is itself a pgTAP
failure, not a documentation nit.

## Coverage map

| Area | Covered by |
|---|---|
| `ensure_my_profile` creates exactly one Profile and one account link; `Profile.id` is never the `auth.users.id`; repeat calls return the same UUID | §1 |
| A bare Profile grants nothing — no Athlete, no entitlement, no acceptance, no completion, and no gate facts in the derived state | §1 |
| Missing/unresolvable auth identity fails closed on every identity RPC | §1 |
| A non-NULL JWT subject naming **no existing `auth.users` row** (a token that outlived its account) is refused by `ensure_my_profile` with the same normalized `forbidden:` message, and leaves no orphan Profile, account link, acceptance, Athlete, entitlement or onboarding row | §1 |
| That refusal leaks nothing: the **whole client-visible payload** — primary message *plus* `DETAIL` *plus* `HINT`, which is exactly what PostgREST returns — carries no UUID, constraint name, relation/table wording or other SQL detail, and the diagnostic `CONTEXT` (a caller never sees it, a server log does) names no identity relation, constraint or identifier either | §1 |
| All four locking mechanisms are still present in the deployed functions — both per-account advisory locks, the `for key share` hold on the auth account, and the `LOCK TABLE ... IN SHARE MODE` on `legal_documents` — and the Legal lock is taken **after** the completion-first short-circuit and **before** the single-statement resolution of the active pair (the genuinely concurrent behaviour is Procedures A/B/C below) | §1 |
| Exactly **one** statement resolves both current legal document ids, so the pair can never come from two snapshots | §1 |
| The Legal SHARE lock is observed for real in `pg_locks`: zero held before the first successful completion, exactly one held after it returns — so the lock outlives validation, both evidence writes and the completion row | §6 → §7 |
| Safe-URL constraint: accepts an ordinary absolute HTTPS URL; rejects `http:`, `javascript:`, `data:`, `blob:`, `file:`, protocol-relative `//host`, credentials in the authority, embedded whitespace, an embedded control character, and both empty-authority forms | §2 |
| Genuine absence of a current legal document is no row — never a NULL row, never an error — and completion is refused with `legal_unavailable` for a missing Terms and, separately, for a missing Privacy Notice | §3 |
| `legal_documents` is unreadable directly by `authenticated` and by `anon`; the RPC is the only path, and `anon` may use it | §3 |
| Completion with no Profile: `profile_required`, and no Profile, link, acceptance, Athlete, entitlement or completion is created | §4 |
| Display-name validation: NULL, blank, whitespace-only and oversized are all refused, and none touches the bare Profile | §5 |
| Supplied-id precedence: NULL, forged/unknown, wrong-kind and duplicated ids are `invalid_input`; a retired **correct-kind** document is `stale_legal_version`; a retired **wrong-kind** document stays `invalid_input` | §6 |
| Expected failures leak no constraint name, SQL detail or UUID — asserted over the same full message + `DETAIL` + `HINT` payload, since `sqlerrm` alone would not show a leaked key value | §6 |
| Successful completion establishes the trimmed display name, both pinned evidence rows with the correct actions, Athlete capability, the active Free entitlement and the completion fact | §7 |
| Atomic rollback after a deliberate late failure: nothing is left behind, and the pre-existing bare Profile survives with its display name still unwritten | §8 |
| Snapshot coupling: after an atomic rotation to v2, the v1 ids are refused with `stale_legal_version`, zero side effects follow, no acceptance anywhere references v2 as a consequence, and a fresh v2 snapshot then succeeds and pins v2 | §9 |
| Completion-first idempotence across a rotation: the retried original payload is a no-op; display name, completion timestamp and pinned evidence are unchanged; pinned fields still report v1 while the reporting-only current fields report v2; a further retry with a different name and forged ids is also a no-op | §10 |
| Evidence pinning rejects wrong-Profile, wrong-kind and wrong-action evidence at the **schema** boundary, not merely because the RPC is careful | §11 |
| `legal_acceptances` and `profile_onboarding` refuse UPDATE and DELETE | §12 |
| Legal lifecycle: a second active version per kind is refused; changing another column during retirement is refused; DELETE is refused; a failed replacement insert rolls the retirement back and leaves exactly one current version; one valid retirement succeeds; unretirement, timestamp rewriting and a second retirement update are all refused | §13 |
| Access control: `authenticated` cannot INSERT/UPDATE/DELETE any of the four tables (nor create an Athlete row); own-Profile reads succeed; cross-Profile reads return zero rows; `anon` is denied on all four tables and on the three identity RPCs | §14 |
| Structural boundary: no write grants, no `anon` privilege, RLS enabled on all four tables, no non-SELECT policy, pinned `search_path` on all eight new functions, PUBLIC execute revoked, exact RPC grant matrix, no caller-identity parameter, the five-field narrow return shape, no `marketing_consents`, no stored gate-eligible flag, no auth-id/role shortcut column, and no non-`example.invalid` legal URL | §15 |

## Kinds of coverage

The Team suite's three categories, plus one this suite needs and the Team suite does
not. All four prove different things:

- **Behavioural, single-session assertions** — one real RPC call, or one RLS-gated
  `select`, or one denied direct write, under the exact role being tested.
- **Structural/introspection assertions** (§15, plus the seven locking-mechanism
  assertions in §1) — catalog reads over `pg_proc`, `pg_class`, `pg_policies`,
  `has_table_privilege`/`has_function_privilege`, and `pg_get_functiondef` for the
  locking mechanisms and their ordering. These catch changes that would leave every
  behavioural assertion still passing: an added write grant, an `anon` SELECT grant, an
  unpinned `search_path`, a reverted `select *` return shape, a stored gate-eligible
  flag, a dropped table lock, or a resolution split back into two statements. They read
  source text, so they pin the *mechanism and its order*, not its effect.
- **In-transaction lock observation** (§6 → §7) — one thing the source text cannot show
  and a single transaction can: `LOCK TABLE ... IN SHARE MODE` is transaction-duration
  and the suite is one transaction, so the lock a completion takes is still in
  `pg_locks` for that backend afterwards. Zero before the first successful completion,
  exactly one after. This is the real lock, not a claim about it.
- **Multi-session concurrency procedures** — documented as SQL comments at the end of
  `identity_onboarding.test.sql` and summarised below. They are **run by hand** and are
  **not executed by this file or by any automated process in this repository.**

## Concurrency procedures (executed)

pgTAP runs single-threaded inside one transaction and cannot make one backend block on
a lock another backend holds. The three procedures were therefore run by hand against
the local Supabase Postgres, with genuinely concurrent, independent `psql` sessions and
a further connection reading `pg_stat_activity` and `pg_locks` while a session was
waiting. Every figure below is a recorded observation from the run against **this** state
of the working tree — pids, UUIDs, version labels, timestamps and durations included.
The full step-by-step transcripts are the `OBSERVED` lines at the end of
`identity_onboarding.test.sql`.

| Procedure | Blocking evidence | Outcome |
|---|---|---|
| **A — concurrent `ensure_my_profile`, same account** | Observer showed exactly one waiting backend: pid 349, `state = active`, `wait_event_type = Lock`, `wait_event = advisory`, on `select (public.ensure_my_profile()).id`; `pg_locks` showed advisory key `objid = 2001405470` granted to pid 347 and **not** granted for pid 349. Session 1 held its transaction open 10 s; session 2 started 2 s in and returned after **8.007 s** — ending exactly when session 1 committed. | Both sessions returned the **same** Profile UUID (`f94e6f90-6bf4-4e1d-bd31-8d9a9a828c2b`). Final state: exactly one `profiles` row and one `account_profile_links` row for the account; **zero** rows in `athletes`, `profile_entitlements`, `legal_acceptances` and `profile_onboarding`. |
| **A step 6 — `for key share` on the auth account** | With a Profile creation in flight and uncommitted, an owner-operated `delete from auth.users` for that account blocked **6.029 s**; observer showed pid 702, `wait_event_type = Lock`, `wait_event = transactionid`. | After the creation committed, the DELETE resumed and then **failed** on `account_profile_links_account_id_fkey` — the correct end state, since a committed link now protects the account under `on delete restrict`. The `auth.users` row and the link both survive; there was no instant at which the account could have vanished mid-creation. |
| **B — concurrent `complete_personal_onboarding`, same incomplete Profile** | Observer showed one waiting backend: pid 439, `state = active`, `wait_event_type = Lock`, `wait_event = advisory`, on the loser's `complete_personal_onboarding` statement (advisory key `objid = 4018907541`, granted to pid 438, not granted for pid 439). The same read showed pid 438 holding **`ShareLock` on `public.legal_documents`** — the Legal lock sighted in a genuinely concurrent session. The loser blocked **8.0145 s**. | The loser returned **without error**, carrying the winner's state field for field: `display_name = 'Winner Name'` (not its own `'Loser Name'`), `completed_at = 2026-08-26 08:26:28.483314+00`, `pinned_terms_document_id = 3fd64022-74a9-4b49-bcac-de0a5bc18f0e`. Its own deliberately forged legal ids were **never inspected** — an `invalid_input` failure would have proved the completion-first check ran too late. Final state: exactly one `profile_onboarding` row, one `athletes` row, one **active** `free` entitlement, two `legal_acceptances` rows (`accepted` / `acknowledged`), and `display_name = 'Winner Name'`. The loser wrote nothing. |
| **C, ordering 1 — completion open, Legal rotation waits** | The completing session returned, holding its transaction open. The owner-operated four-statement rotation to v2 was attempted 2 s later and its **first** statement did not return for **8.0076 s**. Observer showed pid 525, `state = active`, `wait_event_type = Lock`, `wait_event = relation`, on that `update public.legal_documents`; on that relation pid 524 held `AccessShareLock`, `RowShareLock` and `ShareLock` (all granted) while pid 525's `RowExclusiveLock` was `granted = f`. | The rotation's blocked statement returned 8 ms after the completion committed, and the remaining three statements plus commit then ran. The completion stayed pinned to what it accepted — `pinned_terms_version_label = 'proc-tos-v1'`, `pinned_privacy_version_label = 'proc-pn-v1'` — while the reporting-only fields moved to `'proc-tos-v2'` / `'proc-pn-v2'`. Nothing was ever half-rotated. |
| **C, ordering 2 — Legal rotation open, onboarding waits, then is refused** | The owner-operated rotation to v3 was held open. An incomplete Profile submitting the **prior (v2)** ids — current when it read them — blocked **8.0076 s**. Observer showed pid 624, `state = active`, `wait_event_type = Lock`, `wait_event = relation`, on the completion statement; pid 627 (rotation) held `RowExclusiveLock` granted, pid 624's `ShareLock` was `granted = f`. The wait happened **before** any resolution of the active pair. | After the rotation committed, the completion resumed and raised **`stale_legal_version`**, with the caller's Profile left completely bare: `display_name` NULL and zero `profile_onboarding`, `legal_acceptances`, `athletes` and `profile_entitlements` rows. **This is the discriminating result:** had the pair been resolved before locking, or without a lock, the call would have read the pre-rotation snapshot in which those ids were still current and would have **succeeded**, pinning a pair that had already ceased to be current. |
| **C, ordering 2, session 4 — a completed Profile's retry does not wait** | Issued while the rotation was still open, with a different display name and forged legal ids. | Returned in **0.007 s** — no wait at all — with `display_name = 'Winner Name'` unchanged, `pinned_terms_version_label = 'proc-tos-v1'` and `current_terms_version_label = 'proc-tos-v2'` (the uncommitted v3 correctly invisible). The completion-first short-circuit is genuinely reached before the Legal lock, so a retry after a lost response never waits on a rotation and never re-accepts anything. |

All three procedures commit their fixtures, so they leave rows behind. Re-run
`supabase db reset --local --no-seed --yes` before running the pgTAP suites again.

## The new coverage was checked against the defects it exists for

A passing assertion proves nothing about a defect unless it would have failed on the
defective code, so both corrections were checked that way: the previous shape of each
function was installed over the fixed one with `create or replace` on a freshly reset
local database (a scratch step, not part of any migration or of the suite), the suite
was re-run, and the intended assertions failed.

- **Previous `complete_personal_onboarding`** (two separate current-document `SELECT`s,
  no table lock): failed exactly the four §1 locking/ordering assertions and the §7
  `pg_locks` observation. `Result: FAIL`, `Failed tests: 27-30, 93`.
- **Previous `ensure_my_profile`** (no auth-account existence check): failed the
  `forbidden:` assertion, both client-visible-payload assertions, the `CONTEXT`
  assertion and the `for key share` assertion. `Result: FAIL`,
  `Failed tests: 18-21, 26`. The observed leak was
  `insert or update on table "account_profile_links" violates foreign key constraint
  "account_profile_links_account_id_fkey"` with
  `DETAIL: Key (account_id)=(…) is not present in table "users".`

One honest limitation of that check: the "leaves no orphan Profile / no other identity
row" assertions pass against **both** shapes, because pgTAP's exception subtransaction
rolls the tentative Profile back regardless. They still state a required invariant, but
they are not the assertions that catch this defect — the payload and `CONTEXT`
assertions are.

**What the procedures do not cover.** They exercise the locks against *direct
owner-operated* Legal DML, which is the only way a legal document is ever written —
this stage ships no Legal-rotation RPC and adds no test-only hook. They say nothing
about a superuser altering the schema, and nothing about a Legal-rotation application
surface, which this stage does not implement.

## What this stage does and does not establish

**Established:** the SQL foundation and the mounted B0.2 application integration are
implemented. All ten migrations apply from scratch; `complete_personal_onboarding`
is the only browser-reachable writer of the onboarding consequence set.

**Not established, and not claimed:**

- **The approved closed-test legal rows are still required operationally.** No migration
  seeds a legal document, and every fixture in the suite is fictional metadata under
  `example.invalid`. **No real legal document, legal copy, production URL, version
  identifier, controller detail, retention claim, subprocessor or transfer claim is
  authored anywhere in this repository.** Real testing needs those rows supplied
  operationally first; `supabase/seed.sql` contains explicitly local E2E-only fixtures
  and is not a production Legal version.
- **`bootstrap_profile` is retired from browser use.** Migration
  `20260827120000_retire_team_profile_bootstrap.sql` revokes it from `public`, `anon`
  and `authenticated`; the Team suite proves the authenticated denial.

## Stage status

**B0.2 is never independently release-ready.** Its database suite proves identity and
onboarding facts, not sporting-data isolation. B0.2 and B0.3 are one releasable privacy
unit because the gate introduces account switching and therefore requires Profile-scoped
sporting persistence before release. B0.3 now supplies that local isolation in the
application; these migrations still introduce no cloud sporting persistence. The
combined working tree must pass its application, database, account-switch and browser
verification before deployment to a hosted production database.

---

# Team Foundation suite

**Status: executed and passing — updated by Stage B0.2e.** The three original Team
Foundation migrations remain unchanged. The suite now establishes its test Profiles
through canonical personal onboarding and proves that the forward retirement migration
denies browser execution of the former bootstrap route:

```sh
supabase db reset --local --no-seed --yes            # applies all ten migrations
supabase test db --local supabase/tests/team_foundation.test.sql
```

Recorded result: **102 assertions planned, 102 run, 0 failures** — `Files=1,
Tests=102 ... Result: PASS`. The two-session concurrency procedures at the end of
`team_foundation.test.sql` have also been executed for real (see "Concurrency
procedures" below); they are the one part of the matrix pgTAP itself cannot cover.

The suite is self-contained: it needs nothing in the database beyond the three Team
Foundation migrations, and the three identity migrations do not affect it. The `tests`
schema, its role-switching helpers, and the single
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
| 2 | Lazy Athlete creation, idempotency | **Reconciled in Stage B0.2a.** No *Team Foundation* RPC creates an `athletes` row, and ADR-0022 Decision 10 remains true of the Team service — this suite is unchanged and still asserts the table/constraint shape only. The first writer anywhere is now `complete_personal_onboarding` (Stage B0.2a), which is not a Team RPC; the activation behaviour, its atomicity and its idempotence are proven by `identity_onboarding.test.sql` §7, §8 and §10, not here |
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

`select plan(102);` at the top of `team_foundation.test.sql` is kept in sync with the
actual assertion count in that file — re-run
`grep -cE "^select (is|isnt|ok|lives_ok|throws_like|matches)\(" team_foundation.test.sql`
after editing the file and update `plan(...)` to match before trusting it; a
mismatched plan count is itself a pgTAP failure (missing or extra test), not merely
a documentation nit.

## Kinds of coverage

This suite's assertions fall into the same three categories, which prove different
things:

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
