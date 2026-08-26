-- Stage B0.2a — Identity and Onboarding: schema.
--
-- Governing sources, in authority order:
--   * docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md (canonical
--     product source — §2 identity, §3 minimal onboarding, §3.4 what completed
--     onboarding grants, §11 staging);
--   * docs/adr/0024-mandatory-identity-and-free-structured-cloud-foundation.md;
--   * docs/adr/0025-application-identity-gate-onboarding-completion-and-trusted-device-state.md
--     Decisions 16 and 17 (four separate facts; versioned, pinned, whole-response legal
--     evidence).
--
-- STATUS: executed. Applied from scratch by `supabase db reset --local --no-seed --yes`
-- against a real local Supabase Postgres and exercised by
-- supabase/tests/identity_onboarding.test.sql (see that directory's README.md for the
-- recorded result and the separately executed multi-session concurrency evidence).
--
-- SCOPE AND RELEASE BOUNDARY. This migration is ADDITIVE — it creates four new tables
-- and touches no committed Team Foundation object. It is NOT inert: once applied, an
-- authenticated caller can execute the new RPCs in the functions migration, and
-- `complete_personal_onboarding` can create an Athlete capability and a Free
-- entitlement for the caller's own Profile. That is acceptable only on this unreleased
-- local/development branch. Do not apply this migration to a hosted production
-- database.
--
-- **B0.2 is never independently release-ready.** B0.2 and B0.3 are one releasable
-- privacy unit (specification §11.1): the seven sporting repositories still share one
-- identity-unscoped `localStorage` workspace until B0.3. This stage introduces no
-- Profile-scoped sporting persistence and no cloud sporting persistence of any kind.
--
-- What this migration deliberately does NOT create: a `marketing_consents` relation
-- (ADR-0025 Decision 18 — B0.2 collects no Marketing Consent, and absence never means
-- consent), a stored `gate_eligible` flag or any other freely mutable gate boolean
-- (Decision 16 — gate eligibility is DERIVED), a role/account-type column, a
-- Profile-to-auth-id shortcut (Profile.id is application-owned and is never the
-- provider user id), and any real legal text, legal URL, version identifier,
-- controller detail, retention claim, subprocessor or transfer claim (Decision 17 —
-- none of that is authored in this repository).
--
-- `public.profiles`, `public.account_profile_links` and `public.athletes` are REUSED
-- from the Team Foundation schema migration exactly as they are. Nothing here
-- recreates or alters them.
--
-- ORDERING DEPENDENCY. These three migrations run AFTER the three `20260820*` Team
-- Foundation migrations and depend on objects those create: the `private` schema (used
-- for the guard trigger functions here), `public.profiles`, `public.account_profile_links`
-- and `public.athletes` (referenced by the new tables and written by
-- complete_personal_onboarding), and `private.current_profile_id()` (used by every new
-- RLS policy and RPC). The migration timestamps guarantee that order, and a clean
-- `supabase db reset` applies all six in sequence.

-- ---------------------------------------------------------------------------------
-- public.legal_documents — immutable versioned legal metadata
--
-- ADR-0025 Decision 17: legal documents are immutable versioned metadata; a correction
-- is a NEW version row, retirement is a ONE-WAY transition, and rotation is atomic.
-- The `unique (id, kind)` constraint exists so `legal_acceptances` can carry a
-- composite foreign key that pins the accepted document's kind, rather than trusting a
-- separately stored copy of it.
-- ---------------------------------------------------------------------------------

