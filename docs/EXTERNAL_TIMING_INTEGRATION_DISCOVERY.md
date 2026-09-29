# External Timing Integration — Discovery

## Status (2026-09-28)

- **Hardware: available.** A Brower TCi Timer has been received.
- **Protocol documentation: available.** Brower supplied an official BLE specification,
  now in this repository. See `docs/BROWER_INTEGRATION_STATUS.md`, which is the canonical
  Brower-specific protocol and status reference — this document does not duplicate its
  UUID or packet tables.
- **Hardware discovery stage: implemented, and exercised against the real device.** A
  development-only BLE diagnostic exists (see "The BLE diagnostic stage" below), and on
  **2026-09-25** it connected to the physical TCi Timer and recorded real bytes.
- **Production external timing capture: still does not exist.** No `TimingProvider`
  implementation for a real device exists, for the Capture Sequence boundary or for Blind
  Weight. The integration point described below is *prepared*, not *connected*.
- **Verified device behaviour: partial.** A connection, service/characteristic discovery,
  successful reads and real Athlete Data notifications **have** been demonstrated
  (Gates A and B). Packet encoding is **partially** supported for the tested Chron
  base-packet fields — memory location and splits 1–4, plus the appendix-count transition
  and one appendix split field — and is **not** established for the full protocol
  (the start time, splits 6–20, the second appendix packet, session headers and **record
  finality** all remain open), so **Gate C is not passed**. The canonical write-up of what
  the evidence does and does not support is `docs/BROWER_INTEGRATION_STATUS.md`; the
  archived exports are in `docs/hardware/brower/observations/2026-09-25-chron/` (desktop)
  and `docs/hardware/brower/observations/2026-09-28-ios-manual/` (physical iPhone).

The provider-neutral constraints in this document are unchanged and remain binding. Do
not assume any manufacturer, protocol, or hardware behaviour that has not been confirmed
by direct observation of the real device — a documented claim is not an observed one, and
two collections on different transports, neither using timing gates for the multi-split
case, are not reproduction of production conditions.

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

- Any **production** device adapter, transport, or protocol implementation — for Blind
  Weight's `setMeasuredReleaseTime` boundary, or for a `TimingProvider` implementation to
  plug into the Capture Sequence boundary. Both are prepared, provider-neutral, and
  waiting for verified device behaviour. The development-only BLE diagnostic described
  below is deliberately **not** such an adapter: it has no path into sporting data and
  must not grow one.
- Any buffering of a reading that arrives before `measure` is reached (Blind Weight) or
  while a Capture Sequence is paused — today, both simply discard. See
  `docs/TECHNICAL_DEBT_AND_ROADMAP.md`.
- Any pairing, device discovery, or multi-device/multi-sheet/multi-lane logic. The
  Capture Sequence's `deviceId`/`laneId` fields are **Prepared** (passed through and
  stored if a `TimingResult` happens to carry them) but nothing yet uses them to route
  or disambiguate between multiple concurrent devices or lanes.
- Any *production* commitment to a manufacturer or protocol. A device and protocol **have**
  been selected for the discovery stage — a Brower TCi Timer over its official BLE
  interface — but nothing about which providers the shipped product will support is
  settled, and the domain boundary stays provider-neutral regardless.

- Any **native mobile** transport for timing data **in this application**. Web Bluetooth
  does not exist in iOS Safari, so the desktop diagnostic's transport cannot simply be
  carried to a phone. A separate, bounded **native iOS transport prototype** exists at
  `tools/brower-ios-probe/` (see `docs/BROWER_IOS_FEASIBILITY.md`), and on **2026-09-28 it
  ran on a physical iPhone and received real Athlete Data notifications** from the timer
  (archived at `docs/hardware/brower/observations/2026-09-28-ios-manual/`). **Native iOS
  BLE transport to this timer is therefore demonstrated — in a prototype, not in this
  application, and not on Android**, where no project exists and nothing has been compiled
  or run. The probe remains a developer instrument with no identity, no persistence and no
  path into sporting data, and it is **not** a mobile migration of this application. The
  migration questions it sidesteps — the API origin and trust boundary, native OAuth
  callback handling, the separate mobile storage container, offline cold start, and
  distribution — are now designed in `docs/MOBILE_APP_MIGRATION.md`, which is the canonical
  migration document. Nothing in that design is implemented.

## The BLE diagnostic stage (Implemented, development-only)

