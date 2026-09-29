# Brower Integration Status

**Status:** Hardware received. Official BLE documentation available. Development-only BLE diagnostic implemented. **This application has connected to a physical TCi Timer, read characteristics, and received real Athlete Data notifications** (2026-09-25, desktop Web Bluetooth). **A separate native iOS probe has since reached the same timer from a physical iPhone and received real notifications** (2026-09-28). Packet encoding is **partially** supported by evidence — the tested Chron base-packet fields now include splits 2–4, the appendix count and one appendix packet — but it is not established for the full protocol. **No production timing provider exists.**

**Last Updated:** 2026-09-28

---

# Purpose

This document is the canonical Brower-specific protocol and status reference for the
Curling Performance Platform.

It records what the manufacturer documentation actually states, what remains genuinely
unresolved, what the application can do today, and what has been physically observed.
Those four things are kept apart on purpose: the largest risk in a hardware integration
is a plausible guess quietly becoming a documented fact.

Since 2026-09-25 there is real hardware evidence. It is kept in the same discipline:
**observed bytes**, the operator's **reported** display values, a **supported
interpretation** scoped to what was actually tested, and what stays **unresolved** are
never merged into a single confident claim.

The goal is unchanged: integrate Brower Timing Systems **without** coupling the
application to Brower-specific concepts. Brower becomes one implementation of the generic
Timing Provider architecture (see `docs/EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md` and
ADR-0006).

---

# Current status

| Item | State |
| --- | --- |
| TCi Timer hardware | **Received** |
| Brower Test Center connects to the timer | **Reported by the user.** Not reproduced or instrumented by this project |
| Official BLE documentation | **Available in this repository** |
| Development-only BLE diagnostic in this app | **Implemented** (Brave on macOS, development builds only) |
| A connection from this app to the physical timer | **Demonstrated** — three GATT connections, both documented services discovered, successful reads (2026-09-25) |
| Real Athlete Data notifications | **Received** — 12 unsolicited notification packets across two listening windows, plus 4 replies to memory requests (2026-09-25) |
| A connection from a **physical iPhone** to the timer | **Demonstrated** — by the separate native iOS probe, not by this application: two GATT connections, both documented services discovered, 15 notification packets (2026-09-28) |
| Verified packet encoding | **Partial.** Supported by evidence for the tested Chron base packet: memory location, Split 1 (four packets on desktop, three on iOS), and — new on 2026-09-28 — splits 2, 3 and 4, the appendix-count field, and one appendix packet. Session headers, splits 6–20, the start time and the second appendix packet are **not** established |
| Production timing provider | **Does not exist** |

Hardware claims in this document trace to **two observation sessions**:

| Session | Transport | Archive |
| --- | --- | --- |
| 2026-09-25 | This application's desktop Web Bluetooth diagnostic, Brave on macOS | [`docs/hardware/brower/observations/2026-09-25-chron/`](hardware/brower/observations/2026-09-25-chron/README.md) |
| 2026-09-28 | The separate native iOS probe (`tools/brower-ios-probe/`), on a physical iPhone | [`docs/hardware/brower/observations/2026-09-28-ios-manual/`](hardware/brower/observations/2026-09-28-ios-manual/README.md) |

Each directory's README holds the provenance, the operator's reported context, the file
inventory and the independent checks performed. This document holds the protocol
conclusions. **The two sessions used different transports, different hosts and different
physical setups** — the 2026-09-28 session used no timing gates — so they are two
observations, not two runs of one experiment.

## Source document

[`docs/hardware/brower/TC Timer BLE to Smartphone BLE Communication V4.docx`](hardware/brower/TC%20Timer%20BLE%20to%20Smartphone%20BLE%20Communication%20V4.docx)

Supplied by Brower Timing Systems. It is the authority for every protocol fact below.
Keep the original file as delivered — do not rename, rewrite, or replace it with an
extracted copy.

---

# Documented protocol facts

Everything in this section is transcribed from the source document. It is *documented*,
which is not the same as *verified against hardware* — see "Acceptance gates" below.

## Services and characteristics

| Role | UUID |
| --- | --- |
| Timing service | `11574949-d37a-4fd7-a171-f36fcdc3a461` |
| Athlete Data characteristic | `bb8722a4-3810-4fd3-9321-f6cbdcc1ea4e` |
| Time Base characteristic | `ee152c14-79a7-447d-b435-030880aa7d7d` |
| Power On Counter characteristic | `882c254a-d1f1-440f-8d08-4d0e5a9d4226` |
| Serial Number service | `ffae864c-ee9f-4f31-ad8a-9bcbac855a9f` |
| Serial Number characteristic | `beef94d7-4124-423d-82e0-5aa556bc722b` |

The document lists a fourth timing-service characteristic, **Current Memory Location**,
but never states its UUID. The device enumerated **three** timing-service characteristics
on 2026-09-25 and again on 2026-09-28, and **no Current Memory Location characteristic has
been identified on either transport**.

That is a statement about the **timing service only**. The 2026-09-28 iOS session
enumerated every service the device reported and found **two further services that the
manufacturer document does not describe** — see "Services outside the manufacturer
document" below. **None of their characteristics may be labelled Current Memory Location**:
nothing has been read from any of them, and a guess about an undocumented UUID is exactly
the kind of claim this document exists to prevent.

## Memory organisation

- 499 memory locations. Location 0 is unused; the first saved time goes to location 1.
- When memory is full, **location 499 is continually overwritten**.
- Clearing the memory restarts at location 1.
- Each location holds athlete number, test ID, flag bits, running time in milliseconds,
  and up to 20 split times relative to the start time.
- The last non-zero split time is the finish time.

## Commands

A command is **7 bytes**, framed by start byte `0x55` and stop byte `0xAA`. Packets may
be sent as fast as every 25 ms.

