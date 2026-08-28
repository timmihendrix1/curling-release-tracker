-- Exercise Stage C4a real-database verification. Run after a clean --no-seed reset.
begin;

create schema tests;
grant usage on schema tests to authenticated, anon;

select plan(48);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000201', 'c4-recorder@example.com'),
  ('00000000-0000-0000-0000-000000000202', 'c4-athlete@example.com'),
  ('00000000-0000-0000-0000-000000000203', 'c4-participant@example.com'),
  ('00000000-0000-0000-0000-000000000204', 'c4-former@example.com'),
  ('00000000-0000-0000-0000-000000000205', 'c4-nonparticipant@example.com');

insert into public.legal_documents (kind, version_label, document_url, effective_at) values
  ('terms_of_service', 'c4-terms-v1', 'https://example.invalid/c4-terms-v1', now()),
  ('privacy_notice', 'c4-privacy-v1', 'https://example.invalid/c4-privacy-v1', now());

create function tests.reset_to_owner() returns void as $$ begin reset role; end; $$ language plpgsql;
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
create function tests.onboard(p_name text) returns uuid as $$
declare v_terms uuid; v_privacy uuid; v_profile uuid;
begin
  select (public.ensure_my_profile()).id into strict v_profile;
  select id into strict v_terms from public.get_current_legal_documents() where kind = 'terms_of_service';
  select id into strict v_privacy from public.get_current_legal_documents() where kind = 'privacy_notice';
  perform public.complete_personal_onboarding(p_name, v_terms, v_privacy);
  return v_profile;
end;
$$ language plpgsql security invoker;

select tests.act_as('00000000-0000-0000-0000-000000000201');
select set_config('tests.profile_a', tests.onboard('Recorder A')::text, false);
select tests.reset_to_owner();
insert into public.pilot_team_creation_grants(profile_id) values (current_setting('tests.profile_a')::uuid);
select tests.act_as('00000000-0000-0000-0000-000000000201');
select set_config('tests.team_id', (public.create_team('C4 Test Team', true, '{}'::text[])).id::text, false);

select tests.act_as('00000000-0000-0000-0000-000000000202');
select set_config('tests.profile_b', tests.onboard('Athlete B')::text, false);
select tests.act_as('00000000-0000-0000-0000-000000000203');
select set_config('tests.profile_c', tests.onboard('Participant C')::text, false);
select tests.act_as('00000000-0000-0000-0000-000000000204');
select set_config('tests.profile_d', tests.onboard('Former D')::text, false);
select tests.act_as('00000000-0000-0000-0000-000000000205');
select set_config('tests.profile_e', tests.onboard('Nonparticipant E')::text, false);

select tests.reset_to_owner();
insert into public.team_memberships(team_id, profile_id, participation_as_player) values
  (current_setting('tests.team_id')::uuid, current_setting('tests.profile_b')::uuid, true),
  (current_setting('tests.team_id')::uuid, current_setting('tests.profile_c')::uuid, true),
  (current_setting('tests.team_id')::uuid, current_setting('tests.profile_d')::uuid, true),
  (current_setting('tests.team_id')::uuid, current_setting('tests.profile_e')::uuid, true);

select tests.act_as('00000000-0000-0000-0000-000000000202');
select is(
  (public.set_my_team_exercise_recording_permission(current_setting('tests.team_id')::uuid, true)).outcome,
  'granted', 'affected athlete grants initial recording permission'
);
select tests.act_as('00000000-0000-0000-0000-000000000201');
select is(
  (public.put_team_exercise_session(
    '20000000-0000-4000-8000-000000000201', current_setting('tests.team_id')::uuid, 2,
    '{"coordination":"c4"}', now(), now(),
    array[current_setting('tests.profile_a')::uuid, current_setting('tests.profile_b')::uuid,
          current_setting('tests.profile_c')::uuid, current_setting('tests.profile_d')::uuid],
    array[current_setting('tests.profile_b')::uuid],
    array['21000000-0000-4000-8000-000000000201'::uuid]
  )).outcome,
  'inserted', 'recorder uploads the immutable completed Session'
);
select is(
  (public.put_team_exercise_result_bundle(
    '22000000-0000-4000-8000-000000000201', '20000000-0000-4000-8000-000000000201',
    current_setting('tests.profile_b')::uuid, 2, '{"score":3}', now(),
    array['23000000-0000-4000-8000-000000000201'::uuid],
    array['21000000-0000-4000-8000-000000000201'::uuid]
  )).outcome,
  'inserted', 'original athlete bundle exists before any revision'
);