### Authorized scope of this stage

This stage was authorized as **hardware discovery and evidence collection only**. It is
explicitly not the beginning of a production integration, and the following boundaries are
part of the authorization, not incidental implementation choices:

- It must not create or modify any Training, Assessment, Exercise or other sporting
  record, and must not emit a `TimingResult`.
- It must not change the `TimingProvider` contract or introduce a second capture path.
- It must not persist anything — no `localStorage`, no IndexedDB, no cloud, no automatic
  upload. Its log is in memory and leaves only through an explicit user download.
- It must not present an unverified interpretation as a measurement. Raw bytes only.
- It must not send any command other than the documented athlete-data request
  (type `0x01`), and in particular must never send New Athlete (`0x0A`), clear, reset,
  channel or test commands. No arbitrary hex console.
- It must not exist in production builds.
- The first target is a Chromium-based desktop browser on macOS via the local development
  server — **Brave is what was actually used successfully** on 2026-09-25; Chrome remains a
  supported alternative. This decides nothing about eventual iOS architecture or a
  browser-support policy.

### What it is

A small diagnostic reached from **Settings → Developer Tools → Open BLE Diagnostic**,
inside the normal authenticated, Profile-scoped application shell. It connects to one
selected BLE device, reports the services and characteristics actually present with their
actually-advertised properties, reads documented readable characteristics as raw bytes,
subscribes to Athlete Data notifications, permits one bounded memory-read experiment under
an explicitly chosen byte-order hypothesis, and exports a bounded JSON log.

Code lives in `src/lib/brower/` (transport and protocol, independently testable against an
injected Bluetooth API) and `src/components/BrowerBleDiagnosticScreen.tsx` (the view).
`docs/BROWER_INTEGRATION_STATUS.md` holds the protocol detail.

### Separation from production timing capture

The diagnostic and the capture boundary do not touch:

| | BLE diagnostic | Production capture (future) |
| --- | --- | --- |
| Produces `TimingResult` | No | Yes, required |
| Reaches Session / Assessment / Exercise state | No | Yes, through the existing domain functions |
| Persists anything | No | Yes, through the Profile-scoped repositories |
| Interprets device bytes | No — raw only | Yes, once the encoding is verified |
| Exists in production | No | Yes |

When a production Brower provider is eventually built, it must implement `TimingProvider`
and enter the app through `processTimingResult` (and `setMeasuredReleaseTime` for Blind
Weight), exactly like the Simulator and Manual providers do today — see ADR-0006. It must
not reuse the diagnostic controller as a shortcut, and the diagnostic's log must never
become a second sporting-data pipeline.

---

## Desktop test procedure (Mac + Brave, or Chrome)

Follow this once the code has been reviewed. It needs the physical timer, its gates, and a
Mac running a Chromium-based browser. Nothing here requires developer knowledge beyond
running one command.

**Brave on macOS is the browser that actually worked** in the 2026-09-25 session, after the
setup in Phase 0 below. Chrome is a supported alternative on the same platform, but it was
**not** physically tested in that session — do not report it as verified. Safari and
Firefox do not expose Web Bluetooth on the desktop.

This procedure was run once, and its exports are archived at
`docs/hardware/brower/observations/2026-09-25-chron/`. Read that directory's README and
`docs/BROWER_INTEGRATION_STATUS.md` before repeating it — a second session should target
what the first one missed (see "What this test collection did not cover" there), not
re-collect what it already has.

> **The log is in memory only.** Closing the diagnostic destroys the controller and its
> log; reopening starts an empty one. **Export before you close, before you clear the log,
> and before you navigate away** — navigating to another section also closes it. This is a
> deliberate design property, not an oversight: a hardware diagnostic has no business
> persisting device data, so the operator exports instead. Plan the session around it.

### Phase 0 — Brave setup (skip if using Chrome)

Brave ships Web Bluetooth behind a flag. Without this, the diagnostic correctly reports
that the browser does not expose Web Bluetooth, and no chooser ever appears.

1. Open `brave://flags/#brave-web-bluetooth-api`.
2. Set **Web Bluetooth API** to **Enabled** if it is not already, and relaunch Brave when
   prompted.
3. Allow Brave to use Bluetooth under **System Settings → Privacy & Security → Bluetooth**
   on macOS.
4. Open the localhost development URL and the diagnostic (Phase 1 below).

