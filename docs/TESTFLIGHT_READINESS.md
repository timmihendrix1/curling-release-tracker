# TestFlight Readiness

**Purpose.** One place that states what stands between this repository and an iOS build
distributed through Apple, keeps **Apple's requirements**, **this project's own gates**,
**technical findings** and **proposals** apart, and gives an ordered runbook for the work
that remains.

**What this document is not.** It is not authorisation to upload a build, invite a tester,
deploy the Web application, purchase membership, register an App ID, create any Apple
record, or install anything over the owner's existing installation. It resolves no open
product decision and grants no exception to an existing gate. Every runbook step is marked
**UNEXECUTED** unless the dated status amendment or a step explicitly records otherwise.

## Native review-access scope amendment — 2026-10-30

Normal iOS sign-in remains email-code only; normal Web choices remain email code
and Google. The approved narrow exception is an email/password review account
for Apple in the original native new-user beta, governed by
[Apple review access](APPLE_REVIEW_ACCESS.md). It grants no import, transfer or
fresh-email proof. Older “email-only” findings below describe ordinary sign-in and
their dated implementation evidence; they do not authorize general passwords.
Hosted configuration/provisioning, legal-policy clarification, physical-device
acceptance and Apple submission remain separate release gates. No legal version
or active legal-document pair is changed by this amendment.

## Beta-completion amendment — 2026-10-24

The local completion package implements in-app personal export and account deletion
with recent reauthentication, 30-day recovery, durable local denial, server denial,
controlled cancellation, due privileged finalization, anonymous shared references
and neutral notifications. ADR-0052 records the architecture; the confirmed product
decisions are in `BETA_COMPLETION_SPECIFICATION.md`. This replaces the historical
"missing" account-deletion findings below. The local completion package passed
independent review after corrections to durable denial, historical anonymization,
export completeness and stale identity callbacks. Hosted migration and worker
scheduling remain required; nothing has been applied to production.

The real local Team flow now covers OTP onboarding, creation, SMTP invitation,
acceptance, roster privacy, two-athlete recording, cloud restore and private notes.
Two production defects were corrected: listing other members' memberships as the
current user's Teams, and rejecting valid restored timestamps solely because
PostgREST formats the same instant differently. Raw payloads/digests stay intact.

New immutable legal pages dated 24 October cover the actual iOS/Brower/public-diagram
beta and deletion behavior. Old dated pages remain unchanged. A guarded transaction
prepares server publication only after the new pages have been deployed and reviewed.

The approved application-owned iOS Keychain reader locally distinguishes exact
item-not-found from failure. ADR-0049's amendment records its limitations. This
closes the iOS source/API evidence gap, not cross-store migration or physical
Keychain acceptance. Android remains closed. No storage flag, device installation,
signing, upload or distribution has been activated.

**Commercial beta boundary:** the closed beta stays free. Free basic raw history,
export and cloud restore require no Personal upgrade. Team membership remains a
separate workspace relationship; pilot creation grants are not subscriptions.
Billing, price/seat enforcement and the final Personal name are outside this beta.

**Beta readiness remains blocked** by actual operational configuration assignment, installed-device delivery acceptance,
protected installation-transfer integration/preservation and external-writer evidence,
operational source-retirement adoption,
remaining restore/discovery details in
MOBILE_APP_MIGRATION.md, physical iPhone/Brower acceptance, old-client coordination,
hosted release steps and Apple-side distribution/compliance. The local code package
does not waive these gates. Verification results appear at the end of this document.

## Current identity, account and local implementation status — updated 2026-10-22

The user confirmed **Evolane Curling / `me.evolane.curling`**, team **`J98U2J78B3`**,
Individual membership and primary **English (U.S.)**, with German deferred. Hermes reports
successful creation and read-back of the Explicit App ID and App Store Connect record
**`6825376799`**, SKU **`evolane-curling-ios`**. These are no longer open naming/account
questions. Local Debug/Release configuration is aligned under the separately approved
local-only package; registration is not evidence of an uploaded or distributable build.

The user reported the previous **`local.dev.curlingperformance`** test app running before
this change. That app is the preserved source, not the new target container. **Do not Run /
Cmd-R from the changed project on the owner's iPhone.** Local generation and an unsigned
Release compile are authorized; device installation, signing/provisioning changes, storage
activation and upload are not. Version/build remain `1.0`/`1`; upload uniqueness and a later
numbering policy must be checked before a separately authorized upload.

The iOS email-only choice is approved and implemented: Google and its separator are absent
on iOS, Web choices remain unchanged. The bounded UX corrections passed independent
component/Chromium review; physical iPhone/VoiceOver/OTP acceptance is still separate.
The migration's provenance design and dormant executor are approved. The separate pure
inactive S1 credential/reducer and S2 installation-transfer components are implemented,
locally tested and independently accepted; the separately reviewed Assessment date-test
follow-up, including fixture finding A1, is also complete. Their canonical status and
verification evidence are recorded in `MOBILE_APP_MIGRATION.md`, appendix “Adopted inactive
pure contracts — S1 and S2”, and the Assessment section of
`TECHNICAL_DEBT_AND_ROADMAP.md`. No production/native path is activated by these acceptances.
Credential absence/failure evidence, secure transfer, cross-store runtime behavior,
installation preservation and the remaining physical-device/Brower acceptance stay open.
An earlier Brower acknowledgement test failed once in an unchanged full run and passed
subsequent unchanged runs; its cause remains unestablished.

The original audit below is dated **2026-10-08**. Historical cache observations, old refs,
test counts, source-ID evidence and policy fetch dates are not current measurements. This
amendment and the updated P4 row in `MOBILE_APP_MIGRATION.md` supersede its former unknown
membership/identity state; this package does not revalidate every remaining release gate.

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
| **Can a release artifact be produced and uploaded?** | **Local preparation only.** Identity/account setup is confirmed as described above; local generation and unsigned compilation do not prove distribution signing, archive validation or permission to upload |
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

1. **Membership/account setup resolved for this stage:** Individual membership and team
   `J98U2J78B3`; successful Apps access and record creation reported by Hermes. See amendment.
2. **Explicit App ID and App Store Connect record created and read back by Hermes:**
   `me.evolane.curling`, record `6825376799`; this is not a signing/upload result.
