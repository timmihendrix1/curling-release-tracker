# Brower — Native iOS BLE Transport Feasibility

**Status:** Bounded engineering prototype. **Source, tests and native scaffold are
complete, and the prototype has now been signed, installed and run on a physical iPhone
(2026-09-28): it connected to a real Brower TCi Timer, discovered both documented
services, and received real Athlete Data notifications. The probe still decodes nothing —
reading the documented Split 1 field of those packets **offline, from the archived
exports** reproduced three operator-reported display values under truncation to
hundredths.** Real timing-gate behaviour, lifecycle races
while a subscription is active, 20-split exhaustion, automatic New and **all** Android
behaviour remain unverified. The prototype is not part of the Curling Performance Platform
application and creates no sporting data.

**Last Updated:** 2026-09-28

The 2026-09-28 iPhone evidence is archived at
[`docs/hardware/brower/observations/2026-09-28-ios-manual/`](hardware/brower/observations/2026-09-28-ios-manual/README.md).
How the **application itself** would reach a phone — which this prototype deliberately
does not answer — is designed in
[`docs/MOBILE_APP_MIGRATION.md`](MOBILE_APP_MIGRATION.md).

---

# Purpose

`docs/BROWER_INTEGRATION_STATUS.md` records what the desktop Web Bluetooth diagnostic
established against the physical TCi Timer on 2026-09-25: Gate A (connection and reads)
and Gate B (real Athlete Data notifications) are demonstrated, Gate C is **partial**, and
Gate D is **not started**.

This document covers one question that sits beside those gates rather than inside them:

> Can a **native iOS** application reach the same timer, over the same documented
> services, and observe the same raw bytes?

That question matters because the product's eventual capture surface is a phone on the
ice, not a laptop in Brave. Web Bluetooth does not exist in iOS Safari, so the desktop
transport cannot simply be carried over. The answer had to come from a real iPhone, and
this prototype existed to make that test possible.

**It now has.** On 2026-09-28 the prototype ran on a physical iPhone and answered that
question **yes, for iOS**: the same timer, over the same documented services, delivering
the same 20-byte packets, with the documented Split 1 field reproducing three operator-
reported display values under truncation to hundredths. **It answers nothing about
Android**, where no project exists and nothing has been compiled or run.

**What this prototype is not.** It is not a migration of the application, not a
`TimingProvider`, not a decoder, and not evidence for any acceptance gate. Passing its
own transport checks would demonstrate a **transport**, nothing more. In particular it
**does not promote Gate C or Gate D**, which remain exactly as
`docs/BROWER_INTEGRATION_STATUS.md` describes them.

---

# Observed repository constraints

These were audited in the working tree before any code was written. Each one is a reason
the prototype is a **separate project** rather than a native wrapper around the existing
application.

**These constraints are still accurate, and they are now addressed rather than merely
recorded.** Each "Consequence" below states why the *prototype* sidestepped a problem;
[`docs/MOBILE_APP_MIGRATION.md`](MOBILE_APP_MIGRATION.md) is where the *application's*
answer to each one is designed — the API origin and trust boundary, native OAuth callback
handling, and the separate mobile storage container. Nothing in that design is implemented
yet, and none of it changes this prototype.

## The application cannot be statically exported

`src/app/api/` contains six dynamic server routes — five Team operations
(`/api/team/invitations`, `/api/team/invitations/[id]/revise`,
`/api/team/invitations/[id]/resend`, `/api/team/admin-requests`,
`/api/team/members/remove`) and the restricted Exercise asset route
(`/api/exercises/restricted-diagrams/[assetId]`). Next.js static export
(`output: "export"`) supports neither dynamic route handlers nor the server-side
rendering these depend on. Enabling it would break Team functionality outright.

**Consequence:** static export was not enabled, and `next.config.ts` is unchanged.

## Authorized requests are confined to the application's own origin

`src/lib/supabase/authorizedFetch.ts` builds every authorized request against
`window.location.origin` and proves, before the access token is read, that the result is
same-origin, carries no query or fragment, and is **exactly** the path the hard-coded
route table produced. The required prefix differs by request kind: Team operations are
confined to `/api/team/`, and restricted Exercise diagrams to
`/api/exercises/restricted-diagrams/`. It is the only module permitted to read the
provider access token (ADR-0025 Decision 20).

