# External Timing Integration — Discovery Plan

## Status: Planned / Vision. No implementation, no hardware, no protocol.

This document is a **discovery plan**, not a design or an implementation. It exists so
that when a real timing device becomes available to integrate, the right questions are
asked before any code is written — and so nobody mistakes the *prepared integration
point* described below (which exists in code today) for an actual integration (which
does not).

Do not implement anything in this document. Do not assume any manufacturer, protocol,
or hardware behavior not explicitly confirmed by direct investigation of a real device.

---

## What already exists (Implemented / Prepared)

- The Blind Weight state machine (`src/lib/blindWeight.ts`) has exactly one function
  through which a measured release time enters the app:
  `setMeasuredReleaseTime(draft, releaseTime, source)`.
- `source: ReleaseTimeSource` is already part of the type — only `"manual"` is used
  today. `ReleaseTimeSource` is now a type alias of `TimingProviderType` (see below) —
  one definition for "where did this value come from," shared by Blind Weight and the
  Capture Sequence boundary, not two competing types for the same concept.
- The function only takes effect during the `measure` phase — a value supplied before
  the prediction is locked is discarded, by construction. This is the one rule any
  future integration must preserve: **a measured time must never become visible before
  the prediction is locked.**
- `source` is accepted but not yet persisted anywhere (not on the draft, not on the
  saved `Shot`) — there's no product need for it yet. Adding it later is additive.
- **Since this document was first written, a second, more general provider boundary was
  built for automatic multi-shot capture** — `TimingProvider`
  (`src/lib/timingProvider.ts`), `TimingResult`/`TimingMeasurement`
  (`src/types/index.ts`), and the Capture Sequence domain logic
  (`src/lib/captureSequence.ts`) — see `docs/SYSTEM_ARCHITECTURE.md`'s "Capture
  Sequences" section and ADR-0006. This is **Implemented for a Simulator provider (dev/
  test-only) and a Manual-fallback provider**, and is the boundary a future
  `"external"` `TimingProvider` implementation would plug into. It does not yet cover
  Blind Weight (see that section for why) — Blind Weight still uses its own, older
  `setMeasuredReleaseTime` boundary described above, which a future real device would
  also need to call into for Blind Weight specifically.

## Formal contract the app already assumes of any TimingProvider (Implemented)

Independent of which device eventually gets integrated, a future `TimingProvider`
implementation for the Capture Sequence boundary must satisfy the following — already
built and tested against the Simulator/Manual providers today, in
`src/lib/captureSequence.ts`/`timingProvider.ts` (see
`docs/SYSTEM_ARCHITECTURE.md`'s "Contract for a future real Timing Provider" for the
full detail):

- **Result id**: stable for a genuine retry of the same reading, new for a genuinely new
  measurement. The app deduplicates by id alone.
- **Delivery**: the app assumes **at-least-once** delivery and tolerates duplicates by
  deduplicating on id — it does **not** require or assume a provider will avoid
  resending. This means a future device that resends on uncertainty does not need a
  perfect no-duplicates guarantee to integrate safely.
- **Ordering**: a provider should preserve real-world ordering, but the app serializes
  processing itself regardless and does not depend on provider-side ordering for
  correctness.
- **Timestamps**: `receivedAt` is reception time, not necessarily measurement time; a
  measurement-time field can be added later, additively.
- **Multi-measurement**: one result may carry several measurements; only the one
  matching the active block's measurement mode is used; measurement array order carries
  no meaning about shot order.
- **Lifecycle**: `start()`/`stop()`/`subscribe()` only — no error propagation or
  connection-status signal is part of the contract yet (see "What does not exist yet").
- **No sequence identity**: a result carries no reference to which Capture Sequence it
  was meant for — see `docs/TECHNICAL_DEBT_AND_ROADMAP.md`'s note on a stale delayed
  result being attributed to a newly-started sequence.

This section answers, in advance, several of the "Data" discovery questions below for
the *app's* side of the contract — the open discovery questions are about what a *real
device* actually does, which may or may not match these assumptions cleanly (e.g. if a
real device turns out to need exactly-once semantics enforced by the app, that would be
new work, not something already handled).

## What does not exist yet

- Any device adapter, transport, or protocol implementation — for Blind Weight's
  `setMeasuredReleaseTime` boundary, or for a `TimingProvider` implementation to plug
  into the Capture Sequence boundary. Both are prepared, provider-neutral, and waiting
  for a real device.
