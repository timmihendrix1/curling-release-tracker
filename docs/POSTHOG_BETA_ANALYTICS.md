# Optional beta product analytics

Implementation scope authorized by the owner on 27 October 2026. This is product
usage analytics, separate from the athlete's sporting analysis.

## Contract

- PostHog EU project 319769; the three prepared private dashboards remain the
  reference for event names: first training success, feature use, weekly return.
- Disabled without explicit public build configuration and separate voluntary
  consent. No SDK initialization, storage by the SDK or provider requests before
  consent. Refusing does not restrict training. Consent can be withdrawn in Settings.
- The app stores the consent choice locally. Clear/malformed/unreadable consent
  defaults to off. Sign-out/account change revokes the local choice. Consent is
  distinct from Terms acceptance and Privacy Notice acknowledgement.
- Consent uses the existing StorageAdapter with serialized writes; the SDK keeps
  event/identity state in memory and may persist its own local consent marker.
  No analytics cookies are used. SDK opt-in happens only after application consent.
- Only the eleven prepared events are allowed. No automatic page/click capture,
  replay, heatmaps, surveys, feature flags, console/network logs or exceptions.
- No names, emails, free text, measurements, Team/member identifiers, URLs,
  invitation/OTP tokens or sporting record identifiers leave the app. Record IDs
  may be used only for in-memory deduplication. Stable pseudonymous profile IDs
  are derived with SHA-256; this is pseudonymisation, not anonymisation.
- Training/exercise/plan starts follow accepted user transitions, not hydration.
  Completion events require local persistence acknowledgement. Failed saves,
  abandoned Assessments, restore and cloud sync do not fabricate completions.
- Analytics is best effort and never awaited by sporting storage. No durable
  analytics outbox is introduced. Offline/process-stop events may be lost. Delayed
  SDK loads and callbacks cannot cross consent revocation or account ownership.
- The Team recorder is the app user; participants do not become active users.
- No backfill: people consenting after onboarding are absent from early funnel
  steps. The funnel is per user across 14 days, not a per-Session completion rate.

## Stages and release checks

1. Consent/runtime boundary and SDK configuration, with negative-case tests.
2. Shared web/native UI and explicit domain event hooks with save-ACK coverage.
3. New immutable legal versions and public configuration contract; full repository,
   mobile and browser verification. Historical legal pages remain unchanged.

Provider activation is separate from local implementation: configure the EU project
token and enable flag only after the controller has signed the PostHog DPA, reviewed
the new Privacy Notice and App Store privacy disclosures, and verified deployment
of the new legal URLs. No production deployment, SQL publication, account-wide
contract acceptance or real-user test transmission is authorized by this code task.

Beta erasure process approved by Tim on 27 October 2026: manually verify requests and
remove the person's analytics history in PostHog using their analytics identifier.
The in-app sporting-account finalizer does not itself call PostHog. The notice must
explain the separate request channel and must not promise automated provider erasure.
Before live collection, establish and test this operator process and retention.
Automatic coupling to account deletion is outside the approved beta scope; no
additional privileged server-side PostHog API access is required for this scope.

SDK and application verification do not establish physical iOS behavior. Verify
consent, refusal, withdrawal, account switching, offline operation and network
payloads on the actual distribution build before beta activation.

## Configuration and operation

The dependency is pinned to `posthog-js` 1.440.0. Shared code dynamically imports
the core `module.slim.no-external` entry only after consent. Set the public build
variables in the deployment/build environment (never commit real values):

- `NEXT_PUBLIC_POSTHOG_ENABLED=1` after activation prerequisites are complete.
- `NEXT_PUBLIC_POSTHOG_TOKEN`: project 319769's public write-only project token.
- `NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com` (other hosts fail closed).

The mobile public-variable allowlist includes these same names. Rebuild the native
artifact after configuring them. No personal PostHog API key belongs in a client.
This task does not edit `.env.local` or activate a production build.

The current public `/privacy` and `/terms` aliases point to new immutable
`2026-10-27-posthog` pages. Old versions are byte-preserved. The guarded SQL snippet
`supabase/snippets/publish_posthog_legal_documents_2026_10_27.sql` is prepared only:
deploy and verify both URLs before separately executing it. Existing legal evidence
is never rewritten. These Terms do not turn document acknowledgement into consent.

The Apple privacy manifest declares optional Product Interaction and User ID for
Analytics, linked to the user, without advertising tracking. Reconcile the App
Store Connect privacy questionnaire before submitting the distribution build.

For verified erasure requests, derive the stable identifier with
`analyticsProfileId(profileId)` (SHA-256 of `evolane-posthog-v1:` plus the Profile
UUID, hex prefixed by `profile_`). Locate the person in this EU project, delete
their events as well as the person, and verify completion through PostHog. This
also addresses other installations using that Profile. If consent was given
before onboarding but onboarding never completed, use the displayed anonymous
identifier while available. Do not put either identifier or raw request details
into general project notes. Erasure requires a verified request and the operator's
authorized provider access; never ship a privileged erasure key in the app.

Official implementation references checked on 27 October 2026:
[JS SDK](https://posthog.com/docs/libraries/js),
[consent/reference](https://posthog.com/docs/references/posthog-js),
[privacy/DPA](https://posthog.com/docs/privacy),
[Apple privacy details](https://developer.apple.com/app-store/app-privacy-details/).

## Local verification — 27 October 2026

Uncommitted implementation based on `090af6f`, branch `codex/beta-new-users`:
full Vitest suite 388 files / 9,472 tests passed; Chromium browser suite 140 passed;
mobile verification 12 files / 285 tests plus typecheck and bundle passed.
TypeScript, ESLint, production web build, Apple manifest syntax and diff whitespace
checks passed. The browser analytics case exercised the actual SDK against locally
intercepted requests with a synthetic token: no request before consent, allowed
events and sanitised payloads after consent, and no further requests after withdrawal
and reload. No requests were sent to the real PostHog project.

This is implementation verification, not an independent review, physical iPhone
test or production activation. The SQL publication script has not been executed;
the new legal pages have not been deployed by this task.