A native shell loads its web content from a local app scheme, not from the application's
deployed origin. Any future native migration therefore has to answer "what origin do
authorized API requests target, and how is that origin proven?" as a **deliberate
design decision** — for both prefixes, and not by relaxing these checks.

**Consequence:** no `server.url` is configured in `capacitor.config.ts`. Pointing the
native shell at the deployed application would have produced a working-looking demo that
silently changed the security model.

## Authentication return handling is origin-bound

`isValidRedirectTarget` in `src/lib/supabase/supabaseAuthService.ts` refuses any OAuth
redirect target that is not on the application's own origin, carries a fragment, or
already carries the SDK's flow selector. `supabaseCallbackCapture.ts` then captures the
callback from the URL of **one document load**, cleans that URL, and hands out a
single-use claim.

A native app has no such URL: a provider return arrives as a deep link or through an
in-app browser session. Reconciling that with this capture model is real design work.

**Consequence:** the prototype has **no authentication at all**. It is a separate
developer instrument, not a route around the identity gate.

## Local sporting data is browser-origin storage

Profile-scoped local persistence (ADR-0026) lives in `localStorage` under the mounted
`Profile.id`. A native WebView has its own storage container and does not share Safari's.

**Consequence:** nothing in the prototype reads or writes application storage, and a
future migration must not assume a user's existing local data is present after
installing a native build.

---

# Why the prototype is independent

| Concern | Decision |
| --- | --- |
| Build tooling | Its own Vite + TypeScript project under `tools/brower-ios-probe/`, with its own `package.json` and `package-lock.json`. The root `package.json` and `package-lock.json` are unchanged. |
| Framework | Plain TypeScript and direct DOM. A single-screen instrument does not justify a second application framework alongside React/Next. |
| Protocol constants | Six UUIDs are **duplicated** in `src/probe/browerProtocol.ts` rather than imported from `src/lib/brower/protocol.ts`. Importing the application module would pull a Next-bound source tree into a throwaway experiment. The cost is stated in that file: those six values must be re-checked against `docs/BROWER_INTEGRATION_STATUS.md` if it changes. |
| Desktop diagnostic | Untouched. `src/lib/brower/` and `src/components/BrowerBleDiagnosticScreen.tsx` are byte-identical to before this work. |
| Root tooling | Three narrow, path-specific exclusions (below). No existing application code or test is excluded. |

## Changes made outside `tools/brower-ios-probe/`

Each names **one directory**, never `tools/**`:

- `tsconfig.json` — `exclude` adds `tools/brower-ios-probe`. The root `include` is
  `**/*.ts`, which would otherwise compile the prototype under the application's
  compiler options.
- `vitest.config.ts` — `exclude` adds `tools/brower-ios-probe/**`. The existing
  `node_modules/**` pattern is anchored at the repository root, so without this the root
  test run collected `.spec.js` files shipped **inside the prototype's dependencies**.
  (Verified: it did.)
- `eslint.config.mjs` — `globalIgnores` adds `tools/brower-ios-probe/**`. The prototype
  has its own ESLint configuration and its own TypeScript program; the root run was
  otherwise linting its Vite build output copied into the native app bundle (256
  warnings).

No `.gitignore` change was needed at the repository root: the prototype's own
`.gitignore` covers its `node_modules/`, `dist/`, the web assets Capacitor copies into
`ios/App/App/public/`, and Xcode/SPM per-machine state. This was verified with
`git status --untracked-files=all`.

---

# Toolchain and dependency versions

Resolved and pinned exactly; the full graph is locked in
`tools/brower-ios-probe/package-lock.json`.

| Component | Version |
| --- | --- |
| Node | 24.16.0 |
| npm | 11.13.0 |
| `@capacitor/core`, `@capacitor/cli`, `@capacitor/ios` | 8.5.2 |
| `@capacitor-community/bluetooth-le` | 8.3.0 |
| `@capacitor/app` | 8.1.1 |
| `@capacitor/filesystem` | 8.1.3 |
| `@capacitor/share` | 8.0.2 |
| Vite | 8.3.1 |
| Vitest | 5.0.2 |
| TypeScript | 5.9.3 |
| ESLint / typescript-eslint | 10.11.0 / 8.70.1 |
| jsdom | 30.1.1 |

