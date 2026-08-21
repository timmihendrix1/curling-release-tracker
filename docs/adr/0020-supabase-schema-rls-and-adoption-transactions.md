# ADR-0020: Supabase Schema, RLS Policy Model, and Transactional Local Adoption Backend

## Status

**Proposed. Incomplete design. BLOCKED — identity, bootstrap, and Local Adoption
authority-scope design (below) is not implementation-ready and must not be built as
written until the blocker is resolved.**

**Identity/authority-scope blocker (fourth Team Foundation correction pass,
2026-08-21) — read this before treating ANY of Decisions E.3/E.4/E.5/E.6/E.9/E.10,
`bootstrap_account()`, `backfill_domain_authority()`, the authority-completeness
proofs, the `assessment_runs`/`adoption_runs` composite foreign keys, the K.5
RLS/grant matrix, or the state/crash/adversarial-scenario tables in Sections N/O/Q as
current or executable.**

Two genuinely different problems are corrected here, and must not be conflated:

1. **Profile/Athlete identity — DECIDED, and this document was simply wrong.**
   `docs/adr/0022-team-foundation-domain-and-persistence.md` Decision 1 is the
   authoritative, already-implemented identity model: `Profile.id` is its own stable
   UUID, never equal to the Supabase Auth account id; the two are linked 1:1 through a
   separate `account_profile_links` table (`account_id` → `profile_id`), resolved by
   `private.current_profile_id()`, never by `profiles.id = auth.uid()` equality.
   Decision 10 additionally establishes that `Athlete` is a separate, lazily-created,
   optional capability — no RPC in the actual, implemented Team Foundation schema ever
   creates one automatically. This document's Decision E.3 (`public.profiles`) still
   states `id` (`= auth.users.id`) as a schema fact, and `bootstrap_account()` (Decision
   H.8 and Section M) still inserts `profiles` AND `athletes` together, unconditionally,
   for every new account — both directly contradict the real, decided model. These are
   corrected in place below (Decisions E.3/E.4 and every `bootstrap_account()`
   description) to state the real model as fact, not as a "read this as stale" footnote.
2. **Local Adoption's own `account_scope_id` — NOT decided, and this document must not
   pretend otherwise.** Every table this document's own adoption-transaction design
   introduces (`private.account_domain_authorities`, `private.adoption_runs`,
   `public.assessment_runs`, `public.assessment_history_tombstones`, and everything
   that locks, proves completeness over, or foreign-keys against them) is keyed by an
   `account_scope_id` column whose intended meaning this document never actually
   settled: `bootstrap_account()` inserts authority rows with
   `account_scope_id = auth.uid()` (account-scoped), while `backfill_domain_authority()`
   inserts them with `account_scope_id` drawn from `profiles.id` (Profile-scoped) — and
   numerous RLS policies (e.g. `assessment_runs_owner_select`, Decision K) and locking/
   proof steps (Decision H) assume `account_scope_id = auth.uid()` directly. Under the
   superseded identity model these two derivations happened to coincide (`profiles.id`
   *was* `auth.users.id`); under ADR-0022's real model they are two different UUIDs, so
   this design is internally inconsistent, not merely stale. **Whether Local Adoption
   authority should be account-scoped or Profile-scoped is a genuine, unmade
   architecture decision this correction pass does not make** — inventing an answer
   here would be a new product/architecture decision smuggled into a documentation
   fix, which this pass is explicitly not authorized to do. Every section listed above
   is therefore marked, at its own heading, as blocked on this specific open question,
   and none of their SQL, RPC bodies, or completeness proofs may be treated as
   implementation-ready until it is resolved by a dedicated decision (a future ADR or
   an explicit product/architecture decision record) that this document then adopts.

This remains a **targeted identity-model correction, not a wholesale rewrite** of this
still-Proposed, not-yet-built Local Adoption / cloud-authority-transaction design: the
SQL bodies affected by the blocker are left as written (removing them would delete
real design work this pass has no mandate to redo), but are no longer presented as
current or executable — each is marked in place. Any future implementation of this
ADR must first resolve the `account_scope_id` blocker, then reconcile every table,
function, proof, and matrix row named above with whichever scope that decision
chooses.

This is the **tenth** revision of this document. The first draft contained a factual
error about ADR-0019's fingerprint algorithm and a unit-of-staging error. The second
correction fixed those and reconstructed the transaction/conflict/security model. The
third correction fixed a schema that could not losslessly represent ADR-0019's own
source model, an unenforceable protocol-registry key-list constraint, several
non-atomic RPC bodies, an analysis step with no durable object for conflicts to bind
to, an error taxonomy with absent/duplicated codes, and several unverified RLS/grant
claims. The fourth revision was a narrowly scoped consistency and SQL-executability
pass, fixing: a "canonical base64" transport that was
not actually executable against PostgreSQL's own `encode(bytea, 'base64')` (which wraps
at 76 characters per RFC 2045) — replaced with hex; a `fingerprint_domain_snapshot` that
could silently treat a genuinely missing staged row as an explicit null via
`LEFT JOIN`/`COALESCE` — replaced with an `INNER JOIN`, an explicit staging-completeness
precondition in `analyze_adoption`, and an internal invariant check; a nullable-evaluating
`CHECK` on `adoption_conflicts` that PostgreSQL's own `NULL` semantics would have let
through unresolved; a `content_digest`/canonical-equality model left undefined —
resolved as `jsonb` equality plus a digest used only as an optimization, never proof, with
a distinct `cd1:` prefix (never `fp1:`, reserved for ADR-0019's own cross-system
protocol) and separate `ad1:`/`rd1:` analysis/resolution digests; a
`register_adoption_protocol` that relied on caught constraint exceptions rather than
total prevalidation, with no stated domain-existence precondition, concurrent-registration
behavior, or single-active-version-per-domain constraint; unresolved `(...)`/
`<migration_role>`/`entries[]` placeholders in RPC signatures and grants; a result
taxonomy reusing `fingerprint_mismatch`/`validation_failed`/`conflicts_present` as both
`analyze_adoption`'s own successful envelope values and (implicitly) `finalize_adoption`'s
failure codes, and mapping an unauthenticated `begin_adoption` call to `not_found`
instead of `unauthenticated`; incomplete object-privilege detail (the identity
sequence, default table/sequence privileges, the `private` schema's own role-level
baseline, extension-function grants, and exact table/function ownership); backfill
terminology that described `backfill_domain_authority` as reading `auth.users`, which it
never does; and remaining state/crash-table placeholders ("none new," "read that row,"
dash-only query cells).

**This fifth revision is a comprehensive correction pass**, built from four private
consistency matrices (the 16-RPC contract matrix; the authority/state-table matrix;
the database-object/schema/grant matrix; the representation-boundary matrix from JS
string through UTF-8 bytes, staged `bytea`, parsed JSON, canonical storage, and
reconstructed TS value) and applied together rather than one defect at a time, fixing:
a false claim that a `jsonb`-cast valid-JSON escape sequence for U+0000 "parses
normally" — it does not, and this is now a named, unresolved architecture blocker
(Decision E.2b), not a solved problem, gating every domain's `pilot` transition on
fixture-based evidence or a lossless encoding this document does not itself provide;
unaudited timestamp fidelity through `timestamptz` normalization, now confirmed
behavior-preserving against this repository's actual `new Date().toISOString()` call
sites; nonexistent `pg_jsonschema` `(jsonb, jsonb)`/`(jsonb)` signatures, corrected to
the actual `(json, jsonb)`/`(json)` forms with migration-time `to_regprocedure(...)`
assertions; a schema-scoped `ALTER DEFAULT PRIVILEGES` statement that could never have
closed the schema-**unscoped** global `PUBLIC EXECUTE` default, corrected to the two
statements each default actually requires; a direct contradiction between two sections
over whether `transition_adoption_protocol_status` treats a same-status request as an
idempotent no-op or an `invalid_transition` (resolved in favor of the no-op), plus a
domain-scoped advisory lock closing a race between two protocol versions of the same
domain both transitioning to `pilot`; an incompletely defined `backfill_domain_authority`
(missing/wrong protocol, retries, concurrent calls, and legitimate post-transition
re-calls, all now named); undefined terminal-state retries for `begin_adoption` (after
its own run has since committed or aborted), `stage_adoption_entries` (after
`analysis_frozen`), and `resolve_adoption_conflicts` (after `ready`) — each previously
either undefined or falsely reporting a stale status; a `query_adoption_analysis`
response that withheld `canonical_candidate` behind a reference to an unspecified,
nonexistent future fetch mechanism, now returned directly as `canonicalCandidate`; a
bare "over (tuple)" description of `analysis_digest`/`resolution_digest`, now an exact,
reproducible byte framing with golden vectors; a reused `sourceEntryCount` name
covering two different counts, split into `stagedEntryCount` for the mutable one;
state/crash-table cells still reading a bare "none" where local data was actually
visible/writable, and four RPCs (`bootstrap_account`, `register_adoption_protocol`,
`transition_adoption_protocol_status`, `backfill_domain_authority`) missing from the
crash table entirely; two `SECURITY INVOKER` functions mislabeled `SECURITY DEFINER` in
the ownership section; an unused `updated_at` column grant, and `private.domains`/the
source-key table's grants left broader than anything in this design actually uses;
and several claim-strength overreaches ("the relational schema as executable DDL" when
no complete migration has been assembled or run; "no longer open" applied to the whole
byte-representation question when the `jsonb` layer specifically is not closed;
"exhaustive"; "all fifty ... resolve") corrected to state what was actually checked, by
reasoning against this document's own rules, without a live database. **No disposable
PostgreSQL environment (Docker, the Supabase
CLI, or a local `psql`) was available in this session — none of the SQL in this document
has been mechanically executed against a real PostgreSQL instance; every fragment below
is a **normative migration blueprint** — a partial DDL contract pending implementation
and live PostgreSQL execution, never "implementation-ready" in the sense of already
proven to run, and this document does not claim otherwise anywhere.** It remains **Proposed.
Incomplete design** — it may become Accepted only after a separate architecture review,
and nothing in it enables production cloud authority for any domain. No package is
installed, no migration is written, no environment variable is introduced, no
authentication is implemented, no runtime repository wiring changes, and no domain —
including Assessment — becomes cloud-authoritative as a result of this document.

**This sixth revision is a systematic internal audit pass** (not claimed "exhaustive" —
Task 7.8 of the seventh revision, below, retracts that word here — an audit reasoned
against this document's own stated rules, never mechanically verified against a live
database), auditing every normative statement, schema fragment, grant, state/crash
table, error code, and scenario against the corrected design — not a larger document
for its own sake, but internal consistency and an implementable contract. It corrects
defects the fifth revision's own
pass left standing: `private.implemented_canonical_mappings` keyed by
`canonical_mapping_version` alone, letting two unrelated domains' handlers collide by
numeric coincidence — now `(domain, canonical_mapping_version)`, bound to a
`regprocedure` (Decision E.2c); the fifth revision's own "fixture-based evidence" pilot
gate, which no database function can actually check and no finite fixture corpus can
actually prove — replaced with an unconditional hard block,
`representability_contract_unresolved`, pending a later, separate ADR (Decision E.2b);
`backfill_domain_authority` described as committing rows one at a time, resumable
mid-crash — corrected to one set-based `INSERT ... SELECT` plus a guarded `UPDATE`, one
transaction, since no ordinary function invocation can leave a partial subset of its
own crashed attempt durable (Decision K.6, and the identical latent error in
`bootstrap_account`'s own crash-table row); `authority_revision` typed as a JS
`integer/number` despite being `bigint` end-to-end — now a decimal string everywhere it
crosses the JS boundary, with `analysisRevision`'s narrower, genuinely-safe-as-a-number
case explained as the deliberate exception (Decision E.5/H.1); `legacy_active` — a
purely client-side, ADR-0019 concept — appearing inside the server's own
`authorityStatus` envelope, and four genuinely different "no authority row" causes
(no bootstrap, no eligible protocol, backfill incomplete, a post-backfill integrity
failure) collapsed into one code — now a six-branch decision tree with five distinct
outcomes (Decision H.6b); `begin_adoption` acquiring its authority lock only when an
unlocked fast lookup found no row, so a lucky retry could return a decision racing an
in-flight `finalize_adoption`/`abort_adoption` commit — the lock is now acquired
unconditionally before any authority/run-state decision is read, for every call that
reaches classification at all (Decision H.1, narrowed a second time, this revision, to
exclude the authentication/request-shape rejections that never reach that point);
`resolve_adoption_conflicts` accepting an
empty or partial `ready`-state retry as if it were a complete reconfirmation — now an
exact count/membership/content match, and a missing run-status check that let conflict
decisions be mutated against an already-`committed`/`aborted` run — both closed
(Decision G.2), and the identical run-status inconsistency in `stage_adoption_entries`
(`invalid_transition` where `resolve_adoption_conflicts`/`finalize_adoption` used
`already_committed`/`already_aborted` for the same condition) made consistent across
all three functions, with an explicit cross-reference matrix (Decision L.3a);
`transition_adoption_protocol_status` reading the protocol row before acquiring the
domain-scoped advisory lock — now lock-first, one normative five-step order, with the
same-status idempotent no-op scoped only to a *valid* requested target (Decision K.6);
whole-table `UPDATE` grants alongside prose-only immutability claims — replaced with
column-level grants naming exactly the mutable columns of every table (Decision K.8);
`analysis_digest` binding only `content_digest`/group-key/conflict-type arrays, leaving
`candidate_ordinal`/`entity_key`/`validation_status`/`validation_detail`/the immutable
exclusion baseline unbound — expanded to cover every immutable candidate/conflict field
with explicit record tags, golden vectors regenerated against the new framing (Decision
E.11); the state table's own internal contradictions (a "no readable/writable backend"
claim beside "Role A ordinary" in the same row; one ambiguous "invalid local fence" row
with no single deterministic authority scope; an undefined "writable backend" that
sometimes meant canonical data and sometimes any write at all; `server_run_missing` and
`query_failed` merged into one row despite ADR-0019 treating them as genuinely
different) — all corrected (Decision N.1); a `timestamptz`-reconstruction claim for
`createdAt`/`completedAt` resting only on today's writer call sites, proving nothing
about legacy or imported data — replaced with a verbatim source-string column, read
back directly (Decision I/E.9); a promised `jsonb_unrepresentable_escape` classification
with no reliable, non-locale-dependent way to produce it — replaced with a two-stage
`::json` then `::jsonb` cast whose sequencing, not its error content, is the classifier
(Decision I); and several remaining claim-strength overreaches ("complete SQL" applied
to the whole schema section, an under-typed `canonicalCandidate` that cannot legally be
narrowed to `object` for an invalid candidate) narrowed to their actual scope.

**This seventh revision is a tightly scoped correction pass fixing seven defects the
sixth revision's own audit left standing, normative body first.** `analysis_digest`
referenced a column, `exclusion_status_at_analysis_time`, that did not exist —
replaced with an actual, immutable `initial_exclusion_status` column, never granted
`UPDATE`; `finalize_adoption` now also recomputes `content_digest` directly from
`canonical_candidate` (not merely from the stored digest column) and directly
re-evaluates every classification invariant, never inferring them from a digest match;
`conflict_tuple` now binds `details`; the `validation_failed` branch now includes
`recomputed_fingerprint`/`validation_detail` like every other branch actually claims to;
framing re-versioned to `candidate_v2`/`conflict_v2`/`analysis_v3` (external `ad1`/
`cd1`/`rd1` prefixes deliberately kept, explained once); vectors regenerated,
adversarial vectors added (Task 1). `bootstrap_account`/`backfill_domain_authority`
shared no lock at all, so a profile could bootstrap into a domain still `design_only`
at backfill time and never receive its authority row before a later `pilot`
transition — both now serialize on one shared global advisory lock, `bootstrap_account`
now covers any domain with `backfilled_at IS NOT NULL` (not only `pilot`/`production`),
and the count-only completeness proof is replaced with an exact `NOT EXISTS` check
(Task 2). `query_account_domain_authority` checked protocol eligibility before checking
whether an authority row already existed, so a retired protocol could hide granted
authority — the authority-row read now runs first, unconditionally; `begin_adoption`
could not safely lock an authority row that might not exist at all — it now has the
same total missing-row decision tree first (Task 3). The two-stage `::json`/`::jsonb`
cast classifier could still let an unrelated operational error (not the document's own
content) be misclassified as an ordinary validation fact — both casts are now wrapped
in their own `SQLSTATE`-class-22-gated inner exception block, anything else re-raised
to `internal_failure`; the two prior distinct codes are collapsed into one,
`json_parse_or_representability_failed`, pending live `SQLSTATE` verification (Option
B); the raw-NUL/invalid-UTF-8 code is renamed `invalid_utf8_or_text_unrepresentable`
(Task 4). Decision E.2b's pilot hard block was real but evaluated **after** schema/
mapping/backfill/one-active-version checks, so those could return their own result
first — the block now fires immediately upon confirming a genuine `design_only →
pilot` attempt, before any of them run (Task 5). `implemented_canonical_mappings` was
missing from the K.5 grant matrix — added, `SELECT`-only; "mapping execution/dispatch
integration" is now a named, separate architecture blocker, since a migration-time
`regprocedure` attestation never proves a handler is live or actually invoked (Task 6).
Ten smaller taxonomy/editorial contradictions are also corrected: the ADR-0019 outcome
mapping is now an exact one-to-one table (a prior claim that a client "cannot
distinguish" a definite server `not_found` from a network failure is retracted);
`authorization_failed`/`malformed_response` are documented as cross-cutting modifiers
on the state table, not states of their own; a reference to "`begin_adoption`'s
`expected_authority_revision`" is corrected to `analyze_adoption`'s (it has no such
parameter); `analysisRevision`'s JS-`number` safety is now argued from PostgreSQL
`integer`'s own type range, not a usage estimate; stale "Decision Q's blockers"
references are corrected to Decision P; implementation stage 18 no longer claims pilot
is reachable merely once stage 1 is Accepted; "all three defined completely" is
corrected to "normative contracts... specified"; a newly reintroduced "exhaustive"
self-description (this Status section's own sixth-revision paragraph, above) is
retracted; protocol-registration idempotency now compares `jsonb` columns with `IS NOT
DISTINCT FROM`, never "byte-for-byte identical" (Task 7).

**This eighth revision is a narrow correction pass fixing seven remaining defects.**
One digest golden vector (the "conflict `details` altered" adversarial case) was
computed from a compact JSON spelling instead of PostgreSQL's actual `jsonb::text`
rendering — recomputed correctly, and the surrounding claim that hashing `jsonb::text`
removes all dependence on PostgreSQL's own serialization is corrected to state the
actual, narrower contract (Task 1). `begin_adoption` could still race
`bootstrap_account`/`backfill_domain_authority` when its authority row was absent — it
now falls back to their shared global lock and a re-read before classifying the
absence (Task 2). `query_account_domain_authority`'s sequential `SELECT`s could observe
a transient, false `integrity_failure` from a mixed-time read — replaced with one
single-statement CTE query under one MVCC snapshot (Task 3). `finalize_adoption`'s
classification checks still trusted the stored `duplicate_group_key` for group
membership instead of deriving it independently from `entity_key`/`jsonb` equality/
content digest — corrected to derive-then-verify, closing a class of defect no digest
comparison alone could catch (Task 4). The JSON exception pseudocode decoded UTF-8
inline inside the `::json` cast's own exception block (using the wrong `SQLSTATE`
codes for that failure) and used a lowercase `22p02`; both are corrected, UTF-8 is now
decoded exactly once into its own variable, and the `EXCEPTION WHEN OTHERS` claim is
narrowed to exclude `QUERY_CANCELED`/`ASSERT_FAILURE` (Task 5). The ADR-0019 outcome
mapping omitted `network_unavailable`/`unsupported_server_protocol` and wrongly mapped
`session_resolution_failed` to `malformed_response` — all seven client-layer outcomes
now map exactly (Task 6). A handful of remaining stale references (`Decision Q` cited
for architecture blockers instead of `Decision P`, a duplicated "for for", an
`ON CONFLICT DO NOTHING` cardinality-error claim that in fact only applies to
`DO UPDATE`, and "implementation-ready DDL" phrasing) are also corrected (Task 7).

**This ninth revision is a narrow consistency-correction pass fixing six further
defects, none of which change this document's actual design.** Scenario proof 75 still
carried the same false "PostgreSQL would reject a duplicate conflict target regardless
of `ON CONFLICT`" claim Decision H.8 had already corrected — reworded to match.
`frame_jsonb_digest`'s own definition claimed hashing `v::text` "never depends on
`jsonb`'s own object-key-ordering behavior" — the opposite of true — replaced with the
exact contract (the digest depends fully on PostgreSQL's own `jsonb::text` output;
`jsonb` equality, not this digest, is the authoritative content check), plus a narrow
operational rule that a prepared adoption run must not span a PostgreSQL major-version
upgrade unless its digest framing has been re-verified against the target version.
`begin_adoption`'s "every call locks something before any decision is returned"
overreached — authentication and request-shape rejection return before locking is ever
reached, and every related sentence (in H.1, its own closing paragraph, the Status
section's own history, and Alternatives Considered) is narrowed to say so exactly.
`backfill_domain_authority` gave two contradictory lock orders — its heading/SQL said
lock-first, a numbered point said the protocol-existence precondition ran before the
lock — resolved in favor of one order (role/parameter checks, then the lock, then the
existence check under the lock, then the two writes), applied consistently. `resolution
_digest`'s framing passed a `bigint` `count()` result directly to `int4send`, which
takes `integer` — corrected to an explicit bounds-checked cast, with no change to the
framing's bytes or golden vectors. Scenario 87 asserted an undefined outcome ("reflects
not yet inserted for this account") for a real branch of H.6b's decision tree — replaced
with the actual outcome (`integrity_failure`, correctly reported, not a mixed-snapshot
false positive) and the same-transaction case that never produces it.

**This tenth revision is a micro-correction pass fixing three further defects, none
changing this document's actual design.** `begin_adoption`'s missing-row branch said
it runs "the exact same total decision tree Decision H.6b already defines" without
requiring the same single-statement CTE — replaced with a normative requirement to
execute that identical query (never separate profile/protocol/backfill `SELECT`s), plus
an explicit, named outcome (`internal_failure`) for the otherwise-unhandled case where
that CTE's own `authority_row` unexpectedly disagrees with the immediately preceding
`FOR UPDATE` re-read. `backfill_domain_authority`'s lock-acquisition comment falsely
claimed acquiring `bootstrap_backfill_serialization` first is *why* a concurrent
`register_adoption_protocol`/`transition_adoption_protocol_status` call cannot be
observed mid-write — that property is ordinary PostgreSQL statement-level MVCC, not
this lock, which serializes only bootstrap/backfill/`begin_adoption`'s missing-row path
against each other; corrected, with the comment and scope note now stating the same
fact instead of contradicting each other. `resolution_digest`'s own count-encoding
correction (ninth revision) introduced `v_conflict_count_bigint` but still used a bare
`conflict_count::integer` in the actual formula — replaced with one exact sequence
(`v_conflict_count_bigint` → bounds check → `v_conflict_count_integer` → `int4send`),
the same two named variables used everywhere this value appears, with no change to the
framing's bytes or golden vectors. **Amended in place, same revision: that sequence
still never compared the freshly computed aggregate against the durable
`private.adoption_analyses.conflict_count` this analysis already stores, so an
incorrect stored count could go undetected** — the sequence now reads
`v_stored_conflict_count_integer` from the same, already-loaded analysis row (no
second query) and inserts one comparison — computed aggregate → bounds check →
stored-count comparison → `integer` cast → `int4send` — returning `integrity_failure`
on any disagreement, still with no change to framing bytes or golden vectors.

**Preserved from prior revisions, unchanged by this correction pass:** the `bytea`
staging decision (Decision B); all ten fingerprint digests, re-verified unchanged by
the fourth revision's transport-encoding fix and untouched since (Decision B);
normalized protocol source keys (Decision E.2a); Assessment draft/history as a named
architecture blocker (Decision D); the materialized analysis/candidate/conflict model's
own existence and shape, independent of this revision's digest-framing expansion
(Decision E.11); whole-batch atomic semantics for `stage_adoption_entries` (Decision
F.1) and the batch-prevalidation shape of `resolve_adoption_conflicts` (Decision G.2),
independent of this revision's run-status/ready-retry corrections; the executable
`abort_and_replace` statement order (Decision H.2); the `security_invoker` view
(Decision K.3); base-table tombstone exclusion (Decision K.3); zero direct
`service_role` table grants (Decision K.4/K.5); ADR-0019's already-complete `fp1`
fingerprint definition (Decision B); staging and canonical entities as separate
concepts (Decision C); canonical Assessment IDs remaining tenant-scoped (Decision E.9,
independent of this revision's timestamp-column addition); validation and finalization
remaining database-contained (Decision I); Assessment delete behavior remaining
tombstone-based (Decision J); ADR-0013 through ADR-0019 remain untouched.

## Context

ADR-0019 ("Cloud identity and data authority transition," Proposed, incomplete design)
designed three independent client-side state machines, the Local Adoption protocol, the
exact `captureDomainSnapshot`/`fingerprintDomainSnapshot` fingerprint algorithm (Decision
3, restated in full in Decision B below), and an exact discriminated-union shape for the
server-side account-domain authority registry — but explicitly deferred the concrete
Postgres schema, RLS policy set, and account-domain authority registry to this document.

### Preflight and change boundary

Verified directly against the repository before any edit in this revision: branch
`feature/indexeddb-persistence-phase-2`, HEAD `79dfbb91389ca8719392662013b7e62818418cbe`,
`main`/`origin/main` both `d12353321aefb2c6816fedcf4b35e57a2e83277b`, nothing staged. The
working tree matched the prior report exactly (the second-revision ADR-0020, one
`docs/adr/README.md` line, and one `docs/TECHNICAL_DEBT_AND_ROADMAP.md` note — all
within the seven-file allowed change set). ADR-0013 through ADR-0019 were re-read
directly and are unmodified by this revision. `src/lib/assessment/persistence.ts`,
`types.ts`, and `migration.ts` were re-read to re-verify `AssessmentPersistedState`'s
exact shape and `validatePersistedAssessmentRun`'s structural rules before designing
Decision I's validation boundary.

### Required audit — unchanged facts, not repeated in full

The seven persistence domains, ten `localStorage` keys, eager singleton repositories,
migration/hydration boundary, `crypto.randomUUID()` ID scheme, and the confirmed absence
of Supabase/Auth/backend code are unchanged from the prior revisions' audits. The one
fact this revision leans on newly: PostgreSQL's `text`/`character` types **cannot store
the NUL character (code point zero) at all**, in any encoding — confirmed directly
against the PostgreSQL manual (Appendix) — while a `localStorage` string value, a
JavaScript string, ADR-0019's `fingerprintDomainSnapshot` input, and this document's own
golden vector 5 (`"line1\nline2\x00line3\ttab"`) can all contain one. This is the exact,
concrete defect Decision B below corrects.

## Decision

### A. Scope boundary (unchanged)

This ADR designs the minimum secure server foundation for: Supabase Auth identity
binding; `UserAccount`/`Profile`/`Athlete` bootstrap; one `AccountDomainAuthorityRecord`
per `(accountScopeId, domain)` pair; the `AdoptionRun` lifecycle; isolated prepared/staged
data; atomic analysis, conflict resolution, finalize, abort, and abort-and-replace;
authoritative registry/run queries; and the schema-level target for a future Assessment
development/staging pilot — which, per Decision D, **cannot be activated under the
current combined Assessment domain**.

**Explicitly excluded:** teams, organisations, `TeamMembership`; coaches,
`TeamDataSharingGrant` (there is no modeled Team Captain function — see
`docs/adr/0022` Decision 2), any team function/permission bundle; invitations, team
administration, roster management; billing/commercial entitlement layers; public
exercise publishing/moderation; general offline mutation queues/outbox; Branch
Reconciliation and export/recovery for `local_branch_quarantined` content; the Session
Domain Split and completed-session transfer; production enablement of cloud authority
for any domain.

### B. Lossless source representation and the fingerprint function

**The defect, stated precisely.** The prior revision's `adoption_staged_entries.source_value`
was `text`, and its fingerprint function accepted a `jsonb` array of `{key, value}`
pairs. Both are lossy: PostgreSQL `text` (confirmed, Appendix) "the character with code
zero (sometimes called NUL) cannot be stored" — no PostgreSQL character type can hold
one, in any server encoding. ADR-0019's own `fingerprintDomainSnapshot` input is an
arbitrary `localStorage` string — which **can** contain an embedded NUL — and this
document's own golden vector 5 is exactly such a string. A schema that cannot store the
input its own fingerprint function is defined over is not merely incomplete, it is
internally contradictory.

**Resolution — store the fingerprint-input bytes directly, never route them through
`text`:**

```sql
-- private.adoption_staged_entries (full table in Decision E.8)
source_value_is_null boolean not null,
source_value_utf8 bytea,
check (
  (source_value_is_null and source_value_utf8 is null)
  or (not source_value_is_null and source_value_utf8 is not null)
)
```

`bytea` is confirmed (Appendix) to store "octets of value zero and other 'non-printable'
octets... the full byte range... without character-encoding restrictions" — exactly what
an arbitrary `localStorage` string's UTF-8 encoding requires, NUL included. **A present
empty string is an empty, zero-length `bytea` (`'\x'::bytea`), never `NULL`** — the
`CHECK` above enforces this exactly: `source_value_is_null = false` requires
`source_value_utf8 IS NOT NULL`, and a zero-length `bytea` value satisfies "is not null"
(it is a present, defined value of length zero), which is the correct encoding of
"present empty string," distinct from vector 2 (`""`, present) vs. vector 1 (`null`,
absent).

**Exact transport representation — corrected from base64 to hex.** The client already
computes UTF-8 bytes itself, to run `fingerprintDomainSnapshot` locally (ADR-0019
Decision 3). **The prior revision's "canonical base64" transport was not executable as
specified.** Confirmed (Appendix): PostgreSQL's `encode(bytea, 'base64')` follows RFC
2045, which inserts a newline after every 76 output characters — comparing that output
byte-for-byte against RFC 4648 base64 (no line breaks, the prior revision's own
definition of "canonical") rejects any value whose encoded form exceeds 76 characters,
i.e. essentially every value longer than roughly 57 input bytes, including this
document's own vector 9 (200,000 bytes). This is corrected by choosing **hexadecimal**
instead: PostgreSQL's `encode(bytea, 'hex')`/`decode(text, 'hex')` render and parse with
no line wrapping, no padding, and no alternate valid encoding of the same bytes —
canonical by construction, not merely by a byte-for-byte comparison this ADR must
separately enforce (hex is therefore preferred over normalizing base64's line-wrapping
behavior, which would only reintroduce the same class of failure the next time a
PostgreSQL/libpq default changes).

The `stage_adoption_entries` wire shape for one entry (full RPC signature in Decision
M) is:

```text
{
  sourceKey: string,
  sourcePosition: integer,
  sourceValueIsNull: boolean,
  sourceValueHex: string | null
}
```

Exact rules, checked during Decision F.1's whole-batch prevalidation, before any write:

- `sourceValueIsNull = true` requires `sourceValueHex = null` — any other combination is
  `malformed_request`.
- `sourceValueIsNull = false` requires `sourceValueHex` to be a **lowercase**,
  even-length string matching `^(?:[0-9a-f]{2})*$` — uppercase hex digits, an odd
  length, or any character outside `[0-9a-f]` is `malformed_request`.
- **A present empty string is `sourceValueHex = ""`** (zero length, matches the regex
  vacuously) — distinct from `sourceValueIsNull = true`.
- The server decodes with `pg_catalog.decode(sourceValueHex, 'hex')`, then
  **re-encodes** the result with `pg_catalog.encode(decoded, 'hex')` and compares it to
  the original `sourceValueHex` **exactly**. Any mismatch is `malformed_request`, before
  any staging write is attempted.

Every RPC shape, scenario, and threat-table entry in this document that previously
referred to base64 is corrected to hex (Decision F.1, Decision M, and scenarios 35/37).

**The precise boundary between the local archive, staging, and canonical parsing:**

- The device-local ADR-0019 role-B archive (`AdoptionArchiveEnvelope`) continues to
  preserve the original JavaScript string exactly, as ADR-0019 already specifies —
  unaffected by this ADR.
- Server staging (`adoption_staged_entries`) preserves the **exact UTF-8 byte
  sequence** the client's own `fingerprintDomainSnapshot` call used, as `bytea` — not a
  round-tripped `text` value, which could not represent every such sequence.
- The server recomputes `fp1` (below) directly from these staged bytes, with **no
  conversion through PostgreSQL `text` at any point** — `fingerprint_domain_snapshot`
  operates on `bytea` end to end.
- **Canonical JSON parsing happens only after fingerprint verification succeeds**
  (Decision G) — parsing an unverified byte sequence as JSON before its fingerprint is
  confirmed would validate content the client never actually proved it fingerprinted.
- **Invalid UTF-8, an embedded NUL, or non-JSON bytes can still be fingerprinted and
  preserved in staging** (the fingerprint function operates on raw bytes, never
  requiring valid UTF-8 or valid JSON) **— canonical parsing then returns
  `validation_failed`** for that source entry, distinctly from a transport-level
  `malformed_request` at upload time. A byte sequence that is not valid UTF-8 can be
  staged and fingerprinted (Decision B's algorithm only requires *treating* the bytes as
  a UTF-8 byte length for the length-prefix framing, which works on any byte sequence,
  valid UTF-8 or not — the "UTF-8 byte length" in ADR-0019's own algorithm is simply
  "the number of bytes," not a UTF-8 validity assertion) — but `pg_catalog.convert_from(...,
  'UTF8')` inside canonical parsing **raises an error on invalid UTF-8 input**
  (corrected from a prior, false claim that it "produces mojibake" — `convert_from`
  does not silently substitute or mangle bytes; PostgreSQL rejects a byte sequence that
  is not valid UTF-8 outright), which the document-schema validation step (Decision G)
  catches — inside its own inner exception block, gated on `SQLSTATE` class 22
  specifically (`22021 character_not_in_repertoire`/`22P05 untranslatable_character`,
  both confirmed, Appendix, PostgreSQL Error Codes, as the codes PostgreSQL's own
  encoding-conversion functions raise — never a bare, ungated `EXCEPTION WHEN OTHERS`
  around this call, per Task 4's correction) — and reports as `document_validation_code
  = 'invalid_utf8_or_text_unrepresentable'` (renamed from the prior revision's bare
  `'invalid_utf8'`, since this same code and inner-block structure also covers a
  character that decodes but cannot be represented in the target text encoding, not
  only a malformed byte sequence), `status = 'validation_failed'`, never silently
  accepted as valid JSON content. Any exception here whose `SQLSTATE` is **not** one of
  those two codes propagates to the outer `EXCEPTION WHEN OTHERS` and becomes
  `internal_failure` — the identical safety structure Decision I applies to the
  `::json`/`::jsonb` casts below, applied here first.

**A further, distinct representability boundary — valid JSON that PostgreSQL's `jsonb`
type itself refuses to store — stated precisely, not glossed over (Decision E.2b gives
this its full architecture-blocker treatment):**

- **A literal, raw NUL byte embedded directly in what is meant to be a JSON document is
  invalid JSON syntax** (a JSON string may only contain a NUL via a six-character
  escape sequence — a backslash, the letter `u`, and four `0` digits — never a literal
  byte) — this case was already handled correctly: it fails document-schema validation
  as `validation_failed` (scenario proof 23).
- **That six-character escape sequence itself is different: it is syntactically valid
  JSON**, but PostgreSQL's `jsonb` input function **rejects it outright** — confirmed
  directly (Appendix): the `jsonb` type "rejects" this exact escape sequence "because
  that cannot be represented in PostgreSQL's `text` type." **A prior revision of
  scenario 23 falsely claimed this case "parses normally" and "remains fully
  representable" — it does not; `jsonb` construction fails on it.** Corrected fully
  below (Decision E.2b, scenario 23).
- **Invalid UTF-8** is rejected earlier, at the `convert_from`/text-decoding step above,
  before `jsonb` conversion is even attempted — a distinct failure point from the two
  above.
- **A malformed or unpaired Unicode surrogate escape** (e.g. a lone high surrogate with
  no matching low surrogate) is syntactically valid JSON by the same rule that permits
  the NUL escape sequence syntactically, but is **also** rejected by `jsonb`'s input
  function — confirmed directly (Appendix): `jsonb`'s input function "insists that any
  use of Unicode surrogate pairs... be correct." This is a **separate** representability
  case, sharing the same underlying architectural consequence (Decision E.2b).

**`private.fingerprint_domain_snapshot` — rewritten to consume the fixed ordered source
keys and staged `bytea` values directly, never a client-supplied `jsonb` parameter, and
corrected to never treat a missing staged row as an explicit null.**

**The defect, stated precisely.** A `LEFT JOIN` from the registered key list to
`adoption_staged_entries`, `COALESCE`d to "treat a missing row as null," makes a
genuinely **missing** row (staging incomplete) indistinguishable from a row **present**
with an explicit null value — silently producing the same fingerprint for two different
staging states, directly contradicting ADR-0019's own requirement that every registered
key have exactly one explicit entry, and contradicting `staging_incomplete`'s entire
purpose (Decision G.1 below).

```sql
create or replace function private.fingerprint_domain_snapshot(p_run_id uuid)
returns text
language plpgsql
security invoker
set search_path = ''
as $$
declare
  buf bytea := ''::bytea;
  rec record;
  key_bytes bytea;
  registered_count integer;
  visited_count integer := 0;
begin
  select pg_catalog.count(*) into registered_count
  from private.adoption_runs r
  join private.adoption_protocol_source_keys k
    on k.domain = r.domain and k.protocol_version = r.protocol_version
  where r.id = p_run_id;

  -- INNER JOIN, deliberately: a staged row missing entirely must never be silently
  -- treated as an explicit null-valued entry. analyze_adoption (Decision G.1) verifies
  -- staging completeness (registered key count = staged row count) BEFORE ever calling
  -- this function; the visited_count/registered_count check below is a second,
  -- independent invariant proof, not the primary enforcement point.
  for rec in
    select
      k.source_key,
      e.source_value_is_null,
      e.source_value_utf8
    from private.adoption_runs r
    join private.adoption_protocol_source_keys k
      on k.domain = r.domain and k.protocol_version = r.protocol_version
    join private.adoption_staged_entries e
      on e.adoption_run_id = r.id and e.source_key = k.source_key
    where r.id = p_run_id
    order by k.source_position
  loop
    visited_count := visited_count + 1;
    key_bytes := pg_catalog.convert_to(rec.source_key, 'UTF8');
    buf := buf || pg_catalog.int8send(pg_catalog.octet_length(key_bytes)::bigint) || key_bytes;
    if rec.source_value_is_null then
      buf := buf || '\x00'::bytea;
    else
      buf := buf
        || '\x01'::bytea
        || pg_catalog.int8send(pg_catalog.octet_length(rec.source_value_utf8)::bigint)
        || rec.source_value_utf8;
    end if;
  end loop;

  if visited_count <> registered_count then
    -- If the RPC precondition (Decision G.1's staging-completeness check) was somehow
    -- bypassed, this function refuses to compute a misleading digest over a partial
    -- key set — it raises, rather than silently hashing fewer entries than the
    -- protocol registers.
    raise exception
      'fingerprint_domain_snapshot invariant violation: run % staged % of % registered keys',
      p_run_id, visited_count, registered_count;
  end if;

  return 'fp1:' || pg_catalog.encode(extensions.digest(buf, 'sha256'), 'hex');
end;
$$;
```

`set search_path = ''` (Decision K.7); every relation is schema-qualified; every
function that is not a `pg_catalog` built-in is schema-qualified explicitly
(`extensions.digest`), and every `pg_catalog` function this body calls (`convert_to`,
`int8send`, `octet_length`, `encode`, `count`) is qualified too, for clarity. **This
function no longer validates key-set membership implicitly by "simply never visiting"
an out-of-set staged row** — Decision F.1's prevalidation is still what rejects an
out-of-set key **before** it can ever be staged, but this function additionally proves,
by exact count comparison, that it visited **every** registered key for this run, not
merely some subset, before ever returning a digest.

**Golden vector 5, restated with unambiguous exact bytes** (previously presented only as
a visually ambiguous quoted string):

```
Value (21 UTF-8 bytes), hex:
  6c696e65310a6c696e6532006c696e653309746162
```

This is the UTF-8 encoding of the five-part sequence `line1` `\n` `line2` `\x00`
`line3` `\t` `tab` — the embedded `00` byte at offset 11 is exactly the NUL byte this
section's correction exists to support; it is visible directly in the hex above, with no
quoting ambiguity.

**All ten previously published digests are unchanged and re-verified in this revision**
using an independent third implementation (Python `hashlib.sha256`, run in this session):

| # | Case | Entries (`key` → value, fixed order) | `fp1:` fingerprint |
|---|---|---|---|
| 1 | Canonical empty-domain fingerprint, single-key domain | `curling-release-tracker-assessment-data` → `null` | `fp1:4773a7ed608083f84265e89762842dc79feb28d5b90b69e119f5dd934f625525` |
| 2 | Empty string ≠ null | `curling-release-tracker-assessment-data` → `""` (0 bytes, present) | `fp1:fdda59f01e33b48c4858ccbad0e186380d7ab8341b84b3fda6bad2306a5436ee` |
| 3 | Simple ASCII content | `curling-release-tracker-assessment-data` → `{"schemaVersion":1,"history":[]}` | `fp1:b1b08940952dc38bbd8610f77d4e183e04a8ec726af116022f0234d8df803647` |
| 4 | Unicode (emoji, CJK) | `curling-release-tracker-assessment-data` → `{"note":"café 🥌 招手"}` | `fp1:92f26fcb6df58d41bc221f8e8479ed44e423633bad2cf28521e787ec646f255a` |
| 5 | Embedded NUL byte and control characters — see exact bytes above | `curling-release-tracker-assessment-data` → (21 bytes, hex `6c696e65310a6c696e6532006c696e653309746162`) | `fp1:ea214cd0b925a83239dd79801433bc904edd075b4508383719bf027cf69867f4` |
| 6 | Two-key domain, both present, fixed order | `curling-release-tracker-current-session` → `{"id":"a"}`; `curling-release-tracker-session-history` → `[]` | `fp1:6675e596cbce5143e2913f28e258345be75210432c94a3bc38fafb3edc42ce72` |
| 7 | Same two entries, **reordered** — confirmed distinct from #6 | (order swapped) | `fp1:33c60c7069c29ed692eb77caffd2e99564f0dfdd5c93aa3a09b2701f07520fb6` |
| 8 | Two-key domain, one present, one null | `curling-release-tracker-current-session` → `{"id":"a"}`; `curling-release-tracker-session-history` → `null` | `fp1:769ac0e9b9ab930553e7d8117c7c200e0e76aca3525f2499a47f7673c80132f2` |
| 9 | Very long content (200,000 ASCII characters) | single key → 200,000 `"x"` characters | `fp1:5118821bbe66063729783895e38a8ee60726b1c1c0e67fc208f37b230cb2bf51` |
| 10 | UTF-8 byte length ≠ JS `string.length` | single key → U+1F94C (hex `f09fa58c`; JS `.length` = 2 via surrogate pair, UTF-8 byte length = 4) | `fp1:47cac4080623ec8ff66714e3ebec134152d2eda42d14682110d3febd97152eab` |

Re-running the reference implementation against all ten in this session confirms every
digest **MATCH**es its previously published value exactly — the byte-representation
correction changes how this document displays the input, never the bytes hashed or the
resulting digest.

### C. Source entries vs. canonical entities (unchanged from the prior revision)

**Two separate layers, unchanged:** the **source layer** (`private.adoption_staged_entries`,
Decision E.8/F) holds one row per `(adoption_run_id, source_key)` — for `assessment`,
exactly one row, the entire unparsed `AssessmentPersistedState` byte sequence. The
**canonical mapping layer** (Decision G/I/K) parses and validates that one entry's bytes,
extracting `history` into canonical candidates. Exact terminology
(`stagedEntryCount`/`parsedEntityCount`/`promotedEntityCount`/`conflictCount`/
`clearedSourceKeyCount`) is unchanged — **`stagedEntryCount`, corrected from the prior
revision's `sourceEntryCount`**, which reused the exact same name as
`begin_adoption`/`abort_and_replace_adoption`'s own `source_entry_count` parameter (the
immutable, claimed-at-`begin_adoption`-time registered-key count, Decision F.2) for a
completely different, mutable quantity — the running count of rows actually staged so
far for this run, returned by `stage_adoption_entries` (Decision F.1). The two counts
coincide only once staging is complete; conflating their names invited exactly the
confusion this rename removes. A domain cannot begin adoption at all without a
`private.adoption_protocols` row with `activation_status IN ('pilot', 'production')`
(Decision F) — "staged but never promoted" is not a reachable state for an ineligible
domain.

### D. The Assessment authority-unit contradiction (unchanged — restated)

`AssessmentPersistedState` combines a device-local, in-progress `currentRun` with
cloud-eligible, terminal `history` under one storage key. **Production or pilot
activation of cloud-authoritative Assessment history is blocked until a separately
accepted authority-unit split ADR** defines `assessmentDraft` (device-local,
permanently) and `assessmentHistory` (the cloud-eligible domain) as two persistence
domains where today there is one. This ADR designs the generic server substrate and the
target canonical mapping only; **the protocol registry (Decision F) ships with zero
`pilot`/`production` rows** — nothing is activatable today.

### E. The relational schema — complete table definitions and their required creation order

**Renamed from "the relational schema as executable DDL" — corrected to describe what
this section actually is.** Each table's own subsection below (E.1-E.13) gives that
table's complete `CREATE TABLE` body, in full. Decision E.7's own creation-**order**
list, by contrast, abbreviates each step as `CREATE TABLE schema.name (...);` — a
placeholder standing in for "see that table's own subsection for the real body" — so
that the ordering constraints (which table's FK requires which other table to already
exist) are readable without repeating every column definition a second time. Neither
E.7's abbreviated list nor the individual `CREATE TABLE` bodies elsewhere in this
section have been concatenated into one complete migration script and executed against
a real PostgreSQL/Supabase database in this session (no disposable instance is
available, Decision Q/Appendix) — "executable DDL" overstated that, and so does
"complete" applied to the section as a whole (Task 14). **What this section actually
is: a normative schema contract** — one syntactically complete `CREATE TABLE` statement
per object, individually well-formed, plus an explicit, checkable ordering constraint
between objects — **not** a claim that these fragments have been concatenated into one
migration file, executed, or verified against a live PostgreSQL/Supabase instance. A
future implementer still needs to assemble these statements into an actual migration
and run it against a real database before any of this is proven executable.

**E.0 Storage strategy (unchanged from the prior revision).** Four candidates were
evaluated — fully normalized (A), a generic JSONB envelope (B), a hybrid of typed
lifecycle tables plus one canonical payload table (C), and exact serialized-string cloud
storage (D). **Option C was chosen**: typed ownership/lifecycle tables for
authority/run/staging/analysis state, plus one domain-specific canonical payload table
(`assessment_runs`) with a typed header and a `jsonb payload` column for validated,
immutable body content. Full comparison table and rejected-alternative rationale
unchanged from the prior revision (see Alternatives Considered for the condensed form).

**Schema placement.** `private` (never in the exposed-schema list — unreachable via the
Data API regardless of any table grant, confirmed against the RLS guide's own
"place views [and, by extension, tables] in unexposed schemas" fallback guidance,
Appendix) holds every protocol/authority/staging/analysis/conflict table. `public`
(exposed; RLS, `ENABLE`/`FORCE`, and explicit grants are the only protection — Decision
K) holds `profiles`, `athletes`, `assessment_runs`, `assessment_history_tombstones`, and
the `assessment_history_active` view. `extensions` holds `pgcrypto` and `pg_jsonschema`.

#### E.1 `private.domains`

Unchanged: `domain text primary key`, `added_at`. Seeded with the seven existing
`MIGRATION_DOMAINS` ids for informational/future-backfill-readiness purposes only — no
row here implies cloud eligibility (that is `adoption_protocols.activation_status`,
Decision F).

#### E.2 `private.adoption_protocols` — corrected: contradictions removed, fields split, immutability restated exactly

**Removed entirely: `cloud_eligible` (redundant with, and contradictable against,
`activation_status`) and `source_manifest_extra`'s companion `extra_manifest_schema`
(referenced a column that was never defined — the speculative manifest-extension
mechanism is removed outright; no protocol this ADR defines needs it, and a future one
that does gets an explicit typed column or its own versioned schema via a later
migration, never a silently-invented reference).**

```sql
create table private.adoption_protocols (
  domain text not null references private.domains(domain),
  protocol_version integer not null check (protocol_version > 0),
  fingerprint_version text not null check (fingerprint_version = 'fp1'),
  source_contract_version integer not null,
    -- the protocol's OWN expectation of the source document's schemaVersion field —
    -- distinct from the literal AssessmentPersistedState.schemaVersion value found in
    -- any one parsed document (Decision I compares the two explicitly)
  canonical_mapping_version integer not null,
  source_document_schema jsonb not null,
    -- validates the COMPLETE source document (e.g. AssessmentPersistedState) —
    -- distinct from canonical_entity_schema below
  canonical_entity_schema jsonb,
    -- validates ONE extracted canonical candidate (e.g. one AssessmentRun); NULL only
    -- while the protocol remains design_only — Decision E.2c requires this column
    -- NOT NULL, plus a matching row in private.implemented_canonical_mappings, before
    -- design_only -> pilot is permitted; a protocol with no canonical mapping/handler
    -- can never reach pilot
  activation_status text not null default 'design_only'
    check (activation_status in ('design_only', 'pilot', 'production', 'retired')),
  backfilled_at timestamptz,
  added_at timestamptz not null default now(),
  primary key (domain, protocol_version)
);
```

**Immutable once inserted, by policy (no `UPDATE` grant covers these columns for any
role — Decision K):** `domain`, `protocol_version`, `fingerprint_version`,
`source_contract_version`, `canonical_mapping_version`, `source_document_schema`,
`canonical_entity_schema`. A changed contract is a **new** `protocol_version` row, never
an edit — matching `docs/DOMAIN_GLOSSARY.md`'s "Assessment Template" immutability
pattern one layer up.

**Mutable, and only through named, `service_role`-only operational functions (Decision
K.6): `activation_status`, `backfilled_at`.**

**One exact lifecycle, no contradictory combinations possible:**

```text
design_only  →  pilot  →  production  →  retired
```

No other transition is permitted (`transition_adoption_protocol_status`, Decision K.6,
enforces this exact linear order — no skipping, no reversal). `begin_adoption` (Decision
H.1) may start a new run **only** for a protocol whose `activation_status IN ('pilot',
'production')` **and** `backfilled_at IS NOT NULL`.

**Retirement semantics, decided explicitly and applied consistently:** retiring a
protocol (`activation_status = 'retired'`) blocks every **new** `begin_adoption` call for
it. **It does not invalidate a run already `prepared` before retirement** — such a run
may still be analyzed and finalized to completion. This is the one rule, applied
uniformly: `begin_adoption` checks `activation_status`; `analyze_adoption`,
`resolve_adoption_conflicts`, and `finalize_adoption` (Decision G) **never** re-check
`activation_status` at all, only the run's own `status = 'prepared'` and the protocol's
immutable contract columns (which retirement never changes). Rejecting an in-flight run
purely because an administrative retirement happened mid-flight would destroy a client's
already-uploaded data through no fault of the client's — this ADR chooses not to do
that.

**Schema validity, required before activation — exact signatures.** `pg_jsonschema`'s
actual, registered function signatures (confirmed, Appendix) are
`jsonschema_is_valid(schema json) returns bool` and `jsonb_matches_schema(schema json,
instance jsonb) returns bool` — **the schema argument is typed `json`, not `jsonb`**,
in both functions. Every call site in this document therefore casts explicitly:
`extensions.jsonschema_is_valid(source_document_schema::json)`, never an unqualified
`jsonb` value passed where `json` is declared.

**Corrected (Task 5): `transition_adoption_protocol_status` refuses every genuine
`design_only → pilot` attempt unconditionally and first (Decision E.2b/K.6's exact
precedence) — the conditions below are this design's documented, future readiness
target for once that block is lifted by a later, accepted ADR; they are not currently
evaluated by this function at all, and are never observable result precedence ahead of
the hard block.** Once unblocked, the intended gate is: both
`source_document_schema::json` and (if non-`NULL`) `canonical_entity_schema::json` pass
`extensions.jsonschema_is_valid(...)`; the domain's registered source-key set (Decision
E.2a) is non-empty and already proven contiguous (verified at
`register_adoption_protocol` time, re-checked here as defense-in-depth); `backfilled_at
IS NOT NULL` for this exact `(domain, protocol_version)` row; **and, per Decision E.2c
below, `canonical_entity_schema IS NOT NULL` and a row exists in
`private.implemented_canonical_mappings` for this exact `(domain,
canonical_mapping_version)` pair** (a protocol with no canonical mapping defined, or
one no server-side handler actually implements **for this domain specifically**, is not
pilot-eligible — the generic registry alone never makes a domain promotable, and a
`canonical_mapping_version` number is meaningful only within the domain that declared
it, never checked against another domain's row that happens to share the same version
number). **Backfill is therefore designed to run, and complete, while the protocol is
still `design_only`** — calling `backfill_domain_authority` against a `design_only`
protocol is intentional and harmless (Decision K.6), and `pilot`/`production` are
**intended** to be reachable only once it has already set `backfilled_at`, once the
hard block below is lifted. **Today, none of the above is ever reached or checked at
all — Decision E.2b's hard block refuses every such request immediately, before any of
these conditions is evaluated** — see
that section; nothing above is sufficient by itself while that block stands.

**At most one protocol version per domain may be `pilot`/`production` at once —
declaratively enforced, not merely operationally assumed:**

```sql
create unique index adoption_protocols_one_active_per_domain
  on private.adoption_protocols (domain)
  where activation_status in ('pilot', 'production');
```

`transition_adoption_protocol_status` checks this explicitly **before** attempting the
`UPDATE` (so a violation is reported as `invalid_transition`, not a raw constraint
exception): if another version of the same domain already has `activation_status IN
('pilot', 'production')`, the transition is refused. The index itself is the structural
backstop. **An already-`prepared` run under a version that has since moved to
`retired` may still finish** (Decision E.2's retirement rule, unchanged) — this
constraint governs which version may accept **new** `begin_adoption` calls, never
whether an in-flight run under a since-superseded version may complete. Concurrent
active versions of the same domain are therefore not a supported feature in this MVP;
a future decision that wants them would need to relax this index explicitly, not
silently.

#### E.2a `private.adoption_protocol_source_keys` — the normalized, enforceable ordered-key list

**The defect, stated precisely.** The prior revision's `ordered_source_keys text[]` with
`CHECK (array_length(ordered_source_keys, 1) > 0)` is not an enforceable contract: a
PostgreSQL `CHECK` also passes when its expression evaluates to `NULL` (an empty array
`'{}'::text[]` gives `array_length(..., 1) = NULL`, and `NULL > 0` is `NULL`, which
`CHECK` treats as satisfied, not violated) — so the constraint does not actually forbid
an empty array. It also does nothing to forbid duplicate or `NULL` keys within the
array.

**Resolution — a normalized table, not an array:**

```sql
create table private.adoption_protocol_source_keys (
  domain text not null,
  protocol_version integer not null,
  source_position integer not null check (source_position >= 0),
  source_key text not null,
  foreign key (domain, protocol_version)
    references private.adoption_protocols (domain, protocol_version),
  primary key (domain, protocol_version, source_position),
  unique (domain, protocol_version, source_key)
);
```

The composite `PRIMARY KEY` makes a duplicate `source_position` for the same protocol a
schema-level impossibility; the `UNIQUE` constraint does the same for a duplicate
`source_key`; `source_key NOT NULL` is the column's own declared constraint (no
`CHECK` needed); an "empty" protocol simply has zero rows here, which is a directly
observable, queryable fact (`count(*) = 0`), not an ambiguous array state. **Contiguous,
zero-based positions are verified procedurally, not declaratively** — no single-row
`CHECK` can express "no gaps across all rows for this protocol version," so
`register_adoption_protocol` (Decision K.6) verifies, inside the same transaction that
inserts these rows, that `count(*) = max(source_position) + 1` and `min(source_position)
= 0` for the `(domain, protocol_version)` it just registered, failing the whole
registration transaction if not.

#### E.2b The `jsonb` representability boundary — a genuine, named architecture blocker

**The defect, stated precisely.** `canonical_candidate` (Decision E.11) is stored as
`jsonb`, and `extensions.jsonb_matches_schema`'s own `instance` parameter is `jsonb`
(Decision I) — both require converting the staged, fingerprint-verified bytes into a
`jsonb` value before validation or storage can happen at all. PostgreSQL's `jsonb`
input function is **stricter than valid JSON syntax alone**: it rejects the six-character
escape sequence for U+0000 and any malformed/unpaired Unicode surrogate escape
(Decision B's representability boundary, above) — both of which are syntactically
valid JSON, and both of which the existing TypeScript validators
(`validatePersistedAssessmentRun` et al.) accept without complaint, since JavaScript
strings and `JSON.parse` impose no such restriction. **A prior revision of this
document (scenario 23) silently claimed such content "remains fully representable" —
this was false, and this ADR does not paper over it by mislabeling valid JSON as
"malformed."**

**Because PostgreSQL's own JSON parsing is monolithic — it cannot partially parse a
document into `jsonb` — a single occurrence of either unrepresentable escape anywhere
in a staged source document causes the **entire document's** conversion to `jsonb` to
fail, not merely one nested entity's.** This collapses to a **document-level**
failure, not a per-entity one.

**The exact classifier — corrected a second time (Task 4). The two-stage cast
correctly distinguishes *which kind* of representability problem occurred, by
sequencing alone — but the prior revision's own `EXCEPTION WHEN OTHERS` framing left a
real gap: it classified an exception from either cast as the expected case
unconditionally, so a genuinely unrelated operational failure occurring while either
cast statement happens to execute (resource exhaustion, a statement timeout, anything
that is not actually about this document's own JSON content) would have been
misclassified as an ordinary, expected document-validation fact rather than
`internal_failure`.** This document adopts **Option B**: until a live PostgreSQL
instance is available to verify the exact `SQLSTATE`(s) the two cast failures actually
raise for this specific representability case (Option A's own explicit prerequisite,
unmet in this session, Appendix), the fine-grained distinction between "not valid JSON
at all" and "valid JSON, rejected only by `jsonb`'s stricter input function" is
**collapsed into one named result**, `document_validation_code =
'json_parse_or_representability_failed'` — not two. Splitting it back into two exact
codes (matching the two-stage sequencing below one-for-one) is a **named, deferred
implementation prerequisite**, not something this document claims to have already
resolved.

**The nested-exception structure, which does not depend on the unresolved exact-code
question to stay operationally safe — corrected (Task 5) to decode UTF-8 exactly once,
into its own variable, and to use uppercase `SQLSTATE` literals throughout (PostgreSQL's
own error-code spelling; a prior draft of this pseudocode used a lowercase `22p02`,
which is not how this document cites `SQLSTATE` codes anywhere else):**

```sql
begin
  -- outer function body
  begin
    decoded_text := convert_from(staged_bytes, 'UTF8');
  exception when sqlstate '22021' or sqlstate '22P05' then
    -- confirmed, Appendix, PostgreSQL Error Codes: 22021 character_not_in_repertoire
    -- and 22P05 untranslatable_character are the codes PostgreSQL's own
    -- encoding-conversion functions raise -- this is the ONLY place this document
    -- decodes UTF-8; every later step reads decoded_text, never staged_bytes again
    document_validation_code := 'invalid_utf8_or_text_unrepresentable';
    -- ... persist as validation_failed, return; never re-raised past this point
  end;
  begin
    parsed_json := decoded_text::json;
    -- corrected: casts the ALREADY-DECODED decoded_text variable, never a second
    -- convert_from(staged_bytes, 'UTF8') call -- UTF-8 decoding happens exactly once,
    -- in the block above, not repeated or re-attempted here
  exception when sqlstate '22032' or sqlstate '22P02' then
    -- confirmed, Appendix, PostgreSQL Error Codes: class 22 (Data Exception) is where
    -- both the JSON-specific 22032 and the generic 22P02 invalid-text-representation
    -- codes live -- this catches only that class, for the ::json cast specifically
    document_validation_code := 'json_parse_or_representability_failed';
    -- ... persist as validation_failed, return
  end;
  begin
    parsed_jsonb := parsed_json::jsonb;
  exception when sqlstate '22032' or sqlstate '22P02' then
    document_validation_code := 'json_parse_or_representability_failed';
    -- ... persist as validation_failed, return
  end;
  -- proceed to schema validation with parsed_jsonb
exception when others then
  -- anything NOT caught by the three inner blocks above (including a class-22
  -- exception this document has not verified as one of the codes checked, and every
  -- genuinely unrelated operational error) reaches here, unclassified, and becomes
  -- internal_failure (Decision I) -- never silently absorbed as an ordinary
  -- document-validation fact. Note (Task 5): PL/pgSQL's own `OTHERS` condition does
  -- not literally match every possible exception -- confirmed, Appendix, PostgreSQL
  -- PL/pgSQL Control Structures: "OTHERS matches every error type except
  -- QUERY_CANCELED and ASSERT_FAILURE." This document does not claim `internal_failure`
  -- is reachable from literally any PostgreSQL condition -- a query cancellation or an
  -- assertion failure inside this function propagates past this handler entirely,
  -- exactly as PL/pgSQL specifies, not converted to internal_failure.
end;
```

0. **Decode UTF-8 exactly once**, into `decoded_text`, in its own inner block — never
   inline inside the same expression as either JSON cast, and never repeated. An
   exception here whose `SQLSTATE` is `22021` or `22P05` (both confirmed, Appendix, as
   the codes PostgreSQL's own encoding-conversion functions raise) is classified
   `document_validation_code = 'invalid_utf8_or_text_unrepresentable'`. Any other
   `SQLSTATE` propagates to the outer handler.
1. **Then, cast `decoded_text` to `json`** (the looser type — Appendix: its input
   function checks only RFC 8259 syntax, and is confirmed to accept both the U+0000
   escape and a malformed surrogate escape that `jsonb` rejects). An exception here
   whose `SQLSTATE` is `22032` or `22P02` (both confirmed, Appendix, to be Class 22 Data
   Exception codes PostgreSQL uses for JSON/text-representation input failures) is
   caught by the **inner** block and classified `document_validation_code =
   'json_parse_or_representability_failed'` — never a bare, unconditional catch of
   "any exception this statement happened to raise." Any other `SQLSTATE` is **not**
   caught by this inner block at all, and propagates to the outer `EXCEPTION WHEN
   OTHERS` → `internal_failure` (subject to the `OTHERS`-scope caveat above).
2. **Only if step 1 succeeded, cast to `jsonb`**, with the identical inner-block
   structure and the identical `SQLSTATE` check. If step 1 already proved the bytes
   are syntactically valid JSON, and this second cast still raises a Class 22
   exception, the failure is attributable, **by the sequencing itself**, to exactly
   the one documented gap between the two types' input functions (Appendix) — but
   this document reports it as the **same** collapsed code as step 1, per the Option B
   choice above, not a second, more specific name. If step 2 also succeeds, parsing
   proceeds normally to schema validation.

**None of the three inner blocks (UTF-8 decode, `::json`, `::jsonb`) ever inspects
exception message text, localized or otherwise — only `SQLSTATE`, a stable,
non-localized identifier** — satisfying this document's own
requirement not to parse exception text. **Refining `'json_parse_or_representability_
failed'` back into two distinct codes matching steps 1/2 one-for-one is deferred until
the exact `SQLSTATE`(s) each step actually raises for this precise input have been
confirmed against a live PostgreSQL instance (Option A) — this document does not claim
that refinement is already safe to make.**

Both outcomes are reported as `status = 'validation_failed'` with the named
`document_validation_code` above (a value added to the enum in Decision E.11),
distinct from `'invalid_utf8_or_text_unrepresentable'` (Decision I's separate,
earlier `convert_from` check, which runs before either cast above is ever attempted).
This is an **honest, loud, distinctly-labeled failure**, never a silent quarantine of
data the existing application considers valid — the client can see exactly why (via
`query_adoption_analysis`'s `documentValidationCode`), but **the run cannot reach
`ready`, and this specific document can never be adopted through this pipeline as
currently designed.**

**Why the prior "fixture evidence" gate was not a real gate, and is removed.** The
immediately preceding revision required `transition_adoption_protocol_status` to check
for "evidence... that fixture-based testing... proves the source contract cannot
produce" an unrepresentable value. **A database transition function cannot enforce
that.** There is no column, constraint, or query that a `plpgsql` function can
evaluate to determine whether an external, unspecified fixture suite passed — "evidence
exists" is not a fact the database can observe. Worse, even a complete, currently-passing
fixture corpus is not proof: fixture coverage is necessarily finite, while the claim
required ("this source contract can **never** produce a raw NUL, the U+0000 escape, or
an unpaired surrogate, for any past or future document") is a universal claim over an
unbounded value space. No finite fixture corpus can establish it, no matter how large.
Describing fixture coverage as "proof of impossibility" was itself an overclaim this
revision retracts.

**This revision chooses Option B: an unconditional hard block, not a new approval
mechanism.** An alternative (Option A) would durably record a migration-controlled
representability contract or governance-approved approval record, bound to the exact
`(domain, source_contract_version, canonical_mapping_version)` triple, created only by
an explicit, out-of-band administrative process, and checked structurally by
`transition_adoption_protocol_status`. **This document does not adopt Option A** —
designing that approval record's schema, its creation authority, its required
supporting evidence (a normative source validator restricting the value space, or a
proven lossless representation, plus — if unsupported values are to be prohibited
outright — the validation changes, pre-adoption data scan, and recovery/export path for
already-existing incompatible data that prohibition would require) is itself a
substantial governance and architecture decision this narrowly-scoped correction pass
does not make on the document's own authority. Inventing that apparatus here, without
the separate product/governance approval Option A itself demands, would repeat the
same mistake in a more elaborate form.

**The hard block, stated exactly:** `transition_adoption_protocol_status` refuses
**every** `design_only → pilot` request, for **every** domain and protocol version,
unconditionally — checked **first**, immediately upon confirming the requested
transition is exactly `design_only → pilot` (Decision K.6's exact step order, Task 5),
**before** any other precondition in Decision E.2/E.2c is ever evaluated, not merely
"regardless of" them as if they might still be checked in some order — returning a
distinctly named result, `representability_contract_unresolved`
(added to Decision L's taxonomy, produced only by this function, only for a `→ pilot`
target), never `invalid_transition` (which would wrongly imply the request's *shape* or
*ordering* was the problem, not an unresolved design question) and never a bare
`internal_failure` (which would wrongly imply an unexpected condition rather than a
deliberate, documented refusal). **This block is unconditional and non-bypassable by
any request, role, or parameter this function accepts** — it is not a check against
any table state this ADR defines, precisely because no such row could honestly attest
to the universal claim above. Lifting it requires a **separate, later, accepted ADR**
that either (a) adopts Option A's approval-record design in full, with its own
governance and validation-change requirements, or (b) designs and implements a lossless
canonical representation replacing this document's current `jsonb`-based validation
mechanism (Decisions E.9/E.11/I/G) entirely. **Until such an ADR is accepted and its
migration applied, zero protocols can reach `pilot` through this function, by
construction — this is the enforcement mechanism, not a description of one.** This is a
genuine, unresolved architecture blocker (Decision P — corrected, Task 7: blockers are
listed in Decision P, never Decision Q, which is the contradiction-audit/scenario-proof
section), additional to, and independent
of, the Assessment draft/history split (Decision D) — resolving one does not resolve
the other.

#### E.2c `private.implemented_canonical_mappings` — the fail-closed, domain-scoped mapping-dispatch allow-list

**The defect, stated precisely — corrected a second time.** A protocol with
`canonical_entity_schema = NULL` could, under the second revision's wording, still
transition to `pilot`, even though no canonical mapping/finalizer handler exists for it
at all. That was fixed by adding this table — **but the fix itself was incomplete**:
keying the table by `canonical_mapping_version` **alone** made a mapping-version number
meaningful across the **entire installation**, not within the one domain that declared
it. `canonical_mapping_version` is chosen independently per domain (Decision E.2's
`adoption_protocols` row does not coordinate this number across domains) — under the
prior key, domain `assessment` shipping a handler for its own `canonical_mapping_version
= 1` would have made **any other domain's** protocol claiming
`canonical_mapping_version = 1` falsely pilot-eligible for mapping purposes too, purely
by numeric coincidence, with no relationship between the two domains' actual handler
code at all.

**Resolution — domain-scoped identity, bound to the exact deployed handler:**

```sql
create table private.implemented_canonical_mappings (
  domain text not null references private.domains(domain),
  canonical_mapping_version integer not null check (canonical_mapping_version > 0),
  handler_regprocedure regprocedure not null,
    -- the exact, currently-deployed PL/pgSQL function this mapping version dispatches
    -- to, e.g. cast from 'private.map_assessment_v1(uuid, jsonb)'::regprocedure.
    -- `regprocedure` (unlike plain `regproc`) is signature-qualified, so an overloaded
    -- function name cannot be inserted ambiguously; its own input function performs a
    -- catalog lookup at cast/INSERT time and RAISES if no matching function currently
    -- exists -- this row is therefore un-insertable unless the named handler function
    -- was already created, in the same or an earlier migration
  description text not null,
  added_at timestamptz not null default now(),
  primary key (domain, canonical_mapping_version),
  unique (handler_regprocedure)
    -- two different (domain, canonical_mapping_version) rows may never claim the same
    -- underlying handler function -- a distinct mapping version means a distinct,
    -- independently-deployed handler
);
```

**Exact strength of what this row proves, stated honestly — not overclaimed.** The
`regprocedure` column proves, structurally, that a function with this exact
schema-qualified name and argument-type signature **existed in the catalog at the
moment this row was inserted** — a bare `integer`/`text` claim (the prior revision's
whole mechanism) could not have proven even that much, since nothing would have stopped
inserting a row for a handler that was never written. **It does not prove more than
that.** PostgreSQL's own documentation (Appendix, Object Identifier Types) is precise
about when an OID-alias value **does** register a tracked dependency: "if a constant of
one of these types appears in a **stored expression** (such as a column default
expression or view), it creates a dependency on the referenced object" — e.g. a column
`DEFAULT nextval(...::regclass)` genuinely blocks dropping that sequence. **This
column is not that case.** `handler_regprocedure` holds ordinary **row data**, inserted
as a plain value, never as part of a column default or a view/rule definition — so no
`pg_depend` entry is created for it, and a later `DROP FUNCTION`/`CREATE OR REPLACE
FUNCTION` that changes the target function's signature is **not** blocked by this
row's existence, and would leave `handler_regprocedure` pointing at a stale or
dangling OID with no automatic detection.
**This row is therefore a migration-time-verified deployment attestation, stronger than
a bare version number but not a live, continuously-enforced guarantee against later
drift** — an operational discipline of never dropping or incompatibly replacing a
mapping handler function once a row here references it is required, and is not itself
enforced by any mechanism this document defines. Nor does this row's existence mean
this ADR's own `analyze_adoption`/`finalize_adoption` narrative (Decision G) actually
looks up and invokes `handler_regprocedure` dynamically — no such generic-dispatch
execution model is designed or specified here; building one is out of this
narrowly-scoped pass's boundary, and Decision D's Assessment-domain blocker means no
handler exists to dispatch to yet regardless.

**Named blocker (Task 6.2): "mapping execution/dispatch integration" — a genuine,
separate architecture blocker, not merely a caveat on this row's own proof strength.**
This document deliberately chooses to classify `implemented_canonical_mappings` rows as
**migration-time attestations only** (the paragraph above), rather than designing exact
live validation and invocation of the handler (a stable textual identity re-checked
against the current catalog at call time, plus an actual generic-dispatch mechanism
that looks up and calls `handler_regprocedure` from inside `analyze_adoption`/
`finalize_adoption`). Because that stronger design is not undertaken here, **"mapping
execution/dispatch integration exists and is verified live, not merely attested to at
migration time" is itself a named precondition no future `pilot` transition may be
considered ready for until it is separately designed and implemented** — alongside, and
independent of, Decision E.2b's `jsonb`-representability block and Decision D's
Assessment authority-unit split (all three listed together, Decision P). Even if
Decision E.2b's hard block were
lifted by a future ADR, and even if a migration inserted a row here referencing a real,
currently-existing handler function, **this document does not, by itself, make that
handler ever actually get called** — resolving this blocker requires its own explicit
design (live catalog re-validation at call time, and the dispatch mechanism itself),
not assumed to fall out of this table's mere existence.

Today, this table holds **zero rows** — consistent with Decision D/P: no canonical
mapping handler is deployed for any domain yet, including Assessment.

`transition_adoption_protocol_status`'s `→ pilot` gate (Decision E.2, corrected above)
requires **both** `canonical_entity_schema IS NOT NULL` **and** a row existing in
`private.implemented_canonical_mappings` for this **exact** `(domain,
canonical_mapping_version)` pair — never a bare `canonical_mapping_version IN (SELECT
...)` membership test unscoped by `domain`, which is exactly the cross-domain
collision this correction closes. A `design_only`-only or no-handler-implemented
mapping is `invalid_transition`, fail-closed — though, per Decision E.2b, this is now
moot in practice: the hard block on every `→ pilot` transition refuses the request
before this check's outcome could matter either way.

**No `FOREIGN KEY` from `adoption_protocols.canonical_mapping_version` to this table.**
`register_adoption_protocol` may register a protocol (`activation_status =
'design_only'`) with a `canonical_mapping_version` for which no
`implemented_canonical_mappings` row exists yet — registration and mapping-handler
deployment are deliberately independent operational steps, in either order, and a hard
`FOREIGN KEY` here would wrongly force the handler to be deployed before the protocol
could even be registered. The `(domain, canonical_mapping_version)` relationship is
checked procedurally, only at the `→ pilot` transition (above), not declared as a
schema-level constraint on `adoption_protocols` itself.

#### E.3 `public.profiles` — corrected: the superseded identity equality removed

**This document previously stated `id` (`= auth.users.id`) with an FK
`id references auth.users(id) on delete restrict`.** That is superseded and wrong,
not merely stale: `docs/adr/0022-team-foundation-domain-and-persistence.md` Decision
1 is the real, implemented model — `Profile.id` is its own stable, independently
generated UUID (`default gen_random_uuid()`), never equal to and never
foreign-keyed directly to `auth.users.id`. The link to an Auth account is a
separate table, `public.account_profile_links` (`account_id` primary key,
references `auth.users(id)`; `profile_id` unique, references `public.profiles(id)`)
— at most one Profile per account and vice versa, resolved by
`private.current_profile_id()`, never by equality on `profiles.id` itself. Columns:
`id`, `display_name`, `created_at`, `updated_at` (`updated_at` set exclusively by a
trigger, Decision K.9, never by the client directly) — this part is otherwise
unchanged. `bootstrap_account()` below (Decision H.8/Section M) must create a
Profile through this real link model, not through an FK to `auth.users(id)` on
`profiles.id` itself — see the identity/authority-scope blocker in Status.

#### E.4 `public.athletes` — corrected: not automatically created; still not scope-resolved

`id`, `profile_id` (`UNIQUE`, `on delete restrict`, now referencing the corrected
`public.profiles.id` above), `created_at`; `unique (id, profile_id)` for
`assessment_runs`'s composite FK (Decision E.9). **This document previously implied
an `athletes` row is created for every account, together with its `profiles` row,
by `bootstrap_account()`.** Per ADR-0022 Decision 10, `Athlete` is a separate,
lazily-created, OPTIONAL capability attached to a Profile — no RPC in the actual,
implemented Team Foundation schema ever inserts one automatically as a side effect
of account/Profile bootstrap. `bootstrap_account()`'s unconditional
`profiles`/`athletes` `INSERT` (Decision H.8/Section M) is wrong on this point and
must not be built as written — see the identity/authority-scope blocker in Status.
This entry does not by itself resolve whether `assessment_runs`'s own
`account_scope_id`-keyed foreign keys (Decision E.9) should reference an Athlete
scoped by account or by Profile — that is the separate, still-open blocker.

#### E.5 `private.account_domain_authorities` — corrected: full schema given, not "unchanged" prose

**⚠ BLOCKED (identity/authority-scope — see Status).** `account_scope_id` below is
this table's primary-key component and the identity every downstream lock, proof,
and RLS policy in this document keys on. Whether it should be the raw Auth account
id or `profiles.id` is not decided (see Status) — the schema below is not
implementation-ready as written.

**The defect, stated precisely.** The prior revision described this table only as
"unchanged," naming `authority_status`/`authority_revision` and the composite PK, but
never gave the column that actually identifies *which run* an authority record
currently reflects — even though Decision G.3 step 8 ("`account_domain_authorities` set
to `cloud_authoritative` with this run's `id`") and Decision H.1/H.4 (locking this row
by `(auth.uid(), domain)` and later needing to know the live `prepared` run) both
depend on such a column existing. ADR-0019 itself defers the concrete schema to this
document ("`AdoptionRun` (concrete schema deferred to ADR-0020)") — "unchanged" cannot
mean "never specified here either." This revision names the columns exactly:

```sql
create table private.account_domain_authorities (
  account_scope_id uuid not null,
  domain text not null,
  authority_status text not null default 'not_initialized'
    check (authority_status in
      ('not_initialized', 'adoption_prepared', 'cloud_authoritative', 'aborted')),
  authority_revision bigint not null default 0 check (authority_revision >= 0),
    -- bigint end-to-end (Decision H.7) -- never returned to a client except cast
    -- `::text` (Decision B/Task 4's bigint-safe-transport correction)
  adoption_run_id uuid,
    -- the run this authority CURRENTLY reflects: the live `prepared` run while
    -- authority_status = 'adoption_prepared'; the committed run while
    -- authority_status = 'cloud_authoritative'; NULL while 'not_initialized'/'aborted'
    -- (there is no "current" run in either of those two statuses)
  last_adoption_run_id uuid,
    -- the most recent run of ANY terminal status (committed or aborted) this pair has
    -- ever produced, retained even after a transition back to 'aborted' clears
    -- adoption_run_id to NULL -- so a client asking "what happened to my last attempt"
    -- always has an answer, distinct from adoption_run_id's "current" meaning
  primary key (account_scope_id, domain),

  check (
    (authority_status in ('not_initialized', 'aborted') and adoption_run_id is null)
    or
    (authority_status in ('adoption_prepared', 'cloud_authoritative')
      and adoption_run_id is not null)
  )
);
```

**No `FOREIGN KEY` on `adoption_run_id`/`last_adoption_run_id` in this `CREATE TABLE`
— genuinely required, not stylistic.** `private.adoption_runs` is created **after**
this table in dependency order (Decision E.7: this table at step 9, `adoption_runs` at
step 10 — `adoption_runs` itself has a composite `FOREIGN KEY` back to this table,
Decision E.6, which is exactly what forces this table to exist first). A `FOREIGN KEY`
from `adoption_run_id` to a table that does not exist yet is not executable SQL, so
both `adoption_run_id`'s and `last_adoption_run_id`'s composite `FOREIGN KEY`s to
`private.adoption_runs (id, account_scope_id, domain)` — which relies on `adoption_runs`'s
own `UNIQUE (id, account_scope_id, domain)`, Decision E.6 — are added via `ALTER TABLE`
in **Phase 2** (Decision E.7), alongside `adoption_runs`'s own reverse reference, once
both tables exist.

#### E.6 `private.adoption_runs` — corrected: typed source columns, exact fingerprint format, composite protocol FK

**⚠ BLOCKED (identity/authority-scope — see Status).** Same `account_scope_id`
blocker as E.5 — this table's composite keys/FKs against
`private.account_domain_authorities` inherit the same open question.

```sql
create table private.adoption_runs (
  id uuid not null default pg_catalog.gen_random_uuid() primary key,
  account_scope_id uuid not null,
  domain text not null,
  protocol_version integer not null check (protocol_version > 0),
  source_entry_count integer not null check (source_entry_count >= 0),
  source_fingerprint text not null check (source_fingerprint ~ '^fp1:[0-9a-f]{64}$'),
  status text not null check (status in ('prepared', 'committed', 'aborted')),
  analysis_frozen boolean not null default false,
  promoted_entity_count integer check (promoted_entity_count >= 0),
    -- set exactly once, by finalize_adoption, alongside status='committed'; NULL until then
  superseded_by_run_id uuid,
  client_request_id uuid not null,
  committed_at timestamptz,
  aborted_at timestamptz,
  abort_reason text,
    -- populated exactly when status transitions to 'aborted': the client-supplied,
    -- length-bounded free text for an ordinary abort_adoption call, or the fixed
    -- system string 'superseded_by_replacement' for abort_and_replace_adoption's own
    -- internal abort step (Decision H.2) — never left unstored (the prior revision
    -- accepted this parameter without ever persisting it)
  updated_at timestamptz not null default now(),

  check ((status = 'committed') = (committed_at is not null)),
  check ((status = 'aborted') = (aborted_at is not null)),
  check ((status = 'aborted') or superseded_by_run_id is null),
  check (superseded_by_run_id is null or superseded_by_run_id <> id),
  check ((status = 'committed') = (promoted_entity_count is not null)),

  foreign key (domain, protocol_version)
    references private.adoption_protocols (domain, protocol_version),

  unique (id, account_scope_id, domain),
    -- required so account_domain_authorities and superseded_by_run_id below can bind a
    -- referenced run to the exact same (account_scope_id, domain) pair, structurally

  foreign key (superseded_by_run_id, account_scope_id, domain)
    references private.adoption_runs (id, account_scope_id, domain),
    -- self-referential; valid within one CREATE TABLE because the table's own PK/unique
    -- constraints above are already declared earlier in this same statement

  unique (account_scope_id, domain, client_request_id)
);

create unique index adoption_runs_one_prepared_per_pair
  on private.adoption_runs (account_scope_id, domain)
  where status = 'prepared';
```

`source_fingerprint`'s `CHECK` (`^fp1:[0-9a-f]{64}$`) enforces the exact wire format
ADR-0019 Decision 3 defines: the literal prefix, then exactly 64 lowercase hex
characters (one SHA-256 digest). `(account_scope_id, domain)` still references
`private.account_domain_authorities` — that composite FK is added in Phase 2 (Decision
E.7, unchanged two-phase requirement) since `account_domain_authorities` is created
after `adoption_runs` in dependency order.

**`source_manifest_extra` is removed entirely** — no column, no reference, matching
Decision E.2's removal of the field it depended on.

#### E.7 Two-phase DDL order (`adoption_protocol_source_keys` and `implemented_canonical_mappings` added to Phase 1)

```text
Phase 1 — base tables, no cross-referencing FKs yet:
  1. CREATE SCHEMA extensions; CREATE SCHEMA private;
  2. CREATE EXTENSION pgcrypto WITH SCHEMA extensions;
  3. CREATE EXTENSION pg_jsonschema WITH SCHEMA extensions;
  3a. Migration assertion (Decision B/E.2c): verify to_regprocedure(...) resolves the
      exact expected extension function signatures before proceeding — see the
      "Migration assertions" note after this table.
  4. CREATE TABLE private.domains (...);
  5. CREATE TABLE private.adoption_protocols (...);
  6. CREATE TABLE private.adoption_protocol_source_keys (...);
  6a. CREATE TABLE private.implemented_canonical_mappings (...);
  7. CREATE TABLE public.profiles (...);
  8. CREATE TABLE public.athletes (...);
  9. CREATE TABLE private.account_domain_authorities (
       ..., adoption_run_id uuid, last_adoption_run_id uuid  -- NO FK yet on these two
     );
  10. CREATE TABLE private.adoption_runs (
        ..., foreign key (domain, protocol_version) references private.adoption_protocols (...)
        -- account_domain_authorities FK NOT added yet
      );

Phase 2 — the two cyclic/composite constraints, added once both tables exist:
  11. ALTER TABLE private.adoption_runs
        ADD CONSTRAINT fk_account_domain_authority
        FOREIGN KEY (account_scope_id, domain)
        REFERENCES private.account_domain_authorities (account_scope_id, domain);
  12. ALTER TABLE private.account_domain_authorities
        ADD CONSTRAINT fk_adoption_run
        FOREIGN KEY (adoption_run_id, account_scope_id, domain)
        REFERENCES private.adoption_runs (id, account_scope_id, domain);
  13. ALTER TABLE private.account_domain_authorities
        ADD CONSTRAINT fk_last_adoption_run
        FOREIGN KEY (last_adoption_run_id, account_scope_id, domain)
        REFERENCES private.adoption_runs (id, account_scope_id, domain);

Phase 3 — remaining, non-cyclic tables:
  14. CREATE TABLE private.adoption_staged_entries (...);
  15. CREATE TABLE private.adoption_analyses (...);
  16. CREATE TABLE private.adoption_analysis_candidates (...);
  17. CREATE TABLE private.adoption_conflicts (...);
  18. CREATE TABLE public.assessment_runs (...);
  19. CREATE TABLE public.assessment_history_tombstones (...);
  20. CREATE VIEW public.assessment_history_active WITH (security_invoker = true) AS ...;
```

No `DEFERRABLE` constraint is used or needed — every forward reference above is either
within one `CREATE TABLE` (self-referential, valid) or a later `ALTER TABLE` against
already-existing tables (never a same-statement mutual reference, which PostgreSQL
cannot express regardless of deferrability, per the Appendix's confirmed foreign-key
documentation).

**Migration assertions for extension function signatures (step 3a) — fail the
migration at deploy time, not at first runtime call, on an extension-version/signature
mismatch:**

```sql
do $$
begin
  if to_regprocedure('extensions.digest(bytea, text)') is null then
    raise exception 'pgcrypto: expected signature extensions.digest(bytea, text) not found';
  end if;
  if to_regprocedure('extensions.jsonschema_is_valid(json)') is null then
    raise exception 'pg_jsonschema: expected signature extensions.jsonschema_is_valid(json) not found';
  end if;
  if to_regprocedure('extensions.jsonb_matches_schema(json, jsonb)') is null then
    raise exception 'pg_jsonschema: expected signature extensions.jsonb_matches_schema(json, jsonb) not found';
  end if;
end;
$$;
```

`to_regprocedure` resolves a textual function signature to its OID, returning `NULL`
(never raising) if no matching function/signature exists — exactly the right primitive
for a migration-time assertion, since a mismatched extension version (a different
argument-type overload, a renamed function) fails the migration immediately, with a
named, readable error, rather than surfacing as a confusing runtime `internal_failure`
the first time `analyze_adoption`/`transition_adoption_protocol_status` happens to call
the missing signature.

#### E.8 `private.adoption_staged_entries` — corrected byte representation

```sql
create table private.adoption_staged_entries (
  id bigint generated always as identity primary key,
  adoption_run_id uuid not null references private.adoption_runs(id),
  source_key text not null,
  source_position integer not null check (source_position >= 0),
  source_value_is_null boolean not null,
  source_value_utf8 bytea,
  check (
    (source_value_is_null and source_value_utf8 is null)
    or (not source_value_is_null and source_value_utf8 is not null)
  ),
  unique (adoption_run_id, source_key),
  unique (adoption_run_id, source_position)
);
```

**Insert-only; no `ON CONFLICT ... DO UPDATE` anywhere** (Decision F.1's whole-batch
compare-then-classify replaces per-row upsert entirely).

#### E.9 `public.assessment_runs` (unchanged composite identity; header columns expanded)

**⚠ BLOCKED (identity/authority-scope — see Status).** The `fk_athlete` constraint
below (`foreign key (athlete_id, account_scope_id) references public.athletes (id,
profile_id)`) asserts `assessment_runs.account_scope_id = athletes.profile_id` —
i.e. it treats `account_scope_id` as Profile-scoped. `bootstrap_account()`
(Decision H.8/Section M) instead inserts authority rows with
`account_scope_id = auth.uid()` — account-scoped. Both cannot be right at once
under ADR-0022's real model, where `profiles.id` and `auth.uid()` are different
UUIDs. This composite FK is exactly the concrete, executable proof that the
account-scope-vs-Profile-scope choice was never actually made — it must not be
deployed as written until that choice is.

```sql
create table public.assessment_runs (
  account_scope_id uuid not null,
  assessment_run_id uuid not null,
  domain text not null default 'assessmentHistory' check (domain = 'assessmentHistory'),
  athlete_id uuid not null,
  adoption_run_id uuid not null,
  source_contract_version integer not null,
  canonical_mapping_version integer not null,
  template_id text not null,
  template_version integer not null,
  status text not null check (status in ('completed', 'incomplete')),
  entity_schema_version integer not null,
    -- the legacy AssessmentRun.schemaVersion value — distinct from
    -- source_contract_version (the source document's own schemaVersion contract) and
    -- from canonical_mapping_version (this ADR's own mapping-logic version); see
    -- Decision I's "four distinct versions" note
  created_at_source text not null,
    -- the EXACT, verbatim source timestamp string (Decision I's "Timestamp fidelity" —
    -- corrected to preserve the original lexical representation directly, never to
    -- reconstruct it from timestamptz); validated only as "a non-empty string the
    -- document-level schema already accepted," no further grammar re-imposed here
  created_at timestamptz not null,
    -- a PARSED COMPANION of created_at_source, for sorting/range-querying only —
    -- never the field the client reconstructs its own `createdAt` value from
  completed_at_source text,
    -- same pattern as created_at_source; NULL exactly when completed_at is NULL
  completed_at timestamptz,
  payload jsonb not null,
    -- excludes every field promoted to a typed column above, and excludes
    -- templateSnapshot.id specifically (promoted as template_id) — see Decision I's
    -- reconstruction rule
  canonicalized_at timestamptz not null default now(),
  primary key (account_scope_id, assessment_run_id)
);

alter table public.assessment_runs
  add constraint fk_adoption_run
  foreign key (adoption_run_id, account_scope_id, domain)
  references private.adoption_runs (id, account_scope_id, domain);

alter table public.assessment_runs
  add constraint fk_athlete
  foreign key (athlete_id, account_scope_id)
  references public.athletes (id, profile_id);
```

`entity_schema_version` replaces the prior revision's ambiguous `schema_version` —
Decision I distinguishes this from `AssessmentPersistedState.schemaVersion` (checked
against `source_contract_version`, never stored on this row at all, since it describes
the *document*, not this *entity*), `protocol_version` (on `adoption_runs`, not here),
and `canonical_mapping_version` (now stored here too, promoted from the registry at
promotion time, for audit).

#### E.10 `public.assessment_history_tombstones` (unchanged)

**⚠ BLOCKED (identity/authority-scope — see Status).** Inherits E.9's
`account_scope_id` blocker via its FK to `assessment_runs`.

`(account_scope_id, assessment_run_id)` composite PK, FK to `assessment_runs` `on delete
restrict`, `deleted_at`, `reason`.

#### E.11 `private.adoption_analyses`, `private.adoption_analysis_candidates`, `private.adoption_conflicts` — materialized, not summary-only

**The defect, stated precisely.** The prior revision's `adoption_analyses` stored only
counts and a fingerprint match boolean — no candidate content, no ordering, no digest.
`finalize_adoption` had no durable object to promote from or to validate conflict
decisions against; it would have had to re-parse the original bytes a second time,
outside of any proof that the second parse produced the same result as the first.

**Resolution:**

```sql
create table private.adoption_analyses (
  adoption_run_id uuid not null references private.adoption_runs(id),
  analysis_revision integer not null default 1 check (analysis_revision > 0),
  recomputed_fingerprint text not null check (recomputed_fingerprint ~ '^fp1:[0-9a-f]{64}$'),
  fingerprint_match boolean not null,
  parsed_entity_count integer check (parsed_entity_count >= 0),
    -- NULL when status is fingerprint_mismatch or validation_failed (nothing was parsed)
  conflict_count integer not null default 0 check (conflict_count >= 0),
  document_validation_code text,
    -- NULL unless status = 'validation_failed'; one of a fixed, named enum --
    -- corrected (Task 4): 'invalid_utf8_or_text_unrepresentable' (renamed from bare
    -- 'invalid_utf8' -- covers both a malformed byte sequence and a character that
    -- decodes but cannot be represented in the target encoding, Decision I),
    -- 'json_parse_or_representability_failed' (collapsed from the separately-named
    -- 'invalid_json'/'jsonb_unrepresentable_escape' -- Option B, Decision I/E.2b: not
    -- yet split into two exact codes pending live SQLSTATE verification),
    -- 'unrecognized_schema_version', 'schema_mismatch' -- identifying which
    -- document-level rule failed, see this section's own detail
  validation_detail jsonb not null default '{}'::jsonb,
    -- bounded, non-sensitive, SERVER-CONSTRUCTED diagnostic detail only (e.g. a byte
    -- offset, a field name, an expected-vs-actual enum value) — never raw, unvalidated
    -- source content echoed back, which could be arbitrarily large, could contain the
    -- athlete's own data, and would risk the exact same jsonb-representability failure
    -- this column exists to report on (Decision E.2b)
  analysis_digest text not null check (analysis_digest ~ '^ad1:[0-9a-f]{64}$'),
    -- see this section's own detail for the exact, status-dependent input
  resolution_digest text check (resolution_digest ~ '^rd1:[0-9a-f]{64}$'),
    -- NULL until status = 'ready'; see this section's own detail
  status text not null check (status in ('fingerprint_mismatch', 'validation_failed', 'conflicts_present', 'ready')),
  created_at timestamptz not null default now(),
  primary key (adoption_run_id, analysis_revision)
);

create table private.adoption_analysis_candidates (
  adoption_run_id uuid not null,
  analysis_revision integer not null,
  candidate_ordinal integer not null check (candidate_ordinal >= 0),
  entity_key text not null,
    -- the parsed entity's own id (e.g. AssessmentRun.id) — never a source_key
  content_digest text not null check (content_digest ~ '^cd1:[0-9a-f]{64}$'),
    -- an OPTIMIZATION/INDEXING aid only, never sufficient proof of equality on its own
    -- — see this section's own "digest and equality model" detail below. Deliberately
    -- NOT prefixed fp1: — it is a server-internal digest tied to this database's own
    -- implementation and canonical_mapping_version, never part of ADR-0019's
    -- cross-system fp1 protocol, which this candidate digest does not use (it has no
    -- fixed, ordered key set to frame the way a domain's source entries do)
  canonical_candidate jsonb not null,
  validation_status text not null check (validation_status in ('valid', 'invalid')),
  validation_detail jsonb not null default '{}'::jsonb,
  duplicate_group_key text,
    -- non-null exactly when >1 valid candidate shares this entity_key
  initial_exclusion_status text not null
    check (initial_exclusion_status in ('pending', 'selected', 'excluded_duplicate', 'excluded_invalid')),
    -- IMMUTABLE — corrected, replacing a digest reference
    -- (`exclusion_status_at_analysis_time`) to a column that did not exist anywhere in
    -- this schema. Set exactly once, by `analyze_adoption`, at row creation, to the
    -- classification Decision G.1/G.4 assigns before any resolution ever runs:
    -- 'excluded_invalid' for an invalid candidate; 'selected' for a valid singleton or
    -- the lowest-ordinal member of an identical-content group; 'excluded_duplicate' for
    -- every other member of an identical-content group; 'pending' for a member of a
    -- differing-content group awaiting resolution. No `UPDATE` grant is ever given on
    -- this column (Decision K.8) — it is `analysis_digest`'s own immutable baseline
    -- input (below), and must never be able to drift after the fact.
  exclusion_status text not null default 'pending'
    check (exclusion_status in ('pending', 'selected', 'excluded_duplicate', 'excluded_invalid')),
    -- MUTABLE — starts equal to `initial_exclusion_status` at the same INSERT
    -- (analyze_adoption sets both columns to the identical value in one statement);
    -- only `resolve_adoption_conflicts` ever changes this one afterward, moving a
    -- `pending` member of a differing-content group to `selected`/`excluded_duplicate`
    -- once its conflict is decided (Decision G.2). `initial_exclusion_status` never
    -- changes when this one does.
  foreign key (adoption_run_id, analysis_revision)
    references private.adoption_analyses (adoption_run_id, analysis_revision),
  primary key (adoption_run_id, analysis_revision, candidate_ordinal),
  unique (adoption_run_id, analysis_revision, candidate_ordinal, duplicate_group_key)
    -- a superset-of-PK unique constraint, added solely so adoption_conflicts below can
    -- bind a selected ordinal to the exact duplicate group it belongs to
);

create table private.adoption_conflicts (
  id uuid not null default pg_catalog.gen_random_uuid() primary key,
  adoption_run_id uuid not null,
  analysis_revision integer not null,
  duplicate_group_key text not null,
  conflict_type text not null check (conflict_type = 'intra_run_duplicate_id_different_content'),
  decision text check (decision in ('select_candidate_ordinal', 'exclude_duplicate_group')),
  selected_candidate_ordinal integer,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (adoption_run_id, analysis_revision)
    references private.adoption_analyses (adoption_run_id, analysis_revision),
  foreign key (adoption_run_id, analysis_revision, selected_candidate_ordinal, duplicate_group_key)
    references private.adoption_analysis_candidates (adoption_run_id, analysis_revision, candidate_ordinal, duplicate_group_key),
    -- NULL selected_candidate_ordinal skips this check entirely (standard FK MATCH
    -- SIMPLE behavior) — enforced only once a selection is actually made, and even then
    -- only accepts an ordinal that is a member of THIS exact duplicate group
  check (
    -- corrected from `(decision = 'select_candidate_ordinal') = (selected_candidate_ordinal
    -- is not null)`, which evaluates to SQL NULL — and is therefore satisfied, not
    -- violated — whenever decision IS NULL, silently permitting an unresolved conflict
    -- to carry a non-null selected_candidate_ordinal. Replaced with a total, explicit
    -- three-way disjunction that is never NULL for any combination of the two columns:
    (decision is null and selected_candidate_ordinal is null)
    or (
      decision = 'select_candidate_ordinal'
      and selected_candidate_ordinal is not null
    )
    or (
      decision = 'exclude_duplicate_group'
      and selected_candidate_ordinal is null
    )
  ),
  unique (adoption_run_id, analysis_revision, duplicate_group_key)
);
```

**Analysis outcome, exactly four mutually exclusive statuses, in this priority order:**

1. **`fingerprint_mismatch`** — the recomputed fingerprint (Decision B) does not match
   `adoption_runs.source_fingerprint`. No document parsing, no entity validation, no
   candidates are created. The manifest lied about its own content; nothing downstream
   is trustworthy.
2. **`validation_failed`** — fingerprint matched, but the staged bytes fail
   `source_document_schema` validation (not valid UTF-8, not valid JSON, or the parsed
   document doesn't match the protocol's declared document shape — e.g. an
   unrecognized top-level `schemaVersion`). No candidates are created; the document
   itself could not be understood.
3. **`conflicts_present`** — the document parsed and validated; every extracted entity
   was individually checked against `canonical_entity_schema` plus cross-field rules
   (Decision I) and became a candidate row (`validation_status = 'valid'` or
   `'invalid'`); among **valid** candidates, at least one `entity_key` has more than one
   candidate with **differing** `content_digest` (a genuine, user-resolvable conflict;
   `duplicate_group_key` assigned, an `adoption_conflicts` row created) that is not yet
   fully decided.
4. **`ready`** — the document and every entity validated, and either there were no
   duplicate `entity_key` groups among valid candidates at all, or every such group has
   already been fully resolved.

**Individually invalid entities never block the rest of the document.** An entity that
fails `canonical_entity_schema`/cross-field validation gets its own candidate row with
`validation_status = 'invalid'`, `exclusion_status = 'excluded_invalid'` automatically
(never user-resolvable, never promoted) — but every **other**, individually valid
entity in the same document can still proceed toward `conflicts_present`/`ready`. This
is deliberately different from a structurally broken document (which fails the whole
analysis as `validation_failed`, since nothing can be safely extracted from it at all).

**Every candidate's initial `exclusion_status`, assigned exactly, by category — no
candidate is ever left in an unassigned or ambiguous state:**

| Candidate category | Initial `exclusion_status` |
|---|---|
| Individually invalid entity (`validation_status = 'invalid'`) | `excluded_invalid` |
| Valid, and the only candidate for its `entity_key` (a singleton) | `selected` |
| Valid, and one of a group whose members all share an identical `content_digest` **and** are proven jsonb-equal (below) | The lowest `candidate_ordinal` in the group: `selected`; every other member: `excluded_duplicate` |
| Valid, and one of a group with at least one differing member (by jsonb equality) | `pending`, for **every** member of the group |

**No valid singleton candidate may remain `pending`** — a singleton has no group to wait
on, and is `selected` the instant `analyze_adoption` classifies it. After
`resolve_adoption_conflicts` (Decision G.2) decides a `pending` group:

- `select_candidate_ordinal` → the chosen ordinal becomes `selected`; every other member
  of that same group becomes `excluded_duplicate`.
- `exclude_duplicate_group` → every member of that group becomes `excluded_duplicate`
  (none `selected`).

**The `ready`-status question, decided explicitly.** `validation_failed` means the
**source document itself** could not be parsed or schema-validated — nothing extracted
from it is trustworthy, and no candidates exist at all for that analysis. An
**individually** invalid **extracted entity**, once the document itself is valid, is a
different, narrower fact: it is recorded (`validation_status = 'invalid'`,
`exclusion_status = 'excluded_invalid'`) and does not prevent the analysis from reaching
`ready` — **`ready` means the document is valid, every candidate has been classified,
and every conflict has been resolved; it does not mean every candidate passed
validation.** **A document containing only individually invalid entities may still
reach `ready` and `finalize_adoption` may still commit it, with `promoted_entity_count =
0`** — this is a deliberate, explicit choice, consistent with the existing client-side
precedent that an individually invalid persisted run is quarantined on its own, never
treated as a reason to reject the rest of a history import (and here, degenerately,
there is no "rest" to promote, which is not itself an error condition — an adoption
whose entire submitted history turns out to be unusable is a legitimate, if unusual,
outcome, not a failure of the adoption mechanism itself).

**Duplicate handling, generalized beyond two occurrences.** Among **valid** candidates
sharing one `entity_key`, per the table above: **identical, jsonb-proven-equal**
content is auto-resolved with no conflict row; **any genuinely differing** content is a
user-resolvable conflict, generalized to any group size via
`select_candidate_ordinal`/`exclude_duplicate_group` — never the ambiguous
`keep_first_parsed`/`keep_second_parsed` pair, which cannot express a three-or-more-way
choice.

**Digest and equality model — `content_digest` is an optimization aid, never proof of
equality on its own.** `canonical_candidate` is stored as `jsonb`; PostgreSQL's `jsonb`
type stores a decomposed binary representation that does not preserve source whitespace
or object key order, so `jsonb` **equality (`=`) is already exact, structural content
equality** — this ADR does not invent a separate cross-platform canonical-JSON
algorithm, since PostgreSQL's own `jsonb` equality already provides it, correctly scoped
to this database. `content_digest` (`cd1:` + 64 lowercase hex,
`extensions.digest(pg_catalog.convert_to(canonical_candidate::text, 'UTF8'), 'sha256')`)
exists **only** to make grouping/lookup cheap (an index or an equality check on a fixed-
length string rather than a large `jsonb` comparison) — it is explicitly **not** treated
as sufficient proof that two candidates are equal: **before two candidates are
classified as an exact duplicate, their `canonical_candidate` values are compared with
`jsonb` equality directly, even when their `content_digest`s already match.** A digest
collision between two candidates whose `jsonb` content actually differs (however
astronomically unlikely for SHA-256) is therefore classified correctly, as **differing**
content — a real conflict, never silently merged.

**`analysis_digest`/`resolution_digest` are defense-in-depth only, never the primary
proof of anything** (Decision H.5/G.3 step 5's direct structural checks are the
primary enforcement; a digest match is a cheap, redundant confirmation of it) — restated
here because the exact byte framing below exists only to make that redundant check
reproducible, not to add a fifth, independent trust boundary.

**Exact byte framing — corrected from a bare "over (tuple)" description to a
reproducible algorithm, using the same length-prefixed, big-endian primitives Decision
B's `fingerprint_domain_snapshot` already establishes (`int8send`/`int4send`, never a
delimiter character that could itself appear in a value).**

**Corrected a second time: the prior revision's framing bound too little.** A list of
`content_digest`, `duplicate_group_key`, and `conflict_type` values did not bind every
immutable field `finalize_adoption` actually trusts — a `candidate_ordinal`/`entity_key`
swap between two candidates, a corrupted `validation_status`/`validation_detail`, or a
tampered `recomputed_fingerprint`/count could all leave the prior digest unchanged.
**This framing now covers every immutable candidate/conflict field *used by
finalization*** (Task 4 — narrowed from an unqualified "every immutable field," which
this framing does not literally cover: `adoption_run_id`/`analysis_revision`, for
instance, are deliberately omitted, since they are the row's own primary key context,
already fixed by which row this digest is stored in, not a content fact the digest
itself needs to reprove), plus the counts and fingerprint finalization relies on, with
an explicit record tag on every framed unit so a future field addition can never be
silently reinterpreted as a different one. **`canonical_candidate` itself is bound only
indirectly, through `content_digest`** — `candidate_tuple` frames the stored
`content_digest` value, not a fresh hash of `canonical_candidate` computed inline —
which is exactly why Decision G.3 step 1 separately, directly recomputes
`content_digest` from `canonical_candidate` and compares it **before** trusting that
stored value anywhere else in the checklist (Task 1.2); without that separate step,
`analysis_digest`'s own binding of `content_digest` would only prove internal
self-consistency between two stored columns, never that `content_digest` still
reflects `canonical_candidate` correctly:

- `frame_text(s)` = `int8send(octet_length(convert_to(s, 'UTF8'))::bigint) ||
  convert_to(s, 'UTF8')` — an 8-byte big-endian length prefix, then the UTF-8 bytes
  themselves.
- `frame_int(v)` = `int8send(v::bigint)` — a fixed 8-byte big-endian encoding, no
  length prefix needed (every framed integer here is a fixed-width `bigint`).
- `frame_opt_int(v)` = `'\x00'::bytea` when `v IS NULL`, else `'\x01'::bytea ||
  int8send(v::bigint)` — the null-flag-byte convention `fingerprint_domain_snapshot`
  uses for `source_value_is_null` (Decision B), reused rather than inventing a second
  one.
- `frame_opt_text(s)` = `'\x00'::bytea` when `s IS NULL`, else `'\x01'::bytea ||
  frame_text(s)` — the same null-flag convention, for a nullable text field
  (`duplicate_group_key`, which is `NULL` for a candidate not in any duplicate group) —
  an **explicit** null representation, never a zero-length string standing in for
  "absent," which would be indistinguishable from a genuinely empty (but present)
  string.
- `frame_tag(name)` = `frame_text(name)` — an explicit record/type tag opening every
  per-candidate and per-conflict tuple below, and the whole analysis buffer itself —
  so a future schema change to any one framed unit changes its own tag, and can never
  be silently misread as an unversioned older or newer shape.
- `frame_array_bytes(items)` = `int4send(cardinality(items))` followed by each
  already-self-delimiting framed item, concatenated in order — an explicit element
  count first, so an empty array and a missing array are never ambiguous.
- `frame_jsonb_digest(v)` = `frame_text(encode(digest(convert_to(v::text, 'UTF8'),
  'sha256'), 'hex'))` — a digest of an open-ended `jsonb` value's own `::text` form,
  rather than the raw content, used for every `jsonb` column framed below
  (`validation_detail`, `details`). **Corrected (this pass): the prior wording claimed
  this "never depends on `jsonb`'s own object-key-ordering behavior" — the opposite of
  true, and already contradicted by this same section's later discussion of the
  corrected adversarial vector.** The digest is computed directly from `v::text`, so it
  depends entirely on PostgreSQL's exact `jsonb::text` output for `v` — including
  whatever key ordering, spacing, quoting, and numeric rendering PostgreSQL's `jsonb`
  type itself chooses to produce for that value. What it does **not** depend on is the
  original *input* text's whitespace or *input* key order, because `jsonb` (unlike
  `json`) never preserves either of those — two differently-formatted or
  differently-ordered inputs that parse to the same `jsonb` value produce the same
  `::text` output and therefore the same digest. Direct `jsonb` equality (`=`), not this
  digest, remains the authoritative content-equality check (Decision E.11); this digest
  is a server-internal binding used only to detect that a stored `jsonb` value has
  changed since a prior digest was computed over it, always produced and recomputed by
  PostgreSQL itself, never reproduced independently by client code. The PostgreSQL
  documentation this ADR cites (Appendix) does not establish that `jsonb::text`'s exact
  byte output is stable across PostgreSQL major versions — this framing does not assume
  that stability, and this document does not invent a cross-version canonical-JSON
  guarantee to paper over its absence (see the operational rule below).

**A narrow operational rule for PostgreSQL major-version upgrades, stated exactly, not
invented as a broader guarantee:** because `frame_jsonb_digest` (and every `ad1`/`cd1`
vector built from it) depends on the exact `jsonb::text` bytes the running PostgreSQL
version produces, a **prepared** adoption run (one that has staged entries and/or an
open analysis, but has not yet reached `finalize_adoption`) must not span a PostgreSQL
major-version upgrade unless the stored digest framing (`candidate_v2`/`conflict_v2`/
`analysis_v3`) has been separately verified against the target PostgreSQL version's
`jsonb::text` output. The two safe alternatives, both already available given that no
protocol has ever reached `pilot` or `production` (Decision Q/Appendix): finish the
prepared run (through `finalize_adoption`) **before** the upgrade, or abort it and
restart a fresh run **after** the upgrade completes. This is an availability/operational
compatibility constraint on **pre-authority, pre-commit** in-flight runs — it does not
claim cross-version digest stability, does not introduce a new canonical-JSON
algorithm, and is not a silent authority switch of any kind (Decision Q's own
authority-transition scope is unaffected).

**Corrected a third time, and re-versioned internally (never re-prefixed — explained
below): `candidate_tuple`/`conflict_tuple`/the analysis buffer's own tag are bumped to
`'candidate_v2'`/`'conflict_v2'`/`'analysis_v3'`, closing three real gaps.**

- `candidate_tuple(c)` = `frame_tag('candidate_v2') || frame_int(c.candidate_ordinal)
  || frame_text(c.entity_key) || frame_text(c.content_digest) ||
  frame_text(c.validation_status) || frame_jsonb_digest(c.validation_detail) ||
  frame_opt_text(c.duplicate_group_key) || frame_text(c.initial_exclusion_status)` —
  every immutable candidate field Decision E.11 defines. **Corrected: `c.
  initial_exclusion_status`** (Task 1.1) — the prior revision named a digest input,
  `exclusion_status_at_analysis_time`, that no column in this schema ever defined; it
  is now `private.adoption_analysis_candidates.initial_exclusion_status`, an actual,
  immutable, never-`UPDATE`-granted column (Decision E.11/K.8) set once by
  `analyze_adoption` and never touched again — never the row's *current*, mutable
  `exclusion_status`, which `resolve_adoption_conflicts` later changes and which
  `resolution_digest` (below) separately covers.
- `conflict_tuple(k)` = `frame_tag('conflict_v2') || frame_text(k.duplicate_group_key)
  || frame_text(k.conflict_type) || frame_jsonb_digest(k.details)`. **Corrected: now
  includes `k.details`** (Task 1.3) — the prior revision's tuple omitted this column
  entirely, leaving a conflict row's own diagnostic detail unbound; framed as a digest
  for the same reason `validation_detail` is (`details` is open-ended `jsonb`, Decision
  E.11).

**`analysis_digest`** (`ad1:` + `encode(digest(buf, 'sha256'), 'hex')`) covers the
**immutable analysis inputs** — computed once, by `analyze_adoption`, from a
status-dependent `buf`, every branch opening with `frame_tag('analysis_v3')`.
**Corrected: every branch is now complete** — the prior revision's `validation_failed`
branch omitted `recomputed_fingerprint` and the analysis-level `validation_detail`
even while this section's own prose claimed the fingerprint was "included in every
branch"; that claim is now actually true, for all three branches, not merely asserted:

- For `fingerprint_mismatch`: `frame_tag('analysis_v3') || frame_int(protocol_version)
  || frame_int(canonical_mapping_version) || frame_text('fingerprint_mismatch') ||
  frame_text(recomputed_fingerprint)`.
- For `validation_failed`: `frame_tag('analysis_v3') || frame_int(protocol_version) ||
  frame_int(canonical_mapping_version) || frame_text('validation_failed') ||
  frame_text(recomputed_fingerprint) || frame_text(document_validation_code) ||
  frame_jsonb_digest(validation_detail)` — **corrected to include
  `recomputed_fingerprint` and `validation_detail`**, both previously omitted despite
  this section's own claim that the fingerprint binds every branch.
- For `conflicts_present`/`ready`: `frame_tag('analysis_v3') ||
  frame_int(protocol_version) || frame_int(canonical_mapping_version) ||
  frame_text('candidates_extracted') || frame_text(recomputed_fingerprint) ||
  frame_int(parsed_entity_count) || frame_int(conflict_count) ||
  frame_int(staged_entry_count — Decision E.6's `adoption_runs.source_entry_count` at
  the moment of analysis) || frame_array_bytes([candidate_tuple(c) for each candidate,
  in `candidate_ordinal` order]) || frame_array_bytes([conflict_tuple(k) for each
  **`adoption_conflicts` row**, ordered by `duplicate_group_key` ascending — **never**
  including an identical-content group that was auto-resolved with no conflict row
  (Decision G.4 category 1); those groups contribute only their members' own
  `candidate_tuple`s to the array above, nothing to this one])`. **The literal tag
  `'candidates_extracted'` is deliberately the same for both `conflicts_present` and
  `ready`** — the two statuses describe the same immutable candidate/conflict input
  set, differing only in whether every conflict has since been *decided* (a fact
  `resolution_digest` covers, not this one); using the bare status name here would make
  a `ready` analysis's recomputed `analysis_digest` falsely disagree with the value
  stored back when it was still `conflicts_present`, the exact defect this framing is
  written to avoid.

`recomputed_fingerprint` is now, truthfully, included in **every** branch — binding
every analysis to the exact staged snapshot it was computed from, even though staging
is already frozen and cannot drift afterward (Decision F.1), as an explicit invariant
rather than an implicit, unstated one.

**Why the internal record tags are re-versioned but the external `ad1`/`cd1`/`rd1`
prefixes are not.** No protocol has ever reached `pilot`, no migration has been
applied, and no digest has ever been computed against a real row (Decision Q/Appendix)
— there is no deployed data to migrate away from, so there is no compatibility reason
to mint a new external prefix (`ad2:`) the way a real migration boundary would require.
This revision instead finalizes `ad1:`/`cd1:`/`rd1:` as the corrected, pre-deployment
contract, and bumps the **internal** `frame_tag` values
(`candidate_v1→v2`/`conflict_v1→v2`/`analysis_v2→v3`) specifically so that a stray
implementation built against the immediately preceding (also never-deployed) framing —
missing `initial_exclusion_status`, `details`, or the `validation_failed` fields above
— cannot silently produce a byte-identical prefix while actually hashing a different,
incomplete tuple shape; the tag itself changes whenever the fields it opens change, by
construction, independent of the external prefix question.

Every case is persisted — `analysis_digest` is `NOT NULL` regardless of status, and
`analysis_revision = 1` is persisted for **every** status, including the two failure
statuses (a failed analysis is still one durable, queryable fact, not an absent one;
`analyze_adoption` called again is still a pure read of it, per its existing
idempotency rule). `query_adoption_analysis` (Decision M) returns the full row —
`document_validation_code`/`validation_detail` when present, `analysis_digest`/
`resolution_digest` always — regardless of which status it holds.

**`resolution_digest`** (`rd1:` + `encode(digest(buf, 'sha256'), 'hex')`) covers the
**mutable resolution outputs** — `buf` = `frame_tag('resolution_v1') ||
int4send(v_conflict_count_integer) || frame_text(duplicate_group_key) ||
frame_text(decision) || frame_opt_int(selected_candidate_ordinal)` for every conflict,
**ordered by `duplicate_group_key` ascending** (the same fixed order `analysis_digest`
uses for its own conflict-derived array, so the two digests are never computed from
inconsistently-ordered conflict sets). **Corrected (this pass — a third time: the
prior two passes fixed the `bigint`/`integer` type mismatch and the naming
inconsistency, but still never compared the freshly computed aggregate against the
durable `private.adoption_analyses.conflict_count` this analysis already stores —
meaning an incorrect stored count could go undetected even though the true conflict
count was already known at the moment this sequence ran.** One exact sequence, same
variable names throughout, no bare `conflict_count` anywhere in it, and no second
`adoption_analyses` query — `v_stored_conflict_count_integer` is read from the same
`adoption_analyses` row `resolve_adoption_conflicts` already reads for this exact
`(adoption_run_id, analysis_revision)` pair while checking `status` (Decision G.2) —
itself covered by this function's own run-row lock's in-transaction logical freeze
(Global Lock Order, Decision H.4; the identical guarantee Decision N.2 already
attributes to `analyze_adoption`'s own read of this run's rows), so no additional
lock or query is needed to read it a second time:

```sql
select pg_catalog.count(*)
  into v_conflict_count_bigint
  from private.adoption_conflicts
  where adoption_run_id = p_adoption_run_id
    and analysis_revision = p_analysis_revision;

if v_conflict_count_bigint < 0
   or v_conflict_count_bigint > 2147483647 then
  -- classified internal_failure: this analysis's own conflict count (itself bounded
  -- by the `integer` columns `conflict_count`/`parsed_entity_count` it was derived
  -- from, Decision E.11) can never legitimately fall outside `integer`'s range —
  -- reaching this branch means a defect, never a value this function should silently
  -- wrap or truncate. No cast, no digest computation, no conflict mutation, and no
  -- analysis-state transition occurs; the transaction rolls back.
end if;

if v_conflict_count_bigint
   <> v_stored_conflict_count_integer::bigint then
  -- classified integrity_failure: the freshly computed aggregate over
  -- private.adoption_conflicts disagrees with this exact analysis row's own,
  -- already-loaded, durable conflict_count (Decision E.11) — a structurally-
  -- should-be-impossible disagreement between a stored summary value and the rows
  -- it is supposed to summarize, never silently accepted or reconciled by trusting
  -- one side over the other. No digest is accepted, no conflict decision or
  -- candidate exclusion_status changes, the analysis does not transition to
  -- `ready`, and the transaction rolls back.
end if;

v_conflict_count_integer := v_conflict_count_bigint::integer;

buf := frame_tag('resolution_v1')
  || pg_catalog.int4send(v_conflict_count_integer)
  || ...; -- followed by each conflict's own frame_text(duplicate_group_key) ||
          -- frame_text(decision) || frame_opt_int(selected_candidate_ordinal), in
          -- duplicate_group_key ascending order, exactly as stated above
```

**`v_stored_conflict_count_integer` means exactly one thing: the durable `conflict_
count` value already stored on the locked `private.adoption_analyses` row for this
exact `(adoption_run_id, analysis_revision)` pair — never a newly calculated value,
and never a value read from, or compared against, a different analysis revision.**
PostgreSQL's `count()` aggregate returns `bigint`; `pg_catalog.int4send` takes an
`integer` — `v_conflict_count_bigint` is computed first, bounds-checked, and then
compared against the stored count; only once both checks pass is it cast into
`v_conflict_count_integer`, the one value both the `buf` formula and the final
`int4send` call use. The stored `conflict_count` value itself is **never** passed to
`int4send`, framed into `buf`, or encoded directly in any way — it exists only as the
comparison target that validates the freshly computed aggregate before that aggregate
is encoded. The same explicit `bigint`-computed → bounds-checked → stored-count-
compared → `::integer`-cast, single named variable, discipline applies anywhere else
this document passes an aggregate count to `int4send` (`frame_array_bytes`'s own
`cardinality(items)` is exempt — `cardinality` already returns `integer` for an array
argument, not `bigint`, and has no separate durable count to compare against). **This
is a correctness and naming correction to the implementation, not a framing change**:
the four-byte big-endian encoding `int4send` produces for a given in-range,
stored-count-matching value is identical either way, so every `ad1`/`cd1`/`rd1` golden
vector in this document is unchanged by this correction — this sequence only adds a
validation step *before* encoding a value that, in every case these golden vectors
describe, already agreed with the stored count. `resolve_adoption_conflicts`
(Decision G.2) computes and persists `resolution_digest` in the same transaction that
flips `status` from `conflicts_present` to `ready`; it stays `NULL` for any analysis
with zero conflicts to begin with (nothing to resolve, `ready` is reached immediately
with no resolution step at all) and for either failure status.

**Digest golden vectors — regenerated a second time against `candidate_v2`/
`conflict_v2`/`analysis_v3` (Python `hashlib.sha256`, `struct.pack`); every vector for
the superseded `candidate_v1`/`conflict_v1`/`analysis_v2` framing is removed, not kept
alongside these** — they were correct answers to a framing this revision no longer
uses, and retaining them would invite testing against the wrong contract. Not executed
against a live PostgreSQL instance (none is available in this repository/session) —
this is not a claim that the `plpgsql` `int8send`/`int4send`/`digest`/`encode` calls
above have been mechanically run, only that the framing is unambiguous and
independently reproducible.

**Corrected: single-key `jsonb` objects narrow *one* dependency (key ordering) — they
do not, and cannot, remove this framing's dependence on PostgreSQL's own `jsonb::text`
serialization altogether.** An earlier computation of one of these vectors (the
"conflict `details` altered" row, below) was itself computed from the compact spelling
`{"note":"altered"}` rather than PostgreSQL's actual `jsonb::text` rendering,
`{"note": "altered"}` (a space after the colon) — producing a wrong digest, now
corrected. `content_digest`/`jsonb`-digest vectors below use single-key `jsonb`
objects specifically to avoid the *object-key-reordering* question a two-or-more-key
object would raise on `::text` output — but every vector below still depends on
`jsonb::text`'s exact spacing/quoting/number-formatting conventions for the one key it
does have, which this session cannot execute against a live database to confirm
independently of the corrected value now supplied. **The actual contract, stated
exactly, not overclaimed:**
- `content_digest`/`validation_detail`-digest/`details`-digest are **server-internal**
  digests — nothing outside this database ever needs to reproduce them independently
  of it.
- Every `jsonb`-typed field these digests cover is hashed from that value's own
  PostgreSQL `jsonb::text` output — never a client-side JSON serialization, and never
  assumed to match one byte-for-byte.
- Recomputing any of these digests (e.g. at `finalize_adoption`, Decision G.3) must use
  the **same** database's `jsonb::text` output for the same stored value — trivially
  true inside PostgreSQL itself, since the same engine produces both the stored value
  and any later re-hash of it.
- Any **cross-language** reproduction of a golden vector (as in this Appendix-adjacent
  table) must reproduce PostgreSQL's own exact `jsonb::text` representation for the
  input in question — not a plausible-looking hand-written approximation of it — or the
  vector is not actually validating this framing.
- **Live PostgreSQL verification of every vector below remains required before
  implementation** — this document does not claim otherwise, and does not invent a
  cross-platform canonical-JSON serialization guarantee (Decision E.11's own
  "digest and equality model" already makes this same point about candidate equality;
  it applies identically here).

Every scenario below uses `protocol_version=1`, `canonical_mapping_version=1`,
`validation_detail`/`details` `= {}` unless stated otherwise, and the `fp1` value from
golden vector 1:

| Case | Inputs | Digest |
|---|---|---|
| `content_digest`, candidate A | `canonical_candidate = {"value": 1}`, `::text` = `{"value": 1}` | `cd1:e1d70a18cc129fcc812ebbe309bc5197df6ffa2228c77a4a7b98653ec5605354` |
| `content_digest`, candidate B (differs from A) | `canonical_candidate = {"value": 2}` | `cd1:d2a6919189609bb4a2b924e35f740e5ee98b1f06c3c340d27df75ef48bd45816` |
| `content_digest`, an invalid candidate | `canonical_candidate = {"value": "not-a-number"}` | `cd1:7f9e572c97cf3703a750cb98662555697e86a255776be1581d13ed9ba76c6ee5` |
| `analysis_digest`, **zero candidates** | `parsed_entity_count=0, conflict_count=0, staged_entry_count=1`, empty candidate/conflict arrays | `ad1:901027843988913f9c61db600624a606c8ba9263d568380000a555d1aba3cce1` |
| `analysis_digest`, **invalid-only candidates** | `parsed_entity_count=1`; one candidate: `ordinal=1, entityKey="assessment-run-2", contentDigest=cd1:7f9e...c6ee5, validationStatus="invalid", validationDetail={"reason":"expected_integer"}, duplicateGroupKey=NULL, initialExclusionStatus="excluded_invalid"`; no conflicts | `ad1:be07a5509a12ac8bf9fbd215038854770bdd53ff47108e2518692fcfc1e2f60c` |
| `analysis_digest`, **identical duplicates** (2 valid candidates, same content, auto-resolved, no conflict row) | `parsed_entity_count=2, conflict_count=0`; candidates `(1, "assessment-run-1", cdA, "valid", {}, "g1", "selected")`, `(2, "assessment-run-1", cdA, "valid", {}, "g1", "excluded_duplicate")`; no conflicts | `ad1:05e5860e5fecd5cc302d8de6bfb293bd049f4d48112cfb30bb0d7b3fa99d3fce` |
| `analysis_digest`, **differing duplicates, baseline** (2 valid candidates, one conflict, undecided) | `parsed_entity_count=2, conflict_count=1`; candidates `(1, "assessment-run-1", cdA, "valid", {}, "g1", "pending")`, `(2, "assessment-run-1", cdB, "valid", {}, "g1", "pending")`; one conflict `("g1", "intra_run_duplicate_id_different_content", {})` | `ad1:f17b48200a475c94c223b4661d4551d88db2fa6ea83ed86c4d40da66033e971f` |
| `analysis_digest`, **resolved conflicts** | **identical inputs to the baseline row above** — resolving a conflict never changes `analysis_digest` (only `resolution_digest`, below), since `initialExclusionStatus` is fixed at analysis creation, never the post-resolution value | `ad1:f17b48200a475c94c223b4661d4551d88db2fa6ea83ed86c4d40da66033e971f` (unchanged from the baseline row) |
| `resolution_digest`, **resolved conflicts** | one conflict, `duplicate_group_key="g1"`, `decision="select_candidate_ordinal"`, `selected_candidate_ordinal=1` | `rd1:1a1e3069b52ca794a5af895d14d7ee666489fec27960d7bbf5927fafa98db971` |
| `analysis_digest`, `fingerprint_mismatch` | `recomputed_fingerprint=fp1` | `ad1:d88f5a6c459a6eda552be3a0bfd1b77eee4b79fabebc914f023f3f27cf70f481` |
| `analysis_digest`, `validation_failed` | `recomputed_fingerprint=fp1, document_validation_code="json_parse_or_representability_failed"` (Task 4 — renamed from `"jsonb_unrepresentable_escape"`, Decision I/E.2b), `validation_detail={}` — **corrected: now includes `recomputed_fingerprint` and `validation_detail`, both omitted by the prior framing; the code name itself is also updated, changing this vector's bytes again** | `ad1:e6c0c2e14bddab2579968951b38347d197874037d75d721fa325942e35fcf8c6` |
| **Adversarial:** `analysis_digest`, **differing duplicates, conflict `details` altered** (`details::text = {"note": "altered"}` — PostgreSQL `jsonb::text`'s own rendering, with a space after the colon, not the compact `{"note":"altered"}` spelling a prior computation of this vector mistakenly hashed — instead of `{}`, everything else identical to the baseline row) — must differ from the baseline, proving `conflict_tuple` now binds `details` (Task 1.3) | same as baseline except `details::text = {"note": "altered"}` | `ad1:9e76285e2ebfc6b797ea62444ec31781c2cfe680b2530967bafa883cb0489cd1` (differs from baseline, as required) |
| **Adversarial:** `analysis_digest`, **differing duplicates, candidate A's `initialExclusionStatus` corrupted to `"selected"`** (instead of the correct `"pending"`, everything else identical to the baseline row) — must differ from the baseline, proving `candidate_tuple` binds the immutable baseline, not merely `content_digest` (Task 1.1) | same as baseline except candidate A's `initialExclusionStatus="selected"` | `ad1:25f247b7886a1fc6585a1bc6248010248074e9de38718062637ac132b6cade98` (differs from baseline, as required) |

The "identical duplicates" and "differing duplicates" rows above directly demonstrate
Decision E.11's own rule in digest form: candidates A and B produce **different**
`content_digest`s (`cdA ≠ cdB`) precisely because their `canonical_candidate` values
differ — and only a **differing**-content group ever produces a non-empty
group/conflict-type contribution to `analysis_digest`, matching Decision G.4's category
1 vs. category 2 split exactly.

`finalize_adoption` (Decision G.3) — never treating a digest match alone as proof of
**anything**, corrected to say exactly what it directly re-evaluates rather than
implying digest agreement stands in for it — must, in this order:

1. **Recompute `content_digest` directly from each candidate's own stored
   `canonical_candidate`** (Task 1.2) — `'cd1:' || encode(digest(convert_to(
   canonical_candidate::text, 'UTF8'), 'sha256'), 'hex')` — and compare it against the
   candidate's own stored `content_digest` column, **before** using that stored
   `content_digest` anywhere else in this checklist. This closes a real gap: a
   privileged-function defect (or any future code path with `UPDATE` on this table)
   could alter `canonical_candidate` while leaving a now-stale, matching-in-appearance
   `content_digest` untouched, and `analysis_digest`'s own recomputation (step 2 below)
   only re-derives `content_digest` **from the stored column**, so it would not, by
   itself, catch a `canonical_candidate`/`content_digest` pair that had drifted
   together. Any mismatch here is `integrity_failure`, checked per candidate, before
   promotion.
2. Recompute `analysis_digest` from the stored candidate/conflict rows (using each
   candidate's `content_digest` column, now proven in step 1 to match its own
   `canonical_candidate`) and compare against the stored value.
3. Recompute `resolution_digest` from the stored conflict rows (when non-`NULL`) and
   compare against the stored value.
4. **Directly re-evaluate every classification invariant finalization relies upon —
   never inferred from a digest match, which proves only that stored bytes are
   internally self-consistent, not that any particular classification rule was applied
   correctly at the time those bytes were written.** **Corrected (Task 4): the
   immediately preceding revision's re-evaluation still trusted the stored
   `duplicate_group_key` column to determine group *membership* (e.g. "a singleton" was
   defined as "`duplicate_group_key IS NULL`," not independently confirmed) — a function
   defect that assigned candidates to the wrong group (two different `entity_key`s
   sharing one group key, or one `entity_key`'s members split across two group keys)
   could still produce a self-consistent digest over an incorrectly grouped set, and
   this checklist would not have caught it, because it never derived the correct
   grouping independently to compare against.** The correction: **first derive** the
   group structure from trusted candidate properties alone — `validation_status`,
   `entity_key`, direct `jsonb` equality of `canonical_candidate`, the
   step-1-reconfirmed `content_digest`, and `candidate_ordinal` — **never** from the
   stored `duplicate_group_key`; **then verify** the stored `duplicate_group_key`/
   `adoption_conflicts` structure agrees with that independently-derived structure.
   Concretely: partition every **valid** candidate by `entity_key` (invalid candidates
   are never part of this partition at all, Decision G.1); within each `entity_key`
   partition, sub-partition by direct `jsonb` equality of `canonical_candidate` into
   content clusters. A partition with one member is a singleton; a partition with two
   or more members all in one content cluster is an identical-content group; a
   partition with two or more content clusters is a differing-content group. Require
   **all** of the following, per derived category:
   - **Invalid candidate:** `duplicate_group_key IS NULL`; `initial_exclusion_status =
     'excluded_invalid'`; current `exclusion_status = 'excluded_invalid'`; never
     referenced by any `adoption_conflicts` row (neither as a member of a
     `duplicate_group_key` a conflict row names, nor as a `selected_candidate_ordinal`).
   - **Valid singleton** (derived partition has exactly one member): `duplicate_group_key
     IS NULL`; `initial_exclusion_status = 'selected'`; current `exclusion_status`
     still `'selected'`; no `adoption_conflicts` row exists for it.
   - **Identical-content group** (derived partition, one content cluster, ≥2 members):
     all members share the one derived `entity_key`; all members store one identical,
     non-`NULL` `duplicate_group_key`; **that stored group key belongs to this derived
     partition only** — no candidate from a *different* derived `entity_key` partition
     stores the same `duplicate_group_key` value (catches the "two different entity
     keys under one group key" defect); every member is directly `jsonb`-equal to
     every other (already established by the derivation itself, re-asserted here as the
     defining property, not inferred from `content_digest` equality alone); no
     `adoption_conflicts` row exists for this group; the lowest `candidate_ordinal` is
     both `initial_exclusion_status` and current `exclusion_status = 'selected'`; every
     other member is both `initial_exclusion_status` and current `exclusion_status =
     'excluded_duplicate'`.
   - **Differing-content group** (derived partition, ≥2 content clusters): all members
     share the one derived `entity_key`; all members store **one** shared, non-`NULL`
     `duplicate_group_key` — **never two different stored group keys for members of
     the same derived `entity_key` partition** (catches the "two equal entity keys
     under different group keys" defect); every member's `initial_exclusion_status` was
     `'pending'` (proven by `analysis_digest`'s own binding of `initial_exclusion_
     status`, step 2); **exactly one** `adoption_conflicts` row exists, naming this
     group's own `duplicate_group_key`; the current `exclusion_status` of every member
     exactly matches that one row's own durable `decision` (a `select_candidate_
     ordinal` decision: the named ordinal `selected`, every other member `excluded_
     duplicate`; an `exclude_duplicate_group` decision: every member `excluded_
     duplicate`); no candidate **outside** this derived `entity_key` partition is
     referenced by this same conflict row (its composite FK to `adoption_analysis_
     candidates`, Decision E.11, already makes this structurally hard to violate, but it
     is re-checked here directly, not assumed from the FK alone).
   Any disagreement between the independently-derived structure above and the stored
   `duplicate_group_key`/`adoption_conflicts` rows, at any point, is `integrity_failure`
   — this is the check that actually detects a function defect that produced a
   self-consistent digest over an incorrectly grouped candidate set, which no digest
   comparison alone could ever catch. None of the checks above depends on any digest
   matching — each is performed directly and structurally regardless, exactly because
   a digest match alone is never treated as sufficient proof of any of them (scenario
   proof 49).

A mismatch at any of these four steps is `integrity_failure` — this should already be
structurally impossible, since no role outside the owning function has `UPDATE` on
these tables (Decision K), and is defense-in-depth, not the primary enforcement.

**First-call analysis revision behavior, defined exactly.** `analyze_adoption` does not
require an "expected" analysis revision on its **first** call for a run — there is
nothing yet to expect. It requires the run's own current `authority_revision` (Decision
H, unchanged expected-authority-revision pattern) purely as an optimistic-concurrency
guard against a stale caller, and, on success, **always** creates `analysis_revision =
1` and returns it. `finalize_adoption`/`resolve_adoption_conflicts` then require the
caller to supply that returned `1` as `expected_analysis_revision` — the "expected
revision" concept only ever applies **after** an analysis exists, never as a precondition
for creating the first one.

**`query_adoption_analysis(run_id)` and `query_adoption_conflicts(run_id)`** (Decision
H.6) are the owner-scoped, read-only RPCs that make these otherwise-`private`-schema
rows reachable to the client that must inspect and resolve them — without these, a
client has no way to ever see a conflict it is asked to resolve (the exact impossibility
the second revision's correction of the analyze/finalize split was meant to close, and
which is only fully closed once these queries exist).

#### E.12 Account deletion semantics (unchanged)

`auth.users → profiles` and `profiles → athletes` are `ON DELETE RESTRICT`; every other
FK terminating in `profiles`/`athletes` defaults to the equivalent `NO ACTION`. Deleting
an `auth.users` row is blocked until a separately designed deletion/anonymization
workflow removes or reassigns every dependent row first, in dependency order. Legal
deletion/anonymization remains a separate, required governance decision (Decision P —
corrected, Task 7).

#### E.13 Extensions and schema creation order — corrected attribution and exact signatures

`pgcrypto` provides `extensions.digest(bytea, text) returns bytea` (used by Decision B's
fingerprint function). **Corrected: `gen_random_uuid()` is not attributed to
`pgcrypto`** — since PostgreSQL 13, `gen_random_uuid()` is a native `pg_catalog`
built-in function, not an extension-provided one (`pgcrypto` also ships its own,
now-redundant copy, but this design relies on the built-in). Every column default in
this document is schema-qualified explicitly as `pg_catalog.gen_random_uuid()`
(Decision E.6/E.11's `id` columns) rather than an unqualified call that could,
depending on the executing session's own `search_path` at `CREATE TABLE` time, resolve
ambiguously between the built-in and `pgcrypto`'s copy if both happen to be reachable.
`pg_jsonschema` provides `extensions.jsonschema_is_valid(schema json) returns bool` and
`extensions.jsonb_matches_schema(schema json, instance jsonb) returns bool` — the
schema argument is `json`, not `jsonb`, in both (Appendix). All extension objects are
created in the `extensions` schema, before any table or function depending on them
(Decision E.7's Phase 1), followed immediately by the migration assertions (Decision
E.7 step 3a) proving these exact signatures resolved.

### F. The versioned protocol registry and request idempotency for `begin_adoption`

**F.1 `stage_adoption_entries(adoption_run_id, entries)` — whole-batch atomic, corrected
from per-entry.**

Precondition (`Global Lock Order`, Decision H.4, with `adoption_run_id` as the run
identifier): the run exists, belongs to `auth.uid()`, and `status = 'prepared'` —
**corrected to name the same distinct terminal-state codes `resolve_adoption_conflicts`
and `finalize_adoption` use for the identical underlying condition (Task 11's
cross-function consistency), rather than the prior revision's generic
`invalid_transition` for both terminal states alike:** `status = 'committed'` →
`already_committed`, no mutation; `status = 'aborted'` → `already_aborted`, no
mutation — the run has moved past staging entirely, and every mutating,
run-scoped function names its own run's terminal state the same way.

**`analysis_frozen = true` is a separate condition from `status`, handled as its own
retry case, not folded into the blanket `invalid_transition` above — corrected to
close the retry-after-freeze gap the prior revision left undefined.** Once
`analyze_adoption` has run (Decision G.1), `analysis_frozen = true` permanently and no
further `INSERT` into `private.adoption_staged_entries` is ever permitted for this run
— but a `stage_adoption_entries` call that arrives after freezing is still a
**meaningful, classifiable retry**, evaluated by the same whole-batch comparison as
step 2 below, never a write:

1. Step 1's shape prevalidation (registered key/position, no in-batch duplicates,
   canonical hex round-trip) still runs first, identically — a shape failure is still
   `malformed_request` regardless of `analysis_frozen`.
2. For every entry that passes step 1: the corresponding staged row is compared,
   exactly as step 2 below compares it for an unfrozen run — **byte-identical across
   every submitted entry → return `staged`, no mutation** (an idempotent, exact replay
   of an already-completed staging call, safe to report as success even though the run
   is now frozen — this is scenario proof 4's frozen counterpart); **any entry whose
   decoded content differs from its existing staged row → `staged_entry_mismatch`, no
   mutation**, identical in meaning to the unfrozen case. A submitted entry naming a
   registered `source_key` with **no** existing staged row at all is structurally
   impossible once frozen (Decision G.1's staging-completeness check guarantees a
   staged row exists for every registered key before freezing can occur) — if it
   somehow occurred, that is `internal_failure`, never silently treated as a normal
   mismatch.
3. No `INSERT`, `UPDATE`, or `DELETE` of any kind executes in this frozen-retry path —
   every outcome above is produced by `SELECT`-only comparison.

**One RPC call is one PostgreSQL transaction, and its body prevalidates the entire
batch before any `INSERT` — this paragraph and its four numbered steps describe the
`analysis_frozen = false` case only** (the frozen case is fully defined above and never
falls through to step 3's `INSERT`):

1. For every entry in the request: verify `source_key` is a registered key for this
   run's `(domain, protocol_version)` in `private.adoption_protocol_source_keys`, and
   `source_position` equals that key's registered position **exactly**. Verify no two
   entries in **this same batch** claim the same `source_key` or the same
   `source_position`. Verify the request's transport encoding (canonical hex, per
   Decision B) decodes and re-encodes identically. **Any single failure across the
   whole batch → the entire call returns `malformed_request`, no mutation at all** —
   this is a request-shape problem, checked before touching the database's staged rows.
2. For every entry that passed step 1: `SELECT` the existing staged row (if any) at
   that `source_key` for this run, and compare its `(source_position,
   source_value_is_null, source_value_utf8)` against the request's own decoded values.
   **Any entry that already exists with different content → the entire call returns
   `staged_entry_mismatch`, no mutation for the whole batch** — the original,
   already-staged bytes are never touched (scenario proof 4).
3. Only after every entry in the batch has passed both checks: `INSERT` every entry
   that does not already exist exactly as submitted (an entry that already exists with
   **identical** content is a no-op for that entry — the batch as a whole is still
   handled as one transaction, so this is "insert the missing subset," not "insert
   everything unconditionally").
4. Return `staged` with the running `stagedEntryCount` for this run — **corrected
   from `sourceEntryCount`**, which reused the immutable, registered-key-count meaning
   `begin_adoption`'s own `source_entry_count` parameter already has (Decision F.2);
   `stagedEntryCount` is the count of rows actually staged **so far**, which only
   equals the registered total once staging is complete.

**No expected duplicate-position case is ever detected by relying on the unique-constraint
exception path** — step 1's explicit, pre-insertion duplicate check is what produces
`malformed_request`; the table's `UNIQUE (adoption_run_id, source_position)` constraint
exists as a defense-in-depth backstop that should never actually fire given step 1's
own logic, and if it somehow did, that is caught by the function's `internal_failure`
handling (Decision I), never treated as if it were the expected, pre-detected case.

**F.2 The protocol registry — unchanged role, corrected shape (Decision E.2/E.2a).**
`begin_adoption` checks, before anything else: a `private.adoption_protocols` row
exists for the requested `(domain, protocol_version)` with `activation_status IN
('pilot', 'production')` and `backfilled_at IS NOT NULL` (else `domain_not_eligible` or
`domain_backfill_incomplete` respectively); `source_entry_count` in the request equals
`(select count(*) from private.adoption_protocol_source_keys where domain = ... and
protocol_version = ...)` exactly (else `malformed_request` — the client's own claimed
count doesn't match the registered contract, checked before any row is created).

### G. The analyze/conflict/finalize lifecycle

**G.1 `analyze_adoption(adoption_run_id, expected_authority_revision)`**

- `Global Lock Order` (Decision H.4). **If an `adoption_analyses` row already exists
  for this run, this call is a pure **read** of the existing row (plus its
  candidates/conflicts), regardless of the run's current `status`** — it never
  re-parses, re-persists, or creates a second `analysis_revision` for the same staged
  data (scenario proofs 6/8); a run that has since committed still has its original,
  frozen analysis row (`finalize_adoption` step 2 structurally requires one to exist
  before it can ever commit, Decision G.3), so re-reading it here is harmless and
  correct — a `committed` run can never reach the "no analysis row exists" branch
  below at all. **Corrected — the case this precondition previously left undefined: if
  no `adoption_analyses` row exists yet**, `status` must be `'prepared'` — `status =
  'aborted'` (reachable, since `abort_adoption` never requires an analysis to exist
  first) → `already_aborted`; only a `prepared` run with no existing analysis proceeds
  to the staging-completeness check below and actually creates one.
- **Staging-completeness check — required before the fingerprint is ever recomputed,
  corrected to be the primary enforcement point (not merely the fingerprint function's
  own defensive backstop):**
  1. `(select count(*) from private.adoption_staged_entries where adoption_run_id =
     ...)` equals `(select count(*) from private.adoption_protocol_source_keys where
     domain = ... and protocol_version = ...)`.
  2. Every registered `source_key` has exactly one staged row — implied by (1) together
     with `adoption_staged_entries`'s own `UNIQUE (adoption_run_id, source_key)` and
     Decision F.1's guarantee that only a registered key can ever be staged: if the
     counts match and no staged row can be for an unregistered key, the staged set and
     the registered set must be in exact bijection.
  3. `adoption_runs.source_entry_count` equals both counts from (1).
  4. **Any mismatch → `staging_incomplete`. No `adoption_analyses` row is persisted, no
     mutation of any kind occurs, and `private.fingerprint_domain_snapshot` is never
     called** — this is the check that actually prevents an incomplete run from
     reaching the fingerprint function at all; the function's own internal
     `visited_count <> registered_count` guard (Decision B) is a second, independent
     proof of the same invariant, reachable only if this check were somehow bypassed.
- Only once staging is proven complete: recompute
  `private.fingerprint_domain_snapshot(adoption_run_id)` (Decision B) and compare
  against `adoption_runs.source_fingerprint`. A mismatch persists `status =
  'fingerprint_mismatch'` and stops here — no parsing, no candidates.
- Parse the staged bytes as the domain's source document, validate against
  `source_document_schema` (Decision I). A failure persists `status =
  'validation_failed'` and stops — no candidates.
- Extract entities (for `assessment`/`assessmentHistory`: `history`, never `currentRun`
  — Decision D); validate each against `canonical_entity_schema` plus cross-field rules
  (Decision I), producing one `adoption_analysis_candidates` row per entity
  (`validation_status`, `content_digest`, `canonical_candidate`).
- Group valid candidates by `entity_key`; resolve identical-content groups
  automatically; assign `duplicate_group_key` and create one `adoption_conflicts` row
  per differing-content group.
- Compute `analysis_digest`; persist the `adoption_analyses` row
  (`analysis_revision = 1`), every candidate row, and every conflict row, **and** set
  `adoption_runs.analysis_frozen = true` — **all in one transaction**. A crash anywhere
  in this sequence leaves **none** of it durable (scenario proof 6/12); a retried call
  starts over from scratch, safely, since nothing partial was recorded.
- Return the resulting `status` (`fingerprint_mismatch` / `validation_failed` /
  `conflicts_present` / `ready`) and `analysis_revision`.

**G.2 `resolve_adoption_conflicts(adoption_run_id, analysis_revision, resolutions)`**

- `Global Lock Order`. **New, checked first, immediately after the run row is locked —
  the prior revision never checked the run's own `status` at all, only the analysis's
  status, which left a real gap: `abort_adoption` never touches `adoption_analyses`, so
  an aborted run's analysis could still show `conflicts_present`/`ready`, and this
  function would have silently accepted a decision-mutating call against a run that is
  no longer `prepared` at all.** `adoption_runs.status` must be `'prepared'`:
  `status = 'committed'` → `already_committed`, no mutation; `status = 'aborted'` →
  `already_aborted`, no mutation. **Only a `prepared` run proceeds to the checks
  below** — mutating conflict decisions is never permitted once a run has left
  `prepared`, regardless of what `adoption_analyses.status` happens to still show.
- Precondition: an `adoption_analyses` row exists at the given `analysis_revision`
  (else `revision_mismatch`).
- **`status = 'ready'` is a retry case, compared before being rejected — corrected
  again, to require an exact, complete match, never a vacuous partial one.** The
  immediately preceding revision's fix compared only the *submitted* entries against
  their own durable decisions — which meant an **empty** `resolutions: []` array, or
  any **strict subset** of the true conflict set, would trivially satisfy "every
  submitted resolution matches" (there is nothing to disagree with) and falsely return
  `resolved` without the caller having confirmed anything about the conflicts it left
  out. **Corrected: `status = 'ready'` retry requires all of the following, checked
  together, before any resolution is accepted as a match:**
  1. The submitted `resolutions` count **exactly equals** the durable count of
     `adoption_conflicts` rows for this analysis.
  2. The **set** of submitted `duplicateGroupKey` values **exactly equals** the set of
     durable `duplicate_group_key` values for this analysis — no submitted key naming a
     conflict outside this analysis (an **unknown** conflict — `malformed_request`,
     the same code the ordinary path below uses for this identical shape problem, since
     the request itself is invalid, not merely disagreeing with a decision), and no
     durable conflict **absent** from the submission (a **missing** conflict — the
     retry cannot vacuously succeed by silently omitting some conflicts, so this is
     `conflict_already_resolved`: the call did not actually reconfirm the complete
     decision set, which is the same underlying fact `conflict_already_resolved`
     already names elsewhere in this function).
  3. **Exactly one** submitted resolution per conflict — already structurally
     guaranteed by this RPC's own input shape (Decision M: "no two elements may share
     `duplicateGroupKey`"), re-verified here as defense-in-depth.
  4. Every submitted `decision`/`selectedCandidateOrdinal` is **byte-for-byte identical**
     to its corresponding durable `decision`/`selected_candidate_ordinal`.
  **All four hold → return `resolved`, no mutation** (a genuine, complete, exact replay
  of an already-fully-resolved analysis — the `ready`-state counterpart of Decision
  F.1's frozen-retry pattern). **Any single failure among the four →
  `conflict_already_resolved`** (count/membership/content all describe the same
  underlying fact: the submitted set does not, in full, match what is already
  durably decided) **— except an unknown conflict specifically, which is
  `malformed_request`** (point 2 above), consistent with the ordinary path's own
  treatment of a `duplicateGroupKey` that names no real conflict for this analysis at
  all. No mutation occurs in either outcome.
- **`status IN ('fingerprint_mismatch', 'validation_failed')`** — no `adoption_conflicts`
  rows were ever created for this analysis (Decision G.1: both statuses stop before
  candidate/conflict extraction) — `invalid_transition`, unchanged: there is nothing to
  resolve and nothing durable to compare against, a genuinely different case from the
  `ready` retry above.
- **`status = 'conflicts_present'`** — the ordinary path, below.
- **Prevalidates the complete requested resolution set before any write:** every
  `resolutions` entry names a real, undecided-or-identically-decided
  `duplicate_group_key` for this exact analysis; a `select_candidate_ordinal` names an
  ordinal that structurally belongs to that group (the composite FK, Decision E.11,
  proves this at write time, but the function checks it first too, to report a clean
  `malformed_request` rather than an FK-violation `internal_failure`). **Any
  resolution whose target conflict is already decided with a *different* value → the
  entire call returns `conflict_already_resolved`, no mutation for the whole batch.**
  Re-submitting the **same** decision for an already-decided conflict is an idempotent
  no-op for that entry.
- Only after the complete batch validates: write every decision atomically, in one
  transaction.
- `adoption_conflicts`/`adoption_analysis_candidates`/`adoption_runs.source_fingerprint`
  are never touched by this function — only `decision`/`selected_candidate_ordinal` and
  each candidate's own `exclusion_status` (set to `selected`/`excluded_duplicate`
  according to the decision) change.
- If every conflict for this analysis is now decided, this call also updates
  `adoption_analyses.status` from `conflicts_present` to `ready`, in the same
  transaction as the last decision that completes the set.

**G.3 `finalize_adoption(adoption_run_id, expected_analysis_revision)`**

Every one of the following is required, checked **before any canonical write**:

1. Run `status = 'prepared'` (else `already_committed`/`already_aborted`).
2. An `adoption_analyses` row exists with `analysis_revision =
   expected_analysis_revision` (else `revision_mismatch`).
3. `adoption_analyses.status = 'ready'` — else a **distinctly named** failure, never the
   bare analysis-status label (Decision L's namespace separation): `conflicts_unresolved`
   if `conflicts_present`; **`analysis_validation_failed`** if `validation_failed`;
   **`analysis_fingerprint_mismatch`** if `fingerprint_mismatch`. Finalize cannot
   proceed from any of those three.
4. Every `adoption_conflicts` row for this analysis has a non-`NULL` `decision`
   (structurally implied by `status = 'ready'`, re-checked anyway as defense-in-depth).
5. Recompute `analysis_digest` and (when non-`NULL`) `resolution_digest` from the
   stored candidate/conflict rows and compare against the stored values; **directly,
   structurally** verify every candidate's `exclusion_status` agrees with its
   conflict's own `decision` (Decision E.11's exact rule) — never treating a digest
   match alone as sufficient (scenario proof 49). Any disagreement is `integrity_failure`.
6. **Protocol retirement never blocks this step** (Decision E.2's explicit rule) —
   finalize does not re-check `activation_status` at all.
7. Only now: promote. For every candidate with `exclusion_status = 'selected'` (the
   auto-selected winner of an identical group, the not-in-any-group singleton, or the
   `resolve_adoption_conflicts`-chosen winner of a differing-content group) **and**
   `validation_status = 'valid'`: attempt canonical insertion (Decision H.5's
   compare-then-classify collision handling). **A single unresolvable canonical
   collision, or any unexpected error, rolls back every promotion attempted so far in
   this same transaction** (Decision I's exception-subtransaction rule) — never a
   partial commit.
8. On full success, in the same transaction: `adoption_runs.status = 'committed'`,
   `committed_at = now()`, `promoted_entity_count` set to the number of rows actually
   inserted; `account_domain_authorities` set to `cloud_authoritative` with this run's
   `id` and `authority_revision + 1`.
9. **The client must still independently re-query `query_account_domain_authority`/
   `query_adoption_run` after this call returns** (unchanged from the prior revision's
   own careful phrasing — this document's own paraphrase of ADR-0019's step-7 framing,
   not a verbatim ADR-0019 sentence).
10. A second `finalize_adoption` call after success finds `status <> 'prepared'` at
    step 1 and returns `already_committed` immediately — no re-entry into analysis or
    promotion (scenario proof 8).

**G.4 Conflict categories (generalized beyond two candidates, per Decision E.11):**

1. **Exact duplicate — identical `content_digest` across the whole group.** Silently
   auto-selected; no conflict row.
2. **Differing content within one duplicate group (two or more members).** The one
   user-resolvable category; resolutions `select_candidate_ordinal` /
   `exclude_duplicate_group`.
3. **A pre-existing canonical row that is this same run's own idempotent result**
   (`adoption_run_id` matches, content matches exactly) — a safe no-op at promotion
   time, never a conflict row.
4. **A pre-existing canonical row with different owner, provenance, or content** —
   since `begin_adoption` requires the registry to be non-cloud-authoritative before a
   new run starts, this is an invariant violation, not an ordinary conflict:
   `integrity_failure`, the whole finalize call fails, never resolved by
   `resolve_adoption_conflicts`.
5. **Impossible registry/canonical inconsistency** — same treatment as category 4.

### H. Concurrency-correct idempotency and locking

**H.1 `begin_adoption(domain, protocol_version, source_entry_count, source_fingerprint, client_request_id)`
— corrected for concurrent, not just sequential, retries.**

**The defect, stated precisely — corrected a second time.** A pre-lock idempotency
lookup alone (the second revision's whole mechanism) correctly handles a **sequential**
retry — one call completes, then a second, later call with the same token arrives. It
does **not** handle **two concurrent first calls** using the identical token: both
could observe "no existing row" in their own pre-lock lookup before either has
committed, and both then proceed to attempt an insert — one would succeed, the other
would fail the unique constraint and be misclassified as `adoption_in_progress` rather
than recognized as the identical, legitimate retry it actually is. **The immediately
preceding revision's fix still had a gap**: it acquired the authority lock only "if no
row is found" by the fast pre-lock lookup — so a call whose fast lookup **did** find an
existing row (the common sequential-retry case) returned a decision straight from that
**unlocked** read, with no synchronization at all against a concurrent
`finalize_adoption`/`abort_adoption` call that might be mid-commit against that exact
run at that exact instant. A retry could therefore read a not-yet-committed-elsewhere
`prepared` status and return `prepared`, moments before (or after, depending on
transaction ordering) the concurrent call's own commit made that answer stale.

**The corrected pattern, stated at its actual scope — narrowed (this pass) from an
earlier, overbroad "every call locks *something* before any decision is returned"
phrasing that did not account for the calls this locking logic never reaches in the
first place.** Authentication rejection (`unauthenticated`, Decision L) and
request-shape validation failure (`malformed_request`, Decision L, checked against the
RPC's own parameters before anything below is even attempted) are intentionally
**outside** this locking statement — a call that fails either of those returns before
step 2 below ever runs, exactly as any other `authenticated`-gated RPC does, and
neither of those responses depends on, or claims anything about, an authority row. The
statement below governs only what happens **after** authentication and request-shape
validation both succeed, i.e. every call that reaches authority/run-state
classification: every such call locks *something* (the authority row if present, the
shared global lock if not) before any authority/run-state or missing-row-diagnosis
decision is returned; no such decision is ever produced from an unlocked read:

1. **Fast pre-lock lookup** (a pure optimization — its result is diagnostic only and is
   **never** returned to the caller directly, precisely because it comes from no lock at
   all): `SELECT` any existing row matching `(account_scope_id, domain,
   client_request_id)`, no lock. An implementation MAY skip this step entirely with no
   change in correctness — it exists only as a hint some implementations may use to
   decide connection/retry strategy, never as a source of the actual response.
2. **Attempt to lock the `account_domain_authorities` row `FOR UPDATE` by
   `(auth.uid(), domain)`.** `SELECT ... FOR UPDATE` against a pair with no matching
   row simply returns zero rows — there is nothing to lock, and nothing about that
   outcome is an error at this step.
   - **Row found:** this is the **ordinary row-present path** — proceed directly to
     step 3, holding only this row's own lock. No global lock is acquired on this path
     at all.
   - **Row not found:** **corrected a third time (Task 2) — a real race remained even
     after Task 3.2's own fix.** The immediately preceding revision classified a
     missing row immediately, via a multi-statement diagnosis (profile check, then
     protocol/backfill check) with **no lock at all** connecting it to
     `bootstrap_account`/`backfill_domain_authority`. A concrete counterexample: this
     call observes no row; a concurrent `backfill_domain_authority` commits the
     authority row and `backfilled_at` between this call's first observation and its
     own later diagnosis reads; this call's diagnosis, reasoning from its now-stale
     first observation, could return `integrity_failure` for a row that, by the time
     the diagnosis actually runs, already exists. **Corrected:** on a missing row,
     this call next acquires the **same global `bootstrap_backfill_serialization`
     advisory lock** `bootstrap_account`/`backfill_domain_authority` both acquire
     (Decision H.8) — `pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(
     'bootstrap_backfill_serialization'))` — and, **only once holding it**, re-attempts
     `SELECT ... FOR UPDATE` on the exact same row:
     - **The row now exists** (a concurrent `bootstrap_account`/`backfill_domain_
       authority` call committed it while this call was waiting for the fast pre-lock
       lookup/first attempt above): this call now holds both the global lock and the
       row's own lock — proceed to step 3 exactly as the ordinary row-present path
       does; the extra, still-held global lock changes nothing about step 3 onward.
     - **The row is still absent:** because this call now holds the global lock, and
       `bootstrap_account`/`backfill_domain_authority` **both** acquire that identical
       lock before either reads or writes anything relevant (Decision H.8), no such
       call can be concurrently mid-flight right now — any attempt is blocked until
       this transaction commits or rolls back. **Corrected (this pass): "the exact
       same total decision tree Decision H.6b already defines" was ambiguous about
       *how* that tree is evaluated — replaced with a normative requirement, not a
       description.** This call MUST execute H.6b's own single-statement CTE
       (Decision H.6b, reproduced there in full) — the identical query, not a
       re-derivation of its logic via separate reads — which fetches, in one
       statement, one MVCC snapshot:
       - `profile_exists` — whether a `public.profiles` row exists for this account;
       - `authority_row` — the account/domain `private.account_domain_authorities` row,
         if any;
       - `eligible_exists` — whether an eligible (`pilot`/`production`) protocol exists
         for this domain;
       - `backfilled_at` — that protocol's own backfill-completion timestamp, if any.
       Classification below is decided **only** from these four values as returned by
       that one statement — this call MUST NOT issue separate `profile`/`protocol`/
       `backfill` `SELECT`s of its own to re-derive them:
       - **`profile_exists = false`** → `account_not_bootstrapped`.
       - **`authority_row IS NULL`, `eligible_exists = false`** → `domain_not_eligible`.
       - **`authority_row IS NULL`, `eligible_exists = true`, `backfilled_at IS NULL`**
         → `domain_backfill_incomplete`.
       - **`authority_row IS NULL`, `eligible_exists = true`, `backfilled_at IS NOT
         NULL`** — a genuine data-integrity problem (Decision K.6/H.8's completeness
         proof should make this structurally impossible) → `integrity_failure`, never
         `internal_failure` and never `domain_backfill_incomplete`.
       **What each mechanism actually contributes, stated separately, never
       conflated:** holding the global lock is what serializes this call against
       concurrent `bootstrap_account`/`backfill_domain_authority` activity (Decision
       H.8) — it is the reason no such call can be mid-flight right now. The
       single-statement CTE's own one-snapshot MVCC read is a separate property,
       independent of that lock, that prevents a **mixed-time** observation across
       the four values above — including against activity from functions that never
       acquire this global lock at all (e.g. `register_adoption_protocol`/
       `transition_adoption_protocol_status`, which use their own, separate,
       domain-scoped locks, Decision K.6) — a role this global lock alone could not
       fill, since it only ever synchronizes against the two functions that acquire
       it.
       - **A genuinely impossible disagreement, named explicitly, not left
         unhandled:** if this CTE's own `authority_row` comes back **non-NULL** —
         directly contradicting the `SELECT ... FOR UPDATE` re-attempt immediately
         above, which, under this same held global lock, just found no row — this
         call MUST NOT continue as though the row were still absent (silently
         reusing a classification derived above would be reasoning from a
         self-contradictory pair of reads). This exact disagreement should be
         unreachable under ordinary operation (both reads happen back-to-back while
         this call alone holds the only lock `bootstrap_account`/`backfill_domain_
         authority` ever acquire before writing this row) — reaching it anyway
         indicates a write from outside those two serialized paths (a privileged
         manual mutation, or a defect). This call returns `internal_failure`
         immediately in this case — never re-classifying from the CTE's
         contradictory `authority_row` value, and never retrying the row-lock step
         in a loop that a persistent anomaly could spin forever.
   **"Every call acquires the row lock" (an earlier revision's phrasing) is corrected
   to: every call that reaches a valid, row-present adoption decision acquires the
   row's own lock before deciding; a call whose row is genuinely absent acquires the
   global lock first, re-confirms the row is still absent under it, and only then
   classifies why — it never reaches an `INSERT` or any of steps 3-5 either way.**
   **Lock order, stated exactly, so no inverse order can ever arise:** the
   row-present path acquires only the authority row's own lock; the missing-row path
   acquires the global lock **before** its own (second) attempt at the row's lock, in
   that order, never the reverse. `bootstrap_account`/`backfill_domain_authority`
   never acquire the authority row's own `FOR UPDATE` lock at all (Decision H.8: they
   act via a set-based `INSERT ... SELECT ... ON CONFLICT DO NOTHING`, never an
   explicit row lock against an already-existing row) — so neither of them ever holds
   the row lock while waiting for the global lock, the one ordering that could invert
   against `begin_adoption`'s own missing-row path and deadlock. No inverse lock order
   exists between any of these functions.
3. **While holding that lock, perform the authoritative idempotency lookup** — the
   **only** read this function's decision is ever based on: `SELECT` any existing row
   matching `(account_scope_id, domain, client_request_id)`, now under the lock. A
   concurrent `finalize_adoption`/`abort_adoption` call against this same run must
   itself hold this same authority-row lock before committing its own transition
   (Global Lock Order, Decision H.4 locks the run only after the authority row, in the
   same fixed order every mutating function uses) — so by the time this call acquires
   the authority lock at step 2, any such concurrent transition has either already fully
   committed (and is now visible here) or is blocked waiting for this call's own
   transaction to release the lock first. **There is no interleaving in which this
   step's read can observe a `status` value that a concurrent commit is simultaneously
   in the process of changing** — the lock makes the two mutually exclusive.
4. **If the row exists (found at step 3, under the lock):** first, exact-match on
   `(protocol_version, source_entry_count, source_fingerprint)` — a mismatch on any of
   these three fields → `idempotency_mismatch` immediately (scenario proof 22 — same
   token, different input), regardless of the existing run's own `status`, since a
   mismatched immutable-input retry is never a legitimate replay of anything. **Only
   once the three fields match exactly does the existing run's current `status` decide
   the result:**
   - `status = 'prepared'` → return `prepared` (this is scenario proof 21 — two
     concurrent calls, same token, same input — both resolve to the same single row,
     deterministically, because the second to acquire the lock always re-observes the
     first's already-committed result before doing anything else).
   - `status = 'committed'` → return `already_committed` — **never** `prepared`; the
     run this token created has since been finalized by a separate `finalize_adoption`
     call, and a `begin_adoption` retry must reflect that, not silently claim the run
     is still in progress. Because step 3's read happens **under the same lock**
     `finalize_adoption` itself must hold to commit (point 3 above), this is never a
     stale read racing an in-flight commit — either the commit is already fully visible,
     or it has not started yet and this call proceeds against the still-genuinely-
     `prepared` row.
   - `status = 'aborted'` → return `already_aborted` — **never** `prepared`; the run
     this token created has since been aborted (via `abort_adoption`, or superseded via
     `abort_and_replace_adoption`, in which case `superseded_by_run_id` is also set and
     the response includes it so the caller can follow the chain to the replacement,
     Decision H.2/H.3) — again never silently reported as still `prepared`, and never a
     stale read, for the same lock-ordering reason as `committed` above.
5. **Only if the run row still does not exist (at step 3, under the lock) — the
   authority row itself is already proven to exist and already locked, by step 2's own
   corrected branch above:** verify the protocol is `pilot`/`production` and
   backfilled, verify the now-locked authority row's own `authority_status IN
   ('not_initialized', 'aborted')` and no live `prepared` run exists, then `INSERT`.

**Corrected: the closing claim of an earlier revision — "step 2's lock is acquired
unconditionally, by every call" — was false for an absent row (and, this pass,
narrowed further: "every call" itself overreached, since a call rejected for
authentication or request-shape failure never reaches step 2 at all) — replaced with
the exact statement above.** Restricting the claim to every call that has already
passed authentication and request-shape validation and thus reaches authority/run-state
classification: for every such call whose row is present (the common case once an
account/domain pair is actually adoption-eligible), that row's own lock **is** acquired
unconditionally, before step 3's read and before any call reaches step 5's `INSERT`, so
two concurrent identical requests can never both reach `INSERT`, and no
authority/run-state decision is ever returned that was not read under this same lock a
concurrent `finalize_adoption`/`abort_adoption` must also hold before mutating the run
it describes. For every such call whose row is genuinely absent, the global lock
(above) provides the identical guarantee against `bootstrap_account`/`backfill_domain_
authority`, before that call's own H.6b one-statement CTE diagnosis ever runs. **An
identical concurrent
request never becomes `adoption_in_progress`; no request that reaches classification
ever returns a `prepared` result that a simultaneous commit has already invalidated or
is in the process of invalidating; and no such request ever returns `integrity_failure`
(or any other missing-row diagnosis) from an observation a concurrent bootstrap/backfill
commit has already made stale.**

**H.2 `abort_and_replace_adoption` — an executable statement order, not merely an
atomic-transaction claim.**

**The defect, stated precisely.** Inserting the replacement row before aborting the
stale `prepared` run would violate the partial unique index (two `prepared` rows for
the same pair); setting the stale run's `superseded_by_run_id` to the replacement's `id`
before the replacement row exists would violate the self-referential foreign key
(Decision E.6). The prior revision asserted atomicity without specifying an order that
actually satisfies both constraints along the way.

**The exact order, all inside one transaction (Decision H.4's Global Lock Order applied
first, with the stale run as the target):**

1. Lock the authority row, then the stale run row (Global Lock Order).
2. Validate the complete replacement request and idempotency state (Decision H.3
   below) — return early, no mutation, if this is an idempotent replay or a mismatch.
3. `UPDATE private.adoption_runs SET status = 'aborted', aborted_at = now(),
   abort_reason = 'superseded_by_replacement' WHERE id = stale_run_id` —
   **`superseded_by_run_id` stays `NULL` at this step.** The stale row no longer
   occupies the partial `prepared` unique index.
4. `INSERT` the new `prepared` replacement row — now valid, since no `prepared` row for
   this pair exists at this instant within the transaction.
5. `UPDATE private.adoption_runs SET superseded_by_run_id = <replacement id> WHERE id =
   stale_run_id` — now valid, since the replacement row exists.
6. Update the authority row to reference the replacement (`adoption_prepared`, new
   run's `id`, `authority_revision + 1`).
7. Commit. Because every step above is inside one transaction, a crash **at any
   point** before commit rolls the entire sequence back — the stale run is never
   observably `aborted` without a successor, nor `prepared` with a dangling successor
   reference, at any point any other transaction could observe it (scenario proof 32).

**H.3 `abort_and_replace_adoption` idempotency — the replacement request identity, made
concrete.** On the original call, the replacement row itself stores
`(protocol_version, source_entry_count, source_fingerprint, client_request_id)` as
ordinary columns (Decision E.6). A retry: reads the stale run; if `status = 'aborted'`
and `superseded_by_run_id` is set, fetches the replacement and compares all four fields.
Exact match → return the existing replacement. Same `client_request_id`, any other
field different → `idempotency_mismatch`. A different `client_request_id` entirely is
not a retry of this operation — it is a fresh attempt against an already-`aborted` stale
run, failing its own precondition and returning `already_aborted`.

**H.4 The Global Lock Order — specified once, used by every mutating, run-scoped
function (`stage_adoption_entries`, `analyze_adoption`, `resolve_adoption_conflicts`,
`finalize_adoption`, `abort_adoption`, `abort_and_replace_adoption`).** Read-only
functions (Decision H.6) use only steps 1-2, never acquire a lock.

1. **Non-locking lookup:** `SELECT account_scope_id, domain FROM
   private.adoption_runs WHERE id = $run_id` — ordinary MVCC read, no lock.
2. **Non-leaking ownership check:** no row, or `account_scope_id <> auth.uid()` →
   `not_found` either way.
3. **Lock the authority row first,** using `(account_scope_id, domain)` from step 1.
4. **Then lock the run row** by `id`.
5. **Re-verify** the now-locked run's `account_scope_id`/`domain` still equal step 1's
   lookup (both immutable columns; a mismatch is `internal_failure`, structurally
   should never occur).
6. Proceed with the function's own logic, both locks held, in this fixed order —
   identical across every function, which is what prevents a deadlock between any two
   of them racing for the same pair of rows (scenario proof 10).

**H.5 Canonical collisions — the exact comparison, expanded to every deterministic
field, excluding server-generated timestamps.**

At promotion (Decision G.3 step 7), on an `(account_scope_id, assessment_run_id)`
collision: `SELECT` the existing row and compare, field by field: `account_scope_id`,
`domain`, `athlete_id`, `adoption_run_id`, `source_contract_version`,
`canonical_mapping_version`, `template_id`, `template_version`, `status`,
`entity_schema_version`, `created_at_source`, `completed_at_source`, `payload`. **The
comparison uses `created_at_source`/`completed_at_source` (the verbatim source
strings, Decision I's "Timestamp fidelity"), never the parsed `created_at`/
`completed_at` `timestamptz` companions** — two source strings that normalize to the
same instant but differ lexically (e.g. differing fractional-second digit counts) are
a genuine content difference this comparison must catch, which comparing only the
parsed instant would silently miss. **Never compare `canonicalized_at`** — it is this
row's own server-generated insertion timestamp, not a deterministic fact about the
source data, and would make an otherwise-identical retry falsely appear to differ.
Exact match on every compared field, and the existing row's
own `adoption_run_id` equals the current run's `id` → Decision G.4 category 3, treat as
success. Any mismatch, on any field → category 4/5, `integrity_failure`, the entire
`finalize_adoption` transaction aborts (scenario proof 9/34).

**H.6 Query RPCs are reads; they never acquire `FOR UPDATE`. Their lookup algorithm
splits into two genuinely different shapes, corrected to stop conflating them.**

**H.6a Run-scoped reads** (`query_adoption_run`, `query_adoption_analysis`,
`query_adoption_conflicts`) each take an `adoption_run_id` and use exactly Global Lock
Order steps 1-2 (Decision H.4: non-locking lookup of `account_scope_id`/`domain` by
`id`, then the non-leaking ownership check collapsing "no such row" and "someone
else's row" into one `not_found`), then an ordinary `SELECT` of the requested rows
under ordinary MVCC snapshot semantics — no lock taken.

**H.6b `query_account_domain_authority(domain)` has no run ID at all, and therefore
cannot use Global Lock Order steps 1-2 as written — the prior revision's claim that it
did was wrong** (steps 1-2 look up `account_scope_id`/`domain` from an
`adoption_runs` row by `id`; this function is never given a run ID to look up). It also
previously collapsed four genuinely different "no row" causes into one code, and —
**corrected a second time (Task 3.1) — previously checked protocol eligibility before
checking whether an authority row already exists, so a domain retired after reaching
`cloud_authoritative` would falsely report `domain_not_eligible` for an account that
already holds valid, granted authority.** Corrected below into a **total, six-branch
decision tree**, with the authority-row read moved ahead of every eligibility check,
each branch distinguished because its remedy differs:

1. **Unauthenticated.** `auth.uid()` is `NULL` → `unauthenticated`, checked first,
   before any query (Decision L.3, every `authenticated`-callable function).
2. **Corrected a third time (Task 3): the remaining four checks are one single SQL
   statement, evaluated under one MVCC snapshot, not four sequential `SELECT`s.** The
   prior revision's own sequential design still admitted a race: a `SELECT` finding no
   authority row, followed moments later by a **separate** `SELECT` against
   `private.adoption_protocols`, could observe a concurrent `backfill_domain_
   authority` commit landing in between — the row still absent at the first read, but
   `backfilled_at` already set by the second, producing a **transient, false**
   `integrity_failure` from a mixed-time observation that was never true at any single
   instant. PostgreSQL takes a fresh snapshot per **statement**, not per sub-query
   within one statement — so combining every read into one statement's CTEs closes
   this regardless of concurrent activity:
   ```sql
   with
     profile as (
       -- Profile existence is resolved through the account/Profile link table, never
       -- by `profiles.id = auth.uid()` — `Profile.id` is its own stable UUID, linked
       -- 1:1 to the authenticated account via `account_profile_links` (docs/adr/0022
       -- Decision 1). `private.current_profile_id()` is the narrow helper that
       -- performs exactly this lookup elsewhere in the schema; inlined here since
       -- this CTE's whole point is one single statement/snapshot.
       select 1 from public.account_profile_links where account_id = auth.uid()
     ),
     authority as (
       select * from private.account_domain_authorities
       where account_scope_id = auth.uid() and domain = $domain
     ),
     eligible_protocol as (
       select backfilled_at from private.adoption_protocols
       where domain = $domain and activation_status in ('pilot', 'production')
       limit 1
     )
   select
     exists(select 1 from profile) as profile_exists,
     (select row_to_json(authority.*) from authority) as authority_row,
     exists(select 1 from eligible_protocol) as eligible_exists,
     (select backfilled_at from eligible_protocol) as backfilled_at;
   ```
   Every value this function's classification depends on — profile existence, the
   authority row (if any), protocol eligibility, and `backfilled_at` — comes from this
   **one** query execution, and the function's own branching below is pure in-memory
   logic over those four already-fetched values, never a further table read:
   - **`profile_exists = false`** → this account was never bootstrapped at all, a
     condition with a different remedy (call `bootstrap_account()`) than "the domain
     isn't ready yet" — returns `account_not_bootstrapped` (Decision L.3), never
     `domain_backfill_incomplete`.
   - **`authority_row IS NOT NULL`** → return it immediately, regardless of the
     domain's current protocol `activation_status`. Retirement (Decision E.2) blocks
     only **new** `begin_adoption` calls; it never revokes, hides, or reclassifies
     authority an account already holds. A `cloud_authoritative` or `adoption_prepared`
     row for a domain whose protocol has since been `retired` is still returned as
     exactly that — never reinterpreted as `domain_not_eligible` because the *current*
     protocol row no longer shows `pilot`/`production`. Ownership is never "looked up
     then compared" — it is built into the CTE's own `WHERE` clause, so there is no
     "wrong owner" case to misclassify.
   - **`authority_row IS NULL` and `eligible_exists = false`** → `domain_not_eligible`
     — the **same** code `begin_adoption` already produces for this identical
     underlying fact (Decision L.3). (A domain that **was** eligible and has since been
     fully retired, with no account ever having reached authority for it, correctly
     reports this same code — there is no authority to protect in that case.)
   - **`authority_row IS NULL`, `eligible_exists = true`, `backfilled_at IS NULL`** →
     `domain_backfill_incomplete` — again the same code `begin_adoption` already uses.
   - **`authority_row IS NULL`, `eligible_exists = true`, `backfilled_at IS NOT NULL`**
     — this should be structurally impossible (`backfill_domain_authority`'s own
     completeness proof, Decision K.6, guarantees a row for every `profiles` row that
     existed when it completed, and every profile created since is covered
     independently by `bootstrap_account`'s now-shared-lock-serialized insert, Decision
     H.8) — a genuine data-integrity problem, never silently folded into "backfill
     incomplete": returns `integrity_failure` (Decision L.3's existing
     "structurally-should-be-impossible," always-manual-review code), not
     `internal_failure` (which would wrongly suggest an ordinary unexpected exception
     rather than a named invariant violation) and not `domain_backfill_incomplete`
     (which would wrongly suggest waiting is a valid remedy — it is not). **Because
     every value above was read in the same statement's snapshot, this outcome cannot
     be a transient artifact of a concurrent `backfill_domain_authority` commit landing
     mid-diagnosis — if this is reported, the row was genuinely absent at the single
     instant the whole snapshot was taken.**

No lock of any kind is acquired — this function never writes, and the single-statement
design above needs no lock to be race-free: it is not racing against anything, since it
never straddles a statement boundary a concurrent commit could land inside.

**H.7 Revision overflow.** `authority_revision` (`bigint`) raises a PostgreSQL exception
on increment past its maximum value rather than silently wrapping — standard PostgreSQL
integer-overflow behavior, caught by Decision I's exception handling and reported as
`internal_failure`; practically unreachable (~9.2×10¹⁸ transitions on one pair).

### I. Database-contained validation — the exact boundary, four distinct versions, reconstruction rule

**Decision (unchanged): every validating, canonical-promoting, authority-transitioning
operation is one PL/pgSQL `SECURITY DEFINER` function, one PostgreSQL transaction. An
Edge Function may authenticate and shape a request; it is never the sole validator for
data whose canonical promotion happens in the database**, and this ADR does not claim an
Edge Function and the PostgreSQL writes it triggers share one transaction (Appendix:
Edge Functions "treat Postgres like a remote, pooled service").

**Validation mechanism — exact signature.** `source_document_schema` and
`canonical_entity_schema` (Decision E.2) are each validated via
`extensions.jsonb_matches_schema(source_document_schema::json, instance)` /
`extensions.jsonb_matches_schema(canonical_entity_schema::json, instance)` — the
schema argument cast to `json` explicitly at every call site, matching
`jsonb_matches_schema(schema json, instance jsonb) returns bool`'s actual registered
signature (Decision E.13, Appendix), never passed as an uncast `jsonb` value. Structural
failure of the whole document → `validation_failed` at the analysis level (`status =
'validation_failed'`, Decision G.1) — which now also covers the `jsonb`-representability
failure mode named in Decision E.2b (`document_validation_code =
'json_parse_or_representability_failed'`, Task 4), reached before `jsonb_matches_schema`
can even be called, since that failure occurs at the earlier text-to-`jsonb` conversion
step.
Structural failure of one extracted entity → that candidate's own `validation_status =
'invalid'`, never blocking the rest (Decision E.11).

**Four distinct "version" concepts, never conflated, each with its own name and
column:**

| Concept | Where it lives | What it describes |
|---|---|---|
| `AssessmentPersistedState.schemaVersion` (a literal field inside the parsed document) | not stored as a column at all — validated in place against `source_contract_version` during document-schema validation | The **source document's own** declared version |
| `source_contract_version` (`adoption_protocols`) | `private.adoption_protocols.source_contract_version` | What **this protocol version expects** the document's `schemaVersion` to equal |
| `AssessmentRun.schemaVersion` (a literal field inside one extracted entity) | `public.assessment_runs.entity_schema_version` | The **per-entity** legacy schema version |
| `canonical_mapping_version` | `private.adoption_protocols.canonical_mapping_version`, promoted to `public.assessment_runs.canonical_mapping_version` | **This ADR's own mapping-logic version** — independent of the source schema; a mapping-code change with no source-shape change still gets a new version |

**The Assessment payload boundary and canonical reconstruction rule.** Promotion strips,
from the parsed candidate, every field already promoted to a typed column:
`id` → `assessment_run_id`; `status`; `schemaVersion` → `entity_schema_version`;
`templateVersion` → `template_version`; `createdAt` → **both** `created_at_source`
(verbatim) **and** `created_at` (parsed `timestamptz` companion, Decision I's
"Timestamp fidelity"); `completedAt` → **both** `completed_at_source`/`completed_at`,
same pattern; and, **nested inside** `templateSnapshot`, its own `id` field →
`template_id`. Everything else (`templateSnapshot`'s remaining fields, `attempts`,
`protocolDeviations`, `interruption`, `timingProviderSnapshot`, `thresholdSnapshot`,
`notes`) stays in `payload` unchanged. **Reconstruction — the exact, lossless inverse,
so a repository read can rebuild the original `AssessmentRun` shape:**

```text
reconstructed.id             = assessment_runs.assessment_run_id
reconstructed.status         = assessment_runs.status
reconstructed.schemaVersion  = assessment_runs.entity_schema_version
reconstructed.templateVersion = assessment_runs.template_version
reconstructed.createdAt      = assessment_runs.created_at_source
reconstructed.completedAt    = assessment_runs.completed_at_source
  -- NEVER assessment_runs.created_at/completed_at (the parsed timestamptz companions)
  -- -- those exist only for sorting/range-querying and are never read back into a
  -- reconstructed value, exactly because a timestamptz->string reconstruction is the
  -- claim this revision retracts (Decision I's "Timestamp fidelity")
reconstructed.templateSnapshot = { id: assessment_runs.template_id, ...payload.templateSnapshot }
reconstructed.{attempts, protocolDeviations, interruption, timingProviderSnapshot, thresholdSnapshot, notes}
  = payload.{...same keys}
```

No information is lost: every stripped field has exactly one typed-column home, and
`payload.templateSnapshot` is stored **without** its own `id` key (never duplicated),
merged back in only at read time. **Corrected:** the prior revision's reconstruction
example omitted `thresholdSnapshot` from the payload-passthrough list, even though the
preceding paragraph already states it stays in `payload` unchanged — the example now
lists all six passthrough fields exactly matching the prose.

**Timestamp fidelity — corrected a second time, from "reconstruct the lexical form from
`timestamptz`" to "preserve the lexical form directly."** The immediately preceding
revision proved only that **today's** creation call sites (`src/lib/assessment/run.ts`/
`attempts.ts`) always call `new Date().toISOString()`, then treated that as license to
reconstruct the original string from a parsed `timestamptz` instant. **That proof does
not cover what this correction actually requires:** `timestamptz` stores an *instant*,
not a *spelling* — grep evidence about current writer call sites says nothing about
**legacy** data already persisted under some other convention, data **imported** from
outside this codebase's own writers, or a **future** writer this document cannot see.
Claiming a lossless lexical inverse on the strength of present-day call sites alone
was an overclaim this revision retracts, without asserting the opposite (that
reconstruction is impossible) either — the honest position is that this document
cannot prove reconstruction-from-`timestamptz` is safe for every value the source
contract might ever produce, so it stops relying on that proof entirely.

**Corrected design (Option A: preserve, don't reconstruct).** `assessment_runs`
(Decision E.9) stores **both** the exact, verbatim source string
(`created_at_source`/`completed_at_source text`) **and** a parsed `timestamptz`
companion (`created_at`/`completed_at`, unchanged columns) for sorting and
range-querying. **The client's own `createdAt`/`completedAt` reconstruction reads
`created_at_source`/`completed_at_source` directly, byte-for-byte — never the
`timestamptz` columns, and never any reconstruction logic applied to them.** This is
lossless by construction, for any string the document-level validation (Decision I's
schema boundary) accepted as `createdAt`/`completedAt` in the first place, regardless
of which writer, era, or import path produced it — the `timestamptz` companion exists
purely as a query/sort convenience and is never the source of truth for the
client-visible value. `finalize_adoption`'s promotion step (Decision G.3) copies the
staged document's own `createdAt`/`completedAt` string fields into
`created_at_source`/`completed_at_source` verbatim, and separately parses them (via
ordinary `timestamptz` input coercion) into `created_at`/`completed_at` — a parse
failure at that second step is `internal_failure` (Decision I's catch-all), since the
document-level schema (Decision I's validation boundary) is what is responsible for
having already rejected an unparseable timestamp string before promotion ever runs.

**Fixture parity, required, not authored here.** The concrete `source_document_schema`/
`canonical_entity_schema` documents and any cross-field checks beyond what
`pg_jsonschema` expresses must be derived from, and tested against, golden accept/reject
fixtures generated directly from `src/lib/assessment/migration.ts`'s existing
`validatePersistedAssessmentRun` and its test suite — not invented fresh for this ADR
(Decision O, stage 9).

**Exception behavior (unchanged, restated exactly).** Every mutating statement inside
one transition function lives inside the same `BEGIN ... EXCEPTION WHEN OTHERS ... END`
block, so a caught exception rolls back every preceding mutating statement in that block
before returning `internal_failure`. Known, anticipated business-rule failures are
validated **before** any mutating statement runs, wherever possible, and returned as an
ordinary result value — never raised as a PostgreSQL exception, and never relied upon to
be "caught" into the right code (Decision F.1's explicit pre-insertion duplicate check,
not a caught unique-violation, is what produces `malformed_request` for a duplicate
position within one batch).

**`malformed_request` vs. `validation_failed`, drawn as one exact line, applied
consistently everywhere in this document:** `malformed_request` is for the **RPC's own
input shape** — a non-canonical hex string, a batch with an internally duplicated
key/position, a parameter of the wrong type or an unregistered `source_key`.
`validation_failed` is for **staged source content**, already accepted as a
well-formed request, that fails document- or entity-level schema/cross-field validation
during `analyze_adoption`. Every place earlier revisions of this document used
`malformed_request` for staged-content validation has been corrected to
`validation_failed` (Decision L).

### J. Preserving the existing Assessment delete capability (unchanged mechanism; RLS interaction corrected in Decision K.3)

`public.assessment_history_tombstones` plus `delete_assessment_history_run(assessment_run_id)`
(`SECURITY DEFINER`, idempotent `INSERT ... ON CONFLICT DO NOTHING`, non-owner
indistinguishable from `not_found`). **How ordinary reads exclude tombstoned rows is now
specified precisely in Decision K.3**, rather than left to a view alone. Undelete, hard
deletion, and legal/GDPR erasure remain separately classified and undesigned.

### K. Security, RLS, views, and function ownership — an exact, primary-sourced matrix

**K.1 Schema exposure.** `private` is never in the exposed-schema list — unreachable via
the Data API regardless of any grant. `public` holds `profiles`, `athletes`,
`assessment_runs`, `assessment_history_tombstones`, `assessment_history_active`.

**K.2 `ENABLE` and `FORCE` are two separate, both-required statements — not one implying
the other.** For every `public`-schema base table:

```sql
alter table public.profiles enable row level security;
alter table public.profiles force row level security;
-- identically for athletes, assessment_runs, assessment_history_tombstones
```

`ENABLE ROW LEVEL SECURITY` turns policy evaluation on for non-owner roles.
`FORCE ROW LEVEL SECURITY` additionally applies it to the table's **own owner** (who is
otherwise exempt) — a role with the `BYPASSRLS` attribute (Decision K.8's
`adoption_protocol_owner`) still bypasses RLS unconditionally regardless of `FORCE`
(`BYPASSRLS` is a stronger, independent exemption); `FORCE` is set here purely as
defense-in-depth against a future accidental ownership change to a non-`BYPASSRLS` role.
Neither statement substitutes for the other; both are required on every table.

**K.3 Views bypass RLS by default — corrected, with the exact fix and its version
requirement.** Confirmed directly (Appendix): "Views bypass RLS by default because they
are usually created with the `postgres` user," and `security_invoker = true` (PostgreSQL
15+) makes a view evaluate RLS as the querying role instead. **`assessment_history_active`
is created with this option explicitly:**

```sql
create view public.assessment_history_active
with (security_invoker = true)
as select * from public.assessment_runs;
```

**This design requires deploying on a PostgreSQL version that supports
`security_invoker` (15+); if the target project's version does not, the documented
fallback (Appendix) is to keep this view in a non-exposed schema or revoke direct client
access to it entirely** — verifying the deployed version is an implementation
prerequisite (Decision O), not assumed here.

**Tombstones made authoritative for ordinary reads — at the policy level, not
duplicated view-side logic.** The owner `SELECT` policy on `assessment_runs` itself
excludes tombstoned rows. **⚠ BLOCKED (identity/authority-scope — see Status): this
policy's `account_scope_id = auth.uid()` condition assumes the account-scoped
derivation, which `assessment_runs`'s own `fk_athlete` constraint (Decision E.9)
contradicts by treating `account_scope_id` as Profile-scoped — not
implementation-ready until that choice is made.**

```sql
create policy assessment_runs_owner_select on public.assessment_runs
  for select
  to authenticated
  using (
    account_scope_id = auth.uid()
    and not exists (
      select 1 from public.assessment_history_tombstones t
      where t.account_scope_id = assessment_runs.account_scope_id
        and t.assessment_run_id = assessment_runs.assessment_run_id
    )
  );
```

Because `assessment_history_active` is `security_invoker`, it **inherits this exact
policy automatically** — the exclusion rule is written exactly once, on the base table,
never duplicated in the view. An ordinary `authenticated` client therefore cannot read a
tombstoned row through **either** the base table or the view — both apply the identical
policy. **Operational/administrative access** (`postgres`, or a role queried directly
without going through `authenticated`'s RLS-governed path) is unaffected by this policy
and can still inspect tombstoned rows for audit purposes — RLS restricts `authenticated`,
not database administration. Tombstone rows themselves remain owner-readable via their
own, separate `SELECT` policy (unchanged).

**K.4 Default grants — corrected: the three default-granted roles are `anon`,
`authenticated`, and `service_role`, not "the table owner."** Confirmed (Appendix): "a
new table in `public` starts with every privilege already granted to all three roles" —
these are Supabase's three standard Postgres roles (`anon`, `authenticated`,
`service_role`), never the owning role (ownership isn't a grant recipient in this
sense). **Every `public`-schema table therefore requires an explicit, migration-wide
`REVOKE ALL ... FROM anon, authenticated, service_role;` immediately after creation**,
followed by precise, minimal re-`GRANT`s — this closes a real gap the prior revision
left: `service_role` also starts with default table access that must be explicitly
revoked, not merely `anon`/`authenticated`.

**K.5 The exact RLS/grant matrix.** "Function-only" = no grant or policy permits the
access for any client-facing role; reachable only through a `SECURITY DEFINER` function
(Decision K.8). "Unreachable (private schema)" = not exposed at all (K.1).

| Table/view | `anon` (S/I/U/D) | `authenticated` owner (S/I/U/D) | `authenticated` non-owner | `service_role` (application) | Function-only | `postgres`/admin |
|---|---|---|---|---|---|---|
| `private.domains` | none×4 | none×4 (unreachable) | none | none | reads via functions | full |
| `private.adoption_protocols` | none×4 | none×4 (unreachable) | none | none direct — only via `register_adoption_protocol`/`transition_adoption_protocol_status` | reads via functions; writes via the two named operational functions only | full |
| `private.adoption_protocol_source_keys` | none×4 | none×4 (unreachable) | none | none direct — only via `register_adoption_protocol` | reads via functions; writes via that one function | full |
| `private.implemented_canonical_mappings` | none×4 | none×4 (unreachable) | none | **none at all — not even `EXECUTE`-mediated write access; no RPC in Decision M ever inserts into this table** (Decision E.2c: a row is added only as part of deploying a mapping handler's own migration/code, an operational step outside the RPC surface entirely) | `SELECT`-only, granted directly to `adoption_protocol_owner` (Decision K.8) — the **only** reader is `transition_adoption_protocol_status`'s `→ pilot` gate (Decision E.2/E.2c), itself currently unreachable behind Decision E.2b's hard block (Task 5) | full (migration/admin-applied `INSERT` only) |
| `public.profiles` | none×4 | SELECT own row / function-only / **UPDATE (`display_name`) own row only** / none | none (own-row scoping resolves the caller's Profile through `account_profile_links` — `id = private.current_profile_id()` — never `id = auth.uid()`; `Profile.id` is its own stable UUID, docs/adr/0022 Decision 1) | none | INSERT (`bootstrap_account` only) | full |
| `public.athletes` | none×4 | SELECT own row / function-only / none / none | none (own-row scoping is `profile_id = private.current_profile_id()`, resolved through `account_profile_links`, never `profile_id = auth.uid()`) | none | INSERT (`bootstrap_account` only) | full |
| `private.account_domain_authorities` | none×4 | none×4 (unreachable) | none | none direct | all reads/writes via functions | full |
| `private.adoption_runs` | none×4 | none×4 (unreachable) | none | none direct | all reads/writes via functions | full |
| `private.adoption_staged_entries` | none×4 | none×4 (unreachable) | none | none direct | all reads/writes via functions (insert-only, Decision F.1) | full |
| `private.adoption_analyses` | none×4 | none×4 (unreachable) | none | none direct | all reads/writes via functions | full |
| `private.adoption_analysis_candidates` | none×4 | none×4 (unreachable) | none | none direct | all reads/writes via functions | full |
| `private.adoption_conflicts` | none×4 | none×4 (unreachable) | none | none direct | all reads/writes via functions | full |
| `public.assessment_runs` | none×4 | SELECT own, non-tombstoned rows (policy above) / none / none / none | none | none | INSERT (`finalize_adoption` only) | full |
| `public.assessment_history_tombstones` | none×4 | SELECT own rows / none / none / none | none | none | INSERT (`delete_assessment_history_run` only) | full |
| `public.assessment_history_active` (view) | none | SELECT own, non-tombstoned rows (inherits the base policy, `security_invoker`) | none | none | n/a (view) | full |

**`service_role` (application) is a distinct column from `postgres`/admin — corrected.**
The prior revision's matrix collapsed these into one "full" column while its own prose
said `service_role` should execute only one operational function; this table now shows
`service_role` with **no direct table grants at all**, and exactly three
`EXECUTE`-only capabilities (Decision K.6): `register_adoption_protocol`,
`transition_adoption_protocol_status`, `backfill_domain_authority`. `postgres`
(database ownership/emergency administration) is a separate concern entirely, outside
this application's own security model, and is never a role this application grants
anything to deliberately.

**Proofs, restated against every requirement this matrix must satisfy** (unchanged
substance from the prior revision, now grounded in the corrected matrix above): Account
A cannot read/mutate Account B's data anywhere (owner-scoped `USING` clauses plus
`private`-schema unreachability, two independent layers); a client cannot assign rows to
another account (no function accepts an account/owner parameter, Decision K.8); a
client cannot self-grant cloud authority or mark a run committed (`private` tables
unreachable); a client cannot make prepared rows canonical without finalize
(`assessment_runs`/`adoption_staged_entries` both closed to direct writes); logout
leaves data inaccessible, never reverting authority (RLS evaluates `auth.uid()` per
request; no column changes as a result of logout).

**K.6 Function inventory, recounted exactly.** Thirteen `authenticated`-callable
functions: `bootstrap_account`, `begin_adoption`, `stage_adoption_entries`,
`analyze_adoption`, `query_adoption_analysis`, `query_adoption_conflicts`,
`resolve_adoption_conflicts`, `finalize_adoption`, `query_adoption_run`,
`query_account_domain_authority`, `abort_adoption`, `abort_and_replace_adoption`,
`delete_assessment_history_run`. Three `service_role`-only operational functions:
`register_adoption_protocol`, `transition_adoption_protocol_status`,
`backfill_domain_authority` (normative contracts for all three are specified below —
Task 7.7: numbered algorithm steps and SQL fragments, never a complete, literal
`CREATE FUNCTION ... AS $$ ... $$` body for any of the three). **Sixteen functions
total** — this count is generated directly from the final RPC list in Decision M, and
is unchanged by this revision's corrections (every fix below completes an existing
function's contract; none adds or removes a function).

**`register_adoption_protocol` — total prevalidation before any write, corrected from
relying on `PRIMARY KEY`/`UNIQUE` exceptions.**

1. Acquire `pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtextextended(domain || ':'
   || protocol_version::text, 0))` — an advisory lock keyed by the pair, held for the
   transaction, released automatically at commit or rollback. This is necessary because
   the row this call may be about to create **does not exist yet** — an ordinary
   row-level lock has nothing to lock onto until after the row exists, so two
   concurrent registrations of the same `(domain, protocol_version)` are serialized on
   this key instead.
2. **Verify `domain` already exists in `private.domains`** (else `not_found` — domain
   identity is a separate, more foundational allow-list this function does not create
   implicitly; a new domain is added to `private.domains` as its own, distinct
   administrative step, never conflated with registering one of its protocol versions).
3. **Prevalidate the complete request, before any insert:** the submitted source-key
   list is non-empty; positions are zero-based and contiguous (`count(*) = max(position)
   + 1` and `min(position) = 0` over the **submitted request**, not yet any table row);
   no two submitted entries share a position or a key; no submitted key is `null`;
   `source_contract_version > 0` and `canonical_mapping_version > 0`;
   `source_document_schema::json` passes `extensions.jsonschema_is_valid(...)`;
   `canonical_entity_schema::json`, if provided, also passes it (exact signature:
   `jsonschema_is_valid(schema json) returns bool`, Decision E.13/Appendix). **Any
   single failure → `malformed_request`, no mutation** — never a caught
   `PRIMARY KEY`/`UNIQUE` exception standing in for this
   check.
4. **Idempotency, checked while still holding the advisory lock:** if a row already
   exists for `(domain, protocol_version)`, compare it field-by-field against the
   request's own immutable contract (`fingerprint_version`, `source_contract_version`,
   `canonical_mapping_version`, `source_document_schema`, `canonical_entity_schema`, and
   the full ordered source-key set). **Corrected (Task 7.9): the two `jsonb` columns
   (`source_document_schema`, `canonical_entity_schema`) are compared with `IS NOT
   DISTINCT FROM` — exact PostgreSQL `jsonb` equality, `NULL`-safe (`canonical_entity_
   schema` is nullable) — never "byte-for-byte identical," which this document does
   not claim anywhere else either: `jsonb` does not store or compare the original
   source bytes/text at all (Decision E.11's own "digest and equality model"), only its
   own decomposed, whitespace/key-order-independent representation. Every non-`jsonb`
   field above (`fingerprint_version`, the two integer versions, the source-key set) is
   compared by ordinary exact equality, for which "byte-for-byte" and "value-equal" are
   the same thing anyway.** **Exact match on every field → `already_registered`, no
   mutation** (a distinct success-equivalent result, never described vaguely as
   "already_committed-equivalent"). **Any field different → `idempotency_mismatch`, no
   mutation.**
5. **Only if no existing row:** `INSERT` the `adoption_protocols` row
   (`activation_status = 'design_only'`, always — this function never accepts any other
   initial status) and every `adoption_protocol_source_keys` row, in this same
   transaction, then re-verify contiguity against the **inserted** rows as a final,
   structural defense-in-depth check.
6. **Two concurrent identical registrations:** both attempt the advisory lock; the
   second blocks until the first commits, then re-observes the now-existing row at step
   4 and returns `already_registered` — exactly one row and one source-key set is ever
   created, and both calls converge on it. **Two concurrent, differing registrations:**
   identical serialization; the loser's step-4 comparison finds a mismatch and returns
   `idempotency_mismatch`.

**`transition_adoption_protocol_status(domain, protocol_version, new_status)`** —
corrected a second time to specify **one exact, normative lock order**, replacing the
prior revision's read-before-lock sequencing (step 2 read the protocol row for
existence **before** the advisory lock in step 3 — exactly the "protocol-row read made
before the advisory lock" this correction removes: a row read that way could be stale
by the time the lock-protected re-evaluation actually runs, and the prior text never
said whether the same-status/linear-order checks reused that early, unlocked read or a
later one).

**The exact order, with no other read of `private.adoption_protocols` anywhere in this
function outside step 3:**

1. **Validate input syntax and the target status, with zero reads.** `new_status` must
   be exactly one of `'pilot'`, `'production'`, `'retired'` — any other value
   (including `'design_only'`, which is only ever set by `register_adoption_protocol`
   itself, never a target of this function) is `malformed_request`, unconditionally,
   before any table is touched. **This check is scoped to the *requested target*
   alone, never to the row's current stored state** — a request naming the forbidden
   target `'design_only'` is `malformed_request` even when the protocol's *current*
   `activation_status` also happens to already be `'design_only'`; the same-status
   idempotent no-op (step 4 below) only ever applies to a **valid** requested target
   that matches the current state, never rescues an invalid target by coincidence.
2. **Acquire the domain-scoped advisory lock:**
   `pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext(domain))`, held for the
   transaction. This is acquired **before any read of `private.adoption_protocols` at
   all** — not merely before the one-active-version check, as the prior revision had
   it. Every `transition_adoption_protocol_status` call for a given `domain`, for
   **any** `protocol_version`, serializes on this same key before either reads or
   writes anything about that domain's protocols — this is what closes the race
   between two different `protocol_version`s of the same `domain` both racing to become
   `pilot`, which a per-row lock alone (acquired only after this point, step 3) cannot
   prevent on its own.
3. **Only now, under the domain lock already held: `SELECT ... FOR UPDATE` the
   `(domain, protocol_version)` row.** No row → `not_found`. This is the **one** read
   of this row's `activation_status`/`backfilled_at`/schemas/source-key-set that every
   later step in this function reasons from — never the pre-lock read the prior
   revision's step 2 performed, which no longer exists in this ordering at all.
4. **Re-evaluate the current state and every invariant, entirely from step 3's
   locked read — corrected (Task 5) so the unconditional pilot block is truly
   evaluated first among the substantive checks, never after other pilot-readiness
   conditions have already had a chance to return a different result:**
   - **Same-status idempotent no-op, checked first:** if `new_status` (already proven
     valid at step 1) equals the row's own current, already-effective
     `activation_status` (from step 3): return `transitioned`, no mutation (this is the
     one authoritative statement of this rule; Decision M's RPC inventory row states
     the same outcome and must never be read as contradicting it; Task 5 keeps this as
     a separate, valid no-op — it is never routed through the hard block below, since
     it is not an attempt to *reach* `pilot`, only to reconfirm a status already
     granted).
   - **`representability_contract_unresolved` (Decision E.2b) — checked immediately
     next, before any other substantive condition, and precisely scoped: the current,
     already-effective `activation_status` (step 3) is `'design_only'` *and* the
     requested `new_status` is exactly `'pilot'`.** Because `design_only → pilot` is
     the *only* transition the linear order (Decision E.2) ever permits into `'pilot'`
     at all, this scope is exhaustive of every legitimate attempt to reach `pilot` —
     there is no other in-order path this hard block could fail to intercept. **When
     this condition holds, the function returns `representability_contract_unresolved`
     immediately and does not evaluate schema validity, the mapping registry
     (Decision E.2c), source-key contiguity, `backfilled_at`, or the one-active-
     version-per-domain check at all** — those remain **documented, future readiness
     conditions** (below), never claimed to be observable result precedence while this
     block stands, because none of them can ever be reached before it fires for this
     exact transition.
   - **Linear order, for every other requested transition** (i.e. every case that did
     not match the hard block's exact scope above — `→ 'production'`, `→ 'retired'`,
     or an out-of-order request that never legitimately reaches `'pilot'` in the first
     place, such as `design_only → production` directly): must follow the exact order
     `design_only → pilot → production → retired`, one step at a time, never skipping a
     stage — a request outside this order is `invalid_transition`. (A request like
     `production → 'pilot'` or `retired → 'pilot'`, naming `'pilot'` from a
     **non**-`design_only` current state, is already excluded from the hard block's
     scope above — since only a **current** state of exactly `design_only` matches it —
     and is caught here instead, as an ordinary out-of-order `invalid_transition`; it
     was never a legitimate attempt to reach `pilot` the hard block needed to
     intercept.)
   - **Documented, future readiness conditions for `→ 'pilot'` — not currently
     evaluated by this function at all, since the hard block above always fires first
     for the only transition that could ever reach them:** valid schemas
     (`source_document_schema`/`canonical_entity_schema`, Decision E.2), the mapping
     registry (`canonical_mapping_version` implemented for this domain, Decision E.2c),
     a non-empty contiguous source-key set (Decision E.2a), `backfilled_at IS NOT NULL`
     (Decision K.6/H.8), and the one-active-version-per-domain check (a domain-scoped
     `SELECT` under the lock already held, confirming no **other** `protocol_version`
     already has `activation_status IN ('pilot', 'production')`, with the partial
     unique index, Decision E.2, as a defense-in-depth backstop). **These remain the
     conditions a later, accepted ADR's own migration must wire into this function's
     logic once Decision E.2b's block is lifted — they are specified here as the
     target design, not as behavior this document claims already executes.**
5. **Perform the transition (`UPDATE ... SET activation_status = new_status`, and, for
   the specific column changes Decision E.2/K.6 already name) or return the classified
   result from step 4** — nothing beyond steps 1-4 decides the outcome. **Today, this
   means every call returns `transitioned` (same-status), `malformed_request`/
   `not_found` (steps 1/3), `representability_contract_unresolved` (any genuine attempt
   to reach `pilot`), or `invalid_transition` (every other case) — this function can
   never actually perform an `UPDATE` at all while Decision E.2b's block stands, since
   `pilot` can never be reached in the first place, and `production`/`retired` are only
   ever reachable from a `pilot` row that can now never exist. The function's own
   `production`/`retired` logic is still specified above, correctly, for the state this
   design targets once a later ADR lifts the block — it is simply unreachable, not
   incorrect, in the interim.

**`backfill_domain_authority(domain, protocol_version)` — corrected to describe the
one, real PostgreSQL transaction this function actually runs in, not a
partial-progress model no ordinary function/RPC invocation can produce.**

**⚠ BLOCKED (identity/authority-scope — see Status).** The authority-row `INSERT`
below populates `account_scope_id` from `public.profiles.id` — Profile-scoped —
which disagrees with `bootstrap_account()`'s own `account_scope_id = auth.uid()`
(Decision H.8, account-scoped) for the exact same column on the exact same table.
The transaction/locking/completeness design below remains valid independent of
which scope is chosen, but the concrete `INSERT ... SELECT` is not
implementation-ready until the choice is made.

**The defect, stated precisely.** The prior revision described a single call as if it
could "leave whatever subset of profiles had already been inserted durable" from a
**crash within that same call** — but a single PL/pgSQL function invocation is one
PostgreSQL transaction (Decision I's own unchanged foundational rule, restated here
because this function's own prose contradicted it): there is no per-row commit inside
one call, no partial durability from one call's own crash, and no mechanism by which an
ordinary function reaching a crash mid-body leaves *some* of its own attempted inserts
committed and others not. Every row this correction attributes to "an earlier call" is
a row from a **separate, previously-committed, complete call** — never a surviving
fragment of the call that crashed.

**The exact, single-transaction body — one exact order, stated once here and applied
everywhere else this function is described, with an exact per-row proof, not a count
comparison.** **Corrected (this pass): an earlier revision gave two contradictory
normative orders for this function** — this section's own heading and SQL previously
read "lock-first," while a numbered point below it separately claimed the protocol-
existence precondition was checked **before** the lock. Only one order is correct, and
only one is stated below: role enforcement and structural parameter checks first (both
outside the function body proper — this is a `service_role`-only function, Decision
K.4/K.5's grants are what actually exclude every other role, and `domain text`/
`protocol_version integer` are validated by PostgreSQL's own parameter typing, with no
further business-shape validation this function needs), **then** the lock, **then**
the existence check, **then** the two writes:

```sql
perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('bootstrap_backfill_serialization'));
  -- the SAME global key Decision H.8's bootstrap_account acquires — see H.8's exact
  -- serialization proof; this is the fix for the MVCC race Task 2 names.
  -- Acquired BEFORE the existence check below — never after — purely to fix this
  -- function's OWN internal order (lock, then read, then write, with no branch that
  -- reads before locking); this lock serializes only bootstrap_account, this function,
  -- and begin_adoption's missing-row path against each other (Decision H.8/H.1) — it
  -- does not block, and is not why the existence check below cannot observe a
  -- concurrent register_adoption_protocol/transition_adoption_protocol_status call
  -- mid-write. That property comes from ordinary PostgreSQL statement-level MVCC,
  -- unconditionally, with or without this lock: the SELECT below takes one snapshot
  -- and sees only already-committed rows, never a partial write in progress from any
  -- transaction, including those two functions' own separate, domain-scoped locks
  -- (see the scope note below for the full statement of what this lock does and does
  -- not serialize).

if not exists (
  select 1
  from private.adoption_protocols
  where domain = $domain
    and protocol_version = $protocol_version
) then
  -- not_found: no such (domain, protocol_version) row exists. Checked under the lock,
  -- not before it — this is the one substantive correction this pass makes to this
  -- function's order. Returning not_found here still releases the lock normally at
  -- this call's own commit; it does not hold the lock open any longer than any other
  -- branch below.
  return 'not_found';
end if;

-- one INSERT ... SELECT, set-based over every current profile at once —
-- never a per-row loop with its own per-row commits
insert into private.account_domain_authorities
  (account_scope_id, domain, authority_status, authority_revision)
select profiles.id, $domain, 'not_initialized', 0
from public.profiles
on conflict (account_scope_id, domain) do nothing;

update private.adoption_protocols
  set backfilled_at = now()
  where domain = $domain
    and protocol_version = $protocol_version
    and backfilled_at is null
    and not exists (
      select 1
      from public.profiles p
      where not exists (
        select 1
        from private.account_domain_authorities a
        where a.account_scope_id = p.id
          and a.domain = $domain
      )
    );
```

**The single, exact order, stated once, for every place in this document that
describes this function:**

1. Role enforcement (via grants, Decision K.4/K.5) and structural parameter validation
   (via PostgreSQL's own parameter typing) — both ahead of, and outside, the function
   body's own transaction logic.
2. Acquire `bootstrap_backfill_serialization`.
3. **Under the held lock**, verify the exact `(domain, protocol_version)` row exists in
   `private.adoption_protocols` — otherwise return `not_found`.
4. Execute the set-based authority-row `INSERT ... SELECT ... ON CONFLICT DO NOTHING`.
5. Execute the guarded, `NOT EXISTS`-proven `backfilled_at UPDATE`, and return the
   classified result (`backfilled`, or `not_found` from step 3 above).

**Scope note, stated exactly, so this correction is not mistaken for a broader
claim.** **Corrected (this pass): the SQL comment above previously said the lock was
acquired first "so that" a concurrent `register_adoption_protocol`/`transition_
adoption_protocol_status` call "cannot be observed mid-write" — a false causal claim
this scope note already contradicted below it; the comment is now fixed to match this
note, not the other way around.** `bootstrap_backfill_serialization` serializes only
`bootstrap_account` and `backfill_domain_authority` (and, on its missing-row path,
`begin_adoption`, Decision H.1/Task 2) against each other, and establishes only this
function's own fixed internal order (lock, then read, then write) — it does **not**
serialize, and this document does not claim it serializes, `register_adoption_
protocol`'s protocol-registration lock or `transition_adoption_protocol_status`'s
protocol-status-transition lock (Decision K.6), both of which use their own, separate,
domain-scoped advisory lock keys. What actually prevents the existence check above
from observing a partial write is ordinary PostgreSQL statement-level MVCC, not this
lock: that `SELECT` takes one snapshot at the moment it runs and sees only rows
already committed as of that snapshot — a `register_adoption_protocol`/`transition_
adoption_protocol_status` call whose own commit completed **before** this `SELECT`'s
snapshot is visible to it; one whose commit completes **after** this `SELECT`'s
snapshot was taken is not visible to it, exactly as with any other read of that table,
locked or not. If this existence check returns `not_found` because the matching
`(domain, protocol_version)` registration had not yet committed as of this `SELECT`'s
own snapshot, that is a correct result **for that snapshot** — not a stale or racy one
— and the caller may simply retry `backfill_domain_authority` once registration has
since committed.

**Corrected: an exact `NOT EXISTS` proof — "no profile lacks an authority row for this
domain" — replaces the prior revision's count-equality comparison.** A count match
(`count(profiles) = count(authority rows for domain)`) proves the two sets are the
same **size**; it does not, on its own, directly exhibit that they are the same **set**
— under this schema that gap is already closed by other invariants (authority rows are
only ever inserted with an `account_scope_id` drawn from `profiles.id`, and neither
table is ever deleted from, Decision K.8), but `NOT EXISTS` is the direct, exact
statement of the actual property finalization depends on, not an arithmetic
consequence of it, and is used here instead of relying on that separate argument.

0. **The `(domain, protocol_version)` existence precondition, checked at step 3 of the
   exact order above — under the lock, not before it.** **Corrected (this pass): an
   earlier revision of this point placed this check "before the lock," directly
   contradicting this same section's own heading and SQL, which have always shown the
   lock first.** A `private.adoption_protocols` row must exist for the exact `(domain,
   protocol_version)` pair — else `not_found` (Decision M/L.3's producer list for this
   function; the domain and the protocol version are validated together, since
   `backfilled_at` — the column this function's success is measured against — lives on
   this specific `(domain, protocol_version)` row, not on `domain` alone). Checking this
   under the lock, rather than before acquiring it, costs nothing extra in practice —
   this function is an infrequent, administrative operation (Decision H.8), never a
   hot-path call — and keeps this function's own internal order uniform: lock, then
   every read, then every write, with no code path that reads `private.
   adoption_protocols` before the lock is held.
1. **No `activation_status` restriction gates this step** — deliberately callable
   while the protocol is `design_only`, `pilot`, `production`, or `retired`. The
   `INSERT ... SELECT` above covers **every** `public.profiles` row that exists at the
   instant this statement runs (**not** every `auth.users` row — this function never
   reads `auth.users` at all), in one set-based statement — not a cursor, not a loop,
   not one `INSERT` per profile.
2. **An `auth.users` row with no `profiles` row is intentionally still unbootstrapped —
   this function does not, and is not claimed to, backfill it.** Such an account
   receives its `profiles`, `athletes`, and every already-backfilled domain's authority
   row later, all at once, the next time `bootstrap_account` (Decision H.8, corrected)
   runs for it — bootstrap and backfill now share one serialization lock (Decision H.8's
   exact proof), so this is no longer an unserialized race between two independently
   racing calls; it is the same lock-then-reobserve pattern Decision H.1 already
   establishes for `begin_adoption`.
3. **The `NOT EXISTS` check and the `backfilled_at` update happen in the same
   transaction, under the same lock, as the `INSERT ... SELECT` above** — all three
   statements are one function body, one transaction, one commit. `backfilled_at` is
   set **the first time this completes** (guarded by `backfilled_at IS NULL`, so a
   later call never overwrites the original timestamp) only if, at the moment of the
   `UPDATE`, every currently-existing `public.profiles` row already has a matching
   `account_domain_authorities` row for this `domain` — which the preceding `INSERT ...
   SELECT`, in this same transaction, just guaranteed. **This proves every profile
   existing at completion has the authority row; it says nothing about, and never
   claims anything about, `auth.users` rows that never became a `profiles` row at
   all.** Because this entire sequence runs under the global serialization lock
   (Decision H.8), no concurrent `bootstrap_account` call can commit a **new** profile
   between this transaction's `INSERT ... SELECT` and its own commit without also
   receiving — via that same lock, in its own turn — the domain's authority row
   (Decision H.8's exact ordering proof covers both directions).
4. `begin_adoption` cannot pass before this completes because it explicitly checks
   `backfilled_at IS NOT NULL` (Decision F.2) — a clean `domain_backfill_incomplete`
   result rather than a confusing FK-violation `internal_failure`.
5. **Crash behavior, stated exactly.** A crash at any point before this function's
   single `COMMIT` rolls back **both** statements above, in full — the `INSERT ...
   SELECT` inserts zero rows from this attempt (not "whatever subset didn't yet
   commit" — there is no such subset; `INSERT ... SELECT` is one atomic statement, and
   the enclosing function body is one atomic transaction around it) and `backfilled_at`
   is not touched. A subsequent call is a **fresh, independent, single-transaction
   attempt**, run over whatever `public.profiles` rows exist at *that* later instant —
   which may already include rows covered by an **earlier, separately-committed and
   fully-successful** call, or by individual `bootstrap_account` calls, but never by
   the crashed call's own attempt, because that attempt left nothing behind.
6. **Retries and post-transition re-calls are both legitimate, not error cases — and
   each one is its own complete, atomic pass, never a resumption of a half-finished
   one.** A retry before `backfilled_at` is set (whether after a crash, per point 5, or
   simply because new profiles appeared since the last attempt) re-runs the full
   `INSERT ... SELECT` plus `NOT EXISTS` check in one fresh transaction, under the same
   lock; `ON CONFLICT DO NOTHING` makes re-inserting already-covered profiles harmless.
   A call **after** `backfilled_at` is already set (including well after the protocol
   has transitioned to `pilot`/`production`) is equally legitimate and expected: it
   inserts `not_initialized` rows for any `public.profiles` row created since the
   original backfill but not yet covered by that profile's own `bootstrap_account` call
   — no longer a race, since Decision H.8's shared lock guarantees every such profile
   is covered by one of the two functions before either commits — and leaves the
   already-set `backfilled_at` untouched. Operators are expected to re-run this function
   periodically or on demand for exactly this reason — this is not a one-time-only
   operation, but every individual **call** is still one-transaction-only.
7. **If a resumable, batched backfill is ever actually needed** (for an installation
   large enough that one `INSERT ... SELECT` over every `profiles` row in a single
   transaction is operationally undesirable — long lock duration, replication lag),
   **that is a separate, explicitly designed mechanism** — new RPC calls accepting a
   durable cursor or batch identifier, with its own idempotency and crash-recovery
   rules stated as precisely as Decision H.1's — not something this function's single-
   transaction design implies or silently provides. No such mechanism is designed by
   this document; `backfill_domain_authority` remains one call, one transaction,
   covering every current profile, full stop.
8. **Concurrent calls for the same `(domain, protocol_version)`, or for two different
   backfilled versions of one domain, are both fully serialized by the same global lock
   (Decision H.8) — corrected from the prior revision's claim that "no additional
   locking beyond ordinary row-level `ON CONFLICT` semantics" was needed, which is no
   longer accurate now that the lock exists.** Two concurrent `backfill_domain_
   authority` calls for the exact same `(domain, protocol_version)` simply run one
   after the other under the lock: the second re-observes the first's already-committed
   rows and its `NOT EXISTS` check finds nothing missing, so its own `UPDATE` either
   finds `backfilled_at` already non-`NULL` (a harmless no-op) or completes the same
   proof independently. Two different, already-`backfilled_at`-set protocol versions of
   the **same** domain never conflict with each other at all — Decision H.8's `bootstrap
   _account` correction already collapses them with `SELECT DISTINCT domain`, and this
   function's own per-`(domain, protocol_version)` `UPDATE` only ever touches its own
   row.

**K.7 `SECURITY INVOKER` vs. `SECURITY DEFINER` (unchanged reasoning).** `SECURITY
INVOKER` (PostgreSQL's default, Supabase's documented best practice) covers every
ordinary RLS-governed `SELECT`. `SECURITY DEFINER` is used only for the thirteen
`authenticated` + three `service_role` functions above, which need atomic, cross-table
access to `private`-schema state.

**K.8 Function ownership, exact, not hand-waved.** Every `SECURITY DEFINER` function is
owned by a dedicated role, created explicitly:

**Corrected: broad, whole-table `UPDATE` grants replaced with column-level grants
matching this document's own immutability claims exactly — table by table, naming
every mutable column and no others.** The prior revision granted blanket `UPDATE` on
several tables whose own text elsewhere insists most of their columns are immutable
once written; a whole-table `UPDATE` grant does not enforce that, it only asserts it in
prose. Column-level `GRANT` makes the immutable columns actually unwritable by this
role, not merely undocumented-as-written-to.

```sql
create role adoption_protocol_owner nologin bypassrls;

grant usage on schema private, extensions to adoption_protocol_owner;
grant usage on schema public to adoption_protocol_owner;

grant select, insert on private.account_domain_authorities to adoption_protocol_owner;
grant update (
  authority_status, authority_revision, adoption_run_id, last_adoption_run_id
) on private.account_domain_authorities to adoption_protocol_owner;
  -- every column except the (account_scope_id, domain) PK is mutable here (Decision
  -- E.5) -- this is a genuine state-tracking row, so naming "every column but the
  -- identity PK" is the precise least-privilege boundary, not a broader grant of
  -- convenience

grant select, insert on private.adoption_runs to adoption_protocol_owner;
grant update (
  status, analysis_frozen, promoted_entity_count, superseded_by_run_id,
  committed_at, aborted_at, abort_reason, updated_at
) on private.adoption_runs to adoption_protocol_owner;
  -- excludes id, account_scope_id, domain, protocol_version, source_entry_count,
  -- source_fingerprint, client_request_id -- immutable once inserted (Decision E.6)

grant select, insert on
  private.adoption_staged_entries
  to adoption_protocol_owner;
  -- NO update grant at all -- a staged entry is write-once (Decision F.1: a retry
  -- either matches exactly, byte-for-byte, or is rejected; nothing ever overwrites an
  -- existing staged row's content)

grant select, insert on private.adoption_analyses to adoption_protocol_owner;
grant update (status, resolution_digest)
  on private.adoption_analyses to adoption_protocol_owner;
  -- every other column (recomputed_fingerprint, fingerprint_match,
  -- parsed_entity_count, conflict_count, document_validation_code, validation_detail,
  -- analysis_digest, created_at) is set exactly once, at INSERT, by analyze_adoption
  -- (Decision G.1), and never touched again by any function -- only resolve_adoption_
  -- conflicts (Decision G.2) later mutates status (conflicts_present -> ready) and
  -- resolution_digest

grant select, insert on private.adoption_analysis_candidates to adoption_protocol_owner;
grant update (exclusion_status)
  on private.adoption_analysis_candidates to adoption_protocol_owner;
  -- every other column, INCLUDING initial_exclusion_status, is fixed at INSERT by
  -- analyze_adoption and never granted UPDATE at all; only resolve_adoption_conflicts
  -- changes exclusion_status (pending -> selected/excluded_duplicate).
  -- initial_exclusion_status has no UPDATE grant for any role, ever -- it is
  -- analysis_digest's immutable baseline (Decision E.11/Task 1.1) and must not be
  -- writable after analyze_adoption's own INSERT commits

grant select, insert on private.adoption_conflicts to adoption_protocol_owner;
grant update (decision, selected_candidate_ordinal)
  on private.adoption_conflicts to adoption_protocol_owner;
  -- every other column (duplicate_group_key, conflict_type, details, created_at) is
  -- fixed at INSERT by analyze_adoption; only resolve_adoption_conflicts writes a
  -- decision

grant select, insert on private.adoption_protocols to adoption_protocol_owner;
grant update (activation_status, backfilled_at)
  on private.adoption_protocols to adoption_protocol_owner;
  -- every other column is declared immutable by policy (Decision E.2): domain,
  -- protocol_version, fingerprint_version, source_contract_version,
  -- canonical_mapping_version, source_document_schema, canonical_entity_schema --
  -- only activation_status/backfilled_at are ever mutated, by register_adoption_
  -- protocol/transition_adoption_protocol_status/backfill_domain_authority

grant select, insert on
  private.adoption_protocol_source_keys
  to adoption_protocol_owner;
  -- NO update grant -- source keys are immutable once registered (Decision E.2a/K.6
  -- step 5); no function ever updates an existing source-key row

grant select on
  private.domains
  to adoption_protocol_owner;
  -- corrected: tightened from select/insert/update. private.domains is a
  -- separately-administered allow-list (Decision K.6: "a new domain is added ... as
  -- its own, distinct administrative step, never conflated with registering one of
  -- its protocol versions") -- no function this ADR defines ever inserts or updates
  -- it, only checks membership (register_adoption_protocol step 2)

grant select on
  private.implemented_canonical_mappings
  to adoption_protocol_owner;
  -- SELECT only -- Task 1's Decision E.2c: no RPC in Decision M ever inserts into this
  -- table (a row is added only as part of deploying a mapping handler's own code, an
  -- operational migration step, never a client-facing function); the ONLY reader is
  -- transition_adoption_protocol_status's `-> pilot` gate (Decision E.2/E.2c), which
  -- therefore needs, and is granted, exactly SELECT and nothing more

grant select, insert on
  public.profiles,
  public.athletes,
  public.assessment_runs,
  public.assessment_history_tombstones
  to adoption_protocol_owner;
```

**No `UPDATE` grant on `public.profiles` is given to `adoption_protocol_owner` at
all — corrected, removing the prior revision's unneeded `grant update (updated_at) on
public.profiles to adoption_protocol_owner`.** No `SECURITY DEFINER` function this
document defines ever issues an `UPDATE` against `public.profiles` — `bootstrap_account`
only `INSERT`s it (`ON CONFLICT DO NOTHING`, Decision H.8), and no other function
touches this table at all. The only `UPDATE` against `profiles` in this entire design is
the `authenticated` client's own direct write of `display_name` (Decision K.5), under
its own grant, not `adoption_protocol_owner`'s — and Decision K.12 already establishes
that the `updated_at` `BEFORE UPDATE` trigger sets `NEW.updated_at` regardless of the
invoking role's own column-level grant, which is exactly why the client's grant is
`UPDATE (display_name)` only, with no separate `UPDATE (updated_at)` grant for
**any** role anywhere in this design — granting it to `adoption_protocol_owner` as well
would have been a privilege no code path ever exercises.

**No `DELETE` grant is given to `adoption_protocol_owner` on anything** — nothing in
this design ever deletes a row (Decision E.12, Decision N's retention policy); a future
retention/cleanup job that needs to delete `adoption_staged_entries` rows for a
retention-window policy would need its own, separately justified grant, not assumed
here. `adoption_protocol_owner` is `NOLOGIN` (never a session role directly) and
`BYPASSRLS` (Decision K.3's mechanism — this is what lets its owned functions read/write
`private`-schema tables and cross-account `public` rows without RLS filtering their own
internal logic, since the functions perform their own explicit `auth.uid()` checks
instead, Decision K.9).

**K.9 `EXECUTE` grants — exact, schema-qualified signatures, matching Decision M's RPC
inventory precisely, never a `(...)` placeholder.** Confirmed (Appendix): "by default,
database functions can be executed by any role."

```sql
revoke execute on all functions in schema public from public, anon, authenticated, service_role;

grant execute on function public.bootstrap_account() to authenticated;
grant execute on function public.begin_adoption(text, integer, integer, text, uuid) to authenticated;
grant execute on function public.stage_adoption_entries(uuid, jsonb) to authenticated;
grant execute on function public.analyze_adoption(uuid, text) to authenticated;
grant execute on function public.query_adoption_analysis(uuid) to authenticated;
grant execute on function public.query_adoption_conflicts(uuid) to authenticated;
grant execute on function public.resolve_adoption_conflicts(uuid, integer, jsonb) to authenticated;
grant execute on function public.finalize_adoption(uuid, integer) to authenticated;
grant execute on function public.query_adoption_run(uuid) to authenticated;
grant execute on function public.query_account_domain_authority(text) to authenticated;
grant execute on function public.abort_adoption(uuid, text) to authenticated;
grant execute on function public.abort_and_replace_adoption(uuid, integer, integer, text, uuid) to authenticated;
grant execute on function public.delete_assessment_history_run(uuid) to authenticated;

grant execute on function public.register_adoption_protocol(text, integer, text, integer, integer, jsonb, jsonb, jsonb) to service_role;
grant execute on function public.transition_adoption_protocol_status(text, integer, text) to service_role;
grant execute on function public.backfill_domain_authority(text, integer) to service_role;
```

Every signature above matches Decision M's RPC inventory exactly, one-to-one — no
function in this design is overloaded, so no `GRANT` above is ambiguous about which
signature it targets.

**`ALTER DEFAULT PRIVILEGES` — corrected from an unresolved `<migration_role>`
placeholder to an executable rule, and corrected to distinguish two different defaults
that a single schema-scoped statement cannot both close.** Two distinct defaults are in
play, and they require two distinct statements:

1. **The global, built-in `PUBLIC EXECUTE` default.** PostgreSQL grants `EXECUTE` on
   every newly created function to `PUBLIC` unless a default-privileges rule says
   otherwise (Appendix: "by default, database functions can be executed by any role").
   This default is **not schema-scoped** — it is bound to `(current_user, PUBLIC)` with
   no schema qualifier at all — and a schema-scoped `ALTER DEFAULT PRIVILEGES ... IN
   SCHEMA public REVOKE ...` statement only ever changes the default *for that schema*;
   it cannot remove or override the schema-unscoped global default (Appendix:
   `ALTER DEFAULT PRIVILEGES` reference). Closing it requires a schema-unscoped
   statement, run once as the migration role:

   ```sql
   alter default privileges revoke execute on functions from public;
   ```

2. **Supabase's own per-schema defaults for `anon`/`authenticated`/`service_role`.**
   These are separate, Supabase-specific conveniences layered on top of vanilla
   PostgreSQL (not a PostgreSQL built-in), and they are legitimately closable with a
   schema-scoped statement, run once as the migration role for every schema this design
   creates objects in:

   ```sql
   alter default privileges in schema public, private
     revoke execute on functions from anon, authenticated, service_role;
   ```

The prior revision's single schema-scoped statement (`alter default privileges in
schema public revoke execute on functions from public, anon, authenticated,
service_role`) was **wrong for the `public` role specifically**: it left the
schema-unscoped global `PUBLIC EXECUTE` default untouched, so a function created later
by the migration role in `public` (or any other schema) would still start
`PUBLIC`-executable unless statement 1 above had also been run. Both statements 1 and 2
are required; neither alone closes both defaults.

Closing the *default* for future functions does not substitute for revoking `EXECUTE`
from already-created functions — every function this design creates already has its
`EXECUTE` grant fixed explicitly and individually at creation time, in the same
migration transaction as its `CREATE FUNCTION` (the `revoke ... from public, anon,
authenticated, service_role` followed by per-function `grant execute` statements
earlier in this section) — the default-privileges statements above only change what
happens to a function nobody has explicitly granted on yet.

The migration is required to include, immediately after, an assertion or logged check
of which role now owns the objects it just created (for example, a final migration
step querying `select distinct pg_get_userbyid(proowner) from pg_proc where
pronamespace = 'public'::regnamespace` and failing the migration if it returns anything
other than the expected migration role) — proving, rather than merely asserting, which
role the `ALTER DEFAULT PRIVILEGES` statements above actually bound to. This is Decision
O's implementation prerequisite, not claimed as already executed by this document.

**K.10 Function location.** The thirteen `authenticated`-callable RPCs and three
`service_role`-only operational functions live in `public` (PostgREST/the Data API only
exposes callable functions from an exposed schema). `private.fingerprint_domain_snapshot`
and any other internal helper live in `private` — never directly callable by any
client role (no `EXECUTE` grant exists for them at all; only the `public`-schema
wrapper functions, owned by the same role, call them internally).

**K.11 `search_path` — every claim now true of the actual function bodies.** Every
`SECURITY DEFINER`/`SECURITY INVOKER`-but-owned-by-`adoption_protocol_owner` function
sets `SET search_path = ''` and schema-qualifies every relation
(`private.adoption_runs`, `public.profiles`, ...) and every non-`pg_catalog` function
(`extensions.digest`, `extensions.jsonb_matches_schema`, `extensions.jsonschema_is_valid`)
it calls — including `private.fingerprint_domain_snapshot` itself (Decision B), which
the prior revision left calling `digest(...)` unqualified, a real gap this revision
closes directly.

**K.12 `profiles.updated_at` — the exact trigger, correct with respect to the
client's own column grant.**

```sql
create or replace function private.set_updated_at()
returns trigger
language plpgsql
security invoker
set search_path = ''
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

create trigger profiles_set_updated_at
  before update on public.profiles
  for each row
  execute function private.set_updated_at();
```

A `BEFORE UPDATE` trigger may set any column on `NEW`, including one the invoking
role's own column-level `GRANT` does not cover — the trigger operates on the row being
written, not on the invoking statement's own target-list privileges, which is exactly
why an `authenticated` client granted `UPDATE (display_name)` only (Decision K.5) can
still cause `updated_at` to advance on every write, without ever being granted `UPDATE`
on `updated_at` itself.

**K.13 Object ownership, exact, for every table/sequence/view/function — corrected to
stop calling two `SECURITY INVOKER` functions `SECURITY DEFINER`.** This design splits
ownership from execution privilege deliberately: **tables, sequences, and views are
owned by the migration-running role** (whatever that role is named in a given
deployment — distinct from `adoption_protocol_owner`), never by
`adoption_protocol_owner` itself, since table/sequence/view ownership implies full
`DROP`/`ALTER` control, which a role that exists only to execute functions should never
hold.

**The sixteen RPCs are `SECURITY DEFINER`, owned by `adoption_protocol_owner`** —
function ownership, not table ownership, is what a `SECURITY DEFINER` function actually
executes as.

**`private.fingerprint_domain_snapshot` and `private.set_updated_at` are `SECURITY
INVOKER`, declared exactly that way in their own `CREATE FUNCTION` statements (Decision
B, Decision K.12) — the prior revision's claim that these two were `SECURITY DEFINER`
was simply wrong, contradicted by the functions' own bodies elsewhere in this same
document.** They are still owned by `adoption_protocol_owner`, but ownership and
security mode are independent facts: a `SECURITY INVOKER` function's owner matters only
for things like its own default `search_path` resolution at definition time, never for
which privileges it executes with at call time — that is always determined by
whichever role actually invokes it. Both are invoked in exactly the contexts their
`INVOKER` mode requires being safe in:
- `private.fingerprint_domain_snapshot` is called only from inside `analyze_adoption`
  (`SECURITY DEFINER`, owned by `adoption_protocol_owner`) — by the time it runs, the
  calling session is already executing with `adoption_protocol_owner`'s elevated
  privileges (nested-call privilege inheritance: an `INVOKER` function called from
  inside an already-`DEFINER` execution context runs under that context's privileges,
  not the original client's), so it can read `private.adoption_runs`/
  `private.adoption_protocol_source_keys`/`private.adoption_staged_entries` despite
  being `INVOKER` itself.
- `private.set_updated_at` is invoked as a trigger function on `public.profiles`, fired
  by whichever role's `UPDATE` statement triggered it — the `authenticated` client's own
  direct `display_name` write (Decision K.5), in the only path that exists today. Its
  `INVOKER` mode is exactly why Decision K.12's column-grant override matters: it runs
  under the client's own (limited) privileges, and still succeeds at writing
  `NEW.updated_at`, because a `BEFORE UPDATE` trigger may set any column on `NEW`
  regardless of the invoking role's own column grants — not because the trigger
  function itself holds some elevated privilege it does not have.

This is consistent with Decision K.2's `FORCE ROW LEVEL SECURITY`: `FORCE` matters for a
table's own **owner** (the migration role, here) querying it directly outside these
functions; `adoption_protocol_owner`'s `BYPASSRLS` (Decision K.8) is a separate,
independent exemption that applies only inside the `SECURITY DEFINER` functions it
owns — the two `SECURITY INVOKER` functions above never benefit from it directly,
regardless of who owns them, since `BYPASSRLS` is a role attribute that only takes
effect for the role a statement actually executes as.

**K.14 The `adoption_staged_entries` identity sequence — an explicit grant, not an
unstated assumption.** `id bigint generated always as identity` (Decision E.8) is
backed by an automatically-created sequence,
`private.adoption_staged_entries_id_seq`. `adoption_protocol_owner` is granted this
sequence's privileges explicitly, rather than assuming an identity column's `INSERT`
behavior alone suffices:

```sql
grant usage, select on sequence private.adoption_staged_entries_id_seq to adoption_protocol_owner;
```

**K.15 Default table and sequence privileges — completing K.9's function-only default,
scoped to every object kind, as the migration role (no `<placeholder>`):**

```sql
alter default privileges in schema public, private
  revoke all on tables from anon, authenticated, service_role;
alter default privileges in schema public, private
  revoke all on sequences from anon, authenticated, service_role;
```

Paired with K.9's `alter default privileges ... revoke execute on functions`, this
means a **future** table, sequence, or function created by the migration role in either
schema starts with no automatic client-facing access at all — exactly the same
explicit, opt-in grant discipline this ADR applies to every object defined in it today
(scenario proof 45).

**K.16 The `private` schema's own baseline — enforced by role-level `REVOKE`/`GRANT`,
never relying only on the schema's absence from PostgREST's exposed-schema list:**

```sql
revoke all on schema private from public, anon, authenticated, service_role;
grant usage on schema private to adoption_protocol_owner;
revoke execute on all functions in schema private from public, anon, authenticated, service_role;
```

This is **independent of, and in addition to**, `private` never appearing in the
exposed-schema list (Decision K.1) — a future misconfiguration of that exposed-schema
list would still not, by itself, expose these tables or functions, because the
role-level grants above would still block every client-facing role regardless.

**K.17 Extension function privileges — exact, registered signatures, corrected.**
`pgcrypto`/`pg_jsonschema` functions are, by common extension-installation convention,
left `PUBLIC`-executable once the extension itself is created — but this ADR does not
assume that convention holds for every deployment. If `extensions.digest`,
`extensions.jsonb_matches_schema`, and `extensions.jsonschema_is_valid` are **not** left
`PUBLIC`-executable in the target project, the migration explicitly grants, using the
exact signatures confirmed in Decision E.13/Appendix (**the schema argument is `json`,
not `jsonb`** — corrected from the prior revision's incorrect `(jsonb, jsonb)`/`(jsonb)`
signatures, which do not exist and would make these `GRANT` statements themselves fail
at migration time against the real extension):

```sql
grant execute on function extensions.digest(bytea, text) to adoption_protocol_owner;
grant execute on function extensions.jsonb_matches_schema(json, jsonb) to adoption_protocol_owner;
grant execute on function extensions.jsonschema_is_valid(json) to adoption_protocol_owner;
```

**K.18 `assessment_history_active` — the exact view grant, not only its policy
behavior.**

```sql
revoke all on public.assessment_history_active from anon, authenticated, service_role;
grant select on public.assessment_history_active to authenticated;
```

No `INSERT`/`UPDATE`/`DELETE` grant exists on the view at all — it is read-only by
construction, backed by a base table nothing but the owning functions ever writes to.

### L. Server results vs. client/transport failures — regenerated, systematically cross-checked, single-meaning

**"Systematically cross-checked," not "exhaustive" — corrected claim strength.** Every
code below is checked against Decision M's RPC inventory and this revision's own
consistency-matrix audit; that is a claim about internal cross-referencing within this
document, not a claim that every RPC's every branch has been enumerated against running
code or a live database (none is available in this session, Appendix). A later gap
found by actually implementing and testing this design would not contradict anything
stated here — it would simply be new information this document does not yet have.

**The defect, stated precisely.** The prior revision used `fingerprint_mismatch`,
`validation_failed`, and `conflicts_present` simultaneously as (a) successful
`analyze_adoption` result variants, (b) stored `adoption_analyses.status` values, and
(c) — implicitly, via `finalize_adoption`'s own step 3 — failure codes `finalize_adoption`
itself could return. Three different namespaces sharing one string is exactly the kind
of ambiguity this section exists to remove. **Corrected: an explicit, tagged response
envelope separates "the RPC call executed" from "what the data inside it says," and
`finalize_adoption`'s own failures use distinctly-named codes that never reuse the bare
analysis-status labels.**

**L.1 The `analyze_adoption` response envelope — one `outcome`, one data field, never
three overloaded meanings for one string:**

```json
{
  "outcome": "analyzed",
  "analysisStatus": "ready" | "conflicts_present" | "fingerprint_mismatch" | "validation_failed",
  "analysisRevision": 1
}
```

`analysisRevision` is an **integer**, matching `adoption_analyses.analysis_revision`'s
own column type (Decision E.11) and every RPC parameter that consumes it
(`resolve_adoption_conflicts`'s `analysis_revision integer`,
`finalize_adoption`'s `expected_analysis_revision integer`, Decision M) — never a
string, and never requiring the client to parse or re-serialize it as one.

`"outcome": "analyzed"` is the **same** for all four `analysisStatus` values — every one
of them is a **successful** RPC call (the function executed correctly and reports a
fact about the data); `analysisStatus` is data, not a call failure, and reuses the
**same four labels** as `adoption_analyses.status` (Decision E.11) deliberately, since
they describe the identical underlying fact in two places (the RPC response, and
durable storage) — this is the one place the four labels are intentionally shared, and
it is a two-place sharing (envelope data field ↔ storage column), never a third,
call-failure meaning layered on top.

**L.2 Successful result variants for every other RPC** (one per RPC's own success
case, none of them string-shared with a business-failure code below): `ok`
(`bootstrap_account`), `prepared` (`begin_adoption`), `staged`
(`stage_adoption_entries`), `resolved` (`resolve_adoption_conflicts`), `committed`
(`finalize_adoption`), `aborted` (`abort_adoption`), `replaced`
(`abort_and_replace_adoption`), `deleted` (`delete_assessment_history_run`),
`registered` (`register_adoption_protocol`, first registration), `already_registered`
(`register_adoption_protocol`, an exact-match retry — never described as
"`already_committed`-equivalent"), `transitioned`
(`transition_adoption_protocol_status`), `backfilled` (`backfill_domain_authority`).

**L.3 Business/protocol failure codes** — every one below is produced by at least one
named function, and every failure any function in this document can produce appears
exactly once in this list, with exactly one meaning:

| Code | Meaning | Produced by |
|---|---|---|
| `not_found` | No such resource, or one that exists but isn't the caller's — never distinguished; reserved for a missing/non-owned **resource** when a session already exists | Global Lock Order (H.4/H.6); `delete_assessment_history_run`; `register_adoption_protocol` (unregistered `domain`); `backfill_domain_authority` (no such `(domain, protocol_version)`); `transition_adoption_protocol_status` (no such `(domain, protocol_version)`) |
| `unauthenticated` | No valid session at all — the **one** code for missing authentication. **An unauthenticated `begin_adoption` call (or any other authenticated-only RPC) returns `unauthenticated`, never `not_found`** — `not_found` is reserved for a missing/non-owned resource once a session already exists, a distinct condition | Every `authenticated`-callable function |
| `account_not_bootstrapped` | The caller has a valid session but no `public.profiles` row exists yet — remedy is `bootstrap_account()`, a different remedy than any domain-eligibility code below | `query_account_domain_authority` (Decision H.6b), `begin_adoption` (Decision H.1, Task 3.2: identical underlying condition, same decision tree) |
| `domain_not_eligible` | No `adoption_protocols` row with `activation_status IN ('pilot','production')` | `begin_adoption`, `query_account_domain_authority` (Decision H.6b) |
| `domain_backfill_incomplete` | Eligible protocol exists, `backfilled_at IS NULL` | `begin_adoption`, `query_account_domain_authority` (Decision H.6b) |
| `authority_state_mismatch` | Authority row's state forbids the requested transition | `begin_adoption` |
| `adoption_in_progress` | A live `prepared` run already exists for this pair (a genuinely different token) | `begin_adoption` |
| `idempotency_mismatch` | Same `client_request_id`/registration key reused with different immutable input | `begin_adoption`, `abort_and_replace_adoption`, `register_adoption_protocol` |
| `staged_entry_mismatch` | A batch reused a `source_key` with different content | `stage_adoption_entries` |
| `staging_incomplete` | Staged entry count ≠ registered source-key count (Decision G.1's completeness check) | `analyze_adoption` |
| `conflicts_unresolved` | `finalize_adoption` attempted while the frozen analysis is `conflicts_present` | `finalize_adoption` |
| `analysis_fingerprint_mismatch` | `finalize_adoption` attempted while the frozen analysis is `fingerprint_mismatch` — **distinct from, and never spelled the same as,** `analyze_adoption`'s own `analysisStatus: "fingerprint_mismatch"` envelope value (L.1) | `finalize_adoption` |
| `analysis_validation_failed` | `finalize_adoption` attempted while the frozen analysis is `validation_failed` — same distinction as above | `finalize_adoption` |
| `conflict_already_resolved` | A resolution conflicts with an already-different decision — the **one** place this code is used, never folded into `invalid_transition` | `resolve_adoption_conflicts` |
| `revision_mismatch` | `expected_analysis_revision` (or expected `authority_revision`) doesn't match current | `analyze_adoption`, `resolve_adoption_conflicts`, `finalize_adoption` |
| `already_committed` | Run already `committed` | `finalize_adoption`, `abort_adoption`, `begin_adoption` (a same-token, same-input retry whose run has since been finalized by a separate call, Decision H.1), `resolve_adoption_conflicts` (Decision G.2: the run itself is no longer `prepared`, checked before the analysis's own status), `stage_adoption_entries` (Decision F.1, corrected to match — the identical underlying condition every run-scoped mutating function names the same way, Task 11) |
| `already_aborted` | Run already `aborted` | `abort_adoption`, `finalize_adoption`, `abort_and_replace_adoption`, `begin_adoption` (a same-token, same-input retry whose run has since been aborted or superseded, Decision H.1), `resolve_adoption_conflicts` (Decision G.2, same reason as `already_committed` above), `analyze_adoption` (Decision G.1: no analysis row exists yet, and the run was aborted before `analyze_adoption` was ever called), `stage_adoption_entries` (Decision F.1, corrected, same reason as `already_committed` above) |
| `invalid_transition` | A state-machine violation not covered by a more specific code above: (a) a `resolve_adoption_conflicts` call against an analysis whose `status` is `fingerprint_mismatch`/`validation_failed` — no conflict rows were ever created for it (Decision G.2); (b) a protocol-status request out of the linear order; (c) a `pilot`/`production` request while another version of the same domain already holds one of those statuses. **Never** the case where a run's own `status` is no longer `prepared`, for **any** run-scoped mutating function (`stage_adoption_entries`, `resolve_adoption_conflicts`, `finalize_adoption`) — that is always `already_committed`/`already_aborted` (Task 11's cross-function consistency correction; the prior revision used `invalid_transition` for `stage_adoption_entries`'s own version of this identical condition, inconsistently with the other two). **Never** the case where no `adoption_analyses` row exists at all for the requested revision — that is always `revision_mismatch` (Decision G.2/G.3). **Never** a `stage_adoption_entries` call against a merely-`analysis_frozen` (but still `prepared`) run — that is `staged`/`staged_entry_mismatch`/`internal_failure` (Decision F.1). **Never** a `resolve_adoption_conflicts` call against an already-`ready` analysis — that is `resolved`/`conflict_already_resolved` (Decision G.2), a compare-not-reject retry, not a state-machine violation. **`finalize_adoption` never produces `invalid_transition` at all** — every one of its own precondition failures has a more specific name (`already_committed`/`already_aborted`/`revision_mismatch`/`conflicts_unresolved`/`analysis_fingerprint_mismatch`/`analysis_validation_failed`, Decision G.3), by design, since finalize's failure surface is fully enumerated by more specific codes with no residual case | `resolve_adoption_conflicts`, `transition_adoption_protocol_status` |
| `malformed_request` | The **RPC's own input shape** is invalid (a non-canonical hex string, an internally duplicated batch key/position, an unregistered `source_key`, a wrong-typed parameter, a non-contiguous/duplicate/null-containing registration key list, an unvalidatable JSON Schema, an unrecognized `new_status` value) — never staged content | `begin_adoption`, `stage_adoption_entries`, `resolve_adoption_conflicts`, `register_adoption_protocol`, `transition_adoption_protocol_status` |
| `integrity_failure` | A structurally-should-be-impossible state observed (canonical collision mismatch, a digest/exclusion-status disagreement, an FK invariant somehow violated, a backfill-complete domain with no authority row) — always manual-review | `finalize_adoption` (including the new canonical-candidate rehash and classification re-evaluation, Decision G.3 steps 1/4), `query_account_domain_authority` (Decision H.6b: `backfilled_at IS NOT NULL` but no authority row exists), `begin_adoption` (Decision H.1, Task 3.2: identical underlying condition) |
| `representability_contract_unresolved` | A `design_only → pilot` transition was requested — refused unconditionally, regardless of every other precondition, until a later ADR resolves Decision E.2b's `jsonb`-representability blocker | `transition_adoption_protocol_status` (`→ pilot` target only) |
| `internal_failure` | An unexpected, uncategorized exception (Decision I's catch-all) | Any function |

**L.3a Terminal-state cross-reference matrix — the four run-scoped, analysis-lifecycle
functions, side by side, across the same eight conditions, so each function's own
divergence is explicit and auditable rather than left implicit across scattered
prose.** `stage_adoption_entries`, `resolve_adoption_conflicts`, and `finalize_adoption`
are **deliberately not identical** here (each has its own additional conditions the
others don't share — staging-freeze retries, analysis-status branches, digest/exclusion
revalidation) — this matrix exists precisely so that divergence is a visible, checked
fact, not an unstated assumption in either direction:

| Condition | `stage_adoption_entries` | `analyze_adoption` | `resolve_adoption_conflicts` | `finalize_adoption` |
|---|---|---|---|---|
| Run missing / not caller's | `not_found` | `not_found` | `not_found` | `not_found` |
| Run `prepared`, ordinary case | `staged` (insert missing subset, Decision F.1) | `{outcome: "analyzed", ...}` (Decision G.1) | `resolved` (Decision G.2) | `committed` (Decision G.3) |
| Run `status = 'committed'` | `already_committed` | N/A — structurally unreachable; a committed run always already has an analysis row, so this falls into the "pure read" case above instead | `already_committed` | `already_committed` |
| Run `status = 'aborted'` | `already_aborted` | `already_aborted` (only reachable when no analysis row exists yet) | `already_aborted` | `already_aborted` |
| Analysis `status = 'ready'` | N/A — this axis does not apply; staging is independent of analysis status | N/A — a second call is a pure read regardless of analysis status | exact-set retry: `resolved` or `conflict_already_resolved`/`malformed_request` (Decision G.2) | proceeds to promotion (Decision G.3 step 7) |
| Stale/wrong revision | N/A — no revision parameter | `revision_mismatch` (`expected_authority_revision`) | `revision_mismatch` (no `adoption_analyses` row at the given `analysis_revision`) | `revision_mismatch` (same reason) |
| Exact idempotent retry (input matches durable state) | `staged`, no mutation (byte-identical batch, frozen or not, Decision F.1) | pure read of the existing row (Decision G.1) | `resolved`, no mutation (Decision G.2) | `committed` outcome already reflected via `already_committed` above — a second `finalize_adoption` call never re-promotes |
| Conflicting retry (input disagrees with durable state) | `staged_entry_mismatch` (Decision F.1) | N/A — no retry input to disagree with; every call either creates the one analysis or reads it | `conflict_already_resolved` (differing decision) or `malformed_request` (unknown conflict) (Decision G.2) | N/A — `finalize_adoption` takes no content to disagree with beyond `expected_analysis_revision` (`revision_mismatch`, above) |

**L.4 Client/transport/decoding outcomes** (unchanged categorically, kept structurally
separate from L.1-L.3): `network_unavailable`, `query_failed`,
`session_resolution_failed`, `malformed_response`, `unsupported_server_protocol`. Every
one of these five, plus this document's own `not_found`/`unauthenticated` (L.3), has an
exact, one-to-one mapping onto ADR-0019's `AdoptionRunQueryOutcome` — the complete
seven-row table is given at Decision N.1 (Task 6), never left partially mapped.

**Per-operation, context-dependent interpretation of `already_committed`/
`already_aborted`** (unchanged from the prior revision): success-equivalent when
returned by the operation whose own goal that terminal state represents
(`finalize_adoption` → `already_committed`; `abort_adoption` → `already_aborted`); not a
success when returned by the *other* operation (an `abort_adoption` that finds
`already_committed` did not achieve its own goal).

**Query result shapes, defined exactly, not merely "row + candidates" — including the
two RPCs the prior revision left only referenced, not specified
(`query_adoption_run`/`query_account_domain_authority`):**

```json
// query_adoption_run(adoption_run_id) — success:
{
  "run": {
    "id": string,
    "domain": string,
    "protocolVersion": integer,
    "status": "prepared" | "committed" | "aborted",
    "analysisFrozen": boolean,
    "sourceFingerprint": string,
    "committedAt": string | null,
    "abortedAt": string | null,
    "abortReason": string | null,
    "supersededByRunId": string | null,
    "promotedEntityCount": integer | null
  }
}
// or a failure: { "outcome": "unauthenticated" | "not_found" | "internal_failure" }
```

This is the concrete realization of ADR-0019's `AdoptionRun`/`AdoptionRunQueryOutcome`
models (ADR-0019 §"The `AdoptionRun`" and "`AdoptionRunQueryOutcome`" — that document
explicitly defers the concrete schema to this one). The mapping from ADR-0019's
seven-outcome query model onto this document's own L.3/L.4 codes is exact, not
left implicit (the full one-to-one table is given below, at the `not_found`/
`server_run_missing` clarification): ADR-0019's `prepared`/`committed`/`aborted` are
this `run.status` field above (a successful query, regardless of which status it
reports — the same "outcome vs. data" separation as L.1's `analyze_adoption`
envelope); `server_run_missing` is this document's `not_found`, `authorization_failed`
is this document's `unauthenticated`, and `query_failed`/`malformed_response` name the
identical outcome in both documents — every one of these four is an exact,
one-to-one, never-ambiguous correspondence, not a case a client must guess at.

```json
// query_account_domain_authority(domain) — success:
{
  "authority": {
    "domain": string,
    "authorityStatus": "not_initialized" | "adoption_prepared" | "cloud_authoritative" | "aborted",
    "authorityRevision": string,
    "adoptionRunId": string | null,
    "lastAdoptionRunId": string | null
  }
}
// or a failure: { "outcome": "unauthenticated" | "account_not_bootstrapped" | "domain_not_eligible" | "domain_backfill_incomplete" | "integrity_failure" | "internal_failure" }
```

**Corrected: `legacy_active` removed from `authorityStatus` — it was never a server
value in the first place.** `private.account_domain_authorities.authority_status`
(Decision E.5) only ever holds `not_initialized`/`adoption_prepared`/
`cloud_authoritative`/`aborted` — its own `CHECK` constraint enforces exactly those
four values, no fifth. `legacy_active` is ADR-0019's own client-side
`LocalGenerationState`/local-authority concept (this device still using local Role A
storage, never having begun cloud adoption) — a fact the **client** derives locally, by
the **absence** of any server-side adoption activity for the domain, never a value this
RPC or this table can return. Conflating the two in one server-side enum was a category
error, corrected by removing it here entirely; N.1's truth table (Decision N) keeps
`legacy_active` only in cells describing client-observable local state, never inside
this RPC's own `authorityStatus` value.

**Corrected: `authorityRevision` is a `string`, not an `integer` — Task 4's
bigint-safe-transport correction.** `authority_revision` is declared `bigint` (Decision
E.5); a JavaScript/TypeScript `number` cannot represent every `bigint` value exactly
(`Number.MAX_SAFE_INTEGER` is 2^53-1, far below `bigint`'s range), so this envelope
transports it the same way ADR-0019 already does — as a decimal string — everywhere it
crosses the JS boundary: this envelope, `analyze_adoption`'s own `expected_authority_
revision` input (Decision G.1 — **corrected, Task 7.3: this parameter belongs to
`analyze_adoption`, never `begin_adoption`**, which accepts no revision parameter at
all), and every state-table/scenario reference to it. **This is the
opposite correction from `analysisRevision` (L.1), and the distinction is exact,
proven by the two columns' own declared PostgreSQL types and range bounds — never a
"realistic usage estimate" (Task 7.4 corrects that framing wherever it appeared):**
`adoption_analyses.analysis_revision` (Decision E.11) is declared a plain PostgreSQL
`integer`, whose type range is exactly `-2147483648` to `2147483647` (a fixed 4-byte
signed bound, true of every `integer` column regardless of how this one is actually
used) — and `2147483647` is itself far below `Number.MAX_SAFE_INTEGER`
(`2^53 - 1 = 9007199254740991`). **Every possible value this column's type could ever
hold is therefore safely representable as a JS `number`, by the type bound alone** —
not because `analysis_revision` happens to increment slowly (at most once per
`analyze_adoption` call on one run), which is a separate, true, but unnecessary
observation this document no longer needs to lean on for the safety argument itself. A
`bigint`-typed column has no comparably low bound (`authority_revision` increments on
every `begin_adoption`/`finalize_adoption`/`abort_adoption` transition across a
domain's entire lifetime, Decision H.7, and `bigint`'s own range,
`-2^63` to `2^63 - 1`, extends far past `Number.MAX_SAFE_INTEGER`) and must be
transported as a string; an `integer`-typed column's range is unconditionally safe as a
number. This document does not use "string" or "integer" for a revision field
arbitrarily anywhere else — each follows this same type-range rule, not a usage
estimate.

**Corrected: `adoptionRunId`/`lastAdoptionRunId`, not `preparedRunId`/`committedRunId`
— matching Decision E.5's actual column names exactly**, since a `preparedRunId`/
`committedRunId` pair would have to be exclusive (only one of the two ever populated,
depending on `authorityStatus`) whereas `adoption_run_id`/`last_adoption_run_id` are
two independent columns with different lifetimes (Decision E.5): `adoptionRunId` is the
run this authority **currently** reflects (`NULL` while `not_initialized`/`aborted`);
`lastAdoptionRunId` is the most recent **terminal** (committed or aborted) run this pair
has ever produced, retained even after `adoptionRunId` is cleared back to `NULL`.

**Corrected: five distinct failure outcomes, not one.** The prior revision collapsed
"no account bootstrap yet," "domain not eligible," "eligible but not backfilled," and "a
genuine integrity failure" into the single code `domain_backfill_incomplete` — Decision
H.6b's six-branch algorithm now produces the distinct code each case actually needs
(`account_not_bootstrapped`, `domain_not_eligible`, `domain_backfill_incomplete`,
`integrity_failure`), alongside `unauthenticated`/`internal_failure`. **Still no
`not_found` variant** — every "no row" cause has a more specific code above; a bare
`not_found` would re-introduce exactly the ambiguity this correction removes.

```json
// query_adoption_analysis(adoption_run_id) — success:
{
  "analysis": {
    "analysisRevision": 1,
    "status": "ready" | "conflicts_present" | "fingerprint_mismatch" | "validation_failed",
    "fingerprintMatch": boolean,
    "parsedEntityCount": integer | null,
    "conflictCount": integer,
    "documentValidationCode": string | null,
    "validationDetail": object,
    "analysisDigest": string,
    "resolutionDigest": string | null
  },
  "candidates": [
    {
      "candidateOrdinal": integer,
      "entityKey": string,
      "contentDigest": string,
      "validationStatus": "valid" | "invalid",
      "validationDetail": object,
      "duplicateGroupKey": string | null,
      "initialExclusionStatus": "pending" | "selected" | "excluded_duplicate" | "excluded_invalid",
        -- the IMMUTABLE classification analyze_adoption assigned at creation (Decision
        -- E.11/Task 1.1) -- never changes, exposed so a client can distinguish "how
        -- this candidate was originally classified" from "its current state" below
      "exclusionStatus": "pending" | "selected" | "excluded_duplicate" | "excluded_invalid",
      "canonicalCandidate": JSON value (object, for every `valid` candidate — Decision
        E.11/Task 14: `canonical_entity_schema` requires `type: object` for this
        domain's entities, so a `valid` candidate is always an object; an `invalid`
        candidate's `canonicalCandidate` is whatever was actually extracted, which may
        legally be any JSON type at all — a bare string, number, array, or `null` — if
        the source document was malformed enough to produce one; this field is never
        narrowed to `object` for that reason)
    }
  ]
}
// or a failure: { "outcome": "unauthenticated" | "not_found" | "internal_failure" }

// query_adoption_conflicts(adoption_run_id) — success:
{
  "conflicts": [
    {
      "duplicateGroupKey": string,
      "conflictType": "intra_run_duplicate_id_different_content",
      "decision": "select_candidate_ordinal" | "exclude_duplicate_group" | null,
      "selectedCandidateOrdinal": integer | null
    }
  ]
}
// or a failure: { "outcome": "unauthenticated" | "not_found" | "internal_failure" }
```

**Corrected: `query_adoption_analysis` exposes `canonical_candidate` directly, as
`canonicalCandidate` on each candidate.** The prior revision withheld it from this
shape and instead referred to "whatever client-side data-fetching the implementation
stage chooses" through "a future unspecified fetch mechanism" — no such mechanism, RPC,
or client-side data-fetching path exists anywhere else in this document, and a
conflict-resolution UI has no way to render what it is asking the user to choose
between without the actual candidate content. This RPC is the **only** read path for
`canonical_candidate` (`private.adoption_analysis_candidates` is unreachable directly,
Decision K.1/K.16), so it must return the field itself. **Typed as a general JSON
value, not narrowed to `object`** (corrected, Task 14) — for a `valid` candidate it is
always an object (`canonical_entity_schema` requires `type: object` for this domain),
but an `invalid` candidate's value is whatever was actually extracted from a possibly
malformed document, which may legally be any JSON type; this ADR does not constrain its
internal structure beyond what `canonical_entity_schema` itself checks, the same way
`validationDetail`'s structure is left to the calling code, not fixed by this document.

### M. Complete RPC inventory — normative signatures, locks, idempotency, results — a
schema contract, not a claim of assembled, executed migration code

Every signature below is exact and schema-qualified (as declared, each lives in
`public`); it matches Decision K.9's `GRANT EXECUTE` statements one-to-one. `entries`/
`resolutions`/source-key lists are `jsonb` arrays with the exact per-element shape
named in Decision F.1/B (staging), Decision G.2 (resolutions), and Decision K.6
(registration source keys) — no unknown field is permitted in any element (checked by
comparing each element's own key set against the exact required set); batch element
count and maximum decoded value size are bounded by an operationally-configured limit
(Decision F.1, deliberately left to implementation, not invented here); duplicate
detection within a batch is named explicitly per function below.

| RPC (exact signature) | Caller | Locks | Idempotent? | Possible results (L.1-L.4) |
|---|---|---|---|---|
| `bootstrap_account()` | `authenticated` | global `bootstrap_backfill_serialization` advisory lock (Decision H.8), shared with `backfill_domain_authority` | Yes — `ON CONFLICT DO NOTHING` throughout | `ok`, `unauthenticated`, `internal_failure` |
| `begin_adoption(domain text, protocol_version integer, source_entry_count integer, source_fingerprint text, client_request_id uuid)` | `authenticated` | authority row `FOR UPDATE` if found; else the global `bootstrap_backfill_serialization` lock, then a re-attempt at the row lock (Decision H.1, Task 2) | Yes — concurrency-correct (Decision H.1), including a retry after the token's own run has since committed or aborted | `prepared`, `unauthenticated`, `account_not_bootstrapped`, `domain_not_eligible`, `domain_backfill_incomplete`, `integrity_failure` (no authority row despite complete backfill, re-confirmed under the global lock), `authority_state_mismatch`, `adoption_in_progress`, `idempotency_mismatch`, `already_committed`, `already_aborted`, `malformed_request`, `internal_failure` |
| `stage_adoption_entries(adoption_run_id uuid, entries jsonb)` — each element `{sourceKey, sourcePosition, sourceValueIsNull, sourceValueHex}` (Decision B); no two elements may share `sourceKey` or `sourcePosition` | `authenticated`, owner | Global Lock Order | Yes — whole-batch compare-then-classify (Decision F.1); a frozen-run retry is a compare-not-mutate check, never a terminal-state error | `staged`, `unauthenticated`, `already_committed`, `already_aborted`, `malformed_request`, `staged_entry_mismatch`, `not_found`, `internal_failure` |
| `analyze_adoption(adoption_run_id uuid, expected_authority_revision text)` | `authenticated`, owner | Global Lock Order | Yes — a second call is a pure read regardless of run status, since a committed run always already has an analysis row (Decision G.1) | `{outcome: "analyzed", analysisStatus, analysisRevision}` (L.1), `unauthenticated`, `already_aborted` (no analysis row exists yet, and the run was aborted before one could be created), `staging_incomplete`, `revision_mismatch`, `not_found`, `internal_failure` |
| `query_adoption_analysis(adoption_run_id uuid)` | `authenticated`, owner | none — read-only (Decision H.6a) | N/A (pure read) | analysis + candidates shape (L.3 note), `unauthenticated`, `not_found`, `internal_failure` |
| `query_adoption_conflicts(adoption_run_id uuid)` | `authenticated`, owner | none — read-only (Decision H.6a) | N/A | conflicts shape (L.3 note), `unauthenticated`, `not_found`, `internal_failure` |
| `resolve_adoption_conflicts(adoption_run_id uuid, analysis_revision integer, resolutions jsonb)` — each element `{duplicateGroupKey, decision, selectedCandidateOrdinal}`; no two elements may share `duplicateGroupKey` | `authenticated`, owner | Global Lock Order | Yes — whole-batch prevalidate (Decision G.2); a `ready`-state retry requires an exact, complete match, never a vacuous partial one | `resolved`, `unauthenticated`, `already_committed`, `already_aborted`, `conflict_already_resolved`, `malformed_request`, `revision_mismatch`, `invalid_transition`, `not_found`, `internal_failure` |
| `finalize_adoption(adoption_run_id uuid, expected_analysis_revision integer)` | `authenticated`, owner | Global Lock Order | Yes — no-op success on retry (Decision G.3) | `committed`, `unauthenticated`, `already_committed`, `already_aborted`, `revision_mismatch`, `conflicts_unresolved`, `analysis_fingerprint_mismatch`, `analysis_validation_failed`, `integrity_failure`, `not_found`, `internal_failure` |
| `query_adoption_run(adoption_run_id uuid)` | `authenticated`, owner | none — read-only (Decision H.6a) | N/A | run envelope (L.4's concrete `AdoptionRun`/`AdoptionRunQueryOutcome` realization), `unauthenticated`, `not_found`, `internal_failure` |
| `query_account_domain_authority(domain text)` | `authenticated` | none — read-only, one single-statement CTE query under one MVCC snapshot (Decision H.6b, Task 3, not Global Lock Order) | N/A | authority envelope (L.4), `unauthenticated`, `account_not_bootstrapped`, `domain_not_eligible`, `domain_backfill_incomplete`, `integrity_failure` (only from the one-snapshot query, never a transient mixed-time artifact), `internal_failure` |
| `abort_adoption(adoption_run_id uuid, abort_reason text)` | `authenticated`, owner | Global Lock Order | Yes — no-op on retry | `aborted`, `unauthenticated`, `already_committed`, `already_aborted`, `not_found`, `internal_failure` |
| `abort_and_replace_adoption(stale_run_id uuid, protocol_version integer, source_entry_count integer, source_fingerprint text, client_request_id uuid)` | `authenticated`, owner | Global Lock Order | Yes — Decision H.3 | `replaced`, `unauthenticated`, `idempotency_mismatch`, `already_aborted`, `already_committed`, `not_found`, `internal_failure` |
| `delete_assessment_history_run(assessment_run_id uuid)` | `authenticated`, owner | Global Lock Order (adapted: locks the `assessment_runs` row) | Yes — `ON CONFLICT DO NOTHING` | `deleted`, `unauthenticated`, `not_found`, `internal_failure` |
| `register_adoption_protocol(domain text, protocol_version integer, fingerprint_version text, source_contract_version integer, canonical_mapping_version integer, source_keys jsonb, source_document_schema jsonb, canonical_entity_schema jsonb)` — `source_keys` elements `{sourcePosition, sourceKey}`, no duplicate position/key | `service_role` | advisory transaction lock keyed by `(domain, protocol_version)` (Decision K.6) | Yes — Decision K.6's full prevalidate-then-lock-then-compare sequence | `registered`, `already_registered`, `not_found` (unregistered `domain`), `malformed_request`, `idempotency_mismatch`, `internal_failure` |
| `transition_adoption_protocol_status(domain text, protocol_version integer, new_status text)` | `service_role` | domain-scoped advisory lock (Decision K.6), then the protocol row `FOR UPDATE` | Yes — re-requesting the protocol's own current status returns `transitioned`, no mutation (Decision K.6) | `transitioned`, `representability_contract_unresolved` (any genuine `→ pilot` attempt — checked immediately, before schema/mapping/backfill/one-active-version, Decision E.2b/K.6/Task 5), `invalid_transition`, `malformed_request`, `not_found`, `internal_failure` |
| `backfill_domain_authority(domain text, protocol_version integer)` | `service_role` | global `bootstrap_backfill_serialization` advisory lock (Decision H.8/K.6), shared with `bootstrap_account` | Yes — repeat and post-transition calls are both legitimate no-ops beyond newly-covered profiles (Decision K.6) | `backfilled`, `not_found` (no such `(domain, protocol_version)`), `internal_failure` |

**Sixteen functions total** (thirteen `authenticated`, three `service_role`) — matches
Decision K.6's recount exactly; regenerated against this section's own final list after
the L/M taxonomy correction, unchanged in count from the prior revision.

**H.8 `bootstrap_account()` — corrected to close a real MVCC race with
`backfill_domain_authority` (Decision K.6), not merely restated.**

**⚠ BLOCKED (identity/authority-scope AND Profile/Athlete bootstrap — see Status).**
Two independent problems, both unresolved as written: (1) the `profiles`/`athletes`
`INSERT ... ON CONFLICT DO NOTHING` below must not unconditionally create an
`athletes` row (ADR-0022 Decision 10: Athlete is separate, lazy, optional) and must
create its `profiles` row through the real `account_profile_links` model (Decision
E.3 above), not by inserting `profiles` keyed directly by `auth.uid()`; (2) the
authority-row `INSERT` below uses `account_scope_id = auth.uid()`, which is only one
of two candidate scopes this document uses inconsistently elsewhere (see Decision
E.9's `fk_athlete` for the Profile-scoped alternative) — the locking/serialization
design (the advisory lock, its ordering guarantees) remains valid and independent
of which scope is eventually chosen, but the concrete `INSERT` statements below are
not implementation-ready.

**The defect, stated precisely.** The prior revision's `bootstrap_account` inserted
authority rows only for domains with `activation_status IN ('pilot', 'production')` —
but `backfill_domain_authority` (Decision K.6) is required to run, and complete, **while
the protocol is still `design_only`** (Decision E.2). Under PostgreSQL's ordinary MVCC
snapshot semantics, with no lock connecting the two functions at all, a genuinely
concurrent, unserialized pair of calls could interleave so that: `backfill_domain_
authority('X', 1)` takes its profile snapshot, observes completeness, and commits
`backfilled_at`; a **new** profile is created by its own `bootstrap_account()` call
**after** that snapshot but **before** domain `X`'s protocol later transitions to
`pilot`; because `X` was still `design_only` at the moment that profile's
`bootstrap_account()` ran, the prior revision's own domain filter (`activation_status
IN ('pilot', 'production')`) skipped it — and nothing forced anyone to re-run
`backfill_domain_authority` before the later `pilot` transition. The count-only
completeness proof the prior revision relied on was therefore true only **at the
instant it was checked**, never proven to remain true through the transition that
actually depends on it.

**The corrected, serialized design.** Both `bootstrap_account` and
`backfill_domain_authority` now acquire **one single, fixed, global advisory lock**
before doing anything else:

```sql
perform pg_catalog.pg_advisory_xact_lock(pg_catalog.hashtext('bootstrap_backfill_serialization'));
```

— a transaction-scoped lock, released automatically at commit or rollback, held for
the **entire** remainder of each function's transaction. This is deliberately a single
**global** key, not a per-domain one: `bootstrap_account` must consider **every**
domain with any backfilled protocol version at once (below), so a per-domain lock
could not, by itself, serialize it against a concurrent backfill of a domain it has not
even looked at yet. The correctness cost of this choice is coarser concurrency
(`bootstrap_account`/`backfill_domain_authority` calls for **unrelated** domains now
also serialize against each other) — accepted deliberately, since both are
infrequent, administrative/account-lifecycle operations, never on any hot request path
(Decision H.1's `begin_adoption`/Global Lock Order and the domain-scoped
`register_adoption_protocol`/`transition_adoption_protocol_status` locks are entirely
separate lock keys/types, never acquired inside the same transaction as this one, so
there is no cross-lock-type nesting and no new deadlock surface between them).

`bootstrap_account()` — one transaction, in this order: acquire the lock above;
`INSERT` `profiles`/`athletes` `ON CONFLICT DO NOTHING`; then:

```sql
insert into private.account_domain_authorities
  (account_scope_id, domain, authority_status, authority_revision)
select auth.uid(), d.domain, 'not_initialized', 0
from (
  select distinct domain
  from private.adoption_protocols
  where backfilled_at is not null
) d
on conflict (account_scope_id, domain) do nothing;
```

**Corrected: every domain with `backfilled_at IS NOT NULL` for any protocol
version, not only `activation_status IN ('pilot', 'production')`.** This is the second
half of the fix — a domain still `design_only` but already backfilled is exactly the
case the defect above left uncovered, and this is what closes it. **`SELECT DISTINCT
domain`, not a bare join** (Task 2 point 5) — **corrected (Task 7): not because a bare
join would raise an error.** PostgreSQL's cardinality-violation restriction ("the
command will not be allowed to affect any single existing row more than once")
confirmed, Appendix, applies specifically to `ON CONFLICT ... DO UPDATE`; `ON CONFLICT
DO NOTHING` — what this design actually uses throughout — carries no such
restriction, and safely skips a later row from the same statement's own source that
conflicts with one already processed, without raising anything. A bare join (two
different protocol versions of the same domain both having `backfilled_at IS NOT
NULL`, an old retired version and a newer one, for instance) would therefore **not**
error here — it would execute, with the second duplicate `(account_scope_id, domain)`
row source harmlessly skipped by `DO NOTHING`. `SELECT DISTINCT domain` is used anyway,
for two reasons that do not depend on preventing an error `DO NOTHING` was never going
to raise: **explicit set semantics** (the target set is genuinely "every distinct
domain," not "every protocol-version row," and the query should say so directly rather
than relying on `ON CONFLICT` to paper over a looser one), and **avoiding redundant
work** (a bare join would still construct and attempt a source row per protocol
version, doing needless duplicate work `DO NOTHING` then discards, rather than never
constructing the duplicates in the first place). Today this still inserts **zero**
rows (Decision D: no domain has ever been
backfilled), by design. Explicit, idempotent RPC over an `auth.users` trigger, because
— confirmed (Appendix) — "if the trigger fails, it could block signups."

**The exact serialization proof.** Because both functions acquire the identical lock
key before either reads or writes anything relevant, and hold it until their own
commit, at most one of `bootstrap_account`/`backfill_domain_authority` — for **any**
account or domain — executes at a time, system-wide. Take any profile `P` and any
domain `X` that is ever backfilled (`backfilled_at` set at some commit
`T_backfill`). Exactly one of two orderings is possible for `P`'s own
`bootstrap_account()` call, relative to `T_backfill`, because the lock forces one to
fully commit before the other's lock-protected statements run:
1. **`P`'s `bootstrap_account()` acquires the lock, and its own read of `private.
   adoption_protocols` happens, strictly before `T_backfill`.** At that moment,
   `backfilled_at` for `X` is not yet set, so this call correctly does not (and should
   not) insert an authority row for `X` on `P`'s behalf — but `backfill_domain_
   authority('X', ...)`'s own `INSERT ... SELECT` (Decision K.6), which acquires the
   same lock **after** `P`'s bootstrap call has released it (committed), now sees `P`
   in `public.profiles` (bootstrap already committed it) and inserts `P`'s authority
   row for `X` directly.
2. **`P`'s `bootstrap_account()` acquires the lock strictly after `T_backfill`.** Its
   own read of `private.adoption_protocols` (inside the same, now-lock-protected
   transaction) sees `backfilled_at IS NOT NULL` for `X` — because the backfill
   transaction fully committed and released the lock before this call's statements
   ran — and this call's own corrected domain filter (`backfilled_at IS NOT NULL`, not
   `activation_status IN (...)`) inserts `P`'s authority row for `X` directly.
There is no third ordering the lock permits — a bootstrap call cannot read `private.
adoption_protocols` "concurrently, mid-backfill-transaction," because the backfill
transaction holds the lock for its entire duration, and no other call reaches its own
lock-protected reads until that lock is released at commit. **No profile can ever
reach domain `X`'s eventual `pilot` transition without an authority row for `X`.**

### N. Corrected state, crash, and threat tables

**⚠ BLOCKED (identity/authority-scope — see Status).** Every "Authority scope" cell
below, and every `bootstrap_account()`/`backfill_domain_authority()` recovery-action
cell, inherits the open `account_scope_id` question — these tables describe the
row/lock structure correctly, but the concrete identity each row keys on is not yet
decided.

**N.1 State table.** Every row names exactly one authority scope, one readable/writable
backend, local-data visibility, and one required recovery action. **Every cell below
names a concrete backend or a concrete, named absence of one — no cell reads "none
new," "read that row," or any other placeholder standing in for an unspecified value.**

**"Writable backend" is defined once, precisely, and applied consistently: it means
"where this domain's own canonical data may be durably written" — `localStorage`
(Role A) or the server's canonical `assessment_runs` row — never "whether any
`SECURITY DEFINER` function may write any row at all."** This distinction matters
because several rows below (`fingerprint_mismatch`/`validation_failed`/
`conflicts_present`) say the writable backend is "none" — that is a claim about
*canonical domain data* only. `resolve_adoption_conflicts` **does** write, in the
`conflicts_present` row's own state (Decision G.2: `decision`/`selected_candidate_ordinal`/
`exclusion_status`) — that is a protocol/analysis-state write, a different thing this
column is not describing, and is called out explicitly in that row's own cell rather
than left to look contradicted by the "none" above it.

| State | Authority scope | Readable backend | Writable backend (canonical domain data only) | Local data | Recovery/action |
|---|---|---|---|---|---|
| No profile/bootstrap yet | authenticated, no server registry rows for this account | Role A (local) — server-side bootstrap status is irrelevant to local access; **nothing about this state blocks the client's own local storage** | Role A (local) | visible, writable | Call `bootstrap_account()` (required before this domain can ever become cloud-eligible for this account, but not required for ordinary local-only use today) |
| Local authority before adoption | `not_initialized`/`aborted` (server), `legacy_active` (client-observed local-generation concept, ADR-0019 — never a value `authority_status` itself holds, Decision H.6b) | Role A (local) | Role A (local) | visible, writable | none — ordinary use |
| Staging (`prepared`, `analysis_frozen=false`) | `adoption_prepared` | Role A quarantined (ADR-0019 fence) | server staging table only (not yet canonical domain data — nothing is promoted until `finalize_adoption`) | quarantined | continue `stage_adoption_entries` |
| Analyzed — `fingerprint_mismatch` | `adoption_prepared` | server staging table only; analysis row readable via `query_adoption_analysis` | none (finalize refuses; no canonical domain-data write is reachable from this state) | quarantined | client must resolve the manifest/content mismatch — abort and restart adoption; no repair path exists for a lying manifest |
| Analyzed — `validation_failed` | `adoption_prepared` | server staging + analysis rows readable | none (finalize refuses; same scope as above) | quarantined | client must correct or escalate the malformed source document; abort and restart, or await a migration fix |
| Analyzed — `conflicts_present` | `adoption_prepared` | server staging + analysis + conflict rows readable via `query_adoption_conflicts` | none, for canonical domain data (finalize refuses) — **but `resolve_adoption_conflicts` does write protocol/analysis state from this exact row** (`decision`, `selected_candidate_ordinal`, each candidate's `exclusion_status`, Decision G.2) — a genuinely different write target than this column tracks, named here so it is never read as contradicting the "none" above | quarantined | call `resolve_adoption_conflicts` then `finalize_adoption` |
| Analyzed — `ready` | `adoption_prepared` | server staging + analysis rows readable | none yet, for canonical domain data | quarantined | call `finalize_adoption` |
| Prepared transition fence (client-side, ADR-0019, unchanged) | `adoption_prepared` | Role A quarantined | none | quarantined | client-side recovery per ADR-0019 Decision 5 |
| Server committed, local cleanup incomplete | `cloud_authoritative` | server canonical | server canonical | quarantined, catching up | client-side committed-fence catch-up (ADR-0019 Decision 5) |
| Cloud authoritative | `cloud_authoritative` | server canonical (RLS-gated) | server canonical (via functions only) | permanently quarantined | none — steady state |
| Aborted, no replacement | `aborted` | Role A (local) | Role A (local, `legacy_active`) | visible, writable | may `begin_adoption` again |
| Superseded — replacement `prepared` | `adoption_prepared` (via the replacement's own `id`) | server staging table for the **replacement** run | server staging table for the **replacement** run | quarantined | continue `stage_adoption_entries` on the replacement run's own `id` |
| Superseded — replacement `committed` | `cloud_authoritative` (via the replacement's own `id`) | server canonical (RLS-gated) | server canonical (via functions only) | permanently quarantined | none — steady state, identical to "Cloud authoritative" above, reached via the replacement |
| Superseded — replacement `aborted` | `aborted` (via the replacement's own `id`, or a further replacement if this one was itself superseded) | Role A (local) | Role A (local, `legacy_active`) | visible, writable | may `begin_adoption` again, or continue resolving via a further-superseding replacement if one exists |
| Superseded — replacement query returns `server_run_missing`** (split from `query_failed` below, per ADR-0019's own four-way distinct `AdoptionRunQueryOutcome`, never merged into one row) | `unavailable` — a definite, fail-closed corruption/data-loss signal (ADR-0019: "the record is missing after bootstrap should have created it, OR a referenced run the record names is unexpectedly missing") | none (fail closed) | none | blocked | manual review — this is a data-integrity signal, not a transient condition; retrying the same query will not resolve it |
| Superseded — replacement query returns `query_failed` (a transport-level failure — the request did not cleanly complete at all, ADR-0019 Decision 4) | `unavailable` — genuinely unknown, not asserted either way, because the query never definitively answered | none (fail closed) | none | blocked | retry `query_adoption_run` against the replacement's own `id`; a transient condition, unlike the row above |
| Retired protocol, run still `prepared` | `adoption_prepared` | server staging + analysis (unaffected by retirement, Decision E.2) | server staging/analysis, until finalize | quarantined | analysis/finalize proceed exactly as if not retired; only a **new** `begin_adoption` for this protocol is blocked |
| Server unreachable/unknown | `unavailable` | none (fail closed) | none | blocked | retry the query |
| Logged out | RLS denies all | none (RLS returns zero rows) | none | client-side evidence unaffected | re-authenticate |
| Account-local branch (ADR-0019, unchanged) | server `cloud_authoritative` for the domain | server canonical | server canonical | quarantined branch, read-only, export-pending | Branch Reconciliation (ADR-0019, unresolved blocker) |

**No row assigns two writable backends.**

**"Invalid local fence/archive" is removed as a single table row — corrected, per the
requirement that every row name exactly one authority scope, which a single row here
structurally cannot do.** The prior revision's row named its "authority scope" as
"whatever this account's server-side status already is" — not one deterministic state,
but a placeholder standing in for **any** of the rows above. This condition is a
genuinely separate, cross-cutting axis (a purely client-side, ADR-0019-governed
evidence-integrity fact about a locally-stored fence/archive artifact), not a
sub-state of server authority at all: it can only ever be evaluated by the client in
the two rows above where a client-side fence/archive is actually being read back —
**"Prepared transition fence"** and **"Server committed, local cleanup incomplete"**
(ADR-0019 Decision 5's recovery paths); it is not applicable to any other row in this
table, since no other row involves reading back local evidence at all. When it occurs,
in either of those two applicable rows: the **server**-side readable/writable
backend/authority scope for that row is completely unaffected (a client-side integrity
failure never changes or blocks any server-side transition); what changes is that the
**client's own** local-data column becomes `blocked (invalid_local_transition_evidence)`
instead of that row's own stated local-data value, and recovery becomes manual review
(ADR-0019, unresolved blocker) instead of that row's own stated recovery action. This
is deliberately documented as a modifier on those two specific rows, not as a
twentieth row of its own.

**`authorization_failed`/`malformed_response` (ADR-0019; Task 7.2), and every other
client-side L.4 outcome that maps onto one of them (Task 6's complete mapping table,
above), are cross-cutting, fail-closed modifiers on every row above, not rows of their
own.** Neither describes a server authority state at all — both are properties of a
**specific client request** that could interrupt a query against **any** row in this
table, not a distinct state this table's own `Authority scope` column could ever hold.
`authorization_failed` (this document's `unauthenticated`, Decision L.3 — and, per
Task 6's mapping, `session_resolution_failed`) means the session itself was rejected,
or could not even be resolved, before any authority state could ever be read —
applicable to every row, since a logged-out, invalid, or unresolvable session can
attempt to query any of them. `malformed_response` (Decision L.4 — and, per Task 6's
mapping, `unsupported_server_protocol`) means the response could not be decoded, or
named a protocol shape this client does not understand, once received — likewise
applicable regardless of which state the server actually returned. `query_failed`
(Decision L.4 — and, per Task 6's mapping, `network_unavailable`) means the request
never cleanly completed at all, for the same reason. All of these are always
fail-closed (never treated as any state's own success path) and never change what the
underlying server-side authority state actually is — they describe **why the client's
own view of it is temporarily unavailable**, not a competing server truth. This is the
same treatment already applied to the "invalid local fence" modifier above, extended
to these two client-transport outcomes for the same reason: table rows are for
authority *states*, not every possible way a request to observe one can fail.

**`not_found` (this document) vs. `server_run_missing` (ADR-0019) — an exact,
one-to-one mapping, not an ambiguity a client cannot resolve.** The prior revision's
own wording here was itself wrong, and is corrected (Task 7.1): it claimed a client
"cannot distinguish" a definite server `not_found` response from a network failure, and
that this supposed inability was *why* the two outcomes map together — but a
well-typed RPC client can, and must, tell these apart trivially (a completed call
carrying a typed `{"outcome": "not_found"}` payload is nothing like a request that
never completed at all), and ADR-0019's own `AdoptionRunQueryOutcome` is deliberately
**four separate, exactly-classified** outcomes for this reason, never a single bucket
standing in for "something went wrong, unclear what." The correct, exact mapping,
applied consistently everywhere in this document:

| This document (server-side, Decision L.3/L.4) | ADR-0019 (`AdoptionRunQueryOutcome`, client-side) |
|---|---|
| `not_found` (Decision L.3) — a **synchronous RPC result**: the caller reached the database, and the database determined the named resource does not exist (or is not theirs) | `server_run_missing` — the server gave a **definite** answer that the run does not exist (or is corrupted-absent, ADR-0019's own broader use of this term for the bootstrap-completeness case, Decision N.1) |
| `query_failed` (Decision L.4) — the request did not cleanly complete at all (network failure, timeout, connection reset) | `query_failed` — identical meaning, same name, both documents |
| `network_unavailable` (Decision L.4) — no network path to the server existed at all | `query_failed` — ADR-0019 does not name a separate "no network" case; both this and the row above are "the request did not cleanly complete," mapped to the same client-side outcome |
| `unauthenticated` (Decision L.3) — no valid session at the database | `authorization_failed` — the session was rejected or is invalid |
| `session_resolution_failed` (Decision L.4) — the client's own session-resolution step failed **before** a request even reached the database | `authorization_failed` — **corrected (Task 6): not `malformed_response`.** The prior revision's mapping merged this with `malformed_response` merely because both happen client-side, which is not a reason to conflate two outcomes with different causes and different remedies. `session_resolution_failed` is about *authorization*, not decoding — it belongs with `authorization_failed`, unless a later, separately designed session contract distinguishes it more precisely; this document does not invent that finer distinction here. |
| `malformed_response` (Decision L.4) — a response was received but could not be decoded | `malformed_response` — identical meaning |
| `unsupported_server_protocol` (Decision L.4) — the response decoded, but named a protocol version/shape this client does not understand | `malformed_response` — grouped with the row above because ADR-0019 does not name a separate pre-authority case for this; this document does not invent one either, and does not claim ADR-0019 draws this distinction where it does not |

Every one of these is a **distinct, exact** case — never two of them merged because a
client supposedly cannot tell them apart, and never merged with an unrelated case
merely because both happen to occur "client-side." `query_adoption_run` finding no
such row (or a row belonging to a different account) returns **this document's**
`not_found` (L.3), which a correctly-implemented client reports as ADR-0019's
`server_run_missing` directly, precisely because the server already gave a definite
answer — not because the client is guessing between possibilities it cannot
distinguish.

**N.2 Operation/crash table — every RPC's own atomicity boundary named exactly, no
blank cells.**

| Operation | Before | During (crash mid-operation) | After |
|---|---|---|---|
| `begin_adoption` | No run for this token | Multi-statement, but one transaction — a crash anywhere rolls back entirely; a retry either finds nothing (safe) or finds the just-committed row (idempotent, Decision H.1) | One `prepared` run; authority `adoption_prepared` |
| One `stage_adoption_entries` batch | Rows from **earlier, separately committed** batches durable | One transaction for the **whole batch** — a crash mid-batch rolls back every row this specific call attempted; **prior, already-completed batches remain durable and unaffected** | This batch's rows all staged, or none of them are |
| `analyze_adoption` | Run `prepared`, `analysis_frozen=false`, staging complete (Decision G.1's precondition) | The run-row lock (Global Lock Order) provides an **in-transaction logical freeze** the instant it is acquired — no concurrent mutation of this run's staged rows can interleave with this call's own read of them. **`analysis_frozen` becomes durably `true` only at `COMMIT`**, not at the moment the lock is taken — one transaction; a crash before commit rolls back the durable flag along with every `adoption_analyses`/candidate/conflict row, leaving `analysis_frozen=false` durably, exactly as if the call had never been attempted | Analysis, every candidate, every conflict, and `analysis_frozen=true` all exist together, or none of them do |
| One `resolve_adoption_conflicts` batch | Conflicts from this batch undecided; conflicts from **prior, separately completed** calls remain as they were | One transaction for the whole batch — a crash rolls back every decision this call attempted; **prior completed resolution calls remain durable** | This batch's decisions all recorded, or none of them are |
| `finalize_adoption` | Run `prepared`, analysis `ready`, conflicts decided | One transaction — a crash anywhere rolls back every promotion attempted; run stays `prepared` | Run `committed`, canonical rows visible, `promoted_entity_count` set |
| `abort_adoption` | Run `prepared` | One transaction — crash leaves run `prepared` | Run `aborted`, authority `aborted` |
| `abort_and_replace_adoption` | Stale run `prepared` | One transaction, exact statement order (Decision H.2) — crash leaves the stale run `prepared`, no replacement created; never a state with the stale run `aborted` but no successor | Stale run `aborted` with `superseded_by_run_id` set; exactly one new `prepared` replacement |
| `delete_assessment_history_run` | No tombstone | One transaction, single `INSERT ... ON CONFLICT DO NOTHING` | Tombstone exists; excluded from every owner read |
| Query RPCs (`query_adoption_run`, `query_account_domain_authority`, `query_adoption_analysis`, `query_adoption_conflicts`) | Before: whatever durable state already exists for the queried resource — unchanged by this row, since these functions never write | During a failure: no lock is held and no mutation is attempted, so there is nothing to roll back; the caller receives a transport/query failure (`query_failed`, Decision L.4) and the durable state is exactly as it was before the call | After a successful read: the durable state is **unchanged** by the read itself — the response simply reflects whatever it already was |
| `bootstrap_account` | No `profiles`/`athletes`/authority rows for this account, or a subset already inserted by a **prior, separately-committed** call (never by a prior crashed one — a crash leaves nothing behind, same reasoning as `backfill_domain_authority`, Decision K.6) | Acquires the global `bootstrap_backfill_serialization` lock first (Decision H.8) — released automatically on crash/rollback, same as any other advisory transaction lock, never left held; one transaction, every insert `ON CONFLICT DO NOTHING` — a crash rolls back only this call's own attempt in full; any row a **prior, separately committed** call already inserted remains durable and unaffected | `profiles`/`athletes` rows exist; one `not_initialized` authority row exists per domain with `backfilled_at IS NOT NULL` for any protocol version (Decision H.8, corrected — not only currently-`pilot`/`production` domains) — or, on this call's own crash, exactly whatever subset a previously **completed** call already produced, never a partial remnant of this specific call's own attempt |
| `register_adoption_protocol` | No `adoption_protocols`/`adoption_protocol_source_keys` rows for this `(domain, protocol_version)` | One transaction, guarded by the advisory lock (Decision K.6) — a crash before commit rolls back the entire registration, including every source-key row; the advisory lock itself is released automatically, never left held | Either the complete `adoption_protocols` row and its full source-key set exist together, or neither does |
| `transition_adoption_protocol_status` | Protocol at its current `activation_status` | One transaction, guarded by the domain-scoped advisory lock and the protocol row's own `FOR UPDATE` (Decision K.6) — a crash rolls back the entire status change; the row's `activation_status` is exactly as it was before the call | Protocol at the new `activation_status` (and, for `→ pilot`, `backfilled_at` already proven non-`NULL` beforehand — this function never sets it) — or, on crash, unchanged at its prior status |
| `backfill_domain_authority` | Some subset (possibly zero or all) of `public.profiles` rows already have a `not_initialized` authority row for this `domain`, entirely from **earlier, separately-committed** calls (or individual `bootstrap_account` calls) | Acquires the same global `bootstrap_backfill_serialization` lock as `bootstrap_account` first (Decision H.8) — released automatically on crash/rollback; **one transaction** — the set-based `INSERT ... SELECT` and the guarded, `NOT EXISTS`-proven `backfilled_at UPDATE` (Decision K.6, corrected) commit or roll back together; a crash anywhere before commit rolls back the **entire** attempt, inserting zero rows from this specific call — never a partial subset of this call's own attempt left durable | Either every `public.profiles` row that existed when this call started now has an authority row for this `domain` and `backfilled_at` is set (this call's own full success), or nothing changed at all from this call (crash/failure) and whatever subset already existed from **prior, separately-committed** calls is unaffected and unchanged — re-running the call is always safe and makes independent, fresh progress |

### O. Threat table (unchanged categories; two entries corrected for the byte-representation and grant fixes)

**⚠ BLOCKED (identity/authority-scope — see Status): the first two rows below both
describe `account_scope_id` as if its derivation were settled and uniform. It is
neither — `bootstrap_account()` derives it from `auth.uid()`; `backfill_domain_
authority()` and `assessment_runs`'s own `fk_athlete` derive it from `profiles.id`.
The mitigations described (never a client parameter; a real PK) remain valid
regardless of which scope is eventually chosen, but "derives it from `auth.uid()`
only" below is not accurate as a description of this document's own functions.**

| Threat | Mitigation |
|---|---|
| Malicious/forged `account_scope_id` | Never accepted as a parameter; every function derives it internally — see the identity/authority-scope blocker above for why "from `auth.uid()` only" is not an accurate description of every function as written |
| Guessed run IDs | Global Lock Order's non-leaking lookup returns `not_found` identically either way |
| Cross-account stable UUID collision | `assessment_runs`'s composite `(account_scope_id, assessment_run_id)` PK |
| Overwritten staging retry | Whole-batch compare-then-classify (Decision F.1) — insert-only, no `DO UPDATE` |
| A staged value contains bytes `text` could never have held (NUL, invalid UTF-8) | `bytea` storage (Decision B) accepts any byte sequence; validity is only asserted later, at document-parse time, as `validation_failed` |
| Manifest lie (claimed fingerprint doesn't match staged bytes) | `analyze_adoption` recomputes server-side directly from staged `bytea` (Decision B) |
| Payload/schema mismatch | `pg_jsonschema` + cross-field validation inside the database (Decision I) |
| Stale client / old build | ADR-0019 Decision 8's named, unsolved-by-this-ADR limitation |
| Stolen browser storage / XSS / extension access | Out of scope (client-side); RLS limits blast radius to the compromised account only |
| Service-role key exposure | Never in client code; `service_role` itself now has zero direct table grants (Decision K.4/K.5), only three named `EXECUTE` grants |
| `SECURITY DEFINER` search-path attack | `search_path=''`, full schema qualification everywhere, including the fingerprint function (Decision K.11) |
| Direct Data API table writes bypassing functions | `private` schema unreachable; every `public` table's default grants explicitly revoked (Decision K.4) |
| Concurrent `begin`/`finalize`/`abort` | Global Lock Order plus the partial unique index |
| Concurrent identical `begin_adoption` retries | Decision H.1's lock-then-reobserve pattern — never misclassified as `adoption_in_progress` |
| Exception after partial mutation | Decision I's single-block exception-subtransaction rule |
| Canonical collision | Decision H.5's exact, expanded field-by-field compare |
| Account deletion | `RESTRICT` at every FK level |
| Replayed `client_request_id` | Decision H.1/H.3's idempotency-mismatch handling |
| A client reads a tombstoned row directly | Decision K.3's policy-level exclusion, not a view-only filter — closed at the base table |
| A view silently exposes rows RLS should have hidden | Decision K.3's `security_invoker = true`, explicit and version-gated |

### P. Reclassified status and implementation sequence

**No longer open architecture choices:** the `fp1` source fingerprint algorithm and
`bytea`'s own byte-lossless storage of arbitrary raw source bytes (Decision B) — **this
is narrower than the prior revision's claim of a fully "byte-lossless server
representation" overall, which is now corrected: the `bytea` staging layer is
byte-lossless, but the `jsonb` layer built on top of it is not, for every value the
existing TS validators accept (Decision E.2b) — that is a separate, still-open item,
listed below, not folded into this settled item**; the protocol registry's enforceable
key-list and lifecycle model (Decision E.2/E.2a); the materialized analysis/candidate/
conflict model (Decision E.11); atomic batch RPC semantics (Decision F.1/G.2); concurrent
`begin_adoption` idempotency, including the terminal-state retry cases this revision
closes (Decision H.1); the executable `abort_and_replace` statement order (Decision
H.2); the database-contained validation boundary and canonical reconstruction rule
(Decision I); the RLS/view/grant model (Decision K); the error taxonomy (Decision L) —
**systematically cross-checked against Decision M's RPC inventory and this revision's
own four-matrix audit in this pass, not mechanically verified against running code or a
live database, and not asserted as a permanently closed, no-further-gaps-possible
claim.**

**Genuine architecture blockers, unchanged or newly named:** the Assessment
draft/history authority-unit split (Decision D); the accepted account
deletion/anonymization policy; ADR-0019's own named old-build/local-branch limitation;
**the `jsonb` representability boundary (Decision E.2b)** — **corrected from a
fixture-evidence-based gate to an unconditional hard block**: every `design_only →
pilot` transition fails unconditionally (`representability_contract_unresolved`),
regardless of any other precondition, until a later, separate, accepted ADR either
adopts a durable approval-record design or a lossless canonical representation; no
fixture corpus, however large, is treated as proof of the underlying universal claim,
and none is checked by this function at all; **and, new in this pass, mapping
execution/dispatch integration (Decision E.2c, Task 6.2)** — `implemented_canonical_
mappings` rows are migration-time attestations only (a `regprocedure` value proves a
named function existed at `INSERT` time, never a live, continuously-checked, or
actually-invoked guarantee); no generic dispatch mechanism that looks up and calls
`handler_regprocedure` from `analyze_adoption`/`finalize_adoption` is designed by this
document, so a row's mere existence never means a domain's mapping logic actually
runs — designing and implementing that live validation/dispatch mechanism is a
separate, required precondition, independent of, and in addition to, the other two
blockers above; **and, named in the fourth Team Foundation correction pass, the
Local Adoption identity/authority-scope choice** — this document's own
`account_scope_id` column (Decisions E.5/E.6/E.9/E.10 and every RPC/policy/proof
built on it) is used as if it were the raw Supabase Auth account id in some places
(`bootstrap_account()`, Decision H.8; the `assessment_runs_owner_select` RLS
policy, Decision K) and as if it were `docs/adr/0022`'s independent `Profile.id` in
others (`backfill_domain_authority()`; `assessment_runs`'s own `fk_athlete`
constraint, Decision E.9) — genuinely undecided, not merely inconsistently
described, and this document does not decide it here. Every table, function,
policy, and proof built on `account_scope_id` remains blocked until a dedicated
decision (a future ADR, or an explicit product/architecture decision this document
then adopts) settles which scope Local Adoption authority actually uses.
Separately, on the already-decided part of the same identity model: Decision
E.3/E.4's `profiles`/`athletes` schema and `bootstrap_account()`'s own
`profiles`/`athletes` bootstrap step must be rebuilt against ADR-0022's real,
already-implemented identity model (`Profile.id` independent of the Auth account
id, resolved via `account_profile_links`; `Athlete` a separate, lazy, optional
capability, never auto-created) before implementation — this part is not an open
decision, only unfinished reconciliation work.

**Corrected implementation sequence** (unchanged ordering rationale from the prior
revision; stages 6 and 7 updated to name the normalized/materialized tables):

| # | Stage | Adjacent safety proof |
|---|---|---|
| 1 | Accept the Assessment draft/history authority-unit split ADR | Proven behavior-preserving against existing Assessment tests before any cloud work touches Assessment |
| 2 | Define the versioned protocol registry rows for `assessmentHistory` | `adoption_protocol_source_keys` proven contiguous/zero-based by `register_adoption_protocol`; both JSON Schemas proven valid by `jsonschema_is_valid` before `pilot` |
| 3 | Create extensions and schemas | `pgcrypto`/`pg_jsonschema` present; `private` confirmed unreachable via the Data API |
| 4 | Create roles and the privilege baseline (`adoption_protocol_owner`) | Grants-diff proves the role holds exactly the privileges in Decision K.8, nothing more |
| 5 | Create base account/ownership tables | **⚠ BLOCKED (Profile/Athlete bootstrap — see Status and Decision E.3/E.4): this stage's own safety proof ("exactly one `profiles`/`athletes` row per `auth.users` row") is the superseded model. The real proof, matching ADR-0022, is: exactly one `profiles` row per `account_profile_links` row, and an `athletes` row created only lazily/optionally, never automatically per account.** |
| 6 | Create private adoption-state tables, including the normalized source-key, domain-scoped mapping-registry, and materialized analysis/candidate tables (Decision E.1-E.2c, E.5-E.6, E.8, E.11) | Migration applies cleanly in Decision E.7's Phase 1 order |
| 7 | Add the cyclic/composite constraints (Decision E.7 Phase 2) | All three `ALTER TABLE` statements succeed (`fk_account_domain_authority`, `fk_adoption_run`, `fk_last_adoption_run`, Decision E.5/E.7); a deliberately-reintroduced inline forward reference is proven to fail |
| 8 | Add exact RLS (`ENABLE` and `FORCE` both), the `security_invoker` view, and grants (Decision K) | Automated RLS test harness proves every matrix cell in Decision K.5, including the tombstone-exclusion policy |
| 9 | Implement the fingerprint function against the ten golden vectors, and the `pg_jsonschema` fixture-parity validation | Server-computed fingerprints match all ten vectors exactly, including vector 5's NUL byte; database validator fixtures match `validatePersistedAssessmentRun`'s own suite |
| 10 | Implement `begin_adoption`/`stage_adoption_entries`/`analyze_adoption`/`query_adoption_analysis`/`query_adoption_conflicts` | Scenario proofs 1-7, 17, 21-25 reproduced as automated tests |
| 11 | Implement `resolve_adoption_conflicts`/`finalize_adoption`/`abort_adoption`/`abort_and_replace_adoption` | Scenario proofs 8-12, 26-27, 29, 32, 34 reproduced |
| 12 | Implement tombstone delete/query behavior | Scenario proofs 15, 16, 30 reproduced |
| 13 | Implement account bootstrap/backfill | Scenario proof 17 reproduced |
| 14 | Implement client RPC decoding and the transport taxonomy | Scenario proof 35 reproduced |
| 15 | Implement local transition fence/archive integration (ADR-0019, unchanged) | Proven against ADR-0019's own existing stage gates |
| 16 | Implement repository/startup authority wiring | A repository bound to two live backends proven unreachable |
| 17 | Run adversarial concurrency, crash, RLS, and cross-account tests | Every row of Decision N reproduced; scenario 31 (service-role direct mutation attempt) reproduced |
| 18 | Development/staging pilot for `assessmentHistory` (non-production) | **Corrected (Task 7.6): not reachable merely once stage 1 is Accepted.** Requires **all** of: every prior implementation stage (2-17) complete; the Assessment draft/history authority-unit split ADR (stage 1) Accepted; Decision E.2b's `jsonb`-representability hard block resolved by a **later, separate, accepted ADR** and its migration applied (not this document); mapping execution/dispatch integration (Decision E.2c/Task 6.2) designed and implemented, not merely a migration-time-attested row; and every other blocker named in Decision P closed. Stage 1 alone is necessary, never sufficient. |
| 19 | Separately named production-enablement gate | Every blocker in Decision P resolved or explicitly accepted (corrected, Task 7 — blockers are listed in Decision P, never Decision Q) |

**This ADR remains Proposed / Incomplete.**

### Q. Mandatory whole-document contradiction audit and scenario proofs

**Re-read start to finish; every stale term traced.** Confirmed absent or, where
retained, retained only inside an explicit "the prior revision said X, corrected to Y"
sentence (never as an unqualified, live claim): `source_value text` for staged content;
a `jsonb`-parameter `fingerprint_domain_snapshot`; `array_length(...) > 0` as the
key-list contract; `extra_manifest_schema`/`source_manifest_extra`; `cloud_eligible` as
a field distinct from `activation_status`; `kept_local`/`kept_remote`/`kept_both`/
`keep_first_parsed`/`keep_second_parsed`; an `adoption_analyses` row with no candidate
content; a per-entry `stage_adoption_entries` write path; a sequential-only
`begin_adoption` idempotency check; `manifest_mismatch` as a live result code;
`unauthorized`/`session_required` as two codes for one condition; `conflict_already_resolved`
folded into `invalid_transition` anywhere; "ten user-facing functions" or "eleven" as the
function count; `FORCE ROW LEVEL SECURITY` presented as if it implies `ENABLE`; a view
with no stated security mode; `service_role` shown with "full" table access anywhere in
the final matrix; an owner `SELECT` policy on `assessment_runs` that does not exclude
tombstoned rows; `canonicalized_at` included in any canonical-collision comparison; a
single "schema version" label used for more than one of the four distinct version
concepts (Decision I). **This fourth revision's own new corrections, confirmed absent as
live defects and present only as corrected text:** "canonical base64" as an executable
transport claim (Decision B — corrected to hex, since PostgreSQL's own `base64` output
wraps at 76 characters per RFC 2045); a `LEFT JOIN`/`COALESCE`-to-null in
`fingerprint_domain_snapshot` (Decision B — corrected to `INNER JOIN` plus an explicit
completeness precondition in `analyze_adoption`, Decision G.1); the nullable-evaluating
`(decision = 'select_candidate_ordinal') = (selected_candidate_ordinal is not null)`
`CHECK` (Decision E.11 — corrected to a total three-way disjunction); `content_digest`
labeled `fp1:` or treated as sufficient proof of equality on its own (Decision E.11 —
corrected to `cd1:`, with direct `jsonb` equality always checked before classifying a
duplicate); a `register_adoption_protocol` relying on caught constraint exceptions
(Decision K.6 — corrected to total prevalidation plus an advisory-lock idempotency
sequence); `<migration_role>`/`entries[]`/`resolutions[]`/`(...)` as unresolved
placeholders (Decision K.9/M — corrected to exact, schema-qualified signatures and
`jsonb` shapes); `fingerprint_mismatch`/`validation_failed`/`conflicts_present` reused as
`finalize_adoption`'s own failure codes (Decision L — corrected to
`analysis_fingerprint_mismatch`/`analysis_validation_failed`/`conflicts_unresolved`,
distinct from `analyze_adoption`'s own envelope `analysisStatus` values); an
unauthenticated `begin_adoption` call mapped to `not_found` (Decision L — corrected to
`unauthenticated`); "none new"/"read that row"/dash-only query-crash cells (Decision N —
corrected to concrete backends and four named replacement-outcome rows); `backfill_domain_authority`
described as reading `auth.users` (Decision K.6 — corrected to `public.profiles` only).

**Ninety-four scenario proofs — every one traced to exactly one deterministic result
and one mutation outcome, by the reasoning given for it (not by mechanical execution —
see the closing note after scenario 94).** Proofs 1-20 are unchanged in outcome from
the second revision (re-verified against this revision's renamed columns/functions) and
are not repeated in full; proofs 3, 4, 5, 7, 9, 10, 23, 26, 27, 33, 35 are restated
below because this revision's mechanism for producing their outcome changed, and 23 is
restated **again** in this same revision (its escape-sequence sub-case was itself wrong
until this pass, Task A). Proofs 21-50 carry over from the third revision (21-35,
re-verified) and this document's own fourth-revision additions (36-50); proofs 51-64
are new from the prior correction pass; proofs 65-70 prove the corrected
analysis-integrity digest model (Task 1); proofs 71-76 prove the corrected
bootstrap/backfill serialization (Task 2, prior pass); proofs 77-80 prove the corrected
authority-query precedence (Task 3.1, prior pass); proofs 81-86 prove `begin_adoption`'s
remaining missing-row race is closed (Task 2, this pass); proof 87 proves
`query_account_domain_authority`'s single-statement snapshot closes its own remaining
race (Task 3, this pass); proofs 88-93 prove `finalize_adoption`'s independently-derived
grouping validation catches defects a digest match alone could not (Task 4, this
pass) — no scenario is added merely
to raise the count.

1-2, 6, 8, 11-20. **Unchanged outcomes**, re-verified against this revision's exact
mechanisms (Decision H.1 for 1/2, Decision G.1/G.3 for 6/8, Decision E.9/H.5/K.3/H.4/
H.6/K.4-K.5 for 13/16/18/19/20, ADR-0019 for 14/17, Decision J for 15).

3. **Stage retry with identical bytes.** Decision F.1 step 2: the existing row's
   `(source_position, source_value_is_null, source_value_utf8)` matches the request's
   own decoded values exactly → no mismatch reported for that entry, no mutation
   needed for it. **Deterministic.**
4. **Stage retry with different bytes under the same source key.** Decision F.1 step 2:
   mismatch detected before any insert; **the entire batch** returns
   `staged_entry_mismatch`, no mutation at all (a stricter, whole-batch version of the
   second revision's per-entry outcome). **Deterministic.**
5. **Two entries using the same source position.** Decision F.1 step 1's explicit,
   pre-insertion batch check (not a caught unique-violation) detects this and returns
   `malformed_request` for the whole call, no mutation. **Deterministic.**
7. **`stage_adoption_entries` called against a run whose `status` is no longer
   `prepared`.** Decision F.1's precondition (checked ahead of the `analysis_frozen`
   handling below) — `status IN ('committed', 'aborted')` → `invalid_transition`, no
   mutation. **Corrected scope: this is now the only case `stage_adoption_entries`
   reports as `invalid_transition` at all** — a call against a still-`prepared` but
   `analysis_frozen = true` run no longer falls into this scenario; see the new
   frozen-retry scenario below. **Deterministic.**
9. **Finalize collides with a canonical row of different content.** Decision H.5's
   expanded, `canonicalized_at`-excluded field comparison finds a mismatch;
   `integrity_failure`, the entire transaction rolled back. **Deterministic.**
10. **Abort races with finalize.** Decision H.4's Global Lock Order, unchanged
    reasoning — whichever acquires the fixed-order locks first proceeds; the loser's own
    precondition check fails against the winner's committed result.
    **Deterministic, no deadlock.**

21. **Two concurrent `begin_adoption` calls, same token, identical input.** Decision
    H.1: both serialize on the authority-row lock; the second to acquire it re-observes
    the first's committed row before deciding anything; both resolve to the **same**
    single `prepared` run. **Deterministic.**
22. **Two concurrent `begin_adoption` calls, same token, different input.** Identical
    lock-then-reobserve sequence; the second call's re-observed row does not match its
    own input → `idempotency_mismatch`, no second run created. **Deterministic.**
23. **A staged present value contains an embedded NUL — corrected a second time, to
    stop claiming the escaped form "parses normally" into `jsonb` (it does not, Decision
    E.2b) — distinguishing a raw NUL byte from the six-character escaped JSON sequence
    backslash-u-zero-zero-zero-zero.** A **raw, unescaped** NUL byte can always be
    staged and fingerprinted (Decision B: `bytea` storage, golden vector 5 proves this
    exact case) — but for the Assessment JSON protocol specifically, a raw unescaped
    NUL byte inside what is supposed to be a JSON document makes that document
    **invalid JSON** (JSON strings may only contain a NUL via the escaped
    backslash-u-zero-zero-zero-zero sequence, never a literal byte), so document-schema
    validation (Decision I) always fails on it, and the analysis always reaches
    `validation_failed` — never `ready`. **A JSON string containing the escaped,
    six-character sequence backslash-u-zero-zero-zero-zero is a genuinely different
    case, and the prior revision's claim about it was wrong**: its underlying source
    bytes contain **no** raw NUL byte at all — they contain the six printable ASCII
    characters `\`, `u`, `0`, `0`, `0`, `0` — and the document is **valid JSON** by
    RFC 8259 (json's own looser, syntax-only parser accepts it) — **but casting it to
    `jsonb` specifically fails**, because `jsonb`'s stricter input function rejects
    exactly this escape (PostgreSQL confirms it "cannot be represented in the
    database encoding['s `text` type]," Appendix). This is Decision E.2b's named
    architecture blocker — **still a `validation_failed` document-level fact** (unlike
    the raw NUL case, which is an ordinary document-content failure): the `::json` cast
    (Decision I's two-stage classifier) succeeds, proving valid JSON syntax, but the
    following `::jsonb` cast raises a Class 22 exception — caught by its own inner,
    `SQLSTATE`-gated block (Task 4: `22032`/`22P02` specifically, never a bare
    `EXCEPTION WHEN OTHERS`) and classified, by which of the two sequential casts
    failed, as `document_validation_code = 'json_parse_or_representability_failed'`
    (Task 4 — renamed from `'jsonb_unrepresentable_escape'`, collapsed with the
    "genuinely invalid JSON" case pending live `SQLSTATE` verification, Option B) —
    never by inspecting exception *message* text. Independently of that per-run
    outcome, `transition_adoption_protocol_status`
    unconditionally refuses every `design_only → pilot` request
    (`representability_contract_unresolved`, Decision E.2b) — **no fixture evidence of
    any kind is checked or required**, since fixture coverage over a finite corpus was
    never proof that the value space excludes this case; the block is unconditional
    until a later, separate ADR resolves it. **Deterministic in both sub-cases, and
    genuinely distinct outcomes: `validation_failed` (raw NUL, ordinary document
    content failure) vs. an anticipated cast-level rejection gated by a named,
    unresolved architecture blocker (the escape sequence) — never the same code, and
    never "parses normally."**
24. **A staged value is invalid UTF-8.** Stored and fingerprinted as raw bytes without
    issue (Decision B's algorithm needs only a byte length, never UTF-8 validity, to
    frame the hash input); document-schema parsing (`pg_catalog.convert_from(...,
    'UTF8')` or equivalent, inside Decision I's validation) fails on invalid UTF-8 →
    `validation_failed`. **Deterministic.**
25. **Three parsed entities share one entity ID with different content.** Decision
    E.11's generalized duplicate-group model: all three become candidates sharing one
    `duplicate_group_key`, initial `exclusion_status = 'pending'` for every member;
    resolution is `select_candidate_ordinal` (any one of the three, structurally proven
    to belong to the group by the composite FK) or `exclude_duplicate_group` (drop all
    three). **Deterministic — no longer forced into an ambiguous two-slot vocabulary.**
26. **Analysis records `fingerprint_mismatch`, then finalize is attempted.** Decision
    G.3 step 3: `adoption_analyses.status <> 'ready'` → `finalize_adoption` returns the
    **distinctly named** `analysis_fingerprint_mismatch` (never the bare
    `fingerprint_mismatch` label, which is `analyze_adoption`'s own envelope value, L.1)
    — no promotion attempted. **Deterministic.**
27. **Analysis records `validation_failed`, then finalize is attempted.** Identical
    mechanism to 26; `finalize_adoption` returns `analysis_validation_failed` (never the
    bare `validation_failed` label). **Deterministic.**
28. **A client queries conflicts from the private conflict model.** `query_adoption_conflicts`
    (Decision E.11/H.6/M) is exactly the owner-scoped, read-only, no-lock RPC that makes
    this reachable — the second revision's own gap (no such RPC existed) is closed.
    **Deterministic.**
29. **A protocol is retired between analysis and finalization.** Decision E.2's explicit
    rule: `finalize_adoption` never re-checks `activation_status`; retirement blocks
    only future `begin_adoption` calls. The already-`prepared` run finalizes normally.
    **Deterministic, and explicitly, consistently decided (not merely implied).**
30. **A client directly queries a tombstoned Assessment row.** Decision K.3's policy-level
    exclusion on `assessment_runs` itself returns zero rows for that
    `(account_scope_id, assessment_run_id)`, whether queried via the base table or the
    `security_invoker` view — no path around it exists for `authenticated`.
    **Deterministic.**
31. **A `service_role` request attempts a direct canonical table mutation.** Decision
    K.4/K.5: `service_role` has **no** direct `INSERT`/`UPDATE`/`DELETE` grant on
    `assessment_runs` (or any table) — the attempt fails at the grant level, before any
    RLS policy is even relevant. **Deterministic.**
32. **`abort_and_replace` executes under the partial prepared-run unique index.**
    Decision H.2's exact statement order (abort the stale row **before** inserting the
    replacement) never presents two `prepared` rows for the same pair to the index at
    once. **Deterministic.**
33. **A protocol source-key set is empty, contains NULL, is non-contiguous, or has a
    duplicate — corrected to be prevalidated by `register_adoption_protocol` itself,
    never a caught constraint exception.** Decision K.6's step 3 prevalidates the
    **complete submitted request** before any insert: an empty list, any `NULL` key, a
    non-contiguous or non-zero-based position sequence, or a duplicate key/position
    within the request are each detected there and returned as `malformed_request`, no
    mutation — the table's own `NOT NULL`/`UNIQUE`/`PRIMARY KEY` constraints (Decision
    E.2a) remain as a structural backstop for a request that somehow bypassed the
    prevalidation, never the primary detection mechanism. **Deterministic — four
    distinct cases, each caught by name, before any write is attempted.**
34. **A same-run canonical retry differs only in a previously omitted deterministic
    field.** Decision H.5's expanded comparison list (Decision I's four-version fields,
    `athlete_id`, `template_id`, etc., all now explicitly compared) catches this exactly
    where the prior revision's shorter list might have missed it; a genuine difference
    in any of these fields is `integrity_failure`, never silently accepted.
    **Deterministic.**
35. **A malformed hex staged value is submitted.** Decision B's canonical-hex check
    (an even-length, lowercase `[0-9a-f]` regex, then decode/re-encode/compare
    byte-for-byte to the input) fails on the first mismatch; `stage_adoption_entries`
    returns `malformed_request` for the whole batch, no mutation. **Deterministic.**
36. **A registered key row is missing but the claimed fingerprint equals the
    explicit-null fingerprint.** Decision G.1's staging-completeness check compares
    **counts** (staged rows vs. registered keys), not fingerprint values — a missing
    row means `count(staged) < count(registered)`, which fails the completeness check
    and returns `staging_incomplete` regardless of what the client claims the
    fingerprint is; `fingerprint_domain_snapshot` is never even called (Decision B), so
    a fingerprint that happens to equal the canonical empty-domain value cannot mask a
    genuinely missing row. **Deterministic.**
37. **A source value exceeds PostgreSQL base64's 76-character output boundary,
    proving the new hex transport has no wrapping behavior.** Golden vector 9 (200,000
    bytes) is exactly such a value — its hex encoding
    (`pg_catalog.encode(bytea, 'hex')`) is 400,000 characters with **no** embedded
    newline anywhere in it, decodes and re-encodes to the identical string, and is
    accepted by `stage_adoption_entries` without `malformed_request` — the exact
    failure the prior revision's base64 transport would have produced for this same
    vector. **Deterministic, and directly demonstrates the defect Decision B's
    correction closes.**
38. **An unresolved conflict has `selected_candidate_ordinal` set through malformed
    input.** The corrected `adoption_conflicts` `CHECK` (Decision E.11) is a total,
    three-way disjunction with no `NULL` case: `decision IS NULL` requires
    `selected_candidate_ordinal IS NULL` **exactly** — any attempt to write a row with
    `decision IS NULL` and a non-`NULL` ordinal violates the constraint outright and is
    rejected by PostgreSQL itself, never silently accepted as the prior revision's
    `NULL`-evaluating expression would have allowed. **Deterministic.**
39. **A valid singleton candidate reaches finalize.** Decision E.11's exact
    exclusion-status table: a valid singleton is `selected` the instant
    `analyze_adoption` classifies it — never `pending` — so it requires no
    `resolve_adoption_conflicts` call at all and is eligible for promotion (Decision
    G.3 step 7) as soon as the analysis reaches `ready`. **Deterministic.**
40. **Three identical candidates and three differing candidates are classified
    separately.** Decision E.11: the three identical-`content_digest`-and-jsonb-equal
    candidates auto-resolve (lowest ordinal `selected`, others `excluded_duplicate`, no
    conflict row); the three genuinely differing candidates (a separate `entity_key`,
    a separate `duplicate_group_key`) get their own `adoption_conflicts` row, `pending`
    until resolved. Two independent groups, two independent outcomes, within the same
    analysis. **Deterministic.**
41. **Same candidate digest but unequal jsonb content.** Decision E.11's digest/equality
    model: `content_digest` equality alone is never sufficient — `canonical_candidate`
    `jsonb` equality is checked directly before classifying a pair as an exact
    duplicate; a digest collision with genuinely different `jsonb` content is
    classified as **differing**, producing a real, user-resolvable conflict, never a
    silent, incorrect auto-merge. **Deterministic.**
42. **Protocol registration retry uses the same version with different schemas.**
    Decision K.6 step 4: the existing row's immutable contract (including
    `source_document_schema`/`canonical_entity_schema`) is compared field-by-field
    against the request; a schema difference is a field difference →
    `idempotency_mismatch`, no mutation. **Deterministic.**
43. **Two concurrent protocol registrations use the same version.** Decision K.6's
    advisory-lock-then-reobserve pattern (structurally identical in spirit to Decision
    H.1's `begin_adoption` fix): both calls serialize on
    `pg_advisory_xact_lock`; the second re-observes the first's committed row and
    returns `already_registered` (identical request) or `idempotency_mismatch`
    (differing request) — never a duplicate-key exception, never two rows.
    **Deterministic.**
44. **Identity-sequence access under `adoption_protocol_owner`.** Decision K.14's
    explicit `GRANT USAGE, SELECT ON SEQUENCE private.adoption_staged_entries_id_seq`
    means an `INSERT` performed by `adoption_protocol_owner` (inside
    `stage_adoption_entries`) succeeds without relying on an unstated identity-column
    privilege assumption. **Deterministic.**
45. **A future public table/function created by the migration role receives no
    unintended API grants.** Decision K.9/K.15's `ALTER DEFAULT PRIVILEGES` statements
    (run as the migration role itself, no `<placeholder>`) revoke `EXECUTE`/table/
    sequence access from `public`/`anon`/`authenticated`/`service_role` by default for
    anything that role creates **after** these statements run — a new object still
    requires an explicit, subsequent `GRANT` before any client-facing role can reach it.
    **Deterministic, conditional on the migration ordering itself being correct — the
    exact reason Decision K.9 requires a migration-time ownership assertion, not merely
    the `ALTER DEFAULT PRIVILEGES` statement in isolation.**
46. **An old `auth.users` row with no profile is present during backfill.** Decision
    K.6's corrected backfill terminology: `backfill_domain_authority` iterates
    `public.profiles`, never `auth.users` — a profile-less `auth.users` row is simply
    outside this function's own scope, remains unbootstrapped, and is covered instead,
    later, whenever `bootstrap_account` is eventually called for it (which creates its
    `profiles`/`athletes`/authority rows all at once, for whatever domains are
    `pilot`/`production` at that moment). **Deterministic — no claim is made about a row
    this function never reads.**
47. **Every replacement-run terminal outcome resolves to one exact authority/backend
    row.** Decision N.1's four `Superseded —` rows (`prepared`, `committed`, `aborted`,
    momentarily-`unavailable`) replace the prior revision's single "(read that row)"
    placeholder — each names its own exact authority scope, readable/writable backend,
    and recovery action, keyed by the replacement run's own current state.
    **Deterministic — no unresolved reference remains.**
48. **A document contains only individually invalid entities.** Decision E.11's explicit
    `ready`-status decision: the document itself is valid, every extracted entity is
    individually `invalid`/`excluded_invalid`, there are no valid candidates to group or
    conflict over, so the analysis reaches `ready` immediately (`conflict_count = 0`),
    and `finalize_adoption` may commit with `promoted_entity_count = 0` — a legitimate,
    explicitly-decided outcome, never an error. **Deterministic.**
49. **A conflict decision and candidate `exclusion_status` disagree before finalize.**
    Decision G.3 step 5's direct, structural cross-check (never relying on a digest
    match alone) compares every conflict's own `decision` against its group members'
    `exclusion_status` explicitly; a disagreement — which should be structurally
    impossible given no role outside the owning function holds `UPDATE` on these tables
    — is `integrity_failure`, the entire `finalize_adoption` transaction aborts.
    **Deterministic.**
50. **`abort_adoption` receives or persists its reason according to the final
    signature.** Decision E.6's `abort_reason` column, set by `abort_adoption`'s own
    client-supplied, length-bounded text, or by `abort_and_replace_adoption`'s own
    fixed `'superseded_by_replacement'` string (Decision H.2 step 3) — the parameter is
    never accepted and then silently discarded; every abort transition leaves a
    concrete, queryable reason behind. **Deterministic.**

51. **A staged value contains a lone (unpaired) Unicode surrogate escape.** A genuinely
    different `jsonb`-representability case from scenario 23's U+0000 escape, per
    Decision E.2b/Appendix: PostgreSQL's `jsonb` input function "insists that any use of
    Unicode surrogate pairs to designate characters outside the ... Basic Multilingual
    Plane be correct" — a high surrogate (`\ud800`-`\udbff`, written out as backslash-u
    followed by four hex digits) with no matching low surrogate immediately following
    it is syntactically valid JSON text (RFC 8259 does not require surrogate pairing at
    the grammar level) but fails specifically at the `jsonb` cast, exactly like scenario
    23's escape case — the same `document_validation_code =
    'json_parse_or_representability_failed'` (Task 4), the same `SQLSTATE`-gated inner
    exception block, the same Decision E.2b architecture-blocker gate on `pilot`.
    **Deterministic, and a
    genuinely separate case from scenario 23 (a different malformed construct), sharing
    only the same outcome code because both are the same class of `jsonb`-cast-time
    rejection.**
52. **Timestamp lexical round-trip — corrected from a `timestamptz`-reconstruction
    claim to a verbatim-preservation one.** Decision I's "Timestamp fidelity"
    paragraph, corrected a second time: reconstruction reads `created_at_source`/
    `completed_at_source` directly (Decision E.9) — the exact bytes `finalize_adoption`
    promoted from the staged document, never a value re-derived from the parsed
    `created_at`/`completed_at` `timestamptz` companions. This is lossless **by
    construction**, for any source string the document-level schema accepted, and
    requires no proof about which writer, era, or import path produced it — the
    round-trip is trivial (copy the string in, read the same string back), not a claim
    resting on `new Date().toISOString()`'s specific output format or on grep evidence
    about today's call sites. **Deterministic, and — unlike the retracted prior
    claim — true for every legacy, imported, or future source string the schema
    accepts, not only today's generation pattern.**
53. **`stage_adoption_entries` retried after `analysis_frozen = true`, with byte-identical
    entries.** Decision F.1's frozen-retry path: no `INSERT` executes; every submitted
    entry's decoded content is compared against its existing staged row; identical
    across the whole batch → `staged`, no mutation — an idempotent replay report on a
    run that can no longer accept new staged data. **Deterministic.**
54. **The same retry, but one entry's content differs from its existing staged row.**
    Decision F.1's frozen-retry path: `staged_entry_mismatch`, no mutation — identical
    in meaning to an unfrozen mismatch, distinguished from scenario 4 only by
    `analysis_frozen` already being `true`. **Deterministic.**
55. **`resolve_adoption_conflicts` retried after the analysis has already reached
    `ready`, with submitted resolutions exactly matching every durable decision.**
    Decision G.2's `ready`-retry path: every submitted resolution compared against its
    durable `decision`/`selected_candidate_ordinal`; exact match on every entry →
    `resolved`, no mutation. **Deterministic.**
56. **The same retry, but one submitted resolution disagrees with its durable
    decision (or names a `duplicate_group_key` that does not exist for this
    analysis).** Decision G.2's `ready`-retry path: `conflict_already_resolved`, no
    mutation — the same code used for a single differing resolution against a still-
    `conflicts_present` analysis. **Deterministic.**
57. **`begin_adoption` retried with the same `client_request_id` and identical input,
    after the run it originally created has since been `finalize_adoption`-committed.**
    Decision H.1 step 4: the three immutable fields match, but `status = 'committed'`
    → `already_committed`, never `prepared` — the retry accurately reports the run has
    moved on, rather than silently reasserting a status that is no longer true.
    **Deterministic.**
58. **The same retry, but the run was instead `abort_adoption`-aborted (or superseded
    via `abort_and_replace_adoption`) since the original `begin_adoption` call.**
    Decision H.1 step 4: `status = 'aborted'` → `already_aborted`, never `prepared`.
    **Deterministic.**
59. **Two different `protocol_version`s of the same `domain` both attempt
    `transition_adoption_protocol_status(..., 'pilot')` concurrently.** **Today, both
    calls return `representability_contract_unresolved` — the hard block (Decision
    E.2b) fires immediately for both, before either ever reaches the one-active-
    version check at all (Decision K.6/Task 5's exact precedence), so this scenario
    cannot currently produce a race on that check in the first place.** The
    domain-scoped advisory lock (`pg_advisory_xact_lock(hashtext(domain))`) and the
    one-active-version check it protects remain specified as the **target design** for
    once a later ADR lifts the hard block: acquired by **both** calls before either
    checks that invariant, it would then serialize them so the first to acquire the
    lock proceeds (assuming its own preconditions hold) while the second re-observes
    the first's now-committed `pilot` status for the other version and fails as
    `invalid_transition` — never a race where both commit, and never relying solely on
    the partial unique index as a post-hoc catch. **Deterministic today
    (`representability_contract_unresolved` for both, unconditionally); the
    lock-ordering argument above is unreachable, not incorrect, while the block stands.
    No deadlock either way (a single lock key per domain, no ordering conflict
    with the Global Lock Order, which this function does not use at all).**
60. **`backfill_domain_authority` is called for a `(domain, protocol_version)` pair
    with no matching `private.adoption_protocols` row.** Decision K.6's precondition,
    checked first: `not_found`, no mutation — the same code
    `register_adoption_protocol` produces for an unregistered `domain`, added to this
    function's own producer entry in Decision L.3/M. **Deterministic.**
61. **A client renders a conflict-resolution UI and must show what it is asking the
    user to choose between.** Decision F's correction: `query_adoption_analysis`
    returns `canonicalCandidate` directly on every candidate (no longer withheld behind
    a nonexistent "future fetch mechanism") — the client has everything needed to
    render the choice from this single RPC's response, with no second, unspecified data
    path to invent or depend on. **Deterministic.**
62. **An operator inspects whether the global `PUBLIC EXECUTE` default on functions has
    actually been closed, after running this migration.** Decision K.9's corrected,
    two-statement fix: querying `pg_default_acl` (or attempting to `EXECUTE` a
    newly-created, never-explicitly-granted function as an arbitrary role) after only
    the schema-scoped `anon`/`authenticated`/`service_role` statement would still show
    `PUBLIC` able to execute it — proving the schema-scoped statement alone is
    insufficient (Task C's defect, reproduced as a scenario); after **both** of Decision
    K.9's statements (the schema-unscoped global revoke, and the schema-scoped
    Supabase-role revoke) run, the same inspection shows no role retains an unearned
    default. **Not mechanically executed against a live database in this session
    (Appendix) — this scenario describes the exact check an implementer must run to
    confirm it, not a result this document has itself observed.**
63. **A migration attempts to call `extensions.jsonb_matches_schema`/
    `jsonschema_is_valid` against a project where `pg_jsonschema` registered different
    signatures than expected (or is not installed at all).** Decision E.7's step 3a
    `to_regprocedure(...)` assertions fail closed: the migration raises and aborts
    before any table or function depending on those signatures is created, rather than
    deferring the failure to the first runtime call against a `(jsonb, jsonb)`/`(jsonb)`
    signature that was never real (the prior revision's defect, Task B). **Deterministic
    given the assertion's own logic — not independently executed against a real
    `pg_jsonschema` installation in this session (Appendix).**
64. **An implementer needs a reproducible test vector for `content_digest`/
    `analysis_digest`/`resolution_digest` before writing the actual `plpgsql` bodies.**
    The digest golden-vector table (Decision E.11) gives exact framed-byte inputs and
    their SHA-256 outputs for zero candidates, invalid-only candidates, identical
    duplicates, differing duplicates, and a resolved conflict — computed directly in
    this session against the documented framing, not executed inside PostgreSQL itself
    (Appendix); an implementation can compare its own `plpgsql` output against these
    values directly once written.

65. **A candidate's immutable `initial_exclusion_status` is missing or altered
    relative to what `analyze_adoption` originally wrote.** `candidate_tuple` (Decision
    E.11) binds `initial_exclusion_status` into `analysis_digest`; `finalize_adoption`
    recomputes `analysis_digest` from the stored rows (Decision G.3 step 2) and directly
    re-evaluates the classification invariants (step 4) — either check independently
    catches this, and both agree: `integrity_failure`. The adversarial golden vector
    (Decision E.11's table, "corrupted to `selected`") demonstrates the digest alone
    already changes. **Deterministic.**
66. **`canonical_candidate` is altered by a privileged-function defect while the
    stored `content_digest` column is left unchanged (a stale, matching-in-appearance
    digest).** Decision G.3 step 1's direct recompute of `content_digest` **from the
    stored `canonical_candidate`** — never from the stored `content_digest` column
    itself — catches this before any other check runs: the freshly recomputed digest
    disagrees with the stale stored one → `integrity_failure`, checked per candidate,
    before promotion. This is exactly the gap `analysis_digest`'s own recomputation
    (step 2) would **not** have caught on its own, since that step re-derives
    `analysis_digest` using the stored `content_digest` column as an input, not by
    independently re-hashing `canonical_candidate` — Task 1.2's reason for adding step 1
    ahead of it. **Deterministic.**
67. **`content_digest` is altered without `canonical_candidate` changing (a
    directly tampered digest column, unrelated to its own source value).** Decision
    G.3 step 1 catches this identically to scenario 66 — the recomputed digest from the
    unchanged `canonical_candidate` disagrees with the tampered stored value →
    `integrity_failure`. **Deterministic.**
68. **A conflict row's `details` is altered after `analyze_adoption` created it.**
    `conflict_tuple` (Decision E.11) now binds `details` (via `frame_jsonb_digest`);
    `finalize_adoption`'s `analysis_digest` recompute (step 2) disagrees with the
    stored value → `integrity_failure`. The adversarial golden vector ("altered
    conflict details") demonstrates the digest changes from the baseline row.
    **Deterministic.**
69. **A candidate's `validation_detail` (or an analysis's own, for `validation_failed`)
    is altered after creation.** Both are bound via `frame_jsonb_digest` into
    `candidate_tuple`/the `validation_failed` branch respectively (Decision E.11);
    `analysis_digest`'s recompute disagrees with the stored value → `integrity_failure`.
    **Deterministic.**
70. **An invalid candidate, a valid singleton, or an identical-content group's
    classification is corrupted before `finalize_adoption` runs (e.g. an invalid
    candidate recorded as `initial_exclusion_status = 'selected'`, or a singleton
    recorded as `'pending'`).** Decision G.3 step 4's direct, structural re-evaluation
    of every classification invariant — never inferred from a digest match — catches
    each case independently of whether `analysis_digest` also happens to disagree:
    `integrity_failure`. This is the check that proves these rules were actually
    applied, not merely that the stored bytes are self-consistent with whatever rule
    (correct or not) was applied when they were written. **Deterministic.**
71. **A new profile's `bootstrap_account()` call starts, and acquires the shared lock,
    before `backfill_domain_authority('X', ...)` starts.** Decision H.8's ordering
    proof, branch 1: `bootstrap_account` sees `backfilled_at IS NULL` for `X` (correctly
    inserts no row for it yet) and commits, releasing the lock; `backfill_domain_
    authority` then acquires the lock, and its `INSERT ... SELECT` now sees the new
    profile (already committed) and inserts its authority row for `X` directly.
    **Deterministic — the profile is covered either way.**
72. **`backfill_domain_authority('X', ...)` starts, and acquires the shared lock,
    before the new profile's `bootstrap_account()` call starts.** Decision H.8's
    ordering proof, branch 2: `backfill_domain_authority` completes and commits
    `backfilled_at` for `X`, releasing the lock; `bootstrap_account` then acquires the
    lock, and its own read of `private.adoption_protocols` now sees `backfilled_at IS
    NOT NULL` for `X` (already committed) — its corrected domain filter inserts the
    profile's authority row for `X` directly, even though `X` is still `design_only`.
    **Deterministic.**
73. **A profile bootstraps after `X` is backfilled but before `X` transitions to
    `pilot`.** A special case of scenario 72 — ordering is identical, and the profile's
    authority row for `X` already exists (via `bootstrap_account`'s corrected filter)
    by the time any later `transition_adoption_protocol_status(..., 'pilot')` call could
    possibly succeed. **Deterministic — this is the exact case the prior revision's
    defect left uncovered, now closed.**
74. **Two concurrent `backfill_domain_authority` calls for the exact same `(domain,
    protocol_version)`.** Both attempt the same global lock; the second blocks until
    the first commits, then re-observes the first's already-committed rows. Its own
    `INSERT ... SELECT` re-inserts nothing new (`ON CONFLICT DO NOTHING`), and its
    `NOT EXISTS` check either finds `backfilled_at` already set (its `UPDATE` matches
    zero rows, a harmless no-op) or independently completes the identical proof.
    **Deterministic, no double-processing.**
75. **Two different protocol versions of the same domain both have `backfilled_at IS
    NOT NULL`.** **Corrected (this pass): the prior wording of this scenario claimed
    PostgreSQL would reject a duplicate conflict target from one statement's own output
    "regardless of `ON CONFLICT`" — false, and already contradicted by Decision H.8's
    own corrected text above.** The cardinality-violation restriction applies only to
    `ON CONFLICT DO UPDATE`; this design uses `ON CONFLICT DO NOTHING` throughout, which
    carries no such restriction and simply skips a later source row that conflicts with
    one already processed, without raising anything. So even a bare join producing one
    source row per protocol version (two rows here, for the two versions) would **not**
    error — `DO NOTHING` would silently discard the second, harmlessly. `bootstrap_
    account`'s `SELECT DISTINCT domain` (Decision H.8) collapses the two protocol-version
    rows to one anyway, but for explicit set semantics and avoiding redundant work, not
    because a duplicate target would otherwise be rejected. Either way, the domain's
    authority row is attempted at most once per distinct domain per `bootstrap_account`
    call, and `DO NOTHING` makes a second attempt within the same statement harmless if
    it ever occurred. **Deterministic.**
76. **A crash occurs while either `bootstrap_account` or `backfill_domain_authority`
    holds the shared lock.** The advisory lock is transaction-scoped (Decision H.8); a
    crash rolls back the entire transaction and releases the lock automatically, the
    same as any other transaction-scoped resource — no stale, permanently-held lock
    survives a crash, and the next call (from either function) acquires it normally.
    **Deterministic, no deadlock or permanent block.**
77. **`query_account_domain_authority` is called for a domain whose authority row is
    `cloud_authoritative`, after that domain's protocol has since been `retired`.**
    Decision H.6b's corrected order: step 3 reads the authority row **before** any
    protocol-eligibility check and returns it immediately — `cloud_authoritative`,
    unaffected by retirement. **Never** `domain_not_eligible` — this is the exact defect
    Task 3.1 closes. **Deterministic.**
78. **The same query, but the authority row is `adoption_prepared`.** Identical
    reasoning to scenario 77 — step 3 returns the row as-is, `adoption_prepared`,
    regardless of the protocol's current `activation_status`. **Deterministic.**
79. **The same query, but the authority row is `aborted` or `not_initialized`.**
    Identical reasoning — step 3 returns the row as-is; retirement changes nothing
    about an already-existing authority row of any status. **Deterministic.**
80. **The same query, but no authority row exists at all, and the domain has no
    `pilot`/`production` protocol (whether never-eligible or fully retired with no
    account ever having reached authority for it).** Step 3 finds nothing, so step 4
    runs its eligibility diagnosis and correctly returns `domain_not_eligible` — the
    one case where that code remains correct even under this correction, because there
    is no existing authority row for retirement to have hidden. **Deterministic.**
81. **`begin_adoption`'s first row-lock attempt finds no row; the row appears before
    its re-attempt under the global lock.** Decision H.1 step 2's missing-row branch:
    the re-attempt (holding the global `bootstrap_backfill_serialization` lock) finds
    the row this time — proceeds through the ordinary row-present path (steps 3-5)
    exactly as if it had been found on the first attempt. **Deterministic — no
    `integrity_failure`, no stale diagnosis.**
82. **`bootstrap_account` is concurrently in flight when `begin_adoption` reaches its
    missing-row branch.** `begin_adoption` blocks acquiring the global lock until
    `bootstrap_account`'s transaction commits or rolls back (Decision H.8); it then
    re-attempts the row lock and observes whatever `bootstrap_account` actually
    committed — never a state `bootstrap_account` was still in the middle of writing.
    **Deterministic.**
83. **`backfill_domain_authority` is concurrently in flight when `begin_adoption`
    reaches its missing-row branch.** Identical reasoning to scenario 82 — the global
    lock serializes them; `begin_adoption`'s re-attempt and any subsequent diagnosis
    only ever observes `backfill_domain_authority`'s fully-committed result, never a
    partial one. **Deterministic — this is the exact race Task 2's counterexample
    described, now closed.**
84. **The authority row remains genuinely absent even under the global lock (no
    concurrent bootstrap/backfill was ever in flight).** The re-attempt finds nothing;
    this call then executes **the same H.6b one-statement CTE** (Decision H.6b's own
    query, not a separate re-derivation via its own `profile`/`protocol`/`backfill`
    `SELECT`s) against a snapshot nothing else can be concurrently changing, since any
    such change requires the same global lock this call already holds — and, per
    Decision H.1's own corrected text, a disagreement between that CTE's `authority_row`
    and the immediately preceding `FOR UPDATE` re-attempt (which found no row) is
    itself named and handled (`internal_failure`), never silently reconciled by
    treating the row as still absent. **Deterministic.**
85. **No false `integrity_failure`.** `integrity_failure` is only reachable once
    `begin_adoption` holds the global lock and has re-confirmed, under it, that the row
    is still absent despite `backfilled_at IS NOT NULL` — never from the first,
    unlocked observation. Because no concurrent `backfill_domain_authority` can commit
    while this call holds that lock, the condition it reports cannot have already
    changed by the time it reports it. **Deterministic — the exact property scenario 3
    (Task 2's counterexample) required.**
86. **No deadlock between `begin_adoption`'s missing-row path and `bootstrap_account`/
    `backfill_domain_authority`.** The lock order is one-directional: `begin_adoption`'s
    missing-row path acquires the global lock, then (re-)attempts the authority row's
    lock, in that order; `bootstrap_account`/`backfill_domain_authority` never acquire
    the authority row's own `FOR UPDATE` lock at all (Decision H.8: a set-based
    `INSERT ... SELECT ... ON CONFLICT DO NOTHING`), so neither ever holds that row
    lock while waiting for the global lock — the one ordering that could invert and
    deadlock. **Deterministic, no deadlock, by construction.**
87. **`backfill_domain_authority` commits the authority row and `backfilled_at`
    concurrently with a `query_account_domain_authority` call for the same account and
    domain.** **Corrected (this pass): the prior wording of this scenario asserted a
    real branch outcome ("the read simply reflects not yet inserted for this account")
    without naming what H.6b's own decision tree actually returns for it — replaced
    below with the exact outcome, not a paraphrase.** Decision H.6b's single-statement
    CTE query takes one MVCC snapshot for `profile`/`authority`/`eligible_protocol`
    together, so there are exactly two cases, never a third, mixed one:
    - **The authority-row `INSERT` and the `backfilled_at UPDATE` belong to the same,
      current `backfill_domain_authority` transaction** (the ordinary case — Decision
      K.6's single-transaction body writes both together, Task 4 fixes this function's
      own internal order but not this fact). The query's one snapshot sees either
      **both** before that transaction's commit (the query observes `authority_row IS
      NULL`, and — since this account's own row is exactly what this concurrent
      backfill is about to insert — that read is simply "not yet committed," not an
      integrity problem; the query returns `domain_backfill_incomplete` or
      `domain_not_eligible` depending on what else is visible) or **both** after commit
      (the query observes the authority row directly, `authority_row IS NOT NULL`
      branch). It never observes one without the other from this same transaction,
      because a single statement's snapshot cannot straddle a commit partway through
      it.
    - **`backfilled_at` was already committed by an *earlier*, separate transaction,
      but this specific account's authority row is genuinely absent from the query's
      snapshot.** This is not the same case as above — it means some account/domain
      pair that should already have received its authority row (via `bootstrap_
      account`'s or `backfill_domain_authority`'s own completeness proof, Decision H.8)
      does not have one, in a snapshot where the backfill this proof depends on has
      already fully committed. **H.6b returns `integrity_failure` for this case, exactly
      as its own decision tree specifies** — this is the correct, honest description of
      what this query's snapshot actually shows, not a mixed-time false positive: the
      query is not "in the middle of" observing anything, it takes one snapshot and
      reports exactly what that snapshot contains.
    **If a concurrent repair or a later, separate `backfill_domain_authority`/
    `bootstrap_account` call subsequently inserts the missing row, the earlier call's
    `integrity_failure` was still a correct report of the snapshot it actually
    observed at the time it ran — never retroactively wrong, and never evidence of a
    race in H.6b's own query.** Under the normal bootstrap/backfill serialization
    invariant (Decision H.8's exact proof), this second case should be **unreachable**
    in ordinary operation — every profile that exists once a domain's backfill
    completes is proven, by that same proof, to already hold an authority row for it.
    Reaching this case in practice would mean pre-existing data corruption, a
    privileged manual mutation that bypassed `bootstrap_account`/`backfill_domain_
    authority` entirely, or a genuine defect in one of those two functions — `H.6b`
    reporting `integrity_failure` here is exactly the intended, fail-closed signal for
    that situation, not a bug in the query itself. **Deterministic — no transient,
    false `integrity_failure` can result from a same-transaction race, closing the gap
    Task 3's own counterexample described; a genuine `integrity_failure` from the
    second case above is a real, correctly-reported signal, not a false one.**
88. **A function defect stores two candidates with equal `entity_key` under two
    different `duplicate_group_key` values.** Decision G.3 step 4's derivation
    partitions candidates by `entity_key` first, independent of the stored
    `duplicate_group_key` — the derived partition has two members, but they carry two
    different stored group keys, violating "all members share one non-`NULL` group
    key" (differing-content) or the identical-content group's own single-group-key
    requirement. `integrity_failure`. **Deterministic — a defect a digest match alone
    could not catch, since nothing about the stored bytes being internally consistent
    with each other proves the grouping itself was assigned correctly.**
89. **A function defect stores two candidates with two different `entity_key`s under
    one shared `duplicate_group_key`.** The derivation partitions them into two
    separate `entity_key` groups; the stored group key nonetheless links them —
    violating "that stored group key belongs to this derived partition only."
    `integrity_failure`. **Deterministic.**
90. **A valid singleton's current `exclusion_status` was changed after `analyze_
    adoption` (e.g. to `'excluded_duplicate'`, with no conflict row to justify it).**
    The derivation confirms exactly one valid member for that `entity_key`; the
    verification requires its current `exclusion_status` still be `'selected'` — it is
    not. `integrity_failure`. **Deterministic.**
91. **An invalid candidate is referenced by an `adoption_conflicts` row.** The
    invalid-candidate check requires "never referenced by any conflict" — a structural
    impossibility given `adoption_conflicts`'s own composite FK only accepts members of
    a real duplicate group (Decision E.11), so this would itself require a prior
    defect; if somehow observed, `integrity_failure`. **Deterministic.**
92. **An identical-content group (all members `jsonb`-equal) has an
    `adoption_conflicts` row anyway.** The identical-content check requires "no
    `adoption_conflicts` row exists for this group" — Decision G.4 category 1 groups
    are auto-resolved with no conflict row by design; a conflict row's presence here is
    a defect. `integrity_failure`. **Deterministic.**
93. **A differing-content group has zero, or more than one, matching
    `adoption_conflicts` row.** The differing-content check requires "exactly one"
    matching row — zero means the group was never actually resolved as a conflict
    despite differing content; more than one means duplicate/conflicting conflict
    records for the same group. Either way, `integrity_failure`. **Deterministic.**
94. **The locked `adoption_analyses` row stores `conflict_count = N`, but the actual
    aggregate `count(*)` over `private.adoption_conflicts` for the same
    `(adoption_run_id, analysis_revision)` is `M`, where `M` is within the valid
    `integer` range but `M <> N`.** `resolution_digest`'s own count-validation sequence
    (above) detects this disagreement — comparing `v_conflict_count_bigint` against
    `v_stored_conflict_count_integer::bigint` — **before** `resolution_digest` is
    computed or persisted. `integrity_failure`; the transaction rolls back; no conflict
    `decision` changes, no candidate `exclusion_status` changes, and the analysis does
    not transition to `ready` — `finalize_adoption` remains unavailable for it, since
    step 2 of Decision G.3 still finds no `ready` analysis at this revision.
    **Deterministic.**

**Ninety-four scenario proofs, each traced to exactly one deterministic result and one
mutation outcome, by the reasoning shown — corrected from the prior revision's "all
fifty ... resolve" framing, which asserted this more strongly than this document
actually establishes.** Every proof above is a reasoning argument from this document's
own stated rules, cross-checked internally in this revision's audit pass; none of them
is a claim that the corresponding `plpgsql` has been written and mechanically executed
against a real PostgreSQL/Supabase instance — no such instance was available in this
session (Appendix), and this section does not claim otherwise anywhere.

## Alternatives Considered

Unchanged items from the second revision (Option A/B/D storage rejection, the
`ON CONFLICT DO UPDATE` staging rejection, `kept_local`/`kept_remote`/`kept_both`
rejection, the single-global-UUID-PK rejection, cascade-delete rejection, split-validation
rejection, unattributed-"standard practice" rejection, unverified-default-grant
rejection) all still hold, restated once more against this revision's mechanisms where
relevant. New rejections from this revision:

- **Store staged values as `text`.** Rejected outright — PostgreSQL `text` cannot store
  an embedded NUL byte, which both ADR-0019's fingerprint input and this document's own
  golden vector 5 require (Decision B).
- **Keep `ordered_source_keys` as a `text[]` with an `array_length` `CHECK`.** Rejected
  — the constraint does not actually forbid an empty array (a `NULL` result from
  `array_length` on an empty array passes `CHECK`), nor duplicates, nor `NULL` entries.
  A normalized table with real `PRIMARY KEY`/`UNIQUE` constraints is used instead
  (Decision E.2a).
- **`keep_first_parsed`/`keep_second_parsed` as the duplicate-resolution vocabulary.**
  Rejected — ambiguous the moment three or more candidates share one entity key;
  replaced with `select_candidate_ordinal`/`exclude_duplicate_group`, which generalize
  to any group size (Decision E.11/G.4).
- **Per-entry `stage_adoption_entries`/`resolve_adoption_conflicts` write paths.**
  Rejected — allow a partially-mutated batch on crash and admit non-atomic
  "some entries mismatched, others didn't" outcomes the task explicitly forbids;
  replaced with whole-batch prevalidate-then-write (Decision F.1/G.2).
- **Insert the `abort_and_replace` replacement row before aborting the stale run, or set
  `superseded_by_run_id` before the replacement exists.** Rejected — both violate a real
  constraint (the partial unique index, or the self-referential FK) the moment they're
  attempted; the corrected order (Decision H.2) satisfies both constraints at every
  step.
- **Leave `adoption_analyses` as a summary-only row with no candidate content.**
  Rejected — gives `finalize_adoption` nothing durable to promote from or validate
  conflict decisions against, forcing an unproven re-parse; replaced with the
  materialized candidate table (Decision E.11).
- **Present `FORCE ROW LEVEL SECURITY` as sufficient on its own.** Rejected — `FORCE`
  and `ENABLE` are two separate statements with two separate effects; both are required
  (Decision K.2).
- **Leave `assessment_history_active` without an explicit security mode.** Rejected —
  views bypass RLS by default (confirmed, Appendix); `security_invoker = true` is
  required and explicit (Decision K.3).
- **Filter tombstoned rows only in the view, leaving the base table's own owner
  `SELECT` policy unrestricted.** Rejected — a client could read directly around the
  view; the exclusion is written once, on the base table's policy, and the view
  inherits it via `security_invoker` (Decision K.3).
- **Collapse `service_role` and database-administrator access into one "full" matrix
  column.** Rejected — `service_role` gets exactly three named `EXECUTE` grants and no
  direct table access; `postgres`/emergency administration is a separate, outside-the-
  application-model concern (Decision K.5).

**New rejections from this fourth revision:**

- **Retain base64 as the staging transport, normalizing PostgreSQL's RFC 2045
  line-wrapping instead of switching encodings.** Rejected — normalizing the wrapping
  would only reintroduce the same class of failure the next time a PostgreSQL/libpq
  default changed, and would still require the server to strip whitespace before
  comparing, an extra step hex never needs at all (Decision B, confirmed against the
  PostgreSQL manual).
- **Keep `fingerprint_domain_snapshot`'s `LEFT JOIN`/`COALESCE`-to-null, and rely on
  `analyze_adoption`'s completeness check alone without also hardening the function
  itself.** Rejected — a function silently willing to compute a digest over a partial
  key set is a latent hazard even if every current caller happens to check completeness
  first; the function now refuses on its own, via `INNER JOIN` plus an explicit
  visited/registered count comparison, independent of whether its caller's own check
  was somehow bypassed (Decision B).
- **Leave the `adoption_conflicts` decision `CHECK` as a two-way equality
  (`(decision = 'select_candidate_ordinal') = (selected_candidate_ordinal is not
  null)`).** Rejected — this expression is `NULL`, and therefore satisfied rather than
  violated, whenever `decision IS NULL`; replaced with a total three-way disjunction
  that is never `NULL` for any combination of the two columns (Decision E.11).
- **Trust `content_digest` equality alone as proof that two candidates are duplicates.**
  Rejected — a digest collision between genuinely different `jsonb` content, however
  unlikely, would silently merge two different records; `jsonb` equality is checked
  directly, every time, before any duplicate classification (Decision E.11).
- **Invent a cross-platform canonical-JSON serialization algorithm for candidate
  equality.** Rejected as unnecessary — PostgreSQL's own `jsonb` type already stores a
  decomposed, whitespace/key-order-independent representation, so `jsonb` equality
  already **is** exact structural equality, scoped correctly to this database; nothing
  further needed to be invented (Decision E.11).
- **Let `register_adoption_protocol` rely on a caught `PRIMARY KEY`/`UNIQUE` violation
  to report `malformed_request`.** Rejected — indistinguishable, at the exception-handling
  layer, from a genuine idempotent-retry collision; replaced with total prevalidation of
  the submitted request before any insert is attempted, plus an advisory lock
  distinguishing a true concurrent retry from a malformed request (Decision K.6).
- **Leave `<migration_role>`/`entries[]`/`resolutions[]` as placeholders instead of
  exact, schema-qualified signatures.** Rejected — Decision E's own goal is a normative
  schema contract a reader can check directly, not a design sketch; every RPC signature
  and grant statement now names its exact, schema-qualified form (Decision K.9/M).
  Decision E.7's own creation-order list still abbreviates each step as
  `CREATE TABLE schema.name (...);` — but only as a cross-reference back to that
  table's own, already fully-specified subsection, never as an unresolved placeholder
  standing in for missing design (Decision E's renamed heading makes this distinction
  explicit).

**New rejections from the fifth and sixth revisions (the comprehensive correction
passes):**

- **Key `implemented_canonical_mappings` by `canonical_mapping_version` alone.**
  Rejected — a mapping-version number is chosen independently per domain, so a
  global key lets two unrelated domains' handlers collide by numeric coincidence;
  replaced with a `(domain, canonical_mapping_version)` composite key bound to a
  `regprocedure` (Decision E.2c).
- **Gate `pilot` on "fixture-based evidence" the database checks for.** Rejected — no
  column or query lets a `plpgsql` function observe whether an external, unspecified
  fixture suite passed, and even a full, currently-passing corpus is not proof over an
  unbounded future value space; replaced with an unconditional hard block pending a
  later, separate ADR (Decision E.2b).
- **Describe `backfill_domain_authority` as committing rows one at a time, resumable
  mid-call.** Rejected — no ordinary PostgreSQL function invocation can leave a partial
  subset of its own attempt durable after its own crash; replaced with one set-based
  `INSERT ... SELECT` plus a guarded `UPDATE`, both in the same single transaction
  (Decision K.6).
- **Transport `authority_revision` as a JS `number`.** Rejected — it is `bigint`,
  unbounded over a domain's lifetime, and can exceed `Number.MAX_SAFE_INTEGER`;
  transported as a decimal string everywhere it crosses the JS boundary, the same
  convention ADR-0019 already uses (Decision E.5/H.1).
- **Include `legacy_active` in the server `authorityStatus` enum.** Rejected — it is
  ADR-0019's own client-side, locally-observed concept, never a value
  `private.account_domain_authorities.authority_status` itself holds; removed from the
  server envelope entirely (Decision H.6b/N.1).
- **Acquire `begin_adoption`'s authority lock only when a fast, unlocked lookup finds no
  existing row.** Rejected — a call whose fast lookup *does* find a row would return a
  decision from an unlocked read, unsynchronized with a concurrent `finalize_adoption`/
  `abort_adoption` mid-commit; every call that passes authentication and request-shape
  validation and reaches authority/run-state classification now locks something (the
  row if present, the shared global lock if not) before any such decision is read —
  authentication and request-shape rejection remain outside this locking statement,
  since they return before classification is ever reached (Decision H.1, Task 2, this
  scoping narrowed further this revision).
- **Accept a `resolve_adoption_conflicts` retry against a `ready` analysis by checking
  only that submitted entries agree with their own durable decisions.** Rejected — an
  empty or partial submission would vacuously "match" (nothing to disagree with) and
  falsely report `resolved` without the caller reconfirming the complete set; replaced
  with an exact count/membership/content match (Decision G.2).
- **Grant whole-table `UPDATE` and rely on prose to describe which columns are
  actually mutable.** Rejected — prose does not stop a write; every table's `UPDATE`
  grant now names exactly its mutable columns (Decision K.8).
- **Bind `analysis_digest` to only `content_digest`/group-key/conflict-type arrays.**
  Rejected — leaves `candidate_ordinal`, `entity_key`, `validation_status`,
  `validation_detail`, and the immutable per-candidate exclusion baseline unbound, all
  of which `finalize_adoption` trusts; the framing now covers every immutable
  candidate/conflict field, with explicit record tags (Decision E.11).
- **Reconstruct `createdAt`/`completedAt` from the parsed `timestamptz` instant.**
  Rejected — proves only that today's writer call sites use one specific lexical
  format, says nothing about legacy, imported, or future data; replaced with a verbatim
  source-string column, read back directly (Decision I/E.9).
- **Classify the `jsonb`-representability failure by inspecting `SQLSTATE` or caught
  exception text.** Rejected — nothing in PostgreSQL's own documented error codes
  establishes that a genuine JSON syntax error and this specific representability
  rejection raise two distinguishable `SQLSTATE`s (both plausibly raise the same
  `22032`, Appendix), and message text may additionally be localized; replaced with a
  two-stage `::json` then `::jsonb` cast, whose *sequencing* — not its error content —
  is the classifier, working regardless of which `SQLSTATE` either cast raises
  (Decision I).

## Consequences

The database protocol now has a schema that can losslessly represent every byte
sequence its own fingerprint algorithm is defined over — the `bytea` staging layer
specifically, not a claim about the `jsonb` layer built on top of it, which Decision
E.2b names as a separate, still-open architecture blocker; a protocol registry with
actually-enforceable constraints and one consistent lifecycle; RPC bodies that are
atomic at the batch level, not merely "atomic" in name; a concurrency-correct
`begin_adoption` (its authority-row lock acquired before any row-present decision is
read; a missing row falls back to the shared bootstrap/backfill lock and a re-read
before being classified, never diagnosed from a stale, unlocked observation) and an
executable `abort_and_replace` statement order; a bootstrap/backfill pair that can no
longer leave a profile permanently missing a domain's authority row, serialized on one
shared advisory lock with an exact `NOT EXISTS` completeness proof; an authority query
that returns already-granted authority regardless of a domain's later protocol
retirement, its entire missing-row diagnosis now one single-statement snapshot rather
than sequential `SELECT`s a concurrent backfill commit could interleave with;
a `resolve_adoption_conflicts` whose `ready`-state retry can no longer succeed
vacuously against an empty or partial submission; a materialized analysis/candidate/
conflict model a client can actually query and resolve against, with an
`analysis_digest` that now binds every immutable field finalization *uses* (never
claimed as literally every field a table happens to have); a separate, direct re-hash
of `canonical_candidate` itself (Decision G.3 step 1, checked before `analysis_digest`'s
own recompute trusts the stored `content_digest` at all) and an independently-derived
candidate grouping (Decision G.3 step 4, derived from `entity_key`/`jsonb` equality/
recomputed digest, never trusted from the stored `duplicate_group_key` column) that
together catch a function defect a digest comparison alone could not; a `jsonb`-cast
error classifier that cannot misclassify an unrelated operational failure as an
ordinary validation fact; a `pilot` hard block that fires first, before any other
readiness condition, with no path around it; column-level `UPDATE` grants that match
this document's own immutability claims directly, rather than asserting them only in
prose; a timestamp-fidelity design that preserves the exact source string rather than
resting on a proof scoped to today's writer call sites; an error taxonomy where every
code is meant to have exactly one meaning, systematically cross-checked against
Decision M's RPC inventory, an explicit cross-function terminal-state matrix (Decision
L/L.3a), and an exact ADR-0019 outcome mapping, in this and the prior
revision's own audit passes — not mechanically verified against running code; and an
RLS/grant/view model checked against primary sources rather than asserted from memory.
Nothing about the running application changes: all seven repositories continue to
read/write `localStorage` exactly as before this document was written.

## Relationship to Existing ADRs

Unchanged: ADR-0019 remains the authority/local-adoption protocol source, its
fingerprint algorithm imported verbatim, never redefined. ADR-0013/0014/0015/0016 are
unaffected. ADR-0017/0018 remain Proposed and blocked, independently of this document's
scope. ADR-0013 through ADR-0019 were re-read in full for this revision and are
unmodified.

## Migration Implications

Unchanged: no client-side migration is introduced. The server-side migrations this
document describes are new and unrelated to `MIGRATION_DOMAINS`/
`localStorageToIndexedDbMigration.ts`, which remains exactly as unwired as ADR-0015/0016
left it.

## Unresolved Questions

Unchanged from the prior revision's list (**Decision P's** blockers and governance
items — corrected, Task 7.5: the blockers themselves are listed in Decision P;
Decision Q is the whole-document contradiction audit and scenario-proof section, a
different thing), plus: the exact operationally-configured staging batch/value-size
bound (Decision F.1,
still deliberately left to implementation rather than invented here); whether a future
`assessmentHistory` protocol version might need `source_manifest_extra`-style extension
fields at all, now that the speculative mechanism has been removed rather than fixed —
if one is ever needed, it is an explicit, typed column added via a normal migration, not
a resurrected generic escape hatch; plus, new to this revision: whether an operational
safeguard against `handler_regprocedure` drift (Decision E.2c — a dropped or
incompatibly replaced mapping handler function leaves a stale reference with no
automatic detection, since this is ordinary row data, not a tracked catalog dependency)
is needed before any mapping handler actually ships, or whether migration discipline
alone is sufficient; and whether `backfill_domain_authority`'s single-transaction,
whole-`profiles`-table design (Decision K.6) remains adequate at whatever account
volume this system eventually reaches, or whether a separately-designed, resumable
batched mechanism becomes necessary — neither question is resolved by this document,
which does not invent a mechanism for either without evidence it is needed.

## Appendix: primary sources consulted, with exact statements relied upon

- **PostgreSQL Character Types** — https://www.postgresql.org/docs/current/datatype-character.html —
  "Regardless of the specific character set, the character with code zero (sometimes
  called NUL) cannot be stored." — underlies Decision B's entire byte-representation
  correction.
- **PostgreSQL Binary Data Types** — https://www.postgresql.org/docs/current/datatype-binary.html —
  `bytea` "allow[s] storing octets of value zero and other 'non-printable' octets,"
  supporting the full 0-255 byte range with no character-encoding restriction; hex
  format (`\x`-prefixed) is the default output format — underlies Decision B's
  `bytea`-based staging columns.
- **PostgreSQL Object Identifier Types** —
  https://www.postgresql.org/docs/current/datatype-oid.html — fetched and confirmed
  directly in this session: `regproc`/`regoper` "will only accept input names that are
  unique (not overloaded)... for most uses `regprocedure`... [is] more appropriate,"
  and `regprocedure` disambiguates by argument types (its own example: `'"Foo"(int,
  integer)'::regprocedure`) — confirming Decision E.2c's choice of `regprocedure`
  specifically, not `regproc`, to avoid an ambiguous-overload insertion. **Dependency
  tracking is more specific than this document's own first draft of this citation
  assumed, and is corrected here:** "if a constant of one of these types appears in a
  **stored expression** (such as a column default expression or view), it creates a
  dependency on the referenced object" — but `private.implemented_canonical_mappings.
  handler_regprocedure` is an ordinary column holding **row data**, not a column
  `DEFAULT` expression or a view/rule definition, so this dependency-tracking behavior
  does not apply to it: PostgreSQL's own input-time lookup still guarantees the named
  function existed at `INSERT` time (a plain type-input-function fact, true for every
  type), but no `pg_depend` entry is created for an ordinary data value the way one
  would be for, e.g., a column default using `nextval(...::regclass)` — so a later
  `DROP FUNCTION`/incompatible `CREATE OR REPLACE FUNCTION` against the referenced
  handler is not blocked by, or reflected in, this already-stored value, exactly as
  Decision E.2c states.
- **Row Level Security** — https://supabase.com/docs/guides/database/postgres/row-level-security —
  "Views bypass RLS by default because they are usually created with the `postgres`
  user"; `security_invoker = true` (Postgres 15+) makes a view respect RLS for
  `anon`/`authenticated`; for older versions, "either revoke access from client roles or
  place views in unexposed schemas"; "on existing projects, a new table in `public`
  starts with every privilege already granted to all three roles" — underlies Decision
  K.3's view-security fix and Decision K.4's corrected default-grant model (the three
  roles being `anon`/`authenticated`/`service_role`).
- **Database Functions** — https://supabase.com/docs/guides/database/functions —
  "by default, database functions can be executed by any role"; explicit `REVOKE
  EXECUTE ... FROM PUBLIC`/named roles for already-created functions — underlies
  Decision K.9.
- **`ALTER DEFAULT PRIVILEGES`** —
  https://www.postgresql.org/docs/current/sql-alterdefaultprivileges.html — confirmed
  directly in this session: a schema-scoped `ALTER DEFAULT PRIVILEGES ... IN SCHEMA
  ... REVOKE ...` statement only changes the default for that schema; it cannot remove
  the schema-unscoped, built-in global `PUBLIC EXECUTE` default on functions, which
  requires its own schema-unscoped statement — underlies Decision K.9's two-statement
  correction (a schema-unscoped revoke for the global `PUBLIC` default, a separate
  schema-scoped revoke for Supabase's `anon`/`authenticated`/`service_role` defaults).
- **`pg_jsonschema`** — https://github.com/supabase/pg_jsonschema — confirmed directly
  in this session: exact registered signatures `jsonb_matches_schema(schema json,
  instance jsonb) returns bool` and `jsonschema_is_valid(schema json) returns bool` —
  **the schema argument is `json`, not `jsonb`**, in both. This corrects the prior
  revision's `(jsonb, jsonb)`/`(jsonb)` signatures, which do not exist — underlies
  Decision E.2/E.13/I/K.17's exact casts and grants.
- **PostgreSQL JSON Types** — https://www.postgresql.org/docs/current/datatype-json.html —
  confirmed directly in this session: "the input function for `jsonb` is stricter [than
  `json`]: it disallows Unicode escapes for characters that cannot be represented in
  the database encoding. The `jsonb` type also rejects the six-character JSON escape
  sequence for U+0000 — a backslash, the letter u, and four `0` digits — (because that
  cannot be represented in PostgreSQL's `text` type), and it insists that any use of Unicode
  surrogate pairs to designate characters outside the Unicode Basic Multilingual Plane
  be correct" — underlies Decision B/E.2b's `jsonb`-representability architecture
  blocker and the correction to scenario 23.
- **PostgreSQL Error Codes** — https://www.postgresql.org/docs/current/errcodes-appendix.html
  — fetched and confirmed directly in this session, twice: (1) Class 22 (Data
  Exception) lists a JSON-specific code, `22032 invalid_json_text`, distinct from the
  fully generic `22P02 invalid_text_representation` most other type-input failures
  raise — underlies Decision I's classifier correction; (2) Class 22 also lists
  `22021 character_not_in_repertoire` and `22P05 untranslatable_character`, the codes
  PostgreSQL's own encoding-conversion functions (including `convert_from`) raise —
  underlies Decision I/Task 4's `SQLSTATE`-gated inner exception block around the
  UTF-8 decode step, using the same "Class 22" gating principle. **This document does
  not claim the cited page establishes which exact code (or codes) apply to every
  `json`/`jsonb`-cast failure this ADR discusses, nor that a genuine syntax error and
  `jsonb`'s stricter-than-`json` representability rejection are assigned two
  distinguishable `SQLSTATE`s** — Task 4's correction deliberately does not depend on
  that unresolved question: it gates on the **class** (`22`) common to all four cited
  codes, re-raising anything outside that class to become `internal_failure`, and
  collapses the finer syntax-vs-representability distinction into one named result
  (`json_parse_or_representability_failed`, Option B) pending live verification of the
  exact code(s), rather than asserting a distinction this citation does not establish.
- **PostgreSQL `INSERT`** — https://www.postgresql.org/docs/current/sql-insert.html —
  fetched and confirmed directly in this session (Task 7): "`INSERT` with an `ON
  CONFLICT DO UPDATE` clause is a 'deterministic' statement. This means that the
  command will not be allowed to affect any single existing row more than once; a
  cardinality violation error will be raised when this situation arises" — stated only
  for `DO UPDATE`; `ON CONFLICT DO NOTHING` carries no equivalent restriction and
  raises no error when two rows from the same statement's own source would conflict
  with each other — underlies Decision H.8/K.6's correction that `SELECT DISTINCT
  domain` is justified by explicit set semantics and avoiding redundant work, never by
  preventing a cardinality error `DO NOTHING` does not raise.
- **PostgreSQL PL/pgSQL Control Structures** —
  https://www.postgresql.org/docs/current/plpgsql-control-structures.html — fetched
  and confirmed directly in this session (Task 5): "the special condition name
  `OTHERS` matches every error type except `QUERY_CANCELED` and `ASSERT_FAILURE`" —
  underlies Decision I's corrected, narrower claim that `EXCEPTION WHEN OTHERS` does
  not literally catch every possible PostgreSQL condition.
- **Edge Functions** — https://supabase.com/docs/guides/functions — treat Postgres "like
  a remote, pooled service" — underlies Decision I's rejection of a split
  Edge-Function/database validation boundary.
- **Managing User Data** — https://supabase.com/docs/guides/auth/managing-user-data —
  "If the trigger fails, it could block signups" — underlies Decision H.8's explicit-RPC
  bootstrap choice.
- **Why is my service role key client getting RLS errors or not returning data?** —
  https://supabase.com/docs/guides/troubleshooting/why-is-my-service-role-key-client-getting-rls-errors-or-not-returning-data-7_1K9z —
  "A Service Key bypasses RLS only when the request carries no user access token" —
  scenario proof 19 (unchanged from the prior revision).
- **PostgreSQL `CREATE TABLE`** — https://www.postgresql.org/docs/current/sql-createtable.html —
  composite foreign keys require a matching `UNIQUE`/primary-key constraint on the
  referenced columns exactly; `DEFERRABLE`/`INITIALLY DEFERRED` exist but are distinct
  from, and not needed by, this ADR's two-phase `ALTER TABLE` order — underlies Decision
  E.7 and every composite FK in Decision E.
- **PL/pgSQL Structure** — https://www.postgresql.org/docs/current/plpgsql-structure.html —
  an `EXCEPTION` clause forms a subtransaction rolling back everything in its own block
  — underlies Decision I's exception-handling rule.
- **PostgreSQL `bigint` overflow behavior** — standard, core integer semantics (raises
  rather than wraps); general enough to state without a fetched citation, as in the
  prior revision — underlies Decision H.7.
- **Golden fingerprint vectors** — recomputed in this session with an independent
  Python implementation and cross-checked against the previously published digests; all
  ten confirmed unchanged (Decision B).
- **PostgreSQL Binary String Functions** — https://www.postgresql.org/docs/current/functions-binarystring.html —
  confirmed directly in this session: `encode(bytea, 'base64')` "follows RFC 2045
  Section 6.8" and its "encoded lines are broken at 76 characters"; `decode()` "ignores
  carriage return, newline, space, and tab characters" on input, meaning a client's
  exact-length base64 string and PostgreSQL's own wrapped re-encoding of the same bytes
  are never byte-for-byte equal once the input exceeds 76 encoded characters. The `hex`
  format's own documented definition, by contrast, describes it as a direct sequence of
  two hex digits per input byte — no RFC citation, no line-length limit, and no
  wrapping behavior named anywhere in that definition, unlike `base64`'s explicit RFC
  2045 line-wrapping clause. **Corrected: this document does not treat that absence of
  a wrapping clause, by itself, as proof no wrapping exists** — documentation silence
  confirms nothing on its own. What actually establishes it is scenario proof 37's
  golden vector 9 (200,000 bytes): its `pg_catalog.encode(bytea, 'hex')` output is
  observed, directly, to be one contiguous 400,000-character string with no embedded
  newline, and to decode/re-encode back to the identical string — an empirical
  confirmation for the one input size this document actually exercises, not a
  documentation-derived guarantee for every possible input. `encode()` "outputs hex
  digits a-f in lowercase" while `decode()` "accepts a-f in either upper or lower case,"
  which is exactly what makes Decision B's lowercase-only regex plus
  decode-then-re-encode-then-compare check correctly reject an uppercase (but otherwise
  valid) hex string as non-canonical. This is the primary source underlying this
  revision's entire base64-to-hex correction (Decision B, scenario proofs 35/37).
- **`pg_advisory_xact_lock`** — standard, well-documented core PostgreSQL functionality
  (an application-level advisory lock scoped to the current transaction, released
  automatically at commit or rollback) — general enough to state without a fetched
  citation, used here (Decision K.6) specifically because `register_adoption_protocol`
  needs to serialize concurrent attempts against a `(domain, protocol_version)` key
  before any row for that key exists to take an ordinary row-level lock on.
- **No disposable PostgreSQL environment was available in this session** (no `docker`,
  `psql`, or `supabase` CLI found on this machine) — every SQL fragment in this document
  is a **normative migration blueprint** — a partial DDL contract pending
  implementation and live PostgreSQL execution, not mechanically-proven-executable
  DDL. This is stated explicitly here, in the Status section, and in the final report
  for this revision, rather than left implied.

---

Everything above is a proposal. No package was installed, no migration was written, no
environment variable was introduced, no authentication was implemented, no runtime
repository wiring changed, and no domain — including Assessment — became
cloud-authoritative as a result of this document.
