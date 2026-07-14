# ADR-0006: Capture Sequences use a shared, provider-neutral Timing Result boundary

## Status

Accepted. Implemented for Fixed and Variable Weight; not available for Blind Weight
(see Consequences).

## Context

Automatic, sequential capture of multiple shots needs *something* to produce a stream
of measured values — during development and testing, a human standing in for real
hardware (a Simulator); in production today, a human typing a value in directly (a
manual fallback, since no real timing device is integrated yet); eventually, real
timing hardware. `docs/PRODUCT_DIRECTION_AND_PRINCIPLES.md` already commits to "manual
entry and future sensors share one domain flow," and ADR-0003 already applied this
principle once, for Blind Weight's single measured value per shot. Capture Sequences
generalize the same principle to an automatic, multi-shot stream, and must not
re-litigate it with a second, competing design.

The tempting shortcut — wire the Simulator's UI directly into the shot-save flow, since
it's "just for testing" — was explicitly rejected. Doing so would mean the simulator
exercises a code path real hardware and manual fallback never would, defeating the
point of testing with it at all, and would require a second shot-save implementation to
keep in sync with the first.

## Decision

1. A small `TimingProvider` interface (`type`, `start()`, `stop()`,
   `subscribe(listener)`) is the one contract every timing source implements — the
   Simulator, and (conceptually) a future real device. Manual entry does not implement
   this interface (it has no ongoing "start/stop" lifecycle) but produces the exact
   same output type via `createManualTimingResult`.
2. Every source — Simulator, manual fallback, future real hardware — produces exactly
   one normalized type: `TimingResult` (`{ id, receivedAt, source, measurements,
   deviceId?, laneId? }`), where a `measurements` entry may or may not match the active
   block's `measurementMode`.
3. Exactly one function, `processTimingResult` (`src/lib/captureSequence.ts`), turns a
   `TimingResult` into a `Shot` (or rejects it with a diagnosable reason). It reuses the
   same target/shot-numbering functions manual single-shot entry already uses
   (`computeShotTarget`, `advanceBlockTarget`, `getBlockShots`,
   `getNextShotNumberInBlock` from `trainingBlocks.ts`) — there is no parallel
   shot-save path for captured shots.
4. The Simulator (`SimulatorTimingProvider`) is development/test-only, gated out of the
   production UI (`process.env.NODE_ENV !== "production"`), and is otherwise an
   ordinary `TimingProvider` — nothing in `processTimingResult` or the Capture Sequence
   domain model is simulator-specific.
5. `ReleaseTimeSource` (Blind Weight's existing "where did this value come from" type,
   from ADR-0003) is now a type alias of the new `TimingProviderType`, rather than a
   second, separately-defined union with the same meaning.
6. Undo (`undoLastCapturedShot`) deliberately does **not** remove the undone shot's
   `TimingResult.id` from the sequence's `processedResultIds` — it stays "spent"
   forever. A replacement shot needs a genuinely new result id; resubmitting the undone
   one is still diagnosed as a duplicate. This was chosen over the alternative (freeing
   the id for reuse) because a freed id could be resent by a real device's retry/resend
   behavior in ways not yet known (see
   `docs/EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md`), and "always require a fresh result"
   is the simpler, safer default until real device behavior is observed.

## Consequences

- A future real `TimingProvider` implementation (Bluetooth, Wi-Fi, a proprietary
  receiver, USB/serial — none decided, see
  `docs/EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md`) plugs into the exact same
  `subscribe`/`processTimingResult` path the Simulator and manual fallback already use.
  No Capture Sequence code needs to change to support it.
- Manual entry remains a permanent, first-class capture method — not a fallback bolted
  on beside "the real thing." Auto Capture is additive to it, never a replacement; the
  classic single-shot manual flows (`ShotEntry`/`BlindShotEntry`) are untouched by this
  work.
- Testing the Capture Sequence domain logic (duplicate handling, plausibility, handle
  strategies, Undo) requires no real hardware and no browser — `SimulatorTimingProvider`
  and `createManualTimingResult` are enough, and the exact same assertions apply to
  whatever a future real provider produces.
- Blind Weight is explicitly **not** covered by this boundary yet. Its core invariant —
  a measured time must never become visible before the prediction is locked — doesn't
  fit `processTimingResult`'s current linear "receive result → save shot" order without
  a real design pass for a predict-lock step inside a Capture Sequence.
  `createCaptureSequence` throws for `mode === "blind"` rather than allowing an unsafe
  half-integration; the UI shows this as an explicit "not available yet" message. This
  is a deliberate scope limit, not an oversight — see
  `docs/TECHNICAL_DEBT_AND_ROADMAP.md`.