**Compatibility, verified from primary sources:**

- The plugin's own compatibility table states BLE plugin **8.x ↔ Capacitor 8.x**.
  Its published `peerDependencies` require `@capacitor/core >= 8.0.0`.
- Capacitor 8's environment-setup documentation requires **Xcode 26.0 or later** and
  **Node 22 or later**, and makes **Swift Package Manager the default**, with CocoaPods
  optional. The scaffold below took the SPM path; **CocoaPods is not installed on this
  machine and was not needed**.
- TypeScript was pinned to **5.9.3**, not the current 7.0.2: `typescript-eslint@8.70.1`
  declares `typescript >=4.8.4 <6.1.0`, so TypeScript 7 would have left the prototype
  without working lint rules.

---

# The prototype

Location: `tools/brower-ios-probe/`.

## What it does

- Explicit **Initialise Bluetooth** action, which is what triggers the iOS permission
  prompt. Nothing happens before a human presses it.
- **User-triggered device selection**, either filtered on the documented timing service
  or through an explicit **all nearby devices** fallback.
- **One connection at a time.** A second attempt while the picker is open, or while a
  device is connected, is refused with a reason.
- **Actual discovered services and characteristics**, with the read / write /
  writeWithoutResponse / notify / indicate properties the device really advertised.
  Services the probe did not expect are shown too.
- **Explicit reads** of Time Base, Power On Counter and — where present — Serial Number,
  offered only where the discovered properties permit a read.
- **Start Listening / Stop Listening** for Athlete Data notifications.
- **Raw evidence**: notification count, receipt timestamps, byte lengths and selectable
  uppercase hex.
- **Disconnect**, and a fresh **user-triggered** reconnect. Never automatic.
- **Clear Log** (with a warning) and **Export Log**.

## What it deliberately does not do

- **It cannot write to the timer.** The native transport interface
  (`src/probe/transport.ts`) declares **no write operation at all** — not a write that is
  never called, but no method. A memory request, New Athlete, clear, channel or test
  command has no code path to travel down. A future change that wanted one would have to
  widen that interface in an unmissable diff.
- **It decodes nothing.** No field is parsed, no value is labelled as a time, no
  zero-split packet is called a start, and no non-zero-split packet is called final.
  Gate C is partial; a decoder written now would put a guess on screen as a measurement.
- **It has no account, Profile, cloud connection or sporting record**, and no
  `TimingProvider`/`TimingResult` integration.
- **It never falls back.** Off native iOS there is no transport object at all
  (`src/main.ts` constructs the Capacitor implementations only behind the platform
  check), so there is nothing that could quietly become `navigator.bluetooth` or sample
  data.
- **It is foreground-only.** No iOS background Bluetooth mode is declared. This was
  verified against the generated `Info.plist`: it contains
  `NSBluetoothAlwaysUsageDescription` and **no `UIBackgroundModes` key**.

## How the failure states are kept apart

`src/probe/errors.ts` classifies into fixed categories — unsupported platform, Bluetooth
unavailable, permission denied, user cancellation, device not found, not connected,
unexpected disconnect, operation failed, timeout, and **unknown**. The exported log
carries one of those literals, never text read off a thrown value.

The distinction that matters most for evidence: a **failed** service enumeration is never
reported as a service being **absent**. An instrument that conflated them would let an
operator report "this unit has no Serial Number service" when in fact the query errored.
An absent *optional* service is a plain observation and does not invalidate a working
timing connection.

## Lifecycle protections

These describe what the implementation does and what the tests below exercise. They are
not a claim that every possible ordering of native callbacks has been enumerated.

- **An attempt owns a generation from its first step.** The generation is claimed
  *before* the device picker opens — not after the native connect resolves — so
  backgrounding or releasing during selection, during the connect call, or during
  discovery invalidates the whole attempt. Ownership is re-checked after every await,
  on rejection paths as well as success paths.