| Byte index | Meaning |
| --- | --- |
| 0 | `0x55` start |
| 1 | Type |
| 2–3 | Start memory location (`uint16`) |
| 4–5 | Stop memory location (`uint16`) |
| 6 | `0xAA` stop |

Documented types: `0x01` Athlete Data; `0x02` Time Base / Session / Sequence number;
`0x03` frequency channel; `0x04` test; **`0x0A` New Athlete — explicitly equivalent to
pressing the "new" button on the timer, i.e. state-changing on the device.**

A request for a range extending into unused locations returns only the used ones.
Replies arrive as **notifications on the Athlete Data characteristic**.

## Response packets

An athlete occupies 1, 2 or 3 packets of 20 bytes each: a base Split packet, then up to
two Appendix packets carrying splits 5–12 and 13–20.

The base packet's documented field layout uses **fractional byte widths** — 1.5 bytes for
memory location and athlete number, 3.5 bytes for the absolute start time, 2.5 bytes per
split, 0.5 bytes for the appendix count.

Session headers are stored as athletes with **bib number 1000**, carrying the session
start time and session number.

## Other documented behaviour

- Time Base returns 4 bytes: milliseconds since the timer powered on. Subtracting it from
  the phone's clock yields the wall-clock time the timer was powered on.
- Power On Counter returns 16 bytes: the power-on session number plus the memory location
  of the current session.
- Times are milliseconds, displayed in hundredths. **Truncate, do not round**: 19.999
  displays as 19.99, not 20.00. (This rule is the one documented behaviour the 2026-09-25
  session independently corroborated — see "Physical observations".)
- The advertising packet example is
  `02 01 06 11 07 daefdfe3f6b8659e77473ac91e2de9aa 08 ff ffff 01ab 0053 04`, described as
  carrying a prototype ID, session number and current memory location.

---

# Unresolved details

These are **not** design gaps in this application. They are things the source document
does not state, and which only a real device can settle. Do not resolve any of them by
inference from BLE convention, from the advertising example, or from what "usually" holds.

The 2026-09-25 session moved several of these. What it moved, and how far, is set out in
"Physical observations" below — read that section before treating any item here as closed.

## Now supported by evidence (for the tested case only)

1. **Nibble ordering of the packed response fields — for the Chron base packet's splits
   1–4, its Memory Location field, and its appendix count.** High nibble first,
   most-significant digit first, reproduces the operator's displayed time from the
   documented Split 1 field in **seven** independent packets across **two transports**, and
   reproduces the requested memory locations from the documented Memory Location field.
   The 2026-09-28 collection added splits 2–4 (a monotonically increasing sequence in one
   record, consistent with the documented start-time-relative rule), the appendix-count
   field, and one appendix packet read as eight 5-digit split fields.
   **The 3.5-byte start time, splits 6–20, the second appendix packet and session headers
   remain unverified** — see "Multi-split records and the appendix packet". Unverified
   means uncorroborated, not contradicted.
2. **Whether measurements are notified spontaneously.** Under the observed conditions,
   yes: 12 notification packets on 2026-09-25 and 15 on 2026-09-28 arrived with no
   preceding write — and on 2026-09-28 no write was even possible, because the probe's
   transport declares no write operation. This is an observation under those conditions
   (the operator-reported Chron mode, unrecorded firmware versions, two test collections),
   **not** a general promise for every operating mode.
3. **Actual device properties.** Observed directly; see "Observed services and
   characteristics" below.

## Still unresolved

4. **Byte order of multi-byte command fields.** Only the **big-endian** hypothesis was
   ever sent. The two requests it produced returned the ranges asked for, which supports
   big-endian addressing for those two ranges. **Little-endian was never tested**, so it
   is not excluded by symmetry, and no address outside 1–3 was validated.
5. **Byte order of multi-byte response fields**, beyond the base-packet fields in item 1 —
   specifically the 3.5-byte start time, splits 6–20, the second appendix packet, and the
   session-header layout.
6. **How incomplete, updated and final records behave.** Packets carrying a zero first
   split were observed, followed by packets carrying a non-zero first split for the same
   candidate record; two non-zero-split packets were observed repeating byte for byte on
   **both** transports; and on 2026-09-28 a single record was observed in **six versions**
   — an initial version plus five updates as splits were added. What *causes* each of those, and whether a delivered split
   is ever superseded, is not established — **nothing here establishes packet finality** —
   see "Record progression and repeats" and "Multi-split records and the appendix packet"
   below.
7. **The UUID of the Current Memory Location characteristic.** Still unknown. The timing
   service enumerated **three** characteristics on both transports, not the four the
   document describes, and **no characteristic within the timing service is unaccounted
   for.** The 2026-09-28 session did observe two services *outside* the timing service
   that the document does not describe; **none of their characteristics is evidence for
   this item**, and none may be labelled Current Memory Location.
8. **The actual advertised service UUIDs.** Still unknown — **no raw advertising capture
   exists.** The chooser filtered on the timing service *did* successfully find and connect
   to the device in this test collection. No earlier failure to reach the device may
   therefore be
   described as proof of an advertising-UUID mismatch; the document's advertising example
   still disagrees with its own declared timing-service UUID, but that is an inconsistency
   in the document, not an observed device behaviour.
9. **Actual firmware behaviour**, including whether any of the above is stable across
   firmware versions. The firmware version of the tested unit was not recorded.
10. **Serial number encoding.** The characteristic returned the same two bytes (`8C 8B`)
    on all **four** successful reads in export 01 (sequences 12, 25, 38 and 42). Nothing
    maps those bytes to a printed serial number, and the encoding remains unresolved.
11. **Time Base semantics.** Three consecutive reads returned identical bytes despite time
    passing, which the documented "milliseconds since power on" description does not
    explain. **No verified wall-clock timestamp mapping can be derived from this
    evidence.**
    See "Anomalies" below.
