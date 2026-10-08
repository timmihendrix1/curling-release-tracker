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
below; their rows are a decision record, not a proposal. **P1, P3, P4, P5 and P7 remain
genuinely unresolved**, and none of those is settled by this document. For each, the stage it
blocks is named; work before that stage proceeds without it.

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
| **P4** | **Production app identity, release configuration and distribution commitments** — bundle identifier / application id, app name, **the callback domain**, store accounts, and whether App Store and/or Google Play distribution is committed. **The API origin is NOT part of this any more: it is confirmed as `https://curling.evolane.me`** and configured through `NEXT_PUBLIC_NATIVE_API_ORIGIN` (Stage M2a, [ADR-0047](adr/0047-configured-native-api-origin-boundary.md)). Confirming it settles the API destination only. | **M1** uses explicit development placeholders; **M2's HTTPS callback path** cannot be completed without the callback domain; **M6** needs all of it. | A bundle identifier is baked into provisioning, Universal Link / App Link association and the Supabase redirect allow list. **No remaining value is invented here.** See §6.2 and §10 M2 for what an unresolved domain means in practice, and what the explicitly supported fallback would require. |
| **P5** | **Does the required alternative login satisfy Apple guideline 4.8?** | **M6** (distribution readiness); influences **M2**. | Guideline 4.8 requires an app using Google Sign-In for the primary account to also offer a login service that limits collection to name and email, **allows the user to keep their email address private**, and does not collect interactions for advertising without consent. Email OTP collects only an email address, but it does not offer an email-privacy relay. Whether that satisfies the second bullet, or whether Sign in with Apple must be added, is a product and review-risk decision. **Do not resolve it by removing Google sign-in** — §1 preserves existing sign-in options. |
| **P6** | ~~How is native local persistence made durable enough to accept?~~ **DIRECTION DECIDED (2026-09-29): Option B — adopt durable native local storage behind the existing persistence boundary.** WebView `localStorage` is **not** retained as the native production store by merely accepting its eviction risk. Both iOS and Android are designed for, with shared application logic. Data already inside the installed iOS app is preserved through a **controlled migration**. Existing Profile ownership, repository boundaries and cloud-synchronisation logic are kept. **Engine evidence is gathered IN THE EXISTING APP (user decision, 2026-09-30), not in a separate harness application.** **Two further points are now DECIDED (2026-09-30): ALL existing local application data is PRESERVED — a pilot reset is rejected — and existing local data must be migrated and verified BEFORE production cutover.** | **M3.** The direction is settled; the **implementation and its acceptance gate are NOT complete**. | **Decision made ≠ designed ≠ implemented ≠ verified.** The design is Stage M3b0 (§10) and [ADR-0049](adr/0049-durable-native-local-storage-and-migration.md), whose **migration design remains unresolved** (three open items, §7). The M3b1 adapter and in-app diagnostic panel exist, **user-reported device evidence now exists within the stated limits** (M3b1 status in §10), and **Stage M3b3's composition is implemented behind an off-by-default build flag**. Still absent: **no migration, no cutover, and therefore no native production path** — a flag-enabled build blocks rather than mounting. |

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
is still unresolved**. As of 2026-09-30 Stage M3b1's adapter and opt-in in-app diagnostic
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
§7's stage table and M3b1/M3b3 status entries, and the two must not be read as the same
thing. As of 2026-09-30 the adapter (M3b1/M3b2), the in-app diagnostics panel and the
**composition, identity injection, protected credential store and readiness gate (M3b3)**
exist; the **migration (M3b4) and the cutover (M3b5) do not**, and §5's protocol therefore
remains an unimplemented design with three open items (§7).
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

**Device evidence now exists for the CONFIGURATION and for restart recovery, and not for the
transaction semantics the migration needs.** The user-reported iPhone measurement (2026-09-30,
recorded under §7) confirms the pragmas are actually in force and that written values survive
a process restart offline. That is sufficient for **composition** — it establishes that the
adapter opens, configures and reads back as designed — and it is **not** sufficient for
**migration**: what the plugin reports on a **failed or uncertain commit**, and how the store
behaves on **reopen after an interrupted commit**, are still unmeasured, and those are exactly
the properties §5.1's checkpointed model rests on. R1 therefore stands for the adapter, while
**source retirement remains unjustified until that transactional evidence exists.**

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

