// The probe's state machine.
//
// Everything that decides what happens lives here; the transport, the export target
// and the app-lifecycle source are injected, so the logic below is exactly the logic
// that runs on a physical iPhone.
//
// Four ownership rules shape most of this file. Each exists because breaking it
// corrupts the evidence rather than merely annoying a user.
//
//   1. **A connection attempt owns a generation from its very first step.** The
//      generation is claimed BEFORE the device picker opens — not after the native
//      connect resolves — so backgrounding or releasing while the picker or the
//      connect call is still pending invalidates the whole attempt. Every
//      asynchronous completion re-checks ownership after each await, on the rejection
//      path as well as the success path.
//   2. **A subscription owns its own token, separately from the connection.** Stop
//      and Start on one connection produce different tokens, so a callback from the
//      stopped subscription cannot be counted as an observation of the running one.
//   3. **A native notification listener is owned from the moment it is requested.**
//      The Capacitor BLE client registers its JS listener BEFORE awaiting the native
//      `startNotifications`, and only `stopNotifications` removes it — losing the GATT
//      connection does not, and neither does clearing a Set in this file. Ownership is
//      therefore recorded before the await and released only by an actual
//      `stopNotifications` call that succeeded.
//   4. **Bytes are copied at receipt**, before any staleness check. See
//      `copyBytesFromDataView`.
import {
  BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
  BROWER_PROBE_READABLE_CHARACTERISTICS,
  BROWER_PROBE_SERVICES,
  BROWER_SERIAL_NUMBER_SERVICE_UUID,
  BROWER_TIMING_SERVICE_UUID,
  browerCharacteristicLabel,
  browerServiceLabel,
  copyBytesFromDataView,
  formatHexBytes,
} from "./browerProtocol";
import { describeFailure, failureFromError } from "./errors";
import type { ProbeFailure } from "./errors";
import {
  appendProbeLogEntry,
  buildProbeExportFileName,
  buildProbeLogPayload,
  createEmptyProbeLog,
  serializeProbeLog,
} from "./probeLog";
import type { ProbeConnectionEpoch, ProbeLog, ProbeLogInput } from "./probeLog";
import type { ProbeExportOutcome, ProbeExportTarget } from "./exportTarget";
import type {
  NativeBleTransport,
  NativeCharacteristicProperties,
  NativeService,
  ProbePlatform,
} from "./transport";
import type { AppLifecycleSource } from "./appLifecycle";

/** Bounded display lists. The log has its own, larger bound. */
export const PROBE_MAX_DISPLAYED_NOTIFICATIONS = 50;
export const PROBE_MAX_DISPLAYED_READS = 50;

export type ProbeBluetoothState =
  | "not_initialized"
  | "initializing"
  | "ready"
  | "unavailable"
  | "permission_denied"
  | "failed";

export type ProbeConnectionStatus =
  | "idle"
  | "selecting"
  | "connecting"
  | "connected"
  | "disconnecting"
  | "disconnected"
  | "failed";

export type ProbeSelectionMode = "timing-service-filter" | "all-nearby";

/**
 * How a documented service's discovery actually ended.
 *
 * `absent` and `failed` are never conflated. `absent` is a positive finding — the
 * enumeration succeeded and this service was not in it. `failed` means the enumeration
 * itself errored and the device's actual composition is unknown.
 */
export type ProbeDiscoveryState = "not_attempted" | "found" | "absent" | "failed";

/**
 * Whether the device actually advertised a way to push Athlete Data at us.
 *
 * `unknown` is a real third state: discovery may not have run, or may have failed. It
 * must never be shown as `unsupported`, which is a claim about the hardware.
 */
export type ProbeNotifyCapability = "unknown" | "supported" | "unsupported";

export type ObservedCharacteristic = {
  uuid: string;
  /** The documented name, or null for a characteristic the document does not name. */
  label: string | null;
  properties: NativeCharacteristicProperties;
};

export type ObservedService = {
  uuid: string;
  label: string | null;
  /** False for a service the probe did not expect but the device reported anyway. */
  documented: boolean;
  required: boolean;
  discovery: ProbeDiscoveryState;
  characteristics: ObservedCharacteristic[];
};

export type RawObservation = {
  id: string;
  sequence: number;
  connectionEpoch: number;
  uuid: string;
  label: string | null;
  hex: string;
  byteLength: number;
  at: string;
};

export type ProbeExportState = {
  at: string;
  outcome: ProbeExportOutcome["kind"];
  fileName: string | null;
  reason: string | null;
};

/**
 * Whether one control may be used right now, and why not when it may not.
 *
 * The controller computes these and the view renders them. Both therefore answer the
 * question from one place: a control can never be shown as usable while the controller
 * would refuse it, nor shown as blocked for a reason the controller does not apply.
 */
export type ProbeControlAvailability = {
  available: boolean;
  unavailableReason: string | null;
};

export type ProbeSnapshot = {
  platform: ProbePlatform;
  bluetooth: ProbeBluetoothState;
  status: ProbeConnectionStatus;
  statusMessage: string | null;
  failure: ProbeFailure | null;
  device: { peripheralId: string; name: string | null } | null;
  selectionMode: ProbeSelectionMode | null;
  connectionEpoch: number;
  services: ObservedService[];
  /** True when any discovery query failed rather than returning a definite answer. */
  discoveryIncomplete: boolean;
  athleteDataDiscovery: ProbeDiscoveryState;
  athleteDataNotifyCapability: ProbeNotifyCapability;
  readableCharacteristics: {
    uuid: string;
    serviceUuid: string;
    label: string;
    available: boolean;
    unavailableReason: string | null;
  }[];
  controls: {
    connect: ProbeControlAvailability;
    disconnect: ProbeControlAvailability;
    startListening: ProbeControlAvailability;
    stopListening: ProbeControlAvailability;
  };
  reads: RawObservation[];
  notifications: RawObservation[];
  notificationCount: number;
  notificationsActive: boolean;
  /**
   * Native notification listeners this controller asked for and has not confirmed
   * released. Not a cosmetic counter: it is the difference between "we stopped showing
   * notifications" and "the native side stopped sending them".
   */
  ownedNativeListenerCount: number;
  busy: boolean;
  appActive: boolean;
  released: boolean;
  /** True when observations exist that no successful share has yet carried off-device. */
  hasUnexportedObservations: boolean;
  lastExport: ProbeExportState | null;
  connections: ProbeConnectionEpoch[];
  log: ProbeLog;
};

export type ProbeActionResult = { accepted: true } | { accepted: false; reason: string };

export type ProbeClearResult =
  | { cleared: true }
  | { cleared: false; requiresConfirmation: true; reason: string };

export interface ProbeController {
  getSnapshot(): ProbeSnapshot;
  /** Registers a listener. Does NOT emit synchronously — read `getSnapshot()` first. */
  subscribe(listener: (snapshot: ProbeSnapshot) => void): () => void;
  initializeBluetooth(): Promise<ProbeActionResult>;
  connect(mode: ProbeSelectionMode): Promise<ProbeActionResult>;
  disconnect(): Promise<ProbeActionResult>;
  readCharacteristic(characteristicUuid: string): Promise<ProbeActionResult>;
  startListening(): Promise<ProbeActionResult>;
  stopListening(): Promise<ProbeActionResult>;
  clearLog(options?: { confirmed?: boolean }): ProbeClearResult;
  exportLog(): Promise<ProbeExportOutcome>;
  /**
   * Terminal teardown. It invalidates every in-flight attempt, releases the connection
   * and the native listeners it owns, drops the lifecycle listener and drops every
   * snapshot subscriber. Calling it twice is harmless; afterwards this controller
   * instance accepts no operation and notifies nobody.
   */
  release(): Promise<void>;
}

