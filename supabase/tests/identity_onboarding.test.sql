-- Stage B0.2a — Identity and Onboarding pgTAP suite. See README.md in this directory
-- for the coverage map and the recorded execution result. Run via
-- `supabase test db --local supabase/tests/identity_onboarding.test.sql`.
--
-- Scope: the four new tables (`legal_documents`, `legal_acceptances`,
-- `profile_onboarding`, `profile_entitlements`), their RLS/grant boundary, and the four
-- new RPCs (`get_current_legal_documents`, `ensure_my_profile`, `get_my_gate_state`,
-- `complete_personal_onboarding`). This file changes nothing about Team Foundation and
-- The later B0.2e forward migration revokes the legacy `bootstrap_profile` route;
-- the Team suite owns the corresponding privilege assertion.
--
-- Auth simulation, harness ownership, role discipline and fixture identity discipline
-- follow exactly the conventions established by `team_foundation.test.sql` in this same
-- directory; the header there states the reasoning in full and is not repeated here.
-- In short:
--   * the `tests` schema, its role helpers and their single schema-usage grant are
--     created INSIDE this file's transaction and removed by the closing `rollback`, so
--     nothing test-only is ever shipped in a product migration;
--   * privileged fixture setup (seeding `auth.users`, inserting/retiring legal
--     documents, inserting evidence rows directly, creating the deliberate-failure
--     trigger) runs under the migration-owning role via `tests.reset_to_owner()` —
--     `authenticated` holds no table-level write privilege on any of these tables and
--     would fail on a bare permission error before reaching what the test means to
--     exercise;
--   * every BEHAVIOURAL assertion (an RPC call, an RLS-gated select, a denied direct
--     write) runs under the exact role being tested;
--   * every fixture is captured into a `tests.*` GUC with `select ... into strict` at
--     the moment it is created — never re-found by name alone, by `created_at`
--     ordering, or by a bare `limit 1`. The whole file runs in one transaction where
--     `now()` is constant, so ordering could not disambiguate anything anyway.
--
-- PRECONDITION: run this file against a FRESHLY RESET database —
-- `supabase db reset --local --no-seed --yes` immediately before
-- `supabase test db --local supabase/tests/identity_onboarding.test.sql`. Several
-- assertions here are deliberately GLOBAL zero-counts ("ensure_my_profile creates no
-- Athlete capability ANYWHERE", not merely "none for this Profile"), which is the
-- stronger claim, and the suite publishes its own legal-document fixtures, which
-- collide with any already-published current version. Pre-existing committed rows —
-- for example the ones the multi-session concurrency procedures below leave behind —
-- therefore make this file FAIL LOUDLY with a bad plan. That is the intended direction:
-- a dirty database can never produce a vacuous pass here.
--
-- Legal fixtures are harmless, fictional metadata under `example.invalid` (a reserved
-- non-resolving TLD). **No real legal document, no real legal copy and no production
-- URL is authored here or in any migration** — ADR-0025 Decision 17. A product
-- migration seeds no legal row at all; supplying the approved closed-test rows is an
-- operational step, and it is still outstanding (see README.md).
--
-- What this file CANNOT prove: pgTAP runs single-threaded inside one transaction and
-- cannot make one backend block on a lock another backend holds. The three locking
-- protocols — two per-account advisory locks and the relation lock that linearizes
-- onboarding against an owner-operated Legal rotation — are therefore verified
-- separately, by hand, with genuinely concurrent connections: Procedures A, B and C,
-- documented after the closing `rollback` below and summarised with their observed
-- results in README.md.
--
-- What this file CAN prove about the relation lock, and does: `LOCK TABLE ... IN SHARE
-- MODE` is transaction-duration, and this whole file is one transaction, so a SHARE
-- lock that `complete_personal_onboarding()` takes is still visible in `pg_locks` for
-- this backend after the call returns. §1 and §7 read it there — zero before the first
-- successful completion, exactly one after. That is a direct observation of the real
-- lock, not an inspection of the source text; the source-text assertions in §1 pin the
-- ordering `pg_locks` cannot show from inside a single transaction.

begin;

create schema tests;
grant usage on schema tests to authenticated, anon;

select plan(187);

-- Seed the auth accounts. This file runs as the migration-owning role, so it can write
-- `auth.users` directly; no application code ever does.
--   0001  the happy path: onboards on the v1 snapshot, then retries after a rotation.
--   0002  the negative matrix: keeps a bare Profile through every refused call, and
--         only completes at the very end, on the v2 snapshot.
--   0003  never calls ensure_my_profile — the "no Profile" case.
--   0004  a second completed Profile, used as the cross-Profile RLS subject.
--   0005  the deliberate-late-failure case: keeps a bare Profile throughout.
insert into auth.users (id, email) values
  ('10000000-0000-0000-0000-000000000001', 'onboarded@example.invalid'),
  ('10000000-0000-0000-0000-000000000002', 'negatives@example.invalid'),
  ('10000000-0000-0000-0000-000000000003', 'no-profile@example.invalid'),
  ('10000000-0000-0000-0000-000000000004', 'other@example.invalid'),
  ('10000000-0000-0000-0000-000000000005', 'rollback@example.invalid');

create function tests.reset_to_owner() returns void as $$
begin
  reset role;
end;
$$ language plpgsql;

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

-- The `authenticated` role with no `sub` claim: a session token that cannot be resolved
-- to an account. `auth.uid()` returns NULL, and every RPC that needs an identity must
-- fail closed rather than treating NULL as "everyone" or as "nobody in particular".
create function tests.act_as_authenticated_without_subject() returns void as $$
begin
  perform set_config('request.jwt.claims', '{}', false);
  execute 'set role authenticated';
end;
$$ language plpgsql;

-- Captures the message of an expected failure so an assertion can prove what the
-- message does NOT contain. Runs under whatever role is current, and its own
-- BEGIN/EXCEPTION subtransaction rolls back anything the failed statement attempted.
create function tests.error_message(p_sql text) returns text as $$
begin
  execute p_sql;
  return '(no error was raised)';
exception when others then
  return sqlerrm;
end;
$$ language plpgsql;

-- The whole payload a PostgREST caller actually receives for a failed RPC: the primary
-- message plus DETAIL and HINT. `sqlerrm` alone is NOT that payload, and the difference
-- matters here: a foreign-key failure puts the offending key VALUE in DETAIL, so
-- asserting on the message only would miss exactly the identifier leak these assertions
-- exist to catch. Diagnostic CONTEXT is deliberately excluded — PostgREST does not
-- return it — and is asserted separately below.
create function tests.error_payload(p_sql text) returns text as $$
declare v_detail text; v_hint text;
begin
  execute p_sql;
  return '(no error was raised)';
exception when others then
  get stacked diagnostics v_detail = pg_exception_detail, v_hint = pg_exception_hint;
  return sqlerrm || ' [detail] ' || coalesce(v_detail, '') || ' [hint] ' || coalesce(v_hint, '');
end;
$$ language plpgsql;

-- The diagnostic CONTEXT of an expected failure. A caller never sees it, but it reaches
-- server logs and anything configured to forward them, so it must not name an identity
-- relation, a constraint or an identifier either. It unavoidably names the function the
-- caller invoked and this helper's own frame; neither is a leak and neither is asserted
-- against.
create function tests.error_context(p_sql text) returns text as $$
declare v_context text;
begin
  execute p_sql;
  return '(no error was raised)';
exception when others then
  get stacked diagnostics v_context = pg_exception_context;
  return coalesce(v_context, '');
end;
$$ language plpgsql;

-- ---------------------------------------------------------------------------------
-- §1 ensure_my_profile — the only new operation that creates or resolves a Profile
--
-- ADR-0025 Decision 16: it creates a Profile and its account link and NOTHING else.
-- ---------------------------------------------------------------------------------

select tests.act_as('10000000-0000-0000-0000-000000000001');

select lives_ok(
  $$ select set_config('tests.a1_profile_id', (public.ensure_my_profile()).id::text, false) $$,
  'ensure_my_profile succeeds for a fresh authenticated account'
);

select isnt(
  current_setting('tests.a1_profile_id'),
  '10000000-0000-0000-0000-000000000001',
  'Profile.id is an application-owned UUID and is never the auth.users.id'
);

select is(
  (select count(*)::int from public.account_profile_links
   where account_id = '10000000-0000-0000-0000-000000000001'),
  1,
  'exactly one account_profile_links row exists for the account'
);

select is(
  (select (public.ensure_my_profile()).id::text),
  current_setting('tests.a1_profile_id'),
  'a repeat call returns the same stable Profile UUID'
);

select is(
  (select count(*)::int from public.account_profile_links
   where account_id = '10000000-0000-0000-0000-000000000001'),
  1,
  'still exactly one link row after the repeat call — no second Profile was created'
);

select is(
  (select (public.ensure_my_profile()).display_name),
  null,
  'the resolved Profile is bare: display_name is NULL, not a fabricated placeholder'
);

-- The four facts a bare Profile must NOT carry (specification §3.4).
select tests.reset_to_owner();
select is(
  (select count(*)::int from public.athletes),
  0,
  'ensure_my_profile creates no Athlete capability'
);
select is(
  (select count(*)::int from public.profile_entitlements),
  0,
  'ensure_my_profile creates no entitlement'
);
select is(
  (select count(*)::int from public.legal_acceptances),
  0,
  'ensure_my_profile creates no legal acceptance'
);
select is(
  (select count(*)::int from public.profile_onboarding),
  0,
  'ensure_my_profile creates no onboarding completion'
);

select tests.act_as('10000000-0000-0000-0000-000000000001');
select is(
  (select (public.get_my_gate_state()).onboarding_completed_at),
  null,
  'a bare Profile has no onboarding completion timestamp in its derived gate state'
);
select is(
  (select (public.get_my_gate_state()).has_athlete_capability),
  false,
  'a bare Profile holds no Athlete capability'
);
select is(
  (select (public.get_my_gate_state()).free_entitlement_active),
  false,
  'a bare Profile holds no active Free entitlement'
);
select is(
  (select (public.get_my_gate_state()).profile_id::text),
  current_setting('tests.a1_profile_id'),
  'get_my_gate_state resolves the caller''s own Profile from auth.uid()'
);

-- Fails closed with no resolvable identity.
select tests.act_as_authenticated_without_subject();
select throws_like(
  $$ select public.ensure_my_profile() $$,
  'forbidden:%',
  'ensure_my_profile fails closed when the session carries no resolvable account'
);
select throws_like(
  $$ select public.complete_personal_onboarding('Anyone', gen_random_uuid(), gen_random_uuid()) $$,
  'forbidden:%',
  'complete_personal_onboarding fails closed when the session carries no resolvable account'
);
select is(
  (select (public.get_my_gate_state()).profile_id),
  null,
  'get_my_gate_state returns a NULL Profile — never another account''s — with no resolvable account'
);

-- A NON-NULL subject that names no `auth.users` row: a session token that outlived the
-- account it was minted for. "Some subject is present" and "an authoritative auth
-- account exists" are two different facts, and only the second one may create a
-- Profile. Without the existence check, ensure_my_profile inserts a tentative Profile
-- and then fails on the account link's foreign key to `auth.users`, handing the caller
-- the constraint name, its own account UUID, the failing statement and PL/pgSQL
-- context. The account below is deliberately absent from the seed list above.
select tests.act_as('99999999-9999-9999-9999-999999999999');

select throws_like(
  $$ select public.ensure_my_profile() $$,
  'forbidden:%',
  'ensure_my_profile fails closed when the session subject names no existing auth account'
);
select ok(
  tests.error_payload($$ select public.ensure_my_profile() $$)
    !~ '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
  'the whole client-visible failure payload — message, DETAIL and HINT — echoes back no UUID, neither the supplied account id nor any other'
);
select ok(
  tests.error_payload($$ select public.ensure_my_profile() $$)
    !~* '(violat|constraint|fkey|duplicate key|foreign key|not-null|null value|pg_|relation |table |column |auth\.users|account_profile_links|profiles)',
  'that payload names no constraint, no relation or table, and carries no other SQL detail'
);
select ok(
  tests.error_context($$ select public.ensure_my_profile() $$)
    !~* '(account_profile_links|legal_acceptances|profile_onboarding|profile_entitlements|_fkey|constraint|violat|[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12})',
  'the diagnostic context — which a caller never sees, but a server log does — names no identity relation, no constraint and no identifier'
);

-- Read the consequences under the owning role, so RLS cannot mask a row that was in
-- fact written.
select tests.reset_to_owner();
select is(
  (select count(*)::int from public.account_profile_links
   where account_id = '99999999-9999-9999-9999-999999999999'),
  0,
  'the refused call created no account link for the nonexistent account'
);
select is(
  (select count(*)::int from public.profiles),
  1,
  'the refused call left no orphan Profile behind — only the one Profile created above exists'
);
select is(
  (select count(*)::int from public.legal_acceptances)
    + (select count(*)::int from public.athletes)
    + (select count(*)::int from public.profile_entitlements)
    + (select count(*)::int from public.profile_onboarding),
  0,
  'the refused call produced no acceptance, Athlete, entitlement or onboarding row anywhere'
);

-- Structural: the serialization mechanisms themselves. The genuinely concurrent
-- behaviour is Procedures A, B and C, executed with real independent sessions; these
-- assertions only pin that the locks those procedures rely on are still in the
-- functions, and — for the relation lock, whose ordering a single transaction cannot
-- observe — that they are taken in the right order.
select ok(
  pg_get_functiondef('public.ensure_my_profile()'::regprocedure) like '%pg_advisory_xact_lock%',
  'ensure_my_profile serializes same-account calls on a transaction-scoped advisory lock (genuine concurrency: Procedure A)'
);
select ok(
  pg_get_functiondef('public.ensure_my_profile()'::regprocedure) like '%for key share%',
  'ensure_my_profile holds the authoritative auth account against concurrent deletion for the rest of its transaction'
);
select ok(
  pg_get_functiondef('public.complete_personal_onboarding(text,uuid,uuid)'::regprocedure) like '%pg_advisory_xact_lock%',
  'complete_personal_onboarding serializes same-account calls on a transaction-scoped advisory lock (genuine concurrency: Procedure B)'
);
select ok(
  lower(pg_get_functiondef('public.complete_personal_onboarding(text,uuid,uuid)'::regprocedure)) like '%lock table public.legal_documents in share mode%',
  'complete_personal_onboarding takes a transaction-duration SHARE lock on legal_documents — a real relation lock that conflicts with the ROW EXCLUSIVE every direct INSERT/UPDATE/DELETE there takes, not an advisory lock a rotation could neglect (genuine concurrency: Procedure C)'
);
select is(
  array_length(string_to_array(lower(pg_get_functiondef('public.complete_personal_onboarding(text,uuid,uuid)'::regprocedure)), 'into v_current'), 1) - 1,
  1,
  'exactly ONE statement resolves both current legal document ids — the two separate current-document SELECTs are gone, so the pair can no longer come from two snapshots'
);
select ok(
  strpos(lower(pg_get_functiondef('public.complete_personal_onboarding(text,uuid,uuid)'::regprocedure)), 'lock table public.legal_documents in share mode') > 0
    and strpos(lower(pg_get_functiondef('public.complete_personal_onboarding(text,uuid,uuid)'::regprocedure)), 'lock table public.legal_documents in share mode')
      < strpos(lower(pg_get_functiondef('public.complete_personal_onboarding(text,uuid,uuid)'::regprocedure)), 'into v_current'),
  'the SHARE lock is taken BEFORE the active pair is resolved — resolving first and locking afterwards would protect a snapshot already read'
);
select ok(
  strpos(lower(pg_get_functiondef('public.complete_personal_onboarding(text,uuid,uuid)'::regprocedure)), 'exists (select 1 from public.profile_onboarding') > 0
    and strpos(lower(pg_get_functiondef('public.complete_personal_onboarding(text,uuid,uuid)'::regprocedure)), 'exists (select 1 from public.profile_onboarding')
      < strpos(lower(pg_get_functiondef('public.complete_personal_onboarding(text,uuid,uuid)'::regprocedure)), 'lock table public.legal_documents in share mode'),
  'the completion-first short-circuit is reached BEFORE the Legal lock — a completed Profile''s retry neither waits on an in-flight rotation nor inspects Legal at all'
);

-- The remaining Profiles this suite needs. 0003 deliberately never gets one.
select tests.act_as('10000000-0000-0000-0000-000000000002');
select lives_ok(
  $$ select set_config('tests.a2_profile_id', (public.ensure_my_profile()).id::text, false) $$,
  'a second account resolves its own separate Profile'
);
select tests.act_as('10000000-0000-0000-0000-000000000004');
select lives_ok(
  $$ select set_config('tests.a4_profile_id', (public.ensure_my_profile()).id::text, false) $$,
  'a third account resolves its own separate Profile'
);
select tests.act_as('10000000-0000-0000-0000-000000000005');
select lives_ok(
  $$ select set_config('tests.a5_profile_id', (public.ensure_my_profile()).id::text, false) $$,
  'a fourth account resolves its own separate Profile'
);
-- Catalog-wide count: `profiles_select` narrows an authenticated read to the caller's
-- own row plus active teammates', so this must be read under the owning role or it
-- would assert 1 and pass for entirely the wrong reason.
select tests.reset_to_owner();
select is(
  (select count(distinct id)::int from public.profiles),
  4,
  'four accounts produced four distinct Profiles, and no Profile was created for the fifth account'
);

-- ---------------------------------------------------------------------------------
-- §2 The safe-URL database constraint (defence in depth)
--
-- ADR-0025 Decision 17 fixes the exact boundary. These are direct owner-role inserts,
-- so a raw `check constraint` message is the expected and correct outcome — the
-- normalized-error rule applies to RPC boundaries, not to a schema constraint that no
-- browser role can ever reach. Matching the constraint NAME proves the rejection came
-- from the URL rule and not from some unrelated failure.
--
-- This constraint is NOT a URL parser and is not claimed to be one: a percent-encoded
-- control character passes here and is rejected by the later TypeScript mapper, which
-- stays the load-bearing check.
-- ---------------------------------------------------------------------------------

select tests.reset_to_owner();

select lives_ok(
  $$ insert into public.legal_documents (kind, version_label, document_url, effective_at)
     values ('terms_of_service', 'tos-fixture',
             'https://example.invalid/legal/terms-fixture', now()) $$,
  'an ordinary absolute HTTPS URL is accepted'
);

select throws_like(
  $$ insert into public.legal_documents (kind, version_label, document_url, effective_at)
     values ('privacy_notice', 'reject-http', 'http://example.invalid/legal/x', now()) $$,
  '%legal_documents_url_safe%',
  'a plain http:// URL is rejected'
);
select throws_like(
  $$ insert into public.legal_documents (kind, version_label, document_url, effective_at)
     values ('privacy_notice', 'reject-js', 'javascript:alert(1)', now()) $$,
  '%legal_documents_url_safe%',
  'a javascript: URL is rejected'
);
select throws_like(
  $$ insert into public.legal_documents (kind, version_label, document_url, effective_at)
     values ('privacy_notice', 'reject-data', 'data:text/html,<b>x</b>', now()) $$,
  '%legal_documents_url_safe%',
  'a data: URL is rejected'
);
select throws_like(
  $$ insert into public.legal_documents (kind, version_label, document_url, effective_at)
     values ('privacy_notice', 'reject-blob', 'blob:https://example.invalid/abc', now()) $$,
  '%legal_documents_url_safe%',
  'a blob: URL is rejected'
);
select throws_like(
  $$ insert into public.legal_documents (kind, version_label, document_url, effective_at)
     values ('privacy_notice', 'reject-file', 'file:///etc/passwd', now()) $$,
  '%legal_documents_url_safe%',
  'a file: URL is rejected'
);
select throws_like(
  $$ insert into public.legal_documents (kind, version_label, document_url, effective_at)
     values ('privacy_notice', 'reject-protocol-relative', '//example.invalid/legal/x', now()) $$,
  '%legal_documents_url_safe%',
  'a protocol-relative //host URL is rejected'
);
select throws_like(
  $$ insert into public.legal_documents (kind, version_label, document_url, effective_at)
     values ('privacy_notice', 'reject-credentials', 'https://user:pass@example.invalid/legal/x', now()) $$,
  '%legal_documents_url_safe%',
  'credentials in the authority are rejected'
);
select throws_like(
  $$ insert into public.legal_documents (kind, version_label, document_url, effective_at)
     values ('privacy_notice', 'reject-space', 'https://example.invalid/leg al', now()) $$,
  '%legal_documents_url_safe%',
  'embedded whitespace is rejected'
);
select throws_like(
  $$ insert into public.legal_documents (kind, version_label, document_url, effective_at)
     values ('privacy_notice', 'reject-control', 'https://example.invalid/a' || chr(1) || 'b', now()) $$,
  '%legal_documents_url_safe%',
  'an embedded control character is rejected'
);
select throws_like(
  $$ insert into public.legal_documents (kind, version_label, document_url, effective_at)
     values ('privacy_notice', 'reject-empty-authority', 'https://', now()) $$,
  '%legal_documents_url_safe%',
  'an empty authority is rejected'
);
select throws_like(
  $$ insert into public.legal_documents (kind, version_label, document_url, effective_at)
     values ('privacy_notice', 'reject-empty-authority-slash', 'https:///legal/x', now()) $$,
  '%legal_documents_url_safe%',
  'https:///path — an empty authority followed by a path — is rejected'
);

-- ---------------------------------------------------------------------------------
-- §3 Genuine absence of a current legal document, and legal_unavailable
--
-- ADR-0025 Decision 17: zero rows for a known kind is GENUINE ABSENCE — a normal,
-- expected state, represented by no row for that kind, never by an error and never by
-- a partial row. The gate maps it to `legal_unavailable` when completion is attempted.
--
-- State right now: `tos-fixture` is the current Terms; there is no current Privacy.
-- ---------------------------------------------------------------------------------

select tests.act_as('10000000-0000-0000-0000-000000000002');

select is(
  (select count(*)::int from public.get_current_legal_documents()),
  1,
  'with no Privacy Notice published, the current-documents read returns one row — absence is no row, not a NULL row'
);
select is(
  (select d.kind from public.get_current_legal_documents() d),
  'terms_of_service',
  'the single returned row is the current Terms of Service'
);
select throws_like(
  $$ select public.complete_personal_onboarding('Negative Case', gen_random_uuid(), gen_random_uuid()) $$,
  'legal_unavailable:%',
  'completion is refused with legal_unavailable when there is no current Privacy Notice'
);

-- Rotate the fixture Terms out and publish a Privacy Notice instead: now Terms is the
-- absent kind. `tos-fixture` becomes a RETIRED Terms document, reused below to prove
-- the retired/wrong-kind precedence.
select tests.reset_to_owner();
do $$
declare v_id uuid;
begin
  select id into strict v_id
  from public.legal_documents
  where kind = 'terms_of_service' and version_label = 'tos-fixture';
  perform set_config('tests.retired_terms_id', v_id::text, false);
  update public.legal_documents set retired_at = now() where id = v_id;

  insert into public.legal_documents (kind, version_label, document_url, effective_at)
  values ('privacy_notice', 'pn-2026-01', 'https://example.invalid/legal/privacy-2026-01', now());
end;
$$;

select tests.act_as('10000000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.get_current_legal_documents()),
  1,
  'a retired document disappears from the current-documents read'
);
select is(
  (select d.kind from public.get_current_legal_documents() d),
  'privacy_notice',
  'only the current Privacy Notice remains'
);
select throws_like(
  $$ select public.complete_personal_onboarding('Negative Case', gen_random_uuid(), gen_random_uuid()) $$,
  'legal_unavailable:%',
  'completion is refused with legal_unavailable when there is no current Terms of Service'
);

-- Publish the Terms that completes the v1 snapshot, and capture both v1 ids.
select tests.reset_to_owner();
do $$
declare v_terms uuid; v_privacy uuid;
begin
  insert into public.legal_documents (kind, version_label, document_url, effective_at)
  values ('terms_of_service', 'tos-2026-01', 'https://example.invalid/legal/terms-2026-01', now());

  select id into strict v_terms
  from public.legal_documents
  where kind = 'terms_of_service' and version_label = 'tos-2026-01';
  select id into strict v_privacy
  from public.legal_documents
  where kind = 'privacy_notice' and version_label = 'pn-2026-01';

  perform set_config('tests.v1_terms_id', v_terms::text, false);
  perform set_config('tests.v1_privacy_id', v_privacy::text, false);
end;
$$;

select tests.act_as('10000000-0000-0000-0000-000000000002');
select is(
  (select count(*)::int from public.get_current_legal_documents()),
  2,
  'both current legal documents are returned from one statement snapshot'
);
select is(
  (select array_agg(d.kind order by d.kind)::text from public.get_current_legal_documents() d),
  '{privacy_notice,terms_of_service}',
  'the snapshot carries exactly the two known kinds'
);
select is(
  (select count(*)::int
   from (select d.id, d.kind, d.version_label, d.document_url, d.effective_at
         from public.get_current_legal_documents() d) narrow),
  2,
  'all five documented fields — id, kind, version_label, document_url, effective_at — are selectable from the current-documents read (its declared shape is pinned structurally in §15)'
);
select throws_like(
  $$ select count(*) from public.legal_documents $$,
  '%permission denied%',
  'an authenticated client cannot read legal_documents directly — the RPC is the only path'
);

select tests.act_as_anon();
select throws_like(
  $$ select count(*) from public.legal_documents $$,
  '%permission denied%',
  'a signed-out client cannot read legal_documents directly either'
);
select lives_ok(
  $$ select count(*) from public.get_current_legal_documents() $$,
  'a signed-out client CAN read the current legal documents through the RPC — the sign-in surface needs them'
);

-- ---------------------------------------------------------------------------------
-- §4 complete_personal_onboarding with no Profile — profile_required, zero writes
--
-- There is no Profile-creation fallback inside completion (ADR-0025 Decision 16).
-- ---------------------------------------------------------------------------------

select tests.act_as('10000000-0000-0000-0000-000000000003');
select throws_like(
  $$ select public.complete_personal_onboarding('No Profile',
       current_setting('tests.v1_terms_id')::uuid,
       current_setting('tests.v1_privacy_id')::uuid) $$,
  'profile_required:%',
  'completion is refused with profile_required when the account has no Profile'
);
select is(
  (select count(*)::int from public.account_profile_links
   where account_id = '10000000-0000-0000-0000-000000000003'),
  0,
  'the refused call created no Profile and no account link'
);

select tests.reset_to_owner();
select is(
  (select count(*)::int from public.profiles),
  4,
  'the refused call left the Profile count unchanged'
);
select is(
  (select count(*)::int from public.legal_acceptances)
    + (select count(*)::int from public.athletes)
    + (select count(*)::int from public.profile_entitlements)
    + (select count(*)::int from public.profile_onboarding),
  0,
  'the refused call produced no acceptance, no Athlete, no entitlement and no completion'
);

-- ---------------------------------------------------------------------------------
-- §5 Display-name validation — checked only for a genuinely incomplete Profile
-- ---------------------------------------------------------------------------------

select tests.act_as('10000000-0000-0000-0000-000000000002');

select throws_like(
  $$ select public.complete_personal_onboarding(null,
       current_setting('tests.v1_terms_id')::uuid,
       current_setting('tests.v1_privacy_id')::uuid) $$,
  'invalid_input:%',
  'a NULL display name is refused'
);
select throws_like(
  $$ select public.complete_personal_onboarding('',
       current_setting('tests.v1_terms_id')::uuid,
       current_setting('tests.v1_privacy_id')::uuid) $$,
  'invalid_input:%',
  'a blank display name is refused'
);
select throws_like(
  $$ select public.complete_personal_onboarding('     ',
       current_setting('tests.v1_terms_id')::uuid,
       current_setting('tests.v1_privacy_id')::uuid) $$,
  'invalid_input:%',
  'a whitespace-only display name is refused'
);
select throws_like(
  $$ select public.complete_personal_onboarding(repeat('a', 81),
       current_setting('tests.v1_terms_id')::uuid,
       current_setting('tests.v1_privacy_id')::uuid) $$,
  'invalid_input:%',
  'an oversized display name is refused'
);
-- ---------------------------------------------------------------------------------
-- §6 Supplied legal-id validation, and the retired/stale precedence
--
-- Precedence, stated once in the functions migration and asserted here:
--   NULL / duplicate / unknown / WRONG-KIND  -> invalid_input
--   CORRECT-KIND but no longer the current row -> stale_legal_version
--
-- The second rule is what makes a rotation recoverable: the user must be shown, and
-- must accept, the new version afresh — which is a different remedy from "your input
-- was malformed", so it must be a different code.
-- ---------------------------------------------------------------------------------

select throws_like(
  $$ select public.complete_personal_onboarding('Negative Case',
       null, current_setting('tests.v1_privacy_id')::uuid) $$,
  'invalid_input:%',
  'a NULL Terms document id is refused'
);
select throws_like(
  $$ select public.complete_personal_onboarding('Negative Case',
       current_setting('tests.v1_terms_id')::uuid, null) $$,
  'invalid_input:%',
  'a NULL Privacy document id is refused'
);
select throws_like(
  $$ select public.complete_personal_onboarding('Negative Case',
       '11111111-2222-3333-4444-555555555555'::uuid,
       current_setting('tests.v1_privacy_id')::uuid) $$,
  'invalid_input:%',
  'a forged/unknown Terms document id is refused'
);
select throws_like(
  $$ select public.complete_personal_onboarding('Negative Case',
       current_setting('tests.v1_terms_id')::uuid,
       '11111111-2222-3333-4444-555555555555'::uuid) $$,
  'invalid_input:%',
  'a forged/unknown Privacy document id is refused'
);
select throws_like(
  $$ select public.complete_personal_onboarding('Negative Case',
       current_setting('tests.v1_privacy_id')::uuid,
       current_setting('tests.v1_privacy_id')::uuid) $$,
  'invalid_input:%',
  'the current Privacy id supplied in the Terms slot is refused as wrong-kind'
);
select throws_like(
  $$ select public.complete_personal_onboarding('Negative Case',
       current_setting('tests.v1_terms_id')::uuid,
       current_setting('tests.v1_terms_id')::uuid) $$,
  'invalid_input:%',
  'the current Terms id supplied in the Privacy slot is refused as wrong-kind'
);
select throws_like(
  $$ select public.complete_personal_onboarding('Negative Case',
       current_setting('tests.v1_terms_id')::uuid,
       current_setting('tests.retired_terms_id')::uuid) $$,
  'invalid_input:%',
  'a RETIRED Terms document supplied in the Privacy slot is refused as wrong-kind — kind precedence is unconditional'
);
select throws_like(
  $$ select public.complete_personal_onboarding('Negative Case',
       current_setting('tests.retired_terms_id')::uuid,
       current_setting('tests.v1_privacy_id')::uuid) $$,
  'stale_legal_version:%',
  'a RETIRED Terms document supplied in the Terms slot is refused as a stale version, not as malformed input'
);

-- Duplicate supply is refused before any kind lookup, so it cannot be mistaken for a
-- wrong-kind outcome.
select throws_like(
  $$ select public.complete_personal_onboarding('Negative Case',
       '11111111-2222-3333-4444-555555555555'::uuid,
       '11111111-2222-3333-4444-555555555555'::uuid) $$,
  'invalid_input:%',
  'supplying one id for both kinds is refused'
);

-- Expected failures must not leak database internals or another Profile's identifiers.
select ok(
  tests.error_payload(
    $$ select public.complete_personal_onboarding('Negative Case',
         '11111111-2222-3333-4444-555555555555'::uuid,
         current_setting('tests.v1_privacy_id')::uuid) $$
  ) !~* '(violat|constraint|duplicate key|foreign key|null value|pg_|relation "|column ")',
  'an invalid_input failure leaks no constraint name, SQL detail or internal row wording'
);
select ok(
  tests.error_payload(
    $$ select public.complete_personal_onboarding('Negative Case',
         current_setting('tests.retired_terms_id')::uuid,
         current_setting('tests.v1_privacy_id')::uuid) $$
  ) !~ '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}',
  'a stale_legal_version failure echoes no UUID back to the caller'
);

select tests.reset_to_owner();
select is(
  (select count(*)::int from public.legal_acceptances)
    + (select count(*)::int from public.athletes)
    + (select count(*)::int from public.profile_entitlements)
    + (select count(*)::int from public.profile_onboarding),
  0,
  'every refused completion so far produced no acceptance, Athlete, entitlement or completion'
);
select is(
  (select display_name from public.profiles where id = current_setting('tests.a2_profile_id')::uuid),
  null,
  'the refused calls never touched the bare Profile''s display name'
);

-- The relation lock, observed for real rather than read out of the source text.
-- `LOCK TABLE ... IN SHARE MODE` is transaction-duration and this whole file is one
-- transaction, so the lock a completion takes is still in `pg_locks` for this backend
-- afterwards. This is the BEFORE reading, and it is what makes the AFTER reading in §7
-- attributable to that one call: every refused completion above did take the lock, and
-- every one of them released it when pgTAP's exception subtransaction rolled back.
select is(
  (select count(*)::int from pg_locks
   where locktype = 'relation'
     and relation = 'public.legal_documents'::regclass
     and mode = 'ShareLock'
     and pid = pg_backend_pid()
     and granted),
  0,
  'this transaction holds no SHARE lock on legal_documents before any completion has succeeded'
);

-- ---------------------------------------------------------------------------------
-- §7 Successful completion on the v1 snapshot
-- ---------------------------------------------------------------------------------

select tests.act_as('10000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.complete_personal_onboarding('  Onboarded Athlete  ',
       current_setting('tests.v1_terms_id')::uuid,
       current_setting('tests.v1_privacy_id')::uuid) $$,
  'completion succeeds for an incomplete Profile with the current legal ids'
);

