// The Brower TCi BLE diagnostic controller.
//
// All transport/lifecycle logic for the development-only diagnostic view lives here,
// separate from React so it can be driven by an injected mock Bluetooth API in tests.
// It is NOT a `TimingProvider` and deliberately does not implement that contract: it
// never produces a `TimingResult`, never touches Session/Assessment/Exercise state, and
// never writes to any repository. A future production Brower adapter must go through
// the existing provider-neutral boundary (`src/lib/timingProvider.ts`,
// `src/lib/captureSequence.ts`) — see ADR-0006 and
// docs/EXTERNAL_TIMING_INTEGRATION_DISCOVERY.md — not through this module.
//
// Lifecycle ownership is a single monotonic `generation` counter. Every connect
// attempt and every release bumps it; every asynchronous continuation and every event
// listener captures the generation it belongs to and returns early once that
// generation is no longer current. A stale continuation that has already obtained a
// GATT server releases it instead of adopting it. That one mechanism covers closing
// the view, navigating away, sign-out, a Profile switch, unmount, React Strict Mode's
// double-invoke, repeated Connect clicks, an unexpected disconnect, and a late
// notification from a previous connection.
import {
  appendLogEntry,
  buildLogPayload,
  createEmptyDiagnosticLog,
  type BrowerDiagnosticLog,
  type BrowerLogInput,
} from "./diagnosticLog";
import {
  BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
  BROWER_POWER_ON_COUNTER_CHARACTERISTIC_UUID,
  BROWER_SERIAL_NUMBER_CHARACTERISTIC_UUID,
  BROWER_SERIAL_NUMBER_SERVICE_UUID,
  BROWER_TIME_BASE_CHARACTERISTIC_UUID,
  BROWER_TIMING_SERVICE_UUID,
  browerCharacteristicLabel,
  buildAthleteDataRequestCommand,
  copyBytesFromDataView,
  formatHexBytes,
  validateAthleteDataRequestRange,
  type BrowerAthleteDataRequest,
} from "./protocol";
import {
  resolveBluetoothApi,
  resolveBrowserSupport,
  type BrowerBluetoothLike,
  type BrowerBrowserSupport,
  type BrowerCharacteristicLike,
  type BrowerDeviceLike,
  type BrowerGattServerLike,
  type BrowerRequestDeviceOptions,
  type BrowerServiceLike,
} from "./webBluetooth";

/**
 * How long, after a memory-read command is written, the diagnostic keeps its
 * observation window open before allowing another request. It is a diagnostic
 * convenience — NOT evidence that every device reply has arrived.
 */
export const BROWER_OBSERVATION_WINDOW_MS = 4000;

/** Bounded display list for received notifications; the log has its own, larger bound. */
export const BROWER_MAX_DISPLAYED_NOTIFICATIONS = 50;

/** Same bound for explicit characteristic reads, so repeated reads cannot grow without limit. */
export const BROWER_MAX_DISPLAYED_READS = 50;

export type BrowerConnectionStatus =
  | "unsupported"
  | "idle"
  | "selecting"
  | "connecting"
  | "connected"
  | "disconnecting"
  | "disconnected"
  | "failed";

export type BrowerSelectionMode = "timing-service-filter" | "all-devices";

export type BrowerObservedProperties = {
  read: boolean;
  write: boolean;
  writeWithoutResponse: boolean;
  notify: boolean;
  indicate: boolean;
};

export type BrowerObservedCharacteristic = {
  uuid: string;
  /** The documented name, or null for a characteristic this document does not name. */
  label: string | null;
  properties: BrowerObservedProperties;
};

/**
 * How a documented service's discovery actually ended.
 *
 * `"absent"` and `"failed"` must never be conflated. A discovery instrument that reports
 * a failed query as "this device does not have that service" manufactures evidence: the
 * operator would conclude the unit is not a TCi, when in fact the enumeration itself
 * errored. Only a `NotFoundError` from the platform is treated as confirmed absence.
 */
export type BrowerServiceDiscoveryState = "not_attempted" | "found" | "absent" | "failed";

export type BrowerObservedService = {
  uuid: string;
  label: string;
  required: boolean;
  discovery: BrowerServiceDiscoveryState;
  /** True only when `getCharacteristics` actually returned a list for this service. */
  characteristicsEnumerated: boolean;
  /**
   * Sanitized error category when discovering this service, or enumerating its
   * characteristics, failed. Always one of `classifyBluetoothError`'s hard-coded
   * literals — never text read off the thrown value.
   */
  discoveryFailureCategory: string | null;
  characteristics: BrowerObservedCharacteristic[];
};

export type BrowerRawObservation = {
  id: string;
  uuid: string;
  label: string | null;
  hex: string;
  byteLength: number;
  at: string;
};

export type BrowerDiagnosticSnapshot = {
  support: BrowerBrowserSupport;
  status: BrowerConnectionStatus;
  statusMessage: string | null;
  /** An actionable failure the athlete/developer can respond to, or null. */
  failure: string | null;
  device: { name: string | null; browserDeviceId: string } | null;
  services: BrowerObservedService[];
  /**
   * True when any documented service or characteristic query failed rather than
   * returning a definite answer. The view must say so: what is on screen is then a
   * partial picture of the device, not a complete inspection of it.
   */
  discoveryIncomplete: boolean;
  /**
   * How discovery of the Athlete Data characteristic specifically ended. Carried
   * explicitly rather than derived from `services`, because an absent entry in an
   * enumeration that FAILED is not the same fact as an absent entry in one that
   * succeeded — and the view has to tell a reader which of the two it is looking at.
   * `"found"` is also the only state in which a subscription may be offered.
   */
  athleteDataDiscovery: BrowerServiceDiscoveryState;
  reads: BrowerRawObservation[];
  notificationsActive: boolean;
  notifications: BrowerRawObservation[];
  /** Total received, including any beyond the bounded display list. */
  notificationCount: number;
  observationWindowActive: boolean;
  busy: boolean;
  log: BrowerDiagnosticLog;
};

export type BrowerRequestOutcome = { accepted: true } | { accepted: false; reason: string };

