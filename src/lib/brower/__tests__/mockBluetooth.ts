// A controllable in-memory stand-in for the Web Bluetooth surface the Brower
// diagnostic controller uses (`src/lib/brower/webBluetooth.ts`).
//
// IMPORTANT: every byte sequence produced here is SYNTHETIC. These mocks prove the
// controller's own lifecycle, serialization, validation and logging behaviour. They are
// not evidence of how a real Brower TCi Timer behaves, and no packet emitted by them
// may be cited as a protocol observation.
import type {
  BrowerBluetoothLike,
  BrowerCharacteristicLike,
  BrowerCharacteristicPropertiesLike,
  BrowerDeviceLike,
  BrowerGattServerLike,
  BrowerRequestDeviceOptions,
  BrowerServiceLike,
} from "../webBluetooth";

export type Deferred<T> = {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
};

export function deferred<T>(): Deferred<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

export function domException(name: string): { name: string; message: string } {
  return { name, message: `synthetic ${name}` };
}

export type MockCharacteristicOptions = {
  uuid: string;
  properties?: BrowerCharacteristicPropertiesLike;
  /** Consumed in order; the last value repeats once exhausted. */
  readValues?: Uint8Array[];
  readError?: unknown;
  startNotificationsError?: unknown;
  writeError?: unknown;
  omitWriteWithResponseMethod?: boolean;
  omitWriteWithoutResponseMethod?: boolean;
};

export type MockCharacteristic = BrowerCharacteristicLike & {
  listeners: ((event: Event) => void)[];
  writeCalls: { method: "withResponse" | "withoutResponse"; bytes: number[] }[];
  startNotificationsCallCount: number;
  stopNotificationsCallCount: number;
  readCallCount: number;
  /** Dispatches one synthetic notification to every currently registered listener. */
  emitNotification(bytes: Uint8Array): void;
  /** Dispatches a notification whose underlying buffer is REUSED for the next emit. */
  emitNotificationFromSharedBuffer(bytes: Uint8Array): void;
};

export function createMockCharacteristic(
  options: MockCharacteristicOptions
): MockCharacteristic {
  const listeners: ((event: Event) => void)[] = [];
  const readValues = options.readValues ?? [new Uint8Array([0x01, 0x02, 0x03, 0x04])];
  // One shared buffer, deliberately reused by emitNotificationFromSharedBuffer so a
  // test can prove the controller copies bytes at receipt time.
  const sharedBuffer = new Uint8Array(20);

  function dispatch(view: DataView) {
    const event = { target: { value: view } } as unknown as Event;
    [...listeners].forEach((listener) => listener(event));
  }

  const characteristic: MockCharacteristic = {
    uuid: options.uuid,
    properties: options.properties ?? { read: true, write: true, notify: true },
    listeners,
    writeCalls: [],
    startNotificationsCallCount: 0,
    stopNotificationsCallCount: 0,
    readCallCount: 0,
    async readValue() {
      characteristic.readCallCount += 1;
      if (options.readError !== undefined) throw options.readError;
      const index = Math.min(characteristic.readCallCount - 1, readValues.length - 1);
      const bytes = readValues[index];
      return new DataView(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength));
    },
    async startNotifications() {
      characteristic.startNotificationsCallCount += 1;
      if (options.startNotificationsError !== undefined) throw options.startNotificationsError;
      return characteristic;
    },
    async stopNotifications() {
      characteristic.stopNotificationsCallCount += 1;
      return characteristic;
    },
    addEventListener(_type, listener) {
      listeners.push(listener);
    },
    removeEventListener(_type, listener) {
      const index = listeners.indexOf(listener);
      if (index >= 0) listeners.splice(index, 1);
    },
    emitNotification(bytes) {
      dispatch(new DataView(bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)));
    },
    emitNotificationFromSharedBuffer(bytes) {
      sharedBuffer.fill(0);
      sharedBuffer.set(bytes.subarray(0, sharedBuffer.length));
      dispatch(new DataView(sharedBuffer.buffer, 0, bytes.byteLength));
    },
  };

  if (options.omitWriteWithResponseMethod !== true) {
    characteristic.writeValueWithResponse = async (value: Uint8Array) => {
      if (options.writeError !== undefined) throw options.writeError;
      characteristic.writeCalls.push({ method: "withResponse", bytes: Array.from(value) });
    };
  }
  if (options.omitWriteWithoutResponseMethod !== true) {
    characteristic.writeValueWithoutResponse = async (value: Uint8Array) => {
      if (options.writeError !== undefined) throw options.writeError;
      characteristic.writeCalls.push({ method: "withoutResponse", bytes: Array.from(value) });
    };
  }

  return characteristic;
}