Brave's own references for this flag: the feature request
<https://github.com/brave/brave-browser/issues/31605> and the flag definition in
<https://github.com/brave/brave-core/blob/master/browser/about_flags.cc>.

In the 2026-09-25 session, connecting succeeded **after** following this guidance. The
flag's prior state was not instrumented, so the original cause of the earlier failure is
**not** established — do not record it as "the flag was off" unless a future session
actually checks.

### Phase 1 — Set up

1. Open a terminal in the repository and run `npm run dev`.
2. Open the `http://localhost:…` URL it prints, in **Brave** (after Phase 0) or **Chrome**
   on the Mac. Web Bluetooth needs a secure context; `localhost` qualifies, a LAN address
   does not.
3. Complete the normal sign-in / Profile step if the app asks for it.
4. Turn Bluetooth on. If macOS asks, grant **the browser you are using** Bluetooth access
   under **System Settings → Privacy & Security → Bluetooth**.
5. Consider disconnecting **Brower Test Center** from the timer first. Many BLE
   peripherals accept only one connection at a time, but whether the TCi does is not
   established — the manufacturer document does not say, and we have not observed it. If
   both apps connect happily, that is itself worth recording. If this app cannot connect,
   an existing Test Center connection is one thing to rule out, not a known cause.
6. Go to **Settings → Developer Tools → Open BLE Diagnostic**.

### Phase 2 — Collect evidence (keep this view open throughout)

7. Press **Select Device (timing service filter)**. In the 2026-09-25 session **both**
   choosers found and connected to the timer, so the filtered one is not known to be
   broken. It remains possible that it matches nothing — the manufacturer document's
   advertising example does not match its own declared timing-service UUID, and no raw
   advertising data has ever been captured — so if the chooser lists nothing, close it and
   use **Select Device (show all nearby devices)** as the fallback. A plausible device name
   is not proof the unit is the TCi; the discovered services are.
8. Check which services and characteristics were found and which properties they actually
   advertise. Note anything that differs from the documented expectation. If the screen
   says discovery is **incomplete**, treat the list as partial — a failed query is not
   evidence that the device lacks something.
9. Press **Read Time Base**, wait several seconds, and press it again — and then a third
   time after a longer gap. Record all raw values and the wall-clock time of each. Do
   **not** convert them to a number yet — the byte order is unresolved, and the point of
   the repeats is to see which bytes changed and by how much. In the 2026-09-25 session
   three reads **158.3 seconds apart returned identical bytes**, which the documented
   "milliseconds since power on" description does not explain; that discrepancy is
   unresolved, so this step is worth doing carefully rather than once. Record the raw bytes
   and the wall-clock time only — any numeric reading of them assumes a byte order that is
   not established.
10. Press **Start Listening**, then trigger known measurements with the timer and gates.
    Record, for **every** run, the timer's own displayed value **exactly as shown**,
    including trailing zeros — the 2026-09-25 collection captured a display value for only
    four of its twelve packets, which is why most of the packet layout is still unverified.
    Also record what that collection did not: the **firmware version**, the physical **gate
    arrangement**, and **which button you pressed when**. (The timer mode *was* reported
    last time, as "Chron"; record it again anyway, and record it as a reported setting.)
    None of these can be reconstructed from the bytes afterwards.

    Where the mode supports it, deliberately produce runs with **more than one split** —
    that is the field group the first collection could not corroborate, and the only thing
    that will settle it.

    **On truncation versus rounding:** you cannot target this from the display, because the
    digit that decides it is the one the display discards. Do not try to produce a
    particular millisecond. Simply record every displayed value exactly, then compare the
    set against the raw bytes afterwards. A single run decides the question only when the
    discarded millisecond digit happens to be large: with a candidate integer-millisecond
    reading, 10361 ms gives 10.36 under both truncation and nearest-hundredth rounding,
    whereas 10368 ms truncates to 10.36 and rounds to 10.37. Digits **6–9** give an
    unambiguous comparison and avoid any tie convention at 5; digits 0–4 are silent. Run
    enough measurements that some land there — neither the duration of a run nor the value
    of its last displayed digit tells you in advance whether it will.
11. Record whether any packet arrived **without** being asked for. Note the conditions:
    which timer mode, which firmware, how long you waited. A quiet period is an
    observation under *those* conditions — it does not establish that the timer never
    sends unsolicited packets in any mode or firmware version. Equally, silence by itself
    does not mean the connection failed.
