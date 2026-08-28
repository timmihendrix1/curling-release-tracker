-- ADR-0041 supersedes ADR-0025 only where the earlier table comment said that no
-- real Privacy Notice content or URL was authored in the repository. This forward
-- migration updates database documentation without publishing a Legal row. The first
-- real row remains an explicit owner-operated action after deployment verification.

comment on table public.legal_documents is
  'Immutable versioned Legal metadata (ADR-0025 Decision 17 and ADR-0041). No real '
  'Legal row is inserted by a schema migration; approved rows are supplied '
  'operationally only after their external page is deployed and reviewed. Retirement '
  'is one-way; a correction is a new version row. Browser roles hold no table '
  'privilege here at all: all client access goes through get_current_legal_documents().';
