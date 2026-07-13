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
