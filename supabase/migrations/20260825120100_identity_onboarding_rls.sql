-- Stage B0.2a — Identity and Onboarding: Row Level Security and table privileges.
--
-- Executed and verified against a real local Supabase Postgres — see the schema
-- migration's header note and supabase/tests/README.md.
--
-- Design, stated once: every mutation of the four new tables goes through a SECURITY
-- DEFINER RPC (the next migration). No new table grants INSERT, UPDATE or DELETE to
-- `authenticated` or `anon` at all, so the absence of a write policy is not an
-- omission — it is the enforcement.
--
-- Privileges vs. policies (the same rule the Team Foundation RLS migration records): an
-- RLS policy NARROWS an access the table ACL already permits; it never GRANTS one. A
-- role with no table-level SELECT privilege is rejected at the ACL check before any
-- policy is consulted, so a SELECT policy with no matching grant is dead code. The
-- explicit grant block below is therefore load-bearing.
--
-- The REVOKE comes first so the resulting ACL is independent of whatever default
-- privileges are configured for the migration-owning role in the target project: the
-- same boundary results on a fresh local reset and on any other project.
--
-- This migration does not touch, broaden or restate any existing `profiles`,
-- `athletes`, `account_profile_links` or Team Foundation policy or grant.

alter table public.legal_documents enable row level security;
alter table public.legal_acceptances enable row level security;
alter table public.profile_onboarding enable row level security;
alter table public.profile_entitlements enable row level security;

-- ---------------------------------------------------------------------------------
-- Table-level privileges (the ACL layer beneath RLS)
--
--   * `anon` receives NO direct table privilege of any kind on any new table. A
--     signed-out direct read fails closed at the ACL check with `permission denied`,
--     which is a strictly smaller surface than granting SELECT and relying on a policy
--     to return zero rows.
--   * `authenticated` receives NO INSERT/UPDATE/DELETE on any new table.
--   * `authenticated` receives SELECT on legal_acceptances, profile_onboarding and
--     profile_entitlements only, and every one of those reads is narrowed to the
--     caller's own Profile by the policies below.
--   * `public.legal_documents` receives NO browser grant at all. It is reachable only
--     through `get_current_legal_documents()`, so the client can never read a retired
--     row, a draft row, or the `retired_at`/`published_at` columns, and can never
--     assert for itself what is current (ADR-0025 Decision 17: "The current documents
--     are resolved server-side; a client never asserts what is current").
-- ---------------------------------------------------------------------------------

revoke all on table
  public.legal_documents,
  public.legal_acceptances,
  public.profile_onboarding,
  public.profile_entitlements
from public, anon, authenticated;

grant select on table
  public.legal_acceptances,
  public.profile_onboarding,
  public.profile_entitlements
to authenticated;

-- ---------------------------------------------------------------------------------
-- Own-Profile SELECT policies
--
-- Every one derives the caller's Profile through `private.current_profile_id()` — the
-- existing SECURITY DEFINER helper that resolves `account_profile_links` from
-- `auth.uid()`. A caller-supplied Profile id is never trusted anywhere in this
-- feature. A caller whose account has no Profile resolves to NULL, and `profile_id =
-- NULL` is never true, so such a caller sees zero rows rather than every row.
--
-- Cross-Profile reads therefore return zero rows rather than an error: these are
-- ordinary own-data reads, and a "permission denied" for someone else's row would leak
-- the fact that the row exists.
-- ---------------------------------------------------------------------------------

create policy legal_acceptances_select_own on public.legal_acceptances
  for select
  to authenticated
  using (profile_id = private.current_profile_id());

create policy profile_onboarding_select_own on public.profile_onboarding
  for select
  to authenticated
  using (profile_id = private.current_profile_id());

create policy profile_entitlements_select_own on public.profile_entitlements
  for select
  to authenticated
  using (profile_id = private.current_profile_id());

-- `public.legal_documents` intentionally has NO policy. With RLS enabled and no
-- browser grant, both layers deny independently: the ACL check rejects the read before
-- any policy would be consulted, and adding a grant later without a policy would still
-- deny. The table owner (which every SECURITY DEFINER function in the next migration
-- runs as) bypasses RLS, which is how get_current_legal_documents() reads it.
