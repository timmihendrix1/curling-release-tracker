# ADR-0041: The first Privacy Notice is repository-versioned and activated operationally

## Status

Accepted and implemented for closed-beta release preparation (2026-08-28).

## Context

The identity gate already requires one server-authoritative current Privacy Notice before
it offers sign-in. Onboarding displays that same immutable metadata snapshot and records
an acknowledgement of its exact id. ADR-0025 deliberately left the real text, URL,
controller, retention and international-processing claims outside the repository until
the product and its data flows were sufficiently defined.

The closed beta now has implemented identity, Profile-scoped local and cloud sporting
records, Teams, exercise execution and mixed Training Plans. The product owner has named
Evolane Curling as controller and `info@evolane.swiss` as its privacy contact. A first,
plain-language notice can therefore describe current processing without pretending the
later public product, billing, sensors, video, youth workflow or community library already
exists.

## Decision

The immutable first version lives at
`/legal/privacy/2026-08-28` and identifies itself as `privacy-2026-08-28`, effective
28 August 2026. `/privacy` is the human-friendly current-document entry point, while
server Legal metadata must always point to the immutable versioned route. Settings links
to `/privacy`; the identity gate continues to render only the URL supplied by its
validated server snapshot.

The notice is an acknowledgement document, not consent. It describes the current data
categories, sources, purposes, required data, recipients, international processing,
retention criteria, browser storage, rights, automated-statistics boundary, security and
contact. It states the current negative boundaries: no sale, no advertising use, and no
video or sensor collection in this beta. Future functionality may not be silently read
into this version.

Publication remains an owner-operated database action after the exact deployed page has
been verified. `supabase/snippets/publish_privacy_notice_2026_08_28.sql` inserts the first
metadata row under a relation lock and fails if an active Privacy Notice already exists.
It is deliberately not a migration: a fresh local database and CI continue to use only
their explicit `example.invalid` fixtures, and applying application schema must never
assert that an external legal page was deployed and approved.

ADR-0025 Decision 17 is superseded only where it says that no real Privacy Notice text,
URL, version, controller, retention or transfer claim is authored in the repository.
Its immutable metadata, whole-response validation, safe-URL, one-snapshot evidence,
one-way retirement, atomic rotation and no-automatic-reacknowledgement decisions remain
unchanged.

## Consequences

- The Privacy Notice is public before authentication and can be read from Settings.
- Its exact acknowledged version remains stable even after `/privacy` later points at a
  newer notice.
- Editing this version in place after activation is prohibited. A material correction is
  a new dated route, new version label and separately reviewed atomic database rotation.
- The snippet does not activate Terms of Service. ADR-0042 supplies the separately
  versioned first Terms text and its own owner-operated publication step; neither
  document activates the other.
- Legal review before a broader or public release remains necessary, especially for
  exact retention periods, subprocessors and hosting regions, account deletion, minors,
  billing, sensors, video, AI and public/community content.