**IMPLEMENTATION FINDING — the native credential path is CLOSED, and the requirement is NOT
complete.** The contract requires **item-specific missing-versus-failed evidence**: only a
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

**Consequently:** the binding reports `no_absence_evidence`, the store turns that into a
failure, establishment cannot conclude anything, and a native composition **cannot become ready
on a real device**. That is a second, independent barrier alongside the activation authority,
and it is reported rather than worked around. **What would close it:** an implementation that
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

##### 5.1 Transaction and recovery model — CHECKPOINTED (the one canonical model)

Earlier text asserted three incompatible things (copy+activation atomic; copy+verified atomic;
"no multi-key atomicity needed") while also assuming per-key progress survived a crash. **One
model is chosen:**

- **Unit of commit = one checkpoint transaction.** Each transaction writes a **batch of
  key/value rows AND the updated `copied` set of the activation record together**. Progress is
  therefore never out of step with data: there is no committed state in which progress claims
  a key that is not present, or a key is present that progress does not know about.
- **What survives process death:** exactly the **last committed checkpoint**. Nothing else.
- **What rolls back:** an interrupted checkpoint rolls back **entirely** — its rows *and* its
  progress entry. There is no partial batch.
- **Activation is a separate, final transaction** that re-validates the evidence (5.3) and sets
  `phase = "active"`. **A validated committed activation — not the return of any single API
  call — is the authority switch.**
- **Migration needs multi-key atomicity INTERNALLY; `StorageAdapter` still promises none.**
  The transaction lives inside the migration module over the native engine's own connection.
  No repository sees it, and the public interface is unchanged. The old "a single marker means
  no atomicity is needed" claim is **withdrawn**.
- **Only a validated `active` state (§5.4 row B4) mounts the ordinary identity, sync and
  sporting consumers.** A blocked state renders the failure/recovery interface per §6 **and
  nothing else**. Nothing mounts mid-migration.
- **Source cleanup may begin only after a committed `active`**, and only under 5.5's
  re-verification rule.

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

One versioned JSON document in the **target**:

| Field | Purpose |
| --- | --- |
| `schemaVersion` | Of the **activation record**. Never conflated with a domain record's version |
| `phase` | `enumerating` \| `copying` \| `verified` \| `active` |
| `migrationId` | One attempt. A restarted enumeration gets a new id |
| `storeIdentity` | See below |
| `manifest` | Eligible keys **with a content fingerprint captured at enumeration** |
| `copied` | Keys committed so far (updated in the same transaction as their rows) |
| `activatedAt` | Written only by the activation transaction |
| `sourceRetirement` | `not_started` \| `in_progress` \| `complete`, plus keys already removed |

**Provenance is created, not merely named** — but it is a **pre-activation** device, and it
must not become a permanent dependency on evictable storage.

At the first enumeration a UUID `installationStoreId` is generated and written **twice**: into
the target activation record, and into a dedicated **source marker key**. Naming
`sourceId`/`targetId` without this creation-and-comparison step would establish nothing.

**The two writes are to different stores and are NOT atomic.** Each observation below gets one
action; **two of them are conservative blocks over an ambiguity this protocol cannot resolve**,
not reconciliations:

| Observed | Interpretation | Action |
| --- | --- | --- |
| Neither marker, target empty, source readable and empty | Fresh installation | Proceed (M3b0 §5.4 row D1) |
| **Source marker only, and the target is empty** | Nothing was ever committed to the target, so no record can be contradicted | **Adopt it**: reuse that id when writing the target record. (A marker with a *non-empty* target is D2 — blocked — before this row is reached) |
| **Both present, ids match** | Established pair | Proceed |
| **Both present, ids differ** | Not the pair this record describes | **BLOCKED** before activation (M3b0 §5.4 row E1) |
| **Target record present and pre-`active`, source marker absent** | **AMBIGUOUS — see below** | **BLOCKED** (one conservative action) |

**After a validated committed activation the source marker is no longer consulted at all.**
Three phases must be kept apart:

1. **Provenance establishment and validation — pre-activation only.** Both markers matter here.
2. **Target authority — post-activation.** A validated `active` record in an internally
   consistent target is the authority **on its own**. **A missing, cleared or unreadable source
   never blocks ordinary access**, because the source is exactly the evictable storage this
   whole stage exists to stop depending on. (Otherwise clearing WebView storage after a
   successful migration would lock the user out of their own migrated data — the failure mode
   this correction removes.)
