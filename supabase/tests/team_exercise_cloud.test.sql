-- Exercise Stage C2a real-database verification. Run after a clean --no-seed reset.
begin;

create schema tests;
grant usage on schema tests to authenticated, anon;

select plan(68);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000101', 'recorder@example.com'),
  ('00000000-0000-0000-0000-000000000102', 'athlete-b@example.com'),
  ('00000000-0000-0000-0000-000000000103', 'athlete-c@example.com'),
  ('00000000-0000-0000-0000-000000000104', 'athlete-d@example.com'),
  ('00000000-0000-0000-0000-000000000105', 'outsider@example.com');

insert into public.legal_documents (kind, version_label, document_url, effective_at) values
  ('terms_of_service', 'team-exercise-terms-v1', 'https://example.invalid/team-exercise-terms-v1', now()),
  ('privacy_notice', 'team-exercise-privacy-v1', 'https://example.invalid/team-exercise-privacy-v1', now());

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

select tests.act_as('00000000-0000-0000-0000-000000000101');
select set_config('tests.profile_a', tests.onboard('Recorder A')::text, false);
select tests.reset_to_owner();
insert into public.pilot_team_creation_grants(profile_id)
values (current_setting('tests.profile_a')::uuid);
select tests.act_as('00000000-0000-0000-0000-000000000101');
select set_config(
  'tests.team_id',
  (public.create_team('C2 Test Team', true, '{}'::text[])).id::text,
  false
);

select tests.act_as('00000000-0000-0000-0000-000000000102');
select set_config('tests.profile_b', tests.onboard('Athlete B')::text, false);
select tests.act_as('00000000-0000-0000-0000-000000000103');
select set_config('tests.profile_c', tests.onboard('Athlete C')::text, false);
select tests.act_as('00000000-0000-0000-0000-000000000104');
select set_config('tests.profile_d', tests.onboard('Athlete D')::text, false);
select tests.act_as('00000000-0000-0000-0000-000000000105');
select set_config('tests.profile_e', tests.onboard('Outsider E')::text, false);

select tests.reset_to_owner();
insert into public.team_memberships(team_id, profile_id, participation_as_player) values
  (current_setting('tests.team_id')::uuid, current_setting('tests.profile_b')::uuid, true),
  (current_setting('tests.team_id')::uuid, current_setting('tests.profile_c')::uuid, true),
  (current_setting('tests.team_id')::uuid, current_setting('tests.profile_d')::uuid, true);

-- Prospective recording permission is athlete-owned, Team-scoped and idempotent.
select tests.act_as('00000000-0000-0000-0000-000000000102');
select is(
  (public.set_my_team_exercise_recording_permission(current_setting('tests.team_id')::uuid, true)).outcome,
  'granted', 'an active athlete grants prospective Team recording permission'
);
select is(
  (public.set_my_team_exercise_recording_permission(current_setting('tests.team_id')::uuid, true)).outcome,
  'already_granted', 'repeated grant is idempotent'
);
select is((select count(*)::int from public.team_exercise_recording_permissions), 1, 'athlete sees own active permission');
select is(
  (public.set_my_team_exercise_recording_permission(current_setting('tests.team_id')::uuid, false)).outcome,
  'revoked', 'athlete can prospectively revoke recording permission'
);
select is(
  (public.set_my_team_exercise_recording_permission(current_setting('tests.team_id')::uuid, false)).outcome,
  'already_revoked', 'repeated revocation is idempotent'
);
select is(
  (public.set_my_team_exercise_recording_permission(current_setting('tests.team_id')::uuid, true)).outcome,
  'granted', 'a later explicit grant creates a new active permission period'
);
select is((select count(*)::int from public.team_exercise_recording_permissions), 2, 'own RLS view preserves permission history');

select tests.act_as('00000000-0000-0000-0000-000000000105');
select throws_like(
  $$ select public.set_my_team_exercise_recording_permission(current_setting('tests.team_id')::uuid, true) $$,
  'forbidden:%', 'a non-member cannot grant a permission to that Team'
);

