-- Persistence-stage evidence only. Fresh --no-seed local database required.
begin;
select no_plan();
create schema tests;
grant usage on schema tests to authenticated, anon;
create table tests.profiles(name text primary key, id uuid);
grant select on tests.profiles to authenticated, anon;
insert into auth.users(id, email) values
 ('00000000-0000-4000-8000-000000000301', 'deletion-a@example.invalid'),
 ('00000000-0000-4000-8000-000000000302', 'deletion-b@example.invalid');
insert into public.legal_documents(kind, version_label, document_url, effective_at) values
 ('terms_of_service', 'deletion-terms', 'https://example.invalid/deletion-terms', now()),
 ('privacy_notice', 'deletion-privacy', 'https://example.invalid/deletion-privacy', now());
create function tests.act_as(p_id uuid, p_age integer default 0) returns void language plpgsql as $$
begin
  reset role;
  perform set_config('request.jwt.claims', jsonb_build_object('sub', p_id, 'role', 'authenticated',
    'amr', jsonb_build_array(jsonb_build_object('method', 'otp', 'timestamp', floor(extract(epoch from now())) - p_age)))::text, true);
  set local role authenticated;
end;
$$;
create function tests.onboard() returns uuid language plpgsql as $$
declare p uuid; t uuid; n uuid;
begin
  select (public.ensure_my_profile()).id into p;
  select id into t from public.get_current_legal_documents() where kind = 'terms_of_service';
  select id into n from public.get_current_legal_documents() where kind = 'privacy_notice';
  perform public.complete_personal_onboarding('Synthetic athlete', t, n);
  return p;
end;
$$;
create function tests.pending_id() returns uuid language sql security definer as $$
 select id from public.account_deletion_requests where cancelled_at is null and finalized_at is null limit 1;
$$;
select tests.act_as('00000000-0000-4000-8000-000000000301');
select lives_ok('select tests.onboard()', 'A completes real onboarding');
reset role;
insert into tests.profiles select 'A', profile_id from public.account_profile_links where account_id = '00000000-0000-4000-8000-000000000301';
select tests.act_as('00000000-0000-4000-8000-000000000302');
select lives_ok('select tests.onboard()', 'B completes real onboarding');
reset role;
insert into tests.profiles select 'B', profile_id from public.account_profile_links where account_id = '00000000-0000-4000-8000-000000000302';

-- Shared relational fixtures are deliberately separate from the UI/domain
-- round-trip covered by team-foundation-live.spec.ts.
insert into public.teams(id, name, created_by_profile_id)
 select '00000000-0000-4000-8000-000000000321', 'Deletion Team', id from tests.profiles where name = 'A';
insert into public.team_memberships(id, team_id, profile_id, participation_as_player)
 select case name when 'A' then '00000000-0000-4000-8000-000000000322'::uuid else '00000000-0000-4000-8000-000000000323'::uuid end,
 '00000000-0000-4000-8000-000000000321', id, true from tests.profiles;
insert into public.team_membership_functions(membership_id, function)
 values ('00000000-0000-4000-8000-000000000322', 'team_admin');
insert into public.team_exercise_sessions(id, team_id, recorded_by_profile_id, schema_version,
 coordination_payload, content_sha256, started_at, completed_at)
 select '00000000-0000-4000-8000-000000000331', '00000000-0000-4000-8000-000000000321', id, 1,
 '{"fixture":"shared context"}', repeat('a',64), now(), now() from tests.profiles where name = 'A';
insert into public.team_exercise_session_participants(session_id, profile_id, participation)
 select '00000000-0000-4000-8000-000000000331', id, 'training-athlete' from tests.profiles;
insert into public.team_exercise_execution_refs(session_id, execution_id)
 values ('00000000-0000-4000-8000-000000000331', '00000000-0000-4000-8000-000000000361');
insert into public.team_exercise_result_bundles(id, session_id, athlete_profile_id, recorded_by_profile_id,
 schema_version, result_payload, content_sha256, recorded_at)
 select case name when 'A' then '00000000-0000-4000-8000-000000000341'::uuid else '00000000-0000-4000-8000-000000000342'::uuid end,
 '00000000-0000-4000-8000-000000000331', id, (select id from tests.profiles where name = 'A'), 1,
 jsonb_build_object('syntheticOwner', name)::text, repeat('b',64), now() from tests.profiles;