select is(
  (select (public.get_my_gate_state()).display_name),
  'Onboarded Athlete',
  'the display name is stored trimmed'
);
select ok(
  (select (public.get_my_gate_state()).onboarding_completed_at) is not null,
  'the completion fact now exists'
);
select is(
  (select (public.get_my_gate_state()).has_athlete_capability),
  true,
  'completed onboarding established Athlete capability'
);
select is(
  (select (public.get_my_gate_state()).free_entitlement_active),
  true,
  'completed onboarding established the active default Free entitlement'
);
select is(
  (select (public.get_my_gate_state()).pinned_terms_document_id::text),
  current_setting('tests.v1_terms_id'),
  'the completion pinned the exact Terms document it was justified by'
);
select is(
  (select (public.get_my_gate_state()).pinned_privacy_document_id::text),
  current_setting('tests.v1_privacy_id'),
  'the completion pinned the exact Privacy document it was justified by'
);
select is(
  (select (public.get_my_gate_state()).pinned_terms_version_label),
  'tos-2026-01',
  'the pinned Terms version label is reported'
);
select is(
  (select (public.get_my_gate_state()).pinned_privacy_version_label),
  'pn-2026-01',
  'the pinned Privacy version label is reported'
);

select lives_ok(
  $$ select set_config('tests.a1_terms_acceptance_id',
       (public.get_my_gate_state()).pinned_terms_acceptance_id::text, false) $$,
  'the pinned Terms evidence row id is reported and captured'
);
select lives_ok(
  $$ select set_config('tests.a1_privacy_acceptance_id',
       (public.get_my_gate_state()).pinned_privacy_acknowledgement_id::text, false) $$,
  'the pinned Privacy evidence row id is reported and captured'
);
select lives_ok(
  $$ select set_config('tests.a1_completed_at',
       (public.get_my_gate_state()).onboarding_completed_at::text, false) $$,
  'the completion timestamp is captured for the later idempotence comparison'
);