12. Perform a deliberate memory-read experiment: choose a small range you know contains
    data, choose **one** byte-order hypothesis, check the seven bytes shown, and press
    **Send Request**. Then repeat with the other hypothesis. Record which, if either,
    returned the range you asked for. **The 2026-09-25 session only ever sent the
    big-endian hypothesis**, so little-endian is untested rather than excluded — sending
    both is the point of this step. Include a range that starts above location 1 and a
    single-location request, so selective retrieval is tested at more than one address.
13. Still **without closing the view**, test **Disconnect** and then reconnect, and start
    and stop listening more than once. Keeping the same view means all of this stays in
    the same log as the evidence above. **The 2026-09-25 exports do not show this step.**
    They do show two *unexpected* disconnects, each followed by a successful reconnection
    via a fresh device selection — which is useful, but is not the controlled test this
    step asks for.

### Phase 3 — Export before doing anything that discards the log

14. Press **Export Log** and keep the file together with your notes of the
    timer-displayed values. **Everything above is lost if you skip this step.**
15. Archive the export in a **new** dated directory under
    `docs/hardware/brower/observations/`, alongside a README recording the provenance and
    the operator-reported context. Do not add to or edit an existing session's directory —
    its files are immutable evidence.

Note that exporting repeatedly **without clearing the log** produces files that contain
each other as prefixes, as exports 02–04 of the first session do. That is fine, but the
shared entries are one observation exported several times, **not** independent repeats, and
must not be counted as such.

### Phase 4 — Reopening, as a separate exercise

16. Only now, close the diagnostic and reopen it. The log will be empty — that is the
    expected behaviour, not a fault. Reopening should work without reloading the page.
17. If you collect anything further in the reopened view, export a **second** log before
    closing it again, and label the two files so their order is clear.

**Do not** clear the timer's memory through the timer itself — that discards the records
this stage is trying to read. The diagnostic cannot clear memory and cannot create a new
athlete, and neither should be done from the device during a collection session: pressing
the physical **New** button starts a new athlete, which changes what the timer is
recording into and makes the memory layout harder to reason about mid-session. That is a
reason to avoid it while collecting, not a claim that it erases stored records — the
manufacturer document establishes that command `0x0A` is equivalent to pressing **New**,
and separately that *clearing* memory restarts at location 1. It says nothing about New
Athlete destroying existing records.

The exported log can contain the browser's device identifier and raw athlete records.
Treat it like any other file containing recorded data.

### Acceptance evidence

Four separate gates. Passing an earlier one never demonstrates a later one, and a report
must not describe A or B as if it were C or D.

| Gate | State (2026-09-25) |
| --- | --- |
| **A** — Real connection and read | **Demonstrated** |
| **B** — Real notification bytes | **Demonstrated** |
| **C** — Verified encoding and interpretation | **Partial — not passed** |
| **D** — Production capture integration | **Not started** |

- **Gate A — Real connection and read. Demonstrated.** The diagnostic connects to the
  physical timer, finds the timing service, and returns raw bytes from at least one
  documented readable characteristic. Evidence: an **exported** log containing `connected`,
  `service_discovered` and `characteristic_read` entries from a real device. A log that
  was never exported is not evidence — it no longer exists. Satisfied by
  `01-connection-chron-3.18s.json`, which records three connections, both documented
  services, and successful reads of all three readable characteristics.
- **Gate B — Real notification bytes. Demonstrated.** Athlete Data notification bytes
  arrive from the physical timer. Evidence: `notification_received` entries with raw bytes,
  alongside the values the timer displayed for the same runs. Satisfied by 12 real,
  unsolicited 20-byte notification packets across exports 01 and 02, four of which have a
  reported display value beside them.
- **Gate C — Verified encoding and interpretation. Partial; explicitly not passed.** Byte
  order, nibble ordering, and the relationship between packet fields and displayed times
  are established from evidence **and reproduce across sessions**. There is now real
  partial evidence — the Chron base packet's Memory Location and Split 1 fields, the
  nibble order, truncation to hundredths, and big-endian memory-request addressing on the
  tested ranges. That is not the gate. Most of the packet is still unverified,
  little-endian was never sent, and there is exactly one test collection, so nothing has
  reproduced across separate collections. **Do not restate this gate as passed, and do not write a decoder against
  it.** See `docs/BROWER_INTEGRATION_STATUS.md` for exactly what is and is not supported.
