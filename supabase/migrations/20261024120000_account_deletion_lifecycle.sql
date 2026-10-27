-- Mandatory Identity §8.2 and the user's 2026-10-24 Team/privacy decisions.
-- This is the persistence stage. No UI or native-storage activation is implied.
create table public.account_deletion_requests (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles(id) on delete restrict,
  requested_at timestamptz not null default now(),
  finalize_after timestamptz not null default (now() + interval '30 days'),
  cancelled_at timestamptz,
  finalized_at timestamptz,
  check (finalize_after = requested_at + interval '30 days'),
  check (cancelled_at is null or finalized_at is null)
);
create unique index account_deletion_one_pending on public.account_deletion_requests(profile_id)
  where cancelled_at is null and finalized_at is null;
alter table public.account_deletion_requests enable row level security;
revoke all on public.account_deletion_requests from public, anon, authenticated;
-- A cancellation/conditional abort fences HTTP requests whose outcome was lost.
-- Revision changes are independent of auth refresh and never reset on sign-in.
create table private.account_deletion_fences (
  profile_id uuid primary key references public.profiles(id) on delete restrict,
  revision integer not null default 0 check (revision >= 0 and revision < 2147483647)
);
revoke all on private.account_deletion_fences from public, anon, authenticated;
create table private.account_deletion_team_recovery (
  team_id uuid primary key references public.teams(id) on delete cascade,
  request_id uuid not null references public.account_deletion_requests(id) on delete restrict
);
revoke all on private.account_deletion_team_recovery from public, anon, authenticated;

create function private.linked_account_profile_id()
returns uuid language sql stable security definer set search_path = '' as $$
  select l.profile_id from public.account_profile_links l where l.account_id = auth.uid();
$$;

-- Pending accounts cannot carry the final usable Admin responsibility.
create or replace function private.count_other_active_admins(p_team_id uuid, p_exclude_membership_id uuid)
returns integer language sql stable security definer set search_path = '' as $$
  select count(*)::integer from public.team_memberships m
  join public.team_membership_functions f on f.membership_id = m.id
  where m.team_id = p_team_id and m.status = 'active' and m.id <> p_exclude_membership_id
    and f.function = 'team_admin' and f.status = 'active'
    and not exists (select 1 from public.account_deletion_requests d where d.profile_id = m.profile_id
      and d.cancelled_at is null and d.finalized_at is null);
$$;

create function private.reconcile_deletion_team_recovery(p_profile uuid, p_request uuid)
returns void language plpgsql security definer set search_path = '' as $$
declare t uuid; v_available boolean; v_status text;
begin
  for t in select distinct m.team_id from public.team_memberships m where m.profile_id = p_profile order by m.team_id loop
    perform private.lock_team_admin_invariant(t);
    select status into v_status from public.teams where id = t;
    select exists (select 1 from public.team_memberships m
      join public.team_membership_functions f on f.membership_id = m.id
      where m.team_id = t and m.status = 'active' and f.status = 'active' and f.function = 'team_admin'
        and not exists (select 1 from public.account_deletion_requests d where d.profile_id = m.profile_id
          and d.cancelled_at is null and d.finalized_at is null)) into v_available;
    if v_status = 'active' and not v_available then
      insert into private.account_deletion_team_recovery(team_id, request_id) values(t, p_request) on conflict do nothing;
      update public.teams set status = 'recovery' where id = t;
    elsif v_status = 'recovery' and v_available
      and exists (select 1 from private.account_deletion_team_recovery r where r.team_id = t) then
      update public.teams set status = 'active' where id = t;
      delete from private.account_deletion_team_recovery where team_id = t;
    end if;
  end loop;
end;
$$;
revoke all on function private.reconcile_deletion_team_recovery(uuid, uuid) from public, anon, authenticated;
revoke all on function private.linked_account_profile_id() from public, anon, authenticated;

