# Optional beta product analytics

Implementation scope authorized by the owner on 27 October 2026. This is product
usage analytics, separate from the athlete's sporting analysis.

## Approved Swiss beta entry — 28 October 2026

Tim confirmed that the initial testers are in Switzerland and explicitly approved
the following change. `NEXT_PUBLIC_POSTHOG_CH_BETA=1` selects a separately gated
Swiss beta notice; unset/other values retain explicit opt-in. Both modes still
require the existing analytics enable flag, public token and exact EU host.
The operator must restrict the cohort to Swiss testers before releasing this mode;
this flag is not geolocation or a country access-control mechanism. International
opening requires a new assessment. Do not infer location from language or IP.

For an installation without a saved choice, present an entry step before use:
"Continue" enables the limited analytics after the notice, while the equally
accessible "Continue without usage analytics" declines without restricting the app.
No SDK loading/initialization or provider traffic before this step. Existing v1
enabled preferences remain valid; existing null refusal/revocation tombstones stay
off and are never converted into acceptance. Malformed/unreadable storage fails
closed. Sign-out/account replacement remains off until a new explicit settings
choice; this does not silently reinstate the Swiss default.

Choice persistence, owner changes and stale asynchronous work must retain the
existing safeguards. Settings can disable analytics at any time. No backfill,
event/payload expansion, replay or sporting-persistence changes. Stages: preference
boundary and negative cases; entry/UI integration; new immutable legal versions,
guarded publication script and whole verification. No release/SQL execution is
performed by this local implementation request.

The new current legal drafts are dated `2026-10-28-ch-beta`; all older pages remain
immutable. They distinguish Swiss notice/objection from explicit consent elsewhere.
The 28 October DPA status was confirmed Signed; Tim approved manual deletion no
later than one year, earlier on purpose expiry or verified erasure request. The
provider retention window is not an automatic erasure mechanism.

## Contract

- PostHog EU project 319769; the three prepared private dashboards remain the
  reference for event names: first training success, feature use, weekly return.
- Disabled without explicit public build configuration and a saved analytics
  choice. Normal builds require opt-in; the Swiss beta build uses the approved
  entry step above. No SDK loading, initialization, SDK storage or provider requests
  before that step/choice. Refusing does not restrict training. Settings can stop it.
- The app stores the choice locally under the existing v1 key (v1 opt-in or v2
  explicit-opt-in/Swiss-notice record, null refusal). Malformed/unreadable preferences
  default to off. Genuine absence prompts only in Swiss mode. Sign-out/account change
  revokes the local choice and leaves a refusal tombstone. The choice is
  distinct from Terms acceptance and Privacy Notice acknowledgement.
- Consent uses the existing StorageAdapter with serialized writes; the SDK keeps
  event/identity state in memory and may persist its own local consent marker.
  No analytics cookies are used. SDK capture starts only after the application choice.
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
- No backfill: people enabling analytics after onboarding are absent from early funnel
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

The initial opt-in web build and legal pair were published on 28 October; the
new Swiss mode is not deployed by this implementation. SDK and application
verification do not establish physical iOS behavior. Verify
consent, refusal, withdrawal, account switching, offline operation and network
payloads on the actual distribution build before beta activation.

## Configuration and operation

The dependency is pinned to `posthog-js` 1.440.0. Shared code dynamically imports
the core `module.slim.no-external` entry only after the application choice. Set the public build
variables in the deployment/build environment (never commit real values):

- `NEXT_PUBLIC_POSTHOG_ENABLED=1` after activation prerequisites are complete.
- `NEXT_PUBLIC_POSTHOG_TOKEN`: project 319769's public write-only project token.
- `NEXT_PUBLIC_POSTHOG_HOST=https://eu.i.posthog.com` (other hosts fail closed).
- `NEXT_PUBLIC_POSTHOG_CH_BETA=1` selects the closed Swiss notice mode; default0
  retains explicit opt-in. Never enable it for an unrestricted international cohort.

The mobile public-variable allowlist includes these same names. Rebuild the native
artifact after configuring them. No personal PostHog API key belongs in a client.
This task does not edit `.env.local` or activate a production build.

The local `/privacy` and `/terms` aliases point to new immutable
`2026-10-28-ch-beta` pages. Old versions are byte-preserved. The guarded SQL snippet
`supabase/snippets/publish_ch_beta_legal_documents_2026_10_28.sql` is prepared only:
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