export type ProbeControllerOptions = {
  platform: ProbePlatform;
  /** Null on an unsupported platform: there is nothing to talk to, and no fallback. */
  transport: NativeBleTransport | null;
  exportTarget: ProbeExportTarget;
  lifecycle?: AppLifecycleSource;
  now?: () => Date;
};

/**
 * One connection attempt, from the moment a device was chosen.
 *
 * `phase` matters because teardown must be able to release a peripheral the probe has
 * connected to but not yet published as `device` — otherwise backgrounding during the
 * connect call would leak a live GATT connection.
 */
type AttemptRecord = {
  generation: number;
  peripheralId: string;
  name: string | null;
  selectionMode: ProbeSelectionMode;
  phase: "selected" | "connecting" | "connected";
};

/**
 * One notification registration this controller asked the plugin to make.
 *
 * It is identified by its own `id`, NOT by the peripheral/service/characteristic key.
 * That distinction is load-bearing. The plugin's notification API is key-based — a
 * second `startNotifications` for the same key REPLACES the first registration — so a
 * cleanup belonging to an earlier registration and a later replacement share a key and
 * are indistinguishable by key alone. Identifying registrations separately is what
 * lets an obsolete cleanup retire exactly what it owned and nothing else.
 */
type ListenerRegistration = {
  id: number;
  peripheralId: string;
  serviceUuid: string;
  characteristicUuid: string;
  /** The subscription this registration was made for. */
  subscriptionToken: number;
  /**
   * `owned` — the probe asked for this registration and has not released it.
   * `cleanup_unconfirmed` — a release was attempted and failed. The probe cannot tell
   * which half of the plugin's stop failed (see `releaseKey`), so it asserts neither
   * that the registration is gone nor that it survives.
   */
  state: "owned" | "cleanup_unconfirmed";
};

function registrationKey(registration: {
  peripheralId: string;
  serviceUuid: string;
  characteristicUuid: string;
}): string {
  return `${registration.peripheralId}|${registration.serviceUuid}|${registration.characteristicUuid}`;
}

function emptyServices(): ObservedService[] {
  return BROWER_PROBE_SERVICES.map((descriptor) => ({
    uuid: descriptor.uuid,
    label: descriptor.label,
    documented: true,
    required: descriptor.required,
    discovery: "not_attempted",
    characteristics: [],
  }));
}

function isDataViewLike(value: unknown): value is DataView {
  return (
    typeof value === "object" &&
    value !== null &&
    typeof (value as DataView).byteLength === "number" &&
    typeof (value as DataView).getUint8 === "function"
  );
}

function propertySummary(properties: NativeCharacteristicProperties): string {
  const present = [
    properties.read ? "read" : null,
    properties.write ? "write" : null,
    properties.writeWithoutResponse ? "writeWithoutResponse" : null,
    properties.notify ? "notify" : null,
    properties.indicate ? "indicate" : null,
  ].filter((value): value is string => value !== null);
  return present.length > 0 ? present.join(",") : "none";
}

