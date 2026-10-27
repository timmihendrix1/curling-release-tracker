-- OWNER-OPERATED publication. Never a migration or automatic startup action.
-- Before execution, verify both new immutable pages are publicly deployed at
-- https://curling.evolane.me/legal/{privacy,terms}/2026-10-24 and approved.
-- Run with the migration-owning role, never a browser credential.
-- Allows first publication, an exact known predecessor pair, or an exact retry.
-- Unknown, partial and previously retired replacements fail without changing rows.
begin;
lock table public.legal_documents in share row exclusive mode;

do $$
declare
  v_count integer;
  v_matches integer;
begin
  select count(*) into v_count from public.legal_documents where retired_at is null;
  select count(*) into v_matches from public.legal_documents
  where retired_at is null and (
    (kind = 'privacy_notice' and version_label = 'privacy-2026-10-24'
      and document_url = 'https://curling.evolane.me/legal/privacy/2026-10-24'
      and effective_at = timestamptz '2026-10-24 00:00:00+02')
    or (kind = 'terms_of_service' and version_label = 'terms-2026-10-24'
      and document_url = 'https://curling.evolane.me/legal/terms/2026-10-24'
      and effective_at = timestamptz '2026-10-24 00:00:00+02')
  );
  if v_count = 2 and v_matches = 2 then return; end if;

  if exists (select 1 from public.legal_documents
      where version_label in ('privacy-2026-10-24', 'terms-2026-10-24')) then
    raise exception 'The replacement labels already exist in an unexpected state.';
  end if;

  if v_count <> 0 then
    select count(*) into v_matches from public.legal_documents
    where retired_at is null and (
      (kind = 'privacy_notice' and version_label = 'privacy-2026-08-28'
        and document_url in (
          'https://curling.evolane.me/legal/privacy/2026-08-28',
          'https://curling-release-tracker.vercel.app/legal/privacy/2026-08-28')
        and effective_at = timestamptz '2026-08-28 00:00:00+02')
      or (kind = 'terms_of_service' and version_label = 'terms-2026-08-29'
        and document_url in (
          'https://curling.evolane.me/legal/terms/2026-08-29',
          'https://curling-release-tracker.vercel.app/legal/terms/2026-08-29')
        and effective_at = timestamptz '2026-08-29 00:00:00+02')
    );
    if v_count <> 2 or v_matches <> 2 then
      raise exception 'Unexpected current Legal pair; inspect before publication.';
    end if;
    update public.legal_documents set retired_at = now() where retired_at is null;
  end if;

  insert into public.legal_documents (kind, version_label, document_url, effective_at)
  values
    ('privacy_notice', 'privacy-2026-10-24',
      'https://curling.evolane.me/legal/privacy/2026-10-24', timestamptz '2026-10-24 00:00:00+02'),
    ('terms_of_service', 'terms-2026-10-24',
      'https://curling.evolane.me/legal/terms/2026-10-24', timestamptz '2026-10-24 00:00:00+02');
end;
$$;
commit;

select kind, version_label, document_url, effective_at
from public.get_current_legal_documents();
