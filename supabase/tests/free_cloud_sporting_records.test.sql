-- Stage B0.4 real-database verification. Run after a clean --no-seed reset.
begin;

create schema tests;
grant usage on schema tests to authenticated, anon;

select plan(37);

insert into auth.users (id, email) values
  ('00000000-0000-0000-0000-000000000011', 'cloud-a@example.com'),
  ('00000000-0000-0000-0000-000000000012', 'cloud-b@example.com'),
  ('00000000-0000-0000-0000-000000000013', 'cloud-bare@example.com');

insert into public.legal_documents (kind, version_label, document_url, effective_at) values
  ('terms_of_service', 'cloud-suite-terms-v1', 'https://example.invalid/cloud-suite-terms-v1', now()),
  ('privacy_notice', 'cloud-suite-privacy-v1', 'https://example.invalid/cloud-suite-privacy-v1', now());

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
create function tests.onboard(p_name text) returns void as $$
declare v_terms uuid; v_privacy uuid;
begin
  perform public.ensure_my_profile();
  select id into strict v_terms from public.get_current_legal_documents() where kind = 'terms_of_service';
  select id into strict v_privacy from public.get_current_legal_documents() where kind = 'privacy_notice';
  perform public.complete_personal_onboarding(p_name, v_terms, v_privacy);
end;
$$ language plpgsql security invoker;

select tests.act_as('00000000-0000-0000-0000-000000000011');
select lives_ok($$ select tests.onboard('Cloud A') $$, 'Profile A completes canonical onboarding');
select is(
  (public.put_my_sporting_record(
    'training_session', '11111111-1111-4111-8111-111111111111', 1,
    $json${"id":"11111111-1111-4111-8111-111111111111","notes":"\u0000\ud800"}$json$,
    '2026-08-27T10:00:00Z'
  )).outcome,
  'inserted',
  'first exact record upload inserts'
);
select is(
  (select payload from public.sporting_records where record_id = '11111111-1111-4111-8111-111111111111'),
  $json${"id":"11111111-1111-4111-8111-111111111111","notes":"\u0000\ud800"}$json$,
  'TEXT authority preserves JSON escape sequences byte-for-byte'
);
select ok(
  (select content_sha256 ~ '^[0-9a-f]{64}$' from public.sporting_records where record_id = '11111111-1111-4111-8111-111111111111'),
  'server owns a canonical payload digest'
);
select is(
  (public.put_my_sporting_record(
    'training_session', '11111111-1111-4111-8111-111111111111', 1,
    $json${"id":"11111111-1111-4111-8111-111111111111","notes":"\u0000\ud800"}$json$,
    '2026-08-27T10:00:00Z'
  )).outcome,
  'already_present',
  'same stable identity and exact content is idempotent'
);
select is(
  (public.put_my_sporting_record(
    'training_session', '11111111-1111-4111-8111-111111111111', 1,
    '{"different":true}', '2026-08-27T10:00:00Z'
  )).outcome,
  'conflict',
  'different content under one stable identity is never overwritten'
);
select is((select count(*)::int from public.sporting_records), 1, 'conflicting retry created no duplicate');
select is((select count(*)::int from public.get_my_sporting_records()), 1, 'restore returns the own live record');
select is((select record_id::text from public.get_my_sporting_records()), '11111111-1111-4111-8111-111111111111', 'restore returns stable identity');

select throws_like(
  $$ select public.put_my_sporting_record('unknown', gen_random_uuid(), 1, '{}', now()) $$,
  'invalid_input:%', 'unsupported record kind fails closed'
);
select throws_like(
  $$ select public.put_my_sporting_record('assessment_run', gen_random_uuid(), 0, '{}', now()) $$,
  'invalid_input:%', 'non-positive schema version fails closed'
);

select tests.reset_to_owner();
select tests.act_as('00000000-0000-0000-0000-000000000013');
select lives_ok($$ select public.ensure_my_profile() $$, 'bare account establishes only a Profile');
select throws_like(
  $$ select public.put_my_sporting_record('assessment_run', gen_random_uuid(), 1, '{}', now()) $$,
  'forbidden:%', 'a bare Profile cannot upload'
);
select throws_like($$ select * from public.get_my_sporting_records() $$, 'forbidden:%', 'a bare Profile cannot restore');

