-- Team Foundation — SECURITY DEFINER RPC functions (requirements 47-138). See the
-- schema migration's header note: executed and exercised against a real local
-- Supabase Postgres by the pgTAP suite under supabase/tests/. The two-session
-- concurrency behaviour these functions' locking exists to guarantee has been
-- verified separately (Procedures A-E, supabase/tests/README.md) — pgTAP runs in one
-- transaction and cannot represent it.
--
-- Every function below:
--   * is SECURITY DEFINER with an explicit, pinned `search_path` (requirement 133);
--   * derives caller identity exclusively from `auth.uid()` — a caller-supplied
--     profile/team/email/owner value is NEVER trusted for authorization
--     (requirement 132); parameters that look like they name "who" are only ever
--     used as the TARGET of an admin's action, never as the ACTOR;
--   * revokes the default PUBLIC execute grant and grants only to `authenticated`
--     (except the one operational-recovery function, granted only to
--     `service_role` — requirement 98);
--   * never leaks a raw Postgres/constraint error message to the caller — every
--     expected failure is raised as `'<kind>: <human message>'`, where `<kind>` is
--     one of this project's TeamErrorKind values (src/lib/team/errors.ts). The
--     Supabase-backed TeamService (src/lib/supabase/supabaseTeamService.ts) parses
--     that prefix and falls back to `unexpected_error` for anything else — an
--     unrecognized prefix or a genuine unhandled exception is NEVER shown verbatim.
--
-- Concurrency: the last-active-Team-Admin invariant (requirement 126) is enforced
-- with a per-team `pg_advisory_xact_lock` — held for the rest of the calling
-- transaction, released automatically on commit/rollback — around every operation
-- that could reduce a team's active-admin count. Duplicate-active-membership
-- prevention (requirement 64) relies on the schema's own partial unique index,
-- whose `unique_violation` is caught and translated below, rather than an advisory
-- lock, since the database constraint is already atomic and simpler to reason
-- about than an application-level lock for that specific case.

-- ---------------------------------------------------------------------------------
-- Internal helpers (private schema — not exposed via PostgREST)
-- ---------------------------------------------------------------------------------

create function private.require_profile()
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid;
begin
  v_profile_id := private.current_profile_id();
  if v_profile_id is null then
    raise exception 'forbidden: Profile not found.';
  end if;
  return v_profile_id;
end;
$$;

create function private.require_active_admin(p_team_id uuid)
returns uuid
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid;
begin
  v_profile_id := private.require_profile();
  if not private.is_active_admin(p_team_id) then
    raise exception 'forbidden: You do not have permission to do this.';
  end if;
  return v_profile_id;
end;
$$;

create function private.require_team(p_team_id uuid)
returns public.teams
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_team public.teams;
begin
  select * into v_team from public.teams where id = p_team_id;
  if v_team.id is null then
    raise exception 'not_found: Team not found.';
  end if;
  return v_team;
end;
$$;

create function private.assert_team_active(p_team public.teams)
returns void
language plpgsql
as $$
begin
  if p_team.status <> 'active' then
    raise exception 'archived_team: This team is archived.';
  end if;
end;
$$;

-- Locks the team's admin-count invariant for the rest of this transaction. Every
-- function that can reduce the active-admin count for a team acquires this before
-- reading `count_other_active_admins`, so two concurrent attempts serialize rather
-- than both observing "1 other admin" and both proceeding.
create function private.lock_team_admin_invariant(p_team_id uuid)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  select pg_advisory_xact_lock(hashtext('team_admin_invariant:' || p_team_id::text));
$$;

create function private.count_other_active_admins(p_team_id uuid, p_exclude_membership_id uuid)
returns integer
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select count(*)::integer
  from public.team_memberships m
  join public.team_membership_functions f on f.membership_id = m.id
  where m.team_id = p_team_id
    and m.status = 'active'
    and m.id <> p_exclude_membership_id
    and f.function = 'team_admin'
    and f.status = 'active';
$$;

-- Total validation for every public boundary that accepts a TeamFunction array
-- (docs/adr/0022 §Function Array Input Validation) — rejects a NULL array (which
-- `<@` alone treats as unknown/true-ish inside `if not (...)`, silently skipping the
-- check it looks like it performs) and a duplicate function value (which would
-- otherwise pass this shape check and only fail later, as a raw unique_violation,
-- when the caller's insert loop reaches the second occurrence). Every raised
-- exception here is `invalid_input`, never a generic/constraint error, regardless of
-- which malformed shape triggered it.
create function private.validate_function_array(p_functions text[], p_allowed text[])
returns void
language plpgsql
as $$
declare
  v_distinct_count integer;
begin
  if p_functions is null then
    raise exception 'invalid_input: Provide a function list.';
  end if;
  if not (p_functions <@ p_allowed) then
    raise exception 'invalid_input: Unknown function proposed.';
  end if;
  select count(*) into v_distinct_count from (select distinct unnest(p_functions) as fn) as d;
  if v_distinct_count <> coalesce(array_length(p_functions, 1), 0) then
    raise exception 'invalid_input: Duplicate function proposed.';
  end if;
end;
$$;

create function private.audit(
  p_team_id uuid,
  p_actor_profile_id uuid,
  p_event_type text,
  p_payload jsonb
)
returns void
language sql
security definer
set search_path = public, pg_temp
as $$
  insert into public.team_audit_events (team_id, actor_profile_id, event_type, payload)
  values (p_team_id, p_actor_profile_id, p_event_type, coalesce(p_payload, '{}'::jsonb));
$$;

-- ---------------------------------------------------------------------------------
-- Profile bootstrap (requirements 1-13)
-- ---------------------------------------------------------------------------------

create function public.bootstrap_profile(p_display_name text)
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_trimmed text := btrim(p_display_name);
  v_profile_id uuid;
  v_profile public.profiles;
begin
  if v_trimmed = '' then
    raise exception 'invalid_input: Enter a display name.';
  end if;
  if length(v_trimmed) > 80 then
    raise exception 'invalid_input: Display name is too long.';
  end if;

  v_profile_id := private.current_profile_id();
  if v_profile_id is not null then
    update public.profiles
      set display_name = v_trimmed, updated_at = now()
      where id = v_profile_id
      returning * into v_profile;
    return v_profile;
  end if;

  insert into public.profiles (display_name) values (v_trimmed) returning * into v_profile;
  insert into public.account_profile_links (account_id, profile_id) values (auth.uid(), v_profile.id);
  return v_profile;
end;
$$;

revoke all on function public.bootstrap_profile(text) from public;
grant execute on function public.bootstrap_profile(text) to authenticated;

create function public.has_pilot_team_creation_capability()
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1 from public.pilot_team_creation_grants where profile_id = private.current_profile_id()
  );
$$;

revoke all on function public.has_pilot_team_creation_capability() from public;
grant execute on function public.has_pilot_team_creation_capability() to authenticated;

-- The one narrow read RPC in this file (everything else read-only goes through plain
-- RLS-scoped `select`s from the client) — needed because a client has no other way
-- to learn its OWN profile id/display-name without first knowing that id, and
-- `profiles_select`'s RLS policy also returns teammates' rows, which a plain
-- unfiltered select could not disambiguate from "mine" on the client side.
create function public.get_my_profile()
returns public.profiles
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select p.* from public.profiles p where p.id = private.current_profile_id();
$$;

