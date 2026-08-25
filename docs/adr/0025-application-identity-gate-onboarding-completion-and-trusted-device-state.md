# ADR-0025: The application identity gate — barrier-resolution protocol, onboarding completion, and trusted device state

## Status

**Accepted architecture decision. Not implemented.**

This ADR records the durable design decisions for **Stage B0.2 — Identity and Onboarding Gate**. No
runtime code, schema, migration, test or configuration is added by this ADR; those are Stages B0.2a
through B0.2f. It exists so that the design is recorded *before* implementation begins, as
`docs/AI_DEVELOPMENT_WORKFLOW.md`'s "Large cross-layer features" requires.

**Product authority.** `docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md` is the
canonical product source, and `docs/adr/0024-mandatory-identity-and-free-structured-cloud-foundation.md`
is the architecture direction this ADR implements. This ADR must not silently redefine either. Where
they disagree, the specification governs the product rule and this ADR is the defect.

**Release constraint, stated once and binding on everything below.** **B0.2 and B0.3 are one
releasable privacy unit.** B0.2 may be implemented and independently reviewed first, but its
mandatory-gate and account-switching experience **must not be enabled for real users or released as
the new product behaviour until B0.3's Profile isolation and one-time disposal are implemented and
independently reviewed.** **B0.2 is never independently release-ready.**

## Context

### Current implementation reality

Facts about the code on this branch, stated separately from anything this ADR decides:

- The application is fully usable with **no account**. `AccountControl.tsx` is mounted inline above the
  per-view header in `TrackerApp.tsx` and never gates the app.
- `useSupabaseAuthController` is called from **four** production components (`AccountControl.tsx:50`,
  `TeamDeepLinkGate.tsx:58`, `TeamInvitationAcceptOverlay.tsx:72`, `TeamsScreen.tsx:441`), each with its
  own state machine and its own `onAuthStateChange` subscription.
- Sign-in is **email OTP only**, optional and additive, and yields only an `AccountIdentity`.
- A **Team-specific** `bootstrap_profile` path exists and is reached only from Teams. It grants no
  Athlete capability and no entitlement.
- `localStorage` is the **sole production persistence authority**, unscoped by identity, behind the
  seven repositories of ADR-0013.
- `StorageAdapter` (`src/lib/persistence/types.ts`) exposes only `get`/`set`, documents that **no
  multi-key atomicity is claimed or possible through this interface**, and states that `remove` is
  intentionally absent.
- **React Strict Mode is active in development** — `next.config.ts` does not disable it, the Playwright
  suite runs `next dev`, and the codebase already treats double-invoke as first-class.

### Provider behaviour this design must accommodate

Investigated against the installed `@supabase/auth-js@2.112.3`. These are the facts that make several
decisions below non-negotiable rather than stylistic:

- **`exchangeCodeForSession` persists the session and emits `SIGNED_IN` *before* it resolves**, and
  **`verifyOtp` does the same.** By the time application code can evaluate the result, a real session
  already exists and would survive a reload.
- **`signInWithOAuth` returns a non-secret `flowId`**, and `skipBrowserRedirect: true` suppresses the
  navigation — so the flow selector is obtainable *before* leaving the page.
- **`exchangeCodeForSession(code, { flowId })` uses only that flow's verifier**, while **without a flow
  id "the most recently stored verifier is used"** — and **a failed exchange removes the verifier it
  selected**. A stale callback exchanged against a newer attempt's selector would therefore destroy
  that newer attempt.
- `flowType` defaults to `implicit` and `detectSessionInUrl` defaults to `true`.
- Provider failures arrive as `error` / `error_description` / `error_code`, **any one of which alone
  marks a callback**; an implicit-flow response uses `provider_token`, `provider_refresh_token`,
  `access_token`, `refresh_token`, `expires_in`, `expires_at` and `token_type` in the fragment.
- **The SDK never emits or reads a `state` query parameter.**

### Why the earlier shape was insufficient

Four hazards drove this design, none of which a simpler gate would have closed:

1. A post-hoc verdict cannot undo a session the SDK has already persisted.
2. A shared-key "read the barrier, then delete it" finalization is unsafe under an interface that
   offers no compare-and-delete and claims no multi-key atomicity.
3. A callback cannot be correlated to the attempt that produced it without a callback-carried selector.
4. A capture-and-clean performed in a discarded React Strict Mode pass would leave the committed pass
   with a clean URL and lock a legitimate user out.

## Decision