- **An invalidated attempt cannot change current state.** A picker result arriving after
  invalidation starts no connection. A native connection completing after invalidation
  is disconnected so it does not stay open — unless a later attempt is using that same
  peripheral, in which case it is left untouched rather than tearing down the connection
  the operator now has.

- **Teardown owns the peripheral until its disconnect has actually been issued, and a
  new attempt is refused until then.** Teardown cannot finish synchronously: releasing
  the notification listeners may wait on a native call that is still outstanding, and
  only afterwards is the peripheral disconnect sent. That leaves a window in which the
  attempt is already retired but its disconnect has not gone out yet. A replacement
  connection established inside that window — most easily to the *same* timer, which is
  the ordinary case — would then be torn down by the retired attempt's disconnect,
  leaving the probe reporting a connection the bridge no longer has.

  Selection is therefore refused for the length of that window, with a reason naming
  the peripheral still being released, and the operator retries explicitly once it
  clears. The refusal comes from the controller and the UI renders that same reason, so
  the two cannot disagree. As a second line of defence the final disconnect re-checks
  ownership before it is issued: a disconnect is destructive and irreversible, so it
  does not rely on the refusal having held. Skipping it in that case is not abandoning
  a connection — the peripheral is in use by the current attempt.

  The cost is honest and small: after backgrounding or a disconnect, reselecting can
  briefly report that the previous connection is still being released. The alternative
  designs either queue the selection behind an invisible wait or leave a live
  connection abandoned.

- **Cleanup failure hands control back.** A failed notification stop or a failed
  disconnect still ends the cleanup window and re-enables selection, and an unresolved
  notification cleanup stays visible rather than being silently dropped.

- **Release is terminal.** After it, no operation is accepted and no subscriber is
  notified.
- **A subscription owns its own token**, separately from the connection. Stop-then-Start
  on one connection produces different tokens, so a callback from the stopped
  subscription cannot be counted as an observation of the running one. Late callbacks
  are retained as explicitly stale evidence, never as current observations.
- **Notification registrations are owned from the moment they are requested, and are
  identified individually.** The Capacitor BLE client registers its JS listener
  *before* awaiting the native `startNotifications`, so a failed start still leaves one
  behind; and losing the GATT connection does not remove it. The probe therefore
  records ownership before the await and releases it with an actual
  `stopNotifications` call — after a failed start, after an unexpected disconnect, on
  backgrounding, and on release.

  The plugin's notification API is **key-based**: a second `startNotifications` for the
  same peripheral/service/characteristic replaces the first registration, and
  `stopNotifications` stops whatever currently occupies that key. An obsolete cleanup
  and a replacement registration therefore share a key and cannot be told apart by key
  alone. Two mechanisms handle this. Each registration carries its own identity, so a
  completing cleanup retires exactly the registrations it was issued for and never a
  replacement. And every start and stop for one key runs on a per-key chain in issue
  order, so a replacement registration cannot be created while an obsolete stop for
  that key is still in flight — and so cannot be stopped by it. One consequence worth
  stating: cleanup for a key waits behind a pending start on the same key, which is
  also how the plugin's own queue behaves.

- **A failed release is recorded as unconfirmed, not as a known leak.**
  `BleClient.stopNotifications` removes its JS listener and deletes its map entry
  **before** awaiting the native stop. A rejection therefore does **not** establish
  that the listener survived — by then it has usually already been removed, and only
  the peripheral-side stop failed. The probe records that cleanup could not be
  confirmed, keeps the registration so it does not claim a release it did not achieve,
  and asserts nothing about which half failed. Observation stays inactive either way: a
  cleanup error never reinstates an active subscription.
- **Bytes are copied at receipt**, before any staleness check, because the bridge may
  reuse its buffer the moment the callback returns.
- **Disconnect works while a read, discovery or subscription is in flight**, and the UI
  keeps the control enabled there. The in-flight operation is **not cancelled** — the
  native bridge offers no cancellation — it is invalidated, so its late result is
  recorded as stale rather than attributed to a connection that no longer exists.
- **Teardown is idempotent** and safe when user disconnect, backgrounding and release
  overlap; each releases only the resources it owns.