-- The existing RLS/RPC helper is the common denial point. Pending accounts may
-- authenticate to recover, but have no sporting/Team application authority.
create or replace function private.current_profile_id()
returns uuid language plpgsql volatile security definer set search_path = '' as $$
begin
  -- Ordinary application transactions share this fence. Request/cancel/purge
  -- take it exclusively BEFORE any Profile/Team/row lock. A previously approved
  -- upload must finish before deletion can start; a queued upload rechecks the
  -- current pending state after the fence, rather than resurrecting purged raw
  -- data using an authorization check from before deletion. VOLATILE is required
  -- so this lookup receives a fresh snapshot after waiting for the fence.
  perform pg_advisory_xact_lock_shared(hashtext('account-deletion-lifecycle'));
  return (select l.profile_id from public.account_profile_links l
  where l.account_id = auth.uid() and not exists (
    select 1 from public.account_deletion_requests d
    where d.profile_id = l.profile_id and d.cancelled_at is null and d.finalized_at is null
  ));
end;
$$;

create function private.require_recent_account_authentication()
returns void language plpgsql stable security definer set search_path = '' as $$
begin
  if auth.uid() is null or not exists (
    select 1 from jsonb_array_elements(
      case when jsonb_typeof(auth.jwt()->'amr') = 'array' then auth.jwt()->'amr' else '[]'::jsonb end
    ) a
    where a->>'method' in ('otp', 'oauth', 'password', 'totp')
      and a->>'timestamp' ~ '^[0-9]{1,12}$'
      and (a->>'timestamp')::numeric between extract(epoch from clock_timestamp() - interval '5 minutes')
        and extract(epoch from clock_timestamp() + interval '30 seconds')
  ) then
    raise exception 'reauthentication_required: Confirm your sign-in again.';
  end if;
end;
$$;
revoke all on function private.require_recent_account_authentication() from public, anon, authenticated;

create function public.get_my_account_deletion_state()
returns table (request_id uuid, profile_id uuid, requested_at timestamptz, finalize_after timestamptz)
language sql stable security definer set search_path = '' as $$
  select d.id, d.profile_id, d.requested_at, d.finalize_after from public.account_deletion_requests d
  where d.profile_id = private.linked_account_profile_id()
    and d.cancelled_at is null and d.finalized_at is null;
$$;

create function public.get_my_account_deletion_control()
returns jsonb language sql stable security definer set search_path = '' as $$
  select jsonb_build_object('profile_id', p.id,
    'revision', coalesce((select f.revision from private.account_deletion_fences f where f.profile_id = p.id), 0),
    'pending', (select to_jsonb(d) from public.get_my_account_deletion_state() d))
  from public.profiles p where p.id = private.linked_account_profile_id();
$$;

create function public.request_my_account_deletion(p_expected_profile_id uuid, p_expected_revision integer)
returns table (request_id uuid, profile_id uuid, requested_at timestamptz, finalize_after timestamptz)
language plpgsql security definer set search_path = '' as $$
declare v_profile uuid; v_request uuid; v_requested_at timestamptz;
begin
  perform pg_advisory_xact_lock(hashtext('account-deletion-lifecycle'));
  v_profile := private.linked_account_profile_id();
  if v_profile is null then raise exception 'forbidden: Sign in to continue.'; end if;
  if p_expected_profile_id is distinct from v_profile then raise exception 'conflict: Account changed; start again.'; end if;
  perform pg_advisory_xact_lock(hashtext('account-deletion:' || v_profile::text));
  insert into private.account_deletion_fences(profile_id) values(v_profile) on conflict do nothing;
  if p_expected_revision is distinct from (select f.revision from private.account_deletion_fences f where f.profile_id = v_profile) then
    raise exception 'conflict: Deletion operation was superseded; check account status.';
  end if;
  if not exists (select 1 from public.account_deletion_requests d
    where d.profile_id = v_profile and d.cancelled_at is null and d.finalized_at is null) then
    perform private.require_recent_account_authentication();
    v_requested_at := clock_timestamp();
    insert into public.account_deletion_requests(profile_id, requested_at, finalize_after)
      values (v_profile, v_requested_at, v_requested_at + interval '30 days');
  end if;
  select d.id into v_request from public.account_deletion_requests d
    where d.profile_id = v_profile and d.cancelled_at is null and d.finalized_at is null;
  perform private.reconcile_deletion_team_recovery(v_profile, v_request);
  return query select * from public.get_my_account_deletion_state();
end;
$$;

