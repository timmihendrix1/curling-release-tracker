# Mobile App Migration — Shared iOS/Android Architecture

**Status:**

- **Stage M1 — implemented.** Device acceptance is **partly user-reported**: the developer
  reports the prescribed *visible* launch and layout checks working on a physical iPhone.
  `crypto.randomUUID` and external links have **not** been reported and are not verified.
- **Stage M2a — implemented and verified locally by automated tests** (configured native API
  origin, server CORS, and the email-OTP groundwork; see
  [ADR-0047](adr/0047-configured-native-api-origin-boundary.md)). The server CORS change is
  **not deployed**, and **no on-device OTP or API acceptance has been performed**.
- **Full Stage M2 is not complete**, and is not M2-partial: native Google sign-in and its
  §6.6 scheduling gate are untouched, and M2-partial would require real device evidence.
- **Stages M3–M6** remain architecture, boundaries and staging only.

M1 changed **no file under `src/`**. M2a changed `src/` only at the authorized-request and
Route Handler boundaries; the Next.js Web build is unaffected by both.

**Last Updated:** 2026-09-29

This is the **single canonical migration document**. There is no separate iOS-only
migration specification, and none may be created: iOS is the first delivery platform, not
the architectural boundary.

Read alongside:

- [`docs/SYSTEM_ARCHITECTURE.md`](SYSTEM_ARCHITECTURE.md) — current implementation
- [`docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md`](MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md) — identity product rules
- [`docs/PERSISTENCE_BOUNDARY_DESIGN.md`](PERSISTENCE_BOUNDARY_DESIGN.md) — storage contract
- [`docs/CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md`](CLOUD_IDENTITY_AND_COLLABORATION_ARCHITECTURE.md) — cloud authority
- ADR [0013](adr/0013-application-owned-persistence-repository-boundary.md), [0024](adr/0024-mandatory-identity-and-free-structured-cloud-foundation.md), [0025](adr/0025-application-identity-gate-onboarding-completion-and-trusted-device-state.md), [0026](adr/0026-profile-scoped-local-sporting-persistence.md), [0027](adr/0027-free-cloud-terminal-sporting-record-backbone.md)
- [`docs/BROWER_IOS_FEASIBILITY.md`](BROWER_IOS_FEASIBILITY.md) and [`docs/BROWER_INTEGRATION_STATUS.md`](BROWER_INTEGRATION_STATUS.md) — the BLE probe and protocol status

---

# 1. Confirmed objectives

These are **product decisions already taken by the user**. They are not proposals.

1. The **actual training application** runs on iOS — not a demo, not a wrapper around a
   subset.
2. The architecture must support a **later Android release with minimal additional
   implementation**. Android compatibility is an architectural requirement **from the
   beginning**, not a later port.
3. **iOS is the first delivery platform**, not the architectural boundary.
4. The **first usable milestone** is the existing application on a physical iPhone, with
   identity, training workflows, persistence and offline continuity.
5. **Brower production capture is a subsequent, independently verified stage.** It is not
   part of the first milestone.
6. **Requiring a manual press of the TCi "New" button between measurements is
   unacceptable.** This constrains the eventual Brower design; it does not authorise
   sending the New Athlete command (`0x0A`), which remains unapproved.
7. The existing **Web application is preserved during migration**. This is a
   **non-regression constraint** for the migration work. It is *not* a decision that the
   Web application is supported commercially forever — see §4.

Everything else in this document is either **verified current implementation** (§2), a
**technical recommendation** (§3, §5–§8), or an **open product decision** (§4).

---

# 2. Verified current implementation

Every claim here was checked against the working tree on 2026-09-28. Line references are
to files, not to a report.

## 2.1 The shared client has no framework coupling

**This is the single most important finding for the migration.**

`src/components/` and `src/lib/` contain **zero imports of `next` or `next/*`**. Every
`next` import in the repository lives in `src/app/`:

| File | Import |
| --- | --- |
| `src/app/layout.tsx` | `next` (types), `next/font/google` |
| `src/app/legal/privacy/2026-08-28/page.tsx`, `src/app/legal/terms/2026-08-29/page.tsx` | `next` (types) |
| the six API route files and `src/app/api/team/_lib/context.ts` | `next/server` |

`src/app/page.tsx` itself imports nothing from Next. It is a nine-line shell:

```tsx
<main className="min-h-screen bg-slate-100 px-4 py-4 sm:px-6 sm:py-8">
  <div className="mx-auto w-full max-w-md sm:max-w-xl">
    <IdentityProvider>
      <AuthenticatedSportingPersistence>
        <TrackerApp />
```

`process.env` usage in shared client code is limited to three build-time-inlined literals:
`NODE_ENV` (`TrackerApp.tsx`, `browerBleDiagnosticController.ts`,
`ProfileScopedSportingPersistence.tsx`), `NEXT_PUBLIC_SUPABASE_URL` and
`NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (`src/lib/supabase/config.ts`, read as literal
expressions so Next can inline them). Everything else — `APP_ORIGIN`, SMTP credentials,
`CLOSED_BETA_EXERCISE_ASSET_TEAM_ID` — is read only in server-side files.

> **Current state (Stage M2a).** That count was accurate when this audit was taken. M2a
> added a **fourth**, `NEXT_PUBLIC_NATIVE_API_ORIGIN`
> (`src/lib/platform/nativeApiOrigin.ts`), so shared client code now reads three public
> configuration values plus `NODE_ENV`. `mobile/publicEnv.ts` is the current authority.
> The server-only names above are unchanged and must never become public.

`src/app/globals.css` is Tailwind v4 (`@import "tailwindcss"`) with two project-specific
blocks: theme variables, and `.app-content-clearance` which already uses
`env(safe-area-inset-bottom)`. `body` declares a plain `Arial, Helvetica, sans-serif`
fallback; the Geist variables are set only by `layout.tsx`.

**Consequence:** the entire application UI, identity orchestration, persistence,
synchronisation, training, assessment and exercise logic is already framework-neutral
React. It does not need to be ported, rewritten or copied to run under a different build.

## 2.2 The application cannot be statically exported as it stands

`src/app/api/` contains **six dynamic server routes**:

| Route | Verb | Purpose |
| --- | --- | --- |
| `/api/team/invitations` | POST | create a Team invitation, send the email |
| `/api/team/invitations/[id]/revise` | POST | revise an invitation, re-send |
| `/api/team/invitations/[id]/resend` | POST | re-send an invitation |
| `/api/team/admin-requests` | POST | create an admin request |
| `/api/team/members/remove` | POST | remove a member |
| `/api/exercises/restricted-diagrams/[assetId]` | GET | authenticated restricted diagram bytes |

Next.js documents that under `output: "export"`, **Route Handlers that rely on `Request`
are unsupported**, only `GET` can be prerendered, and a handler must be explicitly
`force-static`. All six read the incoming request (`Authorization` header, JSON body, or
both). `output: "export"` is also a whole-project setting — it cannot be applied to one
route subtree.

**Consequence:** `output: "export"` cannot be enabled on the existing Next project without
removing Team functionality. `next.config.ts` is unchanged and must stay unchanged.

## 2.3 Authorized requests are same-origin and exact-path confined

> **Superseded in part by Stage M2a / ADR-0047.** "Same-origin" now reads "addressed to the
> one resolved API target", which on Web *is* the document origin — byte-identical to what
> this section describes. Every other property below is unchanged. See §5.2 and
> [`docs/adr/0047`](adr/0047-configured-native-api-origin-boundary.md).

`src/lib/supabase/authorizedFetch.ts` is the **only** production module permitted to read
the provider access token (ADR-0025 Decision 20), enforced by
`src/lib/persistence/__tests__/architectureBoundary.test.ts`. Its guarantees, in the order
they execute:

1. A hard-coded route table maps a typed route to a literal path. An unknown route
   returns `forbidden` with **no session read and no fetch**.
2. The origin comes from `window.location.origin` (`resolveDefaultOrigin()`), or a
   test-only override.
3. `buildConfinedUrl` proves the URL is **same-origin**, starts with the required prefix
   (`/api/team/` or `/api/exercises/restricted-diagrams/`), has **`url.pathname` exactly
   equal to the intended literal**, and carries **no query and no fragment**.
4. The body is serialised. An unserialisable body denies **before** the token is read.
5. Only then is the access token read, and it is placed in exactly one `Authorization`
   header on that proven URL. It is never returned, logged, stored or handed to a caller.

`createSupabaseTeamService` and `createSupabaseRestrictedAssetResolver`
(`teamServiceFactory.ts`) are the only composition points.
`createSupabaseRestrictedAssetResolver` currently has **no production call site** — the
current diagram catalogue is entirely public (ADR-0044/0045), and the three
`CLOSED_BETA_EXERCISE_ASSET_IDS` remain registered for future restricted content.

**Consequence:** under a native shell, `window.location.origin` is the local app scheme.
`buildConfinedUrl` would happily prove `capacitor://localhost/api/team/invitations`
same-origin — and there is no server there. The API origin must become an explicitly
configured, validated value. This is a deliberate design decision, not a relaxation.

## 2.4 Identity assumes a full-page redirect and a fresh document

This is the boundary that needs the most design work. The seams below are real, but
injecting them is **not** sufficient.

### The injected seams that do exist

`src/lib/identity/identityRuntime.ts` isolates two browser facts:

- `resolveRedirectTarget: browserRedirectTarget` — returns `` `${window.location.origin}/` ``,
  the only Google redirect target the application uses.
- `createCallbackCaptureCell(browserCallbackUrlAccess())` — a `CallbackUrlAccess` with
  `readCurrentUrl()` / `replaceCurrentUrl()`.

`supabaseAuthService.ts` also accepts `resolveAppOrigin` and `navigate` as test-only
overrides.

### Four facts that block a naive native port

**(a) The validators accept `http:` and `https:` only — a custom scheme cannot be made to
work by overriding an origin.** `isUsableUrl` (`supabaseAuthService.ts`) rejects any URL
whose `protocol` is neither `http:` nor `https:`, and additionally requires a non-empty
hostname and no embedded credentials. It guards **two** independent checks:
`isValidRedirectTarget` (the target handed to the provider) **and**
`validateAuthorizationUrl`'s inspection of the `redirect_to` the provider will actually
use. Supplying a different `resolveAppOrigin()` therefore does not enable a custom scheme:
the scheme is rejected before any origin comparison happens.

There is a second, sharper reason not to reach for a custom scheme by origin override. For
a non-special scheme, `URL#origin` is the **opaque** value `"null"`. Comparing
`url.origin === appOrigin` would then compare `"null"` to `"null"` and pass — for **any**
such URL. An opaque origin is not a security boundary, and must never be used as one here.

**(b) The capture cell is page-scoped and terminally spent.** `supabaseCallbackCapture.ts`
documents a one-way lifecycle `uncaptured → captured → finalized`. After
`finalizeTerminalCallbackOutcome()`, `initializeCallbackCapture()` returns `no_return`
**without rereading the URL**, and `claimCallbackForExchange()` returns `no_claim` forever.
`createCallbackCaptureCell` is called once in `identityRuntime.ts` and cached at module
level, deliberately, so that one document has exactly one cell.

**(c) Ordinary startup finalizes the cell even when no callback arrived.**
`identityTransitionCoordinator.startUp()` calls `capture.initializeCallbackCapture()`, and
on **every** path except `admit_continuation` calls `capture.finalizeTerminalCallbackOutcome()`
before returning. A normal cold start with no OAuth return therefore leaves the cell
**finalized**. `identityRuntime.startUpOnce()` additionally caches the startup promise, so
the Phase 0 intake path runs at most once per page scope.

**(d) `startGoogleSignIn` assumes navigation ends the page.** Its final comment is explicit:
*"Navigation ends the start-page epoch. The callback page will begin a fresh one."* The
persisted attempt records `capturedIdentityGeneration: startEpoch`, and
`consumeAdmittedContinuation` bumps `liveGeneration` to create a **fresh callback-page
epoch**, deliberately never comparing it with the start page's value.

**In a browser these four compose correctly**, because the callback arrives on a genuinely
new document: new module evaluation, new runtime, new cell, new startup. **In a Capacitor
WebView the document never reloads.** One WebView lifetime spans startup, sign-in, the
callback, sign-out and a second sign-in. A warm callback would arrive at a cell that ordinary
startup already finalized, into a runtime whose `startUpOnce()` promise is already settled.
**It would be silently unclaimable.** This is the central native identity problem, and §6
is its design.

### What already works, and must be preserved rather than replaced

`decideOAuthIntake` (`src/lib/identity/oauthReturnIntake.ts`) is **pure** and decides
admissibility from the classified candidate plus durable records only. Its correlation is
**durable, not in-memory**: branch D rejects a callback whose `sb_flow_id` does not equal
the persisted attempt's `flowId` (*"THE decisive comparison … There is no fallback"*),
branch E rejects a replay against an already-correlated resolution, and branch F rejects
ambiguous and malformed shapes **before any durable state is consulted**.

This is why the native design needs **no new correlation logic**. A stale callback is
already `unowned_callback` with zero exchanges, leaving a newer attempt intact. What is
missing is only the plumbing that lets a warm callback reach this decision at all.

### Redirect construction and the classifier

`validateAuthorizationUrl` proves the authorization URL is on the configured Supabase
origin, hits exactly `${supabaseUrl}/auth/v1/authorize`, names `google`, carries an `s256`
PKCE challenge, and carries a `redirect_to` that is exactly the requested target plus
exactly one matching selector. The client is constructed with `flowType: "pkce"`,
`detectSessionInUrl: false` and `experimental.appendPkceFlowIdToRedirects: true`
(`BROWSER_AUTH_OPTIONS`); `supabaseFlowCompatibility.test.ts` asserts that object
**exactly equals** those three keys. `supabaseCallbackClassifier.ts` treats an owned
implicit-grant fragment as `malformed_callback`.

**Email OTP needs no redirect at all.** `requestEmailOtp` calls `signInWithOtp({ email })`
with no `emailRedirectTo`; `verifyEmailOtp` calls `verifyOtp({ email, token, type: "email" })`
with a typed code. It touches none of (a)–(d).

**Consequence:** the callback problem is confined to Google sign-in, and it is a lifecycle
problem, not a correlation problem.

## 2.5 Local sporting data is Profile-scoped browser storage

`src/lib/persistence/profileScopedSportingPersistence.ts`:

- `createProfileScopedSportingStorageAdapter(profileId)` returns a **frozen, immutable**
  adapter namespace keyed `curling.sporting.profile.v1.<profileId>.<logicalKey>`. There is
  no mutable "current profile" pointer, so a delayed write from Profile A keeps A's key
  even after the tree switched to Profile B.
- Thirteen logical keys are registered (ten `SPORTING_STORAGE_KEYS` plus the assessment
  draft/history split and the cloud sync state). An unregistered key **fails** rather than
  falling through to a global key.
- `retireLegacyUnscopedSportingData()` removes the ten legacy unscoped keys **content-blind**
  behind a completion marker. It never reads, parses, adopts or copies them.

`localStorageAdapter.ts` is the only file permitted to touch `localStorage`
(enforced by `noDirectStorageAccess.test.ts`). `indexedDbAdapter.ts` and
`localStorageToIndexedDbMigration.ts` exist but are **not wired into production
composition** (ADR-0015) and must stay that way.

`src/lib/exercises/exerciseAssets.ts` caches the 67 public diagrams as
`data:image/png;base64,…` strings under `localStorage` keys
`curling-performance-public-exercise-diagram-v1.<assetId>`, **never evicting** a
superseded id because saved plans and recorded results still reference it.

**Consequence:** a native WebView has its own storage container. Nothing a user has in
Safari appears after installing a native build. And the diagram cache — the largest
consumer of `localStorage` — becomes unnecessary on mobile, because the diagrams ship
inside the bundle.

## 2.6 Cloud authority and restore already exist

`SportingCloudSyncManager` (`src/lib/cloudSporting/syncManager.ts`) decorates the
repositories, maintains a Profile-scoped outbox in the sync state record, and
`restoreIntoLocalRepositories()` pulls terminal records back down. Every restored record's
payload is **SHA-256 verified** against its `contentSha256` before it is deserialised; a
mismatch sets a global issue and aborts rather than writing anything. Two cloud record
kinds exist: `training_session` and `assessment_run`. Team exercise results have their own
service, outbox and owned-result projection.

**Consequence:** "restore eligible cloud history on a fresh device" is an existing,
tested code path, not new work. The mobile milestone consumes it; it does not reimplement
it.

## 2.7 Export is a DOM download

`src/lib/export.ts`'s `downloadCsv` builds a `Blob`, creates an object URL, sets
`link.download`, clicks it and revokes the URL. `src/lib/assessment/export.ts` reuses it;
`ExerciseTeamResultsScreen.tsx` has its own JSON variant using the same mechanics;
`src/lib/brower/diagnosticLog.ts` has a third, explicitly mirroring `downloadCsv`.

**Consequence:** four call sites, one mechanism. On both native platforms an anchor
download does not produce a file the user can keep. This needs one small adapter, applied
at one place, not four.

## 2.8 Server-authored links point at the Web origin

`src/app/api/team/_lib/context.ts` resolves a **server-only** `APP_ORIGIN` (bare origin,
https unless localhost) and `buildAcceptUrl` produces `` `${origin}/?inviteToken=…` ``. A
missing or invalid origin reports an honest `emailSent: false` rather than falling back to
the request's own origin. `identityRuntime.captureCurrentDeepLinkIntent()` reads
`inviteToken` / `adminRequestId` from the current URL, persists the intent through the
coordinator, and strips exactly those two parameters.

**Consequence:** an invitation email opens the Web application. Making it open the mobile
app is a Universal Link / App Link question, and the same `appUrlOpen` ingestion path that
serves Google sign-in serves it.

## 2.9 Other verified facts

- **Navigation is in-memory, not routed** (ADR-0009). `src/lib/navigation.ts` drives
  `ActiveView`. There is no client router to reconcile with a native shell, and no
  history-based back behaviour to preserve. Android's hardware back button therefore has
  **no existing mapping** and needs an explicit decision at implementation time.