3. **Export compliance is unresolved.** It does not block *uploading*; it blocks the
   uploaded build from being tested or distributed until answered ([§3](#3-release-build-readiness)).
4. **Guideline 5.1.1(v)** — in-app account deletion is locally implemented as of
   24 October; independent review, hosted activation and device acceptance remain.
5. **Guideline 4.8** — unresolved (open decision **P5**).
6. **The iOS Google dead-end UI is removed:** approved email-code-only iOS beta,
   Web choices unchanged. Real iPhone login/lifecycle acceptance remains open.

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

11. Identity is confirmed; version/build remain `1.0`/`1`. A later upload-numbering policy
    is separate and must not be inferred from this local identity change.
12. `SQLCipher.framework` ships in the default Release bundle although the default build
    composes no native storage.

---

## B. Prerequisite separation

Legend — **A** = Apple requirement; **P** = this project's gate.
Status — ✅ met · ❔ unknown (Apple-side state not inspected) · ⚠️ partial/unverified · ❌ not met.

### B.1 Technical prerequisites to produce and upload an artifact

| | Prerequisite | Status | Note |
| --- | --- | --- | --- |
| A | Apple Developer Program membership | ✅ account setup | Individual/team `J98U2J78B3`; user confirmation and Hermes-reported Apps access/record creation, 2026-10-21. Not a build-signing acceptance |
| A | A registered App ID and an App Store Connect app record | ✅ records | Hermes reports registration and read-back: Explicit `me.evolane.curling`, App Store Connect `6825376799`. No build uploaded |
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
| P | Stage **M3b4** migration protocol | Provenance design/decision core/dormant executor approved. Not activated; credential transfer, cross-store protocol, production binding and remaining recovery/engine acceptance still need their own evidence. Canonical inventory: `MOBILE_APP_MIGRATION.md` Stage M3b0 §7 |
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
| A | **In-app account deletion** (guideline 5.1.1(v)) | ⚠️ implemented locally; review/deployment/device gates open |
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

The unknowns in this historical subsection describe **2026-10-08**, not the account status
after the amendment above. All observations below are of **this Mac's local caches**, at the stated instant. They
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
| `appId` / `PRODUCT_BUNDLE_IDENTIFIER` | `me.evolane.curling` | Confirmed iOS target in Capacitor and Debug/Release; source installation retains `local.dev.curlingperformance` |
| `appName` / `CFBundleDisplayName` | `Evolane Curling` | Confirmed target display name; old installed source retains its historical name |
| `CFBundleName` | resolves to `App` (`PRODUCT_NAME = $(TARGET_NAME)`) | Template default; cosmetic |
| `MARKETING_VERSION` / `CURRENT_PROJECT_VERSION` | `1.0` / `1` | Template defaults. Valid for a first upload; **no numbering policy exists for later ones** |
| `IPHONEOS_DEPLOYMENT_TARGET` | `15.0` | Deliberate |
| `CODE_SIGN_STYLE` / `DEVELOPMENT_TEAM` | `Automatic` / `J98U2J78B3` | Local configuration only; this package creates no signing material |
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

**CSV export is not a backup/restore path.** `src/lib/export.ts` and
`src/lib/assessment/export.ts` build CSV strings only; those export flows provide no
matching backup-import UI or restore/persistence binding. The independently accepted
S2 raw archive codec is an inactive parser/format component, not an end-user import or
restore feature, and its raw validation does not prove domain usability. There is still
no complete installation backup/restore path to demonstrate. CSV export also covers no
Training Plan, tolerance profile or Smart Random profile at all.

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
| 1 | A complete, verified installation transition remains blocked. The adopted inactive pure transfer contract C1–C7 has an implemented, locally tested and independently accepted six-file S2 component; its code-review/final-evidence gate is closed. It remains unwired and is not a working backup/import feature. S3 discovery/Legacy-D observation, physical S4, runtime S5, protected delivery, fresh-auth mapping and device/restore evidence remain separate gates | `MOBILE_APP_MIGRATION.md`, appendix “Adopted inactive pure contracts — S1 and S2”, S2 |
| 2 | **Provenance design resolved**, decision core/executor approved but dormant. Production binding/activation and acceptance remain open; not an installation-transfer mechanism | ADR-0049; canonical Stage M3b0 §7 inventory |
| 3 | Missing-marker and generation cases follow approved P-1/P-2 policy; do not re-open the old generic design blocker. Real restore/engine evidence remains separate | ADR-0049; Stage M3b0 §7 |
| 4 | First-version blocked-state recovery is decided; no general repair/reset action. Remaining bounded recovery corrections and physical acceptance do not authorize data loss | Stage M3b0 §6–§7 |
| 5 | **S2:** secure transfer of the existing provider session out of WebView storage into the protected credential store | ADR-0049 amendment |
| 6 | **S2:** the cross-store interruption where one of the two separate stores is written and the other is not | ADR-0049 amendment |
| 7 | The approved app-owned iOS Keychain reader now supplies per-item evidence locally. Physical failure acceptance, credential transfer and activation remain open; Android still reports `no_absence_evidence` | ADR-0049 amendment, `S-P1` |
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
| **Native Google sign-in** | Native callback implementation still absent; **not offered on iOS**, per approved email-only beta. Web Google choice unchanged |
| Account switching | Implemented; automatically tested; **unverified on device** |
| Sign-out | Implemented; automatically tested |

**The former Google UI defect is corrected for the approved iOS beta.**
`IdentityGateScreen` conditionally omits the Google button and separator on iOS and makes
email-code submission primary, including shared reauthentication states. Web keeps its
existing choices. This is not an implementation of native Google callbacks; the remaining
Stage M2 design stays in `MOBILE_APP_MIGRATION.md` §6. Automated/component review does not
replace the target-build iPhone login/recovery acceptance or predict App Review.

### 4.2 Account deletion — guideline 5.1.1(v)

**Locally implemented, 2026-10-24.** Settings offers a separate account-deletion
entry through the existing identity authority, personal export, explicit confirmation,
30-day pending state and reauthenticated cancellation. The migration supplies the
privileged finalizer and narrow append-only purge exceptions. ADR-0052 is canonical.
This supersedes the audit's former "missing" finding; it does not establish hosted
activation, independent review or physical-device acceptance.

The app mandates account creation, so guideline 5.1.1(v) applies. ADR-0041's own
consequences list account deletion among the things still requiring legal review.

- **Public App Store release: implementation exists locally; release acceptance open.**
- **External TestFlight: in scope for Beta App Review**, since guideline 2.2 requires the
  beta to comply with the review guidelines.
- **Internal TestFlight: outside Apple's review**, which says nothing about whether the
  feature should exist.

### 4.3 Guideline 4.8 — open decision P5

**Scope note:** the approved first iOS beta offers only the application's email-code
system, not Google. The third-party-login discussion below applies to a future native
Google-enabled scope; it is not a demand to add Google/Apple login to this identity package.
P5's broader future policy is not decided here.

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

The approved current package is **only local identity alignment, native generation and
unsigned Release verification**, not every historical M6a proposal below. Encryption
classification, upload-numbering policy, archive/signing, installation and distribution
remain separate. The other stages show dependency order, not execution permission.

| Stage | Scope | Depends on | Acceptance |
| --- | --- | --- | --- |
| **O1** (owner) | **Account setup completed**, Individual/team `J98U2J78B3`, per user and Hermes reports | — | Record creation/access reported; not distribution-signing acceptance |
| **O2** (owner) | **Identity decided** in P4; export-compliance classification remains separate and unresolved | O1 | Name, ID, team and English language recorded; no encryption key guessed |
| **O3** (owner) | **Explicit App ID and App Store Connect record completed/read back by Hermes**, record `6825376799` | O1 and identity part of O2 | No build uploaded |
| **Local identity/compile subset of M6a** *(approved package; not full upload readiness)* | Confirmed name/ID/team in Capacitor, both Xcode target configurations and display name; tests/docs; fresh native generation and unsigned Release check. Keep version/build and product name unchanged. No encryption declaration, feature, auth, storage, entitlement or capability change | O2 identity decision | Actual root/mobile/static checks, generated-diff/hash comparison preserving the dirty tree, built identity/assets inspection, then independent review. Signing/archive/upload and broader M6a policy remain separate |
| **M6b — sign-in surface** | Approved iOS email-only UI locally implemented and independently reviewed; real-device acceptance remains open. Web sign-in choices preserved | Approved Google decision | No offered iOS Google dead end; target-build login/lifecycle evidence still required |
| **M6c — in-app account deletion** | Locally implemented under BETA_COMPLETION_SPECIFICATION.md and ADR-0052; review and hosted activation open | M6a | Real authorization/concurrency and end-to-end evidence; hosted finalizer, independent review and device acceptance before release |
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

**Steps remain UNEXECUTED unless explicitly marked or superseded by the dated amendment.**
Placeholders are written `<like-this>`. Steps marked **OWNER** need the owner's separate
approval; this runbook does not grant it.

**Scope limit, binding on the whole runbook:** no step here installs anything over the
owner's existing installation or over any device or account holding real training data.
Every device step is written for **disposable data**. Reaching the real installation
requires the preservation track in [§C](#c-smallest-remaining-task-sequence) and is outside
this runbook.

### D.0 Establish the facts — OWNER

1. **COMPLETED — OWNER/HERMES REPORTED (2026-10-21).** Individual membership and access
   established for team `J98U2J78B3`. Historical local profile lifetimes do not describe the
   membership's current status. No Tax/Banking setup or new agreement operation is implied.
2. **DECIDED — OWNER (2026-10-21).** P4 identity: `me.evolane.curling`,
   Evolane Curling, `J98U2J78B3`, English (U.S.); other P4 parts remain separate.
3. **UNEXECUTED — OWNER.** Decide the export-compliance classification for a bundle
   containing `SQLCipher.framework`, using Apple's three cases in
   [§3](#3-release-build-readiness).
4. **COMPLETED — HERMES REPORTED AND READ BACK (2026-10-21).** Explicit
   `me.evolane.curling`; App Store Connect `6825376799`, SKU `evolane-curling-ios`.
5. **UNEXECUTED — OWNER.** Establish deployment provenance for
   `https://curling.evolane.me` ([§5](#5-old-client-coordination)).

### D.1 Implementation

6. **LOCAL IDENTITY SUBSET IMPLEMENTED; VERIFICATION SEPARATE.** The approved package
   aligns configuration/tests/docs and permits native generation/unsigned compilation.
   Broader M6a upload policy, encryption classification and signed archive are not completed.

### D.2 Build and archive

7. **UNEXECUTED.** `npm ci`
8. **UNEXECUTED.** Ensure `NEXT_PUBLIC_NATIVE_API_ORIGIN` is set to the configured public
   origin through the ordinary `.env` mechanism. It is **inlined at build time**; a build
   without it denies every Team request. Never print or copy the environment file.
9. **UNEXECUTED.** `npm run mobile:build`
10. **LOCAL GENERATION ONLY, under the approved package.** `npm run ios:sync` — compare
    the actual diff and source-hash manifest with the pre-existing dirty tree; do not
    require a clean checkout, reset it, or claim an unchanged path list proves integrity.
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
19. **UNEXECUTED — OWNER.** Fill in **What to Test**. State explicitly: iOS uses email
    code only, Google is not offered there; local-only work is not covered by cloud synchronisation and the native
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

**1. Apple Developer Program membership — resolved for this stage.**
Individual/team `J98U2J78B3`, confirmed through the user/Hermes account-setup sequence.
Do not ask the owner to enrol or pay again. This is not archive/signing acceptance.

**2. Production bundle identifier and app name (P4).**
**Decided:** `me.evolane.curling` / Evolane Curling, team `J98U2J78B3`, English (U.S.).
Domain-shaped naming is a convention, not an Apple DNS-verification requirement.
**This is not a data-transfer decision:** the old `local.dev.curlingperformance` container
is not inherited. Full preservation remains the separate unsolved gate in §2.

**3. Export-compliance classification for a bundle shipping `SQLCipher.framework`.**
*No proposal on the legal answer.* Use Apple's three cases in
[§3](#3-release-build-readiness) and classify deliberately; a reflexive `NO` is not
appropriate for a bundle that links a non-OS encryption library. A second, separable option
is to remove the dependency from distribution builds while native storage is inert — that
is its own change with its own review surface and is **not** part of M6a.

**4. Google button on iOS — decided and locally implemented.**
For the first iOS club beta omit Google and its separator, make email-code submission
primary, preserve Web choices. Native Google callbacks remain deferred; real-device
acceptance and other login gates remain open.

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

## Local completion verification — 2026-10-25

The local beta-completion scope passed independent review, including its interaction
with the existing dormant native inventory. This does not retrospectively review
every unrelated pre-existing change, establish physical-device acceptance or grant
permission to release. The subsequent bounded S-P3 resource-ownership correction
also passed independent review; its final repository-wide rerun is recorded below.
The bounded S3a shared discovery boundary also passed independent design and code
review. It checks schema/control inventories before bootstrap, excludes simultaneous
ordinary handles, rechecks transactions/callbacks/B4 and preserves independent legacy
D/latch/warm-loss observations. Unknown credential/transfer tables refuse. This is
not a combined credential/domain executor or activation. The subsequent independently
reviewed S3b capability observes the exact combined SQL layout and atomically
initializes only a completely empty target. It exposes no legacy/ordinary target,
domain/Q progression, B4 or readiness authority. Final controls remain exact, opaque
errors preserve actual issuance knowledge, and failed cleanup/release blocks new
observation until positive reopen. The subsequent iOS
attribute-only namespace inventory passed independent design/code review; all
Security calls in its native tests were injected. It enumerates exact private
owned names but grants no exclusive-owner freshness or pairing authority.
S3c then adds one shared queue/opaque namespace lease across ordinary native stores
and an isolated dormant iOS immutable port. Ordinary calls refuse during migration;
complete inventory and uncached reads remain distinct, inserts never replace existing
bytes, and acknowledgement/readback/uncertainty are explicit. Its independently fixed
reentrancy gate prevents I/O after callback-triggered release. This proves cooperation
in one JS context only, not external-writer exclusion or a combined Q/D grant.
The subsequent S3d borrowed-domain runner passed independent design/code review.
It captures authentic native execution/lease evidence, pins retained child memory,
preserves positive warm faults progressively and promotes classified unknown
outcomes before holding. The existing plan prefix still executes; the actual
activation step is withheld. Genuine parent reopen is required for recovery, and
mid-collection uncertain open cleanup prevents a second native open. It exposes
only non-consumable records-only domain holds, not combined Q/D or app readiness.
S3e now also passed independent design/code review for held-only preparation over
one private combined SQL owner. Exact initialized schema and absent Q/F gate
normal work; private immutable one-shot permissions exclude active transactions.
Three corrected defect families preserve first fault/latch budgets, retain known
schema loss at every discovery entry including direct reinitialization, and bind
favorable control evidence to the actual read lifecycle. No Q progression,
protected-port correlation, finalizer, B4, runtime or app consumer is included.
The subsequent S3f common executor passed independent design/code review, including
its final shared platform-callback follow-up. It owns the actual shared source,
SQL context and protected lease, copies immutable M/I through all Q phases and
atomically binds Dactive/Qbound. Authentic held raw values, independent addressed
absences, progressive positive-fault retention and callback-free lifecycle controls
fence completion. Invalid metadata and unavailable dependencies remain distinct;
clean rollback resumes under actual new provenance. Its source-free bound branch
checks current addressed I forms, never historical mutable values. Only an opaque
completion candidate is returned: no ordinary store, SDK/Identity admission,
production binding, source cleanup, installation transfer or activation.
The subsequent S3g private runtime pair also passed independent design/code review.
It transfers the same held SQL connection and protected namespace once, without
reopening or rebinding them. Separate sticky domain/credential health, actual
transaction evidence, fresh current control checks and joined terminal cleanup
fence the pair. The old migration factory remains unchanged; application/SDK/Identity
admission, production mapping, installation transfer and operational source-retirement
adoption remain open. The separately reviewed S3i entry implements explicit dormant
retirement with genuine original-target/raw-subset proofs, cold cancellation/drain
ownership and a fresh empty publication fence. S3j hardens actual credential hash
invocation while preserving bytes/API/defaults. Neither adds an app consumer.
Separately reviewed S5a now owns dormant native AUTH mechanics over the actual
retirement/runtime pair, including whole-command serialization, causal SDK denial,
credential settlement, actual SEND fencing and joined cleanup. It has no production
caller or Identity admission. Separately reviewed S5b now composes the actual native
Identity coordinator, six repositories and four fixed public-schema Identity RPCs on
that same pair. Original operation/account binding, causal Self-session negatives,
actual native health and final materialized Request checks gate bootstrap readiness.
Separately reviewed S5c now binds the actual sporting mapper to genuine internal
Profile admissions, one shared SDK FIFO and original-input/Self/final-SEND fences.
S5d additionally binds actual account deletion/export, guard recovery and Provider
callbacks to the same private native owner. S5e adds dormant, construction-bound
Team-exercise data with exact immutable request plans and issued-sibling drain.
S5f adds all29 existing Team methods/five own-API POST routes with original
callback capture and separate ownership of reflected work. Current diagrams are
already public/bundled; restricted delivery is dormant/future. S5g binds actual local
base repositories, scoped outbox, retirement and personal export, with captured DTOs
and truthful actual ACKs. S5h adds one actual manager per admission, outer decorator/
argument ownership and separately drained background/listener work without making
local ACKs wait for cloud. Q1, earlier Tracker event/effect ownership, mounted Flow
polling/reload and app mounting remain open.

| Executed check | Result |
| --- | --- |
| `HERMES_S2_TEST_SCRATCH=/tmp/curling-beta-s2 npm test -- --maxWorkers=4` (including S5h dormant native manager/decorator ownership) | 330 files, 7,396 tests passed |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/curling-beta-playwright npm run test:e2e` (official local reset/seed preflight) | 139 tests passed, including deletion/export/OTP cancellation/reload and real Team/SMTP/cloud/private-note isolation |
| Installed `supabase` CLI 2.115.0: `supabase db reset --local --no-seed` then `supabase test db` | 6 files, 518 assertions passed; independently repeated |
| `python3 scripts/test_account_deletion_concurrency.py` after a fresh no-seed reset | Six live multi-connection scenarios passed, with observed advisory-lock waits: the four original scenarios plus late deletion request after concurrent cancellation and after conditional recovery fence; independently repeated |
| `python3 scripts/test_beta_release_steps.py` on the fresh local database | Seven guarded legal-publication and scheduler cases passed; all transactions rolled back, no job or Legal pair activated; independently repeated |
| `PLAYWRIGHT_BROWSERS_PATH=/tmp/curling-beta-playwright npm run mobile:verify` | Mobile typecheck/build passed; 10 test files, 276 tests passed |
| `npm run ios:test:keychain-reader` | 491 injected Security-API contract assertions passed; no actual Keychain/device claim |
| Earlier `npm run ios:sync`; current unsigned generic-iOS Release `xcodebuild` | BUILD SUCCEEDED; derived data `/tmp/curling-beta-ios-derived`; no installation/signing/archive/upload |
| `npm run build`, then `npx tsc --noEmit` after the dev server stopped | Passed; old and new legal routes generated |
| `npm run lint`, `npm run mobile:lint`, `git diff --check` | Passed |
| Independent S5h dormant native manager/decorator design/code review | Clean;15 focused files /696 tests and7 own counterprobes passed; genuine single manager, separate lane/ACK ownership, snapshot/listener isolation and failure drain checked; no App/Q1/device claim |
| Independent S5g dormant local sporting design/code review after correction | Clean;11 focused files /620 tests and7 own counterprobes passed; TypeScript/focused ESLint/diff exit0; no manager/App/Q1/device claim |
| Independent S5f dormant Team-foundation/own-API design/code review after corrections | Clean;10 focused files /566 tests and34 own probes passed. Original query graph/subject, declared callback capture, independent plain-root eligibility, separate root/reflected work drain and final REST/HTTP confinement checked; no app/device claim |
| Independent S5e dormant Team-exercise design/code review | Clean; 28 focused files / 853 tests and five own probes passed. Exact original intent/capture, seven overlapping reads, no retries, sealed old closures, aggregate failure/FIFO sibling drain and genuine Self denial checked; no app/device claim |
| Independent S5d dormant account-control design/code review after corrections | Clean; 25 focused files / 765 tests plus 8 own probes passed. Actual continuation versus factual proofs, callback settlement, guard cancellation, Provider callbacks and pending cancellation checked; no mounted Flow/device claim |
| Independent S5c dormant sporting design/code review after correction | Clean; 22 focused files / 692 tests plus 9 own probes passed. Actual admission, original capture, shared FIFO, exact SEND and genuine full denial completion checked; no app/device claim |
| Independent S5b dormant Identity-bootstrap design/code review after corrections | Clean; 19 focused files / 609 tests plus 16 own probes passed (one SDK-internal exploratory case excluded). Original startup currency, real Profile negative handling, final Request/body/header confinement, captured clock and observed work/drain passed; no app or device claim |
| Independent S-P3 resource-ownership review | Clean; 2 focused files / 66 tests, plus 6 actual-adapter close cases |
| Independent physical-slot/platform-fingerprint design/code review | Clean; 3 focused files / 87 tests plus 3 independent adversarial probes, including 1,040 slot combinations and cross-realm buffer/encoder checks; no application consumers |
| Independent iOS namespace-inventory design/code review | Clean; 1 TS file / 15 tests and 491 injected native assertions; no exclusive-owner freshness or device claim |
| Independent D deletion-control inventory review after correction | Clean; 6 focused files / 294 tests plus 10 independent probes; initial whole-list refusal now precedes source values/digests |
| Independent inert SDK settlement review after correction | Clean; 6 focused files / 147 tests plus 8 independent probes; result-shape faults latch before external post-health callbacks |
| Independent S3c protected namespace/immutable-port review after correction | Clean; 10 focused/SDK/composition/binding files / 301 tests plus 11 independent probes; only cooperating same-context exclusion, no physical freshness or handoff grant |
| Independent S3d borrowed-domain review after correction | Clean; 13 focused/legacy/ownership files / 586 tests plus 14 independent adversarial probes. Five defects fixed: progressive warm-fault retention, unknown after-state promotion, preserved plan prefix, immediate callback fences and borrowed task-entry readiness. No combined owner/finalizer or readiness grant |
| Independent S3f common executor review after correction | Clean; 7 focused/legacy/ownership files / 438 tests, 30 independent correctness probes and 8 callback/digest rejection probes. Final platform-wrapper follow-up: owner/architecture 214 tests plus 4 independent native/masked second-call probes passed. No runtime handoff or activation grant |
| Independent S3i dormant source-retirement review after correction | Clean; 7 combined focused files / 620 tests and 16 own S3i probes. Cold capture/cancellation/drain, actual absence receipts, raw subset and final publication fences passed. Older factories unchanged; no actual-user cleanup |
| Independent S3j credential fingerprint invocation review | Clean; 3 own probes plus the combined 620-test focus. Actual encoder/digest receivers use intrinsic invocation; 12 permanent hostile binding cases added, retaining API/bytes/defaults |
| Independent S3h standard domain fingerprint review after correction | Clean; 4 focused files / 363 tests and 8 independent probes. Actual operations/receivers use intrinsic invocation; 37 new helper cases and the F-COMMIT acknowledgement regression passed. No default or app caller |
| Independent S4a explicit pure archive v2 review | Clean; 6 focused files / 253 tests and 13 independent probes, including maximum combined dynamic membership (934 slots), exact aggregate raw boundaries, correlation and late fingerprint failure. V1 unchanged; no operational transfer/admission |
| Independent S3g private runtime review after correction | Clean; 5 focused files / 623 tests and 7 independent probe files / 59 probes, with zero unhandled errors. Current controls, typed bridge evidence, sticky failure, SDK settlement experiments and joined cleanup passed. No application admission or activation grant |
| Independent S3e combined held SQL-host review after correction | Clean; 14 focused/legacy/ownership files / 670 tests plus 24 independent correctness probes. Three defect families fixed, including the initializer's direct schema-loss route. No Q progression/finalizer or readiness grant |
| Independent S3b private SQL inventory/schema review after correction | Clean; 8 focused/legacy/ownership files / 397 tests plus 13 independent probes; no domain/Q progression or readiness grant |
| Independent S3a design/code review after correction | Clean; 4 focused files / 175 tests and the reviewer's original real-SQLite Unicode reproduction passed |

The full browser suite was repeated after S5h independent acceptance
and passed on the final source state. The dormant
native modules have no browser startup consumers.
The 239 S3g runtime cases include real disposable Python SQLite, protected bridge
faults and installed-SDK settlement experiments over the actual private pair. SDK
transport was stubbed and automatic refresh stopped; this is not a production SDK owner.
The 142 S3f owner cases and 84 S3e cases use real disposable Python SQLite with source-derived
installed iOS/Android plugin preprocessing and explicitly injected bridge faults.
This does not prove physical Capacitor durability or real external-writer races.
Four earlier disposable Python SQLite cases prove only local engine/adapter
compatibility for D1, copy-to-verified holds, reopen and combined-schema refusal;
the remaining new S3d tests use the injected installed-plugin statement model.

The SQL/concurrency/release-step checks ran on the dedicated CLI container
`supabase_db_curling-release-mvp`. They do not attest staging or production.
S3a includes nine real disposable SQLite cases for schema, trigger/index/view
refusal, exact values and Unicode key ordering across close/reopen. Python stdlib
SQLite is engine evidence, not the installed Capacitor bridge or a physical iPhone.
The full browser suite also emits existing chart-layout warnings; those warnings
did not fail tests and are not physical iPhone/Brower evidence. The mobile bridge
failure semantics still need actual-device evidence despite the native contract tests.

Changed scope: new legal components/routes and guarded publication; account-deletion
domain/service/runtime/provider/UI, personal export projection, Team notification,
migration and guarded scheduler; the Team membership/timestamp restore corrections;
read-only Swift Keychain bridge plus existing binding/configuration; local OTP/SMTP
test infrastructure, regression tests and the relevant decision/readiness documents.
Subsequent bounded work adds attribute-only Keychain inventory, inert physical-slot/SHA bindings, opaque D transfer of deletion controls, and an inert SDK storage-fault adapter with real installed-SDK compatibility experiments. No billing, tariff gate, native activation flag or source-installation transfer was enabled.

Git began on `main`, HEAD/local main/local origin-main reference
`382ee40d37605b302c11b6390305857c7e2c3fde`, with zero staged files and substantial
pre-existing work (28 modified, 50 untracked). Independent-review corrections began
at 57 modified and 78 untracked files. After beta corrections and S-P3 the same
refs and zero staged files remain, with 65 modified and 85 untracked files after
S3a, and 66 modified / 111 untracked after the inventory, D extension, inert SDK bindings, S3b–S3j private storage/binding slices and explicit S4a archive extension, including the pre-existing native work and separately updated collaboration
instructions. S5a adds the auth-service changes and one host test file, resulting
in 67 modified / 112 untracked individual files, still with zero staged files and
the same refs. Separate test fixtures use distinct synthetic database names; no
production database name or storage-selection flag was changed.
No stage/commit/amend/merge/rebase/push/fetch/PR operation occurred.

Remaining release gates are the amendment's native runtime/installation preservation
and device acceptance, staging then
production migration/worker/Legal publication, and Apple distribution/compliance.
S3a closes the bounded legacy discovery conflict; S3b closes its private SQL
structure/empty-bootstrap prerequisite; S3e joins held-only domain preparation
under one private combined SQL host; S3f adds local cross-store copying and atomic
Q/D binding with an internal completion candidate; S3g transfers that private ownership
to an inert runtime pair. Actual application/SDK/Identity ownership and admission,
production bindings, physical/external-context namespace freshness, operational protected
installation transfer with semantic compatibility and same-epoch restore Q4 remain open.
S4a closes the pure archive deletion-control inventory gap through explicit V2 entries;
it does not implement operational fingerprint binding, protection/delivery or admission.
S3h supplies the standalone standard domain hash helper, preserving existing injections;
actual registry-bound composition and WebView availability remain open.
The user resolved retention Q3 on 24 October: remove the old credential copy
after fully verified transfer; preserve it if transfer/verification fails. The
explicit dormant S3i retirement protocol and implementation are independently
accepted: full original-target/raw-subset proof before destructive work, honest
interruption receipts, cold cancellation/drain ownership and a final fresh empty
fence. S3j hardens the existing credential fingerprint invocation, retaining bytes
and defaults. Operational writer exclusion/SDK adoption remain open; no actual
user credential has been removed. Q4 was not approved: the user requested a clearer explanation; concrete device/release acceptance is deferred and does not block local implementation. See BETA_COMPLETION_SPECIFICATION.md.

**Hosted grant verification is mandatory.** A reviewer reset using CLI 2.122.0
(rather than installed 2.115.0) exposed 15 existing grant assertions that fail under
its different explicit-role/default-privilege baseline. Resetting with installed
2.115.0 restored the passing result above. Before hosted release, inspect actual
default privileges and effective browser-role EXECUTE grants, especially operational
Team Admin recovery, and harden explicit-role grants transactionally. Revoking only
PUBLIC may leave an explicit role grant effective. The local version-specific pass
does not prove hosted grants are safe; no hosted inspection or hardening has run.

### S3g runtime handoff — accepted bounded local implementation

Independent final code review passed on 25 October after all corrections. The
separate dormant runtime entry prepares a pair over the actual S3f-held SQL
connection and protected namespace. Current domain values and addressed current I
envelopes remain mutable; protocol contradictions fault both sides, while ordinary
credential failures leave healthy domain storage available. Disposal synchronously
revokes fault-write authority and retains reservations until both actual cleanup
receipts are confirmed. First unverified transaction evidence remains available.

Fixed bridge fields are type-checked before further foreign reads, directly observed
malformed asynchronous values are owned after revocation, unavailable SQL evidence
is distinct from positive protocol corruption, and exact void cleanup acknowledgements
are required. No remaining material S3g findings or unhandled errors were reported.

The final source passed 317 root files / 6,661 tests, 139 browser cases, 10 mobile
files / 276 tests, TypeScript, root/mobile ESLint, Web/mobile builds and diff checks.
Independent review passed 5 focused files / 623 tests plus 7 own probe files / 59
probes. These results supersede the intermediate failed runs; they do not establish
physical Keychain durability, external-writer freshness or application admission.
No application caller, native activation, source removal, operational installation
transfer, physical-device action or release was added.

Final evidence: `/tmp/curling-s3g-root-accepted-final.log`,
`/tmp/curling-s3g-e2e-accepted-final.log`,
`/tmp/curling-s3g-mobile-accepted-final.log`,
`/tmp/curling-s3g-tsc-accepted-final.log`,
`/tmp/curling-s3g-lint-accepted-final.log`,
`/tmp/curling-s3g-mobile-lint-accepted-final.log`,
`/tmp/curling-s3g-web-accepted-final.log`,
`/tmp/curling-independent-review/s3g-final-accepted-focus.log` and
`/tmp/curling-independent-review/s3g-final-accepted-own.log`.

### S4a explicit archive v2 — accepted bounded local implementation

Independent design and code reviews passed on 25 October. Three explicit V2
entries add complete dynamic guard/resolution inventory and strict closed archival
forms, exact source bytes, key/operation/revision correlation, version-bound raw
admission and separate typed digest domains. Unresolved guards, orphan receipts
and old operations remain inert archive data; they create no sporting Profile or
identity admission. V1 entries, goldens, refusal behavior and Decision are unchanged.

The final full baseline is the table above. The new test file contains 64 cases;
the independent review also exercised combined 934-slot membership and exact raw
boundaries. No material findings or unhandled errors remain. The format still uses
an explicit injected fingerprint test contract. Operational production fingerprint
binding, protected transfer, semantic compatibility and reauthentication/publication
are separate unfinished stages. No source removal, app/SDK admission, device action
or activation was added.

Evidence: `/tmp/curling-s4a-root-final.log`, `/tmp/curling-s4a-e2e-final.log`,
`/tmp/curling-s4a-mobile-final.log`, `/tmp/curling-s4a-tsc-final.log`,
`/tmp/curling-s4a-lint-final.log`, `/tmp/curling-s4a-mobile-lint-final.log`,
`/tmp/curling-s4a-web-final.log`,
`/tmp/curling-independent-review/s4a-focus.log` and
`/tmp/curling-independent-review/s4a-own.log`.

### S3h domain fingerprint helper — accepted bounded local implementation

Independent design and corrected code reviews passed. The dormant standalone
helper captures actual standard Encoder/WebCrypto operations with their receivers
through intrinsic invocation, without reading supplied bind/call/apply properties.
It fingerprints exact JSON-framed domain raw values with SHA-256, adding no data
cap, default, source/target/SDK consumer or resource authority. A separate existing
runtime test waits for actual F-COMMIT acknowledgement before its unchanged F-row
assertion, replacing a timing-dependent 20ms delay and excluding uncommitted reads.

The controlled final baseline is the table above. Independent final review passed
4 focused files / 363 tests and 8 own probes, TypeScript, focused ESLint and diff
checks. Earlier Parent fixed-delay and concurrent architecture-timeout runs failed;
they are superseded by the final 319-file pass, never counted as green baselines.
The final Web/Mobile builds and browser run follow the intrinsic-capture correction
on the frozen source; final TypeScript ran after the browser server stopped.

No native activation, credential removal, installation, actual Keychain, hosted
action or release occurred. Config registry/rotation semantics, complete SDK-call/
send ownership, operational transfer and Q3 retirement remain open. This helper
does not choose an operational contract for the injected transfer formats.

Evidence: `/tmp/curling-s3h-root-verified-final.log`,
`/tmp/curling-s3h-e2e-verified-final.log`, `/tmp/curling-s3h-mobile-verified-final.log`,
`/tmp/curling-s3h-web-verified-final.log`, `/tmp/curling-s3h-tsc-verified-final.log`,
`/tmp/curling-s3h-lint-verified-final.log`, `/tmp/curling-s3h-mobile-lint-verified-final.log`,
`/tmp/curling-independent-review/s3h-final-focus.log` and
`/tmp/curling-independent-review/s3h-own-corrected.log`.


### S3i/S3j — accepted dormant source retirement and hash invocation

Both bounded slices passed independent DESIGN and corrected CODE review. S3i adds
one explicit retirement owner; the older Migration/Runtime entry points keep their
exact shapes and source-free behavior. Destructive cleanup requires a complete
fresh original protected target and actual raw source subset. Empty-source admission
permits ordinary mutable target contents and makes no historical deletion claim.
Cold ownership precedes global/method/length reflection; observed malformed async
work stays held through drain. Actual required-key absence receipts survive later
aggregate failure without granting a source proof. Every own remove invalidates
older source evidence; the last actual empty fence follows mutable dependency
capture immediately before private joint publication.

S3j corrects the reproduced supplied-bind redirection in the existing credential
hash helper. It captures actual functions/receivers and invokes them intrinsically,
retaining exact tuple bytes, SHA-256, budgets, errors, public API and defaults.
The final independent combined focus passed 7 files / 620 tests, with 16 own S3i
and 3 own S3j probes. The 88 new retirement cases use real disposable SQLite and
injected WebView/protected stores. Twelve permanent hash regressions cover own
bind/call/apply redirects and throwing getters. No unhandled error remained.

The controlled final baseline passed 320 files / 6,864 root tests, 139 browser cases,
10 mobile files / 276 tests, Web/Mobile builds, TypeScript after the browser server
stopped, root/mobile ESLint and diff checking. Earlier failing cold-capture/receipt
probes are superseded by actual corrected passes; they were never green evidence.
Native/SQL schema and protocol formats were unchanged; earlier database/native
contract evidence above was not rerun or broadened by these two TypeScript slices.

No actual user credential, Keychain/device, hosted state, activation, installation,
Git publication or release was touched. Same-context exclusion is not external
writer exclusion. Complete SDK/app ownership, actual config assignment/rotation,
protected operational installation transfer and physical/release gates remain open.
A separate read-only next-stage preflight passed two public SDK probes (lazy
initialization/channel cleanup and eager data-client token access), not an SDK owner.

Evidence: `/tmp/curling-s3i-s3j-root-verified-final.log`,
`/tmp/curling-s3i-s3j-e2e-verified-final.log`,
`/tmp/curling-s3i-s3j-mobile-verified-final.log`,
`/tmp/curling-s3i-s3j-web-verified-final.log`,
`/tmp/curling-s3i-s3j-tsc-verified-final.log`,
`/tmp/curling-s3i-s3j-lint-verified-final.log`,
`/tmp/curling-s3i-s3j-mobile-lint-verified-final.log`,
`/tmp/curling-independent-review/s3i-s3j-focus-final.log`,
`/tmp/curling-independent-review/s3i-own-final.log`,
`/tmp/curling-independent-review/s3j-own.log` and
`/tmp/curling-native-auth-host-preflight.log`.


### S5a — accepted dormant native AUTH ownership

Independent DESIGN and corrected CODE review passed on 25 October. The explicit
host reserves the actual SDK slot before foreign capture, internally runs the
actual retirement/handoff, and keeps pair, protected credentials and standalone
public AuthClient private. Whole normalized commands share one FIFO; sign-out
revokes old publication/SEND immediately while preserving only genuine old-command
storage drain. Disposal immediately cancels the current actual owner and joins
issued work/cleanup before releasing ownership. Provider readiness grants no app
or Identity access.

The review reproduced and corrected delayed owner cancellation, lost directly
observed malformed async work, callback publication races, proactive-session
misclassification, forgotten initial cleanup failure and misleading fault labels.
Adjacent probes also exposed a plausible-fields Promise used as a Request and
observer aliasing of result identity; intrinsic native Request brand checks and
detached frozen observations now close those paths. Final independent evidence:
4 focused files / 244 tests and 16 own probes passed. The permanent host file adds
72 cases using actual installed public AuthClient, disposable SQLite and injected
protected/WebView stores with stubbed transport. No actual account or Keychain used.

The controlled final baseline passed 321 files / 6,937 root tests; 139 browser
cases; 10 mobile files / 276 tests; Web/Mobile builds; final TypeScript after the
browser server stopped; root/mobile ESLint; and diff checking. SQL schemas/native
sources/protocol formats were unchanged; earlier SQL and native contract results
above were not rerun or broadened. Existing chart/chunk warnings did not fail checks.

The SDK public disposal result is an API receipt, not independent physical proof
of DOM listener removal. No app caller, data-only SDK, Team/data final-SEND grant,
Identity/training admission, actual configuration assignment/rotation, operational
installation transfer, external writer exclusion, activation, device/signing/hosted/
publication or release action is included. Q4 remains unapproved and deferred to
concrete device/release acceptance. The next integration must replace the remaining
browser-client consumers as one coherent owned native composition before mounting.

Evidence: `/tmp/curling-s5a-root-final.log`, `/tmp/curling-s5a-e2e-final.log`,
`/tmp/curling-s5a-mobile-final.log`, `/tmp/curling-s5a-web-final.log`,
`/tmp/curling-s5a-tsc-final.log`, `/tmp/curling-s5a-lint-final.log`,
`/tmp/curling-s5a-mobile-lint-final.log`,
`/tmp/curling-independent-review/s5a-final-focused.log`,
`/tmp/curling-independent-review/s5a-final-own.log`,
`/tmp/curling-independent-review/s5a-final-tsc.log`,
`/tmp/curling-independent-review/s5a-final-lint.log` and
`/tmp/curling-independent-review/s5a-final-diffcheck.log`.


### S5b — accepted dormant native Identity bootstrap

Independent DESIGN and corrected CODE review passed on 25 October. The explicit
native bootstrap factory internally reuses the same S5a retirement/runtime resources,
constructs the actual coordinator and six Identity repositories on the retained SQL
connection, and keeps the official public PostgREST client private. Only the four
existing Identity RPCs are supported. Public Legal remains anonymous-capable; Self
RPCs require the actual current provider account and original coordinator context.
Actual native health vetoes new online/offline readiness and required trusted writes.

Corrections preserve validated background Profile negatives for the real existing
invalidation path, prevent cached startup readiness after sign-out or supersession,
validate the final actual Request's exact route/body/headers/options after the last
constructor and completed body, and own malformed required primitives and returned
acknowledgements through actual drain. Native deep-link capture uses the genuine
captured clock and never cleans the URL on an unconfirmed clock. Exact already-owned
disposal is excluded from its own prerequisites; unknown wrapped Promise dependency
graphs remain C4 provider prerequisites. Results/observers stay detached and frozen.

Independent evidence: 19 focused files / 609 tests and 16 own probes passed; one
unobservable SDK-internal exploratory case remains excluded, not a defect or passed
claim. The 85 permanent bootstrap cases use actual installed Auth/PostgREST clients,
real disposable SQLite, injected protected/WebView stores and simulated transport.
A masked acknowledgement test now uses a plain provider replacement because Vitest's
spy wrapper itself reads Promise.then before returning it; the actual host-observation
boundary is tested directly, including independent field and acknowledgement drains.

The final controlled baseline passed 322 files / 7,023 root tests; 139 browser cases;
10 mobile files / 276 tests; Web/Mobile builds; final TypeScript after the test server
stopped; both ESLint scripts; and diff checking. Chromium required the existing
approved execution outside the sandbox. Existing chart/chunk warnings remain nonfatal.
No native/SQL schema or protocol changes were made in S5b; previous SQL/Swift/iOS
contract results above were not rerun or broadened. No actual account/Keychain/device,
physical durability or external-writer proof is claimed.

The final bounded tree remains main/HEAD/local-main/origin-main
382ee40d37605b302c11b6390305857c7e2c3fde, 0 staged /70 modified /113 untracked individual
files, including all pre-existing work. No Git mutation or publication occurred.
The new entry has no app caller. Remaining native account-deletion/sporting/Team and
restricted HTTP/assets, genuine Q1 already-admitted training continuation, application
composition/callback delivery, actual config assignment/rotation, protected operational
installation preservation and external-writer exclusion precede physical/release
acceptance. Q4 stays unapproved/deferred. Free pilot and no billing remain unchanged;
Team membership does not grant Personal. This is not beta activation or release.

Evidence: `/tmp/curling-s5b-root-final.log`, `/tmp/curling-s5b-e2e-final.log`,
`/tmp/curling-s5b-mobile-final.log`, `/tmp/curling-s5b-web-final.log`,
`/tmp/curling-s5b-tsc-final.log`, `/tmp/curling-s5b-lint-final.log`,
`/tmp/curling-s5b-mobile-lint-final.log`, `/tmp/curling-s5b-diff-final.log`,
`/tmp/curling-independent-review/s5b-accepted-focused.log`,
`/tmp/curling-independent-review/s5b-accepted-own.log`.


### S5c — accepted dormant native sporting Identity host

Independently DESIGN and corrected CODE accepted on 25 October 2026. The explicit
createNativeSportingIdentityHost entry reuses the actual private S5a/S5b pair, SDK
and coordinator. Its frozen typed sporting services capture one genuine original
Profile admission forever; a caller Profile merely selects it. Actual foreground
ownership, definitive denial and close revoke it synchronously. Healthy background
revalidation confirms the existing cell only; old services never revive after a
same-Profile login. No public grant, raw SDK/store/token or generic runner escapes.

The existing sporting mapper remains sole parser and the real SyncManager retains
outbox/conflict ownership. Each command owns synchronous original scalar capture,
one actual SDK getSession, actual same-account/Profile/completion Self preflight,
one fixed sporting RPC and final materialized Request/body/SEND verification on
the shared FIFO. Actual Session/Self denial invokes the genuine conditional
coordinator invalidator only after FIFO release; the full actual completion and
residue are delivered. Ordinary sporting forbidden is not identity-wide denial.

The independent correction stops subsequent getters after capture itself revokes
admission, while retaining the pending/rejected/masked work already returned by
the cancelling getter and the exact own-disposal exception. Existing malformed
capture, unrelated active-command isolation and original-input semantics remain.
There are 70 permanent host regressions, using the actual installed SDK, disposable
real SQLite and injected synthetic stores/transport; the real old SyncManager
retains its pending outbox across a later admission. Its separate test adapter
expressly does not prove native application repository composition.

Independent verification passed 22 focused files / 692 tests and 9 own probes.
Parent focused verification passed 47 files / 1,185 tests. Final full baseline:
323 root files / 7,094 tests; 139 browser cases; 10 mobile files / 276 tests;
Web/Mobile builds, post-server TypeScript, both ESLint scripts and diff checking.
Existing chart/chunk warnings remained nonfatal. Chromium used the approved
execution outside the sandbox. No SQL/native schema or protocol was changed;
earlier SQL/Swift/iOS results were not rerun or broadened.

Unchanged main/HEAD/local-main/origin-main
382ee40d37605b302c11b6390305857c7e2c3fde; 0 staged /71 modified /114 untracked individual
files. No Git mutation, actual account/Keychain, device/signing/install, hosted or
publication action. Account-deletion continuation, Team/TeamExercise/HTTP/assets,
local sporting composition, genuine original training/save Q1, app/callback and
actual configuration binding/rotation, protected operational installation transfer,
external writer exclusion and physical/release acceptance remain separate. Q4 is
unapproved/deferred. Free pilot/no billing and Team separate from Personal remain.

Evidence: `/tmp/curling-s5c-root-final.log`, `/tmp/curling-s5c-e2e-final.log`,
`/tmp/curling-s5c-mobile-final.log`, `/tmp/curling-s5c-web-final.log`,
`/tmp/curling-s5c-tsc-final.log`, `/tmp/curling-s5c-lint-final.log`,
`/tmp/curling-s5c-mobile-lint-final.log`, `/tmp/curling-s5c-diff-final.log`,
`/tmp/curling-independent-review/s5c-corrected-focused.log`,
`/tmp/curling-independent-review/s5c-corrected-architecture.log`,
`/tmp/curling-independent-review/s5c-own-final.log`.


### S5d — accepted dormant native account deletion and export

Independently DESIGN and corrected CODE accepted on 25 October 2026. The existing
native sporting host now supplies the actual account-deletion mapper and guard
repository over the same private pair/coordinator/SDK. Ordinary request/export
needs original admitted Self; blocked state/cancel uses actual authenticated Self
and actual mapper-validated control. No callback ACK, caller selector, public denial
outcome or later generation creates permission.

An actual successful own denial supplies only its original operation/installed-epoch
continuation. Current positive pending publication uses a separate factual proof;
a failed denial forbids further effects without erasing that actual current fact.
A final actual blocked-OTP witness preserves correlation for cancellation/retry;
null admission alone supplies no witness. Actual own barrier notifications do not
invent epochs; other or malformed barriers remain effective. Guard adapters recheck
the original scope after awaits and before every actual read/write. The existing
mapper retains request exclusion, nonce/revision ordering, cancel and export policy.

Three independent P2 findings are fixed: overtaken attribution cannot fabricate a
durable-denial marker; actual settled callback values remain owned even with a
masked Promise; and failed-denial effect refusal does not erase a current positive
pending fact. Permanent cases include all five original reviewer probes and six
adjacent cases. There are 54 native account-host cases and two actual Provider
callback cases. They use installed public SDKs, disposable real SQLite and synthetic
protected/network dependencies. Provider tests preserve real callbacks but use a
render-only Flow wrapper; mounted Flow polling/reload is still an app-composition
gate, including full native invalidation subscription.

Independent corrected verification: 25 focused files / 765 tests and eight own
probes. Parent corrected focus: 81 files / 1,939 tests. Final complete baseline:
325 root files / 7,151 tests; 139 browser cases; 10 mobile files / 276 tests;
Web/Mobile builds, post-server TypeScript, both lint scripts and diff checking.
Known chart/chunk warnings remained nonfatal; approved Chromium execution was
outside the sandbox. No schema/protocol/native-source change; earlier SQL/Swift/
iOS results were not rerun or broadened.

Unchanged main/HEAD/local-main/origin-main
382ee40d37605b302c11b6390305857c7e2c3fde; 0 staged /71 modified /116 untracked individual
files. All prior changes remain unstaged/uncommitted. No actual account/Keychain,
device/signing/install, hosted or distribution action. Native Team/TeamExercise/
HTTP/assets, local sporting/Q1 and app/callback composition, actual configuration
binding/rotation, protected operational installation transfer/external-writer
exclusion and physical/hosted/Apple acceptance remain open. Q4 is unapproved and
deferred. Free pilot/no billing and Team separate from Personal remain unchanged.

Evidence: `/tmp/curling-s5d-root-final.log`, `/tmp/curling-s5d-e2e-final.log`,
`/tmp/curling-s5d-mobile-final.log`, `/tmp/curling-s5d-web-final.log`,
`/tmp/curling-s5d-tsc-final.log`, `/tmp/curling-s5d-lint-final.log`,
`/tmp/curling-s5d-mobile-lint-final.log`, `/tmp/curling-s5d-diff-final.log`,
`/tmp/curling-s5d-corrected-final-focus.log`,
`/tmp/curling-independent-review/s5d-corrected-focused-code.log`,
`/tmp/curling-independent-review/s5d-own-accepted.log`.


### S5e — accepted dormant native Team-exercise data

Independently DESIGN and CODE accepted on 25 October 2026. The existing native
sporting runtime adds createTeamExerciseCloudService, permanently bound to a genuine
original admitted Profile/completion. Nine typed existing methods reuse one actual
private AUTH SDK/pair/coordinator/FIFO and the same actual Self preflight as personal
sporting. The actual Team-exercise mapper remains sole parser and its port narrows
to Pick<SupabaseClient,'from'|'rpc'>. Actual server/RLS still authorizes every athlete.

A private real public PostgrestClient per command uses retry:false and a fetch
closure permanently bound to that exact command and immutable wire plan. This
creates no additional AuthClient, storage handle or eager request. The installed
SDK's default automatic GET retries were independently reproduced; those apply
neither to this new transport nor to its mutation paths. Existing Web/Identity/
sporting/deletion clients remain unchanged.

Each of the seven genuinely concurrent reads retains its own exact relation/query/
method/body/header intent through final Request materialization. Duplicate intent
consumption, query parameters, schema/range/filters, constructor retargeting and
late old closures refuse. Issued work registers before foreign callbacks; unused
intents seal when mapping settles and all actual siblings drain before FIFO release.
A newer identical request cannot adopt an old fetch. Declared inputs snapshot exact
scalar bytes and own indexed arrays before waits; no caller iterator/array method,
hole/prototype substitution, later alias change or revoking getter supplies input.
Directly observed masked/rejected work and exact own disposal retain prior ownership.

45 permanent host regressions use actual installed SDKs/disposable real SQLite and
synthetic stores/transport. They cover all nine methods, seven overlapping real
GETs, no retries, early aggregate failure with six issued siblings, late closure,
actual Request retargeting, original arrays, malformed active-command isolation,
actual Self denial/full failure residue, ordinary Team errors and directly observed
header/body cleanup. A real SyncManager retains its pending Team outbox through
same-Profile reauthentication; the separate injected local adapter is not native
application repository-composition evidence. Architecture guards now confine the
exact eight relations/seven RPCs, imports and runtime binding.

Independent verification: 28 focused files / 853 tests and five own probes, plus
TypeScript/focused ESLint/diff exit 0. Parent focus: 75 files / 1,942 tests.
Final full baseline: 326 root files / 7,197 tests; 139 browser cases; 10 mobile files / 276 tests;
Web/Mobile builds, post-server TypeScript, both lint scripts and diff checking.
Known chart/chunk warnings remained nonfatal; approved Chromium execution outside
the sandbox. No schema/protocol/native-source changes, actual credentials/Keychain
or device evidence. Earlier SQL/Swift/iOS proofs are not rerun or broadened.

Unchanged main/HEAD/local-main/origin-main
382ee40d37605b302c11b6390305857c7e2c3fde; 0 staged /72 modified /117 untracked individual
files. No Git mutation, app mount/default activation/config assignment, signing/
installation, hosted or distribution. General Team foundation/own-API/email and
restricted assets remain open, alongside local sporting/Q1/app/callback composition,
actual configuration binding/rotation, protected operational installation transfer/
external-writer exclusion and physical/hosted/Apple acceptance. Q4 unapproved/
deferred; Free pilot/no billing and Team separate from Personal unchanged.

Evidence: `/tmp/curling-s5e-root-final.log`, `/tmp/curling-s5e-e2e-final.log`,
`/tmp/curling-s5e-mobile-final.log`, `/tmp/curling-s5e-web-final.log`,
`/tmp/curling-s5e-tsc-final.log`, `/tmp/curling-s5e-lint-final.log`,
`/tmp/curling-s5e-mobile-lint-final.log`, `/tmp/curling-s5e-diff-final.log`,
`/tmp/curling-s5e-pre-review-focus.log`,
`/tmp/curling-independent-review/s5e-focused-code.log`,
`/tmp/curling-independent-review/s5e-own-final.log`.

### S5f — accepted dormant native Team foundation and own API

Independently DESIGN and CODE accepted locally on 25 October 2026 after corrections.
The same unmounted native sporting runtime now supplies all29 existing typed Team
methods:24 REST/RPC methods and5 own-API/email methods. Actual SupabaseTeamService
retains parsing, privacy, domain and server/RLS rules. Narrow optional observations
at the real Profile/create-Team/roster mapping points establish only the permitted
original dependent query graph; they grant no admin or membership authority.

Each complete method retains its genuine original Profile/completion, matching
Self, actual same private AUTH/pair/FIFO and retry:false public PostgrestClient.
The dependent Team/roster targets are fixed by actual one-time mapper observations;
wrong/duplicate/out-of-order facts fail closed. Issued work registers before foreign
callbacks and drains through mapper/body completion before FIFO release. Old
services and callbacks cannot borrow a later identical command or reauthentication.

Five HTTP mutations use one configured canonical HTTPS origin captured at host
construction and the same actual restored bearer/Self. Content-Type+Authorization
only, exact original POST/path/body, omit/error; no second session read, browser
helper or Supabase headers. Invalid configuration prevents HTTP even before SDK
session reads. The pure closed route table is shared with unchanged Web behavior.
Ordinary Team/domain/network failures do not invent Identity denial or mail success;
actual successful JSON retains the existing mapper cast, not new schema validation.

Review corrections closed8 malformed callback-input variants that could lose
pending work or serialize a Promise into matching bytes,4 poisoned constructor/
species root variants that could still SEND, and4 prototype-result variants that
refused SEND but lost directly observed work. Callback roots now require independent
plain-record eligibility under a temporary original-command fence; declared fields
match the privately captured original method before detached serialization. No
caller toJSON, iterator or later getter after revocation. Direct root AND malformed
prototype observations remain separately owned, including both settlement orders.
C4 limits on otherwise unobservable poisoned Promise work remain; they grant no
DTO acceptance or SEND. The exact genuine disposal promise avoids self-drain.

124 permanent host cases cover all29 methods, real dependent admin/nonadmin graphs,
null/malformed/canonical-different Profile facts, actual created-Team and roster IDs,
exact final Request fences, all5 HTTP routes, invalid config zero session/fetch,
input/mapping/stream/header/drain/retirement and old-command isolation. Actual
installed public SDKs and disposable real SQLite with synthetic stores/transport;
no real account, Keychain, physical-device durability or external-writer claim.
Architecture confines20 fixed Team RPCs,6 relations and the pure route helper.

Independent evidence: 10 focused files /566 tests and34 own probes passed, with TypeScript/focused ESLint/diff exit0. Parent focus:83 files /2,168 tests.
Final full baseline: 327 root files / 7,322 tests;139 browser cases;10 mobile files /276 tests;
Web/Mobile builds, post-server TypeScript, both lint scripts and diff checking.
Existing chart/chunk warnings remained nonfatal; approved Chromium execution
outside the sandbox. Earlier SQL/Swift/iOS proofs were not repeated or broadened.

Asset scope reconciliation: ADR-0044 and the existing MOBILE_APP_MIGRATION.md §5.2
already classify restricted delivery as dormant/future; no production component
composes its resolver. Current67 public diagrams ship in the bundle and retain the
explicitly decided disposable localStorage cache. No native restricted binary
transport or asset-permission change is required by those current beta diagrams.
Future genuinely restricted content must retain ADR-0023's fail-closed boundary.

Unchanged main/HEAD/local-main/origin-main
382ee40d37605b302c11b6390305857c7e2c3fde;0 staged /75 modified /119 untracked individual
files. No Git mutation, app mount/default activation/config assignment, signing,
installation, hosted email/deployment or distribution. Remaining local work is the
native sporting/outbox/export repository binding, original pre-fault Q1 training
continuation, actual app/callback/Flow/invalidation composition, configuration
binding/rotation and protected operational installation transfer. Physical,
old-client/writer, hosted and Apple acceptance remain separate. Q4 unapproved/
deferred; Free pilot/no billing and Team separate from Personal remain unchanged.

Evidence: `/tmp/curling-s5f-root-final.log`, `/tmp/curling-s5f-e2e-final.log`,
`/tmp/curling-s5f-mobile-final.log`, `/tmp/curling-s5f-web-final.log`,
`/tmp/curling-s5f-tsc-final.log`, `/tmp/curling-s5f-lint-final.log`,
`/tmp/curling-s5f-mobile-lint-final.log`, `/tmp/curling-s5f-diff-final.log`,
`/tmp/curling-s5f-reflection-focus.log`; `/tmp/curling-independent-review/s5f-focus-final-corrected.log`, `/tmp/curling-independent-review/s5f-all-own-final-corrected.log`, `/tmp/curling-independent-review/s5f-types-final-corrected.log`, `/tmp/curling-independent-review/s5f-lint-final-corrected.log`, `/tmp/curling-independent-review/s5f-dual-drain.log`.

### S5g — accepted dormant native local sporting repositories

Independently DESIGN and corrected CODE accepted locally on25 October2026.
The genuine native sporting host now supplies seven actual base repositories
(21 methods), actual scoped sync-state/outbox load/save, content-blind legacy
retirement and the existing two-pass personal export on its same held SQLite owner.
The capability exposes no adapter/client/admission/runner and never rebinds after
foreground ownership loss or later same-Profile authentication. No App mount.

Whole calls register before input reflection and actual I/O. Synchronous data-only
capture owns DTO aliases while preserving existing undefined/nonfinite/property-order/
sparse serialization and mutable detached loaded data. Direct root, descriptor and
unsupported prototype work drain through close; exact own disposal avoids a cycle.
Local SQL never enters the SDK FIFO, and invalid local input cannot poison another
local/SDK call. Exact existing13-key namespaces and ten bare legacy retirement keys
plus marker remain the only reachable target keys; export keeps existing privacy.

Issued positive write/removal acknowledgements are facts. Later I/O still requires
original current admission. Archive history ACK then loss/failure reports current;
both actual ACKs preserve factual success. Review found one early mapper-rejection
path that classified archive failure before an issued history ACK and retained
successor I/O rights. It now retires that call immediately, drains actual work and
only then derives failure from its final ACK ledger. The permanent real-SQLite
regression proves history COMMIT, no successor write and independent later-call
availability. Domain factories remain the only validation/serialization policy.

37 permanent host cases plus architecture confinement cover all actual
methods, nonempty Session/Plan/Assessment/Execution bytes, concurrent Assessment
reads/migrations, partial ACKs, actual export privacy, content-blind target retirement,
metadata/alias/cancellation/drain, stale-read suppression and active-SDK isolation.
The real manager fixture proves ordinary outbox use only: outer decorator/manager
input ownership is explicitly not S5g acceptance and remains the next local gate.
Normal credential fault closes this scope; no Q1 continuation is implemented.

Independent evidence: Clean;11 focused files /620 tests and7 own counterprobes passed; TypeScript/focused ESLint/diff exit0.
Final full baseline: 328 root files / 7,360 tests;139 browser cases;10 mobile files /276 tests;
Web/Mobile builds, post-server TypeScript, both lint scripts and diff checking.
Actual installed public SDK + disposable real SQLite + synthetic protected stores/
transport; no physical Keychain, Capacitor durability or external-writer proof.
Earlier SQL/Swift/iOS proofs were not repeated or broadened by this source change.

All Git refs remain382ee40d37605b302c11b6390305857c7e2c3fde on main,
0 staged /75 modified /121 untracked individual files. No Git mutation, native
activation/config assignment, source cleanup, existing-installation write, signing,
hosted action or distribution. Next local work: actual decorated manager ownership,
original pre-fault Q1 training continuation, App/Flow/callback/invalidation composition,
configuration binding/rotation and protected operational installation transfer.
Device/hosted/Apple acceptance stays separate; Q4 unapproved/deferred. Free pilot/no
billing and Team separate from Personal unchanged; current public diagrams bundled.

Evidence: `/tmp/curling-s5g-root-final.log`, `/tmp/curling-s5g-e2e-final.log`,
`/tmp/curling-s5g-mobile-final.log`, `/tmp/curling-s5g-web-final.log`,
`/tmp/curling-s5g-tsc-final.log`, `/tmp/curling-s5g-lint-final.log`,
`/tmp/curling-s5g-mobile-lint-final.log`, `/tmp/curling-s5g-diff-final.log`,
`/tmp/curling-s5g-correction-focus-complete.log`, `/tmp/curling-independent-review/s5g-focused-corrected.log`, `/tmp/curling-independent-review/s5g-own-corrected-ackmatrix.log`.

### S5h — accepted dormant native sporting application scope

Independently DESIGN and CODE accepted locally on25 October2026. One actual
SportingCloudSyncManager and one application capability are memoized per genuine
original Profile admission. The seven returned decorated repositories, three sync
controls and ten Team actions use actual S5g persistence and S5c/e native services;
no raw manager/outbox/adapter/admission escapes. No App/UI mount or activation.

Whole outer calls capture owned DTOs before the actual decorator or manager can
wait. Base writes and later reconciliation share that captured input. A narrow
optional hook registers exact manager lane Promises before microtask entry and
fences both predecessor branches; registration/currentness failure skips work with
no fake ready/issue publication. Web without the hook retains its previous behavior.
Local ACK latency stays independent of background cloud/SDK waits; host disposal
owns actual separate reconciliation and foreign listener returns to settlement.

Base ACKs remain factual through early outer errors and scope loss. Per-call native
base owners revoke successor I/O on unexpected mapping failure, then derive outcomes
from actually settled base calls. Already validly scheduled reconciliation retains
its separate original-admission lifetime. No later same-Profile admission revives
old capabilities. Snapshots are detached mutable copies; stale scopes reveal only
the safe initial not-ready snapshot. One internal observer contains foreign listener
errors, checks membership/currentness between deliveries and separately owns returned
work, avoiding reentrant-lane and exact own-disposal cycles. Native credential-failure
subscription retires ordinary scope; it creates no Q1 authority.

29 permanent host cases exercise all21 decorated methods, three controls, ten Team
actions, actual nonempty outbox bytes, pending base/lane input aliases, offline/online
behavior, actual Self denial/credential failure/foreground, both archive ACK branches,
snapshot mutation and listener cancellation/reentrancy/drain. Six actual-manager
hook controls cover registration, both predecessor entries, throws/refusal and the
unchanged ordinary path. Architecture confines both owners and shared data capture.
Actual public SDK + disposable real SQLite + synthetic counterpart stores/transport.

Independent evidence:15 focused files /696 tests and7 own counterprobes passed,
including early decorator rejection with real pending History ACK/failure/lost ACK,
separate reconciliation and independent observed-work drains. TypeScript/focused
ESLint/diff exit0. Parent focus:93 files /2,320 tests, plus3 files /14 tests for
additional actual export/filter/hook coverage.
Final full baseline:330 root files /7,396 tests;139 browser cases;10 mobile files /276 tests;
Web/Mobile builds, post-server TypeScript, both lint scripts and diff checking.
Earlier SQL/Swift/iOS proofs were not repeated or broadened; no physical-device,
Keychain/Capacitor durability or external-writer proof is inferred.

Unchanged main/all refs382ee40d37605b302c11b6390305857c7e2c3fde,
0 staged /76 modified /125 untracked individual files. No Git mutation, actual App
mount/default/flag/configuration assignment, source deletion, signing/install/hosted
or distribution. Remaining local work: original pre-fault Q1 training/context/ACK
provenance and warning, earlier Tracker event/effect ownership, actual App/Flow/
poll/reload/invalidation/callback composition, configuration binding/rotation and
protected operational installation transfer. Q3 approved/Q4 deferred; Free pilot/no
billing, Team separate from Personal and67 bundled public diagrams/cache unchanged.

Evidence:`/tmp/curling-s5h-root-final.log`, `/tmp/curling-s5h-e2e-final.log`,
`/tmp/curling-s5h-mobile-final.log`, `/tmp/curling-s5h-web-final.log`,
`/tmp/curling-s5h-tsc-final.log`, `/tmp/curling-s5h-lint-final.log`,
`/tmp/curling-s5h-mobile-lint-final.log`, `/tmp/curling-s5h-diff-final.log`,
`/tmp/curling-s5h-pre-review-focus.log`, `/tmp/curling-s5h-extra-focus.log`,
`/tmp/curling-independent-review/s5h-focus.log`,
`/tmp/curling-independent-review/s5h-own.log`.


### S5i — accepted dormant original-Session training and actual Tracker ownership

**25 October2026: independent DESIGN/CODE and complete final local baseline passed.**
Actual Provider startup/email OTP/onboarding binds the original same-owner native
Tracker and S5h application scope. Private prepared work joins Session lifetime,
incarnation/sequence and genuine pre-fault Current ACK; additional exercises/blocks/
existing Plan steps stay in that Session, while ordinary manager/sync access closes.
Actual source failures/denials and epoch changes update presentation synchronously.
Healthy remount earns fresh proof; complete reentrant capture/drain owns observed work
without self-await. Actual History ACK preserves earlier stored history and ends Q1
before successor Current. Unknown malformed history is never overwritten as absence.

Review corrections also closed native browser-Team fallback, unsigned status-poll
intent deletion and actual Account/Profile replacement gaps. The sole validated
Account-control Profile hook precedes all early-return/guard/mutation paths; stale
callbacks cannot deny newer admissions. Actual pending/fresh-OTP recovery remains.
Native Team UI/replay remains explicitly closed until its genuine App binding, retaining
incoming durable links. The existing Current/history duplicate after a Q1 finish is
preserved honestly; fresh-lifetime App acceptance is still required, no repair claimed.

Fresh independent final evidence: **6 files/445 tests**, **19 own adversarial tests**,
and **3 actual intent/Provider tests**, all PASS; TypeScript/focused ESLint/diff clean.
Independent logs: /tmp/curling-independent-review/s5i-profile-corrected-focus.log,
s5i-profile-reentrant-own.log and s5i-profile-corrected-intents.log. Parent overlapping
focus scopes are not summed into the complete baseline below.

| Final local verification | Actual result |
| --- | --- |
| Root Vitest, maxWorkers4 | **332 files /7463 tests PASS** |
| Complete local Playwright | **139/139 PASS** |
| Web production build | **PASS** |
| Mobile verify (typecheck/build/tests + actual bundle guard) | **10 files /276 tests PASS** |
| Testserver3100 shutdown | **ECONNREFUSED confirmed** |
| Post-server TypeScript, root ESLint, mobile ESLint | **PASS** |
| git diff --check | **PASS** |

Logs: /tmp/curling-s5i-{root,web,mobile,e2e,types,lint,mobile-lint}-final.log.
Existing chart-size/build-chunk warnings were nonfatal. This stage changed no SQL or
Swift/device code; previous SQL/Swift/unsigned-iOS evidence was not repeated or extended.

Source changes are the private Tracker registry/owner/erased types/React context/dormant
composition; actual Tracker commit/queue/feedback/context paths and small Plan/editor/
account-status UI boundaries; genuine Auth/coordinator source facts and sole Account
control correlation; per-job S5g/h actual ACK facts; actual native ProfilePersistence
branch and permanent SDK/SQLite/Tracker/architecture tests. Canonical requirements and
permission limits remain BETA_COMPLETION_SPECIFICATION.md §S5i.

Starting stage state main/all refs382ee40d37605b302c11b6390305857c7e2c3fde,
0 staged/76 modified/125 untracked individual files; final source state0/80/133,
refs unchanged. No stage/commit/push, source patch file, actual account/Keychain,
configuration assignment, native default/flag, install/signing, hosted or release action.

**Still open:** complete native App/AccountFlow/export/Team composition (next DESIGN
§S5j), genuine native URL delivery, configuration/rotation, protected operational
installation transfer and writer exclusion, physical iPhone/Brower acceptance,
hosted legal/worker/release steps and Apple distribution. Q3 approved; Q4 remains
unapproved/deferred until the concrete device example. Free pilot/no billing, Team
separate from Personal and67 bundled public diagrams/cache unchanged. **No beta or
activation approval.**


### S5j — accepted dormant actual App / Flow / export / Team composition

Independent complete corrected CODE PASS on25 October2026. The actual Provider and
AccountDeletionFlow use the same host's native personal export, genuine full denial
subscription and genuine bound Team services. First begun denial completion is
unconditional even after newer foreground; repeated genuine completion is idempotent.
Known/unavailable intent observations and stable-owner/version/lifecycle projection
prevent old cleanup or unreadable storage from erasing a newer displayed link. The
original Tracker/Flow mounts are preserved. Native Team presence branches before
any browser factory/config; invitation context is reported before preview mounts.

Actual integration corrected invited-account recovery's redundant SIGNED_OUT denial,
reused checked confirmation and absent current-conflict feedback. Independent review
then found two lifecycle gaps: a deletion request could follow unmount during denial;
and an old complete export could reach actual native share after newer foreground.
Both are closed. Request permission rechecks lifecycle after genuine denial; a
native-only one-way original-owner retirement witness travels through the actual
Flow/hook to the final pre-share check. It grants no admission/data operation and
cannot revive at A→B→A. Already-issued OS sharing/cancellation stays factual. Web
retains its original delivery path.

The actual App/SDK/disposable-SQLite matrix exercises real Flow export/request/
pending/polls/fresh OTP/cancel/reload, account B invitation recovery, late old
getState/request/cancel/export, denial ordering/idempotence, malformed/closed intent
observation, host disposal and context-before-preview. A new module/host/App lifetime
under fresh ordinary auth/storage checks preserves saved Q1 History and its original
Current, including recorded values. This is local JS-lifetime evidence, not physical
Keychain/installation proof. No startup grant, repair or public-ID deduplication.

| Final verification | Actual result / local log |
| --- | --- |
| Independent complete corrected CODE | PASS;6 files/253 tests and11 files/299 regressions; overlapping scopes not added; /tmp/curling-independent-review/s5j-corrected-focus.log and s5j-corrected-regressions.log |
| Independent adversarial controls |6 PASS, including original reproductions, healthy export, already-issued cancel and credential failure without Ready-state replacement; /tmp/curling-independent-review/s5j-corrected-adjacent-own.log |
| Parent correction regression |26 files/896 PASS; /tmp/curling-s5j-correction-regressions-final.log |
| Final complete root suite |333 files/7499 PASS; /tmp/curling-s5j-root-final.log |
| Final complete Playwright |139/139 PASS; /tmp/curling-s5j-e2e-final.log |
| Final Web build |PASS; /tmp/curling-s5j-web-final.log |
| Final mobile verify |10 files/276 PASS plus mobile typecheck/build; /tmp/curling-s5j-mobile-final.log |
| Test-server shutdown |Positive ECONNREFUSED on127.0.0.1:3100; /tmp/curling-s5j-server-stop-final.log |
| Post-server TypeScript, both lints |PASS; /tmp/curling-s5j-types-final.log, curling-s5j-lint-final.log, curling-s5j-mobile-lint-final.log |
| Diff whitespace |git diff --check PASS after reconciliation |

Root used maxWorkers4 and HERMES_S2_TEST_SCRATCH=/tmp/curling-beta-s2. Mobile and
Playwright used the existing /tmp/curling-beta-playwright browser cache; the initial
mobile invocation without that path could not locate Chromium and is not counted
as passed. No browser was downloaded. Web/mobile build phases ran after root;
Playwright ran after both builds; server stop preceded final static checks. Existing
chart-size and mobile chunk-size warnings remained nonfatal. No new SQL, Swift,
physical-device or source-installation acceptance is claimed.

Start main/all refs382ee40d37605b302c11b6390305857c7e2c3fde,0 staged/80 modified/133
untracked individual files; final source0 staged/83 modified/137 untracked. No Git
mutation, real account/Keychain, native activation/config assignment, platform install,
hosted transmission or distribution. Remaining gates: native URL delivery, genuine
configuration/rotation, protected operational installation transfer and external
writer exclusion, separate devices/hosted/legal/worker/Apple acceptance. Q3 approved;
Q4 deferred. Free pilot/no billing, Team separate from Personal and67 public bundled
diagrams/cache unchanged. This acceptance is not Beta or production cutover approval.



### S5k — accepted dormant exact native configuration binding

Independent complete corrected CODE PASS on25 October2026, followed by the final
baseline below. The explicit config preparation and genuine-capability entry use
the same actual host/S3i/SDK/coordinator/resources. Exact URL/key/derived root/version
receive a full standard SHA-256 pc1 identity. Changed configuration cannot silently
reuse old Q/M/I; raw source/application values and credential items remain preserved.
Permitted F metadata is separate; no reset/rebind/automatic return is promised.
Missing own-API origin remains independent of ordinary provider identity.

Review closed inherited own-field substitution, nested observed-work loss during
config/platform/host capture, cycle-chain loss through malformed then fields and
inherited-toJSON byte redirection (including actual changed-key ready against old
Q/M/I). Standard primitive-string framing now preserves exact preimages without
inherited callbacks. Private per-call failure drains preserve the older synchronous
helper API while async preparation waits for actual settlement. Host reservation
survives complete nested constructor work. Original probes, rejection/privacy,
concurrent-drain, static-cycle and actual fresh-SDK/SQLite controls are permanent.
The last review-only portability finding was an absolute scratch test import; it
is relative now, with unchanged four-case actual scenario and clean bounded review.

| Final verification | Actual result / local log |
| --- | --- |
| Independent complete corrected CODE | PASS;11 files/244 source/architecture,9 files/33 independent reproductions/controls,4 files/260 manual native host/App regressions; overlapping scopes not summed |
| Independent extra byte vectors |2 PASS, including256 deterministic UTF-16 vectors |
| Independent logs |/tmp/curling-independent-review/s5k-final-{source-focus,own-all,manual-regressions,vectors,types,lint}.log; final relative-import confirmation read-only |
| Parent final focus |11 files/244 PASS; /tmp/curling-s5k-framing-focus.log |
| Parent final portability control |1 file/4 PASS plus types/diff; /tmp/curling-s5k-portability-final.log and curling-s5k-types-portability.log |
| Final complete root suite |341 files/7596 PASS; /tmp/curling-s5k-root-final.log |
| Final complete Playwright |139/139 PASS; /tmp/curling-s5k-e2e-final.log |
| Final Web build |PASS; /tmp/curling-s5k-web-final.log |
| Final mobile verify |10 files/276 PASS plus mobile typecheck/build; /tmp/curling-s5k-mobile-final.log |
| Test-server shutdown |Positive ECONNREFUSED on127.0.0.1:3100; /tmp/curling-s5k-server-stop-final.log |
| Post-server TypeScript, both lints |PASS; /tmp/curling-s5k-{types,lint,mobile-lint}-final.log |
| Diff whitespace |git diff --check PASS after reconciliation |

Root used maxWorkers4 and HERMES_S2_TEST_SCRATCH=/tmp/curling-beta-s2. Web/mobile builds
followed root; mobile/Playwright used the existing /tmp/curling-beta-playwright cache,
without downloads. Browser checks followed both builds; server stop preceded final
static checks. Existing chart/chunk warnings were nonfatal. Earlier failed/adversarial
logs remain in /tmp; passing final checks do not relabel those failures. No SQL or
Swift source changed; previous real SQL/injected Swift/unsigned-iOS evidence is not
repeated or extended. No physical, real-Keychain or original-installation proof.

Source scope: nativeProviderConfiguration, shared platformSha256 and two existing
fingerprint helpers; same host constructor/new explicit entry; data-only capture;
existing actual test fixture, exact architecture guard and eight new regression
files. Canonical contract: BETA_COMPLETION_SPECIFICATION.md §S5k.

Start main/all refs382ee40d37605b302c11b6390305857c7e2c3fde,0 staged/83 modified/137
untracked individual files; final0/83/147, refs unchanged. No Git mutation, actual
configuration-value assignment, real account/Keychain, native root/flag activation,
signing/install, hosted transfer or distribution. Remaining: native URL delivery,
supported operational config change/actual assignment, protected operational
installation transfer/external-writer exclusion, separate devices/hosted/legal/
worker/Apple acceptance. Q3 approved; Q4 deferred. Free pilot/no billing, Team separate
from Personal and67 bundled public diagrams/cache unchanged. No Beta/cutover approval.

### S5l — accepted native pending-intent replay ownership

Independent corrected CODE PASS on25 October2026, followed by the complete local
baseline below. The actual coordinator's effect lane owns native observation,
revision/foreground/epoch correlation and conditional dismissal/recovery. Exact
final frozen public intent objects map to private replay observations; old invitation
and inbox callbacks cannot consume a replacement. The actual Provider follows
same-owner changes; a new same-id admin link refreshes the already-mounted inbox.
There is no App-plugin launch/event intake yet; this is its accepted prerequisite.
Canonical contract: BETA_COMPLETION_SPECIFICATION §S5l.

Review closed incomplete nested listener work ownership, reentrant unsubscribe
and exact genuine-disposal child cycles. The new notification channel alone uses
completion-only boxed draining, dynamic exact own-disposal exclusion before every
recursive observation/reflection and per-invocation registration checks. It never
waits on callbacks inside the effect lane. Advisory failure preserves mutation truth.
Other live channels/hash/config default semantics remain unchanged. Independent
probes are permanent regressions, including actual completion/reservation release.

The real SQLite source may refuse an operation revoked before COMMIT; that remains
blocked/unverified. Positive actual ACK followed by notification-triggered close is
preserved factually through the host; controlled delayed positive ACK/close is also
verified at the actual coordinator. Neither grants identity or optimistic clearing.

| Final verification | Actual result / local log |
| --- | --- |
| Independent complete corrected CODE |21 files/512 PASS;4 independent probe files/8 PASS, no unhandled errors |
| Independent logs |/tmp/curling-independent-review/s5l-owned-child-{source-focus,host-regressions,all-own}.log |
| Parent corrected focused checks |12 files/265 PASS; /tmp/curling-s5l-owned-child-{focus,effects}.log |
| Complete root suite |346 files/7646 PASS; /tmp/curling-s5l-root-final.log |
| Complete Playwright |139/139 PASS; /tmp/curling-s5l-e2e-final.log |
| Web build |PASS; /tmp/curling-s5l-web-final.log |
| Mobile verify |10 files/276 PASS plus typecheck/build; /tmp/curling-s5l-mobile-final.log |
| Test-server shutdown |Positive ECONNREFUSED on127.0.0.1:3100; /tmp/curling-s5l-server-stop-final.log |
| Post-server TypeScript, both lints |PASS; /tmp/curling-s5l-{types,lint,mobile-lint}-final.log |
| Diff whitespace |git diff --check PASS after reconciliation |

Root used maxWorkers4 and HERMES_S2_TEST_SCRATCH=/tmp/curling-beta-s2. Initial root
invocation omitted that temporary-path override: six sandbox write failures, then
explicitly stopped (exit130), retained in curling-s5l-root-scratch-path-failed.log.
The clean full rerun above is separate evidence. One early test-fixture descriptor
failure is likewise retained; corrected source suites and final baseline passed.
Web/mobile builds followed root; browser checks used the existing
/tmp/curling-beta-playwright cache, no downloads. Server stop preceded final static
checks. Existing chart/chunk warnings remain nonfatal. SQL/Swift unchanged; older
real SQL/injected Swift/unsigned-iOS evidence is not repeated or extended. No
physical, real-Keychain or original-installation proof is added.

Scope: private coordinator/native host/registry and erased App contract; actual
Provider/Team replay UI; five new regression files, existing harness/architecture
and shared boxed-observer controls. Start main/all refs382ee40,0 staged/83 modified/
147 untracked; final0/83/152, unchanged refs. No Git mutation, real configuration
assignment, native defaults/root activation, signing/install, hosted or distribution.
Continue separate native App intake, then protected operational transfer/exclusion
and devices/hosted/legal/worker/Apple gates. Q3 approved; Q4 deferred. Free pilot,
Free/Personal/Team rules and67 public bundled diagrams/cache unchanged. No Beta or
cutover approval.

### S5m — accepted dormant native Team launch/event intake

Independent corrected CODE and the complete local baseline passed on25 October2026.
The genuine sporting host alone composes an explicitly opted-in App source, requiring
an OWN canonical bare HTTPS Team origin. No actual origin/config value is assigned.
Default native context and App availability require primitive true, then URL event
registration precedes launch retrieval. Supported URLs use the actual existing
coordinator/repository; no auth capture/exchange, browser URL/history or new grant.
Invalid/foreign/mixed OAuth input is ignored. A valid newer event supersedes late
launch and older still-classifying events, even when its persistence refuses.

Healthy capture refusal is advisory: genuine native not_captured and a fixed notice
keep normal Provider startup/OTP/denial-debt settlement reachable without automatic
recapture or debt clearing. Actual Domain/Protocol/Credential/Clock faults keep their
original revocation and training vetoes. Source initialization failure is separately
sticky. Actual invitation/admin replay, same in-flight duplicates and later reopening
run through existing ownership. Status never masks host health or claims a kept link.

All directly observed registration/launch/capture/removal/default-dependency work is
owned through close. Reentrant classification uses private non-secret frames before
reflection/clock reads. Default dependencies are captured/validated sequentially;
malformed work retires source initialization before boxed draining. The new clock
path alone uses a private retainer seam preserving checked validation/identityFailed;
it owns masked children and skips exact genuine disposal recursively. Legacy default
clock/live channels are unchanged. The source-only value wrapper distinguishes
excluded work from actual fulfilled undefined; exclusion never creates a handle,
absence or removal ACK. Unconfirmed observable cleanup retains SDK reservation.

The public installed CoreJS handle provides JS request receipts, not independently
proved physical registration/unsubscribe ACKs. Late callbacks are permanently inert
locally; late handles are removed once. Hidden provider work/poisoned species remain
C4 limits, not rescued by a global handler or timeout. No physical proof is added.

| Final verification | Actual result / local log |
| --- | --- |
| Independent complete corrected CODE |23 files/499 PASS;9 independent probe files/16 PASS; no unhandled errors or hook timeouts |
| Independent logs |/tmp/curling-independent-review/s5m-clock-final-{source-focus,regressions,all-own}.log |
| Parent final focus |27 files/452 PASS; /tmp/curling-s5m-clock-focus.log |
| Complete root suite |359 files/7779 PASS; /tmp/curling-s5m-root-final.log |
| Complete Playwright |139/139 PASS; /tmp/curling-s5m-e2e-final.log |
| Web build |PASS; /tmp/curling-s5m-web-final.log |
| Mobile verify |10 files/276 PASS plus typecheck/build; /tmp/curling-s5m-mobile-final.log |
| Test-server shutdown |Positive ECONNREFUSED on127.0.0.1:3100; /tmp/curling-s5m-server-stop-final.log |
| Post-server TypeScript, both lints |PASS; /tmp/curling-s5m-{types,lint,mobile-lint}-final.log |
| Diff whitespace |git diff --check PASS after reconciliation |

Thirteen Team-link regression suites contain127 cases, including all nine adopted
independent probe files with relative imports and positive actual mock counters.
The initial independent CODE findings (event order/default dependency ownership and
newly reached clock ingress) are closed. Their original red logs remain separate;
unaliased scratch default-module runs were invalid evidence and replaced with
explicit aliases/counters. Parent earlier fixture/lint failures remain separate.
Root used maxWorkers4 and HERMES_S2_TEST_SCRATCH=/tmp/curling-beta-s2. Web/mobile builds
followed root; browsers used the existing /tmp/curling-beta-playwright cache without
downloads. Server stop preceded final static checks. Known chart/chunk warnings were
nonfatal. SQL/Swift unchanged; older SQL/unsigned-iOS evidence is not repeated or
extended. No physical, real-Keychain, original-installation or distribution proof.

Scope: private source/actual host, narrow boxed observer/erased composition registry,
actual Provider/native notice, fixture/architecture/shared controls and13 new suites.
Start main/all refs382ee40d37605b302c11b6390305857c7e2c3fde,0 staged/83 modified/152
untracked; final0/83/166, refs unchanged. No Git mutation, real configuration-value
assignment, native default/root/flag/capability activation, signing/install, hosted
transfer or distribution. Canonical contract: BETA_COMPLETION_SPECIFICATION §S5m.
Continue protected operational installation transfer/semantic compatibility and
external-writer exclusion; actual config, physical iPhone/Brower, hosted/legal/
worker/Apple gates and Q4 remain open. Free pilot/Free/Personal/Team and Q1/Q3 remain.
No Beta/cutover approval.

### S6a — explicit standard byte-SHA archive V3 (locally accepted)

The independently accepted corrected design is implemented locally. A private V3
wrapper supplies the real lazily captured standard SHA-256 engine over the actual
codec's bounded binary preimages. V1/V2 injected APIs, wire contracts and pure graph
remain; only one exact wrapper may import the frozen V3-core internals. The new
byte capture shares private boxed observation, with complete observed failure
ownership, original receivers and stable private input copies. No TextEncoder or
public provider override is required. The source-only value export stays confined.

Outer snapshot/wire version3 uses the existing V2 inventory contract and separately
versioned listing schema1, including all deletion controls. Existing strict raw/
inventory/size preflight precedes platform capture. Digest mismatch and canonical
wire checks keep their original late order/first-error priority. A successful result
still has semanticStatus not_evaluated. No protected delivery, source freeze,
freshness/auth/receipt, usable workspace or publish/mount/rollback authority is added.
No production application caller or native root/flag/bridge/dependency is introduced.

Actual parent pre-review checks:30 focused/platform/S2/V2/V3/architecture/configuration/
Team-link files/609 tests PASS, then2 new suites/59 tests PASS after four additional
root-rejection/maximum-bound controls. TypeScript, focused ESLint and diffcheck PASS.
The two new suites contain30 byte-engine and29 archive cases. Standard hashes and
binary preimages are checked against independent Node references and positive real
platform call counters. Pre-hash zero-capture and hashed-then-noncanonical controls
preserve the accepted decoder order. Initial test syntax/type/size-fixture failures
remain separate logs; corrected tests passed.

Logs: /tmp/curling-s6a-focus-ready.log, /tmp/curling-s6a-new-final.log,
/tmp/curling-s6a-{types,lint}-final-focus.log. Independent complete CODE PASS:
10 files/402 tests,7 regression files/84 tests and13 own probes PASS; TypeScript,
focused lint/diff PASS. Actual logs:
/tmp/curling-independent-review/s6a-{focused-scratch,config-regressions,own}.log.
The first independent default-scratch run had six EPERM failures; the intended
temporary scratch rerun passed all402 and does not erase that original log.

| Final verification | Actual result / local log |
| --- | --- |
| Complete root suite |361 files/7839 PASS; /tmp/curling-s6a-root-final.log |
| Complete Playwright |139/139 PASS; /tmp/curling-s6a-e2e-final.log |
| Web build |PASS; /tmp/curling-s6a-web-final.log |
| Mobile verify |10 files/276 PASS plus typecheck/build; /tmp/curling-s6a-mobile-final.log |
| Test-server shutdown |Positive ECONNREFUSED on127.0.0.1:3100; /tmp/curling-s6a-server-stop-final.log |
| Post-server TypeScript, both lints |PASS; /tmp/curling-s6a-{types,lint,mobile-lint}-final.log |
| Diff whitespace |git diff --check PASS |

Root used maxWorkers4 and HERMES_S2_TEST_SCRATCH=/tmp/curling-beta-s2. Web/mobile
followed root; Playwright used the existing temporary browser cache, no downloads.
Server stop preceded final statics. Known chart/chunk warnings nonfatal; SQL/Swift
unchanged, no new physical evidence. main/all refs382ee40,0 staged/83 modified/169
untracked, no Git mutation. Canonical contract: BETA_COMPLETION_SPECIFICATION §S6a.
Actual C6 semantic compatibility, protected operational transfer/external-writer
exclusion, configuration/device/hosted/legal/worker/Apple gates and Q4 remain open.
Free pilot/Free/Personal/Team, Q1/Q3 unchanged; no Beta/cutover or device approval.


### S6b — actual domain interpretation (locally accepted)

Independent DESIGN PASS; private local implementation evaluates all13 sporting
slots per declared Profile using the actual repositories in audited disposable
overlays. Source/staged raw strings never change. Only named existing Assessment
load recovery writes occur in the copies; strict content comparisons reject
fallbacks, field/member loss, unknown schemas and unsupported repairs. Actual
schema1 Plans/tolerances and sync1..6 have closed interpretation deltas.
Historical catalog/delivery remains explicitly not_evaluated; no usable workspace,
physical target write, auth/import or publish/mount/rollback authority follows.
The full canonical contract is BETA_COMPLETION_SPECIFICATION.md §S6b.

Actual parent checks:15 archive/actual-repository/architecture files470 tests PASS,
then the final new semantics suite100 tests PASS after nine additional controls.
TypeScript, focused ESLint and diffcheck PASS. Source unchanged after the470 run;
the later additions were test controls. Logs: /tmp/curling-s6b-focus-ready.log,
/tmp/curling-s6b-semantics-ready.log, /tmp/curling-s6b-{types,lint}-prereview.log.
The first focus found an incomplete strict filter-shape check (the actual sanitizer
retains unknown fields); the evaluator now checks supported shape explicitly.
Initial type/import-guard/Assessment-fixture and misplaced test-edit failures remain
separate logs, corrected runs passed. Complete corrected CODE and the final baseline
are recorded below. The original
S6a complete7839/139/276 baseline remains prior-stage evidence only.
No production app caller, native flag/root, actual configuration assignment,
original-installation operation, signing/install, hosted or Git mutation.


S6b corrected complete CODE accepted: initial independent12 files/337 PASS did
not close11 failing own witnesses (2 controls passed). Three confirmed families
were corrected under a separate accepted consolidated DESIGN: Assessment expected
bytes no longer share toJSON-sensitive container serialization; known Sync hashes
require primitive64-hex strings; failed ordinary removes no longer contaminate
unrelated later domain findings. Actual repositories/formats are unchanged.
All13 independent witnesses are permanent, plus9 adjacent controls (22 review
cases); the original100 semantics cases remain. Corrected16 files/501 tests,
TypeScript, focused lint and diff PASS. Actual logs:
/tmp/curling-s6b-correction-{focus,types,lint}-ready.log. Independent corrected CODE
PASS:13 focus files/359 tests,13 original witnesses
and14 separate extracted-private-writer tests; TS/focused lint/diff PASS. Actual
logs /tmp/curling-independent-review/s6b-{corrected-focused,own-corrected,writer-own-final}.log.
The scratch writer harness initially patched the global Array prototype too broadly;
its corrected input-array-only run passed, with production unchanged. Original
failures are retained and not relabeled.

| Final verification | Actual result / local log |
| --- | --- |
| Complete root suite |363 files/7962 PASS; /tmp/curling-s6b-root-final.log |
| Complete Playwright |139/139 PASS; /tmp/curling-s6b-e2e-final.log |
| Web build |PASS; /tmp/curling-s6b-web-final.log |
| Mobile verify |10 files/276 PASS plus typecheck/build; /tmp/curling-s6b-mobile-final.log |
| Test-server shutdown |Positive ECONNREFUSED on127.0.0.1:3100; /tmp/curling-s6b-server-stop-final.log |
| Post-server TypeScript, both lints |PASS; /tmp/curling-s6b-{types,lint,mobile-lint}-final.log |
| Diff whitespace |git diff --check PASS |

Root used maxWorkers4 and HERMES_S2_TEST_SCRATCH=/tmp/curling-beta-s2; Web/mobile
followed root, then139 E2E using the existing temporary browser cache without
downloads. Server stop preceded final statics. Known chart/chunk warnings nonfatal.
SQL/Swift unchanged, no new physical evidence. Start0/83/169, final0/83/172;
all refs382ee40 unchanged, no Git mutation. Canonical contract: §S6b.
Historical catalog/delivery compatibility, protected operational transfer/external
writers, actual configuration/device/hosted/legal/worker/Apple gates and Q4 remain
open. No Beta/cutover/activation approval. Free pilot/Free/Personal/Team and Q1/Q3
unchanged.


### S6c — Historical catalog and registered diagram references (locally accepted, 2026-10-26)

The private historical evaluator now examines actual complete immutable catalogs,
retired/superseded versions, registered public diagrams, self-contained Assessment
snapshots, original personal payloads through actual synchronous readers, and known
Team reference carriers with exact same-Profile/session/team/execution context.
Mixed unsupported/unexamined Profiles prevent a global catalog candidate. Source
raws and original domain/recovery findings remain intact; all authority flags false.
This closes local historical registry/bundle-contract compatibility. It does not
claim full opaque Team semantics, inner payload digest verification, installed-device
files, protected transfer or Beta readiness. Canonical contract: §S6c.

One initial independent CODE defect (catalog accessor/original array length Gets)
was corrected with sequential own-data descriptors and cached validated primitive
lengths. Independent corrected13 focus files/538 tests, original13 probes and8
additional probes PASS; TS/focused lint/diff PASS. Counts overlap, not additive.

| Final verification | Actual result / local log |
| --- | --- |
| Complete root suite |364 files/8040 PASS; /tmp/curling-s6c-root-final.log |
| Complete Playwright |139/139 PASS; /tmp/curling-s6c-e2e-final.log |
| Web build |PASS; /tmp/curling-s6c-web-final-retry.log |
| Mobile verify |10 files/276 PASS plus type/build; /tmp/curling-s6c-mobile-final-retry.log |
| Test-server shutdown |Positive ECONNREFUSED3100; /tmp/curling-s6c-server-stop-final-retry.log |
| Post-server TypeScript |PASS; /tmp/curling-s6c-types-post-stop-final.log |
| Root/mobile lint |PASS; /tmp/curling-s6c-{lint,mobile-lint}-final.log |
| Diff whitespace |git diff --check PASS |

Initial font-fetch/network, missing default browser-cache and sandboxed socket
observation failures remain in their original logs; the properly configured retries
passed. No browser download, application configuration or native activation occurred.
Start0/83/172, final0/83/174, all refs382ee40 unchanged. No Git mutation or source/
device/hosted/Apple action. Protected operational transfer and external writers,
actual configuration/physical URL delivery, device/Brower, hosted legal/worker and
Apple release gates plus Q4 remain open. The closed free pilot still needs no
billing or price/seat enforcement; Team membership is separate from Personal.


### S6d — Actual bounded WebView source (locally accepted, 2026-10-26)

The actual private read-only source captures complete supported raw values/absences,
using native receiver-bound Web Storage reads and the real inventory planner. It
never reads excluded credentials/cache/foreign values and grants no freeze/auth/
transport/publish/mount rights. Exact private proof/fence lifetime and full observed
pending-work ownership are independently accepted. Canonical contract: §S6d.

An independent descriptor-admission P2 was corrected with own-member-before-read
ordering. The first Mobile artifact gate exposed unused frozen inventory constants;
five precise PURE annotations removed that default-bundle leak without changing
runtime semantics. The full artifact matrix then exposed an existing overbroad
namespace assertion: accepted ordinary SQL discovery needs exact D/F/source address
knowledge. The corrected test pins exact reference membership/counts only in actual
SQL opt-ins; strict default absence and ANY-mode runner/archive/source guards remain.
Independent16 focus files/1088 tests,44 guard controls and all three actual build
variants15/15 PASS; default restored, full mobile10/277 PASS. Counts overlap.

| Final verification | Actual result / local log |
| --- | --- |
| Complete root suite |365 files/8108 PASS; /tmp/curling-s6d-root-final-corrected.log |
| Complete Playwright |139/139 PASS; /tmp/curling-s6d-e2e-final-corrected.log |
| Web build |PASS; /tmp/curling-s6d-web-final-corrected.log |
| Mobile verify |10 files/277 PASS plus type/build; /tmp/curling-s6d-mobile-final-corrected.log |
| Test-server shutdown |Positive ECONNREFUSED3100; /tmp/curling-s6d-server-stop-final-corrected.log |
| Post-server TypeScript |PASS; /tmp/curling-s6d-types-post-stop-final.log |
| Root/mobile lint |PASS; /tmp/curling-s6d-{lint,mobile-lint}-final.log |
| Diff whitespace |git diff --check PASS |

Original failures remain original failure evidence. No configured minified bundle
is reproduced in reports. SQL/native code unchanged; no physical/device evidence.
Source-helper exclusion/lifetime, protected operational transport and target atomic
readback/fresh-auth handoff remain open, along with actual configuration and separate
device/Brower/hosted/legal/worker/old-client/Apple gates and Q4. Native Team email-link
association is deferred under adopted §6.5: the pilot may continue opening these links
on Web, which must be stated in its acceptance flow. Physical native link delivery
is required before enabling that optional integration, not a new beta product gate.
The free closed pilot requires no billing/prices/seats or final Personal name.
Git0/83/174->0/83/175, all refs382ee40 unchanged. No Git/activation/config/device/
signing/upload/hosted mutation. No Beta approval.


### S6e — Standard protected archive (locally accepted, 2026-10-26)

The private V3 archive can be sealed/opened with actual standard AES-256-GCM and a
fresh random key/nonce, keeping the recovery code separate. Open requires actual
authenticated bytes, exact encoding/length and V3 integrity validation. The initial
independent P2 (native decrypt plaintext not wiped alongside its copy) was corrected;
both buffers are now wiped only after observed work settles. Strings/engine/native
memory have no secure-erasure guarantee. Complete corrected CODE PASS: 6 files/303
tests, 14 original independent and 7 adjacent probes PASS; these counts overlap.
Real isolated Chromium WebCrypto and independent Node interoperation PASS.
Canonical contract and detailed correction evidence: BETA_COMPLETION_SPECIFICATION
§S6e; architecture ADR-0053.

| Final verification | Actual result / local log |
| --- | --- |
| Complete root suite |366 files/8191 PASS; /tmp/curling-s6e-root-final.log |
| Complete Playwright |139/139 PASS; /tmp/curling-s6e-e2e-final.log |
| Web build |PASS; /tmp/curling-s6e-web-final.log |
| Mobile verify |10 files/277 PASS plus type/build; /tmp/curling-s6e-mobile-final.log |
| Test-server shutdown |Positive ECONNREFUSED3100; /tmp/curling-s6e-server-stop-final.log |
| Post-server TypeScript |PASS; /tmp/curling-s6e-types-post-stop-final.log |
| Root/mobile lint |PASS; /tmp/curling-s6e-{lint,mobile-lint}-final.log |
| Diff whitespace |git diff --check PASS |

No operational file/code delivery, source-helper/writer exclusion, target staging/
readback/fresh-auth handoff, app caller or physical iPhone/WKWebView acceptance is
introduced. These remain open together with actual configuration, original-data
preservation, device/Brower, hosted rights/migration/legal/worker, old-client and
Apple gates. Q4 remains deferred, not accepted. Native Team links are optional under
the existing Web fallback; free pilot billing/price/seat enforcement remain outside
this beta. No actual configuration assignment, activation, original-phone access,
installation, signing, upload, hosted change or Git mutation. No Beta approval.

### S6f — Isolated source observation helper (locally accepted, 2026-10-26)

The separate local observation-only artifact under transfer-source/ is accepted after
corrected independent DESIGN/CODE and the complete local baseline. Its private owner
checks actual native iOS/App routing, foreground and fresh S6d source observations;
logical revocation immediately ends the visible entry while close separately joins
observed work. The three independent P2s (repeat receiver admission, native idle UI
termination and early metadata refusal) are corrected. Independent7 files/284 tests,
11 original counterexamples and9 additional controls PASS; counts overlap. Fresh
helper build, actual built Chromium probe, TS/lint/diff PASS. Existing three-mode
normal-bundle matrix15/15 each remains valid, with default restored. Canonical
contract, limitations and exact evidence: BETA_COMPLETION_SPECIFICATION.md §S6f.

| Final verification | Actual result / local log |
| --- | --- |
| Complete root suite |369 files/8246 PASS; /tmp/curling-s6f-root-final.log |
| Complete Playwright |139/139 PASS; /tmp/curling-s6f-e2e-final.log |
| Web build |PASS; /tmp/curling-s6f-web-final.log |
| Mobile verify |10 files/277 PASS plus type/build; /tmp/curling-s6f-mobile-final.log |
| Separate helper build |PASS; /tmp/curling-s6f-helper-final.log |
| Test-server shutdown |Positive ECONNREFUSED3100; /tmp/curling-s6f-server-stop-final.log |
| Post-server TypeScript |PASS; /tmp/curling-s6f-types-post-stop-final.log |
| Root/mobile lint |PASS; /tmp/curling-s6f-{lint,mobile-lint}-final.log |
| Diff whitespace |git diff --check PASS |

`npm run transfer-source:build` writes only transfer-source/dist. It is not the
Capacitor webDir and cannot replace the app through the normal mobile build. It loads
no environment/application/SDK/cloud configuration, offers no archive/file/Share
operation and grants no frozen-source/installation/transfer authority. AppInfo is
routing only. Original WKWebView-container access, preservation-safe operational
packaging and external-writer exclusion still require separate disposable physical
evidence. Synthetic bridge/browser tests do not establish those facts. No install/
sync/signing operation is authorized or performed. Protected delivery and target
staging/readback/fresh-auth, actual configuration and device/hosted/Apple gates remain
open. The free pilot requires no billing; Team != Personal; Q4 remains unapproved.
No original-data/device access, native/default activation, publication or Git mutation.
No Beta approval.

### S6g — protected quarantine prerequisite (2026-10-26)

Corrected independent DESIGN/CODE and full local regression accepted for the dormant
iOS-only encrypted archive quarantine on the actual native SQLite owner (ADR-0054).
This does not import the training-only backup, publish sporting rows, establish fresh
authentication/source denial, or waive any existing device/release gate.

The inert owner authenticates actual S6e/V3 bytes, reserves the existing core's
registry/queue/handle, atomically inserts exact encrypted ASCII bytes and digest,
and requires positive close/release/fresh-open/full readback. Cold inspection is
structural only; warm contradictions retain a sticky logical fault reservation.
No recovery code/plaintext is persisted, no ordinary rows are published and all
public grant flags remain false. Web/Android/unsupported detection refuses before
engine work. Real disposable SQLite and standard desktop crypto tests do not
establish physical Capacitor/Keychain/power-loss acceptance.

The actual native-storage build initially retained unused adapter exports; extracting
concrete SQL/discovery/work into the solely dynamically loaded private SQL installer
fixed this while retaining the same core. Five independently reproduced P2 defects
were corrected: reading later metadata after first invalid field, reopening before
malformed rollback work settled, not retaining first complete durable discovery,
accepting tag-only ciphertext, and reopening after unconfirmed open cleanup.
All original/adjacent independent witnesses pass; no unresolved CODE finding remains.
The proposed terminal-newline issue did not reproduce and is not a confirmed defect.

Verification on 2026-10-26:

- Parent focused: 5 files /401 tests PASS. Independent complete-boundary focus:
  8 files /812 tests PASS, plus11 adversarial witnesses PASS; TS/scoped lint/diff PASS.
- Full root: 370 files /8300 tests PASS. Full local browser suite:139 PASS; positive
  ECONNREFUSED confirms test server stopped on127.0.0.1:3100 before final TypeScript.
- Web production build PASS. Full mobile verification:10 files /277 tests PASS,
  typecheck/build PASS. All three actual normal bundle modes (Default, Diagnostics,
  Native-storage):15/15 bundle guards each; Default rebuilt/restored last.
- Final TypeScript, root lint, mobile lint and git diff --check PASS.
- Source-helper graph/build and iOS bridge are unchanged; prior S6f/bridge evidence
  is not represented as newly performed physical acceptance.

Commands/logs: `/tmp/curling-s6g-root-final.log`, `web-final.log`, `mobile-final.log`,
`e2e-final.log`, `server-stop-final.log`, `types-final.log`, `lint-final.log`,
`mobile-lint-final.log` (all same `/tmp/curling-s6g-` prefix), three
`bundle-{default,diagnostics,native-storage}-tests-final.log` files, and
`/tmp/curling-s6g-independent-final-{focus,probes,types,lint}.log`.

S6g changed files: `src/lib/persistence/nativeSqliteAdapter.ts`; new
`installationTransferQuarantine.ts`, `installationTransferQuarantineSql.ts`,
`installationTransferQuarantineWork.ts` in the same directory; new
`src/lib/persistence/__tests__/installationTransferQuarantine.test.ts`;
`src/lib/persistence/__tests__/architectureBoundary.test.ts`;
`mobile/__tests__/bundle.test.ts`; `docs/MOBILE_APP_MIGRATION.md`,
`docs/TESTFLIGHT_READINESS.md`, `docs/BETA_COMPLETION_SPECIFICATION.md`,
`docs/PERSISTENCE_BOUNDARY_DESIGN.md`, `docs/SYSTEM_ARCHITECTURE.md`,
`docs/TECHNICAL_DEBT_AND_ROADMAP.md`, `docs/adr/README.md`,
`docs/adr/0049-durable-native-local-storage-and-migration.md`, and new
`docs/adr/0054-protected-installation-quarantine.md`.

Git start: main/HEAD/main/origin-main382ee40,0 staged/85 modified/179 untracked paths.
Final: same refs,0 staged/85 modified/184 untracked paths. No staging, commit, ref
mutation, push, PR, device access/install/signing, actual configuration assignment,
hosted write, source-helper activation or personal-backup access occurred in S6g.
Operational archive delivery/exporter, writer exclusion, sporting publication,
D/Q/F coexistence/auth/source-deny admission, actual configuration, Q4 and physical/
Hosted/Apple acceptance remain open. The training-only saved JSON intentionally
omits identity facts; this stage does not invent them or claim to import that file.

### S6h — actual native sporting preparation (2026-10-26)

Independent DESIGN and corrected scoped CODE accepted for actual authenticated
archive-to-unselected sporting preparation on the same native SQLite core. Canonical
contract: `MOBILE_APP_MIGRATION.md`, S6h; ADR-0054. The full import/fresh-auth mandate
continues: this is not publication, normal sporting access, UI mount or Beta approval.

The actual S6e opener, V3 decoder, domain loaders and historical catalog run before
preparation. Present sporting raws are staged exactly as reversible ASCII UTF-16
codeunits, including lone surrogates and NUL. This is not encryption at rest.
Identity/legacy remain exclusively in the original encrypted archive; no recovery
code or full decrypted V3 wire is persisted. Recovery-required raws retain their
original bytes without copying semantic overlay/default writes. All public grants
remain false. The original S6g factory and ordinary stores reject this layout.

One independently reproduced P2 was corrected: an unresolved transaction could
observe exact BEFORE and later silently upgrade to externally supplied exact AFTER.
The first complete durable readback, including empty/quarantine-only BEFORE, is now
pinned; any later drift faults and retains ownership. Six independent adversarial
witnesses pass. The complete root run additionally caught a missing exact graph-test
exception; it now permits only the SQL module's adopted `transferSlot` import, with
independent test-only review PASS. No production exemption was broadened.

Scoped evidence: parent4 files/265 tests PASS; independent10 files/930 tests PASS
plus6 adversarial witnesses PASS; independent follow-up2 files/144 tests PASS.
Actual disposable SQLite, real desktop standard crypto and synthetic bridge faults
exercise transactions/reopen/cold workers, malformed acknowledgements, cancellation,
cleanup, full codeunit fidelity and exact raw-domain preparation. No physical iOS,
Keychain, power-loss or personal-backup import claim follows.

Complete regression: root371 files/8341 tests PASS; Web production build PASS;
full mobile10 files/277 tests and typecheck/build PASS; actual Default/Diagnostics/
Native-storage modes15 bundle guards each PASS, Default restored last. Full browser
suite139 PASS; positive ECONNREFUSED confirms the test server stopped before final
TypeScript. Final TypeScript, root/mobile lint and diff checks PASS.

S6h files: new `src/lib/persistence/installationTransferPreparation.ts`,
`installationTransferCodeUnits.ts`, `__tests__/installationTransferPreparation.test.ts`;
shared `installationTransferQuarantineSql.ts`, `installationTransferQuarantineWork.ts`,
`nativeSqliteAdapter.ts`; precise `__tests__/architectureBoundary.test.ts` and
`__tests__/installationTransferInventory.test.ts`; `mobile/__tests__/bundle.test.ts`;
canonical migration/readiness, ADR-0054 and existing architecture/roadmap cross-links.
Logs: `/tmp/curling-s6h-*-final.log`, three bundle test logs, independent
`/tmp/curling-s6h-independent-final-{focus,probes,types,lint}.log` and
`/tmp/curling-s6h-independent-inventory-guard.log`.

Git start main/allrefs382ee40,0 staged/85 modified/184 untracked; current same refs
and index,0 staged/85 modified/187 untracked. No stage/commit/ref mutation, device,
personal backup, configuration values, hosted changes, activation or installation.
Fresh destination pairing/identity-only host, deliberate fresh OTP/source-deny,
publication/handoff, operational delivery/writer exclusion, Q4 and all remaining
physical/Hosted/Apple gates remain unfinished. No additional product decision was
required for this preparation slice.


### S6i — actual fresh destination pairing (2026-10-26)

Amended independent DESIGN, corrected scoped CODE and complete local regression
accepted. Canonical S6i contract: `MOBILE_APP_MIGRATION.md`. Identity-only host,
deliberate fresh OTP/source-deny and publication remain open.

The dormant owner runs actual shared S6h admission/preparation on the same native
SQLite core and pairs with the actual protected migration port and namespace owner.
A complete empty namespace/positive absent manifest precedes a fresh immutable SQL
intent; actual new empty Q/M use distinct standard UUIDs and exact configured root.
The actual verified protected M write precedes immutable SQL binding and durable
reopen/readback. Cold intent resumes the same IDs; paired missing M and orphan/I/
foreign evidence block without rewriting. No Dactive is fabricated, no source
credentials/identity are copied, no SDK/ordinary adapter is exposed and all public
grants remain false. Configuration identity is a trusted internal dependency here;
the actual host's genuine configuration binding is a subsequent integration gate.

Three independent P2s were corrected: generation after invalid/duplicate UUID or
revocation; malformed native open/close/release acknowledgement being accepted as
positive evidence; and cleanup waiting on its own completion. The same actual
private native core now receives original lifecycle work through the private
quarantine hook, requires exact undefined, drains observed malformed work and keeps
uncertain ownership. Legacy void-result behavior is preserved. A later positive
explicit AFTER classification clears transient readback uncertainty; unknown COMMIT
with exact BEFORE remains held. Both genuine cleanup receipts must be current and
healthy before either logical owner retires, including after namespace releasing
hides its fault state. No reset/force-pair/unlock is added.

Scoped evidence: parent6 files/336 tests PASS; independent12 files/1007 tests PASS
plus18 adversarial probes PASS. All13 original independent witnesses are permanent
repository tests, with two additional opening-failure/eventual-outcome controls.
TypeScript, scoped ESLint and diff checks PASS. This is real desktop SQLite and
actual standard crypto with synthetic protected-bridge model evidence; physical
Keychain/iOS/power-loss/writer-exclusion acceptance is not established.

New files: `src/lib/persistence/installationTransferAdmission.ts`,
`installationTransferPairProtocol.ts`, `installationTransferPairing.ts`,
`__tests__/installationTransferPairing.test.ts` (38 tests). Shared changes:
`installationTransferPreparation.ts`, `installationTransferQuarantineSql.ts`,
`nativeSqliteAdapter.ts`, `nativeCredentialMigrationPort.ts`,
`nativeCredentialNamespace.ts`; exact architecture/mobile bundle guards and
canonical migration/readiness documents. Independent logs:
`/tmp/curling-s6i-rereview-focus.log`, `/tmp/curling-s6i-rereview-probes.log`; parent
`/tmp/curling-s6i-focus-work.log`, `types-work.log`, `lint-work.log` (same prefix).
Git start/current main/allrefs382ee40,0 staged/85 modified; untracked187→191. No
Git mutation, device/personal-backup/configuration-value access, hosted change,
activation, installation or Beta approval. Overall import/fresh-auth mandate continues.


S6i complete baseline:372 files/8380 root tests PASS;139 browser cases PASS. Web
production build and full mobile10 files/277 tests plus typecheck/build PASS.
Default/Diagnostics/Native-storage actual builds15 bundle guards each PASS, Default
restored last. Positive ECONNREFUSED verifies the test server stopped before final
TypeScript. Final TypeScript, root/mobile lint and diff checks PASS. TypeScript
evidence is `/tmp/curling-s6i-types-final.log`; other baseline logs share prefix
`/tmp/curling-s6i-`: root-final,web-final,mobile-final,e2e-final,server-stop-final,
lint-final,mobile-lint-final and bundle-{default,diagnostics,native-storage}-tests-final.
Source helper/Swift bridge unchanged; no new device/native physical evidence.


### S6j — identity-only destination runtime (locally accepted)

The amended design, corrected independent CODE and full local regression are
accepted. The actual private identity-only runtime uses the same S6i SQL core,
lease/queue/handle and protected namespace/port, genuine runtime session and genuine
port preparation. Its exact canonical contract is MOBILE_APP_MIGRATION.md S6j.
No source identity/credentials are copied; ordinary sporting keys are refused.
It remains dormant in all three actual normal mobile build modes.

Eight independently confirmed P2 findings were corrected: preparation-work drainage;
acquired SQL method work/lookup ordering; statement-work-before-rollback ordering;
genuine disposal self-cycles in both lanes; sticky foreign inventory; boxed strict
credential validation; acquired-method cancellation ordering; and fresh observation
per newly issued native return, distinct from completion-only deduplication. All
12 independent witnesses are retained as repository tests (preparation tests use an
actual acquisition signal rather than a CPU-sensitive pre-acquisition delay).
The original synchronous preparation, publisher and platform observer default
behavior remain preserved.

Actual verification:

- Parent focused suite: 10 files / 637 tests PASS. Independent CODE: 14 files /
  1,083 tests plus four original platform/fingerprint files / 95 tests PASS; all
  12 independent adversarial witnesses PASS. Native identity suite has 52 cases.
- Full root suite: 373 files / 8,435 tests PASS; complete local Playwright: 139 PASS.
  Test-server termination positively established via ECONNREFUSED on port 3100.
- Web build PASS; mobile type/build/verification: 10 files / 277 tests PASS.
  An initial sandbox-blocked Chromium launch was rerun successfully with the
  required local browser permission; no application failure was established there.
- Actual diagnostics, native-storage and default mobile builds each pass all
  15 bundle guards; default artifact restored last. Transfer code is absent.
- Final TypeScript, root lint, mobile lint and git diff whitespace checks PASS.

Evidence: `/tmp/curling-s6j-*-final.log`; independent
`/tmp/curling-s6j-approved-focus.log`, `approved-platform.log` and
`approved-probes.log`. Real disposable SQLite, actual standard cryptography and
synthetic protected-bridge/server data only; no physical Keychain/iOS/power-loss
evidence. No original helper/Swift, configuration, actual phone or private backup
was changed or read in this stage. No Git index/commit/ref mutation.

Actual configured host integration, deliberate fresh OTP, immutable source-deny
facts for all affected Profiles, sporting publication, ordinary handoff/UI and
physical/hosted/Apple acceptance remain outstanding. This does not approve an
operative restoration, activation or Beta. Free/Personal/Team and Q1/Q3 stay as
adopted; Q4 remains a later understandable concrete acceptance decision.


### S6k — actual configured transfer identity host (locally accepted)

Amended independent DESIGN, corrected lower S6k1 and combined S6k2 CODE, and the
complete local baseline are accepted. The new dormant configured export uses the
genuine configuration binding, same actual shared native host/SDK/coordinator and
real S6j owners, without legacy source retirement, synthesized D or supplied pair.
It exposes only destination identity runtime; no sporting/Tracker registration.
Exact contract: MOBILE_APP_MIGRATION.md S6k; durable decision: ADR-0054.

The strict transfer port preserves legacy CommonPort/default settlement. It joins
acquired malformed dependencies/fields, observes each original return freshly in
boxes, excludes actual owner/host completion without a value or ACK and rechecks
currentness before acquisition. Four independent P2 groups/nine witnesses were
corrected in binding roots/descriptors, inventory metadata, detector work and
async capture/cancel ordering. One additional actual-host P2 self-cycle through
onboarding argument observation was corrected without changing legacy behavior.
All witnesses are retained in repository tests; unrelated malformed input still
drains before command/cleanup. Actual source faults and sticky SDK uncertainty
remain held. Only healthy store-cleanup failure is retryable; terminal SDK success
is cached separately from constructor disposal. Both store owners stay held for
store-only failure, while an independently positive healthy store cleanup may
retire despite sticky SDK reservation/evidence. Captured callbacks receive only
the frozen dependency receiver; recovery-code references are cleared on handoff
or terminal close. No transfer-specific runtime import enters shared legacy code.

Actual verification:

- Lower independent CODE: eight files/768 tests plus nine S6k1 and twelve S6j
  adversarial probes PASS. Combined independent CODE: eight files/602 tests and
  all three host/nine lower/twelve earlier probes PASS; types/scoped lint/diff PASS.
- Parent final focused six files/387 tests PASS; actual-host suite47 cases,
  expanded legacy host controls six files/371 tests PASS. Actual installed SDK,
  genuine configuration capability, real disposable SQLite, standard crypto and
  synthetic bridge/server/URL inputs exercise OTP/legal/onboarding, cold continuity,
  actual expiration/account-swap denial, cleanup and completion ownership.
- Full root:374 files/8509 tests PASS. Complete local Playwright:139 PASS (4.1m);
  test server positively stopped (ECONNREFUSED on127.0.0.1:3100).
- Web build PASS. Mobile verify/type/build:10 files/277 tests PASS. Actual
  diagnostics, native-storage and default builds each pass15 bundle guards;
  default artifact restored last. Transfer code remains absent in all three.
- Final TypeScript, root lint, mobile lint and git diff whitespace checks PASS.

Evidence: /tmp/curling-s6k-*-final.log; independent corrected review in this chat,
/tmp/curling-s6k2-corrected-code-focus.log and independent S6k1/S6k2 probe logs.
No real config value, phone/backup/account, hosted mutation, source helper/Swift,
flag/default, signing/install or Git index/commit/ref change. Start0staged/85modified/
192untracked entries; final0/85/194, solely the new actual-host test and synthetic
SQLite helper. All refs remain382ee40.

Actual OTP success here is identity establishment only. No fresh-OTP publication
proof exists yet; startup/trusted/background/onboarding admission cannot replace
it. Immutable source-deny for all archived Profiles, original deletion-guard nonce/
server-revision correlation, atomic sporting publication, normal handoff/UI and
source transport/external-writer/device/hosted/Apple acceptance still gate the full
import and Beta. Q4 is unapproved. Training-only backup is not a V3 archive.


### S6l1 — immutable source-denial metadata (locally accepted)

The separate actual admission evaluates the authenticated complete V3 through
real readonly identity repositories/preflight and retains all sporting Profiles
plus every deletion-guard Profile, including control-only Profiles. Exact original
nonces/revisions and positively validated fenced revisions survive in a bounded
canonical u16 projection with standard SHA256. Copied or cold structural facts
mint no handle or authority. The actual closed host owner alone persists this
projection insert-only on the same SQL core/lease/queue/connection, yielding its
exact 8-object layout. Runtime controls/anchors pin it; normal identity writes,
OTP and onboarding preserve it. Old 5/7-object factories refuse the new layout.

Independent a CODE and corrected combined CODE accepted. Two P2 opening groups
(three actual-host witnesses) were corrected: no initial open after cancellation,
and no raw async engine/connection unboxing that discards acquired work. Strict
source-only creation/open/configuration plus warm/fresh/reopen connection boxes
retain original receivers, actual acknowledgements and positive late cleanup;
legacy paths keep their behavior. All six bootstrap transactions capture methods/
rollback before BEGIN and drain malformed work before cleanup. No rollback after
COMMIT issuance and no completion-cache acknowledgement substitution.

Actually executed evidence:
- Independent combined: **9 files / 721 tests** and **29 adversarial/control
  probes** PASS, including all three opening witnesses and warm-connection drain.
- Parent focus: **7 files / 432 tests**, then complete updated source-identity
  suite **39 tests** PASS. Source-denial suite **59**, actual installed-SDK host
  suite **68**. Real disposable SQLite, synthetic bridge/API; no physical claim.
- Complete root: **376 files / 8,629 tests** PASS (350.10s).
- Complete browser: **139 tests** PASS (4.2m); actual port3100 ECONNREFUSED confirms
  positive test-server stop.
- Mobile verification: **10 files / 277 tests**, types and build PASS.
- Actual diagnostics, native-storage and default builds each **15 bundle guards**
  PASS; default restored last. Transfer markers absent in all normal builds.
- Web build, TypeScript, root/mobile ESLint and diff checks PASS.

Logs: `/tmp/curling-s6l1-*-final.log`; focused corrections
`/tmp/curling-s6l1b2-focus.log`, `/tmp/curling-s6l1b2-final-assertions.log`.
Canonical contract: MOBILE_APP_MIGRATION.md S6l1; durable decision ADR-0054.
Git main/all refs382ee40 unchanged,0staged/85modified/197untracked entries; three
new source-denial module/test/source-identity-test entries since S6k194. No index,
commit/ref, actual backup/phone/config/account/hosted/sourcehelper/Swift mutation,
activation, install/signing or Beta release. Actual fresh OTP provenance, original
nonce/server-revision guard recovery/source clearance, atomic sporting publication,
normal handoff/UI, original-container transport/external-writer exclusion and
physical/hosted/Apple acceptance remain subsequent gates. Q4 remains unapproved.


### S6l2 — actual fresh OTP provenance and same-runtime pin (locally accepted)

Amended independent DESIGN and corrected CODE accepted. The actual coordinator
mints a private opaque event only from its own successful email verification with
C6/C7 and same-invocation complete online Profile/gate/trusted-write/intent evidence.
Optimistic same-scope ready_online, stored sessions, generic Profile admissions,
startup/retry/background/refresh/Google and onboarding alone produce no such event.
Only the dormant source-aware host forwards it to the same actual source SQL
runtime; source binding, identity revision, accepted mutation enqueue sequence,
pending work, runtime/session/schema and immutable source facts pin an ephemeral
opaque stamp. Every new transition/accepted mutation revokes it synchronously;
first refused capture is consumed and old events cannot be repinned later.

Independent review found and corrected one P2: an additional public .finally()
Promise hid actual set/remove completion ownership and could deadlock a native
query and cleanup. Finalization now runs within the original genuine runtimeTask
completion after complete drain, exactly once. All three original witnesses and
positive unrelated-work/drain controls are retained in repository tests. No new
wrapper, schema, positive source identity, public grant, normal auth-policy/UI or
SDK modification. Existing old factory/runtime/host shapes remain.

Executed evidence, 26 October 2026:
- Parent and independent focused runs:7 files /392 tests PASS.
- Independent original deadlock witnesses:3 PASS; prior opening/host/metadata
  adversarial controls:19 PASS; independent types/scoped lint/diff PASS.
- New coordinator suite:27 tests; real same-owner SQLite/coordinator suite:13 tests;
  existing source-identity suite:42 tests; actual installed-SDK host suite:75 tests.
- Full root:378 files /8679 tests PASS (228.52s).
- Full browser suite:139 PASS (3.1min); positive test-server stop:ECONNREFUSED3100.
- Mobile:10 files /277 tests PASS, build/types included. All three actual build
  modes pass15 package guards each; default restored last. Web build PASS.
- Final TypeScript, root lint, mobile lint and git diff --check PASS.

Logs:/tmp/curling-s6l2-*-final.log; corrected parent focus:
/tmp/curling-s6l2-corrected-focus.log; independent focus/probes:
/tmp/curling-s6l2-corrected-independent-{focus,probes}.log. Real installed SDK and
real disposable SQLite use synthetic auth/bridge/archive edges. No physical iOS,
Keychain, power-loss or actual-account acceptance is claimed.

Canonical contract:MOBILE_APP_MIGRATION.md S6l2; ADR-0054. Main/HEAD/localmain/
originmain remain382ee40,0 staged/85 modified/199 untracked entries (two new suites
since S6l1). No index/ref/commit/push, real backup/config/phone/account/hosted
mutation, activation, signing, installation or Beta release. Complete linked
OTP→onboarding authentication, source-denial clearance and legitimate originalnonce/
serverrevision guard recovery, Profile mapping, atomic sporting publication,
normal handoff/UI, source transport/writer exclusion and physical/release gates
remain. Q4 is unapproved; Free/Personal/Team, Q1/Q3 and closed Free Beta unchanged.


### S6l3 — complete genuine OTP/onboarding continuation (locally accepted)

Amended independent DESIGN and corrected CODE accepted. Only the dormant actual
source-aware host requires full online verification even for returning trusted
accounts. Genuine OTP C6/C7 plus agreed actual incomplete Profile may retain a
private unfinished origin across legal/input/network retry and actual onboarding.
Completion re-proves original durable correlation, actual account/Profile, original
prior-account ordinary-intent cleanup, trusted writes and final currentness before
minting the same S6l2 proof. Ordinary paths retain their policy. Initial missing
legal documents/network failures with actual incomplete-Profile agreement recover
without another code; generic onboarding/startup/restore cannot create provenance.

Independent review found one P2: an older awaited restore response could erase a
newer rebased unfinished origin. Origin-specific retirement now requires the exact
original reference and both restore boundaries recheck currentness. The five
original independent probes plus stale/current denial controls are retained.
There is no source-guard clearance, Profile mapping or publication grant.

Executed evidence, 26 October 2026:
- Parent and independent focused:7 files /444 tests PASS.
- Independent default controls:2 files /65 tests PASS; original S6l3 probes:5 PASS;
  earlier adversarial/control probes:22 PASS; types/scoped lint/diff PASS.
- Coordinator suite:70 tests; actual installed-SDK source host suite:84 tests.
- Full root:378 files /8731 tests PASS (193.57s).
- Full browser:139 PASS (2.9min); positive server stop:ECONNREFUSED on port3100.
- Mobile:10 files /277 tests PASS with build/types. Actual diagnostics,
  native-storage and default builds pass15 package guards each; default restored
  last. Web build, final TypeScript, root/mobile lint and git diff --check PASS.

Logs:/tmp/curling-s6l3-*-final.log; corrected independent focus and probes:
/tmp/curling-s6l3-corrected-independent-{focus,probes}.log. Actual installed SDK
and disposable SQLite use synthetic auth/bridge/archive edges. No physical iOS,
Keychain, actual-account, power-loss or operational import acceptance is claimed.

Canonical contract:MOBILE_APP_MIGRATION.md S6l3; ADR-0054. Main/HEAD/localmain/
originmain remain382ee40;0 staged/85 modified/199 untracked entries. No Git/index/
ref mutation, actual backup/config/phone/account/hosted mutation, activation,
installation, signing or Beta release. Original source-denial clearance and
legitimate original-nonce/server-revision recovery, Profile mapping, atomic
sporting publication, normal handoff/UI, source writer exclusion/transport and
physical/release gates remain. Q4 is unapproved; Free/Personal/Team and Q1/Q3 unchanged.


### S6l4 — actual original source-guard recovery (locally accepted)

Amended independent DESIGN, S6l4a repository CODE and combined S6l4b CODE accepted.
The same actual source-aware host now uses original and destination deletion
constraints in both coordinator and actual account-first recovery service. Archived
F stays a negative floor; only actual conditional abort or exact pending-request
cancellation with strictly newer valid server fencing writes a destination receipt
for original Profile/nonce/revision. Both independent constraints remain required.
Actual validated destination receipts also raise the owner-wide negative floor;
control-before-first-load and later floor increases cannot weaken it. Same-Profile
nonce/revision contradictions and another Profile's receipts remain unavailable.

The sole existing control parser keeps effectsAllowed private. A refused floor
cannot suppress a definitive pending fact; it prevents guard effects/abort/cancel,
and after-control refusal prevents resolution. The private actual facet exposes
state/cancel only, never request/export or a public runtime field. Actual native
SDK Self/account binding, mapper, denial continuation, queue and work ownership
remain. Composite operations register exact completions before adapter work and
share one mutation claim; old reads detect even a completed intervening mutation.
Own completions are refusal, never ACK. New genuine OTP is required to obtain a
new proof after guard mutation; an old event cannot repin. No confirmed defects
remain in independent review. No source metadata, schema or ordinary policy change.

Executed evidence, 26 October 2026:
- S6l4a independent:3 files /203 tests and4 additional controls PASS.
- Combined parent and independent focus:8 files /462 tests PASS.
- Independent default:4 files /204 tests;3 new actual-host adversarial probes and
  31 earlier probes PASS. Parent default:3 files /209 tests PASS.
- New guard suite46 cases; actual installed-SDK host113; sole mapper21 cases.
- Full root:379 files /8814 tests PASS (237.49s (transform 6.74s, setup 0ms, import 42.67s, tests 336.70s, environment 61.93s)).
- Full browser:139 PASS (3.2m); positive server-stop ECONNREFUSED on port3100.
- Mobile:10 files /277 tests with build/types PASS. Actual diagnostics,
  native-storage and default builds each pass15 package guards; default restored
  last. Web build, final types, root/mobile lint and git diff --check PASS.

Logs:/tmp/curling-s6l4-*-final.log; focused parent/default:
/tmp/curling-s6l4b-{focus,default-controls}.log; independent focus/new probes:
/tmp/curling-s6l4b-independent-{focus,probes}.log. Real installed SDK/disposable
SQLite with synthetic API/bridge/archive. No physical iOS/Keychain/actual-account,
power-loss or operational import acceptance. Native adapter ownership, not a new
cross-tab CAS claim, excludes arbitrary concurrent guard writers.

Canonical contract:MOBILE_APP_MIGRATION.md S6l4; ADR-0054. Main/all refs382ee40,
0 staged/85 modified/201 untracked entries (one module and suite added). No index/
Git/ref, actual backup/config/phone/account/hosted mutation, activation, signing,
installation or Beta release. Original source-barrier clearance, actual Profile
mapping, atomic sporting publication, normal source-free handoff/UI, original
source writer exclusion/transport and physical/release gates remain. Q4 unapproved;
Free/Personal/Team, Q1/Q3 and closed Free Beta unchanged.


### S6l5 — source cleanup evidence and final server-control provenance (locally accepted)

Independent S6l5a DESIGN/CODE and separate S6l5b DESIGN/combined CODE accepted.
Strict source-denial v2 projects actual outstanding intent-cleanup debt through the
real read helper on the same immutable archive map; missing, malformed or failed
reads never imply absence. Same eight-object SQL layout. Prior canonical v1 targets
are refused unchanged before handoff, with all rows/protected values preserved.
The new v2 SHA256 domain and canonical closed cleanup union prevent old evidence
from masquerading as complete facts. This does not settle/replay source intent.

Only the actual final method=state ok/null path, after sole complete Control parsing,
Self/account/Profile binding and source revision floor checks, may produce private
server-control provenance. Its original genuine OTP event, actual Command intent/
flags, accepted enqueue token, SDK generation, coordinator Control and health remain
fixed. Every later accepted SDK command revokes synchronously even without changing
the credential generation; old observations cannot revive. SQL binds only its own
original current fresh stamp and consumes each first observation attempt. Accepted
SQL mutation revokes; successful recovery may require another genuine OTP and new
actual state, without a spurious host failure. Exact-void failures revoke before
genuine unrelated work drain; exact owned completions cannot form a cleanup cycle.
No public runtime field, extra RPC/parser or ordinary policy change. Helper producer
is dynamically loaded only in the unused transfer-prepare graph.

Executed evidence, 26 October 2026:
- S6l5a independent:6 files/395 tests,3 new adversarial controls and30 earlier probes PASS.
- Combined parent/independent:8 files/517 tests PASS. Parent ordinary controls:
  3 files/211 tests; independent ordinary controls:4 files/204 tests PASS.
- Independent:33 earlier probes and4 new actual SDK/SQLite adversarial probes PASS.
- Actual host133, source fresh-SQL24, source-denial78, source-identity46,
  source-guard46, sole mapper21, architecture99, coordinator70 cases PASS.
- Full root:379 files/8869 tests PASS (267.50s (transform 6.66s, setup 0ms, import 44.73s, tests 388.31s, environment 65.75s)).
- Full browser:139 PASS (3.3m); positive server-stop ECONNREFUSED on port3100.
- Mobile:10 files/277 tests with build/types PASS. Actual diagnostics/native-storage/
  default builds each pass15 package guards; default restored last.
- Web build, final TypeScript, root/mobile lint and git diff --check PASS.

Logs:/tmp/curling-s6l5-*-final.log; parent focus/default:
/tmp/curling-s6l5b-{combined-focus,default-controls}.log; independent:
/tmp/curling-s6l5{a,b}-independent-{focus,probes}.log. Real installed SDK/disposable
SQLite with synthetic API/bridge/archive. No physical iOS/Keychain/power-loss or
operational import acceptance. Canonical contract:MOBILE_APP_MIGRATION.md S6l5a/b;
ADR-0054. Main/all refs382ee40,0 staged/85 modified/202 untracked entries.

Original source-barrier eligibility/clearance and Profile mapping, atomic sporting
publication, normal source-free handoff/UI, source writer exclusion/transport and
physical/hosted/Apple acceptance remain. Source cleanup outstanding remains a
negative prerequisite, never automatically discharged. Q4 unapproved; closed Free
Beta and Free/Personal/Team/Q1/Q3 unchanged. No actual backup/config/phone/account/
hosted, index/ref/Git, activation/signing/installation/publication changes.


### S6m1 — protected publication intent and initial eligibility (locally accepted)

Independent DESIGN, corrected M1a CODE and corrected combined M1a/M1b CODE passed.
The private no-argument source owner prepares/observes an insert-only protected
intent after genuine current OTP/final Control. It verifies exact original Profile
membership/account correlation, all original rows and complete pair/source binding.
Quarantine/cleanup debt, missing/mismatched Profiles, stale proof or uncertain native
facts refuse. Cold intent validation precedes either draft activation; old intent
bytes/ID/C remain historical. The same eight SQL objects remain unchanged.
No ordinary sporting rows, SQL publication, Tracker, source-free host or UI grant.

Two combined-review defects were corrected: malformed actual native SQL work now
revokes original source stamps before unrelated work drain; exact SQL/credential
completions are registered before work on their genuine transfer session to exclude
same-queue cycles. Pure UUID/hash refusal and valid pending SQL preserve healthy
cleanup. Twelve regression witnesses exercise both defects and a healthy control.

Executed evidence, 26 October 2026:
- Parent combined/default focus:17 files/881 tests PASS; actual SDK host175 cases.
- Corrected independent combined focus:18 files/951 tests PASS; legacy SQL/core:
  2 files/350 tests;6 additional actual SDK/SQLite adversarial controls PASS.
- Full root:382 files/8993 tests PASS (265.02s).
- Full browser:139 PASS (3.2m); positive server-stop ECONNREFUSED on port3100.
- Mobile:10 files/277 tests with build/types PASS. Actual diagnostics/native-storage/
  default builds each pass15 package guards; default restored last.
- Web build, final TypeScript, root/mobile lint and git diff --check PASS.

Logs:/tmp/curling-s6m1-*-final.log; parent focus:
/tmp/curling-s6m1-correction-focus.log; independent:
/tmp/curling-s6m1-corrected-independent-{focus,legacy-core,probes}.log.
Actual installed SDK/disposable SQLite with synthetic protected/API/archive edges.
No physical Keychain/durability/installation/operational import acceptance or claim
for arbitrary indirect Promise graphs. Canonical contract:MOBILE_APP_MIGRATION.md
S6m1; ADR-0054. Main/all refs382ee40,0 staged/85 modified/206 untracked entries.

S6m2 is now separately locally accepted below. Next: normal source-free
handoff/Tracker/UI. Source writer exclusion/transport and physical/
hosted/Apple acceptance remain. Q4 unapproved; Free/Personal/Team/Q1/Q3 unchanged.
No actual backup/config/phone/account/hosted, index/ref/Git, activation/signing/
installation/publication changes.

### S6m2 — atomic SQL publication and actual source owner (locally accepted)

Independent DESIGN, corrected M2a CODE and corrected combined M2a/M2b CODE passed. The source owner performs a genuine new protected observation outside the original SQL queue, then the same actual core atomically copies every original u16 sporting row and exact protected intent/digest into the receipt/live layout. Original eight objects and rows remain unchanged. Its exclusive continuation consumes old stamps without restoring them, keeps queue ownership through cancellation/drain/reopen and pins the first complete durable layout/content/schema. Only healthy exact desired11 establishes the new identity-only runtime baseline. All source result may-fields remain false. No ordinary sporting adapter, source-free host or Tracker/UI grant is introduced.

Corrected adversarial findings are retained as actual SDK/SQLite regressions: precise outward context completion ownership; immediate cutoff on an already pinned schema contradiction; genuine post-accept observation ordering finalized after the last acquired-work drain; and sticky SQL-anchor failure during the new protected read distinguished from healthy cancellation. Physical issued-COMMIT outcomes are preserved after auth revocation/close, with no repair, second COMMIT or compensating deletion.

Executed evidence, 26 October 2026:
- Final parent combined/default/legacy focus:19 files/1324 tests PASS (95.97s). Actual host268 cases:63 M2a plus30 M2b additions to the accepted M1 host.
- Corrected independent combined gate:8 files/851 tests PASS, including the complete actual host, prior close/outcome/freshness/completion controls; TypeScript/scoped lint/diff PASS. Earlier broad combined independent20/1390 passed before the final four retained correction controls.
- Full root:382 files/9086 tests PASS (289.08s).
- Full browser:139 PASS (3.3m); positive server-stop ECONNREFUSED on127.0.0.1:3100.
- Mobile:10 files/277 tests with build/types PASS (9.28s). Actual diagnostics/native-storage/default builds each pass15 package guards; default restored last.
- Web build, final TypeScript, root/mobile lint and git diff --check PASS.

Logs:/tmp/curling-s6m2-*-final.log; parent corrected focus:/tmp/curling-s6m2-corrected-{focus,types,lint}.log; independent:/tmp/curling-s6m2-corrected-independent-*.log. M2a final gate:/tmp/curling-s6m2a-finalized-independent-focus.log. Actual installed SDK/disposable SQLite with synthetic protected/API/archive edges. No physical Keychain/durability, installation, operational import or Beta acceptance; no arbitrary Promise-graph guarantee. Canonical contract:MOBILE_APP_MIGRATION.md S6m2; ADR-0054. Main/all refs382ee40,0 staged/85 modified/206 untracked entries unchanged.

Source-free provenance is separately accepted in S6m3a below. Next: published paired runtime/negative guards and positive original SDK/store quiescence/configured normal host, then ordinary sporting/Tracker/UI composition. Source writer exclusion/transport and physical/hosted/Apple acceptance remain; Q4 is unapproved. Free/Personal/Team and Q1/Q3 unchanged. No actual backup/config/phone/account/hosted, index/ref/Git, activation/signing/installation/publication changes.


### S6m3a — cold published artifact provenance (focused local acceptance)

Independent DESIGN and corrected complete CODE passed. A separate closed owner recognizes actual exact11 from the same real SQL/protected stores without original file or recovery code. It validates original all-Profile/u16 evidence, canonical protected M/I/t1, fixed standard wire/prepared/source/anchor hashes and a complete post-hash static reread before its last-drain/currentness proof mint. No live enumeration, source retention cap, fake original source handle or supplied readiness. All public may-fields remain false; no SDK, runtime, normal host or Tracker/UI grant.

Executed evidence,27 October2026:
- Corrected parent combined source/default/legacy focus:29 files/1775 tests PASS(167.83s), including all345 actual SDK/SQLite host cases and77 new M3a controls.
- Corrected independent CODE:8 files/931 tests PASS, all345 host cases including9 capture regressions; TypeScript/scoped lint/diff PASS. Prior independent full audit16 files/1338 passed and identified one capture-P2 group, now corrected.
- Parent final TypeScript/scoped lint/diff PASS. Exact architecture/protocol matrix127 passed before the capture-only correction and is included in both final combined gates.

The capture correction retains acquired root work even when inadmissible, validates every field before later acquisition and stops descriptors immediately after close. Permanent controls also cover native throw/uncertainty, held hash/protected static/schema drift, direct genuine cross-lane completion exclusion, positive cleanup/reacquisition and SDK-only-held reservation. Actual installed SDK/disposable SQLite with synthetic API/protected/archive edges only. No arbitrary Promise-graph containment or continuous physical storage monitoring claim.

Logs:/tmp/curling-s6m3a-corrected-parent-focus.log,/tmp/curling-s6m3a-corrected-independent-focus.log,/tmp/curling-s6m3a-corrected-{capture,types,lint}.log. Codec supervised children use the established writable scratch HERMES_S2_TEST_SCRATCH=/tmp/curling-beta-s2; an initial omitted scratch failed6 harness cases, followed by fully passing corrected combined runs. Latest whole-application baseline remains the historical accepted S6m2 baseline above. Full combined M3 baseline follows M3c actual host CODE; no operative import/device/Beta acceptance. Main/allrefs382ee40,0 staged/85 modified/208 untracked; no Git mutation. Two new production files:installationPublishedBinding.ts and installationPublishedOwner.ts. Actual backup/config/phone/account/hosted, activation/signing/install/release unchanged. M3b/c and remaining source/physical/release gates stay open; Q4 unapproved, Free/Personal/Team and Q1/Q3 unchanged.


### S6m3b1 — published SQL runtime (focused local acceptance)

Independent CODE PASS on27.10.2026. Production changes are the closed published SQL runtime and private installationPublishedLiveCodeUnits.ts; existing source/default runtime paths remain unchanged. Actual SDK/SQLite tests use the existing real credential preparer/publisher solely as an activation harness.

- Corrected parent focus:29 files/1835 tests PASS(163.03s), including405 host cases and60 new M3b1 cases. Targeted60/60 PASS; architecture101 PASS.
- Independent complete focus:14 files/1311 tests PASS(225.72s), plus4 actual SDK/SQLite adversarial probes PASS(3.24s). Private live codec independently round-tripped all65,536 UTF-16 code units, empty value and10 malformed inputs.
- TypeScript, scoped ESLint and git diff --check PASS in both reviews.
- Parent adversarial review corrected late final-drain read/write/anchor success and evidence, and failed-close retry; all corrected regressions pass. Independent final review found no remaining confirmed defect.

Logs:/tmp/curling-s6m3b1-corrected-parent-focus.log,/tmp/curling-s6m3b1-corrected-adversarial.log,/tmp/curling-s6m3b1-corrected-{types,lint}.log,/tmp/curling-s6m3b1-independent-*.log. Independent temporary probes/config removed. Main/allrefs382ee40;0 staged/85 modified/209 untracked, no Git mutation. M3b2 actual owner/credential/negative guards and M3c configured SDK/normal host remain separately gated; full combined application baseline follows M3c. No real-data/device/activation/Beta acceptance; Q4 remains unapproved.


### S6m3b2 — paired published owner and source-negative guards (focused acceptance)

Corrected independent CODE PASS27.10.2026. Complete actual467-host review includes62 new M3b2 controls, with real disposable SQLite/installed prior-publication SDK and synthetic protected/API edges. New owner handoff is store runtime only, never actual new SDK/application admission.

- Independent corrected focus:14 files/1374 tests PASS, including all467 host cases. Separate actual mapper/guard controls:3 files/30 PASS; eight additional independent actual SDK/SQLite lifecycle/ownership/cold/recovery probes:8/8 PASS.
- Parent new/relevant controls:3 files/64 PASS; corrected recovery4/4 PASS. Parent broad scope30 files/2119 cases:29 files/1652 PASS plus465 host PASS; two initial mapper-test expectations reused old Control11 after obtaining Fence12. Corrected targeted4/4 proves separate repositories remain usable and the same call renews Control12. This is separate-run evidence, not a claimed single all-green30-file invocation. Independent corrected whole-host focus above passes the actual final tree.
- Full architecture101/101 PASS; final parent and independent TypeScript/scoped ESLint/diff PASS.
- One independent P2 group corrected: a downgraded valid different-nonce receipt correctly denied admission but had made legitimate higher server recovery unavailable. The exact valid destination guard now remains unresolved; both same/different nonce recover through the actual mapper. No unresolved confirmed defect.

Logs:/tmp/curling-s6m3b2-{parent-focus,architecture,adversarial-final}.log,/tmp/curling-s6m3b2-corrected-{parent-focus,recovery,types,lint}.log,/tmp/curling-s6m3b2-corrected-independent-*.log. Temporary independent probes removed. Production surfaces:installationPublishedOwner.ts,nativeCredentialMigrationPort.ts,nativeCombinedRuntime.ts,installationTransferSourceGuards.ts; exact tests in architectureBoundary,installationTransferIdentityHost,installationTransferSourceGuards. Main/allrefs382ee40;0 staged/85 modified/209 untracked; no Git mutation. Full combined application baseline remains after M3c configured host/SDK CODE gate. No real backup/archive/phone/account/hosted/activation/install/Beta acceptance. Q4 unapproved; Q1/Q3 and Free/Personal/Team unchanged.


### S6m3c — actual configured published host (independent CODE accepted)

Independent DESIGN and complete CODE PASS27.10.2026; no remaining confirmed defect. The distinct dormant host now uses the existing actual SDK/coordinator/account/Profile/sporting/Tracker pipeline on the same genuine published stores. Original publication account/Profile data is historical; later legitimate current admission is possible. Actual policy/domain I/O drains before physical pair closure, including direct pair.dispose and the host's pair cleanup target. The original SDK root fence remains: true new-process evidence replaces any in-process reset claim.

Focused executed evidence:
- Final parent combined source/default/legacy/account/Tracker/persistence/architecture regression:35 files/2396 tests PASS(288.96s), including all501 actual-host cases and34 new M3c controls.
- Independent complete focus:20 files/1531 tests PASS(231.24s), including all501 host cases and actual fresh-PID SDK/SQLite children. Three additional independent real cold-child probes:3/3 PASS(7.94s): factual Pending-Control with denial/effects, direct actual account completion at the SQL native edge, and close while actual denial-barrier DML is held. No physical close precedes settlement.
- Parent and independent TypeScript/scoped ESLint/diff PASS. Independent temporary probes/config/child copy removed.

Logs:/tmp/curling-s6m3c-parent-focus.log,/tmp/curling-s6m3c-{types,lint}.log,/tmp/curling-s6m3c-independent-*.log. Synthetic protected/API edges, installed genuine SDK and real disposable SQLite only. The permanent child uses the same actual database file and coherently updated synthetic protected values across different actual PIDs; module resets are not cold SDK proof. Controlled SDK initialization-close warnings are intercepted only for the exact genuine expected retryable failure; unexpected logs remain failures.

Production surfaces:supabaseAuthService.ts,installationPublishedOwner.ts,nativeCombinedRuntime.ts. Tests:installationTransferIdentityHost.test.ts,architectureBoundary.test.ts,tests/native/publishedInstallationHostChild.mjs. Main/allrefs382ee40;0 staged/85 modified/209 untracked; no Git mutation. Whole-application combined M3 baseline is recorded separately below only after completion. Application/UI composition, original source writer exclusion/transport and physical/configuration/hosted/Apple acceptance remain open. Q4 unapproved; Q1/Q3 and Free/Personal/Team unchanged. No actual backup/phone/account/hosted/activation/install/Beta acceptance.

#### Combined M3 whole-application baseline,27 October2026

After independent M3c CODE acceptance, the complete current M3 tree passed:
- Root:382 files/9323 tests PASS(363.12s).
- Browser:139 PASS(3.2m); subsequent positive server-stop ECONNREFUSED on127.0.0.1:3100.
- Mobile:10 files/277 tests PASS(9.37s), with actual build and mobile TypeScript.
- Actual diagnostics/native-storage/default packages each pass15 bundle guards; default restored last.
- Web build, final root TypeScript, root/mobile ESLint and git diff --check PASS.

Logs:/tmp/curling-s6m3-{root,web,e2e,server-stop,mobile,types,lint,mobile-lint}-final.log and /tmp/curling-s6m3-bundle-{diagnostics,native-storage,default}-{build,tests}-final.log. This supersedes M2 as the latest whole-application baseline. It proves the actual local synthetic boundaries exercised, not physical Keychain, operative source transport, mounted published UI, installation or Beta acceptance. All remaining gates stated above remain.


### S6m3d — actual published App composition (corrected independent acceptance)

Independent DESIGN and corrected complete CODE PASS27.10.2026; no remaining confirmed defect. This is test-only integration of the existing explicit App tree with the genuine M3c published Host. Actual React/DOM controls drive real Provider startup/OTP, admitted Profile repositories and Tracker in fresh installed-SDK processes against the same real disposable SQLite file and coherent synthetic protected storage. No production root/caller is activated.

Ten permanent cases cover original Current/history/plans and Profile isolation, actual train/save/complete plus a second cold process, StrictMode, original Current resume, pending deletion/fresh OTP, Q1 same-session continuation, held hydration cancellation, settled original guard recovery and denied low Control, and actual native domain failure. Both browser storage surfaces are independently monitored even when the app catches an exception. The SDK's one import-time capability probe is counted and refused; it never stores credential data. The public diagram cache proves an empty-cache miss, compatible DOM Blob/FileReader conversion, actual PNG write and a new resolver hit without another fetch.

Two initial review findings are corrected: cache read attempts had not proved a successful write/hit; and observing an Account request had been mistaken for completed recovery. Awaiting the genuine settled Account Control pipeline makes the existing real Try again reach Home/Scope with one OTP verification. The unnecessary additional sign-in form and its two component cases were withdrawn. This does not prove automatic UI polling alone completes recovery. Low Control remains denied without conditional Abort, and uncertain/domain cleanup retains actual evidence-held resources.

Executed evidence:
- Final parent full root:382 files/9333 tests PASS(331.09s).
- Corrected parent new UI focus:10 PASS/501 skipped(39.88s); complete Host now511 cases.
- Corrected independent combined focus:14 files/826 tests PASS(271.18s), including all511 Host cases and all10 M3d UI cases.
- Additional independent process probe PASS: stored PNG bytes exactly match the repository asset, new resolver performs no fetch, and caught identity/late capability/network refusals remain independently observed.
- Parent TypeScript, full root/mobile ESLint and diff PASS; independent TypeScript/scoped ESLint/diff PASS. Temporary independent probe removed.

Logs:/tmp/curling-s6m3d-root-final.log,/tmp/curling-s6m3d-corrected-{ui,types,lint,mobile-lint}.log,/tmp/curling-s6m3d-corrected-independent-{focus,cache,types,lint}.log. The complete M3c web/139-E2E/mobile277/three-mode15-each/default-last baseline above is the same production state; those runs preceded this test-only stage and were not rerun or relabeled. The new complete root run is current.

Changed M3d executable files are test-only:tests/native/publishedInstallationAppUi.mjs,tests/native/publishedInstallationHostChild.mjs and installationTransferIdentityHost.test.ts. Existing iOS/validation production work is preserved. Main/HEAD/main/origin-main remain382ee40,0 staged/85 modified/209 untracked; no Git mutation. No further implementation defect is established within the accepted local M3d design. Next is the separately gated operative source procedure: actual original-container access/preservation and external-writer exclusion, protected file/code delivery and target operation, disposable physical evidence, configuration and remaining hosted/Apple acceptance. Q4 remains unapproved. Synthetic DOM/native/API edges are not iPhone, visual, Keychain or operative import/Beta acceptance. Free/Personal/Team and Q1/Q3 are unchanged; no real backup/config/phone/account/hosted/activation/install changes.


### S6n1 — actual destination application controls (focused independent acceptance)

Corrected independent DESIGN and complete CODE PASS27.10.2026. A distinct application Host exposes genuine source-owner preparation/publication and limited Account getState/cancel without supplied proofs, Profile mapping, fake full services or Ready values. Recovery remains usable before ordinary admission. Its exact publication completions register before native acquisition in the existing Host exclusion/drain path; post-COMMIT SQL facts are preserved through Close/auth loss. Old factory return shape and default/source/SDK policy stay unchanged. This connects real target controls, not a shipped root or operative source transfer.

Executed evidence:
- New parent public-control cases:12 PASS(4.95s), no private Owner spies. Entire actual Host now523 cases.
- Initial parent broad11 files/1054 cases:1053 PASS including all523 Host cases; one architecture assertion still allowed only the prior two publishPrepared callers. The new named Host delegation is the intended third caller. Explicit whitelist corrected; subsequent complete101 architecture controls PASS(9.27s). This is separate-run evidence, not one all-green broad invocation.
- Independent complete focus:13 files/1260 PASS(303.37s), including all523 Host cases and Source/Port/Runtime/Default/architecture controls.
- Additional independent actual SDK/SQLite probes:4 PASS(3.30s): lost COMMIT response before/after actual commit preserves fault_held with before8/desired11; newer SDK command overtakes preparation without storage poisoning; direct exact public cancel completion at native SQL is exclusion-only without cycle/ACK.
- Parent and independent TypeScript/scoped ESLint/diff PASS. Initial direct-completion test used an async fixture fault-hook alias, causing two timeouts; corrected to exact direct captured native returns, with no production change. Temporary independent probes/config removed.

Logs:/tmp/curling-s6n1-focus-{initial,corrected,final}.log,/tmp/curling-s6n1-parent-focus.log,/tmp/curling-s6n1-architecture-{initial,final}.log,/tmp/curling-s6n1-{types,lint}-final.log,/tmp/curling-s6n1-independent-{focus,probes,types,lint}.log. Production files:supabaseAuthService.ts and installationTransferPairing.ts; tests:installationTransferIdentityHost and architectureBoundary. Main/allrefs382ee40,0 staged/85 modified/209 untracked unchanged; no Git mutation or real data/config/device/hosted/flag operation. New File/Provider UI remains N2 DESIGN, and the current whole-application baseline remains explicitly historical M3 plus current M3d root; final whole verification follows the connected product change. Source container/writer exclusion, operative delivery, actual configuration/physical/hosted/Apple and Q4 gates remain open. The requested unavailable second-device comparison is omitted, not passed and not a reset/Beta waiver. Free/Personal/Team and Q1/Q3 unchanged.


### S6n2 — complete explicit destination File/Provider workflow (corrected independent CODE accepted)

Corrected independent DESIGN/CODE PASS27.10.2026, no remaining confirmed defect. Actual File/code intake, genuine Provider OTP/onboarding and limited Account recovery feed the N1 controls on the same actual Host. Confirmed atomic publication plus positive cleanup requires a genuinely new process; that process uses the actual published Host and normal Tracker to read, train, save and cold-reload. This is a concrete explicit destination composition, still unselected by the shipped root. Canonical contract: MOBILE_APP_MIGRATION.md S6n2.

Executed scoped and independent evidence:
- Parent pre-final-correction combined focus:14 files/826 tests PASS(318.06s), including545 Host cases. After the immediate Reader-Close fence,23 N2 cases PASS/523 skipped(25.39s),546 total Host cases.
- Initial independent complete focus:18 files/1276 PASS(303.48s). Seven additional actual probes produced six failures in two P2 groups and one positive COMMIT+Close control. Masked native Promise Options containers were copied into valid plain snapshots; invalid/throwing readyState observations could claim closed before actual held Reader delivery.
- Both groups corrected: intrinsic native Promise rejection before field copying with full acquired-work drain; actual read delivery separated from metadata refusal, with positive EMPTY as the only no-issuance state. Read-throw before/after issuance and repeat Close are covered. Seven reviewer probes plus two read-throw cases are permanent. Corrected parent9 regressions PASS/546 skipped,555 total(3.07s); preceding30 N2 cases PASS/523 skipped(24.76s) before the last two read-throw additions.
- Corrected independent entire Root:382 files/9377 tests PASS(452.02s), including all555 Host cases. This is the current whole-root baseline, not a relabeled earlier run.
- Four additional independent actual controls PASS(1.94s): masked URL/engine Promise metadata with Close, actual Reader delivery before held metadata settlement, and real Abort after read-throw. Actual COMMIT+Close preserves publication_confirmed/dataStored/restart. Parent and independent types/scoped lint/diff PASS.
- Four permanent joined UI cases use real React/JSDOM, installed SDK, actual disposable SQLite and coherent synthetic protected/API edges. Actual controls drive onboarding, source guard recovery and explicit re-signin, pending deletion/cancel and low-Control denial. Three genuinely different PIDs cover import, normal UI training/save and cold read. Exact all-Profile initial-copy observation exceptions admit only once-per-original-key expected u16 values; independent rawSQLite readback checks original sporting values after publication. No later Profile access exception exists.
- Actual Chromium File/Blob native getter/reader check rejects plain Blob, shape and Proxy. Static actual React initial markup with the current mobile CSS passes320/390/1024-width overflow/44px checks and visual inspection. This layout check is not an actual Chromium joined SDK/SQLite flow or physical iPhone proof.

Logs:/tmp/curling-s6n2-parent-focus.log,/tmp/curling-s6n2-cutoff-focus.log,/tmp/curling-s6n2-review-corrections.log,/tmp/curling-s6n2-regressions-final.log,/tmp/curling-s6n2-independent-{probes-final,focus}.log,/tmp/curling-s6n2-corrected-independent-{root,probes,types,lint}.log. Actual native-brand evidence:/tmp/curling-s6n2-native-file-brand.log; inspected synthetic screenshot:/tmp/curling-s6n2-ui-390.png. Temporary independent test/config/generator files removed. Initial parent fixture/architecture/type/lint failures were corrected before acceptance; no failing invocation is counted as a passing whole run.

Production surfaces:installationTransferApplication.ts,InstallationTransferFlow.tsx,optional IdentityProvider.accessRecovery plus bounded architecture/default bundle guards; actual UI child helpers and permanent Host tests. Main/allrefs382ee40;0 staged/85 modified/211 untracked. No Git mutation, .env.local inspection, real backup/archive/account/phone/hosted/config/flag/source-helper change or device installation. Default native activation barrier remains. Operative protected source creation/delivery and original-container/writer exclusion, actual configuration/physical/hosted/Apple and Q4 gates stay open. A training-only real backup is not V3 identity-source evidence. The unavailable second-phone comparison is omitted, not passed. Free Beta, Team != Personal and Q1/Q3 are unchanged; no operative import or Beta acceptance.


#### Combined S6n destination-workflow baseline,27 October2026

After corrected independent N2 CODE acceptance, with no later executable edits:
- Independent full Root:382 files/9377 tests PASS(452.02s), all555 actual Host cases, plus4 independent extra controls PASS. Parent does not duplicate or relabel that unchanged full run.
- Parent Web production build PASS; full Playwright139 PASS(3.2m). Positive subsequent ECONNREFUSED on127.0.0.1:3100 confirms test-server shutdown.
- Parent mobile verify:10 files/277 tests PASS(6.78s), actual build and mobile TypeScript PASS. Initial invocation without the configured local browser path had9 files/263 passed and14 browser cases skipped under a failed suite; it is not counted as successful. Repeating with the already installed local Chromium path passes all277 without code changes.
- Actual diagnostics/native-storage/default packages each build and pass15 bundle guards; default restored last. These guards also exclude the new concrete destination workflow from the normal package.
- Final root TypeScript, full root/mobile ESLint and git diff --check PASS.

Logs:/tmp/curling-s6n2-corrected-independent-root.log,/tmp/curling-s6n2-{web,e2e,server-stop}-final.log,/tmp/curling-s6n2-mobile-corrected-final.log,/tmp/curling-s6n2-{types,lint}-final-full.log,/tmp/curling-s6n2-mobile-lint-final.log and /tmp/curling-s6n2-bundle-{diagnostics,native-storage,default}-{build,tests}-final.log. This supersedes the older M3 whole-application baseline for the current local destination code. Documentation reconciliation only follows. Genuine synthetic SDK/SQLite/DOM/browser evidence remains separate from operative original-container/writer exclusion, protected source-file/code delivery, shipped entry/configuration, physical Keychain/Brower, hosted/legal/worker/permissions/old-client and Apple acceptance. No real backup, phone, account, hosted data, native flags or source helper changed; no installation or Beta grant. Q4 and the omitted second-device comparison remain as stated above.


### Dormant strict new-user host — corrected DESIGN, CODE and final local baseline accepted

The user separately authorized the durable exact
`auth-js/2.112.3:credential-v1:empty-source-v1` contract after independent review
reproduced why unchanged historical Q/M/D inventories could not prove strict
origin. Corrected independent DESIGN passed. The named configured new-user host
now atomically initializes schema+tagged Q on the existing owner, refuses populated/
unknown sources and ambiguous native residue, resumes genuine tagged initialization
and reopens established tagged native authority without legacy access. Canonical
contract: BETA_COMPLETION_SPECIFICATION.md “Atomic empty-source bootstrap”.
No shipped mobile root/flag or original source helper changed.

Independent review:
- First atomic DESIGN: one confirmed P1 historical-origin ambiguity; real installed
  SDK/disposable-SQLite counterexample1 file/2 cases PASS(1.12s), fresh module/host
  lifetime only. Corrected tagged design was explicitly user-authorized and passed
  a NEW independent DESIGN reviewer. Legacy parser defaults remain exact; widening
  transfer/import admission was specifically avoided.
- One fresh independent CODE round: no confirmed actionable defects. Actual complete
  scoped owner/source/SQL/port/host/runtime/tests/docs reviewed read-only;3 files/214
  tests PASS(92.11s), including all50 new-user cases; independent diff PASS. No
  corrective production change followed this review. Parent subsequently completed
  the full final baseline on the identical executable state.

Final actual parent verification:
- Focus5 files/373 tests PASS(31.13s), including50 new-user cases. Installed SDK and
  actual disposable SQLite with synthetic protected/API edges. Genuinely distinct
  PIDs cover process stops before/after first COMMIT, after actual M creation,
  manifest_confirmed/copying/credentials_verified/bound phases, then native Profile
  save and another source-free cold read. Same config passes; changed key/project/
  URL framing refuses. Held SQL/protected Close, duplicate Start, unknown COMMIT/
  DDL acknowledgement and actual reopen, source changes and malformed/unavailable/
  orphan/mixed/legacy evidence are covered without injected Ready verdicts.
- Full Root383 files/9427 tests PASS(419.09s):
  `HERMES_S2_TEST_SCRATCH=/tmp/curling-beta-s2 npm test -- --maxWorkers=2`.
  Same tests and original timeouts; no test filter, skipped case or code edit.
- Full Playwright139 PASS(3.3m), existing local Supabase test database reset via the
  documented preflight and installed local Chromium. The test server subsequently
  returns ECONNREFUSED on127.0.0.1:3100, confirming shutdown. No hosted data changed.
- Mobile verify10 files/277 tests PASS(21.12s), including actual default build,
  typecheck and all browser cases. Full mobile lint PASS. Installed browser path:
  /tmp/curling-beta-playwright. No new tool download.
- Web production build PASS; final root TypeScript PASS; full root lint PASS;
  git diff --check PASS. Actual default mobile bundle contains neither new entry
  name nor empty-source-v1 tag; existing bundle/architecture gates pass.

Failed/intermediate evidence, not counted as passes:
- Initial new-test failures included overbroad assertions against PRAGMA I/O and
  pre-existing fixture events. Fixed assertions observe only scoped effects.
  A protected-read failure additionally exposed the need to read manifest absence
  before the new bootstrap; this real preflight check was added before final
  focus, independent CODE and all baseline results above.
- Initial Web build could not fetch existing Google fonts inside the network
  sandbox; identical build outside that sandbox passed. Initial mobile browser
  launch failed macOS MachPort permission inside the sandbox:9 files/263 cases
  passed,14 browser cases skipped under a failed suite. Identical full mobile
  command with installed browser and required permissions passed all277.
- Initial default-parallel full Root ended383 files with380 passed/3 failed;
  9417 tests passed/10 failed(441.66s). Nine failures explicitly hit5000ms timeouts
  in architecture/native UI; one later UI case missed the Email address label.
  Full unchanged-code repeat with two workers and required local permissions passed
  all9427 at unchanged timeouts. No claim that the first invocation passed, and no
  timeout increase or production workaround was introduced.

Logs:/tmp/curling-new-user-{focus-before-review,independent-code-review}.log;
/tmp/curling-new-user-baseline-{root,root-limited,build,build-retry,mobile,mobile-retry,
mobile-lint,e2e,types-final}.log; full lint before review:
/tmp/curling-new-user-lint-before-review.log. Initial source-origin independent
probe:/tmp/curling-atomic-origin-independent.log. Temporary test state is synthetic;
no real accounts, backups, original installation or credentials were used.

Starting/final refs:main/HEAD/main/origin-main382ee40. Starting0 staged/85 modified/
211 untracked entries; final0 staged/85 modified/212 untracked entries. Initial
SHA256 file inventory confirms no pre-existing non-environment file changed outside
the11 intended files; two new test/helper files were added (one lies within an
already-untracked directory). No Git mutation, activation, device installation,
signing, upload, deployment, invitation or publication occurred. New-user entry is
locally accepted within this dormant stage; actual mobile-root/configuration wiring
is the NEXT bounded task. Physical Keychain/phone, actual configuration/hosted/legal/
Apple and Q4 remain separate open gates. External TestFlight availability is not
claimed. Original-data/import/published behavior and Free/Team/Q1/Q3 rules remain.


### Actual mobile new-user beta entry — independent CODE and full local baseline accepted

The user requested continuation after the accepted dormant stage. A distinct
build selection now connects actual MobileApp to the genuine configured new-user
host and shared native identity/Tracker. No actual configuration or installation
is changed. Default and historical native-storage builds preserve their selection.
Canonical contract: BETA_COMPLETION_SPECIFICATION.md “Mobile new-user entry integration”.

Initial focused evidence: actual root-owner/SDK/disposable-SQLite controls, genuine
new-process reopening, React StrictMode UI OTP/onboarding/training, real browser
artifact selection and non-iOS/config refusal. The installed SDK's existing
module-time lswt/debug diagnostic is independently observed. A throwing diagnostic
read exposed an uncaught dependency-load failure; mobile bootstrap now catches it
and shows fixed blocked copy. The SDK remains unchanged. Unsupported diagnostic
leftovers refuse strict fresh-source admission. No absolute zero-browser-access
artifact claim is made. Full final review/baseline evidence follows when complete.


First independent CODE review found one P1: the generic Web configuration resolver
accepts HTTP provider endpoints, so this new native selection could deliver OTP
and bearer requests to a cleartext transport. The correction is confined to the
new entry: require HTTPS before provider preparation/native stores. The shared
resolver and existing dormant constructors are unchanged. An actual-owner HTTP
regression verifies blocked state with zero native/transport I/O. The reviewer
also requested precise host/application-store wording for the SDK import limit;
that comment is corrected. Initial review independently ran3 files/171 tests,
2 UI files/15 tests, one actual HTTP counterexample and diffcheck; no other confirmed
material findings. Fresh corrected review and final baseline remain required.


Second independent CODE review accepted the HTTPS correction but confirmed P2:
a direct protected configure callback returning application.close() could pass the
host disposal completion into the lower observer, cyclically waiting for its own
startup. Application Close now ALWAYS returns void, revokes the host synchronously
and privately observes its factual cleanup; terminal snapshots carry the closed
cleanup result. No host interface, store observer or durable protocol is changed.
Tests/teardown wait for terminal snapshots, including sticky cleanup failure,
rather than awaiting void Close. Direct native configure and pre-host digest
regressions exercise the actual edge; no async wrapper masks the return.
Second reviewer independently passed3 files/172 tests,2 UI files/15 tests and the
7 real artifact/browser cases; its2 extra probes exposed the cycle (1pass/1fail).
A sandbox local-server EPERM attempt skipped7 cases and was repeated successfully
outside sandbox. Fresh third review/final baseline remain required.


Third independent CODE review found no remaining confirmed actionable defects in
scope. Independently executed3 files/174 tests PASS(44.67s), including both direct
Close-return regressions, actual owner cold process, all50 strict host cases and
architecture guards; actual beta/default UI2 files/15 tests PASS(6.33s); diff PASS.
Full artifact/browser checks were not repeated by this reviewer; no physical,
hosted or Apple acceptance follows. Logs:/tmp/curling-mobile-entry-review3-focus.log
and /tmp/curling-mobile-entry-review3-ui.log. No executable changes follow this
accepted review.

Final unchanged-code evidence already completed: mobile verify(type/build and
12 files/285 tests PASS,6.52s), full Playwright139 PASS(3.2min), Web build PASS,
root types and full root/mobile lint PASS. ECONNREFUSED on127.0.0.1:3100 positively
confirms the browser test server stopped before final Web build/types. Separate
actual opt-in beta build PASS(661ms), retained at /tmp/curling-new-user-beta-final;
mobile/dist remains the verified default build. These are local generated artifacts,
not a signed or installed candidate; actual configuration values were neither
inspected nor assigned. Final complete root-suite repetition PASS:384 files/9450 tests,393.32s,
zero failures/skips. This is the final unchanged-code run, not the failed intermediate run.

The first parent full root run began before the last corrections and overlapped
other checks:384 files/9448 tests,383 files/9447 tests PASS, one existing N2 import
recovery test hit its5000ms timeout and teardown ENOTEMPTY(421.03s). That is a failed
intermediate run, not final acceptance. The final complete run uses2 workers with
no concurrent build/review/browser checks, unchanged time limits and no filtering.
Initial local browser-bundle setup used the wrong config path(1 suite failed,
7 skipped); corrected path then exposed the SDK debug-read failure(6 passed,
1 timeout), which is fixed at bootstrap. Final actual-browser7 and full285 mobile
cases pass; none of those earlier failed/skipped checks are relabeled.

This stage changes exactly20 paths relative to the preserved stage-start manifest
(/tmp/curling-mobile-entry-start/hashes.json). Existing out-of-scope source bytes
are unchanged. Files:

- docs/BETA_COMPLETION_SPECIFICATION.md
- mobile/__tests__/newUserBetaBundle.test.ts
- mobile/__tests__/newUserBetaRoot.test.tsx
- mobile/newUserBetaFlag.ts
- mobile/src/storage/NewUserBetaRoot.tsx
- src/components/persistence/DormantNativeTrackerComposition.tsx
- src/lib/supabase/__tests__/nativeNewUserMobileFixture.ts
- src/lib/supabase/__tests__/newUserMobileApplication.test.ts
- src/lib/supabase/newUserMobileApplication.ts
- tests/native/newUserMobileChild.mjs
- docs/MOBILE_APP_MIGRATION.md
- docs/TESTFLIGHT_READINESS.md
- mobile/README.md
- mobile/src/MobileApp.tsx
- mobile/src/main.tsx
- mobile/vite.config.ts
- mobile/vitest.config.ts
- package.json
- src/lib/persistence/__tests__/architectureBoundary.test.ts
- src/lib/supabase/supabaseAuthService.ts

Git start: main, all refs382ee40d37605b302c11b6390305857c7e2c3fde,
0 staged/85 modified tracked/212 untracked porcelain entries(223 files with-uall).
Current: same branch/refs,0/89/219 entries(231 untracked files). The4 additional
tracked modifications are MobileApp/main/Vite/Vitest configuration; all pre-existing
changes remain. No staging/commit/reset/stash/branch/patch/PR/push. No Capacitor
sync/install, original iPhone access/change, signing, upload, invitation, hosted
change, deployment or distribution. Local E2E resets only disposable local Supabase
state. Default/legacy barrier and original source/transfer helpers are preserved.
Physical iPhone/Keychain/WKWebView, actual secure hosted configuration, current legal
publication/registration, worker/permissions, Apple review OTP and TestFlight
acceptance remain separate. Q4 stays unapproved; personal old-data import is separate.


Final acceptance: third independent CODE review plus ALL required unchanged-state
checks pass. Full root384 files/9450 tests(393.32s); Playwright139(3.2min); mobile
12 files/285 tests(6.52s) plus type/build; Web and separate beta builds; final root
types, complete root/mobile lint and diff all PASS. No failures/skips remain in
those final runs. Final docs-only reconciliation does not change executable code.
Logs:/tmp/curling-mobile-entry-baseline-root-final.log,
/tmp/curling-mobile-entry-baseline-e2e-final.log,
/tmp/curling-mobile-entry-baseline-mobile-final.log,
/tmp/curling-mobile-entry-baseline-build-final.log,
/tmp/curling-mobile-entry-beta-final.log,
/tmp/curling-mobile-entry-baseline-types-complete.log,
/tmp/curling-mobile-entry-baseline-{lint,mobile-lint}-complete.log.

Next bounded acceptance is actual secure hosted configuration/current legal and
worker readiness, a preservation-safe physical candidate procedure and real iOS
OTP/Profile/training/Keychain/WKWebView evidence, then Apple/TestFlight approval.
This report does not authorize those external/device operations or claim Beta live.


### Legal contact correction — 27 October 2026 (local, publication pending)

The owner confirms `info@evolane.swiss` does not exist; the sole existing Evolane
mailbox is `notifications@evolane.me`. New immutable Privacy Notice and Terms dated
27 October correct only contact address plus version/effective-date metadata.
Default routes select these versions; August and24 October source bytes remain
unchanged. Existing acceptances are not rewritten and no reacceptance flow added.

Executed verification: legal components3 files/9 tests PASS; complete root384
files/9450 cases with9449 PASS and one unchanged N2 import-recovery case timing out
at5019ms (422.81s total). That exact case PASS separately with its unchanged5000ms
limit (4.65s runner;1 PASS/554 unselected). No wholly green combined root run is
claimed. Full browser139 PASS(3.1min), including new/default/historical legal routes;
initial browser invocation failed before tests because the default browser path
was absent, corrected using the existing /tmp/curling-beta-playwright installation.
Web build, final types, full root lint and diff/explicit new-file whitespace checks
PASS. E2E server confirmed stopped before production build. All E2E database resets
were local disposable fixtures only.

Actual new publication SQL passed rollback-only local controls: exact predecessor
rotation/archive preservation and retry; unknown/partial predecessor and retired/
partial replacement rejection; original fixture metadata unchanged afterward.
The script requires both new routes to be publicly verified before separate use.
No hosted mutation, deployment, Git staging/commit/push or device change occurred
in this correction. Branch codex/beta-new-users/HEAD a508afa, main/origin-main382ee40.
Nine tracked paths modified and five new files; no unrelated source edits.
Logs:/tmp/curling-legal-contact-{root,timeout-recheck,e2e-corrected,build,types,lint}.log.
Next: expressly authorize commit/push and production publication, verify both
27 October routes and defaults, then run the guarded27 October pair rotation and
verify the anon Legal RPC. Prior native iPhone/Apple/TestFlight gates remain open.


### 28 October physical first-launch incident — bounded diagnostic correction

Incident22 in the owner's TestFlight28October folder records the actual separate
iPhone candidate(b20c668, me.evolane.curling1.0/1) blocking before OTP with Retry.
Both original/new app IDs remained installed. New DB/WAL/SHM and WebKit filenames
were observed only as metadata; they establish no successful initialization. The
exact SQL/protected/source failure is NOT proven. Hosted/legal readiness and Apple
build absence in report21 are separate; no external/device action is in this task.

A read-only independent contract audit found no confirmed SQLite mismatch. It
executed six groups against the actual installed JavaScript wrapper with synthetic
Swift-shaped replies: ios_columns removal, numeric schema version, empty result,
SQL-null schema fields and transaction acknowledgements agree with strict discovery.
Do not strip extra headers or admit unknown schemas as a speculative correction.

The diagnostic-only code changes expose fixed last-owner-stage/report metadata
through the genuine host to blocked beta presentation. NU1 support text contains
only internal enum values; no raw errors, SQL/keys/payload, IDs/emails/tokens, native
logging, analytics or inspectable WebView. It is never protocol input or authority.
Existing admission/transactions/ownership, default/legacy paths, Q1/Q3 and undecided
Q4 remain unchanged. Retry/ready/Close clear stale presentation. No code claims the
physical first-launch defect fixed. Canonical contract: BETA_COMPLETION_SPECIFICATION
“Physical first-launch diagnosis”; safe coordinator retest: mobile/README.md.

Initial checks: owner/strict host/architecture3 files/174 tests PASS(37.85s); added
actual-owner synthetic-edge diagnostics6 tests PASS(1.77s), including private-value
non-disclosure, refusal, retry and cleanup. Actual beta/default UI2 files/16 tests
PASS(3.93s). Root types and diff PASS. Existing Swift injected-Security contract
first failed under sandbox at LAContext.interactionNotAllowed; the permitted
outside-sandbox repeat compiled/executed491 assertions PASS, with no real Keychain
read. This is environment-scoped contract evidence, not a device cause or pass.
Independent initial CODE review accepted the local diagnostic candidate; its
78 owner/host/diagnostic tests, 16 UI/default tests and three additional synthetic
counterprobes passed. The first full root run then exposed two genuine exact-host-
surface regressions (388 files/9486 tests passed, two tests failed): diagnostic
access was unintentionally visible on legacy identity/sporting hosts. Corrected
exposure to the explicit new-user host only, retaining the existing exact surfaces.
The original reviewer independently reran both existing host suites plus the new
diagnostic suite: 3 files/161 tests PASS(9.89s). A fresh second CODE reviewer audited
the complete corrected executable state and found no confirmed actionable defect;
it independently checked the diff and inspected the 161-test result. Neither review
claims a physical cause, fix, successful first launch or Beta acceptance.

Final corrected-code baseline completed serially on unchanged executable code:
root390 files/9488 tests PASS(390.92s; two workers). Mobile verification:
12 files/286 tests PASS(7.08s), including its typecheck/default production bundle.
General browser suite:140 PASS(3.3min), three intentionally excluded CH cases;
the separately enabled CH suite:3 PASS(6.9s), zero skips. Web production build,
root TypeScript, root/mobile lint and explicit beta bundle PASS. Local browser
server subsequently refused loopback connection(ECONNREFUSED); the first sandboxed
socket check returned EPERM and did not establish server state. No native/device,
production or Git publication action is included.

The final unsigned web-only beta artifact is
`/tmp/curling-iphone-startup-diagnostic`, built with the public API origin supplied
command-scoped and `NEXT_PUBLIC_POSTHOG_ENABLED=0`. Aggregate artifact checks confirm
the support label, NU1 prefix and public API origin, and no valid-shaped phc token;
no configuration values were printed or copied. Evidence JSON:
`/tmp/curling-iphone-startup-diagnostic-evidence.json`; index.html SHA256:
`8baabec8ea369faca85eafa72e1f64fab9aa57fbef71d7fdc973bbd9c67e5ae4`.
`mobile/dist` remains the verified DEFAULT artifact; a coordinator must rebuild
the explicit beta before its separately authorized sync/sign/update. This task
performed none of those actions and did not touch the existing signed App.app.

Exact change manifest (all unstaged; new diagnostics test untracked):

- docs/BETA_COMPLETION_SPECIFICATION.md
- docs/TESTFLIGHT_READINESS.md
- mobile/README.md
- mobile/__tests__/newUserBetaRoot.test.tsx
- mobile/src/storage/NewUserBetaRoot.tsx
- src/lib/persistence/nativeCombinedMigrationOwner.ts
- src/lib/supabase/newUserMobileApplication.ts
- src/lib/supabase/supabaseAuthService.ts
- src/lib/supabase/__tests__/nativeStartupDiagnostics.test.ts

Baseline was clean on codex/beta-new-users at
b20c668a0d21c768a1631593ed3a842b4a12614a; main/origin-main remain
382ee40d37605b302c11b6390305857c7e2c3fde. No staging, commit, push, reset,
branch mutation, deployment, signing, sync, device access or real credential/data
inspection. Final status:0 staged,8 tracked modified,1 untracked;diff check PASS.
The corrected code has a clean fresh independent review; this accepts only the
local diagnostic candidate. Device root cause remains unproven. A coordinator's
separately authorized preserving update/retest must capture the complete NU1 code
and Retry result; actual OTP/Profile/training/cold-reopen, native data continuity,
native analytics verification and Apple/distribution gates remain open. Q4 is not
decided or bypassed by this work.

Local verification logs: `/tmp/curling-iphone-startup-final-{root,mobile,e2e,ch,
build,types,lint,mobile-lint,beta}.log`; initial failed full root:
`/tmp/curling-iphone-startup-baseline-root.log`; independent corrected161 tests:
`/tmp/curling-independent-startup-corrected.log`. Existing injected Swift contract:
`/tmp/curling-iphone-startup-swift.log`(sandbox failure),
`/tmp/curling-iphone-startup-swift-allowed.log`(491 assertions PASS). These local
logs/artifacts are temporary verification evidence, not signed deliverables or
proof of an iPhone result. Production source remains uncommitted/unstaged.

### 28 October preserving retest — protected inventory diagnostic refinement

Coordinator report24 records a preserving development-signed update/launch of only
me.evolane.curling from the preceding diagnostic candidate. The subsequent complete
user-confirmed code is
`NU1/recovery_required/protected_inventory/recovery_required/protected`.
The last component was confirmed separately; it is not a Retry observation. No
Retry result has been supplied. Tim also confirms he personally removed the old
app; the metadata discrepancy is resolved, without proof of container contents or
data loss and without permission to reinstall/access original data. Report24's
earlier pending-code/removal questions are superseded by these direct confirmations.

Independent read-only installed-source audit confirms that the old stage covers
binding import/capture, JS prefix/access setup, native synchronization setup,
native inventory, transport/metadata validation and observer delivery. The installed
secure-storage/KeychainSwift contract matches the intended prefix, generic-password
class, no service/access group, non-synchronizable scope and configured access.
Whether the physical OS supplies missing/Boolean/integer synchronizable metadata
is UNPROVEN. No query/guard change is justified. Runtime plugin availability,
native OS status and actual inventory shape remain unknown; no physical cause or
behavioral fix has been established.

The bounded refinement adds fixed native inventory failure labels only. Queries,
success envelopes, per-item reads, prefix/Unicode/synchronizable/service guards
and refusal/recovery authority are unchanged. OS failures use seven closed labels
including interaction-not-allowed, entitlement and other; row/account/key/scope
validation uses closed shape/limit labels. No OSStatus number, native error text,
keys/counts/accounts/service values or payload enters support metadata. Transport
accepts only exact whitelisted failure kind/diagnostic pairs, normalizes to the
existing failure kind and associates metadata privately with the exact normalized
object. Unknown/malformed data remains failure, never an empty list. Old failure
envelopes still fail with a fixed native-kind label. Genuine-port ephemeral stages
distinguish binding load/capture, configure, call, validation and observer; the
existing owner-stage getter reads them for presentation only. No extra outward
port/host method, protocol report field, callback or storage operation was added.
The registry is pure and imports no native module; default paths retain lazy
native loading. Support text now wraps to keep the full code readable.

Initial refinement verification:3 focused files/88 tests PASS(2.67s), existing
architecture/identity/sporting3 files/257 tests PASS(16.59s), root types and diff PASS.
Injected Swift reader546 assertions PASS, compiled/executed outside the known
sandbox LAContext limitation; no real Security/Keychain call. The first synthetic
end-to-end tests used a stale transport module after fixture reset (four diagnostic
expectations failed); using the actual current owner's module graph corrected the
test setup. This was not an OS cause or a guard change. A fresh independent CODE
review of the complete15-path state is clean; it independently reran the same
3 focused files/88 tests PASS(2.65s), injected Swift546 assertions PASS and diff
check. It verified fixed-only metadata, genuine result identity through the binding/
port, no eager native import and unchanged authority. Logs:
`/tmp/curling-independent-protected-refinement.log`,
`/tmp/curling-independent-protected-swift.log`. Final refined-code baseline is
complete below; preceding390/9488 baseline applies to the prior candidate only.

This refinement adds six paths to the preceding nine-path manifest:

- ios/App/App/CredentialKeychainReader.swift
- tests/native/CredentialKeychainReaderTests.swift
- src/lib/persistence/iosKeychainReadEvidence.ts
- src/lib/persistence/__tests__/iosKeychainReadEvidence.test.ts
- src/lib/persistence/nativeCredentialMigrationPort.ts
- src/lib/persistence/credentialInventoryDiagnostics.ts (new)

Current total:13 tracked modified,2 untracked,0 staged; branch/HEAD/main refs
unchanged. New-user owner/UI/diagnostic tests and the same three documentation
files are further refined within the preceding manifest. No device, signing,
sync, original-data access, configuration, publication or Git mutation by this
implementation task. Retest requires a separately rebuilt native binary including
the updated reader, not only a web refresh. Coordinator owns the preserving update
and exact full-code/authorized Retry observation; no install/reset is requested
by this implementation. Physical root cause and all device/Beta gates stay open.

Final unchanged refined-code checks:root390 files/9495 tests PASS(393.15s,two
workers),mobile12 files/286 tests
PASS(6.23s), general browser140 PASS(3.2min) with3 intentionally omitted CH cases,
separate enabled CH3 PASS(6.6s), Web/default mobile/explicit beta builds, root types,
root/mobile lint PASS. Local browser server confirmed stopped(ECONNREFUSED) before
the isolated root run. No executable changes during or after this baseline.

New web-only unsigned artifact:`/tmp/curling-protected-inventory-diagnostic`;
evidence:`/tmp/curling-protected-inventory-diagnostic-evidence.json`. The artifact
contains the NU1 label, configure stage, fixed native failure labels and expected
public API origin; analytics is explicitly disabled and no valid-shaped phc token
is present. index.html SHA256:
`72dca1519ec32ace13f52a457a4d35ffd1a8e93138df9437ce2a48761b0da0ee`.
Native reader source SHA256:
`ff8ca5489df3a661ba94833984866c2f32240eff6ecfd34257ab957adca9a724`.
The source compiled in the injected contract harness only. This task did not build
or sign an iOS App binary, sync/install a candidate or touch the coordinator's
existing signed App.app. The old signed candidate lacks these new native labels;
the coordinator must rebuild both explicit beta web and native code under its
separate physical authorization. These hashes establish local artifact/source
identity only, not native runtime execution or successful admission.

Final evidence logs:`/tmp/curling-protected-final-{root,mobile,e2e,ch,build,types,
lint,mobile-lint,beta,server}.log`; initial failed synthetic fixture setup:
`/tmp/curling-protected-refinement-focus.log`, corrected88 tests:
`/tmp/curling-protected-refinement-focus-corrected.log`, boundary257 tests:
`/tmp/curling-protected-refinement-boundaries.log`. Fresh independent CODE review
and separate documentation/hash audit are clean. Final diff check PASS;0 staged,
13 modified tracked,2 untracked;unchanged b20c668/main refs. Accepted solely as a
local diagnostic refinement. The physical cause is still unknown and the next
separately coordinated native+web rebuild/retest must capture the full refined
code and separately observed Retry result, preserving candidate data. No Beta,
device, native analytics, Q4 or release acceptance follows from these checks.

### 28 October sync-shape retest — exact native representation correction

Coordinator report25 records a preserving update/launch of the freshly rebuilt
and signed native+web refinement, verified to contain the new labels. The later
user-confirmed exact code supersedes its pending-code status:
`NU1/recovery_required/protected_inventory_sync_shape/recovery_required/protected`.
It proves the native sync shape guard emitted its refusal through the real bridge.
It does NOT distinguish missing, a non-Boolean number or another representation;
one response to paired start/Retry questions is not two separate observations.

Primary-source investigation and independent read-only contract audit establish
a narrower confirmed adapter defect: Apple's Security implementation returns Sync
attributes as integer CFNumber, so rejecting every non-CFBoolean number is too
strict. The SDK/public CFBoolean wording and the installed writer's omitted false
input do not establish missing=false in returned metadata. No actual device value
was read or inferred. Canonical source chain and exact amendment are in
BETA_COMPLETION_SPECIFICATION.md, “Physical sync-shape correction”.

Authorized correction:retain genuine Boolean handling; normalize only exact
non-floating CFNumber zero/one through a successful lossless SInt64 conversion.
Zero permits the existing disabled-sync check,one is rejected as sync_enabled.
Other integer/floating/fractional/out-of-range/NaN/infinity,missing/null/string or
unknown shapes remain refused. Query,per-item read,success/failure envelopes,
scope/service/account/Unicode/duplicate/limit checks and recovery ownership stay
unchanged. No new diagnostic fields,storage action,protocol/schema or native method.
Physical fix and actual representation remain unproven pending preserving retest.

This stage further changes only the existing Swift reader,native injected tests,
and the three documentation files within the same15-path manifest. Native whole-
inventory counterprobes cover numeric zero/type evidence,enabled one,poisoned and
mixed rows,missing/null/string/other types,extreme integers,floating zero/one,
fractional values,NaN/infinity,duplicates and service rejection. Initial882 injected
Security assertions PASS;no real Keychain access. Fresh independent CODE review
of the complete15-path state is clean. It independently passed882 native assertions
and a1072-assertion whole-inventory harness(190 additional counterprobes),including
NSDecimalNumber zero/one/NaN/tiny/huge/fractional values,signed/unsigned integer
zeros/ones and late poisoned scope/service rows. Independently passed2transport/
startup files/28tests(2.81s),2owner/architecture files/244tests(11.42s),2strict host/
application files/72tests(28.20s),diff check. Logs:
`/tmp/curling-independent-sync-{swift,counterprobes,focus,boundary,host}.log`.
Final unchanged-code baseline is complete below. The preceding9495/546 baseline belongs
to the prior representation guard and is not reused as new proof.

Git remains codex/beta-new-users/b20c668,main/origin-main382ee40,13 tracked modified,
2 untracked,0 staged. No .env inspection,no original-data or physical-device access,
no sync/sign/install/production/Apple configuration or Git publication by this
implementation. Coordinator owns the next preserving native+web rebuild/retest.

Final corrected-code checks:root390 files/9495 tests PASS(392.89s,two workers),
mobile12 files/286 tests PASS(6.35s), general
browser140 PASS(3.2min) with3 intentionally omitted CH cases, separately enabled
CH3 PASS(6.7s); Web/default mobile/explicit beta builds,root types,root/mobile lint
PASS. Browser server confirmed stopped(ECONNREFUSED) before the isolated full root
run. No executable changes during or after this baseline.

New unsigned web-only candidate:`/tmp/curling-sync-normalization-candidate`;
evidence:`/tmp/curling-sync-normalization-evidence.json`. Its index.html SHA256 is
`72dca1519ec32ace13f52a457a4d35ffd1a8e93138df9437ce2a48761b0da0ee`, unchanged
from the prior web bundle because this correction changes the native reader only.
The explicit command-scoped API origin is present,analytics is disabled,no valid-
shaped phc token is present. This task compiled the Swift source in the injected
harness only; no native App binary build/signing,sync,device update or real Keychain
operation. The coordinator must rebuild the native source; unchanged web hash alone
does not prove the numeric correction is included in its eventual signed package.
Corrected reader source SHA256:
`4deb883526708879774238f485198635141094c396ea91eb509778f21cbad5d7`.

Final independent documentation/hash audit is clean and confirms both hashes and
the preceding completed logs. Evidence logs:
`/tmp/curling-sync-final-{root,mobile,e2e,ch,build,types,lint,mobile-lint,beta,server}.log`,
parent native882:`/tmp/curling-sync-normalization-swift.log`,independent882+190:
`/tmp/curling-independent-sync-{swift,counterprobes}.log`. Final diff check PASS;
branch/refs and15-path state unchanged(13 modified tracked,2 untracked,0 staged).
The local adapter representation correction is accepted; actual physical value,
successful first launch,distinct Retry result,OTP/Profile/training/cold-reopen,
native analytics and Apple/Beta acceptance remain unproven. No Q4 or release
decision. Next:separately authorized preserving native+explicit-web rebuild/retest,
observe next full code or reached screen and separately label authorized Retry.