-- A former participant and a non-participant are both excluded from delivery.
select tests.reset_to_owner();
update public.team_memberships set status = 'ended', ended_at = clock_timestamp(), end_reason = 'left'
where team_id = current_setting('tests.team_id')::uuid
  and profile_id = current_setting('tests.profile_d')::uuid and status = 'active';

select tests.act_as('00000000-0000-0000-0000-000000000202');
select throws_like(
  $$ select public.revise_my_team_exercise_result(
    gen_random_uuid(), '23000000-0000-4000-8000-000000000201', 0, 1, '{}',
    'too short', array['evaluation']::text[]
  ) $$,
  'invalid_input:%', 'a post-completion correction needs a 10-500 character reason'
);
select throws_like(
  $$ select public.revise_my_team_exercise_result(
    gen_random_uuid(), '23000000-0000-4000-8000-000000000201', 0, 1, '{}',
    'Correcting an invalid ownership field', array['athleteProfileId']::text[]
  ) $$,
  'invalid_input:%', 'athlete attribution is not a post-completion correctable field'
);
select is(
  (public.revise_my_team_exercise_result(
    '24000000-0000-4000-8000-000000000201', '23000000-0000-4000-8000-000000000201',
    0, 1, '{"score":4}', 'The recorded score was entered incorrectly',
    array['evaluation']::text[]
  )).outcome,
  'inserted', 'affected athlete appends a correction to their own completed result'
);
select is(
  (select revision_number from public.team_exercise_result_revisions),
  1, 'first accepted correction is revision one'
);
select is(
  (select result_payload from public.team_exercise_result_revisions),
  '{"score":4}', 'corrected payload remains byte-exact TEXT'
);
select is(
  (select actor_profile_id::text from public.team_exercise_result_revisions),
  current_setting('tests.profile_b'), 'authenticated athlete is the server-derived revision actor'
);
select ok(
  not exists (
    select 1 from public.team_exercise_result_revisions revision,
      unnest(revision.changed_fields) changed_field
    where changed_field = 'athleteProfileId'
  ),
  'persisted changed fields cannot claim an athlete reassignment'
);

select tests.reset_to_owner();
select is(
  (select count(*)::int from public.account_notifications where source_event_id = '24000000-0000-4000-8000-000000000201'),
  2, 'one notification is emitted for each other original currently eligible participant'
);
select ok(
  (select array_agg(profile_id order by profile_id) from public.account_notifications
   where source_event_id = '24000000-0000-4000-8000-000000000201') =
  (select array_agg(profile_id order by profile_id) from unnest(array[
    current_setting('tests.profile_a')::uuid, current_setting('tests.profile_c')::uuid
  ]) profile_id),
  'recipients are exactly the current original participants other than the actor'
);
select ok(
  not exists (
    select 1 from public.account_notifications
    where source_event_id = '24000000-0000-4000-8000-000000000201'
      and (payload ? 'before' or payload ? 'after' or payload ? 'resultPayload'
        or payload ? 'resultId' or payload ? 'score')
  ), 'notification payload contains metadata but no performance values'
);
select is(
  (select payload->>'actorDisplayName' from public.account_notifications
   where source_event_id = '24000000-0000-4000-8000-000000000201' limit 1),
  'Athlete B', 'notification identifies the actor through a time-of-change display-name snapshot'
);
select is(
  (select count(*)::int from public.account_notifications
   where source_event_id = '24000000-0000-4000-8000-000000000201'
     and profile_id = current_setting('tests.profile_b')::uuid),
  0, 'the athlete who made the change is not notified'
);
select is(
  (select count(*)::int from public.account_notifications
   where source_event_id = '24000000-0000-4000-8000-000000000201'
     and profile_id in (current_setting('tests.profile_d')::uuid, current_setting('tests.profile_e')::uuid)),
  0, 'former participants and non-participants receive no notification'
);
select is(
  (select count(*)::int from public.team_audit_events where event_type = 'team_exercise_result_corrected'),
  1, 'accepted correction emits exactly one Team audit event'
);

