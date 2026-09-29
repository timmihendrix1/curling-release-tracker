// Test doubles for the injected boundaries.
//
// These implement `NativeBleTransport` and `ProbeExportTarget` and are handed to the
// controller by a test. They are never reachable from the device path: `main.ts`
// constructs the Capacitor implementations and nothing else, so no build that runs on
// an iPhone contains a route to any of this.
//
// Everything they prove is about THIS APPLICATION's lifecycle and bookkeeping. None of
// it is evidence about Brower firmware.
import {
  BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
  BROWER_POWER_ON_COUNTER_CHARACTERISTIC_UUID,
  BROWER_SERIAL_NUMBER_CHARACTERISTIC_UUID,
  BROWER_SERIAL_NUMBER_SERVICE_UUID,
  BROWER_TIME_BASE_CHARACTERISTIC_UUID,
  BROWER_TIMING_SERVICE_UUID,
} from "../probe/browerProtocol";
import type {
  NativeBleTransport,
  NativeDevice,
  NativeSelectionRequest,
  NativeService,
} from "../probe/transport";
import type { ProbeExportOutcome, ProbeExportTarget } from "../probe/exportTarget";
import type { AppLifecycleSource } from "../probe/appLifecycle";

export function deferred<T>(): {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
} {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function timingServiceOnly(): NativeService[] {
  return [
    {
      uuid: BROWER_TIMING_SERVICE_UUID,
      characteristics: [
        {
          uuid: BROWER_POWER_ON_COUNTER_CHARACTERISTIC_UUID,
          properties: {
            read: true,
            write: false,
            writeWithoutResponse: false,
            notify: false,
            indicate: false,
          },
        },
        {
          uuid: BROWER_ATHLETE_DATA_CHARACTERISTIC_UUID,
          properties: {
            read: false,
            write: true,
            writeWithoutResponse: false,
            notify: true,
            indicate: false,
          },
        },
        {
          uuid: BROWER_TIME_BASE_CHARACTERISTIC_UUID,
          properties: {
            read: true,
            write: false,
            writeWithoutResponse: false,
            notify: false,
            indicate: false,
          },
        },
      ],
    },
  ];
}

/** Both documented services, as the device observed on 2026-09-25 presented them. */
export function bothDocumentedServices(): NativeService[] {
  return [
    ...timingServiceOnly(),
    {
      uuid: BROWER_SERIAL_NUMBER_SERVICE_UUID,
      characteristics: [
        {
          uuid: BROWER_SERIAL_NUMBER_CHARACTERISTIC_UUID,
          properties: {
            read: true,
            write: false,
            writeWithoutResponse: false,
            notify: false,
            indicate: false,
          },
        },
      ],
    },
  ];
}

export type FakeTransportScript = {
  initialize?: () => Promise<void>;
  isEnabled?: () => Promise<boolean>;
  requestDevice?: (request: NativeSelectionRequest) => Promise<NativeDevice>;
  connect?: (deviceId: string) => Promise<void>;
  disconnect?: (deviceId: string) => Promise<void>;
  getServices?: (deviceId: string) => Promise<NativeService[]>;
  read?: (service: string, characteristic: string) => Promise<DataView>;
  startNotifications?: (service: string, characteristic: string) => Promise<void>;
  stopNotifications?: (service: string, characteristic: string) => Promise<void>;
  /**
   * Fails the FIRST half of `BleClient.stopNotifications` — removing the JS event
   * listener — before its map entry is deleted and before the native stop is reached.
   * Distinct from `stopNotifications`, which fails the second half.
   */
  removeListener?: (service: string, characteristic: string) => Promise<void>;
};

export type FakeTransport = NativeBleTransport & {
  calls: { name: string; args: string[] }[];
  /** Delivers one notification through the callback the controller registered. */
  emitNotification(value: DataView): void;
  /**
   * Delivers one notification through EVERY callback ever registered, including after
   * `stopNotifications`. This models the real race the controller has to survive: the
   * native bridge had already dispatched a value when the unsubscribe landed, so the
   * callback still fires once for a connection that has ended.
   */
  emitLateNotification(value: DataView): void;
  /**
   * Delivers one notification through ONE specific registration, identified by the
   * order in which `startNotifications` was called (0-based).
   *
   * Needed to model a late dispatch from an EARLIER subscription while a later one is
   * running on the same connection: firing every callback would also fire the current
   * subscription's, which is a different scenario.
   */
  emitFromSubscription(registrationIndex: number, value: DataView): void;
  /** Invokes the disconnect callback the controller registered with `connect`. */
  dropConnection(): void;
  subscriptionCount(): number;
  notificationCallbackCount(): number;
  /**
   * Keys for which the plugin's JS event listener is still registered — i.e. keys that
   * can still deliver a callback into the controller.
   *
   * The real `BleClient.startNotifications` registers this listener BEFORE awaiting
   * the native start, so a failed start still leaves one behind.
   * `BleClient.stopNotifications` removes it and deletes its map entry BEFORE awaiting
   * the native stop, so a rejected native stop does NOT mean the listener survived.
   * Both orderings are reproduced here.
   */
  nativeListenerKeys(): string[];
  /**
   * Keys for which the PERIPHERAL is still notifying — the other half of a
   * subscription, which the native stop is what actually ends.
   *
   * Tracked separately from the JS listener because the two fail independently: a
   * native stop can reject after the JS listener has already been removed.
   */
  nativeSubscriptionKeys(): string[];
  /** Peripheral ids the fake currently considers connected. */
  connectedPeripheralIds(): string[];
};

export function createFakeTransport(script: FakeTransportScript = {}): FakeTransport {
  const calls: { name: string; args: string[] }[] = [];
  let notificationCallbacks: ((value: DataView) => void)[] = [];
  const everRegisteredCallbacks: ((value: DataView) => void)[] = [];
  // Mirrors the plugin's own `eventListeners` map, keyed the same way.
  const nativeListeners = new Map<string, (value: DataView) => void>();
  const nativeSubscriptions = new Set<string>();
  const subscriptions = new Set<string>();
  let disconnectCallback: ((deviceId: string) => void) | null = null;
  let connectedId: string | null = null;
  const connectedIds = new Set<string>();

  function note(name: string, ...args: string[]): void {
    calls.push({ name, args });
  }

  return {
    calls,
    emitNotification(value: DataView) {
      for (const callback of [...notificationCallbacks]) callback(value);
    },
    emitLateNotification(value: DataView) {
      for (const callback of [...everRegisteredCallbacks]) callback(value);
    },
    emitFromSubscription(registrationIndex: number, value: DataView) {
      const callback = everRegisteredCallbacks[registrationIndex];
      if (callback === undefined) {
        throw new Error(`No subscription was registered at index ${String(registrationIndex)}.`);
      }
      callback(value);
    },
    dropConnection() {
      const id = connectedId;
      const callback = disconnectCallback;
      connectedId = null;
      if (callback !== null && id !== null) callback(id);
    },
    subscriptionCount: () => subscriptions.size,
    notificationCallbackCount: () => notificationCallbacks.length,
    nativeListenerKeys: () => [...nativeListeners.keys()],
    nativeSubscriptionKeys: () => [...nativeSubscriptions],
    connectedPeripheralIds: () => [...connectedIds],

    async initialize() {
      note("initialize");
      if (script.initialize) await script.initialize();
    },
    isEnabled() {
      note("isEnabled");
      return script.isEnabled ? script.isEnabled() : Promise.resolve(true);
    },
    async requestDevice(request) {
      note("requestDevice", request.services.join(","));
      if (script.requestDevice) return script.requestDevice(request);
      return { deviceId: "peripheral-1", name: "BROWER TCi CH 0" };
    },
    async connect(deviceId, onDisconnect) {
      note("connect", deviceId);
      if (script.connect) await script.connect(deviceId);
      connectedId = deviceId;
      connectedIds.add(deviceId);
      disconnectCallback = onDisconnect;
    },
    async disconnect(deviceId) {
      note("disconnect", deviceId);
      if (connectedId === deviceId) connectedId = null;
      connectedIds.delete(deviceId);
      disconnectCallback = null;
      if (script.disconnect) await script.disconnect(deviceId);
    },
    async getServices(deviceId) {
      note("getServices", deviceId);
      if (script.getServices) return script.getServices(deviceId);
      return bothDocumentedServices();
    },
    async read(_deviceId, service, characteristic) {
      note("read", service, characteristic);
      if (script.read) return script.read(service, characteristic);
      return new DataView(new Uint8Array([0x00, 0x2b, 0x0d, 0xa2]).buffer);
    },
    // Mirrors BleClient.startNotifications:
    //   remove any existing listener for the key → addListener → set map entry →
    //   await the native start.
    // The listener therefore exists before the native call, so a start that then
    // fails still leaves one behind.
    async startNotifications(deviceId, service, characteristic, callback) {
      note("startNotifications", service, characteristic);
      const key = `${deviceId}|${service}|${characteristic}`;
      // A second start for the same key REPLACES the first registration.
      nativeListeners.set(key, callback);
      notificationCallbacks.push(callback);
      everRegisteredCallbacks.push(callback);
      if (script.startNotifications) await script.startNotifications(service, characteristic);
      nativeSubscriptions.add(key);
      subscriptions.add(`${service}|${characteristic}`);
    },
    // Mirrors BleClient.stopNotifications, in its real order:
    //   await listener.remove() → delete the map entry → await the native stop.
    // The consequence the controller has to respect: a rejection from the native stop
    // does NOT establish that the JS listener survived — by then it is already gone.
    async stopNotifications(deviceId, service, characteristic) {
      note("stopNotifications", service, characteristic);
      const key = `${deviceId}|${service}|${characteristic}`;
      // Step 1: remove the JS event listener. If THIS fails, the map entry is not
      // deleted and the native stop is never reached, so the listener really does
      // remain registered.
      if (script.removeListener) await script.removeListener(service, characteristic);
      const removed = nativeListeners.get(key);
      nativeListeners.delete(key);
      if (removed !== undefined) {
        notificationCallbacks = notificationCallbacks.filter(
          (candidate) => candidate !== removed
        );
      }
      // Step 2: stop the peripheral notifying. A failure here leaves the JS listener
      // already removed.
      if (script.stopNotifications) await script.stopNotifications(service, characteristic);
      nativeSubscriptions.delete(key);
      subscriptions.delete(`${service}|${characteristic}`);
    },
  };
}

export type FakeExportTarget = ProbeExportTarget & {
  calls: { fileName: string; content: string }[];
};

export function createFakeExportTarget(
  behaviour: (fileName: string) => ProbeExportOutcome | Promise<ProbeExportOutcome> = (
    fileName
  ) => ({ kind: "shared", fileName })
): FakeExportTarget {
  const calls: { fileName: string; content: string }[] = [];
  return {
    calls,
    async exportJson(fileName, content) {
      calls.push({ fileName, content });
      return behaviour(fileName);
    },
  };
}

export function createFakeLifecycle(): AppLifecycleSource & {
  setActive(isActive: boolean): void;
  listenerCount(): number;
} {
  let listeners: ((isActive: boolean) => void)[] = [];
  return {
    onActiveStateChange(listener) {
      listeners = [...listeners, listener];
      return () => {
        listeners = listeners.filter((candidate) => candidate !== listener);
      };
    },
    setActive(isActive) {
      for (const listener of [...listeners]) listener(isActive);
    },
    listenerCount: () => listeners.length,
  };
}

/** A clock that advances by one second per reading, so ordering is stable in tests. */
export function createStepClock(startMs = Date.UTC(2026, 8, 27, 9, 0, 0)): () => Date {
  let current = startMs;
  return () => {
    const value = new Date(current);
    current += 1000;
    return value;
  };
}
