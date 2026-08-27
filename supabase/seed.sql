-- LOCAL AUTOMATED-TEST FIXTURES ONLY.
--
-- These example.invalid rows are not approved Terms or Privacy documents, are not
-- a production Legal version, and must never be deployed to a hosted environment.
-- They exist solely so Playwright can exercise the real server-authoritative legal
-- snapshot and onboarding evidence path after `supabase db reset --local`.

insert into public.legal_documents (kind, version_label, document_url, effective_at)
values
  ('terms_of_service', 'e2e-fixture-terms-v1', 'https://example.invalid/e2e/terms-v1', now()),
  ('privacy_notice', 'e2e-fixture-privacy-v1', 'https://example.invalid/e2e/privacy-v1', now());
