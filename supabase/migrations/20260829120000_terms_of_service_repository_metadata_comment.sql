-- ADR-0042 adds the first real Terms of Service content and immutable URL to the
-- repository. This forward migration updates database documentation only. It does
-- not publish a Legal row; publication remains an owner-operated post-deployment step.

comment on table public.legal_documents is
  'Immutable versioned Legal metadata (ADR-0025, ADR-0041 and ADR-0042). No real '
  'Legal row is inserted by a schema migration; approved rows are supplied '
  'operationally only after their external page is deployed and reviewed. Retirement '
  'is one-way; a correction is a new version row. Browser roles hold no table '
  'privilege here at all: all client access goes through get_current_legal_documents().';
