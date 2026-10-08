# ADR-0050: Brower capture records filtered candidates through the existing Timing Result boundary

## Status

Accepted and implemented for the approved pilot scope. **Not hardware-accepted.** The
decoder, the candidate model and the lifecycle rules below are implemented and covered by
automated tests; live two-gate behaviour against a physical TCi Timer is unverified until
the device checklist in
[Brower Integration Status](../BROWER_INTEGRATION_STATUS.md#physical-device-checklist-for-the-assisted-capture-pilot)
passes. The user reports a successful two-gate training session on 2026-10-01; that is a
practical use report, not a checklist pass. This does not pass Gate C, complete Stage M4,
or enable native storage.

## Context

The athlete wants to train with two light gates without transcribing times by hand. The
approved pilot scope (see
[the pilot decision](../BROWER_INTEGRATION_STATUS.md#assisted-training-pilot-decision-2026-09-30))
permits a narrow candidate decoder ahead of full Gate C, in the installed iOS
application rather than a separate test app.

Three facts from the archived evidence shape every decision below.

1. **The device resends.** Byte-identical packets were observed arriving twice on both
   transports, and one record was observed in six versions as splits were added. Nothing
   in the bytes marks a record final.
2. **Nothing in the packets says which interval is a shot.** In CHRON, the intervals
   between splits include real attempts, rests between them and accidental triggers. No
   evidence supports start/finish pairing, alternating-split parity or a ten-second
   cutoff.
3. **Receipt time is not measurement time.** Delayed previously-unseen data is
   indistinguishable from fresh data by arrival alone.

## Decision

1. **Filtered Back–Hog recording is automatic after setup confirmation.** The user
   approved removing per-shot taps after verifying the Draw/Takeout filter on-device
   (2026-09-30). Drain candidates in split order through the existing TimingResult
   boundary, awaiting each local save before the next. A failed/unconfirmed save stops
   intake and requires same-shot retry followed by re-arming. Setup, lifecycle,
   ownership, duplicate and completion checks remain mandatory. In-range false triggers
   can be recorded; correction uses existing Undo/deletion. Hog–Hog and unclassified
   sequences keep manual selection because no filter has been approved for them.
   There is no gate-direction inference, alternating-split pairing, automatic New,
   memory request or rollover policy.
2. **Setup arming, with a baseline.** Connecting starts an observation phase that records
   what the timer reports without offering anything. Arming requires a complete observed
   record and no outstanding appendix; pre-arm assemblies cannot later offer measurements.
   The operator then confirms setup,
   which snapshots everything observed so far as permanently ineligible. Only splits that
   appear after that snapshot become candidates. Arming reduces unwanted intake; it is
   explicitly **not** a hardware-side acquisition boundary and not proof of freshness.
3. **One narrow decoder, which refuses rather than guesses.** `chronDecoder.ts` reads only
   the documented base-packet fields, the appendix count and both appendix packets, and
   validates lengths, counts, contiguity and strictly increasing cumulative progression.
   An incomplete or incoherent assembly yields **no** selectable measurement and is never
   partially accepted. Because appendix packets carry no header, a packet arriving while
   an appendix is outstanding is accepted as that appendix only if it structurally
   continues the record and is not also interpretable as a selectable base packet.
   A dual interpretation rejects the whole transfer and clears pending candidates, but
   retains setup confirmation. The controller waits for the same base header and a
   complete, unambiguous snapshot with an unchanged observed cumulative prefix. Only
   that fresh assembly may offer previously unaccepted splits. Orphan appendices and
   other record headers are ignored while waiting; no values from the rejected transfer
   enter the observed baseline. Pause/background/context invalidation still wins. If
   ambiguity persists or New is pressed during recovery, reconnect and re-arm; this
   bounded recovery cannot guarantee delivery or distinguish packet types. See the
   2026-09-30 manual-test findings in the canonical integration status.
   This is not proof of packet type:
   legitimate appendices can also resemble an empty base, so structural association remains
   a documented protocol limitation requiring live evidence.
   For Fixed Weight Back–Hog sequences, the existing Shot Type selects an inclusive
   window: Draw 3000–5000 ms, Takeout 2000–4000 ms (user decision 2026-09-30). Evaluate
   original millisecond SEG values, retaining every cumulative split for subtraction
   and continuity. Excluded intervals are counted once, not turned into shots. No range
   is inferred for Hog–Hog or an absent Shot Type. Shot Type is part of context matching
   and execution-time ownership; acceptance rechecks the range as well.
4. **SEG is computed in integer milliseconds and kept at full precision.** The first
   interval is `split[1]`; every later one is the difference between adjacent cumulative
   splits. Subtraction always happens on millisecond values. Truncation to hundredths is a
   display concern only — used to let the operator compare against the TCi's own screen —
   and never applied before subtraction. The accepted `TimingResult` carries the exact
   value; the application's global precision is unchanged.
5. **Candidate identity is stable and position-bearing.** A candidate's id is derived from
   the capture sequence, the record identity and the split **position** — never from
   arrival order, a counter or a random value. A byte-for-byte resend regenerates exactly
   the same id, so `processedResultIds` rejects it as a duplicate; two equal times at
   different split positions get different ids and stay distinct measurements. Because an
   undone shot's result id stays spent forever (ADR-0006 decision 6), the same stability
   also prevents re-acceptance after Undo.
6. **Acceptance is bound to the training context and re-verified when the queued work runs.**
   Profile, session, block, capture sequence, measurement mode and Shot Type are bound at arming and
   carried on every candidate. `verifyBrowerCaptureOwnership` is a pure function
   re-evaluated inside the shared capture queue, because between scheduling and execution
   a block can complete, a sequence can be paused/cancelled, an account can be switched or an
   Assessment run can start. It deliberately does not judge the sequence's own status —
   `processTimingResult` already reports that precisely, and one rule needs one owner.
   The controller separately requires the exact currently offered candidate object; an
   equal result id after reconnect does not revive an obsolete queued acceptance.
7. **Lifecycle events suspend and invalidate.** Disconnect, backgrounding, screen lock,
   capture-context change and confirmed loss of record continuity all clear pending candidates and
   require an explicit re-arm. Pause, leaving Training and a new record also invalidate
   candidates. Reselection is refused while a retired native attempt/cleanup is pending;
   lifecycle attach/release is reusable under React StrictMode. Reconnecting starts from nothing known: no baseline and no
   armed state is inherited. Continuity loss includes a record that shrinks or that reports
   a different value at a split position already observed — record finality is unresolved,
   so a superseded split pauses rather than silently choosing a value.
8. **The BLE transport is platform-isolated and has no write operation.** `BrowerTimingTransport`
   is a production boundary written fresh; the probe at `tools/brower-ios-probe/` is not
   promoted. The absence of any write method is load-bearing: it makes sending the timer a
   command a change that cannot be made without widening the interface. An Android
   implementation would satisfy the same contract; the decoder, state machine and
   controller are platform-neutral.
9. **No background capture.** `UIBackgroundModes` is deliberately not declared, so open
   decision P3 is untouched. `NSBluetoothAlwaysUsageDescription` is added because the app
   now genuinely uses it as a central.
10. **Nothing replaces manual entry.** Classic Shot Entry and the capture sequence's own
    manual fallback are untouched and remain available at all times (Decision 002).

## Consequences

- A real device now reaches `processTimingResult` / `applyTimingResultToSession` through
  the same boundary the Simulator and manual fallback use. No Capture Sequence code
  needed a parallel path, and target, handle, shot numbering, deduplication, Undo and
  the persisted domain shape remain unchanged. Current-session saves, retries and archival
  writes are now serialised. The panel distinguishes applied, saving, locally saved and
  failed/unconfirmed outcomes; retry saves the same still-current shot and adds no shot.
  Local acknowledgement is neither cloud confirmation nor a stronger durability promise.
- **Presentation (2026-10-01): compact by default, honest about blockers.** The normal
  automatic state is one block — status, filter summary, latest acknowledgement — with
  technical provenance (record identifiers, baseline/excluded/rejected counts, the exact
  suspension reason, the full recovery explanation, candidate cumulative provenance) in
  one initially collapsed `Details` disclosure. Everything requiring action stays outside
  it: setup confirmation and its blocker, saving/unconfirmed/failed saving with retry, the
  waiting-for-a-clear-update state, the 20-split exhaustion warning, dropped measurements,
  and every candidate control in unfiltered contexts. Because decision 3's recovery keeps
  `capture.phase` at `armed`, the view exposes a read-only `awaitingUnambiguousRecord`
  derived from that same recovery state, so the surface never labels a merely connected or
  merely armed panel "Recording" and never parses notice strings. A past "saved on this
  device" notice is de-emphasised while a current blocker exists, without losing the
  result or concealing a failure. The disclosure holds no state and touches no
  subscription, so toggling it cannot reconnect, re-arm, revoke candidates or interrupt a
  save. No behaviour, threshold, protocol or persistence rule changed.
- The pilot is scoped to non-Blind Training Capture Sequences. Blind Weight has no Capture
  Sequence at all (`createCaptureSequence` refuses one), so that exclusion is an existing
  invariant rather than a new rule. Assessment and Team capture stay deferred.
- Honest limits are surfaced rather than hidden: a full 20-split record announces its
  exhaustion and requires a new record plus a re-arm (accept wanted candidates before New),
  packets that cannot be read are
  counted and explained, and candidates dropped to keep the offered list bounded are
  reported rather than silently lost.
- The association between a base packet and its appendices rests on arrival order plus
  the structural continuation check in Decision 3. That is the strongest association the
  evidence supports; it is not a proof of packet type, and it is why a failed check
  abandons a record instead of decoding it another way.
- Automated tests use a fake transport. They prove this application's logic and lifecycle
  and prove nothing about real TCi firmware.

## Alternatives considered

- **Inferring gate direction** (pair splits or assume alternating triggers). Rejected:
  no evidence supports these rules, and a
  wrong one would silently produce plausible, incorrect measurements — the exact failure
  the Brower status document exists to prevent.
- **Deduplicating by arrival order or a generated id.** Rejected: the device demonstrably
  resends, so a repeat would have become a second shot.
- **Promoting the iOS probe.** Rejected by Stage M4's own scope boundary; the probe stays
  a separate instrument, and only its protocol constants and ownership lessons are reused.
- **Treating the three-packet fixture as three athletes.** Rejected: the documented layout
  and the reproduced cumulative progression both make it one record.