create function public.cancel_my_account_deletion(p_expected_request_id uuid)
returns boolean language plpgsql security definer set search_path = '' as $$
declare v_profile uuid; v_request public.account_deletion_requests;
begin
  perform pg_advisory_xact_lock(hashtext('account-deletion-lifecycle'));
  v_profile := private.linked_account_profile_id();
  if v_profile is null then raise exception 'forbidden: Sign in to continue.'; end if;
  perform pg_advisory_xact_lock(hashtext('account-deletion:' || v_profile::text));
  perform private.require_recent_account_authentication();
  select * into v_request from public.account_deletion_requests d
    where d.profile_id = v_profile and d.id = p_expected_request_id
      and d.cancelled_at is null and d.finalized_at is null for update;
  if not found then return false; end if;
  if clock_timestamp() >= v_request.finalize_after then raise exception 'recovery_period_ended: Recovery is no longer available.'; end if;
  update public.account_deletion_requests set cancelled_at = clock_timestamp() where id = v_request.id;
  insert into private.account_deletion_fences(profile_id, revision) values(v_profile, 1)
    on conflict (profile_id) do update set revision = private.account_deletion_fences.revision + 1;
  perform private.reconcile_deletion_team_recovery(v_profile, v_request.id);
  return true;
end;
$$;

create function public.abort_my_uncommitted_account_deletion(p_expected_profile_id uuid, p_expected_revision integer)
returns integer language plpgsql security definer set search_path = '' as $$
declare v_profile uuid; v_revision integer;
begin
  perform pg_advisory_xact_lock(hashtext('account-deletion-lifecycle'));
  v_profile := private.linked_account_profile_id();
  if v_profile is null then raise exception 'forbidden: Sign in to continue.'; end if;
  if p_expected_profile_id is distinct from v_profile then raise exception 'conflict: Account changed; start again.'; end if;
  perform pg_advisory_xact_lock(hashtext('account-deletion:' || v_profile::text));
  perform private.require_recent_account_authentication();
  insert into private.account_deletion_fences(profile_id) values(v_profile) on conflict do nothing;
  select f.revision into v_revision from private.account_deletion_fences f where f.profile_id = v_profile;
  if p_expected_revision is distinct from v_revision then raise exception 'conflict: Deletion operation was superseded; check account status.'; end if;
  if exists (select 1 from public.account_deletion_requests d where d.profile_id = v_profile
    and d.cancelled_at is null and d.finalized_at is null) then
    raise exception 'conflict: A committed deletion requires explicit cancellation.';
  end if;
  update private.account_deletion_fences set revision = revision + 1 where profile_id = v_profile
    returning revision into v_revision;
  return v_revision;
end;
$$;

-- The caller's complete cloud-side personal export. Local-only work must be
-- added by the selected Profile-scoped repository composition before delivery.
-- Authentication secrets and other athletes' result bundles/notes are excluded.
create function private.account_subject_invitation_ids(p_profile uuid, p_email text)
returns setof uuid language sql stable security definer set search_path = '' as $$
  with recursive related as (
    select i.id, i.email from public.team_invitations i
    where i.accepted_by_membership_id in (select m.id from public.team_memberships m where m.profile_id = p_profile)
      or (i.accepted_by_membership_id is null and lower(i.email) = lower(p_email))
    union
    select i.id, i.email from public.team_invitations i join related r on i.replaced_by_invitation_id = r.id
      and lower(i.email) = lower(r.email)
  ) select id from related;
$$;
revoke all on function private.account_subject_invitation_ids(uuid, text) from public, anon, authenticated;