insert into public.team_exercise_result_refs(bundle_id, result_id, athlete_profile_id, execution_id)
 select b.id, case p.name when 'A' then '00000000-0000-4000-8000-000000000351'::uuid else '00000000-0000-4000-8000-000000000352'::uuid end,
 p.id, '00000000-0000-4000-8000-000000000361' from public.team_exercise_result_bundles b join tests.profiles p on p.id = b.athlete_profile_id;
insert into public.team_exercise_private_notes(result_id, athlete_profile_id, note)
 select result_id, athlete_profile_id, 'Synthetic private note' from public.team_exercise_result_refs;
insert into public.team_exercise_result_revisions(id, result_id, athlete_profile_id, revision_number,
 kind, schema_version, result_payload, content_sha256, changed_fields, reason, actor_profile_id)
 select gen_random_uuid(), result_id, athlete_profile_id, 1, 'corrected', 1,
 '{"syntheticRevision":true}', repeat('c',64), array['evaluation'], 'Synthetic correction reason', athlete_profile_id
 from public.team_exercise_result_refs;

-- Historical email ownership is relational, not a global email-text match.
insert into public.team_invitations(id, team_id, email, token_hash, created_by_profile_id, expires_at, status, accepted_by_membership_id)
select v.id::uuid, '00000000-0000-4000-8000-000000000321', v.email, repeat(v.hash,64), p.id,
  now() + interval '7 days', v.status, v.membership::uuid
from (values
 ('00000000-0000-4000-8000-000000000501', 'earlier-a@example.invalid', 'a', 'accepted', '00000000-0000-4000-8000-000000000322'),
 ('00000000-0000-4000-8000-000000000502', 'deletion-a@example.invalid', 'b', 'pending', null),
 ('00000000-0000-4000-8000-000000000503', 'unrelated@example.invalid', 'c', 'pending', null),
 ('00000000-0000-4000-8000-000000000504', 'earlier-a@example.invalid', 'd', 'accepted', '00000000-0000-4000-8000-000000000323')
) v(id, email, hash, status, membership) cross join tests.profiles p where p.name = 'B';
insert into public.team_invitations(id, team_id, email, token_hash, created_by_profile_id, expires_at)
select '00000000-0000-4000-8000-000000000505', '00000000-0000-4000-8000-000000000321', 'outgoing@example.invalid', repeat('e',64), id,
  now() + interval '7 days' from tests.profiles where name = 'A';
insert into public.team_audit_events(id, team_id, actor_profile_id, event_type, payload)
select v.id::uuid, '00000000-0000-4000-8000-000000000321', p.id, 'invitation_created',
  jsonb_build_object('invitationId', v.invitation, 'email', v.email)
from (values
 ('00000000-0000-4000-8000-000000000511', '00000000-0000-4000-8000-000000000501', 'earlier-a@example.invalid'),
 ('00000000-0000-4000-8000-000000000512', '00000000-0000-4000-8000-000000000504', 'earlier-a@example.invalid')
) v(id, invitation, email) cross join tests.profiles p where p.name = 'B';
insert into public.team_admin_requests(id, team_id, membership_id, created_by_profile_id, expires_at)
select v.id::uuid, '00000000-0000-4000-8000-000000000321', v.membership::uuid, p.id, now() + interval '7 days'
from (values
 ('00000000-0000-4000-8000-000000000521', '00000000-0000-4000-8000-000000000322'),
 ('00000000-0000-4000-8000-000000000522', '00000000-0000-4000-8000-000000000323')
) v(id, membership) cross join tests.profiles p where p.name = 'B';
insert into public.team_exercise_session_approvals(session_id, athlete_profile_id)
select '00000000-0000-4000-8000-000000000331', id from tests.profiles;
insert into public.pilot_team_creation_grants(profile_id) select id from tests.profiles;

