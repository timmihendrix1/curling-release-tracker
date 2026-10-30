# Apple review access

## Approved decision and scope (2026-10-30)

The owner approved **a password session for exactly one administratively selected
Supabase Auth user**, exclusively for Apple's review in the **native iPhone /
TestFlight new-user beta** (scope confirmed 2026-10-30). Web review-password access
is not approved. The public Web provider refuses it before SDK invocation; the
Web coordinator does not start a review transition or modify a valid OTP/Google
session. Only the original privately owned native new-user host can enable this
mechanism. Display hiding, platform claims and public enable options are not
authority. All other accounts must be
unable to obtain a password-authenticated session, including through direct Auth
API calls. This is an authentication restriction, **not a global prohibition on
storing or changing a password in Supabase**. A normal user who has independently
proved access by email may still store a password; that password must not enable
password sign-in.

Native-only describes the supported application entry, not server-side device
attestation. The unchanged server policy can still issue a token for the selected
review UUID through a direct Auth API call with its valid credentials. It does not
trust a user-agent or Capacitor flag. No device-attestation service or proxy is
introduced; the server continues to enforce the one-account restriction.

Normal sign-in remains email OTP on iOS, and email OTP plus Google on Web. A later
native iPhone client stage adds a visible "Access for app review" link and a separate email and
password form. It must not add general password signup, reset, or password settings.
The review account has ordinary user permissions and synthetic data only. Existing
Profile, legal acceptance, account status/deletion and local identity barriers apply
unchanged. No static OTP, hard-coded credential, service-role session minting,
provider-session shortcut, or access to another athlete is permitted.
The beta remains new-user-only with a safe first start and no import. Review password
authentication grants no installation transfer or fresh-email-OTP recovery authority;
those existing flows must never accept this method as email-possession proof.

This is the narrow platform-review exception to deferred password support in
`CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` §5.4/§16/§17.1. It does not
activate general password authentication or change Google support.

## Stages and independent gates

1. Server policy: versioned SQL, protected zero-or-one account configuration,
   Custom Access Token Hook, real isolated Postgres/Auth integration and failure
   tests; independent read-only review before client work.
2. Native-only provider mechanics and the actual identity coordinator: correlated
   attempts, durable barriers, private credential ownership, normal admission and
   negative/race tests; independent review.
3. Review sign-in UI, full browser journeys, documentation reconciliation and
   independent review. The current UI is unchanged in Stage 1.
4. Provision a real review account, configure the hosted hook, test on device,
   upload a new build, supply Apple with working credentials and submit. These
   are separate operational actions, not completed or authorized by a SQL file.

## Server contract

`private.apple_review_password_account` contains zero or one Auth UUID. Its
singleton constraint and foreign key enforce cardinality and identity existence.
Only a database administrator can write it. Auth reads it through narrowly granted
SELECT; anonymous, authenticated and service-role API users cannot read, modify,
or execute the hook. Membership comes from this table, never email, request input
or user-editable metadata. No production UUID or credential is seeded.

The Custom Access Token Hook validates trusted provider event shape, identity and
authentication evidence before returning the original claims. Password sign-in,
unverified automatic email/signup sign-in, and refresh of those sessions require
the allowed UUID. Missing, malformed or unknown authentication evidence fails
closed. Genuine email OTP, recovery/email proof and OAuth are not relabelled as
password authentication. A token refresh must retain valid provider AMR evidence.

The allowlist is consulted only for a password or unverified-signup-derived
session: an empty/missing/unreadable allowlist closes those flows, while genuine
OTP/OAuth does not depend on that table. A failure of the hook itself prevents new
access tokens, including OTP/OAuth. Denying a password login must not sign out or
revoke the account's separate legitimate OTP session.

**Required hosted precondition:** email confirmation must be enabled. GoTrue's
automatic email confirmation can issue `email/signup` tokens for new OTP users
without a fresh mailbox proof; the hook deliberately denies that flow for normal
accounts. Do not enable the hook against that configuration. The repository's
ordinary local Supabase defaults remain unchanged; isolated policy tests configure
their own confirmation-required Auth instance and actual six-digit email templates.

