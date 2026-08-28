# ADR-0034 — Team Exercise eligibility cache and permission UI

**Status:** Accepted and implemented as Exercise Stage C2c (2026-08-28). ADR-0035 adds
the Profile-scoped active Team draft and ADR-0036 uses this cache for setup/capture;
ADR-0037 now implements athlete result/private-note reads. Revisions, voiding and
notifications remain later Stage C work.

## Context

Team execution must work without a live rink connection, but only when the device
already knows the active Team roster and the latest visible recording-permission state.
ADR-0032 provides the RLS read boundary and athlete-owned mutation; ADR-0033 did not
read, cache or present those facts.

## Decision 1 — cache one bounded server-observed start snapshot

The existing Profile-scoped sporting sync record advances from schema 2 to schema 3.
It retains personal and Team upload entries unchanged and adds
`teamEligibilitySnapshots`: Team id/name, observation time and the active roster's
Profile id, display name, Team player flag, Team functions and current prospective
recording-permission flag. Email, invitations and administration data are never cached.

Schemas 1 and 2 migrate deterministically with an empty eligibility list. Invalid UUIDs,
timestamps, functions, blank names or duplicate Team/Profile identities fail the entire
sync-state load closed. The immutable Profile namespace prevents one account from seeing
another account's cached roster.

## Decision 2 — combine two independently authorised reads

`TeamService.getTeamWorkspace` supplies the active roster. A new provider-neutral
`listActiveRecordingPermissions` operation reads only currently active rows visible
through ADR-0032's Team-member RLS policy. The sync manager intersects permission rows
with the current roster, writes the complete snapshot durably and only then publishes it
to the application. An offline or failed refresh leaves the previous snapshot intact.

The cache is start eligibility, not cloud authority. Upload continues to authenticate
the recorder and revalidate Team, membership and permission independently for every
athlete bundle. A stale grant can therefore permit local capture but can never force
cloud acceptance.

## Decision 3 — each athlete controls only their own prospective permission

The Team workspace shows one calm, explicit permission control for the authenticated
Profile. It explains that permission applies to future shared Exercise capture and does
not share existing history or analytics. The control calls the existing athlete-owned
RPC; after success, only the authenticated Profile's cached row is changed. When the
current state cannot be confirmed, the UI offers no guessed toggle and asks the athlete
to reconnect and reopen the Team.

## Consequences and non-goals

- A previously refreshed Team can supply the roster and latest known eligibility facts
  to a later offline Team start flow.
- This slice itself did not persist an in-progress Team draft; ADR-0035 subsequently
  adds that boundary and ADR-0036 now starts/renders capture from this cache.
- It does not grant result viewing, analytics access or Coach authority.
- Snapshot age is visible data for later UI policy; no unapproved expiry duration is
  invented here.

## Verification

Tests cover schema-1/schema-2 migration, strict snapshot parsing, duplicate rejection,
RLS-query mapping, malformed permission rows, durable refresh, offline retention,
Profile isolation, self-only cached mutation and the Team workspace permission action.
