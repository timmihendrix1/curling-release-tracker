-- Exercise Stage C2a — server-authoritative permission, completed-Session and
-- athlete-bundle mutations. Every browser mutation is SECURITY DEFINER, derives the
-- actor from auth.uid() -> Profile and is idempotent under a stable client UUID.

create type public.team_exercise_permission_mutation_result as (
  outcome text,
  changed_at timestamptz
);

create type public.team_exercise_session_mutation_result as (
  outcome text,
  content_sha256 text,
  recorded_by_profile_id uuid
);

create type public.team_exercise_bundle_mutation_result as (
  outcome text,
  content_sha256 text,
  block_reason text
);

create type public.team_exercise_note_mutation_result as (
  outcome text,
  updated_at timestamptz
);

create function private.team_exercise_profile_is_free_athlete(p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select p_profile_id is not null
    and exists (select 1 from public.profile_onboarding o where o.profile_id = p_profile_id)
    and exists (select 1 from public.athletes a where a.profile_id = p_profile_id)
    and exists (
      select 1 from public.profile_entitlements e
      where e.profile_id = p_profile_id and e.tier = 'free' and e.revoked_at is null
    );
$$;

create function private.team_exercise_has_active_membership(p_team_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_memberships m
    where m.team_id = p_team_id and m.profile_id = p_profile_id and m.status = 'active'
  );
$$;

create function private.team_exercise_membership_covers(
  p_team_id uuid,
  p_profile_id uuid,
  p_at timestamptz
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_memberships m
    where m.team_id = p_team_id
      and m.profile_id = p_profile_id
      and m.started_at <= p_at
      and (m.ended_at is null or m.ended_at >= p_at)
  );
$$;

create function private.team_exercise_has_current_permission(p_team_id uuid, p_profile_id uuid)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1 from public.team_exercise_recording_permissions p
    where p.team_id = p_team_id
      and p.athlete_profile_id = p_profile_id
      and p.revoked_at is null
  );
$$;