create table public.legal_documents (
  id uuid primary key default gen_random_uuid(),
  kind text not null check (kind in ('terms_of_service', 'privacy_notice')),
  version_label text not null,
  document_url text not null,
  effective_at timestamptz not null,
  published_at timestamptz not null default now(),
  retired_at timestamptz,

  constraint legal_documents_version_label_not_blank
    check (length(btrim(version_label)) > 0),
  constraint legal_documents_version_label_length
    check (length(version_label) <= 120),

  -- One row per (kind, version_label) for the whole history, including retired rows —
  -- a retired version's label can never be silently reused for different content.
  constraint legal_documents_kind_version_unique unique (kind, version_label),

  -- Supports the evidence foreign key from legal_acceptances (id, kind).
  constraint legal_documents_id_kind_unique unique (id, kind),

  -- Safe-URL constraint — DEFENCE IN DEPTH ONLY.
  --
  -- ADR-0025 Decision 17 states the exact safe-URL boundary and says plainly that the
  -- mapping boundary is the load-bearing check "because a database constraint is not a
  -- URL parser". This regex is NOT a complete URL parser and must never be described
  -- as one. In particular it does not decode percent-encoding, so a percent-encoded
  -- control character passes here and is rejected by the later TypeScript mapper.
  --
  -- What it does enforce:
  --   * an absolute `https://` URL only — `http:`, `javascript:`, `data:`, `blob:`,
  --     `file:` and every other scheme are rejected, as is a protocol-relative
  --     `//host` form (no scheme at all);
  --   * a non-empty authority — `https://` and `https:///path` are rejected;
  --   * no credentials in the authority — `@` is excluded from the authority
  --     character class, so `https://user:pass@host` is rejected;
  --   * no whitespace and no literal control character anywhere in the value, which
  --     also makes an untrimmed value (leading/trailing whitespace) impossible.
  constraint legal_documents_url_safe check (
    document_url ~ '^https://[^[:space:][:cntrl:]/?#@]+([/?#][^[:space:][:cntrl:]]*)?$'
  )
);

comment on table public.legal_documents is
  'Immutable versioned legal metadata (ADR-0025 Decision 17). No legal text, real URL, '
  'version identifier, controller detail, retention claim, subprocessor or transfer '
  'claim is authored in this repository — rows are supplied operationally. Retirement '
  'is one-way; a correction is a new version row. Browser roles hold no table '
  'privilege here at all: all client access goes through get_current_legal_documents().';

-- At most one ACTIVE (non-retired) row per kind. This is what makes "the current
-- Terms" and "the current Privacy Notice" single-valued facts that the server — never
-- the client — resolves, so a single statement can resolve both as scalars, and it is
-- the transactional enforcement behind the atomic rotation protocol below.
create unique index legal_documents_one_active_per_kind
  on public.legal_documents (kind)
  where retired_at is null;

-- ---------------------------------------------------------------------------------
-- Legal-document mutation guards
--
-- The only permitted UPDATE on a legal document is a single retirement:
-- `retired_at` NULL -> non-NULL, with EVERY other column unchanged. DELETE is refused
-- outright.
--
-- Atomic rotation is therefore an owner-operated TRANSACTION — several statements, one
-- transaction, not one statement: retire the current row and insert the replacement
-- together. If the replacement insert fails, the retirement rolls back with it and the
-- prior version stays current — the partial unique index above makes the reverse
-- ordering (insert first) impossible, so the transaction is the mechanism, not a
-- convention.
--
-- ROTATION AND ONBOARDING CANNOT INTERLEAVE. Atomicity alone would still let a
-- rotation commit while `complete_personal_onboarding()` was part-way through
-- resolving the active pair, which would let a completion validate a mixed old/new pair
-- no single read ever returned. Every INSERT, UPDATE and DELETE here takes ROW
-- EXCLUSIVE on this table; `complete_personal_onboarding()` takes SHARE on it for the
-- duration of its transaction. Those two modes CONFLICT, so one of the two waits for
-- the other to commit — enforced by the lock manager against the rotation's own DML,
-- with nothing for an operator to remember and no cooperating lock for a future
-- rotation script to forget. SHARE is self-compatible, so concurrent completions are
-- unaffected. See the functions migration's step 7 and Procedure C in
-- supabase/tests/README.md.
--
-- These triggers are defence in depth for ordinary owner-operated application paths.
-- They are not, and are not claimed to be, protection against a superuser altering the
-- schema itself.
-- ---------------------------------------------------------------------------------