- Any buffering of a reading that arrives before `measure` is reached (Blind Weight) or
  while a Capture Sequence is paused — today, both simply discard. See
  `docs/TECHNICAL_DEBT_AND_ROADMAP.md`.
- Any pairing, device discovery, or multi-device/multi-sheet/multi-lane logic. The
  Capture Sequence's `deviceId`/`laneId` fields are **Prepared** (passed through and
  stored if a `TimingResult` happens to carry them) but nothing yet uses them to route
  or disambiguate between multiple concurrent devices or lanes.
- Any assumption about which manufacturer or protocol will eventually be used.

## Target architecture (abstract, Planned)

```text
Timing Device
  → Device Adapter
  → Release-Time Input Boundary
  → Blind Weight State Machine   (setMeasuredReleaseTime, gated by phase)
  → Review
  → Shot Save
```

The "Device Adapter" and "Release-Time Input Boundary" layers are conceptual today —
`setMeasuredReleaseTime` **is** the input boundary, currently fed only by a manual text
field. A future adapter would call the same function with `source: "external"`; the
state machine itself does not need to change.

Possible future adapter shapes — **none decided, none implemented**:

- Bluetooth
- Wi-Fi
- A proprietary radio receiver
- USB or serial bridge
- A microcontroller bridge
- Optical/camera-based detection as a fallback

No protocol, SDK, or manufacturer is assumed by naming these — they are the shape of
options to evaluate once a real device is in hand, not a shortlist implying a decision.

---

## Discovery questions to answer before any implementation work

Answering these requires physical access to a real device, its documentation, and (for
several items) a compliance/legal check — not something to guess from a product spec.

**Device identity**
- Manufacturer and model.
- Photos of the device, its receiver/base station (if separate), and any regulatory
  labels/type plates.
- User manual / technical documentation, if available.

**Connectivity**
- Frequency band and radio approvals (e.g. regional radio-equipment compliance) for
  whatever wireless technology it uses, if any.
- Available physical/logical connections: Bluetooth, Wi-Fi, USB, serial, a proprietary
  receiver, or something else entirely.
- Pairing process, if any, and whether it needs to happen once or per session.

**Data**
- Exact data format of a timing reading (units, precision, encoding).
- Transmission interval / latency between the actual release and the app receiving a
  value.
- Behavior on duplicate or out-of-order readings (does the device ever resend, or send
  a correction?).
- Behavior on a late-arriving reading relative to when the app expects it.

**Multi-unit scenarios**
- Whether one device times one sheet/lane or several.
- How a reading gets associated with the correct player, block, or in-progress draft
  when more than one thrower/sheet is active — this app currently has exactly one
  active Blind Weight draft at a time; multi-draft association is entirely unscoped.

**Platform constraints**
- Any iOS-specific restrictions relevant to the chosen connectivity (background
  execution, permission prompts, MFi/accessory requirements for certain transports).
- Offline behavior — does the device (and its data) work without the phone having
  network access? (The app itself must keep working offline regardless — see
  `docs/PRODUCT_DIRECTION_AND_PRINCIPLES.md`'s "Local-first is a current feature".)
- Any data-privacy or permission implications of the chosen connectivity (e.g. Bluetooth
  scanning permissions).

---

## Integration stages (Vision / future roadmap — not scheduled)

### Stage 1 — Manual entry (today)

The player reads the external timing system and types the value in, exactly as
implemented now.

### Stage 2 — External adapter delivers a value to the app

A device adapter exists and calls `setMeasuredReleaseTime(draft, releaseTime,
"external")` for the currently open draft. Still requires the player to be looking at
the right draft/phase; no automatic association yet.

### Stage 3 — Automatic association with the active Blind Weight draft

The app reliably matches an incoming reading to the correct in-progress draft without
manual confirmation, including correct behavior for a reading that arrives too early
(buffered or otherwise handled per the discovery findings above, not simply discarded
as it is today).

### Stage 4 — Multiple devices, sheets, or teammates

Support for more than one active thrower/sheet/device at a time, with readings routed
to the correct person's draft. Requires the multi-unit discovery questions above to be
answered first.

These stages describe a possible future, not a commitment or a schedule. Do not begin
Stage 2 work without a real device to test against.
