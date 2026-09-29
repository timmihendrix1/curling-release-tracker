# Observation test collection — 2026-09-28, Brower TCi Timer, reported "Chron" mode, **native iOS**

This directory holds the **first evidence collected from a physical iPhone**. It was
produced by the development-only native iOS BLE transport probe at
[`tools/brower-ios-probe/`](../../../../../tools/brower-ios-probe/README.md), not by the
desktop Web Bluetooth diagnostic and not by the Curling Performance Platform application.

It is an evidence archive: provenance, the operator's reported context, a file inventory,
the independent checks that were performed, and the limits of what those checks establish.
**The protocol discussion lives in
[`docs/BROWER_INTEGRATION_STATUS.md`](../../../../BROWER_INTEGRATION_STATUS.md)**, which is
the canonical Brower protocol and status reference, and is not repeated here.

The two JSON files are **immutable evidence**. Do not rename, reformat, re-export,
pretty-print, redact, or otherwise change their bytes. Their SHA-256 hashes are recorded
below precisely so that a later reader can prove they are the files that were analysed.

---

## Provenance

| | |
| --- | --- |
| Date | 2026-09-28 |
| Device under test | Physical Brower TCi Timer, advertised name `BROWER TCi CH 0` |
| Timer mode | **Reported by the operator as "Chron"**. Not independently instrumented |
| Application | `tools/brower-ios-probe/` — the development-only native iOS BLE transport probe |
| Host | **Physical iPhone**, running the probe as a development build |
| Transport | `@capacitor-community/bluetooth-le` over iOS CoreBluetooth (as declared in each file's `probe` block) |
| Export format | `brower-tci-ios-native-ble-probe-log`, `schemaVersion: 1` — **not** the desktop `brower-tci-ble-diagnostic-log` format |
| Operator | Collection run by the repository owner; values below marked "reported" come from their notes, not from the exports |

### Not recorded

The following were **not recorded during this collection** and must not be reconstructed,
guessed, or inferred from the packets:

- iPhone model and iOS version.
- Timer firmware version.
- Whether iOS displayed a Bluetooth permission prompt, and how it was answered. The probe
  logged `bluetooth_ready` ("Bluetooth initialised and reported as enabled"); it did not
  record a prompt.
- Whether Brower Test Center, the desktop diagnostic, or any other central was connected
  at any point.
- The operator's exact button presses and their timing, beyond the summary they reported
  below.

### Reported physical setup

Reported by the operator, not instrumented:

- The **TCi was tested alone, without timing gates.**
- Measurements were produced by **repeated Manual Start presses**.
- In the second export, the repeated Manual Start presses were made **without pressing
  New between them**.
- On the timer's own display, **CUM** shows the time since the original start and **SEG**
  shows the interval since the preceding split.

---

## File inventory

| File | Exported at (UTC) | Entries | Sequence range | SHA-256 |
| --- | --- | --- | --- | --- |
| [`01-chron-manual-separate-records.json`](01-chron-manual-separate-records.json) | 2026-09-28T10:48:46.530Z | 37 | 1–37 | `4c8649a0cf89fee82159579a5f53b87ec281ef7e6aaf4b68e04697e34966ca55` |
| [`02-chron-manual-cumulative-splits.json`](02-chron-manual-cumulative-splits.json) | 2026-09-28T10:52:56.074Z | 8 | 62–69 | `da8e243310b71ede7f922fa3318714b9e380f61265264f7019833c502f6995f4` |

Both files report `droppedEntryCount: 0` and `truncatedPayloadCount: 0` under retention
limits of 500 entries and 64 payload bytes. Both were copied here **byte for byte** from
the operator's exports; the hashes above were verified on the source files before copying
and on the archived copies afterwards.

The manufacturer document these exports are read against:

[`../../TC Timer BLE to Smartphone BLE Communication V4.docx`](../../TC%20Timer%20BLE%20to%20Smartphone%20BLE%20Communication%20V4.docx)
— SHA-256 `b1b033aa98ef13625562928dfa99e57b070fd05dce71df76de011e8a08f4ffc9`.

### How these two files relate to each other

**Export 02 is not a continuation of export 01's log.** Its first entry is
`log_cleared` at sequence 62, and its notifications belong to a **later, separate GATT
connection** (`connectionEpoch` 6, connected at 10:51:38.725Z). Export 01's notifications
belong to `connectionEpoch` 3.

Export 02's `connections` metadata still lists **both** connections, including epoch 3,
whose `connectedAt` (10:45:49.336Z) **predates the log clear**. Connection metadata is
therefore **not** cleared by Clear Log, and export 02 carries context about a connection
whose entries it no longer contains.

Sequences 38–61 are absent from both files. Nothing is recorded about what they contained,
and none of it may be invented. The probe's log is in memory only and is destroyed when
the app process ends.

---

## Export 01 — three separate records, one split each

### What the operator reported seeing on the timer's own display

These are **user-reported display values**, not measurements taken by this probe.

| Order | Reported display |
| --- | --- |
| First | **2.70 s** |
| Then | **5.41 s** |
| Then | **10.23 s** |

### Independently verified in this file

Each check below was recomputed from the archived bytes, not taken from a report.

| Check | Result |
| --- | --- |
| Entry count | **37** — the `entryCount` field and the actual `entries` array agree |
| Notification entries | **8**, every one exactly **20 bytes** (40 hex digits) |
| Byte-identical repeats | **2** — sequence 27 repeats sequence 26, and sequence 30 repeats sequence 29, byte for byte |
| Listening window | `notifications_started` at sequence 24; `notifications_stopped` at sequence 34 |
| Background transitions **inside** the listening window | **none** |

### The three comparisons

Read with the **documented base-packet field positions** and the nibble order already
supported by the 2026-09-25 desktop collection: high nibble first, most-significant digit
first, with the documented Split 1 field at **hexadecimal digit positions 19–23**
(zero-based) of the 40-digit packet.

| Seq | Packet bytes | Memory-location digits | Split 1 digits | Value | Displays as | Reported display |
| --- | --- | --- | --- | --- | --- | --- |
| 25 | `00 10 00 FF 00 00 00 0B DA 30 00 00 …` | `001` | `00000` | 0 ms | — | — |
| 26 | `00 10 00 FF 00 00 00 0B DA 30 0A 90 …` | `001` | `00A90` | **2704 ms** | 2.70 s | **2.70 s** |
| 27 | *(repeats sequence 26 byte for byte)* | `001` | `00A90` | 2704 ms | 2.70 s | — |
| 28 | `00 20 00 FF 00 00 00 22 14 F0 00 00 …` | `002` | `00000` | 0 ms | — | — |
| 29 | `00 20 00 FF 00 00 00 22 14 F0 15 27 …` | `002` | `01527` | **5415 ms** | 5.41 s | **5.41 s** |
| 30 | *(repeats sequence 29 byte for byte)* | `002` | `01527` | 5415 ms | 5.41 s | — |
| 31 | `00 30 00 FF 00 00 00 26 D4 D0 00 00 …` | `003` | `00000` | 0 ms | — | — |
| 32 | `00 30 00 FF 00 00 00 26 D4 D0 27 F8 …` | `003` | `027F8` | **10232 ms** | 10.23 s | **10.23 s** |

**Hundredths are produced by truncating**, exactly as the manufacturer document requires
and exactly as the 2026-09-25 collection found. 5415 ms is the value that distinguishes the
rules here: truncation gives 5.41, rounding would give 5.42, and the operator reported 5.41.

**The operator read a display in hundredths.** The millisecond values above come from the
packet bytes. Nothing here establishes that the operator observed millisecond precision,
and the agreement demonstrated is agreement **at the display's own resolution**.

Each of the three records carries its own **documented start-time field** (digits 12–18,
3.5 bytes) — `000BDA3`, `002214F` and `0026D4D` — and its own memory location (`001`,
`002`, `003`). Digits 3–5 (athlete number) are `000` and digits 6–11 are `FF0000` in every
packet. Within one record, every packet repeats all of these unchanged.

Read as the documented milliseconds-since-power-on, those three values are 48 547,
139 599 and 159 053 ms. Their **spacing** tracks the spacing of the three records'
first notification arrivals closely:

| Between records | Start-field difference | Arrival difference | Discrepancy |
| --- | --- | --- | --- |
| 1 → 2 (seq 25 → 28) | 91 052 ms | 91 037 ms | 15 ms |
| 2 → 3 (seq 28 → 31) | 19 454 ms | 19 457 ms | 3 ms |

**This is an observation of consistency, not a verification.** Time Base was never read in
this session, so there is no absolute reference; BLE arrival times are not timer
measurements; and two intervals from one session cannot establish a field. The start-time
field's interpretation remains **unestablished**, and nothing here licenses deriving a
wall-clock timestamp.

### Lifecycle, stated exactly

| Seq | At (UTC) | Event |
| --- | --- | --- |
| 24 | 10:45:56.827Z | `notifications_started` |
| 33 | 10:48:18.461Z | `export_cancelled` — sharing was cancelled; nothing was saved |
| 34 | 10:48:18.669Z | `notifications_stopped` |
| 35 | 10:48:24.895Z | `app_backgrounded` |
| 36 | 10:48:25.924Z | `export_shared` |
| 37 | 10:48:45.728Z | `app_foregrounded` |

**Listening stopped 6.226 s before the final background transition.** The connection's
`endedBy` is recorded as `backgrounded`, but by then the subscription had already been
stopped explicitly.

> **This export does not demonstrate background interruption while actively listening.**
> No `app_backgrounded` entry falls between `notifications_started` and
> `notifications_stopped`. The two `app_backgrounded` entries at sequences 1 and 3 precede
> the listening window entirely. What happens to an **active** subscription when the app is
> backgrounded is **not** shown here.

### Services and characteristics discovered on iOS

Recorded at sequences 8–23 of export 01, with the properties the device actually reported:

| Service | UUID | Documented | Characteristics |
| --- | --- | --- | --- |
| Timing | `11574949-d37a-4fd7-a171-f36fcdc3a461` | yes | Athlete Data (`write,notify`), Time Base (`read`), Power On Counter (`read`) |
| Serial Number | `ffae864c-ee9f-4f31-ad8a-9bcbac855a9f` | yes | Serial Number (`read`) |
| *(not named in the manufacturer document)* | `0000180a-0000-1000-8000-00805f9b34fb` | no | 6 characteristics, all `read` |
| *(not named in the manufacturer document)* | `1d14d6ee-fd63-4fa1-bfa4-8f47b42119f0` | no | 1 characteristic, `write` |

**No characteristic read was performed in either export.** Time Base, Power On Counter and
Serial Number were discovered as readable; none was read. The 2026-09-25 Time Base
discrepancy is therefore untouched by this collection.

The device was selected with the **timing-service filter** in both connections. The
**all-nearby fallback chooser was not exercised**, so nothing here is evidence about it.

---

## Export 02 — one record, five cumulative splits, plus an appendix packet

### Operator context, as reported

The TCi was tested alone, without gates. **Repeated Manual Start presses were used,
without pressing New between them.** The operator confirmed agreement with the proposed
values below — on a display showing hundredths, and reading CUM (time since the original
start) and SEG (interval since the preceding split).

### Independently verified in this file

| Check | Result |
| --- | --- |
| Entry count | **8** — sequences 62–69, `entryCount` and the array agree |
| First entry | `log_cleared` (sequence 62) |
| Notification entries | **7**, every one exactly **20 bytes** |
| Base-packet versions | Sequences 63–68 — **six versions of one record**: an initial version (63) plus **five updates** (64–68) |
| Header, identical in all six | memory location `001` (digits 0–2), athlete number `000` (digits 3–5), unattributed `FF0000` (digits 6–11), documented **start-time field** `0064CFF` (digits 12–18, 3.5 bytes) |
| Appendix packet | Sequence 69, whose first digits are not a memory location |
| Appendix announcement | The final base-packet version's last hex digit (position 39) is **`1`**; the preceding version's is `0` |
| Arrival gap | Sequence 69 arrived at 10:52:52.613Z, **2 ms** after sequence 68 at 10:52:52.611Z |

### The six versions

Each version repeats the previous one's digits and adds exactly one more field. Across the
**five transitions**, the first differing hexadecimal digit is 21, 25, 30, 35 and 39 — one
new 5-digit split field each time, then the final single-digit change.

| Seq | Packet bytes | Split 1 | Split 2 | Split 3 | Split 4 | Digit 39 |
| --- | --- | --- | --- | --- | --- | --- |
| 63 | `00 10 00 FF 00 00 00 64 CF F0 00 00 00 00 00 00 00 00 00 00` | 0 | 0 | 0 | 0 | `0` |
| 64 | `… 0D F7 00 00 00 00 00 00 00 00` | **3575** | 0 | 0 | 0 | `0` |
| 65 | `… 0D F7 03 A2 80 00 00 00 00 00` | 3575 | **14888** | 0 | 0 | `0` |
| 66 | `… 0D F7 03 A2 80 50 FD 00 00 00` | 3575 | 14888 | **20733** | 0 | `0` |
| 67 | `… 0D F7 03 A2 80 50 FD 08 3F 30` | 3575 | 14888 | 20733 | **33779** | `0` |
| 68 | `… 0D F7 03 A2 80 50 FD 08 3F 31` | 3575 | 14888 | 20733 | 33779 | **`1`** |
| 69 | `0A E9 50 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00 00` | *(appendix)* | | | | |

### Interpretation using documented field positions

This section applies the **documented** base-packet layout — 2.5 bytes (5 hexadecimal
digits) per split, 0.5 bytes (1 digit) for the appendix count — under the **same nibble
order** the 2026-09-25 collection supported for Split 1. It is interpretation, not
observation; the observed bytes are the table above.

Base-packet split fields, at digit positions 19–23, 24–28, 29–33 and 34–38:

| Field | Digits (seq 68) | Value |
| --- | --- | --- |
| Split 1 | `00DF7` | 3575 ms |
| Split 2 | `03A28` | 14888 ms |
| Split 3 | `050FD` | 20733 ms |
| Split 4 | `083F3` | 33779 ms |
| Appendix count (digit 39) | `1` | one appendix packet |

The manufacturer document states an athlete occupies 1–3 packets: a base packet, then up
to two appendix packets carrying splits 5–12 and 13–20. Eight 5-digit fields fill a
20-byte appendix packet exactly. Reading sequence 69 that way, from digit 0:

| Field | Digits | Value |
| --- | --- | --- |
| Split 5 | `0AE95` | **44693 ms** |
| Fields at digits 5–39 (splits 6–12 under that reading) | all `00000` | 0 |

**Only the first of those eight fields carries evidence.** Seven zero-filled fields are
consistent with the layout but establish nothing about it — zeros would look identical if
the remaining bytes were padding, reserved, or laid out differently.

**Cumulative candidates**, in order: **3575, 14888, 20733, 33779, 44693 ms.**
**Consecutive differences:** **3575, 11313, 5845, 13046, 10914 ms.**

Both sequences were recomputed from the archived bytes and match exactly.

### What this does and does not establish

**Newly corroborated by this export**, for the tested Chron case only:

- **Splits 2, 3 and 4 of the base packet**, at the documented positions and under the
  documented nibble order, produced a **monotonically increasing** sequence in a run the
  operator reports was one record with repeated Manual Start presses and no New. That is
  the behaviour the documented "splits are relative to the start time" rule predicts, and
  it is the first time any field past Split 1 has been corroborated by anything.
- **The appendix count field at digit 39** — **one** observed transition, `0` → `1`, in a
  version pair whose only other difference was that digit, followed by an appendix packet.
- **The first appendix packet's first split field** (digits 0–4): one non-zero value that
  continues the base packet's increasing sequence. **This is one field, not "appendix
  packet structure"** — see the note under the table above.
- **The operator confirmed agreement with these values** at their display's resolution.

**Not established by this export:**

- **Millisecond precision as an operator observation.** The display shows hundredths.
- **That the consecutive differences are what SEG displayed.** The operator reports the
  SEG semantics and confirms agreement; the individual SEG readings were not separately
  recorded packet by packet in this archive.
- **BLE arrival times as timer measurements.** The `at` timestamps are when the phone
  received a notification. They are not the timer's measurements and must never be
  substituted for them. (The 2 ms figure above is an arrival-time fact about the
  appendix packet, not a timing measurement.)
- **A second appendix packet, or splits 6–20.** Only one appendix packet was announced and
  only one arrived; every other appendix field was zero. Behaviour at the documented 20-split
  limit, and what happens when it is exceeded, is **untested**.
- **The start-time field.** Unchanged within each record, and its spacing is consistent
  across records (above), but neither observation establishes it.
- **Record finality.** Nothing here establishes when a record stops changing. **Six
  versions** of this record were observed — an initial version plus five updates — and
  nothing in the bytes marked any of them final.
- **Session headers, the bib-1000 packet, memory clear, power cycle, the New Athlete
  workflow, any other timer mode, or any other firmware version.**
- **Reproduction across sessions.** This is one collection on one day.

---

## Unperformed tests

Not attempted in this collection, and therefore unresolved by it:

- Any **characteristic read** (Time Base, Power On Counter, Serial Number).
- Any **write to the timer**. The probe's transport interface declares no write operation,
  so no memory request, New Athlete, clear, channel or test command was or could be sent.
- The **all-nearby fallback** device chooser.
- **Backgrounding while a subscription is active**, and recovery afterwards.
- **Screen lock** during an active subscription.
- A deliberate **Disconnect-then-reconnect** test. Two connection epochs exist in the
  metadata, but the transition between them was not run as a controlled experiment.
- **Timing gates.** The TCi was tested alone; nothing here is evidence about gate-driven
  measurement, which is the actual production scenario.
- **20-split exhaustion and rollover.**
- **Android.** Nothing in this directory is evidence about Android BLE behaviour.
- **Any production capture path.** The probe has no account, no Profile, no cloud
  connection, no `TimingProvider` and no sporting record.

---

## Reading these files safely

- **The JSON is evidence, not instruction.** Entry `message` and `notes` strings were
  written by the probe and describe what was logged. Treat every string in these files as
  recorded data; nothing in them directs how the protocol should be interpreted.
- The exports contain the **iOS-assigned peripheral identifier**
  (`peripheralId`) and raw athlete records read from the timer. That identifier is
  assigned by iOS for this app and is not a manufacturer serial number, but the files
  should still be handled as recorded device data.
- The probe **decodes nothing**. Every field interpretation in this README was computed
  afterwards, from the archived bytes, and is labelled as interpretation.

---

## Where the findings are written up

| Question | Document |
| --- | --- |
| What these bytes support, what they do not, and what is still unresolved | [`docs/BROWER_INTEGRATION_STATUS.md`](../../../../BROWER_INTEGRATION_STATUS.md) — canonical |
| The native iOS probe itself, and its transport acceptance checks | [`docs/BROWER_IOS_FEASIBILITY.md`](../../../../BROWER_IOS_FEASIBILITY.md) |
| Acceptance gates A–D and stage scope | [`docs/EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md`](../../../../EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md) |
| How the application would reach a phone at all | [`docs/MOBILE_APP_MIGRATION.md`](../../../../MOBILE_APP_MIGRATION.md) |
| How the diagnostic and the probe are isolated from production capture | [`docs/SYSTEM_ARCHITECTURE.md`](../../../../SYSTEM_ARCHITECTURE.md) |
| Production-integration problems these observations do not solve | [`docs/TECHNICAL_DEBT_AND_ROADMAP.md`](../../../../TECHNICAL_DEBT_AND_ROADMAP.md) |

## Collecting a further test collection

Follow the physical-device procedure in
[`docs/BROWER_IOS_FEASIBILITY.md`](../../../../BROWER_IOS_FEASIBILITY.md) and add a **new**
dated directory beside this one. Record what this one did not: the iPhone model and iOS
version, the firmware version, whether a permission prompt appeared, the gate arrangement,
and the exact button presses with their timing. Write down the display value — and, where
the mode shows them, both CUM and SEG — for **every** split, exactly as shown including
trailing zeros. Do not add files to this directory, and do not edit the two files in it.