12. **Reconnect and multi-connection behaviour.** Two unexpected disconnects occurred, and
    the export shows the operator **reconnecting successfully after each** by selecting the
    device again. What is missing is a *controlled* reconnect test — in particular the
    procedure's "press Disconnect, then reconnect without closing the view" step, which the
    evidence does not show. Whether the timer accepts more than one concurrent central is
    still unknown.

---

# Physical observations

**First test collection: 2026-09-25**, on **desktop**, through this application's Web
Bluetooth diagnostic. Evidence archived at
[`docs/hardware/brower/observations/2026-09-25-chron/`](hardware/brower/observations/2026-09-25-chron/README.md),
which records the provenance and the operator's reported context.

**Second test collection: 2026-09-28**, on a **physical iPhone**, through the separate
native iOS probe. Evidence archived at
[`docs/hardware/brower/observations/2026-09-28-ios-manual/`](hardware/brower/observations/2026-09-28-ios-manual/README.md).
Unless a subsection says otherwise, **the sections immediately below describe the
2026-09-25 desktop collection**; the 2026-09-28 findings are gathered under "The
2026-09-28 iPhone collection".

The timer mode **was** reported by the operator, as **"Chron"** — that is a reported value,
not an instrumented one. What was **not** recorded: the firmware version, the exact Brave
and macOS versions, the physical gate arrangement, and the operator's exact button actions
and their timing. None of those may be reconstructed from the packets.

Everything below separates four things on purpose:

- **Observed** — bytes present in an archived export.
- **Reported** — what the operator says the timer's own display showed. Not instrumented.
- **Supported interpretation** — a reading of the observed bytes that the observations are
  consistent with, scoped to what was actually tested.
- **Unresolved** — what these observations do not settle.

## Connection and discovery (Observed)

Three device selections all led to a successful GATT connection to a device advertising the
name `BROWER TCi CH 0`. A plausible name is not proof of identity; the discovered services
are, and **both documented services were found on every connection**:

- Timing service `11574949-d37a-4fd7-a171-f36fcdc3a461` — **three** characteristics.
- Serial Number service `ffae864c-ee9f-4f31-ad8a-9bcbac855a9f` — **one** characteristic.

### Observed services and characteristics

| Characteristic | UUID | Properties the device actually advertised |
| --- | --- | --- |
| Power On Counter | `882c254a-d1f1-440f-8d08-4d0e5a9d4226` | read |
| Athlete Data | `bb8722a4-3810-4fd3-9321-f6cbdcc1ea4e` | **write and notify** (no read) |
| Time Base | `ee152c14-79a7-447d-b435-030880aa7d7d` | read |
| Serial Number | `beef94d7-4124-423d-82e0-5aa556bc722b` | read |

Reads succeeded on all three readable characteristics. Representative raw values:
Time Base `00 2B 0D A2`; Power On Counter
`00 06 00 01 00 00 00 00 00 00 00 00 00 00 00 00`; Serial Number `8C 8B`.

**The Current Memory Location characteristic was not found, and no characteristic within
the two documented services was unaccounted for.** The document's claim of four
timing-service characteristics is not matched by the device as observed.

This 2026-09-25 collection enumerated the **two documented services only**, because that is
what the desktop diagnostic requests. It is therefore **not** evidence that the device
exposes nothing else — and the 2026-09-28 iOS session, which enumerated everything, found
that it does.

### Both chooser modes worked (Observed)

The first two connections used the **all-devices** chooser; the third used the chooser
**filtered on the timing service**, and it also found and connected to the device. The
filtered chooser is therefore *not* known to be broken. **No raw advertising capture
exists**, so the advertising example's mismatch with the declared timing-service UUID
remains an open question about the document, not a demonstrated device behaviour.

## Notifications and the display comparison

**Observed:** 12 Athlete Data notification packets, each exactly 20 bytes, across two
listening windows (export 01 sequences 44–47, export 02 sequences 60–67). **No
`command_write` was logged before any of them** — every packet in exports 01 and 02 arrived
unsolicited. (Four further notifications appear in exports 03 and 04; those are replies to
the memory requests described below, in a third listening window, and are not unsolicited.)

**Supported interpretation:** under these conditions the timer delivers athlete packets
without being asked. Do not restate this as a universal guarantee across operating modes
or firmware versions.

### The four comparisons

These use the **documented base-packet field positions**, read **high nibble first** and
**most-significant digit first**. The documented Split 1 field sits at byte offset 9.5 with
a width of 2.5 bytes, i.e. **hexadecimal digit positions 19 through 23 (zero-based) of the
40-digit packet**.

| Export | Seq | Packet bytes | Digits 19–23 | Value | Displays as | Reported display |
| --- | --- | --- | --- | --- | --- | --- |
| 01 | 47 | `00 10 00 FF 00 00 00 36 BC B0 0C 6E 00 …` | `00C6E` | **3182 ms** | 3.18 s | **3.18 s** |
| 02 | 61 | `00 10 00 FF 00 00 00 75 6B 30 07 1D 00 …` | `0071D` | **1821 ms** | 1.82 s | **1.82 s** |
| 02 | 64 | `00 20 00 FF 00 00 00 78 38 50 15 CD 00 …` | `015CD` | **5581 ms** | 5.58 s | **5.58 s** |
| 02 | 67 | `00 30 00 FF 00 00 00 7B 7F D0 28 80 00 …` | `02880` | **10368 ms** | 10.36 s | **10.36 s** |

**Millisecond precision is the value; the hundredths are a display rendering.** Hundredths
are produced by **truncating**, exactly as the manufacturer document requires. The
**10368 ms** observation is the one that distinguishes the two rules: truncation gives
10.36, rounding would give 10.37, and the operator reported 10.36.