## Historical implementation verification — 27 October 2026

Uncommitted implementation based on `090af6f`, branch `codex/beta-new-users`:
full Vitest suite 388 files / 9,472 tests passed; Chromium browser suite 140 passed;
mobile verification 12 files / 285 tests plus typecheck and bundle passed.
TypeScript, ESLint, production web build, Apple manifest syntax and diff whitespace
checks passed. The browser analytics case exercised the actual SDK against locally
intercepted requests with a synthetic token: no request before consent, allowed
events and sanitised payloads after consent, and no further requests after withdrawal
and reload. No requests were sent to the real PostHog project.

That implementation verification was not an independent review or physical iPhone
test. The original opt-in web version and its legal pair were subsequently published
on 28 October. The new Swiss-mode SQL and pages remain local/prepared.

## Swiss beta risk assessment and operator scope

Approved purpose: locate friction in onboarding/training and feature use/return.
The fixed event whitelist and pseudonyms are proportionate to those questions;
raw sports results, notes, names, email, cross-site advertising, replay and automatic
click/page capture remain excluded. Identifiers are still personal data. DPA and
EU-region processing, IP discard, limited access, a manual maximum-one-year erasure
policy, earlier purpose-expiry/request erasure and an immediate objection control
are safeguards, not claims of anonymity or a universal legal exemption.

The operator must actually keep this cohort Swiss-only and review the remaining
provider-side processing and data-subject procedure. Switzerland is an explicit
owner statement, not inferred from browser locale. A CH build flag is not a legal
applicability detector or a technical signup restriction. The controller remains
responsible for the assessment; international expansion or more intrusive capture
requires a new decision. No claim of completed external legal review is made.

Sources checked on 28 October: [EDÖB March 2026 factsheet](https://www.edoeb.admin.ch/dam/de/sd-web/ByXs53ExpIEy/20260327%20Merkblatt%20Cookies_DE.pdf),
[EDÖB tracking guidance](https://www.edoeb.admin.ch/de/aus-belanglosen-daten-koennen-persoenlichkeitsprofile-entstehen),
[PostHog retention is not erasure](https://posthog.com/docs/data/events-retention).

## Local implementation verification — 28 October 2026

Starting and final Git base: `codex/beta-new-users` / `b2521b6`; local `main`
and `origin/main` remain `382ee40`. The starting tree was clean. All resulting
changes remain unstaged; no commit, push, production configuration change,
deployment or production SQL execution was performed for this Swiss-mode change.

Changed scope: analytics preference/runtime and identity entry composition;
the entry/Settings UI; public example/mobile configuration; new immutable Privacy
Notice and Terms routes with current aliases; guarded legal publication SQL;
architecture/persistence documentation and unit/browser tests. Existing dashboards,
event names and historical legal pages are preserved.

Verification: full Vitest **389 files / 9,482 tests passed**; final focused rerun
**5 files / 32 tests passed**; general Chromium suite **140 passed / 3 intentional
Swiss-mode skips**; separate Swiss-mode Chromium run **3 passed**, including actual
SDK requests intercepted locally, withdrawal/reload, previous refusal and mobile
button visibility. Mobile verification **12 files / 285 tests passed**, including
typecheck and production bundle. TypeScript, lint, web production build and
`git diff --check` passed. A sandbox-restricted mobile rerun could not start all
local browser/server checks; the subsequent permitted full rerun passed all 285.

The legal snippet passed a real disposable local PostgreSQL probe using the
repository's legal table, index, immutable guards and current-documents function:
expected rotation, idempotent retry, rollback for unexpected predecessors and
rejection of a partial target. The probe database was removed; production was
untouched. This does not claim a fresh full RLS audit.

Implementation corrections: the initial mobile notice was shortened so both
choices remain visible; an E2E assertion now checks available training rather than
an empty-history export; an existing reload test now waits for authenticated Home
before clicking Analyze. A test typing mismatch was corrected. Final checks pass.
This is implementation verification, not an independent code review, external
legal opinion or physical iPhone acceptance.

Release remains separate: publish and verify both immutable legal URLs, activate
the guarded legal pair, configure the CH-only build flag and verify the deployed
choice flow in the approved release sequence. Actual Swiss cohort restriction,
first real ingestion, provider erasure rehearsal and native/device/App Store
checks remain operator or release work; no analytics choice was made for Tim.
