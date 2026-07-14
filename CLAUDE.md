## Project direction

Before making substantial changes to the data model, persistence, training logic,
analytics, device integrations, mobile architecture or team functionality, read:

- `docs/PRODUCT_DIRECTION_AND_PRINCIPLES.md`
- `docs/SYSTEM_ARCHITECTURE.md` (includes the "Current Implementation Snapshot" —
  the actual domain model, target model, Blind Weight state machine, and data flows)
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
- **Document what you decide.** A new architectural decision gets a short ADR in
  `docs/adr/`; a new/changed domain concept gets a glossary entry; a changed flow gets
  the relevant section of `SYSTEM_ARCHITECTURE.md` updated. Prefer updating the existing
  document over creating a new one with overlapping content.
