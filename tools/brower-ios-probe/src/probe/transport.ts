// The injected native BLE boundary.
//
// This interface is the ONLY way the probe's controller reaches Bluetooth. Two
// consequences are deliberate:
//
//  1. **There is no write operation.** Not "a write that is never called" — no method
//     at all. The prompt for this prototype forbids every command write to the timer
//     (memory requests, New Athlete, clear/reset, channel, test), and the cheapest way
//     to guarantee that is to make the capability absent from the type. A future
//     change that wanted to write would have to widen this interface in a diff that is
//     impossible to miss.
//
//  2. **Tests inject a fake here, and only here.** The real implementation
//     (`capacitorTransport.ts`) is constructed in exactly one place, behind a native-
//     platform check. Mock behaviour therefore cannot reach the physical-device path:
//     on a real iPhone the only implementation that exists is the Capacitor one, and
//     on any non-native platform the probe reports `unsupported_platform` and offers
//     nothing rather than falling back to `navigator.bluetooth` or to synthetic data.

export type NativeCharacteristicProperties = {
  read: boolean;
  write: boolean;
  writeWithoutResponse: boolean;
  notify: boolean;
  indicate: boolean;
};

export type NativeCharacteristic = {
  uuid: string;
  properties: NativeCharacteristicProperties;
};

export type NativeService = {
  uuid: string;
  characteristics: NativeCharacteristic[];
};

export type NativeDevice = {
  /** iOS-assigned peripheral identifier. App- and device-scoped, not a serial number. */
  deviceId: string;
  name: string | null;
};

export type NativeSelectionRequest = {
  /**
   * Service UUIDs the picker filters on. An EMPTY list means the explicit all-nearby
   * fallback: the picker shows everything it can see.
   */
  services: string[];
  /** Services that must still be reachable after connecting, whatever the filter was. */
  optionalServices: string[];
};

export interface NativeBleTransport {
  /** Triggers the iOS Bluetooth permission prompt on first call. */
  initialize(): Promise<void>;
  /** Whether Bluetooth is powered on and usable. */
  isEnabled(): Promise<boolean>;
  requestDevice(request: NativeSelectionRequest): Promise<NativeDevice>;
  connect(deviceId: string, onDisconnect: (deviceId: string) => void): Promise<void>;
  disconnect(deviceId: string): Promise<void>;
  getServices(deviceId: string): Promise<NativeService[]>;
  read(deviceId: string, service: string, characteristic: string): Promise<DataView>;
  startNotifications(
    deviceId: string,
    service: string,
    characteristic: string,
    callback: (value: DataView) => void
  ): Promise<void>;
  stopNotifications(
    deviceId: string,
    service: string,
    characteristic: string
  ): Promise<void>;
}

export type ProbePlatform =
  | { supported: true; platform: "ios" }
  | { supported: false; platform: string; reason: "not_native" | "not_ios" };

/**
 * Decides whether the real transport may be constructed at all.
 *
 * `isNativePlatform` distinguishes a native shell from a browser; `platform` then has
 * to be `ios`, because this experiment is scoped to iOS and Android is explicitly out
 * of scope. Note what is NOT here: no branch that, on failing these checks, quietly
 * uses Web Bluetooth instead. A browser is reported as unsupported.
 *
 * The iOS Simulator satisfies both checks and still has no Bluetooth hardware. That is
 * not detectable from here, and the probe does not pretend otherwise — it is stated in
 * the UI and in the acceptance procedure instead.
 */
export function resolveProbePlatform(capacitor: {
  isNativePlatform: () => boolean;
  getPlatform: () => string;
}): ProbePlatform {
  const platform = capacitor.getPlatform();
  if (!capacitor.isNativePlatform()) {
    return { supported: false, platform, reason: "not_native" };
  }
  if (platform !== "ios") {
    return { supported: false, platform, reason: "not_ios" };
  }
  return { supported: true, platform: "ios" };
}
