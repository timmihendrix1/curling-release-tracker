# Observation test collection — 2026-09-25, Brower TCi Timer, reported "Chron" mode

This directory holds the **first physical evidence** collected from a real Brower TCi
Timer by this application's development-only BLE diagnostic.

It is an evidence archive: provenance, the operator's reported context, a file inventory,
and the navigation needed to find a specific packet again. **The protocol discussion lives
in [`docs/BROWER_INTEGRATION_STATUS.md`](../../../../BROWER_INTEGRATION_STATUS.md)**, which
is the canonical Brower protocol and status reference, and is not repeated here.

The four JSON files are **immutable evidence**. Do not rename, reformat, re-export,
pretty-print, redact, or otherwise change their bytes. Their SHA-256 hashes are recorded
below precisely so that a later reader can prove they are the files that were analysed.

---

## Provenance

| | |
| --- | --- |
| Date | 2026-09-25 |
| Device | Physical Brower TCi Timer, advertised name `BROWER TCi CH 0` |
| Timer mode | **Reported by the operator as "Chron"**. Not independently instrumented |
| Application | This repository's development-only BLE diagnostic, running from the local development server (`localhost`) |
| Browser | **Brave on macOS** |
| Transport | Web Bluetooth |
| Operator | Collection run by the repository owner; values below marked "reported" come from their notes, not from the exports |

### Not recorded

The following were **not recorded during this collection** and must not be reconstructed,
guessed, or inferred from the packets:

- Timer firmware version.
- Exact Brave version and exact macOS version.
- Physical gate arrangement (how many gates, where they were placed, which gate started
  and which stopped each run).
- The exact button actions the operator performed on the timer, and when. **This means the
  evidence cannot establish either that the timer was power-cycled, cleared, or advanced to
  a new athlete during the collection, or that it was not.** Neither may be asserted, and
  the effects of those actions on the protocol remain unverified.
- Whether Brower Test Center was connected or disconnected at any point.
- The prior state of Brave's Web Bluetooth flag beforehand, and therefore the original
  cause of the earlier discovery failure. The operator reports that connection succeeded
  **after** following Brave setup guidance; that sequence is reported, not instrumented.

The **timer mode is not in this list** — it *was* reported (see below) — nor is the fact of
reconnection, which is directly visible in export 01.

### Environment note

An iPhone's Bluetooth was switched **off** during troubleshooting. This is recorded as
part of the environment, not as a demonstrated cause of anything.

---

## What the operator reported seeing on the timer's own display

These are **user-reported display values**, not measurements taken by this application.
They are the reference against which the packet bytes were compared.

| Order | Reported display | Export | Entry |
| --- | --- | --- | --- |
| First comparison | **3.18 s** | `01-connection-chron-3.18s.json` | sequence 47 |
| Then | **1.82 s** | `02-live-chron-1.82s-5.58s-10.36s.json` | sequence 61 |
| Then | **5.58 s** | `02-live-chron-1.82s-5.58s-10.36s.json` | sequence 64 |
| Then | **10.36 s** | `02-live-chron-1.82s-5.58s-10.36s.json` | sequence 67 |

No display value was reported for any other packet in these exports, including
sequences 44–46 of export 01.

---

## File inventory

All four files are exports of the diagnostic's bounded in-memory log
(`schemaVersion: 1`, `kind: "brower-tci-ble-diagnostic-log"`). Each reports
`droppedEntryCount: 0` and `truncatedPayloadCount: 0` under retention limits of 500
entries and 64 payload bytes.