- **Capture is serialised** (ADR-0007). `TrackerApp.tsx` holds `captureQueueRef`, a
  Promise chain, plus authoritative refs. Exactly one `TimingProvider` subscription per
  mounted effect instance.
- **Duplicate protection is by result id.** `processTimingResult` returns `"duplicate"`
  when `sequence.processedResultIds.includes(result.id)`.
- **Account switch remounts everything.** `AuthenticatedSportingPersistence` keys
  `ProfileScopedSportingPersistence` on `profileId`, forcing a complete repository and
  application-state remount.
- **Observed defect, out of scope for this task:** `layout.tsx` declares
  `manifest: "/manifest.json"`, but the file is at `public/public/manifest.json` and is
  therefore served at `/public/manifest.json`. Recorded here as a current-state
  observation only. It is not fixed by this task and has no bearing on the native design,
  which does not use a web app manifest.

---

# 3. Recommended technical design

## 3.1 The build arrangement — two candidates

### Candidate A — a shared Capacitor/Vite client entry consuming the existing modules

A new, small build target (proposed location `mobile/`) with its own `vite.config.ts` and
an entry that renders the **same component tree `src/app/page.tsx` renders**, importing
directly from `src/components/` and `src/lib/`. Capacitor's `webDir` points at that
build's output. `package.json` gains mobile-only scripts; the existing `dev`, `build`,
`start`, `lint`, `test` and `test:e2e` scripts are untouched.

What it needs:

- A Vite `define` for the inlined values (`process.env.NODE_ENV`,
  `process.env.NEXT_PUBLIC_SUPABASE_URL`, `process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`;
  Stage M2a adds `process.env.NEXT_PUBLIC_NATIVE_API_ORIGIN`). §2.1 verified the first three
  as the complete set in shared client code at the time; the allow-list in
  `mobile/publicEnv.ts` is the current authority.
- Tailwind v4 via `@tailwindcss/vite`, importing the existing `src/app/globals.css`.
- An HTML shell reproducing `layout.tsx`'s `viewport-fit=cover` and `<html>`/`<body>`
  classes, and `page.tsx`'s container markup. Fonts: either drop the Geist variables (the
  CSS already falls back) or self-host them; `next/font/google` is not available here.
- `public/exercise-diagrams/` copied into the bundle.

Cost: one HTML shell and one entry file duplicate the layout/page markup — about forty
lines that must be kept consistent with `src/app/`. That divergence risk is real and is
the honest downside.

### Candidate B — a separated Next static client build

Split the project so a client Next app builds with `output: "export"` while a second
deployment keeps the six API routes.

What it needs: two Next projects (or one project with a conditionally-swapped config and a
mechanism to exclude `src/app/api/` from the export build), a second deployment target for
the API, a rethink of `outputFileTracingIncludes` for the restricted-assets route, and a
decision about where the legal pages live. `output: "export"` errors on Route Handlers
that read `Request`, so "exclude them at build time" is the load-bearing, fragile part.

What it buys: `layout.tsx` and `page.tsx` are reused verbatim, so the forty lines above are
not duplicated. `next/font/google` keeps working (it self-hosts at build time).

### Recommendation — Candidate A

Because of §2.1. The shared client is already framework-neutral, so Candidate B's only
real advantage is reusing a nine-line page shell and a fifty-line layout — and it pays for
that by restructuring the Web deployment, which is precisely what the non-regression
constraint (§1.7) asks us not to disturb.

Concretely, Candidate A:

- **leaves `next.config.ts`, the Web build, the server, and all six API routes exactly as
  they are.** `npm run build` and `npm start` behave identically before and after.
- adds a second consumer of `src/components/` and `src/lib/` rather than a second copy.
  The shared modules stay the single source of truth; a change to `TrackerApp.tsx` reaches
  Web and mobile simultaneously.
- keeps mobile build failures out of the Web build.
- carries no risk of a config flag accidentally shipping a static Web build without Team
  functionality.

The duplication cost is bounded and testable: an automated check that the mobile shell
mounts the same provider tree as `src/app/page.tsx` closes it. That check belongs in
Stage M1's acceptance.

**This is a technical recommendation, not an approved product decision.** It is reversible:
because the shared modules are untouched either way, switching to Candidate B later
replaces the entry and the build config, not the application.

## 3.2 One shared mobile application

```text
                    src/components/  +  src/lib/
        (React UI, navigation, identity orchestration, Profile rules,
         repositories, sync, training, assessment, exercises, analytics)
                              │
            ┌─────────────────┴─────────────────┐
            │                                   │
      src/app/ (Next)                    mobile/ (Vite entry)
      Web browser                               │
                                    ┌───────────┴───────────┐
                                    │                       │
                              ios/ (Capacitor)        android/ (Capacitor)
                              same bundled assets, same JS
```

- **One** React UI and navigation.
- **One** training, assessment and exercise implementation.
- **One** identity orchestration and Profile rule set.
- **One** repository and synchronisation layer.
- iOS and Android native projects consume **the same built mobile assets**. They differ
  only in native configuration and in the platform adapters of §3.3.

**The entire application is never copied into per-platform codebases.** A platform-specific
React component, a platform-specific screen, or a second copy of a domain module is a
design failure, not a workaround.

## 3.3 Platform adapters — the proposed set

Small, explicit, and justified by an actual platform difference. Each is a named module
behind a shared interface.

**The rule is about what must stay shared, not about a count of implementations.** Web, iOS
and Android are three targets, and an adapter may legitimately have three implementations —
or a native implementation that branches internally on platform, where the platforms
genuinely differ (BLE permissions and deep-link association are the clearest cases). What is
**not** permitted is duplicating domain logic, UI or synchronisation per platform. A
justified platform-presentation or adapter difference is ordinary engineering, not a design
failure; §10 M5's constraint is that Android must not require touching **shared domain
code**, which is a different and stricter thing.

| Adapter | Why it must exist | Shared interface already present? |
| --- | --- | --- |
| **API origin** | Native `window.location.origin` is the local app scheme; the API lives on a different origin (§2.3) | **Yes — IMPLEMENTED in Stage M2a.** `src/lib/platform/apiTarget.ts` resolves one target per request (document origin on Web, the configured HTTPS origin on native); both production factories are wired to it. See [ADR-0047](adr/0047-configured-native-api-origin-boundary.md) |
| **Identity return target** | The Google redirect target is not the document origin (§2.4, §6.2) | **Yes** — `resolveRedirectTarget` is already injected |
| **Callback ingestion, addressing and arming** | A native callback arrives as a delivered URL and must be addressed to the attempt that owns it, with no page reload (§6.4) | **No.** `CallbackUrlAccess` is injected, but the cell is page-scoped, has no "ingest this URL" operation, Phase 0 admission exists only inside `startUp()`, and `consumeAdmittedContinuation` reaches its cell through the coordinator's closure rather than an ownership binding |
| **Authentication browser** | Native must open the authorization URL outside the app WebView (§6.3) | No — `navigateToAuthorizationUrl` currently assigns `window.location` |
| **Storage engine** | Possibly, pending **P6** — see §7.1 | **Yes** — `StorageAdapter`. This is ADR-0013's sanctioned extension point, and swapping the engine behind it changes no authority |
| **File export** | An anchor download yields no keepable file on either platform (§2.7) | No — four call sites share `downloadCsv`'s mechanics |
| **External links** | `target="_blank"` must open the system browser | No — five `target="_blank"` sites |
| **App lifecycle** | Foreground/background transitions have no Web equivalent the app currently uses | No |
| **Hardware back** | Android only; no Web or iOS equivalent | No — navigation is in-memory `ActiveView` |

**Deliberately *not* adapted**, because the behaviour can stay shared: networking (`fetch`
exists on all three), crypto (`crypto.randomUUID` / WebCrypto — but see the Stage M1
acceptance check), navigation structure, and every domain module.

## 3.4 Asset delivery

Mobile UI assets — JS, CSS, fonts, icons and **all 67 public exercise diagrams** — are
**bundled** into the app. Dynamic APIs remain server-hosted.

**A remote `server.url` wrapper is not the release design.** Capacitor's own configuration
documentation states `server.url` is for live-reload during development and is not
intended for production. Pointing the shell at the deployed origin would also silently
convert every security property in §2.3 and §2.4 into "it happens to be same-origin
because we loaded the app from there" — a working-looking demo with a different security
model. `server.url` may be used for local development only, and must never appear in a
release configuration.

Bundling the diagrams has a second benefit: `createPublicExerciseAssetResolver` fetches
`PUBLIC_EXERCISE_DIAGRAM_PATHS[assetId]` as a relative path, which resolves against the
local app origin and therefore works offline **without** the `localStorage` data-URL cache.
Whether to bypass that cache on native is a Stage M3 implementation decision; the safe
default is to leave the resolver unchanged and let the first fetch populate the cache as
it does today.

---

# 4. Open product decisions

Each is genuinely unresolved. **None is settled by this document.** For each, the stage it
blocks is named; work before that stage proceeds without it.

| # | Decision | Blocks | Why it blocks that stage |
| --- | --- | --- | --- |
| **P1** | **Long-term Web plus mobile support, versus eventual mobile-only delivery.** | **Nothing before M6.** | The migration is non-regressive either way. It becomes load-bearing only when distribution commitments and long-term Web maintenance are budgeted. Recorded so that no stage silently assumes the Web app is disposable. |
| **P2** | **Must the first mobile pilot transfer browser-local drafts and unsynchronised data?** | **M3's data-transfer scope and acceptance criteria.** | If **no**, M3's data scope is "install, sign in, restore successfully-synchronised cloud records" — existing code. If **yes**, M3 must additionally design a cross-container transfer with its own authority, authorisation, integrity and failure model. §7.5 gives a **recommendation**; **no stage may proceed as though it were the answer.** Independent M3 work that does not depend on it may proceed. |
| **P3** | **Must production measurement continue during backgrounding or screen lock?** | **M4** (Brower production capture), and the **`Info.plist` / manifest** content from M1 onward. | `UIBackgroundModes: bluetooth-central` changes Apple review exposure, and Android background BLE has an entirely different model. **M1 scaffolds foreground-only and declares no background mode** — the currently exercised scope. That is a reversible starting point, not an answer: adding a background mode later is a configuration and review change, whereas declaring one speculatively is an unjustified capability claim. Nothing in M1 implies approval. |
| **P4** | **Production app identity, release configuration and distribution commitments** — bundle identifier / application id, app name, **the callback domain**, store accounts, and whether App Store and/or Google Play distribution is committed. **The API origin is NOT part of this any more: it is confirmed as `https://curling.evolane.me`** and configured through `NEXT_PUBLIC_NATIVE_API_ORIGIN` (Stage M2a, [ADR-0047](adr/0047-configured-native-api-origin-boundary.md)). Confirming it settles the API destination only. | **M1** uses explicit development placeholders; **M2's HTTPS callback path** cannot be completed without the callback domain; **M6** needs all of it. | A bundle identifier is baked into provisioning, Universal Link / App Link association and the Supabase redirect allow list. **No remaining value is invented here.** See §6.2 and §10 M2 for what an unresolved domain means in practice, and what the explicitly supported fallback would require. |
| **P5** | **Does the required alternative login satisfy Apple guideline 4.8?** | **M6** (distribution readiness); influences **M2**. | Guideline 4.8 requires an app using Google Sign-In for the primary account to also offer a login service that limits collection to name and email, **allows the user to keep their email address private**, and does not collect interactions for advertising without consent. Email OTP collects only an email address, but it does not offer an email-privacy relay. Whether that satisfies the second bullet, or whether Sign in with Apple must be added, is a product and review-risk decision. **Do not resolve it by removing Google sign-in** — §1 preserves existing sign-in options. |
| **P6** | **How is native local persistence made durable enough to accept?** — option A, B, C or D in §7.1, or a combination. | **M3.** The first usable offline milestone cannot be *claimed* without it. | Capacitor documents that WebView LocalStorage **"must be considered transient"** and that the OS reclaims it under storage pressure. This is not a risk a device test can retire. Accepting the current engine is a legitimate answer, but it is an **explicit product acceptance of possible silent loss of drafts and unsynchronised work**, not a default. Choosing a native adapter is a design change needing its own ADR. |

| **P7** | **What does the identity gate offer after an ambiguous authentication-browser dismissal?** — a visible "Cancel sign-in" control, an automatic timeout, or nothing beyond "try again". | **M2's gate behaviour only.** The architecture does not wait on it: §6.7's cancellation seam is specified and testable (§6.9 B4, B5, B19, B20) whichever answer is chosen, and it does not block M1. | The chosen plugin may report only that its sheet closed, without distinguishing cancellation from completion (§6.3), so dismissal cannot itself be treated as failure. Something must nevertheless let a user abandon an attempt, because retry alone does not make a cancelled attempt's late callback inadmissible. **This document specifies the seam and does not choose the UI.** An implementation must not present an incomplete flow as complete while this is open. |

One further item is a **technical unknown**, not a product decision, and is settled by
measurement rather than by a person deciding:

- **T-a.** The practical storage ceiling in each platform's WebView once the 67 diagrams
  ship in the bundle rather than in the data-URL cache. Measure it. Note this is a **capacity**
  question only — it says nothing about **durability**, which is P6 and is not measurable by
  a passing test (§7.1).

---

# 5. Server access and authorization (Boundary A)

## 5.1 Inventory

| Surface | Reached how | Auth | Needed on mobile |
| --- | --- | --- | --- |
| Five `/api/team/*` routes | `authorizedFetch.ts` → `createAuthorizedTeamRequest` | `Authorization: Bearer <access token>`, server-verified | Yes — Team features are part of the application |
| `/api/exercises/restricted-diagrams/[assetId]` | `createAuthorizedRestrictedAssetResolver` | same | **Dormant — no catalogue entry uses it, and no component composes it.** The boundary is kept, and Stage M2a wired its factory to the same resolved API target as the Team service so it can never point at the WebView origin on native |
| Supabase Postgres / RPC / Auth | `@supabase/supabase-js` direct to the Supabase origin | provider session, RLS | Yes — unchanged; the SDK already targets an absolute configured origin |
| Public exercise diagrams | relative `fetch` of `/exercise-diagrams/*.png` | none | Yes — served from the bundle |
| Invitation / admin-request emails | server-authored `${APP_ORIGIN}/?inviteToken=…` | one-time token | See §6.5 |

**Only the first two cross the `authorizedFetch.ts` boundary.** Supabase traffic does not:
the SDK is constructed with an absolute configured URL and is unaffected by the document
origin.

## 5.2 Native API configuration and trust boundary — IMPLEMENTED (Stage M2a)

> **This section was written as a proposal and has since been implemented.** The decision,
> its alternatives and its failure behaviour are recorded in
> [ADR-0047](adr/0047-configured-native-api-origin-boundary.md), which is the governing
> reference; what follows is the design it implements, kept here for context. The
> configured value is `https://curling.evolane.me`. **Still outstanding:** deploying the
> accompanying server CORS change, and any on-device evidence.

**The design.** One explicitly configured **API origin**, resolved the same way
`resolveCloudConfig` resolves the Supabase configuration: a build-time value, validated,
failing closed to a named outcome rather than a guess.

- On **Web**, the resolved API origin is `window.location.origin` — byte-identical
  behaviour to today. The Web path must not change.
- On **iOS and Android**, it is the configured production origin. **`https` only**, no
  path, no query, no fragment, no credentials — the same shape `resolveAppOriginConfig`
  already enforces server-side for `APP_ORIGIN`.
- The value is supplied by native configuration, not by application logic, and not by
  anything the user or a received message can influence.

**Every existing check survives unchanged**, with one word redefined:

| Property | Before M2a | Implemented (M2a) |
| --- | --- | --- |
| Route table decides the path | hard-coded switch | **unchanged** |
| Prefix confinement | `/api/team/` or `/api/exercises/restricted-diagrams/` | **unchanged** |
| Exact-path equality (`url.pathname !== path` denies) | yes | **unchanged — this is the load-bearing check** |
| No query, no fragment | yes | **unchanged** |
| Destination validated **before** the token is read | yes | **unchanged — ordering is a security property** |
| Origin equality | equal to `window.location.origin` | equal to **the one resolved API target** — the document origin on Web, the one configured HTTPS origin on native |
| Token confinement | one header, one proven URL, never returned/logged/stored | **unchanged** |
| Server-side authorization | route verifies the bearer token and the caller's rights | **unchanged** |

**Explicitly rejected:**

- Caller-controlled destinations of any kind. The origin is configuration, never a
  parameter, never derived from a received URL, a deep link, or a server response.
- Wildcard or credentialed CORS. The native origin needs a **specific**, non-wildcard
  `Access-Control-Allow-Origin` entry, and `Access-Control-Allow-Credentials` stays off —
  the application authorises with a bearer header, not with cookies.
- Any global relaxation of same-origin checking, in the application or in the WebView.
- `server.allowNavigation` entries that would let the WebView navigate to the API origin.

**Required ADR amendment — WRITTEN as ADR-0047 (Stage M2a).** ADR-0025 Decision 20's
"confined to this app's own origin" now reads "confined to the one resolved, validated API
target, which on Web *is* the document origin." See
[`docs/adr/0047-configured-native-api-origin-boundary.md`](adr/0047-configured-native-api-origin-boundary.md).
It is accepted for implementation and implemented, but **not deployed, not exercised on a
device and not independently reviewed** — see the M2a status block in §10.

**CORS is a new server-side requirement — IMPLEMENTED in Stage M2a, NOT YET DEPLOYED.**
Before M2a every authorized request was same-origin and no CORS headers were needed. A native origin makes them cross-origin: the five Team
routes and the restricted-diagram route need an explicit preflight response naming the
native origin and allowing the `Authorization` header. That server change belongs to
Stage M2 and must not be attempted by loosening the client.

---

# 6. Identity and callbacks (Boundary B)