**Supported interpretation:** this is evidence for **the tested Chron base-packet fields** —
the Memory Location field and the Split 1 field, under the stated nibble order. It does
**not** establish every packed field, the appendix packets, session headers, any other
timer mode, or any other firmware version.

**Split 2 and beyond — uncorroborated on 2026-09-25, partly corroborated on 2026-09-28.**

The same candidate layout applied to the documented Split 2 field (byte offset 12, width
2.5 bytes, i.e. digits 24–28) of export 01's sequences 44 and 45 gives `2D267` =
**184 935 ms** in both, and sequence 45's Split 3 field (digits 29–33) gives `2E031` =
**188 465 ms**. **No display value and no record of the physical actions exist for those
two packets**, so those particular values remain **unverified** — neither confirmed nor
refuted, because nothing establishes what those fields were supposed to contain, whether a
run was still in progress, or what the gates were doing.

The 2026-09-28 iOS session changed this for splits 2–4 and the appendix — see
"Multi-split records and the appendix packet" below. What is still unestablished past
Split 1: the **3.5-byte start time**, **splits 6–20**, the **second appendix packet**, and
**session headers**.

## Record progression and repeats

**Observed**, in export 02, three times over:

| Seq | Memory-location digits | Split 1 digits | What was observed next |
| --- | --- | --- | --- |
| 60 | `001` | `00000` (zero) | seq 61 carried the same location with a non-zero Split 1 |
| 61 | `001` | `0071D` | seq 62 repeated this packet byte for byte |
| 63 | `002` | `00000` (zero) | seq 64 carried the same location with a non-zero Split 1 |
| 64 | `002` | `015CD` | seq 65 repeated this packet byte for byte |
| 66 | `003` | `00000` (zero) | seq 67 carried the same location with a non-zero Split 1 |
| 67 | `003` | `02880` | nothing further; listening stopped at seq 68 |

The "next" column is a description of what arrived, not a claim about causation. In
particular, a later packet is **not** established as replacing or invalidating an earlier
one.

So: for each candidate record, a packet with a **zero** first split arrived, then a packet
with a **non-zero** first split for the same candidate record. **Sequences 62 and 65 repeat
the sequence 61 and 64 packets byte for byte.**

**Unresolved.** A zero first split is **not** established as identifying a physical start
event, and a first non-zero split is **not** established as meaning a final result. Nothing
here establishes packet **finality** at all: what repeated is simply the two packets whose
values the operator reported seeing on the display.

**The trigger for the byte-for-byte repeats is unknown.** What is observed: seq 62
repeated seq 61 after **6.630 s**; seq 65 repeated seq 64 after **6.719 s**; no repeat of
seq 67 was recorded, and listening was stopped **5.369 s** after it arrived.

Two observed intervals are not a resend interval, and the third packet must **not** be
described as one the device declined to repeat. Whether seq 67 would have repeated later is
simply **unknown**.

## Memory requests

Two controlled experiments, both under the **big-endian** hypothesis, both on the Athlete
Data characteristic.

**Range request (export 03, sequence 70).** Bytes written: `55 01 00 01 00 03 AA`
(type `0x01`, start 1, stop 3). Sequences 72, 73 and 74 followed, and each matches the
previously received **non-zero-split** packet for candidate location 1, 2 and 3 **byte for
byte** ("non-zero-split", not "completed" — finality is not established).

**Single-location request (export 04, sequence 76).** Bytes written: `55 01 00 02 00 02 AA`
(type `0x01`, start 2, stop 2). Sequence 78 is the **only** subsequent recorded
notification in that export, and it matches the location 2 / 5581 ms packet **byte for
byte**.

**Supported interpretation:** for the ranges actually tested, the observations support
**big-endian request addressing** and **selective retrieval** — asking for 2–2 returned the
one record rather than the whole range.

**Unresolved.** **Little-endian was never tested**, so it is not excluded. No address
outside 1–3 was validated, and nothing is established about requesting an unused location,
an out-of-range location, or a range larger than three. **No production controller exists**,
and the diagnostic's controller implements **no** request/response correlation — none is
claimed here: its 4000 ms observation window is a fixed timeout that re-enables the request
control, **not** a completeness guarantee, and a notification arriving after it is recorded
as an uncorrelated observation.

## Anomalies

**Two unexpected disconnects** (export 01, sequences 13 and 26), roughly 13 s and 26 s after
their connections. **Causes unknown.**

**Reconnection after each one is visible in the same export**: sequences 14–16 and 27–29
record a fresh device selection followed by a successful connection. So reconnecting
worked, at least by re-selecting the device. That is **not** the same as a controlled
reconnect test, and no conclusion should be drawn about the operator's intent, about
automatic reconnection (the diagnostic performs none), or about what caused the drops.

**Time Base did not advance.** Reads at sequences 36, 39 and 40 all returned the same bytes:

```text
00 00 33 D7
```

The first and last of those reads are **158.3 seconds apart**. The documented description —
"milliseconds since the TC timer has been powered on" — does not explain three identical
reads across that interval.

For completeness, the full sequence of Time Base reads in that export was `00 2B 0D A2`
(seq 10), `00 2B BC 39` (seq 23), then `00 00 33 D7` three times (seq 36, 39, 40). **The
earlier raw reads differ from each other and from the last three.**

Any numeric reading of these four bytes depends on an assumed byte order, and the direction
of change is **not** byte-order independent: interpreted **big-endian** the values are
2 821 538, 2 866 233, then 13 271 — rising, then falling sharply; interpreted
**little-endian** they are 2 718 771 968, 968 633 088, then 3 610 443 776 — falling, then
rising. **Neither byte order is established**, so no direction of travel should be asserted.
What is observed without any such assumption is that the raw bytes changed between the
first three reads and then did not change at all across the last three.