- **Gate D — Production capture integration. Not started.** A real `TimingProvider`
  delivering `TimingResult` values into the Capture Sequence boundary. Outside the scope of
  the diagnostic stage. No production transport, provider, capture integration or automatic
  save behaviour exists.

Automated tests for the diagnostic run against a mock Bluetooth API and satisfy **none**
of these gates. Equally, the offline analysis behind Gate C's partial result was performed
against **exported files**: the application itself still decodes nothing, creates no
`TimingResult`, and writes no Shot, Session, Assessment or Exercise result.

---

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

Adapter shapes this boundary would accommodate. **Bluetooth is no longer hypothetical** —
the current discovery stage uses BLE against a real TCi Timer — but no *production*
adapter of any shape exists, and the others remain unevaluated options rather than a
roadmap:

- Bluetooth — **in use by the discovery stage**; no production adapter
- Wi-Fi
- A proprietary radio receiver
- USB or serial bridge
- A microcontroller bridge
- Optical/camera-based detection as a fallback

Naming the rest implies no decision about them. The point of the list is that the domain
boundary does not care which one a future provider uses.

---

## Discovery questions to answer before any implementation work

Answering these requires physical access to a real device, its documentation, and (for
several items) a compliance/legal check — not something to guess from a product spec.

The device is now known (Brower TCi Timer) and its documentation is available, so the
identity questions below are answered and the connectivity/data questions are now
answerable by observation rather than correspondence. The Brower-specific subset —
byte order, nibble ordering, notification behaviour, record lifecycle — is tracked in
`docs/BROWER_INTEGRATION_STATUS.md`'s "Unresolved details", which is the list to work
through; the questions here remain the provider-neutral checklist any *future* device
would also have to pass.

**Device identity** — answered for the current device
- Manufacturer and model. *(Brower Timing Systems, TCi Timer.)*
- Photos of the device, its receiver/base station (if separate), and any regulatory
  labels/type plates.
- User manual / technical documentation, if available. *(BLE specification supplied; see
  `docs/BROWER_INTEGRATION_STATUS.md`.)*

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
  execution, permission prompts, MFi/accessory requirements for certain transports) —
  **and the Android equivalents, which are different and must be established separately.**
  Android 12+ requires the runtime `BLUETOOTH_SCAN` / `BLUETOOTH_CONNECT` permissions and
  treats location permission differently from iOS. See
  `docs/MOBILE_APP_MIGRATION.md` §8.3; a finding on one platform is never evidence for the
  other.
- Offline behavior — does the device (and its data) work without the phone having
  network access? (The app itself must keep working offline regardless — see
  `docs/PRODUCT_DIRECTION_AND_PRINCIPLES.md`'s "Local-first means offline-capable after
  authenticated onboarding" — renamed 2026-08-24; the offline-during-training requirement
  this bullet relies on is unchanged.)
- Any data-privacy or permission implications of the chosen connectivity (e.g. Bluetooth
  scanning permissions).

---

## Integration stages (Vision / future roadmap — not scheduled)

### Stage 0 — Hardware discovery (Implemented, development-only; **in progress**, not complete)

The BLE diagnostic described above. It establishes what the device actually does; it
delivers no value into the app. Completing it means Gates A–C have real evidence behind
them. Nothing in Stage 0 is production code.

**Status:** Gates A and B are demonstrated; Gate C is **still partial**. Stage 0 is
therefore **under way, not complete**. The 2026-09-28 iPhone collection settled part of
what it owed — splits 2–4, the appendix-count field and appendix-packet structure, plus a
reproduction of Split 1 and the byte-for-byte repeats on a second transport. What it
**still** owes: the 3.5-byte start time, splits 6–20, the second appendix packet, record
completion and finality rules (a single record was observed in six versions — an initial
version plus five updates), session
headers and reset behaviour, the Time Base discrepancy, serial-number encoding, advertising
details, a controlled reconnect test, lifecycle behaviour while a subscription is active,
and a collection **with timing gates** — the 2026-09-28 session used none.

### Stage 1 — Manual entry (today)

The player reads the external timing system and types the value in, exactly as
implemented now. This remains permanently available as a fallback regardless of how far
the later stages get.

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
Stage 2 work before Stage 0 has produced verified encoding evidence (Gate C) — a real
device being *in hand* is no longer the constraint, and neither is a real device being
*reachable*: both are now demonstrated. A real device being **understood** is, and Gate C
is still only partial.