select tests.reset_to_owner();
-- The AFTER reading of the lock (see the note before §7). The completion returned some
-- statements ago and its evidence rows, Athlete row, entitlement and completion row are
-- all written — and the SHARE lock is still held, which is exactly what "held through
-- validation, evidence creation, onboarding completion, and transaction end" means. An
-- owner-operated Legal rotation from another session would be blocked right now; that
-- is Procedure C, ordering 1.
select is(
  (select count(*)::int from pg_locks
   where locktype = 'relation'
     and relation = 'public.legal_documents'::regclass
     and mode = 'ShareLock'
     and pid = pg_backend_pid()
     and granted),
  1,
  'the successful completion took a transaction-duration SHARE lock on legal_documents and still holds it after returning'
);
select is(
  (select count(*)::int from public.legal_acceptances
   where profile_id = current_setting('tests.a1_profile_id')::uuid),
  2,
  'exactly two legal acceptances were written'
);
select is(
  (select acceptance_action from public.legal_acceptances
   where profile_id = current_setting('tests.a1_profile_id')::uuid
     and document_kind = 'terms_of_service'),
  'accepted',
  'the Terms evidence records the accepted action'
);
select is(
  (select acceptance_action from public.legal_acceptances
   where profile_id = current_setting('tests.a1_profile_id')::uuid
     and document_kind = 'privacy_notice'),
  'acknowledged',
  'the Privacy evidence records the acknowledged action'
);
select is(
  (select count(*)::int from public.athletes
   where profile_id = current_setting('tests.a1_profile_id')::uuid),
  1,
  'exactly one Athlete row exists for the completed Profile'
);
select is(
  (select count(*)::int from public.profile_entitlements
   where profile_id = current_setting('tests.a1_profile_id')::uuid
     and tier = 'free' and revoked_at is null),
  1,
  'exactly one active Free entitlement exists for the completed Profile'
);
select is(
  (select count(*)::int from public.profile_onboarding
   where profile_id = current_setting('tests.a1_profile_id')::uuid),
  1,
  'exactly one onboarding completion row exists'
);

