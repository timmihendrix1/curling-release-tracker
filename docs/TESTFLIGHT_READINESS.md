# TestFlight Readiness

**Purpose.** One place that states what stands between this repository and an iOS build
distributed through Apple, keeps **Apple's requirements**, **this project's own gates**,
**technical findings** and **proposals** apart, and gives an ordered runbook for the work
that remains.

**What this document is not.** It is not authorisation to upload a build, invite a tester,
deploy the Web application, purchase membership, register an App ID, create any Apple
record, or install anything over the owner's existing installation. It resolves no open
product decision and grants no exception to an existing gate. Every runbook step is marked
**UNEXECUTED** and none has been performed.

**It does not predict App Review outcomes.** Where a guideline applies, the guideline is
quoted or cited; whether a given build passes review is Apple's decision, not a fact this
document can establish.

**Audit date:** 2026-10-08. Apple sources verified the same day — see
[§7](#7-apple-sources-and-verification-date). Local-machine observations are individually
timestamped, because local signing state changes without notice.

**Repository state when this was written**

| | |
| --- | --- |
| Branch | `main` |
| HEAD / local `main` | `d801315c24017483d4a26de39a5465b66cd40558` ("Add manual speed training and mobile integration groundwork", 2026-10-08) |
| `origin/main` | `80fb19e6407561de70209789b16cab8a0ca94406` ("Add Brower diagnostics and native mobile API groundwork", 2026-09-29) — confirmed against the remote with `git ls-remote --heads origin` |
| Unpushed | Exactly one commit, `d801315`, 234 files. It introduces `src/lib/measurement/`, so **wire-version-2 capability exists in this checkout and not in `origin/main`** |

---

## A. Current verdict

Four different questions, four different answers. Collapsing them into one verdict is how
a gate gets skipped.

| Axis | Verdict |
| --- | --- |
| **Can a release artifact be produced and uploaded?** | **Blocked on unknowns, not on known failures.** The build compiles; the Apple-side state that would permit an upload is unverified, and the production application identity is an undecided placeholder |
| **Do Apple's tester rules permit distribution to these two people?** | **Internal testing needs no Beta App Review. External testing does.** Both still need everything in the axis above |
| **Is anyone authorised to install such a build over the owner's real data?** | **No. Blocked.** Data preservation across an installation transition is neither designed nor verified, and all existing local iPhone data must be preserved — a settled decision, not a preference |
| **Is the app ready for public App Store release?** | **No.** Several Apple requirements are unmet, and several of this project's own gates (M3, M4, P1, P3, P4, P5) are open |

**The honest one-line summary:** the artifact is nearly producible; the authorisation to put
it on a real device is not, and the second is the harder problem.

### Established, with evidence

| Claim | Evidence |
| --- | --- |
| The iOS project compiles in **Release** for a real device slice | `xcodebuild -project ios/App/App.xcodeproj -scheme App -configuration Release -destination 'generic/platform=iOS'`, code signing disabled, derived data outside the repository: **BUILD SUCCEEDED**. Apple's `builtin-validationUtility -validate-for-store` ran inside it without failing. Independently reproduced by Codex |
| The toolchain meets Apple's current upload minimum | Built `Info.plist`: `DTSDKName = iphoneos27.0`, `DTXcode = 2700`, `MinimumOSVersion = 15.0`. Apple requires Xcode 26 / iOS 26 SDK or later (28 Apr 2026) and a target of iOS 13 or later (9 Sep 2026) |
| The mobile surface is green | `npm run mobile:verify` — **9 test files / 143 tests passed**; `npm run mobile:lint` — no findings; `git diff --check` — clean. Independently reproduced by Codex |
| `cap sync ios` is repository-safe | After `npm run ios:sync`, `git status --porcelain` is empty |
| Release artifacts carry no developer surfaces | `mobile/vite.config.ts` pins `NODE_ENV=production` for **every** `vite build` under any `--mode`; the Timing Simulator and Brower BLE diagnostic screen are behind `IS_DEV` (`TrackerApp.tsx:305`, `:4901`, `:6058`, `:6671`). Storage diagnostics and the native-storage composition are two further, separate, off-by-default build flags |
| The Privacy Notice is live | `https://curling.evolane.me/legal/privacy/2026-08-28` renders `privacy-2026-08-28`, effective 28 Aug 2026 (fetched 2026-10-08) |

### Open items, classified

**Apple policy requirements that are unmet or unknown**

1. **Apple Developer Program membership state is UNKNOWN** — not established as absent.
   App Store Connect app management and TestFlight require it ([§1](#1-apple-account-and-distribution-prerequisites)).
2. **No App ID or App Store Connect app record is known to exist**, because Apple-side
   state was not inspected. The identifier they would use is an open decision.
3. **Export compliance is unresolved.** It does not block *uploading*; it blocks the
   uploaded build from being tested or distributed until answered ([§3](#3-release-build-readiness)).
4. **Guideline 5.1.1(v)** — no in-app account deletion, in an app that mandates account
   creation. Applies to App Store release.
5. **Guideline 4.8** — unresolved (open decision **P5**).
6. **Guideline 2.1** — "Continue with Google" cannot complete on iOS and is offered
   unconditionally.

**This project's own gates, all open**

7. **Data preservation across an installation transition** is undesigned and unverified.
   This blocks touching the owner's real installation at all ([§2](#2-application-identity-and-data-preservation)).
8. **Native storage migration/cutover** (Stage M3b4/M3b5) is incomplete. P6 settled that
   WebView `localStorage` is **not** retained as the native production store by accepting
   its eviction risk — so this is an unmet gate, **not** an accepted risk.
9. **Old-client compatibility** — the rollout policy is unresolved and the gate is live
   ([§5](#5-old-client-coordination)).
10. **Physical iOS/TCi acceptance** has never been recorded (`B-P0`).

**Technical findings that need a decision but are not themselves blockers**

11. Application identity and version/build numbering are undecided template values.
12. `SQLCipher.framework` ships in the default Release bundle although the default build
    composes no native storage.

---

## B. Prerequisite separation

Legend — **A** = Apple requirement; **P** = this project's gate.
Status — ✅ met · ❔ unknown (Apple-side state not inspected) · ⚠️ partial/unverified · ❌ not met.

### B.1 Technical prerequisites to produce and upload an artifact

| | Prerequisite | Status | Note |
| --- | --- | --- | --- |
| A | Apple Developer Program membership | ❔ | Required for App Store Connect app management and TestFlight. Not determinable from this machine — see [§1](#1-apple-account-and-distribution-prerequisites). **The Apple Developer Enterprise Program is not an alternative**: Apple states it is "only for the internal use and distribution of proprietary apps", requires 100+ employees, and excludes App Store and TestFlight distribution |
| A | A registered App ID and an App Store Connect app record | ❔ | Apple-side state not inspected. The identifier itself is open decision **P4** |
| A | A distribution signing certificate | ✅ *available by default* | **Not a blocker.** Apple's cloud-managed certificates are stored by Apple, and Xcode 13+ "will automatically cloud sign apps for distribution" when no local signing certificate is found. A local `Apple Distribution` identity is one option, not a requirement |
| A | Built with Xcode 26 / iOS 26 SDK or later | ✅ | Xcode 27.0, `DTSDKName = iphoneos27.0` |
| A | Deployment target iOS 13 or later | ✅ | 15.0 |
| A | A build number unique within the version | ✅ for a first upload | `MARKETING_VERSION 1.0` / `CURRENT_PROJECT_VERSION 1` is a **valid first upload**. For iOS, build numbers must be unique within a release train. **There is no version collision** — what is missing is a deliberate numbering *policy* for subsequent uploads |
| A | App icon in the asset catalog | ✅ | One 1024×1024 universal entry; the build emitted the derived icons |
| A | Privacy manifest for required-reason APIs | ⚠️ | `PrivacyInfo.xcprivacy` declares `C617.1` for file timestamps. `NSPrivacyCollectedDataTypes` is empty and needs a deliberate decision — see [§4.4](#44-privacy-disclosures-and-review-access) |
| P | Release build compiles | ✅ | Verified unsigned, twice independently |
| P | A reproducible archive procedure | ⚠️ | Swift PM resolves plugins through local `path:` references into `node_modules/`, so an archive is only reproducible with a matching `npm ci`. No build-provenance record exists |

**Not in this axis:** export compliance. A build uploads without it and is then marked
**Missing Compliance** in App Store Connect — which blocks *testing and distribution of
that build*, not the upload. It belongs to B.2.

### B.2 Apple's rules for giving a build to a tester

| | Prerequisite | Internal testing | External testing |
| --- | --- | --- | --- |
| A | Everything in B.1 | required | required |
| A | Export compliance answered, or documentation attached | **required** — otherwise the build stays *Missing Compliance* | **required** |
| A | An internal group exists | — | **prerequisite** — Apple requires an internal group before an external group can be created |
| A | Test information supplied before submission | — | **required**: the beta app description, feedback email and contact information, and the build's *What to Test* |
| A | Beta App Review | **not required** | **required for the first build.** Adding a build to an external group does **not** submit it — the first build is submitted by an explicit **Submit Review** (or **Start Testing**) action, and only an approved build can be tested |
| A | Tester eligibility | Up to 100 **App Store Connect users** with access to the app | Up to 10,000 people, by email invitation or public link |
| A | Demo credentials, since the app has a login (guideline 2.1) | — | required |
| A | Compliance with the App Review Guidelines (guideline 2.2) | not reviewed | reviewed |
| A | Distributing to testers after approval | — | **a separate step from approval.** *Automatically notify testers* may be selected at submission; if it is not, the build must be distributed manually with **Notify Testers** |
| A | Role required to operate this | — | Account Holder, Admin or App Manager |
| A | Build lifetime | 90 days | 90 days |

**What Apple's internal-testing rule does and does not mean.** It means Apple does not
review the build. It means nothing about whether *this project* permits that build to be
installed on a device holding real training data. That is B.3, and Apple has no opinion
about it.

### B.3 Authorisation to install and use a build with real data

**This is this project's own axis. Every item is ❌.**

| | Prerequisite | Note |
| --- | --- | --- |
| P | **Preservation of all existing local iPhone data across the installation transition** | Settled decision (P6 amendment, 2026-09-30): no pilot reset, no uninstall/reinstall, no clearing of storage, no discarding of unsynchronised work. **Neither designed nor verified for an installation-channel change** — see [§2](#2-application-identity-and-data-preservation) |
| P | Stage **M3b4** migration protocol | ADR-0049 Decision 7 is an **unresolved design**: three open engineering items plus two S2 credential requirements |
| P | Stage **M3b5** cutover | Not performed. A flag-enabled native-storage build deliberately does not mount |
| P | Old-client rollout policy resolved | [§5](#5-old-client-coordination). The gate is live |
| P | Physical-device acceptance recorded | [§E](#e-physical-device-acceptance-checklist). Never performed |

**Any proposal to proceed before these are met would be an exception to an existing,
settled decision. No such exception has been approved, none is proposed here, and none
appears as an executable step in the runbook.** The runbook's device steps are written for
**disposable data on a device or account that holds none of the owner's work**.

### B.4 Public App Store release

**A public release does not require a prior external TestFlight group or Beta App Review** —
TestFlight is an available beta channel, not a precondition for submission. B.4 therefore
stands on its own rather than nesting on B.2.

| | Prerequisite | Status |
| --- | --- | --- |
| A | Everything in B.1, plus export compliance resolved | ❔ / ❌ |
| A | **In-app account deletion** (guideline 5.1.1(v)) | ❌ |
| A | **Guideline 4.8** satisfied alongside Google Sign-In | ❌ — open decision **P5** |
| A | Guideline 2.1 — no sign-in control that cannot complete | ❌ |
| A | App Store Connect privacy answers | ❌ |
| A | Updated age-rating questionnaire | ❌ — required since 31 Jan 2026 to avoid submission interruption |
| A | Store listing: screenshots, description, support URL, category | ❌ |
| P | Everything in B.3 | ❌ |
| P | **P1** Web + mobile vs. mobile-only · **P3** background measurement · **P4** production identity and distribution commitments · **P5** | ❌ open — all named by Stage M6 |
| P | Stage **M3** complete; Stage **M4** / Brower **Gate C** | ❌ |

**Do not treat "it's only a beta" as a route past M3 or M6.** Apple's guideline 2.2
requires a TestFlight beta to be intended for public distribution and to comply with the
review guidelines, and Stage M6 names **P1, P4 and P5** as prerequisites with **M3 at
minimum** behind it.

---

## 1. Apple account and distribution prerequisites

### What was observed locally, and when

All observations below are of **this Mac's local caches**, at the stated instant. They
describe how a cached artefact was issued. They are **not** a reading of Apple-side
membership, agreements, App ID registration or App Store Connect records, none of which
were inspected.

| Observed at | Observation |
| --- | --- |
| 2026-10-08 ~15:4x UTC | Two Xcode-managed provisioning profiles, created 2026-09-28, each `TimeToLive = 7`, expiry 2026-10-05 |
| **2026-10-08 16:02 UTC** | **One** Xcode-managed provisioning profile: `local.dev.curlingperformance`, created **2026-10-08 15:43:57 UTC**, expiry **2026-10-15 15:43:57 UTC**, `TimeToLive = 7`. The two earlier profiles are gone |
| 2026-10-08 16:02 UTC | `security find-identity -v -p codesigning` reports exactly one identity, an **Apple Development** identity. No `Apple Distribution` identity is present |
| 2026-10-08 | Xcode 27.0 (27A266a), iOS SDK 27.0, Node v24.16.0 — satisfying Capacitor 8's Xcode 26.0+ / Node 22+ requirement |

**The local state changed during this audit**, which is itself the finding: provisioning
profiles are a cache Xcode rewrites whenever it builds. Nothing here is a permanent fact.

### What that does and does not establish

**Does establish.** The profile currently cached for this project was issued with a
**7-day** lifetime. That is characteristic of free personal-team provisioning;
Apple Developer Program development profiles are issued with a one-year lifetime. A build
signed with such a profile needs re-provisioning roughly weekly, which is an ongoing
operational cost of the current arrangement regardless of anything else.

**Does not establish.**

- **Whether an Apple Developer Program membership exists.** It may exist under this Apple
  Account or another one and simply not have been used for this project's last build.
  **Status: unknown.**
- **Whether the owner's installed app currently launches.** That depends on the profile
  embedded in the *installed build*, which was not inspected, and on the device's own
  state. A profile observed on this Mac is not the profile inside that app.
  **No claim is made here; this needs a device report or an inspection of the installed
  build.**
- **Whether the Program License Agreement is accepted, whether an App ID is registered,
  or whether an App Store Connect record exists.** None was inspected. **Unknown.**

**A missing local `Apple Distribution` identity is not a blocker.** Apple's cloud-managed
certificates are held by Apple, and Xcode 13 or later cloud-signs for distribution when no
local signing certificate is found. Account Holder or Admin manages them; Admins and
Developers can sign with them.

### Owner-side questions

Enrolment type (Individual vs. Organization — the latter needs a D-U-N-S number and legal
entity verification), who holds Account Holder, and whether the Program License Agreement
is accepted. **The Paid Applications agreement and Tax/Banking details are not required
for a free app** and should not be set up reflexively.

---

## 2. Application identity and data preservation

### Current values

| Setting | Value | Status |
| --- | --- | --- |
| `appId` / `PRODUCT_BUNDLE_IDENTIFIER` | `local.dev.curlingperformance` | Development placeholder, declared as such in `capacitor.config.ts`. Open decision **P4** |
| `appName` / `CFBundleDisplayName` | `Curling Performance (Dev)` | Development placeholder |
| `CFBundleName` | resolves to `App` (`PRODUCT_NAME = $(TARGET_NAME)`) | Template default; cosmetic |
| `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` | `1.0` / `1` | Template defaults. Valid for a first upload; **no numbering policy exists for later ones** |
| `IPHONEOS_DEPLOYMENT_TARGET` | `15.0` | Deliberate |
| `CODE_SIGN_STYLE` | `Automatic` | Adequate; a distribution archive may want a deliberate choice |
| Entitlements, Associated Domains, URL scheme, `UIBackgroundModes` | none | Consistent with **P3** and **P4** being open |
| `server.url` | absent | Must stay absent — a remote wrapper would convert the same-origin security model into an accident of where the document loaded from |

### The settled requirement

**All existing local iPhone application data is preserved.** No pilot reset, no
uninstall/reinstall, no clearing of storage, no discarding of unsynchronised work is
authorised (P6 amendment and ADR-0049, 2026-09-30). **Existing local data must be migrated
and verified before any production storage cutover.** This document does not reopen that
decision, and does not present it as a preference to be traded against a tidier identifier.

### What a bundle-identifier change actually does

Stated precisely, because the loose version of this is what produces bad decisions.

1. **A different bundle identifier creates a separate app with a separate container.** iOS
   keys the data container to the bundle identifier.
2. **Installing that separate app does not, by itself, erase the original installation.**
   The original app and its container remain where they are, under the original identifier.
3. **The new app does not automatically receive the original container's data.** There is
   no implicit transfer between containers.
4. **Keeping the same identifier does not prove the transition is safe either.** The
   specific transition in question — an app installed by Xcode under one team being
   replaced by a TestFlight build signed by a different team — changes the signing
   authority. Nothing in this repository, and nothing observed on this machine,
   establishes the outcome. Matching names and matching identifiers are not evidence.

**So the choice of identifier is not a choice about whether data is lost.** It changes
*which* app holds the data and *what* a transfer would have to do. The transfer is the
unsolved part, in both cases.

### What the existing mechanisms do not cover

**Cloud synchronisation restores only:** archived Training Sessions, terminal Assessment
Runs, and owned Team Exercise results — and only those that have **actually
synchronised**. A record still in the outbox is eligible but not available, and remains
dependent on its original device.

**Nothing restores:** the current in-progress Training Session including its active
Capture Sequence; anything still in the outbox; the active Assessment draft; the active
Team Exercise draft; **authored Training Plans**; **Accuracy Tolerance Profiles**;
**Smart Random Profiles**; history filters; assessment preferences.

**CSV export is not a backup/restore path, and this is verifiable rather than cautious.**
`src/lib/export.ts` and `src/lib/assessment/export.ts` build CSV strings only. A
repository-wide search finds **no CSV or JSON import, no parser, and no file-input UI
anywhere in `src/`** — the two `FileReader` uses (`authorizedFetch.ts:230`,
`exerciseAssets.ts:68`) convert blobs to data URLs and are unrelated. There is therefore no
restore path to demonstrate, at any fidelity. Export also covers no Training Plan,
tolerance profile or Smart Random profile at all.

ADR-0049 additionally records that **native storage does not survive uninstall**.

### Status: the transition is blocked

**Any installation transition affecting the owner's real installation is blocked until
data preservation is designed and verified.** Not discouraged — blocked, by the settled
decision above.

**Testing on disposable data is a different activity and is permitted.** Installing a
build on a device or under an account that holds none of the owner's work, in order to
learn how the transition behaves, neither touches the owner's data nor authorises its
loss. Those two things must not be conflated, and the runbook keeps them apart.

### Missing technical preservation work

This is the list that has to shrink before B.3 can be met. It is engineering work, not a
decision to be made.

| # | Item | Source |
| --- | --- | --- |
| 1 | **A designed, verified transfer of application data across an installation transition** — container to container under a new identifier, or across a signing-authority change under the same one. **No design exists.** This is distinct from the storage-engine migration below and from the deferred browser import (**P2**) | This audit |
| 2 | **Migration protocol (ADR-0049 Decision 7) — UNRESOLVED.** Reconciling two differing installation store ids seen before activation | ADR-0049, Stage M3b4 |
| 3 | A pre-activation record whose source marker is missing, which cannot be distinguished from later source clearing | ADR-0049, Stage M3b4 |
| 4 | Human-authorised resolution of a blocked source-generation divergence | ADR-0049, Stage M3b4 |
| 5 | **S2:** secure transfer of the existing provider session out of WebView storage into the protected credential store | ADR-0049 amendment |
| 6 | **S2:** the cross-store interruption where one of the two separate stores is written and the other is not | ADR-0049 amendment |
| 7 | A **protected-credential dependency that can distinguish missing from failed** per item. The audited Capacitor 8 options cannot, so the native credential path reports `no_absence_evidence` and composition blocks | ADR-0049, `S-P1` |
| 8 | Unmeasured durability evidence: physical-device transaction acceptance, a naturally occurring commit failure, termination during a commit, backup/restore, power-loss survival, capacity ceiling. The diagnostic transaction scenarios **ran on a disposable simulator** (user-reported, 2026-10-15) and **never on a physical device**, so this row remains a blocker | ADR-0049 Decision 2 review status; `docs/MOBILE_APP_MIGRATION.md` Stage M3b0 §7 |
| 9 | **Stage M3b5 cutover**, which may only follow a verified migration | ADR-0049 Decision 10 |

**Browser-local data is a separate, settled matter.** A native WebView has its own storage
container and does not share Safari's or Brave's. **P2** (2026-09-29) settled that the first
pilot does not transfer browser-local data; only synchronised cloud records cross. An
athlete moving from Web to iOS receives archived sessions, terminal assessment runs and
owned Team results — not authored Training Plans, tolerance profiles or in-progress work.

---

## 3. Release-build readiness

### Verified this session

```
git diff --check                     clean
npm run mobile:lint                  no findings
npm run mobile:verify                typecheck + build + 9 files / 143 tests passed
npm run ios:sync                     git status clean afterwards
xcodebuild … -configuration Release -destination 'generic/platform=iOS'
  CODE_SIGNING_ALLOWED=NO -derivedDataPath <scratchpad outside the repository>
                                     ** BUILD SUCCEEDED **
```

**What that build is.** An unsigned Release-configuration compile of the iOS device slice,
8.8 MB, `arm64` only, with `builtin-validationUtility -validate-for-store` having run
inside it. **It is not an App Store archive, not a validated upload, and not device
acceptance.** No signing, provisioning, entitlement or production service was touched;
derived data was written outside the repository and the working tree stayed clean.

### Bundled assets and configuration

- **67 public Exercise diagrams** emitted at the exact paths
  `createPublicExerciseAssetResolver` fetches, including superseded asset ids. A registered
  diagram with no file fails the build, so offline diagram rendering is structurally sound.
- **No `server.url`.** The bundle is local; the document origin is `capacitor://localhost`.
- Configuration is an explicit allow-list (`mobile/publicEnv.ts`), not a `process.env`
  passthrough. `NEXT_PUBLIC_NATIVE_API_ORIGIN` is inlined **at build time**; a build made
  without it denies Team requests before any token is read. Rebuild and re-sync after
  changing it.
- Main JS chunk 1.79 MB (457 kB gzipped) — a cold-start cost, not a blocker.

### Production-visible surfaces

| Surface | Gate | In a release artifact? |
| --- | --- | --- |
| Timing Simulator | `IS_DEV` | No |
| Brower BLE diagnostic screen | `IS_DEV` | No |
| Native storage diagnostics panel | `CURLING_MOBILE_STORAGE_DIAGNOSTICS`; the dynamic import folds away when off | No |
| Native storage composition | `CURLING_MOBILE_NATIVE_STORAGE`, a separate flag | No — and it **must stay off**: such a build blocks before mounting, by design |
| **Brower assisted capture panel** | **none** — `TrackerApp.tsx:5403`, shown whenever Auto Capture is active | **Yes** — see [§4.6](#46-tci--bluetooth) |

### Export compliance — accurate classification

**Missing `ITSAppUsesNonExemptEncryption` does not prevent uploading a build.** What it
does is leave the uploaded build marked **Missing Compliance** in App Store Connect, which
must be resolved before that build can be tested or distributed. It can be resolved per
build by answering the questions in App Store Connect, by attaching previously approved
documentation, or in advance by declaring the key in `Info.plist`.

**Declaring the key does not make the question go away in every case.** Apple's guidance is
to set it to `NO` when the app, *including third-party libraries it links against*, uses no
encryption or only exempt forms, and to `YES` otherwise — and a `YES` answer leads into the
documentation requirements rather than past them.

**What is actually in the bundle.** The Release artifact contains `SQLCipher.framework`,
pulled in by `@capacitor-community/sqlite`, a direct dependency for Stage M3b. The default
build composes **no** native storage, so this is a linked-but-unexercised encryption
library — and it still ships.

**How Apple's reference classifies the cases**, so the owner can answer rather than guess:

| Case | Documentation |
| --- | --- |
| Encryption limited to that within the Apple operating system | None required in App Store Connect |
| An **industry standard algorithm not provided within the Apple operating system** | French encryption declaration (required only when distributing on the App Store in France) |
| **Proprietary** algorithms not accepted by international standards bodies | US CCATS, plus the French declaration (France only) |

**This document does not decide which row applies, and does not reflexively propose `NO`.**
SQLCipher implements standard algorithms but is not the Apple OS's encryption, which places
it on its face in the middle row rather than the first; whether that is the correct legal
classification for this app is the owner's call, with advice if needed. Two legitimate
routes exist and both are owner decisions: classify and declare, or remove the dependency
from distribution builds while native storage remains inert — the latter being a change
with its own review surface that must be checked against Stage M3b's plans, and is **not**
proposed as part of the next stage.

### Other findings in the built artifact

| Finding | Detail |
| --- | --- |
| `LocalAuthentication.framework` linked, no `NSFaceIDUsageDescription` | From the SQLite plugin's biometric code path, which this application never calls. Not a crash today; it would be if that path were ever reached |
| `UIRequiredDeviceCapabilities` | The committed `Info.plist` carries the Cordova-era `armv7`; **Xcode rewrites it to `arm64` at build time**, so the shipped value is correct. No action needed |
| `CFBundleName = "App"` | Cosmetic; fold into the identity stage |
| Build warnings | 17, all from third-party plugin sources. None from this project's code |

### Reproducibility

`ios/App/CapApp-SPM/Package.swift` resolves seven Capacitor plugins through local `path:`
references into `node_modules/`, so an archive is reproducible only together with the exact
dependency tree: `npm ci` → `npm run mobile:build` → `npm run ios:sync` → archive.
`package.json` pins every Capacitor-family dependency exactly. What is missing is a record
of which commit and which `package-lock.json` an uploaded build came from.

---

## 4. Functional and review blockers

Classification: **Implemented** (code exists) · **Automatically tested** · **Device-tested**
(verified on hardware and recorded) · **Unverified** (built, never exercised) · **Missing**.

### 4.1 Login

| Path | State |
| --- | --- |
| Email OTP on iOS | Implemented; automatically tested; **user-reported** working on a physical iPhone (2026-09-29). Not a recorded checklist pass — items 2, 4, 5, 6, 8, 9, 10, 11 of the M2a procedure are unperformed |
| **Native Google sign-in** | **Missing, and offered anyway** |
| Account switching | Implemented; automatically tested; **unverified on device** |
| Sign-out | Implemented; automatically tested |

**The Google defect, precisely.** `IdentityGateScreen.tsx:107` renders "Continue with
Google" with no platform check. The redirect target is computed by
`identityRuntime.ts:browserRedirectTarget()` as `window.location.origin + "/"`, which on a
native iOS build is `capacitor://localhost/` — not a registrable Google redirect URI and not
an allowed Supabase callback. The flow cannot complete.
`docs/MOBILE_APP_MIGRATION.md` §6 records the owned-callback design as the unfinished
remainder of Stage M2.

Guideline 2.1 requires submissions to be final versions that have been tested on-device and
do not exhibit obvious technical problems. A primary sign-in control that cannot complete is
squarely within that; what App Review would do with it is Apple's call, not a prediction
this document makes.

**It must not be fixed by deleting Google sign-in** — §1 of the migration document preserves
existing sign-in options and the Web application depends on it. Two legitimate shapes:
implement the native callback path (the rest of Stage M2), or make the control honestly
unavailable **on native only** while Web is unchanged. That is a product decision — see
[§F](#f-decisions-the-owner-must-make).

### 4.2 Account deletion — guideline 5.1.1(v)

**Missing.** A repository-wide search finds account deletion only in documents, never in
`src/`. `SettingsScreen.tsx:253` offers *"Permanently delete the entire session history from
this device and your…"* — data deletion, not account deletion.
`IdentityAccountControl.tsx` offers **Sign out** only.

The app mandates account creation, so guideline 5.1.1(v) applies. ADR-0041's own
consequences list account deletion among the things still requiring legal review.

- **Public App Store release: an unmet Apple requirement.**
- **External TestFlight: in scope for Beta App Review**, since guideline 2.2 requires the
  beta to comply with the review guidelines.
- **Internal TestFlight: outside Apple's review**, which says nothing about whether the
  feature should exist.

### 4.3 Guideline 4.8 — open decision P5

Apple requires an app using a third-party login for the primary account to also offer a
login service that (i) limits collection to name and email, (ii) **lets the user keep their
email address private**, and (iii) does not collect in-app interactions for advertising
without consent.

Email OTP satisfies (i) and (iii) and plainly not (ii) — there is no relay. Whether that is
fatal, or whether Sign in with Apple must be added, is **P5** and is not resolved here.

### 4.4 Privacy disclosures and review access

| Item | State |
| --- | --- |
| In-app privacy policy link | **Implemented** — identity gate and Settings, via `ExternalDocumentLink`, which opens the platform browser on native |
| Deployed Privacy Notice | **Live** — `privacy-2026-08-28`, verified 2026-10-08 |
| Deployed Terms | ADR-0042's first version exists at `/legal/terms/2026-08-29`; **its activation is a separate owner-operated database action**, not verified here |
| `PrivacyInfo.xcprivacy` required-reason APIs | **Implemented** — `C617.1` for `@capacitor/filesystem`'s timestamp reads, with reasoning in the file |
| `NSPrivacyCollectedDataTypes` | **Empty array**, and needs a deliberate decision: the app sends an email address and structured training records to Supabase. Whether that belongs in the manifest, and what the App Store Connect privacy answers say, must be settled consistently with ADR-0041 |
| App Store Connect privacy answers | **Missing** |
| Demo account for review (guideline 2.1) | **Missing.** Needs a disposable account with onboarding completed, supplied in the review information |

### 4.5 Persistence and offline behaviour

| Item | State |
| --- | --- |
| Production local store on iOS | WebView `localStorage`, which Capacitor documents as transient on both platforms — the OS may reclaim it under storage pressure. No persisted-storage API exists for it on iOS |
| **Status of that** | **An unmet gate, not an accepted risk.** P6 (2026-09-29) decided Option B: adopt durable native storage; `localStorage` is explicitly **not** retained as the native production store by accepting its eviction risk |
| Durable native storage (SQLite) | Adapter, in-app diagnostics and composition implemented behind two separate off-by-default flags. A flag-enabled build **blocks before mounting**, because migration (M3b4) and cutover (M3b5) do not exist. **It must not be enabled to "fix" durability** |
| Engine evidence | **Partially device-tested** (user-reported, 2026-09-30): WAL and `synchronous=FULL` in force, values survive a force-quit in airplane mode, a never-written key reads absent. Transaction and checkpoint scenarios, including a process stop with a transaction open, **ran on a disposable simulator** (user-reported, 2026-10-15; `docs/MOBILE_APP_MIGRATION.md` Stage M3b0 §7). **Unmeasured:** physical-device transaction acceptance, a naturally occurring commit failure, termination during a commit, backup/restore, power loss, capacity ceiling, anything on Android. The interruption rehearsal is for a **disposable** test installation only; the data-bearing iPhone must not receive the diagnostics build |
| Offline cold start | Implemented and specified (§7.6). **User-reported** working once (2026-09-29); not a recorded checklist pass |
| Cloud restore | Implemented and automatically tested; covers synchronised archived sessions, terminal assessment runs and owned Team results only |
| Background sync | **Does not exist.** Nothing makes an upload happen while iOS has suspended or closed the app |

**What a tester must be told, truthfully:** local-only work on the device — authored plans,
tolerance and Smart Random profiles, in-progress training, outbox contents — is not covered
by cloud synchronisation and is held in a store the OS may reclaim. That is a **known
limitation of an incomplete stage**, which the project has already decided to fix rather
than accept.

### 4.6 TCi / Bluetooth

| Item | State |
| --- | --- |
| `NSBluetoothAlwaysUsageDescription` | **Declared**, with specific, truthful text naming the Brower timer |
| `UIBackgroundModes` | **Not declared.** Open decision **P3** untouched. Capture is foreground-only and invalidates on backgrounding |
| Assisted capture pilot | **Implemented** (ADR-0050), **automatically tested against a fake transport**, **not hardware-accepted**. The user reports a working two-gate session (2026-10-01) — a use report, not a recorded checklist run. `B-P0` open; Gate C partial, Gate D not started |
| Protocol coverage | **Partial.** Chron base-packet splits 1–4, the appendix count and one appendix packet are evidenced. Session headers, splits 6–20, the start time and the second appendix packet are not |
| Residual risks | Appendix association rests on arrival order plus a structural check (`B-P5`); baseline completeness cannot be proved (`B-P6`); an in-range false trigger can still be recorded automatically and is corrected by Undo/delete (`B-P1`) |
| **Reviewer-facing** | The assisted capture panel is **production-visible** whenever Auto Capture is active — not `IS_DEV`-gated. A reviewer with no TCi will see it and may tap Connect, triggering the Bluetooth prompt. Its documented behaviour is an honest connection status rather than a fabricated success, but **that has never been exercised on a device with no timer present** — which is exactly the configuration App Review runs in |

That last row is a cheap device check and is item 14 of the [§E](#e-physical-device-acceptance-checklist) checklist.

---

## 5. Old-client coordination

### The mechanism, verified in code

`syncManager.restoreIntoLocalRepositories()` (`src/lib/cloudSporting/syncManager.ts:1043`)
iterates the restored records and, on the **first** record it cannot deserialize, executes
`this.globalIssue = true; this.cloudVerified = false; return false`. The caller then skips
`reconcileFromRepositories()`, `drain()` and the Team refresh.

An old client meeting one wire-version-2 record therefore does not skip that record — **it
abandons the entire restore pass and stops draining its own outbox**, in both directions,
until the record is gone or the client is updated. Nothing in this checkout can change that
retroactively on an installation already in the field.

### The blast radius is one athlete, not both

`supabaseSportingCloudService.restore()` calls the RPC `get_my_sporting_records`. A client
only ever restores **its own Profile's** records. So the owner creating a Speed / Both /
asymmetric-tolerance training cannot break the athlete's client, and vice versa — but it
will break *that same person's* other clients for as long as the record exists.

### Who is an old client — conditional, not established

`src/lib/measurement/` was added by `d801315`, which is unpushed; `origin/main` is
`80fb19e`. **Deployment provenance for `https://curling.evolane.me` was not established**,
so this resolves conditionally:

- **If** the deployed Web application is built from `origin/main` or any earlier commit,
  **then** it is wire-version-1-only, i.e. an old client for both users.
- **If** it is built from some other source, the question is open and must be answered
  before the sequence below is meaningful.

The Stage M2a server CORS handlers (`src/app/api/_lib/nativeCors.ts`) *are* present at
`origin/main`, added by `80fb19e`. Whether that commit is deployed is the same unestablished
question, and is what step 8 of the M2a device procedure exists to prove.

### Proposed bounded update sequence — A PROPOSAL, NOT AN APPROVED POLICY

Written for these two users. Offered for the owner's decision; it must not be executed on
the strength of this document, and it is not an exception to [§B.3](#b3-authorisation-to-install-and-use-a-build-with-real-data).

1. **Establish deployment provenance** for the deployed Web application. Without it, steps
   3 and 4 cannot be reasoned about.
2. **Freeze version-2 creation.** Neither user selects Speed, Both or an asymmetric
   tolerance in a real account. Version-2 records belong in disposable test accounts, as
   ADR-0051 already requires.
3. **Each user drains on every client they use.** Finish open trainings; confirm the sync
   status reads **synced**, not *saved on device*. Per client — the outbox is per device.
   This reduces what only one device holds; it is **not** a backup, since it covers only the
   cloud-eligible domains ([§2](#2-application-identity-and-data-preservation)).
4. **Deploy the Web application from a commit containing `src/lib/measurement/`.** The
   highest-leverage step: it converts both users' most-used client at once. Requires a push
   and a deploy, neither of which this task performed or authorises.
5. **Hard-reload every open Web tab** afterwards. A tab left open on the previous bundle is
   still an old client regardless of what the server now serves. Most easily forgotten step.
6. **Update the iOS installation** to the same code — **subject to [§B.3](#b3-authorisation-to-install-and-use-a-build-with-real-data)**,
   which is not currently met, so this step is **not available today** by any channel that
   would disturb the existing installation.
7. **Only then** is Speed / Both / asymmetric tolerance safe in a real account, and only on
   clients that completed step 4 or 6.

**Ordering constraint:** step 4 must precede step 7 *per athlete*. There is no shared state
to coordinate between the two users, which is why this is tractable.

**Not done, deliberately:** no wire-version-2 record was created in any production account
during this task; nothing was pushed; nothing was deployed.

---

## C. Smallest remaining task sequence

Only **M6a** is proposed as the next implementation stage. The rest are named so the
dependency order is visible. Nothing here authorises a distribution.

| Stage | Scope | Depends on | Acceptance |
| --- | --- | --- | --- |
| **O1** (owner) | Establish Apple-side state: is there a Program membership, under which Apple Account, is the Program License Agreement accepted | — | The answer is recorded, replacing "unknown" |
| **O2** (owner) | Decide **P4** for this purpose: production bundle identifier, app name, Apple team. Also decide the export-compliance classification ([§3](#3-release-build-readiness)) | O1 | A written decision in the repository, referenced by `capacitor.config.ts` |
| **O3** (owner) | Register the App ID and create the App Store Connect app record | **O1 and O2** — an app record is created *for* a decided identifier, so identity must be settled first | The records exist |
| **M6a — uploadable build identity** *(proposed next implementation stage)* | Replace the placeholder `appId`/`appName`; introduce a deliberate version/build numbering policy; declare `ITSAppUsesNonExemptEncryption` per O2's classification; settle `CFBundleName`; record commit + lockfile provenance for a build; update `capacitor.config.ts`'s placeholder header, `mobile/README.md` and the P4 row. **No feature, auth, storage, entitlement or capability change** | O2 | `npm run mobile:verify`, `npm run mobile:lint`, `npx tsc --noEmit`, `npm test`, `npm run lint`, `npm run build` pass; an unsigned Release build still succeeds; `git status` clean after `cap sync`; the built `Info.plist` shows the decided identity, the policy's build number and the encryption key |
| **M6b — a reviewable sign-in surface** | Resolve the native Google dead end in the shape the owner chooses. Web behaviour byte-identical | O2 and the owner's Google decision | On iOS no sign-in control can be pressed into a state that cannot complete; Web regression unchanged |
| **M6c — in-app account deletion** | Guideline 5.1.1(v). Spans UI, identity, Profile-scoped local data and cloud authority — needs its own specification and ADR before any code | M6a | Deletion is reachable in-app, removes the account and its Profile-scoped data, and is honest about what it cannot reach |
| **M6d — store-facing metadata** | Beta app description, review information, demo account, privacy answers, age rating, listing | O3, M6b, M6c | Submission accepted |
| **Preservation track** — items 1–9 of [§2](#missing-technical-preservation-work) | The unsolved problem that gates B.3: cross-installation transfer, then M3b4 migration, then M3b5 cutover | ADR-0049's own design items | Each item's own acceptance evidence; nothing touches the owner's installation until they pass |
| *(unchanged, open)* **M4 / Gate C**, **P1**, **P3**, **P5** | As already specified | — | As already specified |

**What each bar actually needs**

- **Producing and uploading an artifact:** O1 + O2 + O3 + M6a.
- **Giving it to an internal tester under Apple's rules:** the above, plus export
  compliance answered on the build.
- **Installing it where the owner's real data lives:** the **preservation track** —
  not covered by any of the above, and not waived by Apple's absence of Beta App Review.
- **External TestFlight:** add M6b, and M6c should precede it.
- **Public release:** all of it, plus the untouched project gates in [§B.4](#b4-public-app-store-release).

---

## D. Runbook

**Every step is UNEXECUTED.** Placeholders are written `<like-this>`. Steps marked
**OWNER** cannot be performed by an implementation agent.

**Scope limit, binding on the whole runbook:** no step here installs anything over the
owner's existing installation or over any device or account holding real training data.
Every device step is written for **disposable data**. Reaching the real installation
requires the preservation track in [§C](#c-smallest-remaining-task-sequence) and is outside
this runbook.

### D.0 Establish the facts — OWNER

1. **UNEXECUTED — OWNER.** Determine whether an Apple Developer Program membership exists
   and under which Apple Account; accept the Program License Agreement if needed. Note that
   the profile cached for this project on 2026-10-08 was issued with a 7-day lifetime
   ([§1](#1-apple-account-and-distribution-prerequisites)). Do **not** set up Paid
   Applications / Tax / Banking for a free app.
2. **UNEXECUTED — OWNER.** Decide **P4** for this purpose: `<bundle-identifier>`,
   `<app-name>`, `<apple-team>`.
3. **UNEXECUTED — OWNER.** Decide the export-compliance classification for a bundle
   containing `SQLCipher.framework`, using Apple's three cases in
   [§3](#3-release-build-readiness).
4. **UNEXECUTED — OWNER.** *Only after 1 and 2:* register the App ID for
   `<bundle-identifier>` and create the App Store Connect app record.
5. **UNEXECUTED — OWNER.** Establish deployment provenance for
   `https://curling.evolane.me` ([§5](#5-old-client-coordination)).

### D.1 Implementation

6. **UNEXECUTED.** Stage **M6a**, under its own approved implementation prompt.

### D.2 Build and archive

7. **UNEXECUTED.** `npm ci`
8. **UNEXECUTED.** Ensure `NEXT_PUBLIC_NATIVE_API_ORIGIN` is set to the configured public
   origin through the ordinary `.env` mechanism. It is **inlined at build time**; a build
   without it denies every Team request. Never print or copy the environment file.
9. **UNEXECUTED.** `npm run mobile:build`
10. **UNEXECUTED.** `npm run ios:sync` — then confirm `git status --porcelain` is empty.
11. **UNEXECUTED.** `npm run ios:open`; on the **App** target confirm Signing & Capabilities
    shows `<apple-team>` and `<bundle-identifier>`, and that version/build follow M6a's
    policy.
12. **UNEXECUTED.** Product → Archive, destination **Any iOS Device (arm64)**. *(No archive
    has ever been produced in this project; the only verified compile is the unsigned
    Release build in [§3](#3-release-build-readiness), which is not an archive.)* If no local
    distribution certificate exists, Xcode cloud-signs for distribution.
13. **UNEXECUTED.** Record the commit SHA and `package-lock.json` hash the archive was built
    from. No mechanism does this today; M6a adds it.

### D.3 Validate and upload

14. **UNEXECUTED.** In the Organizer, **Validate App**; resolve findings before uploading.
15. **UNEXECUTED.** **Distribute App → App Store Connect → Upload.**
16. **UNEXECUTED.** In App Store Connect, resolve export compliance for the build — the
    `Info.plist` key from M6a, the in-app questions, or attached documentation. An
    unresolved build stays **Missing Compliance** and cannot be given to a tester.
17. **UNEXECUTED.** Wait for processing in App Store Connect → TestFlight.

### D.4 Internal testing — disposable data only

18. **UNEXECUTED — OWNER.** Add internal testers. They must be App Store Connect users with
    access to the app; up to 100 are allowed. Grant the most limited role that permits
    TestFlight access.
19. **UNEXECUTED — OWNER.** Fill in **What to Test**. State explicitly: Google sign-in does
    not work on iOS; local-only work is not covered by cloud synchronisation and the native
    durable store is not yet in use; timer capture is foreground-only.
20. **UNEXECUTED.** Install **on a device or under an account holding no real training
    data**, and run [§E](#e-physical-device-acceptance-checklist) in full.
21. **BLOCKED — not a step.** Installing on the owner's device, or any device holding real
    data, requires [§B.3](#b3-authorisation-to-install-and-use-a-build-with-real-data). It is
    deliberately absent from this runbook.

### D.5 External beta — only after M6b and M6c

Every step below is **UNEXECUTED** and **owner-operated** — Account Holder, Admin or App
Manager. Nothing here is performed by an implementation agent.

22. **UNEXECUTED — OWNER.** Ensure an **internal** group exists; Apple requires one before
    an external group can be created. Then create the external group under *External
    Testing* and name it.
23. **UNEXECUTED — OWNER.** Select the group, click **Add Builds**, choose the platform and
    version, select the build and add it. **This does not submit anything** — the build is
    only attached to the group.
24. **UNEXECUTED — OWNER.** Supply the required information: the beta app description, the
    feedback email and contact information, the build's **What to Test**, review notes and
    **demo credentials** (guideline 2.1). Decide here whether to select **Automatically
    notify testers** — if it is left unselected, the approved build must be distributed
    manually in step 28.
25. **UNEXECUTED — OWNER.** **Submit the build for Beta App Review explicitly** — click
    **Submit Review** (or **Start Testing**, depending on the build's status). Only one build
    per version may be in review at a time, and at most six builds may be submitted in any
    24-hour period.
26. **UNEXECUTED — OWNER.** Await the outcome. The first build of a version requires a full
    review; later builds for the same version may not. On approval, Admin users on the
    account receive an email.
27. **UNEXECUTED — OWNER.** Add the testers themselves: a **public link** (open to anyone or
    filtered by criteria, with an optional limit up to 10,000), or individual **email**
    invitations (new, existing, or imported from CSV). Public-link joiners appear as
    anonymous; email invitees appear by name once they accept.
28. **UNEXECUTED — OWNER.** **Distribute to testers — a separate action from approval.** If
    *Automatically notify testers* was selected, notification follows approval; otherwise
    open the build under *Builds* and click **Notify Testers**, which moves the build to
    *Testing*.

### D.6 Updates

29. **UNEXECUTED.** Each upload needs a build number unique within its version, per M6a's
    policy. Builds expire after **90 days**; a tester on an expired build cannot launch it.
30. **UNEXECUTED.** Significant changes to an external beta go back to Beta App Review, by
    the same explicit submission in step 25.
31. **UNEXECUTED.** Do not ship an update that creates wire-version-2 records to a user
    before [§5](#5-old-client-coordination) step 4 has completed for that same user.

---

## E. Physical-device acceptance checklist

**None of this has been performed.** Items 1–3 and 5 overlap the Stage M2a and M3a
procedures in `mobile/README.md`, which remain canonical; this list exists so one
distribution-shaped pass covers the distribution-shaped risks.

**Run it on a device or under an account holding no real training data.** Use only accounts
and a Team you control; do not run any step against a real Team or involve a third party.
Record each outcome — "it seemed fine" is not a result.

| # | Check | Expected |
| --- | --- | --- |
| 1 | **Email sign-in**, fresh launch | A typed code arrives; the training application opens |
| 2 | **Wrong code, then expired code** | Clear refusal each time; no session; gate stays locked |
| 3 | **Google button** | Exactly as M6b decided. Must not hang, blank, or leave a half-authenticated state |
| 4 | **Installation-transition behaviour, on disposable data** | Install a TestFlight build over an Xcode-installed build of the same identifier, and separately install under a changed identifier. State the expectation first, then record what actually happened to each container. **This is evidence-gathering for the preservation design — it is not a preservation mechanism, and a pass here does not authorise the same transition on the owner's installation** |
| 5 | **Offline cold start** — airplane mode, app force-quit | Launches; the gate admits from trusted local state with no network; "Preparing your training data" **resolves rather than hanging**; existing local history, plans and profiles are readable |
| 6 | **Offline recording** | A full session records, saves and reopens offline. Every exercise diagram renders from the bundle |
| 7 | **Honest sync status offline** | Reads *saved on device*, not *synced* |
| 8 | **Cloud restore on reconnect** | The outbox drains; archived sessions, terminal assessment runs and owned Team results reconcile **without duplicating** the offline-recorded work |
| 9 | **Fixed Weight — Time** | Setup defaults to today's time behaviour; recording, targets and results unchanged |
| 10 | **Fixed Weight — Speed, and Both** | Speed entered in m/s against its own target and per-side tolerance; `"240"` is **not** rescaled to 2.40; a Both stone carries both measurements under one stone identity; results never mix units. Disposable account only, per [§5](#5-old-client-coordination) |
| 11 | **Same-stone completion** | A Both stone missing one measurement is completable from the missing-measurement panel against the **explicitly selected** stone, across blocks of the current training. An archived session is correctly *not* editable this way |
| 12 | **Early Next Exercise** | Advancing before the planned stone count works, awaits a real save acknowledgement, and reports a genuine failure rather than diverging from storage |
| 13 | **Early Finish Training** | Offered, non-destructive, ends any active Capture Sequence; the summary's stone count matches what was recorded |
| 14 | **TCi — no timer present** (the App Review configuration) | The assisted capture panel appears with an honest disconnected state; Connect fails honestly. No fabricated success, no crash, no stuck spinner |
| 15 | **TCi — two gates, real timer** | The seven-item Brower checklist recorded as a new observations collection: setup exclusion, both appendix boundaries, duplicate and out-of-range exclusion, lifecycle pause, exhaustion and new-record recovery, restart survival |
| 16 | **TCi — backgrounding during capture** | Capture invalidates and says so. No background mode is declared and none may be implied |
| 17 | **Export** | CSV export produces a retrievable file via the share sheet, works in airplane mode, matches the app's values, reports cancellation as cancellation; double-tap produces exactly one share sheet |
| 18 | **External links** | Privacy and Terms open in the platform browser; returning leaves the app where it was, not restarted |
| 19 | **Account switch** | Signing in as a different Profile exposes **none** of the previous Profile's sessions, plans, profiles or results |
| 20 | **`crypto.randomUUID`** | Returns a v4 UUID on device. Verified only on desktop Chromium so far; if absent the identity runtime is unusable |

---

## F. Decisions the owner must make

Recommendations are **proposals**, not decisions, and none may be implemented without
explicit approval.

**1. Apple Developer Program membership — does one exist, under which Apple Account?**
Currently **unknown**, not absent. Everything in B.1 waits on the answer.
*Proposal:* if none exists, enrol as **Individual** — faster, no D-U-N-S, adequate for two
testers. The Enterprise Program is not an option: Apple restricts it to internal
distribution for organisations with 100+ employees and excludes App Store and TestFlight.

**2. Production bundle identifier and app name (P4).**
*Proposal:* adopt a reverse-DNS identifier under a domain actually controlled (e.g.
`<me.evolane.curling>`). **This is a naming decision, not a data decision** — neither choice
transfers the existing container's data by itself, and neither is authorisation to lose it.
The transfer is the unsolved engineering problem in [§2](#missing-technical-preservation-work),
and it must be solved either way before the owner's installation is touched.

**3. Export-compliance classification for a bundle shipping `SQLCipher.framework`.**
*No proposal on the legal answer.* Use Apple's three cases in
[§3](#3-release-build-readiness) and classify deliberately; a reflexive `NO` is not
appropriate for a bundle that links a non-OS encryption library. A second, separable option
is to remove the dependency from distribution builds while native storage is inert — that
is its own change with its own review surface and is **not** part of M6a.

**4. What happens to the Google button on iOS?**
*Proposal:* make it **unavailable on native only**, with honest copy, while Web is
unchanged. Implementing the native callback path is the rest of Stage M2 and far larger than
this distribution needs. Removing Google sign-in outright is ruled out by §1 of the
migration document.

**5. Internal or external TestFlight, once a build exists?**
*Proposal:* **internal**, which avoids Beta App Review. The cost is real: an internal tester
must hold an App Store Connect user role — grant the most limited one that permits
TestFlight access and do not enable access to Certificates, Identifiers & Profiles. **This
choice does not affect [§B.3](#b3-authorisation-to-install-and-use-a-build-with-real-data).**

**6. Old-client rollout policy ([§5](#5-old-client-coordination)).**
*Proposal:* establish deployment provenance first, then approve the sequence, whose
load-bearing step is deploying the Web application from a commit containing
`src/lib/measurement/` before either user records Speed, Both or an asymmetric tolerance in
a real account. Requires a push and a deploy, neither performed nor authorised here.

**7. Guideline 4.8 / Sign in with Apple (P5).**
Not engaged by internal TestFlight; engaged before public release.
*Proposal:* defer deliberately and record the deferral, rather than leaving P5 looking
accidentally unanswered.

**8. Priority of the preservation track.**
It is the only thing standing between a producible build and a usable one, and it is
engineering work rather than a decision — but its *sequencing* against M6a/M6b is the
owner's call.

---

## 6. What this audit did not verify

- **All Apple-side state:** membership, agreements, App ID registration, App Store Connect
  records, roles. Marked **unknown** throughout, never inferred as absent.
- **The owner's installed build** and the profile embedded in it. No claim is made about
  whether it currently launches.
- Any signing, archiving, validation or upload. The only build performed was **unsigned**,
  in Release configuration, with disposable derived data — **not** an archive and **not** a
  validated upload.
- Any behaviour on a physical device. Every device statement is either a **user report**,
  labelled as such, or **unperformed**.
- **Deployment provenance** for `https://curling.evolane.me`, and therefore whether the
  Stage M2a server CORS handlers are deployed. Dependent statements are left conditional.
- The activation state of the Terms of Service metadata row (an owner-operated database
  action).
- Android, in every respect. No Android project exists.
- The full Web/E2E suite. This pass changed documentation only; `npm test`, `npm run lint`,
  `npm run build` and `npm run test:e2e` were not re-run and no claim is made about them.

---

## 7. Apple sources and verification date

All fetched **2026-10-08**.

| Claim | Source |
| --- | --- |
| TestFlight limits, internal vs external testers, Beta App Review for the first external build, 90-day build lifetime, required test information | https://developer.apple.com/testflight/ · https://developer.apple.com/help/app-store-connect/test-a-beta-version/testflight-overview/ |
| **External-tester procedure** — an internal group is a prerequisite; adding a build to a group does not submit it; **Submit Review** / **Start Testing** is the explicit submission; *What to Test*, feedback email and contact information are required first; one build per version in review and at most six submissions per 24 hours; distribution is separate from approval (*Automatically notify testers*, or **Notify Testers**); testers added by public link or email; Account Holder / Admin / App Manager role | https://developer.apple.com/help/app-store-connect/test-a-beta-version/invite-external-testers |
| Guidelines 2.1, 2.2, 4.8, 5.1.1(i), 5.1.1(v) | https://developer.apple.com/app-store/review/guidelines/ |
| Xcode 26 / iOS 26 SDK minimum (28 Apr 2026); target iOS 13 or later (9 Sep 2026); age-rating update (31 Jan 2026) | https://developer.apple.com/news/upcoming-requirements/ |
| TestFlight requires **Apple Developer Program** membership; a free account does not include it | https://developer.apple.com/support/compare-memberships/ |
| **Cloud-managed distribution certificates** — stored by Apple; Xcode 13+ cloud-signs for distribution when no local signing certificate is found; Account Holder/Admin manage them | https://developer.apple.com/help/account/certificates/cloud-managed-certificates |
| **Missing Compliance** on a build; resolution by in-app questions, attached documentation, or the `Info.plist` key | https://developer.apple.com/help/app-store-connect/test-a-beta-version/provide-export-compliance-information-for-beta-builds/ · https://developer.apple.com/help/app-store-connect/manage-app-information/determine-and-upload-app-encryption-documentation/ |
| **Export-compliance classification** — Apple-OS encryption needs no documentation; a non-Apple industry-standard algorithm needs the French declaration (France only); proprietary algorithms need CCATS plus the French declaration | https://developer.apple.com/help/app-store-connect/reference/app-information/export-compliance-documentation-for-encryption |
| **Build numbering** — version numbers are unique; iOS build numbers must be unique within a release train, and the same version legitimately carries many builds | https://developer.apple.com/library/archive/technotes/tn2420/_index.html |
| **Enterprise Program is not an App Store/TestFlight alternative** — internal distribution only, 100+ employees, explicitly excluded from App Store and TestFlight | https://developer.apple.com/programs/enterprise/ · https://help.apple.com/xcode/mac/current/en.lproj/devba5e7054d.html |

**Removed after re-verification.** An earlier revision of this document cited an April 2027
requirement (iOS 27 SDK, target iOS 15 or later). **The Upcoming Requirements page carries no
such entry as of 2026-10-08** — its SDK and target-OS entries are the 28 Apr 2026 and
9 Sep 2026 ones above. The claim came from a search summary rather than the primary source
and has been removed rather than restated.

**Everything marked `A` in [§B](#b-prerequisite-separation) is Apple's requirement.
Everything marked `P` is this project's own gate, about which Apple has no opinion.**
