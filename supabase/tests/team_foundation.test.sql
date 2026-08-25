-- Team Foundation pgTAP suite — see README.md in this directory for the coverage map
-- and the recorded execution result. Run via
-- `supabase test db --local supabase/tests/team_foundation.test.sql`.
--
-- Auth simulation: Supabase's `auth.uid()` reads the `request.jwt.claims` GUC. This
-- suite sets it directly, via `set_config('request.jwt.claims', ..., false)` — the
-- third argument is `is_local`, and `false` makes the setting session-level rather
-- than transaction-local — alongside `set role authenticated`, rather than depending
-- on the optional `supabase_test_helpers` extension, so it has no extra dependency
-- beyond pgTAP itself.
--
-- Self-contained harness: the `tests` schema, its role-switching helpers, and the
-- single schema-usage grant the simulated roles need are all created INSIDE this
-- file's transaction, so the file runs against a database that has only the three
-- product migrations applied — `supabase db reset` then `supabase test db`, nothing
-- else. Nothing here is created by a product migration (a permanent `tests` schema in
-- a migration would ship test scaffolding to production), and the closing `rollback`
-- removes the schema, the helpers and the grant together.
--
-- Fixture identity discipline: every Team, Membership and Invitation this suite later
-- refers to is identified by an ID captured at the moment it was created or accepted,
-- held in a `tests.*` GUC. Nothing is re-found by name, by `created_at` ordering or by
-- a bare `limit 1`. Two teams here deliberately share the name 'Rink Rats', and the
-- whole file runs in ONE transaction where `now()` is constant — so `order by
-- created_at` cannot distinguish rows created in it, and a name lookup cannot either.
-- Every capture uses `select ... into strict`, so a fixture that finds no row (or more
-- than one) aborts the suite loudly instead of silently binding NULL into an
-- assertion that would then pass vacuously.
--
-- Role discipline (docs/adr/0022 §pgTAP Role Discipline — corrected in this revision):
-- this file connects as the migration-owning role (a local superuser under
-- `supabase test db`), which is the ONLY role with table-level INSERT/UPDATE/DELETE
-- privilege on any Team Foundation table (RLS defines SELECT-only policies for
-- `authenticated`/`anon` — see the RLS migration's own header). Two distinct kinds of
-- statement therefore need two distinct roles:
--   * privileged fixture setup (seeding `auth.users`, granting a pilot capability,
--     deliberately violating the one-active-membership constraint to prove it's
--     enforced) MUST run under this file's own owning role — never under
--     `authenticated`, which has no table-level write privilege at all and would
--     fail every such statement with a permission error, never reaching whatever the
--     test actually means to exercise;
--   * every BEHAVIORAL call (an RPC invocation, an RLS-gated `select`) MUST run under
--     the EXACT role being tested (`authenticated` via `tests.act_as`, `anon` via
--     `tests.act_as_anon`) — never the owning role, which would bypass RLS entirely
--     and prove nothing.
-- `tests.reset_to_owner()` makes the first kind explicit and named, rather than an
-- unlabeled side effect of "whatever role happened to be set from the previous
-- statement" — every fixture-setup block below calls it first, and the very next
-- `tests.act_as(...)`/`tests.act_as_anon()` call restores the correct behavioral role
-- before the next assertion.

begin;

-- The harness schema. Created here, not by a migration, and removed by this file's
-- own closing `rollback`.
create schema tests;

-- The ONLY grant the harness needs: `authenticated` and `anon` must be able to reach
-- `tests.act_as*`/`tests.reset_to_owner` to switch back out of the role they are
-- currently simulating. Functions carry EXECUTE for PUBLIC by default, so schema
-- USAGE is the whole requirement. `service_role` is deliberately absent: no assertion
-- in this suite acts AS service_role (§8 only proves that `authenticated` and `anon`
-- cannot reach the service-role-only recovery function), so granting it access would
-- widen the harness beyond what is actually exercised.
grant usage on schema tests to authenticated, anon;

select plan(101);

-- Seed the auth.users rows directly (this file runs as the migration-owning role,
-- so it can write auth.users directly — no application code does this).
insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000001', 'admin@example.com'),
  ('00000000-0000-0000-0000-000000000002', 'member@example.com'),
  ('00000000-0000-0000-0000-000000000003', 'outsider@example.com'),
  ('00000000-0000-0000-0000-000000000004', 'other-admin@example.com');

create function tests.reset_to_owner() returns void as $$
begin
  reset role;
end;
$$ language plpgsql;

create function tests.act_as(p_account_id uuid) returns void as $$
begin
  perform set_config('request.jwt.claims', json_build_object('sub', p_account_id, 'role', 'authenticated')::text, false);
  execute 'set role authenticated';
end;
$$ language plpgsql;

create function tests.act_as_anon() returns void as $$
begin
  perform set_config('request.jwt.claims', '{}', false);
  execute 'set role anon';
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------------
-- §1 Profile/account-link cardinality (test item 1)
-- ---------------------------------------------------------------------------------

select tests.act_as('00000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.bootstrap_profile('Admin') $$,
  'bootstrap_profile succeeds for a fresh account'
);

-- Read through get_my_profile(), which resolves the CALLER's own profile — never
-- `order by created_at desc limit 1`, which inside this single transaction (constant
-- `now()`) picks an arbitrary row among any that tie.
select isnt(
  (select (public.get_my_profile()).id::text),
  '00000000-0000-0000-0000-000000000001',
  'Profile.id is never the auth.users.id (requirement: Profile has its own stable UUID)'
);

select is(
  (select count(*)::int from public.account_profile_links where account_id = '00000000-0000-0000-0000-000000000001'),
  1,
  'exactly one account_profile_links row for this account'
);

select lives_ok(
  $$ select public.bootstrap_profile('Admin H.') $$,
  'bootstrapping twice is idempotent (updates, does not duplicate)'
);
select is(
  (select count(*)::int from public.account_profile_links where account_id = '00000000-0000-0000-0000-000000000001'),
  1,
  'still exactly one link row after a second bootstrap call'
);

-- ---------------------------------------------------------------------------------
-- §2 Pilot-gated creation, duplicate names, multiple teams, atomic admin grant
-- (test items 3, 4, 5, 8)
-- ---------------------------------------------------------------------------------

select throws_like(
  $$ select public.create_team('No Grant Yet', true, array[]::text[]) $$,
  'forbidden:%',
  'create_team is denied without the pilot grant'
);

-- Privileged fixture setup: granting a pilot capability is an operational/seed action
-- with no corresponding RPC in this beta, and no table-level INSERT grant exists for
-- `authenticated` — this MUST run under the owning role (tests.reset_to_owner()),
-- never under the `authenticated` role `tests.act_as` left set from the call above.
select tests.reset_to_owner();
do $$
declare v_profile_id uuid;
begin
  select profile_id into v_profile_id from public.account_profile_links where account_id = '00000000-0000-0000-0000-000000000001';
  insert into public.pilot_team_creation_grants (profile_id) values (v_profile_id);
end;
$$;
-- Restore the behavioral role before the next assertion.
select tests.act_as('00000000-0000-0000-0000-000000000001');

-- Both create_team calls capture their returned Team ID. Everything downstream names
-- a team by that captured ID: these two teams deliberately share a name, and both are
-- created inside this one transaction where `now()` — and therefore `created_at` — is
-- identical, so neither `where name = ...` nor `order by created_at` can tell them
-- apart.
select lives_ok(
  $$ select set_config('tests.first_team_id', (public.create_team('Rink Rats', true, array['coach'])).id::text, false) $$,
  'create_team succeeds once the pilot grant exists'
);
select lives_ok(
  $$ select set_config('tests.second_rink_rats_team_id', (public.create_team('Rink Rats', false, array[]::text[])).id::text, false) $$,
  'a second team with the SAME name is allowed (Team UUID is authoritative identity)'
);
select isnt(
  current_setting('tests.first_team_id'),
  current_setting('tests.second_rink_rats_team_id'),
  'the two same-named teams are separate rows with distinct Team UUIDs'
);
select is(
  (
    select count(*)::int from public.teams
    where id in (
      current_setting('tests.first_team_id')::uuid,
      current_setting('tests.second_rink_rats_team_id')::uuid
    )
      and name = 'Rink Rats'
  ),
  2,
  'two distinct teams share the same name'
);

select is(
  (
    select count(*)::int from public.team_membership_functions f
    join public.team_memberships m on m.id = f.membership_id
    where m.team_id in (
      current_setting('tests.first_team_id')::uuid,
      current_setting('tests.second_rink_rats_team_id')::uuid
    )
      and f.function = 'team_admin' and f.status = 'active'
  ),
  2,
  'team creation atomically grants the creator Team Admin on both created teams'
);

-- Capture the creator's own Membership ID on the first team, while acting as its
-- owner (a caller always sees their own membership rows under
-- `team_memberships_select`). §7 asserts against this exact ID rather than trying to
-- resolve account 0001's profile from another account's context.
do $$
declare v_membership_id uuid;
begin
  select m.id into strict v_membership_id
    from public.team_memberships m
    where m.team_id = current_setting('tests.first_team_id')::uuid
      and m.profile_id = (public.get_my_profile()).id
      and m.status = 'active';
  perform set_config('tests.first_team_creator_membership_id', v_membership_id::text, false);
end;
$$;

-- ---------------------------------------------------------------------------------
-- §3 Composable functions, independent participation, one-active-membership
-- constraint (test items 6, 7)
-- ---------------------------------------------------------------------------------

-- Privileged fixture manipulation: this deliberately violates the partial unique
-- index directly, to prove the SCHEMA constraint itself is enforced — a concern
-- entirely orthogonal to RLS/grants, and one no `authenticated`-role statement could
-- even reach (it has no table-level INSERT privilege on this table at all, so running
-- this under `authenticated` would fail on a permission error before ever exercising
-- the constraint, silently testing the wrong thing).
select tests.reset_to_owner();
-- Duplicates one NAMED membership row (the captured creator membership), not
-- "whatever `limit 1` happens to return".
select throws_like(
  $$ insert into public.team_memberships (team_id, profile_id, participation_as_player)
     select team_id, profile_id, participation_as_player from public.team_memberships
     where id = current_setting('tests.first_team_creator_membership_id')::uuid $$,
  '%duplicate key%',
  'a second ACTIVE membership for the same (team, profile) is rejected by the unique index'
);
select tests.act_as('00000000-0000-0000-0000-000000000001');

-- ---------------------------------------------------------------------------------
-- §4 Invitations: success, wrong-email, expiry, revoke-is-idempotent, replay
-- (test item 9)
-- ---------------------------------------------------------------------------------

select tests.act_as('00000000-0000-0000-0000-000000000002');
select lives_ok($$ select public.bootstrap_profile('Member') $$, 'invitee bootstraps a profile');

-- Account 0003 ("outsider") bootstraps a profile too — preview_invitation itself
-- requires one (private.require_profile()) before it can even evaluate a denial
-- reason, so the wrong_email check below needs this, same as every other account
-- that calls any RPC in this suite.
select tests.act_as('00000000-0000-0000-0000-000000000003');
select lives_ok($$ select public.bootstrap_profile('Outsider') $$, 'the unrelated outsider account bootstraps a profile too');

select tests.act_as('00000000-0000-0000-0000-000000000001');
do $$
declare
  v_created public.team_invitation_created;
begin
  v_created := public.create_invitation(
    current_setting('tests.first_team_id')::uuid, 'member@example.com', true, array['coach']::text[]);
  perform set_config('tests.invitation_token', v_created.raw_token, false);
  perform set_config('tests.invitation_id', (v_created.invitation).id::text, false);
end;
$$;

-- §4a Token generation and token-at-rest (requirement 63). These four assertions are
-- what proves `private.generate_raw_token()` and `private.hash_token()` actually
-- RESOLVE pgcrypto in a fresh database: pgcrypto is installed in the `extensions`
-- schema, while every calling RPC pins `search_path = public, pg_temp`, so an
-- unqualified `gen_random_bytes(...)`/`digest(...)` fails at runtime and the
-- create_invitation above could never have returned. Structural checks on stored
-- data, so they run under the owning role (RLS visibility is not what is under test).
select tests.reset_to_owner();
select matches(
  (select token_hash from public.team_invitations where id = current_setting('tests.invitation_id')::uuid),
  '^[0-9a-f]{64}$',
  'the stored token_hash is a 64-character hex SHA-256 digest (private.hash_token resolved pgcrypto''s digest())'
);
select is(
  (select token_hash from public.team_invitations where id = current_setting('tests.invitation_id')::uuid),
  encode(extensions.digest(current_setting('tests.invitation_token'), 'sha256'), 'hex'),
  'the stored token_hash is exactly SHA-256(raw token) — the hash, and only the hash, is what is at rest'
);
select is(
  octet_length(decode(current_setting('tests.invitation_token'), 'base64')),
  32,
  'the raw token carries 32 cryptographically random bytes (private.generate_raw_token resolved pgcrypto''s gen_random_bytes())'
);
select is(
  (select count(*)::int from public.team_invitations
     where token_hash = current_setting('tests.invitation_token')),
  0,
  'the raw token itself is never persisted — no invitation row stores it verbatim'
);

-- Invitation attribution (docs/adr/0022 §Invitation Attribution): preview must name
-- THIS invitation's own creator, not the team's original creator — both happen to be
-- the same account here, so §4b below (a non-founder admin) is what actually
-- distinguishes the two; this assertion just confirms an inviter name is populated.
select tests.act_as('00000000-0000-0000-0000-000000000002');
select isnt(
  (select (public.preview_invitation(current_setting('tests.invitation_token'))).inviter_display_name),
  null,
  'a ready-to-accept preview names an inviter'
);

select tests.act_as('00000000-0000-0000-0000-000000000003');
select is(
  (
    select (public.preview_invitation(current_setting('tests.invitation_token'))).denial_reason
  ),
  'wrong_email',
  'a mismatched authenticated account is denied with wrong_email, not a different error'
);

select tests.act_as('00000000-0000-0000-0000-000000000002');
select is(
  (select (public.preview_invitation(current_setting('tests.invitation_token'))).status),
  'ready_to_accept',
  'the correct recipient sees a ready-to-accept preview'
);
select lives_ok(
  $$ select public.accept_invitation(current_setting('tests.invitation_token')) $$,
  'the correct recipient accepts successfully'
);

-- Capture the Membership the acceptance just created, while still acting AS the
-- accepting account — a caller always sees their own membership rows, so this needs
-- no privileged role and no lookup through another account's account_profile_links
-- (whose RLS policy exposes only the caller's own row, and would silently yield NULL).
do $$
declare v_membership_id uuid;
begin
  select m.id into strict v_membership_id
    from public.team_memberships m
    where m.team_id = current_setting('tests.first_team_id')::uuid
      and m.profile_id = (public.get_my_profile()).id
      and m.status = 'active';
  perform set_config('tests.member_membership_id', v_membership_id::text, false);
end;
$$;

select throws_like(
  $$ select public.accept_invitation(current_setting('tests.invitation_token')) $$,
  'already_accepted:%',
  'replaying the same token a second time fails with already_accepted, not a silent success'
);

select throws_like(
  $$ select public.accept_invitation('not-a-real-token') $$,
  'not_found:%',
  'a malformed/unknown token fails closed with not_found'
);

-- §4b Invitation attribution across a non-founder admin (docs/adr/0022 §Invitation
-- Attribution) — promotes a second account to Team Admin (via the admin-request flow
-- exercised fully in §5 below is not yet available here, so this uses a second,
-- separate team created by account 0004 directly) and confirms THAT team's invitation
-- names ITS creator, never account 0001's "Rink Rats" identity.
select tests.act_as('00000000-0000-0000-0000-000000000004');
select lives_ok($$ select public.bootstrap_profile('Other Admin') $$, 'a fourth account bootstraps a profile');
select tests.reset_to_owner();
do $$
declare v_profile_id uuid;
begin
  select profile_id into v_profile_id from public.account_profile_links where account_id = '00000000-0000-0000-0000-000000000004';
  insert into public.pilot_team_creation_grants (profile_id) values (v_profile_id);
end;
$$;
select tests.act_as('00000000-0000-0000-0000-000000000004');
do $$
declare
  v_team_id uuid;
  v_created public.team_invitation_created;
begin
  v_team_id := (public.create_team('Second Team', true, array[]::text[])).id;
  perform set_config('tests.second_team_id', v_team_id::text, false);
  -- Addressed to account 0002's own email so the preview below (as account 0002)
  -- reaches the ready_to_accept branch, where inviter_display_name is populated —
  -- a denied preview never sets it at all, which would make this assertion
  -- vacuously pass against a null rather than actually proving attribution.
  v_created := public.create_invitation(v_team_id, 'member@example.com', true, array[]::text[]);
  perform set_config('tests.second_team_invitation_token', v_created.raw_token, false);
end;
$$;
select tests.act_as('00000000-0000-0000-0000-000000000002');
select is(
  (select (public.preview_invitation(current_setting('tests.second_team_invitation_token'))).inviter_display_name),
  'Other Admin',
  'a Second Team invitation is attributed to its own creator, not "Rink Rats"''s founder'
);

-- The invitation is then genuinely ACCEPTED, not merely previewed. This is the one
-- active, ordinary (non-admin) Membership the suite needs twice later: §9's
-- "a non-admin member cannot call get_team_member_emails" and §16's Admin Request
-- nominee. Without it, §16 would search for a Membership that was never created.
select lives_ok(
  $$ select public.accept_invitation(current_setting('tests.second_team_invitation_token')) $$,
  'the invited account accepts its Second Team invitation, joining as an ordinary member'
);
do $$
declare v_membership_id uuid;
begin
  select m.id into strict v_membership_id
    from public.team_memberships m
    where m.team_id = current_setting('tests.second_team_id')::uuid
      and m.profile_id = (public.get_my_profile()).id
      and m.status = 'active';
  perform set_config('tests.second_team_member_membership_id', v_membership_id::text, false);
end;
$$;
-- Establishes that this Membership really is an ordinary one. Both later assertions
-- that depend on it expect a DENIAL, and a denial would also be the result if the
-- account were not a member at all — so proving "active member, and holds no Team
-- Admin function" here is what stops those two from passing for the wrong reason.
-- (`into strict` above already proved the Membership exists and is active.)
select is(
  (
    select count(*)::int from public.team_membership_functions
    where membership_id = current_setting('tests.second_team_member_membership_id')::uuid
      and function = 'team_admin' and status = 'active'
  ),
  0,
  'that new Second Team Membership is an ordinary member — active, but holding no Team Admin function'
);

-- ---------------------------------------------------------------------------------
-- §5 Admin requests: success, wrong-nominee, idempotent accept, revoke-vs-accept
-- ordering, membership-invalidation (test item 10; correction item 1)
-- ---------------------------------------------------------------------------------

select tests.act_as('00000000-0000-0000-0000-000000000001');
do $$
declare v_request public.team_admin_requests;
begin
  v_request := public.create_admin_request(
    current_setting('tests.first_team_id')::uuid,
    current_setting('tests.member_membership_id')::uuid);
  perform set_config('tests.admin_request_id', v_request.id::text, false);
end;
$$;

select throws_like(
  $$ select public.create_admin_request(current_setting('tests.first_team_id')::uuid, current_setting('tests.member_membership_id')::uuid) $$,
  'conflict:%',
  'a second Admin Request for the same still-pending membership is rejected (effectively-pending uniqueness, correction item 1)'
);

select throws_like(
  $$ select public.accept_admin_request(current_setting('tests.admin_request_id')::uuid) $$,
  'wrong_nominee:%',
  'a non-nominee (the requesting admin) cannot accept the request'
);

select tests.act_as('00000000-0000-0000-0000-000000000002');
select lives_ok(
  $$ select public.accept_admin_request(current_setting('tests.admin_request_id')::uuid) $$,
  'the correct nominee accepts successfully'
);
select lives_ok(
  $$ select public.accept_admin_request(current_setting('tests.admin_request_id')::uuid) $$,
  'accepting again as the same nominee is an idempotent success, not an error'
);

-- Revoke-vs-accept ordering (correction item 1): a request already accepted cannot
-- retroactively be revoked into denying the Team Admin grant it already produced —
-- revoke_admin_request's own idempotent no-op behavior on a non-pending row means the
-- ALREADY-ACCEPTED request here simply stays accepted; the actual concurrent-race
-- ordering (whichever of a simultaneous accept/revoke commits first durably wins) is a
-- true two-session race pgTAP cannot simulate within one transaction — that race is
-- covered by Procedure A at the end of this file, which HAS been executed with two
-- concurrent sessions; this sequential assertion does not stand in for it.
select tests.act_as('00000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.revoke_admin_request(current_setting('tests.admin_request_id')::uuid) $$,
  'revoking an already-accepted request is a safe, idempotent no-op'
);
select is(
  (select status from public.team_admin_requests where id = current_setting('tests.admin_request_id')::uuid),
  'accepted',
  'the already-accepted request is NOT retroactively revoked — the accept stands'
);

-- Membership-invalidation (correction item 1): a pending Admin Request naming a
-- membership that then ends must never be acceptable afterward. Uses the
-- sequential (non-concurrent) case — leave_team ending the membership BEFORE any
-- attempt to accept the request naming it; the genuinely concurrent race (both
-- happening at once) is documented as a manual two-session procedure at the end of
-- this file, not claimed as covered by this sequential assertion.
select tests.act_as('00000000-0000-0000-0000-000000000004');
do $$
declare v_created public.team_invitation_created;
begin
  v_created := public.create_invitation(
    current_setting('tests.second_team_id')::uuid, 'outsider@example.com', true, array[]::text[]);
  perform set_config('tests.outsider_invite_token', v_created.raw_token, false);
end;
$$;
select tests.act_as('00000000-0000-0000-0000-000000000003');
select lives_ok(
  $$ select public.accept_invitation(current_setting('tests.outsider_invite_token')) $$,
  'the outsider account joins Second Team, becoming a plain member'
);
-- Captured while acting as the joining account itself, for the same reason as §4's
-- capture: its own membership row is visible to it, another account's profile link is
-- not.
do $$
declare v_membership_id uuid;
begin
  select m.id into strict v_membership_id
    from public.team_memberships m
    where m.team_id = current_setting('tests.second_team_id')::uuid
      and m.profile_id = (public.get_my_profile()).id
      and m.status = 'active';
  perform set_config('tests.outsider_membership_id', v_membership_id::text, false);
end;
$$;

select tests.act_as('00000000-0000-0000-0000-000000000004');
do $$
declare v_request public.team_admin_requests;
begin
  v_request := public.create_admin_request(
    current_setting('tests.second_team_id')::uuid,
    current_setting('tests.outsider_membership_id')::uuid);
  perform set_config('tests.invalidated_request_id', v_request.id::text, false);
end;
$$;

select tests.act_as('00000000-0000-0000-0000-000000000003');
select lives_ok(
  $$ select public.leave_team(current_setting('tests.second_team_id')::uuid) $$,
  'the nominee leaves the team while their own Admin Request is still pending'
);
select throws_like(
  $$ select public.accept_admin_request(current_setting('tests.invalidated_request_id')::uuid) $$,
  'revoked:%',
  'a pending Admin Request naming a membership that has since ended can no longer be accepted (correction item 1)'
);

-- ---------------------------------------------------------------------------------
-- §6 Last-Admin invariant and atomic removal (test items 11, 12)
-- ---------------------------------------------------------------------------------

select tests.act_as('00000000-0000-0000-0000-000000000001');
-- An alias for the FIRST 'Rink Rats' team, taken from the ID captured at creation in
-- §2 — the two same-named teams are indistinguishable by name or by `created_at`
-- inside this transaction.
select set_config('tests.solo_admin_team_id', current_setting('tests.first_team_id'), false);

-- At this point Rink Rats (the first one) has TWO active admins (the creator and
-- the member who just accepted the admin request in §5) — removing one's own admin
-- function must succeed; only removing the LAST one is blocked.
select lives_ok(
  $$ select public.relinquish_own_admin(current_setting('tests.solo_admin_team_id')::uuid) $$,
  'relinquishing admin succeeds while another active admin remains'
);
select throws_like(
  $$ select public.relinquish_own_admin(current_setting('tests.solo_admin_team_id')::uuid) $$,
  '%',
  'the caller is no longer an active admin at all now, so a second relinquish attempt fails'
);

select tests.act_as('00000000-0000-0000-0000-000000000002');
select throws_like(
  $$ select public.leave_team(current_setting('tests.solo_admin_team_id')::uuid) $$,
  'last_admin_invariant:%',
  'the sole remaining active admin cannot leave the team'
);
select throws_like(
  $$ select public.remove_admin_function(current_setting('tests.solo_admin_team_id')::uuid, current_setting('tests.member_membership_id')::uuid) $$,
  'last_admin_invariant:%',
  'the sole remaining active admin cannot have their own Team Admin function removed either'
);

-- ---------------------------------------------------------------------------------
-- §7 Archive/restore (test item 13)
-- ---------------------------------------------------------------------------------

-- Account 0002 is the sole remaining active admin of this team going into §7
-- (account 0001 relinquished admin in §6 but is still an ordinary member).
select lives_ok(
  $$ select public.archive_team(current_setting('tests.solo_admin_team_id')::uuid) $$,
  'the sole admin CAN archive the team'
);
select throws_like(
  $$ select public.rename_team(current_setting('tests.solo_admin_team_id')::uuid, 'New Name') $$,
  'archived_team:%',
  'an archived team rejects ordinary collaborative writes'
);
select throws_like(
  $$ select public.remove_admin_function(current_setting('tests.solo_admin_team_id')::uuid, current_setting('tests.member_membership_id')::uuid) $$,
  'archived_team:%',
  'removing another member''s admin function is also rejected on an archived team (correction item 8)'
);

-- Account 0001 (an ordinary, non-admin member) leaves while archived — 0002
-- deliberately does NOT leave yet, since restoring requires a remaining active
-- admin (spec §11) and 0001 relinquished admin back in §6, so only 0002 could ever
-- call restore_team below.
select tests.act_as('00000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.leave_team(current_setting('tests.solo_admin_team_id')::uuid) $$,
  'an ordinary member may leave an archived team'
);

select tests.act_as('00000000-0000-0000-0000-000000000002');
select lives_ok(
  $$ select public.restore_team(current_setting('tests.solo_admin_team_id')::uuid) $$,
  'the remaining Team Admin (who never left) can restore an archived team'
);
-- Asserted against the Membership ID captured in §2, not by re-resolving account
-- 0001's profile through account_profile_links from account 0002's context — that
-- policy exposes only the CALLER's own link row, so the lookup returned no row and the
-- count was 0 no matter what restore_team had done. This reads the row's status
-- directly instead: the caller here is the team's active admin, so an ended Membership
-- IS visible to it, and a row that had been wrongly reactivated would read 'active'.
select is(
  (
    select status from public.team_memberships
    where id = current_setting('tests.first_team_creator_membership_id')::uuid
  ),
  'ended',
  'the member who left while archived is NOT restored by restore_team — their Membership is still ended'
);

-- Re-archive so the sole-admin-leaves-while-archived case (structurally distinct
-- from an ordinary member leaving, above) is also covered — this permanently
-- empties the team, which is fine: nothing later in this suite depends on
-- solo_admin_team_id having any remaining members or admins.
select lives_ok(
  $$ select public.archive_team(current_setting('tests.solo_admin_team_id')::uuid) $$,
  'the sole admin can archive the (restored, active) team a second time'
);
select lives_ok(
  $$ select public.leave_team(current_setting('tests.solo_admin_team_id')::uuid) $$,
  'leaving is still allowed once the team is archived, even as the (structurally) sole admin'
);

-- ---------------------------------------------------------------------------------
-- §8 Restricted recovery is unreachable by ordinary roles (test item 14, 20)
-- ---------------------------------------------------------------------------------

select tests.act_as('00000000-0000-0000-0000-000000000001');
select throws_like(
  $$ select public.operational_recover_team_admin(current_setting('tests.solo_admin_team_id')::uuid, gen_random_uuid()) $$,
  '%permission denied%',
  'an ordinary authenticated caller cannot execute the recovery function at all'
);

select tests.act_as_anon();
select throws_like(
  $$ select public.operational_recover_team_admin(gen_random_uuid(), gen_random_uuid()) $$,
  '%permission denied%',
  'the anon role cannot execute the recovery function at all'
);

-- ---------------------------------------------------------------------------------
-- §9 RLS matrix spot checks, cross-Team fail-closed, identity derivation
-- (test items 15, 16, 17; correction item 8 security invariants)
-- ---------------------------------------------------------------------------------

-- Named by the two captured Team IDs: this account has never held a Membership on
-- either, so RLS must return neither. (Filtering by name would also silently pass if
-- the teams had been renamed.)
select tests.act_as('00000000-0000-0000-0000-000000000003'); -- unrelated authenticated user
select is(
  (
    select count(*)::int from public.teams
    where id in (
      current_setting('tests.first_team_id')::uuid,
      current_setting('tests.second_rink_rats_team_id')::uuid
    )
  ),
  0,
  'an unrelated authenticated user sees zero of the two Rink Rats teams via RLS'
);

-- `anon` holds NO table-level privilege on any Team Foundation table (see the RLS
-- migration's privilege block), so a signed-out direct read is rejected at the ACL
-- check before RLS is ever consulted. The previous expectation — an empty result set
-- — described a weaker boundary that would require deliberately granting anon SELECT
-- and then relying on a policy to filter every row away. §17 asserts the underlying
-- privilege state directly; this asserts the behaviour a signed-out client sees.
select tests.act_as_anon();
select throws_like(
  $$ select count(*) from public.teams $$,
  '%permission denied%',
  'the anon role cannot read the teams table at all — a signed-out direct read fails closed on privilege, not with an empty result'
);

-- Account 0002 is an ACTIVE, ordinary member of Second Team (joined and verified
-- non-admin in §4b) — so this proves the admin-only check in get_team_member_emails,
-- not merely "some caller without access". Previously this used a Rink Rats team on
-- which the account's Membership had already ended in §7, which tests a former
-- member, not a non-admin member.
select tests.act_as('00000000-0000-0000-0000-000000000002');
select throws_like(
  $$ select * from public.get_team_member_emails(current_setting('tests.second_team_id')::uuid) $$,
  'forbidden:%',
  'an active, ordinary (non-admin) member cannot call get_team_member_emails at all'
);

-- Names a specific team this account has no Membership on. rename_team resolves
-- authorization before team existence, so the outcome is deterministically
-- `forbidden` — the previous `'%'` pattern matched literally any error, including one
-- raised for an unrelated reason.
select tests.act_as('00000000-0000-0000-0000-000000000003');
select throws_like(
  $$ select public.rename_team(current_setting('tests.first_team_id')::uuid, 'Hijacked') $$,
  'forbidden:%',
  'an unrelated authenticated user cannot rename a team they are not an admin of'
);

-- Cross-Team fail-closed: an admin of "Second Team" must never be able to act on a
-- membership/request belonging to "Rink Rats", by passing that OTHER team's own
-- membership id alongside its own team id, or vice versa (security invariant:
-- "A Team ID or Membership ID from another Team must fail closed").
select tests.act_as('00000000-0000-0000-0000-000000000004');
select throws_like(
  $$ select public.remove_member(
       current_setting('tests.second_team_id')::uuid,
       current_setting('tests.member_membership_id')::uuid
     ) $$,
  'not_found:%',
  'an admin of Second Team cannot remove_member using a membership id that belongs to Rink Rats'
);
select throws_like(
  $$ select public.create_admin_request(
       current_setting('tests.second_team_id')::uuid,
       current_setting('tests.member_membership_id')::uuid
     ) $$,
  'not_found:%',
  'an admin of Second Team cannot create_admin_request naming a membership id that belongs to Rink Rats'
);

-- team_admin_requests visibility: Second Team's admin must never see Rink Rats'
-- admin requests, even though both teams exist and this account IS an admin of one.
select is(
  (
    select count(*)::int from public.team_admin_requests
    where team_id = current_setting('tests.solo_admin_team_id')::uuid
  ),
  0,
  'an admin of a DIFFERENT team sees zero of another team''s Admin Requests via RLS'
);

-- Spoofing check: no function accepts a caller-supplied profile/account id anywhere
-- in its signature — verified structurally, not by attempting to pass one (there is
-- no parameter to pass it through). This assertion documents that invariant by
-- checking the function signatures contain no "profile_id"/"account_id" input
-- parameter name, which would be the only way a caller could attempt to override
-- authenticated identity.
select is(
  (
    select count(*)::int
    from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proargnames && array['p_profile_id', 'p_account_id', 'p_caller_id', 'p_actor_profile_id']
  ),
  0,
  'no public RPC accepts a caller-identity parameter — identity always comes from auth.uid()'
);

-- ---------------------------------------------------------------------------------
-- §10 Audit events (test item 18)
-- ---------------------------------------------------------------------------------

-- This is a write-side structural check ("did team creation actually insert an
-- audit row for each team"), not an RLS-visibility test — run under the owning
-- role, bypassing RLS, since by this point in the suite account 0001 has
-- relinquished admin and left the FIRST "Rink Rats" team (§6/§7), so RLS's
-- `team_audit_events_select_admin_only` policy (current active-admin only, no
-- historical grace) would correctly show that account only 1 of the 2+ team_created
-- events it could see earlier — a true RLS narrowing, not a write-side defect, and
-- not what this assertion means to test.
select tests.reset_to_owner();
select ok(
  (select count(*)::int from public.team_audit_events where event_type = 'team_created') >= 2,
  'a team_created audit event exists for each created team'
);

select tests.act_as('00000000-0000-0000-0000-000000000001');
select throws_like(
  $$ insert into public.team_audit_events (team_id, actor_profile_id, event_type, payload)
     values (null, null, 'forged', '{}'::jsonb) $$,
  '%permission denied%',
  'an authenticated client cannot insert a forged audit event directly (no INSERT policy exists)'
);

-- ---------------------------------------------------------------------------------
-- §11 SECURITY DEFINER hardening (test items 19, 20)
-- ---------------------------------------------------------------------------------

select is(
  (
    select count(*)::int from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef = true
      and (p.proconfig is null or not exists (
        select 1 from unnest(p.proconfig) c where c like 'search_path=%'
      ))
  ),
  0,
  'every SECURITY DEFINER function in public/private pins an explicit search_path'
);

select is(
  has_function_privilege('anon', 'public.remove_member(uuid, uuid)', 'execute'),
  false,
  'the anon role has no execute privilege on remove_member (PUBLIC execute was revoked, only authenticated was granted)'
);
select is(
  has_function_privilege('authenticated', 'public.operational_recover_team_admin(uuid, uuid)', 'execute'),
  false,
  'the authenticated role has no execute privilege on the recovery function — service_role only'
);

-- ---------------------------------------------------------------------------------
-- §12 Invitation revision invalidates the old link (correction item 1/7)
-- ---------------------------------------------------------------------------------

select tests.act_as('00000000-0000-0000-0000-000000000004');
do $$
declare
  v_created public.team_invitation_created;
  v_revised public.team_invitation_created;
begin
  v_created := public.create_invitation(
    current_setting('tests.second_team_id')::uuid, 'typo@example.com', true, array[]::text[]);
  perform set_config('tests.revisable_old_token', v_created.raw_token, false);
  v_revised := public.revise_invitation((v_created.invitation).id, 'corrected@example.com', true, array[]::text[]);
  perform set_config('tests.revisable_new_token', v_revised.raw_token, false);
end;
$$;
select throws_like(
  $$ select public.accept_invitation(current_setting('tests.revisable_old_token')) $$,
  'replaced:%',
  'the OLD link stops working immediately once revised (correction item 7)'
);
-- The new link IS a real, valid, still-pending invitation — previewing it as the
-- currently-authenticated account (0004, the admin who created it, not the invited
-- "corrected@example.com" address) correctly denies with wrong_email, never
-- invalid_token — confirming the new row exists and is genuinely live, distinct
-- from the old (replaced) one checked above.
select is(
  (select (public.preview_invitation(current_setting('tests.revisable_new_token'))).denial_reason),
  'wrong_email',
  'the new link is real and pending — previewed by a non-matching account, it denies with wrong_email, not invalid_token'
);

-- ---------------------------------------------------------------------------------
-- §13 Function-array input validation is total (correction item 6) — a NULL array,
-- a duplicate value, and an unknown value must all fail closed with `invalid_input`,
-- never silently pass (NULL previously slipped past the bare `<@` check) or surface
-- as a raw unique_violation later in the insert loop.
-- ---------------------------------------------------------------------------------

select tests.act_as('00000000-0000-0000-0000-000000000001');
select throws_like(
  $$ select public.create_team('Null Functions Team', true, null::text[]) $$,
  'invalid_input:%',
  'create_team rejects a NULL functions array instead of silently skipping validation (correction item 6)'
);
select throws_like(
  $$ select public.create_team('Duplicate Functions Team', true, array['coach', 'coach']) $$,
  'invalid_input:%',
  'create_team rejects a duplicate function in the proposed array'
);
select throws_like(
  $$ select public.create_team('Unknown Function Team', true, array['captain']) $$,
  'invalid_input:%',
  'create_team rejects an unknown function value'
);

do $$
declare v_team_id uuid;
begin
  v_team_id := (public.create_team('Third Team', true, array[]::text[])).id;
  perform set_config('tests.third_team_id', v_team_id::text, false);
end;
$$;

select throws_like(
  $$ select public.create_invitation(current_setting('tests.third_team_id')::uuid, 'null-fn@example.com', true, null::text[]) $$,
  'invalid_input:%',
  'create_invitation rejects a NULL proposed-functions array (correction item 6)'
);
select throws_like(
  $$ select public.create_invitation(current_setting('tests.third_team_id')::uuid, 'dup-fn@example.com', true, array['coach', 'coach']) $$,
  'invalid_input:%',
  'create_invitation rejects a duplicate proposed function'
);
select throws_like(
  $$ select public.create_invitation(current_setting('tests.third_team_id')::uuid, 'unknown-fn@example.com', true, array['captain']) $$,
  'invalid_input:%',
  'create_invitation rejects an unknown proposed function'
);

-- ---------------------------------------------------------------------------------
-- §14 Membership write-time mutations: set_participation, assign_direct_function,
-- remove_direct_function (correction item 4 — previously entirely untested, and the
-- specific "never create/retain an active Team Function on an ended Membership"
-- guarantee the membership-row locking exists to protect).
-- ---------------------------------------------------------------------------------

do $$
declare v_created public.team_invitation_created;
begin
  v_created := public.create_invitation(current_setting('tests.third_team_id')::uuid, 'outsider@example.com', false, array[]::text[]);
  perform set_config('tests.third_team_invite_token', v_created.raw_token, false);
end;
$$;

select tests.act_as('00000000-0000-0000-0000-000000000003');
select lives_ok(
  $$ select public.accept_invitation(current_setting('tests.third_team_invite_token')) $$,
  'the outsider joins Third Team as a plain, non-playing member'
);
-- Captured while still acting as the joining account, through get_my_profile()
-- rather than an account_profile_links lookup, consistent with §2/§4/§4b/§5.
do $$
declare v_membership_id uuid;
begin
  select m.id into strict v_membership_id
    from public.team_memberships m
    where m.team_id = current_setting('tests.third_team_id')::uuid
      and m.profile_id = (public.get_my_profile()).id
      and m.status = 'active';
  perform set_config('tests.third_team_member_id', v_membership_id::text, false);
end;
$$;

select tests.act_as('00000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.set_participation(current_setting('tests.third_team_id')::uuid, current_setting('tests.third_team_member_id')::uuid, true) $$,
  'an admin changes a member''s participation-as-player'
);
select is(
  (select participation_as_player from public.team_memberships where id = current_setting('tests.third_team_member_id')::uuid),
  true,
  'the participation change is persisted'
);

select lives_ok(
  $$ select public.assign_direct_function(current_setting('tests.third_team_id')::uuid, current_setting('tests.third_team_member_id')::uuid, 'coach') $$,
  'an admin assigns Coach directly to an active member'
);
select lives_ok(
  $$ select public.assign_direct_function(current_setting('tests.third_team_id')::uuid, current_setting('tests.third_team_member_id')::uuid, 'coach') $$,
  'assigning the same direct function again is an idempotent success, not a duplicate row'
);
select is(
  (
    select count(*)::int from public.team_membership_functions
    where membership_id = current_setting('tests.third_team_member_id')::uuid and function = 'coach' and status = 'active'
  ),
  1,
  'exactly one active Coach function row exists after the idempotent re-assignment'
);
select lives_ok(
  $$ select public.remove_direct_function(current_setting('tests.third_team_id')::uuid, current_setting('tests.third_team_member_id')::uuid, 'coach') $$,
  'an admin removes the directly-assigned Coach function'
);
select is(
  (
    select count(*)::int from public.team_membership_functions
    where membership_id = current_setting('tests.third_team_member_id')::uuid and function = 'coach' and status = 'active'
  ),
  0,
  'no active Coach function row remains after removal'
);
select throws_like(
  $$ select public.assign_direct_function(current_setting('tests.third_team_id')::uuid, current_setting('tests.third_team_member_id')::uuid, 'captain') $$,
  'invalid_input:%',
  'assign_direct_function rejects an unknown function value'
);

-- Assign Training Lead before the member leaves, so there is an active function
-- for leave_team's own function-ending step to end — this is what lets the
-- remove_direct_function-on-ended-membership assertion below prove something real
-- (a function row that genuinely WAS active moments earlier, not one that was
-- already gone for an unrelated reason).
select lives_ok(
  $$ select public.assign_direct_function(current_setting('tests.third_team_id')::uuid, current_setting('tests.third_team_member_id')::uuid, 'training_lead') $$,
  'an admin assigns Training Lead before the member leaves'
);

-- The member leaves, ending their membership — assign_direct_function/
-- set_participation/remove_direct_function must never succeed against an
-- already-ended membership (correction item 4's "never create/retain an active
-- Team Function on an ended Membership"), now that all three lock the target
-- Membership row before deciding.
select tests.act_as('00000000-0000-0000-0000-000000000003');
select lives_ok(
  $$ select public.leave_team(current_setting('tests.third_team_id')::uuid) $$,
  'the member leaves Third Team, ending their membership and every active function on it'
);
select tests.act_as('00000000-0000-0000-0000-000000000001');
select throws_like(
  $$ select public.assign_direct_function(current_setting('tests.third_team_id')::uuid, current_setting('tests.third_team_member_id')::uuid, 'coach') $$,
  'conflict:%',
  'assign_direct_function refuses to grant a function on an already-ended membership (correction item 4)'
);
select throws_like(
  $$ select public.set_participation(current_setting('tests.third_team_id')::uuid, current_setting('tests.third_team_member_id')::uuid, false) $$,
  'conflict:%',
  'set_participation refuses to modify an already-ended membership (correction item 4)'
);

-- remove_direct_function must reject the same ended Membership the same stable way
-- (correction item 4, third pass) — it previously had no status re-check at all,
-- meaning it could reach the UPDATE/audit statements for a Membership that had, in
-- fact, already ended. Captures the function-history row's state and the
-- function_removed audit count BEFORE the rejected call, and proves both are
-- byte-for-byte unchanged afterward — not merely that the call "throws something."
do $$
declare
  v_ended_at_before timestamptz;
  v_audit_count_before int;
begin
  select ended_at into v_ended_at_before
    from public.team_membership_functions
    where membership_id = current_setting('tests.third_team_member_id')::uuid and function = 'training_lead';
  select count(*) into v_audit_count_before
    from public.team_audit_events
    where event_type = 'function_removed'
      and payload->>'membershipId' = current_setting('tests.third_team_member_id');
  perform set_config('tests.pre_reject_ended_at', v_ended_at_before::text, false);
  perform set_config('tests.pre_reject_audit_count', v_audit_count_before::text, false);
end;
$$;
select throws_like(
  $$ select public.remove_direct_function(current_setting('tests.third_team_id')::uuid, current_setting('tests.third_team_member_id')::uuid, 'training_lead') $$,
  'conflict:%',
  'remove_direct_function refuses to act on an already-ended membership, instead of silently updating history (correction item 4, third pass)'
);
select is(
  (
    select ended_at::text from public.team_membership_functions
    where membership_id = current_setting('tests.third_team_member_id')::uuid and function = 'training_lead'
  ),
  current_setting('tests.pre_reject_ended_at'),
  'the Training Lead function-history row''s ended_at is untouched by the rejected call — leave_team''s own end stands, not a second one'
);
select is(
  (
    select count(*)::int from public.team_audit_events
    where event_type = 'function_removed'
      and payload->>'membershipId' = current_setting('tests.third_team_member_id')
  ),
  current_setting('tests.pre_reject_audit_count')::int,
  'no new function_removed audit event was written for the rejected call'
);

-- ---------------------------------------------------------------------------------
-- §15 Team lifecycle lock ordering: restore_team / relinquish_own_admin (correction
-- item 1). The genuine cross-session race (restore_team committing between a final
-- admin's pre-lock status read and its lock-protected decision) cannot be
-- represented as a single-transaction pgTAP case — see Procedures D and E at the end
-- of this file for the two-session verification, which has been executed. These are
-- sequential regression assertions confirming the refactored functions still behave
-- correctly for the cases pgTAP CAN represent.
-- ---------------------------------------------------------------------------------

select tests.act_as('00000000-0000-0000-0000-000000000003');
select throws_like(
  $$ select public.restore_team(current_setting('tests.third_team_id')::uuid) $$,
  'forbidden:%',
  'restore_team still requires active admin authorization after taking the invariant lock first (regression check, correction item 1)'
);

select tests.act_as('00000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.archive_team(current_setting('tests.third_team_id')::uuid) $$,
  'the sole admin archives Third Team'
);
select lives_ok(
  $$ select public.relinquish_own_admin(current_setting('tests.third_team_id')::uuid) $$,
  'the sole admin may relinquish Team Admin while archived — exercises the post-lock fresh status re-read (correction item 1)'
);

select tests.act_as('00000000-0000-0000-0000-000000000004');
select lives_ok(
  $$ select public.restore_team(current_setting('tests.second_team_id')::uuid) $$,
  'restore_team on an already-active team remains an idempotent no-op after the lock-ordering fix (regression check, correction item 1)'
);

-- ---------------------------------------------------------------------------------
-- §16 Team-side Admin Request read boundary is genuinely admin-only (correction
-- item 2) — list_admin_requests_for_team re-derives admin authorization itself,
-- rather than relying solely on team_admin_requests_select's RLS policy, which
-- deliberately ALSO permits the nominee to see their own row for their separate
-- nominee inbox.
-- ---------------------------------------------------------------------------------

-- The nominee is the real, active, ordinary Second Team Membership account 0002
-- accepted in §4b. Previously this searched for it through another account's
-- account_profile_links row (invisible under that table's RLS) for a Membership that
-- had never been created at all — the invitation there was only ever previewed.
do $$
declare v_request public.team_admin_requests;
begin
  v_request := public.create_admin_request(
    current_setting('tests.second_team_id')::uuid,
    current_setting('tests.second_team_member_membership_id')::uuid);
  perform set_config('tests.second_team_admin_request_id', v_request.id::text, false);
end;
$$;

select is(
  (select count(*)::int from public.list_admin_requests_for_team(current_setting('tests.second_team_id')::uuid)),
  1,
  'the Team Admin sees the one outstanding Admin Request via list_admin_requests_for_team'
);

select tests.act_as('00000000-0000-0000-0000-000000000002');
select throws_like(
  $$ select * from public.list_admin_requests_for_team(current_setting('tests.second_team_id')::uuid) $$,
  'forbidden:%',
  'the nominee cannot use the Team-side admin-only method, even though RLS alone would let them see their own row (correction item 2)'
);

select tests.act_as('00000000-0000-0000-0000-000000000001');
select throws_like(
  $$ select * from public.list_admin_requests_for_team(current_setting('tests.second_team_id')::uuid) $$,
  'forbidden:%',
  'an unrelated account (not this team''s admin) cannot use list_admin_requests_for_team'
);

select tests.act_as('00000000-0000-0000-0000-000000000004');
select lives_ok(
  $$ select public.revoke_admin_request(current_setting('tests.second_team_admin_request_id')::uuid) $$,
  'the admin revokes the request'
);
select is(
  (select count(*)::int from public.list_admin_requests_for_team(current_setting('tests.second_team_id')::uuid)),
  0,
  'a revoked request no longer appears in the Team-side outstanding list'
);

-- Narrow result contract, checked structurally (correction item 5, third pass) —
-- introspects the function's ACTUAL declared return type's columns, not merely the
-- standalone `team_admin_request_summary` type in isolation, so reverting the
-- function to `returns setof public.team_admin_requests` (which has more columns,
-- including created_by_profile_id) would be caught here even if the now-unused
-- composite type were left behind.
select is(
  (
    select array_agg(a.attname::text order by a.attname)
    from pg_proc p
    join pg_type t on t.oid = p.prorettype
    join pg_class c on c.oid = t.typrelid
    join pg_attribute a on a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped
    where p.pronamespace = 'public'::regnamespace and p.proname = 'list_admin_requests_for_team'
  ),
  array['accepted_at', 'created_at', 'expires_at', 'id', 'membership_id', 'replaced_by_request_id', 'revoked_at', 'status', 'team_id']::text[],
  'list_admin_requests_for_team returns exactly the narrow field set — never created_by_profile_id or any other team_admin_requests column, and never silently expands when the table gains a column (correction item 5, third pass)'
);

-- ---------------------------------------------------------------------------------
-- §17 Table-level privilege boundary (the ACL layer beneath RLS)
--
-- An RLS policy NARROWS an access the ACL already permits; it never grants one. These
-- three assertions pin the grant state the RLS migration establishes, because the
-- behavioural tests above cannot distinguish all of its failure modes on their own:
-- dropping the SELECT grants would break every direct client read with `permission
-- denied` (the defect this correction pass fixed), while ADDING a write grant, or an
-- anon SELECT grant, would leave every existing assertion here still passing.
-- Catalog reads, so they run under the owning role.
-- ---------------------------------------------------------------------------------

select tests.reset_to_owner();

select is(
  (
    select count(*)::int
    from unnest(array[
      'profiles', 'account_profile_links', 'athletes', 'pilot_team_creation_grants',
      'teams', 'team_memberships', 'team_membership_functions', 'team_invitations',
      'team_admin_requests', 'account_notifications', 'team_audit_events'
    ]) as t(rel)
    where not has_table_privilege('authenticated', 'public.' || rel, 'select')
  ),
  0,
  'authenticated holds SELECT on every RLS-protected Team Foundation table, so its reads reach the policies instead of failing at the ACL check'
);

select is(
  (
    select count(*)::int
    from unnest(array[
      'profiles', 'account_profile_links', 'athletes', 'pilot_team_creation_grants',
      'teams', 'team_memberships', 'team_membership_functions', 'team_invitations',
      'team_admin_requests', 'account_notifications', 'team_audit_events'
    ]) as t(rel),
    unnest(array['insert', 'update', 'delete']) as p(priv)
    where has_table_privilege('authenticated', 'public.' || rel, priv)
  ),
  0,
  'authenticated holds no INSERT/UPDATE/DELETE on any of them — every mutation stays SECURITY DEFINER RPC-only (requirement 130)'
);

select is(
  (
    select count(*)::int
    from unnest(array[
      'profiles', 'account_profile_links', 'athletes', 'pilot_team_creation_grants',
      'teams', 'team_memberships', 'team_membership_functions', 'team_invitations',
      'team_admin_requests', 'account_notifications', 'team_audit_events'
    ]) as t(rel),
    unnest(array['select', 'insert', 'update', 'delete']) as p(priv)
    where has_table_privilege('anon', 'public.' || rel, priv)
  ),
  0,
  'anon holds no direct table privilege of any kind on any of them — signed-out access fails closed at the ACL check'
);

select * from finish();
rollback;

-- ---------------------------------------------------------------------------------
-- Two-session concurrency verification (correction item 1/12) — pgTAP runs entirely
-- within one transaction/session and cannot simulate two truly concurrent backends
-- blocking on the same lock. The following procedures are therefore NOT executed by
-- this file or by any other automated process in this repository; they are run by
-- hand, with two separate concurrent `psql` connections against a real local
-- database.
--
-- EXECUTED. Every procedure and both orderings of each have been run against the
-- local Supabase Postgres with two genuinely concurrent sessions. Each recorded
-- "observed" line below is the actual result, not an expectation. In every ordering
-- the blocked session was confirmed to be waiting on a lock (`pg_stat_activity`
-- reporting `Lock/transactionid` for the row-lock cases and `Lock/advisory` for the
-- team-invariant cases) rather than merely being slow, and the state left behind was
-- read back from a third connection afterwards. No observed state, at any point in
-- any ordering, contained an active Team with zero active `team_admin` functions.
--
-- Procedure A — accept_admin_request vs revoke_admin_request race:
--   1. Create a Team Admin Request R for an active membership M (as its admin).
--   2. In session 1 (as M's own account): begin; select public.accept_admin_request(R);
--      — do NOT commit yet.
--   3. In session 2 (as the admin): select public.revoke_admin_request(R); — this
--      call must BLOCK (not error, not return) until session 1 commits or rolls back,
--      because accept_admin_request holds a `for update` lock on R's row.
--   4. Commit session 1. Session 2's revoke_admin_request then completes as a no-op
--      (R is already 'accepted', so revoke's own WHERE clause matches zero rows).
--      OBSERVED: session 2 blocked on `Lock/transactionid`; after the commit it
--      returned without error; R.status = 'accepted'; the nominee's Membership held
--      exactly one active `team_admin` function.
--   5. Repeat with the revoke committing first — the admin's revoke runs in an open
--      transaction and the nominee's accept blocks behind it.
--      OBSERVED: session 2's accept blocked on `Lock/transactionid`; once unblocked
--      it failed with `revoked: This Admin Request can no longer be accepted.`;
--      R.status = 'revoked'; zero active `team_admin` functions on the nominee's
--      Membership.
--
-- Procedure B — accept_admin_request vs remove_member race (membership invalidation):
--   1. Create a Team Admin Request R for an active membership M.
--   2. In session 1 (as M's own account): begin; select public.accept_admin_request(R);
--      — do NOT commit yet.
--   3. In session 2 (as an admin): select public.remove_member(<team>, M); — this call
--      must BLOCK on session 1's `for update` lock on M's membership row.
--   4. Commit session 1 (accept succeeds, team_admin granted). Session 2's
--      remove_member then proceeds and ends the membership AND its now-active
--      team_admin function together.
--      OBSERVED: session 2 blocked on `Lock/transactionid`; after the commit it
--      returned without error; the Membership ended with end_reason 'removed', and
--      zero active `team_admin` functions survived pointing at it. R stayed
--      'accepted' — the accept genuinely happened and was then wound back by the
--      removal, atomically.
--   5. Repeat with remove_member committing first.
--      OBSERVED: session 2's accept blocked on `Lock/transactionid`; once unblocked
--      it failed with `revoked: This Admin Request can no longer be accepted.` —
--      NOT `conflict: This membership has already ended.`, which an earlier revision
--      of this comment predicted. The reason is in the code, and the code is right:
--      remove_member atomically REVOKES the member's pending Admin Request as part of
--      ending the Membership, and accept_admin_request checks the REQUEST's status
--      before it looks at the Membership's — so by the time the blocked accept
--      resumes, the request it was given is already 'revoked' and it never reaches
--      the membership-status branch. Both error kinds are a correct closed failure;
--      the documentation was wrong, not the precedence, and the precedence must not
--      be reordered to match the old prose. Final state: R.status = 'revoked', the
--      Membership ended with end_reason 'removed', and no `team_admin` function was
--      ever granted to it.
--
-- Procedure C — concurrent create_admin_request for the same membership:
--   1. Two sessions simultaneously call
--      select public.create_admin_request(<team>, <same membership>);
--   2. Exactly one must succeed; the other must block until the first commits, then
--      fail with 'conflict: An Admin Request is already pending for this member.' —
--      never two simultaneously pending requests for the same membership.
--      OBSERVED: session 1's call returned the new request row; session 2 blocked on
--      `Lock/transactionid` and, once unblocked, failed with exactly that `conflict`
--      message. Exactly one effectively-pending request remained — and exactly one
--      request ROW existed in total, so the losing call left nothing behind at all.
--
-- Procedure D — restore_team vs the final active admin's leave_team (correction
-- item 1's primary scenario — this is the race the fix in this revision exists to
-- close). Rewritten in the third correction pass as two explicit, executable
-- orderings rather than a single ambiguous narrative — a `select` statement that has
-- already returned inside an open transaction has COMPLETED, and (if it took the
-- advisory lock) is now HOLDING that lock for the rest of the transaction, not
-- "about to block" inside a statement that finished.
--
--   Setup: an ARCHIVED team T with exactly one active member A, who is T's sole
--   active Team Admin (reachable via: create T, archive T while A is still admin —
--   see §7/§15 above for how to reach this state). Both sessions authenticate as A
--   (leave_team/restore_team both derive the caller from auth.uid(); this procedure
--   needs only one account).
--
--   Ordering 1 — restore_team's advisory lock is acquired first:
--   1. Session 2: begin; select public.restore_team(T); — this statement runs to
--      completion: it calls private.lock_team_admin_invariant(T) (uncontended,
--      acquired immediately), re-derives admin authorization for A (succeeds — A is
--      still active admin), reads T.status = 'archived', and updates it to
--      'active'. The statement has now RETURNED; the advisory lock is held for the
--      rest of session 2's still-open transaction. Do NOT commit session 2 yet.
--   2. Session 1: begin; select public.leave_team(T); — this locks A's own
--      Membership row `for update` (granted immediately — session 2 never touched
--      that row), determines v_is_admin = true, and calls
--      private.lock_team_admin_invariant(T) — this call BLOCKS, because session 2
--      is still holding that exact advisory lock inside its own open transaction.
--      Session 1 is now waiting; it has not yet re-read T's status.
--   3. Commit session 2. Session 1's blocked call is unblocked and proceeds: it
--      re-reads T.status, now durably 'active', and
--      count_other_active_admins(T, A's membership id) returns 0 — the condition
--      `v_other_admins < 1 and v_team_status <> 'archived'` is true, so session 1's
--      leave_team MUST fail with 'last_admin_invariant: ...', never reaching its
--      UPDATE statement. Roll back session 1 (or let the exception abort it).
--   4. Confirm, from a third connection: T.status = 'active'; A still has an active
--      Membership on T and still holds an active `team_admin` function on it. "T is
--      active" and "A is still T's only active admin" are both true together —
--      never "T active AND zero active admins".
--      OBSERVED: session 1 blocked on `Lock/advisory`; once unblocked it failed with
--      `last_admin_invariant: You are the final active Team Admin. ...`. Final state
--      read from a third connection: T.status = 'active', A's Membership 'active',
--      one active `team_admin` function on it, one active member.
--
--   Ordering 2 — leave_team's transaction commits before restore_team starts:
--   1. Session 1: begin; select public.leave_team(T); — locks A's Membership row,
--      determines v_is_admin = true, calls lock_team_admin_invariant(T)
--      (uncontended — session 2 has not started yet, so this is acquired
--      immediately, not blocked), re-reads T.status = 'archived' (still true), and
--      — because the archived-team exemption applies — proceeds to completion: A's
--      Membership and A's `team_admin` function are both ended. The statement has
--      RETURNED; session 1 still holds the advisory lock for the rest of its own
--      open transaction. Do NOT commit session 1 yet.
--   2. Session 2: begin; select public.restore_team(T); — calls
--      lock_team_admin_invariant(T) first, which BLOCKS, because session 1 is still
--      holding it inside its own open transaction. Session 2 is now waiting; it has
--      not yet re-derived admin authorization.
--   3. Commit session 1. Session 2's blocked call is unblocked and proceeds: it
--      re-derives `private.is_active_admin(T)` for A, which is now FALSE (A's
--      Membership and `team_admin` function both ended durably in step 1) —
--      restore_team MUST fail with 'forbidden: You do not have permission to do
--      this.', never reaching its UPDATE statement. Roll back session 2.
--   4. Confirm, from a third connection: T.status is still 'archived' (restore's
--      UPDATE never ran); A has no active Membership on T at all. T remains
--      archived with zero active admins — a permitted, stable state for an
--      archived team (Decision 9), never silently flipped to 'active' by a caller
--      no longer authorized to do so.
--      OBSERVED: session 2 blocked on `Lock/advisory`; once unblocked it failed with
--      `forbidden: You do not have permission to do this.`. Final state: T.status =
--      'archived', A's Membership 'ended' with end_reason 'left', zero active
--      Memberships and zero active `team_admin` functions on T.
--
--   Both orderings: never observe "T.status = 'active' AND T has zero active
--   `team_admin` functions", checked from a third connection after both sessions
--   finish. OBSERVED: the invariant held in both orderings.
--
-- Procedure E — restore_team vs the final active admin's relinquish_own_admin
-- (same reasoning and same two-ordering structure as Procedure D; the terminating
-- action differs, which matters because relinquish_own_admin ends only A's
-- `team_admin` function, never A's Membership):
--
--   Setup: identical to Procedure D — an ARCHIVED team T with a sole active
--   member/admin A. Both sessions authenticate as A.
--
--   Ordering 1 — restore_team's advisory lock is acquired first:
--   1. Session 2: begin; select public.restore_team(T); — identical to Procedure
--      D Ordering 1 step 1: completes, holding the advisory lock, having flipped T
--      to 'active'. Do NOT commit yet.
--   2. Session 1: begin; select public.relinquish_own_admin(T); — reads A's
--      Membership (an unlocked read, by this function's own design — see
--      docs/adr/0022 §Team Lifecycle Lock Ordering), confirms A currently holds
--      `team_admin`, then calls lock_team_admin_invariant(T) — BLOCKS on session
--      2's held lock. Session 1 has not yet re-read T's status.
--   3. Commit session 2. Session 1's blocked call is unblocked: it re-reads
--      T.status = 'active' and count_other_active_admins = 0, so
--      `v_other_admins < 1 and v_team_status <> 'archived'` is true —
--      relinquish_own_admin MUST fail with 'last_admin_invariant: ...'. A's
--      `team_admin` function is never ended. Roll back session 1.
--   4. Confirm: T.status = 'active'; A still holds an active `team_admin` function
--      on T. Never "T active AND zero active admins".
--      OBSERVED: session 1 blocked on `Lock/advisory`; once unblocked it failed with
--      `last_admin_invariant: You are the final active Team Admin. ...`. Final state:
--      T.status = 'active', A's Membership 'active', one active `team_admin`
--      function on it.
--
--   Ordering 2 — relinquish_own_admin's transaction commits before restore_team
--   starts:
--   1. Session 1: begin; select public.relinquish_own_admin(T); — acquires the
--      advisory lock uncontended, re-reads T.status = 'archived' (still true), the
--      archived-team exemption applies, and A's `team_admin` function is ended —
--      A's Membership itself remains ACTIVE (relinquish never touches Membership
--      status, unlike leave_team). The statement has RETURNED; session 1 still
--      holds the advisory lock. Do NOT commit yet.
--   2. Session 2: begin; select public.restore_team(T); — calls
--      lock_team_admin_invariant(T) first, which BLOCKS on session 1's held lock.
--   3. Commit session 1. Session 2's blocked call is unblocked: it re-derives
--      `private.is_active_admin(T)` for A. A is still an ACTIVE MEMBER of T (only
--      the function ended, not the Membership), but no longer holds an active
--      `team_admin` function, so `is_active_admin(T)` for A is FALSE —
--      restore_team, called BY A, MUST fail with 'forbidden: You do not have
--      permission to do this.'. This is unconditional on whether some OTHER admin
--      exists anywhere: `is_active_admin` checks the CALLER (A), and in this
--      specific setup there is no other active admin on T at all — T has zero
--      active Team Admins at this point, which is exactly the state
--      relinquish_own_admin's own archived-team exemption is allowed to produce.
--      Roll back session 2.
--   4. Confirm: T.status is still 'archived' (never flipped to 'active' by a caller
--      no longer authorized); A remains an active, non-admin member of T; T has
--      zero active Team Admins. This is a permitted, stable state for an archived
--      team — never "T active AND zero active admins".
--      OBSERVED: session 2 blocked on `Lock/advisory`; once unblocked it failed with
--      `forbidden: You do not have permission to do this.`. Final state: T.status =
--      'archived', A's Membership still 'active', zero active `team_admin` functions
--      on T — exactly the archived-team state relinquish's own exemption may produce.
--
--   A successful restore_team by a DIFFERENT remaining admin is explicitly NOT a
--   possible outcome of Ordering 2 as set up above (there is no such admin in this
--   procedure's setup) — that would require a distinct setup naming a second admin
--   B and B (not A) calling restore_team, which is a different procedure from this
--   one and must not be presented as an alternate branch of A's own restore
--   attempt.
--
--   Both orderings: never observe "T.status = 'active' AND T has zero active
-- `team_admin` functions", checked the same way as Procedure D step 4. OBSERVED: the
-- invariant held in both orderings.
