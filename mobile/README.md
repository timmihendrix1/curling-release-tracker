# Mobile client (Capacitor / Vite)

## Current new-user beta build (27 October 2026)

`npm run mobile:build:new-user-beta` explicitly selects the new-user iOS entry
from the actual MobileApp root. This is a separate local artifact; the default
build and historical `mobile:build:native-storage` barrier retain their behavior.
Earlier statements below that no build starts a migration refer to those earlier
builds, not this new explicitly selected empty-source initialization lane.
Combining the new selection with diagnostics or legacy storage fails build.

The beta requires the three existing public configuration values from
`.env.example`: HTTPS Supabase URL/publishable key and the HTTPS native API origin.
Values are read through existing configuration boundaries and are never logged.
Missing/invalid configuration or a non-iOS platform blocks before native stores.
One real configured host uses the fixed `curling-sporting-v1` database and actual
SQLite/protected bridges. It positively proves strict empty origin, resumes only
tagged initialization, and cold-opens genuine native authority. Populated legacy
or ambiguous retained state is refused without import, reset or deletion.
The actual shared identity gate requires email OTP and completed Profile before
training; the shared native Tracker supplies existing Account/export/Team behavior.

React replay keeps the same owner. Final unmount drains genuine work; uncertain
cleanup remains blocked. Module-load errors show a fixed blocked message.
The installed SDK has an existing module-time browser diagnostic: transient
`lswt-*` write/removal and `supabase.gotrue-js.locks.debug` read. These are counted
separately, never used as identity/storage authority, and are not source fallback.
A diagnostic leftover is unsupported on fresh initialization. No SDK patch is used.

This stage does not assign real configuration, run Capacitor sync/install, alter
signing/entitlements, touch the original iPhone, upload to Apple or publish Beta.
Native OS Team links may continue opening Web under the existing specification.
Physical Keychain/WKWebView, actual hosted setup, legal/worker and Apple acceptance
remain separate. Q4 is unapproved. Canonical contract and current evidence:
`docs/BETA_COMPLETION_SPECIFICATION.md` and `docs/TESTFLIGHT_READINESS.md`.


The **same application** the Web build runs, bundled locally for a native shell.
`mobile/src/MobileApp.tsx` composes the identical provider tree as
`src/app/page.tsx` — `IdentityProvider → AuthenticatedSportingPersistence →
TrackerApp` — importing `src/components/` and `src/lib/` directly. **Nothing is
copied.** A change to the shared modules reaches Web and mobile at once.

## Confirmed iOS identity and installation hold

The user confirmed **Evolane Curling / `me.evolane.curling`**, team **`J98U2J78B3`**,
for TestFlight and the App Store on 2026-10-21. Hermes reports the registered Explicit
App ID and App Store Connect record **`6825376799`**, SKU **`evolane-curling-ios`**,
primary language **English (U.S.)**; German is deferred. Native development region remains
`en`. The local configuration now targets that identity in both Debug and Release.

**Do not press Run / Cmd-R on the owner's iPhone from this project.** The old test app
uses `local.dev.curlingperformance`; the user reported it running before this local
identity change. That report does not establish complete data preservation. The new
identity has a separate container and does not inherit old data or credentials. No
installation, profile/certificate change, storage activation or upload is authorized by
the local identity/build work. The complete transfer/restore path and device gates remain
open (P4/P6 and `docs/TESTFLIGHT_READINESS.md` §2). Preserve the old installation.

**Where this stands** (`docs/MOBILE_APP_MIGRATION.md`):

- **Stage M1 — shell and build groundwork: implemented.** The app launches as far
  as the real identity gate. The user has reported the visible launch and layout
  checks working on a physical iPhone; that is **user-reported evidence**, and the
  remaining M1 device items — notably `crypto.randomUUID` and external links —
  have **not** been reported as verified.
