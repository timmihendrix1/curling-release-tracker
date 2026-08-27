# Mandatory Identity and Free Cloud Foundation — Approved Product Decisions

**Status:** Approved product specification. **Stages B0.2, B0.3 and B0.4 are implemented and verified locally; see ADR-0027 for the Free Cloud terminal-record backbone.**

**Decision set confirmed complete:** 2026-08-24

**Scope:** The platform-wide identity requirement, the minimal onboarding that satisfies
it, Profile-scoped ownership, offline behaviour after onboarding, and the Free Cloud
Core — the structured sporting data every Free user's account keeps in the cloud.

## 1. Purpose, authority, status and relationship to existing documents

This document is the canonical product source of truth for the decisions listed below.
It records the decisions approved by the product owner. A later implementation agent
should not need conversation history to implement them.

**Status discipline.** Everything in this document is an **accepted target product
decision**. B0.2's identity/onboarding gate and B0.3's Profile-scoped local sporting
persistence are implemented together in the current working tree. The application is
no longer accountless-capable: the sporting shell mounts only for an onboarded Profile,
and each Profile receives an isolated local sporting namespace. **Sporting cloud
persistence remains unimplemented**; `localStorage` is still the production authority
inside each Profile scope. Section 12 states the current-versus-target split explicitly.
An implemented target is not evidence that a later cloud stage is already present.

**Authority order.** For the subject matter above, this document supersedes conflicting
or older product claims elsewhere in the repository — in particular claims that:

- the application may be used permanently without an account;
- signing in is optional and purely additive;
- cloud backup of the athlete's structured sporting data is a paid capability;
- a `Profile` may be linked to zero `UserAccount`s in the operational product;
- existing unscoped local training data must be adopted, claimed, imported or merged
  into an account.

**The durable architecture decision this specification authorises is**
`docs/adr/0024-mandatory-identity-and-free-structured-cloud-foundation.md`. That ADR
records the architectural consequences; this document records the product decisions. If
the two disagree, this document governs the product rule and the ADR must be corrected.

**Related documents.** Read together with:

- `docs/PRODUCT_DIRECTION_AND_PRINCIPLES.md` — product principles, including the
  redefined meaning of "local-first";
- `docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md` — the wider cloud, identity
  and collaboration target architecture this specification corrects in place;
- `docs/TEAM_FOUNDATION_AND_ADMINISTRATION_BETA_SPECIFICATION.md` — the canonical Team
  product model, unchanged by this document except where Section 4 narrows it;
- `docs/EXERCISE_LIBRARY_AND_EXECUTION_SPECIFICATION.md` — the canonical Exercise
  product model, whose commercial mapping Section 6 corrects;
- `docs/SYSTEM_ARCHITECTURE.md`, `docs/DOMAIN_GLOSSARY.md`,
  `docs/PERSISTENCE_BOUNDARY_DESIGN.md`, `docs/TECHNICAL_DEBT_AND_ROADMAP.md`.

**What this document deliberately does not do.** It designs no schema, no outbox, no
conflict protocol, no retry schedule, no API contract, no legal-acceptance table, no
entitlement table, and no token model. Those belong to the implementation stages in
Section 11.

## 2. Identity and access

1. The application requires a `UserAccount` **and** a completed personal `Profile`.
2. **No Profile means no access to the application.** There is no accountless path into
   the authenticated application, and no permanent guest mode.
3. A **Free** plan exists. Free users must still sign in. Free is a commercial tier, not
   an exemption from identity.
4. Public marketing pages, and other deliberately public material, may remain accessible
   without an account. The gate applies to the authenticated application itself.
5. `UserAccount` and `Profile` remain separate concepts. Authentication identity is not
   sporting identity.
6. **`Profile.id` is a stable, application-owned UUID.** It is never equal to, and never
   replaced by, the authentication-provider user id.
7. Authentication establishes **who is acting**. Athlete-owned sporting data, local
   persistence scope, cloud authority, and recorder/actor attribution are all
   **Profile-scoped**.
8. This resolves `docs/adr/0020-supabase-schema-rls-and-adoption-transactions.md`'s
   previously open account-scope-versus-Profile-scope question **in favour of Profile
   scope** for personal sporting data authority. **ADR-0020 is not thereby
   implementation-ready.** Its affected tables, RPCs, RLS rules, locks, completeness
   proofs and test designs still require a later, focused reconciliation stage, and its
   other independent blockers are untouched by this decision.