export function createProbeController(options: ProbeControllerOptions): ProbeController {
  const { platform, transport, exportTarget } = options;
  const now = options.now ?? (() => new Date());

  let listeners: ((snapshot: ProbeSnapshot) => void)[] = [];
  let released = false;

  let bluetooth: ProbeBluetoothState = "not_initialized";
  let status: ProbeConnectionStatus = "idle";
  let statusMessage: string | null = null;
  let failure: ProbeFailure | null = platform.supported
    ? null
    : describeFailure("unsupported_platform");
  let selectionMode: ProbeSelectionMode | null = null;
  let services: ObservedService[] = emptyServices();
  let discoveryIncomplete = false;
  let athleteDataDiscovery: ProbeDiscoveryState = "not_attempted";
  let athleteDataNotifyCapability: ProbeNotifyCapability = "unknown";
  let reads: RawObservation[] = [];
  let notifications: RawObservation[] = [];
  let notificationCount = 0;
  let notificationsActive = false;
  let appActive = true;
  let connections: ProbeConnectionEpoch[] = [];
  let log: ProbeLog = createEmptyProbeLog();

  /**
   * The generation that currently owns the connection lifecycle.
   *
   * Claimed at the start of an attempt and bumped on every invalidation, so a single
   * comparison answers "does this in-flight step still own anything?".
   */
  let activeGeneration = 0;
  let attempt: AttemptRecord | null = null;

  /** Bumped per Start Listening, so Stop/Start on one connection are distinguishable. */
  let subscriptionCounter = 0;
  let activeSubscriptionToken: number | null = null;

  /** Keyed by registration id — never by the native key. See `ListenerRegistration`. */
  const registrations = new Map<number, ListenerRegistration>();
  let registrationCounter = 0;

  /**
   * Peripherals whose teardown has started and not finished.
   *
   * Teardown cannot complete synchronously: it waits for the notification cleanup,
   * which in turn may wait for a native call that is still outstanding. Until it
   * finishes, the probe has NOT yet issued the disconnect for that peripheral — so a
   * replacement connection started in the meantime would be torn down by a disconnect
   * belonging to the attempt before it.
   *
   * Rather than let that happen and then try to unpick it, a new attempt is refused
   * while any teardown is outstanding, with a reason that says so. The operator
   * retries explicitly once it clears; the alternative designs either queue the
   * selection behind an invisible wait or abandon a live connection, and for a
   * diagnostic instrument an accurate refusal beats both.
   */
  const cleanupsInFlight = new Set<string>();
  /** Counts teardowns with no peripheral to name, so the same refusal still applies. */
  let anonymousCleanupsInFlight = 0;

  function cleanupOutstanding(): boolean {
    return cleanupsInFlight.size > 0 || anonymousCleanupsInFlight > 0;
  }

  /**
   * One promise chain per native notification key.
   *
   * The plugin's own queue serializes native calls in the order they are made, but
   * that alone does not make the CONTROLLER's bookkeeping safe: a stop and a
   * replacement start issued back to back would otherwise interleave their state
   * updates. Chaining per key means every start and stop for one
   * peripheral/service/characteristic runs to completion in issue order, so a
   * replacement registration can never be created while an obsolete stop for the same
   * key is still in flight — and therefore can never be stopped by it.
   */
  const keyChains = new Map<string, Promise<unknown>>();

  function onKeyChain<T>(key: string, operation: () => Promise<T>): Promise<T> {
    const previous = keyChains.get(key) ?? Promise.resolve();
    const next = previous.then(operation, operation);
    // The stored link never rejects, so one failed operation cannot poison the chain
    // for every later operation on the same key.
    keyChains.set(
      key,
      next.then(
        () => undefined,
        () => undefined
      )
    );
    return next;
  }

  function registrationsForKey(key: string): ListenerRegistration[] {
    return [...registrations.values()].filter(
      (registration) => registrationKey(registration) === key
    );
  }

  /**
   * `busy` is a token rather than a boolean so a stale operation's `finally` cannot
   * clear the busy state belonging to a newer one.
   */
  let busyCounter = 0;
  let busyToken: number | null = null;

  let sequence = 0;
  let lastExportedSequence = 0;
  const bookkeepingSequences = new Set<number>();
  let lastExport: ProbeExportState | null = null;
  let observationId = 0;

  function timestamp(): string {
    return now().toISOString();
  }

  /** True only while this generation still owns the lifecycle and nothing is released. */
  function ownsLifecycle(generation: number): boolean {
    return !released && generation === activeGeneration;
  }

  /**
   * Moves ownership past every outstanding attempt. Returns the generation retired.
   *
   * The busy claim is released here as well. Every in-flight operation is stale from
   * this moment, so continuing to hold their claim would block the fresh selection the
   * operator now has to make — indefinitely, if a native call never settles. Dropping
   * it is safe precisely because `clearBusy` is token-matched: when the stale
   * operation finally settles, its `finally` finds a different token and clears
   * nothing that belongs to a newer operation.
   */
  function invalidateGeneration(): number {
    const retired = activeGeneration;
    activeGeneration += 1;
    busyToken = null;
    return retired;
  }

  function claimBusy(): number {
    busyCounter += 1;
    busyToken = busyCounter;
    return busyCounter;
  }

  function clearBusy(token: number): void {
    if (busyToken === token) busyToken = null;
  }

  /** Reads `attempt` opaquely, so narrowing from an earlier assignment cannot stick. */
  function readAttempt(): AttemptRecord | null {
    return attempt;
  }

  function connectedAttempt(): AttemptRecord | null {
    return attempt !== null && attempt.phase === "connected" ? attempt : null;
  }

  function publishedDevice(): { peripheralId: string; name: string | null } | null {
    const current = connectedAttempt();
    return current === null
      ? null
      : { peripheralId: current.peripheralId, name: current.name };
  }

  // -------------------------------------------------------------------------
  // Control availability — one source of truth for the controller AND the view
  // -------------------------------------------------------------------------

  function connectAvailability(): ProbeControlAvailability {
    if (released) {
      return { available: false, unavailableReason: "This probe session has ended." };
    }
    if (!platform.supported || transport === null) {
      return {
        available: false,
        unavailableReason: "Native iOS Bluetooth is not available here.",
      };
    }
    if (!appActive) {
      return {
        available: false,
        unavailableReason: "The app is in the background.",
      };
    }
    if (bluetooth !== "ready") {
      return { available: false, unavailableReason: "Initialise Bluetooth first." };
    }
    if (attempt !== null) {
      return {
        available: false,
        unavailableReason:
          attempt.phase === "connected"
            ? "Disconnect the current device first."
            : "A connection attempt is already running.",
      };
    }
    if (status === "selecting" || status === "connecting" || status === "disconnecting") {
      return {
        available: false,
        unavailableReason: "A connection attempt is already running.",
      };
    }
    if (cleanupOutstanding()) {
      // Naming the peripheral matters: the usual case is the operator reselecting the
      // same timer, and "that device is still being released" explains the wait in a
      // way "busy" does not.
      const [first] = [...cleanupsInFlight];
      return {
        available: false,
        unavailableReason:
          first === undefined
            ? "The previous connection is still being released. Try again in a moment."
            : `The previous connection to ${first} is still being released. Try again in a moment.`,
      };
    }
    if (busyToken !== null) {
      return {
        available: false,
        unavailableReason: "Another operation is still running.",
      };
    }
    return { available: true, unavailableReason: null };
  }

  /**
   * Disconnect is deliberately NOT gated on `busy`.
   *
   * It is the operator's way out, and it has to work while a read, a discovery or a
   * subscription is still in flight — that is precisely when someone reaches for it.
   * The in-flight operation is not cancelled (the native bridge offers no
   * cancellation); it is invalidated by the generation bump in teardown, so when it
   * eventually settles it is recorded as stale rather than attributed to a connection
   * that no longer exists.
   */
  function disconnectAvailability(): ProbeControlAvailability {
    if (released) {
      return { available: false, unavailableReason: "This probe session has ended." };
    }
    if (status === "disconnecting") {
      return { available: false, unavailableReason: "Already disconnecting." };
    }
    if (connectedAttempt() === null) {
      return { available: false, unavailableReason: "No device is connected." };
    }
    return { available: true, unavailableReason: null };
  }

  function startListeningAvailability(): ProbeControlAvailability {
    if (released) {
      return { available: false, unavailableReason: "This probe session has ended." };
    }
    if (connectedAttempt() === null || status !== "connected") {
      return { available: false, unavailableReason: "No device is connected." };
    }
    if (athleteDataDiscovery === "failed") {
      return {
        available: false,
        unavailableReason:
          "Discovery did not complete, so the Athlete Data characteristic's presence is unknown.",
      };
    }
    if (athleteDataDiscovery !== "found") {
      return {
        available: false,
        unavailableReason: "The Athlete Data characteristic was not found on this device.",
      };
    }
    if (athleteDataNotifyCapability === "unsupported") {
      return {
        available: false,
        unavailableReason:
          "This device advertises the Athlete Data characteristic without notify or indicate, so it cannot push values to the probe.",
      };
    }
    if (athleteDataNotifyCapability === "unknown") {
      return {
        available: false,
        unavailableReason:
          "The Athlete Data characteristic's notify and indicate properties are not known, so subscribing is not offered.",
      };
    }
    if (activeSubscriptionToken !== null) {
      return { available: false, unavailableReason: "Already listening." };
    }
    if (busyToken !== null) {
      return {
        available: false,
        unavailableReason: "Another operation is still running.",
      };
    }
    return { available: true, unavailableReason: null };
  }

  function stopListeningAvailability(): ProbeControlAvailability {
    if (released) {
      return { available: false, unavailableReason: "This probe session has ended." };
    }
    if (activeSubscriptionToken === null) {
      return { available: false, unavailableReason: "Not currently listening." };
    }
    return { available: true, unavailableReason: null };
  }

  function describeReadableCharacteristics(): ProbeSnapshot["readableCharacteristics"] {
    return BROWER_PROBE_READABLE_CHARACTERISTICS.map((entry) => {
      const base = {
        uuid: entry.characteristicUuid,
        serviceUuid: entry.serviceUuid,
        label: entry.label,
      };
      if (released) {
        return { ...base, available: false, unavailableReason: "This probe session has ended." };
      }
      if (connectedAttempt() === null || status !== "connected") {
        return { ...base, available: false, unavailableReason: "No device is connected." };
      }
      const service = services.find((candidate) => candidate.uuid === entry.serviceUuid);
      if (service === undefined || service.discovery === "failed") {
        return {
          ...base,
          available: false,
          unavailableReason:
            "Service discovery did not complete, so this characteristic's presence is unknown.",
        };
      }
      if (service.discovery === "absent") {
        return {
          ...base,
          available: false,
          unavailableReason: entry.optional
            ? "This optional service was not present on this device. The timing connection is unaffected."
            : "This service was not present on this device.",
        };
      }
      const characteristic = service.characteristics.find(
        (candidate) => candidate.uuid === entry.characteristicUuid
      );
      if (characteristic === undefined) {
        return {
          ...base,
          available: false,
          unavailableReason: "This characteristic was not present in the discovered service.",
        };
      }
      if (!characteristic.properties.read) {
        return {
          ...base,
          available: false,
          unavailableReason: "The device does not advertise this characteristic as readable.",
        };
      }
      if (busyToken !== null) {
        return {
          ...base,
          available: false,
          unavailableReason: "Another operation is still running.",
        };
      }
      return { ...base, available: true, unavailableReason: null };
    });
  }

  function hasUnexportedObservations(): boolean {
    return log.entries.some(
      (entry) =>
        entry.sequence > lastExportedSequence && !bookkeepingSequences.has(entry.sequence)
    );
  }

  function snapshot(): ProbeSnapshot {
    return {
      platform,
      bluetooth,
      status,
      statusMessage,
      failure,
      device: publishedDevice(),
      selectionMode,
      connectionEpoch: activeGeneration,
      services,
      discoveryIncomplete,
      athleteDataDiscovery,
      athleteDataNotifyCapability,
      readableCharacteristics: describeReadableCharacteristics(),
      controls: {
        connect: connectAvailability(),
        disconnect: disconnectAvailability(),
        startListening: startListeningAvailability(),
        stopListening: stopListeningAvailability(),
      },
      reads,
      notifications,
      notificationCount,
      notificationsActive,
      ownedNativeListenerCount: registrations.size,
      busy: busyToken !== null,
      appActive,
      released,
      hasUnexportedObservations: hasUnexportedObservations(),
      lastExport,
      connections,
      log,
    };
  }

  function emit(): void {
    const current = snapshot();
    for (const listener of listeners) listener(current);
  }

  function record(input: ProbeLogInput, bookkeeping = false): number {
    sequence += 1;
    if (bookkeeping) bookkeepingSequences.add(sequence);
    log = appendProbeLogEntry(log, input, sequence, timestamp());
    return sequence;
  }

  function pushObservation(
    target: "read" | "notification",
    uuid: string,
    bytes: Uint8Array,
    entrySequence: number,
    forGeneration: number
  ): void {
    observationId += 1;
    const observation: RawObservation = {
      id: `${target}-${String(observationId)}`,
      sequence: entrySequence,
      connectionEpoch: forGeneration,
      uuid,
      label: browerCharacteristicLabel(uuid),
      hex: formatHexBytes(bytes),
      byteLength: bytes.byteLength,
      at: timestamp(),
    };
    if (target === "read") {
      reads = [...reads, observation].slice(-PROBE_MAX_DISPLAYED_READS);
    } else {
      notifications = [...notifications, observation].slice(
        -PROBE_MAX_DISPLAYED_NOTIFICATIONS
      );
    }
  }

  function closeConnectionEpoch(
    generation: number,
    endedBy: NonNullable<ProbeConnectionEpoch["endedBy"]>
  ): void {
    connections = connections.map((entry) =>
      entry.epoch === generation && entry.endedAt === null
        ? { ...entry, endedAt: timestamp(), endedBy }
        : entry
    );
  }

  // -------------------------------------------------------------------------
  // Native listener ownership
  // -------------------------------------------------------------------------

  /**
   * Releases one native notification key, retiring exactly the registrations named.
   *
   * Two things make this the only safe shape.
   *
   * **The native API is key-based.** `stopNotifications(peripheral, service,
   * characteristic)` stops whatever is registered under that key — it takes no
   * registration identity. An obsolete cleanup that simply called it would therefore
   * stop a REPLACEMENT registration that now occupies the same key. Running on the
   * key's chain is what prevents that: a replacement start is queued behind this stop,
   * so at the moment this stop runs, the replacement does not exist yet.
   *
   * **The caller names what it owns.** `registrationIds` is captured when the release
   * is issued, so a registration created afterwards is never retired by it, whatever
   * the timing.
   *
   * On failure the named registrations are kept and marked `cleanup_unconfirmed`. The
   * plugin's `stopNotifications` removes its JS listener and deletes its map entry
   * BEFORE awaiting the native stop, so a rejection does NOT establish that the JS
   * listener survived — it may well have been removed and the native stop alone have
   * failed. The probe therefore records that cleanup could not be confirmed, and
   * asserts nothing about which half failed.
   */
  async function releaseKey(
    key: string,
    registrationIds: number[],
    generation: number
  ): Promise<boolean> {
    const named = registrationIds
      .map((id) => registrations.get(id))
      .filter((registration): registration is ListenerRegistration => registration !== undefined);
    if (transport === null || named.length === 0) return true;

    const target = named[0];
    if (target === undefined) return true;

    return onKeyChain(key, async () => {
      try {
        await transport.stopNotifications(
          target.peripheralId,
          target.serviceUuid,
          target.characteristicUuid
        );
        // Success retires ONLY the registrations this release was issued for.
        for (const id of registrationIds) registrations.delete(id);
        return true;
      } catch (error) {
        const classified = failureFromError(error);
        for (const id of registrationIds) {
          const registration = registrations.get(id);
          if (registration !== undefined) {
            registrations.set(id, { ...registration, state: "cleanup_unconfirmed" });
          }
        }
        record({
          connectionEpoch: generation,
          direction: "none",
          kind: "native_listener_release_unconfirmed",
          message:
            "Stopping a native notification subscription failed. The probe has stopped treating it as active. It cannot tell whether the plugin removed its callback before the failure, so it neither claims the subscription was released nor claims it survives.",
          uuid: target.characteristicUuid,
          serviceUuid: target.serviceUuid,
          detail: {
            category: classified.category,
            peripheralId: target.peripheralId,
            registrationCount: registrationIds.length,
          },
        });
        return false;
      }
    });
  }

  /**
   * Releases every registration this controller still holds, one call per native key.
   *
   * Grouping by key matters: when an unconfirmed older registration and a newer one
   * share a key, a single stop for that key resolves both, and issuing two would mean
   * the second one stopping whatever the first left behind.
   *
   * Observation is marked inactive FIRST and unconditionally — a cleanup error must
   * never leave the probe claiming it is still listening, and must never reinstate an
   * active subscription.
   */
  async function releaseAllRegistrations(generation: number): Promise<void> {
    activeSubscriptionToken = null;
    notificationsActive = false;

    if (transport === null || registrations.size === 0) return;

    const byKey = new Map<string, number[]>();
    for (const registration of registrations.values()) {
      const key = registrationKey(registration);
      byKey.set(key, [...(byKey.get(key) ?? []), registration.id]);
    }

    for (const [key, ids] of byKey) {
      await releaseKey(key, ids, generation);
    }
  }

  /**
   * Idempotent teardown of the current attempt, whatever phase it reached.
   *
   * It releases the resources it OWNS: the native notification listeners it asked for,
   * and the peripheral it connected to — including one that was connected but never
   * published as `device`, which is the case backgrounding during the connect call
   * produces.
   */
  async function teardownAttempt(
    endedBy: NonNullable<ProbeConnectionEpoch["endedBy"]>,
    teardownOptions: { requestDisconnect: boolean }
  ): Promise<void> {
    const current = attempt;
    // Invalidate first, synchronously: everything in flight is stale from this moment,
    // whatever the native calls below go on to do. Nothing after this point may treat
    // the retired attempt as current observation.
    const retiredGeneration = invalidateGeneration();
    attempt = null;

    // Claim the cleanup BEFORE the first await. The whole point is that the window
    // being protected starts here — not when the disconnect is finally issued.
    const peripheralId = current?.peripheralId ?? null;
    if (peripheralId === null) {
      anonymousCleanupsInFlight += 1;
    } else {
      cleanupsInFlight.add(peripheralId);
    }

    try {
      await releaseAllRegistrations(retiredGeneration);

      if (transport !== null && current !== null && teardownOptions.requestDisconnect) {
        // Defence in depth. `connectAvailability` refuses a new attempt while this
        // cleanup is outstanding, so a replacement holding this peripheral should be
        // impossible here — but a disconnect is destructive and irreversible, so it
        // re-checks rather than trusting that. Skipping is not abandoning a
        // connection: the peripheral is in use by the current attempt.
        // Read through a function: `attempt` was assigned null above, and TypeScript's
        // narrowing does not know that an await can let another caller reassign it.
        const replacement = readAttempt();
        if (replacement !== null && replacement.peripheralId === current.peripheralId) {
          record({
            connectionEpoch: retiredGeneration,
            direction: "none",
            kind: "obsolete_disconnect_suppressed",
            message:
              "A retired attempt's disconnect was not issued, because the current attempt is connected to that same peripheral. Disconnecting would have torn down the live connection.",
            detail: { peripheralId: current.peripheralId },
          });
        } else {
          try {
            await transport.disconnect(current.peripheralId);
          } catch {
            // An already-gone peripheral rejects this; that is not new information.
          }
        }
      }
    } finally {
      if (peripheralId === null) {
        anonymousCleanupsInFlight = Math.max(0, anonymousCleanupsInFlight - 1);
      } else {
        cleanupsInFlight.delete(peripheralId);
      }
      closeConnectionEpoch(retiredGeneration, endedBy);
      // Emit unconditionally: this is the transition that re-enables selection, and a
      // cleanup that failed must still hand control back rather than strand the UI.
      emit();
    }
  }

  function handleUnexpectedDisconnect(forGeneration: number): void {
    if (!ownsLifecycle(forGeneration)) return;
    record({
      connectionEpoch: forGeneration,
      direction: "none",
      kind: "unexpected_disconnect",
      message: "The device disconnected without the probe asking it to.",
    });
    closeConnectionEpoch(forGeneration, "unexpected_disconnect");
    attempt = null;
    status = "disconnected";
    statusMessage = "The device disconnected. Reconnect explicitly to continue.";
    failure = describeFailure("unexpected_disconnect");
    invalidateGeneration();

    // Losing the GATT connection does NOT remove the plugin's JS notification
    // listeners — only `stopNotifications` does. Releasing them is therefore a real
    // step here, not bookkeeping, and it is asynchronous.
    void releaseAllRegistrations(forGeneration).then(() => {
      emit();
    });
    emit();
  }

  function handleNotification(
    forGeneration: number,
    forSubscription: number,
    characteristicUuid: string,
    value: unknown
  ): void {
    if (!isDataViewLike(value)) {
      record({
        connectionEpoch: forGeneration,
        direction: "none",
        kind: "notification_unreadable",
        message: "A notification arrived in a form this probe could not read as bytes.",
        uuid: characteristicUuid,
      });
      emit();
      return;
    }
    // Copy BEFORE the staleness checks: the bridge may reuse the buffer the moment
    // this callback returns, and a stale-entry log quoting a mutated buffer would be
    // worse than no entry at all.
    const bytes = copyBytesFromDataView(value);

    const connectionCurrent = ownsLifecycle(forGeneration);
    const subscriptionCurrent = forSubscription === activeSubscriptionToken;
    if (!connectionCurrent || !subscriptionCurrent) {
      record({
        connectionEpoch: forGeneration,
        direction: "none",
        kind: "stale_notification_discarded",
        message: connectionCurrent
          ? "A notification arrived from a subscription that has already been stopped. It is recorded here and excluded from the current subscription's counts."
          : "A notification arrived for a connection that has already ended. It is recorded here and excluded from this connection's counts.",
        uuid: characteristicUuid,
        payload: buildProbeLogPayload(bytes),
        detail: {
          staleReason: connectionCurrent ? "subscription" : "connection",
          subscriptionToken: forSubscription,
        },
      });
      emit();
      return;
    }

    notificationCount += 1;
    const entrySequence = record({
      connectionEpoch: forGeneration,
      direction: "rx",
      kind: "notification",
      message: "Raw notification received. No field has been decoded.",
      uuid: characteristicUuid,
      serviceUuid: BROWER_TIMING_SERVICE_UUID,
      payload: buildProbeLogPayload(bytes),
      detail: { notificationIndex: notificationCount, subscriptionToken: forSubscription },
    });
    pushObservation("notification", characteristicUuid, bytes, entrySequence, forGeneration);
    emit();
  }

  // -------------------------------------------------------------------------
  // Discovery
  // -------------------------------------------------------------------------

  function applyDiscovery(discovered: NativeService[], generation: number): void {
    const byUuid = new Map(discovered.map((service) => [service.uuid.toLowerCase(), service]));

    const documented: ObservedService[] = BROWER_PROBE_SERVICES.map((descriptor) => {
      const found = byUuid.get(descriptor.uuid);
      if (found === undefined) {
        return {
          uuid: descriptor.uuid,
          label: descriptor.label,
          documented: true,
          required: descriptor.required,
          discovery: "absent",
          characteristics: [],
        };
      }
      return {
        uuid: descriptor.uuid,
        label: descriptor.label,
        documented: true,
        required: descriptor.required,
        discovery: "found",
        characteristics: found.characteristics.map((characteristic) => ({
          uuid: characteristic.uuid.toLowerCase(),
          label: browerCharacteristicLabel(characteristic.uuid),
          properties: characteristic.properties,
        })),
      };
    });

    // A service the device reported that this probe did not expect is exactly the kind
    // of finding the experiment exists to surface — the Current Memory Location
    // characteristic's UUID is still unknown — so it is shown AND logged, never
    // silently dropped from the evidence.
    const undocumented: ObservedService[] = discovered
      .filter(
        (service) =>
          !BROWER_PROBE_SERVICES.some(
            (descriptor) => descriptor.uuid === service.uuid.toLowerCase()
          )
      )
      .map((service) => ({
        uuid: service.uuid.toLowerCase(),
        label: browerServiceLabel(service.uuid.toLowerCase()),
        documented: false,
        required: false,
        discovery: "found",
        characteristics: service.characteristics.map((characteristic) => ({
          uuid: characteristic.uuid.toLowerCase(),
          label: browerCharacteristicLabel(characteristic.uuid),
          properties: characteristic.properties,
        })),
      }));

    services = [...documented, ...undocumented];

    const timing = services.find((service) => service.uuid === BROWER_TIMING_SERVICE_UUID);
    const athleteData =
      timing !== undefined && timing.discovery === "found"
        ? timing.characteristics.find(
            (characteristic) =>
              characteristic.uuid === BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID
          )
        : undefined;

    athleteDataDiscovery = athleteData === undefined ? "absent" : "found";
    athleteDataNotifyCapability =
      athleteData === undefined
        ? "unknown"
        : athleteData.properties.notify || athleteData.properties.indicate
          ? "supported"
          : "unsupported";

    record({
      connectionEpoch: generation,
      direction: "none",
      kind: "discovery_completed",
      message: "Service discovery completed. Every service the device reported is recorded.",
      detail: {
        serviceCount: services.length,
        documentedServiceCount: documented.filter((s) => s.discovery === "found").length,
        undocumentedServiceCount: undocumented.length,
      },
    });

    // EVERY observed service and characteristic is logged — documented or not — so an
    // exported file is a complete record of what the device reported, not a record of
    // what this probe expected.
    for (const service of services) {
      record({
        connectionEpoch: generation,
        direction: "none",
        kind: "service_discovery",
        message:
          service.discovery === "found"
            ? `${service.label ?? "Undocumented"} service found.`
            : `${service.label ?? "Undocumented"} service was not present on this device.`,
        uuid: service.uuid,
        detail: {
          discovery: service.discovery,
          documented: service.documented,
          required: service.required,
          characteristicCount: service.characteristics.length,
        },
      });
      for (const characteristic of service.characteristics) {
        record({
          connectionEpoch: generation,
          direction: "none",
          kind: "characteristic_discovery",
          message: `Characteristic ${characteristic.label ?? "(not named in the manufacturer document)"} observed.`,
          uuid: characteristic.uuid,
          serviceUuid: service.uuid,
          detail: {
            documented: characteristic.label !== null,
            properties: propertySummary(characteristic.properties),
            read: characteristic.properties.read,
            write: characteristic.properties.write,
            writeWithoutResponse: characteristic.properties.writeWithoutResponse,
            notify: characteristic.properties.notify,
            indicate: characteristic.properties.indicate,
          },
        });
      }
    }

    if (athleteDataNotifyCapability === "unsupported") {
      record({
        connectionEpoch: generation,
        direction: "none",
        kind: "athlete_data_not_notifiable",
        message:
          "The Athlete Data characteristic was found but advertises neither notify nor indicate, so this device cannot push values to the probe.",
        uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
        serviceUuid: BROWER_TIMING_SERVICE_UUID,
      });
    }

    const serialNumber = services.find(
      (service) => service.uuid === BROWER_SERIAL_NUMBER_SERVICE_UUID
    );
    if (serialNumber !== undefined && serialNumber.discovery === "absent") {
      record({
        connectionEpoch: generation,
        direction: "none",
        kind: "optional_service_absent",
        message:
          "The optional Serial Number service was not present. This does not invalidate the timing connection.",
        uuid: BROWER_SERIAL_NUMBER_SERVICE_UUID,
      });
    }
  }

  // -------------------------------------------------------------------------
  // Operations
  // -------------------------------------------------------------------------

  async function initializeBluetooth(): Promise<ProbeActionResult> {
    if (released) {
      return { accepted: false, reason: "This probe session has ended." };
    }
    if (!platform.supported || transport === null) {
      failure = describeFailure("unsupported_platform");
      emit();
      return { accepted: false, reason: failure.message };
    }
    if (busyToken !== null) {
      return { accepted: false, reason: "Another operation is still running." };
    }
    if (bluetooth === "initializing") {
      return { accepted: false, reason: "Initialisation is already running." };
    }

    const token = claimBusy();
    bluetooth = "initializing";
    failure = null;
    statusMessage = "Asking iOS for Bluetooth access…";
    emit();

    try {
      await transport.initialize();
      const enabled = await transport.isEnabled();
      if (released) {
        return { accepted: false, reason: "This probe session has ended." };
      }
      if (!enabled) {
        bluetooth = "unavailable";
        failure = describeFailure("bluetooth_unavailable");
        statusMessage = null;
        record({
          connectionEpoch: 0,
          direction: "none",
          kind: "bluetooth_unavailable",
          message: "Bluetooth reported itself as not enabled.",
        });
        return { accepted: false, reason: failure.message };
      }
      bluetooth = "ready";
      statusMessage = "Bluetooth is ready.";
      record({
        connectionEpoch: 0,
        direction: "none",
        kind: "bluetooth_ready",
        message: "Bluetooth initialised and reported as enabled.",
        detail: { platform: platform.platform },
      });
      return { accepted: true };
    } catch (error) {
      const classified = failureFromError(error);
      if (!released) {
        bluetooth =
          classified.category === "permission_denied"
            ? "permission_denied"
            : classified.category === "bluetooth_unavailable"
              ? "unavailable"
              : "failed";
        failure = classified;
        statusMessage = null;
      }
      record({
        connectionEpoch: 0,
        direction: "none",
        kind: "bluetooth_initialize_failed",
        message: "Bluetooth initialisation failed.",
        detail: { category: classified.category },
      });
      return { accepted: false, reason: classified.message };
    } finally {
      clearBusy(token);
      emit();
    }
  }

  /**
   * Releases a peripheral whose connection completed after this probe stopped owning
   * the attempt — unless a LATER attempt is using that same peripheral, in which case
   * disconnecting would tear down the connection the operator currently has.
   */
  async function releaseSupersededConnection(
    peripheralId: string,
    generation: number
  ): Promise<void> {
    const currentUsesSamePeripheral =
      attempt !== null && attempt.peripheralId === peripheralId;
    if (currentUsesSamePeripheral) {
      record({
        connectionEpoch: generation,
        direction: "none",
        kind: "superseded_connection_left_intact",
        message:
          "A superseded connection attempt completed for the peripheral a later attempt is now using. It was left untouched so the current connection is not disturbed.",
        detail: { peripheralId },
      });
      return;
    }
    if (transport === null) return;
    try {
      await transport.disconnect(peripheralId);
      record({
        connectionEpoch: generation,
        direction: "none",
        kind: "superseded_connection_released",
        message:
          "A connection completed after this attempt stopped being current, and was disconnected so it does not stay open.",
        detail: { peripheralId },
      });
    } catch (error) {
      const classified = failureFromError(error);
      record({
        connectionEpoch: generation,
        direction: "none",
        kind: "superseded_connection_release_failed",
        message:
          "A connection completed after this attempt stopped being current, and disconnecting it failed.",
        detail: { peripheralId, category: classified.category },
      });
    }
  }

  async function connect(mode: ProbeSelectionMode): Promise<ProbeActionResult> {
    const availability = connectAvailability();
    if (!availability.available) {
      if (!platform.supported) {
        failure = describeFailure("unsupported_platform");
        emit();
      }
      return { accepted: false, reason: availability.unavailableReason ?? "Not available." };
    }
    if (transport === null) {
      return { accepted: false, reason: describeFailure("unsupported_platform").message };
    }

    // The generation is claimed HERE — before the picker opens — so backgrounding or
    // releasing during selection invalidates this attempt even though no device handle
    // exists yet.
    activeGeneration += 1;
    const generation = activeGeneration;

    const token = claimBusy();
    status = "selecting";
    selectionMode = mode;
    failure = null;
    statusMessage =
      mode === "timing-service-filter"
        ? "Showing devices advertising the Brower timing service…"
        : "Showing all nearby Bluetooth devices…";
    reads = [];
    notifications = [];
    notificationCount = 0;
    services = emptyServices();
    discoveryIncomplete = false;
    athleteDataDiscovery = "not_attempted";
    athleteDataNotifyCapability = "unknown";
    record({
      connectionEpoch: generation,
      direction: "none",
      kind: "device_selection_started",
      message: "Device selection opened by the operator.",
      detail: { selectionMode: mode },
    });
    emit();

    let selected: { deviceId: string; name: string | null };
    try {
      selected = await transport.requestDevice({
        services: mode === "timing-service-filter" ? [BROWER_TIMING_SERVICE_UUID] : [],
        optionalServices: BROWER_PROBE_SERVICES.map((descriptor) => descriptor.uuid),
      });
    } catch (error) {
      const classified = failureFromError(error);
      // Ownership is re-checked on the REJECTION path too: a picker that fails after
      // backgrounding must not reset a state that no longer belongs to it.
      if (ownsLifecycle(generation)) {
        status = classified.category === "user_cancelled" ? "idle" : "failed";
        failure = classified;
        statusMessage = null;
        selectionMode = null;
      }
      clearBusy(token);
      record({
        connectionEpoch: generation,
        direction: "none",
        kind:
          classified.category === "user_cancelled"
            ? "device_selection_cancelled"
            : "device_selection_failed",
        message:
          classified.category === "user_cancelled"
            ? "The operator cancelled device selection. Nothing was connected."
            : "Device selection did not produce a device.",
        detail: { category: classified.category, selectionMode: mode },
      });
      emit();
      return { accepted: false, reason: classified.message };
    }

    if (!ownsLifecycle(generation)) {
      clearBusy(token);
      record({
        connectionEpoch: generation,
        direction: "none",
        kind: "stale_selection_discarded",
        message:
          "A device was selected after this attempt stopped being current. No connection was started.",
        detail: { peripheralId: selected.deviceId, selectionMode: mode },
      });
      emit();
      return {
        accepted: false,
        reason: "The attempt was interrupted before a connection was started.",
      };
    }

    attempt = {
      generation,
      peripheralId: selected.deviceId,
      name: selected.name,
      selectionMode: mode,
      phase: "connecting",
    };
    status = "connecting";
    statusMessage = `Connecting to ${selected.name ?? "the selected device"}…`;
    emit();

    try {
      await transport.connect(selected.deviceId, () => {
        handleUnexpectedDisconnect(generation);
      });
    } catch (error) {
      const classified = failureFromError(error);
      if (ownsLifecycle(generation)) {
        attempt = null;
        status = "failed";
        failure = classified;
        statusMessage = null;
        selectionMode = null;
        // Invalidate so a late disconnect callback from the failed attempt cannot be
        // applied to whatever connects next.
        invalidateGeneration();
      }
      clearBusy(token);
      record({
        connectionEpoch: generation,
        direction: "none",
        kind: "connect_failed",
        message: "The GATT connection attempt failed.",
        detail: { category: classified.category },
      });
      emit();
      return { accepted: false, reason: classified.message };
    }

    if (!ownsLifecycle(generation)) {
      // Backgrounded, released or disconnected while the native connect was in
      // flight. The connection is real and must be let go of — carefully, so a later
      // attempt using the same peripheral is not torn down.
      clearBusy(token);
      record({
        connectionEpoch: generation,
        direction: "none",
        kind: "stale_connection_discarded",
        message:
          "A GATT connection completed after this attempt stopped being current. It is not treated as connected.",
        detail: { peripheralId: selected.deviceId },
      });
      await releaseSupersededConnection(selected.deviceId, generation);
      emit();
      return {
        accepted: false,
        reason: "The attempt was interrupted before the connection could be used.",
      };
    }

    attempt = { ...attempt, phase: "connected" };
    status = "connected";
    statusMessage = null;
    connections = [
      ...connections,
      {
        epoch: generation,
        peripheralId: selected.deviceId,
        deviceName: selected.name,
        selectionMode: mode,
        connectedAt: timestamp(),
        endedAt: null,
        endedBy: null,
      },
    ];
    record({
      connectionEpoch: generation,
      direction: "none",
      kind: "connected",
      message: "GATT connection established.",
      detail: {
        selectionMode: mode,
        deviceName: selected.name ?? "(no name reported)",
        peripheralId: selected.deviceId,
      },
    });
    emit();

    try {
      const discovered = await transport.getServices(selected.deviceId);
      if (!ownsLifecycle(generation)) {
        record({
          connectionEpoch: generation,
          direction: "none",
          kind: "stale_discovery_discarded",
          message:
            "Service discovery completed after this attempt stopped being current. Its result describes a peripheral that is no longer the current one, and is not applied.",
        });
        return { accepted: true };
      }
      applyDiscovery(discovered, generation);
    } catch (error) {
      const classified = failureFromError(error);
      if (ownsLifecycle(generation)) {
        discoveryIncomplete = true;
        athleteDataDiscovery = "failed";
        athleteDataNotifyCapability = "unknown";
        services = services.map((service) => ({ ...service, discovery: "failed" }));
        failure = classified;
      }
      record({
        connectionEpoch: generation,
        direction: "none",
        kind: "service_discovery_failed",
        message:
          "Service discovery failed. What this device does and does not offer is therefore unknown — this is not evidence that any service is missing.",
        detail: { category: classified.category },
      });
    } finally {
      clearBusy(token);
      emit();
    }
    return { accepted: true };
  }

  async function disconnect(): Promise<ProbeActionResult> {
    const availability = disconnectAvailability();
    if (!availability.available) {
      return { accepted: false, reason: availability.unavailableReason ?? "Not available." };
    }

    const generation = activeGeneration;
    status = "disconnecting";
    statusMessage = "Disconnecting…";
    emit();

    record({
      connectionEpoch: generation,
      direction: "none",
      kind: "disconnect_requested",
      message: "The operator asked to disconnect.",
    });
    await teardownAttempt("user_disconnect", { requestDisconnect: true });

    if (!released) {
      status = "disconnected";
      statusMessage = "Disconnected. Reconnect explicitly to continue.";
      failure = null;
      selectionMode = null;
    }
    // `busy` is deliberately untouched: it belongs to whatever operation is still in
    // flight, and that operation's own `finally` clears it.
    emit();
    return { accepted: true };
  }

  async function readCharacteristic(characteristicUuid: string): Promise<ProbeActionResult> {
    const entry = BROWER_PROBE_READABLE_CHARACTERISTICS.find(
      (candidate) => candidate.characteristicUuid === characteristicUuid
    );
    if (entry === undefined) {
      return { accepted: false, reason: "That characteristic is not one this probe reads." };
    }
    const availability = describeReadableCharacteristics().find(
      (candidate) => candidate.uuid === characteristicUuid
    );
    if (availability === undefined || !availability.available) {
      return {
        accepted: false,
        reason: availability?.unavailableReason ?? "That read is not available.",
      };
    }
    const current = connectedAttempt();
    if (transport === null || current === null) {
      return { accepted: false, reason: describeFailure("not_connected").message };
    }

    const generation = current.generation;
    const peripheralId = current.peripheralId;
    const token = claimBusy();
    emit();

    try {
      const value = await transport.read(peripheralId, entry.serviceUuid, characteristicUuid);
      if (!ownsLifecycle(generation)) {
        record({
          connectionEpoch: generation,
          direction: "none",
          kind: "stale_read_discarded",
          message:
            "A read completed for a connection that has already ended. Its value is not attributed to the current connection.",
          uuid: characteristicUuid,
        });
        return { accepted: false, reason: "The connection ended before the read completed." };
      }
      if (!isDataViewLike(value)) {
        record({
          connectionEpoch: generation,
          direction: "none",
          kind: "read_unreadable",
          message: "The read returned a value this probe could not read as bytes.",
          uuid: characteristicUuid,
        });
        return { accepted: false, reason: describeFailure("operation_failed").message };
      }
      const bytes = copyBytesFromDataView(value);
      const entrySequence = record({
        connectionEpoch: generation,
        direction: "rx",
        kind: "read",
        message: `Raw value read from ${entry.label}. No field has been decoded.`,
        uuid: characteristicUuid,
        serviceUuid: entry.serviceUuid,
        payload: buildProbeLogPayload(bytes),
      });
      pushObservation("read", characteristicUuid, bytes, entrySequence, generation);
      return { accepted: true };
    } catch (error) {
      const classified = failureFromError(error);
      if (ownsLifecycle(generation)) failure = classified;
      record({
        connectionEpoch: generation,
        direction: "none",
        kind: "read_failed",
        message: `Reading ${entry.label} failed.`,
        uuid: characteristicUuid,
        detail: { category: classified.category },
      });
      return { accepted: false, reason: classified.message };
    } finally {
      clearBusy(token);
      emit();
    }
  }

  async function startListening(): Promise<ProbeActionResult> {
    const availability = startListeningAvailability();
    if (!availability.available) {
      return { accepted: false, reason: availability.unavailableReason ?? "Not available." };
    }
    const current = connectedAttempt();
    if (transport === null || current === null) {
      return { accepted: false, reason: describeFailure("not_connected").message };
    }

    const generation = current.generation;
    const peripheralId = current.peripheralId;
    subscriptionCounter += 1;
    const subscriptionToken = subscriptionCounter;
    registrationCounter += 1;
    const registration: ListenerRegistration = {
      id: registrationCounter,
      peripheralId,
      serviceUuid: BROWER_TIMING_SERVICE_UUID,
      characteristicUuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
      subscriptionToken,
      state: "owned",
    };
    const key = registrationKey(registration);

    const token = claimBusy();
    // The subscription token and the registration are claimed BEFORE awaiting. The
    // plugin registers its JS listener before its own await, so from this point a
    // callback may exist whatever happens next — including on the failure path.
    activeSubscriptionToken = subscriptionToken;
    registrations.set(registration.id, registration);
    emit();

    try {
      // Queued on the key's chain, so a stop that was issued first completes before
      // this start registers anything.
      await onKeyChain(key, () =>
        transport.startNotifications(
          peripheralId,
          BROWER_TIMING_SERVICE_UUID,
          BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
          (value) => {
            handleNotification(
              generation,
              subscriptionToken,
              BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
              value
            );
          }
        )
      );
      if (!ownsLifecycle(generation) || activeSubscriptionToken !== subscriptionToken) {
        record({
          connectionEpoch: generation,
          direction: "none",
          kind: "stale_subscription_discarded",
          message:
            "A subscription completed after it stopped being current. It is not treated as active, and the registration it made is being released.",
          uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
          detail: { subscriptionToken },
        });
        await releaseKey(key, [registration.id], generation);
        return { accepted: false, reason: "The subscription was interrupted before it started." };
      }
      notificationsActive = true;
      record({
        connectionEpoch: generation,
        direction: "none",
        kind: "notifications_started",
        message: "Listening for raw Athlete Data notifications.",
        uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
        detail: { subscriptionToken, registrationId: registration.id },
      });
      return { accepted: true };
    } catch (error) {
      const classified = failureFromError(error);
      if (activeSubscriptionToken === subscriptionToken) {
        activeSubscriptionToken = null;
        notificationsActive = false;
      }
      if (ownsLifecycle(generation)) failure = classified;
      record({
        connectionEpoch: generation,
        direction: "none",
        kind: "notifications_start_failed",
        message:
          "Subscribing to Athlete Data notifications failed. The plugin registers its callback before its own native call, so the registration is released explicitly rather than assumed absent.",
        uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
        detail: { category: classified.category, subscriptionToken },
      });
      await releaseKey(key, [registration.id], generation);
      return { accepted: false, reason: classified.message };
    } finally {
      clearBusy(token);
      emit();
    }
  }

  async function stopListening(): Promise<ProbeActionResult> {
    const availability = stopListeningAvailability();
    if (!availability.available) {
      return { accepted: false, reason: availability.unavailableReason ?? "Not available." };
    }

    const generation = activeGeneration;
    const stoppedToken = activeSubscriptionToken;
    // Retire the token FIRST. From here a callback from this subscription is stale,
    // whether or not the native stop succeeds.
    activeSubscriptionToken = null;
    notificationsActive = false;
    emit();

    // Resolve the ACTIVE subscription by its own identity — the registration made for
    // the token being stopped — not by scanning for the Athlete Data characteristic.
    // A scan would match an older registration for a DIFFERENT peripheral whose
    // cleanup never completed, and stop that instead of the subscription the operator
    // is actually listening to.
    const active =
      stoppedToken === null
        ? undefined
        : [...registrations.values()].find(
            (registration) => registration.subscriptionToken === stoppedToken
          );

    if (active === undefined || transport === null) {
      record({
        connectionEpoch: generation,
        direction: "none",
        kind: "notifications_stopped",
        message: "Stopped listening for Athlete Data notifications.",
        uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
        detail: { subscriptionToken: stoppedToken ?? -1 },
      });
      emit();
      return { accepted: true };
    }

    const key = registrationKey(active);
    // Every registration sharing this native key is resolved by one stop — a stop is
    // key-scoped, so issuing one per registration would mean the second stopping
    // whatever the first left. Registrations for OTHER peripherals are untouched:
    // their cleanup stays outstanding and is never reported as done by this call.
    const idsForKey = registrationsForKey(key).map((registration) => registration.id);

    const releasedCleanly = await releaseKey(key, idsForKey, generation);
    if (releasedCleanly) {
      record({
        connectionEpoch: generation,
        direction: "none",
        kind: "notifications_stopped",
        message: "Stopped listening for Athlete Data notifications.",
        uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
        detail: {
          subscriptionToken: stoppedToken ?? -1,
          peripheralId: active.peripheralId,
        },
      });
      emit();
      return { accepted: true };
    }

    record({
      connectionEpoch: generation,
      direction: "none",
      kind: "notifications_stop_failed",
      message:
        "Unsubscribing from Athlete Data notifications failed. The probe no longer treats the subscription as active; whether the native side actually stopped could not be confirmed.",
      uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
      detail: { peripheralId: active.peripheralId },
    });
    emit();
    return { accepted: false, reason: describeFailure("operation_failed").message };
  }

  function clearLog(clearOptions?: { confirmed?: boolean }): ProbeClearResult {
    const confirmed = clearOptions?.confirmed === true;
    if (!confirmed && hasUnexportedObservations()) {
      return {
        cleared: false,
        requiresConfirmation: true,
        reason:
          "There are observations that no completed export has carried off this iPhone. Clearing discards them permanently.",
      };
    }
    log = createEmptyProbeLog();
    reads = [];
    notifications = [];
    notificationCount = 0;
    bookkeepingSequences.clear();
    // The sequence counter keeps running: it identifies observations across the whole
    // session, and restarting it would make two different entries share a number in
    // two exported files.
    record(
      {
        connectionEpoch: activeGeneration,
        direction: "none",
        kind: "log_cleared",
        message: "The operator cleared the observation log.",
      },
      true
    );
    lastExportedSequence = sequence;
    emit();
    return { cleared: true };
  }

  async function exportLog(): Promise<ProbeExportOutcome> {
    const exportedAt = timestamp();
    const fileName = buildProbeExportFileName(exportedAt);
    // Snapshot the high-water mark BEFORE sharing. Anything arriving while the share
    // sheet is open is genuinely not in the file and must still count as unexported.
    const highestSequenceInFile = sequence;
    // The ACTUAL number of entries in the file. After a clear, or after retention
    // eviction, this is not the sequence high-water mark, and reporting the mark as an
    // entry count would overstate what the file contains.
    const entriesInFile = log.entries.length;
    const content = serializeProbeLog(log, {
      exportedAt,
      platform: platform.platform,
      connections,
    });

    let outcome: ProbeExportOutcome;
    try {
      outcome = await exportTarget.exportJson(fileName, content);
    } catch {
      outcome = { kind: "failed", reason: "The export could not be completed." };
    }

    if (outcome.kind === "shared") {
      lastExportedSequence = highestSequenceInFile;
    }
    lastExport = {
      at: exportedAt,
      outcome: outcome.kind,
      fileName: outcome.kind === "failed" ? null : outcome.fileName,
      reason: outcome.kind === "failed" ? outcome.reason : null,
    };
    record(
      {
        connectionEpoch: activeGeneration,
        direction: "none",
        kind: `export_${outcome.kind}`,
        message:
          outcome.kind === "shared"
            ? "The observation log was exported and shared."
            : outcome.kind === "cancelled"
              ? "Sharing was cancelled. The log was NOT saved anywhere."
              : "The export failed. The log was NOT saved anywhere.",
        detail: { entriesInFile, highestSequenceInFile },
      },
      true
    );
    emit();
    return outcome;
  }

  function handleAppStateChange(isActive: boolean): void {
    if (released) return;
    if (isActive === appActive) return;
    appActive = isActive;
    if (isActive) {
      record({
        connectionEpoch: activeGeneration,
        direction: "none",
        kind: "app_foregrounded",
        message:
          "The app returned to the foreground. Nothing was observed while it was in the background; select a device again to continue.",
      });
      emit();
      return;
    }

    record({
      connectionEpoch: activeGeneration,
      direction: "none",
      kind: "app_backgrounded",
      message:
        "The app left the foreground. This probe declares no iOS background Bluetooth mode, so it stops treating this session as actively observed.",
    });

    // Backgrounding invalidates the attempt whatever phase it reached — including one
    // whose picker or connect call is still pending and which has published no device
    // handle. Teardown is run unconditionally so a generation is always retired.
    const hadAttempt = attempt !== null;
    status = "disconnected";
    statusMessage =
      "Observation stopped when the app left the foreground. Select a device again to continue.";
    notificationsActive = false;
    void teardownAttempt("backgrounded", { requestDisconnect: hadAttempt }).then(() => {
      if (!released) selectionMode = null;
      emit();
    });
    emit();
  }

  const unsubscribeLifecycle =
    options.lifecycle?.onActiveStateChange(handleAppStateChange) ?? (() => undefined);

  async function release(): Promise<void> {
    if (released) return;
    // `released` is set FIRST, so every ownership check fails from this moment on —
    // including for a picker or connect call that is still pending.
    released = true;
    unsubscribeLifecycle();
    record({
      connectionEpoch: activeGeneration,
      direction: "none",
      kind: "released",
      message: "The probe session was released. No further operation is accepted.",
    });
    await teardownAttempt("released", { requestDisconnect: true });
    status = "disconnected";
    statusMessage = null;
    listeners = [];
  }

  if (!platform.supported) {
    record({
      connectionEpoch: 0,
      direction: "none",
      kind: "unsupported_platform",
      message:
        "This build is not running as a native iOS app. The probe does not fall back to browser Bluetooth or to synthetic data.",
      detail: { platform: platform.platform, reason: platform.reason },
    });
  }

  return {
    getSnapshot: snapshot,
    subscribe(listener) {
      listeners = [...listeners, listener];
      return () => {
        listeners = listeners.filter((candidate) => candidate !== listener);
      };
    },
    initializeBluetooth,
    connect,
    disconnect,
    readCharacteristic,
    startListening,
    stopListening,
    clearLog,
    exportLog,
    release,
  };
}
