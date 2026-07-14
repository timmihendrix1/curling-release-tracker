# ADR-0004: Smart Random is measurement-mode-dependent, never shot-type-profiled, never cross-mode

## Status

Accepted. Implemented.

## Context

Back-Hog and Hog-Hog measure physically different things (release-to-hog distance vs.
full hog-to-hog distance). An earlier iteration of Smart Random used a single global
target range shared across both measurement modes — this was a real, shipped bug: it
silently applied Back-Hog-shaped numbers to Hog-Hog training, which is not a smaller
version of the same mistake, it is a category error (like sharing a range between
seconds and meters).

Separately, it was considered whether Smart Random's target range should also vary by
shot type (draw vs. takeout). This was evaluated and rejected for the current entry
flow: the target for the next shot is generated and shown *before* the player picks a
shot type for that shot (shot type is chosen at save time, alongside the release time).
Making generation depend on a value that doesn't exist yet at generation time isn't
implementable without changing that flow, which was out of scope.

## Decision

1. Smart Random availability and range are keyed by **measurement mode only**
   (`isSmartRandomAvailable(measurementMode)`), never by shot type.
2. There is no fallback across measurement modes. A measurement mode with no validated
   range (`Hog-Hog`, today) simply doesn't offer Smart Random — Fixed and Coach/Manual
   remain available. No approximated or copied range is ever substituted.
3. The range itself is configured **per block**, by the user, at block setup
   (`smartRandomMin`/`smartRandomMax`) — not a fixed built-in profile — so this decision
   is about *availability*, not about a single hardcoded number.
4. Migration applies the same rule retroactively: any block found in a legacy-saved
   session with an unavailable measurement mode's Smart Random target source is forced
   to Manual, never silently kept as if its stored range were valid.

## Consequences

- Hog-Hog Smart Random is currently unavailable, by design, until a real, validated
  Hog-Hog range exists (an open product decision — see
  `docs/TECHNICAL_DEBT_AND_ROADMAP.md`). This is more restrictive than "just letting the
  user configure any range" would be, but it prevents ever presenting an unvalidated
  number as if it were a real training range.
- Blind Weight and Variable Weight share the exact same Smart Random engine and the
  exact same availability rule (`getEffectiveTargetMode` in `trainingBlocks.ts`) — a
  future third mode that wants Smart Random gets this behavior for free, not a new
  parallel implementation.
- If shot-type-specific ranges become a real requirement later, they would require
  reworking the entry flow so shot type is known before target generation — this ADR
  does not forbid that, it documents why it isn't done today.