-- Recorder uploads one immutable completed coordination envelope. No recorder id is
-- accepted as input; the stored actor is derived from the authenticated account.
select tests.act_as('00000000-0000-0000-0000-000000000101');
select is(
  (public.put_team_exercise_session(
    '20000000-0000-4000-8000-000000000001', current_setting('tests.team_id')::uuid, 1,
    $json${"coord":"\u0000\ud800"}$json$, now(), now(),
    array[current_setting('tests.profile_a')::uuid, current_setting('tests.profile_b')::uuid,
          current_setting('tests.profile_c')::uuid, current_setting('tests.profile_d')::uuid],
    array[current_setting('tests.profile_b')::uuid, current_setting('tests.profile_c')::uuid,
          current_setting('tests.profile_d')::uuid],
    array['21000000-0000-4000-8000-000000000001'::uuid]
  )).outcome,
  'inserted', 'recorder uploads a completed Team Session envelope'
);
select tests.reset_to_owner();
select is(
  (select recorded_by_profile_id::text from public.team_exercise_sessions where id = '20000000-0000-4000-8000-000000000001'),
  current_setting('tests.profile_a'), 'server-derived recorder Profile is authoritative'
);
select is(
  (select coordination_payload from public.team_exercise_sessions where id = '20000000-0000-4000-8000-000000000001'),
  $json${"coord":"\u0000\ud800"}$json$, 'coordination TEXT is preserved byte-for-byte'
);
select tests.act_as('00000000-0000-0000-0000-000000000101');
select is(
  (public.put_team_exercise_session(
    '20000000-0000-4000-8000-000000000001', current_setting('tests.team_id')::uuid, 1,
    $json${"coord":"\u0000\ud800"}$json$, now(), now(),
    array[current_setting('tests.profile_a')::uuid, current_setting('tests.profile_b')::uuid,
          current_setting('tests.profile_c')::uuid, current_setting('tests.profile_d')::uuid],
    array[current_setting('tests.profile_b')::uuid, current_setting('tests.profile_c')::uuid,
          current_setting('tests.profile_d')::uuid],
    array['21000000-0000-4000-8000-000000000001'::uuid]
  )).outcome,
  'already_present', 'lost acknowledgement retry converges on the existing envelope'
);
select is(
  (public.put_team_exercise_session(
    '20000000-0000-4000-8000-000000000001', current_setting('tests.team_id')::uuid, 1,
    '{"changed":true}', now(), now(),
    array[current_setting('tests.profile_a')::uuid, current_setting('tests.profile_b')::uuid,
          current_setting('tests.profile_c')::uuid, current_setting('tests.profile_d')::uuid],
    array[current_setting('tests.profile_b')::uuid, current_setting('tests.profile_c')::uuid,
          current_setting('tests.profile_d')::uuid],
    array['21000000-0000-4000-8000-000000000001'::uuid]
  )).outcome,
  'conflict', 'same Session id with different content is never overwritten'
);
select is(
  (public.put_team_exercise_session(
    '20000000-0000-4000-8000-000000000001', current_setting('tests.team_id')::uuid, 1,
    $json${"coord":"\u0000\ud800"}$json$, now(), now(),
    array[current_setting('tests.profile_a')::uuid, current_setting('tests.profile_b')::uuid,
          current_setting('tests.profile_c')::uuid],
    array[current_setting('tests.profile_b')::uuid, current_setting('tests.profile_c')::uuid],
    array['21000000-0000-4000-8000-000000000001'::uuid]
  )).outcome,
  'conflict', 'same Session payload with a changed roster manifest is a conflict'
);
select is((select count(*)::int from public.team_exercise_sessions), 0, 'recorder participation alone grants no post-upload envelope read');

select tests.reset_to_owner();
select is((select count(*)::int from public.team_exercise_sessions), 1, 'exactly one envelope exists physically');
select is((select count(*)::int from public.team_exercise_session_participants), 4, 'confirmed participant snapshot is relational');
select is((select count(*)::int from public.team_exercise_execution_refs), 1, 'execution stable id is retained');
select is(
  (select count(*)::int from public.team_audit_events
   where event_type = 'team_exercise_session_uploaded' and payload->>'sessionId' = '20000000-0000-4000-8000-000000000001'),
  1, 'idempotent envelope upload emits one audit event'
);

-- One invalid participant makes the shared envelope invalid rather than silently
-- rewriting its roster.
select tests.act_as('00000000-0000-0000-0000-000000000101');
select throws_like(
  $$ select public.put_team_exercise_session(
    '20000000-0000-4000-8000-000000000099', current_setting('tests.team_id')::uuid, 1,
    '{}', now(), now(),
    array[current_setting('tests.profile_a')::uuid, current_setting('tests.profile_e')::uuid],
    array[current_setting('tests.profile_e')::uuid],
    array['21000000-0000-4000-8000-000000000099'::uuid]
  ) $$,
  'forbidden:%', 'an outsider cannot be claimed as a Session participant'
);