9. Every person who accesses the application must authenticate and complete a Profile.
10. For the planned multi-athlete Exercise Session, **every participating athlete and
    every recorder or coach who accesses the app must have their own account and
    Profile.** They do not all sign into the recorder's device.
11. The **active recorder is derived automatically from the authenticated Profile on that
    device.** There is no separate "Recorded by" selection button.
12. **One active recorder is sufficient for Version 1.**
13. Moving an in-progress recording to another device remains outside Version 1.
14. **Unclaimed participant Profiles, and minor/guardian workflows, remain deferred.**
    Neither is a Version 1 access path.

## 3. Minimal onboarding

### 3.1 Sign-in methods

1. The closed-test sign-in methods are:
   - **six-digit email one-time code (OTP)**;
   - **Google sign-in**.
2. Magic links, passwords, Apple sign-in and additional providers remain **deferred**,
   unless a later platform requirement (for example an app-store rule) changes that
   decision.
3. The authentication method must not require the athlete to sign in every time the app
   is opened. A session persists and refreshes on the device.

### 3.2 Profile resolution

4. After successful authentication, **exactly one personal Profile is created or
   resolved.**

### 3.3 Required before first application access

5. Before first application access, the user must:
   - provide a **display name**;
   - **accept the current Terms of Service**;
   - **accept or acknowledge the current Privacy Policy**, as legally appropriate.
6. Legal acceptance must be **versionable and auditable** in the later implementation.
   Its schema is deliberately not designed here.
7. **Marketing consent is separate, optional, and off by default.** It must never be
   bundled into required legal acceptance.

### 3.4 What completed onboarding grants

8. Completed personal onboarding **atomically** grants the Profile all three of:
   - **Athlete capability**;
   - the **default Free entitlement**;
   - **eligibility to pass the global application gate**.

   A Profile that has been resolved or created but has **not** completed onboarding carries
   none of these — it cannot pass the gate, holds no Athlete capability, and has no
   entitlement.
9. This supersedes `docs/adr/0022-team-foundation-domain-and-persistence.md` **only to
   the narrow extent** that completed personal app onboarding must establish Athlete
   capability. It does not rewrite Team Foundation history, and it does not imply that
   arbitrary Team `Profile` creation grants Athlete capability. ADR-0022 Decision 10's
   statement — that no Team Foundation RPC creates an `athletes` row — remains true of
   the implemented Team Foundation service.

### 3.5 What onboarding does not ask for

10. Team, club, country, playing position, skill level and training goals are **not
    required** during initial onboarding.
11. A Profile may later **also** act as Coach, Team Admin or Training Lead. Onboarding
    does not force the user to choose one permanent role.
12. **No training data may be created before Profile onboarding is complete.**

## 4. Profile-scoped ownership and authority

1. The athlete owns their personal performance history. Joining a Team, accepting a
   coach, or being funded by someone else never transfers ownership.
2. Ownership, local persistence scope, cloud authority and actor attribution are keyed by
   `Profile.id`, never by the authentication-provider user id.
3. Identity, contextual Team functions, permissions and commercial entitlements remain
   four separate concepts. A Team permission is never an entitlement, and an entitlement
   is never a permission.
4. Subscription state never changes ownership of athlete data.

## 5. Offline access after onboarding

1. **First authentication and first Profile onboarding on a device require
   connectivity.**
2. After successful onboarding, and after a trusted, Profile-scoped local state has been
   established on that device, the athlete must be able to **start, perform, finish and
   review supported training while offline.**
3. **"Local-first" now means reliable offline training for a previously authenticated and
   onboarded Profile.** It no longer means accountless use.
4. A permanent active connection is **not** required during training. Rink connectivity
   must never block training.
5. A first-time user, a signed-out user, a deleted account, or a device with no
   previously established trusted Profile **may reach the public, sign-in and onboarding
   surfaces while online** — that is the only way to become trusted — but **cannot reach
   any authenticated training or application surface until authentication and onboarding
   complete, and cannot bypass that gate by going offline.**
6. **Explicit sign-out or account switching immediately hides and locks the previous
   Profile's local data.**
7. Server-side revocation or deletion that happens while a device is offline can only be
   learned when connectivity returns. **Before uploading, the client must revalidate
   server authority, and must fail closed for upload if authorization is no longer
   valid.**
8. **No fixed offline expiry period is decided here.** Whether trusted local state
   expires, and after how long, is an open decision for the implementation stage that
   needs it. Do not invent a duration.

## 6. Free Cloud Core and commercial boundaries

### 6.1 The Free Cloud Core