-- A second Profile completes too, so the cross-Profile RLS assertions below compare
-- two Profiles that both genuinely hold rows in all three readable tables.
select tests.act_as('10000000-0000-0000-0000-000000000004');
select lives_ok(
  $$ select public.complete_personal_onboarding('Other Athlete',
       current_setting('tests.v1_terms_id')::uuid,
       current_setting('tests.v1_privacy_id')::uuid) $$,
  'a second Profile completes onboarding independently'
);

-- ---------------------------------------------------------------------------------
-- §8 Atomic rollback after a deliberate late database failure
--
-- The failure is injected by a trigger created inside THIS transaction and dropped
-- again below. No production test hook, parameter or failure switch exists anywhere in
-- the migrations — introducing one would be a permanent hazard for the sake of a test.
-- ---------------------------------------------------------------------------------

select tests.reset_to_owner();
create function tests.fail_late() returns trigger as $$
begin
  raise exception 'tests_injected: deliberate late failure';
end;
$$ language plpgsql;

create trigger tests_fail_late_on_onboarding
  before insert on public.profile_onboarding
  for each row execute function tests.fail_late();

select tests.act_as('10000000-0000-0000-0000-000000000005');
select throws_like(
  $$ select public.complete_personal_onboarding('Rollback Case',
       current_setting('tests.v1_terms_id')::uuid,
       current_setting('tests.v1_privacy_id')::uuid) $$,
  '%deliberate late failure%',
  'a failure late in the completion transaction aborts the whole call'
);

select tests.reset_to_owner();
select is(
  (select count(*)::int from public.legal_acceptances
   where profile_id = current_setting('tests.a5_profile_id')::uuid),
  0,
  'the aborted completion left no legal acceptance behind'
);
select is(
  (select count(*)::int from public.athletes
   where profile_id = current_setting('tests.a5_profile_id')::uuid),
  0,
  'the aborted completion left no Athlete capability behind'
);
select is(
  (select count(*)::int from public.profile_entitlements
   where profile_id = current_setting('tests.a5_profile_id')::uuid),
  0,
  'the aborted completion left no entitlement behind'
);
select is(
  (select count(*)::int from public.profile_onboarding
   where profile_id = current_setting('tests.a5_profile_id')::uuid),
  0,
  'the aborted completion left no onboarding completion behind'
);
select is(
  (select count(*)::int from public.profiles
   where id = current_setting('tests.a5_profile_id')::uuid),
  1,
  'the pre-existing bare Profile survived the rollback'
);
select is(
  (select display_name from public.profiles
   where id = current_setting('tests.a5_profile_id')::uuid),
  null,
  'the bare Profile''s display name was never written — the Profile update is the last step'
);

drop trigger tests_fail_late_on_onboarding on public.profile_onboarding;
drop function tests.fail_late();

-- ---------------------------------------------------------------------------------
-- §9 Snapshot coupling: an atomic rotation to v2 makes the v1 ids stale
-- ---------------------------------------------------------------------------------

