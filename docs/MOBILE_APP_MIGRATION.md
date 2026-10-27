# Mobile App Migration — Shared iOS/Android Architecture

**Status:**

- **Stage M1 — implemented.** Device acceptance is **partly user-reported**: the developer
  reports the prescribed *visible* launch and layout checks working on a physical iPhone.
  `crypto.randomUUID` and external links have **not** been reported and are not verified.
- **Stage M2a — implemented and verified locally by automated tests** (configured native API
  origin, server CORS, and the email-OTP groundwork; see
  [ADR-0047](adr/0047-configured-native-api-origin-boundary.md)). The server CORS change is
  **not deployed**. Email login on the old iPhone installation was user-reported
  (2026-09-29, M2a below); **complete OTP/API acceptance on the new target remains open**.
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
download does not produce a file the user can keep.

> **Resolved by Stage M3a.** Delivery now goes through `src/lib/platform/fileExport.ts`.
> Each call site builds a typed request (`sessionCsvExport`, `historyCsvExport`,
> `assessmentCsvExport`, the Team-result and diagnostic-log builders) and the boundary
> delivers it. **Serialization is untouched** — same columns, same field semantics, same
> privacy filtering.

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
| **File export** | An anchor download yields no keepable file on either platform (§2.7) | **Yes — IMPLEMENTED in Stage M3a.** `src/lib/platform/fileExport.ts`: Web keeps the anchor; native writes a UTF-8 file into an app-owned export cache and presents the share sheet |
| **External links** | `target="_blank"` must open the system browser | **Yes — IMPLEMENTED in Stage M3a.** `src/lib/platform/externalLink.ts` + `components/platform/ExternalDocumentLink.tsx`, applied at the audited sites only |
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

# 4. Product decisions — open and settled

**P2 and P6's direction were settled by the user on 2026-09-29** and are recorded as answers
below; their rows are a decision record, not a proposal. **P1, P3, P5 and P7 remain
unresolved; P4 is partly settled** by the iOS identity/account decisions below. The user
approved the local identity change, native-file generation and unsigned Release check on
2026-10-21 after reporting the old test app running. This is not an installation, storage
activation or distribution approval. For each unresolved part, the stage it blocks is named;
work before that stage proceeds without it.

**P6's direction being settled does not make it designed, implemented or verified** — see
Stage M3b0. The decision it depended on, **where the provider session is stored (§10 M3b0 §4),
is now SETTLED (user decision, 2026-09-30): S2 — a Keychain/Keystore-backed protected
store**, and Stage M3b3's composition is implemented on that basis. **Two things are settled
with it and must not be re-opened as questions:** all existing local iPhone application data
is **preserved** — no pilot reset, uninstall/reinstall, storage clearing or discarding of
unsynchronised work is authorised — and existing local data must be **migrated and verified
before** any production storage cutover. **Cutover itself is still not implemented**
(Stage M3b5), and the migration it depends on is Stage M3b4.

| # | Decision | Blocks | Why it blocks that stage |
| --- | --- | --- | --- |
| **P1** | **Long-term Web plus mobile support, versus eventual mobile-only delivery.** | **Nothing before M6.** | The migration is non-regressive either way. It becomes load-bearing only when distribution commitments and long-term Web maintenance are budgeted. Recorded so that no stage silently assumes the Web app is disposable. |
| **P2** | ~~Must the first mobile pilot transfer browser-local drafts and unsynchronised data?~~ **DECIDED (2026-09-29): NO for the first pilot.** Data existing only inside Brave or another browser is **not** transferred. Already-synchronised cloud records continue to restore through the existing cloud path. This is **not** authorisation to delete browser data, and it does **not** cover migration between storage engines inside the installed native app — a different operation that **remains required** (P6). Cloud synchronisation of authored Training Plans and other local-only domains stays a separate, unscheduled feature. | Was M3's data-transfer scope. **Now settled**; M3's remaining scope is engine migration (Stage M3b), not browser import. | The recommendation in §7.5 is now the recorded answer. A browser→app transfer path would need its own integrity, authorisation and Profile-ownership model; that scope is deliberately out of the first pilot. |
| **P3** | **Must production measurement continue during backgrounding or screen lock?** | **M4** (Brower production capture), and the **`Info.plist` / manifest** content from M1 onward. | `UIBackgroundModes: bluetooth-central` changes Apple review exposure, and Android background BLE has an entirely different model. **M1 scaffolds foreground-only and declares no background mode** — the currently exercised scope. That is a reversible starting point, not an answer: adding a background mode later is a configuration and review change, whereas declaring one speculatively is an unjustified capability claim. Nothing in M1 implies approval. |
| **P4** | **PARTLY DECIDED (user, 2026-10-21): iOS app name `Evolane Curling`, bundle ID `me.evolane.curling`, team `J98U2J78B3`, Individual membership, primary language English (U.S.), German deferred.** Hermes reports registered Explicit App ID and App Store Connect record `6825376799`, SKU `evolane-curling-ios`. Local Debug/Release identity configuration follows these values; no device install or upload is approved by that change. **Still separate:** callback domain, full release/distribution acceptance and Android identity/Google Play commitments. API origin remains `https://curling.evolane.me` (ADR-0047). | iOS identity is no longer an M1 placeholder. **M2's HTTPS callback path** still needs its own domain decision; **M6** still needs all applicable acceptance gates. | The old source installation is `local.dev.curlingperformance`; a new ID has a separate container and does not transfer its data or credentials. Preserve that installation until a complete transfer/restore path is verified. No domain association, redirect allow-list, capability or signing/provisioning mutation is implied. |
| **P5** | **Does the required alternative login satisfy Apple guideline 4.8?** | **M6** (distribution readiness); influences **M2**. | Guideline 4.8 requires an app using Google Sign-In for the primary account to also offer a login service that limits collection to name and email, **allows the user to keep their email address private**, and does not collect interactions for advertising without consent. Email OTP collects only an email address, but it does not offer an email-privacy relay. Whether that satisfies the second bullet, or whether Sign in with Apple must be added, is a product and review-risk decision. **Preserve Web's existing Google and email choices.** The user-approved first iOS club beta is email-only (§6.1, 2026-10-21); that bounded UI exception does **not** resolve future P5 or establish distribution acceptance. |
| **P6** | ~~How is native local persistence made durable enough to accept?~~ **DIRECTION DECIDED (2026-09-29): Option B — adopt durable native local storage behind the existing persistence boundary.** WebView `localStorage` is **not** retained as the native production store by merely accepting its eviction risk. Both iOS and Android are designed for, with shared application logic. Data already inside the installed iOS app is preserved through a **controlled migration**. Existing Profile ownership, repository boundaries and cloud-synchronisation logic are kept. **Engine evidence is gathered IN THE EXISTING APP (user decision, 2026-09-30), not in a separate harness application.** **Two further points are now DECIDED (2026-09-30): ALL existing local application data is PRESERVED — a pilot reset is rejected — and existing local data must be migrated and verified BEFORE production cutover.** | **M3.** The direction is settled; the **implementation and its acceptance gate are NOT complete**. | **Decision made ≠ designed ≠ implemented ≠ verified.** The design is Stage M3b0 (§10) and [ADR-0049](adr/0049-durable-native-local-storage-and-migration.md), whose **migration design was approved by the user on 2026-10-19**; its decision core (M3b4a) and its dormant executor (M3b4b) are approved (2026-10-20), with no application path invoking the executor, and U2's first-version recovery policy and UG-1–UG-4 are decided (§10 M3b0 §6) while its interface (M3b4c) is implemented as a dormant, dependency-injected layer awaiting independent review (what remains: §7's inventory). The M3b1 adapter and in-app diagnostic panel exist, **user-reported device evidence now exists within the stated limits** (M3b1 status in §10), and **Stage M3b3's composition is implemented behind an off-by-default build flag**. Still absent: **no migration has run, no cutover, and therefore no native production path** — a flag-enabled build blocks rather than mounting. |

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

**First iOS club beta — DECIDED BY THE USER (2026-10-21): email code only.**
The iOS sign-in and reauthentication surfaces do not render Google or its alternative-method
separator; requesting an email code is the primary action. Web retains its existing Google
and email choices. This does not implement native Google sign-in, change identity authority,
or waive any credential, migration, installation-preservation or device-acceptance gate.

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
| **B. A native `StorageAdapter` implementation behind the existing interface** | A new adapter backed by the Capacitor Preferences API or SQLite, selected per platform | **CHOSEN (2026-09-29).** See §10 Stage M3b0 and [ADR-0049](adr/0049-durable-native-local-storage-and-migration.md). Option A — keeping `localStorage` and merely accepting the eviction risk — was **explicitly rejected** |
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

## 7.5 P2 answered (2026-09-29): no browser transfer in the first pilot

**P2 is decided.** For the first mobile pilot, data that exists **only** inside Brave or
another browser is **not** transferred into the app. The user approved this on 2026-09-29.

What follows from it, stated precisely because three different operations are easy to
conflate:

- **Browser → app transfer: deferred.** Sign in, restore successfully-synchronised cloud
  records, and state plainly which local-only items do not follow. The reason is unchanged:
  a transfer path needs its own integrity, authorisation and Profile-ownership model.
- **This is not authorisation to delete browser data.** Nothing in this decision removes,
  clears or retires anything in a browser profile.
- **Engine migration *inside* the installed native app is a DIFFERENT operation, and it
  remains REQUIRED.** Moving existing on-device data from WebView `localStorage` to the
  durable native store is P6's work (Stage M3b), not P2's. Deferring browser import does
  not defer that.
- **Cloud synchronisation of authored Training Plans and other local-only domains remains a
  separate feature**, neither scheduled nor implied by this decision.

The historical framing below is kept because it explains why the answer is what it is:

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
| CSV / JSON export | `src/lib/export.ts`, `src/lib/assessment/export.ts`, `ExerciseTeamResultsScreen.tsx`, `src/lib/brower/diagnosticLog.ts` | **RESOLVED in Stage M3a.** All four build a typed request delivered by `src/lib/platform/fileExport.ts`: anchor on Web, file + share sheet on native |
| `next/font/google` (Geist) | `src/app/layout.tsx` only | Not available in the mobile entry. CSS already falls back; self-hosting is optional |
| Public exercise diagrams | `exerciseAssets.ts`, `public/exercise-diagrams/` (67 files) | Bundled. Relative fetch resolves against the local origin |
| Restricted diagrams | `createAuthorizedRestrictedAssetResolver` | No production call site today. Would need the §5.2 API origin if revived |
| Safe areas | `globals.css` `.app-content-clearance`, `layout.tsx` `viewportFit: "cover"` | **Already correct** — but the mobile HTML shell must reproduce `viewport-fit=cover` or the insets resolve to 0 |
| Keyboard | numeric entry throughout training/assessment | Native keyboard overlays differ. Needs device verification, possibly the Keyboard plugin's resize behaviour |
| Navigation | in-memory `ActiveView` (ADR-0009) | No router to reconcile. **Android's hardware back button has no mapping today** and needs an explicit decision |
| External links | five sites: `SettingsScreen.tsx` ×2, `IdentityGateScreen.tsx` ×2, `PrivacyNotice.tsx` | **RESOLVED in Stage M3a** via `ExternalDocumentLink`: Web keeps the ordinary anchor, native opens the platform browser instead of navigating the app WebView away |
| App lifecycle | none used today | Needed for the bootstrap delivery owner — launch URL **and** `appUrlOpen` (§6.6) — and, later, for capture invalidation (§10 M4) |
| `crypto.randomUUID` | `identityRuntime.browserIdSource()`, `createManualTimingResult` | Returns `null` → runtime unusable if absent. **Verify on device**; do not assume |
| Status bar / splash | — | Cosmetic, but a splash that never dismisses is a launch failure. Include in M1 |

## 8.2 Proposed plugins

Each is a proposal, with the compatibility position stated. **Versions are not pinned
here**; they are resolved and locked when the stage that needs them is implemented.

| Plugin | Why | Position |
| --- | --- | --- |
| `@capacitor/app` | `appUrlOpen`, `getLaunchUrl`, foreground/background state, Android back button | **Adopted at 8.1.1 for the assisted capture pilot's foreground/background boundary** (ADR-0050). `appUrlOpen`/`getLaunchUrl` remain required by, and unimplemented until, M2 |
| An authentication-browser plugin — **unselected** | Open the authorization URL outside the app WebView | Required by M2, and **the selection is a Stage M2 decision with its own verification.** **`@capacitor/browser` uses `SFSafariViewController` on iOS; it is *not* `ASWebAuthenticationSession`**, and its `browserFinished` event does not distinguish cancellation from completion. Whichever plugin is chosen, its **documented return and cancellation mechanism** must be recorded before it is adopted — see §6.3, whose design deliberately does not depend on a trustworthy cancellation signal |
| `@capacitor/filesystem` + `@capacitor/share` | Export adapter: write the file, then offer the share sheet | Required by M3. Already exercised together in the probe (`export_shared`, and a distinct `export_cancelled`, in the archived evidence) |
| `@capacitor-community/bluetooth-le` | Brower transport | **Adopted at 8.3.0 for the assisted capture pilot** (ADR-0050); full production M4 unchanged. Documented 8.x ↔ Capacitor 8.x. Bluetooth is **unavailable in the iOS Simulator** |
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
| **Permissions** | — | `NSBluetoothAlwaysUsageDescription` **declared** for the assisted capture pilot; no background mode | Runtime Nearby-devices permissions (Android, not implemented) — see §8.3 |
| **Auth callbacks** | shared PKCE, classifier and **pure `decideOAuthIntake`**; new attempt-scoped cell and warm continuation (§6.4) | Universal Link (recommended) or, if P4 forces it, the explicitly designed custom-scheme path of §6.2 Option 2 | App Link, same fallback. Association needs the **release signing** SHA-256, which ties it to M6 |
| **Local persistence / offline restart** | shared `StorageAdapter`, Profile-scoped keys, one authority | **Durability is a documented platform limitation, not an untested unknown** (§7.1). Capacity is measurable (T-a) | Same transience warning; Android-only persisted-storage API is a partial mitigation for IndexedDB, not `localStorage` |
| **File export** | one adapter interface | Filesystem + share sheet. **Both a completed share and a cancellation** are evidenced in the probe's own export | **Untested** |
| **BLE and lifecycle** | one transport interface, **implemented** for the pilot (ADR-0050), with no write operation | Connection, discovery, notifications and foreground lifecycle **evidenced** (2026-09-28, probe only). The pilot's own live two-gate behaviour is **not yet evidenced**; background-while-listening **not** evidenced and not attempted | **Untested in every respect** |
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

**Current identity and API origin — no longer M1 placeholders.** P4 records the confirmed
iOS identity **Evolane Curling / `me.evolane.curling`**, team **`J98U2J78B3`** and the
membership, Store-record and language state. The API origin is **`https://curling.evolane.me`**
(ADR-0047). **M1 must not be described as producing a distributable app**: callback-domain,
Android and full distribution acceptance remain separate open parts of P4. Nothing in M1
registers a scheme, a domain, or a provider redirect, or authorizes installation.

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

### M1 — historical implementation status (2026-09-28)

The identity, placeholder and account observations in this dated record describe the old
source, not today's target. Current iOS identity/account decisions are in P4; later API
configuration is in M2a. These old device observations do not establish new-target acceptance.

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

**P4's still-open callback decision and the two possible shapes of this stage.** Google sign-in needs a callback
destination, and §6.2 offers exactly two:

- **P4's callback decision answered with a domain** → Option 1 (HTTPS). The prerequisites are the AASA /
  assetlinks hosting, the Associated Domains entitlement / intent filter, and the Supabase
  allow-list entry. `isUsableUrl`, `isValidRedirectTarget` and `validateAuthorizationUrl`
  are **unmodified**.
- **P4's callback domain unresolved, and the user explicitly chooses the fallback** → Option 2
  (custom scheme). This is **not free**: it requires the new configured-destination
  predicate, routed into both validators, keeping the `http:`/`https:` path byte-identical
  for Web, plus scheme registration and an allow-list entry. It must be an explicit product
  choice, because it weakens destination assurance relative to a domain-verified link.

**Google sign-in may not be both deferred and required for completion.** If neither option
is available, this stage can complete only as **M2-partial**, after the required device
acceptance, with an explicit status: email OTP and authorized API access work on device;
**Google remains implemented in shared code and visible on Web**, with its native callback
path unfinished and named as remaining work. **The first iOS club beta is the approved
email-only UI exception (§6.1, 2026-10-21)**; do not restore Google to its gate or
reauthentication surface to satisfy this rule. This exception does not complete or reclassify
M2, waive its device gates or resolve P5. M3 may proceed on M2-partial; **M6 may not** under
this stage's completion rule; any distribution-scope revision requires separate approval.

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
This settles the API destination only. **P4 separately confirms the iOS name, bundle ID,
team, membership, Store-record and language state**; it does not settle the native Google
callback domain, Android commitments or full release/distribution acceptance.

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
cancellation UX (P7). **Google remains implemented in shared code and visible on its existing
Web path; the first iOS club beta omits it under §6.1's approved email-only exception.**
Nothing here claims it works natively or changes M2's completion status.

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

**Physical-device acceptance for M2a — PARTLY user-reported, not agent-executed.**

On **2026-09-29** the user reported, from the app installed on their iPhone:

- email login works;
- a training recorded and completed on iOS appears in the Brave Web app;
- an offline cold start, recording and saving a short training, another offline restart,
  and subsequent cloud synchronisation all worked in their test;
- the receiving Web app had to be closed and reopened before the new training appeared in
  History and Analyze.

**These are user-reported device observations, recorded as such.** No agent executed them,
no log or measurement was produced here, and they are not a substitute for the acceptance
matrix. In particular they do **not** establish storage-pressure durability (P6), every
M2a acceptance case, new-account onboarding, account-switch isolation, or offline
exercise-diagram behaviour — and the last item is a known Web-side refresh gap that Stage
M3a deliberately does **not** address (no refresh-on-focus, no realtime subscription).

No on-device Team API call has been made. (M1's *visible* launch and layout checks are separately
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

**P2 is ANSWERED (§7.5).** No browser→app transfer in the first pilot; already-synchronised
cloud records restore through the existing path. M3's data scope is therefore settled, and
the §11 acceptance criteria no longer wait on it. **Engine migration inside the installed
native app is a separate, still-required operation** and belongs to Stage M3b below.

**P6's DIRECTION is decided; its implementation and acceptance gate are NOT complete.**
Option B — a durable native `StorageAdapter` implementation — is chosen (§7.1). Its design is
**Stage M3b0** below, recorded in
[ADR-0049](adr/0049-durable-native-local-storage-and-migration.md), whose **migration design
was approved on 2026-10-19; its decision core (M3b4a) is approved and a dormant executor
(M3b4b) exists, but no application path invokes it and no migration has run anywhere**. As of 2026-09-30 Stage M3b1's adapter and opt-in in-app diagnostic
panel exist, **user-reported device evidence exists within the limits stated under Stage M3b0
§7**, and **Stage M3b3's composition is implemented behind its own off-by-default build
flag**. What is still absent is the part that would change anything for a user:
**nothing is migrated and nothing is cut over**, so **no build has a working native
production path** — with the flag on, the application deliberately does not mount. This stage
cannot be called complete until M3b4 and M3b5 are implemented, independently reviewed and
accepted on a device (M3b6).

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

### Stage M3a — native file export and external public links (implemented)

**Status:** **Implemented and verified by automated tests and an unsigned native build.**
**M3a does not complete M3.** P2's first-pilot transfer scope and P6's storage-durability
decision are untouched and remain open, no capacity measurement (T-a) was taken, and no
M3a physical-device test has been performed.

**What it implements.**

| Piece | Where |
| --- | --- |
| The one file-delivery boundary, Web + iOS/Android | `src/lib/platform/fileExport.ts` |
| The component surface: progress, outcome, retry, unmount/account-switch safety | `src/components/useFileExport.ts`, `FileExportStatusNotice.tsx` |
| Delivery requests replacing four ad-hoc download mechanisms | `src/lib/export.ts`, `src/lib/assessment/export.ts`, `ExerciseTeamResultsScreen.tsx`, `src/lib/brower/diagnosticLog.ts` |
| Public-document links that do not replace the app WebView | `src/lib/platform/externalLink.ts`, `src/components/platform/ExternalDocumentLink.tsx` |
| Apple required-reason declaration for Filesystem | `ios/App/App/PrivacyInfo.xcprivacy` (`NSPrivacyAccessedAPICategoryFileTimestamp`, reason `C617.1`) |

Plugins added: `@capacitor/filesystem@8.1.3`, `@capacitor/share@8.0.2`,
`@capacitor/browser@8.0.4` — all Capacitor 8.x, no framework upgrade, no existing
dependency version changed.

**Serialization is untouched.** Every CSV and JSON payload, its columns, its field
semantics and its existing privacy filtering are exactly what they were; only delivery
moved. No export gained an additional athlete record or identifier.

**Outcomes are distinguished, and none of them overclaims.** `shared` means the plugin
resolved, and what that *means* differs by platform: on **iOS** the chosen activity finished
with the items it was given, while on **Android** the **chooser returned**, which says
nothing about whether the recipient has read the `FileProvider` URI yet. **Neither is proof
that the receiving app durably saved anything**, which no platform reports — the difference
between them is exactly why the file lifetime below is platform-specific. Web reports
`unconfirmed`, because a browser download exposes no completion signal at all.
`cancelled` is used **only** on the Share plugin's own
exact `"Share canceled"` rejection (identical on iOS `SharePlugin.swift` and Android
`SharePlugin.java`); an empty `activityType` is an ordinary documented result and is never
read as cancellation, and an unknown error is `share_failed`, never "you cancelled".
`write_failed`, `share_unavailable`, `busy` and `unsupported_platform` are separate.

**Attempt ownership.** Every export attempt carries a non-revivable ownership identity.
Unmount and a Profile switch **retire** it, and the boundary revalidates ownership after
each asynchronous preparation step and once more immediately before the irreversible
`share()`. A retired attempt never opens a share sheet and its unshared file is discarded.
Ownership rides a **monotonic generation**, not the owner value, so A → B → A cannot revive
A's earlier attempt. Callers that pass no `ownerKey` are covered too: the Profile-keyed
remount unmounts them, and unmount alone retires the attempt. A late completion can neither
update another owner's screen nor release a newer attempt's guard.

**One native attempt at a time.** The share claim is taken **synchronously, before the
first `await`**, and released in a single finalizer that runs after cleanup. Checking a flag
before an await and setting it afterwards left a window in which two independent callers
both passed and two share sheets opened. Every terminal path — loader failure, sharing
unavailable, write failure, cancellation, share failure, retirement, failed cleanup —
releases its own claim, and only its own: a stale completion cannot clear a newer one.

**Resource protection.** An attempt's directory is registered **before** it is created, not
after the write resolves, so no sweep can reach a file that is still being written.

**Temporary-file lifetime is platform-specific, because the two plugins report different
things.**

| Platform | Mechanism | Policy |
| --- | --- | --- |
| iOS | `UIActivityViewController.completionWithItemsHandler` fires with `completed == true` only once the chosen activity has finished with the items (`SharePlugin.swift`) | Delete this attempt's directory as soon as `share()` settles |
| Android | `FileProvider.getUriForFile` + `FLAG_GRANT_READ_URI_PERMISSION` + `Intent.createChooser` + `startActivityForResult`; `activityResult` reports that the **chooser returned** (`SharePlugin.java`) | **Retain.** The callback is not a consumption receipt — a mail client that queues a draft, or a cloud app uploading in the background, reads the content URI after our activity has resumed |

**An Android `activityResult` is not evidence that the receiving activity finished its work
or saved anything**, and nothing in the implementation or the UI says otherwise. See
<https://developer.android.com/training/secure-file-sharing/share-file>.

Every export directory carries its creation time in its name, so a later sweep can
distinguish an abandoned directory from one still inside the retention window. **The
threshold is measured from that creation timestamp, not from settlement of the share
promise** — by the time a sweep runs, the attempt that shared the file is gone, and the
creation stamp is the only age recoverable without a second source of truth. The sweep is
bounded, confined to `curling-exports/`, skips any directory a live attempt owns, skips any
still within the Android retention window, and refuses to delete a directory whose name
carries no parsable age rather than guessing. **A subsequent export respects retained
siblings.**

**Residual limits, stated rather than engineered away.** The retention window
(`ANDROID_RECIPIENT_RETENTION_MS`, 24 h) is a bounded guess, not a guarantee that a
recipient has finished: a recipient that takes longer will find the file gone. Because the
window runs from directory creation rather than from the share settling, the time a
recipient actually gets is **shorter than the nominal 24 h** by however long the share sheet
stayed open before a target was chosen. These files live in the OS-managed **cache**
container, so iOS or Android may evict them sooner under storage pressure — the app cannot
prevent that and does not claim to. Deleting before `share()` settles is never correct on
either platform.

**Known limitation — revocation.** Once the operating system has presented a share sheet it
**cannot be revoked**: no plugin exposes that. Retirement therefore stops an attempt only
*before* `share()` is invoked; past that point the attempt runs to completion and only its
on-screen claim is dropped. A second export is refused with `busy` rather than stacking
sheets.

**Native links.** App-relative legal routes resolve against the configured public HTTPS
origin (ADR-0047) — never `capacitor://localhost` and never the local bundle, which serve
no legal documents. Absolute destinations pass the application's existing
`parseSafeLegalUrl` validator, so the **exact versioned document** trusted metadata supplied
is preserved rather than replaced by a generic page. `javascript:`, `data:`, `file:`,
`blob:`, `mailto:`, plain `http:` and malformed values are refused without invoking the
browser. A launch failure is shown next to the link and the application does not navigate
away. No token, authorization code or private state is ever attached to a destination.
**This is public-document browsing only — it is not an authentication session and not an
OAuth flow.**

**Android readiness.** The shared implementation dispatches on the same trusted platform
signal and is covered by automated Android-dispatch assertions. That is **adapter evidence,
not Android device verification**: no Android project exists and Android remains M5.

**Automated verification.** `npm test` 207 files / 3439 tests; `npm run mobile:test` 6
files / 59 tests; `npm run test:e2e` 108 passed; `npm run build` and `npm run mobile:build`
succeeded; unsigned `xcodebuild` for `generic/platform=iOS` **BUILD SUCCEEDED**, with the
privacy manifest present in the built app, all three plugin classes linked, bundled assets
matching `mobile/dist` apart from Capacitor's shims, and **no** background mode, Bluetooth
permission, URL type, ATS exception, file-sharing flag or entitlement added.

**Physical-device acceptance for M3a — PARTLY reported by the user, not agent-executed.**
On **2026-09-29** the user reported, from the app on their iPhone:

- **CSV export works**, including in airplane mode;
- the **Privacy Notice opens in the native Safari browser surface**, after rebuilding with
  the configured public API origin.

**Team JSON export is explicitly deferred** because no Team results are available to export.

**Nothing else from the M3a procedure has been reported**, and nothing else may be described
as passing: Terms of Service, share-sheet cancellation, retry, the double-tap guard and
return-to-app state preservation are all **still unperformed**. The remaining steps are in
`mobile/README.md`.

---

### Stage M3b0 — durable native persistence: design and staged plan (this stage)

**Status: DESIGN.** This section is the design; what has been BUILT from it is listed under
§7's stage table and M3b1/M3b3 status entries, and the two must not be read as the same thing.
As of 2026-09-30 the adapter (M3b1/M3b2), the in-app diagnostics panel and the **composition,
identity injection, protected credential store and readiness gate (M3b3)** exist; the
**cutover (M3b5) does not**, and the recovery interface (M3b4c) exists only as a dormant,
dependency-injected layer that no shipped path constructs. §5's protocol is an
**approved design (user approval 2026-10-19)**; its decision core (M3b4a) is approved
(2026-10-20) and its **dormant** executor (M3b4b) is implemented, independently reviewed
(clean) and approved (2026-10-20) — no application path invokes it (§7, "M3b4a implementation
status" and "M3b4b implementation status"). U2's first-version recovery policy and UG-1–UG-4
are decided (§6); its interface (M3b4c) is implemented, dormant and awaiting review (§7, "M3b4c
implementation status"). §7's
inventory lists what still blocks M3b4's completion and M3b5. On 2026-10-15 the panel's
transaction scenarios were run on a **disposable iOS Simulator** (user-reported, real native
plugin; §7, "M3b1 real-engine simulator evidence"); no physical-device transaction evidence
exists.
**Decision made ≠ designed ≠ implemented ≠ verified** still applies, per stage rather than to
the whole of M3b.

#### 1. Storage inventory

Audited against the working tree, not assumed. Every sporting key is written **whole-document
as one JSON string per key** through `StorageAdapter`; `SESSION_HISTORY_STORAGE_KEY` and the
sync record have **no size cap**, which is the decisive sizing fact below.

| Data category | Physical key / namespace | Owner | Reader / writer today | Proposed store | Migration policy |
| --- | --- | --- | --- | --- | --- |
| Sporting data — the **closed allow-list** `PROFILE_SCOPED_SPORTING_STORAGE_KEYS` (the 10 `SPORTING_STORAGE_KEYS`, plus `ASSESSMENT_DRAFT_STORAGE_KEY`, `ASSESSMENT_HISTORY_STORAGE_KEY` and the sync key) | `curling.sporting.profile.v1.<profileId>.<key>` | Profile | 7 repositories via `createProfileScopedSportingStorageAdapter` | **Native key/value** | **Migrate — allow-list only.** Eligibility is `<prefix>.<canonical-UUID>.<key ∈ allow-list>`. **Importing every suffix under the broad prefix is NOT authorised**: an unrecognised suffix is an unknown key (see below) |
| Profile-scoped cloud sync state **and outbox** | the sync key **inside** that same Profile namespace, schema 6 | Profile | `createSportingSyncStateRepository` + sync manager | **Native key/value** | **Migrate. Highest priority** — outbox entries are completed work the cloud has never seen |
| Identity continuity — **5 fixed keys**: `curling.identity.trustedDevice.v1`, `.accessBarrier.v1`, `.interactiveAttempt.v1`, `.pendingIntent.v1`, `.intentCleanup.v1` | device-global, **not** Profile-scoped | Device | 5 repositories, each an **import-time singleton bound to `localStorageAdapter`** | **Native key/value** | **Migrate.** Losing these forces a re-sign-in, which needs a network |
| Identity continuity — **dynamic family**: `curling.identity.accessBarrierResolution.<barrierId>.v1`, one key per barrier | device-global | Device | `identityBarrierResolutionRepository` | **Native key/value** | **Migrate by MEMBERSHIP TEST, not by a fixed list.** `isResolutionStorageKey` (prefix + `.v1` suffix + **canonical-UUID middle**) is the only admissible test; `resolutionStorageKeyFor` constructs them. A previous version of this table said "6 keys" and was **wrong** — the count is unbounded |
| Provider session (refresh/access tokens) | Supabase SDK default keys | Supabase SDK | `createClient(...)` with **no `storage` option** → `window.localStorage` | **Explicit decision required — see §4** | **Not a plain copy.** Confidentiality and deletion semantics differ |
| Public exercise-diagram data-URL cache | `curling-performance-public-exercise-diagram-v1.<assetId>` | Device | `createPublicExerciseAssetResolver` in `exerciseAssets.ts`, via the **default** adapter | **Unchanged — stays on `localStorageAdapter`** | **Do not migrate** — disposable and re-derivable from the bundle. **But skipping migration does NOT stop it refilling the native store:** the resolver re-fetches and calls `saveCachedDiagram` on every miss. **DECIDED for Stage M3b3: option (a)** — it keeps its existing path. `TrackerApp` calls `createPublicExerciseAssetResolver()` with no adapter, which defaults to `localStorageAdapter`, and Stage M3b3 changes **no** global default, so the cache is untouched by composition rather than excluded by a special case. The diagrams are bundled locally, so the cache buys little on native anyway, and keeping 67 base64 data URLs out of the native store keeps them out of its sizing too. **Revisiting this belongs to whichever stage measures the native store's real load, not to composition.** |
| Legacy unscoped retirement marker | `curling.sporting.legacy-unscoped-retired.v1` | Device | `retireLegacyUnscopedSportingData` | **Native key/value** | **Migrate the marker itself**, so retirement is not re-run |
| Retired legacy unscoped sporting keys | the 10 bare keys | — | nothing reads them in production | **Do not create** | **Never adopt.** ADR-0026 retires them content-blind; migration must not resurrect or reassign them to the current Profile |
| **Unrelated unknown keys** — no recognised shape, owned by nothing this app persists | — | unknown | — | not migrated | **Not imported, not deleted, recorded.** Safe to omit precisely because **no repository will ever hydrate them**, so omission cannot produce a default-over-data write. Classification is by **key shape only**; no user record is inspected |
| **Known application-owned keys whose CONTENT is unsupported or malformed** | any allow-listed sporting key, identity key or the sync key | Profile / Device | the owning repository | **Native — copied VERBATIM** | **Never skipped.** Migration copies bytes and does not parse domain payloads, so an unsupported *domain record version* is not a migration concept. The owning repository's existing validation/quarantine policy applies after cutover, unchanged. This is deliberately **not** the same thing as an unsupported **activation-record** version, which blocks (M3b0 §5.4 rows A3/A4) |

**Disposable vs irreplaceable.** Only the diagram cache is disposable. Everything else is
either irreplaceable (drafts, plans, preferences, outbox) or costly to lose (identity
continuity, provider session).

#### 2. Engine choice — write semantics first, then shape

**The earlier version of this section evaluated API shape and size and concluded
`@capacitor/preferences`. That conclusion was wrong for the migration's needs, and is
corrected here.** The decisive question is not "does the API fit" but "can this engine tell
us a write reached disk?" — because the migration deletes the source afterwards.

**Primary-source findings — `@capacitor/preferences` 8.0.1** (inspected from the published
tarball; paths are inside that package):

| Finding | Evidence |
| --- | --- |
| Android writes use `SharedPreferences.Editor.apply()` | `android/src/main/java/com/capacitorjs/plugins/preferences/Preferences.java`, `executeOperation` → `editor.apply()` |
| `apply()` updates memory immediately and writes to disk **asynchronously**, returning `void` — it reports no failure | Android `SharedPreferences.Editor` documentation: <https://developer.android.com/reference/android/content/SharedPreferences.Editor#apply()> |
| iOS writes call `UserDefaults.standard.set(...)` | `ios/Sources/PreferencesPlugin/Preferences.swift` (`set(_:for:)`) |
| The iOS plugin method **resolves unconditionally** after that call — it has no failure path at all | `ios/Sources/PreferencesPlugin/PreferencesPlugin.swift` (`@objc func set` → `call.resolve()`) |
| `UserDefaults` persists asynchronously; `synchronize()` is deprecated and is not a durability tool | <https://developer.apple.com/documentation/foundation/userdefaults> |
| Reads come from the same in-memory representation | iOS `defaults.string(forKey:)`; Android reads the loaded map |

**Four properties that must not be conflated:**

1. **API acknowledgement** — `await Preferences.set()` resolved. **Provided.**
2. **Immediate read-back** — a subsequent `get` returns the value. **Provided, and
   worthless as durability evidence**: it can be served from the in-memory cache of a write
   that has not reached disk.
3. **Disk persistence with observable failure** — the write is on stable storage, and a
   failure is reported. **NOT provided by this plugin on either platform.**
4. **Restart recovery** — the value survives process death and reboot. **Not established by
   (1) or (2).**

**Consequence, stated plainly: the "copy → read back → mark complete → delete source"
protocol is unsound on Preferences.** Read-back cannot establish the *durable complete* that
source retirement depends on. A power loss between `apply()`/`set` and the OS flush can leave
a marker that says "verified" while the copied values are gone.

**This is not fixable by a delay, by the deprecated `synchronize()`, by a benchmark, or by
softer wording.** Three technically honest resolutions exist:

| Resolution | What it gives | Cost |
| --- | --- | --- |
| **R1. SQLite with an explicit transaction** (`@capacitor-community/sqlite` 8.1.1) | A real commit acknowledgement. A key/value repository can use **internal** transactions — §5.1's checkpointed batches plus a separate activation transaction, not one all-or-nothing transaction — without exposing SQL or multi-key transactions through `StorageAdapter`; the interface stays exactly as it is. **A native-only adapter needs no Web SQLite deployment; Web stays on `localStorageAdapter`.** | A larger dependency and a connection lifecycle to own |
| **R2. Preferences + never retire the source** | Durability improves for *new* writes; the migration never deletes anything, so the unsound step is simply not taken | Two copies persist indefinitely; the source keeps consuming the quota the migration exists to escape, and "which is authoritative" must still be answered |
| **R3. Preferences + a plugin-level durable-commit acknowledgement** | Would make the original protocol sound | Requires a fork or upstream change; **not available today** |

**Recommendation: R1 — SQLite for the native adapter**, precisely because the migration
requires a commit acknowledgement that Preferences does not offer. The earlier "no query
workload, so no SQL" argument is still true about *queries* — but it was answering the wrong
question. The engine is chosen for its **write semantics**, and the repository above it
remains a plain key/value store.

**Physical-device evidence exists for the CONFIGURATION and for restart recovery; real-engine
transaction evidence exists only from a simulator.** The user-reported iPhone measurement
(2026-09-30, recorded under §7) confirms the pragmas are actually in force and that written
values survive a process restart offline. That is sufficient for **composition** — it
establishes that the adapter opens, configures and reads back as designed. The user-reported
**simulator** run (2026-10-15, §7) then exercised commit, rollback, a statement failure, two
simulated lost acknowledgements and a process stop with a transaction open, all through the
real plugin, and every reopened store classified as §5.1 expects. It is **still not
sufficient for migration**: there is no physical-device transaction evidence, no naturally
occurring commit failure, no termination **during** a commit and no power-loss evidence, and
those are properties §5.1's checkpointed model rests on. R1 therefore stands for the adapter,
while **source retirement remains unjustified** — and unimplemented, since M3b4 does not
exist.

**If R1 is not accepted, activation stays blocked.** Under R2, `StorageAdapter` may be backed
by Preferences and **source retirement must not be implemented at all**; the migration then
has no "delete" phase and the design's preservation guarantee is met by never removing
anything. **What must not happen is keeping Preferences and deleting the source anyway.**

**Operating envelope and the escalation gate.** Session history and the sync/outbox record are
**uncapped single values**. Stage M3b1 measures representative **synthetic** datasets and
records a concrete envelope. **"Escalate to SQLite" is an engineering gate, not a runtime
capability**: no runtime engine switching exists or is proposed. If an installation later
exceeds the recorded envelope, that is a **separately specified migration** (engine → engine,
reusing this same protocol), not something the app does by itself. Under R1 the envelope
question largely dissolves, which is a further argument for it.

#### 3. Composition and contracts

**IMPLEMENTED in Stage M3b3 (2026-09-30), behind an off-by-default build flag.** Everything
in this subsection is now built and tested; what it does NOT do is cut over — see the M3b3
status entry in §7 for exactly what exists, and for the barrier that keeps a flag-enabled
build from mounting.

- **Initialisation** happens in the mobile composition (`mobile/src/MobileApp.tsx`, via the
  lazily-imported `mobile/src/storage/NativeStorageCompositionRoot.tsx`) **before** the
  application tree mounts, not inside a component effect that a mounted consumer could race.
- **Readiness gating:** hydration, identity startup, provider-session restoration and the
  sync manager must all observe a single *storage-ready* verdict. The existing identity gate
  already refuses to mount the sporting shell before a correlated ready verdict; storage
  readiness composes **in front of** it. **Nothing may read a default while storage is still
  preparing.**
- **Platform selection** reuses the trusted `detectRuntimePlatform()` signal (ADR-0047) —
  never a user-agent string. **Web keeps `localStorageAdapter` byte-for-byte.** An
  unrecognised native platform **fails closed** rather than silently using the Web adapter.
- **Reaching every consumer is the hard part, and swapping one default does not do it.**
  **Five** distinct seams exist. Each is now wired through one owned composition
  (`src/lib/persistence/storageComposition.ts`), and the three sporting ones are handed to
  `ProfileScopedSportingPersistence` as a single `SportingStorageSeams` object
  (`src/lib/persistence/storageSeams.ts`) precisely so they cannot be chosen independently
  and one of them forgotten:
  1. the 7 sporting repositories — `createProfileScopedSportingRepositories(profileId,
     adapter)`, reached from `ProfileScopedSportingPersistence.tsx`;
  2. the **separate sync-state adapter** — `ProfileScopedSportingPersistence.tsx` builds a
     *second* adapter with `createProfileScopedSportingStorageAdapter(profileId)` **and no
     adapter argument**, then hands it to `createSportingSyncStateRepository`. Missing this
     seam would leave the outbox on `localStorage` while everything else moved;
  3. the **legacy-retirement call** — the same component calls
     `retireLegacyUnscopedSportingData()` with no argument. After cutover it must target the
     store that actually holds the legacy keys, or it will "retire" nothing and re-run forever;
  4. the **5 identity repositories** — `export const …Repository = create…()` evaluated **at
     import time**, so a default swap cannot reach them; they need explicit injection at
     startup, which is a real, reviewable code change and a named stage prerequisite.
     Implemented as `createIdentityRepositorySet(adapter)` plus a one-time
     `claimIdentityRepositories()` ownership slot in `identityRuntime.ts`.
     **One concrete defect was found and fixed here:** `identityRuntime.loadPendingIntent()`
     reached the imported module-level singleton directly, separately from the coordinator's
     own `intents` dependency — under injected ownership those are two different stores, so
     the provider could have read a pending intent from one workspace while every coordinator
     transition wrote to another. It now uses the same injected repository the coordinator
     was built with;
  5. the **Supabase SDK session** — `createClient` passed no `storage` option. Implemented as
     a one-time `claimBrowserAuthStorage()` slot, claimed **before** any client exists,
     because the SDK reads storage from its own constructor. ADR-0025 Decision 10's three
     options are unchanged; `storage` is added and nothing else. See §4.

- **Key enumeration does not exist on the current interface, and must be added narrowly.**
  Neither `StorageAdapter` nor `RemovableStorageAdapter` exposes any way to list keys, and
  **`Preferences.keys()` enumerates the TARGET, not the WebView source.** Migration therefore
  needs a **migration-only** capability, specified as:
  `interface EnumerableStorageSource { listKeys(): Promise<{status:"value"; keys: readonly string[]} | {status:"read_failed"; error: PersistenceReadError}> }`.
  **Owner:** the source-side adapter only (`localStorageAdapter`), implemented over
  `localStorage.length`/`localStorage.key(i)`. **It is not added to `StorageAdapter`**, no
  repository may depend on it, and a `read_failed` enumeration **fails the migration attempt
  closed** — it must never be read as "the source is empty".
- **Contracts are unchanged.** `get`/`set`/`remove` keep their normalised results;
  `{status:"value", value:null}` still means absence at the raw layer and each repository
  still translates it to its own `absent`. **`read_failed` stays distinct from `absent` and
  never authorises writing a default** — the existing `write_protected` hydration state is
  the mechanism and is not weakened.
- **Profile identity of a write is preserved** because
  `createProfileScopedSportingStorageAdapter` has no mutable "current profile" pointer; a
  delayed write started by Profile A keeps A's physical key. The native adapter must not
  introduce one.
- **One authoritative store per datum after cutover.** No permanent dual writes, no parallel
  sync engine, and **no silent fallback to stale `localStorage` after activation**.
- **The retired IndexedDB activation/migration path stays retired** (ADR-0015–0018). It is
  not revived, and its dormant files are not deleted either.
- **Multi-key atomicity is named and bounded.** `StorageAdapter` does not promise it and
  still does not. The **migration alone** uses a transaction, **internally**, over the native
  engine's own connection inside the migration module (M3b0 §5.1's checkpointed model): each
  checkpoint commits a batch of rows together with its progress entry. **No repository sees
  it and the public contract is unchanged.** The earlier claim that the migration "needs none
  — it relies on a single durable marker written last" is **withdrawn**: a bare marker cannot
  keep committed progress and committed data in step.

#### 4. Provider session and credentials

Durable storage is **not** automatically secure credential storage, and **not** a backup.

**A previous claim here was wrong and is withdrawn.** It said co-locating the session with the
identity records makes their coherence "structural", and framed the choice as "one deletion
path versus two deletions that must both succeed". **Neither is true.** The Supabase SDK and
the identity coordinator perform **independent operations regardless of where their bytes
live**; a shared store does **not** make separate writes atomic, and asking for approval on
that basis would be asking on a false premise.

**What the existing protocol actually guarantees** (`identityTransitionCoordinator.signOut`,
ADR-0025):

1. the **access barrier is established FIRST** — before any intent mutation, any trusted-state
   removal and **zero provider calls**;
2. ordinary pending intents are deleted (required);
3. trusted state is removed (required);
4. non-current attempt cleanup (best effort);
5. checkpoint C8a;
6. **the provider call is LAST**, and `supabaseAuthService.signOut` uses `scope: "local"` and
   **reports failure honestly — a failed provider sign-out has not deleted the local session**;
7. checkpoint C8b.

**The barrier, not the provider call, is the latch. This authority rule is preserved unchanged
under every storage topology below.** Three concerns must therefore be kept apart:

| Concern | Mechanism today | Affected by storage choice? |
| --- | --- | --- |
| **Access revocation** | the durable barrier (step 1) | **No.** It is written first and denies regardless of what follows |
| **Local credential cleanup** | `signOut({scope:"local"})` deleting the SDK's stored session | **Yes** — this is where the session's bytes live |
| **Provider/server revocation** | the same call, server-side | **No** — a network concern, already best-effort |

##### Candidates against the same failure cases

**S1 — session in the native app-private store, beside identity.**
**S2 — session in a Keychain/Keystore-backed store.**
**S3 — session stays in WebView `localStorage`.**

| Failure case | S1 | S2 | S3 |
| --- | --- | --- | --- |
| Credential storage **inaccessible** (read failed — presence unknown) | Must **fail closed** on the readiness gate. Never reported as signed out, never treated as absence | Same; a locked device is one concrete cause | Same |
| Credentials **established as absent** (storage read successfully, no session) | Coherent with identity records, which share the same store and durability profile: the gate re-authenticates | Identity records may persist while the secure store holds nothing | `localStorage` eviction produces this state |
| Storage temporarily inaccessible | Startup **fails closed** on the readiness gate; nothing is reported as signed out | Same, plus a locked-device window where Keychain reads fail | Same as S1 |
| Interrupted / failed sign-out | Barrier already denies. Session bytes may remain until a later successful cleanup | Same, and the residue is in the secure store | Same |
| Backup/restore carrying part of the state | Both halves are in the same app-private store, so both travel or neither — **subject to the chosen file/backup attributes, not to the technology alone** | Depends on the item's accessibility/`kSecAttrSynchronizable` configuration; can travel **without** identity records | Depends on WebView backup behaviour |
| Reinstall with retained credential material | Not applicable: app-private data is removed on uninstall | On iOS a Keychain item **can survive**. **This does not sign anyone in** — the identity gate still admits, and the trusted-device record and barrier are gone, so the outcome is a stale credential with no identity context, which the gate must handle explicitly | Not applicable |
| Offline startup | Best: local records and session share one durable store | Works, unless the secure store is locked | **Worst** — an evicted session forces a re-sign-in, which needs a network, defeating part of P6 |

**DECIDED BY THE USER (2026-09-30): S2.** Provider credentials live in a **separate protected
store** — iOS Keychain, and on Android encrypted app-private storage whose keys are protected
by the Android Keystore — behind **one shared application-facing contract**. Native sporting
data and identity continuity records use the **SQLite** boundary instead.

**The earlier S1 recommendation below is SUPERSEDED and is retained only as the reasoning the
decision was made against.**

~~Recommendation: S1.~~ **SUPERSEDED.** Not because it makes anything
atomic — it does not — and **not because it removes any class of outcome**: writes to
credentials and to identity records are still separate, unordered and individually failable,
so a state where one is present and the other is not remains reachable under S1 and every
startup path must still handle it. The narrower, supportable claim is that S1 gives the two
halves the **same durability, backup and uninstall profile**, so they are not subject to
*different* eviction and restore rules. **No claim is made here about how often any of these
states occurs**; this document has no measurement to support a frequency comparison. S2's
stronger at-rest protection is real, and so is its survives-uninstall asymmetry.

**What S2 costs, stated rather than implied.** Every one of these is a consequence of the
decision, not an objection to it:

- **Separate stores are not one transaction.** The SDK's credential write and the
  coordinator's identity write remain separate, unordered and independently failable. S2 does
  not change that, and neither did S1 — the "structural coherence" claim was withdrawn above.
- **SQLite does not encrypt credentials**, and the protected store is not a durability
  guarantee. A resolved write is the platform's acknowledgement of a call, never proof the
  bytes survived a power loss.
- **The two halves now have DIFFERENT backup and uninstall profiles**, which is the one thing
  S1 would have avoided. Concretely: an iOS Keychain item can survive an uninstall while
  app-private data cannot. The chosen configuration narrows this deliberately —
  `kSecAttrAccessibleAfterFirstUnlockThisDeviceOnly`, which Apple documents as **not migrating
  to a new device**, so a restored backup on different hardware has no credential. **What is
  NOT claimed:** that the item is absent from every local or encrypted backup artefact, or that
  it cannot survive a same-device restore — Apple's wording is about device migration, and this
  repository has performed **no backup/restore measurement**, so backup behaviour remains
  unverified against the selected configuration. A reinstall on the same device can still leave
  credential material behind that no identity record matches. **That admits nobody:**
  the identity gate still decides, the trusted-device record and the barrier are gone, and the
  outcome is a stale credential with no identity context. It is **not** automatically erased
  either, which would be a broad deletion this stage does not authorise.
- **A locked device is a real failure mode.** `afterFirstUnlock` means reads fail only before
  the first unlock after a boot, which is narrower than `whenUnlocked` would have been — and
  when it does fail, it **fails closed**, never as a signed-out user.
- **Android key loss is a FAILURE, not an absence.** A restored Android backup carries the
  encrypted `SharedPreferences` rows but **not** the Keystore keys, and the plugin's `getEntry`
  returns null for a missing alias. That is **retained unreadable data**: the row is there and
  cannot be decrypted. An earlier revision called treating it as absence "the honest outcome" —
  that was wrong and contradicted the approved contract. It must fail closed, and the installed
  plugin's inability to distinguish it is part of why the native credential path is closed
  (see the implementation finding below).

**2026-10-24 implementation amendment:** the approved application-owned iOS reader
now supplies item-specific `SecItemCopyMatching` evidence. ADR-0049's iOS amendment
is canonical for its scope and remaining device gates. The Android path remains
closed; credential migration, runtime fault policy and activation are incomplete.

**Upstream dependency finding.** The contract requires **item-specific missing-versus-failed evidence**: only a
positively established absence may become the `null` the SDK reads as "no session". No audited
Capacitor-8 dependency supplies it.

- **iOS discards the evidence.** `KeychainSwift.getData` records
  `SecItemCopyMatching`'s `OSStatus` in `lastResultCode`, and `KeychainSwift.get` additionally
  sets `errSecInvalidEncoding` for non-UTF-8 bytes; both then return `nil`. The installed
  plugin's `internalGetItem` calls `getData(withKey:)` — `keychain.get(key) as Any` — and
  **never reads `lastResultCode`**, so `errSecItemNotFound`, a locked keychain and invalid
  encoding all arrive identically. `tryKeychainOp` cannot help: it only surfaces a THROWN
  error, and `getData` never throws.
- **Android reports key loss as nothing.** `SecureStorage.java`'s `decryptString` returns
  **null** when the ciphertext row exists but its Keystore entry does not — the
  restored-backup case, since `SharedPreferences` is restored and Keystore keys are not. That
  is **retained unreadable data, not an established missing entry**, and an earlier revision of
  this document wrongly blessed treating it as absence and calling re-authentication "the
  honest outcome". It is not: it is a failure the application must not convert into a clean
  signed-out state.

**An earlier "readability marker" is WITHDRAWN as an invalid inference.** It read a separate
marker key and, if that succeeded, treated an ambiguous empty read of a DIFFERENT key as
established absence. Reading one key successfully establishes nothing about another key: an
item-specific read or decoding failure, or a transient failure followed by a successful marker
read, produces the identical observation. No global probe, timing delay or speculative retry
replaces it, and none may: a prefix enumeration is not item-specific evidence, returns empty on
its own failure, and on Android enumerates Keystore aliases rather than ciphertext rows.

**Consequently:** the Android binding reports `no_absence_evidence`. The iOS read
binding now uses the approved bridge; native composition still cannot become ready
without the separate migration/activation authority and device acceptance.
The dependency finding required an implementation that
surfaces, per read, either the iOS `OSStatus` (or a boolean derived from `errSecItemNotFound`)
or an Android `sharedPreferences.contains(key)` check distinguished from a decryption failure.

**Alternatives audited and rejected.** `capacitor-secure-storage-plugin` 0.13.0 (Capacitor 8,
ships `Package.swift`) is **materially worse**: its iOS `get` tests `hasValue(forKey:)` — the
same conflation — then resolves `keychainwrapper.string(forKey: key) ?? ""`, **fabricating an
empty string** when a read fails; absence and failure are both rejections separable only by
message text; its Android helper catches every `GeneralSecurityException`, prints it and
returns null; and it reads/writes `KeychainWrapper.standard`, a service outside this app's
namespace, with `.afterFirstUnlock` and no `ThisDeviceOnly`.
`@evva/capacitor-secure-storage-plugin` 4.0.4 peers on `@capacitor/core: ^7.0.1` and does not
accept the installed 8.5.2. Custom cryptography and a plugin fork remain prohibited.

**Two write/removal properties, recorded so nothing claims more than the platform does.**

- `KeychainSwift.set` calls `deleteNoLock(key)` **before** `SecItemAdd`, so a replacement that
  fails at the add step has **already removed the value it was replacing**. A failed write
  therefore reports `previousValueMayBeLost`, and no code or document may say the previous
  bytes are intact.
- Android's `removeAlias` returns false **without removing the retained ciphertext** when the
  alias is already missing, and `SharedPreferences.apply()` returns `void` with no disk-failure
  acknowledgement. A removal reports what the platform CLAIMED —
  `deleted_reported` or `nothing_to_delete_reported` — and **neither confirms physical
  deletion or a disk flush**.

**The normalised failure verdict is CONSUMED, not merely exposed.**
`supabaseAuthService` reads it and refuses to report `no_session` — the one place a clean
"nobody is signed in" is produced — or a completed sign-out while a credential failure stands.
That closes the two SDK absorption paths named above, neither of which a getter alone would
have closed.

**Still required, and NOT done by Stage M3b3: transferring the EXISTING credentials.** The
provider session of an already-installed app is in WebView `localStorage` today. Composition
points the SDK at the protected store; it does **not** copy what is already there, so a
flag-enabled build would present as signed out if it mounted at all. Secure credential
transfer — and what happens when one of the two stores is written and the other is not, since
they are separate and the pair is not atomic — is a **migration-stage requirement** (M3b4),
listed with the other open items in §7.

**Inaccessible is not absent.** A failed read of credential storage means presence is
**unknown** and must fail closed; only a *successful* read showing no session establishes
absence and authorises re-authentication. Conflating the two would sign a person out on a
transient storage error.

**The user-visible policy choice that needs approval:** under **S1**, refresh tokens become as
durable as training data and are carried by device backups subject to the configured backup
attributes; under **S2**, at-rest protection is stronger but a reinstall can leave credential
material behind that no identity record matches; under **S3**, nothing new is exposed but
eviction silently signs the user out and recovery requires a network.

**Backup and reinstall behaviour must be verified against the SELECTED configuration**, not
assumed from the storage technology — that verification belongs to the dependent composition
stage, not to isolated engine evidence.

**The provider-session storage policy is SETTLED (S2)**, which is what unblocked the
dependent **composition** stage (M3b3). It was never a prerequisite of the engine-evidence
stage (M3b1). Adding a `storage` option touches **ADR-0025 Decision 10** (`flowType: "pkce"`,
`detectSessionInUrl: false`, `appendPkceFlowIdToRedirects`); those three are unchanged,
**Web auth behaviour and the existing compatibility assertions are preserved unchanged** —
the Web claims nothing, so its client is byte-for-byte the client it was — and no native
OAuth is implemented.

**The SDK uses more keys than its session key, and the integration must accept all of them.**
Audited in the installed `@supabase/auth-js` 2.112.3: besides `<storageKey>` it addresses
`<storageKey>-code-verifier`, `<storageKey>-flows-code-verifier`, **one
`<storageKey>-flow-<flowId>-code-verifier` slot per PKCE flow** (unbounded in name,
ring-evicted in count), and `<storageKey>-user` — which `_removeSession` removes even though
`userStorage` is not configured. Hard-coding one assumed session key would silently drop the
verifier slots and break Google sign-in, so keys pass through unmodified under the fixed
application-owned namespace, byte-for-byte, with no JSON normalisation.

**Rejecting from `getItem` is necessary but NOT sufficient, so the failure also travels on an
application-owned channel.** The SDK converts a storage fault into a clean "no session" in two
ways: `getItemAsync` treats a resolved falsy value — or one that fails `JSON.parse` — as
absence with no error at all, and `initialize()` catches everything `_initialize()` throws and
returns it as a result this application never reads. (`_emitInitialSession` is started from the
constructor and awaited by nobody, so a storage failure there surfaces as an unhandled
rejection.) The integration therefore never resolves `null` for a failure **and** latches a
normalised verdict that **`supabaseAuthService` consults** — refusing to report `no_session`,
the one place a clean "nobody is signed in" is produced, or a completed sign-out, while a
credential failure stands. That is the consumer; a verdict nothing read would not have closed
either absorption path.

#### 5. Migration of an existing native installation — authority protocol

**Status: APPROVED DESIGN — EXECUTED ONLY BY A DORMANT EXECUTOR (M3b4b) THAT NO APPLICATION PATH
INVOKES.** The user approved this protocol on 2026-10-19,
after Codex's clean independent review of the P-1/P-2 provenance resolution (§7, "P-1/P-2
provenance resolution — approval record"). §§5.1–5.7 are the **canonical** statement of the
approved rules; §7 keeps only the decision record, the rationale and the remaining stages, and
the acceptance cases after it carry the approved matrix R1–R77. **Approval is of the design
only.** Its **decision core (M3b4a)** evaluates these rules over supplied evidence and returns
decisions and symbolic plans; it is approved (2026-10-20). A **dormant executor (M3b4b)** now
binds it to the real source and target and executes its plans when explicitly invoked. No
application path invokes it. It was independently reviewed (clean) and approved by the user on
2026-10-20 (§7, "M3b4b implementation status"). What a user sees and may do in a blocked, halted
or faulted state is U2's first-version policy, decided on 2026-10-20 and canonical in §6.
**No installation's data has been migrated, and nothing is verified on a real engine
or a device or production-ready:** the executor's evidence is class M (mocked engine), the
recovery interface (M3b4c) is dormant and awaiting review, the production activation authority still reports
`unavailable`, and production cutover (M3b5) has not happened. The approved identifiers — I-1–I-13, L0,
A′1–A′7, PV1–PV14, E′1–E′12, AP-D3/AP-K1′/AP-COPY/AP-CC/AP-ACT, CE1–CE5 and R1–R77 — are kept
as reviewed, so that the review, the approval and later tests refer to the same rows.

Applies to an installed iOS app upgrading in place. **Browser→app transfer is out of scope
(P2); this is the in-app engine migration P2 explicitly does not waive.**

Two earlier rules were unsafe and are **withdrawn**:

> **W1 — "unreadable or corrupt marker ⇒ not complete ⇒ re-run".** Resurrects deleted data:
> activate → cleanup interrupted (or an older build recreates source keys) → the user deletes
> a record → the record corrupts → additive re-import restores the obsolete value.
>
> **W2 — "skip an unsupported or vanished key and carry on".** Produces an *apparently
> complete* workspace: the key is absent in the target, ordinary hydration reads `absent`, and
> the domain writes its **default** over data that still exists in the source. Silent loss
> disguised as a clean install.

**Superseded on 2026-10-19 and no longer in force:** adopting a source marker found without a
target record (now PV5, blocked); the unconditional "abandon and re-enumerate" of an
`enumerating` record (now E′5/E′6, gated on `entryKeys`); classifying an uncertain commit only by
comparing progress with rows and "replaying" an uncommitted batch (now I-11: decide from durable
state, re-derive the remaining keys, and treat a warm mismatch as a detected fault, I-13); and a
`verified` record activating without complete progress and target evidence (now A′6, AP-CC and
AP-ACT).

##### 5.1 Transaction, recovery and fault model — the canonical invariants

- **Unit of commit = one checkpoint transaction.** Each checkpoint writes a **non-empty batch of
  key/value rows AND the updated `copied` set of the activation record together**. Progress is
  therefore never out of step with data: there is no committed state in which progress claims
  a key that is not present, or a key is present that progress does not know about.
- **What survives process death:** exactly the **last committed transaction**. Nothing else.
- **What rolls back:** an interrupted transaction rolls back **entirely** — a checkpoint's rows
  *and* its progress entry. There is no partial batch.
- **Copying completion (AP-CC) and activation (AP-ACT) are separate, final transactions.** Each
  reads complete target evidence **inside** its own transaction before changing the phase;
  `verified` is committed only by AP-CC, and `active` only by AP-ACT. **A validated committed
  activation — not the return of any single API call — is the authority switch.**
- **Migration needs multi-key atomicity INTERNALLY; `StorageAdapter` still promises none.**
  The transactions live inside the migration module over the native engine's own connection.
  No repository sees them, and the public interface is unchanged.
- **Only a validated `active` state (§5.4 row B4) mounts the ordinary identity, sync and
  sporting consumers.** A blocked decision, a halted plan and a detected fault render the
  failure/recovery interface per §6 **and nothing else**. Nothing mounts mid-migration.
- **Source cleanup may begin only after a committed `active`**, and only under §5.5's
  re-verification rule.

**The invariants I-1–I-13 (approved 2026-10-19).**

- **I-1 — positive evidence only.** Absence is established only by a successful read or
  enumeration returning nothing. A failed read of the source, the marker, the target record or
  the target rows is never absence.
- **I-2 — target row enumeration.** A migration-only capability over the migration module's own
  connection lists every key in the target other than the activation record and the fault
  latch (I-13), or reports `read_failed`. Like `EnumerableStorageSource` (§3) it is not added to
  `StorageAdapter`. The activation record and the fault latch live under reserved locations
  disjoint from every eligible key, and no repository reads either.
- **I-3 — the marker.** One fixed key in a migration-owned namespace, outside every eligible
  family and the retired legacy keys; never copied and never eligible. Its value is a canonical
  UUID, and anything else is malformed. **No automatic path removes it** — retirement included —
  so after activation it remains a source-side tombstone. It is consulted only when there is no
  record or a pre-`active` record, never for an `active` one.
- **I-4 — record-first (K4).** The marker is written only once a committed record carrying the
  same `storeIdentity` is positively established. In AP-D3 that means a **confirmed** commit of
  the new record; if that commit's outcome is unknown, the plan halts without writing the
  marker, and the marker is written, if at all, by a later AP-K1′ that observes the committed
  record. In K1′ and K2 the existing, already-committed record carries the id, so the marker
  write is the plan's **first** step, before any target transaction.
- **I-5 — D3 entry (K6).** D3 is entered only over a successfully enumerated, non-empty eligible
  set, which becomes the record's `entryKeys`.
- **I-6 — nothing is staged in `enumerating`.** The `enumerating → copying` transition commits
  the complete, non-empty manifest, `copied = ∅` and the new phase in one transaction, carries
  `entryKeys` over unchanged, and is committed only if the manifest contains every `entryKeys`
  key. No application row is committed while the phase is `enumerating`.
- **I-7 — copy-time verification.** A checkpoint stages a value only if the digest of the exact
  bytes read equals its manifest fingerprint; otherwise the plan halts before that checkpoint
  and the next evaluation blocks (E′7). The digest is a standard collision-resistant hash from a
  platform API, not custom cryptography; its availability inside the WebView is an unverified
  engineering check.
- **I-8 — no pre-`active` record is deleted.** K1′'s abandonment is one in-place replacement
  transaction that never passes through "no record".
- **I-9 — a blocked decision is not a halted action, and an unknown outcome is not "no
  effect".**
  - A **blocked decision** is computed from one read-only evidence snapshot. It writes nothing
    to either store, so a re-evaluation sees the same evidence. It reports **every** failing
    check, not only the first match, for §6's interface, whose user-visible group follows
    all of them (§6.2).
  - A **permitted action** is an ordered plan (§5.4a). Each step is one source marker write, one
    target transaction, or reads. A step that re-checks a precondition does so immediately
    before the write it guards; a failed re-check halts **before** that write is issued.
  - Every write step ends in exactly one of three states: **confirmed** (positively
    acknowledged), **outcome unknown** (issued, then rejected, failed, left unanswered or
    interrupted), or **not issued**. A rejection is recorded as *outcome unknown* even where
    the platform documents it as "not stored": whether WebKit's `localStorage` or the SQLite
    plugin can apply a write and then report failure is unmeasured. Only a later read decides
    what happened (§5.4a, "Recovery").
  - A step that fails or ends *outcome unknown* **halts** the plan at that step, and nothing
    after it is issued. Confirmed steps stay in effect, and the unknown step may have taken
    effect too. There is no compensating write and no cross-store rollback. The halt report
    lists the confirmed steps, the one step whose outcome is unknown (if any) and the steps
    not issued — never "nothing changed". A store the plan never issued a write to is untouched
    by it: a plan that halts at its marker step has issued no target transaction.
  - **Re-evaluation** starts from the top of the order (I-10) on a positively reopened target,
    from durable evidence plus any contrary evidence the running process still holds (I-11,
    I-13). Committed progress is part of that evidence: it is never discarded and never
    replayed.
  - **Retry and relaunch.** Re-evaluation happens on the next launch, and on any recheck the
    recovery surface offers. When a recheck is offered, and how a block or a halt is worded, is
    U2's first-version policy (§6.2, §6.3, §6.8): a recheck follows this rule, never resumes a
    known contradiction and never replaces warm evidence with a new cold runner. Any automatic
    re-evaluation within one launch is bounded — the bound is an engineering parameter, not
    specified here — and each one follows this rule.
  - Neither a blocked decision nor a halted plan mounts ordinary consumers. Staged rows, the
    record, the original manifest and `entryKeys` are never deleted by either.
- **I-10 — order and readback.** The fault latch (L0, I-13) first, then Group A with the A′
  predicates, then Group B for an `active` record (the marker is not read), then Group C (C1
  blocks first), then the provenance table (§5.2), then Group E (§5.4). A same-connection readback is never commit evidence: after
  an unknown outcome, evidence comes from a positively reopened connection (§5.5; the M3b1
  tooling follows the same rule). Reading committed rows is evidence of **content**, not of
  power-loss durability, which remains unmeasured (§2).
- **I-11 — recovery from validated durable state, plus any contrary evidence the running
  process still holds.**
  - *Model assumption, stated and not proven:* each target transaction is atomic, so after an
    unknown outcome or a process death the durable target holds either the complete
    before-state or the complete after-state. This is §5.1's model. Real-engine evidence covers
    termination **before** COMMIT on a simulator only; termination during COMMIT and power loss
    are unmeasured (§7, M3b1 entries).
  - *Cold:* a fresh process, with none of the earlier plan's memory, evaluates the decision
    order (I-10) from durable evidence alone. It needs no vanished identifier, timestamp,
    expected byte string or batch description, and it never reconstructs one and presents it
    as the earlier plan's intent: an AP-D3 that runs again after a creation that did not commit
    is a **new** attempt with new ids.
  - *Warm:* the process survives an unknown outcome. The plan is abandoned at that step (I-9),
    the target is reopened and read, and what is read is **compared** with what the plan
    issued — the exact record bytes before and after the transaction, and the rows it would
    insert. Exactly one of three results follows:
    - **equals the after-state** — the record is byte-identical to the issued after-state and
      every inserted row is present with its issued bytes ⇒ the transaction committed; evaluate
      the decision order as a cold start would;
    - **equals the before-state** — the record is byte-identical to the issued before-state and
      none of the inserted rows is present ⇒ it did not commit; evaluate as a cold start would;
    - **matches neither** ⇒ a **detected fault** (I-13): migration stops, whatever the decision
      order would select.
  - **Warm and cold choose the same action when their evidence is the same** — a cold start, or
    a warm comparison that found the before- or the after-state. A warm comparison that found
    neither is **additional, positive contrary evidence**, and it overrides the table. It is
    never mere report text. The same holds whenever the running process reads durable target
    state that contradicts a step it saw **confirmed** — for example, a confirmed checkpoint
    whose rows are missing or different after a reopen.
  - *Why durable state is sufficient for genuine outcomes.* Every before-state and after-state
    of every transaction is itself a state that §§5.2–5.4 classify (§5.4a, "Recovery"). Progress is
    read from the durable `copied`, so a committed checkpoint is never chosen again; rows and
    progress that disagree block (E′2); completion and activation re-read complete target
    evidence; a committed `active` reaches L0, A/A′ and B4 without the plan or the source; and
    only B4 mounts, so no cold start mounts partial data.
  - *What a cold start cannot detect — undetected corruption, distinct from a detected fault.*
    A durable state that is well-formed and internally consistent but is not what any issued
    transaction wrote — a failure of the engine itself — is treated as the state it appears to
    be when **no** running process detected it, or when the detection's latch did not persist
    (I-13). In `enumerating` nothing is staged, so no last copy is exposed; from `copying` on,
    E′2–E′4 and §5.5 still require the record, the rows and the source to agree. Detecting more
    would need the plan's memory, which a cold start does not have.
  - *A general journal — considered, not proposed.* A target-side journal of in-flight
    transactions would be one more independently failable write with its own ordering and
    interruption cases, and for genuine outcomes it would select no action the durable state
    does not already determine. The narrower fault latch of I-13 is adopted instead, and
    **RQ-1 is resolved by I-13** (approved 2026-10-19).
- **I-12 — progress.** Order the states by (no record < `enumerating` < `copying` < `verified`
  < `active`; then the size of `copied`). Every committed transaction in §5.4a strictly increases
  this measure, except K1′'s replacement, which the same plan always follows with the
  `enumerating → copying` transition. A checkpoint batch is never empty, and an empty remaining
  set selects completion (E′10), not another checkpoint. So an evaluation never selects an
  action that commits nothing: without interruption or failure, every plan ends in activation;
  with them, the plan halts and re-evaluation resumes from committed progress.
- **I-13 — a detected fault stops migration, and a latch carries the stop across relaunch.**
  This resolves RQ-1.
  - *Trigger — positive evidence held by a running process, and nothing else:* a warm "matches
    neither" (I-11), or durable target state that contradicts a step the process saw
    confirmed. A read failure is not a detected fault; it blocks or halts under the existing
    rules. A cold start detects no faults in this sense: every inconsistency it *can* see is
    already a blocking row (A, A′, E′2–E′4).
  - *Immediately, in the process:* an in-memory fault latch is set. From then until the
    process ends there is no further plan step, no marker write, no target transaction other
    than the latch write below, no activation, no mounting of ordinary consumers and no
    automatic re-evaluation; only the recovery surface renders. Nothing that surface offers
    (§6) resumes migration while the in-memory latch stands; a read-only inspection for display
    cannot resume it either.
  - *The durable latch — the only write permitted after a detection.* One target transaction
    inserts a fault-latch row at a reserved location, outside every eligible key, outside the
    activation record and excluded from I-2's enumeration; no repository reads it. It changes no
    application row, no activation-record field and no marker. Its content is diagnostic —
    schema version, transaction kind, phase, and the issued before-, issued after- and observed
    record bytes, which hold key names and fingerprints but no application values. **Its
    presence alone is the latch.**
  - *Outcomes of the latch write.* Confirmed ⇒ the stop persists across relaunch. Rejected,
    failed or unknown ⇒ the in-memory latch still holds for this process, and the latch write —
    nothing else — may be retried a bounded number of times (an engineering parameter). Death
    before or during the write ⇒ the relaunch reads whatever is durable.
  - *Relaunch:* row **L0** (table below) is evaluated before Group A.
  - *If the latch did not persist,* a relaunch that positively reads no latch cannot know that
    a fault was detected. It evaluates durable state as any cold start does, and the fault
    degrades to the undetected residual of I-11. This is stated, not hidden: the latch narrows
    the window and does not close it. It makes no write atomic — it is one more independently
    failable write — and its own durability is as unmeasured as every other write's (I-10).
  - *Target only.* A fault can be detected during activation, leaving a record that already
    reads `active`. A source-side latch would make the old source part of post-activation
    access, which the post-activation invariant forbids; the source's durability is weaker
    besides.
  - *Clearing.* No automatic path clears the latch — not retirement, not D1, not a later plan.
    U2's first-version policy (§6.5) offers **no** general user control that clears it either.
    Removing it needs a later, separately specified, reviewed and explicitly authorised
    targeted recovery procedure that defines the inspection, authority, repair and
    confirmation, and removing the latch alone repairs nothing. None exists, so a latched
    installation stays blocked, including one whose record already reads `active`. This is U1:
    a known contradictory state blocks.
  - *Cost, stated.* L0 adds one target read to every launch, permanently, and a failure of that
    read blocks, as B1 does for any failing target. It does not consult the source.

**Prohibitions.** No migration path may revive W1 or W2; recreate provenance from a guess about history;
discard, overwrite or re-copy staged rows; re-enumerate away a missing key (only `enumerating`
re-enumerates, and under K6 only while every `entryKeys` key is still present); treat a failed
read as absence; write to either store as the result of a blocked decision; promise that a
halted action left the stores unchanged, or attempt a cross-store rollback; delete a
pre-`active` record; overwrite or adopt a foreign or malformed marker; read the marker for an
`active` record; compare live application rows with historical manifest fingerprints after
activation; mount ordinary consumers before a validated committed activation; continue, activate
or mount after a detected fault, or clear a fault latch automatically (I-13); or make a valid
activated target depend on the old source.

**Sporting-data recovery is not identity authorisation.** Migration copies identity-continuity
keys as bytes and never creates, resolves or drops an access barrier, trusted-device record,
pending intent or barrier resolution. A vanished identity key blocks like any other (rows E′5,
E′7, E′8), so no automatic path activates a workspace lacking a barrier the source held when D3
began. An activation verdict is a storage-readiness verdict only: the identity gate still
decides access after mounting. Provider credentials — present, absent or unreadable, in either
store — are never an input to a migration decision and never authority to open a Profile, and
no recovery action (§6) may sign anyone in, clear a barrier or select a Profile. A key that
vanished **before** D3 began is outside what migration can detect; migration neither improves
nor worsens what the identity gate does with that state today.

**SQLite does not imply an unconditional power-loss guarantee**, and this document does not
claim one. Durability depends on configuration, and **Stage M3b1 must verify, not assume**:
`journal_mode` and `synchronous` (see <https://sqlite.org/pragma.html#pragma_synchronous> —
`FULL` vs `NORMAL` differ precisely in whether a commit is proven on stable storage before
returning), the commit/error semantics the plugin surfaces, and **reopen behaviour after an
interrupted or uncertain commit**. Whole-document JSON serialization, bridge payload size and
memory/write cost remain in the envelope tests — **SQLite removes none of those costs.**

**Package status:** `@capacitor-community/sqlite` 8.1.1 ships `Package.swift`
(`platforms: [.iOS(.v15)]`) and exposes `beginTransaction` / `commitTransaction` /
`rollbackTransaction` / `isTransactionActive`. That is **candidate compatibility only — not a
passed native build and not verified durability.**

##### 5.2 Activation record and store provenance

One versioned JSON document in the **target**, under a reserved location disjoint from every
eligible key (I-2):

| Field | Purpose |
| --- | --- |
| `schemaVersion` | Of the **activation record**. Never conflated with a domain record's version |
| `phase` | `enumerating` \| `copying` \| `verified` \| `active` |
| `migrationId` | One attempt. AP-K1′'s in-place replacement gives a new one; no evaluation uses it as evidence on its own (I-11) |
| `storeIdentity` | The `installationStoreId`; see below |
| `entryKeys` | The non-empty eligible key set enumerated when D3 began — key names only (I-5). Historical after activation |
| `manifest` | Eligible keys **with a content fingerprint** (a digest, I-7) captured before copying began |
| `copied` | Keys committed so far (updated in the same transaction as their rows) |
| `activatedAt` | Written only by the activation transaction |
| `sourceRetirement` | `not_started` \| `in_progress` \| `complete`, plus keys already removed |

**Record shape per phase.** A field present or absent contrary to this table blocks (A′2):

| Field | `enumerating` | `copying` | `verified` | `active` (migrated) | `active` (D1, nothing migrated) |
| --- | --- | --- | --- | --- | --- |
| `migrationId`, `storeIdentity` | canonical UUIDs | canonical UUIDs | canonical UUIDs | canonical UUIDs | canonical UUIDs |
| `entryKeys` | non-empty | non-empty, ⊆ manifest | non-empty, ⊆ manifest | non-empty, ⊆ manifest (historical) | empty |
| `manifest` | **absent** | non-empty | non-empty | non-empty (historical) | empty |
| `copied` | **absent** | ⊆ manifest | **= manifest keys** | **= manifest keys** (historical) | empty |
| `activatedAt`, `sourceRetirement` | absent | absent | absent | present | present |

**Provenance is created, not merely named — record first.** D3 (plan AP-D3) commits the
`enumerating` record, carrying a new `installationStoreId` as `storeIdentity` and `entryKeys`,
**before** the source is touched; only after that commit is **confirmed** is the same id written
into a dedicated **source marker key** (I-3, I-4). The marker lives in a migration-owned
namespace outside every eligible family, is never copied, and is never removed by any automatic
path, so after activation it remains a source-side tombstone. The two writes are to different
stores and are **not** atomic; the provenance table below gives each observation one action.

**Provenance table — evaluated in order, first match wins.** Reached after L0, Group A
(with A′) and Group C (§5.4). A valid `active` record never reaches it.

| # | Record | Observation | Action | Replaces (superseded rule) |
| --- | --- | --- | --- | --- |
| PV1 | none | Target row enumeration failed | **BLOCKED**, retry | — (new: a failure is never "target empty") |
| PV2 | none | Target holds application rows | **BLOCKED**, whatever the marker says | D2 |
| PV3 | none | Target empty; marker read failed | **BLOCKED**, retry | — (new) |
| PV4 | none | Target empty; marker malformed | **BLOCKED**; bytes preserved; never adopted or overwritten | — (new) |
| PV5 | none | Target empty; marker valid | **BLOCKED.** Under K4 a marker without a record means a committed record was lost or a commit acknowledgement was false; the source may be stale or partially retired | §5.2 "adopt" row |
| PV6 | none | Target empty; marker absent; eligible set empty | **D1** — fresh install | D1 |
| PV7 | none | Target empty; marker absent; eligible set non-empty | **D3** — plan AP-D3 | D3 |
| PV8 | pre-`active` | `storeIdentity` missing or malformed | **BLOCKED** (already enforced by A′1–A′2; listed so the table stands alone) | E1 (record half) |
| PV9 | pre-`active` | Target row enumeration failed | **BLOCKED**, retry | — (new) |
| PV10 | pre-`active` | Marker read failed | **BLOCKED**, retry | — (new) |
| PV11 | pre-`active` | Marker malformed | **BLOCKED**; bytes preserved | — (new) |
| PV12 | pre-`active` | Marker valid, id differs — **P-2** | **BLOCKED in every phase.** Marker never overwritten; record never replaced | E1 (mismatch); §5.2 P-2 |
| PV13 | pre-`active` | Marker valid, id equal | Group E with marker = matched | §5.2 "ids match" |
| PV14 | pre-`active` | Marker positively absent — **P-1** | Group E with marker = absent. Only E′6, E′9, E′10 and E′11 continue | §5.2 P-1 row |

**After a validated committed activation the source marker is no longer consulted at all.**
Three phases must be kept apart:

1. **Provenance establishment and validation — pre-activation only.** Both markers matter here.
2. **Target authority — post-activation.** A validated `active` record in an internally
   consistent target is the authority **on its own**. **A missing, cleared or unreadable source
   never blocks ordinary access**, because the source is exactly the evictable storage this
   whole stage exists to stop depending on. (Otherwise clearing WebView storage after a
   successful migration would lock the user out of their own migrated data.)
3. **Source retirement — optional.** It *may* be prevented by a missing or unreadable source:
   nothing can be verified before deletion, so nothing is deleted. Retirement stalls; access
   does not.

**Fail-closed handling is retained for genuinely ambiguous or invalid TARGET state** — an
unreadable, malformed, wrong-version or internally inconsistent activation record, and a fault
latch, still block, regardless of what the source looks like.

**P-1 and P-2 — resolved at the design level (2026-10-19).**

- **P-1 — a pre-`active` record whose marker is positively absent (PV14).** In `enumerating` it
  continues by **K1′** (E′6, AP-K1′) only while every `entryKeys` key is still in the source and
  no target row exists; otherwise E′1 or E′5 blocks. In `copying`/`verified` it continues by
  **K2** (E′9–E′11), re-writing the marker under the record's **existing** id, only when every
  A′, E′1–E′8 and §5.5 check passes. Neither claims to know which history occurred: each acts
  only where the durable evidence shows that nothing would be discarded or overwritten. An
  unreadable marker (PV10) or a malformed one (PV11) blocks.
- **P-2 — a valid, different marker before activation (PV12).** **BLOCKED in every
  pre-activation phase**, including `enumerating` with nothing staged. The foreign marker is the
  only surviving evidence of another attempt, so it is **never overwritten or adopted**, and the
  record is never replaced. Approving this handling is **not** approval to resolve P-2
  automatically. Under U2's first-version policy it stays blocked (G3, §6.8); resolving it
  needs a separately specified targeted recovery procedure that does not exist (§6.5).

**Neither affects an activated installation.** Both are pre-activation only: **after a
validated committed activation, losing the old source — marker included — never blocks ordinary
access** (§5.4 rows B2/B4).

##### 5.3 What is copied, and what "verified" means

**Migration never parses a domain payload.** It copies **bytes**. Therefore:

- A **known application-owned key whose content is an unsupported or malformed domain record
  is copied verbatim**, unchanged. The repository's existing validation, quarantine and
  repair policy then applies after cutover exactly as it does today. This is the chosen
  non-destructive policy: **preserve verbatim under unchanged repository rules.** No domain
  repair rule is invented here, and **no known key is ever skipped** — which is what closes
  W2.
- An **unsupported `schemaVersion` on the ACTIVATION RECORD** is a different thing entirely
  and **blocks** (§5.4 rows A3/A4).

**Evidence.** Each manifest entry carries the source fingerprint, a standard collision-resistant
digest over the exact bytes (I-7; the algorithm and its availability inside the WebView are
still to be verified). A checkpoint stages a value only if the digest of the bytes it read
equals that fingerprint, and each committed row is written in the same transaction as its
progress entry. **`verified` means exactly this:** AP-CC committed it after reading, inside its
own transaction, a target whose application rows equal the manifest's keys, every row matching
its fingerprint, and `copied` equal to the manifest's keys. **Activation does not trust the
phase:** AP-ACT re-reads the same complete evidence inside the activation transaction and
re-validates the source immediately before it (§5.5).

**Durability caveat that gates retirement:** fingerprint matching proves *what* was written,
not that it reached stable storage. **Source retirement additionally requires the engine's
committed-transaction acknowledgement** (§5.1). On an engine that cannot give one, retirement
is **not implemented at all** and the source is simply kept.

##### 5.4 State and transition table

Evaluated **in order; the first matching row wins**: **L0**, then **Group A** (A1–A6, then
A′1–A′7), then **Group B** for an `active` record, then **Group C**, then the **provenance
table** (§5.2), then **Group E** (I-10). Specific invariant failures are tested **before** the
generic rows that would otherwise mask them, and every row states one unambiguous action.
**Phase is never trusted on its own.**

**Row L0 — the fault latch, evaluated first (I-13).**

| # | Observation | Action |
| --- | --- | --- |
| L0a | Fault-latch read failed | **BLOCKED**, retry; never read as "no latch" |
| L0b | Fault latch present — any bytes, well-formed or not | **BLOCKED** as a detected fault, whatever the record's phase, **including `active`** |
| L0c | Fault latch positively absent | Continue to Group A |

**Group A — target activation-record integrity.** Nothing below interprets `phase` until every
row here has passed. **Group A inspects the activation record only.** It never asserts that a
particular application key still exists or still holds a particular value — that check is
confined to pre-activation staging (Group E).

| # | Condition | Action |
| --- | --- | --- |
| A1 | Record unreadable (storage error) | **BLOCKED**, retry later. Never re-import |
| A2 | Record malformed / unparseable, or `phase` not one of the four valid values | **BLOCKED.** Quarantine the raw bytes, never overwrite |
| A3 | `schemaVersion` **higher** than supported | **BLOCKED.** This build is too old. Never downgrade the record |
| A4 | `schemaVersion` **lower** than supported | **BLOCKED** unless an explicit reviewed upgrade exists for that version. None exists today |
| A5 | `manifest` malformed, or absent while `phase ∈ {copying, verified, active}` | **BLOCKED** |
| A6 | `copied` is not a subset of `manifest` | The record contradicts itself — **BLOCKED**. This is a check on the **record**, not on application data |

**Group A′ — phase-shape and integrity predicates, evaluated after A1–A6** and still before
anything interprets `phase`:

| # | Condition on the record | Action |
| --- | --- | --- |
| A′1 | `migrationId` or `storeIdentity` is not a canonical UUID | **BLOCKED** |
| A′2 | A field is present or absent contrary to the phase's column above | **BLOCKED** |
| A′3 | `entryKeys` malformed: duplicates, a key that fails the §1 eligibility test, or empty in a pre-`active` phase | **BLOCKED** |
| A′4 | Manifest malformed: duplicate or ineligible keys, a fingerprint that is not a well-formed digest, or empty in `copying`/`verified` | **BLOCKED** (narrows A5, which admits an empty manifest) |
| A′5 | `entryKeys` ⊄ manifest keys, in `copying`, `verified` or a migrated `active` record | **BLOCKED** |
| A′6 | `copied` ≠ manifest keys in `verified` or `active` | **BLOCKED** (A6 already requires ⊆) |
| A′7 | An `active` record whose `entryKeys`, manifest and `copied` are neither all empty nor all non-empty | **BLOCKED** |

For an `active` record these are **metadata checks on the record**, comparable to A1–A6. They
never compare the manifest with live application rows: after activation, migrated keys remain
ordinary mutable records, and B4 is unchanged.

**Group B — `phase: active`, specific failures before the general case.** Reached only with a
record that passed L0, Group A and Group A′.

| # | Condition | Action |
| --- | --- | --- |
| B1 | `active`, and the **target is failing now** (read or write errors against the native store) | **Report the failure.** **No fallback to the source.** Normal consumers do **not** mount |
| B2 | `active`, target healthy, `sourceRetirement` incomplete, source **missing or unreadable** | **Access is unaffected.** Retirement is **stalled, not failed**: record it and continue at B4 |
| B3 | `active`, target healthy, `sourceRetirement` incomplete, source readable | Resume retirement under §5.5's re-verification rule, then continue at B4 |
| B4 | `active`, target healthy | **Authoritative.** Mount normal consumers. Never re-import. **The source is not consulted for access** |

**Group C — source access classification.** Reached only when Group A left a non-`active`
state. **A failed read is never an empty store.**

| # | Condition | Action |
| --- | --- | --- |
| C1 | Source enumeration **failed** (`read_failed`) | **BLOCKED — source unavailable.** Retry later. Never read as "source empty", which would activate over a store that still holds data |
| C2 | Source enumeration **succeeded and returned no eligible keys** | Genuinely empty source. Continue |

**No record yet** — the former Group D is now the provenance table's rows PV1–PV7 (§5.2): D1
(fresh install) is PV6, D2 (populated target without a record) is PV2, and D3 (migrate) is PV7.

**Group E — pre-activation phases.** Reached only through PV13/PV14, with L0, Group A, Group A′
and Group C passed. Every staging, conflict and divergence row precedes the four rows that
continue.

| # | Phase | Condition | Action | Replaces (superseded rule) |
| --- | --- | --- | --- | --- |
| E′1 | `enumerating` | Any target application row | **BLOCKED** — I-6 violated | — (new; E0 does not reach `enumerating`) |
| E′2 | `copying`/`verified` | Staging progress and staged rows disagree, in either direction | **BLOCKED**; no repair by deletion or re-copy | E0 |
| E′3 | `copying`/`verified` | A target application row for a key outside the manifest | **BLOCKED**; the row is neither deleted nor activated into | — (new) |
| E′4 | `copying`/`verified` | A staged row whose bytes do not match its manifest fingerprint | **BLOCKED**; overwrite neither side | E2, made precise |
| E′5 | `enumerating` | An `entryKeys` key absent from the current eligible set, including an empty source | **BLOCKED** — eligible data vanished after D3 began. Record kept; nothing re-enumerated | — (new; E3 would re-enumerate) |
| E′6 | `enumerating` | Otherwise (marker matched or absent) | **AP-K1′** | E3, gated |
| E′7 | `copying` | §5.5 set or content validation fails | **BLOCKED** | E5 |
| E′8 | `verified` | §5.5 set or content validation fails | **BLOCKED** | E7 |
| E′9 | `copying` | Validation passes; `manifest − copied` non-empty | **AP-COPY** | E4 (+K2) |
| E′10 | `copying` | Validation passes; `manifest − copied` empty | **AP-CC** — copying completion | — (new; E4 had no exit) |
| E′11 | `verified` | Validation passes | **AP-ACT** — activation | E6 (+K2) |
| E′12 | — | Anything else | **BLOCKED** — a specification defect, not a default | §5.4 completeness rule |

**Reachability.** Each row is reachable with one unambiguous action, because the masking
orderings were removed: L0 precedes everything; B1 and B2 precede B4; the A′ shape predicates
and E′1–E′5 precede every continuing row; E′7/E′8 precede E′9–E′11; and C1 precedes anything
that may conclude "nothing to migrate". **Blocked decisions never write and never make source
data authoritative.**

**The manifest is migration evidence, not a permanent constraint on application data — this is
the canonical statement, referenced rather than repeated elsewhere.** The checkpoint invariant
(a batch's rows and its progress commit together) governs **staging, before activation**, and
Group E enforces it. **After a validated committed activation the manifest — like `entryKeys`
and `copied` — becomes a historical record of what was copied.** It is *not* an existence or
content constraint: the migrated keys are ordinary mutable application records, and every
repository keeps its existing contract to write, overwrite, remove and create keys freely. A
migrated key that a repository later removes, changes or adds is **not** evidence of a failed
migration and must never block, be re-imported, or be restored from the source.

The concrete case this rule exists for: `curling.identity.trustedDevice.v1` is a migrated
identity key, and `identityTransitionCoordinator`'s sign-out protocol legitimately calls
`trustedDeviceRepository.remove()` on it. A relaunch afterwards sees an `active` record, a
healthy target, and a `copied` key with no row — **ordinary, correct state, reaching B4.** No
repository is asked to maintain migration progress, and **no new domain-write protocol is
introduced**: nothing above the migration module is aware the manifest exists.

What still applies after activation is unchanged in kind: **L0**, **activation-record metadata
validation** (A1–A6 and A′1–A′7, which read the record only) and **real storage failures** (B1).

**Completeness is claimed only for the cases specified here.** An observation matching no row
is itself a defect in this specification and must **block** (E′12), not fall through to a
default.

**Mounting rule.** **Only B4 — an L0-clear, Group-A-valid `active` record over a healthy
target — permits mounting the normal identity, sync and sporting consumers.** Every blocked
state may render the failure/recovery interface **and nothing else**; no blocked,
pre-activation, halted or faulted state may mount ordinary consumers against a partial or
unvalidated target.

##### 5.4a Action plans, recovery from durable state, and why each automatic action is lossless

**Action plans.** Each plan runs its steps in order under I-9, and an unknown
outcome is resolved by I-11. "Halt" means: stop at that step, issue nothing further, report the
confirmed, unknown and not-issued steps, and re-evaluate later. A plan keeps what it issued
to compare with the reopened state after an unknown outcome (I-11).

- **D1** (from PV6). One target transaction creating the `active` record with empty
  `entryKeys`, manifest and `copied`, and `activatedAt` and `sourceRetirement` set; no marker.
  Unknown ⇒ halt.
- **AP-D3** (from PV7).
  1. Target transaction: create the `enumerating` record — new `migrationId`, new
     `storeIdentity`, `entryKeys` := the eligible set this evaluation enumerated — issued only
     over no record and no application row. Unknown ⇒ halt; the marker is **not** written
     (I-4).
  2. Only after step 1 is confirmed: write the marker := `storeIdentity`. Rejected or unknown ⇒
     halt; step 1 stays committed, and the source may or may not now hold the marker. Next
     evaluation: PV13 or PV14 → E′6 (PV10/PV11 if the marker cannot be read or is malformed).
  3. Read and digest every eligible value. Failure ⇒ halt; this step writes nothing.
  4. Re-check that the eligible set still contains every `entryKeys` key (failure ⇒ halt
     before issuing; next evaluation E′5). Target transaction `enumerating → copying` per I-6.
     Unknown ⇒ halt.
  5. Continue as AP-COPY.
- **AP-K1′** (from E′6).
  1. If the marker is absent, write it := the record's existing `storeIdentity`. Rejected or
     unknown ⇒ halt with **no target transaction issued**; the source may now hold the marker.
     Next evaluation: PV13 or PV14 → E′6 again.
  2. Target transaction: replace the record in place — new `migrationId`; `schemaVersion`,
     `storeIdentity` and phase unchanged; `entryKeys` := the current eligible set, which E′5 has
     just shown to contain the old one; no other field. Unknown ⇒ halt. Whichever record is
     then durable, old or new, is an `enumerating` record that A′, E′1 and E′5 validate on its
     own merits; a cold start never uses either `migrationId` as evidence, and a surviving plan
     compares the whole record, never the `migrationId` alone (I-11).
  3–5. As AP-D3 steps 3–5.
- **AP-COPY** (from E′9).
  1. If the marker is absent (K2), write it := the record's `storeIdentity`. Rejected or
     unknown ⇒ halt, with no target transaction issued.
  2. Choose a **non-empty** batch from `manifest − copied`. Read each value and check its
     digest against the manifest (I-7); a mismatch or read failure ⇒ halt, with nothing issued
     by this step.
  3. Checkpoint transaction: insert the batch's rows and set `copied := copied ∪ batch`.
     Unknown ⇒ halt.
  4. Repeat from 2 while `manifest − copied` is non-empty; then continue as AP-CC.
- **AP-CC** (from E′10, or the end of AP-COPY) — **copying completion**.
  1. The marker as in AP-COPY step 1.
  2. Target transaction. **Inside it**, before any write: enumerate the target's application
     rows (the set must equal the manifest's keys), read every row (each digest must equal its
     fingerprint), and confirm `copied` equals the manifest's keys. A failed read or any
     mismatch ⇒ roll back and halt; the next evaluation blocks on the matching row (PV9, E′2,
     E′3 or E′4) or retries a failed read. Otherwise set phase `copying → verified`, with every
     other field unchanged, and commit. Unknown commit or rollback ⇒ halt.
  3. Continue as AP-ACT.
- **AP-ACT** (from E′11, or the end of AP-CC) — **activation**.
  1. The marker as in AP-COPY step 1.
  2. Repeat §5.5 set and content validation of the source immediately before the transaction.
     Failure ⇒ halt. A marker confirmed in step 1 — or written there with an unknown outcome —
     may now be in the source, so the next evaluation reaches PV13 (or PV14) and blocks at E′8.
  3. Target transaction. **Inside it**, the same complete target evidence as AP-CC step 2; a
     failed read or mismatch ⇒ roll back and halt. Otherwise set phase `verified → active`,
     `activatedAt` and `sourceRetirement := not_started`, with every other field unchanged, and
     commit. Unknown ⇒ halt. A record already `active` is never re-activated: only E′11 issues
     this transaction, and E′11 requires `verified`.
  4. Re-evaluate from the top: a valid `active` record over a healthy target is B4, the only
     state that mounts ordinary consumers.

Reading the evidence **inside** the completion and activation transactions keeps the evidence
and the phase change atomic with respect to the target. That is the sole purpose; it is not
durability evidence (I-10). The source cannot be inside that transaction, so §5.5's
validation-to-activation residual is unchanged. **Completeness is an activation prerequisite in
two places**: AP-CC commits `verified` only over complete evidence, and AP-ACT re-reads the
same evidence rather than trusting the phase.

**Recovery — what the durable state shows after an unknown outcome or a cold start, and which
row decides.** Death **before** a step is issued leaves the state the previous step produced,
which is one of the states below. A marker that cannot be read, or reads malformed, reaches
PV10 or PV11 in every case.

| Marker write (source) | A surviving plan records | Next observation | Next row |
| --- | --- | --- | --- |
| Returned success | Confirmed — an in-process acknowledgement, not durability (acceptance case R2) | A later read may still find it absent | PV13, or PV14 if it was lost |
| Rejected before applying | Outcome unknown (I-9) | The marker read | Absent ⇒ PV14 |
| Applied, then rejected, or the answer lost | Outcome unknown | The marker read | Equal id ⇒ PV13; absent ⇒ PV14 |
| Process death during the write | Nothing — no plan survives | The marker read | Equal id ⇒ PV13; absent ⇒ PV14 |

In every marker case the target is untouched unless the plan had already issued a target
transaction, and no continuing row depends on the marker being present (§7 approval record, K2).

| Target transaction | Not committed — durable state ⇒ next row | Committed, acknowledged or not — durable state ⇒ next row | Durable evidence that decides |
| --- | --- | --- | --- |
| D1 creation | No record ⇒ PV6 again | `active` with empty lists ⇒ A′7 passes ⇒ B4 | A1–A6, A′, target health |
| AP-D3 creation | No record, target empty, marker absent ⇒ PV7: a **new** attempt with new ids | `enumerating`, marker absent ⇒ PV14 ⇒ E′5 or E′6 | A′; target rows (E′1); the marker read; source ⊇ `entryKeys` (E′5) |
| AP-K1′ replacement | The old `enumerating` record ⇒ E′5 or E′6 | The new `enumerating` record ⇒ E′5 or E′6 | As above; a cold start consults no `migrationId` |
| `enumerating → copying` | `enumerating` ⇒ E′5 or E′6; nothing was staged, so re-enumeration loses nothing | `copying`, `copied = ∅`, no rows ⇒ E′7 or E′9 | A′5 (manifest ⊇ `entryKeys`); E′2; §5.5 against the manifest |
| Checkpoint | `copied = C`, rows *C* ⇒ E′9 or E′10 | `copied = C ∪ B`, rows *C ∪ B* ⇒ E′9 or E′10 | E′2 (rows ⇔ `copied`) and E′4; the remaining set comes from the durable `copied`, so batch *B* is never chosen again |
| Copying completion | `copying`, complete ⇒ E′10; AP-CC re-reads the evidence | `verified` ⇒ A′6, E′2–E′4, E′8 ⇒ E′11 | A′6; AP-ACT re-reads complete evidence |
| Activation | `verified` ⇒ E′11; AP-ACT re-validates | `active` ⇒ A and A′ ⇒ B4; neither the marker nor the source is read | A1–A6, A′, target health |
| Any, if the atomicity assumption failed | A malformed record ⇒ A2/A′; rows without progress or the reverse ⇒ E′2; a wrong row ⇒ E′4 | A well-formed, consistent but wrong state ⇒ **not detected by a cold start** (I-11) | — |
| Any — **warm**, the comparison finds neither the issued before- nor after-state | **Detected fault** (I-13): in-memory latch; only the latch write; nothing mounts | Relaunch: latch present ⇒ L0b **BLOCKED**; latch positively absent ⇒ the table, as for any cold start (the undetected residual) | The surviving plan's comparison; afterwards, the latch alone |

The table above describes **genuine** outcomes; a surviving plan that finds either column
continues exactly as a cold start would. Its last row is the one case in which a surviving plan
holds evidence a cold start lacks, and there the actions differ by design (I-11).

**Why each automatic action serves every history that reaches it.** H1–H5 are the P-1 histories
(§7, approval record, item 1).

| Automatic action | Histories reaching it | Why one lossless action serves all | Residual, or missing evidence |
| --- | --- | --- | --- |
| PV6 — D1 | Fresh install; source wholly cleared before any attempt; target lost after an earlier D1 activation | No record and no marker: nothing on the device shows that eligible data existed, and nothing exists to discard | Baseline. Loss before D3 began, and target loss after a D1 activation (which writes no marker), are undetectable |
| PV7 — AP-D3 | First migration | Nothing staged; the current source is copied | Reaching it after an earlier attempt needs a lost committed record together with an absent marker; that history is not detected |
| E′6 — AP-K1′ | H1–H5 in `enumerating`, every `entryKeys` key present, no target row | Nothing staged. The only application data on the device is the current source, which holds every key the attempt began with; the plan copies it exactly as a first D3 would. The in-place replacement keeps the evidence, so no intermediate state reaches Group D | A value changed before fingerprinting is migrated as found; no older copy exists. A target rolled back to an `enumerating` record over a source retired only of keys outside that record's `entryKeys` is not detected (L1) |
| E′9 — AP-COPY | H1–H5 in `copying`, passing A′ and E′1–E′8 | Staged rows and source are proven the enumerated generation; only rows for uncopied manifest keys are written, each verified at copy time | Digest not yet specified (I-7) |
| E′10 — AP-CC | As E′9, with every manifest key copied | Writes no application data; commits `verified` only over complete target evidence read inside the same transaction | As E′9 |
| E′11 — AP-ACT | H1–H5 in `verified`, passing A′ and E′1–E′8 | Writes no application data; re-reads complete target evidence and re-validates the source before switching authority | §5.5's validation-to-activation window; a rolled-back target's post-activation work is already off the device |

##### 5.5 Eligible-set validation, disappearance, and the detection boundary

**A key list does not freeze values, and a manifest does not freeze the key SET.** A check that
compared only keys already in the manifest would let a **newly eligible source key** be added
after enumeration and silently omitted while every recorded fingerprint still matched.

**Required validation — on every pre-activation path that continues (E′9–E′11), including
`verified`:**

1. **Re-enumerate the complete eligible key set** from the source (by the §1 allow-list and
   membership tests).
2. **Set equality:** the enumerated set must equal the manifest's key set. A **new** eligible
   key, or a **missing** one, fails validation.
3. **Content equality:** every manifest key's current source fingerprint must match the
   recorded one.

Failing any of the three ⇒ E′7/E′8 (**blocked**), never a silent skip. **`entryKeys` adds the
same protection before a manifest exists:** in `enumerating`, a key recorded at D3 entry that
is missing from the source blocks (E′5), and from `copying` onwards `entryKeys` must stay inside
the manifest (A′5).

**What prevents change between validation and activation — stated honestly.** Writer exclusion
(§5.4's mounting rule) means no in-app writer runs during migration, so within a single
uninterrupted run the window between validation and the activation transaction contains no
application writes. **It does not exclude another process or a different build**; the design
does not claim a lock it cannot take. AP-ACT re-validates immediately before the activation
transaction, which narrows the window; it does not eliminate it, and that residual is a stated
limit, not a guarantee.

**Disappearance is NOT self-resolving, and nothing is deleted automatically.**

- **A copied key that disappears from the source.** The committed staged target row may be the
  **last surviving copy** of that value. It is therefore **never discarded**. The run blocks
  (E′7/E′8) with the staged data intact and recoverable.
- **An uncopied key that disappears.** It cannot be copied and it must not vanish from the
  record: re-enumeration alone would simply produce a manifest without it, which is exactly the
  silent omission this rule exists to prevent. The run **blocks**, retaining the original
  manifest entry as evidence that the key was once eligible.
- **Disappearance is never read as an intentional user deletion**, and **source-access failure
  is never read as disappearance** (C1 vs C2).

**Re-enumeration is permitted only from E′6** (`enumerating`, nothing staged, every `entryKeys`
key still present). An earlier "discard this attempt's target rows and re-enumerate" rule is
withdrawn: it could destroy the only remaining copy of a value. **Re-enumeration alone never
proves a coherent generation or the absence of omission** — set-plus-content validation does,
and only when it passes. **Zero copied rows in `copying` is not `enumerating`:** a committed
manifest is still validated, and a vanished key blocks.

**Recovery boundary.** A blocked E′7/E′8 state is **recoverable, not terminal**: the staged
target rows and the original manifest are preserved, and the failure/recovery interface reports
the divergence (§6.8). The evidence of what diverged stays intact internally; the copyable
diagnostic report carries rule codes, not key names (§6.6).
Resolving a divergence — accepting the staged copy, or restarting from a fresh enumeration and
discarding staged rows — is not offered by U2's first-version policy. It needs a separately
specified, reviewed and explicitly authorised targeted recovery procedure (§6.5), which does
not exist; until then the state stays blocked. This document does not automate it.

**Unknown commit outcomes.** **An uncertain result is not proof of rollback**, and it is not
resolved by replaying anything from memory. I-11 governs: the target is reopened and the
decision order is evaluated from durable state. The remaining keys are always re-derived from
the durable `copied`, so a committed batch is never chosen again, and keys whose batch did not
commit simply remain in `manifest − copied` and are chosen afresh — nothing committed, so
nothing is replayed. Progress and rows that disagree block (E′2). A surviving plan that finds
the durable state matching neither the issued before- nor after-state has detected a fault
(I-13). An activation is attempted only from E′11, and a record already `active` is never
re-activated.

**Cleanup, and the honest detection boundary.** "The source is never read again" means: **the
source is never read as an authority for application data after activation.** Retirement *does*
read it, for one purpose — before deleting a key it re-computes the fingerprint and compares it
to the manifest:

- match → safe to delete;
- **differ → do not delete.** The source holds a value the target never saw. Record and surface
  it (§6);
- **source missing or unreadable → delete nothing** (B2): retirement stalls, access is
  unaffected.

Retirement never removes the source marker (I-3). **This is the entire detection mechanism, and
it is bounded.** It detects an older-build write only for manifest keys, and only while
retirement still runs. Once `sourceRetirement` is `complete`, nothing reads the source and later
writes are **undetected**. Downgrade is **unsupported**, no merge is offered, and no detection
is promised that cannot be performed.

##### 5.6 Traces

**T1 — post-activation record corruption.** Activate → user deletes session S → record
corrupts → relaunch. **A2: blocked.** No import. S stays deleted. (W1 would have restored it.)

**T2 — a copied current-session value changes before restart.** 14 keys enumerated, 9 copied
including `currentSession`; an older build rewrites `currentSession`; relaunch. Content
validation fails → **E′7: blocked**, **staged rows preserved, nothing discarded**. There is no
mixed-generation snapshot: the staged copy may be the only remaining copy of the pre-change
value.

**T3 — an uncopied outbox value disappears before restart.** The sync key is in the manifest,
not yet copied, and is gone on resume → set-equality fails → **E′7: blocked**, not "skip" and
not re-enumerated. **Nothing is omitted and no deletion is inferred.**

**T3b — a newly eligible source key appears after enumeration.** Every recorded fingerprint
still matches, so a content-only check would pass. Set equality fails → **E′7: blocked**; the
key cannot be left out of the migrated generation.

**T4 — a known outbox key contains a future schema.** Copied **verbatim** (§5.3). Migration
does not parse it; after cutover the sync repository applies its existing unsupported-version
policy unchanged. **It is never skipped**, so hydration never sees `absent` and never writes a
default over it. This is deliberately unlike an unsupported **activation-record** schema, which
blocks (A3/A4).

**T5 — identity records change between interrupted attempts.** A new barrier/resolution is
written to the source between attempts. In `copying`/`verified`, set/content validation
diverges → **E′7/E′8: blocked**, and the divergence is reported rather than absorbed. The
dynamic `accessBarrierResolution.<uuid>.v1` family is enumerated by membership test, so a
barrier created since the last attempt is seen — as a set difference, not as a silent
inclusion. A barrier key recorded in `entryKeys` that vanishes while `enumerating` blocks at
E′5.

**T6 — retirement meets changed source data.** After activation, retirement finds
`sessionHistory` whose source fingerprint no longer matches the manifest → **it is not
deleted**, and the situation is surfaced. A newer value is never destroyed merely because its
key was once copied.

**T7 — enumeration failure.** `listKeys` returns `read_failed` → **C1**: the attempt aborts and
is retried. It is **never** read as "the source is empty", which would have written `active`
over a store that still held data.

**T8 — an activated install whose old WebView storage was cleared.** The `active` record and
target rows are consistent; the source and its marker are gone. **B2 then B4: ordinary access
proceeds.** Retirement is unavailable and is recorded as stalled (B2). **The source is not
consulted for access at any point after a validated activation.**

**T9 — interruption between the two provenance writes.** Under record-first (I-4) the target
record commits before the marker is written. Interrupted between them → a pre-`active`
`enumerating` record with the marker positively absent → PV14 → **E′6 (K1′)**, which writes the
marker under the record's existing id; repeated interruption converges on the same action. A
marker **without** a record cannot arise from that interruption: it means a committed record
was lost or a commit acknowledgement was false, so it **blocks (PV5)** rather than being adopted.

**T10 — unknown checkpoint outcome.** The plan halts (I-9). **Warm:** the reopened state equals
the issued after-state ⇒ the next evaluation reads the durable `copied` and continues at E′9 or
E′10 without choosing that batch again; equals the before-state ⇒ its keys remain in
`manifest − copied` and are chosen afresh; matches neither ⇒ **detected fault (I-13)**.
**Cold:** the same decision from durable state alone; progress and rows that disagree ⇒ **E′2:
blocked**. The uncertain result is never itself taken as proof of rollback.

**CE1–CE5 — the review counterexamples (2026-10-19).** **Synthetic logical traces** worked by
hand over the tables above; they are not application, engine or device tests.

| # | State | Outcome under the approved rules |
| --- | --- | --- |
| CE1 | `verified`; manifest {a, b}; `copied` {a}; target {a}; source holds both, matching | **A′6 BLOCKED** — `verified` requires `copied` = manifest. Had the record claimed `copied` {a, b}, **E′2** blocks (b in `copied`, no row); had a row for b existed but mismatched, **E′4**. In no variant does it reach activation; if the same rows were in `copying`, E′9 copies b, then AP-CC, then AP-ACT |
| CE2 | `verified`; `entryKeys` {a}; manifest {b}; `copied` {b}; target and source hold b, matching | **A′5 BLOCKED** — the known entry key a is not in the manifest. The same record in `copying` blocks the same way |
| CE3 | AP-K1′ or AP-D3 where the marker write is rejected or its outcome is unknown; AP-ACT where the marker is rewritten and the final source validation then fails | AP-K1′: halted at step 1 with **no target transaction issued**; the source may hold the marker, so the next evaluation is PV13 or PV14, both → E′6. AP-D3: step 1 is confirmed and stays committed; the marker may or may not be present; next PV13 or PV14 → E′6. AP-ACT: halted at step 2; the marker is present, or possibly present if its write ended unknown; next PV13 (or PV14) → **E′8 BLOCKED**, and the report names the marker step and its state |
| CE5 | AP-K1′ replacement with outcome unknown: issued before-state `entryKeys` {a, b}; issued after-state `entryKeys` {a, b} with a new `migrationId`; the reopened record carries the new `migrationId` but `entryKeys` {a}; the source now holds only a | **Warm:** "matches neither" ⇒ **detected fault (I-13)** — no AP-K1′, no further step, no activation, no mounting; the latch write is issued. **Relaunch with the latch:** L0b **BLOCKED**. **Relaunch where the latch did not persist:** A′ passes and E′5 finds a in the source, so E′6 selects AP-K1′ — the stated undetected residual (I-11, I-13), not a safe outcome claimed by detection |
| CE4 | `copying`; manifest = `copied` = target keys; every value and the source match | **E′10 → AP-CC** commits `verified`; the plan continues to **AP-ACT** and commits `active`; re-evaluation reaches **B4**. Interrupted at either transaction — warm or cold — the durable state is `copying` (E′10) or `verified` (E′11), and the next evaluation resumes there; never an empty checkpoint |

##### 5.7 Limits of the guarantee

A passing mocked write proves control flow, not survival of power loss; that is what M3b1's
pragma/reopen tests are for. Native storage does not survive uninstall and does not make an
unsynchronised record recoverable from another device. **Downgrade is unsupported, no merge is
offered, and post-retirement source writes are undetectable.** The approved design also states
these residuals rather than hiding them: data lost before D3 began; target loss after a D1
activation, which writes no marker; a target rollback consistent with the current source (L1);
a well-formed but wrong durable state that no running process detected; and a detected fault
whose latch did not persist (I-11, I-13). **The decision core (M3b4a) and the dormant executor
(M3b4b) implement §5; no application path invokes the executor.**

#### 6. User-visible readiness and failure states — the first-version U2 policy

**Status: U2's FIRST-VERSION PRODUCT POLICY IS DECIDED AND ADOPTED. The user confirmed the
recommendations below on 2026-10-20, after approving M3b4b. Codex's independent review of their
documentation adoption was clean, and the user approved the adoption on 2026-10-20. The user
then approved the presentation decisions UG-1–UG-4 (§6.9) on 2026-10-20. This section is the
policy's canonical statement.** §7 keeps the approval record and the stage status. Other
documents reference this section rather than restating it. The interface that implements it is
**Stage M3b4c**. The user authorised it separately, and it is implemented as a
**dependency-injected, dormant** presentation and controller layer. Its independent review and
the user's approval of it are **pending** (§7, "M3b4c implementation status"). **No shipped
path constructs or runs the migration executor.** A flag-enabled build still stops at the
unavailable activation authority (§7, "M3b3 implementation status"), so no user sees this
interface in any build today. §5 still decides *when* a state blocks, an action halts or a fault
is detected. This section decides only what a user sees and may do, and it introduces no new
migration transition.

##### 6.1 What stays unchanged

The existing truthful status conventions still apply — **local save success is not cloud
success**:

| Condition | Observable behaviour |
| --- | --- |
| Storage preparing, migrating, halted or blocked | A blocking state **before** the sporting shell mounts, in one of the four groups of §6.2. Never an empty workspace that looks complete, and never a silent reset |
| Saved on this device only | The existing device-only wording; explicitly **not** "backed up" |
| Synchronised | The existing synchronised state, unchanged |
| Pending / failed synchronisation | The existing pending/failed states, unchanged and still distinct from local-save success |

No navigation redesign, no new cloud record types. **Storage readiness never grants identity
access.** After B4 the identity gate still decides access. No U2 action signs anyone in,
resolves an identity barrier or selects a Profile (§5.1, "Sporting-data recovery is not identity
authorisation").

##### 6.2 Four user-visible groups

Every non-ready migration state is presented under exactly one of four groups. G1–G3 keep the
meaning and identifiers the user approved with U2; G4 was added by the UG-1/UG-2 decision
(§6.9). The labels G1–G3 are recorded **verbatim, in the language in which the user approved
them**, beside the English the interface shows (UG-3):

| Group | Approved label | Interface label (English, UG-3) | Intent |
| --- | --- | --- | --- |
| **G1** | „Vorbereitung läuft" | "Preparation in progress" | Preparation or migration is running, including while a storage call has not yet answered (§6.4) |
| **G2** | „Übertragung angehalten – erneute Prüfung möglich" | "Transfer paused — it can be checked again" | The transfer has halted, or stored state could not be read, and a new check may resolve it (§6.3) |
| **G3** | „Widersprüchliche Daten – Wiederherstellung erforderlich" | "Conflicting data — recovery required" | Positively observed contradictory data, or a detected fault. Only a targeted recovery can resolve it, and none exists in the first version (§6.5) |
| **G4** | — (added by UG-1/UG-2) | "The transfer cannot continue in this version" | A neutral blocking state: an unsupported activation-record format (A3, A4) or an internal check that could not be completed (E′12, `evidence_required`, `invalid_evidence`, internal refusals, an unexpected failure). It claims neither a data contradiction nor that a new check may resolve it |

Technical details may be disclosed separately, behind the existing progressive-disclosure
pattern (UX Writing Guidelines, "Every feature should explain itself"); they are never a wall
of permanent text.

**The group follows the observed cause.** It does not follow the word "halted", a generic
exception or the first finding alone. A blocked decision reports **every** failing check
(I-9). The precedence is deterministic: if any finding is a positively observed contradiction,
**G3** governs; otherwise, if any finding is an unsupported format or an internal-check failure,
**G4** governs; **G2** applies only when every finding is an unavailability that a later read
may resolve. So a contradiction never disappears behind an earlier read failure, and a G4
condition never acquires a recheck because another finding is transient. (The decision core's
`retryMayResolve` marks only the first finding's rule and is explicitly not a UX policy, §7
"M3b4a implementation status".) G3 is never shown without a positively observed contradiction
or a detected fault: an unreadable state is G2, not G3. An unexpected failure is G4, never
evidence of corruption.

**Three distinctions the wording must preserve:**

- A **blocked decision** issued no writes (I-9).
- A **halted plan** may have confirmed effects and one step whose write outcome is unknown. Its
  wording never says "nothing changed" and never describes an unknown outcome as a rollback
  or as having no effect.
- A **detected fault** imposes I-13's persistent in-process stop and possibly a durable latch.

**No unsupported promise.** No text says "all data is safe", "nothing changed", "no data was
lost" or an equivalent unless the evidence establishes that exact statement. The UX Writing
Guidelines' general advice to state "whether existing data is safe" (§15.4) is met here only by
a statement the evidence establishes. For example, "no write was issued" is true of a blocked
decision; "your data is safe" is not established by one.

**Approved example wording for a halt:**

> „Die Datenübertragung wurde angehalten. Bevor sie weitergehen kann, muss die App den
> gespeicherten Stand erneut prüfen."

Its intent is that the transfer stopped and the stored state must be checked again before
anything continues. It claims nothing about whether the interrupted step took effect. The
interface shows it in English (UG-3, §6.9): "The data transfer has paused. Before it can
continue, the app must check the stored state again." There is no localisation infrastructure
and no language selector; the copy is centralised (UX Writing Guidelines §§31–32).

##### 6.3 Rechecking and safe continuation

- **On every application startup** the decision order is evaluated automatically (I-9, I-10).
- **After a retryable halt or failure (G2), „Erneut prüfen" is offered.** A recheck starts
  from the approved evidence and recovery rules. That includes a positively established
  reopening wherever one is required (I-10; after any halt the runner closes, releases and
  reopens before reading), and the same runner's I-11 plan evidence while the process holds
  it. **If every approved guard passes, migration continues automatically under U1, with no
  further confirmation.**
- **No endless automatic retry loop and no parallel attempts.** Automatic re-evaluation within
  one launch stays bounded (I-9). A plan-progression bound reached (`bound_reached`) is never
  success. The control is unavailable while an evaluation is in flight, and concurrent
  invocations join one execution (§7, "M3b4b implementation status").
- **A retry is not a new cold runner.** It never discards surviving warm evidence
  (`plan_evidence_held`), never bypasses a lease held by another owner or an in-process fault
  stop, and never starts a second runner in the same live context. An uncertain connection
  (`requires_reopen`) on the current owner's own lease is resolved only by that owner: the
  same runner, under the same logical lease and keeping its plan evidence, positively closes,
  releases the native handle and reopens before it reads anything (§6.4).
- **A retry is not permission to resume a known contradiction.** It never clears a latch, never
  changes the approved decision order and never overrides a G3 finding. A G3 state is still
  re-evaluated read-only at every startup, and it reaches the same block with the same evidence
  (R56).

##### 6.4 Unanswered operations and waiting

While a storage call remains unanswered, an **honest waiting state** is shown within G1. An
unanswered operation is not a completed halt. **A presentation timeout changes only the
presentation.** It does not establish a rollback, release ownership, start another migration,
force-unlock the connection or authorise a later step. Already-issued work and any necessary
cleanup keep the approved ownership and cancellation rules (§7, "M3b4b implementation status"):

- disposal waits for an in-flight call to answer;
- a target transaction that has begun but whose COMMIT has **not** been issued is stopped by
  issuing the necessary ROLLBACK (reported `cancelled`). This is a local rollback of a
  transaction that never committed. It is not a compensating write against a committed step and
  not a cross-store rollback, both of which stay prohibited (I-9);
- once COMMIT has been issued, it is awaited and its real outcome — confirmed or unknown — is
  reported. No ROLLBACK is issued after it, and it is never presented as undone;
- a stopped opening cleans up its half-opened connection. Close and native-handle release run
  where the approved lifecycle requires them;
- cleanup never drops unresolved warm evidence or a fault stop. A ROLLBACK, close or release
  that is not positively acknowledged leaves ownership retained (`requires_reopen`, or the
  lease kept).

**Reopening is not releasing ownership.** Two cases stay distinct:

1. **Another owner holds the resource** — another lease, another store instance that may hold a
   native handle, or a pending diagnostics transaction. There is no takeover, no forced unlock
   and no competing migration. Acquisition proceeds only after the legitimate holder resolves
   its own work and positively frees the resource.
2. **The current migration owner's connection is `requires_reopen`.** The **same** logical
   lease, runner and surviving plan evidence are kept. That owner positively closes the
   connection, releases the native handle and opens a fresh connection under the same lease,
   and only then reads evidence and applies the approved decision order (I-10, I-11). The
   native-handle release inside a reopen does **not** release the logical migration lease.
   A reopen proves the connection is fresh; it never proves what an uncertain COMMIT did.
   Only the reopened durable state, compared under I-11, decides that.

**No progress percentage is invented.** The presentation threshold is
an engineering detail: M3b4c uses 8 s (`MIGRATION_WAITING_PRESENTATION_DELAY_MS`). It is not a
product timeout and does not change storage behaviour.

##### 6.5 Contradictory data — no general manual repair in the first version

The first version offers **no** general:

- "continue anyway";
- "use the old copy" or "use the staged copy";
- "start again" by discarding staged data;
- "accept missing data";
- reset, clear, reinstall or empty-workspace bypass.

**Both available data states are preserved**, together with their provenance evidence and
staged progress (§5.5, "Disappearance is NOT self-resolving"). Any of the following needs a
**separately specified, reviewed and explicitly authorised targeted recovery procedure**:
selecting one contradictory data state, acknowledging already-missing data as a recovery
transition, replacing data, or restarting from a fresh enumeration. None exists.

**The user explicitly accepts that genuine contradictions stay blocked until such a targeted
recovery is available.** This is an **intentional availability limitation of the first
version**, not an unimplemented automatic fallback. It does not prohibit the approved lossless
automatic transitions (D1, AP-D3, AP-K1′, AP-COPY, AP-CC, AP-ACT under U1).

**Fault-latch clearing.** No general user control and no automatic path clears a fault latch.
A later targeted recovery procedure must define the inspection, the authority, the repair and
the explicit confirmation required before a latch is removed, and **removing a latch alone
repairs nothing**. U2's approval authorises **no** current latch-clearing action. A known fault
stays blocked, including on an installation whose record reads `active` (L0b, R76). A
read-only inspection for display cannot resume migration (I-13).

##### 6.6 Diagnostic report

A diagnostic report is offered **only on explicit request**, for the user to copy. It is
data-minimised, and it is **never transmitted automatically**. Its approved content is
exactly:

- the application version;
- the technical error or rule code (a rule identifier such as `E′7`, or a fixed reason code);
- the phase, only where it is positively known from a record that passed validation — never
  from an unreadable or malformed one;
- the known step outcomes, keeping **confirmed**, **outcome unknown** and **not issued**
  distinct.

It **excludes** training contents, credentials, Profile identifiers and raw data. Internal
evidence is never dumped, and runner reports or decision findings are never serialised whole.
**Key names are not part of the report:** eligible key names can embed Profile identifiers (the
Profile-scoped sporting keys and `accessBarrierResolution.<uuid>.v1`). Raw records, markers,
latch contents, application values and internal payloads are not an approved report interface.
Internal evidence stays intact; the report is a deliberately restricted projection of it. **A
diagnostic report is neither a backup nor a restoration mechanism.** M3b4c implements only
explicitly requested local copying to the device clipboard, with a selectable read-only text as
the fallback. There is no export or download, no automatic transmission, no support
integration, no logging and no telemetry. A stopped plan's step dispositions recorded earlier
in the same session may appear, labelled as history, when the current check could not evaluate
the stored state; they are never presented as a fresh observation (§7, "M3b4c implementation
status").

##### 6.7 Help path

The policy is a **defined help route that shows an understandable error code**. A "contact
support" action may appear **only once a real contact channel and a handling procedure
exist**. No address, URL, service, support role or response-time promise is specified, and none
may be invented. The concrete channel and its operating procedure are an **operational
follow-up** (§7, inventory item 3). Their absence does not leave the first-version U2 policy
undecided. Until they exist, no contact action appears.

##### 6.8 Outcome and action matrix

Every row also keeps four rules: the diagnostic report of §6.6 is available on request; the help
route of §6.7 applies; ordinary consumers never mount outside B4; and §6.5's general
prohibitions hold. "Recheck" means §6.3's „Erneut prüfen". "Continues" means automatic
continuation under U1 once every approved guard passes on the recheck.

| Observed condition | Rule | Group | Honest explanation (intent) | Recheck | Continues | Specific prohibitions |
| --- | --- | --- | --- | --- | --- | --- |
| Evaluation or plan running: startup check, D1, AP-D3, AP-K1′, AP-COPY, AP-CC, AP-ACT | §5.4a | G1 | Storage is being prepared | — | Yes, under U1 | Never an empty workspace that looks complete; no progress percentage |
| A storage call issued and not yet answered — read, transaction, COMMIT, reopen or disposal | I-9, §6.4 | G1, waiting | Still waiting for the device's storage to answer | No; the call is still in flight | When it answers, its real outcome decides | A timeout never establishes rollback, releases the lease, force-unlocks or starts competing work |
| Plan-progression bound reached | `bound_reached` | G1 while bounded continuation runs; a settled bound is G2 (the session starts no automatic loop) | Preparation is not finished | Yes | Yes | Never presented as ready or complete |
| Fault-latch read failed | L0a | G2 | The stored state could not be checked | Yes | Yes, once a read positively shows no latch | Never read as "no latch" |
| Activation record unreadable | A1 | G2 | The stored state could not be read | Yes | Yes | Never re-import; never "fresh install" |
| `active` record, target failing now | B1 | G2 | The data on this device cannot be read right now | Yes | Yes, to B4 once the target is healthy | No fallback to the old source; not described as data loss |
| Source enumeration failed | C1 | G2 | The previous storage could not be read | Yes | Yes | Never "source empty" |
| Target row enumeration failed | PV1, PV9 | G2 | The new storage could not be read | Yes | Yes | Never "no rows" |
| Marker read failed | PV3, PV10 | G2 | The transfer's link marker could not be read | Yes | Yes | Never "absent" |
| An issued row unreadable during a warm comparison | I-1 | G2 | The interrupted step could not yet be checked | Yes, by the same runner, after a positively established reopen | Yes, if the comparison finds the before- or after-state; "matches neither" is a fault (G3) | No new cold runner in this process; never equality or absence |
| Plan halted: a write ended outcome unknown (marker or target transaction) | I-9, I-11, §5.4a | G2 | §6.2's approved halt wording | Yes, by the same runner after a positively established reopen; cold at the next launch | Yes, from durable state plus warm evidence | Never "nothing changed", "rolled back" or "no effect"; confirmed / unknown / not-issued kept distinct |
| Plan halted at a failed read, recheck read or digest that was not obtained, or a step never issued (`preparation_failed`, `target_unavailable`, a refused marker precondition on an unreadable marker) | I-9, §5.4a | G2 | As above; no write was issued by that step | Yes | Yes | A step never issued is not reported as an unknown write |
| A required reopen did not complete | `reopen_failed` | G2 | The storage connection could not be re-established | Yes; the same runner retries the reopen under the same logical lease, and nothing is read before it succeeds | Yes | No evidence read through an uncertain connection; the lease, plan evidence and any fault stop are kept |
| Target refused because another owner holds the resource: another lease (`lease_held`), another store instance that may hold a native handle (`connection_held_elsewhere`), or a pending diagnostics transaction | `target_refused` | G2 (G1 waiting while the holder's call is in flight) | Storage is busy with another operation | Yes; it cannot bypass the holder | Yes, once the legitimate holder has resolved its work and positively freed the resource | No takeover, forced unlock, lease reset or competing migration |
| Target refused with `requires_reopen` on the current owner's own lease (a native transaction state left uncertain) | `target_refused`, then the owner's reopen | G2 (G1 waiting while the reopen runs) | The storage connection must be re-established before checking | Yes, by the same runner under the same logical lease | Yes, after a positively established close, native-handle release and fresh open, then the approved decision order from reopened evidence | Never a cold replacement runner, a forced unlock or loss of fault or plan evidence; the native-handle release is not release of the logical lease; the reopen does not establish what an uncertain COMMIT did |
| Plan halted for a positively observed contradiction: a copy-time fingerprint mismatch (I-7), an `entryKeys` recheck that found a key missing, AP-ACT's final source validation failing, AP-CC/AP-ACT finding mismatched target evidence, or a refused marker precondition on a foreign or malformed marker | I-7, §5.4a, §5.5 | G3 | The stored data does not match what the transfer recorded | Not as a fix; the next evaluation reaches the corresponding block (E′7, E′5, E′8, E′2–E′4, PV11/PV12) | No | No overwrite of either side; no marker overwrite |
| Fault latch present, any bytes, any phase including `active` | L0b | G3 | A contradiction was detected earlier; the transfer stays stopped | No resume; read-only display only | No | No clearing (§6.5); never mounts although B4 would otherwise |
| Detected fault in this process: warm "matches neither", or a confirmed step contradicted | I-13 | G3 | The stored state contradicts what the app just wrote; the transfer has stopped | No resume while the in-process stop stands; bounded latch-write attempts are not a recheck | No | Only the latch write is permitted; `fault_stop_held` keeps the lease |
| Activation record malformed, invalid phase, manifest or `copied` invalid, phase-shape or integrity predicate failing, `storeIdentity` invalid | A2, A5, A6, A′1–A′7, PV8 | G3 | The transfer record is inconsistent | No | No | Raw bytes preserved; never overwritten or downgraded |
| Activation-record `schemaVersion` **higher** than supported | A3 | G4 (UG-1) | A compatible version of the app is needed | No — this build cannot continue | Only in a compatible version, through its own approved rules | No downgrade, no automatic conversion, no repair |
| Activation-record `schemaVersion` **lower** than supported | A4 | G4 (UG-1) | This stored format cannot be continued; no approved upgrade path exists | No | No | Not described as fixable by updating; no conversion, no repair |
| No record, but the target holds application rows | PV2 | G3 | The new storage already holds data without a transfer record | No | No | No import, no deletion |
| Marker malformed | PV4, PV11 | G3 | The transfer's link marker is invalid | No | No | Bytes preserved; never adopted or overwritten |
| Marker present without a record | PV5 | G3 | The previous storage refers to a transfer record that is missing | No | No | Never adopted |
| Marker carries a different id before activation | PV12 | G3 | The previous storage belongs to a different transfer attempt | No | No | Foreign marker never overwritten or adopted; record never replaced |
| Rows while `enumerating`; progress and rows disagree; a row outside the manifest; a staged row not matching its fingerprint | E′1–E′4 | G3 | Prepared data is inconsistent with the transfer record | No | No | No repair by deletion or re-copy; staged rows preserved |
| An `entryKeys` key vanished from the source | E′5 | G3 | Data present when the transfer began is missing | No | No | Nothing re-enumerated; no "accept missing data" |
| Source set or content diverged from the manifest: key missing, new or changed | E′7, E′8 | G3 | The previous storage changed after the transfer began | No | No | Staged rows and the original manifest preserved; no "use old/staged copy", no fresh enumeration |
| An observation no row covers; omitted evidence; an invalid snapshot; an internal refusal (`no_lease`, `wrong_lease`, `invalid_transaction`); a malformed digest output; an unrecognised or unexpected failure | E′12, `evidence_required`, `invalid_evidence`, `target_refused` | G4 (UG-2) | An internal check could not be completed | No | No | Permits nothing; never "ready"; restricted diagnostics and explanatory help only |
| Valid `active` record, healthy target, old source or marker missing or unreadable | B2 → B4 | — (ordinary access) | — | — | Access proceeds | The source and marker are not consulted; an already-known retirement stall or declined deletion may appear only as a subordinate, nonblocking detail (UG-4) |
| Valid `active` record, healthy target, no latch | B4 | — (ordinary access) | — | — | Mounts; the identity gate then decides access | Storage readiness grants no identity access |
| Runner disposed (document ending, explicit disposal) | `disposed` | — | — | — | Never | No new migration read, write, digest, opening or setup work and no readiness or access publication. Already-issued work is awaited, and required cleanup runs (§6.4): a transaction begun without COMMIT may be rolled back; an issued COMMIT is awaited and its confirmed or unknown outcome reported, never rolled back; close and native-handle release where required. Cleanup never drops warm evidence or a fault stop; `plan_evidence_held`, `fault_stop_held` and any unacknowledged cleanup keep the lease |

##### 6.9 Presentation decisions UG-1–UG-4 — APPROVED BY THE USER (2026-10-20)

These four presentation details could not be derived from the U2 policy alone. The user
approved the recommendations below on 2026-10-20. None weakens a rule above, and none changes
storage behaviour.

- **UG-1 — incompatible activation-record formats.** A3 and A4 belong to the neutral blocking
  group **G4**, with distinct explanations. A higher unsupported version says that a compatible
  application version is needed. A lower unsupported version says that no approved upgrade path
  exists, and it is never described as fixable merely by updating. Neither offers a recheck that
  suggests this build can continue. No downgrade, automatic conversion or repair.
- **UG-2 — internal-check failures.** E′12, `evidence_required`, `invalid_evidence`, internal
  refusals (`no_lease`, `wrong_lease`, `invalid_transaction`) and an unexpected failure use the
  same group **G4**. They offer restricted diagnostics and explanatory help, and no retry or
  continue action. They establish no readiness and permit no storage action.
- **UG-3 — language.** The interface keeps its existing English. The approved German labels and
  the halt example are translated faithfully (§6.2), keeping the distinctions between a blocked
  decision, a halted action, an unknown write outcome, a waiting operation and a detected fault.
  No localisation infrastructure and no language selector.
- **UG-4 — retirement findings.** An already-known retirement stall or declined-deletion finding
  may be shown as a subordinate, nonblocking detail. It never blocks a healthy active target and
  never implies that its data has failed. M3b4c adds no source retirement, no deletion and no
  additional source or marker probe: it renders such a finding only when an existing result
  already supplies it. **Intentional limitation:** retirement is not implemented (§7, "M3b4b
  implementation status"), and for an `active` record the evidence collector does not read the
  source, so in practice no such finding is observed today. Unimplemented retirement cannot
  supply findings that were never observed.

##### 6.10 U2 acceptance requirements for M3b4c

These are the acceptance requirements for Stage M3b4c. They are deliberately numbered apart from
R1–R77, which are unchanged, and the class-L and class-M coverage of R1–R77 is **not** evidence
for them. Their behavioural tests and the traceability matrix are listed in §7, "M3b4c
implementation status"; that evidence is component and controller evidence over the class-M
harness, not simulator or device evidence, and it awaits independent review.

| # | Requirement |
| --- | --- |
| U2-1 | Every blocked family of §§5.2–5.4, every halted plan of §5.4a, I-13's faults and the runner's lifecycle outcomes map to the group, explanation and actions of §6.8, with the group derived from all findings |
| U2-2 | An unknown outcome is never described as a rollback or as having had no effect; confirmed, unknown and not-issued steps stay distinct |
| U2-3 | Startup continuation and the explicit recheck continue automatically only when every approved guard passes, never run in parallel, and never loop without a bound |
| U2-4 | No recheck bypasses a standing fault, a latch, a lease held by another owner or contradictory data, and none replaces warm evidence with a new cold runner in the same process. An uncertain connection on the owner's own lease is resolved only by that owner's positively established reopen under the same logical lease and runner, keeping fault and plan evidence |
| U2-5 | A waiting state or presentation timeout never releases an unanswered operation, releases ownership, force-unlocks or starts competing work |
| U2-6 | After disposal, no new migration read, write, digest, opening or setup work or readiness publication occurs. Already-issued work is awaited; a transaction begun without COMMIT may be rolled back; an issued COMMIT's confirmed or unknown outcome is reported and never rolled back; close and native-handle release run where required. Cleanup never drops warm evidence or a fault stop, and unacknowledged cleanup keeps ownership |
| U2-7 | No manual data selection, reset, staged-data discard, acceptance of missing data, fresh-enumeration restart or latch clearing is reachable |
| U2-8 | A higher activation-record version explains that a compatible version is needed, and a lower one that no approved upgrade path exists and is not described as fixable by updating; both are G4 without a recheck, and neither is converted |
| U2-9 | The diagnostic report contains only §6.6's fields and omits values, credentials, Profile identifiers, key names and every identifier embedded in a key name |
| U2-10 | No diagnostic report is transmitted automatically |
| U2-11 | No contact action appears until a real channel and handling procedure exist |
| U2-12 | A healthy, validated active target stays usable whatever the state of the old source or marker |
| U2-13 | Identity authority is unchanged: no U2 action signs in, resolves a barrier or selects a Profile |
| U2-14 | The existing local-save and cloud-sync status distinctions are unchanged |
| U2-15 | G4 (UG-1/UG-2): A3, A4, E′12, `evidence_required`, `invalid_evidence`, internal refusals and unexpected failures are presented in G4 with restricted diagnostics and help, no recheck or continue action, no readiness and no storage action; mixed findings follow §6.2's precedence G3 > G4 > G2 |
| U2-16 | UG-3: the interface is English, the approved labels and halt example are translated faithfully, and no localisation infrastructure or language selector exists |
| U2-17 | UG-4: an already-known retirement finding is subordinate and nonblocking, and rendering it performs no source, marker or retirement probe |

#### 7. Implementation stages and acceptance gates

**The earlier stage order was unsafe: M3b3 activated native consumers in production before
M3b4 supplied migration, which would have run an existing installation's normal hydration
against an empty new engine.** Corrected below: **production cutover happens in M3b5 and
nowhere earlier.** Every stage before it is inert in production.

| Stage | Prerequisite | Allowed code | Production effect | Completion criteria |
| --- | --- | --- | --- | --- |
| **M3b1 — engine evidence** | M3b0 reviewed | the native adapter module and an **opt-in, off-by-default diagnostic panel inside the existing app**; **no production composition** | **None** | Which of R1/R2/R3 (§2) is adopted, decided on measured evidence; synthetic sizing and a recorded operating envelope; the diagram-cache policy (§1) decided. Scope below. **Adapter and panel implemented 2026-09-30. Physical-device evidence exists for the PRAGMAS and RESTART RECOVERY (2026-09-30). The transaction scenarios (tooling 2026-10-15) have run on a disposable SIMULATOR only (user-reported, 2026-10-15); physical-device transaction acceptance, naturally occurring commit failures and interruption during a commit are NOT measured, and no operating envelope is recorded. Not complete.** The diagram-cache policy is decided (§1) |
| **M3b2 — native adapter** | M3b1; engine chosen | new adapter module + its tests | **None by itself — it is selected only by M3b3's flag** | Implements `RemovableStorageAdapter` with unchanged result contracts; real-engine integration tests; unsupported platform fails closed. **The module is written and unit-tested (2026-09-30) and runs against the real engine on a physical device for reads, writes and restart recovery (2026-09-30), and on a simulator for the diagnostic transaction scenarios (2026-10-15). The row is still NOT complete: physical-device transaction evidence and native commit-failure evidence, which source retirement depends on, are unmeasured** |
| **M3b3 — composition, behind an off switch** | M3b2; **§4 session decision APPROVED (S2, 2026-09-30)** | all five seams in §3, identity injection, protected credential store, readiness gate | **None: the native adapter is selected only under an explicit off-by-default build flag, and even then the application does not mount** — see the barrier below. Existing installs keep `localStorageAdapter` | Every seam demonstrably reaches the selected adapter; hydration/identity/sync all wait on readiness; **no default written while preparing**. **IMPLEMENTED 2026-09-30** |
| **M3b4 — migration** | M3b3; the §5 design **approved (2026-10-19)**; the adoption independently reviewed (clean) | migration module, activation record, fault latch, source and target enumeration — staged as M3b4a/b/c (§7 approval record, item 5) | **None — still behind the flag; the production activation authority stays `unavailable`** | The M3b0 §5.1 invariants, §5.4 tables and §5.4a plans implemented; every trace in M3b0 §5.6 and every acceptance case below, including R1–R77 in their evidence classes, green. **M3b4a (the decision core) approved (2026-10-20); M3b4b (the dormant executor) implemented, independently reviewed (clean) and approved by the user (2026-10-20), class-M evidence only; U2's first-version policy and UG-1–UG-4 decided and adopted (2026-10-20, §6); M3b4c implemented and locally verified, dormant, awaiting independent review and the user's approval** |
| **M3b5 — production cutover** | M3b4 reviewed; **M3b6 passed**; §7's remaining inventory closed; the mid-session credential-failure decision | flag default flip only | **THIS is the cutover** | Migration runs before the shell mounts; blocked states surface per §6. **Not yet performed — this row is a criterion, not a result** |
| **M3b6 — device acceptance, BEFORE cutover** | M3b4 | none | — (a disposable device only) | The iPhone procedure below passes on a **disposable** device and is **reported by the user**, **before** M3b5. Reordered on 2026-10-19 so that migration is verified before cutover, as the P6 decision requires; the number is kept for reference stability. Android remains M5 |

**Engine-evidence scope (M3b1) — decided by the user on 2026-09-30: IN THE EXISTING APP.**

An earlier revision of this section required a **third installed application** with its own
identifier (e.g. `local.dev.curlingstorageharness`), so that engine evidence could not touch
either the user app (`local.dev.curlingperformance`) or the Brower BLE probe
(`local.dev.browerbleprobe`). **The user has superseded that requirement**: the evidence is
gathered directly in the existing iOS app, because a separate application would exercise a
different container, a different build configuration and a different plugin integration from
the one that will actually ship — which is the thing being measured. **Android must remain
supported by the shared design** (Stage M5 still owns Android verification).

Isolation is therefore achieved by DATABASE and by BUILD, not by application identity:

- a **fixed, dedicated synthetic database** (`curling-storage-diagnostics-synthetic`), never
  an application database and never derived from configuration, a Profile or user input;
- **synthetic data only**, generated deterministically. The panel never reads, writes, copies,
  clears or migrates a real local record, and never uploads anything;
- **no production composition.** The adapter is not selected by any repository, the sync-state
  adapter, the legacy-retirement call, the identity repositories or the SDK session. Normal
  application data keeps using its existing storage;
- an **explicit build-time opt-in, off by default** (`CURLING_MOBILE_STORAGE_DIAGNOSTICS=1`).
  It is a third axis: it does **not** relax `NODE_ENV`, production React semantics, the
  `IS_DEV` developer surfaces or any identity guard, and there is **no** URL parameter and
  **no** stored preference that can reach it. A default build does not contain the panel at
  all;
- the **normal app stays reachable** in a diagnostics build — the panel is an overlay behind
  one button, not a replacement shell.

**What this changes and what it does not.** It supersedes the separate-app requirement only.
It does **not** authorise deleting or resetting existing local data, does **not** replace
normal application storage, and does **not** settle where provider credentials are stored
(that was settled separately: S2, §4). **Preservation is decided** (P6 amendment,
2026-09-30): all existing local data is preserved, a pilot reset is **rejected**, and
existing data must be migrated and verified before cutover.

**Database isolation is not installation permission.** **Historically**, the 2026-10-15
diagnostics build used the training app's then-current identifier
(`local.dev.curlingperformance`); installing that build would update/replace an installation
of that same identity. **Current builds target `me.evolane.curling` (P4)**: they would update
that identity, not the old source, and do not inherit its container, data or credentials.
The historical evidence below remains evidence for the old identity only. A separate
synthetic database does not authorize installation over any data-bearing app. The user's
only physical iPhone holds real training data; it did **not** receive the 2026-10-15
diagnostics build and must not receive a new diagnostics or target build under this scope.
Preserve the old installation; no Run/install, reset, uninstall/reinstall or data clearing
is authorized. A complete transfer/restore path and separate installation approval are required.

**M3b1 implementation status — 2026-09-30. This is the canonical statement; other documents
reference it rather than restating it.**

*Implemented:*

- `@capacitor-community/sqlite` **8.1.1 pinned** as a dependency. Its peer range
  (`@capacitor/core >= 8.0.0`) accepts the installed 8.5.2, its `Package.swift` targets
  iOS 15 and its shipped API (`createConnection`/`open`/`execute`/`run`/`query`/`close`,
  plus `begin/commit/rollbackTransaction`) was inspected in the published tarball before use.
  No other dependency was changed.
- `src/lib/persistence/nativeSqliteAdapter.ts` — a `RemovableStorageAdapter` over a two-column
  key/value table, with one FIFO-serialised connection owner, bound parameters everywhere,
  fixed safe error messages, fail-closed platform gating through `detectRuntimePlatform`
  (ADR-0047) and shared iOS/Android dispatch. `src/lib/persistence/capacitorSqliteEngine.ts`
  is the one file that names the plugin.
- An opt-in mobile diagnostic panel under `mobile/src/diagnostics/`, driving that adapter
  against the synthetic database above.
- Automated tests: adapter contract, failure classification, hostile thrown values, ordering,
  close/reopen ownership, platform gating, isolation and build-default behaviour — including a
  **plugin-faithful** engine that reproduces the installed plugin's own per-platform statement
  preprocessing, rather than a fake that agrees with the adapter about what a statement means.

*Corrected on independent review (2026-09-30), all three found by reading the installed plugin
sources rather than by testing against an agreeable fake:*

- **Bulk deletion silently deleted nothing on iOS.** `UtilsSQLCipher.execute` splits any SQL
  containing "DELETE FROM" on ";" and drops the last component, so an unqualified
  `DELETE FROM records` became the empty string; `sqlite3_exec` succeeded and diagnostic
  cleanup reported success over records that were still there. It now goes through `run`,
  which compiles one statement with no such rewriting, and the test asserts **row
  disappearance**, not that the call resolved.
- **The durability pragmas were sent as one `"; "`-joined line.** Android's
  `UtilsSQLite.getStatementsArray` splits on `";\n"`, so that line was not split and reached
  `execSQL`, which executes exactly one statement — **the database would not have opened on
  Android at all**, while iOS's `sqlite3_exec` ran both and hid the defect. Each pragma is now
  its own single-statement call, in the shape matching whether it returns rows.
- **A malformed query response was read as absence.** `{ values: [null] }` produced a
  successful `value: null`, which is exactly what authorises a hydrating repository to write a
  default over data that still exists. Only a valid, genuinely empty result now establishes
  absence; every malformed envelope, invalid row and non-string value fails closed.

**Android device behaviour remains unverified.** The plugin-faithful tests are still mock
evidence about statement handling; no Android project exists (Stage M5).
- **Compilation evidence:** an unsigned `xcodebuild` of the existing iOS app with the plugin
  linked (`SQLCipher.framework` embedded, `CapacitorSQLitePlugin` present in the binary) and
  the diagnostics bundle copied into the app container.

**Device evidence — USER-REPORTED, 2026-09-30, from the in-app diagnostic panel on the
existing iPhone application.** This is the `device` evidence class and it is reported by the
user, not measured by an agent. What it establishes:

| Observation | What it establishes |
| --- | --- |
| `journal_mode = wal` | The requested journal mode is **actually in force**, not merely requested |
| `synchronous = 2` | `FULL` is **actually in force** (0 OFF, 1 NORMAL, 2 FULL, 3 EXTRA). In WAL mode `FULL` syncs the WAL at every transaction commit. It is **not** the highest value — `EXTRA` exists — and a configured value is not a tested power-loss outcome. (An earlier revision of this row called `FULL` the strongest setting; that was wrong) |
| `page_size = 4096`, `sqlite_version = 3.53.4` | The engine and page size actually in use, recorded rather than assumed |
| "Verify after app restart" succeeded **in airplane mode** | Written values survive **process death**, with no network involved |
| All five synthetic fixtures matched, **994,669 bytes** total | Whole-document round-trip is byte-exact at that size, across the bridge |
| The never-written key was **absent** | A missing key reads as absence and not as a fabricated value — the case that would otherwise authorise hydration to write a default over data |
| Reported verification took **55 ms** | One measured latency for that operation at that size |

**What it does NOT establish, and must not be reported as establishing:**

- **Nothing about Android.** No Android project exists (Stage M5), and shared design is not
  Android evidence.
- **Nothing about power-loss survival.** A successful write and a successful restart are not
  proof that a commit reached stable storage before returning. `synchronous = FULL` being in
  force is a configuration fact, not a tested outcome.
- **Nothing about failed or UNCERTAIN commits**, and nothing about **reopen after an
  interrupted commit**. These are precisely what §5.1's checkpointed model rests on, so
  **source retirement stays unjustified** and M3b4 stays blocked on them.
- **No capacity limit.** 994,669 bytes is one measured point, not a ceiling, and **no
  operating envelope is recorded**.
- **Nothing about backup or restore behaviour**, for either the SQLite store or the Keychain
  item — that must be verified against the SELECTED configuration and has not been.
- **Nothing about transactions.** The device evidence above exercises reads, writes, removals
  and restart recovery only. The panel has since gained explicit transaction scenarios (see
  the M3b1 transaction-tooling entry below). They have run on a **simulator** (the
  simulator-evidence entry below), **never on a physical device**, so this physical-device
  record is unchanged and is not merged with the simulator run.

**M3b1 transaction tooling — 2026-10-15. Tooling implemented.**

The panel's checkpoint scenarios exist so §5.1's checkpointed model can be observed before
M3b4 implements it. **This entry records tooling only**; what it has produced so far is the
separate simulator-evidence entry that follows it. **Physical-device transaction evidence and
native commit-failure evidence remain outstanding**, M3b4 stays blocked, and source retirement
stays unjustified.

*Implemented:*

- A **diagnostics-only owned transaction** on `NativeSqliteStore`
  (`beginDiagnosticTransaction` / `stageDiagnosticWrites` /
  `stageDiagnosticFailingStatement` / `commit` / `rollback` / `abandon`). It is deliberately
  **not** on `RemovableStorageAdapter`: that contract still promises no multi-key atomicity,
  no repository can reach these, and
  `src/lib/persistence/__tests__/architectureBoundary.test.ts` asserts that no production file
  under `src/` references any of them.
- **The call-shape decision, taken from the installed plugin's sources.** The plugin's
  `run(statement, values, transaction = true, …)` defaults to wrapping each statement in its
  OWN transaction, and on iOS that reaches `Database.runSQL(sql:values:transaction:)`, which
  issues an unconditional `BEGIN TRANSACTION`. A statement issued with that default inside an
  owned transaction would either fail — SQLite rejects a nested `BEGIN` — or commit
  independently and end the owned transaction early, committing a partial checkpoint. The
  flag is therefore **mandatory** on the adapter's connection interface, staged statements
  pass `false`, and the plugin-faithful test engine rejects a nested `BEGIN` so an
  implementation that regressed would fail in tests rather than on a device.
- **One transaction at a time, and no escape into the ordinary queue.** While an owned
  transaction is open, every other operation on that store — reads, writes, removals,
  settings, cleanup and `close()` — is **refused**, not queued. A read is refused too: on one
  connection it would observe the transaction's uncommitted rows, which is the most
  misleading observation this store could produce.
- **Ownership survives uncertainty.** The store tracks its transaction as `open` (BEGIN
  positively acknowledged) or `uncertain` (some lifecycle step failed or answered unreadably,
  so whether a native transaction is still open is unknown). Ownership is taken **before**
  BEGIN is issued, so a BEGIN that takes effect and then rejects — or resolves with anything
  other than the installed plugin's `{ changes: { changes: 0 } }` acknowledgement — leaves an
  owned, `uncertain` transaction rather than a free store. Nothing may be staged into or
  committed from an uncertain transaction. Ownership ends only on a positively acknowledged
  COMMIT or ROLLBACK, or when `abandon` has **both** closed the connection **and** released
  the engine's native handle; a failure at either step keeps ownership (a retry resumes at the
  failed step), and if neither completes the remaining recovery is a new document
  (force-quit and relaunch). The panel mirrors the store's ownership after every call and
  words the two states differently: an acknowledged open transaction versus an unknown
  outcome.
- **Four scenarios** in `mobile/src/diagnostics/checkpointDiagnostics.ts`: a committed
  checkpoint; explicit rollback and a deliberate `NOT NULL` statement failure; an interruption
  rehearsal that leaves a transaction open for a manual force-quit; and both uncertain
  acknowledgements ("commit happened, answer lost" and "no commit happened").
- **Classification by reading, never by the call's return value.** A rejected or discarded
  commit result is never treated as proof of rollback; `classifyCheckpoint` is handed the
  evidence from a reopened store and returns committed / not committed / **unresolved**, with
  unresolved covering partial, mismatched, malformed, unreadable and incomplete evidence.
  "Not committed" requires either the previously observed progress record standing
  **unchanged** (all attribution fields, not just attempt id and checkpoint number) with
  every row matching, or — when there was none — successful absence reads for the progress
  record **and every payload row**; rows present without a progress record are partial, and
  a failed read is never counted as absence. An attempt is only started against a baseline
  that was itself fully established.
- **Reopen evidence requires a positively established fresh connection.**
  `reopenDiagnosticConnection` closes the connection, releases the engine's native handle and
  opens a fresh one, reporting which boundary failed. Every scenario — commit, rejected
  commit, rollback, statement failure, both lost-acknowledgement cases and recovery after an
  abandon — gives **no verdict and no reopen claim** when any of those steps fails; it does
  not read through the uncertain connection and call that evidence.
- **Synthetic cleanup asks first.** Both deletions (all synthetic data, and the checkpoint
  keys alone) open a confirmation naming the synthetic database and the deletion scope;
  opening or cancelling deletes nothing, and confirming still goes through the controller's
  and store's execution-time refusal while a transaction is owned. Nothing is
  replayed or repaired: what to do about an unresolved checkpoint is the migration's decision
  and is still open.
- **Attempt-scoped payloads.** Checkpoint rows are derived from the attempt id and checkpoint
  number and verification regenerates them, so an earlier successful attempt's rows — or the
  deterministic restart fixtures — cannot certify a later attempt.
- The scenarios ride the EXISTING diagnostics opt-in and synthetic database; no new flag, no
  new dependency, no caller-supplied SQL, database name or application key.

*Not established by any of it:* power-loss survival; a naturally occurring native commit
failure (every failure exercised is either a deliberate constraint violation or an injected
lost acknowledgement); backup/restore; capacity; Android; and migration readiness. The
interruption rehearsal is a **manual procedure for a disposable test installation**
(`mobile/README.md`). It has been performed once, on a simulator (below), and never on a
physical device.

**M3b1 real-engine simulator evidence — USER-REPORTED, 2026-10-15. This is the canonical
record; other documents link here rather than restating it.**

*Provenance and evidence class.* Performed manually by the user on 2026-10-15
(Europe/Zurich), guided by Codex, and supplied as screenshots of the in-app diagnostics panel.
It is **user-reported simulator evidence through the real native SQLite plugin**. It is not
mock evidence, not an agent measurement and **not physical-iPhone acceptance**. No agent
independently reproduced it, and the screenshots came from temporary locations: there is no
persistent screenshot archive, exported log or attachment in this repository.

| Item | Recorded value |
| --- | --- |
| Simulator | Fresh, disposable, named "Curling Storage Test"; iPhone 18 Pro; iOS 27.0 |
| Tooling identified during setup | Xcode 27.0 (build 27A266a) and Device Hub |
| Application | Bundle identifier `local.dev.curlingperformance` — the training app's own identifier |
| Database | `curling-storage-diagnostics-synthetic` only |
| Build | `CURLING_MOBILE_NATIVE_STORAGE=0 npm run mobile:build:diagnostics`, then `npm run ios:sync`, then run from Xcode. Native-storage composition was therefore **off**; only the diagnostics opt-in was on |
| Source identity | The **dirty working tree** at the time. No immutable binary or source fingerprint was recorded, so `HEAD` alone does **not** identify the tested artifact |
| Physical iPhone | **Not used.** It holds real training data and must not receive this build (see "Database isolation is not installation permission" above) |

*Effective settings.* `journal_mode = wal`; `synchronous = 2` (`FULL`: in WAL mode the WAL is
synced at every commit, but it is not the highest value — `EXTRA` exists); `page_size = 4096`;
`sqlite_version = 3.53.4`. Settings query: 118.0 ms. `fullfsync`/`checkpoint_fullfsync` were
**not** read, so whether a sync on Apple platforms also asks the storage device to flush its
own write cache is unrecorded.

*Fixture run* — run id `9efb5d9d-afd8-4b4e-a4ea-5f087068ea21`, completed
`2026-10-15T19:56:46.752Z`:

| Step | Reported result | Time |
| --- | --- | --- |
| Write five fixtures: empty string 0 B; Unicode and SQL-looking text 142 B; small document 4,096 B; medium document 65,536 B; whole-document JSON 924,895 B — **994,669 B total** | All writes acknowledged | 153.0 ms |
| Same-session readback | All five exact; the never-written key genuinely absent | 69.0 ms |
| Separate mutable test key | Write/read, overwrite/read, remove/absence and repeated removal succeeded | 15.0 ms |
| Close, release native handle, open fresh connection, read | All exact | 119.0 ms |
| App process stopped with Xcode **Stop**, relaunched with **Run**; **Verify after app restart** pressed first | Prior session and run recognised; all fixtures exact | 92.0 ms |
| After a later, instructed five-minute idle/background period, process stopped and relaunched again | Exact, same original run | 58.0 ms |

The last row records the procedure followed and the reported result. It is **not** a measured
physical screen-lock test and not a long-term OS-eviction test.

*Checkpoint scenarios.* Each checkpoint is three payload rows of 652 B plus its progress
record, **2,331 B** in total.

| # | Scenario | Reported result | Time |
| --- | --- | --- | --- |
| 1 | Commit | Checkpoint 1, attempt `9326f13a-f4a3-4437-87b2-77bc87510789`; rows and progress exact after a verified close, release and reopen | 51.0 ms |
| 2 | Explicit rollback | Attempted checkpoint 2 not committed; checkpoint 1's progress and rows preserved exactly | 26.0 ms |
| 3 | Deliberate statement failure | Attempted checkpoint 3; the `NOT NULL` violation was reported as a **statement** failure, no COMMIT was attempted, and rollback plus verified reopen preserved checkpoint 1 | 30.0 ms |
| 4 | Lost acknowledgement **after** commit (diagnostic simulation: a real COMMIT, answer deliberately discarded) | Classified **committed** from the reopened store; checkpoint 4, attempt `4a204c81-8c27-43cd-a12a-84678ac9bd3a`, all rows and progress exact | 33.0 ms |
| 5 | Lost acknowledgement **before** commit (diagnostic simulation: no COMMIT issued; transaction discarded by closing the connection and releasing the native handle) | Attempted checkpoint 5 classified **not committed**; checkpoint 4 preserved with unchanged progress and exact rows | 30.0 ms |
| 6 | Read-only inspection | Checkpoint 4 internally consistent | 11.0 ms |
| 7 | Fresh committed baseline for the interruption | Checkpoint 6, attempt `eccbab1b-9ce8-4b07-85e2-a7e18fba1a9d`; all rows and progress exact after a verified reopen | 30.0 ms |
| 8 | Prepare an interruption | An open, acknowledged, **uncommitted** transaction: checkpoint 7, prepared attempt `bce819dc-73ff-48cc-b647-7341d8d1f9d6`, three rows plus progress staged | 17.0 ms |
| 9 | Actual process interruption | The user confirmed Xcode **Stop**, relaunch, then **Inspect stored checkpoint** as the first diagnostic action. Checkpoint 6 and its attempt id survived with every row matching its progress record; prepared checkpoint 7 was **not** adopted; the earlier document session was recognised | 67.0 ms |

The prepare result's screenshot stated that other actions were refused. The conversation did
**not** independently show each refused control being pressed, so the full manual refusal
matrix is **not** recorded as executed.

*Cleanup — every red verification after a deliberate deletion is an expected absence
observation, not a storage malfunction.*

| Step | Reported result | Time |
| --- | --- | --- |
| Checkpoint-only deletion opened | Confirmation named the synthetic database and the four checkpoint keys, and stated that fixtures and run record are kept | — |
| Cancel, then inspect | Checkpoint 6 and its exact rows preserved | 12.0 ms |
| Confirm checkpoint-only deletion | Completed | 16.0 ms |
| Inspect | Progress record and all three rows positively absent | 12.0 ms |
| Fixture readback | Still exact | 44.0 ms |
| Whole-database deletion opened | Confirmation named all synthetic rows, fixtures, run record, mutable key and checkpoint evidence | — |
| Cancel, then fixture verification | All five fixtures preserved. This checks the fixtures only, **not** every other key | 45.0 ms |
| Confirm full synthetic cleanup | Completed | 14.0 ms |
| Fixture readback | All five and the never-written key positively absent; nothing recreated | 34.0 ms |
| Run-record check | "No previous run was found"; nothing recreated | 6.0 ms |
| Checkpoint inspection | Progress record and all three rows positively absent; nothing recreated | 4.0 ms |

No fixtures were written after cleanup.

*What this run establishes, within its class:* on this simulator, through the real plugin, the
diagnostic checkpoint model behaved as §5.1 assumes — a committed checkpoint is read back
whole; rollback, a statement failure and a pre-commit discard leave the previous checkpoint
intact; a discarded acknowledgement of a real commit is still classified committed by reading;
and a process stopped with an open, uncommitted transaction relaunches to the previous
committed checkpoint, without the prepared one. Synthetic deletion asks first, removes exactly
its scope and recreates nothing.

*What it does NOT establish:*

- physical-iPhone transaction acceptance;
- offline behaviour of the transaction scenarios (no offline repeat was performed);
- physical screen-lock behaviour or long-term eviction;
- a naturally occurring native COMMIT failure, a disk-full failure or an I/O failure;
- termination **during** a COMMIT — the measured termination was **before** COMMIT, with a
  transaction open;
- runtime-injected failures of BEGIN acknowledgement, rollback, close or handle release on the
  real engine (those paths are covered by mock evidence only);
- power-loss survival;
- backup/restore behaviour of SQLite or of the Keychain;
- a safe capacity ceiling, an operating envelope or a performance benchmark — single timings
  are observations, not thresholds, and 994,669 B is a measured fixture point, not a limit;
- anything about Android;
- credential migration, provenance recovery, activation, source retirement or production
  readiness.

*Evidence held separately, never substituted:*

| Class | What exists |
| --- | --- |
| Mock / automated | Adapter contract, ownership state machine and checkpoint scenarios against the plugin-faithful engine, including injected BEGIN/rollback/close/release failures |
| Compilation | Unsigned `xcodebuild` with both plugins linked (M3b1 and M3b3 entries) |
| Real engine, simulator — user-reported | **This entry** (2026-10-15) |
| Physical device — user-reported, historical | The 2026-09-30 entry above (pragmas, offline restart recovery, 55 ms verification). Not merged with this run |
| Still missing | Physical-device transaction acceptance; native commit, disk-full and I/O failures; termination during COMMIT; power loss; backup/restore; envelope; Android |

**M3b3 implementation status — 2026-09-30.**

*Implemented:*

- `@aparajita/capacitor-secure-storage` **8.0.1 pinned**, audited from the published tarball
  (not its README) before use: `Package.swift` targets iOS 15, depends on `capacitor-swift-pm`
  `from: "8.0.0"` — satisfied by the root project's `exact: "8.5.2"` pin — plus
  `keychain-swift` 21.0.0. iOS stores Keychain generic passwords; Android stores AES/GCM
  ciphertext in the app-private `WSSecureStorageSharedPreferences` with per-key AES keys in the
  `AndroidKeyStore`. Both match what S2 names. `cap sync ios` integrates it as one of the
  project's Capacitor plugins; its transitive `@capacitor/keyboard` is **not** integrated,
  because the CLI resolves plugins from the app's own manifest only — pinned by a test rather
  than trusted. (`@capacitor/app` is now integrated, but as a **direct** dependency this
  application declares for the assisted capture pilot, not as an inherited transitive one.)
- `src/lib/persistence/secureCredentialStore.ts` (the shared contract and platform-gated
  native store), `capacitorSecureStorageBinding.ts` (the one file naming the package), and
  `src/lib/supabase/providerCredentialStorage.ts` (the SDK-facing integration and the
  application-owned failure channel). **There is no readability marker.** An earlier revision
  of this list named one as implemented; the inference it rested on is withdrawn as invalid
  (§4) and the integration explicitly removed both the marker and the probe that wrote it, so
  no failure path can leave one behind.
- `src/lib/persistence/storageComposition.ts` — the one owned composition; `storageSeams.ts` —
  the three sporting seams plus the **unchanged** Web default;
  `src/lib/identity/identityRepositorySet.ts` — all five identity repositories over one
  adapter; two one-time ownership slots (`claimBrowserAuthStorage`,
  `claimIdentityRepositories`) that reject late and conflicting configuration.
- `src/components/persistence/StorageCompositionGate.tsx` — the readiness gate, wrapping the
  whole provider tree so that "no hydration, no identity startup, no sync initialisation, no
  legacy retirement before readiness" holds because there is no child to do any of them.
- A **separate** off-by-default build flag, `CURLING_MOBILE_NATIVE_STORAGE=1`
  (`mobile/nativeStorageFlag.ts`, `npm run mobile:build:native-storage`). It is a fourth axis:
  not `--mode`, not `NODE_ENV`, and **not** the storage-diagnostics flag — merging those two
  would mean anyone gathering engine evidence had also opted their real training data into a
  different store. There is no URL parameter and no stored preference.
- **Compilation evidence:** unsigned `xcodebuild` for `generic/platform=iOS` **BUILD
  SUCCEEDED**, with `SecureStorage`/`KeychainSwift` and `CapacitorSQLitePlugin` genuinely
  linked and `Security.framework` present. No entitlements file, no `NSFaceIDUsageDescription`,
  no `UIBackgroundModes`, no `CFBundleURLTypes`.

***THE BARRIER: a flag-enabled build cannot cut over, and does not mount.***
`composeNativeStorage` consults a `NativeActivationAuthority` **before** it constructs an
adapter, opens a database or touches the Keychain, and the one production authority reports
`unavailable / migration_not_implemented` unconditionally. So a flag-enabled build shows a
concise blocking preparation state and **the application does not mount at all**. That
ordering is the safety property: mounting an existing installation against a fresh, empty
native store would have every domain read `absent`, write its documented default, and produce
an apparently clean workspace over data that still exists — §5's withdrawn rule W2 exactly.
There is **no force-ready switch, no synthetic activation record, no "fresh install"
assumption and no test-profile bypass**; a ready verdict is constructible only by a factory
named `nativeActivationReadyForTests`, which no production module may reference (asserted) and
which is eliminated from the built artifact (asserted against the real bundle).

*NOT implemented, and not claimed:*

- **Physical-device transaction evidence is still missing** (the transaction scenarios have
  run on a simulator only, M3b1 entry above), so **the engine choice is settled for the
  ADAPTER but source retirement remains unjustified**, and no operating envelope is recorded.
- **No migration in any build.** No application path enumerates, copies, activates or retires
  anything. The §5 protocol is an approved design (2026-10-19); its decision core (M3b4a) is
  approved and a dormant executor (M3b4b) exists that no shipped path invokes; the M3b4c
  recovery interface drives an injected runner and is likewise constructed by no shipped path;
  §7's inventory lists what still blocks M3b4's completion.
- **No cutover.** M3b5 has not happened. Existing installs keep `localStorageAdapter`, and a
  default build contains no composition code at all.
- **No transfer of existing credentials.** Composition points the SDK at the protected store;
  copying the session that is in WebView `localStorage` today, and handling the case where one
  of the two separate stores is written and the other is not, is M3b4 work (§4).
- **No change to cloud synchronisation** and **no background-sync guarantee** of any kind. In
  particular, nothing here makes an upload happen while iOS has suspended or closed the app.
- **No native OAuth or deep-link work** (M2), no BLE integration (M4), no biometric prompt and
  no app-lock feature.
- **Android is designed for, not verified.** No Android project exists (Stage M5).

What the diagnostic panel must actually measure, beyond size: `journal_mode`/`synchronous` behaviour
(<https://sqlite.org/pragma.html#pragma_synchronous>), what the plugin reports on a failed or
**uncertain** commit, **reopen-after-interruption** behaviour, and whole-document
serialization, bridge-payload and memory cost at representative synthetic sizes.

Evidence classes stay separate and are never substituted: **mock** (unit), **engine** (real
plugin, synthetic data, the in-app diagnostic panel), **compilation** (unsigned native build),
**device** (user-reported, physical hardware). **The mock and compilation classes are
satisfied. The engine class is satisfied on a SIMULATOR for the transaction scenarios
(user-reported, 2026-10-15). The device class is PARTIALLY satisfied**: the user has reported
the effective pragmas and a successful offline restart recovery on the iPhone (2026-09-30).
**What is still missing:** physical-device transaction acceptance, a naturally occurring native
commit failure, termination during a commit, power loss and backup/restore — so no operating
envelope is recorded and retirement stays unjustified.

**Two different kinds of readiness, and they must not be conflated.**

| | **Evidence-stage readiness (M3b1)** | **Migration and activation readiness (M3b4/M3b5)** |
| --- | --- | --- |
| What it asserts | The isolated synthetic diagnostic surface is specifiable and may be built | The production migration protocol is safe to implement and then to cut over |
| Depends on the §4 provider-session decision? | **No** | M3b3 did, and it is now SETTLED (S2); M3b5 inherits it |
| Depends on the §5 protocol passing review? | **No** — the diagnostic panel migrates nothing | **Yes** — the design passed review and was approved by the user (2026-10-19); M3b4a and M3b4b have passed implementation review, while M3b4c and the credential stages are still ahead |
| Status today | **Gathered, partially.** Pragmas and restart recovery are user-reported on the iPhone; the transaction scenarios, including reopen after a process stop with a transaction open, are user-reported on a simulator only; physical-device transaction acceptance and native commit failures are not | **NOT ready.** The design is approved; its decision core (M3b4a) and its dormant executor (M3b4b, class-M evidence only) are both approved. U2's first-version policy and UG-1–UG-4 are decided (§6), and its interface (M3b4c) is implemented as a dormant layer awaiting review. The S2 credential requirements, protected-store evidence, the fingerprint algorithm and the remaining device evidence are still open — see the inventory below |
| Production effect | None | M3b5 is the cutover |

**Credential-policy approval was a prerequisite for Stage M3b3 (composition), not for M3b1,
and it is now SATISFIED (S2, 2026-09-30).** Isolated synthetic engine evidence never depended
on it, and gathering that evidence asserts nothing about the migration protocol.

**The production migration protocol's DESIGN was approved by the user on 2026-10-19**, after
Codex's clean independent review (§5, and the approval record below). It is implemented only as
a **dormant executor** (M3b4a and M3b4b both approved) that no application path invokes, with a
dormant, dependency-injected recovery interface (M3b4c, implemented and awaiting review) that no
shipped path constructs; it is **not integrated, not verified on a real engine or device, and not
production-ready**. **The canonical inventory of what still blocks M3b4's
completion and M3b5:**

1. **P-1 — missing pre-activation source marker** (§5.2): **CLOSED at the design level.** K1′
   (E′6) and K2 (E′9–E′11) continue only under their approved guards; every other P-1 state
   blocks.
2. **P-2 — differing provenance ids before activation** (§5.2): **CLOSED at the design level as
   a block in every pre-activation phase** (PV12). Automatic resolution is not approved; the
   foreign marker is never overwritten or adopted. Recovery belongs to item 3.
3. **Blocked-state recovery — FIRST-VERSION POLICY DECIDED AND ADOPTED (U2 and UG-1–UG-4,
   2026-10-20; canonical in §6); interface IMPLEMENTED, DORMANT, AWAITING REVIEW.** What a user
   sees and may do in every blocked, halted and faulted state is decided: four groups, startup
   and explicit rechecking without bypass, honest waiting, no general manual repair, no latch
   clearing, a restricted diagnostic report and a help route. What remains:
   - **M3b4c** implements that policy as a dependency-injected presentation and controller layer
     that no shipped path constructs (stage 9 below; "M3b4c implementation status"). Its
     independent review and the user's approval of it are pending.
   - **Targeted recovery procedures — DEFERRED.** Selecting a contradictory data state,
     acknowledging already-missing data, replacing data, restarting from a fresh enumeration
     and clearing a fault latch each need a separately specified, reviewed and explicitly
     authorised procedure. Until one exists, genuine contradictions stay blocked. The user
     accepted this as an intentional first-version availability limitation (§6.5), so it is not
     a gap in the automatic rules.
   - **The concrete help channel — OPERATIONAL FOLLOW-UP.** No contact channel or handling
     procedure is established, and none is invented. Until one exists, no contact action
     appears (§6.7).
   - **The presentation decisions UG-1–UG-4 (§6.9) — APPROVED BY THE USER (2026-10-20)** and
     adopted before M3b4c was implemented.

Engineering requirements, not design items: protected-store absence-versus-failure evidence
(§4); the two S2 requirements below; the fingerprint algorithm and its availability inside the
WebView (I-7); and the remaining engine, restore-pairing and physical-device evidence (M3b1
entries above; R2, R65, R66). Other documents reference this inventory rather than
restating it. The two items below are **explicit migration-stage requirements** that Stage
M3b3 established and did not perform.

*Named migration requirements arising from the S2 credential decision (§4), due in M3b4:*

- **Secure credential transfer.** The provider session of an already-installed app is in
  WebView `localStorage`. Composition points the SDK at the protected store and copies
  nothing, so the existing session must be transferred as part of the migration — under a
  protocol of its own, because credentials are not domain bytes and the copy has different
  confidentiality and deletion semantics from a sporting key (§1).
- **Cross-store interruption.** The credential store and the SQLite target are **two stores
  and not one transaction**. A state where one has been written and the other has not is
  reachable, is not detectable from either side alone, and must be handled explicitly rather
  than assumed away. S1 would not have removed this class either — only given both halves the
  same lifecycle (§4).

Plus one genuinely **open product question**, deliberately not settled by Stage M3b3 and due
with the cutover (M3b5):

- **What a mounted application should do about a credential failure that happens
  MID-SESSION.** Composition already refuses to become ready over an unusable credential
  store, so nothing starts from a broken one, and the failure verdict is sticky and readable
  (`OwnedStorageComposition.credentialFailure()`). What is not decided is the behaviour: a
  sticky historical latch should probably not blank a working workspace, and silently ignoring
  it would be dishonest. Nothing is implemented in either direction, and no code guesses.

**P-1/P-2 provenance resolution — approval record. APPROVED BY THE USER (2026-10-19) after
Codex's clean independent review.** This record approves the design; its implementation status
is the M3b4a and M3b4b entries below. The design was drafted from 2026-10-16
and revised through three review rounds on 2026-10-19. The user then approved it, including the
RQ-1 resolution through I-13. **The approved rules are now canonical in
§§5.1–5.7** (invariants I-1–I-13, record shapes, the provenance table, L0, A′1–A′7, Group E′,
the action plans and the recovery tables) and in the acceptance cases below (R1–R77). This
record keeps only the decision, its rationale and the remaining stages. **The approval covers
the reviewed design. It does not authorise runtime implementation, M3b4a, production
activation, source deletion or device installation.** M3b4a was authorised separately
afterwards (see "M3b4a implementation status" below); nothing later is authorised.

*1. The ambiguity that was resolved.* At the first enumeration one `installationStoreId` is
written into the target activation record and into a source marker key. The two writes go to
different stores and are not atomic, and a resolved `localStorage` write is not a durable-write
acknowledgement (§2). **P-1:** a pre-`active` record with no source marker is identical whether
the marker write never landed or the source was later cleared — the histories are H1 marker
write never landed or never persisted; H2 marker landed, source later cleared in whole or part;
H3 marker key alone removed; H4 source replaced by other content without a marker; H5 target
restored or rolled back to an earlier pre-`active` state after the attempt had progressed
further. **P-2:** a pre-`active` record and a marker carrying different ids. Indistinguishable
histories are harmful only when they call for **different** actions, so the resolution adds
evidence (K4, K6) and acts only where the durable evidence shows that every history consistent
with it permits the same lossless action (§5.4a).

*2. Outcome per candidate.* "Lossless" is U1's test: no existing application data on the device
is discarded or overwritten. A lossless candidate that lets an incomplete or contradictory state
look ordinary still fails U1.

| Candidate | Outcome | Basis |
| --- | --- | --- |
| K0 — keep the block | **Retained as the fallback** for every state §5 does not positively resolve | Safe; what the user sees is U2's first-version policy (§6) |
| K1 — as first briefed: abandon and re-enumerate in `enumerating` under a new `installationStoreId` | **Not adopted** | Lossless but not complete: without a record of the keys that existed when D3 began, re-enumeration silently omits keys that vanished — including the whole source, which would then present an empty workspace as complete. A new id gains nothing and, for P-2, overwrites the foreign marker |
| **K1′** — the same-id, in-place replacement, gated on `entryKeys` and on no target row | **Approved** (E′5/E′6, AP-K1′) together with K4 and K6 | Nothing is staged; the only data on the device is the current source, which holds every key the attempt began with |
| **K2** — P-1 in `copying`/`verified`: re-write the marker under the existing id only after every A′, E′1–E′8 and §5.5 check passes | **Approved** (E′9–E′11) | Staged rows and source are proven to be the enumerated generation; only uncopied manifest keys are written, each verified at copy time; K2's safety never depends on the marker being present |
| K3 — a target-side journal around the marker write | **Not adopted** | A `localStorage` acknowledgement is not durability; it enables no different action |
| **K4** — record-first order | **Approved as a design rule** (I-4); replaces the earlier "adopt the marker" row with PV5 | Not evidence about history; it makes the ordinary interruption land on P-1 `enumerating`, so a marker without a record can only follow the loss of a committed record |
| K5 — content-derived store identity | **Not adopted** | Changes what `storeIdentity` means and cannot exist when D3 begins; K2 obtains the effect |
| **K6** — `entryKeys` recorded when D3 begins | **Approved** (I-5, E′5, A′5) | The missing evidence that makes K1′ meet U1's "incomplete states remain blocked" |
| **L1** — P-2 stays blocked until restore pairing is measured | **Approved, extended:** P-2 blocks in **every** pre-activation phase (PV12) | Restore-pairing evidence can show which histories are reachable; it cannot by itself authorise overwriting a foreign marker |
| L2 — replace the foreign marker under K2's conditions | **Not adopted** | Outside U1; a variant that leaves the marker untouched still continues through a contradictory state |
| **RQ-1** — a warm "matches neither" | **Resolved by I-13** | Known contrary evidence is decision input: migration stops, and a target-only latch carries the stop across relaunch |

*3. P-1 is not P-2 — why the argument does not transfer.* P-1 is the **absence** of a marker.
Absence is not evidence of any particular history, and every history that produces it leaves on
the device exactly the data the checks inspect: the committed record, the staged rows and the
current source. K1′ and K2 act only where those checks prove that nothing would be discarded or
overwritten and that no key recorded at D3 entry or in the manifest has vanished.

P-2 is a **present, valid, different** id: positive evidence that the source was paired with an
attempt whose record is not in this target. Its histories include a target rolled back or lost
after that other attempt progressed — possibly to `active` and partial retirement, so that the
current source is stale or partially retired and the real authority is gone from the device —
and containers restored from different times. **Replacing the marker destroys the only
surviving evidence of the other attempt**, which U2's interface would need in order to explain
the state, and turns a contradictory state into an ordinary-looking one. Adopting the foreign
id into the target instead destroys the target's own record, with the same effect. Content
validation cannot substitute: in `enumerating` there is no manifest, and in
`copying`/`verified` a passing validation shows only that the current source equals **this**
target's manifest, not what the other attempt did.

*4. User-owned product decisions* — a product policy does not establish the safety of a
technical candidate:

- **U1 — DECIDED BY THE USER (2026-10-19): automatically continue proven lossless cases.**
  After an interruption, migration may continue without user confirmation only where the
  reviewed specification establishes that no existing application data is discarded or
  overwritten. Contradictory or incomplete states remain blocked. This approves the product
  policy, **not K1/K2 or any other candidate as a whole**: each proposed transition still
  needs its own evidence, interruption analysis and independent review. In particular, it
  does not authorise overwriting a foreign provenance marker or accepting source-generation
  divergence, and it does not approve implementation or production cutover.
- **U2 — FIRST-VERSION POLICY DECIDED BY THE USER (2026-10-20); canonical in §6.** The user
  confirmed seven recommendations after approving M3b4b. They cover:
  1. user-visible groups with approved wording (§6.2; originally three, extended to four by
     UG-1/UG-2);
  2. automatic startup checks and an explicit „Erneut prüfen" that continues under U1 only
     when every approved guard passes (§6.3);
  3. an honest waiting state that never releases an unanswered operation (§6.4);
  4. no general manual repair, with genuine contradictions blocked until a targeted recovery
     exists (§6.5);
  5. no general or automatic latch clearing (§6.5);
  6. an explicitly requested, data-minimised diagnostic report that is never transmitted
     automatically (§6.6);
  7. a help route with an understandable error code, and no contact action until a real
     channel exists (§6.7).

  The specific-outcome rules are in §6.8's matrix. **This decided the policy only.** Codex's
  independent review of its documentation adoption was clean, and the user approved the
  adoption on 2026-10-20. It authorises no latch-clearing or data-repair action and does not
  change U1. Targeted recovery procedures and the concrete help channel stay deferred
  (inventory item 3).
- **UG-1–UG-4 — APPROVED BY THE USER (2026-10-20); canonical in §6.9.** A3/A4 and internal-check
  failures form the neutral group G4 without a recheck; the interface stays English with
  faithful translations; already-known retirement findings are subordinate and nonblocking.
  At the same time the user **authorised the implementation of M3b4c** — a bounded stage that
  does not authorise production migration, native-storage activation, credential work, source
  retirement, device installation or any Git mutation.
- **Technical approval — GIVEN BY THE USER (2026-10-19)** after Codex's clean independent
  review: the reviewed transitions, each with the evidence, interruption analysis and review U1
  requires — K1′, K2 under their guards, record-first establishment, `entryKeys`, durable-state
  recovery and the I-13 fault latch, with P-2 blocked in every pre-activation phase. It does
  not approve implementation or production cutover.
- **Mid-session credential-failure behaviour — BOUNDED POLICY DECIDED BY THE USER
  (2026-10-21), option A; runtime integration and remaining fault mapping NOT approved.**
  The inactive pure S1 reducer contract is technically adopted in the appendix
  “Adopted inactive pure contracts — S1 and S2”; this does not approve S5 integration.
  If secure
  credential storage fails during an already-admitted, ongoing training while sporting
  persistence remains healthy, local recording and saving may continue in that same already
  admitted Profile. Cloud synchronisation and new sign-in operations pause, and the user must
  see a clear warning. This does not permit a Profile/account switch, grant new identity
  access, bypass an explicit access revocation, or bypass the normal storage/identity checks
  on the next application start. It does not turn a sporting-store failure into a successful
  save, accept a credential read error as absence, or authorise credential deletion or source
  fallback. The exact Read/Write/Remove and SDK-event mapping, in-flight cloud requests,
  recovery/resumption conditions, non-training contexts and interruption tests still need a
  bounded technical specification and independent review; no new offline expiry is implied.
  **Clarification decided by the user (2026-10-25):** additional Exercises and training
  Blocks may start inside the SAME already-started Training Session after that fault.
  A new Training Session remains blocked. Q1 work lifetime is the original Session,
  not each contained Block/Exercise; actual private pre-fault admission/context/save
  evidence is still required. This does not authorize other Profile/domain access.
  The canonical bounded runtime scope remains BETA_COMPLETION_SPECIFICATION.md §S5i.
  This is a product decision only, not implementation, storage activation, installation or
  release permission. No migration transition depends on it; verified runtime handling
  remains a cutover prerequisite.
- **Q2 — contradictory restore / missing or foreign credential pairing: FIRST-BETA POLICY
  DECIDED BY THE USER (2026-10-21).** Preserve all existing data, keep access blocked and
  display understandable help. Do not automatically adopt, delete, repair or establish a new
  pairing. No additional self-service targeted recovery procedure is included in this first
  beta scope; a future one needs separate specification, ownership checks, approval and
  review. Normal reauthentication where the session item is positively absent and the
  installation pairing is intact remains unchanged. An imported trusted-device record is
  not permission to access another installation's Profile data. The installation transfer's
  fresh authentication/Profile mapping still needs its own technical design and evidence;
  this policy does not authorise an importer to erase source deny evidence or grant access.
  This is a product-policy decision only, not implementation, source cleanup, storage
  activation, device installation or release approval. Q4 restore-residual acceptance
  remains unresolved; Q3 is recorded immediately below.
- **Q3 — old credential copy: DECIDED BY THE USER (2026-10-24).** Automatically remove
  the old credential copy only after fully verified transfer to protected storage;
  failed/incomplete transfer or verification issues no source removal. Training data
  is outside this decision. The interruption/source-change safeguards and remaining
  gates are canonical in `BETA_COMPLETION_SPECIFICATION.md`, “Credential source
  retention”. No retirement code, native activation or installation is approved by
  documentation adoption alone; the current local implementation mandate permits
  bounded development/testing, not device cutover. Q4 remains separate.

**What U2 decided, and what it deferred.** §5 specifies *when* a state blocks, *when* an action
halts, when a fault is detected, and *what evidence is preserved and reported*. §6 now specifies
what a user sees and may do in each of those states. That covers every state the approved design
blocks: P-2 in any phase, a marker without a record, vanished `entryKeys`, unreadable or
malformed markers, records failing the phase-shape predicates, target rows outside the manifest,
source-generation divergence and a detected fault. The first version offers a recheck where a
recheck may resolve the state, and nothing else. It does not offer accepting a staged copy,
restarting from a fresh enumeration, acknowledging data that is already gone or clearing a
latch. Whether, by whom and after what inspection those may ever happen is left to a
**separately specified targeted recovery procedure** (§6.5). None is specified or authorised
today.

*5. Remaining bounded stages and review gates.* Approval closes stage 1's design gate only.

| # | Stage | Prerequisites | Gate |
| --- | --- | --- | --- |
| 1 | Design review, technical approval and documentation adoption | — | **Complete.** Design review clean and technical approval given by the user (2026-10-19); the adoption was performed and Codex's independent review of it found no blocking defect |
| 2 | First-version blocked/halted-state recovery policy and outcome/action matrix (open item 3) — **complete: U2 decided by the user (2026-10-20); its adoption in §6 reviewed clean by Codex and approved by the user (2026-10-20); UG-1–UG-4 approved (2026-10-20)** | U2 decided by the user (satisfied) | Independent review; covers every blocked row of §§5.2–5.4, every halt of §5.4a, I-13's faults and the runner's lifecycle outcomes. Latch clearing and divergence resolution are deferred to separately specified targeted recovery procedures, which are not a numbered stage here (§6.5) |
| 3 | Restore-pairing and marker-persistence evidence (L1; cases R2 and R66) | A disposable device and the user's authorisation to install on it | User-reported device evidence on the selected configuration |
| 4 | Physical-device transaction evidence (M3b1's outstanding items; R65) | As 3 | User-reported device evidence |
| 5 | Protected-store absence-versus-failure evidence (§4) | An audited dependency or upstream capability; forks and custom cryptography stay prohibited | Source audit; a user decision if no such dependency exists |
| 6 | Credential transfer and cross-store recovery specification | 5 | Design review; keeps the identity gate as the only authority |
| 7 | **M3b4a — the pure migration decision function** — **complete**: implemented, independently reviewed (clean) and approved by the user (2026-10-20) | Stage 1 complete (satisfied), and the user's separate authorisation (given) | L tests for every row of §§5.2–5.4, every plan's halt outcome, both columns of §5.4a's recovery tables warm and cold, and L0/I-13's latch outcomes — i.e. every R-case in class L; independent review |
| 8 | M3b4b — source and target enumeration, transactions, durable-state recovery and marker I/O, behind the flag; production authority unchanged — **complete: implemented, independently reviewed (clean) and approved by the user (2026-10-20); dormant, class-M evidence only** | 7 | M tests; independent review |
| 9 | M3b4c — the blocked- and halted-state recovery interface implementing §6 — **implemented and locally verified, dormant; awaiting Codex's independent review and the user's approval** ("M3b4c implementation status") | 2 (satisfied), 8 (satisfied), UG-1–UG-4 approved (satisfied), and the user's separate authorisation (given 2026-10-20) | §6.10's acceptance requirements U2-1–U2-17; UX and independent review |
| 10 | Credential transfer implementation | 6, 8 | Independent review |
| 11 | Simulator rehearsal of the complete migration with synthetic data | 8–10 | S evidence |
| 12 | Physical-device migration acceptance on a disposable device, **before** cutover | 3, 4, 11 | D evidence, user-reported |
| 13 | M3b5 production cutover | All of the above; the mid-session credential-failure decision | The user's approval |

**Stage ordering against the stage table above.** Physical-device migration acceptance (stage
12) precedes production cutover (stage 13), as the P6 decision (§4's P6 row) and item 3 of
ADR-0049's 2026-09-30 preservation amendment require. The stage table records the same order:
M3b6's acceptance is a prerequisite of M3b5, not a consequence of it.

**M3b4a implementation status — IMPLEMENTED, INDEPENDENTLY REVIEWED (CLEAN) AND APPROVED BY THE
USER ON 2026-10-20. This is the canonical statement; other documents reference it.** The user
authorised this stage separately, after Codex's clean review of the adoption. Codex's earlier
reviews found blocking defects, each corrected within the stage's scope and pinned by
`nativeMigrationReviewRegressions.test.ts`, `nativeMigrationWarmPrecedence.test.ts` and
`nativeMigrationWarmExclusion.test.ts`; **Codex's final independent review of the complete
corrected working tree found no remaining blocking defect, and the user approved M3b4a on
2026-10-20.** The four modules below are the approved decision core; M3b4b builds on them
without changing them.

*Implemented* — four pure modules under `src/lib/persistence/`, imported only by the three M3b4b
modules below:

- `nativeMigrationEligibility.ts` — §1's classification by key shape. It reuses the identity
  keys declared in pure modules and the audited `isResolutionStorageKey`, and restates the
  sporting allow-list, the pending-intent keys and the legacy marker, whose declaring modules
  construct storage-backed repositories; a test pins every restated literal to its declaration.
- `nativeMigrationRecord.ts` — activation-record parsing, Groups A2–A6 and A′1–A′7, the
  canonical record byte form, and the exact after-state of every approved transition.
- `nativeMigrationDecision.ts` — the typed evidence contract and one synchronous, side-effect-free
  function: L0 → A → A′ → B → C → provenance table → E′, returning a blocked decision with every
  applicable finding, a symbolic plan (D1, AP-D3, AP-K1′, AP-COPY, AP-CC, AP-ACT), the B4 access
  disposition with B2/B3 retirement kept separate, or the I-13 fault stop with its bounded
  latch plan. A surviving process's I-11 comparison — exact record bytes, and every issued
  row's exact bytes against that row's observed bytes — is decision input; a cold start needs
  no plan memory and compares no historical row bytes.
- `nativeMigrationPlanOutcome.ts` — I-9's halt report, with one disposition for EVERY step
  (confirmed, succeeded, passed, failed, outcome unknown, aborted before write, not issued), and
  the latch-attempt reducer.

*Implementation choices M3b4b must honour* — none changes an approved rule: the reserved names
of the source marker, activation record and fault latch; D1's `sourceRetirement` is `complete`;
the canonical record byte form (fixed field order, sorted lists, manifest as key/fingerprint
pairs) that I-11's byte comparison relies on; fingerprints are computed by the caller and
checked by an injected format predicate, an unobtainable one blocking under I-1 and a malformed
one under I-7 (the algorithm stays open); AP-COPY plans one non-empty batch per evaluation, and
both the batch size and the latch-write attempt bound are explicit engineering parameters, not
product policy; every plan ends in re-evaluation of fresh evidence; an omitted observation is
`evidence_required` and a malformed snapshot `invalid_evidence`, neither of which permits
anything; `retryMayResolve` marks read and health failures only and is not a UX policy. **From
the corrections:** a warm evaluation compares the exact bytes of every issued row it was given
(`targetRowValues`), and examines every supplied, successful observation for a POSITIVE
contradiction first. Each observation excludes the candidate outcomes it contradicts on its
own, independently of whether the record was readable: observed record bytes (or a positively
absent record) exclude each issued state whose record they are not; an inserted row's exact
bytes exclude the before-state when present and the after-state when absent or different; and
a successful complete target listing (I-2) does the same by key presence or absence alone,
without row values. When both candidates are excluded the fault is detected — with the record
unobserved or unreadable too — and the same evidence proves a confirmed step contradicted (a
record other than the last confirmed one, or a confirmed row positively absent, by value or by
the listing, or different). Exact bytes are required only where an after-state's values must
be established: a before-state whose inserted keys the listing shows absent needs no row
value. Unobserved and failed observations exclude nothing. Only when no fault is
provable does incompleteness count, and then only if no durable stop already decides: an L0
stop, or any other blocking row, governs with unreadable warm rows reported alongside it; where
the table would otherwise permit, an unreadable issued row blocks under I-1 and an omitted one
is requested as `evidence_required`. An omitted observation is never absence or equality, and a
failed read is never a fault; a checkpoint inserts exactly the bytes its own read step
obtained and checked (`rowBytesFromStep`), and the entry-key recheck takes a FRESH source
enumeration; any supplied current target failure — a failing summary, a failed row enumeration
or a failed row read — is B1 on an `active` record; a latch carries each record only as its
canonical, re-validated metadata or as an explicit "omitted, invalid metadata" marker with rule
identifiers, never raw bytes or row values (so a valid but non-canonical observed record appears
in canonical form, not byte-for-byte — the no-values requirement prevails); finding details
carry eligible key names only, and invalid-snapshot problems are fixed codes that never echo
a field name or value; and `activatedAt` must be a strict UTC ISO-8601 timestamp.

*Tests* — `src/lib/persistence/__tests__/nativeMigrationDecision.test.ts`,
`nativeMigrationRecovery.test.ts`, `nativeMigrationEligibility.test.ts`,
`nativeMigrationReviewRegressions.test.ts`, `nativeMigrationWarmPrecedence.test.ts`,
`nativeMigrationWarmExclusion.test.ts` (an exhaustive record × row × row × listing matrix for a
two-row checkpoint, checked against a possible-worlds oracle written from I-11's before- and
after-state definitions) and `nativeMigrationCoverage.test.ts`, with the
synthetic kit `nativeMigrationTestKit.ts`. Each
class-L case is an `rcase("Rn", …)` test; the coverage test reads the R-table in this document
and fails if a class-L case is uncovered or if R2, R65 or R66 is claimed — a label check only;
the behaviour is established by each case's own assertions.
`architectureBoundary.test.ts` asserts that no shipped module under `src/` or `mobile/src/`
imports the layer, that it imports only the UUID predicate, four pure identity modules and
itself, and that it references no storage, plugin, network, timer, randomness or environment.
The fingerprints in these tests are labelled synthetic values, not cryptographic or platform
evidence.

*What it does NOT establish:* native transaction atomicity, stable-storage durability, marker
persistence, restore pairing, or any engine or device behaviour — these tests are class L only.
R2, R65 and R66 remain simulator/device obligations; R60 stays a stated residual. These four
modules perform no I/O themselves; the executor is M3b4b's (below).

**M3b4b implementation status — IMPLEMENTED, INDEPENDENTLY REVIEWED (CLEAN) AND APPROVED BY THE
USER ON 2026-10-20; DORMANT, CLASS-M EVIDENCE ONLY. This is the canonical statement; other
documents reference it.** The user authorised M3b4b on 2026-10-20, after approving M3b4a.
Codex's earlier reviews found blocking defects, each corrected within the stage's scope:
- database ownership and the fault stop were local to one factory instance;
- an opening ordinary operation could still write while engine resolution was pending;
- disposal was not honoured inside asynchronous and composite operations;
- a lifecycle check made inside a nested helper was relied on after the caller resumed;
- a marker that became foreign after the decision was overwritten;
- recovery after a halt could re-read through the old connection;
- R57's assertions ran inside a bridge callback whose failures the adapter absorbs.

They are pinned by `nativeMigrationReviewCorrections.test.ts`,
`nativeMigrationOwnershipCancellation.test.ts` and R57's negative control. **Codex's final
independent review of the complete working tree found no remaining blocking defect, and the
user approved M3b4b on 2026-10-20.** Approval does not change its scope. It is
**dormant**: an explicitly invoked implementation that no application startup path,
composition, component or repository calls, and that cannot yield a `NativeActivationVerdict`.
`PRODUCTION_ACTIVATION_AUTHORITY` still reports `unavailable` unconditionally.

*Implemented* — the approved M3b4a core is used unchanged:

- `localStorageAdapter.ts` — §3's `EnumerableStorageSource` and a migration-only source
  capability, outside `StorageAdapter`/`RemovableStorageAdapter`. Enumeration takes two
  `length`/`key(i)` passes and reports any throw, `null`, duplicate or difference between the
  passes as `read_failed`, never as a smaller key set. A value is read only if the caller's
  policy admits its key, so excluded keys — provider credentials, the diagram cache — are
  listed by name and never read. The marker is the only writable key, and only through
  `writeMarkerIfAbsent`: the current marker is read and, in the same synchronous turn, written
  only if positively absent — an equal marker is `already_matching`, a foreign or malformed one
  and an unreadable one are refused without writing (PV10–PV12 are never pre-empted). That is
  a same-turn check in one JavaScript context, not a compare-and-swap; another process or build
  writing the same store remains the writer-exclusion residual (§5.5). Failures carry fixed
  messages; ordinary `get`/`set`/`remove` are unchanged.
- `nativeSqliteAdapter.ts` — a migration-only target capability (`createNativeMigrationSqliteStore`)
  that shares the native store's one queue and connection. **Ownership is per database within
  the live JavaScript context**, across every factory call and engine wrapper naming it: the
  migration lease is registered for the database, every other store instance refuses ordinary,
  diagnostics, lifecycle and migration work on it while the lease exists, and a lease is granted
  only when no other instance may still hold a native handle to it (open, opening, or closed
  without a confirmed release). An opening instance reserves the database in the same
  synchronous turn as its ownership check, BEFORE the first asynchronous boundary — engine
  resolution included — so a concurrent acquisition and an opening ordinary operation never
  both proceed, in either order. A failed open's reservation is kept unless its native-handle
  release is confirmed; a later `close()` attempts that release. Leases are compared by identity, so a stale lease — or a forged
  one with an equal id — resolves nothing. There is no reset, force-unlock or fault-clearing
  entry point; only the holder's completed release frees the database, and only a new execution
  context starts without the registry. Reads are strict:
  a malformed envelope, row, column or duplicate is `read_failed`, never absence. Named
  transactions only — create the record, replace it in place (`UPDATE`), a checkpoint, the
  latch — each one queued task: BEGIN, the expected record re-read inside it, the writes with
  the per-statement flag off and each acknowledged as exactly one changed row, then COMMIT.
  Rows are inserted without a conflict clause, so a staged row is never overwritten. The
  caller's lifecycle travels into every composite operation — the reserved and value reads,
  the key listing, connection opening, reopening and the transaction — and is checked at
  issuance, immediately before each further query, opening or setup command, BEGIN,
  statement and COMMIT, as well as after every await. A check made inside a nested helper is
  never relied on once its caller resumes: the caller checks again before its next call. A stopped read reports `cancelled`, never absence; a stopped opening cleans up the
  half-opened connection; a transaction stopped before COMMIT is rolled back (`cancelled`, and
  no BEGIN at all if it stopped while opening); a COMMIT already issued is awaited and its real
  outcome reported. `release` is accepted in `requires_reopen`: a positively established close
  and native-handle release end any native transaction, so no fresh open is needed. From
  BEGIN until an acknowledged COMMIT or ROLLBACK the lease `requires_reopen`; no ROLLBACK is
  issued after an unacknowledged COMMIT, because the Android plugin acknowledges a ROLLBACK with
  no active transaction. Only a close, an explicit native-handle release and a fresh open —
  each positively established — clear it. The reserved key names are supplied by the caller.
- `nativeMigrationBindings.ts` — binds the source to the approved eligibility test and marker
  key, the target (by dynamic import) to the reserved record and latch keys, and supplies
  platform UUIDs and timestamps that throw rather than fall back. **It binds no fingerprint.**
- `nativeMigrationEvidence.ts` — collects one snapshot for `decideNativeMigration`. Target rows
  are always listed (also B1's health probe) and digested only for `copying`/`verified`; the
  source and the marker are read only with no latch and an absent or valid pre-`active` record;
  eligible source values are digested on every pre-activation continuation, `verified`
  included. Exact row bytes for I-11 are read independently of the record's readability. The
  caller's lifecycle is checked before issuing and after completing every read and digest; a cancelled collection yields no
  snapshot and no decision.
- `nativeMigrationRunner.ts` — the runner. `decideNativeMigration` is its only decision
  authority: it executes exactly the selected plan (D1, AP-D3, AP-K1′, AP-COPY, AP-CC, AP-ACT,
  AP-LATCH), honours every read, recheck, `fresh_source_enumeration` and `rowBytesFromStep`, and
  re-evaluates from fresh evidence after each completed plan. It keeps I-11's plan memory (exact
  issued record and row bytes, confirmed rows, the last confirmed record) for its lifetime.
  **After ANY halt** — a marker write, a refused marker precondition, a read, a recheck, a
  preparation failure or a target transaction — the next explicit `run()` first closes the
  target, releases its native handle and opens it fresh, each step established separately;
  a failure at any of them reports its boundary and reads no evidence (I-9, I-10). It holds
  I-13's in-process stop with the bounded latch write as the only later write, and reports
  fixed codes and key names only. A refused marker precondition is a step never issued, distinct
  from an issued write whose outcome is unknown; so are preparation failures (an id, a
  timestamp, a checked read). Concurrent `run()` calls join one execution. Disposal is checked
  after every asynchronous boundary: a disposed run issues nothing new and never reports
  access, while a positively established fault is retained. `dispose()` waits for an in-flight
  call to answer and keeps the lease — `fault_stop_held` after a detected fault, and
  `plan_evidence_held` while plan memory holds an unresolved unknown outcome or writes no
  completed evaluation has checked — because releasing would let another runner in the same
  context evaluate cold in its place. Otherwise it releases by close and explicit release
  only, issuing no fresh open or other new work. The AP-CC/AP-ACT verifier invokes no further
  fingerprint once disposed, so a digest that never answers cannot keep disposal from settling;
  the evidence collector likewise stops between digests, and the plan's source reads check
  before every value read. Plan
  progression per `run()` and latch attempts are explicit engineering bounds; reaching the
  first is `bound_reached`, never success.

*Implementation choices, reviewed with the stage* — none changes an approved rule:

- An issued target transaction that did not commit is `outcome_unknown` in the I-9 halt report,
  except an AP-CC/AP-ACT abort before any write (`aborted_before_write`). Its issued bytes stay
  in plan memory, so a precondition failure caused by a target changed underneath the plan is
  classified by I-11's comparison like any other unknown outcome.
- A latch found already present inside the latch transaction counts as a confirmed attempt and
  is reported as `already_present`.
- At B4 the runner retires its plan memory: after activation the migration metadata is
  historical (§5.4), so legitimate post-activation changes can never contradict it.
- After a non-fault decision that positively shows an issued before- or after-state, the runner
  records which one in its memory; every decision still comes from `decideNativeMigration`.
- A disposal that interrupts the evaluation which would have proven a fault ends the run without
  a decision; the unresolved warm evidence then keeps the lease (`plan_evidence_held`). A fault
  established before disposal took effect keeps its stop; a latch transaction stopped before
  COMMIT is rolled back and is not counted as an attempt.

*Tests* — `nativeMigrationSourceCapability.test.ts`, `nativeMigrationTargetCapability.test.ts`,
`nativeMigrationExecution.test.ts`, `nativeMigrationWarmIO.test.ts`,
`nativeMigrationRunnerLifecycle.test.ts`, `nativeMigrationReviewCorrections.test.ts`,
`nativeMigrationOwnershipCancellation.test.ts` and `nativeMigrationMCoverage.test.ts`, with the
harness `nativeMigrationMTestKit.ts`. Observations made inside bridge callbacks are recorded
and asserted afterwards — the adapter absorbs anything thrown there — and R57 carries a
negative control proving a violated preservation invariant fails it. A "new
process" in these tests is a new execution context (a fresh module registry); another binding in
the same context is a competitor that must be refused, not a restart. They drive the real modules over
`pluginFaithfulSqliteEngine` on both platforms and a disposable synthetic WebView store; the
class-L mechanical executor is not used. `nativeMigrationMCoverage.test.ts` reads this document's
R-table and fails unless every class-M case has an `mcase` test and no other case claims one.
The warm counterexamples and a record × row × read-failure × listing matrix are also exercised
through the I/O layer. The engine gained the new statements (plain-`INSERT` conflicts, `UPDATE`,
the key listing, `run`'s change count), explicit fault hooks, an ordered trace of lifecycle
events and statements, awaited gates for deterministic cancellation, and Android's acknowledged
ROLLBACK without a transaction — an opt-in every M3b4b test uses; the default stays as before
for the existing diagnostics tests.

*What it does NOT establish:* class M models the approved atomicity assumption on a mocked
engine. It proves no real SQLite durability, marker persistence (R2), survival of termination
during COMMIT or power loss (R65), or restore pairing (R66); R60 stays a stated residual. Whether
the real bridge carries a value containing a NUL character or an unpaired UTF-16 surrogate
byte-for-byte is unmeasured (iOS reads `TEXT` as a C string). Whether such a transformation
would be detected depends on that bridge behaviour and on a fingerprint binding that is not yet
selected, so this stage claims no detection for it; the source is never retired, so nothing is
removed from it. **The fingerprint algorithm and its WebView availability
remain open (I-7):** the executor requires an injected digest and a standard collision-resistant
platform binding is required before any activation. M3b4b itself has no recovery interface (that
is M3b4c, below), no latch clearing, no credential work, no source retirement and no activation
verdict, and nothing has run on a simulator or a device.

**M3b4c implementation status — 2026-10-20. IMPLEMENTED AND LOCALLY VERIFIED; DORMANT;
AWAITING CODEX'S INDEPENDENT REVIEW AND THE USER'S APPROVAL. This is the canonical statement;
other documents reference it.** The user authorised M3b4c on 2026-10-20, together with
approving UG-1–UG-4 (§6.9), after approving the U2 documentation adoption that Codex had
reviewed clean. Codex's first independent review of M3b4c was not clean. It reproduced five
defects: session disposal reached the runner one microtask late; a disposed session kept its
last snapshot; the view's report and waiting state were not scoped to the session; a failed
recheck erased an unresolved step outcome from diagnostics; and result processing could leave
an unhandled rejection. They are corrected as described below and pinned by
`nativeMigrationSessionCorrections.test.ts` and the view's "review corrections" tests. Whether
the corrections are clean is for the next independent review. It implements §6's first-version policy as a presentation and controller layer
over the approved M3b4b runner. **It is dormant:** no shipped startup path, composition or
component constructs a runner, a session or the recovery view. The production activation
authority still reports `unavailable / migration_not_implemented` unconditionally, so no user
sees this interface in any build.

*Implemented:*

- `src/lib/persistence/nativeMigrationPresentation.ts` — a pure classification of every
  `NativeMigrationRunReport` into §6.2's four groups, one fixed explanation, the permitted
  action (a recheck for G2 only), fixed technical codes, the validated phase and step
  dispositions. It follows §6.2's precedence G3 > G4 > G2 over every finding and never consults
  `retryMayResolve`. The decision rules, reason codes and halt observations are classified by
  tables the compiler checks for exhaustiveness. An unrecognised rule, code, outcome or a
  throwing report is G4 "internal check". It also builds the §6.6 diagnostic report as a
  dedicated allowlisted projection: application version, fixed codes, a phase only from the
  validated record of that outcome, and step outcomes. It never includes a finding's `detail`,
  a key name, a value, a record, marker or latch byte, a fingerprint, an identifier or
  exception text. It imports the core and the executor through erased `import type` only.
- `src/lib/persistence/nativeMigrationSession.ts` — the controller. It receives an
  already-constructed runner by dependency injection and becomes its only owner:
  - `start()` evaluates once and is idempotent across Strict Mode replays and re-renders;
  - `recheck()` runs again only from a settled G2 presentation, on the same runner, and is
    refused while a run is in flight;
  - concurrent invocations join one execution, there is no automatic retry loop, and a settled
    `bound_reached` stays G2;
  - `subscribe()` is observation only — unsubscribing never disposes, and a throwing observer
    alters nothing;
  - `dispose()` is the storage owner's single, idempotent disposal. It calls the runner's
    `dispose()` in the same synchronous turn, so no already-queued continuation can issue
    further opening, setup, read, write or digest work in between. The shared promise exists
    before that call, so a reentrant caller joins it. A throwing, rejecting or malformed runner
    disposal is reported as ownership not freed. The runner's approved cleanup — awaiting issued
    work, ROLLBACK before COMMIT, no ROLLBACK after an issued COMMIT, keeping the lease for plan
    evidence, a fault stop or uncertain cleanup — is unchanged;
  - an observer of the running state that disposes the session prevents the run from starting;
  - disposal is terminal and observable: the snapshot becomes `disposed` with the `ended`
    presentation (never idle, running, retryable or accessible), current observers are told
    once, and a later observer sees the same. After that nothing is published — no late
    progress, outcome, access or handover result;
  - the whole result-processing path is protected. A throwing report property, a malformed
    plan list, a throwing or rejecting `run()` and any projection failure become G4 "internal
    check", with no unhandled rejection and no raw error text. Plan names are validated
    against the fixed plan set;
  - the most recent stopped plan's restricted facts (plan name and step dispositions, as
    recorded then) are kept. The diagnostic report shows them, labelled as history, when a
    later check fails before evaluating the stored state — a failed reopen, a refusal or an
    unreadable read — so an unresolved write outcome is not erased. A newly stopped plan
    replaces them, and B4 clears them. The session never classifies them itself and never
    presents them as a fresh phase observation;
  - a B4 `access` report is a migration result: the session hands the target back by disposing
    the runner and reaches `access` only when the lease is positively freed. A failure to free
    it is G4 `handover_failed`. It never produces a `NativeActivationVerdict` or a composition.
- `src/components/persistence/NativeMigrationRecoveryView.tsx` — binds a session to the
  surface with `useSyncExternalStore`. Before a B4 handover it renders the blocking surface and
  nothing else. After a B4 handover it renders its children, which must be the existing
  composition gate: that gate still obtains its own verdict and composition before anything
  mounts, and in this stage it still stops at the unavailable authority. While a run has not
  answered it shows G1. After a presentation-only delay of 8 s
  (`MIGRATION_WAITING_PRESENTATION_DELAY_MS`, an engineering detail, not a product timeout) it
  adds an honest waiting line that cancels, retries and releases nothing. An already-known
  retirement finding is a subordinate note (UG-4). A disposed session renders a terminal
  "Storage check closed" state — never children and never an actionable control — whether it
  was disposed while the view was mounted or before the view attached. Report, clipboard and
  waiting state are keyed by session identity as well as run and status, so switching the
  `session` prop never shows the previous session's report, "copied" result or expired waiting
  line. A clipboard answer for a replaced report is ignored. Switching sessions neither
  disposes the previous one nor creates a runner.
- `src/components/persistence/NativeMigrationRecoverySurface.tsx` and `migrationRecoveryCopy.ts`
  — the presentational surface and its centralised English copy (UG-3). It offers:
  - the group heading and explanation;
  - "Check again" for G2 only;
  - collapsible help and technical details with the error code;
  - a diagnostic report generated only when the user asks, shown read-only and selectable, and
    copied only on a second explicit action. "Report copied." appears only after the clipboard
    succeeds; a rejection or a missing clipboard is reported as such.

  It offers no repair, reset, reinstall, "continue anyway", "choose a copy" or contact action.
- **Narrow gate correction.** `StorageCompositionGate` no longer offers "Try again" for
  `migration_authority_unavailable`. Its message now says that the transfer is not switched on
  in this build and that checking again will not change this. A retry there wrongly suggested
  that a recheck could activate the transfer. Every other failure keeps its retry, and the
  gate's lifecycle is unchanged.
- **Narrow runner observability** (`nativeMigrationRunner.ts`). A halted plan's report now
  names the cause its failing step had already observed (`PlanHalt.observed`). This tells apart
  causes that look the same from outside:
  - an unreadable value, a value listed and then absent, and a manifest key positively absent;
  - an unavailable digest and a malformed one;
  - a failed entry-key enumeration and a positively missing entry key;
  - a batch digest mismatch;
  - a diverged and an unavailable §5.5 validation;
  - mismatched, undigestible and malformed in-transaction evidence for AP-CC/AP-ACT.

  A blocked or access report names the validated record's phase (`recordPhase`). Both are fixed
  codes derived from values the runner had already obtained. The M3b4a core is unchanged, as
  are decision order, plans, guards, I/O order, cancellation and ownership. No read, write,
  digest or reopen was added. Evidence:
  - the unchanged M3b4a/M3b4b suites pass;
  - `nativeMigrationObservability.test.ts` drives each observation through the real runner;
  - a one-time differential run compared the pre-extension and extended runners over 35
    synthetic scenarios on both platforms (fresh migration, D1, marker rejection, checkpoint
    and activation outcome unknown, read and digest failures, divergence, a new key, a race
    before activation, a foreign marker, a malformed record, a failed reopen and an
    in-transaction read failure). It found every engine statement, source read and write,
    committed row and report identical apart from the two new fields. That temporary test is
    not kept in the repository.
- The class-M harness gained an optional `wrapSource` seam, used only to change the synthetic
  store at a chosen call.

*How to exercise it:* only through tests, which assemble the real runner over the
plugin-faithful engine and a synthetic WebView store (`nativeMigrationMTestKit.ts`), hand it to
`createNativeMigrationSession`, and render `NativeMigrationRecoveryView`. There is no production
switch, URL parameter, stored preference, developer bypass or demo route.

*Tests and traceability* — `nativeMigrationPresentation.test.ts` (classification of every
finding family, mixed-finding permutations, every halt cause, every outcome family, diagnostics
allowlist and sentinel exclusion), `nativeMigrationObservability.test.ts`,
`nativeMigrationSessionCorrections.test.ts` (the real runner on both platforms: session
disposal swept across opening, setup, read, digest and transaction boundaries with calls
recorded at issuance; reentrant and running-state disposal; contained runner disposal;
terminal disposal from every state; diagnostic history across failed rechecks; containment of
result processing), `nativeMigrationSession.test.ts` (the real runner: B4 handover, retryable halts, unknown marker
and transaction outcomes, reopen failure at close/release/open with no evidence read,
an external holder without takeover, a warm "matches neither" fault, latch present and latch
read failure, `bound_reached`, an active target read without source or marker access;
lifecycle: joined invocations, disposal before COMMIT rolling back, disposal after COMMIT
awaiting without rollback, disposal during a digest, retained plan evidence, uncertain cleanup,
unanswered calls, late results, observers) and `NativeMigrationRecoveryView.test.tsx` (jsdom,
over the real runner: G1–G4 rendering and actions, no downstream consumer before a handover,
the composition gate still blocking after B4, Strict Mode, unmount without disposal, waiting,
G4 version and internal-check cases, the help route without contact, keyboard operation,
diagnostics on request with clipboard success, rejection and absence, and sentinel credentials,
Profile UUIDs, key names and values absent from every rendered and copied text, with no
network or console call). `nativeMigrationRecoveryCoverage.test.ts` reads §6.10 and fails
unless every U2 requirement and every §6.8 outcome family has a labelled behavioural test — a
label check; the behaviour is in the labelled tests. `architectureBoundary.test.ts` asserts
that the two M3b4c library modules reference the core and executor through `import type`
only, that no M3b4c module reaches storage, plugins, network, environment, logging, identity
or a verdict, and that no shipped module imports any M3b4c module. `mobile/__tests__/bundle.test.ts`
asserts that no build mode contains the recovery interface.

| Requirement | Behavioural evidence |
| --- | --- |
| U2-1 (group mapping) | presentation: every finding family, permutations; view: keyboard and rendering |
| U2-2 (unknown ≠ rollback) | presentation: halt dispositions; session: unknown transaction outcome; view: copy |
| U2-3 (startup, recheck, no parallel, no loop) | session: joined calls, `bound_reached`, same-runner recheck; view: Strict Mode, double click |
| U2-4 (no bypass) | presentation: refusals; session: external holder, reopen failure |
| U2-5 (waiting) | session: unanswered call; view: waiting line without action |
| U2-6 (after disposal) | corrections: synchronous disposal swept across opening, setup, read, digest and transaction boundaries on both platforms; reentrant disposal; terminal snapshot from every state; view: terminal state mounted and attached later; session: before/after COMMIT, digest pending, plan evidence, uncertain cleanup, late result |
| U2-7 (no repair actions) | view: action inventory per group |
| U2-8, U2-15 (G4) | presentation: versions and internal checks; view: G4 copy and actions; corrections: throwing report property, malformed plan list, sync throw and rejection — G4 with no unhandled rejection, also after disposal; view: no downstream mount |
| U2-9, U2-10 (diagnostics) | presentation: allowlist and sentinels; view: on request, clipboard, no transmission, report and clipboard state scoped to the session; corrections: unknown marker and transaction outcomes kept as history across a failed reopen and an unreadable listing, never as a fresh phase |
| U2-11 (no contact) | view: help route |
| U2-12 (active target) | session: no source or marker access |
| U2-13 (identity) | session: no identity entry point; view: the gate still decides after B4 |
| U2-14 (save/sync wording) | view: copy unchanged |
| U2-16 (English) | view: approved translations |
| U2-17 (retirement note) | presentation and session: a nonblocking note, no extra probe |

*Layout.* The surface was checked once in a real browser at 320 and 390 px wide, with a 480 px
tall viewport, and at 1280 px. It showed no horizontal overflow, 44 px action targets and a
reachable diagnostic action. The check used a temporary harness that is not kept, so it is a
recorded manual observation, not an automated test.

*What it does NOT establish, and what is not done:*
- Component and controller evidence over the class-M harness only. Nothing ran on a simulator
  or a device, and it does not relabel any class-L or class-M case of R1–R77.
- The application version is an injected value. No shipped build supplies one yet, so the
  report says "not available" until a cutover stage wires a non-secret build-metadata source.
- No migration in any shipped build: no source retirement, credential work, fingerprint
  binding, latch clearing, targeted recovery, contact channel or cutover.
- Retirement is not implemented, and for an `active` record the collector reads no source, so
  in practice no retirement finding reaches the surface today (UG-4's stated limitation).

**Next:** Codex's independent review of M3b4c and the user's approval of it (stage 9). The
credential stages (5, 6, 10), the simulator rehearsal (11), device acceptance (12) and cutover
(13) follow the table above.

*6. What this resolution does not close:* review and approval of the blocked-state recovery
interface (M3b4c), the deferred targeted recovery procedures and the concrete help channel
(open item 3; U2's first-version policy and UG-1–UG-4 are decided in §6); protected-credential absence-versus-failure evidence (§4); secure
transfer of existing credentials; the cross-store credential/SQLite interruption; the
fingerprint algorithm and its platform availability (I-7); physical-device and restore-pairing
evidence; installation, signing and container preservation; the mid-session
credential-failure behaviour; production cutover (M3b5); and the honesty residuals no on-device
evidence can remove (§5.7).

**Required acceptance cases — requirements, distinguished from results.** They are stated as
executable scenarios against the checkpointed model (M3b0 §5.1), and they become due with the
stage named beside each group. Unit/model, real-engine integration and device evidence stay
separate and are never substituted for one another. **What exists today:** every class-L case
of R1–R77 (all except R2, R65 and R66) has LOGICAL coverage in the approved M3b4a decision
core's tests, and every class-M case has MOCK coverage through the dormant, approved M3b4b
executor (§7, "M3b4a implementation status" and "M3b4b implementation status"). **What does
not:** the recovery interface (M3b4c) is implemented but awaits review, and its separate
requirements are §6.10's U2-1–U2-17, which no R-case's coverage evidences; and no S
(simulator) or D (device) case of R1–R77, and no case below that depends on executing a
migration on an engine or device, has been run; R2, R65 and R66 remain simulator/device
obligations. Cases outside
R1–R77 that earlier stages already cover say so beside them.

*Authority and recovery (M3b0 §5.4) — due in M3b4*

1. D1 (PV6) — no record, no marker, target empty, source readable and empty → activates; nothing
   migrated.
2. **D2 (PV2) — readable-empty source with a POPULATED target and no activation evidence → BLOCKED**,
   no import, no delete. (The case D1 must not absorb.)
3. **C1 vs C2 — failed source enumeration is not an empty source**: with no `active` record the
   run blocks and retries; it never proceeds as "nothing to migrate".
4. **Interrupted enumeration** → with every `entryKeys` key still in the source and no target
   row: **E′6 (AP-K1′)** replaces the record in place under a new `migrationId` and the same
   `storeIdentity`; with any `entryKeys` key missing, including an empty source: **E′5,
   blocked**. Nothing was staged, so nothing is deleted. *(Amended 2026-10-19; the unconditional
   E3 re-enumeration is superseded.)*
5. A1/A2/A3/A4/A5 and A′1–A′7 — unreadable record, malformed record, invalid `phase`,
   `schemaVersion` higher **and** lower than supported, malformed manifest, and every
   phase-shape and integrity predicate → blocked; never downgraded, never overwritten.
6. **A6 — a `copied` entry outside the manifest** (a self-contradictory record) → blocked.
6b. **E′2 — staging progress and staged data disagree PRE-ACTIVATION, in both directions**: a
    `copied` key with no committed target row, **and** a committed row for a manifest key absent
    from `copied` → blocked in each direction; no repair by deletion or re-copy. Any target row
    while `enumerating` (E′1) and a row outside the manifest (E′3) also block.
7. `storeIdentity` missing or malformed (A′1, PV8) or differing from the marker (PV12) → blocked.

*Provenance markers (M3b0 §5.2) — due in M3b4*

8. **Valid activated target with a missing, cleared or unreadable old source → ordinary access
   proceeds.** The absent source marker does **not** block; retirement is recorded as stalled
   (B2). This is the regression the earlier both-markers rule would have caused.
9. **Source marker present, no target record, target empty → BLOCKED (PV5).** Under the
   record-first order a marker without a record can only follow the loss of a committed record
   or a false commit acknowledgement; it is **never adopted**. *(Amended 2026-10-19; the earlier
   "adopt the id" rule is superseded.)*
10. **Target record present and pre-`active` with the marker positively absent (P-1, PV14)** →
    in `enumerating`, E′5 or E′6 (K1′, same id); in `copying`/`verified`, K2 (E′9–E′11) only
    when every A′, E′1–E′8 and §5.5 check passes, otherwise the matching block. Neither claims to
    know which history occurred. An unreadable marker (PV10) or a malformed one (PV11) blocks.
    *(Amended 2026-10-19; P-1 is no longer an unconditional block.)*
11. Both markers present and equal → proceeds (PV13). Both present and **different** while
    pre-`active` → **blocked in every phase (PV12)**, including `enumerating` with nothing
    staged; the foreign marker is never overwritten or adopted.

*Generation coherence (M3b0 §5.5) — due in M3b4*

12. **A newly added eligible source key appears after enumeration** → set-equality validation
    fails and the run blocks. It must **not** pass merely because every recorded fingerprint
    still matches.
13. **A copied value changes before restart** → blocked; **no discard**, no mixed-generation
    snapshot, staged rows preserved.
14. **A copied value disappears from the source** → blocked with the staged target row
    **retained**, on the explicit ground that it may be the last surviving copy. No deletion,
    no inference of user intent.
15. **An uncopied value disappears** → blocked, with the original manifest entry retained as
    evidence; it must **not** silently vanish from a re-enumerated manifest.
16. **Source changes after `verified` but before activation** → E′8: `verified` is re-validated
    on resume and blocks. A `verified` record is not exempt.
17. **Identity records change between attempts**, including a new
    `accessBarrierResolution.<uuid>.v1` → the membership test sees it as a set difference, so
    validation fails and the run blocks. Within a single enumeration the dynamic family is
    captured as one coherent generation.

*Content policy (M3b0 §5.3) — due in M3b4*

18. **A known outbox key holds a future/unsupported domain schema** → copied **verbatim**, never
    skipped; the repository's existing validation applies after cutover; **hydration never sees
    `absent` and never writes a default over it.**
19. Unrelated unknown keys → not imported, not deleted, recorded; no repository hydrates them.
20. The distinction holds in both directions: an unsupported **domain** value is copied, while
    an unsupported **activation-record** schema blocks (A3/A4).

*Transaction and durability (M3b0 §5.1) — model cases due in M3b4; engine cases in M3b1*

21. Crash mid-checkpoint → that batch's rows **and** its progress entry are both absent on
    reopen; the last committed checkpoint is authoritative.
22. **Unknown commit outcome, durable state shows the batch COMMITTED** → the next evaluation
    reads the durable `copied`; that batch is **never chosen again** (I-11). Blind replay would
    overwrite committed state.
23. **Unknown commit outcome, durable state shows NO commit** → its keys remain in
    `manifest − copied` and are chosen afresh; nothing committed, so nothing is replayed.
24. **Durable state shows an inconsistent half** → E′2, blocked; never repaired by guessing. A
    surviving plan that finds the state matching neither the issued before- nor after-state
    has detected a fault (I-13).
25. An unknown **activation** outcome is resolved the same way, and a record already `active`
    is never re-activated.
26. Configured `journal_mode`/`synchronous` behave as assumed — measured by the M3b1 in-app panel,
    never assumed from documentation.

*Migration recovery and provenance cases R1–R77 (M3b0 §§5.1–5.6) — approved 2026-10-19; due in
M3b4 for classes L and M, with S and D evidence due as stated*

Evidence classes: **L** logical/model (a pure decision function over synthetic evidence
snapshots); **M** mock (the plugin-faithful engine and a synthetic source store); **S** real
engine on a simulator, user-reported; **D** a physical **disposable** device, user-reported
(never the user's data-bearing iPhone). The listed classes are where a case *can* be evidenced,
not results; the §5.6 CE traces are not counted as any of them. **W** marks a warm case — the
plan survives an unknown outcome. **C** marks a cold case — a fresh process with **all** earlier
plan memory discarded. After a **blocked decision**, the staged rows, record, manifest,
`entryKeys` and marker are byte-identical before and after. After a **halt**, every confirmed
step has taken effect; the one step with an unknown outcome may or may not have; no later step
was issued; and no store the plan issued no write to has changed. In every case nothing is
deleted, no committed checkpoint is replayed and no ordinary consumer mounts before B4. Where a
case below and cases 1–41 overlap, the case below is the more specific statement.

| # | Scenario | Expected outcome | Classes |
| --- | --- | --- | --- |
| R1 | **C:** death after the AP-D3 record commit, before the marker write | PV14 → E′6, same `storeIdentity` | L, M, S |
| R2 | A marker write returned, but WebKit had not persisted it | As 1. Whether a returned write persists is unmeasured | S, D |
| R3 | **W:** AP-D3 record commit, acknowledgement lost | Halt; no marker written. Re-evaluation from durable state: committed ⇒ PV14 → E′6; not committed ⇒ PV7, a new attempt with new ids. Neither is a fault; a state matching neither is row 6's case | L, M |
| R4 | **C:** the durable states of 3 with the plan memory discarded | The same rows as 3, decided without the lost ids | L, M, S |
| R5 | **W** and **C:** unknown outcome of, or death during, AP-K1′'s replacement | The old or the new `enumerating` record; either ⇒ E′5/E′6 (W: once the comparison found the before- or after-state; a mismatch is row 6); a cold start consults no `migrationId` | L, M, S |
| R6 | **W:** replacement outcome unknown; the reopened record has the issued new `migrationId` but differs elsewhere, even if it passes A′ and E′5 | **Detected fault (I-13):** no further step, no activation, no mounting; latch write issued. The table's E′6 is **not** taken | L, M |
| R7 | **C:** the durable state of 6, no plan memory and no latch | The table decides (E′5/E′6 if A′-valid) — the documented undetected residual, not a detection | L |
| R8 | AP-K1′ marker write rejected before applying | Halt, no target transaction issued; the marker reads absent ⇒ PV14 → E′6 | L, M |
| R9 | A marker write that applies and then rejects, in AP-D3, AP-K1′, AP-COPY, AP-CC or AP-ACT | Halt reported as outcome unknown; the marker reads equal ⇒ PV13; the target is unchanged by that step | L, M |
| R10 | **W:** a marker write's answer lost; **C:** death during a marker write | The marker read decides: PV13 or PV14; malformed ⇒ PV11; unreadable ⇒ PV10 | L, M, S |
| R11 | A marker present with no record (the order K4 forbids) | PV5, **BLOCKED** | L, M |
| R12 | AP-D3 marker write fails after a confirmed record commit | Halt: step 1 confirmed, step 2 unknown; next PV13 or PV14 → E′6 | L, M |
| R13 | **W** and **C:** the `enumerating → copying` commit, acknowledgement lost or death | `enumerating` ⇒ E′5/E′6, or `copying` with `copied = ∅` ⇒ E′7/E′9 | L, M, S |
| R14 | **W:** a checkpoint committed, acknowledgement lost | Halt; re-evaluation reads the durable `copied` ⇒ E′9/E′10; that batch is never chosen again | L, M |
| R15 | **C:** death after a checkpoint commit | As 14, without plan memory | L, M, S |
| R16 | **C:** death during a checkpoint, before commit | The previous `copied` and rows ⇒ E′9 chooses from the remaining keys again (nothing committed, so nothing is replayed) | L, M, S (death **during** COMMIT: D, unmeasured) |
| R17 | Rows without progress, or progress without rows | E′2 **BLOCKED** | L, M |
| R18 | A K2 marker write in AP-COPY, AP-CC or AP-ACT ends outcome unknown | Halt with no target transaction issued; next PV13 or PV14 ⇒ the same E′ row | L, M |
| R19 | **CE4:** `copying` with manifest = `copied` = target, all matching | E′10 → AP-CC → AP-ACT → B4 | L, M |
| R20 | **W:** the AP-CC commit's acknowledgement lost | Re-evaluation: `verified` ⇒ E′11; `copying` ⇒ E′10 | L, M |
| R21 | **C:** death after the AP-CC commit | `verified` ⇒ E′11; AP-ACT re-reads the evidence | L, M, S |
| R22 | **C:** death during AP-CC, before commit | `copying` ⇒ E′10; never an empty checkpoint | L, M, S |
| R23 | AP-CC finds a missing, extra or mismatched row, or incomplete `copied` | Rolled back; halt; next evaluation blocks at E′2, E′3 or E′4 | L, M |
| R24 | **CE1:** `verified` with `copied` ⊊ manifest and a row missing | A′6 **BLOCKED**; never activated | L |
| R25 | `verified` with complete `copied` but a target row missing or mismatched | E′2 or E′4 **BLOCKED**; never activated | L, M |
| R26 | Final target evidence unreadable inside AP-CC or AP-ACT | Rolled back — or the rollback's outcome is unknown, but no write had been issued in that transaction — then halt; re-evaluation retries; persistent failure blocks at PV9; never activated | L, M |
| R27 | **CE3:** AP-ACT writes the marker, then final source validation fails | Halt at step 2; the marker is present, or possibly present if its write was unknown; next PV13 (or PV14) → E′8 **BLOCKED**; the report names the marker step and its state | L, M |
| R28 | **W:** the activation commit's acknowledgement lost | Halt; re-evaluation: `active` ⇒ B4, never re-activated; `verified` ⇒ E′11 | L, M |
| R29 | **C:** death after the activation commit, with the source and the marker also gone | `active` ⇒ B4 without consulting either | L, M, S |
| R30 | **C:** death during activation, before commit | `verified` ⇒ E′11 re-validates | L, M, S |
| R31 | **CE2:** `entryKeys` not contained in the manifest, in `copying`, `verified` and a migrated `active` record | A′5 **BLOCKED** | L |
| R32 | `entryKeys` missing, empty, duplicated or ineligible in `copying`, `verified` or a migrated `active` record | A′2 or A′3 **BLOCKED** | L |
| R33 | An `active` record mixing empty and non-empty `entryKeys`, manifest and `copied` | A′7 **BLOCKED** | L |
| R34 | **A valid D1 record:** `active`, `entryKeys = []`, manifest `= []`, `copied = []`, with `activatedAt` and `sourceRetirement` | Passes A1–A6 and A′ ⇒ B4 mounts | L, M |
| R35 | **W** and **C:** the D1 creation's outcome unknown, or death during it | No record ⇒ PV6 again; `active` ⇒ B4 | L, M |
| R36 | A valid migrated `active` record whose live rows no longer match the manifest | B4 — the manifest is never compared with live rows | L, M |
| R37 | Marker alone removed, source intact, `copying` with ≥ 1 copied row | E′9 (K2), then AP-CC and AP-ACT; staged rows unchanged | L, M |
| R38 | Marker alone removed, `enumerating` | E′6 | L, M |
| R39 | Marker and **all** eligible keys cleared, `enumerating` | E′5 **BLOCKED** — not D1 | L, M |
| R40 | Marker and **some** eligible keys cleared, `enumerating` | E′5 **BLOCKED** | L, M |
| R41 | Marker and all or some keys cleared, `copying` with `copied = ∅` and with rows | E′7 **BLOCKED**; never re-enumerated | L, M |
| R42 | Marker removed and one value changed, `copying`/`verified` | E′7/E′8 **BLOCKED** | L, M |
| R43 | New eligible key added: in `enumerating`; in `copying` | AP-K1′ includes it; E′7 **BLOCKED** | L, M |
| R44 | Source cleared and repopulated: identical bytes; different content | Continues; E′7 **BLOCKED** | L, M |
| R45 | Foreign id with identical content, `copying` | PV12 **BLOCKED**, not K2 | L, M |
| R46 | Foreign id with different content | PV12 **BLOCKED** | L, M |
| R47 | Foreign id, `enumerating`, nothing staged | PV12 **BLOCKED**; marker not overwritten, record not replaced | L, M |
| R48 | Empty manifest in `copying`/`verified`, including over a cleared source | A′4 **BLOCKED** | L |
| R49 | `enumerating` with a manifest or `copied` present | A′2 **BLOCKED** | L |
| R50 | Malformed marker (not a canonical UUID), with and without a record | PV4/PV11 **BLOCKED**; bytes preserved | L, M |
| R51 | Marker read fails, with and without a record | PV3/PV10 **BLOCKED**, retry; never "absent" | L, M |
| R52 | Source enumeration fails at D3 entry, during AP-K1′, at validation and before activation | C1 **BLOCKED**, or a halt reported at the failing step | L, M |
| R53 | Target row enumeration fails, with and without a record | PV1/PV9 **BLOCKED**; never "no rows" | L, M |
| R54 | Target record unreadable or malformed | A1/A2 **BLOCKED** | L, M |
| R55 | Pre-activation target row outside the manifest; any row while `enumerating` | E′3 / E′1 **BLOCKED** | L |
| R56 | Three or more relaunches after every blocked decision | Same evidence, same outcome, no write to either store, nothing mounted | L, M, S |
| R57 | Three or more relaunches after every halt, unknown outcome and interruption, discarding plan memory each time | Committed progress kept; no checkpoint replayed; no duplicate activation; the I-12 measure never decreases; nothing mounted before a validated committed `active` | L, M, S |
| R58 | Every durable state in §5.4a's recovery tables: cold; warm with a comparison finding the before- or after-state; warm finding neither | The first two choose the same action; the third is a detected fault (I-13) whatever the table would select | L |
| R59 | Source value changes after validation, before its checkpoint | I-7: halt before issuing; next evaluation E′7 **BLOCKED** | L, M |
| R60 | Another process or an older build writes after the final validation, before the activation commit | Stated residual (§5.5): recorded, not claimed detected | L (documented) |
| R61 | Valid `active` target with the source missing, cleared or unreadable, and the marker missing, unreadable, malformed or foreign | B2 → B4; the marker is never read | L, M |
| R62 | After activation, a migrated key removed (sign-out removing `trustedDevice`), changed, or a new key added | B4; no re-import, no restore | L, M |
| R63 | An access-barrier key present at D3 entry vanishes before activation | E′5/E′7/E′8 **BLOCKED**; never activated without it | L, M |
| R64 | Provider credentials present, absent or unreadable, in either store | No migration decision changes | L, M |
| R65 | Checkpoint, completion and activation commits under termination during COMMIT and power loss | Unmeasured | D |
| R66 | WebView store and SQLite target restored from different times, or one alone (L1) | Unmeasured | D |
| R67 | **CE5** exactly: issued `entryKeys` {a, b}, reopened record new `migrationId` with `entryKeys` {a}, source {a} | **W:** detected fault, latch write issued; relaunch with latch ⇒ L0b **BLOCKED**; relaunch where the latch positively reads absent ⇒ E′6, the stated residual | L, M |
| R68 | **W:** a lost acknowledgement where the reopened state equals the issued **after**-state — D1, AP-D3 creation, AP-K1′ replacement, `enumerating → copying`, checkpoint, AP-CC, activation | The same row a cold start reaches from that state (§5.4a table, committed column); no fault | L, M |
| R69 | **W:** as 68, but the reopened state equals the issued **before**-state | The same row a cold start reaches (§5.4a table, not-committed column); no fault | L, M |
| R70 | **W:** a structurally valid record matching neither, in each phase — including an activation that leaves a valid-looking `active` record | Detected fault; nothing mounts in this process; relaunch with the latch ⇒ L0b **BLOCKED** although B4 would otherwise mount | L, M |
| R71 | **W:** after a reopen, a step the process saw **confirmed** is contradicted — e.g. a confirmed checkpoint's rows missing or different | Detected fault (I-13). (A cold start reaching the same state blocks at E′2 or E′4 without a latch) | L, M |
| R72 | Latch write **confirmed**; then a retry offered by the recovery surface, and three or more relaunches | Every one ⇒ L0b **BLOCKED**; no write to either store; nothing mounted; the latch is never cleared automatically | L, M |
| R73 | Latch write **rejected, failed or unknown** | Process stays latched in memory: no plan step, no marker or target write except bounded latch-write retries, nothing mounted. Relaunch: latch present ⇒ L0b; read fails ⇒ L0a **BLOCKED**, retry; positively absent ⇒ ordinary cold evaluation (the undetected residual) | L, M |
| R74 | Process death before or during the latch write | Relaunch reads present, absent or unreadable, exactly as 73 | L, M, S |
| R75 | Latch present with malformed bytes | L0b **BLOCKED** — presence alone latches | L |
| R76 | Latch present while the record is `active`, while retirement is incomplete, and while no record exists | L0b **BLOCKED** in every case; B4, B3 retirement, D1 and AP-D3 are never reached; nothing clears the latch | L |
| R77 | No latch and a valid `active` record; then the L0 read fails | B4 with one extra target read; on read failure L0a **BLOCKED**, as B1 — the source is never consulted | L, M |

*Post-activation mutability (M3b0 §5.4) — due in M3b4*

26b. **A migrated key is legitimately REMOVED after activation, then the app restarts** — the
     concrete case being `curling.identity.trustedDevice.v1` deleted by
     `identityTransitionCoordinator`'s sign-out protocol via `trustedDeviceRepository.remove()`.
     The run reaches **B4 and mounts normally**. It must **not** block, must **not** re-import
     the value from the old source, and must **not** restore it from the manifest.
26c. **A migrated key's value is legitimately CHANGED after activation, then restart** → B4;
     the manifest fingerprint is historical and is never compared against live application data.
26d. **A NEW key that was never in the manifest is written after activation, then restart** →
     B4; an unmigrated key is not an anomaly.
26e. **No repository is required to record migration progress**, and no domain write path gains
     a migration step. A test asserting that the repositories are unchanged is part of this.

*Target failure and mounting (M3b0 §5.4) — due in M3b4/M3b5*

27. **B1 — `active` record but the target is failing now** → the failure is reported, normal
    consumers do **not** mount, and there is **no fallback to the source**.
28. **Mounting rule** — every blocked state renders the failure/recovery interface only; no
    blocked state mounts identity, sync or sporting consumers against a partial target.

*Cleanup (M3b0 §5.5) — due in M3b4*

29. **Retirement meets changed source data** → that key is **not deleted**, and it is surfaced.
30. Interrupted retirement resumes for `copied` keys only, never beyond.
31. Retirement is **not attempted at all** on an engine without a committed-transaction
    acknowledgement.

*Identity, credentials and Web — due with the stage that touches each*

32. **Sign-out with provider failure → durable denial preserved**: the barrier is written first,
    a failing `signOut({scope:"local"})` neither restores access nor is reported as success.
33. A→B account switch with a delayed A operation → A's write keeps A's physical key.
34. Offline identity continuity, restart, later synchronisation.
35. Outbox preserved; existing idempotent replay unchanged.
36. **Web behaviour unchanged**, including the ADR-0025 Decision 10 compatibility assertions.
37. **Inaccessible credential storage is not established absence**: a failed read fails closed
    and never presents a signed-out state. **Covered as of Stage M3b3 at the CONTRACT level** —
    only a positively established absence becomes an SDK `null`, and `supabaseAuthService`
    refuses to report `no_session` or a completed sign-out while a credential failure stands,
    which closes both SDK absorption paths. The approved iOS bridge now supplies
    item-specific evidence locally (ADR-0049 amendment, 2026-10-24); physical
    Keychain failure acceptance remains open. Android still reports
    `no_absence_evidence` and remains closed (§4).
    **Also still not covered:** transferring the EXISTING credentials out of WebView storage,
    and the interruption case where one of the two separate stores is written and the other is
    not — both M3b4 (§4).

*Staging and isolation — 40–41 due in M3b1; 38–39 in M3b5*

38. **Attempted cutover before migration readiness** → refuses; never hydrates against an empty
    engine. **Covered as of Stage M3b3 for the composition half**: the flag-enabled production
    path cannot become ready without an activation authority, and it opens nothing while
    asking. The M3b5 half — a flag default flip that must still refuse — is unperformed,
    because the flip has not happened.
39. Missing native plugin / unsupported platform → fails closed. **Covered as of Stage
    M3b3**, for the storage adapter, the protected credential store and the composition
    itself, with **no fallback to `localStorage` or memory** in any of the three.
40. **Diagnostic isolation** — a fixed dedicated synthetic database distinct from every
    application database; no application key is read or written; the opt-in is build-time and
    off by default, with no URL parameter or stored preference able to enable it; a default
    build contains no diagnostics code. *(Implemented and covered by automated tests,
    2026-09-30. The superseded separate-app requirement is recorded above.)*
41. Representative **synthetic** dataset sizes, bridge payload and write costs.

**iPhone acceptance procedure (M3b6, not yet performed; before M3b5, on a disposable device —
never the user's data-bearing iPhone).** Install the previous build, record
a session and leave work unsynchronised; upgrade in place; confirm the app reports migration
and then shows the same history, plans and preferences; confirm the outbox still syncs when
online; force-quit mid-migration and relaunch; confirm no data loss and no duplicates; delete
a record after migration, relaunch, and confirm it **stays** deleted. **Android
implementation and device verification remain Stage M5 — shared design is not Android
evidence.**

---

## Stage M4 — Production Brower capture

**2026-09-30 priority exception: assisted training pilot.** The user approved a bounded
foreground iOS integration in the existing application before full M3b and M4: two
light gates in CHRON and explicit setup arming into the existing Training Capture
Sequence. The later approved Back–Hog Draw/Takeout filter now records matching times
automatically; unfiltered contexts retain one-tap acceptance. Gate-direction inference
is still deferred. This does not enable native storage, authorise data loss,
pass Gate C, or complete M4. The [canonical pilot decision and evidence limits](BROWER_INTEGRATION_STATUS.md#assisted-training-pilot-decision-2026-09-30)
govern this exception; [the debt inventory](TECHNICAL_DEBT_AND_ROADMAP.md#immediate-priority-assisted-brower-training-pilot-2026-09-30)
records the postponed work and activation blockers. Full production M4 retains the
prerequisites below.

**The pilot is now implemented (2026-09-30, [ADR-0050](adr/0050-assisted-brower-capture-pilot.md))
and is NOT hardware-accepted.** `@capacitor-community/bluetooth-le` 8.3.0 and
`@capacitor/app` 8.1.1 are now direct, exactly pinned dependencies, integrated into the
iOS project, and `NSBluetoothAlwaysUsageDescription` is declared. **`UIBackgroundModes` is
still not declared, so open decision P3 is untouched** — capture is foreground-only and
invalidates on backgrounding. This does **not** pass Gate C, complete M4, enable native
storage, or make any claim about Android. Live two-gate behaviour is unverified until the
[device checklist](BROWER_INTEGRATION_STATUS.md#physical-device-checklist-for-the-assisted-capture-pilot)
passes.

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

**Prerequisites.** M3 at minimum. **P1, the remaining parts of P4 and P5 block this stage.**

**Scope.** Remaining Android identity/store commitments; the **callback domain**;
completion of store listings and distribution acceptance; privacy declarations consistent with
`docs/adr/0041-first-versioned-privacy-notice.md`; guideline 4.8 resolution; release
signing; the Web/mobile coexistence decision from P1.

**The production API origin is already settled** — `https://curling.evolane.me`, configured
through `NEXT_PUBLIC_NATIVE_API_ORIGIN` (Stage M2a,
[ADR-0047](adr/0047-configured-native-api-origin-boundary.md)) — so this stage inherits it
rather than choosing it. **P4 also supplies the confirmed iOS name `Evolane Curling`, bundle
ID `me.evolane.curling`, team `J98U2J78B3`, Individual membership and English (U.S.) primary
language (German deferred).** Hermes reports the registered Explicit App ID and App Store
Connect record `6825376799`, SKU `evolane-curling-ios`; this is not a new portal verification.
These inputs are no longer open choices. They do **not** establish release signing,
device/credential or transfer/restore acceptance, nor authorize installation or upload.

**The remaining distribution work is not designed here.** Open decisions must not be
invented, and unperformed acceptance gates must not be treated as product choices already
closed by the account/identity setup. The first iOS email-only exception (§6.1) does not
resolve future P5 or approve M6.

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

**Scope FIXED by P2's answer (2026-09-29):** the milestone does **not** carry browser-local
drafts, authored plans or preferences across from the Web app. Criterion 5 is written for
exactly that case and now stands as final on this point. **Separately, engine migration
inside the installed native app is still required** (P6 / Stage M3b) and criterion 5 must
hold across it — an upgrade must not lose local-only work.

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
- It records the user's confirmed iOS identity/account/language decisions in **P4** and the
  API origin `https://curling.evolane.me`, configured through `NEXT_PUBLIC_NATIVE_API_ORIGIN`
  (Stage M2a, ADR-0047). It does not choose the remaining callback domain, Android identity
  or distribution commitments, and does not establish acceptance by recording those inputs.
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
- It does not decide P1, P3, P5, P7 or the **remaining parts of P4**; §4 records P4's confirmed
  iOS decisions, and §6.1 records the bounded first-iOS email-only exception.
  **P2 and P6's direction WERE decided by the user on 2026-09-29** and are recorded in
  §4, §7.1 and §7.5 — those entries are the decision
  record, not this document's own recommendation. P6's implementation and acceptance gate
  remain incomplete.

## Adopted inactive pure contracts — S1 and S2

These are accepted technical contracts for **inactive pure modules only**. Their
independent final design reviews passed S1 and S2 separately; this is not approval
of S3, physical installation transfer S4, runtime integration S5, or release. The
user expressly assigned implementation to the existing Hermes Coder and positively
handed over the checkout exclusively for this work. This task-specific implementer
exception leaves the repository's general separation of implementation and
independent review unchanged. Design adoption alone does not establish implementation
or native success; the separately accepted pure implementations are recorded below.
The S1/S2 labels in this appendix name implementation slices, not the credential-store
alternatives with the same labels in Stage M3b0 §4.

Q1/A and Q2 remain exactly as adopted in Stage M3b0 §7. Q3 is decided there as of
2026-10-24; its cleanup protocol is not implemented. Q4, additional
non-training fault policy, native bindings, SDK settlement, provider/send ownership,
physical coexistence/discovery/publish and activation remain separate open gates.
The original S1 trio stays outside application composition. Exact internal consumers
now include the reviewed inert helpers/port, S3f owner and private SQL/source bridges.
The default storage boundary imports the pure validators for its separate dormant
capture factory; ordinary Web methods do not invoke that factory or the executor. S2 stays without production callers/imports.
The archived full S3 proposal is not adopted here. Its discovery/Legacy-D
observation conflict is addressed by the separately reviewed bounded S3a design in
`BETA_COMPLETION_SPECIFICATION.md`: select complete legacy schema/key inventories,
then retain independent D/latch/row observations. S3a's local implementation adds
shared-factory discovery and handle exclusion, not combined Q/D transactions,
protected namespace freshness, physical transfer or runtime activation.
The subsequent independently reviewed S3b capability observes the exact combined
SQL layout and can atomically initialize a completely empty target. It exposes no
ordinary/legacy target, Q/domain progress write, B4 or readiness authority. It does
not adopt the full archived S3 protocol; its own rights do not include the separate S3f owner. Its
bounded contract is also in BETA_COMPLETION_SPECIFICATION.md.
The separately reviewed S3c port shares one fixed-namespace queue/lease with all
ordinary native credential stores, refuses ordinary calls during migration and
observes/inserts immutable M/I bytes without overwriting. It remains isolated from
app composition. That is cooperating same-context exclusion and per-call evidence,
not physical exclusivity, an atomic cross-store snapshot, SDK handoff or Q/D grant.
S3d separately adds an independently reviewed borrowed-domain runner over the
canonical records-only target. Authentic private lease/lifecycle/evidence stamps
and a retained borrow pin prevent a second child or premature parent release from
forgetting warm/unknown/fault evidence. It executes the normal prefix and stops
at the actual activation step, then produces only an opaque non-consumable hold
after fresh domain evidence. Parent recovery remains explicit; no combined schema,
Q/F progression, B4, finalizer or app consumer follows. Its positive warm-fault
observer precedes later reads/digests; ordinary standalone collection is unchanged.
See BETA_COMPLETION_SPECIFICATION.md for its precise limits.
The separately reviewed S3e host adds held-only domain preparation over one private
combined SQL owner, gated by exact initialized schema and absent Q/F. It returns no
ordinary store/target and permits no active transaction. Parent/child activity and
authentic one-shot permissions fence recovery; old favorable reads cannot certify
a new lifecycle, schema loss stays blocked, and parent observations cannot reset
the child's retained fault or latch budget. No Q progression, protected-port link,
Q/D finalizer, B4, runtime or activation follows. Older factories stay unchanged.
The separate S3f common executor now passed independent design/code review. Its one
actual source/SQL/protected owner performs Q/M/I copying and atomic Dactive/Qbound,
including all generated-state restarts, actual before/after uncertainty and fresh
raw-bound final proofs. Callback-free per-lifecycle controls fence both normal and
fault work; unavailable dependencies do not create permanent data faults. It returns
only an opaque internal completion candidate and retains its owners. Source-free
bound observation permits current mutable I contents while checking physical slot,
header and SDK form. No ordinary adapter, SDK/B4/Identity admission, config mapping,
source removal, installation transfer or activation follows from S3f. See the
canonical bounded contract in BETA_COMPLETION_SPECIFICATION.md.
The separate S3g Runtime entry also passed independent design/code review. It
revalidates bound state through those same retained resources, then publishes a
private mutable domain/credential pair together. It keeps separate sticky health,
actual transaction evidence and authentic cleanup receipts; malformed bridge
responses create no positive data fault. Old migration controls become terminal.
No application/SDK/Identity admission, production configuration mapping, source
removal or installation transfer follows from that private pair. The off-by-default
flag and unavailable production authority remain unchanged.
The independently reviewed S3h helper now provides standard WebCrypto SHA-256 over
exact JSON-framed domain raw values (`domain-value/v1`). It preserves the existing
D injection and introduces no cap, default or production caller. Actual composition,
configuration assignment and physical WebView availability remain open; this does
not bind the inactive installation-transfer fingerprint contract. Its canonical
contract is in BETA_COMPLETION_SPECIFICATION.md.
The separately reviewed S3i entry now provides explicit dormant credential-source
retirement under the same held SQL/protected owners. Destructive cleanup requires
a complete original-target proof and actual raw subset; an empty source permits
current mutable target contents. Cancellation/drain ownership precedes cold capture,
actual absence receipts survive aggregate failure, and a fresh synchronous empty
fence precedes joint handoff. Older factories remain source-free and remove nothing.
S3j hardens actual credential digest/encoder invocation without changing tuple
bytes, API or defaults. Separately reviewed S5a now owns dormant native AUTH
mechanics over the actual retirement/runtime pair, with whole-command serialization,
causal SDK denial, credential settlement, final SEND fencing and joined cleanup.
S5a alone has no app caller or Identity admission. Separately reviewed S5b now binds
that same private pair to the actual Identity coordinator, six repositories and
four fixed Identity RPCs. Original operation/account ownership, causal Self-session
negatives, actual health and final materialized-request checks govern every new
bootstrap readiness result. Cached startup cannot revive an obsolete admission.
This remains dormant and supplies no app mount or already-admitted training exception.
Separately reviewed S5c now binds the actual sporting mapper and three fixed RPCs
to coordinator-created, construction-bound Profile admissions on the same private
pair and SDK FIFO. New foreground ownership, denial and close revoke those services;
healthy background confirmation does not mint or replace admission. Synchronous
input capture, actual Self preflight and final SEND fences preserve the original
subject. Full genuine denial outcomes reach the narrow subscription. No app caller
or local sporting repository composition is added. S5d additionally binds the actual account-deletion/export mapper and guard repository
to private native control scopes, own-denial continuation and factual pending proofs.
Actual Provider callbacks are covered; mounted Flow polling/reload still needs app
composition and full invalidation subscription. S5e additionally binds the actual nine-method Team-exercise mapper to genuine
original admissions and per-command retry:false public clients. Exact immutable
wire intents, original indexed inputs and all issued siblings stay owned until
retirement. S5f additionally binds all29 existing Team methods and the five own-API
POST routes, with purpose-specific dependent-query hooks, exact original callback
capture and same-command bearer ownership. Current public diagrams remain bundled
with the existing disposable localStorage cache; the restricted resolver is dormant
future-only under ADR-0044 and MOBILE_APP_MIGRATION.md §5.2. S5g binds the seven
actual native base repositories, scoped outbox, retirement and personal export to
that same private owner, with synchronous DTO capture and truthful issued ACKs.
S5h separately closes the returned SyncManager/decorator boundary with one genuine
manager per admission, outer argument capture and actual background-lane ownership.
Local ACKs stay independent of cloud waits; snapshots/listeners cannot reopen stale
Profiles. S5i now independently joins actual Tracker event/effect ownership and the
original pre-fault Q1 training role, with fresh-ACK remounts, complete capture drains,
actual Account/Profile denial and retained history-first completion. Its dormant actual
Provider/Tracker composition activates no production root. S5j now separately joins
the actual Provider/Flow/export/Team over the same genuine host, with native-only
original-owner export retirement to the final share edge, unconditional/idempotent
denial delivery, known/unavailable intent projection and pre-preview Team context.
Independent corrected CODE and full local baseline passed; canonical contract/evidence
are BETA_COMPLETION_SPECIFICATION.md §S5j and TESTFLIGHT_READINESS.md. S5k additionally
accepts dormant exact provider-configuration preparation and its genuine same-host
entry. Full standard SHA-256 identities, primitive-only exact tuple framing and
complete boxed observation/drains refuse stale configuration without resetting data.
Existing helper public shapes remain; constructor ownership lasts through nested
work. Canonical contract/evidence: §S5k and TESTFLIGHT_READINESS.md.

S5l additionally accepts native pending-intent replay correlation on the genuine
coordinator lane, exact final-view membership and conditional dismissal/recovery.
The actual Provider and Team UI follow replacement links without stale consumption.
Only the new notification channel uses completion-only nested draining with exact
already-owned disposal exclusion; default/live/hash behavior remains unchanged.
Canonical contract/evidence: §S5l and TESTFLIGHT_READINESS.md.

S5m additionally accepts dormant actual App launch/event intake on that same host,
with explicit Team-origin opt-in, sequential exact native-context proofs, reentrant
classification ownership and complete observed-work draining. Healthy capture
refusal keeps ordinary startup/OTP recovery reachable; genuine faults retain their
vetoes. Exact own-disposal exclusion is never a handle/absence/removal ACK. The new
source-clock retainer preserves checked validation and identityFailed; legacy
channels/defaults remain. Public CoreJS receipts are not physical unsubscribe ACKs.
Canonical contract/evidence: §S5m and TESTFLIGHT_READINESS.md.

The private V3 archive has standard SHA-256 byte binding, actual domain interpretation
and historical catalog/registered-diagram compatibility checks (S6a–c). V1/V2 and
named domain recoveries remain unchanged. S6d now privately observes a complete
bounded actual WebView raw map with native receiver-bound reads, positive absences
and fresh fences; excluded credentials/cache/foreign values are never read. This is
source observation only, without writer exclusion, frozen-source, auth, transport
or mount/publish/rollback authority. No default/application caller is added.
S6e adds a private standard AES-256-GCM envelope with a separate fresh random
recovery code, actual V3 revalidation and completion-owned temporary-byte wiping.
It conveys no source/auth/transport/publication authority and has no app caller.
ADR-0053 records the decision; corrected independent CODE and full local baseline
are accepted. S6f adds a separately built observation-only helper with private
native iOS/App routing, current foreground/data checks and terminal revocation;
corrected independent CODE and the full local baseline are accepted. It is not
the default/native webDir and issues no source-freeze or transfer grant. Actual
original-container access, preservation-safe operational packaging and external
writer exclusion remain blocked pending disposable physical evidence. Actual
file/code delivery, target staging/readback/fresh-auth integration and
configuration/device/release gates remain open. Native Team email links may
continue opening Web under adopted MOBILE_APP_MIGRATION §6.5 until association/delivery
is accepted. Canonical current contract/evidence: BETA_COMPLETION_SPECIFICATION.md
§S6a–f and TESTFLIGHT_READINESS.md. No activation or Beta approval follows.

 Physical native URL delivery,
actual configuration assignment/supported operational change and installation
composition remain required before native activation.
Actual configuration assignment, operational writer exclusion and physical cutover
remain open; no actual user credentials were removed.

**ADR-0052 inventory extension (2026-10-24).** Account deletion adds the dynamic
`curling.identity.accountDeletionGuard.<profileId>.v1` and
`curling.identity.accountDeletionGuardResolution.<nonce>.v1` control families to
the owned identity repository set. They carry durable denial and cannot be
omitted during transfer or pre-activation migration. The separately reviewed
2026-10-24 D-inventory extension now copies exact valid members of both families
with the existing D manifest/checkpoint protocol; malformed owned members block
at every observed preactive inventory. Values remain opaque and cannot be
resolved/repaired by migration. B4 stays source-free. S2 v1 still refuses them;
its old format is not expanded. The separately reviewed S4a v2 entries now archive
known closed guard/resolution forms inertly, with full dynamic inventory and raw
preservation (BETA_COMPLETION_SPECIFICATION.md, S4a). Operational transfer and live
Identity admission remain separate. Existing B4 remains source-independent after
activation. The next native integration stage must reconcile the complete inventory
and its interruption/recovery evidence before activation. See ADR-0052 for the local/server fencing
protocol; the pure S1/S2 approval alone does not cover this extension.

The following sections reproduce the exact independently passed pure contract
text as the repository's normative feature specification, not an agent report.
Section references inside each appendix are local to its reproduced contract;
future-S3/S4/S5 references describe dependencies, not granted implementation scope.
“Proposed” admission budgets in the source are adopted only for this inactive
v1 parser/format; they do not set retention policy, native capacity or auth lifetime.
S1/S2 themselves select no cryptographic algorithm, native slot codec or production
provider. The separate bounded physical-slot/standard SHA-256 binding in
`BETA_COMPLETION_SPECIFICATION.md` does not change these logical formats or select
an application provider; native byte-capacity and runtime integration remain open.

### S1 — Credential protocol, SDK-value contract and admitted-training fault reducer

Scope: `credentialProtocol.ts`, `providerCredentialContract.ts`,
`credentialFaultPolicy.ts` and their three matching new tests.
Technical provenance: independently reviewed `credential-design-corrected.md`
sections 2–5; source SHA-256 `d2333b08cc664c0f20194ef88d57a91fa4813874e8ebaef2374a5700cfad0b8f`.
The source digest pins the full reviewed input; only sections reproduced below are
adopted for implementation. The S1 modules and their matching tests are implemented,
tested and independently reviewed clean as one complete pure inactive component.
Only the exact separately reviewed dormant bindings/owner and internal SQL/source
boundaries may import these pure contracts; no application startup invokes the owner.
This component acceptance does not close native,
runtime, physical-transfer, activation or release gates. The separate S2 pure
component has also been implemented and independently accepted, as recorded below.
Structural M validity never proves per-item absence; unindexed supported flows
remain in the frozen inventory, and Dactive alone is not combined storage readiness.

#### 2. S1 input boundary and finite envelope (CDR-01)

All quantities below count **JavaScript UTF-16 code units**, not UTF-8 bytes. Raw string APIs are primary; they take `unknown`, first test `typeof x === 'string'`, then length, then bounded parse. No coercion, stringify of inputs, spread, iteration of arbitrary inputs, `.toJSON`, or property-name/value output on failure. Returned validated records are fresh deep-frozen data copies, not the caller's object.

Proposed v1 operational limits, not claims about installed bridge capacity: at most 1,024 present keys, at most 1,020 dynamic flow slots; one SDK raw value ≤1,048,576 units; sum of present SDK raw values ≤8,388,608; SDK key ≤192 units; Q/M serialized input ≤1,048,576 each; I-envelope serialized input ≤6,300,000; F serialized input ≤512. JSON depth ≤32, aggregate nodes ≤65,536 and object members ≤4,096 per parsed value. Each metadata string key ≤128 units and arbitrary SDK metadata string ≤1,048,576 units. Apply bounded addition before incrementing budgets. Unsafe/negative/fractional counts are invalid. Out-of-envelope input is `limit_exceeded`, preserved and not migrated by v1, never truncated/deleted or converted to absent. No new cap on stored sporting history/outbox is introduced.

Use an iterative lexical pre-scan of JSON before `JSON.parse`: standard JSON grammar, depth/node/member budgets, decoded member-name uniqueness (including escaped aliases), decoded string length and code-unit budgets; reject duplicate members at every depth, including `__proto__` duplicates. Then parse once; JSON numbers must be finite. SDK opaque metadata may contain prototype-like names, treated solely as own data, never assigned onto prototypes. JSON strings may contain lone surrogates/NUL and must roundtrip unchanged. String admission cannot recover the cost of a string allocated by a caller, nor prove a native bridge can deliver it. Those are explicit later limits, not promised by this API.

Optional object seams in tests/builders accept only descriptor-snapshotted acyclic JSON data: in one guarded traversal use `Reflect.ownKeys`, `Object.getOwnPropertyDescriptors`, and prototype checks; allow plain Object.prototype or null-prototype records and dense ordinary Arrays with only length/index own properties. Reject symbols, accessors, inherited custom prototypes, non-enumerable record members, sparse arrays, functions, BigInt, NaN/Infinity and cycles; never invoke getters or supplied iterators. Bound traversal before recursion/allocation. Catch all reflection traps and return `hostile_input`; never inspect the thrown value. A Proxy cannot generally be detected and its reflection traps may execute; promise containment/no getter invocation/no caller references, **not** freedom from arbitrary proxy side effects or termination of a malicious never-returning trap. Production parsing only accepts primitive strings, avoiding this seam entirely.

Every public validator returns exactly `{ok:true,value:<validated owned data>}` or `{ok:false,issue:{code:<closed enum>,field:<closed enum>}}`. No raw exception, user-supplied property, key, ID, token, hash or byte fragment in `issue`. One issue only, deterministic first failure: type/limit → lexical JSON → schema/version → exact field set → field types → identifiers/key grammar → order/uniqueness → membership/phase completeness → cross-record correlation. Within a level, field declaration order below governs. Codes: `invalid_input`, `hostile_input`, `limit_exceeded`, `invalid_json`, `duplicate_member`, `unsupported_version`, `unknown_field`, `invalid_shape`, `invalid_identifier`, `invalid_key`, `order_or_duplicate`, `phase_violation`, `membership_mismatch`, `identity_mismatch`, `fingerprint_invalid`, `evidence_unavailable`. Fields: `input`, `header`, `phase`, `inventory`, `cursor`, `binding`, `session`, `user`, `verifier`, `index`, `fault`, `evidence`. Detailed validated objects are protected/internal results, never diagnostic projections.

#### 3. S1 complete Q/M/I/F contract (CDR-01)

##### 3.1 Primitive definitions and serialization

`Uuid` uses the existing application predicate exactly: `/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/`. No trimming/lowercasing/repair. IDs are application identifiers, never provider user IDs/Profile aliases. `protocolId`, `credentialEpochId`, `manifestId` have distinct roles; no equality between different roles is required, but each is valid and a protocol never changes any of them after intent. Generation/reuse prevention belongs to the later owner, not a pure random default.

`providerConfigIdentity` is a preassigned nonsecret config identifier matching `/^pc1:[a-z0-9][a-z0-9._-]{0,63}$/`; it is NOT an API key, credential hash or endpoint. Mapping it injectively to the one resolved provider configuration is supplied/adopted by composition later; S1 neither reads configuration nor invents it. Header `sdkContractVersion` is exactly `auth-js/2.112.3:credential-v1`. `schemaVersion` is numeric literal 1 (not string or boolean).

`sessionStorageKey` is the exact configured SDK root derived by the existing `providerSessionStorageKey` algorithm (`sb-${new URL(url).hostname.split('.')[0]}-auth-token`) and pinned in offline SDK tests. This v1 contract supports DNS-label roots matching `/^sb-[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?-auth-token$/`; custom storage-key overrides/IP-literal forms not satisfying it are unsupported, preserved/block without normalization. No production URL/key is read. Synthetic host `fixture.supabase.invalid` derives `sb-fixture-auth-token`.

Supported family: root (`session`), root + `-user`, root + `-code-verifier` (`legacy_verifier`), root + `-flows-code-verifier` (`flow_index`), root + `-flow-` + flowId + `-code-verifier` (`flow_verifier`). Flow ID exactly `/^[a-zA-Z0-9_-]{8,64}$/`. Classify fixed keys before dynamic matching. Own-project family means exact root or strings starting root+`-`; unknown suffix within that family blocks. Foreign families are excluded/untouched. No SDK key maps directly to a control slot.

`initialEntryKeys` is a **strict ascending code-unit ordered**, unique array of all present supported keys, including unindexed flows. Empty array is valid. Compare with `<`/`>` on primitive strings, not localeCompare. No absent key in this list. A presence inventory also carries four fixed-slot observations in role order `session,user,legacy_verifier,flow_index`, even if all absent. `itemId(n)` is `c` plus four lowercase hex digits of zero-based rank n in initialEntryKeys (c0000…c03ff); it is not a digest or physical key. No other spelling accepted. `allItemIds(K)` is exactly the mapped ordered list. Inventory identity is exact ordered equality, not just count/Set size.

Fingerprint dependencies are explicit and captured once: `Fingerprint = (purpose:'credential-value/v1', key:string, exactValue:string) => string|PromiseLike<string>`; `FingerprintFormat = (candidate:string) => boolean`. No production default for either; missing/noncallable dependency is `evidence_unavailable/evidence`. Structural M parsing calls only the format predicate: a fingerprint must be a primitive nonempty string ≤128 units and the predicate must synchronously return exactly true; throw, nonboolean, promise or false is `fingerprint_invalid/evidence`. Format is NOT content binding. `validateFrozenCopy` below actually invokes Fingerprint over each exact current key/raw value and compares the returned primitive string to M. Never normalize/re-serialize SDK content. Algorithm/physical byte codec/WebView capability remain later technical adoption. Tests use explicitly noncryptographic test-only providers, never production defaults. Only protected M stores fingerprints; transient owned computation results are private, never put into Q/F/SQL/UI/reports/portable transfer.

Serialization for Q/M/I/F uses JSON.stringify of fresh validated plain objects with fields in the exact declaration order below; no optional undefined/null fields and no whitespace. Ordered arrays stay ordered. S1 serializers are deterministic logical JSON, **not a selected physical secure-slot encoding**. SDK `value` inner string is copied unchanged; it is never replaced with JSON.stringify(parsedSDK). A parser may accept whitespace/alternative escapes in outer metadata but exact SQL CAS retains the original observed bytes as before, and serializers produce canonical after bytes. Duplicate member rejection precedes parsing.

##### 3.2 Q closed-field phase matrix

Common required fields in order: `schemaVersion:1, protocolId:Uuid, credentialEpochId:Uuid, manifestId:Uuid, providerConfigIdentity:ConfigId, sdkContractVersion:<literal>, sessionStorageKey:<root>, initialEntryKeys:Key[], phase:<phase>, verifiedItemIds:ItemId[]`. Binding field follows these. No other fields anywhere.

| phase | verifiedItemIds | expectedStoreIdentity | storeIdentity |
|---|---|---|---|
| intent | exactly [] | required Uuid | forbidden |
| manifest_confirmed | exactly [] | required same Uuid | forbidden |
| copying | ordered prefix of allItemIds(initialEntryKeys), possibly [] or complete | required same Uuid | forbidden |
| credentials_verified | exactly allItemIds(initialEntryKeys), including [] for empty C | required same Uuid | forbidden |
| bound | exactly allItemIds(initialEntryKeys), historical only | forbidden | required Uuid equal to former expectedStoreIdentity and D.storeIdentity |

Both binding fields present, absent required field, extra field, null, duplicate/non-prefix cursor, alien itemId, incomplete verified/bound all reject. expectedStoreIdentity is selected once BEFORE intent: for D1 by the owner generator, for an existing valid D from its storeIdentity. It is not a completed binding. Bound is built by removing expectedStoreIdentity and inserting storeIdentity; no independent newly generated identity at finalization. initialEntryKeys/IDs/config/root/version are immutable through every transition. No retirement fields in Q v1.

Pure Q transition input is a validated before plus exactly one tagged action: `confirm_manifest`, `begin_copying`, `confirm_next_item {itemId}`, `verify_all`, `bind {storeIdentity}`. These pure builders validate only deterministic shapes/edges; they cannot certify I/O or grant access. Their caller must first obtain successful correlation of actual evidence; S3 enforces that before issuing each write. Allowed edges intent→manifest_confirmed→copying→credentials_verified→bound; confirm_next_item only appends the next rank while copying; verify_all requires complete cursor (the caller must separately supply full matching frozen evidence); bind requires credentials_verified and equal expected identity. No skipping even for empty C. Copying→copying without new rank is rejected rather than used as an implicit retry; a retry classifies existing evidence, does not duplicate progress. No bind outside S3 final transaction is authority to access data.

##### 3.3 M immutable protected manifest

Exact fields in order: `schemaVersion:1, protocolId, credentialEpochId, manifestId, providerConfigIdentity, sdkContractVersion, sessionStorageKey, expectedStoreIdentity, initialEntryKeys, fixedSlots, items`.

First eight identity/config fields have the types above. `expectedStoreIdentity:Uuid` remains historical in M even after Q bound. `initialEntryKeys` exactly Q list. `fixedSlots` has exactly four records in the fixed role order; each exact `{kind:<fixed role>,key:<derived exact key>,presence:'present'|'absent'}`. Present iff that key occurs in initialEntryKeys. No read_failed/unknown tag can be frozen as absent. `items` has exactly one record per initialEntryKey in identical order, exact `{itemId:<rank ID>,key:<that key>,fingerprint:<injected format>}`. No item for absent slots. Every key and item ID unique. An entirely empty C still has four absent fixedSlots and items=[], not a missing manifest.

Q↔M correlation requires exact equality of schema/header/config/root/initial keys; M.expectedStoreIdentity equals Q.expectedStoreIdentity pre-bound or Q.storeIdentity when bound. No partial matching or adoption of foreign M. Structural validity alone is not proof M exists/readable or that any I is absent. M is immutable from first positively present valid value: no extension/shrink, new epoch, re-freezing content, or overwrite. Before M exists, Q intent freezes keys but does NOT claim earlier value fingerprints: only current full same-key snapshot can be frozen, with no issued item and fresh-namespace proof. A vanished/added key at this point blocks (C v1 deliberately has no K1′-style list replacement).

##### 3.4 I logical protected item envelope

Exact fields in order: `schemaVersion:1, protocolId:Uuid, credentialEpochId:Uuid, originManifestId:Uuid, providerConfigIdentity:ConfigId, sdkContractVersion:<literal>, key:<supported exact SDK key>, value:<exact SDK raw string>`.

Migration correlation requires header equality to Q/M, key membership in M, exact expected raw value and matching fingerprint. Runtime correlation requires the same header/epoch/origin/config/root family but **does not require historic M membership or content fingerprint**. New runtime flows/session updates use same installed pair. No itemId field (rank is historical inventory only). Empty string fails SDK content validation, even though it is a string. No raw legacy string is silently interpreted as an envelope or upgraded. A valid envelope for another epoch/manifest/config is pairing contradiction, not absence. Envelope valid but SDK malformed blocks exposure without deletion.

##### 3.5 F privacy-safe persistent fault

Exact fields in order: `schemaVersion:1, code, phase, operation`. `code` one of `pairing_mismatch, namespace_unproven, source_changed, protected_evidence_lost, sql_evidence_mismatch, invalid_metadata, boundary_failure`; `phase` one of `preflight,intent,manifest_confirmed,copying,credentials_verified,bound,finalizing,handoff`; `operation` one of `read,enumerate,write_manifest,write_item,write_q,finalize,reopen,release`. No IDs, keys, hashes, timestamps, exception text or nested data. Any present F (including malformed/newer) or unreadable F blocks; valid absent is the only empty state. insert-on-absent only, no clear/replace routine. In-process known contradiction blocks even when F insertion fails or is lost. F is not a grant and is not a generic runtime credential-health latch: transient runtime read/write/remove failures pause the current admitted context without manufacturing a permanent migration fault. Positive pairing contradictions invoke Q2 and may record F.

##### 3.6 Exact S1 pure API surface

`credentialProtocol.ts`: parse/serialize Q,M,I,F; `transitionQ(before, action)`; `correlatePair(q,m,dStoreIdentity)`; `validateFrozenCopy(q:unknown,m:unknown,sourceSnapshot:unknown,protectedSnapshot:unknown,fingerprint:unknown,formatPredicate:unknown): Promise<Result<ValidatedFrozenCopy>>`; `projectCredentialIssue` returning only the fixed issue. This one API is always async, including structural refusals; Result is the exact §2 ok/value or fixed issue union. `ValidatedFrozenCopy` is an owned deep-frozen `{q,m,sourceSnapshot,protectedSnapshot}` after all checks, internal only, no ready/access grant and no caller reference. `dStoreIdentity` remains `{kind:'preactive',expected:string}` or `{kind:'active',storeIdentity:string}`, never a boolean.

Frozen-copy inputs: q and m are the §3 logical Q/M objects (not caller brands); sourceSnapshot is exactly the complete §3.6 listing/reads/enumerationComplete object; protectedSnapshot is exactly `{items:[{itemId,key,result}],fixedItemAbsences:[{kind,key,result}]}`. Each result is exactly `{status:'value',raw:string}` (serialized I), `{status:'absent'}`, or `{status:'read_failed',reason:'unavailable'|'inaccessible'|'unreadable'|'absence_not_established'|'invalid_response'}`. Items equal M.items once each in rank order; fixedItemAbsences equal only M's absent fixed slots once each in role order. Present items require value, absent fixed slots require positive absent; any read_failed or omitted observation is `evidence_unavailable/evidence`; extras/duplicates/wrong order are `membership_mismatch/evidence`. No computed-digest/verified Boolean input exists.

Before invoking ANY callback or reaching the first await, guardedly descriptor-snapshot ALL q/m/sourceSnapshot/protectedSnapshot data under §2 limits, then validate the owned shapes, Q↔M headers/identity/phase, full source inventory/fixed absences, each parsed I header/key and exact Source↔I SDK raw equality. Callback references are captured once; reflection/accessor/proxy failures are contained. No later reread of caller objects/arrays is permitted. In particular callback mutation of original q/m/header/read arrays cannot change the owned snapshot. These are frozen migration checks, not runtime validation; bound runtime never calls this API.

After structural correlation succeeds, in M.items order call and await `fingerprint('credential-value/v1', ownedKey, ownedExactSourceRaw)` once per item, with the equal I.value already established. Validate each result with the captured format predicate then compare EXACTLY with that key's M.fingerprint. A format-valid wrong digest (including Source=I=B under M-hash(A), or swapped key/digest) is `fingerprint_invalid/evidence`, never success. Empty C computes zero digests but still validates all fixed absences/header/inventory. Provider synchronous throw, rejection, revoked callable or hostile thenable/throwing then getter is caught without inspecting the thrown value and returns `evidence_unavailable/evidence`; malformed resolved value or format predicate failure returns `fingerprint_invalid/evidence`. Await assimilation stays inside try/catch. A pending/nonterminating dependency remains pending; no timeout success, invented absence or release. This pure function cannot stop arbitrary callback side effects or prove source freshness while awaiting. It retains only owned exact input data; S3 fences every callback completion before granting continuation. No raw string, digest or thrown text reaches an issue.

`providerCredentialContract.ts`: `classifyCredentialKey(root,key)` → `{kind:<supported role>,flowId?:string}` or `{kind:'foreign'}` or `{kind:'unsupported_own'}`; `validateRuntimeCredentialValue(root,key,raw)` returning `{ok:true,value:{kind,raw}}` or fixed issue; `validateQuiescentCredentialSnapshot(root,snapshot)` returning the sorted complete inventory/fixed tags and exact strings or issue. Snapshot exact input fields `listedKeys:string[], reads:{key:string,result:{status:'value',value:string}|{status:'absent'}|{status:'read_failed'}}[]`, plus `enumerationComplete:true`. reads includes exactly once every listed supported OWN key and all four fixed keys (dedupe overlap), never a foreign listed key; listed keys reflect present slots, no phantom absent listed own key. Enumeration may include foreign keys, but their values must not be read; reads for foreign keys reject. All own unsupported keys block before any consumer exposure. Snapshot completeness is evidence the later source port must supply, not established by accepting true in a pure function. validateFrozenCopy receives the complete sourceSnapshot and the exact protectedSnapshot shape above, including every present manifest item and every absent fixed slot; no omitted read accepted. All structural success outputs remain internal and do NOT contain `ready:true`.

The pure interfaces may use separate positional primitive inputs rather than object seams; action objects still follow §2. All callbacks/predicates and supplied data are snapshotted/contained. TypeScript brands are compile-time aids, never untrusted runtime authentication.

#### 4. Installed SDK forms and snapshot/runtime separation (CDR-01/02)

Primary evidence: installed auth-js and supabase-js package versions both 2.112.3; helpers.js:131–156,241–255,276–400,424–434; types.d.ts:272–303,327–414; GoTrueClient.js:2506–2577,4034–4145,4353–4406. `_isValidSession` tests only property presence; it is NOT our runtime validator. `getItemAsync` turns falsy/malformed JSON into null; our boundary refuses those values first. Structural success never authenticates a JWT, proves server validity or creates a Profile.

##### 4.1 Exact persisted forms supported by credential-v1

All listed fields are own JSON data. Raw length/budget/parser rules apply. **Session root:** object, required nonempty access_token and refresh_token strings ≤65,536 units each, no control/whitespace characters (`U+0000–0020,U+007f–009f`) in either; required expires_at safe integer ≥0 with `expires_at*1000` also safe; required expires_in numeric duration satisfying exactly `typeof x === 'number' && Number.isFinite(x) && x >= 0 && x <= 9007199254740` (inclusive; ordinary fractions and zero allowed, no integer test); required token_type exact `bearer`. Expired/zero expiry passes structure (no new offline deadline). Optional provider_token/provider_refresh_token absent, null or nonempty strings ≤65,536 without controls/whitespace. Optional user absent or full User below; null/array/scalar/empty user object invalid. Unknown top-level Session fields are retained opaque JSON extension data under §2 budgets, never interpreted/grant-bearing; this is intentional because installed `_sessionResponse` shallow-copies provider response fields, not a closed TS-only shape. Known fields with wrong types never become opaque extensions. Serialized `__isUserNotAvailableProxy` is forbidden anywhere at Session/User top level; actual SDK proxy is not persisted data.

**User:** required `id` nonempty opaque string ≤512 without whitespace/control; `aud` nonempty string ≤512; `created_at` nonempty string ≤128; `app_metadata` and `user_metadata` JSON objects (not array/null). created_at/aud are structurally strings, not parsed as trusted date/permission. Provider ID is deliberately NOT forced to application UUID or equated with Profile. Optional string fields, if present, must be strings ≤4,096 (empty allowed): `confirmation_sent_at,recovery_sent_at,email_change_sent_at,new_email,new_phone,invited_at,action_link,email,phone,confirmed_at,email_confirmed_at,phone_confirmed_at,last_sign_in_at,role,updated_at,deleted_at,banned_until`. Optional `is_anonymous,is_sso_user` booleans. app_metadata.provider if present string, providers if present array of strings ≤512 each; arbitrary other metadata JSON retained within budgets. Optional identities array ≤1,024, each object required nonempty strings ≤512 `id,user_id,identity_id,provider`, optional identity_data JSON object, optional string dates created_at/last_sign_in_at/updated_at ≤128. Optional factors array ≤1,024, each required nonempty id≤512, factor_type in totp/phone/webauthn, status verified/unverified, nonempty created_at/updated_at strings≤128; optional friendly_name≤4,096 and last_challenged_at≤128 strings. Unknown User/Identity/Factor fields are bounded opaque JSON extensions, never permissions; known optional fields null reject. No nested content is logged, interpreted as JS or repaired.

**Detached user** key exact JSON object with ONE field `user:<full User>`, no extras. Frozen combinations: (a) inline user, detached absent: valid; (b) root without user + detached valid: valid split state; (c) root without user + detached positively absent: valid user-unavailable storage state, no identity grant (SDK may later retrieve user); (d) root positively absent + detached valid: preserve inert stale auxiliary item, not a session; (e) both present full users: IDs must exactly agree in frozen inventory; other user fields may differ and are retained, not merged. Root absent + all others absent is valid empty C. Runtime per-item validation does not assert cross-key identity/equality, which would break SDK write ordering; current identity correlation is the existing coordinator's responsibility. SDK `userNotAvailableProxy` is neither accepted as an arbitrary object seam nor fabricated by S1.

**Verifier:** exact JSON string. After decoding, either `[A-Za-z0-9._~-]{43,128}` or that base plus exactly one terminal `/recovery`. No other slash, blank, nested suffix, padding or whitespace. This explicitly supports installed 112-lowercase-hex generator and 56-character fallback, plus older standard-length PKCE strings; it does not adopt the SDK fallback as a new app cryptography choice. Validate READ and WRITE identically. Preserve the original raw JSON string and escape spelling.

**Flow index:** exact JSON array of unique flow-ID strings in the installed grammar; preserve original order/raw bytes; ≤1,020 entries. Empty [] is valid present, distinct from absent; scalar/object/null/malformed/duplicate/invalid ID rejects before SDK's filtering-to-[] path. Do not sort/reserialize index values. Five is the installed ring target, NOT an inventory cap; race-orphans can accumulate.

The expires_in ceiling 9007199254740 seconds is v1 numeric admission, aligned with the existing safe-millisecond expires_at envelope, NOT an auth lifetime, clock policy or offline extension. Keep expires_at's existing safe-integer/safe-millisecond rule unchanged; keep counts, cursors and generations safe integers. Installed `_sessionResponse` preserves supplied numeric durations; public `auth.setSession` computes `expiresAt - Date.now()/1000` without rounding (GoTrueClient.js:3022,3051) and `_saveSession` persists it (:4353–4386). Preserve the exact SDK raw JSON spelling and fractional value; do not round/clamp/rewrite. Wrong type, negative, nonfinite or above-ceiling duration refuses/preserves. Expired structurally valid sessions still pass structure, never become a new offline allowance.

Required future compatibility case: call the INSTALLED public `createClient(...).auth.setSession` at synthetic `Date.now()=1700000000123`, synthetic JWT exp=1700003600, complete synthetic User, persistSession=true, autoRefreshToken=false, detectSessionInUrl=false, unique synthetic storage key and only a stubbed `/auth/v1/user` response; fail every unexpected fetch. Route the real SDK storage write/read through the ACTUAL new runtime validator, assert successful setSession and finite fractional duration within the exact predicate, then exact raw roundtrip through I serialization/parsing. Restore clock/client ownership in finally. This is a future real-validator test, not a copied-writer test and not an S5 denial/settlement proof. Include zero, fractional, exact ceiling, just-above ceiling, negative, strings/null/booleans/arrays/objects and nonfinite vectors (lexical overflow 1e309 plus trusted object-seam NaN/±Infinity without JSON.stringify converting them to null).

##### 4.2 Two deliberately different validation contexts

Frozen, **quiescent migration snapshot**: complete source enumeration plus every fixed-key absence and present item read; listed/read keysets consistent; all well-formed unindexed flow slots included; every index reference has a readable structurally valid matching flow slot. No requirement that legacy verifier equals most recent index member, or that index equals all flow slots. Unknown own suffix, missing referenced slot, uncertain read, unsupported item or frozen inline/detached ID contradiction blocks, preserving bytes. Historical M pins this snapshot until bound.

Mutable **runtime READ/WRITE/REMOVE**: validate only exact addressed key, envelope/current pair and item's structural form; never enumerate/join index references, compare historical M contents/cursors, demand membership in M, or infer absence from M. Removal has no value to parse; it validates key/pair and uses real per-item removal evidence. Absent runtime get is null only on positively established native item absence. A valid index referring to a just-removed slot is not corruption by itself. A structurally valid newly written slot not yet indexed is not orphan-pairing evidence. Runtime cannot auto-repair index, evict unrelated slots, retry cleanup or delete unindexed flow items. An interrupted store/remove can leave partial relationships; preserve and let the ordinary SDK operation observe them with per-item evidence. A later NEW migration snapshot still applies frozen consistency rules; it may block on such remnants. That is availability refusal, not license to fix/delete.

Actual helper sequence compatibility requirements (offline, synthetic in-memory storage only, installed helpers, no provider network): store writes slot→reads index→optional eviction remove→writes index→writes legacy; remove(flow) reads slot→removes slot→reads index→writes/removes index→reads/removes matching legacy; removeAll reads index→removes indexed slots→removes index→removes legacy, and leaves unindexed slots untouched. Run helpers over a test adapter using the REAL new runtime validator, not a copied algorithm. Test concurrent/lost index update and interruption after each call. No frozen-snapshot validator installed in runtime. No app/SDK construction in production S1; helper imports and an isolated real public SDK compatibility client are test-only, with all transport stubbed and unexpected fetch failing.

#### 5. S1 pure admitted-training reducer (CDR-01/08)

`credentialFaultPolicy.ts` exports `reduceCredentialFault(state,event)`. Closed tagged inputs, own snapshots, no clocks/I/O. Tuple exact `{profileId:Uuid, identityGeneration:safe nonnegative integer, workId:Uuid, context:'training'}`; it represents a PREEXISTING admission, never generated by this reducer. Contexts assessment/team/home are explicit unsupported contexts. State exact common `{tuple:<tuple|null>, sporting:'healthy'|'failed', credentialPause:boolean, denied:boolean, completed:boolean}`; initial training state supplied by existing owner is healthy,false,false,false. Reducer cannot create/replace tuple. Invalid state/event → fixed invalid_input issue, no authority. Outputs exact `{state,decision,localContinuation,cloudPaused,newSignInPaused,warning,newWorkAllowed:false,profileSwitchAllowed:false,savedLocallyClaim:false}`. savedLocallyClaim is always false here: only actual sporting acknowledgements may produce UI success elsewhere.

Events are a closed union: `credential_failure {operation:'read'|'write'|'remove', outcome:'not_issued'|'failed'|'unknown', previousValueMayBeLost:boolean}`; `deny {reason:'explicit_signout'|'definitive_provider_denial'|'unresolved_barrier'|'pairing_mismatch'|'profile_mismatch'}`; `sporting_save_failed`; `training_completed_saved`; `sdk_event {event:'INITIAL_SESSION_NULL'|'SIGNED_IN'|'TOKEN_REFRESHED'|'USER_UPDATED'|'SIGNED_OUT_AMBIGUOUS'}`; `network_only_failure`; `attempt_new_work`; `attempt_profile_switch`; `startup_check`; `other_context {context:'assessment'|'team'|'home'}`. No pending issue is misreported as settled failed; actual pending runtime operation still held by later executor. previousValueMayBeLost must be false except write failures. Failed remove is not itself a denial. A causally proven provider denial is separate deny event even if cleanup also fails.

Each event is an object with outer discriminator `kind` equal to its event name and exactly the declared payload fields (none for payload-free events). State transition first: credential_failure sets credentialPause=true for all outcomes; deny sets denied=true; sporting_save_failed sets sporting=failed; training_completed_saved sets completed=true and tuple=null; every other event leaves state unchanged. Flags are sticky: no event clears them or replaces a tuple. For startup_check specifically, output never grants a new admission, even if no pause exists; it returns no_fault_policy_change when healthy and leaves normal startup authority outside this reducer. A completion event with no active tuple may set completed but never mint a successor. Invalid mixed state completed=true with nonnull tuple rejects. Deterministic order across a batch is deny → sporting failure → completion → credential failure → observation/attempt. Sticky state removes callback arrival dependence: later denial always prevents continuation; later success/SDK event cannot clear denied/pause/failed/completed. Decisions: deny→`existing_deny_path`, sporting failed→`sporting_save_failure`, completed→`exception_ended`; startup with pause→`startup_blocked` (and localContinuation=false, regardless of RAM auth); other_context→`policy_not_authorized`, attempts→`not_authorized`; otherwise failure with current tuple, healthy and not denied/completed→`continue_same_training_local`; same state observation→`pause_unchanged`; network-only with no pause→`existing_offline_policy`; credential failure with tuple=null→`no_admitted_training` and no continuation; clean observation→`no_fault_policy_change`. localContinuation true only for current same tuple, healthy, paused, not denied/completed, and event not startup/other_context/attempt. CloudPaused/newSignInPaused equal credentialPause OR denied OR completed-with-pause; warning equals credentialPause and not denied (sporting error separately visible). Network-only does not create credentialPause. Completing sets completed and nulls tuple; archiveAndReplace's empty successor is not new work permission. No in-document recovery event; a fresh process uses normal complete checks, not this reducer as a persisted offline grant.

This pure reducer supplies no new non-training runtime policy; applying it globally remains blocked if an integration needs an unapproved context. Actual User/Profile mismatch correlation and truthful saves remain outside S1.

### S2 — Installation-transfer inventory, codec and refusal-only decision model

Scope: `installationTransferInventory.ts`, `installationTransferCodec.ts`,
`installationTransferDecision.ts` and their three matching new tests.
Technical provenance: independently reviewed `transfer-design-corrected.md` C1–C7;
source SHA-256 `320376bd2c48a1d51eb0e6374649305eb7076ad95ade5f4c914c325f6df339d1`.
Only C1–C7 reproduced below are adopted. C8–C10 physical/auth/transport work is
not authorised by this appendix. This pure format is not a complete working backup
or installation-transfer feature.

Implementation status (2026-10-22): all six scoped S2 modules/tests are implemented,
locally tested and independently accepted as one complete **pure inactive component**.
The independent code review and its separately authorised final evidence closure are
complete; no S2 code-review gate remains open for this bounded component. C4's accepted
provider-return/ownership precondition still bounds asynchronous failure containment;
acceptance is not a guarantee for arbitrary hostile asynchronous returns. Inventory
and raw codec validation do not establish semantic usability, physical transfer, fresh
authentication, protected delivery or release readiness. No application caller,
production fingerprint binding or native integration is introduced. S3's discovery/
combined discovery beyond the accepted bounded slices, physical S4, runtime S5,
operational adoption of the dormant S3i Q3 cleanup, Q4 and the remaining
native/device/restore/activation/release gates remain open.

Acceptance evidence is kept in the local, non-repository archive
`~/.hermes/outputs/curling-beta/review-cycle/`: the independent S2 code verdict in
`s2-supervised-whole-code-final-review.json`, its authorised formal closure in
`s2-final-review-authorized-evidence-closure.json`, and the latest repository-wide
verification plus separate Assessment test follow-up in
`assessment-date-parent-final-20261022_181715-report.md` and
`assessment-date-parent-final-20261022_181715-report.json`. The latter closes the
Assessment fixture finding A1; it is not an unresolved S2 finding. Its raw results and
logs share that prefix, and its exact synthetic probe definitions are preserved in
`assessment-date-parent-final-20261022_181715-harness/`. These are dated verification
records, not additional normative contracts or device/release acceptance. The original
reports retain their historical intermediate states; the closure and final report
establish the current accepted status.

The separately adopted **S4a** section in BETA_COMPLETION_SPECIFICATION.md extends
the pure archive through explicit V2 inventory/encode/decode entries, after independent
design and code review on 25 October. It includes closed deletion guards/resolutions
without changing the V1 entries, C1–C7 below or the refusal-only Decision model.
V2 remains an injected fingerprint test contract, not operational protected delivery,
semantic compatibility, reauthentication, source removal or application admission.

#### C1 — Concrete PURE S2 surface and outcomes

Only three new modules and their three exact matching tests under src/lib/persistence are proposed: installationTransferInventory.ts, installationTransferCodec.ts, installationTransferDecision.ts; __tests__/installationTransferInventory.test.ts, installationTransferCodec.test.ts, installationTransferDecision.test.ts. No production imports/callers, repository construction, I/O, clients, SDK, storage, clock/randomness or bridge at module load or invocation. Existing files are read-only except later expressly adopted documentation. Constants may be mirrored from storage-bound modules and pinned by tests importing real declarations in isolated test context; pure imports must not pull their singleton factories into the S2 graph.

Public data inputs are primitive strings only; reject any object, boxed string, proxy/getter or other type before property access/coercion. The only object-like dependency is the explicit fingerprint function, checked by typeof and called inside try/catch. Never stringify an untrusted object. Public entrypoints:

- `planInstallationTransferInventory(listingJson: unknown)`: synchronous Result<ReadPlan>; C2/C5 closed listing grammar; returns sorted names of admitted raw reads, fixed positive-absence probes and exclusion counts. It does not read them.
- `encodeInstallationTransfer(snapshotJson: unknown, fingerprint: unknown)`: Promise<Result<{wire:string, packageDigest:string}>>; C2/C3/C4/C5 source-observation grammar, validates every observation, computes fingerprints and canonical wire. Returns a package only for a complete supported non-secret archival shape. No partial package on refusal.
- `decodeInstallationTransfer(wire: unknown, fingerprint: unknown)`: Promise<Result<ValidatedPackage>>; C3–C5 validation, exact frozen package data on success. Successful raw data is private return data, not diagnostics. No domain-usable/publication assertion.
- `decideInstallationTransfer(decisionJson: unknown)`: synchronous Result<Decision>; C7 closed state inputs and outputs. Never executes a plan and never returns an actual access grant.

Result is exactly `{ok:true,value:T}` or `{ok:false,code:E}`. Closed E: `invalid_input`, `unsupported_format`, `invalid_envelope`, `duplicate_member`, `noncanonical_wire`, `limit_exceeded`, `incomplete_inventory`, `unknown_owned_family`, `source_unobserved`, `source_unhealthy`, `sensitive_archive_unavailable`, `identity_archive_unsupported`, `fingerprint_unavailable`, `fingerprint_failed`, `fingerprint_invalid`, `digest_mismatch`. No exception object, key, value, identifier, hash, path, JSON excerpt or caller-provided message is returned in an error. Fingerprint synchronous throws, observed rejections and reachable observation exceptions are mapped to `fingerprint_failed` without inspecting their reasons; settled non-Digest results remain `fingerprint_invalid` without coercion. The no-raw-rejection guarantee for asynchronous returns is conditional on C4's provider-return/ownership precondition and does not cover arbitrary hostile returns. Missing provider is unavailable, never an identity/no-op hash. A never-settling injected promise stays pending; no timeout-generated success or cancellation pretending settlement. No storage side effects exist in S2.

Validation order: type/length admission, bounded syntax/duplicate/numeric/depth admission, closed shape/version/routing, key/category/membership/count/confidentiality checks, value fingerprints in sorted order, package fingerprint, canonical-wire comparison, success. Unknown formatVersion returns unsupported_format after safe syntax admission; never interpret it as domain absence. Exactly one failure at the earliest stage; within a stage deterministic key/array order. C7 invalid evidence is invalid_input, not a permissive default.

#### C2 — Inventory, source observations and confidentiality

##### C2.1 Exact key grammar

Canonical UUID is exactly `/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/` (src/lib/uuid.ts:1–7). Nil, uppercase, wrong variant/version, appended suffix or whitespace are invalid. TransferId and snapshotId use the same grammar and must be distinct; injected caller values, no generation in S2.

Sporting key = `curling.sporting.profile.v1.` + canonical Profile UUID + `.` + one exact suffix below. Suffix sequence below is declaration order, NOT wire sorting order. `domainContract` is an exact suffix-bound transfer reader descriptor, not a declaration that the inner payload schema is understood:

| suffix | domainContract |
|---|---|
| curling-release-tracker-current-session | session-current-raw-v1 |
| curling-release-tracker-session-history | session-history-raw-v1 |
| curling-release-tracker-history-filters | history-filters-raw-v1 |
| curling-release-tracker-assessment-data | assessment-combined-raw-v1 |
| curling-release-tracker-training-plans | training-plans-raw-v1 |
| curling-release-tracker-accuracy-tolerance-profiles | tolerance-profiles-raw-v1 |
| curling-release-tracker-smart-random-profiles | random-profiles-raw-v1 |
| curling-release-tracker-assessment-show-introduction | assessment-intro-raw-v1 |
| curling-release-tracker-assessment-last-threshold-preset | assessment-preset-raw-v1 |
| curling-release-tracker-assessment-last-custom-threshold | assessment-threshold-raw-v1 |
| curling-release-tracker-assessment-draft | assessment-draft-raw-v1 |
| curling-release-tracker-assessment-history | assessment-history-raw-v1 |
| curling-release-tracker-cloud-sporting-sync | cloud-sync-raw-v1 |

Derive Profile membership ONLY from physically listed valid sporting keys; for each discovered Profile require exactly 13 slot observations, each a string-present or positively absent. Every listed admitted key must be present. A namespace must have at least one present slot; no fabricated Profile with all slots absent. Team participant/athlete/recorder references and trusted identity Profile do NOT add namespaces. Zero sporting Profiles is valid, including identity-only and fully empty installations. A positively absent sync slot is complete coverage, not missing inventory. Unknown/malformed key under the own Profile prefix blocks, even if another valid key exists.

Five fixed identity keys, each always observed present/absent: curling.identity.trustedDevice.v1, curling.identity.accessBarrier.v1, curling.identity.interactiveAttempt.v1, curling.identity.pendingIntent.v1, curling.identity.intentCleanup.v1. Dynamic family: `curling.identity.accessBarrierResolution.` + canonical barrier UUID + `.v1` exactly; enumerate ALL present members, sorted unique, and declare enumeration complete including empty list. Do not invent infinitely many absent dynamic keys. A resolution item's barrierId must equal its key selector. Legacy slot: `curling.sporting.legacy-unscoped-retired.v1`, always observed present/absent. Present value must be exactly `complete`, otherwise source_unhealthy; it is archived evidence, not a destination cleanup command.

##### C2.2 Closed source input grammar

`listingJson` is a JSON object with EXACT fields `{schemaVersion:1, keys:string[]}`; keys unique and sorted by C4 code units, max C5 listing count. Classify keys before requesting any value. Own names are those starting `curling.`, `curling-release-tracker-`, `curling-performance-`; unknown own family blocks. Provider stem `/^sb-[^.]+-auth-token(?:$|-)/` is an exclusion classifier only, NOT a credential inventory validator. Public cache prefix `curling-performance-public-exercise-diagram-v1.` excluded; malformed cache suffix is still disposable cache, never a sporting namespace. Ten bare first-ten sporting suffixes are retired-unscoped: NEVER request their values. Foreign names excluded untouched. Neither exclusion scans nor counts assert native credential freshness.

Known controls: exact `curling.nativeMigration.sourceMarker.v1`, `curling.nativeMigration.activationRecord.v1`, `curling.nativeMigration.faultLatch.v1` are classified for a separate value-free source-owner health projection, never requested as raw transfer data. Future Q/F/M/I names are NOT invented: any new own control family is unknown_owned_family unless an independently adopted versioned projection registers it. No read request may address protected M/I or provider session/verifier slots. Unknown future controls block completeness, not a broad raw copy. A wrapper supplying raw control bytes as an item fails closed key/category validation.

`snapshotJson` is a closed JSON object with EXACT fields `{schemaVersion:1, transferId:UUID, snapshotId:UUID, sourceBuild:{version:Label,build:Label}, catalogContractId:Label, listing:{schemaVersion:1,keys:string[]}, observations:Observation[], sourceControl:{domain:"absent"|"healthy"|"fault"|"unreadable"|"unsupported", credential:"excluded"}, snapshotState:"synthetic_frozen"|"owner_frozen"|"unavailable"}`. Label matches `/^[A-Za-z0-9][A-Za-z0-9._-]{0,63}$/`, not a URL/path/free-form metadata field. No timestamp is used as authority. sourceControl.domain may be absent only when no known domain-control key was listed; any listed known control requires healthy. Fault/unreadable/unsupported or unavailable snapshot returns source_unhealthy. `synthetic_frozen` is test-only input and never operational evidence. `owner_frozen` is a statement supplied by a later owner, not authority minted by S2.

Observation is EXACT `{key:string, state:"present", raw:string}` OR `{key:string,state:"absent"}` OR `{key:string,state:"unobserved"|"unreadable"}`. Unique sorted observations must equal the entire expected slot set (13 per namespace, 5 fixed, enumerated dynamic, 1 legacy). Every absent expected key must NOT appear in listing; every present expected key must appear. Extra/omitted/duplicate/conflicting observations fail. Unreadable/unobserved never count as absent. Source read plan exposes no writeMarker/remove/clear capability. This typed model cannot prove quiescence or authenticate the supplied observations; physical binding is C10, unavailable today.

##### C2.3 Inclusion/confidentiality table

All admitted sporting raw strings are included unchanged, even unsupported/malformed schemas; their opaque contents are private application data, not auto-classified free of arbitrary secrets users might put in notes. The guarantee is no credential/control FAMILY read/copy, not impossible detection of arbitrary secret text in opaque notes. Nothing is logged.

| category | allowed representation and refusal | authority |
|---|---|---|
| sporting | all present raw strings, explicit absences, C5 admission | no grant; C6 usability separate |
| trustedDevice | present only if duplicate-free bounded JSON, EXACT fields of TrustedDeviceRecord schema 1 (:63–79), existing pure validator succeeds, generation safe uint; unknown/extra/malformed fields => identity_archive_unsupported | inert, never install into live identity repo |
| accessBarrier | same exact-field rule for IdentityAccessBarrier schema 1 (:82–98), validator succeeds, nullable generation safe uint | denial knowledge; unresolved/malformed => no new access |
| interactiveAttempt | exact schema-1 fields (:60–76), existing validator succeeds, safe capturedIdentityGeneration; Google flow selector is non-secret, not PKCE verifier | archive only; NEVER replay |
| barrierResolution | exact schema-1 fields (:57–69), validator succeeds, safe generation and key/id match | historical correlation only; NEVER resolve destination barrier |
| intentCleanup | exact `{schemaVersion:1,recordedAt:valid timestamp}` and existing validator succeeds | outstanding denial debt, never silently discharge |
| pendingIntent | positively absent allowed; present ONLY exact schema-1 `{schemaVersion,kind,value,capturedAt,survival}`, kind admin_request, canonical UUID value, ordinary survival, supported timestamp and existing validator succeeds | inert administrative target, never replay |
| pending invitation / invitation_account_recovery | ALWAYS sensitive_archive_unavailable, even with cleanup debt or apparent expiry; malformed/unknown pending shape conservatively same refusal (could conceal invitation secret) | preserve source; no redaction/drop/replay or complete package |
| legacy marker | exact `complete` or absent | archive only, no deletion consent |
| source D/marker/latch | value-free domain absent/healthy projection only after owner validates originals; fault/unknown refuses normal export | not copied as destination active |
| Q/F/M/I, SDK values, verifiers, credential fingerprints | raw always excluded; new unsupported own controls block until reviewed projection; never serialize raw M as provenance | never portability/ownership proof |
| public cache/bundle/export cache; foreign keys; retired bare keys | explicit exclusion policies; no raw values requested | untouched |

Strict identity parsing uses the same bounded scanner as C5 on each raw value (aggregate work budget shared), checks EXACT source field sets before calling pure validators. Non-secret identity raw strings are preserved byte-for-codeunit, not reserialized to the validator's projection. Unknown identity shape refuses package creation rather than silently dropping fields. Mirror pending-intent validation in the new pure module; tests pin against actual validation without production importing pendingIntentRepository's localStorage singleton. Barrier/trusted/attempt/resolution pure validators may be reused if architecture checks prove a pure import graph. All generation numbers must additionally be safe nonnegative integers; source validator permissiveness is not a bypass. No protected invitation representation or delivery choice is approved by this v1 proposal. A future format revision must solve that separately. Even eligible packages remain private and may not be delivered without later reviewed protection.

#### C3 — Closed envelope v1 (no optional fields)

Every object is closed; every field below REQUIRED. `Digest` = exactly 64 lower-case hex characters. `UInt` = safe integer 0..9007199254740991 subject to lower C5 limits. `UUID` and Label are C2. Null is literal JSON null, not omission.

Root EXACT fields:

| field | value/type |
|---|---|
| format | literal `curling-installation-transfer` |
| formatVersion | literal 1 |
| fingerprintContract | literal `injected-256-v1` |
| transferId, snapshotId | distinct UUIDs |
| sourceBundleId | literal `local.dev.curlingperformance` |
| intendedDestination | literal `me.evolane.curling` |
| sourceBuild | closed `{version:Label,build:Label}` |
| provenance | closed `{inventoryContract:"profile13-identity5-resolution-legacy-v1", schemaInterpretation:"opaque-preserved", catalogContractId:Label, domainControl:"absent"|"healthy", credentialControl:"excluded-not-copied", authority:"snapshot-only"}` |
| profiles | sorted unique UUID[] derived from present physical sporting keys |
| dynamicIdentity | closed `{enumeration:"complete",keys:string[]}` sorted unique exactly present resolution keys |
| items | Item[] sorted unique by key, total coverage C2 |
| counts | closed `{slots:UInt,present:UInt,absent:UInt,profiles:UInt,dynamicIdentity:UInt,rawCodeUnits:UInt}` recomputed exactly |
| exclusions | closed fixed policy object below |
| completeness | literal `complete-stored-inventory-with-declared-exclusions` |
| credentialPolicy | literal `fresh-reauth-no-provider-values-verifiers-or-credential-hashes` |
| packageDigest | Digest |

Exclusions EXACT object and literal values: `{providerCredentials:"never-read", protectedCredentialControls:"never-read", retiredUnscoped:"never-read-never-adopt", publicCaches:"reconstructible-not-copied", bundleCatalogs:"references-only-not-copied", exportCache:"not-a-backup", foreignKeys:"untouched"}`. Counts of excluded keys are deliberately NOT portable, and are not evidence of missing native items. No arbitrary category/extension bag.

Present Item EXACT `{key:string, category:"sporting"|"identity_archive"|"legacy_archive", profileId:UUID|null, domainContract:string, presence:"present", raw:string, codeUnits:UInt, valueDigest:Digest}`. Absent Item EXACT `{key:string,category:...,profileId:...,domainContract:string,presence:"absent"}`; raw/codeUnits/valueDigest prohibited. Identity uses exact domainContract `identity-<fixed-name>-v1` where fixed-name = trustedDevice, accessBarrier, interactiveAttempt, pendingIntent, intentCleanup, or `identity-barrierResolution-v1` for dynamic. Legacy uses `legacy-retirement-v1`. Sporting profileId must equal namespace UUID and contract must equal C2 table. Non-sporting profileId MUST be null. Category is derived, never caller selectable. Domain schemas themselves remain in raw; this reader descriptor is NOT schema-6 reconstruction or semantic approval. Every routing/schema/provenance/category/presence field participates in packageDigest.

No inner raw JSON normalization, trimming, Unicode normalization, timestamp coercion or cloud digest recalculation. Version mismatch of OUTER envelope refuses; unknown sporting INNER schema may have a valid outer envelope and raw preservation but never domain usability by itself. Identity/control unknown shapes use the conservative refusal above.

#### C4 — Canonical wire and exact fingerprint preimages

This is a logical fingerprint injection contract, NOT a selected crypto engine, authenticity mechanism or protected transport. No production binding/algorithm has been selected. Version 1 with `injected-256-v1` is an inactive test/spec format: two callers must supply the SAME deterministic test provider to compare identities. It MUST NOT be delivered/accepted operationally. A production fingerprint-contract identifier/algorithm binding requires separate independent review and a new supported contract/version; no silent fallback under this identifier.

Code-unit order: compare JS charCodeAt(i), first unequal unsigned 16-bit unit wins, shorter prefix first. Never localeCompare, Unicode scalar sort, normalization or UTF-8 replacement. All arrays specified as sets are unique and sorted this way. Objects canonically sort field names the same way. Items sort by full physical key.

Wire is a canonical ASCII-only JSON spelling of the validated closed object: no whitespace/BOM/trailing data; keys sorted; arrays in prescribed order; unsigned decimal integers shortest spelling (0 allowed, never -0, fraction, exponent, sign or leading zeros); null/true/false literal. EVERY string code unit, INCLUDING member-name characters, is emitted as exactly `\u` plus four lower-case hexadecimal digits, enclosed by quotes. Thus empty is `""`, NUL is `"\u0000"`, high lone surrogate `"\ud800"`, low `"\udc00"`, replacement `"\ufffd"`; supplementary pairs remain two escapes. No escape aliases or literal characters inside strings are canonical. Input parser recognizes general JSON for precise duplicate rejection but ultimately rejects semantically equivalent noncanonical spellings. The package identity is of the canonical decoded object, not arbitrary JSON whitespace bytes. Canonical comparison is an incremental emitted-character comparison against admitted input; do not allocate a second full wire just to compare. Encoder pre-counts exact emitted length before producing output.

Byte framing `U(n)` is unsigned 64-bit BIG-ENDIAN; reject n outside safe UInt before encoding. Implement high/low word conversion only after range checks (or BigInt on checked n); no unchecked JS bitwise truncation. `S(s)=U(s.length)` followed by each charCodeAt as two big-endian bytes, no BOM. Recursive typed encoding T:

- null = byte 0x00; false=0x01; true=0x02;
- UInt = byte 0x03 + U(n);
- string = byte 0x04 + S(s);
- array = byte 0x05 + U(element count) + T(each in order);
- object = byte 0x06 + U(member count) +, for each code-unit-sorted member, S(name) + T(value).

No undefined/NaN/Infinity/negative/fraction/function/symbol/object accessor in T. T receives ONLY the parser-created validated owned plain tree. Value preimage = ASCII bytes of `curling-transfer-value/v1` followed by 0x00 then T(raw string). Package preimage = ASCII `curling-transfer-package/v1` + 0x00 then T(root with ONLY the root packageDigest member removed). This includes raw strings AND value digests, all metadata, explicit absences, counts and exclusions; packageDigest excludes itself once, no other field exclusion. `fingerprint(Uint8Array preimage)` must resolve primitive Digest; no coercion. Both encode and decode recompute present values first then package. Sequential calls, at most one preimage byte buffer live per awaited call; no production/test default. An injected provider may retain buffers, allocate, block or lie; S2 cannot resource-bound its internals or authenticate results. Wrong/malformed/rejected provider never causes writes or success. Golden BYTE preimages, independent of a digest provider, must distinguish Unicode vectors and metadata-only mutations.

Provider-return/ownership precondition (IR02). The callable remains `(bytes: Uint8Array) => unknown`. A returned native Promise is conforming only if S2's captured intrinsic `Promise.prototype.then`, invoked with S2's nonthrowing resolve/reject handlers, can attach both settlement reactions without abrupt completion and create a safe derived Promise. Its constructor lookup, relevant prototype metadata, `Symbol.species` lookup and capability construction must remain observation-safe from provider return through attachment, including during those operations. The derived capability must also remain safe through settlement: normal handler completion must not throw or produce an unowned rejection, and the ignored derived Promise must not independently reject without provider ownership. A nonthrowing intrinsic call alone is insufficient. Ordinary unmodified native Promises satisfy this boundary; masking an own `then` alone does not disqualify them.

A cooperative thenable must deliver primitive fulfillment (a primitive Digest for success) or an opaque rejection through the supplied callbacks, and the provider must own its underlying Promises and every otherwise orphan-able rejection, including ignored continuation/then-return values. Reachable then getter/call throws remain fixed failures without reason inspection. Synchronous provider throws, primitive-result validation, ordinary/masked-own-then settlement and genuine pending semantics are unchanged. A conforming return that never settles remains pending; no timeout, cancellation or fallback may pretend settlement.

The provider owns pre-handoff, internal/background and otherwise unobservable or orphan-able rejections; S2 does not erase earlier host reports. If a source may become unobservable, the provider must establish a plain safe bridge and safe forwarding reactions at source creation while the source is still observable and before an unowned rejection can be reported, or drive that bridge directly from provider-owned completion callbacks; only the safe bridge crosses the callable boundary. This is provider cooperation, not rescue by wrapping an already hostile unhandled Promise after receipt. No production adapter or operational fingerprint binding is added in pure S2; its real owner/binding remains a future independently reviewed gate.

This explicitly narrows the previous blanket asynchronous rejection-containment guarantee; the existing provider resource/authenticity disclaimer did not already cover it. It is a semantic precondition, not a runtime validator for arbitrary returns. Failure of the captured intrinsic is not proof of a non-native receiver; fallback assimilation is best effort and proves no ownership. A nonconforming return can still yield `fingerprint_failed` while its original or derived rejection remains unhandled and host-visible; it is out of contract, not safely contained. No global/intrinsic/listener changes, caller-object mutation, host/native rescue or new rights are permitted.

Examples of T only (hex): null `00`; empty string `04 0000000000000000`; NUL string `04 0000000000000001 0000`; high lone surrogate `04 0000000000000001 d800`; low `04 0000000000000001 dc00`; replacement `04 0000000000000001 fffd`. Source inner strings remain exactly equal under JS code units; no TextEncoder on raw values.

#### C5 — Proposed finite format admission, not storage retention

These are engineering admission budgets for this PURE format proposal, NOT a device capacity measurement, sporting-history cap, retention policy, truncation rule or permission to change storage. Out-of-envelope sources remain intact and refused (`limit_exceeded`). No prefix/subset package, split-history rewrite, automatic chunked file scheme or engine switch.

| budget | exact inclusive maximum |
|---|---:|
| already-supplied input primitive string (listing/snapshot/decision/wire) | 25165824 UTF-16 units |
| canonical ASCII wire (also bytes, since ASCII) | 25165824 |
| lexical JSON nesting (root container depth=1) | 16 |
| decoded strings across one input tree including names/raw | 4194304 units |
| sum of present raw strings | 3145728 units |
| one sporting raw string | 1048576 units |
| one identity raw / legacy raw | 65536 units / 8 units |
| one physical/listed key | 256 units |
| metadata Label / object field name | 64 / 64 units |
| Profile namespaces | 32 |
| dynamic resolutions | 512 |
| complete items (present+absent) | 1024 |
| source listed keys (including exclusions) | 4096 |
| total object members + array elements (structural edges) | 65536 |
| preimage buffer per value or package | 16777216 bytes |
| later proposed physical batch | 32 present rows AND 1048576 raw units |
| later proposed one row bridge payload | 1048576 raw units plus <=65536 metadata units |

Derived item cardinality MUST equal 13*profileCount + 5 + dynamicCount + 1; checked arithmetic before multiplication/allocation. Incompatible simultaneous maxima refuse; no claim every individual maximum can coexist. Batch membership sorted greedily from next uncommitted present item, stop before either max; a row larger than the proposed batch/bridge bound refuses physical readiness, not chunked/truncated. These last physical budgets are proposals only; real native/delivery measurement/adoption still unavailable and cannot limit already-allocated future bridge input retroactively.

Parsing/allocation strategy: typeof first, .length before slicing/JSON.parse; scan characters with a bounded iterative stack, never recurse unboundedly. Track depth, per-container membership, decoded property names and duplicate names (including escaped aliases), string decoded lengths, edge counts and checked running totals DURING scanning. Reject a string before allocating decoded content beyond budget; decode bounded chunks, not repeated quadratic concatenation. Check raw escaped token extent against total wire bound too. Scan numbers lexically; only canonical unsigned decimal at numeric fields, at most 16 digits then guarded digit accumulation using n <= floor((MAX_SAFE_INTEGER-digit)/10); enforce field-specific maxima before loop/allocation. Never allocate using declared counts, array lengths or cursor positions before validation. Duplicate member detection applies to EVERY structured JSON object including supported identity raw; sporting raw stays opaque and is not parsed by the outer scanner.

After syntax admission build an owned null-prototype tree using data properties only (no __proto__ mutation), with the same limits rechecked. One parse tree, no generic JSON.parse of the hostile wire before the scan. An implementation may combine scanner and bounded tree builder; it may NOT claim that a post-JSON.parse length check is admission. Arrays capped incrementally; reject unknown closed fields before allocating large unknown payload branches where possible. Checked addition uses a <= limit-b guard before every addition; checked multiplication uses a <= floor(limit/b). Precompute T and canonical output sizes without materializing buffers; cap before allocation; then fill one exact buffer at a time. No declared count can drive an empty-body huge allocation. Bounds cover owned decoded/code-unit and byte payload sizes, not a measured exact JS heap ceiling/GC overhead or input allocation already incurred by the caller. Pure-string entry cannot undo a future bridge/stream allocation. A streaming bounded delivery reader is a separate unavailable later boundary.

Identity inner scanning shares cumulative work admission with the outer operation, charging raw units AGAIN when decoded as structured identity; if combined decoded budget would be exceeded, refuse, never skip validation. Pure C7 state strings contain no sporting values and additionally cap at 65536 units. Oversize/key/depth/provider errors never include input text.

#### C6 — Preservation, domain interpretation, recovery and usability are separate

Codec success = envelope valid, complete stored inventory within the declared exclusions, raw code units preserved against injected fingerprints. It returns semanticStatus `not_evaluated` as separate caller interpretation, never a writable-workspace result. In S2 there is NO loader/overlay integration or supported-usable oracle: C7 receives unavailable semantics and refuses publication. This makes pure S2 executable now without pretending domain compatibility is implemented.

Later semantic evaluation must use actual domain validators/loaders in a DISPOSABLE overlay seeded from immutable staged raws. The read map is frozen. Overlay set/remove operates only on a private copy, returns real overlay-local acknowledgements and audits every attempted key/value/write-order/read-after-write; it never lies that source/staging changed. Unknown key/out-of-Profile write refuses the evaluation. Denying all writes then accepting loader fallback is prohibited. Compare before/after identity/membership/content and explicit quarantine/drop facts; loader `value` alone is insufficient. Throw/reject/read_failed, present-to-absent/default, dropped/renumbered member, unknown version, audit outside named recoveries => preserved-unusable. Permitted recovery remains a PROPOSAL for later review, not S2 code or runtime migration permission. Source and authoritative staged bytes stay identical even if the isolated overlay can represent an interpretation.

| domain slots | raw validity and real loader risk | supported interpretation / permissible load-only recovery | usability result |
|---|---|---|---|
| current Session | present malformed JSON can become absent; sessionRepository:141–170; measurement/exercise validation required | actual migrateSession, compare IDs, blocks/shots/notes/measurement/exercise snapshots and all fields; ONLY intentional running-capture -> paused-on-load recognized, no arm/resume callback | any other repair/default/membership loss => unusable; recovery_paused remains distinct |
| Session history | :182–207 can convert malformed into absent or migrate/drop records | real history load, order and all session/shot identities preserved, terminal exercise checks, no generated IDs | malformed/partial/drop => unusable |
| filters | historyFiltersRepository:31–43 sanitizes or returns absent | JSON-valid exact supported filter shape; require sanitizer output semantically identical to parsed input (property order immaterial for interpretation only); no default replacement | sanitization/default => unusable |
| combined/draft/history Assessment (joint group) | repository:91–188 reads three keys; malformed combined can be absent; :60–87 clears duplicate terminal draft; may split-write missing halves | all absent = explicit empty interpretation only; full split validates both; combined-only/partial needs source combined and EXACT existing-half matches; overlay permits ONLY existing history-first split writes and exact terminal duplicate clearing; compare all run/attempt/protocol/snapshot/history identities and currentRunQuarantined false | malformed/unsupported/quarantined/dropped/conflicting => unusable; successful overlay recovery => recovery_required, NOT automatically writable until reviewed postpublication normal owner handoff |
| Training Plans | repository:76–125,145–171 deliberately lossless membership | supported schema 1/2, exact plan/step identity/order and historical immutable snapshot resolution; actual migration only, no new ID | configuration may remain readable but unexecutable; distinguish library-readable from executable; drop/rename/unresolved => unusable |
| tolerance profiles | repository:53–74 protects unreadable; storedStateValidation and migration own quantity rules | actual supported schema-1 time -> schema-2 interpretation only, original raws unchanged; all template/default identities and quantity preserved; never seconds->speed | unknown quantity/schema/member/default loss => unusable |
| random profiles | repository:42–48 malformed->absent, migration can normalize | supported schema 1, ranges/mode/member/default must remain semantically equal under actual migration | fallback/default/drop => unusable |
| show-introduction | repository:45–55 maps any non-true string false | for writable usability require exact literal true or false; other raw kept | unsupported string => unusable, not false grant |
| threshold preset | :62–73 maps unknown to standard | exact standard/tight/custom only | other raw kept unusable |
| custom threshold | :82–106 empty->absent or malformed->null | present must be duplicate-free JSON supported finite numeric onTarget/acceptable exact supported shape; empty distinct from absent; no fallback null | malformed/empty/unsupported => unusable |
| entire cloud-sync raw | syncStateRepository:93–408, no projection reconstruction | actual supported schema 1..6 interpretations with exact entry identity/payload/hash/status/relation preservation; v5 owned-result interpretation may add only the existing explicit originalResult/revisions/isVoided defaults, never overwrite raw; no data loss or unknown extras | wrong recorder/owner, missing field/drop/unknown schema => unusable; historical compatibility recovery distinct |
| identity/legacy archive | C2 confidentiality and exact forms, not normal live identity loads | NEVER invoke destructive grant cleanup/replay from archive; evaluate deny facts separately under C9 | archive-valid != admitted |

Whole sync raw includes personal entries with desired present/deleted, tombstones, opaque payloads/digests/statuses; teamEntries with parent/child linkage, blocked reasons; eligibility cache; active recorder draft; owned original/current/void/results/revisions/corrections/privateNote. Preserve empty Team coordinationPayload/resultPayload ONLY when synced; pending/blocked remain nonempty as actual parser requires. Personal desired-present remains NONEMPTY even synced; deleted has empty payload but retains identity/hash. See syncStateRepository:100–107,153–195,215–236; teamExerciseRecords:46–73,618–690. Never reconstruct owned results from upload payloads, which omit recorder/privateNote (:798–880). For namespace A, active draft recorderProfileId and owned cached result athleteProfileId MUST equal A (syncManager:218–235). Other roster athletes/bundle participants/recordedBy references may legitimately differ and MUST NOT be reassigned or blanket rejected. Cached permissions never grant server authority. Server-only results/notes not locally present are not claimed exported.

Historical readiness is a separate result: exercise Version IDs AND full immutable snapshots, measurement protocol id+version+snapshot, and diagram asset IDs including superseded/retired must resolve against complete historical catalogs/delivery inventory, not current visible lists. Primary: trainingPlans/migration:145–151; exercises/lookup:21–55,68–75; executionValidation:140–145,264–270; restrictedAssetCatalog:88–115. Missing historical content => preserved-unusable, not substitute current Exercise/diagram or fetch in pure tests. Source catalogContractId is provenance label, not proof of actual destination content. Overlay/historical evaluation integration lies outside the six S2 files and remains a later S4 readiness prerequisite.

#### C7 — Pure atomic decision model (TR-05, IT-12)

S2 decision inputs describe observations; they do not create a real lease, auth proof or storage authority. Two disjoint request variants, all fields closed:

`{schemaVersion:1,kind:"atomic",boundary:"intent"|"batch"|"verify"|"publish",mode:"warm"|"cold",call:"not_issued"|"own_uncommitted"|"pending"|"settled_unknown"|"confirmed",owner:"current"|"stale",observation:"unobserved"|"unreadable"|"exact_before"|"exact_after"|"mixed"|"rows_without_cursor"|"cursor_without_rows"|"foreign",confirmedEvidenceLost:boolean,reopen:"not_required"|"unconfirmed"|"fresh_confirmed"}`.

Output Decision EXACT `{kind:K,mayIssue:boolean,mayPublish:false,mayMount:false,ownerMustRemain:boolean}`. K closed: `not_issued`, `rollback_own_uncommitted_only`, `waiting`, `evidence_required`, `guarded_retry_candidate`, `completed_candidate`, `fault_held`, `target_conflict`, `blocked_stale_owner`, `readiness_unavailable`, `blocked_q2`, `no_portable_identity_grant`, `stale_snapshot`, `historical_receipt_only`, `preserve_both_no_rollback`.

Precedence: pending => waiting/owner held regardless cancellation/time; positive warm confirmedEvidenceLost => fault_held (even latch persistence failed), except still-pending remains waiting with fault knowledge held and no new issue. Stale owner => blocked_stale_owner, no new issue; uncertain handle still held by real owner. mixed/rows_without_cursor/cursor_without_rows => fault_held; foreign => target_conflict. Unobserved/unreadable => evidence_required, not absent or fault inferred from ignorance. settled_unknown requires fresh_confirmed reopen before classifying; otherwise evidence_required/held. Exact after => completed_candidate (classification, not second write). Exact before and settled_unknown+fresh_confirmed => guarded_retry_candidate with mayIssue=false: caller must acquire a NEW current guards/transaction intent, never directly execute returned candidate. Confirmed+exact_before is warm confirmation loss => fault; cold has no remembered confirmed call and must reject such self-contradictory input. Cold requests MUST use call=not_issued and confirmedEvidenceLost=false, then durable exact before => guarded_retry_candidate, exact after => completed_candidate, mixed => fault. not_issued+warm exact_before => not_issued (mayIssue=false, later executor guards required). own_uncommitted => rollback_own_uncommitted_only ONLY with current owner, no COMMIT issued; no compensation of durable rows. No pure result authorizes an actual physical call; mayIssue stays false for every S2 outcome. For EVERY atomic result ownerMustRemain=true: the input lacks positive close/release/handoff evidence, so S2 never authorizes releasing any existing owner, including completed/retry candidates and stale callers (the actual current owner still holds it). For EVERY readiness result ownerMustRemain=false means this pure request owns no handle; it is NOT permission to release a handle owned elsewhere. mayIssue is false for every result. No owner is created by S2.

Exact evidence predicates for a later executor (NOT a supplied Boolean substitute):
- intent-before: J/selection/fault absent, no stage/archive rows, immutable original baseline of no sporting work plus only explicitly allowed fresh-auth metadata; after: exact J intent alone, all payload absent, same baseline.
- batch-before: exact J bytes at cursor n, exact committed prefix, ALL next-batch and later keys positively absent, archive rows matching same prefix; after: entire batch present exactly, cursor n+k atomically, no extras; k>0, deterministic C5 batch. Cursor is a number of PRESENT manifest items, not all slots. Absent slots stay covered in manifest, never fabricated rows. No rows without their committed cursor.
- verify-before: cursor=presentCount, exact J copying and all present rows, no unexpected rows; after: same rows, J verified carrying immutable semantic/catalog/readback evidence references; no ordinary publish.
- publish-before: exact verified J, unselected staging, exact auth/control baseline and fresh guarded proof; after: J published AND selection/receipt and complete ordinary sporting rows in ONE transaction; all archives remain inert. Detailed physical mapping is C8 candidate, not implemented.

Rows matching expected bytes with a positively absent cursor are **fault_held**, not verify/catchup. No preexisting equal row with no/different J becomes owned. This supersedes original IT-12. Credential-store item/cursor recovery is a DIFFERENT non-atomic protocol owned by the credential author; do not mechanically apply this transfer rule there. Unreadable/unobserved cursor => evidence_required with owner held, never catchup or positive absence.

Second request: `{schemaVersion:1,kind:"readiness",package:"invalid"|"valid",source:"frozen"|"stale"|"unavailable",target:"clean"|"same_transfer"|"conflict"|"post_publication_mutated"|"has_new_work",request:"publish"|"access"|"rollback"|"inspect",proof:"unavailable"|"imported_trusted"|"q2_forbidden",semantic:"unavailable"|"unusable"|"candidate",receipt:"none"|"shared_only"|"external_verified"}`. No active auth-success/physical-ready value exists in PURE S2. Invalid package => invalid_input; target conflict => target_conflict; rollback with has_new_work => preserve_both_no_rollback; post_publication_mutated+inspect => historical_receipt_only; stale source => stale_snapshot; q2_forbidden => blocked_q2; imported_trusted => no_portable_identity_grant; other has_new_work requests => target_conflict; EVERY remaining admitted request INCLUDING rollback (clean, same_transfer or post_publication_mutated) => readiness_unavailable. For every successful readiness Decision mayIssue=false, mayPublish=false, mayMount=false, ownerMustRemain=false; this request owns no handle and cannot release another owner. The fallback adds NO rollback authority. For own_uncommitted, after stale/mixed/foreign/unobserved checks, only exact_before is admissible and yields rollback_own_uncommitted_only; exact_after is invalid_input because no committed after can be attributed to an unissued COMMIT. Validate cold-call restrictions before applying pending precedence. Any atomic confirmed+exact_before in warm yields fault_held. No owner-consent bit can bypass Q2. A separate live integration is required to produce real evidence and cannot be added to S2 by changing a test fixture.

Readiness ordered total mapping (first applicable rule wins):
1. package=invalid => Result `{ok:false,code:'invalid_input'}` (no Decision).
2. target=conflict => target_conflict.
3. request=rollback AND target=has_new_work => preserve_both_no_rollback.
4. target=post_publication_mutated AND request=inspect => historical_receipt_only.
5. source=stale => stale_snapshot.
6. proof=q2_forbidden => blocked_q2.
7. proof=imported_trusted => no_portable_identity_grant.
8. target=has_new_work (remaining requests) => target_conflict.
9. EVERY remaining admitted request (publish/access/rollback/inspect) => readiness_unavailable.
Rules 2–9 return exactly `{ok:true,value:{kind:<listed kind>,mayIssue:false,mayPublish:false,mayMount:false,ownerMustRemain:false}}`. The request owns no handle; false is never permission to release another owner's work. Semantic/receipt labels do not override precedence or add authority. No new readiness cross-field restriction is added.

Minimal fixture: `{"schemaVersion":1,"kind":"readiness","package":"valid","source":"frozen","target":"clean","request":"rollback","proof":"unavailable","semantic":"unavailable","receipt":"none"}` => readiness_unavailable with all four flags false. Future tests must invoke the real decideInstallationTransfer for EVERY combination of package(2) × source(3) × target(5) × request(4) × proof(3) × semantic(3) × receipt(3), and separately invalid/hostile inputs. The offline finite table audit here is SPEC coverage only, not an S2 SUT/transfer test. Include all formerly omitted non-stale/unavailable-proof rollback variants; postpublication mutation does NOT imply no new work or safe reversal.


### S6g — protected archive quarantine

Independent DESIGN PASS on 2026-10-26, including iOS-only refusal before engine work
and the actual-bundle-driven SQL installer extraction.
Corrected independent CODE and the full local regression are accepted. ADR-0054 records
the durable decision; this section is the canonical bounded technical specification.

## Exact bounded outcome

Implement a first actual native target prerequisite: positively acquire the SAME
database ownership registry, queue and handle as every existing adapter; accept
one actual S6e protected V3 archive into a mutually exclusive quarantine; classify
real commit/reopen/readback and cold restart. No ordinary records, identity/credential
metadata, selection, publication, source freeze, authentication or runtime admission.
All public results mayIssue/mayPublish/mayMount:false. This accepts only this new
quarantine slice, not C8–C10 or the existing five-table candidate as a whole.

The local training-only JSON backup is NOT a V3 archive (it intentionally excludes
identity/deny archives). Never fill its missing identity evidence with fabricated
absences, feed it to the old WebView runner or claim a supported import of that file.
Actual source/archive delivery and fresh-auth/source-deny mapping remain separate.
Free pilot/Team != Personal, source preservation, Q1/Q3 and deferred Q4 unchanged.

## Scope

- nativeSqliteAdapter.ts: one private installation-mode hook inside the existing
  buildNativeSqliteStore; one new exact internal factory and private context type.
- installationTransferQuarantine.ts: actual protection orchestration and lifetime.
- installationTransferQuarantineSql.ts: concrete exact discovery/SQL installer on the
  SAME existing core; dynamically loaded only by the new owner.
- installationTransferQuarantineWork.ts only if needed for boxed observed-work
  ownership shared exclusively by the new owner and its SQL installer; no general app API.
- New focused actual SQLite/crypto/lifetime tests; precise existing architecture
  and mobile ANY-mode bundle guard changes; canonical §S6g, Readiness and short
  architecture ADR/index/references after independent DESIGN PASS.
No legacy algorithms/observers/SQL transaction semantics, platform binding fork,
common owner/source/runner/borrow/identity/SDK/composition/UI/default changes.

## Public private-owner surface

createInstallationTransferQuarantine(options) takes the existing trusted native
construction choices (databaseName, optional existing engine/platform test seam).
It constructs inertly, with no engine/global crypto/native I/O. Returns a frozen
null-prototype owner with inspect(), stage(protectedWire:unknown,recoveryCode:unknown)
and close(). Never expose the SQL context, rows, source values, digest/IDs, plaintext
wire, recovery code, ordinary adapter, connection or generic transaction operation.
Only tests call it in this stage; no app/mobile caller. SQL context constructor is
called dynamically only by this new owner. Stage accepts primitive bounded strings
only; no input getters/coercion/serialization. Actual openInstallationTransferV3
authenticates/decrypts and validates V3; packageDigest comes only from that exact
result, never a caller claim. No re-encryption/new key. Code/plaintext are never
persisted, logged, diagnosed or returned; JS strings have no secure-erasure claim.
Invalid/corrupt/wrong-key input refuses without creating a target schema/rows.

Codes are fixed only: empty, quarantined_unverified (structural observation only),
quarantined, already_quarantined, invalid_input, archive_refused, unavailable, busy,
target_conflict, outcome_unresolved, fault_held, closed, cleanup_held. Keep domain
usability/auth/activation out of these labels. Successful stage/readback is a local
quarantine acknowledgement only, not external transfer receipt or publication.

## One exact physical layout, ASCII protected bytes only

Use the SAME requested database, NOT a side database/new engine/parallel registry.
Exact solitary application object (internal SQLite objects excluded only as in the
existing discovery query):

CREATE TABLE installation_transfer_quarantine_v1 (singleton INTEGER PRIMARY KEY CHECK(singleton=1), protected_wire TEXT NOT NULL, package_digest TEXT NOT NULL)

No IF NOT EXISTS, extra index/trigger/view/table, metadata in ordinary records,
column defaults, migration/repair or automatic coexistence. Verify exact DDL,
table_info (three columns, singleton pk1, TEXT nonnull), empty index_list and
schema_version before/after full discovery. Genuine empty database is allowed.
An exact quarantine table must contain exactly ONE row, singleton1, bounded strict
S6e ASCII protected-wire grammar and lowercase64 digest. No row/extra/malformed
row is conflict/fault, never empty. Existing records/credential D/Q/F layouts—even
empty tables—are refused by installation mode. Existing ordinary, diagnostics,
legacy D-only, credential, combined-held and common factories remain unchanged and
must refuse the quarantine layout before any bootstrap/default write.

The stored wire is exact encrypted ASCII from S6e (header,16-char nonce, strict
base64url body within the existing S6e bound); package digest also ASCII. No direct
plugin TEXT storage of arbitrary UTF-16 source raws. Later sporting row encoding/
publication requires a separate adopted design. Real SQL tests must prove ASCII
roundtrip and the actual constraints/transaction behavior; physical plugin/storage
durability remains a separate gate.

## Shared core extension, preserving default bundle exclusion

Do not create an alternate store implementation. Add a PRIVATE optional installer
to buildNativeSqliteStore, available only to the new internal quarantine factory.
It gets core-only functions for enqueue, real lease acquire/check/phase, open,
reopen and positive release. No installer/SQL/ports in public options. The returned
quarantine context is never on the ordinary/credential/common public surface.

The core's existing ensureConnection uses the installation-mode exact discovery
hook BEFORE pragmas/bootstrap and on every reuse; no ordinary records bootstrap
in this mode. Open/close/native-handle-release use the existing actual engine and
registry. Only the new factory supplies these hooks. A private platform predicate restricts
this new mode to iOS: Web, Android, unsupported or failed platform detection refuse
before engine resolution, connection creation or opening. All existing factories
retain their current platform behavior. Keep the concrete SQL/state
logic in installationTransferQuarantineSql.ts, which passes the private installer
to the existing core's internal factory. That adapter export contains only the
generic internal construction hook, no concrete quarantine SQL/work implementation.
The new owner dynamically imports only the SQL installer. This is necessary because
the actual native-storage dynamic namespace keeps otherwise-unused adapter exports
(the Default/Diagnostics builds did exclude the original concrete factory, but the
native-storage bundle guard found the quarantine marker). No existing composition
change, sideEffects:false or global tree-shaking exemption. Pin exact factories/callers and a nonvacuous quarantine
marker absence in all three actual normal modes.

## Atomic insertion, observed outcomes and monotone evidence

One complete protected artifact, no batching/cursor or ordinary publication in this
slice. One queue task: reserve real lease, observe complete empty baseline, BEGIN,
re-observe exact empty layout INSIDE transaction, CREATE exact table, bound INSERT
singleton1/wire/digest (transaction:false for every statement), positively validate
the complete exact post-state inside the transaction, then COMMIT. No upsert/update/
delete/drop. Schema creation and row are one transaction; no legitimate empty-table
state exists. A concurrent external writer causes a real SQLite/precondition failure,
not overwrite. No caller-supplied SQL or consent bit.

All issued calls are awaited through actual settlement. Before BEGIN: no issue
means no transaction. Once BEGIN issued without positive acknowledgement, retain
requires_reopen; never assume no transaction. Before COMMIT issuance, only own
positively begun uncommitted work may roll back. After COMMIT issuance NEVER issue
rollback or compensating delete, even on cancellation/rejection/malformed receipt.
Positive ACK alone is not final storage evidence: close -> positive native handle
release -> fresh open -> complete exact schema/row readback on every staged commit.
This is an engine/readback result, not power-loss or physical iPhone evidence.

Readback exact after => quarantined; exact before (truly empty database) after an
unconfirmed commit => outcome_unresolved/not-staged, with no automatic retry in that
operation. Mixed/foreign or confirmed commit followed by before/missing/different
data => sticky fault_held. Every later full observation must match the first
positively observed supported record in that lifetime; disappearance/change is
never a new empty target. No automatic clearing or evidence deletion. A second
stage of the identical wire+digest after actual authentication and fresh observation
returns already_quarantined, without write. Any different wire, including a fresh
encryption of the same package, is target_conflict; preserve it. No raw resolver.

Cold inspect classifies supported durable bytes structurally only and returns
quarantined_unverified; it does not recreate a warm confirmed ACK or verify AES.
Actual stage with matching supplied code/input can re-establish private actual
authenticated equality. Cold corrupt/unknown/unreadable structure refuses. No
memory-based intent is invented and no partially prepared schema is repaired.

## Lifetime, work and cleanup

Install one owned operation before dynamic imports/crypto/native work. One inspection
or stage at a time; concurrent calls return busy, never queue new import work. Close
synchronously revokes new work; calls while an operation/close is pending join only
the appropriate existing work (no self-deadlock). Retain real registry/lease during
pending SQL/crypto/open/close/release; no timeout, cancellation-as-settlement or
unsettled-failure unlock. After each await and before every issued native call,
recheck the owner's current lifetime. Exact helper-own work is excluded only from
observation completion, never admitted as a positive value/ACK.

Use actual boxed observePlatformWork and completion-only drain for newly observed
potential work, with per-operation memoization. Safe own descriptor metadata:
retain descriptor value/get/set before validation; do not invoke getters or inspect
opaque reasons. Bounded result arrays/rows; validate fields immediately and refuse
before later fields after a known failure. No invalid native result becomes empty
or a positive transaction/close receipt. Underlying trusted native engine/options/
module-bootstrap cooperation retains the existing C4 hidden-work/cycle limitations;
do not claim arbitrary provider attestation or rewrite old observers.

Close waits for already issued operation/crypto work. If COMMIT was issued, required
cleanup may perform only its positive reopen/classification before release; this is
explicit cleanup, not resumed staging. A pending call holds close indefinitely.
Close/release/reopen failures return cleanup_held/outcome_unresolved and retain the
owner; a later explicit close retries cleanup only. Repeated close while pending
joins the same promise. Sticky fault may positively close/release the native handle
but MUST keep the logical registry reservation in this context (fault_held); no new
ordinary/second importer can bypass it until process reset. A clean positive release
can drop the lease but never claims an unresolved commit was absent. No cleanup
operation deletes schema/data or touches the source/credentials.


Verification: actual disposable SQLite plus actual synthetic S6e/V3 crypto; exact schema, transaction uncertainty, cold restart, lifetime and old-mode exclusion. Physical device evidence is separate.


### S6h — actual native sporting preparation

Independent DESIGN, corrected scoped CODE and complete local regression PASS
2026-10-26 under the continuing full import/fresh-auth mandate. This stage supplies
no publication or auth grant. Verification evidence: TESTFLIGHT_READINESS.md.



Authenticate S6e, validate actual V3, actual domain loaders and historical catalog,
then atomically materialize every PRESENT sporting raw into the SAME actual native
SQLite database beside its exact encrypted quarantine. Preserve every absent slot
in the encrypted archive; no implicit defaults. Identity/legacy remain only in the
encrypted archive and never enter sporting rows. All public mayIssue/mayPublish/
mayMount:false. No profile/auth/source authority, ordinary records, selection,
credential pairing, source retirement or app mount. Full end-to-end goal remains
in progress after this stage; it must not be reported complete.

## Actual ownership and scope

Extend the existing concrete installationTransferQuarantineSql implementation with
one private preparation-mode constructor. It uses the SAME adapter core, registry,
queue/lease/connection and accepted S6g work helper. No second owner/store/engine,
parallel registry, SQL in app modules or public construction option flag. Existing
S6g factory remains exact single-quarantine-only and refuses preparation layouts.
Other existing factories continue refusing all transfer layouts before writes.

New dormant owner installationTransferPreparation.ts has inert factory with the
existing trusted native options; prepare(protectedWire:unknown,code:unknown),
inspect(),close() only. Same null-prototype/frozen bounded code-only/all-false
result, one operation/busy, synchronous revocation, whole-work join, cleanup retry,
fault logical reservation semantics as S6g. New owner dynamically constructs actual
SQL context for prepare only after actual cryptographic/semantic/historical admission.
Cold inspect may construct this context for structural-only observation without
wire/code; that never creates authentication/semantic evidence or a write grant. It does
not accept supplied parsed data/manifest/digest/readiness/callbacks.

Old source crypto/codec/domain/catalog algorithms unchanged. Derive sporting rows
ONLY from actual decoded V3 after actual same-wire domain/historical checks and
same packageDigest. Each prepared value_digest is copied exactly from that actual
validated V3 item.valueDigest; no new digest/preimage contract is introduced.
preserved_unusable or not_evaluated => refuse preparation;
recovery_required may be staged unchanged with an explicit fixed recovery-required
status (never publication permission). No semantic overlay writes are copied back.
All profiles must have supported actual historical findings. Zero-Profile archive
can prepare an empty sporting set only, never invent namespace/admission.

## Versioned exact ASCII/codeunit storage

New private installationTransferCodeUnits.ts encodes primitive bounded strings as
`u16:` + four lowercase hex digits per original UTF-16 codeunit. Exact inverse,
including NUL, combining sequences, lone surrogates, supplementary pairs and CR/LF.
Reject nonprimitive/malformed/noncanonical/oversize before allocations. No TextEncoder
replacement/normalization/JSON reconstruction. This is storage encoding, no crypto.
Normal imported runtime read/write will later use this exact representation; old
legacy records are unchanged and this stage exposes NO ordinary adapter.

Same existing quarantine DDL/one-row exact cipher+digest plus two exact tables:

CREATE TABLE installation_transfer_prepared_v1 (singleton INTEGER PRIMARY KEY CHECK(singleton=1), package_digest TEXT NOT NULL, row_count INTEGER NOT NULL CHECK(row_count>=0))
CREATE TABLE installation_transfer_sporting_v1 (slot INTEGER PRIMARY KEY CHECK(slot>=0), key TEXT NOT NULL, value_ascii TEXT NOT NULL, value_digest TEXT NOT NULL)

Only valid layouts: truly empty; S6g's exact single full quarantine; OR all three
exact tables with quarantine row, one prepared row digest equal quarantine digest,
row_count 0..416 and exactly that many sporting rows ordered slot=0..n-1, strictly
increasing unique supported sporting keys, primitive exact ASCII codeunit encoding,
lower64 actual value digests. Actual decoded manifest equality is checked only on
authenticated prepare; cold inspect structural only, prepared_unverified. No normal
records, credential tables, unknown object/index/trigger/view/default/partial or
empty quarantine/meta. Exact DDL/table_info/index absence/schema_version stability
and strict early per-field work validation. No virtual hidden metadata.

## Atomic actual SQL operation

First authenticate/validate entirely in memory, acquire existing mode lease and stage
actual envelope by reusing the accepted S6g algorithm INSIDE the SAME preparation
SQL context/lease (no re-encryption), full positive reopen. Never call a public S6g
owner and then hand over to a second owner between transactions.
Then one transaction checks exact quarantine-only before; creates both new tables;
bound insert each derived sporting row (transaction:false); insert one prepared
singleton/count/digest; full exact in-TX after-state read; COMMIT. All statement and
query metadata use actual strict observed-work/early-validation helper. Extend only
its insert ACK with an exact expected-lastId parameter (existing default1 unchanged):
sporting row slot0..n-1 expects that exact rowid, prepared/quarantine singleton1
expects1. Preserve count/values/metadata validation and early failure order. Every call
checks lifetime before issuance and after await. No upsert/update/delete/drop/CAS
repair or compensation. All rows + complete manifest count are atomic; no cursor,
partial batch or published ordinary row exists in this stage.

After any issued TX complete actual settlement. Precommit rollback only own
positively begun work; drain rollback metadata before any physical cleanup. Never
rollback after COMMIT issuance. Always positive close/release/fresh open/full readback.
Expected exact after => prepared (or prepared_recovery_required); unconfirmed COMMIT
plus exact before quarantine-only => outcome_unresolved/no automatic retry. Confirmed
COMMIT then before, any changed tuple/row/extra/missing, lost prior positive supported
state => sticky fault retained even after physical cleanup. Unreadable unknown result
retains pending outcome; explicit close retries classification/cleanup only. No new
inspect/prepare opening on stale/uncertain handle until explicit cleanup.

Every complete durable discovery pins both quarantine and any prepared complete row
set; never pin own uncommitted preparation. Previously observed prepared rows may
never silently disappear or change. Authenticated equal plan => already_prepared,
no second write; different ciphertext/package/rows => preserve and conflict.
S6g inspect sees prepared tables as conflict; dedicated S6h cold inspect sees only
structurally prepared_unverified; matching actual reauthentication re-establishes
exact row equality, not a warm intent/auth admission. Public results have no raw,
key/ID/digest/code/connection/port or username. Recovery code and the full decrypted V3 wire are neither persisted nor logged.
Prepared sporting raws ARE persisted reversibly as u16 ASCII; this is not encryption
at rest. Identity/legacy stay encrypted; no secure-erasure claim for JS strings. No native physical fidelity claim
beyond actual SQLite ASCII roundtrip/engine receipts.


### S6i — actual fresh destination pairing

Independent amended DESIGN, corrected scoped CODE and full local regression PASS
2026-10-26.
All grants remain false; full import/fresh-auth mandate continues.

## Outcome and stage boundary
Actual archive authentication/domain/history admission -> same actual core S6h
preparation -> fresh empty Keychain namespace proof -> new immutable SQL intent ->
actual empty manifest M write/readback -> atomic SQL binding. No source credentials,
Dactive, existing legacy migration runner, identity authority, ordinary rows, auth SDK,
runtime pair, UI, source retirement or publication. Public bounded code-only reports
keep mayIssue/mayPublish/mayMount:false. Host alone will resolve real configuration in
next linked stage; this internal owner accepts same trusted config/root and synthetic
protected binding test seam as existing combined owner, never supplied pair/ready fact.

Next stages remain authentic identity-only draft/host, actual deliberate OTP proof,
source-deny/deletion handling, atomic publication and source-free handoff, UI/device gates.

## Immutable new transfer anchor (explicitly replaces D for newmode only)
Retain all3 S6h tables unchanged. Add exact SQL:
CREATE TABLE installation_transfer_pair_v1 (singleton INTEGER PRIMARY KEY CHECK(singleton=1), package_digest TEXT NOT NULL, intent_q TEXT NOT NULL, manifest TEXT NOT NULL)
CREATE TABLE installation_transfer_binding_v1 (singleton INTEGER PRIMARY KEY CHECK(singleton=1), package_digest TEXT NOT NULL, bound_q TEXT NOT NULL)
Valid layouts are S6h layouts plus exact4tables (prepared+intent) or5tables
(prepared+intent+binding); both paired rows singleton1/digest equal quarantine.
No empty/partial/extra objects/index/trigger/view/default. Exact DDL, table_info,
index absence, stable schema version; strict field validation before later metadata.
Use immutable insert-only tables to avoid UPDATE receipt ambiguity. No general
credential_meta or records schema yet. Future actual domain anchor reads these
new versioned rows explicitly, never synthesizes {kind:active} to correlatePair.

Private installationTransferPairProtocol.ts parses bounded primitive Q/M wires using
actual parseQ/parseM and actual fingerprint format, requires EMPTY initialEntryKeys,
verifiedItemIds/items and every actual fixed credential slot absent. Qintent.phase
intent and expectedStoreIdentity; Qbound.phase bound and storeIdentity. All actual
header IDs/config/root/SID correlate exactly with M and with each other. Compare
all HEADER fields explicitly, no fake D tuple or changes to legacy correlatePair.
Canonical actual serializeQ/serializeM output only accepted for owned new rows;
input fully validated without invoking any arbitrary getters/coercion. M has no
source data/credentials. New protocolId/epochId/manifestId/SID are distinct actual
crypto.randomUUID values (no Math.random fallback/injected ready evidence).
Cold structurally paired is unverified until real same-archive prepare+auth again.

## Same core and transaction/lifecycle
Extend existing shared quarantine SQL builder with private pairing constructor,
not public options mode flag. New internal context can return bounded validated
pair snapshot to owner (never public result); it derives/accepts only authenticated
prep rows via same private S6h steps. No public S6h owner handed off to another owner.
All state equality/drift pins include pair and binding; only own exact transaction
may transition. Accepted S6g/h factories reject new layouts; old factories refuse.
Initial intent transaction: exact before prepared + no pair; create pair table,
insert singleton intent bound to package; full in-TX exact read; COMMIT; positive
close/release/fresh open/readback. Binding analogous exact intent -> bindingtable
with boundQ. Actual strict ack(lastId1), work draining, cancellation, rollback before
COMMIT only, unknown COMMIT classification and sticky drift same S6h. First complete
durable read (including exact before) pins outcome; no later upgrade/auto retry.

## Actual Keychain flow
Inert private pairing owner pair(wire,code),inspect(),close(); same busy/revoke/join
semantics. Archive/domain/history rejection before any native work. Actual existing
NativeCommonCredentialMigrationPort and actual namespace owner; no custom secure
store/crypto. Configure fixednamespace no-sync/device-only via existing port.
Acquire SQL preparation lease, then actual protected namespace lease. Fresh state:
complete namespace inventory must be [] AND manifest slot positively absent before
ANY pairing intent write. Any orphan M/I/unknown/foreign key => Q2fault, preserve;
unavailable read/inventory => unavailable/retained hold, no fabricated absence.
Generate expectedM/Qintent only after complete empty proof; persist intent. Then
reinspect complete namespace and actual manifest slot before insert. Intent coldresume:
namespace []+positive manifest absent -> actual insert exact expectedM, acknowledge
and exact readback; namespace [exact configured Mslot]+exact expectedM -> no rewrite.
Every other inventory/value => stickyfault. Issue binding only after complete exact
manifest inventory/read proof. On paired coldresume M must already exist EXACT, no
manifest re-create if absent. No I exists this stage (runtime not published).
Re-read M + complete inventory after SQLbinding durable reopen; no success on drift.
All warm observations pinned including empty namespace/absence; own insertion is
only approved transition. A failed/ambiguous protected write never silently retries;
existing port faults/holds apply. Cancellation after intent leaves resumable durable
intent but never reports ready. Outcomes remain code-only/allfalseflags.

## Paired cleanup ownership
Do not release either logical owner while other physical cleanup incomplete.
Add narrowly internal authenticated cleanup draft for genuine migration port using
WeakMap membership, prepareRelease/releaseReady/retire of actualnamespaceowner. No
caller-asserted receipt. It revokes portrole synchronously; joins/drains namespace,
retainslogicalowner onfault. Retry only unfinished cleanup; never resurrect migration.
SQL context cleanup first closes+releases physical handle with keepReservation=true,
then yields genuine receipt; internal synchronous retireLease only if exact lease,
physical flags false/connection null/current sameowner. Old behavior unchanged.
Pair owner close revokes at call time, joins ownpending, obtains both receipts;
only if both authentic/current and neither faulted, synchronously retire BOTH.
On uncertainty/fault retain both logicalholds, retry cleanup only. No public force
unlock/reset, and no new ordinaryadapter/connection/port escapes.
If no protected lease was acquired, ordinary S6h SQL cleanup semantics suffice.

## Files / evidence
Allowed shared SQL builder/work if needed, narrow nativecore cleanup seam,
nativeCredentialMigrationPort private release WeakMap, new pairprotocol/owner,
shared actual preparation admission helper if duplication avoided, precise graph
tests, real SQLite+actual crypto/fakeBridge protocol tests, mobile boolean guards,
canonical migration/readiness and ADR if durabledecision warrants it.
No apphost/composition/SDK/source/helper changes in S6i.
Tests: all phase/schema/mismatched Q/M/SID/config/package cases; all fixedslot
absences; new vs orphan; intent resumes manifest absent/present exact; bound missing
M fault/no repair; unknown/foreign I; wrongarchive zero I/O; samearchive idempotent;
busy/close/reentry/cancellation; actual SQL lostACK/rollback/uncertain/drift/cold;
both cleanup orderings fail/retry/no partiallogicalrelease; old modes refuse;
standard globalplatformcrypto and realSQLite synthetic only. Full baseline per repo.

Evidence boundary: namespace/SQL leases order participating callers in this JS
context only. Repeated complete inventories and exact reads detect observed drift;
no cross-process lock/snapshot/physical atomicity across SQLite and Keychain claimed.
Operational writer exclusion remains required before touching actual source/target.
Paired inspect itself remains SQL structural-only and must not acquire/issue
protected I/O or change role. Owner pair validates configured config/root against
any observed anchor before protected work; a mismatched supplied config preserves
and returns conflict, never writes a replacement M/intent.

## Required independent DESIGN corrections (adopted 2026-10-26)
1. Extend the actual internal credential-port observer with optional insertIssued
   event. Capture once alongside existing observer methods. Invoke after the
   pre-read's established absence and immediately before native write; recheck
   permission after callback before write. Parent owner arms only exact expected
   M at this actual issuance event. A value in the fresh-insert pre-read faults;
   no `already_present` success in that branch. Only actual `verified` return can
   accept the own transition. Cold resume observing exactM remains separate.
2. Include nativeCredentialNamespace.ts in scope. Add internal healthyReleaseReady
   predicate requiring exact holder identity, lease, receipt, releasing AND !faulted.
   New genuine migration cleanup draft must use it after all joined work and at
   synchronous retire. Existing state/release/releaseReady/retire behavior unchanged.
   Both SQL and protected receipts must still be authenticated/current/healthy in
   the same synchronous section before retiring either logical owner. Faulted
   holders remain logically retained even when state() reports releasing.


Implementation notes for S6i: `installationTransferAdmission.ts` shares the actual
S6h admission pipeline with preparation and pairing without creating a second SQL
owner. `installationTransferPairProtocol.ts` validates canonical bounded empty Q/M
and explicit transfer binding; it captures the actual standard UUID method once
and drains directly observed malformed async returns without accepting them as IDs.
`installationTransferPairing.ts` constructs the actual protected port and private
pairing-mode SQL context. Normal code paths/defaults remain unchanged.
The new credential cleanup draft is authenticated by actual port WeakMap membership;
its healthy receipt uses exact namespace holder/lease/receipt and the retained fault
bit. SQL cleanup keeps its actual logical reservation until both receipts permit a
synchronous paired retire. These are model/desktop SQLite facts until physical
acceptance; CODE review and complete regression are still required.

S6i independent CODE corrections: validate each generated UUID immediately and
stop all further generation after a known invalid/duplicate result or private
lifetime revocation. Completion-cycle exclusion remains separate from currentness.
The existing native core's private quarantine hook now observes ORIGINAL open/
close/release work, requires exact undefined void acknowledgements and drains
observed malformed work before follow-up cleanup. It covers initial opening,
opening-failure cleanup, transaction reopen and release; ordinary/legacy void
acknowledgement behavior is unchanged. SQL cleanup authenticates both its exact
queued completion and returned wrapper as already-owned work, preventing a native
close returning cleanup itself from deadlocking. A later explicit positive durable
classification may clear transient readback uncertainty, but unknown COMMIT with
exact BEFORE and all actual faults continue retaining logical ownership.
Corrected scoped CODE review and full local regression are accepted; actual
verification evidence and limits are recorded in TESTFLIGHT_READINESS.md.


### S6j — genuine identity-only transfer runtime

Status: amended independent DESIGN, corrected independent CODE and full local
regression accepted. This continues the authorized import/fresh-auth
chain; it does not finish that chain or authorize activation.

The separate private `createInstallationTransferIdentityOwner` extends the actual
S6i owner, using its SAME SQL core/queue/lease/handle and actual already-owned
protected port/namespace. Existing pair-only construction remains exact-five-table
and refuses the new layout. Public pairing reports remain code-only/all-false.
Internal `handoff()` accepts no supplied draft, parsed archive, pair or readiness
facts. It requires this instance's actual authenticated archive/domain/history and
complete Q/M pairing. Cold rediscovery alone cannot grant access.

After complete positive Q/M proof, one empty destination identity table is added:

`CREATE TABLE installation_transfer_identity_v1 (key TEXT PRIMARY KEY NOT NULL, value_ascii TEXT NOT NULL)`

The only additional index is SQLite's exact
`sqlite_autoindex_installation_transfer_identity_v1_1`, with null sqlite_master SQL.
Full discovery verifies exact objects, table_info/index_list/index_info, complete
paired controls, stable schema_version and complete sorted identity rows. Initial
schema bootstrap uses the existing actual migration transaction plus positive
close/release/fresh-open readback. No source identity or credential bytes are
copied into destination runtime rows. Identity raws use the existing reversible
`u16:` codeunit representation; this is not encryption at rest.

Only actual `classifyMigrationSourceKey` membership in identity_fixed,
identity_barrier_resolution, identity_deletion_guard and identity_deletion_resolution
is admitted. Sporting/legacy/control/credential/unknown/nonprimitive keys are refused
before native I/O. At most 4096 unique ASCII identity keys, each at most 1,048,576
raw UTF-16 codeunits and 4,194,304 aggregate raw codeunits are supported. Full stored
snapshot reads use ORDER BY key LIMIT 4097; the 4097th row is positive overflow
evidence. Observed overlimit, malformed or drifting data blocks and is preserved;
there is no truncation, default, repair or billing quota. Projected input/capacity
refusals precede BEGIN and do not poison healthy source state.

The genuine session is created by `createNativeRuntimeSession`; the genuine domain
draft is made inside that same SQL installer. The existing actual WeakMap port
preparation produces the credential draft from its own verified bound Q/M. No fake
Dactive or correlatePair is used. The existing publisher authenticates SESSION
membership, not independent draft membership: all new construction stays in the
closed exact graph with NO caller-supplied drafts. A new internal transfer publisher
shares the private publisher build while leaving the old publisher's disposal
behavior unchanged. Both genuine ready checks precede synchronous activation and
single publication without awaits or foreign callbacks between role commits.

Only the positively observed complete identity-extended layout may contain actual
runtime I entries. Cold pairing requires complete namespace inventory and strict
actual parseI validation against the actual bound Q, physical epoch/key and exact
config/root/manifest correlation. Five-table pre-runtime layouts still refuse I
entries as orphan evidence. The manifest remains the historical empty manifest;
source credentials are never adopted.

After handoff the migration pair/inspect/bootstrap role is disabled; runtime lifetime
does not depend on a !transferred flag. Owner.close revokes synchronously and calls
the single already-published pair.dispose before awaiting pending work. If close wins
an unfinished handoff, join it, dispose any genuine late pair or abandon unactivated
genuine drafts back to migration role before migration cleanup. Never migration-clean
an already prepared/runtime protected port.

All domain get/set/remove/anchor operations use the SAME actual SQL FIFO. Credential
operations may hold the namespace queue while awaiting domain.anchor on the SQL
queue. No SQL queued task may await namespace work, its queue or a parent completion
waiting for that SQL task. Prepare/publication/final cleanup joins happen outside
both queues; domain methods enqueue their own direct SQL work without re-enqueuing
public context methods from inside SQL work.

Normal runtime identity writes use actual own BEGIN/statement/COMMIT with strict
acknowledgements, complete exact same-connection readback and immutable-control
recheck. New keys use insert only; existing values use exact old-value UPDATE or
DELETE predicates. Absent remove is a positively observed no-op. The separate
mutation ACK validator requires exact changed count, safe integer lastId and exact
empty values; the old S6g insert row-id requirements stay unchanged. Successful
normal writes never mark requires_reopen or physically reopen. Unknown issued work
immediately fails source health; even factual AFTER following a lost ACK cannot
become coordinator write authority. No post-COMMIT rollback. Positive cancellation
settlement gives no permission but does not invent a source failure.

Control generation (actual session/ready lease/SID/Q/M/schema role) differs from the
private identity revision incremented by own successful mutations. Own healthy
identity writes preserve unrelated credential anchors; later fresh-OTP publication
proof must additionally bind identity revision. Anchors are actual WeakSet cells
minted by full positive control reads. Currentness requires exact active owner,
actual ready lease, healthy session/domain/protocol and pinned schema generation.
True uncertainty, contradiction and close revoke rights synchronously.

Every native call observes original returned work with the real receiver and
currentness checks. The platform work observer has an optional private no-argument
source invalidation hook, propagated at first known malformed dependency/rejection/
then-field evidence BEFORE draining its async residue. Default observer behavior
and standard platform cryptography remain unchanged. Active validators fail source
health before draining; cleanup-only work supplies no source-failure hook. Runtime
evidence records actual reads/writes/removes, issue/ack/verification/control reads
and actual transaction flags without inventing success.

Domain close joins queued work and retries unfinished physical cleanup, retaining
its authentic receipt and logical SQL reservation. The actual credential draft
joins its namespace work. BOTH authentic healthy current receipts are required
before synchronous logical retirement. Cleanup-only physical failure is
cleanup_unconfirmed and retains BOTH owners without poisoning healthy data; only
that result is retryable. Source/domain/credential/protocol evidence held is never
reset or force-unlocked. The original publisher keeps its old behavior.

Allowed scope is the same private SQL installer/core, actual pairing/port/session
seams, narrow early observation hook, exact architecture/bundle guards and synthetic
real-SQLite/Keychain-bridge-model tests. No AuthHost/coordinator/composition/source
helper, SDK, ordinary sporting adapter, selected dataset, auth grant, source erase,
physical-device/configuration/hosted work or default activation is part of S6j.
The transfer-only credential preparation seam authenticates the genuine port via
its own WeakMap, retains and joins actual malformed preparation work, and excludes
only actual owner/publisher completions. The original synchronous legacy preparation
and publisher behavior remain unchanged. Both transfer runtime lanes recognize the
genuine publisher's disposal completion, registered before either cleanup lane starts;
excluded completion work is never accepted as successful storage evidence. Strict
values remain boxed across async boundaries and are unwrapped only synchronously
at validation. Already observed fulfillment values are retained as observed work,
so cleanup cannot assimilate them or read their then field a second time. This is
completion bookkeeping only: EVERY newly issued native return is observed afresh,
and all fresh observation completions are retained even for reused roots; a prior
fulfillment can never supply another invocation's value or acknowledgement. Method
capture validates each lookup before later getters; acquired malformed statement
work drains before rollback, using the previously captured rollback method. Complete
cold namespace addresses/configuration/epoch are validated before item reads.

Actual host integration, deliberate fresh OTP (not NativeProfileAdmission), immutable
source-deny evaluation, atomic sporting publication, normal handoff and UI remain
linked subsequent gates. Full local baseline follows corrected independent CODE;
no physical Keychain/iOS authentication, operative import or Beta approval is claimed.


### S6k — configured transfer identity host (locally accepted)

Independent amended DESIGN and corrected S6k1 CODE accepted (all nine new and
twelve previous adversarial witnesses plus eight focused files/768 tests,
TypeScript/scoped lint/diff). Corrected combined S6k2 CODE is independently
accepted: eight files/602 tests and all three actual-host, nine S6k1 and twelve
S6j adversarial probes, plus TypeScript/scoped lint/diff. The genuine host suite
has47 cases. Complete combined local regression and all three actual build modes
are accepted; current evidence and limits are canonical in TESTFLIGHT_READINESS.md. Required sequencing: S6k1 first: strict asynchronous
transfer-port capture/observation over the SAME actual port builder, namespace
owner and queue, plus the private host-only completion seam. Obtain focused
independent CODE acceptance before S6k2 actual configured host/SDK wiring. S6k1
completion-model witnesses are not genuine host acceptance. After combined CODE
acceptance run the full root/Web/mobile/three-mode/E2E/types/lints baseline.

The new dormant createConfiguredInstallationTransferIdentityHost must authenticate
the genuine configured-binding WeakMap before option reads or SDK reservation.
Its existing native migration/clock/UUID/limits/fetch/callback contract adds only
installationTransfer:{protectedWire,recoveryCode}; no config/provider/root override,
team-link delivery, supplied strategy/pair/draft/readiness or positive proof. Strict
per-field capture precedes later getters. Cryptographic admission is exclusively
the actual owner.pair; wrong code refuses before native/SDK/network work. Keep
recoveryCode ephemeral, clear its local reference after genuine handoff, never
persist/log/encode it. New callbacks receive a separately captured dependency
receiver without installationTransfer or a backreference, private configuration,
credentials or proof; do not copy arbitrary input fields. Legacy receivers stay.

The actual shared createNativeHost must use its same real configuration capture,
SDK reservation/AuthClient/ownedFetch/coordinator/destination identity repositories.
A private builder closure created only inside the new unused export dynamically
imports the real transfer owner. Shared host code uses erased strategy types; no
static runtime transfer import in the legacy-reachable body. Exact graph guards
and all three real bundles must prove dormancy. No ordinary caller/flag changes.
Lazy import/owner construction belongs to the actual host lifetime; close revokes
synchronously, joins pending construction/pair/handoff, closes genuine late pairs
and retains resources until positive completion. Never execute legacy retirement/
source access, D/records or manufacture a Dactive/retirement candidate. Actual pair
failures map only to existing bounded migration_fault/migration_blocked/
migration_incomplete/handoff_refused outcomes. Return only the actual non-sporting
NativeIdentityBootstrapHostResult; no Tracker registration or application factories.

Strict pre-runtime transfer work freshly observes every original configure,
inventory, read and insert return, preserving original receivers. Keep values boxed
through async boundaries. Validate each acquired binding/field type and currentness
before later lookup; retain malformed acquired work even when the lookup closes
the owner. Join all acquired malformed work and every fresh observation before
cleanup; invalidate source at first known failure before draining. An async strict
constructor uses the SAME builder/owner/queue; legacy synchronous CommonPort and
its settled() behavior stay unchanged. Reuse strict work for private transfer-owner
construction without changing existing factory method contracts. A separate private
host-only constructor extends the same pairing build with only a predicate minted
inside the actual host over genuine dispose/start/bootstrap/runtime/queue work.
Excluded completion is refusal, NEVER a value/absence/ACK. Completion bookkeeping
cannot grant readiness or reuse a previous native value. Preserve unknown writes.
No SQL queue task waits for the namespace or its parent completion.

Keep actual autoRefreshToken:false, skipAutoInitialize:true, constructor disposal/
initialize/stopAutoRefresh, send/root/token/generation fencing and SDK subscription
denial. SDK reservation remains until genuine SDK and BOTH stores are drained.
Only actual STORE cleanup_unconfirmed with healthy source and no sticky SDK
uncertainty permits a new disposal attempt; terminal remains closed. Constructor
sdk.dispose before initialize is NOT final disposal evidence. Cache only successful
TERMINAL SDK cleanup across store retries; never repeat final SDK disposal,
coordinator close or listener retirement. Sticky constructor/SDK/stopAutoRefresh
uncertainty never resets; legacy disposal caching and root-once lifetime stay.
Sticky SDK failure holds its authentic SDK reservation/evidence. A healthy pair
may positively clean and retire its store owners independently; this does not
release the SDK reservation. Store-only failure still retains BOTH store owners.

Tests must cover genuine/forged/copy/mismatched binding before options/resources,
inert construction, wrong-code zero I/O, actual SQLite/Q/M/namespace and installed
SDK OTP/legal/onboarding using only destination identity rows; no old source/
positive identity adoption or sporting registry. Exercise direct actual host start/
dispose returns at configure/inventory/read/manifest insert, SQL and runtime work,
malformed capture and lookup-triggered close, first failure before drain, late pair
cleanup, store-only retry holding SDK+BOTH stores, and successful constructor
cleanup followed by failed terminal SDK disposal. Retain legacy control tests.

Allowed scope: supabaseAuthService private variant/export and erased types; private
pairing host completion seam; narrow nativeCredentialMigrationPort strict path
and actual session/core fixes only if a concrete invariant requires them; synthetic
real SQLite/installed SDK/configured-binding/server tests, exact architecture and
bundle guards, canonical documentation. No coordinator/AuthClient internals, source
helper/UI/composition/flags/hosted/Swift/device/backup/config/install/Git changes.

Actual OTP/legal/onboarding may establish destination identity only. Startup/trusted/
retry/refresh/background/onboarding NativeProfileAdmission is NOT fresh-OTP proof.
Deliberate verifyEmailOtp-only proof after real writes, immutable source-deny from
actual repositories/preflight/account+Profile correlation and negative facts for
ALL archived Profiles surviving cold restart remain subsequent linked stages, then
atomic original sporting publication/selection, normal source-free handoff and UI.
Never invent absent identity facts for a training-only backup; never execute archive
startup/cleanup/trusted writes/invitation replay. Preserve legitimate 30-day guard
cancel/conditional abort with original nonce and strictly newer server revision;
fresh login/server-not-pending alone is insufficient. Q4 and physical acceptance
remain unresolved release gates. No current product decision is needed for S6k.


### S6l1 — immutable source-denial projection (locally accepted)

Amended independent DESIGN accepted. Negative-only prerequisite before the actual
host clears the recovery code: derive source constraints using the authenticated
V3, actual readonly repositories and actual evaluateDurablePreflight. Preserve ALL
sporting Profiles plus every deletion-guard Profile, including no-sporting-data
Profiles. No positive trusted/attempt/onboarding/entitlement/provider credential
copy into live destination identity, archive startup/cleanup/replay or mutation.
Reports stay code-only mayIssue/mayPublish/mayMount:false. No source-denial clearance,
fresh-OTP proof, cancel/abort authority, sporting publication, normal handoff/UI,
source transport/writer exclusion, device/config/hosted/default/Git work or Beta
claim. Q4 remains unapproved. Future actual fresh-OTP/account+Profile mapping and
legitimate originalnonce/serverrevision cancellation remain required.

Mandatory independent gates:
S6l1a readonly evaluator, exact protocol/hash and genuine private handle, separate
source-aware admission; focused CODE before native persistence/host integration.
S6l1b same-owner SQL layout, strict bootstrap, runtime/anchor pinning and actual
host integration; combined CODE then complete root/Web/mobile3modes(defaultlast)/
139E2E+positive serverstop/types/lints/diff baseline and Vault checkpoint.

New private installationTransferSourceDenial.ts accepts actual primitive V3 wire,
never supplied maps/facts/adapter/readiness. Its sole admission caller has already
performed actual protected-envelope/domain/history validation; decode V3 with actual
standard integrity and require equal packageDigest. Complete source inventory
provides present raw identity items and proven absences; dynamic absence comes
only from actual complete validated ownership listing. Training-only JSON or
omitted observations cannot become absent. Own an immutable map and internal
readonly adapter; use actual barrier/attempt/resolution/deletionGuard repository
loads and actual evaluateDurablePreflight. Never execute startup/replay/save/remove/
resolve/cleanup. Adapter writes refuse and invalidate projection if attempted. No
caller adapter, default/localStorage/native access or thrown-reason inspection.
Check actual owner currentness around awaits. Malformed/unavailable loads refuse,
never default absent/resolved. All guard Profiles are checked; control-only Profile
IDs do not manufacture sporting namespace membership. No positive source trust is
loaded as permission. A genuine frozen opaque WeakMap handle carries bounded
negative facts/ASCII/hash/packageDigest only; copies/proxies/equal facts have none.
Only actual admission creates it; actual source SQL and the closed source-guard
owner resolve it. S6l5a below supersedes the historical v1 metadata protocol.

Old admitTransferPreparation and existing5/7object factories retain exact shape,
order and acceptance/refusal behavior. A separate private source-aware admission
entry shares the existing actual validation build and adds this evaluator only
after successful crypto/V3/domain/history/package comparison. Only the actual
closed host owner consumes it; no public mode flag or supplied handle is added
to existing methods.

### Historical v1 projection protocol (superseded by strict v2 in S6l5a)
Owned JSON object, root fields in EXACT order:
`schemaVersion` literal1, `packageDigest` actual lowercase64SHA256,
`sportingProfiles` sorted unique canonical application UUIDs(max32),
`preflight` as below, `guards` sorted ascending by profileId, unique profileId(max512).
No other fields. Profile UUID membership uses existing actual isCanonicalUuid,
not an invented stricter version rule. Repeated guard nonces across DIFFERENT
Profiles are preserved (never invent nonce uniqueness; actual receipt Profile
correlation still applies). Control-only Profiles do not add sporting namespaces.

preflight EXACT disjoint shapes / field order:
- `{kind:"no_barrier"}` only after actual barrierRepo.load absent.
- `{kind:"quarantined",barrier:B}` for actual non-correlated preflight with a real
  valid barrier; malformed/unavailable actual repository results refuse projection.
- `{kind:"correlated",barrier:B,authenticatedAccountScopeId:S}` ONLY actual
  evaluateDurablePreflight correlated; S is its actual validated resolution scope,
  retained only as a future mismatch constraint, not a grant.
B fields/order EXACT actual negative barrier record: schemaVersion1,barrierId,
origin,barredAccountScopeId,barredGeneration,establishedAt. Use actual validator for
all values/origins/timestamps; barred scope/generation may be null exactly as actual
record permits. Generation is a nonnegative safe integer. S uses actual opaque-ID
predicate (max256), no source trusted/profile/display/entitlement bytes.

Each guards element fields/order EXACT:
`{profileId:P,nonce:N,revision:R,fencedRevision:F}`.
P/N canonical actual UUIDs. R integer0..2147483646. F literalnull for actual active
unresolved guard, or integer R<F<=2147483646 ONLY actual resolved guard load.
No separate contradictory resolved boolean. Build actual guard tuple ONLY from
successful guardRepo.load(P). A resolved load does NOT expose its revision: read
F only from that guard's exact nonce-derived resolution slot in the SAME immutable
map, AFTER actual load positively validates that exact Profile/nonce/receipt.
Record sourceGuard original R unchanged. Orphan receipts provide ZERO resolution
or namespace authority; retain their bytes in the original protected archive only.
Receipts for another nonce/Profile never resolve this guard. All guard Profiles,
including no-sporting-data Profiles, are retained.

Serialization: fixed owned field order above, no whitespace. Use a private fixed
serializer for these exact shapes: quote primitive strings with existing
serializePlatformStringTuple(value).slice(1,-1), emit validated finite numbers with
String(value), literalnull and fixed object/array punctuation. Never stringify a
foreign object or invoke toJSON. Arrays serialize in their required sorted order.
Cold structural parsing begins ONLY after primitive/ASCII/codeunit/size checks;
bounded JSON.parse plus strict closed shape/actual predicates is sufficient for
this separate fixed metadata protocol, followed by exact canonical reserialization
comparison (reject duplicate aliases, whitespace, unknown fields/order, noncanonical
numbers). It does NOT parse hostile V3 without the existing bounded V3 scanner.

Private limits: MAX_SOURCE_DENIAL_JSON=1048576 UTF16units;
MAX_SOURCE_DENIAL_ASCII=4+4*MAX_SOURCE_DENIAL_JSON=4194308 ASCII chars.
Use existing exact encodeTransferCodeUnits / isTransferCodeUnits / decode. This
supports ALL valid32sportingProfiles and512dynamic controls: one barrier raw is at
most65536units, worst re-quoting at most6x that;512guard tuples each<200canonical
chars,32UUIDs<1300chars, correlated scope<=256units at most6x and fixed metadata
<2048chars. Sum<500000units, below1MiB. Never use64KiB decision quota or truncate.
Reject overlimit foreign projected metadata before JSON.parse/bridge allocation;
original complete encrypted archive remains unchanged. No physical bridge-size or
at-rest encryption guarantee follows from the bound/encoding.

Historical S6l1 v1 format below is superseded by the strict v2 cleanup projection
in S6l5a. Existing v1 targets are refused unchanged, never inferred cleanup-absent.

Projection ASCII = encodeTransferCodeUnits(canonicalJSON).
projection_digest = actual standard platform SHA256 (lowercase64hex) of EXACT
serializePlatformStringTuple("installation-source-denial/v1",packageDigest,ASCII),
UTF8 encoded by actual platform helper. No override/injected fingerprint. ASCII
framed preimage stays below16MiB. packageDigest is inside canonical JSON AND hash
frame and must match actual authenticated V3, SQL quarantine and row metadata.
A cold structural parser may validate shape/canonical content but mints NO genuine
handle or authenticity; source-aware handoff additionally REQUIRES current genuine
samearchive/code recomputation and exact byte/digest comparison. Copies/equalfacts
cannot substitute. Normal anchors pin exact verified projection+digest thereafter.


#### Same-owner persistence and strict source-aware bootstrap (S6l1b)

Extend the actual private SQL build on the SAME core/lease/queue/handle, with a
source-aware identity constructor used only by the existing private host-only
transfer owner. Pair-only and S6j identity constructors keep exact5/7objects and
refuse the new8object layout. No second database/owner/namespace/queue.

`CREATE TABLE installation_transfer_source_denial_v1 (singleton INTEGER PRIMARY KEY CHECK(singleton=1), package_digest TEXT NOT NULL, projection_ascii TEXT NOT NULL, projection_digest TEXT NOT NULL)`

Exact schema/table_info/index_list/noextras/stable schema_version; one singleton
and no autoindex. Cold structural data is no authenticity. Actual source-aware
owner retains the handle from its OWN .pair. Handoff needs actual Q/M proof and
initializeIdentity, then insert-only projection bootstrap with genuine handle,
full before snapshot, actual package correlation and exact existing bytes/hash.
An existing7object host layout may add the missing table only after actual same
archive/code recomputation and complete SQL/Q/M/identity proof. Existing8objects
require exact matching current genuine handle. Foreign/missing/drifting/overlimit
evidence blocks and stays preserved; no row adoption/update/delete/repair. Runtime
preparation requires positive projection verification in this instance.

Projection table+row commit atomically using the same actual transaction, strict
ACK, positive close/release/fresh-open readback and all existing unknown-issued
ownership rules. Pin projection bytes/hash into actual runtime controls/generation
and every anchor recheck. Normal identity writes preserve immutable source facts;
private table is inaccessible through pair.domain/ordinary adapters. Source-aware
bootstrap hardening covers ALL quarantine/preparation/intent/binding/identity/
projection transactions: capture/type/currentness-check each acquired method before
later lookup or I/O; retain malformed descriptor/method work even lookup-triggered
close; original receiver and captured rollback; join malformed statement/ACK work
BEFORE rollback/reopen/cleanup. Fresh boxed observation per actual issuance;
completion dedup supplies no value/ACK. No rollback after COMMIT issued. Preserve
legacy/default bootstrap behavior. Actual host completion exclusion is bookkeeping
only; no readiness callback or SQLqueue-to-namespace wait. Retry only genuine
cleanup-only failure, retain source faults.

Allowed scope is the new private evaluator/protocol; separate actual admission;
private host-only pairing/SQL build with strict schema/control/anchor extension;
exact architecture/bundle guards; synthetic actual V3/protection/repositories and
real SQLite/installedSDK tests; canonical documentation. No coordinator/SDK/AuthHost
policy change, UI/source helper/Swift/flags/device/actual backup/account/hosted/Git.
Tests cover actual preflight correlation/mismatch, all guard Profiles and original
nonces/revisions, wrong/orphan receipts, no positive identity adoption/mutation,
complete input coverage, malformed/refused crypto, handle copies/proxies, exact
limits/framing/canonical bytes, and S6l1b real8object commit/reopen/cold matching/
old7upgrade/unknown outcome/fault/actualhostcompletion and cleanup. Old5/7 factories
and all normal build modes remain unchanged. Source-denial clearance and actual
fresh-OTP publication proof are subsequent gates; fresh login never resolves a
deletion guard, nor does server-not-pending alone.

The evaluator/handle and corrected combined persistence/host CODE gates and the
complete local baseline are accepted. Exact evidence is in TESTFLIGHT_READINESS.md
S6l1; the a-before-b review sequence above was completed. The actual host alone
retains the genuine handle from its successful .pair. The same SQL core verifies/
initializes destination identity and inserts or exactly verifies source metadata
before preparing runtime. Cold structural metadata grants nothing until this
instance recomputes the same archive/code. Source facts participate in complete
state equality, schema generation, runtime controls and every actual anchor read.

Source-only private opening hooks cover creation, initial open and configuration
on the same core/lease/queue/physical handle. Captured injected engine bypasses
implicit async resolveEngine assimilation, receives an actual boxed observation
and must retain its exact original identity; Promise/thenable fulfillment cannot
become configuration. Creation captures/types/currentness-validates its method,
retains acquired malformed work and observes the original return freshly with
actual host-completion exclusion. It carries the positive connection in an owned
box; core retains even a genuine late connection BEFORE cancellation cleanup.
Initial open refuses accessors or cancellation before issuance, uses the original
receiver and requires actual undefined acknowledgement. Configuration captures
query/execute before later lookup/I/O, requires exactly one journal_mode=wal row
and execute ACK0 and joins malformed metadata before core cleanup.

Private ensureConnection's boxed overload covers BOTH warm and fresh returns;
private core.openBoxed directly forwards that owned box, and the three source SQL
callers unpack synchronously. Actual source-aware reopen also uses the boxed
return, ignoring its payload. No raw connection crosses a source async return.
Legacy/default constructors omit these optional hooks and retain raw/default
behavior; no public readiness option or callback is added. The independently
confirmed initial-open cancellation and raw async-unboxing defects (three actual
host witnesses) are corrected. Fresh observations remain per actual issuance;
completion deduplication supplies no value or ACK. Tests execute real disposable
SQLite and installed SDK with synthetic bridge/API only. Physical durability,
source transport/writer exclusion and actual backup/device acceptance remain
separate; no source-denial clearance or fresh-OTP/publication grant is implemented.


### S6l2 — fresh OTP provenance and same-runtime pin (locally accepted)

Independent amended DESIGN accepted. First pin means first attempt, including a
refused/null result; no event may be retried against newer local state.

## Exact bounded outcome
The actual configured transfer host records a genuine fresh-OTP event ONLY after
its own genuine coordinator.verifyEmailOtp has completed provider verification,
C6/C7 barrier/attempt/resolution correlation, actual online Profile/onboarding/gate
checks, actual destination trusted write and intent settlement, and final current
ownership/health proof, yielding ready_online. Startup/trusted restore/retry/
Google/refresh/background/onboarding/SDK SIGNED_IN/NativeProfileAdmission never
mint this event. Event plus actual source SQL runtime stamp are private, ephemeral,
instance-bound, negative gates for later publication. No public runtime/host input
accepts supplied events/stamps, and public report grants remain false.

This stage deliberately does NOT select an import UI or extra-OTP policy: an OTP
that yields onboarding_required creates no completed proof, and onboarding alone
cannot mint one. A later linked design must settle any genuine OTP→onboarding
continuation before claiming the complete user flow; this stage changes none of
the existing identity outcomes or prompts. Mapping authenticated destination IDs
to archived Profiles, source barrier/guard clearance and originalnonce/server
revision recovery remain subsequent gates, not implicit allow rules here.

#### Actual coordinator source and event (no generic admission relabel)
Inside identityTransitionCoordinator.ts add private module-owned WeakSet/WeakMap
for opaque native fresh-email-OTP source/event identities. Source/event objects
are frozen null-prototype empty objects, with no enumerable facts/credentials.
Only that actual module mints them; inspectors authenticate identity without
reflecting on unknown input or inspecting thrown reasons. No new runtime import
of any installation-transfer module from coordinator/identityRuntime/default host.
Minimal inspectors, consumed ONLY by private source-aware SQL installer, expose
owned event facts: exact source identity, actual accountScopeId, actual profileId,
identityGeneration and actual private current() closure. No email/displayName/
entitlement/tokens/OTP input/recoveryCode/plain archive/persistent grant.

Extend NativeIdentityOwnership with two OPTIONAL private observer hooks:
ownFreshEmailOtpSource(source:object):void and ownFreshEmailOtp(event:object):void,
plus an optional private retainFreshEmailOtpWork(value:unknown):void drain seam.
All three must exist for this opt-in channel. The actual host owns that drain
through its existing retainAuxiliary/ownsHostCompletion (including own start,
command, disposal cycles); no new queue or caller-provided observer option.
They are not public construction options or application runtime methods. When all three
actual closed-graph hooks exist, the coordinator creates one unique source and
synchronously hands it to the observer at construction, before auth/startup work.
Existing legacy/default ownership objects omit them and retain existing behavior.
A private freshGeneration revokes events synchronously at EVERY beginTransition
(including background), epoch change and terminal close; generic profile admission
behavior is unchanged. Event current() additionally requires original generation,
actual nativeCurrent(context), native health/admissionAllowed, and source identity.
Event mint occurs ONLY at the final success site of verifyEmailOtp AFTER actual
resolveAccessVerdict and explicit ready_online/current/same account+Profile proof.
PhaseBResult carries an internal optional onlineWrite witness set ONLY at the
final complete resolveAsFreshIdentity success site, naming actual account/Profile.
verifyEmailOtp requires this same-invocation witness. Same-scope trusted optimism
returns its unchanged ordinary outcome but no witness and no fresh event. No
additional online work or ordinary auth-policy change is introduced.
Do not mint from publishNativeAdmission or infer origin from its contents.
Capture each actual observer once. Registration and event delivery require
synchronous exact-undefined completion; contain exceptions without inspecting
reasons. Non-void returns disable this channel synchronously before handing the
observed value to the genuine host drain seam. Its exact-owned completions are
recognized to prevent own-command/start/dispose cycles. A throwing or malformed
observer permanently disables the proof channel, never normal auth outcomes.
Reentrant transition/close invalidates the delivery generation and any partial
proof before returning. Source may remain bound but cannot mint again if disabled. Hooks remain
actual internally minted synchronous observers, no foreign readiness callbacks.
No source-side effects and no local SQL/native I/O inside these observer calls.

#### Actual host-only binding and synchronous SQL pin
Extend only the erased private NativeHostPreparation strategy with the two optional
source/event observer hooks. Generic actual buildRuntime conditionally forwards
them through its genuine NativeIdentityOwnership and supplies the existing genuine
host retainAuxiliary as the third drain seam when preparation provides both; old/default/ordinary sporting paths omit them. Transfer-specific bodies stay
inside existing unused createConfiguredInstallationTransferIdentityHost builder
and its actual host owner. No input flag, supplied pair/source/event/stamp, fake
NativeProfileAdmission, SDK subclass/fork or alternate coordinator/runtime.

Only source-aware createInstallationTransferHostOwner gains internal observer
methods; existing pair-only/identity factories and existing four methods preserve
exact shapes. The actual host-only builder wires its private preparation observers
to those actual owner methods. The owner binds exactly one genuine coordinator
source to its actual source-aware SQL context after handoff/runtime activation;
no rebind to another source. Copies/proxies/foreign objects are refused. A genuine
source may be observed again idempotently, never replaced. No SQL I/O on bind.

Extend the actual source-only NativeTransferSourceIdentityContext with private
synchronous bindFreshEmailOtpSource / pinFreshEmailOtp / freshEmailOtpCurrent
operations (not public ordinary adapters/options). A genuine event must match the
bound genuine source, have actual current provenance, and arrive while THIS source
runtime is active, sourceVerified, healthy, not uncertain/faulted/closed, and has
known exact source-denial metadata and actual runtimeSession/schema generation.
No caller facts/current callback or positive archive identity accepted.

pinFreshEmailOtp captures an opaque frozen stamp into an INSTANCE-local WeakMap
containing actual accountScopeId/profileId + event identity and the actual
identityRevision (already private S6j count), runtimeSession/schema generation,
packageDigest and exact immutable source-denial bytes/hash. Capture uses existing
owned in-memory known state AFTER real acknowledged coordinator identity writes;
no bridge work/queue hops. The actual owner privately retains only the successful
event/stamp from its own bound observer. A new transition/event/terminal cleanup
revokes it; no serialization/log/return in public host or identity runtime.

freshEmailOtpCurrent authenticates exact stamp identity and THIS instance/source,
checks current original event/coordinator, actual owner/runtime role/health and
unchanged identityRevision/runtimeSession/schema/package/source-denial facts.
Copies/wrappers/other instances/cold loads have no stamp. Normal identity writes
advance revision only after existing actual ACK/readback. Add source-only
mutationSequence and pendingMutation count immediately after accepted input/capacity/
live prechecks, before runtimeTask enqueue. Sequence changes immediately revoke all
old stamps; pending>0 prevents pinning until the actual queued operation and drain
settle (finally decrements). Invalid input/capacity refusals do not change these.
Capture event-at-first-pin-attempt (including refused/null results) in an instance-local WeakMap: repeated delivery returns
only its original still-current stamp; an invalid old stamp is never reminted
against a newer mutationSequence/revision, even after pending returns to zero.
Each stamp captures both sequence and revision, and current requires pending=0. Unknown/faulted work invalidates health. Later
publication MUST re-read complete actual SQL/source/credential controls and test
this exact original stamp immediately before actual COMMIT; this synchronous pin
alone grants no publication or physical/cold authenticity. No SQL schema change.

#### Scope and verification
Allowed: identityTransitionCoordinator.ts minimal opt-in event/provenance + actual
verify site + synchronous revocation; supabaseAuthService.ts erased observer
forwarding and body confined to actual unused transfer builder; actual source-only
installationTransferPairing/QuarantineSql pin and private types; exact architecture
and mobile bundle guards; real coordinator and actual installed-SDK/real SQLite
synthetic tests; canonical docs. No identityRuntime/default UI changes unless a
specific unavoidable factual need returns for DESIGN. No normal auth-policy change,
account recovery/domain import/guard clearing/pub/UI/sourcehelper/Swift/flags/device/
actual backup/account/hosted/config/Git mutation. Q1/Q2/Q3/Q4 and Free/Team unchanged.

Tests must cover actual successful eligible verify; failed provider, C6/C7 drift,
wrong account/Profile, failed trusted write/intent/currentness/health; startup,
trusted/offline/online restore, retry/Google/background/refresh/onboarding/SIGNED_IN
never mint. All beginTransition and close revoke before awaits. Explicitly test trusted
optimistic verify returning ready_online without event, malformed/throwing/
reentrant observers (including own host completions), queued/in-flight mutation
refusal and permanent old-event repin refusal after successful/no-op mutation. Newer operations
supersede old OTP even same durable attempt. Actual source binding before first
proof, copies/proxies/mismatched/cross-source/cold stamps refused; no reflection on
foreign handles. Actual destination identity write changes revision/current pin;
source metadata unchanged. No native I/O/queue hopping during synchronous capture,
no host start/dispose completion cycles, no normal Tracker/sporting registration
or public API shape change. Actual installed-SDK host and SQLite tests use real
operations, not fake readiness or rewritten normal auth outcomes. Preserve S6l1
opening/unknown-outcome/cleanup controls and existing ordinary paths. All3actual
mobile builds retain transfer-protocol exclusion. Focused independent CODE before
full root/Web/mobile3modes(defaultlast)/E2E+stop/types/lints/diff baseline+Vault.

Implementation uses same-invocation PhaseB onlineWrite evidence, opt-in private
coordinator source/event WeakMaps, actual closed-host forwarding and source-only
SQL stamps. The source-only accepted-enqueue sequence revokes immediately, while
existing identityRevision still advances only after actual COMMIT/readback. First
pin attempt is consumed even when refused; duplicate events cannot acquire a new
stamp after later mutations. Pending-mutation finalization runs inside the original
owned runtimeTask completion after all observed work drains; no additional public
Promise wrapper is returned. Exact public set/remove completions are excluded as
own work, never treated as native values or acknowledgements. Unrelated native
work remains joined. Normal auth outcomes, legacy API shapes, immutable source
rows and all public false grants remain. Corrected independent CODE and complete
local regression are accepted; exact evidence is TESTFLIGHT_READINESS.md S6l2.
A complete OTP→onboarding continuation and complete transfer authentication flow
remain a subsequent linked design, followed by source-denial clearance/recovery,
Profile mapping, publication, normal handoff/UI and physical/release gates.


### S6l3 — linked transfer OTP/onboarding provenance (locally accepted)

Independent amended DESIGN accepted; this extends S6l2 only in the dormant
source-aware transfer host. Ordinary paths retain their existing policy.

## Existing gap and intended bounded behavior
S6l2 deliberately completed the proof primitive, without choosing a linked
onboarding flow. A source-aware host can currently pin an eligible first OTP, but
OTP yielding onboarding_required cannot complete proof; subsequent OTP can follow
same-scope trusted optimism. This stage closes that technical flow while preserving
all ordinary Web/default/sporting host behavior and normal input/outcome shapes.
No extra email code, forced sign-out, invented auth state or imported trusted grant.
Onboarding alone still cannot prove fresh email authentication.

The genuine dormant configured transfer host opts into complete online OTP checks
through an erased private native ownership property `freshEmailOtpOnline?:true`.
The private NativeHostPreparation has the same opt-in literal only in the actual
unused transfer builder; actual buildRuntime forwards it with genuine source/event
hooks and its existing work drain. It is independent of advisory-hook success: a
failed observer disables proof, never fabricates an optimistic proof or changes
ordinary non-opted-in auth behavior. This is never a supplied
public option. Actual closed preparation marks the requirement; ordinary native
ownerships omit it. Do not infer policy from an SDK event or NativeProfileAdmission.
At actual verifyEmailOtp after provider verification and C6/C7, same-scope trusted
optimism remains available to ordinary flows, but this opted-in transfer verification
runs actual resolveAsFreshIdentity with the actual previous account. Re-read actual
Profile/gate facts, establish destination trusted state and settle actual intents;
S6l2 same-invocation onlineWrite proof then pins. No fabricated input/identity facts,
additional background grant, changing the account-switch or denied-account rules.

#### Original prior-account cleanup obligation
The actual Phase B trusted snapshot supplies previousAccountScopeId into the
unfinished-Profile witness, alongside its agreed actual account/Profile. Never
load/archive/adopt old trusted facts as permission. The existing incomplete-Profile
early return precedes account-switch cleanup, so retain that actual original
obligation with the unfinished OTP origin (not a caller Boolean). On linked
completion, if original previousAccountScopeId is nonnull and differs from the
verified/current account, execute the SAME existing inOwnedSection +
intents.deleteOrdinaryIntents account-switch cleanup before trusted establishment,
readiness or proof. Actual failure/supersession prevents success. Preserve existing
bounded invitation-survival semantics; same-account and first-account flows keep
ordinary intents. Re-prove original OTP correlation around actual effects. Do not
widen ordinary/default path scope in this bounded stage.

#### Private genuine OTP origin, never admission
Actual successful C7 records a private immutable origin containing verified account,
original barrier/attempt/resolution correlation and epoch plus actual current context.
The final retained unfinished origin also binds the actual agreed bare Profile.
No OTP input, email/token or secret. Only genuine provider success plus subsequent actual agreed incomplete-Profile
witness can retain it. Preserve its actual previous-account cleanup obligation.
It remains private to that genuine coordinator/source; not passed by runtime/UI.
A failed provider/C6/C7 creates none; a changed account/epoch/current operation,
ordinary new auth/startup/retry/background/close invalidates it synchronously.

The PhaseB result may carry a private unfinished-Profile witness only after actual
ensureProfile and resolveGateFacts agree on the same Profile and eligibility is
incomplete. Capture this exact Profile into the unfinished origin; the final actual
completeOnboarding Profile must match it, independently of any trusted record.

If actual agreed incomplete Profile checking yields onboarding_required,
onboarding_blocked_legal or legal_unavailable, retain that exact
origin as an unfinished negative prerequisite, never an event/stamp/grant. Only
submitOnboarding may carry it through its own claimed transition. Capture continuity
synchronously BEFORE beginTransition and transfer it only if the original context/
epoch/health/source remain current. Re-prove the original actual durable barrier,
attempt and resolution correlation before completeOnboarding and again immediately
before final event minting. Use the actual repositories/checkpoints/evaluateDurablePreflight,
compare original IDs/method/account/epoch/resolution facts, and use an actually
bound context (original barrierId/attemptId) for all existing write/current guards; do not recreate or
rewrite source/archive facts. The actual submit flow still captures current account
before completeOnboarding, re-proves after, requires matching actual Profile/gate,
actual destination trusted write/intent settlement/final owned currentness. Only
when all those actual steps succeed AND original OTP correlation remains valid may
it mint the completed S6l2 event for the new current context.

An onboarding call without that live origin retains the ordinary identity outcome
and creates no fresh event. Copies/reloads/SDK restore/retry/legal refresh/background
cannot mint or reconstruct an origin. Initial onboarding_blocked_legal/legal_unavailable (missing Privacy/Terms or
network-only legal fetch failure) with confirmed incomplete Profile agreement may
also retain this SAME negative origin, without making any legal readiness claim.
No agreement means no retained origin. Later legal recovery/refresh/retry cannot
create an origin, replace Profile/account/prior-account obligation or mint proof.
Legal refresh may preserve the same live
unfinished origin because it does not claim access. Submission failures may retain
origin only when the same proven account/correlation/context still holds, so an
ordinary legal/input/network retry does not itself demand a second OTP. A newer
submission supersedes the older one; neither can mint on the newer one's behalf.
Any actual account mismatch/denial must revoke origin before cleanup, preserving
all existing denial behavior. Actual runInvalidation must clear this unfinished
origin synchronously once it owns the context, before its first async denial work.
Onboarding retries retain only a private rebased current origin with the SAME
original OTP correlation, never a new origin. No event is minted merely because startup/retry or
an earlier onboarding result became ready later.

S6l2 event/stamp remain opaque, ephemeral, source-instance-bound; every completed
proof is revoked at every subsequent transition and accepted mutation enqueue.
Publication still requires complete SQL/credential/source checks at COMMIT. This
stage is explicit technical extension of the earlier verify-final-site-only rule:
linked onboarding may finalize its genuine unfinished OTP origin, while generic
onboarding never produces proof. No entitlement or Beta/product decision changed.

#### Tests and scope
Allowed coordinator minimal private origin/carry and opted-in online path; actual
supabaseAuthService erased opt-in confined to existing transfer builder/private
strategy; tests real coordinator+actual SDK/SQLite; architecture/bundle guards and
canonical documentation. No identityRuntime/default UI/SDKfork/sourcehelper/Swift/
new SQL schema/guard cancel/publication/normal handoff/flags/device/real backup/
account/hosted/config/Git work. Q4 remains unapproved.

Actual host tests must prove eligible first OTP, returning trusted destination OTP
now actually rechecks Profile/gate and writes, first OTP→actual legal/onboarding
finalization→current exact SQL stamp without another code, ordinary onboarding
alone/no prior OTP/no origin/reload none, same-account mismatches and original
correlation drift refuse, changed/newer submissions and auth/background/close
revoke, observer malformed work and genuine completion ownership still contain
without cycles. Actual failure tests for provider/C6/C7/Profile/gate/trusted/intent/
currentness and legal rotation/input/network retries. Cover initial missing
Privacy/Terms, initial legal network failure and later legal recovery without
new OTP; cross-account incomplete-Profile continuation with original ordinary
intent cleanup success/failure/supersession, and same/first-account intent survival. Existing ordinary optimistic
paths and old-source-denial immutability must remain. Focused independent CODE,
then full root/Web/mobile3actualmodes(defaultlast)/E2E+positive server stop/types/
lints/diff before accepted local checkpoint and Vault. Source guard recovery and
archive-to-confirmed-Profile mapping remain subsequent independently designed gates.

Implementation uses an erased source-host-only freshEmailOtpOnline literal,
same-scope actual online revalidation after genuine OTP C6/C7, and a private
unfinished origin with exact original barrier/attempt/resolution, agreed Profile
and actual prior-account cleanup obligation. Only submitOnboarding may synchronously
carry that same live origin through its claimed transition; actual durable
correlation is re-read before effects and final mint. Legal/input/network retry
never creates a new origin. Original prior-account ordinary-intent cleanup runs
on the same owned lane before trusted success. Other transitions/denial/health/
close revoke; generic onboarding and ordinary hosts cannot mint linked proof.
Origin-specific retirement authenticates the exact same private origin reference;
older awaited restores/responses cannot clear a newer rebased origin. Recheck
currentness after both actual restores before classifying any origin-specific
failure. Deliberate transitions and owned invalidation still revoke synchronously.
Corrected independent CODE and complete local regression are accepted; exact
evidence is TESTFLIGHT_READINESS.md S6l3. The five original independent probes,
stale invalid-session/account-change responses and current-owner denial controls
are retained in the coordinator suite. Source metadata/schema, normal public runtime/host shapes,
ordinary optimistic policy, SDK configuration and all publication gates unchanged.


### S6l4 — original source deletion-guard recovery (locally accepted)

Independent amended DESIGN, S6l4a and combined S6l4b CODE accepted; complete local regression accepted.

## Bounded outcome

Reuse actual account-first state/cancel and conditional-abort rules for original
source deletion guards on the same actual source-aware SQL/protected pair. The
coordinator must also honor these guards at every ready path. No positive source
identity/receipt adoption, sporting/Tracker runtime, source-barrier clearance,
Profile mapping, publication, ordinary handoff/UI or whole-import claim. Normal
Web/default/native/sporting behavior remains exact. No account request/export
capability in the private transfer recovery facet. No normal caller/flag/SDK change.

All source guard Profiles, including control-only, remain immutable. Each guard
has original P,N,R and optional archived F. F is NEGATIVE lower-bound evidence;
never feed its archived receipt to ordinary guard repository as resolved:true.
Recovery requires actual parsed server control C>=max(R,F when present), pending
null plus actual conditional abort Fnew>C; or exact pending-request cancellation,
actual true ACK and actual afterward pending-null/sameP/newer revision. Final
destination receipt is original P/N with Fnew>max(R,F), actual acknowledged SQL
write/readback. Fresh login, server-not-pending, current revision alone or archived
receipt alone never resolve an original guard. No silent cancellation of committed
pending deletion; cancellation requires exact request UUID and actual server recent
reauth requirement. Old nonce/R remain unchanged. Other Profiles remain blocked.

## Source-bound guard repository

Add one private persistence module factory taking ONLY genuine S6l1 handle,
actual destination adapter and actual currentness closure from closed owner.
Reject nongenuine handle; no supplied facts/map/readiness/public mode. Actual
createInstallationTransferHostOwner may build it only after same real handoff,
over the same runtime pair/domain and immutable authenticated source handle.
Source-aware-only erased preparation closure can wrap its actual host adapter;
it never accepts another user-facing adapter/handle/Boolean. Architecture guards
restrict executable consumers. Old pairing/runtime/host public shapes stay exact.

Use actual createAccountDeletionGuardRepository for guard and receipt validation,
including exact Profile/nonce, closed fields, valid revision and guard reread.
All actual adapter reads/writes are checked for currentness before/after; real
host account effects/currentness wrapper must surround source fallback too.
No native Promise/proxy inspection outside existing owned adapter boundaries.
No direct SQL/native/keychain work in new module, no async acquisition/pending
timeouts/cancellation-as-settlement, no underlying completion wrappers or engines.

Maintain two constraints without overwriting either: original source guard and
any destination guard. Source original load synthesizes ONLY original negative
guard bytes, after a successful actual adapter read at that key, and reads ONLY
actual destination nonce receipt; archived F is never supplied as receipt. This
private readonly adapter rejects writes. Capture the actual receipt primitive
during the actual repository load (per invocation, no shared mutable capture),
so returned resolved:true additionally requires actual receipt Fnew>source floor.
Malformed/unreadable destination guard/receipt => unavailable, never absence.
Do not ignore a malformed destination guard when projecting original guard.

load(P): validate actual destination guard first; if source original unresolved,
return it (original tuple); if original resolved, expose any destination guard or
original resolved guard if destination absent. canAdmit(P) requires BOTH original
and destination absent/resolved. No sourceguard => exact existing repo behavior.
resolve(g,Fnew): only exact original P/N/R with sufficient floor, or exact current
actual destination P/N/R; actual destination receipt write via existing repo.
Never rewrite/remove guard or source metadata. A newer destination guard survives
original resolution; if still unresolved, readiness remains blocked and later
actual getState may conditionally fence it. One getState null/recovered result is
not an admission. begin uses existing actual destination repo and currentness;
may not overwrite unreadable/current unresolved original holds.

The wrapper exposes private acceptControl(P,C):boolean with actual predicates,
currentness and source floor only; this does not create any grant or fact. The
sole existing control parser invokes this only AFTER its full actual validation
and original native Profile correlation. Add optional seventh private native
callback for validated Profile/revision, preserving all existing callers and
ordinary behavior. No second parser, DTO/RPC shortcut or public supplied fact.
The hook is synchronous EXACT boolean. False/throw/nonboolean sets internal
effectsAllowed:false, never parser success/admission. Observed malformed objects/
Promises are retained by the genuine host work drain and disable the private
facet; do not inspect thrown reasons. Existing Profile correlation precedes it.
getState publishes actual pending through the existing observer/denial ownership
BEFORE guard I/O, and with refused effects skips all guard reads/writes but may
return the pending fact. No-pending refusal fails before load/abort. cancel awaits
existing onCancelPending before testing refusal, then stops before guard load/RPC;
refused after-control stops before resolve. request similarly preserves definitive
pending delivery without effects. Omitted hook retains ordinary behavior.

Same Profile+nonce but different source/destination original revisions is
unavailable. Same nonce across Profiles never cross-resolves: malformed/unreadable
or another Profile's receipt blocks and is never overwritten. Preserve monotonic
actual destination F: lower resolution refuses; equal exact receipt may confirm
idempotently, higher writes only after actual current tuple recheck. begin checks
composite load and refuses any unresolved original/destination hold.

The genuine factory creates ONE private source-guard owner per actual pair/handle,
with repository(adapter,current) for the actual coordinator and per-call host
adapters, and a completion-only ownsCompletion inspector. All repositories from
that owner share a synchronous mutation claim: begin/resolve refuse overlap rather
than queue; claim releases only after their actual operation settles. This guards
read/check/write receipt monotonicity against the owner's other mutation calls;
no cross-tab/native CAS or atomicity against arbitrary direct adapter writers is
claimed. Current production source-host code has no other guard writer. Reads
during such an owned mutation refuse rather than observe an intermediate grant.
No new native queue or resource. The owner registers every exact outward operation
Promise in its private WeakSet BEFORE first adapter/native work (deferred start),
including begin/resolve/load/canAdmit. Actual pairing owner's existing owns
predicate incorporates this inspector. Exclusion means refusal, never native
value/ACK. No extra publicly returned finally wrapper. Recovery facet returns
the exact already registered actual service Promise.

## Actual host integration

Private NativeHostPreparation gains source-only guard wrapping and actual recovery
capture hooks, provided ONLY by actual unused configured transfer builder. Actual
buildRuntime uses wrapper for coordinator.deletionGuards; every ready/retry/offline/
background path remains actual coordinator policy. Actual buildAccountDeletionService
also wraps its per-call current/effects adapter and passes parsed revision callback.
Capture ownAccountControl for source-aware preparation as well as existing sporting;
do NOT capture a Profile admission just to enable recovery. Reuse actual sole
mapper, Self/account/Profile binding, SDK queue, RPC allowlist/order/body validation,
pendingDenial continuation, original-denial provenance and runtimeWork drain.

Construct actual service privately, capture frozen getState/cancel ONLY in actual
closed transfer builder/owner; normal runtime/host/public options gain no field.
No automatic call or public/UI trigger in this stage. Actual transfer-owner closed
facet may expose internal state/cancel entrypoints solely for later linked UI
composition; no request/export, positive grant, supplied service or account DTO.
Test via actual captured preparation/owner (spy real factories, no fake identity
outcomes/replacement service). Clarify capture receiver and ensure no source input
or recovery code retained. New callbacks exact-void; return malformed work handed
to genuine existing host drain and disables facet; existing ownership exclusions
avoid own-completion cycles. Source-only closure must be dead-code eliminated in
default, diagnostics and native-storage builds.

Pending deletion may cause actual OTP to return identity_unconfirmed/Profile null;
existing account-first NativeAccountControl and sole actual control Profile are
enough for state/cancel, never an admission/OTP proof. Do not extend unfinishedOTP
origin or reinterpret this denial. Every accepted recovery write revokes prior
SQL stamp synchronously per S6l2; existing new genuine OTP may later prove again
after all guards/online checks. Do not repin old event or claim a chosen extra-code
UX; UI and user-guided source mapping are subsequent gates.

## Scope and required evidence

Allowed: new private sourceguard module/tests; actual pairing owner private hooks;
supabaseAuthService erased preparation wiring and existing account service private
seam; sole account-deletion mapper optional callback/tests; actual SDK+SQLite host
tests, architecture/bundle guards and canonical docs. No coordinator policy change,
schema, sourcehelper/Swift, real backup/config/phone/account/hosted/Git, installation,
activation or release. Read current governed docs/ADR0052/0054 before implement.

Tests: genuine/forged handle; absent/unreadable/malformed evidence; source F null/
present, C below/equal/above floor, no silent pending cancel; originalnonce/R exact
and Fnew strict; delayed old resolve vs newer destinationguard; control-only and
multipleProfiles/repeatednonces; receipt malformed/wrongprofile/nonce/futureversion;
write/readbackfail; currentness supersession around everyawait; source immutable;
actual coordinator guard denies OTP/startup/retry/background; actual pending OTP
identity_unconfirmed→actualaccountstate→exactcancel→newactualOTP proof; no pending
actualconditionalabort and lostACKretry; freshproof revoked onacceptedwrite and
oldEvent cannotrepin; sourceF alone neveradmits; serverrollbackblocks and cannot
suppressdefinitivependingdenial; actualwrongSelf/Profile/accountchange/close/overlap;
actualnativeandSDKmalformedwork/owncompletions drainwithoutdeadlock; unchangeddefault
controls/publicruntime shapes/noTracker and allnormalbundles no transfermarkers.

Adopt two gates: S6l4a private owner/repository/tests plus exact architecture
allowlist only; independent focused CODE before production construction consumers.
S6l4b actual source owner/host/sole mapper/coordinator integration and real SDK/SQL
controls; combined independent corrected CODE then complete root/Web/
mobile10/277+actual3modes15each(defaultlast)/E2E139+positive serverstop/types/lints/diff.
Document exactresults once in Readiness, accepted contract Mobile, concise indexes/
ADR and Vault checkpoint. Do not call wholeimport/Beta complete.

Independent DESIGN clarification: only for original Source-Guard Profiles, retain
an owner-wide monotonic negative floor of original R, archived F and actually
validated destination receipts. acceptControl checks it; each per-call repository
also remembers its actual control C and rechecks it after reads and before effects
against newly discovered/increased floors, including control-before-first-load.
Malformed/unreadable receipts create no floor. A coordinator repository without
its own Control fact obtains no server confirmation. This is negative fencing,
not source clearance or a Q4 waiver. Outer reads also compare the owner's mutation
sequence before/after, so a mutation that starts and finishes while a read is
suspended cannot leave a stale positive read.

Implementation: a genuine source-guard owner is constructed only inside actual
source-aware pairing after real handoff. Its completion-only inspector joins the
existing SQL/credential owns predicate. Erased preparation wraps actual coordinator
and per-call native account adapters; only source hosts capture actual account-first
control and a frozen state/cancel facet, never request/export or a runtime field.
The sole control parser keeps effectsAllowed internal and preserves definitive
pending publication before guard I/O even on revision refusal. Malformed private
Boolean/capture returns disable identity effects before genuine host work drain;
actual service promises return unchanged. Source guards and original receipts
remain immutable; legitimate recovery writes destination nonce receipts only.
Exact current Control floors are checked around actual adapter I/O as well as
original/destination tuple validation. No source clearance, mapping, sporting
publication, Tracker, normal handoff/UI or release grant. Focused S6l4a acceptance:
3 files/203 tests plus4 independent controls, types/lint/diff. Combined S6l4b CODE and complete local regression accepted; exact evidence is
TESTFLIGHT_READINESS.md S6l4.


### S6l5a — immutable source cleanup evidence (locally CODE accepted, 2026-10-26)

The complete authenticated V3 inventory already includes the fixed
`curling.identity.intentCleanup.v1` raw. Source-denial metadata now has exact
root order `{schemaVersion:2,packageDigest,sportingProfiles,preflight,guards,intentCleanup}`.
The last member is exactly `{kind:"absent"}` or
`{kind:"outstanding",recordedAt:<actual validated timestamp>}`. The same private
immutable map/read-only adapter is read by actual `readIdentityRecord` with actual
`INTENT_CLEANUP_STORAGE_KEY`/`validateOutstandingIntentCleanup`; only actual absence
means absent. Malformed/read-failed/currentness loss refuses the entire projection.
No settlement, removal, replay, expiry or source-identity adoption occurs.

All original canonical field/nonce/Profile/preflight rules remain. Exact fixed
serialization appends the new field; SHA256 domain is now
`serializePlatformStringTuple("installation-source-denial/v2",packageDigest,ASCII)`.
Both timestamp strings are bounded by their actual 65536-unit identity raws, not a
new timestamp rule. Conservative worst-case quoted budget, allowing both scopes,
is `2*6*65536+512*256+2048+2*6*256+2048=924672<1048576`; existing JSON/ASCII limits
remain. Actual V3 dynamic512 limit still applies (a resolution consumes one slot).

The physical eight-object SQL layout and `installation_transfer_source_denial_v1`
table are unchanged. Cold structural parser accepts only exact canonical v2. Old
v1/missing cleanup facts refuse before handoff and preserve all old rows and
protected values; no in-place repair/update/delete. A genuine old seven-object
layout can still add previously absent complete v2 evidence after actual same
archive/code proof. Subsequent warm metadata drift revokes health without repair.

Independent DESIGN/CODE accepted: actual V3 projection, SQLite cold/warm boundaries
and actual configured SDK host, 6 files/395 tests, 3 new adversarial and 30 earlier
controls, types/scoped lint/diff. Parent 4 files/336 tests and exact size-bound
recheck. Full combined S6l5a/b regression is accepted; exact evidence is
TESTFLIGHT_READINESS.md S6l5.
Outstanding cleanup is an immutable negative prerequisite; this stage grants no
source clearance, selected Profile, sporting publication, normal handoff, UI,
activation, device acceptance or Beta release.


### S6l5b — final server control provenance (locally accepted)

Only the closed source-aware transfer host observes the existing actual account
service's final `method=state`, `result.ok===true`, `result.value===null`. The sole
actual mapper must already have validated complete Profile/revision/pending fields
and accepted the source guard floor, using actual Self/account correlation and
the existing SDK queue. Parser hooks alone, archived receipts, pending/error,
cancel/request/export or background/retry/startup are not final server proof.
No extra request, control parser, public runtime/constructor seam or source write.

At each accepted source SDK enqueue replace an opaque command token synchronously
and capture that invocation's token in its actual Command. Before actual Control
RPC issuance capture its original Command/token/generation/account. The per-run
sole revision hook associates the actual validated P/C with this original
occurrence. Capture the actual delivered genuine fresh event at run entry; never
rebind any original to the latest event/token/generation after await.

After final state-null and all existing denial/final-currentness checks, the
closed synchronous preparation hook may mint a WeakMap-backed empty frozen
Control observation. Its currentness requires original coordinator Control,
original event/source/account/P, original c.intent and unchanged SDK generation/
command token, no invalidInput/supersededCredential, actual identity/storage/SDK/
reservation health and no active/queued command. Use passive Command facts after
normal deactivation; `commandCurrent(c)` is not a lasting predicate. A later
accepted SDK command revokes even without a credential-generation change and
completion cannot revive an old observation.

The small helper is dynamically preloaded only in the unused configured transfer
prepare graph, then synchronously used by its private hook. Shared native code
has no static helper dependency. Only actual auth host produces observations;
source SQL alone inspects them. Structural copies/proxies/wrappers are inert.
The actual pairing owner forwards an observation to its same SQL context with
its original fresh stamp. The source-only SQL pin requires own genuine stamp,
exact original event/source/account/P, all original SQL sequence/revision/session/
schema/package/immutable-metadata conditions and actual helper currentness. First
genuine attempt consumes the observation, including refusal; old evidence cannot
recapture a later revision. No new SQL schema, write, queue or transaction.

Accepted SQL mutation revokes synchronously. Expected refusal after successful
conditional-abort recovery yields no new stamp and does not turn recovery into a
host failure; another genuine OTP and final actual state are required. Exact-void
preparation delivery failures synchronously fault identity before genuine work
drain; unrelated work is retained, exact owned service/disposal completions cannot
form their own drain prerequisites. The actual service promise is unchanged.

This is only current server-control provenance. It grants no source-barrier
clearance, cleanup settlement, selected Profile mapping, sporting publication,
Tracker, normal source-free handoff, UI, activation/device/Beta acceptance.
Source v2 outstanding cleanup and all other original constraints remain for the
subsequent source gate. Independent combined CODE and full local regression
accepted; exact evidence is TESTFLIGHT_READINESS.md S6l5.


### S6m1 — durable publication intent (locally accepted)

## Mandatory M1a/M1b gates

M1a ONLY: protocol/slots/budgets + genuine protected observations + new private
port capability/lifecycle tests + owned/current standard SHA entry. New constructor
has NO production consumer until M1b. Existing source pairing still selects its
old port. Tests may make the actual existing factory delegate to the actual new
constructor, preserving the exact genuine returned port and all actual preparation
arguments; no fake SQL/lease/runtime/identity outcomes or wrapper-port authority.
Independent focused M1a CODE must PASS before M1b production consumers.

M1b ONLY after that PASS: actual source SQL eligibility/fingerprints/draft, actual
owner no-argument method/new constructor selection, complete cold integration.
Combined independent CODE then complete baseline, no full acceptance from M1a
focus alone. S6m2 actual SQL publication still requires its own subsequent DESIGN.

## Concrete next outcome; no additional isolated identity proof

Use the actual current private ControlStamp to prepare and positively persist a
versioned protected publication intent. It binds the complete original package,
prepared namespaces and immutable source constraints to the actual existing Q/M
pair. This is the first concrete half of finalization, not source-free startup or
a source clearance grant. S6m2 must independently design and implement the matching
atomic SQL publication. Until then no ordinary rows, selection, receipt, Tracker,
public runtime field, UI or published state. The intent alone grants nothing.
Later handoff must positively close current SDK/stores and acquire a distinct
source-free Published-Import host. Do not fabricate Dactive or set sourceVerified
from SQL structure. Ordinary late account switches must remain possible.

Existing actual M/Q are immutable and lack package/source digests. Do not extend
them or reinterpret their bytes. Use a separate narrow protected slot and actual
same namespace owner, binding, lease, queue and runtime session. No second owner,
database, SDK or encryption implementation. Apple's existing configured protection
and existing standard platform SHA256 only; no new injected digest/ready facts.

## Source decision at actual SQL preparation

Caller supplies no Profile/account/ready/anchor DTO. Actual pairing owner method
preparePublication() takes no arguments and uses its private current ControlStamp.
The source SQL context directly checks its own immutable genuine authenticated
source metadata, existing current stamp and unchanged full identity snapshot:
- no quarantined preflight and no outstanding intentCleanup;
- correlated original S must exactly match actual fresh account; no_barrier needs
  no invented original account;
- actual fresh P from its original stamp must exactly belong to nonempty original
  sportingProfiles. Zero Profiles and mismatch explicitly refuse with preserved
  data; no archive-only continuation/product decision/rekey/substitute Profile;
- current final actual Control proof already evaluated selected-P guards and
  revision floors. Do NOT call guard repositories through pair.domain while
  holding SQL queue (self-cycle). No other Profile is declared cleared by P/C.
- retain every original namespace/raw and control-only guard tuple unchanged. No
  original intent/trusted/receipt/legacy identity replay, cleanup or source write.
A new target OTP cannot automatically discharge quarantined/cleanup debt. Re-export/
repair UX is not adopted here. The original S is only an initial-finalization
constraint, never a permanent account allowlist after a future valid publication.

## Exact protected intent protocol

New private installationTransferPublicationProtocol module. Primitive bounded cold
structural parser + fixed serializer, no foreign JSON/toJSON. Exact ordered fields:
{schemaVersion:1,protocol:"curling-installation-publication-v1",publicationId,
 providerConfigIdentity,sessionStorageKey,sdkContractVersion,
 protocolId,credentialEpochId,manifestId,storeIdentity,
 packageDigest,sourceDenialDigest,protectedWireDigest,preparedDigest,
 profiles,selectedProfileId,accountScopeId,controlRevision,
 workingLayout:"installation-live-ascii-v1"}.

All four pair IDs are actual canonical IDs from the actual bound Q/M; publicationId
is a new actual crypto.randomUUID, distinct from those IDs. Currentness/capture/
malformed-work handling follows actual createTransferPair conventions. Configuration,
root and SDK contract must exactly match actual fixed configured pair. Digests are
actual lowercase64 SHA256. profiles is exact original sorted unique UUID list,
nonempty/max32; selectedProfileId actual P is its member. accountScopeId actual
bounded opaque scope (same genuine event predicate/max256, code units unchanged).
controlRevision actual validDeletionRevision and minimum floor, never server grant.
JSON max8192 units; ASCII=actual encodeTransferCodeUnits, max32772 chars. Check all
limits/types/canonical reserialization, reject missing/extra/duplicate/order/version/
unknown enum/noncanonical numeric fields, no parser default/repair. Actual canonical
serializer quote uses serializePlatformStringTuple primitives. Same budgets cold.
Derive exact size calculation before claiming all admitted scopes/namespaces fit.

sourceDenialDigest is genuine actual current v2 projection digest. packageDigest
is actual authenticated archive package digest. protectedWireDigest = standard
SHA256 of serializePlatformStringTuple("installation-published-wire/v1",wire),
where wire is the exact actual stored protected ASCII envelope. Bound preimage by
actual max protected wire formula+256 BEFORE framing/allocation; this uses existing
string SHA256 entry (not byte helper's16MiB quota). Existing protected wire already
admitted at header.length+17+ceil((25165824+16)*4/3). No physical RAM guarantee.
preparedDigest = standard SHA256 of serializePlatformStringTuple(
"installation-published-sporting/v1",packageDigest,canonicalRowsJSON).
canonicalRowsJSON is fixed array of exact ascending actual slot tuples
[slot,key,value_ascii,value_digest], all actual source sporting rows, no filtering
by P. Validate original contiguous slots/key order/codeunits/row digest first.
Use fixed primitive serialization. Prove worst actual full source raw<=3145728,
rows<=416/key<=256 yields framed preimage<16777216 before allocation. Refuse rather
than truncate. No future normal-training retention cap follows from source budgets.
anchorDigest = standard SHA256 tuple("installation-publication-anchor/v1",ASCII),
for the later exact SQL receipt. Standard crypto capture errors/pending work settle through the owned/current
entry below; no own crypto or claimed rescue of opaque dependency graphs.

### Necessary narrow hash-work ownership (M1a)

Existing capturePlatformSha256 and capturePlatformByteSha256/default callers and
overrides retain EXACT contracts. Add a separate private
captureOwnedPlatformSha256(owns,current) standard string entry with NO digest
injection/override. Reuse actual standard WebCrypto/TextEncoder, tuple framing and
existing internal observed-work primitives; no cryptographic algorithm changes.
Every original acquired Crypto/encoder/constructor/method/returned value is checked
against actual genuine completion ownership BEFORE native probing, property
reflection or adoption. A directly or intrinsically encountered own prepare,
hash, runtime, close or host-disposal completion ONLY refuses, never a digest/ACK.
Register exact outward hash completions before first crypto work (deferred start)
and include them in genuine owns checks. An outer wrapper around already-started
hash work is insufficient.

Check actual current()===true before each acquisition/call and immediately after
each directly acquired value, and again around asynchronous result observation.
Stop before later acquisitions/issuances after reentrant close/currentness loss.
Refuse acquired async Crypto/encoder/method material; its later valid fulfillment
is never construction input. Drain every OTHER directly observed malformed pending
value, including malformed then fields/native fulfillment values, before failed
preparation/hash/cleanup completes. Exclusion may not skip unrelated work. Use
existing intrinsic observation/C4 contract; no timeout/guessed settlement or claim
about arbitrary indirect opaque Promise dependency graphs. Never inspect thrown
reasons. Capture failure work remains joined by actual settle preparation helper;
no global/default observer, prototype or host-event behavior changes.

## Narrow physical slot and genuine protected observations

New private t1 slot is "t1."+credentialManifestSlot(config).value.slice(3), using the
actual existing config codec. NOT a new kind in generic parseCredentialPhysicalSlot.
Generic/ordinary, old pair-only and old identity factories continue rejecting it.
Only a new closed createPublicationTransferCredentialMigrationPort constructor
can recognize this one exact slot in addition to existing canonical M/I entries.
Only source-aware actual pairing selects it in M1b; M1a has no production
consumer. Existing public port shape unchanged.
No new string flag in public constructor options, no accepted arbitrary slot.

Register private publication operations by genuine port identity, with a getter
usable only by actual pairing. No fake/copy/wrapper/proxy port can obtain capability.
Capabilities keep actual same owner/lease/captured binding/work and existing private
runtime session/domain draft. No second queue, raw SecureStore or default adapter.
- read(lease,actualQ,actualManifest,proceed): actual positive M and t1 read, actual
  complete owned namespace inspection, q/M/config binding. Returns a genuine opaque
  private observation of established_absent OR exact canonical value. Never infer
  absence from failed/unreadable/invalid/missing observations.
- insert(...,raw,proceed): only actual prepared runtime/session active; validate raw
  against actual Q/M/config and finite protocol before I/O. Positively establish
  absence, never overwrite. Actual write must return EXACT undefined ACK and exact
  fresh readback. Re-read actual M/full allowed namespace and t1; all currentness
  checks around effects. Return verified actual observation only after all checks.
  Existing equal value is an observed pre-existing intent, never a new write ACK.
  Different value, unsupported/foreign slot, missing warm-confirmed t1, changed M,
  malformed evidence or unknown post-write result fails/holds; no compensation or
  automatic repair. Source and previous values preserved. No normal-credential write
  through t1, no generic SDK key added. The existing failedWrite policy remains.

Read may operate during migration for cold source-aware discovery (no positive
runtime authority) and during actual prepared runtime for preparation. Runtime path
uses existing actual runtime ownership/drain and domain.anchor before protected
work; no SQL transaction may await this capability. Actual canonical current-epoch
I values can legitimately change through SDK; do NOT reuse migration observer's
old raw/key cache as a runtime credential immutability claim. Validate actual M,
allowed inventory/current epoch and each actual I envelope without declaring old
SDK values immutable. All unrelated/foreign/orphan slots still refuse.

Observations are empty frozen WeakMap handles produced ONLY by actual protected
port reads, with actual same Q/M/lease/config and observed raw/absence facts. SQL
is the only production inspector. A successful observation is a fact at that actual
read, not a claim storage can never later change. It carries actual owner/session/
currentness. Copies/proxies/equal DTOs reflect no properties and confer nothing.
Inspection does not mint sourceVerified or authentication.

Exact outward read/insert completions registered BEFORE first native acquisition,
including getters/descriptors. Reuse existing strict protectedWork/transferWork
ownership and actual runtime/host/source-owner completion exclusions. Malformed
acquired/returned Promise work faults synchronously before genuine unrelated drain;
no exact outward/close/host disposal promise becomes its own prerequisite. No
settlement timeout, callback-ACK truthiness, Proxy reflection or thrown-value dump.
Close revokes synchronously, joins preparation/native work, positively closes and
releases actual owners; sticky uncertainty remains held across cleanup retry.

## Actual same-owner publication draft; source-only owner entry

Actual source SQL preparePublication(ControlStamp,anchorObservation) runs through
its own current queue, first validates actual source decision above, then the
actual complete current before snapshot and actual genuine protected observation's
Q/M bindings. Compute all actual fingerprints and canonical intent. No writes.
Return a private context-owned draft token, not supplied facts/booleans. Private
payload/current access only for actual pairing orchestration and later transaction.
This is part of the concrete publication protocol, not a new public readiness layer.

If actual t1 absent, choose genuine fresh publicationId. If actual t1 already
present, it is only a historical candidate: require exact actual pair/source/
wire/prepared/profile/account/layout equality and new actual Control C>=original
anchor controlRevision. Retain exact existing publicationId/controlRevision/bytes;
never relabel existing presence as a write ACK or replace another intent. Actual
same archive/code recomputation and new genuine current OTP/Control remain required.
No mixed, empty, equal-foreign or wrong-selected-account adoption. A higher stored
C is a negative floor; lower current server C refuses.

Draft currentness keeps the ORIGINAL same SQL identityRevision/sequence/session/
schema/package/source and ControlStamp/actual host facts around every await. No
rebinding after hashing or protected I/O. Before publication own mutation handling
S6m2 must be separately designed; do not relax accountControlCurrent globally.
Draft does not require the initial absence fact to remain absent after its own
legitimate t1 insert: accept a NEW actual positive readback observation only if its
raw is exactly that same draft. No inferred self-ACK or fabricated protected proof.

Actual source-aware pairing.preparePublication() is no-argument, private only.
Single flight, registers exact completion synchronously, includes it in genuine
owns predicate and close drain. Read actual protected observation, create SQL draft
from its stored ControlStamp, get actual payload, insert/positively observe t1,
then SQL acceptPublicationAnchor(draft,actualObservation) compares genuine bindings/
raw/current facts and retains private draft. Return code-only publication_intent
with mayIssue/mayPublish/mayMount:false. Expected auth/source/stale refusal is not
new success and does not poison healthy state; actual contradictory/unknown native
facts do retain faults. Original source/profile rows never change. Every next call
rechecks actual t1; warm-confirmed loss cannot be repaired. No actual public host/
runtime facet is added. Existing state/cancel/OTP routes preserve exact promises.

Cold integration in M1b MUST follow this order:
1. Authenticate actual archive/code and establish actual same source-v2 binding.
2. Outside any held SQL queue physically observe actual M/t1 on the same port.
3. On the actual same SQL core queue verify against actual Q/M, wire/rows/source.
4. ONLY THEN prepare/activate identity domain and credential drafts.
No protected read while holding the SQL queue and no initial handoff before step3.

Cold source-aware same archive/code can discover t1 as inert intent. Actual source
SQL verifyPublicationIntent(genuineProtectedObservation) recomputes all fingerprints
against its own actual authenticated current archive/rows/source v2 and validates
original Profile/account/source preflight constraints before identity-only handoff.
No Control freshness inferred from old C. Original sourceVerified still comes ONLY
from actual current archive/code. Cold wrong t1 refuses without overwrite/repair.
Other factories refuse t1. This stage neither recognizes a published SQL layout
nor starts without archive/code. Later source-free recognition needs matching
atomic publication and actual protected observation, never today's eight tables.

## Subsequent stage boundary (blueprint, NOT S6m1 implementation)

S6m2 independently designs atomic SQL publish on SAME core/lease/queue/handle:
- unchanged original8 objects, plus singleton publication table and mutable ASCII
  live table+itsPKautoindex (11 total objects). Copy ALL prepared sporting rows under
  their exact keys/codeunits into live rows, complete exact selection/receipt for
  initial P and matching anchor, in ONE transaction. Preserve immutable originals.
- check actual source/control/identity baseline immediately before issuance and
  COMMIT, classify uncertain outcomes from actual positive close/reopen/readback;
  no compensating deletes or oldevent repin. Own publication mutation gets a narrow
  exclusive continuation, never a global relaxation; other accepted writes revoke.
- partial SQL rows/receipt/schema never mount. Protected intent alone never mounts.
  Cold published state will require a separate explicit published constructor and
  genuinely protected binding. Historical receipt is not a current auth admission.
Normal source-free runtime/actual Tracker and UI follow their own gates after that.
All later Profile switches use ordinary current admission while every original
per-Profile guard stays effective. Original global S is not a permanent allowlist.

## Allowed scope and required evidence

New publication protocol/private observation module and tests; narrow actual
nativeCredentialMigrationPort capability/constructor and actual lifecycle tests;
actual source SQL draft/negative decision/fingerprints/cold intent validation;
actual source-aware pairing method and actual SDK/SQLite tests; exact architecture/
all3bundle guards; canonical docs/Vault after acceptance. Generic credential codecs,
Q/M/I formats, normal Web/native policy, source helper/Swift/UI/flags/config/real
backup/device/account/hosted/Git are outside scope. No S6m2 live tables/rows.

Meaningful tests: exact golden canonical JSON/u16/hash/physicalslot/framing/budgets;
all32 namespaces/maxscopes/loneSurrogate/codeunit fidelity, no toJSON; closed/old/
noncanonical/duplicate/oversize/raw false grants; generic slot/oldfactories refuse.
Actual shared-owner Keychain-like binding+realSQLite+installed SDK: genuine OTP and
final state then exact t1 insert/readback, allbeforeSQL snapshots unchanged; selected
P source membership, no_barrier/correlated exact/mismatch/quarantined/cleanup debt,
zero Profiles, all other Profiles/control guards preserved; originalguard recovery
requires new OTP/control; pending/error/malformed/floor rollback have no insert.
Existing same-intent cold revalidation only same source/code and new actual current
proof with C>=C0; different package/source/wire/rows/profile/account/IDs/layout fails
without rewrite. Absent/read_failed/unreadable/noncanonical/foreign inventory cannot
become success. Lost ACK, write-noeffect/writeeffect unknown, changed readback, warm
loss, delayed work/stale SDK enqueue/SQL mutation/close preserve and refuse.
Actual runtime and cold migration stages never deadlock on the same SQL queue.
Actual owned/current SHA: each Crypto/Encoder acquisition can synchronously close
the actual owner or return an exact own prepare/hash/runtime/disposal completion;
no later getter/call/issuance or self-cycle. Real pending independent malformed
capture/encode/digest/native fulfillment work holds until settlement, output never
becomes a valid hash. Actual valid SHA256/golden text/codeunits and all old default/
byte/override controls unchanged. No new arbitrary-cycle claim.
Per-method acquisition/returned malformed pending work, reentrant actual dispose,
exact own prepare/read/insert/runtime/disposal completions exclude without cycles;
unrelated work delays positive release until settled. Default auth/native policies,
source guard cases and full namespace safety controls remain. Actual3normalbuilds
contain no new executable markers. No claim physical Keychain/durability/capacity.

Parent focus/types/scopedlint/diff, independent DESIGN then M1a focused CODE and
M1b combined CODE/adversarial review, then complete root/Web/E2E+positive
serverstop/mobile+actual3modes(defaultlast)/
fulltypes/lints/diff before S6m2 DESIGN. Record exact evidence once in Readiness,
canonical contract/ADR and fresh Vault checkpoint. No Wholeimport/Beta completion.

#### S6m1a — independently accepted protocol/port prerequisite

At its M1a review the new publication constructor had no production consumer;
M1b below connects only the closed source-aware owner. The private `t1` capability uses the existing exact namespace owner, lease and native runtime;
ordinary physical-slot parsing still excludes it. Only actual positive protected
reads mint an empty observation handle. Insert requires absence, exact undefined
ACK and exact fresh readback plus complete current namespace/M/I validation.
Existing equal intents are observations, never newly acknowledged writes. Warm
loss/drift and unknown writes hold without repair. Runtime SDK I entries remain
mutable and are checked independently of migration-only cached credential values.

The separate owned/current standard SHA entry registers outward hash completions
before crypto work and excludes actual caller/hash/close work before adoption;
independent malformed work is still drained. Exact generic migration completions
are registered before acquisition on the new constructor only; release still
revokes synchronously. An acquired owned then-value is retained without another
getter read. Unknown, positively absent and positively present intent states are
distinct: external warm appearance is drift, while first historical presence and
this owner's verified insertion remain valid observations. Default string/byte APIs
and the original constructors retain their previous settlement behavior.
The exact JSON protocol has a conservative full admitted bound of 5438 code units
inside its 8192 quota; encoded quota is 32772 ASCII characters. This is a format
bound, not a physical memory guarantee. The sporting fingerprint's actual source
row construction and preimage proof are implemented by M1b below.

Parent focused verification after independent correction findings: 10 files / 419 tests, TypeScript, scoped ESLint and
`git diff --check` passed. Synthetic protected bridge faults and disposable real
SQLite only; no physical Keychain/installation or Beta acceptance. Independent
M1a CODE passed the same 10/419 focus and four additional adversarial probes.
M1b actual source SQL/owner/cold consumers may now be implemented. Complete
regression follows the combined M1a/M1b independent review.


#### S6m1b — actual source SQL/owner/cold integration; locally accepted

The source-aware owner now selects the closed publication port and has a private,
no-argument, single-flight `preparePublication()`. Actual current OTP/Control stamps
supply account, Profile and revision. On its original SQL core/queue, preparation
requires an authenticated unchanged archive/prepared snapshot and genuine source
v2 binding: quarantined preflight, cleanup debt, empty sporting Profile inventory,
a selected Profile outside the original set, and correlated source-account mismatch
refuse without changing source or sporting rows. Other original Profile guards
remain intact. No guard repository/SQL-domain call occurs while holding this queue.

The complete original row set supplies the prepared fingerprint, including other
sporting Profiles. Original row digests were verified in actual V3 admission and
must remain in the same exact SQL snapshot. Fixed canonical row framing checks its
size before allocation: the conservative full framed bound is 13,967,616, below
16,777,216. Exact publication digest/UUID field lengths also reject trailing line
breaks; generic UUID/default SHA contracts are unchanged.

A context-owned opaque draft binds the original Control, identity revision,
mutation sequence, session, schema and complete snapshot. Actual protected insert
or historical presence is accepted only through a new genuine exact readback
observation. A prior absence fact does not become a self-ACK. Accepted private
drafts remain held by their context and become unusable when their original facts
are superseded. The only success report is `publication_intent`, with all public
mayIssue/mayPublish/mayMount fields false. No SQL publication or sporting grant.

Actual source-pair SQL/runtime/credential producers register exact outward and
queued completions on the same genuine transfer session before work executes.
The shared view is cycle-exclusion only, never a value, ACK or admission. Original
constructors/publishers do not gain this producer behavior. Malformed actual
native SQL work revokes source health and original stamps before unrelated work
is drained. Pure UUID acquisition retains its own refusal/drain scope; stale
pre-write refusal and genuinely pending valid SQL do not poison healthy cleanup.

Cold order is actual archive/code authentication and source-v2 initialization,
protected M/t1 observation outside the SQL queue, actual same-core fingerprint and
source verification, then identity/credential draft activation. Existing intent is
historical only; reuse requires a new actual OTP/Control with C at least its old
revision and exact original bindings/bytes. The original ID/C/bytes are retained.
Absent intent still permits the existing identity-only recovery path; it does not
waive later publication eligibility. Old constructors remain outside this layout.

Parent corrected combined focus, including ordinary host/configuration controls:
17 files / 881 tests passed with two workers. The actual configured-host file
contains all twelve independent regression witnesses: nine cross-lane completion
exclusions, two early native-SQL revocations, and a healthy pending-SQL/close
control. TypeScript, scoped ESLint and diff checks passed. Tests use the actual
installed SDK, disposable real SQLite and synthetic protected/network edges.
Corrected independent combined CODE and complete local baseline passed. Exact
execution evidence is recorded once in TESTFLIGHT_READINESS.md. S6m2 actual SQL
publication still requires its separate DESIGN; no normal host/UI/physical grant.


### S6m2 — atomic SQL publication (locally accepted)

## Confirmed scope and product boundaries

Implement the already outlined atomic SQL half of the accepted M1 protocol on the
SAME actual source core/lease/queue/connection owner. Keep immutable wire/prepared/
source/Q/M objects. All original sporting Profiles and values survive exact u16
under their original keys, including nonselected Profiles. Initial selected P is
exact actual original Profile membership from M1; no remap/filter/new Profile.
Original source preflight correlation is an import constraint, never a permanent
allowlist of future accounts. Existing source guards remain effective.

No new product decision is intended. Free Beta/Personal/Team, Q1/Q3 unchanged;
Q4 unapproved. This stage has NO normal sporting adapter, Tracker registration,
source-free constructor, current auth grant, SDK handoff, UI, actual source capture
or operational release. Durable SQL confirmation is factual completion of storage,
not mayMount/mayPublish/mayIssue. Normal published host is separate subsequent
DESIGN and must positively close original SDK/stores before acquiring new owners.
Stop for a genuinely unresolved product question; do not invent one for routine
implementation. Reviewer may reject technical design before implementation.

## Exact layout and selection

Original eight objects remain byte-for-byte unchanged by publication. Add only:

CREATE TABLE installation_transfer_publication_v1 (singleton INTEGER PRIMARY KEY CHECK(singleton=1), anchor_ascii TEXT NOT NULL, anchor_digest TEXT NOT NULL)
CREATE TABLE installation_transfer_live_v1 (key TEXT PRIMARY KEY NOT NULL, value_ascii TEXT NOT NULL)

Plus SQLite's exact automatic PK index
sqlite_autoindex_installation_transfer_live_v1_1: eleven total objects.
No trigger/view/foreign extra column/index, generic records/credential table,
new database, second port/engine/namespace or public mode option.

Publication singleton1 contains EXACT accepted protected intent ASCII and its
already standard-computed anchorDigest. The closed canonical intent includes the
complete immutable package/pair/source/fingerprints, original initial selected P,
account/C and workingLayout. selectedProfileId inside this receipt is the durable
initial selection; no extra legacy selection write or positive source identity
replay. Future normal host must interpret it as historical initial selection,
never current authorization. Every prepared [key,value_ascii] is copied to live
exactly, with no normal serializer or selected-P filter. Absences remain absences.
All source arrays are bounded by already accepted original source quotas. These
are initial-copy quotas, NOT future mutable training retention limits.

## Genuine draft, protected observation and no-argument owner path

Extend only source-aware SQL context with a closed operation receiving a genuine
new protected observation. It uses its own strongly retained accepted M1 draft,
not caller bytes/stamps/ready flags. Refuse unless original draft is still current,
accepted physical t1 was verified, fresh physical M/t1/inventory observation is
actual same port/runtime/pair and exact raw, original SQL before snapshot remains
identical, source eligibility and original fresh final Control remain current.
No protected call/guard repo/domain adapter call while SQL queue is held.
No hash/UUID work or caller-supplied digest in this stage: accepted M1 private
anchorDigest already binds exact canonical raw.

Add source-owner-only no-argument publishPrepared(). It requires actual runtime,
private control and accepted preparation, single-flights and registers the actual
outer completion BEFORE work. It performs fresh capability.read on same port
outside SQL queue, then passes only genuine observation to actual SQL context.
Do not expose via current actual AuthHost/runtime/UI. No public field or structural
ready bit. Keep existing preparePublication and old constructors/exports intact.
Concurrent prepare/publish/close obey the existing pending ownership; actual pair
registry recognizes precise SQL/port/owner completions as exclusion-only facts.
No arbitrary graph rescue or production timeout.

## Exclusive own-mutation continuation

At the actual queued publication start, authenticate the genuine accepted private
draft/protected observation and original Control FIRST. Mint a private context-local
continuation capturing original fresh/control facts, exact before snapshot,
identity revision/schema/session/source binding, and original owner currentness.
Rotate the accepted-mutation sequence synchronously and consume original stamps.
General accountControlCurrent/freshEmailOtpCurrent MUST remain unchanged/false for
the consumed old stamps: no global relaxation or resurrection, even on abort.
The continuation is private to this one operation, never an exported handle.

It checks its exact new sequence/claim token, unchanged original identity revision,
actual original genuine OTP event and final Control still current, same account/P,
actual runtime health/session/lease and owner currentness, pending other mutations
zero, and original immutable before snapshot. Own DDL changes are narrowly expected
by this continuation's explicit staged read, not by relaxing general schema checks.
Every other accepted identity mutation rotates sequence immediately even while
queued; accepted SDK commands change the actual captured SDK intent token; close
revokes immediately. Any of these cancels further issuance/commit. Reads do not
manufacture freshness. No re-pin/rebind to a newer event/Control, no guard calls
under SQL lock. Invalid native work revokes before drain and keeps resources.

The core's phase() marks its lease requires_reopen. Keep TWO separate private
facts: (1) this genuine publication task still owns its serial queue through all
rollback/reopen/classification/drain, and (2) original publication authority is
still current. The queue-ownership marker stays until final drain even when an
accepted SDK/identity mutation has already revoked COMMIT authority. It must NOT
depend on original Control/current sequence/pendingMutations. Queue admission is
not publication authority.

Keep existing sourceLive/sourceReady/Fresh/Control and legacy live predicates
unchanged. Only source-aware get/mutate/anchor ENTRY admission gains a separate
narrow predicate: ordinary live OR this actual task still owns the queue, the same
real lease remains current (requireReady=false), runtime role is still runtime,
owner is not closed/revoked and actual storage/session remains healthy. Thus an
accepted identity write can immediately rotate sequence and wait, and a genuine
SDK credential operation can wait for its domain anchor. No exception after close
or storage fault. Actual queued ordinary task execution continues requiring real
ready through existing live/controls, after publication has finished its queue.
No second queue, parallel SQL or generalized ready predicate. The own publication
continuation independently uses same-lease false only for its own expected phase;
COMMIT permission alone checks original fresh/control/sequence/identity facts.
Prove actual SDK/credential/identity work across held reopen/rollback/success, also
AFTER its enqueue has already invalidated the original COMMIT permission.

The claim is a one-time mutation, not a new proof/readiness subsystem. Consumed original source stamps
never regain authority after its completion. This does not prohibit genuinely new
ordinary observations; M1 prepare/accept and M2 publication refuse a second
publication in this already-confirmed source context. Expected capacity/policy/stale/cancelled
pre-write refusal stays healthy. Later fresh proofs may be needed for retries only
while confirmed unpublished; a confirmed publication cannot be published again by
this source context. Existing identity-only SDK remains operational on its actual
pair until a separately designed normal-host handoff; this stage MUST NOT close its
SQL lane under a still-running SDK or pretend SDK quiescence was proved.

## One actual transaction; strict observations

Capture actual begin/execute/run/commit/rollback methods once, with existing receiver
and ownership/currentness rules before later getters/issuance. Retain acquired and
issued work, exact-void/installed SQLite ACKs, same completion registry, actual
positive close/reopen evidence. No caller callbacks across final commit permission.

1. Read exact original8 schema/data and genuine actual before snapshot.
2. BEGIN actual transaction; re-read before and verify private continuation.
3. Create exactly both new tables; insert every original key/u16; insert exact
   singleton intent/digest. All insert/run ACK row counts follow installed contract.
4. Read/validate exact complete11 schema, all unchanged original8 rows, complete
   live-copy equality, exact singleton raw/digest/selection; no partial recognition.
5. Recheck private continuation immediately before COMMIT issuance.
6. Observe COMMIT and positive same-core close/reopen/readback classification.

Use strict schema_version fencing: only own publication's exact complete DDL is
allowed to change it. Do not globally skip runtime schema checks. Set a new known
schema baseline only after full positive classification. Read the same complete
objects without side effects; snapshot code can be a narrow internal helper/module
but uses existing core/work, never a second owner. Initial8 and final11 are exact;
intermediate9/10, extra objects, partial/copied-missing rows or mismatched receipt
never become a confirmed publication. Do not compare current mutable identity rows
to an ancient pre-publication baseline after a later legitimate identity mutation.

Every complete DURABLE read during post-transaction recovery belongs to ONE
classification attempt, including the multiple ensureConnection/selectProtocol/
discover reads and final observe. Extend the existing outcome pin to record the
FIRST complete before8 or desired11 plus exact full content AND schema_version.
Every later complete durable observation must match that pin. before8->desired11,
desired11->before8, identity/live/receipt drift or schema-version drift within the
attempt faults; never reinterpret the last read as a later success. A complete
third/partial state cannot become the pin of an acceptable outcome. Own uncommitted
staged reads never set the durable pin. Before8 must have the original known
schema-version; desired11 must have the exact version positively captured by the
own complete staged schema read. Any alternate read exception is private to this
publication plan, never an option on ordinary reads. Only positive COMPLETE
classification installs the new operative eleven-object baseline. No retry can
silently clear an existing pin/evidence while reopening remains unresolved.

After positive publication on THIS original context, keep its existing identity-only
adapter operational with the validated11 schema baseline and known publication
state so ordinary SDK reads/writes do not spuriously poison cleanup. It still
exposes only identity keys, never live sporting rows. No sporting mutable adapter
in M2: live rows remain equal to the initial copy for this source context's lifetime.
Original source/prepared data remain immutable; existing destination identity rows
retain their already supported legitimate mutable behavior. No new original stamp
or second publication authority follows from this layout.

## Unknown outcomes, retry and cleanup

Durable publication, current authorization and positive cleanup evidence are
three separately retained internal facts. Source-only results have a finite code
(publication_confirmed/publication_unpublished/outcome_unresolved/fault_held/
publication_refused) and an observed-layout fact (before8/desired11/unknown).
Every SourceOwner result also retains mayIssue/mayPublish/mayMount=false. Keep this
new result vocabulary source-only rather than enlarge old generic quarantine
contracts. No credentials/rows/raw intent leave through the result.

Final matrix after the pinned complete durable observation:
- COMMIT NOT issued: positive transaction end/close/reopen and exact before8 prove
  publication_unpublished; healthy cleanup only without sticky native failure.
- COMMIT issued, ACK NOT confirmed, exact before8: outcome_unresolved (or fault_held
  if sticky native error), never automatic write retry or re-COMMIT.
- COMMIT positively ACK-confirmed, exact before8: contradiction => fault_held.
- COMMIT NOT issued + durable desired11: unexpected transaction state => fault_held
  WITH observedLayout=desired11 retained as physical fact. Never healthy confirmed,
  never retry or new authority. Mere matching bytes do not prove own publication.
- COMMIT issued + exact desired11 after positive durable reopen/readback: physical
  publication fact, even if original auth was revoked after issuance. The regular
  publication_confirmed branch REQUIRES commitIssued AND no sticky native/protocol
  fault; otherwise fault_held WITH desired11 retained as physical fact. No fresh
  auth/stamp/healthy cleanup evidence follows from bytes.
- Any third/partial/drifted state: fault_held. Unconfirmed reopen/end/readback:
  outcome_unresolved or fault_held when actual native failure is sticky. No repair.
Before any COMMIT, cancellation attempts rollback only after all acquired/issued
work settles. Consumed proof never revives; healthy confirmed-unpublished retry
needs new actual OTP/Control and M1 preparation. After any COMMIT issuance never
issue compensating deletes or another COMMIT/write while outcome remains unknown.
The SourceOwner MUST preserve the actual SQL result/physical fact after awaiting
publication; do not replace it with an obligatory false check against the consumed
original accountControlCurrent. Owner close/current status may revoke new actions,
but cannot turn physical desired11 into unpublished or imply authorization.

Unknown cleanup/reopen retains original owners and retry evidence. Positive release
still requires actual existing SQL/protected/SDK cleanup evidence; physical desired
state is not release evidence. Exact actual own close/dispose/queued work is excluded
without cycles; unrelated pending work delays finish/release. Old constructors
continue rejecting11 unchanged. A newly created source-aware8 constructor also
refuses11; source-free/cold published recognition is a later separate constructor,
not a global schema relaxation. Historical t1 alone or SQL singleton alone never
becomes admission. No construction of Dactive/sourceVerified from matching shape.

## Stages and evidence

M2a: strict source-only publication result/layout/readback/actual transaction and
private continuation on same SourceSQL; no production source-owner consumer yet.
Actual SDK/SQLite context tests using genuine M1 accepted draft and fresh protected
observation. Independent CODE gate before M2b.
M2b: no-argument actual SourceOwner publishPrepared integration; same actual SDK,
OTP/final Control, protected namespace and SQLite tests; combined CODE gate.
Then complete root/web/E2E+positive stop/mobile+actual3modes(defaultlast)/types/lints/
diff before subsequent published-host DESIGN. Record canonical contract, exact
verification once in readiness, concise architecture references and fresh Vault.

Required actual tests: exact all-profile/u16 copy/receipt/initial selection with
original8 unchanged; copy no toJSON/serializer; no direct live sporting grant.
Forged/proxied/copied observations/drafts/flags no reflection/issuance; no t1/wrong
pair/warm drift/read failure/stale/missing Control/source debt/wrong P no writes.
Repeated/concurrent publish/prepare/close, other accepted mutation/SDK command at
acquisition/BEGIN/each insert/validation/before COMMIT/held COMMIT/after commit,
no old proof revival. Valid pending SQL remains healthy and cleanup waits.
Native malformed getter/ACK/return/row metadata revokes before unrelated drain;
precise actual owned get/set/remove/anchor/credential/capability/dispose completions
settle without self/cross-lane cycles and never supply ACK/value. Native method
receiver/currentness and no later getters/issuance after revocation.
BEGIN/DDL/every insert/COMMIT beforeeffect/aftereffect/lostACK/reopen/readback errors,
partial/extra/altered schema/data/receipt, close and retry; actual SQLite rollback/
atomicity and reopen across physical files. Published same-context identity SDK
read/write remains safe/healthy; close/store-only retry preserves exact receipts.
All old constructors/default/source8 contracts and actual normal bundle guards.
No physical durability claim from desktop SQL. No full Beta/import completion.

Allowed files: installationTransferQuarantineSql.ts and one internal pure SQL-layout
helper if justified; installationTransferPairing.ts (M2b only); exact direct tests,
architecture/bundle guards and canonical docs. Native core/port/runtime edits only
if narrowly necessary and separately surfaced in DESIGN review, not silently.
No changes to actual AuthHost/private preparation capture, normal Tracker or UI in M2.


## Narrow implementation-discovered amendment — storage health after close

The existing nativeRuntimeCurrent requires !session.closed. It therefore cannot
serve as the final health test after healthy reentrant host/pair close: physical
publication classification must still run with owners held, without converting
normal lifecycle closure into a storage fault. SQL-local fault does not observe
independent credential/protocol failures, so merely ignoring session health would
incorrectly report a healthy publication after actual protected-store failure.

Permit one narrow nativeCombinedRuntime internal inspector,
nativeRuntimeStorageHealthy(session): boolean. It reads ONLY genuine sessions
WeakMap membership and domain/credential/protocol health; returns false for forged
sessions. It deliberately excludes active/closed lifecycle and grants no operation,
activation, cleanup or ownership. Sole production consumer is SourceSQL's final
factual publication classification; exact architecture consumer guard. Existing
nativeRuntimeCurrent and all legacy paths remain unchanged. No new registry,
state transition, caller callback, pair argument or public runtime property.

Use this health fact with SQL-local !fault at final classification. Actual close
still revokes COMMIT permission immediately through ordinary source/owner checks;
physical after-issued-COMMIT result remains factual. Actual pending unrelated work
must settle before classification and cleanup. Positive pair disposal continues
requiring its own original SQL/protected/SDK receipts and health, independently
of publication result. Add actual host/pair-close before COMMIT and during held
COMMIT/reopen controls plus genuine credential failure during publication to prove
healthy closure is distinct from sticky native faults. No normal admission can
use this inspector. This narrow DESIGN amendment was independently accepted before implementation.


#### S6m2a — source SQL implementation; independently accepted

The original core has a source-context-only publication task, retaining the genuine accepted M1 draft and consuming its original stamps through an exclusive mutation sequence. It copies all original u16 rows plus exact intent/digest in one actual transaction. Separate queue ownership survives revocation through rollback/reopen/classification/drain. Existing ready predicates remain unchanged; source get/mutate/anchor entry may queue behind that held task but cannot execute without ready.

Own staged schema reads are separate from durable reads. Complete durable discovery pins first before8/desired11 with content and schema version. Any later contradicting initial version immediately revokes before further queries; content drift is never reinterpreted. Only healthy positive final classification installs this context's eleven-object baseline; the existing identity-only SDK stays operational. Old/cold constructors refuse eleven objects; source-free published recognition remains a separate stage. Normal close is distinguished from storage failure by the accepted private health-only inspector; no operation or cleanup authority follows. Physical facts and sticky failures remain distinct. Unknown/held outcomes preserve resources without repair.

Every genuine source SQL task, pairing, runtime preparation and cleanup outward completion, including necessary queue aliases, is registered before deferred work. Exact own completions supply no value, ACK or grant and are excluded from self-dependent drainage. Unrelated acquired work remains joined.

M1 accept retains its candidate privately until after the same task's last acquired-work drain. It then renews original currentness, genuine observation and exact bytes synchronously, installs the accepted draft and captures the latest issued occurrence with no later await. An observation completed during that drain is old; SDK revocation during it returns false.

Parent finalized focus19 files/1294 tests PASS, actual host238/M2a63. Corrected independent final7 files/734 tests PASS, including the full actual host and affected M1/schema/completion/runtime controls; TypeScript/scoped lint/diff PASS. Prior broad independent20/1360 and eight original failure witnesses identified the corrected boundaries. Logs:/tmp/curling-s6m2a-finalized-{accept,focus,types,lint}.log and /tmp/curling-s6m2a-finalized-independent-*.log. M2a CODE passed before M2b implementation.

#### S6m2a accepted observation-occurrence amendment

The confirmed old genuine-observation replay needs occurrence information that the current genuine observation record does not contain. Extend only installationTransferPublicationProtocol.ts's private genuine AnchorObservation with a module-owned monotonically increasing safe-integer occurrence and a trusted function returning the latest issued occurrence. Increment only when the existing sole actual protected-port producer successfully records a genuine observation; refuse recording on exhausted MAX_SAFE_INTEGER, never wrap. No caller occurrence, clock, readiness flag, protocol wire field, constructor option or extra read/queue. The existing actual protected port producer call remains unchanged.

At successful M1 acceptPublicationAnchor, synchronously retain the current latest issued occurrence alongside the already strongly retained accepted draft. M2 requires its actual genuine observation occurrence to be strictly greater than that accepted boundary, in addition to all existing genuine/current/exact raw/Q/M/pair checks. Capturing the latest issued occurrence (not only the accepted handle's occurrence) rejects a distinct handle already read before accept even if SQL has never seen it. The counter is module-global; unrelated ports may advance the boundary but cannot pass the existing same-pair provenance/currentness checks or supply an occurrence. Later actual same-port reads remain eligible. Occurrence orders successful producer observations, not physical storage mutations.

This is a private freshness fact on the existing provenance record, not a new proof/grant, public API or admission layer. Existing observation consumers ignore these additive trusted fields. It does not guarantee against a physical mutation after a genuinely new successful read. All generic credential formats, native SDK policies, flags, source helper, old constructors and normal host/UI remain unchanged. Architecture consumer lists remain exact and unchanged.

Required actual SDK/SQLite cases: exact M1-accept replay; older M1-prepare replay; distinct pre-accept observation never shown to SQL (including issued after the accepted handle but before accept completes); a later actual new observation succeeds; actual warm t1 loss is refused. Preserve healthy cancellation/retry and genuine completion registration.

This narrow amendment received independent DESIGN PASS before production edits; the final synchronous after-drain acceptance boundary described above governs its timing.

#### S6m2b — actual source-owner integration; independently accepted

The actual source owner now has a no-argument, single-flight publication operation. It captures its actual pair/namespace/manifest and original Control, registers the precise outward completion before work and performs a new actual protected capability read outside the SQL queue. Only the resulting genuine observation enters the accepted SQL operation. No caller observation, bytes, readiness, pair or timestamp are accepted.

The finite frozen source report preserves actual SQL code and observedLayout, including factual issued-COMMIT outcomes after the original stamps are consumed or auth/owner-close revokes further work. It always reports mayIssue/mayPublish/mayMount false. A protected or genuine pair/owner storage failure before SQL returns fault_held/unknown; healthy cancellation/refusal supplies no grant. Existing pending ownership joins preparation/publication/close without a second queue. Exact SourceOwner completions acquired by native SQL/protected methods are exclusion-only facts. Pure owned protected refusal remains healthy according to the existing port policy; SQL native contract failures retain their existing sticky failure behavior.

The operation remains confined to the source owner and SourceSQL. No AuthHost/runtime/UI consumer, source-free host, ordinary sporting adapter, Tracker binding, source-helper change, activation or physical acceptance is introduced. Combined independent CODE and the complete local baseline have passed.

Parent corrected combined M2a/M2b focus19 files/1324 tests PASS (95.97s), actual SDK/SQLite host268 cases, including63 M2a and30 M2b cases. M2b covers actual fresh protected contradictions, pre-claim stale SDK/identity facts, healthy rollback, factual post-COMMIT revocation, copy/COMMIT/reopen close, eight actual native uncertainty edges, actual outward SQL/protected completion exclusion and pending preparation/close. Protected completion tests use a direct captured native method (no fixture async assimilation). TypeScript, scoped lint and diff PASS. Logs:/tmp/curling-s6m2-corrected-{focus,types,lint}.log. Corrected combined independent CODE and full local baseline passed; exact baseline evidence is in TESTFLIGHT_READINESS.md S6m2.

Before any actual SQL publication result is obtained, the source owner distinguishes sticky domain/credential/protocol or owner failure from healthy cancellation using its genuine existing pair health. The fresh protected read can itself fail while acquiring the SQL anchor even when the protected namespace remains healthy. Such failures report fault_held/unknown and retain evidence. Pure healthy protected-owned exclusion, SDK supersession and healthy close remain refused. No actual SQL publication result is rewritten. Permanent real SDK/SQLite controls cover malformed and own-completion anchor failures, healthy SDK supersession and pending M1 followed by a successful M2.

Corrected combined independent CODE PASS:8 files/851 tests, including all268 actual host cases and prior close/outcome/freshness/completion controls; TypeScript/scoped lint/diff PASS. Log:/tmp/curling-s6m2-corrected-independent-focus.log. No remaining confirmed defect. The full parent baseline passed; exact evidence is in TESTFLIGHT_READINESS.md S6m2. No operative import, device or Beta acceptance.

S6m2 is locally accepted after independent DESIGN, corrected M2a CODE, corrected combined M2a/M2b CODE and the complete parent baseline. Full counts/logs are canonical in TESTFLIGHT_READINESS.md S6m2. Source-free published recognition, positive original SDK/store quiescence and handoff, ordinary sporting/Tracker/UI composition, source writer exclusion/transport and physical/hosted/Apple acceptance remain separate gates. Q4 is not approved; Free/Personal/Team and Q1/Q3 are unchanged. No real backup, configuration, phone, account, hosted, index/ref/Git, activation, signing, installation or release mutation occurred.


### S6m3a — source-free published binding (independent DESIGN/CODE accepted; runtime integration pending)

## Goal and stage boundary

M2a/M2b DESIGN, corrected independent CODE and the complete local baseline are accepted. The source owner can physically publish exact desired11 but still exposes only an identity-only runtime and false may-fields. Old and cold constructors correctly refuse eleven objects. Next establish a separate authentic cold recovery of the published binding from the actual SQL and protected stores, without original file or recovery code. M3a establishes only a private artifact-origin binding and positive cleanup, no runtime drafts, SDK, ordinary sporting access, Tracker or UI.

M3b will separately design/implement the actual published SQL/credential runtime and preserved negative guards. M3c will separately design/implement the configured normal host, real original SDK quiescence/positive store close/reacquisition and normal Tracker composition. Each has its own independent DESIGN/CODE gate. Full combined baseline follows actual host integration. No implementation of M3b/c in M3a.

Repository /Users/timhofer/curling-release-mvp, branch main; HEAD/main/origin/main 382ee40d37605b302c11b6390305857c7e2c3fde. Preserve 0 staged/85 modified/206 untracked. No Git mutation, env/config values, source helpers, actual archives, phone, hosted, activation, install/sign/release. Parent implements; reuse the existing explicitly authorized read-only reviewer only. Work stops for a genuine product question, none currently identified for this private binding prerequisite.

## Existing facts and non-grants

The exact 11-object publication consists of the original8 plus publication receipt/live/index. All original prepared rows, protected wire, Q/M and source-denial v2 are immutable original evidence. Identity rows, current SDK I values and ordinary live sporting rows are mutable after publication. t1's selectedProfileId/accountScopeId/Control are historical initial publication facts, not current auth, future account/Profile allowlists, tiers or entitlement. Free/Personal/Team and Q1/Q3 remain unchanged. No supplied true/sourceVerified/Dactive/ready flag substitutes for actual evidence. Do not mint an original decrypted SourceDenialHandle from shape or relabel cold metadata as the original SourceVerified archive proof.

The existing training-only real backup is not a V3 source. M3a does not read it or invent absent identity facts. Existing source capture permissions do not extend to new identity recapture. Coherent SQL+Keychain backup rollback Q4 remains unapproved and undetectable locally under the existing documented boundary. No release waiver follows.

## One actual owner/core and separate closed constructor

Add only a distinct closed published SQL constructor/facade and a distinct private published owner, never broaden any existing public/default/cold constructor. The SQL constructor composes the existing createNativeTransferQuarantineContext installer and its actual core/lease/queue/engine lifecycle. It does not create a sidecar reader or another queue/owner underneath an active source runtime. Existing global SQL/protected ownership must refuse coexistence; a fresh store owner is allowed only after the preceding store owner actually closes/retires or on a true cold start. This guarantees store exclusivity only, not SDK quiescence or SDK reservation release. An old host may have positively retired both stores while terminal SDK cleanup failed and its SDK reservation remains held. M3a can then establish at most private read-only artifact provenance with every may-field false; it cannot confirm host/runtime/handoff success or release the SDK reservation.

Prefer extending the same strict layout/read machinery in installationTransferQuarantineSql.ts with a private published-only mode; its returned frozen facade exposes only the new cold-binding operations and existing actual cleanup receipts. No caller-selectable mode/strategy, supplied pair, prepared record, stamps, digest or reader. Existing sourceVerified/sourceReady/M1/M2 paths stay unchanged and the published facade exposes none of them. A source-aware constructor must still refuse11; the published constructor must refuse0/1/3/4/5/7/8/9/10/foreign/mixed layouts, with no DDL/DML, initialization, repair or fallback.

The new owner has no-argument inspect/verify and close operations returning frozen finite codes with all may-fields false. It captures internal options exactly once through the existing owned-work discipline. It creates exactly one real published SQL context and one actual publication credential port/namespace lease, and is the sole production consumer of those constructors. No original installationTransfer input/file/code is accepted. It uses actual captured provider configuration identity/root/platform; a configured app-facing factory remains M3c.

## Cold candidate is read-only data, not authority

On the original queue, reserve/open the actual SQL context and strictly inspect exact11 schema, column/index definitions and original bounded static rows. Return only an internal candidate sufficient for the owner to route an actual protected read: actual parsed boundQ and original manifest, tied to this exact context/snapshot/schema. This is not a runtime/proof, and must not escape the owner as a structural public grant.

Validate the unchanged original prepared table with its accepted finite source bounds (416 rows/key256/3MiB raw), exact ordered slots/keys/u16/digests, source-denial v2 shape/package digest, canonical original Q/M/bound Q and exact original receipt raw/digest/canonical t1. Validate live table/index shape but do not enumerate/hash its mutable rows as immutable source evidence and do not require equality with original prepared rows on cold restarts: future legitimate training changes must survive. Identity rows retain the already accepted source identity bounds/shape during cold binding. Original source budgets apply only to original evidence, not later training retention. M3b must use addressed live reads and normal persistence semantics rather than a source-size retention cap; M3a introduces no live reader/writer.

No initial untrusted SQL value constitutes source authenticity. Candidate parsing supplies only bounded data for subsequent actual protected-store observation. No account, Profile, DTO, current Control, raw payload or mutable live map is returned publicly.

## Actual protected observation, outside SQL queue

The owner acquires the original actual protected namespace via createPublicationTransferCredentialMigrationPort and its existing publication capability, in migration/read-only mode. Using only the actual internal SQL candidate's boundQ/manifest, perform a new real capability.read outside the SQL queue. The existing port validates actual complete inventory, exact actual M, all current-epoch canonical I values and exact canonical t1 twice with existing role/currentness/namespace ownership. No protected writes, old credential adoption, caller projection or simulated absence. Existing generic physical formats/SDK policies/default ports remain unchanged.

Actual namespace refusal/fault, missing t1/M, wrong config/root/epoch/pair, foreign keys, unsupported values, uncertain native work, cancellation or close do not produce a proof. Mutable legitimate SDK I additions/replacements/removals from prior healthy published sessions remain allowed; do not compare current I to original migration values.

## Same-core binding validation and genuine proof

Pass only that genuine actual observation back into the same published SQL context after the protected task has settled. Re-read the complete static candidate/snapshot/schema and check original currentness. A candidate cannot be repinned after drift. Validate exact observed raw t1 against actual receipt raw and canonical pair Q/M fields; recompute standard SHA bindings with the accepted owned platform SHA adapter:
- anchorDigest = SHA256(tuple(installation-publication-anchor/v1, exact t1 ASCII)); equals actual receipt digest.
- protectedWireDigest = SHA256(tuple(installation-published-wire/v1, exact original stored protected wire)).
- preparedDigest = SHA256(tuple(installation-published-sporting/v1, original packageDigest, canonical complete prepared rows JSON)), with identical M1 framing/budgets and no Profile filter/remap.
- sourceDenialDigest = SHA256(tuple(installation-source-denial/v2, original packageDigest, exact original source projection ASCII)); equals actual stored source digest and t1 source digest.
- exact package digest, original sorted Profile membership and historical selectedProfileId/source initial eligibility remain internally consistent. The historical source-account constraint checks only the historical anchor, never a future current account.

A genuinely observed protected intent authenticates this immutable artifact binding; structural parsing/hash equality alone never does. Preserve the accepted observation-at-read contract; this does not claim continuous physical storage monitoring or detect a coherent old SQL+Keychain restoration. No protected call while SQL queue is held.

Use the existing actual owned SHA path, budget before avoidable allocation, no caller fingerprint. source-denial hashing needs its own fixed v2 tag/bound through the same closed publication hash helper, not a default adapter override. Preserve all old hash bounds/constructors; add the exact architecture consumer edge only where needed. Drain acquired platform/native work fully, with no arbitrary Promise-graph or timeout rescue.

After the hash work has settled, re-read the original complete static candidate/snapshot/schema on the same core and compare it with the originally pinned candidate before accepting any binding; drift during a held hash must be observed, not repinned. Finish that read’s acquired-work drain and renew original currentness. With no later await, synchronously mint one private frozen opaque PublishedInstallationBinding in a dedicated WeakMap module. Its only production producer is the actual published SQL context. Fields remain private and immutable: actual context identity, verified exact t1/anchor, original source negative projection, static binding identity/schema and context/owner currentness closure. It is artifact-origin provenance only, not a Profile/auth/cleanup grant. Fake/copied/proxied/wrapped objects must fail identity-only inspection without reflection. The originating context retains the binding strongly; close/fault/schema/static drift invalidate its operational currentness. No SourceDenialHandle is forged; later M3b may add a separate genuine-binding consumer to the existing negative guard composition after its own accepted design.

The owner may retain that genuine handle privately but never return it as an app runtime, may flag or caller-supplied input for another owner. M3b's draft preparation will occur on this same genuine owner/context, not by handing a structurally supplied proof to a new factory. M3a tests may inspect the real proof through its closed internal inspector to prove provenance; production consumers remain exactly guarded.

## Ownership, cancellation, repeated calls and cleanup

Register every actual outward SQL/port/owner completion and needed queue alias before first work; exact genuine completion exclusion supplies no value/ACK/grant. Includes candidate, binding validation, SHA/capability, close and cleanup work. Retain unrelated getter/metadata/fulfillment work through settlement. No cyclic ownership predicates, new queue, after-the-fact receipt, fake lease or caller policy.

Single-flight actual owner verification, no-argument calls. Owner close revokes further work synchronously before joining the pending operation and actual native cleanup. Pure healthy supersession/cancellation refuses without sticky failure. Malformed/contradictory/uncertain native SQL/protected facts revoke their genuine lane before drain and retain evidence. Distinguish native storage health from healthy lifecycle closure using existing genuine facts only; do not extend the health-only inspector into operation/readiness authority. SQL/context and protected cleanup use their actual original receipts and positive release/retirement checks. Unknown cleanup holds owners; do not claim absence/retire/repair. Retry only uses the same retained owner resources and actual cleanup semantics, no fresh owner over an uncertain old one.

Suggested finite public owner code set: binding_confirmed (private provenance retained, may-fields false), binding_refused, fault_held, cleanup_held, closed. No auth/sporting success meaning follows. No raw binding/profile/account or database content in reports/logs.

## Required actual verification

Use genuine corrected M2 source flow to create desired11 in real disposable SQLite with installed SDK + synthetic bridge/API, positively dispose that actual old host, then construct the new source-free owner with only ordinary captured migration options. Do not fabricate a published proof or t1. Never use the real user backup or phone.

Positive controls: exact all-Profile/u16 artifacts authenticate without original file/code; source input getters are never consulted; actual current SDK I changes survive cold recognition; initial live rows may be legitimately changed/added/removed between sessions and later values larger than original source limits do not prevent static binding (no live enumeration/retention cap); successful cleanup/reacquire; ordinary identity mutations from prior sessions remain data, not copied current auth grants. No Tracker registration or runtime ready publication.

Negative matrix: every wrong/partial/foreign layout, original source/prepared/wire/receipt/Q/M mutation, static content/schema drift while the actual protected read/hash is held, canonical but nonmatching actual t1, wrong namespace/config/root/epoch/inventory/I, missing/unreadable/uncertain protected values; fake/copied/proxy observations/proofs; arbitrary candidate input cannot create a binding. Preserve all eight original objects/data and no write/repair on refusal.

Adversarial ownership: exact actual SQL/credential/owner/close/SHA completions returned as acquired native methods/results cannot block their queue or become values/ACKs; direct synchronous throws and unrelated malformed pending work revoke immediately and drain before cleanup; healthy pending work and close remain distinguishable. Repeated verify/close, close before/during native/hash work, currentness lost during final drain, retained uncertain release, and a second actual store owner while SQL/protected resources remain active/held must refuse without takeover. Separately exercise an SDK-only-held original host whose two stores were positively retired: any M3a confirmation remains private artifact provenance/all may-fields false, and cannot clear or bypass the original SDK reservation. Preserve the actual normal-host ownership refusal for that root. This case does not count as SDK/host/handoff success. A newly settled positive observation/proof cannot be published before its original actual work and final currentness checks settle.

Focused parent/independent existing M1/M2/source/default/legacy regressions, types/scoped lint/diff. Full parent baseline follows combined M3c actual host gate; M3a itself is never whole-import or Beta acceptance. Reconcile canonical contracts/architecture edges without duplicating volatile evidence. Save substantive accepted progress to the canonical Vault page and log, preserving parallel updates. No commit/stage/ref changes.

## Allowed production surfaces

installationTransferQuarantineSql.ts (new closed published constructor/read-only binding facade), installationTransferPublicationProtocol.ts (fixed owned source-v2 SHA helper case only), a small dedicated installationPublishedBinding.ts and installationPublishedOwner.ts (names may be adjusted consistently), existing native credential publication port/namespace only for genuinely necessary narrow read-only reuse with exact constructor behavior preserved. No Swift/source helper/flags/normal host/runtime/Tracker/UI changes. Existing negative source guard code is not changed until M3b DESIGN. Exact architecture tests, real synthetic SQL/SDK tests and canonical docs only. Surface a concrete broader seam before production edits if this graph cannot implement the accepted contract.

## Later M3c constraint from the actual SDK constructor

The actual supabaseClient constructOnce fence retains nativeConstructedRoots after positive reservation release. Even a healthy original Host.dispose cannot construct a second SDK for the same root in the same JavaScript realm. M3a must not change/reset that fence or use another root/config to bypass it. M3c must explicitly honor a real cold restart or obtain a separate accepted narrow lifecycle design before implementing any same-realm handoff. A read-only binding success has no bearing on that constraint. All UI/source flow consequences remain in their later design, not an inferred M3a release decision.

## Narrow completion-inspector implementation seam

Cold M3a has no activated runtime/session and must not fabricate one merely to share completions. The existing SQL sourceCompletion and publication credential port already privately register actual outward/queue completions before work. Add an exclusion-only local inspector on the genuine published SQL facade and an additive ownsCompletion(value) method on the existing genuine publication capability. Each reads ONLY its own private completion WeakSet, not any external ownership predicate, so neither can recurse. The new actual owner owns(value) combines its exact pending/closing promises with these two genuine local inspections (and precise factory/acquisition completions it actually captures). SQL and protected work can therefore recognize each other's direct actual producers without a runtime/session, second registry, structural readiness or caller facts.

The capability is still obtained solely through the actual port WeakMap; copied/fake ports cannot supply an inspector. The SQL facade is constructed only by the actual closed published constructor. Both inspectors are exclusion-only: no value/ACK/grant/evidence, currentness, lease claim or operation permission. Old source/default owners do not consume the additive inspector and their behavior stays unchanged. Exact architecture boundaries admit only the new published owner as the added capability/constructor consumer. Include direct genuine cross-lane candidate/verification/cleanup/capability/acquire/release completions in the cycle matrix; no Promise wrappers, recursive callback graph or after-start registration. This concrete narrow port capability addition must receive DESIGN acceptance before editing that production surface.


Independent DESIGN PASS covers the original candidate, store-vs-SDK exclusivity clarification, post-hash full static reread/final drain and local exclusion-only completion inspectors. No M3 runtime/host/Tracker/UI or SDK lifecycle modification is authorized by this prerequisite.


S6m3a implementation is independently locally accepted. The closed published owner verifies genuine exact11 provenance through the same real SQL core and actual protected namespace, then retains only a private migration-role binding. The original static artifact and receipt are checked with standard fixed framing and a full post-hash reread; mutable live data is neither enumerated nor capped as source evidence. Old constructors remain exact. Same-owner completion inspectors are local exclusion-only facts, not runtime/session authority. SQL/protected exclusivity is distinct from an SDK-only-held reservation, which remains blocked for normal host construction.

The corrected owner retains even inadmissible acquired options-root work without adopting it as configuration, validates each field before further acquisition, checks currentness before/after descriptors and ownKeys, and joins all acquired work before reporting or cleanup. Published native read/open/configuration throws revoke before drainage; healthy cancellation remains distinct. Positive cleanup uses original receipts; unknown cleanup retains ownership for the same owner's retry. Independent corrected CODE has no remaining confirmed defect; exact focused evidence and limits are in TESTFLIGHT_READINESS.md S6m3a. No SDK, paired published runtime, current identity/Profile/Tracker/UI or operative/Beta grant follows. M3b runtime/negative guards and M3c actual configured host remain separately gated; full combined application baseline follows that integration.


### S6m3b — published runtime and negative guards (corrected DESIGN and both CODE gates accepted)


## Authority, preflight and stage boundary

Implement only after independent S6m3a CODE PASS and this complete M3b DESIGN gate. Parent implements in /Users/timhofer/curling-release-mvp, main; HEAD/main/origin/main382ee40d37605b302c11b6390305857c7e2c3fde;0 staged/85 modified/208 untracked before M3b. Preserve the full existing tree. Re-read docs/AI_DEVELOPMENT_WORKFLOW.md, canonical MOBILE_APP_MIGRATION S6l4/5/M1/M2/M3a, actual runtime/port/negative-guard code and relevant ADR0054. No stage/commit/patch/ref/PR/push, env/config values, .env.local, actual archives/backups, device, source helpers, Swift, hosted, activation or release. Stop for a genuine product decision; none is needed for this dormant storage prerequisite. Existing user-authorized read-only reviewer only, no implementation delegation.

M3a establishes only source-free provenance of exact11 on the actual SQL/protected pair. M3b adds actual paired runtime adapters on THAT SAME genuine owner/context/lease, plus the existing original negative deletion guards through a distinct genuine published-binding consumer. It does not integrate a configured normal AuthHost, SDK, Profile/Tracker/UI or original-host handoff. That is separately gated M3c. Full combined baseline follows the M3c CODE gate; focused actual SQL/SDK/source/default/legacy regressions and types/scoped lint/diff are required here.

Free/Personal/Team and closed Free Beta are unchanged. Historical t1 account/selectedProfile/Control is not current login, a future account/Profile allowlist, subscription, or cleanup grant. A real original source handle/SourceVerified/Dactive is never forged or set. Original source account and selection constraints remain historical publication checks. Q1 permits further exercises/blocks in the SAME begun Session, never a new Session; Q3 verified old credential removal is approved; coherent SQL+Keychain rollback Q4 is NOT approved or fixed. No source-free runtime grant waives release gates.

## Concrete existing seams and invariants

The closed createPublishedInstallationSql facade is created only by createPublishedInstallationOwner and uses the existing createNativeTransferQuarantineContext installer/core/lease/queue. Original constructors still refuse11. New binding is a private genuine WeakMap fact, not current identity. Its currentness currently requires migration role and exact original observed record, including identity. A legitimate runtime identity write must not be implemented by broadening this cold proof's meaning. Instead explicitly consume its CURRENT genuine provenance at a one-way private preparation transition, retain immutable source facts for negative constraints, and derive actual runtime rights from a genuine new session and actual same-core prepared drafts.

Existing prepareIdentityRuntime is sourceVerified-gated and identity-only. Leave it and every old mode unchanged. Existing prepareTransferIdentityCredentialRuntime looks up the genuine port but does not itself authenticate the supplied lease/Q/M/domain arguments. Their causal provenance currently comes from its actual closed owner. Leave that existing path unchanged. M3b2 instead adds the narrowly specified new publication-capability preparation below, deriving its pair from that actual port’s genuine last observation and retaining all descriptor work. It must not receive a supplied stand-in adapter/lease/session. The existing publisher's paired prepare/activate/cleanup algorithm is already genuine and synchronous; add a distinctly named closed published publisher that reuses buildRuntimePair(...,true) with its exact actual owner as sole added caller. Do not weaken old publisher checks or fake a session for completion sharing.

The source-negative guard module currently accepts only actual SourceDenialHandle. Add a separate constructor resolving only genuine PublishedInstallationBinding at its still-current cold boundary. A private common builder may share already validated immutable original guard facts; old constructor continues resolving only SourceDenialHandle. No shape-based fallback, caller facts, false source handle or source digest recast. Guard facts are negative-only and never login/grant evidence.

## One-way same-owner runtime preparation

Extend only the published SQL facade with a closed preparePublishedRuntime(binding,session,ownerCurrent) seam. It accepts only the exact retained genuine binding minted by that context, while still current, and a genuine prepared runtime session. No caller-supplied static record, modes or readiness. On the original queue, re-read the complete original static evidence/current identity/schema against the cold candidate, drain actual work, renew actual original currentness and prepare a genuine domain draft. Preparation must not return a usable draft before that last drain/currentness check. Role transition is synchronous with no later foreign await/callback between final authority check and draft publication. Close during preparation keeps actual acquired resources until drained; it yields no pair.

Cold binding currentness remains migration-only and need not survive the prepared/runtime role. Capture the original immutable origin/source facts while genuine binding is current, before changing role; an explicit private prepared-origin cell/session on the same context thereafter authenticates runtime operations. It must retain exact original wire/prepared/pair/source/receipt and schema, not mutable identity/live rows. Do not bypass the old sourceVerified gate by assigning it true. No old preparation function or public flag chooses this route.

Extend the actual owner with no-argument handoff() that single-flights before its first work and returns only a genuine NativeCombinedRuntimePair or null to its future private configured-host caller. The first handoff always performs a fresh complete actual M3a verification on this owner, even if a prior verify retained a binding; do not reuse an arbitrarily old cold observation as this transition’s fresh read. Retain the resulting actual opaque binding internally. The established observation-at-read contract remains explicit, without claiming continuous physical monitoring after that read. Prepare the published negative guard owner while the binding is genuinely current; then create the actual session, prepare the same actual SQL draft and actual credential draft through the new genuine publication capability preparation, and synchronously publish one actual paired runtime. Before the one-way proof consumption a healthy refused preparation may freshly verify again. After consumption, any failed/late preparation leaves this context/owner cleanup-only forever, abandons only its own actual drafts/session and retains cleanup obligations. Abandon never returns this published context to migration or reactivates a consumed proof. It never fabricates absence or creates a second store owner. Repeated handoff returns the same current genuine pair, never another session/lease. verify remains all-may-fields false and may refuse once this owner has moved into runtime. close synchronously revokes pending work and joins it.

The owner privately retains the guard owner and exposes only a closed source-guard repository seam for the future actual host, using ITS OWN actual runtime pair.domain, not a supplied adapter. A trusted host-current predicate restricts it further but is no positive identity authority. It must not expose original facts or a source handle. Actual host/API/SDK binding of control observations remains M3c; M3b does not invent a control result or resolve a product question.

## Addressed mutable live data and bounded original evidence

The new genuine domain adapter routes exact supported identity keys to installation_transfer_identity_v1 with the existing accepted shape/4096-row/1MiB-value/4MiB-aggregate rules. Unknown identity/control keys refuse. Ordinary nonidentity data uses installation_transfer_live_v1 with addressed key reads/writes/removes. Preserve the existing ordinary native reserved namespace rejection (nativeMigration, credential, installationTransfer and sb-); neither route exposes immutable import tables, source metadata or protected credentials. Later legitimate canonical Profile keys are not restricted to original t1 Profile membership. The actual normal Profile/Tracker scope still grants sporting access later; returning a private pair here is not login or mount.

Original evidence remains finite and fully validated by the accepted cold path: original prepared table <=416 rows, key256,3MiB raw; wire/source budgets unchanged. Do not enumerate, hash, compare with the initial copy, or cap mutable live rows by source budgets. On each actual runtime control observation, preserve strict schema and exact unchanged original wire/prepared/Q/M/source/receipt against the retained original pin using the same existing strict read machinery; current identity is separately checked/updated by actual own mutations. Generalize no old same()/read rules. A private published-runtime static comparison, if necessary, excludes ONLY mutable identity/live, not any original evidence. publishedVersion/runtime schema remain exact. No repinning after drift, DDL, repair or fallback.

Live storage uses the existing u16 ASCII representation so exact whitespace, numeric spelling, lone surrogates and embedded zero survive SQL/native bridges. The source encoder/decoder currently has a1MiB bound: do NOT use it as a future training retention cap or change its old defaults. Add private published-live-only encode/decode/validation functions (or a narrowly named separate module) with chunked exact code-unit handling and no source import row/value/aggregate budget. JS/native SQLite resource failures follow ordinary input/native failure semantics, not an invented source-size quota. A future live value >3MiB and >416 live entries must actually work in disposable SQLite. No unnecessary full live-map allocation. Validate actual addressed replies as exact bounded result SHAPE (0/1 row), own plain data descriptors, value is canonical u16; do not coerce, truncate or normalize. Initial live rows remain unchanged until an actual normal mutation requests it.

## Actual SQL transactions, freshness and failure evidence

Use the SAME actual core queue, connection, engine, lease and captured native methods/receivers. All mutation protocol and ACK/readback evidence is actual. Capture native begin/run/commit/rollback methods with owned descriptor discipline before BEGIN; renew currentness before each actual native issue and after settlement. For addressed live mutation, read actual current addressed value; under BEGIN recheck original controls and addressed before state, conditionally INSERT/UPDATE/DELETE with expected old value, validate exact actual run ACK/count, addressed desired readback and unchanged controls, then COMMIT ACK and durable desired readback. Identity mutation retains original accepted full identity projection and capacity checks. A missing removal may be verified idempotent success without DML. No successful mutation from an old ACK, stale snapshot, other queue or expected value alone.

Malformed/rejected native methods/results, ambiguous transaction outcome, static/schema contradiction or bad readback revoke the genuine lane before draining acquired work/rollback. Retain uncertainty; no automatic replay/repair/reacquisition. Healthy cancellation before issue/while unrelated pending work remains distinct from sticky storage failure; late factual COMMIT does not turn a closed context into a successful public operation. Record real NativeRuntimeEvidence/transaction/cleanup fields as existing consumers require. Credential failure alone preserves the existing Q1 same-Session lifetime policy, domain/protocol failure revokes corresponding actual rights through normal runtime notifications. Do not silently alter failure policy or host lifetime semantics here.

Draft anchor() is a real same-core static/current control observation returning an actual private token. anchorCurrent checks its genuine membership, actual session/lease/role/current generation; successful ordinary Identity/Live writes do NOT invalidate this storage anchor. It authenticates the same stable store/static pair, not a current identity-revision snapshot. Close, actual domain/protocol failure, lease/lifecycle loss or original static/schema contradiction invalidate it. Identity/auth freshness remains the actual higher-layer coordinator’s responsibility. Credential runtime's actual M/I operation must never await protected work while holding SQL queue; SQL never calls protected runtime from within its queue. Original actual protected t1/M/I inventory remains checked by M3a and actual credential preparation. Existing publication/default port behavior and physical slots/codec policies stay unchanged.

## Completion ownership and cleanup

Register exact outward owner/handoff/SQL/runtime/credential/dispose completions and necessary queue aliases BEFORE first acquisition. Reuse the M3a actual local SQL/port inspectors, actual runtime session registry after genuine pair publication, and the genuine guard owner's local completion inspector. No recursive ownership predicates, arbitrary Promise graph, new second registry/queue or timeout rescue. A true direct producer completion is exclusion only, never value/ACK/Ready/evidence. Retain unrelated malformed/getter/metadata work through settlement. Native throws, result assimilation and cleanup must be reviewed as new abstraction failure modes.

Once an actual pair exists, owner close uses that pair's actual dispose path and same retained resources, not concurrent independent SQL/credential cleanup over its runtime drafts. Genuine successful paired disposal positively closes/retire both and lets the owner clear its own lease references. Unknown cleanup retains ownership, can retry only that same actual healthy pair/owner; evidence-held is sticky. Before a pair exists, retain M3a actual SQL/credential cleanup and late-acquisition handling. The new domain draft's close/releaseReady/retire must use original real core receipts; protected draft uses original namespace receipts. SDK is not created/released here. SDK-only-held prior reservation still blocks future host construction; no session pair success is SDK/host/handoff success.

## Verification and acceptance matrix

Start with corrected actual M2 source publication, real disposable SQLite, installed SDK and synthetic bridge/API. Positively dispose actual old stores/host, construct genuine M3a owner, then actual handoff. No fabricated source/proof/session/drafts/pair/receipt. Test actual initial all-Profile/u16 rows; addressed read/write/remove, absence, exact raw whitespace/numeric/lone-surrogate/zero; later Profile, >3MiB live value and >416 live rows, removal/mutation retained through actual positive close/reacquire; original8/receipt/t1 immutable; no source file/code input or legacy storage access; SDK I additions/removals/replacements through actual new credential runtime and real SQL anchor. Initial identity reads/data remain data, no app admission/Tracker registration.

Negative/adversarial: fake/copied/proxy binding/session/observation cannot prepare; exact old constructor refusal11 preserved; schema/static/pair/receipt/source drift before/during held runtime prep, native/hash/final drain cancellation; unsupported/reserved keys and wrong value refusal without I/O; malformed addressed read/rows/ACK/readback, wrong counts/keys, row changed during BEGIN, statement/COMMIT/rollback/reopen ambiguity, direct sync throw at each native method, missing method/getter side effects, retained unrelated pending malformed work revoked before drain; direct actual cross-lane handoff/owner/runtime/anchor/get/set/remove/capability/close/dispose/SHA producer completions at acquired native methods/results cannot deadlock/grant; healthy pending SQL work/close and unknown cleanup retry remain distinct; close during an issued runtime credential operation retains the existing conservative failed-credential/evidence-held result rather than promising positive cleanup; concurrent owners refused while actual resources active/held; successful paired dispose/reacquire and original SDK-only-held negative control.

Negative guards use the SAME actual genuine new runtime adapter and original authenticated source guards. No source guard means normal destination behavior, not global allowlist. Original unresolved guard remains negative; original archived resolution does not clear it. Source fencedRevision raises floor. Actual destination matching receipt must exceed max(originalR,originalF), correct nonce/guard; subsequently observed higher destination floor is monotonic perProfile and old matching receipts do not revive rights. All accepted S6l4 cases must be repeated through actual published binding/runtime, including multiple Profiles, current server revision below floor, pending mutation, concurrency, reentrancy and cross-lane own completion. Current host/control binding is unimplemented until M3c and must not be faked by tests claiming app admission.

Parent focus of new + actual M1/M2/source/default/legacy and architecture, types/scoped lint/diff must pass, followed by independent complete M3b CODE review/probes. Keep exact evidence canonical in TESTFLIGHT_READINESS, concise runtime contract in MOBILE_APP_MIGRATION/ADR and rollups only when accepted. Follow Vault standing progress duty and preserve parallel PostHog/Mahoo entries; no Beta/release claim. Full combined application baseline after M3c, not every substage. Final actual report: starting/final Git, changed files, implemented scope, consolidated resolved findings, tests/counts/logs, remaining gates, no unauthorized mutation.

## Allowed production surfaces

installationPublishedOwner/Binding, installationTransferQuarantineSql closed published facade/private runtime only; installationTransferSourceGuards distinct genuine published consumer and shared internal negative logic; nativeCombinedRuntime distinctly named closed published publisher reusing existing paired lifecycle; nativeCredentialMigrationPort ONLY exact new actual owner reuse/actual completion preparation if genuinely needed, with every old constructor/runtime unchanged. A private live-codeunit module is allowed if necessary to preserve old bounded source codec and prevent source retention caps. Exact architecture tests, actual synthetic SQL/SDK/guard tests and canonical docs. No actual AuthHost, SDK constructor/root fence, normal composition, Tracker/Profile/UI, source helpers, native plugin/Swift, activation or operative data changes until their separate gate. If these concrete seams cannot preserve invariants, surface the actual seam for DESIGN amendment before broader production edits.


## Consolidated DESIGN correction — three transitions, two CODE gates

This section overrides any less precise earlier wording. Implement no M3b code until the entire corrected design is accepted.

**M3b1 SQL runtime/live codec CODE gate first:** only the closed published SQL facade/private runtime, necessary consumed-proof currentness in its existing private binding producer, private live codec, exact architecture/tests and canonical contract. No production Owner/Credential/Guard/publisher integration. Real tests can compose the actual M2-published SQLite + new actual SQL facade + actual publication port, acquire the genuine lease/read actual Q/M/t1/verify real binding, create a genuine session and new actual SQL draft, and use the EXISTING actual transfer credential preparer/actual paired publisher solely as a positive test harness to activate and exercise the SQL runtime. This is no fake session/draft/lease/proof or readiness stub. Malformed credential preparation is deliberately deferred to M3b2; the accepted old path is unchanged. Independently review the complete M3b1 code and genuine read/write/transaction/codec/failure/cleanup evidence before any production M3b2 code.

**M3b2 Owner/Credential/Guard CODE gate second:** only after M3b1 CODE PASS, wire the actual published owner, new narrow genuine publication credential preparation, separate actual paired publisher and distinct published-negative-guard consumer. Review their complete resulting state with the actual SQL runtime and all earlier controls. Full combined application baseline remains after M3c actual configured host.

### Exact proof consumption/failure matrix

The SQL context holds a private monotonic consumed cell. It is initially false. Only after the last actual preparation read/drain and renewed genuine binding/session/owner/schema checks, in the same synchronous step that publishes the real prepared SQL draft, set consumed=true and role=prepared. Cold candidate/proof currentness requires consumed=false; it never becomes false again within that context, including abandon/failed credential preparation/dispose. The new published SQL draft’s abandon is close/cleanup-only, never role=migration. Old identity/source draft abandon behavior is unchanged.

1. Healthy verify/admission refusal before consumption: no new role/draft has been published, actual original binding remains current; abandon only that unused genuine session and allow a new complete fresh verification/attempt. Native uncertainty/fault still blocks, independent of role.
2. Last preparation check fails before its synchronous consume: no draft/current grant, drain everything, retain original resources. Retry only if the ACTUAL original binding is still current, storage is healthy and owner is not closing; otherwise cleanup-only/held.
3. Any failure after actual consume, including a later credential descriptor failure, lost currentness or abandoned prepared draft: no new verification/session/runtime in THIS context/owner, even if stores remain healthy. Keep cleanup obligations; no old proof resurrection by setting a role back. The actual owner distinguishes this using the genuine original binding’s still-current inspection and retained actual SQL draft, not a caller boolean.
4. A late actual draft already minted by the synchronous consume must still be retained by its actual owner before cancellation/readiness checks. An actual cleanup resource must not disappear behind a null result. Only genuine positive close/retirement allows a separately constructed fresh store owner to perform wholly new cold observations/proof/session; that is not revival in the consumed old context.

### New exact publication credential preparation seam

Add a distinct prepareRuntime method ONLY to the existing genuine PublicationCredentialCapability, with exact new production consumer PublishedOwner. Do not change prepareTransferIdentityCredentialRuntime, runtimePreparations/transferPreparations or any old default/source preparation behavior. The existing WeakMap authenticates the port/capability only; it does not authenticate arbitrary supplied arguments. The new capability instead retains the exact most recent genuine publication observation object produced by THIS port’s actual read/insert operation (one private pointer, no new registry), and checks identity against that pointer, global genuine observation currentness, non-null exact confirmed t1, actual owned lease and current namespace/migration role. Derive immutable bound Q/canonical M from that actual observation and validate their existing config/root/pair match. The actual owner passes the same genuine observation it just used for the same SQL binding. No caller-supplied Q/M/projection/Ready flag or imported source handle. This seam does not claim SQL binding authority independently; the real owner composes the actual same-context proof.

The method takes actual lease, genuine last observation, genuine session, actual SQL draft and current callback from its closed owner. Register its exact outward Promise in the EXISTING local publicationCompletions set BEFORE the first descriptor/native work, e.g. defer the body until after registering that result. No unregistered async outer wrapper. Actual namespace serialization and every necessary exposed queue alias must share the same precise exclusion; no fake session registry before genuine pair publication. The local ownsCompletion inspector already shares this exclusion with SQL/owner.

Its new preparation path captures remove/failedWriteMayLosePreviousValue exactly once from the real retained binding receiver. Capture and retain every acquired descriptor value/get/set reference BEFORE validity/currentness checks, including a descriptor acquired while close runs reentrantly. Validate each before acquiring a later descriptor. Getter/setter functions are retained/drained, not invoked as the application method; their acquired then metadata is still owned work. Use the actual protected work observer, original receiver and actual current namespace/session/domain/owner checks. Fully drain and renew currentness after the last descriptor work before reporting preparation success. A supported direct own completion is exclusion only; unrelated pending work must settle. No structural ready surrogate.

If an actual credential draft was created before that last drain and then loses currentness, abandon it so it cannot be ready, but return/retain it explicitly as an actual cleanup obligation, NOT as a prepared grant and NOT hidden behind null. A closed internal result such as {kind:prepared,draft} versus {kind:cleanup_required,draft} versus null is allowed; it comes only from the actual capability, and the owner still calls actual ready/current before synchronous pair publication. This is not a caller Ready flag. Original positive draft can reuse the actual existing runtime/namespace machinery; its new published-path abandon closes instead of reverting to migration. Old paths remain exact. Before any draft exists, failed preparation leaves the genuine original migration cleanup available. The actual owner retains late SQL/credential drafts BEFORE checking its own cancellation and joins the pending attempt before choosing their real cleanup path; no fabricated absence or concurrent independent cleanup over a draft.

### Ordinary storage anchors and selected transaction/close behavior

The new anchor authenticates stable original store/static controls. Successful Identity/Live transactions do not rotate the storage anchor or call core.phase/reopen. They can legitimately occur while a credential operation holds that anchor; invalidating it would make the current credential implementation record a failure. Use actual BEGIN/conditional statement/ACK, actual COMMIT ACK and same-original-connection addressed/full-identity readback with unchanged static controls for normal success. No Reopen on every successful write. Any actual failure/ambiguity is conservative, revokes before drain and never returns success from a new post-failure repin. Reopen/outcome recovery is only the existing uncertainty/cleanup machinery when genuinely needed, no write replay.

Close during healthy pending SQL-only work can drain and positively retire when actual receipts prove it. Close while a runtime credential operation has been issued follows the EXISTING conservative credential behavior: lost allowed/currentness can record credential failure; paired cleanup may therefore be evidence-held even after physical closes. Preserve that result and ownership, do not label it healthy/positive by a broad new cancellation rule. A successful ordinary domain write during a held credential read must remain a positive control: same storage anchor, credential operation succeeds after settlement. Negative controls close/domain/protocol/static/schema failure still revoke it. Q1 same-begun-Session continuation remains unchanged.


### S6m3b1 — published SQL runtime (focused CODE accepted)

The closed published SQL facade now consumes its genuine cold binding once and prepares a same-core runtime draft. Abandonment never revives migration rights. Identity remains bounded separately; addressed mutable live values use a private exact UTF-16 codec without source retention caps. Ordinary successful writes preserve stable credential anchors; static/schema drift, ambiguous transactions and last-drain lifecycle loss refuse success. Real close receipts support healthy same-owner retry, with conservative credential failure retention. No production owner/credential/guard/publisher integration is included: that remains S6m3b2; configured SDK/normal host remains S6m3c. Exact verification is in TESTFLIGHT_READINESS.md.


### S6m3b2 — same-owner paired runtime and preserved negative guards (CODE accepted)

The source-free owner now freshly verifies before its first no-argument handoff, consumes the genuine same-context SQL binding once and publishes the actual same-lease SQL/credential pair through a distinct named publisher. The additive genuine publication capability derives Q/M from its exact latest actual observation, registers preparation and namespace completions before work, and retains every acquired descriptor value/get/set through final drain. An actual late credential draft returns explicitly as cleanup_required and is retained before owner cancellation checks. After consume, failed preparation is cleanup-only; old preparation APIs keep their behavior. Actual paired disposal governs cleanup and healthy unknown-close retry; credential-only failure preserves existing domain lifetime for Q1.

A distinct genuine published-binding consumer shares the original negative guards on the owner's own domain adapter. Remembered per-Profile destination fences cannot be downgraded by an older matching receipt. A still-valid actual destination guard remains unresolved when that happens, so higher genuine server recovery remains possible; malformed/contradictory evidence stays refused. Original guards and newer destination guards both retain their constraints. Historical publication identity is no permanent account/Profile allowlist. No actual configured normal host/SDK, Tracker/UI or application admission is included; S6m3c remains separately gated. Exact focused evidence is TESTFLIGHT_READINESS.md.


### S6m3c — configured published normal host (independent DESIGN/CODE accepted)


## Mandate, preflight and scope

Parent implements only after independently accepted corrected S6m3a/M3b1/M3b2 and this complete independent DESIGN gate. Explicit user local completion mandate remains; no new product choice. Repository /Users/timhofer/curling-release-mvp, main; HEAD/main/origin/main382ee40d37605b302c11b6390305857c7e2c3fde;0 staged/85 modified/209 untracked. Preserve entire tree; no index/ref/commit/patch/branch/PR/push changes. Read docs/AI_DEVELOPMENT_WORKFLOW.md before work, canonical MOBILE_APP_MIGRATION S6l4/5/M1/M2/M3a/b and ADR0054, actual configured host/private preparation/SDK reservation and published-owner/guard contracts. No actual env/config values or .env.local, actual archives/backups/accounts, device, hosted/Apple, signing/install, source helpers/Swift/activation flags. Synthetic bridges/API plus installed actual SDK and disposable SQLite only. Authorized existing reviewer only; parent implements, no new agents/delegation.

This stage adds an explicitly named dormant configured NORMAL sporting identity host over the actual published pair. It reuses the existing complete genuine S5 native AuthHost/IdentityTransitionCoordinator/account/Profile/sporting/Tracker mechanics. It does not connect a normal application/UI entry point, import picker, original source writer exclusion or transport. Actual host admission is now in scope; a public factory still has no production application caller. No caller admission, supplied pair, Ready Boolean, forged source handle/session/lease/stamp, or persisted snapshot treated as current identity. Current legal/Profile/Free/Team facts continue through actual sole mappers/coordinator. Closed Free Beta, Team≠Personal, Q1 same begun Session may add exercises/blocks but no new Session, Q3 verified legacy credential removal remain unchanged. Q4 coherent old SQL+Keychain restore remains unapproved/unfixed.

## Concrete private host seam, unchanged legacy/default modes

Add a distinct createConfiguredPublishedInstallationIdentityHost(binding,input) export/type in supabaseAuthService.ts. Its input uses the existing configured sporting dependencies and actual captured migration.sqlite/protectedBinding/detectPlatform/clock/UUID/limits, with no archive/recoveryCode/source handle/pair/owner option. Resolve only the genuine configured binding BEFORE reading input, then call the existing createNativeHost(...,bootstrap=true,sporting=true,configured,capturePreparation). The exact existing SDK reservation occurs synchronously before any foreign option lookup. All dependencies are captured by the established private host; the strategy factory must not eagerly spread/read original input before reservation. The existing capturePreparation path uses the sanitized fetch/origin/navigation receiver; retain no original input/receiver in later callbacks. No normal/default/source factory changes behavior or layout fallback. No new mode caller flag.

The new private preparation is created only in this named export. It lazy-imports installationPublishedOwner only after reservation/options capture, with genuine host-current checks before/after imports. Its prepare single-flights/registers before first work, creates one actual owner with actual captured SQLite/config/root/protected binding/platform, invokes that owner's noarg handoff, retains actual pair even when cancellation wins and returns only that actual pair. Failure returns closed or existing handoff_refused/migration wait; it never manufactures absence or a substitute migration path. It creates no second SDK/store owner. After a consumed failure the same owner remains cleanup-only; retries do not reconstruct it. Dispose revokes at call-time, publishes its exact completion before reentrant cleanup, calls owner.close immediately, joins actual pending preparation and maps only actual closed to positive cleanup; fault_held maps evidence_held, unknown maps cleanup_unconfirmed. Unknown healthy cleanup may retry the same retained owner, not reacquire. The existing actual host continues owning AuthClient disposal and global SDK reservation release.

## Exact host completion exclusion into the closed owner

The existing published owner currently sees only its local SQL/port/session/guard completions. The actual host's start/bootstrap/dispose/commands/runtimeWork/auxiliary/tail inspector is already a NONrecursive local membership check, used by the old source owner. Add one optional second constructor parameter to createPublishedInstallationOwner for that trusted exact inspector (default absent, preserving all standalone paths). The new named host's private preparation is the sole added production consumer; no public option chooses this callback. Its owns joins exact external membership with the owner's existing local inspectors. It does not call back through SQL/port/owner inspection, create a fake session registry, traverse Promise graphs or treat own completion as ACK/value/currentness/grant. Capture/SQL/protected work thus excludes actual direct host producer completions before any acquisition. All newly exposed preparation/policy wrapper completions register in existing local ownership cells before first work; every actual late draft/pair remains retained before caller cancellation checks. Existing C4 arbitrary hidden Promise dependency graphs remain outside contract, not solved by timeout/resets.

## Source-negative guards and actual per-call identity effects

The published owner must continue constructing its guard repository over ITS OWN actual pair.domain; no supplied stand-in adapter. New named host therefore cannot simply ignore the per-call identity/effects wrappers used by existing account operations. Add a distinct optional private NativeHostPreparation hook publishedSourceDeletionGuards(current,beforeIO?) instead of replacing old wrapSourceDeletionGuards behavior. The new private preparation delegates only to its actual owner's sourceGuardRepository. Existing source/default paths keep the old wrapper/fallback exact.

At buildRuntime, resolve published hook over identityAvailable before the old source/ordinary guard branch. At account-operation construction, resolve it with actual guardCurrent plus the EXISTING actual effects closure (waits actual denialFlight, then checks identityAvailable/current), before old source/ordinary branch. No new current/server-control surrogate. The actual sole mapper continues validating Profile/revision, binding the actual call Profile/account, processing factual pending denial, calling actual acceptControl and conditional Abort/Cancel/Request; all existing RPC/header/SDK/Self/epoch checks remain.

Add an optional trusted beforeIO restriction to owner.sourceGuardRepository. It supplies no adapter, identity, receipt or positive grant. If absent, behavior stays M3b2 exact. If present, internally wrap only the owner's own domain get/set: call the actual trusted effects policy BEFORE issuing IO and AFTER it settles, require exact true and renewed real owner/session/host currentness, refuse on false/throw. Call policy outside the SQL queue. Its actual effects implementation performs no foreign acquisition, only waits already-owned real denial and checks private booleans; no pending denial is bypassed or awaited from inside SQL. Register each exact outward guarded operation in the existing owner completion set before policy/domain work; genuine guard completions already participate in owner/SQL/port exclusion. Do not change old shared guard semantics, floors or any actual normal host policy. Malformed different-nonce receipts keep actual unresolved guard as accepted M3b2; higher real recovery remains possible.

Repository construction is no admission. Actual native mapper/coordinator obtains current SDK Self/Profile/legal/onboarding/deletion state and mints genuine admission before Profile access/Tracker registration is usable. Original t1 account/selection/Profile list remain historical publication provenance, never future account/Profile allowlist. Later actual canonical Profile data may work only through its own actual current admission. Credential-only failure preserves Q1; normal new admission/new Session refuses, while same begun Session domain/Tracker continuation remains until its actual lifetime ends. Domain/protocol/terminal/account/Profile contradiction revokes through the existing actual events.

## SDK/store quiescence and real cold process evidence

Do not edit supabaseClient.ts/reserveNativeAuthSdk/nativeConstructedRoots/constructOnce or introduce reset/root bypass. The original actual host's positive disposal must include SDK stop/dispose, active/queued/auxiliary/runtime work drain AND positive actual stores. SDK-only-held reservation still refuses new host before option lookup even when M3a store provenance can verify. Cleanup uncertainty does not release global ownership. Even after full positive old-host disposal, the existing one-construction-per-root-per-JS-realm fence remains; a same-realm new published host must yield restart_required with no second actual AuthClient constructor/initialize. Its actual prepared stores remain owned until positive disposal, and data stays unchanged. A new same-root actual SDK is demonstrated only in a REAL fresh child process, not vi.resetModules, a fake reservation or a different synthetic root.

Use actual accepted M2 publication by the installed SDK + real disposable SQLite in parent tests. Positively dispose original actual host, then pass only its synthetic persisted SQLite file identity/config and protected-map values to a private temporary synthetic-only child fixture. The child is a genuinely new Node process loading current production modules/installed SDK, with its own actual SQLite connection/engine to the same file and synthetic protected/API bridge. No in-process registry reset, fake identity proof or copy replacing actual storage. Use a narrow test-only TypeScript loader like the established supervised codec child, or genuine separate Vitest child; do not add production loaders/bundles/dependencies. Assert actual child PID differs. Retain original parent fixture until child finishes; positively close child before parent reopens it. Remove temporary synthetic descriptors/children fixtures, keep only safe summary logs. No actual user backup/credential recapture.

Child transport uses documented synthetic fixture shapes through real requests/SDK/mappers, not fabricated runtime/admission objects. Verify startup current Self/legal/Profile/Free, actual genuine sporting/Tracker authentication only after current coordinator admission, exact original live rows across Profiles, actual current Profile training read/write and cold persistence, own raw UTF16/absence semantics and immutable original source/receipt/t1. New actual SDK I writes/removes/replacement continue supported. Actual real cold restart/pair proof does not waive normal host failure/cleanup or physical evidence.

## Required adversarial verification

Before code acceptance, parent actual focused source/default/legacy/architecture/host/Tracker regressions, types/scoped lint/diff pass; independent complete CODE gate and genuine new child/SDK probes follow. Full combined root/web/E2E/mobile/three actual mobile modes (default last)/lint/types and positive3100 ECONNREFUSED after E2E follow this stage's CODE acceptance, with exact counts recorded only when run.

Positive: same genuine binding/config/root/store; full old host positive disposal; same-realm restart_required no new SDK; actual fresh process successful real SDK/normal coordinator/Free Profile startup, original multi-Profile raw training and later legitimate writes/cold reload, SDK changes, normal account cancellation/export/guard recovery through actual pipeline, no legacyStorage/archive/code reads. Existing default/source controls unchanged. No-source guard normal destination behavior, original/other-Profile guards remain negative and monotonic after current server floors; same/different nonce actual recovery remains legitimate.

Negative: fake/copied/proxied configured binding before input access; reservation ownership conflict before input lookup for active/SDK-only-held old host; original close/native drain/SDK stop/dispose ambiguity retains ownership; wrong config/root/schema/static/t1/M/I no fallback/repair/rebinding; early/late host disposal during lazy import, M3a hash/read, SQL draft, protected descriptor final drain, handoff/SDK initialize/actual commands; exact direct host start/bootstrap/dispose/command/account/export/guard producer completions returned by actual native methods/results cannot wait on themselves or become ACKs/grants; unrelated acquired work remains drained. Tests return genuine completions directly at the actual native method edge, not hidden behind uncontrolled async aliases.

Actual current server pending deletion/denial and request/export callbacks must revoke ordinary access before further guard/storage work, retain factual pending completion even with refused floor, and keep actual effects waits. Test held denial plus concurrent guard read/write, overtaken currentness after native settlement, malformed actual control, stale floor/newer receipt recovery, multiple repositories/Profiles, and guard-operation cycles. No supplied adapter or Ready flag. Q1 actual begun Session continues extra exercises/blocks after credential-only failure, but new Session/admission refuses; domain/protocol/account/Profile failure revokes. Old source FreshOTP/publication and normal existing factory behavior stay exact. UI/phone/operative source transport and Q4 remain separate open gates.

## Allowed production edits and completion report

Only the new named export/type/private strategy and additive optional guard hook in supabaseAuthService.ts; optional exact host completion inspector and negative actual effects guard wrapper in installationPublishedOwner.ts. No native SDK reservation/root-fence/default/source producer/SQL/credential protocol modifications unless an explicit additional independent DESIGN amendment is needed. Exact architecture tests, real synthetic SQL/SDK/host/Tracker/child tests and canonical docs allowed. Existing test fixture may expose synthetic persisted file options without changing existing production behavior; prefer test-only helpers. If concrete seams cannot preserve beforeIO/ownership/cleanup invariants, surface technical design correction before wider edits; do not ask user a technical implementation choice or weaken policy.

Record actual changed files, starting/final Git, consolidated corrections, exact focused and subsequent full baseline, remaining real source/UI/physical/release gates. Save dated substantive progress to canonical Vault project/log under standing mandate after acceptance; preserve parallel PostHog/Mahoo entries. No operative/Beta completion claim.


## Binding independent DESIGN clarifications

Runtime registry provenance may already authenticate before actual Profile admission; only bindTracker/actual Profile/Application scopes must refuse until genuine current admission. Do not change registry policy. GateFacts has no deletion revision: only the actual per-call Account service carries C/Floor evidence, and Coordinator guard checks establish no server confirmation; no new global C query/offline/admission policy. A present published-guard hook must throw/refuse closed, never fall back to ordinary guards on null/failure. Preparing/closing pointer identities and the nonrecursive host inspector are the exact completion seam, with no second registry. Actual fresh-PID child proof uses the same SQLite file and coherently continued synthetic protected data, including SDK mutations cold in later child processes; no reset proxy.


#### S6m3c accepted cleanup DESIGN amendment


Published pair disposal synchronously publishes its exact completion/revokes the genuine session, then awaits a private actual Owner drain before closing SQL/protected resources and retiring. Only publishPublishedInstallationRuntime receives this optional private callback; old Native/Transfer publishers are unchanged. Owner pendingEffects contains only actual started policy/domain outward wrappers, added before work and removed at settlement. The drain's own exact outward completion registers before Join in the existing Owner WeakSet, never in pendingEffects. No authority/Ready registry. Running actual denial/native work still drains; cancellation only refuses further work. Drain failure retains actual resources and yields existing cleanup_unconfirmed; only same healthy pair retry, sticky evidence-held unchanged. This covers owner.close, actual host cleanupTarget=pair and direct pair.dispose equally.


#### S6m3c current implementation contract

The distinct dormant configured published host now uses the existing actual SDK, IdentityTransitionCoordinator, account/Profile/sporting and Tracker mechanics over its own genuine published pair. Its lazy preparation and exact host-completion inspector preserve the existing reservation and one-construction-per-root fence. Positive original disposal therefore requires a real cold process before another SDK for that root; no in-process reset or provenance proof bypasses it. Historical publication account/Profile membership is not a future admission allowlist.

Published guard repositories use only the owner's own domain, with actual per-call identity/effects restrictions before and after I/O. A present but refused published hook never falls back to ordinary guards. Exact operation completions register before work. Published pair disposal revokes synchronously, then joins actual started policy/domain work through the owner's private drain before either physical store closes. Unknown cleanup retains resources for the same healthy pair's retry; evidence-held remains sticky. Old publishers and default/source paths are unchanged.

Independent complete CODE has no remaining confirmed defect. Genuine fresh-PID installed-SDK/SQLite tests cover current admission, later legitimate Profiles/accounts, original guard recovery, factual pending denial, cold mutations, Q1 continuation and uncertain cleanup. Exact evidence is in TESTFLIGHT_READINESS.md S6m3c. This named factory still has no shipped application root/caller. The existing explicit App composition is separately verified in S6m3d below. Source transport/writer exclusion, physical/configuration/hosted/Apple and Q4 gates remain open; no operative import or Beta grant follows.


### S6m3d — actual published App composition (independent DESIGN/CODE accepted)

The existing explicit DormantNativeTrackerComposition already joins NativeApplicationProvider, actual IdentityProvider, genuinely admitted native Profile repositories and TrackerApp. Its Host is constructed once outside React; React does not own Host cleanup. This stage verifies that exact tree against the actual M3c published Host in a genuinely fresh process, same disposable SQLite and coherently continued synthetic protected storage. No new Ready/controller/activation authority, production root, build flag or original source/Swift change is included. Provider owns actual startup/OTP; test UI branches before any manual admission. No forged runtime/session/scope/provenance or app-module replacement.

Only test helpers/actual Host tests initially change. Real session/block/plan constructors produce both Profiles' original sporting values before genuine original publication. Real jsdom/React controls must display original data, train/save/complete and cold reload with a different actual PID, preserve Profile isolation and immutable source/t1, exercise StrictMode without duplicate SDK/save, actual fresh OTP/pending-deletion recovery, Q1 same-session continuation and held-work cleanup. Any confirmed production defect requires its own concrete bounded design correction.

Both globalThis/window localStorage share one monitored object. Every forbidden identity/credential/sporting key, enumeration or clear counts as test failure even if caught by app code. The exact existing public Exercise diagram-cache prefix remains allowed and positively exercised; it is no auth/training source. Synthetic globals/transport cannot fall through to real networking. Normal unmount drains; adversarial close deliberately holds real work and proves Host cleanup waits. No module-reset cold-SDK surrogate. Independent CODE/focused actual joined regressions/types/lint/diff follow; exact evidence belongs in TESTFLIGHT_READINESS. M3c full baseline remains separately versioned. Operative production entry/import transport/writer exclusion/device/configuration/hosted/Apple and unapproved Q4 remain open. Free Beta/Free-Personal-Team and Q1/Q3 unchanged.


M3d accepted testharness amendment: the installed SDK's locks-module evaluation performs one random localStorage capability setItem before Host construction. During only the actual synchronous SDK import, a separately counted primitive exact lswt-random key===value call is expected and always throws without storage/ACK. The phase closes permanently in finally; exactly one refused probe, no remove/debug-get/enum/clear or later probe exemption. This is no browser auth grant or production fix. Both actual browser surfaces remain monitored and all forbidden data accesses fail independently of caught app errors.


Actual completed Account/Guard recovery already permits the existing real UI Try again to reach Home and a genuine Profile scope with one OTP verification. Merely observing an HTTP request was not completion evidence. The earlier proposed additional sign-in form is unnecessary and is withdrawn; no production UI/auth change is included. Permanent positive settled-Control/Retry and negative low-Control/Retry cases preserve the real sequence. The test also requires an actual public cache miss, compatible DOM Blob/FileReader conversion, successful stored write and a new resolver cache hit without another fetch; read-attempt counts alone are insufficient.


S6m3d corrected complete independent CODE is accepted with no remaining confirmed defect. The ten permanent actual App cases exercise the same genuine published Host in fresh installed-SDK/SQLite processes, original multi-Profile data, normal training/cold persistence, StrictMode, pending deletion, fresh OTP, Q1, held hydration and native domain failure. Completed recovery is explicitly awaited through actual Account Control; this is not evidence that an HTTP request or automatic UI polling alone completes recovery. The real existing Retry reaches Home/Scope with one verification; low Control retains refusal and evidence-held cleanup. A genuine public-cache roundtrip is required. No additional production sign-in form or other M3d production change remains. Exact parent/independent counts and baseline provenance are in TESTFLIGHT_READINESS.md. The explicit tree is verified, but no operative root, file/code delivery, source-writer exclusion or device activation is added.


### S6n1 — destination application import controls (independent DESIGN/CODE accepted)

The user requests the complete import workflow and subsequent App start. A second-device comparison may be omitted when it requires unavailable hardware; that is an omitted test, not passed preservation evidence, an original-device installation grant, Q4 acceptance or permission to reset/discard data. Local target workflow implementation proceeds while original-container writer exclusion, operative source packaging and physical delivery remain open. Default builds and the production activation barrier are unchanged.

A new named configured application Host exposes only prepareImport, completeImport, checkAccountDeletion and cancelAccountDeletion alongside the same genuine identity-only Host. A private factory helper preserves the old exported factory's exact public shape, binding-before-option and reservation-before-option ordering and closed lazy source/Account imports. Four private closures delegate only to that same actual source-aware Owner; absent/unprepared/revoked ownership refuses before work. No supplied owner, runtime, proof, Profile mapping or Ready value exists. Recovery remains reachable when ordinary admission is denied, using the existing actual getState/cancel pipeline rather than another RPC implementation or a fabricated complete AccountDeletionService.

Exact public publication Promises register in the existing Host ownedCommands/auxiliary completion and disposal path before their asynchronous bodies acquire native/lazy work. The existing source Owner receives only a private optional completion-retainer; old callers omit it. Registration failure refuses before work. Controls return those exact actual completions; no availability/result wrapper rewrites factual SQL publication after Close/auth loss. Cancellation synchronously revokes, then actual work and positive cleanup drain. prepareImport still requires genuine fresh OTP, current per-call Account Control, source/Profile constraints and original SQL/protected observation. completeImport preserves actual publication outcome and grants no admission/mount. Default/source/SDK root fences are unchanged.

Independent corrected DESIGN is accepted after adding the otherwise inaccessible real Account recovery and exact Host-owned completion paths. CODE requires actual public OTP→Control→prepare→publish tests without private Owner spies, pre-start/closed refusal, actual pending/cancel and Profile denial, wrong code, duplicate commands, exact completion returned at native edges, held work/close and factual post-COMMIT outcome. N2 file/Provider/recovery presentation remains a blueprint until its concrete DESIGN; no source/helper/native/flag/device/hosted mutation follows from N1. Exact executed evidence belongs in TESTFLIGHT_READINESS.md.


N1 complete independent CODE is accepted with no remaining confirmed defect. Actual public-control tests now use the new application Host directly, including Account recovery before admission and factual COMMIT outcomes. The closed private helper is the sole transfer dynamic-import graph; the ordinary factory still returns its original shape. Exact verification and the separately deferred whole-application baseline are recorded in TESTFLIGHT_READINESS.md. File/Provider/limited-recovery presentation is implemented and independently accepted in S6n2 below; it is not an activation consequence of N1.


### S6n2 — destination File and Provider workflow (corrected independent DESIGN/CODE accepted)

One explicit application owner, constructed outside React with a genuine configured binding and captured known options, connects actual user File intake to N1 and cold M3c entry. It accepts no Host factory, owner, runtime or Ready injection. It snapshots exact own data fields, validates each before later acquisition and drains retained malformed metadata/work through the existing quarantine-work observer. File validation uses native File-name and Blob-size getters, byte-count/ASCII/protected-format bounds and real FileReader settlement before actual Host construction. Plain Blob/fake/Proxy refusals follow the actual platform brand checks. Recovery code and selected File are ephemeral, never stored in browser persistence, URL, logs or callbacks; owned byte buffers clear after observed work, without claiming secure JS-string erasure.

Presentation commands return void; the sole private flight owns actual reading/construction/start/publication. Before a Host exists public close synchronously revokes and returns void, while the private flight drains work and disposes any late genuine Host. It exposes no new construction-joining Promise that capture could wait on cyclically. With a Host, close returns its exact actual dispose completion and separately observes presentation. Unknown cleanup retains the same Owner; state is never cleanup authority. Stable snapshots keep the same real Provider/runtime across notices and busy states. No Tracker is mounted during import.

IdentityProvider gains an optional accessRecovery node inside its genuine context next to its gated branch; undefined preserves all prior behavior. The explicit import panel uses only N1 getState/cancel and existing useIdentity actions, remaining reachable before admission. After actual source-guard/cancel recovery, only an expressly chosen sign-out and new normal email sign-in obtains a fresh publication proof. No automatic signout, cloned runtime, complete fake AccountDeletionService or direct OTP mint is introduced. Final import always obtains a fresh actual Account state-null result, then delegates genuine protected preparation and atomic publication. Factual outcome is retained independently of Close/auth loss. Only confirmed desired11 plus positive actual Host cleanup yields restart instructions; uncertain outcomes do not offer reset/repair/reimport.

Open-imported-training uses the actual source-free configured Host and existing explicit native Tracker composition. A refused start is no evidence of target absence; any subsequent source pairing independently rejects conflicts, and uncertain disposal prevents fallback. A new SDK after publication requires an actual new realm/process; no same-realm reset bypass. This stage changes no shipped root, existing native flag, activation barrier, source helper, Swift/native configuration or original installation. User-omitted second-device comparison remains missing evidence; operative source writer exclusion/file delivery, physical/configuration/hosted/Apple and Q4 gates remain open.

CODE requires real File/DOM + installed SDK/SQLite public-control flow, fresh Provider OTP/onboarding, limited recovery before admission and explicit re-signin, wrong file/code/Profile and native failure, metadata retention and immediate cutoff, duplicate/StrictMode, actual read/constructor close with late Host disposal and exact native-boundary close, factual issued publication outcomes, no browser auth/training persistence and genuine later-PID ordinary UI continuation. Exact browser native-brand checks and DOM-harness limits must be distinguished. Focus/types/lint/diff and independent complete CODE precede the combined full root/web/browser/mobile/three-mode baseline. Exact evidence belongs in TESTFLIGHT_READINESS.md.


N2 complete corrected independent CODE is accepted without a remaining confirmed defect. The actual File/Provider/limited-recovery UI uses the same genuine import Host, then a genuinely new process opens the published store through the existing Tracker. No supplied runtime or fake cold SDK is used. Actual native File brand checks were also exercised in Chromium; the joined Provider/SQLite flow uses the actual React/JSDOM harness and distinct installed-SDK processes, not physical WKWebView evidence.

Two independently reproduced correction groups are closed. Options capture intrinsically rejects native Promise metadata before copying fields, including masked native Promise containers, while retaining and draining already acquired work. Reader refusal is distinct from actual read completion: only a genuine EMPTY observation establishes no issuance; throwing/invalid state metadata or a read that throws after issuance cannot replace actual load/error/abort delivery. Close skips later result/state observations once revoked, while joining issued work and retaining malformed metadata. Repeated Close preserves the same exact Host completion and reapplies its settled cleanup. Factual committed publication survives Close and yields restart only after positive cleanup. Permanent regression cases and independent additional controls verify these boundaries; exact counts and full baseline belong in TESTFLIGHT_READINESS.md.

The visible local workflow is complete within this explicit destination-tree scope. A shipped application entry, actual protected source-file/code creation and delivery, original-container/writer-exclusion procedure and physical/configuration/hosted/Apple acceptance remain separate unfinished work. The original training-only backup is not silently promoted to a V3 source with identity observations. The unavailable second-device comparison is omitted, not passed; Q4 and original-device installation/data-loss permissions are unchanged.


### Dormant new-user startup entry (27 October 2026; independent CODE and local baseline accepted)

A distinct configured new-user sporting host now initializes schema and tagged
Q atomically on the existing common owner; the exact empty-source-v1 header contract
provides durable origin distinct from legacy migration. Strict complete source
absence, normal Q/M/I/D pairing and existing identity/Profile admission govern
startup. Existing migration, published-installation and transfer constructors keep
their legacy contract; the shipped mobile root and activation authority are unchanged.
Canonical authorized design and acceptance status: BETA_COMPLETION_SPECIFICATION.md,
“Atomic empty-source bootstrap” and “Tagged new-user entry”; verification remains
in TESTFLIGHT_READINESS.md. No physical/configuration/hosted/Apple acceptance or Q4
restore-policy decision follows from this dormant entry.


### Actual mobile new-user beta selection (27 October 2026)

The separately authorized follow-on integration selects the accepted strict host
through MobileApp only in CURLING_MOBILE_NEW_USER_BETA=1 artifacts. Default and
legacy-storage/diagnostics builds keep their prior selection; conflicting switches
fail build. Earlier global dormant/no-build statements refer to the historical
lanes and are superseded only for this exact new-user selection. Its genuine
configured owner, platform/configuration gates, shared identity/Tracker composition,
retry/terminal cleanup and installed-SDK diagnostic limit are canonical in
BETA_COMPLETION_SPECIFICATION.md “Mobile new-user entry integration”. Native data
origin/protocol rules remain unchanged. Independent corrected CODE and complete final local baseline are accepted.
See TESTFLIGHT_READINESS.md for actual evidence; this does not provide device/hosted/Apple acceptance,
installation or original-data migration. Source helpers and transfer remain unselected.
