# Architecture Decision Records

Short records of decisions that are easy to accidentally undo while making an
unrelated change. Each ADR is deliberately small. If a future change conflicts with one
of these, either the change is wrong or the ADR is outdated — update the ADR
explicitly rather than silently drifting away from it.

See `docs/SYSTEM_ARCHITECTURE.md` for the full current-implementation context these
decisions live in, and `docs/DOMAIN_GLOSSARY.md` for term definitions.

| ADR | Decision |
|---|---|
| [0001](0001-shot-target-stored-per-shot.md) | Every shot stores its own `targetTime`; the block's target is only a default/starting value |
| [0002](0002-blind-draft-is-not-a-shot.md) | An in-progress Blind Weight entry is a local draft, not a `Shot`, until Review is saved |
| [0003](0003-external-release-time-behind-input-boundary.md) | Manual and future external release-time input share one boundary function, gated by phase |
| [0004](0004-smart-random-is-measurement-mode-dependent.md) | Smart Random is configured per block and per measurement mode, never shot-type profiles, never cross-mode fallback |
| [0005](0005-legacy-migration-idempotent-and-value-preserving.md) | Migration never overwrites an existing shot value and must be safe to run repeatedly |
| [0006](0006-capture-sequences-share-the-timing-result-boundary.md) | Simulator, manual fallback, and future real hardware all deliver Capture Sequence shots through one normalized `TimingResult` boundary; no parallel shot-save path |
| [0007](0007-capture-result-processing-is-serialized-and-atomic.md) | Capture Sequence results are processed one at a time via a Promise queue and one pure atomic transition; a persisted sequence is reconciled against real shots on every load |
| [0008](0008-accuracy-thresholds-are-snapshotted-per-training-block.md) | Accuracy Thresholds (On Target / Acceptable / Major Miss) are snapshotted per Training Block at creation, never re-derived from the app's current default |
| [0009](0009-platform-navigation-is-in-memory-view-state.md) | Platform navigation stays an in-memory view-state (no routing); only leaving Train while work is unsaved is guarded; Home is the default view and is not persisted, except when an active Capture Sequence survived reload |
| [0010](0010-assessment-domain-foundation.md) | Assessments are a separate domain (own types, own `localStorage` key) from Training Sessions; a Run holds a deep, immutable snapshot of the template it was created from |
| [0011](0011-assessment-capture-ownership-and-app-shell-integration.md) | Assessment execution shares Training's TimingResult subscription under a status-derived capture-ownership rule; leaving Assess pauses (never cancels) an active run; Assessment gets its own load/save effect pair mirroring Session's |
| [0012](0012-training-plans-domain-and-execution-model.md) | Training Plans use lazy Block creation and a session-snapshot execution state (never a live plan reference); plan/step types live centrally in `src/types/index.ts` to avoid a domain-type cycle; `Session.planExecution` migration discards-not-repairs like Assessment; progression is always keyed by stored `blockId`, never array position |
| [0013](0013-application-owned-persistence-repository-boundary.md) | **Accepted.** Domain-facing, application-owned repository boundaries (one per persisted domain) wrap the existing `localStorage` implementation unchanged, in preparation for a later IndexedDB adapter and a future sync layer above local persistence — see `docs/PERSISTENCE_BOUNDARY_DESIGN.md` |