select tests.act_as('00000000-0000-0000-0000-000000000202');
select is(
  (public.revise_my_team_exercise_result(
    '24000000-0000-4000-8000-000000000201', '23000000-0000-4000-8000-000000000201',
    0, 1, '{"score":4}', 'The recorded score was entered incorrectly',
    array['evaluation']::text[]
  )).outcome,
  'already_present', 'lost-acknowledgement correction retry is idempotent'
);
select is(
  (public.revise_my_team_exercise_result(
    '24000000-0000-4000-8000-000000000201', '23000000-0000-4000-8000-000000000201',
    0, 1, '{"score":2}', 'The recorded score was entered incorrectly',
    array['evaluation']::text[]
  )).outcome,
  'conflict', 'same revision id with changed content is a conflict'
);
select is(
  (public.revise_my_team_exercise_result(
    '24000000-0000-4000-8000-000000000202', '23000000-0000-4000-8000-000000000201',
    0, 1, '{"score":2}', 'A stale device attempted another correction',
    array['evaluation']::text[]
  )).outcome,
  'conflict', 'stale base revision cannot overwrite the current result'
);
select tests.reset_to_owner();
select is((select count(*)::int from public.team_exercise_result_revisions), 1, 'retry and conflicts append no revision');
select is((select count(*)::int from public.account_notifications where source_event_id is not null), 2, 'retry and conflicts duplicate no notification');
select is((select count(*)::int from public.team_audit_events where event_type = 'team_exercise_result_corrected'), 1, 'retry and conflicts duplicate no audit event');

select tests.act_as('00000000-0000-0000-0000-000000000203');
select throws_like(
  $$ select public.revise_my_team_exercise_result(
    gen_random_uuid(), '23000000-0000-4000-8000-000000000201', 1, 1, '{}',
    'Another participant must not edit this result', array['evaluation']::text[]
  ) $$,
  'forbidden:%', 'another Session participant cannot revise the athlete result'
);
select is((select count(*)::int from public.team_exercise_result_revisions), 0, 'revision RLS exposes no other athlete history');

select tests.act_as('00000000-0000-0000-0000-000000000202');
select is((select count(*)::int from public.team_exercise_result_revisions), 1, 'affected athlete reads their own revision history');

-- Current entitlement is evaluated separately for every event. C loses entitlement
-- before the void, so only A receives the second notification.
select tests.reset_to_owner();
update public.profile_entitlements set revoked_at = clock_timestamp()
where profile_id = current_setting('tests.profile_c')::uuid and tier = 'free' and revoked_at is null;
select tests.act_as('00000000-0000-0000-0000-000000000202');
select is(
  (public.void_my_team_exercise_result(
    '24000000-0000-4000-8000-000000000203', '23000000-0000-4000-8000-000000000201',
    1, 'This complete result should not count in analysis'
  )).outcome,
  'inserted', 'athlete may void their complete own result'
);
select is(
  (select revision_number from public.team_exercise_result_revisions where kind = 'voided'),
  2, 'void follows the correction as revision two'
);
select ok(
  (select result_payload is null and content_sha256 is null and changed_fields = array['result']::text[]
   from public.team_exercise_result_revisions where kind = 'voided'),
  'void stores no replacement performance payload and targets the whole result'
);
select tests.reset_to_owner();
select is(
  (select count(*)::int from public.account_notifications where source_event_id = '24000000-0000-4000-8000-000000000203'),
  1, 'a participant without current entitlement receives no later void notification'
);
select is(
  (select count(*)::int from public.team_audit_events where event_type = 'team_exercise_result_voided'),
  1, 'accepted void emits exactly one Team audit event'
);

select tests.act_as('00000000-0000-0000-0000-000000000202');
select is(
  (public.void_my_team_exercise_result(
    '24000000-0000-4000-8000-000000000203', '23000000-0000-4000-8000-000000000201',
    1, 'This complete result should not count in analysis'
  )).outcome,
  'already_present', 'lost-acknowledgement void retry is idempotent'
);
select is(
  (public.revise_my_team_exercise_result(
    '24000000-0000-4000-8000-000000000204', '23000000-0000-4000-8000-000000000201',
    2, 1, '{"score":1}', 'A voided result cannot be edited back into use',
    array['evaluation']::text[]
  )).outcome,
  'result_voided', 'a whole-result void is terminal in Version 1'
);
select is(
  (public.void_my_team_exercise_result(
    '24000000-0000-4000-8000-000000000205', '23000000-0000-4000-8000-000000000201',
    2, 'A second void must not create another event'
  )).outcome,
  'result_voided', 'a new void id cannot duplicate a terminal void'
);
select tests.reset_to_owner();
select is((select count(*)::int from public.team_exercise_result_revisions), 2, 'terminal retries append no further revision');
select is((select count(*)::int from public.account_notifications where source_event_id is not null), 3, 'all accepted changes emitted exactly three recipient notifications');