select tests.reset_to_owner();
-- Atomic rotation: both current documents are retired and both replacements inserted
-- inside ONE TRANSACTION — four statements, not one statement — so no OTHER transaction
-- can ever see a half-rotated pair. The partial unique index makes the reverse ordering
-- impossible, which is what forces the retire-then-insert pairing to be transactional
-- rather than conventional. (Being one transaction is not the same claim as being one
-- statement, and it is not on its own enough: it stops a half-rotated pair being
-- committed, but not a reader resolving the two kinds in two statements from straddling
-- the rotation. That second gap is what `complete_personal_onboarding`'s SHARE lock and
-- single-statement resolution close — see §1's structural assertions and Procedure C.)
--
-- Here the DO block runs inside this file's own single transaction, and the SHARE lock
-- §7's completion still holds is this transaction's own, so nothing below waits.
do $$
declare v_terms uuid; v_privacy uuid;
begin
  update public.legal_documents set retired_at = now()
  where id = current_setting('tests.v1_terms_id')::uuid;
  insert into public.legal_documents (kind, version_label, document_url, effective_at)
  values ('terms_of_service', 'tos-2026-02', 'https://example.invalid/legal/terms-2026-02', now());

  update public.legal_documents set retired_at = now()
  where id = current_setting('tests.v1_privacy_id')::uuid;
  insert into public.legal_documents (kind, version_label, document_url, effective_at)
  values ('privacy_notice', 'pn-2026-02', 'https://example.invalid/legal/privacy-2026-02', now());

  select id into strict v_terms from public.legal_documents
  where kind = 'terms_of_service' and version_label = 'tos-2026-02';
  select id into strict v_privacy from public.legal_documents
  where kind = 'privacy_notice' and version_label = 'pn-2026-02';
  perform set_config('tests.v2_terms_id', v_terms::text, false);
  perform set_config('tests.v2_privacy_id', v_privacy::text, false);
end;
$$;

select tests.act_as('10000000-0000-0000-0000-000000000002');
select is(
  (select array_agg(d.version_label order by d.version_label)::text
   from public.get_current_legal_documents() d),
  '{pn-2026-02,tos-2026-02}',
  'after the rotation the current-documents snapshot reports only the v2 versions'
);
select throws_like(
  $$ select public.complete_personal_onboarding('Negative Case',
       current_setting('tests.v1_terms_id')::uuid,
       current_setting('tests.v1_privacy_id')::uuid) $$,
  'stale_legal_version:%',
  'submitting the v1 ids after the rotation is refused as a stale version'
);

select tests.reset_to_owner();
select is(
  (select count(*)::int from public.profile_onboarding
   where profile_id = current_setting('tests.a2_profile_id')::uuid),
  0,
  'the refused v1 submission created no onboarding row'
);
select is(
  (select count(*)::int from public.legal_acceptances
   where profile_id = current_setting('tests.a2_profile_id')::uuid),
  0,
  'the refused v1 submission created no acceptance at all — including none referencing v2'
);
select is(
  (select count(*)::int from public.legal_acceptances
   where legal_document_id in (
     current_setting('tests.v2_terms_id')::uuid,
     current_setting('tests.v2_privacy_id')::uuid)),
  0,
  'no acceptance anywhere references a v2 document as a consequence of the failed v1 submission'
);

select tests.act_as('10000000-0000-0000-0000-000000000002');
select lives_ok(
  $$ select public.complete_personal_onboarding('Negative Case',
       current_setting('tests.v2_terms_id')::uuid,
       current_setting('tests.v2_privacy_id')::uuid) $$,
  'submitting ids from a fresh v2 snapshot succeeds'
);
select is(
  (select (public.get_my_gate_state()).pinned_terms_document_id::text),
  current_setting('tests.v2_terms_id'),
  'the fresh completion pinned the v2 Terms document'
);
select is(
  (select (public.get_my_gate_state()).pinned_privacy_document_id::text),
  current_setting('tests.v2_privacy_id'),
  'the fresh completion pinned the v2 Privacy document'
);

-- ---------------------------------------------------------------------------------
-- §10 Completion-first idempotence across a legal rotation
--
-- The scenario is a LOST RESPONSE: the first completion succeeded server-side, the
-- client never saw the answer, the legal documents rotated in between, and the client
-- retries its original payload. ADR-0025 Decision 16 requires zero writes and the
-- winner's immutable state.
-- ---------------------------------------------------------------------------------

select tests.act_as('10000000-0000-0000-0000-000000000001');
select lives_ok(
  $$ select public.complete_personal_onboarding('  Onboarded Athlete  ',
       current_setting('tests.v1_terms_id')::uuid,
       current_setting('tests.v1_privacy_id')::uuid) $$,
  'the retried original payload succeeds through the completion-first short-circuit, even though its v1 ids are now stale'
);
select is(
  (select (public.get_my_gate_state()).display_name),
  'Onboarded Athlete',
  'the display name is unchanged by the retry'
);
select is(
  (select (public.get_my_gate_state()).onboarding_completed_at::text),
  current_setting('tests.a1_completed_at'),
  'the completion timestamp is unchanged by the retry'
);
select is(
  (select (public.get_my_gate_state()).pinned_terms_acceptance_id::text),
  current_setting('tests.a1_terms_acceptance_id'),
  'the pinned Terms evidence row is unchanged by the retry'
);
select is(
  (select (public.get_my_gate_state()).pinned_privacy_acknowledgement_id::text),
  current_setting('tests.a1_privacy_acceptance_id'),
  'the pinned Privacy evidence row is unchanged by the retry'
);
select is(
  (select (public.get_my_gate_state()).pinned_terms_version_label),
  'tos-2026-01',
  'the pinned Terms version still reports v1 — a later version never rewrites it'
);
select is(
  (select (public.get_my_gate_state()).current_terms_version_label),
  'tos-2026-02',
  'the reporting-only current Terms field shows v2 alongside the unchanged pinned v1'
);
select is(
  (select (public.get_my_gate_state()).current_privacy_version_label),
  'pn-2026-02',
  'the reporting-only current Privacy field shows v2 alongside the unchanged pinned v1'
);

-- A second retry with a different display name AND invalid legal ids must also be a
-- complete no-op: the completion-first check runs before any of it is inspected.
select lives_ok(
  $$ select public.complete_personal_onboarding('Renamed Athlete',
       '11111111-2222-3333-4444-555555555555'::uuid,
       '11111111-2222-3333-4444-555555555555'::uuid) $$,
  'a later retry with a different display name and forged, duplicated legal ids is also accepted as a no-op'
);
select is(
  (select (public.get_my_gate_state()).display_name),
  'Onboarded Athlete',
  'the retry did not rename the Profile'
);
select is(
  (select (public.get_my_gate_state()).pinned_terms_document_id::text),
  current_setting('tests.v1_terms_id'),
  'the retry did not repin the completion to anything'
);

select tests.reset_to_owner();
select is(
  (select count(*)::int from public.legal_acceptances
   where profile_id = current_setting('tests.a1_profile_id')::uuid),
  2,
  'the retries added no acceptance — still exactly two'
);
select is(
  (select count(*)::int from public.athletes
   where profile_id = current_setting('tests.a1_profile_id')::uuid),
  1,
  'the retries added no second Athlete row'
);
select is(
  (select count(*)::int from public.profile_entitlements
   where profile_id = current_setting('tests.a1_profile_id')::uuid),
  1,
  'the retries added no second entitlement row'
);
select is(
  (select count(*)::int from public.profile_onboarding
   where profile_id = current_setting('tests.a1_profile_id')::uuid),
  1,
  'the retries added no second onboarding row'
);

-- ---------------------------------------------------------------------------------
-- §11 Evidence pinning rejects wrong-Profile, wrong-kind and wrong-action evidence
--
-- These are direct owner-role inserts, because the invariant must hold at the SCHEMA
-- boundary and not merely because the one RPC that writes it happens to be careful.
-- Two evidence rows are seeded for the still-incomplete Profile 0005 so the wrong-kind
-- case can be isolated from the wrong-Profile case.
-- ---------------------------------------------------------------------------------

select tests.reset_to_owner();
do $$
declare v_terms_acc uuid; v_privacy_acc uuid;
begin
  insert into public.legal_acceptances (profile_id, legal_document_id, document_kind, acceptance_action)
  values (current_setting('tests.a5_profile_id')::uuid,
          current_setting('tests.v2_terms_id')::uuid, 'terms_of_service', 'accepted')
  returning id into v_terms_acc;

  insert into public.legal_acceptances (profile_id, legal_document_id, document_kind, acceptance_action)
  values (current_setting('tests.a5_profile_id')::uuid,
          current_setting('tests.v2_privacy_id')::uuid, 'privacy_notice', 'acknowledged')
  returning id into v_privacy_acc;

  perform set_config('tests.a5_terms_acceptance_id', v_terms_acc::text, false);
  perform set_config('tests.a5_privacy_acceptance_id', v_privacy_acc::text, false);
end;
$$;

select throws_like(
  $$ insert into public.profile_onboarding (profile_id, terms_acceptance_id, privacy_acknowledgement_id)
     values (current_setting('tests.a5_profile_id')::uuid,
             current_setting('tests.a1_terms_acceptance_id')::uuid,
             current_setting('tests.a5_privacy_acceptance_id')::uuid) $$,
  '%profile_onboarding_terms_evidence_fk%',
  'pinning another Profile''s Terms evidence is rejected by the composite foreign key'
);
select throws_like(
  $$ insert into public.profile_onboarding (profile_id, terms_acceptance_id, privacy_acknowledgement_id)
     values (current_setting('tests.a5_profile_id')::uuid,
             current_setting('tests.a5_privacy_acceptance_id')::uuid,
             current_setting('tests.a5_privacy_acceptance_id')::uuid) $$,
  '%profile_onboarding_terms_evidence_fk%',
  'pinning a Privacy acceptance into the Terms slot is rejected by the composite foreign key'
);
select throws_like(
  $$ insert into public.profile_onboarding
       (profile_id, terms_acceptance_id, terms_acceptance_action, privacy_acknowledgement_id)
     values (current_setting('tests.a5_profile_id')::uuid,
             current_setting('tests.a5_terms_acceptance_id')::uuid,
             'acknowledged',
             current_setting('tests.a5_privacy_acceptance_id')::uuid) $$,
  '%profile_onboarding_terms_acceptance_action_check%',
  'pinning the wrong ACTION for the Terms slot is rejected by the fixed-value check constraint'
);
select throws_like(
  $$ insert into public.legal_acceptances (profile_id, legal_document_id, document_kind, acceptance_action)
     values (current_setting('tests.a2_profile_id')::uuid,
             current_setting('tests.v2_terms_id')::uuid, 'terms_of_service', 'acknowledged') $$,
  '%legal_acceptances_action_matches_kind%',
  'an acceptance row cannot record the wrong action for its document kind in the first place'
);
-- Profile 0001 accepted the v1 pair, so (0001, v2 terms) is a fresh pair: the row gets
-- past `legal_acceptances_one_per_profile_document` and is rejected by the composite
-- kind foreign key, which is the invariant under test.
select throws_like(
  $$ insert into public.legal_acceptances (profile_id, legal_document_id, document_kind, acceptance_action)
     values (current_setting('tests.a1_profile_id')::uuid,
             current_setting('tests.v2_terms_id')::uuid, 'privacy_notice', 'acknowledged') $$,
  '%legal_acceptances_document_fk%',
  'an acceptance row cannot claim a document kind the referenced document does not have'
);
select is(
  (select count(*)::int from public.profile_onboarding
   where profile_id = current_setting('tests.a5_profile_id')::uuid),
  0,
  'none of the rejected pinning attempts created an onboarding row'
);

-- ---------------------------------------------------------------------------------
-- §12 Append-only evidence and completion
--
-- Triggers are defence in depth for ordinary owner-operated application paths. They are
-- not, and are not claimed to be, protection against a superuser altering the schema.
-- ---------------------------------------------------------------------------------

select throws_like(
  $$ update public.legal_acceptances set accepted_at = now()
     where id = current_setting('tests.a1_terms_acceptance_id')::uuid $$,
  'conflict:%',
  'legal_acceptances refuses UPDATE'
);
select throws_like(
  $$ delete from public.legal_acceptances
     where id = current_setting('tests.a1_terms_acceptance_id')::uuid $$,
  'conflict:%',
  'legal_acceptances refuses DELETE'
);
select throws_like(
  $$ update public.profile_onboarding set completed_at = now()
     where profile_id = current_setting('tests.a1_profile_id')::uuid $$,
  'conflict:%',
  'profile_onboarding refuses UPDATE'
);
select throws_like(
  $$ delete from public.profile_onboarding
     where profile_id = current_setting('tests.a1_profile_id')::uuid $$,
  'conflict:%',
  'profile_onboarding refuses DELETE'
);

-- ---------------------------------------------------------------------------------
-- §13 Legal-document lifecycle: one-way retirement, refused deletion, atomic rotation
--
-- Ordered so that the assertions needing an ACTIVE row run before the one that retires
-- it. Current state on entry: `tos-2026-02` and `pn-2026-02` are both active.
-- ---------------------------------------------------------------------------------

select throws_like(
  $$ insert into public.legal_documents (kind, version_label, document_url, effective_at)
     values ('privacy_notice', 'pn-2026-03', 'https://example.invalid/legal/privacy-2026-03', now()) $$,
  '%legal_documents_one_active_per_kind%',
  'a second ACTIVE version of one kind is refused'
);
select throws_like(
  $$ update public.legal_documents
     set retired_at = now(), version_label = 'pn-tampered'
     where id = current_setting('tests.v2_privacy_id')::uuid $$,
  'conflict:%',
  'changing another column during retirement is refused'
);
select throws_like(
  $$ delete from public.legal_documents
     where id = current_setting('tests.v2_privacy_id')::uuid $$,
  'conflict:%',
  'DELETE of a legal document version is refused — corrections are new version rows'
);

-- A rotation whose replacement insert fails must roll the retirement back with it. The
-- subtransaction below is exactly the atomicity the owner-operated rotation relies on.
do $$
begin
  begin
    update public.legal_documents set retired_at = now()
    where id = current_setting('tests.v2_privacy_id')::uuid;

    -- Fails: `pn-2026-02` already exists for this kind (unique (kind, version_label)).
    insert into public.legal_documents (kind, version_label, document_url, effective_at)
    values ('privacy_notice', 'pn-2026-02', 'https://example.invalid/legal/privacy-2026-02b', now());
  exception when others then
    null;
  end;
end;
$$;

select is(
  (select retired_at from public.legal_documents
   where id = current_setting('tests.v2_privacy_id')::uuid),
  null,
  'a failed replacement insert rolled the retirement back — the prior version is still current'
);
select is(
  (select count(*)::int from public.legal_documents
   where kind = 'privacy_notice' and retired_at is null),
  1,
  'exactly one current Privacy Notice version remains after the failed rotation'
);

select lives_ok(
  $$ update public.legal_documents set retired_at = now()
     where id = current_setting('tests.v2_terms_id')::uuid $$,
  'a single NULL -> timestamp retirement succeeds'
);
select throws_like(
  $$ update public.legal_documents set retired_at = null
     where id = current_setting('tests.v2_terms_id')::uuid $$,
  'conflict:%',
  'unretirement is refused'
);
select throws_like(
  $$ update public.legal_documents set retired_at = now() + interval '1 day'
     where id = current_setting('tests.v2_terms_id')::uuid $$,
  'conflict:%',
  'rewriting the retirement timestamp is refused'
);
select throws_like(
  $$ update public.legal_documents set retired_at = now()
     where id = current_setting('tests.v2_terms_id')::uuid $$,
  'conflict:%',
  'a second retirement update is refused'
);

-- ---------------------------------------------------------------------------------
-- §14 Access control: table privileges, RLS, cross-Profile reads, RPC grants
-- ---------------------------------------------------------------------------------

select tests.act_as('10000000-0000-0000-0000-000000000002');

select throws_like(
  $$ insert into public.legal_documents (kind, version_label, document_url, effective_at)
     values ('terms_of_service', 'forged', 'https://example.invalid/legal/forged', now()) $$,
  '%permission denied%',
  'an authenticated client cannot insert a legal document directly'
);
select throws_like(
  $$ insert into public.legal_acceptances (profile_id, legal_document_id, document_kind, acceptance_action)
     values (current_setting('tests.a2_profile_id')::uuid,
             current_setting('tests.v2_privacy_id')::uuid, 'privacy_notice', 'acknowledged') $$,
  '%permission denied%',
  'an authenticated client cannot forge a legal acceptance directly'
);
select throws_like(
  $$ insert into public.profile_onboarding (profile_id, terms_acceptance_id, privacy_acknowledgement_id)
     values (current_setting('tests.a5_profile_id')::uuid,
             current_setting('tests.a5_terms_acceptance_id')::uuid,
             current_setting('tests.a5_privacy_acceptance_id')::uuid) $$,
  '%permission denied%',
  'an authenticated client cannot forge an onboarding completion directly'
);
select throws_like(
  $$ insert into public.profile_entitlements (profile_id, tier)
     values (current_setting('tests.a5_profile_id')::uuid, 'free') $$,
  '%permission denied%',
  'an authenticated client cannot grant itself an entitlement directly'
);
select throws_like(
  $$ insert into public.athletes (profile_id)
     values (current_setting('tests.a5_profile_id')::uuid) $$,
  '%permission denied%',
  'an authenticated client still cannot create an Athlete capability directly'
);
select throws_like(
  $$ update public.profile_entitlements set revoked_at = null
     where profile_id = current_setting('tests.a2_profile_id')::uuid $$,
  '%permission denied%',
  'an authenticated client cannot update its own entitlement row directly'
);
select throws_like(
  $$ delete from public.profile_onboarding
     where profile_id = current_setting('tests.a2_profile_id')::uuid $$,
  '%permission denied%',
  'an authenticated client cannot delete its own onboarding row directly'
);

-- Own reads succeed and are narrowed to the caller's Profile.
select is(
  (select count(*)::int from public.legal_acceptances),
  2,
  'an authenticated caller reads exactly its own two legal acceptances'
);
select is(
  (select count(*)::int from public.profile_onboarding),
  1,
  'an authenticated caller reads exactly its own onboarding row'
);
select is(
  (select count(*)::int from public.profile_entitlements),
  1,
  'an authenticated caller reads exactly its own entitlement row'
);
select is(
  (select count(*)::int from public.legal_acceptances
   where profile_id = current_setting('tests.a1_profile_id')::uuid),
  0,
  'another Profile''s legal acceptances are invisible — zero rows, not an error'
);
select is(
  (select count(*)::int from public.profile_onboarding
   where profile_id = current_setting('tests.a1_profile_id')::uuid),
  0,
  'another Profile''s onboarding row is invisible'
);
select is(
  (select count(*)::int from public.profile_entitlements
   where profile_id = current_setting('tests.a1_profile_id')::uuid),
  0,
  'another Profile''s entitlement row is invisible'
);

-- Signed-out access.
select tests.act_as_anon();
select throws_like(
  $$ select count(*) from public.legal_acceptances $$,
  '%permission denied%',
  'anon cannot read legal_acceptances at all — the ACL rejects it before any policy'
);
select throws_like(
  $$ select count(*) from public.profile_onboarding $$,
  '%permission denied%',
  'anon cannot read profile_onboarding at all'
);
select throws_like(
  $$ select count(*) from public.profile_entitlements $$,
  '%permission denied%',
  'anon cannot read profile_entitlements at all'
);
select throws_like(
  $$ select public.ensure_my_profile() $$,
  '%permission denied%',
  'anon cannot execute ensure_my_profile'
);
select throws_like(
  $$ select public.get_my_gate_state() $$,
  '%permission denied%',
  'anon cannot execute get_my_gate_state'
);
select throws_like(
  $$ select public.complete_personal_onboarding('x', gen_random_uuid(), gen_random_uuid()) $$,
  '%permission denied%',
  'anon cannot execute complete_personal_onboarding'
);

-- ---------------------------------------------------------------------------------
-- §15 Structural boundary assertions (catalog reads — run under the owning role)
--
-- These prove properties the behavioural assertions above cannot see on their own:
-- adding a write grant, an anon SELECT grant, an unpinned search_path, a stored
-- gate-eligible flag or a marketing table would leave every other assertion passing.
-- ---------------------------------------------------------------------------------

select tests.reset_to_owner();

select is(
  (
    select count(*)::int
    from unnest(array['legal_documents', 'legal_acceptances', 'profile_onboarding', 'profile_entitlements']) as t(rel),
         unnest(array['insert', 'update', 'delete']) as p(priv)
    where has_table_privilege('authenticated', 'public.' || rel, priv)
  ),
  0,
  'authenticated holds no INSERT/UPDATE/DELETE on any of the four new tables'
);
select is(
  (
    select count(*)::int
    from unnest(array['legal_documents', 'legal_acceptances', 'profile_onboarding', 'profile_entitlements']) as t(rel),
         unnest(array['select', 'insert', 'update', 'delete']) as p(priv)
    where has_table_privilege('anon', 'public.' || rel, priv)
  ),
  0,
  'anon holds no direct table privilege of any kind on any of the four new tables'
);
select is(
  (
    select count(*)::int
    from unnest(array['legal_acceptances', 'profile_onboarding', 'profile_entitlements']) as t(rel)
    where not has_table_privilege('authenticated', 'public.' || rel, 'select')
  ),
  0,
  'authenticated holds SELECT on the three own-Profile-readable tables, so its reads reach the policies'
);
select is(
  has_table_privilege('authenticated', 'public.legal_documents', 'select'),
  false,
  'authenticated holds no SELECT on legal_documents — that table is RPC-only'
);
select is(
  (
    select count(*)::int
    from unnest(array['legal_documents', 'legal_acceptances', 'profile_onboarding', 'profile_entitlements']) as t(rel)
    where not (select c.relrowsecurity from pg_class c
               join pg_namespace n on n.oid = c.relnamespace
               where n.nspname = 'public' and c.relname = t.rel)
  ),
  0,
  'row level security is enabled on all four new tables'
);
select is(
  (
    select count(*)::int from pg_policies
    where schemaname = 'public'
      and tablename in ('legal_documents', 'legal_acceptances', 'profile_onboarding', 'profile_entitlements')
      and cmd <> 'SELECT'
  ),
  0,
  'no INSERT/UPDATE/DELETE policy exists on any new table — every mutation stays SECURITY DEFINER RPC-only'
);

select is(
  (
    select count(*)::int from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where (
            (n.nspname = 'public' and p.proname in (
              'get_current_legal_documents', 'ensure_my_profile',
              'get_my_gate_state', 'complete_personal_onboarding'))
            or
            (n.nspname = 'private' and p.proname in (
              'legal_documents_guard_update', 'legal_documents_guard_delete',
              'legal_acceptances_guard_write', 'profile_onboarding_guard_write'))
          )
      and (p.proconfig is null or not exists (
        select 1 from unnest(p.proconfig) c where c like 'search_path=%'
      ))
  ),
  0,
  'every function this stage adds pins an explicit search_path'
);
select is(
  (
    select count(*)::int from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname in ('public', 'private')
      and p.prosecdef = true
      and (p.proconfig is null or not exists (
        select 1 from unnest(p.proconfig) c where c like 'search_path=%'
      ))
  ),
  0,
  'every SECURITY DEFINER function in public/private still pins an explicit search_path (Team Foundation included)'
);
select is(
  (
    select count(*)::int from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_current_legal_documents', 'ensure_my_profile',
                        'get_my_gate_state', 'complete_personal_onboarding')
      and (p.proacl is null or exists (select 1 from unnest(p.proacl) a where a::text like '=%'))
  ),
  0,
  'the default PUBLIC execute grant is revoked on every new RPC'
);
select is(
  (
    select count(*)::int
    from unnest(array['ensure_my_profile()', 'get_my_gate_state()',
                      'complete_personal_onboarding(text,uuid,uuid)']) as f(sig)
    where has_function_privilege('anon', 'public.' || sig, 'execute')
  ),
  0,
  'anon holds execute on none of the three identity RPCs'
);
select is(
  has_function_privilege('anon', 'public.get_current_legal_documents()', 'execute'),
  true,
  'anon holds execute on get_current_legal_documents — the one RPC the signed-out surface needs'
);
select is(
  (
    select count(*)::int
    from unnest(array['get_current_legal_documents()', 'ensure_my_profile()', 'get_my_gate_state()',
                      'complete_personal_onboarding(text,uuid,uuid)']) as f(sig)
    where not has_function_privilege('authenticated', 'public.' || sig, 'execute')
  ),
  0,
  'authenticated holds execute on all four new RPCs'
);
select is(
  (
    select count(*)::int from pg_proc p
    join pg_namespace n on n.oid = p.pronamespace
    where n.nspname = 'public'
      and p.proname in ('get_current_legal_documents', 'ensure_my_profile',
                        'get_my_gate_state', 'complete_personal_onboarding')
      and coalesce(array_to_string(p.proargnames, ','), '') ~* '(profile|account|owner|uid|actor)'
  ),
  0,
  'no new RPC accepts a caller-identity parameter — every one derives the caller from auth.uid()'
);
-- `returns table (...)` records its output columns as OUT/TABLE entries in
-- proargnames/proargmodes, not as attributes of a composite return type — so this
-- reads them there. Reverting the function to `returns setof legal_documents` or a
-- `select *` body would change this array and fail here.
select is(
  (
    select array_agg(t.name order by t.name)::text
    from (
      select unnest(p.proargnames) as name, unnest(p.proargmodes) as mode
      from pg_proc p
      where p.pronamespace = 'public'::regnamespace
        and p.proname = 'get_current_legal_documents'
    ) t
    where t.mode = 't'
  ),
  '{document_url,effective_at,id,kind,version_label}',
  'get_current_legal_documents declares exactly the five-field narrow return shape, never select *'
);

