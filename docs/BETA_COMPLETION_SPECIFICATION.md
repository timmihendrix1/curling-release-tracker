# Closed-beta completion

## Authority and approved scope

The user requested implementation of the remaining beta work on 24 October 2026.
This authorizes local implementation and verification in the existing checkout,
preserving its pre-existing changes. It does not authorize Git publication,
production data changes, signing changes, installation over the existing iPhone
application, native-storage activation or distribution.

The canonical identity, Free-cloud, Team Foundation and native-migration
specifications continue to govern their respective domains. In particular:

- The closed pilot is free. Billing, production tariff enforcement, prices,
  Sponsored Athlete Seats and commercial seat limits remain deferred.
- Free retains supported raw history, basic results, export and basic cloud
  restore. Personal is a separate capability, whose final name is undecided.
- A Team membership is not a Personal entitlement. Pilot team-creation grants
  authorize creation only; withdrawing one does not end existing memberships.
- Existing local iPhone data must be preserved. No reset or empty-store fallback
  may substitute for migration. Dormant S1/S2 code is not production readiness.
- Current Training Sessions and authored Training Plans are device-local;
  terminal-record cloud sync must not be advertised as a complete device backup.

## New-user iOS beta — confirmed scope and pre-Q design gate (27 October 2026)

The user explicitly authorizes Codex implementation of a distinct dormant,
configured new-user entry and fresh independent review after implementation and
each correction round. New beta users start without old-data import. External
TestFlight invitation-link availability on the evening of 27 October is a target,
not Apple approval or permission to bypass acceptance. The beta remains free;
billing and commercial tiers do not change. Native iOS uses email OTP only, with
an authenticated account and completed personal Profile required before sporting
access. Athlete persistence remains scoped by application Profile.id. Original
owner data/iPhone installation, training continuation, account deletion/export,
Team and Free-cloud rules stay unchanged. Q4 remains undecided: unproven or
contradictory retained storage fails closed. The shipped mobile root and activation
barrier must remain unchanged until this bounded entry passes independent review.

**Current audit result: the user authorized the atomic-bootstrap design stage,
but independent review rejects its unchanged-protocol provenance assumption.
The user separately authorized the exact origin-tag extension below. Corrected
independent DESIGN and independent CODE review passed; the complete required local
baseline passed on the final unchanged code. This bounded dormant stage is locally
accepted. At that gate, shipped-root integration and device/hosted/Apple acceptance
remained open; the separate integration is now accepted below.** The legacy common-owner lane
commits schema-only initialization before held D1 preparation and Q insertion
(nativeCombinedMigrationOwner.ts, runOnce). The durable schema marker records
version/kind only. A new process cannot distinguish an interrupted empty-source
start at this cutpoint from earlier schema initialization that did not establish
empty-source provenance. Current source emptiness or schema shape is not proof of
that earlier origin. Refusing this state is safe but leaves a legitimate new
installation unable to retry after its first committed transaction; that limitation
has not been accepted as completion of the requested interruption support.

The initial proposal for separate review was a private empty-source
bootstrap that atomically persists schema and existing-format Q intent, with
actual SQL/protected ownership, positive complete source/native emptiness proofs,
fresh source fences and factual uncertain-outcome handling. Reject inherited
schema-only states; preserve all existing migration/published/transfer constructors.
This need not add serialized fields, but it changes S3b's schema-only/absent-Q
initialization and S3e/S3f's authentic held-D1-before-Q authority/order. It therefore
requires the separately requested design gate before lower SQL/hold changes.
That unchanged-contract proposal was insufficient without the subsequently
authorized origin tag below. Neither review resolves Q4.

The initial audit judged empty historical Q/D/M inventories sufficient. The
independent atomic-design review below corrects that conclusion: those bytes
prove emptiness under the legacy classifier only, not strict new-user origin.
Subsequent legitimate identity/training writes must still not be mistaken for
initial source data. Preserve source-independent bound reopening and normal
current identity admission. Strict new-user source inventory must reject retired
bare sporting keys and unknown namespaces that migration intentionally excludes.

Evidence: an actual configured-host/installed-SDK/disposable-SQLite probe, with
synthetic protected/API edges and independently counted legacy access, confirms
first schema COMMIT with zero source observations, then refusal on inaccessible
source, schema-only SQL, no Q/application rows/protected items/API calls. Final
probe: 1 file/1 test passed (878 ms); the initial probe setup failed because it
omitted required callbackUrlAccess and is not passing evidence. Existing configured
host/common-owner regression: 2 files/150 tests passed (10.10 s). git diff --check
passed. Independent read-only design review confirms the gap and the narrower safe
but incomplete refusal alternative; that reviewer ran no executable checks. Probe
and focused logs: /tmp/curling-new-user-design-probe.log and
/tmp/curling-new-user-existing-focus.log. The full implementation baseline was not
rerun: this is a pre-implementation design stop, not accepted new startup behavior.

### Atomic empty-source bootstrap — corrected tagged DESIGN and CODE accepted locally

On 27 October the user authorized the recommended separate design review followed
by implementation. That recommendation explicitly reused the existing durable
format. The independent DESIGN gate found one confirmed P1 provenance defect:
legacy initialization can produce the SAME empty historical Q/D/M inventories
while retired bare sporting keys or malformed Profile namespaces remain present.
The old classifier intentionally omits them. If those source keys later disappear,
neither those bytes nor a fresh empty source prove strict original absence.
Atomic schema+Q closes the pre-Q interruption gap, but alone cannot distinguish
these origins. The initial claim that the unchanged protocol was sufficient is
therefore withdrawn; no executable implementation followed the failed gate.

Independently executed counterexample: installed actual SDK, disposable SQLite,
synthetic protected/API edges and separately observed source I/O. Two cases
(retired bare session history; malformed owned Profile key) reached actual ready
through the old configured host with the excluded source value still present,
unread and unwritten, Qbound/Dactive/M with empty historical inventories. After
external source removal, a fresh module/host reopened and all SQL metadata,
records and protected bytes stayed EXACTLY unchanged. This is a new host/module
lifetime, not a genuinely separate OS process. Result: 1 file/2 tests passed,
813 ms tests, 1.12 s total. Evidence:
/tmp/curling-atomic-origin-independent.test.ts and
/tmp/curling-atomic-origin-independent.log. Parent existing-host/owner regression:
2 files/150 passed (10.82 s), /tmp/curling-new-user-atomic-focus.log. Diff check
passed. No full implementation baseline or CODE acceptance is claimed.

**Concrete amendment: explicitly user-authorized and independently DESIGN-reviewed.
Independent CODE acceptance and complete final local verification are recorded
below and in TESTFLIGHT_READINESS.md:**

1. Give the new-user lane an explicit closed durable origin discriminator. The
   smallest candidate is the exact new header contract tag
   `auth-js/2.112.3:credential-v1:empty-source-v1` in the EXISTING
   sdkContractVersion field of Q/M/I. Actual SDK version, serialized field sets,
   table layouts, source helpers and D format remain unchanged. This IS a durable
   semantic protocol revision: the current parser admits one exact literal. It
   must not be described as unchanged protocol merely because no field is added.
2. Only the named strict new-user owner can create that tag after full positive
   source/SQL/protected emptiness proof, in the SAME transaction as schema+Q.
   Legacy factories continue producing and admitting only their existing contract.
   The new lane rejects old undifferentiated Q/M/I, schema-only residue, mixed tags,
   unknown versions and mismatched config/SID/epochs. Never upgrade old evidence,
   infer origin from UUID patterns or current source state, or repair/reset data.
3. Correlate the exact tagged contract across Q/M and each runtime I item; preserve
   it through actual SDK writes. Require it on every unbound resume and bound
   reopening. Inventory emptiness and historical empty D remain additional
   necessary checks, not independent origin proof. Ordinary later Profile/training
   rows and credentials may be populated. A valid tagged bound pair reopens without
   ANY legacy-source access, retirement, registration or archive requirement.
4. Keep the reviewed atomic mechanism: same genuine SQL/protected owner and queue;
   exact before tuple checked again inside BEGIN; schema+Q written together;
   exact after readback; actual COMMIT operation captured before a final authentic
   synchronous complete-empty source fence. No await/foreign callback between that
   fence and COMMIT issuance. Use actual before/after journals and factual write/
   COMMIT acknowledgements, never roll back after COMMIT issuance. Unknown outcomes
   and unconfirmed cleanup retain ownership; Close drains held work and cannot
   turn late committed facts into a grant or pretend rollback.
5. Strict source capability admits only the existing public diagram-cache namespace
   during complete stable enumeration. All other names refuse, including retired
   bare keys and other provider/unknown namespaces; fixed slots/source marker must
   be positively absent even if not enumerated. No source writes/removals or marker
   creation. Actual source proofs fence every relevant fresh protocol checkpoint.
6. This extends the lower-protocol scope to credentialProtocol.ts and its direct
   protocol/runtime consumers plus the bounded existing owner/source/SQL/host and
   exact architecture tests. Preserve legacy migration/import/published behavior
   through mode-specific admission and regression tests. No app root/flags, real
   accounts/data, configuration, installation, signing or publication changes.
   Q4 remains undecided; ambiguous restore or old untagged data stays refused.

The corrected exact amendment passed a fresh independent DESIGN review after the
user authorized the durable protocol extension. Implement the named dormant
entry, verify installed SDK/disposable SQLite with synthetic edges, actual source/
native I/O, OTP/onboarding, Profile save/reload and GENUINELY new-process reopen,
all interruption/unknown/cancellation/source-addition/configuration/mismatch cases,
legacy-path preservation and inert construction/root exclusion. After each code
correction use a fresh independent reviewer, then complete the original full
baseline (diff, root types/lint/tests/build/e2e and mobile verify/lint). No synthetic
ready verdict, reset hook or real credential use. Only after acceptance does a
separate bounded task connect the entry to the shipped mobile root/configuration.

### Tagged new-user entry — independently reviewed and locally verified

The explicitly named createConfiguredNewUserNativeSportingIdentityHost now uses
one genuine configured native owner/runtime/SDK with exact new-user protocol
selection. Existing protocol helpers DEFAULT to legacy-only; the new tag is an
explicit selection in the private common owner/SQL/protected port. Transfer and
published callers retain their default legacy admission without broadening parsers.
The strict source has no retirement capability, refuses every enumerated name
except public diagram cache, checks fixed absences and fences the full source.

The first transaction creates exact missing schema plus tagged Q intent together,
using the existing before/after journal and captured COMMIT operation. Source and
protected inventory/manifest absence are positively observed before initialization;
full source proof is synchronously fenced after actual SQL after-readback and
immediately before COMMIT. No inherited schema-only state becomes initialization.
Existing genuine D1 prepares the persisted expected SID after tagged Q; normal empty
M/fixed absences, Q edges and Dactive/Qbound finalization follow. Exact tag and empty
historical origin inventories gate resume/reopen; current native data stays mutable,
and bound admission/handoff never consults legacy storage or retires source data.

Fresh independent CODE review found no confirmed actionable defects. It executed
3 files/214 tests, including all 50 new-user cases, and checked the complete scoped
result and existing dependencies. Parent complete final baseline passed, including
all root/browser/mobile tests, build, types, root/mobile lint and diff. Initial
sandbox/font/browser failures and an overloaded first root run are distinguished
from the successful unchanged-code repetitions in TESTFLIGHT_READINESS.md; no
skips or old baseline relabeling. This is installed-SDK/disposable-SQLite and local
browser evidence, not physical iPhone/Keychain or hosted/Apple acceptance.
Default shipped root/flags, original installation/source helpers, real
configuration/hosted/Apple are unchanged. The next bounded task is to connect this
accepted explicit entry to actual mobile root/configuration, with its own review.
That follow-on local integration is completed in the next section; device/hosted/
Apple acceptance remains separate.

### Mobile new-user entry integration — independently accepted locally (27 October 2026)

After acceptance of the dormant entry, the user requested continuation into its
actual mobile root/configuration. A separate explicit build selection,
CURLING_MOBILE_NEW_USER_BETA=1, selects the genuine new-user host and shared native
Tracker composition. Default and legacy native-storage builds retain their
behavior; combining this selection with diagnostics or legacy storage fails build.
This is a local opt-in application integration, not device/release activation.

Independent DESIGN review accepted the following boundary: an inert application
owner outside React, trusted iOS-only platform admission, all three existing public
configuration values validated before stores, HTTPS required for both native API
and Supabase provider (the generic Web resolver stays unchanged), genuine provider binding and host,
fixed application database, actual platform bridges and existing bounded protocol.
No injected Ready, parallel authentication, reset, source import or browser fallback.
One host survives render/StrictMode replay; retries use the same host. Final
unmount closes after a cancellable microtask to distinguish effect replay. Explicit
terminal closure revokes the genuine host before notifying presentation listeners;
closure always returns void, keeps the genuine host completion private, retains
its work and suppresses late admission until actual preparation/construction settles. Cleanup
failure remains blocked. No new durable format or Q4 acceptance is introduced.

The pinned installed SDK remains unchanged. Browser evaluation of its deprecated
lock diagnostic probes a random lswt-* key (write/remove) and reads only
supabase.gotrue-js.locks.debug. This is not native/application store initialization,
SDK client creation, auth fallback or authority. Complete artifact import must NOT
be described as having zero browser-storage accesses. Tests observe those exact
operations separately from host work. Exceptions at module evaluation are caught
at the mobile bootstrap, which shows fixed blocked copy; no native/SDK work follows.
A failed probe removal can leave an unsupported random key; strict fresh-source
admission must refuse it, never silently delete it. Bound native authority never
imports/rebinds/replaces data because of those diagnostics. No vendor patch or
global storage interception is introduced.

Required evidence: actual root/UI OTP/onboarding/training through installed SDK and
real disposable SQLite with synthetic platform/protected/API edges, strict legacy
refusal, held-work close and replay, cold source-independent reopening, configured
artifact selection and non-iOS/configuration refusal. Existing default/legacy
artifact guards and full required baseline remain gates. Native OS Team links may
continue opening Web under §6.5; no guessed delivery origin, signing, entitlements,
actual configuration assignment, installation, hosted change or distribution.

Three fresh independent CODE rounds are complete. The confirmed HTTP transport
and direct-Close disposal-cycle defects are corrected; the third review found no
remaining confirmed actionable defects. Its actual owner/strict-host/architecture
and UI checks pass. Final unchanged-code full baseline passes: root, full browser,
mobile, Web/opt-in builds, types, lint and diff. Exact counts, intermediate failures,
changed-file manifest and local/physical limits are in TESTFLIGHT_READINESS.md.
This accepts only the local new-user beta integration. No device installation,
actual hosted configuration, legal publication, Apple approval or distribution
has occurred. Default/legacy selection remains unchanged; Q4 remains undecided.

## Account deletion — decisions confirmed 24 October 2026

The user confirmed the following previously unresolved Team/privacy policy:

1. After the already-approved 30-day recovery period, delete the authentication
   account, athlete-owned raw records and private notes.
2. Preserve other participants' own results, with anonymized references to the
   deleted participant. Do not retain the deleted person's private notes or raw
   performance under the label of shared history.
3. Inform all affected participants neutrally. Do not expose a deletion reason,
   private notes or performance content in the notification.

The user additionally authorized a small application-owned iOS Keychain bridge,
implemented with Apple's Security framework, on 24 October 2026. Its purpose is
item-specific present/missing/failed evidence. This permits neither custom
cryptography nor a plugin fork, and authorizes local implementation and unsigned
verification only. It does not activate native storage or authorize installation.

The existing rules in Mandatory Identity §8.2 still apply: recent
reauthentication, an offered complete personal export, no application access or
sync while pending, controlled reauthenticated cancellation during the recovery
period, local Profile data deleted or inaccessible, and no automatic linking of
a replacement account to the old account's data.

## Vertical completion and acceptance gates

### Credential source retention — Q3 confirmed 24 October 2026

The user chose automatic removal of the old credential copy after fully verified
transfer into protected storage. Until transfer and verification succeed, preserve
the source: no removal is issued on missing, failed, contradictory or incomplete
evidence. This decision concerns provider credentials only, not training data.
It does not activate migration or authorize device installation.

The later retirement executor must recheck the exact source before each removal,
never delete a changed/foreign value, and report interrupted/failed cleanup honestly.
WebView removal of several keys is not atomic: after cleanup begins, a failure can
leave a partial old copy. Preserve every remaining entry and the verified target;
report cleanup incomplete and never claim the whole source survived or was erased.
No source fallback, automatic rebind or rollback follows. Q v1 has no retirement
fields; a reviewed interruption protocol is required before enabling cleanup.
Same-epoch restore-residual acceptance (Q4) remains a separate release decision.

### Read-only iOS namespace inventory — adopted bounded design

The bounded design and local implementation passed independent review on
24 October 2026. Injected tests and unsigned iOS compilation passed; physical
acceptance and cross-store integration remain separate gates.

Extend the approved application-owned Keychain reader with an inert, explicitly
called `inventory()` method, using Apple's Security framework. It returns account
suffixes only within the fixed `curling.credentials.v1.` namespace. It never reads
credential payloads, writes/deletes items, introduces sharing entitlements, installs
on a device, or activates composition. No custom crypto or plugin fork is involved.

- Use generic-password `SecItemCopyMatching`, `kSecMatchLimitAll`, attributes only,
  data/reference returns disabled and interaction disallowed. Search both sync
  states using `kSecAttrSynchronizableAny`, so unexpected synchronized residue
  cannot disappear from the inventory. No account/service filter may silently
  hide namespace artifacts. The current app has no Keychain-sharing entitlement;
  search without an access-group selector covers app-accessible groups, not a
  claimed global or explicitly selected default-only Keychain. Build and physical
  acceptance must verify that entitlement assumption.
- The API necessarily returns attributes of app-accessible generic passwords
  before prefix filtering. Do not return, log or retain unrelated attributes.
  An entry with an undecodable account prevents a complete verdict. For an owned
  account, unsupported scope (sync enabled or nonempty service), duplicate exact
  suffix, malformed/empty/control/over-192-unit suffix or more than 4,096 owned
  entries blocks the entire inventory. Never skip/truncate unknown owned material.
  Absent service attribute or an exact empty String represents the writer's
  unqualified service; NSNull/numeric/coerced service values fail. Sync=false
  must be explicitly established by `CFGetTypeID(value) == CFBooleanGetTypeID()`;
  NSNumber(0/1), strings, missing and null are not native Booleans. This finite metadata
  envelope is not a data-retention limit or a measured native capacity.
- Only `errSecItemNotFound` establishes an empty matching query. Native success
  requires a nonempty correctly typed array of attributes; nil, an empty success
  array or malformed rows do not establish absence. A valid nonempty result with
  only unrelated accounts may produce the complete empty owned list. Preserve
  exact UTF-16 accounts/suffixes: namespace prefix matching, suffix slicing,
  duplicate detection and deterministic sorting all use code units, never Swift
  grapheme/canonical-equivalence comparison. Do not conflate Unicode normalization
  equivalents or skip a combining mark immediately after the namespace delimiter.
- Native/TypeScript outcomes are closed: complete private key list or fixed
  failure (inaccessible, unreadable, unsupported_scope, limit_exceeded). TypeScript
  rejects malformed/accessor/duplicate/unsorted/oversized responses, contains bridge
  rejections and returns no raw exception, attributes or partial list on failure.
  Construct/import performs no inventory call and there is no plugin fallback.
- A complete inventory is an observation at that call, not an item-specific read,
  an ownership/freshness permit, OS rollback detection or storage readiness. M/I
  still need their individual read evidence and the later exclusive cross-store
  owner. Keep the existing `SecureCredentialStore` interface and S1/S2 formats
  unchanged. Android remains unavailable.

Acceptance: independent bounded design and code review; injected Swift Security
tests for exact query/no-data/no-write behavior, absence/error/malformed/scope,
orphan/unknown/foreign entries, Unicode, duplicates and limits; TypeScript hostile
transport tests; unsigned iOS compile. Tests must inject every Security operation,
never access a real user's Keychain. Physical acceptance remains open.

Apple's primary API contracts: [all-match queries](https://developer.apple.com/documentation/security/ksecmatchlimit),
[attribute-only results](https://developer.apple.com/documentation/security/ksecreturnattributes),
[both synchronization states](https://developer.apple.com/documentation/security/ksecattrsynchronizableany)
and [app access-group search scope](https://developer.apple.com/documentation/security/ksecattraccessgroup).

### Physical slots and standard platform fingerprints — adopted bounded design

The independent design and code-review gates passed on 24 October 2026.
The helpers remain inert and have no application consumers. Keep S1/S2 logical contracts unchanged.
Add two inert helpers, without storage/SDK
clients or production callers, before the cross-store owner binds them:

- `credentialPhysicalSlots.ts` accepts primitive strings only and returns the S1
  fixed-issue Result, never coercing objects. `credentialManifestSlot(configId)`
  produces `m1.<length>.<configId>`, where length is the exact two-digit lowercase
  hexadecimal code-unit length of the already validated `pc1:` config identifier.
  `credentialItemSlot(configId,root,epoch,key)` produces
  `i1.<length>.<configId>.<epoch>.<selector>`. Epoch is the existing canonical UUID.
  Selectors are `s` session, `u` user, `l` legacy verifier, `x` flow index or
  `f.<exactFlowId>` dynamic verifier. Key classification is the existing S1 grammar
  for the exact validated root. All resulting slot strings are ASCII, at most 178
  units, within the reader's 192-unit envelope. No raw value/hash enters a slot.
  `parseCredentialPhysicalSlot(configId,root,slot)` accepts only exact canonical
  slots for those inputs and returns manifest or item/epoch/exact SDK key. Malformed,
  other-config, legacy raw, unknown and oversized names refuse; they are not silently
  excluded from namespace completeness. Config IDs must be injectively assigned to
  one exact resolved provider configuration **and its derived SDK root** by the later owner;
  the codec alone does not distinguish two roots assigned the same config ID; these helpers do not mint
  or infer that assignment, protocol ownership, pairing or migration readiness. A
  syntactically valid slot for any epoch is parsed and retained; only the later
  owner can correlate it with complete Q/M/I inventories and refuse orphan or
  foreign-epoch entries. This parser has no current-epoch evidence.
- `platformCredentialFingerprint.ts` supplies an S1-compatible Fingerprint and
  synchronous 64-lowercase-hex format predicate, bound to one validated root. Capture
  the standard Web Crypto SHA-256 digest operation and TextEncoder at construction,
  without invoking a digest or touching storage. Compute the digest of UTF-8 bytes
  of exact `JSON.stringify(['credential-value/v1',key,raw])`; this canonical tuple
  preserves lone UTF-16 surrogates through JSON escapes and separates fields/purpose.
  Input is the literal purpose, a supported primitive key in that root and a
  primitive raw string within S1's code-unit budget; this utility does not grant SDK
  semantic validity. No custom cryptographic algorithm, encryption or fallback.
  Missing/throwing/malformed platform capability produces a fixed failure/own safe
  error, never a hash, absence or a raw exception. A settled digest must be exactly
  32 ArrayBuffer bytes. A pending digest stays pending. Optional injected digest
  dependencies are test-only and captured once; all assimilation/reflection failures
  are contained without inspecting their reasons, for provider-owned observable
  promises/thenables. As at S2 C4, a poisoned Promise constructor/species that
  prevents observation remains the dependency provider's responsibility; do not
  claim unconditional containment of arbitrary hostile native promises.
- The architecture guard permits exactly these two inert binding modules to import
  S1. The original pure S1 dependency graph stays unchanged; neither helper may
  have application consumers or SDK/storage imports.
- M/I are still serialized by S1, with no extra fields or raw legacy adoption.
  Physical slot mapping is not value encryption, native byte-capacity proof,
  Keychain CAS, namespace ownership or durability. The actual native port/executor,
  source cleanup and activation remain unavailable until their own gates pass.

Acceptance: independent bounded design/code review; all fixed kinds, min/max config,
root/flow/UUID cases, separator-containing config IDs, canonical roundtrips and
collision counterexamples, malformed/unknown-name refusal and preservation of valid
foreign-epoch/orphan names for later owner correlation, object/hostile/type/limit cases;
real standard Web Crypto versus independent SHA-256 vectors for exact JSON bytes,
Unicode/lone surrogates, unavailable/rejecting/malformed/pending dependencies and
privacy-safe errors. Prove inert construction and no default-path callers. Physical
WebView/bridge roundtrip and capacity remain device gates.

### Pre-activation deletion-control inventory — adopted bounded design

Independent design and corrected code review passed on 24 October 2026.
Extend only the dormant D migration's source eligibility to preserve ADR-0052's
new denial evidence. Do not alter D v1 serialization, B4's source-free behavior,
Q/S1 or S2 transfer v1. The existing broad implementation mandate covers local
code/testing, while independent design/code review still gates this slice.

- Add pure exported membership predicates beside the authoritative guard prefixes
  in `accountDeletionGuard.ts`: exact prefix + canonical 36-unit UUID + `.v1`,
  for Profile-bound guards and nonce-bound resolutions. No parsing, storage,
  coercion or authority is added by key membership.
- `nativeMigrationEligibility.ts` imports those predicates and adds two explicit
  eligible identity-control families. Every physically enumerated valid key is
  copied byte-for-byte with the same complete listing, D entryKeys/manifest,
  per-row fingerprint, checkpoint CAS, verification and source-change safeguards
  as existing identity continuity rows. No synthetic Profile membership is
  inferred; a resolution without a current guard is still retained.
- Replace the decision layer's blanket refusal of these prefixes with refusal
  only for a malformed member of either owned family. Neither unknown suffixes
  nor malformed UUIDs silently disappear. Unsupported versions remain blocked.
  Enforce this at every fresh preactive source enumeration/recheck, including
  runner digest/entry-key checks and `validateSourceAgainstManifest`, before
  filtering exclusions or reading values. An unsupported member observed after
  the initial decision halts with a fixed contradiction; no later progress or
  activation transaction may use that inventory. The initial C1 finding and
  runner halt map to existing G3 preserve/help behavior, not a fabricated absence.
  Raw values are opaque transport bytes, including malformed/unresolved denial
  records: migration must preserve them, never resolve, repair, normalize or
  delete them to make admission possible. Destination repository validation
  remains unchanged and fails closed on malformed/mismatched receipts.
- Existing preactive D records are not rewritten/backfilled: missing original
  entryKeys or manifest rows retain their refusal; added source controls follow
  the existing complete-source recheck and guarded enumerating replacement rules.
  D1 cannot treat a guard-only source as an empty fresh installation. Once active,
  B4 still never reads or reimports the old source. No cleanup is added.
- S2 v1 keeps refusing these families. This slice is not installation transfer,
  cross-store finalization, identity admission, production composition or cutover.

Acceptance: independent design/code review; key boundary/hostile/version cases;
guard-only and orphan-resolution sources; byte-exact checkpoint/reopen; unresolved
and resolved guards reconstructed through the real destination repository;
malformed evidence copied without creating admission; source additions/removals
and interrupted/unknown checkpoint outcomes retaining existing guarantees;
malformed-owned additions between initial decision and enumeration/AP-CC/AP-ACT
fresh rechecks refusing before any later transaction; B4
source-independence regression; S2-v1 refusal unchanged; architecture graph stays
pure and all unrelated old D tests retain their original outcome assertions.
The two explicit old valid-guard refusal fixtures are intentionally superseded
by preservation assertions plus malformed-family refusal tests; this does not
relax any existing checkpoint, source-change, recovery or B4 assertion.

### Public SDK ownership experiment — evidence, not an adopted runtime

A test-only experiment in `credentialPublicOwnerCompatibility.test.ts` uses the
installed public `AuthClient` with owned initialization, no subscriptions and no
auto refresh, a FIFO around whole public operations, the real credential adapter
and exclusively synthetic memory/transport. Serializing calls alone is
**insufficient**: refresh-write failure rejects a separate SDK-owned Deferred and
produces an unhandled credential exception even while the outer caller is awaited.
The regression explicitly observes that one known escape; interception is not a
runtime fix. Initialization and post-denial read/remove failures are separately
exercised; provider denial is captured causally before SDK cleanup and survives
cleanup failure. A public `accessToken` data client avoids its automatic Auth
subscription, but invokes its token callback during construction as well as sends.

A terminal adapter plus a fixed public SDK retryable-error settlement signal is
under feasibility review only. It must never classify a credential fault as
network health, absence or identity evidence. Browser visibility callbacks,
constructor/background work, every operation's settlement, actual send ownership
and current training continuation need a bounded reviewed runtime design before
application integration. `autoRefreshToken:false` alone does not remove the SDK's
visibility recovery listener. No production caller or SDK option was changed.

### SDK credential settlement adapter — adopted inert slice

The experiment identifies a smaller candidate than replacing all SDK persistence
with RAM mirroring. This independently reviewed slice is **only an inert adapter factory in
`supabaseClient.ts`**, the existing SDK boundary. It creates no client, subscribes
to no SDK event and changes no default path. Independent design/code review passed
after correcting malformed-result validation before post-health callbacks. This
does not adopt a native auth controller. Exact checks are in TESTFLIGHT_READINESS.md.

- `createNativeCredentialSettlementStorage(storage, health)` captures the three
  underlying storage operations and health getter once. Construction performs no
  read/write/remove/health call. Return a closed invalid-dependency result for
  missing/noncallable/throwing dependency access. Both constructor arguments are
  unknown: storage must be a non-null non-array object with three callable methods,
  health a callable function. Result is exactly `{ok:false,reason:"invalid_dependency"}`
  or `{ok:true,value:{storage,failed}}`; both binding and storage subobject are frozen.
  Capture each method once and preserve its original storage receiver through a
  captured intrinsic Reflect.apply, never its own bind/call properties. The owner
  must supply storage and health for the SAME underlying credential integration;
  shape checks cannot prove that pairing. Return the frozen binding with
  `storage` and synchronous sticky `failed()` predicate. It reports observed
  terminal knowledge, performs no health poll and grants no health/identity proof
  when false. No reset/recovery method.
- Before each operation and after its awaited result, require health exactly
  `null` and no local terminal fault. Any thrown/rejected/invalid dependency
  result or non-null/throwing health permanently faults this binding. After the
  first observed fault, issue no further underlying storage operation; already
  issued pending operations stay owned and their late completion cannot clear
  the terminal flag. Recheck the local terminal flag after BOTH health callbacks,
  immediately before underlying I/O and before releasing an operation result: a
  health callback can reentrantly fault this binding and still return null.
  A pending operation never becomes settled through a timer.
  As at S2 C4, dependencies own otherwise unobservable/background rejections;
  only ordinary observable provider-owned promises/thenables cross this boundary.
  Health is strictly synchronous: any non-null return faults immediately. If a
  malformed health callback returns an observable Promise/thenable, latch the
  fault BEFORE attaching no-op success/rejection observers using intrinsic native
  Promise observation (otherwise guarded assimilation); do not await it or grant
  health. Constructor/species poison remains subject to the same C4 precondition.
  Do not promise rescue of poisoned Promise constructors/species after handoff.
- Validate the settled storage result BEFORE calling post-health. A malformed
  result is already fault knowledge: latch it without any further external callback
  or reentrant I/O opportunity. Valid results still require the post-health and
  local-terminal reentrancy checks.
- `getItem` returns only primitive string or positively supplied null; set/remove
  require the adapter's void acknowledgement, exactly undefined after settlement. Failure always throws a **new fixed
  public `AuthRetryableFetchError('Credential storage unavailable',503)`**, no raw
  reason/cause/content. This is a private SDK settlement signal tied to installed
  SDK compatibility, not classification as a transport outage, absence, provider
  denial, successful storage or a retry/recovery permission. The future owner must
  consult this independent sticky failure before every result/grant/send.
- Do not import/change S1 or wrap the current browser/client path. Keep exactly
  the existing three SDK import files. Add an exact architecture assertion that
  no application module calls/imports the new factory. Do not claim that this
  adapter owns SDK construction, whole public calls, visibility/BroadcastChannel,
  provider causality, PKCE send fences or training policy. Those remain S5 gates.
- A future private native host must own initialize and whole commands, always
  await public stopAutoRefresh after initialize (including failure), register no
  SDK subscriptions, never start automatic refresh, and prevent raw SDK escape.
  Choose public methods using the pinned real rotation evidence: an explicit
  refreshSession call can duplicate refresh and stale-token denial cannot revoke
  a newer successful credential generation. The adapter alone supplies none of
  these grants. An SDK upgrade requires rerunning the compatibility matrix.

Acceptance: inert/capture-once and hostile dependency tests; exact empty/null
reads; read/write/remove failure and sticky health; terminal no-more-I/O including
late success after concurrent failure; pending/throwing/malformed thenable cases;
private fixed exception without raw metadata; installed public SDK initialization,
refresh-write and post-denial cleanup, all PKCE write positions before send,
verify-OTP/session and exchange/signout cleanup; no additional unhandled rejection
and no constructor/default/app caller. Keep the existing negative Deferred escape
regression as evidence of why mapping is required, never runtime interception.

| Stage | Deliverable | Acceptance evidence |
| --- | --- | --- |
| Release-text reconciliation | New immutable legal-document versions covering the native app, optional Brower timing and public curated diagrams; preserve all older versions | Public-route and content checks; guarded publication transaction tested locally; production publication separate |
| Existing backend integration | Real local authentication, Free persistence and Team invitation/acceptance/recording/restore | All six SQL suites and full Playwright suite; real SMTP delivery to local Mailpit; no third-party recipient |
| Deletion persistence | Pending/cancel/finalize authority, denial across all database access paths, complete export, anonymous shared references and neutral notifications | Real Postgres authorization, retry, interruption and concurrency tests; privileged finalization cannot be called by browser roles |
| Deletion service and identity | Provider-neutral contract and validated adapters, controlled reauthentication, local durable denial and bounded cancellation | Negative identity, account-switch, stale callback, offline and partial-failure tests |
| Deletion UI | In-app export and deletion entry, pending state and cancellation | Component and end-to-end tests, mobile layout and accessible confirmation |
| Native migration | Audited missing-versus-failed credential evidence, complete cross-store protocol, transfer integration and readiness binding | Independent stage reviews, real-engine rehearsal and disposable-device evidence before cutover |
| Distribution | Reproducible artifact, compliance answers, review access and exact build/device evidence | Apple-side and physical-device evidence; separately authorized upload and tester distribution |

Do not mark a later stage complete because an earlier pure module or mock passed.
Do not combine deletion, native migration and distribution into one unreviewed
activation. Record actual verification results and outstanding gates in
`TESTFLIGHT_READINESS.md`.

The first bounded native correction is S-P3 resource ownership: contain credential
factory exceptions after database acquisition, await confirmed cleanup before
retry, keep uncertain release terminal for that document, and join concurrent
attempts/disposal without publishing a stale owner. Verify factory throws,
unanswered/failed close, retry and supersession independently. Production native
activation remains unavailable throughout this correction; no source cleanup,
credential transfer or device installation is implied.

## Native slice S3a: adopted discovery boundary

The bounded design and its local implementation passed independent review on
24 October 2026. The review's Unicode-ordering regression was corrected and
independently verified against real disposable SQLite. This closes S3a only;
combined cross-store transactions and runtime/physical acceptance remain open.

Before introducing combined credential/domain transactions, close the shared
SQLite discovery boundary. This bounded slice implements no credential table,
protected-slot mapping, transfer executor or activation authority. The archived
credential design's CFR-01 finding is resolved by separating **schema/protocol
selection** from **individual legacy D/latch observations**:

- Every ordinary, diagnostic and legacy migration factory uses the same internal
  discovery implementation on its owned connection before bootstrap or mutable
  pragmas, and again at each operation. No constructor performs I/O.
  Reserve the named database synchronously before engine resolution/open/discovery;
  every other factory (including another ordinary/diagnostic factory) refuses while
  any opening, live or uncertain handle is retained. Cleanup alone releases that
  reservation after confirmed native-handle release. The real binding releases by
  database name, so a second ordinary owner is not safe alongside the first.
- Discovery reads a complete `sqlite_master` inventory between equal successful
  `PRAGMA schema_version` observations. Only an empty schema or the exact existing
  `records` table and its primary-key autoindex are admitted. Validate stored
  CREATE spelling, table_info, index_list and index_info against finite expected
  definitions. No discovered identifier is interpolated into SQL.
- If `records` exists, list every key. Reject unregistered names under the native
  migration, credential or installation-transfer control families. Registered
  legacy D/latch names remain the existing supplied reserved keys. A credential
  table, even schema-only, and every transfer/unknown schema object refuse before
  their payload is read. A failed/malformed schema or key inventory is refusal,
  never evidence of an empty database. No repair or schema adoption occurs.
- In a positively established legacy records-only schema, selection does **not**
  read or validate D/latch values. Their existing independent reads still return
  present/absent/read_failed to the unchanged evaluator, including warm row-loss
  comparison and bounded fault-latch behavior. A failed D read cannot hide a
  positive latch or independently observed lost row. Schema refusal and a D
  observation failure are different outcomes. This is the explicit CFR-01
  correction; it does not grant writes/access from negative D evidence.
  Add required internal target operation `checkProtocolSelection(lease, control)`
  returning exactly `{ok:true}` or `{ok:false,reason:<existing refusal or
  protocol_refused>}`. It owns discovery; caller booleans supply no authority.
  Propagate discovery refusal through reserved/list/value reads and transaction
  preparation without converting it to an individual `read_failed`. A failure of
  discovery's complete key inventory refuses; a later legacy list/value query
  failure after positive selection retains its original observation result. Test
  hooks must distinguish these query instances even when their SQL text is equal.
- Fresh bootstrap may create only the existing `records` table under the same
  registry reservation and must rediscover it before further work. Operations on
  a reused connection rediscover; migration transactions rediscover within BEGIN
  before their first write and before COMMIT. Existing D preconditions remain
  mandatory. Recheck selection after awaited evidence/digest callbacks before
  preparing a plan and immediately before publishing B4. A stale prior successful
  observation is never a reusable access/write permit.
- Lifecycle checks surround every discovery await. Pending work retains its
  owner, cancellation prevents further reads/effects, and cleanup retains the
  existing uncertain-handle discipline. Protocol refusal has a fixed result with
  no discovered names, values, SQL text or exception details in diagnostics.
- Do not change D v1, its decision rules, eligibility, source-independent B4,
  retired bare-key exclusions, public StorageAdapter contracts or R64. A schema
  check does not read source storage. Native production activation stays closed.

Acceptance: independently review this bounded design before implementation; keep
all legacy outcome assertions, update their query fixtures truthfully rather than
silently returning empty results for discovery; add unknown/credential/transfer
schema, incomplete results, schema drift, reused handles, alternate factories,
callback supersession, cancellation and legacy unreadable-D/positive-latch/warm-row
regressions. Execute discovery queries against real disposable SQLite in addition
to faithful plugin models. Full application verification follows implementation.
This slice cannot establish complete cross-store readiness or native durability.

## Native slice S3b: private SQL inventory and empty schema initialization

This bounded design and implementation passed independent review after correcting
final control-set checks, opaque-error classification and uncertain release fencing.
It does not adopt the archived S3 owner/transaction proposal.
It adds an inert `createNativeCredentialSqliteInventory`
factory to the existing native adapter. The returned frozen capability exposes only
acquire, observe, initializeEmpty, reopen, release and local leaseState. It exposes
no ordinary store/adapter, diagnostics, legacy migration target, domain transact,
Q progress, finalizer or B4/readiness grant. No application caller is added.

- Reuse the exact existing named-database registry, queue, opaque identity lease,
  uncertain-handle discipline and lifecycle checks. Construction/acquisition has
  no engine/storage I/O. Other factories cannot open/release the same handle while
  this capability owns it, including pending initialization and uncertain COMMIT.
- Only this mode recognizes the exact records table plus
  `curling_credential_meta (slot TEXT PRIMARY KEY NOT NULL CHECK(slot IN ('schema','q','f')), value TEXT NOT NULL)`.
  Validate full sqlite_master, table/index definitions, schema_version and all
  records keys and meta slot names before any payload/mutable PRAGMA. Unknown or
  malformed objects/names refuse; ordinary/diagnostic/legacy modes continue to
  refuse even an empty credential table before reading its payload. No user_version,
  plugin schema version or caller-provided SQL is introduced.
- Structural selection is distinct from value observations (CFR-01). In this mode
  opening an empty database performs no automatic records bootstrap. `observe`
  reports structural layout empty/records/combined and independently observed
  D/latch/schema/q/f values, each present/absent/read_failed. Failure reading one
  control must not hide a positive other control. Marker/Q/F semantic validity and
  warm row-loss comparison belong to the future owner; observations grant nothing.
  Structural refusal is never converted into absent controls. Cancellation issues
  no further read and returns cancelled. Results contain no caught native details.
- `initializeEmpty` may initialize only a structurally empty database or a records
  table with a fresh complete zero-key listing. Any D/latch/application row refuses;
  it cannot backfill Q for an old active D or adopt existing migration progress.
  Existing combined schema also refuses initialization; observe it without repair.
  Under the same lease BEGIN, re-discover and prove emptiness again; create records
  if needed, create meta without IF NOT EXISTS and INSERT exactly schema marker
  `{"schemaVersion":1,"kind":"credential-cross-store-meta"}`. No Q/F/D/latch is
  written. All statements are fixed, single, bound where applicable, and disable
  nested plugin transactions. Rediscover exact combined layout and verify the
  marker plus absent Q/F and still-empty records before COMMIT. Lifecycle checks
  retain the initializer-specific exact slot set: a positively discovered Q/F
  cannot disappear into the general combined classification. Re-read the final
  complete marker tuple; no unexpected control is repaired or removed. The checks
  surround every await and precede every additional effect. No partial schema is
  published outside this transaction.
- Mark the lease requires_reopen before BEGIN issuance. Unacknowledged BEGIN or
  ROLLBACK retains uncertainty; positively acknowledged rollback is clean. COMMIT
  rejection/malformed acknowledgement is outcome_unknown, without a subsequent
  rollback or inferred outcome. Only positively completed close/release/fresh-open
  permits new observation; reopened state is evidence, never automatic retry or
  completion. Hold pending work until its actual settlement. No source is read,
  changed or removed by this capability.
  In this mode an unconfirmed named-handle release after failed open/discovery
  also sets requires_reopen. A valid direct release sets that phase before any
  close/release call; failure retains the lease and refuses subsequent observe/init.
  Wrong-lease refusal changes no legitimate owner. A release retry or positively
  completed reopen is allowed; opening again directly is not.
- Internal cancellation/selection signals use private identity membership, not
  foreign exception prototype inspection. Opaque/self-throwing bridge failures
  cannot escape classification. An operation-private issuance record preserves
  actual BEGIN/write/COMMIT/ROLLBACK knowledge even through an unexpected outer
  failure; never invent an unknown COMMIT when none was issued.

Acceptance: independent design/code gates; real disposable SQLite for DDL/index
shapes, atomic rollback/COMMIT and close/reopen; adversarial bridge responses,
unknown schema/slots, denied legacy paths, wrong/stale lease, competing factories,
cancellation at initialization boundaries, pending/unacknowledged operations and
independent positive latch/F despite another control's read failure. Preserve all
S3a legacy assertions and full application checks.

The later combined owner still needs domain holds/lease borrowing, protected-store
exclusive freshness and Q/M/I/F evidence, original-source transfer, S2 deletion-control
format extension and owned SDK runtime. Its final preparation MUST freshly recheck
the complete DOMAIN source after the credential-copy hold: D1 remains eligible-empty;
AP-ACT must still match the original full source manifest and hashes, including
current deletion guard/resolution families. A credential-family snapshot or SQL
TARGET manifest comparison does not establish that domain-source evidence. Bind
these observations to the same owner generation and preserve the documented limits
on external writers. This is an implementation invariant, not a new product choice.
Q3 remains approved; Q4 is deferred to concrete later device/release acceptance and
is not a blocker for these local slices. Native activation remains unavailable.

## Native slice S3c: shared protected namespace and immutable migration port

This bounded design and implementation passed independent review, including its
isolated module placement and the correction of a reentrant-release I/O gap.
S3b is accepted; the archived full
S3 protocol remains unadopted. Implement only a dormant iOS migration capability
in `nativeCredentialMigrationPort.ts` plus a narrow internal shared-namespace
coordination module used by it and `secureCredentialStore.ts`. Keep the pure S1
imports in the isolated dormant port, outside ordinary store composition. No app caller,
SQL progress, runtime SDK integration, cleanup, activation or device action.

### Shared ownership and ordinary operations

One module-private queue and one opaque migration-lease slot cover the fixed
`curling.credentials.v1.` namespace across ALL native credential store instances,
configs, epochs and injected/default bindings. No registry partition by object or
provider. Configuration and each full operation occupy the queue through actual
settlement; a pending bridge result keeps work/acquisition/release pending. There
is no timer, forced release, reset or fake completion. Existing ordinary stores
retain their public contract and per-instance configuration state, but perform
configuration and reads/writes/removals through this common queue.

Ordinary calls arriving during migration ownership refuse immediately with the
existing fixed store_inaccessible category, even if release is already queued.
They never run later after release. Recheck ownership at queued execution and
immediately before configuration/each I/O. Calls queued before lease acquisition
finish first; calls queued behind acquisition cannot run through the lease. This
is exclusion of cooperating calls in one JavaScript context, not a native lock.
The raw binding/bridge are internal; extend targeted architecture assertions to
refuse other application import/call paths. SDK/Composition object claims are not
namespace ownership and are not used as its proof.

### Dormant capability and observations

`createNativeCredentialMigrationPort(options)` returns a closed invalid_dependency
or invalid_configuration result, or a frozen private capability. Capture once the
primitive providerConfigIdentity/sessionStorageKey, optional injected binding and
platform callable without I/O. Validate the existing slot/config/root grammar.
A missing binding loads the existing default binding lazily, only under ownership;
constructor/acquisition never loads/configures/reads/writes it. iOS-only acquisition
checks the trusted platform signal; Android/Web/throwing platform refuses before
binding I/O. Capture callable binding configure/read/write/inventory once when
resolved; malformed/getter/throwing dependencies fail closed. Do not capture or
expose remove/clear. The default binding adds only inventory, delegated to the
existing app-owned native inventory reader; Android remains closed.
Async dependencies retain S2 C4's ordinary observable return/derived-Promise
ownership precondition. Intrinsic Promise observation handles a masked own then;
poisoned constructors/species and otherwise unowned background rejections remain
outside that boundary, without global interception or a claim of universal rescue.

The capability exposes acquire, inspectNamespace, readSlot, insert, release and
local leaseState. Acquire is serialized after genuinely outstanding work and
returns only an identity-checked opaque lease. Another current owner refuses.
All operations require the exact current lease AND factory identity and check
lifecycle after awaits/before further effects. Clone/freeze successful observations.
No method returns a freshness, pairing, write-progress or access permit.
Evaluate a supplied proceed getter/callback once, preserve its receiver and recheck
the actual owner/lease/releasing/fault state AFTER that foreign evaluation. It can
reentrantly release the owner while returning true/undefined. No foreign callback
may intervene between the final synchronous authority check and protected action.

- inspectNamespace retains the complete native prefix inventory, including other
  configs/epochs, legacy, unknown and orphan names. Do not filter to current slots.
  Validate the closed dense names response and budgets using the native inventory
  rules; an incomplete/failing result is unavailable, never empty. It is a name
  observation only, not per-item absence or an atomic snapshot.
- readSlot accepts only an exact M/I physical name for the captured config/root
  (any canonical epoch remains observable). Perform a new uncached native read
  every time. Validate a closed native value/established_absent result; any other
  response is read_failed. Names/values stay private and are never error details.
- configure uses only the existing fixed prefix, synchronize=false and existing
  afterFirstUnlockThisDeviceOnly. It must settle before any inventory/read/write;
  failure stops this lease. The port owns one resolved binding/configuration;
  it never swaps/reconfigures it while the lease is held.

Any binding/inventory/read failure permanently faults that lease, prevents further
port I/O and never becomes a missing value or retry permission. Input refusal before
I/O need not fault the lease. A new owner can later observe actual preserved state;
the port does not classify/resume an ambiguous write, reconstruct Q, or clear a
migration fault. A later owner must still apply the complete cross-store protocol.

### Immutable insert and truthful interruption

insert receives primitive slot/raw strings only. Admit finite raw sizes before
parsing, then use the adopted pure M/I contracts and fixed standard SHA-256 format
predicate. Match manifest config/root, and item config/root/epoch/exact logical key
to the physical slot. Keep exact submitted bytes. No content normalization, source
fingerprint comparison, Q/M/I/D correlation or cursor authority is supplied here.

Under the same queue/lease perform a fresh per-item absence read. Present values
are never overwritten: report already_present even when bytes are exactly equal;
that is not a new write receipt. Failed/ambiguous reads issue no write. Check owner
and lifecycle immediately before the one write. Track write issuance before the
call, positive void acknowledgement separately, then require a new uncached exact
raw readback. Only acknowledged write plus matching readback returns a per-slot
verified result, explicitly not durability, whole-copy verification or a grant.

Separate not_issued/already_present from issued-but-unverified. A thrown/rejected
or malformed write acknowledgement remains issued/unverified even if native may
have applied it; do not retry, read-to-heal or change it to success. After a positive
acknowledgement, missing/unreadable/mismatched readback or cancellation also remains
issued/unverified. Retain all source/destination values and fault that lease. A
pending call never becomes issued-but-settled merely through cancellation/release.
The existing writer deletes before SecItemAdd: read-then-insert is NOT native CAS
and proves exclusion only against cooperating calls in this context. External
writers/processes/extensions/restore remain outside this evidence.

A valid release synchronously marks that owner releasing before queuing behind
issued work. It prevents new port I/O; a pending operation still owns its real
promise and checks cancellation before further calls. Once all issued work settles,
release can clear the lease: Keychain has no adapter-owned connection handle to
close. Wrong/stale lease releases change nothing. Ordinary calls made during held
or releasing ownership stay refused. No implicit retry/rebind/handoff to an existing
SDK client; ordinary refusal may set that client's existing sticky health. The
future native host must own client creation and the eventual explicit handoff.

Acceptance: independent design/code gates; multiple ordinary stores + multiple
ports sharing one namespace/queue; issuance-time refusal even behind queued release;
pending ordinary I/O/acquire/configuration/write/release; wrong/stale/copied leases;
platform refusal before binding; configuration failures; complete foreign/old/raw
namespace residue; strict observations and uncached reads; supported M/I and exact
name/header matching; present/same values never written; every interruption from
absence read through write/readback; applied writes with lost acknowledgements;
late success/cancellation cannot clear faults; actual pending work remains retained.
Targeted architecture exceptions may allow this ONE inert port to import the pure
S1/slot/fingerprint helpers; original pure contracts/SDK-import boundaries stay intact.
Only the ordinary store and this dormant port may import shared coordination;
only the established ordinary binding loader and dormant port may resolve the
raw binding. Coordination exposes no reset/force-unlock or raw storage. It validates
private owner/lease identity itself; callbacks are internal to those exact callers.
Native capacity/durability, exact provider-config-to-ID assignment, external-writer
exclusion, full Q/D owner, SDK send ownership, original-installation transfer and
physical-device/release acceptance remain open. No new product decision follows.

## Native slice S3d: borrowed domain preparation and non-consumable holds

This bounded design and local implementation passed independent review on
24 October 2026 after corrections. It does not adopt the full archived S3
owner/finalizer. Keep the existing standalone runner/default binding
behavior. Add a separate dormant `createNativeHeldDomainMigrationRunner` factory,
initially over the actual records-only legacy target and its already acquired real
lease. No application consumer, combined target, Q/M/I write, finalization, B4,
activation or device action. S3b inventory leases do not expose domain rights and
cannot be adapted into a target. All existing factories still refuse combined
schema through the standalone/legacy path.

### Authentic private borrow evidence

Add one narrow internal registry module, imported only by the real native adapter
and runner. Only the adapter registers actual targets using the canonical D/latch reserved
keys; custom reserved-key pairs are not domain issuers. The runner cannot register
an issuer. Key registration by exact target identity and capture/freeze the REAL
adapter execution methods before exposing its mutable public target. A held
runner resolves this registered execution view, never mutable caller methods,
proxies, supplied counters, booleans or a structurally equivalent test target.
No native I/O occurs through registry lookup. Keep raw SQL/plugin ownership in
the existing adapter. No reset, force-unlock or manufacture-from-public-evidence.

The adapter supplies two private opaque revisions bound to its exact current
lease/registry owner:

- Lifecycle stamp: rotates before acquire/reopen/release boundaries. It remains
  valid during the holder's own issued transaction, even while its phase is
  requires_reopen. It proves identity/lifecycle only. New work separately requires
  ready state; no outstanding uncertainty is bypassed by a current lifecycle.
- Evidence stamp: rotates conservatively before potentially mutating target work,
  including transaction issuance, reopen and release. Never restore an old stamp
  after rollback/failure. Later combined Q writes must rotate this same evidence
  revision; that future capability is not implemented here.

Positive successful-reopen evidence is private, tied to the actual lease AND
current lifecycle and minted only after close/release/fresh open all succeed.
It cannot survive a later failed/pending reopen or satisfy a recovery need that
arose after that confirmation. Open-cleanup/release uncertainty also prevents
borrow readiness, even if the legacy public lease phase alone appears ready.
New task entry also checks retained handle/open-cleanup uncertainty while a child
is pinned; a mid-collection failed OPEN cannot issue a second native OPEN behind
unconfirmed cleanup. Readiness and lifecycle checks must not self-cancel the
child's own transaction. Unborrowed legacy task semantics remain unchanged.

One borrower may exist per actual lease. Keep a private borrow pin on the real
target while the child is active or retains warm/unknown/fault evidence. Parent
release refuses with fixed borrowed_evidence_held while pinned; parent reopen is
allowed for recovery. A second child cannot cold-recreate the first child's state
in the same process. Child dispose stops synchronously, invalidates its holds,
joins actual work and never releases the parent lease. It reports retained fault/
plan evidence and keeps the pin when either remains. Only a clean child disposal
can drop that child's pin through its private registered capability; it creates no
new child for the same lease. A new lease requires actual parent release/acquire.
No user-supplied dependency flag can unpin or erase evidence.

### Preparation, holds and recovery

Reuse the existing domain rules, inventory (including deletion guards/resolutions),
manifest/checkpoint protocol and warm evidence. The held mode never acquires,
reopens or releases a target lease. It captures the authentic parent lifecycle at
each explicit run and checks it after every await/foreign callback and immediately
before effects; reentrant callbacks cannot preserve a superseded owner. Pending
native calls retain their ownership until real settlement.

Intercept BOTH create_fresh_active (D1) and activate (AP-ACT) at the actual
activation transaction step BEFORE prepareTransaction. Execute the normal plan
prefix first, including AP-ACT's checked marker write where required. Generate
no active-record bytes or activation timestamp. D1
allocates one validated private expectedStoreIdentity once per child lifetime;
repeat preparation never changes it. AP-ACT uses the current verified D identity.
A uuid/fingerprint/format callback is not authority; recheck actual lifecycle and
evidence stamps after it. Already-active D is separately refused without returning
an access/B4 result and without reading its old source.

Before issuing a hold, take the current authentic evidence stamp and collect a
NEW complete domain snapshot using the existing collector and surviving warm
memory: independent D/latch, full target key set and all staged value digests,
full eligible domain-source inventory/content and marker. Preserve whole-list
unsupported-control refusal before source payloads. Re-evaluate the normal rules;
only a still-eligible D1/AP-ACT preparation can hold. This fresh target collection
replaces the full AP-ACT target verification that formerly occurred only inside
its now-unissued transaction. Preserve all detected contradictions/fault stops,
known row loss and unavailable observations; do not weaken a positive fault into
retryable uncertainty. Borrowed collection progressively retains POSITIVE warm
fault proofs before any later callback/await: raw record, complete target listing
BEFORE any digest, and each independent warm value BEFORE the next native value
read. Its observer runs only the existing pure warm precedence with normal-state
prerequisites omitted, retains faults only and cannot grant or issue work. The
standalone collector has no observer and retains its existing batched read path.
After a fully positive unknown classification, promote the observed after/before
state into surviving memory before holding. A confirmed after-state cannot later
be reclassified as an unresolved before-state. Final evidence stamp must still equal the captured one;
no effect or foreign callback follows its final authority check before token issue.

Return a SEPARATE private held-report/opaque-token type, not the existing Access/
Recovery report. Bind token identity to this runner, exact native lease, both
stamps, lifecycle, expected identity and the most recent successful preparation.
No consume/finalize/commit method exists. A local isCurrentHold predicate is an
observation only, never a native write/readiness permit. Any new explicit run,
disposal or fault invalidates prior holds, as does actual issuance of parent
write/reopen/release work. Wrong/stale-lease refusals and the pinned parent's
release refusal issue nothing and remain effect-free. A new hold
after parent progress requires full new observation, never relabeling a token.

All original unknown transactions, confirmed warm rows and in-process fault/latch
attempt counts stay in the SAME child across parent recovery. Normal halt and
latchPhase must ask for parent recovery instead of calling reopen. A recovery
requirement captures the last authentic reopen confirmation; only a distinct
new, current, positively completed parent reopen can clear it. Do not accept old
success, a caller counter, ready alone, or a failed later attempt. Bounded latch
writes may continue under the same identity after that recovery, with original
I-13 precedence and no access. Dispose with retained evidence is terminal/pinned
for this context, consistent with the existing conservative disposal contract.

Acceptance: independent design/code gates; unchanged standalone suite; actual
plugin-faithful and disposable real SQLite targets for borrowed D1 and AP-ACT,
copy-to-verified preparation, unsupported combined schema and no B4. Verify target
method replacement cannot change captured execution; fake/copied target/lease/
stamps refuse; double borrowers/parent release cannot forget held evidence; own
transactions do not self-cancel; stale holds after writes (including failed/rolled
back ones), reopen, release, later run and disposal. Fresh target/source deletion
control changes must prevent holds. Cover pending transactions/disposal, positive
fault despite failed other read, unknown commit, parent-recovery failure/stale
success, latch uncertainty/bounded attempts and callbacks superseding lifecycle.
No actual device or credential value is used.

The later combined owner must still provide its own guarded target, Q/M/I/F
protocol, private finalizer and source-free readiness; after the credential-copy
hold its final prepare AGAIN reads the entire current domain source and target,
then verifies target evidence inside the final SQL transaction. These holds are
neither that final evidence nor permission to substitute matching caller objects.
External domain writers and physical rollback remain documented limits. No new
product decision or Q4 acceptance is made here.

## Native slice S3e: isolated combined SQL host with held-only domain rights

This bounded design passed independent review on 24 October 2026; its local
implementation passed independent code review after corrections on 25 October.
The preceding S3d acceptance remains valid and its legacy/default interfaces stay intact.
This implementation joins ONLY SQL ownership/observation/domain preparation. It does
not implement Q progress/resume, protected-port linkage, a finalizer, B4, an SDK
host, transfer/retirement, activation or a release decision. S1/S2 stay unchanged.

### One real private SQL owner

Add a NEW dormant `createNativeCombinedHeldSqliteHost` factory over the existing
builder, returning an authentic opaque host with ONLY parent acquire/observe/
initializeEmpty/reopen/release/leaseState operations. Return no ordinary store,
adapter, raw connection/SQL, or public NativeSqliteMigrationTarget. Ordinary,
diagnostic, legacy and S3b factories retain their current boundaries and outputs.
A new `createNativeCombinedHeldDomainMigrationRunner` resolves that exact host
and actual lease through the private registry. It reuses the S3d held runner,
never the standalone runner. No matching caller object, target cast or property
flag constructs these rights. The internal execution view stays frozen/private.

The host and held execution use ONE connection, queue, database-registry owner,
lease, lifecycle/evidence stamps, reopen receipts, pin/tombstone and uncertainty
state. All parent init/reopen/release boundaries participate in those stamps;
do not copy today's independent S3b wrappers unchanged. Successful older reopens
cannot certify later pending/failed ones. Wrong/stale/refused calls issue no work.
Accepted parent observation invalidates prior holds conservatively before reads;
identical later reads cannot revive the old token.

Physical readiness stays separate from semantic progress eligibility. Lease/handle
uncertainty prevents new native tasks; an issued transaction's own uncertain phase
does not self-cancel. Q/F/schema refusal never erases the child's warm/fault memory.

### Initialization and progress domain

`initializeEmpty` keeps S3b's exact atomic empty-only protocol, expected controls
and actual issuance journal. It runs BEFORE borrowing. Existing D/latch/app rows
are not adopted by adding a marker; existing combined structures are observed,
never repaired. Domain preparation requires the exact initialized combined schema
and exact schema marker, positively absent Q and positively absent F. Any present
Q (including valid unbound or bound Q) is observation-only/refused: no parsing a
binding into authority, identity selection, continuation or invented empty state.
Any F presence, malformed/newer marker or unavailable control blocks progress.
Known positive control contradictions stay private/pinned; no clear/repair API.
Historical positive schema proof survives recovery. Later records-only/empty
discovery is retained as schema loss by observation, domain selection AND the
initializer itself; it cannot rebootstrap that known loss. A first legacy/empty
target without that history is not falsely classified as a loss. Favorable
schema/Q/F observations certify only the lifecycle in which their reads started;
older completed observations may retain contradictions, never readiness.

Domain reads retain structural selection separate from these semantic conditions.
The child still collects independent raw D/latch, complete target names, each warm
value and source evidence as governed by its existing domain rules. A failed or
contradictory Q/F/schema read cannot hide already positive domain faults. No
ordinary access, activation or source retirement follows from a domain hold.

Normal plan steps check fresh controls at selection; every normal domain SQL
transaction rechecks exact marker + absent Q/F INSIDE its transaction before any
write and again before COMMIT. A hold repeats full fresh domain evidence, then
fresh actual control selection and finally authentic lifecycle/evidence checks.
No foreign callback follows that last authority check. Extra native awaits retain
real pending ownership; stale preparation is re-read, never relabeled.

A proven domain fault stays private/pinned even if controls block writes. Its ONLY
possible write exception is the canonical bounded D latch, under an authentic
fault permission, exact supported combined structure and positively exact schema
marker. Q/F presence or unavailability does not grant ordinary writes and cannot
clear that stop. If the marker/structure cannot be established, no latch write is
issued; retain the in-process stop and pin. No Q/F write is added by this slice.

### Adapter-enforced held-only transactions

The private combined target cannot accept caller-owned transactions. The existing
runner prepares only pre-active operations and retains its interception of actual
create_fresh_active/activate BEFORE preparation. Register a one-shot private
transaction permission bound to the actual child/lease/lifecycle and exact owned
immutable transaction bytes/callbacks, issued only by the held-runner path.

For combined normal writes the private permission boundary itself parses the
owned recordAfter using the canonical record validator and captured format
predicate, requires a VALID NON-ACTIVE phase and an allowed pre-active operation,
and fences every callback completion. An active record never receives permission.
The adapter consumes only this authentic exact permission before BEGIN; copied,
mutated, reused, foreign-lease or structurally equivalent transactions refuse with
no I/O. It never trusts a caller-supplied parsed object or validation Boolean.
Latch permission is separately restricted to the held runner's retained positive
fault and exact bounded latch transaction. No general transact capability escapes.

The internal registry may gain the canonical pure record-validator dependency
for this check, with one exact architecture exception. It still has no storage,
SDK or application dependencies. No new S1/S2 importer is added. Legacy targets do
not inherit these combined permissions or semantic gates. Preserve truthful
before-BEGIN, rollback, issued write and unknown COMMIT outcomes; new combined
queue fallback cannot invent a COMMIT without actual issuance knowledge.

### Parent observations and child activity

Do not let a parent observation misclassify the child's acknowledged write before
its awaiting continuation updates warm memory. Track actual child-run activity
and admitted parent-observation activity privately in the registered host/child,
set synchronously before queuing/awaiting and released only after real settlement.
No user Boolean or timeout clears either. Concurrent child runs still join.

Parent observe during a child run refuses before native I/O. A child run while an
admitted parent observe is pending returns a fixed busy report without clearing
memory or demanding a fabricated recovery. Parent reopen remains allowed to
cancel/recover a child; pending child promises remain retained until settlement.
Pin-protected parent release/init remain refused; no force-unlock is introduced.

When a child is settled, parent observe may independently read controls. Feed each
successfully obtained D/latch observation into that SAME child's private pure
warm-fault observer BEFORE a later schema/Q/F read or callback can cancel the
parent observation. Retain positive control contradictions progressively as well.
An existing fault stop keeps its original findings, latch bytes, established
state and lifetime attempt budget; another observation cannot replace or reset it.
The observer has no write/grant authority; a detected fault only retains the stop,
invalidates holds and leaves any bounded latch to an explicit child run. Unreadable
or omitted facts cannot manufacture a fault. Physical readiness, pending activity
and semantic eligibility remain separate, so own native work cannot self-cancel.

### Acceptance and limits

Independent design/code gates; real disposable SQLite + installed-plugin model.
Cover empty bootstrap then copy-to-verified hold in one exact owner, existing
combined retry, no legacy adoption/repair, all older factory/default regressions,
no ordinary/target exposure, fake/copied host/lease/permissions, active/copy/reused
TX rejection before BEGIN, per-TX control changes before writes/COMMIT, independent
D/latch/schema/Q/F failures, progressive known warm/control contradictions before
cancellation, latch exception and denied marker case, two reopens and failed
open-cleanup, pending parent observation/child run/reopen/disposal, actual activity
ownership, and callbacks causing supersession. Existing S3d negative proofs remain.
Architecture tests identify exact dormant importers/factory references and enforce
no app/SDK/activation consumer. No Keychain/device/live server is used.

This host proves neither install provenance, a cross-store snapshot nor physical
namespace exclusion. Any persisted Q requires a later reviewed common owner and
correlation; final Q/D binding, source-free admission, SDK runtime, installation
transfer and Q3 cleanup remain separate work. No Q4 acceptance follows.

## Native slice S3f: common Q/M/I executor and atomic D/Q completion

This technical design and its complete dormant implementation passed independent
review on 25 October 2026 following S3e acceptance. The archived full S3 proposal
is not adopted wholesale. This slice implements one coherent dormant iOS executor,
including its actual source binding, private SQL/protected ownership, fresh copy,
restart of every state it produces and atomic completion. It returns only an
internal completion candidate: no ordinary adapter, SDK, identity admission, B4
application grant, mount, source retirement, transfer or activation. S1/S2 and all
older factory/default contracts stay unchanged. No new product decision or Q4
acceptance is required for this local development scope.

### Private owner and actual sources

Add a separate common-owner factory/module, with a NEW private SQL role over the
existing builder. Do not turn S3e's permanent Q-presence refusal into a permissive
flag. Construct/capture the actual SQL host and protected port privately; public
methods provide only joined run, explicit recovery, disposal and observation of
an opaque completion candidate. No caller-supplied snapshot, target, Boolean,
matching identity object or erased TypeScript brand proves authority. Capture
dependencies once, contain foreign failures/observable async returns, and fence
every callback/await against real current ownership before any subsequent effect.
Construction/import performs no native I/O. Require explicit validated config ID,
SDK root, fingerprints, format, UUID/clock and engineering bounds; do not read
configuration files or invent the later production config-ID mapping.

All SQL work uses ONE connection, registry owner, queue, lease, lifecycle/evidence
stamps and actual issuance journal. Retain the existing physical-readiness and
pending-handle fences independently of semantic progress. The new private role
permits only initial Q insertion, legal exact-byte Q CAS transitions, F insertion
on positively established absence, held-only domain preparation and ONE atomic
D/Q finalizer. No public SQL/transact operation or ordinary adapter escapes.

Add the actual narrow credential-source binding inside the storage boundary as
part of this executor, not a separate accepted helper stage. It inventories the
real WebView source, rejects unsupported own SDK names BEFORE payload reads, and
reads all listed supported own keys plus the four independently observed fixed
slots, deduplicating overlap. Never read foreign values. Use the existing S1
quiescent-snapshot validator for complete key/read consistency, unindexed flows,
referenced flows, raw preservation and inline/detached identity consistency. No
read failure is absence; no arbitrary enumerationComplete:true is authority.
This same actual source context supplies domain migration. Do not claim access to
an older installation/origin that this WebView cannot reach. Physical installation
transfer remains S4. Source APIs in this slice issue no removal.
Bind the domain and credential source capabilities to the SAME actually resolved
WebView storage instance, lazily only in an unbound migration branch. Add their
private synchronous final fence inside localStorageAdapter.ts, the sole global
storage boundary. It freshly enumerates supported own/domain names and rereads
exact owned raw values, the source marker and all required fixed absences against
the already owned proof. No hashing, await, injected predicate, SDK/format callback
or caller snapshot is involved in that fence. It returns only unchanged, positive
change or unavailable; a failed read cannot erase an earlier positive difference.

Hold both SQL and protected namespace ownership across preparation, copy and
completion. Ordinary protected calls refuse while owned. Public parent observation
cannot enter an active child's acknowledgement-to-memory continuation. Pending
reads/writes/COMMIT/disposal remain owned until actual settlement; no timer,
cancel flag or guessed failure permits release. Clean pre-write disposal may
release positively confirmed resources; retained warm/unknown/fault evidence
keeps its pin. There is no force-unpin, repair, clear-F or automatic rollback.

### Domain identity and controlled Q progression

First observe independent SQL controls and the COMPLETE protected namespace,
before consulting old source payloads. Existing active/bound pairs take the
source-free branch below. Any F, unsupported structure/marker, invalid metadata,
foreign/orphan namespace artifact or contradicted pairing blocks. Preserve
independent positive D/latch/warm facts even when another read fails. Empty-only
initialization retains S3b/S3e anti-adoption and historical schema-loss rules.

For a fresh protocol, prepare the domain to an authentic held D1/AP-ACT point while
Q is absent. Resolve its private SID and exact current evidence through a runner/
registry-only continuation; no public SID selector or generic hold consumption.
Q intent takes that SAME SID and newly generated immutable protocol/epoch/manifest
IDs, config/root/version and the complete current credential keyset. It is inserted
only against the exact fresh SQL tuple and fresh empty protected namespace. No
credential items precede Q intent. Q contains no raw credentials or fingerprints.

Q present is not general domain-write authority. The new role may recognize only
the exact Q bytes it has actually validated/correlated under its current owner.
After intent, only revalidation of the prepared D1/AP-ACT point is allowed; no new
domain checkpoint, activation, manifest extension or different SID is smuggled
through Q progression. D1 must remain eligible-empty; AP-ACT must still match the
original complete manifest/source/target, including deletion guards/resolutions.
Source growth/change at this point blocks completion rather than adopting it.

Cold unbound restart reads and validates the actual Q. D absent is permitted only
for the same proved D1 case; seed its private expected identity from this Q after
actual namespace/source checks, never generate a replacement UUID. Existing D must
be verified and have the same SID. A copying/enumerating D with an already-issued
Q is not a state this ordered executor produces and cannot acquire new rights.
Retain the same child/warm history through in-process recovery. Q CAS invalidates
old holds; obtain a fresh authentic preparation after credential copy.

### Frozen protected copy, including interruptions

Follow S1's exact Q edges: intent, manifest_confirmed, copying with ordered cursor,
credentials_verified, then bound ONLY inside the final D/Q transaction. Empty
credentials still create M with four actual fixed absences and traverse every edge.
Use the reviewed physical-slot codec and SHA provider, with explicit dependency
injection rather than a weak fallback. Enumerate ALL owned namespace names; other
configs/epochs, legacy raw slots and unknown names cannot be filtered away.

Before M exists, intent freezes keys, not prior value fingerprints. Only a fresh
complete same-key source snapshot and a clean namespace with no issued I may
produce M. Once M is positively present, retain its exact immutable bytes/header,
inventory and fingerprints; never re-freeze, replace, extend or shrink it. Loss or
change of known M is a retained contradiction. Copy each I through the actual port
with exact header/SDK raw bytes, current source checks and immutable insertion.
already_present is NOT proof: separately uncached-read, parse, correlate exact raw
content and compare its digest to M before confirming the next cursor rank.

On restart, existing exact M and already-written exact next I can explain a lost
protected acknowledgement or interruption before Q cursor CAS. Confirmed cursor
items must all remain present/exact; missing/different known M/I is a fault. This
single non-atomic protected/SQL cursor case does not excuse mixed atomic domain
checkpoints or a mixed final D/Q tuple. Unexpected additional items, unsupported
namespace material, changed keys/content after M or failed evidence never grant
progress. Complete fresh inventories and fixed-slot absence reads remain required.
Retain each positively obtained warm Q/M/I/source contradiction BEFORE a later
independent read/callback can fail or cancel. A new observation never resets the
original fault, known immutable bytes, confirmed cursor or attempt history.

Protected-port failure must not be healed by a read on its faulted lease or by SQL
reopen alone. Explicit recovery waits for actual pending settlement, retains SQL
lease/RAM journals/fault counters, establishes a new real protected ownership
context, and fully reobserves namespace/M/I/source before any retry. If this uses
release/reacquire, claim no continuous exclusion: detect intervening changes from
the retained protocol evidence. An uninterrupted private lease replacement is
allowed only as an actual queued ownership transition, not a public reset/freshness
grant; full reobservation is still mandatory. No failed write is blindly repeated.

### Fresh final evidence and one atomic completion

After copying, collect NEW complete domain evidence through the actual source,
including fresh inventory and all deletion-control families, and obtain a new
authentic held preparation. Collect NEW full credential source, M, all required
I/absence reads and complete current namespace under the actual protected lease;
use validateFrozenCopy for exact bytes/header/inventory/digests. Fence every digest
and format callback, and recheck owned raw source snapshots after callback work.
An earlier domain hold or structurally valid M is not this final evidence. The
binding proves only cooperating same-context ownership and actual sequential
observations, not an atomic cross-store snapshot or physical rollback detection.

Mint a private one-shot immutable finalization journal only from those actual
current proofs. Preserve exact Q/D before bytes and canonical planned after bytes,
SID, lifecycle and complete target verification. Generate no new SID at completion.
Inside ONE SQL transaction, independently recheck exact supported schema/marker,
Q, D, both fault latches and complete domain target names/values; verify the held
target content through the existing canonical evidence rules. Apply Dactive and
Qbound against their exact before values, checking each one-row acknowledgement.
Immediately before COMMIT, check the full planned after tuple and target evidence
again, with current ownership/source fences. Own intermediate Dactive/Q-unbound is
transaction-local work, not a foreign mixed startup state. No classifier may
self-cancel this issued transaction. No rollback after COMMIT issuance.

The last source fence is ACTUAL fresh synchronous I/O, not a stamp/snapshot-only
comparison. Run it AFTER the final awaited SQL read/digest and every foreign
callback, in the SAME synchronous turn immediately before issuing COMMIT. After
that fence, only pure internal ownership/journal checks may run before the
captured native COMMIT invocation. Require exact domain/credential raw snapshots,
marker, names and fixed absences; changed/unavailable source aborts without COMMIT
and retains positive contradictions. Use the credential-source form of the same
fence before committing each Q-progress transaction. This closes cooperating
same-JS-context writes during preceding awaits without claiming exclusion of
another process/WebView or OS restore. No recursive async guard/digest loop.

An unknown SQL COMMIT, for Q progress OR finalization, remains journaled under the
same owner. Actual positively completed close/handle-release/open precedes a new
classification: exact full before permits only a freshly proved retry; exact full
after confirms once; mixed/neither is a retained fault; unavailable facts remain
unknown. Positively confirmed after-state later lost cannot regress to before.
Classify exact SQL-after FIRST, independently of old sources. Once the final
Dactive/Qbound after-tuple is positively established, continue through the
source-free bound observation; do not call either source or validateFrozenCopy
to recognize an already completed final transaction. Only SQL-before retry needs
new complete source/protected evidence, holds and final fences. The same ordering
recognizes a Q-progress after-state before deciding whether any further action
is currently permitted; recognized progress alone grants no completion.
Never reconstruct a COMMIT that was not actually issued. Preserve first fault,
original findings/latch content, established state and bounded attempt counters
through observations/recovery; F writes are insert-only and bounded, not repairs.

Only confirmed completion may use an authentic runner/registry continuation to
retire this child's warm preparation and transfer its pin into the common owner's
completion context. Keep parent observation barred until that memory transition
settles. No generic unpin/consume API, arbitrary token or caller claim can end it.
Return an opaque private completion candidate, not app/identity/storage readiness.

### Source-free bound observation and acceptance

Cold Dactive/Qbound requires current exact supported SQL controls and correlated
protected M/complete namespace/current I envelopes. Never read either old source,
reimport, compare mutable I to historical M fingerprints/cursor membership, or
require present credentials merely because they were historically copied. A
positively absent current session is a reauthentication candidate, not data loss
or a source fallback. Validate current addressed I forms/header; do not impose
frozen cross-key SDK write-order consistency on mutable runtime state. Any
current-epoch supported runtime keys may exist beyond historical M membership.
This branch still returns only an internal candidate; actual B4/runtime handoff
and existing identity authorization remain separate work.

Acceptance requires independent design/code gates and real disposable SQLite
combined with injected protected storage/source faults. Cover fresh D1 and AP-ACT,
empty/nonempty credentials, cold restart at EVERY Q edge/cursor, private D1 SID
adoption, immutable M/I, applied-write/lost-ack/readback failures, protected new
ownership, real pending and disposal, exact before/after/mixed SQL outcomes for
each write/COMMIT boundary, warm positive loss before later failure/cancellation,
fresh source/target changes during credential copy and before final COMMIT,
callback supersession/reentrancy, stale/copied/reused permissions, bounded faults
and completion memory retirement. Bound tests make both old sources throw on
every access and assert zero calls, while exercising mutable current credentials.
Keep older factory suites and exact architecture import/consumer guards. Full
repository verification remains required. No real Keychain, device, hosted server,
installation, credential removal or activation is part of these local tests.


### S3f implementation acceptance — 25 October 2026

The separate `nativeCombinedMigrationOwner.ts` owns one actual lazily bound WebView
source, combined SQL context and protected namespace lease. It implements every Q
edge, immutable M/I copying, generated-state cold resume, actual acknowledgement
uncertainty, fresh final evidence and atomic Dactive/Qbound completion. An authentic
hold binds the complete raw target values actually read and digested by its successful
collection, including cold preparation. Finalization compares that owned proof with
the actual source and both in-transaction target observations; historical expected
hashes never masquerade as newly computed digests.

Private callback-free cancellation cells belong to one owner lifecycle. Old work
cannot borrow/cancel a replacement cell. Domain preparation, source-marker writes,
F persistence and the last synchronous source-fence-to-COMMIT boundary retain that
same authority. Positive source/SQL/protected contradictions survive later failures;
clean rollback requires actual fresh lifecycle provenance before retry. Unavailable
fingerprint/format dependencies block without manufacturing a permanent data fault.
Unexpected async UUID/clock/platform results are observed under the existing bounded
provider-return contract; this does not promise containment for arbitrary poisoned
Promise constructors/species or provider-orphaned rejections.

Empty credentials still require an actual M and independent addressed protected
fixed-slot absence reads before every Q edge. Bound observation remains source-free
and checks the addressed slot against the current envelope key/header/form, allowing
legitimate mutable runtime contents beyond historical M membership. Completion
retains ownership and returns only an opaque internal candidate. No adapter, SDK,
Profile admission, source cleanup, physical transfer or activation is exposed.

Independent review and the complete verification baseline are recorded once in
`TESTFLIGHT_READINESS.md`. Tests combine real disposable Python SQLite with
source-derived installed-plugin preprocessing and injected protected storage/faults.
The Android preprocessing variant is not an Android executor or platform claim.
The subsequent S3g section closes private runtime handoff; S3h supplies the inert
standard D-value fingerprint helper; S3i implements explicit dormant Q3 source
retirement; S3j hardens the existing credential hash invocation. Actual production
config-ID/composition, application/SDK ownership, operational installation transfer,
source-writer exclusion and device/release acceptance remain separate gates.

## Native slice S3g: private runtime handoff and mutable envelope stores

This technical slice follows S3f acceptance and passed independent DESIGN review
on 2026-10-25; the bounded implementation also passed independent CODE review. No
application admission is adopted by this text. The authorized local beta-completion
work permits its bounded development. Q1/Q2/Q3 remain as approved; Q4 stays deferred. No new
product choice is needed for a dormant storage pair that creates no identity or
training admission.

### One private role transition, two actual held resources

Add a separate dormant factory over the actual S3f common-owner builder. Preserve
the existing S3f factory's public shape and all older factories/default behavior.
The new entry may return migration controls plus an explicit joined handoff of an
authentic current completion candidate. Only the actual owner can authenticate it;
cloned/old/cross-owner candidates, IDs, Boolean readiness and caller snapshots grant
nothing and cause no handoff I/O. Concurrent handoffs of the same current candidate
join one attempt. A completed handoff is one-use; no second pair is minted.

Continue using the SAME actual SQL connection, registry reservation, queue, lease,
completion pin and protected namespace lease/queue/binding receiver. Do not release
and reacquire, configure a second binding, construct an ordinary store, or reopen a
second handle to make the existing gates disappear. The existing composition that
opens and claims its own stores remains unchanged and unavailable in production.

Handoff admission requires a NEW source-free bound validation through those actual
resources: exact supported structure/marker, Dactive/Qbound/same SID and immutable
metadata/header, both latches absent, correlated exact M, complete namespace and
current addressed I headers/forms. Existing current I values may differ from M;
new supported flows and a positively absent session are permitted. Never consult
either old source, require historical I membership/digests, or accept an unresolved
final-COMMIT journal. The cold-bound path performs the same validation. A process
stop needs no new durable handoff marker: the next process observes real bound state.

Prepare both narrow runtime capabilities privately and reserve the owner throughout
all actual asynchronous work. Capture additional mutable binding dependencies once
from the SAME receiver resolved by the existing port, only when the new role needs
them. Migration alone must continue ignoring `remove` and replacement-loss properties.
Missing/hostile/async/unreadable dependencies refuse handoff without creating a data
fault or a half-published pair. All callback/await boundaries use genuine per-attempt
controls; old work cannot obtain or cancel replacement controls.

Publish BOTH facades together only after complete preparation and fresh current
ownership checks. The final logical role change is synchronous, with no await or
foreign callback between the private resource commits and publication. No public
matching object authenticates either permission. Interrupted preparation retains
both old owners and publishes neither facade. A failed attempt requires fresh
current evidence before a new attempt, never replay of its prepared permissions.
After successful publication the migration role is terminal: its old run/recover/
dispose methods and stale continuations cannot issue work or close runtime resources.
Only the new pair's owner controls their lifecycle.

### Concrete runtime pair and SQL rights

Return a frozen owned pair containing a real `RemovableStorageAdapter`, a real
`SecureCredentialStore`-compatible envelope store, separate fixed-category health
observations and one joined terminal disposal. It is a storage capability, not B4
application publication, an Identity/Profile admission, a trusted-device grant or
an SDK client. No production application/composition/identity consumer is added.

SQL methods execute on the retained queue under the genuine runtime role. They
validate supported structure, exact current bound D/Q and absent fault controls,
then the actual addressed domain operation. They cannot write/read as ordinary
domain data D, its latch, credential metadata, schema controls or SDK credentials.
Accept primitive string domain keys apart from explicit reserved namespaces: the
whole `curling.nativeMigration.`, `curling.credential`, and
`curling.installationTransfer.` protocol prefixes and the whole `sb-` SDK prefix are
refused before domain I/O. Credential metadata remains in its private table with no
ordinary table/SQL selector. Do not apply migration eligibility as a runtime allowlist:
ordinary keys, including the bare legacy keys used by existing sporting retirement,
keep their generic get/set/remove behavior. Never coerce hostile arguments or leak
error details. Current legitimate domain values
are mutable: no historical source/manifest digest constraint and no reimport.
Profile-scoped physical keys are captured per call; no mutable current-Profile
pointer or multi-key repository transaction promise is introduced.

Reads return absence only from an actual valid empty row result. Writes/removals
require real statement and transaction acknowledgements, preserving actual issuance,
unknown outcome and cleanup evidence. A remove of an actually absent ordinary key
may succeed under the existing adapter contract. No rollback after COMMIT issuance,
blind replay, default write, compensating mutation or read-to-heal behavior exists.
A transient failure returns the existing normalized failure shape and sticky domain
health; it does not manufacture F. An unconfirmed BEGIN/ROLLBACK/COMMIT, uncertain
handle state or any domain-store failure immediately closes the private SQL I/O
permission. All later domain calls return normalized failures without SQL I/O, and
protected calls obtain no new SQL-anchor grant. Already prepared protected anchor
permissions are synchronously invalidated too; every not-yet-issued item/readback
I/O checks the current permission. Work already issued stays owned until settlement.
Successful ordinary domain writes do not by themselves invalidate current protected
header permissions merely by advancing a migration evidence stamp. There is no read-to-heal or runtime
reopen/retry path; only terminal physical cleanup remains permitted. It cannot become a saved-local claim. Already
issued work remains owned until actual settlement even if publication is cancelled.

### Addressed mutable I operations under the retained namespace lease

The new protected capability must own actual runtime read/replacement/remove rights;
immutable `insert` or an ordinary store that refuses the held lease is not sufficient.
Capture real `remove` and the explicit replacement-loss Boolean from the actual
existing binding receiver without widening the old factory's captures. Never capture
clear-all, a general repair or a second binding. Failed handoff leaves no mutable
facade reachable.

For each runtime call classify the logical SDK key with the current S1 contract,
map only to its current config/epoch physical I slot, and check the current bound
metadata/M anchor plus actual addressed item evidence. Parse the I header and SDK
form, including exact physical-slot/key equality. Reads expose only exact SDK raw
bytes. Positively established item absence is absence; failed/ambiguous read is not.
A foreign/malformed existing envelope is retained and refused rather than replaced
or removed as a repair. Unsupported caller keys fail before native item I/O. M is
immutable and never writable/removable through this capability.

Runtime validation is per item. Do not enumerate/join index references, enforce
quiescent cross-key consistency, compare historical M hashes/cursor membership, or
repair orphaned/missing flow relationships. New supported current-epoch flows,
session/token updates, empty current indexes and a positively absent current session
remain supported. SDK-initiated ring eviction/cleanup uses only its addressed calls;
the boundary adds no eviction or unindexed-item deletion.

A replacement serializes a canonical current-header I around the EXACT supplied SDK
raw string, after validating that string and any existing addressed envelope. Require
an actual write acknowledgement plus fresh uncached exact-envelope readback. Removal
validates existing addressed evidence, requires the actual binding's positive
per-item removal report and a fresh individually established absence. The closed
acknowledgement table accepts `{kind:"deleted"}` and `{kind:"nothing_to_delete"}`
only; the latter is the real normalized idempotent false-plugin report and may succeed
when fresh item-specific readback establishes absence, including an already absent
slot. A naked/malformed Boolean, `{kind:"no_evidence"}`, unknown shape or failed
acknowledgement is not successful and cannot be healed by a later null. Inventory
absence or an old M entry is never this per-item evidence. Readback is API evidence, not disk durability or physical
erasure. Applied writes/removals with lost acknowledgements or failed readback remain
honestly unverified; no retry/compensation or later null turns them into success.

### Separate failure channels and terminal cleanup

Retain fixed operation/outcome/issuance evidence without raw values, keys, IDs,
exceptions or digest material in reports. A failed replacement records the binding's
actual possibility of losing the previous value. Credential runtime failure is
sticky for that runtime owner, including failed reads/writes/removals, and stops
further credential effects. It does NOT create migration F or automatically disable
otherwise healthy SQL domain persistence. This is only separation of storage health;
S5 must still bind Q1 to a preexisting same-Profile training admission and map cloud,
provider denial, sign-out, UI and other contexts. No training exception is minted here.
A domain failure never permits false save success. Actual positive protocol/pairing
contradictions preserve their first cause, stop both facades, and may persist bounded
F only through an authentic still-current private fault role. Attempts/history do not
reset at handoff. Unavailable evidence is never a positive data contradiction.

Do not create reciprocal queue waits. The SQL lane never waits for the protected
lane. Protected work may obtain current SQL-control evidence under a documented
single ordering before its item effect; a pending protected call cannot make an
otherwise healthy SQL write wait for that protected call. Terminal disposal closes
both facades synchronously before awaiting real pending work. It joins repeated
calls, issues no new runtime operations, and records actual SQL close/handle-release
and namespace-drain results.

Cleanup needs private prepared/confirmed release rights, not removal of the old
completion pin in order to call a refusing public release. Keep logical reservations
while physical cleanup is incomplete. Only actual clean resource receipts can retire
both logical reservations together without an await/foreign callback. Any uncertainty,
cleanup failure, retained positive fault or sticky runtime failure retains a logical
tombstone so a new owner in the same JS context cannot forget it. No reset, force-unpin,
in-document heal/rebind or automatic recovery is added. A new process uses full normal
bound checks; physical restore guarantees and Q4 acceptance remain separate.

### Required implementation and independent acceptance evidence

Scope is the new dormant owner entry/runtime-pair module, narrow private SQL/borrow/
namespace/port role transitions, focused test support, exact architecture guards and
relevant documentation. S1/S2 logical contracts, old factories, application callers,
production authority/flags, SDK client creation/claims, identity admission, production
config mapping, Q3 source cleanup, installation-transfer format and all device/hosted/
release actions stay outside this slice.

Use real disposable SQLite with source-derived plugin preprocessing and explicitly
injected protected storage. Cover fresh empty/nonempty migration through genuine
handoff, cold bound with both sources throwing, copied/stale/cross-owner/reused tokens,
concurrent joins, interruption/cancellation at each preparation boundary, no half pair,
no second open/configure/acquire, and old migration controls after transfer. Exercise
mutable domain values without historical comparisons, reserved-key denial, actual
read failures, statement/COMMIT/rollback failures, lost after-state acknowledgements,
pending operations, stale result publication and failed close/release/tombstones.

Protected cases include current session updates, new flows outside M, raw escape/
Unicode/fractional-duration preservation, fixed and dynamic keys, absent session,
wrong config/epoch/header/slot, malformed old I, actual replacement loss, applied/lost
write/remove acknowledgement, failed/mismatching readback, false removal reports,
missing dependencies, reentrant/async/masked callback failures and no blind retries.
Prove healthy SQL remains usable after a credential fault, but not after genuine
pairing contradiction or disposal. No report exposes fixture raw credentials.

Run installed SDK PKCE store/remove/removeAll helpers through the ACTUAL new envelope
store via `createProviderCredentialStorage` and the existing settlement binding.
Cover normal call order, concurrency/lost index update and interruption after each
call without frozen-snapshot validation or repair. Include actual owned public
AuthClient initialization/read/refresh/verify/PKCE-exchange/sign-out compatibility
with all transport stubbed, auto refresh stopped and no test subscriptions. Preserve
causal denial versus successful refresh rotation followed by local storage failure;
fixed SDK settlement errors are not provider/network/identity verdicts. Observe all
whole public calls without installing a production rejection listener. This tests
the pair, not an implemented S5 SDK owner or application fault policy. Independent
design/code gates and the repository's full verification baseline remain required.


### S3g accepted implementation — bounded local evidence

The separate `createNativeCombinedRuntimeOwner` entry and private runtime module
implement this slice without changing the older factory's public shape. The two
actual resource drafts publish together; old migration controls become terminal.
Domain operations retain their generic key contract with the four reserved-prefix
exclusions. Current I envelopes are independently addressed and mutable, without
historical-M or quiescent-index requirements.

The runtime preserves three separate facts: attempted
work, acknowledged effects and verified results. Runtime health retains fixed
BEGIN/statement/COMMIT/ROLLBACK issuance and acknowledgement fields, actual control
read issuance, first unverified failure and terminal cleanup acknowledgements.
A queued call that never invokes native I/O records refusal without an issued
operation. A confirmed rollback remains distinguishable from issued COMMIT with
lost acknowledgement. Later refused calls do not erase the first unverified
transaction. These facts create no retry or readiness authority.

Pair disposal synchronously revokes both runtime lanes and the owner's authentic
F control, before waiting for pending work. Valid SQL cleanup requires each
actual close/release call's void acknowledgement, exactly undefined; malformed
fulfilled results cannot mint a receipt or clear uncertainty. Both logical
reservations remain until clean private receipts permit their joint retirement.

Directly observed malformed asynchronous dependency and settlement values are
owned after revocation, including an inner native Promise exposed by a fulfilled
async binding and Promise-valued required mutable dependencies. This is bounded
observation of actual boundary values, not traversal of arbitrary objects or a
guarantee about invisible provider background work/poisoned Promise species.
Thrown errors use private identity checks; no foreign prototype inspection.
The optional Runtime unavailable sentinel does not match undefined in older paths.

The implementation and positive real-SQLite/SDK regressions passed independent
CODE review on 2026-10-25. Malformed addressed SELECT responses are unavailable,
while genuine earlier schema/control contradictions remain positive faults. Required
fixed descriptor values are validated as they are read; malformed asynchronous
values are owned after revocation and no later foreign fields are read to rescue
unobserved work. Old factories retain their original behavior. Actual execution
counts and final verification status belong solely in
TESTFLIGHT_READINESS.md. Application/SDK/Identity admission, installation transfer,
Q3 retirement and physical/hosted/release acceptance remain separate work.

## S4a — Explicit pure installation archive v2 with deletion controls

Status (2026-10-25): independent DESIGN and CODE reviews passed. The explicit pure
v2 entries are implemented; actual final verification is recorded in TESTFLIGHT_READINESS.md.
Starting state: `main`, HEAD/local main/local origin-main reference
`382ee40d37605b302c11b6390305857c7e2c3fde`, zero staged files, 66 modified tracked
and 107 untracked files. Preserve the existing dirty tree. No Git mutation or release.

This is the next local prerequisite for preserving the existing installation, not
an operational export/import, backup or live Identity restoration. The user already
approved deletion guards and source preservation. No new product choice is needed.
The existing S2 v1 contract in MOBILE_APP_MIGRATION.md C1–C7 remains normative for
its original entry points and exact wire/byte goldens. The D migration continues
to copy deletion controls opaquely; it is not changed by this strict archive format.

### Scope and explicit entry points

Limit production changes to `installationTransferInventory.ts` and
`installationTransferCodec.ts`, with their existing tests and one new matching
`installationTransferV2.test.ts`. A closed internal version parameter may share
pure mechanics; no public extension/policy bag, callback classifier or caller
selected validation rules. A frozen fixed internal V2 helper set may be shared
with the codec; it is not a caller-provided policy. No new production module/importer
is needed. Update
the existing exact inert-graph test only if its explicitly audited pure imports
change. Do not modify Decision, S1, D/Q/M/I/F, native owners, app/SDK composition,
activation/default flags, source data or credentials. Documentation is limited to
this canonical section and reconciled migration/readiness/roadmap references.

Add exactly these explicit public entries alongside unchanged v1 entries:

- `planInstallationTransferInventoryV2(listingJson: unknown)` returns the existing
  closed `TransferResult<ReadPlan>`. Listing schema remains 1.
- `encodeInstallationTransferV2(snapshotJson: unknown, fingerprint: unknown)` returns
  the existing closed result containing canonical wire and package digest.
- `decodeInstallationTransferV2(wire: unknown, fingerprint: unknown)` returns the
  existing frozen `ValidatedPackage`, semanticStatus `not_evaluated`.

Snapshot schema is exactly 2 at the v2 encoder; other fields and source-observation
rules stay as C2. Envelope `formatVersion` is exactly 2, `fingerprintContract` is
`injected-256-v2`, provenance inventoryContract is exactly
`profile13-identity5-resolution-deletion-legacy-v2`. Other C3 fields/policies remain
unchanged. V1 does not accept v2, and v2 does not accept v1; unsupported envelope
versions return `unsupported_format` after bounded syntax admission. Snapshot
schema mismatch remains `invalid_envelope`. No fallback, coercion or default switch.

### Complete dynamic names, exact controls and no admission

V2 dynamicIdentity contains all physically listed members of three exact families:
the existing accessBarrierResolution plus
`curling.identity.accountDeletionGuard.<canonical Profile UUID>.v1` and
`curling.identity.accountDeletionGuardResolution.<canonical nonce UUID>.v1`.
Exact new descriptors are `identity-accountDeletionGuard-v1` and
`identity-accountDeletionGuardResolution-v1`. Both are `identity_archive` with
outer `profileId:null`. All dynamic members must be present items, sorted unique,
and counted together. Their IDs never create sporting Profile namespaces. Only
physically present sporting keys derive profiles; all original 13-slot coverage
rules remain. Guard-only, unresolved-guard and orphan-resolution-only sources with
zero sporting profiles are valid archive inputs. Unknown/future/malformed owned
names block the whole inventory before any value/fingerprint is requested.

The names plan enumerates only present dynamic keys. It never guesses a resolution
name from a Profile ID, synthesizes unlisted dynamic absences, or outputs a
resolved/canAdmit result. The guard nonce is known only after parsing its raw.
Later owners must independently prove any required actual absence and freshness.

Each new present raw must pass the shared bounded duplicate-free JSON scanner and
these exact closed forms before fingerprints:

- Guard: exactly `schemaVersion,profileId,nonce,revision`; schema 1; both UUIDs
  canonical and exactly 36 code units; profileId equals its key selector.
- Resolution: exactly `schemaVersion,profileId,nonce,fencedRevision`; schema 1;
  canonical exact UUIDs; nonce equals its key selector.
- Both revisions are safe integers in 0…2147483646, matching the actual
  `validDeletionRevision` contract in accountDeletionGuard.ts. Negative/fractional,
  unsafe, extra/unknown/duplicate fields and unsupported schemas refuse with
  `identity_archive_unsupported` (scanner limit excess remains `limit_exceeded`).

After all supported raws validate, correlate each guard only with the physically
present resolution addressed by its own nonce. If present, that resolution must
also match the guard profile and nonce and have `fencedRevision > revision`, or
refuse the package with `identity_archive_unsupported`. Old resolutions at different
nonces remain inert historical archives; no ordering across operations/profiles,
synthetic missing guard, garbage collection, repair or live-repository load.
Correlation does not grant access or port a resolution to a destination identity.

Mirror these small closed field rules in the pure inventory module and pin them
against the actual guard key/revision/repository behavior in tests. Do not import
or instantiate its repository in the production archive graph. Every accepted raw
remains codeunit-exact, including whitespace/escapes/order; never reserialize it.
Malformed identity data safely refuses a complete package and leaves source bytes
untouched; unlike D's opaque preservation, no malformed identity archive is promised.

### Budgets, fingerprints and failure ownership

All original finite limits and shared outer/inner work budgets remain. The 512
dynamic-member limit applies jointly to all three families, not per family.
Expected slots remain `13 * sportingProfiles + 6 + dynamicMembers`, max 1024.
Identity raw cap remains 65536 code units. Bind the scanner's raw classification
to the actual internal version before allocating its raw copy, even when raw
precedes key; do not first allocate a sporting-sized value for a new identity key.
Use the same admitted-string-only API, closed refusal vocabulary, deterministic
validation order, confidentiality exclusions and C4 asynchronous provider ownership.
No extra parsing of arbitrary dependency objects or global rejection listeners.

V2 uses value purpose `curling-transfer-value/v2` and package purpose
`curling-transfer-package/v2`, followed by NUL and unchanged C4 typed framing.
All metadata/raws/digests participate exactly as C4, with only root packageDigest
omitted once for the package preimage. Independent byte goldens must pin Unicode,
new metadata and domain separation, including empty archives. Both encoder and
decoder perform all bounded admission/correlation before any provider call.
The provider remains explicit and injected; no production crypto binding, S1 hash
reuse, delivery, encryption or authenticity claim is introduced.

### Acceptance and review gates

Cover v1 wire/goldens/refusal unchanged; both cross-version refusals; exact v2 wire
and preimages; raw preservation; mixed family inventory; guard-only, matching pair,
orphan and old nonce; key/payload mismatches, equal/lower fences and revision bounds;
duplicate/escaped field names, future/extra shapes and malformed JSON; omitted/extra/
absent dynamic items; unknown own controls/provider exclusions; combined dynamic,
raw and decoded budgets, raw-before-key and zero fingerprint calls after refusal.
Pin guard/revision semantics to the actual repository using injected storage only.
Retain hostile public-input/opaque-error and supported provider failure containment.
Prove no outside production callers, no storage/repository construction or app/SDK
effects, and unchanged Decision outputs with all issue/publish/mount flags false.

After DESIGN pass, implement and run focused v1/v2/guard/architecture/Decision tests,
then independent CODE review of the complete resulting bounded state. Finish the
repository workflow baseline: diff check, TypeScript, root/mobile lint and builds,
full root tests (S2 child scratch in `/tmp`) and full local browser suite. Report
actual file/test counts and scope limits in TESTFLIGHT_READINESS.md, then maintain
the separately authorized Vault progress entry. No source cleanup or physical/
hosted/Apple action is authorized by this pure slice.

## S3h — Dormant standard domain fingerprint binding

Status (2026-10-25): independent DESIGN and corrected CODE reviews passed.
The final full verification status is recorded in TESTFLIGHT_READINESS.md.
Starting Git state: `main`, HEAD/local main/local origin-main reference
`382ee40d37605b302c11b6390305857c7e2c3fde`, zero staged, 66 modified tracked and
108 untracked files. Preserve all existing work; no Git mutation or release.

This closes only the missing platform helper for D's existing injected
`NativeMigrationFingerprint = (exactRaw: string) => string | Promise<string>`.
No product choice, new data cap, protocol or storage authority is introduced.
Scope: one new `platformDomainFingerprint.ts`, its exact matching test and an
exact architecture guard. A baseline-only correction in nativeCombinedRuntime.test.ts
replaces its fixed 20ms wait with bounded polling for the actual F-COMMIT
acknowledgement followed by the same F-row assertion. This also prevents an
uncommitted same-connection SELECT from satisfying persistence. Production code
remains unchanged.
Reconcile references in the existing native migration,
ADR/readiness and roadmap documents without changing historical stage contracts.
All old factories/defaults/injections, D/Q/M/I/F/S1/S2 formats, native resources,
SDK/client/app call graphs, activation flags and source bytes remain unchanged.

Expose `createPlatformDomainFingerprint(digestOverride?: unknown)`, returning
exactly a frozen `{ok:true,value:{fingerprint,isWellFormedFingerprint}}` or frozen
`{ok:false,reason:"evidence_unavailable"}`. The optional digest is test injection
only, not a production fallback. No storage, SDK, source/target, timer, randomness,
configuration, environment or endpoint access/import. No production consumers.
Use structural function types with no runtime dependencies. Construction captures
the actual standard TextEncoder instance/encode method and WebCrypto subtle/digest
receiver/method once, using captured intrinsic invocation without reading supplied
operation bind/call/apply properties; no digest on import or construction. Missing, throwing or
noncallable operations refuse with the fixed failure, never a weak replacement.

Fingerprint accepts primitive strings only, with no coercion, JSON.parse or input
object inspection. Compute standard SHA-256 over UTF-8 of exact
`JSON.stringify(['domain-value/v1', exactRaw])`. JSON framing preserves lone UTF-16
surrogates and separates this from the S1 credential tuple and S2 typed preimages.
No trimming, normalization, key insertion or raw transformation. Do not introduce
S1/S2 value limits or an arbitrary new history cap. Platform resource failures
refuse and preserve source; no bounded-memory or physical-bridge guarantee is made.

Only an actual 32-byte ArrayBuffer result is accepted (including genuine cross-realm
buffers), checked with captured intrinsic byteLength and actual readable bytes;
views, spoofed objects, detached/wrong-sized buffers and other types fail. Emit 64
lowercase hex characters and expose an exact synchronous, noncoercing format
predicate. Every invocation failure throws only a new fixed safe Error
`Domain fingerprint unavailable`, without raw input, dependency reason or metadata.
A pending digest stays pending, with no retry, timeout success or fallback.

Observe ordinary native Promises, masked-own-then native Promises and conforming
thenables under the accepted C4 provider-return/derived-Promise ownership boundary.
Do not inspect thrown values, mutate provider objects or install global rejection
listeners. Poisoned constructors/species and invisible provider background work
retain their existing explicit exclusions; no unconditional hostile-return claim.

Tests must compare real standard WebCrypto to independent SHA-256 byte vectors,
including empty raw, quotes/backslashes/NUL/newlines, composed/decomposed Unicode,
astral characters and distinct lone surrogates. Pin exact tuple bytes/domain and
distinction from S1/S2, immutable returned shapes, receiver capture/no eager digest,
missing/throwing/spoofed dependencies, hostile primitive-admission inputs, exact
format validation, cross-realm/detached/wrong-sized results, supported async
success/rejection/throw/masked/pending cases and opaque-error privacy. Include a
large raw beyond S1's cap to prove no borrowed credential limit. Exercise the actual
`digestValue` normalization in tests to pin the unchanged injected D signature.

The architecture test scans src and mobile for every import/export/dynamic/require
form: only the new declaration may name its factory and no shipped importer may
reference the helper. It has no runtime imports or forbidden effects. Preserve
all existing pure S1 and dormant owner guards. After independent DESIGN/CODE gates,
run the workflow's full baseline and mobile checks; record exact results once in
TESTFLIGHT_READINESS.md and maintain the authorized Vault progress entry.

Provider config-ID assignment, exact configuration/URL-equivalence/key-rotation
semantics, registry-bound S3g composition, full SDK-call/send ownership, operational
transfer and Q3 retirement remain separate stages. This helper does not select
an operational contract for `injected-256-v2`, provide authenticity, prove native
roundtrip/durability or permit activation/installation/hosted/Apple actions.

## S3i — Dormant credential-source retirement before runtime handoff

Status (2026-10-25): independent DESIGN and CODE reviews passed after correction.
The bounded dormant implementation and final verification are recorded in
TESTFLIGHT_READINESS.md. Actual source-writer/SDK integration and device cutover
remain separate gates; no user credential was removed.
Starting Git: `main`, HEAD/local main/local origin-main reference
`382ee40d37605b302c11b6390305857c7e2c3fde`, 0 staged / 66 modified / 110 untracked.
Preserve existing changes. No Git mutation, actual-device or hosted action.

This implements only the already approved Q3 credential-copy policy in an explicit
dormant owner. No training/identity/domain raw is removed. No production caller,
SDK construction, source fallback, activation, installation or admission follows.
Q4 and the configuration-registry contract remain separate. No new product decision.

### Explicit private role and unchanged older entry points

Add `createNativeCombinedRetirementOwner(options)` alongside the two existing
factories. Its owner retains the existing migration/runtime methods and adds
`retire(candidate)`. Existing factories keep their exact public shapes, behavior,
source-free bound/Handoff checks and zero source removals. All source/protected/SQL
resources belong to the same genuine common owner; never accept supplied stores,
caller snapshots, `verified:true`, copied proof objects or a replacement receiver.
No already published mutable runtime pair may be borrowed back for retirement.

`retire` accepts only the current genuine completion candidate for this owner and
lifecycle. Invalid/copied/stale/cross-owner candidates refuse before I/O. Same-token
concurrent calls join one promise. Enter the private retirement role synchronously
before invoking any foreign operation; revoke prior retirement/normal permissions.
Migration, retirement, recovery, handoff and disposal mutually exclude one another.
Recovery/disposal cancel retirement synchronously, then await issued/observable work;
no old continuation can use a replacement control. No callbacks or caller consent
may stand in for genuine currentness.

The new factory's handoff requires a genuine current retirement/no-copy-needed
proof. The report itself is not that permission. After the last awaited preparation
and mutable dependency capture, perform an authentic synchronous fresh source-empty
fence and private lifecycle check immediately before the existing callback-free
joint runtime publication. An old successful report never authorizes later source
deletion or handoff. If the fence fails, abandon prepared drafts without publication
and leave resources under their existing owner. No second connection/configure or
protected acquire. Old factories and their source-free handoff stay unchanged.

### Current empty source versus destructive retirement

First freshly validate the ordinary current bound state through actual held
resources: supported SQL/schema marker, Dactive/Qbound with the same store identity,
no F/latch or unresolved SQL journal, correlated immutable M, complete known protected
namespace and valid addressed current I headers/forms. Preserve existing genuine
positive contradictions and uncertainty handling; no new target repairs.

Then inspect the actual credential source under a fresh complete names observation.
If its own-root credential namespace is currently empty, individually confirm all
four fixed logical-key absences and every original M-key absence as well. Unknown
owned controls, unsupported own-root names, inconsistent enumeration, unreadable or
unobserved results cannot establish emptiness. This can return `source_absent`
without a removal or historical M-value comparison: legitimate native runtime
mutations are allowed by ordinary bound validation. It says only that the old copy
is absent NOW, never who removed it or when. It grants no identity/runtime admission;
the later fresh publication fence remains mandatory. This handles a normal later
start after successful cleanup without introducing a durable retirement journal.

If ANY source credential is present, no removal is issued until the complete
original protected target has been freshly verified under the actual held leases:
exact M; every original M item individually present with matching physical slot,
I header/key and fingerprint equal M; originally absent fixed slots individually
absent; complete namespace with no extra items, configurations or epochs. Keep
actual raw values privately from those reads. A valid current mutable target that
differs from historical M is `target_not_original`, not an invented F. Missing or
unreadable original items cannot be inferred from namespace names. This stricter
test belongs only to the destructive retirement role, never normal B4/runtime.

The current source must be a raw subset of those verified originals: every present
credential key is in original M and its actual raw string equals its original
target raw. Positive absences are allowed. A partially cleaned source may have a
dangling old flow index; do not run today's quiescent-source capture/validateFrozenCopy,
reconstruct an original snapshot, rewrite the index or infer source values from M.
Full initial source subset admission precedes the first removal. New own-root names
or changed values stop retirement; foreign projects and all noncredential values
are untouched and never read as credential payloads.

### Actual source capability and per-removal synchronous boundary

Limit production changes to `localStorageAdapter.ts` and
`nativeCombinedMigrationOwner.ts`, plus their directly matching tests, one new
`nativeCredentialRetirement.test.ts` and exact architecture guards. A new private
source-role/control/proof registry may live inside the sole storage boundary.
Only the common owner may consume that internal capability. Do not expose a
generic removable adapter or broaden the old Combined-Source public facade.
No native/SQL schema, S1/Q/M/I/F/D serialization, protected-port semantics or SDK
module changes. Documentation is limited to the canonical and reconciled existing
migration/architecture/ADR/readiness/roadmap references.

Use the same original Combined-Source object. If it has already bound WebView
storage, retain that exact receiver; on a cold bound path bind it lazily once and
retain it thereafter, including across global replacement. Capture actual native
get/key/length operations and, only if removal is necessary, removeItem once from
that receiver. Invoke captured functions through intrinsic invocation, without
supplied bind/call/apply properties. Missing/noncallable removal blocks without
source mutation; an empty-source observation does not require reading removeItem.

Classify the full names list before source payload reads. Own-root names use the
actual S1 classifier and finite existing credential inventory bounds. The new
retirement-only complete enumeration admits at most 16,384 total names per pass;
larger/unsafe/inconsistent lengths refuse before index iteration. This is a bounded
metadata observation, not a retention limit: leave every source value untouched.
Do not change the older source enumerator or silently truncate the new one. Known domain
and identity names remain untouched. Unknown/malformed owned control namespaces
(`curling.identity.`, `curling.nativeMigration.`, `curling.credential.`,
`curling.installationTransfer.`) block, except exact registered eligible identity
names and the existing exact source-marker name. Unknown versions are not excluded
as foreign. Ordinary disposable caches, retired sporting raws and other projects
are not credential payloads. Read no noncredential raw, including control values.

For each original key, in deterministic original-M order, obtain fresh full source
names and actually reread the addressed raw. Positive absence skips that key, with
no removal claim. Exact matching present raw permits removal only after a private
callback-free currentness check. No await, digest, injected predicate, getter or
foreign callback may occur between that final addressed read/currentness check and
the captured removeItem invocation. A changed/new/unsupported source stops; no
blind retry. After actual void acknowledgement, separately reread and require
positive absence, with currentness checks around every foreign call. A throw,
nonvoid return, lost acknowledgement, failed reread or cancellation never becomes
verified merely because a later observation might show absence. Stop all later
removals, preserve target and all remaining source entries; never copy back or heal.

Own directly observed malformed asynchronous source returns under C4 after revoking
the role, and retain its in-flight ownership until observable settlement/drain.
Do not let recovery/disposal/new retirement race still-pending issued work. Pending
is real waiting, with no timeout-success or forced unlock. Never inspect thrown
values, traverse arbitrary objects, or add global rejection listeners. Invisible
provider work/poisoned Promise-species exclusions remain explicit.

Each own removal invalidates earlier source evidence. Later steps need fresh
observations. Completion re-enumerates and individually proves all required absences;
no source-empty success from an old snapshot, omission or read failure. A final
private empty proof may support only this lifecycle's guarded handoff. It expires
at source change, new retirement/recovery/disposal, loss of ownership or transfer.

### Interruption, reports and explicit limits

No new durable journal/cursor is introduced. A cold owner can validate Qbound/M and
the full original protected target afresh, then handle the actual remaining source
subset. Earlier source absence is only currently observed absence, never reconstructed
acknowledgement of a previous call. If a remaining source copy accompanies legitimate
native mutations, this conservative slice blocks cleanup without F; supporting that
case requires a separate durable retirement-proof contract. It must not be silently
implemented by weakening current evidence or adding Q v1 fields.

Reports are closed/frozen and contain only outcome (`retired`, `source_absent`,
`incomplete`, `refused`), a fixed failure category when needed, the current opaque
completion candidate on success, and bounded actual counts: removeIssued,
removeAcknowledged, removeVerified, observedAbsent. Counts reflect THIS attempt,
not assumed history. Retain first unverified removal evidence until the attempt
ends; later refusals do not rewrite it. Categories cover unavailable, source_changed,
unsupported_source, target_not_original, operation_unverified and cancelled; no raw
exception, key, value, credential/header/identifier or fingerprint in reports.
Incomplete cleanup cannot claim that the whole source survived or was erased.
Source failure alone is not a target fault or a sign-out/provider verdict.

Concrete report shape (all nested objects frozen; no extra fields):

```typescript
type RetirementCounts = {
  removeIssued: number;
  removeAcknowledged: number;
  removeVerified: number;
  observedAbsent: number;
  firstUnverified: null | {
    removeIssued: boolean;
    removeAcknowledged: boolean;
    absenceReadIssued: boolean;
    absenceReadAcknowledged: boolean;
    absenceVerified: false;
  };
};
type NativeCommonRetirementReport =
  | (RetirementCounts & { outcome: "retired" | "source_absent"; candidate: NativeCommonCompletionCandidate })
  | (RetirementCounts & { outcome: "incomplete"; code: "unavailable" | "source_changed" | "unsupported_source" | "target_not_original" | "operation_unverified" | "cancelled" })
  | (RetirementCounts & { outcome: "refused" });
```

`observedAbsent` counts distinct required source keys positively absent without an
issued removal of that key in THIS attempt; count each key once, including required
fixed keys. A later final absence fence does not double-count it. Issued/acknowledged/
verified removal counts reflect actual distinct keys and remain within existing
credential limits. `firstUnverified` records the first actual removal whose effect
could not be verified, including whether its follow-up read was issued/acknowledged;
other pre-removal failures leave it null. A refused call issues no work and returns
all zero counts and null firstUnverified. No report can be passed back as authority.

Same-context queues/leases protect only cooperating participants. Web Storage has
no compare-and-delete across other tabs/WebViews/processes. No global source-writer
exclusion or permanent absence is claimed; a complete SDK owner and operational
writer/context/device acceptance remain mandatory before actual cutover. A journal
alone would not solve that boundary. No actual user credential is removed in this
local development/testing slice.

Acceptance: genuine/stale/copied/concurrent candidates; fresh/empty/cold partial
sources and ordinary post-cleanup mutable restart; every interruption boundary;
dangling index; apply-then-throw/false/async/pending removal; failed/post-effect read;
source changes/new names/unknown controls; exact receiver and operation capture;
reentrant read/remove/callback cancellation; recovery/dispose/handoff races; malformed
dependency ownership; target unreadability, actual protocol contradictions and valid
mutable mismatch without F; source reappearance at each final publication boundary;
truthful per-attempt evidence and zero noncredential removal/read. Use actual real
disposable SQLite plus injected protected/WebView stores; preserve all older factory,
S3f/S3g/source-free/architecture regressions. Independent DESIGN/CODE gates and full
workflow/mobile/browser baseline remain required before recording acceptance.


## S3j — Dormant credential fingerprint invocation consistency

Status (2026-10-25): independent DESIGN and CODE PASS. The bounded correction is
implemented; final verification is recorded in TESTFLIGHT_READINESS.md.
Starting Git remains main / 382ee40d37605b302c11b6390305857c7e2c3fde,
0 staged / 66 modified / 111 untracked. Preserve all existing work.

Read-only preflight reproduced a real dependency-binding defect in the accepted
inactive platformCredentialFingerprint helper: an actual callable encode operation
with an own bind override can redirect the captured operation, causing SHA-256 of
the same fabricated bytes for distinct exact source raws. This is a dependency
invocation defect, not a cryptographic-algorithm change or production exploit claim.
Probe: /tmp/curling-s3i-preflight-credential-bind.test.ts and matching .log, 1 pass
that intentionally demonstrates the collision. No actual credentials.

Scope: platformCredentialFingerprint.ts and its exact matching test; reconciled
canonical/readiness references only. No new exports, callers, defaults, registry,
SDK/composition, storage/SQL/source protocol changes, activation or device actions.
Existing root/raw budgets, primitive admission, exact UTF-8 JSON tuple
['credential-value/v1',key,raw], SHA-256 lowercase64 encoding, result/failure shapes,
format predicate, synchronous constructor without eager hashing and C4 observable
async dependency contract remain byte-for-byte semantically unchanged.

Capture Reflect.apply once as a trusted intrinsic. Capture the actual encoder's
encode function and receiver once, then invoke that exact function/receiver through
the captured intrinsic. Similarly capture the actual subtle.digest function and
receiver once. Do not read or call supplied bind/call/apply properties. Test-only
explicit digestOverride remains supported and never enters production composition.
Use the same intrinsic invocation for the already captured native Promise.then and
ArrayBuffer.byteLength getter; do not replace their actual-brand checks or async
observation. No new Promise/species/hidden-work guarantees or rejection listeners.

Tests must independently compare Node SHA-256 of actual tuple bytes under actual
standard WebCrypto. Exercise actual callable encoder and digest operations with
own bind/call/apply getters that throw or return a redirecting callable; those
properties must never be read. Assert exact captured receiver, one getter capture,
no eager invocation, continued behavior after globals/operation fields are replaced,
unchanged invalid/noncallable construction outcomes and C4 regressions. Preserve
all existing exact raw/Unicode/surrogate/budget/buffer/input-negative tests.

Independent DESIGN and CODE review required. Focus both platform helper files,
credential contract/protocol/physical-slot/architecture regressions; final whole
root/mobile/build/browser baseline after code gate. No Git mutation or real-data
operation. This is a correction of a reproduced implementation defect, no product
choice or new residual-risk acceptance.

## S5a — Dormant complete native AUTH ownership

Status: independently DESIGN and corrected CODE accepted on 25 October 2026.
The final full local baseline passed; evidence is recorded in
TESTFLIGHT_READINESS.md. Dormant technical slice within the user's authorized local
completion work; no new product decision or app/device/release approval.
Starting main, HEAD/main/local origin-main 382ee40d37605b302c11b6390305857c7e2c3fde,
0 staged / 66 modified / 111 untracked. Preserve all existing work. S3i/S3j are
accepted and verified. No Git mutation, environment-file access, actual user
credentials, hosted/device/signing/installation/activation/distribution action.

### Scope and public surface

Implement one explicit dormant createNativeSupabaseAuthHost factory, in the existing
SDK integration boundary, with no production caller. Keep exactly the three current
SDK import files; do not patch/fork SDK, access private SDK members or accept an SDK
factory. The host constructs createNativeCombinedRetirementOwner itself, owns actual
run → retire → handoff, and retains pair, credential store and actual SDK privately.
No supplied/copied pair, store, report, callback-with-client or caller Boolean is an
authority. No raw SDK, session/token/credential, or generic callback runner escapes.

Adopted exact shape:
- async createNativeSupabaseAuthHost(options) -> frozen {ok:true,host} or fixed
  {ok:false,reason:'ownership_conflict'|'invalid_dependency'|'invalid_configuration'}.
- frozen host {start,auth,health,dispose}; auth is AuthProviderMechanics.
- start() joins the same genuine active start, reports only provider-mechanics
  availability: frozen {outcome:'ready'} | {outcome:'waiting',code:<closed category>}
  | {outcome:'closed'}. Waiting codes are 'busy', 'migration_blocked',
  'migration_incomplete', 'migration_fault', 'recovery_required',
  'retirement_incomplete', 'handoff_refused', 'credential_failed', 'sdk_failed',
  'restart_required'. No identity/admission/readiness token or raw owner report.
- health() is closed/frozen local ownership/phase, actual storage/SDK failure and
  cleanup facts, with no identifiers, key/URL/header/raw messages or credentials.
  Phase: 'reserved'|'preparing'|'ready'|'waiting'|'closing'|'closed'; closed wait code
  or null; storageFailed/sdkFailed/cleanupUnconfirmed Booleans; actual safe
  NativeRuntimeHealth or null, containing only existing fixed evidence fields.
- dispose() is idempotent, joined, synchronously revoking, with actual cleanup
  receipts; returns {ok:true} or {ok:false,reason:'evidence_held'|'cleanup_unconfirmed'}.

Allowed production scope: supabaseClient.ts for an opaque native SDK reservation;
supabaseAuthService.ts for the actual SDK/normalization host; a narrow SDK-free
nativeSupabaseAuthHost helper only if necessary for ownership mechanics, plus their
exact tests/architecture guards and reconciled existing docs. Do not alter native
SQL schemas, D/Q/M/I/F, S1/S2, S3i/source/remove contracts, existing browser defaults,
identity/training UI, cloud data services/transport or activation composition.

### Reservation and immutable configuration

Reserve genuine opaque same-context SDK ownership synchronously before any foreign
option capture or S3i work. Refuse if cached browser SDK or legacy credential/health
claim already exists, or another native reservation is held. While held, ordinary
getSupabaseBrowserClient must not construct/fall back, and claimBrowserAuthStorage
must refuse with its existing closed conflict shape. No reservation means old exact
browser behavior. A reentrant lookup/claim cannot create a second SDK/source writer.
Only this actual host may release its reservation after real drain+cleanup. Unknown
cleanup or evidence-held source/protocol work retains it; no reset/force unlock.

Factory takes explicit exact ConfiguredCloudConfig plus existing native migration
options (preassigned config ID/root and actual dependencies). Capture once, validate
primitive/config/limit/function inputs before migration. Require the configured
strings already equal explicit resolveCloudConfig(url,key)'s resolved strings; no
new normalization, URL-equivalence or rotation policy. Require the actual existing
providerSessionStorageKey(config.url) exactly equal the explicit migration root.
A preassigned ID-to-exact-config assignment remains a caller/composition precondition;
no real assignment, API-key/hash identity or production registry is invented.
Refuse URL userinfo/query/fragment as unsupported in this native entry; leave Web
resolution unchanged. Mirror installed SupabaseClient's actual base trailing-slash
and new URL('auth/v1',baseUrl) derivation, root and initial apikey/Authorization
headers; tests compare actual installed createClient. No second naive url concatenation.

No SDK/storage I/O at factory construction (the reservation is a private in-memory cell). Invalid directly observed async
configuration/dependency values revoke first and stay owned through C4 drain before
reservation release. Capture no input getters after revocation. Never inspect thrown
reasons. Pending factory dependencies remain pending; no forced unlock.

### Start, same resources and lifecycle

start is a genuine private role entered before foreign work, mutually excluding auth,
disposal and another start. Use only internally created genuine S3i ownership. A
partial migration/retirement reports waiting and retains the same owner/reservation;
a later explicit start continues it. If actual owner recovery is required, the next
explicit start may invoke that owner's real recover before rechecking, never create
a replacement behind it or erase faults. No SDK exists before actual retirement
handoff. The same-context SDK seam retains a private constructed-root tombstone:
there is at most one native SDK construction per root in this WebView lifetime.
After clean disposal a repeated native construction returns restart_required without
constructing; full context restart is needed. This avoids the installed SDK's monotonic
instance-count duplicate warning/trace even after a clean predecessor; never reset
SDK private counters or monkeypatch console. Browser behavior remains unchanged. Missing/failed retirement never falls back to old source/client.

After the actual pair handoff, create the actual provider-storage integration and
settlement adapter over those exact credentials and their actual health. No second
native connection/configure/acquire. Keep raw pair/credentials private. A cold bound
restart with source absent follows S3i's current mutable-target branch.

Construct standalone public AuthClient using the pinned real SDK, explicit storage
and root, persistSession:true, skipAutoInitialize:true, autoRefreshToken:false,
BROWSER_AUTH_OPTIONS PKCE/detectSessionInUrl/appendPkceFlowId flags. Immediately own
and await public dispose() on that newly lazy client to close constructor BC before
storage work. Then own public initialize() and always await public stopAutoRefresh()
in finally, including initialization failure. No SDK onAuthStateChange subscription,
startAutoRefresh, raw-token setter, generic refreshSession or raw SDK escape.

Start ready means initialized mechanics with actual healthy paired/credential/
settlement state, never signed-in or application admission. An init failure cannot
be changed to ready by events or a later stale result. No unsafe reinitialization or
new SDK behind unknown construction/cleanup. Actual transient/waiting behavior must
retain the same genuine resources and truthful sticky failure.

Dispose closes new command/SEND/storage rights synchronously and immediately starts
actual pair cleanup (or common owner cancellation if no pair exists), before waiting
for start/command/provider/retry work. Retain and join that genuine cleanup receipt;
a pair published immediately before the parent handoff await is retained and cleaned
as the actual transferred owner. Drain the full actual factory/start/command/provider/
retry and auxiliary work and public SDK cleanup before releasing the reservation.
Set the joined disposal promise before cancellation can reenter. Failed initial SDK
cleanup remains sticky even if a later cleanup call returns normally. SDK dispose alone does not abort
fetch or late storage writes. The SDK's public completion is an API receipt only. Its visibility-removal helper
internally catches DOM removal exceptions; do not claim independently verified
physical listener removal from its void return. Trusted platform/SDK behavior and
normal listener-count tests bound this local evidence. Independently, every late
callback has no host SEND/storage/publication rights after revocation. A failed
actual SDK call or pair cleanup retains the reservation; no timeout-success, compensation, source fallback or forced release.

### Whole mechanics FIFO and shared normalization

Own the WHOLE asynchronous AuthProviderMechanics command: argument/claim callbacks,
public SDK call, normalization and final private currentness/health publication.
Use one FIFO, capture invocation/lifecycle identity and generation privately. Queued
commands invalidated before entry do no storage/SDK/SEND work. Actual pending calls
stay pending and owned. All public async auth outcomes remain closed/nonthrowing. Normalized observer
objects and nested identities are detached and frozen. After all synchronous
observer callbacks, recheck private currentness/health before returning any result.

Reuse/extract the current supabaseAuthService's one Session/Identity/error/URL/selector
normalization path; no second identity authority. Outside explicit native host,
createSupabaseAuthService and browser client behavior/public shapes remain unchanged.
Native observer subscription uses local NORMALIZED observations only; never calls
SDK onAuthStateChange. Do not await foreign listeners within FIFO. Contain throws
and directly observed async listener failures without a global rejection handler;
reentrant commands queue normally. Deliver only current observations after command
completion. Events grant no application access or reset an identity barrier.

Restore uses getSession, not refreshSession. OTP, verify, explicit local sign-out,
Google preparation and explicit correlated exchange retain existing provider-neutral
outcomes. Invalid OTP/PKCE code alone is not a denial of an existing session. Read a
claimed code once; recheck private currentness after that callback before SDK work.
All actual PKCE slot/index/legacy writes must be verified before SEND or prepared
navigation output; partial storage failure cannot produce a usable URL or request.

Synchronous navigateToAuthorizationUrl cannot wait in FIFO. It refuses while any
start/command is active/queued, or health/currentness is invalid. Reuse current strict
URL/flow validation; after all argument/origin/dependency capture, a private fence
immediately precedes the captured navigation operation. Native navigation/origin
capabilities are explicit; without them Google operations fail closed and OTP remains
usable. No default native redirect/origin or external-browser activation is invented.

Explicit sign-out advances the private INTENT fence synchronously before queueing.
Older queued work does no SDK/storage/SEND work; every older active command loses
ALL publication and any new AUTH SEND/retry immediately. Supersession is NOT fed
into physical credential health or the permanently latched settlement adapter.
The already-entered actual command retains only a private DRAIN-ONLY storage permit
until its whole actual SDK call settles, including already started rotation save or
SDK cleanup. It may finish those actual storage continuations under the same genuine
pair, but no extra old-command SEND or output. This is bounded by that command's
actual completion, not a timer or supplied flag. Once it drains, the latest current
sign-out enters FIFO, reads the actual latest protected session and performs its own
cleanup. A newer sign-out/intent may obsolete it in the same way. No settlement
reset, manufactured void/absence or healthy-fault reclassification. Real storage
failures stay sticky and may prevent sign-out. Dispose differs: terminally close all
NEW storage delegations, await already-issued work and refuse all late publication.

Provider-mechanics success never resolves a durable Identity barrier. A later
intentional sign-in may run only with actual healthy storage and grants no old
training continuation or barrier resolution. Sign-out intent and its actual cleanup
outcome remain separate; failure retains genuine first-unverified health.

### Actual health, causality and AUTH SEND

Consult the actual pair health, provider integration's sticky failure and settlement
latch before SDK work, after callbacks and before any result/observation/SEND. The
fixed AuthRetryableFetchError is a private settlement signal, never a network/absence/
provider-denial claim. Source/storage failure alone never becomes F or sign-out.
Preserve same-generation genuine provider denial even if SDK cleanup masks it; a
successful rotation followed by local write failure is credential failure, not denial.

Private pinned causal observation: use the actual public AuthClient debug option,
not a transport status parser, provider Boolean, private SDK field or monkeypatch.
The callback is synchronous, contained and has no output, storage/SDK calls or raw
retention. Ignore its prefix and all unrelated arguments without reading their
properties, serializing or forwarding them. In an authentic current restore command
which owns exactly one getSession(), the exact installed argument form
args[0]='#_callRefreshToken()', args[1]='error', args[2]=actual SDK error may call
THE SAME existing typed classifier. Check private currentness/generation before AND
after that classifier (its predicates may run a foreign getter/Proxy). Retain only a
closed refresh-rejected fact for that command and credential generation. Never revoke
cleanup/storage rights or emit a denial from this observation alone. Exact labels,
SDK version 2.112.3 and ordering are explicit compatibility/upgrade gates; missing
observation never proves no denial.

Keep a healthy normalized actual getSession(session,error:null) result unchanged even
when a refresh-rejected fact exists. A result lost through cleanup storage failure
becomes invalid_session only with a prior genuine typed definitive-refresh fact and
one of these private same-command/current-generation context proofs:
(a) a subsequent exact SDK '#_removeSession()' observation, before any intervening
root mutation or different command. This proves only the SDK reached its removal
DECISION; it never proves removal acknowledgement or local sign-out success;
(b) the last positive actual SDK root read was the S3g-valid exact-generation value,
its privately parsed expires_at is a finite number, there has been no issued root
mutation/rotation/unknown effect or positively observed root replacement, and the
captured actual clock proves the SDK catch branch's REAL expiry predicate false:
not (expires_at is truthy AND expires_at*1000 > actual Date.now()). No margin/new
lifetime/cutoff, injected expiry authority, extra native/source read or raw report.
The context is taken only from the actual already-issued bound integration read.
Root mutations invalidate that context BEFORE issuance; after proof (a), its own
cleanup may retain the established denial fact while recording real mutation health.
A newer root write/rotation clears the fact; intent/lifecycle invalidation suppresses
all publication. Unproved/unknown/still-valid context is unavailable/indeterminate,
with the private refresh-rejected/credential-fault observations retained and no
admission. Invalid OTP/PKCE never establishes denial of an existing session.

Tests must include real SDK proactive-preserve, expired denial masked by read/remove
failure, missing/unknown/replaced context, rotation/write fault, unrelated removal,
classifying getter reentrancy and same-generation invalidation. The private callback
itself has no output; do not claim every SDK/global failure is silent. Test that no
credential/fixture payload leaks in the exercised SDK paths; do not suppress console.

Initialization-time user recovery is also covered. In the isolated authentic INIT
command (only actual initialize()), record a positive S3g-valid current SDK-root read
and the exact same-generation actual GET /user SEND with its completed host-owned
response. With no intervening root mutation/replacement/other SDK command, a
subsequent exact '#_removeSession()' is the installed SDK's _getUser
isAuthSessionMissingError decision. Invalid-root normalization occurs before GET
and cannot satisfy this proof. Record a fixed init-session-missing fact BEFORE
cleanup. It survives its own cleanup mutations and remains invalid_session on the
next current restore, including clean cleanup followed by actual null. It is not a
removal ACK. A new successful root write/rotation or lifecycle/intent change revokes
old publication as appropriate. Other GET /user API errors without that proven
removal path never become this denial. If ANY correlation fact is missing, absence
is not established: report conservative unavailable, never healthy no_session.
No HTTP status/code/body parser is copied and no user data is fabricated.

Capture the actual AUTH transport once, bind/invoke intrinsically, and own directly
observed promise/thenable results under C4. Every actual call, including each SDK
retry, must materialize method/URL/headers/body/dependencies FIRST, then perform a
private callback-free current command/lifecycle/generation/reservation/health fence
immediately before the captured transport. Foreign transport rejections are reduced to a fixed
safe SDK error without reading the reason. Brand-check actual Response using captured
native prototype getters and body reader via intrinsic apply; capture actual status,
status text and header entries, await actual body completion, and construct a FRESH
private native Response for the SDK. Do not hand an injected Response/facade's own
ok/status/headers/get/json getters to the SDK; any can throw a forged SDK typed error.
No copied HTTP-auth parser: SDK alone parses/classifies the fresh response. Materialize
with captured constructors/methods, own malformed/pending output under C4, contain
body/constructor errors without raw reasons, and fence result currentness. No later retry or response/result after
closure may gain authority. Preserve issued work until actual drain.

Confine requests to the exact resolved auth base and the pinned public-method route/
method/query set (otp, verify, refresh/pkce token, local logout and actual user recovery).
No arbitrary URL, redirect following, cookies or fallback target. Native actual sends
use credentials:'omit', redirect:'error'. Capture actual Request/transport operations
before final fence; no awaited or foreign materialization follows it. Intrinsic
Request clone and captured native URL/method getters brand-check constructor and
clone results before reading fields; plausible properties on a pending Promise or
facade grant no SEND. Directly observed malformed async values remain owned through
drain. A bounded prototype walk supports actual Request subclasses. Keep SDK bodies
and headers private; no message/body/token/URL/raw exception in diagnostics.

### Required evidence and explicit remaining gates

Use real disposable SQLite + injected protected/WebView stores and actual installed
public AuthClient with all transport stubbed; no fake SDK constructor or live account.
Prove genuine internal resources, no pre-handoff SDK storage, same connection/config,
cold mutable restart, actual retirement and no legacy fallback. Old browser paths,
source-free owners, architecture/default flags remain regression-covered.

Adversarial matrix: preexisting/reentrant client/claim; clean same-context restart
refusal and no second construction; malformed and pending captures;
start joins and partial restarts; constructor BC closure and browser visibility cleanup;
whole-command overlaps/PKCE index preservation; init/read/write/remove/cleanup errors;
masked/rejected/pending async work; exact raw compatibility; causal denial with cleanup
failure, rotation with write failure, invalid OTP/PKCE and same-generation fences;
successful init user recovery, other API error without removal, init session_missing
with clean/failed cleanup, foreign response/transport reason getters, generation
change and rotation-before-signout with successful latest cleanup;
reentrant origin/code/argument/listener callbacks; signout/dispose during transport,
storage and retry; no late actual SEND/output; actual cleanup tombstones and reservation
retention. Prove normalized outputs only and no private fixture value in logs/reports. Public-SDK preflight evidence is
/tmp/curling-native-auth-host-preflight.log (2),
/tmp/curling-native-auth-causal-debug-corrected.log (5), and
/tmp/curling-native-auth-causal-context.log (3); these are compatibility probes,
not host implementation acceptance.

Independent DESIGN and CODE gates plus root/mobile/browser/build/type/lint/diff checks
are mandatory. Preserve pre-existing code; leave all unstaged/uncommitted. Record
actual evidence in TESTFLIGHT_READINESS and canonical progress in the existing Vault.

This implements no app mount, Identity/admitted-training exception, data-only SDK,
cloud/Team final-send grant, actual configuration assignment/rotation, operational
installation transfer, external writer exclusion, Q4 or physical/release acceptance.
The data SDK eagerly requests accessToken on construction and has separate awaited
request/retry paths; do not claim existing authorizedFetch is secured by this host.

## S5b — Dormant native Identity bootstrap host

Status: independently DESIGN and corrected CODE accepted on 25 October 2026.
The controlled final baseline is recorded once in TESTFLIGHT_READINESS.md. This is local completion within the user's
existing authorization, not a new product decision. Starting main, HEAD/local main/
local origin-main 382ee40d37605b302c11b6390305857c7e2c3fde, 0 staged / 67 modified /
112 untracked individual files. Preserve all work; no Git mutation, environment-file
inspection, actual account/Keychain, activation, device/signing/hosted/distribution.

### Adopted boundary after design acceptance

Add one explicit dormant createNativeIdentityBootstrapHost factory, with the same
captured migration/config/fetch inputs as S5a and explicit callback URL access. It
internally creates the genuine S5a resources through one shared private builder,
never by accepting a host, pair, store, client, result or supplied readiness Boolean.
Preserve createNativeSupabaseAuthHost's exact public shape/defaults/behavior.

The frozen result is {ok:true,host} or the same closed construction failure categories
as S5a. Frozen host exposes only start, health, dispose. start joins the genuine start
and returns {outcome:'ready',runtime:IdentityRuntimeReady}, a closed S5a waiting
result (plus 'identity_failed' for this new entry's failed runtime dependencies), or
{outcome:'closed'}. Repeated ready calls retain the same runtime. Health extends
S5a's closed actual ownership facts only with identityFailed:Boolean; cleanup retains
S5a's actual receipts, not a second resource set. A malformed URL/clock/ID/runtime
dependency is not mislabeled as a physical credential fault or provider denial.
Ready means available mechanics and a real coordinator, never a Profile/training
admission. No public raw AuthProviderMechanics, IdentityService, SDK, pair, adapter,
repository, session/token, arbitrary RPC or generic callback runner in this new host.

Internally construct the actual IdentityTransitionCoordinator and the complete six
Identity repositories, including deletion guards, on exactly the retained pair.domain.
Use the existing runtime facade/capture/normalization behavior where compatible; do
not duplicate identity authority or bind default singletons, legacy claims, a second
SQL connection or a separate protected store. The new entry has no application caller.
Capture explicit callbackUrlAccess.readCurrentUrl/replaceCurrentUrl functions and
their receiver once without invoking them at construction; no implicit window URL
fallback. Callback/deep-link intake uses this same access, preserves unrelated fields,
captures durable intent before cleaning its Team parameters, and keeps existing once
semantics. Missing native delivery is not replaced by invented callback data. The
actual coordinator's ID/clock/origin dependencies use the same captured sources;
directly observed malformed async returns set identityFailed and stay held through
drain. Construct the real callback capture cell internally, never accept a supplied
cell/claim as an admission proof.

Use the installed official public PostgrestClient 2.112.3 for exactly the existing
four IdentityService RPCs. Promote that exact installed package to a direct dependency
without upgrading packages. Its constructor has no Auth/Realtime/BC task; do not
construct a whole SupabaseClient for native data access. Keep imports in an existing
SDK infrastructure file and enforce the new package boundary structurally. Narrow
createSupabaseIdentityService's input to Pick<SupabaseClient,'rpc'>, preserving its
existing mapper, validation, errors and Web behavior. No copied HTTP/RPC parser,
private SDK fields, patch/fork, monkeypatch, fake SDK or constructor injection.

Allowed production scope: supabaseAuthService.ts/shared private host builder;
supabaseClient.ts for the public PostgREST construction boundary if needed;
supabaseIdentityService.ts's narrow port; identityTransitionCoordinator.ts for actual
operation binding and native admission veto; identityRuntime.ts only for reuse of its
existing facade with internally constructed dependencies; exact architecture guards,
focused tests, package.json/package-lock.json and reconciled existing docs. Do not
alter native schemas/protocols/S3i, default flags, UI or existing cloud/Team consumers.

### Four roles and original operation ownership

get_current_legal_documents is a public anon+authenticated Legal read. It must work
before sign-in; no Profile or bearer requirement may create a circular gate. The
other three fixed RPCs (ensure_my_profile, get_my_gate_state,
complete_personal_onboarding) require the genuine current provider account, not an
already admitted Profile. Existing legal evidence and completion-first rules remain
binding. These operations themselves grant no Team, sporting, Personal or app access.

The actual coordinator must bind native Auth/Identity calls to the ORIGINAL private
operation and epoch, and bind authenticated Self-RPCs to the actual expected account
already obtained by that operation. After a Profile is established, preserve the
existing same-Profile correlation. Bind before asynchronous work can lose ownership;
never rebase old work by reading the newest generation when a later service call
finally begins. Public TransitionIdentity/outcome objects and copied tuples prove
nothing. A native binding hook may receive only the actual coordinator's privately
created currentness closure, and must be assembled internally by this host. It is
not a caller-supplied Boolean, latest-state reader or independently mintable grant.
The precise internal port must preserve this provenance and be tested adversarially.

The private currentness closure is synchronous, storage-free and bound to genuine
ownsOperation plus the original live epoch under the host's actual generation
counter. Recheck it after foreign materialization/callbacks and immediately before
each actual AUTH/data SEND and publication. A newer transition invalidates old work
when it claims ownership, even before its barrier write completes. Legal refresh
continues not to supersede an in-flight sign-in; it has its own host lifecycle/intent
and command binding, not a new access-transition claim. Existing Web behavior without
the native binding remains unchanged.

### Whole command, account and transport

Auth and bootstrap data share the actual S5a FIFO and terminal/intent/resource
ownership. One data command owns input capture, actual provider session read and
existing normalization, any rotation/settlement, fixed RPC, actual builder/retry,
response mapping and final publication. Never await an enqueued public restore from
inside that FIFO. Use one actual internal public SDK getSession for authenticated
Self work; share existing normalization and S5a's causal denial proof, including init
denial, expired/proactive refresh, cleanup masking and sticky credential faults.
Do not add a second session read merely to obtain a bearer. The private bearer comes
only from that actual result after genuine identity/account/currentness validation;
it belongs to that command/generation and is cleared when the command ends or loses
ownership. Rotation before the data send rebinds only that same still-current command.
No new AUTH/data SEND or usable result follows sign-out/dispose/supersession.

Coordinator live epoch and SDK credential/root generation are separate private
mechanisms. Only that coordinator operation's own barrier/rebase steps update its
context; a legitimate token rotation updates only the still-current SDK command's
credential generation. Neither can revive an obsolete operation in the other lane.

The Self session preflight has a private causal-result channel to the ACTUAL owning
coordinator context. That channel retains only the existing normalized restore fact
and expected account, never raw session/token, and is minted/connected internally
with the original operation binding. If its actual getSession establishes current
invalid_session, healthy no_session after a previously authenticated account, or an
unexpected authenticated account mismatch, issue no Self-RPC. Record that genuine
same-command/current-context fact before returning a conservative normal service
failure. After the service await, the actual coordinator consumes it BEFORE ordinary
RPC error handling and native admission veto, and follows the corresponding existing
invalid-session/no-session/Case-B path. Preserve already-established denial despite a
later credential cleanup fault; do not fabricate RPC forbidden/profile_required or
silently discard proof as unexpected_error. Unknown/storage/network-only outcomes
establish no denial. The callback stores normalized evidence only; it performs no
SDK/storage call, awaited invalidation or UI delivery inside the command FIFO. A
superseded context cannot publish/consume a denial against the newer operation;
already-begun real invalidation retains the existing completion/report obligations.

Keep confirmed provider denial distinct from credential/network/unconfirmed failure.
Only genuinely causal current denial may enter an existing definitive deny path;
storage fault, missing bearer or uncertainty must not fabricate forbidden, absent
session, successful sign-out or an HTTP success. Actual server mutation completion
may be unknown after a lost response; no rollback/unchanged claim or auto-compensation.

Derive the exact REST base with the installed SDK's trailing-slash/new URL semantics.
Allow only public-schema POST /rpc/<one of the four exact names>, no query, and the
existing parameters. No arbitrary schema/relation/RPC/method, Realtime, storage or
functions client, URL override, redirect, cookie or fallback. Keep bearer/key/body
and foreign thrown reasons private. For Self calls, the captured private command
must also retain the expected account at final SEND and after actual response.

Reuse S5a's intrinsic native Request brand checks, captured actual transport,
fresh native Response/body completion and C4 ownership. Materialize Request, body,
headers and all foreign dependencies FIRST; then a private callback-free original
operation/account/generation/intent/reservation/actual-health fence immediately
precedes the actual captured transport. Apply it to every actual retry; the four
current POST RPCs must not be made retryable mutations by this integration. Native
sends use credentials:'omit', redirect:'error'. SDK alone parses the fresh response;
the existing Identity mapper alone interprets RPC data/errors. No raw transport
facade or thrown-reason getter reaches those classifiers.

### Native admission, runtime and closing

The current coordinator may turn temporarily_unavailable plus a correlated trusted
record into ready_offline. For this native host, actual protocol/domain/credential/
SDK/cleanup health must veto EVERY new ready_online and ready_offline path. Check
before required trusted establishment, after relevant progress/foreign callbacks,
and immediately before ready publication. This veto is actual private pair/SDK
state, not a supplied healthy flag; it creates no invented provider denial. Genuine
network-only offline policy with healthy native storage remains unchanged. The
native startup cannot honor a credential fault as an offline eligibility fact.

The host owns the actual complete runtime facade, coordinator operations, capture
cell and subscriptions. Returned normalized results/observations have no mutable
aliases into host authority. Runtime calls after terminal close perform no new
URL/storage/SDK/SEND work and return the existing method's truthful closed outcome;
do not manufacture successful capture, durable denial/removal, state save or ready.
No new runtime reason/union is introduced merely to encode host closure. Already
issued whole coordinator operations remain tracked through their real completion.
startUpOnce retains ONE actual underlying startup execution across lifecycle replay,
not an unconditional reuse of an
already fulfilled public ready promise. Every public completion and later replay
checks both terminal ownership and the genuine original startup operation/epoch.
A newer foreground transition, sign-out or epoch change vetoes stale readiness without
rerunning startup, borrowing the latest generation or closing an otherwise usable host. A replay after closure returns the genuine
terminal outcome even when that underlying startup previously completed ready;
it does not rerun startup. Previously delivered facts are not retroactively changed.
Any annotated terminal result must carry the actual coordinator's own terminal
transition, minted synchronously by its genuine private close/revocation closure;
never fabricate a successful transition or borrow a matching public report. Keep
that closure inside the internally assembled host, outside the public coordinator.

Dispose synchronously revokes runtime/coordinator bindings and subscriptions and
immediately starts genuine current-owner cancellation as in S5a; it must not wait
behind whole-operation drain before cancelling. Join actual start, coordinator,
command, callback/body/retry/auxiliary work and genuine cleanup receipts before
release. Reentrant dispose joins one promise; a late pair/runtime loses publication
and is actually cleaned. C4 includes directly observed malformed callback URL/clock/
ID/native-binding returns and required header callback primitives/acknowledgements.
Own both a malformed callback field and an independently returned malformed
acknowledgement even if the provider swallowed the callback refusal; revoke before
assimilation, preserve pending drain,
inspect no thrown reason and add no global rejection handler or forced unlock.
The exact genuine host-disposal Promise is already owned and cannot become its own
drain prerequisite; unknown wrapped Promise dependency graphs remain C4 prerequisites.

### Required evidence and remaining stages

Use actual installed AuthClient/PostgrestClient and real disposable SQLite with
injected WebView/protected stores and stubbed transport. Prove full actual startup
Legal → OTP request/verify → fresh Profile → Legal/onboarding → required trusted
record → ready, with all records on the same retained SQL connection. Preserve the
real unresolved barrier, resolution, intent and deletion-guard negative paths.

Adversarial matrix includes anonymous Legal; exact four route/body/header forms;
all supported base-URL forms; original old operation delayed until a new account/
transition exists; old queued Auth/Identity work; no token/invalid result; actual
rotation/write fault and causal denial; initial session-missing cleanup; health
failure before every ready path, including correlated offline startup and progress
callback reentrancy; successful healthy network-only offline policy; profile/account
disagreement; malformed/pending getters and async capture; sign-out/dispose during
RPC/request materialization/response body/mapping; no retry of mutation, no late
SEND/ready; truthful unknown mutation/cleanup; all runtime methods after closure;
one startup across replay and retained reservation on incomplete cleanup.

Independent DESIGN gate before implementation and CODE gate after corrections.
Then root tests (max four workers), Web/Mobile builds and tests, full official local
Playwright suite, final TypeScript after its dev server stops, both ESLint scripts
and diff checking. Preserve the accepted S5a and existing browser regressions.
Record evidence once in TESTFLIGHT_READINESS and update existing Vault progress.

Reconcile ADR-0025 §20/G and ADR-0049 with the narrow dormant native infrastructure
bearer exception before CODE acceptance: only this private host reads the current
actual SDK result for its fixed configured-provider Self-RPCs; Legal remains public.
No domain/UI/service caller receives the bearer. authorizedFetch's existing single
Team/asset helper/importer and Web/native API-target rules remain unchanged. Exact
architecture guards must confine both the new SDK package and this bearer operation
to that existing native infrastructure file, with hostile import/alias/escape cases.

This slice mounts nothing. Account-deletion RPCs, Team/HTTP/restricted assets,
sporting sync, the actual already-admitted Q1 training tuple and continuation,
native callback delivery, actual config assignment/rotation, operational protected
installation transfer, external writer exclusion and physical/release acceptance
remain separate stages. The existing browser-client consumers must all be replaced
coherently before any native mount; never relax S5a reservation into legacy fallback.
Q4 remains unapproved/deferred. No billing or tariff change is authorized or needed.

Independent preflight: /tmp/curling-independent-review/s5b-postgrest-preflight.log
(two actual public-SDK probes) and s5b-postgrest-types.log (narrow RPC port compiles).
Those probes establish compatibility only, not implementation or DESIGN acceptance.

## S5c — Dormant native sporting Identity host

Status: independently DESIGN and corrected CODE accepted on 25 October 2026.
Actual final verification is recorded once in TESTFLIGHT_READINESS.md. Starting main/HEAD/local-main/origin-main
382ee40d37605b302c11b6390305857c7e2c3fde; 0 staged /70 modified /113 untracked individual
files. Preserve every prior change. The user's existing local implementation and
single independent reviewer authorization applies; no new product decision is needed.
Free pilot/no billing remains unchanged; personal sporting data does not mean the
commercial Personal subscription. No Git mutation, environment inspection, actual
account/Keychain, app mount/activation, device/signing/hosted/distribution action.

### Exact dormant API and scope

Add createNativeSportingIdentityHost(options), sharing the actual private S5a/S5b
builder and resources, never accepting an existing host, pair, SDK, service, store,
repository, grant or ready report. Options are the same captured
NativeIdentityBootstrapHostOptions. Frozen result/host/failure categories and the
three host methods remain analogous to S5b, but ready contains the new exact runtime
subtype NativeSportingIdentityRuntimeReady extending IdentityRuntimeReady with:

- createSportingCloudService(profileId:string): CloudSportingService|null;
- subscribeToIdentityInvalidations(listener:(outcome:InvalidationOutcome)=>void):()=>void.

Preserve S5a and S5b API/default behavior and Web defaults. Add no production caller.
The factory returns a frozen typed CloudSportingService only when the requested
canonical Profile selects an already genuine, current, healthy internal admission.
Otherwise return null. The argument is a selector, never proof. A service captures
that exact admission at construction, not whichever admission exists when a later
method is called. It never rebinds, including after same-Profile reauthentication.
No raw SDK/pair/token/repository, generic RPC/client/callback runner, caller-supplied
readiness Boolean or independently mintable Profile capability escapes.

Allowed production scope: supabaseAuthService.ts shared private builder and new exact
host/runtime subtype; actual identityTransitionCoordinator.ts internal admission and
conditional invalidation; supabaseSportingCloudService.ts's narrow RPC input type;
necessary exact architecture guards, focused tests and reconciled existing docs.
Use the already installed public PostgREST client, actual AuthClient and existing
pair; no dependency upgrades, new schema/protocol or second connection/store. Do not
change IdentityProvider, ProfileScopedSportingPersistence, Team/HTTP/assets, current
sync policy, native composition defaults or operational migration in this slice.

### Genuine admission and stable facts

Only the actual coordinator may mint an admission, at its four final foreground/
startup ready paths, after the actual required trusted-state/intent/deletion-guard,
original-operation/epoch and native-health checks. The fifth ready site, successful
background revalidation, may only confirm the existing matching admission. It must
not create one when none exists, replace its identity or revive a revoked service.
The private admission binds actual accountScopeId, Profile, stable
onboardingCompletedAt, its own independent admission generation and the live epoch.
The stable completion fact matters: existing Case B rejects its change too.

New foreground operation, actual definitive-denial threshold and terminal close
revoke the prior admission synchronously before foreign work. A background operation
claim alone does not revoke it. Healthy or transient background work and a skipped
metadata refresh preserve the existing matching admission; no new authority follows
from a public resolved/ready report. Genuine denial revokes before durable awaits,
even if durable cleanup later fails. Native health separately vetoes sporting use;
currentness for an already established actual denial must not disappear merely
because credential cleanup failed. Independent coordinator admission generation and
SDK credential generation remain distinct; rotation of the same current account
cannot rebase an obsolete admission.

Do not mint from caller Profile/GateSession, stored row alone, copied tuple,
mechanical host ready, auth SDK event or fulfilled startup replay. Offline admission
retains the existing healthy correlated policy; cloud commands still require actual
current provider identity. This is not the Q1 already-admitted training exception.

### Synchronous per-call capture and whole sporting command

Keep the existing CloudSportingService contract and mapper semantics: restore, put,
delete. Narrow only the mapper's client parameter to Pick<SupabaseClient,'rpc'>.
The mapper remains the sole parser/error interpreter. SyncManager still owns outbox,
conflicts, digest comparison and local restore application. Cloud SHA-256 hashes the
unchanged payload bytes; the framed D fingerprint is not a substitute.

At each service method entry, synchronously capture its bound admission and exact
declared scalar inputs before waiting on any FIFO or provider work. Put captures
recordKind, recordId, schemaVersion, payload and recordedAt; delete captures kind/id/
contentSha256. Validate existing scalar contracts without inventing new payload byte
limits or rewriting values. Own getters/Promise/masked malformed values in a private
per-call capture/drain scope. Capture checks the exact original admission before and after every foreign getter
and materialization boundary. Revocation stops all subsequent capture work while
retaining the actual work already returned by the cancelling getter. Cancellation
during capture returns unavailable; an already completed malformed capture retains
invalid_input if later disposal occurs during its drain. Capture must stop at the
first invalid required value;
it must not consult global active or poison an unrelated SDK command already running.
Syntactically malformed input yields the existing invalid_input outcome; unavailable
admission/health/currentness yields unavailable, never fabricated forbidden/absence.
Pending observed capture work stays owned until settlement/disposal. A malformed
Profile selector cannot mint a service and is similarly held without poisoning an
unrelated command. Preserve the exact known-disposal self-dependency exception.

One actual shared FIFO command owns validated input, actual internal getSession and
existing normalization/causal proof, its exact token/account, the existing Self-gate
mapper, one sporting RPC, actual body/response completion, mapping and publication.
Do not await an enqueued public restore/Identity method recursively. One actual
getSession supplies the private bearer; no second token read or alternate parser.
The Self preflight must confirm the same account, Profile, stable completion fact
and existing eligibility. Malformed/unconfirmed/network facts prove no denial.
Actual invalid/no-session, current account mismatch, validated incomplete/mismatched
Self facts or genuine Self forbidden/profile_required use the private denial channel
below. No sporting mutation follows an unconfirmed Self gate.

Only these additional fixed public-schema POST RPCs are allowed:
get_my_sporting_records with {}; put_my_sporting_record with p_record_kind,
p_record_id, p_schema_version, p_payload, p_recorded_at; delete_my_sporting_record
with p_record_kind, p_record_id, p_expected_content_sha256. Use the same private
configured REST base and corrected S5b Request/Response ownership. Bind expected
route/method/query/body/headers/options from the original captured command, validate
the final actual Request after its last constructor and completed body, then the
callback-free original admission/account/generation/intent/reservation/health fence
immediately precedes each actual SEND. No arbitrary relation/schema/RPC, redirect,
cookie, retryable mutation or private SDK field. The Self gate and sporting RPC are
two server requests, not an atomic snapshot; existing sporting SQL independently
rederives its own authority. Lost mutation response means unknown completion, not
rollback or unchanged state. Ordinary sporting RPC forbidden remains its existing
service error; it is not an identity-wide denial by itself.

### Authentic conditional invalidation and completion notification

A command may privately retain only actual normalized current Session/Self negative
facts, tied to its genuine original admission. After the entire SDK command releases
the FIFO, invoke an authentic coordinator-created conditional invalidator bound to
that same admission. Atomically in the synchronous local sense, prove the actual
admission generation/epoch and claim a real coordinator operation before denial
begins. Do not derive authority from an Accountstring or a matching public outcome.
No nested FIFO invalidation or caller-supplied 'allow/revoke' flag. Preserve existing
Case-B barred-account semantics for an unexpected actual authenticated account.
An overtaken admission cannot deny a newer one. Once actual denial crosses its
existing in-memory threshold, the existing unconditional durable completion/report
obligation survives supersession or cleanup failure.

The actual full normalized InvalidationOutcome, including genuine transition,
residue/denial and cleanup failure, is delivered through the narrow runtime
subscription and remains owned through settlement. A CloudSportingResult.unavailable
or a progress phase does not replace it. Listener results are detached/frozen and
C4-owned; terminal close clears listeners and forbids late delivery. Preserve already
begun denial completion truth internally even if no subscriber remains. Ordinary
caller/service input cannot manufacture a notification. No UI consumer is mounted by
this slice; eventual application composition must connect this actual completion.

All sporting/capture/invalidation/subscription work is tracked by genuine host
closing; cancellation is immediate before drain. Retain actual independent pending,
rejected and masked values/acknowledgements. Do not inspect thrown reasons or unknown
Promise dependency graphs, add global handlers/timeouts or force ownership release.
Frozen normalized service outputs must have no aliases into host authority.

### Required independent evidence and later gates

Require independent DESIGN before implementation, then independent CODE after
corrections. Actual installed SDKs, real disposable SQLite, synthetic protected/
WebView stores and simulated transport only. Prove fresh OTP/onboarding and cold
trusted admission; forged ready/tuple/Profile reports refuse; construction-bound
service loses authority on new foreground/sign-out/account/Profile/completion change
and cannot revive after same-Profile login. Prove background continuity, no remint,
actual native health veto, no cloud before genuine admission, exact synchronous input
capture despite queue delay and reentrancy, and no poisoning of another active command.

Exercise actual session/rotation faults, cleanup-masked established denial, Self
mismatch vs malformed response, ordinary sporting forbidden, exact three RPCs/bodies,
all final Request/Header/Response/C4 paths, lost mutation response without retry,
late supersession/close and pending disposal. Observe actual full invalidation
outcome, including durable failure and new-operation races; no FIFO deadlock or
invented denial. Include the real SyncManager with an old bound service to prove it
cannot upload its outbox under a later admission; this focused test does not claim
that local sporting repositories are already composed on the native pair.

Run focused host/S5a/S5b/coordinator/sporting/architecture tests, then the agreed
full root max-four-worker, Web/mobile build/test, 139-case local browser suite,
post-server TypeScript, both ESLint and diff baseline. Record actual evidence once
in TESTFLIGHT_READINESS and saved Vault progress, never plans as passed evidence.
Reconcile ADR-0025 §20/G and ADR-0049's narrow private infrastructure bearer scope
for these three exact sporting RPCs before CODE acceptance. Preserve Web and the
single authorizedFetch Team/asset helper/importer and native API-target rules.

Account-deletion continuation, Team/TeamExercise/HTTP/restricted assets, actual local
sporting composition, Q1 original training/save admission, application callback
intake/mount, actual configuration assignment/rotation, protected operational source
installation preservation, external-writer exclusion and physical/release acceptance
remain separate. Q4 stays unapproved/deferred. This grants no beta activation or
publication and changes no Free/Personal/Team product rule.

## S5d — Dormant native account deletion and export

Status: independently DESIGN and corrected CODE accepted on 25 October 2026.
Actual final baseline and evidence are recorded once in TESTFLIGHT_READINESS.md.
The bounded tree remains main/HEAD/local-main/origin-main
382ee40d37605b302c11b6390305857c7e2c3fde, 0 staged /71 modified /116 untracked individual
files. Existing user local implementation and single read-only reviewer authorization
applies. No product choice, actual account/Keychain, env inspection, app/default
activation, config assignment, device/signing/install, hosted/distribution or Q4
approval. All prior work remains unstaged/uncommitted, with no Git mutation.

### Exact API and ownership

The existing dormant createNativeSportingIdentityHost ready runtime now requires
accountDeletion:AccountDeletionService (optional on the base IdentityRuntimeReady).
There is no fourth host/factory or app caller. S5a/S5b/Web defaults, sporting grants,
delete/export product rules and mapper/repository policy are unchanged. No raw
SDK/store/token, generic runner, public receipt or caller readiness flag escapes.

Allowed production is the private native builder, actual coordinator's private
control/factual/continuation facts, policy-neutral mapper ports/bookkeeping, actual
guard repository over the same pair.domain, architecture guards and docs/tests.
No UI, SQL/schema/protocol, Team/HTTP/asset, original training/Q1, config/rotation,
local sporting composition, installation transfer or release change belongs here.

The actual deletion mapper remains sole parser and owner of revision/guard ordering,
request exclusion, recovery, cancellation and export validation. Its minimal RPC-only
port returns PromiseLike<{data:unknown,error:unknown}>; explicit unknown narrowing
never fabricates a full SDK builder. Per-call mapper instances close over exact
original ports and share only one private runtime requestClaims Set. Omission
preserves Web's existing new Set. Optional onCancelPending receives the actual
mapper-validated pending fact BEFORE expected request-ID comparison and guard I/O;
even a wrong ID cannot preserve an old admission. Existing cancel policy is unchanged.

### Original operation, actual subject and purpose-specific evidence

Only the actual coordinator supplies a private control-scope factory. A call captures
its real owning sequence/live epoch synchronously without claiming a new operation.
New operation (including background), epoch change or close retires that exact scope;
there is no latest-generation fallback. Actual internal SDK restoration binds the
account once. Every later stage restores that same actual account, not a later user.

Request/export additionally require a genuine original admitted Profile and matching
complete Self facts. Blocked state/cancel instead obtains its linked Profile through
the existing mapper-validated deletion control after actual authenticated Self.
Ordinary current_profile_id excludes pending deletion, so recovery never requires
the complete ordinary gate. Each typed RPC uses one real internal getSession and
its actual bearer; the narrow first-account binder reuses the existing normalization
and causal proof without a second read/copied parser. Export's final accountId and
profile.id must equal the original actual subject, not merely caller selectors.

A request cannot reuse its revoked ordinary admission after its own actual denial.
Carry the exact liveGeneration.bump RETURN through private BarrierEstablished and
InvalidationRun. Only actual begun residue-free identity_invalidated completion can
supply an effect receipt, bound to its genuine own operation and installed epoch.
Request also needs original admitted subject, actual unresolved guard nonce/revision
and actual beforeMutation path. Public outcomes, Boolean ACKs, caller strings or a
sampled newest epoch supply none of these facts.

Genuine current completed denial may be reused for blocked recovery only. Cache its
actual residue-free outcome, resolved account, operation identity, own barrier ID
and bump-return epoch. Reuse requires matching authenticated subject, original scope,
sequence/epoch/terminal currency. It emits no new progress, transition or barrier and
cannot mint admission. Pending, failed or superseded denial is not reusable.

Preserve fresh OTP correlation while the account is pending. Null admission alone
proves no settled block: a foreground operation could still become Ready. The actual
coordinator creates a private non-admitting witness ONLY in completionOutcomeFor's
FINAL actual identity_unconfirmed return, with nativeCurrent(context), authenticated
account, sequence and context epoch. Its three call sites perform no later awaited
readiness work. New operation/admission clears it. observePending may use only that
matching witness for guard/recovery work, with outcome:null rather than an invented
InvalidationOutcome or request receipt. Otherwise it begins real conditional denial.
An active actual denial conservatively refuses further control effects while its
existing owner completes/reports. A paused potentially-Ready foreground therefore
receives genuine revocation and cannot later grant Ready during unanswered guard I/O.

Track the exact still-owning native denial context/subject and its actual own barrier
ID even before write acknowledgement. Own-save notifications do not synthesize a
guard-derived epoch bump or misclassify that own barrier. Still read actual barriers;
different/malformed barriers retain existing handling. An older denial that lost
ownership suppresses nothing. Failed acknowledgement grants no effect receipt.

### Callback attribution, facts and refusal

Invoke captured beforeMutation in one private synchronous stack phase. Only a direct
call of the actual runtime invalidator in that phase is attributed to the genuine
original request; repeated calls share its one actual flight. Restore prior phase in
finally for reentrancy. Outside the phase normal public invalidation is unchanged;
a call made only after an async yield supplies no request receipt. Request SEND
requires callback true AND actual non-null successful own denial and all final fences.

An overtaken conditional attribution that never began returns an explicitly owned
rejection. It bypasses the ordinary public fallback, since manufacturing a denial
marker would block a newer owner. Genuine begun outcomes still complete and report.
The narrow private refusal changes no ordinary public/Web invalidation contract.
Validate the actual settled callback value before continuation. A directly observed
malformed native/masked/rejected value remains owned with zero permission, including
the exact known-disposal exception. No arbitrary payload graph or thrown reason is
inspected and no unrelated active command/storage health is poisoned.

Always pass a private onPending wrapper to the actual mapper, even without a caller
observer. Forward only a detached frozen fact under the bounded phase. Attribute a
direct actual invalidation if the observer starts one; otherwise immediately obtain
native pending control after return/throw. Optional callbacks cannot supply or replace
native authority. False/malformed ACKs may retire observation under the existing
service contract; eventual Promise values never grant effects. An observer starting
a newer operation cannot use an old pending fact to deny that newer subject.

Factual publication and effect permission are separate. The actual begun-denial
publicationCurrent proof binds genuine own operation and its installed bump-return
epoch, or original pre-write context epoch if no successful bump occurred. Residue
forbids all subsequent guard/RPC/admission/request effects without erasing a current
positive pending result. Only the exact private pending object actually delivered
by the mapper, under that genuine factual proof, may be published after failure.
Detached observer copies cannot manufacture it. Supersession, epoch change and close
still forbid stale publication. Non-factual results also require healthy lifecycle.
Full genuine denial/residue uses the existing native completion subscription.

### Real I/O, SDK FIFO and disposal

Run each typed outer mapper operation outside the SDK FIFO and track it through host
close. Its private per-call RPC port serializes each fixed actual RPC as one whole
SDK/session/body/mapping command. No SDK reservation spans foreign callbacks, so a
callback awaiting another native method cannot recursively deadlock the lane;
supersession instead refuses the old request. Fixed RPCs are
get_my_account_deletion_control, abort_my_uncommitted_account_deletion,
request_my_account_deletion, cancel_my_account_deletion and get_my_account_export,
with existing exact arguments/order. Capture scalar selectors/callbacks before waits;
request subject/revision/nonce comes from the actual guarded repository. Reuse final
actual Request/header/body/Response ownership and last callback-free SEND fences.
Lost mutation response is uncertain completion, never automatic retry/rollback.

Construct the real guard repository over a private per-operation pair.domain adapter.
Before EVERY actual get/set, including internal begin/resolve reads/writes, await its
own attributed completion if any, prove original scope or own effect receipt and
healthy lifecycle, and recheck after settlement. Method-level wrappers alone are
insufficient. Cancellation issues no later I/O; already-issued I/O stays owned and
is not assumed rolled back or allowed to resolve a newer nonce. Real mapper nonce/
revision policy and runtime-wide request exclusion are retained.

Freeze/detach normalized results and observer facts including exports. Dispose joins
outer mapper, actual SDK/adapter I/O, observed callback/notification work; cancellation
is immediate before drain. Exact own disposal is already owned and cannot depend on
itself. Existing C4 unknown wrapped/internal dependency-graph limits remain; no forced
release, timeout escape or global handler. No successful result renews admission.

### Evidence and remaining gates

Independent CODE acceptance follows actual installed SDK/disposable real SQLite and
synthetic protected stores/transport tests, actual Provider beforeMutation/onPending
callbacks, fresh OTP pending -> cancel -> normal explicit retry, exact RPC/order/body,
shared requests, unanswered/failed guards, real older-denial epoch races, own/external
barriers, paused potentially-Ready foreground, supersession/close, rejected/masked
settled callback values, failed-denial facts, frozen exports and genuine full outcomes.
Actual counts and full root max-four-worker/Web/mobile/browser/post-server types/
lints/diff evidence live in TESTFLIGHT_READINESS, with saved Vault progress.

Provider callback tests use a render-only Flow wrapper; they do not establish mounted
native Flow polling/reload. Application composition must connect real full invalidation
completion and verify that effect/recovery behavior. Team/TeamExercise/HTTP/assets,
local sporting/Q1 composition, app/callback intake, actual config binding/rotation,
protected operational installation transfer/external-writer exclusion, and physical/
hosted/Apple acceptance remain separate. Q4 is unapproved/deferred. Free pilot/no
billing and Team separate from Personal remain unchanged. No activation/release.


## S5e — Dormant native Team-exercise data

Status: independently DESIGN and CODE accepted on 25 October 2026, including the
public retry option and per-command client refinement. Actual final evidence is
recorded once in TESTFLIGHT_READINESS.md.
S5d remains independently accepted. No new product choice, activation, app caller, config
assignment, actual credentials/Keychain, device/hosted/Git action. Ordinary Team
workspace/HTTP/email/restricted asset integration remains separate after this slice.

Exact bounded API: extend the existing dormant native sporting runtime
with createTeamExerciseCloudService(profileId:string):TeamExerciseCloudService|null.
Same actual private pair/SDK/coordinator. Reuse the exact genuine construction-bound
Profile admission, healthy Self preflight and post-FIFO actual conditional denial
from S5c. Selector never grants; services never rebind/revive. No public generic
runner/client/token/store or grant. Actual existing mapper remains sole parser;
change only its client to Pick<SupabaseClient,'from'|'rpc'>. Instantiate one real
public PostgrestClient privately per admitted Team-exercise command, after actual
Self preflight, with a fetch closure bound to that immutable original command/plan.
Use public retry:false for this new native transport only: installed default GET
retries would otherwise introduce later attempts/timers. No timeout wrapper, fake
builder, private SDK fields or copied SDK. The constructor creates no second AUTH
client/storage authority or eager request. Recheck ownership after constructor
callbacks and before mapper work. Existing Identity/sporting/deletion/Web clients
are unchanged.

Nine existing methods in scope: listMyResults, listActiveRecordingPermissions,
putSession, putAthleteBundle, setRecordingPermission, approveSession, setPrivateNote,
reviseMyResult, voidMyResult. No TeamService/AuthorizedTeamRequest/asset/API origin,
UI, SQL/schema, outbox policy, payload bytes/hash, local repository or Q1 changes.

Key new boundary: listMyResults issues SEVEN actual public SDK GETs concurrently.
A single mutable c.rpc/body cannot describe them. Build a closed immutable expected
request plan from the genuine typed method and its synchronous captured arguments
before queue wait. Match and consume each request against a specific expected
method/path/query/body intent at private SDK fetch ingress BEFORE any foreign
Request constructor. Each request closure retains its original command; a late callback never looks
up a replacement global active command. Retain that exact local immutable intent through body/header/
response handling; no other parallel request may replace it. Validate the FINAL
actual Request after its last constructor and body completion against that original
plan, then same callback-free original admission/account/generation/intent/health
SEND fence. Do not derive authority solely from the SDK's latest constructed URL.

Plans use the existing actual mapper wire contract exactly:
- listMyResults: GET team_exercise_result_bundles (exact selected columns and
recorded_at.desc); team_exercise_sessions; team_exercise_session_participants;
team_exercise_execution_refs; team_exercise_result_refs; team_exercise_private_notes;
team_exercise_result_revisions (exact selected columns and revision_number.asc).
Exact relation/select/order/filter and query cardinality: no duplicate parameters,
extra filters, schema substitution or range. Only literal existing selects.
- listActiveRecordingPermissions: GET team_exercise_recording_permissions, exact
athlete_profile_id/granted_at select, team_id=eq.originalTeamId, revoked_at=is.null.
- Seven fixed POST RPCs: put_team_exercise_session; put_team_exercise_result_bundle;
set_my_team_exercise_recording_permission; approve_my_team_exercise_session;
set_my_team_exercise_private_note; revise_my_team_exercise_result;
void_my_team_exercise_result, with exact existing p_* arguments from owned input.
POST requires Content-Profile:public and JSON; GET requires Accept-Profile:public,
empty body and exact query semantics. Both exact API key/private actual bearer,
credentials omit, redirect error. Preserve S5a/b/c/d AUTH/Identity/RPC behavior.
Expected header/body handling must reflect installed public SDK output, not a
copied private builder implementation. No dependency changes.

Whole command: one actual native SDK FIFO reservation owns actual getSession and
normalization/causal proof, same actual Self gate, all method requests, actual
transport/body completion, actual mapper result and final publication. Do not
recursively await public enqueue methods. Refactor a private admitted-operation
helper if useful, but keep it inaccessible outside the one infrastructure owner.
Ordinary Team-exercise forbidden/not_found/blocked is per-method outcome; only
actual Self/session negative triggers real Identity-wide denial after FIFO release.
Server still independently revalidates athlete/Team permissions; a selector or
client offline snapshot supplies no authority. Lost mutations are never retried.

Register each issued request before any foreign callback; seal unused intents as
soon as the method settles and seal the entire closure at command retirement.
Track every actual issued ownedFetch request (including body/response/observed
acknowledgements) in its genuine command. If an aggregate mapper rejects/returns
early, drain all actually issued sibling requests before releasing command/SDK or
storage. Cancellation immediately vetoes new SEND/publication, preserves work already
observed, and host dispose joins it all. No force release/timeouts/global handlers.
Unknown invisible SDK/internal/wrapped Promise dependency graphs remain existing
C4 prerequisites; do not claim arbitrary graph ownership. No private builder fields.

Synchronous input capture before FIFO: declared scalars and declared string arrays
from TeamExercise types only, per-call isolation. Record fields are exact existing
session/bundle/revision shapes; timestamps/IDs/schema version/bools/null notes and
opaque payload/reason strings retain original values. Read validated array length and own indexed elements only, never caller iterators
or array methods; holes are malformed even when a prototype supplies a valid ID.
Check original admission before/after the foreign own-membership descriptor trap. Clone participant/training/
execution/result ID arrays and changedFields arrays without aliases. Do not trim,
rewrite/hash opaque payloads, create byte/count limits or copy server Team policy.
Capture checks original admission before/after each foreign getter/array element/
materialization, stops after first malformed/revoked value, owns observed native/
masked/rejected work, retains exact own-disposal exception, never poisons another
active command. Local malformed input -> existing invalid_input; unavailable bound
admission/health -> unavailable. Scalars/array length/elements never become proof.

All normalized results detached/deeply frozen. Preserve actual mapper field/error/
privacy semantics, raw payload SHA-256 and existing SyncManager ownership. Actual
SyncManager Team-exercise integration test must show an old bound service cannot
upload pending Team results under a later same-Profile admission. This does not
claim application native local repository composition or Team UI activation.

Both independent DESIGN and CODE gates passed. Actual installed SDK+disposable real
SQLite, injected synthetic stores/transports only. Exercise all nine methods/exact
requests and existing mapper outcomes; all seven GETs genuinely overlap; own one
pending sibling after another fails; getter/constructor/body supersession/close;
header/schema/query/filter/body retargeting; poisoned active-command isolation;
actual Self denial/full residue; ordinary Team failure; original arrays mutated
during queue wait; no old facade/outbox revival; no retry after unknown mutation;
masked/rejected/own-disposal ACK drains. Include S5a/b/c/d/architecture/actual mapper/
manager regressions and normal full root/Web/mobile/browser/types/lints baseline.

Next Team foundation + email/API/restricted assets remain explicitly unfinished.
This is a technical dependency slice, not Team beta completion or activation.

ADR-0025/0049 and architecture guards narrowly permit exactly the eight relations
and seven RPCs here. Manager-side payload/hash/ownership checks remain unchanged.
The independent installed-SDK preflight passed three probes, including actual seven
concurrent reads, default eighth retry and retry:false with no retry timer.
Evidence: /tmp/curling-independent-review/s5e-sdk-preflight.log.


## S5f — Dormant native Team foundation and own API

Status: independently DESIGN and CODE accepted on 25 October 2026 after callback
capture, root-classification and reflected-work ownership corrections. Actual final
evidence is recorded once in TESTFLIGHT_READINESS.md. S5e remains accepted.
Starting main/HEAD/local-main/origin-main 382ee40d37605b302c11b6390305857c7e2c3fde;
0 staged /72 modified /117 untracked individual files. Existing local implementation
and single read-only reviewer authorization applies. No Git mutation.

No app mount,
new product choice, actual config assignment/account/Keychain, native default,
device/install/signing, hosted/distribution or Git mutation. Existing approvals for
local implementation/single independent reviewer apply. Free pilot/no billing,
Team separate from Personal, Q3 approved/Q4 deferred unchanged.

Exact existing dormant runtime extension createTeamService(profileId):TeamService|null.
Same private pair, actual AUTH SDK, FIFO, genuine permanently construction-bound
Profile/completion admission, actual Self preflight, full conditional denial after
FIFO and detached immutable normalized outputs. Caller selectors grant nothing;
old services never revive on later same-Profile login. Background continuity never
mints admission. No raw client/bearer/store/generic query or public grant escapes.
Actual SupabaseTeamService remains sole Team mapper and server/RLS remains authority;
policy-neutral port changes from full SupabaseClient to Pick<'from'|'rpc'>, plus
optional narrow dependent-fact observations at the actual mapper points below.
Existing Web factory/client/helper behavior and errors stay unchanged.

Use existing TeamResult kinds only: missing bound admission/configuration is a
closed safe forbidden result, malformed declared input is invalid_input, unexpected
mapper failure uses the existing fixed unexpected_error; no new unavailable kind.
Actual server/mapper domain and honest network outcomes stay unchanged.

All existing 29 typed methods are in scope, including five own-API mutations that
send email; no RestrictedAssetResolver (dormant future-only boundary under ADR-0044), UI,
local training/Q1, storage schema/format/outbox/protocol or operational transfer.
Inputs synchronously capture declared original scalars/records/indexed own arrays
(name/email/raw invitation token, IDs, bools, direct functions/proposed functions),
without caller iterators/array methods or getters after malformed/revoked values.
Own directly observed pending/rejected/masked work and exact disposal exception;
per-call malformed capture never poisons another active SDK command. Preserve exact
opaque bytes/no invented business/size policy. Server performs actual Team rules.

One whole SDK command per method owns getSession, actual matching complete Self,
all mapper-generated dependent selects/RPCs/HTTP and body parsing/mapper completion.
Private per-command actual public PostgrestClient retry:false with immutable original
command closure, issued work registered before callbacks, seal+drain before FIFO
release. Reuse S5e exact materialized Request/body/header/SEND/Response ownership.
No late request consults global replacement active command. No mutation retry.
Lost response preserves honest uncertainty; server-created Team/email is not rolled
back or resent automatically because local follow-up reads failed.

Team methods have dependent query graphs: listMyTeams first get_my_profile, then
own active memberships; getTeamWorkspace reads original Team, actual own Profile,
active memberships, optionally server-admin emails, then those roster Profile IDs;
createTeam gets an actual server-created Team ID before that same workspace graph.
Use a closed per-method plan/state machine. Predeclared original intents include
all static selects/order/filters/header/cardinality and fixed RPC bodies. Only a
specific actual matching response may establish dependent identifiers (canonical
created Team ID; exact current roster Profile-ID list). Do not copy the mapper parser into transport. Add optional purpose-specific hooks
after actual getMyProfile mapping (actual Profile ID), after actual createTeam mapping
(actual created Team ID), and immediately before the existing roster profiles query
(actual Team ID plus indexed original roster Profile-ID array). Web omits hooks.
Only the private native command consumes them, validates canonical IDs/currentness,
clones the exact indexed IDs and adds the one closed dependent intent. Profile must
match original admitted Profile; a canonical different actual Self Profile causes
genuine conditional denial after FIFO, while malformed facts simply refuse. Hooks
never supply admin/RLS/business authority and do not change ordinary mapper error,
privacy or lifecycle policy. Actual mapper remains sole parser; the server independently authorizes. These hooks must themselves be independently DESIGN reviewed.
No caller/global/URL/response-location retarget can establish a dependent fact. Reject malformed facts/extra queries/filter/schema/range/
duplicates; no generic from/query/RPC grant. Actual parsed get_my_profile must equal
the original admitted Profile before any derived own filter; mismatch cannot grant.

Exact mapper graph navigation: supabaseTeamService.ts getMyProfile RPC;
hasPilotTeamCreationCapability RPC; listMyTeams own memberships nested teams/functions;
createTeam fixed RPC -> workspace; workspace teams eq id maybeSingle, get_my_profile,
team_memberships eq team+active nested functions, optional get_team_member_emails,
profiles select id/display_name in actual roster IDs. Other fixed RPCs rename_team,
archive_team,restore_team,set_participation,assign_direct_function,
remove_direct_function,remove_admin_function,relinquish_own_admin,leave_team,
revoke_invitation,preview_invitation,accept_invitation,list_admin_requests_for_team,
revoke_admin_request,accept_admin_request,acknowledge_notification. Static reads:
team_invitations exact explicit column list eq teamId (NO token_hash),
team_admin_requests existing nested-team/member select then actual ownProfile,
account_notifications select* unread+created_at.desc. The actual source is authority
for exact argument names/query ordering; no target can be learned from constructor.

Five HTTP mutations must use actual native configured HTTPS API origin, never WebView,
Supabase-derived/deep-link/response-supplied/caller-selected target. Resolve build-time
native origin once inside trusted native host construction using the existing pure
validator; test with synthetic stubbed config only. Missing/invalid origin denies
HTTP before ANY SDK session/transport read, while unrelated REST operations remain
available. No actual origin value assigned/real env inspected in this slice.
Extract/reuse the existing closed pure TeamApiRoute path resolution as needed, without
importing/calling browser authorizedFetch or reading another session. Existing sole
browser helper/importer remains. Native infrastructure reuses only actual c.bearer
from that method's restored session and actual matching Self. Exact POST URL/body,
Content-Type+Authorization only, credentials omit, redirect error, no query/fragment.
The native authorized callback independently captures only the original method's
required route/body fields, under that same command's admission before and after
each foreign read. Compare them with the privately captured original selectors,
scalars and indexed own functions, then serialize only a detached plain snapshot.
Root eligibility is independently restricted to the actual mapper's plain records
(Object.prototype/null, no own constructor/then), with guarded intrinsic reflection. A
throw from intrinsic Promise observation is never by itself DTO evidence. Preserve
the temporary command fence until supported-root eligibility and original currency
are established; exotic/unknown/poisoned roots fail closed. Existing C4 limits for
otherwise unobservable constructor/species-poisoned work do not authorize a SEND.
Unsupported directly observed prototype results retain their own work AND the
original root after retirement; neither replaces the other. No prototype-tree
traversal or thrown-reason inspection is authorized.
Never run caller toJSON/iterators or traverse arbitrary JSON graphs. Native/masked
Promise roots carrying matching fields and malformed required values retire the
original command before assimilation, retain directly observed work until settlement,
and permit zero SEND. Stop on the first malformed/revoked value without reading
later fields; own the value already returned by the revoking getter. Exclude only
the genuine exact host-disposal promise from self-drain. A late retired callback
reads no fields and cannot poison or borrow a newer active command. Keep this native
capture separate from the shared pure Web route resolver.
The five actual mapper route bodies stay identical. Honest emailSent/
notificationEmailSent outcomes remain owned by actual server response. Ordinary
Team HTTP/domain forbidden/error never fabricates identity-wide denial; actual
Self/session negative still invokes genuine conditional invalidation after FIFO.

Independent DESIGN (including concrete dependent hooks) and corrected CODE review
passed; actual final verification is recorded in TESTFLIGHT_READINESS.md. Actual installed SDK/disposable real SQLite,
synthetic transport/stores/config only; all29 methods, real dependent graphs,
admin/nonadmin privacy and wrongProfile/malformed createdTeam/roster IDs, exact
REST/HTTP/header/body and forbidden retargeting, original arrays/raw tokens, sibling/
late callbacks/drain and uncertainty, genuine Self denial/full residue, malformed
input isolation, no old facade revival, invalid API config zero session/fetch,
existing Web/Team/API/CORS/S5a-e/architecture regressions. No hosted email is sent;
server scripts/routes aren't changed. Extend exact ADR25/47/49 exceptions/guards.
Full required root/Web/mobile/browser/types/lints baseline after acceptance.

### Accepted concrete hook and transport contract

There are29 public methods:24 REST/RPC and5 ownAPI; the private postToRoute method
is not part of the public count. The20 fixed Team RPCs and6 relation names are
exactly those in the current actual mapper. Existing get_my_gate_state preflight
remains separate, unchanged. maybeSingle GET adds neither special Accept nor limit.
Canonical UUID .in() query values deduplicate in first-occurrence order; empty is
in.(). No copied private SDK field or fabricated builder is needed.

Hooks are optional constructor infrastructure only, not TeamService API. Three
purposes, each at one actual source location: ownProfileMapped(profileId) after
actual non-null getMyProfile mapping; createdTeamMapped(teamId) immediately after
actual create_team mapping before getTeamWorkspace; beforeRosterProfiles(teamId,
profileIds) immediately before that actual profiles.in() call. The mapper constructs
that last ID array ONCE after email handling; the hook and .in use that same exact
array. There is no second evaluation of row fields for this query. Web without hooks
uses identical current behavior. No hook infers admin/RLS eligibility.

Each command's private state machine begins with the one permitted original method
and typed input, and tracks every intent unused -> issued -> actual owned fetch
completed. Hook entry requires current original admission/account/health, no pending
prior request, actual required predecessor completed, matching purpose and one-time
use. Repeated/out-of-order/wrong-Team/malformed hooks retire further effects, own any
directly observed asynchronous work, and never alter a newer command. No hook
callback merely saying true is authority. Exact source placement is provenance;
no generic public callback can mint a dependent target.

- getMyProfile: one own-profile RPC; optional one own-profile hook after it. Null
  result grants nothing and retains mapper semantics; missing/ill-shaped ID mapped
  to null supplies no definitive denial. No dependent query is allowed.
- listMyTeams: own-profile RPC -> matching own-profile hook -> exact original
  admitted Profile active-membership query. Missing/null returns existing mapper
  failure and seals unused effects. Canonical different own Profile can mark genuine
  Self negative for actual conditional invalidation AFTER FIFO; malformed only refuses.
- createTeam: exact create_team RPC -> one actual created-Team hook (canonical ID,
  never caller/URL-derived) -> same workspace graph below at that exact ID. Follow-up
  failure never repeats create_team or invents rollback.
- getTeamWorkspace: original Team GET -> own-profile RPC -> one matching own-profile
  hook -> active Team-membership GET -> optional same-Team email RPC (at most once,
  only after membership completion) -> one beforeRosterProfiles hook -> exact profiles
  GET for that indexed own list. The actual mapper decides whether it is admin and
  calls emails; transport never copies that decision and server reauthorizes it.
  Roster hook is valid only after membership and, if issued, email completion. Actual
  profiles IDs are cloned/validated synchronously under original currency, with no
  iterator/alias. Only that one dependent read is added. Nonadmin actual mapper sends
  no email RPC. Any source/Team/Profile mismatch vetoes subsequent SEND.
- listAdminRequestsForMe: exact inbox GET -> own-profile RPC -> optional matching
  own-profile hook; no derived additional request. All remaining methods have one
  closed original static query/RPC or HTTP intent and permit no dependent hooks.

HTTP is a DISTINCT private wire purpose: exactly original configured canonical bare
HTTPS origin + one of the5 closed paths, POST, exact original JSON body, exactly
Content-Type:application/json and original Bearer. No apikey/schema headers, query,
fragment, fallback, discovery or redirect; credentials omit/redirect error. Resolve
native config once inside trusted host construction with existing pure validator;
invalid/missing denies HTTP BEFORE getSession and fetch, without disabling REST.
Closed pure route extraction retains existing Web authorizedFetch/helper/importer.
No second SDK read/browser helper is used; private same-command bearer/Self only.
Ordinary HTTP forbidden/domain/network failures remain Team results, not fabricated
identity-wide denial. Preserve actual postToRoute successful JSON CAST semantics:
owned/frozen JSON is not a new closed schema validation. No invented emailSent,
notificationEmailSent or synthetic HTTP response encodes local refusal. Actual
transport responses are privately materialized for ownership as in S5e, not faked
server facts. A lost committed HTTP/email result is never automatically retried.

Use existing TeamResult error kinds only; no unavailable extension. New private
infrastructure does not export a generic plan/client/runner or a callback receipt.
All remaining five-hook/transport/acceptance refinements in the independent
2026-10-25 preflight apply, including full drain through mapper/HTTP body and exact
own-disposal handling. All original scope and later-gate exclusions above remain.


Allowed production scope: supabaseAuthService.ts; policy-neutral narrow port and
optional purpose hooks in supabaseTeamService.ts; pure closed route extraction
(teamApiRoutePath.ts) reused by authorizedFetch.ts without changing Web session/URL/
transport behavior; authorizedTeamRequest.ts documentation; exact architecture
confinement; relevant docs/tests. No UI/app, SQL/native schema, actual environment,
dependencies, operational migration, signing/install/hosted or defaults change.


Current beta asset routing remains as already decided in ADR-0044 and
MOBILE_APP_MIGRATION.md §5.2/M3b3: no production component composes the restricted
resolver; all67 current public diagrams ship in the bundle and keep the explicitly
unchanged disposable localStorage cache. Native restricted binary delivery is no
prerequisite for those diagrams. Future genuinely restricted content remains
fail-closed under ADR-0023; no content permission or production caller is changed.

## S5g — Dormant native local sporting repositories

Status: independently DESIGN and corrected CODE accepted locally on25 October2026,
including the neutral inventory/selector refinement below. The unexpected mapper
failure path retires further I/O immediately and classifies archive failure only
after actual pending acknowledgements settle. Actual complete final evidence is
recorded in TESTFLIGHT_READINESS.md. S5f remains independently accepted. Starting main/HEAD/local-main/
origin-main382ee40d37605b302c11b6390305857c7e2c3fde,0 staged /75 modified /119 untracked
individual files. Existing explicit local implementation/single read-only reviewer
authorization applies; no Git mutation. No new product choice is required.

### Exact dormant API and scope

Extend only the existing NativeSportingIdentityRuntimeReady with:
createLocalSportingScope(profileId:string):NativeLocalSportingScope|null.
The frozen returned capability object contains exactly:
- repositories:SportingRepositories (the seven existing base repositories);
- syncState:SportingSyncStateRepository (actual load/save, separately scoped outbox);
- retireLegacyUnscopedData():Promise<LegacySportingRetirementResult>;
- readPersonalExport():Promise<{ok:true;records:Record<string,string|null>}|{ok:false}>.

The Profile selector grants nothing. Mint only from the existing actual internal
Profile/completion admission and same held native pair. Freeze capability closures,
not caller-owned domain data. No raw/scoped adapter, SDK/client, bearer, generic
key/query/runner, public admission/ready receipt, or callback-based grant escapes.
Every returned method keeps that original Profile namespace and admission forever;
new foreground ownership, genuine denial/close or later same-Profile authentication
never rebinds/revives it. Normal healthy background confirmation mints nothing.
No constructor performs I/O. Unavailable/mismatched Profile returns null.

Use all actual factories/parsers unchanged: Session5 methods, HistoryFilters2,
Assessment2, TrainingPlans2, AccuracyToleranceProfiles2, SmartRandomProfiles2,
AssessmentPreferences6 (21 total), plus the actual sync-state repository. Actual
repair/quarantine/unknown-version/measurement/exercise/privacy rules, serialization
property order, absence versus failure, hydration and history-first ordering remain
with their current domain owners. No new schema/key/format/protocol/hash/outbox,
record/time/count/size/retention or business policy. Web/default paths stay unchanged.

This stage owns only calls crossing this returned BASE repository/sync/retirement/
export boundary. It does not wrap or mount the actual SyncManager/React tree.
The real manager's decorateRepositories() still uses its original history/state
arguments after an await; capture only inside the base repository does not own that
outer alias. Full manager/decorator/App capture BEFORE those calls is a required
later gate, explicitly excluded from S5g acceptance. A real manager integration
fixture may prove ordinary namespace/outbox behavior with already-owned data, never
claim adversarial ownership for its still-unwrapped outer inputs.

### Private exact-key adapters and actual operation ownership

Keep one private same-pair domain target. Actual createProfileScopedSportingRepositories
and createProfileScopedSportingStorageAdapter supply the immutable original namespace;
actual createSportingSyncStateRepository uses that same target and exact namespace.
The private per-operation adapter permits only the13 actual Profile-scoped keys
(ten sporting keys plus Assessment draft/history plus cloud sync). Retirement has
only the ten bare legacy keys and its one marker; export only those13 scoped keys
through the existing readProfileSportingExport projection. No identity/provider/
protocol/public-cache/other-Profile or arbitrary key is reachable from this capability.
Do not reimplement domain serializers or key derivation as an alternate authority.

Register the whole local operation in host runtimeWork BEFORE any input capture,
foreign reflection, factory invocation or actual I/O. Capture synchronously before
the first await, then drain directly observed malformed work. Keep per-call malformed
state separate from global active SDK commands: invalid local input cannot poison a
concurrent genuine Auth/Team command or another local operation. Track entire mapper
completion and all actually issued adapter siblings through cancellation and close.
No timeout creates settlement, successful absence or a save acknowledgement.

Local domain operations never enter or wait for the SDK FIFO. Healthy domain I/O
can progress while unrelated protected/SDK work is pending, as the existing paired
runtime permits. Normal scope availability still requires original admission plus
normal host/pair health; a credential fault closes this ordinary scope. Protocol,
pairing/domain fault or terminal close also closes it. No Q1 exception here.

Each private adapter call checks original scope/call currency, allowed exact key and
actual healthy domain BEFORE issuing. Recheck after settlement before any further
I/O or data publication. Actual Assessment.loadState starts three concurrent reads
and may perform split/archive writes; guard those internal effects too. A method
failure never lets already-issued siblings escape the owning method/host close.
A stale read/export does not disclose old Profile data or fabricate absence; return
actual domain read_failed display fallbacks / export{ok:false}. Use the real factory
over an always-refusing private adapter if needed to preserve exact fallback shapes;
never migrate null into a fake Legacy Block or silently persist fallback data.
Thrown reasons are not inspected, serialized, logged or returned.

### Real write acknowledgements are facts, never continuation authority

A currency check and a real issued I/O acknowledgement answer different questions.
Do not rewrite a positive actual write/removal acknowledgement into evidence that
nothing was written merely because the admission was lost while awaiting it. Keep
that original operation's private issue/settlement facts; every NEXT I/O still needs
a fresh original admission check, and no result can mint/revive a scope or Q1 permit.
Return actual completed write-domain outcomes truthfully, without old Profile DTOs
or invented successful acknowledgements. An input/currentness refusal before issue
is an existing safe failed write; a real underlying failure remains that failure.
No retry or rollback is fabricated for an already committed write.

In particular preserve actual SessionArchiveOutcome and ADR-0014's step truth:
- no positive history ACK: do not issue current, return actual step:history failure;
- positive history ACK then currency loss: current I/O is refused, report step:current;
- actual current failure after history ACK: preserve step:current;
- both actual writes positively acknowledged: preserve actual ok:true as a factual
  completion, even if subsequent application continuation is unavailable. It grants
  no new work/current session/Profile admission. Later App/Q1 composition must gate
  its own UI/manager continuation independently, never treating this fact as a grant.

The same principle applies to internal Assessment split/archive steps and retirement:
retain real already-issued ACKs, refuse new effects after revocation. Do not promise
cross-key atomicity or report all earlier effects as absent on later refusal.
If unexpected mapping failure occurs after a positive history ACK, preserve that
fact in the existing step:current failure; never fall back blindly to step:history.
No new public storage/result vocabulary or receipt is introduced.

### Synchronous data-only DTO ownership

Capture each method's declared argument count and basic scalar kind before waits:
showIntroduction is boolean, threshold preset the existing three literals,
custom thresholds/filters/domain states are records, and history/plans are arrays.
Actual domain validation remains solely in the actual factories after capture.

An internal descriptor-only data copy may preserve the actual DTOs without invoking
caller accessors, iterators, array methods, toJSON or coercions. Preserve own property
order, legitimate optional undefined values, nonfinite numbers and sparse-array
semantics for the existing validators/serializers to decide. No credential-specific
snapshotJson budgets, finite-number normalization or new domain limits. Ordinary
shared references may clone independently; reject cycles rather than changing them.
Plain Object.prototype/null records and ordinary arrays only; safely refuse executable
accessors/functions/classes/symbols/asynchronous capability values. Own constructor/
then or failed native-Promise observation is not positive DTO evidence. Establish
supported-root eligibility independently; a changed plain prototype cannot hide a
real observable native Promise. C4 poisoned-constructor/species/hidden-work limits
remain unchanged and never authorize accepting malformed input as valid data.

Before/after EVERY reflecting foreign boundary check original call currency. Stop
at the first malformed/revoked value; do not inspect later descriptors/array slots.
Retire the call before assimilating directly observed work. Retain BOTH unsupported
prototype-result work and original root work; never traverse prototype trees. An
intrinsic-produced data descriptor has safely readable value metadata: if its trap
revoked the call, retain that already observed value's work without proceeding.
Own directly observed pending/rejected/native/masked/thenable work to settlement;
exclude only the genuine exact host-disposal promise from self-drain. Never inspect
thrown reasons or rescue unknown wrapped dependency cycles. Preserve detached
mutable domain outputs because the real UI legitimately edits loaded Session data.

### Legacy retirement, export and remaining App gates

Use actual retireLegacyUnscopedSportingData on the SAME held authoritative target,
never the old WebView source. Only its marker is read; ten bare early-test keys are
content-blind removals, marker complete only after their real acknowledgements.
Interruption/failure/next call retain existing bounded resumable semantics. No
credential-source retirement, all-origin clearing or source-copy deletion is added.
The historical StorageSeams 'after activation' wording describes production mount:
this explicit dormant host can exercise its own genuinely active held target in
synthetic local tests, but its existence grants no production cutover/app mount.
The future application may call it only after the separately required real readiness.

readPersonalExport uses the actual two-pass13-key export and actual sync projection,
including excluding other athletes' private results and current owned draft/outbox
results. Exact raw strings stay intact apart from the already-decided sync privacy
projection. It is a personal export, not an installation backup/import or access grant.
Public diagram caching stays exactly as decided in MOBILE_APP_MIGRATION.md; restricted
assets remain dormant. No new asset resolver is composed here.

Q1 stays mandatory before actual App mount: a genuine already-started same-Profile
Training Session and actual pre-fault admission/work evidence, independent healthy
SQL domain, actual credential first-failure evidence and the approved pure reducer.
Empty createNewSession/hydration, public Profile/ready/work selectors cannot mint it.
No startup/Assessment/Team/Home/new-work/Profile-switch exception, cloud/new-sign-in
unpause or in-document healing is implemented here. No mounted Flow/poll/reload,
full App invalidation subscription, callback intake, config assignment/rotation,
protected operational installation transfer, device or release acceptance is claimed.
Free pilot/no billing, Team separate from Personal, Q3 approved/Q4 deferred unchanged.

### Scope and required independent evidence

Allowed production scope: existing private host in supabaseAuthService.ts; one
internal narrowly imported nativeLocalSportingScope.ts/helper if needed for readable
ownership; existing profileScopedSportingPersistence.ts inventory/selector typing
only: expose the actual13-key inventory as a frozen readonly tuple, derive its exact
union type and use it in the existing selector without changing values, Set or key
derivation. Keep inventory tuples runtime-immutable and their new importers tightly
confined. Relevant exact architecture guards/docs/tests. Actual domain repository
and SyncManager policies/interfaces/defaults stay unchanged. Any unavoidable neutral
port refinement must be audited explicitly before editing. No native/SQL schema,
actual configuration/account/Keychain, storage default, App/UI, installation,
signing/upload/hosted/distribution or Git mutation.

Independent DESIGN acceptance before implementation, then independent CODE gate.
Actual installed SDK+disposable real SQLite with synthetic protected/transport only;
all21 repository methods, sync load/save, exact physical namespaces/no adapter escape,
raw measurement-aware Session/Plan/Assessment/Execution bytes and optional undefined/
nonfinite/property-order/sparse compatibility, real mutable loaded DTOs, actual
Assessment parallel reads/read-time writes, archive history ACK versus lost currency
(including both positive ACKs then loss), real partial current failure, actual two-pass
export privacy and exact content-blind retirement. Prove root/descriptor/prototype/
masked/rejected/thenable/alias/cancellation ownership, genuine own-disposal handling,
separate root+metadata settlement, whole-method sibling drain, active-SDK isolation,
SQL save while protected/SDK remains pending, stale denial/foreground/close and no
same-Profile revival. Real manager fixture proves only ordinary use, with outer
malformed-input ownership expressly left to later composition. Prior Web/native/
Identity/sporting/Team/deletion/architecture regressions and full root/Web/mobile/
139-browser/types/lints/diff baseline after CODE acceptance. No device claim.

## S5h — Dormant native sporting application scope

Status: independently DESIGN and CODE accepted locally on25 October2026 after
concrete source/canonical review. Actual final baseline is recorded once in
TESTFLIGHT_READINESS.md. S5g is
independently CODE accepted with the complete328-file/7,360-test/139-browser baseline
in TESTFLIGHT_READINESS.md. Starting main/HEAD/local-main/origin-main
382ee40d37605b302c11b6390305857c7e2c3fde;0 staged /75 modified /121 untracked individual
files. Existing explicit local implementation and single read-only reviewer mandate
applies; no new product decision, activation or Git mutation is authorized here.

### Exact capability and original manager

Add only this dormant method to NativeSportingIdentityRuntimeReady:
createSportingApplicationScope(profileId:string):NativeSportingApplicationScope|null.
Its frozen result contains exactly repositories:SportingRepositories, the existing
retireLegacyUnscopedData/readPersonalExport S5g signatures, and one frozen sync
capability with these exact methods:
- initialize():Promise<void>;
- synchronize():Promise<void>;
- retry():Promise<void>;
- getSnapshot():SportingSyncSnapshot;
- subscribe(listener:()=>void):()=>void;
- enqueueCompletedTeamExercise(execution:ExerciseExecution):Promise<boolean>;
- saveActiveTeamExerciseDraft(execution:ExerciseExecution):Promise<boolean>;
- finalizeActiveTeamExerciseDraft(execution:ExerciseExecution):Promise<boolean>;
- discardActiveTeamExerciseDraft(executionId:string):Promise<boolean>;
- refreshTeamExerciseEligibility(workspace:TeamWorkspace):Promise<boolean>;
- setMyTeamExerciseRecordingPermission(teamId:string,granted:boolean):Promise<TeamExercisePermissionUpdateOutcome>;
- refreshMyTeamExerciseResults():Promise<boolean>;
- setMyTeamExercisePrivateNote(resultId:string,note:string|null):Promise<TeamExercisePrivateNoteUpdateOutcome>;
- reviseMyTeamExerciseResult(resultId:string,replacement:AthleteExerciseResult,revisionId:string,reason:string):Promise<TeamExerciseResultMutationOutcome>;
- voidMyTeamExerciseResult(resultId:string,revisionId:string,reason:string):Promise<TeamExerciseResultMutationOutcome>.

Bind authenticatedProfileId privately to the original genuine Profile. Do not expose
cachedAt or online/currentness providers; use the actual existing default clock and
online behavior. No stateRepository, raw sync state, reconciliation helper, manager,
SDK/client, adapter, admission, callback grant or generic capture/execute capability
escapes. Domain DTOs and snapshots remain detached mutable values, not frozen UI data.

Mint only from the existing genuine original NativeProfileAdmission and same held
pair while normally healthy. Privately memoize exactly one application capability
and ONE actual SportingCloudSyncManager per that actual admission cell. Repeated
factory calls for the same still-current cell return that same capability; new
foreground/denial/close/new admission never revives/rebinds the old manager, even
for the same Profile. No constructor I/O. Preserve existing S5g factory behavior;
this does not claim global exclusion of separately retained genuine base capabilities.

Construct the real manager once with actual S5g base repositories/sync state, actual
S5c sporting service, actual S5e Team-exercise service and original mounted Profile.
The returned repositories wrap the ACTUAL decorateRepositories() result. Never copy
the manager's validators, serializers, reconciliation, restore, hash, queue, retry,
privacy, result correction or outbox policy. Existing actual domain factories remain
sole authorities; no new limits, schemas/keys/protocols/bytes or business rules.

### Whole outer call capture and separately owned background lanes

Register each complete outer method with the native host runtimeWork BEFORE foreign
reflection or actual invocation. Synchronously capture declared arguments BEFORE
calling the actual decorator or manager; pass that SAME owned history/state/
execution/workspace snapshot into the actual base write and later reconciliation.
This closes the explicit S5g post-await outer-alias gap, not TrackerApp's earlier
React event/effect ownership before these method calls.

Reuse S5g's descriptor-only capture through one narrowly imported internal data
capture helper if needed. Basic kinds: existing records/arrays/boolean/preset plus
string and nullable-string scalar fields for the actual manager API. Do not add
UUID/domain/string/size normalization: actual methods decide their existing policy.
Preserve optional undefined/nonfinite/property-order/sparse/shared-reference meaning;
reject accessors/functions/classes/symbols/cycles/asynchronous capabilities before
actual invocation. Keep independent root/prototype/descriptor work observation,
currentness before/after reflection, immediate per-call retirement before malformed
assimilation, C4 limits and exact genuine own-disposal exception. Malformed outer
input must plan NO actual manager lane, touch no I/O and poison no other operation.
No generic internal helper is returned or imported by App/UI code.

The real manager's schedule() receives one optional narrowly typed infrastructure
parameter, omitted by every current Web caller. It contains only trusted internal
original-scope currentness and registration of the EXACT newly created lane Promise.
Its closures come from the genuine private owner; neither is an application grant.
At schedule issuance, register that Promise synchronously before queued work can run.
Both fulfilled and rejected predecessor branches use the same entry fence. Keep a
private initially-unreleased entry flag; release only after registration returns.
If registration throws, or currentness throws/returns false at entry, skip work in
both branches without throwing into the ordinary globalIssue/publish catch, forcing
retry/synchronize, or publishing a fresh ready state. With the infrastructure absent,
retain the exact current Web queue/work/catch behavior. No new SDK FIFO or policy queue.

A planned lane captures its original admission and previously owned input closure;
never look up a newer admission/current manager or revisit the caller's original DTO.
Its lifetime is independent of the completed outer call's temporary capture flag.
Every next actual S5g I/O/native service SEND still checks that original admission,
normal host/pair health and scope lifetime. Issued work remains registered through
actual settlement and host disposal; no timeout substitutes settlement.

Preserve local ACK latency: decorated repository methods await only their existing
actual base steps. Reconciliation is separately already-issued host-owned lane work;
it may wait on cloud/SDK while a local save returns its factual ACK. Do not join it
into local repository completion, call synchronize merely to drain, or make unrelated
healthy local I/O wait for a pending cloud/SDK lane. dispose() drains actual background
work. A purely unexpected outer mapper error cannot invent an ACK; a previously
validly scheduled lane remains separately owned under its original admission rather
than being retroactively invalidated. Malformed capture before planning creates none.

### Facts, snapshots and foreign listeners

Preserve S5g factual base outcomes: positive history ACK then revoked continuation
returns existing step:current, both actual writes acknowledged preserves factual
ok:true; neither result grants UI/cloud/new work. Reconciliation may enter only with
its original admission current. Actual partial failures stay actual failures, with
no fabricated rollback or absence. For manager actions preserve the actual scalar/
union outcome when the real method completed, including updated_cache_issue,
conflict and result_voided; do not blanket-replace factual successes after scope
loss during later drain. Pre-entry refusal returns only existing method-shaped safe
void/false/"failed". Unexpected exceptions return no invented positive effects and
all issued actual lanes/I/O remain owned. No new result/grant vocabulary.

Keep one private safe initial snapshot from the actual UNINITIALIZED manager.
getSnapshot returns detached mutable copies. A stale scope returns a fresh copy of
that initial not-ready snapshot, never former-Profile payload. Callers cannot mutate
the manager or another caller's view through snapshots or loaded repositories.

Install ONE internal manager observer, never foreign listeners directly. Register
each delivery before invoking a foreign listener; check original currency and live
subscription membership immediately before each invocation and before subsequent
deliveries. Close/unsubscribe inside a callback prevents later delivery. Retain any
directly returned native/masked/rejected/thenable work separately in host ownership;
NEVER await it inside publish/the manager lane, since reentrant listener scheduling
could otherwise form a cycle. Exclude only the exact already-owned disposal Promise;
unknown wrapped cycles keep C4 limits. Ignore thrown reasons without inspection.
Malformed listener values are refused/retained per existing ownership mechanics.
Unsubscribe is idempotent; detach the internal observer on logical retirement while
retaining all already-issued work. Repeated factory calls do not add observers.

### Allowed files, evidence and remaining gates

Production scope: existing private host supabaseAuthService.ts; internal
nativeSportingApplicationScope.ts; neutral optional schedule infrastructure in actual
cloudSporting/syncManager.ts; a narrowly imported nativeSportingDataCapture.ts if
needed to MOVE/reuse S5g input capture with no behavior change; corresponding narrowly
scoped nativeLocalSportingScope.ts refactor, exact architecture guards and focused
native/actual-manager tests. Update existing canonical/ADR25/49/current architecture
claims, not a new ADR for routine plumbing. No Provider/Tracker/UI/Mobile mount or
storage defaults, SQL/native schema, source cleanup, configuration assignment,
actual account/Keychain, installation/signing/hosted/distribution or Git mutation.

Formal independent DESIGN acceptance before source implementation; independent CODE
gate afterward. Actual installed public SDK + disposable real SQLite with synthetic
protected/network counterparts. Verify all21 decorated repository methods, three
sync controls and ten Team actions through the actual manager/native services.
Nonempty terminal training/Assessment writes must produce actual original outbox
payloads despite mutation while base ACK or a preceding lane waits. Test same-cell
factory identity, new same-Profile admission, stale queued lane entry and failed
hook controls, foreground/denial/credential failure during running lane, exact
history/current ACK combinations, local ACK while cloud pending, background drain
without artificial synchronization, snapshot mutation, subscription membership/
unsubscribe/close/reentrant scheduling and pending/masked/rejected returns. Preserve
all S5g tests and actual Web manager/Provider behavior when the hook is absent; full
root/Web/mobile/139-browser/types/lints/diff baseline after corrected CODE acceptance.

This stage does not grant original pre-fault Q1 training continuation, Tracker event/
effect provenance, reactive warning, full App/Flow/poll/reload/invalidation/callback
composition, configuration assignment/rotation, protected operational installation
transfer or physical-device/release acceptance. Normal credential failure closes
this ordinary scope. Existing Free pilot/no billing, Team separate from Personal,
Q3 approved/Q4 deferred and67 bundled public diagrams/cache remain unchanged.

## S5i — accepted original training and actual Tracker ownership

Status: concrete DESIGN, complete corrected CODE and final complete local baseline
accepted on25 October2026. Exact verification is canonical in TESTFLIGHT_READINESS.md.
Starting source was on main/all refs
382ee40d37605b302c11b6390305857c7e2c3fde,0 staged /76 modified /125 untracked individual
files. No App/native default/flag/configuration/device or release action.

The approved Q1 optionA still permits local recording/saving for an already-admitted
ongoing same-Profile training when secure credentials fail and sporting persistence
is healthy. It pauses cloud and new sign-in and requires a clear warning. No new
Session/Profile/startup access, explicit-denial bypass, source fallback or fake save.
The existing pure credentialFaultPolicy reducer cannot create its own work tuple.

Product boundary DECIDED BY THE USER on25 October2026: when secure sign-in storage
fails, additional exercises and training blocks ARE allowed INSIDE the same already
started Training Session. A new Training Session remains blocked. This resolves the
concrete two-choice question; it does not grant a Profile/account switch or new
identity/startup access. The private Q1 work lifetime is that original genuine
Training Session, not each Block/Exercise. An unchanged public Session ID alone is
still insufficient: original admission, real Tracker context and a positive pre-fault
native ACK remain required. Actual Next Plan Step and within-Session exercise/block/
plan materialization must follow this permission without opening other persisted
domains or creating a successor Session. Technical DESIGN/CODE and complete local
baseline are now accepted; no activation.

The independent source preflight recommends one auditable vertical Q1 gate with
actual Tracker and a dormant local React composition, followed by the full native
App/Identity/Flow/Team/callback gate. A fault mapper alone would not prove original
work/context provenance; a complete platform cutover at once would be too broad.
The corrected concrete contract below and its resulting implementation have independent
DESIGN/CODE acceptance and the complete final baseline. Technical requirements:

- Own actual Session input BEFORE Tracker's runSessionWrite/capture waits, including
  commitSession, direct setCurrentSession updaters, explicit retries and archive.
  Preserve existing sequence/durability truth and mutable UI DTOs. Join genuine
  original admission/identity generation, actual Tracker context and Session lifetime
  with a positive native ACK known BEFORE the credential fault. A late ACK remains
  factual but cannot retroactively mint Q1. Home/empty hydration/view reports alone
  supply no admission. Legacy Session IDs remain strings; correlate a private UUID
  work receipt rather than tightening domain IDs or exposing public work selectors.
- Normal S5h, Team, Assessment, sync, export and new-sign-in remain closed. A separate
  reduced private Session role must preserve existing history and append only the
  actual terminal admitted work, never expose a generic adapter/saveHistory grant.
  Actual positive history ACK ends Q1 even when successor Current is refused. Retain
  honest completion feedback without granting/saving a new empty successor.
- Record the actual original first credential fault, including pre-issue failures,
  without fabricating one from malformed input or ordinary later refusals. Map real
  pre-issue to not_issued and issued/unverified to unknown; failed needs additional
  positive evidence the current port does not provide. previousValueMayBeLost comes
  only from real write issuance plus captured replacementLoss. Pending stays pending;
  a domain validation error is not automatically failed SQL health.
- Bind ordinary native Auth background restore privately to its genuine original
  admission/account where needed. Reuse existing causal denial/generation rules;
  proactive refresh rejection with healthy still-valid getSession is not a new
  definitive denial. Genuine matching denial vetoes Q1 immediately before cleanup/
  FIFO finalization and survives cleanup failure; stale/foreign results grant none.
- Use the actual synchronous first-fault subscription and synchronous owner/context
  changes, not polling or delayed React effects, for warning and revocation. Account/
  foreground, explicit signout, denial, unresolved barriers, pairing/Profile/domain
  fault, nontraining overlay/context and close must gate handlers AND queued work.
  Successful SDK events/null observations never heal the in-document exception.
- Shared UI may import only a tiny React context and erased native types. The dormant
  actual-Tracker test composition must use a genuine host/private binding, no public
  tuple/Boolean/ready receipt and no browser fallback. Preserve the already-owned
  Tracker instance if Q1 allows it without fabricating public Identity ready state.

The following full App gate must coherently consume native invalidations/local
export, real DeletionFlow polls/fresh-OTP cancel/reload, one S5h ProfilePersistence
capability and actual Team/Invitation services. Native unavailable cannot select
browser seams. Native callback delivery is a separate real technical gap within
that gate: SceneDelegate forwards to Capacitor, but no JS appUrlOpen/getLaunchUrl
intake exists. Warm URL cannot rerun cached startUpOnce; define actual launch/warm/
duplicate/correlation/listener/lifecycle ownership and retain same-root constructor
tombstones. No Universal-Link/Apple/configuration or physical proof is implied.

Required Q1 evidence will include actual Tracker + installed SDK + disposable SQLite:
fault before/after ACK, direct updater batching and queue aliases, legacy IDs,
Home/empty hydration/overlays, immediate actual denial despite cleanup failure,
domain faults, history ACK/step:current completion, pending/dispose and no SDK healing.
No timer may manufacture saved/settled. Exact implementation scope and full baseline
follow the formal design. Q3 remains approved, Q4 deferred; Free pilot/no billing,
Team separate from Personal and current67 public bundled diagrams/cache unchanged.

### S5i concrete implementation contract — independently accepted DESIGN

This section is the independently accepted complete local implementation contract. Implement directly in this authorized checkout on main; preserve
all existing uncommitted work and leave every change unstaged/uncommitted. Do not
construct/activate production native composition, change flags/configuration, perform
installation/signing, access real credentials or hosted services, or inspect .env.local.
The separate reviewer is read-only; no concurrent source edits during CODE review.
Read AI_DEVELOPMENT_WORKFLOW.md and the governing Q1/ADR49/ADR25 decisions before
implementation. Existing S5g/h owners and ordinary Web behavior remain authoritative.

**Private source ownership.** Add an internal registry with exact architecture-tested
importers: native Auth host registers the final frozen genuine runtime object; the
single dormant native Tracker composition resolves it. A spread, lookalike or proxy
cannot resolve. Bootstrap is explicitly two-phase: authenticate the final runtime
object WITHOUT granting a Profile, then mount the actual IdentityProvider with that
runtime and run its real startup/OTP/onboarding. Only after its actual ready admission
may the inner composition bind the application capability and internal Tracker port.
No external pre-onboarding shortcut, synthetic ready value or public supplied grant.
The registry exposes neither SDK, pair, adapters, admissions nor tuple selectors.
The host memoizes a binding per genuine original admission and permanently retires it
on an admission change, including A→B→A. Extend the private coordinator-minted
NativeProfileAdmission with its actual captured identity epoch, not SDK credential
generation. The private work UUID is generated by the captured host UUID source and
correlates a real Session lifetime; legacy Session IDs remain strings.

**Source-fault evidence and denial.** Record the first real credential failure at its
actual failing operation even when physical mutation was not issued; do not treat
malformed calls or later liveness refusals as a new physical failure. Evidence carries
previousValueMayBeLost only for an issued write and the captured replacement-loss
property. The owner's synchronous real first-failure subscription maps pre-issue to
not_issued, issued/unverified to unknown (never infer failed from a throw), drives the
existing pure reducer and publishes a stable presentation snapshot. A pending operation
is pending. The ordinary S5h manager remains retired. Reuse original private account/
admission attribution in Auth restore and data self-checks: a current actual matching
causal denial must veto the owner as soon as proven, before SDK cleanup/FIFO completion.
Proactive rejected refresh with a still-valid healthy session remains the accepted
S5a behavior. Stale commands cannot revoke or admit later work. Foreground identity
transition, explicit signout, unresolved barrier, admission/profile/pair mismatch,
terminal host close and sporting/protocol failure synchronously revoke Q1. A later
SDK success or null observation cannot heal it. Keep actual physical evidence separate
from domain validation refusal; invalid Session DTOs do not imply SQL failure.

**Port and queues.** Shared UI imports a tiny React context plus erased port/types;
that module imports no native implementation. The internal port exposes only typed
Tracker attach/detach, synchronous context/Session commit reports, prepareCurrent/
prepareHistory/prepareArchive and matching persist methods, and a cached presentation
snapshot/subscription. Prepared jobs are frozen opaque tokens authenticated by a
private WeakMap. The owner registers whole actual work before reflecting inputs,
owns immutable detached data, original tracker incarnation, Session line and commit
sequence, and observes malformed directly returned work without self-disposal cycles.
Preparation grants no storage I/O. Persist may start once or join the same actual
promise, never reissue. Unsubmitted jobs must be explicitly cancelled/drained on
retirement; do not make dispose wait forever for a UI queue that will never run.
The actual Tracker prepares before runSessionWrite and before any capture/plan wait
where a payload is chosen. Queued actions whose target is deliberately selected at
execution retain that fresh-target semantics, but bind their original tracker/Session
intent before waiting and recheck it before selecting/committing a payload. No generic
run/adapter/key API. Missing or foreign tokens refuse without evaluating payloads.
Saved feedback uses the captured payload and original sequence, never a mutable alias
re-read after ACK. Keep all existing capture ordering and durable waiter semantics.

**Actual Tracker proof.** All actual Session commits, including today's direct
setCurrentSession updaters, pass the provenance path. Compute pure updater results
from the authoritative ref once outside React updater callbacks; then observe, stamp,
set ref and set state. Hydration is reported separately and cannot itself grant work.
Every actual navigation and nontraining overlay transition updates private context
synchronously before rendering. Settings here means global activeView=settings; the
embedded Session title/notes editor remains part of the same training. Actual Team
draft, pending Team setup and Team result contexts are not personal Q1 training. Train view alone, empty hydration, a public same ID,
or a reported permission Boolean is insufficient. The host joins an active genuine
personal Tracker/Session line with nonempty actually begun work (including a started
Block before its first shot) and a positive native Current write ACK already known
before the first fault. Late ACKs remain factual but cannot mint Q1 retroactively.
Additional Blocks, solo Exercises and materialized existing loaded Plan steps inside
that same Session preserve the work UUID, implementing the approved product boundary.
This does not allow editing Plan definitions or other persisted domains. Fault during
Home/Team/Assessment/settings/manager overlays cannot later acquire a training grant.
A Team Exercise does not qualify as personal Q1 work.

**Normal and reduced I/O.** In normal operation use the exact memoized S5h capability,
including its real manager; never compose a second manager. Add private optional
actual Current-ACK AND History-ACK observations below the S5h mapper. Correlate each
observation to its genuine prepared job, original admission/Tracker incarnation,
Session line and original sequence before the outer S5h promise returns. Current-ACK
may confirm Q1 only before the first fault. History-ACK ends Q1 only for the actually
correlated terminal Archive job; arbitrary history writes cannot finish it. These
are private fact channels, not grants or callbacks exposed to application callers.
Generic repository/domain policy and public result contracts remain unchanged. After
fault only the genuine existing owner may use a separately private Session-only role
on the original pair, independently of the closed S5h manager/credential lane. Check
original admission/lifetime, current training context and healthy domain/protocol at
every emission. Current writes must belong to the original Session line. No free
saveHistory, other repository, sync-state, export, Team or identity access is revived.
A Q1 finish reads the genuine existing stored history through the narrow private role,
preserves every prior entry and appends only the actual terminalized outgoing Session
according to existing application order. It must not trust a replaceable UI history
array. Validate using the actual SessionRepository, not a parallel schema. The actual
positive history ACK ends the exception inside the private I/O path, before successor
Current can issue, including a normal archive interrupted by the first credential
fault. History failure/unknown ACK keeps honest unsaved state and grants no completion.
Return a typed factual completion projection alongside the existing archive outcome
if the Tracker needs it; it is not an I/O permission. Tracker keeps saved outgoing
summary/history feedback after successful history ACK, but does not commit, persist,
retry or expose an empty successor under Q1. Empty/nonarchivable finish cannot open a
new Session. Every handler and queued mutation is gated, not merely its save effect.

**Dormant composition and lifecycle.** Add one local, unused-by-production native
Tracker composition accepting a genuine already-created native runtime. Resolve the
private binding; unavailable native composition renders blocked without choosing Web
seams. Supply the exact S5h capability to a native branch of actual
ProfileScopedSportingPersistence; the Web branch remains unchanged. This gate mounts
the actual Tracker against the real admitted native lifecycle and actual SDK; do not
fake an Identity-ready value or rely on a mocked Tracker. Preserve the existing real
Provider behavior: background transient Credential unavailability retains its Ready
view, while actual denial continues to unmount and revoke Q1. Do not add general
Provider retention. The native ProfilePersistence retains only the already-bound
Tracker across Q1; it cannot rebind the closed S5h manager or fall back to Web.
The caller creates the host
once outside React render. Tracker attachment has an actual stable incarnation;
StrictMode cleanup detaches context/listeners without constructing or disposing the
document host. React reattachment after fault cannot create fresh work/admission.
Actual host disposal synchronously revokes, then drains owned real emitted/observed
work; presentation teardown cannot create self-await or bypass the SDK tombstone.

**Acceptance and allowed scope.** Source changes are limited to the concrete Auth/
coordinator fault/denial join, the narrowly required nativeCredentialMigrationPort.ts/
nativeCombinedRuntime.ts first-failure/loss evidence, the S5g/h private Current-/
History-ACK fact observations, internal native Tracker registry/owner/types/context,
actual Tracker commit/queue/feedback/context paths (including the small TrainLanding/
TrainingPlansLibrary editor boundary, IdentityAccountControl paused-sync display and
IdentityPendingTeamIntent fail-closed replay), the sole Account-control mapper's
narrow validated-Profile observation,
the dormant composition/native ProfilePersistence branch, and their tests/architecture rules/documentation. Keep
schema, SQL, credential physical protocol, migrations, public SDK and default native
composition unchanged. Real installed SDK + disposable SQLite tests must cover actual
Tracker admission via real onboarding/OTP or genuine startup, pre/late ACK fault,
first pre-issue/issued/loss evidence, started block without shot, direct updater batching,
mutable queue aliases, retries, further blocks/solo Exercises/existing Plan steps,
legacy Session IDs, empty/Home/overlays/Team, same-ID new lifetime, signout/foreground/
barrier/actual denial with cleanup failure, stale denial, domain/protocol failure,
history preservation/history ACK with refused successor, lost ACK, pending/dispose,
StrictMode detach/remount and no SDK healing. Pure tests supplement actual integration;
no test-supplied work tuple/Boolean or mocked native permission proves admission.
Run focused meaningful tests, independent CODE gate, then full root tests (maxWorkers4),
Web build, mobile verification (including no eager native bundle imports), full E2E,
server shutdown probe, post-server TypeScript and both lints, git diff --check. Use exact
results in TESTFLIGHT_READINESS; reconcile current ADR25/49/Mobile/Persistence/Roadmap
claims and Vault progress. No Git mutation. Report starting/final state, changed files,
actual checks, corrections and remaining gates; no Q1 or beta-complete claim before proof.

The following full App/Identity/Flow/Team/native URL-delivery gate remains separate.
Q3 approved cleanup, Q4 deferred backup acceptance, Free pilot/no billing, Team separate
from Personal and67 bundled public diagrams/cache remain unchanged.

S5i DESIGN gate accepted after independent full corrected-contract/source review on25
October2026. The DESIGN review executed no tests and changed no source. Subsequent
independent CODE and complete local verification passed; no production/native activation.

### S5i accepted local implementation and limits

The actual dormant Provider/OTP/onboarding/Tracker composition authenticates its genuine
runtime and original admission; immutable prepared jobs join original Session line,
incarnation/sequence and positive pre-fault Current ACK. Additional blocks, solo
Exercises and existing Plan steps stay within that same Session. Actual first credential
failure and source domain/protocol/lifecycle/epoch/denial facts publish synchronously;
ordinary S5h access never revives. Capturing cancellation waits for the entire synchronous
capture boundary and every actual pending observation, excluding exact self-disposal.
Healthy remount requires fresh context/ACK and cannot inherit old jobs/proof.

The actual Account status/cancel boundary preserves unsigned incoming intents, binds
actual original Account/Profile, and observes the sole mapper's validated control Profile
before early returns/guards/mutations. Actual account/Profile replacement revokes original
training and finishes real conditional denial; malformed data does not invent denial,
and no-admission fresh-OTP recovery remains available. Native Team screens/replay are
closed before browser construction until the separate App binding; durable links remain.

Reduced finish preserves actual stored history and refuses unknown malformed history.
The actual terminal History ACK ends Q1 before successor I/O; the original Current
remains the existing recoverable history-first step:current representation. Full App
fresh-lifetime acceptance must explicitly verify preservation under fresh identity/storage
checks; this slice adds no startup repair or ID deduplication.

Independent CODE PASS and complete final baseline are recorded once in
TESTFLIGHT_READINESS.md §S5i. Actual SDK/SQLite/Provider/Tracker tests are local evidence,
not physical Keychain/installation proof. Source-start76 modified/125 untracked;
source-end80 modified/133 untracked individual files,0 staged; all refs382ee40d37605b302c11b6390305857c7e2c3fde.
No native activation/configuration, platform installation, hosted transmission or Git
mutation. Full App/Flow/export/Team, URL/configuration/operational transfer, devices and
release remain open. Q3 approved, Q4 deferred; commercial beta decisions unchanged.

## S5j — dormant actual App / Account Flow / export / Team composition

Status: independently DESIGN and complete corrected CODE accepted on25 October2026;
complete final local baseline PASS. Canonical exact verification and physical limits:
TESTFLIGHT_READINESS.md §S5j. S5i remains accepted. Source start main/all refs
382ee40d37605b302c11b6390305857c7e2c3fde,0 staged/80 modified/133 untracked individual
files; executable source end0 staged/83 modified/137 untracked. The existing local
implementation and single read-only independent-review authorization applies. No
activation, actual configuration assignment, operational installation transfer,
physical/hosted/Apple action or Git mutation follows from this acceptance.

**Outcome and boundaries.** Join the actual native Provider and actual AccountDeletionFlow
with the genuine same-owner local export, invalidation and Team services. Reuse installed
SDK, existing actual sole mappers and actual S5h manager; no copied App/Flow, second SDK,
Profile grant, manager, auth parser or browser fallback. The first iOS beta remains
email OTP only. Full native Google/M2, native launch/warm URL delivery, operational
configuration assignment/rotation/installation transfer and device/hosted/Apple release
are separate gates. Do not change flags/defaults, shipped roots, SQL/schema/physical
credential protocol or source cleanup. No real accounts/credentials, signing, install,
upload, Git mutation, environment-file inspection or external publishing. Q3 approved;
Q4 unapproved/deferred until the concrete device example. Free pilot/no billing,
Team separate from Personal and67 bundled diagrams/cache unchanged.

**Authentic composition.** Extend only the private genuine-runtime registry with a
memoized native App composition facade: bindProfile(profileId) resolves the exact same
host-owned Tracker/application binding; subscribeToIdentityInvalidations forwards the
existing genuine native completion subscription. Registry membership is authenticated
before any property access; spread/lookalike/Proxy cannot resolve. No runtime/SDK/pair/
adapter/admission is exposed through this facade. Shared UI sees a tiny React-only
context plus erased contracts with exact architecture-tested importers. The dormant
root obtains this genuine facade and supplies it ABOVE actual IdentityProvider, whose
real startup/OTP/onboarding still creates the sole admission. No host construction in
React. Keep the existing inner genuine S5i binding and actual ProfilePersistence/Tracker
lifecycle intact: the inner useState retains the exact original binding through Q1;
StrictMode and real healthy remount cannot construct/dispose the document host or
heal a retired scope. Unavailable native remains blocked, never choosing Web.

The above-Provider facade is needed because Provider export/invalidation live above
the S5i Tracker context. Provider may separately capture bindProfile only for an actual
ready Session owner, resolving the same host memoized capability. That export binding
must NOT replace/reparent the existing inner Tracker context or AccountDeletionFlow:
reparenting on ready/locked would lose Flow state, and recomputing a null export binding
after credential fault must not detach the original Q1 Tracker. Native unavailable is
explicit even when no binding exists; context presence, not nullable service fallback,
selects the native policy.

**Actual personal export.** Capture the exact ready owner and its original native
application export capability when the facade is created. Reject an old facade after
A→B→A even with identical public Profile ID. Before each actual operation, after every
await and before combined export publication, prove that original ready owner is still
current; the underlying capability independently fences its genuine native admission.
Read local personal export through readPersonalExport on the same S5h scope, never
readProfileSportingExport/browser sportingStorage for a present native composition.
Use existing complete cloud export and existing combined format/privacy/other-device
explanation. Either local or cloud failure refuses complete export; no partial success,
raw token exposure, source fallback or revival during Q1. Ordinary Web export stays
unchanged. Actual FileExport UI may use its existing platform seam; injected export-
delivery observation does not replace real native data/export proof.

**Native invalidation to actual Provider — three separate concerns.** The genuine
above-Provider registry facade is constructed before admission and captures no ready
owner. Per-ready export facades alone capture exact Provider owner/application capability
after actual readiness. For invalidation, subscribe with exact React/runtime ownership
and proper unsubscribe, preserving the complete actual outcome/residue.

First, preserve conditional BEGIN and unconditional genuine denial COMPLETION. A stale
scope cannot start a new denial; once an actual denial has begun, its real completion
must reach transition_settled and lock even when a newer foreground operation has begun.
Do not apply a generic ready-owner/sequence filter to suppress that first delivery or
weaken denialFor. Progress/errors are not substitutes; do not fabricate outcomes or
retain Ready for genuine denial.

Second, make delivery of the SAME genuine completion idempotent under actual runtime
and transition identity, preserving its entire outcome/residue. Subscription and awaited
Provider beforeMutation/pending/cancel callbacks may report that same completion. A
re-delivery already applied must not create another reducer-state owner and invalidate
the genuine request/cancel continuation. Reused actual completed-denial receipts follow
the same rule. Do not confuse deduplication of an applied completion with suppressing
a previously undelivered older begun denial or a different residue/outcome.

Third, fence pending-intent PRESENTATION separately. An old completion's successful
intent cleanup cannot prove removal of a subsequently captured/loaded link. Use the
actual intent/version associated with the operation or a fresh actual repository
observation under current projection ownership before clearing/replacing the displayed
intent. Without matching evidence retain the newer display; do not infer identity from
Profile ID or capture the latest intent only when completion arrives. Preserve actual
durable deletion/cleanup obligations in the host; this is UI projection, not a new
persistence policy. Ordinary Web behavior remains unchanged.

Required actual Provider tests: begun denial still locks after newer foreground starts;
a newer durable/displayed link survives older cleanup evidence; subscription plus awaited
callback applies one completion and preserves actual request/cancel; repeated cached
completed-denial delivery cannot change cancellation ownership; failed-denial residue
is complete and honestly rendered. Use actual coordinator/SDK/SQLite and real Flow
for the corresponding ownership timelines, not a fabricated ready outcome.

**Bound native Team UI.** Extend the host-memoized original Tracker binding with
its genuine admission-bound TeamService (nullable only for explicit unavailable).
Both TeamsScreen and TeamInvitationAcceptOverlay consume that binding through the
React context and use the existing sole mapper/host ports. Native presence must branch
before generic browser config/client/service construction; do not write nativeService
?? browserFactory. Service methods retain their original account/Profile/lifetime,
Self/HTTP and C4 fences. Actual Team Exercise continues through the exact existing
S5h manager, never a second instance. Web production behavior and Web test seams stay
unchanged. Missing/retired/paused native Team access is explicitly unavailable and
preserves durable invitation/admin-request intents until actual accepted completion.

Remove the temporary S5i blanket Team-preview closure only where genuine native
binding is now supplied. Settings/Home/Account/admin-request entry reports nonpersonal
context synchronously before TeamsScreen mounts, as existing Tracker callbacks do.
Invitation replay requires a two-phase native presentation: actual pending intent is
recognized; a stable Tracker callback reports the invitation overlay synchronously;
only then may the component's local state permit the actual overlay to mount and issue
its preview. An effect that reports context after the overlay's first effect is too
late. Native unavailable does not mount the overlay. Closing reports context loss/
closure without healing Q1; discard the durable intent only through existing actual
completion policy. Actual wrong-account recovery retains its one validated invitation
and uses the same coordinator. Web direct replay behavior remains unchanged.

**Actual AccountDeletionFlow acceptance.** Mount the real Flow, not the render-only
mock used by earlier S5d Provider tests. Exercise Settings→dialog→personal export,
request under real recent reauthentication, pending shell and training pause; actual
getState polls, fresh actual email OTP and Keep my account; cancellation's synchronous
onCurrentResult before genuine trusted-state continuation; ordinary failed/conflict/
recovery-period cases; actual reload and late old getState/request/cancel/export.
Keep unsigned status absence/intent retention and genuine Account/Profile replacement
controls from S5i. Under actual pending deletion, no training or ordinary new admission;
failed guard/credential cleanup stays denied. No fake request/export/mail/cancel success.
Use actual installed SDK, sole Account mapper, disposable SQLite and synthetic API/
protected storage. File/save/share delivery may be an injected device edge; data and
identity flows must remain real. Correct the actual Flow only for reproduced integration
defects, preserving approved30-day/anonymization/neutral-notification policy.

**Fresh-lifetime Q1 finish.** Verify actual saved history and the still-present original
Current after history-first step:current under a new module/document lifetime, fresh
normal identity/storage checks and actual App hydration. Dispose/drain old resources
before module reload, preserving the actual synthetic SQLite/protected bytes; a new
module is only local JS-lifetime evidence, not physical platform proof. No cached Q1
work tuple is a startup grant. Preserve the existing recoverable duplicate honestly;
no public-ID deduplication, automatic clearing, fabricated terminal work or silent
repair. Verify recorded fields survive and actual new training obeys ordinary fresh
permission. A present unreadable/malformed representation must not be claimed safe.

**Allowed implementation surface.** Private registry/erased types and one small
React-only above-Provider context; dormant root; host original Team binding; Provider
native export/invalidation branches and original facade-owner fencing; actual Team/
Invitation/PendingIntent context seams and Tracker invitation callback; actual Flow only
for concrete integration defects. Tests/architecture and canonical docs. Existing tiny
Tracker context remains erased/native-value-free. No default MobileApp import, runtime
switch, configured value assignment, migration/transfer mutation or platform activation.

**Proof and gates.** Real Provider startup/OTP/onboarding, exact same genuine manager/
application scope; personal export all current domains/outbox/privacy without browser
storage/factory; healthy/unavailable/paused/denied native Team routes and actual mapper
Self/own-API failures; durable invitation/admin request and actual wrong-account replay;
real Account Flow request/pending/poll/fresh-OTP cancel/reload; stale A→B→A closures,
queued work, reentrant listeners, pending/dispose, StrictMode and healthy remount;
Q1 history-first fresh-lifetime representation. Preserve all S5i real SDK/SQLite/Tracker
regressions and default Web/mobile behavior. Synthetic Profile/ready/permission injection
cannot prove native admission. Record formal independent DESIGN before code; independent
complete CODE after focused checks, then root(maxWorkers4), Web build/mobile verification,
full139 E2E, server shutdown and post-server TypeScript/both lints/diff. Independent
Design-only review runs no suites concurrently with the Parent's S5i final baseline.
Reconcile current architecture/ADR/Mobile/Persistence/Roadmap and single Readiness
verification record; update Vault progress. Report exact checks, changed files, starting/
final Git state and remaining native URL/config/transfer/device/release gates.

S5j DESIGN PASS follows independent complete corrected-contract/actual-source review
on25 October2026. The reviewer performed no tests or writes. This accepts only the
bounded dormant implementation contract, not CODE, activation or release.

S5j design clarification during actual integration (25 October2026): real native
Team denial followed by a new durable capture reproduced a missing UI projection:
a concurrent genuine barrier observation replaces the reducer owner while its
fresh intent read is outstanding, so that read must be rejected but a fresh read
must be scheduled for the new stable owner. Native projection therefore observes
stable reducer-owner changes, independently of whether the gate is Ready; it never
grants admission or starts Team presentation behind a closed gate. Also the generic
runtime's nullable loadPendingIntent conflates absence, malformed/read failure and
closed host. Extend the same private genuine composition facade with one bounded
observePendingIntent operation returning known(value-or-absence) or unavailable,
using the exact coordinator-owned repository and host drain/lifetime. No adapter,
repository, raw malformed data or authority escapes. The native Provider replaces
its projection only from a known observation under the current projection version,
current owner and active lifecycle; unavailable preserves the existing display.
Web behavior stays unchanged. This narrows the already-required fresh-observation
proof; independent clarification review is required before this correction.

The complete bounded clarification received independent DESIGN PASS on25 October2026. The reviewer read the actual sources, performed no writes/tests, and confirmed only value/absent may project known state. The subsequent complete corrected CODE and final full baseline are now accepted as recorded below and in TESTFLIGHT_READINESS.md.

S5j accepted implementation: the genuine above-Provider composition exposes exact
original binding, full invalidation subscription and known/unavailable intent
observation; no raw SDK/pair/adapter or admission escapes. Exact state/ready-owner,
active React lifecycle and a native-only one-way export-retirement witness fence
old account/export facades and the actual final file-share edge. The original inner
Tracker and Flow mount positions remain intact. Same-host bound Team services and
two-phase invitation context replace the temporary S5i blanket closure. Actual
recovery suppresses only the redundant provider SIGNED_OUT invalidation after its
coordinator-owned deliberate denial. Current cancellation conflicts are reported,
and a later owner must explicitly check its own deletion confirmation. Actual
Account B replay and new module/host/App lifetime preserve the real saved Q1 History
and original Current under fresh ordinary identity/storage checks. No cached Q1
startup permission, repair or public-ID deduplication is added.

S5j independent CODE review found two material lifecycle gaps (25 October2026):
request permission survived actual Provider unmount while awaiting a begun denial;
and a completed export could reach the real native file share after a newer genuine
foreground transition, either at the result/Flow gap or during bridge loading.
The correction keeps begun denial unconditional, rechecks native React lifecycle
AFTER denial before returning request permission, and refuses retired presentation
results. It adds only a native per-export one-way retirement witness, captured on
the original Provider facade before any await. This witness has no admission/read/
mutation authority; it checks the exact original active Provider/ready owner and
same genuine memoized binding. The actual Flow carries it through the existing
useFileExport attempt to the real file boundary's final pre-share retirement check.
Retirement is sticky; no render/Profile-ID/effect timing or A→B→A revival can heal it.
Ordinary Web calls retain their existing single-argument delivery path and behavior.
Already-issued OS sharing remains factual and cannot be recalled; no physical OS
share was used in the local tests. The independent reproductions and successful
current-export/already-issued-cancel controls are adopted as actual SDK/SQLite/App
regressions, with further bridge/canShare/mkdir/writeFile foreground cases. Independent
complete correction re-review and final full baseline passed. This closes S5j only;
URL delivery, configuration/rotation, operational transfer/exclusion and physical/
release gates remain open. Q3 approved; Q4 deferred to the concrete device example.



## S5k — Accepted dormant exact native provider-configuration binding

Status (2026-10-25): independent bounded DESIGN, complete corrected CODE and final
local baseline PASS. Exact verification is recorded only in TESTFLIGHT_READINESS.md.
Starting Git: main, HEAD/local main/origin-main reference
382ee40d37605b302c11b6390305857c7e2c3fde;0 staged/83 modified/137 untracked.
Preparation reads no environment; this stage assigns no production values,
flags/defaults, installation or activation. All existing manual host APIs and Web/mobile defaults
retain their public contracts. Supported operational configuration changes, URL
intake, protected installation transfer and physical/release gates remain separate.

### Exact configuration and genuine capability

prepareNativeProviderConfiguration takes only an explicit configured record with
exactly the three OWN data fields status, url and publishableKey. Verify own-field
membership before reading their values. Descriptor-only capture rejects accessors,
symbols, own then/constructor, cycles, non-data roots and async inputs without
coercion, foreign iteration or toJSON. Rejected observable async inputs stay owned
through settlement; the shared data-capture helper retains the actual native Promise
as well as its void completion probe after retirement. A plain-prototype native
Promise cannot hide its fulfillment behind that probe.

Validate primitive strings against the actual native host's existing exact resolved
configuration rules. Reject userinfo/query/fragment, require a derived existing SDK
root satisfying S1, and introduce no additional normalization/equivalence policy.
Derive pc1: plus all64 lowercase hex characters of standard platform SHA-256 over
UTF-8 bytes of the exact primitive tuple:
['native-provider-configuration/v1','auth-js/2.112.3:credential-v1',url,
publishableKey,derivedSessionStorageKey]. These are the canonical ordinary
JSON.stringify(tuple) bytes, obtained without serializing an array/object: capture
standard JSON.stringify, validate ALL owned primitive-string rest arguments before
any call, access numerically, stringify each primitive independently and frame with
literal JSON-array punctuation. No inherited Array/Object/String toJSON, iterator,
coercion or prototype-substituted value may redirect the preimage. Unicode/lone
surrogates remain exact. The same primitive framing supplies unchanged Domain and
Credential preimages; no purpose/version, S1/S2 format or hash algorithm changes.

Equal exact tuples remain stable across module/application lifetimes. Different exact
URLs/keys/roots have collision-resistant cryptographic identities, not a mathematical
injectivity/authenticity proof. The older preassigned/injective wording remains a
composition precondition. Case/default-port/trailing-slash/path spellings are distinct
exact configurations. Existing mismatch/foreign namespace checks refuse changed
configuration against old Q/M/I. Source, application raw values and credential items
remain preserved; existing permitted fault-F persistence remains factual and may
prevent automatic return to an earlier configuration. No metadata byte-identity,
rebind/rekey/reset/deletion/fallback or recovery promise is introduced. Q2 remains.
The own API origin is excluded and stays captured independently under ADR0047;
missing/invalid API origin blocks only own-API calls, not provider Auth/REST.

Return a frozen opaque capability with no enumerable config/key/ID/root/hash or
admission authority. A private WeakMap binds it to frozen captured config, derived
ID/root and standard Domain/Credential bindings. Only the narrowly guarded actual
host imports its internal lookup. Copied, forged, wrapped or foreign-module
capabilities refuse before options access or resource reservation.

### Same actual host, capture and complete async ownership

createConfiguredNativeSportingIdentityHost(binding,options) uses the same existing
reserved builder, S3i owner, SDK/coordinator, admission and genuine sporting/App
runtime. It ignores duplicate config/ID/root/fingerprint fields. Only remaining
SQLite/bridge/platform/limits/UUID/clock/transport/navigation/callback dependencies
enter the existing synchronous capture after genuine SDK reservation. No SDK, SQL,
protected-store or HTTP I/O occurs during preparation/host construction. No parallel
host, raw SDK/pair/adapter or new admission Boolean escapes.

platformSha256 is an internal standard-platform capture/hash/observation primitive.
It captures operations before later reads, validates every directly observed value,
revokes before failure assimilation and owns malformed constructor/encoder/crypto/
subtle/digest observations and actual encoder/digest returns. Require synchronous
genuine Uint8Array encoder output before digest. Require actual readable32-byte
ArrayBuffer digest output and emit64 lowercase hex. No custom crypto, truncation,
random identity, caller hash/digest override or fallback on the configured path.
Existing helper test overrides retain their no-arbitrary-property-inspection limit.

Preserve the existing synchronous helper signatures, exact Result shapes, format
predicates, fixed public errors and preimages. Genuine failed captures retain actual
private per-call drains; narrowly alias that bookkeeping to the unchanged helper
failure Result. A synchronous unavailable Result is NOT drain completion. Native
configuration preparation awaits its actual registered failure work before settling.
Concurrent drains stay separate and cannot replace another registered drain.

Box actual fulfillment values inside owned non-thenable boxes. Observe native
Promises intrinsically, including masked-own-then native values delivered by outer
Promises/async wrappers and conforming thenables. Continue actual observed work to
settlement, never merely outer settlement. Carry one seen chain through enclosing
objects and directly observed malformed native/thenable then-fields; refuse revisits
before rereading, with first-settlement semantics and no payload traversal, timer,
iteration truncation or global rejection handler. Pending work stays pending;
rejection reasons remain opaque. Existing C4 provider/derived-Promise ownership,
poisoned-species and invisible-work exclusions remain; no unconditional rescue claim.

The configuration input retainer and actual host's constructor-only invalid/native-
probe refusal use the same drain operation. Set rejectedCapture before assimilation
and retain the actual SDK reservation until the complete observed constructor drain.
A replacement host must receive ownership_conflict meanwhile. Live command paths
are not rewritten. Host import rights are restricted to the drain export only; the
two fingerprint helpers and config module are the only hash/framing consumers.

### Acceptance and limits

Independent corrected CODE accepted the complete actual state after closing own-
field substitution, incomplete nested ownership at all three observed ingress/hash
boundaries, malformed-then cycle starvation and inherited-toJSON preimage redirection.
The last portability correction replaces a scratch absolute test import only.
Actual independent probes are permanent regressions, including genuine installed
SDK/disposable SQLite/synthetic protected store, original Q/M/I changed-key refusal,
fresh module lifetimes, API-origin independence, pre-options provenance/reservation,
separate drains, rejection privacy, exact byte vectors and malformed async returns.
Static-cycle tests transpile actual source into disposable bounded children solely
to prevent harness starvation; no production timeout grants completion. Public/manual
paths and real App regressions remain covered. Final complete root, Web/mobile,
Browser and post-server static checks passed. No new SQL/Swift/physical evidence.

Canonical architecture/persistence/mobile/ADR49/roadmap documents reflect this state.
Actual configuration-value assignment and supported operational changes, native URL
intake, protected operational installation transfer/external-writer exclusion and
physical/hosted/legal/worker/Apple gates remain open. Q3 approved; Q4 deferred to the
concrete device example. This is no Beta, activation, installation or Git permission.

## S5l — Native pending-intent replay ownership before warm URL delivery

**Status: independent DESIGN, corrected CODE and complete local baseline PASS (2026-10-25).** This is the first
vertical slice of native Team-link delivery. The actual App plugin's launch/event
intake follows separately; native Google/M2, callback-domain selection/associations,
actual configuration assignment, operational installation transfer, devices and
release gates remain open. Email OTP needs no authentication callback. Under
MOBILE_APP_MIGRATION §6.5, emailed Team links continue to work on Web while native
domain association is unresolved. This slice grants no domain/capability/signing,
default/flag, installation, real-account, hosted or Git action.

### Starting state, scope and authority

Local implementation remains authorized in /Users/timhofer/curling-release-mvp,
main / HEAD=main=origin/main 382ee40d37605b302c11b6390305857c7e2c3fde;
0 staged,83 modified,147 untracked individual files before this specification.
Preserve every prior change, including the independently accepted S5a–k. Read
AI_DEVELOPMENT_WORKFLOW, ADR25 §22, ADR22's link/Team behavior, S5j and the actual
coordinator/host/Provider/Team UI before editing. Stop on a genuine product conflict.
No new retention or replacement policy, storage/schema/protocol format, identity
admission, SDK, sync manager or Team authority is introduced. Keep the free pilot,
Free/Personal/Team separation, Q1, approved Q3 and deferred Q4 unchanged.

Allowed executable scope: existing identity coordinator's private native-ownership
integration and contained intent mutations; actual native Auth host; genuine native
Tracker registry and erased App composition types; IdentityProvider,
IdentityPendingTeamIntent and TeamsScreen; focused regression tests and exact
architecture guards. Reconcile existing canonical documentation after acceptance.
Do not add a second repository/coordinator or generic application runner. Keep the
public coordinator and ordinary Web behavior/signatures unchanged.

### Required behavior and private ownership

1. Native pending-intent observation runs on the coordinator's existing effect lane,
   alongside capture, denial, recovery and terminal handling. A read failure or
   malformed record is unavailable, never known absence. Observing an intent grants
   no authentication/Profile/Team permission and never claims the access-operation
   slot. No browser fallback, new key or durable receipt is permitted.
2. A private same-document revision distinguishes separate mutations even if
   A→B→A restores byte-identical intent records and the clock has not advanced.
   Every contained intent mutation conservatively revokes prior replay observations
   before invoking its dependency, including partial failure and a no-op settlement;
   do not rely only on capture success or on the timestamp/token bytes. The native
   host is notified after settlement. Web gets no new notification or mutation.
3. The genuine coordinator supplies an optional private replay port to the genuine
   native host. A successful observation retains an immutable validated snapshot and
   zero-argument conditional-discard/recovery closures and private current() bound
   to its original revision, actual foreground/admission generation, live epoch and
   close lifetime. beginTransition revokes synchronously before its first barrier
   await; numeric liveGeneration alone is insufficient. Healthy background operation
   sequencing is not foreground revocation. Repeated unchanged observations reuse
   the same private observation; a new mutation/foreground/epoch or changed fresh
   record/absence retires it permanently, even if identical bytes return later.
   Close irrevocably revokes all observations. This closure is negative correlation,
   never an admission grant or public mutation capability.
4. Conditional discard uses that same effect lane. Prove original revision/epoch
   before entry, after its fresh read and immediately before removal; compare every
   validated intent field against the original snapshot. Stale/replaced is
   superseded and performs no removal; unavailable is blocked; proven absence is
   not_required. A positively issued removal remains factual if close occurs while
   it is in flight. Preserve ADR25's same-page scope and honest external-writer
   limitation; do not claim storage CAS or global ABA detection.
5. Extend only the genuine App composition with subscribeToPendingIntentChanges and
   discardPendingIntent(intent:unknown) and recoverInvitationAccount(intent:unknown).
   Map the exact final frozen public intent
   object, after the host's normal result copying, to the private conditional closure
   in a WeakMap. Authenticate by exact identity without reflecting on candidate
   objects: copies, lookalikes, proxies, foreign hosts/module lifetimes and stale
   observations cannot remove a current record. No private closure, revision,
   repository, adapter or epoch escapes. Memoize unchanged final public views so
   advisory refreshes cannot repeatedly remount the same invitation. Re-prove the
   private current() AFTER normal host copying and immediately before publishing
   or memoizing; never publish a stale observation merely because a later refresh
   is queued. Native recovery refusal returns no begun outcome/identity event.
6. Own observation, conditional mutation and actual subscription callback work under
   the existing host runtime/auxiliary drains and terminal fences. Subscription is
   removed on cleanup; close prevents subsequent callback delivery. Listener failures
   never change durable capture truth; retain observable returned work under the
   established C4 contract without waiting on it inside the coordinator effect lane.
   A callback may unsubscribe/reenter; it must not deadlock the mutation it observed.

The new pending-intent notification channel uses the accepted completion-only boxed
drain for directly observed listener returns, including masked native children from
outer async fulfillment. It does not forward raw fulfillment through authObserve.
Register auxiliary ownership without awaiting it inside the effect lane; keep the
exact genuine disposal Promise exception at EVERY recursively encountered value,
before native observation or reflection. Use only the host’s pure dynamic identity
check against its actual non-null disposal Promise; it may be created reentrantly
during observation. The exclusion is completion-only and conveys no value or
continuation. Hash/config callers retain the observer’s default behavior. Preserve
existing C4 exclusions; do not inspect arbitrary dependency graphs. Check current
Set membership before every invocation, including reentrant removal of a later
listener. Callback rejection changes neither applied capture truth nor auth/store
health. Existing other channels and general live-command observation are unchanged.

Conditional removal uses narrowly bound runtimeWork ownership, preserving its real
applied/blocked result after genuine issuance, including close while its ACK is
pending and its own mutation revision rotation. The existing trackRuntime's post-close
fallback cannot wrap this operation unchanged. Do not change that general wrapper
or readiness behavior. A factual removal result grants no continuation and cannot
optimistically clear Provider projection.

Conditional wrong-account recovery first joins the same lane, re-proves the genuine
observation and complete fresh record, and only then claims the actual recovery
transition INSIDE that section. A capture queued before recovery is therefore
considered first; stale refusal causes no progress, barrier, identity event or
provider call. Release the lane before running the shared actual recovery body;
awaiting the body inside the lane would deadlock its owned sections. Public/Web
recovery keeps its original ordering. Native recovery additionally re-proves the
original intent revision and fresh record before survival marking, using the
already-claimed real context for access ownership. Its own foreground/epoch change
must not revoke that continuation. Perform native survival marking and deletion of
other ordinary intents in ONE owned effect section, so a later capture cannot land
between them. If the requested original link was replaced before marking, preserve
the current link and use the existing intent_state_not_persisted failure of the
begun operation, with zero provider sign-out; do not leave signing_out stranded by
an unowned superseded event. All other already-begun recovery barrier/survival/
failure/completion rules remain unchanged. A later capture after that completed
intent section is a new arrival and is never retroactively deleted by that section.
Re-prove the actual recovery context after the awaited mark ACK before issuing
deleteOtherOrdinaryIntents; the combined section must retain the ownership check
previously supplied by the second inOwnedSection.

### Actual Provider and Team integration

Native Provider subscribes to genuine intent changes, using its existing active
lifetime, projection version and exact ready/state owner to refresh the actual
repository. Unavailable observations preserve the last known projection. A native
startup capture DTO and runtime.loadPendingIntent's lossy null fallback must never
overwrite a genuine correlated projection. Web retains its existing startup/read
path. Native discard uses the exact pending object captured by that Provider facade;
an inactive/replaced facade cannot remove or clear a later intent. Re-read actual
state after conditional completion rather than clearing a newer projection.
Native wrong-account recovery uses the same exact correlated object and private
path; an old invitation action cannot overwrite a newly captured one. No public
Boolean/caller callback is used to authorize the real transition.

The actual invitation's existing native context preparation must detach the old
overlay before a new intent's preview/acceptance UI is used. Old asynchronous results
cannot become the new invitation's state. Continue/Close from the old invitation
cannot delete a replacement. Native Admin Request replay is correlated to the actual
intent object, not a permanently remembered request-id string: a later deliberate
reopening of the same link is permitted. A new native admin intent under the same
ready owner refreshes the existing real Teams inbox; only its successful completed
read may request conditional removal. Failure/interruption preserves the link.
Do not change Web's existing destinations or build a second acceptance surface.

### Acceptance gate

Independent DESIGN before implementation and complete resulting-state CODE review
after implementation, with parent edits/tests frozen during review. Exercise actual
coordinator lane and delayed adapter interleavings, A→B→A identical bytes, frozen
clock, queued capture/discard in both orders, malformed/unreadable/absent, changed
fresh record, failed/no-op mutation, denial tombstone and recovery, close before read
and after issued removal; prove no access slot/admission or new durable authority.
Include foreground BEGIN before its first barrier await, stale post-copy observation,
removal's own revision rotation with close before ACK, and old wrong-account recovery
after B capture (queued capture and byte-identical A→B→A), plus a new capture before
native survival marking and one queued while marking is pending.
Use real dormant App + installed SDK + disposable SQLite and synthetic transport/
protected edges for same-ready-owner notification, old overlay completion, admin
inbox race/failure/reopen, stale facade and unmount/StrictMode. Verify forged/copy/
proxy/foreign membership refusal before input reflection, listener reentrancy and
pending callback drain, and no Web/default regressions. Exact architecture importers
and no new runtime/SDK/repository/UI escape are mandatory.

After independent CODE acceptance: root tests, tsc, both lints, Web build, mobile
verify and all Playwright cases; stop the test server before final static checks.
Record exact counts only in TESTFLIGHT_READINESS and actual remaining gates. Do not
rerun SQL/Swift for unchanged code or claim physical/native URL delivery evidence.
Leave all changes unstaged/uncommitted, preserve secrets (.env.local must never be
inspected), reconcile repository/Vault progress with actual results, and continue
the separately reviewed native launch/event intake afterwards.

## S5m — Dormant native App launch/event intake for Team links

**Status: independently accepted DESIGN and corrected CODE; complete local baseline accepted on25 October2026.**
Continue after accepted S5l in the same local checkout/main; all refs
382ee40d37605b302c11b6390305857c7e2c3fde,0 staged/83 modified/152 untracked.
Preserve the complete dirty tree. Read AI_DEVELOPMENT_WORKFLOW, ADR22/25, S5j–l,
MOBILE_APP_MIGRATION §§6.5–6.6 and actual coordinator/host/App composition before
editing. Audit first; stop for a genuine product conflict. The local implementation
request and expressly authorized single independent reviewer remain applicable.

This slice supplies actual Capacitor App getLaunchUrl/appUrlOpen plumbing to the
existing genuine sporting identity host and actual pending-intent path. It remains
explicitly dormant: no configured Team domain is selected or assigned, no defaults,
flags, production root, associations/capabilities, signing/install, hosted or Git
mutation. Email OTP is the first native Beta sign-in; Google/M2 callbacks remain
out of scope. Existing Free pilot/no billing, Free/Personal/Team separation, Q1/Q3,
deferred Q4, data/schema/protocol and server authorization remain unchanged.
Under §6.5, Team emails may continue opening Web until native association is accepted.
API origin is not automatically a Team-link destination. Operational installation
transfer and external-writer exclusion follow separately.

### Allowed boundary and explicit entry

Add one private native Team-link delivery module, imported only by the existing
actual supabaseAuthService host; it has no SDK/store/repository/React access. Its
capture callback is supplied privately by that host from its actual coordinator.
Extend only the existing sporting/configured host options with optional explicit
Team delivery: a primitive canonical bare HTTPS origin and optionally a synthetic
App port for tests. Ordinary bootstrap/manual/Web paths and omitted options retain
their behavior. Capture supplied dependencies under the existing synchronous SDK
reservation, with the existing C4 refusal/drain rules. Invalid origin/dependency
fails before any plugin/store/HTTP I/O. No environment/browser/API-origin fallback.

The default port uses installed @capacitor/app8.1.1 App and verifies a native
Capacitor context; it must not silently use AppWeb. Load it only at an explicitly
opted-in host start, never from import/render/default startup. No real option value
is assigned in this slice. Preserve existing migration and identity ownership.
Build the actual coordinator/runtime first, then start its source before returning
that runtime to React. The source's entry invokes addListener(appUrlOpen,callback)
BEFORE getLaunchUrl and BEFORE its first source await. Own both operations even
when one fails; synchronous throw/close prevents any later unissued work. Dynamic
module loading may precede this source entry; do not claim earlier OS registration.
The installed native App retains URL events until consumed. The public CoreJS
addListener handle establishes observable JS registration-request completion along
its callback-ID path, not an independent native registration ACK. Physical listener
registration, delivery and ordering remain device gates. Verify supported native
context AND App availability before invoking methods; refuse a Web fallback.
Capture roots, each callable and its synchronous result sequentially under the
original lifetime. Require exact primitive true for both context proofs before
reading the next dependency. Retire initialization before draining any malformed
or asynchronously returned directly observed dependency; do not promote its eventual
fulfillment to a synchronous proof. Preserve prior observed work when a later getter
throws, and retain all such work through close and SDK reservation release. Repeated host start joins the same source lifetime,
not another listener or launch request.

Observable source initialization failure returns the existing host waiting shape
with a new fixed team_link_unavailable code, withholding runtime publication. It
does not assert authentication/identity/store corruption. That source-initialization
failure is sticky; another start does not silently register a retry. Close and a
new genuine host are required after proved cleanup. Existing no-option starts stay
unchanged. Project this source waiting code only while underlying host health is
otherwise healthy; never replace an actual Pair/Identity fault or identityFailed fact.

Separate actual initial capture refusal from source initialization failure. While
the real Pair remains healthy, an otherwise valid initial link's refused capture
must NOT withhold the runtime or make its normal identity/authentication recovery
unreachable. The existing repository refuses capture with persisted denial-cleanup
debt; only the existing normal identity continuation/settleIntentBeforeReady can
legitimately settle that debt. The source never bypasses, clears or settles it.
Publish truthful advisory capture-failure status, with no saved/absent/invalid claim,
and allow the actual Provider/coordinator startup and authentication path to run.
A narrow native-only not_captured initial-delivery outcome can extend the existing
DeepLinkCaptureOutcome and is recognized only under the genuine opt-in native
composition; ordinary Web/no-source blocked behavior remains. This avoids feeding
blocked into the existing reload-only intent_state_not_persisted UI and stranding
signed-out debt recovery. Do not invent an automatic recapture/retry; reopening a
link after normal recovery is a fresh delivery. No outcome grants a ready state.

Link-level rejection adds no identity invalidation. The new source uses the existing
checked clock validation/identityFailed policy with a narrow internal completion
retainer: malformed directly observed clock work is owned through the boxed drain,
with recursive dynamic exclusion of exact genuine host disposal. Revoke before
assimilation. Never await an asynchronous clock result as a timestamp, route its
raw fulfillment through authObserve, or turn a clock fault into an advisory-only
capture refusal. Legacy no-source clock and notification paths retain their behavior.
Existing genuine Domain, Protocol and Credential faults retain their original
classification, synchronous Pair/Tracker/App revocation and Q1/training vetoes. A status notice must not hide
underlying host health or promise training availability after actual storage faults.

### Classification, bootstrap ordering and actual capture

Read only the event/launch result's own data url field, once, without traversing
unrelated iOS metadata. Accept installed native no-launch shapes undefined or an
empty plain record as absence; a missing url on an event is invalid, not absence.
Require inert supported record shape and refuse native Promise/lookalike/accessor
results before treating them as data. Later events after close are inert BEFORE any
payload reflection. Raw URLs and exception/rejection reasons never escape, log,
serialize, enter storage or form a replay ledger. Drop the raw URL reference after
synchronous classification; retain only validated typed pending intent while needed.

Accept only primitive absolute HTTPS URLs whose exact origin equals the explicit
canonical origin and pathname is root, with no userinfo or fragment. Exclude mixed
OAuth-owned query fields (code/error/error_code/error_description/sb_flow_id), so a
Team link never reaches or finalizes an auth capture cell. Reject duplicate owned
Team parameters rather than selecting an ambiguous first value. Apply the existing
selectDeepLinkIntent validators and admin-request-over-invitation precedence; do
not repair tokens/UUIDs or change server eligibility. Unrelated/invalid delivery is
ignored and cannot suppress a valid launch URL or clear a prior failure notice.
No browser URL/history read/rewrite, navigation or auth exchange occurs.

Both launch-only and event-only delivery work, including an event after empty launch.
An eligible event observed while the launch snapshot is unresolved supersedes that
older launch snapshot, even if event persistence is pending or fails: never replace
new event B with late launch A. Foreign/invalid events do not suppress launch A.
Create private synchronous classification-frame ownership before any event payload
reflection or clock call. A later positively eligible nested event retires older
still-classifying frames, even when its persistence later refuses; those older
frames cannot issue capture or publish status afterward. Invalid nested events
retire nothing. Recheck the original frame before further foreign reads/calls while
still draining directly observed work. Keep only transient non-secret frame metadata.
The bootstrap readiness barrier includes registration, launch and already-observed
valid captures through the explicit initial barrier; later deliveries are warm.
Each accepted intent reaches the SAME existing coordinator capture/effect lane and
repository, so denial debt and close checks stay authoritative. No direct storage,
second repository, foreground transition, Profile/Team grant or public capture port.

Concurrent exact typed duplicates may join the same still-pending capture; afterward
a new event is a new arrival under existing policy, including reopening the same
link after consumption. Do not introduce a permanent raw/token dedup set or bypass
cleanup debt/intent revision with an out-of-lane duplicate read. Initial launch/event
coalescing must not consume a replacement or remount through a stale completion.
Do not claim global delivery IDs or indistinguishable user/OS event discrimination.

### Complete observed work and terminal ownership

Use the accepted boxed observation mechanism, not raw fulfillment forwarding through
authObserve. A narrowly internal value-bearing wrapper over that same observer may
return its frozen null-prototype value box only to the new source; host imports
remain drain-only and hash/config defaults stay unchanged. Exact import/usage guards
must enforce this. Carry the host's dynamic exact already-owned genuine-disposal
exception through all recursive observation before reflection. A private per-
observation exclusion indication (or equivalent closed result) distinguishes skipped
already-owned work from an actual fulfilled value, including genuine undefined.
It cannot mean absent launch data, a registration handle or positive void remove
completion. A remove observation encountering genuine host disposal at ANY depth
never awaits it, reports cleanup_unconfirmed and retains reservation. Real fulfilled
undefined removal retains its ordinary observable completion. Hash/config default
callers and completion-only callers keep their accepted behavior. Re-prove the genuine source/host lifetime before
using observed data or issuing capture. Preserve C4 native/masked/thenable/malformed
then-field ownership, first settlement, cycle refusal and opaque reasons. No payload
search, global rejection handler, timeout-based release or invisible-graph rescue.

The genuine host owns the source initialization, every issued capture, registration,
launch and observable remove work through disposal. Close synchronously retires the
source and callback before any await or later input read. A registration handle
arriving after close is still removed exactly once using its privately captured
remove operation; this cleanup-only ownership grants no delivery continuation.
Retain all issued work to settlement and never await host disposal from its own
source drain. Pending work holds SDK reservation; observed cleanup failure reports
cleanup_unconfirmed and keeps reservation. Actual positive capture ACK remains a
fact, but after terminal no public success/projection is published.

Installed CoreJS's native handle.remove awaits registration but invokes removeListener
WITHOUT awaiting the underlying native result. Therefore its observable settlement
is NOT proof of physical unsubscribe ACK; native callback lifetime is permanently
inert locally, while actual unsubscription/provider-internal derived work remains a
stated C4/device limitation. Do not add removeAllListeners (Brower shares App), patch
the plugin, manufacture an ACK or claim hidden provider rejection ownership.

### Honest native-only presentation

Add a value-free frozen/stable Team-delivery status observation/subscription only to
the genuine native App composition; omitted source is inactive. The original native
application wrapper can render a small status notice above the actual Provider tree,
so a warm failed capture is visible without closing a healthy identity/training gate.
A fixed message says that a Team link could not be saved and can be opened again;
never claim that the new link was kept. No URL/token/provider reason or implementation
mechanic enters UI. Native source status is advisory, never admission authority.

Only the latest eligible arrival may publish its capture failure/success status;
older completions cannot clear a newer failure or overwrite a newer result. Foreign
or invalid deliveries do not clear status. A subsequent actually applied capture
clears its own current failure. Subscription cleanup, actual membership and terminal
callback fences use S5l's completion-only ownership behavior; do not broaden existing
Auth notification channels. The no-source/default Web/mobile tree and copy remain.

### Acceptance and continuation

Independent DESIGN before code; parent repository writes/tests frozen during review.
Then implement only host/source, minimal shared observer export, erased composition
and registry, narrow native-only initial-delivery outcome/Provider branch, existing
native App wrapper/status UI, exact architecture tests and
focused actual-host/App regressions. No other architecture/API rewrite. Inspect the
complete resulting state and consolidate all confirmed defects before correction.

Exercise launch-only/event-only/empty-then-event/early callback before registration
ACK, late launch A versus event B (pending/failed), foreign/invalid event versus valid
launch, same in-flight duplicate and deliberate same-id reopening; root/origin/path/
userinfo/fragment/duplicate/mixed OAuth rejection and existing precedence. Cover
source-initialization failure's sticky waiting and actual initial capture refusal
with genuine persisted denial-cleanup debt: capture stays refused, normal startup/
authentication/debt settlement remains reachable, no false capture/ready result.
Separately exercise healthy warm refusal and a genuine SQL/Protocol failure with
original revocation/training vetoes, older failure/success ordering, StrictMode/
unmount and actual invitation/
admin-inbox replacement over the installed SDK/disposable SQLite. No callback cells,
exchange, browser history or new grants. Verify lifecycle reentrancy before each
later operation, delayed registration/launch/capture/remove and close, masked/nested
pending/rejection/cycles, genuine own-disposal at all encountered depths, late handle
cleanup exactly once, no later payload reflection, honest cleanup failure/reservation
and fresh host after positive cleanup. For root/native-child/thenable-child/malformed-
then-field own-disposal exclusion prove no value/absence/cleanup ACK is fabricated;
retain genuine successful-undefined removal controls. Include plugin-faithful native empty result and
remove's observable-vs-physical limitation; no device claim from synthetic adapters.

After corrected independent CODE PASS run full root with the temporary scratch path,
Web/mobile builds and all Playwright cases using the existing cache. Verify server
stop before TypeScript/both lints/diffcheck. Preserve all changes unstaged/uncommitted;
never inspect .env.local or actual environment values. Reconcile canonical technical
status and Vault with exact checks only after they complete. Continue protected
operational transfer/exclusion; actual config/domain, devices and release remain gated.

## S6a — Standard SHA-256 binding for an explicit installation-archive V3

**Status: corrected DESIGN and complete CODE independently accepted; full local baseline passed (2026-10-25).** S5m
CODE and full local acceptance preceded this stage. This bounded prerequisite closes the injected-only
digest-contract gap; it is NOT the protected operational transfer or a backup feature.
Read the workflow, ADR49, adopted S2 C1–C7 and S4a, actual codec/inventory/platform
observer and architecture guards. Preserve the entire dirty checkout/main. Record
the actual Git state before implementation. No Git or environment-value inspection.

### Scope and authority

Keep every V1/V2 API, injected format, validation, wire/preimage and test behavior
unchanged. They remain inactive test contracts and must not acquire a production
binding under their old identifiers. Add explicit V3 encode/decode entrypoints in one new private
installationTransferV3 module over the actual codec, with a closed fingerprint contract "sha256-transfer-bytes-v1".
V3 uses the existing V2 inventory and archive validation, including deletion guards,
with the same inventory-contract identifier. Its outer source snapshot schemaVersion
and wire formatVersion are 3; the independently versioned nested listing remains
schemaVersion 1. State this explicitly rather than silently coercing caller input.
It has the same sensitive-invitation refusal and never reads/copies provider values
or protected controls. Do not add a new secret-bearing archive representation.

The only allowed source changes are that private standard-binding wrapper, the
existing installationTransferCodec core and minimal internal shared-platform SHA
module; narrow architecture guards, a focused
new standard-byte-hash suite and a V3 archive suite; canonical status references.
No new store, repository, public app/UI entry, clock, SDK, native bridge, dependency,
file/share/clipboard delivery, auth, source mutation, activation or operational grant.

V3 public encode/decode accept only their primitive JSON strings. They expose no
fingerprint/digest override or externally supplied provider. Capture the real standard
platform SHA-256 operation lazily once per admitted encode/decode invocation, after
the existing deterministic PRE-HASH admission: primitive type/length, bounded syntax,
schema/version/routing, complete inventory/raw validation and all relevant size/work/
preimage bounds. Failures detected in those stages do not inspect platform
dependencies or invoke hashing. Cryptographic mismatch and late noncanonical-wire
refusal may follow actual standard-platform hashing. Preserve the existing decode
order: validated values, sorted value hashes, package hash, canonical-wire comparison,
success; do not move canonical comparison earlier or alter first-error precedence.
No eager digest/import-time work. A missing,
malformed or failed engine refuses with fixed value-free errors and keeps observed
work owned; it does not fall back to injected, JS, identity or weak hashing.

### Exact bytes and platform boundary

Extend the existing internal platform primitive with a narrowly imported byte SHA-256
capture, used only by the codec. Preserve its existing string hash/config/default
callers and observation semantics. The new path hashes the codec's existing bounded
typed binary preimage directly, not UTF-8 text, JSON, hex or base64 of those bytes.
Use the existing purpose domains "curling-transfer-value/v3" and
"curling-transfer-package/v3"; retain all C4 typed framing/UTF-16 code-unit and
root-digest-omission rules. Unpaired surrogate code units are preserved. Standard
SHA-256 returns exactly 32 bytes and canonical lower-case 64-hex output.

Capture roots/callables sequentially, preserving each original receiver and invoking
through the captured intrinsic; validate before reading the next foreign dependency.
Retire failure before assimilation; preserve all directly observed malformed async
dependencies even when a later getter throws. Capture failures own their full drain,
which V3 awaits before returning a settled refusal. Use the accepted private boxed
observer for digest completions, so masked native children/thenables/malformed
then-fields remain owned through operation settlement, first-settlement and cycle
rules. Never forward raw native fulfillment through ordinary Promise resolution.
Thrown/rejected reasons remain opaque. No global handler, hidden-graph rescue or
timeout-generated success. The accepted C4 cooperation/poisoned-species limitation
remains explicit. The value-bearing export introduced for S5m remains source-only;
reuse private observation inside its existing module instead of broadening it.

Keep input preimages private/owned and stable through the issued hash; accept only the
codec's ordinary Uint8Array buffer under a proved byte brand. Avoid arbitrary coercion,
JSON hooks, iterators or caller-controlled call/apply properties. Validate the actual
digest's ArrayBuffer brand/32-byte length and no detached/malformed substitute before
encoding hex. Genuine pending digest work remains pending and owned. No default
TextEncoder dependency is necessary for byte hashing; accepted string callers retain
their own TextEncoder requirements.

### Codec integration and honest outcomes

Keep the V1/V2 pure import graph free of the platform binding. The pure codec may
export one narrowly guarded frozen V3-internals surface, imported only by the new
wrapper, to pass its privately owned standard-byte provider into the V3 profile.
That core mechanism is not a public operational encode/decode entrypoint, conveys
no authority and must have exact importer/usage guards. No platform import is added
to the pure core. Public V3 entrypoints offer no dependency/provider override.

Reuse the actual existing scanner, canonicalizer, sorted slot evaluation, bounds,
typed preimage builder and V2 archive validators via an explicit V3 CodecProfile.
Do not clone their algorithm into a second codec or weaken limits. V3 root,
fingerprint/inventory contract and source/destination bundle IDs are exact; cross-
version input must refuse rather than reinterpret. Snapshot and listing versions are
checked independently. Hash every present raw and then the package before producing
wire; decode verifies all raw and package digests plus canonical wire before success.
A late engine failure yields no partial package or validated result.

A successful V3 result still means envelope integrity/raw preservation only:
semanticStatus remains not_evaluated. Hashes establish integrity, not sender
authenticity, confidentiality, source freeze, freshness, independent receipts,
reauthentication or permission to mount/publish/rollback. Existing refusal-only
Decision stays unchanged and every mayIssue/mayPublish/mayMount flag remains false.
No application production importer or delivery caller is added. V3 remains private
until the later independently reviewed protected transport, actual C6 semantic
interpretation, C8/C9/C10 mapping and external-writer/device gates exist.

### Verification and acceptance

Independent DESIGN review before code. Freeze parent writes/tests during reviews;
reuse the explicitly authorized reviewer. Then focused implementation and corrected
independent full CODE review before a new final baseline.

Use independent Node standard crypto references/known answers to establish SHA-256
over the exact binary preimages, with actual platform method counters. Exercise
empty/nonempty archives, every V2 deletion-control shape, valid mixed profile slots,
non-BMP/unpaired-surrogate raw code units and tampering of raw/value/package/contract/
version/canonical wire. V1/V2 golden/injected tests stay unchanged; decoder cross-
version negatives and schemaVersion3/listingVersion1 controls are mandatory.
Prove zero platform capture/digest calls for deterministic pre-hash admission
failures. A structurally valid noncanonical V3 wire with correct digests must be
hashed and then refused as noncanonical_wire. Preserve deterministic mismatch/engine-
failure precedence and unchanged V1/V2 behavior.

Cover missing/malformed crypto/subtle/digest roots/functions, strict receivers,
reentrant getter retirement and an earlier observed masked pending dependency before
a later getter could throw. Exercise pending/rejected native/async masked children,
thenables and malformed then fields; no unhandled errors or early operation refusal.
Wrong-length/non-ArrayBuffer/detached digest results and cycle handling must refuse.
Positive real digest and absent TextEncoder byte-path controls must use actual engine
calls. Preserve the original string-hash/config/credential/domain suites. Do not
claim arbitrary input properties were safely ignored without a negative counter.

Run focused V3/platform/S2/V2/architecture suites, TypeScript/lint/diff, independent
CODE, then full root with temporary scratch path, Web/mobile builds, all Playwright,
positive server shutdown and post-server static checks. Update canonical status and
Vault only with actual results. SQL/Swift unchanged do not acquire new evidence.
Continue actual semantic/protected operational transfer; this is no Beta/cutover,
original-installation, hosted or release approval. Free pilot/Free/Personal/Team,
Q1/Q3 and deferred Q4 are unchanged.


### S6a actual acceptance and limits

Implemented private standard-bound V3 wrapper, explicit pure-core V3 profile, internal
byte-SHA capture, exact architecture guards and two new suites (30 byte/29 archive
cases). V1/V2 contracts and existing string-hash/default callers remain unchanged.
Independent complete CODE found no material defects:10 files/402 PASS,7 configuration/
host/observer files/84 PASS and13 own probes PASS. Logs:
/tmp/curling-independent-review/s6a-{focused-scratch,config-regressions,own}.log.
Initial independent six scratch EPERM failures remain recorded separately; the
intended temporary scratch rerun passed all402. Parent focus30 files/609 PASS,
then2 new suites/59 PASS after four additional boundary controls. Initial syntax,
type and size-fixture errors were corrected; original red logs are retained.

Final actual baseline:361 root files/7839 tests PASS with temporary scratch and
maxWorkers4;139/139 Playwright PASS; Web build PASS; mobile verify10 files/276 tests
plus type/build PASS; positive ECONNREFUSED test-server shutdown on127.0.0.1:3100;
post-server TypeScript, root/mobile ESLint and diffcheck PASS. Logs:
/tmp/curling-s6a-{root,web,mobile,e2e,server-stop,types,lint,mobile-lint}-final.log.
No unhandled errors; known chart/chunk warnings nonfatal. SQL/Swift unchanged and
receive no new evidence. Start0 staged/83 modified/166 untracked; final0/83/169,
main/HEAD/main/origin/main382ee40d37605b302c11b6390305857c7e2c3fde unchanged.
No Git mutation, original-installation operation, actual configuration assignment,
native activation, signing/install, hosted transfer or distribution.

The standard-digest gap is closed locally. Actual C6 domain/historical interpretation,
protected operational transfer/external-writer exclusion, actual configuration/device/
hosted/legal/worker/Apple gates and Q4 remain open. No Beta/cutover approval.


## S6b — Actual domain interpretation of a private V3 archive

**Status: initial/corrected DESIGN and complete corrected CODE independently accepted; full local baseline passed (2026-10-25).**

The complete candidate was checked against the actual repositories without edits or
tests; no material design blocker or new product decision was found. Start main,
HEAD/local main/origin main382ee40d37605b302c11b6390305857c7e2c3fde,0 staged/83 modified/169
untracked. Preserve all changes; no Git mutation or environment values. The already
authorised reviewer remains the sole separate read-only reviewer.

### Purpose and scope

The actual V3 binding establishes integrity/raw preservation, not C6 interpretation.
Add one private `src/lib/persistence/installationTransferSemantics.ts`, its focused
test, exact architecture/import guards and canonical status. No app caller. Use the
actual domain repository factories, not duplicate domain migrations, as the reader.
The stage covers the complete 13 sporting slots per declared Profile. Historical
catalog/delivery readiness remains a separately named unevaluated prerequisite: no
`supported_usable`, publish/mount/rollback or ready-to-import result exists here.

Public entry `evaluateInstallationTransferDomainsV3(wire: unknown)` accepts only
the primitive canonical V3 wire. It invokes the actual standard-bound V3 decoder
itself; no externally supplied decoded object, loader, adapter, digest, readiness,
permission or dependency override. On decoder refusal, return its fixed code without
inspecting the input otherwise. Only after successful decode use its privately owned
frozen envelope. Input exceptions/reasons stay opaque. Extra arguments are ignored.
Do not change V3/V2/V1 formats, pure graph, codec validation, decoder order or limits.

No new secret representation or archive identity replay. Never call identity loaders,
retirement/export/sync-manager/auth/native/SDK constructors. The archive's identity,
legacy, provider exclusions and deletion guards stay inert; they cannot mint Profile
namespaces or a grant. Only `envelope.profiles` and exact sporting item metadata seed
the evaluator. Retain packageDigest as correlation, not authority/authenticity/freshness.

### Exact disposable overlay and actual reads

For each declared Profile construct a private immutable map of all 13 FULL physical
keys and their raw string or explicit null. Construct a separate private working map
initially containing exactly that map. Immutable archive/source strings never change.
Never expose maps, raw data, repositories, handles, adapter, audit values or loaded
domain objects. Pass the private physical adapter through the actual
createProfileScopedSportingRepositories; construct the actual sync repository through
the actual createProfileScopedSportingStorageAdapter. No native host or currentProfile
pointer. All constructor arguments are privately owned primitives/objects.

Run actual loadCurrent, loadHistory, historyFilters.load, assessment.loadState,
trainingPlans.loadPlans, accuracyToleranceProfiles.load, smartRandomProfiles.load,
the three assessment preference loads, and syncState.load in a deterministic order.
These jointly cover every exact key; Assessment is one joint three-key group.
Return local overlay ACKs only after actual working-map set/remove. Every get/set/
remove attempt is audited synchronously before processing; record exact key/value,
order, old/new value and read-after-write internally. Unknown key, wrong Profile,
nonprimitive key/value or out-of-inventory access latches evaluation failure and
returns fixed adapter failure without touching any external store. The actual
factories expose only StorageAdapter, but keep a real audited remove on the private
overlay to prove a future accidental removal is refused by semantic write policy.
No adapter injection or test-only production factory surface.

All ordinary loads must leave the overlay untouched. Only the reviewed Assessment
load recoveries below may write, and only their exact bytes/keys/order. No blanket
write denial followed by acceptance of loader fallback. Throw/reject/read_failed,
present-to-absent, default, quarantine, drop, renumber, changed content, unexpected
audit or unsupported schema makes that domain preserved_unusable. Continue examining
other domains/Profiles for a complete value-free report after ordinary domain failure;
do not continue a poisoned overlay after unknown-key/foreign access. No partial
positive status for a Profile with any unusable group. Source is still preserved.

### Structured comparison and work bounds

All raw JSON domains require duplicate-free, finite JSON, bounded before allocation.
Reuse ONLY the existing effect-free parseBoundedJson from providerCredentialContract
(no credential parser/validator); explicitly allow this one named consumer in guards.
Do not extract/rewrite its old algorithm or weaken its existing users. Pass maximum
1,048,576 raw/string units, retain existing depth32/nodes65536/member4096/name128
admission. These are conservative interpretation admission limits, NOT new format or
retention limits. Exceeding them preserves the archive but gives preserved_unusable.
Its failures are caught opaquely; never project credential messages or raw values.
Apply a checked aggregate 262,144 parsed-node budget across the whole operation;
charge every parsed domain tree including Assessment halves and legacy shadow.
No declared count allocates; no chunking, truncation, fallback parser or partial data.
Raw strings are already bounded by actual V3 admission. No claim of streaming input
or measured heap limit. Actual loaders may parse bounded strings again normally.

Compare fully owned supported trees recursively with finite Object.is scalar
comparison, ordered arrays and exact own member sets, ignoring only undefined-valued
members in loader-produced objects (JSON omission). Object member order is immaterial
for interpretation alone; raw code units and encoded payload strings remain exact.
Never compare just IDs/counts or treat JSON stringify as a semantic oracle. No trim,
clamp, coercion, sorting members of arrays or unknown-field loss. No inherited
toJSON-based framing in our comparator. Existing actual loader behavior is unchanged.

### Exact domains and named interpretations

1. Current Session: actual repository plus compare every raw field with returned
Session. Both absent means absent; present must be valid record and no missing/minted
IDs or new legacy defaults. The sole admitted lifecycle delta is existing running
captureSequence -> paused, replacing pausedAt with the actual loader's finite parsed
timestamp. Compare ALL remaining capture sequence, Session, Block, Shot, plan,
measurement, snapshot, notes and execution fields exactly. Report recovery_required
with reason capture_paused. No arm/resume/listener. A missing/discarded sequence or
other repair is unusable. This check applies even to old time-only Sessions that
the repository ordinarily repairs. Session History: actual load and exact complete
ordered array equality only, no running recovery or generated members/IDs.

2. Filters: actual sanitizer output must equal the entire supported parsed raw; any
default, dropped/changed field or malformed JSON is unusable. True absence distinct.

3. Assessment group: parse/validate every present split/combined source, even an
inert combined shadow, with schema1 exact expected root keys. Use actual repository
output and compare every run/attempt/protocol/snapshot/notes field; quarantine false.
History is a real array with no duplicate identity/drop; all history runs terminal.
Full split roots are {schemaVersion:1,currentRun?} and {schemaVersion:1,history};
combined is {schemaVersion:1,currentRun?,history}. Unknown root/member loss refuses.
All absent is absent. Full split authoritative; a present shadow must itself be
valid/lossless but need not equal split current state (ordinary newer writes leave
the legacy shadow stale). For combined-only or partial split, retain the actual
repository's exact-existing-half BYTE match, not a relaxed comparator. Only normal
history-first creation of missing history then missing draft is allowed; no source
rewrite. Validate exact bytes from returned lossless state, complete audited writes
and any read-after-write. Full split may clear one exact terminal duplicate current
only when identical existing history already preserves it, with the actual one
draft-clear write; report assessment_recovery. Reject mixed split+duplicate paths
that require other ordering/defaults/repair; do not fix existing repository policy.
Any allowed write means recovery_required, never ordinary writable permission.

4. Training Plans: actual load, schema1 or2 root exactly {schemaVersion,plans}, exact
ordered plan and step IDs/content. Schema2 must compare to {schemaVersion:2,plans:
actualOutput} without any delta. Schema1 permits only root/plan schemaVersion1->2,
legacy release-step absent type->release-timing and the existing immutable Release
Time snapshot insertion, never overwrite a source snapshot (present must match).
Obtain that snapshot by actual catalog lookup using RELEASE_TIME_VERSION_ID; no
current visible-list substitution for an already named historical snapshot. All
configuration, completion, handles, names, timestamps, IDs and unknown fields must
otherwise match; absent original required fields cannot be accepted from defaults.
Report schema_interpretation for this versioned conversion, raw untouched. Use actual
isPlanExecutable separately and report library executable/all vs readable_only;
readable valid configurations are not silently repaired to become executable.

5. Tolerance Profiles: schema2 exact deep equality to actual output. Schema1 permits
ONLY schema1->2 and each original numeric onTarget/acceptable pair becoming explicit
quantity=time plus symmetric lower/upper bands with those exact same numbers. Keep
every ID/name/time/default/order. Extra/malformed fields or trimmed names refuse.
Use actual migration through the actual repository, no copied migration algorithm.

6. Smart Random Profiles: schema1 exact deep equality to actual output; every range,
mode, ID, name, default and timestamp, no trimming/clamping/drop. Unknown schema fails.

7. Preferences: showIntro raw exactly true/false; threshold preset exactly standard/
tight/custom; custom threshold raw must be exact duplicate-free finite supported
{onTarget:number,acceptable:number}, actual preference load must equal it. Empty raw
is preserved_unusable, never absent. Do not add new sporting numeric policy beyond
the actual loader's finite numeric shape. Null storage remains real absence.

8. Whole sync: actual load schemas1..6; compare complete entries/payload strings/
hashes/status/tombstones/relations/cache/draft/original/current/revisions/privateNote
with exactly transformed source. Versioned root evolution may add ONLY the actual
empty fields introduced later (v1 teamEntries=[], v1/2 eligibility=[], v1..3
activeDraft=null, v1..4 teamResults=[]), and root version6. Any earlier schema carrying
an unknown future root field refuses rather than overwriting it. Schema5 owned
records may add ONLY originalResult=source.result, postCompletionRevisions=[],
isVoided=false, exactly as actual parser; an already supplied conflicting/unknown
field cannot be silently overwritten. Schema6 no conversion. Actual private parser
must preserve all contents beyond these deltas. active draft recorderProfileId and
owned result athleteProfileId equal the Profile namespace; other roster/recordedBy/
participant/bundle athletes may legitimately differ. Never use personal-export
projection, rebuild results from payloads or treat cached permissions as authority.

Historical catalogs/delivery are NOT evaluated by this stage beyond what the actual
loaders themselves already verify against their actual catalog. Report explicitly
historicalStatus=not_evaluated. Do not claim superseded assets exist physically or
all historical protocols/snapshots are complete. Later actual C6 historical work is
still necessary, with complete catalog and delivery inventory, never a current-list
substitute. Source catalog label alone proves nothing.

### Result, isolation and evidence

Return only deeply frozen data: schemaVersion1, correlation packageDigest, per-Profile
index (not new namespaces), per closed domain status (absent/preserved_candidate/
recovery_required/preserved_unusable), closed recovery labels, Plans executable flag,
aggregate domainStatus and historicalStatus=not_evaluated. Every result has
mayIssue=false/mayPublish=false/mayMount=false; no operational authority or handles.
Use only fixed error codes for evaluation failure. No raw strings, names, notes,
payloads, keychain/config values or arbitrary thrown reasons in reports/diagnostics.
Do not change the existing refusal-only Decision or codec semanticStatus.

Architecture: evaluator has no app/mobile/production caller. It may import only V3
decode, the actual profile-scoped factories/key constants, actual sync factory/key,
actual plan executability, actual immutable catalog/Release ID lookup, effect-free
bounded JSON parser and types. Exact symbol guard allows decode only in wrapper and
this evaluator; no encode consumer. Preserve pure codec V3-internals exclusivity and
S2 graph. No imports of native runtime/SQLite/secure store/identity/SDK/UI/network,
and no global storage/native/transport access in new code.

Tests must use real standard-bound V3 packages/engine and actual repository behavior,
forwarding real factory spies with positive counters, never only invented DTOs or
all-mocked loaders. Prove all13 keys/11 loads, two-Profile isolation, absent/empty
distinctions, every named supported schema interpretation/recovery, readable-only
plan, notes/Unicode/identity/content preservation, positive no-source-I/O counters.
Build adversarial matrix: malformed/duplicate/escaped duplicate/nonfinite/too-deep/
aggregate-budget raw; future schema, unknown fields, actual trim/drop/quarantine/
renumber/default; capture beyond allowed delta; exact/partial/split conflict writes;
cloud schema1..6 full/team/tombstone/private-note/foreign owner vs legit roster cases;
wrong/out-of-Profile access, unexpected set/remove, read-after-write, loader throw/
reject/fallback. Private failure probes may mock actual module factory ONLY to test
negative adapter/audit behavior; no production override is added. Check concurrent
evaluations have separate overlays. Missing/failed/pending SHA uses actual V3 owner
and cannot yield early usable result. Invalid V3 never calls a domain factory.

After implementation run focused actual-loader/V3/architecture/shared tests, TS/lint/
diff, then independent whole CODE, then full root, Web/mobile, Playwright, positive
server stop and post-server statics. New canonical/vault claims only from actual
results. Continue historical C6 and protected C8/C9/C10 operational transfer/external
writers. No actual config assignment, activation/default, signing/install, original
data alteration, hosted upload, Git or release changes. Free pilot/Free/Personal/Team,
Q1/Q3 and unapproved Q4 remain exactly as confirmed.


### S6b consolidated correction — independently accepted DESIGN

Only the three independently reproduced families; no new product decision. Keep
actual domain repositories/formats/grants/defaults unchanged. Preserve dirty main,
all refs382ee40,0 staged83modified171untracked. Read workflow and canonical S6b.
Only evaluator, its tests/exact guard/docs and adopted independent probes may change.

1. Add one private independent owned-JSON writer in the evaluator. Its input is
already losslessly compared owned loader/state data, never public caller objects.
Capture the ordinary intrinsic JSON.stringify once; use it ONLY for primitive
string/finite-number/Boolean/null leaves (so no inherited toJSON lookup). Containers
are emitted manually in their existing Object.keys order and array index order;
do not call JSON.stringify on objects/arrays or invoke toJSON/iterators. Omit own
undefined object fields; undefined array positions become null like ordinary JSON.
Reject other unsupported types, accessors, cycles, depth>32, >262144 walked nodes
or >1048576 output UTF16 units before avoidable further output allocation. Use a
bounded append/chunks writer; no generic full stringify before bounds. These are
conservative interpretation/output bounds, not altered format or retention rules.
Use data descriptors for own container fields; preserve exact source property order
required by partial split byte matching. No root mutation, global hook suppression,
new public seam, export, I/O, clock or JSON hooks. Numeric negative zero, if reached,
is emitted as -0 (not silently changed to0); a real loader write that loses it then
fails comparison and is unusable. Ordinary finite values retain intrinsic JSON
number formatting and string escaping including lone surrogates.

Replace every expected Assessment split/shadow/draft/history object serialization
with this independent writer. Compare exact terminal duplicates through it too,
so a hook making unequal runs stringify alike cannot authorize clearing. Actual
repository writes remain unchanged and genuinely observed. Hooks may still alter
them; compare their actual raw bytes against independently obtained expectations
and refuse altered bytes. No-write full split with an unused hook must still pass.
Ordinary and exact partial-split recovery/property order remain unchanged.

2. Inside syncExpected, before accepting whole-output equality, require the known
contentSha256 property in each personal entry and Team session/bundle entry to be
a primitive string of length64 and exact lowercase [0-9a-f]. Use actual validated
arrays/records, no coercion. Do not clone the full Sync parser, recalculate payload
hashes, reinterpret opaque payloads or change repository/Web behavior. Preserve
version deltas and owner/note/revision/parent-child rules. Arrays (including nested
singletons) and other nonprimitive hashes are preserved_unusable, never candidates.

3. Split audit concerns. Each main domain validates ONLY its own audit slice against
its exact allowed writes. Separately replay the complete truthful trace from the
immutable seed, accepting actual recorded get/set/remove effects for ordering and
read-after-write checks. A recorded remove requires after=null and updates replay;
a recorded set requires primitive value/after exact; get cannot change anything.
Do not manufacture a whole-history expected whitelist from set events. Rejected
ordinary domain mutations still keep that domain/profile/operation unusable, but
unaffected later actual loads retain accurate findings. If a bad earlier mutation
actually altered the later domain's data, its seed comparison still fails correctly.
Unknown/out-of-Profile access still poisons the entire overlay/Profile, with no new
I/O or positive result. Shadow keeps both full independent write whitelist and trace.

Adopt all13 independent cases (11red2green) from /tmp/curling-independent-review/
s6b-own.test.ts with relative imports and unchanged assertions, add positive real
partial/shadow controls and hook attacks on object/array serialization, exact terminal
duplicate clearing and Unicode/property order, -0 where supported. Keep actual
domain counters and all existing matrices. Check the new writer's bounds/cycles/
unsupported/accessor behavior via negative controlled actual-factory probes if needed,
without a public injection seam. No global monkeypatch in production; tests restore
their own temporary hooks in finally. Run focused regressions/TS/lint/diff, then
independent complete CODE re-review before final baseline. Historical/operational/
config/device/hosted/release/Q4 remain open. No Git/env/source-data operations.

Independent DESIGN PASS includes prechecking escaped string/key lengths before
primitive encoding and path-local cycle detection that accepts acyclic repeated
references. Complete corrected CODE and final baseline acceptance are recorded below.


### S6b actual correction and acceptance evidence

All three independently reproduced families are locally corrected under the
accepted consolidated design: independent owned Assessment JSON output/duplicate
comparison, primitive canonical Sync digests, and separate per-domain write
whitelists versus complete truthful trace replay. The actual repositories and old
formats remain unchanged. All13 independent witnesses were adopted with relative
imports/explicit types and unchanged assertions; nine adjacent controls bring the
new review suite to22 cases. Initial independent CODE was12 focus files/337 PASS
but11 own witnesses FAIL and2 controls PASS; it was not a clean review. Original
/tmp/curling-independent-review/s6b-own-expanded.log remains red evidence.

Corrected parent16 files/501 tests PASS, including actual loaders, all transfer
formats/inventory/decision and architecture; TypeScript, focused ESLint/diff PASS.
Logs: /tmp/curling-s6b-correction-{focus,types,lint}-ready.log. Prior immediate
2-suite run122 PASS is /tmp/curling-s6b-correction-focus-second.log. Complete
corrected independent CODE subsequently passed:13 focus files/359 tests,
all13 original own witnesses, and14 additional writer controls using the extracted
actual private body (escaping/order/getter refusal/DAG/cycles/-0/depth/nodes/output).
Independent TypeScript/focused ESLint/diff passed. Logs:
/tmp/curling-independent-review/s6b-corrected-focused.log,
/tmp/curling-independent-review/s6b-own-corrected.log,
/tmp/curling-independent-review/s6b-writer-own-final.log. The writer scratch harness
initially manipulated the Array prototype too broadly; it was corrected to the
actual input array only, with no production changes. That initial log is not a pass.

Final actual baseline:363 root files/7962 tests PASS,139/139 Playwright PASS,
Web build PASS, mobile verify10 files/276 tests plus type/build PASS, positive
ECONNREFUSED server shutdown on127.0.0.1:3100, then TypeScript/root+mobile ESLint
and diffcheck PASS. Logs: /tmp/curling-s6b-{root,web,mobile,e2e,server-stop,types,lint,mobile-lint}-final.log.
Root used temporary scratch and maxWorkers4; existing temporary Playwright cache
without downloads. Known chart/chunk warnings nonfatal. SQL/Swift unchanged and
receive no new evidence. Start0 staged83modified169untracked, final0/83/172;
main/HEAD/local main/origin main382ee40d37605b302c11b6390305857c7e2c3fde unchanged.
No Git mutation, original/config/native activation, signing/install or hosted action.

Domain preservation candidates and named load recoveries are now locally proved,
not full historical usability. Historical catalogs/diagrams, protected operational
transfer/external-writer exclusion, actual configuration/device/hosted/legal/worker/
Apple gates and Q4 remain open. No Beta/cutover approval. Free pilot/Free/Personal/
Team and Q1/Q3 unchanged.


## S6c — Historical catalog and registered diagram references

Independent DESIGN and complete corrected CODE accepted; full local baseline PASS, 2026-10-26.
The complete corrected design is adopted below. Existing S6b evidence remains valid
for its own accepted boundary; this stage grants no operational readiness.

### Exact purpose and honest limit

Implement only a private historical-reference evaluator in a new
`src/lib/persistence/installationTransferHistorical.ts`, its focused test, exact
architecture guards and canonical status. Actual S6b domain loader behavior and API
remain unchanged. All original archive formats, Decision flags and defaults remain.
No domain repository/migrator, existing cloud reader, primitive hash, bridge, dependency,
SDK, store, UI, live identity, source retirement or production activation changes.

This stage establishes whether preserved historical references resolve against the
ACTUAL complete compiled historical catalogs and the current immutable public diagram
delivery inventory. It does not establish all opaque cloud payload semantics, validate
their inner content hashes, execute a source snapshot/reauth/publication protocol,
produce supported_usable, prove device files/HTTP/cache readiness, or turn a domain
candidate into an operational transfer grant. State these boundaries explicitly.
No invented server receipts, createdAt/recorder metadata or partial auth projections.
Do not reconstruct owned Team results from upload payloads. The full outbox strings
and all private notes/revisions remain in the immutable archive unchanged.

### Entry and correlation

One new entry `evaluateInstallationTransferHistoricalV3(wire: unknown)` only; no
caller-supplied decoded result, domain report, catalog, adapter, resolver, proof,
provider, dependency override or readiness Boolean. Call the actual standard-bound
S6b domain evaluator with the original primitive wire, then the actual V3 decoder
again to obtain a privately owned verified frozen envelope; do not expose new core
internals or change the existing entry. Two checks are an explicit bounded cost,
not a physical source freshness claim. Require equal packageDigest and equal Profile
count with the actual S6b profileIndex sequence 0..n-1. Both actual evaluators use
the same V3 canonical Profile ordering, bound by that verified packageDigest; no
Profile UUID is added to the value-free domain report. Do not use an externally replayed lookalike report. All
foreign hashing work stays owned through the already accepted actual V3 contracts.
Invalid/nonprimitive wire returns fixed actual refusal before additional per-call
historical examination or registry construction. Existing effect-free import-time
catalog assertions remain unchanged; no claim excludes those existing assertions.
Second decode failure/correlation mismatch yields fixed unavailable, no candidate.

For every declared Profile retain its actual S6b value-free domain report. If that
Profile is preserved_unusable, label its historical status not_evaluated and do not
interpret its unsupported raw structures; continue other independently valid Profiles.
preserved_candidate/recovery_required Profiles are eligible for catalog examination,
without clearing their domain recovery requirement. No Profile namespace is derived
from participants/recorder/trusted identity. Identity/legacy/deletion archive records
remain inert; never invoke their repositories/replay. Empty sporting inventory still
checks the actual compiled catalog/inventory, but grants nothing.

### Actual complete destination catalogs and registered delivery

Use actual EXERCISE_CATALOG, validateExerciseCatalogPackage and actual lookup functions
findExerciseVersion/findMeasurementProtocol over the complete versions/protocols,
including retired/superseded. Never list only current visible exercises or silently
substitute a current version. Validate and privately snapshot the actual full public
asset definitions/IDs/path map with unique membership and exact registered paths,
including historical asset versions. Require all three actual registries to describe
the same complete unique inventory. Paths must be the current fixed root-relative
`/exercise-diagrams/<assetId>.png` for the corresponding actual registered public ID;
no URL/path assembly from source data, foreign origin or implicit restricted endpoint.
Engineering admission:4096 asset definitions and8192 catalog versions/protocols each;
exceeding refuses this evaluation, not truncation/retention or a format rewrite.
Private metadata capture has no fetch/native I/O and is frozen for this invocation.

Every compiled Exercise Version's compatible measurement protocol ID/version must
resolve against the complete actual protocol list. For each attributed-source image,
the actual assetReference must resolve in the complete actual public delivery map;
structured diagrams use the actual supported diagram schema/union via catalog
validation. Registered historical image versions are included even when not current.
Do not rewrite old distribution metadata: ADR46/current public resolver governs
registered delivery membership and accepts registered historical assets; an old
restricted label is not a request to activate the dormant restricted resolver.
An asset absent from the actual public inventory is unavailable, no auth/network
fallback. Bound registry capture before avoidable allocation/iteration driven by
untrusted length; these are actual module arrays, not public caller data. Capture
closed own data only if a malformed module value is encountered; no coercion/hooks.

The existing actual mobile plugin emits every registered current+superseded image
and fails on a missing source file; existing mobile bundle tests compare emitted
bytes/path inventory. Re-run those as the build gate. A catalog_candidate means
registry/bundle-contract compatibility only, not proof of an installed device file,
offline cache, physical transport or a server receipt. No runtime network/file probe.

### Bounded owned source interpretation

Only read sporting raws from the actual validated envelope and its declared Profile
namespaces. Use the existing effect-free parseBoundedJson with the existing1MiU raw/
string, depth32/nodes65536/member4096/name128 admission, plus checked aggregate262144
parsed nodes across this HISTORICAL phase. Charge every parsed payload tree as well
as the containing sync raw; parsing a string again costs again. Domain-phase cost
is separate and remains its own bound. This is a conservative interpretation budget,
not a new wire/retention limit. No fallback parser, chunked/subset scan or ignored
unknown schema. Exceptions opaque; no input text or raw data in errors/reports.

Use closed domain-specific paths rather than arbitrary object-name searching or
parsing user notes that happen to contain JSON. Source object member order may be
ignored for historical equality only; ordered arrays, every exact own JSON field,
finite numeric values and full immutable snapshots must match. No toJSON-sensitive
container serialization as an equality oracle. No repair, trim, missing-field default,
current-catalog substitution, new UUID/time generation for source matching, mutation
or read of external data. Existing actual synchronous readers may internally create
discarded migration fallbacks; never adopt those as historical reference evidence.
Actual domain candidate and all source bytes remain unchanged.

Known reference surfaces, all of which must be covered:

1. Current Session and each ordered history Session: optional
releaseTimingExerciseVersionSnapshot; planExecution.steps[].step snapshots including
not-yet-run steps; exerciseExecutions[].exerciseVersionSnapshot and configured enabled
measurement protocol snapshots. The actual S6b loader has already established
lossless domain interpretation; inspect original immutable raw references, not a
live repository/default Session. A running capture recovery never arms/resumes.

2. Training Plan library schema1/2: every step's existing immutable snapshot. For
the explicitly accepted schema1 legacy release step with no snapshot, check the
existing RELEASE_TIME_VERSION_ID through the actual catalog (that is its adopted
versioned interpretation); do not invent a snapshot for schema2/unknown step or
overwrite any named historical snapshot. Respect S6b library-readable vs executable
distinction; this stage adds no runner/execution grant.

3. All Assessment combined/shadow/draft/history roots (including a valid stale shadow):
every run's templateId and templateVersion must equal its complete templateSnapshot
id/version. The actual supported self-contained snapshot remains authoritative;
do not replace it with the one current template or reject a self-contained historical
template solely because it is not in a current visible list. Domain validation
already uses the actual persisted-run/template validator. Assessment templates are
not Exercise MeasurementProtocol snapshots and must not be conflated. No external
diagram/image references are part of their current types. No new raw metric or
sporting threshold policy.

4. Whole cloud sync schemas1..6: every active Team draft's full Exercise/protocol
snapshots, every owned cached sharedExecution's full snapshots (including original/
current/void/revisions retained by S6b), and referenced protocol ID/version pairs
within its actual configured protocol context. Other roster athletes and recordedBy
may differ from the namespace as already accepted; no rebinding.

5. Personal desired-present outbox payloads: pre-admit/parse the raw payload under
the bounded parser before calling actual synchronous deserializeTrainingSession or
deserializeAssessmentRun on privately derived existing entry metadata. Do not use
the async SHA helper or fabricate server/profile fields. The actual reader checks
known version and terminal domain compatibility. Then examine its ORIGINAL payload
tree for the reference surfaces above, without replacing data with migrated values.
Desired-deleted has no payload; keep its tombstone/hash/identity and do not invent
history. The contentSha256 string is preserved, not recalculated/trusted as an inner
payload-integrity proof by this historical-only stage.

6. Team outbox session coordinationPayload when nonempty: bounded known payload
schema1/2, exact top-level {schemaVersion,execution}, matching source entry version.
The execution.trainingSessionId must equal its actual parent sessionId; its
teamContext.teamId must equal that parent's teamId; its execution.id must be in
that parent's declared executionIds. Resolve its full Exercise/protocol snapshots.
No athleteResults, activeAttemptCorrections or recorder fields are fabricated.
Empty coordinationPayload is permitted only for already-synced entries as the
actual Sync loader requires. That absence supplies no remote snapshot evidence.

A nonempty bundle resultPayload must have known schema1/2 and the exact actual
expected top-level fields. Its exerciseExecutionId must belong to BOTH its own
bundle executionIds and the matching parent session executionIds. With a nonempty
coordination payload it must also equal that coordination execution.id; only that
validated execution configuration supplies the enabled protocol context.

When coordination is empty, a bare protocol reference may use only a complete
actually available context in the SAME archive Profile at these exact surfaces:
current Session.exerciseExecutions[], each history Session.exerciseExecutions[],
sync.activeTeamExerciseDraft, or sync.teamExerciseResults[].sharedExecution.
The last is eligible despite omitting athleteResults because its complete snapshot
and actual configuration remain. Every fallback must match the whole tuple
(Profile, parent.sessionId, parent.teamId, bundle.exerciseExecutionId) using actual
trainingSessionId, teamContext.teamId and id, and carry the full ExerciseVersion
snapshot plus actual configuration.enabledMeasurementProtocols. Plans, future
plan-step snapshots, compatible catalog lists, identity/roster/recordedBy, other
Profiles and invented metadata are not configured execution evidence. All matching
contexts must have equal full Exercise snapshots and equal ORDERED full enabled
immutable protocol snapshots. Identical duplicates are allowed; disagreement makes
that Profile historically preserved_unusable. Never select first/latest or union.

Inspect only actual typed protocol carriers: result.attempts[].measurements and,
for schema2, activeAttemptCorrections[].before and optional after attempt.measurements.
Unknown schema or carrier shape refuses examination; do not parse notes. A missing
needed full context refuses. With permitted empty coordination and no local protocol
or full-snapshot reference, no fallback is required and no remote reference/content
is invented; declared execution identity binding still applies. Empty synced bundles
have no local payload to scan. Roster and recordedBy may legitimately differ from
the namespace and never establish the context binding.

Do not invoke the async server reconstruction helper, claim full opaque Team payload
validation, invent server timestamps/recorder/receipts or construct owned cached
results from upload payloads. All unexpected/future payload schemas refuse historical
examination; none is skipped.

For every source Exercise snapshot require exact full own-tree equality to the actual
immutable version resolved by its id, including diagram/metadata and historical
protocol references. For every enabled protocol snapshot require id/version plus full
equality to actual immutable catalog protocol, not just an identifier or current
protocol version. Every bare Measurement reference in a known configured context
must match a known enabled immutable protocol id/version. Missing historical content,
unknown/future schema, changed full snapshot or unavailable context yields
preserved_unusable historical result for that Profile; no partial success/substitution.

### Value-free report and exact graph

Return only frozen data: schemaVersion1, packageDigest correlation, the actual frozen
S6b domain report, global historicalStatus and per-profile index/status plus bounded
counts of checked Exercise/protocol snapshots and required registered assets. Closed
historical statuses catalog_candidate/preserved_unusable/not_evaluated; no raw IDs,
names, notes, payloads, paths, snapshot trees, arbitrary reason or public catalog
override. After successful registry examination, aggregate ALL declared Profiles:
any per-Profile historical preserved_unusable makes global preserved_unusable;
otherwise any not_evaluated makes global not_evaluated; catalog_candidate is allowed
only if every declared Profile was examined successfully. Zero Profiles proves only
registry/bundle-contract compatibility. Preserve every original S6b domain/recovery
status and grant no right. All mayIssue/mayPublish/mayMount=false. Unavailable registry/decoder/budget
returns fixed historical_evaluation_unavailable where no full report is established;
ordinary unsupported source references produce truthful per-profile unusable reports.
No supported_usable, mayPublish or existing Decision change. Actual source capture,
protected transport, physical mapping/fresh auth/receipts and external-writer gates
remain separate C8/C9/C10 work; Q4 is still not approved.

Exact production graph: no app/mobile importer of new Historical module. Only it
may import S6b's existing entry; V3 decode has only S6b plus this new consumer,
encode none. New module may import only V3, S6b, actual profile key helpers/constants,
effect-free bounded parser, actual compiled catalog/content/lookup/validator,
public-asset registry and actual synchronous personal record readers/types. No
platform primitive, actual async Team server reader, auth/SDK/native/store/resolver/
UI/network imports or caller. Preserve S6a pure-core wrapper exclusivity and S2
inert graph. Guard the exact new parser/key/entry consumers and exact named imports.

### Evidence and next gates

Use actual standard V3 packages, actual S6b loaders, actual catalog/lookup/validators
and actual synchronous personal readers, positive forwarding counters and no external
store/fetch effects. Include mixed valid/unusable Profiles to verify global
aggregation. Cover empty synced coordination plus a pending measured bundle; a
matching actual cached/local context; the same execution UUID under a different
Session, Team or Profile; disagreeing matching contexts; and a bundle needing no
snapshot/protocol context. Cover all named surfaces including future plan steps, stale
Assessment shadow, active/owned Team state, real personal payloads and real serialized
Team outbox payloads, known old version/old diagram positive controls. Missing/changed
full snapshots/protocols, unknown versions, malformed/duplicate/nonfinite/oversized
payloads, cross-profile namespace, missing local protocol context, source hash
correlation and registry completeness failures need negatives. Never accept a test
with all mocked actual paths or fake injected catalogs. Test-only controlled module
registry mutation/restore and negative factory/decoder spies may exercise failures
without production overrides. Preserve all old S6b100+22, V3/V2/S2/architecture tests.
Use existing diagram-bundle byte/path and missing-source-file tests; no pure-network
fetch or real data fixture. No app startup/default changed.

Independent DESIGN before code; focused suites/TS/lint/diff, independent full CODE,
then root/Web/mobile/all E2E/positive server stop/post-server statics. Reconcile actual
status and Vault only after evidence. Continue protected operational source/target
transfer and any remaining complete usability/handoff prerequisite without treating
catalog_candidate as those proofs. Free pilot/Free/Personal/Team, Q1/Q3 unchanged;
no devices/config/Git/hosted/legal/worker/Apple or Beta approval from this stage.

S6c implementation audit clarification: actual validateSessionExerciseState rejects
Team executions embedded in Profile-owned Solo current/history Sessions. Those raw
Profiles remain S6b preserved_unusable / historical not_evaluated; the historical
resolver never bypasses that gate. Actual eligible Team fallbacks are the matching
active Team draft and cached sharedExecution. Declared current/history surfaces
remain examined when their actual domain is supported, without enabling a new
Session format. This narrows evidence, not a product or loader change.

S6c parent focused readiness, 2026-10-26: 9 files / 474 tests PASS, including
61 new historical cases and all existing S6b/V3/V2/codec/inventory/Decision/architecture
cases. TypeScript, focused ESLint and diffcheck PASS. Logs:
/tmp/curling-s6c-focus-ready-second.log, /tmp/curling-s6c-types-ready-second.log,
/tmp/curling-s6c-lint-ready-second.log. Initial focus used the forbidden default
scratch location and six old child-process tests failed EPERM; rerun used the
existing supported HERMES_S2_TEST_SCRATCH=/tmp/curling-s6c-scratch. Initial fixture
errors and the envelope digest-property error were corrected; initial logs remain
non-acceptance evidence. Final CODE/full-baseline acceptance is recorded below.

S6c independent initial CODE: 13 files/522 tests PASS, TS/focused ESLint/diff PASS,
but independent own13 probes had6 PASS/7 FAIL, so no CODE acceptance. All seven
red cases expose one metadata-capture defect: catalog field getters and ordinary
array length Gets run before closed descriptor capture. The correction captures
module roots once, admits required fields sequentially by own data descriptor,
validates/caches own length before allocation/iteration for all original arrays,
and refuses a changed captured length/extra index. No original length Get or later
field access after established refusal. All13 independent assertions were adopted
with relative imports/types, plus three adjacent asset-array/oversized controls.
Actual domain loaders/registries, archive and authority remain unchanged. Corrected
CODE and full-baseline acceptance are recorded below. Original red evidence:
/tmp/curling-independent-review/s6c-own-final.log.

### S6c actual corrected acceptance — 2026-10-26

Corrected parent focus:9 files/490 tests PASS, including77 new historical cases;
TypeScript, focused ESLint and diffcheck PASS. All13 independent witnesses retain
their assertions after repository-relative imports/types; three adjacent permanent
controls cover both original asset arrays and oversized descriptor admission.
Independent complete corrected CODE:13 files/538 tests PASS, original13 own probes
PASS, additional8 metadata probes PASS; TS/focused ESLint/diff PASS. These counts
overlap and are not added. Logs:
/tmp/curling-s6c-corrected-{focus,types,lint}.log,
/tmp/curling-independent-review/s6c-corrected-{focus,own,adjacent}.log.

Final actual baseline:364 root files/8040 tests PASS,139/139 Playwright PASS,
Web build PASS, mobile verify10 files/276 tests plus type/build PASS. Positive
ECONNREFUSED on127.0.0.1:3100 confirms server shutdown. Post-server TypeScript,
root/mobile ESLint and diffcheck PASS. Actual logs:
/tmp/curling-s6c-root-final.log,
/tmp/curling-s6c-{web,mobile}-final-retry.log,
/tmp/curling-s6c-e2e-final.log,
/tmp/curling-s6c-server-stop-final-retry.log,
/tmp/curling-s6c-types-post-stop-final.log,
/tmp/curling-s6c-{lint,mobile-lint}-final.log.

Initial Web build could not fetch the existing Google fonts under restricted
network; its authorized normal-build retry passed. Initial mobile verify had
262 PASS/14 skipped because its browser executable was sought in the default cache;
retry with the existing /tmp/curling-beta-playwright cache passed all276 without a
download. The first sandboxed port probe could not establish closure; the local
socket retry positively returned ECONNREFUSED. Red/unavailable initial logs remain
preserved, not relabeled as passes. A TypeScript run after that positive observation
also passed. Existing chart/chunk warnings remain nonfatal. SQL/Swift unchanged;
no new physical evidence is implied.

Historical references now have a locally and independently accepted private
catalog_candidate evaluation against complete actual catalogs and registered
current/superseded diagram delivery inventory. All Profiles must be examined;
S6b domain recovery remains intact and its old historicalStatus stays not_evaluated.
The new result grants no operational authority. Full opaque Team payload semantics,
inner payload digests, installed-device delivery and protected transport are not
proved by this scope. Protected operational transfer/external-writer exclusion,
actual configuration/device/hosted/legal/worker/Apple gates and Q4 remain open.
Start0 staged83modified172untracked; final0/83/174; main/all refs
382ee40d37605b302c11b6390305857c7e2c3fde unchanged. No Git mutation, source/native
activation, actual configuration, device installation, signing, upload or hosted
change. Free pilot/Free/Personal/Team and Q1/Q3 unchanged; no Beta approval.


## S6d — Bounded actual WebView archive-source observation

Independent corrected DESIGN and complete CODE accepted; full local baseline PASS, 2026-10-26.
The complete corrected contract follows. No native/freeze/transport/auth grant.

### Exact purpose, scope and honest result

The next operational-transfer prerequisite is a real source observation rather
than caller-authored listing/observations. Add one private read-only factory in the
existing sole `src/lib/persistence/localStorageAdapter.ts`:
`createInstallationTransferWebViewSource()`. It has NO arguments, storage/policy/
provider injection, adapter override, sourceBuild/id/healthy/frozen input or callback.
Factory construction performs no global/storage read. It returns a frozen object
with capture(): Promise<CaptureResult>, fence(proof): Promise<FenceResult>, and
close(): Promise<void> only. The entire native inspection/reflection phase remains
synchronous before those owned results settle; there is no await between source
reads. No default/app/mobile caller is added.
Only focused tests, exact architecture guards and canonical docs change otherwise.
Import only actual pure inventory V2 planner/constants/expectedSlots and the exact
completion-only drainObservedPlatformWork from platformSha256 in addition to that
adapter's existing dependencies; V3/S6b/S6c/SQL/SDK/native graph unchanged.

The capture is WebView storage evidence ONLY. It establishes neither native source
bundle ID, install origin, source helper boot isolation, quiescence/writer exclusion,
freeze, backup rollback protection, auth, device readiness, protected transport or
an encoded archive. Do NOT mint owner_frozen/synthetic_frozen snapshots or call
encode/decode, generate IDs/times, return plaintext/wire or adopt an S2 Decision.
C8/C9/C10 remain future integration. No public storage contract is extended.

Return a closed value-free result: success with a privately branded opaque proof,
counts of Profiles/slots/present/excluded names and fixed observation-only kind;
or fixed unavailable/source_changed/source_unhealthy/source_unsupported/closed.
All mayIssue/mayPublish/mayMount remain false. No keys, IDs, names, raws, values,
paths, arbitrary errors, adapter/storage/methods, untrusted values or reader handles
escape. The proof has no data properties and is frozen; private WeakMap contains
its exact owning source instance, complete captured names and immutable own raw map.
No raw/proof resolver is exported in this stage. At most ONE current proof and
ONE bounded own-value map may be retained per source instance. A new capture, after
confirming idle/currentness, invalidates and releases the previous proof/map BEFORE
examining foreign state. Failed recapture never restores the prior proof. Refused
reentrant calls cannot replace/reset an active operation. Confirmed change or close
invalidates and releases retained proof/map references; already observed work remains
owned until settlement. close invalidates all proofs.
Proof equality is provenance only, never an installation/source-write/auth grant.

### Actual synchronous source and bounds

This source has the ordinary platform-integrity prerequisite: actual unchanged
ambient Web Storage WebIDL intrinsics and the accepted C4 supported observation
boundary. JavaScript cannot attest an arbitrarily replaced Storage.prototype.length
function as native. Do not claim generic pre-bootstrap thenable containment AND zero
named Storage-value reads for arbitrary replacements: before a trusted receiver
checker exists those promises cannot both be made. Missing required platform metadata
refuses BEFORE obtaining the localStorage receiver. Preserve the accepted C4 residual;
no unsupported/bootstrap prerequisite is turned into successful observation or a grant.

On first capture, acquire the actual ambient Storage constructor/prototype metadata
and its OWN length getter, key and getItem function values BEFORE obtaining the
localStorage receiver. Acquire length-checker metadata first; closed own-data/accessor
descriptors only, not arbitrary object traversal. These bootstrap intrinsics are the
explicit trusted platform prerequisite, not caller inputs or native-function text
attestation. Then read the actual global receiver ONCE inside a guard and apply the
captured actual length getter using captured Reflect.apply and the ORIGINAL receiver.
Its successful primitive native result establishes the receiver's synchronous Storage
brand and first bounded length observation. Bind these platform operations once.
Do not use instance-member lookups, bind, instanceof, toString or source-text checks.

Never generally assimilate a positively confirmed synchronous Storage receiver, even
on later failure. Storage exposes arbitrary named user keys as properties; storage.then,
storage.constructor, storage.getItem/key, Object.keys(storage), or even Storage-instance
descriptor scans may read excluded payload values. All normal reads and subsequent
source/method replacement checks use captured platform operations and ambient metadata
identities, NEVER receiver property lookup. A later global/ambient operation replacement
refuses rather than rebinds. No excluded named value is read by error handling.

With the genuine receiver checker available, the completion-only recursive exclusion
predicate checks the exact genuine joined close Promise first, then treats positively
brand-checked synchronous Storage receivers as INERT leaves. This also covers a Storage
receiver revealed only as a directly observed Promise/thenable child. The checker uses
the captured WebIDL length getter only, not instance properties; its role in failure
observation supplies neither a source read result nor evidence. No already-owned/inert
exclusion may become a value/proof or reauthorize continuation. Do not expose the value
observePlatformWork export or any platform hash capability; its existing source-only
graph remains unchanged. Guard only the new named completion-only import.

Register the WHOLE capture/fence operation and synchronous phase gate BEFORE its first
foreign global/metadata/reflection call. Check currentness around every foreign call.
Lengths must be finite safe primitives; key/getItem returns primitive strings/null.
Do not coerce or await malformed values into valid storage values. A directly observed
malformed root/result/metadata value under the established C4/bootstrap prerequisite
first revokes continuation/publication and then gets completion-drained with actual
drainObservedPlatformWork. Retain earlier observed potential work if a later getter
throws; never inspect the thrown reason or search arbitrary objects/payloads. Valid
synchronous Storage receivers remain excluded as described above. No later source
reads occur after retirement. Native source inspection itself remains one synchronous
turn, with no await/yield and no other-process writer exclusion claim.

close() retires synchronously and returns ONE exact genuine joined native Promise.
Reentrant close cannot settle until the synchronous capture/reflection phase has ended
AND the COMPLETE observed-work list has drained. Do not snapshot an incomplete list.
Check exact close-Promise identity recursively through the accepted boxed C4 observer
so a directly revealed own-close root/child cannot self-depend; already-owned exclusion
never counts as a Storage value. No timers, cancellation-as-settlement, unhandled-
rejection listeners, raw forwarding, own observer or forced cleanup. Hidden dependencies
outside the accepted C4 support precondition are not claimed solved. Operational
activation cannot infer readiness from this read-only observer's completion.

Bound the actual native length to <=4096 BEFORE allocating/traversing its keys.
Every key must be primitive length<=256, unique, non-null at its declared index;
length must still agree after the pass. Obtain two complete equal key inventories,
compare sorted by existing code-unit order. Complete listing includes excluded key
NAMES only. Bound before sorts/extra allocations. Reuse actual V2 inventory planner
on a safely serialized privately owned primitive listing (primitive-leaf JSON only,
no container toJSON hooks); no mirrored family classifier. Any unknown owned family,
future malformed family/profile selector or planner refusal stops before raw reads.
The existing planner's 32Profile/512dynamic/1024slot and total limits remain unchanged.
No retired unscoped sporting value, provider credential/verifier/hash/user field,
diagram-cache value or foreign value is read. Enumerating a name does not authorize
reading its value. Source contains all expected13 sporting slots for every declared
Profile, five fixed identity keys, recognized dynamic denial controls, legacy marker.

### Exact read map, health and fresh fence

Use the actual planner rawReads and absenceProbes / expectedSlots; read every
expected slot, including positively absent fixed/Profile keys, exactly into a private
owned Map. Every listed admitted slot must return a string, every absent expected
slot null. Missing listed or unlisted present is source_changed, never omission.
Enforce raw slot caps before retaining (sporting1MiU, identity64KiU, legacy8U) and
checked aggregate3MiU; do not parse or normalize raw contents. Actual codec/domain
validation remains later. Preserve empty strings, order, lone surrogates and malformed
known-domain data exactly at this observation boundary.

This bounded initial source supports positively ABSENT known domain migration controls
only. If the actual planner lists any TRANSFER_CONTROL_KEYS, refuse source_unhealthy
BEFORE their values are read; do not invent healthy or parse a partial control tuple.
If none is listed, positively read all three known control addresses and require null
both before and after copying; a non-null/malformed/unreadable control refuses, never
absence. A source with existing controls remains preserved for a later genuine
combined-control integration. Unknown owned controls are already refused by planner.
No source marker, freeze flag, repair, preference, retirement, storage set/remove/clear
or source cleanup is written. Credentials remain outside source observation entirely.

After the own map is copied, repeat complete bounded inventory and all expected
own value/absence/control checks against the captured immutable map. Only exact
agreement yields a proof. Reentrant changes/later exceptions never overwrite a
positive same-call contradiction with an unavailable claim. Classify a positively
observed mismatch source_changed; inability to finish examination unavailable.
Do not manufacture source_changed merely from an exception/missing observation.
A fresh fence(proof) accepts only a currently held proof belonging to this SAME
factory, and redoes the same complete inspection. It returns only unchanged/changed/
unavailable/closed. There is no expiry-by-time, cached healthy state or stale-proof
success; one confirmed change invalidates all earlier proofs of that instance.
Unrelated source/global replacement refuses. A fresh capture may be attempted only
under an explicitly current idle source; a reentrant call is refused. close retires
synchronously, joins actual completion as above, and cannot reopen an instance.
No call can block normal writes or declare external writers excluded. No claim that
an unchanged fence across two moments proves no intervening same-state write.

### Evidence and continuation

Tests must exercise actual factory and actual pure planner against synthetic real
Web Storage with observed native receiver calls; no successful test using a supplied
fake adapter/policy or complete mocked planner. Positive all13/fixed/dynamic families,
empty values/raw weird Unicode, actual excluded credential/cache/foreign sentinels
with ZERO raw gets, Profiles declared by stored keys only and all expected absences.
Unknown-owned/future controls fail before gets, controls listed and unlisted present,
null/missing/duplicate/change/grow/shrink/throwing enumeration, bounded huge length
before key calls, all raw caps/aggregate overflow, whole-map fresh fence/mismatch,
source/method replacement, reentrant close/capture/fence, foreign/copied/closed proof,
no storage mutation, no escaped raw values or hooks/error inspection. Add direct/masked/nested rejected
or pending malformed global/metadata/key/getItem values within the actual bootstrap/
C4 support boundary; known pre-bootstrap integrity failures remain explicitly refused,
not false universal containment proofs. Earlier observed work plus later throw; close
during reflection before discovery of pending work; exact own-close root/observed child
without self-cycle; old proof invalid after successful/failed recapture; bounded single
map retention. Use REAL Storage keys then, constructor, getItem and key with later
refusal/close and malformed Promise-to-Storage children; assert zero named value reads
by failure observation and no arbitrary payload traversal. Capture/fence
never become auth/freeze/encoding grants. Original factory/repository tests unchanged.

Independent DESIGN before code, focused actual inventory/source/codec/architecture
and old source/combined/retirement tests, TS/focused lint/diff, independent whole CODE,
then required complete baseline. Keep default artifact/no caller guards exact.
Reconcile honest status/Vault after evidence. Subsequent work still must establish
actual old-bundle source helper boot isolation and lifetime/writer exclusion, protected
transport, actual target transactions/readback, fresh auth/control denial admission
and handoff, then separate physical/configuration/release gates. No Beta approval.

S6d implementation clarification: the receiver is acquired/bound once. Before
publication its ambient reference and platform-operation identities are freshly
rechecked without rebinding or instance-member reads; replacement during the
synchronous phase refuses. Completion-only native receiver brand probes during
error draining are inert metadata checks, never resumed source enumeration/value
reads or evidence. Initial masked-Promise tests used a Vitest spy that itself
accessed the masked .then and threw before returning the root to the source. The
correct fault fixture uses a raw platform function and a positive actual-drain
forwarding counter; initial red harness logs remain non-acceptance evidence.

S6d parent pre-review evidence, 2026-10-26:15 files/1056 tests PASS across actual
source, S6a–c/domain/archive/inventory/Decision, architecture, combined source/owner/
runtime, credential retirement and platform observer. TypeScript, focused ESLint
and diffcheck PASS. Logs /tmp/curling-s6d-focus-ready-second.log,
/tmp/curling-s6d-types-ready-second.log, /tmp/curling-s6d-lint-ready-second.log.
An initial pure S2 import guard correctly rejected the new source consumer until
the exact approved inventory-only named import exception was added; no other
consumer or pure-core dependency was allowed. Initial49-case source run had three
masked-Promise harness failures; the raw fault function/actual-drain counter
corrected that harness. Final corrected CODE and baseline evidence appear below.

S6d initial independent CODE review, 2026-10-26: 16 files/1080 tests, TypeScript,
focused ESLint and diffcheck PASS, but eight original reviewer probes exposed one
P2 descriptor-admission defect (five PASS/three FAIL): field() read value/get before
checking that the normalized descriptor actually owned that member. An inherited
getter could run and expose pending work that the failure path did not own. No
CODE acceptance. Correction checks own membership before reading the field while
preserving own value/get/set harvesting before the post-reflection continuation
check. All eight independent witnesses are adopted unchanged in meaning as permanent
regressions. Final corrected review and complete baseline evidence appear below.

S6d first complete baseline: root365 files/8108 tests and Web build PASS, but mobile
verify275/276 PASS exposed top-level frozen inventory constants retained in the
standard bundle through the unused new source import. The existing ANY-mode dormant
executor assertion correctly refused that build. No complete-baseline acceptance.
The correction adds standard PURE annotations only to the five closed owned
Object.freeze initializers in installationTransferInventory.ts; executed semantics,
formats, budgets and pure graph remain unchanged. The existing mobile dormant-bundle
test also checks archive/source markers with Boolean assertions so failed diagnostics
do not dump full configured bundles. No assertion weakened or module-wide side-effect
flag introduced. The corrected actual bundle, focused suites and independent review
must pass before a new complete baseline is accepted. Initial failing log remains
/tmp/curling-s6d-mobile-final.log; do not print its minified bundle diagnostics.

S6d additional independent artifact matrix found an existing guard contradiction:
default14/14 PASS but both opt-ins13/14 because accepted ordinary SQL discovery
already requires the D/F addresses and reserved-prefix refusal, with shared source/
D/F eligibility constants. No runner/archive/new-source marker was present. Actual
provenance: nativeSqliteAdapter.ts LEGACY_PROTOCOL_KEYS, discoverProtocol and
ordinary validKey refusal; nativeMigrationEligibility.ts exact source/D/F names.
Production behavior is unchanged. The corrected guard keeps strict default absence
and for actual SQL opt-ins admits only the exact four known strings with exact
multiplicity (prefix2,D2,F2,source1) plus actual schema-discovery query presence.
Unknown, extra, duplicated or unproven references fail; dedicated negative controls
exercise this test helper. ANY-mode runner/archive/source markers and architecture/
caller guards remain mandatory. Original matrix evidence is retained under
/tmp/curling-independent-review/s6d-bundle-*.json. Final independent matrix and
complete baseline remain pending.

### S6d actual corrected acceptance — 2026-10-26

The actual private source now captures a complete bounded map from Web Storage with
actual native receiver-bound reads and the actual V2 inventory planner. Every expected
slot and absence is positively observed; credential/verifier/cache/foreign values are
never read. Repeated inventories, raw values, controls and final ambient identities
must agree. One current private proof/map is retained; close/change/recapture revokes
it and every directly observed pending dependency remains owned through settlement.
Capture/fence establish observation only, no writer exclusion or frozen-source grant.

Initial independent P2 (inherited descriptor field read before own-membership check)
was corrected; all eight original probes were adopted with the same assertions.
Parent corrected focus15 files/1064 PASS; independent corrected16 files/1088 PASS,
eight original and four adjacent probes PASS. First full root365/8108 and Web build
passed, but Mobile275/276 correctly refused unused closed inventory Object.freeze
initializers retained by the bundler. Five exact standard PURE annotations preserve
executed behavior and allow unused constants to be omitted; no global side-effect
setting or broader dependency exception was added. The dormant ANY-mode artifact test
also rejects archive/source markers and now uses Boolean diagnostics to avoid dumping
configured bundles. Initial failing log is /tmp/curling-s6d-mobile-final.log; do not
print its minified contents. Corrected CODE/bundle evidence and final baseline follow.

Independent final corrected CODE and artifact gate:16 files/1088 tests PASS;
actual Default/Diagnostics/Native-storage builds each15/15 bundle cases PASS;
Default restored and15/15 PASS; full default mobile10 files/277 PASS;44 independent
guard assertions PASS. Root/mobile TypeScript, focused lint and diffcheck PASS.
Counts overlap and are not additive. Logs:
/tmp/curling-independent-review/s6d-guard-{focus,own,default-mobile-tests}.log,
/tmp/curling-independent-review/s6d-guard-matrix-results.json.

Final complete parent baseline:365 root files/8108 tests PASS,139/139 Playwright
PASS, Web build PASS, mobile verify10 files/277 tests plus type/build PASS. Positive
ECONNREFUSED127.0.0.1:3100 confirms server shutdown; subsequent TypeScript and
root/mobile lint plus diffcheck PASS. Logs:
/tmp/curling-s6d-root-final-corrected.log,
/tmp/curling-s6d-web-final-corrected.log,
/tmp/curling-s6d-mobile-final-corrected.log,
/tmp/curling-s6d-e2e-final-corrected.log,
/tmp/curling-s6d-server-stop-final-corrected.log,
/tmp/curling-s6d-types-post-stop-final.log,
/tmp/curling-s6d-{lint,mobile-lint}-final.log.
First failing artifact/matrix evidence remains preserved; no failure was relabeled.
No SQL/Swift change or physical delivery result is implied by these JS/build tests.

The real source observation is now locally and independently accepted. Operational
old-bundle source-helper isolation/lifetime and writer exclusion, standard protected
transport/delivery, target transactional staging/readback and fresh-auth denial-aware
handoff remain to be integrated. Actual configuration, physical iPhone/Brower,
hosted migration/legal/worker, old-client coordination and Apple gates plus Q4 remain
open. Native Team-link association/delivery remains a separate prerequisite only
if that native delivery is enabled: under the already adopted MOBILE_APP_MIGRATION
§6.5/S5m, closed-beta Team email links may continue opening Web. It is not a new
mandatory domain-association decision for the email-OTP pilot. No billing, price/
seat enforcement or final Personal naming is required for the free closed pilot.
No Beta approval. Start0/83/174, final0/83/175, main/all refs382ee40 unchanged.
No Git mutation, native/default activation, actual configuration assignment, original
iPhone modification, installation, signing, upload or hosted change.


## S6e — Standard protected V3 archive envelope

Desired outcome: finish one missing operational-transfer prerequisite with actual
standard platform encryption/decryption of the already accepted V3 archive. This is
local technical implementation within the user's beta-completion order, not a new
product entitlement, external delivery, storage activation or native installation.
Corrected independent DESIGN and complete CODE accepted; full local baseline PASS, 26 October 2026. S6d complete acceptance is recorded above; operational transfer and device acceptance remain separate.

### Authority and scope

Read docs/AI_DEVELOPMENT_WORKFLOW.md, CLAUDE.md and canonical BETA_COMPLETION_SPECIFICATION
S6a–d, actual V3 codec/platform observer and architecture guards. Preserve main/all refs
382ee40, existing unstaged/untracked work; no Git mutations or environment inspection.
No product override: preserve source, exclude provider credentials, fresh target auth,
identity archives inert, Free pilot/no billing and Team != Personal remain unchanged.
Use Web Crypto's actual standard AES-GCM and getRandomValues; implement no cipher,
password KDF, plugin fork, key escrow, server endpoint or custom native encryption.
Reference: W3C Recommendation26 January2017, §§getRandomValues, AES-GCM:
https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/#aes-gcm
https://www.w3.org/TR/2017/REC-WebCryptoAPI-20170126/#Crypto-method-getRandomValues

Allowed implementation: one private installationTransferProtection.ts and its exact
focused test, exact existing architecture consumer/import guard amendments, canonical
S6e and short architecture ADR/index only after independent DESIGN acceptance. Actual
V3/S6b/S6c/source/observer/native/default code unchanged. No application/root/UI caller,
file/network/share, Keychain, SQLite, configuration assignment or actual data access.
An isolated source-helper boot and actual source/target ownership/readback will be
next operational integration, rather than claimed by this primitive.

### Explicit functions and honest result

sealInstallationTransferV3(wire: unknown) -> owned Promise<Result<{protectedWire,
recoveryCode, packageDigest}>>. First actual decodeInstallationTransferV3 validates
complete supported canonical V3 and digest after primitive type/nonempty/length
admission. Invalid/unsupported bounded archive produces fixed archive_invalid; no
random or AES calls. Primitive API admission failures use invalid_input. No codec/provider override accepted.
openInstallationTransferV3(protectedWire: unknown,recoveryCode: unknown) -> owned
Promise<Result<{wire,packageDigest}>>. On authenticated decrypt, require exact byte
encoding bounds then actual V3 decoder/digests again before returning private wire.
Success proves authenticated envelope under the supplied random key plus V3 integrity,
not source provenance, user identity, semantic readiness, freshness, anti-replay,
writer exclusion, physical receipt, safe target selection or publish/mount rights.
Every success/failure includes mayIssue/mayPublish/mayMount false; no grants.
Fixed failure vocabulary invalid_input/archive_invalid/protection_unavailable/
authentication_failed. No reason inspection or input/keys/raws in diagnostic errors.
Success strings are sensitive private integration data, never logs, UI diagnostics,
URL/query, analytics, identity controls or ordinary repositories. No public app API.

### Exact standard crypto and wire

Each seal obtains a NEW32-byte random key AND NEW12-byte nonce by the actual captured
Crypto.getRandomValues on separately owned Uint8Array targets. Each returned value
must be the exact target; malformed/pending returns never become entropy evidence.
Import raw key with actual SubtleCrypto.importKey('raw', ownKey, {name:'AES-GCM'},
false,['encrypt']) so actual CryptoKey is nonextractable. Encrypt once with actual
SubtleCrypto.encrypt({name:'AES-GCM',iv:ownNonce,additionalData:fixedAAD,tagLength:128},
key,ownPlaintextBytes). Never reuse retained key/nonce across calls or on retry;
no application or test provider injection. Open imports decoded exact32-byte key
nonextractably for ['decrypt'] then actual matching AES-GCM decrypt. No exportKey.

Wire plaintext encoding: exact canonical V3 ASCII, one byte per wire code unit.
The ACTUAL codec emitCanonical() escapes EVERY string code unit as backslash-u plus
four hex digits, with ASCII-only structure/numbers. Verify actual V3 decode AND
ASCII membership before encrypting; the original sporting raw UTF16, including lone
surrogates, is preserved inside these existing canonical escapes. No TextEncoder,
replacement/normalization/BOM or new inner codec. Bound before allocation at actual
TRANSFER_LIMITS.wire code units/bytes; encrypted bytes<=wireLimit+16. AES returned
output must be a real ArrayBuffer of exactly expected length for seal; open real
nonempty length<=wireLimit and every byte ASCII before allocating output strings.
Native ArrayBuffer brand/length intrinsic, own copy; no instanceof, arbitrary .length,
.constructor, .slice or toJSON on foreign return. Capture trusted built-in operations
under same bootstrap/platform-integrity prerequisite as S6a/d, never claim to attest
arbitrarily replaced WebCrypto native functions.

Protected ASCII wire EXACT four lines, no terminal newline:
  curling-protected-installation-v1
  AES-256-GCM-V3ASCII
  <canonical unpadded base64url of exact12 nonce bytes:16 chars>
  <canonical unpadded base64url of ciphertext ||128-bit tag>
Fixed AAD ASCII bytes EXACT 'curling-protected-installation/v1' +0x00+
'AES-256-GCM' +0x00+'v3-canonical-ascii' +0x00+'archive-v3'. Header/algorithm/version/encoding are
closed and authenticated via this AAD; nonce is the actual IV, tag covers its use.
No key/IDs/builds/profile/counts/digest in outer public header. RecoveryCode EXACT
'ct1-'+canonical unpadded base64url of32 bytes (43chars); this is fresh entropy, not
a human password. Never bundle code into protectedWire. Later delivery must keep
recoveryCode separate and explain that it is required to recover the archive.
Loss of code has no escrow/recovery fallback; no actual user key/file is created now.

Use strict bounded RFC4648 base64url framing, reject padding/whitespace/nonalphabet/
noncanonical unused bits/extra lines. Reject typeof first and exact public maximum
before slicing, splitting, binary allocation or cryptography. Do not split arbitrary
input into unlimited lines. Compute ciphertext framing maximum arithmetically from
actual wire limit (not a caller declared length). Base64 byte packing is ordinary
encoding, independently compare against standard Node Buffer vectors. Avoid btoa/
atob intermediate full binary strings or caller-mutable array serialization hooks.
Bound loops/chunks and output string construction; decoding decrypted canonical ASCII uses
bounded chunks, no unbounded argument spread. Fixed text/header construction does not
invoke container JSON.stringify/toJSON. No generic JSON parser is needed outside the
already accepted actual V3 decoder. Limits bound owned work, not caller input/JS GC or
measured iPhone native-file/bridge memory; those physical gates stay separate.

### Ownership/failure

No global crypto read or operation at module import. Install whole owned operation
result before any foreign read; capture actual crypto/subtle/method receivers once
sequentially, record every directly observed potentially pending value before any
subsequent access/currentness decision. Invoke captured functions intrinsically,
never .bind/.call on foreign functions. Async native outputs are boxed through actual
observePlatformWork; no raw Promise assimilation that hides masked native settlement.
Every malformed direct metadata/result and previously observed pending work is fully
drained with drainObservedPlatformWork before fixed failure resolves, including
later throws and ordinary/masked/native-child results. Exact own whole-result work
may be excluded only as already owned, never accepted as a crypto value. No arbitrary
payload/error traversal, timeout/cancel/pending-as-settled fallback or pretend cleanup.
C4 platform provider owns unobservable rejections/hidden dependency cycles; no claim
of containment beyond actual observed roots under the accepted cooperative boundary.

No shared key/operation state across independent calls. Own plaintext/key byte arrays
have shortest useful lifetimes and are overwritten in finally after actual observed
operations settle; never wipe while native work may still consume them. Input strings
and CryptoKey/JS-engine memory cannot be securely erased; document this honest limit,
not a secure-memory guarantee. On failure no recoveryCode/private plaintext success
escapes. No source/target/file cleanup issued. Missing WebCrypto fails closed with no
Node/polyfill/injected fallback in production.

### Required evidence

Actual Node standard WebCrypto and independently Node crypto AES-GCM interop using
known synthetic key/nonce fixtures; not only self roundtrip. Valid actual V3 fixtures
include full personal/identity/deletion-control/archive shapes, explicit absences,
empty string and weird UTF16 preserved through actual decoder, source inputs intact.
Actual two seal calls obtain separate random calls/keys/nonces, no retained retry.
Wrong code, nonce/cipher/tag/header alteration, truncation, unsupported versions,
noncanonical base64, padding/unused bits/extra lines, missing crypto, type/proxy/
getter input never inspected, bounds before allocations/calls, non-ASCII plaintext bytes,
authenticated non-V3 plaintext and invalid actual archive refuse with fixed results.
Complete observed-work failures: metadata native/masked Promise, late throwing getter,
random malformed pending, import/encrypt/decrypt pending/rejected/native-child and
wrong output brand/length, exact own-result root. No error getters/coercions; no
further crypto after refusal; zero archive/key/plaintext diagnostics, input mutations,
storage/network/SQL/SDK/native calls or application consumers. Actual V1/V2 and S6a–d
remain unchanged. Test architecture graph and default/mobile dormant artifacts.

Independent DESIGN before code; own focus + TS/lint/diff; independent complete CODE;
required root tests/Web build/mobile verify/all139 E2E, positive test-server stop,
post-server TS/root+mobilelint/diff. Reconcile canonical technical docs and Vault with
actual evidence and honest remaining gates. No beta/readiness/crypto-audit claim from
ordinary code review; installed-device transport/memory acceptance remains required.

Audit note: selecting canonical V3 ASCII rather than a redundant UTF16LE outer
encoding halves the largest owned plaintext/ciphertext/file buffers. This follows
actual installationTransferCodec.ts:128–150, not an assumption that raw sporting
text is ASCII. Independent Unicode vectors must prove all original code units
still survive actual codec->protection->decode unchanged. Physical memory/bridge
budgets remain measured gates, not implied by this reduction.

### Required CryptoKey admission, exact length and stage-specific failure mapping

Actual imported CryptoKey admission is mandatory BEFORE issuing encrypt/decrypt.
Capture the public global CryptoKey constructor/prototype and own public type,
extractable, algorithm and usages getter descriptors once under the same trusted
platform/bootstrap prerequisite. Use intrinsic calls of those getters for genuine
CryptoKey brand checks, not instanceof/toStringTag or caller-supplied shape. Require
type exactly secret, extractable exactly false, algorithm own data name AES-GCM and
length256, usages a genuine Array with safe own data length1 and element0 exactly the
intended encrypt/decrypt string. Read only these required metadata fields using own
data descriptors; never execute a metadata accessor or inherited field to admit a
shape. Capture any own descriptor value/get/set directly observed before later
validation. Record/drain every directly observed malformed asynchronous field/result
before reading another field; unavailable constructor/getter/metadata or forged,
wrong-length, extractable or wrong-usage keys refuse before the next crypto call.
No key/user data is exposed by metadata diagnosis. No claim of native function
attestation beyond the already stated actual-platform prerequisite.

Canonical decoded ciphertext length must be >16 and <=TRANSFER_LIMITS.wire+16 BEFORE
crypto. Successful decrypt output must be genuine ArrayBuffer with length EXACTLY
ciphertextLength-16, nonzero and <=wireLimit, checked before allocating plaintext
strings or decoding V3. An in-range but incorrect length is a malformed crypto
fulfillment, not an archive. Preserve exact ASCII validation and private-copy rules.

Complete fixed failure mapping (never inspect thrown/rejected reasons):
- Primitive API admission (seal wire type/nonempty/length, open outer framing,
  ciphertext bounds, recovery-code representation): invalid_input. Unknown objects
  are rejected by typeof without any arbitrary member/brand/coercion inspection.
- Actual bounded V3 decoder format/inventory/canonicality/digest refusals, including
  its own input/format errors after primitive admission: archive_invalid.
- Actual V3 fingerprint_unavailable, fingerprint_failed, fingerprint_invalid:
  protection_unavailable, both before sealing and after successful decryption.
- Missing/malformed captured platform metadata; random/import/encrypt rejection or
  synchronous throws; malformed fulfilled crypto outputs (including exact own-result
  exclusion, forged CryptoKey, wrong ArrayBuffer brand or length): protection_unavailable.
- A synchronous throw while invoking captured decrypt: protection_unavailable.
- After an issued decrypt, a rejected observed settlement: authentication_failed,
  meaning ONLY authentication was not established. This proves neither wrong code,
  corruption nor any particular native/dependency cause. Getter/call/rejection reason
  is never inspected. A fulfilled but malformed output is still protection_unavailable.
- After successful authenticated decrypt, non-ASCII encoding and actual archive
  invalidity: archive_invalid; unavailable actual hashing: protection_unavailable.
No plaintext/recovery-code success escapes any failure. Pending remains pending until
all actually observed work settles; this mapping never manufactures settlement.

Add actual genuine AES128, extractable AES256, wrong/extra usage and forged-key
results; pending getter/descriptor/metadata controls; plausible incorrectly sized
decrypt output. Explicitly test unavailable actual SHA before seal (zero entropy/AES
calls), unavailable SHA after authenticated open (no private plaintext success),
actual authentication rejection and dependency rejection with the documented neutral
meaning, and opaque reasons whose getters are never touched. Permit exactly the new
protection module as named observePlatformWork/drain and V3 decoder consumer, with
non-vacuous exact architecture import/caller guards. No core/legacy observer/source/
app consumer expansion. No implementation before corrected independent DESIGN PASS.

### S6e implementation evidence before independent CODE — 2026-10-26

The exact private protection functions are implemented with actual V3 decode,
standard WebCrypto operations and public CryptoKey getters. Metadata is boxed and
observed before the next field; an asynchronously supplied replacement is refused,
even when it eventually advertises a plausible shape. Descriptor own-membership is
checked before field access. Pending roots have memoized complete observation; own
whole results are excluded, never accepted as values. Owned byte arrays are wiped
only after observed completion; a detached provider input cannot be wiped and does
not produce an unhandled cleanup rejection. Strings/provider-retained/native memory
are not secure-memory erasure claims. No legacy observer or source code changed.

Parent actual focus17 files/1159 tests PASS including protection, S6a–d, V1/V2,
semantics/history, source/combined owner/runtime/retirement and architecture.
TypeScript, focused ESLint and diffcheck PASS. Actual isolated Chromium standard
WebCrypto probe PASS, including real public CryptoKey metadata, original UTF16 through
canonical V3, wrong-code refusal and independent Browser-to-Node/Node-to-Browser GCM
interoperation. The probe used only synthetic data on a closed local server; it
neither mounted the app nor assigned configuration or touched native/file storage.
Logs: /tmp/curling-s6e-focus-ready.log, /tmp/curling-s6e-types-ready.log,
/tmp/curling-s6e-lint-ready.log, /tmp/curling-s6e-browser-probe.log; actual probe source
/tmp/curling-s6e-browser-probe.mjs. This is not an iPhone/WKWebView acceptance.

Initial source-only TypeScript narrowing and test union/const lint errors were
corrected. One initial fixture used unsupported legacy raw true instead of actual
complete and was refused by the actual V3 codec; the fixture now follows the existing
contract. Original logs remain non-acceptance evidence, not relabeled. Independent
complete CODE and final baseline evidence appear below. All grants remain false; no
application/root/file/delivery/SQL/SDK consumer, default/flag/native activation,
real-data access, signing/install/upload/hosted change or Git mutation.

### S6e independent CODE correction — 2026-10-26

Initial independent CODE review found one P2 ownership defect: the private plaintext
copy was wiped, but the actual JavaScript-accessible ArrayBuffer returned by native
decrypt remained populated after successful opening and authenticated encoding
refusal. This was not an unavoidable engine-internal memory claim. The corrected
path intrinsically admits exact native buffer brand/length first, then registers an
owned view of that actual plaintext before allocating its verification copy. Both
are overwritten only after all observed work settles. Unadmitted malformed outputs
are not mutated; strings/engine/provider memory still carry no secure-erasure claim.

The two original actual-WebCrypto failure witnesses and twelve passing independent
controls were adopted into the focused test. Adjacent checks cover invalid archive,
unavailable post-decrypt hashing and native plaintext retention during pending
post-decrypt hashing, for both eventual success and refusal. Parent corrected focus
5 files/282 tests PASS; TypeScript and diffcheck PASS. An initial test prefer-const
lint issue was corrected and focused ESLint passed. Final corrected CODE and full
baseline evidence appear below; no operational-transfer or device acceptance follows.


### S6e actual corrected acceptance — 2026-10-26

Complete corrected independent CODE PASS: 6 focus files/303 tests, all 14 original
independent probes and 7 adjacent lifetime/isolation probes PASS. The actual native
decrypt plaintext and private verification copy are wiped after complete observed
work, on success and later archive/encoding/hash refusal; pending work does not
trigger premature wiping. Unadmitted buffers and encrypt outputs remain unchanged.
Actual isolated Chromium WebCrypto with both directions of independent Node GCM
interoperation PASS. Independent TypeScript, focused ESLint and diffcheck PASS.
These counts overlap. Initial failing evidence remains preserved, not relabeled.
Independent logs: /tmp/curling-independent-review/s6e-focus-corrected.log,
/tmp/curling-independent-review/s6e-own-corrected.log,
/tmp/curling-independent-review/s6e-adjacent.log,
/tmp/curling-independent-review/s6e-browser-corrected.log and
/tmp/curling-independent-review/s6e-{types,lint}-corrected.log.

Final parent baseline: 366 root files/8191 tests PASS; 139/139 Playwright PASS;
Web build PASS; mobile verify 10 files/277 tests plus type/build PASS. Positive
ECONNREFUSED on 127.0.0.1:3100 proves test-server shutdown; subsequent TypeScript,
root/mobile lint and diffcheck PASS. Logs: /tmp/curling-s6e-root-final.log,
/tmp/curling-s6e-e2e-final.log, /tmp/curling-s6e-web-final.log,
/tmp/curling-s6e-mobile-final.log, /tmp/curling-s6e-server-stop-final.log,
/tmp/curling-s6e-types-post-stop-final.log and
/tmp/curling-s6e-{lint,mobile-lint}-final.log. No SQL/Swift changes or expanded
physical/platform-memory evidence are implied.

S6e is an accepted private protected-envelope prerequisite, not the completed
installation transfer. The isolated old-bundle source helper and writer exclusion,
actual file/code delivery, target atomic staging/readback and fresh authentication
with current denial checks remain open. Actual configuration, original-installation
preservation, iPhone/Brower, hosted migration/legal/worker/permissions, old-client
coordination and Apple release gates remain separate. Q4 remains unapproved and
deferred to a concrete device/restore example. The free closed pilot still requires
no billing, price/seat enforcement or final Personal naming; Team membership grants
no Personal subscription. Team email links may continue opening Web under §6.5.
All mayIssue/mayPublish/mayMount flags remain false, with no app/root/file/native/
storage/network/SDK consumer added. Start and final Git: 0 staged/83 modified/178
untracked, main/all refs382ee40 unchanged. No Git mutation, actual configuration
assignment, activation, original iPhone access/change, installation, signing, upload
or hosted publication. No Beta approval.


## S6f — Isolated source-helper observation boot

Corrected independent technical DESIGN and complete CODE accepted; full local baseline PASS, 26 October 2026. Read
docs/AI_DEVELOPMENT_WORKFLOW.md before this task. User requested local beta completion;
only the existing independent read-only reviewer is authorized. Repository main,
HEAD/main/origin/main382ee40,0 staged/83 modified/178 untracked. Preserve all changes;
no Git mutations, environment inspection, original-data/device operations, actual
configuration assignments, native/default activation, signing/install/hosted actions.

### Outcome and explicit authority limits

Build a separate local source-helper entry with one private native identity/foreground
check, actual S6d read-only observation and terminal lifetime. This is a coherent
boot/observation prerequisite, not an export/backup/working installation transfer.
Existing MobileApp/Tracker/Identity/default composition and mobile Vite config cannot
be reused: they load application writers or cloud configuration. Source preservation,
Free pilot/Team != Personal, Q3 and deferred Q4 remain unchanged. S2 C8–C10 remain
unadopted; no operational owner_frozen proof can be inferred from AppInfo, graph
isolation, observation/fences or a caller Boolean.

Allowed scope: new transfer-source/{index.html,helper.css,vite.config.ts,src/main.ts,
src/sourceHelper.ts}, exact focused root tests, package script, precise dist ignore,
one exact generated-dist ignore in eslint.config.mjs,
existing exact architecture/default/mobile bundle guards, canonical S6f status and
brief readiness/architecture references only after DESIGN PASS. Actual S6d/V3/
protection/observer/native/SQL/SDK/default implementation remains unchanged.

### Separate artifact

New `transfer-source:build` script builds only transfer-source/vite.config.ts into
transfer-source/dist, relative base, target es2022, no sourcemap/public copying or
React/Tailwind/application plugins. envDir:false and no loadEnv/config values.
Disable module-preload polyfill generation; do not add application fetch helpers.
Only transfer-source/dist/** is newly ignored by Git/ESLint; helper source/config/
tests remain covered. Put Vite cache under the already ignored root node_modules.
Existing capacitor.config.ts webDir/appId, native project and all mobile flags stay
unchanged; no cap sync. This artifact cannot become the default installable app by
running the normal build. No third app identity or installation procedure is created.
HTML language English (U.S. beta), strict local CSP with connect-src 'none', no forms,
frames, external fonts/assets, analytics, networking, file/share or raw diagnostics.
Plain DOM bootstrap/CSS, no React effects or framework app tree.

Build inspection records actual retained module IDs via build output in test only
(not a production diagnostic artifact), resolves the exact transitive closure and
asserts an explicit reviewed module allowlist. This permits existing pure identity
validators in S6d's static import graph, not identity repository/SDK construction.
Pin actual bundle absence of normal app, SDK/config/client/API, SQLite/Keychain,
storage writes/removals, transfer codec/protection and authentication/release markers.
Actual local graph preflight /tmp/curling-s6f-graph-preflight.log found the installed
Capacitor core retains its own generic Http/fetch definitions and plugin registration
alongside the needed App dispatcher. Do not mistake inert shared-core definitions
for issued network work or solve this by a core fork/blanket tree-shaking exception.
Allow only the exact installed core/App modules; statically restrict helper entry/
owner calls to Capacitor platform/plugin checks and actual App lifecycle/info APIs,
plus the exact S6d methods and platform observer. No Http/Cookies/general plugin or
network method is imported/called by helper/source code. Test executed startup and
inspection with network/storage-writing traps and enforce connect-src 'none'.
No broad sideEffects:false or arbitrary dependency exception to make the gate pass.
Default/Diagnostics/Native-storage bundles must remain source-helper-free.

### Private owner surface and host binding

Export only `createInstallationTransferSourceHelper()` (arity0) from sourceHelper.ts;
only the dedicated main entry is an actual production caller, pinned by AST guards.
No constructor arguments, injected ports, identity flags or source proof inputs.
Construction has no foreign global/plugin/storage operation. Return frozen null-proto
owner with inspect():owned Promise<Result>, close():owned Promise<void> and a
single owned whenRevoked:Promise<Code> signal (the bounded CODE correction below).
It carries only an existing fixed state code and resolves once at logical revocation,
after close identity installation and before foreign teardown. It never acknowledges
joined/native cleanup. Directly observed exact signal work is owned and never admitted
as a plugin value. This is not a callback-subscription or general public event API.
Results contain only fixed ok/kind/code, primitive counts on success and constant
mayIssue/mayPublish/mayMount:false. Closed codes: unavailable, wrong_host, closed,
source_changed, source_unhealthy, source_unsupported. No raw values, keys, IDs,
AppInfo metadata, proofs, source adapters, snapshot DTO, wire or recovery code escapes.

At first inspect, dynamically load actual @capacitor/core INSIDE the already owned
work and currentness fences; no eager value import initializes Core/App before this.
After actual Capacitor isNativePlatform/getPlatform/isPluginAvailable('App') establish
native iOS and positive native App availability, dynamically load @capacitor/app under
the same owned work. These are genuine module-loader operations, not injected ports.
Capture actual methods with receiver and intrinsic application; no arbitrary call/
bind properties. Core's actual App receiver is a Proxy generating wrappers for
arbitrary properties INCLUDING then. NEVER pass this receiver through generic
thenable observation/assimilation, including failure draining. Bounded receiver
admission: require nonnull object from the actual loaded App export; exclude exact
already owned helper work before probing (never admit it); then intrinsically probe
native Promise brand with the captured Promise.prototype.then (no receiver.then
read); a native-Promise candidate is observed/drained and refused. The admitted exact
non-Promise App receiver is an inert lifetime leaf before required method capture,
including later failures and malformed fulfillment children. Read only the exact
required known platform method properties; actual Proxy methods are not own data
descriptors. Observe/drain their captured metadata and every actual issued plugin
result normally. Inert receiver exclusion grants no value, listener/removal ACK or
right. No actual App.then/Http/Cookies/other unintended plugin invocation is permitted.
Shared observer/S6d remain unchanged; C4 trusted actual module/bootstrap prerequisite
is explicit, not arbitrary plugin-object attestation.
Register actual App appStateChange listener before getState/getInfo;
getState must positively report own data isActive:true. Validate actual App.getInfo
via safe own data descriptors: id exactly local.dev.curlingperformance, nonempty
version/build within existing Label grammar and64-unit bounds. Do not read name or
unrelated fields. A nonnative/wrong/malformed host refuses before constructing or
calling source. App identity is a routing constraint only, never original-container
or source-authenticity proof. No storage-origin selection, fallback or rebinding.

After successful admission, create the real S6d source once and call capture(). Use
its actual own result, retaining no more than that source's already bounded map and
one private proof. Recheck actual foreground state and AppInfo binding, then invoke
actual source.fence(proof) before returning observation counts. Later inspections
repeat actual metadata/currentness and recapture; no cached positive host/observation
permits access. A metadata change or source/fence failure terminally closes this
owner and revokes its source. No retry resurrects it. Healthy wrong-host rejection
also remains terminal (a new entry/lifetime is required). Concurrent inspect calls
return fixed unavailable; no hidden queue or second capture. All grants remain false.

### Work/lifetime ownership

Install the complete inspection Promise/phase and lifetime-close identity before any
foreign platform/global/plugin/read/reflection/callback operation. Capture and retain
every directly observed potential work root, including descriptor value/get/set and
late listener handle/remove metadata. Use actual boxed observePlatformWork and
completion-only drain with per-root memoization; no raw unknown Promise assimilation.
Require synchronous platform metadata to remain the identical observed value, never
accept asynchronously supplied substitutes. Only true issued plugin results may be
async. Safe own descriptor membership precedes known field access; metadata accessors
are not invoked. Unknown/opaque reasons are never inspected or logged.

Only one inspection at a time, one lifecycle listener registration, one actual S6d
source and at most one pending callback observation (overlap conservatively closes
before reading another payload). Completed per-operation/callback roots are released;
do not accumulate unbounded metadata history across repeated inspections/events.
Exact owned inspection/close work observed by THIS HELPER may be excluded recursively
only because this owner already drains it, never accepted as a plugin/positive value.
This does NOT propagate new exclusions into unchanged S6d's internal observer. S6d
keeps its own exact-source-work/inert-Storage support and C4 provider-return boundary.
A malformed source getter returning helper.inspect()/helper.close() whose settlement
depends on that same source operation is an unsupported cyclic provider return and
may remain pending. Do not claim it drained, acknowledge close early, time it out,
swallow pending work or widen legacy observers to disguise this explicit limitation.
C4 cooperative platform/bootstrap/intrinsic and hidden work/cycle limitations remain.
No broad platform attestation, timeout-generated success or cancellation-as-settlement.

Any appStateChange whose own data isActive is not exactly true synchronously revokes
continuation and starts close; malformed callback metadata is retained/drained without
invoking its accessor. The callback itself is owned before field observation, returns
void (not close/inspection Promise to the platform), and cannot revive inspection.
The entry installs pagehide and visibilitychange before inspection; INITIAL document
visibility must also be visible before inspection is enabled, otherwise close without
any plugin/source work. Either later hide event closes synchronously. Native background
proof remains physical acceptance, not a DOM
event claim. No new work after close. Late actual listener registrations are removed
exactly once with captured remove method; no removeAllListeners. Drain pending plugin,
callback and source work through actual settlement before close resolves. A public JS
remove receipt is not physical native unsubscription evidence. No normal app mount,
writer/credential/cloud operation or source cleanup, even after refusal.

### Minimal user surface

Dedicated entry exposes one data-check action, busy state and fixed observed/refused/
ended status. State says source observation completed only, never backup/transfer or
safe install complete. No technical slot/key/algorithm controls in the user flow.
Nothing sensitive is rendered. After hidden/pagehide/close, disable further checking
and require a new helper lifetime; late results cannot replace ended status. Remove
DOM listeners when the entry ends. No runtime switch/query/stored preference to enter
this helper from normal training.

### Verification and remaining gate

Focused tests: genuine synthetic Web Storage (actual S6d), excluded raw reads zero;
actual installed App Proxy arbitrary-then behavior, with no unintended then/Http/
Cookies calls even after later capture refusal; initial hidden document zero work;
web/unknown-native/wrong ID/malformed host means zero source/storage reads; routing
identity cannot become frozen/grant; native listener precedes state/info; exact
AppInfo own descriptors, malformed/pending/masked metadata/work, opaque reasons;
close or background during state/info/capture/fence, stale metadata and source change;
late handles/removal settlement, callback work, own-close exclusions, double close,
supported direct helper-own versus existing S6d-own controls kept separate (no
universal parent/child cyclic-return containment claim), bounded callback overlap,
concurrent calls, every output all grants false and no private values; actual built
artifact closure/CSP/no cloud/writers; actual normal three-mode bundle absence.
Tests may mock installed plugin exports solely in test, never expose production
injection. Distinct actual synthetic browser probe may prove DOM behavior, never iOS.

After corrected independent DESIGN PASS: implement, focused tests/TS/lint/diff,
complete independent CODE, root tests then Web/mobile/helper builds, all139E2E,
positive test-server shutdown then TS/root+mobilelint/diff; record exact evidence,
truthful architecture/Readiness and Vault progress. No installation allowed.

Operational packaging remains blocked by a separately accepted preservation-safe
procedure for actual original WKWebView-container access and external-writer
exclusion with disposable physical evidence. No source update or new-bundle install
is authorized or performed here. Future packaging must stay inside S6d's private
value ownership, not add a raw resolver. Protected file/code delivery, target atomic
staging/readback/fresh-auth denial-aware admission and actual device/release gates
remain open. Local build/observation acceptance must not waive those gates.

### S6f implementation evidence before independent CODE — 2026-10-26

The separate transfer-source artifact and private inspect/close owner are locally
implemented. Actual Core/App loading is dynamic inside owned work; native iOS/App
availability and bounded original-ID/version/build routing precede actual S6d reads.
The installed App Proxy is never generically assimilated: its admitted exact identity
is a non-grant inert leaf, while actual issued work remains boxed and owned. The
unchanged S6d C4 cyclic-provider limitation remains explicit. Initial hidden entry,
background/pagehide revocation, late handles and pending removal are covered.

Parent focus7 files/309 tests PASS; TypeScript, focused ESLint and diffcheck PASS.
The actual built helper's exact16 retained modules are pinned, including installed
Core's inert generic HTTP definitions; no source writes or application/SDK/codec/
protection consumer is admitted. Genuine synthetic Web Storage and the installed
Core/App proxy are used. Actual built-artifact Chromium probe PASS with a synthetic
native bridge: source exclusions, zero storage writes/network/App.then calls, Web/
initial-hidden refusal and pagehide during pending info plus late cleanup. Probe
source /tmp/curling-s6f-browser-probe.mjs, log /tmp/curling-s6f-browser-probe.log.
This proves JS ordering and browser artifact behavior, not original WKWebView access
or actual iPhone lifecycle/bridge receipt/writer exclusion. Logs:
/tmp/curling-s6f-focus-ready-corrected.log, /tmp/curling-s6f-types-ready-corrected.log,
/tmp/curling-s6f-lint-ready-corrected.log, /tmp/curling-s6f-build-ready.log.

Initial TypeScript control-flow narrowing was corrected. The first build assertion
incorrectly banned the credential exclusion stem needed by the existing inventory;
it now bans actual writer/SDK/activation artifacts and pins exact dependencies while
runtime checks still prove excluded credential values are never read. Original
failure evidence is retained. Complete independent CODE, actual normal three-mode
bundle matrix and full baseline evidence appear below. No operational packaging,
original data/device access, configuration/native/default activation or Git mutation.

### S6f independent CODE correction — 2026-10-26

Initial complete independent CODE found three P2 families: the same admitted inert
App receiver was wrongly rejected as own pending work on healthy reinspection;
native idle close did not reach a still-visible entry without a DOM event; and
invalid version metadata was refused only after observing the later build field.

The corrected owner separates exact owned work from inert App identities, retains
fresh routing/source capture/fence checks and only one listener. Each AppInfo field
is validated immediately before the next descriptor; native/platform/availability
checks now also stop before later method metadata after known refusal. The private
single whenRevoked signal carries only an existing fixed code, is installed before
foreign work and resolves once at logical revocation. Close still separately joins
actual observed inspection/callback/source/removal work. The signal is never an
operation value or cleanup/physical ACK. The entry observes it directly, keeps fixed
refusal text and suppresses all late success updates after termination.

All11 original independent probes (three failures and eight controls) were adopted
with the same assertions. Additional actual owner/entry cases cover healthy repeated
checks, fresh source recapture, native close during pending info/removal, exact signal
exclusion and early native refusal. Parent corrected focus7 files/326 tests PASS;
TypeScript, focused ESLint and diffcheck PASS. Initial test lint findings (a reserved
module variable and unused placeholder argument) were corrected. Actual helper build
PASS; corrected built-artifact Chromium probe covers healthy repetition and immediate
native idle/pending revocation. No S6d/shared observer/legacy/native/default change.
Corrected complete independent CODE and final full baseline evidence appear below.


### S6f actual corrected acceptance — 2026-10-26

Actual bounded changes: eight new transfer-source files (index.html, helper.css,
vite.config.ts, src/main.ts, src/sourceHelper.ts and three __tests__ files); the
new package build script; exact generated-output ignores in .gitignore and
eslint.config.mjs; existing architectureBoundary/mobile bundle guards; canonical
specification/readiness and the five existing architecture references. Earlier
working-tree changes in these files are preserved. No dependency/version or actual
native/default/source/observer/codec/protection implementation change was made here.

Complete corrected independent CODE PASS: 7 focus files/284 tests, all 11 original
independent counterexamples and 9 additional signal/lifetime controls PASS. These
counts overlap. All three original P2s are corrected: healthy repeated inspections
reuse the admitted inert App receiver while recapturing current data; native logical
revocation immediately terminates the visible entry; invalid earlier host metadata
refuses before later fields/work. The first fixed revocation reason is stable and
does not acknowledge cleanup. Pending removal/source/plugin work still delays close.
The actual installed App proxy is never assimilated through an unintended then call.
Independent fresh helper build and actual built-artifact Chromium probe PASS;
positive ECONNREFUSED confirms that probe's local server stopped. Independent
TypeScript, focused ESLint and diffcheck PASS. Prior actual Default/Diagnostics/
Native-storage matrix remains valid (15/15 bundle controls each, default restored):
the bounded corrections did not change the normal graph or flags. Original failing
evidence remains preserved. Logs: /tmp/curling-independent-review/s6f-focus-corrected.log,
/tmp/curling-independent-review/s6f-own-corrected.log,
/tmp/curling-independent-review/s6f-signal.log,
/tmp/curling-independent-review/s6f-browser-corrected.log and
/tmp/curling-independent-review/s6f-matrix-results.json.

Parent corrected focus7 files/326 tests, actual helper build and built-artifact
Chromium probe PASS. Final complete baseline: 369 root files/8246 tests PASS;
139/139 Playwright PASS; Web build PASS; mobile verify10 files/277 tests plus
type/build PASS; separate helper build PASS. Positive ECONNREFUSED on127.0.0.1:3100
proves the E2E test server stopped, followed by TypeScript, root/mobile lint and
diffcheck PASS. Logs: /tmp/curling-s6f-root-final.log,
/tmp/curling-s6f-e2e-final.log, /tmp/curling-s6f-web-final.log,
/tmp/curling-s6f-mobile-final.log, /tmp/curling-s6f-helper-final.log,
/tmp/curling-s6f-server-stop-final.log, /tmp/curling-s6f-types-post-stop-final.log
and /tmp/curling-s6f-{lint,mobile-lint}-final.log. The synthetic browser bridge proves
JavaScript/artifact behavior, not physical App/WKWebView lifecycle or native receipt.

This accepts a separate local observation boot only. No operational source package
is installed or connected to the protected archive. Actual original WKWebView
container access, a preservation-safe procedure and exclusion of external writers
remain blocked prerequisites requiring disposable physical evidence. AppInfo routing,
static dependency isolation and repeated observation/fences do not establish those
facts. Actual protected file/code delivery, target atomic staging/readback and fresh
authentication with current denials remain unfinished. S2 C8–C10 remain unadopted;
all mayIssue/mayPublish/mayMount flags stay false. Actual configuration, original-data
preservation, iPhone/Brower, hosted/legal/worker/permissions, old-client and Apple
gates remain separate. Q4 is deferred, not accepted. Free closed pilot needs no
billing/price/seat enforcement or final Personal name; Team membership is not Personal.
Native Team links may continue opening Web under §6.5. No Beta approval.

Git start0 staged/83 modified/178 untracked paths; final0/85/179. The new helper
directory is one untracked porcelain path; the precise .gitignore/ESLint changes
account for the two newly modified tracked paths. Branch main and all three refs
382ee40 remain unchanged. No staging/commit/push, actual configuration assignment,
native/default activation, original iPhone access/change, sync/install, signing,
upload or hosted change. Existing local data and the default app are untouched.


S6g cross-reference: the dormant iOS-only encrypted archive quarantine prerequisite
is now locally implemented and independently accepted (ADR-0054; canonical scope
in `MOBILE_APP_MIGRATION.md`, “S6g — protected archive quarantine”; actual verification
in `TESTFLIGHT_READINESS.md`). Its sole private owner consumes actual S6e opening;
normal application builds remain free of concrete quarantine code. This does not
adopt C8–C10, publish sporting rows, supply identity/source authority or complete
operational installation transfer. The observation-only S6f helper is unchanged.


S6h extends the dormant transfer preparation on the same SQLite owner with exact
reversible UTF-16 sporting rows beside the encrypted archive. Independent scoped
DESIGN/CODE review is accepted; complete regression evidence is recorded in
`TESTFLIGHT_READINESS.md`. The canonical contract is `MOBILE_APP_MIGRATION.md`,
“S6h — actual native sporting preparation”. These rows are unselected and cannot
be consumed by ordinary stores; fresh authentication, source-deny checks and
publication remain required. This is encoding, not sporting-data encryption at rest.


S6i's genuine SQL/protected-namespace pair, S6j's identity-only runtime and S6k's
actual configured SDK/coordinator integration are locally independently accepted.
S6l1 adds immutable negative-only source facts on the same owner, including all
sporting and control-only Profiles and original guard nonces/revisions. Only the
closed host owner selects its exact 8-object layout; old 5/7-object constructors
retain their behavior. Source-only boxed opening and strict transaction work
preserve cancellation, actual completion ownership and cleanup. Corrected CODE
and full local regression are accepted. Exact contracts: MOBILE_APP_MIGRATION.md
S6i–k/S6l1; current evidence: TESTFLIGHT_READINESS.md. S6l2 adds an independently
accepted genuine OTP proof and same-runtime SQL pin, with synchronous mutation
revocation and genuine completion ownership through full drain. Its exact contract
is MOBILE_APP_MIGRATION.md S6l2. S6l3 completes the genuine OTP/onboarding
continuation and full source-host online checks; corrected independent CODE and
full local regression are accepted. S6l4 adds independently accepted actual
original-guard recovery with negative revision floors, same-pair guard composition
and exact completion ownership. S6l5 adds strict v2 immutable source cleanup
evidence and final actual server-control provenance bound to original OTP/SDK/SQL
ownership, with synchronous revocation and no resurrection. Old v1 targets refuse
unchanged. S6m1 adds independently accepted initial source eligibility/exact
Profile membership and a durable protected publication intent bound to original
OTP/Control, all source rows and the actual pair. Same-core draft/cold validation
and completion-only cross-lane ownership are fully locally checked. Canonical
contract: MOBILE_APP_MIGRATION.md S6m1; evidence: TESTFLIGHT_READINESS.md. S6m2
adds independently accepted atomic publication on the same SQL core: exact all-Profile
u16 copy/receipt, genuine new protected observation, consumed original stamps,
durable content/schema pin and factual outcomes separate from auth/cleanup. Its
actual source-owner path and full local regression are accepted. S6m3a separately
completes independently reviewed cold artifact provenance on the same actual stores,
without original file/code, runtime readiness or a source retention cap on future live
data. S6m3b1/b2 complete the same-owner paired store runtime and preserved
source-negative guards. S6m3c completes the distinct dormant configured normal host
through the actual SDK/coordinator/account/Profile/Tracker paths. Genuine current
admission remains required; original publication identity is historical. A real cold
process honors the unchanged SDK root fence, and actual policy work drains before
physical published-store closure. S6m3d independently verifies the existing explicit
App composition over that actual Host, including real UI training and cold persistence;
no shipped root/caller is activated. Operational source transport/writer exclusion,
file/code delivery and physical/release acceptance still gate import and Beta. Canonical
S6m contracts/evidence remain in the same two documents; Q4 remains unapproved.


### Destination application workflow mandate — 27 October 2026

The user explicitly requests local completion of the actual installation-import flow and subsequent normal application entry. No second iPhone is available; omit a comparison that requires a second physical device and retain the missing evidence explicitly. This does not accept Q4, reset/data loss, unsafe original-app replacement or unverified source-writer exclusion. A separate same-device application can supply selected disposable-data evidence but cannot inherit the old container by its different identifier. No device installation is performed or authorized by this local implementation.

S6n1 starts the actual application control connection to the existing genuine source-aware Host: current Account recovery, protected preparation and atomic publication remain the accepted implementations on the same Owner. Its corrected independent DESIGN is recorded in MOBILE_APP_MIGRATION.md. Subsequent File/code/Provider presentation and explicit normal cold-entry composition must join these actual controls rather than synthesize Ready, Profile or source grants. Operative original-container/writer exclusion, protected source delivery, actual configuration/physical and hosted/Apple gates remain separately open. Free Beta, Team != Personal and Q1/Q3 are unchanged.


S6n1 and corrected S6n2 are now independently CODE accepted: actual public import controls, native File intake, genuine Provider/recovery and subsequent new-process normal training form one tested explicit destination workflow. This replaces the earlier presentation-blueprint status, not the unselected shipped-root or unfinished operative-source status. Canonical current contract and boundaries are MOBILE_APP_MIGRATION.md S6n1–2; exact current full verification is TESTFLIGHT_READINESS.md. No source file/code is fabricated from the existing training-only backup, no original installation is changed, and no Beta/device/Q4 approval follows.


## Legal contact correction — 27 October 2026

The owner corrected the operator contact: `info@evolane.swiss` does not exist;
`notifications@evolane.me` is the only existing Evolane email address. Use it for
all contact and data-rights links in the new current Privacy Notice and Terms.
Publish immutable `privacy-2026-10-27` and `terms-2026-10-27` versions; the only
content correction is that address, alongside version/effective-date metadata.
Preserve the August and 24 October accepted texts byte-for-byte. Point `/privacy`
and `/terms` to the new versions. Deploy and verify both new routes before the
separate guarded database rotation from the exact 24 October pair. Do not rewrite
past acceptances or introduce mandatory reacceptance for existing users. This
correction does not change processing, product rules, or the existing beta scope.