3. **Source retirement — optional.** It *may* be prevented by a missing or unreadable source:
   nothing can be verified before deletion, so nothing is deleted. Retirement stalls; access
   does not.

**Fail-closed handling is retained for genuinely ambiguous or invalid TARGET state** — an
unreadable, malformed, wrong-version or internally inconsistent activation record still blocks,
regardless of what the source looks like.

**Two named PROVENANCE blockers, not solved problems** — the two of §7's three open M3b4 items
that arise here. **This protocol does NOT claim every interleaving is resolved, and differing
ids are not the only case that blocks.**

**Blocker P-1 — the missing source marker is ambiguous.** "Target record written, marker write
never landed" and "marker written, then the source was later cleared" produce the **identical
observation**: a pre-`active` record with no marker. The protocol records nothing that
distinguishes them — the marker's own absence is the only evidence, and it is the same in both
histories. Writing a fresh marker from the record would therefore be a **guess**, and if the
true cause was source clearing it would manufacture provenance for a source whose generation
evidence is already untrustworthy. **The one conservative action is to block**, and this
document does not pretend to distinguish the causes. Making this case recoverable requires
evidence the protocol does not currently record, and designing that evidence is an **open
engineering blocker for Stage M3b4**.

**Blocker P-2 — two different ids before activation.** It may be a reinstall over a foreign
store, or a restored backup pairing. This design **blocks** rather than guessing; automatic
resolution is likewise an **open M3b4 blocker**.

**Neither blocker affects an activated installation.** Both are pre-activation only, so the
established invariant stands unchanged: **after a validated committed activation, losing the
old source — marker included — never blocks ordinary access** (§5.4 rows B2/B4). Blocking here
withholds only the migration itself, which has not yet happened.

##### 5.3 What is copied, and what "verified" means

**Migration never parses a domain payload.** It copies **bytes**. Therefore:

- A **known application-owned key whose content is an unsupported or malformed domain record
  is copied verbatim**, unchanged. The repository's existing validation, quarantine and
  repair policy then applies after cutover exactly as it does today. This is the chosen
  non-destructive policy: **preserve verbatim under unchanged repository rules.** No domain
  repair rule is invented here, and **no known key is ever skipped** — which is what closes
  W2.
- An **unsupported `schemaVersion` on the ACTIVATION RECORD** is a different thing entirely
  and **blocks** (5.4 rows A3/A4).

**Evidence.** Each manifest entry carries the source fingerprint; each committed row is
written in the same transaction as its progress entry. Activation re-reads the target rows and
requires every `manifest` key to be present and to match its fingerprint.

**Durability caveat that gates retirement:** fingerprint matching proves *what* was written,
not that it reached stable storage. **Source retirement additionally requires the engine's
committed-transaction acknowledgement** (5.1). On an engine that cannot give one, retirement
is **not implemented at all** and the source is simply kept.

##### 5.4 State and transition table

Evaluated **in order; the first matching row wins**, and the order is chosen so that specific
invariant failures are tested **before** the generic phase rows that would otherwise mask them.
Every row states one unambiguous action. **Phase is never trusted on its own**: record
metadata and manifest well-formedness are checked explicitly, staging progress is checked
against staged rows **before activation only** (E0), and a row that depends on the record
being valid is only reached after Group A has passed.

**Group A — target activation-record integrity, evaluated first.** Nothing below interprets
`phase` until every row here has passed. **Group A inspects the activation record only.** It
never asserts that a particular application key still exists or still holds a particular value
— that check is confined to pre-activation staging (Group E, row E0).

| # | Condition | Action |
| --- | --- | --- |
| A1 | Record unreadable (storage error) | **BLOCKED**, retry later. Never re-import |
| A2 | Record malformed / unparseable, or `phase` not one of the four valid values | **BLOCKED.** Quarantine the raw bytes, never overwrite |
| A3 | `schemaVersion` **higher** than supported | **BLOCKED.** This build is too old. Never downgrade the record |
| A4 | `schemaVersion` **lower** than supported | **BLOCKED** unless an explicit reviewed upgrade exists for that version. None exists today |
| A5 | `manifest` malformed, or absent while `phase ∈ {copying, verified, active}` | **BLOCKED** |
| A6 | `copied` is not a subset of `manifest` | The record contradicts itself — **BLOCKED**. This is a check on the **record**, not on application data |

**Group B — `phase: active`, specific failures before the general case.** Reached only with a
Group-A-valid record.

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