### 1. One identity authority, one composition seam, one transaction owner

- A **thin `IdentityProvider`** owns React lifecycle, context and rendering only.
- **`identityRuntime`** is the single non-component composition facade; it constructs the coordinator
  and hides the repositories and the concrete Supabase service. `IdentityProvider` imports exactly that
  seam and nothing lower.
- **`IdentityTransitionCoordinator`** owns two categories, both coordinator-owned and both deny-ward:
  - **every deliberate identity transition** — one a person initiates: Google authentication,
    email-OTP request and verification, locked-screen recovery, **explicit sign-out**, and the bounded
    invitation-recovery transition;
  - **every server-driven invalidation transition** — one no person initiated, forced by a definitive
    negative result from the server (§14).

  It also owns OAuth-return admission and required trusted-state establishment, which are steps within
  those transitions rather than transitions a user starts.
- **`useSupabaseAuthController` is retired.** Its legitimate lifecycle work moves into
  `IdentityProvider`. Two orchestration owners are not retained.
- Screens and components call only the coordinator's public API. No component imports the coordinator
  implementation, `AuthService`, the concrete Supabase auth service, or any identity repository.

### 2. Session restoration is classified into five outcomes, never two

`restoreSession()` resolves exactly one of `authenticated`, `no_session`, `temporarily_unavailable`,
`invalid_session`, `restore_failed`. Classification happens **only** inside the Supabase integration
boundary, using the SDK's own typed predicates (`isAuthRetryableFetchError`, `isAuthApiError`,
`isAuthSessionMissingError`) — never by inspecting raw message text, and never by treating "an error is
present" as equivalent to "temporarily unavailable". A transient offline condition and a definitive
revocation both surface as a null session with an error; conflating them would either lock a legitimate
offline device or admit a revoked one.

### 3. No raw provider auth event can open the application

`onAuthChange` delivers a **closed set of normalized reasons**. **No reason — `signed_in` included —
can resolve a barrier or produce a ready state.** This is what makes the SDK's
"persist-then-emit-then-resolve" ordering harmless. Access is granted only by the coordinator, from a
correlated explicit operation result.

### 4. Startup has three phases, in this order

- **Phase 0 — OAuth return intake.** Capture the callback once, classify its shape, clean the URL, and
  only then inspect durable state to decide whether this is an admissible persisted continuation.
- **Phase A — durable preflight.** For a **completed** correlation set only, validate structure and
  correlation. **No identity has been restored yet, so no account scope is checked here**; Phase A can
  only produce a *structurally correlated resolution*.
- **Phase B — identity binding.** Only here does a restored identity exist, and only here does a
  structurally correlated resolution become an *identity-bound resolved barrier*.

**A legitimate full-page Google return is the intentional durable continuation mechanism**, not a lost
one. Phase 0 exists because a genuine callback necessarily arrives with a valid unresolved barrier, a
matching attempt, and **no resolution yet** — a protocol that locked that state would deadlock the very
flow that creates the resolution. A reload *without* a callback candidate is a different case and does
render locked recovery.

**Phase 0's admission rules are exhaustive.** Every callback-shaped arrival resolves to exactly one of
these, and **every one of them cleans the owned callback material from the URL**:

| Situation | Decision |
|---|---|
| No callback candidate | Continue to ordinary Phase A. An unresolved barrier with no admissible continuation stays locked |
| Success candidate, valid unresolved barrier, exact matching attempt | **Admit it.** A missing resolution is expected here and must not lock the user. Validate the selector and the barrier binding, exchange **once**, persist the resolution, revalidate, then bind the identity |
| Provider-error candidate matching the current barrier and attempt | **No exchange.** The barrier stays unresolved and the app stays locked, offering a fresh attempt |
| Candidate that does not match the current barrier or attempt | **No exchange, no resolution.** Any newer valid attempt is left intact |
| Current barrier already has an exact resolution | Treat as a replay: **no exchange**, and **the existing valid resolved set is not invalidated** |
| Ambiguous, malformed, or an implicit-flow fragment | **No exchange, no identity.** Locked if the barrier is unresolved; otherwise it must **not** become an authentication source |
| Candidate with no barrier or no matching attempt | **Never a substitute for ordinary session restoration.** No exchange; continue or lock purely on independently existing state |

### 5. The `IdentityAccessBarrier` is a universal, durable, deny-by-default latch

