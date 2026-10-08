// The assisted Brower training pilot's lifecycle owner.
//
// It connects, subscribes, assembles packets into records, and hands validated records
// to `assistedCapture.ts`. It never decides that an interval is a shot, and it never
// sends the timer a command — the transport it is given has no write operation.
//
// Three ownership rules are carried over from the 2026-09-28 native probe, because
// breaking any of them corrupts measurements rather than merely annoying a user.
//
//  1. **A connection attempt owns a generation from its very first step.** The
//     generation is claimed BEFORE the device picker opens, not after connect resolves,
//     so backgrounding or releasing while the picker is still open invalidates the whole
//     attempt. Every asynchronous completion re-checks ownership after each await, on
//     the rejection path as well as the success path.
//  2. **An obsolete cleanup must never disconnect a replacement connection.** Teardown
//     re-reads the current attempt before issuing a destructive disconnect, and skips it
//     when a live attempt holds that same peripheral.
//  3. **Bytes are copied at receipt**, before any staleness check — the platform may
//     reuse the notification buffer once the callback returns.
import {
  BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
  BROWER_TIMING_SERVICE_UUID,
} from "./protocol";
import {
  assembleBrowerChronRecord,
  classifyBrowerPacketAwaitingAppendix,
  decodeBrowerChronAppendixPacket,
  decodeBrowerChronBasePacket,
  type BrowerChronBasePacket,
} from "./chronDecoder";
import {
  armBrowerAssistedCapture,
  browerCaptureContextsMatch,
  describeBrowerArmingBlocker,
  createBrowerAssistedCaptureState,
  discardAllBrowerCandidates,
  observeBrowerChronRecord,
  recordBrowerAssemblyRejection,
  retireBrowerCandidate,
  suspendBrowerAssistedCapture,
  type BrowerAssistedCaptureState,
  type BrowerCandidateOutcome,
  type BrowerCandidate,
  type BrowerCaptureContext,
} from "./assistedCapture";
import {
  copyBrowerPacketBytes,
  type BrowerAppLifecycleSource,
  type BrowerTimingTransport,
  type BrowerTransportAvailability,
} from "./timingTransport";

export type BrowerConnectionStatus =
  | "unsupported"
  | "disconnected"
  | "connecting"
  | "connected";

export type BrowerAssistedCaptureView = {
  availability: BrowerTransportAvailability;
  status: BrowerConnectionStatus;
  deviceName: string | null;
  /** Operator-facing explanation of the most recent failure or lifecycle event. */
  notice: string | null;
  capture: BrowerAssistedCaptureState;
  /** True while a connect or teardown is outstanding; every control is disabled. */
  busy: boolean;
  /**
   * True while the bounded ambiguity recovery of ADR-0050 decision 3 is waiting for a
   * complete, unambiguous snapshot of the same timer record.
   *
   * Read-only presentation state, derived from the recovery the controller is already
   * performing. `capture.phase` deliberately stays `armed` throughout — setup
   * confirmation is retained — so this is the only honest way for a surface to say
   * "armed, but nothing can be offered right now" without parsing the notice text.
   * It changes no behaviour and no transition.
   */
  awaitingUnambiguousRecord: boolean;
};

export type BrowerAssistedCaptureController = {
  getView(): BrowerAssistedCaptureView;
  subscribe(listener: (view: BrowerAssistedCaptureView) => void): () => void;
  /**
   * Subscribes the foreground/background listener and returns an idempotent detach.
   * Called by the owning effect, never by the factory — see the comment at the
   * subscription itself.
   */
  attachLifecycle(): () => void;
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  /** Whether a complete baseline exists and no assembly is outstanding. */
  canArm(): boolean;
  /** Why arming is unavailable, or null when it is available. */
  describeArmingBlocker(): string | null;
  /** Confirms setup and starts offering new splits for exactly this context. */
  arm(context: BrowerCaptureContext): void;
  /**
   * Whether this candidate may still be turned into a shot RIGHT NOW. Returns a
   * person-readable refusal, or null. Consulted inside the capture queue, because a
   * candidate can be revoked between the operator's tap and the queued execution.
   */
  verifyCandidateStillLive(candidate: BrowerCandidate): string | null;
  /** Suspends when the armed context is gone or no longer matches. */
  reconcileContext(context: BrowerCaptureContext | null): void;
  retireCandidate(candidateId: string, outcome: Exclude<BrowerCandidateOutcome, "dropped">): void;
  discardAllCandidates(): void;
  /**
   * Releases the connection and notification registration. Safe to call repeatedly and
   * deliberately NOT terminal: a Strict-Mode-replayed cleanup must leave a controller
   * the next effect setup can still use.
   */
  release(): Promise<void>;
};

