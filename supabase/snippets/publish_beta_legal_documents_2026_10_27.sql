-- Contact-address correction explicitly requested by the owner on 2026-10-27.
-- Deploy and verify BOTH new immutable pages before executing this separately.
-- Known 2026-10-24 predecessor pair or exact retry only; never rewrite acceptances.
begin;
lock table public.legal_documents in share row exclusive mode;
do $$
declare v_count integer; v_matches integer;
begin
  select count(*) into v_count from public.legal_documents where retired_at is null;
  select count(*) into v_matches from public.legal_documents
  where retired_at is null and (
    (kind = 'privacy_notice' and version_label = 'privacy-2026-10-27'
      and document_url = 'https://curling.evolane.me/legal/privacy/2026-10-27'
      and effective_at = timestamptz '2026-10-27 00:00:00+01')
    or (kind = 'terms_of_service' and version_label = 'terms-2026-10-27'
      and document_url = 'https://curling.evolane.me/legal/terms/2026-10-27'
      and effective_at = timestamptz '2026-10-27 00:00:00+01')
  );
  if v_count = 2 and v_matches = 2 then return; end if;
  if exists (select 1 from public.legal_documents
      where version_label in ('privacy-2026-10-27', 'terms-2026-10-27')) then
    raise exception 'The replacement labels already exist in an unexpected state.';
  end if;
  select count(*) into v_matches from public.legal_documents
  where retired_at is null and (
    (kind = 'privacy_notice' and version_label = 'privacy-2026-10-24'
      and document_url = 'https://curling.evolane.me/legal/privacy/2026-10-24'
      and effective_at = timestamptz '2026-10-24 00:00:00+02')
    or (kind = 'terms_of_service' and version_label = 'terms-2026-10-24'
      and document_url = 'https://curling.evolane.me/legal/terms/2026-10-24'
      and effective_at = timestamptz '2026-10-24 00:00:00+02')
  );
  if v_count <> 2 or v_matches <> 2 then
    raise exception 'Unexpected current Legal pair; inspect before publication.';
  end if;
  update public.legal_documents set retired_at = now() where retired_at is null;
  insert into public.legal_documents(kind,version_label,document_url,effective_at) values
    ('privacy_notice','privacy-2026-10-27',
      'https://curling.evolane.me/legal/privacy/2026-10-27',timestamptz '2026-10-27 00:00:00+01'),
    ('terms_of_service','terms-2026-10-27',
      'https://curling.evolane.me/legal/terms/2026-10-27',timestamptz '2026-10-27 00:00:00+01');
end;
$$;
commit;
select kind,version_label,document_url,effective_at from public.get_current_legal_documents();