## Activation, revocation and rollback

The migration creates policy objects but does **not** configure or activate a hook.
Before hosted activation, inspect the actual Auth version, existing hook, email
confirmation and supported providers; do not overwrite an existing custom hook.
Apply/review the migration, provision one ordinary confirmed Auth account with
synthetic data, then configure its UUID administratively. Store its random strong
password outside code, reports, logs and the vault. Activate the function
`public.apple_review_access_token_hook` as the project's Custom Access Token Hook.
Verify real OTP, Google (where enabled), review password/refresh and denied ordinary
password flows before making the client available. No hosted state was inspected
or changed by Stage 1.

Before release, reconcile password-specific Privacy Notice, security and review
documentation statements with the implemented behavior. This is a required review,
not authority to edit legal text, publish a new legal version or change the active
legal-document pair. Password input, verification codes and raw Auth responses must
never reach analytics, application logs, reports or user-facing error details.

Removing the row denies subsequent review password login and password-session
refresh. It does not retroactively invalidate already issued stateless access JWTs;
they remain valid until expiry, and previously admitted local offline access is a
separate existing application boundary. A hard stop additionally requires normal
provider session revocation/account controls and the app's existing status handling.
Do not claim immediate deletion or global logout from deleting an allowlist row.

Rotate the review password using trusted administrative tooling and revoke old
sessions deliberately; do not assume changing a password revokes every token.
Replacing the UUID is one transaction over the singleton and requires the previous
review account's session lifecycle to be handled separately. Account deletion
cascades the allowlist row and does not authorize deleting other accounts.

Do not recover from a hook problem by silently disabling the policy: that would
restore password authentication for any existing password-bearing account. For a
safe rollback first withdraw the new client/review access, clear the allowlist and
revoke review sessions, retain or restore the last known-good restricting hook,
and verify ordinary OTP/OAuth. If removing the hook is unavoidable, an explicitly
reviewed provider-level replacement restriction is required before removal. Never
drop the function/table while hosted Auth still references it. Existing JWT expiry
and local offline limitations still apply.

## Verification boundaries and sources

Stage 1 must test the **actual migration** against isolated Postgres and GoTrue:
constraints/FK/grants/RLS; real six-digit OTP request/verify/refresh; review password
and refresh; direct ordinary password grant after authenticated password changes
and recovery; signup with confirmation both on/off; rejection without new session
or refresh rows; UUID absence/replacement, malformed AMR/metadata, denied direct
hook execution, missing table/permissions and hook faults. SQL fixture events may
prove branch validation but are not an end-to-end OAuth test.

Google's external provider round trip requires real provider credentials and remains
an explicit pre-rollout check if unavailable locally. No forged OAuth session may
be presented as evidence of Google compatibility. No app/device review, production
hook activation, account provisioning or Apple approval follows from local tests.

Official references (consulted 2026-10-30):

