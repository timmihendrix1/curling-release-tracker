# Mobile client (Capacitor / Vite)

The **same application** the Web build runs, bundled locally for a native shell.
`mobile/src/MobileApp.tsx` composes the identical provider tree as
`src/app/page.tsx` — `IdentityProvider → AuthenticatedSportingPersistence →
TrackerApp` — importing `src/components/` and `src/lib/` directly. **Nothing is
copied.** A change to the shared modules reaches Web and mobile at once.

**Where this stands** (`docs/MOBILE_APP_MIGRATION.md`):

- **Stage M1 — shell and build groundwork: implemented.** The app launches as far
  as the real identity gate. The user has reported the visible launch and layout
  checks working on a physical iPhone; that is **user-reported evidence**, and the
  remaining M1 device items — notably `crypto.randomUUID` and external links —
  have **not** been reported as verified.
- **Stage M2a — configured API origin, server CORS and email-OTP groundwork:
  implemented, automated tests only.** Email OTP needs no callback, so the
  acceptance procedure below is possible — but **nobody has run it**, the server
  CORS change is **not deployed**, and no on-device sign-in or API call has been
  made. M2a is **not** M2 and **not** M2-partial.
- **Not implemented:** native Google sign-in (the rest of M2), usable offline
  persistence and export (M3), Brower capture (M4), Android (M5).

This is **not** a distributable app.

## Commands

| Command | What it does |
| --- | --- |
| `npm run mobile:build` | Production bundle into `mobile/dist/` |
| `npm run mobile:preview` | Serve that bundle in a desktop browser |
| `npm run mobile:typecheck` | Type-check the mobile surface alone |
| `npm run mobile:lint` | Lint `mobile/` and `capacitor.config.ts` |
| `npm run mobile:test` | The M1 checks (needs a completed build for the artifact ones) |
| `npm run mobile:verify` | typecheck → build → test, in that order |
| `npm run ios:sync` | Copy the built bundle into `ios/` |
| `npm run ios:open` | Open the generated Xcode project |

The existing `dev`, `build`, `start`, `lint`, `test` and `test:e2e` scripts are
untouched, and the Next.js Web build is unaffected.

## Configuration

The build inlines a small, explicitly allow-listed set of literals, read from the
repository's ordinary `.env` files (the same source `next build` uses — see
`.env.example`):

| Name | Source | Behaviour when absent |
| --- | --- | --- |
| `NEXT_PUBLIC_SUPABASE_URL` | `.env*` / environment | Gate reports `cloud_unavailable` |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | `.env*` / environment | Gate reports `cloud_unavailable` |
| `NEXT_PUBLIC_NATIVE_API_ORIGIN` | `.env*` / environment | Team requests deny before any token read; sign-in still works |
| `NODE_ENV` | **pinned to `production` for every `vite build`** | — |

`NEXT_PUBLIC_NATIVE_API_ORIGIN` is the one API origin a **native** build may address
(ADR-0047). It must be a canonical bare **https** origin — no path, trailing slash, query,
fragment or credentials — and it is inert on Web, where the document origin is used exactly
as before. The deployed value is `https://curling.evolane.me`. `.env.example` carries the
exact contract.

The allow-list lives in `mobile/publicEnv.ts`. It is an allow-list, not a
passthrough: `process.env` is never serialised into the bundle and no
browser-wide `process` shim is installed. **Server-only configuration
(`APP_ORIGIN`, SMTP credentials, `CLOSED_BETA_EXERCISE_ASSET_TEAM_ID`, any
Supabase secret key) must never be added to it.**

### Mode selects configuration; it is not a runtime switch

`--mode` picks which `.env.<mode>` file is read — a staging cloud project, a
synthetic configuration for verification. It does **not** decide whether the
application runs its production guards. Every `vite build`, under any mode and
from any ambient `NODE_ENV`, produces an artifact with production React, the
production JSX transform, `IS_DEV` false and **no** `NODE_ENV === "test"`
Profile-scope fallback. Only a dev server is "development", and a dev server is
not something anyone installs.

Missing configuration is honest, not fatal: the app reaches the real identity
gate and reports that sign-in is unavailable. It never fabricates a Profile.

## Running on a physical iPhone

```bash
npm run mobile:build
npm run ios:sync
npm run ios:open
```

Then, in Xcode:

1. Select the **App** target → **Signing & Capabilities**.
2. Choose your **Team** (a free personal Apple ID is enough for development).
   Nothing in this repository selects an account or stores a signing identity.
3. Select the connected iPhone as the run destination.
4. Build and run. On first install, trust the developer certificate on the
   device (**Settings → General → VPN & Device Management**) and enable
   **Developer Mode** if iOS asks.

Expect the app to launch, dismiss the splash, and show the identity gate.