export interface BrowerBleDiagnosticController {
  getSnapshot(): BrowerDiagnosticSnapshot;
  /** Registers a listener. Does NOT emit synchronously — read `getSnapshot()` for the initial value. */
  subscribe(listener: (snapshot: BrowerDiagnosticSnapshot) => void): () => void;
  connect(mode: BrowerSelectionMode): Promise<void>;
  disconnect(): Promise<void>;
  readCharacteristic(uuid: string): Promise<void>;
  startNotifications(): Promise<void>;
  stopNotifications(): Promise<void>;
  sendAthleteDataRequest(request: BrowerAthleteDataRequest): Promise<BrowerRequestOutcome>;
  clearLog(): void;
  /** Idempotent teardown. The controller stays usable afterwards (Strict Mode remounts it). */
  release(): void;
}

export type BrowerControllerOptions = {
  bluetooth?: BrowerBluetoothLike | null;
  isSecureContext?: boolean;
  now?: () => Date;
  nodeEnv?: string | undefined;
};

/**
 * The diagnostic exists only outside production. This is a runtime check, not a label:
 * `process.env.NODE_ENV` is inlined by Next at build time, so a production bundle
 * evaluates this to `false` and the controller below refuses to construct.
 */
export function isBrowerDiagnosticEnvironment(
  nodeEnv: string | undefined = process.env.NODE_ENV
): boolean {
  return nodeEnv !== "production";
}

const KNOWN_BLUETOOTH_ERROR_NAMES = [
  "NotFoundError",
  "NotAllowedError",
  "SecurityError",
  "NotSupportedError",
  "NetworkError",
  "InvalidStateError",
  "AbortError",
  "OperationError",
  "TypeError",
  "UnknownError",
] as const;

type KnownBluetoothErrorName = (typeof KNOWN_BLUETOOTH_ERROR_NAMES)[number];

/**
 * Classifies a caught Bluetooth error into one of a fixed set of literals authored
 * here. Never returns a substring of the caught value, so an unexpected thrown value
 * cannot smuggle arbitrary text into the exportable log (same principle as
 * `src/lib/safeErrorCategory.ts`, kept local because this needs the DOMException
 * *names* the Web Bluetooth specification defines).
 */
export function classifyBluetoothError(error: unknown): KnownBluetoothErrorName | "unknown_error" {
  try {
    if (typeof error !== "object" || error === null) return "unknown_error";
    const name = (error as { name?: unknown }).name;
    if (typeof name !== "string") return "unknown_error";
    const match = KNOWN_BLUETOOTH_ERROR_NAMES.find((known) => known === name);
    return match ?? "unknown_error";
  } catch {
    return "unknown_error";
  }
}

const FAILURE_MESSAGES: Record<KnownBluetoothErrorName | "unknown_error", string> = {
  NotFoundError: "No device was selected.",
  NotAllowedError:
    "The browser denied Bluetooth access. Allow Bluetooth for this site, and grant Chrome Bluetooth access in macOS System Settings → Privacy & Security.",
  SecurityError:
    "The browser blocked the Bluetooth request. Web Bluetooth needs a secure context — use the localhost dev URL.",
  NotSupportedError: "The device or browser does not support this Bluetooth operation.",
  NetworkError:
    "The Bluetooth connection failed or was lost. Check the timer is on and in range, and that no other app holds the connection.",
  InvalidStateError: "The Bluetooth device was in an unexpected state for this operation.",
  AbortError: "The Bluetooth operation was aborted.",
  OperationError: "The Bluetooth operation failed.",
  TypeError: "The Bluetooth request was rejected as malformed.",
  UnknownError: "The Bluetooth stack reported an unknown error.",
  unknown_error: "The Bluetooth operation failed for an unrecognized reason.",
};

function observedProperties(
  characteristic: BrowerCharacteristicLike
): BrowerObservedProperties {
  const properties = characteristic.properties ?? {};
  return {
    read: properties.read === true,
    write: properties.write === true,
    writeWithoutResponse: properties.writeWithoutResponse === true,
    notify: properties.notify === true,
    indicate: properties.indicate === true,
  };
}

/** Duck-typed so a DataView produced in another realm (or by a mock) still qualifies. */
function isDataViewLike(value: unknown): value is DataView {
  if (typeof value !== "object" || value === null) return false;
  const candidate = value as { getUint8?: unknown; byteLength?: unknown };
  return typeof candidate.getUint8 === "function" && typeof candidate.byteLength === "number";
}

function emptyServices(): BrowerObservedService[] {
  return [
    {
      uuid: BROWER_TIMING_SERVICE_UUID,
      label: "Timing service",
      required: true,
      discovery: "not_attempted",
      characteristicsEnumerated: false,
      discoveryFailureCategory: null,
      characteristics: [],
    },
    {
      uuid: BROWER_SERIAL_NUMBER_SERVICE_UUID,
      label: "Serial Number service",
      required: false,
      discovery: "not_attempted",
      characteristicsEnumerated: false,
      discoveryFailureCategory: null,
      characteristics: [],
    },
  ];
}

type ServiceLookup =
  | { outcome: "found"; service: BrowerServiceLike }
  | { outcome: "absent" }
  | { outcome: "failed"; category: string };

type CharacteristicsLookup =
  | { outcome: "listed"; characteristics: BrowerCharacteristicLike[] }
  | { outcome: "failed"; category: string };

type CharacteristicLookup =
  | { outcome: "found"; characteristic: BrowerCharacteristicLike }
  | { outcome: "absent" }
  | { outcome: "failed"; category: string };

const NOOP = () => undefined;

