# ADR-0052: Recoverable account deletion and personal export

## Status

Implemented locally under the user's 24 October 2026 completion mandate and the
confirmed decisions in `BETA_COMPLETION_SPECIFICATION.md`. The local beta-completion
package passed independent review after the denial/interleaving, historical
anonymization and export-inventory corrections. Production migration/publication
and physical-device acceptance remain open. Evidence is recorded in
`TESTFLIGHT_READINESS.md`.

## Decision

Use one server-owned pending request per Profile with exactly 30 days of recovery.
Request and cancellation require a provider-signed authentication-method timestamp
within five minutes; token refresh issuance alone grants no fresh authentication.
Requests bind an expected Profile, cancellation binds the exact request UUID, and
the existing identity coordinator owns every OTP and durable local denial. No
second session controller or browser-accessible administrative deletion API exists.

`private.current_profile_id()` excludes pending accounts. All existing sporting and
Team authorization paths therefore deny application authority while the owner can
still authenticate to inspect/cancel the request. The current installation's durable
identity denial precedes the request RPC. Other offline installations cannot learn
a remote change until they contact the server; existing offline-trust rules are
unchanged. No replacement account adopts the deleted Profile, even with the same
email address.

The local request additionally writes a Profile-bound deletion-operation guard
before either identity invalidation or HTTP. Normal OTP/OAuth, sign-out and
trusted-record replacement cannot resolve it. Every ready path (including
offline startup, retry and background revalidation) checks it. A resolution lives
under its own operation nonce, never by deleting the shared Profile slot; a late
resolution therefore cannot erase another tab's newer guard. Unreadable,
malformed or future evidence denies admission. Storage events revoke an observed
guard in mounted tabs under the existing cross-tab observation guarantee; this
does not claim instantaneous atomic revocation across browser tabs.

A pending status is delivered to the identity owner before local guard I/O, so
failed or unanswered storage cannot suppress a definitive in-memory denial.
The observer is bound to the captured reducer state; a superseded observation
performs no local guard write and cannot revoke a later admission. Reducer events
retire this ownership synchronously, including while React batches rendering.
Once a current observation begins denial, the coordinator's existing terminal
invalidation rules apply. Failed durable evidence remains honestly unavailable.
Recovery reads never start foreground authentication; the current gate's explicit
action owns retry. Deletion preflight and export delivery also retire across an
A → B → A admission change.

The server maintains a per-Profile cancellation revision. A request names the
revision observed before writing its local guard. Explicit, recently authenticated
cancellation increments it under the lifecycle fence, so delayed old requests
cannot recreate deletion. Recovery after a crash/lost acknowledgement must first
run a recently authenticated conditional abort of the current server revision:
it increments the revision only when no committed pending request exists. Neither
an empty status nor a newer revision alone can release a guard: a delayed old
slot write might have overwritten a newer operation's guard. Recovery never automatically
cancels a committed pending deletion. Overlapping local slot writes are safe
because recovery fences every request with the current observed server revision;
nonce-specific resolution preserves any newly started operation. Unrelated
Profiles keep their own admission state.

These two new dynamic identity-control families are outside the dormant native
migration and installation-transfer v1 inventory. Those candidates must refuse
them until the separately reviewed native integration carries them losslessly;
omitting them during migration would erase durable deletion denial.

A privileged transactional worker removes the authentication account, link, own
sporting records, Team result bundles/revisions, private notes, legal/onboarding
evidence and capabilities only after the recovery deadline. It preserves other
athletes' exact raw records and their private notes. Shared relationships retain
only the unlinked `Deleted athlete` Profile reference. Invitations/audit metadata
are scrubbed and all affected current Team members and historical shared-session
participants receive one neutral notification without reason or performance data.
Pending loss of the final usable Admin immediately puts a Team in restricted
recovery; cancellation restores only recovery created by this lifecycle when a
usable Admin returns.
Historical invitation addresses are identified through accepted memberships and
same-address replacement ancestry. Their invitation/audit references are scrubbed
before rewriting addresses. Matching historical email text globally is forbidden:
a later owner of a reused address must keep their unrelated invitation history.

Ordinary authority checks hold a shared transaction fence. Lifecycle mutations
take its exclusive counterpart before Profile/Team/row locks. This deliberately
serializes these rare beta lifecycle operations against ordinary transactions:
an already-authorized upload finishes before denial, and a queued upload reads
fresh authority after denial. The lookup is volatile to obtain a fresh snapshot
after waiting. This is preferable to incomplete per-table checks that allow
an in-flight write to resurrect data after purge. No HTTP delivery occurs inside
the transaction. The worker is browser-inaccessible and an owner-operated guarded
`pg_cron` snippet enables hourly finalization only after release review.

The personal export combines the complete explicit cloud inventory with the 13
sporting keys from this device's selected Profile adapter. Two reads reject a
changing/incomplete local snapshot. The recorder's sync state is projected to
own result bundles/corrections and shared coordination, excluding other athletes'
raw results, eligibility cache and identity/credential/control storage. It is a
personal data export, not an installation transfer/import package. Local-only
work on another device is explicitly outside this device's export.
The cloud inventory includes own membership/functions, incoming and outgoing
invitation history (without token hashes), Admin requests, subject-related audit
events, participation/approvals, Athlete capability and pilot-creation grant
facts, alongside the existing legal/onboarding, sporting, permission, notification,
entitlement and deletion histories. Incoming historical relationships require a
membership/replacement link; knowing the same email text is not ownership of an
unrelated accepted invitation. Internal grant notes and authentication secrets
are not exported.

The separately accepted dormant S5j native composition uses the genuine same-host
application export and the real AccountDeletionFlow. Exact original ready-owner and
React-lifecycle fences remain current after every await and to the actual final
file-share edge via a one-way retirement witness; it cannot admit identity or read/
mutate data. A begun genuine denial finishes even after newer foreground/unmount,
while a disappeared UI owner cannot permit a new deletion request afterward. Duplicate
completion is idempotent, and pending-link projection uses a separately versioned
known/unavailable repository observation. Recovery keeps the real Flow mounted and
uses the sole coordinator; later confirmation belongs to its own ready owner.
Canonical contract/evidence: BETA_COMPLETION_SPECIFICATION.md §S5j and
TESTFLIGHT_READINESS.md. This does not activate native storage or a hosted finalizer.

## Consequences and evidence

- Ordinary append-only guards remain; due worker transactions have a narrow
  target-bound deletion exception. A browser cannot set authority through a flag.
- Loss of a link, failed deletion or transaction interruption does not report
  successful finalization. Cancellation cannot reverse a completed purge.
- `supabase/tests/account_deletion.test.sql` executes real authorization,
  retry, recovery cutoff, retention and replacement-account cases.
- `scripts/test_account_deletion_concurrency.py` uses independent live Postgres
  sessions and observes actual lock waits for uploads, requests and finalizers.
- UI/component and real local OTP/SMTP Playwright evidence is recorded once in
  `TESTFLIGHT_READINESS.md`. Neither tests nor this ADR activate a hosted worker.
