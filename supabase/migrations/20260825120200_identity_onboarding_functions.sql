-- Stage B0.2a — Identity and Onboarding: SECURITY DEFINER RPCs.
--
-- Executed and exercised against a real local Supabase Postgres by
-- supabase/tests/identity_onboarding.test.sql. The multi-session behaviour the locks
-- below exist to guarantee is verified separately (Procedures A, B and C, documented at
-- the end of that test file and in supabase/tests/README.md) — pgTAP runs inside one
-- transaction and cannot make one backend block on another's lock. Procedures A and B
-- cover the two per-account advisory locks; Procedure C covers the relation lock that
-- linearizes onboarding against a Legal rotation.
--
-- Every function below:
--   * is SECURITY DEFINER with an explicit, pinned `search_path = public, pg_temp`;
--   * derives the caller exclusively from `auth.uid()`. No function takes a Profile
--     id, account id or owner parameter of any kind — there is nothing for a client to
--     spoof;
--   * revokes the default PUBLIC execute grant and grants only the roles named in its
--     own comment;
--   * raises every EXPECTED failure as `'<kind>: <fixed safe message>'` and never lets
--     a raw Postgres/constraint/row value reach the caller.
--
-- The expected `<kind>` values this feature introduces are:
--   forbidden            — no authenticated identity at all: either the session carries
--                          no resolvable subject, or the subject it carries names no
--                          existing `auth.users` row (a token outliving its account).
--                          One fixed message covers both; it names neither condition.
--   profile_required     — authenticated, but no Profile exists yet. The caller must
--                          call ensure_my_profile() first; completion has no Profile-
--                          creation fallback (ADR-0025 Decision 16).
--   invalid_input        — a malformed display name, or a supplied legal document id
--                          that is NULL, unknown, of the wrong kind, or reused for
--                          both kinds.
--   legal_unavailable    — a required current legal document is genuinely absent
--                          server-side. ADR-0025 Decision 17 keeps genuine absence and
--                          an invalid response distinct; this is the absence case.
--   stale_legal_version  — a supplied id names a real document of the CORRECT kind that
--                          is no longer the current row. The user must be shown, and
--                          must accept, the new version afresh.
--   conflict             — a normalized stand-in for a unique-constraint outcome that
--                          the completion-first check and the advisory lock together
--                          make unreachable through supported paths. It exists so that
--                          no raw constraint name can ever escape.
--
-- ADR-0025 Decision 23: `public.bootstrap_profile` is NOT called, replaced or altered
-- here. It stays reachable while the legacy Team UI depends on it, and is retired in
-- the later stage that removes those call sites and rewrites the Team database suite.
--
-- ADR-0025 Decision 16, stated once and enforced structurally below: identity,
-- capability, entitlement and onboarding are four separate facts. `ensure_my_profile`
-- establishes identity and NOTHING else. Only `complete_personal_onboarding`
-- establishes capability, entitlement and completion, and it establishes all of them
-- together or none of them.

-- ---------------------------------------------------------------------------------
-- public.get_current_legal_documents()
--
-- Grants: anon and authenticated. The sign-in and onboarding surfaces must be able to
-- render the current legal metadata before any account exists.
--
-- Returns the ACTIVE rows only, from ONE statement snapshot, so the Terms row and the
-- Privacy row a user is shown always come from the same instant. That is what makes
-- ADR-0025 Decision 17's rule enforceable — "the metadata a user is shown and the ids
-- their acceptance submits come from one snapshot, so an acceptance can never be
-- pinned to a version that was never displayed".
--
-- Genuine absence is represented by NO ROW for that kind — never by a row with NULL
-- fields, and never by an error. `complete_personal_onboarding` raises
-- `legal_unavailable` for that same condition; the client-side mapper classifies an
-- invalid RESPONSE (unknown kind, duplicate kind, malformed row, unsafe URL)
-- separately, and this function deliberately does not filter unknown kinds out: doing
-- so would silently normalize a corrupt response into an ordinary, expected state,
-- which Decision 17 explicitly refuses. (The `kind` check constraint means the
-- database cannot produce one; the mapper stays the load-bearing classifier.)
--
-- The return shape is explicit and narrow — never `select *`. `retired_at`,
-- `published_at` and every future column stay server-side.
-- ---------------------------------------------------------------------------------