revoke all on function public.get_my_profile() from public;
grant execute on function public.get_my_profile() to authenticated;

-- ---------------------------------------------------------------------------------
-- Team creation (requirements 15-25)
-- ---------------------------------------------------------------------------------

create function public.create_team(
  p_name text,
  p_participation_as_player boolean,
  p_functions text[]
)
returns public.teams
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := private.require_profile();
  v_name text := btrim(p_name);
  v_team public.teams;
  v_membership_id uuid;
  v_fn text;
begin
  if not public.has_pilot_team_creation_capability() then
    raise exception 'forbidden: This account does not have team-creation access yet.';
  end if;
  if v_name = '' then
    raise exception 'invalid_input: Enter a team name.';
  end if;
  perform private.validate_function_array(p_functions, array['coach', 'training_lead']::text[]);

  insert into public.teams (name, created_by_profile_id)
    values (v_name, v_profile_id)
    returning * into v_team;

  insert into public.team_memberships (team_id, profile_id, participation_as_player)
    values (v_team.id, v_profile_id, p_participation_as_player)
    returning id into v_membership_id;

  insert into public.team_membership_functions (membership_id, function) values (v_membership_id, 'team_admin');
  foreach v_fn in array p_functions loop
    insert into public.team_membership_functions (membership_id, function) values (v_membership_id, v_fn);
  end loop;

  perform private.audit(v_team.id, v_profile_id, 'team_created', jsonb_build_object('name', v_name));
  return v_team;
end;
$$;

revoke all on function public.create_team(text, boolean, text[]) from public;
grant execute on function public.create_team(text, boolean, text[]) to authenticated;