- **Stage M2a — configured API origin, server CORS and email-OTP groundwork:
  implemented, automated tests only.** On **2026-09-29** the user reported that
  email login works on their iPhone, that a training recorded on iOS reached the
  Web app, and that an offline cold start, recording and later sync worked — the
  receiving Web app had to be reopened before the training appeared. Those are
  **user-reported device observations**, not agent-executed tests, and they do
  not cover the full acceptance matrix. The server CORS change is still **not
  deployed** and no on-device Team API call has been made. M2a is **not** M2 and
  **not** M2-partial.
- **Stage M3a — native file export and external public links: implemented**,
  verified by automated tests and an unsigned native build. **Partly reported on a
  device by the user (2026-09-29):** CSV export works including in Airplane Mode,
  and the Privacy Notice opens in the native Safari browser surface after
  rebuilding with the configured public API origin. Team JSON export is deferred
  (no Team results available); **every other M3a device step is unperformed**
  (procedure below). M3a does **not** complete M3.
- **Stage M3b — durable native local storage: ADAPTER, IN-APP DIAGNOSTICS AND COMPOSITION.
  NO MIGRATION AND NO CUTOVER.**
  P6's direction was decided on 2026-09-29 (adopt durable native storage; do not keep
  `localStorage` by accepting its eviction risk), and P2 was answered (no browser→app
  transfer in the first pilot). On **2026-09-30** the user decided that native storage is
  exercised **directly in this app**, not in a separate harness application, and settled
  three further points: **provider credentials use a separate protected store** (iOS
  Keychain; Android encrypted app-private storage with keys in the Android Keystore, behind
  one shared contract), **all existing local data is preserved** — no pilot reset,
  uninstall/reinstall, storage clearing or discarding of unsynchronised work — and
  **existing data must be migrated and verified before any cutover**.

  **What now exists:** the pinned `@capacitor-community/sqlite` engine; a native
  `RemovableStorageAdapter` (`src/lib/persistence/nativeSqliteAdapter.ts`) behind the
  unchanged persistence contract; an **off-by-default, build-time-opt-in diagnostic panel**
  driving it against a **dedicated synthetic database** (procedure below); and — behind a
  **second, independent** off-by-default flag — the **storage composition**: all five seams,
  identity-repository injection, the protected credential store and a readiness gate
  (`npm run mobile:build:native-storage`, and the warning below).

  **What does not exist:** any **migration run by the application** (a dormant executor,
  Stage M3b4b, exists in the source tree but no build invokes it), any **cutover**, any transfer of the
  credentials already in WebView storage, any change to cloud synchronisation, and any
  **background-sync guarantee** — nothing here makes an upload happen while iOS has
  suspended or closed the app. **A default build contains no composition code at all** and
  the app's own data keeps using its existing storage.

  **The protected credential path is CLOSED, and that requirement is not complete.** The
  contract requires the platform to say, per item, whether nothing is there — only a
  positively established absence may be read as "no session". No audited Capacitor 8
  dependency supplies that: on iOS the plugin discards the Keychain result code, and on
  Android a restored backup leaves ciphertext whose Keystore key is gone and reports it as
  nothing. An earlier "readability marker" inference was invalid (reading one key says
  nothing about another) and has been removed, and no global probe replaces it. So the
  binding reports "no absence evidence" and composition blocks — a **second** barrier
  alongside the unavailable activation authority. What would close it: a dependency that
  surfaces the iOS `OSStatus`, or an Android `contains(key)` check separated from a
  decryption failure.

  **Device evidence now exists, within limits.** The user reported (2026-09-30, physical
  iPhone) that `journal_mode = wal` and `synchronous = 2` (FULL) are actually in force, that
  written values survive a restart in airplane mode, and that a never-written key reads as
  absent. On 2026-10-15 the user ran the transaction and checkpoint scenarios on a
  **disposable iOS Simulator** through the real plugin, including a process stop with a
  transaction open (canonical record: "M3b1 real-engine simulator evidence" in
  `docs/MOBILE_APP_MIGRATION.md` Stage M3b0 §7). **Unmeasured:** physical-device
  transaction acceptance, a naturally occurring commit failure, termination during a commit,
  backup/restore, power-loss survival, any capacity limit, and anything about Android. So
  the engine is settled for the **adapter** while **source retirement stays unjustified**.

  The design is Stage M3b0 in `docs/MOBILE_APP_MIGRATION.md` and ADR-0049, whose **migration
  protocol is an approved design (user, 2026-10-19) whose decision core (M3b4a) is approved and
  whose executor (M3b4b) is dormant — no build runs a migration, the flag-enabled one included**.
  **Production
  cutover is Stage M3b5**; every earlier stage is inert in production, and the production
  activation authority still reports `unavailable`. The provenance blockers are closed at the
  design level, and blocked-state recovery has a **decided first-version policy** (U2 and
  UG-1–UG-4, canonical in Stage M3b0 §6). Its interface (M3b4c) exists only as a dormant,
  dependency-injected layer that no build constructs or renders, and it awaits independent
  review (canonical inventory: Stage M3b0 §7). **Two further migration requirements
  follow from the credential decision:**
  transferring the existing session out of WebView storage, and handling the interruption
  where one of the two separate stores is written and the other is not. Migration of
  existing on-device data between storage engines is a **separate, still-required**
  operation from the deferred browser import.
