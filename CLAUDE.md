## Project direction

@docs/AI_DEVELOPMENT_WORKFLOW.md

## Implementation-agent role

Claude is the repository's implementation agent.

Claude must:

- implement only the approved prompt
- audit the governing code and documents before editing
- stop when a required product decision is unresolved
- preserve existing user changes
- avoid unrelated refactoring
- test negative and failure paths
- perform a broad self-review before reporting completion
- leave every change unstaged and uncommitted
- never push or open a pull request
- never inspect or expose `.env.local`

Claude must not reinterpret product decisions, expand the feature scope, or treat its own final report as proof of correctness.

Before making substantial changes to the data model, persistence, training logic,
analytics, device integrations, mobile architecture, navigation/screen structure, or team
functionality, read:

- `docs/PRODUCT_DIRECTION_AND_PRINCIPLES.md`
- `docs/PLATFORM_NAVIGATION_AND_HOME_EXPERIENCE.md` (long-term navigation model and Home
  content — check its "Implementation Status" section for what's actually built vs. still
  aspirational)
- `docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md` — the authoritative product and
  domain source for Assess (assessment purpose, domain model, Release Time Core
  Assessment v1, execution/comparison rules, future direction). Read this before any
  Assessment-related work, in addition to the documents above.
- `docs/SYSTEM_ARCHITECTURE.md` (includes the "Current Implementation Snapshot" —
  the actual domain model, target model, Blind Weight state machine, data flows, and the
  "Platform Navigation" section)
- `docs/DOMAIN_GLOSSARY.md`
- `docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md` — the canonical
  product source for the mandatory identity requirement, minimal onboarding,
  Profile-scoped ownership, offline behaviour after onboarding, and the Free Cloud Core
  (accepted; **B0.2 identity/onboarding gate implemented and mounted; B0.3 Profile-scoped
  sporting persistence remains required before release** — see the Working rules entry below)
- `docs/adr/` for the reasoning behind existing architectural decisions
- `docs/TECHNICAL_DEBT_AND_ROADMAP.md` before deciding whether something is worth fixing now

These documents define the long-term product direction, architectural constraints,
shared domain terminology, and prior decisions. Do not modify
`PRODUCT_DIRECTION_AND_PRINCIPLES.md`, `SYSTEM_ARCHITECTURE.md`, or `DOMAIN_GLOSSARY.md`
unless the task explicitly requests it — but if a task changes the data model or a core
flow, update the relevant document(s) and/or add an ADR as part of that same task.

For any task touching user-facing text, UI, analytics interpretation, or coaching
copy, also read:

- `docs/UX_WRITING_GUIDELINES.md`
- `docs/DESIGN_SYSTEM.md`
- `docs/COACHING_PRINCIPLES.md`

In particular: user-facing text follows the UX Writing Guidelines; UI changes follow
the Design System; analytics interpretations and any coaching-style statements follow
the Coaching Principles. A new feature must explain what it does, why it exists, and
how to use it well (progressive disclosure via the existing Info-button system, not a
wall of permanent text) — see "Every feature should explain itself" in the UX Writing
Guidelines. Observations (measured facts) and interpretations (possible explanations)
must never be mixed in the same sentence or presented with equal certainty — see
"Separate facts from interpretation" in the UX Writing Guidelines and "Never diagnose
technique directly" in the Coaching Principles.

## Working rules

- **Use existing domain terms consistently** (see `DOMAIN_GLOSSARY.md`). Don't invent a
  new name for a concept that already has one — e.g. Target Time vs. Default Target vs.
  Pending Target are distinct and must not be conflated.
- **Never rewrite an already-recorded shot's `targetTime`, `releaseTime`, or
  `predictedTime`** as a side effect of a later change (a block's target changing, a
  range edit, a migration). Corrections must be explicit and visible.
- **Think migration whenever the data model changes.** New optional fields need a
  backfill rule in `sessionMigration.ts`, a test for it, and idempotency must still hold
  (migrating already-migrated data twice must be a no-op). Never fabricate a value
  migration can't know (e.g. don't invent `predictedTime` for old shots).
- **Don't invent Hog-Hog Smart Random ranges, hardware protocols, or other
  looks-real-but-isn't values.** An explicit "not available yet" beats a guessed number.