- **Backgrounding ends active observation**: it is logged, the session stops being
  treated as observed, teardown runs, and a **fresh explicit device selection** is
  required afterwards. Returning to the foreground reconnects nothing by itself. No
  background reliability is claimed.

## Evidence export

The log is bounded in memory: **500 entries** and **64 payload bytes**, with explicit
counters for dropped entries and truncated payloads. The real wire length is always
recorded even when the retained bytes were truncated.

Export writes a JSON file into the app's own cache subdirectory and hands it to the iOS
share sheet as a **file**. Nothing is uploaded anywhere.

- The temporary file is deleted **only after `share()` has settled**, whichever way it
  settled — deleting first would produce a share sheet that appears to work and delivers
  nothing. Older files the probe itself wrote are swept as a backstop; a cleanup failure
  never turns a successful export into a failed one.
- **Cancellation is cancellation.** A dismissed share sheet is not recorded as a saved
  file, and the observations stay marked unexported.
- Clearing warns when observations exist that no completed export has carried off the
  device, and the UI states that closing the app loses the in-memory log.

**The export format is its own schema.** `kind` is
`brower-tci-ios-native-ble-probe-log`, **not** the desktop diagnostic's
`brower-tci-ble-diagnostic-log`. It identifies the probe and its transport
(`capacitor-community/bluetooth-le over iOS CoreBluetooth`), declares `foregroundOnly`,
and carries export time, retention metadata, per-connection epochs (with how each ended)
and the raw entries. It carries no account or credential — the probe has none. It **does**
carry the iOS-assigned peripheral identifier and whatever raw bytes the timer sent, and
the file says so in its own notes.

---

# What could be reused in a future production migration

Stated as *candidates*, not as a plan. No product decision has been made about a native
application.

- **The transport shape.** `NativeBleTransport` maps cleanly onto the operations a real
  adapter needs, and the epoch/staleness discipline around it is transport-independent.
- **The failure taxonomy.** The unsupported / unavailable / denied / cancelled /
  absent-vs-failed distinctions are product-relevant, not prototype-specific.
- **The "copy bytes at receipt" rule**, already the rule in the desktop diagnostic.
- **The evidence-versus-interpretation discipline**, which is the reason both instruments
  are trustworthy.

What is **not** reusable: the UI, the standalone build, the log schema (a production
provider produces `TimingResult`s, not a diagnostic log), and the absence of identity.

---

# Separate future work

Each of these is unresolved and none is settled by this prototype.

1. **API origin.** What origin does a native build target for `/api/team/*`, and how is
   the same-origin confinement in `authorizedFetch.ts` preserved rather than relaxed?
2. **Authentication callbacks.** How does a provider return reach a native app, and how
   does it correlate with the page-scoped single-use capture model in
   `supabaseCallbackCapture.ts`?
3. **Local data.** A native WebView starts with empty storage. What happens to a user who
   has Profile-scoped local data in their browser?
4. **Offline operation.** The application runs fully offline after authenticated
   onboarding on a device. What does "that device" mean once there are two shells?
5. **Lifecycle.** Capture on the ice implies the screen may lock or the app may be
   backgrounded mid-session. Background BLE has real Apple review and battery
   consequences and needs a product decision before it is designed.
6. **Distribution.** No app-store path, no provisioning strategy, no signing identity is
   proposed here.

---

# Build, run and export

All commands run from `tools/brower-ios-probe/`.

```bash
npm install          # project-local; does not touch the root node_modules
npm run typecheck
npm run lint
npm test
npm run build        # Vite build into dist/
npx cap sync ios     # copies dist/ into the native project, updates Package.swift
npx cap open ios     # opens the generated project in Xcode
```

To compile the native project without any signing identity — the check this repository
actually performs — run from the repository root:

```bash
xcodebuild -project tools/brower-ios-probe/ios/App/App.xcodeproj \
  -scheme App -destination 'generic/platform=iOS' -configuration Debug \
  -derivedDataPath /private/tmp/brower-ios-build CODE_SIGNING_ALLOWED=NO build
```

This proves the project compiles. It does not sign, install or run anything.