select is(
  (
    select count(*)::int from pg_class c
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relname = 'marketing_consents'
  ),
  0,
  'no marketing_consents relation exists — B0.2 collects no Marketing Consent, and absence never means consent'
);
select is(
  (
    select count(*)::int from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not a.attisdropped
      and a.attname ~* '(gate_eligible|is_gate|can_access)'
  ),
  0,
  'no stored gate-eligible flag exists anywhere — gate eligibility is derived'
);
select is(
  (
    select count(*)::int from pg_attribute a
    join pg_class c on c.oid = a.attrelid
    join pg_namespace n on n.oid = c.relnamespace
    where n.nspname = 'public' and c.relkind = 'r' and not a.attisdropped
      and c.relname in ('legal_documents', 'legal_acceptances', 'profile_onboarding', 'profile_entitlements')
      and a.attname ~* '(auth_uid|auth_user_id|account_id|user_id|role|account_type)'
  ),
  0,
  'no new table carries a Profile-to-auth-id shortcut or a role/account-type column'
);
select is(
  (
    select count(*)::int from public.legal_documents
    where document_url !~ '^https://example\.invalid/'
  ),
  0,
  'every legal fixture in this suite is a fictional example.invalid URL — no real legal URL is authored anywhere'
);

select * from finish();
rollback;