-- Athlete B is authorised. Athlete C is not. C's blocked bundle does not roll back B.
select is(
  (public.put_team_exercise_result_bundle(
    '22000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
    current_setting('tests.profile_b')::uuid, 1, '{"score":4}', now(),
    array['23000000-0000-4000-8000-000000000001'::uuid],
    array['21000000-0000-4000-8000-000000000001'::uuid]
  )).outcome,
  'inserted', 'authorised athlete bundle is accepted'
);
select is(
  (public.put_team_exercise_result_bundle(
    '22000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
    current_setting('tests.profile_b')::uuid, 1, '{"score":4}', now(),
    array['23000000-0000-4000-8000-000000000001'::uuid],
    array['21000000-0000-4000-8000-000000000001'::uuid]
  )).outcome,
  'already_present', 'accepted athlete bundle is idempotent'
);
select is(
  (public.put_team_exercise_result_bundle(
    '22000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
    current_setting('tests.profile_b')::uuid, 1, '{"score":0}', now(),
    array['23000000-0000-4000-8000-000000000001'::uuid],
    array['21000000-0000-4000-8000-000000000001'::uuid]
  )).outcome,
  'conflict', 'an accepted stable bundle cannot be silently overwritten'
);
select is(
  (public.put_team_exercise_result_bundle(
    '22000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001',
    current_setting('tests.profile_b')::uuid, 1, '{"score":4}', now(),
    array['23000000-0000-4000-8000-000000000099'::uuid],
    array['21000000-0000-4000-8000-000000000001'::uuid]
  )).outcome,
  'conflict', 'same bundle payload with a changed result manifest is a conflict'
);
select is(
  (public.put_team_exercise_result_bundle(
    '22000000-0000-4000-8000-000000000009', '20000000-0000-4000-8000-000000000001',
    current_setting('tests.profile_b')::uuid, 1, '{"score":4}', now(),
    array['23000000-0000-4000-8000-000000000009'::uuid],
    array['21000000-0000-4000-8000-000000000001'::uuid]
  )).outcome,
  'conflict', 'a second bundle identity cannot duplicate one Session athlete'
);
select is(
  (public.put_team_exercise_result_bundle(
    '22000000-0000-4000-8000-000000000008', '20000000-0000-4000-8000-000000000001',
    current_setting('tests.profile_c')::uuid, 1, '{"score":3}', now(),
    array['23000000-0000-4000-8000-000000000008'::uuid],
    array['21000000-0000-4000-8000-000000000008'::uuid]
  )).block_reason,
  'execution_not_in_session', 'bundle cannot claim an execution outside the envelope'
);
select is(
  (public.put_team_exercise_result_bundle(
    '22000000-0000-4000-8000-000000000007', '20000000-0000-4000-8000-000000000001',
    current_setting('tests.profile_e')::uuid, 1, '{"score":3}', now(),
    array['23000000-0000-4000-8000-000000000007'::uuid],
    array['21000000-0000-4000-8000-000000000001'::uuid]
  )).block_reason,
  'athlete_not_session_participant', 'bundle cannot add a later non-participant athlete'
);
select is(
  (public.put_team_exercise_result_bundle(
    '22000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
    current_setting('tests.profile_c')::uuid, 1, '{"score":3}', now(),
    array['23000000-0000-4000-8000-000000000002'::uuid],
    array['21000000-0000-4000-8000-000000000001'::uuid]
  )).outcome,
  'blocked', 'missing permission blocks only the affected athlete bundle'
);
select is(
  (public.put_team_exercise_result_bundle(
    '22000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
    current_setting('tests.profile_c')::uuid, 1, '{"score":3}', now(),
    array['23000000-0000-4000-8000-000000000002'::uuid],
    array['21000000-0000-4000-8000-000000000001'::uuid]
  )).block_reason,
  'recording_permission_missing', 'blocked outcome names the retryable authority reason'
);

select tests.reset_to_owner();
select is((select count(*)::int from public.team_exercise_result_bundles), 1, 'blocked C did not undo accepted B or create a placeholder');
select is((select count(*)::int from public.team_exercise_result_refs), 1, 'accepted child stable id exists exactly once');