**Email sign-in is now expected to be reachable** (Stage M2a shipped the typed-code
path and the configured API origin), but it has **not been exercised on a device**
and depends on the two prerequisites named in the next section. **Google sign-in is
still not expected to work natively** — that remains the unfinished part of M2.

## Manual iPhone acceptance — email OTP and API access (Stage M2a)

**Nobody has run this yet.** It is the user's to perform; nothing in this repository claims
a device result. Build, sync and open as above, then install on the device.

**Before starting, two things must be true, and neither is done by this repository:**

1. **The server CORS change must be deployed.** Until the backend at
   `https://curling.evolane.me` serves the `OPTIONS` handlers added in M2a, step 8 will fail
   no matter how the app is configured. Local tests prove the handlers, not the deployment.
2. **The Supabase project's email template must deliver a typed code**, not only a magic
   link. This has **not** been inspected or configured here.

The build must carry `NEXT_PUBLIC_NATIVE_API_ORIGIN=https://curling.evolane.me`. Rebuild and
re-sync after changing it — it is inlined at build time, not read at runtime.

| # | Check | Expected |
| --- | --- | --- |
| 1 | Launch the app | The identity gate renders; no crash |
| 2 | `crypto.randomUUID` | In Safari's Web Inspector attached to the device, evaluate `crypto.randomUUID()` — it returns a v4 UUID. **Still unverified on hardware**; the automated check covers desktop Chromium only |
| 3 | Request a code | Enter an email, tap "Send sign-in code"; a **typed code** arrives |
| 4 | Wrong code | Enter an incorrect code — a clear failure, no session, gate still locked |
| 5 | Expired code | Wait past expiry, then enter the old code — refused, no session |
| 6 | Network failure | Enable Airplane Mode, request a code — an honest failure, no crash, no fabricated success |
| 7 | Existing account | Sign in with an account that already completed onboarding — the training app opens |
| 8 | Authorized API operation | **In a Team created for this test**, perform any one `/api/team/*` operation; inviting a **second address you control** is the simplest suggestion, not the only supported route. It succeeds against the configured origin. **This is the step that proves deployment**, and the only one that can fail purely because the server has not been updated |
| 9 | New account | Sign in with a fresh address — mandatory onboarding appears and must be completed before the app is reachable |
| 10 | Sign out | The gate returns; no training data is visible |
| 11 | Account switch | Sign in as a different Profile — **none of the previous Profile's sessions, plans or results appear** |

**Scope of this procedure.** Create a **dedicated test Team** and use only accounts and
recipient addresses **you control**. Step 8 necessarily mutates that test Team, because
every `/api/team/*` route is a mutation — inviting a second address you control is simply
the **suggested** one; any of the five Team operations exercises the same boundary equally
well. So the rule is *where* the mutation lands, not that nothing may change: **do not run
any step against an existing real Team, and do not involve a third party.** Delete the test
Team afterwards if you wish.

This is a **manual procedure for the operator**, not authorization for any agent or
automated run to perform hosted mutations or send email.

**What a pass does and does not establish.** Passing 1–11 makes Stage M2 **M2-partial**:
email OTP and authorized API access work on device. It does **not** make native Google
sign-in work (not implemented — see ADR-0047 and migration §6), and it establishes nothing
about offline persistence durability or export, which are Stage M3.

## Development placeholders

`capacitor.config.ts` uses `local.dev.curlingperformance` /
"Curling Performance (Dev)". These are **placeholders**: production application
identity (bundle identifier and app name), the **Google callback domain** and
distribution commitments remain open decision **P4**
(`docs/MOBILE_APP_MIGRATION.md` §4) and must be resolved before M6. No app is
registered under these values, no URL scheme or domain is claimed, and no
provider redirect is configured.

**The API origin is no longer among them.** It is confirmed as
`https://curling.evolane.me` and is configured through
`NEXT_PUBLIC_NATIVE_API_ORIGIN` (ADR-0047). Confirming it settles the API
destination only — it decides nothing about the callback domain, the bundle
identifier or distribution.

`Info.plist` declares **no** `UIBackgroundModes` and **no** Bluetooth permission.
Background measurement is open decision **P3**; declaring a capability this build
does not exercise would be an unjustified claim.

## Android

Android is Stage M5 and **no Android project exists**. The architecture is ready
for it — one shared build produces one asset bundle, and a second native project
would consume the same `mobile/dist/` — but nothing here has been compiled or run
on Android, and a passing iOS check is never evidence for Android.

## What is bundled

All 67 registered public Exercise diagrams (current **and** superseded asset ids,
because saved plans and recorded results reference the superseded ones) are
emitted into `mobile/dist/exercise-diagrams/`, at exactly the paths
`createPublicExerciseAssetResolver` fetches. A registered diagram with no file
fails the build.

No `server.url` is configured, and none may ever appear in a release
configuration: the bundle is local, and a remote wrapper would silently change
the application's same-origin security model.