-- RPC-only write, append-only defence, anonymous denial and structural ACLs.
select tests.act_as('00000000-0000-0000-0000-000000000202');
select throws_like(
  $$ update public.team_exercise_result_revisions set reason = 'A forbidden direct overwrite attempt' $$,
  'permission denied%', 'authenticated athlete cannot update revisions directly'
);
select tests.reset_to_owner();
select throws_like(
  $$ delete from public.team_exercise_result_revisions where id = '24000000-0000-4000-8000-000000000201' $$,
  'team_exercise_result_revisions are append-only', 'append-only trigger also blocks privileged deletion'
);
select tests.act_as_anon();
select throws_like(
  $$ select public.void_my_team_exercise_result(gen_random_uuid(), gen_random_uuid(), 0, 'Anonymous callers cannot void a result') $$,
  'permission denied%', 'anonymous caller cannot execute the void RPC'
);
select tests.reset_to_owner();
select ok(
  (select relrowsecurity from pg_class where oid = 'public.team_exercise_result_revisions'::regclass),
  'RLS is enabled on the revision table'
);
select is(
  (select count(*)::int from pg_policies where schemaname = 'public'
   and tablename = 'team_exercise_result_revisions' and cmd <> 'SELECT'),
  0, 'revision table has no browser write policy'
);
select ok(
  not has_table_privilege('authenticated', 'public.team_exercise_result_revisions', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('anon', 'public.team_exercise_result_revisions', 'SELECT,INSERT,UPDATE,DELETE'),
  'authenticated and anonymous roles have no direct revision mutation authority'
);
select ok(
  has_function_privilege('authenticated', 'public.revise_my_team_exercise_result(uuid,uuid,integer,integer,text,text,text[])', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.void_my_team_exercise_result(uuid,uuid,integer,text)', 'EXECUTE')
  and not has_function_privilege('anon', 'public.revise_my_team_exercise_result(uuid,uuid,integer,integer,text,text,text[])', 'EXECUTE')
  and not has_function_privilege('anon', 'public.void_my_team_exercise_result(uuid,uuid,integer,text)', 'EXECUTE'),
  'only authenticated may execute the two C4a mutation RPCs'
);
select is(
  (select count(*)::int from unnest(array[
    'emit_team_exercise_result_change_notifications(uuid,uuid,uuid,text,text,text[])',
    'prevent_team_exercise_result_revision_mutation()'
  ]) signature where has_function_privilege('authenticated', 'private.' || signature, 'EXECUTE')),
  0, 'authenticated cannot execute private C4a helpers'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where p.proname in (
     'emit_team_exercise_result_change_notifications',
     'prevent_team_exercise_result_revision_mutation',
     'revise_my_team_exercise_result',
     'void_my_team_exercise_result'
   ) and not exists (
     select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) setting
     where setting in ('search_path=', 'search_path=""')
   )),
  0, 'every C4a function pins an empty search_path'
);
select ok(
  (select position('team_exercise_revision:' in pg_get_functiondef(p.oid)) > 0
          and position('team_exercise_result:' in pg_get_functiondef(p.oid))
              > position('team_exercise_revision:' in pg_get_functiondef(p.oid))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'revise_my_team_exercise_result'),
  'correction RPC locks the stable revision id before the result stream'
);
select ok(
  (select position('team_exercise_revision:' in pg_get_functiondef(p.oid)) > 0
          and position('team_exercise_result:' in pg_get_functiondef(p.oid))
              > position('team_exercise_revision:' in pg_get_functiondef(p.oid))
   from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public' and p.proname = 'void_my_team_exercise_result'),
  'void RPC locks the stable revision id before the result stream'
);
select ok(
  exists (
    select 1 from pg_constraint
    where conrelid = 'public.account_notifications'::regclass
      and conname = 'account_notifications_kind_check'
      and pg_get_constraintdef(oid) like '%team_exercise_result_changed%'
  ), 'existing account notification inbox admits the result-change kind'
);

select * from finish();
rollback;