Both categories are coordinator-owned and deny-ward, but **their ordering rules are different, because
one is started by a person and the other is forced on the application by the server.** A server-driven
invalidation is never described as a deliberate user transition.

**Deliberate user-initiated transitions** — Google, OTP, locked-screen recovery, explicit sign-out,
invitation recovery:

1. **first durably write a fresh unresolved barrier with a new `barrierId`**;
2. if that write fails, **nothing begins** — no provider call, no navigation, and no preceding
   persistent local mutation.

This ordering is available because the user is waiting and nothing has happened yet; refusing to start
costs only a retry.

**Server-driven invalidation** (§14) cannot use that ordering, because by the time the negative result
arrives the application is already running and may already be showing content:

1. **immediately deny access in memory** — this, not the barrier, is the first step;
2. **then attempt the unresolved invalidation barrier** as the first *durable* denial mechanism;
3. if that barrier write fails, **trusted-record removal is still attempted as the fallback durable
   denial** — the transition does **not** stop;
4. if **both** durable mechanisms fail, access remains denied **for the page lifetime**, and **no
   durable offline revocation is claimed**.

The barrier is what makes the provider's persist-before-resolve ordering safe for the deliberate
category: by the time a session exists, a durable denial already exists too. **No interactive attempt
may carry a null `barrierId`.**

### 6. A barrier is resolved, never deleted

A successful correlated operation **never touches the barrier key**. It writes an
`IdentityBarrierResolution` under a key **derived from that exact `barrierId`**. Consequently, writing
resolution **B** cannot alter, overwrite or resolve a newer barrier **C** — they are different keys by
construction, which is the property the storage interface itself cannot provide.

A barrier is superseded only by writing a **newer** barrier, which is always the deny-ward direction.
**The security transition is "resolve the exact barrier", never "clear" or "delete" it.**

A resolution **grants nothing on its own**. It establishes only that this exact barrier was completed;
Profile, onboarding, entitlement, trusted-state and every server-negative result still deny access.

### 7. The durable correlation set is barrier + attempt + resolution

All three survive reload. The current attempt is **not removed** while the set is active — removing it
would make the resolution unverifiable and lock the user out permanently. A new `barrierId` makes the
previous attempt and resolution irrelevant, and only then may they be cleaned as **non-current**.
**Cleanup is best-effort and can never affect authorization**; that phrase applies to non-current
records only, never to required intent deletion, trusted-state invalidation, or trusted-state
establishment.

**The set has five lifecycle stages**, and only the last is what Phase A validates:

1. **Before navigation** — barrier and attempt exist; the resolution is *intentionally* absent.
2. **Callback arrival, before exchange** — still no resolution; this is Phase 0's admissible state, and
   Phase A's completed-set rule deliberately does not apply to it.
3. **Exchange in flight** — the provider has already persisted a session and emitted its event; the
   unresolved barrier is what keeps the application closed.
4. **Resolution written, not yet revalidated** — all three records exist but **no ready-producing
   outcome may be emitted yet**.
5. **Completed set** — validated after the post-write checkpoint; this is the only stage Phase A treats
   as a completed correlation set on later loads.

After a provider error, a malformed or stale return, a failed exchange or an interruption, **the
resolution stays absent and the barrier stays unresolved**.

### 8. Revalidation happens at named checkpoints, and cross-tab atomicity is not overclaimed

Revalidation is specified as an explicit, finite list of checkpoints — after Google preparation; before
navigation; before exchange; before resolution persistence; before and after OTP verification;
**after resolution persistence and before emitting a ready-producing outcome**; and around provider
sign-out. "After every asynchronous boundary" is rejected as a rule because a storage read is itself
asynchronous.

The post-write checkpoint is what prevents a stale success: if a newer barrier or attempt became
current while the write was in flight, no ready-producing outcome is emitted.

**Honest limitation.** Browser storage and cross-tab `storage`-event delivery provide **no
instantaneous atomic revocation between tabs**. The guarantee is narrower and exact: a stale operation
cannot persistently resolve or supersede a newer barrier, and each tab denies access once it observes
the newer barrier.

### 9. `identityGeneration` has a live role and a durable role, and they are never conflated

- **Live:** an in-memory stale-work guard for one page lifetime, re-checked at each checkpoint. It is
  recreated on reload and is **never durable authority**.
- **Durable:** the attempt's captured value and the resolution's copied value are compared **against
  each other**.
- Google therefore has **two live epochs** — a start-page epoch ending at navigation, and a fresh
  callback-page epoch beginning at Phase 0 admission. **The callback page never compares its newly
  created value with the start page's.**