select tests.act_as('00000000-0000-4000-8000-000000000301', 600);
select throws_like($$select public.abort_my_uncommitted_account_deletion((select id from tests.profiles where name = 'A'), 0)$$, 'reauthentication_required:%', 'uncertain-operation recovery also requires recent authentication');
select ok(not has_function_privilege('anon', 'public.get_my_account_deletion_control()', 'EXECUTE'), 'anonymous clients cannot read deletion controls');
select ok(not has_function_privilege('anon', 'public.abort_my_uncommitted_account_deletion(uuid,integer)', 'EXECUTE'), 'anonymous clients cannot fence another account');
select ok(not has_table_privilege('authenticated', (select c.oid from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'private' and c.relname = 'account_deletion_fences'), 'UPDATE'), 'browser clients cannot change deletion revisions directly');
select throws_like($$select public.request_my_account_deletion((select id from tests.profiles where name = 'A'), 0)$$, 'reauthentication_required:%', 'old authentication cannot request deletion');
select tests.act_as('00000000-0000-4000-8000-000000000301');
select throws_like($$select public.request_my_account_deletion((select id from tests.profiles where name = 'B'), 0)$$, 'conflict:%', 'stale UI cannot request deletion for a different Profile');
select set_config('request.jwt.claims', '{"sub":"00000000-0000-4000-8000-000000000301","role":"authenticated","iat":9999999999}', true);
select throws_like($$select public.request_my_account_deletion((select id from tests.profiles where name = 'A'), 0)$$, 'reauthentication_required:%', 'refresh-token issuance time cannot replace a recent authentication method');
select tests.act_as('00000000-0000-4000-8000-000000000301');
select is(jsonb_array_length(public.get_my_account_export()->'legalEvidence'), 2, 'export includes the exact two legal evidence rows');
select lives_ok($$select public.put_my_sporting_record('training_session', '00000000-0000-4000-8000-000000000311', 1, '{"fixture":"own"}', now())$$, 'A creates own cloud raw record');
select is(jsonb_array_length(public.get_my_account_export()->'sportingRecords'), 1, 'personal export includes own raw records');
select is(jsonb_array_length(public.get_my_account_export()->'teamResultBundles'), 1, 'personal export includes only the own Team bundle');
select is(jsonb_array_length(public.get_my_account_export()->'privateNotes'), 1, 'personal export includes only the own private note');
select is(jsonb_array_length(public.get_my_account_export()->'invitations'), 3, 'export includes own historical/current incoming and outgoing invitations only');
select ok(not (public.get_my_account_export()->'invitations')::text like '%token_hash%', 'export excludes invitation authentication hashes');
select ok(not (public.get_my_account_export()->'invitations')::text like '%unrelated@example.invalid%', 'export excludes unrelated invitation recipients even in the same Team');
select is(jsonb_array_length(public.get_my_account_export()->'adminRequests'), 1, 'export includes only own Admin responsibility request');
select is(jsonb_array_length(public.get_my_account_export()->'auditHistory'), 1, 'export includes historical invitation audit without unrelated same-email events');
select is(jsonb_array_length(public.get_my_account_export()->'sessionApprovals'), 1, 'export includes own session approval');
select is(jsonb_array_length(public.get_my_account_export()->'sessionParticipation'), 1, 'export includes own session participation');
select is(jsonb_array_length(public.get_my_account_export()->'athleteCapabilities'), 1, 'export includes own Athlete capability');
select is(jsonb_array_length(public.get_my_account_export()->'teamCreationGrants'), 1, 'export includes own pilot creation grant');
select is(public.abort_my_uncommitted_account_deletion((select id from tests.profiles where name = 'A'), 0), 1, 'unknown outcome recovery fences uncommitted older requests');
select throws_like($$select public.request_my_account_deletion((select id from tests.profiles where name = 'A'), 0)$$, 'conflict:%', 'delayed request cannot arrive after successful abort');
select lives_ok($$select public.request_my_account_deletion((select id from tests.profiles where name = 'A'), 1)$$, 'fresh auth requests deletion');
reset role;
select is((select status from public.teams where id = '00000000-0000-4000-8000-000000000321'), 'recovery', 'pending final Admin immediately enters restricted recovery');
create table tests.previous_request as select id from public.account_deletion_requests where cancelled_at is null;
grant select on tests.previous_request to authenticated;
select tests.act_as('00000000-0000-4000-8000-000000000301');
select is((select count(*)::int from public.get_my_account_deletion_state()), 1, 'pending state is readable by its owner');
select is((select finalize_after - requested_at from public.get_my_account_deletion_state()), interval '30 days', 'server sets the agreed recovery period');
select is((public.get_my_profile()).id, null::uuid, 'pending account has no application Profile authority');
select is((public.get_my_gate_state()).profile_id, null::uuid, 'the ordinary application gate denies a pending account');
select throws_like('select public.get_my_sporting_records()', 'forbidden:%', 'pending account cannot restore sporting history');
select throws_like($$select public.put_my_sporting_record('training_session', gen_random_uuid(), 1, '{}', now())$$, 'forbidden:%', 'pending account cannot upload');
select lives_ok($$select public.request_my_account_deletion((select id from tests.profiles where name = 'A'), 1)$$, 'lost request acknowledgement retries idempotently');
select throws_like($$select public.abort_my_uncommitted_account_deletion((select id from tests.profiles where name = 'A'), 1)$$, 'conflict:%', 'recovery cannot automatically cancel a committed deletion');
select throws_like('select public.finalize_due_account_deletions()', '%permission denied%', 'browser cannot finalize any account');
select throws_like('select * from public.account_deletion_requests', '%permission denied%', 'browser cannot query the lifecycle table directly');
select tests.act_as('00000000-0000-4000-8000-000000000302');
select is((select count(*)::int from public.get_my_account_deletion_state()), 0, 'B cannot see A deletion state');
select is(public.get_my_account_deletion_control()->>'profile_id', (select id::text from tests.profiles where name = 'B'), 'pending-account control endpoint remains bound to its caller');
select throws_like($$select public.abort_my_uncommitted_account_deletion((select id from tests.profiles where name = 'A'), 1)$$, 'conflict:%', 'another Profile cannot fence a deletion operation');
select is(public.cancel_my_account_deletion(tests.pending_id()), false, 'B cannot cancel A request');
select is(jsonb_array_length(public.get_my_account_export()->'sportingRecords'), 0, 'B personal export excludes A raw record');
select tests.act_as('00000000-0000-4000-8000-000000000301', 600);
select throws_like('select public.cancel_my_account_deletion(tests.pending_id())', 'reauthentication_required:%', 'cancellation requires recent authentication');
select tests.act_as('00000000-0000-4000-8000-000000000301');
select is(public.cancel_my_account_deletion(tests.pending_id()), true, 'freshly reauthenticated owner can cancel');
reset role;
select is((select status from public.teams where id = '00000000-0000-4000-8000-000000000321'), 'active', 'cancellation restores the Team when an available Admin returns');
select tests.act_as('00000000-0000-4000-8000-000000000301');
select ok((public.get_my_profile()).id is not null, 'cancellation restores server Profile authority');
select is((select count(*)::int from public.get_my_sporting_records()), 1, 'cancellation preserved the complete raw record');
select throws_like($$select public.request_my_account_deletion((select id from tests.profiles where name = 'A'), 1)$$, 'conflict:%', 'late original request cannot recreate deletion after cancellation');
select lives_ok($$select public.request_my_account_deletion((select id from tests.profiles where name = 'A'), 2)$$, 'owner may explicitly request again');
select is(public.cancel_my_account_deletion((select id from tests.previous_request)), false, 'a delayed cancellation cannot cancel a replacement request');
reset role;
select is(public.finalize_due_account_deletions(), 0, 'worker cannot delete before the recovery period');
update public.account_deletion_requests set requested_at = now() - interval '31 days', finalize_after = now() - interval '1 day'
 where cancelled_at is null and finalized_at is null;