create function public.rename_team(p_team_id uuid, p_name text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := private.require_active_admin(p_team_id);
  v_team public.teams := private.require_team(p_team_id);
  v_name text := btrim(p_name);
begin
  perform private.assert_team_active(v_team);
  if v_name = '' then
    raise exception 'invalid_input: Enter a team name.';
  end if;
  update public.teams set name = v_name where id = p_team_id;
  perform private.audit(p_team_id, v_profile_id, 'team_renamed', jsonb_build_object('name', v_name));
end;
$$;

revoke all on function public.rename_team(uuid, text) from public;
grant execute on function public.rename_team(uuid, text) to authenticated;

create function public.archive_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := private.require_active_admin(p_team_id);
  v_team public.teams := private.require_team(p_team_id);
begin
  if v_team.status = 'archived' then
    return; -- idempotent
  end if;
  -- No authenticated caller can reach this in practice today (require_active_admin
  -- above already fails for a team with zero active admins, which is the only way a
  -- team enters 'recovery' — see docs/adr/0022 Decision 9), but this is stated
  -- explicitly rather than relied upon implicitly, matching every other status
  -- transition in this file being an explicit, named check.
  if v_team.status = 'recovery' then
    raise exception 'conflict: This team is in restricted recovery and cannot be archived directly.';
  end if;
  update public.teams set status = 'archived', archived_at = now() where id = p_team_id;
  perform private.audit(p_team_id, v_profile_id, 'team_archived', '{}'::jsonb);
end;
$$;

revoke all on function public.archive_team(uuid) from public;
grant execute on function public.archive_team(uuid) to authenticated;

create function public.restore_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := private.require_profile();
  v_team public.teams;
begin
  -- Acquires the SAME per-team advisory lock leave_team/relinquish_own_admin take
  -- before deciding whether the archived-team exemption to the final-admin
  -- invariant applies (docs/adr/0022 §Team Lifecycle Lock Ordering) — BEFORE
  -- re-deriving admin authorization or reading team status. Without this, restore
  -- and a final admin's leave/relinquish could each read a status snapshot the
  -- other's commit had already invalidated: restore reads 'archived' and flips the
  -- team to 'active', while a concurrent leave/relinquish (already past its own
  -- pre-lock status read) still sees the stale 'archived' value and applies the
  -- archived-team exemption, ending the last admin's function. Serializing both
  -- through this one lock, and re-reading status only AFTER acquiring it, makes
  -- "active team, zero active admins" unreachable via this interleaving rather than
  -- merely unlikely.
  perform private.lock_team_admin_invariant(p_team_id);

  if not private.is_active_admin(p_team_id) then
    raise exception 'forbidden: You do not have permission to do this.';
  end if;
  v_team := private.require_team(p_team_id);
  if v_team.status = 'active' then
    return; -- idempotent
  end if;
  if v_team.status = 'recovery' then
    raise exception 'forbidden: This team is in restricted recovery and cannot be restored directly.';
  end if;
  update public.teams set status = 'active', restored_at = now() where id = p_team_id;
  perform private.audit(p_team_id, v_profile_id, 'team_restored', '{}'::jsonb);
end;
$$;

revoke all on function public.restore_team(uuid) from public;
grant execute on function public.restore_team(uuid) to authenticated;

-- ---------------------------------------------------------------------------------
-- Membership and function administration (requirements 26-46)
-- ---------------------------------------------------------------------------------

create function public.set_participation(p_team_id uuid, p_membership_id uuid, p_participation_as_player boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := private.require_active_admin(p_team_id);
  v_team public.teams := private.require_team(p_team_id);
  v_membership public.team_memberships;
begin
  perform private.assert_team_active(v_team);
  -- Locked before deciding (docs/adr/0022 §Membership Write-Time Locking) — a
  -- concurrent leave_team/remove_member ending this exact membership either fully
  -- commits before this proceeds, or fully blocks until this transaction finishes,
  -- so the status check below is never based on a snapshot a concurrent end could
  -- invalidate a moment later.
  select * into v_membership from public.team_memberships where id = p_membership_id and team_id = p_team_id for update;
  if v_membership.id is null then
    raise exception 'not_found: Membership not found.';
  end if;
  if v_membership.status <> 'active' then
    raise exception 'conflict: This membership has already ended.';
  end if;
  update public.team_memberships
    set participation_as_player = p_participation_as_player
    where id = p_membership_id and status = 'active';
  perform private.audit(p_team_id, v_profile_id, 'participation_changed',
    jsonb_build_object('membershipId', p_membership_id, 'participationAsPlayer', p_participation_as_player));
end;
$$;

revoke all on function public.set_participation(uuid, uuid, boolean) from public;
grant execute on function public.set_participation(uuid, uuid, boolean) to authenticated;

create function public.assign_direct_function(p_team_id uuid, p_membership_id uuid, p_function text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := private.require_active_admin(p_team_id);
  v_team public.teams := private.require_team(p_team_id);
  v_membership public.team_memberships;
begin
  if p_function is null or p_function not in ('coach', 'training_lead') then
    raise exception 'invalid_input: Unknown function proposed.';
  end if;
  perform private.assert_team_active(v_team);
  -- Locked before deciding, then re-checked (docs/adr/0022 §Membership Write-Time
  -- Locking) — without this, a concurrent leave_team/remove_member could end this
  -- exact membership between an unlocked status read and the INSERT below, leaving
  -- an active Team Function on a Membership that has, in fact, already ended. This
  -- lock/re-check makes that impossible-state outcome unreachable rather than
  -- merely unlikely, matching the discipline already applied to remove_member/
  -- leave_team/accept_admin_request's own membership-row locking.
  select * into v_membership from public.team_memberships where id = p_membership_id and team_id = p_team_id for update;
  if v_membership.id is null then
    raise exception 'not_found: Membership not found.';
  end if;
  if v_membership.status <> 'active' then
    raise exception 'conflict: This membership has already ended.';
  end if;
  if exists (
    select 1 from public.team_membership_functions
    where membership_id = p_membership_id and function = p_function and status = 'active'
  ) then
    return; -- idempotent
  end if;
  insert into public.team_membership_functions (membership_id, function) values (p_membership_id, p_function);
  perform private.audit(p_team_id, v_profile_id, 'function_assigned',
    jsonb_build_object('membershipId', p_membership_id, 'fn', p_function));
end;
$$;

revoke all on function public.assign_direct_function(uuid, uuid, text) from public;
grant execute on function public.assign_direct_function(uuid, uuid, text) to authenticated;

create function public.remove_direct_function(p_team_id uuid, p_membership_id uuid, p_function text)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := private.require_active_admin(p_team_id);
  v_team public.teams := private.require_team(p_team_id);
  v_membership public.team_memberships;
begin
  if p_function is null or p_function not in ('coach', 'training_lead') then
    raise exception 'invalid_input: Unknown function proposed.';
  end if;
  perform private.assert_team_active(v_team);
  -- Locked for the same reason and in the same order as assign_direct_function's
  -- equivalent lock (docs/adr/0022 §Membership Write-Time Locking).
  select * into v_membership from public.team_memberships where id = p_membership_id and team_id = p_team_id for update;
  if v_membership.id is null then
    raise exception 'not_found: Membership not found.';
  end if;
  -- Re-checked, matching set_participation/assign_direct_function — an ended
  -- Membership is rejected outright, the same stable way every sibling
  -- Membership-write RPC rejects it, rather than silently attempting a
  -- historical function update and emitting a misleading audit event for a
  -- Membership that no longer has any current standing (docs/adr/0022
  -- §Membership Write-Time Locking).
  if v_membership.status <> 'active' then
    raise exception 'conflict: This membership has already ended.';
  end if;
  if not exists (
    select 1 from public.team_membership_functions
    where membership_id = p_membership_id and function = p_function and status = 'active'
  ) then
    return; -- idempotent: nothing to remove, and the Membership is active
  end if;
  update public.team_membership_functions
    set status = 'ended', ended_at = now()
    where membership_id = p_membership_id and function = p_function and status = 'active';
  perform private.audit(p_team_id, v_profile_id, 'function_removed',
    jsonb_build_object('membershipId', p_membership_id, 'fn', p_function));
end;
$$;

revoke all on function public.remove_direct_function(uuid, uuid, text) from public;
grant execute on function public.remove_direct_function(uuid, uuid, text) to authenticated;

create function public.remove_admin_function(p_team_id uuid, p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := private.require_active_admin(p_team_id);
  v_team public.teams := private.require_team(p_team_id);
  v_membership public.team_memberships;
  v_other_admins integer;
begin
  -- Removing another member's Team Admin function is a collaborative roster/function
  -- change on someone ELSE, not the caller's own self-directed exit — unlike
  -- relinquish_own_admin, this is blocked on an archived team (spec §11: "ordinary
  -- collaborative writes, including roster changes"), matching permissions.ts's
  -- REQUIRES_ACTIVE_TEAM set.
  perform private.assert_team_active(v_team);
  perform private.lock_team_admin_invariant(p_team_id);
  select * into v_membership from public.team_memberships where id = p_membership_id and team_id = p_team_id;
  if v_membership.id is null then
    raise exception 'not_found: Membership not found.';
  end if;
  if v_membership.status <> 'active' then
    raise exception 'conflict: This membership has already ended.';
  end if;
  if not exists (
    select 1 from public.team_membership_functions
    where membership_id = p_membership_id and function = 'team_admin' and status = 'active'
  ) then
    return; -- idempotent: nothing to remove
  end if;

  -- No archived exemption needed here (unlike relinquish_own_admin/leave_team) —
  -- assert_team_active above already rejects this call entirely on an archived team,
  -- before this invariant check is ever reached.
  v_other_admins := private.count_other_active_admins(p_team_id, p_membership_id);
  if v_other_admins < 1 then
    raise exception 'last_admin_invariant: At least one active Team Admin must remain.';
  end if;

  update public.team_membership_functions
    set status = 'ended', ended_at = now()
    where membership_id = p_membership_id and function = 'team_admin' and status = 'active';
  perform private.audit(p_team_id, v_profile_id, 'admin_function_removed', jsonb_build_object('membershipId', p_membership_id));
end;
$$;

revoke all on function public.remove_admin_function(uuid, uuid) from public;
grant execute on function public.remove_admin_function(uuid, uuid) to authenticated;

create function public.relinquish_own_admin(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := private.require_profile();
  v_membership public.team_memberships;
  v_other_admins integer;
  v_team_status text;
begin
  select * into v_membership
    from public.team_memberships
    where team_id = p_team_id and profile_id = v_profile_id and status = 'active';
  if v_membership.id is null then
    raise exception 'forbidden: You are not an active member of this team.';
  end if;
  if not exists (
    select 1 from public.team_membership_functions
    where membership_id = v_membership.id and function = 'team_admin' and status = 'active'
  ) then
    raise exception 'forbidden: You are not an active Team Admin of this team.';
  end if;

  perform private.lock_team_admin_invariant(p_team_id);
  -- Re-read the team's status only AFTER acquiring the invariant lock (docs/adr/0022
  -- §Team Lifecycle Lock Ordering) — the status captured before this lock (there is
  -- none held here now; this function never captured one before this point either,
  -- deliberately) could otherwise be stale if a concurrent restore_team committed in
  -- the window between an early unlocked read and this decision. restore_team takes
  -- the same lock before its own status transition, so whichever of the two
  -- transactions gets here first is the one whose status this decision sees.
  select status into v_team_status from public.teams where id = p_team_id;
  v_other_admins := private.count_other_active_admins(p_team_id, v_membership.id);
  if v_other_admins < 1 and v_team_status <> 'archived' then
    raise exception 'last_admin_invariant: You are the final active Team Admin. A successor must accept an Admin Request first, or archive the team.';
  end if;

  update public.team_membership_functions
    set status = 'ended', ended_at = now()
    where membership_id = v_membership.id and function = 'team_admin' and status = 'active';
  if not found then
    -- The earlier `not exists` check (before the invariant lock) could have read a
    -- since-superseded snapshot if a concurrent remove_admin_function targeting the
    -- SAME membership committed in between — both serialize on the same per-team
    -- advisory lock, so by the time this statement runs, the function may already be
    -- gone. Fail closed rather than silently no-op on zero affected rows.
    raise exception 'conflict: This Team Admin function was already removed.';
  end if;
  perform private.audit(p_team_id, v_profile_id, 'admin_function_relinquished', jsonb_build_object('membershipId', v_membership.id));
end;
$$;

revoke all on function public.relinquish_own_admin(uuid) from public;
grant execute on function public.relinquish_own_admin(uuid) to authenticated;

create function public.remove_member(p_team_id uuid, p_membership_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := private.require_active_admin(p_team_id);
  v_team public.teams := private.require_team(p_team_id);
  v_membership public.team_memberships;
  v_is_admin boolean;
  v_other_admins integer;
begin
  perform private.assert_team_active(v_team);
  -- Locked FIRST, before deciding anything (docs/adr/0022 §Admin Request
  -- Concurrency's fixed lock order — membership row before any decision derived
  -- from it) — a concurrent accept_admin_request granting this same membership
  -- team_admin either fully commits before this proceeds, or fully blocks until
  -- this transaction finishes, so v_is_admin below is never computed from a
  -- snapshot a concurrent grant could invalidate a moment later.
  select * into v_membership from public.team_memberships where id = p_membership_id and team_id = p_team_id for update;
  if v_membership.id is null then
    raise exception 'not_found: Membership not found.';
  end if;
  if v_membership.status <> 'active' then
    raise exception 'conflict: This membership has already ended.';
  end if;

  v_is_admin := exists (
    select 1 from public.team_membership_functions
    where membership_id = p_membership_id and function = 'team_admin' and status = 'active'
  );
  if v_is_admin then
    perform private.lock_team_admin_invariant(p_team_id);
    v_other_admins := private.count_other_active_admins(p_team_id, p_membership_id);
    if v_other_admins < 1 then
      raise exception 'last_admin_invariant: At least one active Team Admin must remain.';
    end if;
  end if;

  -- Status-guarded, not a bare `where id = ...` — if a concurrent leave_team (or a
  -- retried remove_member call) already ended this exact membership between the
  -- read above and this statement, this fails closed instead of silently
  -- overwriting a real `ended_at`/`end_reason` ('left') with a later, incorrect one
  -- ('removed').
  update public.team_memberships
    set status = 'ended', ended_at = now(), end_reason = 'removed'
    where id = p_membership_id and status = 'active';
  if not found then
    raise exception 'conflict: This membership has already ended.';
  end if;
  update public.team_membership_functions
    set status = 'ended', ended_at = now()
    where membership_id = p_membership_id and status = 'active';
  update public.team_admin_requests
    set status = 'revoked', revoked_at = now()
    where membership_id = p_membership_id and status = 'pending';
  update public.account_notifications
    set read_at = now()
    where profile_id = v_membership.profile_id and kind = 'admin_request' and read_at is null
      and (payload->>'requestId') in (
        select id::text from public.team_admin_requests where membership_id = p_membership_id
      );

  insert into public.account_notifications (profile_id, kind, payload)
    values (v_membership.profile_id, 'member_removed', jsonb_build_object('teamId', p_team_id, 'teamName', v_team.name));

  perform private.audit(p_team_id, v_profile_id, 'member_removed', jsonb_build_object('membershipId', p_membership_id));
end;
$$;

revoke all on function public.remove_member(uuid, uuid) from public;
grant execute on function public.remove_member(uuid, uuid) to authenticated;

create function public.leave_team(p_team_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := private.require_profile();
  v_membership public.team_memberships;
  v_is_admin boolean;
  v_other_admins integer;
  v_team_status text;
begin
  perform private.require_team(p_team_id); -- 404s cleanly before any lock/row work
  -- Locked FIRST, same reasoning as remove_member's equivalent read above.
  select * into v_membership
    from public.team_memberships
    where team_id = p_team_id and profile_id = v_profile_id and status = 'active'
    for update;
  if v_membership.id is null then
    raise exception 'forbidden: You are not an active member of this team.';
  end if;

  v_is_admin := exists (
    select 1 from public.team_membership_functions
    where membership_id = v_membership.id and function = 'team_admin' and status = 'active'
  );
  if v_is_admin then
    perform private.lock_team_admin_invariant(p_team_id);
    -- Re-read the team's status only AFTER acquiring the invariant lock
    -- (docs/adr/0022 §Team Lifecycle Lock Ordering) — a pre-lock snapshot (as this
    -- function used to capture via require_team above) could be stale if a
    -- concurrent restore_team committed in between; restore_team takes this same
    -- lock before its own status transition, so this decision always sees whichever
    -- of the two transactions actually got here first.
    select status into v_team_status from public.teams where id = p_team_id;
    v_other_admins := private.count_other_active_admins(p_team_id, v_membership.id);
    if v_other_admins < 1 and v_team_status <> 'archived' then
      raise exception 'last_admin_invariant: You are the final active Team Admin. A successor must accept an Admin Request first, or archive the team.';
    end if;
  end if;

  -- Status-guarded for the same reason as remove_member's equivalent statement —
  -- fails closed rather than overwriting a concurrently-recorded end.
  update public.team_memberships
    set status = 'ended', ended_at = now(), end_reason = 'left'
    where id = v_membership.id and status = 'active';
  if not found then
    raise exception 'conflict: This membership has already ended.';
  end if;
  update public.team_membership_functions
    set status = 'ended', ended_at = now()
    where membership_id = v_membership.id and status = 'active';
  update public.team_admin_requests
    set status = 'revoked', revoked_at = now()
    where membership_id = v_membership.id and status = 'pending';
  update public.account_notifications
    set read_at = now()
    where profile_id = v_profile_id and kind = 'admin_request' and read_at is null
      and (payload->>'requestId') in (
        select id::text from public.team_admin_requests where membership_id = v_membership.id
      );

  perform private.audit(p_team_id, v_profile_id, 'member_left', jsonb_build_object('membershipId', v_membership.id));
end;
$$;

revoke all on function public.leave_team(uuid) from public;
grant execute on function public.leave_team(uuid) to authenticated;

-- ---------------------------------------------------------------------------------
-- Invitations (requirements 47-66)
-- ---------------------------------------------------------------------------------

-- Both helpers call pgcrypto SCHEMA-QUALIFIED. pgcrypto is installed into
-- `extensions` (see the schema migration), and every caller of these two functions is
-- a SECURITY DEFINER RPC that pins `search_path = public, pg_temp` — an unqualified
-- `digest(...)`/`gen_random_bytes(...)` cannot be resolved under that path and fails
-- every invitation operation at runtime. Qualifying the two call sites is the narrow
-- fix; adding `extensions` to a security-sensitive search_path would widen the
-- name-resolution surface of every invitation code path to fix two expressions.
--
-- Pinning each helper's OWN search_path matters independently of that, and is what
-- stops this defect from being reintroduced. An unpinned SQL function body is
-- name-resolved at CREATE time against the migration session's search_path, which on
-- Supabase is `"$user", public, extensions` — so the unqualified form was accepted by
-- the migration and only failed later, when called from a caller that pins
-- `public, pg_temp`. With the pin present, `create function` itself rejects an
-- unqualified `digest(...)` with `function digest(text, unknown) does not exist`: the
-- migration fails immediately instead of deferring the failure to the first real
-- invitation.
create function private.hash_token(p_raw_token text)
returns text
language sql
immutable
set search_path = pg_catalog, pg_temp
as $$
  select encode(extensions.digest(p_raw_token, 'sha256'), 'hex');
$$;

create function private.generate_raw_token()
returns text
language sql
volatile
set search_path = pg_catalog, pg_temp
as $$
  select encode(extensions.gen_random_bytes(32), 'base64');
$$;

create function private.validate_invitation_proposal(p_email text, p_functions text[])
returns void
language plpgsql
as $$
begin
  if btrim(p_email) !~* '^[^@[:space:]]+@[^@[:space:]]+\.[^@[:space:]]+$' then
    raise exception 'invalid_input: Enter a valid email address.';
  end if;
  perform private.validate_function_array(p_functions, array['team_admin', 'coach', 'training_lead']::text[]);
end;
$$;

-- Returns the created row PLUS the one-time raw token, as a single composite —
-- callers (the Next.js Route Handler under src/app/api/team/) build the email link
-- from `raw_token` and then discard it; it is never stored anywhere and never
-- returned again by any other function.
create type public.team_invitation_created as (
  invitation public.team_invitations,
  raw_token text
);

create function private.create_invitation_row(p_team_id uuid, p_email text, p_participation boolean, p_functions text[], p_created_by uuid)
returns public.team_invitation_created
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_raw_token text := private.generate_raw_token();
  v_row public.team_invitations;
  v_result public.team_invitation_created;
begin
  insert into public.team_invitations (
    team_id, email, participation_as_player, proposed_functions, token_hash,
    created_by_profile_id, expires_at
  ) values (
    p_team_id, btrim(p_email), p_participation, p_functions, private.hash_token(v_raw_token),
    p_created_by, now() + interval '14 days'
  ) returning * into v_row;

  v_result.invitation := v_row;
  v_result.raw_token := v_raw_token;
  return v_result;
end;
$$;

create function public.create_invitation(p_team_id uuid, p_email text, p_participation_as_player boolean, p_functions text[])
returns public.team_invitation_created
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := private.require_active_admin(p_team_id);
  v_team public.teams := private.require_team(p_team_id);
  v_result public.team_invitation_created;
begin
  perform private.assert_team_active(v_team);
  perform private.validate_invitation_proposal(p_email, p_functions);
  v_result := private.create_invitation_row(p_team_id, p_email, p_participation_as_player, p_functions, v_profile_id);
  perform private.audit(p_team_id, v_profile_id, 'invitation_created',
    jsonb_build_object('invitationId', (v_result.invitation).id, 'email', btrim(p_email)));
  return v_result;
end;
$$;

revoke all on function public.create_invitation(uuid, text, boolean, text[]) from public;
grant execute on function public.create_invitation(uuid, text, boolean, text[]) to authenticated;

-- Shared by revise_invitation and resend_invitation — both close the old row as
-- 'replaced' and create a fresh one (requirement 61/62: resend also rotates the
-- secret, so it is implemented as a replace with an identical proposal).
create function private.replace_invitation(p_invitation_id uuid, p_email text, p_participation boolean, p_functions text[])
returns public.team_invitation_created
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.team_invitations;
  v_profile_id uuid;
  v_team public.teams;
  v_result public.team_invitation_created;
begin
  -- Locked for the rest of this transaction: a concurrent revise/resend/revoke on
  -- the SAME invitation now blocks here until this transaction commits, then
  -- re-reads the row this second call already sees as no longer 'pending' —
  -- closing the narrow window a plain (unlocked) read-then-update would leave open,
  -- where both callers could create a "successor" before either update lands.
  select * into v_existing from public.team_invitations where id = p_invitation_id for update;
  if v_existing.id is null then
    raise exception 'not_found: Invitation not found.';
  end if;

  v_profile_id := private.require_active_admin(v_existing.team_id);
  v_team := private.require_team(v_existing.team_id);
  perform private.assert_team_active(v_team);
  perform private.validate_invitation_proposal(p_email, p_functions);

  if v_existing.status = 'pending' and v_existing.expires_at <= now() then
    raise exception 'expired: This invitation can no longer be revised.';
  elsif v_existing.status = 'accepted' then
    raise exception 'already_accepted: This invitation can no longer be revised.';
  elsif v_existing.status in ('revoked', 'replaced') then
    raise exception '%: This invitation can no longer be revised.', v_existing.status;
  end if;

  v_result := private.create_invitation_row(v_existing.team_id, p_email, p_participation, p_functions, v_profile_id);

  update public.team_invitations
    set status = 'replaced', replaced_by_invitation_id = (v_result.invitation).id
    where id = p_invitation_id and status = 'pending';
  if not found then
    -- Someone else replaced/revoked/accepted it between our read and this update —
    -- fail closed rather than leaving two "live" successors.
    raise exception 'conflict: This invitation was already changed by someone else.';
  end if;

  perform private.audit(v_existing.team_id, v_profile_id, 'invitation_replaced',
    jsonb_build_object('oldInvitationId', p_invitation_id, 'newInvitationId', (v_result.invitation).id));
  return v_result;
end;
$$;

create function public.revise_invitation(p_invitation_id uuid, p_email text, p_participation_as_player boolean, p_functions text[])
returns public.team_invitation_created
language sql
security definer
set search_path = public, pg_temp
as $$
  select private.replace_invitation(p_invitation_id, p_email, p_participation_as_player, p_functions);
$$;

revoke all on function public.revise_invitation(uuid, text, boolean, text[]) from public;
grant execute on function public.revise_invitation(uuid, text, boolean, text[]) to authenticated;

create function public.resend_invitation(p_invitation_id uuid)
returns public.team_invitation_created
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.team_invitations;
begin
  select * into v_existing from public.team_invitations where id = p_invitation_id;
  if v_existing.id is null then
    raise exception 'not_found: Invitation not found.';
  end if;
  return private.replace_invitation(v_existing.id, v_existing.email, v_existing.participation_as_player, v_existing.proposed_functions);
end;
$$;

revoke all on function public.resend_invitation(uuid) from public;
grant execute on function public.resend_invitation(uuid) to authenticated;

create function public.revoke_invitation(p_invitation_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_existing public.team_invitations;
  v_profile_id uuid;
  v_team public.teams;
begin
  select * into v_existing from public.team_invitations where id = p_invitation_id;
  if v_existing.id is null then
    raise exception 'not_found: Invitation not found.';
  end if;
  v_profile_id := private.require_active_admin(v_existing.team_id);
  v_team := private.require_team(v_existing.team_id);
  perform private.assert_team_active(v_team);

  update public.team_invitations
    set status = 'revoked', revoked_at = now()
    where id = p_invitation_id and status = 'pending' and expires_at > now();
  -- No FOUND check: revoking an already-terminal (or already-expired) invitation is
  -- an idempotent no-op (requirement 128) — it must never block a future invitation
  -- (requirement 60), so a zero-row update here is success, not an error.

  perform private.audit(v_existing.team_id, v_profile_id, 'invitation_revoked', jsonb_build_object('invitationId', p_invitation_id));
end;
$$;

revoke all on function public.revoke_invitation(uuid) from public;
grant execute on function public.revoke_invitation(uuid) to authenticated;

create function public.record_invitation_email_delivery(p_invitation_id uuid, p_delivered boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_team_id uuid;
begin
  select team_id into v_team_id from public.team_invitations where id = p_invitation_id;
  if v_team_id is null then
    raise exception 'not_found: Invitation not found.';
  end if;
  perform private.require_active_admin(v_team_id);
  update public.team_invitations
    set email_delivery_status = case when p_delivered then 'sent' else 'failed' end
    where id = p_invitation_id;
end;
$$;

revoke all on function public.record_invitation_email_delivery(uuid, boolean) from public;
grant execute on function public.record_invitation_email_delivery(uuid, boolean) to authenticated;

-- preview_invitation / accept_invitation both look the invitation up by hashing the
-- caller-supplied raw token — this is the ONE place in this schema a raw secret from
-- outside the database is compared, and it is compared only as a hash, never stored.
create type public.invitation_preview_result as (
  status text, -- 'ready_to_accept' | 'denied' | 'invalid_token'
  denial_reason text,
  team_name text,
  inviter_display_name text,
  participation_as_player boolean,
  proposed_functions text[]
);

create function public.preview_invitation(p_raw_token text)
returns public.invitation_preview_result
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := private.require_profile();
  v_email text;
  v_invitation public.team_invitations;
  v_team public.teams;
  v_inviter public.profiles;
  v_result public.invitation_preview_result;
  v_effective_status text;
begin
  select email into v_email from auth.users where id = auth.uid();

  select * into v_invitation from public.team_invitations where token_hash = private.hash_token(p_raw_token);
  if v_invitation.id is null then
    v_result.status := 'invalid_token';
    return v_result;
  end if;

  v_effective_status := v_invitation.status;
  if v_effective_status = 'pending' and v_invitation.expires_at <= now() then
    v_effective_status := 'expired';
  end if;

  if v_effective_status = 'expired' then
    v_result.status := 'denied'; v_result.denial_reason := 'expired'; return v_result;
  elsif v_effective_status = 'revoked' then
    v_result.status := 'denied'; v_result.denial_reason := 'revoked'; return v_result;
  elsif v_effective_status = 'replaced' then
    v_result.status := 'denied'; v_result.denial_reason := 'replaced'; return v_result;
  elsif v_effective_status = 'accepted' then
    v_result.status := 'denied'; v_result.denial_reason := 'already_accepted'; return v_result;
  elsif lower(btrim(v_invitation.email)) <> lower(btrim(coalesce(v_email, ''))) then
    v_result.status := 'denied'; v_result.denial_reason := 'wrong_email'; return v_result;
  end if;

  select * into v_team from public.teams where id = v_invitation.team_id;
  -- The inviter is whoever created THIS invitation row, never the team's original
  -- creator — a later invitation may be sent (or revised/resent) by any active Team
  -- Admin, not only the founder (docs/adr/0022 §Invitation Attribution).
  select * into v_inviter from public.profiles where id = v_invitation.created_by_profile_id;

  v_result.status := 'ready_to_accept';
  v_result.team_name := v_team.name;
  v_result.inviter_display_name := v_inviter.display_name;
  v_result.participation_as_player := v_invitation.participation_as_player;
  v_result.proposed_functions := v_invitation.proposed_functions;
  return v_result;
end;
$$;

revoke all on function public.preview_invitation(text) from public;
grant execute on function public.preview_invitation(text) to authenticated;

create function public.accept_invitation(p_raw_token text)
returns uuid -- the team id
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := private.require_profile();
  v_email text;
  v_invitation public.team_invitations;
  v_membership_id uuid;
  v_fn text;
begin
  select email into v_email from auth.users where id = auth.uid();

  -- Locked from this read through the final UPDATE below, for the whole rest of
  -- this transaction (docs/adr/0022 §Admin Request Concurrency — the same pattern
  -- applied to invitations). A concurrent revoke_invitation/replace_invitation on
  -- this exact row now either fully commits before this proceeds, or fully blocks
  -- until this transaction finishes — never an interleaving where a membership is
  -- created from an invitation that a Team Admin has, in fact, already revoked or
  -- replaced. This removes the previous "lost the race after already inserting the
  -- membership" window entirely, rather than merely detecting it after the fact.
  select * into v_invitation from public.team_invitations where token_hash = private.hash_token(p_raw_token) for update;
  if v_invitation.id is null then
    raise exception 'not_found: This invitation link is invalid.';
  end if;

  if v_invitation.status = 'pending' and v_invitation.expires_at <= now() then
    raise exception 'expired: This invitation can no longer be accepted.';
  elsif v_invitation.status = 'revoked' then
    raise exception 'revoked: This invitation can no longer be accepted.';
  elsif v_invitation.status = 'replaced' then
    raise exception 'replaced: This invitation can no longer be accepted.';
  elsif v_invitation.status = 'accepted' then
    raise exception 'already_accepted: This invitation can no longer be accepted.';
  elsif v_invitation.status <> 'pending' then
    raise exception 'conflict: This invitation can no longer be accepted.';
  elsif lower(btrim(v_invitation.email)) <> lower(btrim(coalesce(v_email, ''))) then
    raise exception 'wrong_email: This invitation can no longer be accepted.';
  end if;

  begin
    insert into public.team_memberships (team_id, profile_id, participation_as_player)
      values (v_invitation.team_id, v_profile_id, v_invitation.participation_as_player)
      returning id into v_membership_id;
  exception when unique_violation then
    raise exception 'already_exists: You are already an active member of this team.';
  end;

  foreach v_fn in array v_invitation.proposed_functions loop
    insert into public.team_membership_functions (membership_id, function) values (v_membership_id, v_fn);
  end loop;

  -- No "if not found" race branch needed here (unlike an earlier revision): the
  -- `for update` lock taken on first reading `v_invitation` above has been held
  -- continuously since before the status checks — no concurrent revoke/replace
  -- could have touched this exact row in between, so `status = 'pending'` is
  -- guaranteed still true.
  update public.team_invitations
    set status = 'accepted', accepted_at = now(), accepted_by_membership_id = v_membership_id
    where id = v_invitation.id;

  perform private.audit(v_invitation.team_id, v_profile_id, 'invitation_accepted',
    jsonb_build_object('invitationId', v_invitation.id, 'membershipId', v_membership_id));
  return v_invitation.team_id;
end;
$$;

revoke all on function public.accept_invitation(text) from public;
grant execute on function public.accept_invitation(text) to authenticated;

-- ---------------------------------------------------------------------------------
-- Admin responsibility requests (requirements 67-75)
-- ---------------------------------------------------------------------------------

create function public.create_admin_request(p_team_id uuid, p_membership_id uuid)
returns public.team_admin_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := private.require_active_admin(p_team_id);
  v_team public.teams := private.require_team(p_team_id);
  v_membership public.team_memberships;
  v_row public.team_admin_requests;
begin
  perform private.assert_team_active(v_team);

  -- Lock the TARGET membership row before deciding anything (docs/adr/0022 §Admin
  -- Request Concurrency). This is the same row `accept_admin_request`,
  -- `remove_member`, and `leave_team` lock first, in the same order (membership
  -- before any team_admin_requests row) — that shared, consistent ordering is what
  -- lets Postgres serialize every competing operation against this membership
  -- without ever deadlocking. Locking here specifically closes the
  -- check-then-insert race where two concurrent calls could both observe "no
  -- pending request exists yet" and both insert one.
  select * into v_membership
    from public.team_memberships
    where id = p_membership_id and team_id = p_team_id
    for update;
  if v_membership.id is null then
    raise exception 'not_found: Membership not found.';
  end if;
  if v_membership.status <> 'active' then
    raise exception 'conflict: This membership has already ended.';
  end if;
  if exists (
    select 1 from public.team_membership_functions
    where membership_id = p_membership_id and function = 'team_admin' and status = 'active'
  ) then
    raise exception 'already_exists: This member is already a Team Admin.';
  end if;
  -- "Effectively pending" — a stored 'pending' row past its own expires_at never
  -- blocks a fresh request, matching every other reader's derived-status rule.
  if exists (
    select 1 from public.team_admin_requests
    where membership_id = p_membership_id and status = 'pending' and expires_at > now()
  ) then
    raise exception 'conflict: An Admin Request is already pending for this member.';
  end if;

  insert into public.team_admin_requests (team_id, membership_id, created_by_profile_id, expires_at)
    values (p_team_id, p_membership_id, v_profile_id, now() + interval '14 days')
    returning * into v_row;

  insert into public.account_notifications (profile_id, kind, payload)
    values (v_membership.profile_id, 'admin_request', jsonb_build_object('teamId', p_team_id, 'teamName', v_team.name, 'requestId', v_row.id));

  perform private.audit(p_team_id, v_profile_id, 'admin_request_created', jsonb_build_object('requestId', v_row.id, 'membershipId', p_membership_id));
  return v_row;
end;
$$;

revoke all on function public.create_admin_request(uuid, uuid) from public;
grant execute on function public.create_admin_request(uuid, uuid) to authenticated;

create function public.revoke_admin_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_team_id uuid;
  v_profile_id uuid;
  v_membership_profile_id uuid;
begin
  select team_id, (select profile_id from public.team_memberships where id = membership_id)
    into v_team_id, v_membership_profile_id
    from public.team_admin_requests where id = p_request_id;
  if v_team_id is null then
    raise exception 'not_found: Admin request not found.';
  end if;
  v_profile_id := private.require_active_admin(v_team_id);

  update public.team_admin_requests
    set status = 'revoked', revoked_at = now()
    where id = p_request_id and status = 'pending' and expires_at > now();
  -- No FOUND check — idempotent, same reasoning as revoke_invitation. Correct
  -- winner-vs-accept_admin_request ordering is guaranteed by this UPDATE's own
  -- implicit row lock, matched by accept_admin_request's explicit `for update` on
  -- the same row — whichever transaction reaches this row first determines the
  -- final, durable status; the other sees it and denies/no-ops accordingly.

  -- A revoked request is no longer actionable — resolve the nominee's notification
  -- in the same transaction (docs/adr/0022 §Notification Convergence), regardless
  -- of whether the UPDATE above actually matched a row (idempotent either way).
  if v_membership_profile_id is not null then
    update public.account_notifications
      set read_at = now()
      where profile_id = v_membership_profile_id and kind = 'admin_request'
        and (payload->>'requestId') = p_request_id::text and read_at is null;
  end if;

  perform private.audit(v_team_id, v_profile_id, 'admin_request_revoked', jsonb_build_object('requestId', p_request_id));
end;
$$;

revoke all on function public.revoke_admin_request(uuid) from public;
grant execute on function public.revoke_admin_request(uuid) to authenticated;

create function public.record_admin_request_email_delivery(p_request_id uuid, p_delivered boolean)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_team_id uuid;
begin
  select team_id into v_team_id from public.team_admin_requests where id = p_request_id;
  if v_team_id is null then
    raise exception 'not_found: Admin request not found.';
  end if;
  perform private.require_active_admin(v_team_id);
  -- Delivery status for admin requests is not persisted as its own column in this
  -- beta (there is no re-sendable secret to protect the way an invitation token
  -- is) — this function exists as a symmetrical, auditable no-op hook for the
  -- calling Route Handler; it still asserts caller authorization before returning.
  perform private.audit(v_team_id, private.current_profile_id(), 'admin_request_email_delivery_recorded',
    jsonb_build_object('requestId', p_request_id, 'delivered', p_delivered));
end;
$$;

revoke all on function public.record_admin_request_email_delivery(uuid, boolean) from public;
grant execute on function public.record_admin_request_email_delivery(uuid, boolean) to authenticated;

create function public.accept_admin_request(p_request_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := private.require_profile();
  v_request public.team_admin_requests;
  v_membership public.team_memberships;
  v_is_nominee boolean;
  v_team public.teams;
begin
  -- Unlocked lookup only to discover which membership row to lock next — never
  -- used afterward to decide anything (docs/adr/0022 §Admin Request Concurrency).
  select * into v_request from public.team_admin_requests where id = p_request_id;
  if v_request.id is null then
    raise exception 'not_found: Admin request not found.';
  end if;

  -- Lock the membership row FIRST, matching create_admin_request/remove_member/
  -- leave_team's own order (membership before any team_admin_requests row) — this
  -- shared lock order is what prevents a deadlock against those functions, which
  -- also touch both rows. Locking here means a concurrent remove_member/leave_team
  -- ending this exact membership (and revoking this exact pending request as part
  -- of that same transaction) either fully commits before this proceeds, or fully
  -- blocks until this transaction finishes — never an interleaving where this
  -- function grants Team Admin to a membership that has already, durably, ended.
  select * into v_membership from public.team_memberships where id = v_request.membership_id for update;

  -- Lock the request row itself, then re-read it. A concurrent revoke_admin_request
  -- targeting this exact row blocks here until it commits (or this call blocks
  -- until a concurrent revoke commits first) — either way, the status read below is
  -- always the true, durably-committed value, never a stale pre-lock snapshot.
  select * into v_request from public.team_admin_requests where id = p_request_id for update;

  v_is_nominee := v_membership.id is not null and v_membership.profile_id = v_profile_id;

  if v_request.status = 'accepted' and v_is_nominee then
    return; -- idempotent retry (requirement 72)
  end if;
  if v_request.status = 'expired' or (v_request.status = 'pending' and v_request.expires_at <= now()) then
    raise exception 'expired: This Admin Request can no longer be accepted.';
  elsif v_request.status = 'revoked' then
    raise exception 'revoked: This Admin Request can no longer be accepted.';
  elsif v_request.status = 'replaced' then
    raise exception 'replaced: This Admin Request can no longer be accepted.';
  elsif v_request.status = 'accepted' then
    raise exception 'already_accepted: This Admin Request can no longer be accepted.';
  elsif not v_is_nominee then
    raise exception 'wrong_nominee: This Admin Request can no longer be accepted.';
  end if;
  if v_membership.id is null or v_membership.status <> 'active' then
    raise exception 'conflict: This membership has already ended.';
  end if;

  perform private.lock_team_admin_invariant(v_request.team_id);

  if not exists (
    select 1 from public.team_membership_functions
    where membership_id = v_membership.id and function = 'team_admin' and status = 'active'
  ) then
    insert into public.team_membership_functions (membership_id, function) values (v_membership.id, 'team_admin');
  end if;

  update public.team_admin_requests set status = 'accepted', accepted_at = now() where id = p_request_id;

  -- The nominee's own admin_request notification is resolved atomically in the same
  -- transaction as acceptance (docs/adr/0022 §Notification Convergence) — never left
  -- for the recipient to separately dismiss an already-actioned item.
  update public.account_notifications
    set read_at = now()
    where profile_id = v_profile_id and kind = 'admin_request' and (payload->>'requestId') = p_request_id::text and read_at is null;

  select * into v_team from public.teams where id = v_request.team_id;
  if v_team.status = 'recovery' then
    update public.teams set status = 'active' where id = v_team.id;
  end if;

  perform private.audit(v_request.team_id, v_profile_id, 'admin_request_accepted', jsonb_build_object('requestId', p_request_id));
end;
$$;

revoke all on function public.accept_admin_request(uuid) from public;
grant execute on function public.accept_admin_request(uuid) to authenticated;

-- Genuinely admin-only Team-side read model (docs/adr/0022 §Team-Side Admin Request
-- Read Model — correction). `team_admin_requests_select`'s RLS policy deliberately
-- ALSO permits the nominee to see their own request row (for their separate nominee
-- inbox, listAdminRequestsForMe) — a plain RLS-scoped `select` filtered by team_id
-- therefore cannot be a genuinely admin-only surface, since a non-admin nominee
-- could call it and receive their own row back. This function is the real
-- boundary: it requires the caller to already be that team's active admin BEFORE
-- returning anything, independent of what the underlying RLS policy would otherwise
-- allow through. Returns only effectively-pending requests for one team.
--
-- Narrow, explicit result shape — deliberately NOT `public.team_admin_requests`
-- itself and NOT `select *` (third correction pass): a caller of this RPC gets
-- exactly the columns `TeamAdminRequest` (src/lib/team/types.ts) consumes, never
-- `created_by_profile_id` or any future column the table happens to gain. Adding a
-- column to `team_admin_requests` therefore never silently expands this RPC's
-- response shape — expanding it requires a deliberate change to this type.
create type public.team_admin_request_summary as (
  id uuid,
  team_id uuid,
  membership_id uuid,
  status text,
  created_at timestamptz,
  expires_at timestamptz,
  accepted_at timestamptz,
  revoked_at timestamptz,
  replaced_by_request_id uuid
);

create function public.list_admin_requests_for_team(p_team_id uuid)
returns setof public.team_admin_request_summary
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_active_admin(p_team_id);
  return query
    select
      r.id,
      r.team_id,
      r.membership_id,
      r.status,
      r.created_at,
      r.expires_at,
      r.accepted_at,
      r.revoked_at,
      r.replaced_by_request_id
    from public.team_admin_requests r
    where r.team_id = p_team_id and r.status = 'pending' and r.expires_at > now();
end;
$$;

revoke all on function public.list_admin_requests_for_team(uuid) from public;
grant execute on function public.list_admin_requests_for_team(uuid) to authenticated;

-- ---------------------------------------------------------------------------------
-- Notifications (requirement 169)
-- ---------------------------------------------------------------------------------

create function public.acknowledge_notification(p_notification_id uuid)
returns void
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_profile_id uuid := private.require_profile();
begin
  update public.account_notifications
    set read_at = now()
    where id = p_notification_id and profile_id = v_profile_id;
  if not found then
    raise exception 'not_found: Notification not found.';
  end if;
end;
$$;

revoke all on function public.acknowledge_notification(uuid) from public;
grant execute on function public.acknowledge_notification(uuid) to authenticated;

-- ---------------------------------------------------------------------------------
-- Admin-only member email visibility (requirements 13, 41, 132, 135)
-- ---------------------------------------------------------------------------------

create type public.team_member_email_row as (
  membership_id uuid,
  email text
);

-- Never exposes auth.users directly through a browser-readable table/view
-- (requirement 135) — this is the one narrow, admin-gated path to verified member
-- emails, joining through account_profile_links -> auth.users inside a definer
-- function whose result set is exactly two columns.
create function public.get_team_member_emails(p_team_id uuid)
returns setof public.team_member_email_row
language plpgsql
security definer
set search_path = public, pg_temp
as $$
begin
  perform private.require_active_admin(p_team_id);
  return query
    select m.id, u.email::text
    from public.team_memberships m
    join public.account_profile_links l on l.profile_id = m.profile_id
    join auth.users u on u.id = l.account_id
    where m.team_id = p_team_id and m.status = 'active';
end;
$$;

revoke all on function public.get_team_member_emails(uuid) from public;
grant execute on function public.get_team_member_emails(uuid) to authenticated;

-- ---------------------------------------------------------------------------------
-- Restricted recovery — support/operational only (requirements 93-98)
-- ---------------------------------------------------------------------------------

-- Nominates an existing, currently-active member of a team in `recovery` status as
-- the next Team Admin, by creating the SAME 14-day Admin Request every ordinary
-- promotion uses (requirement 96 — recovery ends only once the nominee accepts it
-- through the normal flow, never automatically). Granted to `service_role` ONLY —
-- neither `authenticated` nor `anon` can ever call this (requirement 98). No
-- browser client, however it authenticates, holds the service-role key.
--
-- PREPARED, NOT REACHABLE IN THIS BETA: nothing in this migration or the
-- application ever transitions a team's status to 'recovery' — that would require
-- an account-deletion flow this beta does not implement (see
-- docs/adr/0022 §Recovery). This function exists so the exit path (nominate ->
-- accept) is real, schema-backed, and testable once a team is placed into recovery
-- by a future, separately authorized operational process.
create function public.operational_recover_team_admin(p_team_id uuid, p_nominee_membership_id uuid)
returns public.team_admin_requests
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_team public.teams := private.require_team(p_team_id);
  v_membership public.team_memberships;
  v_row public.team_admin_requests;
begin
  if v_team.status <> 'recovery' then
    raise exception 'conflict: Team is not in a restricted recovery state.';
  end if;
  -- Same lock-before-decide discipline as create_admin_request (docs/adr/0022
  -- §Admin Request Concurrency) — locks the target membership before checking for
  -- an existing effectively-pending request, closing the same duplicate-creation
  -- race, even though this function is service_role-only and not reachable by any
  -- ordinary authenticated caller.
  select * into v_membership from public.team_memberships where id = p_nominee_membership_id and team_id = p_team_id for update;
  if v_membership.id is null or v_membership.status <> 'active' then
    raise exception 'not_found: Nominee is not an active member of this team.';
  end if;
  if exists (
    select 1 from public.team_admin_requests
    where membership_id = p_nominee_membership_id and status = 'pending' and expires_at > now()
  ) then
    raise exception 'conflict: An Admin Request is already pending for this member.';
  end if;

  insert into public.team_admin_requests (team_id, membership_id, created_by_profile_id, expires_at)
    values (p_team_id, p_nominee_membership_id, v_team.created_by_profile_id, now() + interval '14 days')
    returning * into v_row;

  insert into public.account_notifications (profile_id, kind, payload)
    values (v_membership.profile_id, 'admin_request', jsonb_build_object('teamId', p_team_id, 'teamName', v_team.name, 'requestId', v_row.id, 'recovery', true));

  perform private.audit(p_team_id, null, 'operational_recovery_nomination', jsonb_build_object('requestId', v_row.id, 'membershipId', p_nominee_membership_id));
  return v_row;
end;
$$;

revoke all on function public.operational_recover_team_admin(uuid, uuid) from public;
grant execute on function public.operational_recover_team_admin(uuid, uuid) to service_role;
