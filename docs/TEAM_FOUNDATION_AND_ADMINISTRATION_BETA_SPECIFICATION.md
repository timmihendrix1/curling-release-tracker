# Team Foundation and Team Administration Beta — Approved Product Decisions

**Status:** Approved product specification

**Decision set confirmed complete:** 2026-08-20

**Scope:** First usable Team Foundation and Team Administration beta

## Authority and purpose

This document is the canonical product source of truth for the first usable Team
Foundation and Team Administration beta. It records the final decisions approved by
the product owner after the repository audit and the subsequent product-question
rounds.

For this scope, this document supersedes conflicting or older product claims elsewhere
in the repository, especially claims that:

- a Team Captain is a modeled function or carries application permissions;
- team creation is available to every confirmed account during the closed beta;
- an athlete grants data access separately to each coach;
- a Team Admin or Coach may create an unclaimed athlete profile in this beta; or
- Coach, Training Lead, player participation, and Team Admin are mutually exclusive
  roles or different seat types.

Architecture decisions and implementation details belong in the relevant ADRs. ADRs
must implement this product model and reference it; they must not silently redefine it.
Approval of this product specification does not by itself prove implementation
completeness. Current implementation and verification status are recorded in
`docs/adr/0022-team-foundation-domain-and-persistence.md`,
`docs/SYSTEM_ARCHITECTURE.md`'s "Team Foundation" section, and
`docs/TECHNICAL_DEBT_AND_ROADMAP.md` — not here.

## 1. Beta boundary

The beta provides the smallest usable foundation for creating one Team Workspace,
inviting real account holders, maintaining its membership and contextual functions,
and safely transferring administrative responsibility.

Team creation is closed-pilot gated. Only accounts that have received the pilot
team-creation capability may create a Team. People invited to an existing Team do not
need that capability.

The beta does not yet implement training-plan distribution, athlete-data sharing,
coach analytics, billing enforcement, multi-club administration, or profile
claiming/merging. The already-approved product direction for those later capabilities
is recorded below so the beta does not create an incompatible foundation.

## 2. Identity, Profiles, and account entry

- Every person participating in the beta uses their own authenticated account and one
  application Profile.
- A Profile has a teammate-visible display name. A person's verified account email is
  not their roster display name.
- A newly invited person follows the invitation link, signs up or signs in with the
  invited email address, completes the minimum Profile bootstrap if needed, and then
  accepts the invitation.
- An existing user follows the same link and may accept only through the account whose
  verified email matches the invitation.
- Team Admins do not create placeholder or unclaimed athlete Profiles in this beta.
  Claiming, merging, and transferring a placeholder Profile to a later account remain
  explicitly deferred.

## 3. Team and Membership model

- One Team Workspace represents exactly one Team.
- A Team's stable identifier, not its name, is authoritative. Different Teams may have
  the same name.
- One Profile may belong to multiple Teams.
- A person has at most one current active Membership in a given Team. Leaving and later
  rejoining creates a new membership period; the old period remains historical.
- There is no separate product category such as `squad member` versus `team member`.
  A person is a Team Member.
- Playing participation is an independent boolean property of the Membership. A Team
  Member may participate as a player or may be non-playing.
- Participation and contextual functions are independent. A playing member may also be
  Team Admin, Coach, Training Lead, any combination of them, or none of them.

## 4. Contextual Team Functions

The beta recognizes exactly three composable contextual functions:

- **Team Admin** — administers the Team Workspace and its membership.
- **Coach** — identifies a person who may later receive the Team's coaching
  capabilities and athlete-approved analysis access.
- **Training Lead** — identifies a person responsible for planning and coordinating
  training.

There is no modeled **Team Captain** function in this product scope. On-ice captaincy
does not create application permissions and is not required for Team administration.
If a future UI needs to display an on-ice captain, that is a separate product decision,
not an implicit administrative role.

Functions are additive, not exclusive roles. Examples that must be representable
include:

- a playing Team Member with no contextual function;
- a non-playing Coach;
- a playing Team Admin;
- a Team Admin who is also Coach and Training Lead; and
- any other combination of player participation with the three functions.

Coach and Training Lead must exist in the data model now even though their training and
analytics capabilities are deferred beyond this beta. They must not acquire Team Admin
permissions merely by holding those functions.

## 5. Team creation

The creator chooses:

- the Team name;
- whether they participate as a player; and
- whether they also hold Coach and/or Training Lead.

The creator always becomes an active Team Member and the first Team Admin atomically.
They do not become Coach, Training Lead, or player unless those independent choices are
selected.

Creation must not leave a Team without an active Team Admin, and a failed creation must
not leave a partial Team, Membership, or function assignment behind.

## 6. Visibility and permission model

Every active Team Member may:

- see the Team and its current compact roster;
- see each current member's display name, player-participation state, and contextual
  Team Functions;
- manage their own Membership by leaving the Team, subject to the final-admin rule; and
- access the ordinary personal product normally, without a special Team screen being
  required for day-to-day training.

An ordinary Team Member must not see other members' email addresses.

An active Team Admin may additionally:

- rename the Team;
- see current member email addresses where needed for Team administration;
- create, revise, resend, and revoke invitations;
- change a current member's player-participation state;
- assign or remove Coach and Training Lead;
- initiate and revoke Team Admin Requests;
- remove Team Admin from another member, subject to the final-admin rule;
- remove a Team Member; and
- archive or restore the Team under the lifecycle rules below.

There may be multiple Team Admins. Team Admin authority is Team-scoped. It does not
grant platform administration, billing authority, ownership of athlete data, or access
to athlete performance analysis.

Frontend visibility is never the security boundary. Every protected read and mutation
must be authorized again on the server from the authenticated actor's current
Membership, active functions, Team status, and target Team.

## 7. Invitation flow

Only an active Team Admin may invite a person. The Admin enters and confirms the email
address and selects the complete proposed Team context:

- whether the invitee participates as a player; and
- which of Team Admin, Coach, and Training Lead the invitee will receive on acceptance.

The system sends an email containing an invitation link. The invitation is not accepted
until the recipient explicitly accepts it while authenticated with the matching email.
Acceptance creates the Membership, player-participation state, and all proposed
functions together. An invitation may therefore be the acceptance mechanism for a new
member who is invited as a Team Admin.

An Admin must be able to correct a mistaken invitation, including a mistyped email or
incorrect proposed context. The viable beta behavior is replace-based revision: the old
link stops working and one new link represents the corrected proposal. Resending also
creates a new valid link and invalidates the older link.

An Admin must also be able to revoke a pending invitation. Revocation is safe to retry.

Invitation rules:

- a link is single-use;
- a pending invitation expires after 14 days;
- an expired invitation is not revived; an Admin creates or sends a new link;
- an invalid, expired, revoked, replaced, already-used, wrong-email, or already-member
  attempt fails without creating partial membership state;
- there is no explicit **Decline invitation** action in this beta; the recipient may
  ignore the invitation; and
- ignoring or not accepting an invitation never blocks the person from receiving or
  accepting a later valid invitation.

Email delivery failure must be reported honestly. It does not fabricate a successful
send and does not silently erase a successfully created invitation; the Admin must be
able to retry with a fresh link.

## 8. Team Admin appointment and succession

For a person who is already an active Team Member, Team Admin is not assigned directly.
An existing Team Admin creates a **Team Admin Request** naming that Membership. The
nominee becomes Team Admin only after explicitly accepting the request.

The request is visible to the nominee in the application and may also produce an email
notification. It expires after 14 days, may be revoked by a current Team Admin, and may
be replaced by a new request when necessary. A person other than the nominee cannot
accept it. A pending, expired, revoked, or otherwise invalid request grants no Team
Admin authority.

The creating Admin needs a Team-side view of the Team's outstanding Admin Requests and
must be able to revoke them. The nominee must not see one actionable request twice
through overlapping notification lists.

## 9. Final-active-Team-Admin invariant

An active Team must always have at least one active Team Admin.

Therefore, the final active Team Admin cannot:

- relinquish Team Admin;
- have Team Admin removed;
- be removed from the Team; or
- leave the Team

until another active Team Member has accepted a Team Admin Request and is an active Team
Admin. Merely sending a request is not sufficient.

The final Admin may instead archive the Team. Operations that can remove the last Admin
must enforce this invariant atomically so concurrent actions cannot leave an active Team
without an Admin.

## 10. Leaving and removal

- A non-final-admin Team Member may leave immediately without Admin confirmation.
- A Team Admin may remove another member, subject to the final-admin invariant.
- Leaving or removal ends the current Membership and every active Team Function for that
  Membership together.
- From that point, the former member has no current Team access, authority, affiliation,
  or athlete-data access through that Membership.
- Any pending Team Admin Request naming the ended Membership becomes unusable.
- A later return requires a new invitation and creates a new Membership period.
- Removal produces a concise account notification and a best-effort email notification.
  It must not include athlete performance data.

Historical records may retain the minimum membership period, function assignment, and
attribution needed for integrity and audit. They do not confer current access or present
the person as currently affiliated with the Team.

## 11. Team archive, restore, and restricted recovery

The beta archives Teams rather than hard-deleting them.

- Only an active Team Admin may archive an active Team.
- Archiving suspends ordinary collaborative writes, including roster changes and new
  invitations, while retaining Team identity and historical records.
- Members may still leave an archived Team. Leaving remains final for that Membership.
- A remaining Team Admin may restore an archived Team.
- Restore reactivates the Team for the Memberships that still exist; a person who left
  or was removed is not restored.
- The final-admin invariant does not prevent the final Admin from leaving an already
  archived Team, because the Team is no longer operational.

The longer-term model includes a restricted recovery state for exceptional loss of the
final Admin, such as eventual account deletion without a successor. In recovery,
administration and collaboration stay suspended until an authorized operational process
nominates an existing member through the same acceptance-based Team Admin Request flow.
The ordinary beta UI must not allow a user to place a Team into recovery or self-assign
through it. Account deletion and the entry path into recovery are deferred; the beta may
prepare the safe exit mechanism without claiming the full recovery lifecycle is active.