**Preserved without exception:** mandatory identity and completed onboarding before the
sporting shell mounts (ADR-0024/0025); `Profile.id` as the ownership and scope key;
trusted-device offline state rules; the identity gate as the only browser-reachable Profile
creation path; PKCE with an explicit selector and no verifier fallback; and the pure
Phase 0 branch table.

**Preserved without change:** current Web behaviour. Every proposal below is additive and
platform-selected. On Web, the callback still arrives on a fresh document, `startUp()`
still finalizes the cell, and `startUpOnce()` still caches one startup. Nothing in §6 alters
that path.

## 6.1 Email OTP — no callback mechanism at all

`signInWithOtp` + `verifyOtp` with a typed code (§2.4). It needs no redirect target, no
deep link, no authentication browser and no capture cell. **It is unaffected by every
problem in this section**, which is why §10 can reach a usable milestone before the
Universal Link work exists.

One verification item: the project's configured Supabase email template must deliver a
**code**, not only a magic link. Confirm before M2 acceptance.

## 6.2 Callback destination policy — proposed: HTTPS only

Two options were considered. **The recommendation is HTTPS-only**, and the document takes a
position rather than leaving it open, because the alternative requires changing a validator
that currently fails closed.

### Option 1 (recommended) — HTTPS callbacks only

The native callback URL is an ordinary `https://` URL on a domain the project controls,
claimed by the platform as a Universal Link (iOS) or App Link (Android).

**Why this is recommended:** `isUsableUrl` already accepts it, so
`isValidRedirectTarget` and `validateAuthorizationUrl` keep working **unmodified**. No
validator is weakened, no opaque origin is compared, and the same domain association makes
§6.5's invitation links open the app for free.

**Actual prerequisites, none of which may be invented here:**

| Prerequisite | Detail |
| --- | --- |
| A controlled domain | The callback host. **Open decision P4** |
| iOS | `apple-app-site-association` served from `https://<domain>/.well-known/`, correct content type, no redirect; Associated Domains entitlement `applinks:<domain>`; **Apple Developer Program enrolment** |
| Android | `assetlinks.json` served from `https://<domain>/.well-known/`; intent filter with `android:autoVerify="true"`; the **release signing certificate's SHA-256 fingerprint**, which ties this to release signing |
| Supabase | The callback URL added to the **Additional Redirect URLs** allow list, and the allow list must tolerate the appended `sb_flow_id` query parameter — `supabaseClient.ts` documents that flag as a hard dependency of Google sign-in |
| Google | The OAuth client's authorised redirect URI stays the Supabase callback endpoint. Unchanged |

**Honest cost:** a Universal Link is a *hint*, not a guarantee. iOS and Android both allow
the user to disable link handling for an app, and an unverified association silently falls
back to the browser. The design must therefore treat "the callback opened the browser
instead of the app" as an expected outcome with a defined recovery (§6.7), not an error.

### Option 2 (not recommended) — explicitly designed custom-scheme support

If P4 cannot supply a domain, a custom scheme (`<reverse-dns>://auth-callback`) is the
fallback. **It is not free, and it is not obtained by overriding an origin.** It requires
deliberate validator work:

- A new, explicitly-named predicate for a configured callback URL that validates
  **scheme, host and path against configured constants** — never `URL#origin`, which is
  the opaque `"null"` for every custom-scheme URL and therefore matches all of them.
- `isValidRedirectTarget` and `validateAuthorizationUrl`'s `redirect_to` check must both
  route through that predicate when the configured callback is a custom scheme, keeping
  the `http:`/`https:` path byte-identical for Web.
- Everything else — no fragment, no credentials, no pre-existing `sb_flow_id`, exactly one
  appended selector equal to the persisted attempt's, the unchanged authorization-endpoint
  validation — stays exactly as it is.
- The scheme must be registered in `Info.plist` / `AndroidManifest.xml` and added to the
  Supabase allow list. **Any app may claim the same scheme**, which is precisely why the
  correlation in §6.4 must not be relaxed.

**This option is a design proposal, not an approved decision.** Choosing it is P4's call.

**Forbidden under either option:** comparing opaque `"null"` origins; accepting a callback
destination from anything other than build-time configuration; relaxing the
authorization-endpoint, provider, PKCE-challenge or selector checks.

## 6.3 The authentication browser — mechanism, not assumption

`prepareGoogleSignIn` already uses `skipBrowserRedirect: true`, so the SDK builds and
validates the authorization URL and stores the PKCE verifier **without navigating**. The
native adapter replaces only `navigateToAuthorizationUrl`'s effect.

**The plugin's actual return and cancellation mechanism must be established before it is
chosen, not assumed.** In particular:

- **`@capacitor/browser` uses `SFSafariViewController` on iOS. It is *not*
  `ASWebAuthenticationSession`.** The two differ in ways that matter here: the
  authentication session type has a first-class completion/cancellation callback carrying
  the callback URL, whereas `SFSafariViewController` does not — a return through it depends
  on the OS routing the callback URL to the app, and `@capacitor/browser` surfaces
  dismissal through a `browserFinished` event that **does not distinguish** "the user
  cancelled" from "the flow completed and the sheet closed".
- Therefore **the plugin selection is a Stage M2 decision with its own verification**, not
  a foregone conclusion. If `ASWebAuthenticationSession` / Android Custom Tabs semantics are
  wanted, the plugin providing them must be identified and its documented return mechanism
  recorded — this document deliberately names no package as settled.
- **Never load the provider in the app's own WebView.** Google blocks embedded-WebView
  sign-in, and an in-WebView flow would also put provider credentials inside the
  application's own browsing context.

**Design consequence, and it is the important one:** because dismissal may be
indistinguishable from completion, **the design must not treat a dismissal event as
authoritative cancellation.** §6.7 makes cancellation an explicit, user-driven,
attempt-scoped action instead.

## 6.4 Owned callback ingestion — the core proposal

**Everything in §6.4–§6.7 is a proposal for Stage M2 to implement and have reviewed. None
of it exists.** Statements about *current* behaviour cite the file that establishes them.

Three facts about the **current** coordinator constrain any native design, and each one
invalidates an ordering that would otherwise look reasonable:

- **`beginTransition()` unconditionally claims the single ownership slot**, superseding
  whatever held it (`identityTransitionCoordinator.ts`: *"Claims ownership for a new
  operation, superseding whatever held it"*; `ownsOperation` compares against one
  `owningOperationSequence`). So a delivery that claims ownership *before* it is known to be
  owned will supersede a legitimate concurrent attempt — and a later revalidation cannot undo
  a supersession that has already happened.
- **`startGoogleSignIn` claims that slot in its first statement**, before `establishBarrier`
  and before its attempt is persisted. There is therefore a real interval in which a new
  attempt owns the live slot while durable state still describes the old one, so **durable
  attempt ids cannot prove live ownership**.
- **`consumeAdmittedContinuation` reaches its capture cell through the coordinator's
  closure-bound `capture` dependency** and finalizes it on every path. With one immutable
  page-scoped cell that is correct; with replaceable attempt-scoped cells it would finalize
  *whatever is currently bound* rather than what the operation owns.

The design that follows from them: **addressing, admission and ownership are three separate
steps, in that order**; ownership is taken only through a conditional handoff proven against a
live witness; and every consuming action — claim, exchange, finalizer — is bound to the exact
attempt and cell it owns.

### (i) A callback record per attempt — two independent axes

**Proposal:** on native, a **callback record** replaces the single page-scoped cell. Its
state has **two orthogonal axes**, and conflating them is what makes a single "armed" enum
contradict itself:

```text
CallbackRecord = {
  flowId,                        // the selector this record is addressed by (non-secret)
  attemptId | null,              // binding: null until bound to a durable attempt
  cell,                          // one CallbackCaptureCell — this record's only one
  binding:     "provisional" | "bound" | "released",
  consumption: "empty" | "captured" | "claimed" | "finalized",
}
```

- **Binding** answers *"which attempt does this belong to?"* `startGoogleSignIn` creates a
  record already `bound`. Bootstrap may create one `provisional` (§6.6), which binding later
  resolves to `bound` or `released`.
- **Consumption** is the cell's existing one-way lifecycle, unchanged: one classification,
  one claim that transfers the code out, one `readAuthorizationCode()`,
  `finalizeTerminalCallbackOutcome()` as the only terminal operation, never wired to React
  effect cleanup.

**The two axes never move each other.** **Binding a record does not reset its consumption**,
so material already ingested is *never* eligible for a second ingestion, and a record that
was captured while `provisional` stays `captured` when it becomes `bound`. Only
`consumption === "empty"` accepts ingestion; only `binding !== "released"` is addressable.
**"Armed" is deliberately not a state.** A single enum mixing "belongs to attempt X" with
"has already been ingested" cannot express a record that is bound *after* capture, which is
exactly what bootstrap requires.

The record is **addressed by `flowId`**, not by being "the one that is current". That is what
stops a delivery for A from ever reaching B's cell.

**Replacement is bounded and fail-closed.** A new `startGoogleSignIn` finalizes and releases
the previous attempt's record. If that record had claimed but not yet read its code,
finalization revokes it and the old exchange fails closed — the wanted outcome once a newer
attempt exists.

**Web is unchanged.** It keeps the module-level page-scoped cell, because a browser callback
genuinely does arrive on a new document.

### (ii) Addressed ingestion — classify and correlate without consuming anything

A delivered URL passes four steps. **The first three consume nothing, mutate nothing and
touch no cell.**

1. **Destination validation.** Scheme, host and path against the configured callback
   destination (§6.2). A URL that is not the configured destination is not a callback; it
   goes to §6.5's routing or is dropped.
2. **Field validation.** Only `OWNED_CALLBACK_QUERY_FIELDS` and the Team deep-link parameters
   are permitted.
3. **Pure classification and selector pre-match.** `classifyCallbackUrl` is already a pure
   string → shape function (`supabaseCallbackClassifier.ts`), so it needs no cell. Its
   success and provider-error shapes carry a validated `flowId`. That selector is compared
   against existing records' `flowId`.
   - **A record matches and its `consumption` is `empty`** → proceed to step 4.
   - **A record matches but its `consumption` is not `empty`** → duplicate or late
     re-delivery. Dropped, for the same reasons (§6.6). **Binding state is irrelevant here:**
     already-ingested material is never eligible for a second ingestion, whether the record is
     `provisional` or `bound`.
   - **No record matches** → in the **steady state** the delivery is not addressed to anything
     in this process and is **dropped**: no cell captured, claimed or finalized, no coordinator
     operation started, the ownership slot untouched. **The single exception is bootstrap**,
     where a record may not exist yet — §6.6 defines that boundary and nothing else may create
     a record from an unmatched delivery.
   - A shape carrying **no** selector (`ambiguous_callback`, `malformed_callback`) is not
     addressable. It is dropped without effect and separately reported. It must never be
     ingested into an arbitrary record merely because one exists.
4. **Ingestion** into that record's cell, moving `consumption` to `captured`.

**This pre-match is addressing, not admission.** It can only ever *drop* a delivery; it can
never admit one, and it never substitutes for the durable comparison. It is strictly
necessary-but-not-sufficient: a delivery that passes it still goes through the whole
`decideOAuthIntake` branch table and can still resolve D, E, F or G. **There is no competing
correlation policy** — `oauthReturnIntake.ts` remains the sole authority on admissibility,
and the selector it compares is the *persisted* attempt's, read from durable state.

### (iii) The warm continuation — carried ownership evidence, then a synchronous handoff

**Proposal:** a coordinator operation performing exactly `startUp()`'s Phase 0 half and none
of its Phase A half, **bound at construction to one `attemptId` and one cell**.

**The hazard this ordering exists to close.** Claiming the ownership slot after an
asynchronous read is unsafe even if the read is revalidated afterwards:

> A's callback is ingested and begins reading a durable snapshot. **B starts and
> synchronously claims the slot.** A's read returns the still-valid A state. A calls
> `beginTransition()` and supersedes B. Revalidating afterwards cannot undo that
> supersession — B has already lost the slot, and B's visible result can already have been
> replaced.