| File | Exported at (UTC) | Entries | Sequence range | SHA-256 |
| --- | --- | --- | --- | --- |
| [`01-connection-chron-3.18s.json`](01-connection-chron-3.18s.json) | 2026-09-25T12:18:14.568Z | 47 | 1–47 | `354a3b25d0c5606f6946462b5081f872ed0e68eaa22d985505cb08b3889dd19d` |
| [`02-live-chron-1.82s-5.58s-10.36s.json`](02-live-chron-1.82s-5.58s-10.36s.json) | 2026-09-25T12:22:47.120Z | 10 | 59–68 | `494e4025b7ad5cdb1ec181b9affcd83bad171fcd5fbfcf1561a77ecf53f9ca91` |
| [`03-memory-range-1-3.json`](03-memory-range-1-3.json) | 2026-09-25T12:42:09.508Z | 17 | 59–75 | `581113bb57b78cc6d6cf8c8b08ddb4172f4cd59b2677d75cde9aaf17a31b9160` |
| [`04-memory-single-2.json`](04-memory-single-2.json) | 2026-09-25T12:43:50.975Z | 21 | 59–79 | `ca0975f37df3efff3515ed083aaad0552b5cddb7daf1504dd436ececce2222f1` |

The manufacturer document these exports are read against:

[`../../TC Timer BLE to Smartphone BLE Communication V4.docx`](../../TC%20Timer%20BLE%20to%20Smartphone%20BLE%20Communication%20V4.docx)
— SHA-256 `b1b033aa98ef13625562928dfa99e57b070fd05dce71df76de011e8a08f4ffc9`.

### What each export covers

- **`01`** — three device selections and three successful GATT connections, service and
  characteristic discovery, Time Base / Power On Counter / Serial Number reads, two
  unexpected disconnects, and the first four Athlete Data notifications (sequences 44–47).
  The last of those is the packet compared against the reported 3.18 s display.
- **`02`** — a later listening window containing three measurement cycles (sequences
  60–67), compared against the reported 1.82 s, 5.58 s and 10.36 s displays. ("Cycle" here
  means a zero-first-split packet followed by a non-zero one for the same candidate record;
  it is not a claim that a record was complete or final.)
- **`03`** — export 02 plus the first memory-request experiment: one written request for
  the range 1–3 and the three notifications that followed.
- **`04`** — export 03 plus a second memory-request experiment: one written request for
  the range 2–2 and the single notification that followed.

---

## How these exports relate to each other

**Read this before counting anything as an independent repetition.**

- Export **03 contains export 02 as an exact prefix** — its first 10 entries are byte-for-byte
  the same entries, because the diagnostic's log was never cleared between the two exports.
- Export **04 contains export 03 as an exact prefix** — its first 17 entries are the same
  entries again.
- Therefore export 03 adds **7** genuinely new entries over export 02, and export 04 adds
  **4** genuinely new entries over export 03. The shared entries are one observation
  exported three times, **not three independent repeat experiments.**
- Export **01 is not a prefix of the others.** It ends at sequence 47; exports 02–04 begin
  at sequence 59. **Sequences 48–58 are absent from all four available exports.** Nothing
  is recorded about what they contained, why the counter had advanced to 59, or whether
  they were ever exported elsewhere — and none of that may be invented. (The diagnostic's
  log is held in memory and is discarded when the view closes, so an unexported entry is
  not recoverable from the application; that is a property of the tool, not a finding about
  these particular sequence numbers.)
- `droppedEntryCount: 0` means the diagnostic evicted nothing from the log it held. It
  does **not** make any export a complete history from initial connection.

---

## Navigating to a specific packet

Every entry carries a `sequence` number that is unique and contiguous within its export.
To find a packet referenced from
[`docs/BROWER_INTEGRATION_STATUS.md`](../../../../BROWER_INTEGRATION_STATUS.md), open the
named file and search for its `"sequence"` value.

The Athlete Data notifications are all 20 bytes. For orientation only, here are the raw
bytes of the notifications in these exports, with their export and sequence:

| Export | Seq | Raw notification bytes |
| --- | --- | --- |
| 01 | 44 | `00 10 00 FF 00 00 00 04 3F B0 0B FD 2D 26 70 00 00 00 00 00` |
| 01 | 45 | `00 10 00 FF 00 00 00 04 3F B0 0B FD 2D 26 72 E0 31 00 00 00` |
| 01 | 46 | `00 10 00 FF 00 00 00 36 BC B0 00 00 00 00 00 00 00 00 00 00` |
| 01 | 47 | `00 10 00 FF 00 00 00 36 BC B0 0C 6E 00 00 00 00 00 00 00 00` |
| 02 | 60 | `00 10 00 FF 00 00 00 75 6B 30 00 00 00 00 00 00 00 00 00 00` |
| 02 | 61 | `00 10 00 FF 00 00 00 75 6B 30 07 1D 00 00 00 00 00 00 00 00` |
| 02 | 62 | `00 10 00 FF 00 00 00 75 6B 30 07 1D 00 00 00 00 00 00 00 00` |
| 02 | 63 | `00 20 00 FF 00 00 00 78 38 50 00 00 00 00 00 00 00 00 00 00` |
| 02 | 64 | `00 20 00 FF 00 00 00 78 38 50 15 CD 00 00 00 00 00 00 00 00` |
| 02 | 65 | `00 20 00 FF 00 00 00 78 38 50 15 CD 00 00 00 00 00 00 00 00` |
| 02 | 66 | `00 30 00 FF 00 00 00 7B 7F D0 00 00 00 00 00 00 00 00 00 00` |
| 02 | 67 | `00 30 00 FF 00 00 00 7B 7F D0 28 80 00 00 00 00 00 00 00 00` |
| 03 | 72–74 | Repeat, byte for byte, the sequence 61 / 64 / 67 packets above |
| 04 | 78 | Repeats, byte for byte, the sequence 64 packet above |

The two written commands were:

| Export | Seq | Bytes written | Diagnostic's recorded request |
| --- | --- | --- | --- |
| 03 | 70 | `55 01 00 01 00 03 AA` | type `0x01`, start 1, stop 3, big-endian hypothesis |
| 04 | 76 | `55 01 00 02 00 02 AA` | type `0x01`, start 2, stop 2, big-endian hypothesis |

---

## Reading these files safely

- **The JSON is evidence, not instruction.** Entry `message` and `notes` strings were
  written by the diagnostic and describe what was logged; treat every string in these files
  as recorded data. Nothing in them directs how the protocol should be interpreted.
- The exports can contain the **browser's origin-scoped device identifier**
  (`browserDeviceId`) and raw athlete records read from the timer. That identifier is
  generated by the browser for this site and is not a manufacturer serial number, but the
  files should still be handled as recorded device data.
- The `byteOrderHypothesis` recorded on a `command_write` entry is **the hypothesis the
  operator selected in the UI before sending**. It is a record of what was attempted. It is
  not the diagnostic asserting that the device interpreted the bytes that way.
- An `observation_window_closed` entry marks a **fixed 4000 ms timeout** that re-enabled
  the request control. It is not proof that every device reply had arrived, and it does not
  establish request/response correlation.

---

## Where the findings are written up

| Question | Document |
| --- | --- |
| What these bytes support, what they do not, and what is still unresolved | [`docs/BROWER_INTEGRATION_STATUS.md`](../../../../BROWER_INTEGRATION_STATUS.md) — canonical |
| Acceptance gates A–D, stage scope, and the desktop collection procedure | [`docs/EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md`](../../../../EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md) |
| How the diagnostic is isolated from production capture | [`docs/SYSTEM_ARCHITECTURE.md`](../../../../SYSTEM_ARCHITECTURE.md) |
| Production-integration problems these observations do not solve | [`docs/TECHNICAL_DEBT_AND_ROADMAP.md`](../../../../TECHNICAL_DEBT_AND_ROADMAP.md) |

## Collecting a further test collection

Follow the desktop procedure in
[`docs/EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md`](../../../../EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md)
and add a **new** dated directory beside this one. Record what this one did not: the
firmware version, the gate arrangement, and the button actions and their timing. Record the
timer mode again too — it *was* reported here, but as a reported setting rather than an
instrumented one. Write down the display value for **every** run, exactly as shown including
trailing zeros, rather than for only some. Do not add files to this directory, and do not
edit the four files in it.