- **The authoritative cross-reload identity binding is the account scope**, not any generation. No
  durable monotonic counter is invented.

### 10. Google correlation requires a callback-carried selector, with no fallback

The client is constructed with `flowType: "pkce"`, `detectSessionInUrl: false` and
`experimental.appendPkceFlowIdToRedirects: true`. The start sequence is **barrier → prepare → validate
→ persist the complete attempt → validate → navigate**, because the `flowId` does not exist until
preparation returns.

On return, the callback's selector must **exactly match** the persisted attempt **before** any
exchange, and the exchange always passes an explicit `flowId`. **The no-selector form is prohibited
everywhere**, because it would use the most recently stored verifier, and because a failed exchange
removes the verifier it selected — so a stale callback could destroy a newer valid attempt.

**If the SDK stops returning a flow id, the flag becomes unavailable, or the redirect allowlist cannot
round-trip the selector, Google sign-in fails closed and Stage B0.2 is not complete.** Google is a
required closed-test provider; a future alternative carrier is a separate, independently reviewed
architecture change.

### 11. Callback capture is page-scoped, single-use, and React-lifecycle-safe

Capture and URL cleanup are performed from a **guarded lifecycle boundary, never during render**. The
captured candidate lives in a **page-scoped cell** owned by the runtime: the first initialization reads
and cleans the URL; **every later call — including React Strict Mode's replayed setup — reads the same
cell instead of the now-clean URL**. Disposal of an abandoned effect prevents stale state dispatch but
**does not destroy the cell**, so the committed lifecycle can still claim it. The candidate is claimable
**exactly once**; a second exchange attempt performs no provider call. A real new page load gets a new
scope.

### 12. Callback classification is exhaustive and mutually exclusive, and is separate from correlation

The provider-mechanics layer classifies shape only — no return, success candidate, provider-error
candidate, ambiguous, malformed — and **knows nothing of barriers or attempts**. A provider-error
callback carries **no `code`**, so any rule requiring one would make that branch unreachable.
Duplicates of any owned field are ambiguous. Malformed and unowned are distinct outcomes, not collapsed
into "ambiguous".

**All durable correlation belongs to the coordinator**: loading the barrier and attempt, comparing the
selector, and deciding whether an exchange may happen at all.

### 13. Account-scope divergence has three distinct cases

Treating every divergence as revocation would invalidate a user who has just deliberately signed in as
someone else.

- **Case A — expected, explicitly correlated replacement.** An exact completed correlation set proves
  the transition and the restored identity matches the resolution's scope, but the trusted record
  belongs to another account. The old record is **never honoured**; the new account is resolved as a
  fresh identity; the trusted record is **replaced**; no ready state is entered until that replacement
  is durably written. **This is not an invalidation and writes no invalidation barrier.**
- **Case B — unexpected or uncorrelated mismatch.** No correlation set authorizes the transition, or
  the restored identity differs from the resolution's scope. Deny in memory and run the invalidation
  transition; **the unexpected session is never accepted as a fresh identity**.
- **Case C — no session while a valid trusted record exists.** A definitive signed-out condition
  requiring **durable** denial, with explicit failure semantics rather than an unqualified removal.

### 14. Definitive online denial is made durable before trusted state is cleaned

Attempting to remove a trusted record is not a durable deny mechanism when removal fails. So: deny in
memory, **write an unresolved invalidation barrier**, and only then remove or replace the trusted
record. The barrier prevents the stale record from being honoured **even if removal fails**.

If the barrier write fails, denial persists for the page lifetime and trusted-record removal is
attempted as the fallback. **If both durable mechanisms fail, the application denies access and says so
honestly — it does not claim durable offline revocation**, and it never continues in a ready state.

This records a negative fact **only after it has actually been learned online**. It invents no offline
expiry period.

### 15. Required trusted-state writes have explicit outcomes; a same-scope refresh failure is not fatal

Server authentication, Profile resolution, onboarding and entitlement may all have succeeded, and the
application **still does not become ready** until the trusted record for the active account scope is
durably written. A failure is a named outcome, retry revalidates the server-authoritative facts before
rewriting, and **no undocumented "online only" mode exists**.

Distinctly: if a **valid same-scope** record already exists and only a metadata refresh fails, the
existing record is retained, the outcome is explicitly non-fatal, **no updated timestamp is
fabricated**, and no account scope, Profile identity, onboarding or entitlement fact changes.