export type BrowerAssistedCaptureDependencies = {
  availability: BrowerTransportAvailability;
  /** Null whenever `availability.supported` is false. */
  transport: BrowerTimingTransport | null;
  lifecycle: BrowerAppLifecycleSource;
  now?: () => string;
};

type Attempt = {
  generation: number;
  peripheralId: string;
  deviceName: string | null;
  /** True once notifications are actually registered for this attempt. */
  subscribed: boolean;
};

function describeError(error: unknown): string {
  if (error instanceof Error && error.message.length > 0) return error.message;
  if (typeof error === "string" && error.length > 0) return error;
  return "The Bluetooth operation failed.";
}

export function createBrowerAssistedCaptureController(
  dependencies: BrowerAssistedCaptureDependencies
): BrowerAssistedCaptureController {
  const { availability, transport, lifecycle } = dependencies;
  const now = dependencies.now ?? (() => new Date().toISOString());

  let activeGeneration = 0;
  let attempt: Attempt | null = null;
  let status: BrowerConnectionStatus = availability.supported ? "disconnected" : "unsupported";
  let notice: string | null = null;
  let busy = false;
  let connectsInFlight = 0;
  let capture: BrowerAssistedCaptureState = createBrowerAssistedCaptureState();

  /** Peripherals whose teardown is still outstanding; a new attempt waits for them. */
  const cleanupsInFlight = new Set<string>();
  let anonymousCleanupsInFlight = 0;

  /**
   * Which peripheral each connection generation has claimed, from the moment the picker
   * returns one — BEFORE the native connect is awaited.
   *
   * This is what lets a retired attempt tell "the peripheral I opened is now nobody's"
   * from "a replacement is using it". Without it, a slow `connect` that settles after a
   * replacement has already connected to the same peripheral would disconnect the
   * replacement: the operator would see "connected" while the radio link was gone.
   */
  const claimedPeripherals = new Map<number, string>();

  /** True when a generation that still owns the lifecycle holds this peripheral. */
  function peripheralHeldByLiveGeneration(peripheralId: string): boolean {
    if (claimedPeripherals.get(activeGeneration) === peripheralId) return true;
    return readAttempt()?.peripheralId === peripheralId;
  }

  // --- Packet assembly buffer ------------------------------------------------------
  // A record is a base packet plus exactly the appendix packets it declares. The
  // packets carry no header distinguishing the two, so arrival ORDER after a declared
  // count is the only association the evidence supports. That limit is real and is
  // documented in docs/BROWER_INTEGRATION_STATUS.md rather than hidden behind a guess.
  let pendingBase: BrowerChronBasePacket | null = null;
  let pendingAppendices: Uint8Array[] = [];
  // After a dual interpretation, discard the entire transfer and scan only for the
  // same base header. Otherwise a remaining headerless appendix could become a fake
  // base. Recovery must still pass normal assembly and observed-prefix checks.
  let recoveryBase: BrowerChronBasePacket | null = null;
  /**
   * The arming epoch current when the pending base packet arrived. Carried through to
   * `observeBrowerChronRecord` so an assembly begun during setup cannot be reclassified
   * as new merely because its appendix lands after the operator confirms.
   */
  let pendingAssemblyArmingEpoch = 0;

  const listeners = new Set<(view: BrowerAssistedCaptureView) => void>();

  function view(): BrowerAssistedCaptureView {
    return {
      availability,
      status,
      deviceName: attempt?.deviceName ?? null,
      notice,
      capture,
      busy,
      awaitingUnambiguousRecord: recoveryBase !== null,
    };
  }

  function emit(): void {
    const snapshot = view();
    for (const listener of [...listeners]) {
      listener(snapshot);
    }
  }

  function ownsLifecycle(generation: number): boolean {
    return generation === activeGeneration;
  }

  /**
   * Reads the current attempt through a call, never through the narrowed local.
   * TypeScript's narrowing does not know that an `await` can let another caller
   * reassign `attempt`, and teardown depends on seeing a replacement if one exists.
   */
  function readAttempt(): Attempt | null {
    return attempt;
  }

  /** Moves ownership past every outstanding attempt. Returns the generation retired. */
  function invalidateGeneration(): number {
    const retired = activeGeneration;
    // The retired generation keeps no claim: from here on it may only release a
    // peripheral that nothing live holds.
    claimedPeripherals.delete(retired);
    activeGeneration += 1;
    return retired;
  }

  /**
   * Releases a peripheral an obsolete attempt opened — but only when no live generation
   * holds it. A disconnect is destructive and irreversible, so this never fires on the
   * strength of "I opened it once".
   */
  async function releaseObsoletePeripheral(peripheralId: string): Promise<void> {
    if (transport === null) return;
    if (peripheralHeldByLiveGeneration(peripheralId)) return;
    try {
      await transport.stopNotifications(
        peripheralId,
        BROWER_TIMING_SERVICE_UUID,
        BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID
      );
    } catch {
      // No registration to remove, or the peripheral is already gone.
    }
    if (peripheralHeldByLiveGeneration(peripheralId)) return;
    try {
      await transport.disconnect(peripheralId);
    } catch {
      // Already disconnected.
    }
  }

  function resetAssembly(): void {
    pendingBase = null;
    pendingAppendices = [];
    pendingAssemblyArmingEpoch = capture.armingEpoch;
  }

  /** True while a base packet has declared appendices that have not all arrived. */
  function assemblyOutstanding(): boolean {
    return recoveryBase !== null ||
      (pendingBase !== null && pendingAppendices.length < pendingBase.appendixCount);
  }

  /**
   * The highest cumulative split the pending record holds so far — the value a genuine
   * next appendix has to exceed. Reads only USED fields, so trailing unused slots
   * cannot lower it.
   */
  function lastPendingCumulativeMs(): number {
    let highest = 0;
    const fields = [
      ...(pendingBase?.splitFields ?? []),
      ...pendingAppendices.flatMap((packet) => {
        const decoded = decodeBrowerChronAppendixPacket(packet);
        return decoded.kind === "appendix" ? decoded.splitFields : [];
      }),
    ];
    for (const field of fields) {
      if (field > highest) highest = field;
    }
    return highest;
  }

  function suspendCapture(reason: string): void {
    capture = suspendBrowerAssistedCapture(capture, reason);
  }

  // --- Notification handling -------------------------------------------------------

  function handleAssembledBase(base: BrowerChronBasePacket, generation: number): void {
    const assembly = assembleBrowerChronRecord(base, pendingAppendices);

    switch (assembly.status) {
      case "record":
        if (recoveryBase !== null) notice = null;
        recoveryBase = null;
        capture = observeBrowerChronRecord(capture, {
          record: assembly.record,
          receivedAt: now(),
          assemblyStartedAtArmingEpoch: pendingAssemblyArmingEpoch,
        });
        resetAssembly();
        break;

      case "empty":
        if (recoveryBase !== null) notice = null;
        recoveryBase = null;
        // A structurally valid record carrying no measured split. Observed on real
        // hardware; not an error and not a measurement — but it IS a complete
        // observation, and it registers the record's identity, so a baseline taken
        // afterwards knows which record the timer is on.
        capture = observeBrowerChronRecord(capture, {
          record: assembly.record,
          receivedAt: now(),
          assemblyStartedAtArmingEpoch: pendingAssemblyArmingEpoch,
        });
        resetAssembly();
        break;

      case "incomplete":
        // Still waiting for a declared appendix. Nothing is decoded, nothing offered.
        break;

      case "invalid":
        capture = recordBrowerAssemblyRejection(capture, assembly.reason);
        suspendCapture(
          `A packet could not be read as a valid record, so measurements were paused: ${assembly.reason} Confirm the setup again to resume.`
        );
        resetAssembly();
        break;
    }

    if (ownsLifecycle(generation)) emit();
  }

  function handleNotification(value: DataView, generation: number): void {
    // Rule 3: copy first, decide afterwards.
    const bytes = copyBrowerPacketBytes(value);
    if (!ownsLifecycle(generation)) return;

    if (recoveryBase !== null && pendingBase === null) {
      const next = decodeBrowerChronBasePacket(bytes);
      if (next.kind !== "base" ||
          next.memoryLocationDigits !== recoveryBase.memoryLocationDigits ||
          next.athleteNumberDigits !== recoveryBase.athleteNumberDigits ||
          next.startTimeDigits !== recoveryBase.startTimeDigits ||
          next.unattributedDigits !== recoveryBase.unattributedDigits) {
        // Do not reinterpret orphan appendices or silently cross a New/reset boundary.
        return;
      }
    }

    if (pendingBase !== null && pendingAppendices.length < pendingBase.appendixCount) {
      // Arrival order says this SHOULD be the next appendix, but the packets carry no
      // header saying so, and the device was observed sending several versions of one
      // base packet. Classify explicitly rather than assuming.
      const classification = classifyBrowerPacketAwaitingAppendix(
        bytes,
        lastPendingCumulativeMs()
      );

      if (classification.role === "ambiguous") {
        // Take neither reading. Keep the arming window, but revoke pending candidates
        // until an unambiguous complete snapshot of this same record arrives. Its
        // cumulative prefix must still match everything already observed.
        capture = recordBrowerAssemblyRejection(capture, classification.reason);
        capture = { ...capture, candidates: [] };
        recoveryBase = pendingBase;
        notice = "Waiting for an unambiguous update from the same timer record. No time from the unclear transfer was recorded. Recording resumes automatically when a complete clear update arrives. If this persists or you press New, disconnect and reconnect, then confirm setup.";
        resetAssembly();
        if (ownsLifecycle(generation)) emit();
        return;
      }

      if (classification.role === "appendix") {
        pendingAppendices = [...pendingAppendices, bytes];
        handleAssembledBase(pendingBase, generation);
        return;
      }

      // Read as a new base packet: the outstanding record is abandoned whole, and no
      // part of it is reported as a time. Abandoning an armed assembly is itself a loss
      // of continuity — the same bytes are not silently reinterpreted while still armed.
      capture = recordBrowerAssemblyRejection(
        capture,
        `A record declaring ${pendingBase.appendixCount} appendix packet(s) was superseded before they all arrived.`
      );
      suspendCapture(
        "A record was interrupted before all of its parts arrived, so measurements were paused. Confirm the setup again to resume."
      );
      resetAssembly();
    }

    const decoded = decodeBrowerChronBasePacket(bytes);
    if (decoded.kind === "invalid") {
      capture = recordBrowerAssemblyRejection(capture, decoded.reason);
      suspendCapture(
        `A packet could not be read, so measurements were paused: ${decoded.reason} Confirm the setup again to resume.`
      );
      resetAssembly();
      if (ownsLifecycle(generation)) emit();
      return;
    }

    pendingBase = decoded;
    pendingAppendices = [];
    handleAssembledBase(decoded, generation);
  }

  // --- Teardown --------------------------------------------------------------------

  async function teardown(reason: string | null, requestDisconnect: boolean): Promise<void> {
    const current = attempt;
    // Invalidate first, synchronously: everything in flight is stale from this moment,
    // whatever the native calls below go on to do.
    invalidateGeneration();
    attempt = null;
    recoveryBase = null;
    resetAssembly();

    suspendCapture(reason ?? "Measurements stopped. Reconnect and confirm setup again.");
    if (reason !== null) notice = reason;

    status = availability.supported ? "disconnected" : "unsupported";

    // Claim the cleanup BEFORE the first await: the protected window starts here, not
    // when the disconnect is finally issued.
    const peripheralId = current?.peripheralId ?? null;
    if (peripheralId === null) {
      anonymousCleanupsInFlight += 1;
    } else {
      cleanupsInFlight.add(peripheralId);
    }

    busy = true;
    emit();

    try {
      if (transport !== null && current !== null && current.subscribed) {
        try {
          await transport.stopNotifications(
            current.peripheralId,
            BROWER_TIMING_SERVICE_UUID,
            BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID
          );
        } catch {
          // A peripheral that is already gone rejects this; that is not new information.
        }
      }

      if (transport !== null && current !== null && requestDisconnect) {
        // Rule 2. `connect()` refuses to start while this cleanup is outstanding, so a
        // replacement holding this peripheral should be impossible here — but a
        // disconnect is destructive and irreversible, so it re-checks rather than
        // trusting that.
        const replacement = readAttempt();
        const wouldKillReplacement =
          replacement !== null && replacement.peripheralId === current.peripheralId;

        if (!wouldKillReplacement) {
          try {
            await transport.disconnect(current.peripheralId);
          } catch {
            // Already disconnected. Nothing to report.
          }
        }
      }
    } finally {
      if (peripheralId === null) {
        anonymousCleanupsInFlight = Math.max(0, anonymousCleanupsInFlight - 1);
      } else {
        cleanupsInFlight.delete(peripheralId);
      }
      busy = connectsInFlight > 0;
      // Emit unconditionally: this transition re-enables the controls, and a cleanup
      // that failed must still hand control back rather than strand the UI.
      emit();
    }
  }

  function handleUnexpectedDisconnect(generation: number): void {
    if (!ownsLifecycle(generation)) return;
    void teardown(
      "The timer disconnected. Reconnect, confirm the setup again, and re-arm before the next attempt.",
      false
    );
  }

  // --- Connect ---------------------------------------------------------------------

  async function connect(): Promise<void> {
    if (!availability.supported || transport === null) return;
    if (busy || connectsInFlight > 0 || attempt !== null) return;
    if (cleanupsInFlight.size > 0 || anonymousCleanupsInFlight > 0) return;

    // Rule 1: claim the generation before anything asynchronous happens.
    const generation = invalidateGeneration() + 1;
    activeGeneration = generation;

    busy = true;
    status = "connecting";
    notice = null;
    // A new connection starts from nothing known. Reconnecting never inherits a
    // baseline or an armed state; both must be re-established explicitly.
    capture = createBrowerAssistedCaptureState();
    recoveryBase = null;
    resetAssembly();
    emit();

    connectsInFlight += 1;
    let peripheralId: string | null = null;

    try {
      await transport.initialize();
      if (!ownsLifecycle(generation)) return;

      if (!(await transport.isEnabled())) {
        if (!ownsLifecycle(generation)) return;
        notice = "Bluetooth is switched off. Turn it on and connect again.";
        status = "disconnected";
        return;
      }
      if (!ownsLifecycle(generation)) return;

      const device = await transport.requestDevice({
        services: [BROWER_TIMING_SERVICE_UUID],
        optionalServices: [BROWER_TIMING_SERVICE_UUID],
      });
      if (!ownsLifecycle(generation)) {
        // Retired while the picker was open. Nothing was opened, so nothing to release.
        return;
      }

      // Claim BEFORE awaiting the native connect: from here on, a cleanup can tell that
      // this generation is the one holding this peripheral.
      peripheralId = device.deviceId;
      claimedPeripherals.set(generation, device.deviceId);

      await transport.connect(device.deviceId, () => handleUnexpectedDisconnect(generation));

      if (!ownsLifecycle(generation)) {
        // Retired while connecting. The native connect may nonetheless have succeeded,
        // so release it — unless a replacement is now using this same peripheral, in
        // which case disconnecting would tear down a live connection and leave the UI
        // reporting a link that no longer exists.
        await releaseObsoletePeripheral(device.deviceId);
        return;
      }

      // Own the notification registration BEFORE awaiting it. The Capacitor BLE client
      // registers its JS listener before the native call resolves, and only
      // stopNotifications removes it — losing the GATT link does not. Recording
      // ownership after the await would leave a listener nothing believes it owns.
      attempt = {
        generation,
        peripheralId: device.deviceId,
        deviceName: device.name,
        subscribed: true,
      };

      await transport.startNotifications(
        device.deviceId,
        BROWER_TIMING_SERVICE_UUID,
        BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
        (value) => handleNotification(value, generation)
      );

      if (!ownsLifecycle(generation)) {
        await releaseObsoletePeripheral(device.deviceId);
        return;
      }

      status = "connected";
      notice =
        "Connected. Complete your setup, then confirm it below to start receiving measurements.";
    } catch (error) {
      const stillOwns = ownsLifecycle(generation);
      if (stillOwns) {
        notice = describeError(error);
        status = "disconnected";
        attempt = null;
      }
      if (peripheralId !== null) {
        // A failed or retired start still has to release whatever it opened, including
        // a notification registration the client may already have made.
        if (stillOwns) claimedPeripherals.delete(generation);
        await releaseObsoletePeripheral(peripheralId);
      }
    } finally {
      connectsInFlight -= 1;
      busy = connectsInFlight > 0 || cleanupsInFlight.size > 0 || anonymousCleanupsInFlight > 0;
      emit();
    }
  }

  // --- Lifecycle subscription ------------------------------------------------------
  //
  // Deliberately NOT subscribed in the factory. A controller created during render may
  // be thrown away without ever being used (React may call a `useState` initializer and
  // discard its result), and a factory-time subscription would outlive it as a leak.
  // The owner attaches explicitly and detaches in its effect cleanup.

  function attachLifecycle(): () => void {
    const unsubscribe = lifecycle.onActiveStateChange((isActive) => {
      if (isActive) return;
      if (attempt === null && status !== "connecting") return;
      void teardown(
        "Measurements stopped when the app left the screen. This pilot does not capture in the background. Reconnect, confirm the setup again, and re-arm.",
        true
      );
    });

    let detached = false;
    return () => {
      if (detached) return;
      detached = true;
      unsubscribe();
    };
  }

  return {
    getView: view,

    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },

    connect,

    async disconnect() {
      if (attempt === null && status !== "connecting") return;
      await teardown("Disconnected. Reconnect and confirm the setup again to resume.", true);
    },

    attachLifecycle,

    canArm() {
      if (status !== "connected") return false;
      return describeBrowerArmingBlocker(capture, {
        assemblyOutstanding: assemblyOutstanding(),
      }) === null;
    },

    describeArmingBlocker() {
      if (status !== "connected") return "Connect the timer first.";
      return describeBrowerArmingBlocker(capture, {
        assemblyOutstanding: assemblyOutstanding(),
      });
    },

    arm(context) {
      if (status !== "connected") return;
      capture = armBrowerAssistedCapture(capture, context, {
        assemblyOutstanding: assemblyOutstanding(),
      });
      if (capture.phase === "armed") {
        notice = null;
        // A new arming window owns any assembly started from here on.
        pendingAssemblyArmingEpoch = capture.armingEpoch;
      }
      emit();
    },

    verifyCandidateStillLive(candidate) {
      // Checked at ACCEPTANCE time, inside the capture queue. Every revocation route —
      // discard, invalidation, pause, re-arm, disconnect, backgrounding, detach —
      // removes the candidate or leaves this controller not armed, so one check covers
      // all of them rather than enumerating them.
      if (status !== "connected") {
        return "This time was not recorded: the timer is no longer connected.";
      }
      if (capture.phase !== "armed") {
        return "This time was not recorded: measurements were paused before it could be saved.";
      }
      if (!capture.candidates.some((current) => current === candidate)) {
        return "This time was not recorded: it was no longer available.";
      }
      return null;
    },

    reconcileContext(context) {
      if (capture.phase !== "armed") return;
      if (browerCaptureContextsMatch(capture.context, context)) return;
      suspendCapture(
        "The training context changed, so pending measurements were cleared. Confirm the setup again for the current capture."
      );
      emit();
    },

    retireCandidate(candidateId, outcome) {
      capture = retireBrowerCandidate(capture, candidateId, outcome);
      emit();
    },

    discardAllCandidates() {
      capture = discardAllBrowerCandidates(capture);
      emit();
    },

    async release() {
      // Releases the RESOURCES, and is deliberately NOT terminal.
      //
      // React's Strict Mode replays an effect's cleanup and then runs setup again on the
      // same component instance. A terminal flag here would kill the controller that the
      // replayed setup goes on to reuse, leaving Connect permanently dead. So this
      // disconnects, stops notifications and clears the armed state — and leaves the
      // controller able to connect again.
      //
      // View subscribers are not cleared: each subscriber removes its own listener in
      // its own cleanup, and clearing them here would silently unsubscribe a panel that
      // is about to be re-subscribed.
      await teardown(null, readAttempt() !== null);
    },
  };
}
