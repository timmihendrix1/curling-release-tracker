-- PREPARED ONLY: deploy and verify BOTH immutable pages before publication.
-- Does not activate the CH build flag, change existing acceptances, or infer country.
begin;
lock table public.legal_documents in share row exclusive mode;
do $$
declare v_count integer; v_matches integer;
begin
  select count(*) into v_count from public.legal_documents where retired_at is null;
  select count(*) into v_matches from public.legal_documents where retired_at is null and (
    (kind = 'privacy_notice' and version_label = 'privacy-2026-10-28-ch-beta'
      and document_url = 'https://curling.evolane.me/legal/privacy/2026-10-28-ch-beta'
      and effective_at = timestamptz '2026-10-28 00:00:00+01')
    or (kind = 'terms_of_service' and version_label = 'terms-2026-10-28-ch-beta'
      and document_url = 'https://curling.evolane.me/legal/terms/2026-10-28-ch-beta'
      and effective_at = timestamptz '2026-10-28 00:00:00+01')
  );
  if v_count = 2 and v_matches = 2 then return; end if;
  if exists (select 1 from public.legal_documents where version_label in
      ('privacy-2026-10-28-ch-beta','terms-2026-10-28-ch-beta')) then
    raise exception 'Replacement labels exist in an unexpected state; inspect before publication.';
  end if;
  select count(*) into v_matches from public.legal_documents where retired_at is null and (
    (kind = 'privacy_notice' and version_label = 'privacy-2026-10-27-posthog'
      and document_url = 'https://curling.evolane.me/legal/privacy/2026-10-27-posthog'
      and effective_at = timestamptz '2026-10-27 00:00:00+01')
    or (kind = 'terms_of_service' and version_label = 'terms-2026-10-27-posthog'
      and document_url = 'https://curling.evolane.me/legal/terms/2026-10-27-posthog'
      and effective_at = timestamptz '2026-10-27 00:00:00+01')
  );
  if v_count <> 2 or v_matches <> 2 then raise exception 'Unexpected current Legal pair; inspect before publication.'; end if;
  update public.legal_documents set retired_at = now() where retired_at is null;
  insert into public.legal_documents(kind,version_label,document_url,effective_at) values
    ('privacy_notice','privacy-2026-10-28-ch-beta','https://curling.evolane.me/legal/privacy/2026-10-28-ch-beta',timestamptz '2026-10-28 00:00:00+01'),
    ('terms_of_service','terms-2026-10-28-ch-beta','https://curling.evolane.me/legal/terms/2026-10-28-ch-beta',timestamptz '2026-10-28 00:00:00+01');
end;
$$;
commit;
select kind,version_label,document_url,effective_at from public.get_current_legal_documents();
