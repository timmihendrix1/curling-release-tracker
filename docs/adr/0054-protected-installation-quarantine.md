# ADR-0054: Dormant protected installation quarantine

Status: Accepted and implemented locally after corrected independent DESIGN/CODE and full regression; dormant (S6g).

A protected installation archive needs durable target evidence before any later
publication. The existing training-only backup omits identity evidence and is not
a V3 archive. It cannot be promoted by fabricating missing identity observations.

S6g adds an inert iOS-only owner that authenticates actual ADR-0053 envelopes before
target work. It uses the existing native SQLite core, ownership registry, queue
and handle. One mutually exclusive exact table holds one encrypted ASCII artifact
and its actual authenticated V3 digest. Schema and row commit together; existing
records/credential layouts conflict. Ordinary modes refuse quarantine layouts.

Every issued commit requires positive close, native handle release, fresh open and
complete schema/row readback. No post-commit rollback or compensating deletion is
allowed. Warm evidence loss is a sticky fault retaining the logical reservation
after physical cleanup. Cold discovery establishes structure only. Pending work
holds ownership through actual settlement; explicit close revokes synchronously
and retries cleanup only. Engine receipts do not establish physical durability.

A separate database would bypass existing ownership; ordinary records metadata
would mix unadmitted archive data with application state. Both are rejected.
Storing the encrypted ASCII envelope avoids claiming arbitrary UTF-16 bridge TEXT
fidelity. No key, plaintext or recovery code is stored. Construction and all normal
builds remain dormant; results never grant issue, publication or mount authority.

This is not adoption of the full C8–C10 candidate. Sporting-row publication,
D/Q/F coexistence, fresh authentication, source denial, original-container delivery
and physical device acceptance remain separate gates. Canonical S6g specification:
`MOBILE_APP_MIGRATION.md`, section “S6g — protected archive quarantine”.


S6h adds a distinct private preparation constructor on that same owner. It stages
only actual authenticated, domain- and catalog-validated present sporting raws in
an atomic unselected dataset, reversibly encoded as lowercase `u16:` codeunits.
This avoids relying on bridge fidelity for NUL or lone surrogates; it is not
encryption at rest. The original single-quarantine constructor refuses the extended
layout, as do all ordinary stores. Identity and legacy bytes stay exclusively in
the original encrypted archive. Exact transactions, durable readback and sticky
ownership rules extend to the complete prepared dataset. No identity, publication
or mount grant follows. Canonical S6h contract and review limits are recorded in
`MOBILE_APP_MIGRATION.md` and `TESTFLIGHT_READINESS.md`.


S6i extends the new transfer protocol with immutable SQL intent and binding rows
on that same owner, paired with an actually empty protected namespace and new
empty Q/M. This new anchor replaces D only for installation transfer; no legacy
Dactive is synthesized. Cold intent resumes the same IDs, while missing paired
manifest/orphan/foreign evidence blocks. Actual original lifecycle work must settle
with exact void acknowledgements before flags change; paired cleanup authenticates
both healthy receipts before synchronous logical retirement. Source credentials,
SDK/identity admission and sporting publication remain excluded. Independent
corrected DESIGN/CODE and full local regression accepted; canonical scope and
limits remain in MOBILE_APP_MIGRATION.md S6i and TESTFLIGHT_READINESS.md.


S6j's approved extension prepares genuine identity-only domain/credential runtime
roles on the same S6i owners, with empty destination identity rows and no source
identity/credential adoption. It uses same-connection acknowledged runtime writes
and retryable cleanup-only disposal while preserving evidence-held reservations.
Corrected independent CODE and full local regression are accepted; the exact
contract and verification limits are canonical in
MOBILE_APP_MIGRATION.md S6j and TESTFLIGHT_READINESS.md. It grants no fresh-auth,
sporting publication, ordinary host/UI or physical-device readiness.


