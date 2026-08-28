-- OWNER-OPERATED PRODUCTION STEP — DO NOT ADD THIS FILE TO supabase/migrations.
--
-- Preconditions:
--   1. https://curling-release-tracker.vercel.app/legal/terms/2026-08-29
--      is deployed, publicly reachable without authentication and has been reviewed.
--   2. No current terms_of_service row exists. This first-version script deliberately
--      fails instead of retiring or replacing an unknown active version.
--   3. Run as the migration-owning database role. Browser roles have no Legal-table
--      write access by design.
--
-- The explicit relation lock conflicts with onboarding's SHARE lock. Publication can
-- therefore never interleave with completion's server-side resolution of the current
-- Legal pair. The transaction is all-or-nothing.

begin;

lock table public.legal_documents in share row exclusive mode;

do $$
begin
  if exists (
    select 1
    from public.legal_documents
    where kind = 'terms_of_service'
      and retired_at is null
  ) then
    raise exception 'Current Terms of Service already exist; use a separately reviewed atomic rotation.';
  end if;

  insert into public.legal_documents (
    kind,
    version_label,
    document_url,
    effective_at
  ) values (
    'terms_of_service',
    'terms-2026-08-29',
    'https://curling-release-tracker.vercel.app/legal/terms/2026-08-29',
    timestamptz '2026-08-29 00:00:00+02'
  );
end;
$$;

commit;

-- Postcondition (run separately): exactly this one row must be returned.
select kind, version_label, document_url, effective_at
from public.get_current_legal_documents()
where kind = 'terms_of_service';