**This discrepancy is unresolved and is preserved as such.** Do not attribute it to browser
or platform caching, to firmware behaviour, to a power cycle, to a memory clear, or to an
application bug — none of those was instrumented, and the timer's physical state between
reads was not recorded. Consequently **no verified wall-clock timestamp mapping can
be derived from these observations**, and the document's "subtract the time base from the
phone clock" procedure is untested.

**Also observed, without interpretation:** the Power On Counter's first two bytes read
`00 06` on the first connection and `00 07` on the second and third. What changed it is not
recorded.

## What the 2026-09-25 test collection did not cover

Not exercised as a controlled experiment **in that collection**, and therefore unverified
in their effects by it: the session-header (bib 1000) packet, appendix packets, the Time
Base / Session / Sequence command (`0x02`), channel and test commands, clearing the timer's
memory, the New Athlete workflow, a power cycle, a deliberate Disconnect-then-reconnect
test, and any second timer mode.

**Appendix packets are the one item the 2026-09-28 collection moved** — see "Multi-split
records and the appendix packet" below. Everything else in this list remains untested by
both collections.

**This is a statement about what was documented, not about what physically happened.** The
operator's exact button presses were not recorded, so it is equally unestablished whether
the timer was power-cycled, cleared, or advanced to a new athlete at some point during the
collection. Neither the occurrence nor the absence of those actions may be asserted, and
their effects on the protocol remain unverified.

---

# The 2026-09-28 iPhone collection

**Different transport, different host, different physical setup.** This session used the
separate native iOS probe (`tools/brower-ios-probe/`) on a physical iPhone over
CoreBluetooth — **not** this application, and **not** Web Bluetooth. The operator reports
that the **TCi was tested alone, without timing gates**, and that measurements were
produced by **repeated Manual Start presses**. Treat it as a second observation, not a
repetition of the first experiment.

Full provenance, the complete packet tables and the independent checks are in the
[archive README](hardware/brower/observations/2026-09-28-ios-manual/README.md). Only the
protocol conclusions are here.

## Services outside the manufacturer document (Observed, 2026-09-28)

The iOS probe enumerates **every** service the device reports, not only the two the
manufacturer document describes. It found four:

| Service | UUID | In the document? | Characteristics |
| --- | --- | --- | --- |
| Timing | `11574949-d37a-4fd7-a171-f36fcdc3a461` | yes | **three** — Athlete Data (`write,notify`), Time Base (`read`), Power On Counter (`read`) |
| Serial Number | `ffae864c-ee9f-4f31-ad8a-9bcbac855a9f` | yes | one — Serial Number (`read`) |
| — | `0000180a-0000-1000-8000-00805f9b34fb` | **no** | six, all `read` (`00002a00`, `00002a23`, `00002a24`, `00002a26`, `00002a27`, `00002a29`, all in the `0000xxxx-0000-1000-8000-00805f9b34fb` short-UUID range) |
| — | `1d14d6ee-fd63-4fa1-bfa4-8f47b42119f0` | **no** | one — `f7bf3564-fb6d-4e53-88a4-5e37e0326063`, `write` only |

**Observed only.** Nothing was read from either undocumented service and nothing was
written to any characteristic — the probe's transport declares no write operation at all.

**Unresolved, and not to be guessed.** What these two services are, what the write-only
characteristic `f7bf3564-…` accepts, and whether any of this relates to the document's
unnamed **Current Memory Location** characteristic are all **unknown**. A write-only
characteristic on an undocumented service is not evidence of a memory-location feature, and
**labelling it Current Memory Location would be exactly the kind of plausible guess this
document exists to prevent.** The timing service still enumerates three characteristics on
both transports, so the document's fourth timing-service characteristic remains unaccounted
for *within that service*.

## Split 1 reproduced on a second transport (Supported interpretation)

Three further comparisons, using the same documented field position (digits 19–23) and the
same nibble order:

| Export | Seq | Split 1 digits | Value | Displays as | Reported display |
| --- | --- | --- | --- | --- | --- |
| 01 | 26 | `00A90` | **2704 ms** | 2.70 s | **2.70 s** |
| 01 | 29 | `01527` | **5415 ms** | 5.41 s | **5.41 s** |
| 01 | 32 | `027F8` | **10232 ms** | 10.23 s | **10.23 s** |

5415 ms again distinguishes the rules: truncation gives 5.41, rounding would give 5.42, and
the operator reported 5.41. **Truncation to hundredths now has seven independent
confirmations across two transports.**

**The operator read a display in hundredths.** The millisecond values come from the packet
bytes. Nothing establishes that the operator observed millisecond precision.

Sequences 27 and 30 repeat sequences 26 and 29 **byte for byte**, reproducing the
2026-09-25 repeat behaviour on a second transport. **The trigger for a repeat is still
unknown**, and a repeat still establishes nothing about finality.

## Multi-split records and the appendix packet (Supported interpretation)

Export 02 is the first observation of a record carrying more than one split. The operator
reports one record built by repeated Manual Start presses **without pressing New between
them**, on a display where **CUM** shows time since the original start and **SEG** the
interval since the preceding split.

**Six base-packet versions** of one record arrived — an initial version (sequence 63) plus
**five updates** (sequences 64–68). Each version repeats the previous one's digits and adds
exactly one more field; the first differing hexadecimal digit across the five transitions is
21, 25, 30, 35, then 39. All six carry memory location digits `001` (digits 0–2), athlete-
number digits `000` (digits 3–5), an unattributed region `FF0000` (digits 6–11) and an
identical **documented start-time field** `0064CFF` (digits 12–18, 3.5 bytes).

Reading the documented base-packet split fields at digits 19–23, 24–28, 29–33 and 34–38,
and the documented 0.5-byte appendix count at digit 39:

