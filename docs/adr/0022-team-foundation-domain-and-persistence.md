# ADR-0022: Team Foundation Domain and Persistence

**Narrowly constrained (2026-08-24) by `docs/adr/0024-mandatory-identity-and-free-structured-cloud-foundation.md`
(Accepted; not implemented).** Decision 1 — `Profile.id` as its own application-owned UUID,
linked 1:1 to an auth account, never equal to the auth user id — is **retained and is now
the platform-wide identity model**, not just Team Foundation's. Decision 10's statement that
**no Team Foundation RPC ever inserts an `athletes` row remains true of the implemented
service**, and arbitrary Team `Profile` creation still grants nothing. The single narrow
change: **completed *personal* app onboarding will later be required to establish Athlete
capability** (Stage B0.2). Nothing in this ADR's implemented behaviour, history, or SQL
changes as a result.

**Status:** Accepted. Domain layer, `TeamService`/`EmailService` boundaries, and the
Supabase-backed production implementation are Implemented. The database migrations
(schema, RLS, functions) **have been executed** against a real local Supabase Postgres:
`supabase db reset` applies all three from scratch, the pgTAP suite in
`supabase/tests/team_foundation.test.sql` passes **101/101**, and the two-session
concurrency Procedures A–E documented at the end of that file have been run with
genuinely concurrent sessions (see `supabase/tests/README.md` for the recorded
outcomes). Route Handlers and UI remain Implemented against the fake/in-memory backend
and unit/component tests; **they have not been exercised end to end against the real
database**, which is the remaining follow-up — see
`docs/TECHNICAL_DEBT_AND_ROADMAP.md`'s Team Foundation section.

Executing the SQL for the first time exposed two defects that no amount of TypeScript
testing or careful reading could have surfaced, both now fixed in the migrations:

- **RLS policies without table privileges.** The RLS migration defined `SELECT`
  policies for `authenticated` but granted no table-level `SELECT`. A policy narrows an
  access the ACL already permits; it never grants one, so every direct client read in
  `supabaseTeamService.ts` and the Team Route Handler context would have failed with
  `permission denied for table ...` before any policy was consulted. The migration now
  issues explicit grants: `authenticated` gets `SELECT` only (and stays constrained by
  the policies), `anon` gets nothing at all, and no role gets a direct write — every
  mutation stays SECURITY DEFINER RPC-only. §17 of the pgTAP suite asserts that
  boundary from the catalog, because adding a write grant or an `anon` `SELECT` grant
  would otherwise leave every behavioural assertion still passing.
- **Unqualified pgcrypto calls.** `private.hash_token`/`private.generate_raw_token`
  called `digest(...)`/`gen_random_bytes(...)` unqualified. pgcrypto lives in the
  `extensions` schema on Supabase, while every calling RPC pins
  `search_path = public, pg_temp` (requirement 133) — so no invitation could ever have
  been created. Both now call `extensions.digest`/`extensions.gen_random_bytes`
  explicitly, rather than widening a security-sensitive search path to fix two
  expressions. §4a of the suite proves a real `create_invitation` round-trips: the
  stored value is exactly SHA-256 of the raw token, the raw token is 32 random bytes,
  and it is never persisted.

**Product authority.** This is an engineering decision record. The canonical product
source of truth for this beta's approved scope and behavior is
`docs/TEAM_FOUNDATION_AND_ADMINISTRATION_BETA_SPECIFICATION.md` — this ADR implements
that specification and must not silently redefine it. Where an earlier revision of this
ADR (or of the code it describes) stated something the specification contradicts, this
revision corrects the ADR and the code together, in place, rather than only one of the
two.

**Correction note (this revision).** An independent review found several defects in the
prior revision's actual implementation, corrected in this pass without changing the
approved product model: `create_admin_request`/`accept_admin_request` lacked a `for
update` row lock, allowing a concurrent revoke/expiry/membership-end to be silently
ignored by an in-flight acceptance (see the new §Admin Request Concurrency below);
`accept_invitation` had the same gap, closed the same way; `preview_invitation`
attributed every invitation to the *team's* creator rather than that specific
*invitation's* creator (§Invitation Attribution); the pure permission matrix
(`permissions.ts`) ignored `teamStatus` entirely, so an archived Team's admin could still
appear permitted to perform collaborative writes the RPCs themselves already correctly
rejected (§Status-Aware Permissions); the Route Handler helper that re-derives an RPC
failure passed the raw provider message straight through instead of re-parsing and
re-sanitizing it (§Error Boundary Sanitization); no method wrapped a thrown/rejected
provider or transport error, so an unexpected failure could reject instead of resolving a
`TeamResult` (§TeamService Never-Throws Contract); SMTP configuration validation used
permissive coercion (`Number.parseInt` silently accepting trailing garbage,
`SMTP_SECURE="flase"` silently treated as false) instead of failing closed
(§Email Configuration Hardening); the pgTAP suite ran privileged fixture setup under the
`authenticated` role, which has no table-level write grant at all (§pgTAP Role
Discipline); `listAdminRequestsForMe` had no Team-scoped counterpart for an admin's own
view of a Team's outstanding requests (§Team-Side Admin Request Read Model); and
notifications/Admin-Request lists could both resurrect a resolved item and present the
same actionable item through two separate UI surfaces at once (§Notification
Convergence). Each is its own numbered §-section below, appended after the original
Decisions 1-13, which remain otherwise accurate.

