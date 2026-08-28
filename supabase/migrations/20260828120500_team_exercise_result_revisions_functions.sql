-- Exercise Stage C4a — server-authoritative post-completion correction/void RPCs.

create type public.team_exercise_result_revision_mutation_result as (
  outcome text,
  revision_id uuid,
  revision_number integer,
  changed_at timestamptz
);

create function private.emit_team_exercise_result_change_notifications(
  p_revision_id uuid,
  p_result_id uuid,
  p_actor_profile_id uuid,
  p_kind text,
  p_reason text,
  p_changed_fields text[]
)
returns integer
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_count integer;
begin
  insert into public.account_notifications(profile_id, kind, payload, source_event_id)
  select
    participant.profile_id,
    'team_exercise_result_changed',
    jsonb_build_object(
      'sessionId', session.id,
      'actorProfileId', p_actor_profile_id,
      'actorDisplayName', actor.display_name,
      'changeKind', p_kind,
      'changedFieldCount', cardinality(p_changed_fields),
      'reason', p_reason
    ),
    p_revision_id
  from public.team_exercise_result_refs result_ref
  join public.team_exercise_result_bundles bundle on bundle.id = result_ref.bundle_id
  join public.team_exercise_sessions session on session.id = bundle.session_id
  join public.teams team on team.id = session.team_id and team.status = 'active'
  join public.profiles actor on actor.id = p_actor_profile_id
  join public.team_exercise_session_participants participant on participant.session_id = session.id
  where result_ref.result_id = p_result_id
    and participant.profile_id <> p_actor_profile_id
    and private.team_exercise_has_active_membership(session.team_id, participant.profile_id)
    and private.team_exercise_profile_is_free_athlete(participant.profile_id)
  on conflict (profile_id, source_event_id) do nothing;

  get diagnostics v_count = row_count;
  return v_count;
end;
$$;

create function public.revise_my_team_exercise_result(
  p_revision_id uuid,
  p_result_id uuid,
  p_base_revision_number integer,
  p_schema_version integer,
  p_result_payload text,
  p_reason text,
  p_changed_fields text[]
)
returns public.team_exercise_result_revision_mutation_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := private.require_free_sporting_profile();
  v_existing public.team_exercise_result_revisions%rowtype;
  v_latest public.team_exercise_result_revisions%rowtype;
  v_hash text;
  v_changed_at timestamptz := clock_timestamp();
  v_next_revision integer;
  v_team_id uuid;
begin
  if p_revision_id is null or p_result_id is null
     or p_base_revision_number is null or p_base_revision_number < 0
     or p_schema_version is null or p_schema_version <= 0
     or p_result_payload is null or octet_length(p_result_payload) = 0
     or octet_length(p_result_payload) > 8388608
     or p_reason is null or char_length(btrim(p_reason)) < 10
     or char_length(btrim(p_reason)) > 500 or octet_length(p_reason) > 2000
     or p_changed_fields is null or cardinality(p_changed_fields) = 0
     or array_position(p_changed_fields, null) is not null
     or cardinality(p_changed_fields) <> cardinality(array(select distinct x from unnest(p_changed_fields) x))
     or not (p_changed_fields <@ array[
       'actualHandle', 'evaluation', 'measurements', 'teamRoleContextOverride'
     ]::text[]) then
    raise exception using message = 'invalid_input: invalid post-completion result revision';
  end if;

  perform pg_advisory_xact_lock(hashtext('team_exercise_revision:' || p_revision_id::text));
  perform pg_advisory_xact_lock(hashtext('team_exercise_result:' || p_result_id::text));
  v_hash := private.sporting_payload_sha256(p_result_payload);

  select * into v_existing
  from public.team_exercise_result_revisions revision where revision.id = p_revision_id;
  if v_existing.id is not null then
    if v_existing.result_id = p_result_id
       and v_existing.athlete_profile_id = v_profile_id
       and v_existing.kind = 'corrected'
       and v_existing.schema_version = p_schema_version
       and v_existing.result_payload = p_result_payload
       and v_existing.content_sha256 = v_hash
       and v_existing.reason = btrim(p_reason)
       and v_existing.changed_fields = p_changed_fields then
      return ('already_present', v_existing.id, v_existing.revision_number, v_existing.created_at)
        ::public.team_exercise_result_revision_mutation_result;
    end if;
    return ('conflict', p_revision_id, null, null)
      ::public.team_exercise_result_revision_mutation_result;
  end if;

  select session.team_id into v_team_id
  from public.team_exercise_result_refs result_ref
  join public.team_exercise_result_bundles bundle on bundle.id = result_ref.bundle_id
  join public.team_exercise_sessions session on session.id = bundle.session_id
  where result_ref.result_id = p_result_id
    and result_ref.athlete_profile_id = v_profile_id;
  if v_team_id is null then
    raise exception using message = 'forbidden: Team Exercise result ownership mismatch';
  end if;

  select * into v_latest
  from public.team_exercise_result_revisions revision
  where revision.result_id = p_result_id
  order by revision.revision_number desc limit 1;
  if v_latest.kind = 'voided' then
    return ('result_voided', null, v_latest.revision_number, v_latest.created_at)
      ::public.team_exercise_result_revision_mutation_result;
  end if;
  if coalesce(v_latest.revision_number, 0) <> p_base_revision_number then
    return ('conflict', null, coalesce(v_latest.revision_number, 0), v_latest.created_at)
      ::public.team_exercise_result_revision_mutation_result;
  end if;
  v_next_revision := p_base_revision_number + 1;

  insert into public.team_exercise_result_revisions(
    id, result_id, athlete_profile_id, revision_number, kind, schema_version,
    result_payload, content_sha256, changed_fields, reason, actor_profile_id, created_at
  ) values (
    p_revision_id, p_result_id, v_profile_id, v_next_revision, 'corrected', p_schema_version,
    p_result_payload, v_hash, p_changed_fields, btrim(p_reason), v_profile_id, v_changed_at
  );

  perform private.emit_team_exercise_result_change_notifications(
    p_revision_id, p_result_id, v_profile_id, 'corrected', btrim(p_reason), p_changed_fields
  );
  perform private.audit(
    v_team_id, v_profile_id, 'team_exercise_result_corrected',
    jsonb_build_object('resultId', p_result_id, 'revisionId', p_revision_id, 'revisionNumber', v_next_revision)
  );
  return ('inserted', p_revision_id, v_next_revision, v_changed_at)
    ::public.team_exercise_result_revision_mutation_result;
