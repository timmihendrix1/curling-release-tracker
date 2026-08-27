-- Stage B0.4 — authority-checked idempotent upload, tombstoning and restore.

create type public.sporting_record_mutation_result as (
  outcome text,
  content_sha256 text
);

create function private.require_free_sporting_profile()
returns uuid
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := private.current_profile_id();
begin
  if v_profile_id is null
     or not exists (select 1 from public.profile_onboarding o where o.profile_id = v_profile_id)
     or not exists (select 1 from public.athletes a where a.profile_id = v_profile_id)
     or not exists (
       select 1 from public.profile_entitlements e
       where e.profile_id = v_profile_id and e.tier = 'free' and e.revoked_at is null
     ) then
    raise exception using message = 'forbidden: sporting cloud access is unavailable';
  end if;
  return v_profile_id;
end;
$$;

create function private.sporting_payload_sha256(p_payload text)
returns text
language sql
immutable
security invoker
set search_path = ''
as $$
  select encode(extensions.digest(convert_to(p_payload, 'UTF8'), 'sha256'), 'hex');
$$;

create function public.put_my_sporting_record(
  p_record_kind text,
  p_record_id uuid,
  p_schema_version integer,
  p_payload text,
  p_recorded_at timestamptz
)
returns public.sporting_record_mutation_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := private.require_free_sporting_profile();
  v_hash text;
  v_existing public.sporting_records%rowtype;
begin
  if p_record_kind is null or p_record_kind not in ('training_session', 'assessment_run')
     or p_record_id is null or p_schema_version is null or p_schema_version <= 0
     or p_payload is null or octet_length(p_payload) = 0 or octet_length(p_payload) > 8388608
     or p_recorded_at is null then
    raise exception using message = 'invalid_input: invalid sporting record';
  end if;

  v_hash := private.sporting_payload_sha256(p_payload);
  perform pg_advisory_xact_lock(hashtext(v_profile_id::text || ':' || p_record_kind || ':' || p_record_id::text));

  if exists (
    select 1 from public.sporting_record_tombstones t
    where t.profile_id = v_profile_id and t.record_kind = p_record_kind and t.record_id = p_record_id
  ) then
    return ('conflict', v_hash)::public.sporting_record_mutation_result;
  end if;

  select * into v_existing from public.sporting_records r
  where r.profile_id = v_profile_id and r.record_kind = p_record_kind and r.record_id = p_record_id;

  if found then
    if v_existing.content_sha256 = v_hash
       and v_existing.payload = p_payload
       and v_existing.schema_version = p_schema_version then
      return ('already_present', v_hash)::public.sporting_record_mutation_result;
    end if;
    return ('conflict', v_hash)::public.sporting_record_mutation_result;
  end if;

  insert into public.sporting_records
    (profile_id, record_kind, record_id, schema_version, payload, content_sha256, recorded_at)
  values
    (v_profile_id, p_record_kind, p_record_id, p_schema_version, p_payload, v_hash, p_recorded_at);

  return ('inserted', v_hash)::public.sporting_record_mutation_result;
end;
$$;

create function public.delete_my_sporting_record(
  p_record_kind text,
  p_record_id uuid,
  p_expected_content_sha256 text
)
returns public.sporting_record_mutation_result
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := private.require_free_sporting_profile();
  v_existing_hash text;
  v_deleted_hash text;
begin
  if p_record_kind is null or p_record_kind not in ('training_session', 'assessment_run')
     or p_record_id is null or p_expected_content_sha256 is null
     or p_expected_content_sha256 !~ '^[0-9a-f]{64}$' then
    raise exception using message = 'invalid_input: invalid sporting record deletion';
  end if;

  perform pg_advisory_xact_lock(hashtext(v_profile_id::text || ':' || p_record_kind || ':' || p_record_id::text));

  select t.deleted_content_sha256 into v_deleted_hash
  from public.sporting_record_tombstones t
  where t.profile_id = v_profile_id and t.record_kind = p_record_kind and t.record_id = p_record_id;
  if v_deleted_hash is not null then
    return (
      case when v_deleted_hash = p_expected_content_sha256 then 'already_deleted' else 'conflict' end,
      v_deleted_hash
    )::public.sporting_record_mutation_result;
  end if;

  select r.content_sha256 into v_existing_hash from public.sporting_records r
  where r.profile_id = v_profile_id and r.record_kind = p_record_kind and r.record_id = p_record_id;

  if v_existing_hash is not null and v_existing_hash <> p_expected_content_sha256 then
    return ('conflict', v_existing_hash)::public.sporting_record_mutation_result;
  end if;

  insert into public.sporting_record_tombstones
    (profile_id, record_kind, record_id, deleted_content_sha256)
  values
    (v_profile_id, p_record_kind, p_record_id, p_expected_content_sha256)
  on conflict (profile_id, record_kind, record_id) do nothing;

  -- The tombstone retains only the stable deletion fact and digest. The raw sporting
  -- payload itself is removed in the same transaction and is therefore no longer
  -- retained as hidden personal data after an athlete deletes it.
  delete from public.sporting_records r
  where r.profile_id = v_profile_id
    and r.record_kind = p_record_kind
    and r.record_id = p_record_id;

  return (
    'deleted',
    coalesce(v_existing_hash, p_expected_content_sha256)
  )::public.sporting_record_mutation_result;
end;
$$;

create function public.get_my_sporting_records()
returns table (
  record_kind text,
  record_id uuid,
  schema_version integer,
  payload text,
  content_sha256 text,
  recorded_at timestamptz
)
language plpgsql
security definer
set search_path = ''
as $$
declare
  v_profile_id uuid := private.require_free_sporting_profile();
begin
  return query
  select r.record_kind, r.record_id, r.schema_version, r.payload, r.content_sha256, r.recorded_at
  from public.sporting_records r
  where r.profile_id = v_profile_id
    and not exists (
      select 1 from public.sporting_record_tombstones t
      where t.profile_id = r.profile_id and t.record_kind = r.record_kind and t.record_id = r.record_id
    )
  order by r.recorded_at desc, r.record_id;
end;
$$;

revoke all on function private.require_free_sporting_profile() from public;
revoke all on function private.sporting_payload_sha256(text) from public;
revoke all on function public.put_my_sporting_record(text, uuid, integer, text, timestamptz) from public;
revoke all on function public.delete_my_sporting_record(text, uuid, text) from public;
revoke all on function public.get_my_sporting_records() from public;

grant execute on function public.put_my_sporting_record(text, uuid, integer, text, timestamptz) to authenticated;
grant execute on function public.delete_my_sporting_record(text, uuid, text) to authenticated;
grant execute on function public.get_my_sporting_records() to authenticated;