1. **All supported structured raw sporting and training data needed to reconstruct the
   athlete's history and calculate future analytics is included in Free cloud
   persistence.**
2. The Free Cloud Core includes, as applicable:
   - Training Sessions;
   - Training Blocks;
   - Shots;
   - Assessment Runs and Attempts;
   - Exercise Executions and Attempts;
   - athlete assignment and ownership references;
   - Handle and Shotmaking 0–4 evaluations;
   - "Do not score" and void/revision facts;
   - Release Time and Rotation Count measurements;
   - configuration and immutable version snapshots required to interpret results;
   - private Athlete Notes;
   - provenance and audit records required to preserve factual history.
3. **No Free-plan date cutoff may be imposed** that would make older structured raw data
   unavailable for later retrospective analytics.
4. **Free includes basic restore after signing into a new device.**
5. Free users retain access to their own supported raw records, basic result and session
   summaries, and export.
6. Derived analytical projections and cached aggregates are **not** the canonical
   sporting record. They may be recomputed and are not themselves guaranteed by the Free
   Cloud Core.

### 6.2 The paid personal tier

7. A **paid personal tier** unlocks value **derived from** the stored data: longitudinal
   analytics, comparisons, trends, benchmarks, recommendations and other separately
   approved premium capabilities.
8. **The final commercial name of that tier is not decided.** Existing documents call it
   `Personal Athlete`; that name must not be treated as final, and must not be
   permanently renamed to "Pro" or anything else by an implementation agent.
9. **Upgrading must make historical Free data available to paid analytics without
   migration, re-import or re-recording.**
10. **Downgrading must not delete raw sporting history.** Free recording and Free cloud
    persistence continue. Premium views and workflows may become unavailable.
11. **Re-upgrading restores paid analysis over the complete retained history.**

### 6.3 What Free does not automatically guarantee

12. **Large or operationally expensive data is not automatically guaranteed by the Free
    Cloud Core.** Video, high-frequency sensor streams, large coordinate traces and
    AI-generated artifacts may later carry separate entitlements, limits, storage
    policies or retention rules.
13. Those separate limits are a later, distinct commercial decision. This document does
    not define video or sensor pricing, quotas or retention.

### 6.4 Commercial-documentation discipline

14. **Do not put current Supabase prices, or any other volatile vendor pricing, into
    canonical architecture documents.** Cost sensitivity is a real design input; a
    quoted price is not a durable architectural fact.
15. Keep identity, permissions, ownership, commercial entitlements and persistence
    authority as separate concepts in every document and in every schema.

### 6.5 Team and Exercise commercial boundaries

16. Browsing the curated Standard Exercise Library remains **Free**.
17. Solo execution with manual scoring or manual measurements remains **Free**.
18. Private Athlete Notes and basic execution results remain **Free**.
19. **Athlete-owned structured raw results created inside a Team Session remain stored
    and accessible to that athlete even when the athlete has only Free.**
20. Creating and coordinating multi-athlete Team Sessions remains a **Team Workspace**
    capability.
21. Team roster, role coordination, rotation, one active recorder, and Team-owned or
    Team-executed plans remain **Team Workspace** capabilities.
22. Reusable personal Training Plans, advanced analytics, supported automatic hardware
    capture, video, sensors and AI may remain **paid** according to their separately
    approved boundaries.
23. **The closed beta still uses reversible pilot entitlements and implements no
    production payment collection in this stage.**

## 7. Synchronization behaviour and visible truth

1. Offline-created records receive **stable client-generated IDs before upload.**
2. **Local pending data is strictly Profile-scoped.**
3. Upload is **automatic when connectivity returns.**
4. Upload is **idempotent**: retrying must not create duplicate sporting records.
5. **Missing connectivity does not block completing a training or starting another
   one.**
6. The product must distinguish at least these user truths:
   - **Saved on this device**;
   - **Synced**;
   - **Sync issue**.
7. **A record is not described as cloud-backed or synced until the server acknowledges
   it.** This is a UX-writing obligation as well as an engineering one — see
   `docs/UX_WRITING_GUIDELINES.md`'s "Separate Facts from Interpretation".
8. **A sync problem must preserve the local record and remain retryable.**
9. **A pending record from one Profile must never be visible or uploaded under another
   Profile** after sign-out or account switching.
10. **Conflicting content under the same stable identity must never be silently
    overwritten.**
11. **Basic restore on a new device is Free.**
12. **Deferred:** continuing the same in-progress Session on another device, concurrent
    multi-device editing, and transferring an unsynced Session to another device. Free
    restore is not cross-device continuation and must never be described as such.