create function public.get_current_legal_documents()
returns table (
  id uuid,
  kind text,
  version_label text,
  document_url text,
  effective_at timestamptz
)
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  select d.id, d.kind, d.version_label, d.document_url, d.effective_at
  from public.legal_documents d
  where d.retired_at is null
  order by d.kind;
$$;

revoke all on function public.get_current_legal_documents() from public;
grant execute on function public.get_current_legal_documents() to anon, authenticated;

-- ---------------------------------------------------------------------------------
-- public.ensure_my_profile()
--
-- Grants: authenticated only.
--
-- The ONLY new B0.2 operation that creates or resolves a bare Profile (ADR-0025
-- Decision 16). It creates a Profile row with a NULL display name and its account
-- link, and NOTHING else: no Athlete row, no entitlement, no legal acceptance, no
-- onboarding completion, and no stored gate-eligible flag. A bare Profile passes no
-- gate and grants no capability — specification §3.4.
--
-- A NON-NULL JWT SUBJECT IS NOT AN EXISTING AUTH ACCOUNT. Those are two separate
-- facts, and only the second one may create a Profile. A token minted before its
-- account was deleted still carries a syntactically valid `sub`, so `auth.uid()`
-- returns a UUID that no `auth.users` row matches. Both cases are refused with the
-- same fixed, value-free `forbidden:` message — see the check inside the function.
--
-- Concurrency: a transaction-scoped advisory lock derived from `auth.uid()` serializes
-- concurrent calls for the same account, so two simultaneous first calls cannot create
-- two Profiles. Under READ COMMITTED (PostgREST's isolation level) the second caller's
-- post-lock SELECT sees the winner's committed link, so it returns the same Profile.
-- The `on conflict` branch below is therefore unreachable through that path and exists
-- as belt-and-braces; if it ever fires, the Profile row this call just created is
-- discarded rather than left orphaned, and the winner's Profile is returned.
--
-- Procedure A in supabase/tests/README.md is the executed multi-session proof; its
-- step 6 is the executed proof that the auth account cannot be deleted out from
-- under an in-flight Profile creation.
-- ---------------------------------------------------------------------------------

create function public.ensure_my_profile()
returns public.profiles
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid := auth.uid();
  v_account_exists boolean;
  v_profile_id uuid;
  v_new_profile_id uuid;
  v_linked_profile_id uuid;
  v_profile public.profiles;
begin
  if v_account_id is null then
    raise exception 'forbidden: Sign in to continue.';
  end if;

  perform pg_advisory_xact_lock(hashtext('ensure_my_profile:' || v_account_id::text));

  -- The authoritative auth account must actually EXIST before a Profile is created for
  -- it. Without this, a stale token whose account has since been deleted gets past the
  -- NULL check, inserts a tentative Profile, and then fails on the account link's
  -- foreign key to `auth.users` — handing the caller a raw constraint name, its own
  -- account UUID, the failing statement and PL/pgSQL context. That is precisely the
  -- leak the normalized-error rule at the top of this file forbids.
  --
  -- `for key share` is the weakest row lock that still conflicts with a DELETE of this
  -- account, or an UPDATE of its key: the row cannot disappear between this check and
  -- the link insert below, and the lock is held for the rest of the transaction. It
  -- deliberately does NOT block an ordinary non-key update of the account row, nor
  -- another KEY SHARE holder, so concurrent auth activity and concurrent Profile
  -- creation for other accounts are unaffected. It is also exactly the lock the link
  -- insert's own foreign key would take on this row anyway — taking it here simply
  -- moves it in front of the Profile insert, so no Profile is created speculatively.
  --
  -- `complete_personal_onboarding` needs no equivalent check: once a link exists,
  -- `account_profile_links.account_id -> auth.users(id) on delete restrict` makes the
  -- account undeletable, and a caller with no link is already refused with
  -- `profile_required`.
  --
  -- DEPENDENCY, stated so it is not discovered by an outage: a row-locking clause needs
  -- UPDATE privilege on the locked relation, so this function requires its DEFINER (the
  -- migration-owning role) to hold SELECT and UPDATE on `auth.users`. On this local
  -- Supabase project the definer is `postgres`, `auth.users` is owned by
  -- `supabase_auth_admin`, and `postgres` holds both — verified. A project that
  -- narrowed the migration role's privileges on the `auth` schema would break this
  -- check rather than silently skip it, which is the correct direction.
  --
  -- The refusal reuses the missing-subject message verbatim. Whether an account never
  -- existed or has been deleted is not the caller's business, and neither answer may
  -- carry an identifier.
  select true into v_account_exists
  from auth.users u
  where u.id = v_account_id
  for key share;

  if v_account_exists is not true then
    raise exception 'forbidden: Sign in to continue.';
  end if;

  select l.profile_id into v_profile_id
  from public.account_profile_links l
  where l.account_id = v_account_id;

  if v_profile_id is null then
    insert into public.profiles (display_name) values (null)
    returning id into v_new_profile_id;

    insert into public.account_profile_links (account_id, profile_id)
    values (v_account_id, v_new_profile_id)
    on conflict (account_id) do nothing
    returning profile_id into v_linked_profile_id;

    if v_linked_profile_id is null then
      -- Another transaction linked this account first. Discard the Profile row this
      -- call created — nothing references it yet — and re-select the authoritative
      -- link, so repeated and concurrent calls always agree on one stable UUID.
      delete from public.profiles where id = v_new_profile_id;
      select l.profile_id into strict v_linked_profile_id
      from public.account_profile_links l
      where l.account_id = v_account_id;
    end if;

    v_profile_id := v_linked_profile_id;
  end if;

  select p.* into v_profile from public.profiles p where p.id = v_profile_id;
  return v_profile;
end;
$$;

revoke all on function public.ensure_my_profile() from public;
grant execute on function public.ensure_my_profile() to authenticated;

-- ---------------------------------------------------------------------------------
-- public.gate_state — the derived gate-state return contract
--
-- A named composite so that get_my_gate_state() and complete_personal_onboarding()
-- provably return the IDENTICAL shape, and so the column list is one canonical
-- statement rather than two that can drift apart.
--
-- The PINNED_* fields describe the exact evidence a completed onboarding was justified
-- by. The CURRENT_* fields are REPORTING ONLY — they say what the server considers
-- current right now. They are deliberately separate: ADR-0025 Decision 17 states that
-- "a later document change never automatically revokes a completed Profile or forces
-- re-acceptance", so a rotation must be visible without ever rewriting or invalidating
-- what was pinned. Nothing in B0.2 compares the two to decide access.
--
-- No gate-state row is stored anywhere. Every field is derived on read.
-- ---------------------------------------------------------------------------------

create type public.gate_state as (
  profile_id uuid,
  display_name text,
  onboarding_completed_at timestamptz,
  has_athlete_capability boolean,
  free_entitlement_active boolean,

  pinned_terms_acceptance_id uuid,
  pinned_terms_document_id uuid,
  pinned_terms_version_label text,
  pinned_terms_accepted_at timestamptz,

  pinned_privacy_acknowledgement_id uuid,
  pinned_privacy_document_id uuid,
  pinned_privacy_version_label text,
  pinned_privacy_acknowledged_at timestamptz,

  current_terms_document_id uuid,
  current_terms_version_label text,
  current_privacy_document_id uuid,
  current_privacy_version_label text
);

-- ---------------------------------------------------------------------------------
-- public.get_my_gate_state()
--
-- Grants: authenticated only.
--
-- Returns exactly one row, always — including for an authenticated account that has no
-- Profile at all, which is reported as a NULL `profile_id` rather than as an empty
-- result the caller would have to interpret. Every other field is then NULL or false,
-- which is the correct answer: nothing is granted.
--
-- Gate eligibility itself is NOT a column here. ADR-0025 Decision 16 requires it to be
-- derived, and the caller derives it from these facts (a Profile, a completion
-- timestamp, Athlete capability and an active Free entitlement). Persisting a single
-- "eligible" boolean would create a second, freely mutable source of truth, which is
-- exactly what that decision forbids.
-- ---------------------------------------------------------------------------------

create function public.get_my_gate_state()
returns public.gate_state
language sql
stable
security definer
set search_path = public, pg_temp
as $$
  with me as (
    select private.current_profile_id() as profile_id
  ),
  current_terms as (
    select d.id, d.version_label
    from public.legal_documents d
    where d.kind = 'terms_of_service' and d.retired_at is null
  ),
  current_privacy as (
    select d.id, d.version_label
    from public.legal_documents d
    where d.kind = 'privacy_notice' and d.retired_at is null
  )
  select
    me.profile_id,
    p.display_name,
    o.completed_at,
    (ath.profile_id is not null),
    (ent.id is not null),

    o.terms_acceptance_id,
    ta.legal_document_id,
    td.version_label,
    ta.accepted_at,

    o.privacy_acknowledgement_id,
    pa.legal_document_id,
    pd.version_label,
    pa.accepted_at,

    ct.id,
    ct.version_label,
    cp.id,
    cp.version_label
  from me
  left join public.profiles p on p.id = me.profile_id
  left join public.profile_onboarding o on o.profile_id = me.profile_id
  left join public.athletes ath on ath.profile_id = me.profile_id
  left join public.profile_entitlements ent
    on ent.profile_id = me.profile_id and ent.tier = 'free' and ent.revoked_at is null
  left join public.legal_acceptances ta on ta.id = o.terms_acceptance_id
  left join public.legal_documents td on td.id = ta.legal_document_id
  left join public.legal_acceptances pa on pa.id = o.privacy_acknowledgement_id
  left join public.legal_documents pd on pd.id = pa.legal_document_id
  left join current_terms ct on true
  left join current_privacy cp on true;
$$;

revoke all on function public.get_my_gate_state() from public;
grant execute on function public.get_my_gate_state() to authenticated;

-- ---------------------------------------------------------------------------------
-- public.complete_personal_onboarding(p_display_name, p_terms_document_id,
--                                     p_privacy_document_id)
--
-- Grants: authenticated only.
--
-- Completion-first and write-once (ADR-0025 Decision 16). Establishes, in ONE
-- transaction: the validated display name, both legal evidence rows, Athlete
-- capability, the default Free entitlement, and the completion fact — or none of them.
--
-- There is NO marketing parameter. ADR-0025 Decision 18: B0.2 requests, stores and
-- infers nothing about marketing consent, including as an explicit negative, and
-- absence never means consent.
--
-- There is NO Profile-creation fallback. `ensure_my_profile()` is the only creation
-- path; a caller without a Profile gets `profile_required` and this function writes
-- nothing.
--
-- ORDERING IS LOAD-BEARING. The completion-first check happens BEFORE the display name
-- is validated, before the supplied legal ids are inspected, and before any Profile
-- fact is touched. That is what makes a retry after a lost response a genuine no-op
-- even when the retry's payload has since become invalid: a rotation between the
-- original call and the retry must not turn a successful completion into a failure,
-- and must not silently re-accept anything.
--
-- SUPPLIED-ID PRECEDENCE, and one reconciliation worth stating explicitly. The order
-- is: NULL -> `invalid_input`; the same id supplied for both kinds -> `invalid_input`;
-- an unknown id -> `invalid_input`; an id whose document has the WRONG kind for the
-- slot -> `invalid_input` (this is unconditional, and covers a retired document of the
-- other kind); an id whose document has the CORRECT kind but is no longer the current
-- row -> `stale_legal_version`.
--
-- Because the schema permits at most one ACTIVE row per kind, "correct kind but not
-- current" is precisely "correct kind and retired". `stale_legal_version` therefore
-- takes precedence over a generic `invalid_input` for that case — which is what makes
-- the required snapshot-coupling behaviour work: after both kinds rotate to v2,
-- submitting the v1 ids must report a stale version (so the new version can be shown
-- and accepted afresh), not an indistinguishable malformed-input error.
--
-- CONCURRENCY — two locks, two different jobs.
--
-- Same account, two simultaneous completions: they serialize on the per-account
-- advisory lock. The winner writes once; the loser reaches the completion-first check
-- after the lock is released, finds the winner's row, and returns the winner's state
-- having validated nothing and written nothing. Procedure B in
-- supabase/tests/README.md is the executed multi-session proof.
--
-- Any account, against an owner-operated Legal rotation: the SHARE lock taken on
-- `public.legal_documents` below (see the block at step 7) makes Legal validation and
-- the evidence writes atomic with respect to every direct INSERT/UPDATE/DELETE on that
-- table. Procedure C is the executed multi-session proof, in both orderings.
--
-- The two locks are always taken in the same order — advisory first, relation second —
-- and a rotation takes no advisory lock at all, so no cycle exists between them.
--
-- No test-only parameter, hook or failure switch exists in this function. The atomic
-- rollback case is exercised by a temporary trigger created inside the pgTAP
-- transaction and dropped again there.
-- ---------------------------------------------------------------------------------

create function public.complete_personal_onboarding(
  p_display_name text,
  p_terms_document_id uuid,
  p_privacy_document_id uuid
)
returns public.gate_state
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_account_id uuid := auth.uid();
  v_profile_id uuid;
  v_display_name text;
  v_current_terms_id uuid;
  v_current_privacy_id uuid;
  v_supplied_terms_kind text;
  v_supplied_privacy_kind text;
  v_terms_acceptance_id uuid;
  v_privacy_acceptance_id uuid;
begin
  if v_account_id is null then
    raise exception 'forbidden: Sign in to continue.';
  end if;

  -- 1. Serialize every completion attempt for this account.
  perform pg_advisory_xact_lock(hashtext('personal_onboarding:' || v_account_id::text));

  -- 2. Resolve the caller's Profile from auth.uid(), never from a parameter.
  v_profile_id := private.current_profile_id();

  -- 3. No Profile: refuse, and write nothing.
  if v_profile_id is null then
    raise exception 'profile_required: Set up your profile before continuing.';
  end if;

  -- 4/5. COMPLETION-FIRST. Before any validation of this call's payload.
  if exists (select 1 from public.profile_onboarding o where o.profile_id = v_profile_id) then
    return public.get_my_gate_state();
  end if;

  -- 6. Only now, for a genuinely incomplete Profile, validate this call's own payload.
  --    The display name is checked before the Legal lock below, so a malformed name
  --    never holds a relation lock, and the existing error precedence is unchanged.
  v_display_name := btrim(p_display_name);
  if coalesce(v_display_name, '') = '' then
    raise exception 'invalid_input: Enter a display name.';
  end if;
  if length(v_display_name) > 80 then
    raise exception 'invalid_input: Display name is too long.';
  end if;

  -- 7. LINEARIZE AGAINST A LEGAL ROTATION, then resolve.
  --
  -- ADR-0025 Decision 17 requires that the metadata a user is shown and the ids their
  -- acceptance submits come from ONE snapshot, and that a rotation between display and
  -- submission is refused outright rather than half-honoured. Resolving the two active
  -- ids without a lock cannot deliver that under READ COMMITTED, PostgREST's isolation
  -- level: an owner-operated atomic rotation committing mid-resolution would let this
  -- function validate, and then pin, a mixed old/new pair that
  -- get_current_legal_documents() never returned together.
  --
  -- Two independent things close that gap, and the first is the load-bearing one:
  --
  --   * a transaction-duration SHARE lock on the whole relation. Every ordinary
  --     INSERT, UPDATE and DELETE takes ROW EXCLUSIVE, which CONFLICTS with SHARE, so
  --     an owner-operated rotation and a completion cannot interleave — one waits for
  --     the other to commit. This works because it is a real relation lock that the
  --     rotation's own DML takes whether the operator knows about it or not; it is
  --     deliberately NOT an advisory lock, which a future rotation script could simply
  --     neglect to take, and NOT a comment asking operators to be careful. SHARE is
  --     self-compatible, so concurrent completions (same or different accounts) still
  --     proceed together and only Legal DML is excluded.
  --   * ONE statement resolving both ids below, so they come from one statement
  --     snapshot even before the lock is considered. Two statements would be two
  --     snapshots; "one transaction" is not the same claim as "one statement", and only
  --     the second is what a coherent pair needs.
  --
  -- ORDERING. The lock is taken AFTER the completion-first short-circuit above, which
  -- is what lets an already-completed Profile's retry return immediately without
  -- waiting on an in-flight rotation and without inspecting Legal at all. It is taken
  -- BEFORE the resolution below, which is what makes the pair coherent — resolving
  -- first and locking afterwards would read a snapshot the lock then does nothing to
  -- protect.
  --
  -- LIFETIME. Nothing releases this lock early. It is held through resolution, through
  -- every validation branch below, through both evidence inserts and the completion
  -- row, and to the end of the caller's transaction.
  lock table public.legal_documents in share mode;

  -- Derive what the server considers current. The client never asserts this. Both
  -- scalar subqueries belong to one statement and therefore one snapshot, and
  -- `legal_documents_one_active_per_kind` makes each of them single-valued. A kind with
  -- no active row yields NULL, which is the genuine-absence case handled next.
  select
    (select d.id from public.legal_documents d
      where d.kind = 'terms_of_service' and d.retired_at is null),
    (select d.id from public.legal_documents d
      where d.kind = 'privacy_notice' and d.retired_at is null)
  into v_current_terms_id, v_current_privacy_id;

  -- Genuine absence of a required current document — distinct from a malformed
  -- submission, and reported as its own kind.
  if v_current_terms_id is null or v_current_privacy_id is null then
    raise exception 'legal_unavailable: Legal documents are unavailable right now.';
  end if;

  if p_terms_document_id is null or p_privacy_document_id is null then
    raise exception 'invalid_input: Accept the current Terms of Service and Privacy Notice.';
  end if;

  if p_terms_document_id = p_privacy_document_id then
    raise exception 'invalid_input: Accept the current Terms of Service and Privacy Notice.';
  end if;

  select d.kind into v_supplied_terms_kind
  from public.legal_documents d where d.id = p_terms_document_id;

  select d.kind into v_supplied_privacy_kind
  from public.legal_documents d where d.id = p_privacy_document_id;

  -- Unknown id, or an id naming a document of the wrong kind for its slot.
  if v_supplied_terms_kind is distinct from 'terms_of_service'
     or v_supplied_privacy_kind is distinct from 'privacy_notice' then
    raise exception 'invalid_input: Accept the current Terms of Service and Privacy Notice.';
  end if;

  -- Correct kind, real document, but superseded since it was displayed.
  if p_terms_document_id <> v_current_terms_id
     or p_privacy_document_id <> v_current_privacy_id then
    raise exception 'stale_legal_version: The legal documents were updated. Review and accept the current versions.';
  end if;

  -- The write section. Every statement below is one transaction with the caller's; any
  -- failure leaves no Athlete, no entitlement, no acceptance and no completion behind,
  -- and the pre-existing bare Profile is untouched because its display name is updated
  -- last.
  --
  -- The narrow handler normalizes a unique-constraint outcome that the advisory lock
  -- and the completion-first check make unreachable through supported paths, so that
  -- no raw constraint name can escape. It re-raises, so nothing is committed.
  begin
    -- The server-derived current ids are used here. They were just proven equal to the
    -- supplied ids, so this pins exactly what the caller submitted while never trusting
    -- the client value as the source.
    insert into public.legal_acceptances
      (profile_id, legal_document_id, document_kind, acceptance_action)
    values
      (v_profile_id, v_current_terms_id, 'terms_of_service', 'accepted')
    returning id into v_terms_acceptance_id;

    insert into public.legal_acceptances
      (profile_id, legal_document_id, document_kind, acceptance_action)
    values
      (v_profile_id, v_current_privacy_id, 'privacy_notice', 'acknowledged')
    returning id into v_privacy_acceptance_id;

    -- Athlete capability. Specification §3.4 and ADR-0024: completed personal
    -- onboarding is what establishes it. ADR-0022 Decision 10 remains true of the Team
    -- Foundation service — no TEAM RPC creates an athletes row; this is the first
    -- writer anywhere, and it is not a Team RPC.
    insert into public.athletes (profile_id) values (v_profile_id);

    -- The default Free entitlement.
    insert into public.profile_entitlements (profile_id, tier)
    values (v_profile_id, 'free');

    -- The completion fact, pinned to both exact evidence rows. The composite foreign
    -- keys prove same-Profile, correct-kind and correct-action at insert time.
    insert into public.profile_onboarding
      (profile_id, terms_acceptance_id, privacy_acknowledgement_id)
    values
      (v_profile_id, v_terms_acceptance_id, v_privacy_acceptance_id);

    update public.profiles
    set display_name = v_display_name, updated_at = now()
    where id = v_profile_id;
  exception
    when unique_violation then
      raise exception 'conflict: Onboarding could not be completed. Try again.';
  end;

  return public.get_my_gate_state();
end;
$$;

revoke all on function public.complete_personal_onboarding(text, uuid, uuid) from public;
grant execute on function public.complete_personal_onboarding(text, uuid, uuid) to authenticated;
