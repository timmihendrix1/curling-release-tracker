// The one real implementation of `NativeBleTransport`, over
// @capacitor-community/bluetooth-le and iOS CoreBluetooth.
//
// It is a thin adapter on purpose: no retries, no reconnection, no polling, no state.
// Everything that decides *what* to do lives in the controller, so the behaviour the
// tests exercise is the behaviour that runs on the device — with only this translation
// layer, which does nothing a test could meaningfully disagree with, in between.
import { BleClient } from "@capacitor-community/bluetooth-le";
import type { BleService } from "@capacitor-community/bluetooth-le";
import type {
  NativeBleTransport,
  NativeDevice,
  NativeSelectionRequest,
  NativeService,
} from "./transport";

function toNativeServices(services: BleService[]): NativeService[] {
  return services.map((service) => ({
    uuid: service.uuid.toLowerCase(),
    characteristics: service.characteristics.map((characteristic) => ({
      uuid: characteristic.uuid.toLowerCase(),
      properties: {
        read: characteristic.properties.read,
        write: characteristic.properties.write,
        writeWithoutResponse: characteristic.properties.writeWithoutResponse,
        notify: characteristic.properties.notify,
        indicate: characteristic.properties.indicate,
      },
    })),
  }));
}

export function createCapacitorBleTransport(): NativeBleTransport {
  return {
    async initialize() {
      await BleClient.initialize();
    },

    isEnabled() {
      return BleClient.isEnabled();
    },

    async requestDevice(request: NativeSelectionRequest): Promise<NativeDevice> {
      // An EMPTY `services` array is the all-nearby fallback. It is passed as an
      // omitted property rather than as `[]`, because the plugin treats an empty
      // filter list and an absent one differently on some platforms, and "show me
      // everything" must not depend on that distinction.
      const device =
        request.services.length > 0
          ? await BleClient.requestDevice({
              services: request.services,
              optionalServices: request.optionalServices,
            })
          : await BleClient.requestDevice({
              optionalServices: request.optionalServices,
            });
      return { deviceId: device.deviceId, name: device.name ?? null };
    },

    async connect(deviceId: string, onDisconnect: (deviceId: string) => void) {
      await BleClient.connect(deviceId, onDisconnect);
    },

    async disconnect(deviceId: string) {
      await BleClient.disconnect(deviceId);
    },

    async getServices(deviceId: string): Promise<NativeService[]> {
      return toNativeServices(await BleClient.getServices(deviceId));
    },

    read(deviceId: string, service: string, characteristic: string): Promise<DataView> {
      return BleClient.read(deviceId, service, characteristic);
    },

    async startNotifications(
      deviceId: string,
      service: string,
      characteristic: string,
      callback: (value: DataView) => void
    ) {
      await BleClient.startNotifications(deviceId, service, characteristic, callback);
    },

    async stopNotifications(deviceId: string, service: string, characteristic: string) {
      await BleClient.stopNotifications(deviceId, service, characteristic);
    },
  };
}