13. **Belongs to later implementation stages, not to this document:** the exact outbox
    schema, the conflict protocol, the retry schedule, the API contract, and the database
    transaction design.

## 8. Downgrade, account deletion and local account isolation

### 8.1 Downgrade

1. Downgrading is covered by Section 6.2 items 10–11: raw history is retained, Free
   recording and Free cloud persistence continue, premium capability stops.

### 8.2 Account deletion

2. **Account deletion requires recent re-authentication.**
3. **A complete personal data export is offered before deletion.**
4. **Deletion begins a 30-day recovery period.**
5. **Application access and synchronization are disabled while deletion is pending.**
6. During the recovery period, the user **may cancel deletion** through a controlled
   re-authentication flow.
7. After the recovery period, the authentication account and personal cloud data are
   **deleted**, or **narrowly anonymized** where shared Team or audit relationships
   legally and operationally require retention.
8. **Exact shared Team-result anonymization and participant-notification behaviour
   remains a Stage C / privacy design.** It is not settled here.
9. **Profile-scoped local data on the current device must be deleted or made
   inaccessible.**
10. **There is no usable local-only athlete after account deletion.** The pre-existing
    "the user separately chooses whether local training history is retained as
    local-only history" option is withdrawn.
11. **A newly created account must not be silently linked to the deleted account's
    data.**

### 8.3 Local account isolation

12. Sign-out and account switching lock the previous Profile's local data immediately
    (Section 5 item 6), including any pending upload (Section 7 item 9).

## 9. Treatment of legacy unscoped test data

1. Existing unscoped local data was produced only during early testing and is
   **explicitly disposable.**
2. **There is no Legacy Local Adoption, claim, import, merge or per-session migration
   flow for that data.**
3. The Profile-scoped local persistence stage (Stage B0.3) **discards the old unscoped
   test data once, safely and explicitly.** This is implemented by ADR-0026.
4. **Stage B0.1 does not implement that deletion.**
5. `docs/adr/0016-resumable-localstorage-to-indexeddb-copy-migration.md`'s
   `localStorage`-to-IndexedDB copy migration, and
   `docs/adr/0017-indexeddb-activation-verification-and-rollback-protocol.md` /
   `docs/adr/0018-indexeddb-production-activation-fencing-and-outage-policy.md`'s
   activation path, are **not the forward production migration path** for these
   disposable records.
6. `docs/adr/0015-indexeddb-adapter-unwired.md`'s generic, unwired IndexedDB adapter
   **may remain useful infrastructure.** The adapter itself is not invalidated merely
   because the legacy copy/activation programme is retired.
7. **Dormant migration code is not deleted by this decision.** Retiring a path is a
   documentation and planning act here, not a code removal.

## 10. Explicitly deferred capabilities

None of the following is authorised by this document:

- magic links, passwords, Apple sign-in, and additional identity providers;
- unclaimed participant Profiles;
- minor accounts and guardian workflows;
- continuing an in-progress Session on a second device;
- concurrent multi-device editing of the same record;
- transferring an unsynced Session to another recorder device;
- a fixed offline trusted-state expiry period;
- the final commercial name of the paid personal tier;
- video, high-frequency sensor and AI storage entitlements, quotas and retention;
- production payment collection, billing provider selection and pricing;
- the exact shared Team-result anonymization and notification behaviour on deletion;
- any generic ACL or policy-builder model.

## 11. Required implementation stages and review gates

Each stage has its own focused implementation scope, negative-case matrix, and
independent review gate before the next stage starts, per
`docs/AI_DEVELOPMENT_WORKFLOW.md`'s "Large cross-layer features".