- **Manual entry and future sensor input share one domain flow.** Any change to how a
  measured value gets into the app should go through the same boundary a future device
  would use (see `setMeasuredReleaseTime`, the `TimingProvider`/`TimingResult` boundary
  in `src/lib/timingProvider.ts`/`captureSequence.ts`, and
  `docs/EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md`), not a parallel path. A test-only
  stand-in for real hardware (e.g. the Timing Simulator) must implement the same
  provider contract as the real thing would, not a shortcut that feeds a different code
  path — see ADR-0006.
- **Bridging an external async subscription into React state:** subscribe inside a
  `useEffect` and call `setState` from the subscription's callback — never
  synchronously in the effect body. This is the sanctioned pattern in this codebase
  (used by the Timing Simulator wiring in `TrackerApp.tsx`) and does not trip the
  `react-hooks/set-state-in-effect` lint rule.
- **Refs are synced via a `useEffect`, never by mutating `.current` during the render
  body.** This project's lint config (`react-hooks/refs`) flags render-body ref
  mutation even for the otherwise-endorsed "adjust during render" pattern (see
  `ShotEntry.tsx`'s local *state* version, which is unaffected — this rule is specific
  to refs).
- **Serializing rapid/concurrent external events (e.g. results from a `TimingProvider`)
  does not need a new state-management library.** A small Promise queue
  (`captureQueueRef.current = captureQueueRef.current.then(...)`) plus an authoritative
  ref mirror of the relevant state, written synchronously by every handler that mutates
  it, is enough — see ADR-0007 and `docs/SYSTEM_ARCHITECTURE.md`'s "Race conditions and
  serialized result processing." Do not rely on React's `setState`-updater timing (queued
  functional updaters chain correctly, but are not guaranteed to run *synchronously* at
  dispatch time) for anything that needs a synchronous read of a transition's outcome.
- **A state transition triggered by an external event (a save, a capture result) should
  be one pure function: old state + event → new state**, computed outside of any
  `setState` call and then committed as a plain value — not assembled across several
  separately-observable `setState` calls. See `applyTimingResultToSession` in
  `src/lib/captureSequence.ts` for the pattern (ADR-0007).
- **Top-level navigation is config-driven and in-memory, not routed.** New sections go
  into `src/lib/navigation.ts`'s `NAVIGATION_ITEMS` (with `availability: "hidden"` until
  the screen actually exists); leaving Train while a Blind Weight draft is unsaved or a
  Capture Sequence is active, and leaving Assess while a Run is actively warming up or
  scoring, are both guarded — reuse `guardLeavingActiveWork` (now composing three
  guards: Blind draft, Training Capture, Assessment), don't invent a new per-section
  guard. See `docs/adr/0009` and `docs/adr/0011`.
