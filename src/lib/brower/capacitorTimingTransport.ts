// The one real implementation of `BrowerTimingTransport`, over
// @capacitor-community/bluetooth-le and the platform's own BLE stack.
//
// A thin adapter on purpose: no retries, no reconnection, no polling, no state.
// Everything that decides *what* to do lives in the controller, so the behaviour the
// tests exercise is the behaviour that runs on the device, with only this translation
// layer — which does nothing a test could meaningfully disagree with — in between.
//
// The plugin is loaded through a dynamic `import()` inside a native-only branch, the
// same pattern `src/lib/platform/externalLink.ts` and `fileExport.ts` already use. A
// Web build therefore never pulls the BLE plugin into its bundle.
import type {
  BrowerAppLifecycleSource,
  BrowerBleDevice,
  BrowerTimingTransport,
} from "./timingTransport";

export function createCapacitorBrowerTransport(): BrowerTimingTransport {
  async function client() {
    const { BleClient } = await import("@capacitor-community/bluetooth-le");
    return BleClient;
  }

  return {
    async initialize() {
      await (await client()).initialize();
    },

    async isEnabled() {
      return (await client()).isEnabled();
    },

    async requestDevice(request): Promise<BrowerBleDevice> {
      const device = await (await client()).requestDevice({
        services: request.services,
        optionalServices: request.optionalServices,
      });
      return { deviceId: device.deviceId, name: device.name ?? null };
    },

    async connect(deviceId, onDisconnect) {
      await (await client()).connect(deviceId, onDisconnect);
    },

    async disconnect(deviceId) {
      await (await client()).disconnect(deviceId);
    },

    async startNotifications(deviceId, service, characteristic, callback) {
      await (await client()).startNotifications(deviceId, service, characteristic, callback);
    },

    async stopNotifications(deviceId, service, characteristic) {
      await (await client()).stopNotifications(deviceId, service, characteristic);
    },
  };
}

export function createCapacitorBrowerLifecycle(): BrowerAppLifecycleSource {
  return {
    onActiveStateChange(listener) {
      const handlePromise = import("@capacitor/app").then(({ App }) =>
        App.addListener("appStateChange", ({ isActive }) => {
          listener(isActive);
        })
      );

      let removed = false;
      return () => {
        if (removed) return;
        removed = true;
        void handlePromise.then((handle) => handle.remove()).catch(() => undefined);
      };
    },
  };
}