- [Custom Access Token Hook](https://supabase.com/docs/guides/auth/auth-hooks/custom-access-token-hook)
- [Hook availability, permissions and errors](https://supabase.com/docs/guides/auth/auth-hooks)
- [Authenticated password updates](https://supabase.com/docs/reference/javascript/auth-updateuser)
- [Password authentication](https://supabase.com/docs/guides/auth/passwords)
- [User deletion and outstanding JWTs](https://supabase.com/docs/guides/auth/managing-user-data)

The dedicated Password Verification Hook is currently documented for Teams and
Enterprise. This design uses the available Custom Access Token Hook and does not
authorize a paid plan change. Current hosted plan/configuration is not assumed.

## Current implementation boundary

Stage 1 is locally verified and independently reviewed; it remains unstaged and
unactivated. The migration creates
the empty singleton and hook; `scripts/test_apple_review_access.py` applies the full
actual migration chain in private disposable GoTrue/Postgres/Mailpit containers.
The script uses only cached images, isolated random names and loopback ephemeral
ports, generates and verifies real six-digit emails, and verifies its own cleanup.
Run it with `python3 scripts/test_apple_review_access.py`; its default sanitized
result is `/tmp/curling-review-access-result.json`. It never resets or stops an
existing local Supabase project. Its confirmation-required configuration is private
to those test containers. No repository Auth defaults or production settings are changed by Stage 1.

Stage 2 adds the separate `review_password` interactive method and
`signInForReview` action over the original native new-user provider client. Web
and legacy/import owners report this action unavailable without invoking the
password SDK operation. The native coordinator first
persists the ordinary barrier and a credential-free attempt, proves ownership
before and after the provider call, and persists/rechecks the matching resolution
before the existing Profile/legal/onboarding/account/admission path can proceed.
A `SIGNED_IN` event alone still grants nothing. Both durable validators explicitly
accept this method only with a null callback selector; old OTP/Google records are
unchanged. Native execution uses the original reserved SDK and credential store,
a bound command and the exact configured Auth endpoint. Only the review-password
command in the original native new-user host permits the password grant; other
auth grants/routes are not broadened. A module-private construction capability
enables the shared mechanics only there. Derived availability is an observation,
not a public enable flag. Web refusal happens before claiming coordinator
ownership, writing a barrier/attempt or touching the SDK password method.
Unavailable attempts leave an existing Web OTP/Google session and gate intact.
The installation-transfer OTP authority rejects this action; no fresh-email proof
is minted by password authentication or its onboarding continuation. Passwords
remain transient call arguments and are never put in identity records, diagnostics
or analytics; only the normal SDK session is retained.

Stage 2 is independently reviewed locally. Stage 3 adds the native-only
“Access for app review” entry and a separate email/password form. Presentation
observes the existing coordinator/host capability; it does not enable it. Back
clears the form, submission clears credentials and blocks duplicate requests,
and a changed presentation owner/capability discards the form. Ordinary Profile
and legal onboarding remain mandatory. No review account, hosted hook, native
installation or Apple submission is provisioned by this UI.

**Legal review before provisioning:** the current Terms (2026-10-28 CH beta,
account responsibilities) say to use only one's own sign-in method and not share
codes or access. A dedicated operator-provisioned account for Apple's reviewers
has a different purpose from sharing an athlete's account, but that distinction
is not explicit in the text. The owner has already approved this operator-provided Apple review purpose;
that product decision is not open again. Compatibility of the exact legal wording
has not received legal acceptance. Any concrete legal-text revision, if needed,
requires its own explicit decision. The current
Privacy Notice describes the first iOS beta's email-code sign-in; reconcile that
scope statement with the narrow review exception. No legal page, version or active
pair has been changed; these findings are not legal approval.

The preferred `npm run test:e2e` entry creates an owned disposable stack and a
hash-checked copy of current approved source. Explicit loopback endpoints and
registered container IDs plus random labels replace shared CLI defaults. The
retired preflight refuses to reset any database. The runner uses the installed
Brave browser with private state, disables trace/video/screenshots, runs serially,
and makes cleanup/preservation failures fail the run. Every Python HTTP request
uses an explicit proxy-free loopback transport that refuses redirects; no global
urllib opener is changed. Cleanup verifies the whole original process group,
including TERM-resistant descendants after their parent exits. `--ch-beta` runs the three
Swiss analytics scenarios separately. Runtime secrets and browser state are
deleted; only sanitized counts, source hashes and cleanup evidence remain.
Positive native UI integration uses the original NewUserNativeOwner and actual
disposable SQLite with synthetic platform/HTTP edges; it is not a physical-device
test. The complete browser suite uses Web and verifies absence of review UI.

Stage 3 is fully verified locally, including the isolated Web browser gate and
native-owner UI integration. Hosted configuration/provisioning, a real external
Google round trip, physical-device acceptance and Apple submission remain separate
release gates; local verification does not complete them.
