-- Team Foundation — Row Level Security (requirement 132). See the schema migration's
-- header note: written, not executed/verified in this environment.
--
-- Design: every mutating operation goes through a SECURITY DEFINER RPC (the next
-- migration) — no table below grants INSERT/UPDATE/DELETE to `authenticated` or
-- `anon` at all. RLS here therefore only ever needs to define SELECT policies; the
-- absence of any write policy is itself the "no unrestricted direct browser writes"
-- enforcement (requirement 130), not merely an omission.

alter table public.profiles enable row level security;
alter table public.account_profile_links enable row level security;
alter table public.athletes enable row level security;
alter table public.pilot_team_creation_grants enable row level security;
alter table public.teams enable row level security;
alter table public.team_memberships enable row level security;
alter table public.team_membership_functions enable row level security;
alter table public.team_invitations enable row level security;
alter table public.team_admin_requests enable row level security;
alter table public.account_notifications enable row level security;
alter table public.team_audit_events enable row level security;

-- ---------------------------------------------------------------------------------
-- Helper functions (private schema — never exposed via PostgREST/RPC). SECURITY
-- DEFINER so they can read account_profile_links/team_memberships/
-- team_membership_functions regardless of the calling role's own RLS visibility of
-- those tables, without ever returning raw row data — only booleans/uuids. Every one
-- is STABLE (safe to call repeatedly within one statement/policy) and pins
-- search_path (requirement 133).
-- ---------------------------------------------------------------------------------

create function private.current_profile_id()
returns uuid
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select profile_id from public.account_profile_links where account_id = auth.uid();
$$;

revoke all on function private.current_profile_id() from public;
grant execute on function private.current_profile_id() to authenticated;

create function private.is_active_member(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.team_memberships m
    where m.team_id = p_team_id
      and m.status = 'active'
      and m.profile_id = private.current_profile_id()
  );
$$;

revoke all on function private.is_active_member(uuid) from public;
grant execute on function private.is_active_member(uuid) to authenticated;

create function private.is_active_admin(p_team_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select exists (
    select 1
    from public.team_memberships m
    join public.team_membership_functions f on f.membership_id = m.id
    where m.team_id = p_team_id
      and m.status = 'active'
      and m.profile_id = private.current_profile_id()
      and f.function = 'team_admin'
      and f.status = 'active'
  );
$$;

revoke all on function private.is_active_admin(uuid) from public;
grant execute on function private.is_active_admin(uuid) to authenticated;

-- ---------------------------------------------------------------------------------
-- profiles — requirement 14: display name visible to fellow active team members;
-- own profile always visible to its own account.
-- ---------------------------------------------------------------------------------

create policy profiles_select on public.profiles
  for select
  to authenticated
  using (
    id = private.current_profile_id()
    or exists (
      select 1
      from public.team_memberships mine
      join public.team_memberships theirs on theirs.team_id = mine.team_id
      where mine.profile_id = private.current_profile_id()
        and mine.status = 'active'
        and theirs.profile_id = public.profiles.id
        and theirs.status = 'active'
    )
  );

-- account_profile_links — only the owning account may see its own link row. No
-- other row is ever readable — this is deliberately narrower than "fellow members
-- can see it," since it carries the account_id, not just display identity.
create policy account_profile_links_select_own on public.account_profile_links
  for select
  to authenticated
  using (account_id = auth.uid());

-- athletes — only the owning profile.
create policy athletes_select_own on public.athletes
  for select
  to authenticated
  using (profile_id = private.current_profile_id());

-- pilot_team_creation_grants — only the owning profile may see whether it has the
-- grant (used by has_pilot_team_creation_capability()); never another profile's.
create policy pilot_grants_select_own on public.pilot_team_creation_grants
  for select
  to authenticated
  using (profile_id = private.current_profile_id());

-- teams — readable by anyone with a current OR historical membership row
-- (requirement 15). Collaborative detail (roster, invitations, admin requests)
-- remains gated to ACTIVE membership by the policies below — historical membership
-- alone grants no current collaborative access (requirement 80).
create policy teams_select_member_or_former_member on public.teams
  for select
  to authenticated
  using (
    exists (
      select 1 from public.team_memberships m
      where m.team_id = public.teams.id and m.profile_id = private.current_profile_id()
    )
  );

-- team_memberships — a caller always sees their OWN membership rows (any status,
-- for their own history); an active member sees every other ACTIVE row on a team
-- they are active on (base roster visibility, requirement 14); an active admin sees
-- every row (active or ended) for administration.
create policy team_memberships_select on public.team_memberships
  for select
  to authenticated
  using (
    profile_id = private.current_profile_id()
    or (status = 'active' and private.is_active_member(team_id))
    or private.is_active_admin(team_id)
  );

-- team_membership_functions — same visibility shape, resolved through the owning
-- membership row.
create policy team_membership_functions_select on public.team_membership_functions
  for select
  to authenticated
  using (
    exists (
      select 1
      from public.team_memberships m
      where m.id = team_membership_functions.membership_id
        and (
          m.profile_id = private.current_profile_id()
          or (team_membership_functions.status = 'active' and m.status = 'active' and private.is_active_member(m.team_id))
          or private.is_active_admin(m.team_id)
        )
    )
  );

-- team_invitations — Team Admins of the team only (requirement 41: "create,
-- replace, resend, and revoke invitations" is an admin-only capability, which
-- implies admin-only visibility of the pending list too). A prospective invitee
-- never sees this table directly — preview_invitation()/accept_invitation() are
-- SECURITY DEFINER functions that look the row up by token hash, bypassing RLS
-- deliberately and narrowly, and return only the fields requirement 54 lists.
create policy team_invitations_select_admin_only on public.team_invitations
  for select
  to authenticated
  using (private.is_active_admin(team_id));

-- team_admin_requests — Team Admins of the team, or the nominee themselves.
create policy team_admin_requests_select on public.team_admin_requests
  for select
  to authenticated
  using (
    private.is_active_admin(team_id)
    or exists (
      select 1 from public.team_memberships m
      where m.id = team_admin_requests.membership_id and m.profile_id = private.current_profile_id()
    )
  );

-- account_notifications — only the owning profile. Acknowledging (setting read_at)
-- goes through acknowledge_notification(), not a raw UPDATE policy — no
-- INSERT/UPDATE/DELETE policy is ever granted here.
create policy account_notifications_select_own on public.account_notifications
  for select
  to authenticated
  using (profile_id = private.current_profile_id());

-- team_audit_events — Team Admins of the team may read their own team's audit
-- trail (not required by any UI in this beta, but harmless and consistent with the
-- rest of the admin visibility model). No write policy exists at all — only
-- SECURITY DEFINER functions, running as table owner, ever insert here.
create policy team_audit_events_select_admin_only on public.team_audit_events
  for select
  to authenticated
  using (team_id is not null and private.is_active_admin(team_id));
