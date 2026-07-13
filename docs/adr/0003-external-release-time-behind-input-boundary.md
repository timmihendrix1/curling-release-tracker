# ADR-0003: Manual and future external release-time input share one boundary

## Status

Accepted. Implemented for manual input; prepared, not built, for external input.

## Context

Blind Weight's core rule is that the actual release time must never be visible to the
app (and therefore the player) before their prediction is locked. Today, that value is
always typed in manually. A future integration with an external timing device is an
explicit product direction (see `docs/PRODUCT_DIRECTION_AND_PRINCIPLES.md`: "manual
entry and future sensors share one domain flow"), but no device, protocol, or
manufacturer has been chosen or even identified yet.

## Decision

There is exactly one function through which a measured release time enters the Blind
Weight state machine: `setMeasuredReleaseTime(draft, releaseTime, source)`, where
`source: "manual" | "external"`. The function only takes effect while the draft is in
the `measure` phase; called at any other time, it is a no-op.

The state machine (`blindWeight.ts`) has no knowledge of *where* a value came from
beyond this tag — no input-field reference, no UI coupling, no assumption about a
transport or protocol.

## Consequences

- A future device adapter would call the exact same function with `source: "external"`
  — the state machine does not need to change to support it.
- The one rule that must hold regardless of source — no measured time visible before
  the prediction is locked — is enforced structurally (by the phase guard), not by
  convention at each call site.
- A reading arriving before `measure` is reached is currently discarded, not buffered.
  This is a deliberate scope limit, not a design flaw: buffering behavior depends on
  real device characteristics (does it resend? how late can a reading arrive?) that
  aren't known without a real device to test — see
  `docs/EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md`.
- `source` is accepted but not currently persisted on the draft or the saved `Shot` —
  there is no product need for it yet; adding it later is additive, not a breaking
  change to this boundary.