create function public.get_my_account_export()
returns jsonb language plpgsql stable security definer set search_path = '' as $$
declare p uuid := private.require_free_sporting_profile(); v_email text; v_invitations uuid[]; v_requests uuid[];
begin
  select email into v_email from auth.users where id = auth.uid();
  select coalesce(array_agg(i.id), '{}'::uuid[]) into v_invitations from public.team_invitations i
    where i.created_by_profile_id = p or i.id in (select private.account_subject_invitation_ids(p, v_email));
  select coalesce(array_agg(r.id), '{}'::uuid[]) into v_requests from public.team_admin_requests r
    where r.created_by_profile_id = p or r.membership_id in (select m.id from public.team_memberships m where m.profile_id = p);
  return jsonb_build_object(
    'schemaVersion', 1, 'exportedAt', now(),
    'profile', (select to_jsonb(x) from public.profiles x where x.id = p),
    'accountId', auth.uid(),
    'accountEmail', (select email from auth.users where id = auth.uid()),
    'legalEvidence', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.legal_acceptances x where x.profile_id = p),
    'sportingRecords', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.sporting_records x where x.profile_id = p),
    'sportingTombstones', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.sporting_record_tombstones x where x.profile_id = p),
    'teamResultBundles', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.team_exercise_result_bundles x where x.athlete_profile_id = p),
    'teamResultRevisions', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.team_exercise_result_revisions x where x.athlete_profile_id = p),
    'privateNotes', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.team_exercise_private_notes x where x.athlete_profile_id = p),
    'sharedSessionContext', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.team_exercise_sessions x
      where x.recorded_by_profile_id = p or exists (select 1 from public.team_exercise_session_participants b where b.session_id = x.id and b.profile_id = p)),
    'sessionParticipation', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.team_exercise_session_participants x where x.profile_id = p),
    'sessionApprovals', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.team_exercise_session_approvals x where x.athlete_profile_id = p),
    'invitations', (select coalesce(jsonb_agg(to_jsonb(x) - 'token_hash'), '[]'::jsonb) from public.team_invitations x where x.id = any(v_invitations)),
    'adminRequests', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.team_admin_requests x where x.id = any(v_requests)),
    'auditHistory', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.team_audit_events x
      where x.actor_profile_id = p or position(p::text in x.payload::text) > 0
        or exists (select 1 from public.team_memberships m where m.profile_id = p and position(m.id::text in x.payload::text) > 0)
        or exists (select 1 from unnest(v_invitations || v_requests) related(id) where position(related.id::text in x.payload::text) > 0)),
    'athleteCapabilities', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.athletes x where x.profile_id = p),
    'teamCreationGrants', (select coalesce(jsonb_agg(jsonb_build_object('profile_id', x.profile_id, 'granted_at', x.granted_at)), '[]'::jsonb)
      from public.pilot_team_creation_grants x where x.profile_id = p),
    'memberships', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.team_memberships x where x.profile_id = p),
    'membershipFunctions', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.team_membership_functions x
      where x.membership_id in (select m.id from public.team_memberships m where m.profile_id = p)),
    'notifications', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.account_notifications x where x.profile_id = p),
    'onboarding', (select to_jsonb(x) from public.profile_onboarding x where x.profile_id = p),
    'entitlements', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.profile_entitlements x where x.profile_id = p),
    'deletionRequests', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.account_deletion_requests x where x.profile_id = p),
    'recordingPermissions', (select coalesce(jsonb_agg(to_jsonb(x)), '[]'::jsonb) from public.team_exercise_recording_permissions x where x.athlete_profile_id = p)
  );
end;
$$;

