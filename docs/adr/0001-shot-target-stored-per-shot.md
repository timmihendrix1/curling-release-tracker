# ADR-0001: Every shot stores its own `targetTime`

## Status

Accepted. Implemented.

## Context

Early in the project, a "target time" existed only at the session level. Once training
blocks were introduced, and especially once Variable Weight (a changing target)
became a requirement, a single session- or block-level target was no longer sufficient:
a shot recorded under one target must not be silently reinterpreted once the block's
target configuration moves on.

## Decision

Every `Shot` stores its own `targetTime`, set once at save time from whatever target
was actually shown/used for that shot, and never recomputed afterwards.

`TrainingBlock.targetTime` remains — but only as:
- the constant target for Fixed Weight and Blind+Fixed, or
- the seed/starting value used to create a block's first `pendingTargetTime` for
  Manual mode.

It is never itself what a shot is judged against; `shot.targetTime` is.

## Consequences

- Variable and Blind Weight can change their target shot to shot (via Smart Random or
  Manual) without ever risking retroactively changing what an already-recorded shot was
  judged against.
- Analytics (`analyzeShots` and everything built on it) can always compare
  `shot.releaseTime` to `shot.targetTime` directly, with no need to know the block's
  current configuration, its Smart Random range, or its target history.
- Editing a Smart Random range after the fact (`updateSmartRandomRange`, currently only
  used by migration) can safely regenerate a block's *next* target without touching any
  shot already recorded.
- Cost: every shot carries a small amount of redundant data (the target is technically
  derivable from the block's history at the time), in exchange for never needing that
  history to be correct or complete in order to analyze a shot.