| Field | Digits (final base packet) | Value |
| --- | --- | --- |
| Split 1 | `00DF7` | 3575 ms |
| Split 2 | `03A28` | 14 888 ms |
| Split 3 | `050FD` | 20 733 ms |
| Split 4 | `083F3` | 33 779 ms |
| Appendix count | `1` | one appendix packet |

Digit 39 changed from `0` to `1` in a packet pair whose **only** other difference was that
digit, and an appendix packet arrived **2 ms** later. Read as eight 5-digit split fields
from digit 0 — the layout the documented "up to two appendix packets carrying splits 5–12
and 13–20" implies, and which fills 20 bytes exactly — that packet yields **Split 5 =
`0AE95` = 44 693 ms** and seven zeros.

**Cumulative candidates:** 3575, 14 888, 20 733, 33 779, 44 693 ms.
**Consecutive differences:** 3575, 11 313, 5845, 13 046, 10 914 ms.

The operator confirmed agreement with these values, at their display's resolution.

**What this supports**, for the tested Chron case only, stated at the narrowest scope the
bytes justify:

- **Splits 2, 3 and 4 at the documented positions under the documented nibble order**,
  producing a monotonically increasing sequence consistent with the documented rule that
  splits are relative to the **start time**.
- **The appendix-count field at digit 39** — one observed transition, `0` → `1`, in a
  packet pair whose only other difference was that digit, followed by an appendix packet.
- **The first appendix packet's first split field** — one non-zero 5-digit field at digits
  0–4 whose value continues the increasing sequence.

This is the first corroboration of anything past Split 1.

**What it does not establish.**

- **Appendix-packet structure as a whole.** One non-zero field was observed. The remaining
  seven 5-digit fields were **zero-filled**, and zeros are not evidence that they are split
  fields, that splits 6–12 sit where the layout implies, or that a **second** appendix
  packet behaves as documented. Only the one tested field and the one observed count
  transition are corroborated.
- **Splits 6–20**, and behaviour at the documented 20-split limit.
- **The start-time field.** Its digits (12–18) were **unchanged within the record**, which
  is consistent with the documented reading but establishes nothing: Time Base was never
  read in this session, so no absolute reference exists.
- **That the consecutive differences are what SEG displayed packet by packet.** The
  operator confirms the SEG semantics and agrees with the values, but individual SEG
  readings were not recorded per packet, and the display shows **hundredths** — every
  millisecond value here was calculated from bytes, not read off a display.
- **BLE arrival times are not timer measurements** and must never be substituted for them;
  the 2 ms figure is an arrival-time fact about the appendix packet.
- **Record finality.** Six versions of one record were observed — an initial version plus
  five updates — and nothing in the bytes marked any of them final.

## What the 2026-09-28 collection did not cover

Not attempted, and therefore unresolved by it: **any characteristic read** (Time Base,
Power On Counter and Serial Number were all discovered as readable; none was read, so the
Time Base discrepancy is untouched); **any write to the timer** (the probe's transport
declares no write operation); the **all-nearby fallback** chooser; **backgrounding or
screen lock while a subscription is active**; a deliberate **Disconnect-then-reconnect**
test; **timing gates**; **20-split exhaustion**; the **New Athlete workflow**; **session
headers**; **any other timer mode or firmware version**; and **Android**, about which
nothing in this collection is evidence.

---

# Implemented diagnostic capabilities

A development-only diagnostic exists so these questions can be answered from evidence
rather than argument — and on 2026-09-25 it did so against real hardware, running in
**Brave on macOS** against the localhost development server. It is reached from
**Settings → Developer Tools → Open BLE Diagnostic**, inside the normal authenticated,
Profile-scoped application. A production
build contains no Web Bluetooth call site, no controller and no diagnostic view — see
`docs/SYSTEM_ARCHITECTURE.md` for exactly what that claim does and does not cover.

Code: `src/lib/brower/` (protocol constants, the bounded log, the Web Bluetooth surface,
the controller) and `src/components/BrowerBleDiagnosticScreen.tsx`.

It can:

- Connect to one selected BLE device, either filtered on the timing service or through an
  explicit fallback chooser that shows all nearby devices with both documented services
  requested as optional.
- Report which documented services and characteristics were found, and the read / write /
  writeWithoutResponse / notify / indicate properties the device **actually** advertises.
  A service or characteristic query that *fails* is reported as unknown and flagged as
  incomplete discovery — never as evidence that the device lacks it. Only the platform's
  `NotFoundError` is treated as confirmed absence.
- Read Time Base, Power On Counter and Serial Number as raw bytes, but only where the
  discovered properties permit a read.
- Subscribe to Athlete Data notifications and preserve each received byte sequence
  independently, copied at receipt time. The subscription is offered only when discovery
  actually confirmed the characteristic; if the enumeration that would have answered that
  question failed, the view says so and the control stays unavailable rather than
  appearing usable and doing nothing.
- Send one bounded athlete-data request (**command type `0x01` only**) for at most 10
  consecutive addresses in 1–499, after a human has explicitly chosen a byte-order
  hypothesis, with the exact 7 bytes shown before sending.
- Show and export a bounded diagnostic log as versioned JSON. The log is in memory only
  and is destroyed when the view closes, so evidence must be exported before closing,
  clearing, or navigating away.

It deliberately does **not**:

- Produce a `TimingResult`, or save any shot, session, assessment or exercise result.
- Persist anything. The log lives in memory only and leaves the browser only through an
  explicit download.
- Decode any packet field. **This is still true after the 2026-09-25 session.** The
  diagnostic displays and exports raw bytes only; the offline analysis in "Physical
  observations" was performed against exported files, never in the application. Building a
  decoder from a partial Gate C result would put a guess on screen as a measurement.
- Send New Athlete (`0x0A`), clear, reset, channel or test commands, or offer a free-form
  hex console. Nothing is written automatically at any point.