S6k privately connects the genuine identity-only pair to the existing actual
configured native host, SDK and coordinator. A builder confined to the unused new
export preserves actual bundle dormancy; legacy constructors keep their source
and settlement behavior. Strict transfer-only port capture/observation and actual
host completion exclusion prevent cleanup cycles without creating readiness.
The captured dependency receiver retains no transfer input; recovery code is
ephemeral. Store-only cleanup may retry with both owners held, caching only
positive terminal SDK disposal. Sticky SDK uncertainty keeps its authentic SDK
reservation/evidence even if healthy stores independently clean positively.
Corrected independent CODE and full local regression are accepted; exact scope
and evidence are MOBILE_APP_MIGRATION.md S6k and TESTFLIGHT_READINESS.md. Actual
OTP/legal/onboarding establishes identity only: deliberate fresh-OTP publication
proof, immutable source denial and sporting publication/normal handoff/UI remain
separate gates. No normal application caller, activation or physical acceptance.

S6l1's adopted extension retains a separate immutable negative-only projection
from the authenticated complete archive, including control-only Profiles and
original guard nonces/revisions. It does not restore positive source identity.
The independent evaluator/handle and corrected same-owner source-aware 8-object
persistence/host CODE gates and complete local regression are accepted.
Its private optional opening hooks preserve legacy core branches. Exact
protocol, bounds, source-only method/work rules and remaining verification gates
are canonical in MOBILE_APP_MIGRATION.md S6l1. No source-denial clearance, fresh
OTP publication proof or sporting access follows from this metadata.


S6l2 adds genuine coordinator-origin email-OTP provenance and a private same-runtime
source SQL pin, without relabelling optimistic readiness or generic admission.
Accepted-enqueue mutation fencing revokes immediately; finalization remains inside
the genuine owned completion through full drain. A refused first pin consumes the
event. Corrected independent CODE and full local regression accepted; canonical
contract and evidence remain MOBILE_APP_MIGRATION.md S6l2 and TESTFLIGHT_READINESS.md.
The complete linked OTP/onboarding flow, source-denial/guard recovery, publication,
normal handoff/UI and physical/release gates remain separate. No publication or
Beta grant follows from the private proof primitive.


S6l3 completes genuine OTP provenance through actual incomplete-Profile onboarding
only in the dormant source-aware host. Returning accounts also require full online
checks there. Original durable correlation, agreed Profile and actual prior-account
cleanup remain mandatory; exact-origin retirement prevents stale responses from
revoking newer continuations. Ordinary auth policy is unchanged. Corrected
independent CODE and complete local regression accepted; contract/evidence remain
MOBILE_APP_MIGRATION.md S6l3 and TESTFLIGHT_READINESS.md. Source-denial recovery,
Profile mapping and publication remain separate gates, with no public grant.


S6l4 reuses actual account-first state/cancel and conditional-abort rules for
original source deletion guards on the same genuine pair. Archived receipts remain
negative floors; new acknowledged destination receipts bind original nonces and
server revisions. Coordinator and recovery service require both original and
destination constraints. Refused effects preserve definitive pending denial;
exact owned completions and mutation claims preserve drain and monotonic evidence.
Independent DESIGN/repository/combined CODE and full local regression accepted.
Canonical scope/evidence:MOBILE_APP_MIGRATION.md S6l4 and TESTFLIGHT_READINESS.md.
Source-barrier clearance, Profile mapping, publication, source-free normal handoff/
UI and physical/release acceptance remain. No public access or Beta grant follows.


S6l5 uses strict source-denial v2 on the unchanged physical source table: actual
intent-cleanup debt remains immutable negative evidence, and prior v1 targets refuse
unchanged rather than imply absence. A separate final actual state-null observation
binds original OTP/SDK Command/token/generation/Control to the original current SQL
fresh stamp. Enqueue and SQL mutation revoke without resurrection; malformed private
delivery preserves genuine drain ownership. Helper loading stays in the closed
unused transfer builder. Independent DESIGN/CODE and full local regression accepted;
canonical contract/evidence:MOBILE_APP_MIGRATION.md S6l5a/b and TESTFLIGHT_READINESS.md.
No source clearance, Profile mapping, sporting publication, normal handoff/UI or
release grant follows from this current server-control prerequisite.


