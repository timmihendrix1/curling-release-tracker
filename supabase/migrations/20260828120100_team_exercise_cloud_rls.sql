-- Exercise Stage C2a — RLS and RPC-only mutation boundary.

alter table public.team_exercise_recording_permissions enable row level security;
alter table public.team_exercise_sessions enable row level security;
alter table public.team_exercise_session_participants enable row level security;
alter table public.team_exercise_execution_refs enable row level security;
alter table public.team_exercise_result_bundles enable row level security;
alter table public.team_exercise_result_refs enable row level security;
alter table public.team_exercise_session_approvals enable row level security;
alter table public.team_exercise_private_notes enable row level security;

revoke all on table
  public.team_exercise_recording_permissions,
  public.team_exercise_sessions,
  public.team_exercise_session_participants,
  public.team_exercise_execution_refs,
  public.team_exercise_result_bundles,
  public.team_exercise_result_refs,
  public.team_exercise_session_approvals,
  public.team_exercise_private_notes
from public, anon, authenticated;

grant select on table
  public.team_exercise_recording_permissions,
  public.team_exercise_sessions,
  public.team_exercise_session_participants,
  public.team_exercise_execution_refs,
  public.team_exercise_result_bundles,
  public.team_exercise_result_refs,
  public.team_exercise_session_approvals,
  public.team_exercise_private_notes
to authenticated;

-- An athlete sees their complete permission history. Active Team members see only
-- currently active permission facts, which is the minimal eligibility cache needed
-- to select a Session roster.
create policy team_exercise_recording_permissions_select on public.team_exercise_recording_permissions
  for select to authenticated
  using (
    athlete_profile_id = private.current_profile_id()
    or (
      revoked_at is null
      and private.is_active_member(team_id)
      and exists (
        select 1 from public.teams t
        where t.id = team_exercise_recording_permissions.team_id and t.status = 'active'
      )
    )
  );

-- Participation alone is not lasting access. A completed shared envelope is readable
-- only through an accepted athlete-owned bundle for the current Profile.
create policy team_exercise_sessions_select_owned_result on public.team_exercise_sessions
  for select to authenticated
  using (
    exists (
      select 1 from public.team_exercise_result_bundles b
      where b.session_id = team_exercise_sessions.id
        and b.athlete_profile_id = private.current_profile_id()
    )
  );

create policy team_exercise_participants_select_owned_result on public.team_exercise_session_participants
  for select to authenticated
  using (
    exists (
      select 1 from public.team_exercise_result_bundles b
      where b.session_id = team_exercise_session_participants.session_id
        and b.athlete_profile_id = private.current_profile_id()
    )
  );

create policy team_exercise_execution_refs_select_owned_result on public.team_exercise_execution_refs
  for select to authenticated
  using (
    exists (
      select 1 from public.team_exercise_result_bundles b
      where b.session_id = team_exercise_execution_refs.session_id
        and b.athlete_profile_id = private.current_profile_id()
    )
  );

create policy team_exercise_result_bundles_select_own on public.team_exercise_result_bundles
  for select to authenticated
  using (athlete_profile_id = private.current_profile_id());

create policy team_exercise_result_refs_select_own on public.team_exercise_result_refs
  for select to authenticated
  using (athlete_profile_id = private.current_profile_id());

create policy team_exercise_session_approvals_select_own on public.team_exercise_session_approvals
  for select to authenticated
  using (athlete_profile_id = private.current_profile_id());

create policy team_exercise_private_notes_select_own on public.team_exercise_private_notes
  for select to authenticated
  using (athlete_profile_id = private.current_profile_id());