-- ---------------------------------------------------------------------------------
-- Multi-session concurrency verification
--
-- pgTAP runs single-threaded inside one transaction and cannot make one backend block
-- on a lock another backend holds. The procedures below are therefore NOT executed by
-- this file or by any automated process in this repository; they are run by hand,
-- against a real local database, with independent concurrent `psql` connections and a
-- further connection observing `pg_stat_activity` and `pg_locks`.
--
-- EXECUTED. All three procedures have been run against the local Supabase Postgres in
-- this state of the working tree, with genuinely concurrent, independent `psql`
-- sessions. Every line marked "OBSERVED" is the actual recorded result, with the actual
-- backend pids, UUIDs, version labels, timestamps and durations that run produced — not
-- an expectation, and not carried over from an earlier pass. In every case the blocked
-- session was confirmed to be waiting on a lock rather than merely being slow, and each
-- blocked statement returned only after the holding session committed. Final state was
-- read back from a separate connection after all sessions had finished.
--
-- Setup common to all three: `auth.users` rows and (for B and C) current legal rows are
-- inserted and COMMITTED by the migration-owning role beforehand. Each application
-- session authenticates with
--   select set_config('request.jwt.claims',
--     json_build_object('sub', <account>, 'role', 'authenticated')::text, false);
--   set role authenticated;
-- and each owner-operated session runs as the migration-owning role with no claims set.
-- Legal fixtures here are the same fictional `example.invalid` metadata the suite above
-- uses; no real legal document, copy or production URL is involved.
--
-- Procedure A — concurrent ensure_my_profile for one account:
--   Fixture: `auth.users` row a0000000-0000-0000-0000-00000000000a, no Profile.
--   1. Session 1: begin; select (public.ensure_my_profile()).id; — the statement
--      RETURNS, having taken pg_advisory_xact_lock(hashtext('ensure_my_profile:' ||
--      uid)) and created the Profile and its link. The lock is now held for the rest of
--      session 1's still-open transaction. Do NOT commit yet.
--      OBSERVED: call started 08:25:45.234209+00 and returned Profile
--      f94e6f90-6bf4-4e1d-bd31-8d9a9a828c2b.
--   2. Session 2 (same account): begin; select (public.ensure_my_profile()).id; — this
--      call must BLOCK on that advisory lock, not error and not return.
--      OBSERVED: call started 08:25:47.239578+00.
--   3. Session 3: confirm the wait is a genuine lock wait, not slowness:
--        select pid, wait_event_type, wait_event, state, left(query, 55)
--        from pg_stat_activity where state = 'active' and wait_event_type = 'Lock';
--        select locktype, mode, granted, objid, pid from pg_locks
--        where locktype = 'advisory' order by granted desc, pid;
--      OBSERVED: exactly one waiting row — pid 349, state 'active', wait_event_type
--      'Lock', wait_event 'advisory', query `select (public.ensure_my_profile()).id as
--      s2_profile;`. pg_locks showed the same advisory key objid 2001405470 twice:
--      ExclusiveLock granted = t for pid 347 (session 1) and granted = f for pid 349
--      (session 2). Session 2 was waiting on the lock, not merely slow.
--   4. Commit session 1. Session 2 unblocks and completes.
--      OBSERVED: session 1 committed at 08:25:55.239265+00. Session 2 returned WITHOUT
--      error at 08:25:55.246892+00 — blocked 8.007s, ending exactly when session 1
--      committed — and returned the SAME Profile UUID
--      f94e6f90-6bf4-4e1d-bd31-8d9a9a828c2b. Under READ COMMITTED its post-lock select
--      saw session 1's committed link, so it took the "already linked" branch and
--      created nothing.
--   5. Confirm from a separate connection after both finish.
--      OBSERVED: exactly one `public.profiles` row and exactly one
--      `public.account_profile_links` row for that account; zero rows in
--      `public.athletes`, `public.profile_entitlements`, `public.legal_acceptances` and
--      `public.profile_onboarding` — identity was established and nothing else was.
--   6. The `for key share` on the authoritative auth account. Separate fixture:
--      `auth.users` row d0000000-0000-0000-0000-00000000000d, no Profile.
--      Session 1: begin; select (public.ensure_my_profile()).id; — returns, holding the
--      row lock; do NOT commit. Session 2 (owner): delete from auth.users where id =
--      <that account>; — must BLOCK rather than delete the account out from under the
--      in-flight Profile creation.
--      OBSERVED: session 1's call started 08:29:19.648919+00 and returned Profile
--      6e1f68ac-2232-493d-9ac9-dfe4f0ca065e; it committed at 08:29:27.664148+00. The
--      DELETE was attempted at 08:29:21.650605+00 and blocked 00:00:06.029148, with the
--      observing connection showing pid 702, state 'active', wait_event_type 'Lock',
--      wait_event 'transactionid'. When session 1 committed, the DELETE resumed and
--      then FAILED on `account_profile_links_account_id_fkey` — which is the correct end
--      state: the account is now referenced by a committed link and `on delete restrict`
--      refuses. Final state: the `auth.users` row and the link both still exist. There
--      was no instant at which the account could have vanished mid-creation.
--
-- Procedure B — concurrent complete_personal_onboarding for one incomplete Profile:
--   Fixture: the account and bare Profile from Procedure A, plus one current Terms row
--   (`proc-tos-v1`, 3fd64022-74a9-4b49-bcac-de0a5bc18f0e) and one current Privacy row
--   (`proc-pn-v1`, 4baed819-0d1f-4a8c-beee-cf71c43be97e).
--   1. Session 1: begin; select public.complete_personal_onboarding('Winner Name',
--      <current terms id>, <current privacy id>); — the statement RETURNS the completed
--      gate state, holding pg_advisory_xact_lock(hashtext('personal_onboarding:' ||
--      uid)) AND the SHARE lock on public.legal_documents for the rest of its open
--      transaction. Do NOT commit yet.
--      OBSERVED: call started 08:26:28.483383+00 and returned display_name
--      'Winner Name', completed_at 2026-08-26 08:26:28.483314+00,
--      pinned_terms_document_id 3fd64022-74a9-4b49-bcac-de0a5bc18f0e.
--   2. Session 2 (same account, DIFFERENT display name and DIFFERENT — deliberately
--      invalid — legal ids): begin; select public.complete_personal_onboarding(
--      'Loser Name', gen_random_uuid(), gen_random_uuid()); — must BLOCK.
--      OBSERVED: call started 08:26:30.488925+00.
--   3. Session 3: confirm the wait as in Procedure A step 3, and additionally read
--        select mode, granted, pid from pg_locks
--        where locktype = 'relation' and relation = 'public.legal_documents'::regclass;
--      OBSERVED: exactly one waiting row — pid 439, state 'active', wait_event_type
--      'Lock', wait_event 'advisory', on the loser's `complete_personal_onboarding`
--      statement; advisory key objid 4018907541 granted = t for pid 438 and granted = f
--      for pid 439. The relation read additionally showed pid 438 holding ShareLock on
--      public.legal_documents (alongside AccessShareLock and the RowShareLock the
--      evidence rows' foreign key takes) — the Legal lock, sighted in a genuinely
--      concurrent session rather than inferred from the source.
--   4. Commit session 1, then commit session 2.
--      OBSERVED: session 1 committed at 08:26:38.490249+00. Session 2 blocked 8.0145s
--      and returned WITHOUT error at 08:26:38.503465+00 — it reached the completion-
--      first check after acquiring the advisory lock, found session 1's committed row,
--      and returned the winner's state having validated nothing. Its own forged legal
--      ids were never inspected: an `invalid_input` failure would have proved the check
--      ran too late. It returned display_name 'Winner Name' (not 'Loser Name'),
--      completed_at 2026-08-26 08:26:28.483314+00 and pinned_terms_document_id
--      3fd64022-74a9-4b49-bcac-de0a5bc18f0e — identical to what session 1 returned.
--   5. Confirm from a separate connection after both commit.
--      OBSERVED: exactly one `public.profile_onboarding` row, one `public.athletes`
--      row, one ACTIVE `public.profile_entitlements` row (tier 'free', revoked_at
--      NULL), and exactly two `public.legal_acceptances` rows for that Profile
--      (terms_of_service/accepted and privacy_notice/acknowledged);
--      `profiles.display_name` = 'Winner Name'. The loser wrote nothing.
--
-- Procedure C — complete_personal_onboarding against an owner-operated Legal rotation.
--
--   This is the procedure for the relation lock, and it is run in BOTH orderings,
--   because each ordering falsifies a different mistake. Ordering 1 proves the lock is
--   really held to the end of the completing transaction; ordering 2 proves it is taken
--   BEFORE the active pair is inspected. Ordering 2 is the discriminating one: if the
--   pair were resolved before locking — or without a lock at all — session 2 would have
--   read the pre-rotation committed snapshot, in which its submitted ids were still
--   current, and would have SUCCEEDED, pinning a pair that had already ceased to be
--   current. `stale_legal_version` is the outcome only correct ordering can produce.
--
--   Ordering 1 — completion holds, rotation waits.
--   Fixture: `auth.users` row b0000000-0000-0000-0000-00000000000b with a bare,
--   COMMITTED Profile; current pair `proc-tos-v1` / `proc-pn-v1`.
--   1. Session 1 (authenticated): begin; select public.complete_personal_onboarding(
--      'Rotation Race', <v1 terms id>, <v1 privacy id>); — returns; do NOT commit.
--      OBSERVED: call started 08:27:33.515209+00 and returned
--      pinned_terms_version_label 'proc-tos-v1', pinned_privacy_version_label
--      'proc-pn-v1'.
--   2. Session 2 (owner): the four-statement atomic rotation to v2 — begin; retire the
--      current Terms; insert `proc-tos-v2`; retire the current Privacy; insert
--      `proc-pn-v2`; commit. Its FIRST statement must BLOCK on the relation lock.
--      OBSERVED: attempted at 08:27:35.524526+00. The first `update
--      public.legal_documents set retired_at = now() where id = <v1 terms>` did not
--      return until 08:27:43.532091+00 — blocked 8.0076s. The remaining three
--      statements and the commit then completed at 08:27:43.537750+00.
--   3. Session 3, while session 2 was waiting.
--      OBSERVED at 08:27:38.525910+00: exactly one waiting row — pid 525, state
--      'active', wait_event_type 'Lock', wait_event 'relation', query `update
--      public.legal_documents set retired_at = now() where id = '3fd64...`. On
--      public.legal_documents, pid 524 (the completing session) held AccessShareLock,
--      RowShareLock and ShareLock, all granted = t; pid 525 (the rotation) had
--      RowExclusiveLock with granted = f. A relation-lock wait, not slowness.
--   4. Commit session 1; the rotation proceeds.
--      OBSERVED: session 1 committed at 08:27:43.524189+00 and the rotation's blocked
--      statement returned 8 ms later. Nothing was half-rotated at any point.
--   5. Confirm the completion is pinned to what it accepted, and that the rotation is
--      visible only through the reporting-only fields.
--      OBSERVED: get_my_gate_state() for that Profile reports pinned_terms_version_label
--      'proc-tos-v1' and pinned_privacy_version_label 'proc-pn-v1', with
--      current_terms_version_label 'proc-tos-v2' and current_privacy_version_label
--      'proc-pn-v2'. `public.legal_documents` holds v1 retired and v2 active for both
--      kinds. Across the two completed accounts: two `profile_onboarding` rows, four
--      `legal_acceptances`, two `athletes`, two `profile_entitlements`.
--
--   Ordering 2 — rotation holds, onboarding waits, and is then correctly refused.
--   Fixture: `auth.users` row c0000000-0000-0000-0000-00000000000c with a bare,
--   COMMITTED Profile; current pair `proc-tos-v2` / `proc-pn-v2` (ordering 1's result).
--   1. Session 1 (owner): begin; the four-statement atomic rotation to v3; do NOT
--      commit.
--      OBSERVED: opened 08:28:29.218834+00, all four statements applied, committed
--      08:28:39.232098+00.
--   2. Session 2 (authenticated as the incomplete Profile, submitting the PRIOR — v2 —
--      ids, which were current when it read them): select
--      public.complete_personal_onboarding('Late Comer', <v2 terms id>,
--      <v2 privacy id>); — must BLOCK before inspecting the active pair.
--      OBSERVED: attempted 08:28:31.226388+00; blocked 00:00:08.007631; then raised
--      `stale_legal_version: The legal documents were updated. Review and accept the
--      current versions.` and returned at 08:28:39.235912+00 — after, not before, the
--      rotation committed.
--   3. Session 3, while session 2 was waiting.
--      OBSERVED at 08:28:34.229990+00: exactly one waiting row — pid 624, state
--      'active', wait_event_type 'Lock', wait_event 'relation', on session 2's
--      completion statement. On public.legal_documents: pid 627 (the rotation) held
--      RowExclusiveLock granted = t, and pid 624 had ShareLock with granted = f. The
--      completion was waiting for the Legal lock, before any resolution.
--   4. Session 4, issued while the rotation was STILL open: a retry of
--      complete_personal_onboarding for the ALREADY COMPLETED account from Procedure B,
--      with a different display name and forged legal ids. It must not block, because
--      the completion-first short-circuit is reached before the lock.
--      OBSERVED: returned in 00:00:00.007083 — no wait — with display_name
--      'Winner Name' (its own 'Renamed During Rotation' was never applied),
--      pinned_terms_version_label 'proc-tos-v1' and current_terms_version_label
--      'proc-tos-v2'. The uncommitted v3 rotation was correctly invisible to it.
--   5. Confirm zero onboarding side effects for the refused caller.
--      OBSERVED: that Profile is still bare — display_name NULL, zero
--      `profile_onboarding`, zero `legal_acceptances`, zero `athletes`, zero
--      `profile_entitlements` rows. The already-completed account's display_name is
--      still 'Winner Name'. `proc-tos-v3` and `proc-pn-v3` are the active pair, and
--      three Profiles exist in total across all three procedures.
--
-- All three procedures COMMIT their fixtures and leave rows behind, so
-- `supabase db reset --local --no-seed --yes` is required before the pgTAP suites are
-- trusted again.