- **Not implemented:** native Google sign-in (the rest of M2; deliberately not offered on
  iOS in the first club beta — the user approved email code only on 2026-10-21,
  `docs/MOBILE_APP_MIGRATION.md` §6.1; Web keeps its existing choices), the rest of M3
  (storage migration, production cutover and a recorded operating envelope — the
  composition exists only behind its off-by-default flag, above), Brower capture (M4),
  Android (M5).

This is **not** a distributable app.

## Commands

| Command | What it does |
| --- | --- |
| `npm run mobile:build` | Production bundle into `mobile/dist/` |
| `npm run mobile:build:diagnostics` | The same production bundle **plus** the native storage diagnostics panel (Stage M3b1). Never use this for anything but storage evidence |
| `npm run mobile:build:native-storage` | The same production bundle **plus** the native storage composition (Stage M3b3). **This build does not run the app** — see the warning below. Never install it for training |
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

**Procedure only, not current authorization.** The commands below prepare local files;
the later device Run step is blocked for the owner's data-bearing installation. A new
device/simulator rehearsal requires its own explicit approval and disposable data.

```bash
npm run mobile:build
npm run ios:sync
npm run ios:open
```

Then, in Xcode:

1. Select the **App** target → **Signing & Capabilities**.
2. Verify the configured **Team `J98U2J78B3`**, **Automatic** signing and bundle ID
   **`me.evolane.curling`**. The team is project configuration, not a stored private key.
   Do not switch the identifier back to the data-bearing source or create new profiles
   as an incidental workaround.
3. Select the connected iPhone as the run destination.
4. Build and run. On first install, trust the developer certificate on the
   device (**Settings → General → VPN & Device Management**) and enable
   **Developer Mode** if iOS asks.

These are expected outcomes for a separately authorized disposable installation, not
permission to perform one now: launch, dismiss the splash, and show the identity gate.

**Email sign-in is expected to be reachable** (Stage M2a shipped the typed-code path and
the configured API origin). The user reported email login on the **old iPhone installation**
on 2026-09-29; that is not complete OTP/API acceptance on the **new target identity**.
The acceptance prerequisites below remain to be verified for that target. **Native Google
sign-in remains unfinished and is deliberately not offered in the first iOS club beta**
(migration §6.1); Web's Google and email choices are preserved.

## Manual iPhone acceptance — email OTP and API access (Stage M2a)

**The complete new-target acceptance matrix has not been run.** The 2026-09-29 user reports
above concern the old installation, not an agent-executed run or a pass for every case below.
This procedure remains the user's to perform **only after separate disposable-device
installation approval**; it does not authorize installing on the owner's data-bearing iPhone.

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
about offline persistence durability. Stage M3b has an adapter, opt-in diagnostics/composition
and a dormant executor, but **no application migration or production cutover** (ADR-0049).

## Manual iPhone acceptance — export and public links (Stage M3a)