| Stage | Scope | Gate |
|---|---|---|
| **B0.1 — Decision Reconciliation** | Documentation and ADR only: this specification, ADR-0024, and reconciliation of the active architecture, persistence, commercial, Exercise, roadmap, glossary and agent-routing documents. No runtime, schema, test or configuration change. | Independent documentation review: no active target document still promises accountless access; no active commercial table still places basic structured cloud backup behind the paid personal tier; current implementation is not described as already gated or cloud-backed. |
| **B0.2 — Identity and Onboarding Gate** | One application-level auth authority; email OTP; Google sign-in; Profile bootstrap; legal acceptance; Athlete capability; Free entitlement; the global access gate; offline identity continuity. **No sporting cloud persistence yet.** **Not independently releasable — see §11.1.** | Independent review of the gate's negative cases: signed-out, offline first run, deleted account, revoked session, account switch, interrupted onboarding, refused legal acceptance. **This gate proves authentication and onboarding *state transitions* only. It does not, and cannot, close sporting-data confidentiality across an account switch — that stays open until B0.3.** |
| **B0.3 — Profile-scoped Local Data** | Profile-isolated local persistence; account-switch and sign-out isolation; the **one-time** retirement of disposable unscoped test data. **Completes the releasable unit B0.2 opens — see §11.1.** | Independent review that no Profile can observe another Profile's local data or pending writes, and that the one-time retirement is explicit, bounded and not a silent data loss for anything in scope. |
| **B0.4 — Free Cloud Data Backbone** | Server schema; ownership; RLS; idempotent upload; a durable outbox; restore; retry; sync truth; conflict behaviour. | **Requires real database verification.** SQL, RLS, grants, triggers and concurrency behaviour are not verified by TypeScript tests or careful reading. If no real database environment is available, the SQL is classified as written but unexecuted and this stage is not complete. |
| **Stage B — Exercise Execution** | Technique, Shotmaking, supplementary measurements, and linkage to the existing Release Time execution. | Starts only after the identity and persistence prerequisites above are ready and independently reviewed, in addition to `docs/EXERCISE_LIBRARY_AND_EXECUTION_SPECIFICATION.md` §21's own Stage B gate. |
| **Later Exercise stages (C, D, E)** | Unchanged in content — see `docs/EXERCISE_LIBRARY_AND_EXECUTION_SPECIFICATION.md` §21. | Their prerequisites are updated where the older documents assumed optional identity or paid cloud backup. |

### 11.1 B0.2 and B0.3 are one releasable privacy unit

**B0.2 and B0.3 remain two separate implementation scopes with two independent review
gates. They are not two separate releases.**

**Why.** B0.2 introduced mandatory authentication, the global Profile gate, sign-out, and
account switching. In that stage alone it did **not** change sporting persistence: before
B0.3, the seven sporting-data repositories still read and wrote **one identity-unscoped
local workspace**. If B0.2's experience had been enabled for real users on its own, a **second authenticated
account in the same browser would observe the first account's sporting data** — the gate
would invite account switching while nothing isolates what switching exposes.

**The rule.**

1. B0.2 may be implemented and independently reviewed **first**, on its own scope.
2. **B0.2's mandatory-gate and account-switching experience must not be enabled for real
   users, and must not be released as the new product behaviour without B0.3's Profile
   isolation and one-time disposal and the combined release review.**
3. **The release gate is the combined B0.2 + B0.3 unit**, and it must prove that **no
   Profile can observe another Profile's local data or pending writes.**
4. B0.2's own account-switch negative cases prove **authentication and onboarding state
   transitions** only — signed-out, revoked session, interrupted onboarding, switching
   identity. **Sporting-data confidentiality across an account switch is not closed by that
   review**, and B0.2's report must say so rather than implying isolation is proven.

**What this rule must not become.**

- **Not a reason to import, adopt, assign or claim the unscoped data** for whichever account
  signs in first. That data is disposable (§9); it is discarded, never adopted.
- **Not a reason to move disposal into B0.2.** Disposal stays in B0.3, where Profile
  isolation exists to make it meaningful.
- **Not a deployment mechanism decision.** How the combined unit is held back — a flag, a
  branch, an unreleased build, staged enablement — is an implementation choice for those
  stages. **This document does not choose one, and an implementation agent must not invent
  one here.**

**B0.2 is therefore never described as independently release-ready.**

### 11.2 Where B0.2's architecture is recorded (implementation consequence, not a product decision)

Stage B0.2's architecture is recorded in
`docs/adr/0025-application-identity-gate-onboarding-completion-and-trusted-device-state.md`
(**accepted; B0.2a-e implemented and verified**), written before implementation as
`docs/AI_DEVELOPMENT_WORKFLOW.md`'s "Large cross-layer features" requires.

**That ADR changes no product decision in this document.** It records *how* the decisions in §2, §3
and §5 are to be built — the identity authority, the durable access-barrier protocol and its
non-destructive resolution, the three-phase startup including OAuth-return intake, the provider
flow-correlation rules, the onboarding completion transaction, and the trusted-device record — together
with the honest limits of each. Where the ADR and this document disagree, **this document governs the
product rule and the ADR is the defect**.

Three implementation consequences are worth stating here because they are easy to misread as new
product rules, and are not:

1. **Signing in still grants nothing on its own.** The ADR's barrier, attempt and resolution records are
   local correlation evidence, not authorisation. Athlete capability, the Free entitlement and gate
   eligibility continue to come only from **completed onboarding**, exactly as §3.4 requires.
2. **The offline capability of §5 is unchanged, and no expiry is introduced.** The ADR adds the local
   trusted-device record that makes §5.2's offline training possible and specifies when a definitive
   *online* negative result **triggers the deny-ward invalidation protocol**. That protocol *attempts*
   durable denial — through the invalidation barrier and trusted-record cleanup — and retains the
   documented limitation that if **both** mechanisms fail, the result is page-lifetime denial with **no
   durable offline-revocation claim**. It records a negative fact only after that fact has actually been
   learned online, and **invents no offline expiry period** — §5.8 remains open.
3. **Marketing consent remains as §3.3 item 7 states.** B0.2 asks for nothing, stores nothing and
   infers nothing; absence is never consent. Any future marketing capability needs its own separate,
   explicit, optional, default-off design, never bundled with the required legal steps.

The ADR also records one limitation this document does not need to decide: **browser storage is not a
security boundary**, so a forged local identity record can mount the application shell and expose the
Profile namespace named by that forged record to someone already controlling this device. B0.3 closes
ordinary application-level cross-Profile isolation; it does not turn browser storage into protection
against device-level tampering.

## 12. Current implementation versus accepted target

| Concern | Current implementation (fact) | Accepted target (this document) |
|---|---|---|
| Access | B0.2's global gate is mounted; `TrackerApp` does not mount without a gate-approved completed Profile and its B0.3 Profile persistence boundary. | `UserAccount` + completed `Profile` required. No Profile, no access. **Implemented.** |
| Sign-in | Required email OTP and Google entry are rendered by the one application-level identity authority. | Required. Email OTP **and** Google sign-in for the closed test. **Implemented.** |
| Onboarding | Blocking platform onboarding collects display name, separate Terms acceptance and Privacy acknowledgement, then calls the atomic server completion. Team-local bootstrap is retired. | Display name, Terms acceptance, Privacy acknowledgement, Athlete capability, Free entitlement — all before first app access, application-wide. **Implemented.** |
| Profile | The application-owned `Profile.id` UUID is mandatory at the gate and immutably scopes all seven local sporting repositories plus the B0.4 terminal sporting-record cloud backbone. | The same `Profile.id` UUID model, mandatory and platform-wide, and the scope key for all athlete-owned data. **Implemented for current local domains and terminal cloud records.** |
| Athlete capability | Completed personal onboarding creates it atomically with legal evidence and the Free entitlement, and the mounted UI invokes that flow. | Established by completed personal onboarding. **Implemented.** |
| Persistence authority | Profile-scoped `localStorage` via an immutable per-Profile adapter namespace above the seven application-owned repositories (ADR-0026), plus the Profile-scoped durable B0.4 queue. IndexedDB remains unwired. | Profile-scoped local persistence plus a Free structured cloud backbone. **Implemented for archived Training Sessions and terminal Assessment Runs.** |
| Cloud sporting data | Exact terminal record payloads, server-owned digests, RPC-only idempotent writes/deletions, permanent tombstones, own-Profile RLS, basic restore and honest aggregate sync truth (ADR-0027). Current Sessions and Assessment drafts stay device-local. | The Free Cloud Core, with idempotent upload, durable outbox, restore and honest sync status. **Implemented for the sporting domains that currently have terminal records.** |
| Offline | A previously authenticated and onboarded Profile with valid trusted-device state can enter and use only its Profile-scoped sporting workspace offline; first run and invalidated/signed-out devices remain gated. | Works offline **for a previously authenticated and onboarded Profile** on a device with trusted Profile-scoped local state. **Implemented locally.** |
| Legacy local data | The ten unscoped disposable early-test keys are removed content-blind behind a completed retirement marker before sporting repositories mount. Dormant copy-migration code remains uninvoked. | Discarded once, explicitly, in B0.3. Never adopted, claimed, imported or merged. **Implemented.** |
| Commercial model | Completed onboarding grants the default Free entitlement and the mounted gate consumes it. No paid-entitlement or billing lifecycle exists. Team Foundation is pilot-gated by a per-profile grant. | Free (including the Free Cloud Core) plus a separately named paid personal tier, Team Workspace and a deferred Coaching module. Still no payment collection. |

**Read this table as the honesty contract for the whole specification.** Any statement
elsewhere that the left column already matches the right column is a defect.