## 12. Beta user experience and navigation

Team creation, Team administration, roster/function management, invitations, Admin
Requests, archive/restore, and Membership management live under **Settings**. They do
not add a permanent top-level Team destination to the current application navigation.

An ordinary Team Member does not need a dedicated Team View for this beta. The Team
area under Settings is sufficient for seeing the compact roster and managing their
Membership.

Invitation links must preserve their intent across sign-up/sign-in and Profile
bootstrap, then return the recipient to an actionable invitation state. Every terminal
or error state must offer a safe way to leave the invitation UI.

When team-assigned training is implemented later, the ordinary athlete receives that
training on Home and/or Train and remains free to start and complete a personal training
session instead. A future Coach or Team-operational view may be added when its concrete
planning or analysis workflow exists; it is not required by this foundation beta.

## 13. Approved future athlete-data-sharing direction

The following decisions are approved constraints for later work but are **not** part of
this beta's implementation:

- Team Membership alone shares no personal training or performance data.
- Consent is granted to a **Team**, not separately to every individual Coach. The UI
  must not require an athlete to repeat the same sharing decision coach by coach.
- The athlete chooses which data scope is shared with that Team.
- The athlete may share new data prospectively and may additionally opt to share
  historical data. Historical sharing is never assumed merely because prospective
  sharing was accepted.
- Only people who currently hold Coach for that Team may use the Team's athlete-approved
  analytical access. Adding Team Admin or Training Lead does not grant those analyses.
- A Training Lead may later see assignment/workflow information needed to coordinate
  training, including whether an assigned training was completed and a limited volume
  indicator such as stones played. A Training Lead does not thereby see the athlete's
  released performance analyses.
- A Team Admin who needs Coach analysis must separately hold Coach.
- Ending the Membership or the relevant Team authorization ends current access through
  the Team.

The exact sharing scopes, revocation/retention behavior, consent UI, training-plan model,
and analytics presentation require their own specification before implementation. The
foundation must not encode a per-Coach consent model that would conflict with the
approved per-Team direction.

## 14. Approved Team Seat and coaching-entitlement hypothesis

Billing is not implemented in this beta, but the foundation must remain compatible with
this approved commercial hypothesis:

- A Team pays for membership capacity as uniform **Team Seats**.
- One current member consumes one Team Seat, regardless of player participation or any
  combination of Team Admin, Coach, and Training Lead.
- Changing contextual functions does not add, remove, or reclassify a Team Seat.
- Pending invitations and former Memberships consume no current Team Seat. Memberships
  in an archived, non-operational Team do not consume current operational capacity.
- A future paid coaching capability should be modeled as a Team Workspace capability or
  add-on, not as a more expensive Coach seat and not as a permission consequence of
  billing alone.
- Even with that future capability, athlete data access still depends on the athlete's
  Team-scoped consent and the viewer's current Coach function.

Prices, packaging, seat allowance, payment provider, payer model, sponsored personal
entitlements, grace periods, and billing enforcement remain deferred commercial
decisions. They must not be hard-coded into Membership identity or Team permissions.

## 15. Explicitly deferred matters

The following are intentionally outside the first usable beta and must not be inferred
or implemented as hidden requirements:

- unclaimed athlete Profiles, claiming, automatic or manual Profile merging;
- a modeled Team Captain or on-ice leadership workflow;
- team training-plan creation, publishing, assignment, and delivery;
- athlete Team-data consent and historical-data sharing UI;
- Coach analysis views, feedback, aggregate analytics, and advanced coach analytics;
- any special Team dashboard for ordinary members;
- billing, subscriptions, seat enforcement, prices, and payment-provider integration;
- Sponsored Athlete entitlement implementation;
- club, federation, academy, national-squad, or multi-Team administration;
- cross-Team coaching products;
- account deletion and the ordinary entry path into restricted Team recovery;
- speculative direct messaging or broader collaboration features; and
- minors/guardian consent and safeguarding workflows.

Deferral means these matters are not beta blockers. Where this document records a
future direction, the beta must avoid contradicting it but need not build it.

## 16. Beta acceptance principles

The first usable beta is product-correct only if all of the following remain true:

1. A pilot-enabled person can create a Team without assuming Coach, Training Lead, or
   player participation, while always establishing the first Team Admin.
2. A Team Admin can invite a real person by email, correct or cancel the invitation,
   and the recipient can complete sign-up/sign-in and accept without an unclaimed
   Profile workaround.
3. Player participation and the three contextual functions compose independently.
4. Existing members become Team Admin only by accepting a Team Admin Request.
5. No active Team can lose its final active Admin through a race or stale request.
6. Leaving/removal eliminates every current authorization path and current affiliation.
7. Ordinary members see the roster but not member emails or athlete performance data.
8. Team management is usable from Settings without requiring a new top-level Team view.
9. No UI or backend path fabricates email delivery success or leaks internal provider or
   database errors.
10. Billing, coaching analytics, data sharing, and multi-club features remain visibly
    deferred rather than partially or speculatively implemented.