### 16. Identity, capability, entitlement and onboarding remain four separate facts

- `ensure_my_profile()` is the **only** operation that creates or resolves the bare Profile. It creates
  a Profile and its account link and **nothing else** — no Athlete row, no entitlement, no legal
  evidence, no completion, no access.
- `complete_personal_onboarding()` is **completion-first and write-once**: it checks for an existing
  completion *before* validating any legal document or touching any Profile fact, and returns the
  existing state with **no writes** if one exists. Otherwise it establishes, in one transaction,
  validated display name, both legal evidence rows, Athlete capability, the default Free entitlement,
  and the completion fact. A failure leaves **none** of those consequences.
- The Profile must already exist; there is **no second creation path** inside completion.
- Gate eligibility is **derived** from those facts. No freely mutable "gate eligible" boolean is
  persisted, and no browser role may write any of them directly.

### 17. Legal evidence is versioned, pinned, and validated as a whole response

- Legal documents are **immutable versioned metadata**; a correction is a new version row, and
  retirement is a **one-way** transition. Rotation is atomic.
- The **current** documents are resolved server-side; a client never asserts what is current.
- The metadata a user is shown and the ids their acceptance submits come from **one snapshot**, so an
  acceptance can never be pinned to a version that was never displayed. A rotation between display and
  submission is refused, and the new version must be displayed and accepted afresh.
- Onboarding **pins the exact evidence rows** that justified it, proven to belong to the same Profile,
  the correct document kind and the correct action.
- **A later document change never automatically revokes a completed Profile or forces re-acceptance.**
  That policy is explicitly undecided and is not settled here.
- **No legal text, URL, version identifier, controller detail, retention claim, subprocessor or
  transfer claim is authored in this repository.**

**Genuine absence and an invalid response are two different things, and are never conflated.** Exactly
one of these applies to any read of the current legal documents:

| Condition | Classification | Result |
|---|---|---|
| Zero rows for a known kind, every returned row valid | **Genuine absence** — that kind is `null` | No current Privacy Notice ⇒ sign-in is not offered. No current Terms ⇒ onboarding completion is refused. This is a normal, expected state |
| An **unknown kind** | **Invalid response** | `invalid_legal_response` |
| **Duplicate rows for one known kind** | **Invalid response** | `invalid_legal_response` |
| A **malformed known-kind row** or any **invalid field** | **Invalid response** | `invalid_legal_response` |
| An **unsafe document URL** | **Invalid response** | `invalid_legal_response` |

**An unsafe URL invalidates the whole response; it does not make that one document "absent".** Treating
it as absence would silently downgrade a corrupt or tampered response into an ordinary, expected state
and would let the other document in the same response be used as if the response were trustworthy.

For any invalid response: **no raw row, no partial `LegalSnapshot`, no `LegalDocumentId` and no
`SafeLegalDocument` escapes into domain or UI state**; the normalized failure carries no raw value; the
gate maps it to **`legal_unavailable`**; and **no unsafe link is ever rendered**.

**The safe-URL boundary is exact.** A document URL is accepted only if it is an **absolute HTTPS URL**
with **no base-relative or protocol-relative form**, **no embedded credentials**, a **non-empty
hostname**, **no whitespace or control characters — including percent-encoded control characters** —
and a raw value **identical to its own trimmed form**. It is enforced at both the database and the
mapping boundary; the mapping boundary is the load-bearing check, because a database constraint is not
a URL parser.

### 18. B0.2 collects no Marketing Consent

None is requested, stored, inferred or recorded — including as an explicit negative. **Absence never
means consent.** If marketing communication is introduced later it requires a separate, explicit,
optional, default-off design that is **never bundled with Terms acceptance or Privacy
acknowledgement**.

### 19. Deletion becomes an explicit, narrowly scoped storage capability

The minimal storage contract is retained for the repositories that only read and write. A **removable**
capability is added and depended on **only** by identity repositories that genuinely delete. The
barrier repository is deliberately **not** among them, because **no code path may remove the current
barrier key as a security transition**.

**This capability is not the barrier-safety mechanism.** A plain removal primitive still provides no
atomic compare-and-delete; barrier safety rests entirely on per-barrier resolution.

`docs/PERSISTENCE_BOUNDARY_DESIGN.md` §9's "no `remove` operation is needed" statement is superseded by
this decision and is updated in the same stage.

### 20. Credentials cross exactly one boundary, and persistence claims are exact