`ios/App/App.xcodeproj/project.xcworkspace/xcshareddata/swiftpm/Package.resolved` is the
resolved Swift Package Manager dependency lock produced by that build. It pins the two
remote packages (`capacitor-swift-pm` and `ion-ios-filesystem`); the four Capacitor
plugins are local path dependencies and so carry no pin.

The iOS project is at `tools/brower-ios-probe/ios/App`. It uses **Swift Package
Manager** (`ios/App/CapApp-SPM/Package.swift`), which is the Capacitor 8 default; there
is no Podfile and CocoaPods is not required.

## Development identifiers

`appId` is `local.dev.browerbleprobe` and `appName` is `Brower BLE Probe (Dev)`.

**These are development identifiers for a local engineering instrument. They are not a
product decision.** No app is registered under them, no `DEVELOPMENT_TEAM` is set in the
generated Xcode project, and no signing identity is configured in this repository.
Signing is chosen by a person in Xcode, on the machine that installs the build.

---

# Verified machine state, and what is still outstanding

The four things below are deliberately separate. Each is evidence for itself and for
nothing further along the chain.

## 1. Toolchain — verified

Xcode **27.0 (build 27A266a)** is installed at `/Applications/Xcode.app` and is the
selected developer directory. `xcodebuild -checkFirstLaunchStatus` exits 0, and
`xcrun xctrace list devices` lists devices without a licence complaint. That satisfies
Capacitor 8's Xcode 26.0 minimum.

*(Earlier revisions of this document recorded an unaccepted Xcode licence and missing
first-launch components as blockers. Both were resolved on this machine before this
revision and are no longer blockers; the checks above were re-run to confirm it.)*

## 2. Unsigned compilation — verified

The native project compiles for a device target with signing disabled:

```bash
xcodebuild -project tools/brower-ios-probe/ios/App/App.xcodeproj \
  -scheme App -destination 'generic/platform=iOS' -configuration Debug \
  -derivedDataPath /private/tmp/brower-ios-build CODE_SIGNING_ALLOWED=NO build
```

`** BUILD SUCCEEDED **`, exit code 0. Alongside the build, the following were checked on
the produced `App.app`:

- The bundled web assets are byte-identical to `tools/brower-ios-probe/dist/`, apart
  from the `cordova.js` and `cordova_plugins.js` shims Capacitor injects.
- All four plugins are compiled and linked in, and `capacitor.config.json`'s
  `packageClassList` registers `BluetoothLe`, `AppPlugin`, `FilesystemPlugin` and
  `SharePlugin`.
- `Info.plist` carries `NSBluetoothAlwaysUsageDescription` and **no `UIBackgroundModes`
  key** — foreground-only, confirmed on the built artefact rather than only in source.

**What this does not show.** Compiling is not signing, installing or running. It is
evidence that the project builds; it says nothing about Bluetooth.

## 3. Signing and installation — performed locally on 2026-09-28; still not configured here

The probe **was** signed, installed and run on a physical iPhone on 2026-09-28. That was
done on the operator's own machine, with a locally chosen team.

**This repository still configures no `DEVELOPMENT_TEAM`, no signing identity and no
provisioning profile, and nothing here will configure one.** "It ran on a device" and
"signing is configured in this repository" are separate statements; only the first is
true. Anyone else, on any other machine, still has to do all of the following:

1. Open the project: `cd tools/brower-ios-probe && npm run cap:open`.
2. Select the `App` target → Signing & Capabilities, and choose a team. A free personal
   Apple ID is enough for a development install.
3. Connect the iPhone by cable and trust the computer.
4. Enable **Developer Mode** on the iPhone (Settings → Privacy & Security → Developer
   Mode) and let it restart. iOS 16 and later refuse to run a development build
   without it.
5. Run from Xcode onto the device, and approve the developer certificate on the phone
   if iOS asks.

## 4. Physical BLE — performed on 2026-09-28, on a physical iPhone

**Bluetooth is not available in the iOS Simulator.** The plugin's documentation states
this outright. No simulator run, no automated test in this repository, and no
successful compilation is evidence that the probe reaches a Brower TCi Timer — which is
why the session below was required, and why its results are the only thing in this
document that speaks about radios.