**Comparing durable attempt ids cannot close it.** `startGoogleSignIn` claims the slot in its
**first statement**, before `establishBarrier` and before the attempt is persisted
(`identityTransitionCoordinator.ts`: *"Claiming ownership FIRST supersedes every older
operation immediately"*). During that interval B owns the live slot while durable state still
describes A. Nor does the effect lane help: `beginTransition()` is called **outside**
`inSection`, so serialization does not order it — this design must not claim otherwise.

**The required primitive is a live, non-mutating ownership witness.** `operationCounter` is a
module-level counter incremented **only** by `beginTransition()`, synchronously, and
`owningOperationSequence` is set from it. Its value is therefore an exact answer to *"has any
deliberate transition claimed the slot since I last looked?"* — including one that has
persisted nothing. Today the counter has **no non-mutating reader**; `beginTransition()` is
its only accessor and it mutates. **Exposing a read-only witness is a required seam**, and it
is deliberately not `liveGeneration`, which is bumped inside `establishBarrier` and so does
not exist yet during the unsafe interval.

#### Where the evidence comes from, and how far it reaches

A witness proves only *"nothing claimed the slot since this sample"*. **It is therefore only
as good as the moment it was taken**, and re-sampling it later does not recover evidence that
was never held. The sample must be taken **before the first `await` of the whole path** —
delivery, reconstruction, admission and handoff included — and then **carried**, never
refreshed. A path that re-samples after an asynchronous step has, by construction, no evidence
about that step.

The evidence differs by case, and the difference is real rather than cosmetic:

| Case | What establishes the binding | What the evidence actually proves |
| --- | --- | --- |
| **Warm** — the attempt was started by `startGoogleSignIn` in this process | That call **already claimed the slot** in its first statement, and nothing relinquishes it: `owningOperationSequence` changes only when another `beginTransition()` runs. The record therefore carries the attempt's own `TransitionContext` | **A genuine ownership check** — `ownsOperation(attemptContext)` — not "nothing changed since I looked". The continuation *resumes* an ownership the attempt already holds |
| **Cold** — the process is new and nothing has claimed the slot | Bootstrap samples the witness **synchronously on entry, before reconstruction's first `await`** (§6.6), and that one sample is carried through reconstruction, admission and handoff | "No deliberate transition has claimed the slot since the process began" — which, starting from an unclaimed slot, is exactly the needed proof |

**A late sample is not a substitute for either.** A witness taken *after* reconstruction
cannot see a transition that occurred *during* reconstruction, and describing it as continuous
protection would be false.

The ordering:

1. **Carry the evidence established above.** For a warm attempt this is its
   `TransitionContext`; for a cold bootstrap it is the entry-time witness. **Claim nothing,
   and do not re-sample.**
2. Read the durable snapshot through the existing serialized `loadDurableSnapshot()`.
3. Call the unchanged pure `decideOAuthIntake(candidate, snapshot)`.
4. **Not `admit_continuation`** → finalize **this record's** cell only, drop the record, and
   report that branch's outcome. **Nothing is superseded**, no other record is touched, and no
   other operation's visible result is overwritten.
5. **`admit_continuation`** → verify the admitted `attempt.attemptId` equals the record's
   bound `attemptId`. If not, treat as step 4.
6. **The conditional ownership handoff.** Check the carried evidence and claim the slot **in
   one synchronous step with no `await` between them**:

   ```text
   warm:  if (!ownsOperation(attemptContext))   → abort   // the attempt no longer owns the slot
   cold:  if (witness() !== entryWitness)       → abort   // something claimed it since entry
   then:  context = beginTransition({ binding: { barrierId, attemptId } })
   ```

   Both statements are synchronous, so no other task can interleave. **Any intervening
   deliberate transition — including a B that has not yet persisted a barrier or an attempt,
   and including one that ran during reconstruction — fails the check and A aborts.** An
   aborting continuation finalizes **its own** cell, reports `correlation_changed`, and
   **does not** claim the slot, bump the generation, overwrite B's visible result, or finalize
   B's cell.
7. **Durable revalidation still runs, as a separate protection.** After claiming, inside an
   owned section, re-read the snapshot and re-run `decideOAuthIntake`; proceed only if it
   still admits the same barrier and the same attempt, and keep every named checkpoint
   (C3 before the exchange, C7 after the resolution). The witness covers the in-process,
   not-yet-durable interval; the checkpoints cover another tab and durable change. **Neither
   substitutes for the other**, and both are required.
8. Run the admitted continuation, bound to this record (§6.4 iv).

**`decideOAuthIntake` remains the sole admission authority.** The witness is an ownership
proof, not an admission rule: it can only cause an abort, never an admission.

### (iv) The required `consumeAdmittedContinuation` seam

**This function cannot be reused unchanged**, and that is load-bearing rather than cosmetic:
it closes over the coordinator's single `capture` dependency and calls
`finalizeTerminalCallbackOutcome()` unconditionally. Reused verbatim against replaceable
cells, a delayed continuation for A would finalize whichever cell is bound at that moment —
B's.

**The minimum required change is an explicit ownership binding:** the function takes **the
cell it owns** as an argument (or resolves it from its bound `attemptId`) instead of reading
the enclosing closure. Every security invariant and business rule is preserved:

- the fresh callback-page epoch from `liveGeneration.bump()`;
- the C3 checkpoint before any exchange;
- **exactly one** `claimCallbackForExchange()`, and a non-`claimed` result performing zero
  provider calls;
- the exchange against `expectedFlowId`, with no verifier fallback;
- **unconditional finalization — of its own cell** — on every path, success or failure.

On Web the argument is the page-scoped cell, so behaviour is byte-identical and every
existing identity test must still pass unchanged.

**Universal rule:** every claim and every finalizer is bound to the exact attempt and cell it
owns. **A delayed completion, cancellation or cleanup for A may finalize A's resources only,
and must never finalize B's replacement cell.**

### The corrected A → B trace

| Step | What happens | Authoritative operation / cell | Exchanges |
| --- | --- | --- | --- |
| 1 | Attempt **A** starts; record A created `bound`, `empty`, keyed `flowId_A` | A's operation, cell A | 0 |
| 2 | Attempt **B** starts. `beginTransition()` supersedes A's operation; `establishBarrier` bumps the generation; record A is finalized and released; record B created `bound`, `empty`, keyed `flowId_B` | B's operation, cell B | 0 |
| 3 | **Late callback for A** arrives. Destination and field validation pass. Classification yields `flowId_A`. **Addressing finds no record keyed `flowId_A`** — A's record is gone, and B's selector differs | **still B's operation, cell B** — untouched | 0 |
| 4 | The delivery is dropped. No cell captured, no claim consumed, no `beginTransition()`, no finalization | **still B's operation, cell B** | 0 |
| 5 | **B's genuine callback** arrives, pre-matches record B, is ingested, admitted, and exchanged | B's operation, cell B | **1** |

**Total: exactly one exchange, and B's visible result is B's own.** The second safety layer
is independent: had A's callback somehow been ingested, `decideOAuthIntake`'s selector
comparison against the *persisted* attempt would answer branch D, and step 4 of §6.4 (iii)
would finalize only the record it was addressed to.

### The ownership-interleaving traces

These are the cases the live witness exists for. In each, A's delivery **was** addressed to a
real record of A's, so addressing alone does not settle them.

**Trace W1 — A's snapshot is pending when B begins, before B persists anything.**

| Step | What happens | Authoritative operation / cell | Exchanges |
| --- | --- | --- | --- |
| 1 | A's callback is ingested into record A. The continuation **carries A's own `TransitionContext`** (warm case) and begins `loadDurableSnapshot()` | A's continuation (owns nothing yet), cell A | 0 |
| 2 | **B begins.** `startGoogleSignIn`'s first statement claims the slot. **No barrier, no attempt persisted yet** | B's operation | 0 |
| 3 | A's snapshot read returns — still describing A, because B has persisted nothing. `decideOAuthIntake` answers `admit_continuation` for A | B's operation | 0 |
| 4 | A reaches the handoff. **`ownsOperation(attemptContextA)` is false** — B claimed the slot. A **aborts without claiming**: no `beginTransition()`, no generation bump, no write | **B's operation, unaffected** | 0 |
| 5 | A finalizes **cell A only**, drops record A, reports `correlation_changed` | B's operation | 0 |

**A durable attempt-id comparison would have passed at step 3**, which is precisely why the
witness is required and why revalidation after claiming is not sufficient on its own.

**Trace W2 — A is admitted and claims; B begins afterwards.**

| Step | What happens | Authoritative operation / cell | Exchanges |
| --- | --- | --- | --- |
| 1–3 | As W1, but the witness is **unchanged** at the handoff, so A claims the slot and bumps the generation | A's continuation, cell A | 0 |
| 4 | **B begins** and supersedes A's operation | B's operation | 0 |
| 5 | A's post-claim revalidation / C3 / C7 fail — `ownsOperation` is false, and the epoch moved. A writes no resolution and returns no ready gate | B's operation | **0 or 1**, see below |
| 6 | A finalizes **cell A only** — never cell B — and releases its secret | B's operation, cell B intact | — |

Whether A's exchange had already been issued when B began decides step 5's count: **at most
one**, A's, and it can never produce a grant, because C7 and `stillCurrent` block the
resolution. If B's arming revoked A's unread claim first, A's exchange fails closed instead.
**In neither trace does A finalize cell B or overwrite B's visible result.**

## 6.5 Team invitation and admin-request links

`${APP_ORIGIN}/?inviteToken=…` is an ordinary HTTPS URL. Under Option 1, on the same domain,
the OS routes it to the app when installed and to the Web app otherwise — **no change to the
server, the email, or the token**.

Both kinds of link arrive through the same OS delivery event, so a delivery must be
**routed by destination before anything is touched** (§6.4 ii step 1): an identity callback
continues to selector addressing; a Team link goes to the pending-intent path. A Team link
therefore **never reaches a capture cell**, never consumes an arming record's single claim,
and never finalizes one — which is what §6.9 B7 exists to prove. Note
`captureCurrentDeepLinkIntent()` currently reads `window.location.href` and rewrites history;
the native path supplies a URL and performs no history rewrite, so it needs the same
URL-parameter seam.

If P4 leaves the domain unresolved, invitation links keep working exactly as today, in the
Web app. That is an acceptable M1/M2 state and must be **stated to the user**, not silently
degraded.

## 6.6 Bootstrap delivery, duplicate delivery, and callback-secret lifetime

### No raw-URL replay ledger

**Duplicates are answered by non-secret state and by exact-cell semantics, never by
remembering URLs.** Retaining "the last URL ingested" would hold a live authorization code
outside the one construct designed to own it, with no defined lifetime, and a one-slot string
comparison does not survive interleaving anyway. Instead, two mechanisms, each sufficient alone:

1. **The record's `consumption` axis.** A record accepts ingestion only while `empty`. Any
   later delivery bearing the same `flowId` finds `captured`, `claimed` or `finalized` and is
   dropped (§6.4 ii) — **independently of its binding**, so a duplicate arriving *during*
   reconstruction, *immediately after* binding, or *during* the exchange is dropped by the same
   rule and starts no second continuation.
2. **Exact-cell single-claim semantics, which already exist.** `claimCallbackForExchange()`
   transfers the code out and every later call answers `no_claim`; `readAuthorizationCode()`
   yields the code once and `null` afterwards; a finalized cell returns `no_return` and never
   rereads. A duplicate that somehow reached the cell would therefore reach **no provider** —
   and branch E independently rejects a replay against an already-correlated resolution.

Mechanism 1 keeps the **reported outcome** truthful; mechanism 2 is the security property and
does not depend on it.

### The bootstrap boundary

A native process has two possible sources for the same callback — the launch URL and the
`appUrlOpen` event — and **neither is guaranteed to fire**. Making record creation conditional
on `getLaunchUrl()` returning something would drop a legitimate event-only return.

**The boundary is explicit.** In the **steady state**, an unmatched delivery is dropped
(§6.4 ii). **Provisional capture exists only for the bootstrap case**, defined as: *a delivery
whose selector matches no record, arriving while this process has not yet established whether a
durable attempt with that selector exists.* Nothing else may create a record from an unmatched
delivery.

**Proposal:** one **bootstrap delivery owner**, created at the guarded lifecycle boundary.

**Step 1 — synchronous entry, before any `await`.** Register the `appUrlOpen` listener, read
`getLaunchUrl()`, and **sample the entry witness** (§6.4 iii) that every cold continuation will
carry. Neither source is privileged.

**Step 2 — classify on arrival.** Destination and field validation and `classifyCallbackUrl`
are pure and synchronous (§6.4 ii steps 1–3), so a delivery never waits to be classified. A
selector-less shape is reported and dropped and **creates nothing** — it must never occupy
capture state that a legitimate callback needs.

**Step 3 — the secret goes straight into a cell.** An unmatched, selector-bearing delivery
creates a record with `binding: "provisional"`, keyed by its `flowId`, and is ingested at once,
moving `consumption` to `captured`. The code is therefore held by the construct that already
guarantees single-claim, single-read and revocation-on-finalize — **there is no separate
buffer**.

**Bounded, with one guarantee and one honest limitation.** Distinct selectors get distinct
provisional records, up to a small explicit cap; the cap is fail-closed, and a delivery beyond
it is dropped and reported. There is deliberately **no "at most one provisional record" rule** —
collapsing to one slot would force a guess, and the resolution below needs none.

- **Guaranteed:** an unrelated delivery **never evicts or finalizes a record that has already
  been accepted**, because records are keyed by selector and nothing replaces a record
  belonging to a different selector. A legitimate callback that has already been captured is
  safe.
- **Not guaranteed — stated plainly:** the cap is a shared resource consumed in arrival order,
  so **unrelated deliveries arriving *first* can exhaust it and cause a later legitimate
  callback to be dropped.** "Never blocks a legitimate delivery" would be false, and it is not
  claimed. Distinct records solve eviction; they do not solve pre-arrival exhaustion.

**This residual exposure is bounded but real, and closing it is M2 work, not a solved
problem here.** No overflow algorithm and no user-facing recovery is proposed or approved by
this document. **M2 must decide and justify**, then meet §6.9's acceptance:

1. **Overflow handling** — what happens to a selector-bearing delivery that arrives when the
   cap is full. It must remain fail-closed (dropped and reported, never silently replacing an
   accepted record), and the choice must be justified rather than assumed.
2. **Bounded cleanup** — provisional records must not accumulate for the life of the process.
   Binding (step 4) releases them, but a provisional record whose binding never resolves needs
   a defined, bounded end that finalizes its cell and releases its secret.
3. **Recovery** — a user whose callback was dropped by overflow must be able to reach a
   successful sign-in, and the design must say how. **Whether anything is shown to them, and
   what, is a product decision this document does not make** — it is adjacent to P7 and is
   equally not decided here.

The exposure is also narrow by construction: only **selector-bearing** deliveries to the
**configured callback destination** (§6.4 ii) can consume the cap at all, and only during the
bootstrap window, which is one durable read long.

**Step 4 — binding resolves each provisional record.** A durable read determines which selector,
if any, is eligible: the stored attempt must be a **Google** attempt whose `flowId` equals the
record's, whose `barrierId` equals the **current** barrier's, under a **cleanly unresolved**
barrier. These are the conditions `decideOAuthIntake` requires for branch B, so a **cancelled**,
**superseded** or **completed** attempt is ineligible by construction and is never resurrected.

- Eligible → `binding` becomes `bound` and `attemptId` is filled in. **`consumption` is
  untouched** — the record stays `captured`, and binding never re-opens it for ingestion.
- Not eligible → `binding` becomes `released`; the cell is **finalized** and its secret
  released; the delivery is reported unowned.

**Binding is a gate, not an admission decision.** `decideOAuthIntake` still decides, against a
freshly read snapshot, inside the continuation.

**No indefinitely stale snapshot.** The entry-time durable read serves only deliveries present
at bootstrap. **Every later unmatched delivery triggers its own fresh durable read**, so an
event-only callback arriving long after an initially empty bootstrap is resolved against
current state, not a cached one. Each such delivery also samples its **own** entry witness
before that read, so its ownership evidence spans its own asynchronous path.

**Step 5 — the continuation runs** exactly as §6.4 (iii), carrying the evidence established at
its own entry. A supersession occurring **during reconstruction** therefore fails the handoff
check, because the evidence predates the reconstruction rather than being sampled after it.

| Delivery ordering | What happens | Authoritative owner | Exchanges |
| --- | --- | --- | --- |
| Launch URL only | Classified → provisional → bound if eligible → continuation | the bound attempt's operation | at most 1 |
| **Event only, no launch URL** | Identical; record creation never depended on the launch URL | same | at most 1 |
| Event during the durable read | Captured in its provisional cell, resolved when the read completes | same | at most 1 |
| Launch URL then event, or event then launch URL (same callback) | The second finds `consumption` non-`empty` and is dropped. Order is irrelevant — the key is the selector and the consumption axis | same | at most 1 |
| **Event long after an initially empty bootstrap** | Its own fresh durable read and its own entry witness | same | at most 1 |
| Supersession or cancellation at any point after entry | The carried evidence fails at the handoff; the continuation aborts, finalizes **its own** cell, claims nothing | the newer transition | 0 |

**At most one provider exchange per accepted attempt**, no secret-bearing replay ledger, and no
new identity authority.

### Lifetime of raw callback material

| Material | Where it may live | When it is released |
| --- | --- | --- |
| The delivered URL string | A **local variable**, synchronously, through destination validation → field validation → classification → ingestion. This stays synchronous because classification never waits | When that call returns. **Never** assigned to runtime state, a record field, a log, an analytics event, or an error message |
| The classification result carrying `authorizationCode` | Handed **directly** into the owning cell's ingestion call | Immediately. `classifyCallbackUrl`'s success shape carries the code, so this value is secret-bearing and must not be retained, spread, serialized or returned to a caller |
| The code inside a cell — **including a `provisional` record's cell** | The cell's own slot, then the single claim's closure. **There is no separate pending-delivery buffer**: a delivery awaiting binding waits inside a real capture cell, which is why "waiting asynchronously" and "raw material is only synchronous" are both true | On the single `readAuthorizationCode()`, or on `finalizeTerminalCallbackOutcome()`, which revokes an issued-but-unread claim |
| The selector `flowId` | The record and the persisted attempt | Non-secret. Retained deliberately; it is what addressing compares |

**Release is obligatory on every terminal, release and supersession path**, and each one
finalizes **only the record it owns**: a non-admitted branch (§6.4 iii step 4); an aborted
ownership handoff (step 6); a failed durable revalidation (step 7); every exit of the admitted
continuation, success or failure (§6.4 iv); a `released` binding; explicit cancellation (§6.7);
sign-out; and the replacement of an attempt's record by a newer attempt.

**Nothing may persist or log a callback secret** — ADR-0025 §G's existing rule, unwidened.

### Startup / continuation scheduling — an explicit M2 design gate, not a solved mechanism

**This document does not claim to have solved this, and the previously stated arbitration was
wrong.** Assigning startup and a continuation *separate cells* does not stop them contending for
the **one** coordinator ownership slot: `startUp()` calls `beginTransition()` immediately, which
supersedes whatever held it. A rule of the form "startup proceeds to Phase A while a callback is
pending" is worse than incomplete — it is **incorrect**. `evaluateDurablePreflight` returns
`quarantined` for a valid barrier with no resolution, which is exactly the state of a pending
Google attempt, so such a startup would emit `quarantined_locked` **and could overwrite the
continuation's newer visible result**, while the current code's fail-closed design correctly
never reaches `restoreSession()` in that state.

Resolving this means changing `startUp()`'s unconditional ownership claim, which is ADR-0025
structure and cannot be settled from a document. **It is therefore a named Stage M2 design
gate.** M1 does not depend on it.

**Invariants any accepted mechanism must satisfy:**

1. **Startup must not invalidate an already-owned callback continuation merely by beginning.**
2. **A callback arriving while startup is in progress has a defined handoff** — not only the
   cases strictly before startup or strictly after it completes.
3. **Startup must not overwrite a callback continuation's newer visible result.**
4. **The durable preflight is preserved**: an unresolved correlation set never proceeds
   unconditionally to provider session restoration, and no path may reach `restoreSession()`
   that the current code would fail closed on.
5. **Startup stays single-run.** No phase is re-executed per callback, and `startUpOnce()` is
   neither reset nor re-entered.
6. **At most one exchange per accepted attempt**, and exact-cell cleanup on every path.

**Acceptance for the gate** is §6.9's three rows marked **GATE**. The gate is closed when a mechanism satisfying
1–6 is designed against the real coordinator, reviewed, and recorded in the ADR amendment
(§6.8) — **not** when a plausible ordering is written down.

## 6.7 Dismissal, explicit cancellation, retry, sign-out and account switching

These are the cases a browser never had to handle, because the page went away. **Dismissal
and cancellation are different events and must not be conflated**: describing only dismissal
and retry leaves "cancel" undefined, and retry alone cannot make a cancelled attempt's late
callback inadmissible.

### Dismissal is ambiguous and is never, by itself, an authentication failure

The authentication browser may report only that its sheet closed. `@capacitor/browser`'s
`browserFinished` does not distinguish "the user gave up" from "the flow completed and the
sheet closed", and the plugin has not been selected (§6.3). **A dismissal signal therefore
must not finalize an attempt, revoke a cell, or be reported as a failed sign-in.** The
attempt stays live, and a callback that arrives moments later is still admissible — which is
exactly the case a dismissal-as-failure rule would break.

### Explicit cancellation is a distinct, attempt-bound operation

**Requirement:** cancelling A must make A's later callback inadmissible **even when the user
never retries**. Retry alone cannot supply this, because without a retry there is no newer
attempt to out-correlate A.

**Two existing constraints shape the mechanism.**

`interactiveAttemptRepository.cleanUpNonCurrentAttempt()` **refuses** to remove an attempt
bound to the current barrier — *"removing it would make the current correlation set
unverifiable"* — and ADR-0025 §7 states the current attempt is not removed. **Cancellation may
not delete the current attempt.** It makes the attempt *non-current* instead, using machinery
that already exists.

And cancellation faces **exactly the ownership hazard of §6.4 (iii)**: it reads durable state
asynchronously, then mutates. A stored attempt-id comparison proves only that A was current at
the moment of the read — it cannot see a B that has claimed the live slot but persisted
nothing. A delayed cancel must therefore not be allowed to supersede such a B.

**Proposed `cancelInteractiveAttempt(attemptId)`:**

1. **Establish the ownership evidence synchronously, before the first `await`** (§6.4 iii).
   Cancellation always targets an attempt started in this process, so this is the **warm**
   case: it carries **A's own `TransitionContext`**. Claim nothing.
2. In a serialized section, read the current attempt. **If its `attemptId` is not the one being
   cancelled, do nothing and report `not_current`.** If B has already persisted its replacement,
   cancelling A is a no-op.
3. **The conditional cancellation handoff.** Check the carried evidence —
   `ownsOperation(attemptContextA)` — and claim the slot **in one synchronous step with no
   `await` between them**. If A no longer owns the slot — a newer deliberate transition began,
   *including one whose attempt is not yet persisted* — **abort without claiming and report
   `not_current`.** Nothing is superseded and no barrier is written.
4. **Guarded durable barrier operation.** Only now, as the owning operation, establish a fresh
   barrier through the existing `establishBarrier` path, which writes a new `barrierId` and
   bumps the live generation. A's persisted attempt is thereby bound to a **previous** barrier.
5. Best-effort `cleanUpNonCurrentAttempt(newBarrierId)` — now **permitted**, because A's attempt
   is no longer the current barrier's.
6. Finalize and drop **A's** record only, releasing any retained candidate and revoking any
   unread claim.

**Why a later callback for A is then inadmissible, with no new rule invented:**
`decideOAuthIntake` sees either no usable attempt (**branch G**) or an attempt whose
`barrierId !== barrier.barrierId` (**branch D**). Both are `unowned_callback`: **zero exchanges,
no resolution, and any newer valid attempt left intact.** The existing branch table supplies the
whole answer.

**Establishing a barrier is not a local act** — it bumps the live generation and supersedes
in-flight operations. That is correct for a user deliberately abandoning an authentication, and
steps 2 and 3 together mean it happens only when A is still both the durable *and* the live
current attempt.

#### If the cancellation barrier cannot be persisted

`establishBarrier` reports `{ ok: false }` when the barrier write fails. Cancellation must then
**report failure honestly and must not claim a durable cancellation happened**:

- **Report a distinct outcome** — `cancellation_not_persisted` — never success and never
  `not_current`, which would mean something different and equally untrue.
- **Do not run step 5.** Removing A's attempt without a new barrier would delete the *current*
  attempt, which is exactly what ADR-0025 §7 and the repository forbid.
- **A's attempt remains current and therefore remains admissible.** A later callback for A can
  still be admitted. The UI must not say the attempt was cancelled.
- **Step 6 still runs**, because it is local hygiene: A's in-process record is finalized and its
  secret released. That is honest — it destroys this process's copy of the material — and it is
  **not** a durable cancellation. On native the bootstrap owner could still reconstruct a record
  for A from the unchanged durable state on a later launch (§6.6), which is the correct
  consequence of a cancellation that did not persist.
- The gate stays locked and offers a retry; a successful retry supersedes A durably by the
  ordinary path.

> **Unresolved product decision — P7 (§4).** *What the gate offers after an ambiguous dismissal* —
> a visible "Cancel sign-in" control, an automatic timeout, or nothing but "try again" — is a
> product and UX choice, not an architectural one. The seam above is what any of those answers
> would call, and it does not block M1. **This document does not choose**, and §6.9's cancellation
> cases test the seam rather than a particular UI. Until it is answered, an implementation must not
> present an incomplete flow as complete.

### Retry

A retry is an ordinary new `startGoogleSignIn`: a new barrier, a new attempt, a new `flowId`,
and a **new** arming record whose creation finalizes and drops its predecessor. **It cannot
revive an old cell** — there is no operation anywhere that un-finalizes one — and the old
attempt is out-correlated by the durable comparison regardless.

### Two sequential successful sign-ins in one WebView lifetime

Each `startGoogleSignIn` establishes its own barrier, persists its own attempt, and creates
its own arming record and cell. Nothing from the first participates in the second; no claim
crosses between them.

### Sign-out

Sign-out establishes a barrier with origin `explicit_sign_out`, so the retired attempt becomes
non-current by **exactly the same mechanism as cancellation** — branch D or G for any late
callback, zero exchanges, and no restoration of the retired attempt. Sign-out must also
finalize and drop any arming record, so no cell outlives the identity it belonged to. The next
sign-in is an ordinary new attempt; `startUpOnce()`'s cached promise is irrelevant, because the
warm continuation is not `startUpOnce()`.

### Account switching

Unchanged and already correct: `AuthenticatedSportingPersistence` keys
`ProfileScopedSportingPersistence` on `profileId`, forcing a complete repository and
application-state remount, and the Profile-scoped adapter is immutable with no mutable
current-Profile pointer, so a delayed write from the previous Profile keeps that Profile's
physical key.

## 6.8 Required ADR amendment (proposal)

ADR-0025's callback model assumes a full-page redirect and a document-scoped capture. The
native design changes **scope and binding, not admission rules**. An ADR amendment authored in
Stage M2 must record:

1. Capture scope becomes **one arming record per authentication attempt** on native, addressed
   by its non-secret `flowId`; page-scoped on Web.
2. A **warm continuation** performs Phase 0 without Phase A. It claims the ownership slot
   **only through a conditional handoff**, checked and claimed **synchronously with no
   intervening `await`**. The evidence it checks is **established before the first `await` of
   its whole path and carried, never re-sampled**, and it differs by case (§6.4 iii):
   a **warm** continuation carries **the attempt's own `TransitionContext`** — the ownership
   `startGoogleSignIn` already claimed — and checks `ownsOperation(attemptContext)`, which is a
   real ownership proof; a **cold** continuation carries evidence sampled **before
   reconstruction begins**, because starting from an unclaimed slot that is the needed proof.
   **A single freshly sampled witness for both cases is not acceptable**: sampled after an
   asynchronous step it proves nothing about that step. Durable revalidation and the named
   checkpoints remain in force as a **separate** protection, not a substitute.
2b. A **read-only witness over the operation counter** is a new required seam for the **cold**
   case: `beginTransition()` is currently its only accessor and it mutates. `liveGeneration`
   cannot serve, because it is bumped inside `establishBarrier` and so does not yet exist
   during the interval a newly-started attempt owns the live slot with nothing persisted.
2c. **`cancelInteractiveAttempt` uses the same conditional handoff** before establishing its
   barrier, and reports a distinct `cancellation_not_persisted` outcome when the barrier write
   fails — never a false durable cancellation.
2d. A **bootstrap delivery owner** creates and binds records from eligible durable state
   **independently of whether a launch URL exists**, with **binding and consumption as two
   independent axes** so that binding never re-opens already-ingested material.
2e. **Startup / continuation scheduling is recorded as an open design gate, not a decision.**
   The amendment must state the six invariants in §6.6 and that `startUp()`'s unconditional
   `beginTransition()` is what has to change, without prescribing a mechanism until one is
   designed against the coordinator and reviewed.
3. **`consumeAdmittedContinuation` gains an explicit ownership binding** — it takes the cell
   it owns rather than reading the coordinator's closure — so that a delayed continuation can
   never finalize a replacement cell. Its epoch bump, C3 checkpoint, single claim, exchange
   against `expectedFlowId` and unconditional self-finalization are all preserved.
4. The live-generation bump can now supersede an operation in the *same* document.
5. The callback destination is **configured** and validated by scheme/host/path — with, if
   §6.2 Option 2 is chosen, the explicit non-`origin` predicate.
6. Delivered-URL ingestion is destination-validated, field-validated and **selector-addressed**
   before any cell is touched, and this addressing **can only drop, never admit**.
7. **Explicit cancellation** makes an attempt non-current by establishing a fresh barrier —
   never by removing a current attempt, which `cleanUpNonCurrentAttempt` refuses and ADR-0025
   §7 forbids.
8. **No raw callback URL or authorization code is retained** for deduplication or for any other
   purpose; duplicates are answered by non-secret record state and by exact-cell single-claim
   semantics.

**None of this is approved by this document.** It is what Stage M2 must author and have
reviewed.

## 6.9 Required design acceptance cases

**These are required future implementation tests. None was executed during this documentation
pass**, and this document has run no application test, build or device check. This table is
the single authoritative list; §11 only cross-references its identifiers.

**Three rows are marked GATE.** They state what the §6.6 startup/continuation design gate must
satisfy. **No mechanism for them is specified anywhere in this document**, and their
"authoritative operation" column reads *undecided* on purpose — writing a plausible ordering
there would be the exact error this section exists to avoid.

Each must be an automated test where the seams allow, and a device check otherwise.
"Exchanges" counts calls that reach the provider's token endpoint.

| # | Scenario | Authoritative operation / cell afterwards | Exchanges | Required outcome |
| --- | --- | --- | --- | --- |
| **B1** | Warm callback after a completed ordinary startup | the Google attempt's operation and cell | **1** | Startup finalized its own cell and reported no return. The attempt's record ingests, admits and exchanges once. `startUpOnce()`'s settled promise is neither consulted nor re-run |
| **B2** | **A → retry B → late callback for A → valid callback for B** | **B's operation, cell B**, throughout | **1** (B's) | A's late delivery pre-matches nothing (record A dropped, `flowId` differs), so no cell is captured, no claim consumed, **no `beginTransition()`**, and B's result is not overwritten. B then exchanges normally. Independently, had it been ingested, branch D would answer `unowned_callback` |
| **B3** | **A admitted → asynchronous work pending → B supersedes A → A completes** | **B's operation**; cell A is A's to finalize | **at most 1**, A's, and it may fail closed | A's continuation finalizes **cell A only** and never cell B. Its post-claim revalidation (§6.4 iii step 7), `stillCurrent` and C3/C7 stop it writing a resolution or returning ready. If B's arming revoked A's unread claim, A's exchange fails closed rather than proceeding |
| **B4** | **Explicit cancel A → no retry → late callback for A** | no operation; no live record | **0** | Cancellation established a fresh barrier, so A's attempt is non-current. The late callback resolves branch **D or G** — `unowned_callback`. Nothing is exchanged, nothing resolved, and the current attempt was **not** deleted |
| **B5** | **Delayed cancellation of A after B has replaced it** | **B's operation, cell B** | **0** from the cancel | `cancelInteractiveAttempt(A)` finds the current attempt is B, does nothing, and reports so. **B is not revoked**, no barrier is established, cell B is untouched |
| **B6** | **Sign-out → late callback from the retired attempt** | no operation; no live record | **0** | The `explicit_sign_out` barrier made the attempt non-current: branch D or G. The retired attempt is not restored, and no arming record outlived the identity |
| **B7** | **Interleaved stale, malformed and Team-link deliveries while B's record is live and `empty`** | **B's operation, cell B**, unchanged throughout | **1** (B's, at the end) | Each non-matching delivery is dropped at addressing: stale selector → no match; `malformed_callback`/`ambiguous_callback` → unaddressable, dropped and separately reported, **never ingested into whichever record happens to be armed**; Team link → routed to the pending-intent path. Cell B is not captured, claimed or finalized by any of them, and B's own callback still succeeds |
| **B8** | **Two sequential successful sign-ins in one WebView lifetime** | each attempt's own operation and cell in turn | **2** (one each) | Distinct barriers, attempts, `flowId`s, records and cells. No claim crosses between them; the first record is finalized and never reused |
| **B9** | **Exact-cell cleanup and at most one exchange per accepted attempt** | the operation that owns each cell | **at most 1 per accepted attempt** | After **every** terminal path — admitted success, admitted failure, non-admitted branch, aborted ownership handoff, failed revalidation, `released` binding, cancellation, `cancellation_not_persisted`, sign-out and supersession — the owned scope holds **no retained raw callback URL, no candidate authorization code and no unread usable claim**. A delayed completion, abort, cancellation or supersession cleanup finalizes **only its own cell**, asserted against the specific cell instance rather than a flag, under every interleaving in B17–B20 and B24. No accepted attempt ever reaches the provider's token endpoint twice |
| **B10** | Correctly-shaped callback delivered to the **wrong destination** | unchanged | **0** | Rejected at step 1 of §6.4 (ii). Not classified, not ingested, no claim consumed, the live attempt untouched |
| **B11** | **Valid HTTPS callback path** | the addressed attempt's operation and cell | **1** | Full success through the **unmodified** `isUsableUrl` / `isValidRedirectTarget` / `validateAuthorizationUrl` |
| **B12** | **Custom-scheme callback** | unchanged, or the addressed record under Option 2 | **0** under Option 1 | Option 1: rejected, and the rejection is proven to come from `isUsableUrl`'s scheme check, **not** from an origin comparison. Option 2: accepted only when scheme, host and path all equal the configured values, with an explicit test that a *different* custom-scheme URL is rejected — i.e. that opaque-origin equality is not what admits it |
| **B13** | **Malformed / ambiguous / implicit-grant fragment** | unchanged | **0** | `malformed_callback` / `ambiguous_callback`; no identity. An owned implicit-grant fragment is never turned into a session |
| **B14** | **Replayed callback against an existing correlated resolution** | unchanged | **0** | Branch E. The existing resolved set is **not** invalidated |
| **B15** | **App killed mid-authentication; the callback opens it cold** | the reconstructed record's operation and cell | **at most 1** | Either a correct cold exchange or a clean failure — never a partially-established identity, and never two owners for the one continuation. **The ownership half of this is part of the §6.6 design gate** |
| **B16** | **Web regression** | unchanged | as today | Every existing identity test passes unchanged. The Web path still uses the page-scoped cell and `startUp()`-driven Phase 0, and `consumeAdmittedContinuation`'s new binding receives that same cell |
| **B17** | **A's snapshot pending → B begins before persisting its attempt → A resumes** (trace W1) | **B's operation**, unaffected; cell A is A's to finalize | **0** | A's durable read still describes A and `decideOAuthIntake` admits — yet the carried **`ownsOperation(attemptContextA)` check fails at the handoff**, so A **does not call `beginTransition()`**, does not bump the generation, does not write, and does not touch cell B. A finalizes cell A and reports `correlation_changed`. The test must fail if a durable attempt-id comparison alone is what gates the claim |
| **B18** | **A admitted → A claims → B begins → A reaches its post-claim revalidation** (trace W2) | **B's operation**; cell A is A's to finalize | **at most 1**, A's, and it can never produce a grant | A's revalidation, `stillCurrent` and C3/C7 block the resolution and any ready gate. A finalizes **cell A only** |
| **B19** | **Cancel A pending → B begins before persisting its attempt → cancel resumes** | **B's operation**, unaffected | **0** | A no longer owns the slot, so the carried `ownsOperation(attemptContextA)` check fails at the handoff: it **aborts without claiming**, writes **no barrier**, and reports `not_current`. **B is not superseded**, and B's cell and result are untouched |
| **B20** | **Cancellation barrier cannot be persisted** | no operation claims a grant; A's attempt stays current | **0** | Reported as `cancellation_not_persisted` — never as success and never as `not_current`. `cleanUpNonCurrentAttempt` is **not** run, so the current attempt is not deleted. A's local record is finalized (secret released), and the UI must not state that the attempt was cancelled. A later callback for A may still be admissible |
| **B21** | **Cold bootstrap delivery in every ordering** — launch URL only; **event only with no launch URL**; event arriving during the durable read; **event long after an initially empty bootstrap** | the bound attempt's operation and cell | **at most 1** each | Record creation never depends on `getLaunchUrl()` returning a value. A late event-only delivery resolves against **its own fresh durable read**, never a cached bootstrap snapshot, and samples **its own entry witness** before that read |
| **B22** | **Duplicate delivery before binding, after binding, and during the exchange** | the bound attempt's operation and cell | **1** | Dropped by the `consumption` axis in all three cases, **independently of `binding`** — already-ingested material is never eligible for a second ingestion, and **no second continuation starts**. Verified with **no URL comparison**. Both duplicate orderings (launch-then-event, event-then-launch) behave identically |
| **B23** | **Two different `flowId`s during reconstruction, a selector-less delivery, and cap overflow** | the eligible attempt's operation and cell, if any | **at most 1** | Distinct selectors get distinct provisional records; **neither evicts nor finalizes the other**, and nothing guesses which is eligible. Binding promotes at most one and **releases and finalizes the rest**. A `malformed_callback`/`ambiguous_callback` delivery **creates no record at all**. **Overflow is tested as a real limitation, not as an impossibility:** with the cap already full, a later legitimate callback **is dropped**, and the test must assert the fail-closed behaviour (dropped and reported, never replacing an accepted record) together with M2's chosen **bounded cleanup** of unresolved provisional records and its **recovery** path to a successful sign-in |
| **B24** | **Supersession during reconstruction, before the continuation starts** | **the newer transition**; the provisional cell is the continuation's to finalize | **0** | The evidence carried into the handoff was established **before** the durable read, so the intervening transition is detected and the continuation aborts, finalizing **its own** cell. **The test must fail if the implementation samples its witness after reconstruction** — such a sample would pass and the supersession would go undetected |
| **B25** | **Binding finds no eligible attempt** (cancelled, superseded, or already resolved) | no operation; no bound record | **0** | No record is promoted — a cancelled, superseded or completed attempt is **never resurrected** — and the provisional cell is finalized with its secret released |
| **B26** | **GATE — a callback arrives while startup is in progress** | **undecided; this is the §6.6 design gate** | **at most 1** | There must be a **defined handoff**, not only the cases strictly before or strictly after startup. Exactly one of startup and the continuation may own the slot at a time, and the callback's material must survive the wait inside its own cell. **No mechanism is specified in this document** |
| **B27** | **GATE — startup begins while a callback continuation is already owned** | **undecided; §6.6 design gate** | **at most 1** | Startup **must not invalidate the continuation merely by beginning**, and **must not overwrite its newer visible result**. Satisfying this requires changing `startUp()`'s unconditional `beginTransition()`, which is ADR-0025 structure |
| **B28** | **GATE — unresolved durable state performs no inappropriate session restoration** | **undecided; §6.6 design gate** | **0** | A valid barrier with no resolution — the state of a pending Google attempt — must never proceed to provider session restoration. `evaluateDurablePreflight` returns `quarantined` there today and the current code fails closed before `restoreSession()`; **no proposed scheduling may reach `restoreSession()` on a path the current code fails closed on** |

# 7. Data, synchronisation and offline operation (Boundary C)

**The existing cloud backbone and restore paths are reused.** Sporting data is **not**
local-only: archived training sessions and terminal assessment runs are cloud-authoritative
for Free (ADR-0027), and Team exercise results have their own athlete-owned cloud projection
(ADR-0037/0039). Do not describe this system as local-only.

**The existing Web backend is unchanged by everything in this section.**

## 7.1 Native storage durability is a design problem, not a test result

**Native `localStorage` durability is not a seven-day/quota question that a device test can
settle.** The primary documentation is explicit.

Capacitor's storage guide
(<https://capacitorjs.com/docs/guides/storage>) states that LocalStorage **"must be
considered transient"** because **"the OS will reclaim local storage from Web Views if a
device is running low on space"**, notes the same risk for IndexedDB on iOS, and recommends
the Preferences API or a SQLite plugin for data that must not be lost. On Android the
persisted-storage API can protect IndexedDB from eviction; no equivalent is documented for
iOS.

**Consequences, stated plainly:**

- **A successful one-week device test is scoped evidence, not a durability guarantee.** It
  shows that eviction did not occur on that device, in that week, under that storage
  pressure. Eviction is triggered by device conditions the test does not control.
- **This is an acceptance and design issue that must be settled before the first usable
  offline milestone can be claimed** (§10 M3), not a risk to discover afterwards.
- It also reaches **identity and the provider session.** The Supabase client stores its
  session and PKCE verifier in `localStorage` by default, and the five identity
  repositories bind `localStorageAdapter` through their module-level singletons. Eviction
  would sign the user out, not merely lose sporting data.

### What is at risk, and what is not

| | Exposure to WebView eviction |
| --- | --- |
| **Archived training sessions, terminal assessment runs, owned Team results that have been successfully synchronised** | **Recoverable.** Cloud is authoritative; `restoreIntoLocalRepositories()` re-fetches and hash-verifies |
| **Local drafts, the current session, active Team drafts, training plans, profiles, preferences** | **Lost.** Nothing else holds them |
| **Records in the outbox, not yet synchronised** | **Lost, and lost silently** unless the design surfaces it. These are completed work the cloud has never seen |
| **Identity: trusted device record, barrier, attempt, resolution, provider session** | **Lost.** Recoverable only by signing in again, and only with a network |

**Cloud history restoration is not protection for local drafts and pending offline writes.**
The two must never be conflated.

### Supported options, for decision at the storage stage

**None of these is implemented by this correction pass, and no storage library, adapter or
database is added.** They are the options a dedicated stage must choose between.

| Option | What it means | Notes |
| --- | --- | --- |
| **A. Keep `localStorage`, accept the risk, make it visible** | No engine change. The app must surface unsynchronised work prominently and encourage connectivity before it matters | Cheapest. Accepts silent loss of drafts and pending writes under storage pressure. **Requires an explicit product decision to accept**, not a default |
| **B. A native `StorageAdapter` implementation behind the existing interface** | A new adapter backed by the Capacitor Preferences API or SQLite, selected per platform | **Recommended direction.** See below for why this is not a second authority |
| **C. Reduce exposure by synchronising more eagerly** | Shrink the window in which work exists only locally | Complementary to A or B, not a substitute — drafts are by definition not yet synchronisable |
| **D. Request persistent storage where available** | Android's persisted-storage API for IndexedDB | Partial, Android-only, and not applicable to `localStorage` |

### Why a native adapter is not a second authority or a parallel sync engine

This distinction is easy to get backwards, and it matters.

`StorageAdapter` (`src/lib/persistence/types.ts`) is a two-method, fully asynchronous,
string-keyed, string-valued interface that **never rejects**, and its own documentation
calls it *"the only component that knows about a specific browser storage mechanism."*
Replacing what sits behind it is the **sanctioned** extension point of ADR-0013, not a
departure from it.

Concretely, the surrounding structure is already engine-agnostic:

- `createProfileScopedSportingStorageAdapter(profileId, adapter = localStorageAdapter)` and
  `createProfileScopedSportingRepositories(profileId, adapter = localStorageAdapter)` both
  **take the base adapter as a parameter**. Profile scoping composes over any engine.
- `createSportingSyncStateRepository(adapter)` and the public-diagram resolver's
  `options.adapter` do the same.
- All five identity repositories expose `create…(adapter = localStorageAdapter)` factories;
  only the module-level singletons bind `localStorageAdapter`, and `identityRuntime.ts`
  imports those singletons. Swapping the engine there is a small, named, reviewable change.

So a native adapter changes **the engine**, while **authority** — which record is
authoritative, which repository owns it, which `Profile.id` scopes it, and how the outbox
drains — is untouched. There is **one** repository boundary, **one** Profile authority and
**one** sync engine before and after.

**Hard constraints on any such stage:**

- **No IndexedDB migration machinery is activated.** ADR-0015's adapter stays dormant;
  ADR-0016/0017/0018's copy-migration track stays retired. A native adapter is a different
  decision and needs its own ADR.
- **No parallel sync engine, and no second source of truth.**
- **The Web path keeps `localStorageAdapter` unchanged**, and the Web backend is untouched.
- Moving existing on-device data from one engine to another is itself a migration with
  integrity and failure semantics, and must be designed — not assumed to be a copy loop.
- If `BROWSER_AUTH_OPTIONS` gains an `auth.storage` entry for the provider session,
  `supabaseFlowCompatibility.test.ts` asserts that object **exactly equals** its current
  three keys, so that assertion is a deliberate, visible gate on the change.

**Open technical question that a device test *can* answer:** the practical storage ceiling
in each platform's WebView, once the 67 diagrams ship in the bundle rather than in the
data-URL cache. Measure it; do not assume it.

## 7.2 Per-domain matrix

Terminology used precisely below: **archived Training Sessions** and **terminal Assessment
Runs under the existing domain rules** are what the cloud backbone carries, and **only
records that have actually synchronised successfully** are available from it. A record
sitting in the outbox is *eligible* but **not yet available**, and remains dependent on its
original device until it synchronises or is explicitly transferred.

| Domain | Current authority | Local representation | Available from cloud on a fresh install | Migration implication |
| --- | --- | --- | --- | --- |
| **Archived training sessions** | **Cloud** once synchronised (`training_session`, hash-verified) | session history key | **Yes, if synchronised** | None for synchronised records |
| **Terminal assessment runs** | **Cloud** once synchronised (`assessment_run`, hash-verified) | assessment history key | **Yes, if synchronised** | None for synchronised records |
| **Sync outbox (eligible but not yet synchronised)** | **Local only** | cloud sync state key | **No** | **Completed work the cloud has never seen.** Depends on the original device. Must be visible to the user before they rely on a new device |
| **Current training session (in progress)** | **Local only** | current-session key | **No** | Not yet archived, so not yet cloud-eligible. **P2** |
| **`Session.captureSequence` (an active Capture Sequence)** | **Local, and genuinely persisted** — see 7.3 | inside the current-session key | **No** | It is persisted and restorable **on the same device**. Cross-device continuation is a **separate, unapproved** question. **P2** |
| **Blind Weight draft** | **In-memory React state** — see 7.3 | none | **No** | Genuinely transient. Lost on reload today, on every platform |
| **Assessment draft (active run)** | **Local only** (ADR-0021 draft/history split) | assessment draft key | **No** | **P2** |
| **Active Team exercise draft** | **Local** (ADR-0035, schema 4+) | cloud sync state key | **No** | **P2** |
| **Owned Team exercise results** | **Cloud**, athlete-owned (ADR-0037/0039) | cached in the sync state record (schema 5/6) | **Yes** — `refreshMyTeamExerciseResults()` | None |
| **Team eligibility cache** | **Cloud** (derived) | sync state record | **Yes** — refreshed online | None. Offline-first read only |
| **Training plans** | **Local only** | training plans key | **No** | Authored content. **P2** — whether it should transfer is a **recommendation, not a requirement**; see 7.5 |
| **Accuracy tolerance profiles** | **Local only** | its own key | **No** | Authored content. **P2**, same status |
| **Smart Random profiles** | **Local only** | its own key | **No** | Authored content. **P2**, same status |
| **History filters** | **Local only**, a preference | its own key | **No** | Regenerated by use. **Recommendation only** that it need not transfer |
| **Assessment preferences** (intro shown, last threshold) | **Local only**, preferences | three keys | **No** | **Recommendation only** that they need not transfer |
| **Identity: barrier, attempt, resolution, trusted device, pending intent** | **Local**, identity-scoped | identity keys | **No** — re-established by signing in | None |
| **Public exercise diagrams** | **Bundled** (and cached) | `curling-performance-public-exercise-diagram-v1.*` | **N/A** — shipped in the app | The `localStorage` cache becomes redundant on native (§3.4) |

**"Not worth transferring" is a recommendation in this document, never an approved product
requirement.** P2 owns every row marked P2, and the preference rows too if the user wants
them in scope.

## 7.3 Capture Sequence state is persisted, not transient

**The active Capture Sequence is not in-memory, and describing it as inherently
non-transferable would be wrong.** Verified in the working tree:

- `Session.captureSequence?: CaptureSequence` is a field of the persisted `Session`
  (`src/types/index.ts:322`).
- `sessionRepository.saveCurrent(session)` serialises the whole `Session`, capture sequence
  included, to the current-session key.
- `sessionMigration.ts`'s `migrateCaptureSequence` **validates and restores** a persisted
  sequence, deliberately coercing a sequence still `"running"` when the app last closed to
  `"paused"` — its own comment: *"auto-capture must never silently keep listening after a
  reload."*

So three different things must be kept apart:

| | What it is | Survives a restart? |
| --- | --- | --- |
| **Capture Sequence domain state** — id, block binding, shot count, handle mode, `processedResultIds`, status | **Persisted** inside the current `Session` | **Yes**, restored with `running` coerced to `paused` |
| **Live capture machinery** — the `TimingProvider` subscription, `captureQueueRef`'s promise chain, the authoritative refs in `TrackerApp.tsx` | Genuinely in-memory | No, and correctly so |
| **Blind Weight draft** — component state inside `BlindShotEntry`, tracked by `hasUnsavedBlindDraft` | Genuinely in-memory, never persisted | No |

**This does not approve cross-device continuation.** The three statements to keep distinct
are: (1) **representation** — the sequence is a persisted part of the Session; (2) **current
restore behaviour** — same device, same Profile, resumed paused; (3) **migration
behaviour** — moving an in-progress sequence to another device is **not designed, not
approved and not in scope**, and would need its own rules for a half-finished sequence whose
`processedResultIds` and live provider ownership cannot travel with it. P2 covers whether it
should be attempted at all.

## 7.4 The separate mobile storage container

A native WebView has its own storage container and **does not share Safari's or Chrome's**.
Therefore:

- **Nothing a user has in their browser appears after installing the app.** The app must
  never imply otherwise.
- After sign-in, **successfully synchronised cloud records repopulate**; everything else in
  7.2 does not.
- Profile isolation is preserved identically: the same immutable keyed adapter, the same
  `Profile.id` namespace, no mutable current-Profile pointer.
- `retireLegacyUnscopedSportingData()` runs on a fresh container and finds nothing —
  content-blind and idempotent, so this is a no-op, not a special case.

## 7.5 P2 is unanswered, and no stage may assume an answer

**P2 — must the first mobile pilot transfer browser-local drafts and unsynchronised data? —
is open.**

This document's **recommendation** is: no transfer for the first pilot; sign in, restore
successfully-synchronised cloud records, and state plainly which local-only items do not
follow. The reason is that a transfer path needs its own integrity, authorisation and
Profile-ownership model, which is a larger scope than the rest of M3.

**A recommendation is not an answer, and proceeding as though it were is not safe.** It
changes what M3 must deliver and what "usable" means, so:

- Independent M3 work that does not depend on the answer **may proceed** — the export
  adapter, the external-link adapter, the storage-durability decision of 7.1, the offline
  cold-start acceptance of 7.6.
- **M3's data-transfer scope and its acceptance criteria may not be fixed until P2 is
  answered.** §10 M3 and §11 are marked accordingly.
- Whether **preferences** and **authored training plans** transfer are separate sub-questions
  inside P2, and this document's position on each is a recommendation only.

**Regardless of P2**, the pilot must surface **unsynchronised outbox entries** before a user
relies on a new device. `SportingSyncSnapshot` already exposes the truth
(`saved_on_device` / `synced` / `sync_issue`) and `SportingSyncStatusControl` already renders
it; what is needed is making it visible at the right moment.

## 7.6 Offline cold-start acceptance

**The requirement is a cold start, not a surviving open page.**

Acceptance, after a prior successful authenticated onboarding on that device:

1. Device in airplane mode. App **not** running (force-quit, or freshly launched after a
   reboot).
2. Launch. The identity gate resolves from **trusted local device state** — no network — and
   admits the Profile.
3. `ProfileScopedSportingPersistence` mounts. `retireLegacyUnscopedSportingData()` and
   `manager.initialize()` complete offline; the "Preparing your training data" state must
   resolve, not hang.
4. Existing local training history, plans and profiles are readable.
5. A full training session can be recorded, saved, and reopened.
6. Every exercise diagram renders — from the bundle, with no network.
7. Sync status reads honestly: saved on device, not synced.
8. Restore connectivity. The outbox drains. `restoreIntoLocalRepositories()` verifies hashes
   and reconciles without duplicating the offline-recorded work.

**This acceptance is necessary but not sufficient for the milestone.** It proves the app
works offline; it does **not** prove the data survives storage pressure. §7.1's decision is
the other half, and M3 is not complete without both.

`ProfileScopedSportingPersistence` already listens for the `online` event to trigger
synchronisation. Whether that event fires reliably in each WebView after a network change is
a **device check**, not an assumption.

# 8. Native UI and platform services (Boundary D)

## 8.1 Inventory of browser-dependent behaviour

| Behaviour | Where | Native impact |
| --- | --- | --- |
| CSV / JSON export via anchor download | `src/lib/export.ts` (`downloadCsv`), `src/lib/assessment/export.ts`, `ExerciseTeamResultsScreen.tsx`, `src/lib/brower/diagnosticLog.ts` | **Broken on both platforms.** Needs the export adapter |
| `next/font/google` (Geist) | `src/app/layout.tsx` only | Not available in the mobile entry. CSS already falls back; self-hosting is optional |
| Public exercise diagrams | `exerciseAssets.ts`, `public/exercise-diagrams/` (67 files) | Bundled. Relative fetch resolves against the local origin |
| Restricted diagrams | `createAuthorizedRestrictedAssetResolver` | No production call site today. Would need the §5.2 API origin if revived |
| Safe areas | `globals.css` `.app-content-clearance`, `layout.tsx` `viewportFit: "cover"` | **Already correct** — but the mobile HTML shell must reproduce `viewport-fit=cover` or the insets resolve to 0 |
| Keyboard | numeric entry throughout training/assessment | Native keyboard overlays differ. Needs device verification, possibly the Keyboard plugin's resize behaviour |
| Navigation | in-memory `ActiveView` (ADR-0009) | No router to reconcile. **Android's hardware back button has no mapping today** and needs an explicit decision |
| External links | five `target="_blank"` sites: `SettingsScreen.tsx` ×2, `IdentityGateScreen.tsx` ×2, `PrivacyNotice.tsx` | Must open the system browser, not navigate the app WebView away |
| App lifecycle | none used today | Needed for the bootstrap delivery owner — launch URL **and** `appUrlOpen` (§6.6) — and, later, for capture invalidation (§10 M4) |
| `crypto.randomUUID` | `identityRuntime.browserIdSource()`, `createManualTimingResult` | Returns `null` → runtime unusable if absent. **Verify on device**; do not assume |
| Status bar / splash | — | Cosmetic, but a splash that never dismisses is a launch failure. Include in M1 |

## 8.2 Proposed plugins

Each is a proposal, with the compatibility position stated. **Versions are not pinned
here**; they are resolved and locked when the stage that needs them is implemented.

| Plugin | Why | Position |
| --- | --- | --- |
| `@capacitor/app` | `appUrlOpen`, `getLaunchUrl`, foreground/background state, Android back button | Required by M2 |
| An authentication-browser plugin — **unselected** | Open the authorization URL outside the app WebView | Required by M2, and **the selection is a Stage M2 decision with its own verification.** **`@capacitor/browser` uses `SFSafariViewController` on iOS; it is *not* `ASWebAuthenticationSession`**, and its `browserFinished` event does not distinguish cancellation from completion. Whichever plugin is chosen, its **documented return and cancellation mechanism** must be recorded before it is adopted — see §6.3, whose design deliberately does not depend on a trustworthy cancellation signal |
| `@capacitor/filesystem` + `@capacitor/share` | Export adapter: write the file, then offer the share sheet | Required by M3. Already exercised together in the probe (`export_shared`, and a distinct `export_cancelled`, in the archived evidence) |
| `@capacitor-community/bluetooth-le` | Brower transport | **M4 only.** Documented 8.x ↔ Capacitor 8.x. Bluetooth is **unavailable in the iOS Simulator** |
| `@capacitor/keyboard`, `@capacitor/status-bar`, `@capacitor/splash-screen` | Presentation | Optional; adopt only where a device check shows a real problem |
| `@capacitor/preferences`, or a SQLite plugin | A **native `StorageAdapter` implementation** — see §7.1 option B | **Candidate, pending P6.** Capacitor's storage guide names these as the recommended stores for data that must not be lost. Adopting one **behind the existing `StorageAdapter` interface** changes the engine, not the authority: the repository boundary, Profile scoping, the outbox and the single sync engine are unchanged. It is **not** a second storage mechanism alongside the contract, and **not** an activation of the retired IndexedDB migration. It still needs its own ADR and its own data-migration design |

Capacitor 8's environment setup requires **Xcode 26.0+** and **Node 22+**, and makes Swift
Package Manager the default (CocoaPods optional). The existing probe already builds on the
SPM path on this machine.

## 8.3 Platform limitations, stated separately

**Nothing observed on iOS may be generalised to Android.** In particular:

| | iOS | Android |
| --- | --- | --- |
| Local web origin | `capacitor://localhost` | `https://localhost` |
| BLE peripheral identity | An **iOS-assigned** UUID (`ACFEF74F-…` in the archived evidence), app- and device-scoped | A different identifier model entirely. The archived identifier means nothing here |
| BLE permission | `NSBluetoothAlwaysUsageDescription` in `Info.plist`; one prompt | **Runtime** permissions: `BLUETOOTH_SCAN`, `BLUETOOTH_CONNECT` (API 31+), plus legacy `BLUETOOTH`/`BLUETOOTH_ADMIN` with `maxSdkVersion="30"`, and `ACCESS_FINE_LOCATION` unless `BLUETOOTH_SCAN` declares `usesPermissionFlags="neverForLocation"` (which filters some BLE results). Below API 31, `ACCESS_FINE_LOCATION` is required for scanning |
| Background BLE | `UIBackgroundModes: bluetooth-central` | A different model; the plugin documents background scanning support as iOS-only |
| Storage durability | **Capacitor documents WebView LocalStorage as transient on both platforms** — the OS reclaims it under storage pressure (§7.1). **No** persisted-storage API is documented for iOS | Same transience warning, but Android **does** expose a persisted-storage API that can protect IndexedDB from eviction. That is an Android-only partial mitigation and does not apply to `localStorage` |
| Back navigation | none | Hardware back button |
| Deep link proof | `apple-app-site-association` + Associated Domains | `assetlinks.json` + `autoVerify` + signing-certificate SHA-256 |

**Required physical-device tests** are listed per stage in §10 and consolidated in §9.

---

# 9. Platform readiness matrix

**Android compilation and hardware behaviour are entirely untested.** No Android project
exists, no Android tooling is installed, and nothing in the archived iOS evidence is
evidence about Android.

| Concern | Shared | iOS | Android |
| --- | --- | --- | --- |
| React UI and navigation | ✅ shared, no `next/*` coupling (§2.1) | — | — |
| Training / assessment / exercise logic | ✅ shared | — | — |
| Identity orchestration, Profile rules | ✅ shared | adapter: return target, callback ingestion, auth browser | same adapters, different native config |
| Repositories, sync, outbox | ✅ shared | — | — |
| Build | ✅ **implemented** (M1) — one Vite build → one asset bundle | ✅ consumes it | consumes it — **no Android project exists** |
| **Dependency compatibility** | Capacitor 8.5.2 family | **Verified on this machine** for the probe's plugin set, and for the application shell itself — M1's generated project compiles unsigned for `generic/platform=iOS` | **Untested** — no Android project exists |
| **Build / signing** | — | Xcode 26.0+, SPM default. Unsigned compilation **verified**; signing team still required for device install (a free personal Apple ID suffices for development) | **Untested.** Android Studio / Gradle SDK not installed. Release signing key required, and its SHA-256 is an App Links input |
| **Permissions** | — | `NSBluetoothAlwaysUsageDescription` (M4 only) | Runtime Nearby-devices permissions (M4 only) — see §8.3 |
| **Auth callbacks** | shared PKCE, classifier and **pure `decideOAuthIntake`**; new attempt-scoped cell and warm continuation (§6.4) | Universal Link (recommended) or, if P4 forces it, the explicitly designed custom-scheme path of §6.2 Option 2 | App Link, same fallback. Association needs the **release signing** SHA-256, which ties it to M6 |
| **Local persistence / offline restart** | shared `StorageAdapter`, Profile-scoped keys, one authority | **Durability is a documented platform limitation, not an untested unknown** (§7.1). Capacity is measurable (T-a) | Same transience warning; Android-only persisted-storage API is a partial mitigation for IndexedDB, not `localStorage` |
| **File export** | one adapter interface | Filesystem + share sheet. **Both a completed share and a cancellation** are evidenced in the probe's own export | **Untested** |
| **BLE and lifecycle** | one transport interface (M4) | Connection, discovery, notifications and foreground lifecycle **evidenced** (2026-09-28, probe only). Background-while-listening **not** evidenced | **Untested in every respect** |
| **Required physical-device verification** | — | **M1:** launch, safe areas, external links, `crypto.randomUUID`. **M2:** email OTP and Google, warm and cold, plus the §6.9 scenarios. **M3:** offline cold start and export. **M4:** BLE | **All of the above, independently.** A passing iOS check is never evidence for Android |

**Stage attribution in this matrix, stated explicitly so it cannot be read as M1 scope.**
M1 delivers a launchable shell that reaches the identity gate; **sign-in is M2 and export is
M3**, and the matrix rows for callbacks, persistence and export describe those stages, not
M1's completion criteria. See §10 M1's "Completion" line.

---

# 10. Bounded implementation stages

Each stage is separately implementable and separately reviewable. **They must not be
combined into one assignment.** Every stage carries Android readiness in its design even
though iOS is delivered first.

---

## Stage M1 — Shared client and build groundwork

**Resulting behaviour.** `npm run build` / `npm start` are byte-for-byte unaffected. A new
mobile build produces an asset bundle that renders the real application shell
(`IdentityProvider → AuthenticatedSportingPersistence → TrackerApp`) with the real Tailwind
styles, the real safe-area handling and the bundled diagrams. An iOS project launches it on
a physical iPhone **as far as the identity gate**.

**Prerequisites.** None blocking.

**Placeholders, explicitly marked as such.** **P4 is open**, so M1 uses a development bundle
identifier and a development API origin, both named in the config as placeholders. **M1 must
not be described as producing a distributable app**, and the placeholders must be replaced
before M6. Nothing in M1 registers a scheme, a domain, or a provider redirect.

**Foreground-only scaffolding.** `Info.plist` declares **no** `UIBackgroundModes`, matching
the currently exercised scope. **This is a starting point, not an answer to P3** — M1 does
not commit the product either way, and adding a background mode later is a configuration and
review change rather than a rework.

**Expected scope.** New `mobile/` entry, HTML shell and `vite.config.ts`; new
`capacitor.config.ts`; new `ios/` project; mobile-only `package.json` scripts; a narrow
addition to the root `tsconfig`/`vitest`/`eslint` path rules mirroring the probe's precedent.
**No change to `src/`.**

**Invariants.** No `server.url` in any release configuration. No change to `next.config.ts`,
to any API route, or to any file under `src/`.

**Automated tests.** The mobile entry mounts the same provider tree as `src/app/page.tsx`
(the anti-divergence check of §3.1). The bundle contains all 67 diagrams. The three `define`d
values resolve, and a missing Supabase configuration yields `cloud_unavailable` rather than
a crash.

**Negative cases.** Missing/invalid cloud configuration; a build with no diagrams present; a
shell missing `viewport-fit=cover` (insets must be observably wrong, proving the check works).

**Physical-device checks (iOS).** Installs and launches; splash dismisses; the gate renders
with correct safe areas in both orientations; `crypto.randomUUID` is available; external
links open the system browser.

**Completion — stated narrowly.** The identity gate is **reachable and correctly rendered**
on a device, and the Web build is unaffected. **Sign-in is not expected to work** (M2),
**export is not expected to work** (M3), and **no persistence-durability claim is made**
(M3/P6). M1 is complete when the shell is right, not when the app is usable.

**Rollback.** Delete `mobile/`, `ios/` and the added scripts. Nothing in `src/` was touched.

### M1 — implementation status (2026-09-28)

**Implemented.** Candidate A, as recommended in §3.1.

| Path | What it is |
| --- | --- |
| `mobile/src/MobileApp.tsx` | The root component. Same provider tree and container markup as `src/app/page.tsx`, importing `src/components/` and `src/lib/` directly |
| `mobile/src/main.tsx` | Mounts it into the shell's `#root` |
| `mobile/src/mobile.css` | Imports `src/app/globals.css` unchanged; adds Tailwind `@source` directives for the shared UI, the mobile font fallback, and the top/side safe-area insets |
| `mobile/index.html` | The shell — reproduces `layout.tsx`'s document language, layout classes, theme colour and `viewport-fit=cover` |
| `mobile/vite.config.ts` | Build, the three-literal allow-list, and the diagram-emitting plugin |
| `mobile/publicEnv.ts` | The browser-visible environment allow-list, in one place |
| `mobile/tsconfig.json`, `mobile/vitest.config.ts` | Focused typecheck and the M1 checks |
| `mobile/README.md` | Commands, configuration contract and the Xcode steps |
| `capacitor.config.ts` | `webDir: mobile/dist`, development app identity, no `server.url` |
| `ios/` | Generated Capacitor project, SPM path |

**Scripts added** (every existing script preserved): `mobile:build`, `mobile:preview`,
`mobile:typecheck`, `mobile:lint`, `mobile:test`, `mobile:verify`, `ios:sync`, `ios:open`.

**Dependencies added:** `@capacitor/core` (dependency); `@capacitor/cli`, `@capacitor/ios`,
`vite`, `@vitejs/plugin-react`, `@tailwindcss/vite` (dev). Capacitor is pinned to the 8.5.2
family, matching the working probe. `vite` is pinned to the version the tree already
resolved transitively, so **no existing dependency changed version**.

**Configuration contract — as shipped by M1.** Three literals were inlined:
`NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` (allow-listed in
`mobile/publicEnv.ts`, read from the repository's ordinary `.env` files — the same source
`next build` uses) and `NODE_ENV`. **Stage M2a added a fourth,
`NEXT_PUBLIC_NATIVE_API_ORIGIN`** — see the M2a block below; this paragraph records M1's
state, not the current one. `process.env` is never serialised and no browser-wide
`process` shim is installed. Absent public configuration reaches the real
`cloud_unavailable` gate; it never crashes and never fabricates a Profile.

**Configuration mode and runtime semantics are separate axes, deliberately.** `--mode`
selects which `.env.<mode>` file is read. It does **not** decide whether the application
runs its production guards, because every artifact `vite build` produces is installable.
`NODE_ENV` is therefore **pinned to `production` for every build**, under any mode and from
any ambient environment; only a dev server is `development`. Three distinct failures
collapse into one if that separation is lost:

- `NODE_ENV !== "production"` is the shared `IS_DEV` condition, which exposes the Timing
  Simulator and the Brower BLE diagnostic screen.
- `NODE_ENV === "test"` is `ProfileScopedSportingPersistence`'s fixed test Profile
  fallback — **a bypass of mandatory Profile scope that must never exist in an installable
  build** (see
  [`MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md`](MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md)).
- Vite derives `isProduction` — and therefore which JSX transform `@vitejs/plugin-react`
  emits and which React runtime is linked — from the **ambient** `NODE_ENV`, not from
  `--mode`.

The build-mode matrix in `mobile/__tests__/runtimeBrowser.test.ts` builds the real config
under the default mode, a custom mode, mode `test`, mode `test` with ambient
`NODE_ENV=test`, and ambient `NODE_ENV=development`, and requires each one either to be
rejected outright or to produce a production-safe artifact that starts in a real browser
and reaches the real identity gate. **No shared application guard was modified and no
runtime bypass was added.**

**Verified (2026-09-28).**

| Check | Result |
| --- | --- |
| `git diff --check` | clean |
| `npx tsc --noEmit` | clean (the root program covers `mobile/` and `capacitor.config.ts`) |
| `npm run lint`, `npm run mobile:lint` | clean |
| `npm test` | 195 files, 3080 tests passed |
| `npm run build` (Next) | succeeded; all six dynamic API routes still dynamic |
| `npm run test:e2e` | Earlier implementation run: 107 passed against local disposable Supabase. A fresh full run for the corrected state remains blocked by an existing Next development server for this checkout. |
| `npm run mobile:build` | succeeded; 67 diagrams + one JS and one CSS asset |
| `npm run mobile:test` | 6 files, 58 tests passed |
| `npm run ios:sync` | succeeded; synced bundle byte-identical to `mobile/dist` apart from Capacitor's own `cordova.js` / `cordova_plugins.js` |
| Unsigned `xcodebuild` for `generic/platform=iOS` | **BUILD SUCCEEDED** |
| Built `App.app` inspection | correct bundle id and display name; **no** `UIBackgroundModes`, Bluetooth permission, `CFBundleURLTypes` or entitlements file; `Capacitor.framework` genuinely linked; no probe assets |

The M1 checks (`mobile/__tests__/`) cover:

- **Composition (§3.1's anti-divergence check).** A *structural* comparison of the React
  element trees `src/app/page.tsx` and `mobile/src/MobileApp.tsx` **return**, without
  rendering them, comparing component identity by function reference. It detects a removed
  `AuthenticatedSportingPersistence`, a removed or replaced `TrackerApp` (including a
  same-named stand-in), inverted provider nesting and changed container markup, each proven
  against in-memory broken fixtures.
  **The rendered DOM comparison is explicitly *not* the composition check**: with no cloud
  configured, `IdentityProvider` renders the gate *instead of* its children, so
  `AuthenticatedSportingPersistence` and `TrackerApp` never mount and their removal is
  invisible in the DOM. A test pins that limitation deliberately so the rendered comparison
  is not mistaken for composition coverage.
- **The rendered gate.** The identity gate standing in front of the sporting workspace, and
  missing or malformed configuration failing closed.
- **The shell contract**, including a deliberately broken in-memory shell proving the
  `viewport-fit=cover` check actually fails.
- **Asset delivery**, positive and negative: all 67 diagrams bundled byte-for-byte at the
  exact paths the shared resolver fetches, no unrelated `public/` content swept in, and — via
  a temporary fixture directory of symlinks with diagrams deliberately omitted — a build that
  **fails, naming the specific missing asset**. No repository asset is removed or renamed to
  produce that failure.
- **The artifact**: shared-component Tailwind classes present in the built CSS, no surviving
  `process.env` reference, no Next or server module, and no development React runtime.
- **Real-browser startup** against separately built production bundles across the build-mode
  matrix: the gate rendering with no uncaught exceptions, `crypto.randomUUID` available, and
  diagrams resolving over the app's own origin.

**Not done, and not claimed.**

- **Physical-device acceptance is PARTLY reported, and partly still unperformed.**
  Signing is a human step in Xcode on the installing machine; this repository selects no
  account and stores no signing identity, though the developer has since selected a team in
  the generated project.
  - **User-reported as working on a physical iPhone:** the prescribed **visible launch and
    layout checks** — installation, launch, splash dismissal, the identity gate rendering,
    and safe areas. This is the **user's report**, recorded as such. No measurement, screenshot
    or log was produced here, and no automated check in this repository observed it.
  - **Not reported, and therefore still unperformed:** `crypto.randomUUID` on-device, and
    external links opening the system browser. Nothing may describe these as verified.
  - The status therefore remains **"M1 implementation ready for device acceptance"** rather
    than "M1 complete": the two unreported checks are part of M1's own list.
    `mobile/README.md` carries the exact Xcode steps.
  - **Where to find an external link for that check:** the gate renders legal links only
    once the cloud legal snapshot has loaded. Under `cloud_unavailable` — the state an
    unconfigured build reaches — the gate carries **no link at all**, so the device check
    needs a build with working public Supabase configuration.
- No Android project exists and nothing was compiled or run on Android.
- Sign-in does not work (M2), export does not work (M3), and **no persistence-durability
  claim is made** (M3 / P6).
- **P1–P7 remain open and are unchanged by this stage.** M1's app identity and API-origin
  values are development placeholders, `Info.plist` declares no background mode, and the M2
  callback scheduling gate is untouched.

**Observed, not fixed.** The bundle is a single ~1.66 MB (420 KB gzipped) chunk, and
development-only components (the Timing Simulator, the Brower BLE diagnostic screen) are
statically imported by `TrackerApp`, so their code ships even though `IS_DEV` folds to
`false` and neither can render. That is a bundle-size observation for a later stage, not a
reachability problem.

---

## Stage M2 — Native identity and authorized API access

**Resulting behaviour.** A user signs in on a device with **email OTP**, reaches completed
onboarding, and Team API calls succeed against the configured API origin. **Google sign-in
completes as well, or the stage completes as M2-partial** — see the completion rule below.

**Prerequisites.** M1.

**P4 and the two possible shapes of this stage.** Google sign-in needs a callback
destination, and §6.2 offers exactly two:

- **P4 answered with a domain** → Option 1 (HTTPS). The prerequisites are the AASA /
  assetlinks hosting, the Associated Domains entitlement / intent filter, and the Supabase
  allow-list entry. `isUsableUrl`, `isValidRedirectTarget` and `validateAuthorizationUrl`
  are **unmodified**.
- **P4 unanswered, and the user explicitly chooses the fallback** → Option 2
  (custom scheme). This is **not free**: it requires the new configured-destination
  predicate, routed into both validators, keeping the `http:`/`https:` path byte-identical
  for Web, plus scheme registration and an allow-list entry. It must be an explicit product
  choice, because it weakens destination assurance relative to a domain-verified link.

**Google sign-in may not be both deferred and required for completion.** If neither option
is available, this stage completes as **M2-partial** with a recorded, explicit status:
email OTP works on device; **Google sign-in remains implemented in shared code and visible
in the gate, exercised on Web only**, with its native callback path unfinished and named as
the remaining work. **It is never removed from the UI** (§1). M3 may proceed on M2-partial;
**M6 may not.**

**Expected scope.** The API-origin adapter and its ADR (§5.2); the identity return-target
adapter; the **attempt-scoped capture cell**, the **delivered-URL ingestion entry point**
and the **warm continuation** coordinator operation with admission-time ownership and post-claim
revalidation, the **ownership binding** on `consumeAdmittedContinuation`, and the explicit
**cancellation seam** (§6.4, §6.7), plus the ADR amendment of §6.8;
the authentication-browser adapter, with the chosen plugin's return/cancellation mechanism
recorded (§6.3); the **bootstrap delivery owner** covering launch URL and `appUrlOpen` alike
(§6.6); native link configuration; **server-side CORS** for the six routes.

**One design gate must be closed inside this stage before it can complete.** §6.6's
**startup / continuation scheduling** has no specified mechanism: `startUp()` claims the
ownership slot unconditionally, and separate cells do not prevent contention for it. M2 must
design a mechanism against the real coordinator, satisfy §6.6's six invariants, pass §6.9's
three **GATE** rows, and record the outcome in the ADR amendment. **Until then the native
Google callback path is not complete**, which is one of the conditions that can make this
stage **M2-partial** (below). **M1 does not depend on it.**

**Authority and failure invariants.** Every property in §5.2's table is preserved, including
destination-validated-before-token-read. PKCE only; `setSession` from a fragment is
forbidden. **`decideOAuthIntake` is reused verbatim** and remains the sole authority on
admissibility — no correlation logic is re-implemented, and §6.4 (ii)'s selector addressing
can only drop a delivery, never admit one.
**`consumeAdmittedContinuation` is reused with one required change: an explicit ownership
binding to the cell it owns** (§6.4 iv), preserving its epoch bump, C3 checkpoint, single
claim, exchange against `expectedFlowId` and unconditional self-finalization. The ownership
slot is claimed **only on admission**, and barrier and attempt are **revalidated after the
claim**. **Binding and consumption are independent axes**, so binding never re-opens ingested
material; one claim; one code read; one explicit finalization; no
path un-finalizes a cell; **every finalizer is bound to the record it owns**. Destination,
field and selector validation all happen **before** any cell is touched. **No raw callback URL
or authorization code is retained** for deduplication or anything else. Opaque `"null"`
origins are never compared.

**Automated tests.** **All of §6.9's required design acceptance cases B1–B28**, plus: an unauthorized API
destination (wrong origin, traversal segment, added query, unknown route) denies **without
reading the session**; sign-out and account switch invalidate.

**Negative cases.** Backend unavailable during exchange; the authentication browser
dismissed with an ambiguous signal; app killed mid-authentication; an `appUrlOpen` arriving
before the listener registers.

**Physical-device checks (iOS).** Email OTP end-to-end. Google sign-in warm and **cold**
(where the stage is not M2-partial). Dismiss the authentication browser and retry. Airplane
mode mid-exchange. Account switch with no residual workspace from the previous Profile.

**Completion.** Email OTP works on device; every §6.9 scenario behaves as specified for the
paths this stage actually enables; **the §6.6 scheduling gate is closed, or the stage is
explicitly recorded as M2-partial with that gate named as the remaining work**; the ADR
amendment is written and reviewed; the stage's status is recorded as **complete** or
**M2-partial**, never left ambiguous.

**Rollback.** The adapters have Web implementations identical to today's behaviour;
reverting the native implementations leaves Web unchanged.

### Stage M2a — configured API origin, server CORS and email-OTP groundwork (implemented)

**Status:** **Implemented and verified by automated tests only.** M2a is a bounded slice of
M2. **It is not M2, and it is not M2-partial**, which requires actual on-device OTP and API
evidence this stage has not produced.

**Confirmed product decision.** The application's API origin is **`https://curling.evolane.me`**.
It is recorded in `.env.example` as the deployed value for `NEXT_PUBLIC_NATIVE_API_ORIGIN`.
**It settles nothing else** — the native Google callback domain, the production bundle
identifier and every distribution commitment remain **open decision P4**.

**What M2a implements.**

| Piece | Where |
| --- | --- |
| Canonical bare-HTTPS origin validation | `src/lib/platform/nativeApiOrigin.ts` |
| The trusted platform signal (Capacitor bridge, not a UA heuristic) | `src/lib/platform/runtimePlatform.ts` |
| Web-vs-native target resolution, no fallback, no setter | `src/lib/platform/apiTarget.ts` |
| Requests addressed to the resolved target; native `credentials: "omit"` + `redirect: "error"` | `src/lib/supabase/authorizedFetch.ts` |
| Production wiring for the Team service **and** the dormant restricted-asset resolver | `src/lib/supabase/teamServiceFactory.ts` |
| Exact-string native CORS, origin refusal before any side effect, per-route preflight | `src/app/api/_lib/nativeCors.ts` + the six routes |
| The browser-visible allow-list, extended by one name | `mobile/publicEnv.ts` |

The decision and its alternatives are in
[`docs/adr/0047-configured-native-api-origin-boundary.md`](adr/0047-configured-native-api-origin-boundary.md).

**Email OTP needed no code change, and that was verified rather than assumed.**
`requestEmailOtp` calls `signInWithOtp({ email })` with **no `emailRedirectTo`**, and
`verifyEmailOtp` calls `verifyOtp({ email, token, type: "email" })` — a typed code, straight
to the configured Supabase origin, which the SDK addresses absolutely and which the document
origin never affected. No OAuth callback, no deep link, no authentication browser and no
capture cell are involved. An existing test already pins the exact `{ email }` argument, so
the callback-free property is enforced, not merely described.

**Deliberately NOT in M2a**, and unchanged: native Google callbacks, the capture cell,
startup/continuation scheduling (§6.6's design gate), the authentication-browser adapter and
cancellation UX (P7). **Google remains implemented in shared code and visible in the gate,
on its existing Web path.** Nothing here claims it works natively.

**Deployment status — read this before any device test.** The CORS change lives in this
repository's Route Handlers. **It has not been deployed.** Until the deployed backend serves
it, a native Team request will be blocked by the browser engine regardless of how the client
is configured. **Local route tests prove the handlers; they prove nothing about the hosted
server.**

**Hosted configuration still to confirm.** The Supabase project's email template must deliver
a **typed code**, not only a magic link. **This has not been inspected or configured** by this
stage — the account that can see it is the user's.

**Automated verification.** Synthetic origins throughout; no real key or project URL appears
in any test.

| Area | Coverage |
| --- | --- |
| Origin validation | scheme, path, trailing slash, query, fragment, credentials, case, default port, whitespace/control, unparseable, absent-vs-invalid |
| Platform selection | Web / iOS / Android via the real bridge objects; an unrecognized native platform fails closed; a spoofed user-agent changes nothing |
| Target resolution | Web unaffected by a configured native value; native never falls back to the WebView origin |
| Native requests | all five Team routes + the restricted resolver; `credentials`/`redirect`; refused redirect → `network_error`; token in one header, never returned |
| Fail-closed ordering — **before** the session is read | unresolvable target (unsupported platform, unconfigured or invalid native origin), **rejected** path input (`.`, `..`, empty, whitespace/control), unknown route, unserializable body → **zero session reads, zero fetches** |
| Fail-closed ordering — **after** the session is read | absent session → **zero fetches**. Discovering that no session exists necessarily *is* a session read, so this case is listed separately rather than counted as zero reads |
| Confinement — **safely encoded** path segments | a nested path / query / fragment / absolute / protocol-relative / encoded-traversal id is neutralized by percent-encoding rather than rejected (the same contract the Web path has always had), and the request still cannot leave the configured origin or the `/api/team/` prefix, and carries no query or fragment |
| Production composition | Web vs iOS vs Android through the real factories, including the restricted resolver |
| CORS helper | exact matching, `"null"`, wildcard, suffix/prefix/subdomain/port/scheme/case variants, no credentials header, `Vary` merge, status/body/cache preserved |
| Every route | preflight for both native origins, method/header limits, disallowed and `"null"` origins, **no auth lookup / RPC / file read / email send during preflight**, unapproved origin refused **before** the handler body, matching Origin + no bearer still denied, CORS headers on error responses, no-Origin and same-origin Web unchanged |

**Physical-device acceptance for M2a — NOT performed.** No on-device sign-in and no
on-device API call has been made. (M1's *visible* launch and layout checks are separately
user-reported — see the M1 block above — which says nothing about OTP, API access or
`crypto.randomUUID`.) The manual procedure is in `mobile/README.md`. It covers `crypto.randomUUID`, requesting and entering a code, existing-
account login and new-account onboarding, sign-out and account switch with no residual
workspace, wrong/expired code, network failure, and one authorized API operation through the
configured origin. **The user performs it.** Nothing in this stage sends a real invitation,
mutates a production account or touches hosted settings.

---

## Stage M3 — Usable training, persistence, offline operation and export

**Resulting behaviour.** **This is the first usable iPhone milestone** (§11).

**Prerequisites.** M2 or M2-partial.

**P2 is open, and this stage may not assume an answer.** §7.5 gives a recommendation ("no
transfer"). **Proceeding as though that were the answer is not safe**, because it fixes what
M3 delivers and what "usable" means. Therefore:

- **May proceed now:** the export adapter, the external-link adapter, the P6 storage
  decision, the offline cold-start acceptance, the capacity measurement.
- **May not be fixed until P2 is answered:** M3's data-transfer scope and the corresponding
  §11 acceptance criteria.

**P6 is a completion gate, not a risk to note.** §7.1's durability decision — accept option
A explicitly, or implement option B behind the existing `StorageAdapter` — must be **made**
before this stage can be called complete, and if option B is chosen it is its own sub-stage
with its own ADR and its own data-migration design.

**Expected scope.** The export adapter, applied at the one shared mechanism (§8.1). The
external-link adapter. The capacity measurement (T-a). Possibly bypassing the diagram
data-URL cache on native (§3.4). **No change to repositories, sync, authority or domain
logic**; if P6 selects option B, the change is an adapter *implementation* behind the
unchanged `StorageAdapter` interface.

**Authority and failure invariants.** `Profile.id` isolation unchanged. The immutable keyed
adapter unchanged. **One** repository boundary, **one** Profile authority, **one** sync
engine. No IndexedDB migration activation. Restore continues to hash-verify and to abort
rather than write on mismatch.

**Automated tests.** Export adapter: success, write failure, share cancelled — each
distinguishable, none reported as success when it is not. Offline cold-start sequence
against a fake storage/network. Interrupted persistence (quota exceeded, storage
unavailable) surfaces rather than silently discarding. Pending outbox entries survive a
restart **and are visibly reported as not-yet-synchronised**. Account switch during an
in-flight asynchronous write does not leak into the new Profile's workspace. If option B is
chosen: the native adapter satisfies the full `StorageAdapter` contract including
never-rejecting and error classification.

**Negative cases.** Backend unavailable at launch; storage quota exceeded mid-session;
`online` event never fires; a cloud record whose hash does not match; **local storage
cleared between launches** — the app must fail honestly (sign-in required, local-only work
gone) rather than silently presenting an empty workspace as complete.

**Physical-device checks (iOS).** The full §7.6 offline cold-start acceptance. Export a CSV
and confirm the file **arrives** somewhere the user can retrieve it. Relaunch after a week
of disuse — recorded as **scoped evidence about that device and week, never as a durability
guarantee** (§7.1).

**Completion.** Every §11 criterion passes on a device, **and** P6 is decided and its
consequence implemented or explicitly accepted, **and** P2's scope is settled for whatever
this stage claims about data transfer.

**Rollback.** Adapters revert to the Web implementations.

---

## Stage M4 — Production Brower capture

**Resulting behaviour.** Measured release times reach the application from the timer,
through the existing provider boundary.

**Prerequisites.** M3, **and Gate C passed** in `docs/BROWER_INTEGRATION_STATUS.md` — not
"partial". **P3 blocks** any background scope. The 2026-09-28 evidence does **not** pass
Gate C and does **not** unblock this stage.

**Scope boundary.** A production `TimingProvider` implementation and a native BLE transport
adapter. **The probe at `tools/brower-ios-probe/` remains a separate instrument and is not
promoted.** Its platform checks and diagnostic architecture must not become the production
cross-platform boundary.

**Invariants — all existing, none new.** Results enter through `TimingProvider` /
`TimingResult` → `processTimingResult` → `applyTimingResultToSession`, and for Blind Weight
through `setMeasuredReleaseTime` (ADR-0003/0006/0007). Duplicate protection is by
`result.id` against `sequence.processedResultIds` — **so the adapter must mint a stable id
per distinct measurement.** The archived evidence shows byte-identical repeat packets
(sequences 26/27 and 29/30 of export 01); if those produced different ids, duplicate
protection would not fire and a repeat would become a second shot. One
active-capture-owner rule (ADR-0011) is unchanged; attempt and subscription ownership,
explicit measurement attribution, save-failure behaviour and lifecycle invalidation all
stay as they are.

**Explicitly not approved by this document:** any start/finish pairing algorithm, any
automatic New Athlete (`0x0A`) command, any 20-split rollover policy, any background
measurement. The user's constraint that a manual "New" press between measurements is
unacceptable is **recorded as a requirement on the eventual design**; it does not authorise
sending `0x0A`, and the evidence needed to design around it does not exist yet.

**Negative cases.** Duplicate packets; packets arriving with no active capture; packets for
a different record; disconnection mid-capture; background/foreground transition while
listening (**unevidenced today**); a save failure after a result is accepted.

**Physical-device checks.** With gates, not a bare TCi. On each platform independently.

---

## Stage M5 — Android implementation and verification

**Resulting behaviour.** The same application, from the same bundle, on Android.

**Prerequisites.** M3 (M4 only if Brower is in scope for Android at that point).

**What this stage must be.** Platform configuration and genuinely necessary adapters:
Android project generation; App Links (`assetlinks.json`, `autoVerify`, signing SHA-256);
manifest permissions if BLE is in scope; hardware back-button mapping to `ActiveView`;
the Android implementations of the §3.3 adapters; Gradle/signing setup.

**What this stage must not be.** A rewrite of UI, training logic, identity or
synchronisation, and no second copy of any domain module. **If Android implementation
requires touching shared domain code, the earlier stage's design was wrong** and the fix
belongs there, not in a fork.

**What it legitimately may be.** Android-specific *configuration* and *adapter
implementations* are expected, not exceptional — permissions, link association, the back
button, Gradle and signing all have no iOS or Web counterpart. A justified platform
presentation difference (for example, honouring a platform navigation convention) is also
acceptable where the **domain** behind it is unchanged. The test is whether shared domain
code had to change, not whether any platform-specific code exists.

**Verification.** The complete M1–M3 device matrix, run independently on Android hardware.
**No iOS result may be cited as Android evidence.**

---

## Stage M6 — Distribution readiness

**Prerequisites.** M3 at minimum. **P1, P4 and P5 all block this stage.**

**Scope.** Final bundle identifier / application id and app name; the **callback domain**;
store accounts and listings; privacy declarations consistent with
`docs/adr/0041-first-versioned-privacy-notice.md`; guideline 4.8 resolution; release
signing; the Web/mobile coexistence decision from P1.

**The production API origin is already settled** — `https://curling.evolane.me`, configured
through `NEXT_PUBLIC_NATIVE_API_ORIGIN` (Stage M2a,
[ADR-0047](adr/0047-configured-native-api-origin-boundary.md)) — so this stage inherits it
rather than choosing it. Everything else above remains an open product decision.

**Nothing else here is designed in this document**, because the remaining inputs are open
product decisions and none may be invented.

---

# 11. The first usable iPhone milestone

Delivered by **Stage M3**. All of the following must pass on a physical iPhone:

| # | Criterion | Note |
| --- | --- | --- |
| 1 | Sign in and complete the **existing** onboarding — no mobile-specific onboarding | **Email OTP** is the criterion. Google sign-in is required for M2 to be complete rather than **M2-partial**, but the milestone does not depend on it |
| 2 | Use existing **manual** training end to end | |
| 3 | **Save** a session and **reopen** it | |
| 4 | **Reopen offline** after prior authenticated onboarding — cold start, app not running | §7.6. Necessary but **not sufficient**: P6 (§7.1) is the other half |
| 5 | **Restore cloud history** | Precisely: **archived Training Sessions**, **terminal Assessment Runs** under the existing domain rules, and **owned Team results** — and only those that have **actually synchronised**. Records still in the outbox on another device do not appear, and the app must not imply they will |
| 6 | **Export** data to a file the user can actually retrieve | |
| 7 | **Switch accounts** without exposing another Profile's workspace | |

**Scope not yet fixed:** whether the milestone must also carry browser-local drafts,
authored plans or preferences across from the Web app is **P2**, unanswered. §7.5's "no
transfer" is a recommendation, and criterion 5 is written for that case; if P2 answers
otherwise, criterion 5 and M3's scope both change. **Do not treat this table as final until
P2 is answered.**

## Acceptance cases the milestone must cover

**The identity cases are not restated here.** §6.9 is the single authoritative list of
required design acceptance cases, with their authoritative operation/cell and expected
exchange counts; this table only points at it so the milestone's coverage is visible in one
place.

| Case | Stage | Required behaviour |
| --- | --- | --- |
| **All of §6.9 B1–B28** — callback admission, **live ownership handoff**, secret lifetime, cancellation and its persistence failure, sign-out, **bootstrap delivery in every ordering**, duplicate delivery, destination validation, and Web regression | M2 | Exactly as §6.9 specifies. **These are required future implementation tests; none has been executed** |
| Unauthorized API destination | M2 | Denied **before** the session is read; no fetch |
| Backend unavailable | M2, M3 | Named failure; no false success; local work preserved |
| Interrupted persistence | M3 | Surfaced, never silently discarded |
| Pending offline writes | M3 | Survive restart; drain on reconnect; **visibly** not-yet-synchronised |
| Local storage cleared between launches | M3 | Honest failure — sign-in required, local-only work reported gone. Never an empty workspace presented as complete |
| Account switch during async work | M2, M3 | Full remount; **no** delayed write lands in the new Profile's workspace |
| Duplicate timing packets | **M4** | Rejected by `processedResultIds`. **Not part of the first milestone** — manual entry only |
| Background / foreground transitions | M2 (callbacks), M3 (persistence), M4 (capture) | No partial identity, no lost writes; capture behaviour is M4 and is **unevidenced today** |

---

# 12. What this document does not do

> **Scope note.** This section describes the DOCUMENT's own authority — it plans, it does not
> implement. Stages M1 and M2a have since been implemented, and §10's stage sections are the
> record of what now exists. Two bullets below have been narrowed accordingly; the rest stand.

- It does not implement anything. **No storage library, adapter, database, plugin or
  authentication code is added by this document.** (The work recorded in §10's M1 and M2a
  status blocks was implemented by those stages, not here.)
- It does not select a bundle identifier, application id, callback domain, store account, or
  distribution commitment. **The API origin is no longer among these:** it is confirmed as
  `https://curling.evolane.me` and configured through `NEXT_PUBLIC_NATIVE_API_ORIGIN`
  (Stage M2a, ADR-0047). That settles the API destination only.
- §5.2's API-origin amendment is **no longer a proposal** — it was authored and implemented
  as [ADR-0047](adr/0047-configured-native-api-origin-boundary.md) in Stage M2a, which
  narrows ADR-0025 Decision 20's wording. **§6.8's callback-scope amendment remains a
  proposal** for the rest of Stage M2 to author and have reviewed, and the native Google
  callback design and its §6.6 scheduling gate are untouched.
- It does not select an authentication-browser plugin, and it does not assume any plugin's
  return or cancellation mechanism (§6.3).
- It does not activate the retired IndexedDB migration machinery, and it does not introduce
  a second storage authority or a second sync engine (§7.1).
- It does not change the existing Web application, the Web backend, or any API route.
- It does not promote Brower acceptance Gate C or Gate D.
- It does not assert any Android behaviour.
- It does not decide P1–P7. In particular it does **not** answer P2, and §7.5's "no
  transfer" is a **recommendation** that no stage may treat as the answer.