- The bearer token is read **only** inside one infrastructure helper and passed **only** to a validated
  same-origin request. It is never returned to UI, context, domain code, service consumers, logs,
  errors, snapshots or reports.
- Requests to the application's own Team API are constrained to a **closed route set**, validated
  same-origin and prefix-confined **before** any session read; a rejected route performs no session
  read and no fetch, and no HTTP response is ever fabricated to encode an authorization failure.
- **Persistence is described exactly, not aspirationally:** the authorization code and raw provider
  error values are callback-local and never persisted; the non-secret flow selector **is** deliberately
  persisted in the application's own attempt record; **PKCE verifiers and the session's access and
  refresh tokens are persisted by the Supabase SDK in its own storage** and are never copied into
  application records, state, UI, logs, analytics, errors, snapshots or reports. Claims such as
  "nothing is persisted" or "no token is in browser storage" are false and must not appear.

### 21. Local records are trust hints, not a security boundary

**Browser storage is not a security boundary.** A person able to alter it can forge a trusted-device
record, a barrier, an attempt or a resolution. In B0.2 a forged record can cause the application shell
to mount and can therefore expose whatever sporting data exists in the current identity-unscoped local
workspace. **None of them grants server-side authority** — every cloud operation still derives
authority from the real provider session, `auth.uid()`, table grants and RLS.

**This is an additional, independent reason B0.2 cannot be released before B0.3.** B0.3 closes normal
application-level cross-Profile and account-switch isolation; **it does not turn browser storage into
protection against an attacker with arbitrary access to the device or its storage** — and neither does
the SDK's own token storage.

### 22. Pending deep-link intent has one lifetime and one bounded exception

Intent is captured and validated **above the gate** before any redirect, and is retained across
authentication, onboarding, reload and transient failures. It is deleted on terminal handling, explicit
dismissal, a definitive denial, an ordinary sign-out, or an ordinary account switch. It is never read,
deleted and then acted on.

The single exception is an explicit, user-initiated recovery from a server-authoritative wrong-account
invitation result: exactly that one validated invitation survives one sign-out. **The transition writes
its barrier first and only then marks survival**, every step has a fail-closed outcome, and **an
unpersisted invitation is never claimed to replay automatically**. Admin-request links are not
email-bound and get no such recovery.

### 23. The Team bootstrap path is retired in two steps

The Team-specific profile bootstrap remains reachable while the legacy Team UI still depends on it, and
is retired — in SQL and in the service boundary — **in the same stage that removes those UI call sites
and rewrites the Team database suite onto the canonical path**. Existing migrations stay immutable; the
function is kept but becomes unreachable by browser roles. **No dormant code is deleted.**

### 24. Every local identity record is new, at its first schema version

Stage B0.2 has never shipped, so no identity record format has ever been deployed. Each record is
introduced at `schemaVersion: 1` under its final name and key. **No migration, alias or compatibility
shim from a prior format is designed, described or claimed.**

## Operational contracts

The decisions above are the *why*. This section records the exact operational contracts they imply, so
that this repository is self-sufficient and no external plan document is needed to recover them.

### A. Optimistic startup and background revalidation

| Rule | Contract |
|---|---|
| When optimistic entry is permitted | **Only** from a valid trusted record whose account scope satisfies the Phase B rules (§13), **and** while no unresolved barrier denies access |
| First run / no valid trusted record | **Cannot enter optimistically.** There is nothing to be optimistic about, and no offline path exists into a device that has never been trusted |
| With connectivity | Revalidation runs **in the background**; it never blocks entry for an already-trusted device |
| Definitive negative result | **Denies in memory immediately**, then enters the server-driven invalidation transition (§14) |
| Transient failure | **Remains distinct from a definitive negative and never revokes trusted state.** Conflating the two would lock out a legitimate device on a bad network |

### B. Explicit sign-out — ordering and failure semantics

Ordered steps, all coordinator-owned:

1. establish a **fresh unresolved barrier**;
2. delete **every ordinary pending intent**;
3. remove/invalidate **trusted state**;
4. supersede the current interactive attempt;
5. **revalidate the barrier** immediately before provider sign-out;
6. call **provider sign-out only after all required local mutations succeeded**;
7. revalidate after the provider operation.