**Group D — no activation record yet** (Group C passed):

| # | Condition | Action |
| --- | --- | --- |
| D1 | No record, target empty, source readable and empty (C2) | Fresh install. Commit `active`. Nothing to migrate |
| D2 | No record, **target not empty** | Lost record, or a foreign store. **BLOCKED.** No import, no delete |
| D3 | No record, target empty, eligible source keys exist | Enumerate → checkpointed copy → validate → activate |

**Group E — pre-activation phases. Provenance and conflict are checked BEFORE any resume**, so
neither `copying` nor `verified` can mask them:

| # | Condition | Action |
| --- | --- | --- |
| E0 | **Staging progress and staged data disagree, in either direction**: a key in `copied` with no committed target row, **or** a committed target row for a manifest key absent from `copied` | The checkpoint invariant — rows and progress commit together — was violated. **BLOCKED.** Nothing is deleted or re-copied to "repair" it |
| E1 | `storeIdentity` missing or mismatched (§5.2) | **BLOCKED** |
| E2 | A **manifest key already exists in the target with a value that does not match the committed copy** | Unresolved authority — **BLOCKED.** Overwrite neither side. Checked for `enumerating`, `copying` **and** `verified` |
| E3 | `phase: enumerating` | Nothing was staged, so nothing is deleted: **abandon the attempt record and re-enumerate** under a new `migrationId` |
| E4 | `phase: copying`, eligible-set-and-content validation passes (§5.5) | Resume: remaining = `manifest` − `copied` |
| E5 | `phase: copying`, validation **fails** | **BLOCKED — source generation changed.** §5.5 states what is preserved and what a human may authorise. **Nothing is deleted automatically** |
| E6 | `phase: verified`, validation passes | Re-validate evidence, then commit the activation transaction |
| E7 | `phase: verified`, validation **fails** | **BLOCKED**, exactly as E5. A `verified` record is **not** exempt from re-validation |

**Reachability.** Each row is reachable with one unambiguous action, because the masking
orderings were removed: B1 and B2 are tested **before** B4's general "active" case, E0–E2
**before** E3–E7, and C1 **before** anything may conclude "nothing to migrate". **Blocked
states never delete anything and never make source data authoritative.**