-- The affected athlete may explicitly approve this concrete Session. Approval does
-- not need to recreate prospective Team permission.
select tests.act_as('00000000-0000-0000-0000-000000000103');
select is(
  (public.approve_my_team_exercise_session('20000000-0000-4000-8000-000000000001')).outcome,
  'approved', 'affected athlete explicitly approves the concrete Session'
);
select is(
  (public.approve_my_team_exercise_session('20000000-0000-4000-8000-000000000001')).outcome,
  'already_approved', 'concrete Session approval is idempotent'
);
select is(
  (select count(*)::int from public.team_exercise_recording_permissions
   where athlete_profile_id = current_setting('tests.profile_c')::uuid),
  0, 'Session approval did not create prospective Team permission'
);

select tests.act_as('00000000-0000-0000-0000-000000000101');
select is(
  (public.put_team_exercise_result_bundle(
    '22000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000001',
    current_setting('tests.profile_c')::uuid, 1, '{"score":3}', now(),
    array['23000000-0000-4000-8000-000000000002'::uuid],
    array['21000000-0000-4000-8000-000000000001'::uuid]
  )).outcome,
  'inserted', 'approved blocked athlete bundle succeeds on retry'
);

-- Membership loss is athlete-specific. Concrete approval can authorise the already
-- confirmed Session, but cannot make the former member a current Team member.
select tests.reset_to_owner();
update public.team_memberships
set status = 'ended', ended_at = clock_timestamp(), end_reason = 'left'
where team_id = current_setting('tests.team_id')::uuid
  and profile_id = current_setting('tests.profile_d')::uuid and status = 'active';
select tests.act_as('00000000-0000-0000-0000-000000000101');
select is(
  (public.put_team_exercise_result_bundle(
    '22000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001',
    current_setting('tests.profile_d')::uuid, 1, '{"score":2}', now(),
    array['23000000-0000-4000-8000-000000000003'::uuid],
    array['21000000-0000-4000-8000-000000000001'::uuid]
  )).block_reason,
  'athlete_membership_inactive', 'former athlete bundle is independently blocked'
);
select tests.act_as('00000000-0000-0000-0000-000000000104');
select is(
  (public.approve_my_team_exercise_session('20000000-0000-4000-8000-000000000001')).outcome,
  'approved', 'former member can approve their own already-confirmed Session'
);
select tests.act_as('00000000-0000-0000-0000-000000000101');
select is(
  (public.put_team_exercise_result_bundle(
    '22000000-0000-4000-8000-000000000003', '20000000-0000-4000-8000-000000000001',
    current_setting('tests.profile_d')::uuid, 1, '{"score":2}', now(),
    array['23000000-0000-4000-8000-000000000003'::uuid],
    array['21000000-0000-4000-8000-000000000001'::uuid]
  )).outcome,
  'inserted', 'concrete approval permits later retry without restoring membership'
);

select tests.act_as('00000000-0000-0000-0000-000000000105');
select throws_like(
  $$ select public.approve_my_team_exercise_session('20000000-0000-4000-8000-000000000001') $$,
  'forbidden:%', 'non-participant cannot approve a Session'
);
select throws_like(
  $$ select public.put_team_exercise_result_bundle(
    '22000000-0000-4000-8000-000000000099', '20000000-0000-4000-8000-000000000001',
    current_setting('tests.profile_b')::uuid, 1, '{}', now(),
    array['23000000-0000-4000-8000-000000000099'::uuid],
    array['21000000-0000-4000-8000-000000000001'::uuid]
  ) $$,
  'forbidden:%', 'another authenticated Profile cannot impersonate the original recorder'
);

-- Ownership RLS exposes only the athlete's accepted record and its coordination.
select tests.act_as('00000000-0000-0000-0000-000000000102');
select is((select count(*)::int from public.team_exercise_sessions), 1, 'athlete B can read coordination for own accepted result');
select is((select count(*)::int from public.team_exercise_result_bundles), 1, 'athlete B sees only own result bundle');
select is((select athlete_profile_id::text from public.team_exercise_result_bundles), current_setting('tests.profile_b'), 'B cannot see C or D bundle');
select is((select count(*)::int from public.team_exercise_session_participants), 4, 'own result unlocks its participant context');