create function private.team_exercise_session_manifest_matches(
  p_session_id uuid,
  p_participant_profile_ids uuid[],
  p_training_athlete_profile_ids uuid[],
  p_execution_ids uuid[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select
    not exists (
      (select profile_id, participation from public.team_exercise_session_participants where session_id = p_session_id
       except
       select profile_id,
         case when profile_id = any(p_training_athlete_profile_ids) then 'training-athlete' else 'supporting' end
       from unnest(p_participant_profile_ids) profile_id)
      union all
      (select profile_id,
         case when profile_id = any(p_training_athlete_profile_ids) then 'training-athlete' else 'supporting' end
       from unnest(p_participant_profile_ids) profile_id
       except
       select profile_id, participation from public.team_exercise_session_participants where session_id = p_session_id)
    )
    and not exists (
      (select execution_id from public.team_exercise_execution_refs where session_id = p_session_id
       except select execution_id from unnest(p_execution_ids) execution_id)
      union all
      (select execution_id from unnest(p_execution_ids) execution_id
       except select execution_id from public.team_exercise_execution_refs where session_id = p_session_id)
    );
$$;

create function private.team_exercise_bundle_manifest_matches(
  p_bundle_id uuid,
  p_result_ids uuid[],
  p_execution_ids uuid[]
)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select not exists (
    (select result_id, execution_id from public.team_exercise_result_refs where bundle_id = p_bundle_id
     except select p_result_ids[i], p_execution_ids[i] from generate_subscripts(p_result_ids, 1) i)
    union all
    (select p_result_ids[i], p_execution_ids[i] from generate_subscripts(p_result_ids, 1) i
     except select result_id, execution_id from public.team_exercise_result_refs where bundle_id = p_bundle_id)
  );
$$;

create function public.set_my_team_exercise_recording_permission(
  p_team_id uuid,
  p_granted boolean
)
returns public.team_exercise_permission_mutation_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := private.require_free_sporting_profile();
  v_permission public.team_exercise_recording_permissions%rowtype;
  v_changed_at timestamptz := clock_timestamp();
  v_previous_changed_at timestamptz;
begin
  if p_team_id is null or p_granted is null then
    raise exception using message = 'invalid_input: invalid recording permission mutation';
  end if;

  perform pg_advisory_xact_lock(hashtext('team_exercise_permission:' || p_team_id::text || ':' || v_profile_id::text));

  perform 1 from public.teams t where t.id = p_team_id and t.status = 'active' for share;
  if not found then
    raise exception using message = 'forbidden: active Team membership is required';
  end if;
  perform 1 from public.team_memberships m
  where m.team_id = p_team_id and m.profile_id = v_profile_id and m.status = 'active'
  for share;
  if not found then
    raise exception using message = 'forbidden: active Team membership is required';
  end if;

  select * into v_permission
  from public.team_exercise_recording_permissions p
  where p.team_id = p_team_id and p.athlete_profile_id = v_profile_id and p.revoked_at is null
  for update;

  if p_granted then
    if v_permission.id is not null then
      return ('already_granted', v_permission.granted_at)::public.team_exercise_permission_mutation_result;
    end if;
    insert into public.team_exercise_recording_permissions(team_id, athlete_profile_id, granted_at)
    values (p_team_id, v_profile_id, v_changed_at);
    perform private.audit(p_team_id, v_profile_id, 'team_exercise_recording_permission_granted', '{}'::jsonb);
    return ('granted', v_changed_at)::public.team_exercise_permission_mutation_result;
  end if;

  if v_permission.id is null then
    select p.revoked_at into v_previous_changed_at
    from public.team_exercise_recording_permissions p
    where p.team_id = p_team_id and p.athlete_profile_id = v_profile_id
    order by p.granted_at desc limit 1;
    return ('already_revoked', v_previous_changed_at)::public.team_exercise_permission_mutation_result;
  end if;
  update public.team_exercise_recording_permissions
  set revoked_at = v_changed_at where id = v_permission.id;
  perform private.audit(p_team_id, v_profile_id, 'team_exercise_recording_permission_revoked', '{}'::jsonb);
  return ('revoked', v_changed_at)::public.team_exercise_permission_mutation_result;
end;
$$;

create function public.put_team_exercise_session(
  p_session_id uuid,
  p_team_id uuid,
  p_schema_version integer,
  p_coordination_payload text,
  p_started_at timestamptz,
  p_completed_at timestamptz,
  p_participant_profile_ids uuid[],
  p_training_athlete_profile_ids uuid[],
  p_execution_ids uuid[]
)
returns public.team_exercise_session_mutation_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recorder_profile_id uuid := private.require_free_sporting_profile();
  v_hash text;
  v_existing public.team_exercise_sessions%rowtype;
  v_execution_id uuid;
begin
  if p_session_id is null or p_team_id is null or p_schema_version is null or p_schema_version <= 0
     or p_coordination_payload is null or octet_length(p_coordination_payload) = 0
     or octet_length(p_coordination_payload) > 8388608
     or p_started_at is null or p_completed_at is null or p_completed_at < p_started_at
     or p_completed_at > now() + interval '10 minutes'
     or p_participant_profile_ids is null or cardinality(p_participant_profile_ids) = 0
     or p_training_athlete_profile_ids is null or cardinality(p_training_athlete_profile_ids) = 0
     or p_execution_ids is null or cardinality(p_execution_ids) = 0
     or array_position(p_participant_profile_ids, null) is not null
     or array_position(p_training_athlete_profile_ids, null) is not null
     or array_position(p_execution_ids, null) is not null
     or cardinality(p_participant_profile_ids) <> cardinality(array(select distinct x from unnest(p_participant_profile_ids) x))
     or cardinality(p_training_athlete_profile_ids) <> cardinality(array(select distinct x from unnest(p_training_athlete_profile_ids) x))
     or cardinality(p_execution_ids) <> cardinality(array(select distinct x from unnest(p_execution_ids) x))
     or not (p_training_athlete_profile_ids <@ p_participant_profile_ids)
     or not (v_recorder_profile_id = any(p_participant_profile_ids)) then
    raise exception using message = 'invalid_input: invalid Team Exercise Session envelope';
  end if;

  v_hash := private.sporting_payload_sha256(p_coordination_payload);
  perform pg_advisory_xact_lock(hashtext('team_exercise_session:' || p_session_id::text));
  for v_execution_id in select x from unnest(p_execution_ids) x order by x loop
    perform pg_advisory_xact_lock(hashtext('team_exercise_execution:' || v_execution_id::text));
  end loop;

  select * into v_existing from public.team_exercise_sessions s where s.id = p_session_id;
  if v_existing.id is not null then
    if v_existing.team_id = p_team_id
       and v_existing.recorded_by_profile_id = v_recorder_profile_id
       and v_existing.schema_version = p_schema_version
       and v_existing.coordination_payload = p_coordination_payload
       and v_existing.content_sha256 = v_hash
       and v_existing.started_at = p_started_at
       and v_existing.completed_at = p_completed_at
       and private.team_exercise_session_manifest_matches(
         p_session_id, p_participant_profile_ids, p_training_athlete_profile_ids, p_execution_ids
       ) then
      return ('already_present', v_hash, v_recorder_profile_id)::public.team_exercise_session_mutation_result;
    end if;
    return ('conflict', v_hash, v_recorder_profile_id)::public.team_exercise_session_mutation_result;
  end if;

  perform 1 from public.teams t where t.id = p_team_id and t.status = 'active' for share;
  if not found then
    raise exception using message = 'forbidden: active recorder Team membership is required';
  end if;
  perform 1 from public.team_memberships m
  where m.team_id = p_team_id and m.profile_id = v_recorder_profile_id and m.status = 'active'
  for share;
  if not found then
    raise exception using message = 'forbidden: active recorder Team membership is required';
  end if;
  if exists (
    select 1 from unnest(p_participant_profile_ids) participant_id
    where not private.team_exercise_membership_covers(p_team_id, participant_id, p_started_at)
  ) then
    raise exception using message = 'forbidden: every Session participant must have belonged to the Team at Session start';
  end if;
  if exists (
    select 1 from unnest(p_training_athlete_profile_ids) athlete_id
    where not private.team_exercise_profile_is_free_athlete(athlete_id)
  ) then
    raise exception using message = 'forbidden: every training athlete must be an eligible Athlete Profile';
  end if;
  if exists (
    select 1 from public.team_exercise_execution_refs e
    where e.execution_id = any(p_execution_ids)
  ) then
    return ('conflict', v_hash, v_recorder_profile_id)::public.team_exercise_session_mutation_result;
  end if;

  insert into public.team_exercise_sessions(
    id, team_id, recorded_by_profile_id, schema_version, coordination_payload,
    content_sha256, started_at, completed_at
  ) values (
    p_session_id, p_team_id, v_recorder_profile_id, p_schema_version, p_coordination_payload,
    v_hash, p_started_at, p_completed_at
  );

  insert into public.team_exercise_session_participants(session_id, profile_id, participation)
  select p_session_id, profile_id,
    case when profile_id = any(p_training_athlete_profile_ids) then 'training-athlete' else 'supporting' end
  from unnest(p_participant_profile_ids) profile_id;

  insert into public.team_exercise_execution_refs(session_id, execution_id)
  select p_session_id, execution_id from unnest(p_execution_ids) execution_id;

  perform private.audit(
    p_team_id,
    v_recorder_profile_id,
    'team_exercise_session_uploaded',
    jsonb_build_object(
      'sessionId', p_session_id,
      'trainingAthleteCount', cardinality(p_training_athlete_profile_ids),
      'participantCount', cardinality(p_participant_profile_ids)
    )
  );

  return ('inserted', v_hash, v_recorder_profile_id)::public.team_exercise_session_mutation_result;
end;
$$;

create function public.put_team_exercise_result_bundle(
  p_bundle_id uuid,
  p_session_id uuid,
  p_athlete_profile_id uuid,
  p_schema_version integer,
  p_result_payload text,
  p_recorded_at timestamptz,
  p_result_ids uuid[],
  p_execution_ids uuid[]
)
returns public.team_exercise_bundle_mutation_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_recorder_profile_id uuid := private.require_free_sporting_profile();
  v_hash text;
  v_session public.team_exercise_sessions%rowtype;
  v_existing public.team_exercise_result_bundles%rowtype;
  v_approved boolean;
  v_result_id uuid;
begin
  if p_bundle_id is null or p_session_id is null or p_athlete_profile_id is null
     or p_schema_version is null or p_schema_version <= 0
     or p_result_payload is null or octet_length(p_result_payload) = 0
     or octet_length(p_result_payload) > 8388608 or p_recorded_at is null
     or p_result_ids is null or cardinality(p_result_ids) = 0
     or p_execution_ids is null or cardinality(p_execution_ids) <> cardinality(p_result_ids)
     or array_position(p_result_ids, null) is not null or array_position(p_execution_ids, null) is not null
     or cardinality(p_result_ids) <> cardinality(array(select distinct x from unnest(p_result_ids) x))
     or cardinality(p_execution_ids) <> cardinality(array(select distinct x from unnest(p_execution_ids) x)) then
    raise exception using message = 'invalid_input: invalid Team Exercise athlete bundle';
  end if;

  v_hash := private.sporting_payload_sha256(p_result_payload);
  perform pg_advisory_xact_lock(hashtext('team_exercise_bundle:' || p_bundle_id::text));
  perform pg_advisory_xact_lock(hashtext('team_exercise_session_athlete:' || p_session_id::text || ':' || p_athlete_profile_id::text));
  for v_result_id in select x from unnest(p_result_ids) x order by x loop
    perform pg_advisory_xact_lock(hashtext('team_exercise_result:' || v_result_id::text));
  end loop;

  select * into v_session from public.team_exercise_sessions s where s.id = p_session_id;
  if v_session.id is null then
    raise exception using message = 'not_found: Team Exercise Session not found';
  end if;
  if v_session.recorded_by_profile_id <> v_recorder_profile_id then
    raise exception using message = 'forbidden: only the original authenticated recorder may upload this Session';
  end if;

  select * into v_existing from public.team_exercise_result_bundles b where b.id = p_bundle_id;
  if v_existing.id is not null then
    if v_existing.session_id = p_session_id
       and v_existing.athlete_profile_id = p_athlete_profile_id
       and v_existing.recorded_by_profile_id = v_recorder_profile_id
       and v_existing.schema_version = p_schema_version
       and v_existing.result_payload = p_result_payload
       and v_existing.content_sha256 = v_hash
       and v_existing.recorded_at = p_recorded_at
       and private.team_exercise_bundle_manifest_matches(p_bundle_id, p_result_ids, p_execution_ids) then
      return ('already_present', v_hash, null)::public.team_exercise_bundle_mutation_result;
    end if;
    return ('conflict', v_hash, null)::public.team_exercise_bundle_mutation_result;
  end if;
  if exists (
    select 1 from public.team_exercise_result_bundles b
    where b.session_id = p_session_id and b.athlete_profile_id = p_athlete_profile_id
  ) or exists (
    select 1 from public.team_exercise_result_refs r where r.result_id = any(p_result_ids)
  ) then
    return ('conflict', v_hash, null)::public.team_exercise_bundle_mutation_result;
  end if;

  if p_recorded_at < v_session.started_at or p_recorded_at > v_session.completed_at then
    raise exception using message = 'invalid_input: bundle timestamp must fall inside the completed Session';
  end if;
  perform 1 from public.teams t where t.id = v_session.team_id and t.status = 'active' for share;
  if not found then
    raise exception using message = 'forbidden: active recorder Team authority is unavailable';
  end if;
  perform 1 from public.team_memberships m
  where m.team_id = v_session.team_id
    and m.profile_id = v_recorder_profile_id
    and m.status = 'active'
  for share;
  if not found then
    raise exception using message = 'forbidden: active recorder Team authority is unavailable';
  end if;
  if not exists (
    select 1 from public.team_exercise_session_participants p
    where p.session_id = p_session_id
      and p.profile_id = p_athlete_profile_id
      and p.participation = 'training-athlete'
  ) then
    return ('blocked', v_hash, 'athlete_not_session_participant')::public.team_exercise_bundle_mutation_result;
  end if;
  if exists (
    select 1 from unnest(p_execution_ids) input_execution_id(value)
    where not exists (
      select 1 from public.team_exercise_execution_refs e
      where e.session_id = p_session_id and e.execution_id = input_execution_id.value
    )
  ) then
    return ('blocked', v_hash, 'execution_not_in_session')::public.team_exercise_bundle_mutation_result;
  end if;
  if not private.team_exercise_profile_is_free_athlete(p_athlete_profile_id) then
    return ('blocked', v_hash, 'athlete_ineligible')::public.team_exercise_bundle_mutation_result;
  end if;

  -- Grant/revoke and first acceptance of a bundle share one per-athlete lock. A
  -- concurrent revocation therefore linearises entirely before or after acceptance;
  -- the result never depends on an unprotected stale permission read.
  perform pg_advisory_xact_lock(hashtext(
    'team_exercise_permission:' || v_session.team_id::text || ':' || p_athlete_profile_id::text
  ));
  select exists (
    select 1 from public.team_exercise_session_approvals a
    where a.session_id = p_session_id and a.athlete_profile_id = p_athlete_profile_id
  ) into v_approved;
  if not v_approved and not private.team_exercise_has_active_membership(v_session.team_id, p_athlete_profile_id) then
    return ('blocked', v_hash, 'athlete_membership_inactive')::public.team_exercise_bundle_mutation_result;
  end if;
  if not v_approved then
    -- Serialize against a concurrent Team removal. If this row remains active after
    -- the lock is obtained, this bundle linearises before any later removal.
    perform 1 from public.team_memberships m
    where m.team_id = v_session.team_id
      and m.profile_id = p_athlete_profile_id
      and m.status = 'active'
    for share;
    if not found then
      return ('blocked', v_hash, 'athlete_membership_inactive')::public.team_exercise_bundle_mutation_result;
    end if;
  end if;
  if not v_approved and not private.team_exercise_has_current_permission(v_session.team_id, p_athlete_profile_id) then
    return ('blocked', v_hash, 'recording_permission_missing')::public.team_exercise_bundle_mutation_result;
  end if;

  insert into public.team_exercise_result_bundles(
    id, session_id, athlete_profile_id, recorded_by_profile_id, schema_version,
    result_payload, content_sha256, recorded_at
  ) values (
    p_bundle_id, p_session_id, p_athlete_profile_id, v_recorder_profile_id, p_schema_version,
    p_result_payload, v_hash, p_recorded_at
  );

  insert into public.team_exercise_result_refs(bundle_id, result_id, athlete_profile_id, execution_id)
  select p_bundle_id, p_result_ids[i], p_athlete_profile_id, p_execution_ids[i]
  from generate_subscripts(p_result_ids, 1) i;

  return ('inserted', v_hash, null)::public.team_exercise_bundle_mutation_result;
end;
$$;

create function public.approve_my_team_exercise_session(p_session_id uuid)
returns public.team_exercise_permission_mutation_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := private.require_free_sporting_profile();
  v_approved_at timestamptz;
begin
  if p_session_id is null then
    raise exception using message = 'invalid_input: invalid Team Exercise Session approval';
  end if;
  if not exists (
    select 1 from public.team_exercise_session_participants p
    where p.session_id = p_session_id
      and p.profile_id = v_profile_id
      and p.participation = 'training-athlete'
  ) then
    raise exception using message = 'forbidden: only an affected Session athlete may approve';
  end if;

  perform pg_advisory_xact_lock(hashtext(
    'team_exercise_session_athlete:' || p_session_id::text || ':' || v_profile_id::text
  ));
  insert into public.team_exercise_session_approvals(session_id, athlete_profile_id)
  values (p_session_id, v_profile_id)
  on conflict (session_id, athlete_profile_id) do nothing
  returning approved_at into v_approved_at;

  if v_approved_at is null then
    select approved_at into v_approved_at
    from public.team_exercise_session_approvals
    where session_id = p_session_id and athlete_profile_id = v_profile_id;
    return ('already_approved', v_approved_at)::public.team_exercise_permission_mutation_result;
  end if;
  return ('approved', v_approved_at)::public.team_exercise_permission_mutation_result;
end;
$$;

create function public.set_my_team_exercise_private_note(p_result_id uuid, p_note text)
returns public.team_exercise_note_mutation_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := private.require_free_sporting_profile();
  v_updated_at timestamptz := clock_timestamp();
  v_existing boolean;
begin
  if p_result_id is null or (p_note is not null and octet_length(p_note) > 65536) then
    raise exception using message = 'invalid_input: invalid private Athlete Note';
  end if;
  if not exists (
    select 1
    from public.team_exercise_result_refs r
    join public.team_exercise_result_bundles b on b.id = r.bundle_id
    where r.result_id = p_result_id and b.athlete_profile_id = v_profile_id
  ) then
    raise exception using message = 'forbidden: private Athlete Note ownership mismatch';
  end if;

  select exists (
    select 1 from public.team_exercise_private_notes n where n.result_id = p_result_id
  ) into v_existing;

  if p_note is null or length(btrim(p_note)) = 0 then
    delete from public.team_exercise_private_notes n
    where n.result_id = p_result_id and n.athlete_profile_id = v_profile_id;
    return (
      case when v_existing then 'cleared' else 'already_clear' end,
      v_updated_at
    )::public.team_exercise_note_mutation_result;
  end if;

  insert into public.team_exercise_private_notes(result_id, athlete_profile_id, note, updated_at)
  values (p_result_id, v_profile_id, p_note, v_updated_at)
  on conflict (result_id) do update
    set note = excluded.note, updated_at = excluded.updated_at
    where public.team_exercise_private_notes.athlete_profile_id = v_profile_id;

  return (
    case when v_existing then 'updated' else 'created' end,
    v_updated_at
  )::public.team_exercise_note_mutation_result;
end;
$$;

revoke all on function private.team_exercise_profile_is_free_athlete(uuid) from public;
revoke all on function private.team_exercise_has_active_membership(uuid, uuid) from public;
revoke all on function private.team_exercise_membership_covers(uuid, uuid, timestamptz) from public;
revoke all on function private.team_exercise_has_current_permission(uuid, uuid) from public;
revoke all on function private.team_exercise_session_manifest_matches(uuid, uuid[], uuid[], uuid[]) from public;
revoke all on function private.team_exercise_bundle_manifest_matches(uuid, uuid[], uuid[]) from public;
revoke all on function public.set_my_team_exercise_recording_permission(uuid, boolean) from public;
revoke all on function public.put_team_exercise_session(uuid, uuid, integer, text, timestamptz, timestamptz, uuid[], uuid[], uuid[]) from public;
revoke all on function public.put_team_exercise_result_bundle(uuid, uuid, uuid, integer, text, timestamptz, uuid[], uuid[]) from public;
revoke all on function public.approve_my_team_exercise_session(uuid) from public;
revoke all on function public.set_my_team_exercise_private_note(uuid, text) from public;

grant execute on function public.set_my_team_exercise_recording_permission(uuid, boolean) to authenticated;
grant execute on function public.put_team_exercise_session(uuid, uuid, integer, text, timestamptz, timestamptz, uuid[], uuid[], uuid[]) to authenticated;
grant execute on function public.put_team_exercise_result_bundle(uuid, uuid, uuid, integer, text, timestamptz, uuid[], uuid[]) to authenticated;
grant execute on function public.approve_my_team_exercise_session(uuid) to authenticated;
grant execute on function public.set_my_team_exercise_private_note(uuid, text) to authenticated;