**Partly reported by the user on 2026-09-29; the rest is unperformed.** Nothing in this
repository claims a device result — the items below are the **user's report**, recorded as
such:

- **Step 1/2/10 — CSV export works on iPhone, including in Airplane Mode.**
- **Step 8 (Privacy only) — the Privacy Notice opens in the native Safari browser surface**,
  after **rebuilding with the configured public API origin** (see *Build requirement* below).
- **Step 4 (Team JSON) — explicitly deferred:** no Team results are available to export.

**Still unperformed, and not to be described as passing:** step 3 (value comparison), step 4
(any JSON export), step 5 (cancellation), step 6 (retry), step 7 (double-tap), the **Terms**
half of step 8, step 9 (return-to-app state) and step 11.

**Build requirement for the link steps.** `NEXT_PUBLIC_NATIVE_API_ORIGIN` must be set to the
configured public origin (`https://curling.evolane.me`) **at build time** — it is inlined,
not read at runtime — so a build without it resolves no legal destination. Rebuild and
re-sync after changing it. See *Configuration* above and `.env.example` for the exact
contract; never read local environment values.

No prerequisite deployment is needed for export — it is entirely on-device. Opening the
legal pages does need the public site to be reachable.

| # | Check | Expected |
| --- | --- | --- |
| 1 | Export a training CSV (Settings → Export History CSV, or a current session) | The iOS share sheet appears with a `.csv` file whose name is readable, not a generated id |
| 2 | Save it to Files, then open it | The file opens and contains the training you exported |
| 3 | Compare representative values against the app | Shot times, targets and session title match what the app shows. **Report any mismatch — this is the check that proves the export is real** |
| 4 | Export JSON where available (a Team Exercise result; the Brower diagnostic log in a development build) | A `.json` file arrives the same way |
| 5 | Cancel an export: open the share sheet, dismiss it | The app says the export was cancelled and that nothing was saved. It must **not** claim success |
| 6 | Retry immediately after cancelling | The share sheet opens again and completes |
| 7 | Double-tap the export button quickly | Exactly one share sheet appears |
| 8 | Open Privacy and Terms (Settings) | They open **outside** the app, in the platform browser |
| 9 | Return to the app | The app is exactly where you left it — same screen, same in-progress work. It must **not** have restarted |
| 9b | On Android (M5, no project yet) an exported file is deliberately kept in the app cache for a bounded window after sharing, because the chooser result is not proof the recipient finished reading it | n/a on iOS — listed so the difference is not mistaken for a leak |
| 10 | Export while in Airplane Mode | Export still works: it is a local file plus the share sheet, and needs no network |
| 11 | Open Privacy while in Airplane Mode | The **page** fails to load, because it is fetched from the public site. This is expected and is a different thing from export being offline-capable |

Use only your own accounts and data. This is a manual operator procedure, not authorization
for any automated run to perform hosted mutations or send email.

**What a pass establishes.** That export produces a retrievable, correct file on a device
and that public links do not destroy the app. It establishes **nothing** about storage
durability under pressure (P6), browser-local data transfer (P2), or the rest of Stage M3.

## The native storage composition build (Stage M3b3) — NOT a build for training

`npm run mobile:build:native-storage` sets `CURLING_MOBILE_NATIVE_STORAGE=1`, which is a
**separate switch from the diagnostics one** — turning on storage evidence must never also
opt your real training data into a different store, so the two are deliberately not one flag.

