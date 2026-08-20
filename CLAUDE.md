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
