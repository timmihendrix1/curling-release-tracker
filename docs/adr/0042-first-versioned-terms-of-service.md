# ADR-0042: The first Terms of Service is repository-versioned and activated operationally

## Status

Accepted and implemented for closed-beta release preparation (2026-08-29).

## Context

The mandatory identity gate requires separate acceptance of one server-authoritative
current Terms of Service and acknowledgement of the current Privacy Notice before
personal onboarding can complete. ADR-0025 established immutable Legal metadata and
acceptance evidence but deliberately authored no real Terms text or URL. ADR-0041 then
added the first Privacy Notice without supplying Terms.

The implemented closed beta is now sufficiently defined to state its actual service
rules: mandatory personal accounts, Free access with no billing, Profile-owned sporting
records, Team recording permission and attribution, curated exercises, restricted
Swiss Curling source assets, offline use after trusted onboarding, and beta limitations.
The product owner has identified Evolane Curling and `info@evolane.swiss`; no legal-form
or postal-address detail has been supplied and none is invented here.

## Decision

The immutable first version lives at `/legal/terms/2026-08-29`, identifies itself as
`terms-2026-08-29`, and is effective 29 August 2026. `/terms` is the human-friendly
current-document entry point. Server Legal metadata always points to the absolute HTTPS
URL of the immutable dated route, never the moving alias. Settings links to both Terms
and Privacy.

The Terms describe only the current no-charge closed beta. They cover the service and
account boundary, acceptable use, Team recording responsibilities, the limited service
permission needed for athlete-entered content, platform and Swiss Curling source
material, physical-training safety, availability and ending access, balanced warranty
and liability language, Privacy separation, version changes and Swiss law subject to
mandatory rights. They do not create billing, a paid subscription, an SLA, medical or
coaching advice, community publishing, a guardian workflow, ownership transfer, or a
right to redistribute restricted source assets.

The text does not attempt to override mandatory law. Liability that cannot lawfully be
excluded remains unaffected, and no exclusive venue is invented. A broader public or
paid release requires professional review, including operator identity/address,
eligibility and minors, account deletion, subscription and cancellation terms,
consumer-law application and the final production feature set.

Publication remains an owner-operated database action after the exact deployed page has
been verified. `supabase/snippets/publish_terms_of_service_2026_08_29.sql` inserts the
first metadata row under a relation lock and fails if active Terms already exist. It is
not a migration: schema application cannot assert that a public Legal page was deployed
and approved, while local automated tests retain isolated `example.invalid` fixtures.

ADR-0025 Decision 17 is superseded only where it says no real Terms text, URL or version
was authored. Its immutable evidence, one-snapshot acceptance, whole-response
validation, one-way retirement, atomic rotation and no-automatic-reacceptance decisions
remain unchanged.

## Consequences

- The Terms are publicly readable before authentication and can be opened from Settings.
- Accepted evidence remains pinned to the immutable dated route even after `/terms`
  later points to a newer in-repository version.
- Editing this version in place after activation is prohibited. A material correction
  requires a new dated page, version label and separately reviewed rotation.
- Deploying the page or applying migrations activates nothing. Both the Terms and
  Privacy owner-operated publication steps must succeed before first onboarding.
- This working closed-beta document is not a substitute for professional legal review
  before a broader audience, paid service or materially expanded data processing.