-- The recorder must not upload a new bundle for an account awaiting deletion.
create or replace function private.team_exercise_profile_is_free_athlete(p_profile_id uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_profile_id is not null
    and exists (select 1 from public.profile_onboarding o where o.profile_id = p_profile_id)
    and exists (select 1 from public.athletes a where a.profile_id = p_profile_id)
    and exists (select 1 from public.profile_entitlements e
      where e.profile_id = p_profile_id and e.tier = 'free' and e.revoked_at is null)
    and not exists (select 1 from public.account_deletion_requests d where d.profile_id = p_profile_id
      and d.cancelled_at is null and d.finalized_at is null);
$$;

-- A deletion request is the only exception to ordinary append-only retention.
-- The transaction-local target must identify a due, still-pending request.
-- Browser roles have no table DELETE privilege, no setter RPC, and no access to
-- the finalizer. Setting a similarly named SQL variable grants no table access.
create function private.account_deletion_allows_purge(p_profile uuid)
returns boolean language sql stable security definer set search_path = '' as $$
  select p_profile::text = current_setting('curling.account_deletion_target', true)
    and exists (select 1 from public.account_deletion_requests d where d.profile_id = p_profile
      and d.cancelled_at is null and d.finalized_at is null and d.finalize_after <= now());
$$;
revoke all on function private.account_deletion_allows_purge(uuid) from public, anon, authenticated;

create or replace function private.legal_acceptances_guard_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and private.account_deletion_allows_purge(old.profile_id) then return old; end if;
  raise exception 'conflict: Legal acceptance evidence is append-only.';
end;
$$;
create or replace function private.prevent_team_exercise_result_revision_mutation()
returns trigger language plpgsql security definer set search_path = '' as $$
begin
  if tg_op = 'DELETE' and private.account_deletion_allows_purge(old.athlete_profile_id) then return old; end if;
  raise exception 'team_exercise_result_revisions are append-only';
end;
$$;
create or replace function private.profile_onboarding_guard_write()
returns trigger language plpgsql set search_path = '' as $$
begin
  if tg_op = 'DELETE' and private.account_deletion_allows_purge(old.profile_id) then return old; end if;
  raise exception 'conflict: Completed onboarding cannot be changed.';
end;
$$;

alter table public.account_notifications drop constraint account_notifications_kind_check;
alter table public.account_notifications add constraint account_notifications_kind_check
  check (kind in ('admin_request', 'member_removed', 'team_exercise_result_changed', 'shared_participant_unavailable'));

create function public.finalize_due_account_deletions(p_limit integer default 20)
returns integer language plpgsql security definer set search_path = '' as $$
declare
  d public.account_deletion_requests; v_account uuid; v_email text; v_team uuid; v_done integer := 0;
begin
  if p_limit is null or p_limit not between 1 and 100 then raise exception 'invalid_input: Invalid batch size.'; end if;
  perform pg_advisory_xact_lock(hashtext('account-deletion-lifecycle'));
  for d in select * from public.account_deletion_requests r
    where r.cancelled_at is null and r.finalized_at is null and r.finalize_after <= now()
    order by r.finalize_after, r.id limit p_limit
  loop
    -- Match request/cancel ordering: Profile advisory lock BEFORE request row.
    -- Concurrent workers skip a busy account and re-read its current state.
    if not pg_try_advisory_xact_lock(hashtext('account-deletion:' || d.profile_id::text)) then continue; end if;
    select * into d from public.account_deletion_requests r where r.id = d.id
      and r.cancelled_at is null and r.finalized_at is null and r.finalize_after <= now()
      for update skip locked;
    if not found then continue; end if;
    select l.account_id, u.email into v_account, v_email
      from public.account_profile_links l join auth.users u on u.id = l.account_id where l.profile_id = d.profile_id;
    -- Losing a link is an incomplete state, not evidence of a completed purge.
    if v_account is null then raise exception 'conflict: Account deletion could not be verified.'; end if;
    perform set_config('curling.account_deletion_target', d.profile_id::text, true);

    -- Neutral, idempotent metadata only. Current Team members and former shared
    -- session participants retain their own records; no reason or performance
    -- data is included. Never notify the account being deleted.
    insert into public.account_notifications(profile_id, kind, payload, source_event_id)
    select distinct recipients.profile_id, 'shared_participant_unavailable', '{}'::jsonb, d.id
    from (
      select m.profile_id from public.team_memberships m where m.status = 'active'
        and m.team_id in (select x.team_id from public.team_memberships x where x.profile_id = d.profile_id and x.status = 'active')
      union
      select p.profile_id from public.team_exercise_session_participants p
      where p.session_id in (select x.session_id from public.team_exercise_session_participants x where x.profile_id = d.profile_id)
    ) recipients
    where recipients.profile_id <> d.profile_id
      and exists (select 1 from public.account_profile_links l where l.profile_id = recipients.profile_id)
    on conflict (profile_id, source_event_id) do nothing;

    for v_team in select distinct m.team_id from public.team_memberships m
      where m.profile_id = d.profile_id order by m.team_id
    loop
      perform private.lock_team_admin_invariant(v_team);
      update public.team_membership_functions f set status = 'ended', ended_at = now()
        where f.status = 'active' and f.membership_id in (
          select m.id from public.team_memberships m where m.team_id = v_team and m.profile_id = d.profile_id);
      update public.team_memberships set status = 'ended', ended_at = now(), end_reason = 'left'
        where team_id = v_team and profile_id = d.profile_id and status = 'active';
      update public.teams t set status = 'recovery' where t.id = v_team and t.status = 'active'
        and not exists (select 1 from public.team_memberships m join public.team_membership_functions f on f.membership_id = m.id
          where m.team_id = t.id and m.status = 'active' and f.status = 'active' and f.function = 'team_admin');
    end loop;
    update public.team_admin_requests r set status = 'revoked', revoked_at = now()
      where r.status = 'pending' and (r.created_by_profile_id = d.profile_id or r.membership_id in (
        select m.id from public.team_memberships m where m.profile_id = d.profile_id));
    -- Historical addresses are bound through accepted memberships/replacement
    -- chains. Matching old email text globally could erase a later owner's data.
    update public.team_audit_events set payload = '{"participantAnonymized":true}'::jsonb
      where actor_profile_id = d.profile_id or position(d.profile_id::text in payload::text) > 0
        or exists (select 1 from public.team_memberships m where m.profile_id = d.profile_id
          and position(m.id::text in payload::text) > 0)
        or exists (select 1 from private.account_subject_invitation_ids(d.profile_id, v_email) related(id)
          where position(related.id::text in payload::text) > 0)
        or exists (select 1 from public.team_admin_requests r where (r.created_by_profile_id = d.profile_id
          or r.membership_id in (select m.id from public.team_memberships m where m.profile_id = d.profile_id))
          and position(r.id::text in payload::text) > 0);
    update public.team_invitations set status = 'revoked', revoked_at = now()
      where status = 'pending' and (created_by_profile_id = d.profile_id
        or id in (select private.account_subject_invitation_ids(d.profile_id, v_email)));
    update public.team_invitations set email = 'deleted-' || d.profile_id::text || '@example.invalid'
      where id in (select private.account_subject_invitation_ids(d.profile_id, v_email));
    delete from public.account_notifications where profile_id = d.profile_id or source_event_id in (
      select r.id from public.team_exercise_result_revisions r where r.athlete_profile_id = d.profile_id);
    delete from public.team_exercise_private_notes where athlete_profile_id = d.profile_id;
    delete from public.team_exercise_result_revisions where athlete_profile_id = d.profile_id;
    delete from public.team_exercise_result_refs where athlete_profile_id = d.profile_id;
    delete from public.team_exercise_result_bundles where athlete_profile_id = d.profile_id;
    delete from public.team_exercise_session_approvals where athlete_profile_id = d.profile_id;
    delete from public.team_exercise_recording_permissions where athlete_profile_id = d.profile_id;
    delete from public.sporting_records where profile_id = d.profile_id;
    delete from public.sporting_record_tombstones where profile_id = d.profile_id;
    delete from public.profile_onboarding where profile_id = d.profile_id;
    delete from public.legal_acceptances where profile_id = d.profile_id;
    delete from public.profile_entitlements where profile_id = d.profile_id;
    delete from public.pilot_team_creation_grants where profile_id = d.profile_id;
    delete from private.account_deletion_fences where profile_id = d.profile_id;
    delete from public.athletes where profile_id = d.profile_id;
    update public.profiles set display_name = 'Deleted athlete', updated_at = now() where id = d.profile_id;
    delete from public.account_profile_links where account_id = v_account;
    delete from auth.users where id = v_account;
    update public.account_deletion_requests set finalized_at = now() where id = d.id;
    perform set_config('curling.account_deletion_target', '', true);
    v_done := v_done + 1;
  end loop;
  return v_done;
end;
$$;

revoke all on function public.get_my_account_deletion_state() from public, anon;
revoke all on function public.get_my_account_deletion_control() from public, anon;
revoke all on function public.abort_my_uncommitted_account_deletion(uuid, integer) from public, anon;
revoke all on function public.request_my_account_deletion(uuid, integer) from public, anon;
revoke all on function public.cancel_my_account_deletion(uuid) from public, anon;
revoke all on function public.get_my_account_export() from public, anon;
revoke all on function public.finalize_due_account_deletions(integer) from public, anon, authenticated;
grant execute on function public.get_my_account_deletion_state() to authenticated;
grant execute on function public.get_my_account_deletion_control() to authenticated;
grant execute on function public.abort_my_uncommitted_account_deletion(uuid, integer) to authenticated;
grant execute on function public.request_my_account_deletion(uuid, integer) to authenticated;
grant execute on function public.cancel_my_account_deletion(uuid) to authenticated;
grant execute on function public.get_my_account_export() to authenticated;
grant execute on function public.finalize_due_account_deletions(integer) to service_role;