**Second correction note (this revision).** An independent review of the prior
correction pass found seven further defects, corrected here in place: `restore_team`
took no lock at all before changing an archived Team back to active, while
`leave_team`/`relinquish_own_admin` captured the Team's status BEFORE acquiring the
final-admin invariant lock and decided the archived-Team exemption from that stale,
pre-lock snapshot — a restore committing in the resulting window could produce an
active Team with zero active Team Admins (§Team Lifecycle Lock Ordering);
`listAdminRequestsForTeam`'s Supabase implementation relied solely on
`team_admin_requests_select`'s RLS policy, which deliberately also permits the
nominee to see their own row, so it was not actually admin-only end to end
(§Team-Side Admin Request Read Model, superseding that section's original text);
`set_participation`/`assign_direct_function`/`remove_direct_function` read the target
Membership without a row lock, so a concurrent `leave_team`/`remove_member` could end
that Membership between the read and the write (§Membership Write-Time Locking);
`create_team`/`validate_invitation_proposal`'s function-array checks used a bare
`<@` containment test, which silently treats a NULL array as passing validation
(plpgsql's `if not (null)` never enters the exception branch) and does not reject a
duplicate value at all (§Function Array Input Validation); the five Route Handlers
under `src/app/api/team/` had no exception boundary around their primary mutation
RPC call, and `recordDeliveryBestEffort`/`fetchMyDisplayName`/`fetchTeamName` only
handled a resolved `{ error }`, not a rejected promise (§Route Handler Exception
Boundary); a signed-out recipient opening either emailed link (`inviteToken`/`adminRequestId`)
had no way to actually sign in from within the overlay/prompt that link opened — the
header's `AccountControl` sign-in control sat behind it, inaccessible, and dismissing
the overlay to reach it discarded the very query parameter identifying which
invitation/request to act on (§Deep-Link Sign-In Continuity); and
`docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` still
contained stale Captain-as-permission and per-Coach `CoachingRelationship` language
in several sections its own revision note claimed were already corrected (tracked
and fixed in that document directly, not in this ADR).

**Third correction note (this revision).** An independent review of the second
correction pass found seven further defects, corrected here in place: emailed accept
links were built from the incoming request's own URL/Host, an attacker- or
proxy-influenced value, rather than one explicitly configured canonical origin
(§Canonical Email Link Origin, new); two server-side logging paths
(`logBestEffortFailure`, SMTP's `toSendFailure`) logged a caught error's raw message
text despite their own comments claiming otherwise, which is exactly where a
sensitive value can appear (§Sanitized Operational Logging, new); the five Route
Handlers constructed their SMTP service OUTSIDE the exception boundary that
otherwise protects every post-mutation step, and their RPC-result shape guards
checked only an `id` field rather than every field the mappers actually read
(§Route Handler Exception Boundary, extended); `remove_direct_function` locked the
target Membership but, unlike its two siblings, never re-checked its status
afterward — an earlier revision of this very ADR incorrectly called this a
"harmless no-op," when in fact the unconditional audit-event write after it meant a
call against an already-ended Membership durably recorded a `function_removed`
event that never actually happened (§Membership Write-Time Locking, corrected);
`list_admin_requests_for_team` re-derived admin authorization correctly but still
returned `setof team_admin_requests` via `select *`, an API contract that silently
expands with every future column the table gains (§Team-Side Admin Request Read
Model, corrected further); `docs/adr/0020` still described the pre-Team-Foundation
`profiles.id = auth.uid()` identity model as if it were still accurate, and
`docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` still used the stale phrase
"athlete sharing and coaching relationships" in one roadmap passage (both corrected
directly in those documents, not in this ADR); and Procedures D/E in
`supabase/tests/team_foundation.test.sql` described statement-completion timing
imprecisely and, in Procedure E, self-contradicted about whether the final admin's
own `restore_team` call succeeds or is denied after relinquishing (rewritten as
precise, non-contradictory two-ordering recipes — see §Team Lifecycle Lock
Ordering).

**Fourth correction note (this revision).** An independent review of the third
correction pass found `safeErrorCategory` itself was not yet fully sanitized: it
returned a real `Error`'s own `.name` and a pattern-matched `code`/`status` field
from a plain object, both of which are values the THROWN object controls, not this
codebase — nothing prevents `error.name`/`error.code`/`error.status` from being set
to a token, OTP, or credential fragment that happens to satisfy a short
alphanumeric pattern check. Corrected to return only hard-coded string literals,
chosen by the caught value's runtime type (`instanceof` against a fixed set of
built-in `Error` subclasses, or object shape), never by anything read off it (see
the corrected §Sanitized Operational Logging below). Separately, this pass also
found `docs/adr/0020`'s prior "narrow supersession note" correction was itself
insufficient — it fixed two specific examples but left Decision E.3/E.4,
`bootstrap_account`'s Profile/Athlete/authority-row inserts, `backfill_domain_
authority`'s `account_scope_id` derivation, and several completeness proofs and
matrix rows still asserting or depending on the superseded `profiles.id =
auth.uid()` identity equality — an internally inconsistent mixture, not a
reconciled document. `docs/adr/0020` is corrected in place to mark its
identity/bootstrap/authority-scope design as an explicit, named architecture
blocker (account-scoped vs. Profile-scoped Local Adoption authority was, **at the
time of that pass**, a genuine open decision it deliberately did not make), rather
than presenting individual examples as fixed while the underlying design remains
contradictory. **Since resolved (2026-08-24):**
`docs/adr/0024-mandatory-identity-and-free-structured-cloud-foundation.md`
(Accepted) decided athlete-owned authority is **Profile-scoped** — `Profile.id`,
the very model this ADR's Decision 1 already implements — and **superseded Local
Adoption as the forward path entirely**. So that scope question is closed; what
`docs/adr/0020` still lacks is only its own unperformed internal reconciliation, on
a route no longer being taken. Nothing in this ADR's own implemented behaviour
changes. Finally, this
pass found `.env.example`/ADR-0022/`SYSTEM_ARCHITECTURE.md` imprecisely described
`APP_ORIGIN`'s effect on `notificationEmailSent` (the member-removal route, which
carries no accept link and never reads `APP_ORIGIN` at all) and did not distinguish
the invitation's raw one-time token from the Admin Request's non-secret id —
corrected in those three places, with no executable behavior change (see
§Canonical Email Link Origin, updated).

**Fifth correction note (this revision).** An independent review found the fourth
pass's `safeErrorCategory` was not yet a TOTAL, non-throwing function: `instanceof`
against a hostile `Proxy` invokes that Proxy's own `getPrototypeOf` trap (to walk
the prototype chain), and the `in` operator against a Proxy invokes its `has` trap
— both are ordinary JavaScript reflection operations a thrown value's own code
controls, and either can throw. A reproduction against the prior implementation
threw straight through `safeErrorCategory` itself, which is exactly the
best-effort/exception-boundary invariant this module exists to protect — a
categorization failure escaping after the durable Team mutation it was guarding had
already succeeded. Corrected by wrapping the entire classification step in one
`try`/`catch`: any exception raised while merely inspecting the caught value's
runtime type (its field values were never read either before or after this fix)
now falls back to the same hard-coded `"unknown_error"` literal an unrecognized
shape already produced — never rethrown, never inspected further, never logged.
The categories themselves are unchanged (see §Sanitized Operational Logging,
updated); only the previously-missing no-throw guarantee around classifying them is
new. `src/app/api/team/_lib/context.ts`'s and `src/lib/email/smtpEmailService.ts`'s
own comments, which had drifted to describe an intermediate ("Error's own class
name, or a short provider error code") implementation already superseded by the
fourth pass, are corrected to describe only the current hard-coded categories and
the total/no-throw guarantee.

## Context

Team Foundation adds a beta multi-user collaboration layer on top of this app's existing
local-first, single-user training domain: named Teams, composable contextual member
functions, email-based invitations, a Team Admin succession (Admin Request) flow, and the
narrow Supabase/Postgres persistence and RLS design those require. This is the first
feature in the codebase where an authenticated identity's data is shared with, and
partially administered by, other authenticated identities — every decision below exists
to keep that sharing narrow, auditable, and reversible, without smuggling training/
performance data into the shared surface.

`docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` §17.2 and its Team Workspace/Team
Seat billing-hypothesis sections are the accepted product-level container this ADR
implements the persistence and application design for. This ADR does not restate that
product model; it records the *engineering* decisions needed to build it.

## Decision 1 — `Profile.id` is its own identity, never the Supabase Auth user id

A `Profile` is a stable, app-owned UUID (`profiles.id`), linked 1:1 in both directions to
exactly one Supabase Auth account via `account_profile_links` (`account_id` primary key,
`profile_id` unique). This supersedes any earlier documentation language that treated
"Profile ID" and "auth user id" as interchangeable.

**Why:** every foreign key in this feature (`team_memberships.profile_id`,
`teams.created_by_profile_id`, `account_notifications.profile_id`, …) needs a stable
identity that outlives an auth-provider implementation detail. Coupling directly to
`auth.users.id` would make a future auth-provider change (or a Supabase project
migration) a data migration for every one of those tables; routing through one narrow
link table makes it a one-table concern instead. A `Profile` also deliberately carries no
email — email lives on `auth.users`, reachable only through the narrow, admin-gated
`get_team_member_emails` RPC (Decision 6) — so a `Profile` can be freely joined into
roster/roster-adjacent queries without ever being a second, driftable copy of a verified
email address.

**Consequence:** every RPC resolves the caller's `Profile` via `private.require_profile()`
(looks up `account_profile_links` by `auth.uid()`), never by trusting a client-supplied
profile id (Decision 8). `bootstrap_profile` is the only path that creates the link+profile
pair, exactly once per account, idempotently returning the existing profile on a repeat
call.

## Decision 2 — Exactly three composable contextual functions; no Team Captain

`TeamFunction` is `"team_admin" | "coach" | "training_lead"`. A membership may hold zero,
one, or several of these simultaneously (each its own time-bounded, audited
`team_membership_functions` row) — they are additive contexts, not a single role slot.

**Team Captain is deliberately not modeled.** The product brief that motivated this
feature distinguished an on-ice leadership role (Captain) from the app's administrative
functions; Captain carries no data-access or permission implication in this beta (no
action in `permissions.ts`'s matrix depends on it), so adding it now would be a
speculative field with no behavior — exactly the kind of "looks real but isn't" value
CLAUDE.md warns against. If a future pass needs to *display* who the team considers its
Captain, that is a presentational label, not a `TeamFunction`, and should be designed
separately when there's a concrete display requirement.

**`team_admin` is not directly *assigned* to an already-active member — that path always
goes through the Admin Request flow (Decision 4).** There are exactly two ways to become
Team Admin, and they are distinct, not one rule with an exception:

1. **The team creator** receives `team_admin` atomically as part of `create_team` (never a
   separate step a creator could skip or omit).
2. **A new invitee** may be proposed `team_admin` as part of their complete invitation —
   `create_invitation`'s `p_functions` accepts `'team_admin'` exactly like `'coach'`/
   `'training_lead'`, and `accept_invitation` grants every proposed function, including
   `team_admin`, in the same transaction that creates the membership. Accepting the
   invitation *is* the acceptance mechanism here — there is no separate Admin Request for
   a brand-new member, because the invitation itself already requires the recipient's
   explicit acceptance of the complete proposal (spec §7/§8, beta acceptance principle 4:
   "**Existing** members become Team Admin only by accepting a Team Admin Request" — a new
   member is not an existing one).
3. **An already-active member** (anyone with a current Membership, regardless of what
   functions they currently hold) can only gain `team_admin` through a Team Admin Request
   (Decision 4) that they themselves explicitly accept — never a direct assignment by
   another admin, and never as a side effect of any other mutation.

An earlier revision of this ADR conflated (2) and (3) into one blanket "every path other
than creation requires an Admin Request" statement — this was incorrect and is corrected
here; the two paths differ in exactly who initiates and who is being granted the function
(a not-yet-a-member email address proposing itself, versus an existing Membership being
nominated by someone else), and the code has always implemented them differently
(`accept_invitation`'s function loop vs. `accept_admin_request`) — only this document's
prose was wrong. `coach` and `training_lead` are the two `DirectlyAssignableFunction`
values *for an already-active member*: any active Team Admin may assign or remove either
on any current member, with immediate effect and no acceptance step, since neither carries
administrative power over the team itself. (Both may also be freely proposed on a fresh
invitation, exactly like `team_admin` — the "direct/immediate, no acceptance" property is
specific to acting on an *existing* Membership, not a general restriction on what an
invitation may propose.)

## Decision 3 — One canonical permission matrix; frontend hiding is not the boundary

`src/lib/team/permissions.ts`'s `canPerformTeamAction` is the single source for "who may
do what" — `MEMBER_ACTIONS` (any active member) vs. `ADMIN_ONLY_ACTIONS` (active Team Admin
function required). It is pure domain logic for UI rendering decisions only. The actual
security boundary is server-side: every mutating Postgres RPC independently re-derives the
same rule from the caller's authenticated identity (`private.require_active_admin`/
`private.require_profile`) under RLS, and never trusts anything the client asserts about
its own permissions. This mirrors the codebase's existing precedent (`ADR-0007`'s
serialized-processing discipline, `ADR-0013`'s repository boundary): one written
definition of a rule, never a second copy that could silently drift, and a client-side
convenience check is exactly that — a convenience, never a defense.

`training_lead` alone grants no admin capability (tested explicitly) — it exists purely to
let a team track "who currently plans training," a role many teams distinguish from
day-to-day team administration.

## Decision 4 — Admin Request is a first-class lifecycle, mirroring Invitations

Promoting an *existing* member to Team Admin is a `TeamAdminRequest`: created by an
existing admin naming one active membership, delivered as both an `AccountNotification`
and (best-effort) an email, and requiring the nominee's own explicit acceptance
(`accept_admin_request`) before `team_admin` actually activates. Requests expire after
`ADMIN_REQUEST_LIFETIME_DAYS` (14), and share the same "revoke is an idempotent no-op,"
"a stale pending request is never a valid successor," and "ending the target membership
immediately invalidates any pending request naming it" rules as invitations (Decision 5).

**Why a request instead of direct assignment:** unlike `coach`/`training_lead`,
`team_admin` grants member-email visibility and destructive administrative power over
other people's memberships. Requiring the nominee's affirmative acceptance prevents an
existing admin from unilaterally handing that power to someone who does not want it (and
protects the nominee from being surprised into administrative responsibility).

Only an **accepted** request ever counts as a successor for the last-admin invariant
(Decision 7) — a merely pending request is never sufficient, since the nominee might
decline or let it expire.

## Decision 5 — Invitation lifecycle: hashed one-time token, replace-based revise/resend

`TeamInvitation` is created with a cryptographically random raw token, returned exactly
once to the calling RPC (`team_invitation_created.raw_token`) and never stored — only
`token_hash` (SHA-256) persists. `preview_invitation`/`accept_invitation` are the only two
RPCs that ever compare a caller-supplied secret, and only as a hash lookup.

Revising or resending an invitation does not mutate the existing row in place. Both are
implemented as `private.replace_invitation`: the old row is locked (`FOR UPDATE`), closed
as `"replaced"`, and a fresh row (fresh token, fresh 14-day expiry) is created and linked
via `replacedByInvitationId`. This keeps "was this exact invitation ever accepted"
unambiguous — a resend after tampering-in-transit concerns, or an admin fixing a typo'd
proposal, is a new, distinguishable secret, not a mutated old one that a leaked old email
could still exploit.

Revoking an already-terminal (expired/accepted/revoked/replaced) invitation is a defined,
idempotent no-op (no `FOUND` check) — this must never become a way to "re-block" a slot
or fail loudly on a double-click. A malformed or already-consumed raw token fails closed
at the token-lookup step, before any domain-reason branching (expired/revoked/etc.) is
even reached — a replay or guess never gets more specific feedback than a genuine invalid
link would.

Email/participation/function match on acceptance is case-insensitive for the email
comparison only (`lower(btrim(...))`), matching how most mail systems and users treat
addresses in practice.

## Decision 6 — Member email is a narrow, admin-gated RPC result, never a browsable column

No RLS `select` policy, view, or foreign table ever exposes `auth.users` (or any column
derived from it) directly to `authenticated`. `get_team_member_emails(team_id)` is the one
path: it requires the caller to already be that team's active admin, and returns exactly
two columns (`membership_id`, `email`) for that team's active members only. `getMyProfile`,
roster reads, and every other query return `Profile.displayName`, never email, unless the
caller is specifically resolving that RPC as an admin.

**Why:** requirement-level, an ordinary member should be able to recognize teammates by
name without ever incidentally learning their email address; only the operational need
(contacting a member, e.g. to resend something outside the app) justifies exposing it, and
only to the person already trusted with administrative power over the team.

## Decision 7 — Last-Active-Admin invariant is enforced twice, in agreement

`lastAdminInvariant.ts`'s `wouldViolateLastAdminInvariant`/`canRelinquishOrRemoveLastAdmin`
are the single written statement of the rule: an **active** team may never drop to zero
active Team Admins as a result of `relinquish_own_admin`, `remove_admin_function`,
`remove_member`, or `leave_team`. An **archived** team is explicitly exempt — archiving
already suspends administrative write access, so there is no live invariant left to
protect (Decision 9).

Every RPC that can trigger this path takes `private.lock_team_admin_invariant(team_id)` (a
`pg_advisory_xact_lock` keyed on the team) before counting other active admins via
`private.count_other_active_admins`, closing the race where two concurrent
demotions/removals could each observe "at least one other admin" and both proceed,
leaving zero. The pure TypeScript check and the locked SQL count must agree on the rule
itself (they are two enforcements of one definition, not two independent rules) — a
future change to either without the other is a defect, not an acceptable drift.

## Decision 8 — No client-supplied identity value ever overrides authenticated identity

No SECURITY DEFINER function in this schema accepts a caller-supplied profile id, account
id, or email as a parameter that participates in an authorization decision. Every RPC
resolves the acting identity exclusively from `auth.uid()` (via `private.require_profile`/
`private.require_active_admin`). This is verified structurally by the pgTAP suite
(`supabase/tests/team_foundation.test.sql` §9), not only by code review, precisely because
a single overlooked `p_profile_id`-shaped parameter would otherwise be an impersonation
vulnerability that ordinary functional testing might never exercise.

## Decision 9 — Restricted `recovery` status: exit implemented, entry deliberately not built

`TeamStatus` includes `"recovery"`, and `resolveTeamStatusAfterAdminRequestAccepted`
(`recovery.ts`) plus `accept_admin_request`'s handling of it fully implement the **exit**
path: accepting any Admin Request against a team unconditionally clears `"recovery"` back
to `"active"`, since an accepted successor is exactly the condition recovery exists to
restore. `operational_recover_team_admin` — granted to `service_role` only, never
`authenticated`/`anon` — nominates a recovery successor using the ordinary Admin Request
mechanism, so the same accept flow closes recovery.

**No code path in this beta ever transitions a team into `"recovery"`.** Doing so would
require detecting "this team's last Team Admin's account was deleted" — an account-deletion
flow this beta does not build. Modeling the exit path now, ahead of the entry trigger, is
deliberate: it keeps the schema and RPC surface ready (rather than needing a second,
disruptive migration later) without guessing at account-deletion semantics that haven't
been designed yet. This is a **Prepared**, not *Implemented*, capability — see
`docs/TECHNICAL_DEBT_AND_ROADMAP.md`.

## Decision 10 — Pilot-gated team creation; Athlete is a lazily-created capability

`hasPilotTeamCreationCapability`/`pilot_team_creation_grants` restricts who may call
`create_team` during closed beta — a manually granted, per-profile allow-list, never a
role or a self-service toggle. Invitees never need this grant; only the act of creating a
new team is gated, matching the closed-beta intent of validating the feature with a
controlled seed group before opening team creation broadly.

The `athletes` table exists in the schema (a `Profile`'s optional Athlete capability) but
**no RPC in this migration ever inserts a row into it.** Athlete-capability bootstrap is
out of this feature's scope — Team Foundation only needs `Profile`/`Team`/`Membership`
identity, not the Athlete-specific product capability those rows would represent. Building
that lazily, when a concrete feature needs to read/write it, avoids inventing an unused
column shape now (same discipline as CLAUDE.md's "don't invent a looks-real-but-isn't
value").

## Decision 11 — Email-sending mutations run through Next.js Route Handlers, not the browser

Every mutation goes through a Postgres RPC (never a raw `insert`/`update`/`delete` from the
browser — RLS defines `select`-only policies for every table). Most RPCs are called
directly from the browser via `SupabaseTeamService` (`src/lib/supabase/supabaseTeamService.ts`),
using the same singleton Supabase client `useSupabaseAuthController` already constructs.

The five mutations that must **also** send an email — `createInvitation`,
`reviseInvitation`, `resendInvitation`, `createAdminRequest`, and `removeMember` — instead
call this app's own Next.js Route Handlers under `src/app/api/team/`. Each handler:

1. re-derives a user-scoped Supabase client from the request's forwarded bearer token via
   `createUserScopedServerClient` (never the service-role key — `auth.uid()` inside the
   RPC resolves to exactly the identity it would if the browser had called the RPC
   directly; RLS/SECURITY DEFINER remain the actual security boundary, not this file);
2. calls the corresponding RPC (`create_invitation`, `replace_invitation` via
   `revise_invitation`/`resend_invitation`, `create_admin_request`, `remove_member`);
3. on success, attempts exactly one email send via `createSmtpEmailServiceFromEnv()` —
   `null` (unconfigured/invalid SMTP) or a thrown/rejected send is reported as an honest
   `emailSent: false`/`notificationEmailSent: false`, never fabricated as `true`;
4. for invitation-related routes, records the delivery outcome durably via
   `record_invitation_email_delivery`/`record_admin_request_email_delivery` so
   `TeamInvitation.emailDeliveryStatus` reflects reality on next read.

**Why not send email directly from a database trigger or from the browser:** the browser
must never hold SMTP credentials, and Postgres has no first-class SMTP client — a
`pg_net`/webhook-based trigger would add an operational dependency and a second place
error handling could diverge from the domain's "never fabricate success" rule. A thin,
server-only Route Handler keeps the RPC and the email send in the same request without
adding either concern to the other's layer, and keeps `EmailService` provider-neutral
(Decision 12) with exactly one production call site pattern.

`supabaseServerClient.ts` is therefore the one additional file (beyond
`supabaseClient.ts`/`supabaseAuthService.ts`) permitted to import
`@supabase/supabase-js` directly — enforced by
`src/lib/persistence/__tests__/architectureBoundary.test.ts`. Route Handlers themselves
never import the SDK; they depend only on `supabaseServerClient.ts`.

## Decision 12 — `EmailService` is provider-neutral; a delivery failure is always honest

`EmailService` (`src/lib/email/emailService.ts`) never names a commercial vendor —
`SmtpEmailService` speaks plain SMTP via `nodemailer`, so any provider exposing an SMTP
relay (self-hosted or commercial) works without a code or interface change.
`createSmtpEmailServiceFromEnv()` returns `null` when SMTP is unconfigured or invalid,
never a service that silently no-ops; every call site must treat `null` (and a real send
rejection) as "cannot send right now" and report that honestly. `FakeEmailService`
implements the identical contract for tests — never a parallel, easier-to-satisfy shape —
matching this codebase's existing Timing Simulator precedent (ADR-0006) for test
stand-ins.

## Decision 13 — Postgres errors cross the RPC/HTTP boundary as `'<kind>: <message>'` only

Every expected RPC failure is raised as `raise exception '<kind>: <human message>'`, where
`<kind>` is one of `TeamErrorKind`. `parsePostgresErrorMessage` (`postgresErrorMapping.ts`)
is the one place this convention is parsed back into a typed `TeamError`, on both the
direct-RPC path and the Route Handler response path (`{ error: "<kind>: <message>" }` in
the JSON body). Anything that doesn't match this exact shape — a genuine constraint
violation, a permission-denied message, an unexpected class of Postgres error — resolves
to `unexpected_error` with a fixed, non-leaking message. This is a deliberate fail-closed
default: it is not merely that expected errors are mapped, but that *unmapped* errors
never leak schema, constraint, or internal detail to a client, on either transport path.

## §Admin Request Concurrency — row locks, fixed order, correction to Decision 4/7

The original `create_admin_request`/`accept_admin_request` performed a check-then-act
sequence with no row lock: `create_admin_request` read "is anything else pending for this
membership" and then inserted, and `accept_admin_request` read the request's and
membership's status, decided whether to grant `team_admin`, and only afterward tried to
flip the request's status to `'accepted'`. Two concrete races followed: two concurrent
`create_admin_request` calls for the same Membership could both observe "nothing pending"
and both insert; and `accept_admin_request` could grant `team_admin` after reading a
now-stale `'pending'` snapshot even though a concurrent `revoke_admin_request` or a
`remove_member`/`leave_team` ending the same Membership had, in reality, already made that
grant invalid.

**Fix:** every function that creates, accepts, or could invalidate (via ending a
Membership) an Admin Request now locks rows in one fixed, shared order — **the target
Membership row first, the specific `team_admin_requests` row second** (only when a
specific request row is in play at all):

- `create_admin_request` locks the target Membership (`for update`) before checking for
  an existing effectively-pending request and before inserting a new one — this closes the
  duplicate-creation race.
- `accept_admin_request` locks the Membership, then the request row, then re-reads both
  and re-derives every denial branch from those locked reads — never from the unlocked
  snapshot taken merely to find which rows to lock.
- `remove_member`/`leave_team` already update the Membership row (as their first write),
  then the request row (revoking any pending request naming it) — this is the same
  relative order, so no new code was needed there, only the ending-membership UPDATE
  statements gaining their own `where status = 'active'` guard (see the git history for
  this file's `remove_member`/`leave_team` — a bare `where id = ...` could otherwise
  silently overwrite an already-ended Membership's `ended_at`/`end_reason`).
- `revoke_admin_request` never needs the Membership lock — its own single atomic `UPDATE
  ... where status = 'pending'` is sufficient to serialize correctly against a concurrent
  `accept_admin_request`'s `for update` on the same request row.

**Why this fixed order matters, not just that locking exists:** every function that could
otherwise touch both a Membership row and a specific request row acquires them in the
*same* relative order (Membership, then request) — this is what guarantees Postgres never
needs its deadlock detector to resolve a cycle between two of these functions running
concurrently. `accept_invitation` received the equivalent fix for the same underlying
reason: it now takes a `for update` lock on the invitation row at its very first read, held
continuously through its final `UPDATE ... set status = 'accepted'`, which is exactly what
lets that final update drop the "lost the race, but the membership we already created is
real" fallback branch a previous revision needed — the lock makes that race provably
unreachable rather than merely detected and reported after the fact.

This is a mechanism-level correction. It changes none of Decision 4's product behavior
(the request lifecycle, its 14-day expiry, its notification, its nominee-only acceptance)
and none of Decision 7's stated invariant — only *how atomically* both are now enforced.

## §Team Lifecycle Lock Ordering — restore_team vs. a final admin's exit

`restore_team` changes a Team's status from `archived` back to `active` without
taking any lock at all. `leave_team` and `relinquish_own_admin` each read the Team's
status once, early, via `private.require_team` — BEFORE acquiring
`private.lock_team_admin_invariant(team_id)` — and used that pre-lock snapshot to
decide whether the archived-Team exemption to the final-admin invariant (Decision 9)
applied. A concurrent `restore_team` could commit in the window between that
snapshot and the lock-protected decision: `restore_team` reads `archived`, flips the
Team to `active`; meanwhile the final admin's `leave_team`/`relinquish_own_admin`,
having already captured `archived` before `restore_team` ran, still applies the
exemption and ends the admin's own function/membership. The durable result is an
**active** Team with **zero** active Team Admins — exactly the state Decision 7/9
exist to make impossible, reached without violating either function's own,
individually-correct-looking locking.

**Fix:** `restore_team` now takes `private.lock_team_admin_invariant(team_id)` —
the SAME per-team advisory lock `leave_team`/`relinquish_own_admin` already held for
their own decision — before re-deriving admin authorization (`is_active_admin`,
re-checked fresh, since a stale pre-lock authorization snapshot could itself be
invalidated by a concurrent removal/leave completing first) and before reading the
Team's current status. `leave_team` and `relinquish_own_admin` are corrected the
other direction: neither captures the Team's status before acquiring the lock
anymore; both now read status via a fresh `select` taken only AFTER
`lock_team_admin_invariant` returns, inside the same `if v_is_admin then` branch that
already held the lock for the admin-count check. Because every one of these three
functions now acquires the SAME lock before reading or deciding anything the
archived-exemption depends on, whichever transaction reaches the lock first
determines the authoritative state the other one's decision is based on — the
interleaving described above is unreachable, not merely narrowed. `archive_team`
does not need this lock: the dangerous direction is specifically `archived` →
`active` racing a decision that depends on "the Team is still archived," and
`archive_team` only ever moves the other way, in agreement with — never in tension
with — that same exemption.

This shares its lock (`private.lock_team_admin_invariant`) and its underlying
discipline ("every decision this invariant depends on is made from a state re-read
taken only after the lock is held, never from an earlier snapshot") with
§Admin Request Concurrency and §Membership Write-Time Locking below — one protocol,
applied consistently across every function that can move a Team between `active`
and `archived` or change its active-admin count, rather than a fix local to one
function pair. `remove_admin_function`/`remove_member` are unaffected: both already
call `private.assert_team_active` before doing anything else, which unconditionally
rejects an archived Team, so neither ever reaches a branch that depends on the
archived-exemption in the first place.

Sequential regression coverage for the refactored functions is in
`supabase/tests/team_foundation.test.sql` §15. The genuine two-session race this fix
targets is not representable in a single-transaction pgTAP suite — it is covered by
that file's Procedures D and E, which **have been executed** against a real Postgres
with two concurrent sessions in both orderings each. Observed: the second session
blocked on the per-team advisory lock (`Lock/advisory` in `pg_stat_activity`) and,
once unblocked, failed with `last_admin_invariant` when a restore had committed first
and with `forbidden` when the final admin's exit had committed first. No observed
state contained an active Team with zero active Team Admin functions.
A third-pass review found the original Procedures D/E
narrative imprecise about statement-completion timing (describing a `select` that
has already returned inside an open transaction as "about to block," when a
completed statement that took a lock is instead HOLDING it) and, in Procedure E,
self-contradictory about whether A's own `restore_team` call succeeds or is denied
after A relinquishes — both are corrected in place as two explicit, executable
orderings each, with precise commit/rollback timing and an unconditional
`forbidden` outcome for A's own restore attempt once A no longer holds `team_admin`,
regardless of whether some unrelated admin exists elsewhere.

## §Deep-Link Sign-In Continuity — a signed-out recipient can sign in in place

Both emailed Team Foundation links (`?inviteToken=...`, `?adminRequestId=...`) point
back at the single root page (Decision 11's "no server-side routing" already
established this). Neither previously gave a signed-out recipient any way to
actually complete sign-in without abandoning the link's own intent:

- `TeamInvitationAcceptOverlay` rendered a fixed, full-screen modal (`z-50 inset-0`)
  over the entire app, including the header's `AccountControl` sign-in control —
  while signed out, its only content was a sentence telling the user to "sign in
  above… then reopen this link." The header control was not reachable behind the
  modal, and "reopen this link" required the user to still have the original email
  open and re-click it — a real recipient closing the overlay to look for a way to
  sign in would, in doing so, trigger `onDone`, which deletes `inviteToken` from the
  URL (see below), losing the very thing they were trying to act on.
- `TeamDeepLinkGate` read `adminRequestId` and, unconditionally at mount, called
  `onAdminRequestLink()` (which opens the Teams screen) and then deleted the
  parameter — regardless of whether the caller was actually signed in yet. A
  signed-out recipient's Teams screen has nothing actionable to show; by the time
  they later signed in through the header, the parameter that would have told the
  app which request to care about was already gone.

**Fix:** a new shared component, `CloudSignInForm` (`src/components/
CloudSignInForm.tsx`), extracts the email/OTP request-and-verify form (and the
shared recoverable-error retry affordance) `AccountControl` already implemented,
driven entirely by the ONE `AuthController` state machine (`useSupabaseAuthController`)
every call site already constructs — this is reuse of the existing authentication
state machine and its exact UI, never a second, divergent one. `AccountControl` itself
is refactored to render this shared component for every state it previously handled
inline (recoverable error, email step, OTP step), with byte-identical rendered output
(same labels, classNames, and DOM structure) — its existing test suite required no
behavioral changes.

- `TeamInvitationAcceptOverlay` now renders `CloudSignInForm` directly, in place of
  the old presentational sentence, while signed out. Because the overlay's own
  `token` prop never changes and the overlay never unmounts during this, a recipient
  can request an OTP, verify it, complete Profile bootstrap if needed, and reach the
  SAME invitation's preview and acceptance — all without ever leaving the overlay.
  Every terminal/denial state still keeps its own "Close" (safe exit) — that remains
  an explicit, deliberate dismissal, never something a recoverable auth error
  triggers on its own.
- `TeamDeepLinkGate` now constructs its own `AuthController` instance (backed by the
  same underlying auth service every other instance is, so a sign-in completed
  anywhere is observed everywhere) and, for `adminRequestId`, holds the id in local
  state rather than consuming it immediately. While cloud is genuinely configured but
  the caller is not yet signed in, it renders a small prompt of its own (same
  `CloudSignInForm`) instead of firing `onAdminRequestLink`. Only once the caller is
  actually signed in — or cloud itself is unavailable, in which case there is no
  sign-in step to wait for and the original immediate behavior still applies — does it
  call `onAdminRequestLink()` and clear the parameter. A recipient no longer needs to
  "reopen the link" after signing in; the same mounted component continues on its own.

This does not change what an Admin Request deep link ultimately does once signed in
(still: open Teams, where the nominee's own actionable inbox already lives, per
Decision 4's own reasoning for not building a second accept surface) — only whether a
signed-out recipient can reach that point at all without losing the link's intent.

## §Invitation Attribution — the invitation's own creator, not the team's founder

`preview_invitation` originally attributed every invitation to `teams.created_by_profile_id`
(the team's founder), regardless of who actually created that specific invitation. Since
any active Team Admin may send, revise, or resend an invitation — not only the founder —
this was wrong for every invitation created by a non-founder admin. Fixed to read
`team_invitations.created_by_profile_id` (a column already correctly populated by
`create_invitation`/`replace_invitation` — only the *read* side had the bug) for the
specific invitation row being previewed. `src/lib/team/fakeTeamService.ts`'s in-memory
equivalent had the identical bug (attributing to the team's creator via a lookup that
never recorded a per-invitation creator at all) and received the matching fix, including a
new fake-internal `createdByProfileId` field on its invitation record.

## §Status-Aware Permissions — `teamStatus` now materially participates

`permissions.ts`'s `canPerformTeamAction` previously ignored `context.teamStatus` for every
admin-only action, so the pure UI-facing matrix disagreed with what the RPCs themselves
already correctly enforced (`private.assert_team_active` blocking most admin-only actions
on an archived Team). Corrected per the specification's §11 model:

- **`recovery`**: every admin-only action, `restore_team`, and `relinquish_own_admin` are
  suspended outright; only `view_team`/`view_roster`/`leave_team` remain available to an
  existing active member. (An ordinary caller who is *also* `isActiveAdmin` for a Team
  genuinely in recovery cannot occur in practice — recovery is only reachable once every
  active admin is already gone — but the function's own logic does not rely on that
  incidental fact; it suspends admin actions unconditionally under this status.)
- **`archived`**: a fixed `REQUIRES_ACTIVE_TEAM` set (`rename_team`, `manage_invitations`,
  `change_participation`, `assign_direct_function`, `remove_direct_function`,
  `request_admin_promotion`, `remove_admin_function`, `remove_member`, `archive_team`) is
  blocked — every one of these is a collaborative write touching the roster, functions, or
  invitations of *other* members, matching each one's own `private.assert_team_active` call
  in SQL (added to `remove_admin_function` in this same pass — it was missing that guard,
  letting an admin remove *another* member's `team_admin` function while archived, which
  the specification's "ordinary collaborative writes... suspended" language forbids).
  `revoke_admin_request` and `relinquish_own_admin` — the two self-directed/idempotent-
  cleanup actions — remain available while archived, matching their SQL functions, which
  never gained an `assert_team_active` call, deliberately. `restore_team` is gated the
  opposite way: permitted only while `archived`, never while `active` (nothing to restore)
  or `recovery` (restoring directly from recovery is explicitly rejected by
  `restore_team`'s own SQL — recovery's only exit is the normal Admin Request accept path).
- **`active`**: unchanged from the original decision — the full permission set described in
  Decisions 2/3/4.

`listAdminOnlyActions()` no longer includes `restore_team` — it has its own explicit
status-dependent branch in `canPerformTeamAction` rather than living in the flat
`ADMIN_ONLY_ACTIONS` set, since its permitted-status direction is the inverse of every
other admin action's.

## §Error Boundary Sanitization — the Route Handler path now re-sanitizes, not passes through

`src/app/api/team/_lib/context.ts`'s `rpcErrorJson` originally forwarded an RPC's raw
`error.message` directly into the HTTP response body. Because every *expected* RPC failure
is already formatted as `'<kind>: <message>'` (Decision 13), this happened to look correct
for the common case — but it meant any *unexpected* failure (a genuine constraint
violation, a permission-denied message, a transport-level error surfacing through the
Supabase client as `error.message`) would cross this second transport boundary verbatim,
even though the exact same raw text is already sanitized to a generic `unexpected_error`
on the direct-RPC browser path via `parsePostgresErrorMessage`. Fixed: `rpcErrorJson` now
re-parses through that same function and re-serializes only the sanitized `{kind,
message}` pair, so both transport paths give a caller the identical fail-closed guarantee.
`errorJson`/`rpcErrorJson` also now derive a stable HTTP status from `TeamErrorKind` (a new
`STATUS_BY_KIND` map — `forbidden`/`wrong_email`/`wrong_nominee` → 403, `not_found` → 404,
`conflict`/`already_exists`/`expired`/`revoked`/`replaced`/`already_accepted`/
`last_admin_invariant`/`archived_team` → 409, `invalid_input` → 400, `not_configured`/
`unexpected_error` → 500, `network_error` → 502) instead of every route hand-picking its
own status per call site.

## §TeamService Never-Throws Contract — centralized, not per-method

Requirement 23 ("every `TeamService` method resolves a `TeamResult<T>`, never
throws/rejects") was previously enforced only by each method's own care — `postToRoute`
wrapped `fetch`/`response.json()` in `try`/`catch`, but a Supabase query-builder/RPC
promise rejecting instead of resolving `{ data, error }`, or `client.auth.getSession()`
throwing during `accessToken()`, would have propagated as an unhandled rejection through
any of `SupabaseTeamService`'s ~20 other methods. Fixed with one centralized wrapper,
`src/lib/team/withNeverThrows.ts`: a `Proxy` around any `TeamService` implementation that
catches a thrown error or rejected promise from any method and resolves
`teamFailed("unexpected_error", "Something went wrong. Please try again.")` instead — never
the raw error's own message, for the same reason raw provider errors are never surfaced
elsewhere in this feature. `teamServiceFactory.createSupabaseTeamService` applies this
wrapper to the one production implementation; `accessToken()` additionally gained its own
narrower `try`/`catch` (treating a session-lookup failure the same as "not signed in")
as defense in depth, not a substitute for the wrapper. Fake/test implementations are
injected directly by test code, bypassing the wrapper deliberately — a well-behaved fake
that never throws is unaffected by not having it.

## §Email Configuration Hardening — strict validation, no permissive coercion

`resolveSmtpConfig` previously used `Number.parseInt(portRaw, 10)`, which silently accepts
`"587abc"` as `587`, and treated any `SMTP_SECURE` value other than the exact string
`"true"` as `false` — including a typo like `"flase"`. Both are corrected to fail closed
with `{ status: "invalid" }` rather than silently coercing: `SMTP_PORT` must match `/^\d+$/`
before being parsed and range-checked (1-65535); `SMTP_SECURE`, if set at all, must match
`/^(true|false)$/i` case-insensitively or the configuration is rejected. Two further gaps
are also closed: `SMTP_FROM_ADDRESS` is now checked against the same email-shape pattern
`useSupabaseAuthController.ts` uses (a non-email string was previously accepted as long as
it was non-blank), and `SMTP_USER`/`SMTP_PASS` must now both be set or both be blank —
partial credentials (one set without the other) are rejected rather than silently
attempting an unauthenticated connection to a relay that likely requires the missing half.

Separately, every Route Handler's best-effort `record_invitation_email_delivery`/
`record_admin_request_email_delivery` call previously discarded its own RPC error
entirely. A new shared helper, `recordDeliveryBestEffort` (`_lib/context.ts`), logs that
failure server-side (`console.error`) without leaking it to the response and without
rolling back the domain mutation or the email send that already completed — the response
still distinguishes the durable mutation outcome (always present) from the email-delivery
outcome (`emailSent`/`notificationEmailSent`, honestly `false` on any failure) exactly as
before; only the previously-silent recording failure is now observable operationally.

## §pgTAP Role Discipline — privileged fixture setup vs. behavioral assertions

The pgTAP suite originally performed privileged fixture setup (granting a pilot capability,
deliberately violating the one-active-membership constraint to prove it is enforced) while
`SET ROLE authenticated` — left in effect by a preceding `tests.act_as(...)` call — was
still active. `authenticated` has no table-level INSERT/UPDATE/DELETE grant on any Team
Foundation table (every mutation goes through a SECURITY DEFINER RPC), so these statements
would have failed on an ordinary permission error before ever reaching whatever the test
meant to exercise, and — had the local grant model ever differed from that assumption —
could have silently tested the wrong thing instead of failing loudly. Fixed: a new
`tests.reset_to_owner()` (`reset role`) is called immediately before every such privileged
statement, with the correct `tests.act_as(...)` call repeated immediately afterward to
restore the exact role the next behavioral assertion needs. See
`supabase/tests/README.md`'s "Role discipline" section for the full explanation and
`supabase/tests/team_foundation.test.sql`'s own header comment, which documents the same
rule inline. The suite's assertion count also grew in this pass (concurrency-adjacent
sequential cases, cross-Team fail-closed checks, invitation-attribution-across-a-
non-founder-admin, the corrected archive/restore sequence) — `plan(...)` is kept in sync
with the actual count; a mismatch is itself a pgTAP failure, not a documentation nit.

## §Team-Side Admin Request Read Model

`listAdminRequestsForMe` is scoped to the *nominee* — it cannot answer "what Admin
Requests has my Team currently got outstanding," which an active Team Admin needs in order
to review or revoke what they (or another admin) created. A `TeamService` method,
`listAdminRequestsForTeam(teamId)`, fills this gap: scoped to exactly one Team, returning
only effectively-pending requests (the same "one actionable representation" rule as the
nominee inbox — see §Notification Convergence below). `FakeTeamService` gates it through
the same `canPerformTeamAction` check as `revokeAdminRequest`. `TeamsScreen`'s "Outstanding
Admin Requests" section is the one UI surface built on this method.

**Correction (second pass): a dedicated admin-only RPC, not a plain RLS-scoped select.**
The original `SupabaseTeamService.listAdminRequestsForTeam` performed a plain
`select("*")` on `team_admin_requests` filtered by `team_id`, relying entirely on
`team_admin_requests_select`'s RLS policy for authorization. That policy is
intentionally broader than "admin only" — it also permits the nominee to see their
own request row, for their separate nominee inbox (`listAdminRequestsForMe`). A
non-admin nominee calling the Team-scoped method therefore received their own row
back (never another member's, since the policy's nominee branch still filters to
`m.profile_id = current_profile_id()`, but still a real authorization gap: the
method's contract is "Team Admin only," and the production implementation did not
actually enforce that server-side). `FakeTeamService` never had this gap (it gates
through `canPerformTeamAction`, which is unconditionally admin-only for this
action) — the two implementations diverged on a security-relevant boundary, which is
exactly the kind of drift Decision 3 exists to prevent.

Fixed with a new SECURITY DEFINER RPC, `list_admin_requests_for_team(team_id)`: it
calls `private.require_active_admin(team_id)` before returning anything — the same
authorization primitive every other admin-only RPC in this schema uses — and returns
only effectively-pending rows (`status = 'pending' and expires_at > now()`).
`SupabaseTeamService.listAdminRequestsForTeam` now calls this RPC instead of
selecting the table directly; `FakeTeamService`'s behavior is unchanged (it was
already correct). This closes the gap the prior revision of this ADR recorded as an
accepted, "inert today" residual risk — it is no longer either inert-by-accident or
accepted; it is enforced.

**Correction (third pass): a narrow, explicit result shape, not `returns setof
team_admin_requests`/`select *`.** The second pass's RPC re-derived authorization
correctly but still declared `returns setof public.team_admin_requests` and read the
row with `select *` — functionally admin-only, but an API contract that silently
expands to include every column the table has (including `created_by_profile_id`,
which no current caller needs) and would silently expand further the next time the
table gains a column. Fixed with a new composite type,
`public.team_admin_request_summary` (exactly the nine fields `TeamAdminRequest`,
`src/lib/team/types.ts`, consumes: `id`, `team_id`, `membership_id`, `status`,
`created_at`, `expires_at`, `accepted_at`, `revoked_at`, `replaced_by_request_id`),
and an explicitly column-qualified `select` naming each field — never `select *`.
`list_admin_requests_for_team` now `returns setof public.team_admin_request_summary`.
No TypeScript change was needed (`mapAdminRequestRow` already read only these same
nine fields), but the API surface itself is now narrow by construction, not merely
by the mapper's own restraint. `supabase/tests/team_foundation.test.sql` §16 gained a
structural introspection assertion against the function's actual declared return
columns (via `pg_proc`/`pg_type`/`pg_attribute`), so reverting to `team_admin_requests`
itself — even leaving the now-unused composite type in place — would be caught.

## §Notification Convergence — one actionable representation, not two

Three related defects are corrected together, since they share one root cause (a
resolved/superseded item continuing to look actionable somewhere):

1. **`listNotifications` returned every notification, read or not.** An "ordinary
   notification read" is now defined as an unread-only inbox view — both
   `FakeTeamService` and `SupabaseTeamService` filter to `readAt === null` (a `.is("read_at",
   null)` clause server-side). A full history is not part of this beta; if ever added, it
   would be a separately named method, not a filter every caller has to apply itself.
2. **`listAdminRequestsForMe`/`listAdminRequestsForTeam` returned every request regardless
   of effective status.** Both are now scoped to effectively-pending requests only (via
   `deriveAdminRequestStatus`) — an accepted/revoked/replaced/expired request can never
   reappear as if it still needed a decision, in either list.
3. **The same pending Admin Request could be acted on through two independent UI
   surfaces** — a notification's own "Accept" button and the nominee inbox's "Accept"
   button — with no coordination between them. Resolved by making `accept_admin_request`
   and `revoke_admin_request` each mark the corresponding `kind = 'admin_request'`
   notification's `read_at` in the *same transaction* as the resolution (matched by
   `payload->>'requestId'`), and by having `TeamsScreen` stop rendering `admin_request`-kind
   notifications as their own actionable block at all — the "Pending Admin Requests"
   section (nominee side) and "Outstanding Admin Requests" section (Team-admin side,
   §Team-Side Admin Request Read Model) are now the two, non-overlapping actionable
   surfaces for this concept; the Notifications panel renders only `member_removed`
   (dismiss-only, containing no performance data — Decision unchanged from the original
   requirement). `FakeTeamBackend` gained an equivalent
   `resolveAdminRequestNotification(requestId)` helper, called from the same two
   operations.

Acknowledging a notification (`acknowledgeNotification`) remains idempotent — repeat calls
against an already-read notification are a no-op success, not an error — unchanged from the
original design.

## §Follow-Up Corrections (self-review of this same correction pass)

A second, independent adversarial pass over this very correction found four further
issues, fixed in place:

- **`remove_member`/`leave_team` decided whether the last-admin invariant applied from an
  unlocked snapshot of the target Membership's current functions**, unlike
  `accept_admin_request`'s already-corrected lock-first discipline. A narrow, genuinely
  reachable three-party interleaving (a member's own pending Admin Request being accepted
  concurrently with someone else calling `leave_team`/`remove_member` on that same
  Membership, combined with a second admin relinquishing in the resulting window) could
  reach zero active admins. Fixed: both functions now take the same `for update` lock on
  the target Membership row, before deciding, matching `accept_admin_request` — completing
  the "membership row first, always" ordering this ADR already claimed, rather than only
  partially applying it.
- **`archive_team` never called `private.assert_team_active`**, unlike every other
  `REQUIRES_ACTIVE_TEAM` action, and had no explicit rejection for `status = 'recovery'`
  (relying only on the fact that `require_active_admin` already fails for any team with
  zero active admins — the only way a team reaches `recovery` — to make this unreachable
  in practice). Fixed with an explicit check, for the same reason `preview_invitation`'s
  fix and others in this pass are explicit rather than implicit: an invariant that holds
  only because of a different function's unrelated behavior is fragile documentation, even
  when it happens to be true today.
- **`operational_recover_team_admin`** (service-role-only, not reachable by any ordinary
  caller) lacked the same membership lock and duplicate-pending-request check
  `create_admin_request` received — added for consistency with this ADR's own "every
  function that creates... an Admin Request" claim, which was not, in fact, universally
  true until this addition.
- **No UI existed for an active Team Admin to remove `team_admin` from another member** —
  `removeAdminFunction`/`remove_admin_function` were fully implemented and correctly
  gated (spec §6 explicitly requires this capability), but `TeamsScreen` never called it.
  Added: a "Remove Team Admin" button per roster row that currently holds the function
  (excluding the caller's own row, which uses "Relinquish My Team Admin" instead), gated
  by the same confirmation dialog as the other destructive roster actions.

Two further, lower-severity gaps were found in this pass and recorded, not yet fixed,
at the time: `set_participation`/`assign_direct_function`/`remove_direct_function` did
not re-check the target Membership's status at write time, and
`listAdminRequestsForTeam`'s Supabase implementation relied solely on
`team_admin_requests_select` RLS rather than an admin-only RPC. **Both are now fixed —
see §Membership Write-Time Locking and the corrected §Team-Side Admin Request Read
Model above** (a subsequent, independent review pass; neither is an accepted residual
risk any longer).

## §Membership Write-Time Locking — set_participation, assign_direct_function,
remove_direct_function

`set_participation` and `assign_direct_function` read the target Membership with a
plain (unlocked) `select`, decided whether it was still active, and only then wrote —
a classic check-then-act gap. A concurrent `leave_team`/`remove_member` ending that
exact Membership between the read and the write could let `assign_direct_function`
insert a new active `team_membership_functions` row for a Membership that has, by the
time the INSERT actually runs, already durably ended — an impossible state (an active
Team Function attached to an ended Membership), not merely a lost update. This is a
narrower instance of the same "decide from a stale pre-lock snapshot" shape as
§Team Lifecycle Lock Ordering above, applied to a single Membership row instead of a
Team's status/admin-count.

**Fix:** both functions now take a `for update` lock on the target Membership row
(`select ... where id = p_membership_id and team_id = p_team_id for update`) before
checking its status, matching the discipline `remove_member`/`leave_team`/
`accept_admin_request`/`create_admin_request` already established for their own
Membership reads (docs/adr/0022 §Admin Request Concurrency: "the target Membership
row first"). A concurrent Membership-ending operation now either fully commits before
the function proceeds (so the fresh, lock-protected status read correctly sees
`ended` and the function raises `conflict`), or fully blocks until this transaction
finishes — never an interleaving where the INSERT lands after the Membership has, in
reality, already ended. `set_participation`'s `UPDATE` also gained a
`where ... and status = 'active'` guard, matching `remove_member`/`leave_team`'s
existing status-guarded updates, for the same "fail closed rather than silently
overwrite a concurrently-ended Membership's row" reason.

**Correction (third pass): `remove_direct_function` never re-checked Membership
status at all, unlike its two siblings above.** It already locked the target
Membership row (`for update`), but — unlike `set_participation`/
`assign_direct_function` — never inspected `v_membership.status` afterward. This
was not, in fact, a harmless no-op as an earlier revision of this ADR claimed: its
`update ... where status = 'active'` clause would correctly match zero rows against
an already-ended Membership's function, but the subsequent
`perform private.audit(p_team_id, v_profile_id, 'function_removed', ...)` ran
**unconditionally**, regardless of whether the UPDATE matched anything — so calling
`remove_direct_function` against an already-ended Membership durably wrote a
`function_removed` audit event claiming an action that never actually happened.
Fixed: immediately after the locked existence check, `remove_direct_function` now
rejects a non-active Membership with the same `conflict: This membership has
already ended.` outcome its siblings use, before either the UPDATE or the audit
call — no history row and no audit event are touched in that case. Idempotent
success (a `return` with no audit event) is preserved only for an ACTIVE Membership
whose requested Coach/Training Lead function is already absent — this is unchanged
from before. All three of `set_participation`/`assign_direct_function`/
`remove_direct_function` now follow the exact same protocol: lock the Membership
row, reject a non-active status outright, only then read/write function state.

Both `assign_direct_function` and `remove_direct_function` also gained an explicit
`p_function is null` check alongside their existing `not in ('coach', 'training_lead')`
check — `null not in (...)` evaluates to `null`, which plpgsql's `if` treats as false,
so a null function value previously reached the `insert`/`update` statement and failed
there as a raw not-null-constraint violation instead of a clean `invalid_input`.

Sequential coverage (success, idempotent re-assignment, unknown-function rejection,
and — the case these fixes specifically protect against — rejection once the target
Membership has ended, for all three of `set_participation`/`assign_direct_function`/
`remove_direct_function`) is in `supabase/tests/team_foundation.test.sql` §14, which
was also this suite's first coverage of these three RPCs at all before the second
pass. The third pass's `remove_direct_function`-on-ended-Membership assertion
additionally captures the function-history row's `ended_at` and the
`function_removed` audit-event count immediately before the rejected call and
proves both are byte-for-byte unchanged afterward — not merely that the call
raises some exception.

## §Function Array Input Validation — total, not a partial containment check

`create_team` and `private.validate_invitation_proposal` (used by `create_invitation`/
`revise_invitation`/`resend_invitation`) validated a proposed function array with a
bare `if not (p_functions <@ array[...]) then raise invalid_input`. Two shapes slipped
past this: a NULL array — SQL's `<@` operator returns NULL, not `false`, when either
operand is NULL, and plpgsql's `if not (null)` is `if null`, which is treated as false
and never enters the exception branch — silently reached the function's insert loop
instead, where `foreach ... in array null` raises an opaque, generic error; and a
duplicate value (e.g. `array['coach', 'coach']`), which passes the containment check
trivially and would only have failed later, as a raw `unique_violation` from the
partial unique index on `team_membership_functions`, once the insert loop reached the
second occurrence — never a clean `invalid_input`.

**Fix:** a new shared helper, `private.validate_function_array(p_functions, p_allowed)`,
performs the total check every public boundary accepting a function array now calls:
reject `null` explicitly; reject anything not a subset of `p_allowed`; reject a
duplicate value (`array_length` of the distinct-unnested set must equal the original
array's length, using `coalesce(..., 0)` since `array_length` of an empty array is
`NULL`, not `0`). `create_team` and `validate_invitation_proposal` both call this
helper instead of repeating the bare containment check. The Route Handlers under
`src/app/api/team/invitations/` gained the matching client-side check
(`isValidFunctionArray`, `src/app/api/team/_lib/context.ts`) — non-null, every element
in the allowed set, no duplicates — so a malformed request is rejected with a clear
`invalid_input` before ever reaching the RPC, rather than relying on the RPC as the
only line of defense. `FakeTeamService` gained the equivalent
`validateFunctionArray` check in both `createTeam` and `validateProposal`, so a test
exercising a malformed function array observes the same `invalid_input` outcome
against either `TeamService` implementation.

This does not change the approved composable-function model (Decision 2) — Team
Admin/Coach/Training Lead remain exactly as combinable as before; this only rejects
shapes that were never a valid proposal in the first place.

## §Route Handler Exception Boundary — rejected promises after a durable mutation

None of the five Route Handlers under `src/app/api/team/` (`create_invitation`,
`revise_invitation`, `resend_invitation`, `create_admin_request`, `remove_member`) had
an exception boundary around their primary mutation RPC call — each destructured
`const { data, error } = await client.rpc(...)`, which only handles a RESOLVED
`{ error }` result. A rejected promise (a thrown error from the Supabase client, a
transport-level failure that surfaces as a rejection rather than a resolved error
object) would propagate out of the route handler uncaught, producing whatever
uncontrolled response Next.js's own framework-level error handling produces — never
this feature's own sanitized, `TeamErrorKind`-shaped JSON error. Separately,
`recordDeliveryBestEffort`, `fetchMyDisplayName`, and `fetchTeamName` — every one
documented as "never fails the calling route" — only actually handled a resolved
`{ error }`; a rejected promise from any of them would propagate the same way, this
time AFTER the durable domain mutation had already succeeded, misrepresenting an
already-successful mutation as a failed request.

**Fix:** two new shared helpers in `src/app/api/team/_lib/context.ts`:

- `callMutationRpc(client, rpcName, params)` is now the one call site every route uses
  for its primary mutation. It wraps `client.rpc(...)` in a `try`/`catch`: a resolved
  `{ error }` is re-sanitized via the existing `rpcErrorJson`/`parsePostgresErrorMessage`
  path exactly as before; a thrown/rejected error is now ALSO caught and turned into
  the same stable, sanitized `unexpected_error` JSON response — never a raw
  provider/transport message, never an uncontrolled framework response. This must only
  ever wrap the durable-mutation call itself.
- `bestEffort(label, fallback, run)` wraps every POST-mutation side effect (metadata
  lookups, the email send, delivery-outcome recording) — a thrown/rejected error is
  logged server-side (see §Sanitized Operational Logging below for exactly what is
  logged) and `fallback` is returned, so a failure here can never retroactively turn
  an already-durable mutation's success into an error response. `fetchMyDisplayName`,
  `fetchTeamName`, `recordDeliveryBestEffort`, and a new
  `fetchTeamMemberEmailsBestEffort` (replacing a raw, unwrapped `client.rpc
  ("get_team_member_emails", ...)` call in the `create_admin_request` and
  `remove_member` routes) are all now built on this helper. Every route's one email
  send is now wrapped in `bestEffort` too, so an `EmailService` rejection — despite its
  own documented never-throw contract (Decision 12) — is defense-in-depth caught the
  same way, rather than assumed away.

Two narrow shape guards, `isInvitationCreatedRow`/`isAdminRequestRow`, validate a
successful RPC's returned row before it is passed to `mapInvitationCreatedRow`/
`mapAdminRequestRow` — a malformed result (a schema/RPC version mismatch, never an
expected domain outcome) now fails closed with a generic `unexpected_error` rather
than risking a raw property-access failure surfacing an unsanitized error, or silently
proceeding with a broken token/request reference.

Every route still attempts at most one email send — this correction adds an exception
boundary around each already-single send, never a retry.

**Correction (third pass): the boundary was incomplete in two ways.**

1. **`createSmtpEmailServiceFromEnv()` was called OUTSIDE `bestEffort`** in all five
   routes — a synchronous throw from that factory (a misconfiguration the
   `resolveSmtpConfig`/`resolveAppOriginConfig` validation paths don't already catch,
   or any other synchronous construction failure) would still propagate out of the
   handler after the durable mutation had already committed. Fixed: SMTP service
   construction, canonical-origin resolution (see §Canonical Email Link Origin
   below), and the send itself are now ALL performed inside the same single
   `bestEffort` call per route — nothing that isn't essential to reporting the
   durable result can throw out of any of these five handlers anymore.
2. **The shape guards checked only an `id` (and, for invitations, `raw_token`) —
   not every field the mappers actually read.** `isInvitationCreatedRow` and
   `isAdminRequestRow` are now full shape guards: every required string is checked
   non-empty; every status/enum field (`status`, `email_delivery_status`) is checked
   against its exact known value set; `participation_as_player` is checked boolean;
   `proposed_functions` is checked with the same `isValidFunctionArray` used for
   request-body validation (non-null, allowed values only, no duplicates); every
   required timestamp field is checked as a string that actually parses as a date,
   not merely "a string"; every explicitly nullable field (`accepted_at`,
   `revoked_at`, `replaced_by_invitation_id`/`replaced_by_request_id`) accepts `null`
   or a valid value of its own type, never anything else. A malformed successful RPC
   result — of any of these specific shapes, not merely "missing an id" — now fails
   closed with the same generic `unexpected_error`, never a partially-populated 200
   response built from missing/invalid fields.

## §Canonical Email Link Origin — never derived from the incoming request

`buildAcceptUrl` (`src/app/api/team/_lib/context.ts`), used by the four
email-link-carrying routes (`create_invitation`, `revise_invitation`,
`resend_invitation`, `create_admin_request` — never `remove_member`, which sends no
accept link at all, see below), built its link from `new URL(request.url).origin`
— the incoming request's own origin. This is a security boundary, not cosmetic URL
formatting: the invitation link carries the raw one-time invitation token, and a
request's own URL/Host/forwarded-host is attacker- or proxy-influenced input (an
authenticated caller controls the request it sends; a misconfigured reverse proxy
can rewrite `Host`). Depending on this value lets a caller or a misconfigured
deployment cause an application-authored email to contain a foreign origin — the
raw secret in that link then points wherever the attacker chose. The Admin Request
link is a narrower instance of the same defect: it carries only the request's own
id (a `team_admin_requests.id`, not a secret — accepting it still requires the
signed-in nominee's own identity match via `accept_admin_request`), but a
foreign-origin link is still wrong to send, so the fix below applies uniformly to
both link types.

**Fix:** one explicitly configured, server-only canonical origin, `APP_ORIGIN`
(never a `NEXT_PUBLIC_*` variable — read only from server-side Route Handler code),
resolved by a new `resolveAppOriginConfig()` and validated strictly: it must parse
as a URL; it must use `https:`, or `http:` only for `localhost`/`127.0.0.1`/`::1`
(permitting local development/tests without permitting a production deployment to
silently run on plain http); and it must be an exact bare origin — no path, query,
fragment, or embedded credentials (checked by requiring `parsed.origin === value`
exactly, which also rejects userinfo, since `URL#origin` never includes it).
`buildAcceptUrl` no longer takes a `Request` parameter at all — it cannot read a
Host header even if it wanted to, a structural guarantee independent of any check
inside its body. When `APP_ORIGIN` is absent or invalid, `buildAcceptUrl` returns
`null`; every one of the four link-carrying routes treats that exactly like "no
email service configured" — the durable mutation still completes, and the route
reports an honest `emailSent: false`, never a fabricated success and never a
fallback to the request's own origin.

**`notificationEmailSent` (member removal) is unaffected by `APP_ORIGIN` — it is a
different result field on a different route that never calls `buildAcceptUrl` at
all.** `remove_member`'s removal-notice email (`sendMemberRemovalNotice`) contains
no application link of any kind — see `buildMemberRemovalEmail`
(`src/lib/email/smtpEmailService.ts`) — so it has nothing for `APP_ORIGIN` to
affect; its own `notificationEmailSent: false` outcome is driven only by whether
SMTP itself is configured and the send succeeds. An earlier revision of this ADR,
`.env.example`, and `SYSTEM_ARCHITECTURE.md` incorrectly described an absent/invalid
`APP_ORIGIN` as producing `emailSent: false`/`notificationEmailSent: false` as if
interchangeable outcomes of one shared cause — corrected in all three places.
`docs/adr/0020` / `docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` document
the target architecture only; the concrete env var contract lives in
`.env.example`.

## §Sanitized Operational Logging — never the raw error, only a safe category

`logBestEffortFailure` (`src/app/api/team/_lib/context.ts`) and `toSendFailure`
(`src/lib/email/smtpEmailService.ts`) both logged the caught error's own message —
`logBestEffortFailure`'s own comment claimed tokens/emails/credentials were never
logged, but `err.message` is exactly where such values can appear (a rejected
`fetch`'s message can embed a URL containing a bearer token; a Postgrest error's
message can embed row/column values; an SMTP client's error message can embed the
configured host, port, or authentication context) — the comment described intent,
not enforced behavior.

**Fix:** a new shared helper, `safeErrorCategory` (`src/lib/safeErrorCategory.ts`),
is the one place either boundary is allowed to log anything about a caught error —
alongside a stable, hard-coded operation label, never the raw error text in any
form, in any code path, regardless of whether the error is a thrown `Error` or a
resolved `{ message }`-shaped provider result.

**Correction (fourth pass): the first version of `safeErrorCategory` still read a
runtime-controlled value.** It returned a real `Error`'s own `.name`, or a plain
object's `code`/`status` field when it matched a short character/length pattern.
Both are values the THROWN OBJECT controls, not this module — nothing prevents code
anywhere (this app's own, a dependency's, or a compromised one) from doing
`error.name = someSensitiveValue` or throwing `{ code: someSensitiveValue }`, and an
alphanumeric secret, token, or OTP would satisfy the old pattern check trivially.
Fixed: `safeErrorCategory` now returns ONLY a hard-coded string literal authored in
the module's own source — never any field value, substring, or transformation of
anything read off the caught object. Which literal is chosen depends solely on the
caught value's RUNTIME TYPE, determined via `instanceof` against a fixed set of
built-in `Error` subclasses (`TypeError`, `RangeError`, `SyntaxError`,
`ReferenceError`, `URIError`, `EvalError`, `AggregateError`) and `typeof`/shape
checks — never on its contents:

- one of the named built-in `Error` subclasses above, by `instanceof` (the
  constructor identity — never `.name`, which remains a mutable, runtime-controlled
  property even on a genuine built-in instance);
- the literal `"Error"` for any other `Error` instance (a custom subclass, or a
  built-in one not specifically enumerated);
- the literal `"provider_error"` for a plain object that merely has provider-error
  SHAPE (a `message`, `code`, or `status` property) without being an `Error`
  instance — the presence of these keys is checked, their values are never read;
- the literal `"unknown_error"` for anything else (a primitive throw, `null`,
  `undefined`, or an object with none of the above shape, OR a value whose own
  reflection behavior threw while merely being inspected — see the fifth-pass
  correction below).

Both `logBestEffortFailure` and `toSendFailure` are unchanged in how they call this
helper — only the helper's own return values changed. This does not weaken the
generic, `TeamErrorKind`-shaped browser-facing error sanitization (§Error Boundary
Sanitization) — that boundary already never returned a raw message to the caller;
this closes the separate, server-side-only logging path the same raw text was still
reaching, and now closes it completely rather than merely narrowing what could leak
through it.

**Correction (fifth pass): classification itself was not yet a total, non-throwing
operation.** `instanceof` against a value walks its prototype chain via
`Object.getPrototypeOf`; the `in` operator (used by `isProviderErrorShape`'s
presence check) invokes the target's `has` behavior. For an ordinary object these
never throw — but for a `Proxy`, both are user-definable traps, and a hostile or
merely buggy Proxy whose `getPrototypeOf` or `has` trap throws made
`safeErrorCategory` itself throw, escaping the exact `catch`/`bestEffort` boundary
it exists to protect, after the durable Team mutation that boundary guards had
already succeeded — the categorization step was total over VALUES but not over
every possible value's REFLECTION BEHAVIOR. Fixed by wrapping the whole
classification step in one `try`/`catch`: any exception raised while inspecting the
caught value's runtime type — never while reading a field value, which remains
never read either way — now falls back to the same hard-coded `"unknown_error"`
literal an unrecognized shape already produced. `safeErrorCategory` is now total
and non-throwing for every possible `unknown` input, including hostile Proxies,
while returning the identical fixed set of hard-coded categories for every ordinary
input as before. `src/app/api/team/_lib/context.ts`'s `logBestEffortFailure` and
`src/lib/email/smtpEmailService.ts`'s `toSendFailure` needed no change beyond their
own comments (corrected to stop describing an intermediate, already-superseded
implementation) — both already called `safeErrorCategory` unconditionally; only
that call's own totality was missing.

## Non-goals of this beta

- No coach/athlete data-scope grants, `TeamDataSharingGrant`, or any data-access
  consequence of the `coach` function beyond the label itself — see
  `docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md`'s Coaching model section for the
  target design this does not yet implement.
- No billing/entitlement enforcement of any kind — Team Seat counting, Sponsored Athlete
  Seats, and workspace pricing remain product hypotheses (see that same document's Team
  Workspace billing sections) with no code in this schema reading or writing them.
- No club/federation/organisation layer above one Team Workspace.
- No account-deletion flow, and therefore no reachable path into `"recovery"` (Decision 9).
- No training/performance data of any kind is shared, aggregated, or made visible across
  team members by this feature — `TeamRosterEntry`/`TeamWorkspace` carry identity,
  function, and (admin-only) email only.