create function private.legal_documents_guard_update()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  -- Covers unretirement (non-NULL -> NULL), rewriting the retirement timestamp, and a
  -- second retirement update: once retired, the row is frozen entirely.
  if old.retired_at is not null then
    raise exception 'conflict: This legal document version is already retired.';
  end if;

  if new.retired_at is null then
    raise exception 'conflict: A legal document version can only be retired.';
  end if;

  if new.id is distinct from old.id
     or new.kind is distinct from old.kind
     or new.version_label is distinct from old.version_label
     or new.document_url is distinct from old.document_url
     or new.effective_at is distinct from old.effective_at
     or new.published_at is distinct from old.published_at then
    raise exception 'conflict: Retiring a legal document version must not change anything else.';
  end if;

  return new;
end;
$$;

create trigger legal_documents_guard_update
  before update on public.legal_documents
  for each row execute function private.legal_documents_guard_update();

create function private.legal_documents_guard_delete()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'conflict: A legal document version cannot be deleted.';
end;
$$;

create trigger legal_documents_guard_delete
  before delete on public.legal_documents
  for each row execute function private.legal_documents_guard_delete();

-- ---------------------------------------------------------------------------------
-- public.legal_acceptances — append-only evidence
--
-- One row per (Profile, legal document). The document's KIND is carried on the row and
-- pinned to the document by a composite foreign key, so a row can never claim to be an
-- acceptance of a kind the referenced document does not have. The action is coupled to
-- the kind by a check constraint: Terms are `accepted`, a Privacy Notice is
-- `acknowledged` (specification §3.3 item 5).
-- ---------------------------------------------------------------------------------

create table public.legal_acceptances (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete restrict,
  legal_document_id uuid not null,
  document_kind text not null check (document_kind in ('terms_of_service', 'privacy_notice')),
  acceptance_action text not null check (acceptance_action in ('accepted', 'acknowledged')),
  accepted_at timestamptz not null default now(),

  constraint legal_acceptances_document_fk
    foreign key (legal_document_id, document_kind)
    references public.legal_documents (id, kind) on delete restrict,

  constraint legal_acceptances_action_matches_kind check (
    (document_kind = 'terms_of_service' and acceptance_action = 'accepted')
    or (document_kind = 'privacy_notice' and acceptance_action = 'acknowledged')
  ),

  constraint legal_acceptances_one_per_profile_document
    unique (profile_id, legal_document_id),

  -- Supports the two composite evidence foreign keys from profile_onboarding: pinning
  -- an acceptance simultaneously proves it belongs to the same Profile, has the
  -- correct document kind, and carries the correct action.
  constraint legal_acceptances_evidence_unique
    unique (id, profile_id, document_kind, acceptance_action)
);

create index legal_acceptances_profile_id_idx on public.legal_acceptances (profile_id);

comment on table public.legal_acceptances is
  'Append-only, versionable, auditable legal evidence (specification §3.3 item 6). '
  'Written only by complete_personal_onboarding(); no browser role holds any write '
  'privilege, and UPDATE/DELETE are refused for ordinary owner-operated paths too.';

create function private.legal_acceptances_guard_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'conflict: Legal acceptance evidence is append-only.';
end;
$$;

create trigger legal_acceptances_guard_update
  before update on public.legal_acceptances
  for each row execute function private.legal_acceptances_guard_write();

create trigger legal_acceptances_guard_delete
  before delete on public.legal_acceptances
  for each row execute function private.legal_acceptances_guard_write();