| Failure | Contract |
|---|---|
| Barrier write fails | **No intent mutation and no provider call.** Prior state is left intact |
| Intent deletion or trusted-state mutation fails | App **remains locked** behind the already-written barrier; **zero provider sign-out calls**; fixed neutral retry copy with no raw storage error text |
| Provider sign-out fails | **Does not weaken the durable local denial.** The barrier, not the provider call, is the latch |
| Retry | Creates a **fresh barrier** and re-runs the transition |

**"Best effort" applies only to cleanup of already non-current correlation records.** It never describes
ordinary-intent deletion, trusted-state invalidation, or trusted-state establishment.

### C. Invitation wrong-account recovery — bounded ordering and failures

Ordered steps, triggered only by the explicit user action following a server-authoritative
wrong-account result:

1. receive the explicit **"Sign in with the invited account"** action;
2. establish a **new unresolved account-recovery barrier**;
3. persist **survival for exactly the current invitation**;
4. remove **every other** ordinary pending intent;
5. remove/invalidate **trusted state**;
6. **revalidate the barrier**;
7. call **provider sign-out**;
8. **remain locked**, proceeding through normal authentication and onboarding before the server-side
   invitation preview is run again.

**Every local failure before step 7 produces zero provider sign-out calls.** The barrier is written
before survival is marked, so partial progress is always safe. **Uncertain or absent survival state is
never inferred**: if the invitation could not be persisted, the application does not claim it will be
replayed automatically. **Admin-request intents receive no equivalent recovery**, because that link is
not email-bound and has no wrong-account outcome to recover from.

### D. Callback ownership, cleanup and classification

**The owned query fields are exactly five:** `code`, `sb_flow_id`, `error`, `error_description`,
`error_code`.

- **`state` is not owned and is never deleted.** The provider SDK neither emits nor reads it, so
  removing it would destroy an unrelated application parameter.
- **All occurrences of every owned field are removed before any asynchronous work.**
- **Unrelated query parameters are preserved**, explicitly including `inviteToken` and
  `adminRequestId`.
- **The owned implicit-fragment set is exactly ten fields:** `provider_token`,
  `provider_refresh_token`, `access_token`, `refresh_token`, `expires_in`, `expires_at`, `token_type`,
  `error`, `error_description`, `error_code`.
- **An owned implicit fragment causes the whole fragment to be cleared before any asynchronous work and
  can never create an identity** — the PKCE flow must not consume an implicit-grant response.
- **Unrelated anchor fragments are preserved.**
- **Cleanup occurs on every Phase 0 branch**, not only the successful one.

**The shape classifier is mutually exclusive**, and is **provider-mechanics-only** — it knows nothing of
barriers or attempts:

| Shape | Meaning |
|---|---|
| **No return** | No owned query field and no owned fragment |
| **Success candidate** | Exactly one valid `code` and exactly one valid `sb_flow_id`, with no error field |
| **Provider-error candidate** | No `code`, exactly one valid `sb_flow_id`, and at least one error field. **Carries only the selector — never raw provider error text** |
| **Ambiguous callback** | A `code` together with any error field, **or duplicates of any owned field** |
| **Malformed callback** | Owned material present but matching none of the above, including an owned implicit fragment |

**All correlation is coordinator-owned**: loading the durable barrier and attempt, comparing the
selector, and deciding whether an exchange may occur at all.

### E. Google allowlist verification boundary

The redirect allowlist must tolerate the appended `sb_flow_id`, because the provider validates redirect
URLs including their query string.

- **Verifiable locally without Google credentials:** the email-OTP path routes its redirect through the
  **same** redirect-validation code path, so a local Supabase instance can prove that a redirect
  carrying `sb_flow_id` is accepted.
- **A real external Google redirect remains a documented manual / provider-environment check.** Google
  credentials are intentionally external and unavailable to the local suite.
- **No automated external-Google end-to-end test is claimed**, and none may be described as one.

### F. Removable-storage repository inventory

| Repository | Adapter | Removal semantics |
|---|---|---|
| `identityBarrierRepository` | **base `StorageAdapter` only** | **None.** No code path may remove a current barrier as a security transition |
| `identityBarrierResolutionRepository` | `RemovableStorageAdapter` | **Non-current cleanup only, best-effort** |
| `interactiveAttemptRepository` | `RemovableStorageAdapter` | **Non-current cleanup only, best-effort** |
| `trustedDeviceRepository` | `RemovableStorageAdapter` | **Required** establishment, replacement and removal — not best-effort |
| `pendingIntentRepository` | `RemovableStorageAdapter` | **Required** deletion — not best-effort |
| The seven sporting repositories | **base `StorageAdapter`, unchanged** | None; they never delete |