end;
$$;

create function public.void_my_team_exercise_result(
  p_revision_id uuid,
  p_result_id uuid,
  p_base_revision_number integer,
  p_reason text
)
returns public.team_exercise_result_revision_mutation_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := private.require_free_sporting_profile();
  v_existing public.team_exercise_result_revisions%rowtype;
  v_latest public.team_exercise_result_revisions%rowtype;
  v_changed_at timestamptz := clock_timestamp();
  v_next_revision integer;
  v_team_id uuid;
begin
  if p_revision_id is null or p_result_id is null
     or p_base_revision_number is null or p_base_revision_number < 0
     or p_reason is null or char_length(btrim(p_reason)) < 10
     or char_length(btrim(p_reason)) > 500 or octet_length(p_reason) > 2000 then
    raise exception using message = 'invalid_input: invalid post-completion result void';
  end if;

  perform pg_advisory_xact_lock(hashtext('team_exercise_revision:' || p_revision_id::text));
  perform pg_advisory_xact_lock(hashtext('team_exercise_result:' || p_result_id::text));
  select * into v_existing
  from public.team_exercise_result_revisions revision where revision.id = p_revision_id;
  if v_existing.id is not null then
    if v_existing.result_id = p_result_id
       and v_existing.athlete_profile_id = v_profile_id
       and v_existing.kind = 'voided'
       and v_existing.reason = btrim(p_reason) then
      return ('already_present', v_existing.id, v_existing.revision_number, v_existing.created_at)
        ::public.team_exercise_result_revision_mutation_result;
    end if;
    return ('conflict', p_revision_id, null, null)
      ::public.team_exercise_result_revision_mutation_result;
  end if;

  select session.team_id into v_team_id
  from public.team_exercise_result_refs result_ref
  join public.team_exercise_result_bundles bundle on bundle.id = result_ref.bundle_id
  join public.team_exercise_sessions session on session.id = bundle.session_id
  where result_ref.result_id = p_result_id
    and result_ref.athlete_profile_id = v_profile_id;
  if v_team_id is null then
    raise exception using message = 'forbidden: Team Exercise result ownership mismatch';
  end if;

  select * into v_latest
  from public.team_exercise_result_revisions revision
  where revision.result_id = p_result_id
  order by revision.revision_number desc limit 1;
  if v_latest.kind = 'voided' then
    return ('result_voided', null, v_latest.revision_number, v_latest.created_at)
      ::public.team_exercise_result_revision_mutation_result;
  end if;
  if coalesce(v_latest.revision_number, 0) <> p_base_revision_number then
    return ('conflict', null, coalesce(v_latest.revision_number, 0), v_latest.created_at)
      ::public.team_exercise_result_revision_mutation_result;
  end if;
  v_next_revision := p_base_revision_number + 1;

  insert into public.team_exercise_result_revisions(
    id, result_id, athlete_profile_id, revision_number, kind, schema_version,
    result_payload, content_sha256, changed_fields, reason, actor_profile_id, created_at
  ) values (
    p_revision_id, p_result_id, v_profile_id, v_next_revision, 'voided', 1,
    null, null, array['result']::text[], btrim(p_reason), v_profile_id, v_changed_at
  );

  perform private.emit_team_exercise_result_change_notifications(
    p_revision_id, p_result_id, v_profile_id, 'voided', btrim(p_reason), array['result']::text[]
  );
  perform private.audit(
    v_team_id, v_profile_id, 'team_exercise_result_voided',
    jsonb_build_object('resultId', p_result_id, 'revisionId', p_revision_id, 'revisionNumber', v_next_revision)
  );
  return ('inserted', p_revision_id, v_next_revision, v_changed_at)
    ::public.team_exercise_result_revision_mutation_result;
end;
$$;

create function private.prevent_team_exercise_result_revision_mutation()
returns trigger
language plpgsql
security definer
set search_path = ''
as $$
begin
  raise exception using message = 'team_exercise_result_revisions are append-only';
end;
$$;

create trigger team_exercise_result_revisions_append_only
before update or delete on public.team_exercise_result_revisions
for each row execute function private.prevent_team_exercise_result_revision_mutation();

revoke all on function private.emit_team_exercise_result_change_notifications(uuid, uuid, uuid, text, text, text[]) from public;
revoke all on function private.prevent_team_exercise_result_revision_mutation() from public;
revoke all on function public.revise_my_team_exercise_result(uuid, uuid, integer, integer, text, text, text[]) from public;
revoke all on function public.void_my_team_exercise_result(uuid, uuid, integer, text) from public;

grant execute on function public.revise_my_team_exercise_result(uuid, uuid, integer, integer, text, text, text[]) to authenticated;
grant execute on function public.void_my_team_exercise_result(uuid, uuid, integer, text) to authenticated;