- **Assessments are their own domain, not a Training Session in disguise.** Before any
  Assessment-related implementation, read
  `docs/ASSESSMENT_PRODUCT_AND_DOMAIN_SPECIFICATION.md` — it is the authoritative source
  for Assessment product logic and domain rules. Existing Training, Timing, and
  Analytics infrastructure (Timing Provider/Timing Result, chart components, metric
  utilities) may be reused, but Assessment Run, Assessment Template, and Assessment
  Attempt must not be modeled as, or substituted by, ordinary Training Session/Training
  Block/Shot semantics — Assessments need immutable completed runs, template
  versioning, invalid-attempt/protocol-deviation history, and comparison eligibility
  that Training Sessions don't. Any change touching assessment protocols, versioning,
  comparability, or persistence must be checked against that specification, and an
  Assessment Template version must never be changed in a way that silently alters its
  meaning (a semantic change requires a new version). A new ADR is only needed for a
  genuine, novel long-term architectural decision — not merely because this document
  exists. **The domain + persistence foundation (Phase A) already exists** in
  `src/lib/assessment/` (types, the official Release Time Core Assessment v1 template,
  Run state machine, attempt semantics, metrics, comparison eligibility, persistence and
  migration — see `docs/adr/0010-assessment-domain-foundation.md` and
  `docs/SYSTEM_ARCHITECTURE.md`'s "Assessments" section) — build on it rather than
  re-deriving equivalent types or persistence elsewhere. **The Release Time Core
  Assessment v1 execution flow (Phase B) is now implemented**: Assess is a real,
  active navigation item; `AssessScreen.tsx` (plus its Assessment-prefixed
  sub-components) drives Landing → Overview → Guided Introduction → Threshold/Setup →
  Warm-up → Scored Execution → Pause/Resume/Abandon → Completion Summary entirely
  through the Phase A domain functions; capture is routed through the same shared
  `TimingProvider`/`TimingResult` boundary as Training, under one active-capture-owner
  rule (see `docs/adr/0011-assessment-capture-ownership-and-app-shell-integration.md`).
  **The Result screen and Analyze integration (Phase C) are now implemented**:
  `AssessmentResultScreen.tsx` (plus its Assessment-prefixed sub-components) renders a
  full, derived result view for one completed/incomplete run — threshold-independent
  and threshold-dependent metrics, block/target/handle/Variable-Adaptation breakdowns,
  Protocol Integrity, an Original/Standard/Tight/Custom Analysis Threshold control, run
  comparison, and development trends — computed on demand from
  `src/lib/assessment/result.ts`, never persisted as a second source of truth (see
  `docs/adr/0010`'s Decision 4). It's reachable from the Completion Summary's "View
  Full Results", `AssessmentLanding`'s "Latest Completed Assessment" card, and a new
  Assessments tab under Analyze (`AssessmentAnalyze.tsx`), and is mounted from
  `TrackerApp.tsx` as a read-only overlay that never mutates a run except through the
  explicit, whole-run `deleteAssessmentRunFromHistory`. Not yet built: benchmarking, a
  synthetic overall score, athlete-level classification, a Custom Assessment editor, or
  coach/team features — see `docs/TECHNICAL_DEBT_AND_ROADMAP.md`'s "Assessment
  Framework" section (which also documents one known Phase C limitation: returning from
  the Result Screen to Assess remounts `AssessScreen`, losing an in-flight Completion
  Summary in favor of Landing — the archived run itself is unaffected).
- **The Exercise Library is curated content, not an execution feature — yet.**
  `docs/EXERCISE_LIBRARY_AND_EXECUTION_SPECIFICATION.md` is the authoritative product
  and domain source; read it before any Exercise-related work. **Stage A is
  implemented** in `src/lib/exercises/` (stable `Exercise` identity vs. immutable
  `ExerciseVersion`, the independent classification dimensions, participation/sweeping
  requirements, reusable versioned Measurement Protocols, both Diagram variants, the
  untrusted-content validation boundary, lookup, query and English labels) plus a
  read-only Train UI (`ExerciseLibrary.tsx`, `ExerciseDetail.tsx` and the other
  `Exercise*`-prefixed components, reached from `TrainLanding.tsx`'s third entry path).
  See `docs/SYSTEM_ARCHITECTURE.md`'s "Exercise Library" section. Stage A **stores
  nothing**: no storage key, no repository, no migration, no `Session`/`TrainingBlock`/
  `Shot` change, and no start action anywhere. Still **Planned**, per that
  specification's section 21: Exercise execution, results/attempts/private Athlete Notes
  and their persistence, multi-athlete Team execution and offline upload, Training Plan
  integration, and the remaining six approved catalogue Exercises. Build on the existing
  domain rather than re-deriving equivalent types, keep the detail renderer generic
  (branch on declared domain semantics — focus, guidance `kind`, diagram `kind` — never
  on an Exercise id or title), and read
  `docs/adr/0023-restricted-source-asset-delivery-boundary.md` before touching anything
  to do with a restricted source image: no Swiss Curling asset exists in this repository,
  and a restricted asset may only ever be reached through an opaque reference plus an
  explicitly authorized resolver that fails closed.
- **Identity and Profile-scoped local persistence are mandatory and implemented.** Before any work touching authentication, onboarding,
  identity scope, local-persistence scope, cloud persistence, entitlements, sync status,
  or account deletion, read
  `docs/MANDATORY_IDENTITY_AND_FREE_CLOUD_FOUNDATION_SPECIFICATION.md` (the canonical
  product source) and `docs/adr/0024-mandatory-identity-and-free-structured-cloud-foundation.md`
  (**Accepted architecture/product direction — B0.2 identity/onboarding gate and B0.3
  Profile-scoped local sporting persistence implemented; combined review pending**), plus
  `docs/adr/0026-profile-scoped-local-sporting-persistence.md` before changing local scope.
  The accepted target: a
  `UserAccount` **and** a completed personal `Profile` are required to reach the app (no
  Profile, no access — Free is a tier, not an exemption); `Profile.id` is an
  application-owned UUID and is the scope key for athlete-owned data, local persistence,
  cloud authority and recorder attribution (never the auth-provider user id); training runs
  fully offline **after** authenticated onboarding on that device; and all supported
  structured raw sporting data is cloud-persisted for **Free** (the **Free Cloud Core**),
  with the paid personal tier selling *derived* analysis — its final commercial name is
  undecided, so don't rename it. Legacy unscoped local data is **disposable**: it is
  discarded once by Stage B0.3, never adopted/imported/merged, which retires ADR-0016/0017/
  0018's copy-migration and activation track as the forward path (ADR-0015's adapter stays
  valid; **delete no dormant code**). ADR-0019/ADR-0020's **Local Adoption is not the
  forward path**, and ADR-0020's open Decisions E.2b/E.2c are **not gates on B0.4** — B0.4
  designs and verifies its own schema, representability, mapping, upload and RLS. ADR-0020's
  authority-scope *choice* is **closed (Profile-scoped)**; only its own unperformed
  reconciliation to that scope remains. **ADR-0021**'s draft/history split stays an accepted
  constraint, but its legacy-key migration, retained residue and ADR-0016 marker
  registration are retired — B0.3/B0.4 establish **fresh** Profile-scoped draft/history
  persistence for post-onboarding data. Staging is B0.1 (documentation — done) → B0.2
  (identity/onboarding gate) → B0.3 (Profile-scoped Local Data) → B0.4 (Free cloud
  backbone, **requiring real database execution**) → Exercise Stage B. **B0.2 and B0.3 are
  two implementation scopes but ONE releasable privacy unit**: B0.2 added mandatory
  authentication and account switching while, in that stage alone, the seven repositories
  still shared one identity-unscoped `localStorage` workspace. Releasing B0.2 alone would
  therefore have let a second authenticated account in the same browser read the first
  account's sporting data. B0.3 now supplies the required Profile isolation; the combined
  unit still requires its release review before being called releasable.
  B0.2's account-switch review proves auth/onboarding state transitions only, not
  sporting-data confidentiality. Never "fix" this by importing/adopting/assigning the
  unscoped data (it is discarded in B0.3), never move disposal into B0.2, and don't invent a
  flag or deployment mechanism in a documentation pass. Athlete capability and the Free
  entitlement are granted by **completed onboarding**, never by a Profile merely existing.
  **B0.2 is now implemented and mounted platform-wide**: `IdentityProvider` is the one
  application-level authority, the sporting shell does not mount before a correlated
  ready verdict, email OTP and Google entry are visible at the gate, and personal
  onboarding is the only browser-accessible Profile creation/completion flow. The old
  `useSupabaseAuthController`/`AccountControl` cluster and Team-local Profile bootstrap
  are retired; a forward migration revokes browser execution of `bootstrap_profile`.
  **B0.3 is now implemented:** all ten logical sporting keys pass through an immutable
  adapter namespace bound to canonical `Profile.id`; production composition is identity
  gate → keyed Profile persistence boundary → sporting app; the former unscoped keys are
  retired content-blind behind a completion marker. Never add a production component
  import of the unscoped repository singletons or a mutable active-Profile pointer. The
  combined B0.2+B0.3 unit still requires independent review before release. Existing
  Exercise and Team routing guidance above still applies unchanged.
- **Keep current implementation and future vision clearly separated** in whatever you
  write or say — state which of *Implemented*, *Prepared*, *Planned*, or *Open decision*
  something is, rather than presenting a plan as if it already exists.
- **Stay inside the scope of the task.** Don't fold in unrelated features, refactors, or
  renames just because you're in the area — flag them instead (see
  `docs/TECHNICAL_DEBT_AND_ROADMAP.md`).
- **Before finishing any task that touched code, run:**
  ```bash
  npm run build
  npx tsc --noEmit
  npm test
  npm run lint
  npm run test:e2e   # if the change touches UI flows; see tests/e2e/
  ```
  Treat any *new* failure as blocking. A pre-existing, already-documented issue (see
  Technical Debt doc) doesn't need to be fixed as a side effect of an unrelated task.
- **Document approved decisions and implementation consequences within the approved scope. Do not independently settle unresolved product decisions.** A new architectural decision gets a short ADR in
  `docs/adr/`; a new/changed domain concept gets a glossary entry; a changed flow gets
  the relevant section of `SYSTEM_ARCHITECTURE.md` updated. Prefer updating the existing
  document over creating a new one with overlapping content.