S6m1 adds the private insert-only protected publication intent and genuine opaque
observations on the same actual source-aware pair. It binds actual Q/M, immutable
source v2/all original sporting rows and original fresh OTP/final Control. Source
eligibility requires original Profile membership, no quarantine/cleanup debt and
exact account correlation when present. Historical intent requires new current
proof and unchanged bytes; it grants no current admission. Cold validation stays
outside protected/SQL lock inversion and precedes either runtime activation.
Actual SQL/credential producers share a genuine-session completion-only exclusion
view; native SQL malformed work revokes before draining, while pure metadata
refusal and valid pending work preserve healthy cleanup. Old constructors/default
SHA behavior remain unchanged. Independent DESIGN/combined CODE and full local
regression accepted; exact contract/evidence: MOBILE_APP_MIGRATION.md S6m1 and
TESTFLIGHT_READINESS.md. S6m2 separately completes the local atomic SQL publication prerequisite below; source-free normal host/Tracker/UI, source capture/transport and device/release acceptance remain separate gates.


S6m2 atomically adds the exact protected receipt and all-Profile u16 live copy on the original core/queue/lease. Its private exclusive mutation consumes the original stamps without reviving them; queue ownership persists through rollback, reopen, complete durable pinning and acquired-work drainage. Staged reads never pin durable facts. After the first complete durable content/schema pin, contradiction revokes before any further query. Real source-context completions are exclusion-only provenance, never ACKs or grants. M1 accept finalizes only after its last drain and genuine new occurrence is required for M2. The source owner's fresh protected read occurs outside SQL; pre-SQL sticky pair/port failure differs from healthy cancellation, and an actual SQL result is never overwritten by its intentionally consumed old Control. Healthy closure is not storage failure; positive cleanup remains independently required. Old/cold constructors refuse the eleven-object layout. Independent DESIGN/corrected combined CODE/full local baseline are accepted; exact contract/evidence:MOBILE_APP_MIGRATION.md S6m2 and TESTFLIGHT_READINESS.md. Source-free published runtime/Tracker/UI and operative/device/release gates remain open.


S6m3a adds independently accepted cold artifact provenance through a distinct closed same-core SQL facade and actual protected publication port. Fixed standard hashes and a full post-hash static reread precede a genuine private binding finalized after acquired-work drain/currentness. Mutable live data is not initial source evidence or subject to its retention budget. The binding remains migration-role provenance, never original SourceVerified, login or runtime readiness; old factories still refuse11. Exact local completion inspectors share exclusion only, without fake runtime sessions or recursive predicates. Options capture retains inadmissible acquired root work, validates each field immediately and cuts off on lifecycle loss. Genuine positive store cleanup does not clear an original SDK-only-held reservation. M3b runtime/negative guards and M3c actual configured host remain separate gates; exact contract/evidence are MOBILE_APP_MIGRATION.md and TESTFLIGHT_READINESS.md S6m3a. No operative/Beta or Q4 waiver.


S6m3b1/b2 add independently accepted dormant same-owner published runtime: monotonic cold-proof consumption, addressed mutable live data without source retention caps, stable genuine storage anchors, exact actual-observation credential preparation and coupled cleanup. Distinct published provenance supplies original negative guards without inventing a source handle. Older receipts never lower an observed destination floor; a valid actual guard remains unresolved for higher genuine recovery. Ordinary configured host/SDK and UI admission remain S6m3c/later gates. Canonical contract/evidence remain MOBILE_APP_MIGRATION.md and TESTFLIGHT_READINESS.md; no operative/Beta/Q4 waiver.


S6m3c adds the independently accepted distinct dormant configured published host through the existing actual SDK/coordinator/account/Profile/Tracker pipeline. Its private preparation owns the genuine published pair; exact host-completion exclusion grants no authority. Source-negative repositories apply actual per-call identity/effects restrictions around their own domain I/O and never fall back on a refused published hook. Published pair disposal joins actual policy/domain operations before physical resource closure through a private same-owner drain; old publishers are unchanged. The SDK one-construction-per-root fence remains, so a real cold process is required after positive old-host disposal. Historical publication identity is no future account/Profile allowlist. Canonical contract/evidence: MOBILE_APP_MIGRATION.md S6m3c and TESTFLIGHT_READINESS.md. S6m3d separately verifies the existing explicit App composition through genuine fresh-process SDK/SQLite UI training and cold persistence, without a production UI change or shipped root/caller. Operational source transport/writer exclusion, file/code delivery and physical/release gates remain open; Q4 remains unapproved.