**The manifest is migration evidence, not a permanent constraint on application data — this is
the canonical statement, referenced rather than repeated elsewhere.** The checkpoint invariant
(a batch's rows and its progress commit together) governs **staging, before activation**, and
E0 is the only row that enforces it. **After a validated committed activation the manifest
becomes a historical record of what was copied.** It is *not* an existence or content
constraint: the migrated keys are ordinary mutable application records, and every repository
keeps its existing contract to write, overwrite, remove and create keys freely. A migrated key
that a repository later removes, changes or adds is **not** evidence of a failed migration and
must never block, be re-imported, or be restored from the source.

The concrete case this rule exists for: `curling.identity.trustedDevice.v1` is a migrated
identity key, and `identityTransitionCoordinator`'s sign-out protocol legitimately calls
`trustedDeviceRepository.remove()` on it. A relaunch afterwards sees an `active` record, a
healthy target, and a `copied` key with no row — **ordinary, correct state, reaching B4.** No
repository is asked to maintain migration progress, and **no new domain-write protocol is
introduced**: nothing above the migration module is aware the manifest exists.

What still applies after activation is unchanged: **activation-record metadata validation**
(A1–A6) and **real storage failures** (B1).

**Completeness is claimed only for the cases specified here.** An observation matching no row
is itself a defect in this specification and must **block**, not fall through to a default.

**Mounting rule.** **Only B4 — a Group-A-valid `active` record over a healthy target — permits
mounting the normal identity, sync and sporting consumers.** Every blocked state may render the
failure/recovery interface **and nothing else**; no blocked or pre-activation state may mount
ordinary consumers against a partial or unvalidated target.

##### 5.5 Eligible-set validation, disappearance, and the detection boundary

**A key list does not freeze values, and a manifest does not freeze the key SET.** The earlier
check compared only keys already in the manifest, so a **newly eligible source key** could be
added after enumeration and be silently omitted while every recorded fingerprint still matched.

**Required validation — on every pre-activation resume path, including `verified`:**

1. **Re-enumerate the complete eligible key set** from the source (by the M3b0 §1 allow-list and
   membership tests).
2. **Set equality:** the enumerated set must equal the manifest's key set. A **new** eligible
   key, or a **missing** one, fails validation.
3. **Content equality:** every manifest key's current source fingerprint must match the
   recorded one.

Failing any of the three ⇒ E5/E7 (**blocked**), never a silent skip.

**What prevents change between validation and activation — stated honestly.** Writer exclusion
(M3b0 §5.4's mounting rule plus §5.6) means no in-app writer runs during migration, so within a
single uninterrupted run the window between validation and the activation transaction contains
no application writes. **It does not exclude another process or a different build**; the design
does not claim a lock it cannot take. Re-validating immediately before activation narrows the
window; it does not eliminate it, and that residual is a stated limit, not a guarantee.

**Disappearance is NOT self-resolving, and nothing is deleted automatically.**

- **A copied key that disappears from the source.** The committed staged target row may be the
  **last surviving copy** of that value. It is therefore **never discarded**. The run blocks
  (E5/E7) with the staged data intact and recoverable.
- **An uncopied key that disappears.** It cannot be copied and it must not vanish from the
  record: re-enumeration alone would simply produce a manifest without it, which is exactly the
  silent omission this rule exists to prevent. The run **blocks**, retaining the original
  manifest entry as evidence that the key was once eligible.
- **Disappearance is never read as an intentional user deletion**, and **source-access failure
  is never read as disappearance** (C1 vs C2).

**The earlier "discard this attempt's target rows and re-enumerate" rule is withdrawn.** It
contradicted the same section's "blocked never deletes anything", and it could destroy the only
remaining copy of a value. Re-enumeration is permitted **only** from E3 (`enumerating`, nothing
staged). **Re-enumeration alone never proves a coherent generation or the absence of omission**
— set-plus-content validation does, and only when it passes.

**Recovery boundary.** A blocked E5/E7 state is **recoverable, not terminal**: the staged target
rows and the original manifest are preserved, and the failure/recovery interface reports what
diverged. Resolving a divergence — accepting the staged copy, or restarting from a fresh
enumeration and discarding staged rows — is a **human-authorised** action and an **open design
item**; this document does not automate it.

**Uncertain commit results.** **An uncertain result is not proof of rollback.** A checkpoint
whose outcome is unknown is resolved by **reopening the store and inspecting durable state**:
read the committed activation record's `copied` set and the corresponding target rows.

- Both present and consistent ⇒ **the batch committed.** Do not replay it.
- Neither present ⇒ the batch did not commit. Replay it.
- Inconsistent (progress without rows, or rows without progress) ⇒ the rows-plus-progress
  atomicity invariant was violated ⇒ **E0, blocked.** (This is a staging check, so it applies
  before activation; A6 is a different row, covering a `copied` entry outside the manifest.)

This forbids blind replay (which could overwrite newer committed state) and duplicate
activation: activation itself is only attempted from E6, after re-validation, and a record
already `active` is never re-activated.

**Cleanup, and the honest detection boundary.** "The source is never read again" means: **the
source is never read as an authority for application data after activation.** Retirement *does*
read it, for one purpose — before deleting a key it re-computes the fingerprint and compares it
to the manifest:

- match → safe to delete;
- **differ → do not delete.** The source holds a value the target never saw. Record and surface
  it (§6);
- **source missing or unreadable → delete nothing** (B2): retirement stalls, access is
  unaffected.

**This is the entire detection mechanism, and it is bounded.** It detects an older-build write
only for manifest keys, and only while retirement still runs. Once `sourceRetirement` is
`complete`, nothing reads the source and later writes are **undetected**. Downgrade is
**unsupported**, no merge is offered, and no detection is promised that cannot be performed.

##### 5.6 Traces

**T1 — post-activation record corruption.** Activate → user deletes session S → record
corrupts → relaunch. **A2: blocked.** No import. S stays deleted. (W1 would have restored it.)

**T2 — a copied current-session value changes before restart.** 14 keys enumerated, 9 copied
including `currentSession`; an older build rewrites `currentSession`; relaunch. Content
validation fails → **E5: blocked**, **staged rows preserved, nothing discarded**. There is no
mixed-generation snapshot, and the earlier "discard and re-enumerate" response is withdrawn:
the staged copy may be the only remaining copy of the pre-change value.

**T3 — an uncopied outbox value disappears before restart.** The sync key is in the manifest,
not yet copied, and is gone on resume → set-equality fails → **E5: blocked**, not "skip" and
not re-enumerated. Re-enumeration would produce a manifest that simply lacks the key, which is
precisely the silent omission this rule prevents. **Nothing is omitted and no deletion is
inferred.**

**T3b — a newly eligible source key appears after enumeration.** Every recorded fingerprint
still matches, so a content-only check would pass. Set equality fails → **E5: blocked**; the
key cannot be left out of the migrated generation.

**T4 — a known outbox key contains a future schema.** Copied **verbatim** (5.3). Migration
does not parse it; after cutover the sync repository applies its existing unsupported-version
policy unchanged. **It is never skipped**, so hydration never sees `absent` and never writes a
default over it. This is deliberately unlike an unsupported **activation-record** schema, which
blocks (A3/A4).

**T5 — identity records change between interrupted attempts.** A new barrier/resolution is
written to the source between attempts. Set/content validation diverges → **E5: blocked**, and
the divergence is reported rather than absorbed. The dynamic
`accessBarrierResolution.<uuid>.v1` family is enumerated by membership test, so a barrier
created since the last attempt is seen — as a set difference, not as a silent inclusion.

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

**T9 — interruption between the two provenance writes.** The writes are to different stores and
were never atomic, so both orders are reachable and neither is inferred from the other. Source
marker written, **no target record and an empty target** → the id is adopted into the new
record; nothing was staged, so nothing can be contradicted. Target record written, **marker
missing** → **blocked (P-1)**: this observation is indistinguishable from a marker written and
the source later cleared, so the marker is not recreated. **Blocking is the conservative
action, not a resolution**, and it applies only before activation.

**T10 — uncertain checkpoint commit.** The plugin returns an ambiguous result. The store is
reopened and durable state inspected: progress **and** rows present → the batch committed and
is **not replayed**; neither present → replayed once; one without the other → **E0: blocked**.
The uncertain result is never itself taken as proof of rollback.

##### 5.7 Limits of the guarantee

A passing mocked write proves control flow, not survival of power loss; that is what M3b1's
pragma/reopen tests are for. Native storage does not survive uninstall and does not make an
unsynchronised record recoverable from another device. **Downgrade is unsupported, no merge is
offered, and post-retirement source writes are undetectable.** Nothing here is implemented.

#### 6. User-visible readiness and failure states

Using the existing truthful status conventions — **local save success is not cloud success**:

| Condition | Observable behaviour |
| --- | --- |
| Storage preparing / migrating | A blocking readiness state **before** the sporting shell mounts. Never an empty workspace that looks complete |
| Storage unavailable or migration failed | An honest blocking message with **retry**, and **no silent reset**. Existing data is not touched |
| Saved on this device only | The existing device-only wording; explicitly **not** "backed up" |
| Synchronised | The existing synchronised state, unchanged |
| Pending / failed synchronisation | The existing pending/failed states, unchanged and still distinct from local-save success |

No navigation redesign, no new cloud record types.

#### 7. Implementation stages and acceptance gates

**The earlier stage order was unsafe: M3b3 activated native consumers in production before
M3b4 supplied migration, which would have run an existing installation's normal hydration
against an empty new engine.** Corrected below: **production cutover happens in M3b5 and
nowhere earlier.** Every stage before it is inert in production.

| Stage | Prerequisite | Allowed code | Production effect | Completion criteria |
| --- | --- | --- | --- | --- |
| **M3b1 — engine evidence** | M3b0 reviewed | the native adapter module and an **opt-in, off-by-default diagnostic panel inside the existing app**; **no production composition** | **None** | Which of R1/R2/R3 (§2) is adopted, decided on measured evidence; synthetic sizing and a recorded operating envelope; the diagram-cache policy (§1) decided. Scope below. **Adapter and panel implemented 2026-09-30. Device evidence now exists for the PRAGMAS and RESTART RECOVERY (status below); the commit/uncertain-commit and reopen-after-interruption measurements the migration depends on are STILL NOT TAKEN, and no operating envelope is recorded.** The diagram-cache policy is decided (§1) |
| **M3b2 — native adapter** | M3b1; engine chosen | new adapter module + its tests | **None by itself — it is selected only by M3b3's flag** | Implements `RemovableStorageAdapter` with unchanged result contracts; real-engine integration tests; unsupported platform fails closed. **The module is written and unit-tested (2026-09-30) and now runs against the real engine on a device for reads, writes and restart recovery. The row is still NOT complete: the transactional evidence source retirement depends on is unmeasured** |
| **M3b3 — composition, behind an off switch** | M3b2; **§4 session decision APPROVED (S2, 2026-09-30)** | all five seams in §3, identity injection, protected credential store, readiness gate | **None: the native adapter is selected only under an explicit off-by-default build flag, and even then the application does not mount** — see the barrier below. Existing installs keep `localStorageAdapter` | Every seam demonstrably reaches the selected adapter; hydration/identity/sync all wait on readiness; **no default written while preparing**. **IMPLEMENTED 2026-09-30** |
| **M3b4 — migration** | M3b3 | migration module, activation record, source enumeration | **None — still behind the flag** | The M3b0 §5.4 table and M3b0 §5.1 model implemented; every trace in M3b0 §5.6 and every acceptance case below green |
| **M3b5 — production cutover** | M3b4 reviewed | flag default flip only | **THIS is the cutover** | Migration runs before the shell mounts; blocked states surface per §6. **Not yet performed — this row is a criterion, not a result** |
| **M3b6 — device acceptance** | M3b5 | none | — | The iPhone procedure below passes and is **reported by the user**. Android remains M5 |

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
normal application storage, and does **not** settle where provider credentials are stored.
**Whether existing local data is preserved or an explicitly authorised pilot reset is
performed remains an open user decision**, and no code here assumes either answer.

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
| `synchronous = 2` | `FULL` — the strongest setting SQLite offers — is **actually in force** (0 OFF, 1 NORMAL, 2 FULL, 3 EXTRA) |
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
- **Nothing about transactions.** The panel exercises reads, writes, removals and restart
  recovery; it does not exercise `beginTransaction`/`commitTransaction`.

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
  `src/lib/supabase/providerCredentialStorage.ts` (the SDK-facing integration, the readability
  marker and the application-owned failure channel).
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

- **The transactional device measurements above are still missing**, so **the engine choice is
  settled for the ADAPTER but source retirement remains unjustified**, and no operating
  envelope is recorded.
- **No migration.** Nothing enumerates, copies, activates or retires anything; the §5 protocol
  is unimplemented and its three open design items still block M3b4.
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
**device** (user-reported). **As of 2026-09-30 the mock and compilation classes are satisfied,
and the device class is PARTIALLY satisfied**: the user has reported the effective pragmas and
a successful restart recovery (see the device-evidence table above). **What is still missing is
the TRANSACTION evidence** — what the plugin reports on a failed or uncertain commit, and how
the store behaves on reopen after an interrupted one — which is what source retirement depends
on, so no operating envelope is recorded and retirement stays unjustified.

**Two different kinds of readiness, and they must not be conflated.**

| | **Evidence-stage readiness (M3b1)** | **Migration and activation readiness (M3b4/M3b5)** |
| --- | --- | --- |
| What it asserts | The isolated synthetic diagnostic surface is specifiable and may be built | The production migration protocol is safe to implement and then to cut over |
| Depends on the §4 provider-session decision? | **No** | M3b3 did, and it is now SETTLED (S2); M3b5 inherits it |
| Depends on the §5 protocol passing review? | **No** — the diagnostic panel migrates nothing | **Yes** |
| Status today | **Gathered, partially.** Pragmas and restart recovery are user-reported; commit semantics and reopen-after-interruption are not | **NOT ready.** Three open design items remain — see the inventory below — plus the secure-credential transfer and cross-store interruption cases named in §4 |
| Production effect | None | M3b5 is the cutover |

**Credential-policy approval was a prerequisite for Stage M3b3 (composition), not for M3b1,
and it is now SATISFIED (S2, 2026-09-30).** Isolated synthetic engine evidence never depended
on it, and gathering that evidence asserts nothing about the migration protocol.

**This document does not claim that the production migration protocol has passed review.** It
is a design under review. **The canonical inventory of open engineering items — three, all
blockers for M3b4 and none for M3b1 — is:**

1. **P-1 — missing pre-activation source marker** (§5.2): indistinguishable from later source
   clearing; blocked conservatively.
2. **P-2 — differing provenance ids before activation** (§5.2): blocked rather than guessed.
3. **Source-generation divergence recovery** (§5.5): resolving a blocked divergence is
   human-authorised and unspecified.

Other documents reference this inventory rather than restating it. **The count is still
three**: the two items below are not additions to it but **explicit migration-stage
requirements** that Stage M3b3 established and did not perform.

*Named migration requirements arising from the S2 credential decision (§4), due in M3b4:*

Plus one genuinely **open product question**, deliberately not settled by Stage M3b3 and due
with the cutover (M3b5):

- **What a mounted application should do about a credential failure that happens
  MID-SESSION.** Composition already refuses to become ready over an unusable credential
  store, so nothing starts from a broken one, and the failure verdict is sticky and readable
  (`OwnedStorageComposition.credentialFailure()`). What is not decided is the behaviour: a
  sticky historical latch should probably not blank a working workspace, and silently ignoring
  it would be dishonest. Nothing is implemented in either direction, and no code guesses.


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

**Required acceptance cases — FUTURE IMPLEMENTATION REQUIREMENTS, not results.** None of
these has been written or run. They are stated as executable future scenarios against the
checkpointed model (M3b0 §5.1), and they become due with the stage named beside each group.
Unit/model, real-engine integration and device evidence stay separate and are never
substituted for one another.

*Authority and recovery (M3b0 §5.4) — due in M3b4*

1. D1 — no record, target empty, source readable and empty → activates; nothing migrated.
2. **D2 — readable-empty source with a POPULATED target and no activation evidence → BLOCKED**,
   no import, no delete. (The case D1 must not absorb.)
3. **C1 vs C2 — failed source enumeration is not an empty source**: with no `active` record the
   run blocks and retries; it never proceeds as "nothing to migrate".
4. **E3 — interrupted enumeration** → attempt record abandoned, re-enumerated under a new
   `migrationId`; nothing was staged, so nothing is deleted.
5. A1/A2/A3/A4/A5 — unreadable record, malformed record, invalid `phase`, `schemaVersion`
   higher **and** lower than supported, malformed manifest → blocked; never downgraded, never
   overwritten.
6. **A6 — a `copied` entry outside the manifest** (a self-contradictory record) → blocked.
6b. **E0 — staging progress and staged data disagree PRE-ACTIVATION, in both directions**: a
    `copied` key with no committed target row, **and** a committed row for a manifest key absent
    from `copied` → blocked in each direction; no repair by deletion or re-copy.
7. E1 — `storeIdentity` missing or mismatched → blocked.

*Provenance markers (M3b0 §5.2) — due in M3b4*

8. **Valid activated target with a missing, cleared or unreadable old source → ordinary access
   proceeds.** The absent source marker does **not** block; retirement is recorded as stalled
   (B2). This is the regression the earlier both-markers rule would have caused.
9. **Source marker written, no target record, target empty** → the id is adopted into the new
   record and the run continues. No atomicity between the two stores is assumed.
10. **Target record present and pre-`active` with no source marker → BLOCKED (blocker P-1).**
    The marker is **not** recreated, and the two possible causes — an interrupted write, or a
    marker written and the source later cleared — are **not** distinguished, because the
    protocol records nothing that separates them.
11. Both markers present and equal → proceeds. Both present and **different** while pre-`active`
    → **blocked** (blocker P-2), not silently resolved.

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
16. **Source changes after `verified` but before activation** → E7: `verified` is re-validated
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
22. **Uncertain commit, reopen shows the batch COMMITTED** (progress and rows both present and
    consistent) → **not replayed**. Blind replay would overwrite committed state.
23. **Uncertain commit, reopen shows NO commit** (neither progress nor rows) → replayed exactly
    once.
24. **Uncertain commit, reopen shows an inconsistent half** → E0, blocked; never repaired by
    guessing.
25. An uncertain **activation** commit is resolved the same way, and a record already `active`
    is never re-activated.
26. Configured `journal_mode`/`synchronous` behave as assumed — measured by the M3b1 in-app panel,
    never assumed from documentation.

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
    which closes both SDK absorption paths. **NOT covered, and reported as a blocker:** no
    audited dependency supplies the item-specific evidence the contract requires, so the
    binding reports `no_absence_evidence` and the **native credential path is closed** (§4).
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

**iPhone acceptance procedure (M3b6, not yet performed).** Install the previous build, record
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
- It does not decide P1, P3, P4, P5 or P7. **P2 and P6's direction WERE decided by the user
  on 2026-09-29** and are recorded in §4, §7.1 and §7.5 — those entries are the decision
  record, not this document's own recommendation. P6's implementation and acceptance gate
  remain incomplete.
