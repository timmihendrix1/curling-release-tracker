-- Exercise Stage C4a — athlete-owned read and RPC-only mutation boundary.

alter table public.team_exercise_result_revisions enable row level security;

revoke all on table public.team_exercise_result_revisions from public, anon, authenticated;
grant select on table public.team_exercise_result_revisions to authenticated;

create policy team_exercise_result_revisions_select_own
  on public.team_exercise_result_revisions
  for select to authenticated
  using (athlete_profile_id = private.current_profile_id());