The session produced two exported logs, archived byte for byte with their hashes at
[`docs/hardware/brower/observations/2026-09-28-ios-manual/`](hardware/brower/observations/2026-09-28-ios-manual/README.md).
That README is the authority on what those bytes show and, just as importantly, on the
tests the session did **not** perform.

# Acceptance

## Native transport acceptance checks

Each is a **separate** check. Passing an earlier one never implies a later one, and none
of them is an acceptance gate from `docs/BROWER_INTEGRATION_STATUS.md`.

| # | Check | State |
| --- | --- | --- |
| T1 | Prototype typecheck, lint, tests and web build pass | **Passed** on this machine — 142 tests across 10 files |
| T2 | Capacitor generates the native iOS project and syncs the built assets | **Passed** — SPM path, four plugins detected |
| T3 | `Info.plist` declares `NSBluetoothAlwaysUsageDescription` and **no** `UIBackgroundModes` | **Passed** — checked in source and on the built `App.app` |
| T4 | The native project compiles unsigned for a device target | **Passed** — `BUILD SUCCEEDED`, exit 0; assets, plugin registration and Info.plist checked on the built app |
| T4b | The app is signed with a real team | **Passed** (2026-09-28) — implied by installation on a device; this repository still configures no team |
| T5 | The app installs and launches on a physical iPhone | **Passed** (2026-09-28) |
| T6 | iOS prompts for Bluetooth permission on the explicit initialise action | **Not evidenced.** The probe logged `bluetooth_ready` ("Bluetooth initialised and reported as enabled"); it records no prompt, and the operator did not record one. Initialisation succeeding is not proof a prompt appeared |
| T7 | The timing-service-filtered picker finds the timer, and the all-nearby fallback also does | **Partial.** The **timing-service filter** found the timer on both connections (`selectionMode: "timing-service-filter"`). The **all-nearby fallback was not exercised** |
| T8 | Both documented services and their characteristics are discovered, with real properties | **Passed** (2026-09-28) — 4 services, 2 documented and 2 not, with the properties the device actually reported. See the archive README |
| T9 | A characteristic read returns raw bytes | **Not performed.** Time Base, Power On Counter and Serial Number were all discovered as readable; none was read. The 2026-09-25 Time Base discrepancy is untouched |
| T10 | Real Athlete Data notifications arrive during a controlled measurement | **Passed** (2026-09-28) — 15 notifications across two connections, every one 20 bytes. **The TCi was tested alone, without timing gates** |
| T11 | Stop, start, disconnect and explicit reconnect all behave as the UI states | **Partial.** An explicit `notifications_stopped` was recorded, and a second connection epoch exists after the first ended `backgrounded`. A deliberate Disconnect-then-reconnect test, and backgrounding **while a subscription is active**, were not run |
| T12 | The log exports to a real file through the share sheet | **Passed** (2026-09-28) — both an `export_cancelled` and an `export_shared` outcome were exercised, and the shared files arrived |

**T4 is a compilation result and nothing more.** The checks now marked passed were passed
on **one session, on one iPhone, against one timer, in the operator's reported Chron
mode, without timing gates.** They must not be marked passed on the strength of a
successful build, the simulator, the automated tests, or this document — and **none of
them is evidence about Android**, where no project exists.

**A passing transport check is still not an acceptance gate.** Gates A–D in
`docs/BROWER_INTEGRATION_STATUS.md` are unchanged in kind by this session; what the
session *did* move within Gate C is recorded there, not here.

## What the automated tests do and do not prove

142 tests across 10 files run against an **injected** transport, export target and
lifecycle source. Every byte in them is synthetic. The transport double reproduces the real Capacitor
BLE client's ordering on purpose: it registers its JS notification listener *before*
awaiting the native start, and on stop it removes the listener and deletes its map
entry *before* awaiting the native stop. It tracks the JS listener and the
peripheral-side subscription separately, so a test can fail either half independently
and the cleanup tests check actual calls and resource state rather than an internal
flag. Several cases also run the transport through the plugin's own
`getQueue(true)`, so the bookkeeping is exercised against real serialization.