export function createBrowerBleDiagnosticController(
  options: BrowerControllerOptions = {}
): BrowerBleDiagnosticController {
  if (!isBrowerDiagnosticEnvironment(options.nodeEnv)) {
    throw new Error(
      "The Brower BLE diagnostic is a development-only tool and is not available in production."
    );
  }

  const bluetooth =
    options.bluetooth === undefined ? resolveBluetoothApi() : options.bluetooth;
  const isSecureContext =
    options.isSecureContext ??
    (typeof window === "undefined" ? false : window.isSecureContext === true);
  const now = options.now ?? (() => new Date());
  const support = resolveBrowserSupport(bluetooth, isSecureContext);

  const listeners = new Set<(snapshot: BrowerDiagnosticSnapshot) => void>();

  let snapshot: BrowerDiagnosticSnapshot = {
    support,
    status: support.supported ? "idle" : "unsupported",
    statusMessage: null,
    failure: null,
    device: null,
    services: emptyServices(),
    discoveryIncomplete: false,
    athleteDataDiscovery: "not_attempted",
    reads: [],
    notificationsActive: false,
    notifications: [],
    notificationCount: 0,
    observationWindowActive: false,
    busy: false,
    log: createEmptyDiagnosticLog(),
  };

  let generation = 0;
  let logSequence = 0;
  let observationSequence = 0;
  let pendingOperations = 0;

  let device: BrowerDeviceLike | null = null;
  let server: BrowerGattServerLike | null = null;
  let athleteDataCharacteristic: BrowerCharacteristicLike | null = null;
  let notificationListener: ((event: Event) => void) | null = null;
  let disconnectListener: (() => void) | null = null;
  let observationTimer: ReturnType<typeof setTimeout> | null = null;
  // Set synchronously at the moment a retrieval request is accepted, so two rapid
  // clicks cannot both pass the observation-window check before either has written.
  // The queue alone would not close that gap: the window only opens once the write
  // resolves.
  let retrievalRequestPending = false;
  let gattQueue: Promise<void> = Promise.resolve();

  function emit() {
    listeners.forEach((listener) => listener(snapshot));
  }

  function update(patch: Partial<BrowerDiagnosticSnapshot>) {
    snapshot = { ...snapshot, ...patch };
    emit();
  }

  function isCurrent(captured: number): boolean {
    return captured === generation;
  }

  function log(input: BrowerLogInput) {
    logSequence += 1;
    snapshot = {
      ...snapshot,
      log: appendLogEntry(snapshot.log, input, logSequence, now().toISOString()),
    };
    emit();
  }

  function nextObservationId(): string {
    observationSequence += 1;
    return `observation-${observationSequence}`;
  }

  function beginOperation() {
    pendingOperations += 1;
    if (!snapshot.busy) update({ busy: true });
  }

  function endOperation() {
    pendingOperations = Math.max(0, pendingOperations - 1);
    if (pendingOperations === 0 && snapshot.busy) update({ busy: false });
  }

  /** One GATT operation at a time, in submission order (the codebase's Promise-queue pattern). */
  function enqueue(operation: () => Promise<void>): Promise<void> {
    beginOperation();
    const result = gattQueue.then(operation, operation).finally(endOperation);
    gattQueue = result.then(NOOP, NOOP);
    return result.catch(NOOP);
  }

  /**
   * Enqueues an operation that belongs to the generation current at SUBMISSION time.
   * Without this, an operation queued just before the view closed would still run
   * against a connection nobody owns any more once the queue drained.
   */
  function enqueueForGeneration(operation: () => Promise<void>): Promise<void> {
    const requested = generation;
    return enqueue(async () => {
      if (requested !== generation) return;
      await operation();
    });
  }

  function clearObservationWindow() {
    if (observationTimer !== null) {
      clearTimeout(observationTimer);
      observationTimer = null;
    }
  }

  /**
   * Tears down everything owned by the current connection and invalidates every
   * in-flight continuation by bumping the generation. Each step is independently
   * guarded so one failing step cannot prevent the rest.
   */
  function releaseActiveConnection() {
    generation += 1;

    const priorDevice = device;
    const priorServer = server;
    const priorCharacteristic = athleteDataCharacteristic;
    const priorNotificationListener = notificationListener;
    const priorDisconnectListener = disconnectListener;

    device = null;
    server = null;
    athleteDataCharacteristic = null;
    notificationListener = null;
    disconnectListener = null;

    clearObservationWindow();
    retrievalRequestPending = false;

    if (priorCharacteristic !== null && priorNotificationListener !== null) {
      try {
        priorCharacteristic.removeEventListener(
          "characteristicvaluechanged",
          priorNotificationListener
        );
      } catch {
        // Best effort: a detached characteristic may already have torn down.
      }
    }

    if (priorCharacteristic !== null && priorNotificationListener !== null) {
      try {
        void Promise.resolve(priorCharacteristic.stopNotifications()).catch(NOOP);
      } catch {
        // Best effort: the device is usually already gone by the time this runs.
      }
    }

    if (priorDevice !== null && priorDisconnectListener !== null) {
      try {
        // Removed BEFORE disconnecting, so our own teardown is never reported as an
        // unexpected disconnect.
        priorDevice.removeEventListener("gattserverdisconnected", priorDisconnectListener);
      } catch {
        // Best effort.
      }
    }

    if (priorServer !== null) {
      try {
        priorServer.disconnect();
      } catch {
        // Best effort.
      }
    }

    snapshot = {
      ...snapshot,
      status: snapshot.support.supported ? "idle" : "unsupported",
      device: null,
      services: emptyServices(),
      discoveryIncomplete: false,
      athleteDataDiscovery: "not_attempted",
      reads: [],
      notificationsActive: false,
      notifications: [],
      notificationCount: 0,
      observationWindowActive: false,
    };
    emit();
  }

  function fail(kind: string, message: string, detail?: Record<string, string | number | boolean>) {
    log({ direction: "none", kind, message, detail });
    update({ status: "failed", statusMessage: null, failure: message });
  }

  function failureMessageFor(error: unknown): { category: string; message: string } {
    const category = classifyBluetoothError(error);
    return { category, message: FAILURE_MESSAGES[category] };
  }

  function requestDeviceOptions(mode: BrowerSelectionMode): BrowerRequestDeviceOptions {
    if (mode === "timing-service-filter") {
      return {
        filters: [{ services: [BROWER_TIMING_SERVICE_UUID] }],
        optionalServices: [BROWER_SERIAL_NUMBER_SERVICE_UUID],
      };
    }
    // Fallback chooser. The manufacturer document's advertising example carries a
    // 128-bit service UUID that does NOT match its own declared timing-service UUID, so
    // a filtered chooser may legitimately show nothing. Both documented services are
    // listed as optional so they stay accessible after connecting.
    return {
      acceptAllDevices: true,
      optionalServices: [BROWER_TIMING_SERVICE_UUID, BROWER_SERIAL_NUMBER_SERVICE_UUID],
    };
  }

  /**
   * Looks up one primary service, distinguishing the three genuinely different outcomes.
   * Only the platform's `NotFoundError` means "this device does not expose it"; every
   * other error means the question could not be answered, which is a different fact and
   * must be recorded as one.
   */
  async function lookupPrimaryService(
    gattServer: BrowerGattServerLike,
    uuid: string
  ): Promise<ServiceLookup> {
    try {
      return { outcome: "found", service: await gattServer.getPrimaryService(uuid) };
    } catch (error) {
      const category = classifyBluetoothError(error);
      if (category === "NotFoundError") return { outcome: "absent" };
      return { outcome: "failed", category };
    }
  }

  /** Enumerates a service's characteristics. A throw is a failure, never an empty list. */
  async function listCharacteristics(
    service: BrowerServiceLike
  ): Promise<CharacteristicsLookup> {
    try {
      return { outcome: "listed", characteristics: await service.getCharacteristics() };
    } catch (error) {
      return { outcome: "failed", category: classifyBluetoothError(error) };
    }
  }

  /**
   * Finds one characteristic within a service. `"absent"` requires a successful
   * enumeration that simply did not contain it — a failed enumeration yields
   * `"failed"`, so callers never report a characteristic as missing on the strength of
   * a query that errored.
   */
  async function lookupCharacteristic(
    service: BrowerServiceLike,
    uuid: string
  ): Promise<CharacteristicLookup> {
    const listed = await listCharacteristics(service);
    if (listed.outcome === "failed") return { outcome: "failed", category: listed.category };
    const match = listed.characteristics.find(
      (entry) => entry.uuid.toLowerCase() === uuid
    );
    return match === undefined
      ? { outcome: "absent" }
      : { outcome: "found", characteristic: match };
  }

  /** Builds the observed view of a service whose characteristics were enumerated. */
  function describeListedService(
    template: BrowerObservedService,
    characteristics: BrowerCharacteristicLike[]
  ): BrowerObservedService {
    return {
      ...template,
      discovery: "found",
      characteristicsEnumerated: true,
      discoveryFailureCategory: null,
      characteristics: characteristics.map((characteristic) => ({
        uuid: characteristic.uuid,
        label: browerCharacteristicLabel(characteristic.uuid),
        properties: observedProperties(characteristic),
      })),
    };
  }

  /**
   * Releases a GATT server obtained by a connect attempt that is no longer current, so
   * a stale continuation never leaves a connection nobody owns. Best-effort by design:
   * a throw here must not prevent the rest of the teardown.
   */
  function releaseStaleServer(staleServer: BrowerGattServerLike) {
    try {
      staleServer.disconnect();
    } catch {
      // Best effort.
    }
  }

  /** Marks the snapshot as an explicitly partial picture of the device. */
  function markDiscoveryIncomplete() {
    if (!snapshot.discoveryIncomplete) update({ discoveryIncomplete: true });
  }

  function handleNotificationEvent(captured: number, event: Event) {
    if (!isCurrent(captured)) return;
    const target = event.target as { value?: unknown } | null;
    const value = target?.value;
    if (!isDataViewLike(value)) {
      log({
        direction: "rx",
        kind: "notification_without_value",
        uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
        message: "A notification arrived without readable bytes.",
      });
      return;
    }
    // Copied at receipt time: the platform may reuse the characteristic's buffer.
    const bytes = copyBytesFromDataView(value);
    const observation: BrowerRawObservation = {
      id: nextObservationId(),
      uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
      label: "Athlete Data",
      hex: formatHexBytes(bytes),
      byteLength: bytes.byteLength,
      at: now().toISOString(),
    };
    const notifications = [observation, ...snapshot.notifications].slice(
      0,
      BROWER_MAX_DISPLAYED_NOTIFICATIONS
    );
    update({ notifications, notificationCount: snapshot.notificationCount + 1 });
    log({
      direction: "rx",
      kind: "notification_received",
      uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
      message:
        "Raw notification bytes, preserved exactly as received. No field has been decoded.",
      payload: buildLogPayload(bytes),
    });
  }

  function handleUnexpectedDisconnect(captured: number) {
    if (!isCurrent(captured)) return;
    log({
      direction: "none",
      kind: "unexpected_disconnect",
      message: "The device disconnected while the diagnostic was connected.",
    });
    releaseActiveConnection();
    update({
      status: "disconnected",
      statusMessage: null,
      failure:
        "The connection to the timer was lost. Check the timer is on and in range, then connect again.",
    });
  }

  async function runConnect(mode: BrowerSelectionMode): Promise<void> {
    if (!snapshot.support.supported || bluetooth === null) return;

    releaseActiveConnection();
    const captured = generation;

    update({
      status: "selecting",
      statusMessage: "Waiting for the browser's device chooser.",
      failure: null,
    });
    log({
      direction: "none",
      kind: "device_selection_requested",
      message:
        mode === "timing-service-filter"
          ? "Device chooser opened, filtered on the documented timing service."
          : "Device chooser opened for all nearby devices, with both documented services requested as optional.",
      detail: { selectionMode: mode },
    });

    let selected: BrowerDeviceLike;
    try {
      selected = await bluetooth.requestDevice(requestDeviceOptions(mode));
    } catch (error) {
      if (!isCurrent(captured)) return;
      const { category, message } = failureMessageFor(error);
      if (category === "NotFoundError") {
        log({
          direction: "none",
          kind: "device_selection_cancelled",
          message: "No device was selected.",
          detail: { errorCategory: category },
        });
        update({ status: "idle", statusMessage: null, failure: null });
        return;
      }
      fail("device_selection_failed", message, { errorCategory: category });
      return;
    }

    if (!isCurrent(captured)) {
      // A stale chooser resolved after the view closed or a newer attempt started.
      // `requestDevice` does not connect, but release anything it may have left open.
      try {
        selected.gatt?.disconnect();
      } catch {
        // Best effort.
      }
      return;
    }

    device = selected;
    const deviceName = typeof selected.name === "string" && selected.name.length > 0 ? selected.name : null;
    update({
      status: "connecting",
      statusMessage: "Connecting to the selected device.",
      device: { name: deviceName, browserDeviceId: selected.id },
    });
    log({
      direction: "none",
      kind: "device_selected",
      message:
        "A device was selected. A plausible name does not confirm this is a TCi Timer — only the discovered services do.",
      detail: {
        deviceName: deviceName ?? "(no name reported)",
        browserDeviceId: selected.id,
      },
    });

    const gatt = selected.gatt;
    if (gatt === undefined) {
      fail(
        "gatt_unavailable",
        "The selected device exposes no GATT server, so it cannot be inspected."
      );
      releaseActiveConnection();
      update({ status: "failed" });
      return;
    }

    let connectedServer: BrowerGattServerLike;
    try {
      connectedServer = await gatt.connect();
    } catch (error) {
      if (!isCurrent(captured)) return;
      const { category, message } = failureMessageFor(error);
      fail("connect_failed", message, { errorCategory: category });
      releaseActiveConnection();
      update({ status: "failed", failure: message });
      return;
    }

    if (!isCurrent(captured)) {
      // Stale connect completed — release it rather than adopting it.
      releaseStaleServer(connectedServer);
      return;
    }

    server = connectedServer;
    const capturedDisconnectListener = () => handleUnexpectedDisconnect(captured);
    disconnectListener = capturedDisconnectListener;
    try {
      selected.addEventListener("gattserverdisconnected", capturedDisconnectListener);
    } catch {
      // Best effort: an environment without the listener still connects.
    }
    log({ direction: "none", kind: "connected", message: "GATT connection established." });

    const timingLookup = await lookupPrimaryService(
      connectedServer,
      BROWER_TIMING_SERVICE_UUID
    );
    if (!isCurrent(captured)) {
      releaseStaleServer(connectedServer);
      return;
    }

    if (timingLookup.outcome === "absent") {
      const message =
        "The documented Brower timing service was not found on this device. It may not be a TCi Timer.";
      log({
        direction: "none",
        kind: "service_absent",
        uuid: BROWER_TIMING_SERVICE_UUID,
        message,
      });
      releaseActiveConnection();
      update({ status: "failed", statusMessage: null, failure: message });
      return;
    }

    if (timingLookup.outcome === "failed") {
      // NOT "the service is missing". The query itself failed, so nothing at all is
      // established about whether this device exposes the timing service.
      const message =
        "Could not determine whether this device exposes the Brower timing service — the lookup failed. Nothing has been established about the device. Reconnect to try again.";
      log({
        direction: "none",
        kind: "service_discovery_failed",
        uuid: BROWER_TIMING_SERVICE_UUID,
        message,
        detail: {
          operation: "getPrimaryService",
          errorCategory: timingLookup.category,
        },
      });
      releaseActiveConnection();
      update({ status: "failed", statusMessage: null, failure: message });
      return;
    }

    const timingService = timingLookup.service;
    const services = emptyServices();

    // The enumerated instances are retained and reused for everything else this connect
    // needs them for. `null` means the enumeration FAILED — which is not the same as an
    // empty list, and must never be collapsed into one.
    let timingCharacteristicList: BrowerCharacteristicLike[] | null = null;
    let timingEnumerationFailureCategory: string | null = null;
    let serialCharacteristicList: BrowerCharacteristicLike[] | null = null;
    let serialEnumerationFailureCategory: string | null = null;

    const timingCharacteristics = await listCharacteristics(timingService);
    if (!isCurrent(captured)) {
      releaseStaleServer(connectedServer);
      return;
    }

    if (timingCharacteristics.outcome === "failed") {
      timingEnumerationFailureCategory = timingCharacteristics.category;
      services[0] = {
        ...services[0],
        discovery: "found",
        characteristicsEnumerated: false,
        discoveryFailureCategory: timingCharacteristics.category,
      };
      log({
        direction: "none",
        kind: "characteristic_enumeration_failed",
        uuid: BROWER_TIMING_SERVICE_UUID,
        message:
          "The timing service was found, but listing its characteristics failed. Which characteristics this device exposes is therefore unknown, not empty.",
        detail: {
          operation: "getCharacteristics",
          errorCategory: timingCharacteristics.category,
        },
      });
    } else {
      timingCharacteristicList = timingCharacteristics.characteristics;
      services[0] = describeListedService(services[0], timingCharacteristics.characteristics);
      log({
        direction: "none",
        kind: "service_discovered",
        uuid: BROWER_TIMING_SERVICE_UUID,
        message: "Timing service found and its characteristics enumerated.",
        detail: { characteristicCount: services[0].characteristics.length },
      });
    }

    const serialLookup = await lookupPrimaryService(
      connectedServer,
      BROWER_SERIAL_NUMBER_SERVICE_UUID
    );
    if (!isCurrent(captured)) {
      releaseStaleServer(connectedServer);
      return;
    }

    if (serialLookup.outcome === "absent") {
      // Genuine, confirmed absence of optional functionality — nonfatal, exactly as before.
      services[1] = { ...services[1], discovery: "absent" };
      log({
        direction: "none",
        kind: "service_absent",
        uuid: BROWER_SERIAL_NUMBER_SERVICE_UUID,
        message:
          "The optional Serial Number service is not exposed by this device. Everything else stays available.",
      });
    } else if (serialLookup.outcome === "failed") {
      // Nonfatal too — it is optional — but recorded as unknown, never as absent.
      services[1] = {
        ...services[1],
        discovery: "failed",
        discoveryFailureCategory: serialLookup.category,
      };
      log({
        direction: "none",
        kind: "service_discovery_failed",
        uuid: BROWER_SERIAL_NUMBER_SERVICE_UUID,
        message:
          "Could not determine whether this device exposes the optional Serial Number service — the lookup failed. Everything else stays available.",
        detail: { operation: "getPrimaryService", errorCategory: serialLookup.category },
      });
    } else {
      const serialCharacteristics = await listCharacteristics(serialLookup.service);
      if (!isCurrent(captured)) {
        releaseStaleServer(connectedServer);
        return;
      }
      if (serialCharacteristics.outcome === "failed") {
        serialEnumerationFailureCategory = serialCharacteristics.category;
        services[1] = {
          ...services[1],
          discovery: "found",
          characteristicsEnumerated: false,
          discoveryFailureCategory: serialCharacteristics.category,
        };
        log({
          direction: "none",
          kind: "characteristic_enumeration_failed",
          uuid: BROWER_SERIAL_NUMBER_SERVICE_UUID,
          message:
            "The Serial Number service was found, but listing its characteristics failed. Everything else stays available.",
          detail: {
            operation: "getCharacteristics",
            errorCategory: serialCharacteristics.category,
          },
        });
      } else {
        serialCharacteristicList = serialCharacteristics.characteristics;
        services[1] = describeListedService(services[1], serialCharacteristics.characteristics);
        log({
          direction: "none",
          kind: "service_discovered",
          uuid: BROWER_SERIAL_NUMBER_SERVICE_UUID,
          message: "Serial Number service found and its characteristics enumerated.",
          detail: { characteristicCount: services[1].characteristics.length },
        });
      }
    }

    // Resolved from the enumeration that already succeeded above — NOT by asking the
    // device a second time. A separate `getCharacteristics` round-trip can fail on its
    // own, and the previous code discarded that failure (`outcome === "found" ? c : null`),
    // leaving a connected session whose Athlete Data handle was silently null while the
    // services list still advertised the characteristic: Start Listening looked
    // available and did nothing. Reusing the instances removes that failure mode by
    // construction rather than catching it after the fact.
    let athleteDataDiscovery: BrowerServiceDiscoveryState;
    if (timingCharacteristicList === null) {
      // The enumeration failed, so whether this device exposes Athlete Data is unknown.
      athleteDataDiscovery = "failed";
      athleteDataCharacteristic = null;
      log({
        direction: "none",
        kind: "characteristic_discovery_failed",
        uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
        message:
          "Could not determine whether this device exposes the Athlete Data characteristic — the timing service's characteristics could not be listed. Subscribing is unavailable until discovery succeeds.",
        detail: {
          operation: "getCharacteristics",
          errorCategory: timingEnumerationFailureCategory ?? "unknown_error",
        },
      });
    } else {
      const match = timingCharacteristicList.find(
        (entry) => entry.uuid.toLowerCase() === BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID
      );
      athleteDataCharacteristic = match ?? null;
      athleteDataDiscovery = match === undefined ? "absent" : "found";
      if (match === undefined) {
        log({
          direction: "none",
          kind: "characteristic_absent",
          uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
          message:
            "Athlete Data is not exposed by this device, so no subscription is possible.",
        });
      }
    }

    const discoveryIncomplete =
      services.some((service) => service.discoveryFailureCategory !== null) ||
      athleteDataDiscovery === "failed";

    services.forEach((service) => {
      service.characteristics.forEach((characteristic) => {
        log({
          direction: "none",
          kind: "characteristic_discovered",
          uuid: characteristic.uuid,
          message:
            characteristic.label === null
              ? "A characteristic the manufacturer document does not name. No meaning is assigned to it."
              : `${characteristic.label} characteristic found.`,
          detail: {
            read: characteristic.properties.read,
            write: characteristic.properties.write,
            writeWithoutResponse: characteristic.properties.writeWithoutResponse,
            notify: characteristic.properties.notify,
            indicate: characteristic.properties.indicate,
          },
        });
      });
    });

    update({
      status: "connected",
      statusMessage: "Connected.",
      failure: discoveryIncomplete
        ? "Some of this device could not be inspected — see the services below. What is shown is a partial picture, not a complete inspection. Reconnect to try again."
        : null,
      services,
      discoveryIncomplete,
      athleteDataDiscovery,
    });

    // Documented readable characteristics, read once on connect — again from the
    // enumerations already performed, so the initial connect asks each service for its
    // characteristics exactly once. Reads are attempted only where the DISCOVERED
    // properties actually allow a read.
    await readFromEnumeration(
      captured,
      timingCharacteristicList,
      timingEnumerationFailureCategory,
      BROWER_TIME_BASE_CHARACTERISTIC_UUID
    );
    await readFromEnumeration(
      captured,
      timingCharacteristicList,
      timingEnumerationFailureCategory,
      BROWER_POWER_ON_COUNTER_CHARACTERISTIC_UUID
    );
    if (serialLookup.outcome === "found") {
      await readFromEnumeration(
        captured,
        serialCharacteristicList,
        serialEnumerationFailureCategory,
        BROWER_SERIAL_NUMBER_CHARACTERISTIC_UUID
      );
    }
  }

  /** Records a failed characteristic discovery identically wherever it is detected. */
  function reportCharacteristicDiscoveryFailure(uuid: string, category: string) {
    const label = browerCharacteristicLabel(uuid);
    const message = `Could not determine whether ${label ?? "this characteristic"} is exposed by this device — the lookup failed.`;
    log({
      direction: "none",
      kind: "characteristic_discovery_failed",
      uuid,
      message,
      detail: { operation: "getCharacteristics", errorCategory: category },
    });
    markDiscoveryIncomplete();
    update({ failure: message });
  }

  /**
   * Reads a characteristic resolved from an enumeration that has ALREADY been performed.
   * `characteristics === null` means that enumeration failed, which is reported as an
   * unanswered question — never as the characteristic being absent.
   */
  async function readFromEnumeration(
    captured: number,
    characteristics: BrowerCharacteristicLike[] | null,
    enumerationFailureCategory: string | null,
    uuid: string
  ): Promise<void> {
    if (!isCurrent(captured)) return;
    if (characteristics === null) {
      reportCharacteristicDiscoveryFailure(
        uuid,
        enumerationFailureCategory ?? "unknown_error"
      );
      return;
    }
    const match = characteristics.find((entry) => entry.uuid.toLowerCase() === uuid);
    if (match === undefined) {
      log({
        direction: "none",
        kind: "characteristic_absent",
        uuid,
        message: `${browerCharacteristicLabel(uuid) ?? "This characteristic"} is not exposed by this device.`,
      });
      return;
    }
    await readCharacteristicInstance(captured, match, uuid);
  }

  async function readIfReadable(
    captured: number,
    service: BrowerServiceLike,
    uuid: string
  ): Promise<void> {
    if (!isCurrent(captured)) return;
    const lookup = await lookupCharacteristic(service, uuid);
    if (!isCurrent(captured)) return;

    if (lookup.outcome === "failed") {
      // The enumeration errored, so this says nothing about whether the characteristic
      // exists. Reported as an unanswered question, never as absence.
      reportCharacteristicDiscoveryFailure(uuid, lookup.category);
      return;
    }
    if (lookup.outcome === "absent") {
      log({
        direction: "none",
        kind: "characteristic_absent",
        uuid,
        message: `${browerCharacteristicLabel(uuid) ?? "This characteristic"} is not exposed by this device.`,
      });
      return;
    }
    await readCharacteristicInstance(captured, lookup.characteristic, uuid);
  }

  async function readCharacteristicInstance(
    captured: number,
    characteristic: BrowerCharacteristicLike,
    uuid: string
  ): Promise<void> {
    if (!isCurrent(captured)) return;
    const label = browerCharacteristicLabel(uuid);
    if (!observedProperties(characteristic).read) {
      log({
        direction: "none",
        kind: "characteristic_not_readable",
        uuid,
        message: `${label ?? "This characteristic"} does not advertise the read property, so it was not read.`,
      });
      return;
    }

    let value: DataView;
    try {
      value = await characteristic.readValue();
    } catch (error) {
      if (!isCurrent(captured)) return;
      const { category, message } = failureMessageFor(error);
      log({
        direction: "none",
        kind: "characteristic_read_failed",
        uuid,
        message,
        detail: { errorCategory: category },
      });
      return;
    }
    if (!isCurrent(captured)) return;
    if (!isDataViewLike(value)) return;

    const bytes = copyBytesFromDataView(value);
    const observation: BrowerRawObservation = {
      id: nextObservationId(),
      uuid,
      label,
      hex: formatHexBytes(bytes),
      byteLength: bytes.byteLength,
      at: now().toISOString(),
    };
    update({
      reads: [observation, ...snapshot.reads].slice(0, BROWER_MAX_DISPLAYED_READS),
    });
    log({
      direction: "rx",
      kind: "characteristic_read",
      uuid,
      message:
        "Raw bytes, preserved exactly as read. No numeric interpretation has been applied.",
      payload: buildLogPayload(bytes),
    });
  }

  async function runReadCharacteristic(uuid: string): Promise<void> {
    const captured = generation;
    if (server === null || snapshot.status !== "connected") return;
    const serviceUuid =
      uuid === BROWER_SERIAL_NUMBER_CHARACTERISTIC_UUID
        ? BROWER_SERIAL_NUMBER_SERVICE_UUID
        : BROWER_TIMING_SERVICE_UUID;
    const lookup = await lookupPrimaryService(server, serviceUuid);
    if (!isCurrent(captured)) return;

    if (lookup.outcome === "failed") {
      const message =
        "Could not re-open the service for this read — the lookup failed. Nothing has been established about the characteristic.";
      log({
        direction: "none",
        kind: "service_discovery_failed",
        uuid: serviceUuid,
        message,
        detail: { operation: "getPrimaryService", errorCategory: lookup.category },
      });
      markDiscoveryIncomplete();
      update({ failure: message });
      return;
    }
    if (lookup.outcome === "absent") {
      log({
        direction: "none",
        kind: "service_absent",
        uuid: serviceUuid,
        message: "This service is not exposed by the device, so the read was not attempted.",
      });
      return;
    }
    await readIfReadable(captured, lookup.service, uuid);
  }

  async function runStartNotifications(): Promise<void> {
    const captured = generation;
    const characteristic = athleteDataCharacteristic;
    if (snapshot.status !== "connected") return;
    if (characteristic === null) {
      // Never fail silently here. The view already disables the control in this state,
      // but the controller must not depend on the view to stay honest: a request it
      // cannot serve is reported, and the reason distinguishes an unanswered discovery
      // from a confirmed absence.
      const message =
        snapshot.athleteDataDiscovery === "failed"
          ? "Cannot subscribe: whether this device exposes the Athlete Data characteristic is unknown, because discovery failed. Reconnect to try again."
          : "Cannot subscribe: this device does not expose the Athlete Data characteristic.";
      log({
        direction: "none",
        kind: "notifications_unavailable",
        uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
        message,
        detail: { athleteDataDiscovery: snapshot.athleteDataDiscovery },
      });
      update({ failure: message });
      return;
    }
    // Exactly one listener per subscription — a repeated Start is a no-op, never a
    // second registration.
    if (notificationListener !== null) return;

    const properties = observedProperties(characteristic);
    if (!properties.notify && !properties.indicate) {
      const message =
        "The Athlete Data characteristic does not advertise notify or indicate, so no subscription was attempted.";
      log({
        direction: "none",
        kind: "notifications_unsupported",
        uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
        message,
      });
      update({ failure: message });
      return;
    }

    const listener = (event: Event) => handleNotificationEvent(captured, event);
    // Registered before starting, so a notification delivered immediately on start is
    // not missed. Removed again if the start fails or the generation moved on.
    notificationListener = listener;
    try {
      characteristic.addEventListener("characteristicvaluechanged", listener);
    } catch {
      notificationListener = null;
      return;
    }

    try {
      await characteristic.startNotifications();
    } catch (error) {
      const { category, message } = failureMessageFor(error);
      try {
        characteristic.removeEventListener("characteristicvaluechanged", listener);
      } catch {
        // Best effort.
      }
      if (notificationListener === listener) notificationListener = null;
      if (!isCurrent(captured)) return;
      log({
        direction: "none",
        kind: "notifications_failed",
        uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
        message,
        detail: { errorCategory: category },
      });
      update({ failure: message });
      return;
    }

    if (!isCurrent(captured)) {
      // Released while the subscription was starting — undo it rather than leaving an
      // orphaned subscription on a connection nobody owns any more.
      try {
        characteristic.removeEventListener("characteristicvaluechanged", listener);
      } catch {
        // Best effort.
      }
      try {
        void Promise.resolve(characteristic.stopNotifications()).catch(NOOP);
      } catch {
        // Best effort.
      }
      return;
    }

    update({ notificationsActive: true, failure: null });
    log({
      direction: "none",
      kind: "notifications_started",
      uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
      message: "Subscribed to Athlete Data notifications.",
    });
  }

  async function runStopNotifications(): Promise<void> {
    const captured = generation;
    const characteristic = athleteDataCharacteristic;
    const listener = notificationListener;
    if (characteristic === null || listener === null) return;

    notificationListener = null;
    try {
      characteristic.removeEventListener("characteristicvaluechanged", listener);
    } catch {
      // Best effort.
    }
    try {
      await characteristic.stopNotifications();
    } catch {
      // Best effort: the listener is already gone, so no further bytes are recorded.
    }
    if (!isCurrent(captured)) return;
    update({ notificationsActive: false });
    log({
      direction: "none",
      kind: "notifications_stopped",
      uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
      message: "Stopped listening for Athlete Data notifications.",
    });
  }

  function openObservationWindow(captured: number) {
    clearObservationWindow();
    update({ observationWindowActive: true });
    log({
      direction: "none",
      kind: "observation_window_opened",
      message: `Diagnostic observation window opened for ${BROWER_OBSERVATION_WINDOW_MS} ms.`,
      detail: { windowMs: BROWER_OBSERVATION_WINDOW_MS },
    });
    observationTimer = setTimeout(() => {
      observationTimer = null;
      if (!isCurrent(captured)) return;
      update({ observationWindowActive: false });
      log({
        direction: "none",
        kind: "observation_window_closed",
        message:
          "Diagnostic observation window closed. This is a fixed timeout, not proof that every device reply has arrived. Any later notification is still recorded as an uncorrelated observation.",
      });
    }, BROWER_OBSERVATION_WINDOW_MS);
  }

  function resolveWriteMethod(
    characteristic: BrowerCharacteristicLike
  ): { name: "writeValueWithResponse" | "writeValueWithoutResponse"; write: (bytes: Uint8Array) => Promise<void> } | null {
    const properties = observedProperties(characteristic);
    if (properties.write && typeof characteristic.writeValueWithResponse === "function") {
      const method = characteristic.writeValueWithResponse.bind(characteristic);
      return { name: "writeValueWithResponse", write: (bytes) => method(bytes) };
    }
    if (
      properties.writeWithoutResponse &&
      typeof characteristic.writeValueWithoutResponse === "function"
    ) {
      const method = characteristic.writeValueWithoutResponse.bind(characteristic);
      return { name: "writeValueWithoutResponse", write: (bytes) => method(bytes) };
    }
    return null;
  }

  async function sendAthleteDataRequest(
    request: BrowerAthleteDataRequest
  ): Promise<BrowerRequestOutcome> {
    const characteristic = athleteDataCharacteristic;
    if (snapshot.status !== "connected" || characteristic === null) {
      return { accepted: false, reason: "Connect to the timer before sending a request." };
    }
    if (!snapshot.notificationsActive) {
      return {
        accepted: false,
        reason:
          "Subscribe to Athlete Data notifications first — replies arrive only through that subscription.",
      };
    }
    if (snapshot.observationWindowActive || retrievalRequestPending) {
      return {
        accepted: false,
        reason: "The previous observation window is still open. Wait for it to close.",
      };
    }
    if (request.byteOrder !== "little-endian" && request.byteOrder !== "big-endian") {
      return { accepted: false, reason: "Select a byte-order hypothesis before sending." };
    }
    const validation = validateAthleteDataRequestRange(request.startAddress, request.stopAddress);
    if (!validation.valid) {
      return { accepted: false, reason: validation.reason };
    }
    const writeMethod = resolveWriteMethod(characteristic);
    if (writeMethod === null) {
      return {
        accepted: false,
        reason:
          "The Athlete Data characteristic advertises no supported write property, so no command was sent.",
      };
    }

    const bytes = buildAthleteDataRequestCommand(request);
    retrievalRequestPending = true;
    // Captured at submission time, so a release between submission and execution
    // cancels the write instead of sending it on a stale connection.
    const captured = generation;

    await enqueue(async () => {
      if (!isCurrent(captured)) {
        retrievalRequestPending = false;
        return;
      }
      try {
        await writeMethod.write(bytes);
      } catch (error) {
        retrievalRequestPending = false;
        if (!isCurrent(captured)) return;
        const { category, message } = failureMessageFor(error);
        log({
          direction: "tx",
          kind: "command_write_failed",
          uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
          message,
          payload: buildLogPayload(bytes),
          detail: {
            commandType: "0x01 athlete data request",
            byteOrderHypothesis: request.byteOrder,
            startAddress: request.startAddress,
            stopAddress: request.stopAddress,
            writeMethod: writeMethod.name,
            errorCategory: category,
          },
        });
        update({ failure: message });
        return;
      }
      retrievalRequestPending = false;
      if (!isCurrent(captured)) return;
      log({
        direction: "tx",
        kind: "command_write",
        uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
        message:
          "Athlete-data request written. The byte order below is an unverified hypothesis, so the device may have addressed a different range than intended.",
        payload: buildLogPayload(bytes),
        detail: {
          commandType: "0x01 athlete data request",
          byteOrderHypothesis: request.byteOrder,
          startAddress: request.startAddress,
          stopAddress: request.stopAddress,
          writeMethod: writeMethod.name,
        },
      });
      update({ failure: null });
      openObservationWindow(captured);
    });

    return { accepted: true };
  }

  async function disconnect(): Promise<void> {
    if (device === null && server === null) return;
    update({ status: "disconnecting", statusMessage: "Disconnecting." });
    log({ direction: "none", kind: "disconnect_requested", message: "Disconnect requested." });
    releaseActiveConnection();
    update({ status: "disconnected", statusMessage: null, failure: null });
    log({ direction: "none", kind: "disconnected", message: "Disconnected." });
  }

  if (!support.supported) {
    logSequence += 1;
    snapshot = {
      ...snapshot,
      log: appendLogEntry(
        snapshot.log,
        {
          direction: "none",
          kind: "browser_capability",
          message:
            support.reason === "insecure-context"
              ? "This page is not a secure context, so Web Bluetooth is unavailable."
              : "This browser does not expose Web Bluetooth.",
          detail: { reason: support.reason },
        },
        logSequence,
        now().toISOString()
      ),
    };
  }

  return {
    getSnapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    connect: (mode) => enqueueForGeneration(() => runConnect(mode)),
    disconnect,
    readCharacteristic: (uuid) => enqueueForGeneration(() => runReadCharacteristic(uuid)),
    startNotifications: () => enqueueForGeneration(runStartNotifications),
    stopNotifications: () => enqueueForGeneration(runStopNotifications),
    sendAthleteDataRequest,
    clearLog() {
      // Clears only this in-memory diagnostic log. It never touches the timer's own
      // memory, and there is nothing persisted to clear.
      update({ log: createEmptyDiagnosticLog() });
    },
    release: releaseActiveConnection,
  };
}