-- ---------------------------------------------------------------------------------
-- public.profile_onboarding — the write-once completion fact, pinned to its evidence
--
-- ADR-0025 Decision 17: "Onboarding pins the exact evidence rows that justified it,
-- proven to belong to the same Profile, the correct document kind and the correct
-- action." That proof is structural here, not procedural: the two composite foreign
-- keys below include this row's own `profile_id` and a fixed kind/action pair, so a
-- row referencing another Profile's evidence, or evidence of the wrong kind or wrong
-- action, cannot be inserted at all.
--
-- "A later document change never automatically revokes a completed Profile or forces
-- re-acceptance" (Decision 17) — which is why the pinned document is reached THROUGH
-- the pinned acceptance row and is never recomputed from whatever is current.
--
-- No `terms_acceptance_id <> privacy_acknowledgement_id` constraint is needed: `id` is
-- the primary key of legal_acceptances, and one row cannot satisfy both a
-- `terms_of_service`/`accepted` and a `privacy_notice`/`acknowledged` foreign key.
-- ---------------------------------------------------------------------------------

create table public.profile_onboarding (
  profile_id uuid primary key references public.profiles (id) on delete restrict,
  completed_at timestamptz not null default now(),

  terms_acceptance_id uuid not null,
  terms_document_kind text not null default 'terms_of_service'
    check (terms_document_kind = 'terms_of_service'),
  terms_acceptance_action text not null default 'accepted'
    check (terms_acceptance_action = 'accepted'),

  privacy_acknowledgement_id uuid not null,
  privacy_document_kind text not null default 'privacy_notice'
    check (privacy_document_kind = 'privacy_notice'),
  privacy_acknowledgement_action text not null default 'acknowledged'
    check (privacy_acknowledgement_action = 'acknowledged'),

  constraint profile_onboarding_terms_evidence_fk
    foreign key (terms_acceptance_id, profile_id, terms_document_kind, terms_acceptance_action)
    references public.legal_acceptances (id, profile_id, document_kind, acceptance_action)
    on delete restrict,

  constraint profile_onboarding_privacy_evidence_fk
    foreign key (privacy_acknowledgement_id, profile_id, privacy_document_kind, privacy_acknowledgement_action)
    references public.legal_acceptances (id, profile_id, document_kind, acceptance_action)
    on delete restrict
);

comment on table public.profile_onboarding is
  'Write-once completion fact (ADR-0025 Decision 16). Its presence — never a stored '
  'gate_eligible flag — is what completed onboarding means. Athlete capability, the '
  'Free entitlement and gate eligibility are derived from this plus public.athletes '
  'and public.profile_entitlements, all established in one transaction.';

create function private.profile_onboarding_guard_write()
returns trigger
language plpgsql
set search_path = public, pg_temp
as $$
begin
  raise exception 'conflict: Completed onboarding cannot be changed.';
end;
$$;

create trigger profile_onboarding_guard_update
  before update on public.profile_onboarding
  for each row execute function private.profile_onboarding_guard_write();

create trigger profile_onboarding_guard_delete
  before delete on public.profile_onboarding
  for each row execute function private.profile_onboarding_guard_write();

-- ---------------------------------------------------------------------------------
-- public.profile_entitlements — the commercial tier held by a Profile
--
-- Specification §6 and the glossary's Entitlement entry: an entitlement is not
-- inherently paid, and Free is a genuine entitlement. B0.2 knows exactly one tier —
-- `free` — granted by COMPLETED onboarding, never by authentication or Profile
-- creation alone. `revoked_at` exists so a grant can later be ended without deleting
-- the historical fact; nothing in B0.2 revokes one.
--
-- An entitlement is not an identity, not a permission and not a Team Function, and it
-- never transfers ownership of athlete data.
-- ---------------------------------------------------------------------------------

create table public.profile_entitlements (
  id uuid primary key default gen_random_uuid(),
  profile_id uuid not null references public.profiles (id) on delete restrict,
  tier text not null check (tier in ('free')),
  granted_at timestamptz not null default now(),
  revoked_at timestamptz
);

create unique index profile_entitlements_one_active_per_tier
  on public.profile_entitlements (profile_id, tier)
  where revoked_at is null;

create index profile_entitlements_profile_id_idx on public.profile_entitlements (profile_id);

comment on table public.profile_entitlements is
  'At most one ACTIVE entitlement per (Profile, tier). B0.2 supports the `free` tier '
  'only; the paid personal tier''s final commercial name is undecided and no name for '
  'it is introduced here.';