-- Private notes are a separate athlete-only surface. Recorder and other athletes
-- cannot write or read them.
select is(
  (public.set_my_team_exercise_private_note('23000000-0000-4000-8000-000000000001', 'My private note')).outcome,
  'created', 'athlete creates private note for own result'
);
select is((select note from public.team_exercise_private_notes), 'My private note', 'athlete reads own private note');
select tests.act_as('00000000-0000-0000-0000-000000000101');
select throws_like(
  $$ select public.set_my_team_exercise_private_note('23000000-0000-4000-8000-000000000001', 'Recorder overwrite') $$,
  'forbidden:%', 'recorder cannot write athlete private note'
);
select is((select count(*)::int from public.team_exercise_private_notes), 0, 'recorder cannot read athlete private note');
select tests.act_as('00000000-0000-0000-0000-000000000103');
select throws_like(
  $$ select public.set_my_team_exercise_private_note('23000000-0000-4000-8000-000000000001', 'Other athlete overwrite') $$,
  'forbidden:%', 'another athlete cannot write B private note'
);
select is((select count(*)::int from public.team_exercise_private_notes), 0, 'another athlete cannot read B private note');
select tests.act_as('00000000-0000-0000-0000-000000000102');
select is(
  (public.set_my_team_exercise_private_note('23000000-0000-4000-8000-000000000001', null)).outcome,
  'cleared', 'athlete can clear own note without notifying participants'
);
select is((select count(*)::int from public.team_exercise_private_notes), 0, 'cleared private note is physically removed');

select tests.reset_to_owner();
select throws_like(
  $$ insert into public.team_exercise_private_notes(result_id, athlete_profile_id, note)
     values (
       '23000000-0000-4000-8000-000000000001',
       current_setting('tests.profile_c')::uuid,
       'cross-owner note'
     ) $$,
  '%team_exercise_private_note_result_owner_fk%',
  'schema couples every private note to the result owner even for privileged writers'
);
select tests.act_as('00000000-0000-0000-0000-000000000102');

-- Direct writes remain impossible; browser mutations are RPC-only.
select throws_like(
  $$ insert into public.team_exercise_result_bundles(
       id, session_id, athlete_profile_id, recorded_by_profile_id, schema_version,
       result_payload, content_sha256, recorded_at
     ) values (
       gen_random_uuid(), '20000000-0000-4000-8000-000000000001', current_setting('tests.profile_b')::uuid,
       current_setting('tests.profile_b')::uuid, 1, '{}', repeat('0', 64), now()
     ) $$,
  'permission denied%', 'authenticated cannot insert a bundle directly'
);
select throws_like(
  $$ update public.team_exercise_recording_permissions set revoked_at = now() $$,
  'permission denied%', 'authenticated cannot mutate recording permission directly'
);

select tests.act_as_anon();
select throws_like(
  $$ select public.put_team_exercise_session(
    gen_random_uuid(), current_setting('tests.team_id')::uuid, 1, '{}', now(), now(),
    array[current_setting('tests.profile_a')::uuid], array[current_setting('tests.profile_a')::uuid],
    array[gen_random_uuid()]
  ) $$,
  'permission denied%', 'anonymous caller cannot upload a Team Session'
);
select throws_like($$ select * from public.team_exercise_sessions $$, 'permission denied%', 'anonymous caller cannot read Team records');