- Reconnect automatically, retry, or poll.

The retrieval **observation window** is a fixed timeout that re-enables the request
control. It is not proof that all device replies have arrived, and a late notification is
recorded as a raw, uncorrelated observation — request/response correlation is not claimed.

## What the automated tests do and do not prove

The unit, component and Playwright tests for the diagnostic run against an **injected mock
Bluetooth API**. Every packet in them is synthetic. They prove the application's own
lifecycle, serialization, validation, property-awareness, isolation and logging. They are
**not** evidence about Brower firmware behaviour.

## Native iOS transport probe (separate prototype, 2026-09-27; run on hardware 2026-09-28)

A **bounded engineering prototype** for native iOS BLE transport exists at
`tools/brower-ios-probe/`, documented in
[`docs/BROWER_IOS_FEASIBILITY.md`](BROWER_IOS_FEASIBILITY.md).

It is a **separate developer instrument**, not part of this application: no account, no
Profile, no cloud connection, no sporting records, no `TimingProvider` integration, and
**no ability to write to the timer at all** — its transport interface declares no write
operation. It decodes nothing, and it does not change the desktop diagnostic described
above.

Its source, tests and native scaffold are complete, and on **2026-09-28 it was signed,
installed and run on a physical iPhone**. It connected to the timer twice, discovered both
documented services with their real properties, and received 15 real Athlete Data
notifications — the evidence behind "The 2026-09-28 iPhone collection" above, archived at
[`docs/hardware/brower/observations/2026-09-28-ios-manual/`](hardware/brower/observations/2026-09-28-ios-manual/README.md).

**Native iOS BLE transport to this timer is therefore demonstrated.** What is **not**
demonstrated by it: any characteristic read, any write, real timing-gate behaviour,
lifecycle races while a subscription is active (the app was never backgrounded during the
listening window), 20-split exhaustion, automatic New, and **anything whatsoever about
Android** — no Android project exists.

**It changes no acceptance gate's definition.** A native app receiving the same bytes is
evidence about **transport**; what its packets moved *within* Gate C is stated in the gate
table below, and production capture integration is untouched by it. The probe's platform
checks and diagnostic architecture must not become the production application's
cross-platform boundary — see
[`docs/MOBILE_APP_MIGRATION.md`](MOBILE_APP_MIGRATION.md) §10 Stage M4.

---

# Acceptance gates

These are separate. Passing an earlier one never implies a later one.

| Gate | Meaning | State |
| --- | --- | --- |
| **A** | A real connection to the physical timer, and a successful characteristic read | **Demonstrated** (2026-09-25) |
| **B** | Receipt of real Athlete Data notification bytes | **Demonstrated** (2026-09-25, and again on iOS 2026-09-28) |
| **C** | Verified encoding and timing interpretation, established from evidence | **Partial — not passed** |
| **D** | Production capture integration through the provider-neutral boundary | **Not started** |

**Gate A — Demonstrated.** Three GATT connections, both documented services discovered,
and successful reads of all three readable characteristics, in exported logs from a real
device (2026-09-25). The 2026-09-28 iOS session connected and discovered, but **read no
characteristic**, so it does not independently satisfy this gate.

**Gate B — Demonstrated.** 12 real unsolicited Athlete Data notification packets on
2026-09-25, alongside the values the operator reported the timer displaying for four of
them, plus 4 further packets received as replies to memory requests. A further 15 real
notification packets arrived on 2026-09-28 from a physical iPhone, with three more reported
display values.

**Gate C — Still partial, and still deliberately not declared passed.** The 2026-09-28
collection moved it, and the movement is worth stating precisely.

*What is now supported:* Memory Location; **splits 1–4** of the Chron base packet; the
**appendix-count field**; **appendix-packet structure**; the nibble order; truncation to
hundredths (seven confirmations); and big-endian memory-request addressing on the tested
ranges. Split 1 and the repeat behaviour have now **reproduced on a second transport**.

*Why the gate is still not passed:* the **3.5-byte start time**, **splits 6–20**, the
**second appendix packet** and **session headers** are still unverified. **Record finality
is unestablished** — on 2026-09-28 a single record was observed in six versions (an
initial version plus five updates), and
nothing marks a record complete. Little-endian was never tested. The two collections used
different transports and different physical setups, and the 2026-09-28 session used **no
timing gates**, so "reproduces across sessions" holds for Split 1 and the repeats but not
for the protocol as a whole. **Do not redefine this gate to declare it passed, and do not
write a decoder against a partial result.**

**Gate D — Not started.** No production timing provider, transport, or capture integration
exists. A native iOS transport existing in a **separate prototype** is not a production
transport.

---

# Architecture direction

The application consumes **provider-neutral timing events**. Whether they originate from
manual entry, Brower BLE, or any future provider must not affect the Capture Foundation,
Training Engine, Assessment or Analytics.

```text
Timing Provider
├── Manual
├── Simulator (development/test only)
├── Brower BLE   (Planned — does not exist)
└── Future providers
        │
        ▼
Capture Foundation → Training Engine / Assessment → Analytics
```

A future Brower adapter connects via BLE, identifies the TCi Timer, retrieves timing
records, parses Brower packets, and converts them into provider-neutral timing events. The
rest of the application stays unaware of Brower-specific concepts.

**The diagnostic described above is not that adapter and must not grow into one.** It is a
discovery instrument with no path into sporting data. Production capture must go through
`TimingProvider` / `TimingResult` (`src/lib/timingProvider.ts`,
`src/lib/captureSequence.ts`) and, for Blind Weight, `setMeasuredReleaseTime` — see
ADR-0006 and `docs/SYSTEM_ARCHITECTURE.md`.

---

# Open questions for Brower

