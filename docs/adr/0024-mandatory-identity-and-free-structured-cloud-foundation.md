# ADR-0024: Mandatory identity, authenticated offline operation, and a Free structured cloud foundation

## Status

**Accepted architecture/product direction. Not implemented.**

No runtime code, schema, migration, test or configuration is added by this ADR. It
records a durable architectural direction and the supersessions that direction causes.

**Product authority.** `docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md`
is the canonical product source for the decisions this ADR implements architecturally.
This ADR must not silently redefine that specification. Where they disagree, the
specification governs the product rule and this ADR is the defect.

## Context

### Current implementation reality

These are facts about the code as it exists on this branch, stated separately from
anything this ADR decides:

- The application is fully usable with **no account**. `AccountControl.tsx` is mounted
  above the per-view header in `TrackerApp.tsx` and never gates the app; every auth state
  renders inline alongside whatever screen is active.
- The **Optional Supabase Auth Shell** (`src/lib/supabase/`; no ADR of its own — see
  `docs/SYSTEM_ARCHITECTURE.md`'s section of that name) implements **email OTP only**, is
  inert unless the two `NEXT_PUBLIC_*` Supabase variables are present, and yields only an
  `AccountIdentity` (an id and an email). **There is no application-wide mandatory personal
  onboarding, no global Profile gate, no legal acceptance, no marketing-consent separation,
  no default Free entitlement, and no Athlete-capability creation.**
- **A Team-specific Profile bootstrap does already exist.** Once signed in, `TeamsScreen`
  (and `TeamInvitationAcceptOverlay`) call `TeamService.getMyProfile()`, collect a display
  name when none exists, and call `TeamService.bootstrapProfile(displayName)`; both the fake
  and Supabase implementations honour that boundary, backed by a `bootstrap_profile` RPC
  whose SQL **has been executed and tested at the SQL/RPC level** against a real local
  Supabase Postgres (ADR-0022); the Team UI and Route Handler flow above it remains
  unexercised end to end against that database. This is a Team-feature entry step reached
  only from Teams — **not** the platform onboarding gate Stage B0.2 must build, and it
  grants no Athlete capability and no entitlement.
- `Profile` exists **only** inside the Team Foundation layer (ADR-0022). Its `id` is
  already an independent application-owned UUID linked 1:1 to an auth account. It is not
  required to use the app, and no implemented RPC ever creates an `Athlete` row
  (ADR-0022 Decision 10).
- **`localStorage` is the sole production persistence authority**, unscoped by any
  identity, behind the seven application-owned repositories of ADR-0013. The IndexedDB
  adapter (ADR-0015) and the copy migration (ADR-0016) exist but are unwired; activation
  (ADR-0017/0018) is blocked and not recommended.
- **No cloud sporting data exists at all** — no cloud repository, no upload, no outbox,
  no restore, no RLS deployed. ADR-0019/0020 are Proposed; ADR-0021 is Accepted as a
  design only.

### Why the earlier model no longer holds

The prior product model treated accountless use as a durable capability and cloud backup
as a paid capability. Three things changed that:

1. **Every collaborative capability the platform is actually building requires
   identity.** A multi-athlete Exercise Session must attribute each attempt to a real
   athlete Profile, must derive the recorder from authentication rather than a picker, and
   must keep each athlete's private note invisible to the recorder. An anonymous local
   athlete cannot participate in any of that.
2. **Accountless operation forces an adoption problem that has no clean answer.**
   ADR-0019's Local Adoption protocol, and ADR-0020's transactional backend for it, exist
   almost entirely to reconcile pre-existing anonymous local data with a later account.
   That machinery is large, has genuine unresolved blockers, and its only real subject in
   this repository is disposable early-test data.
3. **Structured raw sporting data is the one thing an athlete cannot recreate.** A lost
   season of shots is unrecoverable; a lost trend chart is recomputable. Putting basic
   durability of the raw record behind payment inverts which loss actually matters, and
   makes every Free user's history hostage to a single browser's storage.

## Decision

**Select: mandatory identity + authenticated offline operation + Free structured cloud
persistence.**

1. **Mandatory identity.** A `UserAccount` and a completed personal `Profile` are
   required to reach the authenticated application. Free is a commercial tier, not an
   exemption from identity. Deliberately public marketing material stays public.
2. **Authenticated offline operation.** First authentication and first Profile onboarding
   on a device require connectivity. After that, and once trusted Profile-scoped local
   state exists on the device, the athlete starts, performs, finishes and reviews
   supported training offline. Rink connectivity must never block training. Nothing about
   the gate is bypassable offline by a first-time, signed-out, or deleted-account user.
3. **Free structured cloud persistence (the Free Cloud Core).** All supported structured
   raw sporting and training data needed to reconstruct the athlete's history and compute
   future analytics is persisted in the cloud for Free users, with no date cutoff, plus
   basic restore on a new device. The paid personal tier sells value *derived* from that
   data — longitudinal analytics, comparisons, trends, benchmarks, recommendations — never
   the durability of the raw record itself.
4. **Profile scope, not auth-account scope, for athlete-owned sporting authority.**
   `Profile.id` is a stable application-owned UUID, never equal to or replaced by the
   authentication-provider user id. `UserAccount` remains the **authentication link**;
   `Profile` remains the **sporting and ownership identity**. Ownership, local persistence
   scope, cloud authority and recorder/actor attribution all key off `Profile.id`.
5. **Athlete capability is established by completed personal onboarding**, together with
   the default Free entitlement.
6. **Identity, permissions and commercial entitlements stay three separate concepts**, as
   does persistence authority. A Team function is never an entitlement; an entitlement is
   never a permission; neither transfers ownership.
7. **Legacy unscoped local data is disposable and will be discarded once, explicitly**, in
   the Profile-scoped local persistence stage (B0.3) — never adopted, claimed, imported or
   merged.

### Explicitly rejected

- **Permanent accountless application access.** Rejected: it makes every collaborative
  capability unbuildable without a parallel anonymous-athlete model, and it is the sole
  reason the Local Adoption problem exists. The cost is real and accepted: a first run
  now requires connectivity, and there is no offline-first-launch path.
- **Mandatory always-online training.** Rejected: the primary usage context is a
  smartphone at a rink, frequently without usable signal. An identity requirement that
  reached into every training action would break the product's core use case. Identity is
  required to *establish* a device, not to *use* one.
- **Making fundamental structured-data safety a paid-only capability.** Rejected: raw
  sporting history is the irreplaceable asset, and its durability is not a premium
  feature. Derived analysis is what carries premium value. This decision accepts an
  ongoing storage and operational cost for every Free user in exchange for never losing a
  Free user's history and never needing an upgrade-triggered import.

## Consequences

### Local persistence

- Local persistence becomes **Profile-scoped**. The repository boundary of ADR-0013
  survives unchanged in shape, but its "no concept of an authenticated user" property does
  not: something above or inside the boundary must now resolve which Profile's data a
  repository reads and writes, and sign-out or account switching must immediately hide and
  lock the previous Profile's data, including pending uploads.
- **Until that scoping exists, mandatory identity is not safely releasable.** The gate
  (B0.2) and the isolation (B0.3) are one releasable privacy unit — see "Implementation
  staging" below.
- The **legacy copy/activation track is retired as the forward production migration
  path.** ADR-0016's mechanism and ADR-0017/0018's activation programme were designed to
  carry existing local data forward; that data is disposable, so there is nothing for them
  to carry. ADR-0015's adapter remains valid, unwired infrastructure.
- **Dormant code is not deleted by this ADR.** Retirement here is a planning and
  documentation act.

### Cloud authority

- The cloud becomes the **durable authority for the Free Cloud Core** once the server
  acknowledges a record; the device remains the immediate authority for active capture.
- Upload is automatic on reconnect, idempotent under stable client-generated IDs, and
  fails closed when server authority can no longer be revalidated.
- Conflicting content under one stable identity is never silently overwritten.
- The product must show at least three honest states — **saved on this device**,
  **synced**, **sync issue** — and must not call anything cloud-backed before
  acknowledgement.
- **Free restore on a new device is not cross-device continuation.** Continuing an
  in-progress Session elsewhere, concurrent multi-device editing, and transferring an
  unsynced Session all remain deferred.

### Onboarding

- A blocking, connectivity-requiring onboarding step **must be introduced** ahead of all
  training (it does not exist today — see "Current implementation reality"): display name,
  Terms acceptance, Privacy acknowledgement. Legal acceptance must be versionable and
  auditable. Marketing consent stays separate, optional and off by default.
- Onboarding asks for nothing sporting — no team, club, country, position, skill level or
  goals — and forces no permanent role choice.
- **No training data may be created before onboarding completes.**

### Entitlements

- **Completed personal onboarding is what establishes entitlement — not the mere existence
  of a Profile.** Completing onboarding must atomically establish all three of: **Athlete
  capability**, the **default Free entitlement**, and **eligibility to pass the global
  application gate**. A Profile that has been resolved or created but has *not* completed
  onboarding carries none of those consequences yet — it cannot pass the gate, holds no
  Athlete capability, and has no entitlement. (This is why the existing **Team-specific
  Profile bootstrap** is not the B0.2 gate: it creates a Profile with no legal acceptance,
  no Athlete capability and no entitlement, and that remains a current transitional fact.)
- Entitlement resolution is therefore on the critical path of **completing onboarding and
  opening authenticated application access**, rather than being a later commercial add-on
  bolted on after the gate.
- Upgrade must expose existing Free history to paid analytics with **no migration,
  re-import or re-recording**; downgrade must retain raw history and keep Free recording
  and Free cloud persistence alive; re-upgrade must restore paid analysis over the whole
  retained history. That rules out any design where paid analytics reads from a separate,
  paid-only store.
- Large or operationally expensive artifacts (video, high-frequency sensor streams, large
  coordinate traces, AI output) are **not** covered by the Free guarantee and may carry
  their own limits later.

### Deletion and privacy

- Deletion requires recent re-authentication, offers a complete export first, then runs a
  30-day recovery window during which access and sync are disabled and the user may
  cancel. After it, the auth account and personal cloud data are deleted, or narrowly
  anonymized where shared Team or audit relationships require retention.
- Profile-scoped local data on the current device is deleted or made inaccessible.
  **There is no usable local-only athlete after deletion**, and a new account is never
  silently linked to the deleted one's data.
- Shared Team-result anonymization and participant notification remain a later privacy
  design.

### Cost

- Every Free user now carries storage, transfer and operational cost. That is the accepted
  price of the decision. **Vendor prices are deliberately not recorded in this or any
  other architecture document** — they are volatile and would become stale claims. Cost
  *sensitivity* is a design input: it is why large/expensive artifact classes are excluded
  from the Free guarantee, and why derived aggregates are recomputable rather than
  canonical.

### Later Exercise execution

- Exercise execution (`docs/EXERCISE_LIBRARY_AND_EXECUTION_SPECIFICATION.md` Stage B and
  later) now sits behind the identity and persistence stages. Its already-approved model —
  every Team participant resolves to an authenticated Profile, the recorder is derived from
  authentication with no Recorder selector, private Athlete Notes stay private, pending
  data must not survive an account switch — is **confirmed rather than changed** by this
  ADR; what changes is that those assumptions now have a real foundation to rest on, and
  Exercise stages must not be started before it exists.
- Structured raw Exercise results, private Athlete Notes and basic execution results are
  Free, including their cloud persistence. Team Session coordination remains Team
  Workspace.

### Implementation staging

Staged as B0.1 (this documentation reconciliation) → B0.2 (identity and onboarding gate,
no sporting cloud persistence) → B0.3 (Profile-scoped local data, one-time retirement of
disposable test data) → B0.4 (Free cloud data backbone, requiring real database
verification) → Exercise Stage B. Each stage has its own review gate; see the
specification's Section 11.

**B0.2 and B0.3 are one releasable privacy unit** (specification §11.1). This is a direct
consequence of the decision above, not a scheduling preference: B0.2 makes identity
mandatory and introduces account switching, while sporting persistence stays
identity-unscoped until B0.3 — so a separately released B0.2 would let a **second
authenticated account in the same browser observe the first account's sporting data.**
Therefore:

- B0.2 may be implemented and independently reviewed first, as its own scope.
- **Its mandatory-gate and account-switching experience must not be enabled for real users
  or released as the new product behaviour until B0.3's Profile isolation and one-time
  disposal are implemented and independently reviewed.**
- **The release gate is the combined B0.2 + B0.3 unit**, and it must prove that no Profile
  can observe another Profile's local data or pending writes.
- **B0.2's own account-switch review proves authentication/onboarding state transitions
  only.** Sporting-data confidentiality across an account switch is not closed until B0.3.
- This is **not** licence to import, adopt or assign the unscoped data to whichever account
  signs in first (it is discarded, never adopted), and **not** a reason to move disposal
  into B0.2. **No deployment or feature-flag mechanism is chosen here** — that belongs to
  those stages.
- **B0.2 is never independently release-ready.**

## Effect on existing ADRs

Nothing below deletes historical reasoning. Each ADR keeps its analysis; what changes is
which parts remain forward-authoritative.

| ADR | Effect |
|---|---|
| **0013** — application-owned persistence repository boundary | **Remains Accepted and Implemented** for the repository boundary itself, hydration safety, provider-neutral domain types, and the storage abstraction. **Superseded:** its accountless-use guarantee, and its Decision 7 conclusion that identity must not scope local persistence. Local persistence becomes Profile-scoped in B0.3. |
| **0015** — unwired IndexedDB adapter | **Unchanged. Remains Accepted and Implemented as an unwired adapter.** Not invalidated by the retirement of the copy/activation programme. |
| **0016** — resumable `localStorage`→IndexedDB copy migration | **Remains a historical, implemented mechanism. Retired as the production migration path**, because the legacy unscoped data it would copy is disposable and will be discarded rather than adopted. Not invoked; not deleted. |
| **0017** — IndexedDB activation/verification/rollback protocol | **Remains a useful historical analysis.** Its proposed production activation programme is **no longer the selected path** for disposable legacy data. Its blocked status is unchanged, and this ADR does not resolve Decision 3. |
| **0018** — activation fencing and outage policy | Same treatment as 0017: **analysis retained, proposed production activation programme no longer the selected path.** Note that its "local-first, accountless" framing describes the product model this ADR supersedes; the technical conclusions about non-participating builds stand on their own. |
| **0019** — cloud identity and data-authority transition | **Superseded:** its optional-account product assumption and the paid-only-backup direction it served. Its Local Adoption protocol is not the forward path, because there is no legacy data to adopt. **Not implemented, and this ADR does not claim its transition protocol is.** Its non-participating-build analysis (Decision 8) remains a real, unresolved hazard for any future local-authority transition. |
| **0020** — Supabase schema, RLS and adoption transactions | **Superseded as the forward path; still Proposed and not implementation-ready.** The authority-scope *choice* is **closed: Profile-scoped** — it is no longer an open decision anywhere. What remains unperformed is this document's own reconciliation to that scope across every affected table, RPC, RLS rule, lock, completeness proof and test design. Its Decisions E.2b (representability) and E.2c (mapping execution/dispatch) stay unresolved **inside this historical Local Adoption design and are NOT gates on Stage B0.4** — B0.4 must design and verify its own schema, representability rules, canonical mapping, upload protocol and RLS against a real database, and solve its own versions of the underlying problems those decisions name. |
| **0021** — Assessment draft/history authority-unit split | **Split retained as an accepted design constraint**: `assessmentDraft` stays the device-local/in-progress unit, `assessmentHistory` the completed-history unit and the only cloud-eligible one — now via the Free Cloud Core rather than Local Adoption. **Retired as forward work:** its migration from the combined unscoped `assessment` key, the retained legacy residue, and its planned ADR-0016 marker registration. B0.3/B0.4 establish **fresh Profile-scoped draft/history persistence** for post-onboarding data instead, adopting nothing and reusing no retired marker. Its old-build/deployment-fencing hazard survives as a real caution. |
| **0022** — Team Foundation domain and persistence | **Retained and authoritative** for the separate `Profile` UUID and the 1:1 account link. Its Decision 10 statement — no Team Foundation RPC creates an `athletes` row — **remains true of the implemented service**. **Narrowly constrained:** completed *personal* onboarding will later be required to establish Athlete capability. Arbitrary Team `Profile` creation still grants nothing. |
| **0023** — restricted source asset delivery boundary | **Unaffected.** |

## Alternatives considered

- **Keep accountless use and add an optional account on top (the prior model).**
  Rejected — see "Explicitly rejected" above. It preserves the Local Adoption problem
  permanently for the sake of data that is disposable exactly once.
- **Require an account but keep cloud backup paid.** Rejected: it produces the worst
  combination — a mandatory gate with no durability benefit for the user who passed it,
  and an upgrade-triggered import path that mandatory identity was supposed to remove.
- **Require an account and require connectivity for training.** Rejected: breaks the
  mobile-first, at-the-rink usage context that the product exists to serve.
- **Free cloud persistence with a rolling retention window (e.g. the last N months).**
  Rejected: it silently destroys exactly the longitudinal history the paid tier is meant
  to analyse, and would make an upgrade retroactively worthless.
- **Adopt legacy local data into the first account, using ADR-0019/0020's protocol.**
  Rejected: the only data in scope is early-test data. Building and verifying an adoption
  protocol — with genuine unresolved blockers — to preserve disposable records is a
  disproportionate cost.

## Non-goals

This ADR does not design or authorise: the auth gate implementation, Google OAuth wiring,
Profile onboarding UI, a legal-acceptance schema, entitlement or billing tables, account
deletion implementation, legacy data clearing, account-scoped storage keys, IndexedDB
activation, cloud repositories, an outbox, sync, APIs, migrations, RLS, restore, Exercise
execution, or new analytics. It decides no vendor price, no paid-tier name, no video or
sensor quota, and no minor/guardian workflow. It claims no real database verification.