-- Structural security assertions prove ACL, RLS and function exposure independently
-- of the behavioural paths above.
select tests.reset_to_owner();
select is(
  (select count(*)::int from pg_class
   where oid in (
     'public.team_exercise_recording_permissions'::regclass,
     'public.team_exercise_sessions'::regclass,
     'public.team_exercise_session_participants'::regclass,
     'public.team_exercise_execution_refs'::regclass,
     'public.team_exercise_result_bundles'::regclass,
     'public.team_exercise_result_refs'::regclass,
     'public.team_exercise_session_approvals'::regclass,
     'public.team_exercise_private_notes'::regclass
   ) and relrowsecurity),
  8, 'RLS is enabled on all eight C2a tables'
);
select is(
  (select count(*)::int from pg_policies
   where schemaname = 'public' and tablename like 'team_exercise_%' and cmd <> 'SELECT'),
  0, 'no browser write RLS policy exists'
);
select ok(
  not has_table_privilege('authenticated', 'public.team_exercise_sessions', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.team_exercise_result_bundles', 'INSERT,UPDATE,DELETE')
  and not has_table_privilege('authenticated', 'public.team_exercise_private_notes', 'INSERT,UPDATE,DELETE'),
  'authenticated has no direct write privilege on representative C2a tables'
);
select is(
  (select count(*)::int
   from unnest(array[
     'team_exercise_recording_permissions', 'team_exercise_sessions',
     'team_exercise_session_participants', 'team_exercise_execution_refs',
     'team_exercise_result_bundles', 'team_exercise_result_refs',
     'team_exercise_session_approvals', 'team_exercise_private_notes'
   ]) table_name
   where has_table_privilege('authenticated', 'public.' || table_name, 'INSERT,UPDATE,DELETE')),
  0, 'authenticated holds no direct write privilege on any C2a table'
);
select is(
  (select count(*)::int
   from unnest(array[
     'team_exercise_recording_permissions', 'team_exercise_sessions',
     'team_exercise_session_participants', 'team_exercise_execution_refs',
     'team_exercise_result_bundles', 'team_exercise_result_refs',
     'team_exercise_session_approvals', 'team_exercise_private_notes'
   ]) table_name
   where has_table_privilege('anon', 'public.' || table_name, 'SELECT,INSERT,UPDATE,DELETE')),
  0, 'anon holds no privilege on any C2a table'
);
select ok(
  not has_function_privilege('anon', 'public.put_team_exercise_session(uuid,uuid,integer,text,timestamptz,timestamptz,uuid[],uuid[],uuid[])', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.put_team_exercise_session(uuid,uuid,integer,text,timestamptz,timestamptz,uuid[],uuid[],uuid[])', 'EXECUTE'),
  'completed-Session upload is exposed only to authenticated'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname = 'public'
     and p.proname in (
       'set_my_team_exercise_recording_permission', 'put_team_exercise_session',
       'put_team_exercise_result_bundle', 'approve_my_team_exercise_session',
       'set_my_team_exercise_private_note'
     )
     and (p.proacl is null or exists (select 1 from unnest(p.proacl) acl where acl::text like '=%'))),
  0, 'PUBLIC execute is revoked on every C2a RPC'
);
select is(
  (select count(*)::int from unnest(array[
    'set_my_team_exercise_recording_permission(uuid,boolean)',
    'put_team_exercise_session(uuid,uuid,integer,text,timestamptz,timestamptz,uuid[],uuid[],uuid[])',
    'put_team_exercise_result_bundle(uuid,uuid,uuid,integer,text,timestamptz,uuid[],uuid[])',
    'approve_my_team_exercise_session(uuid)',
    'set_my_team_exercise_private_note(uuid,text)'
  ]) signature where has_function_privilege('anon', 'public.' || signature, 'EXECUTE')),
  0, 'anon can execute none of the five C2a RPCs'
);
select is(
  (select count(*)::int from unnest(array[
    'set_my_team_exercise_recording_permission(uuid,boolean)',
    'put_team_exercise_session(uuid,uuid,integer,text,timestamptz,timestamptz,uuid[],uuid[],uuid[])',
    'put_team_exercise_result_bundle(uuid,uuid,uuid,integer,text,timestamptz,uuid[],uuid[])',
    'approve_my_team_exercise_session(uuid)',
    'set_my_team_exercise_private_note(uuid,text)'
  ]) signature where has_function_privilege('authenticated', 'public.' || signature, 'EXECUTE')),
  5, 'authenticated can execute all five and only the intended C2a RPC surface'
);
select is(
  (select count(*)::int from unnest(array[
    'team_exercise_profile_is_free_athlete(uuid)',
    'team_exercise_has_active_membership(uuid,uuid)',
    'team_exercise_membership_covers(uuid,uuid,timestamptz)',
    'team_exercise_has_current_permission(uuid,uuid)',
    'team_exercise_session_manifest_matches(uuid,uuid[],uuid[],uuid[])',
    'team_exercise_bundle_manifest_matches(uuid,uuid[],uuid[])'
  ]) signature where has_function_privilege('authenticated', 'private.' || signature, 'EXECUTE')),
  0, 'authenticated cannot execute any private C2a helper directly'
);
select is(
  (select count(*)::int from pg_proc p join pg_namespace n on n.oid = p.pronamespace
   where n.nspname in ('public', 'private')
     and p.proname like '%team_exercise%'
     and not exists (
       select 1 from unnest(coalesce(p.proconfig, '{}'::text[])) setting
       where setting in ('search_path=', 'search_path=""')
     )),
  0, 'every C2a function pins an empty search_path'
);

select * from finish();
rollback;