Still worth asking, and cheaper than deriving from observation. The 2026-09-25 session
narrowed some of these; where it did, the remaining question is stated precisely rather
than dropped.

**High priority**

- **Byte order and nibble ordering for the fields the sessions did not reach.** High nibble
  first / most-significant digit first now reproduces the displayed time from the
  documented Split 1 field, the requested location from the Memory Location field, and — on
  2026-09-28 — splits 2–4, the 0.5-byte appendix count and one appendix packet. Does the
  same rule apply to **splits 6–20**, the **3.5-byte start time**, the **second appendix
  packet**, and the **session-header layout**?
- **Command-field byte order.** Big-endian addressing worked for the ranges tested.
  Little-endian was never sent — is big-endian in fact the wire order?
- **What triggers a repeat?** Two non-zero-split packets were observed re-sent byte for
  byte, roughly 6.6–6.7 s after their originals. Under what conditions does the timer
  resend a record, and does it stop? (The evidence cannot say whether a third such packet
  would also have repeated — listening was stopped before that interval had elapsed.)
- **What does a zero first split mean?** Packets with a zero first split preceded packets
  with a non-zero first split for the same record. Is the zero packet a start event, a
  placeholder, or something else — and can a non-zero split later be superseded or
  corrected?
- Can individual trigger events (start, split, finish) be received, or only completed
  athlete records?
- Are split times streamed immediately, or only once the athlete has finished?
- What is the UUID of the Current Memory Location characteristic? The device enumerated
  only three timing-service characteristics.
- Which service UUID is actually advertised? A timing-service-filtered chooser did find the
  device, but no raw advertising data was captured.
- **Why can consecutive Time Base reads return identical bytes** across more than two
  minutes, and what is the correct procedure for deriving a wall-clock timestamp?
- How is the "New Athlete" workflow intended to be used for repeated shots without
  friction?

**Medium priority**

- Is the BLE protocol considered stable across firmware versions? (The tested unit's
  firmware version was not recorded.)
- What causes an unexpected disconnect a few seconds into a connection, and does the timer
  accept more than one concurrent BLE central?
- Are sample BLE packets, a simulator, or development hardware available?

**Low priority**

- Licensing requirements; whether third-party software may advertise Brower compatibility.

Technical contact: **Dan**, at Brower Timing Systems.

---

# Hardware background

## Existing club hardware (legacy system)

- Older Brower Timing System, blue Brower photogates, three timing gates, large display.
- No Smartphone Interface.

Observed behaviour — **Normal mode**: gate 1 starts, gate 2 stops, gate 3 starts a new
measurement. **Split mode**: gate 2 shows an intermediate split with the timer still
running, gate 3 shows the next split.

The legacy system provides no official mechanism for transferring timing data to an
external application.

## Legacy hardware investigation

Display: Motherboard V4, Daughterboard Rev3, TI MSP430F448, TI CC1101 RF transceiver.
Timing gate: TI CC1150 RF transmitter.

RF characteristics confirmed from the Brower manual: **432.8 MHz**, roughly **300 m**
range, **1/1000 s** resolution, **0.0005 s** RF delay.

## Official Brower response

Brower confirmed the recommended integration path is the **TCi Timer with Smartphone
Interface**: existing blue photogates remain compatible, only the timer/display is
replaced, previous-generation photogates are supported, and Brower is willing to support
the integration.

> "The only way forward is to use the TCi Timer with the Smartphone Interface."

---

# Decision log

## Decision 001 — Do not tightly couple the application to Brower

**Accepted.** Still current.

## Decision 002 — Keep manual time entry permanently available as a fallback

**Accepted.** Still current.

## Decision 003 — Prefer the officially supported BLE interface over reverse engineering

**Accepted.** Still current. Reverse engineering the legacy 432.8 MHz RF link remains
technically feasible and is retained only as a fallback, should the official BLE interface
prove insufficient, unsupported legacy hardware need integrating, or official hardware
become unavailable.

## Decision 004 — Delay purchasing the TCi Timer until remaining questions are answered

**Superseded (2026-09-25).** The TCi Timer has been received. Procurement is no longer a
blocker, and the remaining protocol questions are now expected to be settled by direct
observation of the device, supplemented by the questions to Brower listed above.

## Decision 005 — Establish the protocol by evidence, through an isolated diagnostic

**Accepted (2026-09-25).** Rather than writing a speculative decoder against the
unresolved encoding questions, the first hardware stage is a development-only diagnostic
that records raw bytes and cannot reach sporting data. No unverified interpretation is
displayed or persisted. See "Implemented diagnostic capabilities" above.

**Outcome after the first collection (2026-09-25).** The approach worked: the first test
collection produced real connection, discovery, read and notification evidence, and the
offline comparison against reported display values supported the tested Chron base-packet
fields.

It also showed why the decision matters. Four displayed times were reproduced exactly, and
yet **at that point** the very next field along had no corroboration either way, because no
display value or physical context had been recorded for the packets that carry it. That
statement describes the state of knowledge after the 2026-09-25 collection; it is
**not** the current position.

**Outcome after the second collection (2026-09-28).** The same discipline paid off again,
and moved the boundary rather than erasing it. Splits 2–4, the appendix-count transition
and one appendix split field are now corroborated; the start time, splits 6–20, the second
appendix packet, session headers and **record finality** are not. **A decoder written today
would still have to guess** — about where a record ends, about every field past the tested
ones, and about what a repeat means — and would present those guesses as measurements. The
diagnostic still has no decoder, and **Gate C is still not passed.**

**Identified as a possible future task, not authorized here:** a narrowly scoped decoder
*specification* — covering only fields that evidence supports, with an explicit
representation for "this field is not established" — could be written once Gate C has
reproduced across sessions **with timing gates**, which neither collection used for the
multi-split case. Nothing in this document authorizes writing that specification or any
decoder, and no product decision about it has been made.