select tests.reset_to_owner();
select tests.act_as('00000000-0000-0000-0000-000000000012');
select lives_ok($$ select tests.onboard('Cloud B') $$, 'Profile B completes canonical onboarding');
select is((select count(*)::int from public.sporting_records), 0, 'RLS hides Profile A records from Profile B');
select is((select count(*)::int from public.get_my_sporting_records()), 0, 'Profile B restore cannot observe Profile A');
select is(
  (public.put_my_sporting_record('training_session', '11111111-1111-4111-8111-111111111111', 1, '{"owner":"b"}', now())).outcome,
  'inserted', 'the same client record id is independent across Profiles'
);

select tests.act_as('00000000-0000-0000-0000-000000000011');
select is((select count(*)::int from public.get_my_sporting_records()), 1, 'Profile A still restores only its own record');
select set_config(
  'tests.profile_a_content_hash',
  (select content_sha256 from public.sporting_records where record_id = '11111111-1111-4111-8111-111111111111'),
  false
);
select is(
  (public.delete_my_sporting_record('training_session', '11111111-1111-4111-8111-111111111111', repeat('0', 64))).outcome,
  'conflict', 'deletion with a mismatched expected digest is refused'
);
select is((select count(*)::int from public.sporting_record_tombstones), 0, 'refused deletion creates no tombstone');
select is(
  (public.delete_my_sporting_record(
    'training_session', '11111111-1111-4111-8111-111111111111',
    current_setting('tests.profile_a_content_hash')
  )).outcome,
  'deleted', 'matching deletion creates a tombstone'
);
select is((select count(*)::int from public.get_my_sporting_records()), 0, 'restore excludes tombstoned records');
select is(
  (select count(*)::int from public.sporting_records where record_id = '11111111-1111-4111-8111-111111111111'),
  0,
  'matching deletion removes the raw sporting payload in the tombstone transaction'
);
select is(
  (public.delete_my_sporting_record(
    'training_session', '11111111-1111-4111-8111-111111111111',
    current_setting('tests.profile_a_content_hash')
  )).outcome,
  'already_deleted', 'repeated matching deletion is idempotent'
);
select is(
  (public.put_my_sporting_record('training_session', '11111111-1111-4111-8111-111111111111', 1, $json${"id":"11111111-1111-4111-8111-111111111111","notes":"\u0000\ud800"}$json$, now())).outcome,
  'conflict', 'a tombstoned stable identity cannot be resurrected'
);

select throws_like(
  $$ insert into public.sporting_records(profile_id, record_kind, record_id, schema_version, payload, content_sha256, recorded_at)
     values ((public.get_my_profile()).id, 'training_session', gen_random_uuid(), 1, '{}', repeat('0',64), now()) $$,
  'permission denied%', 'authenticated cannot insert directly'
);
select throws_like($$ delete from public.sporting_records $$, 'permission denied%', 'authenticated cannot delete directly');
select throws_like($$ insert into public.sporting_record_tombstones values ((public.get_my_profile()).id, 'training_session', gen_random_uuid(), repeat('0',64), now()) $$, 'permission denied%', 'authenticated cannot forge tombstones');

select tests.act_as_anon();
select throws_like($$ select * from public.get_my_sporting_records() $$, 'permission denied%', 'anon cannot restore');
select throws_like($$ select public.put_my_sporting_record('training_session', gen_random_uuid(), 1, '{}', now()) $$, 'permission denied%', 'anon cannot upload');
select throws_like($$ select * from public.sporting_records $$, 'permission denied%', 'anon cannot read the table');

select tests.reset_to_owner();
select ok((select relrowsecurity from pg_class where oid = 'public.sporting_records'::regclass), 'records RLS is enabled');
select ok((select relrowsecurity from pg_class where oid = 'public.sporting_record_tombstones'::regclass), 'tombstone RLS is enabled');
select ok(not has_table_privilege('authenticated', 'public.sporting_records', 'INSERT,UPDATE,DELETE'), 'authenticated has no direct record write privilege');
select ok(not has_table_privilege('authenticated', 'public.sporting_record_tombstones', 'INSERT,UPDATE,DELETE'), 'authenticated has no direct tombstone write privilege');
select is((select count(*)::int from pg_policies where schemaname = 'public' and tablename in ('sporting_records','sporting_record_tombstones') and cmd <> 'SELECT'), 0, 'no browser write policy exists');

select * from finish();
rollback;