**Read this before installing it: the app does not open.** The composition asks a
migration/activation authority for a verdict before it constructs anything, and the only
authority that ships reports `migration_not_implemented` — no build runs the migration
(Stage M3b4b's executor is dormant and not integrated) — and cutover is a separate stage
(M3b5). So the build shows a short blocking message —
"Training data is unavailable", stating that the transfer is not switched on in this build
and that checking again will not change it, with **no** *Try again* button (a retry cannot
activate it; Stage M3b4c) — and **the sporting application
never mounts**. That is the intended behaviour. The approved app-owned iOS Keychain
reader now distinguishes missing from failed reads locally (ADR-0049 amendment,
2026-10-24); device acceptance, credential transfer and activation remain open.
Android's credential reader still cannot establish absence and fails closed.

Why it is built that way: mounting an existing installation against a fresh, empty SQLite
database and an empty Keychain would have every domain read "absent", write its documented
default, and leave you looking at a clean-looking workspace over training data that still
exists in the old store. Blocking before anything is opened is what makes that unreachable.

**It does not touch your training data.** It does not reset, clear, migrate or copy any of it,
it does not sign you out, and it does not transfer the sign-in session that is already there —
a further reason it cannot show you your data. **It also creates no database file.** An earlier
revision of this page said it created an empty one before blocking; that is wrong against the
current ordering. `composeNativeStorage` asks the activation authority for a verdict *before*
it loads the adapter module, and the one shipped authority reports `unavailable`, so the
adapter is never constructed — and constructing one would still open nothing, because
`createNativeSqliteStore` opens the database lazily on its first operation. Going back is the
ordinary sequence:

```bash
npm run mobile:build && npm run ios:sync
```

Only **after separate installation approval on a disposable target** may you Run again in
Xcode. **Do not Run/install on the owner's data-bearing iPhone; preserve its old installation.**
The default bundle, not this blocked composition build, is the training build; generating
it is **not** authorization to install it or evidence that old data/credentials transfer.
The composition build exists so it can be reviewed and exercised, and there is deliberately
no switch — no URL parameter, no stored preference, no developer toggle — that can make it mount.

## Manual iPhone procedure — native storage diagnostics (Stage M3b1)

**Partially performed (user-reported, 2026-09-30):** `journal_mode = wal`,
`synchronous = 2` (FULL), `page_size = 4096`, `sqlite_version = 3.53.4`, a successful
"Verify after app restart" **in airplane mode**, all five synthetic fixtures matched at
994,669 bytes total, the never-written key absent, and 55 ms for the reported verification.
**Also performed on a disposable iOS Simulator (user-reported, 2026-10-15)**, together with
the checkpoint scenarios below; the canonical record is "M3b1 real-engine simulator evidence"
in `docs/MOBILE_APP_MIGRATION.md` Stage M3b0 §7, and the two runs are kept separate.
**Still not measured:** physical-device transaction acceptance, a naturally occurring commit
failure, termination during a commit, backup/restore, power-loss survival, any capacity
limit, and anything on Android. This section is the procedure; the remaining results are the
user's to produce.

### What this installs

`npm run mobile:build:diagnostics` produces the **same production artifact** as
`npm run mobile:build` — production React, production JSX transform, `IS_DEV` false, no
`NODE_ENV === "test"` Profile-scope fallback, the real identity gate — **plus** one extra
surface: a "Storage diagnostics" button in the bottom-right corner, opening a panel. The
normal app is underneath and one "Close" away. A default build contains none of this: the
conditional import folds away, so the panel, the synthetic database name and the SQLite
plugin are simply absent from the artifact.

The panel touches **only** a dedicated synthetic database named
`curling-storage-diagnostics-synthetic`, with deterministic generated fixtures. It never
reads, writes, clears or migrates a real record, and it uploads nothing. **Your existing
app data is not read and not modified by any step below.**

### Build and install

```bash
npm run mobile:build:diagnostics
npm run ios:sync
npm run ios:open
```

For a separately authorized disposable rehearsal only, select **App**, verify team
`J98U2J78B3` and current bundle ID `me.evolane.curling`, then choose the disposable target.
It updates an installation of that same current identity; it does **not** update or
transfer the old `local.dev.curlingperformance` container. Historical evidence below
belongs to the old identity and does not prove the new one. Returning to an ordinary
bundle uses `npm run mobile:build && npm run ios:sync`; another device Run still needs
its own authorization. Do not use the owner's iPhone for this procedure.

> **Do not install this build over a data-bearing installation.** The synthetic database
> keeps the panel away from application data, but it does not make replacing the
> installation you train with an authorised action. The user's only physical iPhone holds
> real training data and must not receive the diagnostics build; the 2026-10-15 run used a
> fresh, disposable simulator instead. These instructions describe how a build is installed,
> not permission to install it on that device.

### Procedure

| # | Step | What to record |
| --- | --- | --- |
| 1 | Open the panel, press **Read effective SQLite settings** | The reported `journal_mode`, `synchronous`, `page_size` and `sqlite_version`. These are what the engine reports, not what the build asked for |
| 2 | Press **Write synthetic fixtures** | Per-fixture bytes and elapsed milliseconds, especially for the ~1 MiB whole-document JSON |
| 3 | Press **Verify in this app session** | Pass/fail. This proves round-tripping only |
| 4 | Press **Update and remove a test key** | Pass/fail for write, overwrite, removal and genuine absence |
| 5 | Press **Close and reopen the database** | Pass/fail after the connection was closed, its native handle released and a fresh connection opened. If any of those steps fails the panel names it and verifies nothing |
| 6 | Put the device in **Airplane Mode**, repeat steps 2–5 | Whether anything differs offline. It should not: this is entirely local |
| 7 | **Force-quit** the app (swipe it away from the app switcher). Do not merely background it | — |
| 8 | Relaunch, open the panel, press **Verify after app restart** — and press nothing else first | "Verified after app restart" with the earlier run id and timestamp. If it says the fixtures were written by this session, the force-quit did not take effect. If it says the last run did not finish writing, step 2 was interrupted — repeat from step 2 |
| 9 | Repeat 7–8 after leaving the device idle/locked for a while | Whether anything is lost |
| 10 | Press **Delete the synthetic data** when finished, then **Delete** in the confirmation | The confirmation names the synthetic database and everything it holds (fixtures, run record, test key, checkpoint evidence). **Cancel** deletes nothing |

**Do not skip step 8's "press nothing else first".** Writing the fixtures again before
verifying destroys the very evidence the restart check depends on — which is also why the
panel writes nothing when it opens.

**Stopping the process on a simulator.** Step 7's app-switcher swipe is the physical-device
method. In the user-reported 2026-10-15 simulator run, the process was stopped with Xcode's
**Stop** and started again with **Run**. Whichever method is used, the panel is the check:
**Verify after app restart** must report fixtures written by an *earlier* session. If it
reports this session, the process did not restart. Backgrounding the app or reloading the
web view is not a process stop.

A run marks itself in progress **before** it touches the first fixture and marks itself
complete only after every write is acknowledged. So an interrupted or failed write cannot be
mistaken for restart evidence later: the panel reports that the run did not finish rather than
certifying fixtures it cannot attribute. The fixtures are byte-identical between runs, so that
record is the only thing that can tell one run from another.

### What a pass does and does not establish

A pass establishes that the engine round-trips these payloads on this device, and that
values written before a force-quit are still there after relaunch. It establishes
**nothing** about power loss, nothing about OS-initiated eviction over weeks, nothing about
Android, and **no safe capacity** — the fixture sizes are measurement points, not a limit.
It also says nothing about the migration protocol, which no build executes (its executor,
M3b4b, exists only dormant and has never run on a device).

## Manual procedure — checkpoints and transactions

**Run once on a disposable iOS Simulator (user-reported, 2026-10-15); never run on a physical
device.** The results of that run, and what it does not establish, are recorded once in
"M3b1 real-engine simulator evidence" in `docs/MOBILE_APP_MIGRATION.md` Stage M3b0 §7.
Physical-device transaction results are still outstanding: do not record them as measured
until they have actually been run.

### What a checkpoint is, and why this exists

Stage M3b4's migration is specified as a sequence of **checkpoints**: one transaction commits
a batch of payload rows **and** the progress record describing them, so an interruption leaves
either a whole checkpoint or the previous one — never half of either
(`docs/MOBILE_APP_MIGRATION.md` Stage M3b0 §5.1). That design rests on engine behaviour: what
a failed commit reports, and what a store looks like when it is reopened after an interrupted
one. These actions gather engine evidence, **not a run of the dormant migration executor**.
So far they have been observed on a disposable simulator only, with the process stopped **before** a commit; a
naturally occurring commit failure and termination **during** a commit have not been
observed on any device.

Payloads here are **attempt-scoped**, unlike the restart fixtures. The fixtures are
deliberately byte-identical between runs because their question is "did these bytes survive";
a checkpoint's question is "did *this attempt* commit", and deterministic bytes would answer it
wrongly — an earlier successful attempt would leave rows indistinguishable from the ones the
current attempt meant to write. Every payload is therefore derived from the attempt id and the
checkpoint number, and verification regenerates the expected bytes rather than trusting
anything stored.

### The actions

| Action | What it does | What a pass means |
| --- | --- | --- |
| **Commit a checkpoint** | Opens a transaction, writes 3 payload rows and a matching progress record inside it, commits, then closes the connection, releases its native handle, opens a fresh one and reads | Rows and progress committed **together** and read back exactly after a verified reopen |
| **Roll back a checkpoint** | The same, ending in an explicit `ROLLBACK` | **No part** of the checkpoint committed, and the previously committed checkpoint is intact byte for byte |
| **Fail a statement inside a transaction** | Stages rows, then issues a statement that violates `value TEXT NOT NULL` | Reported as a **statement** failure, never as a commit failure; no commit was attempted; the last committed checkpoint is preserved |
| **Lose the acknowledgement after commit** | Issues a **real** commit, then discards the answer unread | Classified **committed** — from the reopened store alone. A lost acknowledgement is not a lost commit |
| **Lose the acknowledgement before commit** | Stages rows, issues **no** commit, discards the transaction | Classified **not committed**, previous checkpoint intact |
| **Prepare an interrupted checkpoint** | Stages rows and **leaves the transaction open** | The panel shows the open transaction and refuses every other action |
| **Inspect stored checkpoint** | Reads and classifies whatever is stored | Read-only. It never writes, repairs or replays |
| **Delete the synthetic checkpoint data** | Asks for confirmation naming the synthetic database and the 4 checkpoint keys, then removes only those | The restart fixtures and their run record are untouched |

The two "lose the acknowledgement" actions are a **diagnostic simulation**. The transaction
underneath is the real engine doing real work; what is injected is the app never hearing the
answer. A fault injected after a successful commit is **not** a naturally occurring native
commit failure, and nothing here should be reported as one.

### How a result is classified

Every verdict comes from **reading a freshly reopened store**, never from what the commit call
returned. A rejected or discarded commit result is **never** proof of rollback. "Freshly
reopened" means the connection was closed, its native handle released and a new connection
opened, each step confirmed. If any step fails, the result names it and gives **no verdict**:
a read through a connection that may never have closed is not evidence.

| Observation | Verdict |
| --- | --- |
| The progress record names this attempt and every row matches its regenerated value | **Committed** |
| No checkpoint for this attempt, and either the previous progress record is **unchanged** with every row matching, or — if there was none — the progress record and every payload row read successfully as absent | **Not committed** |
| Partial, mismatched, malformed, unreadable or incomplete evidence — including payload rows with no progress record, and any failed read | **Unresolved** |

### When a transaction's outcome is unknown

The panel shows one of two banners while the store owns a transaction:

- **"A transaction is open and uncommitted"** — the engine acknowledged it (a prepared
  interruption). Roll it back or abandon it.
- **"A transaction's outcome is unknown"** — something failed or answered unreadably: the
  start, a rollback, the connection close or the native handle release. Whether a transaction
  is still open at the engine cannot be said, so the store keeps refusing every other action.
  **Roll back** or **Abandon** remain available. Abandon completes only when the connection is
  closed **and** its native handle released; pressing it again resumes at the step that
  failed. If neither completes, force-quit and relaunch the app (disposable test installation
  only), then press **Inspect stored checkpoint** first.

**Unresolved is a real outcome, not a test failure.** It is exactly the state a migration must
be able to handle, and the panel never promotes it to either of the others. Nothing is
replayed in response: deciding what to do about an unresolved checkpoint is the migration's
job. The approved migration design — implemented only as a dormant executor that no build
invokes — decides it from durable state and
treats a mismatch a running process detects as a fault (Stage M3b0 §5.1, I-11 and I-13).

### The interruption rehearsal — DISPOSABLE TEST INSTALLATION ONLY

> **Do not perform this on a data-bearing iPhone.** Use a disposable test installation or a
> simulator. The steps below force-quit an application mid-transaction; nothing in them
> touches application data, but a force-quit is still a deliberate interruption. It has been
> run once, on a disposable simulator (2026-10-15), and **never on a physical device**.
> **Do not uninstall, reset or re-sign the app you train with.**

This section is the procedure, not a report; results are recorded in
`docs/MOBILE_APP_MIGRATION.md` Stage M3b0 §7.

| # | Step | What to record |
| --- | --- | --- |
| 1 | Press **Commit a checkpoint** | The verdict, and the attempt id in the detail lines. This is the checkpoint that must survive |
| 2 | Press **Prepare an interrupted checkpoint** | **Write down both ids the panel shows**: the *prepared* attempt (which must NOT appear afterwards) and the *previous committed* attempt (which must still be there) |
| 3 | Confirm every other action is refused | The panel shows the open transaction and disables the exercises |
| 4 | **Force-quit** the app — swipe it away from the app switcher | — |
| 5 | Relaunch, open the panel, press **Inspect stored checkpoint** and **nothing else first** | The attempt id reported. It must be the *previous committed* one from step 2, and the record must be internally consistent |
| 6 | Repeat 2–5 in **Airplane Mode** | Whether anything differs offline. It should not: this is entirely local |

**Step 5's "nothing else first" is the whole point.** Any other action writes, and writing
before looking destroys the evidence. This is also why the panel runs nothing on open.

**On a simulator**, step 4 is a process stop instead of an app-switcher swipe: the 2026-10-15
run used Xcode's **Stop**, then **Run**. Step 5's inspection must report the checkpoint as
written by an *earlier* session; if it says this session, the process did not restart and
nothing was rehearsed.

**What this rehearsal cannot do.** The app is not killed automatically, and it must not be:
backgrounding is **not** process death, a web-view reload is **not** process death, and an
ordinary close/reopen is **not** a crash. Only the manual force-quit supplies the
interruption, which is why the attempt ids are carried on paper rather than in a marker — a
setup record written to the database could itself be mistaken for a committed checkpoint.

### What these actions can never establish

- **Nothing about power loss.** An acknowledged commit is not proof that bytes reached stable
  storage. Establishing that needs a device that actually loses power.
- **Nothing about a naturally occurring commit failure.** Every failure here is either a
  deliberate constraint violation or an injected lost acknowledgement.
- **Nothing about backup and restore**, no capacity limit, and **nothing about Android**.
- **Nothing about migration readiness.** A dormant runner with source/target enumeration
  and activation-record handling exists in M3b4b, but **no application path invokes it**.
  This tooling does not run a migration, publish activation or establish transfer/restore readiness.

## Identity configuration and remaining decisions

`capacitor.config.ts` uses **`me.evolane.curling` / Evolane Curling**, matching both
native target configurations. Name, identifier, Apple team and primary English language
are confirmed; this does not close the remaining callback, distribution-acceptance or
data-preservation parts of **P4**. `local.dev.curlingperformance` / Curling Performance
(Dev) identify the earlier installed source and historical diagnostic evidence, not the
current build target. No provider redirect, URL scheme or Associated Domain is added.

**The API origin is no longer among them.** It is confirmed as
`https://curling.evolane.me` and is configured through
`NEXT_PUBLIC_NATIVE_API_ORIGIN` (ADR-0047). Confirming it settles the API
destination only — the bundle identifier has its own confirmed decision, while the
callback domain and distribution acceptance remain separate.

`Info.plist` keeps the existing `NSBluetoothAlwaysUsageDescription` for Brower capture,
and declares **no** `UIBackgroundModes`. Background measurement remains **P3**; this
identity change adds no permission or capability.

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