They exercise the interruption points the implementation is built around: backgrounding
and release during selection, during the native connect and during discovery; late
successes and late failures from each; stale reads and stale notifications; old
subscription callbacks after Stop and after Stop/Start on one connection; failed and
late subscription starts; a pending Stop followed immediately by a Start on the same
key, with and without the plugin's queue; a reselection attempted while a retired
attempt's cleanup is still outstanding, checked against the native call order rather
than only against snapshot flags; Stop targeting the active subscription
rather than an older unresolved record for a different peripheral; a native stop that
rejects after the listener was already removed, and a listener removal that fails
outright; unexpected disconnect; overlapping teardown; and the export and UI
decisions.

**They prove nothing whatsoever about Brower firmware, about iOS CoreBluetooth, or about
whether a native build connects to anything** — and they are a set of specific
interleavings, not a proof that every possible ordering of native callbacks behaves
correctly.

---

# Physical-device procedure

**This procedure was followed on 2026-09-28**, and its results are archived at
[`docs/hardware/brower/observations/2026-09-28-ios-manual/`](hardware/brower/observations/2026-09-28-ios-manual/README.md).
It is kept here because steps 4, 6, 7 and 8 were **not** fully carried out that day —
no characteristic was read, no all-nearby selection was made, no gates were used, and the
app was never backgrounded while a subscription was active. Repeat it for the next
collection. Record everything in the log and in your own notes — the log cannot capture
what the operator did.

1. **Build the web assets and sync them into the native project:**
   `cd tools/brower-ios-probe && npm run build && npm run cap:sync`, then
   `npm run cap:open` to open it in Xcode.
2. **Set a signing team.** Select the `App` target → Signing & Capabilities → Team. A
   free personal Apple ID is sufficient for a development install. This repository
   configures no team and no identity, and will not do so for you.
3. **Prepare the iPhone and install.** Connect it by cable and trust the computer.
   Enable **Developer Mode** (Settings → Privacy & Security → Developer Mode) and let
   the phone restart — iOS 16 and later refuse to launch a development build without
   it. Then Run from Xcode onto the device, approving the developer certificate on the
   phone if iOS asks.
4. **Release competing connections to the timer.** Close Brower Test Center, close the
   desktop diagnostic in Brave, and disconnect any other central. Whether the timer
   accepts more than one concurrent central is **unknown** — see
   `docs/BROWER_INTEGRATION_STATUS.md`.
5. **Connect and inspect.** Press Initialise Bluetooth and approve the iOS prompt. Select
   the timer with the timing-service filter. Record which services and characteristics
   appeared and the properties shown. Then repeat once with the all-nearby fallback, so
   both chooser modes are exercised.
6. **Read a characteristic.** Read Time Base and Power On Counter. If the Serial Number
   service is present, read it too; if it is absent, record that — it does not invalidate
   the connection.
7. **Listen during a controlled Chron measurement.** Press Start Listening, run a
   measurement, and **write down what the timer's own display showed**, separately, by
   hand. The probe cannot see the display, and a reported display value is the only thing
   that makes a received packet interpretable later.
8. **Exercise the lifecycle.** Stop Listening, Start Listening again, Disconnect, then
   reconnect by selecting the device again. This is the controlled reconnect test the
   2026-09-25 desktop collection never performed. Then background the app while
   listening and bring it back: the probe should report that observation stopped and
   should require a fresh selection rather than resuming — which is behaviour only a
   real device can confirm.
9. **Export the log** through the share sheet and confirm the file actually arrived at its
   destination. Export **before** clearing anything and before closing the app.
10. **Record the context the packets cannot carry:** iPhone model and iOS version, timer
    firmware version if it can be read off the unit, the timer mode, the physical gate
    arrangement, and your exact button presses with rough timings.

Archive the exported file alongside the existing evidence, in its own dated directory
under `docs/hardware/brower/observations/`, with a README recording provenance and the
operator's reported context — the same discipline as
`docs/hardware/brower/observations/2026-09-25-chron/`.

**Do not promote Gate C or Gate D on the strength of a working transport.** A native app
receiving the same bytes the desktop already received is evidence about **transport**. The
encoding questions and the production capture integration are untouched by it.