export type MockService = BrowerServiceLike & {
  characteristics: MockCharacteristic[];
  getCharacteristicsCallCount: number;
};

export type MockServiceOptions = {
  /** When set, `getCharacteristics()` rejects with this instead of returning a list. */
  getCharacteristicsError?: unknown;
};

export function createMockService(
  uuid: string,
  characteristics: MockCharacteristic[],
  options: MockServiceOptions = {}
): MockService {
  const service: MockService = {
    uuid,
    characteristics,
    getCharacteristicsCallCount: 0,
    async getCharacteristics() {
      service.getCharacteristicsCallCount += 1;
      if (options.getCharacteristicsError !== undefined) {
        throw options.getCharacteristicsError;
      }
      return characteristics;
    },
  };
  return service;
}

export type MockGattServer = BrowerGattServerLike & {
  connectCallCount: number;
  disconnectCallCount: number;
};

export type MockDevice = BrowerDeviceLike & {
  gatt: MockGattServer;
  disconnectListeners: (() => void)[];
  /** Simulates the platform reporting an unexpected disconnect. */
  emitUnexpectedDisconnect(): void;
};

export type MockDeviceOptions = {
  id?: string;
  name?: string | null;
  services?: MockService[];
  connectError?: unknown;
  /** When supplied, `connect()` waits on this instead of resolving immediately. */
  connectGate?: Promise<void>;
  omitGatt?: boolean;
  /**
   * Per-service-UUID errors thrown by `getPrimaryService`. Distinct from simply
   * omitting the service, which produces the platform's NotFoundError and therefore
   * means confirmed absence.
   */
  getPrimaryServiceErrors?: Record<string, unknown>;
};

export function createMockDevice(options: MockDeviceOptions = {}): MockDevice {
  const services = options.services ?? [];
  const disconnectListeners: (() => void)[] = [];

  const server: MockGattServer = {
    connected: false,
    connectCallCount: 0,
    disconnectCallCount: 0,
    async connect() {
      server.connectCallCount += 1;
      if (options.connectGate !== undefined) await options.connectGate;
      if (options.connectError !== undefined) throw options.connectError;
      server.connected = true;
      return server;
    },
    disconnect() {
      server.disconnectCallCount += 1;
      server.connected = false;
    },
    async getPrimaryService(uuid: string) {
      const failure = options.getPrimaryServiceErrors?.[uuid];
      if (failure !== undefined) throw failure;
      const match = services.find((service) => service.uuid === uuid);
      if (match === undefined) throw domException("NotFoundError");
      return match;
    },
  };

  const device: MockDevice = {
    id: options.id ?? "mock-browser-device-id",
    name: options.name === undefined ? "TCi Timer" : options.name,
    gatt: server,
    disconnectListeners,
    addEventListener(_type, listener) {
      disconnectListeners.push(listener);
    },
    removeEventListener(_type, listener) {
      const index = disconnectListeners.indexOf(listener);
      if (index >= 0) disconnectListeners.splice(index, 1);
    },
    emitUnexpectedDisconnect() {
      server.connected = false;
      [...disconnectListeners].forEach((listener) => listener());
    },
  };

  if (options.omitGatt === true) {
    delete (device as { gatt?: unknown }).gatt;
  }

  return device;
}

export type MockBluetooth = BrowerBluetoothLike & {
  requestDeviceCalls: BrowerRequestDeviceOptions[];
};

export type MockBluetoothOptions = {
  device?: BrowerDeviceLike;
  requestDeviceError?: unknown;
  /** When supplied, `requestDevice()` resolves with this instead of returning immediately. */
  requestDeviceGate?: Promise<BrowerDeviceLike>;
};

export function createMockBluetooth(options: MockBluetoothOptions = {}): MockBluetooth {
  const requestDeviceCalls: BrowerRequestDeviceOptions[] = [];
  return {
    requestDeviceCalls,
    async requestDevice(requestOptions) {
      requestDeviceCalls.push(requestOptions);
      if (options.requestDeviceGate !== undefined) return options.requestDeviceGate;
      if (options.requestDeviceError !== undefined) throw options.requestDeviceError;
      if (options.device === undefined) throw domException("NotFoundError");
      return options.device;
    },
  };
}