**Removal is not the barrier-safety mechanism.** A plain removal primitive offers no compare-and-delete,
which is exactly why a barrier is completed by a resolution written under a key derived from that
barrier's own identifier (§6).

### G. Exact persistence and token ownership

| Value | Where it lives | Contract |
|---|---|---|
| Authorization code; raw provider error values | **Callback capture cell only** | **Never persisted.** Removed from the URL before any asynchronous work; never rendered, logged or placed in application state |
| **`flowId`** | **Intentionally persisted** in the attempt and the resolution | A **non-secret selector**. The callback's copy is compared and discarded; never logged or rendered |
| **PKCE verifier** | **Supabase SDK-owned auth storage only** | Never copied into application repositories, state, UI, logs, analytics, errors, snapshots or reports |
| **Access and refresh tokens** | **SDK-managed session only** — this is how sessions survive reload | Never copied into application-owned records, sporting repositories, context, domain objects, UI, logs, analytics, errors, snapshots or reports |
| Access token in transit | Read **only inside** the approved infrastructure helper | Crosses **only** into the validated same-origin `Authorization` header |
| Barrier / attempt / resolution / trusted records | **Application-owned storage** | Contain **no** session, token, authorization code or verifier material |

Claims such as "nothing is persisted", "no token is in browser storage" or "`flowId` is never stored"
are **false** and must not appear anywhere in this repository.

## Consequences

- **The gate wraps the application shell**, so no sporting repository hydrates and no training data can
  be created before onboarding completes.
- **A first run requires connectivity.** After onboarding, a device holding valid trusted state trains
  offline; a first-run, signed-out or invalidated device cannot bypass the gate by going offline.
- **Sign-out is a durable local transition, not a provider call.** The provider call is attempted last
  and may fail without weakening the denial.
- **Some failures deny access without a clean recovery story on that page load** — specifically, a
  simultaneous failure of both durable denial mechanisms. That is reported honestly rather than papered
  over.
- **`detectSessionInUrl: false` moves callback detection and URL cleanup into application code.** This
  is a deliberate cost accepted in exchange for making callback consumption an explicit, correlated
  operation rather than something indistinguishable from an ordinary session restore.
- **`experimental.appendPkceFlowIdToRedirects` becomes a hard dependency** for Google sign-in.
- **Stage B0.2 proves authentication and onboarding *state transitions* only.** It does not, and
  cannot, close sporting-data confidentiality across an account switch; that stays open until B0.3, and
  every completion report must say so rather than implying isolation is proven.

## Alternatives considered

- **Delete the barrier on success.** Rejected: the storage interface offers no compare-and-delete and
  claims no multi-key atomicity, so a concurrent tab's newer barrier could be removed by an older
  operation's finalization.
- **Correlate the callback using only the stored attempt.** Rejected: a stale callback cannot be
  distinguished from the current one before exchange, and the failed exchange would remove the newer
  attempt's verifier — destroying a valid attempt.
- **Rely on the provider's `SIGNED_IN` event to open the application.** Rejected: the SDK persists the
  session and emits the event before the calling code can evaluate correlation, so the event carries no
  proof that *this* application transition succeeded.
- **Treat any account-scope divergence as revocation.** Rejected: it would invalidate a user who had
  just deliberately and verifiably authenticated as a different account.
- **Treat a missing resolution at startup as always disqualifying.** Rejected: that is exactly the
  state a legitimate Google return arrives in, and the rule would deadlock it.
- **Capture the callback during render, or recapture it on React effect replay.** Rejected: the first
  behaviour mutates history as a render side effect; the second finds a cleaned URL and locks a
  legitimate user out.
- **Add a "clear local sign-in state" affordance for stuck users.** Rejected: it would be an
  unauthenticated bypass of the gate. Recovery is always a fresh authenticated transition.

## Non-goals

This ADR does not design or authorise: Profile-scoped sporting persistence or the disposal of legacy
unscoped data (Stage B0.3); any cloud sporting schema, upload, outbox, restore, sync or conflict
handling (Stage B0.4); payment collection or any paid tier; account deletion, export, minor or guardian
workflows; unclaimed Profiles; cross-device session continuation; final legal copy; a trusted-state
expiry period; the paid personal tier's commercial name; re-acceptance rules for future legal versions;
post-onboarding display-name editing; any future marketing-communication feature; or Exercise
execution. It records no vendor price and claims no verification that has not been performed.