select tests.act_as('00000000-0000-4000-8000-000000000301');
select throws_like('select public.cancel_my_account_deletion(tests.pending_id())', 'recovery_period_ended:%', 'a fresh login cannot cancel after the recovery cutoff');
reset role;
select lives_ok('select public.finalize_due_account_deletions()', 'due finalization removes account and protected own records');
select ok((select email <> 'earlier-a@example.invalid' from public.team_invitations where id = '00000000-0000-4000-8000-000000000501'), 'purge anonymizes accepted invitation to earlier email');
select is((select payload from public.team_audit_events where id = '00000000-0000-4000-8000-000000000511'), '{"participantAnonymized":true}'::jsonb, 'purge anonymizes inviter-authored historical email audit');
select is((select email from public.team_invitations where id = '00000000-0000-4000-8000-000000000504'), 'earlier-a@example.invalid', 'purge preserves another subject invitation to the reused email');
select ok((select payload::text like '%earlier-a@example.invalid%' from public.team_audit_events where id = '00000000-0000-4000-8000-000000000512'), 'purge preserves another subject audit despite reused email');
select is((select count(*)::int from auth.users where id = '00000000-0000-4000-8000-000000000301'), 0, 'authentication account removed');
select is((select count(*)::int from public.account_profile_links where profile_id = (select id from tests.profiles where name = 'A')), 0, 'identity link removed');
select is((select count(*)::int from public.sporting_records where profile_id = (select id from tests.profiles where name = 'A')), 0, 'own sporting raw records removed');
select is((select count(*)::int from public.legal_acceptances where profile_id = (select id from tests.profiles where name = 'A')), 0, 'own legal evidence purged only through the due finalizer');
select is((select display_name from public.profiles where id = (select id from tests.profiles where name = 'A')), 'Deleted athlete', 'minimal retained Profile is anonymized');
select is(public.finalize_due_account_deletions(), 0, 'worker retry is idempotent');
select is((select count(*)::int from auth.users where id = '00000000-0000-4000-8000-000000000302'), 1, 'other account remains intact');
select is((select count(*)::int from public.team_exercise_result_bundles where athlete_profile_id = (select id from tests.profiles where name = 'A')), 0, 'deleted athlete raw Team bundle is removed');
select is((select count(*)::int from public.team_exercise_result_revisions where athlete_profile_id = (select id from tests.profiles where name = 'A')), 0, 'deleted athlete raw revision history is removed');
select is((select count(*)::int from public.team_exercise_private_notes where athlete_profile_id = (select id from tests.profiles where name = 'A')), 0, 'deleted athlete private note is removed');
select is((select result_payload from public.team_exercise_result_bundles where athlete_profile_id = (select id from tests.profiles where name = 'B')), '{"syntheticOwner": "B"}', 'other athlete raw Team result is byte-identical');
select is((select count(*)::int from public.team_exercise_private_notes where athlete_profile_id = (select id from tests.profiles where name = 'B')), 1, 'other private note remains');
select is((select count(*)::int from public.team_exercise_result_revisions where athlete_profile_id = (select id from tests.profiles where name = 'B')), 1, 'other revision chain remains');
select is((select status from public.teams where id = '00000000-0000-4000-8000-000000000321'), 'recovery', 'loss of final Admin enters restricted recovery');
select is((select count(*)::int from public.account_notifications where kind = 'shared_participant_unavailable'), 1, 'affected participant receives one neutral notification');
select is((select payload from public.account_notifications where kind = 'shared_participant_unavailable'), '{}'::jsonb, 'notification contains no reason or performance content');
select throws_like('update public.team_exercise_result_revisions set reason = ''Changed ordinary record''', '%append-only%', 'ordinary revision immutability survives the purge');
select throws_like('update public.profile_onboarding set completed_at = now()', 'conflict:%', 'ordinary onboarding immutability remains enforced');
insert into auth.users(id, email) values ('00000000-0000-4000-8000-000000000303', 'deletion-a@example.invalid');
select tests.act_as('00000000-0000-4000-8000-000000000303');
select isnt((public.ensure_my_profile()).id, (select id from tests.profiles where name = 'A'), 'a new account with the same email never adopts the deleted Profile');
select * from finish();
rollback;
